// Diagnose the landscape overlap: difficulty chips vs "Take the field".
import { chromium } from 'playwright';
import { sleep, attachConsole, bootProbe, skipIntro } from './s5-lib.mjs';

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const sink = [];
attachConsole(page, sink);
await bootProbe(page, 'quality=high');
await skipIntro(page);
await sleep(600);

// Open the AI panel so the difficulty chips are on screen.
await page.getByRole('button', { name: /Computer/i }).first().click({ timeout: 20000 }).catch(() => {});
await sleep(500);

const boxes = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], a[href]')) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 1 || r.height < 1) continue;
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) continue;
    out.push({
      label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      pe: st.pointerEvents,
      z: st.zIndex,
    });
  }
  return { viewport: { w: window.innerWidth, h: window.innerHeight }, boxes: out };
});
console.log('viewport', JSON.stringify(boxes.viewport));
for (const b of boxes.boxes) console.log(' ', JSON.stringify(b));

// Which pairs actually overlap, and does the overlap steal the tap?
const overlaps = [];
for (let i = 0; i < boxes.boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.boxes.length; j += 1) {
    const a = boxes.boxes[i]; const b = boxes.boxes[j];
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ox > 0 && oy > 0) overlaps.push({ a: a.label, b: b.label, ox, oy, area: ox * oy });
  }
}
console.log('\nOVERLAPS:', JSON.stringify(overlaps, null, 1));

// For each overlapping pair, does elementFromPoint at each centre return itself?
const stolen = await page.evaluate(() => {
  const res = [];
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const owns = el.contains(top) || el === top;
    if (!owns) {
      res.push({
        label: (el.textContent || '').trim().slice(0, 34),
        blockedBy: top ? (top.tagName + ' ' + String(top.className).slice(0, 60)) : 'null',
      });
    }
  }
  return res;
});
console.log('\nCENTRE TAP STOLEN FROM:', JSON.stringify(stolen, null, 1));

await browser.close();
