import { useEffect, useRef, useState } from "react";
import type { Meeting } from "../lib/useMeeting";
import type { Settings } from "../types";
import type { ScheduleEntry } from "../lib/schedule";
import { useDevices } from "../lib/useDevices";
import { Avatar, AvatarArt, colorFor } from "./Avatar";
import { Select } from "./Select";
import { Icon, type IconName } from "./Icon";

type Props = {
  meeting: Meeting;
  room: string;
  title?: string;
  schedule: ScheduleEntry[];
  onExit: () => void;
  onCopy: (text: string, message?: string) => void;
  pushToast: (message: string, icon?: IconName) => void;
};

const REACTIONS = ["👍", "👏", "❤️", "😂", "😮", "🎉", "🚀"];

function timeLabel(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(ms: number) {
  const date = new Date(ms);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function fmt(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function JoinView({
  room,
  passcode: initialPasscode,
  instant,
  settings,
  busy,
  error,
  schedule,
  onJoin,
  onBack,
  onCopy,
  onToast,
}: {
  room: string;
  passcode?: string;
  instant?: boolean;
  settings: Settings;
  busy: boolean;
  error?: string | null;
  schedule: ScheduleEntry[];
  onJoin: (args: {
    room: string;
    passcode?: string;
    name: string;
    mic: boolean;
    cam: boolean;
    cameraId: string;
    micId: string;
  }) => void;
  onBack: () => void;
  onCopy: (text: string, message?: string) => void;
  onToast: (message: string) => void;
}) {
  const devices = useDevices();
  const [code, setCode] = useState(room);
  const [passcode, setPasscode] = useState(initialPasscode ?? "");
  const [name, setName] = useState(settings.displayName);
  const [mic, setMic] = useState(!settings.startMuted);
  const [cam, setCam] = useState(!settings.startVideoOff);
  const [cameraId, setCameraId] = useState(settings.cameraId);
  const [micId, setMicId] = useState(settings.micId);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setCode(room);
    setPasscode(initialPasscode ?? "");
  }, [room, initialPasscode]);

  useEffect(() => {
    let cancelled = false;
    let local: MediaStream | null = null;

    async function acquire() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError("This platform does not expose camera access to webviews.");
        return;
      }
      try {
        local = await navigator.mediaDevices.getUserMedia({
          video: cameraId
            ? { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        if (!cancelled) {
          setMediaError(null);
          setStream(local);
          void devices.refresh();
        }
      } catch {
        try {
          local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (!cancelled) {
            setMediaError("Camera unavailable. You can still join with audio.");
            setStream(local);
          }
        } catch {
          if (!cancelled) setMediaError("No camera or microphone. You can still join and listen.");
        }
      }
    }

    void acquire();
    return () => {
      cancelled = true;
      local?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, micId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = cam;
    });
  }, [cam, stream]);

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = mic;
    });
  }, [mic, stream]);

  useEffect(() => {
    if (!stream) return;
    const audio = stream.getAudioTracks()[0];
    if (!audio) return;
    let context: AudioContext | null = null;
    let raf = 0;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(new MediaStream([audio]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      void context.resume().catch(() => {});
      const loop = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 3));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Meter is optional.
    }
    return () => {
      cancelAnimationFrame(raf);
      void context?.close().catch(() => {});
    };
  }, [stream]);

  const hasCamera = (stream?.getVideoTracks().length ?? 0) > 0;
  const scheduled = schedule.find((entry) => entry.room === code);
  const canJoin = Boolean(name.trim() && code.trim());

  function beep() {
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        void context.close();
      }, 350);
    } catch {
      // No audio output available.
    }
  }

  return (
    <div className="join-view">
      <header className="join-top">
        <div className="left">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <Icon name="arrow-left" size={15} /> Back
          </button>
          <span className="brand">
            <span className="mini-logo">
              <Icon name="video" size={15} />
            </span>
            <span>OpenMeet</span>
          </span>
        </div>
        <div className="join-top-right">
          <span className="sub">
            Signed in as <b>{settings.displayName || "Guest"}</b>
          </span>
          <Avatar name={settings.displayName || "Guest"} size={30} />
        </div>
      </header>

      <div className="join-main">
        <div>
          <div className={`preview ${cam && hasCamera ? "" : "cam-off"}`}>
            <video ref={videoRef} autoPlay playsInline muted className="pv-video" />
            {(!cam || !hasCamera) && (
              <div className="cam-off-view" style={{ ["--c" as string]: colorFor(name || "Guest") }}>
                <AvatarArt name={name || "Guest"} />
                <p>Camera is off</p>
              </div>
            )}
            <div className="pv-top">
              <span className="pv-name">{name || "Guest"}</span>
              <span className="pv-res">{hasCamera ? "720p · 30fps" : "audio only"}</span>
            </div>
            <div className={`meter ${mic ? "" : "off"}`}>
              {Array.from({ length: 12 }, (_, index) => (
                <i key={index} className={mic && index < Math.round(level * 12) ? "lit" : ""} />
              ))}
            </div>
            <div className="pv-ctrls">
              <button className={`pv-btn ${mic ? "" : "off"}`} onClick={() => setMic((value) => !value)} title="Microphone">
                <Icon name={mic ? "mic" : "mic-off"} size={19} />
              </button>
              <button className={`pv-btn ${cam && hasCamera ? "" : "off"}`} onClick={() => setCam((value) => !value)} title="Camera">
                <Icon name={cam ? "video" : "video-off"} size={19} />
              </button>
              <button
                className="pv-btn"
                onClick={() => onToast("Background effects are not available yet")}
                title="Background effects"
              >
                <Icon name="sparkles" size={19} />
              </button>
            </div>
          </div>
          <div className="pv-hint">
            <Icon name="shield-check" size={14} />
            Media flows directly between participants. No recording, no analytics.
          </div>
        </div>

        <div className="join-form">
          <h1>{scheduled ? "Ready to join?" : instant ? "Start your meeting" : "Ready to join?"}</h1>
          <p>
            {scheduled
              ? `${scheduled.title} · ${dayLabel(scheduled.start)} at ${timeLabel(scheduled.start)}`
              : "Check your audio and video before entering the room."}
          </p>

          <div className="field">
            <label className="label">Room code</label>
            <div className="input-wrap">
              <Icon name="hash" />
              <input
                className="input mono"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="abc-defg-hij"
                autoComplete="off"
              />
              <button className="in-act btn btn-ghost btn-sm" onClick={() => onCopy(code, "Room code copied")}>
                Copy
              </button>
            </div>
          </div>

          {scheduled && (
            <div className="minfo-card">
              <span className="t-ic" style={{ ["--c" as string]: scheduled.color }}>
                <Icon name="video" size={16} />
              </span>
              <div className="grow">
                <b>{scheduled.title}</b>
                <span className="sub">
                  {dayLabel(scheduled.start)} · {timeLabel(scheduled.start)} · {scheduled.duration} min
                </span>
              </div>
            </div>
          )}

          <div className="field">
            <label className="label">Display name</label>
            <div className="input-wrap">
              <Icon name="user" />
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                placeholder="How others will see you"
              />
            </div>
          </div>

          <div className="field">
            <label className="label">Passcode (if required)</label>
            <input
              className="input"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>

          <div className="dev-grid">
            <div className="field">
              <label className="label">Microphone</label>
              <Select
                icon="mic"
                value={micId}
                onChange={setMicId}
                options={[
                  { value: "", label: "System default", icon: "mic" },
                  ...devices.mics.map((device) => ({ value: device.id, label: device.label, icon: "mic" as const })),
                ]}
              />
            </div>
            <div className="field">
              <label className="label">Camera</label>
              <Select
                icon="video"
                value={cameraId}
                onChange={setCameraId}
                options={[
                  { value: "", label: "System default", icon: "video" },
                  ...devices.cams.map((device) => ({ value: device.id, label: device.label, icon: "video" as const })),
                ]}
              />
            </div>
          </div>

          {mediaError && <p className="form-notice warn">{mediaError}</p>}
          {error && <p className="form-notice error">{error}</p>}

          <div className="join-actions">
            <button className="btn btn-secondary btn-lg" onClick={beep} title="Play a test tone">
              <Icon name="volume-2" /> Test
            </button>
            <button
              className="btn btn-primary btn-lg"
              disabled={!canJoin || busy}
              onClick={() =>
                onJoin({
                  room: code.trim(),
                  passcode: passcode.trim() || undefined,
                  name: name.trim(),
                  mic,
                  cam,
                  cameraId,
                  micId,
                })
              }
            >
              <Icon name={instant ? "video" : "arrow-right"} />
              {busy ? "Joining…" : instant ? "Start meeting" : "Join meeting"}
            </button>
          </div>
          <div className="join-foot">
            <Icon name="lock" size={13} />
            DTLS-SRTP media · self-hostable · no account required
          </div>
        </div>
      </div>
    </div>
  );
}

