/**
 * ONLINE BRIDGE - the only place where the network and the game controller
 * touch each other.
 *
 * The controller knows nothing about sockets; the client knows nothing about
 * chess.js or animation. This module owns the translation in both directions,
 * which keeps the divergence policy in exactly one readable place.
 *
 * MOVE FLOW (deliberately server-first)
 *
 *   local player drags a piece
 *     -> bridge.submitMove()      does NOT touch the local board
 *     -> relay validates
 *     -> "moved" comes back
 *     -> controller.applyRemoteMove() plays it, animation runs
 *
 * The board is therefore never optimistic. A move costs one round trip of
 * latency before the figure walks, which on a relay is tens of milliseconds -
 * and in exchange the local board can never show a move the server rejected,
 * which is the failure mode that produces two players looking at different
 * positions with no way back.
 */

import type { GameController } from "../core/gameController";
import type { Faction, GameResult, PieceKind, SquareId } from "../core/types";
import type { OnlineClient } from "./onlineClient";
import type { WireEndReason, WireGameState, WireResult } from "./protocol";

/** Relay reasons map 1:1 onto local ones except `abandoned`. */
function toLocalResult(result: WireResult): GameResult {
  const reason: WireEndReason = result.reason;
  if (reason === "abandoned") {
    // The local EndReason union has no `abandoned`; a walkout is a resignation
    // as far as the result screen is concerned.
    return { winner: result.winner, reason: "resignation" };
  }
  return { winner: result.winner, reason };
}

export interface BridgeHandlers {
  /** Called when the board was force-corrected; the renderer must resync. */
  onResync: () => void;
  /** Surface a transient message to the player. */
  onNotice: (text: string) => void;
}

export class OnlineBridge {
  private unsubscribes: (() => void)[] = [];
  private color: Faction = "w";
  private started = false;
  private disposed = false;
  /** Plies already applied locally - guards against a replayed broadcast. */
  private appliedPlies = 0;
  /** Serialises remote moves so two arrivals cannot interleave animations. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: OnlineClient,
    private readonly controller: GameController,
    private readonly handlers: BridgeHandlers,
  ) {
    this.wire();
  }

  getColor(): Faction {
    return this.color;
  }

  private wire(): void {
    this.unsubscribes.push(
      this.client.on("seated", ({ color, state }) => {
        this.color = color;
        this.beginMatch(state);
      }),
    );

    this.unsubscribes.push(
      this.client.on("state", (state) => {
        this.reconcile(state);
      }),
    );

    this.unsubscribes.push(
      this.client.on("moved", ({ move, clock }) => {
        // The relay numbers plies; anything at or below what we already played
        // is a duplicate broadcast and must not be animated twice.
        if (move.ply < this.appliedPlies) return;
        this.appliedPlies = move.ply + 1;
        this.enqueue(async () => {
          const played = await this.controller.applyRemoteMove(
            move.from as SquareId,
            move.to as SquareId,
            (move.promotion as PieceKind | null) ?? undefined,
          );
          if (!played) {
            // Our local position could not accept a move the server accepted -
            // we are out of sync. Take the server's word for it.
            if (this.controller.syncToFen(move.fen)) this.handlers.onResync();
            return;
          }
          this.controller.applyRemoteClock({
            enabled: clock.enabled,
            initialMs: clock.initialMs,
            whiteMs: clock.whiteMs,
            blackMs: clock.blackMs,
          });
        });
      }),
    );

    this.unsubscribes.push(
      this.client.on("over", ({ result, state }) => {
        this.enqueue(async () => {
          // Land on the authoritative final position before showing the result.
          if (this.controller.syncToFen(state.fen)) this.handlers.onResync();
          this.controller.applyRemoteResult(toLocalResult(result));
        });
      }),
    );

    this.unsubscribes.push(
      this.client.on("clock", (clock) => {
        this.controller.applyRemoteClock({
          enabled: clock.enabled,
          initialMs: clock.initialMs,
          whiteMs: clock.whiteMs,
          blackMs: clock.blackMs,
        });
      }),
    );

    this.unsubscribes.push(
      this.client.on("peer", ({ event, name }) => {
        if (event === "joined") this.handlers.onNotice(`${name} has taken the field.`);
        if (event === "dropped") this.handlers.onNotice(`${name} lost connection - holding their seat.`);
        if (event === "resumed") this.handlers.onNotice(`${name} is back at the board.`);
        if (event === "left") this.handlers.onNotice(`${name} has left the hall.`);
      }),
    );

    this.unsubscribes.push(
      this.client.on("failed", ({ code, message }) => {
        // An illegal/out-of-turn rejection is a divergence signal, not just a
        // message - the server has already pushed corrective state behind it.
        if (code === "illegal-move" || code === "not-your-turn") {
          this.handlers.onNotice(message);
          return;
        }
        this.handlers.onNotice(message);
      }),
    );
  }

  /** Starts (or restarts, after a rematch) the local game from relay state. */
  private beginMatch(state: WireGameState): void {
    this.appliedPlies = state.moves.length;
    this.controller.start({
      mode: "online",
      difficulty: "medium",
      playerColor: this.color,
      clockMinutes: state.clock.enabled ? state.clock.initialMs / 60_000 : null,
      // Rejoining mid-game lands directly on the live position rather than
      // replaying every animation from the opening.
      fen: state.moves.length > 0 ? state.fen : null,
    });
    this.started = true;
    this.controller.setNetworkReady(state.players.length === 2);
    this.controller.applyRemoteClock({
      enabled: state.clock.enabled,
      initialMs: state.clock.initialMs,
      whiteMs: state.clock.whiteMs,
      blackMs: state.clock.blackMs,
    });
    this.handlers.onResync();
  }

  /** Applies a full authoritative snapshot without animating. */
  private reconcile(state: WireGameState): void {
    if (!this.started) return;
    this.controller.setNetworkReady(state.players.length === 2);
    this.appliedPlies = Math.max(this.appliedPlies, state.moves.length);
    if (this.controller.syncToFen(state.fen)) this.handlers.onResync();
    this.controller.applyRemoteClock({
      enabled: state.clock.enabled,
      initialMs: state.clock.initialMs,
      whiteMs: state.clock.whiteMs,
      blackMs: state.clock.blackMs,
    });
  }

  /**
   * Called by the board instead of `controller.tryMove`. Returns true when the
   * move was SENT - not when it was accepted, which only the relay decides.
   */
  submitMove(from: SquareId, to: SquareId, promotion?: PieceKind): boolean {
    if (!this.started) return false;
    this.client.sendMove(from, to, promotion ?? null);
    return true;
  }

  resign(): void {
    this.client.resign();
  }

  requestRematch(): void {
    this.client.requestRematch();
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue
      .then(() => (this.disposed ? undefined : task()))
      .catch((error) => {
        console.error("[net] bridge task failed", error);
      });
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
  }
}
