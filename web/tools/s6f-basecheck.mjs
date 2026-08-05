// S6-fresh: verify the STAGED bundle contains no root-absolute asset paths that
// would 404 on a GitHub Pages PROJECT site (served under /<repo>/).
//
// This is the exact class of failure the step warns about: a 200 on index.html
// proves nothing if every model request resolves to /models/... on the domain
// root instead of /<repo>/models/...
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const DIST = path.join(ROOT, 'web/dist');
const BASE = process.argv[2] || '/kings-gambit-medieval-chess/';

const results = { base: BASE, checks: [] };
function check(name, pass, detail) {
  results.checks.push({ name, pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

// 1. index.html must reference every entry asset under BASE.
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
const local = srcs.filter(s => !/^https?:/.test(s));
check('index.html local refs all under base',
  local.every(s => s.startsWith(BASE)),
  'refs=' + JSON.stringify(local));

// 2. Bundle must not contain a root-absolute "/models/" literal.
const jsFiles = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.js'));
let rootAbsModels = 0;
let baseModels = 0;
for (const f of jsFiles) {
  const t = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8');
  rootAbsModels += (t.match(/"\/models\//g) || []).length;
  rootAbsModels += (t.match(/'\/models\//g) || []).length;
  baseModels += (t.match(/models\//g) || []).length;
}
check('no root-absolute "/models/" literal in bundle', rootAbsModels === 0,
  'rootAbs=' + rootAbsModels + ' anyModelsRef=' + baseModels);

// 3. The BASE_URL constant must be inlined as the project base, not "/".
let baseInlined = 0;
for (const f of jsFiles) {
  const t = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8');
  baseInlined += (t.split(BASE).length - 1);
}
check('project base string inlined in bundle', baseInlined > 0, 'occurrences=' + baseInlined);

// 4. .nojekyll present (Pages otherwise strips _-prefixed paths).
check('.nojekyll present at dist root', fs.existsSync(path.join(DIST, '.nojekyll')));

// 5. models/ present with all three era rosters.
const eras = ['rome', 'egypt', 'sengoku'];
for (const e of eras) {
  const d = path.join(DIST, 'models', e);
  const n = fs.existsSync(d) ? fs.readdirSync(d).length : 0;
  check('models/' + e + ' present', n > 0, 'files=' + n);
}

// 6. No lone CR (\r not followed by \n) in text assets - byte hygiene.
let stray = 0;
for (const f of ['index.html']) {
  const t = fs.readFileSync(path.join(DIST, f), 'utf8');
  stray += (t.match(/\r(?!\n)/g) || []).length;
}
check('no stray lone CR in index.html', stray === 0, 'strayCR=' + stray);

const failed = results.checks.filter(c => !c.pass);
console.log('\nSUMMARY ' + (results.checks.length - failed.length) + '/' + results.checks.length + ' pass');
fs.mkdirSync(path.join(ROOT, 'web/tools/out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'web/tools/out/s6f-basecheck.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
