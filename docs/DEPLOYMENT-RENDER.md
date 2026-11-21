# Deploying the backend on Render

Render can host the signaling service (and the web client) while Neon keeps the schedule and
LiveKit carries media. The VPS then only needs to exist if you want TURN or the tunnel.

## Blueprint (one click)

The repository ships [`render.yaml`](../render.yaml) and a multi-stage [`Dockerfile`](../Dockerfile).

1. Push this repository to GitHub.
2. Render dashboard → **New +** → **Blueprint** → select the repo.
3. Render reads `render.yaml` and asks for the secret env vars:
   - `DATABASE_URL` — Neon pooled connection string (`...-pooler...?sslmode=require`)
   - `LIVEKIT_URL` — `wss://<project>.livekit.cloud`
   - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
4. **Apply**. The first Docker build takes a few minutes (Rust release build).
5. Open the service URL + `/healthz`; it should report:

   ```json
   {"ok":true,"schedule":true,"livekit":true}
   ```

The same process serves the web client at `/`, so browsers derive the signaling URL from the
page origin automatically.

### Manual service instead of a Blueprint

- New → **Web Service** → connect the repo → Runtime **Docker**
- Health check path: `/healthz`
- Add the same env vars
- No disk, no build command; the image entrypoint starts the server

The server honours Render's `PORT`; `OPENMEET_BIND` remains for systemd/VPS installs.

## Custom domain

1. Render service → Settings → Custom Domains → add `openmeet.example`.
2. In Cloudflare DNS create a **proxied CNAME** to the `*.onrender.com` host Render shows.
3. If the old cloudflared ingress still lists that hostname, remove it (or keep the tunnel as a
   fallback on a different hostname).
4. Verify `https://openmeet.example/healthz` and a WSS join from two browsers.

WebSockets work through Cloudflare and Render without extra configuration; the client sends a
25-second heartbeat so idle sockets are not dropped.

## Caveats

- **Free plan sleeps** after ~15 minutes without traffic. The first request (and the first
  WebSocket) can take 30–60 seconds. Use a paid always-on instance for production.
- **Run one instance.** Rooms are in memory; scaling to multiple instances would split rooms.
  Add a shared room registry before scaling horizontally.
- **No UDP/TURN.** Render does not expose arbitrary UDP ports, so coturn cannot run there.
  LiveKit SFU covers media; mesh fallback should stay on networks with direct connectivity or
  use LiveKit's TURN.
- **No persistent disk needed**: schedule data is in Neon, recordings are local to each client,
  and history lives on the device.
- Set the service to auto-deploy from `main` (already in `render.yaml`).

## Moving off the VPS

1. Deploy on Render and verify `healthz`, room creation, and a two-peer call.
2. Repoint the domain (Cloudflare CNAME) to Render.
3. Keep the old `openmeet-signaling` service and cloudflared stopped but installed for a quick
   rollback; `systemctl disable --now openmeet-signaling cloudflared` when confident.
