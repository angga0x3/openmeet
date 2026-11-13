# Signaling protocol (v0)

Transport: WebSocket, JSON text frames, one socket per participant.
Endpoint: `GET /ws` (upgrade). Max frame: 64 KiB.

All field names are `snake_case` on the wire, matching the Rust types in
`crates/signaling/src/protocol.rs`.

## Lifecycle

1. Client connects and sends `join` as the first frame within 10 seconds.
2. Server replies `welcome` (self id, existing peers, ICE servers, host flag) and broadcasts
   `peer_joined` to everyone else.
3. Clients exchange `signal` frames until each pair has a connection.
4. Chat, presence and reactions flow through the server as small messages.
5. On disconnect the server broadcasts `peer_left`; the host may send `end_meeting`.

## Client → server

```jsonc
{ "type": "join", "room": "k4p9x2m7q1za", "name": "Ada", "passcode": "optional", "mic": true, "cam": false }
{ "type": "signal", "to": "<peer-id>", "data": { "kind": "offer", "sdp": "v=0..." } }
{ "type": "signal", "to": "<peer-id>", "data": { "kind": "answer", "sdp": "v=0..." } }
{ "type": "signal", "to": "<peer-id>", "data": { "kind": "ice", "candidate": { "candidate": "...", "sdpMid": "0" } } }
{ "type": "chat", "text": "hello" }
{ "type": "state", "mic": true, "cam": true, "sharing": false, "hand": false }
{ "type": "reaction", "emoji": "👍" }
{ "type": "end_meeting" }   // host only
{ "type": "ping" }          // heartbeat every 25 s; server answers pong
{ "type": "leave" }
```

`signal.data` is opaque to the server: it validates room membership and forwards the value.
This keeps the signaling service independent of the SDP dialect and allows a future SFU
transport without changing the room layer.

## Server → client

```jsonc
{ "type": "welcome", "self_id": "...", "room": "...", "peers": [Peer], "ice_servers": [IceServer], "is_host": true, "media_token": "..." }
{ "type": "peer_joined", "peer": Peer }
{ "type": "peer_left", "peer_id": "..." }
{ "type": "signal", "from": "...", "data": { ... } }
{ "type": "chat", "from": "...", "name": "Ada", "text": "hello", "ts": 1762900000000 }
{ "type": "state", "from": "...", "mic": true, "cam": false, "sharing": true, "hand": false }
{ "type": "reaction", "from": "...", "name": "Ada", "emoji": "🎉" }
{ "type": "room_closed", "reason": "host_ended" }
{ "type": "error", "code": "room_full", "message": "Room is full." }
```

```jsonc
Peer      = { "id": "uuid", "name": "Ada", "mic": true, "cam": true, "sharing": false, "hand": false }
IceServer = { "urls": ["stun:..."], "username": "optional", "credential": "optional" }
```

Error codes: `bad_request`, `bad_message`, `already_joined`, `room_not_found`, `bad_passcode`,
`room_full`, `peer_not_found`, `rate_limited`, `not_host`.

## HTTP

| Method | Path | Meaning |
|---|---|---|
| GET | `/healthz` | `{"ok":true}` |
| GET | `/api/config` | ICE servers (ephemeral TURN credentials are minted per request) and max participants |
| POST | `/api/rooms` | `{"passcode":"optional"}` → `201 {"room_id":"...","has_passcode":false}` |
| GET | `/api/rooms/{id}` | `{"room_id","participants","max_participants","has_passcode"}` or `404` |
| GET | `/api/schedule` | Scheduled rooms for the caller (requires `x-openmeet-key`) |
| POST | `/api/schedule` | `{"title","start","duration","color"}` → `201` entry (requires the key) |
| DELETE | `/api/schedule/{id}` | `204`, `404`, or `503` when no database is configured |
| POST | `/api/livekit/token` | `{"room","identity","media_token"}` → `{"url","token"}`; `401` without membership, `503` without LiveKit |

Scheduling is backed by PostgreSQL (Neon in the reference deployment). The client sends an
opaque `x-openmeet-key` header (8–128 characters, generated per browser profile). Rows are
scoped to that key; there are no accounts. If `DATABASE_URL` is not configured the endpoints
return `503` and the client keeps the schedule locally.

Room creation is unauthenticated by design: rooms are ephemeral, hold no media, and are
reachable only by their 12-character code. Deployments that need invite control should put
an authenticating proxy in front of `POST /api/rooms` and distribute codes out of band.

## Limits (server defaults)

| Limit | Value | Override |
|---|---|---|
| Participants per room | 8 | `OPENMEET_MAX_PARTICIPANTS` |
| Name length | 64 characters | compile-time |
| Chat message | 2000 characters, 12 per 5 s per peer | compile-time |
| Room idle collection | 600 s | `OPENMEET_ROOM_IDLE_SECS` |
| Signaling frame | 64 KiB | compile-time |
