/**
 * Runtime bind proof for the whole era roster.
 *
 * For each piece: load the rigged base with the real GLTFLoader, retarget every
 * clip's tracks onto that skeleton by bone name, run a real AnimationMixer, and
 * measure local joint quaternion drift.
 *
 * Fails loudly on: unresolved track targets (the silent no-op clip that presents
 * as "the animation does not play"), zero-duration clips, and sub-threshold pose
 * drift (loaded but not actually deforming).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Minimal DOM shims so GLTFLoader's texture path no-ops under Node.
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
      width: 1, height: 1, style: {},
      addEventListener() {}, removeEventListener() {},
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        fillRect() {},
      }),
    }),
    createElement() { return this.createElementNS(); },
  };
}

const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const MIN_DRIFT_DEG = 1.0;
const CLIPS = ["idle", "attack", "death", "walk", "run"];
const loader = new GLTFLoader();

function parse(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, "", res, rej));
}

const report = JSON.parse(await readFile(path.join(ROOT, "tools", "out", "roster-report.json"), "utf8"));
const results = [];
let fails = 0;

for (const [era, pieces] of Object.entries(report)) {
  for (const [kind, row] of Object.entries(pieces)) {
    const rigged = await parse(await readFile(path.join(ROOT, "public", row.files.rigged.replace(/^\//, ""))));

    // Collect the skeleton's bones once.
    const bones = new Map();
    let skinned = null;
    rigged.scene.traverse((o) => {
      if (o.isBone) bones.set(o.name, o);
      if (o.isSkinnedMesh && !skinned) skinned = o;
    });

    for (const name of CLIPS) {
      if (!row.files[name]) continue;
      const g = await parse(await readFile(path.join(ROOT, "public", row.files[name].replace(/^\//, ""))));
      const clip = g.animations[0];
      if (!clip) { console.log(`FAIL ${era}/${kind}/${name}: no animation in file`); fails += 1; continue; }

      // Resolve every track against the RIGGED skeleton (not the clip's own scene).
      let resolved = 0;
      const tracked = new Set();
      for (const t of clip.tracks) {
        const boneName = t.name.split(".")[0];
        if (bones.has(boneName)) { resolved += 1; tracked.add(boneName); }
      }
      const pct = clip.tracks.length ? (resolved / clip.tracks.length) * 100 : 0;

      // Snapshot local quaternions, run the mixer, measure drift.
      const watch = [...tracked].map((b) => bones.get(b));
      const before = watch.map((b) => b.quaternion.clone());
      const mixer = new THREE.AnimationMixer(rigged.scene);
      const action = mixer.clipAction(clip);
      action.play();
      mixer.update(Math.min(0.5, clip.duration * 0.35));
      rigged.scene.updateMatrixWorld(true);
      let drift = 0;
      watch.forEach((b, i) => {
        const d = THREE.MathUtils.radToDeg(before[i].angleTo(b.quaternion));
        if (d > drift) drift = d;
      });
      action.stop();
      mixer.uncacheClip(clip);
      watch.forEach((b, i) => b.quaternion.copy(before[i]));

      const ok = pct === 100 && clip.duration > 0 && drift >= MIN_DRIFT_DEG;
      if (!ok) fails += 1;
      results.push({ era, kind, clip: name, resolvedPct: pct, duration: +clip.duration.toFixed(2), tracks: clip.tracks.length, driftDeg: +drift.toFixed(2), pass: ok });
      console.log(
        `${ok ? "PASS" : "FAIL"} ${era}/${kind}/${name.padEnd(6)} tracks=${String(clip.tracks.length).padStart(3)} resolved=${pct.toFixed(0)}% dur=${clip.duration.toFixed(2)}s drift=${drift.toFixed(2)}deg`,
      );
    }
  }
}

await writeFile(path.join(ROOT, "tools", "out", "bind-report.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length} clips checked, ${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
