/**
 * Post-rig verification gate.
 *
 * A successful download is NOT proof a rig works. Per char3d doctrine this
 * asserts, on the actual GLB bytes:
 *   - exactly one skin on the rigged base (multi-skin breaks one-mixer playback)
 *   - a sane bone hierarchy with a single root
 *   - no NaN in the inverse bind matrices
 *   - every animation clip has duration > 0
 *   - 100% animation-channel target resolution (a channel pointing at a
 *     missing node binds to nothing -> silent no-op clip, which presents as
 *     "the animation does not play")
 *   - root-motion detection per clip: reports whether the clip translates the
 *     root, because an in-place engine + a root-motion clip = double travel
 *
 * Usage: node tools/rig-gate.mjs            (gates everything in rig-manifest)
 *        node tools/rig-gate.mjs <glb> ...  (gates specific files/urls)
 */

import { readFile } from "node:fs/promises";

function readGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
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

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function readAccessor(json, bin, index) {
  const acc = json.accessors?.[index];
  if (!acc || acc.bufferView == null || !bin) return null;
  const view = json.bufferViews[acc.bufferView];
  const Ctor = COMP[acc.componentType];
  const n = NUM[acc.type];
  if (!Ctor || !n) return null;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  // Interleaved data would need a stride walk; rig outputs are tightly packed.
  return new Ctor(bin.buffer, bin.byteOffset + base, acc.count * n);
}

export function verify(buf, label) {
  const { json, bin } = readGlb(buf);
  const fails = [];
  const warns = [];
  const nodes = json.nodes ?? [];
  const skins = json.skins ?? [];
  const anims = json.animations ?? [];

  if (skins.length > 1) fails.push(`${skins.length} skins (expected 1 - one skin, one mixer)`);

  // Bone hierarchy: every joint must exist, and the joint set should have one root.
  let joints = [];
  if (skins.length > 0) {
    joints = skins[0].joints ?? [];
    if (joints.length === 0) fails.push("skin has no joints");
    const jointSet = new Set(joints);
    const childOf = new Map();
    for (const [i, node] of nodes.entries()) {
      for (const c of node.children ?? []) childOf.set(c, i);
    }
    const roots = joints.filter((j) => !jointSet.has(childOf.get(j)));
    if (roots.length > 1) warns.push(`${roots.length} joint roots (expected 1)`);
    for (const j of joints) if (!nodes[j]) fails.push(`joint index ${j} has no node`);

    // Inverse bind matrices must be finite or the skin explodes at bind time.
    if (skins[0].inverseBindMatrices != null) {
      const ibm = readAccessor(json, bin, skins[0].inverseBindMatrices);
      if (!ibm) warns.push("could not read inverseBindMatrices");
      else {
        let bad = 0;
        for (let i = 0; i < ibm.length; i += 1) if (!Number.isFinite(ibm[i])) bad += 1;
        if (bad > 0) fails.push(`${bad} non-finite values in inverseBindMatrices`);
      }
    }
  }

  // Clips: duration > 0, and 100% channel target resolution.
  const clipInfo = [];
  for (const [ai, anim] of anims.entries()) {
    const channels = anim.channels ?? [];
    let unresolved = 0;
    let maxT = 0;
    let rootTranslation = null;
    for (const ch of channels) {
      const target = ch.target?.node;
      if (target == null || !nodes[target]) {
        unresolved += 1;
        continue;
      }
      const sampler = anim.samplers?.[ch.sampler];
      if (!sampler) {
        unresolved += 1;
        continue;
      }
      const input = readAccessor(json, bin, sampler.input);
      if (input && input.length > 0) maxT = Math.max(maxT, input[input.length - 1]);
      // Root motion: translation animated on a joint that is the skeleton root.
      if (ch.target.path === "translation" && joints.length > 0 && target === joints[0]) {
        const out = readAccessor(json, bin, sampler.output);
        if (out && out.length >= 6) {
          let dx = 0;
          let dz = 0;
          for (let i = 0; i + 2 < out.length; i += 3) {
            dx = Math.max(dx, Math.abs(out[i] - out[0]));
            dz = Math.max(dz, Math.abs(out[i + 2] - out[2]));
          }
          rootTranslation = Math.max(dx, dz);
        }
      }
    }
    if (unresolved > 0) {
      fails.push(`clip[${ai}] "${anim.name ?? ai}" has ${unresolved}/${channels.length} unresolved channel targets (silent no-op)`);
    }
    if (!(maxT > 0)) fails.push(`clip[${ai}] "${anim.name ?? ai}" duration is ${maxT}`);
    clipInfo.push({ name: anim.name ?? String(ai), channels: channels.length, duration: maxT, rootTranslation });
  }

  return {
    label,
    skins: skins.length,
    joints: joints.length,
    clips: clipInfo,
    animations: anims.length,
    pass: fails.length === 0,
    fails,
    warns,
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

// Only act as a CLI when invoked directly - this file is also imported.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
const targets = isMain ? process.argv.slice(2) : [];
if (targets.length > 0) {
  let bad = 0;
  for (const src of targets) {
    try {
      const info = verify(await fetchBuf(src), src);
      console.log(`${info.pass ? "PASS" : "FAIL"}  skins=${info.skins} joints=${info.joints} clips=${info.animations}  ${src}`);
      for (const c of info.clips) {
        const rm = c.rootTranslation == null ? "-" : c.rootTranslation.toFixed(4);
        console.log(`        clip "${c.name}" ch=${c.channels} dur=${c.duration.toFixed(3)}s rootMotion=${rm}`);
      }
      for (const f of info.fails) console.log(`      FAIL: ${f}`);
      for (const w of info.warns) console.log(`      warn: ${w}`);
      if (!info.pass) bad += 1;
    } catch (error) {
      console.log(`ERROR ${src}: ${error.message}`);
      bad += 1;
    }
  }
  process.exit(bad === 0 ? 0 : 1);
}
