/**
 * Is tap-to-move actually broken on the publish bytes, or is the harness
 * mis-driving it? J7 failed on all four surfaces, so this must be resolved with
 * direct evidence before anything is published.
 *
 * Uses the engine's own authoritative projection (squareScreen) and the real
 * controller API (getSnapshot).
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

await page.mouse.click(800, 450); // skip intro
await page.waitForTimeout(700);

const hotseat = page.getByRole("button", { name: /hotseat|two player|pass|friend/i }).first();
if (await hotseat.count()) await hotseat.click().catch(() => {});
await page.waitForTimeout(300);
const start = page.getByRole("button", { name: /take the field|start|play/i }).first();
if (await start.count()) await start.click().catch(() => {});

await page
  .waitForFunction(() => window.__kg.controller.getSnapshot().status === "playing", null, { timeout: 30000 })
  .catch(() => console.log("!! never reached status=playing"));
await page.waitForTimeout(2500);

const read = () =>
  page.evaluate(() => {
    const s = window.__kg.controller.getSnapshot();
    return {
      status: s.status,
      turn: s.turn,
      moves: s.moves.length,
      fen: s.fen.split(" ")[0],
      sel: window.__kg.selection ? window.__kg.selection() : null,
    };
  });

console.log("PRE :", JSON.stringify(await read()));

async function tap(square, label) {
  const pt = await page.evaluate((sq) => window.__kg.squareScreen(sq), square);
  console.log(`  ${label} ${square} -> ${JSON.stringify(pt)}`);
  if (!pt) return;
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  console.log(`  after ${label}: ${JSON.stringify(await read())}`);
}

await tap("e2", "SELECT");
await tap("e4", "DEST  ");

// Separate INPUT ROUTING from RULES: ask the engine what it picks at that point,
// and ask the controller to make the move directly.
const pick = await page.evaluate(() => {
  const p = window.__kg.squareScreen("e2");
  try {
    return window.__kg.pickAt ? window.__kg.pickAt(p.x, p.y) : "no pickAt";
  } catch (e) {
    return "threw: " + e.message;
  }
});
console.log("engine pickAt(e2) =", JSON.stringify(pick));

const direct = await page.evaluate(() => {
  try {
    const c = window.__kg.controller;
    const r = c.move ? c.move("e2", "e4") : "no move()";
    return { r: JSON.stringify(r), moves: c.getSnapshot().moves.length };
  } catch (e) {
    return "threw: " + e.message;
  }
});
console.log("controller.move('e2','e4') =", JSON.stringify(direct));
console.log("POST:", JSON.stringify(await read()));
await browser.close();
