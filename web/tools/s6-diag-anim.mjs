/**
 * Hypothesis: the 5 touch-target defects are a MEASUREMENT-TIMING artifact, not
 * undersized controls. `.mc-rise` (menu card + settings panel) animates from
 * scale(0.97) to scale(1) over 460ms. 44 * 0.97 = 42.68, which is exactly the
 * 42.7 the gate reports, and 43.0 / 43.4 are intermediate eased values.
 *
 * Decisive test: measure the SAME controls twice - immediately after they
 * appear, and again after every running CSS animation has finished. If the
 * second measurement is >= 44, the controls are correctly sized and the harness
 * is sampling mid-flight.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-3d-chess";
const W = Number(process.argv[3] || 393);
const H = Number(process.argv[4] || 852);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, {
  timeout: 90000,
});
// The asset-loading gate ("Carving N of 6") renders BEFORE the skip control
// exists, so wait for the control itself rather than assuming it is present.
await page
  .locator("text=CLICK TO SKIP")
  .first()
  .waitFor({ state: "visible", timeout: 120000 })
  .catch(() => console.log("!! skip control never appeared"));
await page.locator("text=CLICK TO SKIP").first().click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);

const measure = () =>
  page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button")) {
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      out.push({
        label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 16),
        h: Math.round(r.height * 100) / 100,
        w: Math.round(r.width * 100) / 100,
      });
    }
    return out;
  });

// Wait only for the menu to exist, then measure IMMEDIATELY (what the gate does).
await page.waitForFunction(() => document.querySelectorAll("button").length > 3, null, {
  timeout: 45000,
});
const immediate = await measure();

// Now wait for every running animation to finish, then measure again.
await page.evaluate(async () => {
  const anims = document.getAnimations ? document.getAnimations() : [];
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
});
await page.waitForTimeout(200);
const settled = await measure();

const byLabel = new Map(settled.map((s) => [s.label, s]));
console.log("label                immediate   settled");
let immBad = 0;
let setBad = 0;
for (const i of immediate) {
  const s = byLabel.get(i.label);
  if (i.h < 44) immBad++;
  if (s && s.h < 44) setBad++;
  console.log(
    `${i.label.padEnd(20)} ${String(i.h).padStart(8)} ${String(s ? s.h : "-").padStart(9)}`,
  );
}
console.log(`\nundersized immediately : ${immBad}/${immediate.length}`);
console.log(`undersized when settled: ${setBad}/${settled.length}`);
console.log(
  setBad === 0
    ? "\nCONCLUSION: controls meet the 44px floor at rest. The gate samples mid-animation."
    : "\nCONCLUSION: genuinely undersized controls remain after animation settles.",
);
await browser.close();
