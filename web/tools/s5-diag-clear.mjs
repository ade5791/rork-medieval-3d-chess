// Trap WHO clears the selection ~900ms after a tap.
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { const t = m.text(); if (t.startsWith("TRAP")) console.log(t.slice(0, 900)); });

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });

// Poll selection at high frequency and log the moment it flips to null,
// plus which listeners are firing around then.
await page.evaluate(() => {
  window.__trap = { events: [] };
  for (const type of ["pointerdown", "pointerup", "pointermove", "pointercancel", "blur", "visibilitychange", "contextmenu"]) {
    const target = type === "visibilitychange" ? document : window;
    target.addEventListener(type, (e) => {
      window.__trap.events.push({ t: Math.round(performance.now()), type, x: e.clientX, y: e.clientY });
    }, true);
  }
});

const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e2"); return { x: p.x, y: p.y }; });
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();

const trace = await page.evaluate(async () => {
  const kg = window.__kg;
  const out = [];
  const t0 = performance.now();
  let lastSel = kg.selection().selected;
  out.push({ t: 0, sel: lastSel });
  while (performance.now() - t0 < 2500) {
    await new Promise((r) => setTimeout(r, 25));
    const s = kg.selection().selected;
    if (s !== lastSel) {
      out.push({ t: Math.round(performance.now() - t0), sel: s, from: lastSel });
      lastSel = s;
    }
  }
  return { transitions: out, events: window.__trap.events.slice(-25) };
});
console.log("TRAP selection transitions:", JSON.stringify(trace.transitions));
console.log("TRAP events near tap:", JSON.stringify(trace.events));

await browser.close();
