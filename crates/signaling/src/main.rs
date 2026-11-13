use std::{net::SocketAddr, sync::Arc, time::Duration};

use openmeet_signaling::{
    http::router,
    livekit::LiveKitConfig,
    protocol::IceServer,
    room::{Config, Hub, TurnConfig},
    schedule::ScheduleStore,
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind: SocketAddr = std::env::var("OPENMEET_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8770".to_string())
        .parse()?;

    let ice_urls: Vec<String> = std::env::var("OPENMEET_ICE")
        .unwrap_or_else(|_| "stun:stun.l.google.com:19302".to_string())
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    let max_participants = std::env::var("OPENMEET_MAX_PARTICIPANTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8usize);

    let room_idle = std::env::var("OPENMEET_ROOM_IDLE_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or(Duration::from_secs(600));

    let turn = match (
        std::env::var("OPENMEET_TURN_URLS").ok(),
        std::env::var("OPENMEET_TURN_SECRET").ok(),
    ) {
        (Some(urls), Some(secret)) if !urls.trim().is_empty() && !secret.trim().is_empty() => {
            let urls: Vec<String> = urls
                .split(',')
                .map(str::trim)
                .filter(|url| !url.is_empty())
                .map(ToOwned::to_owned)
                .collect();
            if urls.is_empty() {
                None
            } else {
                let ttl = std::env::var("OPENMEET_TURN_TTL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(21600u64);
                Some(TurnConfig {
                    urls,
                    secret: secret.trim().to_string(),
                    ttl: Duration::from_secs(ttl),
                })
            }
        }
        _ => None,
    };

    let livekit = match (
        std::env::var("LIVEKIT_URL"),
        std::env::var("LIVEKIT_API_KEY"),
        std::env::var("LIVEKIT_API_SECRET"),
    ) {
        (Ok(url), Ok(api_key), Ok(api_secret))
            if !url.trim().is_empty()
                && !api_key.trim().is_empty()
                && !api_secret.trim().is_empty() =>
        {
            tracing::info!(url = %url.trim(), "LiveKit SFU configured");
            Some(LiveKitConfig {
                url: url.trim().to_string(),
                api_key: api_key.trim().to_string(),
                api_secret: api_secret.trim().to_string(),
                ttl: Duration::from_secs(6 * 3600),
            })
        }
        _ => {
            tracing::warn!("LiveKit is not configured; media falls back to the peer-to-peer mesh");
            None
        }
    };

    let cfg = Config {
        ice_servers: vec![IceServer {
            urls: ice_urls,
            username: None,
            credential: None,
        }],
        turn,
        max_participants,
        room_idle,
        livekit,
    };

    let schedule = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => match ScheduleStore::connect(url.trim()).await {
            Ok(store) => {
                tracing::info!("schedule database connected");
                Some(Arc::new(store))
            }
            Err(error) => {
                tracing::error!(%error, "schedule database unavailable; scheduling API disabled");
                None
            }
        },
        _ => {
            tracing::warn!("DATABASE_URL is not set; scheduling API disabled");
            None
        }
    };

    let hub = Arc::new(Hub::new(cfg, schedule));

    let web_dir = std::env::var("OPENMEET_WEB_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .filter(|path| path.join("index.html").is_file());

    if web_dir.is_some() {
        tracing::info!(dir = ?web_dir, "serving web client");
    }

    let app = router(hub.clone(), web_dir);

    let sweeper = {
        let hub = hub.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                let removed = hub.sweep();
                if removed > 0 {
                    tracing::info!(removed, "collected idle rooms");
                }
            }
        })
    };

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, max_participants, "openmeet signaling listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    sweeper.abort();
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
