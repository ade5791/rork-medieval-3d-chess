/**
 * END-TO-END MULTIPLAYER GATE
 *
 * Boots the real relay in-process and drives TWO real WebSocket clients
 * through a full online duel. This is the difference between "the code reads
 * correctly" and "two browsers can actually play each other".
 *
 * Every check below is an authority check: the point of the relay is that the
 * SERVER decides, not the client. So the test deliberately submits illegal
 * moves, out-of-turn moves, and opponent-army moves, and asserts the server
 * refuses each one and resyncs the offender.
 *
 * Run: node server/e2e-multiplayer.mjs
 * Exits non-zero on the first failed assertion.
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

const PORT = Number(process.env.E2E_PORT ?? 8799);
const URL = `ws://127.0.0.1:${PORT}`;

const results = [];
let failures = 0;

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

/** A thin test client that records every frame the relay sends. */
class TestClient {
  constructor(label) {
    this.label = label;
    this.inbox = [];
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(URL);
    this.socket.on("message", (raw) => {
      try {
        this.inbox.push(JSON.parse(raw.toString("utf8")));
      } catch {
        /* ignore malformed */
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    await this.waitFor("hello");
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits for the next frame with tag `t`, with a hard timeout. */
  async waitFor(t, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex((m) => m.t === t);
      if (index >= 0) return this.inbox.splice(index, 1)[0];
      if (Date.now() > deadline) {
        throw new Error(`${this.label}: timed out waiting for "${t}". Saw: ${this.inbox.map((m) => m.t).join(",")}`);
      }
      await delay(20);
    }
  }

  drain() {
    this.inbox.length = 0;
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
  }
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("relay did not become healthy");
    await delay(150);
  }
}

async function main() {
  const relay = spawn(process.execPath, ["index.js"], {
    cwd: import.meta.dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay.stdout.on("data", () => {});
  relay.stderr.on("data", (d) => console.error("[relay]", d.toString().trim()));

  try {
    const health = await waitForHealth();
    check("relay boots and serves /health", health.ok === true, `rooms=${health.rooms} v=${health.v}`);

    // ---------------------------------------------------------- seating
    const host = new TestClient("host");
    const guest = new TestClient("guest");
    await host.connect();
    await guest.connect();
    check("both sockets receive protocol hello", true);

    host.send({ t: "create", v: 1, name: "Host", seat: "w", clockMinutes: null });
    const seatedHost = await host.waitFor("seated");
    const code = seatedHost.code;
    check("create returns a 5-char room code", typeof code === "string" && code.length === 5, code);
    check("host is seated white as requested", seatedHost.color === "w", seatedHost.color);
    check("host receives a reconnect token", typeof seatedHost.token === "string" && seatedHost.token.length > 0);

    guest.send({ t: "join", v: 1, name: "Guest", code });
    const seatedGuest = await guest.waitFor("seated");
    check("guest is seated the opposite colour", seatedGuest.color === "b", seatedGuest.color);
    check("guest state shows the game started", seatedGuest.state.started === true);

    // ------------------------------------------------- server authority
    // Guest (black) tries to move first. The server must refuse.
    guest.drain();
    guest.send({ t: "move", from: "e7", to: "e5", promotion: null });
    const outOfTurn = await guest.waitFor("error");
    check("out-of-turn move is refused", outOfTurn.code === "not-your-turn", outOfTurn.code);
    const resync = await guest.waitFor("state");
    check("refused move triggers an authoritative resync", resync.state.turn === "w");

    // White submits a genuinely illegal move.
    host.drain();
    host.send({ t: "move", from: "e2", to: "e5", promotion: null });
    const illegal = await host.waitFor("error");
    check("illegal move is refused by the server", illegal.code === "illegal-move", illegal.code);

    // A legal move must reach BOTH clients, with self-attribution.
    host.drain();
    guest.drain();
    host.send({ t: "move", from: "e2", to: "e4", promotion: null });
    const movedHost = await host.waitFor("moved");
    const movedGuest = await guest.waitFor("moved");
    check("legal move broadcasts to the mover", movedHost.move.san === "e4", movedHost.move.san);
    check("legal move broadcasts to the opponent", movedGuest.move.san === "e4", movedGuest.move.san);
    check("mover receives self=true", movedHost.self === true);
    check("opponent receives self=false", movedGuest.self === false);
    check(
      "moved carries post-move FEN for divergence detection",
      typeof movedHost.move.fen === "string" && movedHost.move.fen.includes(" b "),
      movedHost.move.fen,
    );
    check("ply numbering starts at 0", movedHost.move.ply === 0, String(movedHost.move.ply));

    // Black replies legally.
    host.drain();
    guest.drain();
    guest.send({ t: "move", from: "e7", to: "e5", promotion: null });
    const reply = await host.waitFor("moved");
    check("opponent reply reaches the host", reply.move.san === "e5", reply.move.san);
    check("ply increments", reply.move.ply === 1, String(reply.move.ply));

    // ------------------------------------------------------- reconnect
    // Host drops. Guest must be told, and the seat must survive.
    guest.drain();
    host.close();
    const dropped = await guest.waitFor("peer");
    check("opponent is notified of a drop", dropped.event === "dropped" && dropped.color === "w", dropped.event);

    const revived = new TestClient("host-2");
    await revived.connect();
    revived.send({ t: "resume", v: 1, code, token: seatedHost.token });
    const resumed = await revived.waitFor("seated");
    check("a dropped player reclaims the same seat with its token", resumed.color === "w", resumed.color);
    check("resumed state replays the move history", resumed.state.moves.length === 2, String(resumed.state.moves.length));
    check(
      "resumed state restores the exact position",
      resumed.state.fen.startsWith("rnbqkbnr/pppp1ppp"),
      resumed.state.fen.split(" ")[0],
    );

    // A bad token must never grant a seat.
    const impostor = new TestClient("impostor");
    await impostor.connect();
    impostor.send({ t: "resume", v: 1, code, token: "not-a-real-token" });
    const badToken = await impostor.waitFor("error");
    check("a forged token is rejected", badToken.code === "bad-token" && badToken.fatal === true, badToken.code);
    impostor.close();

    // ------------------------------------------------- room fullness
    const third = new TestClient("third");
    await third.connect();
    third.send({ t: "join", v: 1, name: "Third", code });
    const full = await third.waitFor("error");
    check("a third player cannot take a seat", full.code === "room-full", full.code);
    third.close();

    // Unknown room code.
    const lost = new TestClient("lost");
    await lost.connect();
    lost.send({ t: "join", v: 1, name: "Lost", code: "ZZZZZ" });
    const noRoom = await lost.waitFor("error");
    check("joining an unknown code fails cleanly", noRoom.code === "no-room", noRoom.code);
    lost.close();

    // Protocol version mismatch must be fatal, not silently accepted.
    const oldClient = new TestClient("old");
    await oldClient.connect();
    oldClient.send({ t: "create", v: 99, name: "Old", seat: "random", clockMinutes: null });
    const badVersion = await oldClient.waitFor("error");
    check(
      "a mismatched protocol version is fatally rejected",
      badVersion.code === "bad-version" && badVersion.fatal === true,
      badVersion.code,
    );
    oldClient.close();

    // Malformed payloads must not kill the socket.
    const fuzz = new TestClient("fuzz");
    await fuzz.connect();
    fuzz.socket.send("not json at all");
    const badMessage = await fuzz.waitFor("error");
    check("a malformed frame is refused without dropping the socket", badMessage.code === "bad-message");
    fuzz.send({ t: "ping", at: 42 });
    const pong = await fuzz.waitFor("pong");
    check("socket still alive after malformed input", pong.at === 42);
    fuzz.close();

    // ------------------------------------------------------- resign
    revived.drain();
    guest.drain();
    guest.send({ t: "resign" });
    const over = await revived.waitFor("over");
    check("resignation ends the game for both sides", over.result.reason === "resignation", over.result.reason);
    check("the resigning side loses", over.result.winner === "w", String(over.result.winner));

    // Moves after the end must be refused.
    revived.drain();
    revived.send({ t: "move", from: "d2", to: "d4", promotion: null });
    const afterOver = await revived.waitFor("error");
    check("a move after game over is refused", afterOver.code === "game-over", afterOver.code);

    // ------------------------------------------------------ rematch
    // One offer alone must NOT restart the board.
    guest.drain();
    revived.drain();
    revived.send({ t: "rematch" });
    const offer = await guest.waitFor("rematch-offer");
    check("a single rematch offer only notifies the opponent", offer.by === "w", offer.by);

    guest.send({ t: "rematch" });
    const reseatA = await revived.waitFor("seated");
    const reseatB = await guest.waitFor("seated");
    check("a mutual rematch reseats both players", Boolean(reseatA && reseatB));
    check("rematch swaps colours", reseatA.color === "b" && reseatB.color === "w", `${reseatA.color}/${reseatB.color}`);
    check("rematch resets the move history", reseatA.state.moves.length === 0);
    check("rematch clears the result", reseatA.state.over === false);

    revived.close();
    guest.close();
    await delay(120);

    const finalHealth = await waitForHealth();
    check("relay survives the full session", finalHealth.ok === true, `rooms=${finalHealth.rooms}`);
  } catch (error) {
    check("suite ran to completion", false, error?.message ?? String(error));
  } finally {
    relay.kill("SIGTERM");
    await delay(200);
    if (!relay.killed) relay.kill("SIGKILL");
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nMULTIPLAYER E2E: ${passed}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
