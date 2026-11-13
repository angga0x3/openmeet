export type ThemeMode = "dark" | "light" | "system";

export type Accent = {
  id: string;
  label: string;
  c: string;
  h: string;
  l: string;
};

export const ACCENTS: Accent[] = [
  { id: "indigo", label: "Indigo", c: "#6366f1", h: "#7c7ff5", l: "#a5b4fc" },
  { id: "blue", label: "Blue", c: "#3b82f6", h: "#60a5fa", l: "#93c5fd" },
  { id: "violet", label: "Violet", c: "#8b5cf6", h: "#a78bfa", l: "#c4b5fd" },
  { id: "emerald", label: "Emerald", c: "#10b981", h: "#34d399", l: "#6ee7b7" },
  { id: "rose", label: "Rose", c: "#f43f5e", h: "#fb7185", l: "#fda4af" },
];

export type Prefs = {
  theme: ThemeMode;
  accent: string;
  personalRoom: string;
  /** Opaque key that scopes rows in the server-side schedule table. */
  scheduleKey: string;
  notifications: {
    reminders: boolean;
    chat: boolean;
    weekly: boolean;
  };
};

const KEY = "openmeet.prefs.v2";

export function loadPrefs(): Prefs {
  const fallback: Prefs = {
    theme: "dark",
    accent: "indigo",
    personalRoom: "",
    scheduleKey: newKey(),
    notifications: { reminders: true, chat: true, weekly: false },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      savePrefs(fallback);
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const merged = {
      ...fallback,
      ...parsed,
      notifications: { ...fallback.notifications, ...(parsed.notifications ?? {}) },
    };
    if (!merged.scheduleKey) merged.scheduleKey = newKey();
    // Persist migrations/defaults so the schedule key is stable across reloads.
    savePrefs(merged);
    return merged;
  } catch {
    savePrefs(fallback);
    return fallback;
  }
}

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are best effort.
  }
}

export function applyTheme(mode: ThemeMode, accentId: string) {
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const accent = ACCENTS.find((item) => item.id === accentId) ?? ACCENTS[0];
  const style = document.documentElement.style;
  style.setProperty("--accent", accent.c);
  style.setProperty("--accent-h", accent.h);
  style.setProperty("--accent-l", accent.l);
  style.setProperty("--accent-soft", `${accent.c}24`);
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return `${base || "personal"}-room`;
}
