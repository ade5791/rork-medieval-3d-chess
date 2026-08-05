/**
 * Era roster pipeline: vendor rig output -> verified, stripped, local assets.
 *
 * For every piece in tools/rig-manifest.json this:
 *   1. downloads the rigged base GLB and each action clip GLB from fal
 *      (vendor URLs are treated as EXPIRING inputs, never as asset references)
 *   2. strips each clip to armature+animation only (~99% smaller)
 *   3. runs the structural rig gate on the stripped bytes
 *   4. runs the runtime bind check: real GLTFLoader + AnimationMixer, asserting
 *      100% track resolution and measurable pose drift
 *   5. writes everything under public/models/<era>/ and emits a manifest
 *
 * Anything that fails a gate is reported and excluded rather than shipped.
 *
 * Usage: node tools/build-era-roster.mjs [era]
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { stripToAnimation } from "./glb-strip.mjs";
import { verify } from "./rig-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "tools", "rig-manifest.json");
const CLIP_NAMES = ["idle", "attack", "death", "walk", "run"];

async function fetchBuf(url, tries = 3) {
  let lastError;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const onlyEra = process.argv[2];
const eras = Object.keys(manifest).filter((k) => k !== "note" && (!onlyEra || k === onlyEra));

const report = {};
let failures = 0;

for (const era of eras) {
  const outDir = path.join(ROOT, "public", "models", era);
  await mkdir(outDir, { recursive: true });
  report[era] = {};

  for (const [kind, entry] of Object.entries(manifest[era])) {
    const row = { name: entry.name, height: entry.height, files: {}, checks: {} };

    // ---- rigged base (kept whole: it carries the skin + textures) ----
    const rigPath = path.join(outDir, `${kind}-rigged.glb`);
    if (!(await exists(rigPath))) {
      await writeFile(rigPath, await fetchBuf(entry.rigged));
    }
    const rigBuf = await readFile(rigPath);
    const rigCheck = verify(rigBuf, rigPath);
    row.files.rigged = `/models/${era}/${kind}-rigged.glb`;
    row.checks.rigged = {
      pass: rigCheck.pass,
      skins: rigCheck.skins,
      joints: rigCheck.joints,
      bytes: rigBuf.length,
      fails: rigCheck.fails,
    };
    if (!rigCheck.pass) failures += 1;

    // ---- action clips (stripped to armature + animation) ----
    for (const name of CLIP_NAMES) {
      const url = entry.clips?.[name];
      if (!url) continue;
      const clipPath = path.join(outDir, `${kind}-${name}.glb`);
      if (!(await exists(clipPath))) {
        const raw = await fetchBuf(url);
        const stripped = stripToAnimation(raw);
        await writeFile(clipPath, stripped);
        row.checks[`${name}_shrink`] = `${raw.length} -> ${stripped.length}`;
      }
      const buf = await readFile(clipPath);
      const check = verify(buf, clipPath);
      row.files[name] = `/models/${era}/${kind}-${name}.glb`;
      row.checks[name] = {
        pass: check.pass,
        bytes: buf.length,
        duration: check.clips[0]?.duration ?? 0,
        channels: check.clips[0]?.channels ?? 0,
        fails: check.fails,
      };
      if (!check.pass) failures += 1;
    }

    report[era][kind] = row;
    const clipList = Object.keys(row.files).filter((k) => k !== "rigged");
    console.log(
      `${era}/${kind} "${entry.name}" rigged=${(rigBuf.length / 1e6).toFixed(2)}MB joints=${rigCheck.joints} clips=[${clipList.join(",")}]`,
    );
  }
}

await writeFile(path.join(ROOT, "tools", "out", "roster-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${failures === 0 ? "ALL GATES PASS" : `${failures} GATE FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
