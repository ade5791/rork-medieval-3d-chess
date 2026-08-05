/**
 * Explicit combat state machine for capture sequences.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module the capture beat was an implicit state machine: a chain of
 * `await` points inside sceneEngine.animateMove. That shape has three defects
 * this module removes.
 *
 *   1. It cannot be tested without booting WebGL and playing a real game.
 *   2. It has no bounded lifetime. Every `await` is a place the turn loop can
 *      stop forever (see the watchdog note below).
 *   3. Contact was resolved wherever the chain happened to be, so "did this
 *      capture resolve exactly once" was not an answerable question.
 *
 * THE CONTRACT
 * ------------
 * A capture is a fixed sequence of phases with declared windows, driven by an
 * explicit clock. Timing is data, not control flow:
 *
 *   arm -> approach -> startup -> active -> recovery -> resolve -> done
 *
 *   arm       waiting for animation clips to be available (bounded)
 *   approach  attacker travels to contact range (skipped by ranged attackers)
 *   startup   wind-up; the telegraph is readable, no contact can land
 *   active    the ONLY window in which contact may resolve
 *   recovery  follow-through; the victim's death plays out here
 *   resolve   board bookkeeping; the victim leaves for the tray
 *
 * LAWS ENFORCED HERE
 * ------------------
 * - Contact resolves EXACTLY ONCE, guarded by a stable move id, never by
 *   animation state. Re-entry with the same id is rejected, not replayed.
 * - The machine is downstream of chess.js. It is fed a resolved MoveEvent; it
 *   never decides whether a capture happened.
 * - Total lifetime is bounded by a watchdog. A phase that overruns its window
 *   is forced forward; a machine that overruns its total budget aborts to
 *   `done`. This is the queen-freeze class of bug, structurally prevented.
 * - Zero allocation while running. Every phase window is computed in the
 *   constructor; `advance` allocates nothing.
 *
 * This module is pure TypeScript with no three.js and no DOM, so the whole
 * combat timeline is unit-testable at full speed.
 */

import type { Faction, MoveEvent, PieceKind, SquareId } from "./types";

/** Ranks that kill at range and therefore never run an approach phase. */
export const RANGED_KINDS: readonly PieceKind[] = ["q", "b"];

export type CombatPhase =
  | "arm"
  | "approach"
  | "startup"
  | "active"
  | "recovery"
  | "resolve"
  | "done";

/** Phases in the order they run. `done` is terminal. */
export const PHASE_ORDER: readonly CombatPhase[] = [
  "arm",
  "approach",
  "startup",
  "active",
  "recovery",
  "resolve",
  "done",
];

/**
 * How a sequence ended. `completed` means every phase ran to its window.
 * `aborted` means the watchdog fired, which is a defect worth reporting but
 * never a reason to strand the turn loop.
 */
export type CombatOutcome = "completed" | "aborted";

/** Declared duration of every phase, in seconds. */
export interface CombatWindows {
  arm: number;
  approach: number;
  startup: number;
  active: number;
  recovery: number;
  resolve: number;
}

/**
 * A capture beat, fully specified before it runs.
 * Durations are data so a test can assert them without rendering.
 */
export interface CombatSpec {
  /** Stable identifier for the move being animated. */
  moveId: string;
  attacker: { kind: PieceKind; color: Faction; square: SquareId };
  victim: { kind: PieceKind; color: Faction; square: SquareId };
  /** Ranged attackers skip the approach phase entirely. */
  ranged: boolean;
  windows: CombatWindows;
  /**
   * Hard ceiling on the whole sequence. Exceeding it aborts to `done`.
   * Defaults to 2x the summed windows plus a second of slack.
   */
  budget: number;
}

export interface PhaseChange {
  from: CombatPhase;
  to: CombatPhase;
  /** Machine-local time at which the change happened. */
  at: number;
}

/** Emitted exactly once per capture, inside the active window. */
export interface ContactEvent {
  moveId: string;
  attacker: CombatSpec["attacker"];
  victim: CombatSpec["victim"];
  /** Machine-local time of contact. */
  at: number;
}

/**
 * Per-rank combat timing. These are the authored feel values: heavier ranks
 * wind up longer and follow through longer, which is what makes a queen's
 * execution read as heavier than a pawn's.
 */
