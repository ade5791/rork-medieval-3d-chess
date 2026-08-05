// Minimal static server for the S3 combat gate (dist/, SPA fallback).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "dist");
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".hdr": "application/octet-stream",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = join(ROOT, decodeURIComponent(url.pathname));
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(ROOT, "index.html"); // SPA fallback
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
