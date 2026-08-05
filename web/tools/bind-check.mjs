/**
 * Runtime bind proof: load the rigged GLB + a stripped clip with the REAL
 * three.js GLTFLoader, bind the clip to the rig with an AnimationMixer, and
 * assert the pose actually MOVES.
 *
 * A successful load is not proof the skin deforms, and a track pointing at a
 * missing bone is a silent no-op. This measures local joint quaternion drift
 * between t=0 and mid-clip, which is the char3d-prescribed gate (local joint
 * quaternions, not world position).
 *
 * Usage: node tools/bind-check.mjs <rigged.glb> <clip.glb> [...more clips]
 */

import { readFile } from "node:fs/promises";

// GLTFLoader reaches for browser globals when a GLB carries embedded textures.
// We only care about the skeleton and the animation tracks, so stub just enough
// of the DOM for the texture path to no-op instead of throwing.
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
if (typeof globalThis.URL.createObjectURL === "undefined") {
  globalThis.URL.createObjectURL = () => "blob:stub";
  globalThis.URL.revokeObjectURL = () => {};
}
if (typeof globalThis.createImageBitmap === "undefined") {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElementNS: () => ({
      width: 1,
      height: 1,
      style: {},
      addEventListener() {},
      removeEventListener() {},
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        fillRect() {},
      }),
    }),
    createElement() {
      return this.createElementNS();
    },
  };
}

const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

const MIN_DRIFT_DEG = 1.0;

async function loadLocal(path) {
  const buf = /^https?:/.test(path)
    ? Buffer.from(await (await fetch(path)).arrayBuffer())
    : await readFile(path);
  const loader = new GLTFLoader();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return await loader.parseAsync(ab, "");
}

function boneMap(root) {
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  return bones;
}

const [rigPath, ...clipPaths] = process.argv.slice(2);
if (!rigPath) {
  console.error("usage: node tools/bind-check.mjs <rigged.glb> <clip.glb> ...");
  process.exit(2);
}

const rig = await loadLocal(rigPath);
const bones = boneMap(rig.scene);
let skins = 0;
rig.scene.traverse((o) => {
  if (o.isSkinnedMesh) skins += 1;
});
console.log(`rig: bones=${bones.length} skinnedMeshes=${skins}  ${rigPath}`);
if (bones.length === 0) {
  console.log("FAIL: no bones in rigged GLB");
  process.exit(1);
}

let bad = 0;
for (const clipPath of clipPaths) {
  const gltf = await loadLocal(clipPath);
  const clip = gltf.animations[0];
  if (!clip) {
    console.log(`FAIL  no animation in ${clipPath}`);
    bad += 1;
    continue;
  }

  // Bind against the rig's own hierarchy - this is what the game does.
  const mixer = new THREE.AnimationMixer(rig.scene);
  let action;
  try {
    action = mixer.clipAction(clip);
    action.play();
  } catch (error) {
    console.log(`FAIL  clipAction threw for ${clipPath}: ${error.message}`);
    bad += 1;
    continue;
  }

  // Resolution: how many tracks actually found a target in this hierarchy.
  const names = new Set();
  rig.scene.traverse((o) => names.add(o.name));
  let resolved = 0;
  for (const track of clip.tracks) {
    const target = track.name.split(".")[0];
    if (names.has(target)) resolved += 1;
  }

  mixer.setTime(0);
  const start = bones.map((b) => b.quaternion.clone());
  mixer.setTime(clip.duration * 0.5);
  let maxDeg = 0;
  for (const [i, b] of bones.entries()) {
    const deg = (2 * Math.acos(Math.min(1, Math.abs(start[i].dot(b.quaternion)))) * 180) / Math.PI;
    if (Number.isFinite(deg) && deg > maxDeg) maxDeg = deg;
  }

  const pct = ((resolved / clip.tracks.length) * 100).toFixed(0);
  const ok = resolved === clip.tracks.length && maxDeg >= MIN_DRIFT_DEG;
  console.log(
    `${ok ? "PASS" : "FAIL"}  "${clip.name}" dur=${clip.duration.toFixed(2)}s tracks=${clip.tracks.length} resolved=${pct}% poseDrift=${maxDeg.toFixed(2)}deg  ${clipPath}`,
  );
  if (resolved !== clip.tracks.length) console.log(`      FAIL: ${clip.tracks.length - resolved} tracks bound to nothing (silent no-op clip)`);
  if (maxDeg < MIN_DRIFT_DEG) console.log(`      FAIL: pose drift ${maxDeg.toFixed(3)}deg is below the ${MIN_DRIFT_DEG}deg threshold - clip does not move the rig`);
  if (!ok) bad += 1;
  mixer.stopAllAction();
  mixer.uncacheRoot(rig.scene);
}

process.exit(bad === 0 ? 0 : 1);
