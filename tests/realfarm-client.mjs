#!/usr/bin/env node
// =============================================================================
// tests/realfarm-client.mjs — 실시간 텃밭 · 곳간 · 완료 확인 in LOCAL mode (the file:// page, CONTRACT §15.1 – §15.3)
//
//   node tests/realfarm-client.mjs                       builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/realfarm-client.mjs --file /abs/page.html test an already built page
//   options: --keep (leave the temp build) · --json (machine-readable result) · --headed · --timeout <ms>
//            --ui-timeout <ms> (one UI step, default 30000: software WebGL on a busy machine can stall for seconds)
//
// Steps: plant → the countdown counts down by itself (panel + the label over the bed) → ready (time scale up,
//   rtfarm:ready once) → harvest → the 곳간 count · put / take / putAll / capacity · 📮 report → book entry ⏳ →
//   grown-up approval (the real parent gate is solved) with a typed memo → ✅ + memo + stamp + 알림함 · reload keeps
//   everything · the easy-mode panels have no text inputs (the note is a picture choice) · a fake server answer through
//   applyServer moves readyAt · sanitize + upgrade of an older save · 3D: four beds, the 곳간 door, the garden's colliders
//   overlap no other collider and stand on no path, no NPC home / quest marker / other interactable inside, a complete
//   walking route from the plaza to every bed and to the 곳간 door · server mode with a scripted network (G.net.request):
//   📮 body + one request per planting, a decision → stamp + 알림함 + seen.php, a markup-looking memo stays text,
//   RT_HARVEST_TOO_EARLY → calm words + farm/state.php.
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
const T_UI = Number(opt('--ui-timeout', '30000')); // one UI step (software WebGL on a busy machine can stall seconds)
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-realfarm-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--strict', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 200)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
const url = `${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low`;

