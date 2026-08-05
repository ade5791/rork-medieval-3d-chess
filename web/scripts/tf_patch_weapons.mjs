// S2 visual pass - weapons module.
//
// Measured problem (reports/violator-names-dusk.json): 107 of 132 photometric
// violations live in the procedural weapons module. Three distinct causes:
//
//  1. weaponGeometries() DELETES the uv attribute before merging, so no weapon
//     material can ever bind a normal or roughness map. This is why every
//     weapon reads as flat plastic at close range - it is not a lighting
//     problem, it is a missing authored surface.
//  2. PALETTE carries non-binary metalness (0.05 / 0.08 / 0.1 / 0.14 / 0.4 /
//     0.42). Those are the exact values the violator scan reported.
//  3. Several palette albedos sit under the 0.02 linear floor (obsidian
//     0x0e1015 = 0.0032, wood 0x4a3323 = 0.0080).
//
// Fix: build a deterministic box-projected UV set at merge time, snap metals to
// 0 or 1, and lift the sub-floor albedos to the minimum legal luminance while
// preserving hue. Idempotent and line-ending agnostic.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "weapons.ts");
let src = fs.readFileSync(file, "utf8");
const before = src;

if (src.includes("TF_S2_WEAPON_SURFACE")) {
  console.log("SKIP already patched");
  process.exit(0);
}

// ---------------------------------------------------------------- 1. palette
// Snap metalness to binary and lift dark albedos. Values chosen to keep the
// faction read: obsidian stays the darkest legal surface, wood warms slightly.
const paletteFixes = [
  // [find, replace, label]
  ["wood: { color: 0x8a6440, roughness: 0.82, metalness: 0.05,",
   "wood: { color: 0x8a6440, roughness: 0.82, metalness: 0,", "white.wood metal 0.05->0"],
  ["leather: { color: 0x2f4a86, roughness: 0.72, metalness: 0.1,",
   "leather: { color: 0x2f4a86, roughness: 0.72, metalness: 0,", "white.leather 0.1->0"],
  ["cloth: { color: 0x2b4f9c, roughness: 0.78, metalness: 0.08,",
   "cloth: { color: 0x2b4f9c, roughness: 0.78, metalness: 0,", "white.cloth 0.08->0"],
  ["gem: { color: 0xbcd8ff, roughness: 0.08, metalness: 0.05,",
   "gem: { color: 0xbcd8ff, roughness: 0.08, metalness: 0,", "white.gem 0.05->0"],
  ["obsidian: { color: 0x23262e, roughness: 0.14, metalness: 0.4,",
   "obsidian: { color: 0x33363f, roughness: 0.22, metalness: 0,", "white.obsidian 0.4->0, albedo lift"],
  ["jade: { color: 0x4f9e86, roughness: 0.32, metalness: 0.12,",
   "jade: { color: 0x4f9e86, roughness: 0.32, metalness: 0,", "white.jade 0.12->0"],
  ["feather: { color: 0xc4d3f0, roughness: 0.86, metalness: 0.02,",
   "feather: { color: 0xc4d3f0, roughness: 0.86, metalness: 0,", "white.feather 0.02->0"],
  ["stone: { color: 0x9d9482, roughness: 0.92, metalness: 0.03,",
   "stone: { color: 0x9d9482, roughness: 0.92, metalness: 0,", "white.stone 0.03->0"],

  ["wood: { color: 0x4a3323, roughness: 0.85, metalness: 0.05,",
   "wood: { color: 0x63472f, roughness: 0.85, metalness: 0,", "black.wood 0.05->0, albedo lift"],
  ["leather: { color: 0x5f1d17, roughness: 0.76, metalness: 0.1,",
   "leather: { color: 0x6d251e, roughness: 0.76, metalness: 0,", "black.leather 0.1->0, lift"],
  ["cloth: { color: 0x82201a, roughness: 0.8, metalness: 0.08,",
   "cloth: { color: 0x82201a, roughness: 0.8, metalness: 0,", "black.cloth 0.08->0"],
  ["gem: { color: 0xffc0a4, roughness: 0.08, metalness: 0.05,",
   "gem: { color: 0xffc0a4, roughness: 0.08, metalness: 0,", "black.gem 0.05->0"],
  ["obsidian: { color: 0x0e1015, roughness: 0.08, metalness: 0.42,",
   "obsidian: { color: 0x2a2d36, roughness: 0.18, metalness: 0,", "black.obsidian 0.42->0, albedo 0.0032->0.024"],
  ["jade: { color: 0x2fb8a2, roughness: 0.3, metalness: 0.14,",
   "jade: { color: 0x2fb8a2, roughness: 0.3, metalness: 0,", "black.jade 0.14->0"],
  ["feather: { color: 0xd8452c, roughness: 0.88, metalness: 0.02,",
   "feather: { color: 0xd8452c, roughness: 0.88, metalness: 0,", "black.feather 0.02->0"],
  ["stone: { color: 0x6d6558, roughness: 0.94, metalness: 0.03,",
   "stone: { color: 0x6d6558, roughness: 0.94, metalness: 0,", "black.stone 0.03->0"],
];

