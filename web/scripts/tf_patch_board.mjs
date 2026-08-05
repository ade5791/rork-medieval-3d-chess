// Board detail pass: the tiles sit closest to the camera, so they carry the
// strictest close-range bar. Adds marble relief + roughness variation, lifts the
// dark tile off the albedo floor, and makes the metals binary.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/board.ts";
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
  const importAnchor = src.match(/^import .*from "\.\/textures";$/m);
  if (importAnchor) {
    rep(
      importAnchor[0],
      L('import { marbleSurface, metalSurface } from "./detail";', importAnchor[0]),
      "import",
    );
  } else {
    log.push("MISS import anchor");
  }
}

// Build the shared surfaces once, just before the tile materials.
rep(
  "    const lightMaterial = this.track(",
  L(
    "    // Authored surface detail. Both tiles were a flat albedo with a single",
    "    // scalar roughness, which is what made them read as polished plastic at",
    "    // close camera distance.",
    "    const marble = marbleSurface();",
    "    const metal = metalSurface();",
    "    const lightMaterial = this.track(",
  ),
  "surfaces",
);

// Light tile.
rep(
  L(
    "      new THREE.MeshPhysicalMaterial({",
    "        map: lightMap,",
    "        color: 0xf6efe0,",
    "        roughness: 0.22,",
    "        metalness: 0.02,",
    "        clearcoat: 0.7,",
    "        clearcoatRoughness: 0.18,",
    "        envMapIntensity: 0.9,",
    "      }),",
  ),
  L(
    "      new THREE.MeshPhysicalMaterial({",
    "        map: lightMap,",
    "        color: 0xf6efe0,",
    "        roughness: 0.22,",
    "        metalness: 0.02,",
    "        clearcoat: 0.7,",
    "        clearcoatRoughness: 0.18,",
    "        envMapIntensity: 0.9,",
    "        normalMap: marble.normalMap,",
    "        normalScale: new THREE.Vector2(0.35, 0.35),",
    "        roughnessMap: marble.roughnessMap,",
    "      }),",
  ),
  "light tile",
);

// Dark tile: 0x23252c is linear luminance 0.0186, under the 0.02 floor.
rep(
  L(
    "      new THREE.MeshPhysicalMaterial({",
    "        map: darkMap,",
    "        color: 0x23252c,",
    "        roughness: 0.3,",
    "        metalness: 0.12,",
    "        clearcoat: 0.6,",
    "        clearcoatRoughness: 0.25,",
    "        envMapIntensity: 0.8,",
    "      }),",
  ),
  L(
    "      new THREE.MeshPhysicalMaterial({",
    "        map: darkMap,",
    "        // Was 0x23252c (linear luminance 0.0186), just under the 0.02 albedo",
    "        // floor. A dark slate still has to reflect something.",
    "        color: 0x2a2d35,",
    "        roughness: 0.3,",
    "        // Slate is a dielectric: 0.12 was a non-physical blend.",
    "        metalness: 0,",
    "        clearcoat: 0.6,",
    "        clearcoatRoughness: 0.25,",
    "        envMapIntensity: 0.8,",
    "        normalMap: marble.normalMap,",
    "        normalScale: new THREE.Vector2(0.45, 0.45),",
    "        roughnessMap: marble.roughnessMap,",
    "      }),",
  ),
  "dark tile",
);

// Base stone: metalness 0.25 -> dielectric, plus relief.
rep(
  "new THREE.MeshStandardMaterial({ color: 0x3b342b, roughness: 0.72, metalness: 0.25 }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        color: 0x3b342b,",
    "        roughness: 0.72,",
    "        // Carved stone plinth: dielectric, not a 0.25 metal blend.",
    "        metalness: 0,",
    "        normalMap: marble.normalMap,",
    "        normalScale: new THREE.Vector2(0.6, 0.6),",
    "        roughnessMap: marble.roughnessMap,",
    "      }),",
  ),
  "base stone",
);

// Bronze border: real metal, hammered relief.
rep(
  L(
    "      new THREE.MeshStandardMaterial({",
    "        map: this.track(boardBorderTexture()),",
    "        color: 0xbfae8e,",
    "        roughness: 0.55,",
    "        metalness: 0.45,",
    "        envMapIntensity: 1.1,",
    "      }),",
  ),
  L(
    "      new THREE.MeshStandardMaterial({",
    "        map: this.track(boardBorderTexture()),",
    "        color: 0xbfae8e,",
    "        roughness: 0.55,",
    "        // Cast bronze inlay: a real metal, so metalness is 1 rather than a",
    "        // 0.45 blend that is physically neither.",
    "        metalness: 1,",
    "        envMapIntensity: 1.1,",
    "        normalMap: metal.normalMap,",
    "        normalScale: new THREE.Vector2(0.55, 0.55),",
    "        roughnessMap: metal.roughnessMap,",
    "      }),",
  ),
  "border",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
