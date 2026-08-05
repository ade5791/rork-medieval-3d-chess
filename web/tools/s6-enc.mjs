/**
 * The PowerShell console renders the index.html title as mojibake. That is
 * either (a) a real byte corruption that would ship a broken <title>, or (b)
 * merely the console's code page mangling a correct UTF-8 em dash on display.
 * Only the raw bytes can tell them apart, so read them directly.
 */
import { readFileSync } from "node:fs";

for (const f of ["index.html", "dist/index.html"]) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    console.log(`${f}: MISSING`);
    continue;
  }
  const s = buf.toString("utf8");
  const m = s.match(/<title>([^<]*)<\/title>/);
  const title = m ? m[1] : "(no title)";
  const idx = buf.indexOf(Buffer.from("Gambit", "utf8"));
  const around = buf.subarray(idx, idx + 20);
  console.log(`--- ${f}`);
  console.log(`  title            : ${JSON.stringify(title)}`);
  console.log(`  codepoints       : ${[...title].map((c) => c.codePointAt(0).toString(16)).join(" ")}`);
  console.log(`  bytes after 'Gambit': ${around.toString("hex")}`);
  console.log(`  has U+FFFD       : ${title.includes("\uFFFD")}`);
  console.log(`  valid utf8 round : ${Buffer.from(s, "utf8").equals(buf)}`);
}
