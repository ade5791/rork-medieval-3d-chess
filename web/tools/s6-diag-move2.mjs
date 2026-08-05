/**
 * Confirms the J7 diagnosis: tap-to-move works when the tap uses the engine's
 * OWN verified pick point (pickPointFor) instead of the raw projected tile
 * centre (squareScreen), which life-size figures occlude.
 *
 * If this passes, J7 was a harness defect, not a product defect - and the fix
 * belongs in tools/s5-qa.mjs, not in the game.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-3d-chess";
const browser = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__kg && window.__kg.controller, null, { timeout: 90000 });
await page.mouse.click(800, 450);
await page.waitForTimeout(700);
const hotseat = page.getByRole("button", { name: /hotseat|two player|pass|friend/i }).first();
if (await hotseat.count()) await hotseat.click().catch(() => {});
await page.waitForTimeout(300);
const start = page.getByRole("button", { name: /take the field|start|play/i }).first();
if (await start.count()) await start.click().catch(() => {});
await page
  .waitForFunction(() => window.__kg.controller.getSnapshot().status === "playing", null, { timeout: 30000 })
  .catch(() => {});
await page.waitForTimeout(2500);

const read = () =>
  page.evaluate(() => {
    const s = window.__kg.controller.getSnapshot();
    return { status: s.status, turn: s.turn, moves: s.moves.length, sel: window.__kg.selection?.() };
  });

async function tapVerified(square, label) {
  const pt = await page.evaluate((sq) => window.__kg.pickPointFor(sq), square);
  console.log(`  ${label} ${square} pickPointFor -> ${JSON.stringify(pt)}`);
  if (!pt || pt.ok === false) return false;
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(70);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  console.log(`  after ${label}: ${JSON.stringify(await read())}`);
  return true;
}

console.log("PRE :", JSON.stringify(await read()));
await tapVerified("e2", "SELECT");
await tapVerified("e4", "DEST  ");
const post = await page.evaluate(() => {
  const s = window.__kg.controller.getSnapshot();
  return { moves: s.moves.length, turn: s.turn, pgn: s.pgn, last: s.lastMove, fen: s.fen.split(" ")[0] };
});
console.log("POST:", JSON.stringify(post));
console.log(post.moves >= 1 ? "RESULT: MOVE WORKED -> harness bug" : "RESULT: STILL NO MOVE -> product defect");
await browser.close();
