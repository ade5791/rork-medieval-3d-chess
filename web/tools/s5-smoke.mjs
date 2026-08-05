// Validate the corrected tap path before running the full matrix.
import { chromium } from "playwright";
import { attachConsole, realErrors, bootProbe, skipIntro, startMatch, playMove, snapshot, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
attachConsole(page, errs);

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });
console.log("match started:", JSON.stringify(await snapshot(page)));

// Verify the pick-point probe agrees with the engine for a spread of squares.
const probe = await page.evaluate(() => {
  const out = {};
  for (const sq of ["e2", "e4", "d2", "d4", "g1", "f3", "e7", "e5", "b8", "c6", "e1", "a1", "h8"]) {
    const p = window.__kg.pickPointFor(sq);
    out[sq] = { ok: p.ok, offset: p.offset, resolves: p.ok ? window.__kg.pickAt(p.x, p.y).square : null };
  }
  return out;
});
console.log("pick-point resolution:");
for (const [sq, v] of Object.entries(probe)) {
  console.log(`  ${sq}: ok=${v.ok} offset=${v.offset} resolves=${v.resolves} ${v.ok && v.resolves === sq ? "" : "  <-- MISMATCH"}`);
}

const m1 = await playMove(page, "e2", "e4");
console.log("move e2e4:", JSON.stringify(m1));
console.log("  ->", JSON.stringify(await snapshot(page)));

const m2 = await playMove(page, "e7", "e5");
console.log("move e7e5:", JSON.stringify(m2));
console.log("  ->", JSON.stringify(await snapshot(page)));

const m3 = await playMove(page, "g1", "f3");
console.log("move g1f3:", JSON.stringify(m3));
console.log("  ->", JSON.stringify(await snapshot(page)));

await sleep(500);
console.log("errors:", JSON.stringify(realErrors(errs)));
console.log("shader-warnings:", errs.filter((e) => e.type === "shader-warning").length);
await browser.close();
