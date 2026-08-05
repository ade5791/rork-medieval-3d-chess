// S4: attribute draw calls to subsystems by hiding one group at a time and
// re-measuring. Shows exactly where the CPU submission cost lives.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "ultra";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-attr`, {
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
await page.waitForTimeout(1000);

// Top-level scene children, with the visible mesh count under each. This is
// the honest map of what is being submitted.
const tree = await page.evaluate(() => {
  const kg = window.__kg;
  const scene = kg.scene ? kg.scene() : null;
  if (!scene) return null;
  const out = [];
  for (const child of scene.children) {
    let meshes = 0;
    let visMeshes = 0;
    let tris = 0;
    let shadowCasters = 0;
    child.traverse((n) => {
      if (n.isMesh || n.isInstancedMesh || n.isSkinnedMesh || n.isPoints || n.isSprite) {
        meshes += 1;
        // visible only if the whole chain up to child is visible
        let v = n.visible;
        let p = n.parent;
        while (v && p && p !== child.parent) {
          v = p.visible;
          p = p.parent;
        }
        if (v) {
          visMeshes += 1;
          if (n.castShadow) shadowCasters += 1;
          const g = n.geometry;
          if (g) {
            const count = n.isInstancedMesh ? n.count : 1;
            const idx = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0;
            tris += (idx / 3) * count;
          }
        }
      }
    });
    out.push({
      name: child.name || child.type,
      type: child.type,
      visible: child.visible,
      meshes,
      visMeshes,
      shadowCasters,
      tris: Math.round(tris),
    });
  }
  return out.sort((a, b) => b.visMeshes - a.visMeshes);
});

if (!tree) {
  console.log("scene not exposed on probe - add a scene() accessor to attribute by group");
} else {
  console.log(`=== scene groups, preset ${preset} ===`);
  console.log("  visMesh  casters      tris  name");
  for (const g of tree) {
    if (g.meshes === 0) continue;
    console.log(
      `  ${String(g.visMeshes).padStart(7)}  ${String(g.shadowCasters).padStart(7)}  ${String(g.tris).padStart(8)}  ${g.name}${g.visible ? "" : "  (HIDDEN)"}`,
    );
  }
}

const draw = await page.evaluate(() => window.__kg.draw());
console.log(`\ntotal draw calls/frame: ${draw.calls}, triangles ${draw.triangles}`);

await ctx.close();
await browser.close();
