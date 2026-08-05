/**
 * Terminal-state evaluation on FEN load. S5 regression lock.
 *
 * WHY THIS EXISTS
 * ---------------
 * The S5 QA gate found a critical defect: a staged FEN was never checked for a
 * terminal condition, so two paths presented a decided game as a live one.
 *
 *   start()     loaded options.fen and then unconditionally set
 *               status = "playing". A checkmate review state rendered as a
 *               playable board with no game-over result, and the controller
 *               went on to start a clock and dispatch an engine search on a
 *               position with zero legal moves.
 *
 *   syncToFen() rebuilt the local board from the relay's authoritative FEN but
 *               never re-evaluated the end condition, so the move that ended an
 *               online game left both clients believing play continued.
 *
 * These tests drive the real GameController against real chess.js positions and
 * assert the observable contract - status, result and clock - rather than the
 * internals of the fix. That way the tests still hold if checkEnd() is later
 * refactored, and they fail loudly if either FEN path regresses.
 *
 * Mode is "hotseat" throughout: maybeRunEngine() returns immediately for
 * hotseat, so no Web Worker is ever constructed and the suite stays a pure
 * node-environment unit test.
 */
import { describe, expect, it } from "vitest";
import { GameController, type StartOptions } from "../core/gameController";

/** Hotseat baseline - keeps the AI worker out of the test environment. */
function options(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    mode: "hotseat",
    difficulty: "medium",
    playerColor: "w",
    clockMinutes: null,
    ...overrides,
  };
}

/**
 * Terminal positions, each verified by chess.js itself in the first test below
 * so a typo can never leave this table silently testing nothing.
 */
const TERMINAL = {
  /** Fool's mate. Black has just played Qh4#; white is mated, black wins. */
  checkmate: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
  /** Classic stalemate - black to move, no legal move, not in check. */
  stalemate: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
  /** Bare kings. Neither side can ever mate. */
  insufficient: "8/8/4k3/8/8/3K4/8/8 w - - 0 1",
} as const;

const LIVE_OPENING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("terminal FEN fixtures are actually terminal", () => {
  it("each staged position ends the game for the reason it claims", () => {
    const game = new GameController();

    game.start(options({ fen: TERMINAL.checkmate }));
    expect(game.getSnapshot().result?.reason).toBe("checkmate");

    game.start(options({ fen: TERMINAL.stalemate }));
    expect(game.getSnapshot().result?.reason).toBe("stalemate");

    game.start(options({ fen: TERMINAL.insufficient }));
    expect(game.getSnapshot().result?.reason).toBe("insufficient");

    game.stop();
  });
});

describe("start() evaluates a staged FEN before declaring play", () => {
  it("a checkmate review state loads as over, not playable", () => {
    const game = new GameController();
    game.start(options({ fen: TERMINAL.checkmate }));

    const snap = game.getSnapshot();
    expect(snap.status).toBe("over");
    expect(snap.result).not.toBeNull();
    expect(snap.result?.reason).toBe("checkmate");
    // Black delivered mate, so white is the side to move and the loser.
    expect(snap.result?.winner).toBe("b");
    game.stop();
  });

  it("a stalemate review state loads as a draw, not playable", () => {
    const game = new GameController();
    game.start(options({ fen: TERMINAL.stalemate }));

    const snap = game.getSnapshot();
    expect(snap.status).toBe("over");
    expect(snap.result?.reason).toBe("stalemate");
    expect(snap.result?.winner).toBeNull();
    game.stop();
  });

  it("an insufficient-material position loads as a draw", () => {
    const game = new GameController();
    game.start(options({ fen: TERMINAL.insufficient }));

    expect(game.getSnapshot().result?.reason).toBe("insufficient");
    game.stop();
  });

  it("does not run a clock on a game that is already decided", () => {
    const game = new GameController();
    game.start(options({ fen: TERMINAL.checkmate, clockMinutes: 5 }));

    const snap = game.getSnapshot();
    expect(snap.status).toBe("over");
    // The clock is configured from the options but must not be counting down on
    // a decided game. Both sides still hold their full allocation.
    expect(snap.clock.whiteMs).toBe(5 * 60_000);
    expect(snap.clock.blackMs).toBe(5 * 60_000);
    game.stop();
  });

  it("a normal opening position is still fully playable", () => {
    const game = new GameController();
    game.start(options({ fen: LIVE_OPENING }));

    const snap = game.getSnapshot();
    expect(snap.status).toBe("playing");
    expect(snap.result).toBeNull();
    game.stop();
  });

  it("a start with no staged FEN is unaffected", () => {
    const game = new GameController();
    game.start(options());

    expect(game.getSnapshot().status).toBe("playing");
    expect(game.getSnapshot().result).toBeNull();
    game.stop();
  });

  it("restarting from a terminal state back to a live game recovers", () => {
    const game = new GameController();
    game.start(options({ fen: TERMINAL.checkmate }));
    expect(game.getSnapshot().status).toBe("over");

    // Rematch out of a decided review state.
    game.start(options());
    expect(game.getSnapshot().status).toBe("playing");
    expect(game.getSnapshot().result).toBeNull();
    game.stop();
  });
});

describe("syncToFen() evaluates the authoritative position", () => {
  it("a relay FEN that is checkmate ends the local game", () => {
    const game = new GameController();
    game.start(options());
    expect(game.getSnapshot().status).toBe("playing");

    const corrected = game.syncToFen(TERMINAL.checkmate);
    expect(corrected).toBe(true);

    const snap = game.getSnapshot();
    expect(snap.status).toBe("over");
    expect(snap.result?.reason).toBe("checkmate");
    game.stop();
  });

  it("a relay FEN that is stalemate ends the local game as a draw", () => {
    const game = new GameController();
    game.start(options());

    game.syncToFen(TERMINAL.stalemate);

    expect(game.getSnapshot().status).toBe("over");
    expect(game.getSnapshot().result?.reason).toBe("stalemate");
    game.stop();
  });

  it("a non-terminal divergence resyncs without ending the game", () => {
    const game = new GameController();
    game.start(options());

    // A legal, ongoing position that differs from the local board.
    const ongoing = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const corrected = game.syncToFen(ongoing);

    expect(corrected).toBe(true);
    expect(game.getSnapshot().status).toBe("playing");
    expect(game.getSnapshot().result).toBeNull();
    game.stop();
  });

  it("an identical FEN is a no-op and never ends the game", () => {
    const game = new GameController();
    game.start(options());
    const current = game.getSnapshot().fen;

    expect(game.syncToFen(current)).toBe(false);
    expect(game.getSnapshot().status).toBe("playing");
    game.stop();
  });

  it("an unloadable FEN is rejected and leaves the game playing", () => {
    const game = new GameController();
    game.start(options());

    expect(game.syncToFen("total nonsense")).toBe(false);
    expect(game.getSnapshot().status).toBe("playing");
    expect(game.getSnapshot().result).toBeNull();
    game.stop();
  });
});
