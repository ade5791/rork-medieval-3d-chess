// S4: nothing is added to the graph at the hitch, and prewarm now covers
// hidden objects - so the missing variant must not exist yet WHEN prewarm
// runs (assets still resolving). Test: run prewarm a second time after the
// scene is fully settled and see whether the late compile disappears.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const SECOND = process.env.S4_SECOND !== "0";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(6000);

if (SECOND) {
  const r = await page.evaluate(() => {
    const before = window.__kg.programs().count;
    const ms = window.__kg.prewarm();
    return { before, after: window.__kg.programs().count, ms };
  });
  console.log(`second prewarm: programs ${r.before} -> ${r.after} (+${r.after - r.before}) in ${r.ms.toFixed(0)}ms`);
} else {
  console.log("second prewarm: SKIPPED (control run)");
}

await page.evaluate(() => window.__kg.resetFrameTimes());
const start = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(22000);
const end = await page.evaluate(() => window.__kg.programs().count);
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`during 22s window: programs ${start} -> ${end} (late ${end - start})`);
console.log(`p50 ${perf.p50.toFixed(2)}ms  p99 ${perf.p99.toFixed(1)}ms  max ${perf.max.toFixed(1)}ms  hitches>50ms ${perf.hitches50}`);

await ctx.close();
await browser.close();
