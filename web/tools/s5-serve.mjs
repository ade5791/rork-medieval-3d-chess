// Static server for the S5 QA matrix. Serves dist/ with correct MIME types.
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORT = Number(process.argv[2] || 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path === "/" || path === "") path = "/index.html";
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(normalize(ROOT))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let st;
  try {
    st = statSync(full);
  } catch {
    // SPA fallback
    res.writeHead(200, { "content-type": MIME[".html"] });
    createReadStream(join(ROOT, "index.html")).pipe(res);
    return;
  }
  if (st.isDirectory()) {
    res.writeHead(200, { "content-type": MIME[".html"] });
    createReadStream(join(ROOT, "index.html")).pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(full).toLowerCase()] || "application/octet-stream",
    "content-length": st.size,
    "cache-control": "no-store",
  });
  createReadStream(full).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("S5 server on http://127.0.0.1:" + PORT + " root=" + ROOT);
});
