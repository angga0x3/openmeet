import { useCallback, useEffect, useRef, useState } from "react";
import { Home } from "./components/Home";
import { PreJoin } from "./components/PreJoin";
import { MeetingRoom } from "./components/Meeting";
import { SettingsDialog } from "./components/Settings";
import { useMeeting } from "./lib/useMeeting";
import { createRoom } from "./lib/signaling";
import {
  defaultSettings,
  listHistory,
  loadSettings,
  onDeepLink,
  onTrayAction,
  saveSettings,
} from "./lib/platform";
import { roomCode } from "./types";
import type { HistoryEntry, Settings } from "./types";

type View = "home" | "prejoin";
type Pending = { room: string; passcode?: string };

export default function App() {
  const meeting = useMeeting();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const phaseRef = useRef(meeting.phase);
  phaseRef.current = meeting.phase;

  useEffect(() => {
    void (async () => {
      const [loaded, recent] = await Promise.all([loadSettings(), listHistory()]);
      setSettings(loaded);
      setHistory(recent);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const base = settings.serverUrl
          .trim()
          .replace(/\/+$/, "")
          .replace(/^ws(s?):\/\//i, "http$1://");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${base}/healthz`, { signal: controller.signal });
        clearTimeout(timer);
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }
    void check();
    const interval = setInterval(check, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [settings.serverUrl]);

  useEffect(() => {
    let dispose = () => {};
    const handled = new Set<string>();
    void onDeepLink((url) => {
      if (phaseRef.current === "live" || phaseRef.current === "joining") return;
      if (handled.has(url)) return;
      handled.add(url);
      const code = roomCode(url.replace(/^openmeet:\/\//i, "https://openmeet/"));
      if (!code) return;
      setPending({ room: code });
      setView("prejoin");
    }).then((off) => {
      dispose = off;
    });
    return () => dispose();
  }, []);

  useEffect(() => {
    if (meeting.phase === "live" || meeting.phase === "ended" || meeting.phase === "idle") {
      void listHistory().then(setHistory);
    }
  }, [meeting.phase]);

  useEffect(() => {
    if (!meeting.error) return;
    setToast(meeting.error);
    const timer = setTimeout(() => {
      setToast(null);
      meeting.clearError();
    }, 6000);
    return () => clearTimeout(timer);
  }, [meeting.error, meeting.clearError]);

  useEffect(() => {
    if (meeting.phase !== "live") return;
    const disposers: Array<() => void> = [];
    void onTrayAction("toggle-mic", () => void meeting.toggleMic()).then((off) =>
      disposers.push(off),
    );
    void onTrayAction("toggle-camera", () => void meeting.toggleCam()).then((off) =>
      disposers.push(off),
    );
    void onTrayAction("leave", () => meeting.leave()).then((off) => disposers.push(off));
    return () => disposers.forEach((off) => off());
  }, [meeting.phase, meeting.toggleMic, meeting.toggleCam, meeting.leave]);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  const onCreate = useCallback(async (passcode?: string) => {
    setBusy(true);
    setHomeError(null);
    try {
      const room = await createRoom(settingsRef.current.serverUrl, passcode);
      setPending({ room });
      setView("prejoin");
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Could not create a room.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onJoinRequest = useCallback((room: string, passcode?: string) => {
    setHomeError(null);
    setPending({ room, passcode });
    setView("prejoin");
  }, []);

  const onPreJoin = useCallback(
    (args: {
      name: string;
      mic: boolean;
      cam: boolean;
      cameraId: string;
      micId: string;
    }) => {
      if (!pending) return;
      const next: Settings = {
        ...settingsRef.current,
        displayName: args.name,
        cameraId: args.cameraId,
        micId: args.micId,
      };
      persist(next);
      void meeting.join({
        serverUrl: next.serverUrl,
        room: pending.room,
        passcode: pending.passcode,
        name: args.name,
        mic: args.mic,
        cam: args.cam,
        cameraId: args.cameraId,
        micId: args.micId,
      });
    },
    [meeting, pending, persist],
  );

  function backHome() {
    meeting.leave();
    setView("home");
    setPending(null);
  }

  const inCall = meeting.phase === "joining" || meeting.phase === "live";
  const ended = meeting.phase === "ended";

  return (
    <>
      {inCall && <MeetingRoom meeting={meeting} onOpenSettings={() => setSettingsOpen(true)} />}

      {ended && (
        <div className="ended">
          <div className="card ended-card">
            <h1>{meeting.notice ?? "Meeting ended"}</h1>
            <p className="muted">{meeting.error ?? "Thanks for meeting on OpenMeet."}</p>
            <button className="button primary" onClick={backHome} type="button">
              Back to home
            </button>
          </div>
        </div>
      )}

      {!inCall && !ended && view === "prejoin" && pending && (
        <PreJoin
          room={pending.room}
          passcode={pending.passcode}
          settings={settings}
          joining={meeting.phase === "joining"}
          error={meeting.error}
          onJoin={onPreJoin}
          onCancel={backHome}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {!inCall && !ended && view === "home" && (
        <Home
          settings={settings}
          history={history}
          online={online}
          busy={busy}
          onCreate={(passcode) => void onCreate(passcode)}
          onJoin={onJoinRequest}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          online={online}
          onSave={(next) => {
            persist(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {homeError && view === "home" && (
        <div className="toast error" role="status">
          {homeError}
          <button className="link-button" onClick={() => setHomeError(null)} type="button">
            Dismiss
          </button>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
