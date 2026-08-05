// Trace the verified-tap path on black's turn step by step.
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, playMove, settleCamera, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });
console.log("move1:", JSON.stringify(await playMove(page, "e2", "e4")));

const settled = await settleCamera(page);
console.log("settled:", settled);

for (let i = 0; i < 6; i += 1) {
  const pt = await page.evaluate(() => window.__kg.pickPointFor("e7"));
  await page.mouse.move(pt.x, pt.y);
  const still = await page.evaluate((p) => window.__kg.pickAt(p.x, p.y).square, { x: pt.x, y: pt.y });
  console.log(`attempt ${i}: pt=(${Math.round(pt.x)},${Math.round(pt.y)}) ok=${pt.ok} off=${pt.offset} stillResolves=${still}`);
  if (still !== "e7") { await sleep(200); continue; }
  await page.mouse.down();
  await sleep(30);
  await page.mouse.up();
  await sleep(400);
  const sel = await page.evaluate(() => window.__kg.selection());
  console.log("  -> selection:", JSON.stringify(sel));
  if (sel.selected === "e7") break;
}

// If selection still fails, check whether the piece map key even exists.
const diag = await page.evaluate(() => {
  const kg = window.__kg;
  const e = kg.__engine;
  const keys = [];
  for (const [sq, v] of e.pieces) keys.push(sq + ":" + v.color + v.kind);
  return {
    turn: kg.controller.getSnapshot().turn,
    isHumanTurn: kg.controller.isHumanTurn(),
    hasE7InMap: e.pieces.has("e7"),
    e7Color: e.pieces.get("e7") ? e.pieces.get("e7").color : null,
    mapSize: e.pieces.size,
    sample: keys.slice(0, 8),
  };
});
console.log("engine piece map:", JSON.stringify(diag, null, 1));

await browser.close();
