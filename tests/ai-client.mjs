#!/usr/bin/env node
// =============================================================================
// tests/ai-client.mjs — 🤖 옹이 선생님 in the app (G.sys.ai, CONTRACT §15.6 / §16.10)
//
//   node tests/ai-client.mjs --file /abs/page.html [--shots <dir>] [--quality low] [--json] [--headed]
//   Run it through the browser wrapper (…/p9/locks/browser-run.sh node tests/ai-client.mjs …).
//
// Steps: local mode (no helper, 옹이's menu keeps four items) → server mode faked by a scripted G.net.request with the
//   operator switch on (G.site ai.kid_helper): the fifth menu item (radial + easy tiles) → easy mode: the tiles (≥ 56 px,
//   data-say, no text box, ⬅️ 닫기), a tile sends {presetId} only, an answer with markup is shown as text (no element, no
//   script ran), 🙋 다른 것 물어보기 / 🔊 다시 듣기 → used up (calm line, no 다른 것, 닫기) → unreachable, 429, switched
//   off, status failing (calm lines and a way back) → normal mode: the 200-character box sends {question} → preview()
//   of the developer centre in local mode. Pictures with --shots.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

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
const SHOTS = opt('--shots');
const QUALITY = opt('--quality', 'low');
const VIEW = (opt('--viewport', '1280x720')).split('x').map(Number);
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };
const file = opt('--file');
if (!file || !fs.existsSync(file)) { console.error(`page not found: ${file} (--file /abs/page.html)`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 400)}` : ''}`); };
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, `threw: ${String(e?.message || e).slice(0, 300)}`); } };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: VIEW[0], height: VIEW[1] } });
const page = await context.newPage();
page.setDefaultTimeout(90000);
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${QUALITY}`, { waitUntil: 'load', timeout: TIMEOUT });
await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.ai && !!window.G.sys?.companion && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
await page.evaluate(() => {
  const root = document.getElementById('toast-root');
  if (root) { const fix = () => { root.style.pointerEvents = 'none'; for (const el of root.querySelectorAll('*')) el.style.pointerEvents = 'none'; }; new MutationObserver(fix).observe(root, { childList: true, subtree: true }); fix(); }
  G.ui.modal.closeAll();
  window.__said = [];
  const say0 = G.easy?.say?.bind(G.easy);
  if (G.easy) G.easy.say = (t, o) => { window.__said.push(String(t)); return say0 ? say0(t, o) : Promise.resolve(true); };
});
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const waitState = (s, ms = 30000) => page.waitForFunction((x) => G.sys.ai.state === x, s, { timeout: ms, polling: 100 });
const setEasy = (on) => page.evaluate((v) => { G.setSetting('easyMode', v); return G.easy.on; }, on);
const closeAll = () => page.evaluate(() => { G.ui.modal.closeAll(); G.sys.companion.closeMenu?.(true); });

// ----------------------------------------------------------------------------- local mode
await guard('local mode', async () => {
  const r = await page.evaluate(() => ({ mode: G.net.mode, avail: G.sys.ai.available(), item: G.sys.ai.menuItem(false), kidItem: G.sys.ai.menuItem(true) }));
  check('local mode: G.sys.ai exists but is not available; no menu item (normal or easy)', r.mode !== 'server' && r.avail === false && r.item === null && r.kidItem === null, JSON.stringify(r));
  await setEasy(false);
  // right after the start 옹이 may still be arriving (openMenu() refuses until it is shown): ask until the ring is there
  await page.waitForFunction(() => { if (!document.querySelector('.ong-rad-item')) { G.ui.modal.closeAll(); G.sys.companion.openMenu(); } return document.querySelectorAll('.ong-rad-item').length > 0; }, null, { timeout: 60000, polling: 500 });
  const n = await page.evaluate(() => document.querySelectorAll('.ong-rad-item').length);
  check('local mode: 옹이\'s radial menu keeps its four items', n === 4, `items ${n}`);
  await closeAll();
});

// ----------------------------------------------------------------------------- server mode (scripted)
await page.evaluate(() => {
  G.net.mode = 'server';
  G.auth.current = { id: '7', kind: 'server', nickname: '시험어린이', role: 'user', guest: false };
  G.site.apply({ ...G.site.all(), 'ai.kid_helper': true });
  window.__calls = [];
  window.__srv = { status: 'ok', ask: 'ok', left: 3 };
  const PRESETS = [['kimchi', '🥬', '김치는 어떻게 만들어요?'], ['doenjang', '🫘', '된장은 왜 오래 기다려요?'], ['meju', '🧱', '메주는 뭐예요?'], ['gochujang', '🌶️', '고추장은 무슨 맛이에요?'], ['jangdok', '🏺', '장독대는 왜 햇볕에 있어요?'],
    ['hanok', '🏠', '한옥 지붕은 왜 휘었어요?'], ['hanbok', '👘', '저고리는 뭐예요?'], ['spring', '🌱', '봄에는 무엇을 심어요?'], ['autumn', '🍂', '가을에는 무엇을 거둬요?'], ['winter', '❄️', '겨울에 장은 어떻게 돼요?']]
    .map(([id, icon, label]) => ({ id, icon, label, say: label, topic: 'x' }));
  const err = (code, status) => { const e = new Error(code); e.code = code; e.status = status; throw e; };
  G.net.request = async (p, o = {}) => {
    const S = window.__srv;
    window.__calls.push({ path: p, method: o.method || (o.body ? 'POST' : 'GET'), body: o.body ?? null });
    await new Promise((r) => setTimeout(r, 120));
    if (p === 'ai/status.php') {
      if (S.status === 'fail') err('NETWORK_ERROR', 0);
      if (S.status === 'off') return { enabled: false, kid: false, presets: [], left: 0, max: 200 };
      return { enabled: true, kid: true, presets: PRESETS, left: S.left, max: 200 };
    }
    if (p === 'ai/ask.php') {
      if (S.ask === 'net') err('NETWORK_ERROR', 0);
      if (S.ask === '429') err('RATE_LIMITED', 429);
      if (S.ask === 'capped') return { ok: false, answer: '오늘 물어볼 수 있는 만큼 다 물어봤어요. 내일 또 만나요!', why: 'capped_user', left: 0, presetId: o.body?.presetId ?? null };
      S.left = Math.max(0, S.left - 1);
      return { ok: true, answer: '<img src=x onerror="window.__xss=1">김치는 <b>새콤</b>하게 익어요. 항아리에서 천천히요.', why: 'ok', left: S.left, presetId: o.body?.presetId ?? null };
    }
    return {};
  };
});

await guard('menu items', async () => {
  await setEasy(false);
  await page.evaluate(() => { G.sys.companion.closeMenu?.(true); G.sys.companion.openMenu(); });
  const r = await page.evaluate(() => ({ n: document.querySelectorAll('.ong-rad-item').length, ai: !!document.querySelector('.ong-rad-item.ong-rad-ai'), lbl: document.querySelector('.ong-rad-ai .ong-rad-lbl')?.textContent || '',
    hint: document.querySelector('.ong-rad-hint')?.textContent || '' }));
  check('server mode + switch on: the radial menu has a fifth item 🤖 옹이 선생님 (key 5)', r.n === 5 && r.ai && r.lbl === '옹이 선생님' && /1–5/.test(r.hint), JSON.stringify(r));
  const geo = await page.evaluate(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const a = q('.ong-rad-ai'), c = q('.ong-rad-center'); const all = [...document.querySelectorAll('.ong-rad-item')].map((b) => b.getBoundingClientRect());
    const overlap = all.some((x, i) => all.some((y, j) => j > i && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom));
    return { below: a && c ? a.top > c.bottom - 4 : null, centred: a && c ? Math.abs((a.left + a.right) / 2 - (c.left + c.right) / 2) < 4 : null, overlap, inView: a ? a.bottom <= innerHeight && a.top >= 0 : null }; });
  check('the fifth item sits below 옹이 (centred), inside the window, overlapping no other item', geo.below && geo.centred && !geo.overlap && geo.inView, JSON.stringify(geo));
  await page.waitForTimeout(1500);
  await shot('ai-radial');
  // the fifth key opens the window
  await page.keyboard.press('Digit5');
  await waitState('pick');
  check('key 5 opens the 옹이 선생님 window', true);
  await closeAll();
  await setEasy(true);
  await page.evaluate(() => { G.sys.companion._openKidMenu(); });
  await page.waitForSelector('.ong-kid-menu, [data-modal-id="companion-menu"], .modal', { timeout: 20000 });
  const k = await page.evaluate(() => { const m = G.ui.modal.get('companion-menu'); const tiles = m ? [...m.el.querySelectorAll('button')].filter((b) => /🤖/.test(b.textContent)) : []; return { has: !!m, ai: tiles.length }; });
  check('easy mode: 옹이\'s picture menu has the 🤖 물어보기 tile', k.has && k.ai >= 1, JSON.stringify(k));
  await closeAll();
});

await guard('easy pick', async () => {
  await setEasy(true);
  await page.evaluate(() => { window.__calls = []; window.__srv.left = 3; window.__srv.ask = 'ok'; G.sys.ai.open(); });
  await waitState('pick');
  const r = await page.evaluate(() => {
    const m = G.ui.modal.get('ai-helper');
    const tiles = [...m.el.querySelectorAll('.ai-tile')];
    const small = tiles.filter((b) => { const q = b.getBoundingClientRect(); return q.width < 56 || q.height < 56; }).length;
    const back = [...m.el.querySelectorAll('.easy-back')].filter((b) => b.offsetParent !== null).length;
    return { tiles: tiles.length, small, says: tiles.filter((b) => (b.dataset.say || '').length > 2).length, ta: m.el.querySelectorAll('textarea, input[type=text]').length, back,
      left: m.el.querySelector('.ai-left')?.textContent || '', calls: window.__calls.map((c) => c.path) };
  });
  check('easy mode: ten question tiles, every one ≥ 56 px with a data-say line', r.tiles === 10 && r.small === 0 && r.says === 10, JSON.stringify(r));
  check('easy mode: no text box at all; a visible ⬅️ 닫기; the questions left are shown', r.ta === 0 && r.back >= 1 && /3번/.test(r.left), JSON.stringify(r));
  check('the window asked api/ai/status.php first', r.calls[0] === 'ai/status.php', r.calls.join(','));
  await shot('ai-easy-pick');
  await page.click('.ai-tile[data-preset="kimchi"]');
  await waitState('answer');
  const a = await page.evaluate(() => {
    const m = G.ui.modal.get('ai-helper');
    const ans = m.el.querySelector('.ai-answer');
    const acts = [...m.el.querySelectorAll('.modal-foot button, .modal-actions button, footer button')].map((b) => b.textContent.trim());
    return { text: ans?.textContent || '', kids: ans ? ans.children.length : -1, img: m.el.querySelectorAll('.ai-answer img, .ai-answer b').length, xss: window.__xss === 1,
      body: window.__calls.find((c) => c.path === 'ai/ask.php')?.body, acts, say: ans?.dataset.say || '', left: m.el.querySelector('.ai-left')?.textContent || '', said: window.__said.slice(-3) };
  });
  check('a tile sends only {presetId} — no text of the child', JSON.stringify(a.body) === '{"presetId":"kimchi"}', JSON.stringify(a.body));
  check('the answer with markup is shown as plain text (no element, no script ran)', a.text.startsWith('<img src=x onerror=') && a.kids === 0 && a.img === 0 && !a.xss, JSON.stringify(a));
  check('after an answer: 🙋 다른 것 물어보기, 🔊 다시 듣기 and 닫기; the answer is read aloud; left counts down', a.acts.some((x) => /다른 것/.test(x)) && a.acts.some((x) => /다시 듣기/.test(x)) && a.acts.some((x) => /닫기/.test(x)) && a.said.some((x) => x.includes('새콤')) && /2번/.test(a.left), JSON.stringify(a));
  await shot('ai-easy-answer');
  await page.evaluate(() => { [...G.ui.modal.get('ai-helper').el.querySelectorAll('button')].find((b) => /다른 것/.test(b.textContent))?.click(); });
  await waitState('pick');
  check('🙋 다른 것 물어보기 goes back to the tiles', true);
  // used up
  await page.evaluate(() => { window.__srv.ask = 'capped'; });
  await page.click('.ai-tile[data-preset="meju"]');
  await waitState('answer');
  const c = await page.evaluate(() => { const m = G.ui.modal.get('ai-helper'); return { text: m.el.querySelector('.ai-answer')?.textContent || '', calm: !!m.el.querySelector('.ai-answer.is-calm'),
    acts: [...m.el.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
  check('used up: one calm sentence ("내일 또 만나요"), no 다른 것 물어보기, a 닫기', /내일 또 만나요/.test(c.text) && c.calm && !c.acts.some((x) => /다른 것/.test(x)) && c.acts.some((x) => /닫기/.test(x)), JSON.stringify(c));
  await closeAll();
});

for (const [kind, setup, want, label] of [
  ['net', { ask: 'net', status: 'ok', left: 3 }, /조금 뒤에 다시/, 'the server cannot be reached'],
  ['429', { ask: '429', status: 'ok', left: 3 }, /천천히/, 'too many questions (429)'],
]) {
  await guard(kind, async () => {
    await page.evaluate((s) => { Object.assign(window.__srv, s); G.sys.ai.open(); }, setup);
    await waitState('pick');
    await page.click('.ai-tile[data-preset="spring"]');
    await waitState('answer');
    const r = await page.evaluate(() => { const m = G.ui.modal.get('ai-helper'); return { text: m.el.querySelector('.ai-answer')?.textContent || '', acts: [...m.el.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
    check(`${label}: a calm sentence and a way back`, want.test(r.text) && r.acts.some((x) => /닫기/.test(x)), JSON.stringify(r));
    await closeAll();
  });
}
await guard('off / status fail', async () => {
  await page.evaluate(() => { Object.assign(window.__srv, { status: 'off' }); G.sys.ai.open(); });
  await waitState('off');
  let r = await page.evaluate(() => { const m = G.ui.modal.get('ai-helper'); return { text: m.el.querySelector('.ai-bubble')?.textContent || '', acts: [...m.el.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
  check('switched off on the server: "쉬고 있어요" and 닫기', /쉬고 있어요/.test(r.text) && r.acts.some((x) => /닫기/.test(x)), JSON.stringify(r));
  await closeAll();
  await page.evaluate(() => { Object.assign(window.__srv, { status: 'fail' }); G.sys.ai.open(); });
  await waitState('error');
  r = await page.evaluate(() => { const m = G.ui.modal.get('ai-helper'); return { text: m.el.querySelector('.ai-bubble')?.textContent || '', acts: [...m.el.querySelectorAll('button')].map((b) => b.textContent.trim()) }; });
  check('status unreachable: a calm sentence, 🔄 다시 해 보기 and 닫기', /조금 뒤에/.test(r.text) && r.acts.some((x) => /다시 해 보기/.test(x)) && r.acts.some((x) => /닫기/.test(x)), JSON.stringify(r));
  await page.evaluate(() => { window.__srv.status = 'ok'; [...G.ui.modal.get('ai-helper').el.querySelectorAll('button')].find((b) => /다시 해 보기/.test(b.textContent))?.click(); });
  await waitState('pick');
  check('🔄 다시 해 보기 reaches the tiles once the server answers', true);
  await closeAll();
});

await guard('normal mode', async () => {
  await setEasy(false);
  await page.evaluate(() => { window.__calls = []; Object.assign(window.__srv, { ask: 'ok', status: 'ok', left: 3 }); G.sys.ai.open(); });
  await waitState('pick');
  const r = await page.evaluate(() => { const ta = G.ui.modal.get('ai-helper').el.querySelector('textarea.ai-input'); return { ta: !!ta, max: ta?.getAttribute('maxlength'), go: !!G.ui.modal.get('ai-helper').el.querySelector('.ai-send[disabled]') }; });
  check('normal mode adds a text box of 200 characters (the send button waits for text)', r.ta && r.max === '200' && r.go, JSON.stringify(r));
  await page.fill('textarea.ai-input', '식초는 어떻게 만들어요?');
  await shot('ai-normal-pick');
  await page.click('.ai-send');
  await waitState('answer');
  const b = await page.evaluate(() => window.__calls.find((c) => c.path === 'ai/ask.php')?.body);
  check('the box sends {question} with the typed text', JSON.stringify(b) === JSON.stringify({ question: '식초는 어떻게 만들어요?' }), JSON.stringify(b));
  await closeAll();
});

await guard('preview', async () => {
  await page.evaluate(() => { G.net.mode = 'local'; G.auth.current = null; window.__calls = []; });
  await setEasy(true);
  await page.evaluate(() => G.sys.ai.preview({ left: 5 }));
  await waitState('pick');
  await page.click('.ai-tile[data-preset="hanok"]');
  await waitState('answer');
  const r = await page.evaluate(() => ({ calls: window.__calls.length, text: G.ui.modal.get('ai-helper').el.querySelector('.ai-answer')?.textContent || '', avail: G.sys.ai.available() }));
  check('preview() (developer centre / kid audit) works in local mode without any request', r.calls === 0 && /배추/.test(r.text) && r.avail === false, JSON.stringify(r));
  await closeAll();
});

check('no page errors and no console errors', !pageErrors.length && !consoleErrors.length, [...pageErrors, ...consoleErrors].slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed, failed, results }, null, 1));
else log(`\nai-client: ${results.length - failed} / ${results.length} passed`);
process.exit(failed ? 1 : 0);
