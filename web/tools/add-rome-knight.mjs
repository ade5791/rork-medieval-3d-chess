/**
 * Adds the Roman Eques (knight) to the rig manifest.
 *
 * Rome shipped with FIVE kinds: it had no knight, so every Roman cavalry
 * square silently fielded a medieval figure via the classic fallback. The new
 * provenance gate makes that visible as a failing check, and this closes it.
 *
 * Idempotent: re-running overwrites the entry rather than duplicating it.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "tools", "rig-manifest.json");

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

manifest.rome.n = {
  name: "Eques",
  height: 1.898,
  rigged: "https://v3b.fal.media/files/b/0aa518a4/rqny2ydmiLPWlyQcQCxBG_rigged_character.glb",
  clips: {
    idle: "https://v3b.fal.media/files/b/0aa518a6/PUWm8vWpA2fksPBFL5Vss_animation.glb",
    attack: "https://v3b.fal.media/files/b/0aa518a7/OusmzjtN69YbiICB9VM9q_animation.glb",
    death: "https://v3b.fal.media/files/b/0aa518a6/r07HWYMlavqEPC2BtIB0t_animation.glb",
    walk: "https://v3b.fal.media/files/b/0aa518a7/JhvAX_iwLIsSTm758aD5f_animation.glb",
  },
  actionIds: { idle: 89, attack: 128, death: 187, walk: 611 },
};

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

for (const era of Object.keys(manifest).filter((k) => k !== "note")) {
  const kinds = Object.keys(manifest[era]);
  console.log(`${era}: ${kinds.length} kinds [${kinds.join(",")}]`);
}
