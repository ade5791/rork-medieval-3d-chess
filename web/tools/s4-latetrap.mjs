// S4: the late program key ends with "onBeforeCompile(){}", so the culprit IS
// an OBC material. Wrap every OBC material's hook - it fires exactly when the
// renderer compiles that material - and report the owner chain at that instant.
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
  if (t.startsWith("LATECOMPILE")) console.log(t);
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

// Arm the trap AFTER warmup, so only late compiles are reported.
await page.evaluate(() => {
  const scene = window.__kg.scene();
  window.__armed = performance.now();
  const seen = new Set();
  scene.traverse((n) => {
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of mats) {
      if (!m.onBeforeCompile || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const orig = m.onBeforeCompile;
      const chain = [];
      let p = n;
      while (p && chain.length < 6) {
        chain.push(p.name || p.type);
        p = p.parent;
      }
      const desc = `${m.type} name="${m.name || ""}" owner=${n.name || n.type} chain=${chain.join(" < ")} visible=${n.visible} matVisible=${m.visible}`;
      m.onBeforeCompile = function (shader, renderer) {
        const t = (performance.now() - window.__armed).toFixed(0);
        const maps = Object.entries({
          map: m.map,
          normalMap: m.normalMap,
          roughnessMap: m.roughnessMap,
          metalnessMap: m.metalnessMap,
          aoMap: m.aoMap,
          emissiveMap: m.emissiveMap,
          alphaMap: m.alphaMap,
        })
          .filter(([, v]) => !!v)
          .map(([k]) => k)
          .join("+") || "none";
        console.log(`LATECOMPILE t=${t}ms maps=${maps} ${desc}`);
        return orig.call(this, shader, renderer);
      };
    }
  });
  const count = seen.size;
  console.log(`LATECOMPILE armed on ${count} OBC materials`);
});

const startProgs = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(22000);
const endProgs = await page.evaluate(() => window.__kg.programs().count);
const perf = await page.evaluate(() => window.__kg.perf());
console.log(`\nprograms ${startProgs} -> ${endProgs}   max frame ${perf.max.toFixed(1)}ms  hitches>50ms ${perf.hitches50}`);

await ctx.close();
await browser.close();
