/**
 * Is the title mojibake real, or just the PowerShell console misrendering UTF-8?
 * Decides whether a text fix is needed before the bytes are published.
 */
import { readFileSync } from "node:fs";
const buf = readFileSync("dist/index.html");
const i = buf.indexOf(Buffer.from("Gambit"));
const slice = buf.subarray(i, i + 24);
console.log("raw bytes after 'Gambit':", [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" "));
console.log("utf8 decode :", JSON.stringify(slice.toString("utf8")));
console.log("title utf8  :", JSON.stringify(buf.toString("utf8").match(/<title>(.*?)<\/title>/s)?.[1]));
console.log("has U+FFFD  :", buf.toString("utf8").includes("\uFFFD"));
