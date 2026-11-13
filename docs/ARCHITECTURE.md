# OpenMeet architecture

OpenMeet is a free, self-hostable meeting client built with Tauri 2. This document explains
what we build, how it maps onto the shipped Zoom desktop client we reverse engineered, and
where the honest limits of a webview-based shell are.

Working name: **OpenMeet** (rename freely; identifiers are `com.openmeet.desktop`, scheme
`openmeet://`).

## 1. What the Zoom artifact told us

From `zoom` 7.2.5.6661 (Linux, amd64):

| Observed in Zoom | Consequence for our design |
|---|---|
| 321 MB native monolith: WebRTC, protobuf, SQLCipher, OpenSSL/mbedTLS statically linked | Media and data paths are native, not browser-based. A webview-only client will not reach parity on capture, codecs or CPU cost. |
| Qt 6.8.9 Quick UI: 736 uncompressed QML blocks, 604 `.qml` files | The shell is fully native. We replace it with Tauri + web UI, which buys us portability and a much smaller binary. |
| CEF 150 (`libcef.so`, 231 MB) used only by `ZoomWebviewHost` for web surfaces | Heavy web embedding is isolated. Tauri's single webview is enough for the app UI; do not embed a second browser engine. |
| `UnifyWebView` bridge with 20 native APIs (`LoadLocalFile`, `ExecuteJavascript`, `GetScreenShot`, `showDevTools`, …) and per-surface policy files | The dangerous part of a hybrid app is the JS↔native surface. Tauri capabilities/IPC must be an explicit allowlist, never a wildcard. |
| Policy `NewHomePage` sets `allow_all_apis: true`, `resource`/`sub_frame` `*` | Wildcards in a shipped policy are a standing risk. Our capability file is static, reviewed, and contains no wildcards. |
| Webview origin checks still accept `http://` and `*.localhost`, and postMessage uses `targetOrigin: '*'` | Do not trust origin strings loosely. We bind the app to a fixed `tauri://localhost` origin and never enable remote content. |
| `NewHomePage` `index.html` runs `if (window.parent !== window) window.stop()` | Cheap, effective anti-framing. We do the same and add CSP `frame-ancestors 'none'`. |
| SQLCipher for local DBs, key material kept in the profile (`com.zoom.commuter.enc.key`) | At-rest encryption with a local key is integrity, not secrecy, against a local attacker. We use OS keyring when available and say so plainly. |
| Crashpad + minidump upload | Crash reporting must be opt-in. Default: off. |
| SUID `chrome_sandbox`, AppArmor profile `flags=(unconfined)` with `userns` | Sandboxing a webview is not free. We depend on the OS webview sandbox and do not ship setuid helpers. |
| No updater binary in the 922-file package | Linux updates are manual/repo-driven. We ship signed releases and an optional `openmeet://` update check, with no silent self-replacement. |
| No anti-debug layer; stripped ELF, plaintext QML | Zoom protects code volume, not secrets. Assume anything shipped is readable; keep no secrets in the client. |

The strategic conclusion: **copy the layering, not the implementation.** Zoom = native media
core + native UI shell + embedded web for content. OpenMeet v0 keeps the same layering but
swaps the native shell for Tauri and the native media core for browser WebRTC. Where that
trade-off becomes unacceptable (screen capture on Linux, large rooms, hardware codecs), the
media core moves to Rust behind the same interface.

## 2. Components

```
apps/desktop            Tauri 2 shell + React UI (TypeScript, Vite)
  src/                  UI, signaling client, WebRTC mesh transport
  src-tauri/            Rust: window/tray/deep-link, settings, SQLite history
crates/signaling        Rust signaling + room service (axum, tokio) + static web client
deploy/coturn           TURN server for NAT traversal (self-host)
```

The same Rust process serves the compiled web client when `OPENMEET_WEB_DIR` is set, so a
single binary provides both `https://host/` and `wss://host/ws`. Browser clients derive their
signaling address from the page origin; the desktop app falls back to the hosted instance and
can be pointed anywhere in Settings.

Runtime topology:

```
 desktop A ──WS(JSON)──┐
 desktop B ──WS(JSON)──┼── signaling (rooms, presence, chat relay, ICE config)
 desktop C ──WS(JSON)──┘

 A ⇄ B ⇄ C   WebRTC media (mesh, DTLS-SRTP), direct or via TURN
```

Rooms are ephemeral and hold no media. Media never touches the signaling server.

## 3. Media strategy (v0 → v1)

**v0 (this tree): LiveKit SFU, with the mesh as fallback.**
- When `LIVEKIT_URL` is configured, media (camera, microphone, screen + screen audio) is
  published to a LiveKit SFU. Signaling, chat, presence and raise-hand stay on our WebSocket;
  only the media plane moves. Tokens are minted server-side and bound to room membership.
