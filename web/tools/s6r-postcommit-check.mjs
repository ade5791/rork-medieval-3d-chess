// Prove that committing did NOT alter a single published byte. git is capable of
// rewriting line endings on checkout/commit; .gitattributes (* -text) plus
// core.autocrlf=false should prevent it, but the only proof is a re-hash of the
// working tree AFTER the commit, compared to the gated manifest.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const repo = process.argv[3];

let ok = 0;
let bad = 0;
const problems = [];

for (const f of manifest.files) {
  const p = path.join(repo, f.path);
  if (!fs.existsSync(p)) {
    bad++;
    problems.push({ path: f.path, issue: "missing in publish repo" });
    continue;
  }
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha === f.sha256 && buf.length === f.size) ok++;
  else {
    bad++;
    problems.push({
      path: f.path,
      issue: "bytes differ after commit",
      expectedSize: f.size,
      actualSize: buf.length,
    });
  }
}

// Also confirm nothing extra crept into the payload.
// .gitattributes is the byte-fidelity guard itself: it is intentionally
// committed and is NOT part of the served payload, so it is not an intruder.
const PRESERVE = new Set([".git", ".gitattributes", "commitmsg.txt", "README.md"]);
function walk(root, base = "") {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!base && PRESERVE.has(e.name)) continue;
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(root, e.name), rel));
    else out.push(rel);
  }
  return out;
}
const actual = walk(repo);
const expected = new Set(manifest.files.map((f) => f.path));
const extra = actual.filter((r) => !expected.has(r));

const report = {
  repo,
  manifest: process.argv[2],
  checkedAt: new Date().toISOString(),
  expectedFiles: manifest.files.length,
  actualPayloadFiles: actual.length,
  identical: ok,
  differing: bad,
  extraFiles: extra,
  problems: problems.slice(0, 20),
  pass: bad === 0 && extra.length === 0,
};
fs.writeFileSync("tools/out/s6r-postcommit.json", JSON.stringify(report, null, 2));
console.log("expected=" + manifest.files.length + " identical=" + ok + " differing=" + bad);
console.log("extraFiles=" + extra.length + (extra.length ? " -> " + extra.slice(0, 5).join(", ") : ""));
console.log("POSTCOMMIT_PASS=" + report.pass);
process.exit(report.pass ? 0 : 1);
