/**
 * S4 performance matrix.
 *
 * One FRESH BROWSER PER CELL. Reusing a single browser across cells exhausts
 * the WebGL context pool (browsers cap live contexts, commonly 16) and the
 * later cells silently render into a lost context - which reports as
 * impossibly fast frames rather than as an error.
 *
 * Cells are run STRICTLY SEQUENTIALLY. Two CPU-bound measurement jobs on the
 * same machine fabricate multi-second phantom hitches in each other.
 *
 * Every cell:
 *   - real device pixel ratio (deviceScaleFactor 1 on this display)
 *   - camera ORBITING (showcase auto-orbit), never static
 *   - a real AI-vs-AI game running, so effects fire and pieces animate
 *   - a warmup window that is DISCARDED, then a measured window
 *
 * Usage: node tools/s4-perf-matrix.mjs [--quick] [--out FILE]
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : "tools/out/s4-perf-matrix.json";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const VIEWPORT = { width: 1600, height: 900 };

// --- matrix definition ------------------------------------------------------
const PRESETS = ["low", "medium", "high", "ultra"];
// Both civilisations / battlegrounds: classic era stages in the jungle,
// the Rome era stages on the frost frontier. Each pairs an era roster with
// its battleground, which is the real shipping combination.
const BATTLEGROUNDS = [
  { id: "classic-jungle", era: "classic", arena: "jungle" },
  { id: "classic-dawn", era: "classic", arena: "dawn" },
  { id: "rome-frost", era: "rome", arena: "frost" },
  { id: "rome-dusk", era: "rome", arena: "dusk" },
];

/**
 * Three game phases. Each is a real position, not a label:
 *  opening  - all 32 pieces standing, the heaviest draw-call load
 *  midgame  - a captured-heavy position with a capture firing during the window
 *  endgame  - few pieces, tests whether cost is piece-bound or scene-bound
 */
const PHASES = {
  opening: {
    fen: null, // standard opening, 32 pieces
    note: "all 32 pieces standing",
  },
  midgame: {
    fen: "r2q1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1N2/PP2BPPP/R1BQ1RK1 w - - 0 9",
    note: "24 pieces, effects firing",
  },
  endgame: {
    fen: "8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40",
    note: "6 pieces",
  },
};

const WARMUP_MS = QUICK ? 3000 : 6000;
const MEASURE_MS = QUICK ? 6000 : 12000;
const LOAD_TIMEOUT = 90000;

function url(cell) {
  const p = new URLSearchParams();
  p.set("review", "1");
  p.set("probe", "1");
  p.set("quality", cell.preset);
  p.set("era", cell.era);
  p.set("arena", cell.arena);
  p.set("seed", "s4-matrix");
  if (cell.fen) p.set("fen", cell.fen);
  return `${BASE}/?${p.toString()}`;
}

