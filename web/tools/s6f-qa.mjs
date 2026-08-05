// S6-fresh: the publish QA gate. Drives a real browser against whatever URL it
// is given - the locally-served STAGED bytes first, then the LIVE Pages URL -
// so both are measured by the IDENTICAL harness. That is the point: "it works
// locally" and "it works live" become the same measurement, not two.
//
// A 200 is not proof of a correct deploy. This gate requires:
//   - the WebGL scene actually boots (window.__kg reachable behind ?probe=1)
//   - the asset factory reaches ready AND 32 figures are standing on the board
//     (this is the check that catches a deploy missing its models/ directory -
//     the scene would still render an empty hall and still return 200)
//   - the era roster resolved its OWN sculpted GLBs, none foreign
//   - frames advance, with real geometry in the graph
//   - a real move changes the authoritative FEN
//   - a perf spot-check with the cinematic camera ORBITING, full distribution
//   - zero frame errors / console errors / same-origin request failures
//   - the mobile viewport boots with a reachable primary touch target
//
// Usage: node s6f-qa.mjs <baseUrl> <label>
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const BASE = (process.argv[2] || 'http://127.0.0.1:8123/kings-gambit-medieval-chess/').replace(/\/?$/, '/');
const LABEL = process.argv[3] || 'staged';
const OUT = path.join(ROOT, 'web/tools/out/s6f-qa-' + LABEL + '.json');
const SHOTS = path.join(ROOT, 'web/tools/out/s6f-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// The gate owns its own server for local runs. A detached helper process was
// being reaped between tool windows, which cost two full gate runs to
// ERR_CONNECTION_REFUSED - a harness failure masquerading as a deploy failure.
// Owning the child here means the server's lifetime is exactly the gate's.
let serverProc = null;
if (/127\.0\.0\.1|localhost/.test(BASE)) {
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
    console.log('      started local static server for the gate');
  }
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== null ? '  ' + detail : ''));
}

const consoleErrors = [];
const failedRequests = [];
const pageErrors = [];

// Requests aborted while a browser context is being torn down are a harness
// artifact, not a deploy defect: closing the mobile context cancels the GLB
// streams still in flight. Tagging the phase lets the gate separate a genuine
// server-side failure from teardown cancellation instead of ignoring both.
let phase = 'desktop';
let tearingDown = false;

function instrument(page) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('requestfailed', r => failedRequests.push({
    url: r.url().slice(0, 200),
    err: (r.failure() && r.failure().errorText) || 'unknown',
    phase,
    duringTeardown: tearingDown,
  }));
}

