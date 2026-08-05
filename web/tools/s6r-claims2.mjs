import fs from "node:fs";
import path from "node:path";

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})("src");

console.log("=== easy branch (engine.worker.ts 245-275) ===");
const w = fs.readFileSync("src/ai/engine.worker.ts", "utf8").split(/\r?\n/);
for (let i = 244; i < 275 && i < w.length; i++) console.log((i + 1) + ": " + w[i]);

console.log("\n=== any wheel/pointer/touch event listeners ===");
const re = /addEventListener\(\s*["'](wheel|pointerdown|pointermove|pointerup|touchstart|touchmove|contextmenu)["']/;
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (re.test(l)) console.log(f + ":" + (i + 1) + ": " + l.trim());
  });
}

console.log("\n=== zoom / dolly / distance logic ===");
const re2 = /zoom|dolly|deltaY|radius\s*[-+*]?=|spherical/i;
for (const f of files) {
  if (!/scene|input|camera/i.test(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (re2.test(l) && !/wheelGeo|wheelMat|TorusGeometry|birds|carrion/i.test(l)) {
      console.log(f + ":" + (i + 1) + ": " + l.trim());
    }
  });
}
