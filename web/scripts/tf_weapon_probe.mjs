// Why do weapon materials still report no normal map?
// Checks, on a real weapon mesh in the live scene: does the geometry have a uv
// attribute, and does the material actually carry normalMap/roughnessMap.
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

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto(`http://127.0.0.1:${PORT}/?arena=dusk&quality=low&review=1&probe=1&pinquality=1`, {
  waitUntil: "load", timeout: 90000,
});
await page.waitForFunction("window.__kg && window.__kg.ready && window.__kg.ready()", null, { timeout: 240000 });
await page.waitForTimeout(2500);

const out = await page.evaluate(`(() => {
  const rows = window.__kg.materials().filter((r) => r.surface);
  const weapons = rows.filter((r) => (r.owner || '').indexOf('weapon_') !== -1);
  const sample = weapons.slice(0, 5).map((r) => ({
    owner: r.owner, metal: r.metalness, rough: r.roughness,
    nrm: r.normalMap, rgh: r.roughnessMap, lum: r.albedoLum,
  }));
  return { weaponCount: weapons.length, sample };
})()`);

console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
