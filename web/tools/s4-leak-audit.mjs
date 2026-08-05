/**
 * S4 teardown / leak audit.
 *
 * Drives the REAL UI (menu -> game -> menu) rather than calling a probe
 * helper. An earlier draft of this file called window.__kg.routeToMenu(),
 * which does not exist - the calls would have silently no-opped and the
 * audit would have reported a clean pass while testing nothing. Driving the
 * actual buttons is the only version of this test that can fail honestly.
 *
 * Checks the counters Three tracks exactly (geometries, textures, programs)
 * plus DOM/canvas counts, rather than JS heap numbers a GC can make say
 * anything.
 *
 * Run ALONE - never alongside the perf matrix.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const OUT = "tools/out/s4-leak-audit.json";
const CYCLES = Number(process.env.S4_CYCLES ?? 6);
const IDLE_MS = Number(process.env.S4_IDLE ?? 20000);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

function snap() {
  return page.evaluate(() => {
    let s = null;
    try {
      s = window.__kg && window.__kg.ready() ? window.__kg.census() : null;
    } catch {
      s = null;
    }
    return {
      geometries: s ? s.geometries : null,
      textures: s ? s.textures : null,
      programs: s ? s.programs : null,
      canvases: document.querySelectorAll("canvas").length,
      domNodes: document.querySelectorAll("*").length,
    };
  });
}

// Probe=1 only. NOT review=1: review mode skips the intro and can pin the
// app past the menu, and this audit must exercise the real menu route.
await page.goto(`${BASE}/?probe=1&quality=high&seed=s4-leak`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });
await page.waitForTimeout(3000);

// Dismiss the intro ("CLICK TO SKIP") so the menu is interactive.
const skip = page.getByRole("button", { name: /click to skip/i }).first();
if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
await page.mouse.click(720, 450).catch(() => {});
await page.waitForTimeout(2500);

async function clickText(rx, timeout = 8000) {
  const el = page.getByRole("button", { name: rx }).first();
  await el.waitFor({ state: "visible", timeout });
  await el.click({ timeout });
}

async function enterGame() {
  // Real labels, dumped from the live DOM: the tab is "Showcase" and the
  // start control is "Take the field". An earlier draft looked for
  // /begin|start|watch|play/ and silently never started a game, which is
  // why every cycle reported entered=true but nothing was torn down.
  await clickText(/^Showcase$/);
  await page.waitForTimeout(800);
  // The Showcase tab's start control is "Roll the showcase", NOT "Take the
  // field" (that label belongs to the Computer tab). Dumped from live DOM.
  await clickText(/Roll the showcase/i);
  await page.waitForTimeout(5000);
}

async function backToMenu() {
  // The HUD's return-to-menu control is an IconButton rendered with
  // title="New game" and no aria-label, so getByRole(name:) does NOT match
  // it. Select on the title attribute, which is what the DOM actually has.
  const selectors = ['button[title="New game"]', 'button[aria-label="New game"]'];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(800);
      const yes = page.getByRole("button", { name: /confirm|yes|leave|resign/i }).first();
      if (await yes.isVisible().catch(() => false)) await yes.click().catch(() => {});
      await page.waitForTimeout(1800);
      return true;
    }
  }
  return false;
}

const baseline = await snap();
console.log("baseline (menu):", JSON.stringify(baseline));

const cycles = [];
let routed = 0;
for (let i = 0; i < CYCLES; i += 1) {
  let entered = true;
  try {
    await enterGame();
  } catch (e) {
    entered = false;
    console.log(`cycle ${i + 1}: could not enter game - ${String(e).slice(0, 120)}`);
  }
  // Prove we are actually IN the game, not still on the menu. The HUD's
  // "New game" icon button only exists in the playing phase.
  const inGame = await page
    .locator('button[title="New game"]')
    .first()
    .isVisible()
    .catch(() => false);
  const atGame = await snap();
  const back = inGame ? await backToMenu() : false;
  await page.waitForTimeout(1800);
  // Prove we are actually BACK on the menu.
  const onMenu = await page
    .getByRole("button", { name: /^Showcase$/ })
    .first()
    .isVisible()
    .catch(() => false);
  const atMenu = await snap();
  if (entered && inGame && back && onMenu) routed += 1;
  cycles.push({ i: i + 1, entered, inGame, back, onMenu, atGame, atMenu });
  console.log(
    `cycle ${i + 1}: entered=${entered} inGame=${inGame} back=${back} onMenu=${onMenu} game ${JSON.stringify(atGame)} menu ${JSON.stringify(atMenu)}`,
  );
}

console.log(`idling ${IDLE_MS}ms ...`);
await page.waitForTimeout(IDLE_MS);
const afterIdle = await snap();
console.log("after idle:", JSON.stringify(afterIdle));

const d = (a, b) => (a == null || b == null ? null : a - b);
const delta = {
  geometries: d(afterIdle.geometries, baseline.geometries),
  textures: d(afterIdle.textures, baseline.textures),
  programs: d(afterIdle.programs, baseline.programs),
  canvases: d(afterIdle.canvases, baseline.canvases),
  domNodes: d(afterIdle.domNodes, baseline.domNodes),
};
console.log("delta vs baseline:", JSON.stringify(delta));
console.log(`routed cleanly: ${routed}/${CYCLES}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      cycles: CYCLES,
      routedCleanly: routed,
      idleMs: IDLE_MS,
      baseline,
      cyclesDetail: cycles,
      afterIdle,
      delta,
      consoleErrors: consoleErrors.slice(0, 10),
    },
    null,
    2,
  ),
);
console.log("wrote", OUT);

await ctx.close();
await browser.close();
