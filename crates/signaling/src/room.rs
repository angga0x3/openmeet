use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use crate::protocol::{IceServer, Peer, ServerMsg};

pub const MAX_NAME_LEN: usize = 64;
pub const MAX_PASSCODE_LEN: usize = 64;
pub const MAX_CHAT_LEN: usize = 2000;
pub const CHAT_WINDOW: Duration = Duration::from_secs(5);
pub const CHAT_WINDOW_MAX: u32 = 12;

#[derive(Debug, Clone)]
pub struct TurnConfig {
    pub urls: Vec<String>,
    pub secret: String,
    pub ttl: Duration,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub ice_servers: Vec<IceServer>,
    pub turn: Option<TurnConfig>,
    pub max_participants: usize,
    /// Empty rooms are collected after this long.
    pub room_idle: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            ice_servers: vec![IceServer {
                urls: vec!["stun:stun.l.google.com:19302".into()],
                username: None,
                credential: None,
            }],
            turn: None,
            max_participants: 8,
            room_idle: Duration::from_secs(600),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    NotFound,
    BadPasscode,
    Full,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CreateRoomError {
    Exists,
    InvalidId,
}

/// Room codes are lowercase alphanumerics with optional single dashes.
pub fn valid_room_id(id: &str) -> bool {
    let len = id.len();
    if !(6..=32).contains(&len) {
        return false;
    }
    if id.starts_with('-') || id.ends_with('-') || id.contains("--") {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

impl JoinError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound => "room_not_found",
            Self::BadPasscode => "bad_passcode",
            Self::Full => "room_full",
        }
    }
}

#[derive(Debug)]
pub struct Joined {
    pub me: Peer,
    pub peers: Vec<Peer>,
    pub is_host: bool,
    pub ice_servers: Vec<IceServer>,
}

pub struct ChatOut {
    pub text: String,
    pub ts: u64,
}

pub struct ReactionOut {
    pub name: String,
    pub emoji: String,
}

#[derive(Debug, Clone)]
pub struct RoomInfo {
    pub room_id: String,
    pub participants: usize,
    pub max_participants: usize,
    pub has_passcode: bool,
}

struct Passcode {
    salt: String,
    hash: String,
}

impl Passcode {
    fn new(raw: &str) -> Self {
        let salt: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(24)
            .map(char::from)
            .collect();
        let hash = hash_with_salt(&salt, raw);
        Self { salt, hash }
    }

    fn matches(&self, raw: &str) -> bool {
        constant_time_eq(hash_with_salt(&self.salt, raw).as_bytes(), self.hash.as_bytes())
    }
}

fn hash_with_salt(salt: &str, raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b"\0");
    hasher.update(raw.as_bytes());
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

struct PeerEntry {
    peer: Peer,
    tx: mpsc::UnboundedSender<ServerMsg>,
    window_start: Instant,
    window_count: u32,
}

struct Room {
    passcode: Option<Passcode>,
    peers: HashMap<String, PeerEntry>,
    host: Option<String>,
    empty_since: Option<Instant>,
}

pub struct Hub {
    inner: Mutex<HashMap<String, Room>>,
    cfg: Config,
}

impl Hub {
    pub fn new(cfg: Config) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            cfg,
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Static STUN entries plus, when configured, short-lived TURN credentials.
    pub fn ice_servers(&self) -> Vec<IceServer> {
        let mut servers = self.cfg.ice_servers.clone();
        if let Some(turn) = &self.cfg.turn {
            let expires = unix_seconds() + turn.ttl.as_secs();
            let username = format!("{expires}:openmeet");
            servers.push(IceServer {
                urls: turn.urls.clone(),
                username: Some(username.clone()),
                credential: Some(turn_credential(&turn.secret, &username)),
            });
        }
        servers
    }

    pub fn create_room(&self, passcode: Option<&str>) -> String {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        loop {
            let id: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(12)
                .map(char::from)
                .map(|c| c.to_ascii_lowercase())
                .collect();
            if rooms.contains_key(&id) {
                continue;
            }
            rooms.insert(
                id.clone(),
                Room {
                    passcode: passcode.map(Passcode::new),
                    peers: HashMap::new(),
                    host: None,
                    empty_since: Some(Instant::now()),
                },
            );
            return id;
        }
    }

