# Deploying OpenMeet

Two services plus an optional TURN relay. Media is peer-to-peer in v0; the server only
coordinates rooms and relays small messages.

```
clients ──wss──> reverse proxy ──> openmeet-signaling :8770
clients ──udp──> coturn :3478 + 49160-49200   (only when NAT traversal is needed)
```

## 1. Signaling server and web client

One binary serves both the API/WebSocket and the static web client.

```bash
cargo build --release -p openmeet-signaling
sudo install -m 0755 target/release/openmeet-signaling /usr/local/bin/

cd apps/desktop
npm ci
npm run build
sudo mkdir -p /opt/openmeet/web
sudo rsync -a --delete dist/ /opt/openmeet/web/
```

`/etc/systemd/system/openmeet-signaling.service`:

```ini
[Unit]
Description=OpenMeet signaling and web client
After=network-online.target

[Service]
User=openmeet
Group=openmeet
EnvironmentFile=-/etc/openmeet/openmeet.env
Environment=OPENMEET_BIND=127.0.0.1:8770
Environment=OPENMEET_WEB_DIR=/opt/openmeet/web
Environment=OPENMEET_MAX_PARTICIPANTS=8
Environment=OPENMEET_ICE=stun:stun.openmeet.example:3478
Environment=OPENMEET_TURN_URLS=turn:turn.openmeet.example:3478?transport=udp,turn:turn.openmeet.example:3478?transport=tcp
Environment=OPENMEET_TURN_SECRET=replace-with-the-coturn-secret
Environment=RUST_LOG=info
ExecStart=/usr/local/bin/openmeet-signaling
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

The web client derives its signaling address from the page origin, so `https://meet.example`
automatically uses `wss://meet.example/ws`. Users can still point the desktop app at any
server in Settings.

Bind to loopback and terminate TLS at the proxy. Both `/ws` and `/api/*` must reach the
same process.

Caddy:

```caddyfile
meet.example {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8770
}
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name meet.example;
    # ssl_certificate ...;

    location / {
        proxy_pass http://127.0.0.1:8770;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

Do not enable proxy buffering on `/ws`; the room is long-lived. The client sends a
`ping` every 25 seconds so proxies and tunnels do not collect an idle socket.

### Cloudflare Tunnel

```bash
cloudflared tunnel route dns <tunnel-name> meet.example
```

`/etc/cloudflared/config.yml`:

```yaml
ingress:
  - hostname: meet.example
    service: http://127.0.0.1:8770
  - service: http_status:404
```

Cloudflare proxies WebSockets without extra configuration. Keep the heartbeat enabled; it
is what prevents idle WebSocket collection on the edge.

## 2. Scheduling database (Neon Postgres)

Scheduling is optional. Without a database the client stores the schedule in the browser and
the API returns `503`; rooms still work.

Create a Neon project, copy the **pooled** connection string, and put it in
`/etc/openmeet/openmeet.env`:

```bash
sudo install -d -m 0750 /etc/openmeet
sudo tee /etc/openmeet/openmeet.env >/dev/null <<'EOF'
DATABASE_URL=postgresql://openmeet:password@ep-xxx-pooler.eu-central-1.aws.neon.tech/openmeet?sslmode=require
EOF
sudo chmod 0600 /etc/openmeet/openmeet.env
sudo systemctl restart openmeet-signaling
```

The service creates this table on startup:

```sql
CREATE TABLE openmeet_schedule (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  start_ms BIGINT NOT NULL,
  duration_min INTEGER NOT NULL,
  room TEXT NOT NULL,
  color TEXT NOT NULL,
  created_ms BIGINT NOT NULL
);
```

Rows are scoped by an opaque `x-openmeet-key` header generated per browser profile, so a
shared deployment does not leak one user's schedule to another. The key is a bearer secret:
anyone who has it can read and delete that schedule.

Neon notes:

- Use the pooled endpoint (`-pooler`) for serverless-friendly connection handling.
- Keep `sslmode=require`; `disable` will be rejected by Neon.
- The binary connects lazily at startup and logs `schedule database connected`. If the
  database is unreachable, the API degrades to `503` and clients fall back to local storage.
- Check `GET /healthz`; it reports `"schedule": true|false`.

## 3. LiveKit SFU (optional but recommended)

Media falls back to a peer-to-peer mesh when LiveKit is not configured. For rooms larger than
6–8, create a LiveKit Cloud project (or self-host `livekit-server`) and add:

```bash
cat <<'EOF' | sudo tee -a /etc/openmeet/openmeet.env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF
sudo systemctl restart openmeet-signaling
```

- The API secret stays on the server; browsers receive a short-lived JWT minted by
  `POST /api/livekit/token`.
- Tokens are only issued to a peer that already proved room membership (`media_token` from the
  signaling `welcome`), so the endpoint cannot be used to mint tokens for arbitrary rooms.
- `GET /healthz` reports `"livekit": true|false`; the room header shows `SFU` or `P2P`.
- With SFU enabled you can raise `OPENMEET_MAX_PARTICIPANTS` (25 on the reference instance).
- Self-hosting: point `LIVEKIT_URL` at your `wss://` endpoint and keep the same key/secret pair
  that `livekit-server` uses.

TURN is still useful for mesh fallback and for clients that cannot reach the SFU over UDP;
configure both when possible.

## 4. TURN (NAT traversal)

Most home networks need a relay for at least some participants. coturn is free and packaged
everywhere.

```bash
cd deploy/coturn
cp .env.example .env      # set TURN_SECRET, EXTERNAL_IP, TURN_REALM
docker compose up -d
```

Open the firewall:

| Port | Protocol | Purpose |
|---|---|---|
| 3478 | UDP + TCP | TURN/STUN |
| 49160–49200 | UDP | relayed media |
| 80/443 | TCP | app and signaling |

Then set on the signaling server:

```
OPENMEET_TURN_URLS=turn:turn.example:3478?transport=udp,turn:turn.example:3478?transport=tcp
OPENMEET_TURN_SECRET=<same value as coturn --static-auth-secret>
```

The signaling server mints short-lived TURN credentials (username = expiry, credential =
base64 HMAC-SHA1 of the secret). Nothing long-lived is shipped to clients, and the secret
never leaves the server.

## 5. Desktop distribution

```bash
cd apps/desktop
npm ci
npm run tauri build
```

Outputs:

- Linux: `.deb`, `.rpm`, `.AppImage` in `src-tauri/target/release/bundle/`
- macOS: `.app`, `.dmg`
- Windows: `.msi`, `.exe`

Set the signaling address before distributing, either by editing the default in
`src/lib/platform.ts` (`defaultSettings.serverUrl`) or by letting users set it on first run.
For managed fleets, pre-seed `settings.json` in the app config directory
(`~/.config/com.openmeet.desktop/settings.json` on Linux).

## 6. Capacity

The server keeps rooms in memory and forwards JSON messages. Each participant sends SDP/ICE
only at join and on renegotiation; chat is rate limited per peer. A single core handles
thousands of idle rooms. The real limit is mesh bandwidth on the clients: plan for ≤ 6
participants per room until the SFU transport lands (see `docs/ARCHITECTURE.md`).

## 7. Operations

- Health: `curl -fsS https://meet.example/healthz`
- Logs: structured `tracing` output on stdout; set `RUST_LOG=debug` while diagnosing.
- Rooms are ephemeral and disappear when empty (10 minutes idle by default). Nothing is
  persisted server-side; there is no database to back up.
- Upgrade: replace the binary and restart. Existing calls drop; clients rejoin with the same
  room code.
