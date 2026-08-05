// S4: diagnose the limiting side for the ultra preset.
// Test 1 - resolution scaling. If frame time falls roughly in proportion to
// pixel count, the frame is fragment/GPU bound. If it barely moves, it is CPU
// bound on submission or simulation.
// Test 2 - draw-call / triangle census at each resolution, which must stay
// constant. Constant CPU work + falling frame time = GPU bound, proven.
// One browser per cell, never two measurement jobs at once.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const PRESET = process.env.S4_PRESET ?? "ultra";
const WARM = 6000;
const MEASURE = 10000;

const RES = [
  { w: 1600, h: 900, label: "1600x900 (100%)" },
  { w: 1131, h: 636, label: "1131x636  (50% pixels)" },
  { w: 800, h: 450, label: "800x450   (25% pixels)" },
  { w: 566, h: 318, label: "566x318   (12.5% pixels)" },
];

async function cell({ w, h, label }) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-angle=d3d11",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--disable-gpu-vsync",
      "--disable-frame-rate-limit",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `${BASE}/?review=1&probe=1&nopost=0&quality=${PRESET}&era=classic&arena=jungle&phase=opening&seed=s4-res&autoplay=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__kg.prewarm && window.__kg.prewarm());
  await page.evaluate(() => {
    window.__kg.showcase(true, 0.5);
    window.__kg.releaseCamera();
  });
  await page.waitForTimeout(WARM);

  await page.evaluate(() => window.__kg.setDrawProbe(true));
  await page.waitForTimeout(600);
  const draw = await page.evaluate(() => window.__kg.draw());
  const progsBefore = await page.evaluate(() => window.__kg.programs().count);

  await page.evaluate(() => window.__kg.resetFrameTimes());
  await page.waitForTimeout(MEASURE);
  const perf = await page.evaluate(() => window.__kg.perf());
  const progsAfter = await page.evaluate(() => window.__kg.programs().count);
  const census = await page.evaluate(() => window.__kg.census());

  await ctx.close();
  await browser.close();
  return { label, w, h, px: w * h, perf, draw, census, progsBefore, progsAfter };
}

const rows = [];
for (const r of RES) {
  process.stdout.write(`measuring ${r.label} ... `);
  const out = await cell(r);
  rows.push(out);
  console.log(`p50 ${out.perf.p50.toFixed(2)}ms (${out.perf.fps50.toFixed(1)}fps) calls ${out.draw.calls}`);
}

const base = rows[0];
console.log(`\n=== RESOLUTION SCALING, preset ${PRESET} ===`);
console.log("resolution              | pixels%  | p50ms  | fps50  | p95ms | drawCalls | triangles | frametime%");
for (const r of rows) {
  const pxPct = ((r.px / base.px) * 100).toFixed(1);
  const ftPct = ((r.perf.p50 / base.perf.p50) * 100).toFixed(1);
  console.log(
    `${r.label.padEnd(23)} | ${pxPct.padStart(7)}% | ${r.perf.p50.toFixed(2).padStart(6)} | ${r.perf.fps50.toFixed(1).padStart(6)} | ${r.perf.p95.toFixed(1).padStart(5)} | ${String(r.draw.calls).padStart(9)} | ${String(r.draw.triangles).padStart(9)} | ${ftPct.padStart(9)}%`,
  );
}

// The verdict. If frame time tracks pixel count while draw calls are flat, the
// frame is fragment bound. A CPU-bound frame holds roughly constant frame time
// as resolution falls.
const smallest = rows[rows.length - 1];
const pxRatio = smallest.px / base.px;
const ftRatio = smallest.perf.p50 / base.perf.p50;
const callsFlat = rows.every((r) => Math.abs(r.draw.calls - base.draw.calls) <= Math.max(4, base.draw.calls * 0.03));
console.log(`\npixel ratio at smallest: ${(pxRatio * 100).toFixed(1)}%   frame-time ratio: ${(ftRatio * 100).toFixed(1)}%`);
console.log(`draw calls constant across all resolutions: ${callsFlat ? "YES" : "NO"}`);
const floorMs = smallest.perf.p50;
const gpuPortion = base.perf.p50 - floorMs;
console.log(`\nCPU floor (frame time that survives an 87.5% pixel cut): ${floorMs.toFixed(2)}ms`);
console.log(`resolution-dependent (GPU fragment) portion at full res: ${gpuPortion.toFixed(2)}ms  = ${((gpuPortion / base.perf.p50) * 100).toFixed(1)}% of the frame`);
console.log(`VERDICT: ${gpuPortion > floorMs ? "GPU / fragment bound" : "CPU bound"}`);
