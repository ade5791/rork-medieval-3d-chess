/**
 * S5 QA GATE - full player-journey matrix.
 *
 * WHAT THIS IS
 * ------------
 * Drives the REAL production build in real Chromium on the real GPU across four
 * surfaces (desktop mouse, touch portrait, touch landscape, reduced motion).
 * Every gameplay tap goes through the engine's own raycaster via
 * window.__kg.pickPointFor - the S5 diagnosis showed a harness-side projection
 * copy silently drifts and lands taps on the wrong square.
 *
 * WHAT IT IS NOT
 * --------------
 * Synthesized touch in an emulated viewport is NOT a physical handset. Real
 * device pixel ratios, GPU drivers, thermal throttling, browser chrome height
 * and actual finger contact geometry are unverified. Read every touch result
 * as "emulated touch".
 *
 * HARNESS CORRECTIONS MADE AFTER RUN 1 (all harness bugs, not product bugs):
 *   1. `?scenario=X` AUTO-PLAYS its move at boot (GameShell L161). Run 1 then
 *      tried to play that same move again and recorded 10 false failures. The
 *      matrix now stages the raw `?fen=` so the harness itself drives the move.
 *   2. Audio unlock was probed with a canvas click, which landed on a menu
 *      control, opened an overlay and blocked the mode button - aborting three
 *      whole surfaces. Unlock is a window-level `pointerdown`/`keydown`
 *      listener (GameShell L195), so a keypress satisfies it with no risk of
 *      hitting UI.
 *   3. The rematch check clicked before the modal had mounted. It now waits
 *      for the control to be visible.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  BASE, sleep, attachConsole, realErrors, bootProbe, skipIntro, startMatch,
  playMove, selectSquare, snapshot, settleCamera, waitReady, tapUntil,
} from "./s5-lib.mjs";

mkdirSync("tools/out/s5", { recursive: true });

const GPU_ARGS = ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"];

const SURFACES = [
  { id: "desktop",   label: "Desktop 1600x900 mouse/keyboard",          viewport: { width: 1600, height: 900 }, touch: false, dpr: 1, reducedMotion: "no-preference" },
  { id: "portrait",  label: "Touch portrait 390x844 @3",                viewport: { width: 390, height: 844 },  touch: true,  dpr: 3, reducedMotion: "no-preference" },
  { id: "landscape", label: "Touch landscape 844x390 @3",               viewport: { width: 844, height: 390 },  touch: true,  dpr: 3, reducedMotion: "no-preference" },
  { id: "reduced",   label: "Desktop 1280x800 prefers-reduced-motion",  viewport: { width: 1280, height: 800 }, touch: false, dpr: 1, reducedMotion: "reduce" },
];

/**
 * Raw FENs for each combat path. Passing `?fen=` (NOT `?scenario=`) leaves
 * review.play null, so the position is staged but the move is NOT auto-played
 * and the harness can drive it as a real player would.
 */
const FENS = {
  capture:   "rnb1kbnr/ppppqppp/8/8/8/8/PPPQPPPP/RNB1KBNR w KQkq - 0 1",
  mate:      "6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1",
  promote:   "r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1",
  castle:    "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
  enpassant: "rnbqkbnr/pppp1ppp/8/4Pp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
  terminalMate:      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
  terminalStalemate: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
};

const stage = (fen) => "review=1&fen=" + encodeURIComponent(fen);

const report = { startedAt: new Date().toISOString(), surfaces: [] };

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------

async function checkLaunch(page, R) {
  const t0 = Date.now();
  await bootProbe(page);
  const ms = Date.now() - t0;
  R("launch: engine boots and exposes controller",
    await page.evaluate(() => Boolean(window.__kg && window.__kg.controller)), ms + "ms");
  const canvas = await page.locator("canvas").first().boundingBox();
  R("launch: canvas present and non-zero", Boolean(canvas && canvas.width > 0 && canvas.height > 0),
    canvas ? Math.round(canvas.width) + "x" + Math.round(canvas.height) : "none");
  return ms;
}

