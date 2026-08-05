// Focused diagnostic: why does tap-select then tap-destination not play a move?
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => console.log("  [console:" + m.type() + "]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90_000 });
console.log("probe live");

await page.locator("text=CLICK TO SKIP").first().click({ timeout: 20_000 }).catch(() => console.log("no intro skip"));
await page.getByRole("button", { name: /Take the field/i }).first().waitFor({ state: "visible", timeout: 30_000 });
await page.getByRole("button", { name: /2 Players/i }).first().click();
await page.getByRole("button", { name: /Take the field/i }).first().click();
await page.waitForFunction(() => window.__kg.controller.getSnapshot().status === "playing", null, { timeout: 30_000 });
console.log("match started");

// Let the camera settle fully before projecting anything.
for (const wait of [1000, 2000, 3000, 4000]) {
  await sleep(wait === 1000 ? 1000 : 1000);
  const p = await page.evaluate(() => {
    const s = window.__kg.squareScreen("e2");
    return { x: Math.round(s.x), y: Math.round(s.y), onScreen: s.onScreen };
  });
  console.log(`  t=${wait}ms e2 -> ${JSON.stringify(p)}`);
}

const interactive = await page.evaluate(() => {
  const kg = window.__kg;
  return {
    sel: kg.selection(),
    snap: (() => {
      const s = kg.controller.getSnapshot();
      return { status: s.status, turn: s.turn, mode: s.mode, busy: s.busy, thinking: s.thinking };
    })(),
    isHumanTurn: kg.controller.isHumanTurn(),
    legalFromE2: kg.controller.legalTargets("e2"),
    pieceAtE2: kg.controller.pieceAt("e2"),
  };
});
console.log("pre-tap state:", JSON.stringify(interactive, null, 2));

const e2 = await page.evaluate(() => {
  const s = window.__kg.squareScreen("e2");
  return { x: s.x, y: s.y };
});
console.log("tapping e2 at", e2);
await page.mouse.click(e2.x, e2.y);
await sleep(600);
const afterSelect = await page.evaluate(() => window.__kg.selection());
console.log("after tap e2, selection =", JSON.stringify(afterSelect));

const e4 = await page.evaluate(() => {
  const s = window.__kg.squareScreen("e4");
  return { x: s.x, y: s.y };
});
console.log("tapping e4 at", e4);
await page.mouse.click(e4.x, e4.y);
await sleep(2500);
const after = await page.evaluate(() => {
  const s = window.__kg.controller.getSnapshot();
  return { moves: s.moves.length, fen: s.fen, last: s.lastMove, sel: window.__kg.selection() };
});
console.log("after tap e4:", JSON.stringify(after, null, 2));

// Canvas geometry sanity - is the canvas actually where we think it is?
const geo = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio, iw: window.innerWidth, ih: window.innerHeight };
});
console.log("canvas geometry:", JSON.stringify(geo));

// What does the engine itself pick at that screen point?
const picked = await page.evaluate(
  ({ pt }) => {
    const c = document.querySelector("canvas");
    const ev = new PointerEvent("pointermove", { clientX: pt.x, clientY: pt.y, bubbles: true, pointerId: 1, pointerType: "mouse" });
    c.dispatchEvent(ev);
    return { hover: "dispatched" };
  },
  { pt: e2 },
);
console.log("hover dispatch:", JSON.stringify(picked));

await browser.close();
