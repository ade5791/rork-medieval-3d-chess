/**
 * Targets are 43.0 / 43.4 / 42.7 px tall while CSS says min-height:44px. Those
 * are 0.977 / 0.986 / 0.970 of 44 - the signature of an ancestor scale
 * transform, not a CSS rule that failed to apply. Walk from a failing control
 * up to <html> and print every transform, so the fix addresses the scaler
 * rather than inflating numbers until the gate goes green.
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
// Same route the QA gate uses, so the measured DOM is the gate's DOM.
await page
  .locator("text=CLICK TO SKIP")
  .first()
  .click({ timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(600);
// The difficulty chips only exist once the Computer mode tab is selected.
await page
  .getByRole("button", { name: /Computer/i })
  .first()
  .click({ timeout: 20000 })
  .catch(() => console.log("!! Computer tab not clickable"));
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button"));
  const btn =
    all.find((b) => /easy|medium|hard/i.test(b.textContent || "")) ||
    all.find((b) => /Ivory|Obsidian|Computer|2 Players/i.test(b.textContent || "")) ||
    all[0];
  if (!btn)
    return {
      error: "no button at all",
      buttonCount: all.length,
      bodyText: document.body.innerText.slice(0, 300),
    };
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const chain = [];
  let n = btn;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (s.transform && s.transform !== "none") {
      chain.push({
        tag: n.tagName,
        cls: String(n.className).slice(0, 70),
        transform: s.transform,
        zoom: s.zoom,
      });
    }
    if (s.zoom && s.zoom !== "1" && s.zoom !== "normal") {
      chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 70), zoomOnly: s.zoom });
    }
    n = n.parentElement;
  }
  return {
    label: btn.textContent.trim(),
    cssMinHeight: cs.minHeight,
    cssHeight: cs.height,
    rectHeight: Math.round(r.height * 1000) / 1000,
    offsetHeight: btn.offsetHeight,
    ratio: Math.round((r.height / 44) * 10000) / 10000,
    transformChain: chain,
    htmlZoom: getComputedStyle(document.documentElement).zoom,
    bodyZoom: getComputedStyle(document.body).zoom,
    visualScale: window.visualViewport ? window.visualViewport.scale : null,
    innerWidth: window.innerWidth,
    dpr: window.devicePixelRatio,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