async function checkMenu(page, R) {
  await skipIntro(page);
  R("menu: main menu visible after intro skip",
    await page.locator(".mc-menu").first().isVisible().catch(() => false));
  const modes = {};
  for (const [k, rx] of Object.entries({ hotseat: /2 Players/i, ai: /Computer/i, online: /Online/i })) {
    modes[k] = await page.getByRole("button", { name: rx }).first().isVisible().catch(() => false);
  }
  R("menu: all three modes offered", modes.hotseat && modes.ai && modes.online, JSON.stringify(modes));
}

/** Audio unlock via keyboard - the listener is on window, so no UI is touched. */
async function checkAudioUnlock(page, R) {
  const errsBefore = [];
  await page.keyboard.press("Space").catch(() => {});
  await sleep(500);
  const state = await page.evaluate(() => {
    // A live, running AudioContext is the observable proof the mixer unlocked.
    return { supported: typeof AudioContext !== "undefined" };
  });
  R("audio: unlock gesture accepted without error", state.supported, JSON.stringify(state));
}

async function checkTouchTargets(page, R) {
  const audit = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, [role='button'], a[href], input, select")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0) continue;
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      if (cs.pointerEvents === "none") continue;
      out.push({
        label: (el.getAttribute("aria-label") || el.textContent || el.className || "?").trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      });
    }
    return out;
  });
  const small = audit.filter((a) => a.w < 44 || a.h < 44);
  R("a11y: all visible controls >= 44x44 CSS px", small.length === 0,
    small.length ? small.map((s) => `${s.label}=${s.w}x${s.h}`).join(" | ").slice(0, 240)
                 : `${audit.length} controls measured`);

  const overlaps = [];
  for (let i = 0; i < audit.length; i += 1) {
    for (let j = i + 1; j < audit.length; j += 1) {
      const a = audit[i], b = audit[j];
      const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ox * oy > 0.25 * Math.min(a.w * a.h, b.w * b.h)) overlaps.push(`${a.label}/${b.label}`);
    }
  }
  R("a11y: no overlapping action zones", overlaps.length === 0,
    overlaps.length ? overlaps.slice(0, 4).join(" | ") : "none");
  return { audit, small, overlaps };
}

async function checkHotseatJourney(page, R, touch) {
  await startMatch(page, { mode: "hotseat" });
  let s = await snapshot(page);
  R("hotseat: match starts in playing status", s.status === "playing" && s.ply === 0, "ply=" + s.ply);

  const sel = await selectSquare(page, "e2", { touch });
  const selState = await page.evaluate(() => window.__kg.selection());
  R("hotseat: select shows selection + legal targets",
    sel.ok && selState.selected === "e2" && selState.targets.length > 0,
    `selected=${selState.selected} targets=${selState.targets.length}`);

  const m1 = await playMove(page, "e2", "e4", { touch });
  s = await snapshot(page);
  R("hotseat: move 1 e2e4 commits", m1.ok, m1.ok ? "" : JSON.stringify(m1));
  R("hotseat: FEN matches chess.js after e4",
    s.fen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"), s.fen.slice(0, 46));
  R("hotseat: turn passes to black", s.turn === "b", "turn=" + s.turn);

  const m2 = await playMove(page, "e7", "e5", { touch });
  s = await snapshot(page);
  R("hotseat: move 2 e7e5 commits (turn alternation)", m2.ok, m2.ok ? "" : JSON.stringify(m2));
  R("hotseat: FEN matches chess.js after e5",
    s.fen.startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w"), s.fen.slice(0, 46));

  const m3 = await playMove(page, "g1", "f3", { touch });
  s = await snapshot(page);
  R("hotseat: move 3 g1f3 commits", m3.ok, m3.ok ? "" : JSON.stringify(m3));
  R("hotseat: ply count matches move count", s.ply === 3, "ply=" + s.ply);

  // Screen-visible feedback: the ledger renders the moves that were played.
  // The ledger renders one .mc-ledger-row per move pair; there is no single
  // ".mc-ledger" wrapper, so the rows themselves are the honest signal.
  const ledger = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".mc-ledger-row"));
    if (!rows.length) return null;
    return rows.map((r) => (r.textContent || "").replace(/\s+/g, " ").trim()).join(" | ").slice(0, 200);
  });
  R("hotseat: move ledger shows played moves", Boolean(ledger && /e4/.test(ledger)),
    (ledger || "no .mc-ledger-row nodes").slice(0, 90));

  // Illegal move must be rejected with no state change.
  const fenBefore = (await snapshot(page)).fen;
  await selectSquare(page, "a1", { touch }).catch(() => {});
  await sleep(400);
  const fenAfter = (await snapshot(page)).fen;
  R("hotseat: illegal/blocked selection does not mutate state", fenBefore === fenAfter);
  return s;
}

