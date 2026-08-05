// Jungle battleground pass. Bark and temple stone were flat albedos; the gilded
// shrine was a 0.85 metal blend.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/jungle.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);
const log = [];

function rep(find, replace, tag) {
  if (!src.includes(find)) { log.push("MISS " + tag); return; }
  src = src.replace(find, replace);
  log.push("ok " + tag);
}

if (!src.includes('from "./detail"')) {
  rep(
    'import { terrainHeight } from "./battlefield";',
    L(
      'import { terrainHeight } from "./battlefield";',
      'import { earthSurface, metalSurface, stoneSurface } from "./detail";',
    ),
    "import",
  );
}

// Tree trunks: bark relief. Instanced, so one material serves every trunk.
rep(
  "new THREE.MeshStandardMaterial({ color: 0x5b4732, roughness: 1, metalness: 0, flatShading: true }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        color: 0x5b4732,",
    "        roughness: 1,",
    "        metalness: 0,",
    "        flatShading: true,",
    "        // Bark relief. flatShading stays on for the faceted canopy read, but",
    "        // the normal map still gives the trunk close-range grain.",
    "        normalMap: bark.normalMap,",
    "        normalScale: new THREE.Vector2(1.2, 1.2),",
    "        roughnessMap: bark.roughnessMap,",
    "      }),",
  ),
  "trunk material",
);
rep(
  "  private buildForest(): void {",
  L("  private buildForest(): void {", "    const bark = earthSurface();"),
  "trunk surface",
);

// Temple stone: weathered blocks.
rep(
  "new THREE.MeshStandardMaterial({ color: 0xb3a785, roughness: 0.95, metalness: 0.02 }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        color: 0xb3a785,",
    "        roughness: 0.95,",
    "        metalness: 0.02,",
    "        normalMap: templeRock.normalMap,",
    "        normalScale: new THREE.Vector2(1.1, 1.1),",
    "        roughnessMap: templeRock.roughnessMap,",
    "      }),",
  ),
  "temple stone",
);

// Temple moss.
rep(
  "this.templeMoss = this.track(new THREE.MeshStandardMaterial({ color: 0x6d8149, roughness: 1 }));",
  L(
    "this.templeMoss = this.track(",
    "      new THREE.MeshStandardMaterial({",
    "        color: 0x6d8149,",
    "        roughness: 1,",
    "        normalMap: templeRock.normalMap,",
    "        normalScale: new THREE.Vector2(0.8, 0.8),",
    "      }),",
    "    );",
  ),
  "temple moss",
);

// Gilded shrine: real gold.
rep(
  "new THREE.MeshStandardMaterial({ color: 0xe2b64c, roughness: 0.32, metalness: 0.85 }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        color: 0xe2b64c,",
    "        roughness: 0.32,",
    "        // Gold leaf is a metal: 1, not a 0.85 blend.",
    "        metalness: 1,",
    "        normalMap: gild.normalMap,",
    "        normalScale: new THREE.Vector2(0.4, 0.4),",
    "        roughnessMap: gild.roughnessMap,",
    "      }),",
  ),
  "temple gold",
);
rep(
  "  private buildTemples(): void {",
  L(
    "  private buildTemples(): void {",
    "    const templeRock = stoneSurface();",
    "    const gild = metalSurface();",
  ),
  "temple surfaces",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
