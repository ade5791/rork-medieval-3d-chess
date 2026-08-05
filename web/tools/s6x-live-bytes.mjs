// Verify the LIVE site serves the gated bytes. A 200 is not proof of a correct
// deploy - only a hash match is. Every payload file is downloaded and hashed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LIVE_BASE || "https://ade5791.github.io/kings-gambit-medieval-chess";
const manifest = JSON.parse(readFileSync(process.argv[2] || "tools/out/s6x-manifest.json", "utf8"));

const results = [];
let ok = 0;
let bad = 0;

async function check(f) {
  const url = `${BASE}/${f.path}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        if (attempt === 2) {
          bad += 1;
          results.push({ path: f.path, status: r.status, ok: false, reason: "http" });
        }
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const sha = createHash("sha256").update(buf).digest("hex");
      const match = sha === f.sha256 && buf.length === f.bytes;
      if (match) ok += 1;
      else {
        bad += 1;
        results.push({
          path: f.path,
          ok: false,
          reason: "hash",
          expectedBytes: f.bytes,
          gotBytes: buf.length,
          expected: f.sha256.slice(0, 16),
          got: sha.slice(0, 16),
        });
      }
      return;
    } catch (e) {
      if (attempt === 2) {
        bad += 1;
        results.push({ path: f.path, ok: false, reason: "err " + e.message });
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

// Small concurrency - 90 GLBs at ~2MB each, be polite to the CDN.
const queue = [...manifest.files];
const workers = Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    if (f) await check(f);
  }
});
await Promise.all(workers);

const report = {
  base: BASE,
  checkedAt: new Date().toISOString(),
  totalFiles: manifest.files.length,
  byteIdentical: ok,
  failures: bad,
  failureDetail: results.slice(0, 20),
  ok: bad === 0 && ok === manifest.files.length,
};
writeFileSync("tools/out/s6x-live-bytes.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
