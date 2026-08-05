// Is the reported main-menu overlap REAL (two controls genuinely hittable in the
// same pixels) or an artefact of rect math that ignores scroll-container
// clipping? The authoritative test is hit-testing: elementFromPoint at a
// control's centre must resolve to that control.
import { chromium } from "playwright";

const BASE = process.env.DIAG_BASE || "https://ade5791.github.io/kings-gambit-medieval-chess";

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 852, height: 393 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?probe=1`, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 40; i += 1) {
    const up = await page.getByRole("button", { name: /Take the field/i }).first().isVisible().catch(() => false);
    if (up) break;
    await page.locator("text=CLICK TO SKIP").first().click({ timeout: 1200 }).catch(() => {});
    await page.mouse.click(426, 330).catch(() => {});
    await page.waitForTimeout(900);
  }

  const out = await page.evaluate(async () => {
    const anims = document.getAnimations ? document.getAnimations() : [];
    const finite = anims.filter((a) => {
      try {
        const e = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        return e ? Number.isFinite(e.iterations) && Number.isFinite(e.endTime) : false;
      } catch (err) { return false; }
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const names = ["easy", "medium", "hard", "Ivory", "Obsidian", "Take the field", "Settings"];
    const res = [];
    for (const nm of names) {
      const el = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim().toLowerCase() === nm.toLowerCase(),
      );
      if (!el) { res.push({ name: nm, found: false }); continue; }
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const selfHit = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      // Is it clipped by an ancestor scroll container?
      let clipped = false;
      let p = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(s.overflowY) || /(auto|scroll|hidden)/.test(s.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (r.bottom > pr.bottom + 0.5 || r.top < pr.top - 0.5) clipped = true;
        }
        p = p.parentElement;
      }
      res.push({
        name: nm,
        found: true,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        hitTestResolvesToSelf: selfHit,
        hitActual: hit ? hit.tagName.toLowerCase() + "." + String(hit.className || "").slice(0, 40) : null,
        clippedByScrollAncestor: clipped,
      });
    }
    return res;
  });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
};

run().catch((e) => { console.error("DIAG FAILED", e); process.exit(1); });
