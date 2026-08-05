/**
 * S6 touch-target diagnostic.
 *
 * The gate reports 43.6px where CSS declares min-height:44px. Two candidate
 * causes, and the fix is opposite depending on which is true:
 *
 *   (a) an ancestor transform scale is still animating when the rect is read
 *       -> harness timing bug, the shipped control really is 44px
 *   (b) the min-height rule is not applying at all
 *       -> real product defect, must be fixed in CSS before publish
 *
 * So measure the SAME element twice: immediately, and again after all running
 * animations have finished. Also read the computed min-height and the composed
 * ancestor scale, so the conclusion is evidence rather than inference.
 */
import { chromium } from "playwright";

const BASE = process.env.S6_BASE || "http://127.0.0.1:8155/kings-gambit-medieval-chess";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
// Same boot contract the QA gate uses: the engine probe, not a DOM guess.
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90000 });
// Cold start carves 6 figures from ~185MB of GLBs first (~12s here), THEN the
// intro appears. Clicking skip before it exists is a no-op, so wait for it.
await page.locator("text=CLICK TO SKIP").first().waitFor({ timeout: 90000 }).catch(() => {});
await page.locator("text=CLICK TO SKIP").first().click({ timeout: 20000 }).catch(() => {});
await page.getByRole("button", { name: /Take the field/i }).first().waitFor({ timeout: 60000 });

async function census(label) {
  return await page.evaluate((lbl) => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("button, [role=button]"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      // Compose every ancestor transform scale to see what is shrinking the rect.
      let scale = 1;
      let node = el;
      const chain = [];
      while (node && node !== document.documentElement) {
        const t = getComputedStyle(node).transform;
        if (t && t !== "none") {
          const m = new DOMMatrixReadOnly(t);
          if (Math.abs(m.a - 1) > 1e-6) {
            scale *= m.a;
            chain.push(`${node.className || node.tagName}:${m.a.toFixed(4)}`);
          }
        }
        node = node.parentElement;
      }
      out.push({
        phase: lbl,
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
        w: +r.width.toFixed(2),
        h: +r.height.toFixed(2),
        minH: cs.minHeight,
        minW: cs.minWidth,
        composedScale: +scale.toFixed(4),
        scaleChain: chain.join(" "),
        anims: el.getAnimations({ subtree: false }).length,
      });
    }
    return out;
  }, label);
}

const immediate = await census("immediate");

// Let every running animation on the page settle.
await page.evaluate(async () => {
  const all = document.getAnimations();
  await Promise.all(all.map((a) => a.finished.catch(() => {})));
});
await page.waitForTimeout(400);

const settled = await census("settled");

console.log("=== IMMEDIATE (as the gate measures) ===");
for (const r of immediate.filter((r) => r.h < 44 || r.w < 44)) {
  console.log(`${r.label.padEnd(24)} ${r.w}x${r.h}  minH=${r.minH} scale=${r.composedScale} chain=[${r.scaleChain}] anims=${r.anims}`);
}
console.log(`undersized immediate: ${immediate.filter((r) => r.h < 44 || r.w < 44).length}/${immediate.length}`);

console.log("\n=== SETTLED (animations finished) ===");
for (const r of settled.filter((r) => r.h < 44 || r.w < 44)) {
  console.log(`${r.label.padEnd(24)} ${r.w}x${r.h}  minH=${r.minH} scale=${r.composedScale} chain=[${r.scaleChain}] anims=${r.anims}`);
}
console.log(`undersized settled: ${settled.filter((r) => r.h < 44 || r.w < 44).length}/${settled.length}`);

console.log("\n=== SAMPLE ROW (first control, both phases) ===");
console.log(JSON.stringify(immediate[0], null, 1));
console.log(JSON.stringify(settled[0], null, 1));

await browser.close();
