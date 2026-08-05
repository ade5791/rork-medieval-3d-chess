import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/detail.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);

const anchor = "/** Frees every shared map. Called from the engine teardown. */";
if (src.includes("wearSurface")) {
  console.log("already present");
} else if (!src.includes(anchor)) {
  console.log("MISS anchor");
} else {
  src = src.replace(
    anchor,
    L(
      "/**",
      " * Piece edge wear and cavity grime. Fine, high-frequency breakup with a wide",
      " * roughness spread: high points buff smooth from handling, crevices stay dull",
      " * with grime. Low relief strength so it never fights the sculpted silhouette.",
      " */",
      "export function wearSurface(): SurfaceMaps {",
      '  return cached("wear", () => build(256, 0x6ab41d, 5, 0.62, 0.7, 0.26, 0.92));',
      "}",
      "",
      anchor,
    ),
  );
  fs.writeFileSync(file, src);
  console.log("added wearSurface");
}
