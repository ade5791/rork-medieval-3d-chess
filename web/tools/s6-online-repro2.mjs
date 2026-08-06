// Click the real OPEN A HALL action and capture the WS + on-screen result.
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
await page.waitForSelector('button', { timeout: 120000 });
await page.mouse.click(640, 400); // skip intro if showing
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /online/i }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /enter the lobby/i }).first().click();
await page.waitForTimeout(1000);
const nameInput = page.locator('input').first();
if (await nameInput.count() > 0) await nameInput.fill('Gatekeeper');
await page.getByRole('button', { name: /open a hall/i }).first().click();
out.steps.push('open-a-hall');
await page.waitForTimeout(10000);
out.lobbyText = await page.evaluate(() => document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30));
await page.screenshot({ path: 'tools/out/s6-repro2.png' });
await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6-online-repro2.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
