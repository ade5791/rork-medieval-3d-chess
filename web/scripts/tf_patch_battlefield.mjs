// Battlefield pass. The 320x320 terrain plane is the largest screen-area
// surface in the arena and was a flat albedo, so it dominated the "untextured"
// read. Also fixes the non-binary metals on the siege iron and debris.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/battlefield.ts";
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
  const anchor = src.match(/^import .*from "\.\/quality";$/m)
    || src.match(/^import .*from "\.\/textures";$/m);
  if (anchor) {
    rep(anchor[0], L(anchor[0], 'import { earthSurface, metalSurface } from "./detail";'), "import");
  } else {
    log.push("MISS import anchor");
  }
}

// Terrain: churned earth relief at the same 64x tiling as the albedo.
rep(
  "new THREE.MeshStandardMaterial({ map, color: 0x6b6055, roughness: 1, metalness: 0 }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        map,",
    "        color: 0x6b6055,",
    "        roughness: 1,",
    "        metalness: 0,",
    "        normalMap: ground.normalMap,",
    "        normalScale: new THREE.Vector2(1.4, 1.4),",
    "        roughnessMap: ground.roughnessMap,",
    "      }),",
  ),
  "terrain material",
);
rep(
  L("    const map = this.track(mudTexture());", "    map.repeat.set(64, 64);"),
  L(
    "    const map = this.track(mudTexture());",
    "    map.repeat.set(64, 64);",
    "    // Churned mud relief, tiled to match the albedo so the two agree.",
    "    const ground = earthSurface();",
    "    ground.normalMap.repeat.set(64, 64);",
    "    ground.roughnessMap.repeat.set(64, 64);",
  ),
  "terrain surface",
);

// Palisade stakes: split timber grain.
rep(
  'const material = this.track(new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.95 }));',
  L(
    "const stakeGrain = earthSurface();",
    "    const material = this.track(",
    "      new THREE.MeshStandardMaterial({",
    "        color: 0x3a2c1e,",
    "        roughness: 0.95,",
    "        normalMap: stakeGrain.normalMap,",
    "        normalScale: new THREE.Vector2(0.9, 0.9),",
    "        roughnessMap: stakeGrain.roughnessMap,",
    "      }),",
    "    );",
  ),
  "palisade",
);

// Siege engine iron: 0.55 blend -> metal, with hammer relief.
rep(
  "const iron = this.track(new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.6, metalness: 0.55 }));",
  L(
    "const ironWork = metalSurface();",
    "    const iron = this.track(",
    "      new THREE.MeshStandardMaterial({",
    "        // Wrought siege iron: a metal, not a 0.55 blend. Albedo lifted off",
    "        // the 0.02 floor so it still reflects the torchlight.",
    "        color: 0x2c2c33,",
    "        roughness: 0.6,",
    "        metalness: 1,",
    "        normalMap: ironWork.normalMap,",
    "        normalScale: new THREE.Vector2(0.7, 0.7),",
    "        roughnessMap: ironWork.roughnessMap,",
    "      }),",
    "    );",
  ),
  "siege iron",
);

// Shields: banded wood + iron boss -> dielectric wood.
rep(
  "new THREE.MeshStandardMaterial({ color: 0x53402c, roughness: 0.8, metalness: 0.2 }),",
  L(
    "new THREE.MeshStandardMaterial({",
    "        color: 0x53402c,",
    "        roughness: 0.8,",
    "        // Painted limewood: dielectric.",
    "        metalness: 0,",
    "      }),",
  ),
  "shields",
);

// Debris: 0x2a2118 has linear luminance 0.0142, under the floor.
rep(
  "const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.95 }));",
  L(
    "// Was 0x2a2118 (linear luminance 0.0142) - under the 0.02 albedo floor.",
    "    const wheelMat = this.track(",
    "      new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.95 }),",
    "    );",
  ),
  "cart wheels",
);

// Campfire logs: 0x1d150e is linear luminance 0.0074 - far under the floor.
rep(
  "const logMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1d150e, roughness: 1 }));",
  L(
    "// Was 0x1d150e (linear luminance 0.0074), the darkest violation in the",
    "    // audit. Charred wood is dark but it is not a black hole.",
    "    const logMat = this.track(",
    "      new THREE.MeshStandardMaterial({ color: 0x2e2419, roughness: 1 }),",
    "    );",
  ),
  "campfire logs",
);

// Troops: instanced soldiers, 0.2 metalness blend -> dielectric cloth/leather.
rep(
  L(
    "        color: army.tint,",
    "        roughness: 0.95,",
    "        metalness: 0.2,",
  ),
  L(
    "        color: army.tint,",
    "        roughness: 0.95,",
    "        // Cloth and leather livery: dielectric.",
    "        metalness: 0,",
  ),
  "troops",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
