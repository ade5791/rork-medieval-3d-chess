/**
 * What is actually on screen after boot? Two failed locator guesses in a row is
 * a signal to stop guessing and read the real DOM.
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
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE_ERR:", m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("PAGEERR:", String(e).slice(0, 200)));

await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90000 });
console.log("probe live");

for (const wait of [0, 3000, 6000, 12000]) {
  if (wait) await page.waitForTimeout(wait - (wait === 3000 ? 0 : 0));
  const snap = await page.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll("button")).map((b) =>
      (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 30),
    ),
    bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
  }));
  console.log(`\n--- after ${wait}ms --- buttons=${snap.buttons.length}`);
  console.log("labels:", JSON.stringify(snap.buttons.slice(0, 20)));
  console.log("text:", snap.bodyText);
}

await browser.close();
