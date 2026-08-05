import fs from "node:fs";
const s = fs.readFileSync("src/scene/sceneEngine.ts", "utf8").split(/\r?\n/);
const i = s.findIndex((l) => l.includes("new OrbitControls("));
console.log("=== OrbitControls configuration block ===");
for (let k = i; k < i + 45 && k < s.length; k++) console.log((k + 1) + ": " + s[k]);

console.log("\n=== every controls.* assignment in file ===");
s.forEach((l, k) => {
  if (/this\.controls\.[A-Za-z]+\s*=/.test(l)) console.log((k + 1) + ": " + l.trim());
});
