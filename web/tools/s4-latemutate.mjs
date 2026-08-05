// S4: no material was added or removed, so an EXISTING material mutated a
// map slot mid-play, which changes its program cacheKey and forces a compile.
// Fingerprint every material's key-relevant fields and diff on program growth.
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

  // Fields that participate in the WebGLPrograms cache key.
  const fp = (x, owner, chain) => ({
    owner,
    chain,
    type: x.type,
    name: x.name || "",
    map: !!x.map,
    normalMap: !!x.normalMap,
    roughnessMap: !!x.roughnessMap,
    metalnessMap: !!x.metalnessMap,
    aoMap: !!x.aoMap,
    emissiveMap: !!x.emissiveMap,
    alphaMap: !!x.alphaMap,
    lightMap: !!x.lightMap,
    bumpMap: !!x.bumpMap,
    displacementMap: !!x.displacementMap,
    envMap: !!x.envMap,
    transparent: !!x.transparent,
    vertexColors: !!x.vertexColors,
    flatShading: !!x.flatShading,
    side: x.side,
    alphaTest: x.alphaTest,
    fog: !!x.fog,
    skinning: !!x.skinning,
    visible: x.visible,
  });

  const snap = () => {
    const m = new Map();
    scene.traverse((n) => {
      const mat = n.material;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      const chain = [];
      let p = n;
      while (p && chain.length < 5) {
        chain.push(p.name || p.type);
        p = p.parent;
      }
      for (const x of list) m.set(x.uuid, fp(x, n.name || n.type, chain.join(" < ")));
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
  if (!after) return { at: -1, changed: [] };

  const changed = [];
  for (const [uuid, b] of before) {
    const a = after.get(uuid);
    if (!a) continue;
    const diffs = [];
    for (const k of Object.keys(b)) {
      if (k === "owner" || k === "chain") continue;
      if (b[k] !== a[k]) diffs.push(`${k}: ${b[k]} -> ${a[k]}`);
    }
    if (diffs.length) changed.push({ uuid, owner: a.owner, chain: a.chain, type: a.type, name: a.name, diffs });
  }
  return { at, changed };
});

console.log(`program growth at ${result.at < 0 ? "NEVER" : result.at.toFixed(0) + "ms"}`);
console.log(`\n=== MATERIALS WITH KEY-RELEVANT MUTATIONS (${result.changed.length}) ===`);
for (const c of result.changed) {
  console.log(`${c.type} name="${c.name}" owner=${c.owner}`);
  console.log(`   chain: ${c.chain}`);
  for (const d of c.diffs) console.log(`   ${d}`);
}

await ctx.close();
await browser.close();
