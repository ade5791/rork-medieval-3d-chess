// King's Gambit - online multiplayer relay.
//
// A small authoritative WebSocket server: it owns the chess position for every
// room, validates each move with chess.js before broadcasting it, runs the
// clock, and holds a seat open across a reconnect.
//
// Run:  node server/index.js          (PORT env, default 8787)
// Health: GET /health -> { ok, rooms, sockets, uptimeMs }

import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  ROOM_IDLE_TTL_MS,
} from "./protocolConstants.js";
import { Room, makeRoomCode, sanitiseName } from "./room.js";

const PORT = Number(process.env.PORT ?? 8787);

/** code -> Room */
const rooms = new Map();
/** socket -> { code, color, token, alive, lastMessageAt, messageBudget } */
const sessions = new Map();

const MAX_ROOMS = 500;
/** Messages allowed per socket per second before the socket is throttled. */
const RATE_LIMIT_PER_SEC = 20;

// ------------------------------------------------------------------- helpers

function send(socket, message) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    console.warn("[net] send failed", error?.message ?? error);
  }
}

function fail(socket, code, message, fatal = false) {
  send(socket, { t: "error", code, message, fatal });
}

function broadcast(code, message, exclude = null) {
  for (const [socket, session] of sessions) {
    if (session.code !== code || socket === exclude) continue;
    send(socket, message);
  }
}

function socketsIn(code) {
  const out = [];
  for (const [socket, session] of sessions) {
    if (session.code === code) out.push([socket, session]);
  }
  return out;
}

function pushState(code) {
  const room = rooms.get(code);
  if (!room) return;
  const state = room.toState();
  broadcast(code, { t: "state", state });
}

function declareOver(room, result) {
  if (!result) return;
  broadcast(room.code, { t: "over", result, state: room.toState() });
}

/** Guards against a client flooding the socket. Returns false when throttled. */
function withinRateLimit(session) {
  const now = Date.now();
  if (now - session.windowStartedAt >= 1000) {
    session.windowStartedAt = now;
    session.messageBudget = RATE_LIMIT_PER_SEC;
  }
  session.messageBudget -= 1;
  return session.messageBudget >= 0;
}

