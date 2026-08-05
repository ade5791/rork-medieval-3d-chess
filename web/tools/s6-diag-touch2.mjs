/**
 * Touch-target root cause, tightly instrumented.
 *
 * Question: the gate reports 43.6px where CSS declares min-height:44px.
 *   (a) an ancestor scale transform is still ANIMATING when the rect is read
 *       -> harness timing artifact; the control a player presses is really 44px
 *   (b) min-height never applies -> real product defect, fix before publish
 *
 * Measure the same controls twice - immediately, then after every running
 * animation has finished - and report computed min-height plus the composed
 * ancestor scale, so the answer is evidence rather than a guess.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.S6_BASE || "http://127.0.0.1:8155/kings-gambit-medieval-chess";
const log = [];
function say(s) {
  console.log(s);
  log.push(s);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();

await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
say("goto ok");
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 60000 });
say("probe live");

// Cold start carves the roster first, THEN shows the intro.
// 185MB of GLBs on a cold cache, and slower still when another Chromium is
// competing for the same disk - so this wait must be generous, not 60s.
await page.locator("text=CLICK TO SKIP").first().waitFor({ state: "visible", timeout: 240000 });
say("intro visible");
await page.locator("text=CLICK TO SKIP").first().click({ timeout: 10000 });
say("intro skipped");
await page.getByRole("button", { name: /Take the field/i }).first().waitFor({ state: "visible", timeout: 30000 });
say("menu visible");

const CENSUS = `() => {
  const out = [];
  for (const el of Array.from(document.querySelectorAll('button, [role=button]'))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    let scale = 1; const chain = []; let node = el;
    while (node && node !== document.documentElement) {
      const t = getComputedStyle(node).transform;
      if (t && t !== 'none') {
        const m = new DOMMatrixReadOnly(t);
        if (Math.abs(m.a - 1) > 1e-6) { scale *= m.a; chain.push((node.className||node.tagName).toString().slice(0,28)+':'+m.a.toFixed(4)); }
      }
      node = node.parentElement;
    }
    out.push({
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0,22),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      minH: cs.minHeight, minW: cs.minWidth,
      scale: +scale.toFixed(4), chain: chain.join(' '),
      running: document.getAnimations().filter(a => a.playState === 'running').length
    });
  }
  return out;
}`;

const immediate = await page.evaluate(CENSUS);
say(`\n=== IMMEDIATE === undersized ${immediate.filter((r) => r.h < 44 || r.w < 44).length}/${immediate.length}`);
for (const r of immediate.filter((r) => r.h < 44 || r.w < 44).slice(0, 6)) {
  say(`  ${r.label.padEnd(22)} ${r.w}x${r.h} minH=${r.minH} scale=${r.scale} chain=[${r.chain}] running=${r.running}`);
}

await page.evaluate(async () => {
  await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
});
await page.waitForTimeout(600);

const settled = await page.evaluate(CENSUS);
say(`\n=== SETTLED === undersized ${settled.filter((r) => r.h < 44 || r.w < 44).length}/${settled.length}`);
for (const r of settled.filter((r) => r.h < 44 || r.w < 44).slice(0, 10)) {
  say(`  ${r.label.padEnd(22)} ${r.w}x${r.h} minH=${r.minH} scale=${r.scale} chain=[${r.chain}]`);
}
say("\nsample settled row: " + JSON.stringify(settled[0]));

mkdirSync("tools/out", { recursive: true });
writeFileSync("tools/out/s6-diag-touch2.json", JSON.stringify({ immediate, settled, log }, null, 2));
await browser.close();
say("done");
