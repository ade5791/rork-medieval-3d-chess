// Exhaustive albedo-floor scan of the scene source.
// Computes linear luminance for every `color: 0xRRGGBB` literal and reports the
// ones under the 0.02 floor, with file + line + surrounding context so each can
// be judged (a lit surface albedo must be lifted; an emissive, fog or additive
// FX colour must NOT be).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, "..", "src", "scene");

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lumOf = (hex) => {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
};

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

const out = [];
for (const name of files) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const re = /color:\s*(0x[0-9a-fA-F]{6})/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const hex = parseInt(m[1], 16);
      const lum = lumOf(hex);
      if (lum >= 0.02) continue;
      const ctx = line.trim();
      // Exclude the obvious non-surfaces by context.
      const skip = /emissive|MeshBasicMaterial|fog|Fog|Light\(|background|shadowColor|new THREE\.Color/.test(ctx);
      out.push({
        file: name,
        line: i + 1,
        hex: m[1],
        lum: Number(lum.toFixed(5)),
        likelySurface: !skip,
        ctx: ctx.slice(0, 110),
      });
    }
  });
}

out.sort((a, b) => a.lum - b.lum);
const surfaces = out.filter((r) => r.likelySurface);
console.log(`total dark literals: ${out.length}   likely lit surfaces: ${surfaces.length}\n`);
for (const r of surfaces) {
  console.log(`${r.file}:${r.line}  ${r.hex}  lum=${r.lum}  ${r.ctx}`);
}
fs.writeFileSync(
  path.resolve(__dirname, "..", "reports", "albedo-floor-scan.json"),
  JSON.stringify(out, null, 2),
);
