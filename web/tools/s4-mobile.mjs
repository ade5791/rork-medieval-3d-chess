// S4 mobile readiness: real phone viewport, real DPR, touch enabled, both
// orientations. Measures the same distribution as the desktop matrix so the
// numbers are comparable, and checks the auto quality step-down actually
// engages on a mobile-class surface.
//
// Run ALONE, after the desktop matrix - never concurrently.
import { chromium, devices } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.S4_BASE ?? "http://127.0.0.1:4173";
const OUT = "tools/out/s4-mobile.json";

const CASES = [
  { id: "portrait-390x844@3", viewport: { width: 390, height: 844 }, dpr: 3 },
  { id: "landscape-844x390@3", viewport: { width: 844, height: 390 }, dpr: 3 },
  { id: "portrait-360x800@2", viewport: { width: 360, height: 800 }, dpr: 2 },
];

const results = [];

for (const c of CASES) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
  });
  const ctx = await browser.newContext({
    viewport: c.viewport,
    deviceScaleFactor: c.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: devices["iPhone 13"].userAgent,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 160)));

  const r = { ...c, ok: false };
  try {
    // No quality pin: let the app choose, so we see what a phone actually gets.
    await page.goto(`${BASE}/?review=1&probe=1&era=classic&arena=jungle&seed=s4-mobile`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForFunction(() => !!window.__kg && window.__kg.ready() === true, null, { timeout: 90000 });

    r.chosenPreset = await page.evaluate(() => window.__kg.preset());
    r.dprActual = await page.evaluate(() => window.devicePixelRatio);
    r.postEnabled = await page.evaluate(() => window.__kg.postEnabled());

    await page.evaluate(() => {
      window.__kg.showcase(true, 0.55);
      window.__kg.releaseCamera();
      window.__kg.setCamera("cinematic");
    });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      window.__kg.releaseCamera();
      window.__kg.resetFrameTimes();
    });
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.__kg.releaseCamera());
    }
    r.perf = await page.evaluate(() => window.__kg.perf());
    r.census = await page.evaluate(() => window.__kg.census());

    // Touch reachability: are the primary controls inside the safe area?
    r.controls = await page.evaluate(() => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      return [...document.querySelectorAll("button")]
        .filter((b) => b.offsetWidth || b.offsetHeight)
        .map((b) => {
          const box = b.getBoundingClientRect();
          return {
            label: (b.getAttribute("title") || b.textContent || "").trim().slice(0, 22),
            w: Math.round(box.width),
            h: Math.round(box.height),
            // 44px is the standard minimum touch target.
            tooSmall: box.width < 44 || box.height < 44,
            offscreen: box.right > vw + 1 || box.bottom > vh + 1 || box.left < -1 || box.top < -1,
          };
        });
    });
    r.tooSmallCount = r.controls.filter((x) => x.tooSmall).length;
    r.offscreenCount = r.controls.filter((x) => x.offscreen).length;
    r.ok = true;
  } catch (e) {
    r.error = String(e).slice(0, 300);
  } finally {
    r.consoleErrors = consoleErrors.slice(0, 5);
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (r.ok) {
    console.log(
      `${r.id.padEnd(22)} preset=${r.chosenPreset} dpr=${r.dprActual} post=${r.postEnabled} ` +
        `p50 ${r.perf.fps50.toFixed(1)}fps (${r.perf.p50.toFixed(2)}ms) p95 ${r.perf.p95.toFixed(1)} p99 ${r.perf.p99.toFixed(1)} ` +
        `max ${r.perf.max.toFixed(0)} hitch>50 ${r.perf.hitches50} smallTargets=${r.tooSmallCount} offscreen=${r.offscreenCount}`,
    );
  } else {
    console.log(`${r.id.padEnd(22)} FAILED ${r.error}`);
  }
  results.push(r);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), cases: results }, null, 2));
console.log("wrote", OUT);
