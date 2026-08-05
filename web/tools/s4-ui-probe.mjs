// S4: find out what the UI actually renders, instead of guessing selectors.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));

await page.goto(`${BASE}/?probe=1&quality=high&seed=s4-ui`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(4000);

async function dump(label) {
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim().slice(0, 30),
      title: b.getAttribute("title"),
      aria: b.getAttribute("aria-label"),
      vis: !!(b.offsetWidth || b.offsetHeight),
    }));
    return { domNodes: document.querySelectorAll("*").length, buttons: btns };
  });
  console.log(`\n--- ${label} --- domNodes=${info.domNodes} buttons=${info.buttons.length}`);
  for (const b of info.buttons) {
    console.log(`   [${b.vis ? "v" : " "}] text="${b.text}" title="${b.title ?? ""}" aria="${b.aria ?? ""}"`);
  }
  return info;
}

await dump("initial");
await page.keyboard.press("Escape").catch(() => {});
await page.mouse.click(720, 450).catch(() => {});
await page.waitForTimeout(2500);
await dump("after dismiss");

await ctx.close();
await browser.close();
