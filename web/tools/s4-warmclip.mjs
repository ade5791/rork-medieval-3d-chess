// S4: confirm the 384ms longtask is background clip warming (GLB parse +
// skinned-geometry upload), not a shader compile. Measure with warming allowed
// to finish BEFORE the window vs. warming overlapping the window.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const SETTLE = Number(process.env.S4_SETTLE ?? "6000");

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

// Settle: let background clip warming run to completion first.
await page.waitForTimeout(SETTLE);

// Report every GLB fetched so far and when it landed.
const res = await page.evaluate(() => {
  const list = performance.getEntriesByType("resource").filter((e) => /\.(glb|gltf)(\?|$)/i.test(e.name));
  const last = list.length ? Math.max(...list.map((e) => e.responseEnd)) : 0;
  return {
    count: list.length,
    lastEndMs: last,
    nowMs: performance.now(),
    bytes: list.reduce((s, e) => s + (e.transferSize || 0), 0),
    slowest: list
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map((e) => ({ n: String(e.name).split("/").pop(), dur: Math.round(e.duration), end: Math.round(e.responseEnd) })),
  };
});
console.log(`GLBs fetched: ${res.count}, ${(res.bytes / 1e6).toFixed(1)}MB, last landed at ${Math.round(res.lastEndMs)}ms (now ${Math.round(res.nowMs)}ms)`);
console.log(`clip warming still in flight: ${res.lastEndMs > res.nowMs - 1500 ? "YES" : "NO (settled)"}`);
for (const s of res.slowest) console.log(`  slowest ${s.n} dur=${s.dur}ms end=${s.end}ms`);

await page.evaluate(() => window.__kg.resetFrameTimes());
const p0 = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(20000);
const p1 = await page.evaluate(() => window.__kg.programs().count);
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`\nSETTLE=${SETTLE}ms -> p50 ${perf.p50.toFixed(2)}ms p95 ${perf.p95.toFixed(1)} p99 ${perf.p99.toFixed(1)} max ${perf.max.toFixed(1)}ms hitches>50ms ${perf.hitches50} lateProgs ${p1 - p0}`);

await ctx.close();
await browser.close();
