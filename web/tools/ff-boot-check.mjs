// Deep Firefox boot check against the live URL: wait longer, dump body text,
// capture screenshot, track failed requests.
import { firefox } from "playwright";

const URL = process.env.TARGET_URL || "https://ade5791.github.io/kings-gambit-medieval-chess/";

const browser = await firefox.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const failed = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("requestfailed", (r) => failed.push(r.url().slice(0, 120) + " :: " + (r.failure()?.errorText || "")));
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(20000);
const state = await page.evaluate(() => ({
  bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 600),
  canvases: document.querySelectorAll("canvas").length,
  gateShown: (document.body.innerText || "").includes("The hall needs WebGL"),
}));
await page.screenshot({ path: "tools/out/ff-boot.png" });
console.log(JSON.stringify({ ...state, consoleErrors: errors.slice(0, 8), failedRequests: failed.slice(0, 8) }, null, 2));
await browser.close();
