// Monkeypatch the engine to capture the stack that clears the selection.
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });

await page.evaluate(() => {
  const kg = window.__kg;
  window.__log = [];
  // Reach the engine instance through a probe closure: patch the prototype.
  const engine = kg.__engine || null;
  window.__hasEngine = Boolean(engine);
  // Fall back: patch every candidate on the prototype chain via the api's own
  // bound methods is not possible, so instead observe side effects.
  const origWarn = console.warn;
  console.warn = (...a) => { window.__log.push({ t: Math.round(performance.now()), warn: a.map(String).join(" ").slice(0, 200) }); origWarn(...a); };
});

const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e2"); return { x: p.x, y: p.y }; });
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();

// Watch snapshot + selection + DOM together to correlate.
const trace = await page.evaluate(async () => {
  const kg = window.__kg;
  const t0 = performance.now();
  const rows = [];
  let last = null;
  while (performance.now() - t0 < 2600) {
    const s = kg.controller.getSnapshot();
    const sel = kg.selection().selected;
    const key = sel + "|" + s.status + "|" + s.turn + "|" + s.mode + "|" + (s.moves ? s.moves.length : -1);
    if (key !== last) {
      rows.push({
        t: Math.round(performance.now() - t0), sel, status: s.status, turn: s.turn,
        mode: s.mode, ply: s.moves ? s.moves.length : -1,
        hudPresent: Boolean(document.querySelector(".mc-hud, [class*=hud]")),
        menuPresent: Boolean(document.querySelector(".mc-menu, [class*=menu]")),
      });
      last = key;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return { rows, warns: window.__log };
});
console.log("state trace:", JSON.stringify(trace.rows, null, 1));
console.log("warns:", JSON.stringify(trace.warns));

await browser.close();
