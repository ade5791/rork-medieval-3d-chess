// S4: prewarm now compiles hidden objects, yet one program still appears at
// ~14s and geometry count grows by 3. So the object does not exist at prewarm
// time at all - it is constructed lazily. Trap Object3D.add and geometry
// construction to catch the creation with a stack.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("TRAP")) console.log(t);
});
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

await page.evaluate(() => {
  const scene = window.__kg.scene();
  window.__t0 = performance.now();

  // Walk up to the Object3D prototype from a real node.
  let proto = Object.getPrototypeOf(scene);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "add")) proto = Object.getPrototypeOf(proto);
  if (!proto) {
    console.log("TRAP could not locate Object3D.prototype.add");
    return;
  }
  const origAdd = proto.add;
  proto.add = function (...kids) {
    const t = performance.now() - window.__t0;
    if (t > 500) {
      for (const k of kids) {
        if (!k) continue;
        let renderables = 0;
        const mats = new Set();
        k.traverse &&
          k.traverse((n) => {
            if (n.isMesh || n.isSkinnedMesh || n.isInstancedMesh || n.isPoints || n.isSprite) {
              renderables += 1;
              const m = Array.isArray(n.material) ? n.material[0] : n.material;
              if (m) {
                const maps = Object.entries({
                  map: m.map,
                  normalMap: m.normalMap,
                  roughnessMap: m.roughnessMap,
                  aoMap: m.aoMap,
                  emissiveMap: m.emissiveMap,
                })
                  .filter(([, v]) => !!v)
                  .map(([x]) => x)
                  .join("+") || "none";
                mats.add(`${m.type}:${maps}`);
              }
            }
          });
        if (renderables > 0) {
          const stack = (new Error().stack || "").split("\n").slice(2, 7).join(" | ");
          console.log(
            `TRAP add t=${t.toFixed(0)}ms into=${this.name || this.type} child=${k.name || k.type} renderables=${renderables} mats=${[...mats].join(",")} stack=${stack}`,
          );
        }
      }
    }
    return origAdd.apply(this, kids);
  };
  console.log("TRAP armed on Object3D.prototype.add");
});

const before = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(22000);
const after = await page.evaluate(() => window.__kg.programs().count);
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`\nprograms ${before} -> ${after}  max ${perf.max.toFixed(1)}ms hitches ${perf.hitches50}`);

await ctx.close();
await browser.close();
