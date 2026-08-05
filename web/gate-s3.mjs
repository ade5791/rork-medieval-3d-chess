// S3 combat gate: runs every deterministic review state in a real browser and
// asserts the claims unit tests cannot prove about the running app - exactly-once
// contact, watchdog release under a stalled render loop, and console health.
//
// Two traps this file exists to remember:
//  1. page.waitForFunction(fn, arg, options) - the SECOND positional arg is the
//     function argument, not the options. Passing {timeout} there silently kept
//     the 30s default and made every long asset load look like a combat failure.
//  2. The sculpts are ~70 cold GLB fetches from R2 (~60s cold). A persistent
//     browser profile caches them across scenarios so the gate measures combat,
//     not CDN latency.
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4173";
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
}

// Persistent profile => the GLB cache survives between scenarios.
const profile = mkdtempSync(join(tmpdir(), "kg-gate-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1280, height: 800 },
});

async function runScenario(scenario, { stallRaf = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const url = `${BASE}/?scenario=${scenario}&review=1&probe=1&quality=high&seed=s3gate`;
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => window.__kg?.controller && window.__kg?.combat, null, {
    timeout: 60_000,
    polling: 200,
  });
  // Wait for the staged board before timing anything.
  await page.waitForFunction(
    () => window.__kg.controller.getSnapshot().status === "playing",
    null,
    { timeout: 240_000, polling: 250 },
  );

  if (stallRaf) {
    // Let the staged capture land, then kill the render loop and drive a fresh
    // move. Every tween promise is stranded from here - the freeze condition.
    await page.waitForFunction(
      () => {
        const s = window.__kg.controller.getSnapshot();
        return s.sanList.length > 0 && !s.busy;
      },
      null,
      { timeout: 120_000, polling: 200 },
    );
    // snapshot.moves is the move list for the PREVIOUS position - using it here
    // fed tryMove an illegal move and made a passing watchdog look broken.
    // After Qxd7+ in the capture scenario, Qe7xd7 is a known-legal black reply.
    await page.evaluate(
      ([from, to]) => {
        window.__kgRaf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = () => 0;
        window.__kgStallBaseline = window.__kg.controller.getSnapshot().sanList.length;
        window.__kgStallAccepted = window.__kg.controller.tryMove(from, to);
      },
      ["e7", "d7"],
    );
  }

  const outcome = await page.evaluate(async () => {
    const started = performance.now();
    const need = (window.__kgStallBaseline ?? 0) + 1;
    let settled = false;
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const snap = window.__kg.controller.getSnapshot();
        if (snap.sanList.length >= need && !snap.busy) {
          settled = true;
          clearInterval(iv);
          resolve();
        } else if (performance.now() - started > 30_000) {
          clearInterval(iv);
          resolve();
        }
      }, 200);
    });
    if (window.__kgRaf) {
      window.requestAnimationFrame = window.__kgRaf;
      delete window.__kgRaf;
    }
    const snap = window.__kg.controller.getSnapshot();
    const combat = window.__kg.combat();
    return {
      accepted: await Promise.resolve(window.__kgStallAccepted ?? null),
      settled,
      elapsed: Math.round(performance.now() - started),
      busy: snap.busy,
      plies: snap.sanList.length,
      san: snap.sanList.slice(-1)[0] ?? null,
      captured: snap.captured.length,
      ...combat,
    };
  });

  await page.close();
  return { ...outcome, errors };
}

// ---- 1. every combat path resolves and releases the turn -------------------
for (const name of ["capture", "mate", "promote", "castle", "enpassant"]) {
  const r = await runScenario(name);
  record(
    `${name}: turn released, no frame errors`,
    r.settled && r.busy === false && r.frameErrors === 0 && r.errors.length === 0,
    `san=${r.san} plies=${r.plies} busy=${r.busy} in=${r.elapsed}ms frameErrors=${r.frameErrors} console=${r.errors.length}`,
  );
}

// ---- 2. exactly-once contact on the capture path ---------------------------
const cap = await runScenario("capture");
record(
  "capture: exactly one contact resolved",
  cap.contactsResolved === 1 && cap.captured === 1,
  `contactsResolved=${cap.contactsResolved} captured=${cap.captured}`,
);

// ---- 3. watchdog: turn releases with the render loop dead ------------------
const stalled = await runScenario("capture", { stallRaf: true });
record(
  "watchdog releases turn with render loop stalled",
  stalled.accepted !== false && stalled.settled && stalled.busy === false,
  `accepted=${stalled.accepted} released=${stalled.settled} busy=${stalled.busy} in=${stalled.elapsed}ms watchdogFires=${stalled.animationTimeouts} san=${stalled.san}`,
);
record(
  "watchdog path did not double-resolve contact",
  stalled.contactsResolved <= 1,
  `contactsResolved=${stalled.contactsResolved}`,
);

await context.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== S3 combat gate: ${results.length - failed}/${results.length} pass ===`);
process.exit(failed > 0 ? 1 : 0);
