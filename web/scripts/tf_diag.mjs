// Single-shot diagnostic: load one arena and dump the raw console/page errors.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const query = process.argv[2] || "arena=dusk&quality=high";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".glb": "model/gltf-binary", ".mp3": "audio/mpeg", ".txt": "text/plain",
};

const PORT = 6100 + Math.floor(Math.random() * 500);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + (e.stack || String(e))));

try {
  await page.goto(`http://127.0.0.1:${PORT}/?${query}&review=1&probe=1&pinquality=1`, {
    waitUntil: "load", timeout: 45000,
  });
  await page.waitForTimeout(9000);
  const ready = await page.evaluate("Boolean(window.__kg && window.__kg.ready && window.__kg.ready())");
  console.log("READY: " + ready);
} catch (e) {
  console.log("NAV_FAIL: " + String(e).slice(0, 300));
}

console.log("ERRORS (" + errors.length + "):");
for (const e of errors.slice(0, 8)) console.log("  " + e.slice(0, 600));

fs.writeFileSync(path.join(root, "reports", "diag.log"), errors.join("\n\n"));
await browser.close();
server.close();
