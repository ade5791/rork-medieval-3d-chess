// Diagnose why rank-1 squares are unreachable in portrait, and whether the
// promotion picker resolves. Both are candidate CRITICAL defects.
import { chromium, devices } from 'playwright';
import { BASE, sleep, attachConsole, bootProbe, skipIntro, startMatch, settleCamera } from './s5-lib.mjs';

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-unsafe-swiftshader'] });

// ---- portrait rank-1 reachability -----------------------------------------
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const sink = [];
  attachConsole(page, sink);
  await bootProbe(page, 'quality=high');
  await skipIntro(page);
  await startMatch(page, { mode: 'hotseat' });
  await settleCamera(page);

  const geo = await page.evaluate(() => {
    const kg = window.__kg;
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const rows = {};
    for (const sq of ['a1', 'e1', 'g1', 'h1', 'e2', 'e4', 'e7', 'e8', 'a8']) {
      const p = kg.pickPointFor(sq);
      rows[sq] = { ok: p.ok, x: Math.round(p.x), y: Math.round(p.y), offset: p.offset };
    }
    return {
      rect: { l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), b: Math.round(rect.bottom) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      rows,
    };
  });
  log('PORTRAIT canvas rect', JSON.stringify(geo.rect), 'viewport', JSON.stringify(geo.viewport));
  for (const [sq, v] of Object.entries(geo.rows)) log('  ', sq, JSON.stringify(v));

  // What sits on top of the failing point (HUD overlay stealing the tap)?
  const cover = await page.evaluate(() => {
    const kg = window.__kg;
    const p = kg.pickPointFor('g1');
    const el = document.elementFromPoint(p.x, p.y);
    return {
      point: { x: Math.round(p.x), y: Math.round(p.y), ok: p.ok },
      top: el ? (el.tagName + '.' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className)).slice(0, 90)) : null,
    };
  });
  log('PORTRAIT g1 elementFromPoint', JSON.stringify(cover));
  await ctx.close();
}

// ---- promotion picker ------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const sink = [];
  attachConsole(page, sink);
  await bootProbe(page, 'quality=high');
  await skipIntro(page);
  await startMatch(page, { mode: 'hotseat' });
  // Load a promotion-ready position directly through the controller.
  const loaded = await page.evaluate(() => {
    const c = window.__kg.controller;
    if (typeof c.syncToFen === 'function') { c.syncToFen('r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1'); return 'syncToFen'; }
    return 'none';
  });
  log('PROMO fen load path:', loaded);
  await sleep(1200);
  await settleCamera(page);
  const before = await page.evaluate(() => window.__kg.controller.getSnapshot().fen);
  log('PROMO fen before', before);

  // Drive the move through the engine picker: b7 -> b8 is a promotion.
  const pts = await page.evaluate(() => ({ b7: window.__kg.pickPointFor('b7'), b8: window.__kg.pickPointFor('b8') }));
  log('PROMO points', JSON.stringify(pts));
  if (pts.b7.ok) {
    await page.mouse.move(pts.b7.x, pts.b7.y); await page.mouse.down(); await sleep(30); await page.mouse.up();
    await sleep(500);
  }
  const sel = await page.evaluate(() => window.__kg.selection());
  log('PROMO selection after b7 tap', JSON.stringify(sel));
  if (pts.b8.ok) {
    await page.mouse.move(pts.b8.x, pts.b8.y); await page.mouse.down(); await sleep(30); await page.mouse.up();
    await sleep(1500);
  }
  const state = await page.evaluate(() => {
    const g = window.__kg.__engine;
    const grp = g && g.promotionGroup;
    const meshes = [];
    if (grp) grp.traverse((n) => { if (n.isMesh) meshes.push(n.name || n.type); });
    return {
      pickerOpen: Boolean(grp),
      meshCount: meshes.length,
      bannerVisible: Boolean(Array.from(document.querySelectorAll('p')).find((p) => /CHOOSE THE NEW CHAMPION/i.test(p.textContent || ''))),
      fen: window.__kg.controller.getSnapshot().fen,
      hasResolve: Boolean(g && g.promotionResolve),
    };
  });
  log('PROMO picker state', JSON.stringify(state));

  if (state.pickerOpen) {
    // Where are the choice sculpts on screen?
    const choices = await page.evaluate(() => {
      const g = window.__kg.__engine;
      const cam = g.camera;
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const res = [];
      g.promotionGroup.children.forEach((child, i) => {
        const v = new (window.THREE ? window.THREE.Vector3 : Object)();
        const p = child.getWorldPosition(child.position.clone());
        const ndc = p.clone().project(cam);
        res.push({
          i,
          promotion: child.userData && child.userData.promotion,
          x: Math.round(r.left + ((ndc.x + 1) / 2) * r.width),
          y: Math.round(r.top + ((1 - ndc.y) / 2) * r.height),
          onScreen: ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1,
        });
      });
      return res;
    }).catch((e) => ({ error: String(e).slice(0, 200) }));
    log('PROMO choice screen points', JSON.stringify(choices));

    if (Array.isArray(choices) && choices[0] && choices[0].onScreen) {
      await page.mouse.move(choices[0].x, choices[0].y);
      await page.mouse.down(); await sleep(30); await page.mouse.up();
      await sleep(1600);
      const after = await page.evaluate(() => ({
        fen: window.__kg.controller.getSnapshot().fen,
        stillOpen: Boolean(window.__kg.__engine.promotionGroup),
      }));
      log('PROMO after choosing queen', JSON.stringify(after));
    }
  }
  log('PROMO console errors', JSON.stringify(sink.filter((e) => e.type === 'error' || e.type === 'pageerror').slice(0, 5)));
  await ctx.close();
}

await browser.close();
console.log('\n===== DIAG COMPLETE =====');
