// S4: measure the ACTUAL world-space size distribution of piece sub-meshes,
// instead of assuming the local bounding sphere is comparable to the figure
// height. A GLB sub-mesh sphere is in model units and the container is scaled,
// so the two are not the same space - which is why the first gate never fired.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=ultra&era=classic&arena=jungle&seed=s4-sizes`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const data = await page.evaluate(() => {
  const scene = window.__kg.scene();
  const rows = [];
  for (const child of scene.children) {
    const name = String(child.name || "");
    if (!name.startsWith("piece_")) continue;
    child.updateWorldMatrix(true, true);
    const parts = [];
    child.traverse((n) => {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      const g = n.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = g.boundingSphere ? g.boundingSphere.radius : 0;
      // World scale of this node.
      const s = n.matrixWorld.getMaxScaleOnAxis();
      parts.push({
        name: n.name || "(unnamed)",
        localR: r,
        worldR: r * s,
        scale: s,
        cast: !!n.castShadow,
        tris: g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3,
      });
    });
    rows.push({ piece: name, parts });
  }
  return rows;
});

console.log("=== piece sub-mesh world sizes (ultra) ===");
const sample = data.slice(0, 3);
for (const p of sample) {
  console.log(`\n${p.piece}  (${p.parts.length} meshes)`);
  for (const m of p.parts.sort((a, b) => b.worldR - a.worldR)) {
    console.log(
      `   worldR ${m.worldR.toFixed(3).padStart(7)}  localR ${m.localR.toFixed(2).padStart(8)}  scale ${m.scale.toFixed(4).padStart(7)}  cast ${m.cast ? "Y" : "n"}  tris ${String(Math.round(m.tris)).padStart(6)}  ${m.name.slice(0, 28)}`,
    );
  }
}

// Aggregate: what would various world-radius thresholds remove?
const all = data.flatMap((p) => p.parts);
console.log(`\ntotal piece sub-meshes: ${all.length}, currently casting: ${all.filter((m) => m.cast).length}`);
const maxR = Math.max(...all.map((m) => m.worldR));
console.log(`max worldR ${maxR.toFixed(3)}`);
for (const t of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
  const kept = all.filter((m) => m.worldR >= t).length;
  console.log(`  threshold worldR >= ${t.toFixed(2)}  keeps ${kept}/${all.length} casters (drops ${all.length - kept})`);
}

await ctx.close();
await browser.close();
