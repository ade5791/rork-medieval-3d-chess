// Measure the queen-capture beat from BEFORE the engine boots, so the
// scenario's own auto-played capture is captured rather than missed.
import { chromium } from 'playwright';
import { BASE, sleep, attachConsole } from './s5-lib.mjs';

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const sink = [];
attachConsole(page, sink);

// Hook console.warn and start phase sampling the instant __kg appears.
await page.addInitScript(() => {
  window.__beat = { marks: [], warns: [], t0: performance.now() };
  const origWarn = console.warn;
  console.warn = (...a) => {
    window.__beat.warns.push({ t: Math.round(performance.now()), msg: a.map(String).join(' ').slice(0, 220) });
    origWarn(...a);
  };
  let last = null;
  const iv = setInterval(() => {
    const kg = window.__kg;
    if (!kg || !kg.combat) return;
    const c = kg.combat();
    if (c.combatPhase !== last) {
      window.__beat.marks.push({
        phase: c.combatPhase,
        t: Math.round(performance.now()),
        timeouts: c.beatTimeouts,
        ply: c.ply,
      });
      last = c.combatPhase;
    }
  }, 16);
  window.__beatStop = () => clearInterval(iv);
});

await page.goto(`${BASE}/?probe=1&quality=high&scenario=capture`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90000 });
await page.locator('text=CLICK TO SKIP').first().click({ timeout: 12000 }).catch(() => {});
await sleep(14000);

const data = await page.evaluate(() => {
  window.__beatStop();
  return { ...window.__beat, combat: window.__kg.combat(), fen: window.__kg.controller.getSnapshot().fen };
});

console.log('PHASE TIMELINE (t relative to navigation):');
let prev = null;
for (const m of data.marks) {
  const d = prev ? ' (+' + (m.t - prev.t) + 'ms in ' + prev.phase + ')' : '';
  console.log('  ' + String(m.phase).padEnd(12) + String(m.t).padStart(7) + 'ms  timeouts=' + m.timeouts + d);
  prev = m;
}
const start = data.marks.find((m) => m.phase !== 'done');
const end = start ? data.marks.find((m) => m.t > start.t && m.phase === 'done') : null;
if (start && end) console.log('\nBEAT WALL TIME: ' + (end.t - start.t) + 'ms  (authored queen budget 4520ms)');
else console.log('\nno non-done phase sampled - beat began before first sample');
console.log('final beatTimeouts:', data.combat.beatTimeouts, 'animationTimeouts:', data.combat.animationTimeouts);
console.log('fen:', data.fen);
console.log('\nWARNS:');
for (const w of data.warns.slice(0, 10)) console.log('  ' + w.t + 'ms :: ' + w.msg);
console.log('console errors:', JSON.stringify(sink.filter((e) => e.type === 'error' || e.type === 'pageerror').slice(0, 4)));

await browser.close();
