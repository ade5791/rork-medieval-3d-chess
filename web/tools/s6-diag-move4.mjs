/**
 * Reproduces the QA harness's EXACT start sequence (2 Players -> Take the field),
 * which J5 proves works, then compares the two aiming strategies head to head:
 *
 *   A. squareScreen  - raw projected tile centre (what s5-qa.mjs J7 uses)
 *   B. pickPointFor  - engine-verified pick point (what s5-lib.mjs uses)
 *
 * Whichever moves the piece tells us whether J7 is a product defect or an
 * aiming defect in the harness.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8155/kings-gambit-medieval-3d-chess";
const MODE = process.argv[3] || "pick"; // "pick" | "screen"

const browser = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__kg && window.__kg.controller, null, { timeout: 90000 });
await page.mouse.click(800, 450);
await page.waitForTimeout(800);

const hotseat = page.getByRole("button", { name: /2 Players/i }).first();
if (await hotseat.isVisible().catch(() => false)) {
  await hotseat.click();
  console.log("clicked '2 Players'");
}
await page.waitForTimeout(300);
await page.getByRole("button", { name: /Take the field/i }).first().click();
await page.waitForFunction(
  () => window.__kg && window.__kg.controller.getSnapshot().status === "playing",
  null,
  { timeout: 30000 },
);
console.log("match started");
await page.waitForTimeout(3000);

const read = () =>
  page.evaluate(() => {
    const s = window.__kg.controller.getSnapshot();
    return {
      status: s.status,
      mode: s.mode,
      turn: s.turn,
      moves: s.moves.length,
      human: window.__kg.controller.isHumanTurn?.() ?? "n/a",
      sel: window.__kg.selection?.(),
    };
  });
console.log("PRE :", JSON.stringify(await read()));

async function aim(square) {
  return page.evaluate(
    ([sq, mode]) => (mode === "pick" ? window.__kg.pickPointFor(sq) : window.__kg.squareScreen(sq)),
    [square, MODE],
  );
}

async function tap(square, label) {
  const pt = await aim(square);
  const picked = await page.evaluate((p) => (p ? window.__kg.pickAt(p.x, p.y) : null), pt);
  console.log(`  ${label} ${square} pt=${JSON.stringify(pt)} engineSees=${JSON.stringify(picked)}`);
  if (!pt) return;
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(70);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  console.log(`  after ${label}: ${JSON.stringify(await read())}`);
}

console.log(`--- aiming mode: ${MODE} ---`);
await tap("e2", "SELECT");
await tap("e4", "DEST  ");

const post = await page.evaluate(() => {
  const s = window.__kg.controller.getSnapshot();
  return { moves: s.moves.length, turn: s.turn, last: s.lastMove, fen: s.fen.split(" ")[0] };
});
console.log("POST:", JSON.stringify(post));
console.log(post.moves >= 1 ? `RESULT[${MODE}]: MOVE WORKED` : `RESULT[${MODE}]: NO MOVE`);
await browser.close();
