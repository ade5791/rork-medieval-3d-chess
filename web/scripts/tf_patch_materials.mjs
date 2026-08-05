// Apply the authored surface-detail system (normal + roughness maps) to the
// materials the audit found flat, and lift the albedos that sat under the
// photometric floor. Line-ending agnostic, idempotent.
import fs from "node:fs";

const base = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/";
const log = [];

function edit(fileName, fn) {
  const file = base + fileName;
  let src = fs.readFileSync(file, "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const before = src;
  src = fn(src, nl, (...lines) => lines.join(nl));
  if (src !== before) {
    fs.writeFileSync(file, src);
    log.push(fileName + ": WRITTEN");
  } else {
    log.push(fileName + ": NO-CHANGE");
  }
}

function replaceOnce(src, find, replace, tag) {
  if (!src.includes(find)) { log.push("  MISS " + tag); return src; }
  log.push("  ok " + tag);
  return src.replace(find, replace);
}

// ------------------------------------------------------------- environment.ts
edit("environment.ts", (src, nl, L) => {
  if (!src.includes('from "./detail"')) {
    src = replaceOnce(
      src,
      'import type { ArenaLook } from "./arena";',
      L('import { marbleSurface, stoneSurface } from "./detail";', 'import type { ArenaLook } from "./arena";'),
      "env import",
    );
  }

  // Floor: pitted stone relief + roughness variation.
  src = replaceOnce(
    src,
    "new THREE.MeshStandardMaterial({ map, color: 0x6a6155, roughness: 0.95, metalness: 0.02 }),",
    L(
      "new THREE.MeshStandardMaterial({",
      "        map,",
      "        color: 0x6a6155,",
      "        roughness: 0.95,",
      "        metalness: 0.02,",
      "        normalMap: stone.normalMap,",
      "        normalScale: new THREE.Vector2(0.85, 0.85),",
      "        roughnessMap: stone.roughnessMap,",
      "      }),",
    ),
    "floor material",
  );
  src = replaceOnce(
    src,
    "    const map = this.track(flagstoneTexture());" + nl + "    map.repeat.set(8, 8);",
    L(
      "    const map = this.track(flagstoneTexture());",
      "    map.repeat.set(8, 8);",
      "    // Shared authored relief: the flagstones were a flat albedo before.",
      "    const stone = stoneSurface();",
      "    stone.normalMap.repeat.set(8, 8);",
      "    stone.roughnessMap.repeat.set(8, 8);",
    ),
    "floor maps setup",
  );

  // Dais: marble relief.
  src = replaceOnce(
    src,
    "new THREE.MeshStandardMaterial({ map: this.track(marbleTexture(true)), color: 0x5b5449, roughness: 0.85 }),",
    L(
      "new THREE.MeshStandardMaterial({",
      "        map: this.track(marbleTexture(true)),",
      "        color: 0x5b5449,",
      "        roughness: 0.85,",
      "        normalMap: marble.normalMap,",
      "        normalScale: new THREE.Vector2(0.5, 0.5),",
      "        roughnessMap: marble.roughnessMap,",
      "      }),",
    ),
    "dais material",
  );
  src = replaceOnce(
    src,
    "    // Dais the board rests on.",
    L("    const marble = marbleSurface();", "    // Dais the board rests on."),
    "dais maps setup",
  );

  // Pillars / colonnade stone.
  src = replaceOnce(
    src,
    L(
      "      new THREE.MeshStandardMaterial({",
      "        map: this.track(flagstoneTexture()),",
      "        color: 0x554e44,",
      "        roughness: 0.92,",
      "        metalness: 0.02,",
      "      }),",
    ),
    L(
      "      new THREE.MeshStandardMaterial({",
      "        map: this.track(flagstoneTexture()),",
      "        color: 0x554e44,",
      "        roughness: 0.92,",
      "        metalness: 0.02,",
      "        normalMap: pillarStone.normalMap,",
      "        normalScale: new THREE.Vector2(1.05, 1.05),",
      "        roughnessMap: pillarStone.roughnessMap,",
      "      }),",
    ),
    "pillar material",
  );
  src = replaceOnce(
    src,
    "  private buildColonnade(): void {" + nl + "    const stone = this.track(",
    L("  private buildColonnade(): void {", "    const pillarStone = stoneSurface();", "    const stone = this.track("),
    "pillar maps setup",
  );

  // Curtain wall: albedo 0x2e2a26 lum 0.0167 is under the 0.02 floor -> lift.
  src = replaceOnce(
    src,
    L(
      "      new THREE.MeshStandardMaterial({",
      "        map: this.track(flagstoneTexture()),",
      "        color: 0x2e2a26,",
      "        roughness: 1,",
      "        side: THREE.DoubleSide,",
      "      }),",
    ),
    L(
      "      new THREE.MeshStandardMaterial({",
      "        map: this.track(flagstoneTexture()),",
      "        // Was 0x2e2a26 (linear luminance 0.0167) - under the 0.02 albedo",
      "        // floor, so it read as a black hole rather than dark stone.",
      "        color: 0x3a352f,",
      "        roughness: 1,",
      "        side: THREE.DoubleSide,",
      "        normalMap: pillarStone.normalMap,",
      "        normalScale: new THREE.Vector2(1.15, 1.15),",
      "        roughnessMap: pillarStone.roughnessMap,",
      "      }),",
    ),
    "wall material",
  );

  // Rubble: give it relief too.
  src = replaceOnce(
    src,
    'const rubbleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3b352d, roughness: 1 }));',
    L(
      "const rubbleMat = this.track(",
      "      new THREE.MeshStandardMaterial({",
      "        color: 0x3b352d,",
      "        roughness: 1,",
      "        normalMap: pillarStone.normalMap,",
      "        normalScale: new THREE.Vector2(1.3, 1.3),",
      "        roughnessMap: pillarStone.roughnessMap,",
      "      }),",
      "    );",
    ),
    "rubble material",
  );

  // Torch bracket: metalness 0.6 is neither dielectric nor metal -> make binary.
  src = replaceOnce(
    src,
    "new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.7, metalness: 0.6 })",
    L(
      "new THREE.MeshStandardMaterial({",
      "        // Wrought iron: metals are binary. 0.6 was a non-physical blend and",
      "        // the albedo sat under the 0.02 floor.",
      "        color: 0x3a2f22,",
      "        roughness: 0.62,",
      "        metalness: 1,",
      "      })",
    ),
    "bracket material",
  );

  return src;
});

fs.writeFileSync(
  "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/reports/patch-materials.log",
  log.join("\n"),
);
console.log(log.join("\n"));
