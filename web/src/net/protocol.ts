/**
 * ONLINE MULTIPLAYER WIRE PROTOCOL - the single source of truth for every
 * message that crosses the socket. Client and relay server both import this
 * file, so a field can never drift between the two halves.
 *
 * DESIGN RULES
 *
 * 1. The SERVER is authoritative over legality, turn order, the clock and the
 *    result. A client may render optimistically, but the server's position
 *    always wins - every `moved` message carries the resulting FEN so a client
 *    that has diverged can detect it on the very next ply and resync.
 *
 * 2. Every message is a flat, JSON-serialisable object with a `t` tag. No
 *    ad-hoc strings invented at call sites; if it is not in this file it is not
 *    on the wire.
 *
 * 3. Seats are identified by colour, not by connection. A dropped player keeps
 *    the seat for RECONNECT_GRACE_MS and returns with the same token, so a tab
 *    reload or a phone locking its screen does not forfeit the game.
 */

export const PROTOCOL_VERSION = 1;

/** Room codes avoid vowels (no accidental words) and 0/O/1/I/L (misreads). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

/** A seat is held this long after a disconnect before the game is forfeited. */
export const RECONNECT_GRACE_MS = 60_000;

/** Client heartbeat period. The server evicts a socket after 2.5x this. */
export const HEARTBEAT_MS = 15_000;

/** An empty room is collected after this long with nobody connected. */
export const ROOM_IDLE_TTL_MS = 30 * 60_000;

export type WireColor = "w" | "b";

export type SeatPreference = "w" | "b" | "random";

/** Terminal states the server can declare. Mirrors the local EndReason set. */
export type WireEndReason =
  | "checkmate"
  | "stalemate"
  | "resignation"
  | "timeout"
  | "threefold"
  | "insufficient"
  | "fiftymove"
  | "draw"
  | "abandoned";

export interface WireResult {
  winner: WireColor | null;
  reason: WireEndReason;
}

/** One played ply as broadcast. `fen` is the position AFTER the move. */
export interface WireMove {
  ply: number;
  color: WireColor;
  from: string;
  to: string;
  promotion: string | null;
  san: string;
  fen: string;
}

export interface WireClock {
  enabled: boolean;
  initialMs: number;
  whiteMs: number;
  blackMs: number;
}

export interface WirePlayer {
  color: WireColor;
  name: string;
  connected: boolean;
}

/** Everything a joining or reconnecting client needs to rebuild the board. */
export interface WireGameState {
  code: string;
  fen: string;
  moves: WireMove[];
  turn: WireColor;
  started: boolean;
  over: boolean;
  result: WireResult | null;
  clock: WireClock;
  players: WirePlayer[];
}

// --------------------------------------------------------------- client -> server

export interface CreateMsg {
  t: "create";
  v: number;
  name: string;
  seat: SeatPreference;
  clockMinutes: number | null;
}

export interface JoinMsg {
  t: "join";
  v: number;
  name: string;
  code: string;
}

/** Reclaim a seat after a drop. Token was issued by `seated`. */
export interface ResumeMsg {
  t: "resume";
  v: number;
  code: string;
  token: string;
}

export interface MoveMsg {
  t: "move";
  from: string;
  to: string;
  promotion: string | null;
}

export interface ResignMsg {
  t: "resign";
}

export interface RematchMsg {
  t: "rematch";
}

export interface LeaveMsg {
  t: "leave";
}

export interface PingMsg {
  t: "ping";
  at: number;
}

export type ClientMessage =
  | CreateMsg
  | JoinMsg
  | ResumeMsg
  | MoveMsg
  | ResignMsg
  | RematchMsg
  | LeaveMsg
  | PingMsg;

// --------------------------------------------------------------- server -> client

/** Sent once the socket is accepted, before any room exists. */
export interface HelloMsg {
  t: "hello";
  v: number;
}

/** The seat assignment. `token` must be kept to reconnect into this seat. */
export interface SeatedMsg {
  t: "seated";
  code: string;
  token: string;
  color: WireColor;
  state: WireGameState;
}

/** Full authoritative state - sent on join, resume, rematch and any resync. */
export interface StateMsg {
  t: "state";
  state: WireGameState;
}

/** A legal move was accepted. Carries the post-move FEN for divergence checks. */
export interface MovedMsg {
  t: "moved";
  move: WireMove;
  clock: WireClock;
  /** True when this echoes a move the recipient itself submitted. */
  self: boolean;
}

export interface OverMsg {
  t: "over";
  result: WireResult;
  state: WireGameState;
}

export interface PeerMsg {
  t: "peer";
  event: "joined" | "left" | "dropped" | "resumed";
  color: WireColor;
  name: string;
}

export interface RematchOfferMsg {
  t: "rematch-offer";
  by: WireColor;
}

/** Server clock authority. Broadcast on a low cadence, not per frame. */
export interface ClockMsg {
  t: "clock";
  clock: WireClock;
}

export type WireErrorCode =
  | "bad-version"
  | "bad-message"
  | "no-room"
  | "room-full"
  | "bad-token"
  | "not-your-turn"
  | "illegal-move"
  | "not-seated"
  | "game-over"
  | "rate-limited"
  | "server-error";

export interface ErrorMsg {
  t: "error";
  code: WireErrorCode;
  message: string;
  /** Fatal errors mean the client should drop back to the lobby. */
  fatal: boolean;
}

export interface PongMsg {
  t: "pong";
  at: number;
}

export type ServerMessage =
  | HelloMsg
  | SeatedMsg
  | StateMsg
  | MovedMsg
  | OverMsg
  | PeerMsg
  | RematchOfferMsg
  | ClockMsg
  | ErrorMsg
  | PongMsg;

// ------------------------------------------------------------------- helpers

/** Normalises user input: trims, uppercases, strips non-alphabet characters. */
export function normaliseRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(raw: string): boolean {
  if (typeof raw !== "string") return false;
  // Count the alphabet characters WITHOUT truncating. Validating the
  // truncated form would accept an over-length code and silently resolve
  // it to a different room than the user supplied.
  const kept = raw
    .toUpperCase()
    .split("")
    .filter((char) => ROOM_CODE_ALPHABET.includes(char));
  return kept.length === ROOM_CODE_LENGTH;
}

/**
 * Parses an inbound frame without trusting it. Returns null rather than
 * throwing, so a malformed or hostile payload can never kill the socket.
 */
export function parseMessage<T>(raw: string): T | null {
  if (typeof raw !== "string" || raw.length > 64_000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof (value as { t?: unknown }).t !== "string") return null;
    return value as T;
  } catch {
    return null;
  }
}

/** Square ids are exactly file+rank, e.g. "e4". Guards the server move path. */
export function isSquareId(value: unknown): value is string {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

export function isPromotionPiece(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && /^[qrbn]$/.test(value));
}
