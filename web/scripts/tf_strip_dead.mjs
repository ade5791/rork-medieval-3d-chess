// Remove the superseded histogram body (lines 640-666 region): the old
// default-framebuffer readPixels path that returned zeros.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/sceneEngine.ts";
const src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const lines = src.split(nl);

const start = lines.findIndex((l) => l.includes("// eslint-disable-next-line no-unreachable"));
if (start < 0) {
  console.log("MISS marker");
  process.exit(1);
}
// The dead block ends at the closing "};" of the old return, just before "},".
let end = -1;
for (let i = start; i < Math.min(lines.length, start + 40); i += 1) {
  if (lines[i].trim() === "};" && lines[i + 1] && lines[i + 1].trim() === "},") {
    end = i;
    break;
  }
}
if (end < 0) {
  console.log("MISS end");
  process.exit(1);
}
console.log("removing lines " + (start + 1) + "-" + (end + 1));
lines.splice(start, end - start + 1);
fs.writeFileSync(file, lines.join(nl));
console.log("done");
