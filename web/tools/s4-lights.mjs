// S4: enumerate shadow-casting lights. Each shadow-casting light re-draws every
// caster once (point lights: SIX times, one per cube face). This is the
// draw-call multiplier that decides a CPU-submission-bound frame.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const preset = process.argv[2] ?? "ultra";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?review=1&probe=1&quality=${preset}&era=classic&arena=jungle&phase=opening&seed=s4-lights`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 120000 });
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const scene = window.__kg.scene();
  const lights = [];
  let casters = 0;
  let visibleMeshes = 0;
  scene.traverse((n) => {
    if (n.isLight) {
      lights.push({
        name: n.name || n.type,
        type: n.type,
        visible: n.visible,
        intensity: n.intensity,
        castShadow: !!n.castShadow,
        mapSize: n.shadow ? `${n.shadow.mapSize.x}x${n.shadow.mapSize.y}` : null,
      });
    }
    if (n.isMesh || n.isSkinnedMesh || n.isInstancedMesh) {
      if (n.visible) visibleMeshes += 1;
      if (n.visible && n.castShadow) casters += 1;
    }
  });
  return { lights, casters, visibleMeshes, shadow: window.__kg.shadow(), draw: window.__kg.draw() };
});

console.log(`=== lights, preset ${preset} ===`);
let shadowPasses = 0;
for (const l of out.lights) {
  const faces = l.castShadow && l.visible ? (l.type === "PointLight" ? 6 : 1) : 0;
  shadowPasses += faces;
  console.log(
    `${(l.name || l.type).padEnd(22)} ${l.type.padEnd(16)} vis=${String(l.visible).padEnd(5)} int=${Number(l.intensity).toFixed(2).padStart(7)} castShadow=${String(l.castShadow).padEnd(5)} map=${l.mapSize ?? "-"} passes=${faces}`,
  );
}
console.log(`\nlights: ${out.lights.length}   visible: ${out.lights.filter((l) => l.visible).length}   shadow-casting: ${out.lights.filter((l) => l.castShadow && l.visible).length}`);
console.log(`SHADOW PASSES PER FRAME (point lights count 6): ${shadowPasses}`);
console.log(`visible meshes: ${out.visibleMeshes}   shadow casters: ${out.casters}`);
console.log(`predicted shadow draw calls: ${out.casters} casters x ${shadowPasses} passes = ${out.casters * shadowPasses}`);
console.log(`actual draw calls this frame: ${out.draw.calls}`);
console.log(`shadowMap enabled=${out.shadow.enabled} type=${out.shadow.type} autoUpdate=${out.shadow.autoUpdate}`);

await ctx.close();
await browser.close();
