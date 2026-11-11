import { useEffect, useRef, useState } from "react";
import type { Settings } from "../types";
import { initials } from "../types";
import { useDevices } from "../lib/useDevices";
import { GearIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "./Icons";

type JoinArgs = {
  name: string;
  mic: boolean;
  cam: boolean;
  cameraId: string;
  micId: string;
};

type Props = {
  room: string;
  passcode?: string;
  settings: Settings;
  joining: boolean;
  error: string | null;
  onJoin: (args: JoinArgs) => void;
  onCancel: () => void;
  onSettings: () => void;
};

export function PreJoin({
  room,
  passcode,
  settings,
  joining,
  error,
  onJoin,
  onCancel,
  onSettings,
}: Props) {
  const devices = useDevices();
  const [name, setName] = useState(settings.displayName);
  const [micEnabled, setMicEnabled] = useState(!settings.startMuted);
  const [camEnabled, setCamEnabled] = useState(!settings.startVideoOff);
  const [cameraId, setCameraId] = useState(settings.cameraId);
  const [micId, setMicId] = useState(settings.micId);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
          if (!cancelled) setMediaError("No camera or microphone access. You can join and listen.");
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
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
  }, [stream, camEnabled]);

  useEffect(() => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = camEnabled;
    });
  }, [camEnabled, stream]);

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = micEnabled;
    });
  }, [micEnabled, stream]);

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
      // A level meter is optional.
    }
    return () => {
      cancelAnimationFrame(raf);
      void context?.close().catch(() => {});
    };
  }, [stream]);

  const videoTracks = stream?.getVideoTracks() ?? [];
  const hasCamera = videoTracks.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || joining) return;
    onJoin({ name: name.trim(), mic: micEnabled, cam: camEnabled && hasCamera, cameraId, micId });
  }

  return (
    <div className="prejoin">
      <header className="simple-header">
        <button className="link-button" onClick={onCancel} type="button">
          ← Back
        </button>
        <div className="room-pill">
          Room <strong>{room}</strong>
          {passcode ? <span className="lock">passcode protected</span> : null}
        </div>
        <button className="icon-button" onClick={onSettings} title="Settings" type="button">
          <GearIcon />
        </button>
      </header>

      <div className="prejoin-grid">
        <div className={`preview ${camEnabled && hasCamera ? "" : "off"}`}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ visibility: camEnabled && hasCamera ? "visible" : "hidden" }}
          />
          {(!camEnabled || !hasCamera) && (
            <div className="preview-avatar">{initials(name || "Guest")}</div>
          )}
          <div className="preview-badges">
            <span className={`badge ${micEnabled ? "on" : "off"}`}>
              {micEnabled ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
              {micEnabled ? "Mic on" : "Muted"}
            </span>
            <span className={`badge ${camEnabled && hasCamera ? "on" : "off"}`}>
              {camEnabled && hasCamera ? <VideoIcon size={16} /> : <VideoOffIcon size={16} />}
              {camEnabled && hasCamera ? "Camera on" : "Camera off"}
            </span>
          </div>
          <div className="level-meter" aria-hidden>
            <span style={{ transform: `scaleX(${micEnabled ? Math.max(0.04, level) : 0})` }} />
          </div>
        </div>

        <form className="prejoin-panel" onSubmit={submit}>
          <h1>Ready to join?</h1>
          <p className="muted">Check your camera and microphone before entering.</p>

          <label className="field">
            <span>Your name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="How others will see you"
              maxLength={64}
              autoFocus
            />
          </label>

          <label className="field">
            <span>Camera</span>
            <select value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
              <option value="">Default camera</option>
              {devices.cams.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Microphone</span>
            <select value={micId} onChange={(event) => setMicId(event.target.value)}>
              <option value="">Default microphone</option>
              {devices.mics.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <div className="toggle-row">
            <button
              className={`toggle ${micEnabled ? "active" : ""}`}
              onClick={() => setMicEnabled((value) => !value)}
              type="button"
            >
              {micEnabled ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
              {micEnabled ? "Microphone on" : "Microphone off"}
            </button>
            <button
              className={`toggle ${camEnabled && hasCamera ? "active" : ""}`}
              onClick={() => setCamEnabled((value) => !value)}
              type="button"
            >
              {camEnabled && hasCamera ? <VideoIcon size={18} /> : <VideoOffIcon size={18} />}
              {camEnabled && hasCamera ? "Camera on" : "Camera off"}
            </button>
          </div>

          {mediaError && <p className="notice warn">{mediaError}</p>}
          {error && <p className="notice error">{error}</p>}

          <button className="button primary wide" type="submit" disabled={joining || !name.trim()}>
            {joining ? "Joining…" : "Join meeting"}
          </button>
          <p className="hint">
            Media flows directly between participants. No recording, no analytics.
          </p>
        </form>
      </div>
    </div>
  );
}
