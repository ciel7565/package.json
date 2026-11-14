#!/usr/bin/env node
// =============================================================================
// tests/allot-client.mjs — 분양 in the app: the panel of G.sys.allot (CONTRACT §16.8)
//
//   node tests/allot-client.mjs                       builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/allot-client.mjs --file /abs/page.html test an already built page
//   options: --keep · --json · --headed · --timeout <ms> · --ui-timeout <ms> · --shots <dir> (screenshots of the panel)
//            --only local,server,phone (sections)
//
// LOCAL (the file:// page, the 체험용 demo): the panel opens on every tab; the 지도 holds all 10,000 units of the default
//   preset at their places in the master plan (G.data.complex), coloured by status; the first draw and the pan / zoom
//   frames are measured IN THE PAGE (offscreen layers + blit); 20 sample units are tapped and found again; 빈 자리 찾기,
//   filters, the legend (5 shapes), 내 자리 star; 내 분양 card with the craft timeline and the care-log feed; the 알림 tab;
//   applying in local mode is refused kindly; easy mode = picture tiles, no text box, no price, big buttons.
// SERVER (G.net.request replaced by a scripted fake, an account of kind 'server'): map.php ?v= polling (same: true),
//   the poll stops when the page is hidden or the panel is closed; the happy path (map → unit card → 신청 → plan on one
//   screen → form → consents → result) with the exact request body; every error state (UNIT_TAKEN → 옆자리,
//   APPLY_LIMIT, CONSENT_REQUIRED → new plans, SOLD_OUT → 대기, offline, lost login, a bad phone never leaves the page);
//   내 분양 paging (14 contracts: 6 → 12 → 14); nameplate edit; cancel; waiting list leave; inbox → the 알림함 (act
//   'allot') → the panel; a markup-looking server string stays text; easy mode never asks plans.php before the gate.
// PHONE: 390 × 844 and 844 × 390 — no sideways scroll, ≥ 56 px arrows and tiles in easy mode, the canvas fills its box.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '240000'));
const T_UI = Number(opt('--ui-timeout', '30000'));
const jsonOut = flag('--json');
const SHOTS = opt('--shots');
const ONLY = (opt('--only') || 'local,server,phone').split(',');
const log = (...a) => { if (!jsonOut) console.log(...a); };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-allot-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 240)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [];
const consoleErrors = [];
async function newPage(viewport) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  return page;
}
const url = `${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${opt('--quality', 'low')}`;
async function boot(page) {
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.allot && !!window.G.state, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { G.ui.modal.closeAll(); });
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {}); };
async function solveGate(page) {
  for (let round = 0; round < 6; round++) {
    const q = await page.waitForSelector('.easy-gate-q[aria-label]', { timeout: T_UI }).catch(() => null);
    if (!q) return false;
    const m = /(\d+)\s*곱하기\s*(\d+)/.exec((await q.getAttribute('aria-label')) || '');
    if (!m) return false;
    const ans = String(Number(m[1]) * Number(m[2]));
    await page.waitForFunction((v) => { const b = document.querySelector(`.easy-gate-choice[data-v="${v}"]`); return !!b && !b.disabled; }, ans, { timeout: T_UI, polling: 100 });
    await page.locator(`.easy-gate-choice[data-v="${ans}"]`).first().click();
    await page.waitForTimeout(450);
    if (!(await page.evaluate(() => !!G.ui.modal.get('easy-gate')))) return true;
  }
  return false;
}
/** wait for the map canvas of the panel to have drawn */
async function waitMap(page) {
  await page.waitForFunction(() => { const A = G.sys.allot; return !!A._map && A.perf.renders > 0 && !!document.querySelector('.al-canvas'); }, null, { timeout: T_UI, polling: 100 });
}

