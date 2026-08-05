// Is the stalled-loop move rejected, or applied-but-unreported? Find out
// exactly what tryMove returns and what the snapshot says, step by step.
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4173";
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "kg-d4-")), {
  headless: true,
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 60_000,
});
await page.waitForFunction(() => window.__kg?.controller, null, { timeout: 60_000, polling: 200 });
await page.waitForFunction(
  () => {
    const s = window.__kg.controller.getSnapshot();
    return s.status === "playing" && s.sanList.length > 0 && !s.busy;
  },
  null,
  { timeout: 240_000, polling: 250 },
);

const info = await page.evaluate(async () => {
  const s0 = window.__kg.controller.getSnapshot();
  const sample = (s0.moves ?? []).slice(0, 3);
  const before = {
    plies: s0.sanList.length,
    turn: s0.turn,
    busy: s0.busy,
    mode: s0.mode,
    playerColor: s0.playerColor,
    thinking: s0.thinking,
    moveShape: sample.map((m) => (typeof m === "string" ? m : `${m.from}->${m.to}`)),
  };

  // Freeze the render loop, then attempt a move.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = () => 0;
  const mv = s0.moves?.[0];
  let ret = null;
  try {
    ret = await window.__kg.controller.tryMove(
      typeof mv === "string" ? mv : mv.from,
      typeof mv === "string" ? undefined : mv.to,
    );
  } catch (e) {
    ret = `THREW ${String(e)}`;
  }
  await new Promise((r) => setTimeout(r, 12_000));
  const s1 = window.__kg.controller.getSnapshot();
  window.requestAnimationFrame = raf;
  return {
    before,
    tryMoveReturned: typeof ret === "object" ? JSON.stringify(ret) : String(ret),
    after: { plies: s1.sanList.length, turn: s1.turn, busy: s1.busy, san: s1.sanList.slice(-2) },
    watchdogFires: window.__kg.combat().animationTimeouts,
  };
});

console.log(JSON.stringify(info, null, 2));
await ctx.close();
