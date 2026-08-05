// Piece surface pass. The audit found the pieces reading as smooth plastic:
// non-binary metalness, a single scalar roughness, and no wear breakup. This
// splits them into an explicit metal (armour/regalia) vs dielectric (carved
// stone) response and adds a cavity/edge-wear roughness map.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/pieces.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);
const log = [];

function rep(find, replace, tag) {
  if (!src.includes(find)) { log.push("MISS " + tag); return; }
  src = src.replace(find, replace);
  log.push("ok " + tag);
}

// 0. Repair a mojibake comment (non-ASCII got mangled by the shell encoding).
rep(
  "    // The sculpt was painted for this army \ufffd?\" feathers, jade and gold would be",
  "    // The sculpt was painted for this army - feathers, jade and gold would be",
  "mojibake repair",
);

// 1. Import the shared wear surface.
if (!src.includes('from "./detail"')) {
  const anchor = src.match(/^import .*from "\.\/textures";$/m)
    || src.match(/^import type \{ ArenaLook \} from "\.\/arena";$/m);
  if (anchor) {
    rep(anchor[0], L(anchor[0], 'import { wearSurface } from "./detail";'), "import");
  } else {
    log.push("MISS import anchor");
  }
}

// 2. Own-livery branch: keep the painted albedo, but make the response physical
//    and add wear. Clamping metalness into 0.08-0.4 was the bug - it guaranteed
//    every painted piece was a non-physical half-metal.
rep(
  L(
    "    material.color.setHex(0xffffff);",
    "    material.roughness = Math.min(0.85, material.roughness * 0.9 + 0.18);",
    "    material.metalness = Math.max(0.08, Math.min(0.4, material.metalness));",
  ),
  L(
    "    material.color.setHex(0xffffff);",
    "    material.roughness = Math.min(0.85, material.roughness * 0.9 + 0.18);",
    "    // Metals are binary. The old clamp forced every painted piece into",
    "    // 0.08-0.4, which is physically neither metal nor dielectric and is why",
    "    // the armour read as shiny plastic. Snap to the nearest valid pole.",
    "    material.metalness = material.metalness >= 0.5 ? 1 : 0;",
    "    applyWear(material);",
  ),
  "livery branch",
);

// 3. White: carved pale stone -> dielectric.
rep(
  L(
    "    material.color.setHex(0xfff2dd);",
    "    material.roughness = 0.34;",
    "    material.metalness = 0.1;",
  ),
  L(
    "    material.color.setHex(0xfff2dd);",
    "    material.roughness = 0.42;",
    "    // Carved bone/ivory is a dielectric, not a 0.1 metal blend.",
    "    material.metalness = 0;",
  ),
  "white branch",
);

// 4. Black: dark forged metal -> full metal.
rep(
  L(
    "    material.color.setHex(0x34363d);",
    "    material.roughness = 0.3;",
    "    material.metalness = 0.55;",
  ),
  L(
    "    material.color.setHex(0x34363d);",
    "    material.roughness = 0.38;",
    "    // Blackened forged steel: a real metal, so 1 rather than the 0.55 blend.",
    "    material.metalness = 1;",
  ),
  "black branch",
);

// 5. Apply wear on the untextured branches too, then define the helper.
rep(
  L(
    "  material.emissiveIntensity = 0.05;",
    "  material.envMapIntensity = 1.15;",
    "  material.needsUpdate = true;",
    "}",
  ),
  L(
    "  material.emissiveIntensity = 0.05;",
    "  material.envMapIntensity = 1.15;",
    "  applyWear(material);",
    "  material.needsUpdate = true;",
    "}",
    "",
    "// Edge wear + cavity grime. Without this the pieces have one uniform",
    "// roughness across the whole sculpt, which is what reads as untextured at",
    "// close camera distance regardless of how good the albedo is.",
    "function applyWear(material: THREE.MeshStandardMaterial): void {",
    "  const wear = wearSurface();",
    "  if (!material.roughnessMap) {",
    "    material.roughnessMap = wear.roughnessMap;",
    "  }",
    "  if (!material.normalMap) {",
    "    material.normalMap = wear.normalMap;",
    "    material.normalScale = new THREE.Vector2(0.3, 0.3);",
    "  }",
    "  material.needsUpdate = true;",
    "}",
  ),
  "wear helper",
);

// 6. Procedural fallback figure: metalness 0.1 -> dielectric stone.
rep(
  "new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.5, metalness: 0.1 })",
  L(
    "new THREE.MeshStandardMaterial({",
    "    color: 0xe8e0cf,",
    "    roughness: 0.5,",
    "    // Carved stone fallback: dielectric.",
    "    metalness: 0,",
    "  })",
  ),
  "fallback figure",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
