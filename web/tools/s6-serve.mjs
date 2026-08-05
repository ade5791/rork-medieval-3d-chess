/**
 * S6 staging server - serves the EXACT publish bytes under the SAME subpath the
 * live site will use (/kings-gambit-medieval-3d-chess/).
 *
 * Serving at "/" would be a different test: it would hide exactly the class of
 * bug this step exists to catch (root-absolute asset URLs that 404 on a project
 * Pages site while the HTML still returns 200). So the mount point is part of
 * the gate, not a convenience.
 *
 * Usage: node tools/s6-serve.mjs [port] [basePath] [rootDir]
 */
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2] || 8155);
const BASE = process.argv[3] || "/kings-gambit-medieval-3d-chess/";
const ROOT = normalize(
  new URL(`../${process.argv[4] || "dist"}/`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

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

  // Anything outside the base path is a 404 here, exactly as on Pages.
  if (!path.startsWith(BASE)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found (outside base)");
    return;
  }
  path = "/" + path.slice(BASE.length);
  if (path === "/" || path === "") path = "/index.html";

  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let st;
  try {
    st = statSync(full);
  } catch {
    // Pages serves 404 for a missing asset - do NOT SPA-fallback assets, or a
    // missing GLB would masquerade as a 200 and defeat the whole gate.
    if (/\.(glb|js|css|png|json|bin|woff2|svg|ico)$/i.test(path)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
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

// A ReadStream ENOENT raced by a client abort emits an unhandled 'error' event
// and kills the process mid-gate, which presents as ERR_CONNECTION_RESET on a
// perfectly good build. The server must outlive the gate, so swallow stream and
// socket errors rather than letting them reach the default handler.
server.on("clientError", (_err, socket) => {
  try {
    socket.destroy();
  } catch {
    /* already gone */
  }
});
process.on("uncaughtException", (err) => {
  console.error(`[serve] non-fatal: ${err && err.message ? err.message : err}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`S6 staging server http://127.0.0.1:${PORT}${BASE} root=${ROOT}`);
});
