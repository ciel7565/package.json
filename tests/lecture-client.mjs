#!/usr/bin/env node
// =============================================================================
// tests/lecture-client.mjs — 강의실 in the app (G.sys.lecture, CONTRACT §17.3)
//
//   node tests/lecture-client.mjs                       builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/lecture-client.mjs --file /abs/page.html test an already built page
//   options: --port <n> (the suite's own web server, default 25230) · --shots <dir> (save evidence pictures there)
//            --keep · --json · --headed · --timeout <ms> · --ui-timeout <ms>
//   Run it through the browser wrapper (…/p9/locks/browser-run.sh node tests/lecture-client.mjs …).
//
// The page is served by a small web server of this suite (same-origin pictures, the pdf frame and fetch() of a pptx
// behave as on a real site); the lecture list is a scripted G.net.request; the files of api/lecture/file.php are the
// crafted ones of tests/lecture-fixtures.mjs. The outside hosts are answered by stand-in pages (no outside network):
// the stand-in video player speaks the player's message protocol, so ducking and the error note are exercised.
//
// Steps: local mode (built-in decks, the calm note, the deck viewer: buttons, keys, swipe, full screen, fit) →
//   server mode: hostile list entries dropped, titles are text → every kind plays or shows its fallback (video frame
//   attributes, music ducking, a reported error; slides frame; image deck; pdf frame; the simple pptx view — a pptx
//   built here: titles, levels, numbers, a table, pictures, an empty slide, limits, a zip bomb, blob URLs revoked;
//   a link behind the grown-up gate) → the CSP: the video frame loads without a violation, another host is blocked →
//   rooms: screen(ctx, spec), the "▶ 강의 보기" card on place:enter, auto-open once (muted), the operator's switch →
//   easy mode (tap sizes, no link out), the menus, a phone, a deep link.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as FX from './lecture-fixtures.mjs';

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
const T_UI = Number(opt('--ui-timeout', '40000'));
const PORT = Number(opt('--port', process.env.TFM_LECTURE_CLIENT_PORT || '25230'));
const SHOTS = opt('--shots');
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-lecture-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--no-assets', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };

// ---------------------------------------------------------------- the crafted lecture files
const TABLE = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>'
  + '<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>재료</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>양</a:t></a:r></a:p></a:txBody></a:tc></a:tr>'
  + '<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>메주콩</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>1 kg</a:t></a:r></a:p></a:txBody></a:tc></a:tr>'
  + '<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>소금</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>200 g</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
const NUMBERS = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>장 담그는 차례</a:t></a:r></a:p></p:txBody></p:sp>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="5" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>'
  + '<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr b="1"/><a:t>메주를 씻어요</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>소금물을 부어요</a:t></a:r></a:p>'
  + '<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>숯과 고추를 띄워요</a:t></a:r></a:p></p:txBody></p:sp>' + TABLE;
const PPTX = FX.pptxBytes([
  { title: '전통 발효 이야기', body: ['콩과 소금, 물, 그리고 기다림', { text: '작은 생물이 음식을 바꿔요', lvl: 1 }, { text: '<img src=x onerror=alert(41)> 는 글자예요', lvl: 2 }], pictures: 2 },
  { raw: NUMBERS },
  { title: '그림만 있는 장', pictures: 1 },
  { raw: '' },
  { title: '긴 글이 있는 장', body: Array.from({ length: 14 }, (_, i) => `${i + 1}번째 줄 — 항아리는 볕이 잘 들고 바람이 잘 통하는 장독대에 두고 자주 닦아 줘요.`) },
]);
const BOMB = FX.zipBytes(FX.pptxEntries([{ title: '폭탄', pictures: 5 }], [], { media: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`image${i}.png`, Buffer.alloc(20 * 1048576)])) }).map((e) => (e.name.startsWith('ppt/media/') ? { ...e, method: 8 } : e)));
const PNGS = [[214, 160, 102], [120, 170, 120], [110, 140, 200]].map((c) => FX.pngBytes(640, 360, c));
const PDF = FX.pdfBytes('Lecture PDF');
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const FILES = { '21.0': ['image/png', PNGS[0]], '21.1': ['image/png', PNGS[1]], '21.2': ['image/png', PNGS[2]], '22.0': ['application/pdf', PDF], '23.0': [PPTX_TYPE, PPTX], '24.0': [PPTX_TYPE, BOMB] };
/** what api/lecture/list.php would send — with entries a hostile or broken server could add (all must be dropped) */
const LIST = {
  v: 4101, opt: { autoOpen: true },
  lectures: [
    { id: 20, title: '된장은 어떻게 만들까요? <img src=x onerror=alert(40)>', kind: 'youtube', yt: 'dQw4w9WgXcQ', place: 'PL_DAECHEONG', autoplay: false, sort: 10 },
    { id: 21, title: '그림으로 보는 김장', kind: 'images', files: [0, 1, 2].map((n) => ({ n, type: 'image/png', w: 640, h: 360, bytes: PNGS[n].length })), place: '*', autoplay: false, sort: 20 },
    { id: 22, title: '옹기 이야기 (문서)', kind: 'pdf', files: [{ n: 0, type: 'application/pdf', w: 0, h: 0, bytes: PDF.length }], place: '', autoplay: false, sort: 30 },
    { id: 23, title: '발효 수업 발표 자료', kind: 'pptx', files: [{ n: 0, type: PPTX_TYPE, w: 5, h: 0, bytes: PPTX.length }], place: '', autoplay: false, sort: 40 },
    { id: 24, title: '열 수 없는 발표 자료', kind: 'pptx', files: [{ n: 0, type: PPTX_TYPE, w: 1, h: 0, bytes: BOMB.length }], place: '', autoplay: false, sort: 50 },
    { id: 25, title: '온라인 슬라이드', kind: 'slides', url: 'https://docs.google.com/presentation/d/e/2PACX-testtesttesttesttesttesttest/embed?start=false&loop=false&delayms=60000', place: '', autoplay: false, sort: 60 },
    { id: 26, title: '기상청 날씨누리', kind: 'link', url: 'https://www.weather.go.kr/w/index.do', place: '', autoplay: false, sort: 70 },
    { id: 27, title: '볼 수 없는 영상', kind: 'youtube', yt: 'ERRORERROR1', place: '', autoplay: false, sort: 80 },
    { id: 28, title: '안방에서 자동으로 열리는 영상', kind: 'youtube', yt: 'AUTOAUTO001', place: 'PL_ANBANG', autoplay: true, sort: 90 },
    { id: 29, title: '사라진 파일', kind: 'pptx', files: [{ n: 0, type: PPTX_TYPE, w: 1, h: 0, bytes: 100 }], place: '', autoplay: false, sort: 95 },
    // ---- everything below must be dropped by the page
    { id: 90, title: 'bad video id', kind: 'youtube', yt: 'x"><script>alert(1)</script>' },
    { id: 91, title: 'frame of another host', kind: 'slides', url: 'https://evil.example/embed' },
    { id: 92, title: 'look-alike host', kind: 'slides', url: 'https://docs.google.com.evil.example/presentation/d/e/x/embed' },
    { id: 93, title: 'script address', kind: 'link', url: 'javascript:alert(1)' },
    { id: 94, title: 'http link', kind: 'link', url: 'http://example.org/' },
    { id: 95, title: 'unknown kind', kind: 'exe', url: 'https://example.org/a.exe' },
    { id: '96; DROP TABLE', title: 'bad id', kind: 'youtube', yt: 'dQw4w9WgXcQ' },
    { id: 97, title: 'html as a picture', kind: 'images', files: [{ n: 0, type: 'text/html' }] },
    { id: 98, title: 'file without a file', kind: 'pdf', files: [] },
    null, 'text', 7,
  ],
};
const VALID = 10;

