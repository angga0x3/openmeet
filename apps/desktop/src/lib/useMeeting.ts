import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  HistoryEntry,
  IceServer,
  Peer,
  ReactionEvent,
  RemoteView,
} from "../types";
import { MeshTransport } from "./webrtc";
import type { LiveKitMedia } from "./livekit";
import { SignalClient, fetchIceServers } from "./signaling";
import { httpBase } from "../types";
import { addHistory, notify } from "./platform";

export type Phase = "idle" | "joining" | "live" | "ended";

export type JoinArgs = {
  serverUrl: string;
  room: string;
  name: string;
  passcode?: string;
  mic: boolean;
  cam: boolean;
  cameraId?: string;
  micId?: string;
  noiseSuppression?: boolean;
};

const FALLBACK_ICE: IceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

function audioConstraints(micId?: string, noiseSuppression = true): MediaTrackConstraints {
  return {
    ...(micId ? { deviceId: { exact: micId } } : {}),
    echoCancellation: true,
    noiseSuppression,
    autoGainControl: true,
  };
}

function mediaConstraints(args: JoinArgs): MediaStreamConstraints {
  return {
    audio: audioConstraints(args.micId, args.noiseSuppression !== false),
    video: args.cameraId
      ? { deviceId: { exact: args.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } },
  };
}

async function acquireMedia(args: JoinArgs): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia(mediaConstraints(args));
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return null;
    }
  }
}

