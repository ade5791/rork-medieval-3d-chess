// Rank badge legibility at REAL camera distance.
//
// The step requires that piece silhouettes and rank badges read at the actual
// play camera, not in an asset viewer. This measures the on-screen pixel
// footprint of each badge sprite by projecting its world-space corners through
// the live camera, and crops a real screenshot region around one badge so the
// result can be judged visually rather than asserted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const outDir = path.join(root, "reports", "captures", "badges");
fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg", ".txt": "text/plain",
};
const PORT = 7700 + Math.floor(Math.random() * 300);
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
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?arena=dusk&quality=high&review=1&probe=1&pinquality=1&nopost=1`, {
  waitUntil: "load", timeout: 90000,
});
await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 240000 });
await page.waitForTimeout(4000);

const measure = await page.evaluate(`(() => {
  const eng = window.__kg;
  if (!eng.badgeMetrics) return { missing: true };
  return eng.badgeMetrics();
})()`);

console.log(JSON.stringify(measure, null, 2).slice(0, 4000));
fs.writeFileSync(path.join(outDir, "badge-metrics.json"), JSON.stringify(measure, null, 2));

// Full frame plus a 2x zoom crop centred on the tallest badge, for visual proof.
await page.screenshot({ path: path.join(outDir, "badges-full.png"), timeout: 120000 }).catch((e) => console.log("shot fail", String(e).slice(0, 80)));

if (measure && measure.shots && measure.shots.length) {
  const b = measure.shots[0];
  const cx = Math.max(0, Math.round(b.x - 110));
  const cy = Math.max(0, Math.round(b.y - 110));
  await page.screenshot({
    path: path.join(outDir, "badge-crop.png"),
    clip: { x: cx, y: cy, width: 220, height: 220 },
    timeout: 120000,
  }).catch((e) => console.log("crop fail", String(e).slice(0, 80)));
}

await browser.close();
server.close();
