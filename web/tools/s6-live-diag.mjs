// S6 live diagnostic: load the live URL, capture every non-2xx response and console error.
import { chromium } from 'playwright';

const URL_BASE = process.env.S6_URL || 'https://ade5791.github.io/kings-gambit-medieval-chess/';
const out = { url: URL_BASE, badResponses: [], requestFailures: [], consoleErrors: [], pageErrors: [], ok: false };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('response', (r) => {
  const s = r.status();
  if (s >= 400) out.badResponses.push({ status: s, url: r.url() });
});
page.on('requestfailed', (r) => {
  out.requestFailures.push({ url: r.url(), err: r.failure() ? r.failure().errorText : 'unknown' });
});
page.on('console', (m) => {
  if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => out.pageErrors.push(String(e).slice(0, 400)));

try {
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(12000);
  const title = await page.title();
  const rootHtmlLen = await page.evaluate(() => (document.getElementById('root') || {}).innerHTML ? document.getElementById('root').innerHTML.length : 0);
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  out.title = title;
  out.rootHtmlLen = rootHtmlLen;
  out.hasCanvas = hasCanvas;
  out.bodyText = bodyText;
  out.ok = rootHtmlLen > 100;
  await page.screenshot({ path: 'tools/out/s6-live-diag.png' });
} catch (e) {
  out.gotoError = String(e).slice(0, 500);
}

await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6-live-diag.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, title: out.title, hasCanvas: out.hasCanvas, bad: out.badResponses.length, reqFail: out.requestFailures.length, consoleErr: out.consoleErrors.length, pageErr: out.pageErrors.length }, null, 2));
if (out.badResponses.length) console.log('BAD:', JSON.stringify(out.badResponses.slice(0, 20), null, 2));
if (out.consoleErrors.length) console.log('CONSOLE:', JSON.stringify(out.consoleErrors.slice(0, 10), null, 2));
if (out.pageErrors.length) console.log('PAGEERR:', JSON.stringify(out.pageErrors.slice(0, 10), null, 2));
