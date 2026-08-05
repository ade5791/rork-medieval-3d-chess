// Add owner attribution to the material probe. Idempotent, line-ending agnostic.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "sceneEngine.ts");
let src = fs.readFileSync(file, "utf8");

if (src.includes("matName:")) {
  console.log("SKIP already patched");
  process.exit(0);
}

const anchor = "              aoMap: Boolean(m.aoMap),";
const idx = src.indexOf(anchor);
if (idx === -1) {
  console.log("FAIL anchor not found");
  process.exit(1);
}

const addition = [
  "              aoMap: Boolean(m.aoMap),",
  "              // Ownership. A violation count is not actionable unless the",
  "              // offending surface traces back to the module that built it,",
  "              // so carry the mesh name plus its ancestor chain.",
  "              owner: ((): string => {",
  "                const parts: string[] = [];",
  "                let n: THREE.Object3D | null = node;",
  "                for (let i = 0; n && i < 5; i += 1) {",
  "                  parts.push(n.name || n.type);",
  "                  n = n.parent;",
  "                }",
  "                return parts.join(\" < \");",
  "              })(),",
  "              matName: m.name || \"\",",
].join("\r\n");

src = src.slice(0, idx) + addition + src.slice(idx + anchor.length);
fs.writeFileSync(file, src);
console.log("OK patched owner attribution");
