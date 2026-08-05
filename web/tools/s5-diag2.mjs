// S5 diagnostic 2: reproduce the exact hotseat sequence that failed in portrait
// and find WHEN g1 stops resolving. Boot-time geometry is already proven fine
// (diag 1: 0/64 fails on all surfaces), so this probes the moving parts:
// board flip between turns, cinematic camera during a beat, and beat-in-flight.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const BASE = process.env.S5_BASE || "http://127.0.0.1:8123";
const OUT = "tools/out/s5/diag2.json";
const LOG = "tools/out/s5/diag2.log";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
writeFileSync(LOG, "");

const out = { steps: [] };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 2));
save();

const SURFACES = [
  { name: "portrait-390x844", viewport: { width: 390, height: 844 }, dpr: 3, touch: true },
  { name: "desktop-1600x900", viewport: { width: 1600, height: 900 }, dpr: 1, touch: false },
];

async function probe(page, label) {
  const s = await page.evaluate((lbl) => {
    const kg = window.__kg;
    const snap = kg.controller.getSnapshot();
    const combat = kg.combat();
    const squares = ["g1", "a1", "e1", "b1", "e4", "a8"];
    const picks = {};
    for (const sq of squares) {
      const p = kg.pickPointFor(sq);
      picks[sq] = { ok: p.ok, offset: p.offset, x: Math.round(p.x), y: Math.round(p.y) };
    }
    const eng = kg.__engine;
    const cam = eng && eng.camera ? {
      x: +eng.camera.position.x.toFixed(2),
      y: +eng.camera.position.y.toFixed(2),
      z: +eng.camera.position.z.toFixed(2),
      fov: +eng.camera.fov.toFixed(2),
      aspect: +eng.camera.aspect.toFixed(3),
    } : null;
    return {
      label: lbl, fen: snap.fen, turn: snap.turn, status: snap.status,
      phase: combat.combatPhase, beatTimeouts: combat.beatTimeouts, ply: combat.ply,
      lastBeatMs: combat.lastBeatMs, budget: combat.lastBeatBudgetMs,
      picks, cam,
    };
  }, label);
  out.steps.push(s);
  save();
  log(`${label} g1=${s.picks.g1.ok} a1=${s.picks.a1.ok} phase=${s.phase} turn=${s.turn} camY=${s.cam && s.cam.y}`);
  return s;
}

async function tapSquare(page, sq, touch) {
  const p = await page.evaluate((q) => window.__kg.pickPointFor(q), sq);
  if (!p.ok) return { ok: false, reason: "no pick point", p };
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await sleep(650);
  return { ok: true, p };
}

let browser;
try {
  browser = await chromium.launch();
  for (const s of SURFACES) {
    log("surface " + s.name);
    const ctx = await browser.newContext({
      viewport: s.viewport, deviceScaleFactor: s.dpr, hasTouch: s.touch, isMobile: s.touch,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));

    const qs = new URLSearchParams({ review: "1", probe: "1", arena: "dusk", quality: "high", mode: "hotseat" });
    await page.goto(`${BASE}/?${qs}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__kg && window.__kg.ready && window.__kg.ready(), null,
      { timeout: 60_000 }).catch(() => {});
    await sleep(1500);

    await probe(page, s.name + " :: boot");

    // Move 1: e2-e4 (white)
    await tapSquare(page, "e2", s.touch);
    await tapSquare(page, "e4", s.touch);
    await sleep(400);
    await probe(page, s.name + " :: after e4 (mid-settle)");
    await sleep(2500);
    await probe(page, s.name + " :: after e4 (settled)");

    // Move 2: e7-e5 (black) - in hotseat this is where the board may flip.
    await tapSquare(page, "e7", s.touch);
    await tapSquare(page, "e5", s.touch);
    await sleep(400);
    await probe(page, s.name + " :: after e5 (mid-settle)");
    await sleep(2500);
    await probe(page, s.name + " :: after e5 (settled)");

    // Move 3: g1-f3 - the exact move the matrix reported as unreachable.
    const g1 = await tapSquare(page, "g1", s.touch);
    out.steps.push({ label: s.name + " :: tap g1", result: g1 });
    save();
    await probe(page, s.name + " :: after tapping g1");

    out.steps.push({ label: s.name + " :: consoleErrors", count: errs.length, sample: errs.slice(0, 3) });
    save();
    await ctx.close();
  }
} catch (e) {
  out.fatal = String(e);
  save();
  log("FATAL " + String(e));
} finally {
  if (browser) await browser.close();
  save();
  log("end");
}
