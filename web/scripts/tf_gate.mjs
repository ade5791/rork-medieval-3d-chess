// S2 gate report: base (pre-material-pass) vs post (material pass applied),
// both captured with IDENTICAL fixed instrumentation.
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
const base = new Map(load("base").map((r) => [r.id, r]));
const post = new Map(load("post").map((r) => [r.id, r]));

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const W = 92;

say("=".repeat(W));
say("S2 VISUAL QUALITY GATE - King's Gambit");
say("base = pre-material-pass, post = material pass applied");
say("both captured with identical (fixed) instrumentation");
say("=".repeat(W));

if (!base.size || !post.size) {
  say("");
  say("MISSING DATA: base=" + base.size + " shots, post=" + post.size + " shots");
}

// -------------------------------------------------------- 1. photometric bar
say("");
say("[1] PHOTOMETRIC BAR - lit opaque surfaces only (FX/additive excluded)");
say("");
say("shot".padEnd(20) + "surfaces".padEnd(11) + "albedo<0.02".padEnd(14) + "nonBinaryMetal".padEnd(17) + "normalMap".padEnd(13) + "roughMap");
say("-".repeat(W));
let bViol = 0;
let pViol = 0;
for (const id of post.keys()) {
  const p = post.get(id);
  const b = base.get(id);
  if (!p?.ok || !p.materialSummary) { say(id.padEnd(20) + "no data"); continue; }
  const pm = p.materialSummary;
  const bm = b?.materialSummary;
  if (bm) { bViol += bm.albedoBelow002 + bm.nonBinaryMetal; pViol += pm.albedoBelow002 + pm.nonBinaryMetal; }
  const f = (x, y) => (x === undefined ? String(y) : `${x} -> ${y}`);
  say(
    id.padEnd(20)
    + String(pm.surfaces).padEnd(11)
    + f(bm?.albedoBelow002, pm.albedoBelow002).padEnd(14)
    + f(bm?.nonBinaryMetal, pm.nonBinaryMetal).padEnd(17)
    + f(bm?.withNormalMap, pm.withNormalMap).padEnd(13)
    + f(bm?.withRoughnessMap, pm.withRoughnessMap),
  );
}
say("-".repeat(W));
say(`Photometric violations (albedo floor + non-binary metals), summed: ${bViol} -> ${pViol}`);
const first = [...post.values()].find((r) => r.ok && r.materialSummary);
const firstB = first ? base.get(first.id)?.materialSummary : null;
if (first && firstB) {
  const pm = first.materialSummary;
  say(`Albedo range: ${Number(firstB.albedoMin).toFixed(4)}-${Number(firstB.albedoMax).toFixed(4)} -> ${Number(pm.albedoMin).toFixed(4)}-${Number(pm.albedoMax).toFixed(4)} (bar 0.02-0.9)`);
  say(`Roughness median: ${firstB.roughMedian} -> ${pm.roughMedian}`);
}

// ------------------------------------------------------------ 2. no-post gate
say("");
say("[2] NO-POST BASELINE GATE - the scene must read with postfx disabled");
say("");
for (const id of ["dusk-high-nopost", "jungle-high-nopost"]) {
  const p = post.get(id);
  if (!p) { say(`  ${id}: MISSING`); continue; }
  const h = p.histogram || {};
  const litOk = typeof h.mean === "number" && h.mean > 0.02;
  const notCrushed = typeof h.blackPct === "number" && h.blackPct < 60;
  const notBlown = typeof h.whitePct === "number" && h.whitePct < 5;
  const pass = p.ok && p.postEnabled === false && litOk && notCrushed && notBlown;
  say(`  ${id}: post=${p.postEnabled} exposure=${p.exposure}`);
  say(`    luminance mean=${Number(h.mean ?? 0).toFixed(4)} p05=${Number(h.p05 ?? 0).toFixed(4)} p50=${Number(h.p50 ?? 0).toFixed(4)} p95=${Number(h.p95 ?? 0).toFixed(4)}`);
  say(`    clipped black=${h.blackPct ?? "?"}%  blown white=${h.whitePct ?? "?"}%`);
  say(`    -> ${pass ? "PASS" : "REVIEW"} (reads=${litOk}, not crushed=${notCrushed}, not blown=${notBlown})`);
}

