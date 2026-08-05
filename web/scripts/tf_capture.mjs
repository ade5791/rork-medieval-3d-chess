// Isolated capture harness.
// One fresh page per shot (never reuse - particle age and exposure state leak
// forward and make the gate meaningless). Serves the production build, pins the
// review state, waits for the scene to settle, then records a screenshot plus
// the measured probe payload.
//
// usage: node scripts/tf_capture.mjs <label>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { summarise } from "./tf_summary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const label = process.argv[2] || "run";
const outDir = path.join(root, "reports", "captures", label);
fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".txt": "text/plain",
};

function serve(port) {
  return new Promise((resolve) => {
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
    server.listen(port, () => resolve(server));
  });
}

// Shot list: both battlegrounds named in the brief, plus the no-post gate.
const SHOTS = [
  { id: "dusk-high",        q: "arena=dusk&quality=high" },
  { id: "dusk-high-nopost", q: "arena=dusk&quality=high&nopost=1" },
  { id: "jungle-high",      q: "arena=jungle&quality=high" },
  { id: "jungle-high-nopost", q: "arena=jungle&quality=high&nopost=1" },
  { id: "dusk-ultra",       q: "arena=dusk&quality=ultra" },
  { id: "jungle-ultra",     q: "arena=jungle&quality=ultra" },
  { id: "dusk-low",         q: "arena=dusk&quality=low" },
  { id: "jungle-low",       q: "arena=jungle&quality=low" },
];

const PORT = 5311 + Math.floor(Math.random() * 400);

const server = await serve(PORT);
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-lcd-text",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--mute-audio",
  ],
});

const results = [];

for (const shot of SHOTS) {
  // Fresh context AND page per shot - this is the isolation rule.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  const url = `http://127.0.0.1:${PORT}/?${shot.q}&review=1&probe=1&pinquality=1`;
  let payload = null;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    // Wait for the probe and for the piece factory to finish loading.
    await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 180000 });
    // Let the scene settle to a steady state (particles, tweens, autorotate).
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
    errors.push("CAPTURE_FAIL: " + String(err));
  }

  const ft = (payload?.frameTimes || []).slice().sort((a, b) => a - b);
  const pct = (p) => (ft.length ? ft[Math.min(ft.length - 1, Math.floor(ft.length * p))] : null);

  results.push({
    id: shot.id,
    query: shot.q,
    ok: Boolean(payload),
    errors,
    arena: payload?.arena,
    preset: payload?.preset,
    postEnabled: payload?.postEnabled,
    exposure: payload?.exposure,
    info: payload?.info,
    lightCount: payload?.lights?.length,
    lights: payload?.lights,
    histogram: payload?.histogram,
    frame: ft.length ? { n: ft.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: ft[ft.length - 1] } : null,
    materialSummary: summarise(payload?.materials),
  });

  console.log(`${shot.id}: ok=${Boolean(payload)} post=${payload?.postEnabled} mats=${payload?.materials?.length} err=${errors.length}`);
  await page.close();
  await ctx.close();
}

fs.writeFileSync(path.join(outDir, "measurements.json"), JSON.stringify(results, null, 2));
await browser.close();
server.close();
console.log("WROTE " + path.join(outDir, "measurements.json"));
