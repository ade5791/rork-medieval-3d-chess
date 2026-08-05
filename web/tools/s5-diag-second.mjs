// Why does the SECOND move fail to select?
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, playMove, settleCamera, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });

console.log("move 1:", JSON.stringify(await playMove(page, "e2", "e4")));

for (const t of [0, 1000, 2000, 3000, 5000, 7000]) {
  if (t) await sleep(t === 1000 ? 1000 : 1000 * (t > 3000 ? 2 : 1));
  const st = await page.evaluate(() => {
    const kg = window.__kg;
    const s = kg.controller.getSnapshot();
    const c = kg.combat();
    const p = kg.pickPointFor("e7");
    return {
      turn: s.turn, status: s.status, busy: s.busy, thinking: s.thinking,
      isHumanTurn: kg.controller.isHumanTurn(),
      phase: c.combatPhase, ply: c.ply,
      e7pick: { ok: p.ok, off: p.offset, x: Math.round(p.x), y: Math.round(p.y) },
      resolves: p.ok ? kg.pickAt(p.x, p.y).square : null,
      sel: kg.selection().selected,
    };
  });
  console.log(`t~${t}ms`, JSON.stringify(st));
}

// Now try the tap and watch what the engine picks at the exact moment.
await settleCamera(page);
const attempt = await page.evaluate(async () => {
  const kg = window.__kg;
  const p = kg.pickPointFor("e7");
  const before = kg.pickAt(p.x, p.y).square;
  const canvas = document.querySelector("canvas");
  const o = (buttons) => ({ bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons });
  canvas.dispatchEvent(new PointerEvent("pointerdown", o(1)));
  await new Promise((r) => setTimeout(r, 40));
  window.dispatchEvent(new PointerEvent("pointerup", o(0)));
  await new Promise((r) => setTimeout(r, 400));
  return { pickPoint: { x: Math.round(p.x), y: Math.round(p.y), ok: p.ok }, resolvedBefore: before, selAfter: kg.selection() };
});
console.log("manual tap on e7:", JSON.stringify(attempt));

// Compare with Playwright's real mouse at the same point.
const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e7"); return { x: p.x, y: p.y }; });
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();
await sleep(500);
console.log("real mouse on e7 -> sel:", JSON.stringify(await page.evaluate(() => window.__kg.selection())));

await browser.close();
