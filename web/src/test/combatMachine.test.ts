/**
 * Combat state machine coverage.
 *
 * These tests exist to make the queen-freeze class of bug impossible to
 * reintroduce silently. They run with no WebGL, no DOM and no real time, so the
 * entire combat timeline is exercised in milliseconds.
 */

import { describe, expect, it, vi } from "vitest";

import {
  CaptureMachine,
  ContactLedger,
  PHASE_ORDER,
  RANGED_KINDS,
  moveIdOf,
  specForCapture,
  withWatchdog,
  type CombatPhase,
  type ContactEvent,
  type PhaseChange,
} from "../core/combatMachine";
import { Rng, RandomStream } from "../core/rng";
import type { MoveEvent } from "../core/types";

function captureEvent(overrides: Partial<MoveEvent> = {}): MoveEvent {
  return {
    color: "w",
    kind: "q",
    from: "d1",
    to: "d7",
    san: "Qxd7",
    capture: { square: "d7", kind: "p", color: "b" },
    rook: null,
    promotion: null,
    isCheck: false,
    isGameOver: false,
    ...overrides,
  };
}

/** Drives a machine to completion at a fixed step, with a hard iteration cap. */
function run(machine: CaptureMachine, step = 1 / 60, maxFrames = 100_000): number {
  let frames = 0;
  while (!machine.isDone && frames < maxFrames) {
    machine.advance(step);
    frames += 1;
  }
  return frames;
}

describe("moveIdOf", () => {
  it("is stable for the same move and ply", () => {
    const event = captureEvent();
    expect(moveIdOf(event, 4)).toBe(moveIdOf(event, 4));
  });

  it("separates the same move played at different plies", () => {
    const event = captureEvent();
    expect(moveIdOf(event, 4)).not.toBe(moveIdOf(event, 6));
  });

  it("separates a capture from a quiet move to the same square", () => {
    const quiet = captureEvent({ capture: null, san: "Qd7" });
    expect(moveIdOf(captureEvent(), 4)).not.toBe(moveIdOf(quiet, 4));
  });
});

describe("specForCapture", () => {
  it("returns null for a non-capture", () => {
    expect(specForCapture(captureEvent({ capture: null }), 0)).toBeNull();
  });

  it("gives ranged attackers a zero approach window", () => {
    for (const kind of RANGED_KINDS) {
      const spec = specForCapture(captureEvent({ kind }), 0);
      expect(spec?.ranged).toBe(true);
      expect(spec?.windows.approach).toBe(0);
    }
  });

  it("gives melee attackers a real approach window", () => {
    const spec = specForCapture(captureEvent({ kind: "n", from: "g1", to: "f3" }), 0);
    expect(spec?.ranged).toBe(false);
    expect(spec?.windows.approach).toBeGreaterThan(0);
  });

  it("declares a budget larger than the summed windows", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const total =
      spec.windows.arm +
      spec.windows.approach +
      spec.windows.startup +
      spec.windows.active +
      spec.windows.recovery +
      spec.windows.resolve;
    expect(spec.budget).toBeGreaterThan(total);
  });

  it("makes the queen wind up longer than the pawn", () => {
    const queen = specForCapture(captureEvent({ kind: "q" }), 0);
    const pawn = specForCapture(captureEvent({ kind: "p" }), 0);
    expect(queen?.windows.startup).toBeGreaterThan(pawn?.windows.startup ?? Infinity);
  });
});