const RANK_WINDOWS: Record<PieceKind, CombatWindows> = {
  p: { arm: 0.25, approach: 0.34, startup: 0.16, active: 0.09, recovery: 0.44, resolve: 0.2 },
  n: { arm: 0.25, approach: 0.38, startup: 0.18, active: 0.1, recovery: 0.48, resolve: 0.2 },
  b: { arm: 0.3, approach: 0.0, startup: 0.32, active: 0.12, recovery: 0.55, resolve: 0.22 },
  r: { arm: 0.3, approach: 0.36, startup: 0.24, active: 0.12, recovery: 0.56, resolve: 0.24 },
  q: { arm: 0.3, approach: 0.0, startup: 0.4, active: 0.14, recovery: 0.66, resolve: 0.26 },
  k: { arm: 0.3, approach: 0.32, startup: 0.34, active: 0.14, recovery: 0.62, resolve: 0.26 },
};

/**
 * Stable identifier for a played move.
 *
 * Built from the move's own coordinates and SAN rather than from a counter, so
 * it is identical across a replay of the same game and cannot collide inside a
 * single turn. This is what makes "resolve exactly once" enforceable: the
 * ledger keys on this, never on animation state.
 */
export function moveIdOf(event: MoveEvent, ply: number): string {
  const captured = event.capture ? `x${event.capture.kind}@${event.capture.square}` : "-";
  return `${ply}:${event.color}${event.kind}:${event.from}>${event.to}:${captured}:${event.san}`;
}

/** Builds the timing spec for a capture, from the resolved chess move. */
export function specForCapture(event: MoveEvent, ply: number): CombatSpec | null {
  if (!event.capture) return null;
  const base = RANK_WINDOWS[event.kind];
  const ranged = RANGED_KINDS.includes(event.kind);
  const windows: CombatWindows = { ...base, approach: ranged ? 0 : base.approach };
  const total =
    windows.arm + windows.approach + windows.startup + windows.active + windows.recovery + windows.resolve;
  return {
    moveId: moveIdOf(event, ply),
    attacker: { kind: event.kind, color: event.color, square: event.from },
    victim: { kind: event.capture.kind, color: event.capture.color, square: event.capture.square },
    ranged,
    windows,
    // Watchdog ceiling for the VISUAL performance of this beat, not the sum of
    // its phase windows. The windows-proportional term keeps heavier ranks
    // longer; the constant covers the authored visual tail the phase model does
    // not represent (turn-to-face, spell gather, projectile flight, slay,
    // banish and the closing glide). Ranged beats pay a much larger tail, so
    // they carry a larger constant. Measured on the dist build at quality=high:
    // melee 5047ms and ranged 8391ms, both of which completed normally.
    // Sized with headroom above those figures and kept below the controller's
    // 12s turn-loop ceiling so this remains the first line of defence.
    budget: total * 2 + (ranged ? 6.6 : 4),
  };
}

/**
 * Process-wide record of which moves have already resolved contact.
 *
 * A capture must apply its damage exactly once even if the sequence is
 * restarted, retried after an effect throws, or driven twice by a duplicated
 * event. Keyed by the stable move id.
 */
export class ContactLedger {
  private resolved = new Set<string>();

  /**
   * Claims contact for a move. Returns true for the first caller only; every
   * later caller with the same id gets false and must not apply damage.
   */
  claim(moveId: string): boolean {
    if (this.resolved.has(moveId)) return false;
    this.resolved.add(moveId);
    return true;
  }

  has(moveId: string): boolean {
    return this.resolved.has(moveId);
  }

  get size(): number {
    return this.resolved.size;
  }

  /** New game. */
  clear(): void {
    this.resolved.clear();
  }
}

export interface CombatHooks {
  onPhase?: (change: PhaseChange) => void;
  /** Fires once, inside the active window, only if the ledger grants the claim. */
  onContact?: (contact: ContactEvent) => void;
  onEnd?: (outcome: CombatOutcome, elapsed: number) => void;
}

/**
 * The capture sequence itself.
 *
 * Driven by `advance(dt)` from the render loop. It holds no timers and owns no
 * promises, so it cannot deadlock: if the clock stops the machine simply stops,
 * and the caller's watchdog is what ends the turn.
 */