export function useMeeting() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [room, setRoom] = useState("");
  const [selfId, setSelfId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState<Record<string, Peer>>({});
  const [remotes, setRemotes] = useState<Record<string, RemoteView>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handOn, setHandOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const signalRef = useRef<SignalClient | null>(null);
  const meshRef = useRef<MeshTransport | null>(null);
  const sfuRef = useRef<LiveKitMedia | null>(null);
  const transportRef = useRef<"pending" | "sfu" | "mesh">("mesh");
  const livekitUrlRef = useRef<string | null>(null);
  const [transport, setTransport] = useState<"sfu" | "mesh">("mesh");
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const selfIdRef = useRef("");
  const roomRef = useRef("");
  const peersRef = useRef<Record<string, Peer>>({});
  const micRef = useRef(false);
  const camRef = useRef(false);
  const sharingRef = useRef(false);
  const handRef = useRef(false);
  const noiseRef = useRef(true);
  const startedRef = useRef<number | null>(null);
  const countedRef = useRef(0);
  const recordedRef = useRef(false);
  const fatalRef = useRef(false);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const setMic = useCallback((value: boolean) => {
    micRef.current = value;
    setMicOn(value);
    setParticipants((prev) => {
      const self = prev[selfIdRef.current];
      if (!self) return prev;
      return { ...prev, [self.id]: { ...self, mic: value } };
    });
  }, []);

  const setCam = useCallback((value: boolean) => {
    camRef.current = value;
    setCamOn(value);
    setParticipants((prev) => {
      const self = prev[selfIdRef.current];
      if (!self) return prev;
      return { ...prev, [self.id]: { ...self, cam: value } };
    });
  }, []);

  const setSharingState = useCallback((value: boolean) => {
    sharingRef.current = value;
    setSharing(value);
    setParticipants((prev) => {
      const self = prev[selfIdRef.current];
      if (!self) return prev;
      return { ...prev, [self.id]: { ...self, sharing: value } };
    });
  }, []);

  const setHand = useCallback((value: boolean) => {
    handRef.current = value;
    setHandOn(value);
    setParticipants((prev) => {
      const self = prev[selfIdRef.current];
      if (!self) return prev;
      return { ...prev, [self.id]: { ...self, hand: value } };
    });
  }, []);

  const stopLocalMedia = useCallback(() => {
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    setLocalStream(null);
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setScreenStream(null);
  }, []);

  const cleanup = useCallback(
    (record: boolean) => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      meshRef.current?.closeAll();
      meshRef.current = null;
      if (sfuRef.current) {
        void sfuRef.current.disconnect();
        sfuRef.current = null;
      }
      transportRef.current = "mesh";
      setTransport("mesh");
      stopLocalMedia();

      if (record && startedRef.current && !recordedRef.current) {
        recordedRef.current = true;
        const durationSecs = Math.round((Date.now() - startedRef.current) / 1000);
        if (durationSecs >= 5) {
          const entry: HistoryEntry = {
            room: roomRef.current,
            startedAt: startedRef.current,
            durationSecs,
            participants: Math.max(1, countedRef.current),
          };
          void addHistory(entry);
        }
      }
    },
    [stopLocalMedia],
  );

  const reset = useCallback(() => {
    signalRef.current?.leave();
    signalRef.current = null;
    cleanup(true);
    setPhase("idle");
    setParticipants({});
    setRemotes({});
    setMessages([]);
    setReactions([]);
    setSelfId("");
    setIsHost(false);
    setRoom("");
    setStartedAt(null);
    setMic(false);
    setCam(false);
    setSharingState(false);
    setHand(false);
    selfIdRef.current = "";
    peersRef.current = {};
    startedRef.current = null;
    countedRef.current = 0;
    recordedRef.current = false;
    fatalRef.current = false;
  }, [cleanup, setCam, setMic, setSharingState]);

  const upsertRemote = useCallback((peerId: string, patch: Partial<RemoteView>) => {
    setRemotes((prev) => {
      const current: RemoteView = prev[peerId] ?? {
        peer: { id: peerId, name: "", mic: false, cam: false, sharing: false },
        camStream: null,
        screenStream: null,
        connection: "new",
      };
      return { ...prev, [peerId]: { ...current, ...patch } };
    });
  }, []);

  const join = useCallback(
    async (args: JoinArgs) => {
      if (phase === "joining" || phase === "live") return;
      setError(null);
      setNotice(null);
      setMessages([]);
      setReactions([]);
      setRemotes({});
      setParticipants({});
      recordedRef.current = false;
      fatalRef.current = false;
      setPhase("joining");

      const stream = await acquireMedia(args);
      localRef.current = stream;
      setLocalStream(stream);
      stream?.getAudioTracks().forEach((track) => (track.enabled = args.mic));
      stream?.getVideoTracks().forEach((track) => (track.enabled = args.cam));
      micRef.current = args.mic;
      camRef.current = args.cam;
      noiseRef.current = args.noiseSuppression !== false;
      setMicOn(args.mic);
      setCamOn(args.cam);
      setSharingState(false);
      setHand(false);

      let ice = FALLBACK_ICE;
      try {
        const config = await fetchIceServers(args.serverUrl);
        if (config.ice_servers.length > 0) ice = config.ice_servers;
        livekitUrlRef.current = config.livekit_url ?? null;
      } catch {
        // Fall back to the public STUN server.
      }

      const signal = new SignalClient({
        serverUrl: args.serverUrl,
        room: args.room,
        name: args.name,
        passcode: args.passcode,
        mic: args.mic,
        cam: args.cam,
      });

      const mesh = new MeshTransport(ice, {
        onRemote: (peerId, state) => {
          setRemotes((prev) => {
            const current = prev[peerId];
            if (!current) return prev;
            return {
              ...prev,
              [peerId]: {
                ...current,
                camStream: state.camStream,
                screenStream: state.screenStream,
                connection: state.connection,
              },
            };
          });
        },
        onSignal: (to, data) => signal.signal(to, data),
        onError: (message) => setError(message),
      });
      mesh.setLocalStream(stream);

      signal.on("welcome", (message) => {
        selfIdRef.current = message.self_id;
        roomRef.current = message.room;
        countedRef.current = message.peers.length + 1;
        startedRef.current = Date.now();
        setSelfId(message.self_id);
        setIsHost(message.is_host);
        setRoom(message.room);
        setStartedAt(startedRef.current);

        const map: Record<string, Peer> = {
          [message.self_id]: {
            id: message.self_id,
            name: args.name,
            mic: args.mic,
            cam: args.cam,
            sharing: false,
            hand: false,
          },
        };
        for (const peer of message.peers) map[peer.id] = peer;
        peersRef.current = map;
        setParticipants(map);

        setRemotes(
          Object.fromEntries(
            message.peers.map((peer) => [
              peer.id,
              {
                peer,
                camStream: null,
                screenStream: null,
                connection: "new" as RTCPeerConnectionState,
              },
            ]),
          ),
        );

        setPhase("live");
        transportRef.current = "pending";

        const startTransport = async () => {
          const url = livekitUrlRef.current;
          if (url && message.media_token) {
            try {
              const { LiveKitMedia: Sfu } = await import("./livekit");
              const response = await fetch(`${httpBase(args.serverUrl)}/api/livekit/token`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  room: message.room,
                  identity: message.self_id,
                  media_token: message.media_token,
                }),
              });
              if (!response.ok) throw new Error(`token ${response.status}`);
              const grant = (await response.json()) as { url: string; token: string };
              const sfu = new Sfu(grant.url, grant.token, {
                onRemote: (identity, state) => {
                  setRemotes((prev) => {
                    const current = prev[identity];
                    if (!current) return prev;
                    return {
                      ...prev,
                      [identity]: {
                        ...current,
                        camStream: state.camStream,
                        screenStream: state.screenStream,
                        connection: state.connection,
                      },
                    };
                  });
                },
                onLocalScreen: (stream) => {
                  screenRef.current = stream;
                  setScreenStream(stream);
                  if (!stream && sharingRef.current) {
                    setSharingState(false);
                    signalRef.current?.state(
                      micRef.current,
                      camRef.current,
                      false,
                      handRef.current,
                    );
                  }
                },
                onError: (text) => setError(text),
              });
              await sfu.connect(stream);
              sfuRef.current = sfu;
              transportRef.current = "sfu";
              setTransport("sfu");
              return;
            } catch {
              // Fall through to the peer-to-peer mesh.
            }
          }
          transportRef.current = "mesh";
          setTransport("mesh");
          for (const peer of Object.values(peersRef.current)) {
            if (peer.id === message.self_id) continue;
            mesh.createPeer(peer.id, true, false);
          }
        };
        void startTransport();
      });

      signal.on("peer_joined", (message) => {
        const peer = message.peer;
        countedRef.current = Math.max(countedRef.current, Object.keys(peersRef.current).length + 1);
        peersRef.current = { ...peersRef.current, [peer.id]: peer };
        setParticipants((prev) => ({ ...prev, [peer.id]: peer }));
        upsertRemote(peer.id, { peer });
        if (transportRef.current === "mesh") mesh.createPeer(peer.id, false, true);
        void notify("Participant joined", `${peer.name} joined the meeting`);
      });

      signal.on("peer_left", (message) => {
        mesh.closePeer(message.peer_id);
        setParticipants((prev) => {
          const next = { ...prev };
          delete next[message.peer_id];
          return next;
        });
        setRemotes((prev) => {
          const next = { ...prev };
          delete next[message.peer_id];
          return next;
        });
      });

      signal.on("signal", (message) => {
        if (transportRef.current === "mesh") void mesh.handleSignal(message.from, message.data);
      });

      signal.on("chat", (message) => {
        const self = message.from === selfIdRef.current;
        const entry: ChatMessage = {
          id: `${message.from}-${message.ts}-${Math.random().toString(36).slice(2, 7)}`,
          from: message.from,
          name: message.name,
          text: message.text,
          ts: message.ts,
          self,
        };
        setMessages((prev) => [...prev.slice(-499), entry]);
        if (!self) void notify(message.name, message.text);
      });

      signal.on("state", (message) => {
        peersRef.current = {
          ...peersRef.current,
          [message.from]: {
            ...(peersRef.current[message.from] ?? {
              id: message.from,
              name: "",
            }),
            mic: message.mic,
            cam: message.cam,
            sharing: message.sharing,
            hand: message.hand,
          },
        } as Record<string, Peer>;
        setParticipants((prev) => {
          const current = prev[message.from];
          if (!current) return prev;
          return {
            ...prev,
            [message.from]: {
              ...current,
              mic: message.mic,
              cam: message.cam,
              sharing: message.sharing,
              hand: message.hand,
            },
          };
        });
        setRemotes((prev) => {
          const current = prev[message.from];
          if (!current) return prev;
          return {
            ...prev,
            [message.from]: {
              ...current,
              peer: {
                ...current.peer,
                mic: message.mic,
                cam: message.cam,
                sharing: message.sharing,
                hand: message.hand,
              },
            },
          };
        });
      });

      signal.on("reaction", (message) => {
        const entry: ReactionEvent = {
          id: `${message.from}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: message.from,
          name: message.name,
          emoji: message.emoji,
        };
        setReactions((prev) => [...prev.slice(-8), entry]);
        const timer = setTimeout(() => {
          setReactions((prev) => prev.filter((item) => item.id !== entry.id));
        }, 4000);
        timersRef.current.push(timer);
      });

      signal.on("room_closed", () => {
        fatalRef.current = true;
        setNotice("The host ended this meeting.");
        setPhase("ended");
        cleanup(true);
        signal.leave();
        signalRef.current = null;
      });

      signal.on("error", (message) => {
        if (["room_not_found", "bad_passcode", "room_full"].includes(message.code)) {
          fatalRef.current = true;
          setError(message.message);
          cleanup(false);
          signal.leave();
          signalRef.current = null;
          setPhase("idle");
          return;
        }
        setError(message.message);
      });

      signal.on("status", (status) => {
        if (status === "error" && !fatalRef.current) {
          setNotice("Connection to the signaling server was lost.");
          setPhase("ended");
          cleanup(true);
          signalRef.current = null;
        }
      });

      signalRef.current = signal;
      meshRef.current = mesh;
      signal.connect();
    },
    [cleanup, phase, setSharingState, upsertRemote],
  );

  const ensureTrack = useCallback(
    async (kind: "audio" | "video", deviceId?: string): Promise<MediaStreamTrack | null> => {
      if (!navigator.mediaDevices?.getUserMedia) return null;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia(
          kind === "audio"
            ? { audio: audioConstraints(deviceId, noiseRef.current) }
            : {
                video: deviceId
                  ? { deviceId: { exact: deviceId } }
                  : { width: { ideal: 1280 }, height: { ideal: 720 } },
              },
        );
        const track = fresh.getTracks()[0] ?? null;
        if (!track) return null;
        const existing = localRef.current?.getTracks().filter((t) => t.kind !== kind) ?? [];
        const merged = new MediaStream([...existing, track]);
        localRef.current?.getTracks().filter((t) => t.kind === kind).forEach((t) => t.stop());
        localRef.current = merged;
        setLocalStream(merged);
        meshRef.current?.replaceLocalStream(merged);
        return track;
      } catch {
        setError(
          kind === "audio"
            ? "Microphone unavailable. Check system permissions."
            : "Camera unavailable. Check system permissions.",
        );
        return null;
      }
    },
    [],
  );

  const toggleMic = useCallback(async () => {
    const current = localRef.current?.getAudioTracks()[0] ?? null;
    if (!current) {
      const track = await ensureTrack("audio");
      if (!track) return;
      track.enabled = true;
      setMic(true);
      signalRef.current?.state(true, camRef.current, sharingRef.current, handRef.current);
      return;
    }
    current.enabled = !current.enabled;
    setMic(current.enabled);
    signalRef.current?.state(current.enabled, camRef.current, sharingRef.current, handRef.current);
  }, [ensureTrack, setMic]);

  const toggleCam = useCallback(async () => {
    const current = localRef.current?.getVideoTracks()[0] ?? null;
    if (!current) {
      const track = await ensureTrack("video");
      if (!track) return;
      track.enabled = true;
      setCam(true);
      signalRef.current?.state(micRef.current, true, sharingRef.current, handRef.current);
      return;
    }
    current.enabled = !current.enabled;
    setCam(current.enabled);
    signalRef.current?.state(micRef.current, current.enabled, sharingRef.current, handRef.current);
  }, [ensureTrack, setCam]);

  const startShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not available in this webview on this platform.");
      return;
    }
    if (transportRef.current === "sfu") {
      try {
        const started = await sfuRef.current?.startScreenShare();
        if (!started) return;
        setSharingState(true);
        signalRef.current?.state(micRef.current, camRef.current, true, handRef.current);
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "AbortError")
        ) {
          return;
        }
        setError("Could not start screen sharing.");
      }
      return;
    }

    const video: MediaTrackConstraints = {
      frameRate: { ideal: 15, max: 30 },
      width: { max: 1920 },
    };
    let display: MediaStream | null = null;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video,
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as unknown as DisplayMediaStreamOptions);
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "AbortError")
      ) {
        return;
      }
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      } catch (fallbackError) {
        if (
          fallbackError instanceof DOMException &&
          (fallbackError.name === "NotAllowedError" || fallbackError.name === "AbortError")
        ) {
          return;
        }
        setError("Could not start screen sharing.");
        return;
      }
    }

    const videoTrack = display.getVideoTracks()[0];
    if (!videoTrack) return;
    const stop = () => {
      meshRef.current?.stopScreenShare();
      screenRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current = null;
      setScreenStream(null);
      setSharingState(false);
      signalRef.current?.state(
        micRef.current,
        camRef.current,
        false,
        handRef.current,
      );
    };
    videoTrack.addEventListener("ended", stop);
    screenRef.current = display;
    setScreenStream(display);
    meshRef.current?.startScreenShare(display);
    setSharingState(true);
    signalRef.current?.state(micRef.current, camRef.current, true, handRef.current);
  }, [setSharingState]);

  const stopShare = useCallback(() => {
    if (transportRef.current === "sfu") {
      void sfuRef.current?.stopScreenShare();
      screenRef.current = null;
      setScreenStream(null);
      setSharingState(false);
      signalRef.current?.state(micRef.current, camRef.current, false, handRef.current);
      return;
    }
    meshRef.current?.stopScreenShare();
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setScreenStream(null);
    setSharingState(false);
    signalRef.current?.state(micRef.current, camRef.current, false, handRef.current);
  }, [setSharingState]);

  const toggleHand = useCallback(() => {
    if (!signalRef.current) return;
    const next = !handRef.current;
    setHand(next);
    signalRef.current.state(micRef.current, camRef.current, sharingRef.current, next);
  }, [setHand]);

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    signalRef.current?.chat(trimmed);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    signalRef.current?.reaction(emoji);
  }, []);

  const endMeeting = useCallback(() => {
    signalRef.current?.endMeeting();
  }, []);

  const leave = useCallback(() => {
    reset();
  }, [reset]);

  const switchDevice = useCallback(
    async (kind: "audio" | "video", deviceId: string) => {
      const track = await ensureTrack(kind, deviceId);
      if (!track) return;
      track.enabled = kind === "audio" ? micRef.current : camRef.current;
      if (transportRef.current === "sfu") {
        await sfuRef.current?.replaceTrack(kind, track);
      }
    },
    [ensureTrack],
  );

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      meshRef.current?.closeAll();
      void sfuRef.current?.disconnect();
      localRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      signalRef.current?.leave();
    };
  }, []);

  return {
    phase,
    room,
    selfId,
    isHost,
    participants: Object.values(participants),
    remotes,
    messages,
    reactions,
    error,
    notice,
    micOn,
    camOn,
    sharing,
    handOn,
    transport,
    localStream,
    screenStream,
    startedAt,
    join,
    leave,
    toggleMic,
    toggleCam,
    toggleHand,
    startShare,
    stopShare,
    sendChat,
    sendReaction,
    endMeeting,
    switchDevice,
    clearError,
    clearNotice,
  };
}

export type Meeting = ReturnType<typeof useMeeting>;
