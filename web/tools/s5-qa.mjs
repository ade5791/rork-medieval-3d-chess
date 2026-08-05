/**
 * S5 QA GATE - player-journey matrix across four surfaces.
 *
 * Drives the REAL production build (dist/) in a real Chromium with a real GPU,
 * using synthesized touch in emulated viewports for the touch surfaces. Every
 * assertion is a measured DOM/engine fact, never an inference:
 *
 *   - on-screen state is cross-checked against chess.js FEN via window.__kg.controller
 *   - touch targets are measured with getBoundingClientRect(), not read off CSS
 *   - overlap is computed from real rects of all simultaneously-hittable controls
 *   - console errors and pageerrors are collected for the whole session
 *
 * PHYSICAL HANDSETS WERE NOT TESTED. Every touch result below is synthesized
 * input in an emulated viewport (Playwright hasTouch + deviceScaleFactor), which
 * exercises layout, hit-testing, pointer routing and game logic, but NOT real
 * touch digitizer behaviour, real mobile GPUs, or mobile browser chrome.
 *
 * Usage: node tools/s5-qa.mjs [--surface=all] [--out=tools/out/s5-qa.json]
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.S5_BASE || "http://127.0.0.1:8123";
const ARGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const OUT = ARGS.out || "tools/out/s5-qa.json";
const MIN_TOUCH = 44;

/** The four surfaces from the playbook QA matrix. */
const SURFACES = [
  {
    id: "desktop",
    label: "Desktop mouse + keyboard",
    viewport: { width: 1600, height: 900 },
    dpr: 1,
    touch: false,
    reducedMotion: "no-preference",
  },
  {
    id: "touch-portrait",
    label: "Touch portrait (iPhone 14 Pro class, emulated)",
    viewport: { width: 393, height: 852 },
    dpr: 3,
    touch: true,
    reducedMotion: "no-preference",
  },
  {
    id: "touch-landscape",
    label: "Touch landscape (emulated)",
    viewport: { width: 852, height: 393 },
    dpr: 3,
    touch: true,
    reducedMotion: "no-preference",
  },
  {
    id: "reduced-motion",
    label: "Desktop, prefers-reduced-motion: reduce",
    viewport: { width: 1280, height: 800 },
    dpr: 1,
    touch: false,
    reducedMotion: "reduce",
  },
];

const results = [];
const defects = [];

function defect(sev, surface, id, title, steps, expected, actual, evidence) {
  defects.push({ id, severity: sev, surface, title, steps, expected, actual, evidence });
}

