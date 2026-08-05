// Live performance spot-check against the DEPLOYED GitHub Pages build.
// Reports the full frame-time distribution (p50/p95/p99/max), not a median,
// with the camera moving via the engine's own demo/attract loop.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.PERF_BASE || "https://ade5791.github.io/kings-gambit-medieval-chess";
const OUT = "tools/out/s6-perf-live.json";

const run = async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e && e.message ? e.message : e)));

  const t0 = Date.now();
  await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__kg, null, { timeout: 90000 }).catch(() => {});
  const bootMs = Date.now() - t0;

  // Reach the menu, then let the attract/demo camera run so the sample is not static.
  for (let i = 0; i < 30; i += 1) {
    const up = await page.getByRole("button", { name: /Take the field/i }).first().isVisible().catch(() => false);
    if (up) break;
    await page.locator("text=CLICK TO SKIP").first().click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  const renderer = await page.evaluate(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
    } catch (e) { return "unknown"; }
  });

  // Sample real presented frames.
  const sample = await page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    await new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        n += 1;
        if (n >= 420) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return frames.slice(20); // drop warm-up
  });

  const sorted = [...sample].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const stats = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    renderer,
    bootMs,
    frames: sorted.length,
    p50Ms: Math.round(pct(50) * 100) / 100,
    p95Ms: Math.round(pct(95) * 100) / 100,
    p99Ms: Math.round(pct(99) * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    p50Fps: Math.round(1000 / pct(50)),
    p95Fps: Math.round(1000 / pct(95)),
    consoleErrors: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 5),
    note: "Headless ANGLE in CI-style Chromium. Treat as a regression tripwire, not a handset or bare-metal GPU number.",
  };

  fs.writeFileSync(OUT, JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats, null, 2));
  await browser.close();
};

run().catch((e) => { console.error("PERF FAILED", e); process.exit(1); });
