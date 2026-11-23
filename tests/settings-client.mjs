#!/usr/bin/env node
// =============================================================================
// tests/settings-client.mjs — CONTRACT §18.2 the settings window in the browser (lane settings):
//   Part A (local page, normal mode, 1280 × 720): the ⚙️ 설정 button beside 음성 · the window with its twelve tabs, every
//     tab drawn without an error · the sound rows (0 – 100, 100 = the balanced level) change the mixer of 61-audio and the
//     ui / voice channels · 화면 구성 (UI 크기 4 steps ↔ uiScale, 글자 크기 5 steps → --text-k, 캐릭터 크기 → the rig's drawn
//     size and the camera height, name plates, minimap size, HUD / chat opacity, high contrast) · the old panes are inside
//     (조작 tiles, 아이 보호, 계정 …) · search (registry rows, rows of the old panes, help topics) · 이 칸 기본값으로 · keys
//     (G.input.bindings: rebind, conflict notice, reset; or the fixed table) · 도움말 (≥ 20 topics with the current keys,
//     처음 안내, the Ctrl card) · TEN options changed → reload → still set.
//   Part B (easy mode): ⚙️ in the easy bar opens the child's simple controls; the full window only behind the gate.
//   Part C (phones 390 × 844 and 844 × 390, touch): one column, no sideways scrolling, the touch layout rows apply.
//   Part D (a private server copy, php -S): change account and device options → saved to the account (api/settings) →
//     a FRESH browser (another device) logs in with the same account → the account-scope values are set there, the
//     device-scope ones of the first device are not.
//   Screenshots of every tab (desktop, easy, 390 × 844, 844 × 390) and the bottom bar with --shots <dir>.
//
//   node tests/settings-client.mjs [--file /abs/page.html] [--shots <dir>] [--json] [--headed] [--timeout <ms>]
//        [--skip-phone] [--no-server] [--only a,b,c,d]
//   Run it through the shared browser lock (at most two browsers on the build machine).
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
const TIMEOUT = Number(opt('--timeout', '300000'));
const jsonOut = flag('--json');
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const want = (g) => !only.length || only.includes(g);
const log = (...a) => { if (!jsonOut) console.log(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = opt('--shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-settings-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
async function open(tag, ctxOpts, base) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 720 }, ...ctxOpts });
  const page = await context.newPage();
  await page.route('**/*', (route) => { const u = route.request().url(); return /^(file|data|blob):/.test(u) || (base && u.startsWith(base)) ? route.continue() : route.abort(); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  return { page, context };
}
async function boot(page, extra = '') {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low${extra}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
}
const shot = async (page, name) => { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 120000 }); } catch (e) { log(`  (screenshot ${name} failed: ${e.message})`); } };
/** normal (grown-up) mode without the gate */
const normalMode = (page) => page.evaluate(async () => { G.setSetting('parentGate', false); if (G.easy?.set) await G.easy.set(false); else G.setSetting('easyMode', false); await new Promise((r) => setTimeout(r, 300)); return !G.easy?.on; });
const TABS = ['graphics', 'display', 'sound', 'controls', 'layout', 'game', 'access', 'kids', 'account', 'data', 'help', 'credits'];
/** every tab of the open window: drawn without an error message, rows counted, optional screenshots */
async function walkTabs(page, tag) {
  const out = [];
  for (const id of TABS) {
    const r = await page.evaluate(async (id) => {
      const tab = document.querySelector(`.set-window .sw-tabs .tab[data-tab="${id}"]`);
      if (!tab) return { id, missing: true };
      tab.click();
      await new Promise((r) => setTimeout(r, 250));
      const pane = document.querySelector('.set-window .set-pane');
      const txt = pane?.textContent || '';
      const sw = document.querySelector('.set-window .modal-body');
      return { id, rows: pane ? pane.querySelectorAll('.set-row, .sw-hcard, .kt-row, dl').length : 0, failed: /표시하지 못했어요/.test(txt), overflow: sw ? sw.scrollWidth - sw.clientWidth : 0, sel: tab.getAttribute('aria-selected') };
    }, id);
    out.push(r);
    await shot(page, `${tag}-${id}`);
  }
  return out;
}

