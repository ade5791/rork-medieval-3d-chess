// Re-capture only the shots that failed on cold start, with a longer ready
// timeout and a warmed server. Merges into the existing measurements.json so
// the after-set is complete and comparable to the before-set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const label = process.argv[2] || "after";
const outDir = path.join(root, "reports", "captures", label);
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { id: "dusk-high", q: "arena=dusk&quality=high" },
  { id: "dusk-high-nopost", q: "arena=dusk&quality=high&nopost=1" },
];

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".txt": "text/plain",
};

const PORT = 6700 + Math.floor(Math.random() * 400);
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(dist, url === "/" ? "index.html" : url.replace(/^\//, ""));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio",
  ],
});

const out = [];
for (const shot of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  let payload = null;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?${shot.q}&review=1&probe=1&pinquality=1`, {
      waitUntil: "load", timeout: 90000,
    });
    // Cold SwiftShader start needs a much longer budget than the GPU path.
    await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 180000 });
    await page.waitForTimeout(4500);
    await page.evaluate("window.__kg.resetFrameTimes()");
    await page.waitForTimeout(3000);
    payload = await page.evaluate(`(() => {
      const k = window.__kg;
      return {
        arena: k.arena(), preset: k.preset(), postEnabled: k.postEnabled(),
        exposure: k.exposure(), info: k.info(), lights: k.lights(),
        materials: k.materials(), histogram: k.histogram(), frameTimes: k.frameTimes(),
      };
    })()`);
    await page.screenshot({ path: path.join(outDir, shot.id + ".png") });
  } catch (err) {
    errors.push("CAPTURE_FAIL: " + String(err).slice(0, 300));
  }

  const ft = (payload?.frameTimes || []).slice().sort((a, b) => a - b);
  const pct = (p) => (ft.length ? ft[Math.min(ft.length - 1, Math.floor(ft.length * p))] : null);
  out.push({
    id: shot.id, query: shot.q, ok: Boolean(payload), errors,
    arena: payload?.arena, preset: payload?.preset, postEnabled: payload?.postEnabled,
    exposure: payload?.exposure, info: payload?.info,
    lightCount: payload?.lights?.length, lights: payload?.lights,
    histogram: payload?.histogram,
    frame: ft.length ? { n: ft.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: ft[ft.length - 1] } : null,
    materialSummary: (() => {
      const m = payload?.materials || [];
      const std = m.filter((x) => x.std);
      const lums = std.map((x) => x.albedoLum).filter((v) => typeof v === "number").sort((a, b) => a - b);
      return {
        total: m.length, standard: std.length,
        withMap: std.filter((x) => x.map).length,
        withNormalMap: std.filter((x) => x.normalMap).length,
        withRoughnessMap: std.filter((x) => x.roughnessMap).length,
        withAoMap: std.filter((x) => x.aoMap).length,
        albedoBelow002: lums.filter((v) => v < 0.02).length,
        albedoAbove09: lums.filter((v) => v > 0.9).length,
        nonBinaryMetal: std.filter((x) => x.metalness > 0.05 && x.metalness < 0.95).length,
        albedoMin: lums[0] ?? null,
        albedoMedian: lums[Math.floor(lums.length / 2)] ?? null,
        albedoMax: lums[lums.length - 1] ?? null,
      };
    })(),
  });
  console.log(`${shot.id}: ok=${Boolean(payload)} post=${payload?.postEnabled} err=${errors.length}`);
  await page.close();
  await ctx.close();
}

// Merge into the existing measurements file.
const mFile = path.join(outDir, "measurements.json");
let existing = [];
if (fs.existsSync(mFile)) existing = JSON.parse(fs.readFileSync(mFile, "utf8"));
const byId = new Map(existing.map((r) => [r.id, r]));
for (const r of out) byId.set(r.id, r);
const order = ["dusk-high", "dusk-high-nopost", "jungle-high", "jungle-high-nopost", "dusk-ultra", "jungle-ultra", "dusk-low", "jungle-low"];
const merged = order.map((id) => byId.get(id)).filter(Boolean);
fs.writeFileSync(mFile, JSON.stringify(merged, null, 2));
console.log("MERGED " + merged.length + " shots");

await browser.close();
server.close();
