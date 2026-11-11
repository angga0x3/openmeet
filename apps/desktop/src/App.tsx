import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard, type Page } from "./components/Dashboard";
import { JoinView, RoomView } from "./components/RoomView";
import { JoinCodeModal, LeaveModal, ScheduleModal, ShortcutsModal, ToastStack, useToasts } from "./components/Modals";
import { useMeeting } from "./lib/useMeeting";
import { createRoom } from "./lib/signaling";
import {
  copyText,
  defaultSettings,
  listHistory,
  loadSettings,
  onDeepLink,
  onTrayAction,
  saveSettings,
} from "./lib/platform";
import { loadSchedule, nextColor, roomCode, saveSchedule, type ScheduleEntry } from "./lib/schedule";
import { applyTheme, loadPrefs, savePrefs, slugify, type Prefs } from "./lib/theme";
import type { HistoryEntry, Settings } from "./types";

type Route =
  | { name: "dash" }
  | { name: "join"; room: string; passcode?: string; instant?: boolean };

export default function App() {
  const meeting = useMeeting();
  const { toasts, push } = useToasts();

  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(() => loadSchedule());
  const [route, setRoute] = useState<Route>({ name: "dash" });
  const [page, setPage] = useState<Page>("home");
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personalRoom = prefs.personalRoom || slugify(settings.displayName || "guest");

  useEffect(() => {
    void (async () => {
      const [loaded, recent] = await Promise.all([loadSettings(), listHistory()]);
      setSettings(loaded);
      setHistory(recent);
    })();
  }, []);

  useEffect(() => {
    applyTheme(prefs.theme, prefs.accent);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(prefs.theme, prefs.accent);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs.theme, prefs.accent]);

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
        const response = await fetch(`${base}/healthz`, { signal: controller.signal });
        clearTimeout(timer);
        if (!cancelled) setOnline(response.ok);
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
      if (handled.has(url)) return;
      handled.add(url);
      const code = extractRoom(url);
      if (!code) return;
      setRoute({ name: "join", room: code });
    }).then((off) => {
      dispose = off;
    });
    return () => dispose();
  }, []);

  useEffect(() => {
    if (meeting.phase !== "ended") return;
    const message = meeting.notice ?? meeting.error ?? "Meeting ended";
    meeting.leave();
    setRoute({ name: "dash" });
    setPage("home");
    push(message, "info", 5000);
    void listHistory().then(setHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.phase]);

  useEffect(() => {
    if (meeting.error) push(meeting.error, "info", 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.error]);

  const inCall = meeting.phase === "joining" || meeting.phase === "live";

  useEffect(() => {
    if (!inCall) return;
    const disposers: Array<() => void> = [];
    void onTrayAction("toggle-mic", () => void meeting.toggleMic()).then((off) => disposers.push(off));
    void onTrayAction("toggle-camera", () => void meeting.toggleCam()).then((off) => disposers.push(off));
    void onTrayAction("leave", () => setLeaveOpen(true)).then((off) => disposers.push(off));
    return () => disposers.forEach((off) => off());
  }, [inCall, meeting.toggleMic, meeting.toggleCam]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next: Prefs = { ...current, ...patch, notifications: { ...current.notifications, ...(patch.notifications ?? {}) } };
      savePrefs(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveSettings(next), 350);
      return next;
    });
  }, []);

  const copy = useCallback(
    async (text: string, message = "Copied to clipboard") => {
      if (!text) return;
      const ok = await copyText(text);
      push(ok ? message : "Could not access the clipboard", ok ? "check" : "info");
    },
    [push],
  );

  const ensureRoom = useCallback(async (room: string, passcode?: string) => {
    try {
      await createRoom(settingsRef.current.serverUrl, passcode, room);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/already active|409/i.test(message)) throw error;
    }
  }, []);

  const startInstant = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const room = roomCode();
      await ensureRoom(room);
      setRoute({ name: "join", room, instant: true });
    } catch (error) {
      push(error instanceof Error ? error.message : "Could not reach the server", "info");
    } finally {
      setBusy(false);
    }
  }, [busy, ensureRoom, push]);

  const startPersonal = useCallback(async () => {
    setBusy(true);
    try {
      if (!prefs.personalRoom) updatePrefs({ personalRoom });
      await ensureRoom(personalRoom);
      setRoute({ name: "join", room: personalRoom, instant: true });
    } catch (error) {
      push(error instanceof Error ? error.message : "Could not reach the server", "info");
    } finally {
      setBusy(false);
    }
  }, [ensureRoom, personalRoom, prefs.personalRoom, push, updatePrefs]);

  const startScheduled = useCallback(
    async (entry: ScheduleEntry) => {
      setBusy(true);
      try {
        await ensureRoom(entry.room);
        setRoute({ name: "join", room: entry.room, instant: true });
      } catch (error) {
        push(error instanceof Error ? error.message : "Could not reach the server", "info");
      } finally {
        setBusy(false);
      }
    },
    [ensureRoom, push],
  );

  const saveScheduled = useCallback(
    (input: { title: string; start: number; duration: number }) => {
      const entry: ScheduleEntry = {
        id: crypto.randomUUID(),
        title: input.title,
        start: input.start,
        duration: input.duration,
        room: roomCode(),
        color: nextColor(schedule),
      };
      setSchedule((current) => {
        const next = [...current, entry];
        saveSchedule(next);
        return next;
      });
      setScheduleModal(false);
      push(`"${entry.title}" scheduled`, "check");
      void copy(`openmeet.app/${entry.room}`, "Room code copied");
    },
    [copy, push, schedule],
  );

  const onJoinFromView = useCallback(
    (args: {
      room: string;
      passcode?: string;
      name: string;
      mic: boolean;
      cam: boolean;
      cameraId: string;
      micId: string;
    }) => {
      const next: Settings = {
        ...settingsRef.current,
        displayName: args.name,
        cameraId: args.cameraId,
        micId: args.micId,
      };
      setSettings(next);
      void saveSettings(next);
      void meeting.join({
        serverUrl: next.serverUrl,
        room: args.room,
        passcode: args.passcode,
        name: args.name,
        mic: args.mic,
        cam: args.cam,
        cameraId: args.cameraId,
        micId: args.micId,
      });
    },
    [meeting],
  );

  const leaveCall = useCallback(() => {
    meeting.leave();
    setLeaveOpen(false);
    setRoute({ name: "dash" });
    setPage("home");
    void listHistory().then(setHistory);
  }, [meeting]);

  const roomTitle =
    route.name === "join"
      ? schedule.find((entry) => entry.room === route.room)?.title ??
        (route.room === personalRoom ? "Personal room" : route.instant ? "Instant meeting" : undefined)
      : undefined;

  return (
    <>
      {inCall && (
        <RoomView
          meeting={meeting}
          room={route.name === "join" ? route.room : meeting.room}
          title={roomTitle}
          schedule={schedule}
          onExit={() => {
            setRoute({ name: "dash" });
            setPage("home");
            void listHistory().then(setHistory);
          }}
          onCopy={copy}
          pushToast={(message, icon) => push(message, icon ?? "info")}
        />
      )}

      {!inCall && route.name === "join" && (
        <JoinView
          room={route.room}
          passcode={route.passcode}
          instant={route.instant}
          settings={settings}
          busy={meeting.phase === "joining"}
          error={meeting.error}
          schedule={schedule}
          onJoin={onJoinFromView}
          onBack={() => {
            meeting.clearError();
            setRoute({ name: "dash" });
          }}
          onCopy={copy}
          onToast={(message) => push(message, "info")}
        />
      )}

      {!inCall && route.name === "dash" && (
        <Dashboard
          page={page}
          onPage={setPage}
          settings={settings}
          onSettings={updateSettings}
          history={history}
          schedule={schedule}
          prefs={prefs}
          onPrefs={updatePrefs}
          online={online}
          busy={busy}
          personalRoom={personalRoom}
          onInstant={() => void startInstant()}
          onJoinCode={() => setJoinModal(true)}
          onSchedule={() => setScheduleModal(true)}
          onStartScheduled={(entry) => void startScheduled(entry)}
          onJoinRoom={(room) => setRoute({ name: "join", room })}
          onStartPersonal={() => void startPersonal()}
          onOpenShortcuts={() => setShortcuts(true)}
          onCopy={copy}
        />
      )}

      <JoinCodeModal
        open={joinModal}
        onClose={() => setJoinModal(false)}
        onContinue={(code, passcode) => {
          const room = extractCode(code);
          if (!room) {
            push("That doesn't look like a room code", "info");
            return;
          }
          setJoinModal(false);
          setRoute({ name: "join", room, passcode });
        }}
      />

      <ScheduleModal open={scheduleModal} onClose={() => setScheduleModal(false)} onSave={saveScheduled} />
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />

      <LeaveModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onLeave={leaveCall}
        onEnd={() => {
          meeting.endMeeting();
          setLeaveOpen(false);
        }}
        isHost={meeting.isHost}
      />

      <ToastStack toasts={toasts} />
    </>
  );
}

function extractCode(value: string): string {
  const raw = value.trim();
  let candidate = raw;
  try {
    const normalized = raw.startsWith("openmeet://")
      ? raw.replace(/^openmeet:\/\//, "https://openmeet/")
      : raw;
    const url = new URL(normalized);
    candidate =
      url.searchParams.get("room") ??
      url.searchParams.get("code") ??
      url.pathname.split("/").filter(Boolean).pop() ??
      "";
  } catch {
    candidate = raw;
  }
  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return cleaned.length >= 6 ? cleaned : "";
}

function extractRoom(url: string): string {
  return extractCode(url);
}
