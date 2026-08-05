// Stage the gated dist into a clean publish repo working tree, then re-hash it.
// Copying is the only step between "bytes that passed the gate" and "bytes git
// will commit", so it is verified rather than trusted.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = process.argv[2];
const DST = process.argv[3];
const MANIFEST = process.argv[4];

if (!SRC || !DST || !MANIFEST) {
  console.error("usage: node s6x-stage.mjs <distDir> <publishDir> <manifest.json>");
  process.exit(2);
}

// Remove only the payload we own; leave .git intact if present.
if (existsSync(DST)) {
  for (const n of readdirSync(DST)) {
    if (n === ".git") continue;
    rmSync(join(DST, n), { recursive: true, force: true });
  }
} else {
  mkdirSync(DST, { recursive: true });
}

cpSync(SRC, DST, { recursive: true });

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === ".git") continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, acc);
    else acc.push(f);
  }
  return acc;
}

const staged = new Map();
for (const f of walk(DST)) {
  const buf = readFileSync(f);
  staged.set(relative(DST, f).split(sep).join("/"), createHash("sha256").update(buf).digest("hex"));
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const mismatches = [];
for (const f of manifest.files) {
  const got = staged.get(f.path);
  if (got !== f.sha256) mismatches.push({ path: f.path, expected: f.sha256, got: got ?? "MISSING" });
}
const extra = [...staged.keys()].filter((p) => !manifest.files.some((f) => f.path === p));

const report = {
  gatedFiles: manifest.files.length,
  stagedFiles: staged.size,
  mismatches,
  extra,
  ok: mismatches.length === 0 && extra.length === 0 && staged.size === manifest.files.length,
};
writeFileSync("tools/out/s6x-stage-verify.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, mismatches: mismatches.slice(0, 5), extra: extra.slice(0, 5) }, null, 2));
process.exit(report.ok ? 0 : 1);
