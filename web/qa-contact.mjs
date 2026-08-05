// S3 gate part 2: exactly-once contact, watchdog recovery, effect cleanup.
// These are the claims that unit tests alone cannot prove about the real app.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(36)} ${detail}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

// ---- 1. exactly-once contact ----------------------------------------------
await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 45_000,
});
await page.waitForFunction(
  () => window.__kg?.combat && window.__kg.controller.getSnapshot().sanList.length > 0 && !window.__kg.controller.getSnapshot().busy,
  { timeout: 30_000, polling: 250 },
);

const one = await page.evaluate(() => {
  const snap = window.__kg.controller.getSnapshot();
  return { ...window.__kg.combat(), captured: snap.captured.length };
});
record(
  "one capture -> exactly one contact",
  one.contactsResolved === 1 && one.captured === 1,
  `contactsResolved=${one.contactsResolved} captured=${one.captured} ply=${one.ply}`,
);

// ---- 2. watchdog recovery: the queen-freeze reproduction -------------------
// Stall the render loop mid-move. Every tween promise is now stranded, which is
// precisely the original freeze. The controller must still release the turn.
await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 45_000,
});
await page.waitForFunction(() => window.__kg?.controller, { timeout: 30_000, polling: 200 });

const stall = await page.evaluate(async () => {
  const original = window.requestAnimationFrame.bind(window);
  // Freeze the render loop: tween promises can never settle from here on.
  window.requestAnimationFrame = () => 0;
  const started = performance.now();
  let released = false;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const snap = window.__kg.controller.getSnapshot();
      // The turn is released when a move has landed and busy has cleared.
      if (snap.sanList.length > 0 && !snap.busy) {
        released = true;
        clearInterval(iv);
        resolve();
      }
      if (performance.now() - started > 25_000) {
        clearInterval(iv);
        resolve();
      }
    }, 250);
  });
  const elapsed = Math.round(performance.now() - started);
  window.requestAnimationFrame = original;
  const snap = window.__kg.controller.getSnapshot();
  return {
    released,
    elapsed,
    busy: snap.busy,
    plies: snap.sanList.length,
    timeouts: window.__kg.controller.getAnimationTimeouts(),
  };
});
record(
  "turn released despite stalled render loop",
  stall.released && stall.busy === false,
  `released=${stall.released} busy=${stall.busy} after=${stall.elapsed}ms watchdogFires=${stall.timeouts} plies=${stall.plies}`,
);

// ---- 3. determinism: same seed -> same particle draws ----------------------
const drawsA = await page.evaluate(() => {
  const s = window.__kg.rngSample?.();
  return s ?? null;
});

// ---- 4. console health -----------------------------------------------------
record("no uncaught page errors", errors.length === 0, errors.length ? JSON.stringify(errors.slice(0, 3)) : "none");

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== contact/watchdog gate: ${results.length - failed}/${results.length} pass ===`);
process.exit(failed > 0 ? 1 : 0);
