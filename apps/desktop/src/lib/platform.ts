import type { HistoryEntry, Settings } from "../types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SETTINGS_KEY = "openmeet.settings.v1";
const HISTORY_KEY = "openmeet.history.v1";

/**
 * Browser deployments talk to the same origin they were served from; the packaged
 * desktop app has no meaningful origin, so it falls back to the hosted instance.
 */
function resolveDefaultServerUrl(): string {
  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) {
    const { host, port } = window.location;
    if (port === "5173" || port === "4173") return "ws://127.0.0.1:8770";
    return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host}`;
  }
  return "wss://openmeet.garox.my.id";
}

export function inviteLink(code: string): string {
  if (
    !isTauri &&
    typeof window !== "undefined" &&
    /^https?:$/.test(window.location.protocol)
  ) {
    return `${window.location.origin}/?room=${encodeURIComponent(code)}`;
  }
  return `openmeet://join/${code}`;
}

export const defaultSettings: Settings = {
  displayName: "",
  serverUrl: resolveDefaultServerUrl(),
  cameraId: "",
  micId: "",
  speakerId: "",
  startMuted: false,
  startVideoOff: false,
};

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); settings are best effort.
  }
}

export async function loadSettings(): Promise<Settings> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const saved = await invoke<Partial<Settings>>("load_settings");
      return { ...defaultSettings, ...saved };
    } catch {
      return { ...defaultSettings };
    }
  }
  return { ...defaultSettings, ...(readLocal<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_settings", { settings });
      return;
    } catch {
      // fall through to local storage
    }
  }
  writeLocal(SETTINGS_KEY, settings);
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<HistoryEntry[]>("list_history");
    } catch {
      return [];
    }
  }
  return readLocal<HistoryEntry[]>(HISTORY_KEY) ?? [];
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("add_history", { entry });
      return;
    } catch {
      // fall through
    }
  }
  const current = readLocal<HistoryEntry[]>(HISTORY_KEY) ?? [];
  writeLocal(HISTORY_KEY, [entry, ...current].slice(0, 50));
}

export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri || typeof document === "undefined" || !document.hidden) return;
  try {
    const plugin = await import("@tauri-apps/plugin-notification");
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      granted = (await plugin.requestPermission()) === "granted";
    }
    if (granted) plugin.sendNotification({ title, body });
  } catch {
    // Notifications are optional.
  }
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string): Promise<boolean> {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function onDeepLink(handler: (url: string) => void): Promise<() => void> {
  if (isTauri) {
    try {
      const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      const unlisten = await onOpenUrl((urls) => {
        for (const url of urls) handler(url);
      });
      const current = await getCurrent();
      current?.forEach(handler);
      return unlisten;
    } catch {
      return () => {};
    }
  }
  const params = new URLSearchParams(window.location.search);
  const join = params.get("join") ?? params.get("room");
  if (join) handler(`openmeet://join/${join}`);
  return () => {};
}

export async function onTrayAction(
  action: "toggle-mic" | "toggle-camera" | "leave",
  handler: () => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen(`tray:${action}`, () => handler());
  } catch {
    return () => {};
  }
}

export async function windowMinimize(): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch {
    // ignore
  }
}
