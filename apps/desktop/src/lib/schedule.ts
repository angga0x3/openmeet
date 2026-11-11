export type ScheduleEntry = {
  id: string;
  title: string;
  start: number;
  duration: number;
  room: string;
  color: string;
};

const KEY = "openmeet.schedule.v1";
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
export const SCHEDULE_COLORS = ["#6366f1", "#0ea5e9", "#ec4899", "#f59e0b", "#10b981", "#8b5cf6"];

function pick(count: number): string {
  let out = "";
  const random = new Uint32Array(count);
  crypto.getRandomValues(random);
  for (let i = 0; i < count; i += 1) out += ALPHABET[random[i] % ALPHABET.length];
  return out;
}

export function roomCode(): string {
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

export function loadSchedule(): ScheduleEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ScheduleEntry[];
    return Array.isArray(list) ? list.filter((entry) => entry && entry.room && entry.start) : [];
  } catch {
    return [];
  }
}

export function saveSchedule(entries: ScheduleEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    // Scheduling is best effort.
  }
}

export function upcoming(entries: ScheduleEntry[], now = Date.now()): ScheduleEntry[] {
  return entries
    .filter((entry) => entry.start + entry.duration * 60000 > now)
    .sort((a, b) => a.start - b.start);
}

export function nextColor(entries: ScheduleEntry[]): string {
  return SCHEDULE_COLORS[entries.length % SCHEDULE_COLORS.length];
}

function httpBase(serverUrl: string): string {
  return serverUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/^ws(s?):\/\//i, "http$1://");
}

export async function fetchRemoteSchedule(
  serverUrl: string,
  key: string,
): Promise<ScheduleEntry[]> {
  const response = await fetch(`${httpBase(serverUrl)}/api/schedule`, {
    headers: { "x-openmeet-key": key },
  });
  if (!response.ok) throw new Error(`schedule ${response.status}`);
  return (await response.json()) as ScheduleEntry[];
}

export async function createRemoteSchedule(
  serverUrl: string,
  key: string,
  input: { title: string; start: number; duration: number; color: string },
): Promise<ScheduleEntry> {
  const response = await fetch(`${httpBase(serverUrl)}/api/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openmeet-key": key },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `schedule ${response.status}`);
  }
  return (await response.json()) as ScheduleEntry;
}

export async function deleteRemoteSchedule(
  serverUrl: string,
  key: string,
  id: string,
): Promise<void> {
  await fetch(`${httpBase(serverUrl)}/api/schedule/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-openmeet-key": key },
  });
}
