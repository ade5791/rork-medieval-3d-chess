// Verify every factual claim the landing page makes, against the shipped source.
import fs from "node:fs";
import path from "node:path";

const SRC = "src";
function walk(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

function grep(re, label) {
  console.log("=== " + label + " ===");
  let n = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      if (re.test(l)) {
        console.log(f + ":" + (i + 1) + ": " + l.trim());
        n++;
      }
    });
  }
  if (!n) console.log("(no matches)");
  console.log("");
}

grep(/difficulty|Difficulty/, "difficulty references");
grep(/maxDepth|depth:\s*\d|DEPTH/, "depth constants");
grep(/wheel/, "wheel / zoom input");
grep(/quality|preset/i, "quality presets (decl only)");
