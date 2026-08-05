/**
 * Strip a rig animation GLB down to armature + animation only.
 *
 * fal returns each action clip as a FULL skinned GLB (~10 MB: mesh, skin,
 * 4K base-colour texture) even though the engine only ever reads
 * `gltf.animations[0]`. The shipped rork clips are ~65 KB armature-only GLBs,
 * which is the same shape fal's own `walking_armature_glb` has. This tool
 * produces that shape for the custom action clips, cutting ~99% of the bytes
 * with zero change to what the mixer binds.
 *
 * Keeps: nodes (bones), animations, and only the accessors/bufferViews the
 * animation samplers reference. Drops: meshes, skins, materials, textures,
 * images, samplers, cameras, and every unreferenced buffer byte.
 *
 * Usage: node tools/glb-strip.mjs <in.glb> <out.glb>
 */

import { readFile, writeFile } from "node:fs/promises";

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function parseGlb(buf) {
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
    else if (type === 0x004e4942) bin = Buffer.from(buf.subarray(start, start + len));
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("no JSON chunk");
  return { json, bin };
}

export function buildGlb(json, bin) {
  const jsonText = JSON.stringify(json);
  const jsonBuf = Buffer.from(jsonText, "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const jsonLen = jsonBuf.length + jsonPad;
  const binLen = bin ? bin.length + binPad : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);

  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.fill(0x20, 20 + jsonBuf.length, 20 + jsonLen);
  if (bin) {
    const at = 20 + jsonLen;
    out.writeUInt32LE(binLen, at);
    out.writeUInt32LE(0x004e4942, at + 4);
    bin.copy(out, at + 8);
    out.fill(0, at + 8 + bin.length, at + 8 + binLen);
  }
  return out;
}

/** Byte length an accessor actually occupies inside its bufferView. */
function accessorBytes(acc) {
  const size = COMP_SIZE[acc.componentType] * NUM[acc.type];
  return acc.count * size;
}

export function stripToAnimation(buf) {
  const { json, bin } = parseGlb(buf);
  if (!json.animations?.length) throw new Error("no animations to keep");

  const keptAccessors = new Set();
  for (const anim of json.animations) {
    for (const s of anim.samplers ?? []) {
      keptAccessors.add(s.input);
      keptAccessors.add(s.output);
    }
  }

  // Remap accessors -> new indices, and copy only their bytes into a fresh BIN.
  const accIndex = [...keptAccessors].sort((a, b) => a - b);
  const accMap = new Map();
  const newAccessors = [];
  const newViews = [];
  const chunks = [];
  let cursor = 0;

  for (const oldIndex of accIndex) {
    const acc = json.accessors[oldIndex];
    const view = json.bufferViews[acc.bufferView];
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const len = accessorBytes(acc);
    const slice = bin.subarray(start, start + len);
    // 4-byte align every view start; glTF requires it for float accessors.
    const pad = (4 - (cursor % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      cursor += pad;
    }
    newViews.push({ buffer: 0, byteOffset: cursor, byteLength: len });
    chunks.push(Buffer.from(slice));
    cursor += len;

    const copy = { ...acc, bufferView: newViews.length - 1, byteOffset: 0 };
    delete copy.sparse;
    accMap.set(oldIndex, newAccessors.length);
    newAccessors.push(copy);
  }

  const newBin = Buffer.concat(chunks);

  // Nodes are kept as-is (they ARE the armature) but stripped of mesh/skin refs
  // so no mesh or texture is pulled in.
  const nodes = (json.nodes ?? []).map((n) => {
    const copy = { ...n };
    delete copy.mesh;
    delete copy.skin;
    delete copy.camera;
    return copy;
  });

  const animations = json.animations.map((anim) => ({
    ...anim,
    samplers: (anim.samplers ?? []).map((s) => ({
      ...s,
      input: accMap.get(s.input),
      output: accMap.get(s.output),
    })),
    channels: (anim.channels ?? []).map((c) => ({ ...c })),
  }));

  const out = {
    asset: json.asset ?? { version: "2.0" },
    scene: json.scene ?? 0,
    scenes: json.scenes ?? [{ nodes: [0] }],
    nodes,
    animations,
    accessors: newAccessors,
    bufferViews: newViews,
    buffers: [{ byteLength: newBin.length }],
  };
  if (json.extensionsUsed) out.extensionsUsed = json.extensionsUsed.filter((e) => !/texture|material|draco|meshopt/i.test(e));
  if (out.extensionsUsed?.length === 0) delete out.extensionsUsed;

  return buildGlb(out, newBin);
}

const [inPath, outPath] = process.argv.slice(2);
if (inPath && outPath) {
  const src = /^https?:/.test(inPath)
    ? Buffer.from(await (await fetch(inPath)).arrayBuffer())
    : await readFile(inPath);
  const out = stripToAnimation(src);
  await writeFile(outPath, out);
  const pct = ((1 - out.length / src.length) * 100).toFixed(1);
  console.log(`${src.length} -> ${out.length} bytes (-${pct}%)  ${outPath}`);
}