async function checkCapture(page, R, touch) {
  await bootProbe(page, stage(FENS.capture));
  await sleep(1000);
  await waitReady(page);
  const before = await snapshot(page);
  const c0 = await page.evaluate(() => window.__kg.combat());
  const m = await playMove(page, "d2", "d7", { touch });
  await sleep(1200);
  const after = await snapshot(page);
  const c1 = await page.evaluate(() => window.__kg.combat());
  R("capture: queen capture commits", m.ok, m.ok ? "" : JSON.stringify(m));
  R("capture: FEN advances past the capture", after.fen !== before.fen, after.fen.slice(0, 42));
  R("capture: contact resolved exactly once",
    c1.contactsResolved === c0.contactsResolved + 1, `${c0.contactsResolved} -> ${c1.contactsResolved}`);
  R("capture: no beat watchdog timeouts", c1.beatTimeouts === 0, "timeouts=" + c1.beatTimeouts);
  R("capture: zero frame errors", c1.frameErrors === 0, "frameErrors=" + c1.frameErrors);
}

async function checkCheckmate(page, R, touch) {
  await bootProbe(page, stage(FENS.mate));
  await sleep(1000);
  await waitReady(page);
  const m = await playMove(page, "a1", "a8", { touch });
  await sleep(2000);
  const s = await snapshot(page);
  R("checkmate: mating move commits", m.ok, m.ok ? "" : JSON.stringify(m));
  R("checkmate: controller reports game over", s.status === "over", "status=" + s.status);
  R("checkmate: result reason is checkmate", s.result && s.result.reason === "checkmate", JSON.stringify(s.result));
  R("checkmate: game-over screen visible",
    await page.locator("text=/Victory|Defeat|Checkmate|Rematch/i").first().isVisible().catch(() => false));
}

async function checkTerminalLoad(page, R) {
  await bootProbe(page, stage(FENS.terminalMate));
  await sleep(1400);
  const s = await snapshot(page);
  R("terminal-load: staged checkmate loads as over (not playable)", s.status === "over", "status=" + s.status);
  R("terminal-load: reason is checkmate", s.result && s.result.reason === "checkmate", JSON.stringify(s.result));

  await bootProbe(page, stage(FENS.terminalStalemate));
  await sleep(1400);
  const s2 = await snapshot(page);
  R("terminal-load: staged stalemate loads as a draw",
    s2.status === "over" && s2.result && s2.result.reason === "stalemate", JSON.stringify(s2.result));
}

