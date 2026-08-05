// Static audit scan: Five Laws compliance + subsystem inventory.
// ASCII only. Run: node scripts/audit-static.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const rel = (p) => path.relative(path.resolve(process.cwd()), p).split(path.sep).join('/');

const PATTERNS = {
  mathRandom: /Math\.random\s*\(/g,
  ambientLight: /new\s+THREE\.AmbientLight|AmbientLight\s*\(/g,
  hemiLight: /HemisphereLight/g,
  pmrem: /PMREMGenerator/g,
  compileCall: /\.compile\s*\(|compileAsync/g,
  rafCall: /requestAnimationFrame/g,
  cancelRaf: /cancelAnimationFrame/g,
  disposeCall: /\.dispose\s*\(/g,
  perfNow: /performance\.now\s*\(/g,
  newVecInFn: /new\s+THREE\.(Vector2|Vector3|Quaternion|Matrix4|Color|Euler|Box3|Ray|Plane|Sphere)\s*\(/g,
  toneMapping: /toneMapping/g,
  outputColorSpace: /outputColorSpace/g,
  setPixelRatio: /setPixelRatio/g,
  windowHook: /window\.__[A-Za-z0-9_]+/g,
  seededRng: /xoshiro|mulberry|seedrandom|createRng|makeRng/gi,
  instancedMesh: /InstancedMesh/g,
  drawCallsInfo: /renderer\.info/g,
};

const counts = {};
const perFile = {};
let totalLines = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  totalLines += lines.length;
  const hits = {};
  for (const [k, re] of Object.entries(PATTERNS)) {
    re.lastIndex = 0;
    const m = src.match(re);
    if (m && m.length) {
      hits[k] = m.length;
      counts[k] = (counts[k] || 0) + m.length;
    }
  }
  if (Object.keys(hits).length) perFile[rel(f)] = hits;
}

// Per-frame allocation detection: find animate/update/tick/render function bodies
// and count THREE object constructions inside them.
const FRAME_FN = /(?:function\s+(\w*(?:animate|update|tick|render|frame)\w*)|(\w*(?:animate|update|tick|render|frame)\w*)\s*(?::|=)\s*(?:function)?\s*\(|(\w*(?:animate|update|tick|render|frame)\w*)\s*\([^)]*\)\s*\{)/gi;
const frameAlloc = [];
for (const f of files) {
  if (!/[\\/](scene|core|ui)[\\/]/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/new\s+THREE\.(Vector2|Vector3|Quaternion|Matrix4|Color|Euler|Box3)\s*\(/.test(line)) continue;
    // look backwards up to 120 lines for an enclosing frame-ish function
    let owner = null;
    for (let j = i; j >= Math.max(0, i - 160); j--) {
      const m = lines[j].match(/(?:private\s+|public\s+|function\s+|const\s+|\s)(\w*(?:[Uu]pdate|[Aa]nimate|[Tt]ick|[Ff]rame|[Ss]tep)\w*)\s*[=(:]/);
      if (m) { owner = m[1]; break; }
    }
    if (owner) frameAlloc.push({ file: rel(f), line: i + 1, owner, code: line.trim().slice(0, 120) });
  }
}

const inventory = files
  .map((f) => ({ file: rel(f), bytes: fs.statSync(f).size, lines: fs.readFileSync(f, 'utf8').split(/\r?\n/).length }))
  .filter((x) => !x.file.includes('components/ui/'))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 30);

const out = { generatedAt: new Date().toISOString(), fileCount: files.length, totalLines, counts, perFile, frameAllocSuspects: frameAlloc, inventory };
fs.mkdirSync('../docs/audit', { recursive: true });
fs.writeFileSync('../docs/audit/static-scan.json', JSON.stringify(out, null, 2));
console.log('files', files.length, 'lines', totalLines);
console.log('COUNTS', JSON.stringify(counts, null, 2));
console.log('FRAME_ALLOC_SUSPECTS', frameAlloc.length);
for (const s of frameAlloc.slice(0, 40)) console.log('  ', s.file + ':' + s.line, '[' + s.owner + ']', s.code);
