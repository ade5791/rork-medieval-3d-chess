import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/scripts/tf_capture.mjs";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);

if (!src.includes("tf_summary.mjs")) {
  src = src.replace(
    'import { chromium } from "playwright";',
    L('import { chromium } from "playwright";', 'import { summarise } from "./tf_summary.mjs";'),
  );
}

// Replace the inline IIFE summary with the shared one.
const start = src.indexOf("    materialSummary: (() => {");
if (start >= 0) {
  const end = src.indexOf("    })(),", start);
  if (end >= 0) {
    src = src.slice(0, start) + "    materialSummary: summarise(payload?.materials)," + src.slice(end + "    })(),".length);
    console.log("replaced summary block");
  } else {
    console.log("MISS summary end");
  }
} else {
  console.log("summary block already replaced or not found");
}

fs.writeFileSync(file, src);
console.log("done");
