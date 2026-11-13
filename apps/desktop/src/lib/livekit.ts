import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

export type SfuRemoteState = {
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  connection: RTCPeerConnectionState;
};

type Callbacks = {
  onRemote: (identity: string, state: SfuRemoteState) => void;
  onLocalScreen: (stream: MediaStream | null) => void;
  onError: (message: string) => void;
};

/**
 * Media plane backed by a LiveKit SFU. Signaling (rooms, chat, presence, hand)
 * still travels over the OpenMeet WebSocket; only audio/video/screen moves here.
 */
export class LiveKitMedia {
  private room = new Room({ adaptiveStream: true, dynacast: true });
  private streams = new Map<string, { cam?: MediaStream; screen?: MediaStream }>();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly callbacks: Callbacks,
  ) {}

  async connect(localStream: MediaStream | null) {
    this.room
      .on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.streams.delete(participant.identity);
        this.emit(participant.identity);
      })
      .on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
        if (
          publication.source === Track.Source.ScreenShare ||
          publication.source === Track.Source.ScreenShareAudio
        ) {
          this.rebuildLocalScreen();
        }
      })
      .on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          this.rebuildLocalScreen();
        }
      })
      .on(RoomEvent.Disconnected, () => {
        if (!this.closed) this.callbacks.onError("The media server disconnected.");
      });

    await this.room.connect(this.url, this.token);

    if (localStream) {
      for (const track of localStream.getTracks()) {
        await this.room.localParticipant.publishTrack(track, {
          source: track.kind === "audio" ? Track.Source.Microphone : Track.Source.Camera,
        });
      }
    }
  }

  private emit(identity: string) {
    const entry = this.streams.get(identity);
    this.callbacks.onRemote(identity, {
      camStream: entry?.cam ?? null,
      screenStream: entry?.screen ?? null,
      connection: entry?.cam || entry?.screen ? "connected" : "new",
    });
  }

  private onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    const identity = participant.identity;
    const entry = this.streams.get(identity) ?? {};
    const isScreen =
      publication.source === Track.Source.ScreenShare ||
      publication.source === Track.Source.ScreenShareAudio;

    if (isScreen) {
      entry.screen = entry.screen ?? new MediaStream();
      entry.screen.addTrack(track.mediaStreamTrack);
    } else {
      entry.cam = entry.cam ?? new MediaStream();
      entry.cam.addTrack(track.mediaStreamTrack);
    }
    this.streams.set(identity, entry);
    this.emit(identity);
  };

  private onTrackUnsubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    const identity = participant.identity;
    const entry = this.streams.get(identity);
    if (!entry) return;
    const isScreen =
      publication.source === Track.Source.ScreenShare ||
      publication.source === Track.Source.ScreenShareAudio;
    const stream = isScreen ? entry.screen : entry.cam;
    if (stream) {
      stream.removeTrack(track.mediaStreamTrack);
      if (stream.getTracks().length === 0) {
        if (isScreen) entry.screen = undefined;
        else entry.cam = undefined;
      }
    }
    this.emit(identity);
  };

  private rebuildLocalScreen() {
    const video = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
    const audio = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
      ?.track;
    if (!video) {
      this.callbacks.onLocalScreen(null);
      return;
    }
    const tracks = [video.mediaStreamTrack, audio?.mediaStreamTrack].filter(
      (track): track is MediaStreamTrack => Boolean(track),
    );
    this.callbacks.onLocalScreen(new MediaStream(tracks));
  }

  /** Replaces a published microphone/camera track after a device switch. */
  async replaceTrack(kind: "audio" | "video", track: MediaStreamTrack) {
    const source = kind === "audio" ? Track.Source.Microphone : Track.Source.Camera;
    const existing = this.room.localParticipant.getTrackPublication(source)?.track;
    if (existing) {
      await this.room.localParticipant.unpublishTrack(existing, true);
    }
    await this.room.localParticipant.publishTrack(track, { source });
  }

  async startScreenShare(): Promise<boolean> {
    const publication = await this.room.localParticipant.setScreenShareEnabled(true, {
      audio: true,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    });
    this.rebuildLocalScreen();
    return Boolean(publication);
  }

  async stopScreenShare() {
    await this.room.localParticipant.setScreenShareEnabled(false);
    this.callbacks.onLocalScreen(null);
  }

  async disconnect() {
    this.closed = true;
    try {
      this.room.disconnect();
    } catch {
      // Already gone.
    }
  }
}
