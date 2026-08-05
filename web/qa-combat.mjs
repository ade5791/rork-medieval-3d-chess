// S3 combat gate: drives every scenario in a real browser and asserts the turn
// loop actually releases. A passing unit test proves the machine is correct;
// this proves the shipped game does not freeze.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";

const SCENARIOS = [
  ["capture", "queen captures - longest beat, the freeze repro"],
  ["mate", "checkmate resolves during the animation"],
  ["promote", "promotion by capture"],
  ["castle", "castling - two figures, one event"],
  ["enpassant", "en passant - victim square != destination"],
];

const results = [];
let failures = 0;

const browser = await chromium.launch();

for (const [scenario, note] of SCENARIOS) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const url = `${BASE}/?scenario=${scenario}&review=1&probe=1&quality=high&seed=s3gate`;
  let verdict = "PASS";
  let detail = "";

  try {
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    // Wait for the staged move to be applied and the animation to release the
    // turn. `busy` going false again is the exact signal that the turn loop
    // recovered - which is what the queen-freeze bug broke.
    const outcome = await page.waitForFunction(
      () => {
        const kg = window.__kg;
        if (!kg?.controller) return null;
        const snap = kg.controller.getSnapshot();
        if (snap.sanList.length === 0) return null;
        if (snap.busy) return null;
        return {
          san: snap.sanList[snap.sanList.length - 1] ?? null,
          plies: snap.sanList.length,
          status: snap.status,
          fen: snap.fen,
          captured: snap.captured.length,
          timeouts: kg.controller.getAnimationTimeouts?.() ?? -1,
        };
      },
      { timeout: 30_000, polling: 250 },
    );
    const data = await outcome.jsonValue();
    detail = `san=${data.san} plies=${data.plies} status=${data.status} captured=${data.captured} animTimeouts=${data.timeouts}`;
    if (data.timeouts > 0) {
      verdict = "FAIL";
      detail += " (watchdog fired - animation stalled)";
    }
    if (errors.length > 0) {
      verdict = "FAIL";
      detail += ` errors=${JSON.stringify(errors.slice(0, 2))}`;
    }
  } catch (error) {
    verdict = "FAIL";
    detail = `turn never released: ${String(error).split("\n")[0]}`;
  }

  if (verdict === "FAIL") failures += 1;
  results.push({ scenario, note, verdict, detail });
  console.log(`${verdict}  ${scenario.padEnd(10)} ${detail}`);
  await context.close();
}

await browser.close();

console.log(`\n=== S3 combat gate: ${results.length - failures}/${results.length} pass ===`);
process.exit(failures > 0 ? 1 : 0);
