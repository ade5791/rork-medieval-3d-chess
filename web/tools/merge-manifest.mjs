/**
 * Merge a per-era rig manifest fragment into tools/rig-manifest.json.
 * Idempotent: re-running replaces that era's block rather than duplicating it.
 *
 * Usage: node tools/merge-manifest.mjs tools/sengoku-rigs.json
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "tools", "rig-manifest.json");

const fragmentPath = process.argv[2];
if (!fragmentPath) {
  console.error("usage: node tools/merge-manifest.mjs <fragment.json>");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const fragment = JSON.parse(await readFile(path.resolve(ROOT, "..", fragmentPath).replace(/\\web\\\.\.\\/, "\\"), "utf8").catch(() => readFile(path.resolve(fragmentPath), "utf8")));

let added = 0;
for (const [era, block] of Object.entries(fragment)) {
  if (era === "note") continue;
  manifest[era] = block;
  added += Object.keys(block).length;
  console.log(`merged era "${era}": ${Object.keys(block).join(", ")}`);
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest now has eras: ${Object.keys(manifest).filter((k) => k !== "note").join(", ")} (${added} pieces merged)`);
