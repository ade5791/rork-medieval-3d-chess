// Live byte-identity gate.
//
// The FPS mission shipped a build whose models/ directory was missing and the
// index still returned 200. So this does NOT check status codes: it downloads
// every file in the gated manifest from the live origin and compares sha256 and
// byte length against the bytes that passed the local QA gate. Anything that is
// missing, truncated, re-encoded, or served as an HTML 404 page fails loudly.
import fs from "node:fs";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const base = process.argv[3].replace(/\/$/, "");
const outPath = process.argv[4];

const CONCURRENCY = 8;
const results = [];
let identical = 0;
let failed = 0;
let bytesChecked = 0;

async function check(f) {
  const url = base + "/" + f.path.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      failed++;
      return { path: f.path, ok: false, issue: "http " + res.status };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const ok = sha === f.sha256 && buf.length === f.size;
    if (ok) {
      identical++;
      bytesChecked += buf.length;
      return { path: f.path, ok: true, size: buf.length };
    }
    failed++;
    return {
      path: f.path,
      ok: false,
      issue: "byte mismatch",
      expectedSize: f.size,
      servedSize: buf.length,
      contentType: res.headers.get("content-type"),
    };
  } catch (err) {
    failed++;
    return { path: f.path, ok: false, issue: "fetch error: " + err.message };
  }
}

const queue = manifest.files.slice();
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    const r = await check(f);
    results.push(r);
    if (!r.ok) console.log("FAIL " + r.path + " -> " + r.issue);
    if (results.length % 25 === 0) console.log("  ...checked " + results.length + "/" + manifest.files.length);
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const elapsed = Date.now() - t0;

const report = {
  base,
  manifestTreeHash: manifest.treeHash,
  checkedAt: new Date().toISOString(),
  totalFiles: manifest.files.length,
  identical,
  failed,
  bytesVerified: bytesChecked,
  elapsedMs: elapsed,
  failures: results.filter((r) => !r.ok),
  pass: failed === 0 && identical === manifest.files.length,
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log("");
console.log("files=" + manifest.files.length + " identical=" + identical + " failed=" + failed);
console.log("bytesVerified=" + bytesChecked + " elapsedMs=" + elapsed);
console.log("LIVE_BYTES_PASS=" + report.pass);
process.exit(report.pass ? 0 : 1);
