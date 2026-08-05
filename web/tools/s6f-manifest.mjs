// S6-fresh: fingerprint the EXACT publish bytes.
// Emits a per-file sha256 + size manifest and an aggregate hash. The live
// verification re-fetches every file from the deployed URL and compares against
// THIS manifest, which is what makes "the deploy is correct" a measurement
// rather than an assumption.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const target = process.argv[2] || path.join(ROOT, 'web/dist');
const outFile = process.argv[3] || path.join(ROOT, 'web/tools/out/s6f-manifest.json');

const files = [];
function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { walk(p, r); continue; }
    const buf = fs.readFileSync(p);
    files.push({
      path: r,
      size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    });
  }
}
walk(target);

const agg = crypto.createHash('sha256');
for (const f of files) agg.update(f.path + ':' + f.sha256 + '\n');

const manifest = {
  generatedAt: new Date().toISOString(),
  root: path.relative(ROOT, target).replace(/\\/g, '/'),
  fileCount: files.length,
  totalBytes: files.reduce((a, f) => a + f.size, 0),
  aggregateSha256: agg.digest('hex'),
  files,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
console.log('files=' + manifest.fileCount);
console.log('totalBytes=' + manifest.totalBytes + ' (' + (manifest.totalBytes / 1048576).toFixed(1) + ' MB)');
console.log('aggregateSha256=' + manifest.aggregateSha256);
console.log('wrote ' + outFile);
