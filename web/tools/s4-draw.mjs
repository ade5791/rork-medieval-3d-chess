// S4: real draw calls per preset, plus the biggest draw-call contributors.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const presets = ["low", "medium", "high", "ultra"];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});

for (const preset of presets) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-draw`, {
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
  await page.waitForTimeout(1200);
  const draw = await page.evaluate(() => window.__kg.draw());
  const census = await page.evaluate(() => window.__kg.census());
  const lights = await page.evaluate(() => window.__kg.lightCensus());

  await page.evaluate(() => window.__kg.resetFrameTimes());
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__kg.releaseCamera());
  }
  const perf = await page.evaluate(() => window.__kg.perf());

  // Visible mesh census - what is actually being submitted.
  const visible = await page.evaluate(() => {
    // Count visible meshes by rough category using object names.
    const out = { visibleMeshes: 0, instanced: 0, skinned: 0, sprites: 0, points: 0 };
    return out;
  });

  console.log(
    `${preset.padEnd(7)} calls ${String(draw.calls).padStart(5)}  tris ${String(draw.triangles).padStart(8)}  ` +
      `meshes ${String(census.meshes).padStart(4)}  geo ${String(census.geometries).padStart(4)}  tex ${String(census.textures).padStart(4)}  ` +
      `prog ${String(census.programs).padStart(3)}  lights ${lights.total}/${lights.visible}vis/${lights.lit}lit  ` +
      `p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)`,
  );

  await ctx.close();
}
await browser.close();
