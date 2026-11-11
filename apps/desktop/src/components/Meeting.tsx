import { useEffect, useRef, useState } from "react";
import type { Meeting } from "../lib/useMeeting";
import { formatDuration } from "../types";
import { copyText, inviteLink } from "../lib/platform";
import { ChatPanel } from "./ChatPanel";
import { PeoplePanel } from "./PeoplePanel";
import { Tile } from "./Tile";
import {
  ChatIcon,
  CopyIcon,
  GearIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  PeopleIcon,
  ScreenIcon,
  SmileIcon,
  VideoIcon,
  VideoOffIcon,
} from "./Icons";

type Panel = "none" | "chat" | "people";

const REACTIONS = ["👍", "👏", "❤️", "😂", "🎉", "😮"];

type Props = {
  meeting: Meeting;
  onOpenSettings: () => void;
};

export function MeetingRoom({ meeting, onOpenSettings }: Props) {
  const [panel, setPanel] = useState<Panel>("none");
  const [unread, setUnread] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const panelRef = useRef<Panel>("none");
  const seenRef = useRef(0);
  const reactionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current = panel;
    if (panel === "chat") setUnread(0);
  }, [panel]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const added = meeting.messages.length - seenRef.current;
    if (added > 0 && panelRef.current !== "chat") setUnread((value) => value + added);
    seenRef.current = meeting.messages.length;
  }, [meeting.messages.length]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (reactionsRef.current && !reactionsRef.current.contains(event.target as Node)) {
        setShowReactions(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  const self = meeting.participants.find((peer) => peer.id === meeting.selfId);
  const remotePeers = meeting.participants.filter((peer) => peer.id !== meeting.selfId);

  const remoteScreenPeer = remotePeers.find(
    (peer) => peer.sharing && meeting.remotes[peer.id]?.screenStream,
  );
  const activeScreen = meeting.sharing && meeting.screenStream
    ? { stream: meeting.screenStream, name: self?.name ?? "You" }
    : remoteScreenPeer
      ? {
          stream: meeting.remotes[remoteScreenPeer.id]?.screenStream ?? null,
          name: remoteScreenPeer.name,
        }
      : null;

  const elapsed = meeting.startedAt ? (now - meeting.startedAt) / 1000 : 0;

  async function copyInvite() {
    const ok = await copyText(inviteLink(meeting.room));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  const tileCount = remotePeers.length + 1;

  return (
    <div className="meeting">
      <header className="meeting-top">
        <div className="meeting-room">
          <span className="room-code">{meeting.room || "connecting…"}</span>
          {meeting.room && (
            <button
              className="icon-button small"
              onClick={copyInvite}
              title="Copy invite link"
              type="button"
            >
              <CopyIcon size={16} />
            </button>
          )}
          {copied && <span className="copied">Copied</span>}
        </div>
        <span className="meeting-timer">{formatDuration(elapsed)}</span>
        <div className="meeting-top-right">
          <span className="mesh-pill" title="Peer-to-peer mesh transport">
            {tileCount} in call
          </span>
          <button className="icon-button" onClick={onOpenSettings} title="Settings" type="button">
            <GearIcon />
          </button>
        </div>
      </header>

      <div className={`meeting-body ${panel === "none" ? "" : "with-panel"}`}>
        <div className="stage">
          {activeScreen && activeScreen.stream ? (
            <>
              <div className="screen-stage">
                <Tile
                  name={activeScreen.name}
                  stream={activeScreen.stream}
                  camOn
                  micOn
                  variant="screen"
                />
              </div>
              <div className="filmstrip">
                <Tile
                  name={self?.name ?? "You"}
                  stream={meeting.localStream}
                  camOn={meeting.camOn}
                  micOn={meeting.micOn}
                  isSelf
                />
                {remotePeers.map((peer) => (
                  <Tile
                    key={peer.id}
                    name={peer.name}
                    stream={meeting.remotes[peer.id]?.camStream ?? null}
                    camOn={peer.cam}
                    micOn={peer.mic}
                    connection={meeting.remotes[peer.id]?.connection}
                    sharing={peer.sharing}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={`gallery count-${Math.min(tileCount, 9)}`}>
              {remotePeers.map((peer) => (
                <Tile
                  key={peer.id}
                  name={peer.name}
                  stream={meeting.remotes[peer.id]?.camStream ?? null}
                  camOn={peer.cam}
                  micOn={peer.mic}
                  connection={meeting.remotes[peer.id]?.connection}
                  sharing={peer.sharing}
                />
              ))}
              <Tile
                name={self?.name ?? "You"}
                stream={meeting.localStream}
                camOn={meeting.camOn}
                micOn={meeting.micOn}
                isSelf
              />
            </div>
          )}

          <div className="reaction-layer" aria-live="polite">
            {meeting.reactions.map((reaction) => (
              <span key={reaction.id} className="floating-reaction">
                {reaction.emoji}
                <small>{reaction.name}</small>
              </span>
            ))}
          </div>
        </div>

        {panel === "chat" && (
          <ChatPanel
            messages={meeting.messages}
            onSend={meeting.sendChat}
            onClose={() => setPanel("none")}
          />
        )}
        {panel === "people" && (
          <PeoplePanel
            participants={meeting.participants}
            selfId={meeting.selfId}
            isHost={meeting.isHost}
            onClose={() => setPanel("none")}
          />
        )}
      </div>

      <footer className="controls">
        <div className="controls-group">
          <button
            className={`control ${meeting.micOn ? "" : "off"}`}
            onClick={() => void meeting.toggleMic()}
            title={meeting.micOn ? "Mute microphone" : "Unmute microphone"}
            type="button"
          >
            {meeting.micOn ? <MicIcon /> : <MicOffIcon />}
            <span>{meeting.micOn ? "Mute" : "Unmute"}</span>
          </button>
          <button
            className={`control ${meeting.camOn ? "" : "off"}`}
            onClick={() => void meeting.toggleCam()}
            title={meeting.camOn ? "Stop camera" : "Start camera"}
            type="button"
          >
            {meeting.camOn ? <VideoIcon /> : <VideoOffIcon />}
            <span>{meeting.camOn ? "Stop video" : "Start video"}</span>
          </button>
          <button
            className={`control ${meeting.sharing ? "active" : ""}`}
            onClick={() => (meeting.sharing ? meeting.stopShare() : void meeting.startShare())}
            title="Share screen"
            type="button"
          >
            <ScreenIcon />
            <span>{meeting.sharing ? "Stop share" : "Share"}</span>
          </button>
        </div>

        <div className="controls-group">
          <div className="reaction-wrap" ref={reactionsRef}>
            <button
              className={`control ${showReactions ? "active" : ""}`}
              onClick={() => setShowReactions((value) => !value)}
              title="Send a reaction"
              type="button"
            >
              <SmileIcon />
              <span>React</span>
            </button>
            {showReactions && (
              <div className="reaction-popover">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      meeting.sendReaction(emoji);
                      setShowReactions(false);
                    }}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`control ${panel === "chat" ? "active" : ""}`}
            onClick={() => setPanel(panel === "chat" ? "none" : "chat")}
            title="Chat"
            type="button"
          >
            <ChatIcon />
            <span>Chat</span>
            {unread > 0 && <i className="badge-count">{unread}</i>}
          </button>
          <button
            className={`control ${panel === "people" ? "active" : ""}`}
            onClick={() => setPanel(panel === "people" ? "none" : "people")}
            title="Participants"
            type="button"
          >
            <PeopleIcon />
            <span>People</span>
          </button>
        </div>

        <div className="controls-group">
          <button className="control danger" onClick={() => setConfirmLeave(true)} type="button">
            <LeaveIcon />
            <span>Leave</span>
          </button>
        </div>
      </footer>

      {confirmLeave && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Leave this meeting?</h2>
            <p className="muted">
              {meeting.isHost
                ? "You are the host. Leaving keeps the room open; ending closes it for everyone."
                : "You can rejoin with the same room code."}
            </p>
            <div className="modal-actions">
              <button className="button ghost" onClick={() => setConfirmLeave(false)} type="button">
                Stay
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setConfirmLeave(false);
                  meeting.leave();
                }}
                type="button"
              >
                Leave
              </button>
              {meeting.isHost && (
                <button
                  className="button danger"
                  onClick={() => {
                    setConfirmLeave(false);
                    meeting.endMeeting();
                  }}
                  type="button"
                >
                  End for all
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
