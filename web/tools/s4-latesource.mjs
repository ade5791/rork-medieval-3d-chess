// S4: name the object whose material compiles late. Snapshot every material in
// the graph before the window, then diff the graph the instant the program
// count grows. The new material's owner chain is the actual defect site.
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
      const mat = n.material;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const x of list) {
        if (!m.has(x.uuid)) {
          const chain = [];
          let p = n;
          while (p && chain.length < 6) {
            chain.push(p.name || p.type);
            p = p.parent;
          }
          m.set(x.uuid, {
            type: x.type,
            name: x.name || "",
            owner: n.name || n.type,
            chain: chain.join(" < "),
            transparent: x.transparent,
            hasOBC: !!x.onBeforeCompile,
            maps: {
              map: !!x.map,
              normalMap: !!x.normalMap,
              roughnessMap: !!x.roughnessMap,
              aoMap: !!x.aoMap,
              emissiveMap: !!x.emissiveMap,
              alphaMap: !!x.alphaMap,
              metalnessMap: !!x.metalnessMap,
            },
          });
        }
      }
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
    await new Promise((r) => setTimeout(r, 30));
  }
  if (!after) return { at: -1, added: [], removed: [] };

  const added = [];
  for (const [uuid, v] of after) if (!before.has(uuid)) added.push({ uuid, ...v });
  const removed = [];
  for (const [uuid, v] of before) if (!after.has(uuid)) removed.push({ uuid, ...v });
  return { at, added, removed, beforeCount: before.size, afterCount: after.size };
});

console.log(`program growth at ${result.at < 0 ? "NEVER" : result.at.toFixed(0) + "ms"}`);
console.log(`materials in graph: ${result.beforeCount} -> ${result.afterCount}`);
console.log(`\n=== MATERIALS ADDED (${result.added.length}) ===`);
for (const a of result.added) {
  console.log(`${a.type}  name="${a.name}"  owner=${a.owner}`);
  console.log(`   chain: ${a.chain}`);
  console.log(`   transparent=${a.transparent} onBeforeCompile=${a.hasOBC} maps=${JSON.stringify(a.maps)}`);
}
console.log(`\n=== MATERIALS REMOVED (${result.removed.length}) ===`);
for (const r of result.removed.slice(0, 10)) console.log(`${r.type} owner=${r.owner} chain=${r.chain}`);

await ctx.close();
await browser.close();
