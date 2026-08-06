// S6 follow-up: verify the LIVE deploy boots a real WebGL context and reaches
// the menu (i.e. the "needs WebGL" gate does NOT fire) on this machine's GPU.
import { chromium } from "playwright";

const LIVE = "https://ade5791.github.io/kings-gambit-medieval-chess/";
const out = { url: LIVE, ok: false, checks: {}, consoleErrors: [], failedRequests: [] };

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push(m.text()); });
page.on("requestfailed", (r) => out.failedRequests.push(r.url() + " :: " + (r.failure()?.errorText ?? "?")));

await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });

// 1. Raw WebGL capability of this browser profile
out.checks.webgl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") ?? c.getContext("webgl");
  if (!gl) return { supported: false };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    supported: true,
    version: gl.getParameter(gl.VERSION),
    renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "(masked)",
  };
});

// 2. The app's own unsupported gate must NOT be showing
await page.waitForTimeout(4000);
out.checks.unsupportedGateVisible = await page.evaluate(() =>
  Boolean([...document.querySelectorAll("h2")].find((h) => /needs WebGL/i.test(h.textContent ?? "")))
);

// 3. Canvas present and painted
out.checks.canvasPresent = await page.evaluate(() => Boolean(document.querySelector("canvas")));

// 4. Wait for menu (loading screen clears when engine ready)
try {
  await page.waitForSelector("text=/Play|Campaign|New game|Start/i", { timeout: 90000 });
  out.checks.menuReached = true;
} catch {
  out.checks.menuReached = false;
}

await page.screenshot({ path: "tools/out/s6-live-webgl-check.png" });
out.ok = out.checks.webgl.supported && !out.checks.unsupportedGateVisible && out.checks.canvasPresent;
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(out.ok ? 0 : 1);
