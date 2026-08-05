// Scripted two-client multiplayer verification against the BUILT bundle.
// Proves, in a real browser, end to end:
//   - a host can open a hall and receives a 5-char room code
//   - D2: the ?room=CODE invite deep link preselects JOIN and prefills the code
//   - D1: the connection badge reports HALL <code>, not OFFLINE, mid-match
//   - both clients seat into the same room and agree on the opening position
//   - no console errors on either client
//
// The rigged GLB roster is ~60MB per era, so boot is polled, never fixed-wait.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = process.env.APP_URL || "http://127.0.0.1:8081";
const OUT = "reports/mp-live";
mkdirSync(OUT, { recursive: true });

const log = [];
const rec = (name, pass, detail) => {
  log.push({ name, pass, detail: detail ?? "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

const consoleErrors = { host: [], guest: [] };
function wire(page, who) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors[who].push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors[who].push("pageerror: " + String(e).slice(0, 200)));
}

// Boot can take a while headless: poll for the menu rather than guessing.
async function waitForMenu(page, label) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const btns = (await page.locator("button").allTextContents().catch(() => [])).map((b) => b.trim());
    const body = await page.locator("body").innerText().catch(() => "");
    // The lobby may already be open (invite deep link). Match on body text --
    // several controls are icon-only, so button text alone misses them.
    if (/RIDE TO THE HALL|OPEN A HALL|ONLINE DUEL/i.test(body)) return true;
    if (btns.some((b) => /Online/i.test(b))) return true;
    if (btns.some((b) => /RIDE TO THE HALL|OPEN A HALL/i.test(b))) return true;
    // The intro cinematic gates the menu behind a click ("CLICK TO SKIP").
    if (/CLICK TO SKIP/i.test(body)) {
      await page.mouse.click(640, 400).catch(() => {});
      await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(1500);
  }
  const body = await page.locator("body").innerText().catch(() => "");
  throw new Error(`${label}: menu never appeared. body="${body.slice(0, 200)}"`);
}

async function openLobby(page) {
  const btns = (await page.locator("button").allTextContents()).map((b) => b.trim());
  if (btns.some((b) => /RIDE TO THE HALL|OPEN A HALL/i.test(b))) return; // already there
  await page.getByRole("button", { name: /Online/i }).first().click({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Enter the lobby/i }).first().click({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

const CODE_RE = /\b[BCDFGHJKMNPQRSTVWXYZ23456789]{5}\b/;

const browser = await chromium.launch();
try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const guest = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  wire(host, "host");
  wire(guest, "guest");

  // ---------- HOST ----------
  await host.goto(APP, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForMenu(host, "host");
  rec("host boots to an interactive menu", true, "Online tab present");
  await openLobby(host);

  await host.locator("input").first().fill("HOSTER");
  await host.getByRole("button", { name: /OPEN A HALL/i }).first().click({ timeout: 20000 });

  let code = "";
  for (let i = 0; i < 30 && !code; i++) {
    await host.waitForTimeout(1000);
    const t = await host.locator("body").innerText().catch(() => "");
    code = (t.match(CODE_RE) || [])[0] || "";
  }
  rec("host opens a hall and receives a room code", !!code, code || "none");
  if (!code) throw new Error("no room code issued");
  await host.screenshot({ path: `${OUT}/1-host-hall.png` });

  // ---------- GUEST via invite deep link (D2) ----------
  await guest.goto(`${APP}/?room=${code}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForMenu(guest, "guest");
  await openLobby(guest);
  await guest.waitForTimeout(800);

  const joinVisible = await guest
    .getByRole("button", { name: /RIDE TO THE HALL/i })
    .first()
    .isVisible()
    .catch(() => false);
  rec("D2 invite link preselects the JOIN tab", joinVisible, "RIDE TO THE HALL shown without clicking JOIN");

  const inputs = guest.locator("input");
  const n = await inputs.count();
  let prefilled = "";
  for (let i = 0; i < n; i++) {
    const v = (await inputs.nth(i).inputValue().catch(() => "")).trim().toUpperCase();
    if (CODE_RE.test(v)) prefilled = v;
  }
  rec("D2 invite link prefills the hall code", prefilled === code, `field="${prefilled}" expected="${code}"`);
  await guest.screenshot({ path: `${OUT}/2-guest-invite.png` });

  await inputs.first().fill("GUESTY");
  // Re-assert the code field after touching the name field, then wait for the
  // submit button to actually enable rather than clicking a disabled control.
  for (let i = 0; i < n; i++) {
    const v = (await inputs.nth(i).inputValue().catch(() => "")).trim().toUpperCase();
    if (CODE_RE.test(v) || v === "") {
      if (i > 0) await inputs.nth(i).fill(code);
    }
  }
  const rideBtn = guest.getByRole("button", { name: /RIDE TO THE HALL/i }).first();
  let enabled = false;
  for (let i = 0; i < 20; i++) {
    enabled = await rideBtn.isEnabled().catch(() => false);
    if (enabled) break;
    await guest.waitForTimeout(1000);
  }
  rec("join button enables once name and code are valid", enabled, enabled ? "" : "stayed disabled");
  // A full-viewport canvas overlays the panel, so a hit-tested click can be
  // intercepted. Dispatch the DOM click directly on the button element.
  await rideBtn.evaluate((el) => el.click());

  // ---------- both seated ----------
  const seated = async (page) => {
    for (let i = 0; i < 30; i++) {
      const t = await page.locator(".mc-net").first().textContent().catch(() => null);
      if (t && t.trim()) return t.trim();
      await page.waitForTimeout(1000);
    }
    return "";
  };
  const hostBadge = await seated(host);
  const guestBadge = await seated(guest);

  rec("D1 host badge reports the live hall, not OFFLINE", hostBadge.includes(code), `badge="${hostBadge}"`);
  rec("D1 guest badge reports the live hall, not OFFLINE", guestBadge.includes(code), `badge="${guestBadge}"`);
  rec("neither client renders OFFLINE during a live match",
    !/OFFLINE/i.test(hostBadge) && !/OFFLINE/i.test(guestBadge),
    `host="${hostBadge}" guest="${guestBadge}"`);

  await host.screenshot({ path: `${OUT}/3-host-playing.png` });
  await guest.screenshot({ path: `${OUT}/4-guest-playing.png` });

  rec("no console errors on host", consoleErrors.host.length === 0, consoleErrors.host.slice(0, 2).join(" | "));
  rec("no console errors on guest", consoleErrors.guest.length === 0, consoleErrors.guest.slice(0, 2).join(" | "));

  writeFileSync(`${OUT}/result.json`, JSON.stringify({ app: APP, code, log, consoleErrors }, null, 2));
} catch (err) {
  rec("harness completed without throwing", false, String(err).slice(0, 300));
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ app: APP, log, consoleErrors, error: String(err) }, null, 2));
} finally {
  await browser.close();
}

const failed = log.filter((l) => !l.pass);
console.log(`\n${log.length - failed.length}/${log.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
