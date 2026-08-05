// Diagnose the 4 late shader compiles the publish gate caught. Late compiles are
// the single largest cause of multi-second stalls, so the fix has to target the
// ACTUAL missing permutation - not a guess. This dumps the cacheKeys before and
// after the play window and diffs them field-by-field, because two keys that
// differ in exactly one field point at a specific renderer state change
// (a shadow bit, a light count, a fog flag) rather than at "some new material".
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const BASE = 'http://127.0.0.1:8123/kings-gambit-medieval-chess/';
const OUT = path.join(ROOT, 'web/tools/out/s6f-shaderdiag.json');

// Own the server, same reason as the gate: a detached helper gets reaped
// between tool windows and the run dies on ERR_CONNECTION_REFUSED.
let serverProc = null;
{
  const { spawn } = await import('node:child_process');
  const probe = async () => {
    try { const r = await fetch(BASE, { method: 'HEAD' }); return r.ok || r.status === 200; }
    catch { return false; }
  };
  if (!(await probe())) {
    serverProc = spawn(process.execPath, [path.join(ROOT, 'web/tools/s6f-serve.mjs')], {
      cwd: path.join(ROOT, 'web'), stdio: 'ignore', detached: false,
    });
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await probe()) break;
    }
  }
}

const browser = await chromium.launch({
  headless: false,
  args: ['--use-angle=default', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(BASE + '?probe=1&review=1&quality=high&era=rome', {
  waitUntil: 'domcontentloaded', timeout: 120000,
});
await page.waitForFunction(() => !!window.__kg, null, { timeout: 180000 });
await page.waitForFunction(() => window.__kg.ready() && window.__kg.census().pieces >= 32,
  null, { timeout: 240000 });
await page.bringToFront();

// Settle: wait until the program count stops moving on its own.
await page.waitForFunction(() => {
  const n = window.__kg.programs().count;
  const prev = window.__kgPrev;
  window.__kgPrev = n;
  return prev !== undefined && n === prev;
}, null, { timeout: 60000, polling: 2000 });

const before = await page.evaluate(() => window.__kg.programs());
const lightsBefore = await page.evaluate(() => window.__kg.lights());

// Reproduce exactly what the gate did: showcase orbit + released camera.
await page.evaluate(async () => {
  window.__kg.showcase(true, 0.32);
  window.__kg.releaseCamera();
  await new Promise(r => setTimeout(r, 3000));
});
const mid = await page.evaluate(() => window.__kg.programs());
await page.evaluate(() => new Promise(r => setTimeout(r, 10000)));

const after = await page.evaluate(() => window.__kg.programs());
const lightsAfter = await page.evaluate(() => window.__kg.lights());

const added = after.keys.filter(k => !before.keys.includes(k));
const removed = before.keys.filter(k => !after.keys.includes(k));

// Field-level diff: for each new key, find the closest existing key and report
// exactly which fields differ. One differing field = a state change, not a new
// material.
function closest(key, pool) {
  const f = key.split(',');
  let best = null, bestDiff = Infinity, bestFields = [];
  for (const cand of pool) {
    const g = cand.split(',');
    if (g.length !== f.length) continue;
    const diffIdx = [];
    for (let i = 0; i < f.length; i++) if (f[i] !== g[i]) diffIdx.push(i);
    if (diffIdx.length < bestDiff) {
      bestDiff = diffIdx.length; best = cand;
      bestFields = diffIdx.map(i => ({ index: i, before: g[i], after: f[i] }));
    }
  }
  return { nearest: best, differingFieldCount: bestDiff, fields: bestFields };
}

const analysis = added.map(k => ({
  key: k.slice(0, 160),
  ...closest(k, before.keys),
}));

console.log('programsBefore=' + before.count + ' mid=' + mid.count + ' after=' + after.count);
console.log('added=' + added.length + ' removed=' + removed.length);
console.log('compiledDuringOrbitWarmup=' + (mid.count - before.count));
console.log('compiledDuringMeasureWindow=' + (after.count - mid.count));
console.log('lights before=' + JSON.stringify(lightsBefore).slice(0, 400));
console.log('lights after =' + JSON.stringify(lightsAfter).slice(0, 400));
for (const a of analysis) {
  console.log('\n--- new program (differs from nearest in ' + a.differingFieldCount + ' field(s))');
  console.log('    fields=' + JSON.stringify(a.fields).slice(0, 500));
  console.log('    key=' + a.key);
}

fs.writeFileSync(OUT, JSON.stringify({
  before: before.count, mid: mid.count, after: after.count,
  compiledDuringOrbitWarmup: mid.count - before.count,
  compiledDuringMeasureWindow: after.count - mid.count,
  added, removed, analysis, lightsBefore, lightsAfter,
}, null, 2));

await browser.close();
if (serverProc) serverProc.kill();
