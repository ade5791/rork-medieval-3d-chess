// Fix-ups: add the detail import, and hoist the shared surfaces onto the
// instance so buildBase() (a separate method) can reach them.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/board.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);
const log = [];

function rep(find, replace, tag) {
  if (!src.includes(find)) { log.push("MISS " + tag); return; }
  src = src.replace(find, replace);
  log.push("ok " + tag);
}

// 1. Import.
if (!src.includes('from "./detail"')) {
  rep(
    'import type { ArenaLook } from "./arena";',
    L('import type { ArenaLook } from "./arena";', 'import { marbleSurface, metalSurface } from "./detail";'),
    "import",
  );
}

// 2. Replace the local consts with instance fields so both methods share one
//    set of textures (also avoids generating the canvases twice).
rep(
  L(
    "    const marble = marbleSurface();",
    "    const metal = metalSurface();",
  ),
  L(
    "    this.marbleSurface = marbleSurface();",
    "    this.metalSurface = metalSurface();",
    "    const marble = this.marbleSurface;",
  ),
  "hoist surfaces",
);

// 3. Declare the fields. Anchor on an existing private field.
const fieldAnchor = src.match(/^ {2}private [a-zA-Z]+.*;$/m);
if (fieldAnchor) {
  rep(
    fieldAnchor[0],
    L(
      "  private marbleSurface!: ReturnType<typeof marbleSurface>;",
      "",
      "  private metalSurface!: ReturnType<typeof metalSurface>;",
      "",
      fieldAnchor[0],
    ),
    "declare fields",
  );
} else {
  log.push("MISS field anchor");
}

// 4. buildBase() uses `marble` and `metal` - bind them from the instance.
rep(
  "  private buildBase(): void {",
  L(
    "  private buildBase(): void {",
    "    const marble = this.marbleSurface;",
    "    const metal = this.metalSurface;",
  ),
  "buildBase locals",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
