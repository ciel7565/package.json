#!/usr/bin/env node
// [opt] tests/opt-pwa.mjs — the installable page of a server copy, without a browser (tools/pwa.mjs, CONTRACT §18.6)
//
//   node tests/opt-pwa.mjs
//
//   P1  writeInstallable writes the manifest, the worker, the offline page and four icons
//   P2  the manifest: name / short_name / start_url "./" / scope "./" / standalone / colours / 192 + 512 + maskable icons
//   P3  every icon is a real PNG of the size the manifest says (IHDR), RGBA, and not empty (the jar is drawn)
//   P4  offline.html runs no script, has its own strict CSP, two big links (≥ 56 px), calm Korean text
//   P5  the worker, run in a stand-in for a service worker scope: install caches exactly the shell; activate removes
//       older shells; the page is fetched from the network first; offline it answers offline.html, or the stored page
//       for ?local=1; it never answers the API, the admin site, uploads, data or any .php (no respondWith)
//   P6  src/template.html registers the worker and links the manifest only in server mode (G.net.mode === 'server')
// Exit 0 = all pass, 1 = a check failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { writeInstallable } from '../tools/pwa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-pwa-'));
const r = writeInstallable(dir, { version: 'test1234' });
const want = ['manifest.webmanifest', 'sw.js', 'offline.html', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
check('P1 the files are written', want.every((f) => fs.existsSync(path.join(dir, f))) && want.every((f) => r.files.includes(f)), r.files.join(', '));

// P2
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
check('P2 manifest fields', man.name && man.short_name && man.start_url === './' && man.scope === './' && man.display === 'standalone' && /^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color) && man.lang === 'ko', `${man.short_name} · ${man.display}`);
const sizes = man.icons.map((i) => `${i.sizes}/${i.purpose}`);
check('P2 manifest icons: 192, 512 and a maskable 512', sizes.includes('192x192/any') && sizes.includes('512x512/any') && sizes.includes('512x512/maskable'), sizes.join(' '));

// P3
const bad3 = [];
for (const ic of [...man.icons, { src: 'icons/icon-180.png', sizes: '180x180' }]) {
  const b = fs.readFileSync(path.join(dir, ic.src));
  const sig = b.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], type = b[25];
  const [ew, eh] = ic.sizes.split('x').map(Number);
  if (!sig || w !== ew || h !== eh || depth !== 8 || type !== 6 || b.length < 1500) bad3.push(`${ic.src}: ${w}x${h} ${b.length} B`);
}
check('P3 icons are RGBA PNGs of the stated size', bad3.length === 0, bad3.join('; ') || '4 icons');

// P4
const off = fs.readFileSync(path.join(dir, 'offline.html'), 'utf8');
check('P4 offline.html runs no script and has a strict CSP', !/<script/i.test(off) && /Content-Security-Policy" content="default-src 'none'/.test(off) && /form-action 'none'/.test(off));
check('P4 offline.html: two big links (min-height 56px) and calm Korean text', (off.match(/<a class=/g) || []).length === 2 && /min-height: 56px/.test(off) && /인터넷 연결을 기다리고 있어요/.test(off) && /href="\.\/\?local=1"/.test(off));

// P5 — the worker in a stand-in scope
const swSrc = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
const ORIGIN = 'https://school.example', SCOPE_PATH = '/metaverse/';
const store = new Map();   // cache name → Map(url → body)
const net = { online: true, calls: [] };
const abs = (u) => new URL(u, ORIGIN + SCOPE_PATH + 'sw.js').href;
class Req { constructor(u, o = {}) { this.url = abs(typeof u === 'string' ? u : u.url); this.method = o.method || 'GET'; this.mode = o.mode || 'cors'; } }
const caches = {
  open: async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      addAll: async (reqs) => { for (const q of reqs) { const u = abs(q.url || q); net.calls.push(u); m.set(u, `body of ${u}`); } },
      match: async (q) => m.get(abs(typeof q === 'string' ? q : q.url)) || undefined,
      put: async (q, v) => { m.set(abs(q.url || q), v); },
    };
  },
  keys: async () => [...store.keys()],
  delete: async (k) => store.delete(k),
};
const listeners = {};
const self = { location: new URL(ORIGIN + SCOPE_PATH + 'sw.js'), addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
const ctx = vm.createContext({ self, caches, URL, Request: Req, Promise, decodeURIComponent, fetch: async (q) => { net.calls.push(q.url); if (!net.online) throw new TypeError('offline'); return `network ${q.url}`; } });
let swOk = true;
try { vm.runInContext(swSrc, ctx); } catch (e) { swOk = false; check('P5 the worker runs', false, e.message); }
if (swOk) {
  const run = async (type, extra) => { let p = null; const ev = { ...extra, waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; ev.answered = true; } }; listeners[type](ev); const v = await p; return { v, answered: !!ev.answered }; };
  store.set('tfm-shell-old', new Map([['x', 'y']]));
  await run('install', {});
  const shell = store.get('tfm-shell-test1234');
  check('P5 install stores the shell', shell && shell.has(abs('./')) && shell.has(abs('offline.html')) && shell.has(abs('manifest.webmanifest')) && shell.size === 7, shell ? [...shell.keys()].map((u) => u.replace(ORIGIN, '')).join(' ') : 'no cache');
  await run('activate', {});
  check('P5 activate removes older shells', !store.has('tfm-shell-old') && store.has('tfm-shell-test1234'));
  const fetchEv = (u, mode = 'cors', method = 'GET') => run('fetch', { request: new Req(ORIGIN + u, { mode, method }) });
  let x = await fetchEv(SCOPE_PATH, 'navigate');
  check('P5 online: the page comes from the network', x.answered && x.v === `network ${ORIGIN}${SCOPE_PATH}`, String(x.v));
  net.online = false;
  x = await fetchEv(SCOPE_PATH, 'navigate');
  check('P5 offline: the page answers offline.html', x.answered && /offline\.html$/.test(String(x.v)), String(x.v));
  x = await fetchEv(SCOPE_PATH + '?local=1', 'navigate');
  check('P5 offline with ?local=1: the stored page', x.answered && x.v === `body of ${ORIGIN}${SCOPE_PATH}`, String(x.v));
  x = await fetchEv(SCOPE_PATH + 'icons/icon-192.png');
  check('P5 offline: an icon from the shell', x.answered && /icon-192\.png$/.test(String(x.v)));
  const never = ['api/ping.php', 'api/player/save.php', 'admin/', 'admin/index.php', 'uploads/a.webp', 'data/game-data.json', 'install.php', 'admin.php', 'lib/Db.php'];
  const answered = [];
  for (const u of never) { for (const mode of ['cors', 'navigate']) { const y = await fetchEv(SCOPE_PATH + u, mode); if (y.answered) answered.push(`${u} (${mode})`); } }
  const post = await fetchEv(SCOPE_PATH, 'navigate', 'POST');
  const other = await fetchEv('/elsewhere/', 'navigate');
  check('P5 the API, admin, uploads, data and .php are never answered', answered.length === 0 && !post.answered && !other.answered, answered.join(', ') || `${never.length} paths × 2 modes, POST, other scope`);
}

// P6
const tpl = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
const block = tpl.slice(tpl.indexOf('[opt] the installable page'), tpl.lastIndexOf('</script>'));
check('P6 the template registers the worker only in server mode', /G\.net\.mode !== 'server'\) return/.test(block) && /serviceWorker\.register\('sw\.js'/.test(block) && /rel = 'manifest'/.test(block) && !/<link rel="manifest"/.test(tpl));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
