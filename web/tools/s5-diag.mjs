// S5 diagnostic: measure WHY rank-1 squares fail to resolve a pick point in
// portrait, and whether the 3D promotion picker is reachable by a real click.
// Writes progress to disk after every surface so a crash still leaves evidence.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const BASE = process.env.S5_BASE || "http://127.0.0.1:8123";
const OUT = "tools/out/s5/diag.json";
const LOG = "tools/out/s5/diag.log";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); };

writeFileSync(LOG, "");
log("start");

const SURFACES = [
  { name: "desktop-1600x900", viewport: { width: 1600, height: 900 }, dpr: 1, touch: false },
  { name: "portrait-390x844", viewport: { width: 390, height: 844 }, dpr: 3, touch: true },
  { name: "landscape-844x390", viewport: { width: 844, height: 390 }, dpr: 3, touch: true },
];

const out = [];
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 2));
save();

async function boot(page, params) {
  const qs = new URLSearchParams({ review: "1", probe: "1", ...params }).toString();
  await page.goto(`${BASE}/?${qs}`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(() => window.__kg && window.__kg.ready && window.__kg.ready(), null,
    { timeout: 60_000 }).catch(() => {});
  await sleep(1500);
}

let browser;
try {
  browser = await chromium.launch();
  log("browser launched");

  for (const s of SURFACES) {
    log("surface " + s.name);
    const ctx = await browser.newContext({
      viewport: s.viewport, deviceScaleFactor: s.dpr, hasTouch: s.touch, isMobile: s.touch,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));

    try {
      await boot(page, { arena: "dusk", quality: "high" });
      log("booted " + s.name);

      const geom = await page.evaluate(() => {
        const files = ["a","b","c","d","e","f","g","h"];
        const rows = [];
        for (let r = 1; r <= 8; r++) {
          for (const f of files) {
            const sq = f + r;
            const p = window.__kg.pickPointFor(sq);
            rows.push({ sq, ok: p.ok, offset: p.offset, x: Math.round(p.x), y: Math.round(p.y) });
          }
        }
        const c = document.querySelector("canvas").getBoundingClientRect();
        return {
          rows,
          rect: { l: Math.round(c.left), t: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) },
          vh: window.innerHeight, vw: window.innerWidth,
        };
      });

      const fails = geom.rows.filter((r) => !r.ok);
      const byRank = {};
      for (const r of geom.rows) {
        const rank = r.sq[1];
        byRank[rank] = byRank[rank] || { ok: 0, fail: 0 };
        if (r.ok) byRank[rank].ok += 1; else byRank[rank].fail += 1;
      }

      const overlapProbe = await page.evaluate((failList) => failList.map((f) => {
        const el = document.elementFromPoint(f.x, f.y);
        return {
          sq: f.sq, x: f.x, y: f.y,
          onCanvas: !!(el && el.tagName === "CANVAS"),
          hitTag: el ? el.tagName.toLowerCase() : null,
          hitClass: el && typeof el.className === "string" ? el.className.slice(0, 70) : null,
        };
      }), fails.slice(0, 14));

      out.push({
        surface: s.name, viewport: s.viewport, canvasRect: geom.rect, innerH: geom.vh, innerW: geom.vw,
        totalSquares: geom.rows.length, failCount: fails.length,
        failedSquares: fails.map((f) => f.sq), byRank, overlapProbe,
        consoleErrors: errs.length, errorSample: errs.slice(0, 3),
      });
      save();
      log("done " + s.name + " fails=" + fails.length);
    } catch (e) {
      out.push({ surface: s.name, error: String(e) });
      save();
      log("ERROR " + s.name + " " + String(e));
    }
    await ctx.close();
  }
} catch (e) {
  out.push({ fatal: String(e) });
  save();
  log("FATAL " + String(e));
} finally {
  if (browser) await browser.close();
  save();
  log("end");
}
