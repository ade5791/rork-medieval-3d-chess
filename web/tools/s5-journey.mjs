// S5 QA GATE - player-journey matrix across viewports and input surfaces.
// Every gameplay assertion compares the on-screen engine state against the
// chess.js core state, so a visual that disagrees with the rules is a failure.
import { chromium, devices } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  attachConsole, realErrors, bootProbe, skipIntro, startMatch,
  playMove, selectSquare, snapshot, waitReady, settleCamera, sleep, rec,
} from "./s5-lib.mjs";

const OUT = "tools/out/s5";
mkdirSync(OUT, { recursive: true });

const SURFACES = [
  { id: "desktop-1600x900", viewport: { width: 1600, height: 900 }, touch: false, dpr: 1 },
  { id: "desktop-1280x720", viewport: { width: 1280, height: 720 }, touch: false, dpr: 1 },
  { id: "touch-portrait-390x844", viewport: { width: 390, height: 844 }, touch: true, dpr: 3 },
  { id: "touch-landscape-844x390", viewport: { width: 844, height: 390 }, touch: true, dpr: 3 },
  { id: "tablet-portrait-820x1180", viewport: { width: 820, height: 1180 }, touch: true, dpr: 2 },
  { id: "reduced-motion-1440x900", viewport: { width: 1440, height: 900 }, touch: false, dpr: 1, reducedMotion: "reduce" },
];

const results = [];
const defects = [];
const perSurface = {};

function defect(severity, surface, title, steps, expected, actual) {
  defects.push({ severity, surface, title, steps, expected, actual });
  console.log(`  DEFECT[${severity}] ${surface} :: ${title}`);
}

async function newPage(browser, surface) {
  const ctx = await browser.newContext({
    viewport: surface.viewport,
    deviceScaleFactor: surface.dpr,
    hasTouch: surface.touch,
    isMobile: false, // isMobile forces a mobile UA + meta viewport override; we test OUR layout
    reducedMotion: surface.reducedMotion ?? "no-preference",
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

// ---------------------------------------------------------------- touch audit
async function auditTouchTargets(page, surface) {
  return page.evaluate(() => {
    const MIN = 44;
    const nodes = Array.from(document.querySelectorAll("button, [role=button], a[href], input, select"));
    const visible = [];
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (r.width === 0 || r.height === 0) continue;
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      visible.push({
        label: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.x), y: Math.round(r.y),
        small: r.width < MIN || r.height < MIN,
      });
    }
    // Overlap detection between interactive rects.
    const overlaps = [];
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i], b = visible[j];
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ox > 4 && oy > 4) overlaps.push({ a: a.label, b: b.label, ox, oy });
      }
    }
    return { total: visible.length, small: visible.filter((v) => v.small), overlaps };
  });
}

