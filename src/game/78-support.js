// =============================================================================
// 78-support.js — 신고·문의: a player reports a bug, asks a question or reports someone, with a picture of the
//                 screen; the answers of the operator come back here (G.sys.support, CONTRACT §18.1)
//
//   G.sys.support (order 92)
//     open(kind?, opts?) -> Promise<modal|null>   the 📮 문의·신고 window. kind: 'bug' | 'question' | 'report' (else the
//                         player picks). opts: { category, target: { name, id?, messageId? }, about: 'chat', quiet }
//                         The picture of the screen is taken FIRST (before any window covers it), then the window opens.
//     capture({ chat, ui }) -> Promise<{ blob, url, w, h, blur, ui } | null>   the picture of this moment as a JPEG (≤ 1600 px,
//                         ≤ the server's size limit). The drawing buffer is not kept by WebGL, so a fresh frame is
//                         rendered and read in the same task (like 52-photo). The chat window's place is pixelated and
//                         labelled unless the report is about chat (chat: true draws the visible chat lines instead —
//                         they were already filtered and masked by 60-social). DOM name plates are never in the picture. ui (default on): the HUD and the open windows are drawn over the
//                         3D frame through an SVG <foreignObject> image (uiLayer, ≤ 0.9 s; result.ui says whether it worked).
//     mine() -> Promise<{ tickets, unread, limits, local }>   server: GET api/support/mine.php; file mode: the outbox
//     openMine() -> modal  · unread (getter) · refresh() -> Promise<unread>
//   Ways in: menu tiles 📮 문의·신고 (70-app), the buttons 📮 문의 · 🚨 신고 in the chat window (and a big 📮 in the
//     easy chat row), the help window, the HUD chip "📮 답이 왔어요", the 🔔 알림함 (act 'support'), and every chat
//     report of 60-social (event chat:reported → a 🚨 ticket with the picture of the chat).
//   Server mode (CONTRACT §18.1): POST api/support/create.php (multipart: kind, category, body?, meta, target… + shot),
//     GET mine.php (?unread=1 every 4 minutes while the page is visible), POST reply.php · seen.php · delete.php,
//     GET shot.php?id= (the picture of one's own ticket, as a blob URL). Guests of a server and file mode keep the
//     report in a local outbox (no picture there, only a small preview) that a grown-up can save as a file.
//   Device facts sent along (never the save, never a name or a number of the person): build, browser, screen and window
//     size, pixel ratio, quality preset, easy / normal, server / local, place, zone, position, frame rate, look mode,
//     language, touch, the graphics device's name, error count and the last error (masked), up time, memory, and the code
//     names of the windows / panels open on top of the 3D view (uiFacts: the picture shows only the 3D scene).
//   KID RULES (§12): easy mode sends with picture tiles alone (멈췄어요 · 안 보여요 · 소리가 이상해요 · 길을 잃었어요 ·
//     누가 괴롭혀요 · 궁금해요 · 다른 거예요) — typing sits behind the grown-up gate; big buttons, 🔊 lines, ⬅️ 닫기 always.
//   SECURITY: every server text (the operator's answers) reaches the page as text (G.ui.h children / textContent);
//     ids are numbers checked again here; the picture goes only to this site (same origin) and is never put in the save.
//   Events: support:sent { id, kind, local } · support:unread { unread } · support:deleted { id }
// =============================================================================
(function () {
  const h = (...a) => G.ui.h(...a);
  const CAT = 'SUPPORT';
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const isServer = () => G.net?.mode === 'server';
  const serverUser = () => isServer() && G.auth?.current?.kind === 'server' && !G.auth.current.guest;
  const say = (t, o) => { try { G.easy?.say?.(t, o || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const toast = (t, o) => { try { G.ui.toast(t, o || {}); } catch (e) { /* no toast */ } };
  const MAX_W = 1600, MAX_H = 1600;
  const BODY_MAX = 1000;
  const POLL_MS = 240000;
  const OUTBOX_MAX = 10;
  const KINDS = {
    bug: { emoji: '🐞', label: '버그 신고', hint: '멈추거나, 안 보이거나, 이상하게 움직일 때' },
    question: { emoji: '❓', label: '문의하기', hint: '궁금한 것, 계정·결제·분양·강의' },
    report: { emoji: '🚨', label: '신고하기', hint: '괴롭힘·나쁜 말·개인정보가 보일 때' },
  };
  // the category words of each kind — the same list as server/lib/Support.php CATEGORIES (tests/support-unit.php compares)
  const CATEGORIES = {
    bug: [{ id: 'stuck', emoji: '🧊', label: '멈췄어요' }, { id: 'invisible', emoji: '🙈', label: '안 보여요' }, { id: 'sound', emoji: '🔇', label: '소리가 이상해요' }, { id: 'lost', emoji: '🧭', label: '길을 잃었어요' }, { id: 'slow', emoji: '🐢', label: '느려요' }, { id: 'save', emoji: '💾', label: '저장이 안 돼요' }, { id: 'login', emoji: '🔑', label: '로그인이 안 돼요' }, { id: 'other', emoji: '💬', label: '그 밖에' }],
    question: [{ id: 'howto', emoji: '🤔', label: '어떻게 해요?' }, { id: 'account', emoji: '🙋', label: '계정' }, { id: 'pay', emoji: '💳', label: '결제·구독' }, { id: 'allot', emoji: '🏺', label: '분양' }, { id: 'lecture', emoji: '🎓', label: '강의' }, { id: 'other', emoji: '💬', label: '그 밖에' }],
    report: [{ id: 'bully', emoji: '😢', label: '누가 괴롭혀요' }, { id: 'badword', emoji: '🤬', label: '나쁜 말을 해요' }, { id: 'privacy', emoji: '🔒', label: '개인정보가 보여요' }, { id: 'cheat', emoji: '🌀', label: '이상한 행동' }, { id: 'other', emoji: '💬', label: '그 밖에' }],
  };
  // the picture tiles of easy mode: a child taps one picture and that is the whole report
  const KID_TILES = [
    { id: 'k1', kind: 'bug', cat: 'stuck', emoji: '🧊', label: '멈췄어요', color: '#4fb3ff', say: '멈췄어요. 화면이 안 움직여요.' },
    { id: 'k2', kind: 'bug', cat: 'invisible', emoji: '🙈', label: '안 보여요', color: '#b48bff', say: '안 보여요. 있어야 할 것이 안 보여요.' },
    { id: 'k3', kind: 'bug', cat: 'sound', emoji: '🔇', label: '소리가 이상해요', color: '#ffc93c', say: '소리가 이상해요.' },
    { id: 'k4', kind: 'bug', cat: 'lost', emoji: '🧭', label: '길을 잃었어요', color: '#55d187', say: '길을 잃었어요. 어디로 가야 할지 몰라요.' },
    { id: 'k5', kind: 'report', cat: 'bully', emoji: '😢', label: '누가 괴롭혀요', color: '#ff8a5c', say: '누가 괴롭혀요. 어른에게 알려요.' },
    { id: 'k6', kind: 'question', cat: 'howto', emoji: '🤔', label: '궁금해요', color: '#36cfc0', say: '궁금해요. 어떻게 하는지 물어봐요.' },
    { id: 'k7', kind: 'bug', cat: 'other', emoji: '💬', label: '다른 거예요', color: '#c9d3c6', say: '다른 거예요.' },
  ];
  const STATUS = { new: ['🆕', '보냈어요', 'chip-gold'], open: ['💬', '확인 중', 'chip-blue'], answered: ['✅', '답이 왔어요', 'chip-green'], closed: ['📁', '끝났어요', ''] };
  // G.ui.modal.open sets the footer from opts.actions AFTER the body callback ran: a body that sets its own buttons does so
  // in a microtask (later clicks re-render synchronously before it, which is fine)
  const later = (m, actions) => queueMicrotask(() => { if (!m.closed) m.setActions(actions); });
  const catOf = (kind, id) => (CATEGORIES[kind] || []).find((c) => c.id === id) || { id, emoji: '💬', label: id };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const fmtTime = (ms) => { const d = new Date(num(ms)); const p = (n) => String(n).padStart(2, '0'); return ms ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${p(d.getHours())}:${p(d.getMinutes())}` : ''; };

  // ---------------------------------------------------------------- the picture of the screen
  function toBlob(c, type, q) { return new Promise((res) => { try { c.toBlob((b) => res(b), type, q); } catch (e) { res(null); } }); }
  /** a CSS-pixel rectangle of an element on the 3D canvas, in canvas pixels (null when it is not drawn) */
  function areaOf(el, canvasRect, kx, ky, W, H) {
    if (!el || el.hidden || !el.isConnected) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    const x = Math.max(0, (r.left - canvasRect.left) * kx), y = Math.max(0, (r.top - canvasRect.top) * ky);
    const w = Math.min(W - x, r.width * kx), hh = Math.min(H - y, r.height * ky);
    return w > 4 && hh > 4 ? { x, y, w, h: hh } : null;
  }
  /** pixelate a region (works in every browser; ctx.filter is not everywhere) and say that it was hidden */
  function hideRegion(ctx, a, label) {
    const tw = Math.max(2, Math.round(a.w / 18)), th = Math.max(2, Math.round(a.h / 18));
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    const tc = t.getContext('2d');
    if (tc) {
      tc.drawImage(ctx.canvas, a.x, a.y, a.w, a.h, 0, 0, tw, th);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(t, 0, 0, tw, th, a.x, a.y, a.w, a.h);
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = 'rgba(28,34,30,.55)';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.fillStyle = '#fdf8ec';
    ctx.font = `700 ${Math.max(14, Math.round(Math.min(a.w, a.h) / 9))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, a.x + a.w / 2, a.y + a.h / 2, a.w - 12);
    ctx.restore();
  }
  /** the chat lines a player sees, drawn where the chat window is (only for a report about chat) */
  function drawChat(ctx, a) {
    // the lines as 60-social keeps them (already filtered and masked): "name: words", newest last
    let lines = (Array.isArray(G.sys.social?.messages) ? G.sys.social.messages : []).filter((m) => m && m.text)
      .slice(-40).map((m) => `${m.name ? `${String(m.name).slice(0, 16)}: ` : ''}${String(m.text).replace(/\s+/g, ' ')}`.slice(0, 90));
    if (!lines.length) {
      for (const el of document.querySelectorAll('#chat-log .chat-msg, #chat-log [data-mid]')) {
        const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) lines.push(t.slice(0, 90));
      }
    }
    ctx.save();
    ctx.fillStyle = 'rgba(20,26,22,.86)';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    const fs = Math.max(12, Math.min(18, Math.round(a.h / 14)));
    const lh = Math.round(fs * 1.35);
    const top = a.y + 8 + lh + 4;                         // under the title
    const bottom = a.y + a.h - Math.max(34, fs * 2.6);    // above the date stamp drawn in the corner later
    const fit = Math.max(1, Math.floor((bottom - top) / lh));
    lines = lines.slice(-fit);                            // the newest lines always fit (the reported one is the newest)
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd98a';
    ctx.textBaseline = 'top';
    ctx.fillText('💬 채팅 (신고한 때의 화면)', a.x + 10, a.y + 8, a.w - 20);
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = '#fdf8ec';
    lines.forEach((t, k) => ctx.fillText(t, a.x + 10, top + lh * k, a.w - 20));
    ctx.restore();
  }
  function stampCorner(ctx, W, H) {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const t = `전통발효체험관 · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} · 신고·문의 화면`;
    const fs = Math.max(11, Math.round(H / 54));
    ctx.save();
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(t).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(8, H - fs - 16, w, fs + 10);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.fillText(t, 16, H - fs - 11);
    ctx.restore();
  }

  // ---------------------------------------------------------------- the interface over the 3D picture (best effort)
  // The HUD and the open windows are HTML, not part of the 3D canvas. They are drawn over the picture through an SVG
  // <foreignObject> image built from a clone of #hud and #modal-root and the page's own style rules (font files left out:
  // the system font draws the letters). Never the name plates (#labels-layer), never the chat lines: the chat panel's
  // clone is emptied (hidden below by hideRegion, or drawn by drawChat for a chat report). Every <canvas> of the clone
  // (the minimap) becomes a picture of itself; a picture that is not a data: URL is left out (an SVG image cannot load
  // anything). If the browser marks the canvas as unreadable after drawing (some browsers do for <foreignObject>), the
  // 3D-only picture is used — capture() checks with toBlob. The whole layer gives up after UI_MS.
  const UI_MS = 900;
  let cssCache = null;
  /** why the last interface layer was not drawn (developer centre / tests): '' = drawn */
  const uiWhy = { last: '', ms: 0, bytes: 0 };
  function pageCss() {
    if (cssCache) return cssCache;
    const out = [];
    for (const sh of document.styleSheets) {
      let rules = null;
      try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of rules || []) {
        if (typeof CSSFontFaceRule !== 'undefined' && r instanceof CSSFontFaceRule) continue;
        out.push(r.cssText);
      }
    }
    cssCache = out.join('\n');
    return cssCache;
  }
  function cloneFor(el, chat) {
    const c = el.cloneNode(true);
    const srcCanvases = el.querySelectorAll('canvas'), cloneCanvases = c.querySelectorAll('canvas');
    cloneCanvases.forEach((cc, i) => {
      const img = document.createElement('img');
      const sc = srcCanvases[i];
      let url = '';
      try { if (sc && sc.width > 0 && sc.height > 0) url = sc.toDataURL('image/png'); } catch (e) { url = ''; }
      if (url) img.setAttribute('src', url);
      img.setAttribute('width', String(sc?.clientWidth || cc.width || 0)); img.setAttribute('height', String(sc?.clientHeight || cc.height || 0));
      img.setAttribute('class', cc.getAttribute('class') || '');
      if (cc.getAttribute('style')) img.setAttribute('style', cc.getAttribute('style'));
      cc.replaceWith(img);
    });
    for (const im of c.querySelectorAll('img')) if (!/^data:image\//.test(im.getAttribute('src') || '')) im.removeAttribute('src');
    for (const x of c.querySelectorAll('script, iframe, video, audio, input[type=password]')) x.remove();
    // typed words in fields are never drawn (a half-written chat line, a search)
    for (const x of c.querySelectorAll('input, textarea')) { x.removeAttribute('value'); x.textContent = ''; }
    const cp = c.id === 'chat-panel' ? c : c.querySelector('#chat-panel');
    if (cp && !chat) { cp.textContent = ''; cp.style.visibility = 'hidden'; }
    if (cp && chat) { const log = cp.querySelector('#chat-log'); if (log) log.textContent = ''; }   // drawChat writes the lines
    c.removeAttribute('hidden');
    return c;
  }
  const svgLen = (x) => (typeof x === 'string' ? x.length : 0);
  async function uiLayer(W, H, opts) {
    const t0 = performance.now();
    const hud = document.getElementById('hud');
    const mr = document.getElementById('modal-root');
    uiWhy.last = 'hud-hidden'; uiWhy.ms = 0; uiWhy.bytes = 0;
    if (!hud || hud.hidden) return null;
    const vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    const html = document.documentElement;
    const wrap = document.createElementNS('http://www.w3.org/1999/xhtml', 'body');
    wrap.setAttribute('class', document.body.className.replace(/\bmodal-open\b/g, ''));
    wrap.setAttribute('style', `margin:0;width:${vw}px;height:${vh}px;position:relative;overflow:hidden;background:transparent;${html.getAttribute('style') || ''}`);
    const st = document.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    // the picture is one still moment: entrance animations would draw their first (invisible) frame
    st.textContent = `${pageCss()}\n*, *::before, *::after { animation: none !important; transition: none !important; }`;
    wrap.append(st, cloneFor(hud, !!opts.chat));
    if (mr && mr.querySelector('.modal')) {
      const mc = mr.cloneNode(false);
      for (const bd of mr.children) if (bd.querySelector?.('.modal:not(.sup-modal)')) mc.append(cloneFor(bd, !!opts.chat));
      if (mc.children.length) wrap.append(mc);
    }
    const xml = new XMLSerializer().serializeToString(wrap);
    uiWhy.bytes = svgLen(xml);
    if (performance.now() - t0 > UI_MS) { uiWhy.last = 'slow-clone'; uiWhy.ms = Math.round(performance.now() - t0); return null; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}" class="${(html.className || '').replace(/[^\w -]/g, '')}"><foreignObject x="0" y="0" width="${vw}" height="${vh}">${xml}</foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.decoding = 'async';
      const ok = await Promise.race([
        new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url; }),
        new Promise((res) => setTimeout(() => res(false), Math.max(50, UI_MS - (performance.now() - t0)))),
      ]);
      uiWhy.ms = Math.round(performance.now() - t0);
      if (!ok || !img.naturalWidth) { uiWhy.last = ok ? 'empty-image' : (img.complete ? 'image-error' : 'timeout'); return null; }
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const r = opts.rect && opts.rect.width > 0 ? opts.rect : { left: 0, top: 0, width: vw, height: vh };
      ctx.drawImage(img, r.left, r.top, r.width, r.height, 0, 0, W, H);
      // a browser that taints the canvas for <foreignObject> throws here: the caller keeps the 3D-only picture
      uiWhy.last = 'tainted';
      ctx.getImageData(0, 0, 1, 1);
      uiWhy.last = '';
      return c;
    } catch (e) { if (!uiWhy.last) uiWhy.last = 'error'; return null; } finally { URL.revokeObjectURL(url); }
  }

  // ---------------------------------------------------------------- device facts
  function glName() {
    try {
      const gl = G.sys.engine?.renderer?.getContext?.();
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const v = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
      return typeof v === 'string' ? v.slice(0, 80) : '';
    } catch (e) { return ''; }
  }
  /** what was open on top of the 3D view when the report began: the code names of the open windows (their `…-modal`
   *  class) and of open panels (body classes `show-…` / `…-open`). Code words only — never a title, a name or a chat
   *  line — at most 12, ≤ 200 characters. (The picture shows only the 3D scene; this tells the operator which window.) */
  function uiFacts() {
    const ids = [];
    const add = (s) => { const id = String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32); if (id && !ids.includes(id)) ids.push(id); };
    for (const el of document.querySelectorAll('#modal-root .modal')) {
      if (el.classList.contains('sup-modal')) continue;
      const c = [...el.classList].find((k) => /^[a-z0-9-]+-modal$/.test(k));
      add(c ? c.replace(/-modal$/, '') : 'window');
    }
    for (const k of document.body.classList) if (/^show-[a-z0-9-]+$|^[a-z0-9-]+-open$/.test(k) && k !== 'modal-open') add(k);
    return ids.slice(0, 12).join(',').slice(0, 200);
  }
  function facts(blur, ui) {
    const E = G.sys.engine, P = G.sys.player?.position, st = G.state || {};
    const m = {
      build: String(G.VERSION || 'dev').slice(0, 40),
      browser: String(navigator.userAgent || '').replace(/\s+/g, ' ').slice(0, 160),
      screen: `${screen.width | 0}x${screen.height | 0}`, view: `${innerWidth | 0}x${innerHeight | 0}`, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      quality: String(E?.quality || G.settings?.quality || '').slice(0, 12), mode: easyOn() ? 'easy' : 'normal', net: isServer() ? 'server' : 'local',
      place: String(G.sys.places?.current || '').slice(0, 40), zone: String(st.player?.zoneId || G.sys.minimap?.currentZone?.id || '').slice(0, 40),
      fps: Math.round(num(E?.fps) * 10) / 10, look: String(G.input?.lookMode || G.settings?.mouseLook || '').slice(0, 12),
      lang: String(navigator.language || '').slice(0, 16), touch: G.input?.touchUI ? 1 : 0, gl: glName(),
      errors: Array.isArray(G.__systemErrors) ? G.__systemErrors.length : 0, uptime: Math.round(performance.now() / 1000),
      blur: blur ? 1 : 0,
      ui: typeof ui === 'string' ? ui.slice(0, 200) : '',
    };
    if (P && Number.isFinite(P.x)) { m.x = Math.round(P.x * 10) / 10; m.y = Math.round(P.y * 10) / 10; m.z = Math.round(P.z * 10) / 10; }
    const last = Array.isArray(G.__systemErrors) && G.__systemErrors.length ? G.__systemErrors[G.__systemErrors.length - 1] : null;
    if (last) m.lastError = `${last.system || ''} ${last.phase || ''}: ${String(last.message || '').split('\n')[0]}`.slice(0, 200);
    const mem = performance.memory?.usedJSHeapSize;
    if (mem) m.memMB = Math.round(mem / 1048576);
    for (const k of Object.keys(m)) if (m[k] === '' || m[k] == null) delete m[k];
    // a phone number / e-mail in a free text (an error message) never leaves the device
    if (m.lastError && G.sys.social?.maskPII) m.lastError = G.sys.social.maskPII(m.lastError);
    return m;
  }

  // ---------------------------------------------------------------- local outbox (file mode, guests)
  const outKey = () => `tfm.v1.support.outbox.${String(G.state?.profile?.id || G.auth?.current?.id || 'guest').replace(/[^\w-]/g, '').slice(0, 40)}`;
  function outbox() {
    try { const a = JSON.parse(localStorage.getItem(outKey()) || '[]'); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string').slice(0, OUTBOX_MAX) : []; } catch (e) { return []; }
  }
  function saveOutbox(list) {
    try { localStorage.setItem(outKey(), JSON.stringify(list.slice(0, OUTBOX_MAX))); return true; } catch (e) { G.log.warn(CAT, 'outbox not saved (storage full?)'); return false; }
  }
  async function thumbOf(blob) {
    if (!blob || typeof createImageBitmap !== 'function') return '';
    try {
      const bmp = await createImageBitmap(blob);
      const w = Math.min(320, bmp.width), hh = Math.max(1, Math.round((bmp.height * w) / bmp.width));
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(bmp, 0, 0, w, hh);
      bmp.close?.();
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }

  const S = {
    name: 'support',
    order: 92,
    _unread: 0,
    _limits: null,
    _poll: 0,
    _shot: null,
    _busy: false,
    get unread() { return this._unread; },

    init() {
      G.bus.on('game:login', () => { this._unread = 0; this._limits = null; this._chip(); this._startPoll(); });
      G.bus.on('game:logout', () => { this._stopPoll(); this._unread = 0; this._chip(); this._dropShot(); });
      G.bus.on('chat:reported', (p) => { this._fromChat(p).catch((e) => G.log.warn(CAT, 'chat ticket not sent', e)); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this._poll) this.refresh().catch(() => {}); });
      G.ui.onAction?.('support', () => { this.open(); return true; });
      this._chatButtons();
      G.log.info(CAT, 'ready');
    },

    // ------------------------------------------------------------ the picture
    async capture(opts = {}) {
      const E = G.sys.engine, r = E?.renderer;
      if (!r || !G.state) return null;
      let lost = !!E._lost;
      try { lost = lost || !!r.getContext().isContextLost(); } catch (e) { lost = true; }
      if (lost) return null;
      try {
        // the drawing buffer is not kept: render a fresh frame and read it in this same task
        E.render?.({ force: true });
        const src = r.domElement;
        const sw = src.width, sh = src.height;
        if (!sw || !sh) return null;
        const k = Math.min(1, MAX_W / sw, MAX_H / sh);
        const W = Math.max(16, Math.round(sw * k)), H = Math.max(16, Math.round(sh * k));
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(src, 0, 0, W, H);
        const cr = src.getBoundingClientRect();
        const kx = cr.width > 0 ? W / cr.width : 1, ky = cr.height > 0 ? H / cr.height : 1;
        let blur = false;
        // the HUD and the open windows over the 3D frame (best effort, ≤ UI_MS; the 3D-only picture otherwise)
        let ui = false;
        if (opts.ui !== false) {
          try {
            const layer = await uiLayer(W, H, { chat: !!opts.chat, rect: cr });
            if (layer) { ctx.drawImage(layer, 0, 0); ui = true; }
          } catch (e) { ui = false; }
        }
        const chat = document.getElementById('chat-panel');
        const shown = chat && !chat.classList.contains('chat-off') && !(G.sys.social?._smallScreen?.() && !document.body.classList.contains('show-chat'));
        const a = shown ? areaOf(chat, cr, kx, ky, W, H) : null;
        if (a) {
          if (opts.chat) drawChat(ctx, a);
          else { hideRegion(ctx, a, '💬 채팅 창 (가렸어요)'); blur = true; }
        }
        stampCorner(ctx, W, H);
        const limit = Number(this._limits?.shotBytes) || 1572864;
        let blob = await toBlob(c, 'image/jpeg', 0.82);
        let w = W, hh = H;
        if (blob && blob.size > limit * 0.95) {
          // too big for the server: once smaller and a little softer
          const c2 = document.createElement('canvas');
          w = Math.round(W * 0.7); hh = Math.round(H * 0.7);
          c2.width = w; c2.height = hh;
          c2.getContext('2d')?.drawImage(c, 0, 0, w, hh);
          blob = await toBlob(c2, 'image/jpeg', 0.72);
        }
        if (!blob) return null;
        return { blob, url: URL.createObjectURL(blob), w, h: hh, blur, ui };
      } catch (e) {
        G.log.warn(CAT, 'screen picture not taken', e);
        return null;
      }
    },
    _dropShot() { if (this._shot?.url) { try { URL.revokeObjectURL(this._shot.url); } catch (e) { /* gone */ } } this._shot = null; },

    // ------------------------------------------------------------ the window
    async open(kind, opts = {}) {
      if (!G.state) return null;
      if (kind && typeof kind === 'object') { opts = kind; kind = opts.kind; }
      if (!KINDS[kind]) kind = null;
      if (this._limits && this._limits.on === false && serverUser()) {
        toast('지금은 신고·문의를 받지 않아요. 잠시 후 다시 해 주세요.', { type: 'warn', easy: '지금은 보낼 수 없어요. 조금 있다 다시 해 봐요.' });
        return null;
      }
      // the picture first: the window must not stand in front of it (the 3D canvas never carries the windows anyway)
      this._ui = uiFacts();
      this._dropShot();
      this._shot = await this.capture({ chat: opts.about === 'chat' });
      G.ui.modal.get('support')?.close({ instant: true });
      return easyOn() ? this._openKid(kind, opts) : this._openNormal(kind, opts);
    },

    _pictureBlock(state, opts) {
      const box = h('div', { class: 'sup-pic' });
      const draw = () => {
        box.textContent = '';
        const shot = this._shot;
        if (!shot) {
          box.append(h('p', { class: 'sup-nopic' }, '📷 화면 사진을 찍지 못했어요. 글과 분류만 보내져요.'));
          return;
        }
        const img = h('img', { src: shot.url, alt: '지금 화면 사진', width: String(shot.w), height: String(shot.h), class: state.keep ? '' : 'is-off' });
        const row = h('div', { class: 'sup-pic-row' });
        const keep = h('button', { type: 'button', class: `btn btn-sm ${state.keep ? 'btn-soft' : 'btn-primary'}` }, state.keep ? '🗑️ 사진 빼기' : '📎 사진 넣기');
        keep.addEventListener('click', () => { state.keep = !state.keep; draw(); });
        const again = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '📷 다시 찍기');
        again.addEventListener('click', async () => { again.disabled = true; this._dropShot(); this._shot = await this.capture({ chat: opts.about === 'chat' }); state.keep = true; draw(); });
        row.append(keep, again);
        box.append(h('figure', { class: 'sup-fig' }, img, h('figcaption', null, state.keep ? '이 사진이 함께 가요' : '사진은 보내지 않아요')), row,
          h('p', { class: 'sup-note' }, '🔎 사진은 운영자에게만 보내져요. 다른 사람의 이름이나 모습이 보일 수 있어요.' + (shot.blur ? ' 채팅 창 자리는 흐리게 가렸어요.' : opts.about === 'chat' ? ' 신고한 채팅이 보이도록 채팅 창을 담았어요.' : '') + ' 저장 파일이나 개인정보는 보내지 않아요.'));
      };
      draw();
      return box;
    },

    _openNormal(kind, opts) {
      const state = { kind: kind || null, cat: opts.category || null, keep: !!this._shot, body: '', target: opts.target || null };
      const m = G.ui.modal.open({
        id: 'support', title: '문의·신고', icon: '📮', size: 'md', className: 'sup-modal', autofocus: false,
        body: (body, mm) => {
          const render = () => {
            body.textContent = '';
            if (!serverUser()) body.append(h('p', { class: 'sup-local' }, isServer() ? '🔑 로그인하면 운영자에게 바로 보낼 수 있어요. 지금은 이 기기의 📮 보낼 함에 넣어 두고, 어른이 파일로 저장할 수 있어요.' : '📁 이 체험관은 파일로 열려 있어서 운영자에게 바로 보내지 못해요. 이 기기의 📮 보낼 함에 넣어 두고, 어른이 파일로 저장해 전할 수 있어요. 서버에 설치하면 바로 보내져요.'));
            // 1 · kind
            const kinds = h('div', { class: 'sup-kinds', role: 'radiogroup', 'aria-label': '무엇을 보낼까요?' });
            for (const [id, k] of Object.entries(KINDS)) {
              const b = h('button', { type: 'button', class: `sup-kind${state.kind === id ? ' is-on' : ''}`, role: 'radio', 'aria-checked': state.kind === id ? 'true' : 'false', dataset: { kind: id } },
                h('span', { class: 'emoji', 'aria-hidden': 'true' }, k.emoji), h('b', null, k.label), h('small', null, k.hint));
              b.addEventListener('click', () => { if (state.kind !== id) { state.kind = id; state.cat = null; } render(); });
              kinds.append(b);
            }
            body.append(h('h3', { class: 'sup-h' }, '1. 무엇을 보낼까요?'), kinds);
            if (!state.kind) { later(mm, [{ label: '닫기', class: 'btn-ghost' }, { label: '📋 내 문의 보기', class: 'btn-soft', onClick: () => { this.openMine(); } }]); return; }
            // 2 · category
            const cats = h('div', { class: 'sup-cats', role: 'radiogroup', 'aria-label': '어떤 일인가요?' });
            for (const c of CATEGORIES[state.kind]) {
              const b = h('button', { type: 'button', class: `chip sup-cat${state.cat === c.id ? ' chip-gold is-on' : ''}`, role: 'radio', 'aria-checked': state.cat === c.id ? 'true' : 'false', dataset: { cat: c.id } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji), c.label);
              b.addEventListener('click', () => { state.cat = c.id; for (const x of cats.children) { const on = x.dataset.cat === c.id; x.classList.toggle('is-on', on); x.classList.toggle('chip-gold', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } const sb = mm.foot.querySelector('.btn-primary'); if (sb) sb.disabled = false; });
              cats.append(b);
            }
            body.append(h('h3', { class: 'sup-h' }, '2. 어떤 일인가요?'), cats);
            if (state.kind === 'report' && state.target?.name) body.append(h('p', { class: 'sup-target' }, `🚨 신고할 사람: ${String(state.target.name).slice(0, 20)}`));
            // 3 · picture
            body.append(h('h3', { class: 'sup-h' }, '3. 화면 사진'), this._pictureBlock(state, opts));
            // 4 · words
            const ta = h('textarea', { id: 'sup-body', maxlength: String(BODY_MAX), rows: '4', placeholder: state.kind === 'bug' ? '무엇을 하다가 어떻게 되었는지 적어 주세요. (예: 장독대에서 E 키를 눌렀더니 화면이 멈췄어요)' : state.kind === 'report' ? '언제, 어디서, 어떤 일이 있었는지 적어 주세요.' : '궁금한 것을 적어 주세요.' });
            ta.value = state.body;
            const cnt = h('small', { class: 'sup-count' }, `${ta.value.length} / ${BODY_MAX}`);
            ta.addEventListener('input', () => { state.body = ta.value; cnt.textContent = `${ta.value.length} / ${BODY_MAX}`; });
            body.append(h('h3', { class: 'sup-h' }, '4. 하고 싶은 말 (꼭 쓰지 않아도 돼요)'), h('div', { class: 'field' }, ta, cnt),
              h('p', { class: 'sup-note' }, '🔒 전화번호·주소·이메일은 쓰지 마세요. 써도 운영자에게는 가려져서 보여요.'));
            later(mm, [
              { label: '취소', class: 'btn-ghost' },
              { label: serverUser() ? '📨 보내기' : '📮 보낼 함에 넣기', class: 'btn-primary', disabled: !state.cat, onClick: async (mx, btn) => {
                if (!state.cat) { toast('어떤 일인지 골라 주세요.', { type: 'warn' }); return false; }
                btn.disabled = true;
                const r = await this._send(state, opts);
                btn.disabled = false;
                if (!r) return false;
                this._done(mx, r);
                return false;
              } },
            ]);
          };
          render();
        },
        onClose: () => { if (!G.ui.modal.get('support')) this._dropShot(); },
      });
      return m;
    },

    _openKid(kind, opts) {
      const state = { kind: kind || null, cat: opts.category || null, keep: !!this._shot, body: '', target: opts.target || null };
      if (state.kind === 'report' && !state.cat) state.cat = 'bully';
      const m = G.ui.modal.open({
        id: 'support', title: '어른에게 알려요', icon: '📮', size: 'lg', className: 'sup-modal sup-kid', autofocus: false,
        say: state.cat ? '이 화면도 같이 보낼까요?' : '무슨 일이 있었나요? 그림을 눌러요.',
        body: (body, mm) => {
          mm._kind = 'kid';
          const step1 = () => {
            body.textContent = '';
            mm.setTitle('무슨 일이 있었나요?', '📮');
            const grid = h('div', { class: 'easy-pick sup-kid-grid', role: 'listbox', 'aria-label': '무슨 일이 있었나요?' });
            grid.style.setProperty('--cols', '4'); grid.style.setProperty('--cols-s', '3'); grid.style.setProperty('--cols-xs', '2');
            KID_TILES.forEach((t, i) => {
              const b = h('button', { type: 'button', class: 'easy-tile', role: 'option', 'aria-selected': 'false', 'data-say': t.say, dataset: { tile: t.id } },
                h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, t.emoji), h('span', { class: 'et-label' }, t.label));
              b.style.setProperty('--tile', t.color); b.style.setProperty('--i', String(i));
              b.addEventListener('click', () => { G.sfx?.('click'); state.kind = t.kind; state.cat = t.cat; say(t.say, { priority: 1 }); step2(); });
              grid.append(b);
            });
            body.append(h('p', { class: 'easy-pick-text' }, '그림 하나를 누르면 어른에게 알릴 수 있어요.'), grid);
            later(mm, []);
          };
          const step2 = () => {
            body.textContent = '';
            const c = catOf(state.kind, state.cat);
            mm.setTitle(c.label, c.emoji);
            const shot = this._shot;
            const pic = h('div', { class: 'sup-kid-pic' });
            const drawPic = () => {
              pic.textContent = '';
              if (!shot) { pic.append(h('p', { class: 'sup-nopic' }, '📷 사진은 못 찍었어요. 그래도 보낼 수 있어요.')); return; }
              pic.append(h('img', { src: shot.url, alt: '지금 화면 사진', width: String(shot.w), height: String(shot.h), class: state.keep ? '' : 'is-off' }));
              const yes = h('button', { type: 'button', class: `easy-big-btn ${state.keep ? 'easy-btn-yes' : 'easy-btn-no'}`, 'data-say': '사진도 같이 보내요.', 'aria-pressed': state.keep ? 'true' : 'false' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📷'), h('span', null, '사진도 보내요'));
              const no = h('button', { type: 'button', class: `easy-big-btn ${!state.keep ? 'easy-btn-yes' : 'easy-btn-no'}`, 'data-say': '사진은 빼요.', 'aria-pressed': !state.keep ? 'true' : 'false' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🙅'), h('span', null, '사진은 빼요'));
              yes.addEventListener('click', () => { state.keep = true; drawPic(); });
              no.addEventListener('click', () => { state.keep = false; drawPic(); });
              pic.append(h('div', { class: 'sup-kid-row' }, yes, no));
            };
            drawPic();
            const send = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes sup-kid-send', 'data-say': '보내요. 어른에게 알려요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📤'), h('span', null, '보내요'));
            send.addEventListener('click', async () => {
              send.disabled = true;
              const r = await this._send(state, opts);
              send.disabled = false;
              if (r) this._done(mm, r);
            });
            const back = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no', 'data-say': '다시 골라요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), h('span', null, '다시 골라요'));
            back.addEventListener('click', () => step1());
            // words only through a grown-up (typing is not for the children)
            const write = h('button', { type: 'button', class: 'btn btn-ghost sup-grown', 'data-say': '어른이 글 쓰기. 어른만 열 수 있어요.' }, '✏️ 어른이 글 쓰기 🔒');
            const words = h('div', { class: 'sup-kid-words' });
            write.addEventListener('click', async () => {
              if (!(await G.easy?.gate?.({ reason: 'support-write', title: '어른이 글을 써요' }))) return;
              write.remove();
              const ta = h('textarea', { maxlength: String(BODY_MAX), rows: '3', placeholder: '무엇을 하다가 어떻게 되었는지 적어 주세요.' });
              ta.addEventListener('input', () => { state.body = ta.value; });
              words.append(ta);
              ta.focus();
            });
            body.append(h('p', { class: 'easy-pick-text' }, shot ? '이 화면도 같이 보낼까요?' : '보낼까요?'), pic, words, h('div', { class: 'sup-kid-row' }, back, send), write,
              h('p', { class: 'sup-note' }, serverUser() ? '운영자 선생님에게 가요. 답이 오면 🔔에서 알려 줄게요.' : '이 기기의 보낼 함에 넣어 둬요. 어른이 선생님에게 전해 줘요.'));
            say(shot ? '이 화면도 같이 보낼까요? 보내요를 누르면 어른에게 알려요.' : '보내요를 누르면 어른에게 알려요.', { priority: 0 });
            later(mm, []);
          };
          if (state.cat) step2(); else step1();
        },
        onClose: () => { if (!G.ui.modal.get('support')) this._dropShot(); },
      });
      return m;
    },

    /** after sending: the number, where the answer will be, and the way back */
    _done(m, r) {
      const kid = easyOn();
      m.body.textContent = '';
      m.setTitle(r.local ? '보낼 함에 넣었어요' : '보냈어요', r.local ? '📮' : '✅');
      const box = h('div', { class: 'easy-confirm sup-done' },
        h('div', { class: 'ec-big', 'aria-hidden': 'true' }, r.local ? '📮' : '💌'),
        h('p', { class: 'ec-title' }, kid ? (r.local ? '보낼 함에 넣었어요!' : '어른에게 알렸어요!') : (r.local ? '이 기기의 보낼 함에 넣었어요.' : `보냈어요. 문의 번호 ${r.no}`)),
        h('p', { class: 'ec-text' }, r.local ? '어른이 📋 내 문의에서 파일로 저장해 선생님께 전할 수 있어요.' : (kid ? '답이 오면 🔔에서 알려 줄게요.' : '운영자가 확인하고 답을 쓰면 🔔 알림함과 📋 내 문의에 보여요.')));
      const rowCls = kid ? 'ec-btns' : 'sup-done-row';
      const mine = h('button', { type: 'button', class: kid ? 'easy-big-btn easy-btn-no' : 'btn btn-soft', 'data-say': '내 문의 보기.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📋'), h('span', null, '내 문의 보기'));
      const ok = h('button', { type: 'button', class: kid ? 'easy-big-btn easy-btn-yes' : 'btn btn-primary', 'data-say': '좋아요. 계속 놀아요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👍'), h('span', null, kid ? '좋아요' : '닫기'));
      mine.addEventListener('click', () => { m.close(); this.openMine(); });
      ok.addEventListener('click', () => m.close());
      box.append(h('div', { class: rowCls }, mine, ok));
      m.body.append(box);
      m.setActions([]);
      if (kid) say(r.local ? '보낼 함에 넣었어요! 어른에게 말해 줘요.' : '어른에게 알렸어요! 답이 오면 알려 줄게요.', { priority: 1 });
      G.sfx?.('correct');
    },

    /** send one report (server) or keep it (outbox) → { id, no, local } | null */
    async _send(state, opts) {
      if (this._busy) return null;
      this._busy = true;
      try {
        const shot = state.keep ? this._shot : null;
        const meta = facts(!!shot?.blur, this._ui);
        const body = String(state.body || '').slice(0, BODY_MAX);
        if (serverUser()) {
          const form = new FormData();
          form.append('kind', state.kind);
          form.append('category', state.cat);
          if (body.trim()) form.append('body', body);
          form.append('meta', JSON.stringify(meta));
          if (state.kind === 'report' && state.target) {
            if (Number.isInteger(state.target.messageId) && state.target.messageId > 0) form.append('messageId', String(state.target.messageId));
            else if (/^\d{1,12}$/.test(String(state.target.id || ''))) form.append('targetId', String(state.target.id));
            else if (state.target.name) form.append('targetName', String(state.target.name).slice(0, 40));
          }
          if (shot?.blob) form.append('shot', shot.blob, 'shot.jpg');
          try {
            const d = await G.net.request('support/create.php', { form, timeout: 30000 });
            const t = d?.ticket || {};
            this._setUnread(num(d?.unread));
            G.bus.emit('support:sent', { id: num(t.id), kind: state.kind, local: false });
            G.log.info(CAT, `sent ${state.kind}/${state.cat} #${t.id}${shot ? ' with picture' : ''}`);
            return { id: num(t.id), no: String(t.no || ''), local: false };
          } catch (e) {
            const msg = e?.code === 'NETWORK_ERROR' ? '서버에 연결하지 못했어요. 잠시 후 다시 보내 주세요.' : (e?.message || '보내지 못했어요. 잠시 후 다시 해 주세요.');
            toast(msg, { type: 'error', easy: '앗, 지금은 못 보냈어요. 조금 있다 다시 해 봐요.' });
            G.log.warn(CAT, `send refused ${e?.code || ''}`);
            return null;
          }
        }
        // file mode / a guest: the local outbox (a small preview only — never the full picture in storage)
        const list = outbox();
        const item = { id: G.util.uid('sup'), at: Date.now(), kind: state.kind, category: state.cat, body, meta, target: state.target?.name ? String(state.target.name).slice(0, 20) : '', thumb: shot?.blob ? await thumbOf(shot.blob) : '' };
        list.unshift(item);
        if (!saveOutbox(list)) { item.thumb = ''; if (!saveOutbox(list)) { toast('이 기기에 저장할 자리가 없어요.', { type: 'error' }); return null; } }
        G.bus.emit('support:sent', { id: 0, kind: state.kind, local: true });
        return { id: 0, no: '', local: true };
      } finally { this._busy = false; }
    },

    /** a chat report of 60-social: a 🚨 ticket with the picture of the chat (server accounts only, quietly) */
    async _fromChat(p) {
      if (!serverUser() || !p || typeof p !== 'object') return;
      const map = { abuse: 'badword', spam: 'other', harass: 'bully', privacy: 'privacy', kid: 'bully', etc: 'other' };
      const shot = await this.capture({ chat: true });
      const form = new FormData();
      form.append('kind', 'report');
      form.append('category', map[p.reason] || 'other');
      form.append('meta', JSON.stringify(facts(false, uiFacts())));
      const mid = Number(p.messageId);
      if (Number.isInteger(mid) && mid > 0) form.append('messageId', String(mid));
      else if (/^\d{1,12}$/.test(String(p.targetId || ''))) form.append('targetId', String(p.targetId));
      else if (p.name) form.append('targetName', String(p.name).slice(0, 40));
      if (p.memo) form.append('body', String(p.memo).slice(0, 200));
      if (shot?.blob) form.append('shot', shot.blob, 'shot.jpg');
      try {
        await G.net.request('support/create.php', { form, timeout: 30000, quiet: true });
        if (!easyOn()) toast('📮 화면 사진과 함께 운영자의 신고·문의함에도 보냈어요.', { type: 'info', sound: false });
      } finally { if (shot?.url) URL.revokeObjectURL(shot.url); }
    },

    // ------------------------------------------------------------ my reports and the answers
    async mine() {
      if (!serverUser()) return { tickets: [], unread: 0, limits: null, local: true, outbox: outbox() };
      const d = await G.net.request('support/mine.php', { timeout: 12000 });
      this._limits = d?.limits || this._limits;
      this._setUnread(num(d?.unread));
      return { tickets: Array.isArray(d?.tickets) ? d.tickets : [], unread: num(d?.unread), limits: d?.limits || null, local: false, more: !!d?.more };
    },

    openMine() {
      const kid = easyOn();
      const urls = [];
      const m = G.ui.modal.open({
        id: 'support-mine', title: '내 문의', icon: '📋', size: 'md', className: `sup-modal sup-mine${kid ? ' sup-kid' : ''}`, autofocus: false,
        say: '내가 보낸 것과 받은 답이에요.',
        body: (body) => { body.append(h('p', { class: 'sup-loading' }, '불러오는 중…')); },
        actions: [{ label: '닫기', class: 'btn-ghost' }, { label: '📮 새로 보내기', class: 'btn-primary', onClick: () => { setTimeout(() => this.open(), 0); } }],
        onClose: () => { for (const u of urls) URL.revokeObjectURL(u); },
      });
      this.mine().then((d) => { if (!m.closed) this._renderMine(m, d, urls); }).catch((e) => {
        if (m.closed) return;
        m.body.textContent = '';
        m.body.append(h('p', { class: 'sup-local' }, e?.message || '내 문의를 불러오지 못했어요. 잠시 후 다시 해 주세요.'));
      });
      return m;
    },

    _renderMine(m, d, urls) {
      const kid = easyOn();
      const body = m.body;
      body.textContent = '';
      if (d.local) {
        const list = d.outbox || [];
        body.append(h('p', { class: 'sup-local' }, isServer() ? '🔑 로그인하면 운영자에게 바로 보내져요. 아래는 이 기기의 📮 보낼 함이에요.' : '📁 파일로 연 체험관이라 이 기기의 📮 보낼 함에 모아 두어요. 어른이 파일로 저장해 선생님께 전해 주세요. 서버에 설치하면 바로 보내져요.'));
        if (!list.length) { body.append(h('p', { class: 'sup-empty' }, '🍃 보낼 함이 비어 있어요.')); return; }
        const save = h('button', { type: 'button', class: kid ? 'easy-big-btn easy-btn-no' : 'btn btn-soft', 'data-say': '파일로 저장. 어른만 할 수 있어요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💾'), h('span', null, kid ? '파일로 저장 🔒' : '보낼 함을 파일로 저장'));
        save.addEventListener('click', async () => {
          if (kid && !(await G.easy?.gate?.({ reason: 'support-file', title: '보낼 함을 파일로 저장' }))) return;
          this._saveFile(list);
        });
        body.append(save);
        for (const it of list) body.append(this._card({ kind: it.kind, category: it.category, body: it.body, status: 'new', created: it.at, thumb: it.thumb, target: it.target, local: true, id: it.id }, urls, m));
        return;
      }
      if (!d.tickets.length) { body.append(h('p', { class: 'sup-empty' }, kid ? '🍃 아직 보낸 것이 없어요.' : '🍃 아직 보낸 문의가 없어요.')); return; }
      for (const t of d.tickets) body.append(this._card(t, urls, m));
      // opening the list is reading it: the answers are seen now
      if (d.unread > 0) G.net.request('support/seen.php', { body: {}, timeout: 8000, quiet: true }).then((r) => this._setUnread(num(r?.unread))).catch(() => {});
    },

    _card(t, urls, m) {
      const kid = easyOn();
      const k = KINDS[t.kind] || KINDS.bug;
      const c = catOf(t.kind, t.category);
      const st = STATUS[t.status] || STATUS.new;
      const card = h('article', { class: `sup-card${t.unread ? ' is-unread' : ''}` });
      card.append(h('header', { class: 'sup-card-head' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji || k.emoji),
        h('b', null, kid ? c.label : `${k.label} · ${c.label}`),
        h('span', { class: `chip ${t.local ? '' : st[2]}` }, t.local ? '📮 보낼 함' : `${st[0]} ${st[1]}`),
        h('small', { class: 'dim' }, `${fmtTime(t.created)}${t.no ? ` · ${t.no}` : ''}`)));
      if (t.body) card.append(h('p', { class: 'sup-card-body' }, String(t.body)));
      if (t.target) card.append(h('p', { class: 'dim small' }, `🚨 ${String(t.target)}`));
      // the picture: the outbox keeps a small preview; a server ticket is fetched from this site only (a blob URL)
      if (t.thumb && /^data:image\/jpeg;base64,/.test(t.thumb)) card.append(h('img', { class: 'sup-thumb', src: t.thumb, alt: '보낸 화면 사진' }));
      else if (t.shot && Number.isInteger(t.id)) {
        const holder = h('div', { class: 'sup-thumb-holder' }, h('small', { class: 'dim' }, '📷 사진 불러오는 중…'));
        card.append(holder);
        fetch(`${G.net.base || 'api/'}support/shot.php?id=${t.id}`, { credentials: 'include', cache: 'no-store' })
          .then((r) => (r.ok && /^image\/jpeg/.test(r.headers.get('content-type') || '') ? r.blob() : null))
          .then((b) => {
            holder.textContent = '';
            if (!b) { holder.append(h('small', { class: 'dim' }, '📷 사진을 불러오지 못했어요.')); return; }
            const u = URL.createObjectURL(b); urls.push(u);
            holder.append(h('img', { class: 'sup-thumb', src: u, alt: '보낸 화면 사진', width: String(t.shotW || ''), height: String(t.shotH || '') }));
          }).catch(() => { holder.textContent = ''; });
      }
      // the thread: the operator's answers are plain text
      if (Array.isArray(t.thread) && t.thread.length) {
        const th = h('ol', { class: 'sup-thread' });
        for (const x of t.thread) {
          const li = h('li', { class: x.side === 'admin' ? 'from-admin' : 'from-me' }, h('b', null, x.side === 'admin' ? '👑 운영자 선생님' : '🙋 나'), h('small', { class: 'dim' }, ` ${fmtTime(x.at)}`), h('p', null, String(x.body || '')));
          if (x.side === 'admin' && kid) G.easy?.speakable?.(li, `운영자 선생님의 답이에요. ${String(x.body || '').slice(0, 300)}`);
          th.append(li);
        }
        card.append(th);
      }
      const acts = h('div', { class: 'sup-card-acts' });
      if (!t.local && t.status !== 'closed') {
        const more = h('button', { type: 'button', class: 'btn btn-sm btn-soft', 'data-say': '이어서 쓰기.' }, kid ? '✏️ 어른이 이어서 쓰기 🔒' : '✏️ 이어서 쓰기');
        more.addEventListener('click', async () => {
          if (kid && !(await G.easy?.gate?.({ reason: 'support-write', title: '어른이 이어서 써요' }))) return;
          more.remove();
          const ta = h('textarea', { maxlength: String(BODY_MAX), rows: '3', placeholder: '덧붙일 말을 적어 주세요.' });
          const go = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, '📨 보내기');
          go.addEventListener('click', async () => {
            const v = ta.value.trim();
            if (!v) return;
            go.disabled = true;
            try {
              await G.net.request('support/reply.php', { body: { id: t.id, body: v.slice(0, BODY_MAX) }, timeout: 12000 });
              toast('덧붙였어요.', { type: 'success', emoji: '📨' });
              this.mine().then((d) => { if (!m.closed) this._renderMine(m, d, urls); }).catch(() => {});
            } catch (e) { toast(e?.message || '보내지 못했어요.', { type: 'error' }); go.disabled = false; }
          });
          acts.append(ta, go);
          ta.focus();
        });
        acts.append(more);
      }
      const del = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-say': '지우기.' }, '🗑️ 지우기');
      del.addEventListener('click', async () => {
        const ok = kid ? await G.easy?.confirm?.({ emoji: '🗑️', title: '지울까요?', text: '보낸 글과 사진과 답이 모두 지워져요.', say: '지울까요? 보낸 것과 답이 모두 지워져요.', yes: '지워요', no: '아니요', danger: true })
          : window.confirm('이 문의를 지울까요? 보낸 글·사진·답이 모두 지워지고 되돌릴 수 없어요.');
        if (!ok) return;
        if (t.local) {
          saveOutbox(outbox().filter((x) => x.id !== t.id));
          card.remove();
          return;
        }
        try {
          const r = await G.net.request('support/delete.php', { body: { id: t.id }, timeout: 12000 });
          this._setUnread(num(r?.unread));
          card.remove();
          G.bus.emit('support:deleted', { id: t.id });
          toast('지웠어요.', { type: 'success', emoji: '🗑️' });
        } catch (e) { toast(e?.message || '지우지 못했어요.', { type: 'error' }); }
      });
      acts.append(del);
      card.append(acts);
      return card;
    },

    /** the outbox as a JSON file (a grown-up passes it on; the server would have taken it directly) */
    _saveFile(list) {
      try {
        const data = { app: '전통발효체험관', what: '신고·문의 보낼 함', saved: new Date().toISOString(), items: list };
        const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = u; a.download = `support-outbox-${Date.now()}.json`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 4000);
        toast('파일로 저장했어요. 선생님께 전해 주세요.', { type: 'success', emoji: '💾' });
      } catch (e) { toast('파일로 저장하지 못했어요.', { type: 'error' }); }
    },

    // ------------------------------------------------------------ unread answers: polling, the chip, the 알림함
    _startPoll() {
      this._stopPoll();
      if (!serverUser()) return;
      this.refresh().catch(() => {});
      this._poll = setInterval(() => { if (document.visibilityState === 'visible') this.refresh().catch(() => {}); }, POLL_MS);
    },
    _stopPoll() { if (this._poll) clearInterval(this._poll); this._poll = 0; },
    async refresh() {
      if (!serverUser()) return 0;
      const d = await G.net.request('support/mine.php?unread=1', { timeout: 10000, quiet: true });
      this._limits = d?.limits || this._limits;
      this._setUnread(num(d?.unread));
      return this._unread;
    },
    _setUnread(n) {
      const prev = this._unread;
      this._unread = Math.max(0, n | 0);
      if (this._unread > prev) {
        // a new answer: one notice in the 🔔 알림함 (fixed words — the answer itself stays on the server)
        G.sys.engagement?.notify?.({ type: 'system', icon: '📮', title: '운영자 선생님의 답이 왔어요', text: '눌러서 📋 내 문의에서 읽어요.', act: 'support', key: 'support:answer' });
        if (easyOn()) say('운영자 선생님의 답이 왔어요!', { priority: 0, interrupt: false });
      }
      if (this._unread !== prev) G.bus.emit('support:unread', { unread: this._unread });
      this._chip();
    },
    _chip() {
      let el = document.getElementById('sup-chip');
      if (!this._unread) { if (el) el.hidden = true; return; }
      if (!el) {
        el = h('button', { type: 'button', id: 'sup-chip', class: 'sup-chip', 'data-say': '운영자 선생님의 답이 왔어요. 눌러서 읽어요.' });
        el.addEventListener('click', () => this.openMine());
        (document.getElementById('hud') || document.body).append(el);
      }
      el.textContent = '';
      el.append(h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📮'), h('span', null, `답이 왔어요${this._unread > 1 ? ` ${this._unread}` : ''}`));
      el.setAttribute('aria-label', `운영자의 답 ${this._unread}개가 왔어요. 눌러서 읽어요.`);
      el.hidden = false;
    },

    // ------------------------------------------------------------ the chat window's buttons
    _chatButtons() {
      // their own row under the reaction row: appended to that row they were pushed out of the panel's width (the
      // emoji row already fills a 265 px panel) and could not be pressed
      const quick = document.querySelector('#chat-panel .chat-quick');
      if (quick && !document.querySelector('#chat-panel .sup-chat-row')) {
        const ask = h('button', { type: 'button', class: 'sup-cq', title: '문의하기 — 운영자에게 묻거나 버그를 알려요', 'aria-label': '문의하기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📮'), h('span', { class: 'sup-cq-t' }, '문의하기'));
        const rep = h('button', { type: 'button', class: 'sup-cq', title: '신고하기 — 괴롭힘·나쁜 말을 화면 사진과 함께 알려요', 'aria-label': '신고하기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🚨'), h('span', { class: 'sup-cq-t' }, '신고하기'));
        ask.addEventListener('click', (e) => { e.stopPropagation(); this.open('question'); });
        rep.addEventListener('click', (e) => { e.stopPropagation(); this.open('report', { about: 'chat' }); });
        quick.after(h('div', { class: 'sup-chat-row', role: 'toolbar', 'aria-label': '운영자에게 알리기' }, ask, rep));
      }
      const kidRow = document.querySelector('#chat-panel .chat-kid-row');
      if (kidRow && !kidRow.querySelector('.sup-ck')) {
        const b = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no sup-ck', 'aria-label': '어른에게 알려요', 'data-say': '어른에게 알려요. 누가 괴롭히거나 이상한 일이 있을 때 눌러요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📮'));
        b.addEventListener('click', () => this.open(null, { about: 'chat' }));
        kidRow.insertBefore(b, kidRow.lastElementChild);
      }
    },
  };

  // test hooks (tests/support-client.mjs, the developer centre): the pure pieces
  S._internal = { KINDS, CATEGORIES, KID_TILES, facts, uiFacts, uiWhy, outbox, saveOutbox, outKey, areaOf, catOf };
  G.register(S);
  G.sys.support = S;
})();
