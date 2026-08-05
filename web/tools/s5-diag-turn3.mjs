// Observe pointerDownAt across the down/up pair on black's turn.
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, playMove, settleCamera, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });
console.log("move1:", JSON.stringify(await playMove(page, "e2", "e4")));
await settleCamera(page);
await sleep(1500);

await page.evaluate(() => {
  window.__ev = [];
  const c = document.querySelector("canvas");
  const log = (tag) => (e) => {
    window.__ev.push({
      t: Math.round(performance.now()), tag,
      x: Math.round(e.clientX), y: Math.round(e.clientY),
      btn: e.button, buttons: e.buttons, type: e.pointerType,
      downAt: window.__kg.__engine.pointerDownAt
        ? { x: Math.round(window.__kg.__engine.pointerDownAt.x), y: Math.round(window.__kg.__engine.pointerDownAt.y), sq: window.__kg.__engine.pointerDownAt.square }
        : null,
      interactive: window.__kg.__engine.interactive,
    });
  };
  c.addEventListener("pointerdown", log("canvas-down"), true);
  window.addEventListener("pointerup", log("win-up"), true);
  c.addEventListener("pointerdown", log("canvas-down-AFTER"), false);
  window.addEventListener("pointerup", log("win-up-AFTER"), false);
});

const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e7"); return { x: p.x, y: p.y }; });
console.log("tap point:", JSON.stringify({ x: Math.round(pt.x), y: Math.round(pt.y) }));
await page.mouse.move(pt.x, pt.y);
await sleep(60);
await page.mouse.down();
await sleep(60);
await page.mouse.up();
await sleep(600);

console.log("events:", JSON.stringify(await page.evaluate(() => window.__ev), null, 1));
console.log("selection:", JSON.stringify(await page.evaluate(() => window.__kg.selection())));

await browser.close();
