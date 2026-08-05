// Name the badge sprites so the legibility probe can find them.
// Unnamed objects are invisible to any graph query, which is why the metrics
// probe returned nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "pieces.ts");
let src = fs.readFileSync(file, "utf8");

if (src.includes('badge.name =')) {
  console.log("SKIP already named");
  process.exit(0);
}

const find = "    const badge = new THREE.Sprite(material);";
if (!src.includes(find)) { console.log("FAIL anchor missing"); process.exit(1); }

const replace = [
  "    const badge = new THREE.Sprite(material);",
  "    // Named so graph queries (legibility probe, QA tooling) can find it.",
  "    badge.name = `badge_${this.color}_${this.kind}`;",
].join("\r\n");

src = src.replace(find, replace);
fs.writeFileSync(file, src);
console.log("OK named badge sprites");
