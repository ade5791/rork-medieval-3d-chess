// S2 - bind detail surfaces to the remaining bare battlefield/jungle props.
// Coverage probe: battlefield 2/24 (8%), jungle 1/6 (17%). These are the
// close-range props (palisade timber, spear shafts, rocks, siege stone) that
// still read as flat plastic. Wood/earth props take earthSurface, rock/stone
// takes stoneSurface, metal takes metalSurface.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, "..", "src", "scene");

// Helper injected once per file: attaches a SurfaceMaps pair to a material.
const HELPER = [
  "",
  "// TF_S2_PROP_SURFACE: attach relief + roughness variation to a prop material.",
  "// Shared, cached maps - no per-material texture allocation.",
  "function dressProp(",
  "  material: THREE.MeshStandardMaterial,",
  "  maps: { normalMap: THREE.Texture; roughnessMap: THREE.Texture },",
  "  strength = 0.45,",
  "): THREE.MeshStandardMaterial {",
  "  if (!material.normalMap) {",
  "    material.normalMap = maps.normalMap;",
  "    material.normalScale = new THREE.Vector2(strength, strength);",
  "  }",
  "  if (!material.roughnessMap) material.roughnessMap = maps.roughnessMap;",
  "  material.needsUpdate = true;",
  "  return material;",
  "}",
  "",
].join("\r\n");

const EDITS = {
  "battlefield.ts": {
    needStone: true,
    pairs: [
      ["const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x453427, roughness: 0.85 }));",
       "const poleMat = this.track(dressProp(new THREE.MeshStandardMaterial({ color: 0x453427, roughness: 0.85 }), earthSurface()));"],
      ["const timber = this.track(new THREE.MeshStandardMaterial({ color: 0x3f3123, roughness: 0.95 }));",
       "const timber = this.track(dressProp(new THREE.MeshStandardMaterial({ color: 0x3f3123, roughness: 0.95 }), earthSurface()));"],
      ["const spearMat = this.track(new THREE.MeshStandardMaterial({ color: 0x473a29, roughness: 0.85, metalness: 0 }));",
       "const spearMat = this.track(dressProp(new THREE.MeshStandardMaterial({ color: 0x473a29, roughness: 0.85, metalness: 0 }), earthSurface()));"],
      ["const rockMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 }));",
       "const rockMat = this.track(dressProp(new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 }), stoneSurface(), 0.6));"],
      ["const stoneMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4e4740, roughness: 1 }));",
       "const stoneMat = this.track(dressProp(new THREE.MeshStandardMaterial({ color: 0x4e4740, roughness: 1 }), stoneSurface(), 0.6));"],
      ["new THREE.MeshStandardMaterial({ color: 0x4b3d2d, roughness: 0.95 }),",
       "dressProp(new THREE.MeshStandardMaterial({ color: 0x4b3d2d, roughness: 0.95 }), earthSurface()),"],
      ["new THREE.MeshStandardMaterial({ color: 0x453728, roughness: 1 }),",
       "dressProp(new THREE.MeshStandardMaterial({ color: 0x453728, roughness: 1 }), earthSurface()),"],
    ],
  },
};

const report = {};
for (const [fileName, cfg] of Object.entries(EDITS)) {
  const file = path.join(dir, fileName);
  let src = fs.readFileSync(file, "utf8");
  const before = src;

  // Ensure stoneSurface is imported where needed.
  if (cfg.needStone && !/import \{[^}]*stoneSurface/.test(src)) {
    src = src.replace(
      /import \{ ([^}]*) \} from "\.\/detail";/,
      (mm, inner) => `import { ${inner.trim()}, stoneSurface } from "./detail";`,
    );
  }

  // Inject the helper once, before the first class declaration.
  if (!src.includes("TF_S2_PROP_SURFACE")) {
    const idx = src.search(/\r?\nexport class /);
    if (idx !== -1) src = src.slice(0, idx) + "\r\n" + HELPER + src.slice(idx);
  }

  const applied = [];
  const missed = [];
  for (const [find, replace] of cfg.pairs) {
    if (src.includes(find)) {
      src = src.split(find).join(replace);
      applied.push(find.slice(0, 60));
    } else {
      missed.push(find.slice(0, 60));
    }
  }
  if (src !== before) fs.writeFileSync(file, src);
  report[fileName] = { applied: applied.length, missed };
}
console.log(JSON.stringify(report, null, 2));
