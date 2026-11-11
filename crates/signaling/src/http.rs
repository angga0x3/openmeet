use std::{path::PathBuf, sync::Arc, time::Duration};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

use crate::{
    protocol::{ClientMsg, IceServer, ServerMsg},
    room::{valid_passcode, CreateRoomError, Hub, JoinError},
};

pub type AppState = Arc<Hub>;

const MAX_WS_MESSAGE: usize = 64 * 1024;
const JOIN_TIMEOUT: Duration = Duration::from_secs(10);
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: http: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

pub fn router(hub: AppState, web_dir: Option<PathBuf>) -> Router {
    let mut app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/config", get(config))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{id}", get(room_info))
        .route("/ws", get(ws_handler));

    if let Some(dir) = web_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(ServeDir::new(dir).not_found_service(ServeFile::new(index)));
    }

    app.layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CONTENT_SECURITY_POLICY),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(self), microphone=(self), display-capture=(self)"),
        ))
        .with_state(hub)
}

async fn healthz() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Serialize)]
struct PublicConfig {
    ice_servers: Vec<IceServer>,
    max_participants: usize,
}

async fn config(State(hub): State<AppState>) -> impl IntoResponse {
    Json(PublicConfig {
        ice_servers: hub.ice_servers(),
        max_participants: hub.config().max_participants,
    })
}

#[derive(Deserialize)]
struct CreateRoomReq {
    #[serde(default)]
    passcode: Option<String>,
    #[serde(default)]
    id: Option<String>,
}

#[derive(Serialize)]
struct CreateRoomRes {
    room_id: String,
    has_passcode: bool,
}

async fn create_room(
    State(hub): State<AppState>,
    Json(req): Json<CreateRoomReq>,
) -> Response {
    let passcode = match req.passcode {
        None => None,
        Some(raw) if raw.trim().is_empty() => None,
        Some(raw) => match valid_passcode(&raw) {
            Some(valid) => Some(valid.to_string()),
            None => {
                return api_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_passcode",
                    "Passcodes must be 1-64 characters.",
                )
            }
        },
    };
    let has_passcode = passcode.is_some();

    if let Some(requested) = req.id {
        let id = requested.trim().to_ascii_lowercase();
        if id.is_empty() {
            return api_error(
                StatusCode::BAD_REQUEST,
                "invalid_room_id",
                "Room codes are 6-32 lowercase letters, digits, or single dashes.",
            );
        }
        return match hub.create_room_with_id(&id, passcode.as_deref()) {
            Ok(()) => (
                StatusCode::CREATED,
                Json(CreateRoomRes {
                    room_id: id,
                    has_passcode,
                }),
            )
                .into_response(),
            Err(CreateRoomError::Exists) => api_error(
                StatusCode::CONFLICT,
                "room_exists",
                "That room code is already active.",
            ),
            Err(CreateRoomError::InvalidId) => api_error(
                StatusCode::BAD_REQUEST,
                "invalid_room_id",
                "Room codes are 6-32 lowercase letters, digits, or single dashes.",
            ),
        };
    }

    let room_id = hub.create_room(passcode.as_deref());
    (
        StatusCode::CREATED,
        Json(CreateRoomRes {
            room_id,
            has_passcode,
        }),
    )
        .into_response()
}

#[derive(Serialize)]
struct RoomView {
    room_id: String,
    participants: usize,
    max_participants: usize,
    has_passcode: bool,
}

async fn room_info(State(hub): State<AppState>, Path(id): Path<String>) -> Response {
    match hub.room_info(&id) {
        Some(info) => Json(RoomView {
            room_id: info.room_id,
            participants: info.participants,
            max_participants: info.max_participants,
            has_passcode: info.has_passcode,
        })
        .into_response(),
        None => api_error(StatusCode::NOT_FOUND, "room_not_found", "Room does not exist."),
    }
}

#[derive(Serialize)]
struct ApiError {
    code: &'static str,
    message: String,
}

fn api_error(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ApiError {
            code,
            message: message.into(),
        }),
    )
        .into_response()
}

async fn ws_handler(ws: WebSocketUpgrade, State(hub): State<AppState>) -> Response {
    ws.max_message_size(MAX_WS_MESSAGE)
        .on_upgrade(move |socket| client_loop(socket, hub))
}

