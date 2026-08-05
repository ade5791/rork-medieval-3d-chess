// Extracts VERIFIED feature facts from source so the landing page claims only
// what the code actually implements.
import fs from "node:fs";

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } };

const eras = read("src/scene/eras.ts");
const eraIds = [...eras.matchAll(/id:\s*["']([a-z0-9-]+)["']/gi)].map((m) => m[1]);
const eraNames = [...eras.matchAll(/(?:label|name|title):\s*["']([^"']+)["']/gi)].map((m) => m[1]);

const shell = read("src/ui/GameShell.tsx");
const keys = [...shell.matchAll(/event\.key === ["']([^"']+)["']/g)].map((m) => m[1]);

const menu = read("src/ui/MainMenu.tsx");
const tabs = [...menu.matchAll(/tab === ["']([a-z]+)["']/g)].map((m) => m[1]);

const cfg = read("src/core/config.ts") || read("src/scene/quality.ts") || read("src/core/quality.ts");
const presets = [...cfg.matchAll(/^\s*(low|medium|high|ultra):/gim)].map((m) => m[1]);

const out = {
  eraIds: [...new Set(eraIds)],
  eraNames: [...new Set(eraNames)].slice(0, 20),
  keybindings: [...new Set(keys)],
  menuTabs: [...new Set(tabs)],
  qualityPresets: [...new Set(presets)],
  hasOnline: fs.existsSync("src/net"),
  hasWorkerEngine: fs.existsSync("src/worker") || read("src/core/gameController.ts").includes("Worker"),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync("tools/out/s6-features.json", JSON.stringify(out, null, 2));
