// S4: material set is stable and no material mutates, yet geometry count grows
// and one program compiles. So a NEW renderable object appears carrying a
// material variant the prewarm pass never saw. Diff renderable uuids.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=medium&era=classic&arena=jungle&phase=endgame&seed=s4-late&autoplay=1`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__kg.showcase(true, 0.5);
  window.__kg.releaseCamera();
});
await page.waitForTimeout(6000);

const result = await page.evaluate(async () => {
  const kg = window.__kg;
  const scene = kg.scene();

  const snap = () => {
    const m = new Map();
    scene.traverse((n) => {
      if (!(n.isMesh || n.isSkinnedMesh || n.isInstancedMesh || n.isPoints || n.isSprite || n.isLine)) return;
      const chain = [];
      let p = n;
      while (p && chain.length < 6) {
        chain.push(p.name || p.type);
        p = p.parent;
      }
      const mat = Array.isArray(n.material) ? n.material[0] : n.material;
      m.set(n.uuid, {
        objType: n.type,
        name: n.name || "",
        chain: chain.join(" < "),
        visible: n.visible,
        matType: mat ? mat.type : "-",
        matName: mat ? mat.name || "" : "-",
        hasOBC: mat ? !!mat.onBeforeCompile : false,
        maps: mat
          ? Object.entries({
              map: mat.map,
              normalMap: mat.normalMap,
              roughnessMap: mat.roughnessMap,
              metalnessMap: mat.metalnessMap,
              aoMap: mat.aoMap,
              emissiveMap: mat.emissiveMap,
              alphaMap: mat.alphaMap,
            })
              .filter(([, v]) => !!v)
              .map(([k]) => k)
              .join("+") || "none"
          : "-",
        transparent: mat ? !!mat.transparent : false,
        skinned: !!n.isSkinnedMesh,
      });
    });
    return m;
  };

  const before = snap();
  const startProgs = kg.programs().count;
  const t0 = performance.now();
  let after = null;
  let at = -1;
  while (performance.now() - t0 < 25000) {
    if (kg.programs().count > startProgs) {
      after = snap();
      at = performance.now() - t0;
      break;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  if (!after) return { at: -1, added: [], removed: [], combat: kg.combat() };

  const added = [];
  for (const [uuid, v] of after) if (!before.has(uuid)) added.push({ uuid, ...v });
  const removed = [];
  for (const [uuid, v] of before) if (!after.has(uuid)) removed.push({ uuid, ...v });
  return { at, added, removed, beforeCount: before.size, afterCount: after.size, combat: kg.combat() };
});

console.log(`program growth at ${result.at < 0 ? "NEVER" : result.at.toFixed(0) + "ms"}`);
console.log(`renderables ${result.beforeCount} -> ${result.afterCount}`);
console.log(`combat state at growth: ${JSON.stringify(result.combat)}`);
console.log(`\n=== RENDERABLES ADDED (${result.added.length}) ===`);
for (const a of result.added.slice(0, 25)) {
  console.log(`${a.objType} "${a.name}" mat=${a.matType} maps=${a.maps} obc=${a.hasOBC} transparent=${a.transparent} skinned=${a.skinned} visible=${a.visible}`);
  console.log(`   chain: ${a.chain}`);
}
console.log(`\n=== RENDERABLES REMOVED (${result.removed.length}) ===`);
for (const r of result.removed.slice(0, 10)) console.log(`${r.objType} "${r.name}" chain=${r.chain}`);

await ctx.close();
await browser.close();
