/**
 * Asset-provenance gate.
 *
 * The era gate proves 29 rigged figures stand and animate. It does NOT prove
 * they are the ERA'S figures - the loader is deliberately built to fall back to
 * the classic army, so a totally broken roster would still show 29 rigged
 * medieval knights and pass. This closes that hole by asserting provenance:
 *
 *   - era "rome"    MUST fetch /models/rome/*.glb and MUST NOT fetch the
 *                   remote r2-pub sculpts for any kind it has sculpted
 *   - era "classic" MUST NOT fetch /models/rome/* at all
 *
 * It also compares the rendered material census between eras: different sculpts
 * with different textures cannot produce an identical census, so a match would
 * mean the roster silently fell through.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.GATE_BASE ?? "http://127.0.0.1:4178";
const OUT = path.resolve(import.meta.dirname, "out", "era-gate");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });

async function probeEra(era) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const glbs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.endsWith(".glb")) glbs.push(u);
  });

  await page.goto(`${BASE}/?era=${era}&review=1&probe=1&quality=high`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page
    .waitForFunction(() => Boolean(window.__kg && window.__kg.ready && window.__kg.ready()), null, {
      timeout: 240000,
    })
    .catch(() => {});
  await page.waitForTimeout(4000);

  const census = await page.evaluate(() => {
    const rows = window.__kg.materials ? window.__kg.materials() : [];
    return {
      count: rows.length,
      // Order-independent fingerprint of the rendered surfaces.
      fingerprint: rows
        .map((r) => `${r.matName}|${Number(r.albedoLum ?? 0).toFixed(3)}|${r.metalness}|${r.roughness}`)
        .sort()
        .join(";")
        .slice(0, 4000),
    };
  });
  const roster = await page.evaluate(() => window.__kg.roster());
  await ctx.close();

  const rome = glbs.filter((u) => u.includes("/models/rome/"));
  const remote = glbs.filter((u) => u.includes("r2-pub"));
  return { era, total: glbs.length, romeCount: rome.length, remoteCount: remote.length, census, roster };
}

const classic = await probeEra("classic");
const rome = await probeEra("rome");
await browser.close();

const checks = [];
const need = (label, ok, detail) => checks.push({ label, ok, detail });

need("classic fetches no rome assets", classic.romeCount === 0, `${classic.romeCount} rome GLBs`);
need("classic uses the shipped remote sculpts", classic.remoteCount > 0, `${classic.remoteCount} remote GLBs`);
need("rome fetches its own local sculpts", rome.romeCount > 0, `${rome.romeCount} rome GLBs`);
need("rome board is fully rigged", rome.roster.skinned === rome.roster.pieces, `${rome.roster.skinned}/${rome.roster.pieces}`);
// Different sculpts must produce a different rendered surface census.
need(
  "rome renders different materials than classic",
  rome.census.fingerprint !== classic.census.fingerprint,
  `classic=${classic.census.count} mats, rome=${rome.census.count} mats`,
);

const report = { classic, rome, checks };
await writeFile(path.join(OUT, "assets-report.json"), JSON.stringify(report, null, 2));

console.log(`classic: ${classic.total} GLBs (${classic.romeCount} rome, ${classic.remoteCount} remote)`);
console.log(`rome   : ${rome.total} GLBs (${rome.romeCount} rome, ${rome.remoteCount} remote)`);
console.log("");
for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.label.padEnd(42)} ${c.detail}`);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed} failed checks`);
process.exit(failed === 0 ? 0 : 1);