export function RoomView({ meeting, room, title, schedule, onExit, onCopy, pushToast }: Props) {
  const [panel, setPanel] = useState<"none" | "chat" | "people">("none");
  const [layout, setLayout] = useState<"grid" | "speaker">("grid");
  const [pinned, setPinned] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [reactionMenu, setReactionMenu] = useState(false);
  const [deviceMenu, setDeviceMenu] = useState<"mic" | "cam" | null>(null);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");

  const gridRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef(0);
  const devices = useDevices();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const added = meeting.messages.length - seenRef.current;
    if (added > 0 && panel !== "chat") setUnread((value) => value + added);
    seenRef.current = meeting.messages.length;
    const list = chatRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [meeting.messages.length, panel]);

  useEffect(() => {
    function close(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest(".tb-menu-wrap")) {
        setDeviceMenu(null);
        setLayoutMenu(false);
      }
      if (!target.closest(".reaction-wrap")) setReactionMenu(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const key = event.key.toLowerCase();
      if (key === "m") void meeting.toggleMic();
      else if (key === "v") void meeting.toggleCam();
      else if (key === "c") setPanel(panel === "chat" ? "none" : "chat");
      else if (key === "p") setPanel(panel === "people" ? "none" : "people");
      else if (key === "escape") {
        setPanel("none");
        setReactionMenu(false);
        setLayoutMenu(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [meeting, panel]);

  const self = meeting.participants.find((peer) => peer.id === meeting.selfId);
  const sharingPeer = meeting.participants.find(
    (peer) => peer.sharing && meeting.remotes[peer.id]?.screenStream,
  );
  const localSharing = meeting.sharing && Boolean(meeting.screenStream);
  const sharing = localSharing || Boolean(sharingPeer);
  const sharingStream = localSharing
    ? meeting.screenStream
    : sharingPeer
      ? meeting.remotes[sharingPeer.id]?.screenStream
      : null;
  const sharingName = localSharing ? self?.name ?? "You" : sharingPeer?.name ?? "";

  const active = useActiveSpeaker(
    meeting.participants
      .filter((peer) => peer.id !== meeting.selfId && peer.mic)
      .map((peer) => ({ id: peer.id, stream: meeting.remotes[peer.id]?.camStream ?? null })),
    meeting.micOn ? meeting.localStream : null,
    meeting.selfId,
  );

  const split = sharing || layout === "speaker";
  const focusId = pinned ?? (active && active !== meeting.selfId ? active : null) ?? meeting.participants.find((peer) => peer.id !== meeting.selfId)?.id ?? meeting.selfId;

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || split) return;
    const fit = () => {
      const tiles = Array.from(grid.children) as HTMLElement[];
      if (tiles.length === 0) return;
      const style = getComputedStyle(grid);
      const gap = parseFloat(style.columnGap) || 10;
      const width = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width <= 0 || height <= 0) return;
      const ratio = 16 / 9;
      const count = tiles.length;
      const cols = count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
      const rows = Math.ceil(count / cols);
      const widthPerTile = (width - gap * (cols - 1)) / cols;
      const heightPerRow = (height - gap * (rows - 1)) / rows;
      let tileHeight = Math.min(widthPerTile / ratio, heightPerRow);
      let tileWidth = tileHeight * ratio;
      if (count === 1) {
        tileWidth = Math.min(tileWidth, 1080);
        tileHeight = tileWidth / ratio;
      }
      tiles.forEach((tile) => {
        tile.style.width = `${Math.max(120, Math.floor(tileWidth))}px`;
        tile.style.height = `${Math.max(70, Math.floor(tileHeight))}px`;
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [split, meeting.participants.length, panel]);

  const elapsed = meeting.startedAt ? (now - meeting.startedAt) / 1000 : 0;

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;
    meeting.sendChat(text);
    setChatDraft("");
  }

  function leave(closeAll: boolean) {
    setLeaveOpen(false);
    if (closeAll) meeting.endMeeting();
    else {
      meeting.leave();
      onExit();
    }
  }

  function tileFor(id: string, big = false) {
    const peer = meeting.participants.find((item) => item.id === id);
    if (!peer) return null;
    const isSelf = peer.id === meeting.selfId;
    const stream = isSelf ? meeting.localStream : meeting.remotes[peer.id]?.camStream ?? null;
    return (
      <Tile
        key={peer.id}
        name={peer.name}
        stream={stream}
        camOn={isSelf ? meeting.camOn : peer.cam}
        micOn={isSelf ? meeting.micOn : peer.mic}
        isSelf={isSelf}
        host={isSelf ? meeting.isHost : false}
        speaking={active === peer.id}
        pinned={pinned === peer.id}
        onPin={() => setPinned(pinned === peer.id ? null : peer.id)}
        big={big}
      />
    );
  }

  return (
    <div className="view room">
      <header className="room-top">
        <div className="rt-left">
          <span className="mini-logo">
            <Icon name="video" size={15} />
          </span>
          <span className="rt-title" title={title}>
            {title || schedule.find((entry) => entry.room === room)?.title || "Meeting"}
          </span>
          <span className="rt-sep" />
          <button className="rt-id" onClick={() => onCopy(inviteFor(room), "Invite link copied")} title="Copy invite">
            <span className="mono">{room}</span>
            <Icon name="copy" size={13} />
          </button>
          <span className="secure">
            <Icon name="lock" size={12} /> Encrypted
          </span>
        </div>
        <div className="rt-right">
          <span className="pill">
            <Icon name="clock" size={14} />
            <span>{fmt(elapsed)}</span>
          </span>
          <div className="tb-menu-wrap">
            <button className={`pill layout-pill ${layoutMenu ? "active" : ""}`} onClick={() => setLayoutMenu((value) => !value)}>
              <Icon name="layout-grid" size={14} />
              <span className="pill-label">Layout</span>
            </button>
            {layoutMenu && (
              <div className="popover layout-pop">
                <div className="pop-label">Layout</div>
                <button className="pop-row" onClick={() => { setLayout("grid"); setPinned(null); setLayoutMenu(false); }}>
                  <Icon name="layout-grid" size={15} /> Gallery
                  {layout === "grid" && <Icon name="check" size={15} className="grow-end" />}
                </button>
                <button className="pop-row" onClick={() => { setLayout("speaker"); setLayoutMenu(false); }}>
                  <Icon name="user" size={15} /> Speaker
                  {layout === "speaker" && <Icon name="check" size={15} className="grow-end" />}
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => {});
            }}
          >
            <Icon name="maximize" />
          </button>
        </div>
      </header>

      <div className="room-body">
        <div className={`stage ${sharing ? "sharing" : ""} ${split ? "is-split" : ""}`}>
          {sharing && sharingStream ? (
            <div className="share-stage">
              <div className="share-banner">
                <i />
                {localSharing ? "You're presenting to everyone" : `${sharingName} is presenting`}
                {localSharing && (
                  <button className="btn btn-danger btn-sm" onClick={meeting.stopShare}>
                    Stop presenting
                  </button>
                )}
              </div>
              <video
                className="screen-video"
                autoPlay
                playsInline
                muted={localSharing}
                ref={(element) => {
                  if (element && element.srcObject !== sharingStream) element.srcObject = sharingStream;
                }}
              />
              <div className="strip">
                {meeting.participants.map((peer) => tileFor(peer.id))}
              </div>
            </div>
          ) : split ? (
            <div className="split">
              <div className="main-slot">{tileFor(focusId, true)}</div>
              <div className="strip">
                {meeting.participants.filter((peer) => peer.id !== focusId).map((peer) => tileFor(peer.id))}
              </div>
            </div>
          ) : (
            <div className="tile-grid" ref={gridRef}>
              {meeting.participants.map((peer) => tileFor(peer.id))}
            </div>
          )}

          <div className="reaction-layer">
            {meeting.reactions.slice(-6).map((reaction) => (
              <span className="floating-reaction" key={reaction.id}>
                {reaction.emoji}
                <small>{reaction.name}</small>
              </span>
            ))}
          </div>

          <div className="toolbar">
            <div className="tb-menu-wrap">
              <div className={`tb-group ${deviceMenu === "mic" ? "open" : ""}`}>
                <button className={`tb ${meeting.micOn ? "" : "off"}`} onClick={() => void meeting.toggleMic()} title="Mute (M)">
                  <Icon name={meeting.micOn ? "mic" : "mic-off"} size={20} />
                  <span className="tb-label">{meeting.micOn ? "Mute" : "Unmute"}</span>
                </button>
                <button className="tb-caret" onClick={() => setDeviceMenu(deviceMenu === "mic" ? null : "mic")} title="Audio devices">
                  <Icon name="chevron-up" size={13} />
                </button>
              </div>
              {deviceMenu === "mic" && (
                <div className="popover device-pop">
                  <div className="pop-label">Microphone</div>
                  {[{ id: "", label: "System default" }, ...devices.mics].map((device) => (
                    <button
                      key={device.id || "default"}
                      className={`pop-row ${audioId === device.id ? "selected" : ""}`}
                      onClick={() => {
                        setAudioId(device.id);
                        void meeting.switchDevice("audio", device.id);
                        setDeviceMenu(null);
                      }}
                    >
                      <Icon name="mic" size={15} /> <span className="grow">{device.label}</span>
                      {audioId === device.id && <Icon name="check" size={15} className="check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="tb-menu-wrap">
              <div className={`tb-group ${deviceMenu === "cam" ? "open" : ""}`}>
                <button className={`tb ${meeting.camOn ? "" : "off"}`} onClick={() => void meeting.toggleCam()} title="Camera (V)">
                  <Icon name={meeting.camOn ? "video" : "video-off"} size={20} />
                  <span className="tb-label">{meeting.camOn ? "Stop video" : "Start video"}</span>
                </button>
                <button className="tb-caret" onClick={() => setDeviceMenu(deviceMenu === "cam" ? null : "cam")} title="Camera devices">
                  <Icon name="chevron-up" size={13} />
                </button>
              </div>
              {deviceMenu === "cam" && (
                <div className="popover device-pop">
                  <div className="pop-label">Camera</div>
                  {[{ id: "", label: "System default" }, ...devices.cams].map((device) => (
                    <button
                      key={device.id || "default"}
                      className={`pop-row ${videoId === device.id ? "selected" : ""}`}
                      onClick={() => {
                        setVideoId(device.id);
                        void meeting.switchDevice("video", device.id);
                        setDeviceMenu(null);
                      }}
                    >
                      <Icon name="video" size={15} /> <span className="grow">{device.label}</span>
                      {videoId === device.id && <Icon name="check" size={15} className="check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="tb-sep" />
            <button className={`tb ${meeting.sharing ? "active" : ""}`} onClick={() => (meeting.sharing ? meeting.stopShare() : void meeting.startShare())} title="Share screen">
              <Icon name="monitor-up" size={20} />
              <span className="tb-label">{meeting.sharing ? "Stop share" : "Share"}</span>
            </button>
            <button className={`tb ${panel === "people" ? "active" : ""}`} onClick={() => setPanel(panel === "people" ? "none" : "people")} title="People (P)">
              <Icon name="users" size={20} />
              <span className="tb-label">People</span>
              <span className="tb-badge neutral">{meeting.participants.length}</span>
            </button>
            <button className={`tb ${panel === "chat" ? "active" : ""}`} onClick={() => { setPanel(panel === "chat" ? "none" : "chat"); setUnread(0); }} title="Chat (C)">
              <Icon name="message-square" size={20} />
              <span className="tb-label">Chat</span>
              {unread > 0 && <span className="tb-badge">{unread}</span>}
            </button>
            <button className="tb" onClick={() => pushToast("Recording is not available in this build", "info")} title="Record">
              <Icon name="circle-dot" size={20} />
              <span className="tb-label">Record</span>
            </button>
            <div className="reaction-wrap">
              <button className={`tb ${reactionMenu ? "active" : ""}`} onClick={() => setReactionMenu((value) => !value)} title="Reactions">
                <Icon name="smile-plus" size={20} />
                <span className="tb-label">React</span>
              </button>
              {reactionMenu && (
                <div className="popover reaction-pop">
                  {REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        meeting.sendReaction(emoji);
                        setReactionMenu(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="tb-sep" />
            <button className="tb-leave" onClick={() => setLeaveOpen(true)}>
              <Icon name="phone-off" size={18} />
              <span>Leave</span>
            </button>
          </div>
        </div>

        <aside className={`panel ${panel === "none" ? "" : "open"}`}>
          <div className="panel-inner">
            <div className="panel-head">
              <div className="seg">
                <button className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}>
                  <Icon name="message-square" size={14} /> Chat
                </button>
                <button className={panel === "people" ? "active" : ""} onClick={() => setPanel("people")}>
                  <Icon name="users" size={14} /> People <span className="count">{meeting.participants.length}</span>
                </button>
              </div>
              <button className="icon-btn" onClick={() => setPanel("none")} title="Close panel">
                <Icon name="x" />
              </button>
            </div>

            {panel === "chat" && (
              <>
                <div className="chat-list" ref={chatRef}>
                  {meeting.messages.length === 0 && <div className="empty">No messages yet. Say hello.</div>}
                  {meeting.messages.map((message) => (
                    <div key={message.id} className={`msg ${message.self ? "self" : ""}`}>
                      <Avatar name={message.self ? "You" : message.name} size={28} />
                      <div className="msg-body">
                        <div className="msg-meta">
                          <b>{message.self ? "You" : message.name}</b>
                          <span>
                            {new Date(message.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="msg-text">{message.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="composer">
                  <div className="composer-box">
                    <textarea
                      rows={1}
                      placeholder="Message everyone…"
                      value={chatDraft}
                      onChange={(event) => setChatDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendChat();
                        }
                      }}
                    />
                    <div className="composer-foot">
                      <span className="to">
                        To: <b>Everyone</b>
                      </span>
                      <button className="send" onClick={sendChat} disabled={!chatDraft.trim()}>
                        <Icon name="send-horizontal" size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {panel === "people" && (
              <>
                <div className="people-top">
                  <div className="input-wrap">
                    <Icon name="search" />
                    <input
                      className="input"
                      placeholder="Search participants"
                      value={peopleQuery}
                      onChange={(event) => setPeopleQuery(event.target.value)}
                    />
                  </div>
                </div>
                <div className="plabel">In this meeting · {meeting.participants.length}</div>
                <div className="plist">
                  {meeting.participants
                    .filter((peer) => peer.name.toLowerCase().includes(peopleQuery.toLowerCase()))
                    .map((peer) => (
                      <div key={peer.id} className={`prow ${active === peer.id ? "speaking" : ""}`}>
                        <Avatar name={peer.name} size={30} />
                        <div className="pname">
                          {peer.name} {peer.id === meeting.selfId && <small>(You)</small>}
                          {peer.id === meeting.selfId && meeting.isHost && <small> · Host</small>}
                        </div>
                        <div className="picons">
                          <span className={peer.mic ? "" : "red"}>
                            <Icon name={peer.mic ? "mic" : "mic-off"} size={15} />
                          </span>
                          <span className={peer.cam ? "" : "red"}>
                            <Icon name={peer.cam ? "video" : "video-off"} size={15} />
                          </span>
                        </div>
                        <button
                          className="icon-btn sm"
                          onClick={() => setPinned(pinned === peer.id ? null : peer.id)}
                          title="Pin"
                        >
                          <Icon name="pin" size={14} />
                        </button>
                      </div>
                    ))}
                </div>
                <div className="people-foot">
                  <button className="btn btn-secondary btn-sm" onClick={() => onCopy(inviteFor(room), "Invite link copied")}>
                    <Icon name="user-plus" size={14} /> Invite
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <div className={`connecting ${meeting.phase === "joining" || !meeting.selfId ? "" : "hide"}`}>
        <div className="spin-logo">
          <Icon name="video" size={26} />
        </div>
        <p>
          Connecting to <b>{title || "meeting"}</b>…
        </p>
      </div>

      <LeaveModalLocal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onLeave={() => leave(false)}
        onEnd={() => leave(true)}
        isHost={meeting.isHost}
      />
    </div>
  );
}

function inviteFor(room: string) {
  return typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)
    ? `${window.location.origin}/?room=${encodeURIComponent(room)}`
    : `openmeet://join/${room}`;
}

function LeaveModalLocal({
  open,
  onClose,
  onLeave,
  onEnd,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  onLeave: () => void;
  onEnd: () => void;
  isHost: boolean;
}) {
  if (!open) return null;
  return (
    <div className="backdrop open" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal narrow" role="dialog" aria-modal>
        <div className="modal-head">
          <div>
            <div className="modal-ic red">
              <Icon name="phone-off" size={19} />
            </div>
            <h2>Leave this meeting?</h2>
            <p>You can rejoin with the same link while the room is active.</p>
          </div>
        </div>
        <div className="modal-body">
          <button className="btn btn-secondary btn-lg btn-block" onClick={onLeave}>
            Leave meeting
          </button>
          {isHost && (
            <button className="btn btn-danger btn-lg btn-block" onClick={onEnd}>
              End meeting for all
            </button>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({
  name,
  stream,
  camOn,
  micOn,
  isSelf,
  host,
  speaking,
  pinned,
  onPin,
  big,
}: {
  name: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  isSelf: boolean;
  host: boolean;
  speaking: boolean;
  pinned: boolean;
  onPin: () => void;
  big?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
  }, [stream]);

  const showVideo = camOn && Boolean(stream?.getVideoTracks().length);

  return (
    <div
      className={`tile ${showVideo ? "" : "cam-off"} ${speaking ? "speaking" : ""} ${
        pinned ? "pinned" : ""
      } ${big ? "big" : ""} ${isSelf ? "is-self" : ""}`}
    >
      <video ref={ref} autoPlay playsInline muted={isSelf} className="tile-video" />
      {!showVideo && (
        <div className="cam-off-view" style={{ ["--c" as string]: colorFor(name) }}>
          <AvatarArt name={name} />
        </div>
      )}
      <div className="tile-top">
        <span />
        <button className={`tile-pin ${pinned ? "active" : ""}`} onClick={onPin} title="Pin">
          <Icon name="pin" size={14} />
        </button>
      </div>
      <div className="tag">
        <span className="tag-mic">
          <Icon name={micOn ? "mic" : "mic-off"} size={13} />
        </span>
        <span className="tag-name">{isSelf ? `${name} (You)` : name}</span>
        {host && <span className="tag-role">Host</span>}
      </div>
    </div>
  );
}

/** Picks the loudest participant from live audio levels. */
function useActiveSpeaker(
  remotes: Array<{ id: string; stream: MediaStream | null }>,
  local: MediaStream | null,
  selfId: string,
) {
  const [active, setActive] = useState<string | null>(null);
  const signature = remotes.map((item) => `${item.id}:${item.stream?.id ?? ""}`).join("|") + `|${local?.id ?? ""}`;

  useEffect(() => {
    const context = new AudioContext();
    const nodes: Array<{ id: string; analyser: AnalyserNode; buffer: Uint8Array<ArrayBuffer> }> = [];

    function add(id: string, stream: MediaStream | null) {
      const track = stream?.getAudioTracks()[0];
      if (!track) return;
      try {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        nodes.push({ id, analyser, buffer: new Uint8Array(analyser.frequencyBinCount) });
      } catch {
        // A track can disappear while the graph is built.
      }
    }

    remotes.forEach((item) => add(item.id, item.stream));
    add(selfId, local);
    void context.resume().catch(() => {});

    const timer = setInterval(() => {
      let loudest: string | null = null;
      let best = 0.02;
      for (const node of nodes) {
        node.analyser.getByteTimeDomainData(node.buffer);
        let sum = 0;
        for (const value of node.buffer) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / node.buffer.length);
        if (rms > best) {
          best = rms;
          loudest = node.id;
        }
      }
      setActive((current) => (current === loudest ? current : loudest));
    }, 350);

    return () => {
      clearInterval(timer);
      void context.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return active;
}
