// S4: stop guessing the shadow-caster threshold. Dump the real radius
// distribution of piece sub-meshes, then sweep candidate thresholds by
// toggling castShadow live and measuring each one.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=ultra&era=classic&arena=jungle&seed=s4-sweep`, {
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
await page.waitForTimeout(800);

// Tag every piece sub-mesh with its true world radius, once.
const hist = await page.evaluate(() => {
  const scene = window.__kg.scene();
  const radii = [];
  scene.updateMatrixWorld(true);
  for (const child of scene.children) {
    if (!String(child.name).startsWith("piece_")) continue;
    child.traverse((n) => {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      const g = n.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const local = g.boundingSphere ? g.boundingSphere.radius : 0;
      const r = local * n.matrixWorld.getMaxScaleOnAxis();
      n.userData.__r = r;
      n.userData.__skinned = n.isSkinnedMesh === true;
      radii.push({ r, skinned: n.isSkinnedMesh === true, name: n.name });
    });
  }
  radii.sort((a, b) => a.r - b.r);
  const q = (p) => radii[Math.min(radii.length - 1, Math.floor(radii.length * p))];
  return {
    count: radii.length,
    skinned: radii.filter((x) => x.skinned).length,
    min: radii[0],
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    max: radii[radii.length - 1],
    sample: radii.slice(0, 8).map((x) => `${x.name}:${x.r.toFixed(3)}`),
  };
});
console.log("=== piece sub-mesh world radius distribution (ultra) ===");
console.log(JSON.stringify(hist, null, 1));

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
  const draw = await page.evaluate(() => window.__kg.draw());
  console.log(
    `  ${label.padEnd(26)} p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)  p95 ${perf.p95.toFixed(2)}  calls ${draw.calls}`,
  );
  return perf.p50;
}

console.log("\n=== threshold sweep (skinned body always casts) ===");
const results = [];
for (const t of [0, 0.02, 0.05, 0.09, 0.14, 0.2]) {
  const kept = await page.evaluate((th) => {
    const scene = window.__kg.scene();
    let on = 0;
    for (const child of scene.children) {
      if (!String(child.name).startsWith("piece_")) continue;
      child.traverse((n) => {
        if (!n.isMesh && !n.isSkinnedMesh) return;
        const keep = n.userData.__skinned || (n.userData.__r ?? 0) >= th;
        n.castShadow = keep;
        if (keep) on += 1;
      });
    }
    return on;
  }, t);
  await page.waitForTimeout(1200);
  const p50 = await measure(`t=${t} casters=${kept}`);
  results.push({ t, kept, p50 });
}

console.log("\n=== summary ===");
for (const r of results) {
  console.log(`  t=${String(r.t).padEnd(5)} casters ${String(r.kept).padStart(4)}  p50 ${r.p50.toFixed(2)}ms`);
}

await ctx.close();
await browser.close();
