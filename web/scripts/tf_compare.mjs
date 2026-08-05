// Before/after gate.
//   1. Material compliance delta (albedo floor, binary metals, map coverage).
//   2. Frame-time regression check (p99 must not regress >10%).
//   3. Per-pixel diff so every visual change is attributable to a shot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const capRoot = path.join(root, "reports", "captures");
const diffDir = path.join(capRoot, "diff");
fs.mkdirSync(diffDir, { recursive: true });

const load = (label) => {
  const f = path.join(capRoot, label, "measurements.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
};
const before = new Map(load("before").map((r) => [r.id, r]));
const after = new Map(load("after").map((r) => [r.id, r]));

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

say("=".repeat(78));
say("S2 VISUAL QUALITY GATE - before vs after");
say("=".repeat(78));

// ---------------------------------------------------------------- materials
say("");
say("[1] MATERIAL COMPLIANCE (measured from the live scene graph)");
say("");
const hdr = "shot".padEnd(20) + "albedo<0.02".padEnd(14) + "nonBinaryMetal".padEnd(17) + "normalMap".padEnd(12) + "roughMap";
say(hdr);
say("-".repeat(78));
const fmt = (b, a) => (b === undefined ? "-" : `${b} -> ${a}`);
let totalViolBefore = 0;
let totalViolAfter = 0;
for (const id of after.keys()) {
  const a = after.get(id);
  const b = before.get(id);
  if (!a?.ok || !a.materialSummary) continue;
  const am = a.materialSummary;
  const bm = b?.materialSummary;
  if (bm) {
    totalViolBefore += bm.albedoBelow002 + bm.nonBinaryMetal;
    totalViolAfter += am.albedoBelow002 + am.nonBinaryMetal;
  }
  say(
    id.padEnd(20)
    + fmt(bm?.albedoBelow002, am.albedoBelow002).padEnd(14)
    + fmt(bm?.nonBinaryMetal, am.nonBinaryMetal).padEnd(17)
    + fmt(bm?.withNormalMap, am.withNormalMap).padEnd(12)
    + fmt(bm?.withRoughnessMap, am.withRoughnessMap),
  );
}
say("-".repeat(78));
say(`TOTAL photometric violations across shots: ${totalViolBefore} -> ${totalViolAfter}`);

// ------------------------------------------------------------- no-post gate
say("");
say("[2] NO-POST BASELINE GATE (scene must read with postfx disabled)");
say("");
for (const id of ["dusk-high-nopost", "jungle-high-nopost"]) {
  const a = after.get(id);
  if (!a) { say(`  ${id}: MISSING`); continue; }
  const h = a.histogram || {};
  const ok = a.ok && a.postEnabled === false;
  say(`  ${id}: ok=${a.ok} postEnabled=${a.postEnabled} -> ${ok ? "PASS" : "FAIL"}`);
  if (h.mean !== undefined) {
    say(`    luminance mean=${Number(h.mean).toFixed(4)} p05=${Number(h.p05 ?? 0).toFixed(4)} p50=${Number(h.p50 ?? 0).toFixed(4)} p95=${Number(h.p95 ?? 0).toFixed(4)}`);
    say(`    clipped black=${h.blackPct ?? "?"}% clipped white=${h.whitePct ?? "?"}%`);
  }
}

// --------------------------------------------------------------- frame time
say("");
say("[3] FRAME TIME (SwiftShader CPU raster - relative comparison only)");
say("");
say("shot".padEnd(20) + "p50 before/after".padEnd(24) + "p99 before/after".padEnd(24) + "p99 delta");
say("-".repeat(78));
let worstRegression = -Infinity;
let worstShot = "";
for (const id of after.keys()) {
  const a = after.get(id);
  const b = before.get(id);
  if (!a?.frame || !b?.frame) {
    say(id.padEnd(20) + (a?.frame ? `p99=${a.frame.p99.toFixed(1)}ms (no baseline)` : "no data"));
    continue;
  }
  const d = ((a.frame.p99 - b.frame.p99) / b.frame.p99) * 100;
  if (d > worstRegression) { worstRegression = d; worstShot = id; }
  say(
    id.padEnd(20)
    + `${b.frame.p50.toFixed(1)} / ${a.frame.p50.toFixed(1)} ms`.padEnd(24)
    + `${b.frame.p99.toFixed(1)} / ${a.frame.p99.toFixed(1)} ms`.padEnd(24)
    + `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`,
  );
}
say("-".repeat(78));
if (worstRegression > -Infinity) {
  say(`Worst p99 regression: ${worstShot} ${worstRegression >= 0 ? "+" : ""}${worstRegression.toFixed(1)}% (budget +10%) -> ${worstRegression <= 10 ? "PASS" : "FAIL"}`);
}

// --------------------------------------------------------------- pixel diff
say("");
say("[4] PER-PIXEL DIFF (attributes every visual change to a shot)");
say("");
say("shot".padEnd(22) + "changed px".padEnd(14) + "% frame".padEnd(11) + "mean dE".padEnd(10) + "max dE");
say("-".repeat(78));
for (const id of after.keys()) {
  const bp = path.join(capRoot, "before", id + ".png");
  const ap = path.join(capRoot, "after", id + ".png");
  if (!fs.existsSync(bp) || !fs.existsSync(ap)) {
    say(id.padEnd(22) + "no baseline image");
    continue;
  }
  const b = PNG.sync.read(fs.readFileSync(bp));
  const a = PNG.sync.read(fs.readFileSync(ap));
  if (b.width !== a.width || b.height !== a.height) {
    say(id.padEnd(22) + `size mismatch ${b.width}x${b.height} vs ${a.width}x${a.height}`);
    continue;
  }
  const out = new PNG({ width: a.width, height: a.height });
  let changed = 0;
  let sum = 0;
  let max = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const d = (dr + dg + db) / 3;
    if (d > 2) changed += 1;
    sum += d;
    if (d > max) max = d;
    // Heat visualisation: red where it changed, dim grey where it did not.
    const heat = Math.min(255, d * 4);
    out.data[o] = heat;
    out.data[o + 1] = Math.max(0, 60 - d);
    out.data[o + 2] = Math.max(0, 60 - d);
    out.data[o + 3] = 255;
  }
  fs.writeFileSync(path.join(diffDir, id + ".png"), PNG.sync.write(out));
  say(
    id.padEnd(22)
    + String(changed).padEnd(14)
    + ((changed / n) * 100).toFixed(1).padEnd(11)
    + (sum / n).toFixed(2).padEnd(10)
    + max.toFixed(0),
  );
}

say("");
say("Diff heatmaps: reports/captures/diff/");
fs.writeFileSync(path.join(root, "reports", "s2-gate.txt"), lines.join("\n"));
