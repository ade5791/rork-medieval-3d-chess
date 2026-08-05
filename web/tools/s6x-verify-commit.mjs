// Verify the COMMITTED bytes (read out of git, not off disk) match the gated
// manifest. Reading from git object storage is the point: it proves nothing was
// rewritten between the gate and what will be pushed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = process.argv[2];
const MANIFEST = process.argv[3];
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], { maxBuffer: 1 << 30 });
}

const head = git(["rev-parse", "HEAD"]).toString().trim();
const listed = git(["ls-tree", "-r", "--name-only", "HEAD"]).toString().trim().split(/\r?\n/);

const mismatches = [];
let checked = 0;
for (const f of manifest.files) {
  if (!listed.includes(f.path)) {
    mismatches.push({ path: f.path, reason: "not in commit" });
    continue;
  }
  const buf = git(["show", `HEAD:${f.path}`]);
  const sha = createHash("sha256").update(buf).digest("hex");
  checked += 1;
  if (sha !== f.sha256) mismatches.push({ path: f.path, expected: f.sha256, got: sha });
}

// Files in the commit that are not part of the gated payload (repo metadata).
const extra = listed.filter((p) => !manifest.files.some((f) => f.path === p));

const report = {
  head,
  gatedFiles: manifest.files.length,
  checked,
  mismatches,
  repoOnlyFiles: extra,
  ok: mismatches.length === 0 && checked === manifest.files.length,
};
writeFileSync("tools/out/s6x-commit-verify.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
