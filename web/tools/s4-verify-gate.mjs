// S4: did the caster gate actually change anything? Count real castShadow
// flags in the live scene, and re-run the shadows-off delta to see what the
// shadow pass now costs.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "ultra";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-gate`, {
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

const counts = await page.evaluate(() => {
  const scene = window.__kg.scene();
  let pieceMeshes = 0;
  let pieceCasters = 0;
  let pieceSkinnedCasters = 0;
  let sceneCasters = 0;
  let sceneMeshes = 0;
  scene.traverse((n) => {
    if (!(n.isMesh || n.isSkinnedMesh || n.isInstancedMesh)) return;
    sceneMeshes += 1;
    if (n.castShadow) sceneCasters += 1;
  });
  for (const child of scene.children) {
    if (!String(child.name).startsWith("piece_")) continue;
    child.traverse((n) => {
      if (!(n.isMesh || n.isSkinnedMesh)) return;
      pieceMeshes += 1;
      if (n.castShadow) {
        pieceCasters += 1;
        if (n.isSkinnedMesh) pieceSkinnedCasters += 1;
      }
    });
  }
  return { pieceMeshes, pieceCasters, pieceSkinnedCasters, sceneMeshes, sceneCasters };
});

console.log(`=== caster flags, preset ${preset} ===`);
console.log(JSON.stringify(counts, null, 1));

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
  console.log(`  ${label.padEnd(30)} p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)  calls ${draw.calls}`);
  return { perf, draw };
}

console.log("\n--- measurements ---");
const base = await measure("baseline (gate active)");

// Total shadow cost now.
await page.evaluate(() => {
  const scene = window.__kg.scene();
  scene.traverse((n) => {
    if (n.isLight && n.castShadow) {
      n.userData.__had = true;
      n.castShadow = false;
    }
  });
});
await page.waitForTimeout(1500);
const off = await measure("all shadows off");
console.log(
  `\n  shadow pass now costs ${(base.perf.p50 - off.perf.p50).toFixed(2)}ms and ${base.draw.calls - off.draw.calls} calls`,
);

await ctx.close();
await browser.close();
