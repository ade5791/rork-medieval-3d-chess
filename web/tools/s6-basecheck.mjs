/**
 * Verifies the STAGED dist was actually built for the Pages subpath.
 *
 * This is the check that catches the classic project-site failure: index.html
 * returns 200, the app boots, and every model 404s because a root-absolute
 * "/models/..." URL resolved against the domain root instead of /<repo>/.
 * Grepping the emitted bundle is the only way to prove the base actually got
 * baked in, since the source uses import.meta.env.BASE_URL which is substituted
 * at build time.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXPECT_BASE = process.argv[2] || "/kings-gambit-medieval-3d-chess/";
const DIST = "dist";

const html = readFileSync(join(DIST, "index.html"), "utf8");
const assetsDir = join(DIST, "assets");
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
const bundle = jsFiles
  .map((f) => readFileSync(join(assetsDir, f), "utf8"))
  .join("\n");

const checks = [];
function rec(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  :: ${detail}`);
}

rec(
  "html script src uses base",
  html.includes(`src="${EXPECT_BASE}assets/`),
  `expected src="${EXPECT_BASE}assets/..."`,
);
rec(
  "html stylesheet uses base",
  html.includes(`href="${EXPECT_BASE}assets/`),
  `expected href="${EXPECT_BASE}assets/..."`,
);
rec(
  "html icons use base",
  html.includes(`${EXPECT_BASE}favicon.png`) && html.includes(`${EXPECT_BASE}icon.png`),
  "favicon.png + icon.png prefixed",
);
rec(
  "no root-absolute /assets/ left in html",
  !/(src|href)="\/assets\//.test(html),
  "html has no bare /assets/ reference",
);

// Runtime model paths: BASE_URL should be inlined as the subpath string.
const hasBasedModels = bundle.includes(`${EXPECT_BASE}models/`) || bundle.includes(EXPECT_BASE);
rec("bundle contains the base string", hasBasedModels, `looked for ${EXPECT_BASE}`);

const bareModels = bundle.match(/"\/models\//g) || [];
rec(
  "no bare root-absolute /models/ in bundle",
  bareModels.length === 0,
  `occurrences=${bareModels.length}`,
);

const bad = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - bad.length}/${checks.length} base-path checks pass`);
console.log("HTML:\n" + html);
process.exit(bad.length ? 1 : 0);
