export type Peer = {
  id: string;
  name: string;
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  hand: boolean;
};

export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export type SignalData =
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit | null };

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  self: boolean;
};

export type ReactionEvent = {
  id: string;
  from: string;
  name: string;
  emoji: string;
};

export type ServerMsg =
  | {
      type: "welcome";
      self_id: string;
      room: string;
      peers: Peer[];
      ice_servers: IceServer[];
      is_host: boolean;
    }
  | { type: "peer_joined"; peer: Peer }
  | { type: "peer_left"; peer_id: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "chat"; from: string; name: string; text: string; ts: number }
  | { type: "state"; from: string; mic: boolean; cam: boolean; sharing: boolean; hand: boolean }
  | { type: "reaction"; from: string; name: string; emoji: string }
  | { type: "room_closed"; reason: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export type Settings = {
  displayName: string;
  serverUrl: string;
  cameraId: string;
  micId: string;
  speakerId: string;
  startMuted: boolean;
  startVideoOff: boolean;
  noiseSuppression: boolean;
};

export type HistoryEntry = {
  room: string;
  startedAt: number;
  durationSecs: number;
  participants: number;
};

export type RemoteView = {
  peer: Peer;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  connection: RTCPeerConnectionState | "new";
};

export function roomCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[a-z0-9]{6,32}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    const fromPath = url.pathname.split("/").filter(Boolean).pop();
    const fromQuery = url.searchParams.get("room") ?? url.searchParams.get("code");
    const code = fromQuery ?? fromPath ?? "";
    return /^[a-z0-9]{6,32}$/i.test(code) ? code.toLowerCase() : "";
  } catch {
    return "";
  }
}

export function httpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