describe("CaptureMachine phase progression", () => {
  it("walks every phase in the declared order and terminates", () => {
    const spec = specForCapture(captureEvent({ kind: "r", from: "a1", to: "a7" }), 0);
    if (!spec) throw new Error("expected a spec");
    const seen: CombatPhase[] = [];
    const machine = new CaptureMachine(spec, new ContactLedger(), {
      onPhase: (change: PhaseChange) => seen.push(change.to),
    });

    run(machine);

    expect(machine.isDone).toBe(true);
    expect(machine.result).toBe("completed");
    // Order must be a subsequence of the canonical order, ending at done.
    const expected = PHASE_ORDER.filter((p) => p !== "arm");
    expect(seen).toEqual(expected);
  });

  it("skips the approach phase for a ranged attacker without consuming a frame", () => {
    const spec = specForCapture(captureEvent({ kind: "q" }), 0);
    if (!spec) throw new Error("expected a spec");
    const seen: CombatPhase[] = [];
    const machine = new CaptureMachine(spec, new ContactLedger(), {
      onPhase: (change) => seen.push(change.to),
    });

    run(machine);

    expect(seen).toContain("startup");
    // approach is still traversed, but with a zero window it cannot hold a frame.
    const approachAt = seen.indexOf("approach");
    const startupAt = seen.indexOf("startup");
    expect(startupAt).toBeGreaterThan(approachAt);
  });

  it("never reports a phase outside the declared set", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const machine = new CaptureMachine(spec, new ContactLedger());
    while (!machine.isDone) {
      expect(PHASE_ORDER).toContain(machine.phase);
      machine.advance(1 / 60);
    }
    expect(machine.phase).toBe("done");
  });

  it("terminates even when driven with a huge delta (post-pause frame)", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const machine = new CaptureMachine(spec, new ContactLedger());
    machine.advance(30);
    expect(machine.isDone).toBe(true);
  });

  it("terminates when driven with a zero delta forever (clock stopped)", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const machine = new CaptureMachine(spec, new ContactLedger());
    for (let i = 0; i < 1000; i += 1) machine.advance(0);
    // A stopped clock must not advance the machine, and must not spin it either.
    expect(machine.isDone).toBe(false);
    expect(machine.phase).toBe("arm");
  });
});

describe("contact resolves exactly once", () => {
  it("fires contact a single time across a full sequence", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const contacts: ContactEvent[] = [];
    const machine = new CaptureMachine(spec, new ContactLedger(), {
      onContact: (c) => contacts.push(c),
    });

    run(machine);

    expect(contacts).toHaveLength(1);
    expect(contacts[0].moveId).toBe(spec.moveId);
  });

  it("fires contact only inside the active window", () => {
    const spec = specForCapture(captureEvent({ kind: "r", from: "a1", to: "a7" }), 0);
    if (!spec) throw new Error("expected a spec");
    let phaseAtContact: CombatPhase | null = null;
    const machine = new CaptureMachine(spec, new ContactLedger(), {
      onContact: () => {
        phaseAtContact = machine.phase;
      },
    });

    run(machine);

    expect(phaseAtContact).toBe("active");
  });

  it("does not fire contact twice when the same move is replayed", () => {
    const event = captureEvent();
    const ledger = new ContactLedger();
    const contacts: ContactEvent[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const spec = specForCapture(event, 7);
      if (!spec) throw new Error("expected a spec");
      run(new CaptureMachine(spec, ledger, { onContact: (c) => contacts.push(c) }));
    }

    // Three machines, one stable move id, exactly one damage application.
    expect(contacts).toHaveLength(1);
    expect(ledger.size).toBe(1);
  });

  it("treats two different captures as two separate resolutions", () => {
    const ledger = new ContactLedger();
    const contacts: ContactEvent[] = [];
    const first = specForCapture(captureEvent(), 0);
    const second = specForCapture(captureEvent({ from: "d7", to: "d8", san: "Qxd8" }), 1);
    if (!first || !second) throw new Error("expected specs");

    run(new CaptureMachine(first, ledger, { onContact: (c) => contacts.push(c) }));
    run(new CaptureMachine(second, ledger, { onContact: (c) => contacts.push(c) }));

    expect(contacts).toHaveLength(2);
    expect(ledger.size).toBe(2);
  });

  it("does not apply damage for a sequence aborted before contact", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const ledger = new ContactLedger();
    const contacts: ContactEvent[] = [];
    const machine = new CaptureMachine(spec, ledger, { onContact: (c) => contacts.push(c) });

    machine.advance(0.1);
    machine.abort();

    expect(machine.isDone).toBe(true);
    expect(machine.result).toBe("aborted");
    expect(contacts).toHaveLength(0);
    expect(ledger.size).toBe(0);
  });

  it("clears the ledger on a new game", () => {
    const ledger = new ContactLedger();
    ledger.claim("a");
    expect(ledger.has("a")).toBe(true);
    ledger.clear();
    expect(ledger.has("a")).toBe(false);
    expect(ledger.claim("a")).toBe(true);
  });
});

