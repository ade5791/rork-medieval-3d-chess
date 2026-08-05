// Diagnose why animateMove early-returned in the staged scenario.
import { chromium } from "playwright";
const BASE = "http://localhost:4173";

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));

await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 45_000,
});

// Sample the scene's piece map and controller state over time.
const timeline = await page.evaluate(async () => {
  const samples = [];
  for (let i = 0; i < 24; i += 1) {
    const kg = window.__kg;
    const snap = kg?.controller?.getSnapshot?.();
    samples.push({
      t: i * 250,
      hasKg: Boolean(kg),
      combat: kg?.combat ? kg.combat() : null,
      plies: snap?.sanList?.length ?? -1,
      busy: snap?.busy ?? null,
      fen: snap?.fen?.split(" ")[0] ?? null,
    });
    await new Promise((r) => setTimeout(r, 250));
  }
  return samples;
});

console.log("t(ms) hasKg plies busy contacts ply fen");
for (const s of timeline) {
  console.log(
    `${String(s.t).padStart(5)} ${String(s.hasKg).padEnd(5)} ${String(s.plies).padStart(5)} ${String(s.busy).padEnd(5)} ${String(s.combat?.contactsResolved ?? "-").padStart(8)} ${String(s.combat?.ply ?? "-").padStart(3)} ${s.fen ?? "-"}`,
  );
}
console.log("\n--- console ---");
for (const l of logs.slice(0, 25)) console.log(l);
await browser.close();
