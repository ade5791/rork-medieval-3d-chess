/**
 * Pre-rig gate. Cheap local checks that each prevent a PAID auto-rig failure.
 *
 * Checked (per char3d doctrine):
 *   1. GLB parses and has a JSON chunk.
 *   2. A base colour texture exists (untextured meshes rig badly / fail).
 *   3. Triangle count is under the 300k auto-rig cap.
 *   4. Measured bbox height, which must then be passed as the rig height.
 *   5. Facing heuristic: a humanoid facing +Z is WIDER in X than deep in Z.
 *      A depth-dominant bbox means the mesh faces along X and will 422.
 *
 * Usage: node tools/prerig-gate.mjs <url-or-path> [...]
 * Exit code is non-zero if any asset FAILS.
 */

import { readFile } from "node:fs/promises";

const MAX_TRIS = 300000;

function readGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const total = dv.getUint32(8, true);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < Math.min(total, buf.byteLength)) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)));
    else if (type === 0x004e4942) bin = buf.subarray(start, start + len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("no JSON chunk");
  return { json, bin };
}

/** Node world matrices are needed because Meshy nests the mesh under transforms. */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let v = 0;
      for (let k = 0; k < 4; k += 1) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  }
  return o;
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function corners(min, max) {
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    out.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  }
  return out;
}

export function inspect(buf) {
  const { json } = readGlb(buf);
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];

  let tris = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices != null) tris += Math.floor((accessors[prim.indices]?.count ?? 0) / 3);
      else if (prim.attributes?.POSITION != null) tris += Math.floor((accessors[prim.attributes.POSITION]?.count ?? 0) / 3);
    }
  }

  // World-space bbox, walking the scene graph so nested transforms are honoured.
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  const walk = (index, parent) => {
    const node = nodes[index];
    if (!node) return;
    const world = mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const acc = accessors[prim.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (const corner of corners(acc.min, acc.max)) {
          const p = apply(world, corner);
          for (let i = 0; i < 3; i += 1) {
            if (p[i] < bmin[i]) bmin[i] = p[i];
            if (p[i] > bmax[i]) bmax[i] = p[i];
          }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of scene?.nodes ?? []) walk(root, identity);

  const size = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
  const textured = (json.materials ?? []).some(
    (m) => m.pbrMetallicRoughness?.baseColorTexture != null,
  );
  const skinned = (json.skins ?? []).length > 0;

  return {
    tris,
    size,
    height: size[1],
    textured,
    skinned,
    skins: (json.skins ?? []).length,
    animations: (json.animations ?? []).length,
    materials: (json.materials ?? []).length,
  };
}

async function fetchBuf(src) {
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

export function gate(info) {
  const fails = [];
  const warns = [];
  if (!info.textured) fails.push("no baseColorTexture (untextured meshes rig poorly)");
  if (info.tris > MAX_TRIS) fails.push(`${info.tris} tris exceeds the ${MAX_TRIS} auto-rig cap`);
  if (!(info.height > 0)) fails.push("bbox height is zero, cannot derive rig height");
  // A humanoid facing +Z reads wider than it is deep. Depth-dominant means the
  // mesh faces along X, which is the top silent cause of a 422 at rig time.
  if (info.size[2] > info.size[0] * 1.35) {
    fails.push(`depth ${info.size[2].toFixed(3)} dominates width ${info.size[0].toFixed(3)} - mesh likely faces along X, not +Z`);
  }
  if (info.height < info.size[0] * 1.1) warns.push("figure is not clearly taller than wide - check it is a standing biped");
  return { pass: fails.length === 0, fails, warns };
}

const targets = process.argv.slice(2);
if (targets.length > 0) {
  let bad = 0;
  for (const src of targets) {
    try {
      const info = inspect(await fetchBuf(src));
      const verdict = gate(info);
      const label = verdict.pass ? "PASS" : "FAIL";
      console.log(
        `${label}  tris=${info.tris} size=${info.size.map((v) => v.toFixed(3)).join(" x ")} h=${info.height.toFixed(3)} textured=${info.textured} skins=${info.skins} clips=${info.animations}  ${src}`,
      );
      for (const f of verdict.fails) console.log(`      FAIL: ${f}`);
      for (const w of verdict.warns) console.log(`      warn: ${w}`);
      if (!verdict.pass) bad += 1;
    } catch (error) {
      console.log(`ERROR ${src}: ${error.message}`);
      bad += 1;
    }
  }
  process.exit(bad === 0 ? 0 : 1);
}
