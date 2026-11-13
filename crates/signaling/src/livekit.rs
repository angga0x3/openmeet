use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine as _};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct LiveKitConfig {
    pub url: String,
    pub api_key: String,
    pub api_secret: String,
    pub ttl: Duration,
}

#[derive(Serialize)]
struct VideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
    #[serde(rename = "canPublishData")]
    can_publish_data: bool,
}

#[derive(Serialize)]
struct Claims<'a> {
    exp: u64,
    iss: &'a str,
    sub: &'a str,
    nbf: u64,
    name: &'a str,
    video: VideoGrant,
}

/// Mints a LiveKit access token (HS256 JWT). The API secret never leaves the server.
pub fn access_token(
    config: &LiveKitConfig,
    room: &str,
    identity: &str,
    name: &str,
) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let claims = Claims {
        exp: now + config.ttl.as_secs(),
        iss: &config.api_key,
        sub: identity,
        nbf: now.saturating_sub(5),
        name,
        video: VideoGrant {
            room: room.to_string(),
            room_join: true,
            can_publish: true,
            can_subscribe: true,
            can_publish_data: true,
        },
    };

    let header = B64URL.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = B64URL.encode(serde_json::to_vec(&claims).map_err(|error| error.to_string())?);
    let signing_input = format!("{header}.{payload}");

    let mut mac = Hmac::<Sha256>::new_from_slice(config.api_secret.as_bytes())
        .map_err(|error| error.to_string())?;
    mac.update(signing_input.as_bytes());
    let signature = B64URL.encode(mac.finalize().into_bytes());
    Ok(format!("{signing_input}.{signature}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_has_three_parts_and_expected_claims() {
        let config = LiveKitConfig {
            url: "wss://example.livekit.cloud".into(),
            api_key: "key".into(),
            api_secret: "secret".into(),
            ttl: Duration::from_secs(600),
        };
        let token = access_token(&config, "room-1", "peer-1", "Ada").unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let payload = B64URL.decode(parts[1]).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(value["iss"], "key");
        assert_eq!(value["sub"], "peer-1");
        assert_eq!(value["video"]["room"], "room-1");
        assert_eq!(value["video"]["roomJoin"], true);
    }
}
