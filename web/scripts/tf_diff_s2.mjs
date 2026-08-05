// Per-pixel diff gate: baseline (S1 "base") vs the S2 visual pass.
//
// Purpose is attribution, not pass/fail-on-any-change: this step INTENDS to
// change pixels. The gate proves (a) which shots moved, (b) by how much, and
// (c) that shots I did not touch stayed put. Writes a heat-map per pair.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const capRoot = path.join(root, "reports", "captures");
const A = process.argv[2] || "base";
const B = process.argv[3] || "s2-after";
const outDir = path.join(capRoot, `diff-${A}-vs-${B}`);
fs.mkdirSync(outDir, { recursive: true });

const list = (d) =>
  fs.existsSync(path.join(capRoot, d))
    ? fs.readdirSync(path.join(capRoot, d)).filter((f) => f.endsWith(".png"))
    : [];

const shared = list(A).filter((f) => list(B).includes(f));
const rows = [];

for (const name of shared) {
  const pa = PNG.sync.read(fs.readFileSync(path.join(capRoot, A, name)));
  const pb = PNG.sync.read(fs.readFileSync(path.join(capRoot, B, name)));
  if (pa.width !== pb.width || pa.height !== pb.height) {
    rows.push({ shot: name, error: `size ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}` });
    continue;
  }
  const total = pa.width * pa.height;
  const heat = new PNG({ width: pa.width, height: pa.height });
  let changed = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  let sumLumA = 0;
  let sumLumB = 0;

  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    const dr = Math.abs(pa.data[o] - pb.data[o]);
    const dg = Math.abs(pa.data[o + 1] - pb.data[o + 1]);
    const db = Math.abs(pa.data[o + 2] - pb.data[o + 2]);
    const d = Math.max(dr, dg, db);
    sumLumA += 0.2126 * pa.data[o] + 0.7152 * pa.data[o + 1] + 0.0722 * pa.data[o + 2];
    sumLumB += 0.2126 * pb.data[o] + 0.7152 * pb.data[o + 1] + 0.0722 * pb.data[o + 2];
    // Threshold of 2 ignores dither/rounding noise from the CPU rasterizer.
    if (d > 2) {
      changed += 1;
      sumDelta += d;
      if (d > maxDelta) maxDelta = d;
    }
    const heatVal = Math.min(255, d * 4);
    heat.data[o] = heatVal;
    heat.data[o + 1] = heatVal > 40 ? Math.min(255, heatVal * 0.4) : 0;
    heat.data[o + 2] = 0;
    heat.data[o + 3] = 255;
  }

  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(heat));
  rows.push({
    shot: name,
    changedPct: Number(((changed / total) * 100).toFixed(2)),
    meanDelta: changed ? Number((sumDelta / changed).toFixed(1)) : 0,
    maxDelta,
    meanLumBefore: Number((sumLumA / total).toFixed(2)),
    meanLumAfter: Number((sumLumB / total).toFixed(2)),
  });
}

console.log(`compared ${rows.length} shot(s): ${A} -> ${B}\n`);
for (const r of rows) {
  if (r.error) { console.log(`${r.shot.padEnd(26)} ERROR ${r.error}`); continue; }
  console.log(
    `${r.shot.padEnd(26)} changed=${String(r.changedPct).padStart(6)}%  meanD=${String(r.meanDelta).padStart(5)}  maxD=${String(r.maxDelta).padStart(3)}  lum ${r.meanLumBefore} -> ${r.meanLumAfter}`,
  );
}
fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify(rows, null, 2));
console.log(`\nheat maps: ${outDir}`);
