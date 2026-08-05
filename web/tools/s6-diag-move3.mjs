/**
 * Third pass on J7. The handler source shows a tap is ignored unless
 * status==="playing" AND isHumanTurn(). In the previous run the board was still
 * "idle" when the first tap landed, so the tap was correctly discarded.
 *
 * This run waits for the game to be genuinely playable first, then taps using
 * the engine's own verified pick point. That isolates the real question: does a
 * correctly-timed, correctly-aimed tap move a piece on the publish bytes?
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-3d-chess";
const browser = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__kg && window.__kg.controller, null, { timeout: 90000 });

await page.mouse.click(800, 450);
await page.waitForTimeout(800);

const hotseat = page.getByRole("button", { name: /hotseat|two player|pass|friend/i }).first();
if (await hotseat.count()) {
  await hotseat.click().catch(() => {});
  console.log("clicked hotseat");
}
await page.waitForTimeout(400);
const start = page.getByRole("button", { name: /take the field|start|play/i }).first();
if (await start.count()) {
  await start.click().catch(() => {});
  console.log("clicked start");
}

const playable = await page
  .waitForFunction(
    () => {
      const c = window.__kg.controller;
      return c.getSnapshot().status === "playing" && c.isHumanTurn && c.isHumanTurn();
    },
    null,
    { timeout: 45000 },
  )
  .then(() => true)
  .catch(() => false);
console.log("reached playable + human turn:", playable);

// Give the intro/camera settle time so `interactive` is true.
await page.waitForTimeout(4000);

const read = () =>
  page.evaluate(() => {
    const s = window.__kg.controller.getSnapshot();
    return {
      status: s.status,
      turn: s.turn,
      moves: s.moves.length,
      human: window.__kg.controller.isHumanTurn ? window.__kg.controller.isHumanTurn() : "n/a",
      sel: window.__kg.selection?.(),
    };
  });
console.log("PRE :", JSON.stringify(await read()));

async function tapVerified(square, label) {
  const pt = await page.evaluate((sq) => window.__kg.pickPointFor(sq), square);
  console.log(`  ${label} ${square} -> ${JSON.stringify(pt)}`);
  if (!pt || pt.ok === false) return;
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(70);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  console.log(`  after ${label}: ${JSON.stringify(await read())}`);
}

await tapVerified("e2", "SELECT");
await tapVerified("e4", "DEST  ");

const post = await page.evaluate(() => {
  const s = window.__kg.controller.getSnapshot();
  return { moves: s.moves.length, turn: s.turn, last: s.lastMove, fen: s.fen.split(" ")[0] };
});
console.log("POST:", JSON.stringify(post));
console.log(post.moves >= 1 ? "RESULT: MOVE WORKED -> J7 was a harness timing/aim bug" : "RESULT: NO MOVE -> product defect");
await browser.close();
