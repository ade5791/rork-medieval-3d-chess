/**
 * ONLINE CLIENT - the browser half of the multiplayer transport.
 *
 * Owns exactly one WebSocket and the seat token. Everything above it (the
 * React lobby, the GameController bridge) talks to it through the typed
 * emitter and never touches the socket directly.
 *
 * RECONNECT POLICY
 * The seat token is written to sessionStorage the moment it is issued. On an
 * unclean close the client backs off exponentially and sends `resume` rather
 * than `join`, so a tab reload, a sleeping phone or a dropped wifi link returns
 * to the same seat with the full move list replayed - it does not forfeit.
 */

import { Emitter } from "../core/emitter";
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type SeatPreference,
  type ServerMessage,
  type WireClock,
  type WireColor,
  type WireGameState,
  type WireMove,
  type WireResult,
  parseMessage,
} from "./protocol";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

interface OnlineEvents {
  status: { status: ConnectionStatus; detail: string | null };
  seated: { code: string; color: WireColor; state: WireGameState };
  state: WireGameState;
  moved: { move: WireMove; clock: WireClock; self: boolean };
  over: { result: WireResult; state: WireGameState };
  peer: { event: "joined" | "left" | "dropped" | "resumed"; color: WireColor; name: string };
  rematchOffer: { by: WireColor };
  clock: WireClock;
  failed: { code: string; message: string; fatal: boolean };
  latency: { ms: number };
}

const STORAGE_KEY = "kg.online.seat";

/** Backoff schedule in ms. Caps out rather than growing without bound. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 12_000];

interface StoredSeat {
  code: string;
  token: string;
  color: WireColor;
}

function readStoredSeat(): StoredSeat | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSeat>;
    if (typeof value?.code !== "string" || typeof value?.token !== "string") return null;
    if (value.color !== "w" && value.color !== "b") return null;
    return { code: value.code, token: value.token, color: value.color };
  } catch {
    return null;
  }
}

function writeStoredSeat(seat: StoredSeat | null): void {
  try {
    if (seat) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seat));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode - reconnect simply will not survive a reload */
  }
}

/**
 * Resolves the relay URL.
 *
 * `VITE_MULTIPLAYER_URL` wins when set. Otherwise it derives from the page
 * origin, which is what makes a single-origin deploy (relay behind the same
 * host at /ws) work with no configuration at all.
 */
export function resolveRelayUrl(): string {
  const configured = import.meta.env?.VITE_MULTIPLAYER_URL as string | undefined;
  if (configured && configured.length > 0) return configured;
  if (typeof window === "undefined") return "ws://localhost:8787";
  const secure = window.location.protocol === "https:";
  const proto = secure ? "wss:" : "ws:";
  // Vite dev server proxies /ws to the relay (see vite.config.ts).
  return `${proto}//${window.location.host}/ws`;
}

/**
 * True when this deployment can plausibly reach a relay: an explicit
 * VITE_MULTIPLAYER_URL, or a host that can proxy /ws on its own origin (the
 * dev server, or a single-origin deploy with the relay behind it). Known
 * static hosts serve files only - a socket to them can never succeed, so
 * attempting one would leave the lobby spinning forever.
 */
export function relayAvailable(): boolean {
  const configured = import.meta.env?.VITE_MULTIPLAYER_URL as string | undefined;
  if (configured && configured.length > 0) return true;
  if (typeof window === "undefined") return true;
  return !window.location.hostname.endsWith(".github.io");
}

export class OnlineClient extends Emitter<OnlineEvents> {
  private socket: WebSocket | null = null;
  private url: string;
  private status: ConnectionStatus = "idle";
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private seat: StoredSeat | null = null;
  /** Queued intent for the moment the socket opens. */
  private pendingIntent: ClientMessage | null = null;
  private disposed = false;
  private lastPingAt = 0;
  /** True once any socket reached OPEN - separates outages from no-relay. */
  private everConnected = false;

