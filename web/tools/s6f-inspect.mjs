// S6-fresh: byte-level inspection of the source index.html and the staged dist.
// Purpose: identify encoding damage BEFORE it is committed as publish bytes.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');

function inspect(label, file) {
  if (!fs.existsSync(file)) { console.log(label + ': MISSING'); return; }
  const buf = fs.readFileSync(file);
  console.log('--- ' + label + ' ---');
  console.log('bytes=' + buf.length);
  // BOM?
  console.log('bom=' + (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF));
  // NUL bytes are the signature of PowerShell UTF-16 redirection damage.
  let nul = 0;
  for (const b of buf) if (b === 0) nul++;
  console.log('nulBytes=' + nul);
  // Non-ASCII bytes
  const nonAscii = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7f) nonAscii.push(i);
  }
  console.log('nonAsciiByteCount=' + nonAscii.length);
  if (nonAscii.length) {
    const first = nonAscii[0];
    const s = Math.max(0, first - 30);
    const e = Math.min(buf.length, first + 30);
    console.log('firstNonAsciiAt=' + first);
    console.log('hex=' + [...buf.subarray(s, e)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('utf8=' + JSON.stringify(buf.subarray(s, e).toString('utf8')));
    console.log('latin1=' + JSON.stringify(buf.subarray(s, e).toString('latin1')));
  }
  // stray lone CR (a \r not followed by \n) - the "\r\r\n" defect
  const txt = buf.toString('utf8');
  const strayCR = (txt.match(/\r(?!\n)/g) || []).length;
  console.log('strayLoneCR=' + strayCR);
  const crlf = (txt.match(/\r\n/g) || []).length;
  const loneLF = (txt.match(/(?<!\r)\n/g) || []).length;
  console.log('crlf=' + crlf + ' loneLF=' + loneLF);
  const t = txt.match(/<title>([\s\S]*?)<\/title>/);
  if (t) console.log('title=' + JSON.stringify(t[1]));
}

inspect('web/index.html (SOURCE)', path.join(ROOT, 'web/index.html'));
inspect('web/dist/index.html (STAGED)', path.join(ROOT, 'web/dist/index.html'));
inspect('docs/publish/PUBLISH.md', path.join(ROOT, 'docs/publish/PUBLISH.md'));
