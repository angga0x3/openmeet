use serde::{Deserialize, Serialize};

/// Participant as seen by other clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mic: bool,
    #[serde(default)]
    pub cam: bool,
    #[serde(default)]
    pub sharing: bool,
    #[serde(default)]
    pub hand: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

/// Messages sent by a client over the signaling socket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Join {
        room: String,
        name: String,
        #[serde(default)]
        passcode: Option<String>,
        #[serde(default)]
        mic: bool,
        #[serde(default)]
        cam: bool,
    },
    /// Opaque SDP/ICE payload relayed to exactly one peer.
    Signal {
        to: String,
        data: serde_json::Value,
    },
    Chat {
        text: String,
    },
    State {
        mic: bool,
        cam: bool,
        sharing: bool,
        #[serde(default)]
        hand: bool,
    },
    Reaction {
        emoji: String,
    },
    /// Host only: close the room for everyone.
    EndMeeting,
    /// Keeps intermediaries (tunnels, proxies) from dropping an idle socket.
    Ping,
    Leave,
}

/// Messages sent by the signaling service.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Welcome {
        self_id: String,
        room: String,
        peers: Vec<Peer>,
        ice_servers: Vec<IceServer>,
        is_host: bool,
        media_token: String,
    },
    PeerJoined {
        peer: Peer,
    },
    PeerLeft {
        peer_id: String,
    },
    Signal {
        from: String,
        data: serde_json::Value,
    },
    Chat {
        from: String,
        name: String,
        text: String,
        ts: u64,
    },
    State {
        from: String,
        mic: bool,
        cam: bool,
        sharing: bool,
        hand: bool,
    },
    Reaction {
        from: String,
        name: String,
        emoji: String,
    },
    RoomClosed {
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
    Pong,
}

impl ServerMsg {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Self::Error {
            code: code.to_string(),
            message: message.into(),
        }
    }
}
