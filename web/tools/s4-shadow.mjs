// S4: how much of the draw-call load is the shadow pass?
// Counts shadow-casting lights and measures with shadow map updates frozen.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "ultra";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-shadow`, {
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

const shadowInfo = await page.evaluate(() => {
  const scene = window.__kg.scene();
  const lights = [];
  let casters = 0;
  scene.traverse((n) => {
    if (n.isLight) {
      lights.push({
        type: n.type,
        castShadow: !!n.castShadow,
        intensity: n.intensity,
        mapSize: n.shadow ? `${n.shadow.mapSize.x}x${n.shadow.mapSize.y}` : "-",
      });
    }
    if ((n.isMesh || n.isSkinnedMesh || n.isInstancedMesh) && n.castShadow && n.visible) casters += 1;
  });
  return { lights, casters, shadow: window.__kg.shadow() };
});

console.log(`=== shadows, preset ${preset} ===`);
console.log("shadowMap:", JSON.stringify(shadowInfo.shadow));
console.log("visible shadow-casting meshes:", shadowInfo.casters);
console.log("\nlights:");
for (const l of shadowInfo.lights) {
  console.log(`  ${l.castShadow ? "CAST" : "    "} ${l.type.padEnd(18)} i=${l.intensity.toFixed(2).padStart(7)}  map ${l.mapSize}`);
}
const casting = shadowInfo.lights.filter((l) => l.castShadow).length;
console.log(`\nshadow-casting lights: ${casting}`);

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
  console.log(`  ${label.padEnd(28)} p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)  calls ${draw.calls}`);
  return { perf, draw };
}

console.log("\n--- measurements ---");
const base = await measure("baseline");

// Freeze shadow updates: the maps keep their content but are not re-rendered.
await page.evaluate(() => {
  const kg = window.__kg;
  const scene = kg.scene();
  scene.traverse(() => {});
  // reach the renderer via a shadow toggle exposed on the probe
});
await page.evaluate(() => {
  // Freeze via three's own switch, reachable from any light's parent renderer
  // is not exposed; instead disable castShadow on every light.
  const scene = window.__kg.scene();
  scene.traverse((n) => {
    if (n.isLight && n.castShadow) {
      n.userData.__hadShadow = true;
      n.castShadow = false;
    }
  });
});
await page.waitForTimeout(1500);
const noShadow = await measure("all light shadows off");

// Restore
await page.evaluate(() => {
  const scene = window.__kg.scene();
  scene.traverse((n) => {
    if (n.isLight && n.userData.__hadShadow) n.castShadow = true;
  });
});
await page.waitForTimeout(1500);

// Now: pieces stop casting shadows (they are the bulk of the caster count).
await page.evaluate(() => {
  const scene = window.__kg.scene();
  for (const child of scene.children) {
    if (!String(child.name).startsWith("piece_")) continue;
    child.traverse((n) => {
      if (n.castShadow) {
        n.userData.__hadCast = true;
        n.castShadow = false;
      }
    });
  }
});
await page.waitForTimeout(1500);
const noPieceShadow = await measure("piece shadows off");

console.log("\n--- deltas vs baseline ---");
console.log(
  `  all light shadows off : ${(base.perf.p50 - noShadow.perf.p50).toFixed(2)}ms faster, ${base.draw.calls - noShadow.draw.calls} fewer calls`,
);
console.log(
  `  piece shadows off     : ${(base.perf.p50 - noPieceShadow.perf.p50).toFixed(2)}ms faster, ${base.draw.calls - noPieceShadow.draw.calls} fewer calls`,
);

await ctx.close();
await browser.close();
