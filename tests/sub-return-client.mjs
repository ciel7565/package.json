#!/usr/bin/env node
// =============================================================================
// tests/sub-return-client.mjs — what the app says after the payment window (72-subscription, CONTRACT §15.7 #4)
//
//   node tests/sub-return-client.mjs [--file dist/metaverse/index.html]
//
// api/sub/return.php brings the browser back to index.html?sub=ok|fail&… — but anyone can write such a link and send
// it around. The app may show only its own fixed sentences: never text from the address (?msg=, an unknown ?code= or
// ?why=) in a toast or its title tooltip, in easy mode and in grown-up mode; markup stays text; the return words leave
// the address bar; and a "paid" celebration shows only the tier the server confirms, never ?tier= from the address.
//
// The built single file is served at a scripted origin (Playwright routes, no PHP): every api/ answer is 404, so the
// app runs in local mode as it would from a plain web folder. One page per address (the return is read once, at
// start). The success path drives G.sys.subscription with a scripted sub/status.php, like tests/social-client.mjs.
// Prints PASS/FAIL per check, exit code 1 on any failure.
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
if (!fs.existsSync(file)) { console.error(`✖ ${file} not found — build first (node tools/build.mjs)`); process.exit(2); }
const HTML = fs.readFileSync(file);
const ORIGIN = 'http://tfm-sub.test';
const APP = 'notutorial=1&nointro=1&quality=low';
const RETURN_KEYS = ['sub', 'tier', 'code', 'why', 'msg'];

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\x1b[2m  — ${detail}\x1b[0m` : ''}`);
}
const short = (v) => JSON.stringify(v).slice(0, 600);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pageErrors = [];

