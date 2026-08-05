// S6 (fresh run): hash every published byte so the live site can be proved identical.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.argv[2] || "dist";
const out = process.argv[3] || "tools/out/s6r-manifest.json";

function walk(dir, base = "") {
  const rows = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) rows.push(...walk(abs, rel));
    else {
      const buf = fs.readFileSync(abs);
      rows.push({
        path: rel,
        size: buf.length,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      });
    }
  }
  return rows;
}

const files = walk(root).sort((a, b) => a.path.localeCompare(b.path));
const treeHash = crypto
  .createHash("sha256")
  .update(files.map((f) => f.sha256 + "  " + f.path).join("\n"))
  .digest("hex");

const manifest = {
  root,
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  totalBytes: files.reduce((n, f) => n + f.size, 0),
  treeHash,
  files,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log("files=" + manifest.fileCount);
console.log("bytes=" + manifest.totalBytes);
console.log("treeHash=" + treeHash);
console.log("out=" + out);
