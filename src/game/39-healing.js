// =============================================================================
// 39-healing.js — the visit to the 힐링관 (G.sys.healing, order 66; CONTRACT §19.6, lane heal-program).
// Data: 38-healing-data.js (G.data.healing). Activities: 79-healing-acts.js (G.healActs). House: 69-healing-hall.js
// (lane heal-hall: B_HEAL, PL_HEAL + nested rooms, G.healStations.set(…), G.healHall { door(room, state), corridor() }).
//
//   G.sys.healing
//     visit (read-only) · step() -> 'book' | 'checkin' | 'stay' | 'change' | 'counsel' | 'rooms' | 'report' | 'checkout' | 'out'
//     book() · checkIn() · stow() -> n · change() · counsel({mood, ache, sleep, wish}) · checkout()   the road (each
//         returns true / a value, never throws; a step done before its turn simply fills the missing ones gently)
//     start(roomId, {acts = true}) -> { ok, why? }   a course of the room's real minutes (÷ healing.time_scale)
//     stop(roomId?)            stops a course for today (the share already rested is kept)
//     little(roomId)           one small thing during the rest (a tiny lift of the numbers, bounded)
//     running() -> [{ room, at, end, left, p }]      roomState(id) -> 'closed' | 'idle' | 'next' | 'run' | 'done'
//     numbers() -> { stress, fatigue, vital, calm, warm, stamina }   (0 – 100 play values, here or away)
//     plan() -> suggested order · openRooms() · scale() · now()
//     openMap() / openRoom(id) / openReport() / openDesk() / openKiosk() / openStay() / openCounsel()   the screens
//     go(roomOrKey) -> Promise<bool>   walk / travel to a room's door or a lobby station (a tap on the map)
//     local() -> { portrait?, style?, cards?, text?, three?, v? }   what stays on THIS device (never in a save)
//     setLocal(patch)
//     debug   test seam: setNow(ms | null) · advance(ms) · scale(k | null) · finish(roomId | 'all') · info() · testPlace()
//   Events: healing:book · healing:checkin · healing:stow {n} · healing:change · healing:counsel {base} ·
//           healing:start {room, at, end} · healing:stop {room} · healing:done {room} · healing:report · healing:checkout ·
//           healing:changed (anything — the HUD and the map redraw)
//
// Real time (§19.0, §17.5): course = { at, end = at + minutes × 60 000 / scale } on G.time.now() (server-synced). The
// numbers follow each room's curve as the minutes pass; a course ends on its own (here, elsewhere, or offline: it is
// stamped on the next tick after a reload), and a 🔔 notice says so. One course at a time unless healing.overlap.
// Stations: G.healStations (see 38-healing-data.js) — the hall sets them while a place is built; this system puts its
// interactables, the keeper and the moving things there and drops them when the place goes. Without the hall a plain
// test room (PL_HEAL_T, the 🌿 menu tile / debug.testPlace()) carries every station.
// Never blocked: every screen has ⬅️ / ✖; a course runs on without the visitor; a step out of order is filled in gently;
// no number has a value at which anything stops; leaving at any moment keeps everything.
// No claims: one calm line (words.claim) at the desk and on the report; 오늘의 쉼 안내, never a prescription.
// =============================================================================
(function () {
  const D = G.data.healing;
  if (!D) { G.log.warn('HEAL', '38-healing-data.js missing — no 힐링관'); return; }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const isMap = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const h = (...a) => G.ui.h(...a);
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const reduced = () => !!(G.settings && G.settings.reduceMotion) || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const site = (k, d) => { try { const v = G.site?.get?.(k, d); return v == null ? d : v; } catch (e) { return d; } };
  const say = (t) => { try { if (easyOn() && t) G.easy?.say?.(t); } catch (e) { /* voice optional */ } };
  const sfx = (n, o) => { try { G.sys.audio?.play?.(n, o); } catch (e) { /* audio optional */ } };
  const toast = (t, o) => { try { G.ui.toast(t, o || {}); } catch (e) { /* ui optional */ } };
  const MIN = 60000;
  const TEST_PLACE = 'PL_HEAL_T';
  const ROOM_OF_PLACE = {};
  for (const [k, p] of Object.entries(D.places)) ROOM_OF_PLACE[p] = k;
  const roomName = (id) => { const R = D.rooms[id]; if (!R) return ''; const g = id === 'R10' && gentleOn() && R.gentle; return `제${R.no}관 ${g ? R.gentle.name : R.name}`; };
  const roomEmoji = (id) => { const R = D.rooms[id]; return R ? (id === 'R10' && gentleOn() && R.gentle ? R.gentle.emoji : R.emoji) : '🌿'; };
  const clock = (ms) => { const d = new Date(ms + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const minsLeft = (ms) => Math.max(0, Math.ceil(ms / MIN));

  // ---------------------------------------------------------------- the clock (server-synced) + the debug seam
  const dbg = { now: null, offset: 0, scale: null };
  const now = () => (dbg.now != null ? dbg.now : (G.time && typeof G.time.now === 'function' ? G.time.now() : Date.now()) + dbg.offset);
  const scale = () => (dbg.scale != null ? clamp(dbg.scale, 1, 100000) : clamp(Math.round(Number(site('healing.time_scale', 1)) || 1), 1, D.scaleMax));
  const courseMs = (id) => { const R = D.rooms[id]; return R ? Math.max(1000, Math.round(R.min * MIN / scale())) : 0; };

  // ---------------------------------------------------------------- operator settings
  const enabled = () => site('healing.enabled', true) !== false;
  const overlap = () => site('healing.overlap', false) === true;
  const room10 = () => { const v = site('healing.room10', 'gate'); return v === 'gentle' || v === 'off' ? v : 'gate'; };
  function openRooms() {
    let list = site('healing.rooms', null);
    list = Array.isArray(list) ? list.filter((x) => D.rooms[x]) : D.order.slice();
    if (!list.length) list = D.order.slice();
    if (room10() === 'off') list = list.filter((x) => x !== 'R10');
    return D.order.filter((x) => list.includes(x));
  }
  /** room 10 in its gentle version? easy mode always (unless a grown-up opened the full one for this visit); 'gentle' everywhere for children */
  function gentleOn() {
    const v = vis();
    if (room10() === 'gentle') return true;
    if (v && v.r10) return v.r10 === 'gentle';
    return easyOn();
  }
  /** for the hall (69-healing-hall.js): true = the full sequence is open (the coffin shows), false = gentle, null = not decided */
  function room10Full() { if (room10() === 'gentle') return false; const v = vis(); return v && v.r10 ? v.r10 === 'full' : null; }
  function setR10(kind) { const v = vis(); if (!v) return; v.r10 = kind; try { G.healHall?.setRoom10?.(kind === 'full'); } catch (e) { /* hall optional */ } save(); }

  // ---------------------------------------------------------------- state (G.state.healing)
  function st() {
    const s = G.state;
    if (!s) return null;
    if (!isMap(s.healing) || s.healing.v !== 1) s.healing = D.sanitize(s.healing);
    return s.healing;
  }
  const vis = () => { const s = st(); return s && s.visit && !s.visit.out ? s.visit : null; };
  const save = () => { try { G.save?.markDirty?.('healing'); } catch (e) { /* optional */ } changed(); };
  let changedAt = 0;
  function changed() { changedAt = performance.now(); try { G.bus.emit('healing:changed', {}); } catch (e) { /* bus optional */ } }

  // ---------------------------------------------------------------- what stays on this device (the letter, the portrait)
  const lsKey = () => `tfm.v1.heal.${String(G.state?.profile?.id || G.auth?.current?.id || 'guest').replace(/[^\w-]/g, '').slice(0, 40)}`;
  function local() {
    try { const o = JSON.parse(localStorage.getItem(lsKey()) || '{}'); return isMap(o) ? o : {}; } catch (e) { return {}; }
  }
  function setLocal(patch) {
    const v = vis(); const cur = local();
    const next = Object.assign({}, cur.visit === (v && v.id) ? cur : {}, patch, { visit: v ? v.id : cur.visit || '' });
    if (typeof next.text === 'string') next.text = next.text.slice(0, 300);
    if (typeof next.portrait === 'string' && (next.portrait.length > 200000 || !/^data:image\/(jpeg|png|webp);base64,/.test(next.portrait))) delete next.portrait;
    try { localStorage.setItem(lsKey(), JSON.stringify(next)); return true; } catch (e) { G.log.warn('HEAL', 'device store full — the portrait is kept for this session only'); return false; }
  }

  // ---------------------------------------------------------------- the road
  function playInfo() {
    const s = G.state || {};
    const stats = s.stats || {};
    const cook = s.cooking && isMap(s.cooking.book) ? s.cooking.book : {};
    const kinds = G.data.cooking?.dishes || {};
    let jang = 0, field = 0, dishes = 0;
    for (const [id, b] of Object.entries(cook)) { const n = Number(b && b.n) || 0; dishes += n; const k = kinds[id]?.kind; if (k === 'jang') jang += n; if (k === 'field') field += n; }
    const jars = s.jars && typeof s.jars === 'object' ? Object.keys(s.jars).length : 0;
    return { level: Number(s.profile?.level) || 1, minutes: Math.round((Number(stats.playTime) || 0) / 60) % 600, dishes, jang, field, jars };
  }
  function book() {
    const s = st(); if (!s) return null;
    if (vis()) return vis();
    const t = now();
    s.visit = D.sanitize({ visit: { id: 'H' + Math.floor(t).toString(36), at: t } }).visit;
    G.bus.emit('healing:book', { id: s.visit.id }); save();
    notify('book', '🌿 힐링관 예약', '안내데스크에서 체크인해요. 손목 밴드를 받아요.');
    return s.visit;
  }
  function ensure(stepName) {
    // a step reached out of order: fill the earlier ones gently (never a dead end, nothing lost)
    let v = vis() || book();
    if (!v) return null;
    const order = ['checkin', 'stay', 'change', 'counsel'];
    const want = order.indexOf(stepName);
    if (want > 0 && !v.band) v.band = now();
    if (want > 1 && v.stow < D.words.bundle.length) v.stow = D.words.bundle.length;
    if (want > 2 && !v.changed) wearOutfit(v);
    return v;
  }
  function checkIn() { const v = ensure('checkin'); if (!v) return false; if (!v.band) { v.band = now(); sfx('bell'); G.bus.emit('healing:checkin', {}); save(); } return true; }
  function stow() { const v = ensure('stay'); if (!v) return 0; if (v.stow < D.words.bundle.length) { v.stow++; sfx('click'); G.bus.emit('healing:stow', { n: v.stow }); save(); } return v.stow; }
  /** the lent 힐링복: the free kit's 저고리 and 바지 (no piece that must be owned — lane wardrobe judges the worn look) in
   *  plain white, everything over it taken off; the keys are read from the avatar table at runtime (lane hanbok) */
  function outfitOf(app) {
    const A = G.data.avatar || {}, O = A.options || {}, base = Object.assign({}, A.defaults || {}, app || {});
    const has = (k, v) => Array.isArray(O[k]) && O[k].includes(v);
    const pick = (k, ...vs) => { for (const v of vs) if (has(k, v)) { base[k] = v; return; } };
    pick('top', 'hanbok'); pick('bottom', 'pants'); pick('footwear', 'gomusin');
    for (const k of ['outer', 'hat', 'norigae', 'pouch', 'fan', 'ribbon', 'belt', 'bag', 'accessory']) pick(k, 'none');
    pick('topColor', '#ffffff', '#f5f0e6', '#f1ece1'); pick('bottomColor', '#f5f0e6', '#e9e4da', '#f1ece1', '#ffffff');
    pick('trimColor', '#9bbf6a', '#6d8f4e', '#2f7d4a'); pick('pattern', 'none'); pick('shoes', '#f5f0e6', '#ffffff');
    return base;
  }
  function currentLook() { return G.state?.profile?.avatar || G.sys.player?.rig?.appearance || null; }
  function wearOutfit(v) {
    const cur = currentLook();
    if (cur && isMap(cur) && !v.wear) { const w = {}; let n = 0; for (const [k, x] of Object.entries(cur)) { if (n >= D.limits.wearKeys) break; if ((typeof x === 'string' && x.length <= 16) || (fin(x) && x >= 0 && x <= 10)) { w[k] = x; n++; } } v.wear = w; }
    try { G.sys.player?.setAppearance?.(outfitOf(cur)); } catch (e) { G.log.warn('HEAL', 'outfit not applied', e?.message || e); }
    v.changed = now();
  }
  function change() { const v = ensure('change'); if (!v) return false; if (!v.changed) { wearOutfit(v); sfx('reward'); G.bus.emit('healing:change', {}); save(); } return true; }
  function counsel(a) {
    const v = ensure('counsel'); if (!v) return null;
    const ask = {}; for (const q of D.ask) { const n = Number(a && a[q.id]); ask[q.id] = fin(n) ? clamp(Math.round(n), 0, 3) : 1; }
    v.ask = ask; v.base = D.base(ask, playInfo());
    G.bus.emit('healing:counsel', { base: v.base }); save();
    return v.base;
  }
  function plan() { const v = vis(); const open = openRooms(); return D.plan(v && v.ask).filter((x) => open.includes(x)); }

  // ---------------------------------------------------------------- courses (real time)
  function running() {
    const v = vis(); if (!v) return [];
    const t = now(), out = [];
    for (const id of D.order) { const c = v.rooms[id]; if (c && !c.done && !c.stop && c.end > 0) out.push({ room: id, at: c.at, end: c.end, left: Math.max(0, c.end - t), p: D.progress(c, t) }); }
    return out;
  }
  function roomState(id) {
    if (!openRooms().includes(id)) return 'closed';
    const v = vis(); const c = v && v.rooms[id];
    if (c && c.done) return 'done';
    if (c && !c.stop && c.end > 0) return 'run';
    const next = plan().find((x) => !(v && v.rooms[x] && v.rooms[x].done));
    return next === id ? 'next' : 'idle';
  }
  function start(id, o) {
    o = o || {};
    if (!D.rooms[id]) return { ok: false, why: 'room' };
    if (!enabled()) return { ok: false, why: 'off' };
    if (!openRooms().includes(id)) return { ok: false, why: 'closed' };
    let v = vis();
    if (!v || !v.base) { v = ensure('counsel'); if (v && !v.base) counsel({}); v = vis(); }
    if (!v) return { ok: false, why: 'state' };
    const c = v.rooms[id];
    if (c && c.done) { if (o.acts !== false) G.healActs?.open?.(id, { again: true }); return { ok: true, again: true }; }
    if (c && !c.stop && c.end > 0) { if (o.acts !== false) G.healActs?.open?.(id, {}); return { ok: true, running: true }; }
    const others = running().filter((r) => r.room !== id);
    if (others.length && !overlap() && !o.force) return { ok: false, why: 'busy', busy: others.map((r) => r.room) };
    if (others.length && !overlap()) for (const r of others) stop(r.room);
    const t = now();
    D.startCourse(v, id, t, dbg.scale != null ? dbg.scale : scale());
    G.bus.emit('healing:start', { room: id, at: t, end: v.rooms[id].end });
    try { G.healHall?.door?.(id, 'run'); } catch (e) { /* hall optional */ }
    sfx('bell'); save();
    if (o.acts !== false) G.healActs?.open?.(id, {});
    return { ok: true };
  }
  function stop(id) {
    const v = vis(); if (!v) return false;
    const ids = id ? [id] : running().map((r) => r.room);
    let any = false;
    for (const rid of ids) {
      const c = v.rooms[rid]; if (!c || c.done || c.stop) continue;
      const share = D.curve(D.rooms[rid].curve, D.progress(c, now()));
      c.stop = Math.max(0.001, Math.round(share * 1000) / 1000); any = true;
      G.bus.emit('healing:stop', { room: rid });
      try { G.healHall?.door?.(rid, 'idle'); } catch (e) { /* hall optional */ }
    }
    if (any) { G.healActs?.close?.('stop'); save(); }
    return any;
  }
  function little(id) {
    const v = vis(); const c = v && v.rooms[id]; if (!c) return false;
    c.small = Math.min(D.limits.small, (c.small || 0) + 1); sfx('tap'); save(); return true;
  }
  function stepOf(id, n) { const v = vis(); const c = v && v.rooms[id]; if (!c) return; c.step = clamp(n | 0, 0, 20); save(); }
  /** stamps finished courses (also those that ended while away) */
  function tick() {
    const v = vis(); if (!v) return;
    const t = now();
    let any = false;
    for (const id of D.due(v, t)) {
      const c = v.rooms[id];
      c.done = c.end; any = true;
      const s = st(); s.stamps = Math.min(D.limits.visits * 10, (s.stamps || 0) + 1);
      G.bus.emit('healing:done', { room: id });
      try { G.healHall?.door?.(id, 'done'); } catch (e) { /* hall optional */ }
      notify('done:' + id, `${roomEmoji(id)} ${roomName(id)} 도장 쾅!`, D.rooms[id].says.end + ' 지도에서 다음 관을 볼 수 있어요.');
      if (G.healActs?.current === id) G.healActs?.ended?.(id);
      sfx('achievement');
    }
    if (any) { save(); if (D.nextStep(v, openRooms()) === 'report') notify('report', '🌿 종합 리포트가 나왔어요', '열 개의 관을 모두 돌았어요. 리포트를 열어 봐요.'); }
  }
  function numbers() { const v = vis(); return v ? D.numbers(v, now()) : null; }
  function notify(key, title, text) {
    try { G.sys.engagement?.notify?.({ type: 'system', icon: '🌿', title, text, act: 'healing', key: 'heal:' + key + ':' + (vis()?.id || '') }); } catch (e) { /* inbox optional */ }
  }

  // ---------------------------------------------------------------- report + check-out
  function reportData() {
    const v = vis() || st()?.visit; if (!v) return null;
    const t = now();
    const after = D.numbers(v, t), before = v.base || D.base({}, {});
    const seed = parseInt(String(v.id).slice(1, 7), 36) || 7;
    const first = v.r1 || D.measure(before, seed, playInfo());
    const last = D.measure(after, seed, playInfo());
    let rested = 0, stamps = 0;
    for (const id of D.order) { const c = v.rooms[id]; if (!c) continue; if (c.done) { stamps++; rested += (c.done - c.at); } else rested += Math.max(0, Math.min(t, c.end) - c.at) * (c.stop ? 0 : 1); }
    return { v, before, after, first, last, rested: Math.round(rested / MIN), stamps, rooms: openRooms(), r9: v.r9 || { plates: 0, drums: 0, cans: 0, bottles: 0 }, local: local() };
  }
  function checkout() {
    const s = st(); const v = vis(); if (!s || !v) return false;
    const r = reportData();
    const t = now();
    if (v.wear) { try { G.sys.player?.setAppearance?.(Object.assign({}, G.data.avatar?.defaults || {}, v.wear)); } catch (e) { G.log.warn('HEAL', 'outfit not restored', e?.message || e); } }
    v.out = t; s.visits = Math.min(D.limits.visits, (s.visits || 0) + 1);
    if (r) s.last = { at: t, before: r.before, after: r.after };
    G.bus.emit('healing:checkout', {}); save();
    sfx('reward');
    toast('🌿 체크아웃했어요. 원래 옷으로 갈아입었어요. 또 쉬러 와요!', { emoji: '🌿' });
    return true;
  }

  // ---------------------------------------------------------------- stations → interactables (+ the keeper)
  const handles = new Map();     // 'ROOM:key' → interact handle
  const worldOf = (at, out) => {
    if (!at) return null;
    out = out || new THREE.Vector3();
    if (at.isObject3D) { if (!at.parent) return null; at.updateWorldMatrix?.(true, false); return at.getWorldPosition(out); }
    if (!fin(at.x) || !fin(at.z)) return null;
    // a plain point near the origin is LOCAL to the place it belongs to (places live near z = 2000, far from 0)
    if (Math.abs(at.x) < 400 && Math.abs(at.z) < 400) {
      const pid = placeOfRoom(curRoomKey(at)) || G.sys.places?.current;
      const w = pid && G.sys.places?.toWorld?.(pid, at.x, at.z);
      if (w) return out.set(w.x, fin(at.y) ? at.y : 0, w.z);
    }
    return out.set(at.x, fin(at.y) ? at.y : 0, at.z);
  };
  let _keyHint = null;
  const curRoomKey = () => _keyHint;
  const placeOfRoom = (room) => (G.sys.places?.def?.(D.places[room]) ? D.places[room] : (G.sys.places?.def?.(TEST_PLACE) ? TEST_PLACE : null));
  function stationPos(room, key) {
    const at = G.healStations.get(room, key);
    _keyHint = room;
    const p = worldOf(at);
    _keyHint = null;
    return p;
  }
  /** which stations get an interactable of this system (the rest belong to the activities) */
  const STATION_ACT = {
    LOBBY: { kiosk: 'kiosk', desk: 'desk', bench: 'map' }, STAY: { shelf: 'stay', rail: 'stay', bed: 'stay' }, TALK: { manager: 'counsel', seat: 'counsel' },
  };
  for (const id of D.order) STATION_ACT[id] = { spot: 'room', guide: 'room' };
  function interactFor(room, key, kind) {
    const hk = room + ':' + key;
    const old = handles.get(hk); if (old) { try { old.unregister(); } catch (e) { /* gone */ } handles.delete(hk); }
    if (!G.interact?.register) return;
    const at = G.healStations.get(room, key); if (!at) return;
    const labels = {
      kiosk: ['🖥️ 힐링관 예약 키오스크', '예약해요', '🖥️'], desk: ['🛎️ 안내데스크 · 체크인', '체크인해요', '🛎️'], map: ['🗺️ 복도 지도 보기', '지도를 봐요', '🗺️'],
      stay: ['🧺 숙소 · 짐 정리와 옷 갈아입기', '짐 정리해요', '🧺'], counsel: ['💬 담당 매니저와 상담', '상담해요', '💬'],
    };
    const lab = kind === 'room' ? null : labels[kind];
    const fn = () => {
      if (kind === 'kiosk') return openKiosk();
      if (kind === 'desk') return openDesk();
      if (kind === 'map') return openMap();
      if (kind === 'stay') return openStay();
      if (kind === 'counsel') return openCounsel();
      return openRoom(room);
    };
    if (kind === 'room' && key === 'guide' && G.healStations.get(room, 'spot')) return; // one interactable per room: the spot
    if (kind === 'room' && key === 'spot') { const gh = handles.get(room + ':guide'); if (gh) { try { gh.unregister(); } catch (e) { /* gone */ } handles.delete(room + ':guide'); } }
    try {
      const reg = G.interact.register({
        id: 'heal:' + hk, kind: 'kiosk',
        label: () => (lab ? lab[0] : `${roomEmoji(room)} ${roomName(room)} · ${roomLine(room)}`),
        kidLabel: () => (lab ? lab[1] : roomKid(room)), emoji: () => (lab ? lab[2] : roomEmoji(room)),
        position: () => stationPos(room, key) || new THREE.Vector3(0, -9999, 0),
        object: at.isObject3D ? at : undefined, radius: kind === 'room' ? 3.2 : 2.8, priority: 2,
        enabled: () => { const pid = placeOfRoom(room); return !!pid && G.sys.places?.current === pid && !!stationPos(room, key); },
        onInteract: fn,
      });
      handles.set(hk, reg);
    } catch (e) { G.log.warn('HEAL', 'station interactable failed', hk, e?.message || e); }
  }
  function onStation(p) {
    if (!p || !STATION_ACT[p.room]) return;
    const kind = STATION_ACT[p.room][p.key];
    if (kind) interactFor(p.room, p.key, kind);
    G.healActs?.station?.(p.room, p.key);
    if (p.key === 'guide') keeperSync();
  }
  function roomLine(id) {
    const s = roomState(id);
    const c = vis()?.rooms?.[id];
    if (s === 'run' && c) return `${minsLeft(c.end - now())}분 남음`;
    if (s === 'done') return '도장 받음 · 다시 쉬기';
    if (s === 'closed') return '오늘은 쉬어요';
    return `${D.rooms[id].min}분 코스 시작하기`;
  }
  function roomKid(id) { const s = roomState(id); if (s === 'run') return '쉬는 중이에요'; if (s === 'done') return '도장 받았어요'; const R = D.rooms[id]; return id === 'R10' && gentleOn() && R.gentle ? R.gentle.kid : R.kid; }

  // the keeper: ONE figure in a hanbok work look, moved to the guide station of the room the visitor is in
  let keeper = null, keeperRoom = null;
  function keeperLook(room) {
    const A = G.data.avatar || {}, O = A.options || {};
    const base = Object.assign({}, A.defaults || {});
    const set = (k, v) => { if (Array.isArray(O[k]) && O[k].includes(v)) base[k] = v; };
    const female = (room && room.charCodeAt(room.length - 1) % 2 === 0);
    set('hair', female ? 'jjok' : 'short'); set('top', 'hanbok'); set('topColor', room === 'R9' ? '#e8d9b5' : '#2f7d4a'); set('outerColor', '#2e3f6e');
    set('bottom', female ? 'skirt' : 'pants'); set('bottomColor', '#2e3f6e'); set('footwear', 'gomusin'); set('face', 'gentle');
    return base;
  }
  function keeperSync() {
    const pid = G.sys.places?.current; const room = pid ? (ROOM_OF_PLACE[pid] || (pid === TEST_PLACE ? nearestRoom() : null)) : null;
    const at = room ? stationPos(room, 'guide') || stationPos(room, 'manager') || stationPos(room, 'desk') : null;
    if (!at || !G.avatar?.create) { if (keeper) keeper.group.visible = false; keeperRoom = null; return; }
    if (!keeper) {
      try { keeper = G.avatar.create(keeperLook(room), { shadow: !(G.sys.engine?.quality === 'low') }); keeper.group.name = 'heal-keeper'; G.sys.engine?.scene?.add?.(keeper.group); } catch (e) { G.log.warn('HEAL', 'keeper not made', e?.message || e); keeper = null; return; }
    } else if (keeperRoom !== room) { try { keeper.setAppearance?.(keeperLook(room)); } catch (e) { /* look optional */ } }
    keeperRoom = room;
    keeper.group.visible = true;
    keeper.group.position.set(at.x, at.y || 0, at.z);
    const pp = G.sys.player?.position;
    if (pp) keeper.group.rotation.y = Math.atan2(pp.x - at.x, pp.z - at.z);
  }
  function nearestRoom() {
    const pp = G.sys.player?.position; if (!pp) return null;
    let best = null, bd = 1e9;
    for (const room of Object.keys(D.stationKeys)) { const p = stationPos(room, 'guide') || stationPos(room, 'spot'); if (!p) continue; const d = (p.x - pp.x) ** 2 + (p.z - pp.z) ** 2; if (d < bd) { bd = d; best = room; } }
    return best;
  }
  /** the room (station room key) the visitor stands in: the nested place, or the nearest section of the test room */
  function hereRoom() { const pid = G.sys.places?.current; if (!pid) return null; return ROOM_OF_PLACE[pid] || (pid === TEST_PLACE ? nearestRoom() : null); }
  const inHall = () => { const pid = G.sys.places?.current; return !!pid && (pid === TEST_PLACE || !!ROOM_OF_PLACE[pid]); };

  // ---------------------------------------------------------------- the plain test room (only without the hall)
  function defineTestPlace() {
    const P = G.sys.places;
    if (!P?.define || P.def?.(TEST_PLACE)) return !!P?.def?.(TEST_PLACE);
    const W = 96, Dd = 44;
    const sections = [['LOBBY', -40, 14], ['STAY', -40, -4], ['TALK', -40, -16]];
    D.order.forEach((id, i) => sections.push([id, -26 + (i % 5) * 15, i < 5 ? -12 : 12]));
    P.define({
      id: TEST_PLACE, name: '힐링관 시험방', kidName: '힐링관', emoji: '🌿', zoneId: 'ZONE_PL_HEAL_T', origin: { x: -600, z: 2600 + 400 },
      size: { w: W, d: Dd, h: 7 }, surface: 'wood', spawn: { x: -40, z: 18, rotY: Math.PI }, indoor: true,
      camera: { dist: 9, min: 4, max: 16, pitch: 0.42, pmin: 0.15, pmax: 1.1, ceil: 6.5 },
      light: { sky: 0xfff3e0, ground: 0x8a6a4a, amb: 0.55, sun: 0.9, warm: 0.4 },
      build(ctx) {
        const g = ctx.group;
        const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
        const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, Dd), mat(0xc9a77a)); floor.position.y = -0.1; floor.receiveShadow = true; g.add(floor);
        const corr = new THREE.Mesh(new THREE.BoxGeometry(W - 8, 0.02, 4), mat(0xe8d9b5)); corr.position.set(4, 0.02, 0); g.add(corr);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(W, 4, 0.1), new THREE.MeshStandardMaterial({ color: 0xbfe3f2, transparent: true, opacity: 0.25, roughness: 0.05 })); glass.position.set(0, 2, Dd / 2); g.add(glass);
        for (const [room, x, z] of sections) {
          const R = D.rooms[room];
          const pad = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 8), mat(R ? new THREE.Color(R.color).getHex() : 0xd8c8a8)); pad.position.set(x, 0.03, z); g.add(pad);
          const keys = D.stationKeys[room];
          keys.forEach((key, i) => {
            const lx = x - 4 + (i % 4) * 2.6, lz = z + (i < 4 ? -2 : 2);
            const o = new THREE.Object3D(); o.name = `heal-st:${room}:${key}`;
            if (key === 'spot') o.position.set(x, 0, z + 1); else if (key === 'guide') o.position.set(x + 4.6, 0, z - 3); else o.position.set(lx, 0, lz);
            g.add(o);
            if (key !== 'spot' && key !== 'guide') { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), mat(0x8a6a4a)); m.position.copy(o.position); m.position.y = 0.4; g.add(m); ctx.addCollider({ shape: 'box', x: o.position.x, z: o.position.z, hw: 0.55, hd: 0.55, minY: 0, maxY: 0.8 }); }
          });
          if (ctx.board && R) { try { ctx.board(null, { x, y: 3.2, z: z + (z < 0 ? -3.9 : 3.9), rotY: z < 0 ? 0 : Math.PI, w: 4, h: 1, title: `제${R.no}관 ${R.name}` }); } catch (e) { /* signs optional */ } }
        }
        ctx.exitDoor(-40, 21);
        // the stations are set after the group is in place (world positions are read live)
        setTimeout(() => { for (const [room] of sections) for (const key of D.stationKeys[room]) { const o = g.getObjectByName(`heal-st:${room}:${key}`); if (o) G.healStations.set(room, key, o); } }, 0);
        return {};
      },
    });
    return true;
  }
  const hallReady = () => !!(G.sys.places?.def?.('PL_HEAL'));
  /** the place to enter for a room key (the hall's nested place, else the test room) */
  function placeFor(room) { if (hallReady()) return D.places[room] || 'PL_HEAL'; defineTestPlace(); return TEST_PLACE; }
  async function go(target) {
    const room = D.rooms[target] || D.stationKeys[target] ? target : 'LOBBY';
    const pid = placeFor(room);
    const P = G.sys.places; if (!P) return false;
    try {
      if (P.current !== pid) {
        // the hall knows the way in (the corridor door of a room, from anywhere); else travel / enter the place
        let ok = false;
        if (room !== 'LOBBY' && hallReady() && typeof G.healHall?.enter === 'function') ok = await G.healHall.enter(room);
        if (P.current !== pid) ok = P.travel ? await P.travel(pid) : await P.enter(pid);
        if (!ok && P.current !== pid) return false;
      }
      const key = D.rooms[room] ? 'spot' : (room === 'LOBBY' ? 'desk' : room === 'STAY' ? 'shelf' : 'manager');
      const p = stationPos(room, key);
      if (p && G.sys.player?.walkTo) G.sys.player.walkTo({ x: p.x, z: p.z }, { stopDistance: 1.6, trail: true, label: roomName(room) || '힐링관' });
      return true;
    } catch (e) { G.log.warn('HEAL', 'go failed', e?.message || e); return false; }
  }

  // ---------------------------------------------------------------- screens
  const M = () => G.ui.modal;
  const B = (label, emoji, onclick, cls, sayT) => h('button', { type: 'button', class: 'btn heal-btn ' + (cls || ''), 'data-say': sayT || label, onclick }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', {}, label));
  function claimLine() { return h('p', { class: 'heal-claim', 'data-say': easyOn() ? D.words.claimKid : D.words.claim }, '🌿 ', easyOn() ? D.words.claimKid : D.words.claim); }
  function openKiosk() {
    if (!enabled()) return G.ui.alert('오늘은 힐링관이 쉬어요. 다음에 또 와요.', { title: '힐링관', icon: '🌿' });
    const v = vis();
    M().open({
      id: 'heal-kiosk', title: '힐링관 예약', icon: '🖥️', size: 'md', className: 'heal-modal heal-m-kiosk', say: v ? '이미 예약했어요.' : '힐링관을 예약할까요?',
      body: (el, m) => {
        el.appendChild(claimLine());
        if (v) {
          el.appendChild(h('p', { class: 'heal-lead' }, `예약 번호 ${v.id.slice(1, 6).toUpperCase()} · ${clock(v.at)}에 예약했어요.`));
          el.appendChild(h('div', { class: 'heal-row' }, B('복도 지도', '🗺️', () => { m.close(); openMap(); }, 'btn-primary'), B('안내데스크로', '🛎️', () => { m.close(); go('LOBBY'); })));
          return;
        }
        el.appendChild(h('p', { class: 'heal-lead' }, '열 개의 관을 진짜 시간으로 천천히 돌아요. 언제든 나갔다가 다시 와도 이어서 해요.'));
        el.appendChild(h('ol', { class: 'heal-road' }, ...['🛎️ 안내데스크 체크인', '🧺 숙소에서 짐 정리 · 힐링복', '💬 상담실 상담', '🚪 제1관 ~ 제10관', '📋 종합 리포트'].map((x) => h('li', {}, x))));
        el.appendChild(h('div', { class: 'heal-row' }, B('예약하기', '✅', () => { book(); m.close(); openDesk(); }, 'btn-primary', '예약해요')));
      },
      actions: [],
    });
  }
  function openDesk() {
    const v = vis() || book();
    if (!v) return;
    const done = !!v.band;
    M().open({
      id: 'heal-desk', title: '안내데스크', icon: '🛎️', size: 'md', className: 'heal-modal heal-m-desk', say: done ? '체크인했어요. 숙소로 가요.' : '어서 오세요. 체크인할까요?',
      body: (el, m) => {
        el.appendChild(claimLine());
        el.appendChild(h('div', { class: 'heal-band' + (done ? ' on' : '') }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⌚'), h('b', {}, done ? '손목 밴드를 찼어요' : '체크인하면 손목 밴드를 드려요'), h('small', {}, `예약 ${v.id.slice(1, 6).toUpperCase()}`)));
        const row = h('div', { class: 'heal-row' });
        if (!done) row.appendChild(B('체크인', '🛎️', () => { checkIn(); m.close(); openDesk(); }, 'btn-primary', '체크인해요'));
        else row.appendChild(B('숙소로 가기', '🧺', () => { m.close(); go('STAY'); }, 'btn-primary', '숙소로 가요'));
        row.appendChild(B('복도 지도', '🗺️', () => { m.close(); openMap(); }));
        el.appendChild(row);
      },
      actions: [],
    });
  }
  function openStay() {
    const v = ensure('stay'); if (!v) return;
    const N = D.words.bundle.length;
    M().open({
      id: 'heal-stay', title: '숙소', icon: '🧺', size: 'md', className: 'heal-modal heal-m-stay', say: v.stow < N ? '보따리를 풀어 선반에 올려요.' : v.changed ? '힐링복을 입었어요. 상담실로 가요.' : '힐링복으로 갈아입어요.',
      body: (el, m) => {
        el.appendChild(h('p', { class: 'heal-lead' }, v.stow < N ? '보따리를 풀어 하나씩 선반에 올려요.' : v.changed ? '힐링복을 입었어요. 원래 옷은 체크아웃할 때 돌려받아요.' : `이제 빌려 주는 ${D.words.outfit}으로 갈아입어요.`));
        el.appendChild(h('div', { class: 'heal-shelf' }, ...D.words.bundle.map((b, i) => h('button', {
          type: 'button', class: 'heal-tile' + (i < v.stow ? ' done' : i === v.stow ? ' now' : ''), disabled: i !== v.stow || null, 'data-say': b.label,
          onclick: () => { stow(); m.close(); openStay(); },
        }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, b.emoji), h('span', {}, b.label), h('small', {}, i < v.stow ? '선반에 올렸어요' : '눌러서 꺼내요')))));
        const row = h('div', { class: 'heal-row' });
        if (v.stow >= N && !v.changed) row.appendChild(B(`${D.words.outfit}으로 갈아입기`, '👘', () => { change(); m.close(); openStay(); }, 'btn-primary', '힐링복으로 갈아입어요'));
        if (v.changed) row.appendChild(B('상담실로 가기', '💬', () => { m.close(); go('TALK'); }, 'btn-primary', '상담실로 가요'));
        row.appendChild(B('복도 지도', '🗺️', () => { m.close(); openMap(); }));
        el.appendChild(row);
      },
      actions: [],
    });
  }
  function openCounsel() {
    const v = ensure('counsel'); if (!v) return;
    if (!v.changed) change();
    const ans = Object.assign({}, v.ask || {});
    let qi = v.ask ? D.ask.length : 0;
    const body = (el, m) => {
      el.replaceChildren();
      if (qi >= D.ask.length) {
        const base = v.base || counsel(ans);
        el.appendChild(h('p', { class: 'heal-lead' }, '담당 매니저: "고마워요. 오늘은 이런 차례로 쉬어 보면 좋겠어요."'));
        el.appendChild(numsView(base, null));
        el.appendChild(h('ol', { class: 'heal-plan' }, ...plan().map((id) => h('li', {}, `${roomEmoji(id)} ${roomName(id)} · ${D.rooms[id].min}분`))));
        el.appendChild(h('div', { class: 'heal-row' }, B('제1관으로 가기', '🔍', () => { m.close(); go(plan()[0] || 'R1'); }, 'btn-primary', '제1관으로 가요'), B('복도 지도', '🗺️', () => { m.close(); openMap(); })));
        return;
      }
      const q = D.ask[qi];
      el.appendChild(h('p', { class: 'heal-q', 'data-say': q.say }, `${qi + 1} / ${D.ask.length} · ${q.q}`));
      el.appendChild(h('div', { class: 'heal-grid' }, ...q.opts.map((o) => h('button', {
        type: 'button', class: 'heal-tile' + (ans[q.id] === o.id ? ' on' : ''), 'data-say': o.label,
        onclick: () => { ans[q.id] = o.id; qi++; if (qi >= D.ask.length) counsel(ans); body(el, m); try { G.ui.hydrateIcons?.(el); } catch (e) { /* optional */ } say(qi < D.ask.length ? D.ask[qi].say : '오늘의 쉼 차례가 나왔어요.'); },
      }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, o.emoji), h('span', {}, o.label)))));
      if (qi > 0) el.appendChild(h('div', { class: 'heal-row' }, B('앞 질문', '⬅️', () => { qi--; body(el, m); })));
    };
    M().open({ id: 'heal-counsel', title: '상담실 · 담당 매니저', icon: '💬', size: 'md', className: 'heal-modal heal-m-counsel', say: v.ask ? '오늘의 쉼 차례예요.' : D.ask[0].say, body: (el, m) => body(el, m), actions: [] });
  }
  function numsView(n, prev, small) {
    const wrap = h('div', { class: 'heal-nums' + (small ? ' small' : '') });
    for (const d of D.nums) {
      if (small && !d.hud) continue;
      const v = n ? n[d.id] : 50, p = prev ? prev[d.id] : null;
      const better = p == null ? 0 : (d.good === 'down' ? p - v : v - p);
      wrap.appendChild(h('div', { class: 'heal-num', title: d.kid },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, d.emoji), h('span', { class: 'hn-l' }, small ? d.short : d.label),
        h('span', { class: 'bar hn-bar ' + (d.good === 'down' ? 'down' : 'up') }, h('i', { style: { width: Math.round(v) + '%' } })),
        h('b', { class: 'hn-v' }, String(Math.round(v))),
        p != null ? h('small', { class: 'hn-d' + (better > 0.5 ? ' good' : '') }, `${Math.round(p)} → ${Math.round(v)}`) : null));
    }
    return wrap;
  }
  function openRoom(id) {
    const R = D.rooms[id]; if (!R) return;
    const s = roomState(id), v = vis();
    if (s === 'closed') return G.ui.alert(`${roomName(id)}은 오늘 쉬어요. 다른 관을 둘러봐요.`, { title: roomName(id), icon: roomEmoji(id) });
    if (id === 'R10' && v && !v.r10 && easyOn() && room10() === 'gate') {
      // a child gets the gentle version; a grown-up may open the full one (§19.0)
      return G.easy?.pick ? G.easy.pick({
        title: '제10관 — 어떻게 할까요?', say: '마음 돌아보기를 할까요?', emoji: '🌟', columns: 2,
        items: [{ id: 'gentle', emoji: '🌟', label: '마음 돌아보기', say: '마음 돌아보기' }, { id: 'full', emoji: '🕯️', label: '어른과 함께 (전체)', say: '어른과 함께 하기' }],
      }).then(async (pick) => {
        if (pick === 'full') { const ok = await G.easy.gate?.({ reason: 'heal-room10', title: '어른만 열 수 있어요' }); setR10(ok ? 'full' : 'gentle'); }
        else if (pick === 'gentle') setR10('gentle');
        else return;
        openRoom(id);
      }) : null;
    }
    if (id === 'R10' && v && !v.r10) setR10(easyOn() || room10() === 'gentle' ? 'gentle' : 'full');
    const c = v && v.rooms[id];
    M().open({
      id: 'heal-room', title: roomName(id), icon: roomEmoji(id), size: 'md', className: 'heal-modal', say: (id === 'R10' && gentleOn() ? R.gentleSays.in : R.says.in),
      body: (el, m) => {
        el.appendChild(h('p', { class: 'heal-lead' }, id === 'R10' && gentleOn() ? R.gentleSays.in : R.says.in));
        el.appendChild(h('p', { class: 'heal-meta' }, `⏱️ ${R.min}분 코스${R.phases ? ' (' + R.phases.map((p) => `${p.name} ${p.min}분`).join(' + ') + ')' : ''} · 끝나면 도장`));
        if (s === 'run' && c) el.appendChild(courseBar(id));
        if (s === 'done') el.appendChild(h('p', { class: 'heal-stamp' }, '🟢 도장을 받았어요. 언제든 다시 쉬어도 좋아요.'));
        const row = h('div', { class: 'heal-row' });
        if (s === 'run') row.appendChild(B('이어서 하기', '▶️', () => { m.close(); G.healActs?.open?.(id, {}); }, 'btn-primary', '이어서 해요'));
        else if (s === 'done') row.appendChild(B('다시 쉬기', '🔁', () => { m.close(); start(id); }, 'btn-primary', '다시 쉬어요'));
        else row.appendChild(B('시작하기', '▶️', () => { m.close(); tryStart(id); }, 'btn-primary', '시작해요'));
        if (s === 'run') row.appendChild(B('오늘은 그만', '⏸️', () => { stop(id); m.close(); toast('쉬던 만큼은 그대로 남아요. 다음에 다시 시작해요.', { emoji: '⏸️' }); }, '', '오늘은 그만해요'));
        row.appendChild(B('복도 지도', '🗺️', () => { m.close(); openMap(); }));
        el.appendChild(row);
      },
      actions: [],
    });
  }
  function tryStart(id) {
    const r = start(id);
    if (r.ok || r.why !== 'busy') { if (!r.ok) toast('지금은 시작할 수 없어요. 지도에서 다른 관을 골라 봐요.', { emoji: '🌿' }); return r; }
    const other = r.busy[0];
    const q = { emoji: roomEmoji(other), title: `${roomName(other)} 코스가 아직 돌고 있어요`, text: '그 코스를 오늘은 여기까지 하고, 이 관을 시작할까요? 쉬던 만큼은 그대로 남아요.', say: '다른 관의 코스가 아직 돌고 있어요. 바꿀까요?', yes: '바꿔서 시작', no: '기다릴게요' };
    const ask = G.easy?.confirm ? G.easy.confirm(q) : G.ui.confirm(q.text, { title: q.title });
    Promise.resolve(ask).then((ok) => { if (ok) start(id, { force: true }); });
    return r;
  }
  function courseBar(id) {
    const c = vis()?.rooms?.[id];
    const wrap = h('div', { class: 'heal-course', 'data-room': id });
    if (!c) return wrap;
    const p = D.progress(c, now());
    wrap.appendChild(h('span', { class: 'bar' }, h('i', { style: { width: Math.round(p * 100) + '%' } })));
    wrap.appendChild(h('small', {}, `${minsLeft(c.end - now())}분 남음 · ${clock(c.end)}에 끝나요`));
    return wrap;
  }

  // the corridor map: ten doors along one corridor, where I am, each room's state, minutes left, recommended minutes
  function openMap() {
    const v = vis();
    M().open({
      id: 'heal-map', title: '힐링관 복도 지도', icon: '🗺️', size: 'lg', className: 'heal-modal heal-map-modal', say: '가고 싶은 관을 누르면 그리로 가요.',
      body: (el, m) => drawMap(el, m),
      actions: [],
    });
    function drawMap(el, m) {
      el.replaceChildren();
      const here = hereRoom();
      const step = D.nextStep(v, openRooms());
      el.appendChild(h('p', { class: 'heal-lead' }, v ? stepLine(step) : '아직 예약하지 않았어요. 키오스크나 아래 단추로 예약해요.'));
      // one straight corridor behind the glass front: 제10관 … 제6관 (west wing) · the lobby · 제1관 … 제5관 (east wing), as the
      // hall lays them out (G.healHall.corridor(): sorted by their x); without the hall the same order
      let seq = ['R10', 'R9', 'R8', 'R7', 'R6', 'LOBBY', 'R1', 'R2', 'R3', 'R4', 'R5'];
      try {
        const cor = G.healHall?.corridor?.();
        if (Array.isArray(cor) && cor.length) {
          const rs = cor.filter((d) => D.rooms[d.room] && fin(d.x)).sort((a, b) => a.x - b.x).map((d) => d.room);
          if (rs.length === 10) { const lx = fin(cor.lobby?.x) ? cor.lobby.x : 0; const west = cor.filter((d) => D.rooms[d.room] && d.x < lx).sort((a, b) => a.x - b.x).map((d) => d.room); seq = west.concat(['LOBBY'], rs.filter((r) => !west.includes(r))); }
        }
      } catch (e) { /* the default order */ }
      const row = h('div', { class: 'heal-corr' });
      for (const id of seq) {
        if (id === 'LOBBY') {
          row.appendChild(h('button', { type: 'button', class: 'heal-door lobby' + (here === 'LOBBY' || here === 'STAY' || here === 'TALK' ? ' here' : ''), 'data-say': '로비와 안내데스크', onclick: () => { m.close(); go('LOBBY').then((ok) => { if (!ok) openDesk(); }); } },
            h('span', { class: 'hd-no' }, '로비'), h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🛎️'), h('span', { class: 'hd-name' }, '안내데스크 · 숙소 · 상담실'),
            here === 'LOBBY' || here === 'STAY' || here === 'TALK' ? h('span', { class: 'hd-here', 'aria-label': '지금 여기' }, '📍') : null));
          continue;
        }
        const s = roomState(id), c = v && v.rooms[id];
        const line = s === 'run' && c ? `${minsLeft(c.end - now())}분 남음 · ${clock(c.end)}` : s === 'done' ? '도장 🟢' : s === 'closed' ? '쉬어요' : `${D.rooms[id].min}분`;
        row.appendChild(h('button', {
          type: 'button', class: `heal-door s-${s}${here === id ? ' here' : ''}`, 'data-room': id, 'data-say': `${roomName(id)}. ${s === 'run' ? '쉬는 중' : s === 'done' ? '도장 받음' : ''}`, disabled: s === 'closed' || null,
          onclick: () => { m.close(); go(id).then((ok) => { if (ok) openRoom(id); }); },
        }, h('span', { class: 'hd-no' }, `제${D.rooms[id].no}관`), h('span', { class: 'emoji', 'aria-hidden': 'true' }, roomEmoji(id)), h('span', { class: 'hd-name' }, id === 'R10' && gentleOn() ? D.rooms.R10.gentle.name : D.rooms[id].name), h('small', { class: 'hd-line' }, line),
          s === 'run' && c ? h('span', { class: 'hd-bar' }, h('i', { style: { width: Math.round(D.progress(c, now()) * 100) + '%' } })) : null,
          here === id ? h('span', { class: 'hd-here', 'aria-label': '지금 여기' }, '📍') : null));
      }
      el.appendChild(h('div', { class: 'heal-mapbox' }, row, h('div', { class: 'heal-corr-line' }, h('span', {}, '← 서쪽 날개'), h('span', {}, '하나로 이어진 복도'), h('span', {}, '동쪽 날개 →')), h('div', { class: 'heal-glass' }, '통유리 창 너머 정원 · 남쪽')));
      const lob = h('div', { class: 'heal-row heal-lobby' },
        B('안내데스크', '🛎️', () => { m.close(); if (inHall()) go('LOBBY'); else openDesk(); }), B('숙소', '🧺', () => { m.close(); go('STAY'); }), B('상담실', '💬', () => { m.close(); go('TALK'); }));
      if (!v) lob.prepend(B('예약하기', '🖥️', () => { m.close(); openKiosk(); }, 'btn-primary'));
      if (v && (step === 'report' || step === 'checkout' || v.rep)) lob.prepend(B('종합 리포트', '📋', () => { m.close(); openReport(); }, 'btn-primary'));
      el.appendChild(lob);
      if (v) el.appendChild(numsView(D.numbers(v, now()), v.base, true));
    }
  }
  function stepLine(step) {
    return {
      book: '키오스크에서 예약해요.', checkin: '안내데스크에서 체크인해요.', stay: '숙소에서 보따리를 풀어요.', change: '숙소에서 힐링복으로 갈아입어요.',
      counsel: '상담실에서 담당 매니저와 이야기해요.', rooms: '가고 싶은 관을 눌러요. 추천 차례는 빛나는 문이에요.', report: '모든 관을 돌았어요! 종합 리포트를 봐요.',
      checkout: '리포트를 봤어요. 안내데스크에서 체크아웃해요.', out: '오늘 방문이 끝났어요.',
    }[step] || '';
  }

  // the report: before / after side by side, rested minutes, room 9, the portrait style and the letter (this device), stamps
  function openReport() {
    const r = reportData(); if (!r) return openMap();
    const v = r.v;
    if (!v.rep) { v.rep = now(); G.bus.emit('healing:report', {}); save(); }
    const loc = r.local || {};
    M().open({
      id: 'heal-report', title: '힐링관 종합 리포트', icon: '📋', size: 'lg', className: 'heal-modal heal-report', say: '오늘 쉰 기록이에요. 마음이 가벼워졌나요?',
      body: (el, m) => {
        el.appendChild(claimLine());
        el.appendChild(h('div', { class: 'heal-stamps' }, ...D.order.map((id) => h('span', { class: 'heal-stampbox' + (v.rooms[id]?.done ? ' on' : '') + (r.rooms.includes(id) ? '' : ' off'), title: roomName(id) }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, v.rooms[id]?.done ? roomEmoji(id) : '⬜'), h('small', {}, `${D.rooms[id].no}`)))));
        el.appendChild(h('h3', {}, '네 가지 숫자 — 처음과 지금'));
        el.appendChild(numsView(r.after, r.before));
        el.appendChild(h('h3', {}, `제1관 결과 — 처음과 마지막 (놀이 값)`));
        const T = [['balance', '⚖️ 균형'], ['breath', '🌬️ 숨'], ['posture', '🧍 자세'], ['microbes', '🦠 고마운 미생물'], ['salt', '🧂 짠맛 색']];
        el.appendChild(h('table', { class: 'heal-tbl' }, h('tr', {}, h('th', {}, ''), h('th', {}, '처음'), h('th', {}, '마지막')), ...T.map(([k, l]) => h('tr', {}, h('td', {}, l), h('td', {}, String(r.first[k] ?? '-')), h('td', {}, String(r.last[k] ?? '-'))))));
        el.appendChild(h('p', { class: 'heal-meta' }, `⏱️ 쉰 시간 ${r.rested}분 · 🟢 도장 ${r.stamps} / ${r.rooms.length}`));
        el.appendChild(h('p', { class: 'heal-meta' }, `⚾ 제9관: 접시 ${r.r9.plates} · 드럼통 ${r.r9.drums} · 깡통 ${r.r9.cans} · 유리병 ${r.r9.bottles}`));
        const g10 = v.r10 === 'gentle' || (!v.r10 && easyOn());
        const pic = typeof loc.portrait === 'string' && /^data:image\//.test(loc.portrait) ? loc.portrait : null;
        const frame = h('div', { class: 'heal-portrait s-' + (loc.style || 'classic') }, pic ? h('img', { src: pic, alt: g10 ? '오늘의 나 사진' : '영정 사진' }) : h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖼️'));
        const cards = Array.isArray(loc.cards) ? loc.cards : [];
        const list = g10 ? D.letter.gentle : D.letter.full;
        const letter = h('div', { class: 'heal-letter' }, h('b', {}, g10 ? '💌 고마운 마음 편지' : '✉️ 나의 편지'), ...cards.filter((i) => list[i]).map((i) => h('p', {}, list[i])), typeof loc.text === 'string' && loc.text ? h('p', { class: 'own' }, loc.text) : null, !cards.length && !loc.text ? h('p', {}, '(아직 쓰지 않았어요)') : null);
        const three = Array.isArray(loc.three) ? loc.three.map((id) => D.three.find((x) => x.id === id)).filter(Boolean) : [];
        el.appendChild(h('div', { class: 'heal-r10' }, frame, letter, h('div', { class: 'heal-three' }, h('b', {}, '💐 소중한 세 가지'), ...three.map((x) => h('span', { class: 'heal-chip3' }, x.emoji + ' ' + x.label)))));
        el.appendChild(h('p', { class: 'heal-note' }, '사진과 편지는 이 기기에만 있어요. 서버로 보내지 않아요.'));
        if (!g10) el.appendChild(h('p', { class: 'heal-help' }, '📞 ', D.words.help));
        const row = h('div', { class: 'heal-row' });
        row.appendChild(B('일지에 남기기', '📔', () => { toJournal(r); }, '', '일지에 남겨요'));
        if (!v.out) row.appendChild(B('체크아웃', '🛎️', () => { m.close(); checkout(); }, 'btn-primary', '체크아웃해요'));
        row.appendChild(B('복도 지도', '🗺️', () => { m.close(); openMap(); }));
        el.appendChild(row);
      },
      actions: [],
    });
  }
  function reportPicture(r) {
    try {
      const c = document.createElement('canvas'); c.width = 480; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#f6efe2'; x.fillRect(0, 0, 480, 300);
      x.fillStyle = '#3a5a3c'; x.font = 'bold 22px sans-serif'; x.fillText('🌿 힐링관 종합 리포트', 18, 36);
      x.font = '15px sans-serif';
      D.nums.forEach((d, i) => {
        const y = 66 + i * 34, b = r.before[d.id], a = r.after[d.id];
        x.fillStyle = '#4a3a2c'; x.fillText(`${d.emoji} ${d.label}`, 18, y + 12);
        x.fillStyle = '#d8ccb6'; x.fillRect(190, y, 200, 14);
        x.fillStyle = d.good === 'down' ? '#7fb6d9' : '#9bbf6a'; x.fillRect(190, y, 2 * a, 14);
        x.fillStyle = '#4a3a2c'; x.fillText(`${Math.round(b)}→${Math.round(a)}`, 398, y + 12);
      });
      x.fillStyle = '#6a5a4a'; x.font = '13px sans-serif'; x.fillText(`도장 ${r.stamps}개 · 쉰 시간 ${r.rested}분 · 놀이 기록이에요`, 18, 290);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }
  function toJournal(r) {
    const J = G.sys.journal; if (!J?.create) return toast('일지를 지금은 쓸 수 없어요.', { emoji: '📔' });
    const e = J.create({ mood: 'happy', note: `힐링관에서 ${r.stamps}개 관을 돌며 ${r.rested}분 쉬었어요.`, learned: `${D.words.advice}: ${plan().map((id) => D.rooms[id].name).slice(0, 4).join(' · ')} · 스트레스 ${Math.round(r.before.stress)} → ${Math.round(r.after.stress)}`, photo: reportPicture(r) });
    toast(e ? '📔 일지에 남겼어요.' : '일지에 남기지 못했어요.', { emoji: '📔' });
    return e;
  }

  // ---------------------------------------------------------------- HUD: the chip (minutes left · end time) and the four numbers
  let chip = null, panel = null, hudT = 0;
  function bindHud() {
    if (chip) return;
    const host = document.getElementById('hud-top-center'); if (!host) return;
    chip = h('button', { id: 'heal-chip', type: 'button', class: 'glass heal-chip', hidden: '', 'data-say': '힐링관 복도 지도', onclick: () => openMap() },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🌿'), h('b', { class: 'hc-t' }, ''), h('small', { class: 'hc-s' }, ''));
    panel = h('div', { id: 'heal-hud', class: 'glass heal-hud', hidden: '', role: 'status', 'aria-label': '힐링관 상태' });
    host.appendChild(chip); host.appendChild(panel);
  }
  function syncHud() {
    bindHud(); if (!chip) return;
    const v = vis(), run = running(), inside = inHall();
    const on = !!G.state && !!v && (inside || run.length > 0);
    chip.hidden = !on; panel.hidden = !(on && inside);
    document.body.classList.toggle('in-heal', !!(on && inside));
    if (!on) return;
    const r = run[0];
    chip.querySelector('.hc-t').textContent = r ? `${roomName(r.room)} · ${minsLeft(r.left)}분 남음` : (inside ? '힐링관 · 복도 지도' : '힐링관');
    chip.querySelector('.hc-s').textContent = r ? `${clock(r.end)}에 끝나요` : stepLine(D.nextStep(v, openRooms())).slice(0, 28);
    if (!panel.hidden) { panel.replaceChildren(); panel.appendChild(numsView(D.numbers(v, now()), null, true)); }
  }

  // ---------------------------------------------------------------- the system
  const api = {
    name: 'healing', order: 66, label: '힐링관',
    get visit() { return vis(); },
    step: () => D.nextStep(vis(), openRooms()),
    book, checkIn, stow, change, counsel, start, stop, little, stepOf, running, roomState, numbers, plan, openRooms, checkout, go,
    scale, now, local, setLocal, reportData, toJournal, gentle: () => gentleOn(), room10Full, setR10, roomName, roomEmoji, hereRoom, inHall, stationPos, placeFor,
    openMap, openRoom, openReport, openDesk, openKiosk, openStay, openCounsel, numsView, courseBar, clock, minsLeft,
    debug: {
      setNow(ms) { dbg.now = ms == null ? null : Number(ms); tick(); changed(); },
      advance(ms) { if (dbg.now != null) dbg.now += Number(ms) || 0; else dbg.offset += Number(ms) || 0; tick(); changed(); return now(); },
      scale(k) { dbg.scale = k == null ? null : Number(k); return scale(); },
      finish(id) { const v = vis(); if (!v) return 0; let n = 0; for (const rid of id === 'all' ? D.order : [id]) { const c = v.rooms[rid]; if (c && !c.done && !c.stop) { c.end = Math.min(c.end, now()); n++; } } tick(); return n; },
      testPlace: () => defineTestPlace(),
      info: () => ({ now: now(), scale: scale(), step: D.nextStep(vis(), openRooms()), running: running(), here: hereRoom(), stations: G.healStations.map.size, handles: handles.size, hall: hallReady() }),
    },
    init() {
      G.bus.on('heal:station', onStation);
      G.bus.on('heal:stations-gone', (p) => {   // the hall disposed a place: its stations (and our interactables on them) go
        if (!p || !p.room) return;
        for (const [hk, reg] of [...handles]) if (hk.indexOf(p.room + ':') === 0) { try { reg.unregister(); } catch (e) { /* gone */ } handles.delete(hk); }
        if (keeperRoom === p.room && keeper) { keeper.group.visible = false; keeperRoom = null; }
      });
      for (const k of G.healStations.map.keys()) { const [room, key] = k.split(':'); onStation({ room, key }); }
      G.bus.on('place:enter', () => { setTimeout(() => { keeperSync(); syncHud(); }, 0); });
      G.bus.on('place:exit', () => { G.healActs?.left?.(); setTimeout(() => { keeperSync(); syncHud(); }, 0); });
      G.bus.on('game:logout', () => { G.healActs?.close?.('logout'); if (keeper) keeper.group.visible = false; });
      G.bus.on('healing:changed', () => { hudT = 0; });
      G.bus.on('game:ready', () => { if (!hallReady()) defineTestPlace(); tick(); });
      G.input?.onKey?.('KeyM', () => {
        if (!G.state || !inHall()) return false;
        const m = G.ui.modal.get('heal-map'); if (m) { m.close(); return true; }
        if (G.ui.isBlocking()) return false;
        openMap(); return true;
      }, { allowInModal: true });
      G.ui.onAction?.('healing', () => openMap());
    },
    update(dt) {
      hudT -= dt;
      if (hudT > 0) return;
      hudT = 1;   // once a wall-clock second: stamps, the chip, the numbers
      try { tick(); syncHud(); if (keeper && keeper.group.visible && keeperRoom) { const pp = G.sys.player?.position; if (pp) keeper.group.rotation.y = Math.atan2(pp.x - keeper.group.position.x, pp.z - keeper.group.position.z); } } catch (e) {
        const msg = String(e && e.stack || e).slice(0, 300);
        if (api._lastError !== msg) { api._lastError = msg; G.log.warn('HEAL', 'tick failed', msg); }
      }
    },
  };
  G.register(api);
})();