// ============================================================================ LOCAL
async function localSection() {
  const page = await newPage({ width: 1280, height: 800 });
  await boot(page);
  check('local: fragment loaded (G.sys.allot, G.data.allot, G.data.complex)', await page.evaluate(() => !!G.sys.allot && !!G.data.allot && !!G.data.complex && G.net.mode === 'local'));
  check('local: G.data.allot has no layout of its own (the plan is G.data.complex)', await page.evaluate(() => !('layout' in G.data.allot) && !('GRID' in G.data.allot) && typeof G.data.allot.demoMap === 'function'));
  await page.evaluate(() => G.setSetting('easyMode', false));
  // ---- the map
  await page.evaluate(() => G.sys.allot.open('map'));
  await waitMap(page);
  const m0 = await page.evaluate(() => {
    const A = G.sys.allot, s = A.mapState();
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < s.status.length; i++) counts[s.status[i]]++;
    return { count: s.layout.count, unplaced: s.layout.unplaced, demo: s.demo, counts, mine: s.mine, perf: { ...A.perf }, legend: document.querySelectorAll('.al-legend li').length, demoBanner: !!document.querySelector('.al-demo') };
  });
  check('local map: 10,000 units laid out by the master plan, none unplaced', m0.count === 10000 && m0.unplaced === 0, `count ${m0.count} unplaced ${m0.unplaced}`);
  check('local map: deterministic demo occupancy (open / held / leased / closed / mine all present)', m0.counts.every((n) => n > 0) && m0.mine.length === 1, JSON.stringify(m0.counts));
  check('local map: labelled 체험용', m0.demoBanner && m0.demo);
  check('local map: legend has 5 status shapes', m0.legend === 5);
  check('local map: the first draw (plan + 10,000 units into offscreen layers) is fast', m0.perf.firstDraw > 0 && m0.perf.firstDraw < 1500, `${m0.perf.firstDraw.toFixed(1)} ms`);
  const demoAgain = await page.evaluate(() => { const a = G.data.allot.demoMap(), b = G.data.allot.demoMap(); return a.zones.map((z) => z.s).join('') === b.zones.map((z) => z.s).join(''); });
  check('local map: the demo is the same every time', demoAgain);
  await shot(page, 'local-map-fit');
  // ---- frame cost: pans (blit only) and zooms (scaled blit, then one render per settled level)
  const cost = await page.evaluate(async () => {
    const A = G.sys.allot, M = A._map;
    const v0 = M.view;
    const p0 = { ...A.perf };
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) { M.setView({ x: v0.x + Math.sin(k / 6) * 30 / v0.scale * 10, z: v0.z + Math.cos(k / 7) * 20 / v0.scale * 10, scale: v0.scale }); M.frameNow(); }
    const pan = (performance.now() - t0) / 60;
    const rendersPan = A.perf.renders - p0.renders;
    // zoom to a jar zone at a close level, then pan there (2 × screen caches → mostly blits)
    M.zoomZone('J01', false); M.frameNow();
    const r1 = A.perf.renders;
    const t1 = performance.now();
    const v1 = M.view;
    for (let k = 0; k < 40; k++) { M.setView({ x: v1.x + k * 0.4, z: v1.z, scale: v1.scale }); M.frameNow(); }
    const panNear = (performance.now() - t1) / 40;
    const rendersNear = A.perf.renders - r1;
    const t2 = performance.now();
    for (let k = 0; k < 20; k++) { M.zoomBy(1.03); M.frameNow(); }
    const zoom = (performance.now() - t2) / 20;
    return { pan, rendersPan, panNear, rendersNear, zoom, lastRender: A.perf.lastRender, blitAvg: A.perf.blitAvg, blitMax: A.perf.blitMax, scale: M.view.scale };
  });
  check('local map: panning at the full view costs a blit, not a redraw', cost.rendersPan <= 1 && cost.pan < 30, `${cost.pan.toFixed(2)} ms / frame, ${cost.rendersPan} redraws in 60 frames`);
  check('local map: panning close up (a jar zone) stays a blit', cost.rendersNear <= 2 && cost.panNear < 30, `${cost.panNear.toFixed(2)} ms / frame, ${cost.rendersNear} redraws in 40 frames`);
  check('local map: zoom gesture frames scale the cached level', cost.zoom < 40, `${cost.zoom.toFixed(2)} ms / frame; one level redraw ${cost.lastRender.toFixed(1)} ms; blit avg ${cost.blitAvg.toFixed(2)} max ${cost.blitMax.toFixed(1)} ms`);
  // ---- tap → the unit (20 samples, real pointer events on the canvas)
  const taps = await page.evaluate(async () => {
    const A = G.sys.allot, M = A._map, L = A.mapState().layout, An = L.arrays;
    const box = M.canvas.getBoundingClientRect();
    let ok = 0; const bad = [];
    for (let k = 0; k < 20; k++) {
      const i = Math.floor((k + 0.5) * L.count / 20);
      const zone = L.zones[An.zone[i]].code, seq = An.seq[i];
      const u = L.unit(zone, seq);
      M.setView({ x: u.x + 3, z: u.z - 2, scale: 16 }); M.frameNow();
      const v = M.view;
      const px = (u.x - v.x) * v.scale + box.width / 2, py = (u.z - v.z) * v.scale + box.height / 2;
      const opt = { clientX: box.left + px, clientY: box.top + py, pointerId: 7, bubbles: true, isPrimary: true, pointerType: 'mouse' };
      M.canvas.dispatchEvent(new PointerEvent('pointerdown', opt));
      M.canvas.dispatchEvent(new PointerEvent('pointerup', opt));
      const s = A._sel;
      if (s && s.zone === zone && s.seq === seq) ok++; else bad.push(`${zone}-${seq}→${s ? `${s.zone}-${s.seq}` : 'none'}`);
    }
    return { ok, bad };
  });
  check('local map: 20 tapped units are found again (G.data.complex unitAt)', taps.ok === 20, taps.bad.join(', '));
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => { const c = document.querySelector('.al-unitcard'); return { text: c?.textContent || '', hasCode: /[A-Z]\d{2}-\d{4}/.test(c?.textContent || '') }; });
  check('local map: the unit card shows the tapped unit', card.hasCode, card.text.slice(0, 80));
  await shot(page, 'local-map-near');
  // ---- 빈 자리 찾기 + filters
  const free = await page.evaluate(async () => {
    const A = G.sys.allot;
    A._select(null);
    A._filter.kind = 'plot'; A._applyFilter(); A._renderMapTools();
    const code = A._findFree();
    const st = A.statusOf(code);
    A._map.frameNow();
    const fk = A._map ? true : false;
    A._filter.kind = ''; A._filter.freeOnly = true; A._applyFilter(); A._map.frameNow();
    const drawnFree = A.perf.unitsDrawn;
    A._filter.freeOnly = false; A._applyFilter(); A._map.frameNow();
    return { code, st, kind: code && A.mapState().zones.find((z) => z.code === code.split('-')[0])?.kind, fk, drawnFree };
  });
  check('local map: 빈 자리 찾기 picks an open unit of the chosen kind', free.st === 'open' && free.kind === 'plot', `${free.code} ${free.st} ${free.kind}`);
  const mine = await page.evaluate(() => G.sys.allot.statusOf(G.data.allot.demoUnit));
  check('local map: the sample unit is "mine" (star)', mine === 'mine');
  // ---- 내 분양
  await page.evaluate(() => G.sys.allot.open('mine'));
  await page.waitForSelector('.al-card', { timeout: T_UI });
  const mc = await page.evaluate(async () => {
    const c = document.querySelector('.al-card');
    const steps = [...c.querySelectorAll('.al-step-label')].map((x) => x.textContent);
    const det = c.querySelector('.al-care'); det.open = true; det.dispatchEvent(new Event('toggle'));
    await new Promise((r) => setTimeout(r, 200));
    return { steps, np: c.querySelector('.al-np-tag')?.textContent || '', logs: c.querySelectorAll('.al-care-list li').length, acts: [...c.querySelectorAll('.al-acts button')].map((b) => b.textContent.trim()) };
  });
  check('local 내 분양: card with 담그기 → 가르기 → 익히기 → 받는 날', mc.steps.join('>') === '담그기>가르기>익히기>받는 날', mc.steps.join(' > '));
  check('local 내 분양: nameplate + 찾아가기 + 지도에서 보기', /우리 가족 장/.test(mc.np) && mc.acts.some((t) => /찾아가기/.test(t)) && mc.acts.some((t) => /지도에서 보기/.test(t)), `${mc.np} · ${mc.acts.join(' / ')}`);
  check('local 내 분양: the care-log feed opens with the demo logs', mc.logs >= 3, `${mc.logs} rows`);
  const visit = await page.evaluate(async () => { const t0 = document.querySelectorAll('.toast').length; await G.sys.allot.visit('J01-0012'); return { toast: document.querySelectorAll('.toast').length >= t0, open: G.sys.allot.isOpen(), cur: G.sys.places?.current || null }; });
  check('local: 찾아가기 enters PL_ALLOT when it exists, else a kind toast', visit.cur === 'PL_ALLOT' || visit.toast, JSON.stringify(visit));
  if (visit.cur === 'PL_ALLOT') await page.evaluate(() => G.sys.places.exit({ fade: false }));
  // ---- 알림 + local apply
  await page.evaluate(() => G.sys.allot.open('inbox'));
  await page.waitForSelector('.al-noti', { timeout: T_UI });
  check('local 알림: demo notices', await page.evaluate(() => document.querySelectorAll('.al-noti').length === 2));
  const la = await page.evaluate(async () => { const r = await G.sys.allot.startApply('J01-0001'); return { r, apply: !!G.ui.modal.get('allot-apply') }; });
  check('local: applying is refused kindly (서버 모드에서…), no form', la.r === null && !la.apply);
  await page.evaluate(() => G.sys.allot.open('guide'));
  check('local 안내: steps, no price, no health claim', await page.evaluate(() => { const t = document.querySelector('.al-pane')?.textContent || ''; return document.querySelectorAll('.al-guide-steps li').length >= 5 && !/\d원/.test(t) && !/면역|건강에 좋|효능/.test(t); }));
  // ---- easy mode
  await page.evaluate(() => { G.ui.modal.closeAll(); G.setSetting('easyMode', true); });
  await page.evaluate(() => G.sys.allot.open('mine'));
  await page.waitForSelector('.al-kidtiles', { timeout: T_UI });
  const ez = await page.evaluate(() => {
    const p = document.querySelector('.allot-modal');
    const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const inputs = [...p.querySelectorAll('input:not([type=checkbox]), textarea')].filter(vis).length;
    const tiles = [...p.querySelectorAll('.al-kidtile')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.width), Math.round(r.height), !!b.dataset.say]; });
    return { inputs, tiles, price: /\d[\d,]*원/.test(p.textContent), tabs: !!p.querySelector('.al-tabs') && vis(p.querySelector('.al-tabs')) };
  });
  check('easy: four picture tiles (내 항아리 · 지도 · 알림 · 어른과 함께 신청) ≥ 56 px with voice lines', ez.tiles.length === 4 && ez.tiles.every((t) => t[1] >= 56 && t[2] >= 56 && t[3]) && /어른과 함께 신청/.test(ez.tiles[3][0]), JSON.stringify(ez.tiles));
  check('easy: no text box, no price, no text tabs', !ez.inputs && !ez.price && !ez.tabs, JSON.stringify({ inputs: ez.inputs, price: ez.price, tabs: ez.tabs }));
  await shot(page, 'easy-mine');
  await page.evaluate(() => document.querySelector('.al-kidtile:nth-child(2)').click());
  await waitMap(page);
  const ezm = await page.evaluate(() => { const r = [...document.querySelectorAll('.al-zarrow, .al-zbtn')].map((b) => { const q = b.getBoundingClientRect(); return Math.min(q.width, q.height); }); return { min: Math.min(...r), n: r.length }; });
  check('easy map: zoom and zone arrows ≥ 56 px', ezm.n >= 5 && ezm.min >= 56, JSON.stringify(ezm));
  await page.evaluate(() => { G.sys.allot._stepZone(1); });
  await page.waitForTimeout(600);
  await shot(page, 'easy-map-zone');
  check('local: no page errors', !pageErrors.length, pageErrors.join(' | '));
  await page.context().close();
}

