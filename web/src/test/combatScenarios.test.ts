/**
 * Deterministic combat review states, verified against a real chess engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * The S3 review states let every combat path be reached without playing a full
 * game. That is only worth anything if each staged position is actually legal
 * AND actually exercises the path it claims to. A scenario that silently stops
 * being a capture (a typo in a FEN, a rank shifted by one) would leave the gate
 * green while testing nothing - the worst possible failure mode for a harness.
 *
 * So these tests drive chess.js itself: load the FEN, play the scenario's move,
 * and assert the resulting move flags carry the property the scenario is named
 * for. The combat timing spec is then built from that REAL move result, which
 * is the same direction of data flow the engine uses at runtime: chess.js
 * resolves the move, and the visuals are downstream of it.
 */

import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { RANGED_KINDS, moveIdOf, specForCapture } from "../core/combatMachine";
import type { Faction, MoveEvent, PieceKind } from "../core/types";
import { SCENARIOS } from "../scene/reviewState";

/**
 * Replays a scenario through chess.js and returns the resolved move, built into
 * the same MoveEvent shape GameController emits.
 */
function playScenario(name: keyof typeof SCENARIOS): { event: MoveEvent; flags: string } {
  const scenario = SCENARIOS[name];
  const chess = new Chess();
  chess.load(scenario.fen);
  const [from, to] = scenario.play as [string, string];
  const move = chess.move({ from, to, promotion: "q" });
  expect(move, `scenario "${name}" must produce a legal move`).toBeTruthy();

  const enPassant = move.flags.includes("e");
  const capture: MoveEvent["capture"] = enPassant
    ? { square: `${move.to[0]}${move.from[1]}`, kind: "p", color: move.color === "w" ? "b" : "w" }
    : move.captured
      ? {
          square: move.to,
          kind: move.captured as PieceKind,
          color: move.color === "w" ? "b" : "w",
        }
      : null;

  return {
    flags: move.flags,
    event: {
      color: move.color as Faction,
      kind: move.piece as PieceKind,
      from: move.from,
      to: move.to,
      san: move.san,
      capture,
      rook: null,
      promotion: (move.promotion as PieceKind | undefined) ?? null,
      isCheck: chess.isCheck(),
      isGameOver: chess.isGameOver(),
    },
  };
}

describe("review scenarios are legal positions", () => {
  it.each(Object.keys(SCENARIOS))("%s loads as a valid FEN", (name) => {
    const chess = new Chess();
    expect(() => chess.load(SCENARIOS[name].fen)).not.toThrow();
  });

  it.each(Object.keys(SCENARIOS))("%s declares the move it exercises", (name) => {
    expect(SCENARIOS[name].play, `scenario "${name}" needs a play pair`).toBeTruthy();
  });

  it.each(Object.keys(SCENARIOS))("%s plays its move legally", (name) => {
    expect(() => playScenario(name as keyof typeof SCENARIOS)).not.toThrow();
  });
});

describe("each scenario exercises the path it is named for", () => {
  it("capture: resolves an actual capture with a heavy attacker", () => {
    const { event, flags } = playScenario("capture");
    expect(flags).toContain("c");
    expect(event.capture).not.toBeNull();
    // The queen is the longest authored beat and the original freeze shape.
    expect(event.kind).toBe("q");
    expect(RANGED_KINDS).toContain(event.kind);
  });

  it("mate: ends the game during the beat", () => {
    const { event } = playScenario("mate");
    expect(event.isGameOver).toBe(true);
    expect(event.san.endsWith("#")).toBe(true);
  });

  it("promote: swaps the piece mid-beat and is also a capture", () => {
    const { event, flags } = playScenario("promote");
    expect(flags).toContain("p");
    expect(event.promotion).toBe("q");
    // A promotion-by-capture is the hardest ordering: the victim leaves and the
    // attacker is replaced inside the same event.
    expect(event.capture).not.toBeNull();
  });

  it("castle: moves two figures in one event", () => {
    const { flags } = playScenario("castle");
    expect(flags.includes("k") || flags.includes("q")).toBe(true);
  });

  it("enpassant: kills on a square other than the destination", () => {
    const { event, flags } = playScenario("enpassant");
    expect(flags).toContain("e");
    expect(event.capture).not.toBeNull();
    // This is the case a naive implementation gets wrong: it removes whatever
    // sits on `to` (nothing) and leaves the real victim standing.
    expect(event.capture?.square).not.toBe(event.to);
    expect(event.capture?.square).toBe("f5");
    expect(event.to).toBe("f6");
  });
});

describe("combat spec is built from the resolved move, not from animation state", () => {
  it("a non-capture scenario yields no capture spec", () => {
    const { event } = playScenario("castle");
    expect(specForCapture(event, 0)).toBeNull();
  });

  it("a capture scenario yields a spec whose victim matches chess.js", () => {
    const { event } = playScenario("capture");
    const spec = specForCapture(event, 0);
    expect(spec).not.toBeNull();
    expect(spec?.victim.square).toBe(event.capture?.square);
    expect(spec?.victim.kind).toBe(event.capture?.kind);
    expect(spec?.attacker.kind).toBe(event.kind);
  });

  it("en passant carries the victim square, not the destination square", () => {
    const { event } = playScenario("enpassant");
    const spec = specForCapture(event, 0);
    expect(spec?.victim.square).toBe("f5");
  });

  it("the same scenario replayed produces an identical move id", () => {
    const a = playScenario("capture").event;
    const b = playScenario("capture").event;
    expect(moveIdOf(a, 3)).toBe(moveIdOf(b, 3));
  });

  it("a ranged attacker skips approach, a melee attacker does not", () => {
    const ranged = specForCapture(playScenario("capture").event, 0);
    expect(ranged?.ranged).toBe(true);
    expect(ranged?.windows.approach).toBe(0);

    const melee = specForCapture(playScenario("promote").event, 0);
    expect(melee?.ranged).toBe(false);
    expect(melee?.windows.approach).toBeGreaterThan(0);
  });
});