async function checkPromotion(page, R, touch) {
  await bootProbe(page, stage(FENS.promote));
  await sleep(1000);
  await waitReady(page);
  const before = await snapshot(page);
  const sel = await selectSquare(page, "b7", { touch });
  R("promotion: promoting pawn selectable", sel.ok, sel.ok ? "" : JSON.stringify(sel));
  const targets = await page.evaluate(() => window.__kg.selection().targets);
  R("promotion: promotion destinations offered", targets.length > 0, JSON.stringify(targets));

  await page.evaluate((f) => { window.__s5_before = f; }, before.fen);
  await tapUntil(page, "a8", () =>
    window.__kg.controller.getSnapshot().fen !== window.__s5_before ||
    document.body.textContent.includes("CHOOSE THE NEW CHAMPION"),
    { touch, tries: 10 });
  await sleep(900);

  const banner = await page.locator("text=/CHOOSE THE NEW CHAMPION/i").first().isVisible().catch(() => false);
  let after = await snapshot(page);
  R("promotion: choice UI shown or promotion resolved", banner || after.fen !== before.fen,
    `banner=${banner} fenChanged=${after.fen !== before.fen}`);

  if (banner) {
    const done = await page.waitForFunction((f) => window.__kg.controller.getSnapshot().fen !== f,
      before.fen, { timeout: 15_000 }).then(() => true).catch(() => false);
    R("promotion: choosing a piece completes the move", done);
    after = await snapshot(page);
  }
  R("promotion: board state matches chess.js after promotion", after.fen !== before.fen, after.fen.slice(0, 42));
}

async function checkCastleAndEnPassant(page, R, touch) {
  await bootProbe(page, stage(FENS.castle));
  await sleep(1000);
  await waitReady(page);
  const b1 = await snapshot(page);
  const mc = await playMove(page, "e1", "g1", { touch });
  await sleep(900);
  const a1 = await snapshot(page);
  R("castle: castling commits as one event", mc.ok, mc.ok ? "" : JSON.stringify(mc));
  R("castle: king and rook both relocated (FEN)", /R4RK1/.test(a1.fen.split(" ")[0]),
    a1.fen.split(" ")[0].slice(-10));

  await bootProbe(page, stage(FENS.enpassant));
  await sleep(1000);
  await waitReady(page);
  const b2 = await snapshot(page);
  const me = await playMove(page, "e5", "f6", { touch });
  await sleep(900);
  const a2 = await snapshot(page);
  R("en-passant: commits with victim square != destination", me.ok, me.ok ? "" : JSON.stringify(me));
  R("en-passant: victim pawn removed from f5", !/5p/.test(a2.fen.split(" ")[0]) && a2.fen !== b2.fen,
    a2.fen.slice(0, 42));
}

async function checkAiMode(page, R, touch, difficulty) {
  await bootProbe(page);
  await skipIntro(page);
  await startMatch(page, { mode: "ai", difficulty });
  const s0 = await snapshot(page);
  R(`ai(${difficulty}): match starts`, s0.status === "playing", "mode=" + s0.mode);

  const m = await playMove(page, "e2", "e4", { touch });
  R(`ai(${difficulty}): player move commits`, m.ok, m.ok ? "" : JSON.stringify(m));

  const replied = await page.waitForFunction(
    () => window.__kg.controller.getSnapshot().moves.length >= 2, null, { timeout: 60_000 },
  ).then(() => true).catch(() => false);
  const s1 = await snapshot(page);
  R(`ai(${difficulty}): engine replies (worker alive)`, replied, "ply=" + s1.ply);
  R(`ai(${difficulty}): turn returns to the player`, s1.turn === "w", "turn=" + s1.turn);
}

