# Security policy

OpenMeet handles live audio, video and screen content. Please report vulnerabilities privately.

- Email: security@openmeet.example (replace with your project address before publishing)
- Or open a private security advisory on the repository hosting service.
- Please include: affected version, platform, reproduction steps, and impact.

We aim to acknowledge within 72 hours and to ship a fix or mitigation within 30 days for
confirmed issues. Please do not open public issues for exploitable bugs.

## Scope notes

- The desktop app is a Tauri shell; the attack surface includes the IPC commands, the
  webview content policy, and the signaling protocol parser.
- The signaling server terminates untrusted WebSocket input. Reports about panics, unbounded
  memory growth, room takeover, or authorization bypass are in scope.
- Mesh media is peer-to-peer DTLS-SRTP; there is no central media server in v0. Reports about
  SDP injection or peer impersonation are in scope.
- Social engineering and denial of service through sheer call volume are out of scope unless
  they bypass an enforced limit.

## Hardening expectations

- The app never loads remote content into the app webview.
- Capabilities are static; no shell or arbitrary filesystem access is granted to the page.
- Room passcodes are hashed in memory and rate limited; they are never logged.
- No telemetry is sent by default.
