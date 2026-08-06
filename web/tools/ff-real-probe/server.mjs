import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "probe.html"));
const outPath = join(here, "result.json");

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/report")) {
    const u = new URL(req.url, "http://localhost");
    const d = u.searchParams.get("d") || "{}";
    writeFileSync(outPath, d);
    res.writeHead(200); res.end("ok");
    console.log("REPORT-RECEIVED");
    setTimeout(() => process.exit(0), 500);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(html);
});
server.listen(9377, () => console.log("probe server on 9377"));
setTimeout(() => { console.log("TIMEOUT-NO-REPORT"); process.exit(2); }, 90000);
