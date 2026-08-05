// S4: worker + RAF teardown audit. Uses the SAME navigation the leak audit
// proved works (Showcase -> "Roll the showcase" -> button[title="New game"]).
// A previous draft used guessed labels, never entered a game, and reported a
// meaningless PASS - selector drift is the classic way a teardown audit lies.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const CYCLES = 5;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__workers = { created: 0, terminated: 0, live: new Set() };
  const Orig = window.Worker;
  window.Worker = class extends Orig {
    constructor(...args) {
      super(...args);
      window.__workers.created += 1;
      window.__workers.live.add(this);
      const t = this.terminate.bind(this);
      this.terminate = () => {
        window.__workers.terminated += 1;
        window.__workers.live.delete(this);
        return t();
      };
    }
  };
  window.__raf = { req: 0, cancel: 0 };
  const or = window.requestAnimationFrame.bind(window);
  const oc = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    window.__raf.req += 1;
    return or(cb);
  };
  window.cancelAnimationFrame = (h) => {
    window.__raf.cancel += 1;
    return oc(h);
  };
});

await page.goto(`${BASE}/?review=1&probe=1&quality=medium`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 180000 });
await page.waitForTimeout(3000);

const skip = page.getByRole("button", { name: /click to skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
await page.mouse.click(720, 450).catch(() => {});
await page.waitForTimeout(2500);

async function clickText(rx, timeout = 8000) {
  const el = page.getByRole("button", { name: rx }).first();
  await el.waitFor({ state: "visible", timeout });
  await el.click({ timeout });
}

async function enterGame() {
  try {
    await clickText(/^Showcase$/);
    await page.waitForTimeout(800);
    await clickText(/Roll the showcase/i);
    await page.waitForTimeout(5000);
    return true;
  } catch {
    return false;
  }
}

async function backToMenu() {
  for (const sel of ['button[title="New game"]', 'button[aria-label="New game"]']) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(800);
      const yes = page.getByRole("button", { name: /confirm|yes|leave|resign/i }).first();
      if (await yes.isVisible().catch(() => false)) await yes.click().catch(() => {});
      await page.waitForTimeout(1800);
      return true;
    }
  }
  return false;
}

const readW = () => page.evaluate(() => ({ created: window.__workers.created, terminated: window.__workers.terminated, live: window.__workers.live.size }));
console.log("baseline:", JSON.stringify(await readW()));

let clean = 0;
for (let i = 1; i <= CYCLES; i += 1) {
  const entered = await enterGame();
  const back = await backToMenu();
  if (entered && back) clean += 1;
  const w = await readW();
  console.log(`cycle ${i}: entered=${entered} back=${back} created=${w.created} terminated=${w.terminated} LIVE=${w.live}`);
}

console.log("idling 15000ms ...");
await page.waitForTimeout(15000);
const finalW = await readW();
const raf = await page.evaluate(() => ({ ...window.__raf }));
console.log(`\nfinal: created=${finalW.created} terminated=${finalW.terminated} LIVE=${finalW.live}`);
console.log(`raf requested=${raf.req} cancelled=${raf.cancel}`);
console.log(`routed cleanly: ${clean}/${CYCLES}`);
const leaked = finalW.created - finalW.terminated;
console.log(`VERDICT: ${clean === CYCLES ? (leaked <= 1 ? "PASS - " + leaked + " worker retained after " + CYCLES + " cycles" : "FAIL - " + leaked + " workers leaked") : "INCONCLUSIVE - navigation did not complete"}`);

await ctx.close();
await browser.close();
