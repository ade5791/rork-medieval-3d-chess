// Why do controls with min-height:44px measure ~43px on the LIVE build?
// Walks the ancestor chain of an offending control and reports every computed
// transform, so the cause is measured rather than guessed.
import { chromium } from "playwright";

const BASE = process.env.DIAG_BASE || "https://ade5791.github.io/kings-gambit-medieval-chess";
const say = (s) => console.log(s);

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 90000 });

  // Be patient and forgiving: click any skip affordance repeatedly until the menu lands.
  let menuUp = false;
  for (let i = 0; i < 40; i += 1) {
    menuUp = await page
      .getByRole("button", { name: /Take the field/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (menuUp) break;
    await page.locator("text=CLICK TO SKIP").first().click({ timeout: 1500 }).catch(() => {});
    await page.mouse.click(196, 700).catch(() => {});
    await page.waitForTimeout(1000);
  }
  say(`menuVisible=${menuUp}`);

  const report = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target =
      btns.find((b) => /^easy$/i.test((b.textContent || "").trim())) ||
      btns.find((b) => (b.textContent || "").trim().length > 0);
    if (!target) return { error: "no button found", count: btns.length };

    const r = target.getBoundingClientRect();
    const cs = getComputedStyle(target);
    const chain = [];
    let n = target;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (s.transform && s.transform !== "none") {
        chain.push({
          node: n.tagName.toLowerCase() + "." + String(n.className || "").slice(0, 50),
          transform: s.transform,
          animation: s.animationName,
        });
      }
      if (s.zoom && s.zoom !== "1" && s.zoom !== "normal") {
        chain.push({ node: n.tagName.toLowerCase(), zoom: s.zoom });
      }
      n = n.parentElement;
    }

    return {
      label: (target.textContent || "").trim(),
      rect: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
      offsetH: target.offsetHeight,
      minH: cs.minHeight,
      minW: cs.minWidth,
      boxSizing: cs.boxSizing,
      fontSize: cs.fontSize,
      htmlFontSize: getComputedStyle(document.documentElement).fontSize,
      transformChain: chain,
      devicePixelRatio: window.devicePixelRatio,
      visualScale: window.visualViewport ? window.visualViewport.scale : null,
    };
  });

  say(JSON.stringify(report, null, 2));
  await browser.close();
};

run().catch((e) => { console.error("DIAG FAILED", e); process.exit(1); });
