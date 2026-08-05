// S4: a second prewarm compiled 5 programs in 52ms (~10ms each), so ONE late
// program cannot cost 400ms. The compile and the hitch are two different
// events that merely co-occur. Timestamp both independently, plus long tasks,
// to find the real cause of the stall.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("EV")) console.log(t);
});
await page.goto(`${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(5000);

await page.evaluate(() => {
  window.__t0 = performance.now();

  // 1. Long tasks - anything blocking the main thread over 50ms.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        console.log(`EV longtask t=${(e.startTime - window.__t0).toFixed(0)}ms dur=${e.duration.toFixed(0)}ms name=${e.name}`);
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch (err) {
    console.log("EV longtask observer unavailable");
  }

  // 2. Network - a GLB or texture arriving is a decode/upload stall candidate.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const t = e.startTime - window.__t0;
        if (t < 0) continue;
        if (e.duration < 30) continue;
        const short = String(e.name).split("/").pop();
        console.log(`EV resource t=${t.toFixed(0)}ms dur=${e.duration.toFixed(0)}ms size=${e.transferSize || 0} ${short}`);
      }
    }).observe({ entryTypes: ["resource"] });
  } catch (err) {
    console.log("EV resource observer unavailable");
  }

  // 3. Program-count growth, sampled tightly.
  const startProgs = window.__kg.programs().count;
  window.__progWatch = setInterval(() => {
    const c = window.__kg.programs().count;
    if (c !== startProgs) {
      console.log(`EV programs t=${(performance.now() - window.__t0).toFixed(0)}ms ${startProgs} -> ${c}`);
      clearInterval(window.__progWatch);
    }
  }, 8);
});

await page.evaluate(() => window.__kg.resetFrameTimes());
await page.waitForTimeout(24000);

const perf = await page.evaluate(() => window.__kg.perf());
console.log(`\np50 ${perf.p50.toFixed(2)}ms max ${perf.max.toFixed(1)}ms hitches>50ms ${perf.hitches50}`);
console.log(`worst frames: ${perf.worst.map((v) => v.toFixed(1)).join(", ")}`);

await ctx.close();
await browser.close();
