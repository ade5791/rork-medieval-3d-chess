// Shared S5 QA harness helpers. Every gameplay tap goes through the engine's
// own picker, and every tap is validated by its OUTCOME rather than by the
// screen point alone - the camera eases continuously (hotseat swings the board
// 180 degrees between turns), so a point verified one round-trip ago can be
// stale by the time the synthesized input lands.
export const BASE = "http://127.0.0.1:8123";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function attachConsole(page, sink) {
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") {
      const text = m.text();
      // three.js HLSL precision notes from the ANGLE/D3D shader compiler are
      // renderer noise, not application defects. Bucketed separately so the
      // console-error count stays honest.
      const shaderNoise = /WebGLProgram: Program Info Log|X4122|cannot be represented accurately/i.test(text);
      sink.push({ type: shaderNoise ? "shader-warning" : t, text: text.slice(0, 300) });
    }
  });
  page.on("pageerror", (e) => sink.push({ type: "pageerror", text: String(e.message).slice(0, 300) }));
  page.on("requestfailed", (r) => {
    const f = r.failure();
    if (f && !/net::ERR_ABORTED/.test(f.errorText)) {
      sink.push({ type: "requestfailed", text: r.url().slice(0, 160) + " :: " + f.errorText });
    }
  });
}

export function realErrors(sink) {
  return sink.filter((e) => e.type === "error" || e.type === "pageerror" || e.type === "requestfailed");
}

export async function bootProbe(page, query = "") {
  const q = query ? `?probe=1&${query}` : "?probe=1";
  await page.goto(`${BASE}/${q}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90_000 });
}

export async function skipIntro(page) {
  await page.locator("text=CLICK TO SKIP").first().click({ timeout: 15_000 }).catch(() => {});
  await sleep(400);
}

export async function startMatch(page, { mode = "hotseat", difficulty = null, faction = null } = {}) {
  const label = { hotseat: /2 Players/i, ai: /Computer/i, demo: /Showcase|Demo/i, online: /Online/i }[mode];
  await page.getByRole("button", { name: label }).first().click({ timeout: 20_000 });
  await sleep(250);
  if (difficulty) await page.getByRole("button", { name: difficulty }).first().click().catch(() => {});
  if (faction) await page.getByRole("button", { name: faction }).first().click().catch(() => {});
  await sleep(200);
  await page.getByRole("button", { name: /Take the field/i }).first().click({ timeout: 20_000 });
  await page.waitForFunction(() => window.__kg.controller.getSnapshot().status === "playing", null, { timeout: 40_000 });
  await settleCamera(page);
}

/**
 * Wait until the camera is genuinely parked. Two board squares are sampled so
 * an orbit is detected even when one happens to sit near the pivot.
 */
export async function settleCamera(page, { timeout = 25_000, needed = 8 } = {}) {
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < timeout) {
    const p = await page.evaluate(() => {
      const a = window.__kg.squareScreen("e4");
      const b = window.__kg.squareScreen("a1");
      return { x: Math.round(a.x), y: Math.round(a.y), bx: Math.round(b.x), by: Math.round(b.y) };
    });
    if (
      last &&
      Math.abs(p.x - last.x) <= 1 && Math.abs(p.y - last.y) <= 1 &&
      Math.abs(p.bx - last.bx) <= 1 && Math.abs(p.by - last.by) <= 1
    ) {
      stable += 1;
      if (stable >= needed) return true;
    } else {
      stable = 0;
    }
    last = p;
    await sleep(110);
  }
  return false;
}

/** Wait for the board to be idle and ready for human input. */
export async function waitReady(page, { timeout = 30_000 } = {}) {
  await page
    .waitForFunction(
      () => {
        const kg = window.__kg;
        const s = kg.controller.getSnapshot();
        const c = kg.combat();
        return s.status === "playing" && kg.controller.isHumanTurn() && !s.thinking && c.combatPhase === "done";
      },
      null,
      { timeout },
    )
    .catch(() => {});
  await settleCamera(page);
}

/**
 * Tap a square and confirm the tap produced the intended OUTCOME. `expect` is
 * re-evaluated in the page after each attempt; the tap is retried with a freshly
 * computed pick point until it holds.
 */
export async function tapUntil(page, square, expect, { touch = false, tries = 10, settle = 260 } = {}) {
  let lastReason = null;
  for (let i = 0; i < tries; i += 1) {
    const pt = await page.evaluate((sq) => window.__kg.pickPointFor(sq), square);
    if (!pt.ok) { lastReason = "no pick point resolves to " + square; await sleep(200); continue; }
    if (touch) {
      await page.touchscreen.tap(pt.x, pt.y);
    } else {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await sleep(28);
      await page.mouse.up();
    }
    await sleep(settle);
    const ok = await page.evaluate(expect, square).catch(() => false);
    if (ok) return { ok: true, attempts: i + 1, point: { x: Math.round(pt.x), y: Math.round(pt.y) } };
    lastReason = "outcome not met after tap at (" + Math.round(pt.x) + "," + Math.round(pt.y) + ")";
    await sleep(180);
  }
  return { ok: false, reason: lastReason ?? "tap did not take on " + square };
}

/** Select a piece, confirmed by the engine's own selection state. */
export async function selectSquare(page, square, opts = {}) {
  await waitReady(page);
  return tapUntil(page, square, (sq) => window.__kg.selection().selected === sq, opts);
}

/** Play one move by tapping origin then destination; waits for the ply to land. */
export async function playMove(page, from, to, { touch = false, timeout = 20_000 } = {}) {
  const before = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
  const sel = await selectSquare(page, from, { touch });
  if (!sel.ok) return { ok: false, stage: "select", reason: sel.reason };

  const legal = await page.evaluate((sq) => window.__kg.selection().targets.includes(sq), to);
  // The outcome closure compares against the pre-move FEN, so publish it first.
  await page.evaluate((f) => { window.__s5_before = f; }, before);
  const commit = await tapUntil(page, to, () => window.__kg.controller.getSnapshot().fen !== window.__s5_before, {
    touch,
    tries: 10,
  });
  if (!commit.ok) return { ok: false, stage: "commit", reason: commit.reason, legalTargetIncluded: legal };
  try {
    await page.waitForFunction((f) => window.__kg.controller.getSnapshot().fen !== f, before, { timeout });
  } catch {
    return { ok: false, stage: "commit", reason: "FEN did not change within " + timeout + "ms" };
  }
  await waitReady(page);
  return { ok: true, selectAttempts: sel.attempts };
}

export async function snapshot(page) {
  return page.evaluate(() => {
    const s = window.__kg.controller.getSnapshot();
    return {
      fen: s.fen, turn: s.turn, status: s.status, mode: s.mode,
      ply: s.moves ? s.moves.length : null, result: s.result ?? null,
      isGameOver: s.isGameOver ?? null,
    };
  });
}

export function rec(results, name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ?? "" });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  return pass;
}
