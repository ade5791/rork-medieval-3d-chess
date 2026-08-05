// Capture the exact stack that clears the selection.
import { chromium } from "playwright";
import { bootProbe, skipIntro, startMatch, sleep } from "./s5-lib.mjs";

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await bootProbe(page);
await skipIntro(page);
await startMatch(page, { mode: "hotseat" });

const patched = await page.evaluate(() => {
  const e = window.__kg.__engine;
  if (!e) return { ok: false };
  window.__calls = [];
  const proto = Object.getPrototypeOf(e);
  for (const name of ["clearSelection", "select", "setInteractive", "rebuildPieces", "resync", "setAttract"]) {
    const target = name in e ? e : proto;
    const orig = target[name];
    if (typeof orig !== "function") continue;
    e[name] = function (...args) {
      window.__calls.push({
        t: Math.round(performance.now()),
        name,
        args: args.map((a) => (typeof a === "object" ? "obj" : String(a))),
        stack: String(new Error().stack).split("\n").slice(1, 7).join(" | ").slice(0, 600),
      });
      return orig.apply(this, args);
    };
  }
  return { ok: true, keys: Object.keys(e).length };
});
console.log("patch:", JSON.stringify(patched));

const pt = await page.evaluate(() => { const p = window.__kg.pickPointFor("e2"); return { x: p.x, y: p.y }; });
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await sleep(40);
await page.mouse.up();
await sleep(3000);

const calls = await page.evaluate(() => window.__calls);
for (const c of calls) console.log(`\n[${c.t}] ${c.name}(${c.args.join(",")})\n   ${c.stack}`);
console.log("\nfinal selection:", JSON.stringify(await page.evaluate(() => window.__kg.selection())));

await browser.close();