async fn client_loop(socket: WebSocket, hub: AppState) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();

    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let Ok(text) = serde_json::to_string(&msg) else {
                continue;
            };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let join = match tokio::time::timeout(JOIN_TIMEOUT, next_text(&mut stream)).await {
        Ok(Some(text)) => serde_json::from_str::<ClientMsg>(&text).ok(),
        _ => None,
    };

    let (room, peer_id, is_host) = match join {
        Some(ClientMsg::Join {
            room,
            name,
            passcode,
            mic,
            cam,
        }) => match hub.join(&room, &name, passcode.as_deref(), mic, cam, tx.clone()) {
            Ok(joined) => {
                let peer_id = joined.me.id.clone();
                let _ = tx.send(ServerMsg::Welcome {
                    self_id: peer_id.clone(),
                    room: room.clone(),
                    peers: joined.peers,
                    ice_servers: joined.ice_servers,
                    is_host: joined.is_host,
                });
                hub.broadcast(
                    &room,
                    &ServerMsg::PeerJoined {
                        peer: joined.me,
                    },
                    Some(&peer_id),
                );
                (room, peer_id, joined.is_host)
            }
            Err(err) => {
                let _ = tx.send(join_error(err));
                drop(tx);
                let _ = writer.await;
                return;
            }
        },
        _ => {
            let _ = tx.send(ServerMsg::error(
                "bad_request",
                "The first message must be a join.",
            ));
            drop(tx);
            let _ = writer.await;
            return;
        }
    };

    let mut ended = false;

    while let Some(text) = next_text(&mut stream).await {
        let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) else {
            let _ = tx.send(ServerMsg::error("bad_message", "Malformed message."));
            continue;
        };

        match msg {
            ClientMsg::Join { .. } => {
                let _ = tx.send(ServerMsg::error("already_joined", "Already in a room."));
            }
            ClientMsg::Signal { to, data } => {
                if !hub.relay(&room, &peer_id, &to, data) {
                    let _ = tx.send(ServerMsg::error("peer_not_found", "Peer is not in the room."));
                }
            }
            ClientMsg::Chat { text } => match hub.chat(&room, &peer_id, &text) {
                Some(out) => {
                    if let Some(peer) = hub.peer(&room, &peer_id) {
                        hub.broadcast(
                            &room,
                            &ServerMsg::Chat {
                                from: peer_id.clone(),
                                name: peer.name,
                                text: out.text,
                                ts: out.ts,
                            },
                            None,
                        );
                    }
                }
                None => {
                    let _ = tx.send(ServerMsg::error(
                        "rate_limited",
                        "Slow down: too many messages.",
                    ));
                }
            },
            ClientMsg::State { mic, cam, sharing } => {
                if let Some(peer) = hub.state(&room, &peer_id, mic, cam, sharing) {
                    hub.broadcast(
                        &room,
                        &ServerMsg::State {
                            from: peer.id,
                            mic: peer.mic,
                            cam: peer.cam,
                            sharing: peer.sharing,
                        },
                        Some(&peer_id),
                    );
                }
            }
            ClientMsg::Reaction { emoji } => {
                if let Some(out) = hub.react(&room, &peer_id, &emoji) {
                    hub.broadcast(
                        &room,
                        &ServerMsg::Reaction {
                            from: peer_id.clone(),
                            name: out.name,
                            emoji: out.emoji,
                        },
                        None,
                    );
                }
            }
            ClientMsg::EndMeeting => {
                if hub.end_meeting(&room, &peer_id) {
                    ended = true;
                    break;
                }
                let _ = tx.send(ServerMsg::error(
                    "not_host",
                    "Only the host can end the meeting.",
                ));
            }
            ClientMsg::Ping => {
                let _ = tx.send(ServerMsg::Pong);
            }
            ClientMsg::Leave => break,
        }
    }

    if !ended {
        hub.leave(&room, &peer_id);
        hub.broadcast(
            &room,
            &ServerMsg::PeerLeft {
                peer_id: peer_id.clone(),
            },
            Some(&peer_id),
        );
    }

    let _ = is_host;
    drop(tx);
    let _ = writer.await;
}

fn join_error(err: JoinError) -> ServerMsg {
    let message = match err {
        JoinError::NotFound => "Room does not exist.",
        JoinError::BadPasscode => "Incorrect passcode.",
        JoinError::Full => "Room is full.",
    };
    ServerMsg::error(err.code(), message)
}

