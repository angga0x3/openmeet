import type { Peer } from "../types";
import { initials } from "../types";
import { CloseIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "./Icons";

type Props = {
  participants: Peer[];
  selfId: string;
  isHost: boolean;
  onClose: () => void;
};

export function PeoplePanel({ participants, selfId, isHost, onClose }: Props) {
  return (
    <aside className="panel">
      <header className="panel-header">
        <h2>People <span className="count">{participants.length}</span></h2>
        <button className="icon-button" onClick={onClose} title="Close participants" type="button">
          <CloseIcon />
        </button>
      </header>
      <ul className="people-list">
        {participants.map((peer) => (
          <li key={peer.id} className="person">
            <span className="avatar">{initials(peer.name)}</span>
            <span className="person-name">
              {peer.name}
              {peer.id === selfId ? " (you)" : ""}
              {peer.id === selfId && isHost ? <span className="tag">Host</span> : null}
            </span>
            <span className="person-badges">
              {peer.mic ? <MicIcon size={16} /> : <MicOffIcon size={16} className="dim" />}
              {peer.cam ? <VideoIcon size={16} /> : <VideoOffIcon size={16} className="dim" />}
            </span>
          </li>
        ))}
      </ul>
      <p className="panel-hint">
        Everyone in a mesh call uploads their own camera and microphone to every other participant.
      </p>
    </aside>
  );
}
