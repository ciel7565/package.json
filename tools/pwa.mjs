// =============================================================================
// [opt] tools/pwa.mjs — the installable page of a server copy (CONTRACT §18.6, §19.4); used by tools/build.mjs
//
// writeInstallable(dir, { version, name, shortName, description, theme, background }) → { files: [rel, …] }
//   writes next to the page of a server copy (never for a page opened as a file):
//     manifest.webmanifest         name, start_url / scope "./", standalone, colours, icons
//     sw.js                        the service worker: caches the page shell when it installs (the page, the manifest,
//                                  the icons, offline.html) and answers from that cache only when the network fails;
//                                  the API, the admin site, uploads, data and every .php are never cached or answered
//     offline.html                 a calm page for "no connection" (no script; its own strict CSP)
//     icons/icon-180.png · icon-192.png · icon-512.png · icon-maskable-512.png
//                                  drawn here from the page's own favicon (the onggi jar of src/template.html) —
//                                  no file is downloaded and no new host is used
// iconPng(size, { maskable }) → Buffer   one icon (PNG, drawn with a small scanline rasteriser, 4×4 samples per pixel)
// The page itself registers sw.js and links the manifest only in server mode (src/template.html, the [opt] block).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- shapes (in the favicon's 64 × 64 units)
const ellipse = (cx, cy, rx, ry, n = 96) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
function cubic(p0, p1, p2, p3, n = 32) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
// the favicon: <ellipse cx=32 cy=14 rx=14 ry=5 fill=#3b2416/> <path d="M14 18c-6 8-6 30 4 38h28c10-8 10-30 4-38z" fill=#5a3520/>
// <path d="M18 26h28" stroke=#f4c54a stroke-width=3/>
// drawn a little rounder than the 16-pixel favicon (a belly and shoulders, as an onggi jar has): same parts, same colours
const BODY = [[21, 18], ...cubic([21, 18], [11, 21], [7, 33], [10, 44]), ...cubic([10, 44], [12, 52], [16, 56], [22, 57]), [42, 57],
  ...cubic([42, 57], [48, 56], [52, 52], [54, 44]), ...cubic([54, 44], [57, 33], [53, 21], [43, 18])];
const LID = ellipse(32, 14.5, 12.5, 4.6);
const RIM = ellipse(32, 18.2, 11.5, 2.2, 64);
const BAND = [[18, 24.5], [46, 24.5], [46, 27.5], [18, 27.5]];
const SHINE = ellipse(22.5, 33, 2.2, 7.5, 48);   // a soft glaze highlight (the jar is glazed onggi)

