// S6-fresh: full asset-inventory verification over HTTP.
//
// This is the check that catches the failure mode the step calls out: a build
// that returns 200 on index.html while its models/ directory was never
// deployed. Every file in the manifest is fetched and its sha256 compared to
// the gated bytes. Anything short of byte-identity is a FAIL.
//
// Usage: node s6f-http-verify.mjs <baseUrl> [manifest.json] [out.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const BASE = (process.argv[2] || 'http://127.0.0.1:8123/kings-gambit-medieval-chess/').replace(/\/?$/, '/');
const MANIFEST = process.argv[3] || path.join(ROOT, 'web/tools/out/s6f-manifest.json');
const OUT = process.argv[4] || path.join(ROOT, 'web/tools/out/s6f-http-verify.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
console.log('base      = ' + BASE);
console.log('manifest  = ' + manifest.fileCount + ' files, ' + manifest.totalBytes + ' bytes');
console.log('aggregate = ' + manifest.aggregateSha256);
console.log('');

const results = [];
let ok = 0, sizeMismatch = 0, hashMismatch = 0, missing = 0, errored = 0;

// Concurrency-limited fetch so a 189 MB inventory does not thrash the socket
// pool or the local server.
const LIMIT = 6;
let cursor = 0;

async function worker(id) {
  while (cursor < manifest.files.length) {
    const i = cursor++;
    const f = manifest.files[i];
    const url = BASE + f.path;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        missing++;
        results.push({ path: f.path, status: res.status, ok: false, reason: 'http-' + res.status });
        console.log('MISS  ' + res.status + '  ' + f.path);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const sizeOk = buf.length === f.size;
      const hashOk = sha === f.sha256;
      if (sizeOk && hashOk) {
        ok++;
        results.push({ path: f.path, status: 200, ok: true, size: buf.length });
      } else {
        if (!sizeOk) sizeMismatch++;
        if (!hashOk && sizeOk) hashMismatch++;
        results.push({
          path: f.path, status: 200, ok: false,
          reason: !sizeOk ? 'size' : 'hash',
          expectedSize: f.size, actualSize: buf.length,
          expectedSha: f.sha256, actualSha: sha,
        });
        console.log('BAD   ' + (!sizeOk ? 'size ' + f.size + '->' + buf.length : 'hash') + '  ' + f.path);
      }
    } catch (err) {
      errored++;
      results.push({ path: f.path, ok: false, reason: 'error', error: String(err && err.message || err) });
      console.log('ERR   ' + f.path + '  ' + (err && err.message));
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: LIMIT }, (_, i) => worker(i)));
const ms = Date.now() - t0;

const summary = {
  base: BASE,
  checkedAt: new Date().toISOString(),
  durationMs: ms,
  total: manifest.files.length,
  byteIdentical: ok,
  sizeMismatch, hashMismatch, missing, errored,
  pass: ok === manifest.files.length,
  manifestAggregate: manifest.aggregateSha256,
};

console.log('');
console.log('byte-identical ' + ok + '/' + manifest.files.length +
  '  missing=' + missing + ' size=' + sizeMismatch + ' hash=' + hashMismatch + ' err=' + errored +
  '  in ' + (ms / 1000).toFixed(1) + 's');
console.log(summary.pass ? 'RESULT PASS' : 'RESULT FAIL');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
process.exit(summary.pass ? 0 : 1);