async function boot() {
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.realfarm, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { G.ui.modal.closeAll(); });
}
/** the parent gate (G.easy.gate): solve 2 multiplication questions in a row, like a grown-up */
async function solveGate() {
  for (let round = 0; round < 6; round++) {
    const q = await page.waitForSelector('.easy-gate-q[aria-label]', { timeout: T_UI }).catch(() => null);
    if (!q) return false;
    const label = await q.getAttribute('aria-label');
    const m = /(\d+)\s*곱하기\s*(\d+)/.exec(label || '');
    if (!m) return false;
    const ans = String(Number(m[1]) * Number(m[2]));
    const btn = page.locator(`.easy-gate-choice[data-v="${ans}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: T_UI });
    await page.waitForFunction((v) => { const b = document.querySelector(`.easy-gate-choice[data-v="${v}"]`); return !!b && !b.disabled; }, ans, { timeout: T_UI, polling: 100 });
    await btn.click();
    await page.waitForTimeout(450);
    const still = await page.evaluate(() => !!G.ui.modal.get('easy-gate'));
    if (!still) return true;
  }
  return false;
}

try {
  log(`🌱 real-time farm client test — ${file}`);
  await boot();
  check('fragment loaded (G.sys.realfarm / G.sys.storage)', await page.evaluate(() => !!G.sys.realfarm && !!G.sys.storage && typeof G.sys.realfarm.applyServer === 'function'));
  check('local mode', await page.evaluate(() => G.net.mode === 'local'));

  // ---------------------------------------------------------------- state: sanitize + upgrade of an older save
  const st = await page.evaluate(() => {
    const N = G.save.normalize;
    const old = N({ version: 1, stats: { level: 4, coin: 777 }, inventory: { ITEM_BEAN: 2 }, farm: { plots: {} }, flags: { x: true } }, { id: 't' });
    const t = Date.now();
    const bad = N({ version: 1, rtfarm: { beds: { RB1: { cropId: 'CROP_MINT', pid: 'ABC', plantedAt: t, readyAt: t + 1 }, RB9: {} }, last: Array.from({ length: 11 }, (_, i) => ({ pid: (i.toString(16) + 'a'.repeat(15)).slice(0, 16), bedId: 'RB2', cropId: 'CROP_MINT', amount: 2, stars: 1, at: t + i })), scale: 99 }, storage: { items: { ITEM_MINT: 280, ITEM_KIMCHI: 90, ITEM_SALT: 4 } } }, { id: 't' });
    return {
      upgraded: !!old.rtfarm && !!old.storage && old.stats.rtHarvests === 0 && old.stats.coin === 777 && old.inventory.ITEM_BEAN === 2 && old.flags.x === true,
      dropped: Object.keys(bad.rtfarm.beds).length === 0 && !('scale' in bad.rtfarm),
      last8: bad.rtfarm.last.length === 8,
      cap: Object.values(bad.storage.items).reduce((a, b) => a + b, 0) <= 300 && !('ITEM_SALT' in bad.storage.items),
    };
  });
  check('older save upgrades and keeps everything', st.upgraded);
  check('sanitize drops a bad pid / unknown bed / local-only key', st.dropped);
  check('sanitize keeps the newest 8 harvests', st.last8);
  check('sanitize keeps the 곳간 within its cap and storable ids', st.cap);

  // ---------------------------------------------------------------- plant → countdown each second
  const planted = await page.evaluate(() => {
    const ev = [];
    G.bus.on('rtfarm:planted', (p) => ev.push(p));
    G.bus.on('rtfarm:ready', (p) => (window.__rtReady = (window.__rtReady || []).concat([p])));
    const ok = G.sys.realfarm.plant('RB1', 'CROP_MINT');
    const b = G.state.rtfarm.beds.RB1;
    return { ok, ev, b, status: G.sys.realfarm.bed('RB1').status, dur: b && b.readyAt - b.plantedAt };
  });
  check('plant RB1 박하 (10 min at scale 1)', planted.ok && planted.status === 'growing' && Math.abs(planted.dur - 600000) < 5, `dur ${planted.dur}`);
  check('rtfarm:planted with a 16-hex pid', planted.ev.length === 1 && /^[0-9a-f]{16}$/.test(planted.ev[0].pid) && planted.ev[0].readyAt === planted.b.readyAt);
  await page.evaluate(() => { G.easy?.set ? G.setSetting('easyMode', false) : G.setSetting('easyMode', false); G.sys.realfarm.open('RB1'); });
  await page.waitForSelector('.rt-bed-modal .rf-left', { timeout: T_UI });
  const t1 = await page.textContent('.rt-bed-modal .rf-left');
  const c1 = await page.textContent('.rt-bed-modal .rf-clock');
  // the next second shows without any action (a busy machine may need a while to paint it)
  await page.waitForFunction((v) => document.querySelector('.rt-bed-modal .rf-left')?.textContent !== v, t1, { timeout: T_UI, polling: 100 }).catch(() => null);
  const t2 = await page.textContent('.rt-bed-modal .rf-left');
  const truth = await page.evaluate(() => Math.ceil(G.sys.realfarm.bed('RB1').leftMs / 1000));
  const secs = (s) => { const m = /^(\d+):(\d\d) 남음$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  check('panel countdown counts down by itself (from the timestamps)', t1 !== t2 && secs(t2) < secs(t1) && Math.abs(secs(t2) - truth) <= 3, `${t1} → ${t2} (now ${truth} s left)`);
  check('wall-clock line "… 다 자라요"', /^(내일 |모레 )?(오전|오후) \d{1,2}시( \d{1,2}분)?에 다 자라요$/.test(c1 || ''), c1);
  const lab = await page.evaluate(() => { const el = document.querySelector('.rf-label .rf-l-txt'); return el ? el.textContent : null; });
  if (lab != null) {
    await page.waitForFunction((v) => document.querySelector('.rf-label .rf-l-txt')?.textContent !== v, lab, { timeout: T_UI, polling: 100 }).catch(() => null);
    const lab2 = await page.evaluate(() => document.querySelector('.rf-label .rf-l-txt').textContent);
    check('bed label "박하 · 9:58 남음" counts down by itself', lab !== lab2 && /^박하 · \d+:\d\d 남음$/.test(lab2), `${lab} → ${lab2}`);
  } else check('bed label (3D garden in the layout)', false, 'no .rf-label — layout.rtBeds missing');

  // ---------------------------------------------------------------- ready (time scale up) → harvest → 곳간
  const ready = await page.evaluate(async () => {
    G.sys.realfarm.setScale(3600);
    await new Promise((r) => setTimeout(r, 1600));
    return { status: G.sys.realfarm.bed('RB1').status, ev: (window.__rtReady || []).length, flag: G.state.flags['rt:ready:RB1'] === G.state.rtfarm.beds.RB1?.pid };
  });
  check('time scale ×3600 → ready', ready.status === 'ready');
  check('rtfarm:ready fired once for the planting', ready.ev === 1 && ready.flag, `events ${ready.ev}`);
  const harvested = await page.evaluate(() => {
    const before = G.sys.storage.count('ITEM_MINT');
    const ev = [];
    const off = G.bus.on('rtfarm:harvested', (p) => ev.push(p));
    const r = G.sys.realfarm.harvest('RB1');
    off();
    return { r, before, after: G.sys.storage.count('ITEM_MINT'), rt: G.state.stats.rtHarvests, harv: G.state.stats.harvests, last: G.state.rtfarm.last.slice(-1)[0], bed: G.state.rtfarm.beds.RB1 || null, ev };
  });
  check('harvest → items in the 곳간', harvested.r && harvested.after - harvested.before === harvested.r.amount && harvested.r.amount >= 3 && harvested.r.toStorage === harvested.r.amount, JSON.stringify(harvested.r));
  check('harvest: stats.rtHarvests 1, quick-plot harvests untouched, bed empty', harvested.rt === 1 && harvested.harv === 0 && !harvested.bed);
  check('harvest: last entry + rtfarm:harvested', harvested.last && harvested.last.amount === harvested.r.amount && harvested.ev.length === 1 && harvested.ev[0].pid === harvested.last.pid);
  await page.evaluate(() => G.sys.realfarm.setScale(1));

  // ---------------------------------------------------------------- put / take / putAll / capacity
  const sto = await page.evaluate(() => {
    const S = G.sys.storage, I = G.sys.inventory;
    const mint0 = S.count('ITEM_MINT');
    const took = S.take('ITEM_MINT', 2);
    const bagMint = I.count('ITEM_MINT');
    const put = S.put('ITEM_MINT', 1);
    const notStorable = S.put('ITEM_SALT', 1);
    I.add('ITEM_BEAN', 250, { silent: true });
    I.add('ITEM_KIMCHI', 120, { silent: true });
    const moved = S.putAll();
    const total = S.total(), free = S.free(), cap = S.cap();
    const leftBean = I.count('ITEM_BEAN'), leftKimchi = I.count('ITEM_KIMCHI');
    const events = [];
    const off = G.bus.on('storage:changed', (p) => events.push(p));
    const full = S.put('ITEM_BEAN', 1);
    S.take('ITEM_BEAN', 1);
    off();
    return { mint0, took, bagMint, put, notStorable, moved, total, free, cap, leftBean, leftKimchi, full, events };
  });
  check('take 2 → bag', sto.took === 2 && sto.bagMint === 2);
  check('put 1 back', sto.put === 1);
  check('a non-storable item is refused', sto.notStorable === 0);
  check('putAll fills to the cap (300)', sto.total === 300 && sto.free === 0 && sto.cap === 300, JSON.stringify({ moved: sto.moved, total: sto.total }));
  check('capacity: the rest stays in the bag, a full 곳간 takes nothing', sto.leftBean + sto.leftKimchi > 0 && sto.full === 0);
  check('storage:changed {itemId, delta, total}', sto.events.length === 1 && sto.events[0].delta === -1 && sto.events[0].total === 299, JSON.stringify(sto.events));
  await page.evaluate(() => { const S = G.sys.storage; S.take('ITEM_BEAN', 300); S.take('ITEM_KIMCHI', 300); });

  // ---------------------------------------------------------------- 📮 report → book ⏳ → grown-up approval with a memo
  const rep = await page.evaluate(async () => {
    const ev = [];
    const off = G.bus.on('rtfarm:report', (p) => ev.push(p));
    const r = await G.sys.realfarm.report('RB1', '물을 열심히 줬어요!');
    const dup = await G.sys.realfarm.report('RB1');
    off();
    return { r, dup: dup && dup.id, ev, n: G.state.rtfarm.reports.length };
  });
  check('report RB1 (harvested today) → a local request', rep.r && rep.r.status === 'pending' && rep.r.source === 'local' && rep.r.kind === 'rt' && rep.r.note === '물을 열심히 줬어요!', JSON.stringify(rep.r));
  check('one request per planting', rep.dup === rep.r.id && rep.n === 1 && rep.ev.length === 1);
  await page.evaluate(() => { G.ui.modal.closeAll(); G.setSetting('easyMode', true); G.sys.realfarm.openBook(); });
  await page.waitForSelector('.rt-book-modal .rf-book-card', { timeout: T_UI });
  check('book shows ⏳ 확인 기다리는 중', (await page.textContent('.rt-book-modal .rf-book-card .rf-chip')).includes('⏳'));
  await page.click('.rt-book-modal .rf-adult');
  const gateOk = await solveGate();
  check('the grown-up gate opens for 어른 확인 (solved)', gateOk);
  await page.waitForSelector('.rt-adult-modal textarea.rf-memo', { timeout: T_UI });
  await page.fill('.rt-adult-modal textarea.rf-memo', '정말 잘 키웠어요! 다음엔 라벤더도 키워 봐요.');
  // G.fx is a frozen facade over the fx system: record the system's stamp() calls
  await page.evaluate(() => { window.__stamps = []; const sys = G.sys.fx; const f = sys.stamp; sys.stamp = function (txt, o) { window.__stamps.push({ txt, el: false }); const r = f.apply(this, arguments); window.__stamps[window.__stamps.length - 1].el = !!document.querySelector('.fx-stamp'); return r; }; });
  await page.click('.rt-adult-modal .rf-adult-ok');
  await page.waitForFunction(() => G.state.rtfarm.reports[0]?.status === 'approved', null, { timeout: T_UI, polling: 100 });
  const stamps = await page.evaluate(() => window.__stamps || []);
  const stamped = stamps.some((s) => s.txt === '참 잘했어요!' && s.el);
  await page.waitForFunction(() => document.querySelector('.rt-book-modal .rf-book-card.approved'), null, { timeout: T_UI, polling: 100 });
  const card = await page.evaluate(() => { const c = document.querySelector('.rt-book-modal .rf-book-card'); return { chip: c.querySelector('.rf-chip').textContent, memo: c.querySelector('.rf-bc-memo p')?.textContent, stamp: !!c.querySelector('.rf-stamp') }; });
  check('book shows ✅ + the memo + the stamp', card.chip.includes('✅') && card.memo === '정말 잘 키웠어요! 다음엔 라벤더도 키워 봐요.' && card.stamp, JSON.stringify(card));
  check('decision → stamp animation (G.fx.stamp "참 잘했어요!")', stamped, JSON.stringify(stamps));
  const inbox = await page.evaluate(() => (G.sys.engagement?.notifications?.() || []).filter((n) => n.act === 'rtbook').length);
  check('decision → an entry in the 알림함', inbox >= 1, `rtbook notifications ${inbox}`);
  check('decision marked seen (local)', await page.evaluate(() => G.state.rtfarm.reports[0].seen === true));

  // ---------------------------------------------------------------- easy-mode panels: no text inputs
  const inputs = await page.evaluate(async () => {
    const out = {};
    const count = () => document.querySelectorAll('.modal input[type=text], .modal input:not([type]), .modal textarea').length;
    G.ui.modal.closeAll();
    G.setSetting('easyMode', true);
    await new Promise((r) => setTimeout(r, 300));
    G.sys.realfarm.open('RB2'); await new Promise((r) => setTimeout(r, 400)); out.bedEmpty = count();
    G.sys.realfarm.plant('RB2', 'CROP_RADISH'); G.ui.modal.closeAll(); G.sys.realfarm.open('RB2'); await new Promise((r) => setTimeout(r, 400)); out.bedGrowing = count();
    G.ui.modal.closeAll(); G.sys.storage.open(); await new Promise((r) => setTimeout(r, 400)); out.storage = count();
    G.ui.modal.closeAll(); G.sys.realfarm.openBook(); await new Promise((r) => setTimeout(r, 400)); out.book = count();
    G.ui.modal.closeAll();
    return out;
  });
  check('easy mode: bed / 곳간 / book panels have no text inputs', Object.values(inputs).every((n) => n === 0), JSON.stringify(inputs));
  const notePick = await page.evaluate(async () => {
    G.sys.realfarm.plant('RB3', 'CROP_MINT'); G.sys.realfarm.setScale(3600); await new Promise((r) => setTimeout(r, 1300)); G.sys.realfarm.setScale(1);
    const p = G.sys.realfarm._reportFlow('RB3');
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelector('.rt-note-pick');
    const res = { picker: !!m, inputs: m ? m.querySelectorAll('input, textarea').length : -1, tiles: m ? m.querySelectorAll('.easy-tile').length : 0 };
    m?.querySelector('.easy-tile')?.click();
    const r = await p;
    res.note = r && r.note;
    return res;
  });
  check('easy mode: the note is one of rtfarm.reportNotes (picture picker, no typing)', notePick.picker && notePick.inputs === 0 && notePick.tiles >= 5 && notePick.note === '물을 열심히 줬어요!', JSON.stringify(notePick));

  // ---------------------------------------------------------------- applyServer: a fake server answer moves readyAt
  const srv = await page.evaluate(() => {
    const b = G.state.rtfarm.beds.RB2;
    const t = G.time.now();
    const rt = { scale: 1, tier: 1, beds: { RB2: { pid: b.pid, cropId: b.cropId, firstSeenAt: t - 4000, readyAt: t + 3600000, status: 'growing' }, RB4: { pid: '0123456789abcdef', cropId: 'CROP_MINT', firstSeenAt: t, readyAt: t, status: 'ready' } } };
    const moved = G.sys.realfarm.applyServer(rt);
    const again = G.sys.realfarm.applyServer(rt);
    const b2 = G.state.rtfarm.beds.RB2;
    return { moved, again, readyAt: b2.readyAt, want: t + 3600000, plantedAt: b2.plantedAt, dur: b2.dur, rb4: !!G.state.rtfarm.beds.RB4 };
  });
  check('applyServer adopts the server readyAt / firstSeenAt (matching pid only)', srv.moved === 1 && srv.readyAt === srv.want && srv.dur === srv.readyAt - srv.plantedAt && !srv.rb4, JSON.stringify(srv));
  check('applyServer: no change within 1 s (no save loop)', srv.again === 0);

  // ---------------------------------------------------------------- 3D: beds, the 곳간 door, no collider overlap
  const world = await page.evaluate(() => {
    const L = G.data.layout;
    const ids = (L.rtBeds || []).map((b) => b.id);
    const ia = ['RTBED_RB1', 'RTBED_RB2', 'RTBED_RB3', 'RTBED_RB4', 'GOTGAN_DOOR'].map((id) => G.interact?.get?.(id));
    const kinds = ia.map((e) => e && e.kind);
    const garden = G.sys.buildings?.get?.('B_RTGARDEN'), gotgan = G.sys.buildings?.get?.('B_GOTGAN');
    // collider overlap: the garden's / 곳간's own colliders against every other collider (circles / boxes as discs)
    const own = new Set(['B_RTGARDEN', 'B_GOTGAN']);
    const cols = Array.from(G.world.colliders.values());
    const R = (c) => (c.shape === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
    const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < R(a) + R(b);
    // exact box-box / box-circle test in the XZ plane (separating axis)
    const corners = (c) => { const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [c.x + sx * c.hw * cs + sz * c.hd * sn, c.z - sx * c.hw * sn + sz * c.hd * cs]); };
    const overlap = (a, b) => {
      if (!near(a, b)) return false;
      if (a.shape === 'circle' && b.shape === 'circle') return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r - 0.02;
      const box = a.shape === 'box' ? a : b, other = box === a ? b : a;
      const cs = Math.cos(box.rot || 0), sn = Math.sin(box.rot || 0);
      const loc = (x, z) => { const dx = x - box.x, dz = z - box.z; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
      if (other.shape === 'circle') { const [lx, lz] = loc(other.x, other.z); const qx = Math.max(-box.hw, Math.min(box.hw, lx)), qz = Math.max(-box.hd, Math.min(box.hd, lz)); return Math.hypot(lx - qx, lz - qz) < other.r - 0.02; }
      const axes = [];
      for (const c of [a, b]) { const c0 = Math.cos(c.rot || 0), s0 = Math.sin(c.rot || 0); axes.push([c0, -s0], [s0, c0]); }
      const pa = corners(a), pb = corners(b);
      for (const [ax, az] of axes) {
        const p = (pts) => pts.map(([x, z]) => x * ax + z * az);
        const A = p(pa), B = p(pb);
        if (Math.max(...A) <= Math.min(...B) + 0.02 || Math.max(...B) <= Math.min(...A) + 0.02) return false;
      }
      return true;
    };
    const mine = cols.filter((c) => own.has(c.tag)), others = cols.filter((c) => !own.has(c.tag) && c.tag !== 'terrain');
    const hits = [];
    for (const a of mine) for (const b of others) if (overlap(a, b)) hits.push(`${a.tag}@${a.x.toFixed(1)},${a.z.toFixed(1)} × ${b.tag}@${b.x.toFixed(1)},${b.z.toFixed(1)}`);
    // paths: no garden / 곳간 collider on a path
    const T = G.sys.terrain;
    const onPath = mine.filter((c) => T?.pathDistance && T.pathDistance(c.x, c.z) < 0.3).map((c) => `${c.tag}@${c.x.toFixed(1)},${c.z.toFixed(1)}`);
    // the two footprints (world rects) — NPC homes (+ their wander circle), quest markers and every other
    // interactable stay outside them
    const rg = L.rtGarden, gb = L.buildings.find((b) => b.id === 'B_GOTGAN');
    const rects = [
      { id: 'garden', x0: rg.x - rg.sx / 2, x1: rg.x + rg.sx / 2, z0: rg.z - rg.sz / 2, z1: rg.z + rg.sz / 2 },
      // the 곳간 is turned a quarter (rot −π/2): its width runs along z, its depth along x
      { id: 'gotgan', x0: gb.x - gb.d / 2, x1: gb.x + gb.d / 2, z0: gb.z - gb.w / 2, z1: gb.z + gb.w / 2 },
    ];
    const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
    const crowd = [];
    for (const rec of (G.sys.npc?.list?.() || [])) {
      const h = rec.home;
      if (!h) continue;
      for (const r of rects) if (rectDist(r, h.x, h.z) < (h.wander || 0) + 0.6) crowd.push(`npc ${rec.id} × ${r.id}`);
    }
    for (const m of (G.sys.quest?.getMarkers?.() || [])) for (const r of rects) if (rectDist(r, m.x, m.z) < 1) crowd.push(`marker ${m.label || m.questId} × ${r.id}`);
    const mineIa = /^(RTBED_|GOTGAN_DOOR$)/;
    for (const e of (G.interact?.list?.() || [])) {
      if (mineIa.test(e.id) || /^NPC|^npc/.test(e.id) || e.kind === 'npc') continue;
      const p = typeof e.position === 'function' ? e.position() : e.position;
      if (!p) continue;
      for (const r of rects) if (rectDist(r, p.x, p.z) < 0.5) crowd.push(`interactable ${e.id} × ${r.id}`);
    }
    // walkable: a complete route from the plaza to every bed (close enough to tend it) and to the 곳간 door
    const hub = L.plazaSpawn || L.plaza || { x: 0, z: 9 }; // the old start spot (standable; the plaza centre holds a monument)
    const reach = (x, z, goalR) => {
      const p = G.sys.player?.planPath?.({ x: hub.x, z: hub.z }, { x, z }, goalR);
      if (!p || p.length < 2) return 'no route';
      const e = p[p.length - 1];
      const d = Math.hypot(e.x - x, e.z - z);
      return d <= goalR + 0.01 ? 'ok' : `stops ${d.toFixed(2)} m away`;
    };
    const walk = {};
    for (const b of L.rtBeds || []) walk[b.id] = reach(b.x, b.z, 2.4);
    walk.door = L.gotganDoor ? reach(L.gotganDoor.x, L.gotganDoor.z, 1.0) : 'no door';
    return { ids, kinds, garden: !!garden, gotgan: !!gotgan, mine: mine.length, hits: hits.slice(0, 8), onPath: onPath.slice(0, 8), crowd: crowd.slice(0, 8), walk };
  });
  check('layout.rtBeds RB1–RB4', JSON.stringify(world.ids) === '["RB1","RB2","RB3","RB4"]', JSON.stringify(world.ids));
  check('interactables rtbed ×4 + storage (곳간 door)', JSON.stringify(world.kinds) === '["rtbed","rtbed","rtbed","rtbed","storage"]', JSON.stringify(world.kinds));
  check('3D: the garden B_RTGARDEN and the 곳간 B_GOTGAN are built', world.garden && world.gotgan && world.mine > 8, `colliders ${world.mine}`);
  check('no garden / 곳간 collider overlaps another collider', world.hits.length === 0, world.hits.join(' · '));
  check('no garden / 곳간 collider stands on a path', world.onPath.length === 0, world.onPath.join(' · '));
  check('no NPC home, quest marker or other interactable inside the garden / 곳간', world.crowd.length === 0, world.crowd.join(' · '));
  check('the player can walk from the plaza to every bed and to the 곳간 door', Object.values(world.walk).every((v) => v === 'ok') && Object.keys(world.walk).length === 5, JSON.stringify(world.walk));

  // ---------------------------------------------------------------- server mode with a scripted network (interfaces 2/3):
  // 📮 → POST farm/report.php, one request per planting, a teacher's decision from farm/reports.php → stamp + 알림함 +
  // POST farm/seen.php, a memo that looks like markup stays text, RT_HARVEST_TOO_EARLY → calm words + farm/state.php
  const srvMode = await page.evaluate(async () => {
    const R = G.sys.realfarm;
    G.ui.modal.closeAll();
    // RB4: a ready planting (its times set by hand — the time scale of the other beds stays as it is)
    R.plant('RB4', 'CROP_MINT');
    const t = G.time.now(), b4 = G.state.rtfarm.beds.RB4;
    b4.plantedAt = t - b4.dur - 1000; b4.readyAt = t - 1000;
    const calls = [];
    const o = { req: G.net.request, mode: G.net.mode, ad: G.save.adapter, save: G.save.save };
    let answer = { reports: [], unseen: 0 };
    const toasts = [];
    const offT = G.bus.on('ui:toast', (p) => toasts.push(p && (p.text || p.message || p)));
    G.net.request = async (p, opts = {}) => {
      calls.push({ p, body: opts.body ? JSON.parse(JSON.stringify(opts.body)) : null });
      if (p === 'farm/report.php') {
        const b = opts.body || {};
        return { report: { id: 77, kind: b.kind, bedId: b.bedId, pid: b.pid, cropId: 'CROP_MINT', stars: 1, amount: 0, note: b.note || '', status: 'pending', memo: '', requestedAt: G.time.now(), decidedAt: 0, seen: false, photoUrl: null } };
      }
      if (p === 'farm/reports.php') return JSON.parse(JSON.stringify(answer));
      if (p === 'farm/seen.php') return { updated: 1, unseen: 0 };
      if (p === 'farm/state.php') return { scale: 1, tier: 1, beds: [], storage: { items: {}, total: 0, cap: 300 }, reports: { pending: 0, unseen: 0 } };
      return {};
    };
    G.save.save = async () => true;
    G.net.mode = 'server'; G.save.adapter = G.save.ServerAdapter;
    const out = {};
    try {
      const rep = await R.report('RB4', '쑥쑥 자라서 기뻐요!');
      const again = await R.report('RB4');
      const posts = calls.filter((c) => c.p === 'farm/report.php');
      out.report = { id: rep && rep.id, again: again && again.id, posts: posts.length, body: posts[0] && posts[0].body };
      // the teacher approves; the memo tries to be markup
      answer = { reports: [{ ...rep, status: 'approved', memo: '<img src=x onerror="window.__xss=1">참 잘 키웠어요', decidedAt: G.time.now() + 500 }], unseen: 1 };
      window.__stamps = [];
      await R.refreshReports({ quiet: true });
      R.openBook();
      await new Promise((r) => setTimeout(r, 300));
      const card = document.querySelector('.rt-book-modal .rf-book-card');
      out.book = { memo: card?.querySelector('.rf-bc-memo p')?.textContent || null, img: !!document.querySelector('.rt-book-modal img[src="x"]'), xss: !!window.__xss };
      out.stamp = (window.__stamps || []).map((s) => s.txt);
      out.seen = calls.filter((c) => c.p === 'farm/seen.php').map((c) => c.body);
      out.inbox = (G.sys.engagement?.notifications?.() || []).filter((n) => n.key === 'rtfarm:77').length;
      // a second poll with the same answer celebrates nothing new
      window.__stamps = [];
      await R.refreshReports({ quiet: true });
      out.again = (window.__stamps || []).length;
      // the save was refused because the server says the crop is not ready yet
      out.refused = R.onSaveRefused(['RT_HARVEST_TOO_EARLY']);
      await new Promise((r) => setTimeout(r, 200));
      out.state = calls.some((c) => c.p === 'farm/state.php');
    } finally {
      G.net.request = o.req; G.net.mode = o.mode; G.save.adapter = o.ad; G.save.save = o.save;
      offT?.();
      G.ui.modal.closeAll();
    }
    out.toasts = toasts.slice(-4);
    return out;
  });
  check('server mode: 📮 posts {kind, bedId, pid, note} once per planting', srvMode.report.id === 77 && srvMode.report.again === 77 && srvMode.report.posts === 1 && srvMode.report.body?.kind === 'rt' && srvMode.report.body?.bedId === 'RB4' && /^[0-9a-f]{16}$/.test(srvMode.report.body?.pid || '') && srvMode.report.body?.note === '쑥쑥 자라서 기뻐요!', JSON.stringify(srvMode.report));
  check('server mode: a teacher\'s decision → stamp + 알림함 + seen.php {ids:[77]} (once)', srvMode.stamp.length === 1 && srvMode.inbox === 1 && JSON.stringify(srvMode.seen) === '[{"ids":[77]}]' && srvMode.again === 0, JSON.stringify({ stamp: srvMode.stamp, inbox: srvMode.inbox, seen: srvMode.seen, again: srvMode.again }));
  check('server mode: a memo that looks like markup stays text in the book', srvMode.book.memo === '<img src=x onerror="window.__xss=1">참 잘 키웠어요' && !srvMode.book.img && !srvMode.book.xss, JSON.stringify(srvMode.book));
  check('server mode: RT_HARVEST_TOO_EARLY → handled calmly + farm/state.php re-read', srvMode.refused === true && srvMode.state, JSON.stringify({ refused: srvMode.refused, state: srvMode.state }));

  // ---------------------------------------------------------------- reload keeps everything
  const before = await page.evaluate(async () => { await G.save.save({ reason: 'test' }); return { mint: G.sys.storage.count('ITEM_MINT'), rt: G.state.stats.rtHarvests, rep: G.state.rtfarm.reports.map((r) => [r.id, r.status, r.memo]), beds: Object.keys(G.state.rtfarm.beds).sort(), rb2: G.state.rtfarm.beds.RB2?.readyAt, flag: G.state.flags['rt:ready:RB1'] }; });
  await boot();
  const after = await page.evaluate(() => ({ mint: G.sys.storage.count('ITEM_MINT'), rt: G.state.stats.rtHarvests, rep: G.state.rtfarm.reports.map((r) => [r.id, r.status, r.memo]), beds: Object.keys(G.state.rtfarm.beds).sort(), rb2: G.state.rtfarm.beds.RB2?.readyAt, flag: G.state.flags['rt:ready:RB1'] }));
  check('reload keeps the 곳간, rtHarvests, requests (+memo), beds, server times, ready flag', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  const noRepeat = await page.evaluate(async () => { const n = []; G.bus.on('rtfarm:ready', (p) => n.push(p)); await new Promise((r) => setTimeout(r, 1300)); return n.filter((p) => p.bedId === 'RB1').length; });
  check('no second rtfarm:ready for an announced planting after reload', noRepeat === 0);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('test run', false, String(e?.stack || e));
} finally {
  await browser.close();
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
else console.log(`\n${failed.length ? '✖' : '✔'} realfarm-client: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