- Without LiveKit, a mesh of `RTCPeerConnection`s with perfect negotiation is used.
- Camera/mic captured with `getUserMedia`, screen with `getDisplayMedia`.
- Practical room size: 1:1 to ~6 participants; upload bandwidth and CPU grow linearly.
- Works today on Windows (WebView2), macOS (WKWebView), Linux (WebKitGTK) for camera/mic.

**Known gap:** WebKitGTK does not expose `getDisplayMedia` on most distributions. The UI
detects this and tells the user instead of failing silently. This is the single largest
parity gap of a webview-only client and the reason for v1.

**v1: native media core (Rust).**
- Keep `MeshTransport` behind `MeetingTransport` and add `LiveKitTransport` backed by the
  LiveKit Rust SDK (`livekit` crate, Apache-2.0), self-hosted `livekit-server`.
- Move capture to Rust (`pipewire`/`xcap` on Linux, `scap` on macOS/Windows) and feed frames
  into the SDK as a custom video source. Screen share then works everywhere and survives
  webview limitations.
- Add simulcast, SVC, hardware encoders, and an SFU for rooms > 8.
- Browser WebRTC stays as a fallback for unsupported hosts.

**Codecs and licensing.** Opus, VP8, VP9 and AV1 are royalty-free and available in WebRTC.
H.264 is not free to implement or distribute; keep it optional and off by default in the
native path. This is a legal constraint, not a technical preference.

## 4. Security model

- **No remote content.** The window loads only bundled assets. No remote URL is ever loaded
  into the app webview; external links go through `opener` to the system browser.
- **Capabilities are static and minimal** (`src-tauri/capabilities/default.json`): core
  window/event, `opener:default`, `notification:default`, `deep-link:default`. No shell, no
  filesystem, no HTTP plugin.
- **CSP** in `tauri.conf.json`: `default-src 'self'`; `connect-src` limited to the configured
  signaling origin plus TURN/STUN endpoints are not affected by CSP (they are not HTTP
  fetches). `frame-ancestors 'none'`, `object-src 'none'`.
- **IPC**: commands take typed arguments; no command accepts a path or URL from the page
  except `open_external` (validated `https:`/`mailto:` only). Settings and history are
  written to the app data directory with server-side validation.
- **Rooms**: 12-character base36 codes (~62 bits) plus optional passcode. Passcodes are
  hashed (SHA-256 + salt) and compared in constant time; failures are rate limited per
  connection.
- **Transport**: WSS in production (terminate TLS at a reverse proxy), DTLS-SRTP for media.
  Self-hosted TURN with short-lived credentials is the recommended NAT path; public STUN is
  the default for LAN/dev only.
- **No telemetry.** Crash reporting and analytics are absent by default. If added later, they
  must be opt-in and documented.

## 5. Data on disk

| Data | Where | Protection |
|---|---|---|
| UI settings (name, devices, server URL) | `settings.json` in app config dir | file permissions (0600) |
| Meeting history | SQLite `history.db` (rusqlite, bundled) | file permissions; no tokens stored |
| Scheduled rooms | PostgreSQL (Neon), `openmeet_schedule` | rows scoped by an opaque per-profile key; no PII |
| Room passcodes | signaling server memory only | SHA-256 hash, never logged |
| Media | never persisted | — |

We deliberately do not store OAuth client secrets or refresh tokens, unlike the shipped Zoom
schema we observed. If account login is added later, tokens go to the OS keyring, never to a
plaintext SQLite column.

## 6. Parity roadmap

| Capability | v0 | v1 | v2 |
|---|---|---|---|
| Create/join room by code | yes | yes | yes |
| Camera/mic, mute, device picker | yes | yes | yes |
| Screen share | browser capture + system audio where supported | native capture, all OS | + window/region picker |
| Chat, presence, reactions, raise hand | yes (WS relay) | yes (data channel) | + history, threads |
| Grid/gallery + active speaker | grid | speaking detection | + pin/spotlight, pagination |
| Recording | local `.webm` (your mic + camera/screen) | mixed local capture, both sides | + server-side, consent flow |
| Large rooms | mesh ≤ 6; LiveKit SFU (25 configured) | cascaded SFU | 500+ |
| Breakout rooms, polls, whiteboard | no | — | roadmap |
| E2EE | DTLS-SRTP only | insertable streams | + per-room keys, verification |
| Auth / SSO | no (link-based) | optional OIDC | + SCIM |
| Updates | manual/signed packages | repo + signed manifest | delta updates |

## 7. Why Tauri 2

- Small binary and low idle memory compared to an Electron/CEF shell; no bundled browser.
- Rust backend for capture, storage and networking, matching Zoom's native-core layering.
- First-class capabilities model for the JS↔native boundary, which is exactly where the
  Zoom artifact showed the most risk.
- Ships for Windows, macOS and Linux from one UI codebase.

Cost: platform webviews differ (WebView2/WKWebView/WebKitGTK). Media features must be probed,
never assumed. That is why every capability check in the UI is runtime, not build-time.