// ================================================================================================ part A
async function partA() {
  const { page, context } = await open('desktop');
  await boot(page);
  const nm = await normalMode(page);
  check('A: normal mode for the grown-up window', nm === true);
  // the bottom bar: ⚙️ 설정 right after 음성
  const bar = await page.evaluate(() => {
    const v = document.querySelector('#bottom-bar [data-action="voice"]');
    const s = document.querySelector('#bottom-bar [data-action="settings"]');
    const r = s?.getBoundingClientRect();
    return { next: v?.nextElementSibling === s, shown: !!r && r.width > 20 && getComputedStyle(s).display !== 'none', label: s?.textContent.trim() };
  });
  check('A: the bottom bar has ⚙️ 설정 right beside 음성', bar.next && bar.shown && /설정/.test(bar.label), JSON.stringify(bar));
  if (SHOTS) { try { await page.locator('#bottom-bar').screenshot({ path: path.join(SHOTS, 'bottom-bar-normal.png') }); } catch (e) { /* optional */ } }
  await page.evaluate(() => document.querySelector('#bottom-bar [data-action="settings"]').click());
  await page.waitForSelector('.set-window .sw-tabs .tab', { timeout: 60000 });
  const win = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.set-window .sw-tabs .tab')].map((b) => b.dataset.tab), search: !!document.querySelector('.set-window input.sw-search'), title: document.querySelector('.set-window .modal-head h2')?.textContent }));
  check('A: the button opens the settings window with twelve tabs and a search box', win.tabs.length === 12 && win.search && TABS.every((t) => win.tabs.includes(t)), win.tabs.join(','));
  const tabs = await walkTabs(page, 'desktop');
  check('A: every tab is drawn without an error and has rows', tabs.every((t) => !t.missing && !t.failed && t.sel === 'true' && (t.rows > 0 || t.id === 'display' || t.id === 'credits')), tabs.map((t) => `${t.id}:${t.rows}${t.failed ? '!' : ''}`).join(' '));

  // sound rows
  const snd = await page.evaluate(async () => {
    const S = G.sys.settings, A = G.sys.audio;
    const ids = ['mixMaster', 'mixMusic', 'mixSfx', 'mixUi', 'mixVoice', 'mixNature'];
    const defs = ids.map((id) => S.def(id));
    const d0 = A.channels();
    S.set('mixMusic', 40); S.set('mixUi', 0); S.set('mixVoice', 60);
    const d1 = A.channels();
    const uiMuted = A.play('click', { force: true }) === false || !A.ctx;
    const tests = typeof A.testChannel === 'function';
    S.reset('sound');
    return { all: defs.every((d) => d && d.min === 0 && d.max === 100 && d.default === 100), d0, d1, uiMuted, tests, back: A.channels().music };
  });
  check('A: six sound rows 0 – 100 with 100 as default; 100 = the balanced level (factor 1)', snd.all && Object.values(snd.d0).every((v) => v === 1), JSON.stringify(snd.d0));
  check('A: the rows change the mixer (music 40 → factor < 1, UI 0 → the ui channel is silent, voice 60)', snd.d1.music < 0.3 && snd.d1.ui === 0 && snd.d1.voice < 0.5 && snd.uiMuted && snd.tests, JSON.stringify(snd.d1));
  check('A: 이 칸 기본값으로 (sound) brings the mixer back', snd.back === 1);

  // 화면 구성
  const lay = await page.evaluate(async () => {
    const S = G.sys.settings, P = G.sys.player;
    const h0 = P.rig.height, fs0 = parseFloat(getComputedStyle(document.documentElement).fontSize);
    S.set('uiStep', 3); const ui = G.settings.uiScale, fs = getComputedStyle(document.documentElement).fontSize;
    S.set('textScale', 5); const tk = getComputedStyle(document.documentElement).getPropertyValue('--text-k').trim();
    S.set('avatarScale', 120); const ds = P.rig.drawScale, h1 = P.rig.height;
    S.set('nameplates', 'off'); const np = document.body.classList.contains('np-off');
    S.set('minimapSize', 3); const mm = getComputedStyle(document.getElementById('minimap-panel')).zoom;
    S.set('hudOpacity', 50); const hf = document.body.classList.contains('hud-faded');
    S.set('chatOpacity', 40); const cf = document.body.classList.contains('chat-faded');
    S.set('highContrast', true); const hc = document.body.classList.contains('high-contrast');
    const ids = S.reset('layout');
    return { ui, fs, fs0, tk, ds, h0, h1, np, mm, hf, cf, hc, ids: ids.length, after: [G.settings.uiScale, P.rig.drawScale, document.body.classList.contains('np-off'), G.settings.textScale].join() };
  });
  check('A: UI 크기 3단계 → uiScale 1.12 (the html font size grows)', lay.ui === 1.12 && Math.abs(parseFloat(lay.fs) / lay.fs0 - 1.12) < 0.02, `${lay.ui} ${lay.fs0} → ${lay.fs}`);
  check('A: 글자 크기 5 → --text-k 1.36', lay.tk === '1.36', lay.tk);
  check('A: 캐릭터 크기 120 % → the rig is drawn 1.2 × and the camera height follows', lay.ds === 1.2 && Math.abs(lay.h1 / lay.h0 - 1.2) < 0.01, `${lay.ds} ${lay.h0} → ${lay.h1}`);
  check('A: name plates off · minimap ×1.25 · HUD and chat faded · high contrast', lay.np && Math.abs(parseFloat(lay.mm) - 1.25) < 0.01 && lay.hf && lay.cf && lay.hc, JSON.stringify(lay));
  check('A: 이 칸 기본값으로 (화면 구성) → every row back to its default', lay.after === '1,1,false,2', lay.after);

  // the old panes inside, and the rows they lost to the registry
  const old = await page.evaluate(async () => {
    const go = async (id) => { document.querySelector(`.set-window .sw-tabs .tab[data-tab="${id}"]`).click(); await new Promise((r) => setTimeout(r, 250)); return document.querySelector('.set-window .set-pane'); };
    let p = await go('controls');
    const tiles = p.querySelectorAll('[role="radiogroup"][aria-label="마우스로 둘러보기"] [role="radio"]').length;
    const speed = !!p.querySelector('input[type="range"][aria-label="회전 속도"]');
    p = await go('access');
    const uiOld = !!p.querySelector('input[aria-label="UI 크기"]'), hcOld = !!p.querySelector('input[aria-label="고대비"]'), rm = !!p.querySelector('input[aria-label="움직임 줄이기"]');
    p = await go('kids');
    const easy = !!p.querySelector('input[aria-label="쉬운 모드"]'), gate = !!p.querySelector('input[aria-label="보호자 확인"]');
    p = await go('graphics');
    const q = !!p.querySelector('[role="radiogroup"][aria-label="그래픽 품질"]');
    p = await go('credits');
    const cred = (p.textContent || '').length > 20;
    return { tiles, speed, uiOld, hcOld, rm, easy, gate, q, cred };
  });
  check('A: the old panes are inside with their controls (조작 tiles + 회전 속도, 아이 보호, 그래픽 품질, 사용한 자료)', old.tiles === 4 && old.speed && old.easy && old.gate && old.q && old.rm && old.cred, JSON.stringify(old));
  check('A: rows that moved to 화면 구성 are not shown twice (UI 크기, 고대비)', !old.uiOld && !old.hcOld);

  // search
  const se = await page.evaluate(async () => {
    const box = document.querySelector('.set-window input.sw-search');
    const q = async (t) => { box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 450)); const p = document.querySelector('.set-window .set-pane'); return { opts: [...p.querySelectorAll('.set-row[data-opt]')].map((r) => r.dataset.opt), jumps: p.querySelectorAll('.sw-jump').length, help: p.querySelectorAll('.sw-hcard').length, empty: !!p.querySelector('.empty') }; };
    const a = await q('글자'), b = await q('효과음'), c = await q('쉬운 모드'), d = await q('낚시'), e = await q('zzqq없는말');
    box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 300));
    return { a, b, c, d, e };
  });
  check('A: search finds registry rows (글자 → 글자 크기)', se.a.opts.includes('textScale'), JSON.stringify(se.a));
  check('A: search finds rows of the old panes (쉬운 모드 → a jump to 아이 보호) and help topics (낚시)', se.c.jumps > 0 && se.d.help > 0, JSON.stringify([se.c, se.d]));
  check('A: search without a hit says so calmly', se.e.empty && se.e.opts.length === 0);

  // keys
  const keys = await page.evaluate(async () => {
    const B = G.input?.bindings;
    document.querySelector('.set-window .sw-tabs .tab[data-tab="controls"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const p = document.querySelector('.set-window .set-pane');
    if (!B || !B.list) return { fixed: !!p.querySelector('.sw-fixed .kt-row'), bindings: false };
    const row = p.querySelector('.set-row[data-opt="key_jump"]');
    if (!row) return { bindings: true, row: false, rows: p.querySelectorAll('.sw-keys .set-row').length };
    const press = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, cancelable: true })); };
    row.querySelector('.sw-rebind').click(); await new Promise((r) => setTimeout(r, 120));
    const waiting = row.querySelector('.sw-rebind').classList.contains('waiting');
    press('KeyK'); await new Promise((r) => setTimeout(r, 200));
    const j = B.get('jump').join();
    const caps = row.querySelector('.sw-caps').textContent;
    row.querySelector('.sw-rebind').click(); await new Promise((r) => setTimeout(r, 120));
    press('KeyW'); await new Promise((r) => setTimeout(r, 200));
    const conflict = row.querySelector('.sw-keynote').textContent;
    const still = B.get('jump').join();
    row.querySelector('.sw-rekey').click(); await new Promise((r) => setTimeout(r, 150));
    return { bindings: true, row: true, rows: p.querySelectorAll('.sw-keys .set-row').length, waiting, j, caps, conflict, still, back: B.get('jump').join() };
  });
  if (keys.bindings) {
    check('A: 조작 → the key table from G.input.bindings (one row per action)', keys.row && keys.rows >= 15, JSON.stringify(keys));
    check('A: 바꾸기 + a key → the action gets it, the caps show it', keys.waiting && keys.j === 'KeyK' && /K/.test(keys.caps), JSON.stringify(keys));
    check('A: a key another action uses → a conflict notice, nothing changes', /이미/.test(keys.conflict) && keys.still === 'KeyK', keys.conflict);
    check('A: 처음대로 → the default key again', keys.back === 'Space', keys.back);
  } else check('A: 조작 → without G.input.bindings the fixed keys are shown read-only', keys.fixed);

  // help
  const help = await page.evaluate(async () => {
    document.querySelector('.set-window .sw-tabs .tab[data-tab="help"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const p = document.querySelector('.set-window .set-pane');
    const cards = [...p.querySelectorAll('.sw-hcard')];
    const ids = cards.map((c) => c.dataset.help);
    const jump = cards.find((c) => c.dataset.help === 'jump');
    const t = G.sys.settings.helpTopics();
    return { n: cards.length, ids, jumpKeys: jump?.querySelector('.sw-hkeys')?.textContent || '', tour: /처음 안내 다시 보기/.test(p.textContent), ctrl: /Ctrl/.test(cards.find((c) => c.dataset.help === 'ctrl')?.textContent || ''), say: cards.every((c) => (c.dataset.say || '').length > 10), pics: p.querySelectorAll('.sw-hpic .emoji').length, topics: t.length };
  });
  const NEED = ['move', 'look', 'ctrl', 'jump', 'go', 'next', 'farm', 'jars', 'gotgan', 'rooms', 'myroom', 'complex', 'fishing', 'cooking', 'photo', 'journal', 'chat', 'support', 'plans', 'settings'];
  check('A: 도움말 explains every feature of the platform (≥ 20 topics, a picture each, words to read aloud)', help.n >= 20 && NEED.every((x) => help.ids.includes(x)) && help.pics === help.n && help.say, `${help.n} · missing ${NEED.filter((x) => !help.ids.includes(x)).join(',')}`);
  check('A: 도움말 shows the current keys (점프 → Space), the Ctrl mouse toggle and 처음 안내 다시 보기', /Space/.test(help.jumpKeys) && help.ctrl && help.tour, help.jumpKeys);

  // ten options → reload → still set
  const TEN = { mixMaster: 70, mixMusic: 30, mixUi: 55, textScale: 4, uiStep: 3, avatarScale: 110, nameplates: 'others', minimapSize: 1, hudOpacity: 80, muteHidden: false };
  await page.evaluate((T) => { G.ui.modal.closeAll(); for (const [k, v] of Object.entries(T)) G.sys.settings.set(k, v); }, TEN);
  await page.evaluate(() => G.save?.save?.({ reason: 'test' }));
  await boot(page);
  const again = await page.evaluate((T) => Object.fromEntries(Object.keys(T).map((k) => [k, G.sys.settings.get(k)])), TEN);
  const lost = Object.keys(TEN).filter((k) => again[k] !== TEN[k]);
  check('A: ten options changed → reload → all ten still set', lost.length === 0, lost.map((k) => `${k}=${again[k]}`).join(' '));
  const applied = await page.evaluate(() => ({ tk: getComputedStyle(document.documentElement).getPropertyValue('--text-k').trim(), np: document.body.classList.contains('np-others'), ds: G.sys.player.rig.drawScale, ui: G.settings.uiScale }));
  check('A: … and applied again after the reload (글자 1.22, 이름표, 캐릭터 1.1, UI 1.12)', applied.tk === '1.22' && applied.np && applied.ds === 1.1 && applied.ui === 1.12, JSON.stringify(applied));
  await page.evaluate(() => G.sys.settings.reset('all'));
  await context.close();
}

