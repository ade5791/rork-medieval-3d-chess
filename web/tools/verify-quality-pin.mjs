// Behavioral gate for the user-quality-pin fix, driven through the REAL UI.
//
// 1. Boot the staged build (no ?quality param, guard armed), reach the menu.
// 2. Open Settings via the real button, click the Ultra chip.
//    Assert: guard reports userPin=true, preset=ultra, panel shows the lock note.
// 3. Force the low-FPS condition (fill the sample window with 20fps, advance
//    the clock past warm-up and rate limit) and tick sampleFps.
//    Assert: preset STAYS ultra - the pin held.
// 4. Click "Reset to auto", force the same condition again.
//    Assert: preset steps DOWN - proving the guard is still live in auto mode
//    and that the forcing method actually exercises the step-down path.
// 5. Assert zero console errors throughout.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.PIN_BASE ?? "http://127.0.0.1:8199/kings-gambit-medieval-chess/";
const OUT = process.env.PIN_OUT ?? "tools/out/quality-pin-verify.json";

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail: detail ?? null });
  console.log((pass ? "PASS " : "FAIL ") + name + (detail ? " :: " + JSON.stringify(detail) : ""));
}

// Forces the exact precondition sampleFps steps down under: >=100 samples of
// 20fps, elapsed past the 8s warm-up, rate limiter expired, report window open.
const FORCE_LOW_FPS = `(() => {
  const eng = window.__kg.__engine;
  eng.fpsSamples = new Array(120).fill(20);
  eng.elapsed = (eng.elapsed ?? 0) + 100;
  eng.lastQualityStepAt = -1e9;
  eng.lastFpsReport = 0;
  eng.sampleFps(1 / 20);
  return window.__kg.qualityGuard();
})()`;

const errors = [];
const browser = await chromium.launch({ args: ["--use-angle=default"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  // ?probe=1 only installs the read-only window.__kg surface; it does NOT set
  // pinQuality (that needs ?quality= or ?pinquality), so the guard stays armed.
  await page.goto(BASE + "?probe=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__kg), null, { timeout: 120000 });

  // Menu phase (intro may play first; the skip control is a full-screen button).
  await page
    .getByText("CLICK TO SKIP", { exact: true })
    .click({ timeout: 20000 })
    .catch(() => {});
  const settingsBtn = page.getByRole("button", { name: /settings/i }).first();
  await settingsBtn.waitFor({ state: "visible", timeout: 60000 });

  const boot = await page.evaluate("window.__kg.qualityGuard()");
  check("boot: guard unpinned", boot.userPin === false && boot.reviewPin === false, boot);

  // --- 2. Real UI: open Settings, click Ultra -------------------------------
  await settingsBtn.click();
  const ultraChip = page.getByRole("button", { name: "Ultra", exact: true });
  await ultraChip.waitFor({ state: "visible", timeout: 10000 });
  await ultraChip.click();
  await page.waitForTimeout(300); // React effect flushes engine.setUserQualityPin

  const pinned = await page.evaluate("window.__kg.qualityGuard()");
  check("pick ultra: preset applied", pinned.preset === "ultra", pinned);
  check("pick ultra: user pin set", pinned.userPin === true, pinned);
  const lockNote = await page.getByText(/Locked to your choice/).isVisible().catch(() => false);
  check("panel shows lock note + reset control", lockNote);

  // --- 3. Forced 20fps with the pin held ------------------------------------
  const afterPinnedForce = await page.evaluate(FORCE_LOW_FPS);
  check(
    "20fps while pinned: preset held at ultra",
    afterPinnedForce.preset === "ultra" && afterPinnedForce.autoAdjusted === false,
    afterPinnedForce,
  );

  // --- 4. Control: reset to auto, same force, must step down ----------------
  await page.getByRole("button", { name: "Reset to auto" }).click();
  await page.waitForTimeout(300);
  const unpinned = await page.evaluate("window.__kg.qualityGuard()");
  check("reset to auto: pin released", unpinned.userPin === false, unpinned);

  // Auto reset returns to the detected preset; force from whatever that is.
  const before = unpinned.preset;
  const afterAutoForce = await page.evaluate(FORCE_LOW_FPS);
  const order = ["low", "medium", "high", "ultra"];
  const stepped =
    before === "low"
      ? afterAutoForce.preset === "low" // nothing below low; guard marks autoAdjusted
      : order.indexOf(afterAutoForce.preset) === order.indexOf(before) - 1;
  check(
    "20fps in auto mode: guard stepped down (control)",
    stepped && afterAutoForce.autoAdjusted === true,
    { before, after: afterAutoForce },
  );

  check("zero console errors", errors.length === 0, errors.slice(0, 5));
} finally {
  await browser.close();
}

const passed = checks.filter((c) => c.pass).length;
const result = { base: BASE, passed, total: checks.length, checks, errors };
fs.mkdirSync("tools/out", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`${passed}/${checks.length} checks passed -> ${OUT}`);
process.exit(passed === checks.length ? 0 : 1);