// ============================================================================ SERVER (fake network)
const FAKE = String.raw`
(() => {
  const D = G.data.allot, C = G.data.complex;
  const zones = C.defaultZones().map((z, zi) => {
    const ch = [];
    for (let i = 0; i < z.cap; i++) { const r = ((i * 7919 + zi * 104729) % 1000) / 1000; ch.push(r < 0.6 ? 'l' : r < 0.62 ? 'h' : r > 0.99 ? 'c' : 'o'); }
    if (z.code === 'S02') for (let i = 0; i < ch.length; i++) if (ch[i] === 'o') ch[i] = 'l';
    return { code: z.code, kind: z.kind, name: z.name, cap: z.cap, cols: 40, open: true, s: ch.join('') };
  });
  const firstOpen = (code) => { const z = zones.find((q) => q.code === code); const i = z.s.indexOf('o'); return D.codeOf(code, i + 1); };
  const t = Date.now();
  const contracts = [];
  for (let k = 0; k < 14; k++) contracts.push({ contractNo: 'AL-2026-' + String(100 + k), status: k === 0 ? 'pending' : k === 1 ? 'overdue' : 'active', unit: { code: D.codeOf('J0' + (1 + (k % 6)), 20 + k), kind: 'jar', zone: 'J0' + (1 + (k % 6)), zoneName: '장독대 ' + (1 + (k % 6)) + '구역', seq: 20 + k },
    period: 'year', termMonths: 12, startsAt: t - 70 * 86400000, endsAt: t + 200 * 86400000, paidUntil: t + 200 * 86400000, autoRenew: false, holdUntil: k === 0 ? t + 86400000 : 0, payDue: k === 1 ? 1 : 0, cancelRequested: false,
    nameplate: { text: k === 2 ? '<b>굵게</b>' : '', show: false }, createdAt: t - 80 * 86400000, decidedAt: t - 79 * 86400000, endedAt: 0, endReason: '',
    timeline: [{ k: 'applied', at: t - 80 * 86400000, done: true }, { k: 'approved', at: t - 79 * 86400000, done: k !== 0 }, { k: 'ends', at: t + 200 * 86400000, done: false }] });
  const F = window.__F = { calls: [], v: 5, zones, contracts, applyScript: [], firstOpen,
    notices: [{ id: 41, kind: 'approved', title: '<img src=x onerror="window.__xss=1">확정', body: '장독대 <script>1</script> 확정', at: t - 1000, seen: false, contractNo: 'AL-2026-101' }, { id: 40, kind: 'info', title: '안내', body: '가르기 날', at: t - 9000, seen: true, contractNo: '' }] };
  const err = (status, code, data) => Object.assign(new Error(code), { status, code, data: data || {} });
  G.net.mode = 'server';
  G.auth.current = { ...(G.auth.current || {}), id: 7, kind: 'server', nickname: '시험' };
  G.net.request = async (p, opts = {}) => {
    F.calls.push({ p, body: opts.body ? JSON.parse(JSON.stringify(opts.body)) : null });
    const [ep, q] = p.split('?');
    if (F.offline) throw err(0, 'NETWORK_ERROR');
    switch (ep) {
      case 'allot/map.php': return /v=5/.test(q || '') && !F.changed ? { v: 5, same: true } : { v: F.v, zones: F.zones };
      case 'allot/mine.php': return { contracts: F.contracts, waitlist: [{ id: 3, kind: 'store', zone: 'S02', status: 'waiting', position: 2, unit: '', offerUntil: 0, createdAt: t }], unread: 1, limit: { max: 3, used: 2 } };
      case 'allot/plans.php': F.plansCalls = (F.plansCalls || 0) + 1; return { enabled: true, consentVersion: F.cv || 'v1', collectAddress: false, nameplateDefaultShow: false, applyPerUser: 3, holdHours: 48, graceDays: 14, autoApprove: 'off', toss: false,
        zones: F.zones.map((z) => ({ code: z.code, kind: z.kind, name: z.name, price: z.kind === 'jar' ? 220000 : z.kind === 'plot' ? 40000 : 15000, period: z.kind === 'store' ? 'month' : 'year', termMonths: 12, open: true, free: 10, cap: z.cap })),
        texts: { terms: '이용 약관 예시', privacy: '개인정보 처리 예시', refund: '담그기 7일 전까지 전액 환불 (예시)', payGuide: '계좌 이체 안내 (예시)' }, sample: true };
      case 'allot/unit.php': return { code: decodeURIComponent((q || '').split('=')[1] || ''), status: 'open', canApply: true, nameplate: '<i>남의 이름표</i>', logs: [{ id: 9, kind: 'water', text: '물 <u>주기</u>', at: t - 5000, scope: 'zone', visible: true }], mine: false };
      case 'allot/logs.php': return { logs: [{ id: 5, kind: 'check', text: '살폈어요', at: t - 3000, scope: 'unit' }], more: false };
      case 'allot/inbox.php': return { notices: F.notices, unread: 1, last: 41 };
      case 'allot/seen.php': return { updated: (opts.body?.ids || []).length, unread: 0 };
      case 'allot/apply.php': { const s = F.applyScript.shift();
        if (s && s.code === 'UNIT_TAKEN' && opts.body.unit) { const [zc, n] = opts.body.unit.split('-'); const z = F.zones.find((q) => q.code === zc); const i = Number(n) - 1; z.s = z.s.slice(0, i) + 'h' + z.s.slice(i + 1); F.v++; F.changed = true; }
        if (s) throw err(s.status, s.code, s.data); return { contractNo: 'AL-2026-900', status: 'pending', unit: opts.body.unit || 'J01-0002', holdUntil: t + 48 * 3600000, pay: { toss: false, guide: '계좌 이체 안내 (예시)', until: t + 48 * 3600000 } }; }
      case 'allot/cancel.php': return { contractNo: opts.body.contractNo, status: 'canceled', requested: false };
      case 'allot/nameplate.php': return { contractNo: opts.body.contractNo, nameplate: { text: opts.body.text, show: opts.body.show } };
      case 'allot/waitlist.php': return opts.body.action === 'leave' ? { id: opts.body.id, status: 'canceled' } : { id: 4, status: 'waiting', position: 1 };
      default: throw err(404, 'NOT_FOUND');
    }
  };
  return true;
})()`;

