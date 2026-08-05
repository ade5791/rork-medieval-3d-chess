/**
 * Why did the probe never appear at the subpath? Loads the staged bytes in a
 * real browser and reports every console message, page error, and failed
 * request - the actual evidence, instead of a guess.
 */
import { chromium } from "playwright";

const URL_ = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-3d-chess/?probe=1";
const browser = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const failed = [];
page.on("console", (m) => console.log(`[console:${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`);
});

console.log("goto", URL_);
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);

const state = await page.evaluate(() => ({
  hasKg: typeof window.__kg !== "undefined",
  kgKeys: window.__kg ? Object.keys(window.__kg) : null,
  rootChildren: document.getElementById("root")?.children.length ?? -1,
  canvases: document.querySelectorAll("canvas").length,
  bodyText: (document.body.innerText || "").slice(0, 400),
  baseUrl: document.querySelector("script[type=module]")?.getAttribute("src"),
}));
console.log("\nSTATE:", JSON.stringify(state, null, 2));
console.log("\nFAILED REQUESTS:", failed.length);
for (const f of failed.slice(0, 25)) console.log("  " + f);
await browser.close();