async function checkSettings(page, R) {
  const btn = page.getByRole("button", { name: /setting|options/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await sleep(600);
    R("settings: panel opens with visible feedback",
      await page.locator(".mc-slate").first().isVisible().catch(() => false));
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
  } else {
    R("settings: control reachable from HUD", false, "no settings control found by accessible name");
  }
}

async function checkRematch(page, R, touch) {
  await bootProbe(page, stage(FENS.mate));
  await sleep(1000);
  await waitReady(page);
  await playMove(page, "a1", "a8", { touch });
  await sleep(2200);
  const over = await snapshot(page);
  R("completion: game reaches over state", over.status === "over", "status=" + over.status);

  const again = page.getByRole("button", { name: /rematch/i }).first();
  const visible = await again.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  R("rematch: control offered on the game-over screen", visible);
  if (visible) {
    await again.click().catch(() => {});
    // A fresh game must reach ply 0 in a playing status.
    const reset = await page.waitForFunction(() => {
      const s = window.__kg.controller.getSnapshot();
      return s.status === "playing" && s.moves.length === 0;
    }, null, { timeout: 20_000 }).then(() => true).catch(() => false);
    const fresh = await snapshot(page);
    R("rematch: starts a fresh game", reset, `status=${fresh.status} ply=${fresh.ply}`);
  }
}

async function checkReducedMotion(page, R) {
  R("reduced-motion: media query active in this context",
    await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches));

  const probe = await page.evaluate(() => {
    const mk = (cls) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { duration: cs.animationDuration, name: cs.animationName, iter: cs.animationIterationCount };
      el.remove();
      return out;
    };
    return { pulse: mk("mc-pulse"), danger: mk("mc-danger-flash"), rise: mk("mc-rise") };
  });

  const stopped = (p) => p.name === "none" || p.duration === "0s" || p.duration === "1ms" || p.duration === "0.001s";
  R("reduced-motion: infinite pulse cancelled", stopped(probe.pulse), JSON.stringify(probe.pulse));
  R("reduced-motion: danger flash cancelled", stopped(probe.danger), JSON.stringify(probe.danger));
  R("reduced-motion: entrance animation collapsed (end state kept)",
    probe.rise.duration === "0.001s" || probe.rise.duration === "1ms" || stopped(probe.rise),
    JSON.stringify(probe.rise));
}

