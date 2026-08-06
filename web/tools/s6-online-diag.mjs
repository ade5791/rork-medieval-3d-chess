// Reproduce the reported 400: drive the live Pages site into the Online lobby
// and capture what the relay connection attempt actually returns.
import { chromium } from 'playwright';

const BASE = process.env.S6_URL || 'https://ade5791.github.io/kings-gambit-medieval-chess/';
const out = { base: BASE, http400: [], wsEvents: [], consoleErrors: [], steps: [] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('response', (r) => { if (r.status() >= 400) out.http400.push({ status: r.status(), url: r.url() }); });
page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 300)); });
page.on('websocket', (ws) => {
  const rec = { url: ws.url(), closed: false, error: null };
  out.wsEvents.push(rec);
  ws.on('close', () => { rec.closed = true; });
  ws.on('socketerror', (e) => { rec.error = String(e).slice(0, 300); });
});

try {
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  out.steps.push('loaded');

  // Find an online/multiplayer entry on the menu by accessible text.
  const candidates = ['Online', 'online', 'Play online', 'Multiplayer', 'Play a friend online', 'Host', 'Join'];
  let clicked = null;
  for (const label of candidates) {
    const el = page.getByText(label, { exact: false }).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      clicked = label;
      break;
    }
  }
  out.steps.push('clicked:' + clicked);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tools/out/s6-online-1.png' });

  // Try to create/host a hall.
  const hostCandidates = ['Create', 'Host', 'New hall', 'Create hall', 'Raise the banner', 'Open a hall'];
  let hosted = null;
  for (const label of hostCandidates) {
    const el = page.getByText(label, { exact: false }).first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      hosted = label;
      break;
    }
  }
  out.steps.push('hosted:' + hosted);
  await page.waitForTimeout(6000);
  out.visibleError = await page.evaluate(() => {
    const t = document.body.innerText;
    const lines = t.split('\n').filter(l => /relay|refused|error|400|connect/i.test(l));
    return lines.slice(0, 6);
  });
  await page.screenshot({ path: 'tools/out/s6-online-2.png' });
} catch (e) {
  out.fatal = String(e).slice(0, 400);
}

await browser.close();
const fs = await import('fs');
fs.writeFileSync('tools/out/s6-online-diag.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
