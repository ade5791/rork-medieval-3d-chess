// Measure a MELEE capture beat (pawn takes) so the budget fix is sized from
// both branches of the cinematic, not just the ranged one.
import { chromium } from 'playwright';
import { BASE, sleep, attachConsole, skipIntro, startMatch, playMove } from './s5-lib.mjs';

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const sink = [];
attachConsole(page, sink);
await page.goto(`${BASE}/?probe=1&quality=high`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90000 });
await skipIntro(page);
await startMatch(page, { mode: 'hotseat' });

// Scholar-ish opening into a clean pawn capture: 1.e4 d5 2.exd5
const seq = [['e2', 'e4'], ['d7', 'd5'], ['e4', 'd5']];
for (const [from, to] of seq) {
  const r = await playMove(page, from, to);
  console.log('move', from + to, JSON.stringify(r));
  if (!r.ok) break;
}
await sleep(2000);
const c = await page.evaluate(() => window.__kg.combat());
console.log(
  'MELEE pawn capture  lastBeat=' + c.lastBeatMs + 'ms budget=' + c.lastBeatBudgetMs + 'ms timeouts=' + c.beatTimeouts,
  'over=' + (c.lastBeatMs > c.lastBeatBudgetMs ? 'YES by ' + (c.lastBeatMs - c.lastBeatBudgetMs) + 'ms' : 'no'),
);
console.log('errors:', JSON.stringify(sink.filter((e) => e.type === 'error' || e.type === 'pageerror').slice(0, 3)));
await browser.close();