async function runCell(cell) {
  const started = Date.now();
  // Fresh browser per cell - see the header note on context exhaustion.
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-angle=d3d11",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
      "--disable-frame-rate-limit",
      "--disable-gpu-vsync",
    ],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1, // real DPR of this display
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

  const result = {
    ...cell,
    ok: false,
    error: null,
    consoleErrors: [],
  };

  try {
    await page.goto(url(cell), { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT });

    // Wait for the engine probe AND the asset factory to be ready.
    await page.waitForFunction(() => !!window.__kg, null, { timeout: LOAD_TIMEOUT });
    await page.waitForFunction(() => window.__kg.ready() === true, null, { timeout: LOAD_TIMEOUT });
    result.loadMs = Date.now() - started;

    // Prewarm report - was every program compiled behind the loading screen?
    result.prewarm = await page.evaluate(() => window.__kg.prewarmStats());
    const programsAtStart = await page.evaluate(() => window.__kg.programs().count);

    // Renderer identity: prove we are on the real GPU, not a software
    // rasterizer, or the numbers mean nothing.
    result.gpu = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      if (!gl) return "none";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    result.dpr = await page.evaluate(() => window.devicePixelRatio);

    // Confirm the preset actually took, and the staged position loaded.
    result.presetActual = await page.evaluate(() => window.__kg.preset());
    result.arenaActual = await page.evaluate(() => window.__kg.arena());
    result.eraActual = await page.evaluate(() => window.__kg.era());
    result.postEnabled = await page.evaluate(() => window.__kg.postEnabled());

    // Start the camera ORBITING and release the manual-camera suspension.
    // A static camera hides frustum-culling and streaming cost entirely.
    await page.evaluate(() => {
      window.__kg.showcase(true, 0.55);
      window.__kg.releaseCamera();
      window.__kg.setCamera("cinematic");
    });

    // Warm up: discard. This window absorbs first-draw costs, texture
    // uploads and any residual compile so they do not pollute the sample.
    await page.waitForTimeout(WARMUP_MS);

    // Keep the orbit alive (autoRotate suspends on manual input) and begin
    // the measured window with a clean buffer.
    await page.evaluate(() => {
      window.__kg.releaseCamera();
      window.__kg.resetFrameTimes();
    });
    const censusBefore = await page.evaluate(() => window.__kg.census());
    const programsBeforeWindow = await page.evaluate(() => window.__kg.programs().count);
    const lightsBefore = await page.evaluate(() => window.__kg.lightCensus());

    // Measured window. Nudge the orbit periodically so it can never fall
    // back to a static shot mid-sample.
    const ticks = Math.ceil(MEASURE_MS / 1000);
    for (let i = 0; i < ticks; i += 1) {
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.__kg.releaseCamera());
    }

    result.perf = await page.evaluate(() => window.__kg.perf());
    result.census = await page.evaluate(() => window.__kg.census());
    result.censusBefore = censusBefore;
    result.lights = await page.evaluate(() => window.__kg.lightCensus());
    result.lightsBefore = lightsBefore;
    const programsAfter = await page.evaluate(() => window.__kg.programs().count);
    result.programs = {
      atStart: programsAtStart,
      beforeWindow: programsBeforeWindow,
      after: programsAfter,
      // Programs compiled DURING the measured window - must be 0, or the
      // prewarm is incomplete and players will feel it as a stall.
      lateCompiles: programsAfter - programsBeforeWindow,
    };
    result.combat = await page.evaluate(() => window.__kg.combat());
    result.ok = true;
  } catch (error) {
    result.error = String(error).slice(0, 400);
  } finally {
    result.consoleErrors = consoleErrors.slice(0, 6);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  result.wallMs = Date.now() - started;
  return result;
}

async function main() {
  const cells = [];
  for (const bg of BATTLEGROUNDS) {
    for (const preset of PRESETS) {
      for (const [phase, def] of Object.entries(PHASES)) {
        cells.push({
          cell: `${bg.id}/${preset}/${phase}`,
          battleground: bg.id,
          era: bg.era,
          arena: bg.arena,
          preset,
          phase,
          phaseNote: def.note,
          fen: def.fen,
        });
      }
    }
  }

  console.log(`S4 matrix: ${cells.length} cells, sequential, fresh browser per cell`);
  console.log(`warmup ${WARMUP_MS}ms + measure ${MEASURE_MS}ms per cell`);

  const results = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    process.stdout.write(`[${i + 1}/${cells.length}] ${cell.cell} ... `);
    // Strictly sequential - never two CPU-bound jobs at once.
    const r = await runCell(cell);
    results.push(r);
    if (r.ok) {
      console.log(
        `p50 ${r.perf.fps50.toFixed(1)}fps (${r.perf.p50.toFixed(2)}ms) ` +
          `p95 ${r.perf.p95.toFixed(1)}ms p99 ${r.perf.p99.toFixed(1)}ms ` +
          `max ${r.perf.max.toFixed(0)}ms hitch>50ms ${r.perf.hitches50} ` +
          `late ${r.programs.lateCompiles}`,
      );
    } else {
      console.log(`FAILED: ${r.error}`);
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    viewport: VIEWPORT,
    warmupMs: WARMUP_MS,
    measureMs: MEASURE_MS,
    cells: results,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`\nwrote ${OUT}`);

  const okCells = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`ok ${okCells.length}/${results.length}, failed ${failed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
