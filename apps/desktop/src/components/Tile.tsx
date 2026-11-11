import { useEffect, useRef } from "react";
import { initials } from "../types";
import { MicOffIcon, ScreenIcon } from "./Icons";

type Props = {
  name: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  isSelf?: boolean;
  variant?: "camera" | "screen";
  connection?: RTCPeerConnectionState;
  sharing?: boolean;
};

export function Tile({
  name,
  stream,
  camOn,
  micOn,
  isSelf = false,
  variant = "camera",
  connection,
  sharing = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    if (stream) void video.play().catch(() => {});
  }, [stream]);

  const showAvatar = variant === "camera" && (!camOn || !stream);

  return (
    <div
      className={`tile ${variant === "screen" ? "tile-screen" : ""} ${
        showAvatar ? "no-video" : ""
      } ${isSelf ? "is-self" : ""}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf || variant === "screen"}
        className={variant === "screen" ? "screen-video" : ""}
      />
      {showAvatar && <div className="tile-avatar">{initials(name || "Guest")}</div>}
      <div className="tile-bar">
        <span className="tile-name">
          {name || "Guest"}
          {isSelf ? " (you)" : ""}
        </span>
        <span className="tile-badges">
          {sharing && (
            <span className="tile-badge sharing" title="Sharing screen">
              <ScreenIcon size={14} />
            </span>
          )}
          {!micOn && (
            <span className="tile-badge muted" title="Microphone off">
              <MicOffIcon size={14} />
            </span>
          )}
          {connection && connection !== "connected" && (
            <span className={`tile-badge conn ${connection}`} title={`Connection: ${connection}`} />
          )}
        </span>
      </div>
    </div>
  );
}
