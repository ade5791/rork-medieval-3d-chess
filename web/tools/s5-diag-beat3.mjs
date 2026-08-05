// Read the measured true beat duration from the probe, for the queen (ranged
// spell) and a melee rank, so the watchdog budget can be sized from evidence.
import { chromium } from 'playwright';
import { BASE, sleep, attachConsole } from './s5-lib.mjs';

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });

async function run(scenario, label) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const sink = [];
  attachConsole(page, sink);
  await page.goto(`${BASE}/?probe=1&quality=high&scenario=${scenario}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90000 });
  await page.locator('text=CLICK TO SKIP').first().click({ timeout: 12000 }).catch(() => {});
  // Wait until a beat has been measured (or give up).
  await page
    .waitForFunction(() => window.__kg.combat().lastBeatMs > 0, null, { timeout: 45000 })
    .catch(() => {});
  await sleep(1500);
  const c = await page.evaluate(() => window.__kg.combat());
  console.log(
    label.padEnd(22),
    'lastBeat=' + c.lastBeatMs + 'ms',
    'maxBeat=' + c.maxBeatMs + 'ms',
    'budget=' + c.lastBeatBudgetMs + 'ms',
    'timeouts=' + c.beatTimeouts,
    'over=' + (c.maxBeatMs > c.lastBeatBudgetMs ? 'YES by ' + (c.maxBeatMs - c.lastBeatBudgetMs) + 'ms' : 'no'),
  );
  await ctx.close();
  return c;
}

await run('capture', 'queen capture (spell)');
await run('promotion', 'promotion capture');
await run('checkmate', 'checkmate');

await browser.close();