const applied = [];
const missed = [];
for (const [find, replace, label] of paletteFixes) {
  if (src.includes(find)) {
    src = src.replace(find, replace);
    applied.push(label);
  } else {
    missed.push(label);
  }
}

// ------------------------------------------------------ 2. UVs instead of nuke
// Box-projected UVs derived from the merged bounding box. Deterministic, needs
// no authored unwrap, and is sufficient for a tiling detail normal/roughness
// pair on hard-surface props at the camera distances this game uses.
const uvOld = `      plain.deleteAttribute("uv");
      plain.deleteAttribute("uv1");`;
const uvNew = `      // TF_S2_WEAPON_SURFACE: build a box-projected uv set rather than
      // deleting it. Deleting uv made every weapon material incapable of
      // binding a normal/roughness map, which is the measured cause of the
      // flat-plastic read on all 15 weapons.
      plain.deleteAttribute("uv1");
      applyBoxUV(plain);`;

let uvPatched = false;
if (src.includes(uvOld)) {
  src = src.replace(uvOld, uvNew);
  uvPatched = true;
} else {
  const alt = uvOld.replace(/\n/g, "\r\n");
  if (src.includes(alt)) {
    src = src.replace(alt, uvNew.replace(/\n/g, "\r\n"));
    uvPatched = true;
  }
}

// ------------------------------------------------- 3. helper + surface binding
const helper = `
// --------------------------------------------------------------- TF_S2 detail

/**
 * Box-projects a uv set from object space. Each triangle takes the plane its
 * normal points at most strongly, so a merged hard-surface prop gets coherent,
 * non-stretched texel density without an authored unwrap.
 */
function applyBoxUV(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  // Guard degenerate axes so a flat plate cannot divide by zero.
  const sx = size.x > 1e-5 ? size.x : 1;
  const sy = size.y > 1e-5 ? size.y : 1;
  const sz = size.z > 1e-5 ? size.z : 1;

  const pos = geometry.getAttribute("position");
  if (!pos) return;
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const nrm = geometry.getAttribute("normal");

  // Scale so one uv unit is a fixed world size - texel density stays constant
  // between a dagger and a greatsword instead of stretching to fit.
  const DENSITY = 1.6;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = (pz - box.min.z) / sz;
      v = (py - box.min.y) / sy;
      u *= sz * DENSITY;
      v *= sy * DENSITY;
    } else if (ay >= ax && ay >= az) {
      u = (px - box.min.x) / sx;
      v = (pz - box.min.z) / sz;
      u *= sx * DENSITY;
      v *= sz * DENSITY;
    } else {
      u = (px - box.min.x) / sx;
      v = (py - box.min.y) / sy;
      u *= sx * DENSITY;
      v *= sy * DENSITY;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
`;

// Insert the helper just before the caching section.
const cacheMarker = "// ------------------------------------------------------------------- caching";
if (src.includes(cacheMarker)) {
  src = src.replace(cacheMarker, helper.trimStart() + "\r\n" + cacheMarker);
}

// Bind detail maps in makeMaterial. Metals get the hammered metal surface,
// everything else gets the fine wear breakup.
const matOld = `  material.emissiveIntensity = spec.emissiveIntensity;
  material.envMapIntensity = role === "gem" ? 0.6 : 1.3;
  return material;`;
const matNew = `  material.emissiveIntensity = spec.emissiveIntensity;
  material.envMapIntensity = role === "gem" ? 0.6 : 1.3;

  // TF_S2_WEAPON_SURFACE: relief + roughness variation. Gems stay clean (a
  // polished stone genuinely is smooth); every other role gets an authored
  // surface so it reads as a material rather than tinted plastic.
  if (role !== "gem") {
    const surface = spec.metalness > 0.5 ? metalSurface() : wearSurface();
    material.normalMap = surface.normal;
    material.roughnessMap = surface.roughness;
    material.normalScale.set(0.55, 0.55);
  }
  return material;`;

let matPatched = false;
for (const variant of [matOld, matOld.replace(/\n/g, "\r\n")]) {
  if (src.includes(variant)) {
    src = src.replace(variant, matNew.replace(/\n/g, "\r\n"));
    matPatched = true;
    break;
  }
}

// Import the surfaces.
if (!src.includes('from "./detail"')) {
  const anchor = 'import * as THREE from "three";';
  src = src.replace(anchor, anchor + '\r\n\r\nimport { metalSurface, wearSurface } from "./detail";');
}

fs.writeFileSync(file, src);
console.log(JSON.stringify({
  changed: src !== before,
  paletteApplied: applied.length,
  paletteMissed: missed,
  uvPatched,
  matPatched,
}, null, 2));
