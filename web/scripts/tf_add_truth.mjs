// Add an albedoTruth() accessor that reports, for the darkest surfaces:
//   hex        - authored sRGB (getHexString round-trip)
//   working    - material.color.r/g/b as the renderer uses them
//   lumWorking - luminance of the working-space value (the CORRECT number)
//   lumDouble  - luminance after another srgb->linear pass (what the probe does)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "sceneEngine.ts");
let src = fs.readFileSync(file, "utf8");

if (src.includes("albedoTruth")) {
  console.log("SKIP already present");
  process.exit(0);
}

const anchor = "      materials: () => {";
if (!src.includes(anchor)) {
  console.log("FAIL anchor missing");
  process.exit(1);
}

const block = [
  "      /**",
  "       * Ground truth for the albedo floor check. ColorManagement converts a",
  "       * hex assignment into the linear working space on assignment, so",
  "       * material.color is ALREADY linear - running srgbToLinear over it again",
  "       * double-converts and under-reports every albedo.",
  "       */",
  "      albedoTruth: () => {",
  "        const seen = new Set<string>();",
  "        const rows: Record<string, unknown>[] = [];",
  "        this.scene.traverse((node) => {",
  "          const mesh = node as THREE.Mesh;",
  "          if (!mesh.isMesh) return;",
  "          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];",
  "          for (const raw of list) {",
  "            const m = raw as THREE.MeshStandardMaterial;",
  "            if (!m || !m.isMeshStandardMaterial || seen.has(m.uuid)) continue;",
  "            seen.add(m.uuid);",
  "            const anyMat = m as unknown as { transparent?: boolean; blending?: number; depthWrite?: boolean };",
  "            const isFx =",
  "              anyMat.blending === THREE.AdditiveBlending ||",
  "              (anyMat.transparent === true && anyMat.depthWrite === false);",
  "            if (isFx) continue;",
  "            const lumWorking =",
  "              0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;",
  "            const lumDouble =",
  "              0.2126 * srgbToLinear(m.color.r) +",
  "              0.7152 * srgbToLinear(m.color.g) +",
  "              0.0722 * srgbToLinear(m.color.b);",
  "            rows.push({",
  "              hex: `#${m.color.getHexString()}`,",
  "              lumWorking: Number(lumWorking.toFixed(5)),",
  "              lumDouble: Number(lumDouble.toFixed(5)),",
  "              hasMap: Boolean(m.map),",
  "              owner: mesh.name || mesh.type,",
  "            });",
  "          }",
  "        });",
  "        rows.sort((a, b) => (a.lumWorking as number) - (b.lumWorking as number));",
  "        const belowWorking = rows.filter((r) => (r.lumWorking as number) < 0.02 && !r.hasMap).length;",
  "        const belowDouble = rows.filter((r) => (r.lumDouble as number) < 0.02 && !r.hasMap).length;",
  "        return { count: rows.length, belowWorking, belowDouble, darkest: rows.slice(0, 10) };",
  "      },",
].join("\r\n");

src = src.replace(anchor, block + "\r\n" + anchor);
fs.writeFileSync(file, src);
console.log("OK added albedoTruth");