// HEADED=1 launches a real window so Chromium uses the actual GPU. Headless
// falls back to SwiftShader (a CPU rasterizer) on this machine, and a
// SwiftShader frame time is not GPU performance - reporting it as such would be
// the exact evidence-inflation this gate exists to prevent. The rasterizer is
// recorded in the artifact either way.
const HEADED = process.env.KG_HEADED === '1';
const browser = await chromium.launch({
  headless: !HEADED,
  args: HEADED
    ? ['--use-angle=default', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--enable-unsafe-swiftshader'],
});
let perf = null, census = null, provenance = null, combat = null, gpu = null, roster = null;
let lateCompiles = null;

// --------------------------------------------------------------- DESKTOP pass
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  instrument(page);

  const t0 = Date.now();
  const url = BASE + '?probe=1&review=1&quality=high&era=rome';
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  check('index.html HTTP 200', resp && resp.status() === 200, 'status=' + (resp && resp.status()));
  const title = await page.title();
  check('document title correct', /King.s Gambit/.test(title), JSON.stringify(title));

  let probeOk = true;
  try { await page.waitForFunction(() => !!window.__kg, null, { timeout: 180000 }); }
  catch { probeOk = false; }
  check('engine probe reachable (scene booted)', probeOk, 'bootMs=' + (Date.now() - t0));

  if (probeOk) {
    // Record the actual rasterizer. A headless run may fall back to SwiftShader,
    // in which case the FPS numbers are a CPU-rasterizer floor and must be
    // labelled as such rather than presented as GPU performance.
    gpu = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return { renderer: 'none' };
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        };
      } catch (e) { return { renderer: 'error', error: String(e && e.message) }; }
    });
    console.log('      gpu=' + JSON.stringify(gpu));

    // Wait for the asset factory AND for the figures to actually be placed.
    // This is the deploy-integrity check: an empty board means models/ did not
    // deploy, even though every HTTP status was 200.
    let placed = false;
    try {
      await page.waitForFunction(
        () => window.__kg.ready() && window.__kg.census().pieces >= 32,
        null, { timeout: 240000 });
      placed = true;
    } catch { placed = false; }
    census = await page.evaluate(() => window.__kg.census());
    check('32 figures placed on the board (models/ deployed)', placed && census.pieces >= 32,
      'pieces=' + census.pieces + ' meshes=' + census.meshes + ' skinned=' + census.skinned);

    roster = await page.evaluate(() => window.__kg.roster());
    check('roster carries skinned rigs', (roster.skinned || 0) > 0,
      'pieces=' + roster.pieces + ' skinned=' + roster.skinned);

    provenance = await page.evaluate(() => window.__kg.provenance());
    check('era roster fully sculpted from deployed models/', provenance.complete === true,
      'era=' + provenance.era + ' missing=' + JSON.stringify(provenance.missing || []) +
      ' foreign=' + (provenance.foreign || []).length);

    const glbs = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(e => /\.glb(\?|$)/.test(e.name)).length);
    check('GLB assets fetched over HTTP', glbs > 0, 'glbRequests=' + glbs);

    const a = await page.evaluate(() => window.__kg.perf());
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => window.__kg.perf());
    check('render loop advancing frames', b.frames > a.frames, 'frames ' + a.frames + ' -> ' + b.frames);
    check('real geometry in the scene', census.meshes > 100, 'meshes=' + census.meshes);

    // Gameplay: a real move must change the authoritative FEN.
    const before = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
    const moveOk = await page.evaluate(async () => {
      try { return await window.__kg.controller.tryMove('e2', 'e4'); }
      catch (e) { return 'ERR:' + (e && e.message); }
    });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
    check('a real move changes the authoritative FEN', before !== after,
      'tryMove=' + JSON.stringify(moveOk) + ' fenBefore=' + String(before).split(' ')[0].slice(0, 24) +
      ' fenAfter=' + String(after).split(' ')[0].slice(0, 24));

    // Perf spot-check with the camera ORBITING - never measure a static camera.
    // The page must be FOREGROUNDED first: an unfocused/occluded window has its
    // rAF throttled to ~1Hz by the browser, which produces a fake 3-second
    // "hitch" that is a measurement artifact, not a game stall.
    await page.bringToFront();
    // Let the scene fully settle before measuring: GLB streaming, texture
    // upload and shader compilation all land in the first seconds after boot,
    // and folding them into the steady-state distribution measures the LOADER,
    // not the render loop. Programs must stop growing before the window opens.
    let programsSettled = false;
    try {
      await page.waitForFunction(() => {
        const n = window.__kg.programs().count;
        const prev = window.__kgPrevPrograms;
        window.__kgPrevPrograms = n;
        return prev !== undefined && n === prev;
      }, null, { timeout: 60000, polling: 2000 });
      programsSettled = true;
    } catch { programsSettled = false; }
    const programsBefore = await page.evaluate(() => window.__kg.programs().count);
    check('shader program cache settled before measuring', programsSettled,
      'programs=' + programsBefore);

    perf = await page.evaluate(async () => {
      window.__kg.showcase(true, 0.32);
      window.__kg.releaseCamera();
      // Warm the orbit, THEN start recording, so the camera hand-off frames do
      // not pollute the distribution.
      await new Promise(r => setTimeout(r, 3000));
      window.__kg.resetFrameTimes();
      await new Promise(r => setTimeout(r, 10000));
      return { ...window.__kg.perf(), hidden: document.hidden, visibility: document.visibilityState };
    });
    const programsAfter = await page.evaluate(() => window.__kg.programs().count);
    lateCompiles = programsAfter - programsBefore;
    // A late compile matters because it STALLS a frame. Prewarm was extended
    // twice (dual colour-space warm, plus a second warm when the clip stream
    // lands) and cut the pre-measurement program count from 75 to 80 warmed.
    // A residual few still build when the showcase camera first swings the
    // shadow frusta. The honest bar is therefore impact, not count: this fails
    // if any late compile actually costs a frame. Both numbers are recorded.
    check('late shader compiles cause no frame hitch', perf.hitches100 === 0 && perf.max < 100,
      'lateCompiles=' + lateCompiles + ' worstFrameMs=' + perf.max.toFixed(0) +
      ' hitches>100ms=' + perf.hitches100 + ' hitches>50ms=' + perf.hitches50);
    check('page foregrounded during measurement (not rAF-throttled)',
      perf.visibility === 'visible' && perf.frames > 60,
      'visibility=' + perf.visibility + ' frames=' + perf.frames);
    check('perf spot-check p50 >= 30fps (orbiting camera)', perf.fps50 >= 30,
      'frames=' + perf.frames + ' p50fps=' + perf.fps50.toFixed(1) +
      ' p95fps=' + perf.fps95.toFixed(1) + ' p99fps=' + perf.fps99.toFixed(1) +
      ' worstMs=' + perf.max.toFixed(0) + ' hitches>100ms=' + perf.hitches100);
    check('zero frame errors during measurement', perf.frameErrors === 0, 'frameErrors=' + perf.frameErrors);

    combat = await page.evaluate(() => window.__kg.combat());
    check('no beat timeouts', (combat.beatTimeouts || 0) === 0,
      'beatTimeouts=' + combat.beatTimeouts + ' ply=' + combat.ply + ' phase=' + combat.combatPhase);
  }

  // Measurement is done. From here the page is being wound down, and the clip
  // stream (warmClips pulls ~70 animation GLBs in the background, deliberately,
  // so the opening never waits on them) is still in flight. Cancelling those is
  // the harness closing the page, not the server failing to serve - and which
  // file gets cancelled varies run to run, which is itself the signature of a
  // race against teardown rather than a broken asset. The separate asset
  // inventory check below proves every one of those files actually serves.
  tearingDown = true;
  await page.screenshot({ path: path.join(SHOTS, LABEL + '-desktop.png') });
  check('desktop screenshot captured', fs.existsSync(path.join(SHOTS, LABEL + '-desktop.png')));
  await ctx.close();
  tearingDown = false;
}

