// Who are the remaining photometric violators? The summary count barely moved
// for the albedo floor, so the question is whether the surfaces I patched were
// simply not the ones violating it.
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
const PORT = 7200 + Math.floor(Math.random() * 400);
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
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto(`http://127.0.0.1:${PORT}/?arena=dusk&quality=low&review=1&probe=1&pinquality=1`, {
  waitUntil: "load", timeout: 90000,
});
await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 240000 });

const data = await page.evaluate(`(() => {
  const mats = window.__kg.materials();
  const surf = mats.filter((m) => (m.surface !== undefined ? m.surface : m.std));
  const low = surf.filter((m) => typeof m.albedoLum === 'number' && m.albedoLum < 0.02);
  const nonBin = surf.filter((m) => typeof m.metalness === 'number' && m.metalness > 0.05 && m.metalness < 0.95);
  const bucket = (arr, key) => {
    const out = {};
    for (const m of arr) {
      const k = key(m);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  return {
    surfaces: surf.length,
    lowCount: low.length,
    lowByType: bucket(low, (m) => m.type + (m.map ? '+map' : '')),
    lowSamples: low.slice(0, 14).map((m) => ({ type: m.type, lum: Number(m.albedoLum.toFixed(5)), map: m.map, nrm: m.normalMap })),
    nonBinCount: nonBin.length,
    nonBinValues: bucket(nonBin, (m) => String(Math.round(m.metalness * 100) / 100)),
    withNormal: surf.filter((m) => m.normalMap).length,
    withRough: surf.filter((m) => m.roughnessMap).length,
  };
})()`);

console.log(JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(root, "reports", "violators.json"), JSON.stringify(data, null, 2));
await browser.close();
server.close();
