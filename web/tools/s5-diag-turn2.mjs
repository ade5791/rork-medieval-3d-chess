// After white's move, why can't black select?
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

const st = await page.evaluate(() => {
  const kg = window.__kg;
  const e = kg.__engine;
  const s = kg.controller.getSnapshot();
  const p = kg.pickPointFor("e7");
  return {
    turn: s.turn, status: s.status, isHumanTurn: kg.controller.isHumanTurn(),
    interactive: e.interactive, introPlaying: e.introPlaying, attract: e.attract,
    showcase: e.showcase, tactical: e.tactical,
    pieceAtE7: kg.controller.pieceAt("e7"),
    legalE7: kg.controller.legalTargets("e7"),
    pick: { ok: p.ok, off: p.offset, x: Math.round(p.x), y: Math.round(p.y) },
    resolves: p.ok ? kg.pickAt(p.x, p.y).square : null,
  };
});
console.log("state before black tap:", JSON.stringify(st, null, 1));

// Instrument the pointer path.
await page.evaluate(() => {
  const e = window.__kg.__engine;
  window.__c = [];
  for (const n of ["select", "clearSelection", "selectWithTap", "rejectMove", "commitMove"]) {
    const o = e[n] ?? Object.getPrototypeOf(e)[n];
    if (typeof o !== "function") continue;
    e[n] = function (...a) {
      window.__c.push({ t: Math.round(performance.now()), n, a: a.map(String) });
      return o.apply(this, a);
    };
  }
});

const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e7"); return { x: p.x, y: p.y }; });
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();
await sleep(800);

console.log("calls during tap:", JSON.stringify(await page.evaluate(() => window.__c)));
console.log("selection:", JSON.stringify(await page.evaluate(() => window.__kg.selection())));
console.log("interactive now:", await page.evaluate(() => window.__kg.__engine.interactive));

await browser.close();
