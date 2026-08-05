// Detail-map coverage by owner group. Confirms whether the weapon surface
// binding actually reached the rendered materials, and finds which groups are
// still bare (the real "flat plastic at close range" list).
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
    const owner = (r.owner || '?').split(' < ');
    let key = owner.slice(1, 3).join(' < ') || owner[0];
    if (key.indexOf('weapon_') !== -1) key = 'WEAPONS (all)';
    groups[key] = groups[key] || { n: 0, nrm: 0, rgh: 0 };
    groups[key].n += 1;
    if (r.normalMap) groups[key].nrm += 1;
    if (r.roughnessMap) groups[key].rgh += 1;
  }
  const total = rows.length;
  const withNrm = rows.filter((r) => r.normalMap).length;
  return { total, withNrm, pct: Math.round((withNrm / total) * 100), groups };
})()`);

console.log(`arena=${arena}  surfaces=${data.total}  withNormal=${data.withNrm} (${data.pct}%)\n`);
const entries = Object.entries(data.groups).sort((a, b) => b[1].n - a[1].n);
for (const [k, v] of entries) {
  const pct = Math.round((v.nrm / v.n) * 100);
  const flag = pct === 0 ? "  <-- BARE" : "";
  console.log(`${k.padEnd(40)} n=${String(v.n).padEnd(4)} normal=${String(v.nrm).padEnd(4)} rough=${String(v.rgh).padEnd(4)} ${String(pct).padStart(3)}%${flag}`);
}
fs.writeFileSync(path.join(root, "reports", `coverage-${arena}.json`), JSON.stringify(data, null, 2));
await browser.close();
server.close();
