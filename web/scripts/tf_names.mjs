// Name the violators using the probe's own material list, grouped by owner.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

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

const arena = process.argv[2] || "dusk";
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto(`http://127.0.0.1:${PORT}/?arena=${arena}&quality=low&review=1&probe=1&pinquality=1`, {
  waitUntil: "load", timeout: 90000,
});
await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 240000 });
await page.waitForTimeout(2500);

const data = await page.evaluate(`(() => {
  const rows = window.__kg.materials().filter((r) => r.surface);
  const groups = {};
  for (const r of rows) {
    const badAlbedo = r.albedoLum !== null && r.albedoLum < 0.02 && !r.map;
    const badMetal = r.metalness > 0.05 && r.metalness < 0.95;
    if (!badAlbedo && !badMetal) continue;
    const owner = (r.owner || '?').split(' < ');
    const key = owner.slice(1, 3).join(' < ') || owner[0];
    groups[key] = groups[key] || { count: 0, albedo: 0, metal: 0, metalVals: {}, sample: null };
    const g = groups[key];
    g.count += 1;
    if (badAlbedo) g.albedo += 1;
    if (badMetal) { g.metal += 1; g.metalVals[r.metalness] = (g.metalVals[r.metalness] || 0) + 1; }
    if (!g.sample) g.sample = { mesh: owner[0], mat: r.matName, lum: r.albedoLum, metal: r.metalness, rough: r.roughness, map: r.map, nrm: r.normalMap };
  }
  return { totalSurfaces: rows.length, groups };
})()`);

console.log(JSON.stringify(data, null, 2).slice(0, 7000));
fs.writeFileSync(path.join(root, "reports", `violator-names-${arena}.json`), JSON.stringify(data, null, 2));
await browser.close();
server.close();
