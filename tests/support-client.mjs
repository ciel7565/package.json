#!/usr/bin/env node
// =============================================================================
// tests/support-client.mjs — 신고·문의 in the app (G.sys.support, CONTRACT §18.1)
//
//   node tests/support-client.mjs                        builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/support-client.mjs --file /abs/page.html  test an already built page
//   options: --shots <dir> (evidence pictures) · --skip-phone · --only-phone · --quality low|medium · --json · --headed · --timeout <ms>
//   Run it through the browser wrapper (…/p9/locks/browser-run.sh node tests/support-client.mjs …).
//
// Steps: the module and its ways in (menu tiles, chat buttons, help) → capture() (a JPEG of a fresh frame; the chat
//   window's place hidden, or drawn for a chat report) → file mode: the grown-up window (kind → category → picture →
//   words) into the local outbox, 내 문의 lists it, delete → easy mode: picture tiles, the picture step, 📤 보내요
//   without typing (no text field until the grown-up gate), tap sizes → server mode (a scripted G.net.request): the
//   multipart create (fields, a JPEG shot, device facts without the save), a refused send keeps the window, 내 문의 with an
//   operator answer that carries markup (shown as text), the unread poll → the 🔔 notice (act support) and the HUD chip,
//   seen, delete → a chat report becomes a 🚨 ticket with the chat picture → a phone (390 × 844, 844 × 390).
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); }
catch {
  try { ({ chromium, devices } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '300000'));
const T_UI = 40000;
const SHOTS = opt('--shots');
const QUALITY = opt('--quality', 'low');
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-support-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--no-assets', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, `threw: ${String(e?.message || e).slice(0, 300)}`); } };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
async function open(tag, ctxOpts = {}, o = {}) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 720 }, ...ctxOpts });
  if (o.easy === false) await context.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); s.easyMode = false; s._v = 2; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } catch (e) { /* storage blocked */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${QUALITY}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.support && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  if (o.easy === false) await page.evaluate(() => { G.setSetting('easyMode', false); return G.easy.on; });
  if (o.easy === true) await page.evaluate(() => { G.setSetting('easyMode', true); return G.easy.on; });
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (root) { const fix = () => { root.style.pointerEvents = 'none'; for (const el of root.querySelectorAll('*')) el.style.pointerEvents = 'none'; }; new MutationObserver(fix).observe(root, { childList: true, subtree: true }); fix(); }
    G.ui.modal.closeAll();
    // the grown-up gate is answered by the test (its own suite tests the gate)
    window.__gate = true;
    if (G.easy) G.easy.gate = async () => window.__gate;
  });
  return { page, context };
}
const until = (page, fn, arg, t = T_UI) => page.waitForFunction(fn, arg, { timeout: t, polling: 120 }).then(() => true, () => false);
const shot = async (page, name) => { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } catch (e) { log(`  (shot ${name} failed: ${e.message})`); } };
/** a scripted server: G.net.request answers like api/support/*; every call is recorded in window.__calls */
const fakeServer = (page, state = {}) => page.evaluate((state) => {
  window.__calls = [];
  window.__srv = Object.assign({ unread: 0, tickets: [], refuse: null, nextId: 41 }, state);
  G.net.mode = 'server';
  G.auth.current = { id: '7', kind: 'server', nickname: '시험어린이', role: 'user', guest: false };
  // (no `orig`: see the end of the function below)
  // the picture of one's own ticket (api/support/shot.php) is a plain fetch: a page opened as a file cannot reach a
  // server, so the scripted server answers it with a small JPEG drawn here (the real endpoint is tested by road / unit)
  if (!window.__origFetch) {
    window.__origFetch = window.fetch.bind(window);
    window.fetch = async (u, o) => {
      if (/support\/shot\.php\?id=\d+$/.test(String(u))) {
        window.__calls.push({ path: 'support/shot.php', method: 'GET', url: String(u) });
        const c = document.createElement('canvas'); c.width = 64; c.height = 36;
        const x = c.getContext('2d'); x.fillStyle = '#5c8046'; x.fillRect(0, 0, 64, 36);
        const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
        return new Response(b, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      }
      return window.__origFetch(u, o);
    };
  }
  G.net.request = async (p, o = {}) => {
    const S = window.__srv;
    const call = { path: p, method: o.method || (o.body || o.form ? 'POST' : 'GET'), body: o.body ?? null, form: null };
    if (o.form) {
      call.form = {};
      for (const [k, v] of o.form.entries()) call.form[k] = v instanceof Blob ? { blob: true, type: v.type, size: v.size, name: v.name || '' } : String(v);
    }
    window.__calls.push(call);
    const err = (code, message, status) => { const e = new Error(message); e.code = code; e.status = status; throw e; };
    if (p === 'support/create.php') {
      if (S.refuse) err(S.refuse.code, S.refuse.message, S.refuse.status);
      const id = S.nextId++;
      const t = { id, no: `261123-${id}`, kind: call.form.kind, category: call.form.category, body: call.form.body || '', status: 'new', shot: !!call.form.shot, shotW: 640, shotH: 360, created: Date.now(), updated: Date.now(), answered: 0, unread: false, thread: [] };
      S.tickets.unshift(t);
      return { ticket: t, unread: S.unread };
    }
    if (p === 'support/mine.php?unread=1') return { unread: S.unread, limits: { on: true, shots: true, shotBytes: 1572864, bodyMax: 1000 } };
    if (p === 'support/mine.php') return { tickets: S.tickets, unread: S.unread, more: false, limits: { on: true, shots: true, shotBytes: 1572864, bodyMax: 1000 } };
    if (p === 'support/seen.php') { S.unread = 0; S.tickets.forEach((t) => { t.unread = false; }); return { unread: 0 }; }
    if (p === 'support/delete.php') { S.tickets = S.tickets.filter((t) => t.id !== o.body.id); return { deleted: true, unread: S.unread }; }
    if (p === 'support/reply.php') { const t = S.tickets.find((x) => x.id === o.body.id); t.thread.push({ side: 'user', body: o.body.body, at: Date.now() }); t.status = 'open'; return { ticket: t }; }
    if (p === 'chat/report.php') return { reportId: 5, duplicate: false };
    // [fix10] every other path is answered here, calmly, and written down. It used to fall through to `orig`, which is NOT
    // the real function: G.net.request is the entitlement tap (71-entitle.js installTap), and a replacement set on it is
    // what the tap calls — so `orig` (the tap) called the replacement again and again until "Maximum call stack size
    // exceeded". The product itself never calls the tap from its own replacement; only a test that does can recurse.
    (window.__unscripted = window.__unscripted || []).push(p);
    return {};
  };
}, state);
const ALLOWED_META = ['build', 'browser', 'screen', 'view', 'dpr', 'quality', 'mode', 'net', 'place', 'zone', 'x', 'y', 'z', 'fps', 'look', 'lang', 'touch', 'gl', 'errors', 'lastError', 'uptime', 'memMB', 'blur', 'ui'];

log(`support-client — ${file}`);
// =============================================================================== 1 · normal mode (file, then a scripted server)
if (!flag('--only-phone')) {
  const { page, context } = await open('normal', {}, { easy: false });
  await guard('ways in', async () => {
    const w = await page.evaluate(() => {
      const quick = [...document.querySelectorAll('#chat-panel .sup-chat-row .sup-cq')].map((b) => b.getAttribute('aria-label'));
      const kid = !!document.querySelector('#chat-panel .chat-kid-row .sup-ck');
      return { quick, kid, api: ['open', 'capture', 'mine', 'openMine', 'refresh'].filter((k) => typeof G.sys.support[k] === 'function'), unread: G.sys.support.unread };
    });
    check('ways in: G.sys.support has open · capture · mine · openMine · refresh; the chat window has 문의하기 · 신고하기 and the easy chat row a 📮', w.api.length === 5 && w.quick.join(',') === '문의하기,신고하기' && w.kid && w.unread === 0, JSON.stringify(w));
    // the chat window's buttons are really pressable: inside the panel (not pushed out of its width), a real click opens the window
    await page.evaluate(() => G.sys.social.toggleChat(true));
    const inside = await page.evaluate(() => { const p = document.getElementById('chat-panel').getBoundingClientRect(); return [...document.querySelectorAll('#chat-panel .sup-cq')].map((b) => { const r = b.getBoundingClientRect(); return r.width > 20 && r.left >= p.left - 1 && r.right <= p.right + 1; }); });
    // a real mouse press at the button's middle, as a person does it. (page.click first waits for several animation
    // frames with an unchanged box; on software WebGL a frame can take seconds and that wait alone ran into the
    // timeout although the button was pressable — a press at the coordinates still proves that nothing lies over it.)
    const mid = await page.evaluate(() => { const r = document.querySelector('#chat-panel .sup-cq[aria-label="문의하기"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(mid.x, mid.y);
    const viaChat = await until(page, () => !!document.querySelector('.sup-modal .sup-kind.is-on[data-kind="question"]'), null, 45000);
    await page.evaluate(() => G.ui.modal.closeAll());
    check('ways in: the chat window\'s 문의하기 · 신고하기 sit inside the panel and a real click opens the window (kind 문의하기)', inside.length === 2 && inside.every(Boolean) && viaChat, JSON.stringify({ inside, viaChat }));
    // (no Escape key here: in the game Esc opens the menu, and openMenu() then toggles it shut)
    await page.evaluate(() => { G.ui.modal.closeAll(); G.app.openMenu({ adult: true }); });
    const tileOk = await until(page, () => !!document.querySelector('.app-menu-modal .am-tile[data-mm="support"]'), null, 10000);
    if (tileOk) await page.click('.app-menu-modal .am-tile[data-mm="support"]');
    const menu = tileOk && await until(page, () => !!document.querySelector('.sup-modal .sup-kinds'));
    await page.evaluate(() => G.ui.modal.closeAll());
    check('ways in: the grown-up menu has a 📮 문의·신고 tile that opens the window', menu, JSON.stringify({ tileOk }));
    const help = await page.evaluate(async () => { G.app?.openHelp?.(null, { full: true }); await new Promise((r) => setTimeout(r, 300)); const ok = [...document.querySelectorAll('.app-help-modal .modal-foot button')].some((b) => /문의·신고/.test(b.textContent)); G.ui.modal.closeAll(); return ok; });
    check('ways in: the help window has a 📮 문의·신고 button', help);
  });
  await guard('capture', async () => {
    const c = await page.evaluate(async () => {
      G.sys.social?.toggleChat?.(true);
      await new Promise((r) => setTimeout(r, 200));
      const a = await G.sys.support.capture({});
      const b = await G.sys.support.capture({ chat: true });
      const out = { a: a && { type: a.blob.type, size: a.blob.size, w: a.w, h: a.h, blur: a.blur, url: /^blob:/.test(a.url), ui: a.ui }, b: b && { blur: b.blur, size: b.blob.size, ui: b.ui } };
      // the picture is a real JPEG of the 3D frame (its first bytes)
      const head = a ? new Uint8Array(await a.blob.slice(0, 3).arrayBuffer()) : [];
      out.jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      return out;
    });
    check('capture(): a JPEG of a fresh frame (blob URL, ≤ 1600 px, under the server limit), the chat window hidden; for a chat report it is drawn instead', c.a && c.jpeg && c.a.type === 'image/jpeg' && c.a.w <= 1600 && c.a.size > 1000 && c.a.size < 1572864 && c.a.url && c.a.blur === true && c.b && c.b.blur === false, JSON.stringify(c));
  });
  await guard('file mode', async () => {
    await page.evaluate(() => { localStorage.removeItem(G.sys.support._internal.outKey()); G.sys.support.open(); });
    const opened = await until(page, () => !!document.querySelector('.sup-modal .sup-kinds'));
    const local = await page.evaluate(() => !!document.querySelector('.sup-modal .sup-local'));
    await page.click('.sup-modal .sup-kind[data-kind="bug"]');
    await until(page, () => document.querySelectorAll('.sup-modal .sup-cat').length === 8);
    const disabled = await page.evaluate(() => document.querySelector('.sup-modal .modal-foot .btn-primary')?.disabled === true);
    await page.click('.sup-modal .sup-cat[data-cat="invisible"]');
    await page.fill('#sup-body', '장독대 옆에서 항아리가 안 보여요. 010-1234-5678');
    const pic = await page.evaluate(() => ({ img: !!document.querySelector('.sup-modal .sup-fig img'), note: document.querySelector('.sup-modal .sup-pic .sup-note')?.textContent || '' }));
    await shot(page, 'report-normal-file');
    await page.click('.sup-modal .modal-foot .btn-primary');
    const done = await until(page, () => !!document.querySelector('.sup-modal .sup-done'));
    const box = await page.evaluate(() => { const l = G.sys.support._internal.outbox(); return { n: l.length, kind: l[0]?.kind, cat: l[0]?.category, thumb: /^data:image\/jpeg/.test(l[0]?.thumb || ''), metaKeys: Object.keys(l[0]?.meta || {}) }; });
    check('file mode: the window opens with the note that the server would send it directly; 보내기 waits for a category', opened && local && disabled, JSON.stringify({ opened, local, disabled }));
    check('file mode: the picture is shown with the note that it goes to the operator and may show other people', pic.img && /운영자/.test(pic.note) && /다른 사람/.test(pic.note), pic.note);
    check('file mode: it lands in the local outbox (kind, category, a small JPEG preview, device facts of the allowed list only)', done && box.n === 1 && box.kind === 'bug' && box.cat === 'invisible' && box.thumb && box.metaKeys.every((k) => ALLOWED_META.includes(k)), JSON.stringify(box));
    await page.evaluate(() => { G.ui.modal.closeAll(); G.sys.support.openMine(); });
    await until(page, () => !!document.querySelector('.sup-mine .sup-card'));
    const mine = await page.evaluate(() => ({ cards: document.querySelectorAll('.sup-mine .sup-card').length, save: [...document.querySelectorAll('.sup-mine button')].some((b) => /파일로 저장/.test(b.textContent)) }));
    await shot(page, 'mine-file-outbox');
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('.sup-mine .sup-card .sup-card-acts .btn-ghost');
    const left = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 200)); return G.sys.support._internal.outbox().length; });
    check('file mode: 내 문의 lists the outbox with "파일로 저장"; deleting removes it', mine.cards === 1 && mine.save && left === 0, JSON.stringify({ ...mine, left }));
    await page.evaluate(() => G.ui.modal.closeAll());
  });
  await guard('server', async () => {
    await fakeServer(page);
    // the help window stays open underneath: the report says which windows were open (code names only)
    await page.evaluate(() => { G.app.openHelp(null, { full: true }); return G.sys.support.open('report', { target: { name: '다른친구', id: 12 } }); });
    await until(page, () => document.querySelectorAll('.sup-modal .sup-cat').length === 5);
    const target = await page.evaluate(() => document.querySelector('.sup-modal .sup-target')?.textContent || '');
    await page.click('.sup-modal .sup-cat[data-cat="badword"]');
    await page.fill('#sup-body', '채팅에서 나쁜 말을 했어요');
    await shot(page, 'report-normal-server');
    await page.click('.sup-modal .modal-foot .btn-primary');
    await until(page, () => !!document.querySelector('.sup-modal .sup-done'));
    const sent = await page.evaluate(() => ({ call: window.__calls.find((c) => c.path === 'support/create.php'), done: document.querySelector('.sup-modal .sup-done')?.textContent || '' }));
    const f = sent.call?.form || {};
    const meta = (() => { try { return JSON.parse(f.meta || '{}'); } catch { return null; } })();
    check('server: a multipart create with kind, category, words, the target account and a JPEG "shot"', f.kind === 'report' && f.category === 'badword' && f.body === '채팅에서 나쁜 말을 했어요' && f.targetId === '12' && f.shot?.blob && f.shot.type === 'image/jpeg' && f.shot.size > 1000, JSON.stringify(f).slice(0, 300));
    check('server: device facts only from the allowed list (no save, no nickname, no e-mail), mode normal, net server, the open window (app-help) by its code name', meta && Object.keys(meta).every((k) => ALLOWED_META.includes(k)) && meta.mode === 'normal' && meta.net === 'server' && !/시험어린이|@/.test(JSON.stringify(meta)) && /(^|,)app-help(,|$)/.test(meta.ui || '') && /^[a-z0-9_,-]*$/.test(meta.ui), JSON.stringify(meta).slice(0, 300) + ` ui=${meta?.ui}`);
    check('server: the window says it was sent, with its number', /261123-41/.test(sent.done) && target.includes('다른친구'), sent.done.slice(0, 120));
    // a refused send keeps the window and says why
    await page.evaluate(() => { G.ui.modal.closeAll(); window.__srv.refuse = { code: 'SUPPORT_LIMIT', message: '한 시간에 5번까지 보낼 수 있어요. 조금 뒤에 다시 보내 주세요.', status: 429 }; G.sys.support.open('bug'); });
    await until(page, () => document.querySelectorAll('.sup-modal .sup-cat').length === 8);
    await page.click('.sup-modal .sup-cat[data-cat="slow"]');
    await page.click('.sup-modal .modal-foot .btn-primary');
    const kept = await until(page, () => !!document.querySelector('.toast') && /한 시간에/.test(document.getElementById('toast-root')?.textContent || ''), null, 8000);
    const still = await page.evaluate(() => !!document.querySelector('.sup-modal .sup-cats') && !document.querySelector('.sup-modal .sup-done'));
    check('server: a refused send (429 SUPPORT_LIMIT) keeps the window open and shows the server\'s words', kept && still);
    await page.evaluate(() => { window.__srv.refuse = null; G.ui.modal.closeAll(); });
    // the operator answered (with markup in the answer): the poll → 🔔 notice + chip → 내 문의 shows it as text → seen
    await page.evaluate(() => {
      const t = window.__srv.tickets[0];
      t.status = 'answered'; t.unread = true; t.answered = Date.now();
      t.thread.push({ side: 'admin', body: '<img src=x onerror="window.__xss=1">고쳤어요\n다시 해 보세요', at: Date.now() });
      window.__srv.unread = 1;
    });
    const unread = await page.evaluate(async () => { await G.sys.support.refresh(); const n = (G.sys.engagement?.notifications?.() || []).find((x) => x.act === 'support'); return { u: G.sys.support.unread, note: n ? { title: n.title, text: n.text } : null, chip: !document.getElementById('sup-chip')?.hidden }; });
    check('server: an answer → unread 1, one 🔔 notice (act support, fixed words) and the HUD chip "📮 답이 왔어요"', unread.u === 1 && unread.note && /답이 왔어요/.test(unread.note.title) && !/고쳤어요/.test(JSON.stringify(unread.note)) && unread.chip, JSON.stringify(unread));
    await shot(page, 'hud-chip-answer');
    await page.click('#sup-chip');
    await until(page, () => document.querySelectorAll('.sup-mine .sup-card').length > 0);
    await until(page, () => !!document.querySelector(".sup-mine .sup-card img.sup-thumb"), null, 10000);
    const view = await page.evaluate(() => ({ admin: document.querySelector('.sup-mine .from-admin p')?.textContent || '', html: document.querySelector('.sup-mine .from-admin')?.innerHTML || '', xss: !!window.__xss, seen: window.__calls.some((c) => c.path === 'support/seen.php'), chip: document.getElementById('sup-chip')?.hidden, thumb: !!document.querySelector('.sup-mine .sup-card img.sup-thumb') }));
    check('server: 내 문의 shows the operator\'s answer as text (markup inert), marks the answers seen, the chip goes, the own picture loads (shot.php)', /<img src=x/.test(view.admin) && !/<img/i.test(view.html.replace(/&lt;img/g, '')) && !view.xss && view.seen && view.chip === true && view.thumb, JSON.stringify(view).slice(0, 300));
    await shot(page, 'mine-server-answer');
    // the player adds words and deletes
    await page.click('.sup-mine .sup-card .sup-card-acts .btn-soft');
    await page.fill('.sup-mine .sup-card-acts textarea', '고마워요');
    await page.click('.sup-mine .sup-card-acts .btn-primary');
    const replied = await until(page, () => window.__calls.some((c) => c.path === 'support/reply.php' && c.body?.body === '고마워요'), null, 8000);
    await page.evaluate(() => { window.confirm = () => true; });
    await until(page, () => !!document.querySelector('.sup-mine .sup-card .sup-card-acts .btn-ghost'));
    const before = await page.evaluate(() => window.__srv.tickets.length);
    await page.click('.sup-mine .sup-card .sup-card-acts .btn-ghost');
    const deleted = await until(page, (n) => window.__calls.some((c) => c.path === 'support/delete.php') && window.__srv.tickets.length === n - 1, before, 8000);
    check('server: 이어서 쓰기 sends reply.php; 지우기 sends delete.php with the ticket id', replied && deleted);
    await page.evaluate(() => G.ui.modal.closeAll());
    // a chat report of 60-social also becomes a ticket with the picture of the chat
    const chatTicket = await page.evaluate(async () => {
      window.__calls.length = 0;
      G.bus.emit('chat:reported', { name: '다른친구', targetId: null, messageId: 9001, reason: 'harass', memo: '' });
      for (let i = 0; i < 60 && !window.__calls.some((c) => c.path === 'support/create.php'); i++) await new Promise((r) => setTimeout(r, 100));
      const c = window.__calls.find((x) => x.path === 'support/create.php');
      return c ? { kind: c.form.kind, cat: c.form.category, mid: c.form.messageId, shot: !!c.form.shot, blur: JSON.parse(c.form.meta).blur } : null;
    });
    check('server: a chat report (chat:reported) also sends a 🚨 ticket — messageId, category bully, the chat drawn (not hidden)', chatTicket && chatTicket.kind === 'report' && chatTicket.cat === 'bully' && chatTicket.mid === '9001' && chatTicket.shot && chatTicket.blur === 0, JSON.stringify(chatTicket));
  });
  await context.close();
}

