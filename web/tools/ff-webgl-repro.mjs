// S6 follow-up: reproduce the Firefox "needs graphic acceleration" report.
// Runs Playwright Firefox against the live URL in two configs:
//   A) default headed-equivalent (headless new) - hardware path if available
//   B) forced software / acceleration off (layers.acceleration.disabled)
// Reports: webgl1/webgl2 context creation, renderer string, whether the
// game's unsupported gate is shown, console errors.
import { firefox } from "playwright";

const URL = process.env.TARGET_URL || "https://ade5791.github.io/kings-gambit-medieval-chess/";

async function probe(name, launchOpts) {
  const browser = await firefox.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(6000);
  const result = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl2 = c.getContext("webgl2");
    const c1 = document.createElement("canvas");
    const gl1 = c1.getContext("webgl");
    let renderer = null, vendor = null;
    const gl = gl2 || gl1;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    }
    const bodyText = document.body.innerText || "";
    return {
      webgl2: Boolean(gl2),
      webgl1: Boolean(gl1),
      renderer, vendor,
      gateShown: bodyText.includes("The hall needs WebGL"),
      menuShown: /Computer|2 Players|Showcase/.test(bodyText),
    };
  });
  await browser.close();
  console.log(JSON.stringify({ config: name, ...result, consoleErrors: errors.slice(0, 5) }, null, 2));
  return result;
}

const run = async () => {
  await probe("A-default", { headless: true });
  await probe("B-accel-off", {
    headless: true,
    firefoxUserPrefs: {
      "layers.acceleration.disabled": true,
      "gfx.direct2d.disabled": true,
      "webgl.disabled": false,
    },
  });
  await probe("C-webgl-disabled(user-setting-simulation)", {
    headless: true,
    firefoxUserPrefs: { "webgl.disabled": true },
  });
};
run().catch((e) => { console.error("REPRO-FAIL", e.message); process.exit(1); });
