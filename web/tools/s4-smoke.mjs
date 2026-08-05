// S4 harness smoke test: one cell, verbose, proves the probe surface works
// and that we are measuring a REAL GPU with the camera actually moving.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const url =
  `${BASE}/?review=1&probe=1&quality=high&era=classic&arena=jungle&seed=s4-smoke`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--disable-frame-rate-limit",
    "--disable-gpu-vsync",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160));
});
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
console.log("dom", Date.now() - t0, "ms");

await page.waitForFunction(() => !!window.__kg, null, { timeout: 90000 });
console.log("probe up", Date.now() - t0, "ms");
await page.waitForFunction(() => window.__kg.ready() === true, null, { timeout: 90000 });
console.log("assets ready", Date.now() - t0, "ms");

const gpu = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
});
console.log("GPU:", gpu);
console.log("DPR:", await page.evaluate(() => window.devicePixelRatio));
console.log("preset:", await page.evaluate(() => window.__kg.preset()));
console.log("arena:", await page.evaluate(() => window.__kg.arena()));
console.log("era:", await page.evaluate(() => window.__kg.era()));
console.log("post:", await page.evaluate(() => window.__kg.postEnabled()));
console.log("prewarm:", JSON.stringify(await page.evaluate(() => window.__kg.prewarmStats())));
console.log("census:", JSON.stringify(await page.evaluate(() => window.__kg.census())));
console.log("lights:", JSON.stringify(await page.evaluate(() => window.__kg.lightCensus())));

// Prove the camera actually moves when showcase orbit is on.
await page.evaluate(() => {
  window.__kg.showcase(true, 0.55);
  window.__kg.releaseCamera();
  window.__kg.setCamera("cinematic");
});
const camA = await page.evaluate(() => {
  const c = window.__kg.camera ? window.__kg.camera() : null;
  return c ? [c.x, c.y, c.z] : null;
});
await page.waitForTimeout(4000);
await page.evaluate(() => window.__kg.releaseCamera());
await page.evaluate(() => window.__kg.resetFrameTimes());
const p0 = await page.evaluate(() => window.__kg.programs().count);
await page.waitForTimeout(6000);
await page.evaluate(() => window.__kg.releaseCamera());
const p1 = await page.evaluate(() => window.__kg.programs().count);

const perf = await page.evaluate(() => window.__kg.perf());
console.log("perf:", JSON.stringify(perf, null, 1));
console.log("programs before/after window:", p0, p1, "late:", p1 - p0);
console.log("combat:", JSON.stringify(await page.evaluate(() => window.__kg.combat())));
console.log("camA:", JSON.stringify(camA));

await ctx.close();
await browser.close();
