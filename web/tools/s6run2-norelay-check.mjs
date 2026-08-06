// Verify the online lobby now fails honestly instead of spinning forever.
// On localhost (no relay on this port) the socket fails -> "unreachable" error.
// On the live github.io deploy the guard refuses upfront -> "no-relay" error
// plus the static notice. Pass the base URL as argv[2].
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8156/kings-gambit-medieval-chess/';
const out = { base: BASE, checks: [] };
const check = (name, pass, detail) => { out.checks.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' :: ' + detail); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('button', { timeout: 120000 });
await page.mouse.click(640, 400);
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /online/i }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /enter the lobby/i }).first().click();
await page.waitForTimeout(1200);

const isPages = new URL(BASE).hostname.endsWith('.github.io');
const noticeVisible = await page.getByText('no relay server', { exact: false }).first().isVisible().catch(() => false);
if (isPages) check('static notice shown upfront on Pages', noticeVisible, 'notice=' + noticeVisible);
else check('no static notice on non-Pages host', !noticeVisible, 'notice=' + noticeVisible);

await page.getByRole('button', { name: /open a hall/i }).first().click();
// The error must arrive quickly, not spin forever.
const started = Date.now();
let errText = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  errText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('p'));
    const hit = els.find(e => /relay|reach|deployment/i.test(e.innerText) && /could not|does not include|refused|down/i.test(e.innerText));
    return hit ? hit.innerText.trim() : null;
  });
  if (errText) break;
}
const elapsed = Date.now() - started;
check('host attempt surfaces an honest error (no infinite spinner)', !!errText, 'after ' + elapsed + 'ms: ' + (errText || 'NO ERROR SHOWN'));

const stillSpinning = await page.evaluate(() => /OPENING THE HALL/i.test(document.body.innerText));
check('busy spinner cleared after failure', !stillSpinning, 'spinner=' + stillSpinning);

await page.screenshot({ path: 'tools/out/s6run2-norelay.png' });
await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6run2-norelay.json', JSON.stringify(out, null, 2));
const failed = out.checks.filter(c => !c.pass).length;
console.log('SUMMARY: ' + (out.checks.length - failed) + '/' + out.checks.length + ' pass');
process.exit(failed ? 1 : 0);
