// Diagnostic: what does the app actually render headless, and what review
// query params does it honour? Written before extending the verify harness so
// selectors are read from the real DOM instead of guessed.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const APP = process.env.APP_URL || "http://127.0.0.1:8081";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));

await page.goto(APP, { waitUntil: "load" });
for (const wait of [4000, 6000, 8000]) {
  await page.waitForTimeout(wait);
  const buttons = await page.locator("button").allTextContents();
  console.log(`--- after ~${wait}ms ---`);
  console.log("buttons:", JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean)));
  if (buttons.some((b) => /Online/i.test(b))) break;
}

const text = await page.locator("body").innerText().catch(() => "");
console.log("BODY TEXT (first 600):");
console.log(text.slice(0, 600));
console.log("CONSOLE ERRORS:", errs.slice(0, 5));
await page.screenshot({ path: "reports/mp-live/probe.png" });
writeFileSync("reports/mp-live/probe.json", JSON.stringify({ text: text.slice(0, 2000), errs }, null, 2));
await browser.close();
