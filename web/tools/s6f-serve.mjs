// S6-fresh: static server that reproduces a GitHub Pages PROJECT site locally.
// The dist is mounted UNDER /kings-gambit-medieval-chess/ exactly as Pages will
// serve it, so the local gate exercises the same URL space as production.
// Serving dist at "/" would silently hide every base-path bug.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const DIST = path.join(ROOT, 'web/dist');
const PORT = Number(process.env.S6_PORT || 8123);
const BASE = '/kings-gambit-medieval-chess';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === BASE) { res.writeHead(302, { Location: BASE + '/' }); res.end(); return; }
  if (!url.startsWith(BASE + '/')) { res.writeHead(404); res.end('outside base'); return; }
  let rel = url.slice(BASE.length + 1);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('traversal'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 ' + rel);
    return;
  }
  const buf = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
});

server.listen(PORT, () => {
  console.log('S6 staged server on http://127.0.0.1:' + PORT + BASE + '/');
});
