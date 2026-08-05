// Is the albedo probe double-converting sRGB -> linear?
//
// THREE.ColorManagement (on by default in r152+) converts a hex assignment from
// sRGB into the linear working space immediately. So material.color.r is ALREADY
// linear. If the probe then runs srgbToLinear() over it a second time, every
// albedo is reported far darker than it truly is - and the "albedo floor
// violations" would be a measurement artifact rather than a real defect.
//
// This compares three readings of the same material:
//   getHexString()  -> the authored sRGB hex (round-trips back through encoding)
//   color.r/g/b     -> the working-space value the renderer actually uses
//   double-converted-> what the probe currently reports
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
await page.waitForTimeout(2000);

const result = await page.evaluate(`(() => {
  const THREE = window.__THREE__ || null;
  const out = { colorManagement: null, samples: [] };
  const rows = window.__kg.materials().filter((r) => r.surface && r.albedoLum !== null);
  rows.sort((a, b) => a.albedoLum - b.albedoLum);
  return { probeLowest: rows.slice(0, 6).map((r) => ({ owner: (r.owner||'').split(' < ')[1], lum: r.albedoLum })) };
})()`);

// Now read the true values straight off the scene graph via the debug hook.
const truth = await page.evaluate(`(() => {
  const eng = window.__kg;
  if (!eng.albedoTruth) return { missing: true };
  return eng.albedoTruth();
})()`);

console.log(JSON.stringify({ probe: result, truth }, null, 2));
await browser.close();
server.close();
