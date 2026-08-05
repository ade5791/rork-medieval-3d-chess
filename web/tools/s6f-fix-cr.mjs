// S6-fresh: remove the stray lone CR from web/index.html.
// A "\r\r\n" sequence is an artifact of a CRLF file being written through a
// CRLF-translating writer twice. It is harmless to browsers but it is a real
// byte defect and it makes the publish-byte hash misleading, so it is fixed at
// SOURCE before the gated build rather than patched in dist.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess');
const FILE = path.join(ROOT, 'web/index.html');

const before = fs.readFileSync(FILE, 'utf8');
const strayBefore = (before.match(/\r(?!\n)/g) || []).length;
console.log('source strayLoneCR before=' + strayBefore);

// Collapse any run of CRs immediately preceding a LF down to exactly one CR.
let after = before.replace(/\r+(?=\n)/g, '\r');
// Any remaining lone CR (not followed by LF) becomes CRLF.
after = after.replace(/\r(?!\n)/g, '\r\n');

const strayAfter = (after.match(/\r(?!\n)/g) || []).length;
console.log('source strayLoneCR after=' + strayAfter);

if (after !== before) {
  fs.writeFileSync(FILE, after, 'utf8');
  console.log('WROTE ' + FILE + ' bytes ' + Buffer.byteLength(before) + ' -> ' + Buffer.byteLength(after));
} else {
  console.log('no change needed');
}