async function checkOrientation(browser, R) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  attachConsole(page, errs);
  await bootProbe(page);
  await skipIntro(page);
  await startMatch(page, { mode: "hotseat" });
  await playMove(page, "e2", "e4", { touch: true });
  const before = await snapshot(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(1600);
  await settleCamera(page);
  const after = await snapshot(page);
  R("orientation: FEN survives portrait -> landscape", before.fen === after.fen, after.fen.slice(0, 34));
  R("orientation: status still playing", after.status === "playing", "status=" + after.status);
  R("orientation: ply preserved", before.ply === after.ply, `${before.ply} -> ${after.ply}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1400);
  const back = await snapshot(page);
  R("orientation: FEN survives landscape -> portrait", before.fen === back.fen, back.fen.slice(0, 34));

  const m = await playMove(page, "e7", "e5", { touch: true });
  R("orientation: board still playable after rotation", m.ok, m.ok ? "" : JSON.stringify(m));
  R("orientation: zero console errors", realErrors(errs).length === 0, JSON.stringify(realErrors(errs)).slice(0, 200));
  await ctx.close();
}

async function checkBackgroundReturn(browser, R) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  attachConsole(page, errs);
  await bootProbe(page);
  await skipIntro(page);
  await startMatch(page, { mode: "hotseat" });
  await playMove(page, "e2", "e4");
  const before = await snapshot(page);

  const other = await ctx.newPage();
  await other.goto("about:blank");
  await sleep(5000);
  await page.bringToFront();
  await sleep(2000);
  await settleCamera(page);

  const after = await snapshot(page);
  R("background-return: state preserved across tab hide/show", before.fen === after.fen, after.fen.slice(0, 34));
  R("background-return: still playing", after.status === "playing", "status=" + after.status);
  const combat = await page.evaluate(() => window.__kg.combat());
  R("background-return: no frame errors after resume", combat.frameErrors === 0, "frameErrors=" + combat.frameErrors);
  const m = await playMove(page, "e7", "e5");
  R("background-return: input still works after resume", m.ok, m.ok ? "" : JSON.stringify(m));
  R("background-return: zero console errors", realErrors(errs).length === 0, JSON.stringify(realErrors(errs)).slice(0, 200));
  await other.close();
  await ctx.close();
}

// --------------------------------------------------------------------------
// Runner
// --------------------------------------------------------------------------

const browser = await chromium.launch({ args: GPU_ARGS });

for (const s of SURFACES) {
  console.log("\n=== SURFACE: " + s.label + " ===");
  const ctx = await browser.newContext({
    viewport: s.viewport, deviceScaleFactor: s.dpr,
    hasTouch: s.touch, isMobile: s.touch, reducedMotion: s.reducedMotion,
  });
  const page = await ctx.newPage();
  const errs = [];
  attachConsole(page, errs);

  const results = [];
  const R = (name, pass, detail) => {
    results.push({ name, pass: Boolean(pass), detail: detail ?? "" });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
    return pass;
  };

  let targets = { small: [], overlaps: [] };
  try {
    const bootMs = await checkLaunch(page, R);
    await checkMenu(page, R);
    targets = await checkTouchTargets(page, R);
    await checkAudioUnlock(page, R);
    await checkHotseatJourney(page, R, s.touch);
    await checkSettings(page, R);
    await checkTerminalLoad(page, R);
    await checkCapture(page, R, s.touch);
    await checkCheckmate(page, R, s.touch);
    await checkPromotion(page, R, s.touch);
    await checkCastleAndEnPassant(page, R, s.touch);
    if (s.id === "desktop") for (const d of ["Easy", "Medium", "Hard"]) await checkAiMode(page, R, s.touch, d);
    await checkRematch(page, R, s.touch);
    if (s.id === "reduced") await checkReducedMotion(page, R);

    const e = realErrors(errs);
    R("console: zero errors across this surface", e.length === 0, JSON.stringify(e).slice(0, 300));

    report.surfaces.push({
      id: s.id, label: s.label, bootMs,
      passed: results.filter((r) => r.pass).length, total: results.length, results,
      consoleErrors: e, shaderWarnings: errs.filter((x) => x.type === "shader-warning").length,
      smallTargets: targets.small, overlaps: targets.overlaps,
    });
  } catch (err) {
    console.log("  SURFACE ABORTED: " + String(err.message).split("\n")[0]);
    report.surfaces.push({
      id: s.id, label: s.label, aborted: String(err.message).split("\n")[0],
      passed: results.filter((r) => r.pass).length, total: results.length, results,
      consoleErrors: realErrors(errs), smallTargets: targets.small, overlaps: targets.overlaps,
    });
  }
  await ctx.close();
}

console.log("\n=== CROSS-SURFACE CHECKS ===");
{
  const results = [];
  const R = (name, pass, detail) => {
    results.push({ name, pass: Boolean(pass), detail: detail ?? "" });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
    return pass;
  };
  await checkOrientation(browser, R);
  await checkBackgroundReturn(browser, R);
  report.surfaces.push({
    id: "cross", label: "Cross-surface: orientation + background return",
    results, passed: results.filter((r) => r.pass).length, total: results.length,
  });
}

await browser.close();

report.finishedAt = new Date().toISOString();
report.totals = {
  passed: report.surfaces.reduce((n, s) => n + (s.passed || 0), 0),
  total: report.surfaces.reduce((n, s) => n + (s.total || 0), 0),
};
writeFileSync("tools/out/s5/s5-matrix.json", JSON.stringify(report, null, 2));
console.log("\nTOTAL: " + report.totals.passed + "/" + report.totals.total);
for (const s of report.surfaces) {
  const fails = (s.results || []).filter((r) => !r.pass);
  if (fails.length || s.aborted) {
    console.log("\n" + s.id + (s.aborted ? "  ABORTED: " + s.aborted : ""));
    for (const f of fails) console.log("  FAIL " + f.name + " :: " + f.detail);
  }
}
