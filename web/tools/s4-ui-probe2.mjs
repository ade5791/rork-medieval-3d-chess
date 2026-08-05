// S4: dump the Showcase tab's controls, and the in-game HUD controls.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(`${BASE}/?probe=1&quality=high&seed=s4-ui2`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const skip = page.getByRole("button", { name: /click to skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
await page.waitForTimeout(2500);

async function dump(label) {
  const info = await page.evaluate(() => ({
    domNodes: document.querySelectorAll("*").length,
    buttons: [...document.querySelectorAll("button")]
      .filter((b) => b.offsetWidth || b.offsetHeight)
      .map((b) => `text="${(b.textContent || "").trim().slice(0, 26)}" title="${b.getAttribute("title") ?? ""}"`),
  }));
  console.log(`\n--- ${label} --- dom=${info.domNodes}`);
  info.buttons.forEach((b) => console.log("   " + b));
}

await dump("menu / Computer tab");

await page.getByRole("button", { name: /^Showcase$/ }).first().click();
await page.waitForTimeout(1200);
await dump("menu / Showcase tab");

// Start via the Computer tab, which we know has "Take the field".
await page.getByRole("button", { name: /^Computer$/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Take the field/i }).first().click();
await page.waitForTimeout(6000);
await dump("IN GAME");

await ctx.close();
await browser.close();
