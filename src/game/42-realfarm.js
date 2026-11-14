// =============================================================================
// 42-realfarm.js — 실시간 텃밭 (CONTRACT §15.1) · 곳간 (§15.2) · 재배 완료 확인 📮 / 📬 확인 기록장 (§15.3)
//
//   G.sys.realfarm (order 61, right after farming)
//     beds() -> [{id, bed|null, crop, status:'empty'|'growing'|'ready', progress 0..1, leftMs, readyAt, stars}]
//     bed(id) -> one entry of beds() | null
//     plant(bedId, cropId) -> bool        no seed is used up (the garden hands out seeds); nothing withers
//     care(bedId) -> bool                 물 주기: care = min(100, care + carePerAction), cooldown careCooldownMin ÷ (tier × scale)
//     harvest(bedId) -> {itemId, amount, stars, toStorage, toBag} | null   only when G.time.now() >= readyAt; the 곳간
//                                         first, overflow to the bag; exp / coin through progression.grant
//     clear(bedId) -> Promise<bool>       뽑기 (confirm first)
//     open(bedId)                         bed panel: crop picker cards / progress ring + countdown + wall-clock line /
//                                         buttons 물 주기 · 수확하기 · 📮 완료 확인 보내기 · 뽑기
//     openBook()                          📬 확인 기록장: every request with ⏳ / ✅ + stamp + memo / ↩️ + memo
//     report(bedId | pid | plotId, note?) -> Promise<report | null>   📮 one request per planting
//     reports() / reportFor(kind, bedId, pid) / refreshReports() -> Promise
//     applyServer(rt) -> number           the server's firstSeenAt / readyAt / tier for every bed whose pid matches
//     scale() / setScale(n)               time scale: server = farm.rt_scale (rt.scale / ping rtScale); local = this
//                                         device only (dev center, behind the grown-up gate) — never in a profile
//     onSaveRefused(codes) -> bool        03-state hook: RT_HARVEST_TOO_EARLY → calm "not ready yet" words
//     core                                the pure rules over a state object (no DOM, no G.state): self-tests use it
//   G.sys.storage (order 62) — 곳간
//     open() · put(itemId, n) · take(itemId, n) · putAll() · count(itemId) · total() · free() · cap() · storable(itemId)
//     put/take move between the bag (G.sys.inventory) and the 곳간 and return how many moved
// Events: rtfarm:planted {bedId, cropId, pid, readyAt} · rtfarm:cared {bedId, care} · rtfarm:ready {bedId, cropId, pid}
//   (once per planting — the pid is remembered in G.state.flags['rt:ready:<bed>'], so beds that got ready while the
//   browser was closed fire on load, with the offline-return toast + 옹이 line) · rtfarm:harvested {bedId, cropId, amount,
//   stars, pid} · rtfarm:report {id, status} · storage:changed {itemId, delta, total}
// Time: every countdown is computed from timestamps (G.time.now(), server-adjusted) once a wall-clock second — never
//   from frame time. That tick runs from the frame loop (a busy renderer can hold timers back for seconds) with a 1 s
//   timer as the backstop for a hidden tab. dur = minutes × 60000 ÷ (tier × scale). Server mode: the server's readyAt
//   (data.rt of every accepted save) is the only judge; planting, harvesting and clearing save at once.
//   Labels: far from the camera (> 24 m) a bed label shrinks to "① + picture" so the four never pile up.
// Server (CONTRACT §15.3): POST api/farm/report.php {kind, bedId, pid, note?}, POST api/farm/report-photo.php (multipart
//   photo + reportId, a JPEG canvas snapshot ≤ 1 MB / ≤ 1280 px), GET api/farm/reports.php (on load, when the book opens,
//   every 60 s while something waits), POST api/farm/seen.php {ids}. Local mode: G.state.rtfarm.reports (source 'local')
//   and "🧑‍🏫 어른 확인" behind the grown-up gate (G.easy.gate) to approve or return with a typed memo — the same book.
// 3D: crops on the 4 raised beds of layout.rtBeds (models of G.cropKit by growth stage, instanced), a label over each
//   bed, pooled glints over ready beds (G.ffx, no flashes), interactables 'rtbed' and 'storage' (the 곳간 door).
// Kid rules (§12): easy mode = the same panels with big picture buttons, data-say voice lines, no typing (the note is
//   one of rtfarm.reportNotes), no prices. Security: every server / typed string reaches the DOM through textContent
//   (G.ui.h children) — never innerHTML; ids and photo urls from the server are checked before use.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp;
  const h = (...a) => G.ui.h(...a);
  const now = () => G.time.now();
  const RT = () => G.data.rtfarm || {};
  const LY = () => G.data.layout || {};
  const items = () => G.data.items || {};
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => typeof k === 'string' && isMap(o) && Object.prototype.hasOwnProperty.call(o, k);
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const serverMode = () => G.net?.mode === 'server' && !!G.save && G.save.adapter === G.save.ServerAdapter;
  const say = (text, opts) => { try { G.easy?.say?.(text, opts || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const reduced = () => (typeof G.motionReduced === 'function' ? G.motionReduced() : !!G.settings?.reduceMotion);
  const CAT = 'FARM';
  const LS_SCALE = 'tfm.v1.rtScale';
  const DAY = 86400000;
  const REPORT_WINDOW = 7 * DAY;           // a harvest can still be reported for 7 days (§15.3)
  const POLL_MS = 60000;                   // the book polls every 60 s while a request waits
  const LABEL_NEAR = 24;                   // m: nearer than this a bed label shows its words, farther only ① + picture
  const PHOTO_MAX_BYTES = 1000000, PHOTO_MAX_PX = 1280;
  const NOTE_MAX = 80, MEMO_MAX = 500;
  const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  const RX_BED = /^[A-Z][A-Z0-9_]{0,11}$/;
  /** Korean particle: josa('박하', '이/가') -> '박하가' (the first form follows a final consonant) */
  function josa(word, pair) {
    const w = String(word ?? '');
    const [a, b] = pair.split('/');
    const c = w.trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(c >= 0 && c <= 11171)) return w + (/[013678]$/.test(w) ? a : b);
    return w + (c % 28 ? a : b);
  }

  // ---------------------------------------------------------------- time words
  const pad2 = (n) => String(n).padStart(2, '0');
  /** '12:34' / '1:02:03' (rounded up to the second) */
  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
  }
  /** '10분' / '2시간' / '1시간 30분' / '45초' */
  function durText(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return `${s}초`;
    const m = Math.round(s / 60);
    const hh = Math.floor(m / 60), mm = m % 60;
    if (hh) return `${hh}시간${mm ? ` ${mm}분` : ''}`;
    return `${mm}분`;
  }
  /** kid words for what is left: '12분 34초' (under 10 min) / '25분' / '1시간 5분' / '30초' */
  function kidLeft(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    if (hh) return `${hh}시간${mm ? ` ${mm}분` : ''}`;
    if (mm) return `${mm}분${mm < 10 && ss ? ` ${ss}초` : ''}`;
    return `${ss}초`;
  }
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  /** '오후 3시 20분' (+ '내일 ' / '모레 ' / '5월 3일 ' when it is not today) */
  function wallClock(at) {
    const d = new Date(at);
    const h24 = d.getHours(), m = d.getMinutes();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const diff = Math.round((dayStart(at) - dayStart(now())) / DAY);
    const day = diff === 0 ? '' : diff === 1 ? '내일 ' : diff === 2 ? '모레 ' : `${d.getMonth() + 1}월 ${d.getDate()}일 `;
    return `${day}${h24 < 12 ? '오전' : '오후'} ${h12}시${m ? ` ${m}분` : ''}`;
  }
  const dateText = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}`; };

  // =============================================================================================
  // the pure rules (CONTRACT §15.1 / §15.2) over a state-like object {rtfarm, storage, stats}
  // =============================================================================================
  const core = {
    PID: /^[0-9a-f]{16}$/,
    /** a fresh planting id: 16 lowercase hex chars from crypto.getRandomValues */
    newPid() {
      const a = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(a);
      let s = '';
      for (let i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
      return s;
    },
    bedIds() { return (RT().beds || []).slice(); },
    isBed(id) { return (RT().beds || []).includes(id); },
    /** a real-time crop: the rt row merged with the crop table (name, picture, harvest item / amount, model) */
    crop(id) {
      const r = own(RT().crops, id) ? RT().crops[id] : null;
      const c = own(G.data.crops, id) ? G.data.crops[id] : null;
      if (!r || !c) return null;
      const amt = Array.isArray(c.harvestAmount) && c.harvestAmount.length >= 2 ? c.harvestAmount : [1, 3];
      return {
        id, minutes: Number(r.minutes) || 0, exp: Number(r.exp) || 0, coin: Number(r.coin) || 0, name: c.name,
        icon: items()[c.harvestItem]?.icon || '🌱', harvestItem: c.harvestItem, harvestAmount: [Number(amt[0]) || 1, Number(amt[1]) || 1],
        model: c.model, category: c.category, fruit: c.fruit,
      };
    },
    crops() { return Object.keys(RT().crops || {}).map((id) => core.crop(id)).filter(Boolean).sort((a, b) => a.minutes - b.minutes); },
    divisor(tier, scale) { return clamp(Math.round(Number(tier) || 1), 1, 4) * clamp(Number(scale) || 1, 0.1, 3600); },
    durMs(cropId, tier, scale) { const c = core.crop(cropId); return c ? Math.max(1, Math.round((c.minutes * 60000) / core.divisor(tier, scale))) : 0; },
    coolMs(tier, scale) { return Math.round(((Number(RT().careCooldownMin) || 5) * 60000) / core.divisor(tier, scale)); },
    /** care ≥ starAt[2] → ★★★, ≥ starAt[1] → ★★, else ★ */
    stars(care) { const a = RT().starAt || [0, 40, 75]; const c = Number(care) || 0; return c >= a[2] ? 3 : c >= a[1] ? 2 : 1; },
    status(bed, t) { return !bed ? 'empty' : t >= bed.readyAt ? 'ready' : 'growing'; },
    progress(bed, t) { if (!bed) return 0; const span = bed.readyAt - bed.plantedAt; return span <= 0 ? 1 : clamp((t - bed.plantedAt) / span, 0, 1); },
    leftMs(bed, t) { return bed ? Math.max(0, bed.readyAt - t) : 0; },
    rt(s) {
      if (!isMap(s.rtfarm)) s.rtfarm = { beds: {}, last: [], reports: [] };
      const R = s.rtfarm;
      if (!isMap(R.beds)) R.beds = {};
      if (!Array.isArray(R.last)) R.last = [];
      if (!Array.isArray(R.reports)) R.reports = [];
      if (!isMap(s.stats)) s.stats = {};
      return R;
    },
    /** plant -> {ok, bed} | {ok:false, err:'bed'|'crop'|'busy'}; o = {t, tier, scale, pid?} */
    plant(s, bedId, cropId, o) {
      if (!core.isBed(bedId)) return { ok: false, err: 'bed' };
      if (!core.crop(cropId)) return { ok: false, err: 'crop' };
      const R = core.rt(s);
      if (R.beds[bedId]) return { ok: false, err: 'busy' };
      const t = Math.round(Number(o.t) || 0), tier = clamp(Math.round(Number(o.tier) || 1), 1, 4);
      const dur = core.durMs(cropId, tier, o.scale);
      // a pid is never used twice: not by another bed, not by a recent harvest (the server refuses RT_PID_REUSE)
      const used = new Set(Object.values(R.beds).map((b) => b && b.pid).concat(R.last.map((x) => x && x.pid)));
      let pid = typeof o.pid === 'string' && core.PID.test(o.pid) ? o.pid : core.newPid();
      for (let i = 0; used.has(pid) && i < 8; i++) pid = core.newPid();
      const bed = { cropId, pid, plantedAt: t, readyAt: t + dur, dur, tier, care: 0, lastCareAt: 0 };
      R.beds[bedId] = bed;
      return { ok: true, bed };
    },
    /** 물 주기 -> {ok, care} | {ok:false, err:'empty'|'ready'|'full'|'cooldown', leftMs}; o = {t, scale} */
    care(s, bedId, o) {
      const bed = core.rt(s).beds[bedId];
      const t = Number(o.t) || 0;
      if (!bed) return { ok: false, err: 'empty' };
      if (t >= bed.readyAt) return { ok: false, err: 'ready' };
      if ((bed.care || 0) >= 100) return { ok: false, err: 'full' };
      const cool = core.coolMs(bed.tier, o.scale);
      const since = t - (bed.lastCareAt || 0);
      if (bed.lastCareAt && since >= 0 && since < cool) return { ok: false, err: 'cooldown', leftMs: cool - since };
      bed.care = Math.min(100, (bed.care || 0) + (Number(RT().carePerAction) || 25));
      bed.lastCareAt = Math.round(t);
      return { ok: true, care: bed.care };
    },
    /** random in harvestAmount + 1 with ★★★ (bonusAtStars) */
    amount(cropId, stars, rnd = Math.random) {
      const c = core.crop(cropId);
      if (!c) return 0;
      const [lo, hi] = c.harvestAmount;
      const base = lo + Math.floor(clamp(Number(rnd()) || 0, 0, 0.999999) * (hi - lo + 1));
      return base + (stars >= (Number(RT().bonusAtStars) || 3) ? 1 : 0);
    },
    /** harvest -> {ok, cropId, itemId, amount, stars, pid, exp, coin} | {ok:false, err:'empty'|'early', leftMs};
     *  records last (newest 8) and stats.rtHarvests and empties the bed (the caller places the items) */
    harvest(s, bedId, o) {
      const R = core.rt(s);
      const bed = R.beds[bedId];
      const t = Number(o.t) || 0;
      if (!bed) return { ok: false, err: 'empty' };
      if (t < bed.readyAt) return { ok: false, err: 'early', leftMs: bed.readyAt - t };
      const c = core.crop(bed.cropId);
      if (!c) return { ok: false, err: 'empty' };
      const stars = core.stars(bed.care);
      const amount = Number.isFinite(o.amount) ? Math.max(0, Math.round(o.amount)) : core.amount(bed.cropId, stars, o.rnd);
      delete R.beds[bedId];
      R.last.push({ pid: bed.pid, bedId, cropId: bed.cropId, amount, stars, at: Math.round(t) });
      // oldest → newest by time (whatever order a stored copy came in), the newest 8 stay
      R.last.sort((a, b) => (Number(a && a.at) || 0) - (Number(b && b.at) || 0));
      if (R.last.length > 8) R.last.splice(0, R.last.length - 8);
      s.stats.rtHarvests = Math.max(0, Math.round(Number(s.stats.rtHarvests) || 0)) + 1;
      return { ok: true, cropId: bed.cropId, itemId: c.harvestItem, amount, stars, pid: bed.pid, exp: c.exp, coin: c.coin };
    },
    clear(s, bedId) { const R = core.rt(s); if (!R.beds[bedId]) return false; delete R.beds[bedId]; return true; },
    /** a new time scale: what is left of every growing bed is multiplied by k (= old ÷ new); progress stays where it is */
    retime(s, k, t) {
      let n = 0;
      if (!(k > 0) || k === 1) return 0;
      for (const b of Object.values(core.rt(s).beds)) {
        if (!b || t >= b.readyAt) continue;
        const span = Math.max(1, b.readyAt - b.plantedAt);
        b.readyAt = Math.round(t + (b.readyAt - t) * k);
        b.dur = Math.max(1, Math.round(span * k));
        b.plantedAt = b.readyAt - b.dur;
        n++;
      }
      return n;
    },
    /** interface 2: rt = {scale, tier, beds:{RB1:{pid, cropId, firstSeenAt, readyAt, status}}} -> beds moved (> 1 s) */
    applyServer(s, rt) {
      if (!isMap(rt) || !isMap(rt.beds)) return 0;
      const R = core.rt(s);
      const tier = Number.isFinite(Number(rt.tier)) && rt.tier !== null ? clamp(Math.round(Number(rt.tier)), 1, 4) : null;
      let moved = 0;
      for (const id of Object.keys(R.beds)) {
        const b = R.beds[id], v = own(rt.beds, id) ? rt.beds[id] : null;
        if (!b || !isMap(v) || v.pid !== b.pid) continue;
        const fs = Number(v.firstSeenAt), ra = Number(v.readyAt);
        if (!(fs > 0) || !Number.isFinite(ra) || ra < fs) continue;
        const tierMoved = tier != null && tier !== b.tier;
        if (Math.abs(fs - b.plantedAt) <= 1000 && Math.abs(ra - b.readyAt) <= 1000 && !tierMoved) continue;
        b.plantedAt = Math.round(fs);
        b.readyAt = Math.round(ra);
        b.dur = Math.max(1, b.readyAt - b.plantedAt);
        if (tier != null) b.tier = tier;
        moved++;
      }
      return moved;
    },
    // ---- 곳간
    storable(itemId) { return (G.data.storage?.itemIds || []).includes(itemId); },
    cap() { return Math.max(0, Math.floor(Number(G.data.storage?.cap) || 300)); },
    sto(s) {
      if (!isMap(s.storage)) s.storage = { items: {}, cap: core.cap() };
      if (!isMap(s.storage.items)) s.storage.items = {};
      s.storage.cap = core.cap();
      return s.storage;
    },
    count(s, itemId) { return Math.max(0, Math.floor(Number(own(core.sto(s).items, itemId) ? core.sto(s).items[itemId] : 0) || 0)); },
    total(s) { let n = 0; for (const v of Object.values(core.sto(s).items)) n += Math.max(0, Math.floor(Number(v) || 0)); return n; },
    free(s) { return Math.max(0, core.cap() - core.total(s)); },
    /** put n of itemId into the 곳간 -> how many fit (cap, 9999 per item, storable ids only) */
    put(s, itemId, n) {
      if (!core.storable(itemId)) return 0;
      const have = core.count(s, itemId);
      const m = Math.max(0, Math.min(Math.floor(Number(n) || 0), core.free(s), 9999 - have));
      if (m > 0) core.sto(s).items[itemId] = have + m;
      return m;
    },
    take(s, itemId, n) {
      const have = core.count(s, itemId);
      const m = Math.max(0, Math.min(Math.floor(Number(n) || 0), have));
      if (m > 0) { const left = have - m; if (left > 0) core.sto(s).items[itemId] = left; else delete core.sto(s).items[itemId]; }
      return m;
    },
  };

  // ---------------------------------------------------------------- small UI helpers
  const inv = () => G.sys.inventory;
  const bagCount = (id) => (inv()?.count ? inv().count(id) : Number(G.state?.inventory?.[id]) || 0);
  const bagRoom = (id) => (inv()?.room ? inv().room(id) : 999);
  const itemName = (id) => items()[id]?.name || '작물';
  const itemIcon = (id) => items()[id]?.icon || '🧺';
  const bedNo = (id) => { const i = core.bedIds().indexOf(id); return i >= 0 ? CIRCLED[i] || String(i + 1) : ''; };
  const starText = (n) => '★'.repeat(clamp(n, 0, 3)) + '☆'.repeat(3 - clamp(n, 0, 3));
  const btn = (cls, emoji, label, fn, sayLine) => {
    const b = h('button', { type: 'button', class: `btn ${cls}`, 'data-say': sayLine || label }, emoji ? h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji) : null, h('span', { class: 'rf-btn-lbl' }, label));
    if (fn) b.addEventListener('click', fn);
    return b;
  };
  /** the chat module's kid-safety cleaning for a typed local note (control chars, PII mask, bad words) */
  function cleanTyped(s, max) {
    let t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const S = G.sys.social;
    try { if (S?.cleanText) t = S.cleanText(t, max); } catch (e) { /* optional */ }
    try { if (S?.maskPII) t = S.maskPII(t); } catch (e) { /* optional */ }
    try { if (S?.filter) t = S.filter(t); } catch (e) { /* optional */ }
    return String(t || '').slice(0, max);
  }
  /** a report object from the server -> a clean copy, or null (types, enums, lengths; the photo url same-origin only) */
  function cleanReport(r) {
    if (!isMap(r)) return null;
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const kind = r.kind === 'plot' ? 'plot' : r.kind === 'rt' ? 'rt' : null;
    if (!kind || typeof r.bedId !== 'string' || !RX_BED.test(r.bedId)) return null;
    const status = r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending';
    const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : 0);
    const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
    let photo = typeof r.photoUrl === 'string' ? r.photoUrl.trim() : '';
    // same-origin relative paths only (img-src 'self'): no scheme, no '//' host, no '..', a short safe charset
    if (!/^[A-Za-z0-9][A-Za-z0-9_\-./?=&%]{0,200}$/.test(photo) || /\.\.|\/\/|:/.test(photo)) photo = '';
    return {
      id, kind, bedId: r.bedId, pid: typeof r.pid === 'string' ? r.pid.slice(0, 20) : '',
      cropId: typeof r.cropId === 'string' && own(G.data.crops, r.cropId) ? r.cropId : null,
      stars: clamp(Math.round(num(r.stars)), 0, 3), amount: clamp(Math.round(num(r.amount)), 0, 99),
      note: str(r.note, NOTE_MAX), status, memo: status === 'pending' && !r.memo ? '' : str(r.memo, MEMO_MAX),
      requestedAt: num(r.requestedAt), decidedAt: num(r.decidedAt), photoUrl: photo || null,
      seen: r.seen === true || (Number(r.seenAt) > 0), source: 'server',
    };
  }

  // =============================================================================================
  // 곳간 (G.sys.storage)
  // =============================================================================================
  const storage = {
    name: 'storage', order: 62, label: '곳간',
    _modal: null,
    init() {
      G.bus.on('item:added', () => this._refreshSoon());
      G.bus.on('item:removed', () => this._refreshSoon());
      G.bus.on('easy:changed', () => { const m = this._modal; if (m && !m.closed) { m.close({ instant: true }); this.open(); } });
    },
    onStateLoaded(state) { if (state) core.sto(state); },
    onLogout() { this._modal?.close?.(); this._modal = null; },
    storable(itemId) { return core.storable(itemId); },
    cap() { return core.cap(); },
    count(itemId) { return G.state ? core.count(G.state, itemId) : 0; },
    total() { return G.state ? core.total(G.state) : 0; },
    free() { return G.state ? core.free(G.state) : 0; },
    list() { const st = G.state; if (!st) return []; return Object.keys(core.sto(st).items).filter((id) => core.count(st, id) > 0).map((id) => ({ id, item: items()[id], qty: core.count(st, id) })); },
    _changed(itemId, delta) {
      const total = this.total();
      G.dirty('storage');
      G.bus.emit('storage:changed', { itemId, delta, total });
      this._refreshSoon();
    },
    /**
     * bag -> 곳간: moves up to n of itemId (what the bag holds, what fits) -> moved. opts.fresh: the items are new
     * (a harvest) and do not come out of the bag.
     */
    put(itemId, n = 1, opts = {}) {
      if (!G.state || !core.storable(itemId)) return 0;
      let want = Math.floor(Number(n) || 0);
      if (!(want > 0)) return 0;
      if (!opts.fresh) want = Math.min(want, bagCount(itemId));
      const moved = core.put(G.state, itemId, want);
      if (moved <= 0) return 0;
      if (!opts.fresh) {
        const ok = inv()?.remove ? inv().remove(itemId, moved, { source: 'storage', silent: true }) : false;
        if (!ok) { core.take(G.state, itemId, moved); return 0; } // nothing left the bag: undo
      }
      this._changed(itemId, moved);
      return moved;
    },
    /** 곳간 -> bag: up to n (what the 곳간 holds, what the bag stack still takes) -> moved */
    take(itemId, n = 1) {
      if (!G.state) return 0;
      const want = Math.min(Math.floor(Number(n) || 0), this.count(itemId), bagRoom(itemId));
      if (!(want > 0)) return 0;
      const moved = core.take(G.state, itemId, want);
      if (moved <= 0) return 0;
      const added = inv()?.add ? inv().add(itemId, moved, { source: 'storage', silent: true }) : 0;
      if (added < moved) core.put(G.state, itemId, moved - added); // the bag took less: the rest stays in the 곳간
      if (added > 0) this._changed(itemId, -added);
      return added;
    },
    /** every storable item of the bag into the 곳간 (until it is full) -> moved */
    putAll() {
      if (!G.state) return 0;
      let moved = 0;
      for (const id of G.data.storage?.itemIds || []) {
        const q = bagCount(id);
        if (q > 0 && this.free() > 0) moved += this.put(id, q);
      }
      return moved;
    },
    _refreshSoon() {
      if (!this._modal || this._modal.closed) return;
      clearTimeout(this._rt);
      this._rt = setTimeout(() => this._render(), 60);
    },

    // ------------------------------------------------------------ panel: 가방 ↔ 곳간
    open() {
      if (!G.state) return null;
      const kid = kidOn();
      const m = G.ui.modal.open({
        id: 'rt-storage', size: kid ? 'md' : 'lg', className: `rt-modal rt-storage-modal${kid ? ' rt-kid' : ''}`,
        title: '곳간', icon: '🏚️',
        say: kid ? '곳간이에요. 가방에 있는 작물을 넣거나 꺼낼 수 있어요.' : undefined,
        body: (body) => body.classList.add('rf-sto-body'),
        onClose: () => { if (this._modal === m) this._modal = null; },
      });
      this._modal = m;
      this._render();
      return m;
    },
    _render() {
      const m = this._modal;
      if (!m || m.closed || !G.state) return;
      const kid = kidOn();
      const body = m.body;
      const scroll = Array.from(body.querySelectorAll('.rf-sto-list')).map((el) => el.scrollTop);
      body.textContent = '';
      const total = this.total(), cap = this.cap();
      const pct = cap ? Math.round((total / cap) * 100) : 0;
      const capFill = h('i');
      capFill.style.setProperty('--v', String(clamp(pct, 0, 100)));   // 42-realfarm.css slides the fill by transform (no layout)
      const bar = h('div', { class: `rf-cap${pct >= 100 ? ' full' : pct >= 80 ? ' near' : ''}`, role: 'img', 'aria-label': `곳간 ${total} / ${cap}`, 'data-say': `곳간에 ${total}개 있어요. ${cap}개까지 넣을 수 있어요.` },
        h('span', { class: 'rf-cap-ico emoji', 'aria-hidden': 'true' }, '🏚️'),
        h('span', { class: 'rf-cap-bar' }, capFill),
        h('b', { class: 'rf-cap-num' }, `${U.fmt(total)} / ${U.fmt(cap)}`));
      const bagItems = (G.data.storage?.itemIds || []).filter((id) => bagCount(id) > 0).map((id) => ({ id, qty: bagCount(id) }));
      const stoItems = this.list();
      const row = (it, side) => {
        const name = itemName(it.id), icon = itemIcon(it.id);
        const go = side === 'bag'
          ? btn(kid ? 'easy-big-btn rf-put' : 'btn-primary btn-sm rf-put', kid ? '➡️' : null, kid ? '넣기' : '넣기 →', () => { const n = this.put(it.id, it.qty); this._feedback(n, it.id, 'put'); }, `${name}${josa(name, '을/를').slice(name.length)} 곳간에 넣어요.`)
          : btn(kid ? 'easy-big-btn rf-take' : 'btn-soft btn-sm rf-take', kid ? '⬅️' : null, kid ? '꺼내기' : '← 꺼내기', () => { const n = this.take(it.id, it.qty); this._feedback(n, it.id, 'take'); }, `${name}${josa(name, '을/를').slice(name.length)} 가방으로 꺼내요.`);
        if (side === 'bag' && this.free() <= 0) go.disabled = true;
        if (side === 'sto' && bagRoom(it.id) <= 0) go.disabled = true;
        return h('div', { class: 'rf-sto-row', 'data-say': `${name} ${it.qty}개` },
          h('span', { class: 'rf-sto-ico emoji', 'aria-hidden': 'true' }, icon),
          h('span', { class: 'rf-sto-name' }, name),
          h('b', { class: 'rf-sto-qty' }, `×${U.fmt(it.qty)}`), go);
      };
      const col = (side, title, emoji, list, emptyText) => h('section', { class: `rf-sto-col ${side}` },
        h('h3', { class: 'rf-sto-title' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), title, h('span', { class: 'rf-sto-count' }, `${list.reduce((a, x) => a + x.qty, 0)}개`)),
        h('div', { class: 'rf-sto-list' }, list.length ? list.map((it) => row(it, side)) : h('p', { class: 'rf-sto-empty' }, emptyText)));
      body.append(
        bar,
        h('div', { class: 'rf-sto-cols' },
          col('bag', '가방', '🎒', bagItems, kid ? '넣을 작물이 없어요' : '가방에 넣을 수 있는 작물·발효식품이 없어요'),
          col('sto', '곳간', '🏚️', stoItems, kid ? '곳간이 비었어요' : '곳간이 비어 있어요. 실시간 텃밭에서 거둔 작물이 여기에 먼저 들어와요.')));
      if (!kid) body.appendChild(h('p', { class: 'rf-note small dim' }, `곳간에는 작물과 발효식품을 ${U.fmt(cap)}개까지 넣어 둘 수 있어요. 실시간 텃밭에서 거둔 작물은 곳간에 먼저 들어오고, 곳간이 가득 차면 가방으로 가요.`));
      Array.from(body.querySelectorAll('.rf-sto-list')).forEach((el, i) => { if (scroll[i]) el.scrollTop = scroll[i]; });
      m.setActions([]);
      const all = btn(kid ? 'easy-big-btn easy-btn-yes rf-putall' : 'btn-gold rf-putall', '📦', '모두 넣기', () => { const n = this.putAll(); this._feedback(n, null, 'all'); }, '가방에 있는 작물을 모두 곳간에 넣어요.');
      all.disabled = !bagItems.length || this.free() <= 0;
      const close = btn(kid ? 'easy-big-btn easy-btn-no rf-close' : 'btn-ghost rf-close', kid ? '⬅️' : null, '닫기', () => m.close(), '곳간을 닫아요.');
      m.foot.append(close, all);
      try { G.easy?.speakable?.(bar); } catch (e) { /* optional */ }
    },
    _feedback(n, itemId, what) {
      const kid = kidOn();
      if (n > 0) {
        G.sfx(what === 'take' ? 'pickup' : 'coin');
        const nm = itemId ? itemName(itemId) : '';
        const line = what === 'take' ? `${nm} ${n}개를 가방에 넣었어요!` : what === 'all' ? `곳간에 ${n}개를 넣었어요!` : `${nm} ${n}개를 곳간에 넣었어요!`;
        if (kid) say(line, { priority: 1 });
        else G.ui.toast(line, { type: 'success', emoji: what === 'take' ? '🎒' : '🏚️', sound: false, duration: 1800 });
      } else {
        const line = what === 'take' ? '가방에 자리가 없어요. 가방을 먼저 비워요.' : '곳간이 꽉 찼어요! 곳간에서 꺼내거나 가게에 팔아요.';
        G.ui.toast(line, { type: 'warn', emoji: what === 'take' ? '🎒' : '🏚️', say: kid ? line : undefined });
      }
      this._render();
    },
  };

  // =============================================================================================
  // 실시간 텃밭 (G.sys.realfarm)
  // =============================================================================================
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _cam = new THREE.Vector3(), _col = new THREE.Color(), _col2 = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  const lerp = U.lerp;

  const realfarm = {
    name: 'realfarm', order: 61, label: '실시간 텃밭',
    core,
    _ready: false,
    _tickAt: 0,
    _vis: new Map(),       // bedId -> 3D runtime {def, root, meshes, plants[], label, els, key, cx, cz, soilY, spark}
    _panel: null,          // {m, id, key, els}
    _book: null,           // book modal
    _reports: [],          // server mode: the caller's last 50 requests (cleaned)
    _fetchedAt: 0,
    _fetching: null,
    _celebrated: new Set(),
    _known: new Map(),     // report id -> status seen by this session (server mode: new decisions)
    _localScale: null,

    // ------------------------------------------------------------ lifecycle
    init() {
      try { const v = Number(localStorage.getItem(LS_SCALE)); if (v >= 0.1 && v <= 3600) this._localScale = v; } catch (e) { /* storage blocked */ }
      try { this._buildWorld(); } catch (e) { G.log.error(CAT, 'real-time beds: 3D failed', e); }
      G.bus.on('easy:changed', () => {
        for (const V of this._vis.values()) V.key = '';
        if (this._ready) this._refreshLabels(true);
        const P = this._panel;
        if (P && !P.m.closed) { const id = P.id; P.m.close({ instant: true }); this.open(id); }
        const B = this._book;
        if (B && !B.closed) { B.close({ instant: true }); this.openBook(); }
      });
      // a returning tab polls at once when something waits (server mode)
      document.addEventListener('visibilitychange', () => { if (!document.hidden && this._ready && serverMode() && this._pending()) this.refreshReports({ quiet: true }); });
      G.log.info(CAT, `real-time beds ready: ${core.bedIds().length} beds, ${core.crops().length} crops`);
    },

    onStateLoaded(state) {
      if (!state) return;
      core.rt(state); core.sto(state);
      if (!isMap(state.flags)) state.flags = {};
      this._reports = [];
      this._known = new Map();
      this._celebrated = new Set();
      this._fetchedAt = 0;
      this._srvScale = null;
      this._ready = true;
      if (serverMode()) {
        const rt = G.save.ServerAdapter?.rt;
        if (rt) this.applyServer(rt, { quiet: true });
        clearTimeout(this._fetchT);
        this._fetchT = setTimeout(() => { if (this._ready && serverMode()) this.refreshReports({ quiet: true, first: true }); }, 2500);
      } else this._localDue = now() + 1800; // decisions made while away: celebrated by the tick, after the welcome
      for (const V of this._vis.values()) { V.key = ''; V.label?.setVisible(true); }
      this._announce(true);
      this._syncAll();
      this._refreshLabels(true);
      this._startTick();
    },

    onLogout() {
      this._ready = false;
      this._localDue = 0;
      clearInterval(this._timer);
      clearTimeout(this._fetchT);
      this._panel?.m?.close?.(); this._panel = null;
      this._book?.close?.(); this._book = null;
      this._reports = [];
      for (const V of this._vis.values()) V.label?.setVisible(false);
    },

    update(dt) {
      if (!this._ready || !G.state) return;
      this._sparkle(dt);
      this._lodT += dt;
      if (this._lodT >= 0.25) {
        this._lodT = 0;
        this._labelLod();
        // what the child sees (countdowns, labels, the open panel) follows the frames: under a busy renderer the
        // browser can hold timers back for seconds, frames keep coming. One tick per wall-clock second either way.
        if (Math.floor(now() / 1000) !== this._tickSec) { try { this._tick(); } catch (e) { G.log.warn(CAT, 'tick failed', e); } }
      }
    },
    _lodT: 0,
    _tickSec: 0,
    _localDue: 0,
    /** seen from far away the four labels would sit on top of each other: they shrink to the bed number + picture
     *  (an empty bed's label hides) and grow back to "① 박하 · 12:34 남음" as the camera comes near */
    _labelLod() {
      const cp = G.sys.engine?.camera?.position;
      if (!cp) return;
      for (const V of this._vis.values()) {
        const E = V.els;
        if (!E) continue;
        const far = Math.hypot(cp.x - V.cx, cp.y - V.soilY, cp.z - V.cz) > LABEL_NEAR;
        if (E.last.far !== far) { E.last.far = far; E.el.classList.toggle('is-far', far); }
      }
    },
    /** the 1 Hz tick runs from the frame loop (above) and from this wall-clock timer — the backstop for a hidden tab,
     *  where no frames come (ready announcements, the book's polling); every value it shows is computed from
     *  timestamps, so a late tick never shows a wrong time */
    _startTick() {
      clearInterval(this._timer);
      this._timer = setInterval(() => { if (this._ready && G.state) { try { this._tick(); } catch (e) { G.log.warn(CAT, 'tick failed', e); } } }, 1000);
    },
    _tick() {
      this._tickAt = performance.now();
      this._tickSec = Math.floor(now() / 1000);
      this._announce(false);
      this._syncAll();
      this._refreshLabels(false);
      this._refreshPanel(false);
      if (serverMode() && this._pending() && now() - this._fetchedAt >= POLL_MS) this.refreshReports({ quiet: true });
      if (this._localDue && now() >= this._localDue) { this._localDue = 0; this._localDecisions(); }
    },

    // ------------------------------------------------------------ public reads
    _st() { return G.state ? core.rt(G.state) : { beds: {}, last: [], reports: [] }; },
    bed(id) {
      if (!core.isBed(id)) return null;
      const t = now();
      const b = this._st().beds[id] || null;
      const crop = b ? core.crop(b.cropId) : null;
      return { id, bed: b, crop, status: core.status(b, t), progress: core.progress(b, t), leftMs: core.leftMs(b, t), readyAt: b ? b.readyAt : 0, stars: b ? core.stars(b.care) : 0 };
    },
    beds() { return core.bedIds().map((id) => this.bed(id)); },
    /** is any bed ready right now? (allocation-free: the minimap asks every frame it draws) */
    anyReady() {
      const B = G.state?.rtfarm?.beds;
      if (!B || !this._ready) return false;
      const t = now(), ids = RT().beds || [];
      for (let i = 0; i < ids.length; i++) { const b = B[ids[i]]; if (b && t >= b.readyAt) return true; }
      return false;
    },
    tier() { const p = Number(G.sys.speed?.progression?.()); return p >= 1 && p <= 4 ? Math.round(p) : 1; },
    /** the time scale: server mode = the operator's farm.rt_scale; local mode = this device's dev-center value */
    scale() {
      if (serverMode()) {
        const v = Number(this._srvScale ?? G.net?.serverInfo?.rtScale);
        return v >= 0.1 && v <= 3600 ? v : 1;
      }
      const v = Number(this._localScale ?? RT().localScale);
      return v >= 0.1 && v <= 3600 ? v : 1;
    },
    /** local mode only (the dev center asks the grown-up gate first): growing beds keep their progress -> new scale */
    setScale(n) {
      const v = Number(n);
      if (serverMode()) { G.ui.toast('서버 모드에서는 관리자 페이지에서 시간 배율을 바꿔요.', { type: 'info', emoji: '⏱️' }); return this.scale(); }
      if (!(v >= 0.1 && v <= 3600)) return this.scale();
      const old = this.scale();
      this._localScale = v;
      try { if (v === (Number(RT().localScale) || 1)) localStorage.removeItem(LS_SCALE); else localStorage.setItem(LS_SCALE, String(v)); } catch (e) { /* storage blocked */ }
      if (G.state && old !== v) {
        const n2 = core.retime(G.state, old / v, now());
        if (n2) G.dirty('rtfarm');
      }
      G.log.info(CAT, `time scale ${old} -> ${v} (local)`);
      this._tick();
      return v;
    },

    // ------------------------------------------------------------ actions
    plant(bedId, cropId) {
      if (!G.state || !this._ready) return false;
      const kid = kidOn();
      const c = core.crop(cropId);
      const r = core.plant(G.state, bedId, cropId, { t: now(), tier: this.tier(), scale: this.scale() });
      if (!r.ok) {
        if (r.err === 'busy') G.ui.toast(kid ? '벌써 자라고 있어요!' : '이 밭에는 이미 작물이 자라고 있어요.', { type: 'info', emoji: '🌱' });
        return false;
      }
      const b = r.bed;
      G.sfx('plant');
      this._fxAt(bedId, 'plant');
      const left = durText(b.readyAt - b.plantedAt);
      if (kid) {
        G.ui.toast(`${josa(c.name, '을/를')} 심었어요! ${left} 뒤에 다 자라요 🌱`, { type: 'success', emoji: c.icon, say: `${josa(c.name, '을/를')} 심었어요! ${left} 뒤에 다 자라요. 물을 주면 별을 받아요!` });
      } else G.ui.toast(`${c.name}${josa(c.name, '을/를').slice(c.name.length)} 심었어요. ${wallClock(b.readyAt)}에 다 자라요. 물을 주면 별(★)이 늘어요.`, { type: 'success', emoji: c.icon });
      G.activity('plant', `실시간 텃밭에 ${c.name} 심기`, { bedId, cropId });
      G.log.info(CAT, `rt plant ${bedId} <- ${cropId} (pid ${b.pid}, ready in ${Math.round((b.readyAt - b.plantedAt) / 1000)} s)`);
      G.bus.emit('rtfarm:planted', { bedId, cropId, pid: b.pid, readyAt: b.readyAt });
      this._afterChange(bedId, true);
      return true;
    },
    care(bedId) {
      if (!G.state || !this._ready) return false;
      const kid = kidOn();
      const r = core.care(G.state, bedId, { t: now(), scale: this.scale() });
      if (!r.ok) {
        const line = r.err === 'cooldown' ? (kid ? `물이 스며들고 있어요. ${kidLeft(r.leftMs)} 뒤에 또 줘요!` : `물이 흙에 스며드는 중이에요. ${clock(r.leftMs)} 뒤에 다시 줄 수 있어요.`)
          : r.err === 'full' ? (kid ? '흙이 벌써 촉촉해요! 별 셋이에요 ⭐' : '물을 충분히 줬어요. (돌봄 100%)')
            : r.err === 'ready' ? (kid ? '다 자랐어요! 이제 거둬요 🧺' : '다 자랐어요. 물 대신 수확해 주세요.') : (kid ? '먼저 씨앗을 심어요!' : '빈 밭이에요. 먼저 씨앗을 심어 주세요.');
        G.ui.toast(line, { type: 'info', emoji: '💧', say: kid ? line : undefined, sound: false });
        return false;
      }
      G.sfx('water');
      this._fxAt(bedId, 'water');
      const bed = this._st().beds[bedId];
      const stars = core.stars(r.care);
      if (kid) { say(`물을 줬어요! 별이 ${stars}개예요.`, { priority: 1 }); G.ffx?.floatText?.(`<b>💧 ${'⭐'.repeat(stars)}</b>`, this._labelPos(bedId), 'water kid'); }
      else G.ffx?.floatText?.(`<b>💧 돌봄 ${r.care}%</b> ${starText(stars)}`, this._labelPos(bedId), 'water');
      G.activity('water', `실시간 텃밭에 물 주기`, { bedId, cropId: bed?.cropId });
      G.dirty('rtfarm');
      G.bus.emit('rtfarm:cared', { bedId, care: r.care });
      this._afterChange(bedId, false);
      return true;
    },
    harvest(bedId) {
      if (!G.state || !this._ready) return null;
      const kid = kidOn();
      const cur = this.bed(bedId);
      if (!cur || !cur.bed) return null;
      if (cur.status !== 'ready') {
        const line = kid ? `아직 자라는 중이에요. ${kidLeft(cur.leftMs)}만 기다려요!` : `아직 다 자라지 않았어요. ${clock(cur.leftMs)} 남았어요.`;
        G.ui.toast(line, { type: 'info', emoji: '🌱', say: kid ? line : undefined });
        return null;
      }
      const c = cur.crop;
      const stars = cur.stars;
      const amount = core.amount(c.id, stars);
      // the 곳간 first, then the bag: nothing is lost — when neither takes it all, the crop waits in the bed
      const roomSto = core.storable(c.harvestItem) ? core.free(G.state) : 0;
      if (roomSto + bagRoom(c.harvestItem) < amount) {
        const line = kid ? '곳간과 가방이 꽉 찼어요! 가게에 팔고 다시 와요.' : '곳간과 가방에 자리가 모자라요. 곳간을 비우거나 가게에 판 뒤 다시 거둬 주세요.';
        G.ui.toast(line, { type: 'warn', emoji: '🏚️', say: kid ? line : undefined });
        return null;
      }
      const r = core.harvest(G.state, bedId, { t: now(), amount });
      if (!r.ok) return null;
      const toStorage = storage.put(r.itemId, r.amount, { fresh: true });
      let toBag = 0;
      if (toStorage < r.amount) toBag = inv()?.add ? inv().add(r.itemId, r.amount - toStorage, { source: 'rtharvest', silent: true }) : 0;
      // exp / coin through progression (reason 'harvest:…': the engagement inbox does not repeat it)
      G.sys.progression?.grant?.({ exp: r.exp, coin: r.coin }, { popup: false, silent: true, reason: 'harvest:rt' });
      G.sfx('harvest');
      this._fxAt(bedId, 'harvest', c);
      const nm = itemName(r.itemId);
      const where = toBag && toStorage ? '곳간과 가방' : toBag ? '가방' : '곳간';
      const rw = kid ? '' : `<small class="ffx-rw">🪙+${U.fmt(r.coin)} ✨+${U.fmt(r.exp)}</small>`;
      G.ffx?.floatText?.(`<b>${U.escapeHtml(itemIcon(r.itemId))} +${r.amount}</b> ${U.escapeHtml(nm)} ${U.escapeHtml(starText(r.stars))}${rw}`, this._labelPos(bedId), kid ? 'harvest kid' : 'harvest');
      if (kid) {
        try { G.easy?.celebrate?.(`${nm} ${r.amount}개!`, { emoji: itemIcon(r.itemId), say: `${josa(nm, '을/를')} ${r.amount}개 거뒀어요! ${where}에 넣었어요.`, duration: 1900, sound: 'pop' }); } catch (e) { /* optional */ }
      } else G.ui.toast(`${nm} ${r.amount}개를 거둬 ${where}에 넣었어요. (${starText(r.stars)})`, { type: 'success', emoji: '🏚️' });
      G.activity('harvest', `실시간 텃밭에서 ${nm} ${r.amount}개 수확`, { bedId, cropId: r.cropId, itemId: r.itemId, qty: r.amount });
      G.log.info(CAT, `rt harvest ${bedId} ${r.cropId} x${r.amount} (★${r.stars}) -> storage ${toStorage}, bag ${toBag}`);
      G.bus.emit('rtfarm:harvested', { bedId, cropId: r.cropId, amount: r.amount, stars: r.stars, pid: r.pid });
      this._afterChange(bedId, true);
      return { itemId: r.itemId, amount: r.amount, stars: r.stars, toStorage, toBag };
    },
    async clear(bedId) {
      const cur = this.bed(bedId);
      if (!cur || !cur.bed || !G.state) return false;
      const c = cur.crop;
      const ok = await G.ui.confirm(cur.status === 'ready'
        ? `${josa(c.name, '이/가')} 다 자랐어요! 뽑으면 거두지 않고 없어져요. 정말 뽑을까요?`
        : `${josa(c.name, '을/를')} 뽑을까요? 자라던 작물은 없어져요.`, { title: '뽑기', okText: '뽑기', danger: true, icon: 'trash', emoji: '🌱' });
      if (!ok || !G.state) return false;
      const b = this._st().beds[bedId];
      if (!b || b.pid !== cur.bed.pid) return false; // changed meanwhile
      core.clear(G.state, bedId);
      this._fxAt(bedId, 'clear');
      G.activity('farm', `실시간 텃밭 ${c.name} 뽑기`, { bedId, cropId: c.id });
      G.log.info(CAT, `rt clear ${bedId} (${c.id})`);
      this._afterChange(bedId, true);
      return true;
    },
    _afterChange(bedId, saveNow) {
      G.dirty('rtfarm');
      const V = this._vis.get(bedId);
      if (V) { V.key = ''; V.trans = 0; }
      this._syncAll();
      this._refreshLabels(true);
      this._refreshPanel(true);
      // server mode: planting, harvesting and clearing are saved at once — the server measures from the moment it sees them
      if (saveNow && serverMode()) G.save.save({ reason: 'rtfarm', force: true });
    },

    // ------------------------------------------------------------ ready detection (once per planting)
    _announce(onLoad) {
      if (!G.state) return;
      const t = now();
      const fresh = [];
      const flags = isMap(G.state.flags) ? G.state.flags : (G.state.flags = {});
      for (const id of core.bedIds()) {
        const b = this._st().beds[id];
        if (!b || t < b.readyAt) continue;
        const key = `rt:ready:${id}`;
        if (flags[key] === b.pid) continue;
        flags[key] = b.pid;
        fresh.push({ id, b });
        G.bus.emit('rtfarm:ready', { bedId: id, cropId: b.cropId, pid: b.pid });
      }
      if (!fresh.length) return;
      G.dirty('rtfarm');
      const kid = kidOn();
      const first = core.crop(fresh[0].b.cropId);
      const go = { label: '같이 가요', fn: () => this.goTo() };
      if (onLoad) {
        // the browser was closed while they grew: one toast + one 옹이 line for all of them
        const line = '실시간 텃밭에 다 자란 작물이 있어요!';
        setTimeout(() => {
          if (!G.state) return;
          G.ui.toast(line, { type: 'success', emoji: '🎉', say: kid ? `${line} 같이 가서 거둬요!` : undefined, duration: 6500 });
          try { G.mascot?.say?.(kid ? `${line} 같이 가서 거둘까요?` : `${line} ${fresh.length > 1 ? `${fresh.length}곳이` : `${josa(first?.name || '작물', '이/가')}`} 기다려요.`, { mood: 'cheer', action: go, priority: 2, voice: false }); } catch (e) { /* optional */ }
        }, 1200);
      } else {
        const nm = first?.name || '작물';
        const line = fresh.length > 1 ? `실시간 텃밭에서 작물 ${fresh.length}개가 다 자랐어요!` : `실시간 텃밭의 ${josa(nm, '이/가')} 다 자랐어요!`;
        G.ui.toast(line, { type: 'success', emoji: first?.icon || '🎉', say: kid ? `${line} 거두러 가요!` : undefined, duration: 5000 });
        try { G.mascot?.say?.(kid ? `${line} 거두러 갈까요?` : `${line} 수확하러 가 볼까요?`, { mood: 'cheer', action: go, priority: 1, voice: false }); } catch (e) { /* optional */ }
      }
    },
    /** walk (easy: guided) to the garden gate */
    goTo(target = 'garden') {
      const g = LY().rtGarden;
      const sto = LY().get?.('B_GOTGAN');
      const p = target === 'storage' && sto ? (LY().gotganDoor || { x: sto.x - 3, z: sto.z }) : g ? (g.approach || { x: g.x - g.w / 2 - 1.6, z: g.z }) : null;
      if (!p) return false;
      const label = target === 'storage' ? '곳간' : '실시간 텃밭';
      if (G.easy?.goTo) { G.easy.goTo({ x: p.x, z: p.z, label }, { label, stopDistance: 1.2 }); return true; }
      if (G.sys.minimap?.travelTo) { G.sys.minimap.travelTo({ x: p.x, z: p.z, label }); return true; }
      return false;
    },

    // ------------------------------------------------------------ server sync (interface 2)
    /** adopt the server's measured times: plantedAt = firstSeenAt, readyAt, tier, dur for every matching pid */
    applyServer(rt, opts = {}) {
      if (!isMap(rt) || !G.state) return 0;
      const sc = Number(rt.scale);
      if (sc >= 0.1 && sc <= 3600) this._srvScale = sc;
      const moved = core.applyServer(G.state, rt);
      if (moved) {
        G.log.info(CAT, `server times adopted for ${moved} bed(s)`);
        for (const V of this._vis.values()) V.key = '';
        if (!opts.quiet) { this._syncAll(); this._refreshLabels(true); this._refreshPanel(true); }
      }
      return moved;
    },
    /** GET api/farm/state.php -> the authoritative beds (after a refused save) */
    async refreshServerBeds() {
      if (!serverMode()) return 0;
      try {
        const d = await G.net.request('farm/state.php', { quiet: true });
        const beds = {};
        for (const b of Array.isArray(d?.beds) ? d.beds : []) {
          if (isMap(b) && (b.kind === 'rt' || b.kind == null) && core.isBed(b.bedId)) beds[b.bedId] = { pid: b.pid, cropId: b.cropId, firstSeenAt: b.firstSeenAt, readyAt: b.readyAt, status: b.status };
        }
        return this.applyServer({ scale: d?.scale, tier: d?.tier, beds });
      } catch (e) { G.log.warn(CAT, 'farm/state.php failed', e?.code || e); return 0; }
    },
    /** 03-state hook for a VALIDATION_FAILED save: the calm words for the farm codes -> true when handled */
    onSaveRefused(codes) {
      const list = Array.isArray(codes) ? codes : [];
      const kid = kidOn();
      if (list.includes('RT_HARVEST_TOO_EARLY')) {
        const line = kid ? '아직 다 자라지 않았어요. 조금만 더 기다려요! 🌱' : '아직 다 자라지 않았어요. 서버 시계로 다 자라면 그때 거둘 수 있어요.';
        G.ui.toast(line, { type: 'info', emoji: '⏰', say: kid ? '아직 다 자라지 않았어요. 조금만 더 기다려요!' : undefined, duration: 5000 });
        this.refreshServerBeds();
        return true;
      }
      if (list.length && list.every((c) => /^STORAGE_/.test(c))) {
        const line = kid ? '곳간이 꽉 찼어요. 다시 맞췄어요!' : '곳간 기록이 맞지 않아 서버에 저장된 곳간으로 되돌렸어요.';
        G.ui.toast(line, { type: 'info', emoji: '🏚️', say: kid ? line : undefined });
        return true;
      }
      return false;
    },

    // ------------------------------------------------------------ 📮 완료 확인 (CONTRACT §15.3)
    reports() { return serverMode() ? this._reports.slice() : this._st().reports.slice(); },
    reportFor(kind, bedId, pid) { return this.reports().find((r) => r.kind === kind && r.bedId === bedId && String(r.pid) === String(pid)) || null; },
    _pending() { return this.reports().some((r) => r.status === 'pending'); },
    /** what a request is about: a ready / recently harvested bed, a pid, or a quick plot at 100 % -> target | {err} */
    _target(ref) {
      const t = now();
      const R = this._st();
      const fromLast = (x) => ({ kind: 'rt', bedId: x.bedId, pid: x.pid, cropId: x.cropId, stars: x.stars, amount: x.amount, at: x.at });
      if (typeof ref === 'string' && core.PID.test(ref)) {
        const id = core.bedIds().find((b) => R.beds[b]?.pid === ref);
        if (id) return this._target(id);
        const x = R.last.slice().reverse().find((e) => e.pid === ref && t - e.at <= REPORT_WINDOW);
        return x ? fromLast(x) : { err: 'none' };
      }
      if (core.isBed(ref)) {
        const b = R.beds[ref];
        if (b && t >= b.readyAt) return { kind: 'rt', bedId: ref, pid: b.pid, cropId: b.cropId, stars: core.stars(b.care), amount: 0 };
        // an empty (or newly planted) bed: its newest harvest of the last 7 days that has no request yet — or, when
        // they all have one, the newest (report() then answers "already sent" with that request)
        const recent = R.last.slice().reverse().filter((e) => e.bedId === ref && t - e.at <= REPORT_WINDOW);
        const open = recent.find((e) => !this.reportFor('rt', e.bedId, e.pid));
        if (open) return fromLast(open);
        if (!b && recent.length) return fromLast(recent[0]);
        return { err: b ? 'growing' : 'none' };
      }
      const P = G.sys.farming?.getPlot?.(ref);
      if (P && P.def) {
        if (!P.crop || !P.ready || !(Number(P.plantedAt) > 0)) return { err: 'growing' };
        const hl = Number(P.health) || 0;
        return { kind: 'plot', bedId: ref, pid: String(Math.round(Number(P.plantedAt))), cropId: P.cropId, stars: hl >= 80 ? 3 : hl >= 50 ? 2 : 1, amount: 0 };
      }
      return { err: 'none' };
    },
    /** can the panel offer 📮 for this bed / plot right now? -> {ok, target, report} */
    canReport(ref) {
      const tg = this._target(ref);
      if (tg.err) return { ok: false, err: tg.err };
      const rep = this.reportFor(tg.kind, tg.bedId, tg.pid);
      return { ok: !rep, target: tg, report: rep };
    },
    /** 📮 send a completion request (one per planting) -> the report, or null */
    async report(ref, note) {
      if (!G.state || !this._ready) return null;
      const kid = kidOn();
      const tg = this._target(ref);
      if (tg.err) {
        const line = tg.err === 'growing' ? (kid ? '다 자라면 보낼 수 있어요!' : '다 자란 작물만 완료 확인을 보낼 수 있어요.') : (kid ? '보낼 수 있는 작물이 없어요.' : '완료 확인을 보낼 작물이 없어요. (수확한 지 7일이 지나면 보낼 수 없어요)');
        G.ui.toast(line, { type: 'info', emoji: '📮', say: kid ? line : undefined });
        return null;
      }
      const dup = this.reportFor(tg.kind, tg.bedId, tg.pid);
      if (dup) {
        const line = kid ? '벌써 보냈어요! 확인 기록장에서 봐요 📬' : '이 작물은 이미 완료 확인을 보냈어요. 확인 기록장에서 볼 수 있어요.';
        G.ui.toast(line, { type: 'info', emoji: '📬', say: kid ? line : undefined });
        return dup;
      }
      let text = typeof note === 'string' ? note : '';
      const presets = RT().reportNotes || [];
      // easy mode never types: only one of the preset notes rides along
      if (kid && text && !presets.includes(text)) text = '';
      text = presets.includes(text) ? text : cleanTyped(text, NOTE_MAX);
      if (this._sending) return null;
      this._sending = true;
      try {
        if (serverMode()) return await this._reportServer(tg, text);
        return this._reportLocal(tg, text);
      } finally { this._sending = false; }
    },
    _reportLocal(tg, text) {
      const R = this._st();
      const id = R.reports.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      const rep = { id, kind: tg.kind, bedId: tg.bedId, pid: tg.pid, cropId: tg.cropId, stars: tg.stars, amount: tg.amount, note: text, status: 'pending', memo: '', requestedAt: Math.round(now()), decidedAt: 0, photoUrl: null, source: 'local', seen: false };
      R.reports.push(rep);
      if (R.reports.length > 50) R.reports.splice(0, R.reports.length - 50);
      G.dirty('rtfarm');
      this._sent(rep, false);
      return rep;
    },
    async _reportServer(tg, text, opts = {}) {
      // the server judges from its own records: let it see the latest planting / harvest / plot growth first
      try { await G.save.save({ reason: 'rtfarm', force: true }); } catch (e) { /* the request below says what is wrong */ }
      const body = { kind: tg.kind, bedId: tg.bedId, pid: tg.pid };
      if (text) body.note = text;
      let d;
      try { d = await this._req('farm/report.php', { body }); }
      catch (e) {
        const kid = kidOn();
        const code = e?.code || '';
        const line = code === 'NOT_READY' ? (kid ? '아직 다 자라지 않았대요. 조금 뒤에 다시 보내요!' : '서버 시계로는 아직 다 자라지 않았어요. 조금 뒤에 다시 보내 주세요.')
          : code === 'ALREADY_REPORTED' ? (kid ? '벌써 보냈어요! 📬' : '이 작물은 이미 완료 확인을 보냈어요.')
            : code === 'REPORT_LIMIT' ? (kid ? '오늘은 많이 보냈어요. 내일 또 보내요!' : '오늘 보낼 수 있는 완료 확인을 다 보냈어요. 내일 다시 보내 주세요.')
              : (kid ? '앗, 못 보냈어요. 조금 뒤에 다시 해 봐요!' : (e?.message || '완료 확인을 보내지 못했어요. 잠시 후 다시 시도해 주세요.'));
        G.ui.toast(line, { type: code === 'NOT_READY' || code === 'ALREADY_REPORTED' ? 'info' : 'warn', emoji: '📮', say: kid ? line : undefined });
        if (code === 'ALREADY_REPORTED') this.refreshReports({ quiet: true });
        return null;
      }
      const rep = cleanReport(d?.report);
      if (!rep) { G.log.warn(CAT, 'report.php answered without a report'); this.refreshReports({ quiet: true }); return null; }
      if (!rep.pid) rep.pid = tg.pid;
      this._reports = [rep].concat(this._reports.filter((r) => r.id !== rep.id)).slice(0, 50);
      this._known.set(rep.id, rep.status);
      this._sent(rep, true);
      if (opts.photo || this._wantPhoto) { this._wantPhoto = false; this._sendPhoto(rep, tg); }
      return rep;
    },
    _sent(rep, srv) {
      const kid = kidOn();
      const nm = rep.cropId ? (core.crop(rep.cropId)?.name || G.data.crops?.[rep.cropId]?.name || '작물') : '작물';
      const who = srv ? '선생님' : '어른';
      const line = kid ? `${who}께 보냈어요! 확인해 주시면 도장을 받아요 📬` : `${nm} 완료 확인을 ${who}께 보냈어요. 확인해 주시면 확인 기록장에 도장과 메모가 남아요.`;
      G.sfx('notify');
      G.ui.toast(line, { type: 'success', emoji: '📮', say: kid ? line : undefined, duration: 4500 });
      if (!srv) try { G.mascot?.say?.(kid ? '어른에게 확인 기록장을 보여 줘요! "어른 확인"을 누르면 돼요.' : '확인 기록장에서 "어른 확인"을 누르면 어른이 완료를 확인해 줄 수 있어요.', { mood: 'happy', action: { label: '기록장 보기', fn: () => this.openBook() }, voice: false }); } catch (e) { /* optional */ }
      G.bus.emit('rtfarm:report', { id: rep.id, status: rep.status });
      this._refreshPanel(true);
      this._renderBook();
    },
    /** server reports (GET api/farm/reports.php) -> new decisions are celebrated once */
    refreshReports(opts = {}) {
      if (!serverMode()) { this._localDecisions(); return Promise.resolve(this.reports()); }
      if (this._fetching) return this._fetching;
      this._fetching = (async () => {
        try {
          const d = await G.net.request('farm/reports.php', { quiet: true });
          const list = (Array.isArray(d?.reports) ? d.reports : []).map(cleanReport).filter(Boolean).slice(0, 50);
          list.sort((a, b) => b.requestedAt - a.requestedAt || b.id - a.id);
          // new decisions: a request this session saw waiting that is decided now, plus — for requests this session has
          // not seen yet — the `unseen` most recently decided ones (or those the server marks seen:false)
          const unseen = clamp(Math.round(Number(d?.unseen) || 0), 0, 50);
          const decided = list.filter((r) => r.status !== 'pending').sort((a, b) => b.decidedAt - a.decidedAt || b.id - a.id);
          const fresh = [];
          let unknownLeft = unseen;
          for (const r of decided) {
            if (this._celebrated.has(r.id) || r.seen) continue;
            const was = this._known.get(r.id);
            if (was === 'pending') fresh.push(r);
            else if (was === undefined && unknownLeft > 0) { fresh.push(r); unknownLeft--; }
          }
          this._reports = list;
          for (const r of list) this._known.set(r.id, r.status);
          this._fetchedAt = now();
          if (fresh.length) this._decided(fresh);
          this._renderBook();
          this._refreshPanel(true);
        } catch (e) {
          this._fetchedAt = now();
          if (!opts.quiet) G.ui.toast(kidOn() ? '기록장을 못 열었어요. 조금 뒤에 다시 봐요!' : '확인 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'warn' });
          G.log.warn(CAT, 'farm/reports.php failed', e?.code || e);
        } finally { this._fetching = null; }
        return this._reports.slice();
      })();
      return this._fetching;
    },
    /** local mode: decisions a grown-up made that the child has not seen yet */
    _localDecisions() {
      if (!G.state || serverMode()) return;
      const fresh = this._st().reports.filter((r) => r.status !== 'pending' && !r.seen && !this._celebrated.has(r.id));
      if (fresh.length) this._decided(fresh);
    },
    /** a new decision: toast, 옹이 line, stamp animation, an entry in the 알림함; then marked seen */
    _decided(list) {
      const kid = kidOn();
      for (const r of list) this._celebrated.add(r.id);
      const ok = list.filter((r) => r.status === 'approved');
      const back = list.filter((r) => r.status === 'rejected');
      const nameOf = (r) => (r.cropId ? G.data.crops?.[r.cropId]?.name || '작물' : '작물');
      const who = serverMode() ? '선생님' : '어른';
      if (ok.length) {
        const nm = nameOf(ok[0]);
        const line = ok.length > 1 ? `완료 확인 ${ok.length}개가 도착했어요! 참 잘했어요!` : `${nm} 완료 확인을 받았어요! 참 잘했어요!`;
        G.ui.toast(line, { type: 'reward', emoji: '✅', say: kid ? line : undefined, duration: 6000 });
        try { G.fx?.stamp?.(kid ? '참 잘했어요!' : '확인 완료!', { sub: `${nm} · ${who} 확인`, color: '#d8402f' }); } catch (e) { /* fx optional */ }
        try { G.mascot?.say?.(`${who}이 ${josa(nm, '을/를')} 확인해 주셨어요! 메모를 읽어 볼까요?`, { mood: 'cheer', action: { label: '기록장 보기', fn: () => this.openBook() }, voice: false, priority: 2 }); } catch (e) { /* optional */ }
      }
      if (back.length) {
        const nm = nameOf(back[0]);
        const line = kid ? `${who}이 ${nm}에 메모를 남겼어요. 다시 해 봐요!` : `${nm} 완료 확인이 돌아왔어요. ${who}의 메모를 확인해 보세요.`;
        G.ui.toast(line, { type: 'info', emoji: '↩️', say: kid ? line : undefined, duration: 6000 });
        if (!ok.length) try { G.mascot?.say?.(kid ? '괜찮아요! 메모를 읽고 다시 해 봐요.' : '메모를 읽고 다시 키워 볼까요?', { mood: 'think', action: { label: '기록장 보기', fn: () => this.openBook() }, voice: false }); } catch (e) { /* optional */ }
      }
      // 알림함 (62-engagement): fixed words — the memo itself stays in the book, never in the saved inbox
      for (const r of list) {
        try {
          G.sys.engagement?.notify?.({
            type: 'farm', icon: r.status === 'approved' ? '✅' : '↩️',
            title: r.status === 'approved' ? `완료 확인: ${nameOf(r)}` : `다시 해 봐요: ${nameOf(r)}`,
            text: r.status === 'approved' ? `${who}이 완료를 확인했어요. 확인 기록장에서 메모를 봐요.` : `${who}이 메모를 남겼어요. 확인 기록장에서 봐요.`,
            act: 'rtbook', key: `rtfarm:${r.id}`,
          });
        } catch (e) { /* inbox optional */ }
        G.bus.emit('rtfarm:report', { id: r.id, status: r.status });
      }
      this._markSeen(list);
    },
    _markSeen(list) {
      if (serverMode()) {
        const ids = list.map((r) => r.id).filter((id) => Number.isSafeInteger(id)).slice(0, 50);
        if (ids.length) this._req('farm/seen.php', { body: { ids } }).then(() => { for (const r of this._reports) if (ids.includes(r.id)) r.seen = true; }, (e) => G.log.warn(CAT, 'farm/seen.php failed', e?.code || e));
        return;
      }
      let n = 0;
      for (const r of this._st().reports) if (list.some((x) => x.id === r.id) && !r.seen) { r.seen = true; n++; }
      if (n) G.dirty('rtfarm');
    },
    /** JSON request with one retry for a rotated CSRF token (the error answer carries the current one) */
    async _req(path, opts) {
      try { return await G.net.request(path, opts); }
      catch (e) { if (e?.code !== 'CSRF_INVALID') throw e; return G.net.request(path, opts); }
    },
    // ---- optional photo: a JPEG snapshot of the bed (≤ 1280 px, ≤ 1 MB) attached to the caller's own pending report
    async _sendPhoto(rep, tg) {
      try {
        const blob = await this.snapshot(tg.kind === 'rt' ? tg.bedId : null, tg.kind === 'plot' ? tg.bedId : null);
        if (!blob) return null;
        const form = new FormData();
        form.append('reportId', String(rep.id));
        form.append('photo', blob, 'bed.jpg');
        const d = await this._req('farm/report-photo.php', { form, timeout: 30000 });
        const u = cleanReport({ ...rep, photoUrl: d?.url })?.photoUrl;
        if (u) { rep.photoUrl = u; this._renderBook(); }
        G.ui.toast(kidOn() ? '사진도 보냈어요! 📸' : '밭 사진도 함께 보냈어요.', { type: 'success', emoji: '📸', sound: false });
        return u;
      } catch (e) {
        G.log.warn(CAT, 'report photo failed', e?.code || e);
        G.ui.toast(kidOn() ? '사진은 못 보냈어요. 확인은 잘 보냈어요!' : '사진은 보내지 못했어요. 완료 확인은 보냈어요.', { type: 'info', emoji: '📸' });
        return null;
      }
    },
    /** a canvas snapshot looking at a bed / plot -> Promise<Blob(image/jpeg) | null> (≤ 1280 px, ≤ 1 MB) */
    async snapshot(bedId, plotId) {
      const E = G.sys.engine;
      const r = E?.renderer, cam = E?.camera;
      if (!r || !cam) return null;
      try { if (r.getContext().isContextLost()) return null; } catch (e) { return null; }
      let at = null;
      const V = bedId ? this._vis.get(bedId) : null;
      if (V) at = { x: V.cx, y: V.soilY, z: V.cz, w: V.def.w, d: V.def.d };
      else if (plotId) { const P = LY().get?.(plotId); if (P) at = { x: P.x, y: G.world.terrainHeight(P.x, P.z) + 0.3, z: P.z, w: P.w, d: P.d }; }
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
      let canvas = null;
      try {
        if (at) {
          const dist = Math.max(at.w, at.d) * 1.1 + 2.2;
          cam.position.set(at.x, at.y + dist * 0.78, at.z + dist * 0.9);
          cam.lookAt(at.x, at.y + 0.35, at.z);
          cam.updateMatrixWorld(true);
        }
        E.render({ force: true });
        const src = r.domElement;
        const k = Math.min(1, PHOTO_MAX_PX / Math.max(1, src.width, src.height));
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(src.width * k)); canvas.height = Math.max(1, Math.round(src.height * k));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      } finally {
        cam.position.copy(keep.p); cam.quaternion.copy(keep.q); cam.updateMatrixWorld(true);
        try { E.render({ force: true }); } catch (e) { /* next frame redraws */ }
      }
      for (const q of [0.85, 0.72, 0.6, 0.48, 0.36]) {
        const blob = await new Promise((res) => { try { canvas.toBlob((b) => res(b), 'image/jpeg', q); } catch (e) { res(null); } });
        if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
      }
      return null;
    },

    // ------------------------------------------------------------ 📬 확인 기록장
    openBook() {
      if (!G.state) return null;
      const kid = kidOn();
      const srv = serverMode();
      const m = G.ui.modal.open({
        id: 'rt-book', size: kid ? 'md' : 'lg', className: `rt-modal rt-book-modal${kid ? ' rt-kid' : ''}`,
        title: '확인 기록장', icon: '📬',
        say: kid ? `확인 기록장이에요. ${srv ? '선생님' : '어른'}이 확인하면 도장이 찍혀요.` : undefined,
        body: (body) => body.classList.add('rf-book-body'),
        onClose: () => { if (this._book === m) this._book = null; },
      });
      this._book = m;
      this._bookLoading = srv && !this._fetchedAt;
      this._renderBook();
      if (srv) this.refreshReports({ quiet: false }).then(() => { this._bookLoading = false; this._renderBook(); });
      else this._localDecisions();
      return m;
    },
    _renderBook() {
      const m = this._book;
      if (!m || m.closed || !G.state) return;
      const kid = kidOn();
      const srv = serverMode();
      const who = srv ? '선생님' : '어른';
      const body = m.body;
      const keepScroll = body.scrollTop;
      body.textContent = '';
      const list = this.reports().slice().sort((a, b) => b.requestedAt - a.requestedAt || b.id - a.id);
      body.appendChild(h('p', { class: 'rf-book-lead', 'data-say': `다 자란 작물을 보내면 ${who}이 확인하고 도장을 찍어 줘요.` },
        kid ? `${who}이 확인하면 도장을 찍어 줘요!` : `다 자란 작물의 "📮 완료 확인 보내기"를 누르면 ${who}이 확인하고 메모를 남겨 줘요.`));
      if (this._bookLoading && !list.length) {
        body.appendChild(h('div', { html: G.ui.skeleton ? G.ui.skeleton({ rows: 3 }) : '' }));
      } else if (!list.length) {
        body.appendChild(h('div', { class: 'rf-book-empty', 'data-say': '아직 보낸 확인이 없어요. 다 자란 작물에서 확인 보내기를 눌러 봐요.' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📭'),
          h('b', null, '아직 보낸 확인이 없어요'),
          h('p', null, kid ? '다 자란 작물에서 📮 를 눌러 봐요!' : '실시간 텃밭이나 작물밭의 다 자란 작물에서 "📮 완료 확인 보내기"를 눌러 보세요.')));
      } else {
        const ul = h('div', { class: 'rf-book-list' });
        for (const r of list) ul.appendChild(this._bookCard(r, kid, srv, who));
        body.appendChild(ul);
      }
      body.scrollTop = keepScroll;
      m.setActions([]);
      const close = btn(kid ? 'easy-big-btn easy-btn-no' : 'btn-ghost', kid ? '⬅️' : null, '닫기', () => m.close(), '기록장을 닫아요.');
      m.foot.appendChild(close);
      if (srv) {
        const again = btn(kid ? 'easy-big-btn easy-btn-yes rf-book-refresh' : 'btn-soft rf-book-refresh', '🔄', kid ? '새 소식 보기' : '새로 고침', () => { again.disabled = true; this.refreshReports({ quiet: false }).finally(() => { again.disabled = false; }); }, '새 소식이 왔는지 봐요.');
        m.foot.appendChild(again);
      }
    },
    _bookCard(r, kid, srv, who) {
      const crop = r.cropId ? G.data.crops?.[r.cropId] : null;
      const nm = crop?.name || '작물';
      const icon = crop ? itemIcon(crop.harvestItem) : '🌱';
      const where = this._whereText(r.kind, r.bedId);
      const chip = r.status === 'approved' ? h('span', { class: 'rf-chip ok' }, '✅ 확인 완료') : r.status === 'rejected' ? h('span', { class: 'rf-chip back' }, '↩️ 다시 해 봐요') : h('span', { class: 'rf-chip wait' }, '⏳ 확인 기다리는 중');
      const sayLine = `${nm}. ${r.status === 'approved' ? `${who}이 확인했어요` : r.status === 'rejected' ? '다시 해 봐요' : `${who}의 확인을 기다려요`}.${r.memo ? ` 메모: ${r.memo}` : ''}`;
      const card = h('article', { class: `rf-book-card ${r.status}`, 'data-say': sayLine, dataset: { id: String(r.id) } },
        h('div', { class: 'rf-bc-head' },
          h('span', { class: 'rf-bc-ico emoji', 'aria-hidden': 'true' }, icon),
          h('div', { class: 'rf-bc-title' }, h('b', null, nm), h('span', { class: 'rf-bc-where' }, where)),
          chip),
        h('div', { class: 'rf-bc-meta' },
          r.stars ? h('span', { class: 'rf-stars', 'aria-label': `별 ${r.stars}개` }, starText(r.stars)) : null,
          r.amount ? h('span', null, `🧺 ${r.amount}개`) : null,
          h('span', { class: 'dim' }, `📮 ${dateText(r.requestedAt)}`)));
      if (r.note) card.appendChild(h('p', { class: 'rf-bc-note' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🗨️'), h('span', null, `내 한마디: ${r.note}`)));
      if (r.photoUrl) {
        const img = h('img', { class: 'rf-bc-photo', alt: `${nm} 밭 사진`, loading: 'lazy', decoding: 'async' });
        img.src = r.photoUrl; // same-origin relative path (checked by cleanReport)
        card.appendChild(img);
      }
      if (r.status !== 'pending') {
        card.appendChild(h('div', { class: 'rf-bc-decided' },
          r.status === 'approved' ? h('div', { class: 'rf-stamp', 'aria-hidden': 'true' }, h('span', null, '참'), h('span', null, '잘했어요')) : h('div', { class: 'rf-stamp back', 'aria-hidden': 'true' }, h('span', null, '다시'), h('span', null, '해 봐요')),
          h('div', { class: 'rf-bc-memo' },
            h('small', null, `${who}의 메모${r.decidedAt ? ` · ${dateText(r.decidedAt)}` : ''}`),
            h('p', null, r.memo || (r.status === 'approved' ? '참 잘했어요!' : '다시 한 번 해 봐요!')))));
      }
      if (!srv) {
        const label = r.status === 'pending' ? '어른 확인' : '메모 고치기';
        const b = btn(kid ? 'easy-big-btn rf-adult' : 'btn-soft btn-sm rf-adult', '🧑‍🏫', label, () => this.adultReview(r.id), `${label}. 어른만 할 수 있어요.`);
        card.appendChild(h('div', { class: 'rf-bc-actions' }, b));
      }
      return card;
    },
    /** '① 실시간 텃밭' / '3번 작물밭' / 'A번 허브밭' */
    _whereText(kind, bedId) {
      if (kind === 'rt') return `${bedNo(bedId)} 실시간 텃밭`;
      const p = LY().get?.(bedId);
      return p ? `${p.label || ''}번 ${p.zone === 'ZONE_HERB' ? '허브밭' : '작물밭'}` : '작물밭';
    },
    /** local mode: "🧑‍🏫 어른 확인" — the grown-up gate first, then approve / return with a typed memo */
    async adultReview(id) {
      if (serverMode() || !G.state) return false;
      const r = this._st().reports.find((x) => x.id === id);
      if (!r) return false;
      let pass = true;
      if (typeof G.easy?.gate === 'function') {
        try { pass = (await G.easy.gate({ reason: 'rtfarm-approve', title: '어른 확인', text: '아이의 완료 확인은 어른이 해요. 문제를 풀어 주세요.' })) === true; } catch (e) { pass = false; }
      }
      if (!pass || !G.state) return false;
      return new Promise((resolve) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); } };
        const crop = r.cropId ? G.data.crops?.[r.cropId] : null;
        const nm = crop?.name || '작물';
        const memo = h('textarea', { class: 'rf-memo', rows: '4', maxlength: String(MEMO_MAX), placeholder: '아이에게 남길 메모 (500자까지, 선택)', 'aria-label': '메모' });
        memo.value = r.memo || '';
        const count = h('small', { class: 'rf-memo-count dim' }, `${memo.value.length} / ${MEMO_MAX}`);
        memo.addEventListener('input', () => { count.textContent = `${memo.value.length} / ${MEMO_MAX}`; });
        const m = G.ui.modal.open({
          id: 'rt-adult', size: 'md', className: 'rt-modal rt-adult-modal', title: '어른 확인', icon: '🧑‍🏫', say: false,
          body: (body) => body.append(
            h('div', { class: 'rf-adult-sum' },
              h('span', { class: 'emoji rf-adult-ico', 'aria-hidden': 'true' }, crop ? itemIcon(crop.harvestItem) : '🌱'),
              h('div', null,
                h('b', null, `${nm} · ${this._whereText(r.kind, r.bedId)}`),
                h('p', { class: 'small dim' }, `${dateText(r.requestedAt)}에 보냄${r.stars ? ` · ${starText(r.stars)}` : ''}${r.amount ? ` · ${r.amount}개 수확` : ''}`),
                r.note ? h('p', { class: 'small' }, `아이의 한마디: ${r.note}`) : null)),
            h('label', { class: 'rf-memo-wrap' }, h('span', null, '메모'), memo, count),
            h('p', { class: 'small dim' }, '✅ 완료 처리를 누르면 아이의 기록장에 도장과 메모가 남아요. ↩️ 돌려보내기는 메모와 함께 다시 해 보게 해요.')),
          actions: [
            { label: '취소', class: 'btn-ghost', onClick: () => fin(false) },
            { label: '↩️ 돌려보내기', class: 'btn-soft rf-adult-back', onClick: () => { this._decideLocal(r.id, 'rejected', memo.value); fin(true); } },
            { label: '✅ 완료 처리', class: 'btn-gold rf-adult-ok', onClick: () => { this._decideLocal(r.id, 'approved', memo.value); fin(true); } },
          ],
          onClose: () => fin(false),
        });
        setTimeout(() => memo.focus({ preventScroll: true }), 60);
        void m;
      });
    },
    _decideLocal(id, status, memo) {
      const r = this._st().reports.find((x) => x.id === id);
      if (!r || (status !== 'approved' && status !== 'rejected')) return false;
      const wasPending = r.status === 'pending';
      r.status = status;
      r.memo = cleanTyped(memo, MEMO_MAX);
      r.decidedAt = Math.round(now());
      r.seen = false;
      G.dirty('rtfarm');
      G.log.info(CAT, `local report ${id} -> ${status}`);
      this._renderBook();
      // the child sees the decision right away (stamp + toast + 옹이 + 알림함), a memo edit only updates the book
      if (wasPending || status !== 'approved') { this._celebrated.delete(id); this._localDecisions(); }
      else { r.seen = true; G.bus.emit('rtfarm:report', { id, status }); }
      return true;
    },

    // ------------------------------------------------------------ bed panel
    _near(id) {
      const V = this._vis.get(id);
      const pl = G.sys.player?.position;
      if (!V || !pl) return true;
      return Math.abs(pl.x - V.cx) <= V.def.w / 2 + 3.2 && Math.abs(pl.z - V.cz) <= V.def.d / 2 + 3.2;
    },
    open(bedId) {
      if (!G.state || !core.isBed(bedId)) return null;
      const kid = kidOn();
      const cur = this.bed(bedId);
      const m = G.ui.modal.open({
        id: 'rt-bed', size: kid ? 'md' : 'md', className: `rt-modal rt-bed-modal${kid ? ' rt-kid' : ''}`, title: '', icon: null,
        say: kid ? this._kidSentence(cur) : undefined,
        body: (body) => body.classList.add('rf-bed-body'),
        onClose: () => { if (this._panel?.m === m) this._panel = null; },
      });
      this._panel = { m, id: bedId, key: '', els: null };
      this._refreshPanel(true);
      return m;
    },
    _kidSentence(cur) {
      if (!cur || !cur.bed) return '빈 밭이에요. 무엇을 심을까요? 진짜 시간으로 자라요.';
      const nm = cur.crop?.name || '작물';
      if (cur.status === 'ready') return `${josa(nm, '이/가')} 다 자랐어요! 거둬요.`;
      return `${josa(nm, '이/가')} 자라고 있어요. ${kidLeft(cur.leftMs)} 남았어요.`;
    },
    _refreshPanel(force) {
      const P = this._panel;
      if (!P) return;
      if (P.m.closed) { this._panel = null; return; }
      const cur = this.bed(P.id);
      if (!cur) return;
      const near = this._near(P.id);
      const rep = cur.bed ? null : this.canReport(P.id);
      const repNow = cur.status === 'ready' ? this.canReport(P.id) : null;
      const key = `${cur.status}|${cur.bed?.pid || ''}|${near}|${kidOn()}|${rep ? rep.ok : '-'}|${repNow ? repNow.ok : '-'}|${this.reports().length}`;
      if (force || key !== P.key) { P.key = key; this._renderPanel(P, cur, near, rep || repNow); }
      this._updatePanel(P, cur);
    },
    _renderPanel(P, cur, near, rep) {
      const m = P.m, kid = kidOn();
      const body = m.body;
      body.textContent = '';
      const els = { cur };
      const title = cur.bed ? `${bedNo(P.id)} ${cur.crop?.name || '작물'}` : `${bedNo(P.id)} 빈 밭`;
      m.setTitle(`${title} · 실시간 텃밭`, cur.bed ? cur.crop?.icon || '🌱' : '⏰');
      m.setActions([]);
      const foot = h('div', { class: 'rf-btns' });
      const addBtn = (b) => { foot.appendChild(b); return b; };
      const walk = () => { m.close(); G.interact?.activate ? G.interact.activate(`RTBED_${P.id}`) : this.goTo(); };
      if (!cur.bed) {
        // ---- empty: crop picker cards (picture, name, how long, reward — no prices in easy mode)
        body.appendChild(h('p', { class: 'rf-lead', 'data-say': '진짜 시간으로 자라요. 창을 닫아도 계속 자라요.' }, kid ? '⏰ 진짜 시간으로 자라요! 창을 닫아도 쑥쑥 자라요.' : '⏰ 진짜 시간으로 자라는 밭이에요. 브라우저를 닫아도 계속 자라고, 씨앗은 텃밭에서 그냥 받아요.'));
        const grid = h('div', { class: 'rf-picker', role: 'list' });
        const tier = this.tier(), sc = this.scale();
        for (const c of core.crops()) {
          const ms = core.durMs(c.id, tier, sc);
          const card = h('button', { type: 'button', class: 'rf-crop', role: 'listitem', disabled: near ? null : true, dataset: { crop: c.id }, 'data-say': `${c.name}. ${durText(ms)} 뒤에 다 자라요.` },
            h('span', { class: 'rf-crop-ico emoji', 'aria-hidden': 'true' }, c.icon),
            h('b', { class: 'rf-crop-name' }, c.name),
            h('span', { class: 'rf-crop-time' }, `⏰ ${durText(ms)}`),
            kid ? h('span', { class: 'rf-crop-rw', 'aria-hidden': 'true' }, `${c.icon} ${c.harvestAmount[0]}~${c.harvestAmount[1]}`) : h('span', { class: 'rf-crop-rw' }, `✨ ${c.exp} · 🪙 ${c.coin}`));
          card.addEventListener('click', () => { if (this.plant(P.id, c.id)) { if (kid) m.close(); } });
          grid.appendChild(card);
        }
        body.appendChild(grid);
        if (!near) body.appendChild(h('p', { class: 'notice-box info rf-far' }, kid ? '밭 가까이 가야 심을 수 있어요.' : '밭 가까이 가야 씨앗을 심을 수 있어요.'));
        if (!kid) body.appendChild(h('p', { class: 'rf-note small dim' }, `물을 주면 돌봄이 ${RT().carePerAction || 25}%씩 늘어요. 별 셋(★★★)이면 하나 더 거둬요. 다 자란 작물은 곳간에 먼저 들어가요.`));
        if (rep && rep.ok) addBtn(btn(kid ? 'easy-big-btn rf-report' : 'btn-soft rf-report', '📮', kid ? '확인 보내기' : '지난 수확 완료 확인 보내기', () => this._reportFlow(P.id), '지난번에 거둔 작물의 완료 확인을 보내요.'));
        if (!near) addBtn(btn(kid ? 'easy-big-btn easy-btn-yes' : 'btn-primary', '👉', '밭으로 가기', walk, '밭으로 같이 가요.'));
        addBtn(btn(kid ? 'easy-big-btn rf-book-btn' : 'btn-ghost rf-book-btn', '📬', '확인 기록장', () => this.openBook(), '확인 기록장을 봐요.'));
      } else {
        const c = cur.crop;
        els.ring = h('div', { class: 'rf-ring' }, els.pic = h('span', { class: 'rf-ring-pic emoji', 'aria-hidden': 'true' }, c?.icon || '🌱'));
        els.left = h('b', { class: 'rf-left' });
        els.clock = h('p', { class: 'rf-clock' });
        els.stars = h('span', { class: 'rf-stars', 'aria-label': '별' });
        els.careBar = h('i');
        els.careNum = h('b');
        const careRow = h('div', { class: 'rf-care' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💧'), h('span', null, kid ? '물' : '돌봄'), h('span', { class: 'rf-care-bar' }, els.careBar), els.careNum, els.stars);
        els.say = h('p', { class: 'rf-say' });
        body.append(h('div', { class: 'rf-hero' }, els.ring, h('div', { class: 'rf-hero-text' }, els.left, els.clock, careRow, els.say)));
        if (!near) body.appendChild(h('p', { class: 'notice-box info rf-far' }, kid ? '밭 가까이 가면 물을 주거나 거둘 수 있어요.' : '밭 가까이 가야 물을 주거나 수확할 수 있어요.'));
        if (cur.status === 'ready') {
          if (near) els.harvest = addBtn(btn(kid ? 'easy-big-btn easy-btn-yes rf-harvest' : 'btn-gold rf-harvest', '🧺', kid ? '거두기' : '수확하기', () => { if (this.harvest(P.id) && kid) m.close(); }, '다 자란 작물을 거둬요.'));
          if (rep && rep.ok) addBtn(btn(kid ? 'easy-big-btn rf-report' : 'btn-soft rf-report', '📮', kid ? '확인 보내기' : '완료 확인 보내기', () => this._reportFlow(P.id), '다 자랐다고 알려요.'));
          else if (rep && rep.report) addBtn(btn(kid ? 'easy-big-btn rf-book-btn' : 'btn-ghost rf-book-btn', '📬', rep.report.status === 'pending' ? '확인 기다리는 중' : '확인 기록장', () => this.openBook(), '확인 기록장을 봐요.'));
        } else if (near) {
          els.water = addBtn(btn(kid ? 'easy-big-btn easy-btn-yes rf-water' : 'btn-primary rf-water', '💧', '물 주기', () => this.care(P.id), '물을 줘요. 물을 주면 별이 늘어요.'));
        }
        if (!near) addBtn(btn(kid ? 'easy-big-btn easy-btn-yes' : 'btn-primary', '👉', '밭으로 가기', walk, '밭으로 같이 가요.'));
        addBtn(btn(kid ? 'easy-big-btn easy-btn-no rf-clear' : 'btn-ghost rf-clear', '🌱', '뽑기', () => { this.clear(P.id); }, '작물을 뽑아요. 뽑으면 없어져요.'));
      }
      m.foot.appendChild(foot);
      P.els = els;
      if (kid && els.say) { try { G.easy?.speakable?.(els.say, () => els.say.textContent); } catch (e) { /* optional */ } }
    },
    _updatePanel(P, cur) {
      const els = P.els;
      if (!els || !cur.bed) return;
      const kid = kidOn();
      const txt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
      const pct = String(Math.floor(cur.progress * 100));
      if (els.ring.style.getPropertyValue('--p') !== pct) els.ring.style.setProperty('--p', pct);
      els.ring.classList.toggle('ready', cur.status === 'ready');
      if (cur.status === 'ready') {
        txt(els.left, '다 자랐어요! 🎉');
        txt(els.clock, kid ? '이제 거둬요!' : '지금 수확할 수 있어요.');
      } else {
        txt(els.left, kid ? `⏰ ${kidLeft(cur.leftMs)} 남았어요` : `${clock(cur.leftMs)} 남음`);
        txt(els.clock, `${wallClock(cur.readyAt)}에 다 자라요`);
      }
      const care = cur.bed.care || 0;
      if (els.careV !== care) { els.careV = care; els.careBar.style.setProperty('--v', String(clamp(care, 0, 100))); }
      txt(els.careNum, kid ? '' : `${care}%`);
      txt(els.stars, starText(cur.stars));
      txt(els.say, this._kidSentence(cur));
      if (els.water) {
        const cool = core.coolMs(cur.bed.tier, this.scale()) - (now() - (cur.bed.lastCareAt || 0));
        const wait = cur.bed.lastCareAt && cool > 0;
        const full = care >= 100;
        const dis = !!(wait || full);
        if (els.water.disabled !== dis) els.water.disabled = dis;
        txt(els.water.querySelector('.rf-btn-lbl'), full ? (kid ? '촉촉해요' : '물을 충분히 줬어요') : wait ? (kid ? `${kidLeft(cool)} 뒤에 또` : `${clock(cool)} 뒤에 다시`) : '물 주기');
      }
    },
    /** 📮 the request flow: easy = picture notes (no typing); normal = a short form (≤ 80 chars, optional photo) */
    async _reportFlow(ref) {
      const kid = kidOn();
      const can = this.canReport(ref);
      if (!can.ok) { await this.report(ref); return null; }
      const presets = (RT().reportNotes || []).slice(0, 6);
      const srv = serverMode();
      if (kid && G.easy?.pick) {
        const pics = ['💧', '👀', '🌱', '💚', '⭐', '🎉'];
        const pickItems = presets.map((t, i) => ({ id: `n${i}`, emoji: pics[i] || '💬', label: t.replace(/[!.]$/, '').slice(0, 24), say: t }));
        pickItems.push({ id: 'none', emoji: '📮', label: '그냥 보내기', say: '그냥 보내요.' });
        const pick = await G.easy.pick({ id: 'rt-note', title: '무엇이라고 말할까?', emoji: '📮', say: `${srv ? '선생님' : '어른'}께 보낼 말을 골라요.`, items: pickItems, columns: 2, className: 'rt-note-pick' });
        if (!pick || !G.state) return null;
        const note = pick === 'none' ? '' : presets[Number(pick.slice(1))] || '';
        if (srv && G.easy?.confirm) this._wantPhoto = await G.easy.confirm({ emoji: '📸', heading: '사진', title: '밭 사진도 같이 보낼까요?', say: '밭 사진도 같이 보낼까요?', yes: '보낼래요', no: '아니요' });
        return this.report(ref, note);
      }
      return new Promise((resolve) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); } };
        const tg = can.target;
        const crop = tg.cropId ? G.data.crops?.[tg.cropId] : null;
        const ta = h('input', { type: 'text', class: 'rf-note-in', maxlength: String(NOTE_MAX), placeholder: '한마디 (선택, 80자까지)', 'aria-label': '한마디' });
        const chips = h('div', { class: 'rf-note-chips' }, presets.map((t) => { const c = h('button', { type: 'button', class: 'chip rf-note-chip' }, t); c.addEventListener('click', () => { ta.value = t; ta.focus(); }); return c; }));
        const photo = srv ? h('input', { type: 'checkbox', class: 'rf-photo-in' }) : null;
        const m = G.ui.modal.open({
          id: 'rt-report', size: 'md', className: 'rt-modal rt-report-modal', title: '완료 확인 보내기', icon: '📮',
          // (Element.append writes a null child as the word "null": the optional photo row is filtered out instead)
          body: (body) => body.append(...[
            h('p', null, `${crop?.name || '작물'} · ${this._whereText(tg.kind, tg.bedId)}${tg.stars ? ` · ${starText(tg.stars)}` : ''}${tg.amount ? ` · ${tg.amount}개 수확` : ''}`),
            h('label', { class: 'rf-note-wrap' }, h('span', null, `${srv ? '선생님' : '어른'}께 한마디`), ta), chips,
            photo ? h('label', { class: 'rf-photo-wrap' }, photo, h('span', null, '📸 밭 사진도 함께 보내기 (1 MB 이하 JPEG)')) : null,
            h('p', { class: 'small dim' }, srv ? '보낸 한마디는 개인정보 가림과 바른 말 거르기를 거쳐 선생님께 가요.' : '이 기기에 저장돼요. 기록장에서 어른이 확인해 줄 수 있어요.'),
          ].filter(Boolean)),
          actions: [
            { label: '취소', class: 'btn-ghost', onClick: () => fin(null) },
            { label: '📮 보내기', class: 'btn-primary rf-send', onClick: async () => { this._wantPhoto = !!photo?.checked; const r = await this.report(ref, ta.value); fin(r); } },
          ],
          onClose: () => fin(null),
        });
        void m;
      });
    },

    // =========================================================================================
    // 3D: crops on the raised beds (layout.rtBeds, built as part of B_RTGARDEN by 15-buildings), labels, glints
    // =========================================================================================
    _buildWorld() {
      const E = G.sys.engine;
      const defs = LY().rtBeds || [];
      if (!E?.scene || !defs.length) return;
      const kit = G.cropKit;
      for (const def of defs) {
        if (!core.isBed(def.id)) continue;
        const gy = this._groundY(def);
        const soilY = gy + (Number(def.h) || 0.42);
        const root = new THREE.Group();
        root.name = `rtbed:${def.id}`;
        root.position.set(def.x, soilY, def.z);
        root.rotation.y = def.rot || 0;
        E.scene.add(root);
        root.updateMatrixWorld(true);
        // invisible pick / highlight proxy covering the bed (the frame itself is merged into the garden's geometry)
        const proxy = G.bkit?.Site?.proxy ? G.bkit.Site.proxy(root, 0, -(Number(def.h) || 0.42), 0, def.w, (Number(def.h) || 0.42) + 0.5, def.d) : null;
        if (proxy) proxy.userData.plot = { w: def.w, d: def.d };
        const V = { def, root, proxy, cx: def.x, cz: def.z, soilY, meshes: {}, plants: [], model: null, modelId: null, key: '', trans: 1, spark: 0, labelPos: new THREE.Vector3(def.x, soilY + 1.1, def.z), label: null, els: null };
        this._vis.set(def.id, V);
        this._buildLabel(V);
        this._registerBed(V);
        void kit;
      }
      const door = LY().gotganDoor;
      if (door && G.interact?.register) {
        G.interact.register({
          id: 'GOTGAN_DOOR', kind: 'storage', label: '곳간 열기', kidLabel: '곳간 열기', emoji: '🏚️',
          position: new THREE.Vector3(door.x, (G.world.terrainHeight(door.x, door.z) || 0) + 0.2, door.z),
          object: G.sys.buildings?.get?.('B_GOTGAN') || undefined, radius: 2.9, priority: 0.2,
          enabled: () => !!G.state && this._ready, onInteract: () => storage.open(),
        });
      }
    },
    _groundY(def) {
      const g = G.sys.buildings?.get?.('B_RTGARDEN');
      if (g && Number.isFinite(g.position.y)) return g.position.y;
      const y = G.world?.terrainHeight?.(def.x, def.z);
      return Number.isFinite(y) ? y : 0;
    },
    _labelPos(bedId) { const V = this._vis.get(bedId); return V ? { x: V.cx, y: V.soilY + 1.25, z: V.cz } : { x: 0, y: 1, z: 0 }; },
    _registerBed(V) {
      if (!G.interact?.register) return;
      const id = V.def.id;
      const self = this;
      const act = () => {
        const cur = self.bed(id);
        if (!cur || !cur.bed) return { label: '씨앗 심기', emoji: '🌱' };
        if (cur.status === 'ready') return { label: '수확하기', emoji: cur.crop?.icon || '🧺' };
        return { label: '살펴보기', emoji: '👀' };
      };
      G.interact.register({
        id: `RTBED_${id}`, kind: 'rtbed',
        label: () => act().label, kidLabel: () => act().label, emoji: () => act().emoji,
        position: new THREE.Vector3(V.cx, V.soilY, V.cz), object: V.proxy || V.root, handOffset: 1.45,
        radius: Math.max(V.def.w, V.def.d) / 2 + 1.5, priority: 0.1,
        enabled: () => !!G.state && self._ready,
        onInteract: () => {
          const cur = self.bed(id);
          if (cur && cur.status === 'ready') { if (!self.harvest(id)) self.open(id); return; }
          self.open(id);
        },
      });
    },
    _buildLabel(V) {
      if (!G.ui?.label) return;
      const el = document.createElement('div');
      el.className = 'rf-label';
      const num = document.createElement('span'); num.className = 'rf-num'; num.textContent = bedNo(V.def.id);
      const ico = document.createElement('span'); ico.className = 'rf-l-ico emoji'; ico.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span'); txt.className = 'rf-l-txt';
      el.append(num, ico, txt);
      V.els = { el, ico, txt, last: {} };
      V.label = G.ui.label({ el, target: V.labelPos, maxDist: 46, fadeDist: 8, onClick: (ev) => { ev.stopPropagation(); this.open(V.def.id); } });
      V.label.setVisible(false);
    },
    /** label text per bed: "① 박하 · 12:34 남음" / "다 자랐어요! 🎉" / "빈 밭 · 씨앗 심어요" */
    labelText(id) {
      const cur = this.bed(id);
      if (!cur) return '';
      if (!cur.bed) return '빈 밭 · 씨앗 심어요';
      if (cur.status === 'ready') return '다 자랐어요! 🎉';
      return `${cur.crop?.name || '작물'} · ${clock(cur.leftMs)} 남음`;
    },
    _refreshLabels() {
      for (const V of this._vis.values()) {
        const E = V.els;
        if (!E || !V.label) continue;
        if (!G.state || !this._ready) { V.label.setVisible(false); continue; }
        if (!V.label.visible) V.label.setVisible(true);
        const cur = this.bed(V.def.id);
        const cls = !cur.bed ? 'is-empty' : cur.status === 'ready' ? 'is-ready' : 'is-growing';
        if (E.last.cls !== cls) { E.el.classList.remove('is-empty', 'is-ready', 'is-growing'); E.el.classList.add(cls); E.last.cls = cls; }
        const t = this.labelText(V.def.id);
        if (E.last.t !== t) { E.last.t = t; E.txt.textContent = t; }
        const ic = cur.bed ? (cur.status === 'ready' ? cur.crop?.icon || '🎉' : this._stagePic(cur)) : '🌱';
        if (E.last.ic !== ic) { E.last.ic = ic; E.ico.textContent = ic; }
      }
    },
    _stagePic(cur) { const g = cur.progress * 100; return g >= 100 ? cur.crop?.icon || '🌾' : g >= 80 ? '🌾' : g >= 50 ? '🌿' : '🌱'; },

    /** crop meshes follow the planting: rebuilt when the crop changes, re-laid when the stage (1 %) changes */
    _syncAll() {
      if (!G.state) return;
      for (const V of this._vis.values()) {
        const cur = this.bed(V.def.id);
        const modelId = cur.bed && cur.crop ? cur.crop.model : null;
        if (modelId !== V.modelId) this._rebuild(V, modelId);
        const g = cur.bed ? cur.progress * 100 : 0;
        const key = `${modelId}|${Math.floor(g)}|${cur.status}`;
        if (V.key !== key) { V.key = key; V.g = g; V.ready = cur.status === 'ready'; this._layout(V); }
      }
    },
    _rebuild(V, modelId) {
      for (const k of Object.keys(V.meshes)) { const m = V.meshes[k]; if (m) { V.root.remove(m); m.dispose?.(); } }
      V.meshes = {}; V.plants = []; V.model = null; V.modelId = modelId || null;
      const kit = G.cropKit;
      if (!modelId || !kit) return;
      const def = kit.models?.[modelId];
      const geo = kit.geo?.(modelId);
      if (!def || !geo) return;
      V.model = def;
      const w = V.def.w - 0.7, d = V.def.d - 0.6;
      const nx = Math.max(2, Math.round(w / 1.05)), nz = Math.max(2, Math.round(d / 0.95));
      const r = U.rng('rtbed:' + V.def.id + ':' + modelId);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = (-(nx - 1) / 2 + i) * (w / Math.max(1, nx - 1)) * 0.92 + (r() - 0.5) * 0.12;
        const z = (-(nz - 1) / 2 + j) * (d / Math.max(1, nz - 1)) * 0.9 + (r() - 0.5) * 0.1;
        V.root.localToWorld(_v.set(x, 0, z));
        V.plants.push({ x, z, ry: r() * Math.PI * 2, s: 0.86 + r() * 0.22, tilt: (r() - 0.5) * 0.1, wx: _v.x, wz: _v.z });
      }
      const n = V.plants.length;
      const shadows = !!G.sys.engine?.preset?.shadows;
      const mk = (g, mat, cast, name) => {
        const im = new THREE.InstancedMesh(g, mat, n);
        im.name = name;
        im.castShadow = cast && shadows;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) im.setColorAt(i, WHITE);
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (def.height || 1) * 0.5, 0), Math.hypot(V.def.w, V.def.d) / 2 + (def.height || 1) * 1.2);
        im.frustumCulled = true;
        im.raycast = () => {};
        V.root.add(im);
        return im;
      };
      V.meshes.mound = mk(kit.mound(), kit.moundMat(), false, 'rt-mounds');
      V.meshes.sprout = mk(kit.sprout(), kit.foliageMat(), false, 'rt-sprouts');
      V.meshes.body = mk(geo.body, kit.foliageMat(), true, 'rt-body');
      if (geo.fruit) V.meshes.fruit = mk(geo.fruit, def.fruitMat === 'foliage' ? kit.foliageMat() : kit.fruitMat(), true, 'rt-fruit');
    },
    /** instance matrices for the displayed growth (same stage rules as the quick plots) */
    _layout(V) {
      const M = V.meshes, n = V.plants.length;
      if (!M.mound || !n) { V.labelPos.set(V.cx, V.soilY + 0.95, V.cz); return; }
      const def = V.model || {};
      const g = V.g || 0;
      const sproutOn = g >= 20 && g < 50, bodyOn = g >= 50, fruitOn = g >= 80 && !!M.fruit;
      const sproutS = sproutOn ? lerp(0.9, 2.1, (g - 20) / 30) : 0;
      const bodyS = !bodyOn ? 0 : g < 80 ? lerp(0.4, 0.8, (g - 50) / 30) : lerp(0.8, 1.0, Math.min(1, (g - 80) / 20));
      const fruitS = !fruitOn ? 0 : g >= 100 ? 1 : lerp(0.35, 0.82, (g - 80) / 20);
      const ripe = g >= 100 ? 1 : fruitOn ? Math.pow((g - 80) / 20, 2) * 0.55 : 0;
      const msc = def.scale || 1;
      const cropC = core.crop(this._st().beds[V.def.id]?.cropId || '')?.fruit || '#ffffff';
      if (def.fruitTint === 'white') _col.set(def.unripe || '#dddddd').lerp(_col2.set(def.ripe || '#ffffff'), ripe);
      else _col.set(def.unripe || '#88bb66').lerp(_col2.set(cropC), ripe);
      M.mound.visible = true; M.sprout.visible = sproutOn; M.body.visible = bodyOn; if (M.fruit) M.fruit.visible = fruitOn;
      for (let i = 0; i < n; i++) {
        const pl = V.plants[i];
        _e.set(0, pl.ry, 0); _q.setFromEuler(_e); _v.set(pl.x, 0, pl.z);
        const ms = g < 20 ? 1 : 1.15;
        _s.set(ms * pl.s, ms, ms * pl.s); _m4.compose(_v, _q, _s); M.mound.setMatrixAt(i, _m4);
        if (sproutOn) { _s.setScalar(sproutS * pl.s); _m4.compose(_v, _q, _s); M.sprout.setMatrixAt(i, _m4); }
        if (bodyOn) {
          _e.set(pl.tilt, pl.ry, pl.tilt * 0.5); _q.setFromEuler(_e);
          const bs = bodyS * pl.s * msc;
          _s.set(bs, bs, bs); _m4.compose(_v, _q, _s); M.body.setMatrixAt(i, _m4);
          if (fruitOn) { _s.multiplyScalar(lerp(0.9, 1, fruitS)); _m4.compose(_v, _q, _s); M.fruit.setMatrixAt(i, _m4); M.fruit.setColorAt(i, _col); }
        }
      }
      for (const k of ['mound', 'sprout', 'body', 'fruit']) { const m = M[k]; if (!m) continue; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      const top = bodyOn ? (def.height || 0.6) * bodyS * msc : sproutOn ? 0.15 : 0.08;
      V.labelPos.set(V.cx, V.soilY + Math.max(0.95, top + 0.6), V.cz);
    },
    /** soft golden glints over ready beds (pooled G.ffx particles, 2.5 per second per bed, none with reduce motion) */
    _sparkle(dt) {
      const FX = G.ffx;
      if (!FX?.spawn || reduced()) return;
      const cam = G.sys.engine?.camera;
      if (!cam) return;
      _cam.copy(cam.position);
      for (const V of this._vis.values()) {
        if (!V.ready || !V.plants.length) continue;
        if (Math.hypot(_cam.x - V.cx, _cam.z - V.cz) > 50) continue;
        V.spark += dt * 2.5; // 2.5 glints a second per bed: soft, well under 3 Hz
        while (V.spark >= 1) {
          V.spark -= 1;
          const pl = V.plants[(Math.random() * V.plants.length) | 0];
          const hgt = V.model ? (V.model.height || 0.5) * pl.s * (V.model.scale || 1) : 0.4;
          FX.spawn(FX.P.GLINT, pl.wx + (Math.random() - 0.5) * 0.4, V.soilY + hgt * (0.5 + Math.random() * 0.6), pl.wz + (Math.random() - 0.5) * 0.4, 0, 0.15, 0);
        }
      }
    },
    _fxAt(bedId, what, crop) {
      const V = this._vis.get(bedId);
      const FX = G.ffx;
      if (!V || !FX?.burst) return;
      const pl = G.sys.player;
      pl?.faceTowards?.(V.cx, V.cz);
      if (what === 'harvest') pl?.playAction?.('harvest');
      else if (what === 'plant' || what === 'clear') pl?.playAction?.('interact', { duration: 0.9 });
      const y = V.soilY;
      if (what === 'plant') { FX.burst(FX.P.DUST, V.cx, y + 0.05, V.cz, 14, 1.0, 0.9); FX.burst(FX.P.SPARK, V.cx, y + 0.2, V.cz, 6, 0.6, 0.8); }
      else if (what === 'water') { for (let i = 0; i < 14; i++) FX.spawn(FX.P.DROP, V.cx + (Math.random() - 0.5) * V.def.w * 0.7, y + 1.4, V.cz + (Math.random() - 0.5) * V.def.d * 0.7, 0, -1.5, 0, null, y); }
      else if (what === 'harvest') {
        const c = new THREE.Color(crop?.fruit || '#ffd25a');
        setTimeout(() => { FX.burst(FX.P.LEAF, V.cx, y + 0.25, V.cz, 14, 1.8, 2.4, null, y); FX.burst(FX.P.POP, V.cx, y + 0.3, V.cz, 7, 1.6, 2.2, c); FX.burst(FX.P.SPARK, V.cx, y + 0.5, V.cz, 18, 1.6, 1.8); }, 450);
      } else if (what === 'clear') { FX.burst(FX.P.DUST, V.cx, y + 0.05, V.cz, 12, 1.0, 0.8); FX.burst(FX.P.LEAF, V.cx, y + 0.2, V.cz, 10, 1.2, 1.5, null, y); }
    },
  };

  G.register(realfarm);
  G.register(storage);
})();
