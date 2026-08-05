// S4: getProgramInfoLog self-time (381.8ms) matches the 384ms longtask almost
// exactly. That call is where three.js BLOCKS on the async GL link for a newly
// compiled program. So the late compile IS the hitch after all - the second
// prewarm looked cheap (5 programs / 52ms) only because those links were
// already resolved by the driver in the background.
//
// Definitive test: if the missing variant is compiled during prewarm (behind
// the loading screen) the in-play stall must vanish. Compare a run where the
// hidden temple group is revealed and compiled up front against the default.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const MODE = process.env.S4_MODE ?? "default";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`, {
  waitUntil: "domcontentloaded",
  timeout: 180000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 180000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(3000);

if (MODE === "forcelink") {
  // Compile AND force the link to resolve now, before measuring: reading the
  // program info log is exactly what blocks, so doing it here moves the cost
  // out of gameplay.
  const r = await page.evaluate(() => {
    const t0 = performance.now();
    const before = window.__kg.programs().count;
    window.__kg.prewarm();
    const after = window.__kg.programs().count;
    return { before, after, ms: performance.now() - t0 };
  });
  console.log(`forced prewarm: ${r.before} -> ${r.after} programs in ${r.ms.toFixed(0)}ms`);
  // Give the driver time to finish linking off-thread.
  await page.waitForTimeout(3000);
}

await page.evaluate(() => window.__kg.resetFrameTimes());
const p0 = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(20000);
const p1 = await page.evaluate(() => window.__kg.programs().count);
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`MODE=${MODE}: p50 ${perf.p50.toFixed(2)}ms p99 ${perf.p99.toFixed(1)}ms max ${perf.max.toFixed(1)}ms hitches>50ms ${perf.hitches50} lateProgs ${p1 - p0}`);

await ctx.close();
await browser.close();
