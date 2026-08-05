// S4: attribute the CPU cost. The scene is CPU-bound (1/16 pixels changed
// nothing), so find WHICH JS is eating the frame using the CDP profiler.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "high";
const url = `${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&seed=s4-cpu`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });

await page.evaluate(() => {
  window.__kg.showcase(true, 0.55);
  window.__kg.releaseCamera();
  window.__kg.setCamera("cinematic");
});
await page.waitForTimeout(5000);

const client = await ctx.newCDPSession(page);
await client.send("Profiler.enable");
await client.send("Profiler.setSamplingInterval", { interval: 200 });
await client.send("Profiler.start");

await page.evaluate(() => window.__kg.resetFrameTimes());
for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__kg.releaseCamera());
}
const perf = await page.evaluate(() => window.__kg.perf());
const { profile } = await client.send("Profiler.stop");

// Aggregate self time per function.
const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
const selfHits = new Map();
for (const id of profile.samples ?? []) selfHits.set(id, (selfHits.get(id) ?? 0) + 1);

const total = (profile.samples ?? []).length || 1;
const rows = [];
for (const [id, hits] of selfHits) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const name = cf.functionName || "(anonymous)";
  const file = (cf.url || "").split("/").pop() || "";
  rows.push({
    name,
    file,
    line: cf.lineNumber,
    hits,
    pct: (hits / total) * 100,
  });
}
rows.sort((a, b) => b.hits - a.hits);

console.log(`=== CPU profile, preset ${preset} ===`);
console.log(`p50 ${perf.p50.toFixed(2)}ms (${perf.fps50.toFixed(1)}fps)  samples ${total}`);
console.log("\n--- self time, top 30 ---");
for (const r of rows.slice(0, 30)) {
  console.log(`  ${r.pct.toFixed(2).padStart(6)}%  ${r.name.slice(0, 46).padEnd(48)} ${r.file}:${r.line}`);
}

// Group by file so subsystem cost is visible.
const byFile = new Map();
for (const r of rows) byFile.set(r.file, (byFile.get(r.file) ?? 0) + r.hits);
const fileRows = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
console.log("\n--- self time by file ---");
for (const [f, h] of fileRows.slice(0, 12)) {
  console.log(`  ${((h / total) * 100).toFixed(2).padStart(6)}%  ${f}`);
}

mkdirSync("tools/out", { recursive: true });
writeFileSync(`tools/out/s4-cpu-${preset}.json`, JSON.stringify({ perf, rows: rows.slice(0, 120) }, null, 2));
console.log(`\nwrote tools/out/s4-cpu-${preset}.json`);

await ctx.close();
await browser.close();
