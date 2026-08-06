// Multi-switch soak: classic -> rome -> sengoku -> egypt -> classic.
// Each switch reboots the engine on a fresh keyed canvas; the old context is
// force-lost. This catches both the null-precision crash and context
// exhaustion across repeated swaps.
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-chess/";
const ERAS = ["Imperial Rome", "Sengoku Japan", "New Kingdom Egypt", "Age of Kings"];

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(4000);
if (await page.locator("text=CLICK TO SKIP").count()) await page.mouse.click(720, 450);
await page.waitForSelector("text=SETTINGS", { timeout: 90000 });

let allOk = true;
for (const era of ERAS) {
  // settings may already be open after a reboot skip; reopen if needed
  if (!(await page.locator(`text=${era}`).count())) {
    await page.waitForTimeout(3000);
    if (await page.locator("text=CLICK TO SKIP").count()) await page.mouse.click(720, 450);
    await page.waitForSelector("text=SETTINGS", { timeout: 90000 });
    await page.click("text=SETTINGS");
    await page.waitForTimeout(800);
  }
  await page.locator(`text=${era}`).first().click();
  await page.waitForTimeout(10000);
  const gate = (await page.locator("text=The hall needs WebGL").count()) > 0;
  const canvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
  console.log(JSON.stringify({ era, gateShown: gate, canvases }));
  if (gate) allOk = false;
}
console.log(JSON.stringify({ allOk, consoleErrors: errors.slice(0, 10) }));
await browser.close();
process.exit(allOk ? 0 : 1);
