// S4 diagnosis: which side is limiting, what is the invisible light, and what
// are the REAL draw calls (renderer.info is reset by the post composite, so a
// naive read reports only the final fullscreen quad).
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "high";
const url = `${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-diag`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });

console.log("=== preset", preset, "===");

// --- 1. every light, with visibility and intensity ------------------------
const lights = await page.evaluate(() => window.__kg.lights());
console.log("\n--- lights ---");
for (const l of lights) {
  console.log(
    `  ${l.visible ? "vis " : "HID "} ${String(l.type).padEnd(18)} ${String(l.name || "(unnamed)").padEnd(22)} i=${Number(l.intensity).toFixed(3)} ${l.color}`,
  );
}

// --- 2. real draw calls: disable autoReset so info accumulates over all
//        passes of one frame, sample, then restore.
const drawInfo = await page.evaluate(async () => {
  const r = window.__kg;
  // Reach the renderer through a temporary hook if exposed; otherwise use
  // the census (post-composite) value and flag it.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve(r.census()));
    });
  });
});
console.log("\n--- census (post-composite; calls reflect final pass only) ---");
console.log(" ", JSON.stringify(drawInfo));

// --- 3. CPU vs GPU: measure with the canvas at 1/16 the pixels.
// If frame time collapses, the limit is GPU (fill/shading). If it barely
// moves, the limit is CPU (scene graph, animation, JS).
async function sample(ms) {
  await page.evaluate(() => {
    window.__kg.releaseCamera();
    window.__kg.resetFrameTimes();
  });
  const ticks = Math.ceil(ms / 1000);
  for (let i = 0; i < ticks; i += 1) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__kg.releaseCamera());
  }
  return page.evaluate(() => window.__kg.perf());
}

await page.evaluate(() => {
  window.__kg.showcase(true, 0.55);
  window.__kg.releaseCamera();
  window.__kg.setCamera("cinematic");
});
await page.waitForTimeout(5000);

const full = await sample(8000);
console.log("\n--- full res 1600x900 ---");
console.log(`  p50 ${full.p50.toFixed(2)}ms (${full.fps50.toFixed(1)}fps)  p95 ${full.p95.toFixed(2)}  p99 ${full.p99.toFixed(2)}  max ${full.max.toFixed(1)}  hitch>50 ${full.hitches50}`);

// Shrink the drawing buffer hard. Same scene graph, same JS, ~1/16 the pixels.
await page.setViewportSize({ width: 400, height: 225 });
await page.waitForTimeout(3000);
const small = await sample(8000);
console.log("\n--- quarter res 400x225 (same scene graph, 1/16 pixels) ---");
console.log(`  p50 ${small.p50.toFixed(2)}ms (${small.fps50.toFixed(1)}fps)  p95 ${small.p95.toFixed(2)}  p99 ${small.p99.toFixed(2)}  max ${small.max.toFixed(1)}  hitch>50 ${small.hitches50}`);

const drop = ((full.p50 - small.p50) / full.p50) * 100;
console.log(`\n  p50 improved ${drop.toFixed(1)}% at 1/16 the pixels`);
console.log(
  `  => limiting side: ${drop > 45 ? "GPU (fill/shading bound)" : drop < 20 ? "CPU (scene graph / JS bound)" : "MIXED"}`,
);

await ctx.close();
await browser.close();
