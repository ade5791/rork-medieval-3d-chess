// Surgical patcher for sceneEngine.ts - line-ending agnostic.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/sceneEngine.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);

let applied = [];
function patch(name, find, replace) {
  if (src.includes(replace.split(nl)[1] ?? "@@nope@@") && name !== "probe") {
    applied.push(name + ": ALREADY");
    return;
  }
  if (!src.includes(find)) {
    applied.push(name + ": MISS");
    return;
  }
  src = src.replace(find, replace);
  applied.push(name + ": OK");
}

// 1. field for review state
patch(
  "field",
  "  private frameId = 0;",
  L(
    "  /** Deterministic review-state flags parsed from the query string. */",
    "  private review = readReviewState();",
    "  private frameId = 0;",
  ),
);

// 2. apply arena/quality override at top of constructor body
patch(
  "override",
  "    this.preset = preset;" + nl + "    this.arena = arena;",
  L(
    "    // Deterministic review states: a capture harness pins the arena, the",
    "    // preset and post-processing through the query string so two builds can",
    "    // be diffed pixel-for-pixel. Inert when no query string is present.",
    "    if (this.review.arena) arena = this.review.arena;",
    "    if (this.review.quality) preset = this.review.quality;",
    "",
    "    this.preset = preset;",
    "    this.arena = arena;",
  ),
);

// 3. no-post baseline gate + probe, right after postfx.setPreset(preset)
patch(
  "nopost",
  "    this.postfx.setPreset(preset);" + nl + nl + "    this.bindEvents();",
  L(
    "    this.postfx.setPreset(preset);",
    "    // NO-POST BASELINE GATE: the scene must read with the whole composer off.",
    "    if (this.review.noPost) this.postfx.forceDirect(\"no-post baseline gate\");",
    "",
    "    this.bindEvents();",
  ),
);

// 4. pin quality - never step down during a capture
patch(
  "pin",
  "    // One automatic step down if the detected preset is clearly too heavy." + nl + "    if (this.autoAdjusted || this.elapsed < 8 || this.fpsSamples.length < 100) return;",
  L(
    "    // One automatic step down if the detected preset is clearly too heavy.",
    "    // A pinned preset never steps down: recompiling lit materials mid-capture",
    "    // would invalidate the pixel diff.",
    "    if (this.review.pinQuality) return;",
    "    if (this.autoAdjusted || this.elapsed < 8 || this.fpsSamples.length < 100) return;",
  ),
);

fs.writeFileSync(file, src);
console.log(applied.join("\n"));
