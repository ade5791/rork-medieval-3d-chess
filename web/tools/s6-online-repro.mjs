// Reproduce the user-reported 400: wait out the loading screen, open the
// Online tab, enter the lobby, try to host, and capture the exact WS failure.
import { chromium } from 'playwright';

const BASE = process.env.S6_URL || 'https://ade5791.github.io/kings-gambit-medieval-chess/';
const out = { base: BASE, ws: [], http4xx: [], consoleErr: [], steps: [] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('response', (r) => { if (r.status() >= 400) out.http4xx.push({ s: r.status(), u: r.url().slice(0, 160) }); });
page.on('console', (m) => { if (m.type() === 'error') out.consoleErr.push(m.text().slice(0, 300)); });
page.on('websocket', (ws) => {
  const rec = { url: ws.url(), error: null, closed: false };
  out.ws.push(rec);
  ws.on('socketerror', (e) => { rec.error = String(e).slice(0, 300); });
  ws.on('close', () => { rec.closed = true; });
});

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
// Wait for the menu (loading can take ~40s cold).
await page.waitForSelector('button', { timeout: 120000 });
// Skip intro if present.
const skip = page.getByText('CLICK TO SKIP', { exact: false }).first();
if (await skip.count() > 0 && await skip.isVisible().catch(() => false)) {
  await page.mouse.click(640, 400);
  out.steps.push('skipped-intro');
  await page.waitForTimeout(2000);
}
const bodyBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean));
out.menuButtons = bodyBtns;

const onlineTab = page.getByRole('button', { name: /online/i }).first();
if (await onlineTab.count() > 0) {
  await onlineTab.click();
  out.steps.push('online-tab');
  await page.waitForTimeout(800);
  const enter = page.getByRole('button', { name: /enter the lobby/i }).first();
  if (await enter.count() > 0) {
    await enter.click();
    out.steps.push('entered-lobby');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tools/out/s6-repro-lobby.png' });
    const lobbyBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim() || b.getAttribute('aria-label')).filter(Boolean));
    out.lobbyButtons = lobbyBtns;
    // Try to host a hall.
    const host = page.getByRole('button', { name: /host|raise|create/i }).first();
    if (await host.count() > 0) {
      await host.click();
      out.steps.push('clicked-host');
      await page.waitForTimeout(8000);
    }
    out.lobbyText = await page.evaluate(() => document.body.innerText.split('\n').filter(l => l.trim()).slice(0, 30));
    await page.screenshot({ path: 'tools/out/s6-repro-after-host.png' });
  }
}

await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6-online-repro.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