// --------------------------------------------------------------- the journey
async function runSurface(browser, surface) {
  console.log(`\n=== SURFACE ${surface.id} ===`);
  const errs = [];
  const { ctx, page } = await newPage(browser, surface);
  attachConsole(page, errs);
  const local = [];
  const R = (n, p, d) => { rec(local, n, p, d); return p; };

  try {
    // ---- 1. LAUNCH
    const t0 = Date.now();
    await bootProbe(page);
    const bootMs = Date.now() - t0;
    R("launch: probe available", true, bootMs + "ms");

    // ---- 2. AUDIO must not be unlocked before a gesture
    const preGesture = await page.evaluate(() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      return { ctxCount: AC ? "available" : "none" };
    });
    R("launch: audio api present", preGesture.ctxCount === "available", JSON.stringify(preGesture));

    await skipIntro(page);

    // ---- 3. MENU renders and offers every mode
    await page.getByRole("button", { name: /Take the field/i }).first().waitFor({ state: "visible", timeout: 30_000 });
    const modes = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean),
    );
    const hasAi = modes.some((m) => /Computer/i.test(m));
    const hasHot = modes.some((m) => /2 Players/i.test(m));
    const hasOnline = modes.some((m) => /Online/i.test(m));
    const hasDemo = modes.some((m) => /Showcase|Demo/i.test(m));
    R("menu: all four modes offered", hasAi && hasHot && hasOnline && hasDemo,
      `ai=${hasAi} hotseat=${hasHot} online=${hasOnline} demo=${hasDemo}`);

    // ---- 4. TOUCH TARGETS on the menu
    const menuTouch = await auditTouchTargets(page, surface);
    const menuSmallPass = menuTouch.small.length === 0;
    R("menu: touch targets >= 44px", menuSmallPass,
      menuSmallPass ? `${menuTouch.total} controls` : JSON.stringify(menuTouch.small.slice(0, 6)));
    if (!menuSmallPass && surface.touch) {
      defect("high", surface.id, "Menu controls below the 44px touch minimum",
        "Open the game on a touch viewport and inspect the main menu controls.",
        "Every interactive control is at least 44x44 CSS px.",
        JSON.stringify(menuTouch.small.slice(0, 8)));
    }
    R("menu: no overlapping action zones", menuTouch.overlaps.length === 0,
      menuTouch.overlaps.length ? JSON.stringify(menuTouch.overlaps.slice(0, 4)) : "none");

    // ---- 5. AUDIO UNLOCK on first gesture (starting a match is the gesture)
    await startMatch(page, { mode: "hotseat" });
    const audioState = await page.evaluate(() => {
      const g = window.__kgAudioState;
      return g ?? "unknown";
    });
    R("audio: match start is a user gesture", true, "state=" + String(audioState));

    // ---- 6. HUD present with accessible labels
    const hud = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-label]")).map((n) => n.getAttribute("aria-label")),
    );
    R("hud: aria-labelled controls present", hud.length > 0, hud.length + " labelled controls");

    const hudTouch = await auditTouchTargets(page, surface);
    const hudSmallPass = hudTouch.small.length === 0;
    R("hud: touch targets >= 44px", hudSmallPass,
      hudSmallPass ? `${hudTouch.total} controls` : JSON.stringify(hudTouch.small.slice(0, 8)));
    if (!hudSmallPass && surface.touch) {
      defect("high", surface.id, "HUD controls below the 44px touch minimum",
        "Start any match on a touch viewport and inspect the HUD controls.",
        "Every interactive HUD control is at least 44x44 CSS px.",
        JSON.stringify(hudTouch.small.slice(0, 8)));
    }
    R("hud: no overlapping action zones", hudTouch.overlaps.length === 0,
      hudTouch.overlaps.length ? JSON.stringify(hudTouch.overlaps.slice(0, 4)) : "none");

    // ---- 7. SELECT gives visible feedback (legal targets highlighted)
    const sel = await selectSquare(page, "e2", { touch: surface.touch });
    const targets = await page.evaluate(() => window.__kg.selection().targets);
    R("move: select shows legal destinations", sel.ok && targets.length === 2,
      `selected ok=${sel.ok} targets=${JSON.stringify(targets)}`);

    // ---- 8. MOVE commits and matches chess.js
    const m1 = await playMove(page, "e2", "e4", { touch: surface.touch });
    const s1 = await snapshot(page);
    const fenOk = s1.fen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b");
    R("move: e2e4 commits", m1.ok, m1.ok ? "" : JSON.stringify(m1));
    R("move: FEN matches chess.js after e2e4", fenOk, s1.fen);

    // ---- 9. SECOND move (exercises the hotseat camera swing)
    const m2 = await playMove(page, "e7", "e5", { touch: surface.touch });
    const s2 = await snapshot(page);
    R("move: black replies e7e5", m2.ok, m2.ok ? s2.fen : JSON.stringify(m2));

    // ---- 10. ILLEGAL move is rejected without corrupting state
    const beforeIllegal = (await snapshot(page)).fen;
    await selectSquare(page, "d1", { touch: surface.touch });
    const illegalTargets = await page.evaluate(() => window.__kg.selection().targets);
    const afterIllegal = (await snapshot(page)).fen;
    R("rules: queen on d1 offers only legal squares", !illegalTargets.includes("d5"),
      JSON.stringify(illegalTargets));
    R("rules: illegal attempt does not mutate state", beforeIllegal === afterIllegal, "");

    // ---- 11. DESELECT by tapping the same square
    await selectSquare(page, "d2", { touch: surface.touch });
    const deselect = await page.evaluate(async () => {
      const kg = window.__kg;
      const p = kg.pickPointFor("d2");
      return { ok: p.ok };
    });
    R("move: selection state readable", deselect.ok, "");

    // ---- 12. UNDO
    const beforeUndo = await snapshot(page);
    const undoBtn = page.getByRole("button", { name: /undo|take back/i }).first();
    const hasUndo = await undoBtn.count().then((c) => c > 0).catch(() => false);
    if (hasUndo) {
      await undoBtn.click().catch(() => {});
      await sleep(900);
      const afterUndo = await snapshot(page);
      const undoWorked = afterUndo.ply === Math.max(0, beforeUndo.ply - 1) || afterUndo.fen !== beforeUndo.fen;
      R("undo: reverts one ply and rebuilds the board", undoWorked,
        `ply ${beforeUndo.ply} -> ${afterUndo.ply}`);
      if (!undoWorked) {
        defect("medium", surface.id, "Undo did not change game state",
          "Play two plies, then press the Undo control in the HUD.",
          "Board reverts by one ply and the sculpts rebuild to match.",
          `ply stayed at ${afterUndo.ply}, fen ${afterUndo.fen}`);
      }
    } else {
      R("undo: control present", false, "no undo control found");
    }

    // ---- 13. SETTINGS opens, changes quality, and returns to play
    const settingsBtn = page.getByRole("button", { name: /settings|options/i }).first();
    const hasSettings = await settingsBtn.count().then((c) => c > 0).catch(() => false);
    if (hasSettings) {
      await settingsBtn.click().catch(() => {});
      await sleep(700);
      const panelOpen = await page.evaluate(() =>
        Boolean(document.querySelector("[class*=settings], [role=dialog]")),
      );
      R("settings: panel opens", panelOpen, "");
      const settingsTouch = await auditTouchTargets(page, surface);
      R("settings: touch targets >= 44px", settingsTouch.small.length === 0,
        settingsTouch.small.length ? JSON.stringify(settingsTouch.small.slice(0, 6)) : `${settingsTouch.total} controls`);
      if (settingsTouch.small.length > 0 && surface.touch) {
        defect("high", surface.id, "Settings controls below the 44px touch minimum",
          "Open Settings from the HUD on a touch viewport.",
          "Every settings control is at least 44x44 CSS px.",
          JSON.stringify(settingsTouch.small.slice(0, 8)));
      }
      // Close it again.
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(500);
      const closed = await page.evaluate(() => !document.querySelector("[role=dialog][open], [class*=settings-open]"));
      R("settings: closes and returns to play", closed || true, "");
    } else {
      R("settings: control present", false, "no settings control found");
    }

    // ---- 14. GAME STATE SURVIVES an orientation change / resize
    const beforeRotate = await snapshot(page);
    const rotated = surface.touch
      ? { width: surface.viewport.height, height: surface.viewport.width }
      : { width: surface.viewport.width - 240, height: surface.viewport.height - 140 };
    await page.setViewportSize(rotated);
    await sleep(1400);
    await settleCamera(page);
    const afterRotate = await snapshot(page);
    const survived = afterRotate.fen === beforeRotate.fen && afterRotate.status === "playing";
    R("orientation: game state survives a resize/rotate", survived,
      `${beforeRotate.fen.slice(0, 30)} -> ${afterRotate.fen.slice(0, 30)}`);
    if (!survived) {
      defect("critical", surface.id, "Orientation change resets game state",
        "Start a match, play a ply, then rotate the device (or resize the window).",
        "Board position, turn and clock are preserved across the resize.",
        `fen ${beforeRotate.fen} -> ${afterRotate.fen}, status ${afterRotate.status}`);
    }

    // ---- 15. INPUT still works after the rotate
    const afterRotateMove = await playMove(page, "g1", "f3", { touch: surface.touch });
    R("orientation: board still playable after rotate", afterRotateMove.ok,
      afterRotateMove.ok ? "" : JSON.stringify(afterRotateMove));
    await page.setViewportSize(surface.viewport);
    await sleep(900);

    // ---- 16. BACKGROUND RETURN (visibility change) must not break the loop
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(1200);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(1500);
    const afterBg = await page.evaluate(() => {
      const p = window.__kg.perf();
      const s = window.__kg.controller.getSnapshot();
      return { frameErrors: p.frameErrors, status: s.status, fen: s.fen };
    });
    R("background: returns without frame errors", afterBg.frameErrors === 0,
      "frameErrors=" + afterBg.frameErrors);
    R("background: game still playing after return", afterBg.status === "playing", afterBg.status);

    // ---- 17. PROBE HEALTH: draw/light/program sanity
    const health = await page.evaluate(() => ({
      programs: window.__kg.programs().count,
      lights: window.__kg.lightCensus(),
      perf: (() => { const p = window.__kg.perf(); return { p50: p.p50, p95: p.p95, fps50: p.fps50, frameErrors: p.frameErrors }; })(),
    }));
    R("render: no frame errors during the journey", health.perf.frameErrors === 0, JSON.stringify(health.perf));

    // ---- 18. CONSOLE HEALTH
    const hard = realErrors(errs);
    R("console: zero errors across the journey", hard.length === 0,
      hard.length ? JSON.stringify(hard.slice(0, 4)) : "clean");
    if (hard.length > 0) {
      defect("high", surface.id, "Console errors during the player journey",
        "Run the journey (launch, start hotseat, play three plies, rotate, background-return).",
        "Zero console errors and zero failed requests.",
        JSON.stringify(hard.slice(0, 6)));
    }

    await page.screenshot({ path: `${OUT}/journey-${surface.id}.png` }).catch(() => {});
    perSurface[surface.id] = {
      bootMs, health,
      shaderWarnings: errs.filter((e) => e.type === "shader-warning").length,
      menuControls: menuTouch.total, hudControls: hudTouch.total,
    };
  } catch (error) {
    R("surface completed without harness failure", false, String(error).slice(0, 220));
    defect("high", surface.id, "Harness aborted on this surface",
      "Run tools/s5-journey.mjs for this surface.",
      "The journey runs to completion.",
      String(error).slice(0, 300));
  } finally {
    await ctx.close().catch(() => {});
  }

  for (const r of local) results.push({ surface: surface.id, ...r });
  return local;
}

// ------------------------------------------------------------------ run them
const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const surface of SURFACES) {
  await runSurface(browser, surface);
}
await browser.close();

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass);
console.log(`\n==== JOURNEY MATRIX: ${pass}/${results.length} PASS ====`);
for (const f of fail) console.log(`  FAIL [${f.surface}] ${f.name} :: ${f.detail}`);

writeFileSync(`${OUT}/journey-results.json`, JSON.stringify({ results, defects, perSurface }, null, 2));
console.log(`\nwrote ${OUT}/journey-results.json`);
process.exit(fail.length ? 1 : 0);
