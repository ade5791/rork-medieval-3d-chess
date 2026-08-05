/**
 * MUTATION TEST for the provenance gate.
 *
 * A gate that has never failed is not evidence. This deliberately breaks the
 * egypt roster (removes the knight, so cavalry silently falls back to the
 * classic medieval sculpt), re-runs the gate, and asserts it FAILS - then
 * restores the file and asserts it PASSES again.
 *
 * This is the exact defect the old gate could not see: the fallback figure is
 * skinned, so "every figure rigged" still reported 29/29.
 *
 * Usage: node tools/mutate-era-gate.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ERAS_TS = path.join(ROOT, "src", "scene", "eras.ts");

const ORIGINAL = 'const EGYPT_ROSTER: EraRoster = roster("egypt", ROSTER_KINDS);';
const MUTATED = 'const EGYPT_ROSTER: EraRoster = roster("egypt", ["k", "q", "b", "r", "p"]);';

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: { ...process.env, ...env },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

const source = await readFile(ERAS_TS, "utf8");
if (!source.includes(ORIGINAL)) {
  console.error("FAIL: could not find the roster line to mutate - test is invalid");
  process.exit(1);
}

let restored = false;
const restore = async () => {
  if (restored) return;
  await writeFile(ERAS_TS, source);
  restored = true;
};
process.on("exit", () => {});

try {
  // ---------------------------------------------------- inject the defect
  console.log("injecting defect: egypt roster loses its knight (falls back to classic)");
  await writeFile(ERAS_TS, source.replace(ORIGINAL, MUTATED));

  const build = await run("npm", ["run", "build"]);
  if (build.code !== 0) {
    console.error("FAIL: mutated build did not compile\n" + build.out.slice(-1500));
    await restore();
    process.exit(1);
  }

  const gated = await run("node", ["tools/gate-era.mjs"], { GATE_ERAS: "classic,egypt" });
  const detectedCoverage = /FAIL roster covers every kind/.test(gated.out);
  const detectedForeign = /FAIL no foreign sculpts/.test(gated.out);
  const failed = gated.code !== 0;

  console.log("\n--- gate output on the MUTATED build ---");
  console.log(
    gated.out
      .split("\n")
      .filter((l) => /=== |FAIL |eras checked/.test(l))
      .join("\n"),
  );

  if (!failed) {
    console.error("\nMUTATION TEST FAILED: the gate PASSED a knowingly broken roster.");
    await restore();
    process.exit(1);
  }
  if (!detectedCoverage && !detectedForeign) {
    console.error("\nMUTATION TEST FAILED: gate failed, but NOT on a provenance check.");
    await restore();
    process.exit(1);
  }

  console.log(
    `\nDEFECT DETECTED by provenance (coverage=${detectedCoverage} foreign=${detectedForeign})`,
  );
} finally {
  // ------------------------------------------------------------- restore
  await restore();
  console.log("\nrestoring eras.ts and rebuilding");
  const rebuild = await run("npm", ["run", "build"]);
  if (rebuild.code !== 0) {
    console.error("FAIL: restored build did not compile");
    process.exit(1);
  }
  const clean = await run("node", ["tools/gate-era.mjs"], { GATE_ERAS: "classic,egypt" });
  console.log(
    clean.out
      .split("\n")
      .filter((l) => /=== |FAIL |eras checked/.test(l))
      .join("\n"),
  );
  if (clean.code !== 0) {
    console.error("\nFAIL: gate does not pass after restore - repo may be dirty");
    process.exit(1);
  }
  console.log("\nMUTATION TEST PASSED: gate catches the defect and clears the fix.");
}
