// S4: pacing did not remove the stall, so ONE bind is heavy rather than a
// batch. Use the CDP profiler to capture the 384ms longtask and report the
// hottest self-time functions inside it. That names the real cost.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

await page.goto(`${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`, {
  waitUntil: "domcontentloaded",
  timeout: 180000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 180000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(4000);

await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.evaluate(() => window.__kg.resetFrameTimes());
await page.waitForTimeout(18000);
const { profile } = await cdp.send("Profiler.stop");
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`max frame ${perf.max.toFixed(1)}ms hitches>50ms ${perf.hitches50}`);

// Aggregate self time per function.
const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
const self = new Map();
const total = profile.timeDeltas ? profile.timeDeltas.reduce((a, b) => a + Math.max(0, b), 0) : 0;
if (profile.samples && profile.timeDeltas) {
  for (let i = 0; i < profile.samples.length; i += 1) {
    const id = profile.samples[i];
    const dt = Math.max(0, profile.timeDeltas[i] || 0);
    self.set(id, (self.get(id) || 0) + dt);
  }
}
const rows = [...self.entries()]
  .map(([id, us]) => {
    const n = byId.get(id);
    const cf = n ? n.callFrame : null;
    return {
      ms: us / 1000,
      name: cf ? cf.functionName || "(anonymous)" : "(unknown)",
      url: cf ? String(cf.url).split("/").pop() : "",
      line: cf ? cf.lineNumber : -1,
    };
  })
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 20);

console.log(`\ntotal profiled ${(total / 1000).toFixed(0)}ms`);
console.log("=== HOTTEST SELF TIME ===");
for (const r of rows) console.log(`${r.ms.toFixed(1).padStart(8)}ms  ${r.name.padEnd(34)} ${r.url}:${r.line}`);

await ctx.close();
await browser.close();
