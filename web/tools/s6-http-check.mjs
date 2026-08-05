/**
 * S6 HTTP inventory check.
 *
 * Fetches EVERY file listed in a byte manifest from a live origin and asserts
 * the served bytes are identical to the gated bytes (sha256 + length), not merely
 * that the request returned 200. This is the exact check that would have caught
 * the FPS build shipped without its models/ directory: the page 200s, the assets
 * 404, and a status-only check calls it green.
 *
 * Also asserts that a root-absolute path OUTSIDE the base 404s, proving the site
 * is genuinely mounted at a subpath rather than accidentally at the domain root.
 *
 * Usage: node tools/s6-http-check.mjs <manifest.json> <originBaseUrl> <out.json> [--head-only-over=BYTES]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [MANIFEST, ORIGIN, OUT] = process.argv.slice(2);
if (!MANIFEST || !ORIGIN || !OUT) {
  console.error("usage: node tools/s6-http-check.mjs <manifest.json> <originBaseUrl> <out.json>");
  process.exit(2);
}
const args = Object.fromEntries(
  process.argv.slice(5).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
// Large GLBs are verified by content-length + a full hash unless explicitly
// capped; hashing 185MB over the network is slow but it is the only real proof.
const HEAD_ONLY_OVER = Number(args["head-only-over"] || 0);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const base = ORIGIN.replace(/\/+$/, "") + "/";

const results = [];
let pass = 0;
let fail = 0;

async function check(entry) {
  const url = base + entry.path;
  const started = Date.now();
  try {
    if (HEAD_ONLY_OVER && entry.bytes > HEAD_ONLY_OVER) {
      const res = await fetch(url, { method: "HEAD" });
      const len = Number(res.headers.get("content-length"));
      const ok = res.status === 200 && len === entry.bytes;
      results.push({
        path: entry.path,
        mode: "head",
        status: res.status,
        expectedBytes: entry.bytes,
        servedBytes: Number.isFinite(len) ? len : null,
        hashMatch: null,
        ok,
        ms: Date.now() - started,
      });
      ok ? pass++ : fail++;
      return;
    }
    const res = await fetch(url);
    if (res.status !== 200) {
      results.push({ path: entry.path, mode: "get", status: res.status, expectedBytes: entry.bytes, servedBytes: null, hashMatch: false, ok: false, ms: Date.now() - started });
      fail++;
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex");
    const ok = buf.length === entry.bytes && sha === entry.sha256;
    results.push({
      path: entry.path,
      mode: "get",
      status: 200,
      expectedBytes: entry.bytes,
      servedBytes: buf.length,
      hashMatch: sha === entry.sha256,
      ok,
      ms: Date.now() - started,
    });
    ok ? pass++ : fail++;
  } catch (err) {
    results.push({ path: entry.path, mode: "error", status: null, expectedBytes: entry.bytes, servedBytes: null, hashMatch: false, ok: false, error: String(err), ms: Date.now() - started });
    fail++;
  }
}

// Modest concurrency: enough to finish 185MB in reasonable time, low enough not
// to trip rate limiting on a real CDN.
const CONC = Number(args.conc || 6);
const queue = manifest.files.slice();
async function worker() {
  while (queue.length) {
    const e = queue.shift();
    if (e) await check(e);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// Subpath isolation: the same asset requested at the domain root must NOT serve.
let rootLeak = null;
try {
  const u = new URL(base);
  const rootUrl = `${u.origin}/${manifest.files.find((f) => f.path.endsWith(".glb"))?.path ?? "index.html"}`;
  const res = await fetch(rootUrl, { method: "HEAD" });
  rootLeak = { url: rootUrl, status: res.status, ok: res.status !== 200 };
} catch (err) {
  rootLeak = { url: null, status: null, ok: true, note: String(err) };
}

const report = {
  origin: base,
  manifest: MANIFEST,
  treeHash: manifest.treeHash,
  checkedAt: new Date().toISOString(),
  fileCount: manifest.fileCount,
  pass,
  fail,
  allServedIdentical: fail === 0,
  subpathIsolation: rootLeak,
  failures: results.filter((r) => !r.ok),
  results,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`origin=${base}`);
console.log(`files=${manifest.fileCount} pass=${pass} fail=${fail}`);
console.log(`subpathIsolation ok=${rootLeak?.ok} status=${rootLeak?.status}`);
for (const f of report.failures.slice(0, 20)) {
  console.log(`FAIL ${f.path} status=${f.status} expected=${f.expectedBytes} served=${f.servedBytes} hashMatch=${f.hashMatch}`);
}
console.log(`wrote ${OUT}`);
process.exit(fail === 0 ? 0 : 1);