// ================================================================================================ part B
async function partB() {
  const { page, context } = await open('easy');
  await boot(page);
  const r = await page.evaluate(async () => {
    const s = document.querySelector('#bottom-bar [data-action="settings"]');
    const rect = s?.getBoundingClientRect();
    s.click();
    await new Promise((r) => setTimeout(r, 600));
    const kid = !!document.querySelector('.kid-settings-modal'), full = !!document.querySelector('.set-window');
    return { easy: !!G.easy?.on, shown: !!rect && rect.width >= 56 && rect.height >= 56, say: s?.dataset.say || '', kid, full };
  });
  check('B: easy mode — ⚙️ in the easy bar (≥ 56 px, a voice line) opens the child\'s simple controls, not the grown-up window', r.easy && r.shown && r.say.length > 4 && r.kid && !r.full, JSON.stringify(r));
  if (SHOTS) { await shot(page, 'easy-kid-settings'); }
  const gate = await page.evaluate(async () => {
    G.ui.modal.closeAll(); await new Promise((r) => setTimeout(r, 300));
    G.app.openSettings({ adult: true }); await new Promise((r) => setTimeout(r, 600));
    const gated = !!document.querySelector('.set-window');
    G.ui.modal.closeAll(); G.easy?.lockGate?.();
    G.setSetting('parentGate', false); await new Promise((r) => setTimeout(r, 200));
    G.app.openSettings({ adult: true }); await new Promise((r) => setTimeout(r, 700));
    return { gated, open: !!document.querySelector('.set-window'), first: document.querySelector('.set-window .sw-tabs .tab')?.dataset.tab, title: document.querySelector('.set-window .modal-head h2')?.textContent };
  });
  check('B: easy mode — the full window only behind the gate; then 아이 보호 comes first', !gate.gated && gate.open && gate.first === 'kids' && /어른 설정/.test(gate.title), JSON.stringify(gate));
  if (gate.open) {
    const tabs = await walkTabs(page, 'easy');
    check('B: easy mode — every tab drawn without an error', tabs.every((t) => !t.missing && !t.failed), tabs.map((t) => `${t.id}:${t.rows}`).join(' '));
    const taps = await page.evaluate(() => [...document.querySelectorAll('.set-window .sw-tabs .tab, .set-window .sw-seg button')].filter((b) => b.getClientRects().length).map((b) => Math.round(b.getBoundingClientRect().height)).filter((hgt) => hgt < 56).length);
    check('B: easy mode — the tabs and step buttons are ≥ 56 px tall', taps === 0, `${taps} smaller`);
  }
  if (SHOTS) { try { await page.evaluate(() => G.ui.modal.closeAll()); await page.locator('#bottom-bar').screenshot({ path: path.join(SHOTS, 'bottom-bar-easy.png') }); } catch (e) { /* optional */ } }
  await context.close();
}

