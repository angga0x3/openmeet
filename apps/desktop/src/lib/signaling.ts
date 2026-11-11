import type { Peer, ServerMsg, SignalData } from "../types";

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

type Handlers = {
  welcome: Extract<ServerMsg, { type: "welcome" }>;
  peer_joined: Extract<ServerMsg, { type: "peer_joined" }>;
  peer_left: Extract<ServerMsg, { type: "peer_left" }>;
  signal: Extract<ServerMsg, { type: "signal" }>;
  chat: Extract<ServerMsg, { type: "chat" }>;
  state: Extract<ServerMsg, { type: "state" }>;
  reaction: Extract<ServerMsg, { type: "reaction" }>;
  room_closed: Extract<ServerMsg, { type: "room_closed" }>;
  error: Extract<ServerMsg, { type: "error" }>;
  status: ConnectionStatus;
};

export function wsUrl(base: string): string {
  let value = base.trim().replace(/\/+$/, "");
  if (/^https:\/\//i.test(value)) value = value.replace(/^https/i, "wss");
  else if (/^http:\/\//i.test(value)) value = value.replace(/^http/i, "ws");
  else if (!/^wss?:\/\//i.test(value)) value = `ws://${value}`;
  return `${value}/ws`;
}

export type JoinOptions = {
  serverUrl: string;
  room: string;
  name: string;
  passcode?: string;
  mic: boolean;
  cam: boolean;
};

export class SignalClient {
  private ws: WebSocket | null = null;
  private listeners: { [K in keyof Handlers]?: Array<(value: Handlers[K]) => void> } = {};
  private closedByUs = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: JoinOptions) {}

  on<K extends keyof Handlers>(event: K, handler: (value: Handlers[K]) => void): () => void {
    const list = (this.listeners[event] ??= []) as Array<(value: Handlers[K]) => void>;
    list.push(handler);
    return () => {
      const current = this.listeners[event] as Array<(value: Handlers[K]) => void> | undefined;
      if (!current) return;
      this.listeners[event] = current.filter((fn) => fn !== handler) as never;
    };
  }

  private emit<K extends keyof Handlers>(event: K, value: Handlers[K]) {
    const list = this.listeners[event] as Array<(value: Handlers[K]) => void> | undefined;
    list?.forEach((fn) => fn(value));
  }

  connect(): void {
    this.emit("status", "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(this.opts.serverUrl));
    } catch {
      this.emit("status", "error");
      this.emit("error", {
        type: "error",
        code: "bad_server_url",
        message: "The signaling address is not valid.",
      });
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.emit("status", "open");
      this.send({
        type: "join",
        room: this.opts.room,
        name: this.opts.name,
        passcode: this.opts.passcode || undefined,
        mic: this.opts.mic,
        cam: this.opts.cam,
      });
      this.heartbeat = setInterval(() => this.send({ type: "ping" }), 25000);
    };

    socket.onmessage = (event) => {
      let message: ServerMsg;
      try {
        message = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (message.type) {
        case "welcome":
          this.emit("welcome", message);
          break;
        case "peer_joined":
          this.emit("peer_joined", message);
          break;
        case "peer_left":
          this.emit("peer_left", message);
          break;
        case "signal":
          this.emit("signal", message);
          break;
        case "chat":
          this.emit("chat", message);
          break;
        case "state":
          this.emit("state", message);
          break;
        case "reaction":
          this.emit("reaction", message);
          break;
        case "room_closed":
          this.emit("room_closed", message);
          break;
        case "error":
          this.emit("error", message);
          break;
        default:
          break;
      }
    };

    socket.onclose = () => {
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
      this.ws = null;
      this.emit("status", this.closedByUs ? "closed" : "error");
    };

    socket.onerror = () => {
      this.emit("status", "error");
    };
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  signal(to: string, data: SignalData) {
    this.send({ type: "signal", to, data });
  }

  chat(text: string) {
    this.send({ type: "chat", text });
  }

  state(mic: boolean, cam: boolean, sharing: boolean) {
    this.send({ type: "state", mic, cam, sharing });
  }

  reaction(emoji: string) {
    this.send({ type: "reaction", emoji });
  }

  endMeeting() {
    this.send({ type: "end_meeting" });
  }

  leave() {
    this.closedByUs = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.send({ type: "leave" });
    this.ws?.close();
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export function selfPeer(id: string, name: string, mic: boolean, cam: boolean): Peer {
  return { id, name, mic, cam, sharing: false };
}

export async function fetchIceServers(serverUrl: string): Promise<IceServerFallback> {
  const base = serverUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/^ws(s?):\/\//i, "http$1://");
  const res = await fetch(`${base}/api/config`);
  if (!res.ok) throw new Error(`config ${res.status}`);
  return (await res.json()) as IceServerFallback;
}

type IceServerFallback = {
  ice_servers: Array<{ urls: string[]; username?: string; credential?: string }>;
  max_participants: number;
};

export async function createRoom(serverUrl: string, passcode?: string, id?: string): Promise<string> {
  const base = serverUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/^ws(s?):\/\//i, "http$1://");
  const res = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: passcode || undefined, id: id || undefined }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Could not create a room (${res.status}).`);
  }
  const body = (await res.json()) as { room_id: string };
  return body.room_id;
}

export async function roomExists(serverUrl: string, room: string): Promise<boolean> {
  const base = serverUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/^ws(s?):\/\//i, "http$1://");
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(room)}`);
  return res.ok;
}
