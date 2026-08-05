// S4: the caster sweep proved submission is not the cost (462 fewer calls =>
// 1.0ms). The shadow pass costs 7.3ms total, so the cost must be rasterising
// the maps. Test that directly by resizing the shadow maps live.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=ultra&era=classic&arena=jungle&seed=s4-shres`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.55);
  window.__kg.releaseCamera();
  window.__kg.setCamera("cinematic");
});
await page.waitForTimeout(3500);
await page.evaluate(() => window.__kg.setDrawProbe(true));

const census = await page.evaluate(() => {
  const scene = window.__kg.scene();
  const out = [];
  scene.traverse((n) => {
    if (n.isLight && n.castShadow && n.shadow) {
      out.push({ type: n.type, name: n.name, w: n.shadow.mapSize.x, h: n.shadow.mapSize.y });
    }
  });
  return out;
});
console.log("=== shadow-casting lights (ultra) ===");
for (const l of census) console.log(`  ${l.type.padEnd(16)} ${String(l.name).padEnd(18)} ${l.w}x${l.h}`);
const totalTexels = census.reduce((a, l) => a + l.w * l.h, 0);
console.log(`  total shadow texels: ${(totalTexels / 1e6).toFixed(2)}M across ${census.length} maps`);

async function measure(label) {
  await page.evaluate(() => {
    window.__kg.releaseCamera();
    window.__kg.resetFrameTimes();
  });
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__kg.releaseCamera());
  }
  const perf = await page.evaluate(() => window.__kg.perf());
  console.log(`  ${label.padEnd(26)} p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)  p95 ${perf.p95.toFixed(2)}ms`);
  return perf.p50;
}

console.log("\n=== shadow map resolution sweep ===");
const base = await measure("as authored");

for (const div of [2, 4]) {
  await page.evaluate((d) => {
    const scene = window.__kg.scene();
    scene.traverse((n) => {
      if (n.isLight && n.castShadow && n.shadow) {
        if (!n.userData.__origMap) n.userData.__origMap = n.shadow.mapSize.x;
        const s = Math.max(256, Math.round(n.userData.__origMap / d));
        n.shadow.mapSize.set(s, s);
        if (n.shadow.map) {
          n.shadow.map.dispose();
          n.shadow.map = null;
        }
      }
    });
  }, div);
  await page.waitForTimeout(1500);
  await measure(`shadow map / ${div}`);
}

// And the ceiling: how fast is it with zero shadows?
await page.evaluate(() => {
  const scene = window.__kg.scene();
  scene.traverse((n) => {
    if (n.isLight && n.castShadow) n.castShadow = false;
  });
});
await page.waitForTimeout(1500);
const off = await measure("shadows fully off");
console.log(`\n  full shadow cost at authored res: ${(base - off).toFixed(2)}ms`);

await ctx.close();
await browser.close();
