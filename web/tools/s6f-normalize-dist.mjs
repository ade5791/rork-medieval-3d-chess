// S6-fresh: post-build byte normalisation of dist text assets.
//
// WHY THIS EXISTS (measured, not speculative):
//   web/index.html is CRLF on disk. Vite's HTML transform removes the dev-only
//   `<script type="module" src="/src/main.tsx">` line using a LF-oriented match,
//   which deletes "...</script>\n" but leaves the preceding "\r" behind. The
//   emitted dist/index.html therefore contains a lone CR ("\r\r\n" collapsed to
//   an orphan CR before </body>). It is browser-harmless but it is a genuine
//   byte defect, and the whole point of this step is that the bytes we hash are
//   the bytes we ship. So it is normalised deterministically, BEFORE hashing.
//
// Scope: text assets only (.html/.css/.js/.txt/.svg/.json). Binary assets
// (.glb/.png) are never touched.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const DIST = path.join(ROOT, 'web/dist');
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.txt', '.svg', '.json', '.map']);

let changed = 0;
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!TEXT.has(ext)) continue;
    scanned++;
    const before = fs.readFileSync(p);
    const txt = before.toString('utf8');
    // Collapse runs of CR before LF to a single CR, then convert any remaining
    // lone CR into a proper CRLF. Result: no orphan CR anywhere.
    let out = txt.replace(/\r+(?=\n)/g, '\r').replace(/\r(?!\n)/g, '\r\n');
    if (out !== txt) {
      fs.writeFileSync(p, out, 'utf8');
      changed++;
      console.log('normalised ' + path.relative(DIST, p) +
        '  ' + before.length + ' -> ' + Buffer.byteLength(out) + ' bytes');
    }
  }
}

walk(DIST);
console.log('scanned=' + scanned + ' changed=' + changed);

// Verify: zero orphan CR remains anywhere in dist text.
let stray = 0;
function verify(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { verify(p); continue; }
    if (!TEXT.has(path.extname(e.name).toLowerCase())) continue;
    const t = fs.readFileSync(p, 'utf8');
    stray += (t.match(/\r(?!\n)/g) || []).length;
  }
}
verify(DIST);
console.log('remaining orphan CR across dist text = ' + stray);
process.exit(stray === 0 ? 0 : 1);
