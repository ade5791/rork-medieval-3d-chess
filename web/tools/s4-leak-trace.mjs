// S4: two texture-disposal fixes changed the leak by exactly zero, which
// means neither code path runs on this route. Stop patching and instrument:
// count live PieceView instances and watch what actually happens across a
// menu->game->menu cycle.
import { chromium } from "playwright";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(`${BASE}/?probe=1&quality=high&seed=s4-trace`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const skip = page.getByRole("button", { name: /click to skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
await page.waitForTimeout(2500);

// Wrap WebGLRenderer texture allocation so we can see WHEN textures appear
// and whether anything is ever disposed.
await page.evaluate(() => {
  window.__leak = { created: 0, disposed: 0, byStack: {} };
  const scene = window.__kg.scene();
  // Count piece groups directly - that is what a "game" adds.
  window.__countPieces = () => {
    let n = 0;
    for (const c of scene.children) if (String(c.name).startsWith("piece_")) n += 1;
    return n;
  };
});

async function snap(label) {
  const s = await page.evaluate(() => ({
    textures: window.__kg.census().textures,
    geometries: window.__kg.census().geometries,
    pieces: window.__countPieces(),
    sceneChildren: window.__kg.scene().children.length,
  }));
  console.log(`  ${label.padEnd(28)} tex=${s.textures} geo=${s.geometries} pieceGroups=${s.pieces} sceneChildren=${s.sceneChildren}`);
  return s;
}

console.log("=== trace ===");
await snap("menu (baseline)");

for (let i = 1; i <= 3; i += 1) {
  await page.getByRole("button", { name: /^Showcase$/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Roll the showcase/i }).first().click();
  await page.waitForTimeout(5000);
  await snap(`cycle ${i} in game`);
  await page.locator('button[title="New game"]').first().click();
  await page.waitForTimeout(3000);
  await snap(`cycle ${i} back at menu`);
}

await ctx.close();
await browser.close();