    /// Creates a room with a caller-chosen code (used for scheduled and personal rooms).
    pub fn create_room_with_id(
        &self,
        id: &str,
        passcode: Option<&str>,
    ) -> Result<(), CreateRoomError> {
        if !valid_room_id(id) {
            return Err(CreateRoomError::InvalidId);
        }
        let mut rooms = self.inner.lock().expect("hub poisoned");
        if rooms.contains_key(id) {
            return Err(CreateRoomError::Exists);
        }
        rooms.insert(
            id.to_string(),
            Room {
                passcode: passcode.map(Passcode::new),
                peers: HashMap::new(),
                host: None,
                empty_since: Some(Instant::now()),
            },
        );
        Ok(())
    }

    pub fn room_info(&self, room_id: &str) -> Option<RoomInfo> {
        let rooms = self.inner.lock().expect("hub poisoned");
        rooms.get(room_id).map(|room| RoomInfo {
            room_id: room_id.to_string(),
            participants: room.peers.len(),
            max_participants: self.cfg.max_participants,
            has_passcode: room.passcode.is_some(),
        })
    }

    pub fn join(
        &self,
        room_id: &str,
        name: &str,
        passcode: Option<&str>,
        mic: bool,
        cam: bool,
        tx: mpsc::UnboundedSender<ServerMsg>,
    ) -> Result<Joined, JoinError> {
        let name = sanitize_name(name);
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let room = rooms.get_mut(room_id).ok_or(JoinError::NotFound)?;
        if room.peers.len() >= self.cfg.max_participants {
            return Err(JoinError::Full);
        }
        if let Some(expected) = &room.passcode {
            let supplied = passcode.unwrap_or_default();
            if !expected.matches(supplied) {
                return Err(JoinError::BadPasscode);
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let me = Peer {
            id: id.clone(),
            name,
            mic,
            cam,
            sharing: false,
        };
        room.peers.insert(
            id.clone(),
            PeerEntry {
                peer: me.clone(),
                tx,
                window_start: Instant::now(),
                window_count: 0,
            },
        );
        room.empty_since = None;
        let is_host = match &room.host {
            Some(_) => false,
            None => {
                room.host = Some(id.clone());
                true
            }
        };
        let peers: Vec<Peer> = room
            .peers
            .values()
            .filter(|entry| entry.peer.id != id)
            .map(|entry| entry.peer.clone())
            .collect();
        Ok(Joined {
            me,
            peers,
            is_host,
            ice_servers: self.ice_servers(),
        })
    }

    /// Removes the peer and reports whether the room became empty and whether it was the host.
    pub fn leave(&self, room_id: &str, peer_id: &str) -> (bool, bool) {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let Some(room) = rooms.get_mut(room_id) else {
            return (false, false);
        };
        room.peers.remove(peer_id);
        let was_host = room.host.as_deref() == Some(peer_id);
        let empty = room.peers.is_empty();
        if empty {
            room.empty_since = Some(Instant::now());
        }
        (empty, was_host)
    }

    pub fn peer(&self, room_id: &str, peer_id: &str) -> Option<Peer> {
        let rooms = self.inner.lock().expect("hub poisoned");
        rooms
            .get(room_id)?
            .peers
            .get(peer_id)
            .map(|entry| entry.peer.clone())
    }

    pub fn broadcast(&self, room_id: &str, msg: &ServerMsg, except: Option<&str>) {
        let rooms = self.inner.lock().expect("hub poisoned");
        let Some(room) = rooms.get(room_id) else {
            return;
        };
        for (id, entry) in &room.peers {
            if Some(id.as_str()) == except {
                continue;
            }
            let _ = entry.tx.send(msg.clone());
        }
    }

    pub fn relay(&self, room_id: &str, from: &str, to: &str, data: serde_json::Value) -> bool {
        let rooms = self.inner.lock().expect("hub poisoned");
        let Some(room) = rooms.get(room_id) else {
            return false;
        };
        if !room.peers.contains_key(from) || !room.peers.contains_key(to) {
            return false;
        }
        room.peers
            .get(to)
            .map(|entry| {
                entry
                    .tx
                    .send(ServerMsg::Signal {
                        from: from.to_string(),
                        data,
                    })
                    .is_ok()
            })
            .unwrap_or(false)
    }

    pub fn state(
        &self,
        room_id: &str,
        peer_id: &str,
        mic: bool,
        cam: bool,
        sharing: bool,
    ) -> Option<Peer> {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let room = rooms.get_mut(room_id)?;
        let entry = room.peers.get_mut(peer_id)?;
        entry.peer.mic = mic;
        entry.peer.cam = cam;
        entry.peer.sharing = sharing;
        Some(entry.peer.clone())
    }

    pub fn chat(&self, room_id: &str, peer_id: &str, text: &str) -> Option<ChatOut> {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let room = rooms.get_mut(room_id)?;
        let entry = room.peers.get_mut(peer_id)?;

        let now = Instant::now();
        if now.duration_since(entry.window_start) > CHAT_WINDOW {
            entry.window_start = now;
            entry.window_count = 0;
        }
        if entry.window_count >= CHAT_WINDOW_MAX {
            return None;
        }
        entry.window_count += 1;

        let text = sanitize_text(text, MAX_CHAT_LEN);
        if text.is_empty() {
            return None;
        }
        Some(ChatOut {
            text,
            ts: unix_millis(),
        })
    }

    pub fn react(&self, room_id: &str, peer_id: &str, emoji: &str) -> Option<ReactionOut> {
        let rooms = self.inner.lock().expect("hub poisoned");
        let room = rooms.get(room_id)?;
        let entry = room.peers.get(peer_id)?;
        let emoji = sanitize_text(emoji, 16);
        if emoji.is_empty() {
            return None;
        }
        Some(ReactionOut {
            name: entry.peer.name.clone(),
            emoji,
        })
    }

    /// Host-only. Removes the room and notifies every remaining peer.
    pub fn end_meeting(&self, room_id: &str, peer_id: &str) -> bool {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let authorized = rooms
            .get(room_id)
            .map(|room| room.host.as_deref() == Some(peer_id))
            .unwrap_or(false);
        if !authorized {
            return false;
        }
        if let Some(room) = rooms.remove(room_id) {
            for entry in room.peers.values() {
                let _ = entry.tx.send(ServerMsg::RoomClosed {
                    reason: "host_ended".into(),
                });
            }
        }
        true
    }

    /// Drops rooms that have been empty for longer than the configured idle time.
    pub fn sweep(&self) -> usize {
        let mut rooms = self.inner.lock().expect("hub poisoned");
        let before = rooms.len();
        let idle = self.cfg.room_idle;
        rooms.retain(|_, room| match room.empty_since {
            Some(at) if room.peers.is_empty() => at.elapsed() < idle,
            _ => true,
        });
        before - rooms.len()
    }
}

pub fn sanitize_name(raw: &str) -> String {
    let cleaned = sanitize_text(raw, MAX_NAME_LEN);
    if cleaned.is_empty() {
        "Guest".to_string()
    } else {
        cleaned
    }
}

/// Trims, removes control characters, and truncates on a character boundary.
pub fn sanitize_text(raw: &str, max_chars: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn valid_passcode(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_PASSCODE_LEN {
        None
    } else {
        Some(trimmed)
    }
}

/// coturn `use-auth-secret` credential: base64(HMAC-SHA1(secret, username)).
pub fn turn_credential(secret: &str, username: &str) -> String {
    let mut mac =
        Hmac::<Sha1>::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any size");
    mac.update(username.as_bytes());
    BASE64.encode(mac.finalize().into_bytes())
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hub() -> Hub {
        Hub::new(Config {
            max_participants: 3,
            ..Config::default()
        })
    }

    fn channel() -> mpsc::UnboundedReceiver<ServerMsg> {
        mpsc::unbounded_channel().1
    }

    fn sender() -> mpsc::UnboundedSender<ServerMsg> {
        mpsc::unbounded_channel().0
    }

    #[test]
    fn join_assigns_host_and_lists_existing_peers() {
        let hub = hub();
        let room = hub.create_room(None);
        let first = hub
            .join(&room, "Ada", None, false, true, sender())
            .unwrap();
        assert!(first.is_host);
        assert!(first.peers.is_empty());

        let second = hub
            .join(&room, "Grace", None, false, false, sender())
            .unwrap();
        assert!(!second.is_host);
        assert_eq!(second.peers.len(), 1);
        assert_eq!(second.peers[0].name, "Ada");
    }

    #[test]
    fn unknown_room_is_rejected() {
        let hub = hub();
        assert_eq!(
            hub.join("nope", "Ada", None, false, false, sender())
                .unwrap_err(),
            JoinError::NotFound
        );
    }

    #[test]
    fn passcode_is_enforced() {
        let hub = hub();
        let room = hub.create_room(Some("s3cret"));
        assert!(hub.room_info(&room).unwrap().has_passcode);
        assert_eq!(
            hub.join(&room, "Ada", Some("wrong"), false, false, sender())
                .unwrap_err(),
            JoinError::BadPasscode
        );
        assert!(hub
            .join(&room, "Ada", Some("s3cret"), false, false, sender())
            .is_ok());
    }

    #[test]
    fn capacity_is_enforced() {
        let hub = hub();
        let room = hub.create_room(None);
        for i in 0..3 {
            hub.join(&room, &format!("p{i}"), None, false, false, sender())
                .unwrap();
        }
        assert_eq!(
            hub.join(&room, "late", None, false, false, sender())
                .unwrap_err(),
            JoinError::Full
        );
    }

    #[test]
    fn chat_is_rate_limited() {
        let hub = hub();
        let room = hub.create_room(None);
        let joined = hub
            .join(&room, "Ada", None, false, false, sender())
            .unwrap();
        for _ in 0..CHAT_WINDOW_MAX {
            assert!(hub.chat(&room, &joined.me.id, "hi").is_some());
        }
        assert!(hub.chat(&room, &joined.me.id, "again").is_none());
    }

    #[test]
    fn only_host_can_end_meeting() {
        let hub = hub();
        let room = hub.create_room(None);
        let host = hub
            .join(&room, "Ada", None, false, false, sender())
            .unwrap();
        let guest = hub
            .join(&room, "Grace", None, false, false, sender())
            .unwrap();
        assert!(!hub.end_meeting(&room, &guest.me.id));
        assert!(hub.end_meeting(&room, &host.me.id));
        assert!(hub.room_info(&room).is_none());
    }

    #[test]
    fn names_are_sanitized() {
        assert_eq!(sanitize_name("  Ada\nLovelace  "), "AdaLovelace");
        assert_eq!(sanitize_name("\u{7}"), "Guest");
    }

    #[test]
    fn empty_rooms_are_swept() {
        let hub = Hub::new(Config {
            room_idle: Duration::from_millis(1),
            ..Config::default()
        });
        let room = hub.create_room(None);
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(hub.sweep(), 1);
        assert!(hub.room_info(&room).is_none());
    }

    #[test]
    fn leaving_marks_room_empty() {
        let hub = hub();
        let room = hub.create_room(None);
        let joined = hub
            .join(&room, "Ada", None, false, false, sender())
            .unwrap();
        let _unused = channel();
        let (empty, was_host) = hub.leave(&room, &joined.me.id);
        assert!(empty);
        assert!(was_host);
    }

    #[test]
    fn turn_credential_matches_rfc2202_vector() {
        let credential = turn_credential("Jefe", "what do ya want for nothing?");
        let raw = BASE64.decode(credential).unwrap();
        assert_eq!(hex(&raw), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
    }

    #[test]
    fn ice_servers_include_ephemeral_turn_credentials() {
        let hub = Hub::new(Config {
            turn: Some(TurnConfig {
                urls: vec!["turn:turn.example:3478".into()],
                secret: "shared-secret".into(),
                ttl: Duration::from_secs(3600),
            }),
            ..Config::default()
        });

        let servers = hub.ice_servers();
        assert_eq!(servers.len(), 2);
        assert!(servers[0].username.is_none());
        let turn = &servers[1];
        assert_eq!(turn.urls[0], "turn:turn.example:3478");
        let username = turn.username.clone().unwrap();
        assert!(username.ends_with(":openmeet"));
        assert_eq!(
            turn.credential.clone().unwrap(),
            turn_credential("shared-secret", &username)
        );
    }
}