// ------------------------------------------------------------- 3. frame times
say("");
say("[3] FRAME TIME - SwiftShader CPU raster, NOT GPU representative.");
say("    Valid as a relative base-vs-post comparison only.");
say("");
say("shot".padEnd(20) + "p50 base/post".padEnd(22) + "p95 base/post".padEnd(22) + "p99 base/post".padEnd(22) + "p99 d");
say("-".repeat(W));
let worst = -Infinity;
let worstId = "";
for (const id of post.keys()) {
  const p = post.get(id);
  const b = base.get(id);
  if (!p?.frame || !b?.frame) { say(id.padEnd(20) + "no frame data"); continue; }
  const d = ((p.frame.p99 - b.frame.p99) / b.frame.p99) * 100;
  if (d > worst) { worst = d; worstId = id; }
  const c = (x, y) => `${x.toFixed(1)} / ${y.toFixed(1)}`;
  say(
    id.padEnd(20)
    + c(b.frame.p50, p.frame.p50).padEnd(22)
    + c(b.frame.p95, p.frame.p95).padEnd(22)
    + c(b.frame.p99, p.frame.p99).padEnd(22)
    + `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`,
  );
}
say("-".repeat(W));
if (worst > -Infinity) {
  say(`Worst p99 regression: ${worstId} ${worst >= 0 ? "+" : ""}${worst.toFixed(1)}%  (budget +10%) -> ${worst <= 10 ? "PASS" : "FAIL"}`);
}

// --------------------------------------------------------------- 4. pixel diff
say("");
say("[4] PER-PIXEL DIFF - every visual change attributed to a shot");
say("");
say("shot".padEnd(22) + "changed px".padEnd(13) + "% frame".padEnd(10) + "mean d".padEnd(9) + "max d");
say("-".repeat(W));
for (const id of post.keys()) {
  const bp = path.join(capRoot, "base", id + ".png");
  const pp = path.join(capRoot, "post", id + ".png");
  if (!fs.existsSync(bp) || !fs.existsSync(pp)) { say(id.padEnd(22) + "missing image"); continue; }
  const b = PNG.sync.read(fs.readFileSync(bp));
  const a = PNG.sync.read(fs.readFileSync(pp));
  if (b.width !== a.width || b.height !== a.height) { say(id.padEnd(22) + "size mismatch"); continue; }
  const out = new PNG({ width: a.width, height: a.height });
  let changed = 0; let sum = 0; let max = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const d = (Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2])) / 3;
    if (d > 2) changed += 1;
    sum += d;
    if (d > max) max = d;
    const heat = Math.min(255, d * 4);
    out.data[o] = heat;
    out.data[o + 1] = Math.max(0, 60 - d);
    out.data[o + 2] = Math.max(0, 60 - d);
    out.data[o + 3] = 255;
  }
  fs.writeFileSync(path.join(diffDir, id + ".png"), PNG.sync.write(out));
  say(id.padEnd(22) + String(changed).padEnd(13) + ((changed / n) * 100).toFixed(1).padEnd(10) + (sum / n).toFixed(2).padEnd(9) + max.toFixed(0));
}

// ------------------------------------------------------------------ 5. errors
say("");
say("[5] CONSOLE HEALTH");
say("");
for (const id of post.keys()) {
  const p = post.get(id);
  const errs = (p?.errors || []).filter((e) => !/favicon|404/i.test(e));
  say(`  ${id}: ok=${p?.ok} errors=${errs.length}${errs.length ? " :: " + errs[0].slice(0, 110) : ""}`);
}

say("");
say("Diff heatmaps: web/reports/captures/diff/");
say("Shots:         web/reports/captures/{base,post}/");
fs.writeFileSync(path.join(root, "reports", "s2-gate.txt"), lines.join("\n"));
console.log("\nWROTE reports/s2-gate.txt");
