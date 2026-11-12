import type { IceServer, SignalData } from "../types";

export type RemoteTrackState = {
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  connection: RTCPeerConnectionState;
};

type Conn = {
  pc: RTCPeerConnection;
  polite: boolean;
  ready: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  camSender: RTCRtpSender | null;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  remoteCamStreamId: string | null;
};

type Events = {
  onRemote: (peerId: string, state: RemoteTrackState) => void;
  onSignal: (to: string, data: SignalData) => void;
  onError: (message: string) => void;
};

/**
 * Mesh WebRTC transport with perfect negotiation.
 *
 * Topology: every participant holds one RTCPeerConnection per other participant.
 * The peer already in the room is the impolite initiator; the joiner is polite.
 * Either side may renegotiate later (screen share), which perfect negotiation resolves.
 */
export class MeshTransport {
  private conns = new Map<string, Conn>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  constructor(
    private readonly iceServers: IceServer[],
    private readonly events: Events,
  ) {}

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
  }

  createPeer(peerId: string, polite: boolean, ready = true) {
    if (this.conns.has(peerId)) return this.conns.get(peerId)!;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      })),
      bundlePolicy: "max-bundle",
    });

    const conn: Conn = {
      pc,
      polite,
      ready,
      makingOffer: false,
      ignoreOffer: false,
      camStream: null,
      screenStream: null,
      camSender: null,
      micSender: null,
      screenSender: null,
      screenAudioSender: null,
      remoteCamStreamId: null,
    };
    this.conns.set(peerId, conn);

    pc.onnegotiationneeded = async () => {
      if (!conn.ready || pc.signalingState !== "stable") return;
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.events.onSignal(peerId, { kind: "offer", sdp: pc.localDescription.sdp });
        }
      } catch (err) {
        if (pc.connectionState !== "closed") {
          this.events.onError(err instanceof Error ? err.message : "Could not create an offer.");
        }
      } finally {
        conn.makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      this.events.onSignal(peerId, {
        kind: "ice",
        candidate: event.candidate ? event.candidate.toJSON() : null,
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      if (!conn.remoteCamStreamId) conn.remoteCamStreamId = stream.id;
      if (stream.id === conn.remoteCamStreamId) {
        conn.camStream = stream;
      } else {
        conn.screenStream = stream;
      }
      event.track.addEventListener("ended", () => {
        if (
          conn.screenStream === stream &&
          stream.getVideoTracks().every((track) => track.readyState === "ended")
        ) {
          conn.screenStream = null;
        }
        this.emit(peerId, conn);
      });
      this.emit(peerId, conn);
    };

    pc.onconnectionstatechange = () => {
      this.emit(peerId, conn);
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch {
          // Older webviews may not implement restartIce.
        }
      }
    };

    this.attachLocal(conn);
    return conn;
  }

  private attachLocal(conn: Conn) {
    const stream = this.localStream;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      if (track.kind === "audio") {
        if (conn.micSender) {
          void conn.micSender.replaceTrack(track);
        } else {
          conn.micSender = conn.pc.addTrack(track, stream);
        }
      } else if (track.kind === "video") {
        if (conn.camSender) {
          void conn.camSender.replaceTrack(track);
        } else {
          conn.camSender = conn.pc.addTrack(track, stream);
        }
      }
    }
    this.attachScreen(conn);
  }

  private attachScreen(conn: Conn) {
    const screen = this.screenStream;
    if (!screen) return;
    const video = screen.getVideoTracks()[0];
    if (video && !conn.screenSender) conn.screenSender = conn.pc.addTrack(video, screen);
    const audio = screen.getAudioTracks()[0];
    if (audio && !conn.screenAudioSender) conn.screenAudioSender = conn.pc.addTrack(audio, screen);
  }

  replaceLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
    if (!stream) return;
    for (const conn of this.conns.values()) this.attachLocal(conn);
  }

  async handleSignal(from: string, data: SignalData) {
    const conn = this.conns.get(from) ?? this.createPeer(from, true, false);
    const pc = conn.pc;
    try {
      if (data.kind === "offer" || data.kind === "answer") {
        const description: RTCSessionDescriptionInit = { type: data.kind, sdp: data.sdp };
        const collision =
          data.kind === "offer" && (conn.makingOffer || pc.signalingState !== "stable");
        conn.ignoreOffer = !conn.polite && collision;
        if (conn.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        conn.ready = true;
        if (data.kind === "offer") {
          await pc.setLocalDescription();
          conn.ready = true;
          if (pc.localDescription) {
            this.events.onSignal(from, { kind: "answer", sdp: pc.localDescription.sdp });
          }
        }
      } else if (data.kind === "ice" && data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!conn.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      if (pc.signalingState !== "closed") {
        this.events.onError(err instanceof Error ? err.message : "Negotiation failed.");
      }
    }
  }

  startScreenShare(stream: MediaStream) {
    this.screenStream = stream;
    for (const conn of this.conns.values()) this.attachScreen(conn);
  }

  stopScreenShare() {
    this.screenStream = null;
    for (const conn of this.conns.values()) {
      for (const sender of [conn.screenSender, conn.screenAudioSender]) {
        if (!sender) continue;
        try {
          conn.pc.removeTrack(sender);
        } catch {
          // Connection already closed.
        }
      }
      conn.screenSender = null;
      conn.screenAudioSender = null;
    }
  }

  closePeer(peerId: string) {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    try {
      conn.pc.close();
    } catch {
      // ignore
    }
    this.conns.delete(peerId);
  }

  closeAll() {
    for (const id of [...this.conns.keys()]) this.closePeer(id);
    this.localStream = null;
    this.screenStream = null;
  }

  private emit(peerId: string, conn: Conn) {
    this.events.onRemote(peerId, {
      camStream: conn.camStream,
      screenStream: conn.screenStream,
      connection: conn.pc.connectionState,
    });
  }
}
