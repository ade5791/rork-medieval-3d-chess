/** Dumps the per-control evidence for each defect so the fix targets real selectors. */
import { readFileSync } from "node:fs";
const rep = JSON.parse(readFileSync(process.argv[2] || "tools/out/s6-qa-publish.json", "utf8"));
for (const d of rep.defects || []) {
  console.log(`\n=== ${d.id} [${d.severity}] ${d.surface}`);
  console.log(`  ${d.title}`);
  console.log(`  actual: ${d.actual}`);
  for (const e of d.evidence || []) {
    console.log(
      `   - ${String(e.label).padEnd(18)} ${String(e.w ?? e.width).padStart(7)} x ${String(e.h ?? e.height).padStart(7)}  ${e.cls || ""}`,
    );
  }
}
