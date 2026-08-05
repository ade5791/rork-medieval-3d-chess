// Hash EVERY file in the gated dist. This manifest is the contract: whatever
// GitHub Pages serves must match these bytes exactly, or the deploy is not the
// thing that passed the gate.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.argv[2] || "dist";
const OUT = process.argv[3] || "tools/out/s6x-manifest.json";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(ROOT)
  .map((f) => {
    const buf = readFileSync(f);
    return {
      path: relative(ROOT, f).split(sep).join("/"),
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

// A single hash over the whole tree, so the build is one comparable identity.
const tree = createHash("sha256");
for (const f of files) tree.update(f.path + "\0" + f.sha256 + "\n");

const manifest = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  fileCount: files.length,
  totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  treeSha256: tree.digest("hex"),
  files,
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify(
    { fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, treeSha256: manifest.treeSha256, out: OUT },
    null,
    2
  )
);
