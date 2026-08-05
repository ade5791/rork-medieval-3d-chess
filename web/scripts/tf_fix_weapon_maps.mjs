// Fix the field-name mismatch in the weapon surface binding.
//
// SurfaceMaps exposes { normalMap, roughnessMap }, but the binding read
// surface.normal / surface.roughness - both undefined. Assigning undefined to
// material.normalMap is legal TypeScript (the property is nullable) so tsc
// stayed silent, and the maps never bound. This is exactly why the coverage
// probe reported weapons at 0% despite the code looking correct.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "weapons.ts");
let src = fs.readFileSync(file, "utf8");

const fixes = [
  ["material.normalMap = surface.normal;", "material.normalMap = surface.normalMap;"],
  ["material.roughnessMap = surface.roughness;", "material.roughnessMap = surface.roughnessMap;"],
];

const applied = [];
for (const [find, replace] of fixes) {
  if (src.includes(find)) {
    src = src.split(find).join(replace);
    applied.push(replace);
  }
}

fs.writeFileSync(file, src);
console.log(JSON.stringify({ applied }, null, 2));
