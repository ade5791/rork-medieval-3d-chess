import fs from "node:fs";

const base = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/";
const log = [];

function patch(name, fn) {
  const file = base + name;
  let src = fs.readFileSync(file, "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const before = src;
  src = fn(src, nl, (...lines) => lines.join(nl), (s, find, replace, tag) => {
    if (!s.includes(find)) { log.push("MISS " + tag); return s; }
    log.push("ok " + tag);
    return s.replace(find, replace);
  });
  if (src !== before) fs.writeFileSync(file, src);
  log.push(name + (src !== before ? ": WRITTEN" : ": NO-CHANGE"));
}

// 1. Troop material metalness (6-space indent inside the for loop).
patch("battlefield.ts", (src, nl, L, rep) => {
  return rep(
    src,
    L(
      "          color: army.tint,",
      "          roughness: 0.95,",
      "          metalness: 0.2,",
    ),
    L(
      "          color: army.tint,",
      "          roughness: 0.95,",
      "          // Cloth and leather livery: dielectric, not a 0.2 metal blend.",
      "          metalness: 0,",
    ),
    "troops",
  );
});

// 2. Wire disposeSurfaces() into engine teardown - the shared maps are module
//    cached, so without this they survive a scene teardown and leak.
patch("sceneEngine.ts", (src, nl, L, rep) => {
  if (!src.includes("disposeSurfaces")) {
    const anchor = src.match(/^import .*from "\.\/quality";$/m)
      || src.match(/^import .*from "\.\/textures";$/m)
      || src.match(/^import .*from "\.\/board";$/m);
    if (anchor) {
      src = rep(src, anchor[0], L(anchor[0], 'import { disposeSurfaces } from "./detail";'), "engine import");
    } else {
      log.push("MISS engine import anchor");
      return src;
    }
    src = rep(
      src,
      "  dispose(): void {",
      L(
        "  dispose(): void {",
        "    // Shared surface-detail maps are module-cached across the scene, so",
        "    // they are not owned by any one subsystem's disposable list.",
        "    disposeSurfaces();",
      ),
      "engine dispose",
    );
  }
  return src;
});

fs.writeFileSync(
  "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/reports/patch-final.log",
  log.join("\n"),
);
console.log(log.join("\n"));
