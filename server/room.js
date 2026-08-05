// Authoritative room state. Pure logic, no socket knowledge - so it is unit
// testable without standing up a server.
//
// The room owns the chess position. A client's move is a REQUEST; this file
// decides whether it happened. That is what stops a tampered client from
// injecting an illegal move, moving out of turn, or moving the opponent's army.

import { Chess } from "chess.js";

import {
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "./protocolConstants.js";

export function makeRoomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function makeToken(random = Math.random) {
  let token = "";
  for (let i = 0; i < 24; i += 1) {
    token += Math.floor(random() * 36).toString(36);
  }
  return token;
}

export class Room {
  constructor(code, options = {}) {
    this.code = code;
    this.chess = new Chess();
    this.moves = [];
    this.over = false;
    this.result = null;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.rematchOffers = new Set();

    const minutes = options.clockMinutes ?? null;
    const ms = minutes ? minutes * 60_000 : 0;
    this.clock = {
      enabled: minutes !== null,
      initialMs: ms,
      whiteMs: ms,
      blackMs: ms,
    };
    this.clockRunningSince = null;

    // seat -> { token, name, connected, disconnectedAt }
    this.seats = { w: null, b: null };
  }

  get started() {
    return Boolean(this.seats.w && this.seats.b);
  }

  isEmpty() {
    return !this.seats.w && !this.seats.b;
  }

  hasConnected() {
    return Boolean(this.seats.w?.connected || this.seats.b?.connected);
  }

  freeSeat(preference) {
    if (preference === "w" && !this.seats.w) return "w";
    if (preference === "b" && !this.seats.b) return "b";
    if (!this.seats.w) return "w";
    if (!this.seats.b) return "b";
    return null;
  }

  /** Seats a player. Returns { color, token } or null when the room is full. */
  seat(name, preference, random = Math.random) {
    let color = this.freeSeat(preference);
    if (!color) return null;
    if (preference === "random" && !this.seats.w && !this.seats.b) {
      color = random() < 0.5 ? "w" : "b";
    }
    const token = makeToken(random);
    this.seats[color] = {
      token,
      name: sanitiseName(name),
      connected: true,
      disconnectedAt: null,
    };
    this.touch();
    if (this.started) this.startClock();
    return { color, token };
  }

  /** Reclaims a seat with a previously issued token. */
  resume(token) {
    for (const color of ["w", "b"]) {
      const seat = this.seats[color];
      if (seat && seat.token === token) {
        seat.connected = true;
        seat.disconnectedAt = null;
        this.touch();
        return color;
      }
    }
    return null;
  }

  markDisconnected(color) {
    const seat = this.seats[color];
    if (!seat) return;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    this.touch();
  }

  /** Permanently vacates a seat (explicit leave, not a drop). */
  vacate(color) {
    this.seats[color] = null;
    this.rematchOffers.delete(color);
    this.touch();
  }

  colorFor(token) {
    for (const color of ["w", "b"]) {
      if (this.seats[color]?.token === token) return color;
    }
    return null;
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  // ------------------------------------------------------------------- clock

  startClock() {
    if (!this.clock.enabled || this.over) return;
    if (this.clockRunningSince === null) this.clockRunningSince = Date.now();
  }

  stopClock() {
    this.settleClock();
    this.clockRunningSince = null;
  }

  /** Deducts elapsed time from the side to move. Idempotent per call site. */
  settleClock() {
    if (!this.clock.enabled || this.clockRunningSince === null || this.over) return;
    const now = Date.now();
    const elapsed = now - this.clockRunningSince;
    this.clockRunningSince = now;
    const turn = this.chess.turn();
    if (turn === "w") this.clock.whiteMs = Math.max(0, this.clock.whiteMs - elapsed);
    else this.clock.blackMs = Math.max(0, this.clock.blackMs - elapsed);
  }

  /** Returns a result when a flag has fallen, else null. */
  checkFlag() {
    if (!this.clock.enabled || this.over) return null;
    this.settleClock();
    if (this.clock.whiteMs === 0) return this.finish({ winner: "b", reason: "timeout" });
    if (this.clock.blackMs === 0) return this.finish({ winner: "w", reason: "timeout" });
    return null;
  }

  // -------------------------------------------------------------------- play

  /**
   * Applies a move on behalf of `color`. Returns { ok: true, move } or
   * { ok: false, code } - never throws, so a hostile payload cannot crash the
   * process.
   */
  applyMove(color, from, to, promotion) {
    if (this.over) return { ok: false, code: "game-over" };
    if (!this.started) return { ok: false, code: "not-seated" };
    if (this.chess.turn() !== color) return { ok: false, code: "not-your-turn" };

    this.settleClock();

    let move = null;
    try {
      move = this.chess.move({ from, to, promotion: promotion ?? "q" });
    } catch {
      move = null;
    }
    if (!move) return { ok: false, code: "illegal-move" };

    const wire = {
      ply: this.moves.length,
      color: move.color,
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? null,
      san: move.san,
      fen: this.chess.fen(),
    };
    this.moves.push(wire);
    this.rematchOffers.clear();
    this.touch();

    const result = this.evaluateEnd();
    return { ok: true, move: wire, result };
  }

  evaluateEnd() {
    if (!this.chess.isGameOver()) return null;
    const loser = this.chess.turn();
    if (this.chess.isCheckmate()) {
      return this.finish({ winner: loser === "w" ? "b" : "w", reason: "checkmate" });
    }
    if (this.chess.isStalemate()) return this.finish({ winner: null, reason: "stalemate" });
    if (this.chess.isThreefoldRepetition()) return this.finish({ winner: null, reason: "threefold" });
    if (this.chess.isInsufficientMaterial()) return this.finish({ winner: null, reason: "insufficient" });
    return this.finish({ winner: null, reason: "draw" });
  }

  resign(color) {
    if (this.over) return null;
    return this.finish({ winner: color === "w" ? "b" : "w", reason: "resignation" });
  }

  abandon(color) {
    if (this.over) return null;
    return this.finish({ winner: color === "w" ? "b" : "w", reason: "abandoned" });
  }

  finish(result) {
    if (this.over) return this.result;
    this.over = true;
    this.result = result;
    this.clockRunningSince = null;
    this.touch();
    return result;
  }

  /** Both seats must ask before the board resets. Colours swap each rematch. */
  offerRematch(color) {
    if (!this.over) return false;
    this.rematchOffers.add(color);
    this.touch();
    if (this.rematchOffers.size < 2) return false;
    this.rematchOffers.clear();
    this.resetForRematch();
    return true;
  }

  resetForRematch() {
    this.chess = new Chess();
    this.moves = [];
    this.over = false;
    this.result = null;
    const ms = this.clock.initialMs;
    this.clock.whiteMs = ms;
    this.clock.blackMs = ms;
    // Swap seats so nobody is stuck playing the same colour forever.
    const white = this.seats.w;
    this.seats.w = this.seats.b;
    this.seats.b = white;
    this.clockRunningSince = null;
    if (this.started) this.startClock();
  }

  /** Seats whose grace period has expired. Caller decides the forfeit. */
  expiredSeats(now = Date.now()) {
    const expired = [];
    for (const color of ["w", "b"]) {
      const seat = this.seats[color];
      if (!seat || seat.connected || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt >= RECONNECT_GRACE_MS) expired.push(color);
    }
    return expired;
  }

  toState() {
    this.settleClock();
    const players = [];
    for (const color of ["w", "b"]) {
      const seat = this.seats[color];
      if (seat) players.push({ color, name: seat.name, connected: seat.connected });
    }
    return {
      code: this.code,
      fen: this.chess.fen(),
      moves: this.moves.slice(),
      turn: this.chess.turn(),
      started: this.started,
      over: this.over,
      result: this.result,
      clock: { ...this.clock },
      players,
    };
  }
}

export function sanitiseName(raw) {
  const text = typeof raw === "string" ? raw : "";
  const cleaned = text.replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  return cleaned.slice(0, 20) || "Challenger";
}