/** coverage (0…1) of a polygon on a w × h grid; ss × ss samples per pixel; map: [x, y] (units) → pixels */
function coverage(poly, w, h, map, ss = 4) {
  const pts = poly.map(map);
  const cov = new Float32Array(w * h);
  const inv = 1 / (ss * ss);
  for (let sy = 0; sy < h * ss; sy++) {
    const y = (sy + 0.5) / ss;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[j];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    const row = Math.floor(sy / ss) * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] * ss - 0.5)), b = Math.min(w * ss - 1, Math.floor(xs[k + 1] * ss - 0.5));
      for (let sx = a; sx <= b; sx++) cov[row + (sx / ss | 0)] += inv;
    }
  }
  return cov;
}
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** one icon: the jar on a hanji-coloured disc over the page's dark green; maskable = full bleed, jar inside the safe zone */
export function iconPng(size, opts = {}) {
  const maskable = !!opts.maskable;
  const bg = hex(opts.theme || '#0e1a14');
  const w = size, h = size;
  const px = new Float32Array(w * h * 4);
  // background: a rounded square (any) or the whole square (maskable)
  const r = maskable ? 0 : size * 0.22;
  const rounded = maskable ? [[0, 0], [w, 0], [w, h], [0, h]] : (() => {
    const p = []; const c = [[w - r, r, -90], [w - r, h - r, 0], [r, h - r, 90], [r, r, 180]];
    for (const [cx, cy, a0] of c) for (let i = 0; i <= 12; i++) { const a = (a0 + i * 7.5) * Math.PI / 180; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return p;
  })();
  const layers = [];
  const id = (p) => p;
  layers.push([coverage(rounded, w, h, id), bg]);
  const disc = maskable ? 0.40 : 0.43;
  layers.push([coverage(ellipse(w / 2, h / 2, size * disc, size * disc, 160), w, h, id), hex('#efe2c6')]);
  // the jar: 47 units tall, centred on the disc
  const s = (size * (maskable ? 0.50 : 0.58)) / 47;
  const map = ([x, y]) => [w / 2 + (x - 32) * s, h / 2 + (y - 32.5) * s];
  // the body: glazed brown, lighter where the light comes from (upper left), darker towards the right and the foot
  const body = hex('#5a3520');
  const shade = (x, y) => { const u = ((x - w / 2) / s) / 22, v = ((y - h / 2) / s) / 24; const k = 1.12 - 0.30 * Math.max(0, u + 0.25) - 0.18 * Math.max(0, v); return body.map((c) => Math.max(0, Math.min(255, c * k))); };
  layers.push([coverage(BODY, w, h, map), shade]);
  layers.push([coverage(RIM, w, h, map), hex('#2c1a0f')]);
  layers.push([coverage(LID, w, h, map), hex('#3b2416')]);
  layers.push([coverage(BAND, w, h, map), hex('#f4c54a')]);
  const shine = coverage(SHINE, w, h, map);
  for (let i = 0; i < shine.length; i++) shine[i] *= 0.28;
  layers.push([shine, hex('#fff6e0')]);
  for (const [cov, colour] of layers) {
    for (let i = 0; i < w * h; i++) {
      const a = Math.min(1, cov[i]);
      if (a <= 0) continue;
      const o = i * 4, da = px[o + 3], na = a + da * (1 - a);
      const col = typeof colour === 'function' ? colour(i % w, (i / w) | 0) : colour;
      for (let k = 0; k < 3; k++) px[o + k] = na > 0 ? (col[k] * a + px[o + k] * da * (1 - a)) / na : 0;
      px[o + 3] = na;
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(px[i * 4 + k]); out[i * 4 + 3] = Math.round(px[i * 4 + 3] * 255); }
  return encodePng(w, h, out);
}

// ---------------------------------------------------------------- the service worker
function serviceWorker(version, shell) {
  return `// 전통발효체험관 — service worker, written by tools/build.mjs (tools/pwa.mjs, CONTRACT §18.6). Do not edit: a new build
// writes a new one. It keeps a copy of the page shell for the moment the network is gone; it never stores or answers
// the API, the admin site, uploads or any .php — those always go to the server (and fail when it cannot be reached).
'use strict';
const VERSION = ${JSON.stringify(version)};
const CACHE = 'tfm-shell-' + VERSION;
const SHELL = ${JSON.stringify(shell)};
const SCOPE = new URL('./', self.location).pathname;
const NEVER = /^(api|admin|uploads|data|lib|cli|config|database)(\\/|$)|\\.php$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tfm-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  const rel = decodeURIComponent(url.pathname.slice(SCOPE.length));
  if (NEVER.test(rel)) return;                     // the server answers, never this worker
  if (req.mode === 'navigate') {
    if (rel !== '' && rel !== 'index.html') return;
    // the page: always from the network first (a new build is seen at once); offline: the calm page, or the stored
    // page itself when "인터넷 없이 둘러보기" asked for it (?local=1 — local mode: progress stays on this device)
    event.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match(url.searchParams.get('local') === '1' ? './' : 'offline.html').then((r) => r || c.match('offline.html')))));
    return;
  }
  if (SHELL.includes(rel)) event.respondWith(caches.open(CACHE).then((c) => c.match(rel).then((r) => r || fetch(req))));
});
`;
}

const OFFLINE = (o) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${o.theme}">
<title>${o.shortName} — 연결을 기다려요</title>
<style>
  html, body { margin: 0; height: 100%; background: ${o.theme}; color: #f4ecdc; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; }
  main { box-sizing: border-box; min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; text-align: center; }
  img { width: 112px; height: 112px; border-radius: 26px; }
  h1 { margin: 0; font-size: 26px; }
  p { margin: 0; max-width: 30em; font-size: 18px; line-height: 1.6; color: #e6dcc6; }
  a { display: inline-flex; align-items: center; justify-content: center; min-height: 56px; min-width: 220px; padding: 0 24px; border-radius: 28px; font-size: 19px; font-weight: 700; text-decoration: none; }
  .go { background: #f4c54a; color: #2a1a0c; }
  .local { background: transparent; color: #f4ecdc; border: 2px solid #8fa596; }
  small { color: #b9c4bb; font-size: 15px; }
</style>
</head>
<body>
<main>
  <img src="icons/icon-192.png" alt="">
  <h1>인터넷 연결을 기다리고 있어요</h1>
  <p>지금은 체험관 서버에 닿지 않아요. 와이파이나 데이터가 켜져 있는지 살펴본 뒤 다시 열어 주세요.</p>
  <a class="go" href="./">다시 연결해 보기</a>
  <a class="local" href="./?local=1">인터넷 없이 둘러보기</a>
  <small>인터넷 없이 둘러보면 그동안 한 일은 이 기기에만 남아요. 계정에는 저장되지 않아요.</small>
</main>
</body>
</html>
`;

export function writeInstallable(dir, o = {}) {
  const opt = { name: '전통발효체험관 메타버스', shortName: '전통발효체험관', description: '한국 전통발효문화와 농업체험을 3D로 탐험하고 배우는 체험관', theme: '#0e1a14', background: '#0e1a14', version: 'dev', ...o };
  const files = [];
  const put = (rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); files.push(rel); };
  const icons = [['icons/icon-180.png', 180, false], ['icons/icon-192.png', 192, false], ['icons/icon-512.png', 512, false], ['icons/icon-maskable-512.png', 512, true]];
  for (const [rel, size, maskable] of icons) put(rel, iconPng(size, { maskable, theme: opt.theme }));
  const manifest = {
    id: './', name: opt.name, short_name: opt.shortName, description: opt.description, lang: 'ko', dir: 'ltr',
    start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: opt.background, theme_color: opt.theme,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  put('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
  put('offline.html', OFFLINE(opt));
  const shell = ['./', 'manifest.webmanifest', 'offline.html', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
  put('sw.js', serviceWorker(String(opt.version), shell));
  return { files };
}