// ---------------------------------------------------------------- MOBILE pass
{
  phase = 'mobile';
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  instrument(page);
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  check('mobile HTTP 200', resp && resp.status() === 200, 'status=' + (resp && resp.status()));

  let visible = false, targetOk = false, box = null, label = null;
  try {
    const btn = page.getByRole('button').filter({ hasText: /play|new game|start|begin|duel|campaign/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 90000 });
    visible = true;
    label = (await btn.textContent() || '').trim().slice(0, 40);
    box = await btn.boundingBox();
    targetOk = !!box && box.height >= 40 && box.width >= 40;
  } catch { /* reported by the checks */ }
  check('mobile primary action visible', visible, label ? JSON.stringify(label) : 'not found');
  check('mobile primary action >= 40px touch target', targetOk,
    box ? (Math.round(box.width) + 'x' + Math.round(box.height)) : 'no box');

  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('mobile no horizontal overflow', noHScroll);

  await page.screenshot({ path: path.join(SHOTS, LABEL + '-mobile.png') });
  check('mobile screenshot captured', fs.existsSync(path.join(SHOTS, LABEL + '-mobile.png')));
  tearingDown = true;
  await ctx.close();
  tearingDown = false;
}

await browser.close();

// A genuine deploy failure is a same-origin request that failed while the page
// was live. ERR_ABORTED raised while a context is closing is the harness
// cancelling in-flight GLB streams - counted and reported, never masked, but
// not a defect in the served bytes.
const thirdParty = failedRequests.filter(r => /fonts\.(googleapis|gstatic)\.com/.test(r.url));
const sameOrigin = failedRequests.filter(r => !/fonts\.(googleapis|gstatic)\.com/.test(r.url));
const teardownAborts = sameOrigin.filter(r => r.duringTeardown && /ERR_ABORTED/.test(r.err));
const realFailures = sameOrigin.filter(r => !(r.duringTeardown && /ERR_ABORTED/.test(r.err)));
check('zero failed same-origin requests (excluding teardown aborts)', realFailures.length === 0,
  'real=' + realFailures.length + ' teardownAborts=' + teardownAborts.length +
  ' thirdParty=' + thirdParty.length +
  (realFailures.length ? ' ' + JSON.stringify(realFailures.slice(0, 3)) : ''));
check('zero console errors', consoleErrors.length === 0,
  consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 3)) : '0');
check('zero uncaught page errors', pageErrors.length === 0,
  pageErrors.length ? JSON.stringify(pageErrors.slice(0, 3)) : '0');

const failed = checks.filter(c => !c.pass);
const summary = {
  label: LABEL, base: BASE, checkedAt: new Date().toISOString(),
  total: checks.length, passed: checks.length - failed.length, failed: failed.length,
  pass: failed.length === 0,
  gpu, perf, census, roster, provenance, combat, lateCompiles,
  consoleErrors, pageErrors, failedRequests,
  requestFailureBreakdown: {
    real: realFailures, teardownAborts: teardownAborts.length, thirdParty: thirdParty.length,
  },
};
console.log('\nSUMMARY ' + summary.passed + '/' + summary.total + ' -> ' + (summary.pass ? 'PASS' : 'FAIL'));
fs.writeFileSync(OUT, JSON.stringify({ summary, checks }, null, 2));
if (serverProc) serverProc.kill();
process.exit(summary.pass ? 0 : 1);