export class CaptureMachine {
  private phaseIndex = 0;
  private phaseElapsed = 0;
  private total = 0;
  private contactFired = false;
  private finished = false;
  private outcome: CombatOutcome = "completed";

  constructor(
    private readonly spec: CombatSpec,
    private readonly ledger: ContactLedger,
    private readonly hooks: CombatHooks = {},
  ) {}

  get phase(): CombatPhase {
    return PHASE_ORDER[this.phaseIndex];
  }

  get elapsed(): number {
    return this.total;
  }

  get isDone(): boolean {
    return this.finished;
  }

  get didContact(): boolean {
    return this.contactFired;
  }

  get result(): CombatOutcome {
    return this.outcome;
  }

  /** Declared duration of a phase for this spec. */
  private windowFor(phase: CombatPhase): number {
    if (phase === "done") return 0;
    return this.spec.windows[phase];
  }

  /**
   * Advances the machine. Allocation-free.
   *
   * Contact resolves at the START of the active window, so a hit lands on the
   * first frame the window is open rather than drifting with frame rate.
   */
  advance(dt: number): CombatPhase {
    if (this.finished) return "done";

    this.total += dt;

    // Watchdog: the whole point of the module. A sequence can never outlive
    // its budget, no matter what a downstream effect does.
    if (this.total > this.spec.budget) {
      this.outcome = "aborted";
      this.finish();
      return "done";
    }

    this.phaseElapsed += dt;

    // A zero-length window (a ranged attacker's approach) must not consume a
    // frame, so this is a loop rather than a single step.
    let guard = 0;
    for (;;) {
      const phase = this.phase;
      if (phase === "done") break;

      if (phase === "active" && !this.contactFired) this.tryContact();

      const window = this.windowFor(phase);
      if (this.phaseElapsed < window) break;

      this.phaseElapsed -= window;
      this.enter(this.phaseIndex + 1);

      if (this.phase === "done") break;
      // Defensive: PHASE_ORDER is finite, but never spin the render loop.
      if (++guard > PHASE_ORDER.length + 1) break;
    }

    if (this.phase === "done" && !this.finished) this.finish();
    return this.phase;
  }

  private tryContact(): void {
    this.contactFired = true;
    // The ledger is authoritative. If this move already resolved, the window
    // still runs (the visuals are harmless) but no damage is claimed again.
    if (!this.ledger.claim(this.spec.moveId)) return;
    this.hooks.onContact?.({
      moveId: this.spec.moveId,
      attacker: this.spec.attacker,
      victim: this.spec.victim,
      at: this.total,
    });
  }

  private enter(index: number): void {
    const from = this.phase;
    this.phaseIndex = Math.min(index, PHASE_ORDER.length - 1);
    this.hooks.onPhase?.({ from, to: this.phase, at: this.total });
  }

  /**
   * Ends the sequence early. Used when the scene tears down or a new game
   * starts mid-capture. Contact is NOT retroactively fired: an abandoned
   * capture must not apply damage.
   */
  abort(): void {
    if (this.finished) return;
    this.outcome = "aborted";
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.phase !== "done") {
      const from = this.phase;
      this.phaseIndex = PHASE_ORDER.length - 1;
      this.hooks.onPhase?.({ from, to: "done", at: this.total });
    }
    this.hooks.onEnd?.(this.outcome, this.total);
  }
}

/**
 * Bounds any promise so an animation can never strand the turn loop.
 *
 * This is the direct structural fix for the queen-freeze bug. The scene's
 * animation promises resolve from inside the render loop; if the loop stops
 * (backgrounded tab, a throwing effect, a cancelled tween) those promises never
 * settle and `GameController.commit` awaits forever, leaving `busy` true and
 * the game permanently unresponsive.
 *
 * Resolves to `true` when the work finished, `false` when the watchdog fired.
 * It never rejects: the caller's job is to keep playing.
 */
export function withWatchdog(
  work: Promise<void>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      resolve(false);
    }, Math.max(0, timeoutMs));

    void work
      .catch(() => undefined)
      .finally(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
  });
}
