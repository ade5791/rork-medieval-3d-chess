// Trace the live load: every request+status, loading progress over 60s.
import { chromium } from 'playwright';
const BASE = process.env.S6_URL || 'https://ade5791.github.io/kings-gambit-medieval-chess/';
const out = { base: BASE, responses: [], failures: [], consoleAll: [], progress: [] };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('response', (r) => out.responses.push({ s: r.status(), u: r.url().slice(0, 140) }));
page.on('requestfailed', (r) => out.failures.push({ u: r.url().slice(0, 140), e: r.failure() ? r.failure().errorText : '?' }));
page.on('console', (m) => out.consoleAll.push({ t: m.type(), x: m.text().slice(0, 250) }));
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(5000);
  const txt = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 200));
  out.progress.push({ t: (i + 1) * 5, txt });
  const btns = await page.evaluate(() => document.querySelectorAll('button').length);
  if (btns > 0) { out.progress.push({ t: (i + 1) * 5, btns }); break; }
}
await page.screenshot({ path: 'tools/out/s6-load-final.png' });
await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6-load-trace.json', JSON.stringify(out, null, 2));
const bad = out.responses.filter(r => r.s >= 400);
console.log('RESPONSES:', out.responses.length, 'BAD:', JSON.stringify(bad, null, 2));
console.log('FAILURES:', JSON.stringify(out.failures, null, 2));
console.log('CONSOLE:', JSON.stringify(out.consoleAll.filter(c => c.t !== 'log').slice(0, 15), null, 2));
console.log('PROGRESS:', JSON.stringify(out.progress, null, 2));