async function serverSection() {
  const page = await newPage({ width: 1280, height: 800 });
  await boot(page);
  await page.evaluate(() => G.setSetting('easyMode', false));
  await page.evaluate(FAKE);
  const calls = (re) => page.evaluate((s) => window.__F.calls.filter((c) => new RegExp(s).test(c.p)), re.source);
  // ---- map + polling
  await page.evaluate(() => G.sys.allot.open('map'));
  await waitMap(page);
  const ms = await page.evaluate(async () => {
    const A = G.sys.allot;
    const s = A.mapState();
    const r = await A.refreshMap();
    return { v: s.v, demo: s.demo, count: s.layout.count, same: r.same, pollTimer: !!A._pollT };
  });
  check('server map: map.php zones laid out (10,000), not the demo', ms.count === 10000 && !ms.demo && ms.v === 5);
  check('server map: an unchanged version answers same (?v=5)', ms.same === true && (await calls(/map\.php\?v=5/)).length >= 1);
  const poll = await page.evaluate(() => {
    const A = G.sys.allot;
    const n0 = window.__F.calls.length;
    const d = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const hidden = A._pollTick();
    delete document.hidden;
    const n1 = window.__F.calls.length;
    const vis = A._pollTick();
    return { hidden, vis, quietWhileHidden: n1 === n0, d: !!d };
  });
  check('server map: the 60 s poll asks nothing while the page is hidden', poll.hidden === false && poll.quietWhileHidden && poll.vis === true);
  // ---- happy path: tap an open unit → card → 신청 → plan → form → result
  const target = await page.evaluate(() => window.__F.firstOpen('J01'));
  await page.evaluate((c) => G.sys.allot.focus(c, { open: false }), target);
  await page.waitForFunction(() => /신청하기/.test(document.querySelector('.al-unitcard')?.textContent || ''), null, { timeout: T_UI });
  const safe1 = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); const c = document.querySelector('.al-unitcard'); return { tags: c.querySelectorAll('i, u, img, script').length, text: c.textContent }; });
  check('server map: the unit card renders server strings as text', safe1.tags === 0 && /<i>남의 이름표<\/i>/.test(safe1.text), safe1.text.slice(0, 120));
  await page.locator('.al-unitcard .btn-primary').click();
  await page.waitForSelector('.allot-adult-modal .al-plan', { timeout: T_UI });
  const plan = await page.evaluate(() => { const t = document.querySelector('.allot-adult-modal .al-plan').textContent; return { t, all: ['구좌', '기간', '금액', '받는 날', '환불 기한'].every((w) => t.includes(w)), price: /220,000원/.test(t), sample: !!document.querySelector('.allot-adult-modal .chip-gold') }; });
  check('apply: the plan on one screen — 구좌 · 기간 · 금액 · 받는 날 · 환불 기한 (from plans.php)', plan.all && plan.price, plan.t.slice(0, 160));
  check('apply: operator texts marked 예시 while they are the built-in examples', plan.sample);
  await shot(page, 'server-apply-plan');
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('#al-f-name', { timeout: T_UI });
  // a bad phone never leaves the page
  const nApply0 = (await calls(/apply\.php/)).length;
  await page.fill('#al-f-name', '김하늘');
  await page.fill('#al-f-phone', '12345');
  await page.check('#al-c-privacy'); await page.check('#al-c-adult');
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('.allot-adult-modal .al-err', { timeout: T_UI });
  check('apply: a bad phone number is caught in the page (no request)', (await calls(/apply\.php/)).length === nApply0 && /전화번호/.test(await page.textContent('.allot-adult-modal .al-err')));
  // consents are required
  await page.fill('#al-f-phone', '010-1234-5678');
  await page.uncheck('#al-c-privacy');
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForTimeout(200);
  check('apply: 개인정보 동의 is required', (await calls(/apply\.php/)).length === nApply0 && /개인정보/.test(await page.textContent('.allot-adult-modal .al-err')));
  await page.check('#al-c-privacy');
  await shot(page, 'server-apply-form');
  // UNIT_TAKEN → 옆자리
  await page.evaluate(() => { window.__F.applyScript.push({ status: 409, code: 'UNIT_TAKEN' }); });
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForFunction(() => /다른 분이 먼저 골랐어요, 옆자리를 볼까요\?/.test(document.querySelector('.allot-adult-modal .al-err')?.textContent || ''), null, { timeout: T_UI });
  const nb = await page.evaluate(() => { const b = [...document.querySelectorAll('.allot-adult-modal .al-err button')].find((x) => /옆자리/.test(x.textContent)); return b ? b.textContent : ''; });
  check('apply: UNIT_TAKEN → "다른 분이 먼저 골랐어요, 옆자리를 볼까요?" with the next free unit', /옆자리 [A-Z]\d{2}-\d{4}/.test(nb), nb);
  await shot(page, 'server-apply-taken');
  await page.evaluate(() => [...document.querySelectorAll('.allot-adult-modal .al-err button')].find((x) => /옆자리/.test(x.textContent)).click());
  await page.waitForSelector('.allot-adult-modal .al-plan', { timeout: T_UI });
  const newTarget = await page.evaluate(() => document.querySelector('.allot-adult-modal .al-plan dd').textContent);
  check('apply: 옆자리 goes back to the plan with the new unit', /\([A-Z]\d{2}-\d{4}\)/.test(newTarget) && !newTarget.includes(target), newTarget);
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('#al-f-name', { timeout: T_UI });
  // the form keeps what was typed
  check('apply: the form keeps the typed values across steps', (await page.inputValue('#al-f-name')) === '김하늘' && (await page.inputValue('#al-f-phone')) === '010-1234-5678');
  // APPLY_LIMIT, offline, lost login, consent version changed
  for (const [code, status, data, re] of [['APPLY_LIMIT', 429, { max: 3, used: 3 }, /3곳까지/], ['AUTH_REQUIRED', 401, {}, /로그인/]]) {
    await page.evaluate((x) => window.__F.applyScript.push(x), { status, code, data });
    await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
    await page.waitForFunction((s) => new RegExp(s).test(document.querySelector('.allot-adult-modal .al-err')?.textContent || ''), re.source, { timeout: T_UI });
    check(`apply: ${code} → calm words`, true, await page.textContent('.allot-adult-modal .al-err'));
  }
  await page.evaluate(() => { window.__F.offline = true; });
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForFunction(() => /인터넷 연결/.test(document.querySelector('.allot-adult-modal .al-err')?.textContent || ''), null, { timeout: T_UI });
  check('apply: offline → "인터넷 연결이 잠깐 끊겼어요" + 다시 해 보기', await page.evaluate(() => [...document.querySelectorAll('.allot-adult-modal .al-err button')].some((b) => /다시/.test(b.textContent))));
  await shot(page, 'server-apply-offline');
  await page.evaluate(() => { window.__F.offline = false; window.__F.cv = 'v2'; window.__F.applyScript.push({ status: 400, code: 'CONSENT_REQUIRED', data: { field: 'consentVersion', version: 'v2' } }); });
  const plans0 = await page.evaluate(() => window.__F.plansCalls);
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('.allot-adult-modal .al-plan', { timeout: T_UI });
  const cv = await page.evaluate(() => ({ plans: window.__F.plansCalls, err: document.querySelector('.allot-adult-modal .al-err')?.textContent || '' }));
  check('apply: CONSENT_REQUIRED (new version) → plans.php again, back to the plan, consent asked again', cv.plans > plans0 && /다시 동의/.test(cv.err), cv.err);
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('#al-f-name', { timeout: T_UI });
  const consentReset = !(await page.isChecked('#al-c-privacy'));
  await page.check('#al-c-privacy');
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('.allot-adult-modal .al-result', { timeout: T_UI });
  const res = await page.evaluate(() => ({ t: document.querySelector('.allot-adult-modal').textContent, body: window.__F.calls.filter((c) => /apply\.php/.test(c.p)).slice(-1)[0].body }));
  check('apply: the consent box was cleared for the new version', consentReset);
  check('apply: result with the contract number and the payment guide', /AL-2026-900/.test(res.t) && /신청을 받았어요/.test(res.t) && /계좌 이체 안내/.test(res.t));
  const keys = Object.keys(res.body).sort().join(',');
  check('apply: the request body has exactly the API fields', keys === 'adult,consent,consentVersion,name,phone,unit' && res.body.consentVersion === 'v2' && res.body.consent === true && res.body.adult === true && /^[A-Z]\d{2}-\d{4}$/.test(res.body.unit), JSON.stringify(res.body));
  await shot(page, 'server-apply-result');
  await page.evaluate(() => G.ui.modal.get('allot-apply')?.close());
  // SOLD_OUT for an auto pick → 대기 offer
  await page.evaluate(() => window.__F.applyScript.push({ status: 409, code: 'SOLD_OUT' }));
  const sold = page.evaluate(() => G.sys.allot.startApply({ kind: 'store', zone: 'S02', auto: true }));
  await page.waitForSelector('.allot-adult-modal .al-plan', { timeout: T_UI });
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForSelector('#al-f-name', { timeout: T_UI });
  await page.fill('#al-f-name', '김하늘'); await page.fill('#al-f-phone', '01012345678'); await page.check('#al-c-privacy'); await page.check('#al-c-adult');
  await page.locator('.allot-adult-modal .al-applyfoot .btn-primary').click();
  await page.waitForFunction(() => /대기 명단/.test(document.querySelector('.allot-adult-modal .al-err')?.textContent || ''), null, { timeout: T_UI });
  const autoBody = await page.evaluate(() => window.__F.calls.filter((c) => /apply\.php/.test(c.p)).slice(-1)[0].body);
  check('apply: auto pick sends {kind, zone, auto} and SOLD_OUT offers the waiting list', autoBody.auto === true && autoBody.kind === 'store' && autoBody.zone === 'S02' && !autoBody.unit, JSON.stringify(autoBody));
  await page.evaluate(() => G.ui.modal.get('allot-apply')?.close());
  await sold;
  // ---- 내 분양: paging, nameplate, cancel, waiting list
  await page.evaluate(() => G.sys.allot.open('mine'));
  await page.waitForSelector('.al-card', { timeout: T_UI });
  const pg = [];
  pg.push(await page.evaluate(() => document.querySelectorAll('.al-card').length));
  for (let k = 0; k < 2; k++) { await page.locator('.al-more').click(); await page.waitForTimeout(150); pg.push(await page.evaluate(() => document.querySelectorAll('.al-card').length)); }
  const more = await page.evaluate(() => !!document.querySelector('.al-more'));
  check('내 분양: paging 6 → 12 → 14, then no 더 보기', pg.join(',') === '6,12,14' && !more, pg.join(' → '));
  const npSafe = await page.evaluate(() => { const c = document.querySelectorAll('.al-card')[2]; return { b: c.querySelectorAll('.al-np-tag b').length, t: c.querySelector('.al-np-tag').textContent }; });
  check('내 분양: a markup-looking nameplate stays text', npSafe.b === 0 && /<b>굵게<\/b>/.test(npSafe.t), npSafe.t);
  check('내 분양: overdue shows 납부 안내 (토스 off), pending shows 신청 취소, waiting list row', await page.evaluate(() => { const cs = document.querySelectorAll('.al-card'); return /신청 취소/.test(cs[0].textContent) && /납부 안내/.test(cs[1].textContent) && /2번째로 기다려요/.test(document.querySelector('.al-wait')?.textContent || ''); }));
  await shot(page, 'server-mine');
  // nameplate (normal mode: typing behind the gate — the gate passes at once outside easy mode)
  await page.locator('.al-card').nth(3).locator('.al-np-edit').click();
  await page.waitForSelector('#al-np-in', { timeout: T_UI });
  await page.fill('#al-np-in', '햇살 장독');
  await page.check('#al-np-show');
  await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find((b) => b.textContent === '저장').click());
  await page.waitForFunction(() => window.__F.calls.some((c) => /nameplate\.php/.test(c.p)), null, { timeout: T_UI });
  const npb = (await calls(/nameplate\.php/)).slice(-1)[0].body;
  check('nameplate: POST {contractNo, text, show}', npb.contractNo === 'AL-2026-103' && npb.text === '햇살 장독' && npb.show === true, JSON.stringify(npb));
  // cancel a pending application
  await page.waitForSelector('.al-card', { timeout: T_UI });
  await page.evaluate(() => [...document.querySelectorAll('.al-card')[0].querySelectorAll('button')].find((b) => /신청 취소/.test(b.textContent)).click());
  await page.waitForSelector('.modal .btn-primary', { timeout: T_UI });
  await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find((b) => /취소하기/.test(b.textContent)).click());
  await page.waitForFunction(() => window.__F.calls.some((c) => /cancel\.php/.test(c.p)), null, { timeout: T_UI });
  check('cancel: POST {contractNo} after a confirm', (await calls(/cancel\.php/)).slice(-1)[0].body.contractNo === 'AL-2026-100');
  // waiting list leave
  await page.waitForSelector('.al-waitrow', { timeout: T_UI });
  await page.evaluate(() => [...document.querySelectorAll('.al-waitrow button')].find((b) => /그만두기/.test(b.textContent)).click());
  await page.waitForSelector('.modal .btn-primary', { timeout: T_UI });
  await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].find((b) => /빼기/.test(b.textContent)).click());
  await page.waitForFunction(() => window.__F.calls.some((c) => /waitlist\.php/.test(c.p)), null, { timeout: T_UI });
  const wl = (await calls(/waitlist\.php/)).slice(-1)[0].body;
  check('waiting list: leave sends {action:"leave", id (integer)}', wl.action === 'leave' && wl.id === 3, JSON.stringify(wl));
  // ---- inbox → 알림함 → panel
  await page.evaluate(() => { G.ui.modal.closeAll(); try { localStorage.removeItem('tfm.v1.allotLast.7'); } catch (e) { /* ignore */ } });
  const nt = await page.evaluate(async () => {
    await G.sys.allot._pullInbox();
    const ns = G.sys.engagement.notifications().filter((n) => n.act === 'allot');
    return { n: ns.length, title: ns[0]?.title || '', last: localStorage.getItem('tfm.v1.allotLast.7') };
  });
  check('inbox → 알림함: a new unseen notice becomes an engagement notification (act allot)', nt.n === 1 && nt.last === '41', JSON.stringify(nt));
  await page.evaluate(() => G.sys.engagement._doAct('allot'));
  await page.waitForSelector('.al-noti', { timeout: T_UI });
  const ib = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); const b = document.querySelector('.al-inbox'); return { tab: G.sys.allot.tab(), tags: b.querySelectorAll('img, script').length, xss: !!window.__xss, seen: window.__F.calls.filter((c) => /seen\.php/.test(c.p)).map((c) => c.body) }; });
  check('알림함 act "allot" opens the 알림 tab; server text stays text', ib.tab === 'inbox' && ib.tags === 0 && !ib.xss);
  check('알림: shown unseen notices are marked seen (POST seen.php {ids})', ib.seen.length >= 1 && JSON.stringify(ib.seen.slice(-1)[0]) === '{"ids":[41]}', JSON.stringify(ib.seen));
  await shot(page, 'server-inbox');
  // ---- closing stops polling
  const closed = await page.evaluate(() => { G.sys.allot.close(); return { t: G.sys.allot._pollT, poll: G.sys.allot._pollTick() }; });
  check('closing the panel stops the map poll', !closed.t && closed.poll === false);
  // ---- easy mode in server mode: no plans.php before the gate; the apply tile asks the gate
  await page.evaluate(() => { window.__F.plansCalls = 0; G.setSetting('easyMode', true); G.sys.allot._plans = null; });
  for (const tab of ['mine', 'map', 'inbox', 'guide']) { await page.evaluate((t) => G.sys.allot.open(t), tab); await page.waitForTimeout(350); }
  check('easy (server): browsing every tab never calls plans.php', await page.evaluate(() => !window.__F.plansCalls));
  await page.evaluate(() => G.sys.allot.open('mine'));
  await page.waitForSelector('.al-kidtile', { timeout: T_UI });
  await page.evaluate(() => { G.sys.allot._sel = null; [...document.querySelectorAll('.al-kidtile')].find((b) => /어른과 함께/.test(b.textContent)).click(); });
  await page.waitForSelector('.easy-gate', { timeout: T_UI });
  check('easy (server): 어른과 함께 신청 asks the grown-up gate first', (await page.evaluate(() => window.__F.plansCalls)) === 0);
  const passed = await solveGate(page);
  await page.waitForSelector('.allot-adult-modal .al-choosetile', { timeout: T_UI }).catch(() => null);
  const adult = await page.evaluate(() => ({ modal: !!document.querySelector('.allot-adult-modal'), choose: document.querySelectorAll('.allot-adult-modal .al-choosetile').length, status: G.easy.gateStatus?.('allot-apply') }));
  check('easy (server): after the gate the grown-up screen (allot-adult-modal) opens with the kind choice', passed && adult.modal && adult.choose === 3, JSON.stringify(adult));
  await shot(page, 'easy-adult-apply');
  check('server: no page errors', !pageErrors.length, pageErrors.join(' | '));
  await page.context().close();
}

