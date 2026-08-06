// Reproduce: choosing a different era shows the "needs graphic acceleration"
// (WebGL unsupported) gate. Hypothesis: boot effect re-runs on era change,
// old engine dispose() calls forceContextLoss(), new SceneEngine reuses the
// SAME canvas whose context is now lost -> renderer fails -> unsupported gate.
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-chess/";

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
// Skip intro if present
await page.waitForTimeout(4000);
const skip = page.locator("text=CLICK TO SKIP");
if (await skip.count()) await page.mouse.click(720, 450);
// Wait for menu
await page.waitForSelector("text=SETTINGS", { timeout: 90000 });
console.log("menu reached");

// Open settings
await page.click("text=SETTINGS");
await page.waitForTimeout(1000);

// Click a different era (Imperial Rome; default is Age of Kings)
const rome = page.locator("text=Imperial Rome").first();
if (!(await rome.count())) { console.log("ERA BUTTON NOT FOUND"); process.exit(2); }
await rome.click();
console.log("clicked Imperial Rome");
await page.waitForTimeout(12000);

const state = await page.evaluate(() => ({
  gateShown: (document.body.innerText || "").includes("The hall needs WebGL"),
  canvases: document.querySelectorAll("canvas").length,
  bodyHead: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
}));
console.log(JSON.stringify({ ...state, consoleErrors: errors.slice(0, 10) }, null, 2));
await page.screenshot({ path: "tools/out/era-switch-repro.png" });
await browser.close();
process.exit(state.gateShown ? 0 : 3);