describe("watchdog - the queen-freeze class of bug", () => {
  it("aborts a sequence that overruns its budget", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    // A spec whose windows can never elapse: the classic stuck-forever shape.
    const stuck = { ...spec, windows: { ...spec.windows, recovery: Number.POSITIVE_INFINITY } };
    const machine = new CaptureMachine(stuck, new ContactLedger());

    const frames = run(machine);

    expect(machine.isDone).toBe(true);
    expect(machine.result).toBe("aborted");
    expect(frames).toBeLessThan(100_000);
  });

  it("always reaches done, so the turn loop can never be stranded", () => {
    // Every rank, both colours, ranged and melee.
    const kinds = ["p", "n", "b", "r", "q", "k"] as const;
    for (const kind of kinds) {
      const spec = specForCapture(captureEvent({ kind }), 0);
      if (!spec) throw new Error("expected a spec");
      const machine = new CaptureMachine(spec, new ContactLedger());
      run(machine);
      expect(machine.isDone).toBe(true);
      expect(machine.phase).toBe("done");
    }
  });

  it("calls onEnd exactly once", () => {
    const spec = specForCapture(captureEvent(), 0);
    if (!spec) throw new Error("expected a spec");
    const onEnd = vi.fn();
    const machine = new CaptureMachine(spec, new ContactLedger(), { onEnd });

    run(machine);
    machine.advance(1);
    machine.abort();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("withWatchdog resolves false when the work never settles", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<void>(() => undefined);
      const onTimeout = vi.fn();
      const result = withWatchdog(never, 2000, onTimeout);
      await vi.advanceTimersByTimeAsync(2100);
      await expect(result).resolves.toBe(false);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("withWatchdog resolves true when the work finishes in time", async () => {
    await expect(withWatchdog(Promise.resolve(), 1000)).resolves.toBe(true);
  });

  it("withWatchdog swallows a thrown animation error rather than stranding the turn", async () => {
    await expect(withWatchdog(Promise.reject(new Error("effect exploded")), 1000)).resolves.toBe(true);
  });

  it("withWatchdog does not fire onTimeout after the work settles", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const result = withWatchdog(Promise.resolve(), 1000, onTimeout);
      await expect(result).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("seeded RNG - reproducible review captures", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = new RandomStream("effects:smoke");
    const b = new RandomStream("effects:smoke");
    for (let i = 0; i < 64; i += 1) expect(a.next()).toBe(b.next());
  });

  it("produces different sequences for different streams", () => {
    const a = new RandomStream("effects:smoke");
    const b = new RandomStream("effects:sparks");
    const left = Array.from({ length: 16 }, () => a.next());
    const right = Array.from({ length: 16 }, () => b.next());
    expect(left).not.toEqual(right);
  });

  it("stays inside [0, 1)", () => {
    const stream = new RandomStream("bounds");
    for (let i = 0; i < 5000; i += 1) {
      const value = stream.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns the same stream for the same fork name", () => {
    const root = new Rng("seed");
    expect(root.fork("a")).toBe(root.fork("a"));
  });

  it("keeps forks independent - adding draws to one does not shift another", () => {
    const first = new Rng("seed");
    const second = new Rng("seed");
    // Burn draws on an unrelated stream in only one root.
    for (let i = 0; i < 25; i += 1) first.fork("noise").next();
    expect(first.fork("effects").next()).toBe(second.fork("effects").next());
  });

  it("rewinds on reset so a restaged capture repeats exactly", () => {
    const root = new Rng("seed");
    const before = Array.from({ length: 8 }, () => root.fork("effects").next());
    root.reset();
    const after = Array.from({ length: 8 }, () => root.fork("effects").next());
    expect(after).toEqual(before);
  });
});
