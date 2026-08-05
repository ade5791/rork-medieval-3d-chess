// S6 (fresh run): fetch EVERY file in the manifest over HTTP and prove the served
// bytes hash-match the gated dist. A 200 is not proof of a correct deploy - the
// FPS mission shipped a build missing its models/ directory that way.
import fs from "node:fs";
import crypto from "node:crypto";

const manifestPath = process.argv[2];
const base = (process.argv[3] || "").replace(/\/$/, "");
const out = process.argv[4] || "tools/out/s6r-http-verify.json";
const concurrency = Number(process.env.S6_CONC || 6);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = manifest.files;

const results = [];
let idx = 0;
let ok = 0;
let bad = 0;

async function fetchOne(f) {
  const url = base + "/" + f.path;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow" });
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const identical = res.status === 200 && sha === f.sha256 && buf.length === f.size;
    if (identical) ok++;
    else bad++;
    return {
      path: f.path,
      status: res.status,
      expectedSize: f.size,
      servedSize: buf.length,
      expectedSha: f.sha256,
      servedSha: sha,
      identical,
      ms: Date.now() - started,
      contentType: res.headers.get("content-type") || null,
    };
  } catch (err) {
    bad++;
    return { path: f.path, status: 0, error: String(err), identical: false };
  }
}

async function worker() {
  while (idx < files.length) {
    const f = files[idx++];
    const r = await fetchOne(f);
    results.push(r);
    if (!r.identical) console.log("MISMATCH " + r.path + " status=" + r.status);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

results.sort((a, b) => a.path.localeCompare(b.path));
const report = {
  base,
  manifest: manifestPath,
  checkedAt: new Date().toISOString(),
  fileCount: files.length,
  identical: ok,
  mismatched: bad,
  pass: bad === 0 && ok === files.length,
  results,
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log("checked=" + files.length + " identical=" + ok + " mismatched=" + bad);
console.log("PASS=" + report.pass);
process.exit(report.pass ? 0 : 1);
