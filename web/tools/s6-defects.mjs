/**
 * Extracts failing checks from the QA report. Shape-agnostic: walks the JSON and
 * collects every object that looks like a check result ({pass:false,...}), so it
 * works regardless of how the report nests surfaces.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] || "tools/out/s6-qa-publish.json";
const rep = JSON.parse(readFileSync(file, "utf8"));

console.log("top-level keys:", Object.keys(rep));
console.log("sample:", JSON.stringify(rep, null, 1).slice(0, 900));

const fails = [];
(function walk(node, path) {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
  if (node && typeof node === "object") {
    if (node.pass === false) fails.push({ path, ...node });
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  }
})(rep, "");

console.log(`\n==== ${fails.length} failing checks ====`);
for (const f of fails) {
  console.log(`\n${f.path}`);
  console.log(`  name  : ${f.name || f.id || f.check}`);
  const d = f.detail ?? f.message ?? f.info;
  console.log(`  detail: ${typeof d === "string" ? d : JSON.stringify(d)}`);
  for (const key of ["offenders", "undersized", "items", "controls", "data", "rects"]) {
    if (f[key]) console.log(`  ${key}: ${JSON.stringify(f[key])}`);
  }
}