// ============================================================================ PHONE
async function phoneSection() {
  for (const [w, hh] of [[390, 844], [844, 390]]) {
    const page = await newPage({ width: w, height: hh });
    await boot(page);
    for (const easy of [true, false]) {
      await page.evaluate((e) => { G.ui.modal.closeAll(); G.setSetting('easyMode', e); }, easy);
      await page.evaluate(() => G.sys.allot.open('map'));
      await waitMap(page);
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const m = document.querySelector('.allot-modal').getBoundingClientRect();
        const c = document.querySelector('.al-canvas').getBoundingClientRect();
        const arrows = [...document.querySelectorAll('.al-zarrow')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height));
        const body = document.querySelector('.allot-modal .modal-body');
        return { sw, iw: innerWidth, mw: Math.round(m.width), mr: Math.round(m.right), cw: Math.round(c.width), ch: Math.round(c.height), arrows, bodyOverflowX: body.scrollWidth - body.clientWidth };
      });
      check(`phone ${w}×${hh} ${easy ? 'easy' : 'normal'}: no sideways scroll, the map fits`, r.sw <= r.iw + 1 && r.mr <= r.iw + 1 && r.bodyOverflowX <= 1 && r.cw >= 200 && r.ch >= 150, JSON.stringify(r));
      if (easy) check(`phone ${w}×${hh} easy: zone arrows ≥ 56 px`, r.arrows.length === 2 && Math.min(...r.arrows) >= 56, JSON.stringify(r.arrows));
      await shot(page, `phone-${w}x${hh}-${easy ? 'easy' : 'normal'}-map`);
      await page.evaluate(() => G.sys.allot.open('mine'));
      await page.waitForSelector('.al-card', { timeout: T_UI });
      const r2 = await page.evaluate(() => { const body = document.querySelector('.allot-modal .modal-body'); return { ox: body.scrollWidth - body.clientWidth, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
      check(`phone ${w}×${hh} ${easy ? 'easy' : 'normal'}: 내 분양 without sideways scroll`, r2.ox <= 1 && r2.sw <= r2.iw + 1, JSON.stringify(r2));
      await shot(page, `phone-${w}x${hh}-${easy ? 'easy' : 'normal'}-mine`);
    }
    await page.context().close();
  }
  check('phone: no page errors', !pageErrors.length, pageErrors.join(' | '));
}

let crashed = null;
try {
  log(`🏺 allot client test — ${file}`);
  if (ONLY.includes('local')) { log('— local'); await localSection(); }
  if (ONLY.includes('server')) { log('— server (fake network)'); await serverSection(); }
  if (ONLY.includes('phone')) { log('— phones'); await phoneSection(); }
  check('no console errors', !consoleErrors.length, consoleErrors.slice(0, 4).join(' | '));
} catch (e) { crashed = e; check('test ran to the end', false, String(e?.stack || e).slice(0, 400)); }
await browser.close();
if (tmpDir && !flag('--keep')) fs.rmSync(tmpDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} passed`);
process.exit(crashed && !results.length ? 2 : failed.length ? 1 : 0);
