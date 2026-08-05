// A/B gate with IDENTICAL instrumentation on both sides.
//
// The first gate run was invalid: the before-set was captured with the broken
// probe (clamped frame time, zeroed histogram, FX counted as surfaces), so the
// two sides were not comparable. This reverts ONLY the five material files to
// HEAD - keeping the fixed probe, detail.ts and reviewState.ts on both sides -
// builds and captures each side, then restores the working tree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repo = path.resolve(root, "..");

const MATERIAL_FILES = [
  "web/src/scene/battlefield.ts",
  "web/src/scene/board.ts",
  "web/src/scene/environment.ts",
  "web/src/scene/jungle.ts",
  "web/src/scene/pieces.ts",
];

const backupDir = path.join(root, "reports", "_ab_backup");
fs.mkdirSync(backupDir, { recursive: true });

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || root, encoding: "utf8", stdio: "pipe", shell: true });

function saveWorking() {
  for (const rel of MATERIAL_FILES) {
    const src = path.join(repo, rel);
    fs.copyFileSync(src, path.join(backupDir, path.basename(rel)));
  }
  console.log("saved working copies");
}

function restoreWorking() {
  for (const rel of MATERIAL_FILES) {
    const dst = path.join(repo, rel);
    fs.copyFileSync(path.join(backupDir, path.basename(rel)), dst);
  }
  console.log("restored working copies");
}

function checkoutHead() {
  run("git", ["checkout", "HEAD", "--", ...MATERIAL_FILES], repo);
  console.log("checked out HEAD material files");
}

function build(tag) {
  console.log("building " + tag + " ...");
  run("npx", ["vite", "build"]);
  console.log("built " + tag);
}

function capture(label) {
  console.log("capturing " + label + " ...");
  const out = run("node", ["scripts/tf_capture.mjs", label]);
  console.log(out.trim());
}

try {
  saveWorking();

  // ---- BASE (pre-material-pass, fixed probe) ----
  checkoutHead();
  build("base");
  capture("base");

  // ---- POST (material pass applied, same probe) ----
  restoreWorking();
  build("post");
  capture("post");

  console.log("AB_COMPLETE");
} catch (err) {
  console.log("AB_FAILED: " + String(err).slice(0, 800));
  try { restoreWorking(); } catch { /* best effort */ }
  process.exitCode = 1;
}