/** a fresh browser (own storage) on ORIGIN/index.html?<query>; every toast the page ever shows is recorded */
async function openPage(query, { easy = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not here' });
  });
  // grown-up mode is the device setting a parent who switched easy mode off has (03-state.js, key tfm.v1.settings)
  if (!easy) await ctx.addInitScript(() => { try { localStorage.setItem('tfm.v1.settings', JSON.stringify({ _v: 2, easyMode: false })); } catch (e) { /* storage off */ } });
  await ctx.addInitScript(() => {
    window.__toasts = [];
    const grab = (el) => window.__toasts.push({
      text: (el.querySelector('.t-msg') || el).textContent || '', title: el.getAttribute('title') || '', html: el.innerHTML, cls: String(el.className || ''),
    });
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) grab(n);
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${query}: ${String(e?.message || e).slice(0, 200)}`));
  await page.goto(`${ORIGIN}/index.html?${APP}${query ? `&${query}` : ''}`, { waitUntil: 'load', timeout: 300000 });
  return { ctx, page };
}

/** open a payment-return address, wait for the payment toast, collect everything the page then shows / keeps */
async function landOn(query, opts) {
  const { ctx, page } = await openPage(query, opts);
  try {
    await page.waitForFunction(() => window.__toasts.some((t) => /결제/.test(t.text + t.title)), null, { timeout: 240000, polling: 250 });
    await page.waitForTimeout(1500); // anything that follows the first toast
    return await page.evaluate((keys) => ({
      toasts: window.__toasts,
      left: keys.filter((k) => new URLSearchParams(location.search).has(k)),
      params: keys.filter((k) => G.params && G.params.has(k)),
      xss: window.__tfmSubXss === 1,
    }), RETURN_KEYS);
  } finally { await ctx.close(); }
}
/** none of the toasts (text or title tooltip, or as markup) carries any of the words */
const leaks = (toasts, words) => toasts.filter((t) => words.some((w) => (t.text + '\n' + t.title + '\n' + t.html).includes(w)));
const payToasts = (r) => r.toasts.filter((t) => /결제/.test(t.text + t.title));

const MARK = '보안 확인: 결제를 마치려면 tfm-pay.example 에서 카드 번호와 비밀번호를 다시 넣어 주세요';
const enc = encodeURIComponent;
try {
  // --- the failure toast never carries text from the address --------------------------------------------------------
  const scenarios = [
    { id: 'grown-msg', easy: false, query: `sub=fail&msg=${enc(MARK)}`, expect: /결제가 끝나지 않았어요\./, words: [MARK, 'tfm-pay.example'] },
    { id: 'easy-msg', easy: true, query: `sub=fail&msg=${enc(MARK)}`, expect: /결제가 안 됐어요/, words: [MARK, 'tfm-pay.example'] },
    { id: 'easy-cancel', easy: true, query: `sub=fail&code=USER_CANCEL&msg=${enc(MARK)}`, expect: /결제를 취소했어요/, words: [MARK, 'tfm-pay.example'] },
    { id: 'grown-card', easy: false, query: `sub=fail&code=REJECT_CARD_COMPANY&msg=${enc(MARK)}`, expect: /카드사가 결제를 거절했어요/, words: [MARK, 'tfm-pay.example'] },
    { id: 'grown-why', easy: false, query: `sub=fail&why=LOGIN&msg=${enc(MARK)}`, expect: /로그인이 풀려/, words: [MARK, 'tfm-pay.example'] },
    {
      id: 'grown-forged', easy: false,
      query: `sub=fail&code=TFM_FORGED_CODE&why=${enc('<svg onload=window.__tfmSubXss=1>')}&msg=${enc('<img src=x onerror="window.__tfmSubXss=1">')}`,
      expect: /결제가 끝나지 않았어요\./, words: ['TFM_FORGED_CODE', '<img', 'onerror', '<svg', 'onload'],
    },
  ];
  for (const s of scenarios) {
    let r;
    try { r = await landOn(s.query, { easy: s.easy }); } catch (e) {
      check(`[${s.id}] index.html?${s.query.slice(0, 60)}… shows a payment toast`, false, String(e?.message || e).slice(0, 300));
      continue;
    }
    const pay = payToasts(r);
    const bad = leaks(r.toasts, s.words);
    check(`[${s.id}] ${s.easy ? 'easy' : 'grown-up'} mode, ${s.query.split('&msg=')[0]}&msg=…: no text from the address in any toast (body, title tooltip, markup)`,
      !bad.length, bad.length ? `expected none of ${short(s.words)}; received: ${short(bad.map((t) => ({ text: t.text, title: t.title })))}` : '');
    check(`[${s.id}] the payment toast is the app's own sentence`, pay.some((t) => s.expect.test(t.text)),
      `expected a toast matching ${s.expect}; received: ${short(pay.map((t) => t.text))}`);
    check(`[${s.id}] the return words leave the address bar and G.params`, !r.left.length && !r.params.length,
      r.left.length || r.params.length ? `expected none of ${RETURN_KEYS.join(', ')}; still in the address: ${short(r.left)}, in G.params: ${short(r.params)}` : '');
    if (s.id === 'grown-forged') {
      const els = r.toasts.filter((t) => /<(img|svg|script)\b/i.test(t.html));
      check('[grown-forged] markup in the address never becomes an element and never runs', !els.length && !r.xss,
        els.length || r.xss ? `expected no <img>/<svg> element and window.__tfmSubXss unset; received: ${short(els.map((t) => t.html))}, ran: ${r.xss}` : '');
    }
  }

  // --- the success path: a celebration only for the tier the server confirms ---------------------------------------
  const { ctx, page } = await openPage('autostart=1', { easy: true });
  try {
    await page.waitForFunction(() => window.G?.ready === true && G.state && G.app?.loggedIn, null, { timeout: 600000, polling: 250 });
    await page.evaluate(() => {
      window.__status = null;
      G.net.mode = 'server';
      G.auth.current = { ...(G.auth.current || {}), kind: 'server' };
      G.save.save = async () => false; // the local profile underneath must not look like a working server save
      G.net.request = async (p) => {
        if (String(p).startsWith('sub/status.php')) return JSON.parse(JSON.stringify(window.__status));
        throw new G.net.ApiError('NOT_FOUND', 'not faked', 404);
      };
    });
    /** the next login after index.html?sub=ok&tier=<linkTier>, while sub/status.php says <serverTier> */
    const returnOk = (serverTier, linkTier) => page.evaluate(async ([st, lt]) => {
      window.__status = {
        sub: st > 1 ? { tier: st, status: 'active', expiresAt: Date.now() + 30 * 86400000, autoRenew: false } : { tier: 1, status: 'none', expiresAt: 0, autoRenew: false },
        tiers: [{ tier: 2, name: '⚡ 2배', price: 2900 }, { tier: 3, name: '⚡⚡ 3배', price: 4900 }, { tier: 4, name: '⚡⚡⚡ 4배', price: 6900 }], mode: 'mock', periodDays: 30,
      };
      const n0 = window.__toasts.length;
      const S = G.sys.subscription;
      S._ret = { ok: true, tier: lt, code: '', why: '' }; // what readReturn() keeps from ?sub=ok&tier=<lt> for the next login
      S._onLogin();
      const t0 = performance.now();
      while (performance.now() - t0 < 25000) {
        if (window.__toasts.slice(n0).some((t) => /빠르게 시작|결제/.test(t.text))) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 800));
      return { toasts: window.__toasts.slice(n0).map((t) => t.text), tier: G.sys.subscription.tier() };
    }, [serverTier, linkTier]);
    const forged = await returnOk(1, 4);
    const claims = forged.toasts.filter((t) => /배 빠르게 시작|결제가 끝났어요/.test(t));
    check('?sub=ok&tier=4 while the server says tier 1 (a forged link): no "paid" celebration and no "payment finished" claim',
      !claims.length, claims.length ? `expected no toast claiming a payment; received: ${short(forged.toasts)} (tier now ${forged.tier})` : '');
    check('… instead a calm note that the payment is not confirmed (basic speed)', forged.toasts.some((t) => /확인되지 않았어요/.test(t) && /기본 속도/.test(t)),
      `expected a toast saying the payment is not confirmed and the speed is basic; received: ${short(forged.toasts)}`);
    const real = await returnOk(3, 3);
    check('a real return (the server confirms tier 3): the celebration shows the server\'s tier', real.toasts.some((t) => /3배 빠르게 시작/.test(t)) && real.tier === 3,
      `expected "⚡ 3배 빠르게 시작!" and tier 3; received: ${short(real.toasts)} (tier ${real.tier})`);
    const other = await returnOk(2, 4);
    check('a return whose link says tier 4 while the server confirms tier 2: the celebration says 2', other.toasts.some((t) => /2배 빠르게 시작/.test(t)) && !other.toasts.some((t) => /4배/.test(t)),
      `expected "⚡ 2배 빠르게 시작!" and nothing about 4배; received: ${short(other.toasts)}`);
  } catch (e) {
    check('the success path could be driven', false, String(e?.stack || e).slice(0, 400));
  } finally { await ctx.close(); }
} finally {
  await browser.close();
}
if (pageErrors.length) console.log(`\x1b[2mpage errors (not judged): ${short(pageErrors.slice(0, 5))}\x1b[0m`);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
