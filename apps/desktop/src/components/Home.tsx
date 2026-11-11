import { useMemo, useState } from "react";
import type { HistoryEntry, Settings } from "../types";
import { relativeTime, roomCode } from "../types";
import { ArrowIcon, GearIcon, LinkIcon } from "./Icons";

type Props = {
  settings: Settings;
  history: HistoryEntry[];
  online: boolean | null;
  busy: boolean;
  onCreate: (passcode?: string) => void;
  onJoin: (room: string, passcode?: string) => void;
  onSettings: () => void;
};

export function Home({ settings, history, online, busy, onCreate, onJoin, onSettings }: Props) {
  const [code, setCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");

  const parsed = useMemo(() => roomCode(code), [code]);
  const invalid = code.trim().length > 0 && !parsed;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed || busy) return;
    onJoin(parsed, passcode.trim() || undefined);
  }

  function createRoom(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    onCreate(newPasscode.trim() || undefined);
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <LogoMark />
          <div>
            <div className="brand-name">OpenMeet</div>
            <div className="brand-sub">self-hosted meetings</div>
          </div>
        </div>
        <button className="icon-button" onClick={onSettings} title="Settings" type="button">
          <GearIcon />
        </button>
      </header>

      <section className="hero">
        <h1>
          Meetings that
          <br />
          belong to you.
        </h1>
        <p>
          Free, open source, and yours to host. No accounts, no meeting limits imposed by a vendor,
          no telemetry.
        </p>
        <div className="hero-actions">
          <button className="button primary" onClick={() => onCreate()} disabled={busy} type="button">
            New meeting
            <ArrowIcon />
          </button>
          <a className="button ghost" href="#join">
            Join with a code
          </a>
        </div>
      </section>

      <div className="home-grid">
        <section className="card">
          <form id="join" onSubmit={submit}>
            <h2>Join a meeting</h2>
            <label className="field">
              <span>Room code or invite link</span>
              <div className="input-with-icon">
                <LinkIcon />
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="e.g. k4p9x2m7q1za"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={invalid}
                />
              </div>
            </label>
            {invalid && (
              <p className="field-error">That does not look like a room code or invite link.</p>
            )}
            <label className="field">
              <span>Passcode (if the room has one)</span>
              <input
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                type="password"
                placeholder="Optional"
                autoComplete="off"
              />
            </label>
            <button className="button primary wide" disabled={!parsed || busy} type="submit">
              Join
            </button>
            <p className="hint">
              Everyone in the room receives media directly (mesh). Best for calls of up to six
              people.
            </p>
          </form>

          <div className="card-divider" />
          <form onSubmit={createRoom}>
            <h3 className="card-subtitle">Start a new room</h3>
            <label className="field">
              <span>Passcode (optional)</span>
              <input
                value={newPasscode}
                onChange={(event) => setNewPasscode(event.target.value)}
                placeholder="Leave empty for an open room"
                autoComplete="off"
              />
            </label>
            <button className="button ghost wide" disabled={busy} type="submit">
              Create room
            </button>
          </form>
        </section>

        <div className="card">
          <h2>Recent</h2>
          {history.length === 0 ? (
            <p className="muted">Meetings you join will show up here.</p>
          ) : (
            <ul className="recent-list">
              {history.slice(0, 6).map((entry) => (
                <li key={`${entry.room}-${entry.startedAt}`}>
                  <button
                    className="recent-row"
                    onClick={() => onJoin(entry.room)}
                    type="button"
                  >
                    <span className="recent-code">{entry.room}</span>
                    <span className="recent-meta">
                      {relativeTime(entry.startedAt)} · {Math.max(1, entry.participants)} people
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <footer className="home-footer">
        <span className={`status-dot ${online === null ? "unknown" : online ? "ok" : "bad"}`} />
        <span>
          {online === null
            ? "Checking signaling server…"
            : online
              ? `Connected to ${settings.serverUrl}`
              : `Cannot reach ${settings.serverUrl}`}
        </span>
        <button className="link-button" onClick={onSettings} type="button">
          Change
        </button>
      </footer>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3ee6b0" />
          <stop offset="100%" stopColor="#3d8bff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="34" height="34" rx="10" fill="url(#logo-gradient)" />
      <path
        d="M11 13h9.5a3.5 3.5 0 0 1 0 7H16v3h-5V13zm5 4v3h4a1.5 1.5 0 0 0 0-3h-4z"
        fill="#06121a"
      />
      <circle cx="26" cy="24.5" r="2.6" fill="#06121a" />
    </svg>
  );
}