// ================================================================================================ part C
async function partC() {
  for (const [w, hgt] of [[390, 844], [844, 390]]) {
    const { page, context } = await open(`phone${w}`, { viewport: { width: w, height: hgt }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await boot(page);
    await normalMode(page);
    await page.evaluate(() => G.app.openSettings('layout'));
    await page.waitForSelector('.set-window .sw-tabs .tab', { timeout: 60000 });
    const lay = await page.evaluate(() => {
      const main = document.querySelector('.set-window .sw-main');
      const box = document.querySelector('.set-window');
      const cols = getComputedStyle(main).gridTemplateColumns.split(' ').length;
      return { cols, over: Math.max(0, box.scrollWidth - box.clientWidth), fits: box.getBoundingClientRect().right <= innerWidth + 1 };
    });
    check(`C: ${w} × ${hgt} — the window fits, no sideways scrolling (${w < hgt ? 'one column' : 'tabs beside the pane'})`, lay.over <= 1 && lay.fits && (w < hgt ? lay.cols === 1 : true), JSON.stringify(lay));
    const tabs = await walkTabs(page, `phone-${w}x${hgt}`);
    check(`C: ${w} × ${hgt} — every tab drawn, nothing wider than the window`, tabs.every((t) => !t.missing && !t.failed && t.overflow <= 1), tabs.filter((t) => t.overflow > 1 || t.failed).map((t) => `${t.id}:${t.overflow}`).join(' '));
    if (w === 390) {
      const touch = await page.evaluate(async () => {
        const S = G.sys.settings;
        S.set('stickSide', 'right'); S.set('touchButtons', 3);
        await new Promise((r) => setTimeout(r, 100));
        const j = document.getElementById('joystick').getBoundingClientRect();
        const b = document.querySelector('.mobile-buttons button').getBoundingClientRect();
        const out = { right: document.body.classList.contains('stick-right'), stickRight: j.left > innerWidth / 2, bigger: getComputedStyle(document.querySelector('.mobile-buttons button')).scale };
        S.reset('controls');
        return out;
      });
      check('C: touch layout — the stick goes to the right, the buttons grow (device options)', touch.right && touch.stickRight && /1\.22/.test(String(touch.bigger)), JSON.stringify(touch));
    }
    await context.close();
  }
}

// ================================================================================================ part D
async function partD() {
  const php = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (php.status !== 0) { check('D: php is available for the private server copy', false, 'php not found — run with --no-server'); return; }
  const srvTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-settings-srv-'));
  const docroot = path.join(srvTmp, 'docroot'), dataDir = path.join(srvTmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const skip = (rel) => /(^|[\\/])config\.local\.php$/.test(rel) || /^(data|uploads)[\\/].+/.test(rel);
  fs.cpSync(path.join(ROOT, 'server'), docroot, { recursive: true, filter: (src) => !skip(path.relative(path.join(ROOT, 'server'), src)) });
  fs.mkdirSync(path.join(docroot, 'data'), { recursive: true });
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', path.join(docroot, 'index.html'), '--data-out', path.join(docroot, 'data/game-data.json')], { encoding: 'utf8' });
  if (b.status !== 0) { check('D: server page build', false, (b.stderr || b.stdout).slice(0, 300)); return; }
  const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const port = Number(opt('--port', '0')) || await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, TFM_DATA_DIR: dataDir, TFM_UPLOAD_DIR: path.join(srvTmp, 'uploads'), TFM_TOSS_MOCK: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
  const BASE = `http://127.0.0.1:${port}/`;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { const r = await fetch(BASE + 'api/ping.php'); up = r.ok; } catch { /* not yet */ } if (!up) await sleep(100); }
    if (!up) { check('D: the private php server starts', false); return; }
    const rid = Math.random().toString(16).slice(2, 8);
    const acct = { email: `st${rid}@example.com`, nickname: `St${rid}`, password: `Settings-${rid}-2026ok` };
    const openTitle = async (page) => {
      await page.goto(`${BASE}index.html?notutorial=1&quality=low`, { waitUntil: 'load', timeout: TIMEOUT });
      await page.waitForFunction(() => window.G && G.net && G.net.mode === 'server' && G.app && G.app._booted === true && G.app._booting === false, null, { timeout: TIMEOUT, polling: 250 });
    };
    const saves = [];
    // device 1: register, change account and device options, wait for the debounced save
    const one = await open('device1', {}, BASE);
    one.page.on('response', async (r) => { if (/\/api\/settings\/save\.php/.test(r.url())) saves.push(r.status()); });
    await openTitle(one.page);
    const e1 = await one.page.evaluate(async (a) => {
      try { const prof = await G.auth.register({ email: a.email, nickname: a.nickname, password: a.password, confirm: a.password, agree: true, easy: false }); return { ok: await G.app.enterGame(prof) }; }
      catch (e) { return { ok: false, err: `${e?.code || ''} ${e?.message || e}` }; }
    }, acct);
    check('D: device 1 — a new account enters (server mode)', e1.ok === true, JSON.stringify(e1));
    if (!e1.ok) return;
    await one.page.waitForFunction(() => G.ready === true && !!G.state && G.sys.settings.store.pulled, null, { timeout: TIMEOUT, polling: 250 });
    const ACCT = { mixMaster: 65, mixMusic: 25, mixSfx: 85, mixUi: 45, mixVoice: 75, mixNature: 35, textScale: 5, uiStep: 3, avatarScale: 115, nameplates: 'off', hudOpacity: 70, muteHidden: false };
    const DEV = { stickSide: 'right', touchButtons: 3 };
    const dev1 = await one.page.evaluate(async ([A, D]) => {
      for (const [k, v] of Object.entries({ ...A, ...D })) G.sys.settings.set(k, v);
      const st = G.sys.settings.store, t0 = Date.now(), seen = [];
      await new Promise((r) => setTimeout(r, 300));
      while (Date.now() - t0 < 40000 && (st.pending || st.busy || st.v < 1)) { seen.push(`${st.pending ? 'p' : ''}${st.busy ? 'b' : ''}${st.v}`); await new Promise((r) => setTimeout(r, 250)); }
      const r = await G.net.request('settings/get.php');
      // a value that only the account store has (the player save never carries it): device 2 must get it from there
      const only = await G.net.request('settings/save.php', { body: { v: r.v + 1, data: { acct: { ...r.data.acct, mixNature: 15 }, dev: r.data.dev } } });
      return { id: st.deviceId(), v: r.v, acct: r.data.acct, dev: r.data.dev, ms: Date.now() - t0, seen: [...new Set(seen)].join(' '), errors: st.errors, only: only.v };
    }, [ACCT, DEV]);
    const okAcct = Object.entries(ACCT).every(([k, v]) => (k === 'uiStep' ? dev1.acct.uiScale === 1.12 : dev1.acct[k] === v));
    check('D: device 1 — the account-scope values reach the server (debounced, one blob)', dev1.v >= 1 && okAcct && saves.length >= 1 && saves.every((s) => s === 200), `v ${dev1.v} in ${dev1.ms} ms [${dev1.seen}] errors ${dev1.errors} saves ${saves.join()} ${JSON.stringify(dev1.acct).slice(0, 200)}`);
    check('D: device 1 — the device-scope values are kept under its own device id', dev1.dev?.[dev1.id]?.s?.stickSide === 'right' && dev1.dev[dev1.id].s.touchButtons === 3 && !('stickSide' in dev1.acct), JSON.stringify(dev1.dev).slice(0, 200));
    await one.context.close();
    // device 2: a fresh browser (no local storage) logs in with the same account
    const two = await open('device2', {}, BASE);
    await openTitle(two.page);
    const before = await two.page.evaluate(() => ({ mixMusic: G.settings.mixMusic, textScale: G.settings.textScale }));
    const e2 = await two.page.evaluate(async (a) => {
      try { const prof = await G.auth.login({ login: a.email, password: a.password }); return { ok: await G.app.enterGame(prof) }; }
      catch (e) { return { ok: false, err: `${e?.code || ''} ${e?.message || e}` }; }
    }, acct);
    check('D: device 2 — a fresh browser logs in with the same account', e2.ok === true && before.mixMusic !== 25, JSON.stringify([e2, before]));
    if (!e2.ok) return;
    await two.page.waitForFunction(() => G.ready === true && !!G.state && G.sys.settings.store.pulled && G.sys.settings.store.last, null, { timeout: TIMEOUT, polling: 250 });
    const got = await two.page.evaluate((A) => ({ vals: Object.fromEntries(Object.keys(A).map((k) => [k, G.sys.settings.get(k)])), stick: G.sys.settings.get('stickSide'), tb: G.sys.settings.get('touchButtons'), id: G.sys.settings.store.deviceId(), tk: getComputedStyle(document.documentElement).getPropertyValue('--text-k').trim(), ds: G.sys.player.rig.drawScale, np: document.body.classList.contains('np-off') }), ACCT);
    const lost = Object.keys(ACCT).filter((k) => k !== 'mixNature' && got.vals[k] !== ACCT[k]);
    check('D: device 2 — a value only the account store had (자연 소리 15) arrives from api/settings', got.vals.mixNature === 15 && dev1.only >= 2, `mixNature ${got.vals.mixNature}`);
    check('D: device 2 — every account-scope value is set after the login (sound, text, UI, character, name plates, HUD …)', lost.length === 0, lost.map((k) => `${k}=${got.vals[k]}`).join(' '));
    check('D: device 2 — and applied (글자 1.36, 캐릭터 1.15, 이름표 숨김)', got.tk === '1.36' && got.ds === 1.15 && got.np, JSON.stringify(got));
    check('D: device 2 — the device-scope values of device 1 are not taken (another device id)', got.stick === 'left' && got.tb === 2 && got.id !== dev1.id, JSON.stringify({ stick: got.stick, tb: got.tb }));
    await two.context.close();
  } finally { try { proc.kill(); } catch (e) { /* gone */ } }
}

try {
  if (want('a')) { log('⚙️ settings — part A (desktop, normal mode)'); await partA(); }
  if (want('b')) { log('⚙️ settings — part B (easy mode)'); await partB(); }
  if (want('c') && !flag('--skip-phone')) { log('⚙️ settings — part C (phones)'); await partC(); }
  if (want('d') && !flag('--no-server')) { log('⚙️ settings — part D (account on another device)'); await partD(); }
} catch (e) {
  check('the suite ran to the end', false, String(e?.stack || e).slice(0, 400));
}
check('no page error, no console error', pageErrors.length === 0 && consoleErrors.length === 0, [...pageErrors, ...consoleErrors].slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