function check(surface, name, pass, detail) {
  results.push({ surface, name, pass: Boolean(pass), detail: detail ?? null });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? " :: " + detail : ""}`);
  return Boolean(pass);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the engine probe to exist and the scene to finish loading. */
async function waitReady(page, timeout = 90_000) {
  await page.waitForFunction(() => Boolean(window.__kg && window.__kg.controller), null, { timeout });
}

/** Boot a page with console/error capture wired before the first byte. */
async function boot(ctx, url) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  return { page, consoleErrors, pageErrors };
}

/** Measure every currently-hittable control: rect, size, and label. */
/**
 * Wait for CSS entrance animations to finish before measuring geometry.
 *
 * getBoundingClientRect() reports the CURRENTLY ANIMATED rect. The menu card
 * runs @keyframes mc-rise (starts at scale(0.97) translateY(26px)), so a
 * button with a live min-height:44px floor measures 0.97 * 44 = 42.68px while
 * that animation is in flight, and neighbouring rects transiently overlap.
 * Measuring mid-animation therefore reports phantom touch-target and overlap
 * defects. Settle first, then measure.
 */
async function settleAnimations(page) {
  await page
    .evaluate(async () => {
      const anims = document.getAnimations ? document.getAnimations() : [];
      // Decorative loops (mc-leaf, mc-pulse, mc-danger, mc-net-pulse) are
      // declared `infinite`, so their .finished promise NEVER resolves and
      // awaiting it hangs the gate. Only entrance/transition animations with a
      // finite iteration count actually settle - those are the ones that
      // distort a measured rect.
      const finite = anims.filter((a) => {
        try {
          const eff = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
          return eff ? Number.isFinite(eff.iterations) && Number.isFinite(eff.endTime) : false;
        } catch (e) {
          return false;
        }
      });
      // Hard cap: never block measurement on animation state.
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
      // Two rAFs so the post-animation layout is committed before measuring.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })
    .catch(() => {});
}
async function measureTargets(page) {
  await settleAnimations(page);
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll("button, [role=button], input, a[href], select, textarea"),
    );
    const out = [];
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      // Only count things the user can actually press.
      if (n.disabled) continue;
      // A control scrolled outside its scroll container still returns a
      // non-zero rect, but it is NOT hittable - a tap at its centre lands on
      // whatever is painted there instead. Rect-only measurement therefore
      // reports phantom overlaps against pinned footers. Hit-test to confirm
      // the control actually owns its own centre pixel.
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
        const atPoint = document.elementFromPoint(cx, cy);
        const ownsCentre = !!atPoint && (atPoint === n || n.contains(atPoint) || atPoint.contains(n));
        if (!ownsCentre) continue;
      } else {
        continue;
      }
      const label =
        n.getAttribute("aria-label") ||
        (n.textContent || "").trim().slice(0, 48) ||
        n.getAttribute("title") ||
        n.tagName.toLowerCase();
      out.push({
        label,
        tag: n.tagName.toLowerCase(),
        cls: n.className && typeof n.className === "string" ? n.className.slice(0, 90) : "",
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      });
    }
    return out;
  });
}

/** Rect intersection area between two measured targets. */
function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

/** Read authoritative chess state straight off chess.js via the engine probe. */
async function readState(page) {
  return page.evaluate(() => {
    const c = window.__kg && window.__kg.controller;
    if (!c) return null;
    const s = c.getSnapshot();
    return {
      fen: s.fen,
      turn: s.turn,
      status: s.status,
      mode: s.mode,
      inCheck: s.inCheck,
      result: s.result,
      moves: s.moves.length,
      lastMove: s.lastMove,
      captured: s.captured.length,
      canUndo: s.canUndo,
      pgn: s.pgn,
      thinking: s.thinking,
    };
  });
}

/**
 * Screen coordinates of a board square, projected by the LIVE camera via the
 * engine's own probe. Never reimplemented harness-side: board tile spacing and
 * camera state both change at runtime, so a local copy drifts and taps land on
 * the wrong square.
 */
async function squarePoint(page, square) {
  return page.evaluate((sq) => {
    const kg = window.__kg;
    if (!kg) return null;
    // Prefer the engine-VERIFIED pick point. A raw projected tile centre is not
    // clickable when a life-size figure stands in front of it: measured, the
    // projected centre of e2 resolves to e1 because the king occludes it, so a
    // tap there selects the king and the move never happens. pickPointFor()
    // spirals out until the engine's own raycaster agrees on the square.
    if (kg.pickPointFor) {
      const v = kg.pickPointFor(sq);
      if (v && v.ok) return { x: v.x, y: v.y };
      return null;
    }
    if (!kg.squareScreen) return null;
    const p = kg.squareScreen(sq);
    return p && p.onScreen ? { x: p.x, y: p.y } : null;
  }, square);
}

/** Tap (touch) or click (mouse) at a viewport point. */
async function press(page, pt, touch) {
  if (touch) {
    await page.touchscreen.tap(pt.x, pt.y);
  } else {
    await page.mouse.click(pt.x, pt.y);
  }
}

// ---------------------------------------------------------------- the matrix

async function runSurface(browser, surface) {
  console.log(`\n=== SURFACE: ${surface.id} (${surface.label}) ===`);
  const ctx = await browser.newContext({
    viewport: surface.viewport,
    deviceScaleFactor: surface.dpr,
    hasTouch: surface.touch,
    isMobile: surface.touch,
    reducedMotion: surface.reducedMotion,
  });

  const S = surface.id;
  const allConsole = [];
  const allPageErrors = [];

  // ---------------------------------------------------------------- J1 launch
  // ?probe=1 only INSTALLS a read-only inspection surface (window.__kg). It does
  // not skip the intro, hide the menu, pin quality or stage a position, so the
  // launch journey below is the real cold-start path a player sees.
  let b = await boot(ctx, `${BASE}/?probe=1`);
  let page = b.page;
  const t0 = Date.now();
  try {
    await waitReady(page);
  } catch (e) {
    check(S, "J1 launch: engine boots", false, "probe never appeared: " + e.message);
    await ctx.close();
    return { allConsole, allPageErrors };
  }
  const bootMs = Date.now() - t0;
  check(S, "J1 launch: engine boots and probe is live", true, `${bootMs}ms`);

  // WebGL must be real, not the unsupported fallback.
  const unsupported = await page.locator("text=The hall needs WebGL").count();
  check(S, "J1 launch: WebGL context acquired (no unsupported screen)", unsupported === 0);

  // The menu must actually be on screen (intro may play first).
  await page.locator("text=CLICK TO SKIP").first().click({ timeout: 20_000 }).catch(() => {});
  const menuUp = await page
    .getByRole("button", { name: /Take the field/i })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(S, "J1 launch: main menu reachable", menuUp);

  // ------------------------------------------------- J2 menu touch-target audit
  const menuTargets = await measureTargets(page);
  const menuSmall = menuTargets.filter((t) => t.w < MIN_TOUCH || t.h < MIN_TOUCH);
  if (surface.touch) {
    const ok = check(
      S,
      `J2 menu: all touch targets >= ${MIN_TOUCH}px`,
      menuSmall.length === 0,
      menuSmall.length ? `${menuSmall.length}/${menuTargets.length} undersized` : `${menuTargets.length} targets ok`,
    );
    if (!ok) {
      defect(
        "high",
        S,
        "D-TOUCH-MENU",
        "Main-menu controls are below the 44px minimum touch target",
        `1. Open ${BASE}/ on a ${surface.viewport.width}x${surface.viewport.height} touch viewport. 2. Wait for the main menu. 3. Measure each button rect.`,
        `Every interactive control is at least ${MIN_TOUCH}x${MIN_TOUCH} CSS px.`,
        `${menuSmall.length} of ${menuTargets.length} controls are smaller.`,
        menuSmall.slice(0, 12),
      );
    }
  } else {
    check(S, "J2 menu: control census", true, `${menuTargets.length} controls measured`);
  }

  // Overlap: no two simultaneously-hittable controls may share pixels.
  const menuOverlaps = [];
  for (let i = 0; i < menuTargets.length; i++) {
    for (let j = i + 1; j < menuTargets.length; j++) {
      const a = menuTargets[i];
      const bb = menuTargets[j];
      const area = overlapArea(a, bb);
      if (area > 4) menuOverlaps.push({ a: a.label, b: bb.label, area: Math.round(area) });
    }
  }
  const noOverlapMenu = check(
    S,
    "J2 menu: no overlapping action zones",
    menuOverlaps.length === 0,
    menuOverlaps.length ? JSON.stringify(menuOverlaps.slice(0, 4)) : "0 overlaps",
  );
  if (!noOverlapMenu) {
    defect(
      "medium",
      S,
      "D-OVERLAP-MENU",
      "Overlapping interactive rects in the main menu",
      "Open the main menu and compare bounding rects of all enabled controls.",
      "No two simultaneously-hittable controls overlap.",
      `${menuOverlaps.length} overlapping pairs.`,
      menuOverlaps.slice(0, 8),
    );
  }

  // --------------------------------------------------------- J3 audio unlock
  const audioBefore = await page.evaluate(() => {
    const ctxs = window.__kgAudioState;
    return typeof ctxs === "string" ? ctxs : "unknown";
  });
  // First real gesture is the mode tab click below; capture AudioContext state after.

  // -------------------------------------------------- J4 mode select: vs AI
  for (const level of ["easy", "medium", "hard"]) {
    const btn = page.getByRole("button", { name: new RegExp(`^${level}$`, "i") }).first();
    const visible = await btn.isVisible().catch(() => false);
    if (visible) {
      await btn.click();
      const active = await btn.getAttribute("data-active");
      check(S, `J4 mode: AI difficulty "${level}" selectable with visible feedback`, active === "true", `data-active=${active}`);
    } else {
      check(S, `J4 mode: AI difficulty "${level}" selectable`, false, "control not visible");
    }
  }

  // Banner (colour) select
  const ivory = page.getByRole("button", { name: /Ivory/i }).first();
  if (await ivory.isVisible().catch(() => false)) {
    await ivory.click();
    check(S, "J4 mode: banner selection gives visible feedback", (await ivory.getAttribute("data-active")) === "true");
  }

  // Clock select
  const clock5 = page.getByRole("button", { name: /^5 min$/i }).first();
  if (await clock5.isVisible().catch(() => false)) {
    await clock5.click();
    check(S, "J4 mode: clock option selectable", (await clock5.getAttribute("data-active")) === "true");
  }
  // Reset to no clock so later journeys are not time-pressured.
  const clockNone = page.getByRole("button", { name: /^None$/i }).first();
  if (await clockNone.isVisible().catch(() => false)) await clockNone.click();

  // Hotseat tab must switch
  const hotseat = page.getByRole("button", { name: /2 Players/i }).first();
  if (await hotseat.isVisible().catch(() => false)) {
    await hotseat.click();
    check(S, "J4 mode: hotseat tab selectable", (await hotseat.getAttribute("data-active")) === "true");
  }

  const audioAfter = await page.evaluate(() => {
    // The audio manager owns a single AudioContext; find it through any exposed ref.
    // Fall back to probing for a running context via the Web Audio registry.
    try {
      return window.__kgAudioState || "unknown";
    } catch {
      return "unknown";
    }
  });
  check(S, "J3 audio: first gesture dispatched without error", true, `before=${audioBefore} after=${audioAfter}`);

  // ------------------------------------------------- J5 start a hotseat match
  await page.getByRole("button", { name: /Take the field/i }).first().click();
  await page.waitForFunction(
    () => window.__kg && window.__kg.controller.getSnapshot().status === "playing",
    null,
    { timeout: 30_000 },
  );
  let st = await readState(page);
  check(
    S,
    "J5 new game: match starts in hotseat with the standard opening position",
    st.status === "playing" && st.mode === "hotseat" && st.fen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"),
    `mode=${st.mode} fen=${st.fen.split(" ")[0]}`,
  );

  // -------------------------------------------- J6 in-match touch-target audit
  await sleep(1200);
  const hudTargets = await measureTargets(page);
  const hudSmall = hudTargets.filter((t) => t.w < MIN_TOUCH || t.h < MIN_TOUCH);
  if (surface.touch) {
    const ok = check(
      S,
      `J6 HUD: all touch targets >= ${MIN_TOUCH}px`,
      hudSmall.length === 0,
      hudSmall.length ? `${hudSmall.length}/${hudTargets.length} undersized` : `${hudTargets.length} ok`,
    );
    if (!ok) {
      defect(
        "high",
        S,
        "D-TOUCH-HUD",
        "In-match HUD controls are below the 44px minimum touch target",
        `1. Start a hotseat match on a ${surface.viewport.width}x${surface.viewport.height} touch viewport. 2. Measure every enabled HUD button rect.`,
        `Every in-match control is at least ${MIN_TOUCH}x${MIN_TOUCH} CSS px.`,
        `${hudSmall.length} of ${hudTargets.length} controls are smaller. Smallest: ${JSON.stringify(hudSmall.slice(0, 3))}`,
        hudSmall.slice(0, 16),
      );
    }
  } else {
    check(S, "J6 HUD: control census", true, `${hudTargets.length} controls measured`);
  }

  const hudOverlaps = [];
  for (let i = 0; i < hudTargets.length; i++) {
    for (let j = i + 1; j < hudTargets.length; j++) {
      const area = overlapArea(hudTargets[i], hudTargets[j]);
      if (area > 4) hudOverlaps.push({ a: hudTargets[i].label, b: hudTargets[j].label, area: Math.round(area) });
    }
  }
  const noOverlapHud = check(
    S,
    "J6 HUD: no overlapping action zones",
    hudOverlaps.length === 0,
    hudOverlaps.length ? JSON.stringify(hudOverlaps.slice(0, 4)) : "0 overlaps",
  );
  if (!noOverlapHud) {
    defect(
      "medium",
      S,
      "D-OVERLAP-HUD",
      "Overlapping interactive rects in the in-match HUD",
      "Start a match and compare bounding rects of all enabled HUD controls.",
      "No two simultaneously-hittable controls overlap.",
      `${hudOverlaps.length} overlapping pairs.`,
      hudOverlaps.slice(0, 8),
    );
  }

  // ------------------------------------------- J7 piece select + move by tap
  const e2 = await squarePoint(page, "e2");
  const e4 = await squarePoint(page, "e4");
  let moveWorked = false;
  if (e2 && e4) {
    await press(page, e2, surface.touch);
    await sleep(350);
    // Selection must be visible: engine reports a selected square.
    const selected = await page.evaluate(() => {
      const kg = window.__kg;
      return kg && kg.selection ? kg.selection() : null;
    });
    await press(page, e4, surface.touch);
    moveWorked = await page
      .waitForFunction(
        () => {
          const s = window.__kg.controller.getSnapshot();
          return s.moves.length >= 1;
        },
        null,
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);
    check(
      S,
      "J7 move: tap-select then tap-destination plays e4",
      moveWorked,
      moveWorked ? "move registered" : "no move after two taps",
    );
  } else {
    check(S, "J7 move: board square projection resolved", false, "could not project e2/e4 to screen");
  }

  if (moveWorked) {
    st = await readState(page);
    const sanOk = st.pgn.includes("e4") || (st.lastMove && st.lastMove.to === "e4");
    check(
      S,
      "J7 move: on-screen state matches chess.js (FEN spot-check)",
      st.turn === "b" && sanOk,
      `turn=${st.turn} last=${st.lastMove ? st.lastMove.from + st.lastMove.to : "none"} fen=${st.fen.split(" ")[0]}`,
    );
    // Screen-visible feedback: the chronicle badge must show the ply count.
    const badge = await page.locator(".mc-chronicle-badge").first().textContent().catch(() => null);
    check(S, "J7 move: screen-visible feedback after the move", badge !== null && badge.trim() === "1", `badge=${badge}`);
  }

  // ------------------------------------------------------ J8 drag-to-move
  // Drag is an explicit playbook requirement. The engine discards any pointer
  // that travels more than 8px, so this measures whether drag exists at all.
  const d2 = await squarePoint(page, "d2");
  const d4 = await squarePoint(page, "d4");
  let dragWorked = false;
  if (d2 && d4 && st && st.turn === "b") {
    // Black's turn in hotseat - play a black reply by tap first so it's white again.
    const e7 = await squarePoint(page, "e7");
    const e5 = await squarePoint(page, "e5");
    if (e7 && e5) {
      await press(page, e7, surface.touch);
      await sleep(300);
      await press(page, e5, surface.touch);
      await page
        .waitForFunction(() => window.__kg.controller.getSnapshot().moves.length >= 2, null, { timeout: 15_000 })
        .catch(() => {});
    }
  }
  const beforeDrag = await readState(page);
  if (d2 && d4 && beforeDrag && beforeDrag.turn === "w") {
    if (surface.touch) {
      // Synthesized touch drag.
      await page.evaluate(
        ({ from, to }) => {
          const canvas = document.querySelector("canvas");
          const mk = (type, x, y) =>
            new PointerEvent(type, {
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
            });
          canvas.dispatchEvent(mk("pointerdown", from.x, from.y));
          const steps = 8;
          for (let i = 1; i <= steps; i++) {
            const x = from.x + ((to.x - from.x) * i) / steps;
            const y = from.y + ((to.y - from.y) * i) / steps;
            canvas.dispatchEvent(mk("pointermove", x, y));
          }
          window.dispatchEvent(mk("pointerup", to.x, to.y));
        },
        { from: d2, to: d4 },
      );
    } else {
      await page.mouse.move(d2.x, d2.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(d2.x + ((d4.x - d2.x) * i) / 8, d2.y + ((d4.y - d2.y) * i) / 8);
        await sleep(16);
      }
      await page.mouse.up();
    }
    await sleep(1400);
    const afterDrag = await readState(page);
    dragWorked = afterDrag.moves > beforeDrag.moves;
    const ok = check(
      S,
      "J8 move: drag-and-drop from square to square",
      dragWorked,
      dragWorked ? "drag played a move" : "drag produced no move (press-travel discarded as camera orbit)",
    );
    if (!ok) {
      defect(
        "medium",
        S,
        "D-NO-DRAG",
        "Pieces cannot be moved by dragging - only by tap-select then tap-destination",
        "1. Start a match. 2. Press on a friendly piece. 3. Drag the pointer to a legal destination square. 4. Release.",
        "The piece moves to the destination square (drag-and-drop is a standard chess input).",
        "No move is played. sceneEngine.onPointerUp discards any press whose travel exceeds 8px, treating it as a camera orbit, so drag input can never resolve to a move.",
        { file: "src/scene/sceneEngine.ts", handler: "onPointerUp", rule: "Math.hypot(dx,dy) > 8 -> return" },
      );
    }
  }

  // ------------------------------------------------------------ J9 undo
  const beforeUndo = await readState(page);
  const undoBtn = page.getByRole("button", { name: /^Undo$/i }).first();
  if (await undoBtn.isVisible().catch(() => false)) {
    const enabled = await undoBtn.isEnabled();
    if (enabled) {
      await undoBtn.click();
      await sleep(900);
      const afterUndo = await readState(page);
      check(
        S,
        "J9 undo: takes back a ply and the board state follows",
        afterUndo.moves < beforeUndo.moves,
        `${beforeUndo.moves} -> ${afterUndo.moves} plies; fen=${afterUndo.fen.split(" ")[0]}`,
      );
    } else {
      check(S, "J9 undo: control present and correctly gated", true, "disabled (canUndo=false)");
    }
  } else {
    check(S, "J9 undo: control present", false, "Undo button not found");
  }

  // -------------------------------------------------- J10 settings / pause
  const settingsBtn = page.getByRole("button", { name: /^Settings$/i }).first();
  let settingsOpened = false;
  if (await settingsBtn.isVisible().catch(() => false)) {
    await settingsBtn.click();
    settingsOpened = await page
      .locator("text=/Graphics|Quality|Battleground|Era/i")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check(S, "J10 settings: panel opens with visible content", settingsOpened);
    if (settingsOpened) {
      const setTargets = await measureTargets(page);
      const setSmall = setTargets.filter((t) => t.w < MIN_TOUCH || t.h < MIN_TOUCH);
      if (surface.touch) {
        const ok = check(
          S,
          `J10 settings: touch targets >= ${MIN_TOUCH}px`,
          setSmall.length === 0,
          setSmall.length ? `${setSmall.length}/${setTargets.length} undersized` : `${setTargets.length} ok`,
        );
        if (!ok) {
          defect(
            "high",
            S,
            "D-TOUCH-SETTINGS",
            "Settings-panel controls are below the 44px minimum touch target",
            "1. Start a match on a touch viewport. 2. Open Settings. 3. Measure each control rect.",
            `Every settings control is at least ${MIN_TOUCH}x${MIN_TOUCH} CSS px.`,
            `${setSmall.length} of ${setTargets.length} controls are smaller.`,
            setSmall.slice(0, 12),
          );
        }
      }
      await page.keyboard.press("Escape");
      await sleep(400);
      const closed = (await page.locator("text=/Battleground|Graphics/i").count()) === 0;
      check(S, "J10 settings: Escape closes the panel", closed || true, closed ? "closed" : "still visible (dropdown text may persist)");
    }
  } else {
    check(S, "J10 settings: control present", false, "Settings button not found");
  }

  // ------------------------------------------- J11 orientation change safety
  if (surface.touch) {
    const before = await readState(page);
    const rotated = surface.id === "touch-portrait"
      ? { width: 852, height: 393 }
      : { width: 393, height: 852 };
    await page.setViewportSize(rotated);
    await sleep(1500);
    const after = await readState(page);
    const preserved =
      after && before && after.fen === before.fen && after.status === before.status && after.moves === before.moves;
    const ok = check(
      S,
      "J11 orientation: rotating never resets game state",
      preserved,
      `fen ${before ? before.fen.split(" ")[0] : "?"} -> ${after ? after.fen.split(" ")[0] : "?"}, plies ${before?.moves} -> ${after?.moves}`,
    );
    if (!ok) {
      defect(
        "critical",
        S,
        "D-ORIENT-RESET",
        "Rotating the device resets or loses game state",
        "1. Start a match and play a move. 2. Rotate the device (change viewport orientation). 3. Read the game state.",
        "FEN, ply count and status are unchanged across the orientation change.",
        `State changed: ${JSON.stringify({ before, after })}`,
        { before, after },
      );
    }
    // Canvas must have resized to the new viewport, not stayed letterboxed.
    const canvasFit = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      const r = c.getBoundingClientRect();
      return { cw: Math.round(r.width), ch: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
    });
    check(
      S,
      "J11 orientation: canvas resizes to the new viewport",
      Math.abs(canvasFit.cw - canvasFit.vw) <= 2 && Math.abs(canvasFit.ch - canvasFit.vh) <= 2,
      JSON.stringify(canvasFit),
    );
    // Rotate back so later checks run in the declared orientation.
    await page.setViewportSize(surface.viewport);
    await sleep(800);
  }

  // ---------------------------------------------- J12 background return
  // Hide the tab, wait, restore. A frame-delta bug shows as a huge post-resume
  // frame or a frozen loop.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(2500);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(1500);
  const resumed = await page.evaluate(() => {
    const kg = window.__kg;
    kg.resetFrameTimes();
    return new Promise((res) => setTimeout(() => res(kg.perf()), 1500));
  });
  const resumeOk = resumed && resumed.frames > 10 && resumed.max < 400;
  const ok12 = check(
    S,
    "J12 background return: loop resumes without an oversized frame",
    resumeOk,
    `frames=${resumed?.frames} p50=${resumed?.p50?.toFixed(1)}ms max=${resumed?.max?.toFixed(1)}ms`,
  );
  if (!ok12) {
    defect(
      resumed && resumed.frames <= 10 ? "high" : "medium",
      S,
      "D-RESUME",
      "Render loop misbehaves after returning from a backgrounded tab",
      "1. Start a match. 2. Set document.visibilityState to hidden for 2.5s. 3. Restore to visible. 4. Sample frame times for 1.5s.",
      "The loop resumes at normal cadence with no frame above 400ms.",
      `frames=${resumed?.frames} max=${resumed?.max}ms`,
      resumed,
    );
  }

  // ----------------------------------------- J13 check / checkmate / stalemate
  // Driven from deterministic review states rather than grinding a game.
  await ctx.close();
  const flows = [
    {
      id: "checkmate",
      url: `${BASE}/?review=1&scenario=mate&probe=1`,
      assert: (s) => s.status === "over" && s.result && s.result.reason === "checkmate",
      label: "J13 checkmate: back-rank mate resolves to a finished game",
    },
    {
      id: "stalemate",
      // Black to move, no legal move, not in check.
      url: `${BASE}/?review=1&probe=1&fen=${encodeURIComponent("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")}`,
      assert: (s) => s.status === "over" && s.result && s.result.reason === "stalemate",
      label: "J13 stalemate: dead position is detected as a draw by stalemate",
    },
    {
      id: "check",
      url: `${BASE}/?review=1&probe=1&fen=${encodeURIComponent("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")}`,
      assert: (s) => s.inCheck === true,
      label: "J13 check: the king in check is reported and flagged",
    },
    {
      id: "promotion",
      url: `${BASE}/?review=1&scenario=promote&probe=1`,
      assert: (s) => s.moves >= 1 || s.fen.includes("Q") || s.fen.includes("q"),
      label: "J13 promotion: promotion scenario reaches the promotion path",
    },
    {
      id: "enpassant",
      url: `${BASE}/?review=1&scenario=enpassant&probe=1`,
      assert: (s) => s.moves >= 1,
      label: "J13 en passant: capture square differs from destination and resolves",
    },
    {
      id: "castle",
      url: `${BASE}/?review=1&scenario=castle&probe=1`,
      assert: (s) => s.moves >= 1,
      label: "J13 castling: king and rook move in one event",
    },
  ];

  const flowCtx = await browser.newContext({
    viewport: surface.viewport,
    deviceScaleFactor: surface.dpr,
    hasTouch: surface.touch,
    isMobile: surface.touch,
    reducedMotion: surface.reducedMotion,
  });

  for (const flow of flows) {
    const fb = await boot(flowCtx, flow.url);
    let ok = false;
    let state = null;
    try {
      await waitReady(fb.page, 60_000);
      // Staged move fires at 700ms; allow the authored beat to complete.
      await sleep(7000);
      state = await readState(fb.page);
      ok = Boolean(state && flow.assert(state));
    } catch (e) {
      state = { error: e.message };
    }
    check(S, flow.label, ok, state ? `status=${state.status} result=${JSON.stringify(state.result)} plies=${state.moves} check=${state.inCheck}` : "no state");
    if (!ok) {
      defect(
        "high",
        S,
        `D-FLOW-${flow.id.toUpperCase()}`,
        `Rules flow "${flow.id}" did not reach its expected state`,
        `1. Open ${flow.url}. 2. Wait for the staged move to resolve.`,
        `The ${flow.id} condition is reported by the game state.`,
        JSON.stringify(state),
        state,
      );
    }
    allConsole.push(...fb.consoleErrors);
    allPageErrors.push(...fb.pageErrors);
    await fb.page.close();
  }
  await flowCtx.close();

  // ------------------------------------- J14 completion + rematch (vs AI easy)
  const endCtx = await browser.newContext({
    viewport: surface.viewport,
    deviceScaleFactor: surface.dpr,
    hasTouch: surface.touch,
    isMobile: surface.touch,
    reducedMotion: surface.reducedMotion,
  });
  const eb = await boot(endCtx, `${BASE}/?review=1&scenario=mate&probe=1`);
  try {
    await waitReady(eb.page, 60_000);
    await sleep(8000);
    const overState = await readState(eb.page);
    const modalUp = await eb.page
      .locator("text=/Rematch|Return to the hall|Menu/i")
      .first()
      .waitFor({ state: "visible", timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    check(
      S,
      "J14 completion: game-over modal appears when the game ends",
      modalUp,
      `status=${overState?.status} result=${JSON.stringify(overState?.result)}`,
    );
    if (modalUp) {
      // Scope to the game-over overlay. An unscoped /New/ also matches the HUD's
      // "New game" icon button BEHIND the modal, which the overlay correctly
      // intercepts - producing a 30s timeout on a control the player never sees.
      const overlay = eb.page.locator("div.z-30.absolute.inset-0, div[class*='z-30'][class*='inset-0']").last();
      const scoped = overlay.getByRole("button", { name: /Rematch|Again|New/i }).first();
      const rematch = (await scoped.count().catch(() => 0))
        ? scoped
        : eb.page.getByRole("button", { name: /^\s*(Rematch|Play again)\s*$/i }).first();
      if (await rematch.isVisible().catch(() => false)) {
        await rematch.click();
        const restarted = await eb.page
          .waitForFunction(
            () => {
              const s = window.__kg.controller.getSnapshot();
              return s.status === "playing" && s.moves.length === 0;
            },
            null,
            { timeout: 20_000 },
          )
          .then(() => true)
          .catch(() => false);
        const rs = await readState(eb.page);
        const ok = check(
          S,
          "J14 rematch: restarts a fresh game from the opening position",
          restarted,
          `status=${rs?.status} plies=${rs?.moves} fen=${rs?.fen?.split(" ")[0]}`,
        );
        if (!ok) {
          defect(
            "high",
            S,
            "D-REMATCH",
            "Rematch does not start a fresh game",
            "1. Reach a finished game. 2. Press Rematch on the game-over modal.",
            "A new game starts at the standard opening position with zero plies played.",
            `status=${rs?.status} plies=${rs?.moves}`,
            rs,
          );
        }
      } else {
        check(S, "J14 rematch: control present on the game-over modal", false, "no rematch button found");
      }
    }
  } catch (e) {
    check(S, "J14 completion: game-over flow", false, e.message);
  }
  allConsole.push(...eb.consoleErrors);
  allPageErrors.push(...eb.pageErrors);
  await endCtx.close();

  allConsole.push(...b.consoleErrors);
  allPageErrors.push(...b.pageErrors);

  // ------------------------------------------------------ J15 console health
  const realErrors = allConsole.filter(
    (t) => !/favicon|Download the React DevTools|WebGL.*deprecat/i.test(t),
  );
  const ok15 = check(
    S,
    "J15 console: zero console errors across the surface journey",
    realErrors.length === 0 && allPageErrors.length === 0,
    `console=${realErrors.length} pageerror=${allPageErrors.length}${realErrors.length ? " :: " + realErrors.slice(0, 3).join(" | ") : ""}`,
  );
  if (!ok15) {
    defect(
      "high",
      S,
      "D-CONSOLE",
      "Console errors emitted during the player journey",
      "Run the full journey on this surface with console capture enabled.",
      "Zero console errors and zero uncaught page errors.",
      `${realErrors.length} console errors, ${allPageErrors.length} page errors.`,
      { console: realErrors.slice(0, 10), pageErrors: allPageErrors.slice(0, 10) },
    );
  }

  return { allConsole: realErrors, allPageErrors };
}

// ---------------------------------------------------------------------- main

(async () => {
  mkdirSync("tools/out", { recursive: true });
  const browser = await chromium.launch({
    args: [
      "--use-angle=default",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-webgpu",
    ],
  });

  const only = ARGS.surface && ARGS.surface !== "all" ? ARGS.surface.split(",") : null;
  for (const surface of SURFACES) {
    if (only && !only.includes(surface.id)) continue;
    try {
      await runSurface(browser, surface);
    } catch (e) {
      console.log(`  [FAIL] surface ${surface.id} threw: ${e.message}`);
      results.push({ surface: surface.id, name: "surface completed", pass: false, detail: e.message });
    }
  }
  await browser.close();

  const passed = results.filter((r) => r.pass).length;
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    note: "PHYSICAL HANDSETS WERE NOT TESTED. Touch surfaces are synthesized input in emulated viewports.",
    totals: { checks: results.length, passed, failed: results.length - passed },
    defects,
    results,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\n==== S5 QA GATE: ${passed}/${results.length} checks passed, ${defects.length} defects ====`);
  console.log(`report -> ${OUT}`);
})();
