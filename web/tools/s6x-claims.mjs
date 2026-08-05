// Verify every claim the landing page will make, against the actual source.
// A landing page that promises a control the code does not implement is a
// defect, so each claim is grepped rather than remembered.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, acc);
    else if (/\.(ts|tsx)$/.test(f)) acc.push(f);
  }
  return acc;
}
const files = walk("src");
const all = files.map((f) => ({ f, t: readFileSync(f, "utf8") }));

function find(re) {
  const hits = [];
  for (const { f, t } of all) {
    const lines = t.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 130)}`);
    });
  }
  return hits;
}

const claims = {
  key_F_flip: find(/event\.key === "f"/),
  key_T_tactical: find(/event\.key === "t"/),
  key_C_cinema: find(/event\.key === "c"/),
  key_H_chronicle: find(/event\.key !== "h"/),
  key_Escape: find(/event\.key === "Escape"/),
  key_Space_demo: find(/event\.key === " " && snapshot\.mode === "demo"/),
  era_ids: find(/id:\s*"(medieval|rome|sengoku|egypt)"/),
  modes: find(/mode:\s*"(ai|hotseat|online|demo)"|"hotseat"|"demo"/).slice(0, 8),
  difficulty: find(/difficulty|"easy"|"medium"|"hard"/).slice(0, 8),
  camera_presets: find(/CameraPreset|cameraPreset/).slice(0, 6),
  online_relay: find(/VITE_MULTIPLAYER_URL|\/ws/).slice(0, 6),
  undo: find(/undo\(/).slice(0, 5),
  clock: find(/clock|increment/i).slice(0, 5),
};

for (const [k, v] of Object.entries(claims)) {
  console.log(`\n### ${k} (${v.length})`);
  v.slice(0, 6).forEach((l) => console.log("  " + l));
}
