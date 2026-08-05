// Is the GLB load failing, or just slow? Watch the network and the progress text.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";
const browser = await chromium.launch();
const page = await browser.newPage();

const failed = [];
const glb = { started: 0, done: 0 };
page.on("request", (r) => {
  if (r.url().endsWith(".glb")) glb.started += 1;
});
page.on("response", (r) => {
  if (r.url().endsWith(".glb")) glb.done += 1;
});
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 110)}`));

await page.goto(`${BASE}/?scenario=capture&review=1&probe=1&quality=high&seed=s3gate`, {
  waitUntil: "load",
  timeout: 60_000,
});

// Watch progress for 90s - far longer than the gate allowed.
for (let i = 0; i < 9; i += 1) {
  await page.waitForTimeout(10_000);
  const s = await page.evaluate(() => {
    const snap = window.__kg?.controller?.getSnapshot?.();
    return {
      text: (document.body.innerText || "").split("\n").filter(Boolean).slice(0, 3).join(" | "),
      plies: snap?.sanList?.length ?? -1,
      status: snap?.status ?? "n/a",
    };
  });
  console.log(`t=${(i + 1) * 10}s glbReq=${glb.started} glbRes=${glb.done} status=${s.status} plies=${s.plies} :: ${s.text}`);
  if (s.plies > 0) break;
}

console.log("\nFAILED REQUESTS:", failed.length);
failed.slice(0, 10).forEach((f) => console.log("  " + f));

await browser.close();
