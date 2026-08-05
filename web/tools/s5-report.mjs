import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('tools/out/s5/s5-matrix.json', 'utf8'));
const surfaces = m.surfaces || [];
console.log('keys of surface[0]:', Object.keys(surfaces[0]).join(','));
const getChecks = (s) => s.checks || s.results || s.assertions || [];
for (const s of surfaces) {
  const cs = getChecks(s);
  const p = cs.filter((c) => c.pass).length;
  console.log(String(s.name || s.surface).padEnd(36), p + '/' + cs.length);
}
const fails = new Map();
for (const s of surfaces) {
  for (const c of getChecks(s)) {
    if (c.pass) continue;
    const key = c.name || c.label;
    if (!fails.has(key)) fails.set(key, []);
    fails.get(key).push({ surface: s.name || s.surface, detail: c.detail || c.info || '' });
  }
}
console.log('\n--- DISTINCT FAILURES (' + fails.size + ') ---');
for (const [k, v] of fails) {
  console.log('\n[' + v.length + ' surfaces] ' + k);
  for (const e of v) console.log('   - ' + e.surface + ' :: ' + String(e.detail).slice(0, 160));
}