// ---------------------------------------------------------------- the suite's web server
const page404 = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); };
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (u.pathname === '/api/lecture/file.php') {
    hits.push(u.search);
    const f = FILES[`${u.searchParams.get('id')}.${u.searchParams.get('n') || '0'}`];
    if (!f) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); res.end('{"success":false,"error":{"code":"NOT_FOUND","message":"강의 자료를 찾을 수 없어요."}}'); return; }
    // the headers Tfm\Lecture::stream sends
    const pdf = f[0] === 'application/pdf';
    res.writeHead(200, {
      'Content-Type': f[0], 'X-Content-Type-Options': 'nosniff', 'Content-Length': f[1].length, 'Cache-Control': 'private, max-age=60', 'Accept-Ranges': 'bytes',
      'Content-Disposition': `${f[0] === PPTX_TYPE ? 'attachment' : 'inline'}; filename="lecture-${u.searchParams.get('id')}"`,
      'Content-Security-Policy': pdf ? "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" : "default-src 'none'; frame-ancestors 'none'; sandbox",
      'X-Frame-Options': pdf ? 'SAMEORIGIN' : 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(f[1]);
    return;
  }
  page404(res);   // api/ping.php included: the page starts in local mode; the suite switches to its scripted server
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); }).catch((e) => { console.error(`port ${PORT}: ${e.message}`); process.exit(2); });
const BASE = `http://127.0.0.1:${PORT}/`;