// =============================================================================== 2 · easy mode
if (!flag('--only-phone')) {
  const { page, context } = await open('easy', {}, { easy: true });
  await guard('easy', async () => {
    await fakeServer(page);
    await page.evaluate(() => G.sys.support.open());
    await until(page, () => document.querySelectorAll('.sup-kid .sup-kid-grid .easy-tile').length === 7);
    const tiles = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sup-kid .sup-kid-grid .easy-tile')];
      return { labels: b.map((x) => x.textContent.trim()), small: b.filter((x) => { const r = x.getBoundingClientRect(); return r.width < 56 || r.height < 56; }).length, say: b.every((x) => x.dataset.say), inputs: document.querySelectorAll('.sup-kid input:not([type=hidden]), .sup-kid textarea').length };
    });
    await shot(page, 'report-easy-tiles');
    check('easy: seven picture tiles (멈췄어요 · 안 보여요 · 소리가 이상해요 · 길을 잃었어요 · 누가 괴롭혀요 · 궁금해요 · 다른 거예요), each ≥ 56 px with a voice line, no text field', tiles.labels.length === 7 && /멈췄어요/.test(tiles.labels[0]) && /누가 괴롭혀요/.test(tiles.labels[4]) && tiles.small === 0 && tiles.say && tiles.inputs === 0, JSON.stringify(tiles));
    await page.click('.sup-kid .easy-tile[data-tile="k5"]');
    await until(page, () => !!document.querySelector('.sup-kid .sup-kid-send'));
    const step2 = await page.evaluate(() => ({ img: !!document.querySelector('.sup-kid .sup-kid-pic img'), inputs: document.querySelectorAll('.sup-kid textarea').length, grown: !!document.querySelector('.sup-kid .sup-grown'), back: !!document.querySelector('.sup-kid .easy-back'), small: [...document.querySelectorAll('.sup-kid .easy-big-btn')].filter((x) => { const r = x.getBoundingClientRect(); return r.height < 56; }).length }));
    await shot(page, 'report-easy-picture');
    check('easy: the picture step — the picture with 📷 사진도 보내요 / 🙅 사진은 빼요, 📤 보내요, ⬅️ 닫기; typing only behind "어른이 글 쓰기 🔒"', step2.img && step2.inputs === 0 && step2.grown && step2.back && step2.small === 0, JSON.stringify(step2));
    await page.click('.sup-kid .sup-kid-send');
    await until(page, () => !!document.querySelector('.sup-kid .sup-done'));
    const sent = await page.evaluate(() => { const c = window.__calls.find((x) => x.path === 'support/create.php'); return c ? { kind: c.form.kind, cat: c.form.category, body: c.form.body ?? null, shot: !!c.form.shot, mode: JSON.parse(c.form.meta).mode } : null; });
    await shot(page, 'report-easy-done');
    check('easy: 📤 보내요 sends a 🚨 bully report with the picture and no words, mode easy; the done card has a way back', sent && sent.kind === 'report' && sent.cat === 'bully' && sent.body === null && sent.shot && sent.mode === 'easy', JSON.stringify(sent));
    // the grown-up gate opens the words
    await page.evaluate(() => { G.ui.modal.closeAll(); G.sys.support.open('bug', { category: 'stuck' }); });
    await until(page, () => !!document.querySelector('.sup-kid .sup-grown'));
    await page.evaluate(() => { window.__gate = false; });
    await page.click('.sup-kid .sup-grown');
    await page.waitForTimeout(300);
    const refused = await page.evaluate(() => document.querySelectorAll('.sup-kid textarea').length);
    await page.evaluate(() => { window.__gate = true; });
    await page.click('.sup-kid .sup-grown');
    const opened = await until(page, () => document.querySelectorAll('.sup-kid textarea').length === 1, null, 5000);
    check('easy: "어른이 글 쓰기" opens a text field only after the grown-up gate', refused === 0 && opened);
    await page.evaluate(() => G.ui.modal.closeAll());
    // the kid menu tile
    const tile = await page.evaluate(async () => { G.app?.openMenu?.(); await new Promise((r) => setTimeout(r, 400)); const ok = !!document.querySelector('.kid-menu-modal [data-km="support"]'); G.ui.modal.closeAll(); return ok; });
    check('easy: the kid menu has the 📮 어른에게 알려요 tile', tile);
  });
  await context.close();
}

