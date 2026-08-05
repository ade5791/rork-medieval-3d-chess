import crypto from "node:crypto";
import fs from "node:fs";

const name = "index-B_5K7ZaQ.js";
const res = await fetch(`http://127.0.0.1:4173/assets/${name}`);
const served = Buffer.from(await res.arrayBuffer());
const disk = fs.readFileSync(`dist/assets/${name}`);
const h = (b) => crypto.createHash("sha256").update(b).digest("hex");
console.log(`HTTP=${res.status}`);
console.log(`SERVED_SHA=${h(served)}  ${served.length} bytes`);
console.log(`DISK_SHA  =${h(disk)}  ${disk.length} bytes`);
console.log(`BUNDLE_IDENTICAL=${h(served) === h(disk)}`);