/** the stand-in for the video player: it answers the page's "listening" message like the real one (state, or an error) */
const PLAYER = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>player stand-in</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#27344d,#141b29);color:#fff;font:700 22px sans-serif;text-align:center">
<div><div style="font-size:64px">▶</div>시험용 영상 자리<br><small id="i" style="font-weight:400;opacity:.75"></small></div>
<script>
var id = location.pathname.split('/').pop();
document.getElementById('i').textContent = id + ' ' + location.search;
window.addEventListener('message', function (e) {
  var d; try { d = JSON.parse(e.data); } catch (x) { return; }
  if (d.event !== 'listening' || window.heard) return;
  window.heard = true;
  parent.postMessage(JSON.stringify({ event: 'onReady', id: 1 }), '*');
  if (id === 'ERRORERROR1') parent.postMessage(JSON.stringify({ event: 'onError', info: 150, id: 1 }), '*');
  else parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 1, id: 1 }), '*');
});
</script></body></html>`;
const SLIDES = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>slides stand-in</title></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f1e4;color:#3b2a1a;font:700 24px sans-serif">시험용 온라인 슬라이드 자리</body></html>';

const launch = () => chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const browser = await launch();
const outside = [];
async function newPage(ctxOpt = {}, query = 'autostart=1&notutorial=1&quality=low&lecture=on', o = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...ctxOpt });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || /^(data|blob):/.test(url)) return route.continue();
    outside.push(url);
    if (/^https:\/\/www\.youtube-nocookie\.com\/embed\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PLAYER });
    if (/^https:\/\/docs\.google\.com\/presentation\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SLIDES });
    if (/^https:\/\/i\.ytimg\.com\/vi\//.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: FX.pngBytes(320, 180, [90, 110, 160]) });
    return route.abort();
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ d: e.violatedDirective, u: e.blockedURI }));
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e?.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Content Security Policy|Refused to (frame|load)|net::ERR|Failed to load resource/.test(m.text())) page.__errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(`${BASE}index.html?${query}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.lecture, null, { timeout: TIMEOUT, polling: 250 });
  if (!o.keep) await page.evaluate(() => { G.ui.modal.closeAll(); });   // keep: a page whose address opens a dialog by itself
  return { context, page };
}
const shot = async (page, name) => { if (SHOTS) { try { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } catch (e) { log(`  (no picture ${name}: ${e.message})`); } } };
/** switch the page to the scripted server */
const serverMode = (page, list = LIST) => page.evaluate((l) => {
  window.__lecCalls = [];
  window.__lecList = l;
  G.net.mode = 'server';
  G.net.request = async (p) => { window.__lecCalls.push(p); if (/^lecture\/list\.php/.test(p)) return JSON.parse(JSON.stringify(window.__lecList)); throw new G.net.ApiError('NOT_FOUND', '없어요', 404); };
  window.__changed = [];
  G.bus.on('lecture:changed', (x) => window.__changed.push(x));
  return G.sys.lecture.refresh({ force: true }).then((x) => x.length);
}, list);
const openLecture = async (page, id) => { await page.evaluate((i) => { G.sys.lecture.open(i); }, id); await page.waitForSelector('.lecture-modal .lec-host', { timeout: T_UI }); };
/** a real (trusted) tap; the page swallows taps on controls for 360 ms after a dialog opens or closes */
const tap = async (page, sel) => { await page.waitForTimeout(480); await page.locator(sel).first().click({ timeout: T_UI }); };
const solveGate = async (page) => {
  let lastQ = '';
  for (let round = 0; round < 6; round++) {
    // the next question has its own id on its choices: never read the old one while the gate is still between two
    const fresh = await page.waitForFunction((prev) => { const b = document.querySelector('.easy-gate-choice'); return !G.ui.modal.get('easy-gate') || (!!b && b.dataset.q !== prev); }, lastQ, { timeout: T_UI, polling: 100 }).then(() => true, () => false);
    if (!fresh) return false;
    if (!(await page.evaluate(() => !!G.ui.modal.get('easy-gate')))) return true;
    lastQ = await page.evaluate(() => document.querySelector('.easy-gate-choice').dataset.q);
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
};

let exit = 0;
try {
  log(`🎓 lecture client test — ${file} (served at ${BASE})`);
  const { context, page } = await newPage();

  // ================================================================ local mode: the built-in decks
  const api = await page.evaluate(() => { const L = G.sys.lecture; return { fns: ['open', 'close', 'isOpen', 'list', 'forPlace', 'screen', 'refresh'].every((k) => typeof L[k] === 'function'), sys: G.systems().some((s) => s.name === 'lecture'), mode: G.net.mode, list: L.list().map((l) => ({ id: l.id, kind: l.kind, n: l.slides?.length })) }; });
  check('fragment loaded: G.sys.lecture { open, list, forPlace, screen, refresh } is a registered system', api.fns && api.sys);
  check('local mode: the list is the built-in slide decks', api.mode === 'local' && api.list.length >= 2 && api.list.every((l) => l.kind === 'deck' && /^deck:/.test(l.id) && l.n >= 3), JSON.stringify(api.list).slice(0, 200));
  await page.evaluate(() => { G.sys.lecture.open(); });
  await page.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI });
  const lst = await page.evaluate(() => ({ cards: document.querySelectorAll('.lecture-modal .lec-card').length, note: document.querySelector('.lecture-modal .lec-local')?.textContent || '', title: document.querySelector('.lecture-modal h2')?.textContent || '' }));
  check('the panel 🎓 강의실 lists a card per deck and says calmly that videos need the site', lst.cards === api.list.length && /영상/.test(lst.note) && /강의실/.test(lst.title), JSON.stringify(lst));
  await shot(page, '01-local-list');
  await tap(page, '.lecture-modal .lec-card');
  await page.waitForSelector('.lecture-modal .lec-deck .lec-slide', { timeout: T_UI });
  const d0 = await page.evaluate(() => ({ count: document.querySelector('.lec-count').textContent, title: document.querySelector('.lec-s-title')?.textContent || '', prev: document.querySelector('.lec-nav.prev').disabled, n: G.sys.lecture.list()[0].slides.length }));
  check('a deck opens in the viewer: slide 1, its title, "1 / N", the previous button is off', d0.count === `1 / ${d0.n}` && d0.title.length > 0 && d0.prev === true, JSON.stringify(d0));
  await shot(page, '02-local-deck');
  await tap(page, '.lec-nav.next');
  const c1 = await page.evaluate(() => document.querySelector('.lec-count').textContent);
  await page.keyboard.press('ArrowRight');
  const c2 = await page.evaluate(() => document.querySelector('.lec-count').textContent);
  await page.keyboard.press('End');
  const c3 = await page.evaluate(() => ({ c: document.querySelector('.lec-count').textContent, next: document.querySelector('.lec-nav.next').disabled }));
  await page.keyboard.press('Home');
  const c4 = await page.evaluate(() => document.querySelector('.lec-count').textContent);
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowLeft');
  const c5 = await page.evaluate(() => document.querySelector('.lec-count').textContent);
  check('the deck moves with the buttons and the keys (→ ← PageDown Home End)', c1 === `2 / ${d0.n}` && c2 === `3 / ${d0.n}` && c3.c === `${d0.n} / ${d0.n}` && c3.next === true && c4 === `1 / ${d0.n}` && c5 === `1 / ${d0.n}`, [c1, c2, c3.c, c4, c5].join(' · '));
  const fit = await page.evaluate(async () => {
    const out = [];
    const L = G.sys.lecture;
    for (const deck of L.list()) {
      L.open(deck.id);
      await new Promise((r) => setTimeout(r, 60));
      for (let i = 0; i < deck.slides.length; i++) {
        if (i) document.querySelector('.lec-nav.next').click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.querySelector('.lec-stage .lec-slide');
        if (!c) { out.push(`${deck.id}#${i}: no card`); continue; }
        if (c.scrollHeight > c.clientHeight + 2) out.push(`${deck.id}#${i + 1}: ${c.scrollHeight} > ${c.clientHeight}`);
        const r = c.getBoundingClientRect();
        if (Math.abs(r.width / r.height - 16 / 9) > 0.08) out.push(`${deck.id}#${i + 1}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
  check('every slide of the built-in decks fits its 16:9 card (no cut-off text)', fit.length === 0, fit.slice(0, 4).join(' | '));
  const fs1 = await page.evaluate(async () => {
    const b = document.querySelector('.lec-tool[aria-label="크게 보기"]');
    b.click();
    await new Promise((r) => setTimeout(r, 250));
    const on = document.querySelector('.lec-deck').classList.contains('lec-max') && b.getAttribute('aria-pressed') === 'true';
    const r = document.querySelector('.lec-stage').getBoundingClientRect();
    const cover = document.querySelector('.lec-deck').getBoundingClientRect(), pg = innerWidth + 'x' + innerHeight;
    b.click();
    // leaving the browser's own full screen (where the test browser grants it) takes a moment
    const small = () => !document.querySelector('.lec-deck').classList.contains('lec-max') && !document.fullscreenElement && !document.querySelector('.modal.lec-has-max');
    for (let i = 0; i < 80 && !small(); i++) await new Promise((r2) => setTimeout(r2, 100));
    await new Promise((r2) => setTimeout(r2, 250));
    return { on, w: Math.round(r.width), cover: [Math.round(cover.left), Math.round(cover.top), Math.round(cover.width), Math.round(cover.height)].join(), page: pg,
      off: !document.querySelector('.lec-deck').classList.contains('lec-max') && !document.fullscreenElement && !document.querySelector('.modal.lec-has-max') };
  });
  check('full screen: the deck grows over the whole page (not only over its dialog) and comes back', fs1.on && fs1.w >= 1100 && fs1.cover === `0,0,${fs1.page.replace('x', ',')}` && fs1.off, JSON.stringify(fs1));
  await tap(page, '.lecture-modal .lec-back');
  await page.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI });
  await page.evaluate(() => G.sys.lecture.close());
  await page.waitForFunction(() => !G.sys.lecture.isOpen() && !G.ui.isBlocking(), null, { timeout: T_UI });
  check('"강의 목록" goes back to the cards; closing leaves nothing blocking', true);

  // ================================================================ server mode: the list
  const n = await serverMode(page);
  const sv = await page.evaluate(() => ({ srv: G.sys.lecture._srv.map((l) => l.id), changed: window.__changed.slice(-1)[0], call: window.__lecCalls[0], total: G.sys.lecture.list().length }));
  check(`the scripted list: ${VALID} lectures kept, 12 hostile or broken entries dropped, lecture:changed { v }`, sv.srv.length === VALID && sv.srv.join() === '20,21,22,23,24,25,26,27,28,29' && sv.changed?.v === 4101 && /^lecture\/list\.php/.test(sv.call) && n === sv.total, JSON.stringify(sv));
  await page.evaluate(() => { G.sys.lecture.open(); });
  await page.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI });
  await page.waitForFunction(() => !!document.querySelector('.lecture-modal .lec-card[data-kind="youtube"] .lec-thumb.has-img'), null, { timeout: T_UI }).catch(() => {});
  const cards = await page.evaluate(() => {
    const m = document.querySelector('.lecture-modal');
    const first = m.querySelector('.lec-card[data-kind="youtube"] .lec-title');
    return { n: m.querySelectorAll('.lec-card').length, title: first.textContent, injected: m.querySelectorAll('.lec-card img[onerror], .lec-title img, .lec-title script').length, thumb: !!m.querySelector('.lec-card[data-kind="youtube"] .lec-thumb.has-img'),
      kinds: [...m.querySelectorAll('.lec-card')].map((c) => c.dataset.kind).join(','), local: !!m.querySelector('.lec-local'), place: m.querySelector('.lec-card[data-kind="youtube"] .lec-place')?.textContent || '' };
  });
  check('the cards: operator lectures first, then the decks; a title with markup is shown as text; the video thumbnail loads', cards.n === VALID + api.list.length && cards.title.includes('<img src=x onerror=alert(40)>') && cards.injected === 0 && cards.thumb && cards.kinds.startsWith('youtube,images,pdf,pptx,pptx,slides,link,youtube,youtube,pptx,deck') && !cards.local, JSON.stringify(cards));
  await shot(page, '03-server-list');

  // ================================================================ video
  await openLecture(page, 20);
  await page.waitForFunction(() => { const f = document.querySelector('.lecture-modal iframe.lec-frame'); return !!f && !!G.sys.audio?._ducks?.has('lecture'); }, null, { timeout: T_UI });
  await page.waitForFunction(() => G.sys.lecture._yt?.heard === true, null, { timeout: T_UI }).catch(() => {});
  const v = await page.evaluate(() => {
    const f = document.querySelector('.lecture-modal iframe.lec-frame');
    return { src: f.src, sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), ref: f.getAttribute('referrerpolicy'), full: f.hasAttribute('allowfullscreen'), title: f.title, heard: G.sys.lecture._yt?.heard === true,
      duck: G.sys.audio._ducks.has('lecture'), links: document.querySelectorAll('.lecture-modal a[href]').length, csp: window.__csp.filter((x) => /frame-src/.test(x.d)) };
  });
  check('video: the frame is youtube-nocookie /embed/<id>?rel=0&modestbranding=1&playsinline=1&hl=ko', v.src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1&hl=ko') && !/autoplay=1/.test(v.src), v.src);
  check('video: sandbox without popups / top navigation, the allow list, a referrer for the player, a title', v.sandbox === 'allow-scripts allow-same-origin allow-presentation' && v.allow === 'autoplay; encrypted-media; fullscreen; picture-in-picture' && v.ref === 'strict-origin-when-cross-origin' && v.full && v.title.length > 0, JSON.stringify(v));
  check('video: the page loads the player frame without a CSP violation; the player and the page talk (state → music ducked)', v.csp.length === 0 && v.heard && v.duck && page.frames().some((f) => /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(f.url())), JSON.stringify({ csp: v.csp, heard: v.heard, duck: v.duck }));
  check('video: no link leaves the app (easy mode default)', v.links === 0);
  await shot(page, '04-video');
  const fr = page.frames().find((f) => /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(f.url()));
  if (fr) await fr.evaluate(() => parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 2, id: 1 }), '*'));
  await page.waitForFunction(() => !G.sys.audio._ducks.has('lecture'), null, { timeout: T_UI }).catch(() => {});
  const paused = await page.evaluate(() => !G.sys.audio._ducks.has('lecture'));
  if (fr) await fr.evaluate(() => parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 1, id: 1 }), '*'));
  await page.waitForFunction(() => G.sys.audio._ducks.has('lecture'), null, { timeout: T_UI }).catch(() => {});
  // a message that is not from the player's origin / window must change nothing
  const spoof = await page.evaluate(async () => { window.postMessage(JSON.stringify({ event: 'onError', info: 150 }), '*'); window.postMessage(JSON.stringify({ event: 'onStateChange', info: 2 }), '*'); await new Promise((r) => setTimeout(r, 300)); return !!document.querySelector('.lecture-modal iframe.lec-frame') && G.sys.audio._ducks.has('lecture'); });
  await page.evaluate(() => G.sys.lecture.close());
  const after = await page.evaluate(() => !G.sys.audio._ducks.has('lecture') && !G.sys.lecture._yt);
  check('video: pausing lets the music back, playing ducks it again, closing releases it; a message from elsewhere is ignored', paused && spoof && after, JSON.stringify({ paused, spoof, after }));
  await openLecture(page, 27);
  await page.waitForSelector('.lecture-modal .lec-notecard', { timeout: T_UI });
  const er = await page.evaluate(() => ({ note: document.querySelector('.lecture-modal .lec-notecard b').textContent, frame: !!document.querySelector('.lecture-modal iframe'), duck: G.sys.audio._ducks.has('lecture') }));
  check('video: an error the player reports → a calm note instead of the frame, the music is back', /볼 수 없어요/.test(er.note) && !er.frame && !er.duck, JSON.stringify(er));
  await shot(page, '05-video-error');

  // ================================================================ the CSP: other hosts are blocked
  const csp = await page.evaluate(async () => {
    const before = window.__csp.length;
    const add = (tag, src) => { const e = document.createElement(tag); e.src = src; e.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0;pointer-events:none'; document.body.appendChild(e); return e; };   // inside the viewport: a frame out of view may wait to load
    const els = [add('iframe', 'https://evil.example/frame'), add('iframe', 'https://www.youtube-nocookie.com.evil.example/embed/x'), add('iframe', 'https://youtube.com/embed/x'), add('img', 'https://evil.example/a.png'), add('img', 'https://img.youtube.com/vi/x/0.jpg')];
    const ok = add('img', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    await new Promise((r) => { ok.onload = ok.onerror = r; setTimeout(r, 4000); });
    await new Promise((r) => setTimeout(r, 600));
    const seen = window.__csp.slice(before);
    for (const e of [...els, ok]) e.remove();
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    return { seen, okLoaded: ok.naturalWidth > 0, meta };
  });
  const blocked = (dir, host) => csp.seen.some((x) => x.d.startsWith(dir) && x.u.includes(host));
  check('CSP: a frame of another host, of a look-alike host and of bare youtube.com is blocked (frame-src)', blocked('frame-src', 'evil.example/frame') || blocked('frame-src', 'https://evil.example'), JSON.stringify(csp.seen).slice(0, 300));
  check('CSP: look-alike and non-listed hosts are blocked too', blocked('frame-src', 'youtube-nocookie.com.evil.example') && blocked('frame-src', 'https://youtube.com'), JSON.stringify(csp.seen).slice(0, 300));
  check('CSP: a picture of another host is blocked (img-src); the video thumbnail host is allowed', blocked('img-src', 'evil.example') && blocked('img-src', 'img.youtube.com') && csp.okLoaded && !csp.seen.some((x) => x.u.includes('i.ytimg.com')), JSON.stringify(csp.seen).slice(0, 300));
  const dir = Object.fromEntries(csp.meta.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
  check('CSP: frame-src is exactly 토스 + this site + the four lecture hosts; connect-src still names no lecture host; default-src none', (dir['frame-src'] || []).join(' ') === "https://*.tosspayments.com 'self' https://www.youtube-nocookie.com https://www.youtube.com https://docs.google.com https://view.officeapps.live.com"
    && !/youtube|google|officeapps|ytimg/.test((dir['connect-src'] || []).join(' ')) && (dir['default-src'] || []).join(' ') === "'none'" && (dir['img-src'] || []).join(' ') === "'self' data: blob: https://i.ytimg.com", `frame-src ${(dir['frame-src'] || []).join(' ')}`);

  // ================================================================ slides frame
  await openLecture(page, 25);
  await page.waitForSelector('.lecture-modal iframe.lec-frame', { timeout: T_UI });
  const sl = await page.evaluate(() => { const f = document.querySelector('.lecture-modal iframe.lec-frame'); return { src: f.src, sandbox: f.getAttribute('sandbox'), ref: f.getAttribute('referrerpolicy') }; });
  check('online slides: the allow-listed address in a sandboxed frame', sl.src.startsWith('https://docs.google.com/presentation/d/e/') && sl.sandbox === 'allow-scripts allow-same-origin allow-presentation' && sl.ref === 'no-referrer', JSON.stringify(sl));
  await shot(page, '06-slides-frame');

  // ================================================================ image deck
  await openLecture(page, 21);
  await page.waitForFunction(() => { const i = document.querySelector('.lecture-modal img.lec-img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: T_UI });
  const im0 = await page.evaluate(() => { const i = document.querySelector('.lecture-modal img.lec-img'); return { src: i.getAttribute('src'), w: i.naturalWidth, alt: i.alt, count: document.querySelector('.lec-count').textContent }; });
  check('image deck: the first picture comes from api/lecture/file.php?id=&n= of this site; "1 / 3"', /api\/lecture\/file\.php\?id=21&n=0$/.test(im0.src) && im0.w === 640 && /슬라이드 1/.test(im0.alt) && im0.count === '1 / 3', JSON.stringify(im0));
  await shot(page, '07-image-deck');
  // a swipe to the left = the next slide (touch pointer events on the stage)
  const sw = await page.evaluate(async () => {
    const st = document.querySelector('.lecture-modal .lec-stage'), r = st.getBoundingClientRect();
    const fire = (type, x) => st.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: r.top + r.height / 2, bubbles: true }));
    fire('pointerdown', r.left + r.width * 0.8); fire('pointerup', r.left + r.width * 0.3);
    await new Promise((r2) => setTimeout(r2, 100));
    const a = document.querySelector('.lec-count').textContent;
    fire('pointerdown', r.left + r.width * 0.3); fire('pointerup', r.left + r.width * 0.32);   // a tap is not a swipe
    const b = document.querySelector('.lec-count').textContent;
    fire('pointerdown', r.left + r.width * 0.2); fire('pointerup', r.left + r.width * 0.8);
    await new Promise((r2) => setTimeout(r2, 100));
    return { a, b, c: document.querySelector('.lec-count').textContent, src: document.querySelector('img.lec-img').getAttribute('src') };
  });
  check('image deck: swipe left = next, a tap does nothing, swipe right = back', sw.a === '2 / 3' && sw.b === '2 / 3' && sw.c === '1 / 3', JSON.stringify(sw));

  // ================================================================ pdf
  await openLecture(page, 22);
  await page.waitForSelector('.lecture-modal iframe.lec-pdf', { timeout: T_UI });
  const pd = await page.evaluate(() => { const f = document.querySelector('.lecture-modal iframe.lec-pdf'); return { src: f.getAttribute('src'), sandbox: f.hasAttribute('sandbox'), btn: !!document.querySelector('.lecture-modal .lec-out'), links: document.querySelectorAll('.lecture-modal a[href]').length }; });
  check('pdf: a same-origin frame of api/lecture/file.php (the browser\'s viewer), with a "새 창으로" button and no link', /^api\/lecture\/file\.php\?id=22&n=0#view=FitH$/.test(pd.src) && !pd.sandbox && pd.btn && pd.links === 0, JSON.stringify(pd));
  await shot(page, '08-pdf');
  await tap(page, '.lecture-modal .lec-out');
  const gateUp = await page.waitForFunction(() => !!G.ui.modal.get('easy-gate'), null, { timeout: T_UI }).then(() => true, () => false);
  const before = await page.evaluate(() => window.__opened.length);
  const passed = gateUp ? await solveGate(page) : false;
  await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: T_UI }).catch(() => {});
  const opened = await page.evaluate(() => window.__opened.slice());
  check('pdf: "새 창으로 크게 보기" asks the grown-up gate first (easy mode); only after it the file of this site opens in a new tab', gateUp && before === 0 && passed && opened.length === 1 && /api\/lecture\/file\.php\?id=22&n=0$/.test(opened[0]), JSON.stringify({ gateUp, before, passed, opened }));

  // ================================================================ pptx: the simple view
  await page.evaluate(() => { window.__blobs = []; const real = URL.createObjectURL; URL.createObjectURL = function (b) { const u = real.call(URL, b); window.__blobs.push(u); return u; }; });
  await openLecture(page, 23);
  await page.waitForSelector('.lecture-modal .lec-deck .lec-slide', { timeout: T_UI });
  await page.waitForFunction(() => [...document.querySelectorAll('.lecture-modal .lec-slide img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: T_UI }).catch(() => {});
  const p1 = await page.evaluate(() => {
    const c = document.querySelector('.lecture-modal .lec-slide');
    const ps = [...c.querySelectorAll('.lec-p')];
    return { title: c.querySelector('.lec-s-title')?.textContent, ps: ps.map((p) => [p.className, p.textContent]), imgs: [...c.querySelectorAll('.lec-s-pics img')].map((i) => [i.src.slice(0, 5), i.naturalWidth, i.alt]),
      injected: c.querySelectorAll('img[onerror], script').length, count: document.querySelector('.lec-count').textContent, note: document.querySelector('.lecture-modal .lec-note')?.textContent || '', num: c.querySelector('.lec-s-num')?.textContent,
      fits: c.scrollHeight <= c.clientHeight + 2, fetched: window.__lecCalls.length };
  });
  check('pptx: a presentation built in this test opens in the simple view — slide 1 with its title, three paragraphs on three levels', p1.title === '전통 발효 이야기' && p1.ps.length === 3 && /lv0 lec-b-dot/.test(p1.ps[0][0]) && /lv1 lec-b-dot/.test(p1.ps[1][0]) && /lv2 lec-b-dot/.test(p1.ps[2][0]) && p1.count === '1 / 5' && p1.num === '1 / 5', JSON.stringify(p1).slice(0, 400));
  check('pptx: the pictures of the slide are shown in order from blob: addresses; markup in a paragraph stays text', p1.imgs.length === 2 && p1.imgs.every((i) => i[0] === 'blob:' && i[1] === 160) && p1.imgs[0][2] === '그림 1' && p1.injected === 0 && p1.ps[2][1].includes('<img src=x onerror=alert(41)>'), JSON.stringify(p1.imgs));
  check('pptx: the note "간단 보기 — 원본과 모양이 다를 수 있어요" is shown and the slide fits its card', /간단 보기 — 원본과 모양이 다를 수 있어요/.test(p1.note) && p1.fits, p1.note);
  await shot(page, '09-pptx-slide1');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.lec-count')?.textContent === '2 / 5', null, { timeout: T_UI });
  const p2 = await page.evaluate(() => { const c = document.querySelector('.lecture-modal .lec-slide'); return { title: c.querySelector('.lec-s-title')?.textContent, nums: [...c.querySelectorAll('.lec-p.lec-b-num')].map((p) => [p.dataset.n, p.textContent]), bold: c.querySelector('.lec-p .lec-em-b')?.textContent, rows: [...c.querySelectorAll('.lec-table tr')].map((r) => [...r.children].map((x) => `${x.tagName}:${x.textContent}`).join(',')) }; });
  check('pptx: a numbered text box (1. 2. 3., bold kept) and a table with its header row', p2.title === '장 담그는 차례' && p2.nums.map((x) => x[0]).join() === '1.,2.,3.' && p2.bold === '메주를 씻어요' && p2.rows.length === 3 && p2.rows[0] === 'TH:재료,TH:양' && p2.rows[2] === 'TD:소금,TD:200 g', JSON.stringify(p2));
  await shot(page, '10-pptx-slide2-table');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.lec-count')?.textContent === '4 / 5', null, { timeout: T_UI });
  const p4 = await page.evaluate(() => { const c = document.querySelector('.lecture-modal .lec-slide'); return { empty: c.classList.contains('lec-s-empty'), text: c.textContent }; });
  check('pptx: a slide with nothing readable shows a calm card with its number', p4.empty && /간단 보기로는 보여 줄 수 없어요/.test(p4.text) && /4 \/ 5/.test(p4.text), p4.text);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.lec-count')?.textContent === '5 / 5', null, { timeout: T_UI });
  await page.waitForTimeout(250);
  const p5 = await page.evaluate(() => { const c = document.querySelector('.lecture-modal .lec-slide'); return { k: Number(getComputedStyle(c).getPropertyValue('--k')), over: c.scrollHeight - c.clientHeight, lines: c.querySelectorAll('.lec-p').length }; });
  check('pptx: a slide with 14 long lines is shrunk to fit (or scrolls inside its card), nothing is cut off', p5.lines === 14 && p5.k < 1 && p5.k >= 0.6, JSON.stringify(p5));
  await shot(page, '11-pptx-slide5-long');
  const blobs = await page.evaluate(() => window.__blobs.slice());
  await page.evaluate(() => G.sys.lecture.close());
  await page.waitForTimeout(200);
  // (a picture element tells: the page's policy lets img-src use blob: addresses, fetch() of one is not allowed anyway)
  const revoked = await page.evaluate(async (list) => { let alive = 0; for (const u of list) { await new Promise((r) => { const i = new Image(); i.onload = () => { alive++; r(); }; i.onerror = r; i.src = u; setTimeout(r, 3000); }); } return alive; }, blobs);
  check(`pptx: the ${blobs.length} picture addresses are revoked when the player closes`, blobs.length >= 2 && revoked === 0, `${revoked} still alive`);
  await openLecture(page, 24);
  await page.waitForSelector('.lecture-modal .lec-notecard', { timeout: T_UI });
  const bomb = await page.evaluate(() => ({ note: document.querySelector('.lecture-modal .lec-notecard b').textContent, deck: !!document.querySelector('.lecture-modal .lec-deck'), btn: !!document.querySelector('.lecture-modal .lec-notecard .lec-out') }));
  check(`pptx: a zip bomb (100 MB of pictures in ${Math.round(BOMB.length / 1024)} KB) is refused while unpacking → a calm note, no viewer`, /간단 보기로 열 수 없어요/.test(bomb.note) && !bomb.deck && bomb.btn, JSON.stringify(bomb));
  await shot(page, '12-pptx-refused');
  await openLecture(page, 29);
  await page.waitForSelector('.lecture-modal .lec-notecard', { timeout: T_UI });
  check('pptx: a file the server no longer has → the note "열지 못했어요"', /열지 못했어요/.test(await page.evaluate(() => document.querySelector('.lecture-modal .lec-notecard b').textContent)));

  // ================================================================ link
  await page.evaluate(() => { window.__opened.length = 0; G.easy.lockGate?.('test'); });
  await openLecture(page, 26);
  await page.waitForSelector('.lecture-modal .lec-notecard .lec-out', { timeout: T_UI });
  const lk = await page.evaluate(() => ({ frames: document.querySelectorAll('.lecture-modal iframe').length, anchors: document.querySelectorAll('.lecture-modal a[href]').length, host: document.querySelector('.lecture-modal .lec-hostname')?.textContent }));
  check('link: never framed, no anchor — a button and the host name as text', lk.frames === 0 && lk.anchors === 0 && lk.host === 'www.weather.go.kr', JSON.stringify(lk));
  await shot(page, '13-link');
  await page.evaluate(() => { const s = G.easy; if (s?._gate) s._gate.sess = null; });
  await tap(page, '.lecture-modal .lec-notecard .lec-out');
  const g2 = await page.waitForFunction(() => !!G.ui.modal.get('easy-gate') || window.__opened.length > 0, null, { timeout: T_UI }).then(() => true, () => false);
  const st2 = await page.evaluate(() => ({ gate: !!G.ui.modal.get('easy-gate'), opened: window.__opened.slice() }));
  if (st2.gate) await solveGate(page);
  await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: T_UI }).catch(() => {});
  const o2 = await page.evaluate(() => window.__opened.slice());
  check('link: the address opens in a new tab only through the button (behind the grown-up gate while it is locked)', g2 && o2.length === 1 && o2[0] === 'https://www.weather.go.kr/w/index.do', JSON.stringify({ st2, o2 }));
  await page.evaluate(() => G.sys.lecture.close());

  // ================================================================ rooms: screen(ctx, spec)
  const scr = await page.evaluate(async () => {
    const L = G.sys.lecture, owned = [], interacts = [];
    const group = new THREE.Group();
    const ctx = { id: 'PL_SARANG', group, low: false, own: (t) => { owned.push(t); return t; }, interact: (s) => { interacts.push(s); return {}; } };
    const before = L._screens.size;
    const g = L.screen(ctx, { x: 1, y: 1.7, z: -2, rotY: Math.PI / 2, w: 2.4, h: 1.35, stand: true });
    const face = g.getObjectByName('lecture-screen-face');
    const px = (tex) => { const c = tex.image.getContext('2d'); const d = c.getImageData(0, 0, tex.image.width, tex.image.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 500) lit++; return lit; };
    const lit1 = px(face.material.map), v1 = face.material.map.version;
    const spec = interacts[0];
    spec.onInteract();
    await new Promise((r) => setTimeout(r, 150));
    const opened = { open: L.isOpen(), lec: L._view?.lec?.id };
    L.close();
    // the room's lecture changes → the card is drawn again
    window.__lecList.lectures.find((x) => x && x.id === 21).place = 'PL_SARANG';
    window.__lecList.v = 4102;
    await L.refresh({ force: true });
    await new Promise((r) => setTimeout(r, 400));
    const res = { name: g.name, inGroup: group.children.includes(g), pos: [g.position.x, g.position.y, g.position.z, +g.rotation.y.toFixed(3)], guard: face.userData.guardSkip === true, tex: face.material.map.image.width + 'x' + face.material.map.image.height,
      lit1, redrawn: face.material.map.version > v1, kind: spec.kind, label: spec.label, kid: spec.kidLabel, radius: spec.radius, ipos: spec.position, opened, after: L.forPlace('PL_SARANG').id, registered: L._screens.size - before, owned: owned.length, meshes: g.children.length };
    for (const o of owned) o.dispose?.();
    res.released = L._screens.size === before;
    return res;
  });
  check('screen(ctx, spec): a framed screen (with legs) in the room\'s group at the given place, a lit title card on a canvas, marked for the render guard', scr.name === 'lecture-screen' && scr.inGroup && scr.pos.join() === '1,1.7,-2,1.571' && scr.guard && scr.tex === '1024x576' && scr.lit1 > 20 && scr.meshes === 5, JSON.stringify(scr).slice(0, 300));
  check('screen: the interactable 🎬 강의 보기 stands in front of it and opens the room\'s lecture (here the one for every room)', scr.kind === 'lecture' && scr.label === '강의 보기' && scr.kid === '강의 보기' && scr.radius >= 2.6 && Math.abs(scr.ipos.x - 2.1) < 0.01 && scr.opened.open && scr.opened.lec === 21, JSON.stringify({ ipos: scr.ipos, opened: scr.opened }));
  check('screen: lecture:changed redraws the card; disposing the room releases it', scr.redrawn && scr.after === 21 && scr.registered === 1 && scr.owned >= 3 && scr.released, JSON.stringify({ redrawn: scr.redrawn, registered: scr.registered, released: scr.released }));
  await page.evaluate(async () => { window.__lecList.lectures.find((x) => x && x.id === 21).place = '*'; window.__lecList.v = 4103; await G.sys.lecture.refresh({ force: true }); });

  // ================================================================ rooms: a throwaway room with a real screen, the card, auto-open
  const room = await page.evaluate(async () => {
    const P = G.sys.places, K = G.hanok;
    if (!P || !K?.room) return { skip: 'no places / hanok kit in this build' };
    P.define({ id: 'PL_LECTEST', name: '시험 강의실', kidName: '강의실', emoji: '🎓', zoneId: 'ZONE_PL_LECTEST', origin: { x: 1400, z: 2000 }, size: { w: 8, d: 6, h: 3.4 }, spawn: { x: 0, z: 1.6, rotY: Math.PI },
      exit: { x: 0, z: 9, rotY: 0 }, camera: { ceil: 2.4 },
      build(ctx) {
        const R = K.room(ctx, { w: 8, d: 6, post: 2.5, ridge: 3.4, bays: { x: 3, z: 2 }, floor: 'maru', roof: 'ceiling', walls: { N: ['plaster', 'plaster', 'plaster'], E: [{ door: 'changho', exit: true }, 'plaster'], S: ['plaster', { window: 'ttisal' }, 'plaster'], W: ['plaster', 'plaster'] } });
        window.__roomScreen = G.sys.lecture.screen(ctx, { x: 0, y: 1.55, z: -2.82, rotY: 0, w: 2.6, h: 1.46 });
        R.finish({ exit: { x: 3.6, z: -0.75 } });
        return { dispose() {} };
      } });
    window.__lecList.lectures.find((x) => x && x.id === 20).place = 'PL_LECTEST';
    window.__lecList.v = 4104;
    await G.sys.lecture.refresh({ force: true });
    const ok = await P.enter('PL_LECTEST', { fade: false });
    return { ok, cur: P.current, screen: !!window.__roomScreen };
  });
  if (room.skip) check('rooms: a throwaway room', false, room.skip);
  else {
    await page.waitForSelector('#lecture-offer', { timeout: T_UI }).catch(() => {});
    const of = await page.evaluate(() => { const o = document.getElementById('lecture-offer'); if (!o) return null; const b = o.querySelector('.lec-offer-go').getBoundingClientRect(), x = o.querySelector('.lec-offer-x').getBoundingClientRect(); return { text: o.textContent, bh: Math.round(b.height), xw: Math.round(x.width), xh: Math.round(x.height), say: o.querySelector('.lec-offer-go').dataset.say, modal: G.ui.modal.isOpen(), inView: b.bottom <= innerHeight && b.top >= 0 }; });
    check('place:enter: a room with a lecture shows the card "▶ 강의 보기" (≥ 56 px targets, a spoken line), nothing opens by itself', room.ok && room.screen && !!of && /강의 보기/.test(of.text) && of.bh >= 56 && of.xw >= 56 && of.xh >= 56 && /강의 보기/.test(of.say) && !of.modal && of.inView, JSON.stringify(of));
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { G.sys.camera?.snap?.(); } catch (e) { /* optional */ } });
    await shot(page, '14-room-screen-and-offer');
    await tap(page, '#lecture-offer .lec-offer-go');
    await page.waitForSelector('.lecture-modal iframe.lec-frame', { timeout: T_UI });
    const viaOffer = await page.evaluate(() => ({ lec: G.sys.lecture._view?.lec?.id, offer: !!document.getElementById('lecture-offer'), src: document.querySelector('.lecture-modal iframe.lec-frame').src }));
    check('the card opens that lecture (started by a tap: not muted) and leaves', viaOffer.lec === 20 && !viaOffer.offer && !/mute=1/.test(viaOffer.src), JSON.stringify(viaOffer));
    await page.evaluate(() => G.sys.lecture.close());
    await page.evaluate(async () => { await G.sys.places.exit({ fade: false }); });
    check('place:exit removes the card', await page.evaluate(() => !document.getElementById('lecture-offer') && !G.sys.places.current));
    // auto-open: PL_ANBANG has lecture 28 with autoplay
    const hasAnbang = await page.evaluate(() => !!G.sys.places.def('PL_ANBANG'));
    if (hasAnbang) {
      await page.evaluate(async () => {
        // a trace of who opens and closes dialogs meanwhile (shown when the check fails)
        window.__mtrace = [];
        const M = G.ui.modal, L = G.sys.lecture, t0 = performance.now();
        const tr = (what) => window.__mtrace.push(`${Math.round(performance.now() - t0)} ${what} ${(new Error().stack || '').split('\n').slice(2, 4).map((x) => x.trim().replace(/^at /, '').slice(0, 60)).join(' < ')}`);
        for (const k of ['open', 'close', 'closeAll']) { const f = M[k]; if (typeof f === 'function') M[k] = function (...a) { tr(`modal.${k} ${a[0]?.id || (typeof a[0] === 'string' ? a[0] : '')}`); return f.apply(this, a); }; }
        const lo = L.open, lc = L.close; L.open = function (...a) { tr(`lecture.open ${a[0]} ${JSON.stringify(a[1] || {})}`); return lo.apply(this, a); }; L.close = function (...a) { tr('lecture.close'); return lc.apply(this, a); };
        G.bus.on('place:enter', (p) => tr(`place:enter ${p?.id}`));
        await G.sys.places.enter('PL_ANBANG', { fade: false });
        tr(`entered cur=${G.sys.places.current}`);
      });
      const auto = await page.waitForSelector('.lecture-modal iframe.lec-frame', { timeout: T_UI }).then(() => true, () => false);
      const a1 = await page.evaluate(() => ({ lec: G.sys.lecture._view?.lec?.id, src: document.querySelector('.lecture-modal iframe.lec-frame')?.src || '', note: document.querySelector('.lecture-modal .lec-note')?.textContent || '', trace: window.__mtrace.slice(0, 14) }));
      check('autoplay: entering the room opens its lecture by itself, the video starts muted and says so', auto && a1.lec === 28 && /autoplay=1/.test(a1.src) && /mute=1/.test(a1.src) && /소리가 꺼진 채/.test(a1.note), JSON.stringify(a1).slice(0, 1500));
      await shot(page, '15-auto-open');
      await page.evaluate(async () => { G.sys.lecture.close(); await G.sys.places.exit({ fade: false }); await G.sys.places.enter('PL_ANBANG', { fade: false }); });
      await page.waitForSelector('#lecture-offer', { timeout: T_UI }).catch(() => {});
      const a2 = await page.evaluate(() => ({ modal: G.sys.lecture.isOpen(), offer: !!document.getElementById('lecture-offer') }));
      check('autoplay: only once per visit — coming back shows the card instead', !a2.modal && a2.offer, JSON.stringify(a2));
      await page.evaluate(async () => { await G.sys.places.exit({ fade: false }); G.sys.lecture._autoSeen.clear(); window.__lecList.opt.autoOpen = false; window.__lecList.v = 4105; await G.sys.lecture.refresh({ force: true }); await G.sys.places.enter('PL_ANBANG', { fade: false }); });
      await page.waitForSelector('#lecture-offer', { timeout: T_UI }).catch(() => {});
      const a3 = await page.evaluate(() => ({ modal: G.sys.lecture.isOpen(), offer: !!document.getElementById('lecture-offer') }));
      check('the operator\'s switch (opt.autoOpen = false): nothing opens by itself, the card is offered', !a3.modal && a3.offer, JSON.stringify(a3));
      await page.evaluate(async () => { await G.sys.places.exit({ fade: false }); });
    } else check('autoplay (PL_ANBANG is not in this build)', false, 'no PL_ANBANG');
  }

  // ================================================================ easy mode sizes, the menus
  await page.evaluate(() => { G.sys.lecture.open(); });
  await page.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI });
  const easy = await page.evaluate(async () => {
    const small = [];
    const scan = (where) => { for (const b of document.querySelectorAll('.lecture-modal button')) { const r = b.getBoundingClientRect(); if (r.width === 0 || b.classList.contains('easy-hide')) continue; if (b.matches('.easy-back, .easy-speak')) continue; /* the dialog's own chrome (04-ui / 08-easy: ≥ 44 px, the kid-audit rule) */ if (getComputedStyle(b).display === 'none') continue; if (b.offsetHeight < 55.5 || b.offsetWidth < 55.5) small.push(`${where}: ${b.className.split(' ').pop() || b.textContent.trim().slice(0, 8)} ${b.offsetWidth}×${b.offsetHeight}`);   /* layout size: an entering view may still be scaled */ } };
    scan('list');
    const inputs = document.querySelectorAll('.lecture-modal input, .lecture-modal textarea, .lecture-modal select').length;
    G.sys.lecture.open(G.sys.lecture.list().find((l) => l.kind === 'deck').id);
    await new Promise((r) => setTimeout(r, 200));
    scan('deck');
    const speak = !!document.querySelector('.lecture-modal .lec-tool[aria-label="소리로 듣기"]');
    const says = [...document.querySelectorAll('.lecture-modal button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.dataset.say && !b.getAttribute('aria-label')).map((b) => b.className);
    return { easy: document.body.classList.contains('easy'), small, inputs, speak, says, anchors: document.querySelectorAll('.lecture-modal a[href]').length };
  });
  check('easy mode: every button of the panel is at least 56 px, nothing to type, a 🔊 button on slides, no link out', easy.easy && easy.small.length === 0 && easy.inputs === 0 && easy.speak && easy.anchors === 0, JSON.stringify(easy).slice(0, 300));
  await shot(page, '16-easy-deck');
  await page.evaluate(() => G.sys.lecture.close());
  const menu = await page.evaluate(async () => {
    G.app.openMenu();
    await new Promise((r) => setTimeout(r, 400));
    const tile = [...document.querySelectorAll('#modal-root button')].find((b) => /강의실/.test(b.textContent));
    if (!tile) return { tile: false };
    tile.click();
    await new Promise((r) => setTimeout(r, 900));
    const open = G.sys.lecture.isOpen();
    G.ui.modal.closeAll();
    return { tile: true, open };
  });
  check('the kid menu has the tile 🎓 강의실 and it opens the panel', menu.tile && menu.open, JSON.stringify(menu));
  const dc = await page.evaluate(() => { const s = G.sys.devcenter?.kidScreens?.() || []; return s.filter((x) => /^lec/.test(x.id)).map((x) => `${x.id}:${x.available}`); });
  check('the developer centre lists the three lecture screens for the kid audit', dc.join() === 'lecture:true,lecdeck:true,lecvideo:true', dc.join());
  check('no page error, no console error on the desktop page', page.__errors.length === 0, page.__errors.slice(0, 3).join(' | '));
  await context.close();

  // ================================================================ normal mode
  {
    const { context: c2, page: p2 } = await newPage({}, 'autostart=1&notutorial=1&quality=low&lecture=on');
    await p2.evaluate(() => { G.setSetting('easyMode', false); });
    await p2.waitForFunction(() => document.body.classList.contains('easy-off'), null, { timeout: T_UI }).catch(() => {});
    await serverMode(p2);
    await openLecture(p2, 26);
    await p2.waitForSelector('.lecture-modal .lec-notecard .lec-out', { timeout: T_UI });
    await tap(p2, '.lecture-modal .lec-notecard .lec-out');
    await p2.waitForFunction(() => window.__opened.length > 0, null, { timeout: T_UI }).catch(() => {});
    const nm = await p2.evaluate(() => ({ opened: window.__opened.slice(), gate: !!G.ui.modal.get('easy-gate'), easy: document.body.classList.contains('easy') }));
    check('normal mode: the grown-up link opens straight away (no gate), still only as a new tab', !nm.easy && !nm.gate && nm.opened.length === 1 && nm.opened[0] === 'https://www.weather.go.kr/w/index.do', JSON.stringify(nm));
    await openLecture(p2, 23);
    await p2.waitForSelector('.lecture-modal .lec-deck .lec-slide', { timeout: T_UI });
    await shot(p2, '17-normal-pptx');
    check('normal mode: no page error', p2.__errors.length === 0, p2.__errors.slice(0, 3).join(' | '));
    await c2.close();
  }

  // ================================================================ a phone
  {
    const { context: c3, page: p3 } = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await serverMode(p3);
    await p3.evaluate(() => { G.sys.lecture.open(); });
    await p3.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI });
    const ph = await p3.evaluate(() => { const g = document.querySelector('.lec-grid'), cards = [...g.querySelectorAll('.lec-card')]; const r0 = cards[0].getBoundingClientRect(), r1 = cards[1].getBoundingClientRect(); const m = document.querySelector('.modal.lecture-modal').getBoundingClientRect();
      return { cols: Math.abs(r0.top - r1.top) < 4 ? 2 : 1, w: Math.round(r0.width), overflowX: document.documentElement.scrollWidth > innerWidth + 1, modalW: Math.round(m.width), minH: Math.min(...cards.map((c) => c.getBoundingClientRect().height)) }; });
    check('phone (390 × 844): two cards a row, no sideways scrolling, cards are big enough to tap', ph.cols === 2 && !ph.overflowX && ph.modalW <= 390 && ph.minH >= 56, JSON.stringify(ph));
    await shot(p3, '18-phone-list');
    await openLecture(p3, 23);
    await p3.waitForSelector('.lecture-modal .lec-deck .lec-slide', { timeout: T_UI });
    await p3.waitForTimeout(300);
    const pd3 = await p3.evaluate(() => { const c = document.querySelector('.lecture-modal .lec-slide'), cr = c.getBoundingClientRect(), st = document.querySelector('.lec-stage').getBoundingClientRect(), nav = [...document.querySelectorAll('.lec-nav, .lec-tool')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
      return { card: Math.round(cr.width) + 'x' + Math.round(cr.height), inView: st.right <= innerWidth + 1 && st.left >= -1 && cr.right <= innerWidth + 1, fits: c.scrollHeight <= c.clientHeight + 2, tall: cr.width / cr.height <= 16 / 9 + 0.05, nav, font: parseFloat(getComputedStyle(c.querySelector('.lec-p')).fontSize) }; });
    check('phone: the slide card stays inside the screen and is at least 16:9 tall (it grows with its words before it scrolls), readable text (≥ 11 px), 64 px buttons', pd3.inView && pd3.fits && pd3.tall && pd3.nav.every((x) => x >= 56) && pd3.font >= 11, JSON.stringify(pd3));
    await shot(p3, '19-phone-pptx');
    await openLecture(p3, 22);
    await p3.waitForSelector('.lecture-modal .lec-host', { timeout: T_UI });
    await p3.waitForTimeout(200);
    const pp = await p3.evaluate(() => ({ frame: !!document.querySelector('.lecture-modal iframe'), card: document.querySelector('.lecture-modal .lec-notecard b')?.textContent || '', btn: !!document.querySelector('.lecture-modal .lec-notecard .lec-out') }));
    check('phone: a pdf is not framed — a card with the "새 창으로" button (behind the gate)', !pp.frame && /새 창에서/.test(pp.card) && pp.btn, JSON.stringify(pp));
    await shot(p3, '20-phone-pdf');
    check('phone: no page error', p3.__errors.length === 0, p3.__errors.slice(0, 3).join(' | '));
    await c3.close();
  }

  // ================================================================ a deep link, and automation without ?lecture=on
  {
    const DEEP = api.list[0].id;   // a built-in deck of this build ('deck:…')
    const { context: c4, page: p4 } = await newPage({}, `autostart=1&notutorial=1&quality=low&lecture=${encodeURIComponent(DEEP)}`, { keep: true });
    await p4.waitForSelector('.lecture-modal .lec-deck .lec-slide', { timeout: T_UI }).catch(() => {});
    const dl = await p4.evaluate(() => ({ open: G.sys.lecture.isOpen(), id: G.sys.lecture._view?.lec?.id ?? null }));
    check('?lecture=<id> opens that lecture once the visitor is in (the admin tab\'s preview link)', dl.open && dl.id === DEEP, JSON.stringify(dl));
    await p4.evaluate(() => { G.ui.modal.closeAll(); const L = G.sys.lecture; L._pending = 987654; L._deepLink(); });
    await p4.waitForSelector('.lecture-modal .lec-card', { timeout: T_UI }).catch(() => {});
    check('?lecture=<id> of a lecture that is not there opens the list with a calm word', await p4.evaluate(() => G.sys.lecture.isOpen() && !G.sys.lecture._view));
    await p4.evaluate(() => G.ui.modal.closeAll());
    const quiet = await p4.evaluate(async () => {
      const L = G.sys.lecture;
      const d = L.list().find((l) => l.kind === 'deck');
      d.place = 'PL_DAECHEONG';
      if (!G.sys.places?.def?.('PL_DAECHEONG')) return { skip: true };
      await G.sys.places.enter('PL_DAECHEONG', { fade: false });
      await new Promise((r) => setTimeout(r, 1800));
      const r = { offer: !!document.getElementById('lecture-offer'), modal: L.isOpen(), auto: L._auto() };
      await G.sys.places.exit({ fade: false });
      return r;
    });
    check('under automation without ?lecture=on a room shows no card and opens nothing (existing suites keep their behaviour)', quiet.skip || (!quiet.offer && !quiet.modal && quiet.auto === false), JSON.stringify(quiet));
    check('deep link page: no page error', p4.__errors.length === 0, p4.__errors.slice(0, 3).join(' | '));
    await c4.close();
  }
  check('the page asked the outside only for the video player, its thumbnails and the slide host (and the blocked test addresses)', outside.every((u) => /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|i\.ytimg\.com\/vi\/|docs\.google\.com\/presentation\/|evil\.example\/|www\.youtube-nocookie\.com\.evil\.example\/|youtube\.com\/embed\/|img\.youtube\.com\/)/.test(u)), [...new Set(outside.map((u) => new URL(u).host))].join(' '));
} catch (e) {
  check('the suite ran to its end', false, String(e?.stack || e).slice(0, 600));
  // what the page showed when it stopped (for the report)
  try { const pg = browser.contexts()[0]?.pages()[0]; if (pg && SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'zz-stopped.png') }); } catch (e2) { /* no page */ }
  exit = 2;
} finally {
  await browser.close().catch(() => {});
  server.close();
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${failed.length ? '✖' : '✔'} lecture-client: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? (exit || 1) : 0);
