/**
 * S6 byte manifest.
 *
 * Hashes EVERY file in a directory tree (sha256 + exact byte length) into a
 * sorted JSON manifest. This is the artifact the whole publish gate hangs on:
 * the same tool runs against the staged dist, against the git checkout after
 * commit, and against what the live URL actually serves. Any divergence between
 * those three is a byte-mangling bug (line-ending rewrite, LFS pointer, Jekyll
 * filtering, CDN transform) and must fail the gate rather than be assumed away.
 *
 * Usage: node tools/s6-manifest.mjs <rootDir> <outFile>
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";

const ROOT = process.argv[2];
const OUT = process.argv[3];
if (!ROOT || !OUT) {
  console.error("usage: node tools/s6-manifest.mjs <rootDir> <outFile>");
  process.exit(2);
}

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    // .git is repo plumbing, never publish payload.
    if (name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(ROOT, []).sort();
const entries = files.map((full) => {
  const buf = readFileSync(full);
  return {
    path: relative(ROOT, full).split(sep).join("/"),
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
});

// A single hash over the sorted per-file hashes: one number that identifies the
// whole tree, so the report can state "these exact bytes" without a 99-row diff.
const tree = createHash("sha256");
for (const e of entries) tree.update(`${e.path}:${e.sha256}\n`);

const manifest = {
  root: ROOT,
  generatedAt: new Date().toISOString(),
  fileCount: entries.length,
  totalBytes: entries.reduce((a, e) => a + e.bytes, 0),
  treeHash: tree.digest("hex"),
  files: entries,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(manifest, null, 2));
console.log(`files=${manifest.fileCount} bytes=${manifest.totalBytes} tree=${manifest.treeHash}`);
console.log(`wrote ${OUT}`);
