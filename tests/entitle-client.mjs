#!/usr/bin/env node
// =============================================================================
// tests/entitle-client.mjs — the entitlement in the page (71-entitle.js, 07-speed.js, 72-subscription.js; CONTRACT §17.2)
//
//   node tests/entitle-client.mjs [--file dist/metaverse/index.html]
//
// The built single file is served at a scripted origin (Playwright routes, no PHP): every api/ answer is 404, so the
// page starts in local mode. The checks then put the page into server mode with a scripted G.net.request (the same
// seam tests/sub-return-client.mjs uses) and look at what the page does with the server's `ent` and `site`:
//   local mode = the free values · the tap on API answers survives a swapped G.net.request and a "restore" · `site`
//   is cleaned and announced · a free account · the mock 토스 purchase of tier 2 (ent at once: speed chip, 12 jars) ·
//   expiry (speed back, jars 4–12 locked with their contents kept) · a refusal that still carries `ent` · garbage and
//   forged `ent` objects · an ADMINISTRATOR (everything free, the plan screen without payment buttons, the 🛠️ chip
//   and menu tile that open ent.adminUrl in a new tab, the default-password reminder once per session) · nobody else
//   sees an admin button · the password form of a server account · 쉬운 모드: no chip, no tile on kid screens, the way
//   in only behind the parent gate.
// Prints PASS/FAIL per check, exit code 1 on any failure. Run it through the shared browser lock when other browser
// suites may be running.
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
const file = path.resolve(opt('--file', path.join(ROOT, 'dist/metaverse/index.html')));
const shotDir = opt('--shots', null);
if (!fs.existsSync(file)) { console.error(`✖ ${file} not found — build first (node tools/build.mjs --out <file>)`); process.exit(2); }
const HTML = fs.readFileSync(file);
const ORIGIN = 'http://tfm-entitle.test';
const APP = 'notutorial=1&nointro=1&quality=low';
const T_UI = 20000;

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail && !ok ? `\x1b[2m  — ${detail}\x1b[0m` : ''}`);
}
const short = (v) => { try { return JSON.stringify(v).slice(0, 700); } catch { return String(v).slice(0, 700); } };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pageErrors = [];

async function openPage({ easy }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not here' });
  });
  if (!easy) await ctx.addInitScript(() => { try { localStorage.setItem('tfm.v1.settings', JSON.stringify({ _v: 2, easyMode: false })); } catch (e) { /* storage off */ } });
  await ctx.addInitScript(() => {
    window.__toasts = [];
    window.__opened = [];
    window.open = (url, target, features) => { window.__opened.push({ url: String(url), target: String(target || ''), features: String(features || '') }); return null; };
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__toasts.push((n.querySelector('.t-msg') || n).textContent || '');
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 240)));
  // easy mode: an autostart guest (a new profile is an easy-mode profile). Grown-up mode: this device is set to normal
  // mode and a guest enters through the title's start button, the way tools/smoke.mjs --mode normal does.
  await page.goto(`${ORIGIN}/index.html?${APP}${easy ? '&autostart=1' : ''}`, { waitUntil: 'load', timeout: 300000 });
  if (!easy) {
    await page.waitForFunction(() => document.querySelector('.title-screen.in .ts-start') && document.getElementById('loading-screen')?.hidden, null, { timeout: 600000, polling: 250 });
    await page.evaluate(() => document.querySelector('.title-screen .ts-start').click());
  }
  await page.waitForFunction(() => window.G?.ready === true && G.state && G.app?.loggedIn, null, { timeout: 600000, polling: 250 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

/** the scripted server: window.__srv holds what it "knows"; G.net.request answers from it */
const installServer = (page) => page.evaluate(() => {
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const ent = (o = {}) => ({
    v: 1, role: 'user', admin: false, tier: 1, paid: false, until: 0, speed: { move: 1, grow: 1 }, limits: { jars: 3, roomItems: 80 }, features: { myroom: false }, ...o,
  });
  window.__ent = ent;
  window.__srv = {
    user: { id: 77, email: 'kim@example.com', nickname: '김체험', role: 'user' },
    sub: { tier: 1, status: 'none', expiresAt: 0, autoRenew: false },
    ent: ent(),
    site: { 'sub.tiers_on': [2, 3], 'limits.jars_free': 3, 'limits.jars_paid': 12, 'limits.room_items_free': 80, 'limits.room_items_paid': 160, 'controls.mouse_look_normal': 'lock', 'security.notice': '' },
    siteV: 'aaaaaaaaaaaa',
    tiers: [{ tier: 2, name: '⚡ 2배', price: 2900, move: 2, grow: 2 }, { tier: 3, name: '⚡⚡ 3배', price: 4900, move: 3, grow: 3 }],
    password: 'Old2026pass',
    calls: [], fail: {},
  };
  window.__events = [];
  G.bus.on('entitle:changed', (p) => window.__events.push({ ev: 'entitle', tier: p.ent.tier, prev: p.prev ? p.prev.tier : null, jars: p.ent.limits.jars, admin: p.ent.admin }));
  G.bus.on('site:changed', (p) => window.__events.push({ ev: 'site', keys: p.keys }));
  G.bus.on('speed:changed', (p) => window.__events.push({ ev: 'speed', tier: p.tier, prev: p.prev }));
  window.__fake = async (p, opts = {}) => {
    const S = window.__srv;
    const pathOnly = String(p).replace(/^\//, '').split('?')[0];
    S.calls.push({ path: pathOnly, body: opts.body ? copy(opts.body) : null });
    const f = S.fail[pathOnly];
    if (f) { if (!f.keep) delete S.fail[pathOnly]; throw new G.net.ApiError(f.code, f.message || '', f.status || 400, f.data ? copy(f.data) : undefined); }
    switch (pathOnly) {
      case 'auth/me.php': return copy({ user: S.user, sub: S.sub, ent: S.ent, site: S.site, siteV: S.siteV, features: { sync: 0, queue: 0 } });
      case 'sub/status.php': return copy({ sub: S.sub, tiers: S.tiers, mode: 'mock', periodDays: 30, graceDays: 3, ent: S.ent, site: S.statusSite || undefined });
      case 'sub/prepare.php': {
        const t = S.tiers.find((x) => x.tier === Number(opts.body?.tier));
        if (!t) throw new G.net.ApiError('INVALID_TIER', '지금은 팔지 않는 단계예요.', 400);
        return { orderId: `ord_${t.tier}_${S.calls.length}`, amount: t.price, tier: t.tier, kind: opts.body.kind, mock: true, orderName: `진행 속도 ${t.tier}배`, customerKey: 'cus_77' };
      }
      case 'sub/confirm.php': {
        const tier = Number(/^ord_(\d)_/.exec(String(opts.body?.orderId || ''))?.[1]) || 2;
        const until = Date.now() + 30 * 86400000;
        S.sub = { tier, status: 'active', expiresAt: until, autoRenew: false };
        S.ent = ent({ tier, paid: true, until, speed: { move: Math.min(tier, 3), grow: tier }, limits: { jars: 12, roomItems: 160 } });
        return copy({ sub: S.sub, ent: S.ent });
      }
      case 'player/save.php': return copy({ savedAt: Date.now(), revision: 2, size: 10, sub: S.sub, subChanged: false, ent: S.ent, siteV: S.siteV });
      case 'auth/password.php': {
        const b = opts.body || {};
        if (b.current !== S.password) throw new G.net.ApiError('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401);
        if (!/[a-zA-Z]/.test(b.password) || !/\d/.test(b.password)) throw new G.net.ApiError('WEAK_PASSWORD', '영문과 숫자를 모두 넣어 주세요.', 400);
        S.password = b.password;
        S.ent = { ...S.ent };
        delete S.ent.pwDefault;
        return copy({ changed: true, ent: S.ent });
      }
      default: throw new G.net.ApiError('NOT_FOUND', 'not faked', 404);
    }
  };
  return true;
});
/** server mode with the scripted server (what a logged-in server account looks like to the page) */
const goServer = (page) => page.evaluate(async () => {
  G.net.mode = 'server';
  G.auth.current = { ...(G.auth.current || {}), kind: 'server', role: window.__srv.user.role, email: window.__srv.user.email };
  G.save.save = async () => false; // the local profile underneath must not look like a working server save
  G.net.request = window.__fake;
  await G.sys.entitle.refresh();
  return G.sys.entitle.get();
});
const snap = (page) => page.evaluate(() => {
  const E = G.sys.entitle, sp = G.sys.speed, chip = document.getElementById('hud-speed'), adm = document.getElementById('hud-admin');
  const J = G.sys.fermentation;
  return {
    ent: E.get(), tier: E.tier(), jars: E.limit('jars'), room: E.limit('roomItems'), admin: E.isAdmin(), myroom: E.has('myroom'),
    spTier: sp.tier, move: sp.movement(), grow: sp.progression(),
    chip: chip ? { hidden: chip.hidden, text: chip.textContent } : null,
    adm: adm ? { hidden: adm.hidden, shown: getComputedStyle(adm).display !== 'none' && !adm.hidden, warn: adm.classList.contains('is-warn'), text: adm.textContent } : null,
    jarLimit: typeof J?.jarLimit === 'function' ? J.jarLimit() : null,
  };
});
// A real pointer click first; on a machine where software WebGL starves the page a frame can take longer than the
// click's stability wait, so after one long try the same element gets the DOM click (the same handler runs).
const tap = async (page, sel) => {
  await page.waitForTimeout(480);
  const el = page.locator(sel).first();
  try { await el.click({ timeout: 45000 }); } catch (e) { await el.evaluate((n) => n.click(), null, { timeout: T_UI }); }
};
const solveGate = async (page) => {
  for (let round = 0; round < 6; round++) {
    const q = await page.waitForSelector('.easy-gate-q[aria-label]', { timeout: T_UI }).catch(() => null);
    if (!q) return false;
    const m = /(\d+)\s*곱하기\s*(\d+)/.exec((await q.getAttribute('aria-label')) || '');
    if (!m) return false;
    const ans = String(Number(m[1]) * Number(m[2]));
    await page.waitForFunction((v) => { const b = document.querySelector(`.easy-gate-choice[data-v="${v}"]`); return !!b && !b.disabled; }, ans, { timeout: T_UI, polling: 100 });
    const label = (await q.getAttribute('aria-label')) || '';
    await page.locator(`.easy-gate-choice[data-v="${ans}"]`).first().click({ timeout: 45000 });
    // on a starved page the gate can take seconds to close: wait until it is gone or shows the next question
    await page.waitForFunction((l) => { if (!G.ui.modal.get('easy-gate')) return true; const n = document.querySelector('.easy-gate-q[aria-label]'); return !!n && n.getAttribute('aria-label') !== l; }, label, { timeout: T_UI, polling: 100 }).catch(() => null);
    if (!(await page.evaluate(() => !!G.ui.modal.get('easy-gate')))) return true;
  }
  return false;
};
// Evidence pictures only: a WebGL frame on a loaded machine can take minutes, so a picture gets a long timeout and two
// tries, and a picture that still fails is reported as a note — it never stops the checks that follow.
const shot = async (page, name) => {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { await page.screenshot({ path: path.join(shotDir, name), timeout: 120000, animations: 'disabled' }); return; } catch (e) {
      if (i === 1) console.log(`note  picture ${name} not taken (${String(e.message || e).split('\n')[0]})`);
    }
  }
};
const ADMIN_ENT = { role: 'admin', admin: true, tier: 3, paid: false, until: 0, speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 }, features: { myroom: true }, adminUrl: 'admin-1a2b3c4d5e/' };

try {
  // ================================================================= grown-up (normal) mode
  const { ctx, page } = await openPage({ easy: false });
  try {
    // ---- 1 · local mode
    const mode0 = await page.evaluate(() => ({ easy: G.easy?.on, body: document.body.classList.contains('easy'), net: G.net.mode }));
    check('the grown-up page is in normal mode (쉬운 모드 off) and in local mode', mode0.easy === false && mode0.body === false && mode0.net === 'local', short(mode0));
    const local = await snap(page);
    check('local mode: the free values — tier 1, moves and grows × 1, 3 jars, 80 room items, no administrator, no room feature',
      local.tier === 1 && local.move === 1 && local.grow === 1 && local.jars === 3 && local.room === 80 && local.admin === false && local.myroom === false && local.spTier === 1, short(local));
    check('local mode: no speed chip and no administrator chip on the HUD', local.chip?.hidden === true && local.adm && local.adm.shown === false, short([local.chip, local.adm]));
    const siteLocal = await page.evaluate(() => [G.site.get('limits.jars_free', 3), G.site.get('no.such_key', 'fallback'), Object.keys(G.site.all()).length, typeof G.site.stamp()]);
    check('local mode: G.site.get() answers with the fallback (the server said nothing)', siteLocal[0] === 3 && siteLocal[1] === 'fallback' && siteLocal[2] === 0 && siteLocal[3] === 'string', short(siteLocal));
    const previewLocal = await page.evaluate(() => { const before = G.sys.entitle.tier(); const after = G.sys.entitle.preview({ tier: 4, admin: true, limits: { jars: 12 } }); const r = [before, after.tier, after.admin, G.sys.entitle.limit('jars')]; G.sys.entitle.preview(null); return r; });
    check('the developer preview is refused without ?debug=1 and with the developer centre closed', short(previewLocal) === short([1, 1, false, 3]), short(previewLocal));

    // ---- 2 · the tap
    await installServer(page);
    const tapInfo = await page.evaluate(async () => {
      const real = G.net.request;                      // what callers see (the tap)
      G.net.request = window.__fake;
      const same = G.net.request === real;             // a swap replaces what the tap calls, not the tap
      G.net.mode = 'server';
      G.auth.current = { ...(G.auth.current || {}), kind: 'server' };
      G.save.save = async () => false;
      window.__srv.ent = window.__ent({ tier: 3, paid: true, speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } });
      await G.net.request('auth/me.php');
      const viaFake = G.sys.entitle.tier();
      G.net.request = real;                            // the usual "restore": the real function is back
      let code = '';
      try { await G.net.request('auth/me.php', { quiet: true, timeout: 4000 }); } catch (e) { code = String(e.code); }
      window.__srv.ent = window.__ent();
      G.net.request = window.__fake;
      await G.net.request('auth/me.php');
      return { same, viaFake, restored: code, back: G.sys.entitle.tier(), calls: window.__srv.calls.length };
    });
    check('the tap on API answers survives a swapped G.net.request (a faked answer\'s `ent` is applied) and assigning the old function back restores the real one',
      tapInfo.same === true && tapInfo.viaFake === 3 && /^HTTP_404$|NETWORK_ERROR/.test(tapInfo.restored) && tapInfo.back === 1 && tapInfo.calls === 2, short(tapInfo));

    // ---- 3 · a free server account + site
    await page.evaluate(() => { window.__events.length = 0; window.__srv.calls.length = 0; });
    await goServer(page);
    const free = await snap(page);
    const siteSrv = await page.evaluate(() => ({ jarsPaid: G.site.get('limits.jars_paid', 0), tiers: G.site.get('sub.tiers_on', null), stamp: G.site.stamp(), keys: Object.keys(G.site.all()).length }));
    check('a free server account: tier 1, 3 jars, no chips; `site` from auth/me.php is readable through G.site.get (limits, tiers on sale) with its stamp',
      free.tier === 1 && free.jars === 3 && free.chip.hidden && !free.adm.shown && siteSrv.jarsPaid === 12 && short(siteSrv.tiers) === '[2,3]' && siteSrv.stamp === 'aaaaaaaaaaaa' && siteSrv.keys === 7, short([free.ent, siteSrv]));
    const siteClean = await page.evaluate(async () => {
      const S = window.__srv, keep = S.site, keepV = S.siteV;
      window.__events.length = 0;
      S.site = { ...keep, 'limits.jars_free': 4, 'Bad Key': 1, '__proto__x': 2, 'a.b': { nested: true }, 'x.fn': '<img src=x onerror=1>', 'x.long': 'ㄱ'.repeat(900), 'x.list': [1, 'two', { no: 1 }, [3]] };
      S.siteV = 'bbbbbbbbbbbb';
      await G.net.request('auth/me.php');
      const r = { free: G.site.get('limits.jars_free', 0), bad: G.site.get('Bad Key', 'none'), nested: G.site.get('a.b', 'none'), text: G.site.get('x.fn', ''), long: String(G.site.get('x.long', '')).length, list: G.site.get('x.list', null),
        stamp: G.site.stamp(), ev: window.__events.filter((e) => e.ev === 'site').map((e) => e.keys.slice().sort().join(',')), jars: G.sys.entitle.limit('jars'), jarLimit: G.sys.fermentation?.jarLimit?.() ?? null };
      // a `site` field on another endpoint is not the settings
      S.statusSite = { 'limits.jars_free': 11 };
      await G.net.request('sub/status.php');
      r.otherEndpoint = G.site.get('limits.jars_free', 0);
      delete S.statusSite;
      S.site = keep; S.siteV = keepV;
      await G.net.request('auth/me.php');
      r.backTo = G.site.get('limits.jars_free', 0);
      return r;
    });
    check('`site` is cleaned (bad keys, nested objects and over-long text never reach G.site), announced once with the changed keys (site:changed), and read only from ping / me / login',
      siteClean.free === 4 && siteClean.bad === 'none' && siteClean.nested === 'none' && siteClean.long === 400 && short(siteClean.list) === '[1,"two"]' && siteClean.stamp === 'bbbbbbbbbbbb'
      && siteClean.ev.length === 1 && siteClean.ev[0] === 'limits.jars_free,x.fn,x.list,x.long' && siteClean.otherEndpoint === 4 && siteClean.backTo === 3, short(siteClean));
    check('markup inside a public setting stays text (G.site hands it out as a string; nothing ran)', siteClean.text === '<img src=x onerror=1>' && await page.evaluate(() => !document.querySelector('img[src="x"]')), siteClean.text);
    const stale = await page.evaluate(async () => {
      const S = window.__srv;
      S.calls.length = 0;
      S.site = { ...S.site, 'limits.jars_paid': 10 };
      S.siteV = 'cccccccccccc';
      await G.net.request('player/save.php', { body: {} });   // a save says: the settings have a new stamp
      const before = G.site.get('limits.jars_paid', 0);
      const t0 = performance.now();
      while (performance.now() - t0 < 26000 && G.site.get('limits.jars_paid', 0) !== 10) await new Promise((r) => setTimeout(r, 250));
      const r = { before, after: G.site.get('limits.jars_paid', 0), me: S.calls.filter((c) => c.path === 'auth/me.php').length, stamp: G.site.stamp() };
      S.site = { ...S.site, 'limits.jars_paid': 12 }; S.siteV = 'aaaaaaaaaaaa';
      await G.net.request('auth/me.php');
      return r;
    });
    check('a save answer with another `siteV` makes the page ask auth/me.php once for the new settings', stale.before === 12 && stale.after === 10 && stale.me === 1 && stale.stamp === 'cccccccccccc', short(stale));

    // ---- 4 · the mock 토스 purchase of tier 2
    await page.evaluate(() => { window.__events.length = 0; window.__srv.calls.length = 0; window.__toasts.length = 0; G.sys.subscription.open(); });
    await page.waitForSelector('.app-sub-modal .sub-tier[data-tier="2"] [data-sub="buy"]:not([disabled])', { timeout: T_UI });
    const cards = await page.evaluate(() => [...document.querySelectorAll('.app-sub-modal .sub-tier')].map((c) => ({ tier: c.dataset.tier, text: c.textContent.replace(/\s+/g, ' '), buttons: c.querySelectorAll('[data-sub="buy"]').length })));
    check('the plan screen lists the tiers on sale (2 and 3 — no tier 4) with what each really gives: move ×, grow ×, 장독 12개, 방 꾸미기 물건 160개',
      cards.length === 2 && cards[0].tier === '2' && cards[1].tier === '3' && /이동 2배/.test(cards[0].text) && /작물 자라기 2배/.test(cards[0].text) && /장독 12개까지 열려요/.test(cards[0].text) && /방 꾸미기 물건 160개/.test(cards[0].text)
      && /이동 3배/.test(cards[1].text) && cards.every((c) => c.buttons === 2) && /₩2,900/.test(cards[0].text), short(cards));
    await shot(page, 'plan-free.png');
    await tap(page, '.app-sub-modal .sub-tier[data-tier="2"] [data-sub="buy"][data-kind="card"]');
    await page.waitForFunction(() => !!G.ui.modal.get('app-sub-mock'), null, { timeout: T_UI });
    await tap(page, '.modal .btn-gold:has-text("결제하기")');
    await page.waitForFunction(() => G.sys.entitle.tier() === 2, null, { timeout: T_UI });
    await page.waitForTimeout(900);
    const paid = await snap(page);
    const paidEv = await page.evaluate(() => ({ ev: window.__events.slice(), calls: window.__srv.calls.map((c) => c.path), toasts: window.__toasts.slice() }));
    check('buying tier 2 in mock mode (prepare → 테스트 결제 → confirm): the answer\'s `ent` applies at once — tier 2, moves and grows × 2, 12 jars, 160 room items',
      paid.tier === 2 && paid.move === 2 && paid.grow === 2 && paid.jars === 12 && paid.room === 160 && paid.ent.paid === true && paid.ent.until > Date.now()
      && paidEv.calls.includes('sub/prepare.php') && paidEv.calls.includes('sub/confirm.php'), short([paid, paidEv.calls]));
    check('… the HUD speed chip shows ⚡2×, entitle:changed {tier 2, prev 1} and speed:changed {tier 2, prev 1} were announced, the celebration names the server\'s tier',
      paid.chip.hidden === false && /2/.test(paid.chip.text) && paidEv.ev.some((e) => e.ev === 'entitle' && e.tier === 2 && e.prev === 1 && e.jars === 12)
      && paidEv.ev.some((e) => e.ev === 'speed' && e.tier === 2 && e.prev === 1) && paidEv.toasts.some((t) => /2배 빠르게 시작/.test(t)), short([paid.chip, paidEv]));
    check('… the 장독대 opens twelve jars for the plan (G.sys.fermentation.jarLimit follows the entitlement)', paid.jarLimit === null || paid.jarLimit === 12, String(paid.jarLimit));
    await shot(page, 'plan-paid.png');
    await page.evaluate(() => G.sys.subscription.close());

    // ---- 5 · expiry: locked, not lost
    const exp = await page.evaluate(async () => {
      const S = window.__srv, J = G.sys.fermentation;
      const rid = Object.keys(G.data.recipes || {})[0];
      let jar = null;
      if (G.state.jars && G.state.jars.J5) { Object.assign(G.state.jars.J5, { owned: true, via: 'plan', recipeId: rid, status: 'FERMENTING', progress: 37, startedAt: Date.now() - 600000, lastUpdate: Date.now() }); jar = 'J5'; }
      window.__events.length = 0;
      S.sub = { tier: 1, status: 'none', expiresAt: 0, autoRenew: false };
      S.ent = window.__ent();
      await G.net.request('player/save.php', { body: {} }); // the next save answers with the lower entitlement
      await new Promise((r) => setTimeout(r, 600));
      const s5 = jar ? G.state.jars.J5 : null;
      return {
        tier: G.sys.entitle.tier(), jars: G.sys.entitle.limit('jars'), move: G.sys.speed.movement(), grow: G.sys.speed.progression(), chipHidden: document.getElementById('hud-speed').hidden,
        jar, kept: s5 ? { owned: s5.owned, recipeId: s5.recipeId === rid, status: s5.status, progress: s5.progress } : null,
        lock5: jar && typeof J?.lockOf === 'function' ? J.lockOf('J5') : 'n/a', lock2: typeof J?.lockOf === 'function' ? J.lockOf('J1') : 'n/a',
        ev: window.__events.filter((e) => e.ev === 'entitle'),
      };
    });
    check('the plan ends (a save answers with the free entitlement): speed back to × 1, 3 jars, the chip goes away, entitle:changed {tier 1, prev 2}',
      exp.tier === 1 && exp.jars === 3 && exp.move === 1 && exp.grow === 1 && exp.chipHidden === true && exp.ev.some((e) => e.tier === 1 && e.prev === 2 && e.jars === 3), short(exp));
    check('… jar 5 is locked, not lost: it is still owned and still holds its batch (recipe, stage, progress); jar 1 stays usable',
      exp.jar === null || (exp.kept.owned === true && exp.kept.recipeId === true && exp.kept.status === 'FERMENTING' && exp.kept.progress >= 37 && (exp.lock5 === 'plan' || exp.lock5 === 'n/a') && (exp.lock2 === null || exp.lock2 === 'n/a')), short(exp));

    // ---- 6 · a refusal still carries ent; garbage and forged objects
    const refusal = await page.evaluate(async () => {
      const S = window.__srv;
      S.fail['player/save.php'] = { code: 'SAVE_REJECTED', message: '저장하지 못했어요.', status: 422, data: { ent: window.__ent({ tier: 3, paid: true, speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } }), siteV: S.siteV } };
      let code = '';
      try { await G.net.request('player/save.php', { body: {} }); } catch (e) { code = e.code; }
      const r = { code, tier: G.sys.entitle.tier(), jars: G.sys.entitle.limit('jars') };
      await G.net.request('auth/me.php');
      r.back = G.sys.entitle.tier();
      return r;
    });
    check('a refused save (4xx) still carries `ent`: the page applies it and the error reaches the caller unchanged', refusal.code === 'SAVE_REJECTED' && refusal.tier === 3 && refusal.jars === 12 && refusal.back === 1, short(refusal));
    const garbage = await page.evaluate(async () => {
      const S = window.__srv, E = G.sys.entitle, out = {};
      const tryEnt = async (e) => { S.ent = e; await G.net.request('auth/me.php'); return { tier: E.tier(), jars: E.limit('jars'), room: E.limit('roomItems'), admin: E.isAdmin(), move: G.sys.speed.movement(), grow: G.sys.speed.progression(), url: E.adminUrl() }; };
      S.ent = window.__ent(); await G.net.request('auth/me.php');
      out.v2 = await tryEnt({ v: 2, tier: 4, admin: true, role: 'admin', limits: { jars: 12 } });                           // an unknown version: ignored
      out.huge = await tryEnt({ v: 1, tier: 99, speed: { move: 50, grow: -3 }, limits: { jars: 9999, roomItems: 1e9 } });   // out of range → the safe defaults
      out.str = await tryEnt('admin');
      out.arr = await tryEnt([{ v: 1, tier: 4 }]);
      out.adminNoRole = await tryEnt({ v: 1, tier: 3, admin: true, role: 'user', adminUrl: 'admin-x/', pwDefault: true, speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } });
      out.badUrl = await tryEnt({ v: 1, tier: 3, admin: true, role: 'admin', adminUrl: 'https://evil.example/admin/', speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } });
      out.badUrl2 = await tryEnt({ v: 1, tier: 3, admin: true, role: 'admin', adminUrl: '../../x/', speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } });
      out.jsUrl = await tryEnt({ v: 1, tier: 3, admin: true, role: 'admin', adminUrl: 'javascript:alert(1)//', speed: { move: 3, grow: 3 }, limits: { jars: 12, roomItems: 160 } });
      S.ent = window.__ent(); await G.net.request('auth/me.php');
      return out;
    });
    check('an `ent` this page does not understand (another version, a string, a list) is ignored; out-of-range numbers fall back to the safe values (tier 1, × 1, 3 jars, 80 items)',
      garbage.v2.tier === 1 && garbage.v2.admin === false && garbage.huge.tier === 1 && garbage.huge.jars === 3 && garbage.huge.room === 80 && garbage.huge.move === 1 && garbage.huge.grow === 1
      && garbage.str.tier === 1 && garbage.arr.tier === 1, short(garbage));
    check('admin: true without the admin role is not an administrator; an admin address that is not a plain folder name (a full URL, ../, javascript:) is dropped',
      garbage.adminNoRole.admin === false && garbage.adminNoRole.url === '' && garbage.badUrl.admin === true && garbage.badUrl.url === '' && garbage.badUrl2.url === '' && garbage.jsUrl.url === '', short(garbage));

    // ---- 7 · nobody but an administrator sees an admin button
    const noAdmin = await page.evaluate(async () => {
      window.__opened.length = 0;
      const opened = G.sys.entitle.openAdmin();
      G.app.openMenu();
      await new Promise((r) => setTimeout(r, 500));
      const tiles = [...document.querySelectorAll('.app-menu-modal .am-tile')].map((b) => b.dataset.mm);
      const text = document.querySelector('.app-menu-modal')?.textContent || '';
      G.app.closeMenu();
      const chip = document.getElementById('hud-admin');
      return { opened, tiles, hasText: /관리자 페이지/.test(text), chipShown: !!chip && !chip.hidden && getComputedStyle(chip).display !== 'none', win: window.__opened.length };
    });
    check('a visitor: no 🛠️ chip, no 관리자 페이지 tile in the menu, openAdmin() does nothing', noAdmin.opened === false && noAdmin.tiles.length > 5 && !noAdmin.tiles.includes('adminsite') && !noAdmin.hasText && !noAdmin.chipShown && noAdmin.win === 0, short(noAdmin));

    // ---- 8 · the administrator
    await page.evaluate((adminEnt) => {
      const S = window.__srv;
      S.user = { ...S.user, role: 'admin', nickname: '관리자' };
      S.ent = window.__ent({ ...adminEnt, pwDefault: true });
      G.auth.current = { ...G.auth.current, role: 'admin' };
      window.__events.length = 0; window.__toasts.length = 0; window.__opened.length = 0; S.calls.length = 0;
      try { sessionStorage.removeItem('tfm.entitle.pwdef'); } catch (e) { /* storage off */ }
    }, ADMIN_ENT);
    await page.evaluate(() => G.sys.entitle.refresh());
    const adm = await snap(page);
    check('an administrator has everything without paying: tier 3 (the top tier on sale), moves and grows × 3, 12 jars, 160 room items, a room; paid stays false',
      adm.admin === true && adm.tier === 3 && adm.move === 3 && adm.grow === 3 && adm.jars === 12 && adm.room === 160 && adm.myroom === true && adm.ent.paid === false && adm.spTier === 3, short(adm));
    check('… the speed chip shows ⚡⚡3× and the 🛠️ 관리자 chip appears on the HUD (with the ⚠️ mark while the default password is in use)',
      adm.chip.hidden === false && /3/.test(adm.chip.text) && adm.adm.shown === true && adm.adm.warn === true && /관리자/.test(adm.adm.text), short([adm.chip, adm.adm]));
    await shot(page, 'hud-admin.png');
    // a phone-sized window: the chip may be folded away with the rest of the HUD card, but it never hangs off the screen
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await shot(page, 'hud-admin-390.png');
    const narrow = await page.evaluate(() => { const el = document.getElementById('hud-admin'); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { shown: cs.display !== 'none' && r.width > 0, left: Math.round(r.left), right: Math.round(r.right), w: innerWidth }; });
    check('at 390 px the 🛠️ chip (where the HUD shows it) stays inside the screen', !narrow.shown || (narrow.left >= 0 && narrow.right <= narrow.w + 1), short(narrow));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(600);
    // the reminder, once per session
    await page.evaluate(() => { G.sys.entitle._reminded = false; G.sys.entitle._remind(); });
    const remindUp = await page.waitForFunction(() => !!G.ui.modal.get('entitle-pwdefault'), null, { timeout: T_UI }).then(() => true, () => false);
    const remind = await page.evaluate(() => { const m = G.ui.modal.get('entitle-pwdefault'); const t = m?.el?.textContent || ''; return { text: t.replace(/\s+/g, ' ').slice(0, 300), links: m?.el?.querySelectorAll('a[href]').length ?? -1 }; });
    check('an administrator who still uses the default password is reminded after login: a window that says so (without printing the password) with 지금 바꾸기 / 나중에',
      remindUp && /기본 비밀번호/.test(remind.text) && /지금 바꾸기/.test(remind.text) && /나중에/.test(remind.text) && !/admin1234/.test(remind.text) && remind.links === 0, short(remind));
    await shot(page, 'reminder.png');
    await page.evaluate(() => G.ui.modal.get('entitle-pwdefault')?.close());
    await page.waitForTimeout(500);
    const again = await page.evaluate(async () => { G.sys.entitle._reminded = false; G.sys.entitle._remind(); await new Promise((r) => setTimeout(r, 700)); return !!G.ui.modal.get('entitle-pwdefault'); });
    check('… once per browser session: a second login in the same session does not show it again', again === false);
    // the menu tile and the chip open the admin site
    await page.evaluate(() => { window.__opened.length = 0; G.app.openMenu(); });
    await page.waitForSelector('.app-menu-modal .am-tile[data-mm="adminsite"]', { timeout: T_UI });
    const tile = await page.evaluate(() => { const b = document.querySelector('.app-menu-modal .am-tile[data-mm="adminsite"]'); return { text: b.textContent.replace(/\s+/g, ' '), sub: document.querySelector('.app-menu-modal .am-tile[data-mm="subscription"] small')?.textContent || '' }; });
    await shot(page, 'menu-admin.png');
    await tap(page, '.app-menu-modal .am-tile[data-mm="adminsite"]');
    await page.waitForTimeout(600);
    const viaTile = await page.evaluate(() => window.__opened.slice());
    check('the menu shows 🛠️ 관리자 페이지 for the administrator (its caption warns about the default password; the plan tile says 관리자는 모든 기능을 무료로 써요)',
      /관리자 페이지/.test(tile.text) && /기본 비밀번호/.test(tile.text) && /관리자는 모든 기능을 무료로 써요/.test(tile.sub), short(tile));
    check('… a tap opens ent.adminUrl — the folder next to this page — in a new tab without an opener', viaTile.length === 1 && viaTile[0].url === `${ORIGIN}/admin-1a2b3c4d5e/` && viaTile[0].target === '_blank' && /noopener/.test(viaTile[0].features), short(viaTile));
    await page.evaluate(() => { G.app.closeMenu(); window.__opened.length = 0; });
    const chipBox = await page.evaluate(() => { const el = document.getElementById('hud-admin'); const r = el.getBoundingClientRect(); el.click(); return { w: Math.round(r.width), h: Math.round(r.height), inView: r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth }; });
    await page.waitForTimeout(400);
    const viaChip = await page.evaluate(() => window.__opened.slice());
    check('… and so does the HUD chip (it is on screen: inside the viewport, wider than 40 px)', viaChip.length === 1 && viaChip[0].url === `${ORIGIN}/admin-1a2b3c4d5e/` && chipBox.inView && chipBox.w >= 40, short([viaChip, chipBox]));
    // the plan screen of an administrator
    await page.evaluate(() => { window.__srv.calls.length = 0; window.__opened.length = 0; G.sys.subscription.open(); });
    await page.waitForSelector('.app-sub-modal .sub-admin-note', { timeout: T_UI });
    await page.waitForTimeout(900);
    const plan = await page.evaluate(async () => {
      const root = document.querySelector('.app-sub-modal');
      const r = {
        text: root.textContent.replace(/\s+/g, ' '), buy: root.querySelectorAll('[data-sub="buy"]').length, cards: root.querySelectorAll('.sub-tier').length,
        adminBtn: !!root.querySelector('[data-sub="admin"]'), status: root.querySelector('.sub-status')?.textContent || '', cancel: !!root.querySelector('[data-sub="cancel"]'),
      };
      r.buyResult = await G.sys.subscription.buy(2, 'card');
      r.prepare = window.__srv.calls.filter((c) => c.path === 'sub/prepare.php').length;
      return r;
    });
    check('the plan screen of an administrator says 관리자는 모든 기능을 무료로 써요, shows the visitors\' cards as a preview (no stray "null" text) and has NO payment button',
      /관리자는 모든 기능을 무료로 써요/.test(plan.text) && !/null|undefined/.test(plan.text) && plan.buy === 0 && plan.cards === 2 && plan.adminBtn && /관리자/.test(plan.status) && /장독 12개/.test(plan.text) && !plan.cancel, short(plan));
    check('… buy() refuses an administrator before any request (no sub/prepare.php call)', plan.buyResult === false && plan.prepare === 0, short([plan.buyResult, plan.prepare]));
    await shot(page, 'plan-admin.png');
    await tap(page, '.app-sub-modal [data-sub="admin"]');
    await page.waitForTimeout(400);
    const viaPlan = await page.evaluate(() => { const o = window.__opened.slice(); G.sys.subscription.close(); return o; });
    check('… its 🛠️ 관리자 페이지 열기 button opens the admin site', viaPlan.length === 1 && viaPlan[0].url === `${ORIGIN}/admin-1a2b3c4d5e/`, short(viaPlan));

    // ---- 9 · the password of a server account
    await page.evaluate(() => { G.app.openSettings('account'); });
    await page.waitForSelector('.app-settings-modal form.acc-pw', { timeout: T_UI });
    await shot(page, 'account-password.png');
    const pw = await page.evaluate(async () => {
      const S = window.__srv, out = {};
      S.calls.length = 0;
      out.empty = await G.auth.changePassword('', 'New2026pass', 'New2026pass');
      out.short = await G.auth.changePassword('Old2026pass', 'abc1', 'abc1');
      out.mismatch = await G.auth.changePassword('Old2026pass', 'New2026pass', 'New2026pasx');
      out.same = await G.auth.changePassword('Old2026pass', 'Old2026pass', 'Old2026pass');
      out.callsBefore = S.calls.length;                                   // none of those reached the server
      out.wrong = await G.auth.changePassword('Wrong2026pass', 'New2026pass', 'New2026pass');
      out.weak = await G.auth.changePassword('Old2026pass', 'onlyletters', 'onlyletters');
      S.fail['auth/password.php'] = { code: 'TOO_MANY_ATTEMPTS', message: '시도가 너무 많아요. 5분 뒤에 다시 해 주세요.', status: 429 };
      out.locked = await G.auth.changePassword('Old2026pass', 'New2026pass', 'New2026pass');
      out.warnBefore = document.getElementById('hud-admin').classList.contains('is-warn');
      out.ok = await G.auth.changePassword('Old2026pass', 'New2026pass', 'New2026pass');
      const last = S.calls.filter((c) => c.path === 'auth/password.php').pop();
      out.body = last ? Object.keys(last.body).sort().join(',') : '';
      out.pwDefaultAfter = G.sys.entitle.get().pwDefault;
      out.warnAfter = document.getElementById('hud-admin').classList.contains('is-warn');
      return out;
    });
    check('the account tab shows 비밀번호 바꾸기 for a server account; an empty, short, mismatching or unchanged password is stopped in the page (no request)',
      pw.empty.field === 'current' && pw.short.field === 'next' && pw.mismatch.field === 'again' && pw.same.field === 'next' && pw.callsBefore === 0, short(pw));
    check('… the server\'s refusals land on the right field: a wrong present password (current), a weak new one (next, the server\'s sentence), a locked form (current, the server\'s wait)',
      pw.wrong.field === 'current' && /올바르지 않아요/.test(pw.wrong.msg) && pw.weak.field === 'next' && /영문과 숫자/.test(pw.weak.msg) && pw.locked.field === 'current' && /5분/.test(pw.locked.msg), short([pw.wrong, pw.weak, pw.locked]));
    check('… a good change posts {current, password, password_confirm} to auth/password.php and the answer\'s `ent` clears the default-password mark at once',
      pw.ok.msg === '' && pw.body === 'current,password,password_confirm' && pw.warnBefore === true && pw.pwDefaultAfter === false && pw.warnAfter === false, short(pw));
    await page.evaluate(() => G.ui.modal.get('app-settings')?.close());

    // ---- 9b · a late answer after a logout
    const late = await page.evaluate(async () => {
      const E = G.sys.entitle;
      E._ent = null; E._awaitAuth = true; E._sync('test');            // what a logout leaves behind
      const before = E.tier();
      await G.net.request('player/save.php', { body: {} });            // a save that was still on its way carries the administrator's ent
      const afterSave = { tier: E.tier(), admin: E.isAdmin() };
      await G.net.request('auth/me.php');                              // the session's own answer
      return { before, afterSave, afterMe: { tier: E.tier(), admin: E.isAdmin() } };
    });
    check('a save answer that arrives after a logout does not speak for the next session; the session\'s own auth answer does',
      late.before === 1 && late.afterSave.tier === 1 && late.afterSave.admin === false && late.afterMe.admin === true && late.afterMe.tier === 3, short(late));

    // ---- 10 · a guest profile on a server: the free values, whatever is still in memory
    const out = await page.evaluate(async () => {
      const keep = G.auth.current;
      G.auth.current = { ...keep, kind: 'guest', role: 'user' };   // what a guest profile on the same server looks like
      G.sys.entitle._sync('test');
      const chip = document.getElementById('hud-admin');
      const r = { tier: G.sys.entitle.tier(), admin: G.sys.entitle.isAdmin(), jars: G.sys.entitle.limit('jars'), chipHidden: chip.hidden, move: G.sys.speed.movement(), opened: G.sys.entitle.openAdmin() };
      G.auth.current = keep;
      G.sys.entitle._sync('test');
      r.back = G.sys.entitle.isAdmin();
      return r;
    });
    check('a guest profile on the same server gets nothing of the administrator whose answer is still in memory: tier 1, × 1, 3 jars, no chip, no way in', out.tier === 1 && out.admin === false && out.jars === 3 && out.chipHidden === true && out.move === 1 && out.opened === false && out.back === true, short(out));
  } catch (e) {
    check('the grown-up page could be driven to the end', false, String(e?.stack || e).slice(0, 700));
  } finally { await ctx.close(); }

  // ================================================================= 쉬운 모드
  const easy = await openPage({ easy: true });
  try {
    const p2 = easy.page;
    await installServer(p2);
    await p2.evaluate((adminEnt) => {
      const S = window.__srv;
      S.user = { ...S.user, role: 'admin' };
      S.ent = window.__ent({ ...adminEnt, pwDefault: true });
      try { sessionStorage.removeItem('tfm.entitle.pwdef'); } catch (e) { /* storage off */ }
    }, ADMIN_ENT);
    await goServer(p2);
    await p2.evaluate(() => { G.auth.current = { ...G.auth.current, role: 'admin' }; G.sys.entitle._sync('test'); });
    const s = await snap(p2);
    const isEasy = await p2.evaluate(() => document.body.classList.contains('easy') && G.easy?.on === true);
    check('쉬운 모드, an administrator: the entitlement is the same (tier 3, 12 jars) but the 🛠️ chip is NOT on the kid HUD', isEasy && s.admin === true && s.tier === 3 && s.jars === 12 && s.adm.shown === false, short([isEasy, s.adm, s.tier]));
    const kid = await p2.evaluate(async () => {
      G.app.openKidMenu();
      await new Promise((r) => setTimeout(r, 700));
      const top = G.ui.modal.top();
      const text = top?.el?.textContent || '';
      const r = { open: !!top, admin: /관리자/.test(text), links: top?.el?.querySelectorAll('a[href]').length ?? -1, price: /₩|\d[\d,]*\s*원/.test(text) };
      top?.close?.();
      return r;
    });
    check('… the kid menu has no 관리자 entry, no link and no price', kid.open && kid.admin === false && kid.links === 0 && kid.price === false, short(kid));
    await p2.evaluate(() => { window.__toasts.length = 0; G.sys.entitle._reminded = false; G.sys.entitle._remind(); });
    await p2.waitForTimeout(1200);
    const kidRemind = await p2.evaluate(() => ({ modal: !!G.ui.modal.get('entitle-pwdefault'), toasts: window.__toasts.slice() }));
    check('… the default-password reminder is one calm line that points to 어른 메뉴 (no window, no typing, no link)', kidRemind.modal === false && kidRemind.toasts.some((t) => /어른 메뉴/.test(t) && /비밀번호/.test(t)), short(kidRemind));
    // straight from a kid screen: the gate first, no tab
    await p2.evaluate(() => { window.__opened.length = 0; window.__r = G.sys.entitle.openAdmin(); });
    const gateUp = await p2.waitForFunction(() => !!G.ui.modal.get('easy-gate'), null, { timeout: T_UI }).then(() => true, () => false);
    const before = await p2.evaluate(() => ({ r: window.__r, opened: window.__opened.length }));
    check('… openAdmin() from a kid screen opens no tab: the parent gate comes first', gateUp && before.r === false && before.opened === 0, short([gateUp, before]));
    const passed = gateUp ? await solveGate(p2) : false;
    const menuUp = await p2.waitForSelector('.app-menu-modal .am-tile[data-mm="adminsite"]', { timeout: T_UI }).then(() => true, () => false);
    check('… behind the gate, 어른 메뉴 shows 🛠️ 관리자 페이지', passed && menuUp, short([passed, menuUp]));
    if (menuUp) {
      await shot(p2, 'easy-adult-menu.png');
      await tap(p2, '.app-menu-modal .am-tile[data-mm="adminsite"]');
      await p2.waitForTimeout(600);
    }
    const after = await p2.evaluate(() => window.__opened.slice());
    check('… and only there a tap opens the admin site in a new tab', after.length === 1 && after[0].url === `${ORIGIN}/admin-1a2b3c4d5e/` && after[0].target === '_blank', short(after));
  } catch (e) {
    check('the 쉬운 모드 page could be driven to the end', false, String(e?.stack || e).slice(0, 700));
  } finally { await easy.ctx.close(); }
} finally {
  await browser.close();
}
if (pageErrors.length) console.log(`\x1b[2mpage errors (not judged): ${short(pageErrors.slice(0, 5))}\x1b[0m`);
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n\x1b[31m✖ ${failed} of ${results.length} entitle client checks failed\x1b[0m` : `\n\x1b[32m✔ all ${results.length} entitle client checks passed\x1b[0m`);
process.exit(failed ? 1 : 0);
