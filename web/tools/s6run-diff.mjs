// Compare two s6 manifests: report files only in A, only in B, and hash mismatches.
import { readFileSync } from "node:fs";

const a = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = JSON.parse(readFileSync(process.argv[3], "utf8"));

const mapA = new Map(a.files.map((f) => [f.path, f]));
const mapB = new Map(b.files.map((f) => [f.path, f]));

const onlyA = [...mapA.keys()].filter((p) => !mapB.has(p));
const onlyB = [...mapB.keys()].filter((p) => !mapA.has(p));
const diff = [...mapA.keys()].filter((p) => mapB.has(p) && mapA.get(p).sha256 !== mapB.get(p).sha256);

console.log("A:", process.argv[2], a.fileCount, "files, tree", a.treeHash.slice(0, 12));
console.log("B:", process.argv[3], b.fileCount, "files, tree", b.treeHash.slice(0, 12));
console.log("only in A:", JSON.stringify(onlyA));
console.log("only in B:", JSON.stringify(onlyB));
console.log("hash mismatches:", JSON.stringify(diff));