async fn next_text<S>(stream: &mut S) -> Option<String>
where
    S: Stream<Item = Result<Message, axum::Error>> + Unpin,
{
    loop {
        match stream.next().await? {
            Ok(Message::Text(text)) => return Some(text.as_str().to_string()),
            Ok(Message::Binary(bytes)) => return String::from_utf8(bytes.to_vec()).ok(),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::Config;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message as WsMessage;

    async fn spawn_server() -> (Arc<Hub>, std::net::SocketAddr) {
        let hub = Arc::new(Hub::new(Config {
            max_participants: 4,
            ..Config::default()
        }));
        let app = router(hub.clone(), None);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (hub, addr)
    }

    async fn recv_json<S>(stream: &mut S) -> serde_json::Value
    where
        S: Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        loop {
            let msg = stream.next().await.expect("socket closed").expect("ws error");
            match msg {
                WsMessage::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
                WsMessage::Binary(bytes) => return serde_json::from_slice(&bytes).unwrap(),
                _ => continue,
            }
        }
    }

    async fn send_json<S>(stream: &mut S, value: serde_json::Value)
    where
        S: SinkExt<WsMessage> + Unpin,
        <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Debug,
    {
        stream
            .send(WsMessage::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn two_peers_join_signal_chat_and_close() {
        let (hub, addr) = spawn_server().await;
        let room = hub.create_room(None);

        let (mut a, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
            .await
            .unwrap();
        send_json(
            &mut a,
            serde_json::json!({"type":"join","room":room,"name":"Ada","mic":true,"cam":false}),
        )
        .await;
        let welcome_a = recv_json(&mut a).await;
        assert_eq!(welcome_a["type"], "welcome");
        assert_eq!(welcome_a["is_host"], true);
        assert_eq!(welcome_a["peers"].as_array().unwrap().len(), 0);
        let a_id = welcome_a["self_id"].as_str().unwrap().to_string();

        let (mut b, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
            .await
            .unwrap();
        send_json(
            &mut b,
            serde_json::json!({"type":"join","room":room,"name":"Grace"}),
        )
        .await;
        let welcome_b = recv_json(&mut b).await;
        assert_eq!(welcome_b["type"], "welcome");
        assert_eq!(welcome_b["is_host"], false);
        assert_eq!(welcome_b["peers"][0]["name"], "Ada");
        let b_id = welcome_b["self_id"].as_str().unwrap().to_string();

        let joined = recv_json(&mut a).await;
        assert_eq!(joined["type"], "peer_joined");
        assert_eq!(joined["peer"]["name"], "Grace");

        send_json(
            &mut b,
            serde_json::json!({"type":"signal","to":a_id,"data":{"kind":"offer","sdp":"v=0"}}),
        )
        .await;
        let signal = recv_json(&mut a).await;
        assert_eq!(signal["type"], "signal");
        assert_eq!(signal["from"], b_id);
        assert_eq!(signal["data"]["sdp"], "v=0");

        send_json(&mut b, serde_json::json!({"type":"chat","text":"hello"})).await;
        let chat_a = recv_json(&mut a).await;
        let chat_b = recv_json(&mut b).await;
        assert_eq!(chat_a["type"], "chat");
        assert_eq!(chat_a["text"], "hello");
        assert_eq!(chat_a["name"], "Grace");
        assert_eq!(chat_b["from"], b_id);

        send_json(&mut b, serde_json::json!({"type":"end_meeting"})).await;
        let denied = recv_json(&mut b).await;
        assert_eq!(denied["type"], "error");
        assert_eq!(denied["code"], "not_host");

        send_json(&mut a, serde_json::json!({"type":"end_meeting"})).await;
        let closed_a = recv_json(&mut a).await;
        let closed_b = recv_json(&mut b).await;
        assert_eq!(closed_a["type"], "room_closed");
        assert_eq!(closed_b["type"], "room_closed");
    }

    #[tokio::test]
    async fn http_room_lifecycle() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use http_body_util::BodyExt;
        use tower::ServiceExt;

        let hub = Arc::new(Hub::new(Config::default()));
        let app = router(hub.clone(), None);

        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/rooms")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"passcode":"open sesame"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let room = json["room_id"].as_str().unwrap().to_string();
        assert_eq!(json["has_passcode"], true);

        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/rooms/{room}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["participants"], 0);
        assert_eq!(json["max_participants"], 8);

        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/rooms/doesnotexist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}
