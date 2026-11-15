// =============================================================================
// 74-lecture.js — 강의실 (lectures): G.sys.lecture (CONTRACT §17.3)
//
//   G.sys.lecture (order 67)
//     open(id?, { auto }) -> modal      the panel 🎓 강의실: the lecture cards, or — with an id — that lecture's player
//                                       (id: a number of the server list, or 'deck:<id>' for a built-in slide deck)
//     close() · isOpen()
//     list() -> [{ id, title, kind, place, autoplay, … }]   what this visitor may see: the operator's lectures (server
//                                       mode, GET api/lecture/list.php, already filtered by audience) + the built-in decks
//     forPlace(placeId) -> lecture | null   the lecture shown in a room: an exact place first, then one for every room ('*')
//     screen(ctx, { x, y, z, rotY, w = 2.4, h = 1.35, stand = false, title }) -> Object3D
//                                       a framed screen for a room's build(ctx) (LOCAL coordinates, front = +z turned by
//                                       rotY): the title card of the room's lecture and the interactable 🎬 강의 보기.
//                                       Call it as G.sys.lecture?.screen?.(ctx, spec) — a room without this module just has no screen.
//     refresh({ force }) -> Promise<list>   ask the server again (at most once a minute unless forced)
//   Events: lecture:changed { v, count }   the list changed (screens redraw themselves)
//           lecture:play { id } · lecture:pause { id } · lecture:close { id }   a video / online slide frame started, paused, its player closed
//
// KINDS and their players
//   youtube  an <iframe> of https://www.youtube-nocookie.com/embed/<id>?rel=0&modestbranding=1&playsinline=1&hl=ko with
//            sandbox="allow-scripts allow-same-origin allow-presentation" (no popups, no top navigation: nothing in the
//            player can leave the app) and allow="autoplay; encrypted-media; fullscreen; picture-in-picture". The id is
//            checked again here (11 characters of [A-Za-z0-9_-]). An error the player reports, no network, or a page
//            opened as a file → a calm note instead of a broken frame. An auto-opened video starts muted.
//   slides   an <iframe> of an allow-listed host only (docs.google.com, view.officeapps.live.com), the same sandbox
//   images   the deck viewer: previous / next, keys, swipe, page n / N, full screen
//   pdf      the browser's own viewer in a same-origin frame (phones: a button that opens it in a new tab — behind the
//            grown-up gate in easy mode)
//   pptx     the built-in simple viewer: the file is fetched from THIS site only, unzipped with
//            DecompressionStream('deflate-raw') and read slide by slide (title, paragraphs with their levels, tables,
//            pictures in order) into 16:9 cards — "간단 보기 — 원본과 모양이 다를 수 있어요". Limits: 60 MB file, 5,000 zip
//            entries, 200 slides, 80 MB unpacked (counted on the real output), 4 MB per XML part; a DTD / entity
//            declaration, an encrypted or ZIP64 archive, a name that leaves the archive → refused. Pictures become blob
//            URLs that are revoked when the player closes. No eval, no Function, no wasm, no innerHTML.
//            When the operator switched it on (and the site is public https) the Office viewer frame is offered instead.
//   link     never framed: a button for grown-ups (the gate in easy mode) that opens the address in a new tab
//   deck     a built-in slide deck of G.data.lectureDecks (shape below) — also the whole content of local (file) mode
//
// BUILT-IN DECKS (G.data.lectureDecks, written by the content lane; two small decks of this file are the fallback):
//   [{ id, title, emoji?, place? ('' | 'PL_…' | '*'), kid? (one spoken line),
//      slides: [{ title, lines: [text | { text, lvl }] (or text / body / bullets), emoji?, image? (asset pack name), note? }] }]
//   — an array or an object keyed by id.
//
// IN THE ROOMS: on place:enter a lecture assigned to that place shows the card "▶ 강의 보기" (it leaves by itself); one
//   with `autoplay` opens by itself once per visit to the site (lecture.auto_open of the operator can switch that off).
//   Music is ducked while a video or an online slide frame is open. Under automation (navigator.webdriver) the card
//   and the auto-open are off unless the page was opened with ?lecture=on (existing suites keep their behaviour).
//   ?lecture=<id> opens that lecture right after the visitor is in (the admin tab's "체험관에서 미리 보기").
// KID RULES (§12, §17.0): big picture cards (≥ 56 px), 🔊 lines, no typing, no link that leaves the app in easy mode
//   (new-tab buttons ask the grown-up gate first), never a dead end (⬅️ 닫기 and "강의 목록" are always there).
// SECURITY: every server string reaches the page as text (G.ui.h children / textContent / canvas fillText); ids, the
//   video id, hosts and file types are checked again on this side; only allow-listed hosts are ever framed.
// =============================================================================
(function () {
  const h = (...a) => G.ui.h(...a);
  const CAT = 'LECTURE';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const isServer = () => G.net?.mode === 'server';
  const say = (t, o) => { try { G.easy?.say?.(t, o || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const toast = (m, o) => { try { G.ui.toast(m, o); } catch (e) { /* ui not ready */ } };
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const RX_YT = /^[A-Za-z0-9_-]{11}$/;
  const RX_PLACE = /^(?:\*|PL_[A-Z0-9_]{2,24})?$/;
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const FRAME_HOSTS = ['docs.google.com', 'view.officeapps.live.com'];
  const SANDBOX = 'allow-scripts allow-same-origin allow-presentation';
  const FILE_TYPES = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'image/jpeg': 'img', 'image/png': 'img', 'image/webp': 'img' };
  const KIND = {
    youtube: ['▶️', '영상'], slides: ['🖥️', '온라인 슬라이드'], pdf: ['📄', '문서'], images: ['🖼️', '그림 슬라이드'],
    pptx: ['📊', '발표 자료'], link: ['🔗', '바깥 누리집'], deck: ['📚', '슬라이드'],
  };
  const LIMITS = { file: 60 * 1048576, entries: 5000, slides: 200, unpacked: 80 * 1048576, xml: 4 * 1048576, picture: 24 * 1048576, pictures: 400 };
  const REFRESH_MS = 60000;
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  // ---------------------------------------------------------------- checking what the server sent
  /** an https address without userinfo; null otherwise */
  function httpsUrl(u) {
    try {
      const x = new URL(String(u));
      return x.protocol === 'https:' && !x.username && !x.password && x.hostname.includes('.') ? x.href : null;
    } catch (e) { return null; }
  }
  /** an address that may be framed: https, an allow-listed host, the default port */
  function frameUrl(u) {
    const s = httpsUrl(u);
    if (!s) return null;
    const x = new URL(s);
    return FRAME_HOSTS.includes(x.hostname) && !x.port ? s : null;
  }
  function cleanFile(f) {
    const n = Number(f?.n), type = String(f?.type || '');
    if (!Number.isInteger(n) || n < 0 || n > 999 || !FILE_TYPES[type]) return null;
    return { n, type, w: clamp(Number(f.w) | 0, 0, 20000), h: clamp(Number(f.h) | 0, 0, 20000), bytes: Math.max(0, Number(f.bytes) || 0) };
  }
  /** one lecture of api/lecture/list.php → the checked object this module works with, or null */
  function cleanLecture(x) {
    if (!x || typeof x !== 'object') return null;
    const id = Number(x.id), kind = String(x.kind || '');
    if (!Number.isInteger(id) || id < 1 || !['youtube', 'slides', 'pdf', 'images', 'pptx', 'link'].includes(kind)) return null;
    const l = {
      id, key: 's' + id, kind, title: String(x.title ?? '').slice(0, 120) || '강의', place: typeof x.place === 'string' && RX_PLACE.test(x.place) ? x.place : '',
      autoplay: x.autoplay === true, sort: Number(x.sort) || 0,
    };
    if (kind === 'youtube') { if (!RX_YT.test(String(x.yt || ''))) return null; l.yt = String(x.yt); }
    else if (kind === 'slides') { l.url = frameUrl(x.url); if (!l.url) return null; }
    else if (kind === 'link') { l.url = httpsUrl(x.url); if (!l.url) return null; }
    else {
      const want = kind === 'images' ? 'img' : kind;
      l.files = (Array.isArray(x.files) ? x.files.slice(0, 200) : []).map(cleanFile).filter((f) => f && FILE_TYPES[f.type] === want);
      if (!l.files.length) return null;
      l.office = kind === 'pptx' && x.office === true;
    }
    return l;
  }
  const fileUrl = (l, n) => `${G.net.base}lecture/file.php?id=${l.id}&n=${n}`;

  // ---------------------------------------------------------------- built-in decks
  const FALLBACK_DECKS = [
    {
      id: 'doenjang', title: '된장은 어떻게 만들어질까요?', emoji: '🫘', kid: '된장이 만들어지는 차례를 봐요.',
      slides: [
        { title: '된장은 어떻게 만들어질까요?', emoji: '🫘', lines: ['콩과 소금, 물, 그리고 기다림으로 만들어요.', '차례대로 함께 살펴봐요.'] },
        { title: '① 콩을 삶아요', emoji: '🍲', lines: ['잘 익은 메주콩을 씻어 물에 불려요.', '손으로 누르면 으깨질 만큼 푹 삶아요.'] },
        { title: '② 메주를 빚어요', emoji: '🧱', lines: ['삶은 콩을 찧어서 네모나게 뭉쳐요.', '이 덩어리를 메주라고 불러요.'] },
        { title: '③ 메주를 띄워요', emoji: '🌾', lines: ['볏짚으로 묶어 따뜻하고 바람이 통하는 곳에 매달아요.', '볏짚과 공기 속의 작은 생물이 콩을 천천히 바꿔요.', { text: '이렇게 작은 생물이 음식을 바꾸는 일을 발효라고 해요.', lvl: 1 }] },
        { title: '④ 장을 담가요', emoji: '🏺', lines: ['항아리에 메주를 넣고 소금물을 부어요.', '숯과 붉은 고추를 띄우기도 해요.'] },
        { title: '⑤ 장을 갈라요', emoji: '🥢', lines: ['몇 달 뒤 메주를 건져 으깨면 된장이 돼요.', '남은 까만 물은 달여서 간장으로 써요.'] },
        { title: '⑥ 볕과 바람이 익혀요', emoji: '☀️', lines: ['맑은 날에는 뚜껑을 열어 볕을 쬐어 줘요.', '오래 기다릴수록 맛이 깊어져요.'] },
      ],
    },
    {
      id: 'onggi', title: '항아리는 왜 숨을 쉰다고 할까요?', emoji: '🏺', kid: '숨 쉬는 항아리 이야기를 봐요.',
      slides: [
        { title: '항아리는 왜 숨을 쉰다고 할까요?', emoji: '🏺', lines: ['흙으로 빚어 불에 구운 그릇을 옹기라고 해요.', '옹기 항아리의 비밀을 알아봐요.'] },
        { title: '눈에 안 보이는 작은 구멍', emoji: '🔍', lines: ['옹기 흙에는 굵은 모래 알갱이가 섞여 있어요.', '구울 때 아주 작은 틈이 많이 생겨요.'] },
        { title: '공기는 지나가고 물은 안 새요', emoji: '💨', lines: ['작은 틈으로 공기가 조금씩 드나들어요.', '물방울은 틈보다 커서 새지 않아요.', { text: '그래서 "숨 쉬는 그릇"이라고 불러요.', lvl: 1 }] },
        { title: '장독대는 어디에 둘까요?', emoji: '☀️', lines: ['볕이 잘 들고 바람이 잘 통하는 곳에 둬요.', '바닥에 돌을 깔아 물이 잘 빠지게 해요.'] },
        { title: '항아리를 돌보는 일', emoji: '🧽', lines: ['겉을 자주 닦아 작은 틈이 막히지 않게 해요.', '비가 오면 뚜껑을 꼭 덮어 줘요.'] },
      ],
    },
  ];
  /** one deck of G.data.lectureDecks (or the fallback) → { id: 'deck:…', kind: 'deck', title, slides: [slide model] } or null */
  function cleanDeck(d, key) {
    if (!d || typeof d !== 'object') return null;
    const id = String(d.id ?? key ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const raw = Array.isArray(d.slides) ? d.slides : [];
    if (!id || !raw.length) return null;
    const slides = [];
    for (const s of raw.slice(0, LIMITS.slides)) {
      if (!s || typeof s !== 'object') continue;
      const src = s.lines ?? s.bullets ?? s.body ?? s.text ?? [];
      const lines = (Array.isArray(src) ? src : String(src).split('\n')).slice(0, 14);
      const blocks = [];
      for (const ln of lines) {
        const o = ln && typeof ln === 'object' ? ln : { text: ln };
        const text = String(o.text ?? '').trim().slice(0, 400);
        if (text) blocks.push({ t: 'p', lvl: clamp(Number(o.lvl) | 0, 0, 4), bullet: 'dot', runs: [{ text }] });
      }
      const image = typeof (s.image ?? s.img ?? s.pic) === 'string' ? String(s.image ?? s.img ?? s.pic).slice(0, 80) : '';
      slides.push({ title: String(s.title ?? '').slice(0, 120), sub: String(s.sub ?? s.caption ?? '').slice(0, 160), emoji: String(s.emoji ?? s.icon ?? '').slice(0, 8), image, note: String(s.note ?? '').slice(0, 300), blocks });
    }
    if (!slides.length) return null;
    return {
      id: 'deck:' + id, key: 'd' + id, kind: 'deck', title: String(d.title ?? '슬라이드').slice(0, 120), emoji: String(d.emoji ?? '📚').slice(0, 8),
      place: typeof d.place === 'string' && RX_PLACE.test(d.place) ? d.place : '', kid: String(d.kid ?? '').slice(0, 120), autoplay: false, slides,
    };
  }
  function builtinDecks() {
    const src = G.data?.lectureDecks;
    let list = [];
    try {
      if (Array.isArray(src)) list = src.map((d, i) => cleanDeck(d, 'd' + i));
      else if (src && typeof src === 'object') list = Object.keys(src).map((k) => cleanDeck(src[k], k));
    } catch (e) { G.log.warn(CAT, 'G.data.lectureDecks could not be read', e?.message || e); list = []; }
    list = list.filter(Boolean);
    return list.length ? list : FALLBACK_DECKS.map((d) => cleanDeck(d, d.id)).filter(Boolean);
  }

  // ---------------------------------------------------------------- the zip of a .pptx (central directory, bounded)
  const zerr = (code) => Object.assign(new Error('pptx: ' + code), { code });
  function zipNameOk(n) {
    if (!n || n.length > 260 || n[0] === '/' || n.includes('\\') || n.includes('\0') || /^[A-Za-z]:/.test(n)) return false;
    return !n.split('/').some((seg, i, a) => seg === '..' || seg === '.' || (seg === '' && i < a.length - 1));
  }
  /** the table of contents of a zip in memory + a bounded reader; nothing is unpacked until read() asks for one entry */
  function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), len = u8.length;
    if (len < 22 || dv.getUint32(0, true) !== 0x04034b50) throw zerr('not-zip');
    let p = -1;
    for (let i = len - 22, min = Math.max(0, len - 65557); i >= min; i--) if (dv.getUint32(i, true) === 0x06054b50) { p = i; break; }
    if (p < 0) throw zerr('not-zip');
    const total = dv.getUint16(p + 10, true), cdSize = dv.getUint32(p + 12, true), cdOff = dv.getUint32(p + 16, true);
    if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw zerr('zip64');
    if (total < 1 || total > LIMITS.entries || cdOff + cdSize > p) throw zerr('bad-zip');
    const td = new TextDecoder('utf-8');
    const entries = new Map();
    let at = cdOff;
    for (let i = 0; i < total; i++) {
      if (at + 46 > p || dv.getUint32(at, true) !== 0x02014b50) throw zerr('bad-zip');
      const flags = dv.getUint16(at + 8, true), method = dv.getUint16(at + 10, true), csize = dv.getUint32(at + 20, true), usize = dv.getUint32(at + 24, true);
      const nlen = dv.getUint16(at + 28, true), xlen = dv.getUint16(at + 30, true), clen = dv.getUint16(at + 32, true), off = dv.getUint32(at + 42, true);
      const name = td.decode(u8.subarray(at + 46, at + 46 + nlen));
      at += 46 + nlen + xlen + clen;
      if (at > p) throw zerr('bad-zip');
      if (flags & 1) throw zerr('encrypted');
      if (!zipNameOk(name)) throw zerr('bad-name');
      if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw zerr('zip64');
      if (entries.has(name)) throw zerr('bad-zip');
      if (method !== 0 && method !== 8) continue;   // a method this reader does not know: the entry is simply not readable
      if (off + 30 + csize > cdOff) throw zerr('bad-zip');
      entries.set(name, { method, csize, usize, off });
    }
    const budget = { used: 0 };
    return {
      names: [...entries.keys()], has: (n) => entries.has(n), budget,
      /** the bytes of one entry, at most `max` after inflating (and LIMITS.unpacked over all reads) */
      async read(name, max) {
        const e = entries.get(name);
        if (!e) throw zerr('missing');
        if (dv.getUint32(e.off, true) !== 0x04034b50) throw zerr('bad-zip');
        const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
        if (start + e.csize > cdOff) throw zerr('bad-zip');
        const raw = u8.subarray(start, start + e.csize);
        if (e.method === 0) {
          if (raw.length > max || (budget.used += raw.length) > LIMITS.unpacked) throw zerr('too-big');
          return raw;
        }
        const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          n += value.length; budget.used += value.length;
          if (n > max || budget.used > LIMITS.unpacked) { try { await reader.cancel(); } catch (x) { /* already closed */ } throw zerr('too-big'); }
          chunks.push(value);
        }
        const out = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
      },
    };
  }

  // ---------------------------------------------------------------- reading the slides of a .pptx
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const kid = (el, name) => (el ? Array.from(el.children).find((c) => c.localName === name) || null : null);
  const deep = (el, ...path) => path.reduce((e, n) => kid(e, n), el);
  /** "a/b/../c" relative to a folder → a clean path inside the archive, or null */
  function resolvePath(base, target) {
    if (typeof target !== 'string' || !target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
    const out = target[0] === '/' ? [] : base.split('/').filter(Boolean);
    for (const seg of target.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
    }
    return out.join('/');
  }
  const PIC_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  /** the text runs of one <a:p>: [{ text, b, i }] with line breaks as '\n' */
  function runsOf(p) {
    const runs = [];
    for (const c of p.children) {
      if (c.localName === 'r' || c.localName === 'fld') {
        const text = kids(c, 't').map((t) => t.textContent).join('');
        if (!text) continue;
        const pr = kid(c, 'rPr');
        runs.push({ text: text.slice(0, 2000), b: pr?.getAttribute('b') === '1', i: pr?.getAttribute('i') === '1' });
      } else if (c.localName === 'br') runs.push({ text: '\n' });
    }
    return runs;
  }
  /** the paragraphs of a text body → blocks; `bulleted`: the placeholder's paragraphs have bullets unless they say buNone */
  function paragraphs(txBody, bulleted, blocks) {
    let num = 0, numLvl = -1;
    for (const p of kids(txBody, 'p')) {
      const runs = runsOf(p);
      if (!runs.some((r) => r.text.trim())) { num = 0; continue; }
      const pPr = kid(p, 'pPr');
      const lvl = clamp(Number(pPr?.getAttribute('lvl')) | 0, 0, 8);
      let bullet = bulleted ? 'dot' : null;
      if (pPr) {
        if (kid(pPr, 'buNone')) bullet = null;
        else if (kid(pPr, 'buAutoNum')) bullet = 'num';
        else if (kid(pPr, 'buChar') || kid(pPr, 'buBlip')) bullet = 'dot';
      }
      const b = { t: 'p', lvl, bullet, runs };
      if (bullet === 'num') { num = numLvl === lvl ? num + 1 : 1; numLvl = lvl; b.num = num; } else if (lvl <= numLvl) { num = 0; numLvl = -1; }
      blocks.push(b);
    }
  }
  /** a whole presentation → { slides: [slide model], truncated, dispose() }; throws zerr(code) */
  async function readPptx(buf, onProgress) {
    if (typeof DecompressionStream !== 'function' || typeof Blob.prototype.stream !== 'function') throw zerr('no-inflate');
    if (!(buf instanceof ArrayBuffer) || buf.byteLength > LIMITS.file) throw zerr('too-big');
    const zip = unzip(buf);
    const td = new TextDecoder('utf-8');
    const xml = async (name) => {
      const s = td.decode(await zip.read(name, LIMITS.xml));
      if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw zerr('dtd');
      const d = new DOMParser().parseFromString(s, 'application/xml');
      if (d.getElementsByTagName('parsererror').length) throw zerr('bad-xml');
      return d.documentElement;
    };
    /** Id → { type (last word of the relationship type), target (path in the archive) } of a .rels part */
    const relsOf = async (part) => {
      const dir = part.slice(0, part.lastIndexOf('/')), file = part.slice(part.lastIndexOf('/') + 1), name = `${dir}/_rels/${file}.rels`;
      const map = new Map();
      if (!zip.has(name)) return map;
      for (const r of kids(await xml(name), 'Relationship')) {
        if (r.getAttribute('TargetMode') === 'External') continue;   // never followed, never fetched
        const target = resolvePath(dir, r.getAttribute('Target'));
        if (target) map.set(String(r.getAttribute('Id')), { type: String(r.getAttribute('Type') || '').split('/').pop(), target });
      }
      return map;
    };
    if (!zip.has('ppt/presentation.xml')) throw zerr('not-pptx');
    let order = [];
    try {
      const rels = await relsOf('ppt/presentation.xml');
      for (const s of kids(kid(await xml('ppt/presentation.xml'), 'sldIdLst'), 'sldId')) {
        const r = rels.get(s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id'));
        if (r && r.type === 'slide' && zip.has(r.target)) order.push(r.target);
      }
    } catch (e) { if (e?.code === 'dtd' || e?.code === 'too-big') throw e; order = []; }
    if (!order.length) {
      const num = (n) => Number(n.match(/slide(\d+)\.xml$/)[1]);
      order = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    }
    if (!order.length) throw zerr('not-pptx');
    const truncated = order.length > LIMITS.slides ? order.length : 0;
    order = order.slice(0, LIMITS.slides);
    const urls = [], blobs = new Map();
    const dispose = () => { for (const u of urls) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } } urls.length = 0; blobs.clear(); };
    const picture = async (target) => {
      if (blobs.has(target)) return blobs.get(target);
      const type = PIC_TYPES[(target.split('.').pop() || '').toLowerCase()];
      let url = null;
      if (type && zip.has(target) && urls.length < LIMITS.pictures) {
        url = URL.createObjectURL(new Blob([await zip.read(target, LIMITS.picture)], { type }));
        urls.push(url);
      }
      blobs.set(target, url);
      return url;
    };
    const slides = [];
    try {
      for (let i = 0; i < order.length; i++) {
        const root = await xml(order[i]);
        if (root.getAttribute('show') === '0') continue;   // a hidden slide
        const rels = await relsOf(order[i]);
        const s = { title: '', sub: '', blocks: [], skipped: false };
        const walk = async (tree) => {
          for (const el of tree.children) {
            const tag = el.localName;
            if (tag === 'grpSp') { await walk(el); continue; }
            if (tag === 'AlternateContent') {
              // a newer feature (an equation, an ink drawing …) with an older stand-in beside it: read the stand-in
              const alt = kid(el, 'Fallback') || kid(el, 'Choice');
              if (alt) await walk(alt); else s.skipped = true;
              continue;
            }
            if (tag === 'sp') {
              const ph = deep(el, 'nvSpPr', 'nvPr', 'ph');
              const type = ph ? (ph.getAttribute('type') || 'body') : '';
              if (type === 'sldNum' || type === 'dt' || type === 'ftr' || type === 'hdr') continue;
              const tx = kid(el, 'txBody');
              if (!tx) continue;
              if (type === 'title' || type === 'ctrTitle' || type === 'subTitle') {
                const text = kids(tx, 'p').map((p) => runsOf(p).map((r) => r.text).join('')).filter((t) => t.trim()).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
                if (type === 'subTitle') s.sub = s.sub || text; else s.title = s.title || text;
                continue;
              }
              paragraphs(tx, type === 'body' || type === 'obj', s.blocks);
            } else if (tag === 'pic') {
              const blip = deep(el, 'blipFill', 'blip');
              const r = blip ? rels.get(blip.getAttributeNS(NS_R, 'embed') || blip.getAttribute('r:embed')) : null;
              const src = r && r.type === 'image' ? await picture(r.target) : null;
              if (src) s.blocks.push({ t: 'img', src, alt: String(deep(el, 'nvPicPr', 'cNvPr')?.getAttribute('descr') || '').slice(0, 200) });
              else s.skipped = true;
            } else if (tag === 'graphicFrame') {
              const tbl = el.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'tbl')[0];
              if (!tbl) { s.skipped = true; continue; }
              const rows = kids(tbl, 'tr').slice(0, 40).map((tr) => kids(tr, 'tc').slice(0, 12).map((tc) => kids(kid(tc, 'txBody'), 'p').map((p) => runsOf(p).map((r) => r.text).join('')).join('\n').trim().slice(0, 400)));
              if (rows.length) s.blocks.push({ t: 'table', rows });
            } else if (tag === 'cxnSp' || tag === 'nvGrpSpPr' || tag === 'grpSpPr') { /* lines, group properties: nothing to read */ } else s.skipped = true;
          }
        };
        const tree = deep(root, 'cSld', 'spTree');
        if (tree) await walk(tree);
        if (s.blocks.length > 60) s.blocks.length = 60;
        slides.push(s);
        if (onProgress) onProgress(i + 1, order.length);
      }
    } catch (e) { dispose(); throw e; }
    if (!slides.length) { dispose(); throw zerr('not-pptx'); }
    return { slides, truncated, dispose };
  }

  // ---------------------------------------------------------------- a slide as DOM (pptx and built-in decks)
  function slideCard(s, i, n) {
    const card = h('article', { class: 'lec-slide', 'aria-label': `슬라이드 ${i + 1} / ${n}` });
    const texts = s.blocks.filter((b) => b.t !== 'img'), pics = s.blocks.filter((b) => b.t === 'img');
    if (s.emoji) card.appendChild(h('div', { class: 'lec-s-emoji emoji', 'aria-hidden': 'true' }, s.emoji));
    if (s.title) card.appendChild(h('h3', { class: 'lec-s-title' }, s.title));
    if (s.sub) card.appendChild(h('p', { class: 'lec-s-sub' }, s.sub));
    if (!s.title && !texts.length && !pics.length && !s.image) {
      // nothing readable: a calm card instead of an empty one
      card.classList.add('lec-s-empty');
      card.appendChild(h('div', { class: 'lec-s-emoji emoji', 'aria-hidden': 'true' }, '🖼️'));
      card.appendChild(h('p', { class: 'lec-s-sub' }, '이 슬라이드는 도형이나 도표로 되어 있어서 간단 보기로는 보여 줄 수 없어요.'));
      card.appendChild(h('span', { class: 'lec-s-num' }, `${i + 1} / ${n}`));
      return card;
    }
    const main = h('div', { class: 'lec-s-main' + (pics.length || s.image ? ' has-pics' : '') + (texts.length ? '' : ' only-pics') });
    if (texts.length) {
      const body = h('div', { class: 'lec-s-body' });
      for (const b of texts) {
        if (b.t === 'table') {
          const tb = h('tbody');
          b.rows.forEach((row, ri) => tb.appendChild(h('tr', null, row.map((cell) => h(ri === 0 ? 'th' : 'td', null, cell)))));
          body.appendChild(h('div', { class: 'lec-tablewrap' }, h('table', { class: 'lec-table' }, tb)));
          continue;
        }
        const p = h('p', { class: `lec-p lv${Math.min(b.lvl, 4)}${b.bullet ? ' lec-b-' + b.bullet : ''}`, 'data-n': b.bullet === 'num' ? `${b.num}.` : null });
        for (const r of b.runs) {
          if (r.text === '\n') p.appendChild(h('br'));
          else p.appendChild(r.b || r.i ? h('span', { class: ((r.b ? 'lec-em-b' : '') + (r.i ? ' lec-em-i' : '')).trim() }, r.text) : document.createTextNode(r.text));
        }
        body.appendChild(p);
      }
      main.appendChild(body);
    }
    if (pics.length || s.image) {
      const box = h('div', { class: 'lec-s-pics n' + Math.min(4, pics.length || 1) });
      for (const b of pics.slice(0, 6)) box.appendChild(h('img', { src: b.src, alt: b.alt || '슬라이드의 그림', draggable: 'false' }));
      if (s.image) {
        // a picture of the asset pack (built-in decks): shown when the pack has it
        let src = '';
        try { src = G.pack?.url?.(s.image) || ''; } catch (e) { src = ''; }
        if (src) box.appendChild(h('img', { src, alt: s.title || '슬라이드의 그림', draggable: 'false' }));
      }
      // a picture the pack does not have leaves no empty column behind
      if (box.children.length) main.appendChild(box);
      else main.classList.remove('has-pics');
    }
    card.appendChild(main);
    if (s.skipped) card.appendChild(h('p', { class: 'lec-s-skip' }, '도형 · 도표 일부는 간단 보기에 나오지 않아요.'));
    card.appendChild(h('span', { class: 'lec-s-num' }, `${i + 1} / ${n}`));
    return card;
  }
  /** shrink the text of a slide card until it fits its 16:9 box (down to 60 %; after that the card scrolls) */
  function fitSlide(card) {
    if (!card || !card.isConnected) return;
    let k = 1;
    card.style.setProperty('--k', '1');
    for (let n = 0; n < 8 && card.scrollHeight > card.clientHeight + 2 && k > 0.6; n++) { k -= 0.05; card.style.setProperty('--k', k.toFixed(2)); }
  }
  const slideText = (s) => [s.title, s.sub, ...s.blocks.filter((b) => b.t === 'p').map((b) => b.runs.map((r) => r.text).join(''))].filter(Boolean).join('. ').slice(0, 300);

  // ---------------------------------------------------------------- the deck viewer (images, pptx, built-in decks)
  /** makeDeck(host, { count, render(i) -> Node, speak(i) -> text, note }) -> { go, dispose, el } */
  function makeDeck(host, o) {
    const easy = easyOn();
    let cur = -1, full = false;
    const stage = h('div', { class: 'lec-stage' });
    const count = h('span', { class: 'lec-count', 'aria-live': 'polite' });
    const prog = h('i');
    const prev = h('button', { type: 'button', class: 'lec-nav prev', 'aria-label': '이전 슬라이드', 'data-say': '앞으로' }, h('span', { 'aria-hidden': 'true' }, '◀'), easy ? h('span', { class: 'lec-nav-l' }, '앞') : null);
    const next = h('button', { type: 'button', class: 'lec-nav next', 'aria-label': '다음 슬라이드', 'data-say': '다음' }, easy ? h('span', { class: 'lec-nav-l' }, '다음') : null, h('span', { 'aria-hidden': 'true' }, '▶'));
    const speak = o.speak ? h('button', { type: 'button', class: 'lec-tool easy-only', 'aria-label': '소리로 듣기', 'data-say': '소리로 듣기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊')) : null;
    const fs = h('button', { type: 'button', class: 'lec-tool', 'aria-label': '크게 보기', 'aria-pressed': 'false', 'data-say': '크게 보기' }, h('span', { class: 'ico', 'data-icon': 'expand' }));
    const el = h('div', { class: 'lec-deck', tabindex: '0', role: 'group', 'aria-label': '슬라이드' },
      stage,
      h('div', { class: 'lec-bar' }, prev, h('div', { class: 'lec-mid' }, count, h('div', { class: 'lec-prog', 'aria-hidden': 'true' }, prog)), speak, fs, next),
      o.note ? h('p', { class: 'lec-note' }, o.note) : null);
    const go = (i) => {
      i = clamp(i | 0, 0, o.count - 1);
      if (i === cur) return;
      cur = i;
      stage.textContent = '';
      let node = null;
      try { node = o.render(i); } catch (e) { G.log.warn(CAT, 'slide could not be drawn', e?.message || e); }
      stage.appendChild(node || h('p', { class: 'lec-s-sub' }, '이 슬라이드를 보여 주지 못했어요.'));
      stage.classList.toggle('lec-paper', !!(node && node.classList?.contains('lec-slide')));   // a paper card (not a picture): the stage may grow with it on a phone
      if (node && node.classList?.contains('lec-slide')) requestAnimationFrame(() => fitSlide(node));
      count.textContent = `${i + 1} / ${o.count}`;
      prog.style.transform = `scaleX(${(i + 1) / o.count})`;
      const act = document.activeElement;
      prev.disabled = i === 0;
      next.disabled = i === o.count - 1;
      // a button that switched itself off must not take the focus (and with it the arrow keys) away from the deck
      if ((act === prev && prev.disabled) || (act === next && next.disabled)) { try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
      if (o.onShow) { try { o.onShow(i); } catch (e) { /* optional */ } }
    };
    prev.addEventListener('click', () => go(cur - 1));
    next.addEventListener('click', () => go(cur + 1));
    if (speak) speak.addEventListener('click', () => { const t = o.speak(cur); if (t) say(t, { force: true, priority: 1 }); });
    const onKey = (e) => {
      if (e.defaultPrevented || !el.isConnected || G.util.isTyping?.() || e.altKey || e.ctrlKey || e.metaKey) return;
      // only while this dialog is the front one, and only a key pressed inside it or nowhere (the page body)
      const top = G.ui.modal.top?.();
      if (top && top.el && top.el !== keyRoot && !top.el.contains(el)) return;
      const t = e.target;
      if (t && t !== document.body && t !== document.documentElement && t !== document && !keyRoot.contains(t)) return;
      const k = e.key;
      // Space / Enter on a button is that button's own press
      if ((k === ' ' || k === 'Spacebar' || k === 'Enter') && e.target?.closest?.('button, a, input, select, textarea')) return;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') go(cur + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') go(cur - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(o.count - 1);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    // the arrows work wherever the focus is inside the dialog — and when it is nowhere (a tap on the dialog's edge
    // leaves it on the page body), so the listener sits on the document for as long as the deck lives
    const keyRoot = host.closest('.modal') || el;
    document.addEventListener('keydown', onKey);
    // swipe (touch and pen; a mouse uses the buttons)
    let sx = 0, sy = 0, sid = null;
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; sid = e.pointerId; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) go(cur + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener('pointercancel', () => { sid = null; });
    // full screen: the browser's when it has one for elements, else the dialog grows over the page
    const setFull = (on) => {
      full = on;
      el.classList.toggle('lec-max', on);
      // the enlarged deck is a fixed layer over the page: its dialog must not hold it inside its own box meanwhile
      if (keyRoot !== el) keyRoot.classList.toggle('lec-has-max', on);
      fs.setAttribute('aria-pressed', on ? 'true' : 'false');
      fs.setAttribute('aria-label', on ? '작게 보기' : '크게 보기');
      const card = stage.firstElementChild;
      if (card?.classList?.contains('lec-slide')) requestAnimationFrame(() => fitSlide(card));
    };
    const onFsChange = () => { if (!document.fullscreenElement && full) setFull(false); };
    document.addEventListener('fullscreenchange', onFsChange);
    fs.addEventListener('click', () => {
      if (!full) {
        setFull(true);
        try {
          const p = el.requestFullscreen?.();
          // a grant that arrives after the deck was made small again is handed straight back
          if (p && p.then) p.then(() => { if (!full && document.fullscreenElement === el) document.exitFullscreen().catch(() => {}); }, () => { /* the class alone enlarges it */ });
        } catch (e) { /* no element full screen here */ }
      } else {
        try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
        setFull(false);
      }
    });
    const onResize = () => { const card = stage.firstElementChild; if (card?.classList?.contains('lec-slide')) fitSlide(card); };
    window.addEventListener('resize', onResize);
    host.appendChild(el);
    go(0);
    setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ } }, 60);
    return {
      el, go, get index() { return cur; },
      dispose() {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('fullscreenchange', onFsChange);
        if (keyRoot !== el) keyRoot.classList.remove('lec-has-max');
        window.removeEventListener('resize', onResize);
        try { if (document.fullscreenElement === el) document.exitFullscreen(); } catch (e) { /* ignore */ }
      },
    };
  }

  // ---------------------------------------------------------------- notes shown instead of a player
  const NOTES = {
    local: ['📡', '영상 강의는 누리집(서버)에서 볼 수 있어요', '지금은 서버 없이 연 체험관이라 영상을 틀 수 없어요. 아래 슬라이드 강의는 여기서도 볼 수 있어요.'],
    offline: ['🌙', '지금은 인터넷에 이어져 있지 않아요', '인터넷이 다시 이어지면 영상을 볼 수 있어요. 그동안 슬라이드 강의를 봐요.'],
    video: ['🎬', '이 영상은 지금 여기에서 볼 수 없어요', '영상이 지워졌거나, 다른 누리집에서 재생하지 못하게 되어 있어요. 다른 강의를 골라 봐요.'],
    slow: ['⏳', '영상을 불러오지 못했어요', '인터넷이 느리거나 끊겼을 수 있어요. 잠시 뒤에 다시 해 봐요.'],
    file: ['📄', '강의 자료를 열지 못했어요', '자료가 바뀌었거나 인터넷이 끊겼을 수 있어요. 잠시 뒤에 다시 해 봐요.'],
    pptx: ['📊', '이 발표 자료는 간단 보기로 열 수 없어요', '파일이 너무 크거나 이 기기가 읽지 못하는 형식이에요. 운영자에게 PDF 나 그림으로 올려 달라고 해 주세요.'],
    browser: ['🧩', '이 기기에서는 간단 보기를 쓸 수 없어요', '브라우저를 새 판으로 바꾸면 볼 수 있어요.'],
  };
  function noteCard(key, extra) {
    const n = NOTES[key] || NOTES.file;
    return h('div', { class: 'lec-notecard', role: 'status' }, h('div', { class: 'emoji', 'aria-hidden': 'true' }, n[0]), h('b', null, n[1]), h('p', null, n[2]), extra || null);
  }
  /** open one of this site's own files or a grown-up link in a new tab — behind the gate in easy mode */
  async function openOutside(url, why) {
    if (easyOn()) {
      let ok = false;
      try { ok = await G.easy.gate({ reason: 'lecture-open', title: '새 창은 어른과 함께', text: why || '새 창으로 여는 일은 보호자가 해요. 문제를 2개 연달아 맞혀 주세요.' }); } catch (e) { ok = false; }
      if (!ok) return false;
    }
    try { const w = window.open(url, '_blank', 'noopener,noreferrer'); if (w) w.opener = null; } catch (e) { toast('새 창을 열지 못했어요.', { type: 'error' }); return false; }
    return true;
  }

  // ---------------------------------------------------------------- the system
  const S = {
    name: 'lecture', order: 67, label: '강의실',
    _srv: [], _decks: null, _v: 0, _opt: { autoOpen: true }, _last: 0, _busy: null, _modal: null, _body: null, _view: null, _player: null,
    _screens: new Set(), _autoSeen: new Set(), _offer: null, _offerT: 0, _yt: null, _pending: null,

    init() {
      G.bus.on('game:login', () => { this._last = 0; this.refresh({ force: true }).catch(() => {}); this._deepLink(); });
      G.bus.on('game:logout', () => { this._srv = []; this._v = 0; this._last = 0; this._autoSeen.clear(); this._hideOffer(); this.close(); this._changed(); });
      G.bus.on('place:enter', (p) => this._onEnter(p || {}));
      G.bus.on('place:exit', () => this._hideOffer());
      G.bus.on('easy:changed', () => { if (this.isOpen()) this._render(); });
      window.addEventListener('message', (e) => this._onMessage(e));
      const want = G.params?.get('lecture');
      if (want && /^(?:\d{1,9}|deck:[A-Za-z0-9_-]{1,40})$/.test(want)) this._pending = /^\d+$/.test(want) ? Number(want) : want;
    },
    onStateLoaded() { this._decks = null; this.refresh().catch(() => {}); },
    onLogout() { this._hideOffer(); },

    // ---- data
    _decksNow() { return this._decks || (this._decks = builtinDecks()); },
    list() { return [...this._srv, ...this._decksNow()]; },
    _find(id) {
      if (id == null) return null;
      const s = String(id);
      return this.list().find((l) => String(l.id) === s) || null;
    },
    forPlace(placeId) {
      const p = String(placeId || '');
      if (!p) return null;
      const all = this.list();
      return all.find((l) => l.place === p) || all.find((l) => l.place === '*') || null;
    },
    _changed() {
      G.bus.emit('lecture:changed', { v: this._v, count: this.list().length });
      for (const sc of this._screens) { try { sc.redraw(); } catch (e) { /* a screen of a place that is gone */ } }
      if (this.isOpen() && !this._view) this._render();
    },
    refresh(o = {}) {
      if (!isServer()) return Promise.resolve(this.list());
      const now = Date.now();
      if (this._busy) return this._busy;
      if (!o.force && now - this._last < REFRESH_MS) return Promise.resolve(this.list());
      this._last = now;
      this._busy = G.net.request('lecture/list.php' + (this._v ? `?v=${this._v}` : ''), { quiet: true, timeout: 9000 }).then((d) => {
        this._busy = null;
        if (d && d.same) return this.list();
        const list = (Array.isArray(d?.lectures) ? d.lectures.slice(0, 500) : []).map(cleanLecture).filter(Boolean);
        this._srv = list;
        this._v = Number.isSafeInteger(Number(d?.v)) ? Number(d.v) : 0;
        this._opt = { autoOpen: d?.opt?.autoOpen !== false };
        this._changed();
        return this.list();
      }, (e) => { this._busy = null; this._last = now - REFRESH_MS + 15000; G.log.warn(CAT, 'the lecture list could not be read', e?.code || e?.message || e); return this.list(); });
      return this._busy;
    },
    _deepLink() {
      const id = this._pending;
      if (id == null) return;
      this._pending = null;
      const go = () => { if (this._find(id)) this.open(id); else { this.open(); toast('그 강의는 지금 볼 수 없어요. 꺼져 있거나 볼 수 있는 사람이 정해져 있어요.', { type: 'info', duration: 6000 }); } };
      setTimeout(() => { (isServer() ? this.refresh({ force: true }) : Promise.resolve()).then(go, go); }, 900);
    },

    // ---- the panel
    isOpen() { return !!(this._modal && !this._modal.closed); },
    close() { if (this.isOpen()) this._modal.close(); },
    open(id, o = {}) {
      const lec = id != null ? this._find(id) : null;
      this._view = lec ? { lec, auto: !!o.auto } : null;
      this._hideOffer();
      if (this.isOpen()) { this._render(); return this._modal; }
      this.refresh().catch(() => {});
      this._modal = G.ui.modal.open({
        id: 'lecture', title: '강의실', icon: '🎓', size: 'xl', className: 'lecture-modal',
        say: lec ? `강의. ${lec.title}` : '강의실. 보고 싶은 강의를 골라요.',
        body: (el) => { this._body = el; el.classList.add('lec-body'); this._render(); },
        onClose: () => { this._stopPlayer(); this._modal = null; this._body = null; this._view = null; },
      });
      return this._modal;
    },
    _placeName(p) {
      if (!p) return '';
      if (p === '*') return '모든 방';
      const d = G.sys.places?.def?.(p);
      return d ? String(easyOn() ? d.kidName || d.name : d.name || d.kidName) : '';
    },
    _render() {
      const el = this._body;
      if (!el) return;
      this._stopPlayer();
      el.textContent = '';
      el.classList.toggle('playing', !!this._view);
      if (this._view) this._renderPlayer(el, this._view.lec, this._view.auto); else this._renderList(el);
    },
    _thumb(l) {
      const k = KIND[l.kind] || KIND.deck;
      const emoji = h('span', { class: 'lec-thumb-e emoji', 'aria-hidden': 'true' }, l.kind === 'deck' ? l.emoji || k[0] : k[0]);
      let src = '';
      if (l.kind === 'youtube' && /^https?:$/.test(location.protocol)) src = `https://i.ytimg.com/vi/${l.yt}/mqdefault.jpg`;
      else if (l.kind === 'images') src = fileUrl(l, l.files[0].n);
      const box = h('span', { class: 'lec-thumb' }, emoji);
      if (src) {
        const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
        img.addEventListener('load', () => box.classList.add('has-img'));
        img.addEventListener('error', () => img.remove());
        img.src = src;
        box.appendChild(img);
      }
      if (l.kind === 'youtube') box.appendChild(h('span', { class: 'lec-play', 'aria-hidden': 'true' }, '▶'));
      return box;
    },
    _renderList(el) {
      const easy = easyOn(), all = this.list();
      const wrap = h('div', { class: 'lec-list' });
      wrap.appendChild(h('p', { class: 'lec-lead' }, easy ? '보고 싶은 강의를 눌러요.' : '영상 · 슬라이드 · 문서로 전통 발효를 배워요. 강의를 골라 주세요.'));
      if (!isServer()) wrap.appendChild(h('p', { class: 'lec-local' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📡'), ' ', NOTES.local[2]));
      if (!all.length) {
        wrap.appendChild(h('div', { class: 'lec-notecard' }, h('div', { class: 'emoji', 'aria-hidden': 'true' }, '🍃'), h('b', null, '아직 강의가 없어요'), h('p', null, '강의가 준비되면 여기에 나타나요.')));
      } else {
        const grid = h('div', { class: 'lec-grid', role: 'list' });
        for (const l of all) {
          const k = KIND[l.kind] || KIND.deck, place = this._placeName(l.place);
          // how many pages: a built-in deck and a picture deck know it; a pptx carries its slide count in files[0].w
          const pages = l.kind === 'deck' ? l.slides.length : l.kind === 'images' ? (l.files || []).length : l.kind === 'pptx' ? ((l.files || [])[0]?.w | 0) : 0;
          const card = h('button', { type: 'button', class: 'lec-card', role: 'listitem', 'data-say': l.kid ? `${l.title}. ${l.kid}` : `${k[1]}. ${l.title}`, 'data-kind': l.kind },
            this._thumb(l),
            h('span', { class: 'lec-meta' },
              h('span', { class: 'lec-kind' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, k[0]), ' ', k[1], pages > 1 ? ` · ${pages}장` : '', l.kind === 'link' ? ' · 어른과 함께' : ''),
              h('b', { class: 'lec-title' }, l.title),
              place ? h('small', { class: 'lec-place' }, '📍 ', place) : null));
          card.addEventListener('click', () => this.open(l.id));
          grid.appendChild(card);
        }
        wrap.appendChild(grid);
      }
      el.appendChild(wrap);
      G.ui.stagger?.(wrap.querySelectorAll('.lec-card'));
    },
    _renderPlayer(el, l, auto) {
      const k = KIND[l.kind] || KIND.deck;
      const back = h('button', { type: 'button', class: 'btn btn-soft lec-back', 'data-say': '강의 목록으로 가요' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), ' 강의 목록');
      back.addEventListener('click', () => { this._view = null; this._render(); });
      const host = h('div', { class: 'lec-host', 'data-kind': l.kind });
      el.appendChild(h('div', { class: 'lec-player' },
        h('div', { class: 'lec-head' }, back, h('b', { class: 'lec-now' }, l.title), h('span', { class: 'lec-kind' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, k[0]), ' ', k[1])),
        host));
      const P = this._player = { lec: l, host, dispose: [], deck: null };
      try {
        if (l.kind === 'youtube') this._playVideo(P, auto);
        else if (l.kind === 'slides') this._playFrame(P, l.url);
        else if (l.kind === 'images') this._playImages(P);
        else if (l.kind === 'pdf') this._playPdf(P);
        else if (l.kind === 'pptx') this._playPptx(P);
        else if (l.kind === 'link') this._playLink(P);
        else this._playDeck(P);
      } catch (e) {
        G.log.warn(CAT, `player ${l.kind} failed`, e?.message || e);
        host.textContent = '';
        host.appendChild(noteCard('file'));
      }
    },
    _stopPlayer() {
      const P = this._player;
      this._player = null;
      this._yt = null;
      if (!P) return;
      for (const d of P.dispose) { try { d(); } catch (e) { /* already gone */ } }
      try { P.deck?.dispose(); } catch (e) { /* gone */ }
      try { G.sys.audio?.unduck?.('lecture'); } catch (e) { /* no audio */ }
      try { G.bus.emit('lecture:close', { id: P.lec?.id ?? null }); } catch (e) { /* listeners only */ }
    },
    /** music steps back while a video or an online slide frame plays (61-audio also listens to lecture:play / :pause / :close) */
    _duck(on) {
      try { if (on) G.sys.audio?.duck?.('lecture', 0.12); else G.sys.audio?.unduck?.('lecture'); } catch (e) { /* no audio */ }
      try { G.bus.emit(on ? 'lecture:play' : 'lecture:pause', { id: this._player?.lec?.id ?? null }); } catch (e) { /* listeners only */ }
    },

    // ---- players
    _playVideo(P, auto) {
      const l = P.lec;
      if (!/^https?:$/.test(location.protocol)) { P.host.appendChild(noteCard('local')); return; }
      if (navigator.onLine === false) { P.host.appendChild(noteCard('offline')); return; }
      const q = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1', hl: 'ko', enablejsapi: '1', origin: location.origin });
      if (auto) { q.set('autoplay', '1'); q.set('mute', '1'); }
      const frame = h('iframe', {
        class: 'lec-frame', title: l.title, sandbox: SANDBOX, allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin', loading: 'eager', src: `${YT_ORIGIN}/embed/${l.yt}?${q}`,
      });
      const box = h('div', { class: 'lec-stage lec-video' }, frame);
      P.host.appendChild(box);
      if (auto) P.host.appendChild(h('p', { class: 'lec-note' }, '🔇 소리가 꺼진 채로 시작해요. 영상의 소리 단추를 누르면 소리가 나요.'));
      this._duck(true);
      const fail = (key) => {
        if (this._player !== P || !frame.isConnected) return;
        this._yt = null;
        this._duck(false);
        box.replaceWith(noteCard(key));
      };
      const yt = this._yt = { frame, heard: false, onError: () => fail('video'), onState: (s) => this._duck(s === 1 || s === 3) };
      // ask the player to report errors and its state (the YouTube iframe protocol: plain postMessage, no script of theirs here)
      let tries = 0;
      const hello = () => {
        if (this._yt !== yt || yt.heard || tries++ > 12 || !frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
          for (const ev of ['onError', 'onStateChange']) frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: [ev], id: 1, channel: 'widget' }), YT_ORIGIN);
        } catch (e) { /* the frame is not there yet */ }
        setTimeout(hello, 500);
      };
      let loaded = false;
      frame.addEventListener('load', () => { loaded = true; hello(); });
      const slow = setTimeout(() => { if (!loaded) fail('slow'); }, 15000);
      const off = () => fail('offline');
      window.addEventListener('offline', off);
      P.dispose.push(() => { clearTimeout(slow); window.removeEventListener('offline', off); });
    },
    _onMessage(e) {
      const yt = this._yt;
      if (!yt || e.origin !== YT_ORIGIN || e.source !== yt.frame.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { if (d.length > 20000) return; try { d = JSON.parse(d); } catch (x) { return; } }
      if (!d || typeof d !== 'object') return;
      yt.heard = true;
      if (d.event === 'onError') yt.onError(Number(d.info));
      else if (d.event === 'onStateChange') yt.onState(Number(d.info));
      else if (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number') yt.onState(d.info.playerState);
    },
    _playFrame(P, url, note) {
      const safe = frameUrl(url);
      if (!safe) { P.host.appendChild(noteCard('file')); return; }
      if (!/^https?:$/.test(location.protocol)) { P.host.appendChild(noteCard('local')); return; }
      if (navigator.onLine === false) { P.host.appendChild(noteCard('offline')); return; }
      const frame = h('iframe', { class: 'lec-frame', title: P.lec.title, sandbox: SANDBOX, allow: 'fullscreen', allowfullscreen: true, referrerpolicy: 'no-referrer', loading: 'eager', src: safe });
      P.host.appendChild(h('div', { class: 'lec-stage lec-video' }, frame));
      if (note) P.host.appendChild(note);
      this._duck(true);
    },
    _playImages(P) {
      const l = P.lec, n = l.files.length;
      P.deck = makeDeck(P.host, {
        count: n,
        render: (i) => {
          const f = l.files[i];
          const img = h('img', { class: 'lec-img', alt: `${l.title} — 슬라이드 ${i + 1}`, draggable: 'false', decoding: 'async' });
          img.addEventListener('error', () => { if (img.isConnected) img.replaceWith(noteCard('file')); });
          img.src = fileUrl(l, f.n);
          return img;
        },
        onShow: (i) => { if (i + 1 < n) { const pre = new Image(); pre.src = fileUrl(l, l.files[i + 1].n); } },
      });
    },
    _playPdf(P) {
      const l = P.lec, url = fileUrl(l, l.files[0].n);
      const phone = (G.input?.touchUI || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) && Math.min(innerWidth, innerHeight) < 620;
      const openBtn = h('button', { type: 'button', class: 'btn btn-soft lec-out', 'data-say': '새 창으로 열기. 어른과 함께 해요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📄'), ' 새 창으로 크게 보기');
      openBtn.addEventListener('click', () => openOutside(url, '문서를 새 창으로 여는 일은 보호자가 해요. 문제를 2개 연달아 맞혀 주세요.'));
      if (phone) {
        P.host.appendChild(h('div', { class: 'lec-notecard' }, h('div', { class: 'emoji', 'aria-hidden': 'true' }, '📄'), h('b', null, '문서는 새 창에서 볼 수 있어요'), h('p', null, '휴대폰에서는 문서를 새 창으로 열어서 봐요.'), openBtn));
        return;
      }
      // the browser's own pdf viewer, in a frame of this site (the answer's policy lets only this site frame it)
      const frame = h('iframe', { class: 'lec-frame lec-pdf', title: l.title, src: url + '#view=FitH', loading: 'eager', referrerpolicy: 'no-referrer' });
      P.host.appendChild(h('div', { class: 'lec-stage lec-doc' }, frame));
      P.host.appendChild(h('div', { class: 'lec-row' }, h('span', { class: 'lec-note' }, '문서가 보이지 않으면 새 창으로 열어 보세요.'), openBtn));
    },
    _playPptx(P) {
      const l = P.lec, f = l.files[0];
      const simple = () => {
        P.host.textContent = '';
        const stat = h('p', { class: 'lec-loading', role: 'status' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📊'), ' 발표 자료를 여는 중…');
        P.host.appendChild(stat);
        const dl = () => {
          const b = h('button', { type: 'button', class: 'btn btn-soft lec-out', 'data-say': '파일 내려받기. 어른과 함께 해요.' }, '⬇️ 파일 내려받기 (어른)');
          b.addEventListener('click', () => openOutside(fileUrl(l, f.n), '파일을 내려받는 일은 보호자가 해요. 문제를 2개 연달아 맞혀 주세요.'));
          return b;
        };
        if (typeof DecompressionStream !== 'function') { stat.replaceWith(noteCard('browser', dl())); return; }
        if (f.bytes > LIMITS.file) { stat.replaceWith(noteCard('pptx', dl())); return; }
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let doc = null, gone = false;
        P.dispose.push(() => { gone = true; try { ctrl?.abort(); } catch (e) { /* done */ } try { doc?.dispose(); } catch (e) { /* done */ } });
        // same origin only: the address is built here from the lecture id, never taken from the list
        fetch(fileUrl(l, f.n), { credentials: 'include', cache: 'no-store', signal: ctrl?.signal, redirect: 'error' }).then((r) => {
          if (!r.ok) throw zerr('http-' + r.status);
          if (Number(r.headers.get('content-length')) > LIMITS.file) throw zerr('too-big');
          return r.arrayBuffer();
        }).then((buf) => readPptx(buf, (i, n) => { if (!gone) stat.lastChild.textContent = ` 발표 자료를 여는 중… ${i} / ${n}`; })).then((d) => {
          if (gone || this._player !== P) { d.dispose(); return; }
          doc = d;
          stat.remove();
          const n = d.slides.length;
          P.deck = makeDeck(P.host, {
            count: n, render: (i) => slideCard(d.slides[i], i, n), speak: (i) => slideText(d.slides[i]),
            note: '간단 보기 — 원본과 모양이 다를 수 있어요' + (d.truncated ? ` · 슬라이드 ${d.truncated}장 가운데 앞의 ${n}장만 보여 줘요` : ''),
          });
        }).catch((e) => {
          if (gone) return;
          G.log.warn(CAT, 'pptx could not be opened', e?.code || e?.message || e);
          stat.replaceWith(noteCard(e?.code === 'no-inflate' ? 'browser' : /^http-|^Failed|NetworkError/.test(String(e?.code || e?.message)) ? 'file' : 'pptx', dl()));
        });
      };
      // the operator's choice: the Office viewer frame (public https + a lecture everybody may see) — the simple view stays one tap away
      if (l.office && location.protocol === 'https:') {
        const abs = new URL(fileUrl(l, f.n), location.href).href;
        const sw = h('button', { type: 'button', class: 'btn btn-soft', 'data-say': '간단 보기로 봐요' }, '📊 간단 보기로 보기');
        sw.addEventListener('click', () => { this._duck(false); simple(); });
        this._playFrame(P, 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(abs), h('div', { class: 'lec-row' }, h('span', { class: 'lec-note' }, '화면이 비어 있으면 간단 보기로 바꿔 보세요.'), sw));
        this._duck(false);
        return;
      }
      simple();
    },
    _playLink(P) {
      const l = P.lec;
      let host = '';
      try { host = new URL(l.url).hostname; } catch (e) { host = ''; }
      const b = h('button', { type: 'button', class: 'btn btn-primary lec-out', 'data-say': '새 창으로 열기. 어른과 함께 해요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔗'), ' 새 창으로 열기');
      b.addEventListener('click', () => openOutside(l.url, '바깥 누리집을 여는 일은 보호자가 해요. 문제를 2개 연달아 맞혀 주세요.'));
      P.host.appendChild(h('div', { class: 'lec-notecard' }, h('div', { class: 'emoji', 'aria-hidden': 'true' }, '🔗'), h('b', null, '이 강의는 바깥 누리집에 있어요'),
        h('p', null, '어른과 함께 새 창으로 열어요.'), host ? h('p', { class: 'lec-hostname' }, host) : null, b));
    },
    _playDeck(P) {
      const l = P.lec, n = l.slides.length;
      P.deck = makeDeck(P.host, { count: n, render: (i) => slideCard(l.slides[i], i, n), speak: (i) => slideText(l.slides[i]) });
    },

    // ---- in the rooms: the offer card and the auto-open
    _auto() {
      const want = G.params?.get('lecture');
      if (want === 'off') return false;
      return !navigator.webdriver || want === 'on';
    },
    _onEnter({ id }) {
      if (!id || !this._auto()) return;
      const run = () => {
        if (G.sys.places?.current !== id) return;
        const l = this.forPlace(id);
        if (!l) return this._hideOffer();
        if (l.autoplay && this._opt.autoOpen && !this._autoSeen.has(l.key) && !G.ui.modal.isOpen()) { this._autoSeen.add(l.key); this.open(l.id, { auto: true }); return undefined; }
        return this._showOffer(l);
      };
      setTimeout(() => { (isServer() ? this.refresh() : Promise.resolve()).then(run, run); }, 700);
    },
    _showOffer(l) {
      this._hideOffer();
      const hud = document.getElementById('hud');
      if (!hud || this.isOpen()) return;
      const go = h('button', { type: 'button', class: 'lec-offer-go', 'data-say': `강의 보기. ${l.title}` }, h('span', { class: 'lec-offer-play', 'aria-hidden': 'true' }, '▶'), h('span', { class: 'lec-offer-t' }, h('b', null, '강의 보기'), h('small', null, l.title)));
      const x = h('button', { type: 'button', class: 'lec-offer-x', 'aria-label': '강의 알림 닫기', 'data-say': '닫기' }, h('span', { 'aria-hidden': 'true' }, '✕'));
      const el = h('div', { id: 'lecture-offer', class: 'glass lec-offer', role: 'status' }, go, x);
      go.addEventListener('click', () => { this._hideOffer(); this.open(l.id); });
      x.addEventListener('click', () => this._hideOffer());
      hud.appendChild(el);
      this._offer = el;
      this._offerT = setTimeout(() => this._hideOffer(), 18000);
    },
    _hideOffer() {
      clearTimeout(this._offerT);
      if (this._offer) { this._offer.remove(); this._offer = null; }
    },

    // ---- the screen of a room
    screen(ctx, spec = {}) {
      if (!ctx || !ctx.group || typeof THREE === 'undefined') return null;
      const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const w = clamp(num(spec.w, 2.4), 0.8, 8), hh = clamp(num(spec.h, w * 9 / 16), 0.45, 4.5);
      const x = num(spec.x, 0), y = num(spec.y, 1.7), z = num(spec.z, 0), rotY = num(spec.rotY, 0);
      const low = !!ctx.low;
      const CW = low ? 512 : 1024, CH = Math.round(CW * hh / w);
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      const c2 = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = low ? 1 : 4;
      const own = (t) => (typeof ctx.own === 'function' ? ctx.own(t) : t);
      const mat = own(new THREE.MeshBasicMaterial({ map: own(tex), fog: false }));
      const frameMat = own(new THREE.MeshStandardMaterial({ color: 0x3b2a1d, roughness: 0.72, metalness: 0.02 }));
      const g = new THREE.Group();
      g.name = 'lecture-screen';
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, hh + 0.16, 0.07), frameMat);
      frame.position.z = -0.005;
      frame.castShadow = !low; frame.receiveShadow = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
      face.position.z = 0.034;
      face.name = 'lecture-screen-face';
      face.userData.guardSkip = true;   // a lit picture on a wall: world geometry for the render guard
      g.add(frame, face);
      if (spec.stand) {
        const legH = Math.max(0.2, y - hh / 2);
        for (const sx of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, legH, 0.07), frameMat);
          leg.position.set(sx * (w / 2 - 0.12), -hh / 2 - legH / 2, -0.01);
          leg.castShadow = !low;
          g.add(leg);
        }
        const foot = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.06, 0.5), frameMat);
        foot.position.set(0, -hh / 2 - legH + 0.03, 0);
        g.add(foot);
      }
      ctx.group.add(g);
      const placeId = String(ctx.id || ctx.def?.id || '');
      const sc = { placeId, lec: null, img: null, imgKey: '' };
      const paint = () => {
        drawScreen(c2, CW, CH, sc.lec, sc.img, spec.title);
        tex.needsUpdate = true;
      };
      sc.redraw = () => {
        sc.lec = this.forPlace(placeId);
        const l = sc.lec;
        // a picture for the card: the first slide of an image deck (this site), or the video's thumbnail when the host lets a canvas use it
        const src = !l ? '' : l.kind === 'images' ? fileUrl(l, l.files[0].n) : l.kind === 'youtube' && /^https?:$/.test(location.protocol) ? `https://i.ytimg.com/vi/${l.yt}/hqdefault.jpg` : '';
        if (src !== sc.imgKey) {
          sc.imgKey = src; sc.img = null;
          if (src) {
            const im = new Image();
            if (l.kind === 'youtube') { im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; }
            im.onload = () => { if (sc.imgKey !== src || !this._screens.has(sc)) return; sc.img = im; try { paint(); } catch (e) { sc.img = null; paint(); } };
            im.src = src;
          }
        }
        paint();
      };
      this._screens.add(sc);
      own({ dispose: () => { this._screens.delete(sc); } });
      sc.redraw();
      if (isServer()) this.refresh().catch(() => {});
      const fx = Math.sin(rotY), fz = Math.cos(rotY);
      try {
        ctx.interact?.({
          id: `${placeId || 'place'}:lecture:${this._screens.size}`, kind: 'lecture', label: '강의 보기', kidLabel: '강의 보기', emoji: '🎬', radius: clamp(w * 0.9, 2.6, 4.5),
          position: { x: x + fx * 1.1, y: Math.max(1.1, y - hh * 0.2), z: z + fz * 1.1 },
          onInteract: () => { const l = this.forPlace(placeId); this.open(l ? l.id : undefined); },
        });
      } catch (e) { G.log.warn(CAT, 'the screen has no interactable', e?.message || e); }
      return g;
    },
  };

  // ---------------------------------------------------------------- the title card of a room's screen (canvas)
  function wrapText(c, text, maxW, maxLines) {
    const out = [];
    let line = '';
    for (const ch of Array.from(String(text))) {
      if (ch === '\n') { out.push(line); line = ''; continue; }
      if (c.measureText(line + ch).width > maxW && line) {
        // break at the last space when the line has one in its second half
        const sp = line.lastIndexOf(' ');
        if (sp > line.length * 0.5 && ch !== ' ') { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; } else { out.push(line.trimEnd()); line = ch === ' ' ? '' : ch; }
      } else line += ch;
      if (out.length >= maxLines) break;
    }
    if (line && out.length < maxLines) out.push(line);
    if (out.length === maxLines && Array.from(String(text)).length > out.join('').length + maxLines) out[maxLines - 1] = out[maxLines - 1].replace(/.{1,2}$/, '…');
    return out;
  }
  function drawScreen(c, W, H, l, img, fallbackTitle) {
    const u = W / 1024;
    // a calm lit screen: deep indigo paper with a soft vignette (never pure black)
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b3a52'); g.addColorStop(1, '#1b2536');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    let textTop = H * 0.2;
    if (img) {
      // the picture covers the card; a band at the bottom keeps the words readable
      const k = Math.max(W / img.width, H / img.height), dw = img.width * k, dh = img.height * k;
      c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const band = c.createLinearGradient(0, H * 0.42, 0, H);
      band.addColorStop(0, 'rgba(15,22,34,0)'); band.addColorStop(0.55, 'rgba(15,22,34,.78)'); band.addColorStop(1, 'rgba(15,22,34,.94)');
      c.fillStyle = band; c.fillRect(0, H * 0.42, W, H * 0.58);
      textTop = H * 0.6;
    } else {
      // a quiet traditional border
      c.strokeStyle = 'rgba(232,197,138,.55)'; c.lineWidth = 5 * u; c.strokeRect(22 * u, 22 * u, W - 44 * u, H - 44 * u);
      c.strokeStyle = 'rgba(232,197,138,.22)'; c.lineWidth = 2 * u; c.strokeRect(34 * u, 34 * u, W - 68 * u, H - 68 * u);
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const kind = l ? (KIND[l.kind] || KIND.deck)[1] : '';
    c.font = `700 ${Math.round(30 * u)}px ${FONT}`;
    c.fillStyle = '#e8c58a';
    c.fillText(l ? `강의실 · ${kind}` : '강의실', W / 2, img ? textTop : H * 0.2);
    const title = l ? l.title : String(fallbackTitle || '강의 목록 보기');
    let size = Math.round(64 * u);
    c.font = `800 ${size}px ${FONT}`;
    let lines = wrapText(c, title, W * 0.84, img ? 2 : 3);
    while (lines.length > (img ? 1 : 2) && size > 38 * u) { size -= Math.round(6 * u); c.font = `800 ${size}px ${FONT}`; lines = wrapText(c, title, W * 0.84, img ? 2 : 3); }
    c.fillStyle = '#fdf8ec';
    const lh = size * 1.25, mid = img ? textTop + (H - textTop) * 0.42 : H * 0.48;
    lines.forEach((ln, i) => c.fillText(ln, W / 2, mid + (i - (lines.length - 1) / 2) * lh));
    // the play mark and the hint
    const hy = img ? H * 0.93 : H * 0.8;
    if (!img) {
      const r = 34 * u, cx = W / 2, cy = hy - 70 * u;
      if (lines.length < 3) {
        c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = 'rgba(232,197,138,.2)'; c.fill();
        c.beginPath(); c.moveTo(cx - r * 0.3, cy - r * 0.45); c.lineTo(cx + r * 0.5, cy); c.lineTo(cx - r * 0.3, cy + r * 0.45); c.closePath(); c.fillStyle = '#f4d9a8'; c.fill();
      }
    }
    c.font = `600 ${Math.round(26 * u)}px ${FONT}`;
    c.fillStyle = 'rgba(253,248,236,.82)';
    c.fillText('가까이 가서 눌러 보세요', W / 2, hy);
  }

  // test hooks (tests/lecture-client.mjs, the developer centre): the pure pieces
  S._internal = { cleanLecture, cleanDeck, frameUrl, httpsUrl, unzip, readPptx, slideCard, fitSlide, makeDeck, drawScreen, wrapText, resolvePath, zipNameOk, LIMITS, FALLBACK_DECKS, builtinDecks };
  G.register(S);
  G.sys.lecture = S;
})();
