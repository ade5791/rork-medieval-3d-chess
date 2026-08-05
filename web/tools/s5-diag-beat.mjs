// Measure the ACTUAL wall time of the queen capture beat against its authored
// budget, so the watchdog timeout is diagnosed rather than guessed at.
import { chromium } from 'playwright';
import { sleep, attachConsole, bootProbe, skipIntro, startMatch, settleCamera, playMove } from './s5-lib.mjs';

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const sink = [];
attachConsole(page, sink);

await bootProbe(page, 'quality=high&scenario=capture');
await skipIntro(page);
// A scenario auto-starts the match; only click through the menu if it is up.
const playing = await page
  .waitForFunction(() => window.__kg.controller.getSnapshot().status === 'playing', null, { timeout: 8000 })
  .then(() => true)
  .catch(() => false);
if (!playing) await startMatch(page, { mode: 'hotseat' });
await settleCamera(page);

// Instrument: record when the phase machine enters and leaves the beat.
await page.evaluate(() => {
  window.__beat = { marks: [], warns: [] };
  const orig = console.warn;
  console.warn = (...a) => { window.__beat.warns.push(a.map(String).join(' ').slice(0, 200)); orig(...a); };
  let last = null;
  window.__beatTimer = setInterval(() => {
    const c = window.__kg.combat();
    if (c.combatPhase !== last) {
      window.__beat.marks.push({ phase: c.combatPhase, t: Math.round(performance.now()) });
      last = c.combatPhase;
    }
  }, 16);
});

const before = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
console.log('scenario fen:', before);

const res = await playMove(page, 'd2', 'd7');
console.log('queen capture move:', JSON.stringify(res));
await sleep(2500);

const data = await page.evaluate(() => {
  clearInterval(window.__beatTimer);
  const c = window.__kg.combat();
  return { marks: window.__beat.marks, warns: window.__beat.warns, combat: c };
});

console.log('\nPHASE TIMELINE:');
let prev = null;
for (const m of data.marks) {
  console.log('  ' + String(m.phase).padEnd(12), m.t + 'ms', prev ? '(+' + (m.t - prev.t) + 'ms in ' + prev.phase + ')' : '');
  prev = m;
}
const first = data.marks[0];
const done = [...data.marks].reverse().find((m) => m.phase === 'done');
if (first && done) console.log('\nBEAT WALL TIME: ' + (done.t - first.t) + 'ms');
console.log('authored queen budget: 4520ms (1.76s windows * 2 + 1s)');
console.log('beatTimeouts:', data.combat.beatTimeouts, ' animationTimeouts:', data.combat.animationTimeouts);
console.log('warns:', JSON.stringify(data.warns.slice(0, 6), null, 1));
console.log('console errors:', JSON.stringify(sink.filter((e) => e.type === 'error' || e.type === 'pageerror').slice(0, 4)));

await browser.close();