// =============================================================================== 3 · phones
if (!flag('--skip-phone')) {
  for (const [w, hgt] of [[390, 844], [844, 390]]) {
    const { page, context } = await open(`phone-${w}`, { viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { easy: w === 390 ? false : true });
    await guard(`phone ${w}`, async () => {
      await fakeServer(page);
      await page.evaluate(() => G.sys.support.open(G.easy.on ? null : 'bug'));
      await until(page, () => !!document.querySelector('.sup-modal .sup-cats, .sup-kid .sup-kid-grid'));
      // [fix10] the same window at the first frame of its open animation (paused at 0): the painted boxes are 4 % smaller, the layout is not
      const early = await page.evaluate(() => {
        const box = document.querySelector('.sup-modal');
        const anims = box.getAnimations ? box.getAnimations() : [];
        anims.forEach((a) => { a.pause(); a.currentTime = 0; });
        const btns = [...box.querySelectorAll('button')].filter((b) => b.getClientRects().length);
        const r = { buttons: btns.length, paintedUnder40: btns.filter((b) => b.getBoundingClientRect().height < 40).length, layoutUnder40: btns.filter((b) => b.offsetHeight < 40).length, anims: anims.length };
        anims.forEach((a) => a.finish());
        return r;
      });
      await page.waitForTimeout(500);
      // [fix10] the window opens with a scale-up animation (modalIn: scale .96 → 1). getBoundingClientRect() sees the scaled box, so a
      // 40 px button reads 38.4 px until the animation has ended — on a loaded machine (one frame in a second) that is how 13 buttons
      // "were lower than 40 px". The size of a button is its layout height (offsetHeight, no transform), measured after the animation.
      await page.waitForFunction(() => { const b = document.querySelector('.sup-modal'); return !b || !b.getAnimations || b.getAnimations().every((a) => a.playState !== 'running'); }, null, { timeout: 30000, polling: 200 }).catch(() => {});
      const m = await page.evaluate(() => {
        const box = document.querySelector('.sup-modal');
        const r = box.getBoundingClientRect();
        const btns = [...box.querySelectorAll('button')].filter((b) => b.getClientRects().length);
        return { w: innerWidth, left: r.left, right: r.right, overflow: document.documentElement.scrollWidth > innerWidth + 1, small: btns.filter((b) => b.offsetHeight < 40).length, smallList: btns.filter((b) => b.offsetHeight < 40).slice(0, 14).map((b) => `${b.className.replace(/\s+/g, '.')}:${b.offsetHeight}:${b.textContent.trim().slice(0, 8)}`), minH: Math.min(...btns.map((b) => b.offsetHeight)), scaled: btns.filter((b) => b.getBoundingClientRect().height < 40).length, animating: (box.getAnimations ? box.getAnimations().length : -1), touch: document.body.classList.contains('is-touch'), unscripted: window.__unscripted || [], easy: G.easy.on };
      });
      await shot(page, `report-phone-${w}x${hgt}`);
      check(`phone ${w}×${hgt}: the window fits (no sideways scroll), buttons are finger-sized`, m.left >= -1 && m.right <= m.w + 1 && !m.overflow && m.small === 0 && early.layoutUnder40 === 0, JSON.stringify({ ...m, early }));
      if (m.easy) {
        // a child must see every picture tile, and after a tap the 📤 보내요 button, without scrolling the window
        const inView = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1; }), sel);
        const tiles = await inView('.sup-kid .sup-kid-grid .easy-tile');
        await page.click('.sup-kid .easy-tile[data-tile="k1"]');
        await until(page, () => !!document.querySelector('.sup-kid .sup-kid-send'));
        await page.waitForTimeout(300);
        const send = await inView('.sup-kid .sup-kid-send, .sup-kid .sup-kid-pic .easy-big-btn');
        await shot(page, `report-phone-${w}x${hgt}-picture`);
        check(`phone ${w}×${hgt} (easy): all 7 tiles and then 📤 보내요 with 📷 / 🙅 are on the screen without scrolling`, tiles.length === 7 && tiles.every(Boolean) && send.length === 3 && send.every(Boolean), JSON.stringify({ tiles, send }));
      }
    });
    await context.close();
  }
}

await browser.close();
const crit = consoleErrors.filter((e) => !/favicon|net::ERR/.test(e));
check('no page errors, no console errors', pageErrors.length === 0 && crit.length === 0, [...pageErrors, ...crit].slice(0, 4).join(' | '));
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
else log(`\nsupport-client: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
