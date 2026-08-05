// S4: identify WHICH textures accumulate across a menu->game->menu cycle.
// Reading source has ruled out the cached badge/token/wear maps, so measure
// instead: hook Three's texture allocation and bucket live textures by their
// image dimensions and source kind.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(`${BASE}/?probe=1&quality=high&seed=s4-leaksrc`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const skip = page.getByRole("button", { name: /click to skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
await page.waitForTimeout(2500);

// Walk the scene graph and bucket every texture actually referenced, so we
// can compare which buckets grow. renderer.info counts GPU uploads; this
// tells us what is still REACHABLE.
async function buckets(label) {
  const b = await page.evaluate(() => {
    const scene = window.__kg.scene();
    const seen = new Set();
    const byKind = {};
    const MAPS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "envMap"];
    scene.traverse((n) => {
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of mats) {
        for (const slot of MAPS) {
          const t = m[slot];
          if (!t || seen.has(t.uuid)) continue;
          seen.add(t.uuid);
          const img = t.image;
          const w = img && img.width ? img.width : 0;
          const h = img && img.height ? img.height : 0;
          const key = `${slot} ${w}x${h}`;
          byKind[key] = (byKind[key] || 0) + 1;
        }
      }
    });
    return { reachable: seen.size, byKind, info: window.__kg.census().textures };
  });
  console.log(`\n--- ${label} --- renderer.info.textures=${b.info} reachableInScene=${b.reachable}`);
  const rows = Object.entries(b.byKind).sort((x, y) => y[1] - x[1]);
  for (const [k, v] of rows.slice(0, 14)) console.log(`   ${String(v).padStart(4)}  ${k}`);
  return b;
}

await buckets("menu (baseline)");

for (let i = 1; i <= 3; i += 1) {
  await page.getByRole("button", { name: /^Showcase$/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Roll the showcase/i }).first().click();
  await page.waitForTimeout(5000);
  await buckets(`cycle ${i} IN GAME`);
  await page.locator('button[title="New game"]').first().click();
  await page.waitForTimeout(2500);
  await buckets(`cycle ${i} back at menu`);
}

await ctx.close();
await browser.close();
