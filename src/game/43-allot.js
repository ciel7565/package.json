// =============================================================================
// 43-allot.js — 분양 (allotment) in the app: G.sys.allot (CONTRACT §16.8, the panel part)
//
//   G.sys.allot (order 64)
//     open(tab = 'mine'|'map'|'inbox'|'guide', opts = { unit, zone, kind }) -> modal   the panel (easy mode: picture tiles)
//     close() · isOpen() · tab()
//     refreshMap({ force }) -> Promise<{ v, same }>   GET api/allot/map.php?v= (local mode: the 체험용 demo)
//     refreshMine() -> Promise<mine | null>           GET api/allot/mine.php (server accounts; local: the sample unit)
//     mapState() -> { v, demo, layout L, status Uint8Array (index of L: 0 open · 1 held · 2 leased · 3 closed · 4 mine),
//                     mine: [codes], zones: [{ code, kind, name, cap, open, free }] }   — complex-units colours its units from it
//     statusOf(code) -> 'open'|'held'|'leased'|'closed'|'mine'|null
//     findFree({ kind, zone, near: code | { x, z } }) -> code | null   the nearest open unit (plan distance)
//     focus(code, { open = true }) -> bool            the map tab zoomed to the unit, selected
//     visit(code)                                     찾아가기: G.sys.places.enter('PL_ALLOT', { focusUnit }) (or a kind toast)
//     startApply(target, opts) -> Promise<result | null>   the gated application (target 'J01-0012' | { kind, zone?, auto })
//     inbox() -> Promise<notices>                     GET api/allot/inbox.php (server) · the demo notices (local)
//     perf                                            { firstDraw, lastRender, renders, blits, blitAvg, blitMax } (ms) of the map
// Events: allot:map { v, demo } (new statuses) · allot:mine { count } · allot:applied { contractNo, status, unit }
//
// MAP (the 지도 tab): one canvas. The site plan of 만장대 단지 comes from the master plan G.data.complex (33-complex-plan.js):
//   C.draw paints the plan (river, road, roundabout, buildings, rings, terraces) and C.layout(zones of map.php) places every
//   unit; hit-testing is L.unitAt after inverting the view. Two offscreen layers per zoom level — the plan (drawn once) and
//   the units (redrawn only when the map version or the filter changes) — cover twice the screen and are blitted while
//   panning; a zoom gesture scales the cached layers until it settles, then that level is drawn once (an LRU keeps 3
//   levels). Status = colour (Okabe–Ito) AND shape (filled · ring · small · cross · star), so colour is never the only sign.
// POLLING: map.php?v= every 60 s while the panel is open and the page visible (an unchanged v answers { same: true });
//   inbox.php?after= on login and every 10 min while visible — new notices go to the 알림함 (engagement.notify, act 'allot').
// APPLICATION (server accounts only): G.easy.gate({ reason: 'allot-apply' }) → modal 'allot-apply' (class allot-adult-modal,
//   a grown-up screen in 08-easy) → the plan on one screen (구좌 · 기간 · 금액 · 받는 날 · 환불 기한 from plans.php) → name /
//   phone (+ address when the operator collects it) and the consents → the contract number and the payment guide (토스
//   when enabled). UNIT_TAKEN offers the nearest free unit; APPLY_LIMIT, offline and a lost login get calm words.
// KID RULES (§12): easy mode = picture tiles (🏺 내 항아리 · 🗺️ 지도 · 🔔 알림 · 👨‍👩‍👧 어른과 함께 신청), no typing (nameplates are
//   presets), no prices (plans.php is never called in easy mode), 🔊 lines. SECURITY: every server string reaches the DOM
//   as text (G.ui.h children / textContent / canvas fillText) — never innerHTML; codes and ids are checked before use.
// LOCAL MODE: the default preset laid out by G.data.complex with a deterministic made-up occupancy and one sample unit,
//   labelled 체험용, read-only ("서버 모드에서 실제 분양을 볼 수 있어요").
// =============================================================================
(function () {
  const U = G.util;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const h = (...a) => G.ui.h(...a);
  const CAT = 'ALLOT';
  const D = () => G.data.allot || {};
  const CX = () => G.data.complex || null;
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const isServer = () => G.net?.mode === 'server';
  const serverAccount = () => isServer() && G.auth?.current?.kind === 'server';
  const reduced = () => (typeof G.motionReduced === 'function' ? G.motionReduced() : !!G.settings?.reduceMotion);
  const say = (t, o) => { try { G.easy?.say?.(t, o || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const toast = (m, o) => { try { G.ui.toast(m, o); } catch (e) { /* ui not ready */ } };
  const nowMs = () => (G.time?.now ? G.time.now() : Date.now());
  const RX_CODE = /^[A-Z0-9]{1,12}-\d{1,6}$/;
  const RX_ZONE = /^[A-Z0-9]{1,12}$/;
  const RX_CNO = /^[A-Za-z0-9-]{4,40}$/;
  const KINDS = ['jar', 'plot', 'store'];
  const ST_CHARS = 'ohlc';                 // map.php characters → 0 open · 1 held · 2 leased · 3 closed (4 = mine, client)
  const ST_KEYS = ['open', 'held', 'leased', 'closed', 'mine'];
  const ST_SHORT = ['o', 'h', 'l', 'c', 'm'];
  const MAP_POLL = 60000, INBOX_POLL = 10 * 60000;
  const LS_LAST = 'tfm.v1.allotLast.';     // + user id: the newest notice already handed to the 알림함
  const MAX_SCALE = 42;                    // px per metre at the closest zoom (a jar ≈ 38 px)
  const PAGE = 6;                          // 내 분양 cards per page
  const fmtWon = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
  const pad2 = (n) => String(n).padStart(2, '0');
  function dateText(ms, withYear = true) {
    const t = Number(ms) || 0;
    if (t <= 0) return '';
    const d = new Date(t);
    return `${withYear ? d.getFullYear() + '. ' : ''}${d.getMonth() + 1}. ${d.getDate()}.`;
  }
  function dday(ms) {
    const t = Number(ms) || 0;
    if (t <= 0) return '';
    const a = new Date(nowMs()); a.setHours(0, 0, 0, 0);
    const b = new Date(t); b.setHours(0, 0, 0, 0);
    const n = Math.round((b - a) / 86400000);
    return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`;
  }
  const kindOf = (k) => D().kinds?.[k] || { name: '자리', emoji: '📍', kidName: '내 자리', steps: [] };
  const josa = (w, p) => (G.easy?.josa ? G.easy.josa(w, p) : w + p.split('/')[0]);

  // ---------------------------------------------------------------- errors → calm words
  const ERR = {
    UNIT_TAKEN: '다른 분이 먼저 골랐어요, 옆자리를 볼까요?',
    NOT_OPEN: '지금은 신청을 받지 않는 자리예요. 다른 자리를 골라 주세요.',
    SOLD_OUT: '이 종류는 빈 자리가 모두 찼어요. 대기 명단에 이름을 올릴 수 있어요.',
    APPLY_LIMIT: '한 계정이 신청할 수 있는 자리 수를 다 썼어요.',
    CONSENT_REQUIRED: '안내 내용이 바뀌었어요. 새 안내를 읽고 다시 동의해 주세요.',
    ALLOT_DISABLED: '지금은 운영자가 분양을 잠시 닫아 두었어요.',
    AUTH_REQUIRED: '로그인이 끝났어요. 다시 로그인한 뒤에 해 주세요.',
    NETWORK_ERROR: '인터넷 연결이 잠깐 끊겼어요. 연결되면 다시 해 주세요.',
    RATE_LIMITED: '요청이 많았어요. 잠깐 쉬었다가 다시 해 주세요.',
    NOT_FOUND: '찾는 자리나 계약이 없어요. 화면을 새로 고쳐 볼게요.',
    NOT_LIVE: '이미 끝났거나 취소된 계약이에요.',
    HAS_FREE: '아직 빈 자리가 있어요. 대기 대신 바로 신청할 수 있어요.',
    ALREADY_WAITING: '이미 대기 명단에 올라 있어요.',
    OFFER_GONE: '제안 기간이 지나서 그 자리는 다른 분께 넘어갔어요.',
    NOTHING_DUE: '지금 낼 금액이 없어요.',
    PAY_DISABLED: '온라인 결제를 쓰지 않는 곳이에요. 안내된 방법으로 납부해 주세요.',
    PAYMENT_NOT_CONFIGURED: '운영자가 결제 설정을 마치면 온라인으로 낼 수 있어요.',
    AMOUNT_MISMATCH: '결제 금액이 주문과 달라 확인하지 못했어요. 운영자에게 알려 주세요.',
    PAYMENT_FAILED: '결제가 승인되지 않았어요.',
    PAYMENT_PENDING: '결제를 확인하는 중이에요. 잠시 뒤 내 분양에서 다시 확인해 주세요.',
    ORDER_NOT_FOUND: '주문을 찾지 못했어요.',
    ORDER_NOT_OPEN: '이미 처리된 주문이에요.',
    CONTRACT_CLOSED: '끝난 계약이라 결제할 수 없어요.',
  };
  const FIELD_WORDS = { name: '이름', phone: '전화번호', addr: '주소', nameplate: '이름표', consent: '개인정보 동의', adult: '나이 확인', consentVersion: '안내 버전' };
  function errText(e, fallback) {
    const code = String(e?.code || '');
    if (code === 'APPLY_LIMIT' && e?.data && Number(e.data.max) > 0) return `한 계정은 ${Number(e.data.max)}곳까지 신청할 수 있어요 (지금 ${Number(e.data.used) || 0}곳).`;
    if (code === 'INVALID_INPUT' && e?.data?.field && FIELD_WORDS[e.data.field]) return `${FIELD_WORDS[e.data.field]}을(를) 다시 확인해 주세요.`;
    if (ERR[code]) return ERR[code];
    if (e?.status === 401) return ERR.AUTH_REQUIRED;
    if (e?.status === 0) return ERR.NETWORK_ERROR;
    return fallback || '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
  }
  const offline = (e) => String(e?.code || '') === 'NETWORK_ERROR' || e?.status === 0;
  const lostLogin = (e) => String(e?.code || '') === 'AUTH_REQUIRED' || e?.status === 401;

  /** G.net.request with one CSRF retry (the token rotates) */
  async function req(path, opts) {
    try { return await G.net.request(path, opts); } catch (e) {
      if (String(e?.code || '') === 'CSRF_INVALID') return G.net.request(path, opts);
      throw e;
    }
  }

  // ================================================================ live map data
  const Live = {
    v: 0, demo: false, zones: [], at: 0, L: null, st: null, ver: 0,   // ver: bumps on every status change (units layer)
    byZone: Object.create(null),                                        // code → zone (with s)
    mine: new Set(),                                                    // unit codes of my live contracts
    busy: null,
  };
  function setZones(zones, v, demo) {
    const C = CX();
    const clean = [];
    for (const z of Array.isArray(zones) ? zones : []) {
      if (!z || typeof z !== 'object' || !RX_ZONE.test(String(z.code || '')) || KINDS.indexOf(z.kind) < 0) continue;
      const s = typeof z.s === 'string' ? z.s.replace(/[^ohlc]/g, 'c') : '';
      const cap = clamp(Math.floor(Number(z.cap) || s.length || 0), 0, 5000);
      clean.push({ code: z.code, kind: z.kind, name: String(z.name || z.code).slice(0, 40), cap, s: s.slice(0, cap), open: z.open !== false, sort: Number.isFinite(+z.sort) ? +z.sort : clean.length });
    }
    const key = clean.map((z) => `${z.code}:${z.kind}:${z.cap}`).join('|');
    if (!Live.L || Live.L._allotKey !== key) {
      Live.L = C ? C.layout(clean) : null;
      if (Live.L) { Live.L._allotKey = key; try { C.use(Live.L); } catch (e) { /* the plan keeps its own */ } }
    }
    Live.zones = clean;
    Live.labels = zoneCentroids(Live.L);
    Live.byZone = Object.create(null);
    for (const z of clean) Live.byZone[z.code] = z;
    Live.v = Number(v) || 0;
    Live.demo = !!demo;
    Live.at = Date.now();
    rebuildStatus();
  }
  /** where a zone's name goes: the middle of its own units (a quadrant of the circle, a field, a row of houses) */
  function zoneCentroids(L) {
    const out = Object.create(null);
    if (!L) return out;
    const A = L.arrays, sx = new Float64Array(L.zones.length), sz = new Float64Array(L.zones.length), n = new Uint32Array(L.zones.length);
    for (let i = 0; i < L.count; i++) { const z = A.zone[i]; sx[z] += A.x[i]; sz[z] += A.z[i]; n[z]++; }
    L.zones.forEach((z, k) => { if (n[k]) out[z.code] = { x: sx[k] / n[k], z: sz[k] / n[k] }; });
    return out;
  }
  function rebuildStatus() {
    const L = Live.L;
    if (!L) { Live.st = null; return; }
    const st = new Uint8Array(L.count);
    const A = L.arrays;
    for (let i = 0; i < L.count; i++) {
      const z = Live.byZone[L.zones[A.zone[i]].code];
      const ch = z ? z.s.charAt(A.seq[i] - 1) : 'c';
      const k = ST_CHARS.indexOf(ch);
      st[i] = k < 0 ? 3 : (z && !z.open && k === 0 ? 3 : k);
    }
    for (const code of Live.mine) {
      const p = D().parseCode?.(code);
      const i = p ? L.index(p.zone, p.seq) : -1;
      if (i >= 0) st[i] = 4;
    }
    Live.st = st;
    Live.ver++;
    G.bus.emit('allot:map', { v: Live.v, demo: Live.demo });
  }
  /** a status we learnt from an answer (UNIT_TAKEN …) before the next map version arrives: 'h' | 'l' | 'o' | 'c' */
  function markUnit(code, ch) {
    const p = D().parseCode?.(code), z = p && Live.byZone[p.zone];
    if (!z || p.seq < 1 || p.seq > z.s.length || ST_CHARS.indexOf(ch) < 0) return false;
    z.s = z.s.slice(0, p.seq - 1) + ch + z.s.slice(p.seq);
    rebuildStatus();
    return true;
  }
  function zoneStats(z) {
    let o = 0;
    for (let i = 0; i < z.s.length; i++) if (z.s.charCodeAt(i) === 111) o++;
    return { open: z.open ? o : 0 };
  }

  // ================================================================ the demo (local mode, 체험용)
  function demoMine() {
    const code = D().demoUnit || 'J01-0012';
    const t = nowMs(), y = new Date(t).getFullYear();
    const start = new Date(y, 2, 8).getTime(), end = new Date(y, 11, 13).getTime();
    return {
      demo: true,
      contracts: [{
        contractNo: '체험-0001', status: 'active', unit: { code, kind: 'jar', zone: 'J01', zoneName: '장독대 1구역', seq: 12 },
        period: 'year', termMonths: 12, startsAt: start, endsAt: end, paidUntil: end, autoRenew: false, holdUntil: 0, payDue: 0, cancelRequested: false,
        nameplate: { text: '우리 가족 장', show: true }, createdAt: start - 6 * 86400000, decidedAt: start - 5 * 86400000, endedAt: 0, endReason: '',
        timeline: [{ k: 'applied', at: start - 6 * 86400000, done: true }, { k: 'approved', at: start - 5 * 86400000, done: true }, { k: 'paid', at: start - 5 * 86400000, done: true }, { k: 'ends', at: end, done: false }],
      }],
      waitlist: [], unread: 1, limit: { max: 3, used: 1 },
    };
  }
  function demoLogs(code) {
    const t = nowMs();
    return [
      { id: 3, kind: 'check', text: '뚜껑을 열어 장 상태를 살폈어요. 잘 익고 있어요.', at: t - 2 * 86400000, scope: 'unit' },
      { id: 2, kind: 'weather', text: '비 소식이 있어 장독 뚜껑을 덮었어요.', at: t - 6 * 86400000, scope: 'zone' },
      { id: 1, kind: 'clean', text: '장독대 둘레를 닦고 풀을 뽑았어요.', at: t - 11 * 86400000, scope: 'zone' },
    ].map((l) => ({ ...l, code }));
  }
  function demoInbox() {
    const t = nowMs();
    return { demo: true, notices: [
      { id: 2, kind: 'info', title: '가르기 날이 다가와요 (체험용)', body: '장 가르기는 담근 뒤 40~60일쯤에 해요. 날짜는 운영자가 알려 줘요.', at: t - 86400000, seen: false, contractNo: '체험-0001' },
      { id: 1, kind: 'approved', title: '분양이 확정됐어요 (체험용)', body: '장독대 1구역 12번 자리가 내 자리가 됐어요.', at: t - 30 * 86400000, seen: true, contractNo: '체험-0001' },
    ], unread: 1, last: 2 };
  }

  // ================================================================ the map view (one canvas, cached layers)
  const PERF = { firstDraw: 0, lastRender: 0, planMs: 0, unitsMs: 0, renders: 0, blits: 0, blitAvg: 0, blitMax: 0, unitsDrawn: 0 };
  // drawn zoom levels survive closing and re-opening the panel (same size, same layout): { key, list }
  const LEVELS = { key: '', list: [] };
  const MAP_COL = {
    bg: '#cfd9b4', star: '#0072B2', starRim: '#ffffff', sel: '#e8590c', halo: 'rgba(255,253,246,0.9)', label: '#2b2620', dim: 'rgba(120,112,100,0.28)',
  };
  function statusColor(k) { return (D().status?.[ST_SHORT[k]] || {}).color || ['#009E73', '#E69F00', '#7d6e60', '#b9b3aa', '#0072B2'][k]; }

  /** a star path (5 points) into ctx */
  function starPath(ctx, x, y, r) {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
      if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  /**
   * the units of L inside the view, by status (shape + colour). view = { x, z, scale, w, h } in CSS px;
   * match(i) → false draws the unit faint (filters). Returns how many were drawn.
   */
  function drawUnits(ctx, view, L, st, match) {
    const C = CX();
    if (!L || !st || !C) return 0;
    const A = L.arrays, s = view.scale, w = view.w, hh = view.h;
    const vx0 = view.x - w / 2 / s - 2, vx1 = view.x + w / 2 / s + 2, vz0 = view.z - hh / 2 / s - 2, vz1 = view.z + hh / 2 / s + 2;
    const TX = (x) => (x - view.x) * s + w / 2, TZ = (z) => (z - view.z) * s + hh / 2;
    const K = C.K;
    let n = 0;
    if (s < 2.6) {
      // far: one small square per unit, grouped by colour (no shapes are readable at this size)
      const px = Math.max(1.15, s * 1.05);
      const groups = [[], [], [], [], [], []];
      for (let i = 0; i < L.count; i++) {
        const x = A.x[i], z = A.z[i];
        if (x < vx0 || x > vx1 || z < vz0 || z > vz1) continue;
        groups[match && !match(i) ? 5 : st[i]].push(i);
      }
      for (let g = 0; g < 6; g++) {
        const list = groups[g];
        if (!list.length) continue;
        if (g === 4) continue;                       // mine: drawn as stars below, always on top
        ctx.fillStyle = g === 5 ? MAP_COL.dim : statusColor(g);
        const sz = g === 2 ? px * 0.85 : px;
        for (const i of list) ctx.fillRect(TX(A.x[i]) - sz / 2, TZ(A.z[i]) - sz / 2, sz, sz);
        n += list.length;
      }
      for (const i of groups[4]) {
        ctx.beginPath(); starPath(ctx, TX(A.x[i]), TZ(A.z[i]), 6.5);
        ctx.fillStyle = MAP_COL.star; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = MAP_COL.starRim; ctx.stroke();
        n++;
      }
      return n;
    }
    // near: shapes. Footprints from the plan constants (jar r 0.45 m; beds 1 × 1.5; bays 1.2 × 3), turned by the unit's rot.
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), null, new Path2D()];
    const mine = [];
    const foot = (i, k) => {
      const kind = A.kind[i];
      if (kind === 0) return { r: K.JAR_R * k };
      const sw = Math.abs(Math.sin(A.rot[i])) > 0.5;
      const a = (kind === 1 ? K.BED_W : K.BAY_W) * 0.92 * k, b = (kind === 1 ? K.BED_D : K.BAY_D) * 0.92 * k;
      return sw ? { hw: b / 2, hd: a / 2 } : { hw: a / 2, hd: b / 2 };
    };
    for (let i = 0; i < L.count; i++) {
      const x = A.x[i], z = A.z[i];
      if (x < vx0 || x > vx1 || z < vz0 || z > vz1) continue;
      const k = match && !match(i) ? 5 : st[i];
      if (k === 4) { mine.push(i); continue; }
      const sx = TX(x), sz = TZ(z);
      const f = foot(i, k === 2 ? 0.78 * s : s);
      const p = paths[k];
      if (k === 3) {           // closed: a cross
        const r = (f.r || Math.min(f.hw, f.hd)) * 0.8;
        p.moveTo(sx - r, sz - r); p.lineTo(sx + r, sz + r); p.moveTo(sx + r, sz - r); p.lineTo(sx - r, sz + r);
      } else if (f.r) { p.moveTo(sx + f.r, sz); p.arc(sx, sz, f.r, 0, Math.PI * 2); } else p.rect(sx - f.hw, sz - f.hd, f.hw * 2, f.hd * 2);
      n++;
    }
    const lw = Math.max(1.1, 0.14 * s);
    ctx.fillStyle = MAP_COL.dim; ctx.fill(paths[5]);
    ctx.fillStyle = statusColor(2); ctx.fill(paths[2]);
    ctx.fillStyle = statusColor(0); ctx.fill(paths[0]);
    if (s > 6) { ctx.strokeStyle = 'rgba(0,60,40,0.55)'; ctx.lineWidth = Math.max(0.6, 0.05 * s); ctx.stroke(paths[0]); }
    ctx.fillStyle = 'rgba(230,159,0,0.28)'; ctx.fill(paths[1]);
    ctx.strokeStyle = statusColor(1); ctx.lineWidth = lw; ctx.stroke(paths[1]);
    ctx.strokeStyle = statusColor(3); ctx.lineWidth = Math.max(1, 0.1 * s); ctx.stroke(paths[3]);
    for (const i of mine) {
      ctx.beginPath(); starPath(ctx, TX(A.x[i]), TZ(A.z[i]), Math.max(6.5, 0.85 * s));
      ctx.fillStyle = MAP_COL.star; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = MAP_COL.starRim; ctx.stroke();
      n++;
    }
    return n;
  }

  /** the map widget: { el, canvas, setView, fitAll, zoomZone, zoomBy, focusUnit, select, render, destroy, view } */
  function makeMap(host, o) {
    const C = CX();
    const canvas = h('canvas', { class: 'al-canvas', role: 'img', tabindex: '0', 'aria-label': '만장대 단지 지도. 끌어서 옮기고, 손가락 두 개나 바퀴로 크기를 바꾸고, 자리를 누르면 정보가 나와요.' });
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const M = { w: 0, h: 0, dpr: 1, view: { x: 0, z: 0, scale: 1 }, fit: 1, caches: LEVELS.list, sel: null, raf: 0, settle: 0, anim: null, dirty: true, destroyed: false, filter: null, filterKey: '', ro: null, ptr: new Map(), gesture: null };
    const quality = () => (G.settings?.quality === 'low' ? 'low' : 'high');
    function size() {
      const r = host.getBoundingClientRect();
      const w = Math.max(120, Math.round(r.width)), hh = Math.max(120, Math.round(r.height));
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      if (w === M.w && hh === M.h && dpr === M.dpr) return false;
      M.w = w; M.h = hh; M.dpr = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${hh}px`;
      const f = C ? C.fitView(w, hh, 6) : { scale: 1, x: 0, z: 0 };
      const firstFit = !M.fit || M.view.scale <= M.fit * 1.0001;
      M.fit = f.scale;
      if (firstFit) { M.view.x = f.x; M.view.z = f.z; M.view.scale = f.scale; }
      const key = `${w}x${hh}@${dpr}|${quality()}|${Live.L ? Live.L._allotKey : ''}`;
      if (LEVELS.key !== key) { LEVELS.key = key; LEVELS.list.length = 0; }
      M.dirty = true;
      return true;
    }
    const minScale = () => M.fit * 0.9;
    function clampView(v) {
      v.scale = clamp(v.scale, minScale(), MAX_SCALE);
      const b = C ? C.bounds : { minX: -200, maxX: 200, minZ: -160, maxZ: 170 };
      v.x = clamp(v.x, b.minX - 20, b.maxX + 20); v.z = clamp(v.z, b.minZ - 20, b.maxZ + 20);
      return v;
    }
    // ---- the cached layers of one zoom level: a window of 2 × the screen around the view
    function renderCache(view) {
      const t0 = performance.now();
      const cw = Math.min(M.w * 2, 2600), ch = Math.min(M.h * 2, 2600);
      const dpr = M.dpr * (cw * ch * M.dpr * M.dpr > 9e6 ? 0.75 : 1);
      const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); return c; };
      const cache = { cs: view.scale, cx: view.x, cz: view.z, cw, ch, dpr, base: mk(), units: mk(), ver: -1, fk: '' };
      const bctx = cache.base.getContext('2d');
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { C.draw(bctx, { x: view.x, z: view.z, scale: view.scale, w: cw, h: ch }, { layout: Live.L, units: false, zoneLabels: false, quality: quality() }); } catch (e) { G.log.warn(CAT, 'plan draw', e?.message || e); bctx.fillStyle = MAP_COL.bg; bctx.fillRect(0, 0, cw, ch); }
      PERF.planMs = performance.now() - t0;
      drawCacheUnits(cache);
      M.caches.unshift(cache);
      if (M.caches.length > 3) M.caches.length = 3;
      const ms = performance.now() - t0;
      PERF.renders++; PERF.lastRender = ms; if (!PERF.firstDraw) PERF.firstDraw = ms;
      return cache;
    }
    function drawCacheUnits(cache) {
      const t0 = performance.now();
      const uctx = cache.units.getContext('2d');
      uctx.setTransform(1, 0, 0, 1, 0, 0); uctx.clearRect(0, 0, cache.units.width, cache.units.height);
      uctx.setTransform(cache.dpr, 0, 0, cache.dpr, 0, 0);
      PERF.unitsDrawn = drawUnits(uctx, { x: cache.cx, z: cache.cz, scale: cache.cs, w: cache.cw, h: cache.ch }, Live.L, Live.st, M.filter);
      cache.ver = Live.ver; cache.fk = M.filterKey;
      PERF.unitsMs = performance.now() - t0;
    }
    /** does the cache hold the whole screen at scale ratio r? */
    function covers(c, v) {
      const hw = M.w / 2 / v.scale, hh = M.h / 2 / v.scale, cw = c.cw / 2 / c.cs, chh = c.ch / 2 / c.cs;
      return v.x - hw >= c.cx - cw - 0.01 && v.x + hw <= c.cx + cw + 0.01 && v.z - hh >= c.cz - chh - 0.01 && v.z + hh <= c.cz + chh + 0.01;
    }
    function pickCache(v, exact) {
      for (const c of M.caches) {
        const same = Math.abs(Math.log2(c.cs / v.scale)) < 0.01;
        if ((same || !exact) && covers(c, v)) return c;
      }
      return null;
    }
    function frame() {
      M.raf = 0;
      if (M.destroyed) return;
      if (M.anim) {
        const a = M.anim, t = clamp((performance.now() - a.t0) / a.dur, 0, 1), e = 1 - Math.pow(1 - t, 3);
        const ls = Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e;
        M.view = clampView({ x: a.from.x + (a.to.x - a.from.x) * e, z: a.from.z + (a.to.z - a.from.z) * e, scale: Math.exp(ls) });
        if (t >= 1) { M.anim = null; settleSoon(0); } else schedule();
      }
      const v = M.view;
      let c = pickCache(v, true);
      if (!c) {
        // while a gesture or an animation runs, a cached level is scaled; a fresh one is drawn once it settles
        c = (M.gesture || M.anim) ? pickCache(v, false) : null;
        if (!c) c = renderCache(v);
      }
      if (c.ver !== Live.ver || c.fk !== M.filterKey) drawCacheUnits(c);
      const t0 = performance.now();                                         // the blit itself (layers are ready)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = MAP_COL.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const r = v.scale / c.cs;                                            // CSS px on screen per CSS px of the cache
      const ox = (M.w / 2 - (c.cx - v.x) * v.scale - c.cw / 2 * r) * M.dpr;
      const oz = (M.h / 2 - (c.cz - v.z) * v.scale - c.ch / 2 * r) * M.dpr;
      const dw = c.cw * r * M.dpr, dh = c.ch * r * M.dpr;
      ctx.imageSmoothingEnabled = Math.abs(r - 1) > 0.001;
      ctx.drawImage(c.base, ox, oz, dw, dh);
      ctx.drawImage(c.units, ox, oz, dw, dh);
      ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
      overlay(v);
      const ms = performance.now() - t0;
      PERF.blits++; PERF.blitAvg += (ms - PERF.blitAvg) / Math.min(PERF.blits, 60); PERF.blitMax = Math.max(PERF.blitMax, ms);
      M.dirty = false;
      o.onView?.(v);
    }
    const TX = (x) => (x - M.view.x) * M.view.scale + M.w / 2, TZ = (z) => (z - M.view.z) * M.view.scale + M.h / 2;
    function label(txt, x, y, size, bold) {
      ctx.font = `${bold ? 800 : 700} ${size}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.6; ctx.strokeStyle = MAP_COL.halo; ctx.strokeText(txt, x, y);
      ctx.fillStyle = MAP_COL.label; ctx.fillText(txt, x, y);
    }
    function overlay(v) {
      const L = Live.L;
      if (!L) return;
      // zone names (text from the server: canvas text, never HTML) with the free count
      const fs = clamp(Math.round(11 + v.scale * 1.4), 11, 19);
      for (const z of L.zones) {
        const c = Live.labels?.[z.code] || (z.frame && z.frame.label);
        if (!c) continue;
        const lz = Live.byZone[z.code];
        const free = lz ? zoneStats(lz).open : 0;
        const x = TX(c.x), y = TZ(c.z);
        if (x < -80 || x > M.w + 80 || y < -30 || y > M.h + 30) continue;
        label(z.name, x, y, fs, true);
        if (v.scale > M.fit * 1.6) label(easyOn() ? `빈 자리 ${free}` : `빈 자리 ${free.toLocaleString('ko-KR')}`, x, y + fs + 2, fs - 3, false);
      }
      // 내 자리 pins
      for (const code of Live.mine) {
        const p = D().parseCode?.(code), u = p && L.unit(p.zone, p.seq);
        if (!u) continue;
        const x = TX(u.x), y = TZ(u.z);
        if (x < -40 || x > M.w + 40 || y < -60 || y > M.h + 20) continue;
        pin(x, y, '내 자리');
      }
      // the selection
      if (M.sel) {
        const u = L.unit(M.sel.zone, M.sel.seq);
        if (u) {
          const x = TX(u.x), y = TZ(u.z), r = Math.max(9, 1.1 * v.scale);
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 4.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
          ctx.lineWidth = 2.4; ctx.strokeStyle = MAP_COL.sel; ctx.stroke();
          if (v.scale < 6) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, y - r - 12); ctx.lineWidth = 2.4; ctx.stroke(); }
        }
      }
      furniture(v);
    }
    /** a scale bar (10 / 20 / 50 / 100 m …) and a north arrow, bottom right, like a printed site plan */
    function furniture(v) {
      const want = 110 / v.scale;
      const steps = [2, 5, 10, 20, 50, 100, 200];
      const m = steps.find((q) => q >= want * 0.6) || 200;
      const len = m * v.scale;
      const x1 = M.w - 14, x0 = x1 - len, y = M.h - 16;
      ctx.save();
      ctx.fillStyle = 'rgba(255,253,246,0.86)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0 - 10, y - 46, len + 20, 56, 10) : ctx.rect(x0 - 10, y - 46, len + 20, 56); ctx.fill();
      ctx.fillStyle = '#2b2620'; ctx.fillRect(x0, y - 4, len / 2, 5); ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 1.2; ctx.strokeRect(x0, y - 4, len, 5);
      ctx.font = '700 11px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#2b2620';
      ctx.fillText(`${m} m`, x0 + len / 2, y - 9);
      const nx = x0 + len / 2, ny = y - 34;
      ctx.beginPath(); ctx.moveTo(nx, ny - 9); ctx.lineTo(nx + 6, ny + 6); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 6, ny + 6); ctx.closePath(); ctx.fill();
      ctx.font = '800 10px sans-serif'; ctx.fillText('N', nx + 13, ny + 4);
      ctx.restore();
    }
    function pin(x, y, txt) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x - 7, y - 16); ctx.arc(x, y - 20, 8, Math.PI * 0.8, Math.PI * 2.2); ctx.closePath();
      ctx.fillStyle = MAP_COL.star; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 20, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      label(txt, x, y - 36, 12, true);
      ctx.restore();
    }
    function schedule() { if (!M.raf && !M.destroyed) M.raf = requestAnimationFrame(frame); }
    function settleSoon(ms) {
      clearTimeout(M.settle);
      M.settle = setTimeout(() => { M.gesture = null; schedule(); }, ms);
    }
    function setView(v, animate) {
      const to = clampView({ x: v.x, z: v.z, scale: v.scale });
      if (animate && !reduced()) { M.anim = { from: { ...M.view }, to, t0: performance.now(), dur: 380 }; }
      else { M.anim = null; M.view = to; }
      schedule();
    }
    function fitAll(animate) { const f = C.fitView(M.w, M.h, 6); setView({ x: f.x, z: f.z, scale: f.scale }, animate); }
    function zoomArea(a, animate, pad) {
      const f = C.fitView(M.w, M.h, pad == null ? 18 : pad, a);
      setView({ x: f.x, z: f.z, scale: Math.min(f.scale, MAX_SCALE) }, animate);
    }
    function zoomZone(code, animate) {
      const z = Live.L?.zones.find((q) => q.code === code);
      if (!z || !z.frame) return false;
      const f = z.frame;
      zoomArea({ minX: Math.min(f.x0, f.x1), maxX: Math.max(f.x0, f.x1), minZ: Math.min(f.z0, f.z1), maxZ: Math.max(f.z0, f.z1) }, animate, 14);
      return true;
    }
    function zoomBy(k, cx, cz) {
      const v = M.view;
      const ns = clamp(v.scale * k, minScale(), MAX_SCALE);
      const px = cx == null ? M.w / 2 : cx, pz = cz == null ? M.h / 2 : cz;
      const wx = v.x + (px - M.w / 2) / v.scale, wz = v.z + (pz - M.h / 2) / v.scale;
      M.view = clampView({ x: wx - (px - M.w / 2) / ns, z: wz - (pz - M.h / 2) / ns, scale: ns });
      M.gesture = M.gesture || { kind: 'zoom' };
      settleSoon(160);
      schedule();
    }
    function focusUnit(zone, seq, animate) {
      const u = Live.L?.unit(zone, seq);
      if (!u) return false;
      M.sel = { zone, seq };
      setView({ x: u.x, z: u.z, scale: Math.max(M.view.scale, 14) }, animate);
      return true;
    }
    function toWorld(px, pz) { return { x: M.view.x + (px - M.w / 2) / M.view.scale, z: M.view.z + (pz - M.h / 2) / M.view.scale }; }
    function hit(px, pz) {
      const L = Live.L;
      if (!L) return null;
      const w = toWorld(px, pz);
      const pad = clamp(9 / M.view.scale, 0.25, 3.2);
      const r = L.unitAt(w.x, w.z, pad);
      return r ? { zone: r.zone, seq: r.seq } : null;
    }
    // ---- input: drag, pinch, wheel, tap, keys
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture?.(e.pointerId); } catch (x) { /* a synthetic or already released pointer */ }
      const p = local(e);
      M.ptr.set(e.pointerId, p);
      M.anim = null;
      if (M.ptr.size === 1) M.gesture = { kind: 'drag', start: p, last: p, t0: performance.now(), moved: 0 };
      else if (M.ptr.size === 2) { const [a, b] = [...M.ptr.values()]; M.gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, moved: 99 }; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!M.ptr.has(e.pointerId)) return;
      const p = local(e);
      const prev = M.ptr.get(e.pointerId);
      M.ptr.set(e.pointerId, p);
      const g = M.gesture;
      if (!g) return;
      if (g.kind === 'drag' && M.ptr.size === 1) {
        const dx = p.x - prev.x, dy = p.y - prev.y;
        g.moved += Math.abs(dx) + Math.abs(dy);
        M.view = clampView({ x: M.view.x - dx / M.view.scale, z: M.view.z - dy / M.view.scale, scale: M.view.scale });
        schedule();
      } else if (g.kind === 'pinch' && M.ptr.size >= 2) {
        const [a, b] = [...M.ptr.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const k = d / g.d; g.d = d;
        zoomBy(k, (a.x + b.x) / 2, (a.y + b.y) / 2);
        M.gesture = g;
      }
    });
    const up = (e) => {
      if (!M.ptr.has(e.pointerId)) return;
      M.ptr.delete(e.pointerId);
      const g = M.gesture;
      if (g && g.kind === 'drag' && g.moved < 8 && performance.now() - g.t0 < 600 && e.type === 'pointerup') {
        const p = local(e);
        const r = hit(p.x, p.y);
        M.sel = r;
        schedule();
        o.onSelect?.(r);
      }
      if (!M.ptr.size) settleSoon(120);
      else if (g && g.kind === 'pinch') { const p = [...M.ptr.values()][0]; M.gesture = { kind: 'drag', start: p, last: p, t0: 0, moved: 99 }; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      zoomBy(Math.exp(-clamp(e.deltaY, -240, 240) * 0.0022), p.x, p.y);
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const step = 60 / M.view.scale;
      const k = e.key;
      if (k === 'ArrowLeft') setView({ ...M.view, x: M.view.x - step });
      else if (k === 'ArrowRight') setView({ ...M.view, x: M.view.x + step });
      else if (k === 'ArrowUp') setView({ ...M.view, z: M.view.z - step });
      else if (k === 'ArrowDown') setView({ ...M.view, z: M.view.z + step });
      else if (k === '+' || k === '=') zoomBy(1.5);
      else if (k === '-' || k === '_') zoomBy(1 / 1.5);
      else if (k === 'Enter' || k === ' ') { const r = hit(M.w / 2, M.h / 2); M.sel = r; schedule(); o.onSelect?.(r); }
      else return;
      e.preventDefault();
    });
    if (typeof ResizeObserver === 'function') { M.ro = new ResizeObserver(() => { if (size()) schedule(); }); M.ro.observe(host); }
    size();
    schedule();
    return {
      el: canvas, canvas,
      get view() { return { ...M.view }; }, get fit() { return M.fit; }, get sel() { return M.sel; },
      setView, fitAll, zoomZone, zoomArea, zoomBy, focusUnit, hit, toWorld,
      select(r) { M.sel = r; schedule(); },
      setFilter(fn, key) { M.filter = fn; M.filterKey = key || ''; schedule(); },
      render() { if (size()) { /* resized */ } schedule(); },
      /** synchronous frame (tests) */
      frameNow() { if (M.raf) { cancelAnimationFrame(M.raf); M.raf = 0; } frame(); },
      dropCaches() { M.caches.length = 0; },
      destroy() { M.destroyed = true; if (M.raf) cancelAnimationFrame(M.raf); clearTimeout(M.settle); M.ro?.disconnect?.(); },
    };
  }

  // ================================================================ the system
  const S = {
    name: 'allot', order: 64, label: '분양',
    _m: null, _tab: 'mine', _map: null, _mine: null, _mineAt: 0, _minePage: 1, _sel: null, _filter: { kind: '', freeOnly: false },
    _zoneIdx: -1, _inbox: null, _plans: null, _pollT: 0, _inboxT: 0, _ret: null, _busyApply: false, _logs: Object.create(null),
    perf: PERF,

    init() {
      G.ui.onAction?.('allot', () => this.open());
      this._ret = readPayReturn();
      if (this._ret && !this._ret.ok) setTimeout(() => toast('결제창이 닫혔거나 결제가 승인되지 않았어요. 내 분양에서 다시 낼 수 있어요.', { type: 'info', duration: 6000 }), 1500);
      G.bus.on('game:login', () => this._onLogin());
      G.bus.on('game:logout', () => this._reset());
      G.bus.on('easy:changed', () => { if (this.isOpen()) this._render(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (this.isOpen() && Date.now() - Live.at > MAP_POLL) this.refreshMap().catch(() => {});
        if (serverAccount() && G.app?.loggedIn && Date.now() - (this._inboxAt || 0) > INBOX_POLL) this._pullInbox();
      });
    },
    _reset() {
      this.close();
      clearInterval(this._pollT); clearInterval(this._inboxT); this._pollT = 0; this._inboxT = 0;
      this._mine = null; this._mineAt = 0; this._inbox = null; this._plans = null; this._logs = Object.create(null);
      Live.mine = new Set(); Live.v = 0; Live.zones = []; Live.st = null; Live.at = 0;
    },
    async _onLogin() {
      this._mine = null; this._plans = null; this._inbox = null; Live.mine = new Set(); Live.v = 0; Live.at = 0;
      if (!serverAccount()) return;
      clearInterval(this._inboxT);
      this._inboxT = setInterval(() => { if (!document.hidden) this._pullInbox(); }, INBOX_POLL);
      setTimeout(() => this._pullInbox(), 4000);
      if (this._ret && this._ret.ok) { const r = this._ret; this._ret = null; setTimeout(() => this._confirmPay(r), 800); }
    },

    // ---------------------------------------------------------------- data
    async refreshMap(opts = {}) {
      if (Live.busy) return Live.busy;
      const run = async () => {
        if (!isServer()) {
          if (!Live.demo || opts.force || !Live.L) setZones(D().demoMap?.().zones || [], 1, true);
          this._applyMineToMap();
          return { v: Live.v, same: false, demo: true };
        }
        const q = Live.v && !Live.demo && !opts.force ? `?v=${encodeURIComponent(Live.v)}` : '';
        const d = await req(`allot/map.php${q}`, { quiet: true, timeout: 15000 });
        Live.at = Date.now();
        if (d && d.same) return { v: Live.v, same: true };
        if (!d || !Array.isArray(d.zones)) throw Object.assign(new Error('bad map'), { code: 'BAD_ANSWER' });
        setZones(d.zones, d.v, false);
        this._applyMineToMap();
        return { v: Live.v, same: false };
      };
      Live.busy = run().finally(() => { Live.busy = null; });
      return Live.busy;
    },
    _applyMineToMap() {
      const codes = new Set();
      for (const c of this._mine?.contracts || []) if (['pending', 'active', 'overdue'].indexOf(c.status) >= 0 && RX_CODE.test(String(c.unit?.code || ''))) codes.add(c.unit.code);
      if (!isServer()) codes.add(D().demoUnit || 'J01-0012');
      const same = codes.size === Live.mine.size && [...codes].every((c) => Live.mine.has(c));
      Live.mine = codes;
      if (!same || !Live.st) rebuildStatus();
    },
    async refreshMine() {
      if (!isServer()) { this._mine = demoMine(); this._mineAt = Date.now(); this._applyMineToMap(); return this._mine; }
      if (!serverAccount()) { this._mine = null; return null; }
      const d = await req('allot/mine.php', { quiet: true, timeout: 15000 });
      if (!d || typeof d !== 'object') return null;
      d.contracts = (Array.isArray(d.contracts) ? d.contracts : []).filter((c) => c && typeof c === 'object' && RX_CODE.test(String(c.unit?.code || '')));
      d.waitlist = Array.isArray(d.waitlist) ? d.waitlist.filter((w) => w && Number.isInteger(w.id)) : [];
      this._mine = d; this._mineAt = Date.now();
      this._applyMineToMap();
      G.bus.emit('allot:mine', { count: d.contracts.length });
      return d;
    },
    mapState() {
      return { v: Live.v, demo: Live.demo, layout: Live.L, status: Live.st, mine: [...Live.mine], ver: Live.ver,
        zones: Live.zones.map((z) => ({ code: z.code, kind: z.kind, name: z.name, cap: z.cap, open: z.open, free: zoneStats(z).open })) };
    },
    statusOf(code) {
      const p = D().parseCode?.(code);
      const i = p && Live.L ? Live.L.index(p.zone, p.seq) : -1;
      return i >= 0 && Live.st ? ST_KEYS[Live.st[i]] : null;
    },
    /** the nearest open unit (plan distance) of a kind / zone, near a code or a point */
    findFree(o = {}) {
      const L = Live.L, st = Live.st;
      if (!L || !st) return null;
      const A = L.arrays;
      let px = null, pz = null, nearZone = '';
      if (typeof o.near === 'string') { const p = D().parseCode?.(o.near), u = p && L.unit(p.zone, p.seq); if (u) { px = u.x; pz = u.z; nearZone = p.zone; } }
      else if (o.near && Number.isFinite(o.near.x)) { px = o.near.x; pz = o.near.z; }
      const kind = KINDS.indexOf(o.kind);
      let best = -1, bd = Infinity;
      for (let pass = 0; pass < 2 && best < 0; pass++) {
        for (let i = 0; i < L.count; i++) {
          if (st[i] !== 0) continue;
          const zc = L.zones[A.zone[i]].code;
          if (o.zone && zc !== o.zone) continue;
          if (kind >= 0 && A.kind[i] !== kind) continue;
          if (pass === 0 && nearZone && zc !== nearZone) continue;    // the same zone first
          const d = px == null ? i : (A.x[i] - px) ** 2 + (A.z[i] - pz) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        if (!nearZone) break;
      }
      return best < 0 ? null : D().codeOf(L.zones[A.zone[best]].code, A.seq[best]);
    },

    // ---------------------------------------------------------------- panel
    isOpen() { return !!(this._m && !this._m.closed); },
    tab() { return this._tab; },
    close() { if (this.isOpen()) this._m.close(); },
    open(tab, opts = {}) {
      const tabs = ['mine', 'map', 'inbox', 'guide'];
      this._tab = tabs.indexOf(tab) >= 0 ? tab : (this._tab || 'mine');
      if (opts.unit && RX_CODE.test(String(opts.unit))) { this._tab = 'map'; this._pendingFocus = String(opts.unit); }
      if (this.isOpen()) { this._render(); return this._m; }
      const easy = easyOn();
      this._m = G.ui.modal.open({
        id: 'allot', title: easy ? '내 항아리·지도' : '만장대 분양', icon: '🏺', size: 'xl', className: 'allot-modal',
        say: easy ? '만장대 분양이에요. 그림을 눌러 내 항아리와 지도를 봐요.' : '만장대 분양 화면이에요.', autofocus: false,
        body: (body) => { this._body = body; },
        onClose: () => { this._destroyMap(); clearInterval(this._pollT); this._pollT = 0; this._m = null; G.ui.setActive?.('allot', false); },
      });
      G.ui.setActive?.('allot', true);
      clearInterval(this._pollT);
      this._pollT = setInterval(() => this._pollTick(), MAP_POLL);
      this._render();
      this._load();
      return this._m;
    },
    async _load() {
      const tasks = [this.refreshMap().catch((e) => { this._mapErr = e; G.log.warn(CAT, 'map', e?.code || e?.message || e); })];
      if (!isServer() || serverAccount()) tasks.push(this.refreshMine().catch((e) => { this._mineErr = e; G.log.warn(CAT, 'mine', e?.code || e?.message || e); }));
      await Promise.all(tasks);
      if (this.isOpen()) this._render();
    },
    /** one map poll: only while the panel is open and the page is visible */
    _pollTick() {
      if (document.hidden || !this.isOpen()) return false;
      this.refreshMap().then((r) => { if (r && !r.same) this._onMapData(); }).catch((e) => G.log.warn(CAT, 'map poll', e?.code || e?.message || e));
      return true;
    },
    _onMapData() { if (this._map) this._map.render(); this._updateUnitCard(); },
    _destroyMap() { if (this._map) { this._map.destroy(); this._map = null; } },
    _render() {
      if (!this.isOpen() || !this._body) return;
      const body = this._body;
      const keepMap = this._tab === 'map' && this._map && body.contains(this._map.el);
      if (keepMap) { this._renderMapTools(); return; }
      this._destroyMap();
      body.textContent = '';
      const easy = easyOn();
      const root = h('div', { class: `al-panel${easy ? ' al-easy' : ''}` });
      if (!isServer()) root.appendChild(h('div', { class: 'al-demo', role: 'note' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧪'),
        h('b', null, '체험용 화면'), h('span', null, ' 서버 모드에서 실제 분양을 볼 수 있어요. 여기 자리와 상태는 연습용이에요.')));
      else if (!serverAccount()) root.appendChild(h('div', { class: 'al-demo', role: 'note' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔑'),
        h('b', null, '계정으로 로그인하면'), h('span', null, ' 내 분양을 보고 신청할 수 있어요. 지도는 누구나 볼 수 있어요.')));
      root.appendChild(easy ? this._kidTiles() : this._tabs());
      const pane = h('section', { class: `al-pane al-pane-${this._tab}`, role: easy ? null : 'tabpanel', 'aria-label': ({ mine: '내 분양', map: '지도', inbox: '알림', guide: '안내' })[this._tab] });
      root.appendChild(pane);
      body.appendChild(root);
      if (this._tab === 'mine') this._renderMine(pane);
      else if (this._tab === 'map') this._renderMap(pane);
      else if (this._tab === 'inbox') this._renderInbox(pane);
      else this._renderGuide(pane);
    },
    _tabs() {
      const unread = Number(this._inbox?.unread ?? this._mine?.unread ?? 0) || 0;
      const nav = h('div', { class: 'al-tabs seg', role: 'tablist', 'aria-label': '분양 화면' });
      for (const [id, emoji, label] of [['mine', '🏺', '내 분양'], ['map', '🗺️', '지도'], ['inbox', '🔔', '알림'], ['guide', '📋', '안내']]) {
        const b = h('button', { type: 'button', role: 'tab', class: this._tab === id ? 'active' : '', 'aria-selected': this._tab === id ? 'true' : 'false', 'data-tab': id },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), ` ${label}`, id === 'inbox' && unread ? h('span', { class: 'al-badge', 'aria-label': `안 읽은 알림 ${unread}개` }, String(Math.min(unread, 99))) : null);
        b.addEventListener('click', () => { this._tab = id; this._render(); });
        nav.appendChild(b);
      }
      return nav;
    },
    _kidTiles() {
      const tiles = [
        ['mine', '🏺', '내 항아리', '#e0a35a', '내 항아리. 내 자리를 봐요.'],
        ['map', '🗺️', '지도', '#7fc4ff', '지도. 만장대 단지를 봐요.'],
        ['inbox', '🔔', '알림', '#ffc93c', '알림. 소식을 봐요.'],
        ['apply', '👨‍👩‍👧', '어른과 함께 신청', '#c9d3c6', '어른과 함께 신청해요. 어른만 열 수 있어요.'],
      ];
      const grid = h('div', { class: 'al-kidtiles', role: 'group', 'aria-label': '분양 그림 메뉴' });
      for (const [id, emoji, label, color, line] of tiles) {
        const b = h('button', { type: 'button', class: `al-kidtile${this._tab === id ? ' active' : ''}`, 'data-say': line, 'aria-pressed': this._tab === id ? 'true' : 'false', style: { '--tile': color } },
          h('span', { class: 'al-kt-emoji emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'al-kt-label' }, label), id === 'apply' ? h('span', { class: 'al-kt-lock', 'aria-hidden': 'true' }, '🔒') : null);
        b.addEventListener('click', () => {
          G.sfx?.('click');
          if (id === 'apply') { this.startApply(this._sel ? D().codeOf(this._sel.zone, this._sel.seq) : null); return; }
          this._tab = id; this._render(); say(line);
        });
        grid.appendChild(b);
      }
      return grid;
    },
    _errCard(e, retry) {
      const off = offline(e), lost = lostLogin(e);
      const box = h('div', { class: 'al-err', role: 'alert' },
        h('span', { class: 'al-err-emoji emoji', 'aria-hidden': 'true' }, off ? '📡' : lost ? '🔑' : '🛠️'),
        h('div', null, h('b', null, off ? '연결이 잠깐 끊겼어요' : lost ? '로그인이 끝났어요' : '불러오지 못했어요'), h('p', null, errText(e))));
      if (retry && !lost) { const b = h('button', { type: 'button', class: 'btn btn-primary al-big' }, '🔄 다시 해 보기'); b.addEventListener('click', retry); box.appendChild(b); }
      return box;
    },

    // ---------------------------------------------------------------- 내 분양
    _renderMine(p) {
      const easy = easyOn();
      if (isServer() && !serverAccount()) {
        p.appendChild(h('div', { class: 'al-empty' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔑'), h('b', null, '계정으로 로그인하면 내 분양이 보여요'),
          h('p', null, '게스트는 지도와 안내를 볼 수 있어요.')));
        return;
      }
      if (this._mineErr && !this._mine) { const e = this._mineErr; p.appendChild(this._errCard(e, () => { this._mineErr = null; this._render(); this.refreshMine().then(() => this._render()).catch((x) => { this._mineErr = x; this._render(); }); })); return; }
      const d = this._mine;
      if (!d) { p.appendChild(h('p', { class: 'al-loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' 내 분양을 불러오는 중…')); return; }
      const live = d.contracts.filter((c) => ['pending', 'active', 'overdue'].indexOf(c.status) >= 0);
      const head = h('div', { class: 'al-minehead' },
        h('span', { class: 'chip chip-green' }, `${easy ? '내 자리' : '분양 중·신청 중'} ${live.length}곳`),
        !easy && d.limit ? h('span', { class: 'chip' }, `신청 가능 ${Math.max(0, (Number(d.limit.max) || 0) - (Number(d.limit.used) || 0))}곳 남음`) : null,
        h('span', { class: 'grow' }));
      const newBtn = h('button', { type: 'button', class: `btn ${easy ? 'btn-gold al-big' : 'btn-primary'}`, 'data-say': '새 자리 찾기. 지도에서 빈 자리를 찾아요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔎'), ' 빈 자리 찾기');
      newBtn.addEventListener('click', () => { this._tab = 'map'; this._render(); setTimeout(() => this._findFree(), 60); });
      head.appendChild(newBtn);
      p.appendChild(head);
      if (!d.contracts.length && !d.waitlist.length) {
        p.appendChild(h('div', { class: 'al-empty' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏺'), h('b', null, easy ? '아직 내 항아리가 없어요' : '아직 분양받은 자리가 없어요'),
          h('p', null, easy ? '어른과 함께 지도에서 빈 자리를 골라 신청할 수 있어요.' : '지도에서 빈 자리를 고르거나 "빈 자리 찾기"를 눌러 신청해요.')));
      }
      const list = h('div', { class: 'al-cards', role: 'list' });
      const shown = d.contracts.slice(0, this._minePage * PAGE);
      for (const c of shown) list.appendChild(this._card(c));
      p.appendChild(list);
      if (d.contracts.length > shown.length) {
        const more = h('button', { type: 'button', class: 'btn btn-soft al-more' }, `더 보기 (${d.contracts.length - shown.length}개 더)`);
        more.addEventListener('click', () => { this._minePage++; this._render(); });
        p.appendChild(more);
      }
      if (d.waitlist.length) {
        p.appendChild(h('h3', { class: 'al-h3' }, '⏳ 대기 명단'));
        const wl = h('div', { class: 'al-wait', role: 'list' });
        for (const w of d.waitlist) wl.appendChild(this._waitRow(w));
        p.appendChild(wl);
      }
    },
    _card(c) {
      const easy = easyOn();
      const kd = kindOf(c.unit.kind);
      const cs = D().contract?.[c.status] || { label: c.status, kid: c.status, emoji: '•', tone: 'off' };
      const unitName = `${c.unit.zoneName || c.unit.zone} ${Number(c.unit.seq) || ''}번`;
      const card = h('article', { class: `al-card tone-${cs.tone}`, role: 'listitem', 'data-code': c.unit.code },
        h('header', { class: 'al-card-head' },
          h('span', { class: 'al-card-emoji emoji', 'aria-hidden': 'true' }, kd.emoji),
          h('div', { class: 'al-card-id' }, h('b', null, unitName), h('span', { class: 'al-code' }, c.unit.code)),
          h('span', { class: `al-status st-${cs.tone}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, cs.emoji), ` ${easy ? cs.kid : cs.label}`)));
      G.easy?.speakable?.(card.firstChild, `${unitName}. ${easy ? cs.kid : cs.label}`);
      // period + D-day
      const per = h('div', { class: 'al-period' });
      if (c.startsAt || c.endsAt) per.append(h('span', null, '📅 ', `${dateText(c.startsAt)} ~ ${dateText(c.endsAt)}`));
      if (c.endsAt && ['active', 'overdue'].indexOf(c.status) >= 0) per.append(h('span', { class: 'chip chip-blue al-dday' }, dday(c.endsAt)));
      if (c.status === 'pending' && c.holdUntil) per.append(h('span', { class: 'chip chip-gold' }, `⏳ ${dateText(c.holdUntil, false)}까지 자리 잡아 둠`));
      if (!easy && c.paidUntil && c.period !== 'once') per.append(h('span', { class: 'chip' }, `💳 ${dateText(c.paidUntil)}까지 납부`));
      if (c.cancelRequested) per.append(h('span', { class: 'chip chip-red' }, '✉️ 취소 요청함'));
      card.appendChild(per);
      // the craft timeline of the kind (담그기 → 가르기 → 익히기 → 받는 날) placed on the contract's period
      card.appendChild(this._craftLine(c, kd));
      // the contract timeline from the server (신청 → 확정 → 납부 → 끝나는 날)
      if (!easy && Array.isArray(c.timeline) && c.timeline.length) {
        const tl = h('ol', { class: 'al-tl', 'aria-label': '계약 진행' });
        for (const t of c.timeline.slice(0, 8)) {
          const w = D().timeline?.[t.k] || ['•', String(t.k || '')];
          tl.appendChild(h('li', { class: t.done ? 'done' : '' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, w[0]), h('span', null, w[1]), t.at ? h('small', null, dateText(t.at, false)) : null));
        }
        card.appendChild(tl);
      }
      // nameplate
      const np = c.nameplate || {};
      const npRow = h('div', { class: 'al-np' }, h('span', { class: 'al-np-tag' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏷️'), ' ', np.text ? String(np.text) : (easy ? '이름표 없음' : '이름표가 없어요')),
        !easy && np.text ? h('span', { class: `chip ${np.show ? 'chip-green' : ''}` }, np.show ? '모두에게 보여요' : '나만 봐요') : null);
      const live = ['pending', 'active', 'overdue'].indexOf(c.status) >= 0;
      if (live) {
        const eb = h('button', { type: 'button', class: 'btn btn-soft btn-sm al-np-edit', 'data-say': '이름표 바꾸기' }, easy ? '🏷️ 이름표 고르기' : '✏️ 이름표');
        eb.addEventListener('click', () => this._editNameplate(c));
        npRow.appendChild(eb);
      }
      card.appendChild(npRow);
      // actions
      const acts = h('div', { class: 'al-acts' });
      const mapB = h('button', { type: 'button', class: `btn btn-soft${easy ? ' al-big' : ''}`, 'data-say': '지도에서 보기' }, '🗺️ 지도에서 보기');
      mapB.addEventListener('click', () => this.focus(c.unit.code));
      const goB = h('button', { type: 'button', class: `btn btn-primary${easy ? ' al-big' : ''}`, 'data-say': '찾아가기. 내 자리로 가요.' }, '🚶 찾아가기');
      goB.addEventListener('click', () => this.visit(c.unit.code));
      acts.append(mapB, goB);
      if (!easy && live && isServer()) {
        if (c.payDue || c.status === 'overdue') {
          // 토스 when the operator turned it on, otherwise the operator's payment guide (계좌 · 현장 납부 …)
          const toss = !!this._plans?.toss;
          const pay = h('button', { type: 'button', class: 'btn btn-gold' }, toss ? '💳 토스로 납부하기' : '💳 납부 안내');
          pay.addEventListener('click', () => (toss ? this._pay(c) : this._payGuide()));
          acts.appendChild(pay);
        }
        if (!c.cancelRequested) {
          const cx = h('button', { type: 'button', class: 'btn btn-ghost' }, c.status === 'pending' ? '↩️ 신청 취소' : '✉️ 취소 요청');
          cx.addEventListener('click', () => this._cancel(c));
          acts.appendChild(cx);
        }
      }
      card.appendChild(acts);
      // care log feed (lazy)
      card.appendChild(this._careFeed(c.unit.code));
      return card;
    },
    _craftLine(c, kd) {
      const steps = kd.steps || [];
      const box = h('div', { class: 'al-craft', role: 'group', 'aria-label': `${kd.name} 한 해 흐름` });
      const t = nowMs(), s = Number(c.startsAt) || 0, e = Number(c.endsAt) || 0;
      const days = s ? Math.floor((t - s) / 86400000) : -1;
      let cur = -1;
      steps.forEach((st, i) => { if (days >= 0 && (st.at >= 0 ? days >= st.at : e && t >= e)) cur = i; });
      if (c.status === 'pending') cur = -1;
      steps.forEach((st, i) => {
        const li = h('div', { class: `al-step${i <= cur ? ' done' : ''}${i === cur ? ' now' : ''}`, 'data-say': `${st.label}. ${st.kid}` },
          h('span', { class: 'al-step-dot emoji', 'aria-hidden': 'true' }, st.emoji), h('span', { class: 'al-step-label' }, st.label),
          st.k === 'get' && e ? h('small', null, dateText(e, false)) : null);
        box.appendChild(li);
        if (i < steps.length - 1) box.appendChild(h('span', { class: `al-step-bar${i < cur ? ' done' : ''}`, 'aria-hidden': 'true' }));
      });
      return box;
    },
    _careFeed(code) {
      const box = h('details', { class: 'al-care' });
      const sum = h('summary', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧑‍🌾'), ' 돌봄 일지');
      const list = h('ul', { class: 'al-care-list' });
      box.append(sum, list);
      const fill = (logs, more) => {
        for (const l of logs) {
          list.appendChild(h('li', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, D().care?.[l.kind] || '📝'),
            h('span', { class: 'al-care-text' }, String(l.text || '')), h('small', null, dateText(l.at, false), l.scope === 'zone' ? ' · 구역 전체' : l.scope === 'all' ? ' · 단지 전체' : '')));
        }
        if (!logs.length && !list.children.length) list.appendChild(h('li', { class: 'al-care-empty' }, '아직 일지가 없어요. 운영자가 돌보면 여기에 적혀요.'));
        if (more) {
          const b = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, '더 보기');
          b.addEventListener('click', () => { b.remove(); load(logs.length ? logs[logs.length - 1].id : 0); });
          list.appendChild(h('li', { class: 'al-care-more' }, b));
        }
      };
      const load = async (before) => {
        if (!isServer()) { fill(demoLogs(code), false); return; }
        try {
          const d = await req(`allot/logs.php?code=${encodeURIComponent(code)}${before ? `&before=${encodeURIComponent(before)}` : ''}`, { quiet: true, timeout: 15000 });
          fill((Array.isArray(d?.logs) ? d.logs : []).filter((l) => l && typeof l === 'object'), !!d?.more);
        } catch (e) { list.appendChild(h('li', { class: 'al-care-empty' }, errText(e))); }
      };
      box.addEventListener('toggle', () => { if (box.open && !box._loaded) { box._loaded = true; load(0); } });
      return box;
    },
    _waitRow(w) {
      const kd = kindOf(w.kind);
      const row = h('div', { class: 'al-waitrow', role: 'listitem' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, kd.emoji),
        h('div', { class: 'grow' }, h('b', null, `${kd.name}${w.zone ? ` · ${w.zone}` : ''}`),
          h('div', { class: 'al-dim' }, w.status === 'offered' ? `🎉 자리가 났어요: ${w.unit || ''} (${dateText(w.offerUntil, false)}까지)` : `${Number(w.position) || '?'}번째로 기다려요`)));
      if (!easyOn() && isServer()) {
        if (w.status === 'offered') {
          const ok = h('button', { type: 'button', class: 'btn btn-primary' }, '✅ 이 자리 받기');
          ok.addEventListener('click', () => this._waitAccept(w));
          row.appendChild(ok);
        }
        const leave = h('button', { type: 'button', class: 'btn btn-ghost' }, '대기 그만두기');
        leave.addEventListener('click', () => this._waitLeave(w));
        row.appendChild(leave);
      }
      return row;
    },

    // ---------------------------------------------------------------- 지도
    _renderMap(p) {
      const easy = easyOn();
      const tools = h('div', { class: 'al-maptools' });
      this._toolsEl = tools;
      const box = h('div', { class: 'al-mapbox' });
      const zoom = h('div', { class: 'al-zoom', role: 'group', 'aria-label': '지도 크기' });
      for (const [lbl, k, line] of [['➕', 1.6, '크게 보기'], ['➖', 1 / 1.6, '작게 보기'], ['🧭', 0, '전체 보기']]) {
        const b = h('button', { type: 'button', class: 'al-zbtn', 'aria-label': line, title: line, 'data-say': line }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, lbl));
        b.addEventListener('click', () => { if (!this._map) return; if (k) this._map.zoomBy(k); else this._map.fitAll(true); });
        zoom.appendChild(b);
      }
      const zn = h('div', { class: 'al-zonenav', role: 'group', 'aria-label': '구역 넘기기' });
      const prev = h('button', { type: 'button', class: 'al-zarrow', 'aria-label': '앞 구역', 'data-say': '앞 구역' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '◀️'));
      const next = h('button', { type: 'button', class: 'al-zarrow', 'aria-label': '다음 구역', 'data-say': '다음 구역' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶️'));
      const zname = h('span', { class: 'al-zname', 'aria-live': 'polite' }, '전체');
      this._znameEl = zname;
      prev.addEventListener('click', () => this._stepZone(-1));
      next.addEventListener('click', () => this._stepZone(1));
      zn.append(prev, zname, next);
      const legend = this._legend();
      const card = h('div', { class: 'al-unitcard', 'aria-live': 'polite' });
      this._cardEl = card;
      legend.classList.add('al-legend-map');
      box.append(zoom, zn, legend);
      p.append(tools, box, card);
      if (this._mapErr && !Live.L) { box.appendChild(this._errCard(this._mapErr, () => { this._mapErr = null; this.refreshMap({ force: true }).then(() => this._render()).catch((e) => { this._mapErr = e; this._render(); }); })); }
      const start = () => {
        if (!this.isOpen() || !box.isConnected) return;
        if (!Live.L) { if (!box.querySelector('.al-err')) box.appendChild(h('p', { class: 'al-loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' 지도를 그리는 중…')); return; }
        box.querySelector('.al-loading')?.remove();
        this._map = makeMap(box, { onSelect: (r) => this._select(r, true) });
        box.insertBefore(this._map.el, box.firstChild);
        this._applyFilter();
        if (this._pendingFocus) { const c = this._pendingFocus; this._pendingFocus = null; this.focus(c, { open: false }); }
        else if (this._sel) this._map.select(this._sel);
        this._updateUnitCard();
      };
      this._renderMapTools();
      if (Live.L) requestAnimationFrame(start);
      else this.refreshMap().then(() => { if (this.isOpen() && this._tab === 'map') { this._render(); } }).catch((e) => { this._mapErr = e; if (this.isOpen()) this._render(); });
      void easy;
    },
    _renderMapTools() {
      const tools = this._toolsEl;
      if (!tools) return;
      tools.textContent = '';
      const easy = easyOn();
      const kinds = h('div', { class: 'al-kinds seg', role: 'group', 'aria-label': '종류 고르기' });
      for (const [k, emoji, label] of [['', '🗺️', '전체'], ['jar', '🏺', '항아리'], ['plot', '🌱', '밭'], ['store', '📦', '창고']]) {
        const b = h('button', { type: 'button', class: this._filter.kind === k ? 'active' : '', 'aria-pressed': this._filter.kind === k ? 'true' : 'false', 'data-say': `${label}만 보기` },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), ` ${label}`);
        b.addEventListener('click', () => { this._filter.kind = k; this._applyFilter(); this._renderMapTools(); if (k) this._zoomKind(k); });
        kinds.appendChild(b);
      }
      const free = h('button', { type: 'button', class: `btn btn-soft al-freeonly${this._filter.freeOnly ? ' on' : ''}`, 'aria-pressed': this._filter.freeOnly ? 'true' : 'false', 'data-say': '빈 자리만 보기' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, this._filter.freeOnly ? '☑️' : '⬜'), ' 빈 자리만');
      free.addEventListener('click', () => { this._filter.freeOnly = !this._filter.freeOnly; this._applyFilter(); this._renderMapTools(); });
      const find = h('button', { type: 'button', class: `btn btn-gold${easy ? ' al-big' : ''}`, 'data-say': '빈 자리 찾기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔎'), ' 빈 자리 찾기');
      find.addEventListener('click', () => this._findFree());
      tools.append(kinds, free, find);
      if (!easy && Live.zones.length) {
        const zsel = h('div', { class: 'al-zones', role: 'group', 'aria-label': '구역으로 가기' });
        for (const z of Live.zones) {
          if (this._filter.kind && z.kind !== this._filter.kind) continue;
          const st = zoneStats(z);
          const b = h('button', { type: 'button', class: 'al-zchip', title: `${z.name} · 빈 자리 ${st.open}` }, `${kindOf(z.kind).emoji} ${z.name}`, h('small', null, ` ${st.open}`));
          b.addEventListener('click', () => { this._zoneIdx = Live.zones.indexOf(z); this._goZone(); });
          zsel.appendChild(b);
        }
        tools.appendChild(zsel);
      }
    },
    _legend() {
      const st = D().status || {};
      const svg = (k) => {
        const c = (st[k] || {}).color || '#888';
        if (k === 'o') return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="${c}"/></svg>`;
        if (k === 'h') return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="rgba(230,159,0,.28)" stroke="${c}" stroke-width="2.6"/></svg>`;
        if (k === 'l') return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5" fill="${c}"/></svg>`;
        if (k === 'c') return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4L16 16M16 4L4 16" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
        return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L1.4 7.8l6-.7z" fill="${c}" stroke="#fff" stroke-width="1.2"/></svg>`;
      };
      const ul = h('ul', { class: 'al-legend', 'aria-label': '지도 표시' });
      for (const k of ['o', 'h', 'l', 'c', 'm']) {
        const s = st[k] || {};
        // the svg strings above are fixed markup written here (no server data)
        ul.appendChild(h('li', { 'data-say': `${s.label}. ${s.kid || ''}` }, h('span', { class: 'al-lg-ico', html: svg(k) }), h('span', null, easyOn() ? s.kid || s.label : s.label)));
      }
      return ul;
    },
    _applyFilter() {
      if (!this._map) return;
      const L = Live.L, f = this._filter;
      if (!L || (!f.kind && !f.freeOnly)) { this._map.setFilter(null, ''); return; }
      const kind = KINDS.indexOf(f.kind), A = L.arrays;
      this._map.setFilter((i) => (kind < 0 || A.kind[i] === kind) && (!f.freeOnly || Live.st[i] === 0 || Live.st[i] === 4), `${f.kind}|${f.freeOnly ? 1 : 0}`);
    },
    _zoomKind(kind) {
      const L = Live.L;
      if (!L || !this._map) return;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const z of L.zones) if (z.kind === kind && z.frame) { x0 = Math.min(x0, z.frame.x0, z.frame.x1); x1 = Math.max(x1, z.frame.x0, z.frame.x1); z0 = Math.min(z0, z.frame.z0, z.frame.z1); z1 = Math.max(z1, z.frame.z0, z.frame.z1); }
      if (x0 < x1) this._map.zoomArea({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, true, 14);
    },
    _stepZone(d) {
      const zs = Live.zones.filter((z) => !this._filter.kind || z.kind === this._filter.kind);
      if (!zs.length) return;
      const cur = zs.indexOf(Live.zones[this._zoneIdx]);
      const ni = cur < 0 ? (d > 0 ? 0 : zs.length - 1) : (cur + d + zs.length) % zs.length;
      this._zoneIdx = Live.zones.indexOf(zs[ni]);
      this._goZone();
    },
    _goZone() {
      const z = Live.zones[this._zoneIdx];
      if (!z || !this._map) return;
      this._map.zoomZone(z.code, true);
      const st = zoneStats(z);
      if (this._znameEl) this._znameEl.textContent = `${kindOf(z.kind).emoji} ${z.name}`;
      say(`${z.name}. 빈 자리 ${st.open}개.`);
    },
    _findFree() {
      const near = this._sel ? D().codeOf(this._sel.zone, this._sel.seq) : (this._map ? { x: this._map.view.x, z: this._map.view.z } : null);
      const code = this.findFree({ kind: this._filter.kind || '', near });
      if (!code) {
        toast(easyOn() ? '빈 자리가 없어요.' : '조건에 맞는 빈 자리가 없어요. 대기 명단에 이름을 올릴 수 있어요.', { type: 'info', emoji: '🔎' });
        if (!easyOn() && this._filter.kind) this._offerWait(this._filter.kind);
        return null;
      }
      this.focus(code, { open: false });
      say('빈 자리를 찾았어요!');
      return code;
    },
    _select(r, fromTap) {
      this._sel = r ? { zone: r.zone, seq: r.seq } : null;
      if (this._map) this._map.select(this._sel);
      this._updateUnitCard();
      if (fromTap && r) { const st = this.statusOf(D().codeOf(r.zone, r.seq)); const s = D().status?.[ST_SHORT[ST_KEYS.indexOf(st)]]; say(`${r.zone} ${r.seq}번. ${s ? (easyOn() ? s.kid : s.label) : ''}`); }
    },
    async _updateUnitCard() {
      const el = this._cardEl;
      if (!el) return;
      const easy = easyOn();
      const r = this._sel;
      el.textContent = '';
      if (!r) { el.appendChild(h('p', { class: 'al-dim' }, easy ? '지도에서 자리를 눌러 봐요.' : '지도에서 자리를 누르면 상태와 이름표, 돌봄 일지가 여기에 나와요.')); return; }
      const code = D().codeOf(r.zone, r.seq);
      const z = Live.byZone[r.zone];
      const kd = kindOf(z?.kind);
      const st = this.statusOf(code) || 'closed';
      const s = D().status?.[ST_SHORT[ST_KEYS.indexOf(st)]] || {};
      const head = h('div', { class: 'al-uc-head' }, h('span', { class: 'al-uc-emoji emoji', 'aria-hidden': 'true' }, kd.emoji),
        h('div', { class: 'grow' }, h('b', null, `${z ? z.name : r.zone} ${r.seq}번`), h('div', { class: 'al-code' }, code)),
        h('span', { class: `al-status st-${st}` }, `${s.emoji || ''} ${easy ? s.kid || s.label : s.label}`));
      el.appendChild(head);
      const info = h('div', { class: 'al-uc-info' });
      el.appendChild(info);
      const acts = h('div', { class: 'al-acts' });
      el.appendChild(acts);
      if (st === 'open') {
        const ap = h('button', { type: 'button', class: `btn btn-primary${easy ? ' al-big' : ''}`, 'data-say': '어른과 함께 신청해요' }, easy ? '👨‍👩‍👧 어른과 함께 신청' : '📝 이 자리 신청하기');
        ap.addEventListener('click', () => this.startApply(code));
        acts.appendChild(ap);
      } else if (st === 'mine') {
        const go = h('button', { type: 'button', class: `btn btn-primary${easy ? ' al-big' : ''}`, 'data-say': '찾아가기' }, '🚶 찾아가기');
        go.addEventListener('click', () => this.visit(code));
        acts.appendChild(go);
      } else if (!easy) {
        const nb = h('button', { type: 'button', class: 'btn btn-soft' }, '🔎 옆 빈 자리');
        nb.addEventListener('click', () => { const c = this.findFree({ kind: z?.kind, near: code }); if (c) this.focus(c, { open: false }); else this._offerWait(z?.kind); });
        acts.appendChild(nb);
      }
      // details from the server (nameplate shown by its holder, the newest care logs) — always as text
      const want = `${code}|${Live.ver}`;
      this._cardWant = want;
      let d = null;
      if (!isServer()) d = { nameplate: code === D().demoUnit ? '우리 가족 장' : null, logs: demoLogs(code).slice(0, 2) };
      else {
        try { d = await req(`allot/unit.php?code=${encodeURIComponent(code)}`, { quiet: true, timeout: 12000 }); } catch (e) { if (this._cardWant === want) info.appendChild(h('p', { class: 'al-dim' }, errText(e))); return; }
      }
      if (this._cardWant !== want || !el.isConnected) return;
      if (d && d.nameplate) info.appendChild(h('p', { class: 'al-uc-np' }, '🏷️ ', String(d.nameplate)));
      const logs = Array.isArray(d?.logs) ? d.logs.slice(0, 2) : [];
      for (const l of logs) info.appendChild(h('p', { class: 'al-uc-log' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, D().care?.[l.kind] || '📝'), ' ', String(l.text || ''), h('small', null, ` ${dateText(l.at, false)}`)));
      if (!logs.length && !d?.nameplate) info.appendChild(h('p', { class: 'al-dim' }, st === 'open' ? (easy ? '비어 있어요. 어른과 함께 신청할 수 있어요.' : '비어 있는 자리예요. 신청하면 운영자가 확인해요.') : '아직 보여 줄 소식이 없어요.'));
    },

    /** the map tab zoomed to a unit and selected */
    focus(code, opts = {}) {
      const p = D().parseCode?.(code);
      if (!p) return false;
      if (opts.open !== false && (!this.isOpen() || this._tab !== 'map')) { this.open('map', { unit: code }); return true; }
      if (!this._map) { this._pendingFocus = code; return true; }
      this._sel = { zone: p.zone, seq: p.seq };
      const ok = this._map.focusUnit(p.zone, p.seq, true);
      this._updateUnitCard();
      return ok;
    },
    /** 찾아가기: the 3D complex when it exists, a kind word otherwise */
    async visit(code) {
      const P = G.sys.places;
      const known = !!(P && typeof P.enter === 'function' && typeof P.def === 'function' && P.def('PL_ALLOT'));
      if (known) {
        this.close();
        try { const ok = await P.enter('PL_ALLOT', { focusUnit: code }); if (ok !== false) return true; } catch (e) { G.log.warn(CAT, 'visit', e?.message || e); }
      }
      toast(easyOn() ? '만장대 단지는 곧 열려요! 지도로 먼저 봐요.' : '만장대 단지(3D)는 준비 중이에요. 지도에서 자리를 먼저 볼 수 있어요.', { type: 'info', emoji: '🚧' });
      say('만장대 단지는 곧 열려요!');
      return false;
    },

    // ---------------------------------------------------------------- 알림
    async inbox() {
      if (!isServer()) { this._inbox = demoInbox(); return this._inbox; }
      if (!serverAccount()) return null;
      const d = await req('allot/inbox.php', { quiet: true, timeout: 15000 });
      const notices = (Array.isArray(d?.notices) ? d.notices : []).filter((n) => n && Number.isInteger(n.id));
      this._inbox = { notices, unread: Number(d?.unread) || 0, last: Number(d?.last) || 0 };
      return this._inbox;
    },
    _renderInbox(p) {
      const easy = easyOn();
      if (isServer() && !serverAccount()) { p.appendChild(h('div', { class: 'al-empty' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔑'), h('b', null, '계정으로 로그인하면 분양 알림이 보여요'))); return; }
      const box = h('div', { class: 'al-inbox', role: 'list' });
      p.appendChild(box);
      const draw = (d) => {
        box.textContent = '';
        const list = d?.notices || [];
        if (!list.length) { box.appendChild(h('div', { class: 'al-empty' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📭'), h('b', null, '아직 분양 알림이 없어요'), h('p', null, '확정, 납부, 받는 날 같은 소식이 생기면 여기에 와요.'))); return; }
        for (const n of list) {
          const row = h('div', { class: `al-noti${n.seen ? '' : ' unread'}`, role: 'listitem', 'data-say': `${String(n.title || '')}. ${String(n.body || '')}` },
            h('span', { class: 'al-noti-ico emoji', 'aria-hidden': 'true' }, D().notices?.[n.kind] || '📢'),
            h('div', { class: 'grow' }, h('b', null, String(n.title || '')), n.body ? h('p', null, String(n.body)) : null,
              h('small', null, dateText(n.at), !easy && n.contractNo ? ` · ${String(n.contractNo)}` : '')),
            n.seen ? null : h('i', { class: 'al-dot', title: '읽지 않음' }));
          box.appendChild(row);
        }
        const unseen = list.filter((n) => !n.seen).map((n) => n.id).slice(0, 50);
        if (unseen.length && serverAccount()) {
          req('allot/seen.php', { body: { ids: unseen }, quiet: true, timeout: 12000 }).then((r) => { for (const n of list) n.seen = true; if (this._inbox) this._inbox.unread = Number(r?.unread) || 0; }).catch((e) => G.log.warn(CAT, 'seen', e?.code || e?.message || e));
        } else if (unseen.length && d.demo) { for (const n of list) n.seen = true; d.unread = 0; }
      };
      if (this._inbox) draw(this._inbox);
      else box.appendChild(h('p', { class: 'al-loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' 알림을 불러오는 중…'));
      this.inbox().then((d) => { if (box.isConnected) draw(d); }).catch((e) => { if (box.isConnected) { box.textContent = ''; box.appendChild(this._errCard(e, () => this._render())); } });
    },
    /** new server notices → the 알림함 of 62-engagement (act 'allot'), at most 5 a pull */
    async _pullInbox() {
      if (!serverAccount() || !G.sys.engagement?.notify) return;
      this._inboxAt = Date.now();
      const uid = String(G.auth?.current?.id || '');
      if (!uid) return;
      let last = 0;
      try { last = Number(localStorage.getItem(LS_LAST + uid)) || 0; } catch (e) { last = 0; }
      try {
        const d = await req(`allot/inbox.php${last ? `?after=${encodeURIComponent(last)}` : ''}`, { quiet: true, timeout: 15000 });
        const list = (Array.isArray(d?.notices) ? d.notices : []).filter((n) => n && Number.isInteger(n.id) && n.id > last && !n.seen);
        let top = last;
        for (const n of Array.isArray(d?.notices) ? d.notices : []) if (n && Number.isInteger(n.id)) top = Math.max(top, n.id);
        for (const n of list.slice(0, 5).reverse()) {
          G.sys.engagement.notify({ type: 'system', icon: D().notices?.[n.kind] || '📢', title: String(n.title || '분양 소식').slice(0, 80), text: String(n.body || '').slice(0, 200), act: 'allot', key: `allot-${n.id}` });
        }
        try { localStorage.setItem(LS_LAST + uid, String(top)); } catch (e) { /* storage blocked */ }
      } catch (e) { G.log.warn(CAT, 'inbox pull', e?.code || e?.message || e); }
    },

    // ---------------------------------------------------------------- 안내
    async _renderGuide(p) {
      const easy = easyOn();
      const kd = kindOf('jar');
      const steps = h('ol', { class: 'al-guide-steps' });
      const lines = easy ? [
        ['🗺️', '지도에서 빈 자리를 골라요', '초록색 동그라미가 빈 자리예요.'],
        ['👨‍👩‍👧', '어른과 함께 신청해요', '이름과 연락처는 어른이 적어요.'],
        ['✅', '운영자가 확인해요', '확인이 끝나면 내 자리가 돼요.'],
        [kd.emoji, '마을이 함께 돌봐요', '돌봄 일지로 소식을 받아요.'],
        ['🎁', '받는 날에 찾아가요', '다 익은 장을 받아 가요.'],
      ] : [
        ['🗺️', '자리 고르기', '지도에서 빈 자리를 고르거나 "빈 자리 찾기"로 가까운 빈 자리를 받아요.'],
        ['📋', '조건 확인', '구좌(자리 1곳), 기간, 금액, 받는 날, 환불 기한을 한 화면에서 확인해요.'],
        ['✍️', '신청서와 동의', '이름·전화번호를 적고 개인정보 수집·이용에 동의해요. 만 14세 미만은 보호자가 신청해요.'],
        ['✅', '운영자 확인·납부', '신청한 자리는 잠시 잡아 두고, 운영자가 확인하면 분양이 시작돼요. 납부 방법은 결과 화면과 알림으로 안내해요.'],
        ['🧑‍🌾', '돌봄과 소식', '운영자가 돌보면 돌봄 일지와 알림이 와요. 이름표를 달 수 있어요.'],
      ];
      for (const [e, t, d] of lines) steps.appendChild(h('li', { 'data-say': `${t}. ${d}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e), h('div', null, h('b', null, t), h('p', null, d))));
      p.appendChild(steps);
      p.appendChild(h('p', { class: 'al-note' }, '전통 장은 우리 음식 문화예요. 이 화면은 건강 효과를 약속하지 않아요.'));
      if (easy || !serverAccount()) {
        if (!easy) p.appendChild(h('p', { class: 'al-dim' }, isServer() ? '금액과 기간은 계정으로 로그인하면 볼 수 있어요.' : '금액과 기간은 서버 모드에서 운영자가 정한 대로 보여요.'));
        return;
      }
      const host = h('div', { class: 'al-plans' }, h('p', { class: 'al-loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' 조건을 불러오는 중…'));
      p.appendChild(host);
      try {
        const pl = await this._loadPlans();
        if (!host.isConnected) return;
        host.textContent = '';
        host.appendChild(this._plansTable(pl));
        host.appendChild(this._texts(pl));
      } catch (e) { if (host.isConnected) { host.textContent = ''; host.appendChild(this._errCard(e, () => this._render())); } }
    },
    /** plans.php (the only answer with prices). Easy mode never asks — except the gated grown-up screen (adult = true) */
    async _loadPlans(force, adult) {
      if (easyOn() && !adult) throw Object.assign(new Error('easy'), { code: 'EASY' });
      if (this._plans && !force && Date.now() - (this._plansAt || 0) < 5 * 60000) return this._plans;
      const d = await req('allot/plans.php', { quiet: true, timeout: 15000 });
      if (!d || typeof d !== 'object') throw Object.assign(new Error('bad plans'), { code: 'BAD_ANSWER' });
      d.zones = Array.isArray(d.zones) ? d.zones.filter((z) => z && RX_ZONE.test(String(z.code || ''))) : [];
      d.texts = d.texts && typeof d.texts === 'object' ? d.texts : {};
      this._plans = d; this._plansAt = Date.now();
      return d;
    },
    _planOf(zoneCode, kind) {
      const zs = this._plans?.zones || [];
      return zs.find((z) => z.code === zoneCode) || zs.find((z) => z.kind === kind && z.open) || null;
    },
    /** 구좌 · 기간 · 금액 · 받는 날 · 환불 기한 — one row per zone */
    _plansTable(pl) {
      const t = h('table', { class: 'al-plantable' });
      t.appendChild(h('thead', null, h('tr', null, ...['구역', '구좌', '기간', '금액', '받는 날', '빈 자리'].map((x) => h('th', { scope: 'col' }, x)))));
      const tb = h('tbody');
      for (const z of pl.zones) tb.appendChild(h('tr', null, h('td', null, `${kindOf(z.kind).emoji} ${String(z.name || z.code)}`), h('td', null, '1구좌 = 1자리'),
        h('td', null, this._periodText(z)), h('td', null, `${fmtWon(z.price)} / ${D().periods?.[z.period] || ''}`), h('td', null, this._receiveText(z)), h('td', null, z.open ? `${Number(z.free) || 0}곳` : '신청 닫힘')));
      t.appendChild(tb);
      const wrap = h('div', { class: 'al-tablewrap' }, t);
      if (pl.sample) wrap.appendChild(h('p', { class: 'al-note' }, '“예시”가 붙은 글은 운영자가 아직 바꾸지 않은 기본 문구예요. 실제 조건은 운영자에게 확인해 주세요.'));
      return wrap;
    },
    _periodText(z) { const m = Number(z.termMonths) || 0; return z.period === 'once' ? (m ? `${m}개월 (한 번 납부)` : '한 번') : `${m || (z.period === 'year' ? 12 : 1)}개월 · ${D().periods?.[z.period] || ''} 납부`; },
    _receiveText(z) {
      const m = Number(z.termMonths) || 12;
      if (z.kind === 'jar') return `분양 시작 ${m}개월 뒤 (운영자가 날짜를 알려요)`;
      if (z.kind === 'plot') return '작물이 다 자라는 철 (운영자 안내)';
      return '기간이 끝나는 날까지 찾아가요';
    },
    _texts(pl) {
      const box = h('div', { class: 'al-texts' });
      for (const [k, t] of [['terms', '이용 약관'], ['refund', '환불 안내'], ['privacy', '개인정보 처리 안내'], ['payGuide', '납부 안내']]) {
        const txt = String(pl.texts?.[k] || '');
        if (!txt) continue;
        box.appendChild(h('details', { class: 'al-text' }, h('summary', null, t, pl.sample ? h('span', { class: 'chip chip-gold' }, '예시') : null), h('pre', { class: 'al-pre' }, txt)));
      }
      return box;
    },

    // ---------------------------------------------------------------- the application (gated)
    /** target: 'J01-0012' | { kind, zone?, auto: true } | null (choose) */
    async startApply(target, opts = {}) {
      if (!isServer() || !serverAccount()) {
        const msg = !isServer() ? '서버 모드에서 실제 분양을 볼 수 있어요. 지금 화면은 체험용이에요.' : '계정으로 로그인한 뒤에 신청할 수 있어요.';
        if (easyOn() && G.easy?.alert) G.easy.alert({ emoji: '🧪', heading: '체험용이에요', title: '지금은 연습 화면이에요', text: '진짜 신청은 어른과 함께 서버 모드에서 해요.', ok: '알았어요' });
        else toast(msg, { type: 'info', emoji: '🧪' });
        return null;
      }
      if (this._busyApply) return null;
      const ok = await G.easy.gate({ reason: 'allot-apply', title: '분양 신청은 어른과 함께', text: '분양 신청은 보호자가 해요. 문제를 2개 연달아 맞혀 주세요.' });
      if (!ok) return null;
      return this._applyModal(target, opts);
    },
    _applyModal(target, opts) {
      return new Promise((resolve) => {
        const F = { step: 'choose', target: null, kind: '', zone: '', err: null, result: null, form: { name: '', phone: '', addr: '', nameplate: '', npShow: !!this._plans?.nameplateDefaultShow, consent: false, adult: false, guardian: false } };
        if (typeof target === 'string' && RX_CODE.test(target)) { F.target = target; F.step = 'plan'; }
        else if (target && typeof target === 'object' && KINDS.indexOf(target.kind) >= 0) { F.kind = target.kind; F.zone = RX_ZONE.test(String(target.zone || '')) ? target.zone : ''; F.step = 'plan'; }
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const m = G.ui.modal.open({
          id: 'allot-apply', title: '분양 신청', icon: '📝', size: 'lg', className: 'allot-adult-modal', autofocus: false,
          say: '분양 신청 화면이에요. 어른이 적어 주세요.',
          body: (b) => { F.body = b; },
          onClose: () => finish(F.result),
        });
        const render = () => { if (m.closed) return; F.body.textContent = ''; F.body.appendChild(this._applyStep(F, m, render, finish)); };
        this._loadPlans(true, true).then(() => render()).catch((e) => { F.err = e; F.step = 'error'; render(); });
        F.body.appendChild(h('p', { class: 'al-loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' 조건을 불러오는 중…'));
      });
    },
    _applyStep(F, m, render, finish) {
      const wrap = h('div', { class: 'al-apply' });
      const stepNames = [['choose', '자리'], ['plan', '조건'], ['form', '신청서'], ['result', '결과']];
      const bar = h('ol', { class: 'al-applysteps', 'aria-label': '신청 단계' });
      const at = stepNames.findIndex((s) => s[0] === F.step);
      stepNames.forEach(([k, l], i) => bar.appendChild(h('li', { class: i < at ? 'done' : i === at ? 'now' : '' }, `${i + 1}. ${l}`)));
      wrap.appendChild(bar);
      const pl = this._plans || { zones: [], texts: {} };
      const unitZone = F.target ? D().parseCode(F.target)?.zone : F.zone;
      const z = this._planOf(unitZone, F.kind || Live.byZone[unitZone]?.kind);
      const kind = F.kind || z?.kind || Live.byZone[unitZone]?.kind || 'jar';
      const errBox = () => {
        if (!F.err) return null;
        const e = F.err, code = String(e.code || '');
        const box = h('div', { class: 'al-err', role: 'alert' }, h('span', { class: 'al-err-emoji emoji', 'aria-hidden': 'true' }, offline(e) ? '📡' : code === 'UNIT_TAKEN' ? '🙇' : '⚠️'), h('div', null, h('p', null, errText(e))));
        if (code === 'UNIT_TAKEN' && F.target) {
          const nx = this.findFree({ near: F.target });
          if (nx) {
            const b = h('button', { type: 'button', class: 'btn btn-primary' }, `👉 옆자리 ${nx} 보기`);
            b.addEventListener('click', () => { F.target = nx; F.err = null; F.step = 'plan'; this.focus(nx, { open: false }); render(); });
            box.appendChild(b);
          }
        }
        if (code === 'SOLD_OUT') { const b = h('button', { type: 'button', class: 'btn btn-soft' }, '⏳ 대기 명단에 올리기'); b.addEventListener('click', () => { m.close(); this._offerWait(kind, F.zone); }); box.appendChild(b); }
        if (offline(e)) { const b = h('button', { type: 'button', class: 'btn btn-soft' }, '🔄 다시 해 보기'); b.addEventListener('click', () => { F.err = null; render(); }); box.appendChild(b); }
        return box;
      };
      const foot = h('div', { class: 'al-applyfoot' });
      const btn = (label, cls, fn) => { const b = h('button', { type: 'button', class: `btn ${cls}` }, label); b.addEventListener('click', fn); foot.appendChild(b); return b; };
      if (F.step === 'error') {
        wrap.appendChild(errBox() || h('p', null, '조건을 불러오지 못했어요.'));
        btn('닫기', 'btn-ghost', () => m.close());
        btn('🔄 다시 해 보기', 'btn-primary', () => { F.err = null; F.step = F.target || F.kind ? 'plan' : 'choose'; this._loadPlans(true, true).then(render).catch((e) => { F.err = e; F.step = 'error'; render(); }); });
        wrap.appendChild(foot);
        return wrap;
      }
      if (F.step === 'choose') {
        wrap.appendChild(h('p', { class: 'al-lead' }, '어떤 자리를 신청할까요? 종류를 고르면 빈 자리를 자동으로 골라 드려요. 지도에서 직접 고를 수도 있어요.'));
        const grid = h('div', { class: 'al-choose' });
        for (const k of KINDS) {
          const kd = kindOf(k);
          const free = Live.zones.filter((q) => q.kind === k).reduce((a, q) => a + zoneStats(q).open, 0);
          const b = h('button', { type: 'button', class: `al-choosetile${F.kind === k ? ' active' : ''}`, 'data-say': `${kd.name}. 빈 자리 ${free}곳` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, kd.emoji), h('b', null, kd.name), h('small', null, Live.L ? `빈 자리 ${free.toLocaleString('ko-KR')}곳` : ''));
          b.addEventListener('click', () => { F.kind = k; F.zone = ''; F.target = null; F.step = 'plan'; F.err = null; render(); });
          grid.appendChild(b);
        }
        wrap.appendChild(grid);
        btn('🗺️ 지도에서 직접 고르기', 'btn-soft', () => { m.close(); this.open('map'); });
        wrap.appendChild(foot);
        return wrap;
      }
      if (F.step === 'plan') {
        const kd = kindOf(kind);
        const where = F.target ? `${Live.byZone[unitZone]?.name || unitZone} ${D().parseCode(F.target).seq}번 (${F.target})` : `${kd.name} 빈 자리 중 자동으로 (${F.zone || '아무 구역'})`;
        const plan = h('dl', { class: 'al-plan' },
          h('dt', null, '자리'), h('dd', null, `${kd.emoji} ${where}`),
          h('dt', null, '구좌'), h('dd', null, '1구좌 = 자리 1곳'),
          h('dt', null, '기간'), h('dd', null, z ? this._periodText(z) : '운영자 안내'),
          h('dt', null, '금액'), h('dd', null, z ? `${fmtWon(z.price)} / ${D().periods?.[z.period] || ''}` : '운영자 안내'),
          h('dt', null, '받는 날'), h('dd', null, z ? this._receiveText(z) : '운영자 안내'),
          h('dt', null, '자리 잡아 두기'), h('dd', null, `신청 뒤 ${Number(pl.holdHours) || 48}시간 동안 이 자리를 잡아 둬요. 그 안에 운영자가 확인해요.`),
          h('dt', null, '환불 기한'), h('dd', null, h('pre', { class: 'al-pre al-pre-short' }, String(pl.texts?.refund || '운영자 안내를 확인해 주세요.'))));
        wrap.appendChild(plan);
        if (pl.sample) wrap.appendChild(h('p', { class: 'al-note' }, '“예시” 문구가 있어요: 운영자가 실제 조건으로 바꾸기 전의 기본 글이에요.'));
        wrap.appendChild(this._texts(pl));
        if (z && !z.open) F.err = F.err || { code: 'NOT_OPEN' };
        const eb = errBox(); if (eb) wrap.appendChild(eb);
        btn('◀ 다른 자리', 'btn-ghost', () => { F.step = 'choose'; F.target = null; F.err = null; render(); });
        btn('다음: 신청서 ▶', 'btn-primary', () => { F.err = null; F.step = 'form'; render(); }).disabled = !!(z && !z.open);
        wrap.appendChild(foot);
        return wrap;
      }
      if (F.step === 'form') {
        const f = F.form;
        const field = (id, label, input, hint) => h('label', { class: 'al-field', for: id }, h('span', { class: 'al-flabel' }, label), input, hint ? h('small', null, hint) : null);
        const name = h('input', { id: 'al-f-name', type: 'text', maxlength: '40', autocomplete: 'name', value: f.name, required: true });
        const phone = h('input', { id: 'al-f-phone', type: 'tel', maxlength: '20', autocomplete: 'tel', inputmode: 'tel', placeholder: '010-1234-5678', value: f.phone, required: true });
        const addr = pl.collectAddress ? h('input', { id: 'al-f-addr', type: 'text', maxlength: '200', autocomplete: 'street-address', value: f.addr }) : null;
        const np = h('input', { id: 'al-f-np', type: 'text', maxlength: '12', value: f.nameplate, placeholder: '예: 우리 가족 장' });
        const sync = () => { f.name = name.value; f.phone = phone.value; if (addr) f.addr = addr.value; f.nameplate = np.value; };
        for (const el of [name, phone, addr, np]) if (el) el.addEventListener('input', sync);
        const ck = (id, label, key, req2, detail) => {
          const c = h('input', { id, type: 'checkbox', checked: f[key] || null });
          c.addEventListener('change', () => { f[key] = c.checked; });
          return h('div', { class: `al-consent${req2 ? ' req' : ''}` }, h('label', { for: id }, c, h('span', null, h('b', null, req2 ? '[필수] ' : '[선택] '), label)), detail || null);
        };
        const privacyDetail = h('details', { class: 'al-text' }, h('summary', null, '자세히 보기 (목적·항목·보관 기간·거부할 권리)'),
          h('ul', { class: 'al-privacy' },
            h('li', null, '목적: 분양 신청 확인, 계약 관리, 납부와 받는 날 안내 연락'),
            h('li', null, `항목: 이름, 전화번호${pl.collectAddress ? ', 주소' : ''}`),
            h('li', null, '보관 기간: 계약이 끝난 뒤 운영자가 정한 기간 동안 보관하고 지워요 (법이 정한 기간이 있으면 그 기간)'),
            h('li', null, '거부할 권리: 동의하지 않을 수 있어요. 다만 동의하지 않으면 분양을 신청할 수 없어요.')),
          pl.texts?.privacy ? h('pre', { class: 'al-pre' }, String(pl.texts.privacy)) : null);
        wrap.append(
          h('p', { class: 'al-lead' }, '신청하는 어른의 정보를 적어 주세요. 정보는 잠금 처리해 보관하고, 목록에는 가려서 보여요.'),
          field('al-f-name', '이름', name), field('al-f-phone', '전화번호', phone, '운영자가 확인 연락을 할 때만 써요.'),
          addr ? field('al-f-addr', '주소 (받는 물건을 보낼 때)', addr) : null,
          field('al-f-np', '이름표 (선택, 12자까지)', np, '자리 앞 이름표에 쓰여요. 나쁜 말과 연락처는 가려져요.'),
          ck('al-c-privacy', '개인정보 수집·이용에 동의해요', 'consent', true, privacyDetail),
          ck('al-c-adult', '만 14세 이상 본인이거나 보호자예요', 'adult', true),
          ck('al-c-np', '이름표를 다른 사람에게도 보여 줘요', 'npShow', false));
        const eb = errBox(); if (eb) wrap.appendChild(eb);
        btn('◀ 조건 다시 보기', 'btn-ghost', () => { sync(); F.err = null; F.step = 'plan'; render(); });
        const go = btn('📝 신청하기', 'btn-primary', async () => {
          sync();
          const bad = !f.name.trim() || !/\p{L}/u.test(f.name) ? 'name' : !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(f.phone.replace(/\s/g, '')) ? 'phone' : !f.consent ? 'consent' : !f.adult ? 'adult' : '';
          if (bad) { F.err = { code: 'INVALID_INPUT', data: { field: bad } }; render(); return; }
          go.disabled = true; this._busyApply = true;
          try {
            const body = { consent: true, consentVersion: String(pl.consentVersion || ''), adult: true, name: f.name.trim().slice(0, 40), phone: f.phone.replace(/\s/g, '').slice(0, 20) };
            if (F.target) body.unit = F.target; else { body.kind = kind; if (F.zone) body.zone = F.zone; body.auto = true; }
            if (addr && f.addr.trim()) body.addr = f.addr.trim().slice(0, 200);
            if (f.nameplate.trim()) { body.nameplate = f.nameplate.trim().slice(0, 40); body.nameplateShow = !!f.npShow; }
            const r = await req('allot/apply.php', { body, timeout: 20000 });
            F.result = r; F.step = 'result'; F.err = null;
            G.bus.emit('allot:applied', { contractNo: r?.contractNo, status: r?.status, unit: r?.unit });
            this.refreshMine().then(() => this.refreshMap({ force: true })).then(() => { if (this.isOpen()) this._render(); }).catch(() => {});
          } catch (e) {
            F.err = e;
            if (String(e?.code) === 'CONSENT_REQUIRED' && e?.data?.field === 'consentVersion') { try { await this._loadPlans(true, true); } catch (x) { /* shown below */ } F.step = 'plan'; f.consent = false; }
            if (String(e?.code) === 'UNIT_TAKEN') { if (F.target) markUnit(F.target, 'h'); this.refreshMap({ force: true }).catch(() => {}); }
            G.log.warn(CAT, 'apply', e?.code || e?.message || e);
          } finally { this._busyApply = false; render(); }
        });
        wrap.appendChild(foot);
        return wrap;
      }
      // result
      const r = F.result || {};
      const okActive = r.status === 'active';
      wrap.append(
        h('div', { class: 'al-result' }, h('span', { class: 'al-result-emoji emoji', 'aria-hidden': 'true' }, okActive ? '🎉' : '📮'),
          h('b', null, okActive ? '분양이 확정됐어요!' : '신청을 받았어요!'),
          h('p', null, okActive ? '이제 내 자리예요.' : `운영자가 확인하면 분양이 시작돼요.${r.holdUntil ? ` ${dateText(r.holdUntil)}까지 자리를 잡아 둘게요.` : ''}`)),
        h('dl', { class: 'al-plan' }, h('dt', null, '계약 번호'), h('dd', null, h('code', null, String(r.contractNo || ''))), h('dt', null, '자리'), h('dd', null, String(r.unit?.code || r.unit || F.target || ''))),
        r.pay?.guide ? h('details', { class: 'al-text', open: true }, h('summary', null, '납부 안내'), h('pre', { class: 'al-pre' }, String(r.pay.guide))) : null);
      if (r.pay?.toss) { const pb = btn('💳 토스로 납부하기', 'btn-gold', () => this._pay({ contractNo: r.contractNo })); void pb; }
      btn('🏺 내 분양 보기', 'btn-primary', () => { m.close(); this.open('mine'); });
      wrap.appendChild(foot);
      return wrap;
    },

    // ---------------------------------------------------------------- waiting list, cancel, nameplate, pay
    async _offerWait(kind, zone) {
      if (!kind || easyOn()) return;
      if (!serverAccount()) { toast('계정으로 로그인하면 대기 명단에 올릴 수 있어요.', { type: 'info' }); return; }
      const ok = await G.ui.confirm(`${kindOf(kind).name} 빈 자리가 나면 차례대로 알려 드려요. 대기 명단에 올릴까요?`, { title: '대기 명단', okText: '올리기', cancelText: '그만두기' });
      if (!ok) return;
      if (!(await G.easy.gate({ reason: 'allot-apply', title: '대기 신청은 어른과 함께' }))) return;
      let pl;
      try { pl = await this._loadPlans(true, true); } catch (e) { toast(errText(e), { type: 'error' }); return; }
      const m = G.ui.modal.open({ id: 'allot-wait', title: '대기 명단에 올리기', icon: '⏳', size: 'md', className: 'allot-adult-modal', autofocus: false,
        body: (b) => {
          const name = h('input', { id: 'al-w-name', type: 'text', maxlength: '40', autocomplete: 'name' });
          const phone = h('input', { id: 'al-w-phone', type: 'tel', maxlength: '20', inputmode: 'tel', autocomplete: 'tel', placeholder: '010-1234-5678' });
          const c1 = h('input', { id: 'al-w-c1', type: 'checkbox' }), c2 = h('input', { id: 'al-w-c2', type: 'checkbox' });
          const msg = h('div', { class: 'al-wmsg', 'aria-live': 'polite' });
          const go = h('button', { type: 'button', class: 'btn btn-primary' }, '⏳ 대기 신청');
          go.addEventListener('click', async () => {
            if (!name.value.trim() || !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(phone.value.replace(/\s/g, '')) || !c1.checked || !c2.checked) { msg.textContent = '이름, 전화번호와 두 가지 동의를 확인해 주세요.'; return; }
            go.disabled = true;
            try {
              const body = { action: 'join', kind, name: name.value.trim().slice(0, 40), phone: phone.value.replace(/\s/g, ''), consent: true, consentVersion: String(pl.consentVersion || ''), adult: true };
              if (zone) body.zone = zone;
              const r = await req('allot/waitlist.php', { body, timeout: 15000 });
              m.close();
              toast(`대기 명단 ${Number(r?.position) || ''}번째로 올렸어요. 자리가 나면 알림으로 알려 드려요.`, { type: 'success', emoji: '⏳' });
              this.refreshMine().then(() => { if (this.isOpen()) this._render(); }).catch(() => {});
            } catch (e) { msg.textContent = errText(e); go.disabled = false; }
          });
          b.append(h('p', { class: 'al-lead' }, `${kindOf(kind).emoji} ${kindOf(kind).name}${zone ? ` (${zone})` : ''} 빈 자리가 나면 차례대로 제안해요. 제안은 정해진 시간 안에 받아야 해요.`),
            h('label', { class: 'al-field', for: 'al-w-name' }, h('span', { class: 'al-flabel' }, '이름'), name),
            h('label', { class: 'al-field', for: 'al-w-phone' }, h('span', { class: 'al-flabel' }, '전화번호'), phone),
            h('div', { class: 'al-consent req' }, h('label', { for: 'al-w-c1' }, c1, h('span', null, h('b', null, '[필수] '), '개인정보 수집·이용에 동의해요 (목적: 빈 자리 안내 연락 · 항목: 이름, 전화번호 · 대기가 끝나면 지워요 · 동의하지 않을 수 있지만 그러면 대기할 수 없어요)'))),
            h('div', { class: 'al-consent req' }, h('label', { for: 'al-w-c2' }, c2, h('span', null, h('b', null, '[필수] '), '만 14세 이상 본인이거나 보호자예요'))),
            msg, h('div', { class: 'al-applyfoot' }, go));
        } });
      return m;
    },
    async _waitLeave(w) {
      if (!(await G.easy.gate({ reason: 'allot-apply' }))) return;
      if (!(await G.ui.confirm('대기 명단에서 이름을 뺄까요? 다시 올리면 맨 뒤 차례가 돼요.', { title: '대기 그만두기', okText: '빼기', cancelText: '그대로 두기' }))) return;
      try { await req('allot/waitlist.php', { body: { action: 'leave', id: w.id }, timeout: 15000 }); toast('대기 명단에서 뺐어요.', { type: 'success' }); }
      catch (e) { toast(errText(e), { type: 'error' }); }
      this.refreshMine().then(() => this._render()).catch(() => {});
    },
    async _waitAccept(w) {
      if (!(await G.easy.gate({ reason: 'allot-apply' }))) return;
      try { const r = await req('allot/waitlist.php', { body: { action: 'accept', id: w.id }, timeout: 20000 }); toast(`제안받은 자리를 신청했어요 (${String(r?.contractNo || '')}).`, { type: 'success', emoji: '🎉' }); }
      catch (e) { toast(errText(e), { type: 'error' }); }
      this.refreshMine().then(() => this.refreshMap({ force: true })).then(() => this._render()).catch(() => {});
    },
    async _cancel(c) {
      if (!(await G.easy.gate({ reason: 'allot-apply' }))) return;
      const pending = c.status === 'pending';
      const ok = await G.ui.confirm(pending ? '이 신청을 취소할까요? 잡아 둔 자리는 다른 분이 고를 수 있게 돼요.' : '운영자에게 계약 취소를 요청할까요? 환불은 환불 안내에 따라 운영자가 처리해요.', { title: pending ? '신청 취소' : '취소 요청', okText: pending ? '취소하기' : '요청하기', cancelText: '그대로 두기' });
      if (!ok) return;
      try {
        const r = await req('allot/cancel.php', { body: { contractNo: c.contractNo }, timeout: 15000 });
        toast(r?.requested ? '취소 요청을 보냈어요. 운영자가 확인하면 알려 드려요.' : '신청을 취소했어요.', { type: 'success' });
      } catch (e) { toast(errText(e), { type: 'error' }); }
      await this.refreshMine().catch(() => {});
      await this.refreshMap({ force: true }).catch(() => {});
      this._render();
    },
    async _editNameplate(c) {
      const easy = easyOn();
      let text = null, show = !!c.nameplate?.show;
      if (easy) {
        // easy mode: friendly presets only (no typing); who sees it stays as the grown-up set it
        const list = D().nameplates || [];
        const id = await G.easy.pick({ id: 'allot-np', title: '이름표 고르기', say: '이름표를 골라요.', emoji: '🏷️', columns: 2,
          items: list.map((n, i) => ({ id: String(i), emoji: n.e, label: n.t, say: n.t })).concat([{ id: 'none', emoji: '🚫', label: '이름표 떼기', say: '이름표 떼기' }]) });
        if (id == null) return;
        text = id === 'none' ? '' : (list[Number(id)] || {}).t || '';
      } else {
        if (!(await G.easy.gate({ reason: 'allot-apply' }))) return;
        const r = await new Promise((resolve) => {
          const inp = h('input', { id: 'al-np-in', type: 'text', maxlength: '12', value: String(c.nameplate?.text || ''), placeholder: '예: 우리 가족 장' });
          const cb = h('input', { id: 'al-np-show', type: 'checkbox', checked: show || null });
          let val = null;
          G.ui.modal.open({ id: 'allot-np', title: '이름표', icon: '🏷️', size: 'sm', className: 'allot-adult-modal',
            body: h('div', { class: 'al-apply' }, h('label', { class: 'al-field', for: 'al-np-in' }, h('span', { class: 'al-flabel' }, '이름표 (12자까지)'), inp, h('small', null, '나쁜 말과 연락처는 가려져요. 비우면 이름표를 떼요.')),
              h('div', { class: 'al-consent' }, h('label', { for: 'al-np-show' }, cb, h('span', null, '다른 사람에게도 보여 줘요')))),
            actions: [{ label: '그만두기', class: 'btn-ghost' }, { label: '저장', class: 'btn-primary', onClick: () => { val = { text: inp.value.trim().slice(0, 40), show: cb.checked }; } }],
            onClose: () => resolve(val) });
        });
        if (!r) return;
        text = r.text; show = r.show;
      }
      if (!isServer()) { if (this._mine?.contracts?.[0]) this._mine.contracts[0].nameplate = { text, show }; toast('체험용이라 이 기기에서만 바뀌어요.', { type: 'info', emoji: '🧪' }); this._render(); return; }
      try {
        const r = await req('allot/nameplate.php', { body: { contractNo: c.contractNo, text, show }, timeout: 15000 });
        c.nameplate = r?.nameplate || { text, show };
        toast(text ? '이름표를 달았어요!' : '이름표를 뗐어요.', { type: 'success', emoji: '🏷️' });
        say(text ? `이름표를 달았어요. ${text}` : '이름표를 뗐어요.');
      } catch (e) { toast(errText(e), { type: 'error' }); }
      this._render();
    },
    async _payGuide() {
      let pl = null;
      try { pl = await this._loadPlans(false); } catch (e) { toast(errText(e), { type: 'error' }); return; }
      G.ui.modal.open({ id: 'allot-payguide', title: '납부 안내', icon: '💳', size: 'sm',
        body: h('div', { class: 'al-apply' }, h('pre', { class: 'al-pre' }, String(pl.texts?.payGuide || '운영자에게 납부 방법을 물어봐 주세요.')),
          pl.sample ? h('p', { class: 'al-note' }, '“예시” 문구예요. 실제 계좌와 방법은 운영자에게 확인해 주세요.') : null),
        actions: [{ label: '확인', class: 'btn-primary' }] });
    },
    async _pay(c) {
      if (!(await G.easy.gate({ reason: 'allot-apply' }))) return;
      try {
        const p = await req('allot/pay-prepare.php', { body: { contractNo: c.contractNo }, timeout: 15000 });
        if (!p || !p.orderId) throw Object.assign(new Error('no order'), { code: 'BAD_ANSWER' });
        if (p.mock) {
          const ok = await G.ui.confirm(`테스트 결제 모드예요 (실제 결제가 아니에요). ${fmtWon(p.amount)}을 낸 것으로 할까요?`, { title: '🧪 테스트 결제', okText: '테스트 결제', cancelText: '그만두기' });
          if (!ok) return;
          await this._confirmPay({ paymentKey: `mock_${p.orderId}`, orderId: p.orderId, amount: Number(p.amount) });
          return;
        }
        const toss = await loadToss();
        const pay = toss(String(p.clientKey || '')).payment({ customerKey: String(p.customerKey) });
        await pay.requestPayment({ method: 'CARD', amount: { currency: 'KRW', value: Math.round(Number(p.amount)) }, orderId: p.orderId, orderName: String(p.orderName || '분양 납부'), successUrl: p.successUrl, failUrl: p.failUrl });
      } catch (e) {
        if (/CANCEL/i.test(String(e?.code || ''))) toast('결제를 취소했어요.', { type: 'info' });
        else toast(errText(e, '결제를 시작하지 못했어요.'), { type: 'error', duration: 6000 });
      }
    },
    async _confirmPay(r) {
      try {
        const d = await req('allot/pay-confirm.php', { body: { paymentKey: String(r.paymentKey).slice(0, 200), orderId: String(r.orderId).slice(0, 64), amount: Math.round(Number(r.amount)) }, timeout: 20000 });
        toast(`납부를 확인했어요 (${String(d?.contractNo || '')}).`, { type: 'success', emoji: '💳' });
        await this.refreshMine().catch(() => {});
        this.open('mine');
      } catch (e) { toast(errText(e, '결제를 확인하지 못했어요.'), { type: 'error', duration: 7000 }); }
    },
  };

  // ---------------------------------------------------------------- 토스 return (?allot=pay|payfail)
  const RETURN_KEYS = ['allot', 'paymentKey', 'orderId', 'amount', 'code', 'message'];
  function readPayReturn() {
    const P = G.params || new URLSearchParams(location.search);
    const v = P.get('allot');
    if (v !== 'pay' && v !== 'payfail') return null;
    const r = { ok: v === 'pay', paymentKey: String(P.get('paymentKey') || ''), orderId: String(P.get('orderId') || ''), amount: parseInt(String(P.get('amount') || ''), 10) };
    try {
      const u = new URL(location.href);
      for (const k of RETURN_KEYS) u.searchParams.delete(k);
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* file:// */ }
    for (const k of RETURN_KEYS) { try { P.delete(k); } catch (e) { /* ignore */ } }
    if (r.ok && (!/^[A-Za-z0-9_-]{1,200}$/.test(r.paymentKey) || !/^[A-Za-z0-9_-]{8,64}$/.test(r.orderId) || !(r.amount >= 1 && r.amount <= 10000000))) return { ok: false };
    return r;
  }
  let tossP = null;
  function loadToss() {
    if (typeof window.TossPayments === 'function') return Promise.resolve(window.TossPayments);
    if (G.sys.subscription?._loadSdk) return G.sys.subscription._loadSdk();
    if (!tossP) tossP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard'; s.async = true; s.referrerPolicy = 'no-referrer';
      s.onload = () => (typeof window.TossPayments === 'function' ? resolve(window.TossPayments) : reject(new Error('결제 모듈을 불러오지 못했어요.')));
      s.onerror = () => { tossP = null; reject(new Error('결제 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
    return tossP;
  }

  // test hooks (tests/allot-client.mjs, dev center): the pure pieces
  S._internal = { Live, drawUnits, makeMap, errText, setZones, markUnit, demoMine, demoInbox, readPayReturn };
  G.register(S);
  G.sys.allot = S;
})();
