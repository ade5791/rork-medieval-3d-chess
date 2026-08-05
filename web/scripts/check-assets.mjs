// Verify every remote asset URL referenced by generated.ts is reachable + CORS-clean.
// ASCII only.
import fs from 'node:fs';

const src = fs.readFileSync('src/assets/generated.ts', 'utf8');
const base = (src.match(/const\s+MODEL_BASE\s*=\s*"([^"]+)"/) || [])[1] || '';
const audioBase = [...src.matchAll(/const\s+(\w*BASE\w*)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
const urls = new Set();
for (const m of src.matchAll(/`\$\{MODEL_BASE\}(\/[^`]+)`/g)) urls.add(base + m[1]);
for (const m of src.matchAll(/"(https:\/\/[^"]+)"/g)) urls.add(m[1]);

console.log('BASES', JSON.stringify(audioBase));
console.log('URL_COUNT', urls.size);

const results = [];
for (const u of urls) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-2047', Origin: 'http://localhost:5173' } });
    const buf = Buffer.from(await r.arrayBuffer());
    results.push({
      url: u,
      status: r.status,
      ms: Date.now() - t0,
      bytes: buf.length,
      contentLength: r.headers.get('content-length'),
      acao: r.headers.get('access-control-allow-origin'),
      magic: buf.slice(0, 4).toString('ascii'),
    });
  } catch (e) {
    results.push({ url: u, error: String(e) });
  }
}
for (const r of results) {
  console.log(
    (r.status || 'ERR') + '  acao=' + (r.acao || 'NONE') + '  magic=' + (r.magic || '-') + '  ' + (r.ms || 0) + 'ms  ' + r.url.slice(-46)
  );
}
fs.mkdirSync('../docs/audit', { recursive: true });
fs.writeFileSync('../docs/audit/asset-reachability.json', JSON.stringify({ generatedAt: new Date().toISOString(), base, results }, null, 2));
const bad = results.filter((r) => r.error || (r.status !== 200 && r.status !== 206) || !r.acao);
console.log('OK', results.length - bad.length, '/', results.length, ' PROBLEM', bad.length);