  constructor(url: string = resolveRelayUrl()) {
    super();
    this.url = url;
    this.seat = readStoredSeat();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSeat(): StoredSeat | null {
    return this.seat;
  }

  /** True when a previous session left a seat we can walk back into. */
  hasResumableSeat(): boolean {
    return this.seat !== null;
  }

  host(name: string, seat: SeatPreference, clockMinutes: number | null): void {
    if (!this.guardRelay()) return;
    this.pendingIntent = { t: "create", v: PROTOCOL_VERSION, name, seat, clockMinutes };
    this.open();
  }

  /**
   * Refuses an online intent when no relay can exist on this deployment,
   * emitting an honest failure instead of letting the socket spin. Returns
   * true when the attempt may proceed.
   */
  private guardRelay(): boolean {
    if (relayAvailable()) return true;
    this.setStatus("error", null);
    this.emit("failed", {
      code: "no-relay",
      message:
        "Online duels need a relay server, and this static deployment does not include one. " +
        "Play Computer or 2 Players here - or clone the repo and run it locally for online play.",
      fatal: true,
    });
    return false;
  }

  join(name: string, code: string): void {
    if (!this.guardRelay()) return;
    this.pendingIntent = { t: "join", v: PROTOCOL_VERSION, name, code };
    this.open();
  }

  /** Reclaim the stored seat. No-op when there is nothing to reclaim. */
  resume(): boolean {
    if (!this.seat) return false;
    this.pendingIntent = {
      t: "resume",
      v: PROTOCOL_VERSION,
      code: this.seat.code,
      token: this.seat.token,
    };
    this.open();
    return true;
  }

  sendMove(from: string, to: string, promotion: string | null): void {
    this.send({ t: "move", from, to, promotion });
  }

  resign(): void {
    this.send({ t: "resign" });
  }

  requestRematch(): void {
    this.send({ t: "rematch" });
  }

  /** Leaves the room for good and forgets the seat. */
  leave(): void {
    this.send({ t: "leave" });
    this.seat = null;
    writeStoredSeat(null);
    this.close();
  }

  // ------------------------------------------------------------------ socket

  private open(): void {
    if (this.disposed) return;
    this.clearRetry();
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      if (this.socket.readyState === WebSocket.OPEN) this.flushIntent();
      return;
    }
    this.setStatus(this.attempt > 0 ? "reconnecting" : "connecting", null);

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      console.warn("[net] could not open socket", error);
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.everConnected = true;
      this.setStatus("connected", null);
      this.flushIntent();
      this.startPing();
    };

    socket.onmessage = (event) => {
      const msg = parseMessage<ServerMessage>(typeof event.data === "string" ? event.data : "");
      if (!msg) return;
      this.receive(msg);
    };

    socket.onerror = () => {
      // `onclose` always follows; the retry is scheduled there so it happens
      // exactly once per failed connection.
    };

    socket.onclose = () => {
      this.stopPing();
      this.socket = null;
      if (this.disposed) return;
      // A stored seat means the game is still live somewhere - keep trying.
      if (this.seat) this.scheduleRetry();
      else if (!this.everConnected) {
        // Never reached the relay at all: report it once, honestly, instead of
        // leaving the lobby stuck on a spinner.
        this.setStatus("error", null);
        this.emit("failed", {
          code: "unreachable",
          message: "Could not reach the relay. It may be down - try again in a moment.",
          fatal: false,
        });
      } else this.setStatus("closed", null);
    };
  }

  private flushIntent(): void {
    const intent = this.pendingIntent;
    // A reconnect with a live seat always resumes, even if the original intent
    // was create/join - re-sending `create` would orphan the running game.
    if (!intent && this.seat) {
      this.rawSend({ t: "resume", v: PROTOCOL_VERSION, code: this.seat.code, token: this.seat.token });
      return;
    }
    if (!intent) return;
    this.pendingIntent = null;
    this.rawSend(intent);
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case "hello":
        if (msg.v !== PROTOCOL_VERSION) {
          this.emit("failed", {
            code: "bad-version",
            message: "The relay is running a different protocol. Reload the page.",
            fatal: true,
          });
        }
        return;

      case "seated": {
        this.seat = { code: msg.code, token: msg.token, color: msg.color };
        writeStoredSeat(this.seat);
        this.emit("seated", { code: msg.code, color: msg.color, state: msg.state });
        return;
      }

      case "state":
        this.emit("state", msg.state);
        return;

      case "moved":
        this.emit("moved", { move: msg.move, clock: msg.clock, self: msg.self });
        return;

      case "over":
        this.emit("over", { result: msg.result, state: msg.state });
        return;

      case "peer":
        this.emit("peer", { event: msg.event, color: msg.color, name: msg.name });
        return;

      case "rematch-offer":
        this.emit("rematchOffer", { by: msg.by });
        return;

      case "clock":
        this.emit("clock", msg.clock);
        return;

      case "pong":
        if (this.lastPingAt > 0) {
          this.emit("latency", { ms: Math.max(0, Math.round(performance.now() - this.lastPingAt)) });
        }
        return;

      case "error": {
        if (msg.fatal) {
          // A fatal error means the seat is gone - stop retrying into it.
          this.seat = null;
          writeStoredSeat(null);
          this.pendingIntent = null;
          this.setStatus("error", msg.message);
          this.close();
        }
        this.emit("failed", { code: msg.code, message: msg.message, fatal: msg.fatal });
        return;
      }

      default:
        return;
    }
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[net] dropped a message - socket is not open", message.t);
      return;
    }
    this.rawSend(message);
  }

  private rawSend(message: ClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch (error) {
      console.warn("[net] send failed", error);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.lastPingAt = performance.now();
      this.send({ t: "ping", at: Date.now() });
    }, HEARTBEAT_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.clearRetry();
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.setStatus("reconnecting", `Reconnecting in ${Math.round(delay / 100) / 10}s...`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus, detail: string | null): void {
    this.status = status;
    this.emit("status", { status, detail });
  }

  private close(): void {
    this.stopPing();
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* already closing */
    }
  }

  /** Full teardown. Safe to call twice. */
  dispose(): void {
    this.disposed = true;
    this.close();
    this.clear();
  }

  /** Drops the stored seat without touching the socket (used after game over). */
  forgetSeat(): void {
    this.seat = null;
    writeStoredSeat(null);
  }
}
