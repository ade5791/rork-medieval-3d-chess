// S4: identify the ONE program that compiles late in classic-jungle/medium/endgame.
// Diff the program cacheKey set before and after the measurement window - the
// key tells you exactly which material variant was missed by prewarm.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const url = `${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(6000);

const before = await page.evaluate(() => window.__kg.programs());
const censusBefore = await page.evaluate(() => window.__kg.census());
await page.evaluate(() => window.__kg.resetFrameTimes());

// Watch for the hitch and snapshot immediately when the program count moves.
const watched = await page.evaluate(async () => {
  const start = window.__kg.programs().count;
  const t0 = performance.now();
  let grewAt = -1;
  let grewCount = start;
  while (performance.now() - t0 < 20000) {
    const c = window.__kg.programs().count;
    if (c > start) {
      grewAt = performance.now() - t0;
      grewCount = c;
      break;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { start, grewAt, grewCount };
});

const after = await page.evaluate(() => window.__kg.programs());
const censusAfter = await page.evaluate(() => window.__kg.census());
const perf = await page.evaluate(() => window.__kg.perf());

console.log(`programs before ${before.count} -> after ${after.count}`);
console.log(`growth detected at ${watched.grewAt < 0 ? "NEVER (no late compile this run)" : watched.grewAt.toFixed(0) + "ms into window"}`);
console.log(`geometries ${censusBefore.geometries} -> ${censusAfter.geometries}   textures ${censusBefore.textures} -> ${censusAfter.textures}`);
console.log(`pieces ${censusBefore.pieces} -> ${censusAfter.pieces}   captured ${censusBefore.captured} -> ${censusAfter.captured}`);
console.log(`p50 ${perf.p50.toFixed(2)}ms  max ${perf.max.toFixed(1)}ms  hitches>50ms ${perf.hitches50}`);

const setBefore = new Set(before.keys);
const added = after.keys.filter((k) => !setBefore.has(k));
console.log(`\n=== NEW PROGRAM KEYS (${added.length}) ===`);
for (const k of added) {
  console.log("\n--- key ---");
  console.log(k.length > 1400 ? k.slice(0, 1400) + " ...[truncated]" : k);
}

// Nearest-neighbour diff: find the pre-existing key that differs least, so the
// single distinguishing define is obvious.
for (const k of added) {
  let best = null;
  let bestScore = -1;
  for (const p of before.keys) {
    let i = 0;
    while (i < Math.min(k.length, p.length) && k[i] === p[i]) i += 1;
    if (i > bestScore) {
      bestScore = i;
      best = p;
    }
  }
  if (best) {
    console.log(`\n=== nearest existing key diverges at char ${bestScore} ===`);
    console.log("existing: ..." + best.slice(Math.max(0, bestScore - 60), bestScore + 120));
    console.log("new     : ..." + k.slice(Math.max(0, bestScore - 60), bestScore + 120));
  }
}

await ctx.close();
await browser.close();
