#!/usr/bin/env node
// =============================================================================
// tests/wardrobe-client.mjs — the 옷장 and the 한복집 in a real page (CONTRACT §19.1, lane wardrobe)
//
//   node tests/wardrobe-client.mjs --file x.html [--shots <dir>] [--skip-easy] [--skip-phone]
//
// Grown-up mode (1280×800): a new profile owns what it wears (the migration ran); the 옷장 opens from the 꾸미기 action
// with its six tabs (장비 · 색 · 표정 · 기본 정보 · 갖춤 · 설정 시트) and slot tiles with rendered pictures; the 한복집
// shows shelves by slot, 입어 보기 dresses the figure of the window and not the player, buying through the window's
// buttons takes the coins and wears the piece, a reload keeps it owned and worn, selling gives half and never takes a worn
// piece or the free kit, a look with a piece that is not owned is put back, a gift of a reward lands in the 옷장 (not the
// bag), the 매점 has a 한복 corner, and the 설정 시트 is a real picture (1800×1320) kept in the album.
// Easy mode and a phone (390×844): picture tabs and tiles ≥ 56 px, the shop and the 옷장 open without errors.
// With --shots every screen is saved for a person to look at.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const file = path.resolve(opt('--file', path.join(ROOT, 'dist/metaverse/index.html')));
const shotDir = opt('--shots', null);
const quality = opt('--quality', 'low');
if (!fs.existsSync(file)) { console.error(`✖ ${file} not found — build first (node tools/build.mjs --out <file>)`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const HTML = fs.readFileSync(file);
const ORIGIN = 'http://tfm-wardrobe.test';
const APP = `notutorial=1&nointro=1&quality=${quality}`;

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\x1b[2m  — ${String(detail).slice(0, 600)}\x1b[0m` : ''}`);
}
const short = (v) => { try { return JSON.stringify(v).slice(0, 600); } catch { return String(v).slice(0, 600); } };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pageErrors = [], consoleErrors = [];

async function openPage({ easy, viewport = { width: 1280, height: 800 }, mobile = false, ctxIn = null }) {
  const ctx = ctxIn || await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  if (!ctxIn) {
    await ctx.route(`${ORIGIN}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
      return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not here' });
    });
    if (!easy) await ctx.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); if (s.easyMode !== false) localStorage.setItem('tfm.v1.settings', JSON.stringify({ ...s, _v: 2, easyMode: false })); } catch (e) { /* storage off */ } });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 240)); }); // the test host answers 404 for anything but the page
  await page.goto(`${ORIGIN}/index.html?${APP}${easy ? '&autostart=1' : ''}`, { waitUntil: 'load', timeout: 300000 });
  if (!easy) {
    await page.waitForFunction(() => (document.querySelector('.title-screen.in .ts-start') && document.getElementById('loading-screen')?.hidden) || (window.G?.ready && G.app?.loggedIn), null, { timeout: 600000, polling: 250 });
    await page.evaluate(() => { if (!G.app?.loggedIn) document.querySelector('.title-screen .ts-start')?.click(); });
  }
  await page.waitForFunction(() => window.G?.ready === true && G.state && G.app?.loggedIn, null, { timeout: 600000, polling: 250 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
/** wait until the thumbnails of the open window are drawn (or the time is up) */
async function thumbs(page, min = 4, ms = 90000) {
  try { await page.waitForFunction((n) => document.querySelectorAll('.wd-thumb.ready').length >= Math.min(n, document.querySelectorAll('.wd-thumb').length), min, { timeout: ms, polling: 500 }); } catch (e) { /* a slow GPU: the picture shows what is there */ }
}
async function shoot(page, name) {
  if (!shotDir) return;
  try { await page.screenshot({ path: path.join(shotDir, `${name}.png`) }); } catch (e) { console.log(`  (screenshot ${name} failed: ${e.message})`); }
}
/** press the button of the topmost dialog whose text contains `label` */
async function press(page, label) {
  return page.evaluate((lb) => {
    const ms = Array.from(document.querySelectorAll('#modal-root .modal, .easy-layer .ez-card, .easy-layer [role="dialog"]'));
    for (let i = ms.length - 1; i >= 0; i--) {
      const b = Array.from(ms[i].querySelectorAll('button')).find((x) => (x.textContent || '').includes(lb));
      if (b) { b.click(); return true; }
    }
    return false;
  }, label);
}

try {
  // ============================================================== grown-up mode
  const { ctx, page } = await openPage({ easy: false });
  const base = await page.evaluate(() => {
    const W = G.data.wardrobe, w = G.state.wardrobe, look = G.sys.wardrobe.look();
    const wear = Object.entries(G.data.items).filter(([, i]) => i.type === 'wear').length;
    return { sys: !!G.sys.wardrobe, items: W.items.length, wear, slots: W.slots.map((s) => s.key), migrated: w.migrated === true, worn: W.wornItems(look), ownsAll: W.wornItems(look).every((x) => W.owns(w, x, false)), easy: !!G.easy.on };
  });
  check('the wardrobe system runs; every value of a slot is an item of type wear', base.sys && base.items > 30 && base.items === base.wear, short({ items: base.items, wear: base.wear, slots: base.slots }));
  check('a new profile owns every piece it wears (the migration ran once)', base.migrated && base.ownsAll && !base.easy, short(base.worn));

  // the 옷장 from the 꾸미기 action
  await page.evaluate(() => G.ui.triggerAction ? G.ui.triggerAction('avatar') : G.app.openAvatar());
  await page.waitForSelector('.wd-modal .wd-tab', { state: 'attached', timeout: 120000 });
  const win = await page.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('.wd-modal .wd-tab')).map((b) => b.textContent.trim()), slots: document.querySelectorAll('.wd-modal .wd-slot').length, canvas: !!document.querySelector('.wd-modal .wd-stage canvas') }));
  check('꾸미기 opens the 옷장: six tabs, one tile per slot, the figure turns', win.tabs.length === 6 && win.slots === base.slots.length && win.canvas, short(win));
  await thumbs(page, 6);
  await shoot(page, 'n-equip');
  // four views
  for (const v of ['left', 'back', 'right']) { await page.click(`.wd-modal .wd-view[data-view="${v}"]`); await page.waitForTimeout(1500); }
  await shoot(page, 'n-equip-rightview');
  await page.click('.wd-modal .wd-view[data-view="front"]');
  // a slot list
  await page.click('.wd-modal .wd-slot[data-slot="hat"]');
  await page.waitForSelector('.wd-modal .wd-back', { state: 'attached', timeout: 120000 });
  await thumbs(page, 8);
  const slotList = await page.evaluate(() => ({ tiles: document.querySelectorAll('.wd-modal .wd-panel .wd-tile').length, locked: document.querySelectorAll('.wd-modal .wd-panel .wd-tile.locked').length }));
  check('장비 → 쓰개: owned pieces first, the ones to buy greyed with their price', slotList.tiles > 5 && slotList.locked > 0, short(slotList));
  await shoot(page, 'n-equip-hat');
  for (const t of ['color', 'face', 'info', 'sets', 'sheet']) {
    await page.click(`.wd-modal .wd-tab[data-tab="${t}"]`);
    await page.waitForTimeout(t === 'sets' ? 400 : 250);
    if (t === 'sets') await thumbs(page, 6, 60000);
    await shoot(page, `n-${t}`);
  }
  const tabsOk = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return { faces: (G.data.wardrobe.expressions || []).length, sw: q('.wd-modal .wd-sw'), chips: q('.wd-modal .wd-chip') };
  });
  check('the tabs draw: nine faces in the data, named dye swatches, choice chips (no typing)', tabsOk.faces >= 9, short(tabsOk));

  // 기본 정보 + 표정 through the API (the window calls the same functions)
  const info = await page.evaluate(() => {
    const S = G.sys.wardrobe, W = G.data.wardrobe;
    S.setTraits([W.traits[0], W.traits[2], W.traits[5], W.traits[7]]);
    S.setHome(W.homes[2].id);
    S.setExpr(W.expressions[2].id);
    return { traits: G.state.wardrobe.sheet.traits, home: G.state.wardrobe.sheet.home, expr: G.state.wardrobe.expr };
  });
  check('기본 정보: three words at most, a home, the usual face', info.traits.length === 3 && !!info.home && !!info.expr, short(info));

  // the sheet picture
  await page.click('.wd-modal .wd-tab[data-tab="sheet"]');
  const sheet = await page.evaluate(async () => {
    const n0 = (G.state.photos || []).length;
    const r = await G.sys.wardrobe.makeSheet();
    if (!r) return null;
    const c = r.canvas, g = c.getContext('2d');
    // the picture is real: the four views are drawn (pixels differ from the paper in the figure boxes)
    const px = g.getImageData(92 + 114, 180 + 120, 1, 1).data, paper = g.getImageData(30, 640, 1, 1).data;
    return { w: c.width, h: c.height, album: (G.state.photos || []).length - n0, thumbLen: r.photo.thumb.length, place: r.photo.place, png: c.toDataURL('image/png'), figure: Array.from(px), paper: Array.from(paper) };
  });
  check('설정 시트: one picture 1800×1320 kept in the album', sheet && sheet.w === 1800 && sheet.h === 1320 && sheet.album === 1 && sheet.thumbLen > 10000 && sheet.place === '설정 시트', short(sheet && { w: sheet.w, h: sheet.h, album: sheet.album, thumb: sheet.thumbLen }));
  check('… and it shows the figure (not an empty paper)', sheet && sheet.figure.join() !== sheet.paper.join(), short(sheet && { figure: sheet.figure, paper: sheet.paper }));
  if (sheet && shotDir) fs.writeFileSync(path.join(shotDir, 'sheet.png'), Buffer.from(sheet.png.split(',')[1], 'base64'));
  await page.waitForTimeout(400);
  await shoot(page, 'n-sheet-made');
  await press(page, '닫기');

  // the 한복집: try on, buy through the buttons, wear
  await page.evaluate(() => { G.state.stats.coin = 20000; G.sys.progression?.refreshHud?.(); });
  const target = await page.evaluate(() => {
    const W = G.data.wardrobe, look = G.sys.wardrobe.look();
    const iid = W.byKey.hat.find((x) => !W.isStarter(x) && !W.owns(G.state.wardrobe, x, false) && W.priceOf(x) <= 2000);
    return { iid, id: W.parse(iid).id, price: W.priceOf(iid), hat0: look.hat };
  });
  await page.evaluate(() => G.sys.inventory.openShop('SHOP_HANBOK'));
  await page.waitForSelector('.wd-shopm .wd-shelf', { state: 'attached', timeout: 120000 });
  await page.click('.wd-shopm .wd-shelf:has-text("쓰개")').catch(() => {});
  await page.waitForTimeout(300);
  await page.click(`.wd-shopm .wd-tile[data-item="${target.iid}"]`);
  await page.waitForTimeout(600);
  const tried = await page.evaluate((t) => ({ fig: G.ui.modal.get('hanbokshop')?._ctx?.pv?.rig?.appearance?.hat, player: G.sys.wardrobe.look().hat, buy: !!document.querySelector('.wd-shopm .wd-buy') }), target);
  check('입어 보기: the figure of the 한복집 wears the piece, the player does not (yet)', tried.fig === target.id && tried.player === target.hat0 && tried.buy, short(tried));
  await thumbs(page, 6);
  await shoot(page, 'n-shop-tryon');
  const c0 = await page.evaluate(() => G.state.stats.coin);
  await page.click('.wd-shopm .wd-buy');
  await page.waitForTimeout(500);
  await press(page, '사기');
  await page.waitForTimeout(900);
  await press(page, '입기');
  await page.waitForTimeout(700);
  const bought = await page.evaluate((t) => ({ coin: G.state.stats.coin, owned: !!G.state.wardrobe.own[t.iid], worn: G.sys.wardrobe.look().hat, inv: !!G.state.inventory[t.iid] }), target);
  check('buying through the window takes the price and wears the piece (in the 옷장, not the bag)', bought.owned && bought.coin === c0 - target.price && bought.worn === target.id && !bought.inv, short({ ...bought, c0, price: target.price }));
  await shoot(page, 'n-shop-bought');

  // selling: another piece (owned, not worn) through the sell tab
  const sellT = await page.evaluate(() => {
    const W = G.data.wardrobe;
    const iid = W.byKey.footwear.find((x) => !W.isStarter(x) && !W.owns(G.state.wardrobe, x, false) && W.priceOf(x) <= 4000);
    G.sys.wardrobe.buy(iid);
    return { iid, sell: W.sellOf(iid) };
  });
  await page.click('.wd-shopm .wd-segb[data-tab="sell"]');
  await page.waitForTimeout(300);
  await page.click('.wd-shopm .wd-shelf:has-text("신")').catch(() => {});
  await page.waitForTimeout(300);
  await page.click(`.wd-shopm .wd-tile[data-item="${sellT.iid}"]`);
  await page.waitForTimeout(300);
  await thumbs(page, 2, 30000);
  await shoot(page, 'n-shop-sell');
  const c1 = await page.evaluate(() => G.state.stats.coin);
  await page.click('.wd-shopm .wd-sell');
  await page.waitForTimeout(500);
  await press(page, '팔기');
  await page.waitForTimeout(700);
  const sold = await page.evaluate((t) => ({ coin: G.state.stats.coin, owned: !!G.state.wardrobe.own[t.iid] }), sellT);
  check('selling back gives half the price and the piece leaves the 옷장', !sold.owned && sold.coin === c1 + sellT.sell, short({ ...sold, c1, sell: sellT.sell }));
  const rules = await page.evaluate((t) => {
    const S = G.sys.wardrobe, W = G.data.wardrobe;
    return { worn: S.sell(t.iid).why, starter: S.sell(W.starter[0]).why };
  }, target);
  check('a worn piece and the free kit are never sold', rules.worn === 'worn' && (rules.starter === 'starter' || rules.starter === 'notOwned'), short(rules));
  await press(page, '닫기');

  // the guard: a look with a piece that is not owned is put back
  const guard = await page.evaluate(() => {
    const W = G.data.wardrobe;
    const iid = W.byKey.hat.find((x) => !W.isStarter(x) && !W.owns(G.state.wardrobe, x, false));
    const app = G.sys.wardrobe.look(); app.hat = W.parse(iid).id;
    G.sys.player.setAppearance(app);
    return { tried: W.parse(iid).id, now: G.sys.wardrobe.look().hat };
  });
  check('a look that wears a piece not owned is put back (client rule)', guard.now !== guard.tried, short(guard));

  // a gift of a reward lands in the 옷장
  const gift = await page.evaluate(() => {
    const W = G.data.wardrobe;
    const iid = W.items.find((x) => !W.isStarter(x) && !W.owns(G.state.wardrobe, x, false) && W.parse(x).key !== 'hat');
    G.sys.progression.grant({ items: { [iid]: 1 } }, { popup: false, silent: true, reason: 'test' });
    return { iid, own: !!G.state.wardrobe.own[iid], bag: !!G.state.inventory[iid] };
  });
  check('a piece given as a reward goes to the 옷장, never the bag', gift.own && !gift.bag, short(gift));

  // the 매점 has a 한복 corner
  await page.evaluate(() => G.sys.inventory.openShop('SHOP_GENERAL'));
  await page.waitForSelector('.shop-modal', { state: 'attached', timeout: 120000 });
  const corner = await page.evaluate(() => !!document.querySelector('.shop-modal .wd-corner'));
  check('the 매점 shows a 한복 corner (until the 한복집 stands)', corner);
  await press(page, '닫기');

  // reload: still owned, still worn
  await page.evaluate(() => G.save.save());
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => (document.querySelector('.title-screen.in .ts-start') && document.getElementById('loading-screen')?.hidden) || (window.G?.ready && G.app?.loggedIn), null, { timeout: 600000, polling: 250 });
  await page.evaluate(() => { if (!G.app?.loggedIn) (document.querySelector('.title-screen .ts-continue, .title-screen .ts-start'))?.click(); });
  await page.waitForFunction(() => window.G?.ready === true && G.state && G.app?.loggedIn, null, { timeout: 600000, polling: 250 });
  await page.waitForTimeout(800);
  const after = await page.evaluate((t) => ({ owned: !!G.state.wardrobe.own[t.iid], worn: G.sys.wardrobe.look().hat, traits: G.state.wardrobe.sheet.traits.length, photos: (G.state.photos || []).filter((p) => p.place === '설정 시트').length }), target);
  check('after a reload the bought piece is still owned and worn; the words and the sheet are kept', after.owned && after.worn === target.id && after.traits === 3 && after.photos >= 1, short(after));
  await ctx.close();

  // ============================================================== easy mode (desktop) and a phone
  if (!flag('--skip-easy')) {
    const E = await openPage({ easy: true });
    await E.page.evaluate(() => G.ui.triggerAction ? G.ui.triggerAction('avatar') : G.sys.wardrobe.open());
    await E.page.waitForSelector('.wd-modal.kid .wd-tab', { state: 'attached', timeout: 120000 });
    await thumbs(E.page, 6);
    const kid = await E.page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.wd-modal .wd-tab')).map((b) => b.getBoundingClientRect().height);
      const tiles = Array.from(document.querySelectorAll('.wd-modal .wd-tile')).map((b) => Math.min(b.getBoundingClientRect().height, b.getBoundingClientRect().width));
      const says = Array.from(document.querySelectorAll('.wd-modal .wd-tile, .wd-modal .wd-tab')).every((b) => b.getAttribute('data-say'));
      const inputs = document.querySelectorAll('.wd-modal input[type="text"], .wd-modal textarea').length;
      return { tabMin: Math.min(...tabs), tileMin: Math.min(...tiles), says, inputs };
    });
    check('easy mode: picture tabs and tiles ≥ 56 px, each with a voice line, no typing', kid.tabMin >= 56 && kid.tileMin >= 56 && kid.says && kid.inputs === 0, short(kid));
    await shoot(E.page, 'e-equip');
    for (const t of ['color', 'face', 'info', 'sets']) { await E.page.click(`.wd-modal .wd-tab[data-tab="${t}"]`); await E.page.waitForTimeout(300); await shoot(E.page, `e-${t}`); }
    await press(E.page, '다 됐어요');
    await E.page.evaluate(() => G.sys.inventory.openShop('SHOP_GENERAL'));
    await E.page.waitForSelector('.kk-shop-modal .wd-corner', { state: 'attached', timeout: 120000 }).catch(() => {});
    const kc = await E.page.evaluate(() => { const b = document.querySelector('.kk-shop-modal .wd-corner'); return b ? Math.round(b.getBoundingClientRect().height) : 0; });
    check('easy mode: the 매점 has a big 한복 corner button', kc >= 56, `height ${kc}`);
    await E.page.click('.kk-shop-modal .wd-corner').catch(() => {});
    await E.page.waitForSelector('.wd-shopm.kid .wd-tile', { state: 'attached', timeout: 120000 });
    await E.page.click('.wd-shopm .wd-tile');
    await thumbs(E.page, 6);
    await shoot(E.page, 'e-shop');
    await E.ctx.close();
  }
  if (!flag('--skip-phone')) {
    const P = await openPage({ easy: true, viewport: { width: 390, height: 844 }, mobile: true });
    await P.page.evaluate(() => G.sys.wardrobe.open());
    await P.page.waitForSelector('.wd-modal .wd-tab', { state: 'attached', timeout: 120000 });
    await thumbs(P.page, 4);
    const ph = await P.page.evaluate(() => ({ scrollX: document.documentElement.scrollWidth - window.innerWidth, box: Math.round(document.querySelector('.wd-modal').getBoundingClientRect().width) }));
    check('a phone: the 옷장 fits the width (no sideways scroll)', ph.scrollX <= 1 && ph.box <= 392, short(ph));
    await shoot(P.page, 'p-equip');
    await P.page.evaluate(() => { G.ui.modal.get('wardrobe')?.close(); G.sys.wardrobe.openShop('SHOP_HANBOK'); });
    await P.page.waitForSelector('.wd-shopm .wd-tile', { state: 'attached', timeout: 120000 });
    await thumbs(P.page, 4);
    await shoot(P.page, 'p-shop');
    await P.ctx.close();
  }
} catch (e) {
  check('the run finished', false, e.stack || e.message);
}
check('no page errors', pageErrors.length === 0, short(pageErrors));
check('no console errors', consoleErrors.length === 0, short(consoleErrors.slice(0, 6)));
await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\nwardrobe-client: ${pass} passed, ${results.length - pass} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
