// Who receives the pointer at the board? And does the engine's own handler fire?
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout: 90_000 });
await page.locator("text=CLICK TO SKIP").first().click({ timeout: 20_000 }).catch(() => {});
await page.getByRole("button", { name: /2 Players/i }).first().click();
await page.getByRole("button", { name: /Take the field/i }).first().click();
await page.waitForFunction(() => window.__kg.controller.getSnapshot().status === "playing", null, { timeout: 30_000 });
await sleep(3000);

const report = await page.evaluate(() => {
  const kg = window.__kg;
  const s = kg.squareScreen("e2");
  const el = document.elementFromPoint(s.x, s.y);
  const chain = [];
  let n = el;
  while (n && chain.length < 8) {
    const cs = getComputedStyle(n);
    chain.push({
      tag: n.tagName,
      cls: (n.className && n.className.toString().slice(0, 60)) || "",
      pointerEvents: cs.pointerEvents,
      zIndex: cs.zIndex,
      position: cs.position,
    });
    n = n.parentElement;
  }
  const canvas = document.querySelector("canvas");
  const ccs = getComputedStyle(canvas);
  return {
    point: { x: Math.round(s.x), y: Math.round(s.y) },
    topElementIsCanvas: el === canvas,
    chain,
    canvasStyle: { pointerEvents: ccs.pointerEvents, zIndex: ccs.zIndex, position: ccs.position, touchAction: ccs.touchAction },
  };
});
console.log(JSON.stringify(report, null, 2));

// Manually dispatch the exact pointer sequence the engine listens for, on the element the engine bound to.
const manual = await page.evaluate(async () => {
  const kg = window.__kg;
  const s = kg.squareScreen("e2");
  const canvas = document.querySelector("canvas");
  const opts = (type) => ({
    bubbles: true, cancelable: true, composed: true,
    clientX: s.x, clientY: s.y, pointerId: 1, pointerType: "mouse",
    isPrimary: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
  });
  canvas.dispatchEvent(new PointerEvent("pointerdown", opts("pointerdown")));
  await new Promise((r) => setTimeout(r, 30));
  canvas.dispatchEvent(new PointerEvent("pointerup", opts("pointerup")));
  await new Promise((r) => setTimeout(r, 400));
  return kg.selection();
});
console.log("manual dispatch on canvas ->", JSON.stringify(manual));

// Try dispatching on window instead, in case the engine binds there.
const manualWin = await page.evaluate(async () => {
  const kg = window.__kg;
  const s = kg.squareScreen("e2");
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: s.x, clientY: s.y, pointerId: 2, pointerType: "mouse", isPrimary: true, button: 0 };
  window.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
  await new Promise((r) => setTimeout(r, 30));
  window.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
  await new Promise((r) => setTimeout(r, 400));
  return kg.selection();
});
console.log("manual dispatch on window ->", JSON.stringify(manualWin));

await browser.close();
