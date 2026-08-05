import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('tools/out/s4-perf-matrix-final.json', 'utf8'));
const cells = raw.cells;
const f = (n) => (n === undefined || n === null ? '-' : Number(n).toFixed(1));

console.log('generatedAt', raw.generatedAt);
console.log('viewport', JSON.stringify(raw.viewport), 'warmupMs', raw.warmupMs, 'measureMs', raw.measureMs);
console.log('gpu', cells[0].gpu, 'dpr', cells[0].dpr);
console.log('cells', cells.length, 'ok', cells.filter((c) => c.ok).length);

console.log('\n=== PER-CELL (p50ms / fps50 / p95 / p99 / max / hitch50 / late / calls / tris / lights vis) ===');
for (const c of cells) {
  const p = c.perf;
  console.log(
    [
      c.cell.padEnd(30),
      f(p.p50),
      f(p.fps50),
      f(p.p95),
      f(p.p99),
      f(p.max),
      p.hitches50,
      c.programs.lateCompiles,
      c.census.calls,
      c.census.triangles,
      `${c.lights.visible}/${c.lights.total}`,
    ].join(' | ')
  );
}

// integrity checks
console.log('\n=== INTEGRITY ===');
const notOk = cells.filter((c) => !c.ok);
const consoleErr = cells.filter((c) => (c.consoleErrors || []).length > 0);
const frameErr = cells.filter((c) => c.perf.frameErrors > 0);
const presetDrift = cells.filter((c) => c.presetActual !== c.preset);
const arenaDrift = cells.filter((c) => c.arenaActual !== c.arena || c.eraActual !== c.era);
const postOn = cells.filter((c) => c.postEnabled);
console.log('failed cells:', notOk.length);
console.log('cells with console errors:', consoleErr.length, consoleErr.map((c) => c.cell).join(', '));
console.log('cells with frame errors:', frameErr.length);
console.log('preset drift:', presetDrift.length, 'arena/era drift:', arenaDrift.length);
console.log('cells with post enabled:', postOn.length);
const beatTo = cells.filter((c) => c.combat.beatTimeouts > 0);
const animTo = cells.filter((c) => c.combat.animationTimeouts > 0);
console.log('beat timeouts:', beatTo.length, 'animation timeouts:', animTo.length);

// light constancy
console.log('\n=== LIGHT COUNT CONSTANCY (visible must not change across window) ===');
const lightDrift = cells.filter((c) => c.lights.visible !== c.lightsBefore.visible || c.lights.lit !== c.lightsBefore.lit);
console.log(lightDrift.length === 0 ? 'PASS - visible/lit light count identical before and after in all 48 cells' : lightDrift.map((c) => `${c.cell}: ${c.lightsBefore.visible}->${c.lights.visible} lit ${c.lightsBefore.lit}->${c.lights.lit}`).join('\n'));

// prewarm
console.log('\n=== SHADER PREWARM ===');
const noPrewarm = cells.filter((c) => !c.prewarm || !c.prewarm.ran);
console.log('cells where prewarm ran:', cells.length - noPrewarm.length, '/', cells.length);
const compiled = cells.map((c) => c.prewarm.compiled);
const pmMs = cells.map((c) => c.prewarm.ms);
console.log('programs compiled behind loading screen: min', Math.min(...compiled), 'max', Math.max(...compiled));
console.log('prewarm duration ms: min', f(Math.min(...pmMs)), 'max', f(Math.max(...pmMs)));
const lateCells = cells.filter((c) => c.programs.lateCompiles > 0);
console.log('cells with LATE compiles during measurement:', lateCells.length);
for (const c of lateCells) console.log(`  ${c.cell}: +${c.programs.lateCompiles} (start ${c.programs.atStart} -> after ${c.programs.after}) max frame ${f(c.perf.max)}ms`);

// hitches
console.log('\n=== HITCHES > 50ms ===');
const hitchy = cells.filter((c) => c.perf.hitches50 > 0);
console.log(hitchy.length === 0 ? 'PASS - zero frames over 50ms in all 48 cells' : hitchy.map((c) => `${c.cell}: ${c.perf.hitches50} hitches, max ${f(c.perf.max)}ms`).join('\n'));

// rollups
const group = (key) => {
  const m = {};
  for (const c of cells) (m[c[key]] ||= []).push(c);
  return m;
};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('\n=== PRESET ROLLUP ===');
for (const [k, arr] of Object.entries(group('preset'))) {
  const ps = arr.map((c) => c.perf.p50);
  const worst = Math.max(...ps);
  const wc = arr.find((c) => c.perf.p50 === worst);
  console.log(`${k.padEnd(7)} n=${arr.length} medianP50=${f(med(ps))}ms (${f(1000 / med(ps))}fps)  worstP50=${f(worst)}ms (${f(1000 / worst)}fps) @ ${wc.cell}  medianCalls=${med(arr.map((c) => c.census.calls))} medianTris=${med(arr.map((c) => c.census.triangles))}`);
}

console.log('\n=== PHASE ROLLUP ===');
for (const [k, arr] of Object.entries(group('phase'))) {
  const ps = arr.map((c) => c.perf.p50);
  console.log(`${k.padEnd(8)} n=${arr.length} medianP50=${f(med(ps))}ms (${f(1000 / med(ps))}fps) medianCalls=${med(arr.map((c) => c.census.calls))} medianTris=${med(arr.map((c) => c.census.triangles))}`);
}

console.log('\n=== BATTLEGROUND ROLLUP ===');
for (const [k, arr] of Object.entries(group('battleground'))) {
  const ps = arr.map((c) => c.perf.p50);
  console.log(`${k.padEnd(16)} n=${arr.length} medianP50=${f(med(ps))}ms (${f(1000 / med(ps))}fps)`);
}

console.log('\n=== ERA ROLLUP (civilisation) ===');
for (const [k, arr] of Object.entries(group('era'))) {
  const ps = arr.map((c) => c.perf.p50);
  console.log(`${k.padEnd(8)} n=${arr.length} medianP50=${f(med(ps))}ms (${f(1000 / med(ps))}fps) medianTris=${med(arr.map((c) => c.census.triangles))}`);
}

console.log('\n=== 60FPS P50 GATE (16.67ms) PER PRESET ===');
for (const [k, arr] of Object.entries(group('preset'))) {
  const fails = arr.filter((c) => c.perf.p50 > 16.67);
  console.log(`${k.padEnd(7)} ${arr.length - fails.length}/${arr.length} cells >= 60fps p50${fails.length ? '  FAIL: ' + fails.map((c) => `${c.cell} ${f(1000 / c.perf.p50)}fps`).join(', ') : ''}`);
}

console.log('\n=== 60FPS P99 GATE PER PRESET ===');
for (const [k, arr] of Object.entries(group('preset'))) {
  const fails = arr.filter((c) => c.perf.p99 > 16.67);
  console.log(`${k.padEnd(7)} ${arr.length - fails.length}/${arr.length} cells >= 60fps p99`);
}

console.log('\n=== SCALING: same arena/phase across presets (classic-dusk/opening) ===');
for (const c of cells.filter((x) => x.battleground === 'classic-dusk' && x.phase === 'opening')) {
  console.log(`${c.preset.padEnd(7)} p50=${f(c.perf.p50)}ms calls=${c.census.calls} tris=${c.census.triangles} progs=${c.census.programs} textures=${c.census.textures} geo=${c.census.geometries} lit=${c.lights.lit}`);
}

console.log('\n=== LOAD TIME ===');
const loads = cells.map((c) => c.loadMs);
console.log('loadMs min', Math.min(...loads), 'median', med(loads), 'max', Math.max(...loads));
