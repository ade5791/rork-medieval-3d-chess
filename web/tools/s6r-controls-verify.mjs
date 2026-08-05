// Empirically verify every control the landing page claims, in a real browser
// against the staged PUBLISH bytes. Static source inspection is NOT proof that a
// binding is wired; each claim below is confirmed by an observed state change.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.S6_BASE || "http://127.0.0.1:8123/kings-gambit-medieval-chess";
const OUT = process.env.S6_OUT || "tools/out/s6r-controls.json";

const checks = [];
const add = (id, pass, detail) => {
  checks.push({ id, pass, detail });
  console.log((pass ? "[PASS] " : "[FAIL] ") + id + " :: " + detail);
};

const run = async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(BASE + "/?probe=1", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__kg, null, { timeout: 90000 });

  for (let i = 0; i < 30; i++) {
    if (await page.getByRole("button", { name: /Take the field/i }).first().isVisible().catch(() => false)) break;
    await page.locator("text=CLICK TO SKIP").first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(700);
  }

  await page.getByText(/Two players/i).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Take the field/i }).first().click({ timeout: 10000 });
  await page.waitForFunction(() => {
    const k = window.__kg;
    return k && k.controller && k.controller.getSnapshot().status === "playing";
  }, null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  const cam = () => page.evaluate(() => window.__kg.cameraState());

  const cfg = await cam();
  add("controls.config", cfg.enableRotate === true && cfg.enabled === true,
    "enableZoom=" + cfg.enableZoom + " enableRotate=" + cfg.enableRotate +
    " enablePan=" + cfg.enablePan + " range=" + cfg.minDistance + ".." + cfg.maxDistance);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // ---- SCROLL = ZOOM ----
  const z0 = (await cam()).distance;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(80); }
  await page.waitForTimeout(900);
  const z1 = (await cam()).distance;
  add("controls.scrollZoom", Math.abs(z1 - z0) > 0.25,
    "camera distance " + z0 + " -> " + z1 + " (delta " + Number((z1 - z0).toFixed(3)) + ")");

  // ---- DRAG = ORBIT ----
  const a0 = (await cam()).azimuth;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(cx + i * 20, cy); await page.waitForTimeout(26); }
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const a1 = (await cam()).azimuth;
  add("controls.dragOrbit", Math.abs(a1 - a0) > 0.05, "azimuth " + a0 + " -> " + a1);

  // ---- T = tactical ----
  const t0 = (await cam()).tactical;
  await page.keyboard.press("t");
  await page.waitForTimeout(1800);
  const t1 = (await cam()).tactical;
  add("controls.key.T", t0 !== t1, "tactical " + t0 + " -> " + t1);
  await page.keyboard.press("t");
  await page.waitForTimeout(1800);

  // ---- C = cinema (HUD hidden) ----
  const hud = () => page.evaluate(() => document.querySelectorAll("[aria-label]").length);
  const h0 = await hud();
  await page.keyboard.press("c");
  await page.waitForTimeout(1000);
  const h1 = await hud();
  add("controls.key.C", h1 < h0, "aria-labelled controls " + h0 + " -> " + h1);
  await page.keyboard.press("c");
  await page.waitForTimeout(800);

  // ---- F = flip camera ----
  const f0 = (await cam()).azimuth;
  await page.keyboard.press("f");
  await page.waitForTimeout(2600);
  const f1 = (await cam()).azimuth;
  add("controls.key.F", Math.abs(f1 - f0) > 1.0, "azimuth " + f0 + " -> " + f1);

  // ---- H = chronicle ----
  const bodyText = () => page.evaluate(() => document.body.innerText.length);
  const b0 = await bodyText();
  await page.keyboard.press("h");
  await page.waitForTimeout(1000);
  const b1 = await bodyText();
  add("controls.key.H", b1 !== b0, "body text length " + b0 + " -> " + b1 + " (chronicle toggles)");
  await page.keyboard.press("h");
  await page.waitForTimeout(700);

  // ---- Escape closes settings ----
  // Use the SAME exact-name locator the S5 gate uses; a loose /settings/i regex
  // matches a different control and produces a false failure.
  let escOk = false, escDetail = "settings control not found";
  const sBtn = page.getByRole("button", { name: /^Settings$/i }).first();
  if (await sBtn.isVisible().catch(() => false)) {
    await sBtn.click();
    const open = await page
      .locator("text=/Graphics|Quality|Battleground|Era/i")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const closed = (await page.locator("text=/Battleground|Graphics/i").count()) === 0;
    escOk = open && closed;
    escDetail = "opened=" + open + " closedAfterEscape=" + closed;
  }
  add("controls.key.Escape", escOk, escDetail);

  // ---- tap-select then tap-destination ----
  const fen0 = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
  const p1 = await page.evaluate(() => window.__kg.pickPointFor("e2"));
  const p2 = await page.evaluate(() => window.__kg.pickPointFor("e4"));
  if (p1 && p2) {
    await page.mouse.click(box.x + p1.x, box.y + p1.y);
    await page.waitForTimeout(700);
    await page.mouse.click(box.x + p2.x, box.y + p2.y);
    await page.waitForTimeout(2200);
  }
  const fen1 = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
  add("controls.tapToMove", fen0 !== fen1, "fen " + (fen0 === fen1 ? "unchanged" : "changed after tap-tap"));

  add("controls.consoleClean", errors.length === 0, "console errors=" + errors.length);

  const report = {
    base: BASE,
    checkedAt: new Date().toISOString(),
    total: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    checks,
    consoleErrors: errors.slice(0, 8),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("==== CONTROLS: " + report.passed + "/" + report.total + " verified ====");
  await browser.close();
  process.exit(report.failed === 0 ? 0 : 1);
};

run().catch((e) => { console.error("CONTROLS VERIFY FAILED", e); process.exit(2); });