function parseFrame(raw) {
  const text = typeof raw === "string" ? raw : raw?.toString?.("utf8");
  if (typeof text !== "string" || text.length > 64_000) return null;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.t !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function isSquareId(value) {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

function isPromotionPiece(value) {
  return value === null || value === undefined || (typeof value === "string" && /^[qrbn]$/.test(value));
}

// -------------------------------------------------------------------- server

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(
      JSON.stringify({
        ok: true,
        v: PROTOCOL_VERSION,
        rooms: rooms.size,
        sockets: sessions.size,
        uptimeMs: Math.round(process.uptime() * 1000),
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("King's Gambit relay. Connect over WebSocket.");
});

const wss = new WebSocketServer({ server: http });

wss.on("connection", (socket) => {
  sessions.set(socket, {
    code: null,
    color: null,
    token: null,
    alive: true,
    windowStartedAt: Date.now(),
    messageBudget: RATE_LIMIT_PER_SEC,
  });
  send(socket, { t: "hello", v: PROTOCOL_VERSION });

  socket.on("pong", () => {
    const session = sessions.get(socket);
    if (session) session.alive = true;
  });

  socket.on("message", (raw) => {
    const session = sessions.get(socket);
    if (!session) return;

    if (!withinRateLimit(session)) {
      fail(socket, "rate-limited", "Too many messages.", false);
      return;
    }

    const msg = parseFrame(raw);
    if (!msg) {
      fail(socket, "bad-message", "Unreadable message.");
      return;
    }

    try {
      handle(socket, session, msg);
    } catch (error) {
      console.error("[net] handler threw", error);
      fail(socket, "server-error", "The relay hit an error handling that.");
    }
  });

  socket.on("close", () => {
    const session = sessions.get(socket);
    sessions.delete(socket);
    if (!session?.code || !session.color) return;
    const room = rooms.get(session.code);
    if (!room) return;
    room.markDisconnected(session.color);
    const seat = room.seats[session.color];
    broadcast(session.code, {
      t: "peer",
      event: "dropped",
      color: session.color,
      name: seat?.name ?? "Challenger",
    });
    pushState(session.code);
  });

  socket.on("error", (error) => {
    console.warn("[net] socket error", error?.message ?? error);
  });
});

function handle(socket, session, msg) {
  switch (msg.t) {
    case "ping":
      send(socket, { t: "pong", at: typeof msg.at === "number" ? msg.at : Date.now() });
      return;

    case "create":
      handleCreate(socket, session, msg);
      return;

    case "join":
      handleJoin(socket, session, msg);
      return;

    case "resume":
      handleResume(socket, session, msg);
      return;

    case "move":
      handleMove(socket, session, msg);
      return;

    case "resign":
      handleResign(socket, session);
      return;

    case "rematch":
      handleRematch(socket, session);
      return;

    case "leave":
      handleLeave(socket, session);
      return;

    default:
      fail(socket, "bad-message", `Unknown message type "${msg.t}".`);
  }
}

function handleCreate(socket, session, msg) {
  if (msg.v !== PROTOCOL_VERSION) {
    fail(socket, "bad-version", "This client is out of date. Reload the page.", true);
    return;
  }
  if (rooms.size >= MAX_ROOMS) {
    fail(socket, "server-error", "The relay is at capacity. Try again shortly.", true);
    return;
  }

  let code = makeRoomCode();
  let guard = 0;
  while (rooms.has(code) && guard < 50) {
    code = makeRoomCode();
    guard += 1;
  }

  const minutes = Number.isFinite(msg.clockMinutes) ? Number(msg.clockMinutes) : null;
  const room = new Room(code, { clockMinutes: minutes && minutes > 0 ? minutes : null });
  rooms.set(code, room);

  const seat = room.seat(msg.name, msg.seat === "w" || msg.seat === "b" ? msg.seat : "random");
  if (!seat) {
    fail(socket, "server-error", "Could not open a seat.");
    return;
  }

  session.code = code;
  session.color = seat.color;
  session.token = seat.token;

  send(socket, {
    t: "seated",
    code,
    token: seat.token,
    color: seat.color,
    state: room.toState(),
  });
  console.log(`[room] created ${code} (${rooms.size} open)`);
}

function handleJoin(socket, session, msg) {
  if (msg.v !== PROTOCOL_VERSION) {
    fail(socket, "bad-version", "This client is out of date. Reload the page.", true);
    return;
  }
  const code = typeof msg.code === "string" ? msg.code.toUpperCase().trim() : "";
  const room = rooms.get(code);
  if (!room) {
    fail(socket, "no-room", "No hall with that code. Check the letters and try again.", true);
    return;
  }
  const seat = room.seat(msg.name, "random");
  if (!seat) {
    fail(socket, "room-full", "That hall already has two commanders.", true);
    return;
  }

  session.code = code;
  session.color = seat.color;
  session.token = seat.token;

  send(socket, { t: "seated", code, token: seat.token, color: seat.color, state: room.toState() });
  broadcast(
    code,
    { t: "peer", event: "joined", color: seat.color, name: sanitiseName(msg.name) },
    socket,
  );
  pushState(code);
  console.log(`[room] ${code} joined as ${seat.color}`);
}

function handleResume(socket, session, msg) {
  if (msg.v !== PROTOCOL_VERSION) {
    fail(socket, "bad-version", "This client is out of date. Reload the page.", true);
    return;
  }
  const code = typeof msg.code === "string" ? msg.code.toUpperCase().trim() : "";
  const room = rooms.get(code);
  if (!room) {
    fail(socket, "no-room", "That hall has closed.", true);
    return;
  }
  const color = room.resume(typeof msg.token === "string" ? msg.token : "");
  if (!color) {
    fail(socket, "bad-token", "That seat is no longer yours.", true);
    return;
  }

  // Evict any stale socket still holding this seat, so one seat is never
  // driven by two live connections.
  for (const [other, otherSession] of socketsIn(code)) {
    if (other !== socket && otherSession.color === color) {
      sessions.delete(other);
      try {
        other.close();
      } catch {
        /* already closing */
      }
    }
  }

  session.code = code;
  session.color = color;
  session.token = msg.token;

  send(socket, { t: "seated", code, token: msg.token, color, state: room.toState() });
  broadcast(
    code,
    { t: "peer", event: "resumed", color, name: room.seats[color]?.name ?? "Challenger" },
    socket,
  );
  pushState(code);
}

function handleMove(socket, session, msg) {
  const room = session.code ? rooms.get(session.code) : null;
  if (!room || !session.color) {
    fail(socket, "not-seated", "You are not seated in a hall.");
    return;
  }
  if (!isSquareId(msg.from) || !isSquareId(msg.to) || !isPromotionPiece(msg.promotion)) {
    fail(socket, "bad-message", "Malformed move.");
    return;
  }

  const flagged = room.checkFlag();
  if (flagged) {
    declareOver(room, flagged);
    return;
  }

  const outcome = room.applyMove(session.color, msg.from, msg.to, msg.promotion ?? null);
  if (!outcome.ok) {
    fail(socket, outcome.code, describe(outcome.code));
    // A rejected move means the client's board disagrees with the server's.
    // Push authoritative state so it can correct itself immediately.
    send(socket, { t: "state", state: room.toState() });
    return;
  }

  const clock = room.toState().clock;
  for (const [target, targetSession] of socketsIn(room.code)) {
    send(target, {
      t: "moved",
      move: outcome.move,
      clock,
      self: targetSession.color === session.color,
    });
  }

  if (outcome.result) declareOver(room, outcome.result);
}

function handleResign(socket, session) {
  const room = session.code ? rooms.get(session.code) : null;
  if (!room || !session.color) {
    fail(socket, "not-seated", "You are not seated in a hall.");
    return;
  }
  const result = room.resign(session.color);
  declareOver(room, result);
}

function handleRematch(socket, session) {
  const room = session.code ? rooms.get(session.code) : null;
  if (!room || !session.color) {
    fail(socket, "not-seated", "You are not seated in a hall.");
    return;
  }
  const restarted = room.offerRematch(session.color);
  if (!restarted) {
    broadcast(room.code, { t: "rematch-offer", by: session.color }, socket);
    return;
  }
  // Seats swapped - every client must be told its new colour.
  for (const [target, targetSession] of socketsIn(room.code)) {
    const color = room.colorFor(targetSession.token);
    if (color) targetSession.color = color;
    send(target, {
      t: "seated",
      code: room.code,
      token: targetSession.token,
      color: color ?? targetSession.color,
      state: room.toState(),
    });
  }
}

function handleLeave(socket, session) {
  const room = session.code ? rooms.get(session.code) : null;
  if (!room || !session.color) return;
  const color = session.color;
  const name = room.seats[color]?.name ?? "Challenger";
  const result = room.started && !room.over ? room.abandon(color) : null;
  room.vacate(color);
  session.code = null;
  session.color = null;
  session.token = null;
  broadcast(room.code, { t: "peer", event: "left", color, name });
  if (result) declareOver(room, result);
  else pushState(room.code);
}

function describe(code) {
  switch (code) {
    case "not-your-turn":
      return "It is not your move.";
    case "illegal-move":
      return "That move is not legal in this position.";
    case "game-over":
      return "This duel has already ended.";
    case "not-seated":
      return "You are not seated in a hall.";
    default:
      return "The relay refused that action.";
  }
}

// ------------------------------------------------------------- housekeeping

const heartbeat = setInterval(() => {
  for (const [socket, session] of sessions) {
    if (!session.alive) {
      sessions.delete(socket);
      try {
        socket.terminate();
      } catch {
        /* already gone */
      }
      continue;
    }
    session.alive = false;
    try {
      socket.ping();
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_MS);

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Forfeit a seat that never came back inside the grace window.
    for (const color of room.expiredSeats(now)) {
      const result = room.started && !room.over ? room.abandon(color) : null;
      room.vacate(color);
      broadcast(code, { t: "peer", event: "left", color, name: "Challenger" });
      if (result) declareOver(room, result);
    }

    const flagged = room.checkFlag();
    if (flagged) declareOver(room, flagged);
    else if (room.clock.enabled && room.started && !room.over) {
      broadcast(code, { t: "clock", clock: room.toState().clock });
    }

    const idle = now - room.lastActivityAt;
    if (!room.hasConnected() && idle > ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
      console.log(`[room] swept ${code}`);
    }
  }
}, 1000);

http.listen(PORT, () => {
  console.log(`[net] King's Gambit relay listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(sweep);
  for (const socket of sessions.keys()) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  wss.close(() => http.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { rooms, sessions };
