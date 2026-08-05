// Why does the staged move never play? Inspect the live state rather than guess.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e)}`));

await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 60_000,
});
await page.waitForFunction(() => window.__kg?.controller, { timeout: 45_000, polling: 200 });

// Give the staged timer (700ms) room to fire.
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const snap = window.__kg.controller.getSnapshot();
  return {
    url: location.href,
    fen: snap.fen ?? null,
    turn: snap.turn ?? null,
    plies: snap.sanList.length,
    busy: snap.busy,
    status: snap.status ?? null,
    phaseText: document.body.innerText.slice(0, 200),
    keys: Object.keys(snap),
  };
});
console.log("STATE:", JSON.stringify(state, null, 2));

// Try the move manually - does the controller accept it at all?
const manual = await page.evaluate(async () => {
  const before = window.__kg.controller.getSnapshot().sanList.length;
  let threw = null;
  try {
    await window.__kg.controller.tryMove("d2", "d7");
  } catch (e) {
    threw = String(e);
  }
  await new Promise((r) => setTimeout(r, 4000));
  const snap = window.__kg.controller.getSnapshot();
  return { before, after: snap.sanList.length, san: snap.sanList.slice(-1)[0] ?? null, busy: snap.busy, threw };
});
console.log("MANUAL MOVE:", JSON.stringify(manual, null, 2));
console.log("LOGS:", logs.slice(0, 25).join("\n"));

await browser.close();
