/**
 * Era gate - proves each game mode loads, stands, and animates.
 *
 * DIFFERENTIAL BY DESIGN. "classic" is the untouched shipped content, so it is
 * the baseline: a new era passes when it matches classic's behaviour, not when
 * it hits an absolute number the headless software rasterizer cannot reach.
 * (Measured example: the authored capture beat exceeds its budget once under
 * SwiftShader in BOTH eras, including untouched classic - that is an artefact
 * of the harness, not a defect in the new content, and a differential gate says
 * so instead of reporting a phantom regression.)
 *
 * Per era this:
 *   1. boots the real production build with ?era=<id>
 *   2. waits for the factory to report ready
 *   3. asserts the engine staged that era and its battleground
 *   4. asserts every figure on the board carries a real skinned rig
 *      (a procedural fallback would still fill the board, so a piece count
 *       alone proves nothing about the era's own sculpts)
 *   5. asserts ROSTER PROVENANCE: every loaded sculpt resolved from
 *      /models/<era>/, and the era declares no missing kinds. This is the
 *      check that catches a half-dressed era - a classic FALLBACK figure is
 *      skinned too, so check 4 alone passes while medieval knights quietly
 *      stand in an Egyptian army.
 *   6. plays the staged capture and asserts the contact resolved exactly once
 *   7. samples the engine's own off-screen histogram - the canvas back buffer
 *      is undefined after compositing, so a canvas readback would read black
 *   8. fails on any console error or any >=400 response
 *
 * Scenario "capture" stages 30 pieces and plays one capture, so 29 figures
 * standing afterwards is the correct, asserted count.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.GATE_BASE ?? "http://127.0.0.1:4178";
const OUT = path.resolve(import.meta.dirname, "out", "era-gate");
const ERAS = (process.env.GATE_ERAS ?? "classic,rome,sengoku,egypt").split(",");
/** Pieces left standing after the staged capture resolves. */
const EXPECTED_PIECES = 29;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const results = [];

async function measure(era) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  const badRequests = [];

  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 220));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 220)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url().split("/").pop()}`);
  });

  const url = `${BASE}/?era=${era}&review=1&probe=1&quality=high&scenario=capture`;
  const row = { era, url };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page
      .waitForFunction(() => Boolean(window.__kg && window.__kg.ready && window.__kg.ready()), null, {
        timeout: 240000,
      })
      .catch(() => {});

    row.ready = await page.evaluate(() => Boolean(window.__kg && window.__kg.ready && window.__kg.ready()));
    const staged = await page.evaluate(() => ({
      era: window.__kg.era(),
      arena: window.__kg.arena(),
      preset: window.__kg.preset(),
    }));
    row.stagedEra = staged.era;
    row.stagedArena = staged.arena;
    row.preset = staged.preset;

    await page.waitForTimeout(9000);

    const census = await page.evaluate(() => window.__kg.roster());
    const prov = await page.evaluate(() => window.__kg.provenance());
    const combat = await page.evaluate(() => window.__kg.combat());
    const hist = await page.evaluate(() => {
      const h = window.__kg.histogram();
      return { mean: +h.mean.toFixed(4), p50: +h.p50.toFixed(4), blackPct: h.blackPct, whitePct: h.whitePct };
    });
    const info = await page.evaluate(() => window.__kg.info());

    Object.assign(row, {
      pieces: census.pieces,
      skinned: census.skinned,
      // Provenance: which sculpts really loaded, and from where.
      sculpted: prov.sculpted,
      missingKinds: prov.missing,
      rosterComplete: prov.complete,
      foreignSculpts: prov.foreign,
      sourceCount: Object.keys(prov.sources ?? {}).length,
      contactsResolved: combat.contactsResolved,
      beatTimeouts: combat.beatTimeouts,
      animationTimeouts: combat.animationTimeouts,
      frameErrors: combat.frameErrors,
      ply: combat.ply,
      mean: hist.mean,
      p50: hist.p50,
      blackPct: hist.blackPct,
      whitePct: hist.whitePct,
      triangles: info.triangles,
      errors: errors.slice(0, 6),
      badRequests: [...new Set(badRequests)].slice(0, 10),
    });

    await page.screenshot({ path: path.join(OUT, `${era}.png`) });
  } catch (error) {
    row.fatal = String(error).slice(0, 300);
  }
  await ctx.close();
  return row;
}

for (const era of ERAS) results.push(await measure(era));
await browser.close();

// ---------------------------------------------------------------- adjudicate
const baseline = results.find((r) => r.era === "classic");
let failures = 0;

for (const row of results) {
  const checks = [];
  const need = (label, ok, detail) => {
    checks.push({ label, ok, detail });
    if (!ok) failures += 1;
  };

  need("engine ready", row.ready === true, String(row.ready));
  need("staged requested era", row.stagedEra === row.era, `${row.stagedEra}`);
  need("board filled", row.pieces === EXPECTED_PIECES, `${row.pieces}/${EXPECTED_PIECES}`);
  // The real proof the era's own animated sculpts loaded.
  need("every figure rigged", row.skinned === row.pieces, `${row.skinned}/${row.pieces}`);
  // PROVENANCE: catches the half-dressed era that check 4 cannot see.
  need(
    "no foreign sculpts",
    (row.foreignSculpts ?? []).length === 0,
    (row.foreignSculpts ?? []).length ? (row.foreignSculpts ?? []).join(" ") : "all from this era",
  );
  need(
    "roster covers every kind",
    row.rosterComplete === true,
    (row.missingKinds ?? []).length ? `missing ${(row.missingKinds ?? []).join(",")}` : "k,q,b,n,r,p",
  );
  need("capture resolved once", row.contactsResolved === 1, String(row.contactsResolved));
  need("no animation timeouts", row.animationTimeouts === 0, String(row.animationTimeouts));
  need("no frame errors", row.frameErrors === 0, String(row.frameErrors));
  need("not a black screen", row.mean > 0.03 && row.blackPct < 90, `mean=${row.mean} black=${row.blackPct}%`);
  need("no console errors", (row.errors ?? []).length === 0, String((row.errors ?? []).length));
  need("no failed requests", (row.badRequests ?? []).length === 0, String((row.badRequests ?? []).length));

  // Differential: a new era may not be WORSE than the untouched baseline.
  if (baseline && row.era !== "classic") {
    need(
      "beat timeouts no worse than baseline",
      row.beatTimeouts <= baseline.beatTimeouts,
      `${row.beatTimeouts} vs baseline ${baseline.beatTimeouts}`,
    );
  }

  row.checks = checks;
  row.pass = checks.every((c) => c.ok);
  console.log(`\n=== ${row.era} (${row.stagedEra}/${row.stagedArena}, ${row.preset}) ===`);
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.label.padEnd(34)} ${c.detail}`);
  if (row.fatal) console.log(`  FATAL ${row.fatal}`);
  (row.errors ?? []).forEach((e) => console.log(`  console: ${e}`));
  (row.badRequests ?? []).forEach((e) => console.log(`  http: ${e}`));
  console.log(
    `  info: triangles=${row.triangles} luma p50=${row.p50} clipped=${row.whitePct}% ` +
      `beatTimeouts=${row.beatTimeouts} (baseline ${baseline?.beatTimeouts}) sculpts=${row.sourceCount}`,
  );
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} eras checked, ${failures} failed checks`);
process.exit(failures === 0 ? 0 : 1);
