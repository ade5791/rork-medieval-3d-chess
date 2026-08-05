/**
 * Merges tools/egypt-rigs.json into tools/rig-manifest.json.
 *
 * Idempotent: re-running replaces the "egypt" block rather than duplicating it,
 * and leaves every other era untouched. The manifest is the single source of
 * truth build-era-roster.mjs reads, so a new era joins the SAME verified
 * download -> strip -> gate -> rehost path as rome and sengoku.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "tools", "rig-manifest.json");
const SOURCE = path.join(ROOT, "tools", "egypt-rigs.json");

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const source = JSON.parse(await readFile(SOURCE, "utf8"));

manifest.egypt = source.egypt;

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

const eras = Object.keys(manifest).filter((k) => k !== "note");
for (const era of eras) {
  const kinds = Object.keys(manifest[era]);
  console.log(`${era}: ${kinds.length} kinds [${kinds.join(",")}]`);
}
console.log("manifest merged");
