// Fix the double conversion in the materials() probe.
//
// THREE.ColorManagement converts hex -> linear working space on assignment, so
// material.color is already linear. The probe ran srgbToLinear() over it a
// second time, under-reporting every albedo by roughly an order of magnitude
// and manufacturing 104 phantom "albedo floor" violations. Measured proof:
// albedoTruth() reports belowWorking=0 vs belowDouble=104 on the same scene.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "sceneEngine.ts");
let src = fs.readFileSync(file, "utf8");

const old = [
  "              lum =",
  "                0.2126 * srgbToLinear(m.color.r) +",
  "                0.7152 * srgbToLinear(m.color.g) +",
  "                0.0722 * srgbToLinear(m.color.b);",
].join("\r\n");

const neu = [
  "              // material.color is ALREADY in the linear working space",
  "              // (ColorManagement converts on assignment). Converting again",
  "              // here under-reported every albedo and produced 104 phantom",
  "              // floor violations - measured via albedoTruth().",
  "              lum =",
  "                0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;",
].join("\r\n");

if (!src.includes(old)) {
  const lf = old.replace(/\r\n/g, "\n");
  if (src.includes(lf)) {
    src = src.replace(lf, neu.replace(/\r\n/g, "\n"));
  } else {
    console.log("FAIL pattern not found");
    process.exit(1);
  }
} else {
  src = src.replace(old, neu);
}

fs.writeFileSync(file, src);
console.log("OK probe now reports working-space luminance");
