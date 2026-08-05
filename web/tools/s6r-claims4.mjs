import fs from "node:fs";
const s = fs.readFileSync("src/scene/sceneEngine.ts", "utf8").split(/\r?\n/);

console.log("=== orbit / drag-camera references ===");
s.forEach((l, i) => {
  if (/orbit|swing|dragCamera|azimuth|yaw\s*[-+]?=|camera.*drag/i.test(l)) {
    console.log((i + 1) + ": " + l.trim());
  }
});

console.log("\n=== updatePointer + pointerDownAt assignment ===");
s.forEach((l, i) => {
  if (/pointerDownAt\s*=/.test(l)) console.log((i + 1) + ": " + l.trim());
});

console.log("\n=== controls / OrbitControls import ===");
s.forEach((l, i) => {
  if (/OrbitControls|controls\./i.test(l)) console.log((i + 1) + ": " + l.trim());
});
