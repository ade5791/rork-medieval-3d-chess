// After selecting e2, what does the engine pick at the e4 point?
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, tapSquare, settleCamera, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });

const beforeSel = await page.evaluate(() => {
  const p = window.__kg.pickPointFor("e4");
  return { pt: { x: Math.round(p.x), y: Math.round(p.y), ok: p.ok }, resolves: window.__kg.pickAt(p.x, p.y).square };
});
console.log("BEFORE select, e4 point:", JSON.stringify(beforeSel));

await tapSquare(page, "e2");
console.log("selection:", JSON.stringify(await page.evaluate(() => window.__kg.selection())));

for (const t of [100, 400, 900, 1600]) {
  await sleep(t === 100 ? 100 : 400);
  const after = await page.evaluate(() => {
    const kg = window.__kg;
    const p = kg.pickPointFor("e4");
    // Also probe the ORIGINAL pre-selection point.
    return {
      freshPoint: { x: Math.round(p.x), y: Math.round(p.y), ok: p.ok, off: p.offset },
      freshResolves: p.ok ? kg.pickAt(p.x, p.y).square : null,
      sel: kg.selection().selected,
    };
  });
  console.log(`AFTER select +${t}ms:`, JSON.stringify(after));
}

const stalePoint = beforeSel.pt;
const staleResolves = await page.evaluate((pt) => window.__kg.pickAt(pt.x, pt.y).square, stalePoint);
console.log("stale (pre-select) e4 point now resolves to:", staleResolves);

// Tap using a FRESHLY computed point and see whether the move commits.
await settleCamera(page);
const fresh = await page.evaluate(() => { const p = window.__kg.pickPointFor("e4"); return { x: p.x, y: p.y, ok: p.ok }; });
console.log("tapping fresh e4 point:", JSON.stringify({ x: Math.round(fresh.x), y: Math.round(fresh.y) }));
await page.mouse.move(fresh.x, fresh.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();
await sleep(2500);
console.log("result FEN:", await page.evaluate(() => window.__kg.controller.getSnapshot().fen));

await browser.close();
