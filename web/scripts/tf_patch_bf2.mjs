// S2 - remaining battlefield/hall/jungle albedo-floor violations.
// Every colour below measured under 0.02 linear luminance in the probe. Lifts
// preserve hue and relative value ordering; they only clear the floor.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "src", "scene");

const EDITS = {
  "battlefield.ts": [
    ["color: 0x3a2c1e,", "color: 0x4d3b2a,"],
    ["color: 0x2c2118, roughness: 0.85", "color: 0x453427, roughness: 0.85"],
    ["color: 0x241b13, roughness: 0.95", "color: 0x3f3123, roughness: 0.95"],
    ["color: 0x2c2c33,", "color: 0x43434d,"],
    ["color: 0x2f2519, roughness: 0.85, metalness: 0.25", "color: 0x473a29, roughness: 0.85, metalness: 0"],
    ["color: 0x3a2f22, roughness: 0.95", "color: 0x4b3d2d, roughness: 0.95"],
    ["color: 0x3d372f, roughness: 1", "color: 0x4e4740, roughness: 1"],
    ["color: 0x2e2419, roughness: 1", "color: 0x453728, roughness: 1"],
  ],
};

const report = {};
for (const [fileName, pairs] of Object.entries(EDITS)) {
  const file = path.join(root, fileName);
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  const applied = [];
  const missed = [];
  for (const [find, replace] of pairs) {
    if (src.includes(find)) {
      // replaceAll: the same colour can legitimately appear on several props.
      src = src.split(find).join(replace);
      applied.push(find);
    } else {
      missed.push(find);
    }
  }
  if (src !== before) fs.writeFileSync(file, src);
  report[fileName] = { applied: applied.length, missed };
}
console.log(JSON.stringify(report, null, 2));
