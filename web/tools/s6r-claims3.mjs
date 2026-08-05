import fs from "node:fs";

function show(file, from, to, label) {
  console.log("=== " + label + " (" + file + " " + from + "-" + to + ") ===");
  const l = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = from - 1; i < to && i < l.length; i++) console.log((i + 1) + ": " + l[i]);
  console.log("");
}

// pickEasyMove
const w = fs.readFileSync("src/ai/engine.worker.ts", "utf8").split(/\r?\n/);
const idx = w.findIndex((l) => /function pickEasyMove/.test(l));
if (idx >= 0) show("src/ai/engine.worker.ts", idx + 1, idx + 20, "pickEasyMove");
else console.log("pickEasyMove not found\n");

// pointer handlers in sceneEngine
const s = fs.readFileSync("src/scene/sceneEngine.ts", "utf8").split(/\r?\n/);
["onPointerDown =", "onPointerMove =", "onPointerUp ="].forEach((name) => {
  const i = s.findIndex((l) => l.includes(name));
  if (i >= 0) show("src/scene/sceneEngine.ts", i + 1, i + 30, name);
});

// explicit check: is there ANY wheel binding at all in the whole repo src?
console.log("=== wheel binding search (whole src) ===");
import("node:path").then(({ default: path }) => {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })("src");
  let found = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/["']wheel["']|onWheel|deltaY/.test(l)) {
        console.log(f + ":" + (i + 1) + ": " + l.trim());
        found++;
      }
    });
  }
  console.log(found === 0 ? "NO WHEEL/ZOOM BINDING EXISTS" : "wheel refs: " + found);
});
