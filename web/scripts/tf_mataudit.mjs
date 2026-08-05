// Static material audit: extract MeshStandard/Physical constructor params from scene sources
// and check them against the photometric bar (albedo 0.02-0.9 linear, metals binary).
import fs from "node:fs";
import path from "node:path";

const dir = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexLuminance(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

const rows = [];
const mapChannels = { map: 0, normalMap: 0, roughnessMap: 0, aoMap: 0, metalnessMap: 0, bumpMap: 0, displacementMap: 0 };

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const k of Object.keys(mapChannels)) {
    const m = src.match(new RegExp("\\b" + k + "\\s*[:,]", "g"));
    if (m) mapChannels[k] += m.length;
  }
  // find MeshStandardMaterial({...}) / MeshPhysicalMaterial({...}) blocks
  const re = /new THREE\.(MeshStandardMaterial|MeshPhysicalMaterial)\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1;
    let depth = 0;
    let end = i;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    const body = src.slice(i, end + 1);
    const line = src.slice(0, m.index).split("\n").length;
    const grab = (key) => {
      const mm = body.match(new RegExp(key + "\\s*:\\s*([^,}\\n]+)"));
      return mm ? mm[1].trim() : null;
    };
    const colorRaw = grab("color");
    const rough = grab("roughness");
    const metal = grab("metalness");
    let lum = null;
    if (colorRaw && /^0x[0-9a-fA-F]{6}$/.test(colorRaw)) lum = hexLuminance(parseInt(colorRaw, 16));
    rows.push({
      file: f, line, type: m[1],
      color: colorRaw, lum,
      roughness: rough ? parseFloat(rough) : null,
      metalness: metal ? parseFloat(metal) : null,
      hasMap: /\bmap\s*:/.test(body),
      hasNormal: /normalMap\s*:/.test(body),
      hasRoughMap: /roughnessMap\s*:/.test(body),
    });
  }
}

const withLum = rows.filter((r) => r.lum !== null);
const tooDark = withLum.filter((r) => r.lum < 0.02);
const tooBright = withLum.filter((r) => r.lum > 0.9);
const metals = rows.filter((r) => r.metalness !== null);
const nonBinary = metals.filter((r) => r.metalness > 0.05 && r.metalness < 0.95);

const out = {
  totalMaterials: rows.length,
  withHexColor: withLum.length,
  albedoViolations: { tooDark: tooDark.length, tooBright: tooBright.length },
  tooDarkList: tooDark.map((r) => `${r.file}:${r.line} ${r.color} lum=${r.lum.toFixed(4)}`),
  tooBrightList: tooBright.map((r) => `${r.file}:${r.line} ${r.color} lum=${r.lum.toFixed(4)}`),
  metalness: {
    declared: metals.length,
    nonBinary: nonBinary.length,
    nonBinaryList: nonBinary.map((r) => `${r.file}:${r.line} metalness=${r.metalness} lum=${r.lum === null ? "n/a" : r.lum.toFixed(3)}`),
  },
  mapChannelUsage: mapChannels,
  materialsWithAnyMap: rows.filter((r) => r.hasMap).length,
  materialsWithNormalMap: rows.filter((r) => r.hasNormal).length,
  materialsWithRoughnessMap: rows.filter((r) => r.hasRoughMap).length,
  roughnessStats: (() => {
    const rs = rows.map((r) => r.roughness).filter((v) => v !== null && !Number.isNaN(v));
    rs.sort((a, b) => a - b);
    return { count: rs.length, min: rs[0], median: rs[Math.floor(rs.length / 2)], max: rs[rs.length - 1] };
  })(),
};

fs.writeFileSync("C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/reports/material-audit.json", JSON.stringify({ summary: out, rows }, null, 2));
console.log(JSON.stringify(out, null, 2));
