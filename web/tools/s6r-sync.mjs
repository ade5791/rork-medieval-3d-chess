// Sync the gated dist into the publish repo WITHOUT touching git metadata or
// the byte-fidelity guard. A prior run used robocopy /MIR, which deleted
// .gitattributes (it is not in dist) and silently removed the very guard that
// keeps the published bytes identical. This mirrors payload files only and
// explicitly preserves .git/ and .gitattributes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SRC = process.argv[2];
const DST = process.argv[3];
const PRESERVE = new Set([".git", ".gitattributes", "README.md"]);

if (!SRC || !DST) {
  console.error("usage: node s6r-sync.mjs <srcDist> <dstRepo>");
  process.exit(1);
}

function walk(root, base = "") {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = base ? base + "/" + e.name : e.name;
    if (!base && PRESERVE.has(e.name)) continue;
    const abs = path.join(root, e.name);
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}

const srcFiles = new Set(walk(SRC));
const dstFiles = new Set(walk(DST));

let copied = 0;
let unchanged = 0;
for (const rel of srcFiles) {
  const s = path.join(SRC, rel);
  const d = path.join(DST, rel);
  const sBuf = fs.readFileSync(s);
  if (fs.existsSync(d)) {
    const dBuf = fs.readFileSync(d);
    if (dBuf.length === sBuf.length && dBuf.equals(sBuf)) {
      unchanged++;
      continue;
    }
  }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.writeFileSync(d, sBuf); // raw bytes, no encoding pass
  copied++;
}

let removed = 0;
for (const rel of dstFiles) {
  if (!srcFiles.has(rel)) {
    fs.rmSync(path.join(DST, rel), { force: true });
    removed++;
    console.log("removed stale: " + rel);
  }
}

// Guard: the byte-fidelity files must still exist after the sync.
const guards = [".gitattributes", ".nojekyll"];
const guardState = {};
for (const g of guards) {
  const p = path.join(DST, g);
  guardState[g] = fs.existsSync(p);
  if (!guardState[g]) console.log("MISSING GUARD: " + g);
}

// Re-hash the destination payload and compare to the source tree hash.
function hashTree(root) {
  const rows = walk(root)
    .sort()
    .map((rel) => ({
      rel,
      sha: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex"),
    }));
  return {
    count: rows.length,
    tree: crypto
      .createHash("sha256")
      .update(rows.map((r) => r.sha + "  " + r.rel).join("\n"))
      .digest("hex"),
  };
}

const a = hashTree(SRC);
const b = hashTree(DST);
console.log("copied=" + copied + " unchanged=" + unchanged + " removed=" + removed);
console.log("srcFiles=" + a.count + " dstFiles=" + b.count);
console.log("srcTree=" + a.tree);
console.log("dstTree=" + b.tree);
console.log("guards=" + JSON.stringify(guardState));
const ok = a.tree === b.tree && guards.every((g) => guardState[g]);
console.log("SYNC_IDENTICAL=" + ok);
process.exit(ok ? 0 : 1);
