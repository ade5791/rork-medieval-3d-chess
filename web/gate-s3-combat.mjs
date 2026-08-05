/**
 * S3 combat gate.
 *
 * Drives every combat review state in a real browser and asserts, from the live
 * engine probe, that:
 *   - the beat actually ran (contact resolved),
 *   - each capture resolved EXACTLY once,
 *   - the turn loop released (busy === false) - the queen-freeze check,
 *   - no watchdog had to fire,
 *   - no frame threw.
 *
 * This is the evidence tier above unit tests: the state machine is proven in
 * isolation by vitest, and proven in the running game here.
 */

import { chromium } from "playwright";

const BASE = process.env.GATE_BASE ?? "http://127.0.0.1:4173";
const SCENARIOS = ["capture", "mate", "promote", "castle", "enpassant"];
const SETTLE_MS = 26_000;

function line(pass, label, detail) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

const results = [];

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const scenario of SCENARIOS) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") errors.push(t);
    if (t.includes("duplicate capture suppressed")) errors.push(`DUPLICATE: ${t}`);
    if (t.includes("exceeded its budget")) errors.push(`BEATTIMEOUT: ${t}`);
    if (t.includes("releasing the turn")) errors.push(`TURNTIMEOUT: ${t}`);
  });

  const url = `${BASE}/?scenario=${scenario}&review=1&probe=1&quality=high&seed=s3gate`;
  let probe = null;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__kg), null, { timeout: 60_000 });

    // Wait until the turn loop has released AND the board is idle, or time out.
    await page
      .waitForFunction(
        () => {
          const kg = window.__kg;
          if (!kg) return false;
          const snap = kg.controller.getSnapshot();
          const combat = kg.combat();
          return combat.ply > 0 && snap.busy === false;
        },
        null,
        { timeout: SETTLE_MS },
      )
      .catch(() => {});

    probe = await page.evaluate(() => {
      const kg = window.__kg;
      const snap = kg.controller.getSnapshot();
      const combat = kg.combat();
      return {
        ply: combat.ply,
        contactsResolved: combat.contactsResolved,
        combatPhase: combat.combatPhase,
        beatTimeouts: combat.beatTimeouts,
        animationTimeouts: combat.animationTimeouts,
        frameErrors: combat.frameErrors,
        busy: snap.busy,
        status: snap.status,
        fen: snap.fen,
        sanList: snap.sanList,
        captured: snap.captured.length,
      };
    });
  } catch (e) {
    errors.push(`HARNESS: ${String(e)}`);
  }

  const expectCapture = scenario !== "castle";
  const checks = [];
  if (!probe) {
    checks.push([false, `${scenario}: probe unavailable`, ""]);
  } else {
    checks.push([probe.ply >= 1, `${scenario}: the staged move was animated`, `ply=${probe.ply}`]);
    checks.push([
      probe.busy === false,
      `${scenario}: turn loop released (queen-freeze check)`,
      `busy=${probe.busy} status=${probe.status}`,
    ]);
    checks.push([
      probe.beatTimeouts === 0,
      `${scenario}: no beat hit its watchdog`,
      `beatTimeouts=${probe.beatTimeouts}`,
    ]);
    checks.push([
      probe.animationTimeouts === 0,
      `${scenario}: no turn hit the animator watchdog`,
      `animationTimeouts=${probe.animationTimeouts}`,
    ]);
    checks.push([probe.frameErrors === 0, `${scenario}: no frame threw`, `frameErrors=${probe.frameErrors}`]);
    checks.push([
      probe.combatPhase === "done",
      `${scenario}: beat ended in a terminal phase`,
      `phase=${probe.combatPhase}`,
    ]);
    if (expectCapture) {
      checks.push([
        probe.contactsResolved === 1,
        `${scenario}: capture resolved exactly once`,
        `contactsResolved=${probe.contactsResolved}`,
      ]);
      checks.push([probe.captured === 1, `${scenario}: exactly one piece in the tray`, `captured=${probe.captured}`]);
    } else {
      checks.push([
        probe.contactsResolved === 0,
        `${scenario}: no contact resolved on a quiet move`,
        `contactsResolved=${probe.contactsResolved}`,
      ]);
    }
  }
  checks.push([errors.length === 0, `${scenario}: clean console`, errors.slice(0, 2).join(" | ")]);

  for (const [pass, label, detail] of checks) {
    line(pass, label, detail);
    results.push(pass);
  }
  if (probe) console.log(`      san=${JSON.stringify(probe.sanList)}`);

  await context.close();
}

await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\nS3 COMBAT GATE: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
