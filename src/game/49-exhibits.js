// =============================================================================
// 49-exhibits.js — G.sys.exhibits (CONTRACT §16.6): what the hanok rooms show, as kid cards, a stamp book (도감) and
// 2D canvas motion graphics. Data: 48-interior-data.js (G.data.exhibits / motions / exhibitRooms).
//
//   open(id, {via, preview})      the kid card: picture (pack artwork · motion poster · big emoji), the kid line with 🔊,
//                                 ▶ 움직이는 그림, 어른용 설명 (collapsed: detail, sources as text). Records the stamp.
//   motion(id, {from})            the motion player: a 16:9 canvas, caption with 🔊, ⏮ ▶/⏸ ⏭ (≥ 56 px), auto-advance,
//                                 still steps under reduce-motion, paused while the tab is hidden, cleaned up on close.
//   board(motionId, {w, h})       → { texture, canvas, update(dt), dispose() } for an in-world panel (≤ 512 × 288, redrawn
//                                 at 10 Hz and only while the caller keeps calling update; one still frame under
//                                 reduce-motion and on the `low` preset).
//   attach(id, target, {radius})  → { id, unregister() }: registers the exhibit as an interactable on an Object3D or a
//                                 {x, y, z} world point (kind 'heritage', id = the exhibit id).
//   mount(placeId, anchors, opt)  attach every exhibit of a place to anchors[key] → { attached, missing, dispose() }
//   forPlace(placeId)             [{ id, anchor, title, emoji, kid, motion, art, seen }] in data order
//   anchors(placeId) / missing(placeId, keys) / spec(id)   helpers for the room builders (§16.4 ctx.anchor / ctx.interact)
//   seen(id, mark?)               has the player seen it (mark = true records it) · progress() → totals and rooms
//   openBook({place})             the 도감: a stamp grid per room, the room's motions, a celebration when a room is full
//   demo({ms})                    developer tour through every card and motion (dev center only; records nothing)
//
// State: G.state.places = { visits: {placeId: n}, seen: {exhibitId: 1}, motions: {motionId: 1} } (sanitized in
// 03-state.js) + the plain counters stats.exhibitsSeen / placesSeen / exhibitRooms / motionsSeen (achievements).
// Quests (01-data.js "집 구경") advance through the existing 'interact' event: kind 'heritage' (an exhibit, first
// look), 'place' (a room entered), 'motion' (a motion watched to its end), 'roombook' (a room's stamps complete).
// Events: exhibit:open {id, place, first} · exhibit:seen {id, place} · exhibit:motion {id, done} ·
//   exhibit:room-complete {place}. Listens to place:enter {id} (18-places.js).
// Security / kid rules (§11.1, §12): text only through textContent / G.ui.h children; sources are text in easy mode
// (never a link); no network, no eval. Canvas animation ≤ 30 fps, nothing flashes above 3 Hz.
// =============================================================================
(function () {
  const U = G.util;
  const h = (...a) => G.ui.h(...a);
  const X = () => G.data.exhibits || {};
  const MD = () => G.data.motions || {};
  const ROOMS = () => G.data.exhibitRooms || [];
  const CAT = 'EXHIBIT';
  const easyOn = () => !!(G.easy && G.easy.on);
  const reduceMotion = () => !!G.settings?.reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const say = (text, opts) => { try { return Promise.resolve(G.easy?.say?.(text, opts)).catch(() => false); } catch (e) { return Promise.resolve(false); } };
  const toast = (msg, opts) => { try { G.ui.toast(msg, opts); } catch (e) { /* ui optional */ } };
  const josa = (w, pair) => { try { return G.kidKit?.josa ? G.kidKit.josa(w, pair) : `${w}${String(pair).split('/')[1]}`; } catch (e) { return String(w); } };
  const PLACE_RX = /^PL_[A-Z0-9_]{1,28}$/;
  const URL_RX = /^https?:\/\/[^\s"'<>]+$/i;

  // ---------------------------------------------------------------- lookups
  let _byPlace = null;
  function byPlace() {
    if (_byPlace) return _byPlace;
    _byPlace = {};
    for (const e of Object.values(X())) (_byPlace[e.place] = _byPlace[e.place] || []).push(e);
    return _byPlace;
  }
  const roomOf = (placeId) => ROOMS().find((r) => r.id === placeId) || { id: placeId, name: '방', emoji: '🏠', kid: '', motions: [] };

  // ---------------------------------------------------------------- state (G.state.places)
  function PL() {
    const st = G.state;
    if (!st) return null;
    let p = st.places;
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = st.places = { visits: {}, seen: {}, motions: {} };
    for (const k of ['visits', 'seen', 'motions']) if (!p[k] || typeof p[k] !== 'object' || Array.isArray(p[k])) p[k] = {};
    return p;
  }
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isSeen = (id) => { const p = PL(); return !!(p && own(p.seen, id) && p.seen[id]); };
  const isWatched = (id) => { const p = PL(); return !!(p && own(p.motions, id) && p.motions[id]); };
  function roomStat(placeId) {
    const list = byPlace()[placeId] || [];
    let seen = 0;
    for (const e of list) if (isSeen(e.id)) seen++;
    return { place: placeId, seen, total: list.length, done: list.length > 0 && seen >= list.length };
  }
  function totals() {
    const p = PL();
    const ids = Object.keys(X());
    const seen = p ? ids.filter((id) => isSeen(id)).length : 0;
    const rooms = ROOMS().map((r) => Object.assign({ name: r.name, emoji: r.emoji }, roomStat(r.id)));
    const mids = Object.keys(MD());
    return {
      seen, total: ids.length, ratio: ids.length ? seen / ids.length : 0, rooms, roomsDone: rooms.filter((r) => r.done).length,
      motions: { seen: p ? mids.filter((id) => isWatched(id)).length : 0, total: mids.length },
      places: p ? Object.keys(p.visits).filter((k) => Number(p.visits[k]) > 0).length : 0,
    };
  }
  /** the plain counters the achievements read (01-data.js): always the sizes of state.places, never more */
  function syncStats() {
    const st = G.state;
    if (!st || !st.stats) return;
    const t = totals();
    const want = { exhibitsSeen: t.seen, placesSeen: t.places, exhibitRooms: t.roomsDone, motionsSeen: t.motions.seen };
    let changed = false;
    for (const [k, v] of Object.entries(want)) if (st.stats[k] !== v) { st.stats[k] = v; changed = true; }
    if (changed) {
      G.dirty('exhibits');
      try { G.sys.progression?.checkAchievements?.(); } catch (e) { /* progression optional */ }
    }
  }
  const emitInteract = (kind, id) => { try { G.bus.emit('interact', { kind, id }); } catch (e) { /* bus is core */ } };
  function notify(n) { try { return G.sys.engagement && !G.sys.engagement._failed ? G.sys.engagement.notify?.(n) : null; } catch (e) { return null; } }

  let _pendingRoom = null;   // a room whose last stamp was just collected: celebrated when the card closes
  let _visitSnap = {};       // placeId -> visits value this module last saw (the place system may count too: never twice)

  /** record the stamp of an exhibit; returns true when it is new */
  function markSeen(id, opts = {}) {
    const ex = X()[id], p = PL();
    if (!ex || !p || opts.preview || isSeen(id)) return false;
    const before = roomStat(ex.place);
    const firstEver = !Object.keys(p.seen).some((k) => p.seen[k]);
    p.seen[id] = 1;
    G.dirty('exhibits');
    const after = roomStat(ex.place);
    syncStats();
    G.bus.emit('exhibit:seen', { id, place: ex.place });
    // the interaction system emits 'interact' itself for a registered exhibit; every other way in (book, board, shelf) does it here
    if (opts.via !== 'interact') emitInteract('heritage', id);
    if (firstEver) {
      notify({ type: 'collection', icon: '🏠', title: '집 구경 도감이 생겼어요', text: '방에서 살펴본 것이 도장으로 모여요. ☰ 메뉴의 🏠 집 구경 도감에서 볼 수 있어요.', key: 'exhibit-book-first' });
    }
    if (after.done && !before.done) _pendingRoom = ex.place;
    return true;
  }
  function markWatched(id) {
    const p = PL();
    if (!p || !MD()[id] || isWatched(id)) return false;
    p.motions[id] = 1;
    G.dirty('exhibits');
    syncStats();
    emitInteract('motion', id);
    return true;
  }
  function celebrateRoom(placeId) {
    const r = roomOf(placeId);
    const all = totals();
    const whole = all.total > 0 && all.seen >= all.total;
    const line = whole ? '집 구경 도감을 모두 채웠어요!' : `${r.name} 도감 완성!`;
    try {
      if (easyOn() && G.easy?.celebrate) G.easy.celebrate(line, { emoji: whole ? '🏆' : '🏅', say: `${line} 참 잘했어요.` });
      else { G.fx?.stamp?.(whole ? '도감 완성!' : '방 완성!', { sub: whole ? '집 구경 도감' : r.name }); toast(line, { type: 'success', emoji: '🏅' }); }
    } catch (e) { /* celebration is cosmetic */ }
    notify({ type: 'collection', icon: '🏅', title: line, text: `${r.emoji} ${r.name}의 도장을 모두 모았어요.`, key: `exhibit-room-${placeId}` });
    emitInteract('roombook', placeId);
    G.bus.emit('exhibit:room-complete', { place: placeId });
  }
  function flushCelebration() {
    const p = _pendingRoom;
    _pendingRoom = null;
    if (p) setTimeout(() => { if (G.state) celebrateRoom(p); }, 260);
  }

  function onPlaceEnter(ev) {
    const id = ev && typeof ev.id === 'string' ? ev.id : '';
    if (!id || !PLACE_RX.test(id) || !G.state) return;
    setTimeout(() => {
      const p = PL();
      if (!p) return;
      const now = Number(p.visits[id]) || 0;
      // nobody counted this visit yet (the place system counts on its own in some builds): count it here
      if (now === (Number(_visitSnap[id]) || 0)) { p.visits[id] = Math.min(1e6, now + 1); G.dirty('places'); }
      _visitSnap[id] = Number(p.visits[id]) || 0;
      syncStats();
      emitInteract('place', id);
    }, 0);
  }

  // ================================================================ the kid card
  const _stages = new Set();   // live stages (canvas surfaces) — disposed with their dialog, counted by the tests
  function sourceRow(s, kid) {
    const label = String(s.label || '');
    const url = String(s.url || '');
    const li = h('li', { class: 'xh-src' }, h('b', { class: 'xh-src-label' }, label));
    // 쉬운 모드: the address is plain text, never a link (§12.4: no way out of the app for a child)
    if (!kid && URL_RX.test(url)) li.appendChild(h('a', { class: 'xh-src-url', href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
    else li.appendChild(h('span', { class: 'xh-src-url' }, url));
    return li;
  }
  /** the picture of a card: the pack artwork, the poster frame of its motion, or the big emoji */
  function cardPicture(ex, onPlay) {
    const box = h('div', { class: 'xh-pic' });
    const emoji = () => { box.classList.add('xh-pic-emoji'); box.textContent = ''; box.appendChild(h('span', { class: 'xh-emoji emoji', 'aria-hidden': 'true' }, ex.emoji || '🏠')); };
    let stage = null;
    if (ex.art) {
      // a named artwork is shown only from the licence-checked pack (§16.0): no pack image → the emoji, never a stand-in
      const P = G.pack;
      let has = false;
      try { has = !!(P && typeof P.image === 'function' && (typeof P.has !== 'function' || P.has(ex.art))); } catch (e) { has = false; }
      if (!has) emoji();
      else {
        box.classList.add('xh-pic-art');
        const cv = h('canvas', { class: 'xh-art', role: 'img', 'aria-label': `${ex.title} 그림` });
        box.appendChild(cv);
        emojiUnder(box, ex);
        // force: a picture the player opened in a 2D panel is decoded at every quality (G.pack keeps `low` lazy otherwise)
        Promise.resolve().then(() => P.image(ex.art, { force: true, priority: 1 })).then((img) => {
          const w = Number(img?.width || img?.naturalWidth) || 0, hh = Number(img?.height || img?.naturalHeight) || 0;
          if (!w || !hh || !cv.isConnected) return;
          const k = Math.min(1, 1024 / Math.max(w, hh));
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(hh * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          box.classList.add('is-loaded');
          box.style.setProperty('--ar', String(w / hh));
        }).catch((e) => { G.log.debug(CAT, 'artwork not drawn', ex.art, e?.message || e); });
      }
    } else if (ex.motion && DRAW[ex.motion] && MD()[ex.motion]) {
      box.classList.add('xh-pic-motion');
      const cv = h('canvas', { class: 'xh-poster', role: 'img', 'aria-label': `${MD()[ex.motion].title} 그림` });
      box.appendChild(cv);
      stage = makeStage(cv, ex.motion);
      const pst = MD()[ex.motion].poster || [0, 1];
      const paint = () => { if (!stage) return; stage.fit(640); stage.render(pst[0], pst[1], 1.2, { still: true }); };
      paint();
      fontsReady().then(() => { if (box.isConnected) paint(); });
      if (onPlay) {
        const b = h('button', { type: 'button', class: 'xh-pic-play', 'aria-label': '움직이는 그림 보기', 'data-say': '움직이는 그림 보기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶️'));
        b.addEventListener('click', onPlay);
        box.appendChild(b);
      }
    } else emoji();
    return { box, dispose() { if (stage) { stage.dispose(); stage = null; } } };
  }
  function emojiUnder(box, ex) { box.appendChild(h('span', { class: 'xh-emoji xh-emoji-wait emoji', 'aria-hidden': 'true' }, ex.emoji || '🖼️')); }

  function openCard(id, opts = {}) {
    const ex = X()[id];
    if (!ex) { G.log.warn(CAT, `unknown exhibit ${String(id).slice(0, 40)}`); return null; }
    const fresh = markSeen(id, opts);
    const kid = easyOn();
    const room = roomOf(ex.place);
    let pic = null;
    const playMotion = () => { const from = { card: id, preview: !!opts.preview }; m.close(); setTimeout(() => api.motion(ex.motion, { from }), 30); };
    const m = G.ui.modal.open({
      id: 'exhibit-card', size: 'md', className: `xh-card-modal${ex.art ? ' xh-has-art' : ''}`, title: ex.title, icon: ex.emoji || '🏠',
      say: `${ex.title}. ${ex.kid}`,
      onClose: () => { pic?.dispose(); pic = null; if (!opts.preview) flushCelebration(); },
    });
    const hasMotion = !!(ex.motion && MD()[ex.motion] && DRAW[ex.motion]);
    pic = cardPicture(ex, hasMotion ? playMotion : null);
    const kidT = h('span', { class: 'xh-kid-t' }, ex.kid);
    const kidP = h('p', { class: 'xh-kid' }, kidT);
    try { G.easy?.speakable?.(kidP, () => ex.kid); } catch (e) { /* voice optional */ }
    const st = roomStat(ex.place);
    const where = h('div', { class: 'xh-where' },
      h('span', { class: 'xh-chip' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, room.emoji), ` ${room.name}`),
      opts.preview ? null : h('span', { class: 'xh-chip xh-chip-count', 'aria-label': `${room.name} 도장 ${st.seen}개, 모두 ${st.total}개` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔖'), ` ${st.seen} / ${st.total}`),
      fresh ? h('span', { class: 'xh-chip xh-chip-new' }, '새 도장!') : null);
    const card = h('div', { class: 'xh-card' }, pic.box);
    if (ex.art && ex.credit) card.appendChild(h('p', { class: 'xh-credit' }, ex.credit));
    card.append(kidP, where);
    if (hasMotion) {
      const b = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes xh-motion-btn', 'data-say': `움직이는 그림. ${MD()[ex.motion].title}` },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶️'), h('span', null, '움직이는 그림'));
      b.addEventListener('click', playMotion);
      card.appendChild(b);
    }
    // 어른용 설명: collapsed; the detail, how sure the fact is, the sources as text
    const adult = h('details', { class: 'xh-adult' });
    adult.appendChild(h('summary', { class: 'xh-adult-sum' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👨‍👩‍👧'), h('span', null, ' 어른용 설명')));
    const inner = h('div', { class: 'xh-adult-body' }, h('p', { class: 'xh-detail' }, ex.detail));
    if (ex.confidence === 'medium') inner.appendChild(h('p', { class: 'xh-note' }, '전해 오는 이야기나 기사에 실린 내용이라 ‘~래요’라고 적었어요.'));
    if (ex.textOnly) inner.appendChild(h('p', { class: 'xh-note' }, '이 그림은 쓸 수 있는 자료가 없어 글로만 소개해요.'));
    inner.appendChild(h('p', { class: 'xh-src-head' }, '참고한 자료'));
    const ul = h('ul', { class: 'xh-sources' });
    for (const s of ex.sources || []) ul.appendChild(sourceRow(s, kid));
    inner.append(ul, h('p', { class: 'xh-disclaimer' }, '어린이가 읽기 쉽게 간추린 글이에요. 전문가의 감수를 받은 글은 아니에요.'));
    adult.appendChild(inner);
    card.appendChild(adult);
    m.body.classList.add('xh-card-body');
    m.body.appendChild(card);
    if (fresh) {
      card.classList.add('is-fresh');
      G.sfx('notify');
    }
    m._exhibit = id;
    G.bus.emit('exhibit:open', { id, place: ex.place, first: fresh });
    return m;
  }

  // ================================================================ the 도감 (stamp book)
  let _bookRoom = null;
  /** can the player walk into this room in this build? No (2D-only mode, or the room is not built into this page) →
   *  the book itself is the exhibition: an unseen stamp opens its card, so the 도감 is never a dead end (§12) */
  function reachable(placeId) {
    try {
      if (G.app?.noThree?.active || document.body.classList.contains('no-3d')) return false;
      const P = G.sys.places;
      return !!(P && !P._failed && typeof P.def === 'function' && P.def(placeId));
    } catch (e) { return false; }
  }
  /** such a room counts as visited once the player looks at one of its exhibits in the book (the 집 구경 quests stay reachable) */
  function visitByBook(placeId) {
    const p = PL();
    if (!p || !PLACE_RX.test(String(placeId)) || Number(p.visits[placeId]) > 0) return false;
    p.visits[placeId] = 1;
    _visitSnap[placeId] = 1;
    G.dirty('places');
    syncStats();
    emitInteract('place', placeId);
    return true;
  }
  function openBook(opts = {}) {
    if (!G.state) return null;
    const rooms = ROOMS();
    if (!rooms.length) { toast('아직 도감에 넣을 전시가 없어요.', { type: 'info', emoji: '🏠' }); return null; }
    if (opts.place && rooms.some((r) => r.id === opts.place)) _bookRoom = opts.place;
    if (!_bookRoom || !rooms.some((r) => r.id === _bookRoom)) {
      // open on the room the player stands in, else the first room with a stamp, else the first room
      const cur = G.sys.places?.current;
      const curId = typeof cur === 'string' ? cur : cur?.id;
      _bookRoom = (rooms.find((r) => r.id === curId) || rooms.find((r) => roomStat(r.id).seen > 0) || rooms[0]).id;
    }
    const m = G.ui.modal.open({
      id: 'exhibit-book', size: 'lg', className: 'xh-book-modal', title: '집 구경 도감', icon: '🏠', autofocus: false,
      say: '집 구경 도감이에요. 방을 고르고 모은 도장을 봐요.',
    });
    m.body.classList.add('xh-book-body');
    renderBook(m);
    return m;
  }
  function renderBook(m) {
    if (!m || m.closed) return;
    const kid = easyOn();
    const t = totals();
    const body = m.body;
    const keepScroll = body.querySelector('.xh-stamps')?.scrollTop || 0;
    body.textContent = '';
    const pct = Math.round(t.ratio * 100);
    const head = h('div', { class: 'xh-book-head' },
      h('div', { class: 'xh-book-total', role: 'img', 'aria-label': `도장 ${t.seen}개, 모두 ${t.total}개` },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔖'), h('b', null, `${t.seen}`), h('span', null, ` / ${t.total}`)),
      h('div', { class: 'xh-book-bar', 'aria-hidden': 'true' }, h('i', { style: { transform: `scaleX(${Math.max(0.02, t.ratio)})` } })),
      h('div', { class: 'xh-book-total xh-book-mo', role: 'img', 'aria-label': `움직이는 그림 ${t.motions.seen}편, 모두 ${t.motions.total}편` },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎞️'), h('b', null, `${t.motions.seen}`), h('span', null, ` / ${t.motions.total}`)));
    head.dataset.pct = String(pct);
    try { G.easy?.speakable?.(head, () => `도장을 ${t.seen}개 모았어요. 모두 ${t.total}개예요.`); } catch (e) { /* voice optional */ }
    // rooms
    const tabs = h('div', { class: 'xh-rooms', role: 'tablist', 'aria-label': '방 고르기' });
    for (const r of ROOMS()) {
      const s = roomStat(r.id);
      const b = h('button', {
        type: 'button', class: `xh-room${r.id === _bookRoom ? ' is-on' : ''}${s.done ? ' is-done' : ''}`, role: 'tab', 'aria-selected': r.id === _bookRoom ? 'true' : 'false',
        dataset: { room: r.id }, 'data-say': `${r.name}. 도장 ${s.seen}개, 모두 ${s.total}개.`,
      }, h('span', { class: 'xh-room-e emoji', 'aria-hidden': 'true' }, s.done ? '🏅' : r.emoji), h('span', { class: 'xh-room-n' }, r.name), h('span', { class: 'xh-room-c' }, `${s.seen}/${s.total}`));
      b.addEventListener('click', () => { if (_bookRoom === r.id) return; _bookRoom = r.id; G.sfx('page'); renderBook(m); });
      tabs.appendChild(b);
    }
    const room = roomOf(_bookRoom);
    const rs = roomStat(_bookRoom);
    const canWalk = reachable(_bookRoom);
    const introLine = rs.done ? `${room.name} 도장을 모두 모았어요!` : `${room.kid || room.name}${canWalk ? '' : ' 그림을 눌러서 살펴봐요.'}`;
    const intro = h('p', { class: 'xh-room-intro' }, h('span', { class: 'xh-room-intro-t' }, introLine));
    try { G.easy?.speakable?.(intro, () => intro.textContent); } catch (e) { /* voice optional */ }
    // stamps
    const grid = h('div', { class: 'xh-stamps', role: 'list', 'aria-label': `${room.name} 도장` });
    grid.dataset.walk = canWalk ? '1' : '0';
    (byPlace()[_bookRoom] || []).forEach((ex, i) => {
      const seen = isSeen(ex.id);
      const b = h('button', {
        type: 'button', class: `xh-stamp${seen ? ' is-seen' : ''}${!seen && !canWalk ? ' is-open' : ''}`, role: 'listitem', dataset: { exhibit: ex.id },
        'aria-label': seen ? `${ex.title}, 도장을 모았어요` : canWalk ? `${ex.title}, 아직 못 봤어요` : `${ex.title}, 눌러서 살펴봐요`,
        'data-say': seen ? `${ex.title}. ${ex.kid}` : canWalk ? `${ex.title}. 아직 못 봤어요. ${room.name}에서 찾아봐요.` : `${ex.title}. 눌러서 살펴봐요.`,
      }, h('span', { class: 'xh-stamp-face', 'aria-hidden': 'true' }, h('span', { class: 'emoji' }, seen ? ex.emoji : canWalk ? '❔' : '🔎')), h('span', { class: 'xh-stamp-t' }, ex.title));
      b.style.setProperty('--i', String(Math.min(i, 14)));
      b.addEventListener('click', () => {
        if (!canWalk) visitByBook(_bookRoom);
        if (isSeen(ex.id) || !canWalk) { G.sfx('click'); openCard(ex.id, { via: 'book' }); return; }
        const line = `${room.name}에서 ${josa(ex.title, '을/를')} 찾아봐요!`;
        toast(line, { type: 'info', emoji: '🔎', sound: false });
        say(line, { priority: 1 });
      });
      grid.appendChild(b);
    });
    // the room's motions: playable once the player has been in the room (or met one of its exhibits)
    const mo = h('div', { class: 'xh-book-motions' });
    const visited = !canWalk || Number(PL()?.visits?.[_bookRoom]) > 0 || rs.seen > 0;
    for (const mid of room.motions || []) {
      const d = MD()[mid];
      if (!d || !DRAW[mid]) continue;
      const openOk = visited || isWatched(mid);
      const b = h('button', { type: 'button', class: `xh-mo-btn${isWatched(mid) ? ' is-seen' : ''}${openOk ? '' : ' is-locked'}`, dataset: { motion: mid }, 'data-say': openOk ? `움직이는 그림. ${d.title}` : `${d.title}. ${room.name}에 가면 볼 수 있어요.` },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, openOk ? '🎞️' : '🔒'), h('span', { class: 'xh-mo-t' }, d.title), isWatched(mid) ? h('span', { class: 'xh-mo-ok', 'aria-label': '다 봤어요' }, '✅') : null);
      b.addEventListener('click', () => {
        if (!openOk) { const line = `${room.name}에 가면 볼 수 있어요!`; toast(line, { type: 'info', emoji: '🔒', sound: false }); say(line, { priority: 1 }); return; }
        api.motion(mid, { from: { book: true } });
      });
      mo.appendChild(b);
    }
    body.append(head, tabs, intro, grid);
    if (mo.childElementCount) body.append(h('p', { class: 'xh-mo-head' }, '움직이는 그림'), mo);
    if (!kid) body.appendChild(h('p', { class: 'xh-book-foot' }, canWalk ? '방 안의 물건·그림을 살펴보면 도장이 찍혀요. 찍힌 도장을 누르면 다시 읽을 수 있어요.' : '이 방은 도감에서 바로 살펴볼 수 있어요. 그림을 누르면 도장이 찍혀요.'));
    const g2 = body.querySelector('.xh-stamps');
    if (g2 && keepScroll) g2.scrollTop = keepScroll;
  }
  const refreshBook = () => { const m = G.ui.modal.get('exhibit-book'); if (m) renderBook(m); };

  // ================================================================ motion engine
  const SW = 960, SH = 540;     // the logical stage every drawing uses (16:9)
  const FONT = "PretendardEmbed, Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  const FPS = 30;
  const DRAW = {};              // motionId -> { anim: s per step | [s…], hold: s, draw(c, s) }
  let _fonts = null;
  /** the embedded font must be ready before canvas text is drawn (a data: face decodes asynchronously) */
  function fontsReady() {
    if (_fonts) return _fonts;
    try {
      const F = document.fonts;
      _fonts = F && F.load ? Promise.race([Promise.all([F.load(`700 30px ${FONT}`, '가'), F.load(`400 30px ${FONT}`, '가')]), new Promise((r) => setTimeout(r, 1500))]).then(() => true, () => true) : Promise.resolve(true);
    } catch (e) { _fonts = Promise.resolve(true); }
    return _fonts;
  }

  /** one drawing surface: sizes the canvas, keeps the static layers of a motion, renders a frame */
  function makeStage(canvas, motionId) {
    const D = DRAW[motionId];
    const def = MD()[motionId] || { steps: [] };
    const c = canvas.getContext('2d');
    const cache = new Map();
    let k = 1, failed = false;
    const stage = {
      canvas, motionId, frames: 0,
      /** pixel size from the CSS width (or a fixed width): DPR-aware, capped at 1280 px wide */
      fit(cssW) {
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const w = Math.max(160, Math.min(1280, Math.round((cssW || canvas.clientWidth || 640) * dpr)));
        stage.size(w, Math.round(w * SH / SW));
      },
      size(w, hh) {
        if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; cache.clear(); }
        k = w / SW;
      },
      /** a static layer: drawn once per pixel size into an offscreen canvas, then blitted */
      layer(key, fn) {
        let o = cache.get(key);
        if (!o) {
          o = document.createElement('canvas');
          o.width = canvas.width; o.height = canvas.height;
          const c2 = o.getContext('2d');
          c2.setTransform(k, 0, 0, k, 0, 0);
          fn(c2);
          cache.set(key, o);
        }
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.drawImage(o, 0, 0); c.restore();
      },
      render(step, p, t, o = {}) {
        if (!canvas.width || !D) return;
        c.setTransform(k, 0, 0, k, 0, 0);
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        c.clearRect(0, 0, SW, SH);
        const pp = Math.min(0.9999, Math.max(0, Number(p) || 0));      // the last frame of a step still belongs to it
        const s = { step, p: pp, g: step + pp, t, still: !!o.still, n: def.steps.length, layer: stage.layer };
        try { c.save(); D.draw(c, s); c.restore(); }
        catch (e) { c.restore(); if (!failed) { failed = true; G.log.warn(CAT, `motion ${motionId} draw failed`, e?.message || e); } }
        if (o.caption) drawBoardText(c, def, step);
        stage.frames++;
      },
      dispose() { cache.clear(); _stages.delete(stage); try { canvas.width = 0; canvas.height = 0; } catch (e) { /* detached */ } },
    };
    _stages.add(stage);
    return stage;
  }
  const animOf = (D, i) => (Array.isArray(D.anim) ? (D.anim[i] ?? 3.4) : (D.anim || 3.4));

  // ================================================================ the motion player (modal)
  let _player = null;
  function openMotion(id, opts = {}) {
    const def = MD()[id], D = DRAW[id];
    if (!def || !D) { toast('이 움직이는 그림은 아직 준비하고 있어요.', { type: 'info', emoji: '🎞️' }); return null; }
    if (_player) { _player.noReopen = true; try { _player.dispose(); } catch (e) { /* already gone */ } _player = null; }
    const n = def.steps.length;
    const still = reduceMotion();
    const from = opts.from || {};
    const ctl = { id, step: 0, p: 0, t: 0, el: 0, playing: !still, still, done: false, raf: 0, last: 0, lastDraw: 0, voice: false, disposed: false, wasPlaying: false, stage: null };
    const cv = h('canvas', { class: 'xh-canvas', role: 'img', 'aria-label': def.title });
    const chip = h('div', { class: 'xh-step-chip', 'aria-hidden': 'true' });
    const capT = h('span', { class: 'xh-cap-t' });
    const cap = h('p', { class: 'xh-cap', 'aria-live': 'polite' }, capT);
    const dots = h('div', { class: 'xh-dots', 'aria-hidden': 'true' });
    const mk = (cls, emoji, label, sayLine) => h('button', { type: 'button', class: `xh-btn ${cls}`, 'aria-label': label, 'data-say': sayLine || label },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'xh-btn-l' }, label));
    const bPrev = mk('xh-prev', '⏮️', '앞으로', '앞 장면으로 가요');
    const bPlay = mk('xh-play', '⏸️', '멈춤', '멈추기');
    const bNext = mk('xh-next', '⏭️', '다음', '다음 장면으로 가요');
    const m = G.ui.modal.open({
      id: 'exhibit-motion', size: 'lg', className: 'xh-motion-modal', title: def.title, icon: '🎞️', autofocus: false,
      say: def.title,
      onClose: () => { ctl.dispose(); if (_player === ctl) _player = null; if (!ctl.noReopen) reopen(); },
    });
    const reopen = () => {
      // back to where the player came from: the card, the 도감, or nowhere (a board in the room)
      if (from.card && X()[from.card]) setTimeout(() => openCard(from.card, { via: 'back', preview: !!from.preview }), 30);
      else if (from.book) setTimeout(() => refreshBook(), 30);
    };
    try { G.easy?.speakable?.(cap, () => capT.textContent); } catch (e) { /* voice optional */ }
    const note = still ? h('p', { class: 'xh-still-note' }, '움직임 줄이기가 켜져 있어 그림이 멈춰 있어요. ⏭️ 다음을 눌러요.') : null;
    m.body.classList.add('xh-motion-body');
    m.body.appendChild(h('div', { class: 'xh-motion' },
      h('div', { class: 'xh-stage' }, cv, chip),
      h('div', { class: 'xh-side' }, cap, dots, h('div', { class: 'xh-ctl' }, bPrev, bPlay, bNext), note)));
    const stage = ctl.stage = makeStage(cv, id);

    const paint = () => { if (ctl.disposed) return; stage.render(ctl.step, ctl.still ? 1 : ctl.p, ctl.still ? 1.2 : ctl.t, { still: ctl.still }); ctl.lastDraw = performance.now(); };
    const syncUi = (announce, first) => {
      const s = def.steps[ctl.step];
      capT.textContent = s.caption;
      cap.dataset.say = s.say;
      cv.setAttribute('aria-label', `${def.title}. ${s.caption}`);
      chip.textContent = `${ctl.step + 1} / ${n}`;
      dots.textContent = '';
      for (let i = 0; i < n; i++) dots.appendChild(h('i', { class: i === ctl.step ? 'on' : i < ctl.step ? 'seen' : '' }));
      bPrev.disabled = ctl.step === 0;
      const again = ctl.done && !ctl.playing;
      bPlay.querySelector('.emoji').textContent = again ? '🔁' : ctl.playing ? '⏸️' : '▶️';
      bPlay.querySelector('.xh-btn-l').textContent = again ? '처음부터' : ctl.playing ? '멈춤' : '재생';
      bPlay.setAttribute('aria-label', again ? '처음부터 다시 보기' : ctl.playing ? '멈춤' : '재생');
      bPlay.dataset.say = again ? '처음부터 다시 봐요' : ctl.playing ? '멈추기' : '재생하기';
      bNext.disabled = ctl.step >= n - 1 && ctl.done;
      if (announce) {
        ctl.voice = true;
        const mine = ++ctl.voiceSeq;
        say(s.say, { interrupt: !first, priority: 1 }).then(() => { if (ctl.voiceSeq === mine) ctl.voice = false; });
        // a voice that never reports back (no engine) must not hold the story: it is released by the timer below
      }
    };
    ctl.voiceSeq = 0;
    const finish = () => {
      ctl.done = true; ctl.playing = false;
      const fresh = from.preview ? false : markWatched(id);
      G.bus.emit('exhibit:motion', { id, done: true, first: fresh });
      if (fresh) { toast('움직이는 그림을 끝까지 봤어요!', { type: 'success', emoji: '🎞️', sound: false }); G.sfx('correct'); }
      syncUi(false);
    };
    const go = (i, o = {}) => {
      i = U.clamp(Math.floor(i), 0, n - 1);
      ctl.step = i; ctl.p = 0; ctl.el = 0;
      if (o.keepDone !== true) ctl.done = false;
      syncUi(true, !!o.first);
      paint();
      if (ctl.playing) loop();
    };
    const tick = (now) => {
      ctl.raf = 0;
      if (ctl.disposed || !ctl.playing || document.hidden) return;
      // real time, also on a slow device where frames are far apart (one long stall counts as a second at most)
      const dt = Math.min(1, Math.max(0, (now - ctl.last) / 1000));
      ctl.last = now;
      ctl.t += dt; ctl.el += dt;
      const anim = ctl.still ? 0.01 : animOf(D, ctl.step);
      const hold = ctl.still ? 5 : (D.hold ?? 2.2);
      ctl.p = Math.min(1, ctl.el / anim);
      if (ctl.el >= anim + hold && (!ctl.voice || ctl.el >= anim + hold + 6)) {
        if (ctl.step < n - 1) { go(ctl.step + 1); return; }
        finish(); paint(); return;
      }
      if (!ctl.still && now - ctl.lastDraw >= 1000 / FPS - 2) paint();
      ctl.raf = requestAnimationFrame(tick);
    };
    const loop = () => { if (ctl.raf || ctl.disposed) return; ctl.last = performance.now(); ctl.raf = requestAnimationFrame(tick); };
    const setPlaying = (on) => {
      if (ctl.disposed) return;
      if (on && ctl.done) { ctl.done = false; ctl.playing = true; go(0); return; }
      ctl.playing = !!on;
      if (!on && ctl.raf) { cancelAnimationFrame(ctl.raf); ctl.raf = 0; }
      syncUi(false);
      if (on) loop(); else paint();
    };
    const step = (d) => {
      const to = ctl.step + d;
      if (to < 0 || to > n - 1) { if (d > 0 && !ctl.done) { ctl.p = 1; ctl.el = 1e3; finish(); paint(); } return; }
      go(to);
      if (!ctl.playing) { ctl.p = 1; paint(); } // a paused player shows the finished picture of the step it lands on
    };
    bPrev.addEventListener('click', () => { G.sfx('click'); step(-1); });
    bNext.addEventListener('click', () => { G.sfx('click'); step(1); });
    bPlay.addEventListener('click', () => { G.sfx('click'); setPlaying(!ctl.playing); });
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if ((e.key === ' ' || e.key === 'Spacebar') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); setPlaying(!ctl.playing); }
    };
    m.el.addEventListener('keydown', onKey);
    const onVis = () => {
      if (ctl.disposed) return;
      if (document.hidden) { ctl.wasPlaying = ctl.playing; if (ctl.raf) { cancelAnimationFrame(ctl.raf); ctl.raf = 0; } }
      else if (ctl.wasPlaying && ctl.playing) loop();
    };
    document.addEventListener('visibilitychange', onVis);
    let ro = null;
    const resize = () => { if (ctl.disposed) return; stage.fit(cv.clientWidth); paint(); };
    try { if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(resize); ro.observe(cv); } } catch (e) { ro = null; }
    window.addEventListener('resize', resize);
    ctl.dispose = () => {
      if (ctl.disposed) return;
      ctl.disposed = true; ctl.playing = false;
      if (ctl.raf) cancelAnimationFrame(ctl.raf);
      ctl.raf = 0;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', resize);
      m.el.removeEventListener('keydown', onKey);
      try { ro?.disconnect(); } catch (e) { /* gone */ }
      stage.dispose();
      try { if (easyOn()) G.easy?.stop?.(); } catch (e) { /* voice optional */ }
    };
    // public handle (tests, demo): play / pause / next / prev / go / state
    ctl.play = () => setPlaying(true);
    ctl.pause = () => setPlaying(false);
    ctl.next = () => step(1);
    ctl.prev = () => step(-1);
    ctl.go = (i) => { go(i); if (!ctl.playing) { ctl.p = 1; paint(); } };
    ctl.modal = m;
    _player = ctl;
    m._motion = id;
    stage.fit(cv.clientWidth);
    go(0, { first: true });
    fontsReady().then(() => { if (!ctl.disposed) { stage.fit(cv.clientWidth); paint(); } });
    G.bus.emit('exhibit:motion', { id, done: false });
    return m;
  }

  // ================================================================ in-world board
  const BOARD_HZ = 10;
  function drawBoardText(c, def, step) {
    // a board has no DOM caption: the title sits in a chip, the caption in a band (text only — no emoji glyphs)
    const cap = String(def.steps[step]?.caption || '');
    c.save();
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(38, 26, 16, 0.80)';
    c.fillRect(0, SH - 84, SW, 84);
    let size = 40;
    c.font = `700 ${size}px ${FONT}`;
    while (size > 24 && c.measureText(cap).width > SW - 60) { size -= 2; c.font = `700 ${size}px ${FONT}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff6e0';
    c.fillText(cap, SW / 2, SH - 42);
    c.font = `700 26px ${FONT}`;
    const tw = c.measureText(def.title).width;
    c.fillStyle = 'rgba(255, 246, 224, 0.92)';
    rr(c, 18, 16, tw + 36, 46, 23); c.fill();
    c.textAlign = 'left'; c.fillStyle = '#4a321d';
    c.fillText(def.title, 36, 40);
    c.restore();
  }
  function makeBoard(motionId, opts = {}) {
    const def = MD()[motionId], D = DRAW[motionId];
    if (!def || !D || typeof THREE === 'undefined') return null;
    const w = U.clamp(Math.round(Number(opts.w) || 512), 128, 512);
    const hh = Math.min(288, Math.round(w * SH / SW));
    const canvas = document.createElement('canvas');
    const stage = makeStage(canvas, motionId);
    stage.size(w, hh);
    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const n = def.steps.length;
    const poster = def.poster || [0, 1];
    const b = { motionId, canvas, texture, step: 0, el: 0, t: 0, acc: 1, redraws: 0, disposed: false, still: false };
    const frozen = () => reduceMotion() || G.sys.engine?.quality === 'low';
    const draw = () => { stage.render(b.step, b.still ? 1 : Math.min(1, b.el / animOf(D, b.step)), b.still ? 1.2 : b.t, { still: b.still, caption: true }); texture.needsUpdate = true; b.redraws++; };
    b.update = (dt) => {
      if (b.disposed) return false;
      dt = Math.min(0.25, Math.max(0, Number(dt) || 0));
      const fz = frozen();
      if (fz) {
        // one still frame: the poster step, redrawn only when the mode just changed
        if (!b.still || b.step !== poster[0]) { b.still = true; b.step = poster[0]; draw(); return true; }
        return false;
      }
      if (b.still) { b.still = false; b.step = 0; b.el = 0; b.acc = 1; }
      b.t += dt; b.el += dt; b.acc += dt;
      if (b.el >= animOf(D, b.step) + 2.4) { b.step = (b.step + 1) % n; b.el = 0; }
      if (b.acc < 1 / BOARD_HZ) return false;
      b.acc = 0;
      draw();
      return true;
    };
    b.dispose = () => { if (b.disposed) return; b.disposed = true; _boards.delete(b); stage.dispose(); try { texture.dispose(); } catch (e) { /* renderer gone */ } };
    b.still = frozen();
    if (b.still) b.step = poster[0];
    draw();
    fontsReady().then(() => { if (!b.disposed) draw(); });
    _boards.add(b);
    return b;
  }
  const _boards = new Set();

  // ================================================================ 3D hooks for the room builders
  const _attached = new Map();   // exhibitId -> interact handle
  function specOf(id) {
    const ex = X()[id];
    if (!ex) return null;
    return {
      id, kind: 'heritage', emoji: ex.emoji, radius: 2.4,
      label: () => `${ex.title} 살펴보기`, kidLabel: () => (isSeen(id) ? `${ex.title} 또 보기` : `${ex.title} 보기`),
      onInteract: () => { openCard(id, { via: 'interact' }); },
    };
  }
  function attach(id, target, opts = {}) {
    const spec = specOf(id);
    if (!spec || !target || !G.interact?.register) return null;
    const isObj = !!target.isObject3D;
    let position = null;
    if (isObj) { const v = new THREE.Vector3(); position = () => target.getWorldPosition(v); }
    else if (typeof target === 'function') position = target;
    else if (Number.isFinite(target.x) && Number.isFinite(target.z)) { const v = new THREE.Vector3(target.x, Number.isFinite(target.y) ? target.y : 0, target.z); position = () => v; }
    if (!position) return null;
    if (Number.isFinite(opts.radius)) spec.radius = U.clamp(opts.radius, 1, 6);
    const reg = G.interact.register(Object.assign(spec, { position, object: isObj ? target : (opts.object || null), priority: Number(opts.priority) || 0 }));
    if (!reg) return null;
    // registering an id again replaces the entry (23-interaction): an old handle must not take the newer one away
    const handle = { id, unregister() { if (_attached.get(id) !== handle) return; _attached.delete(id); try { reg.unregister(); } catch (e) { /* already gone */ } } };
    _attached.set(id, handle);
    return handle;
  }
  function forPlace(placeId) {
    return (byPlace()[placeId] || []).map((e) => ({ id: e.id, anchor: e.anchor, title: e.title, emoji: e.emoji, kid: e.kid, motion: e.motion || null, art: e.art || null, textOnly: !!e.textOnly, seen: isSeen(e.id) }));
  }
  function mount(placeId, anchors, opts = {}) {
    const get = (key) => { try { return anchors instanceof Map ? anchors.get(key) : typeof anchors === 'function' ? anchors(key) : anchors?.[key]; } catch (e) { return null; } };
    const attached = [], missing = [], handles = [];
    for (const ex of byPlace()[placeId] || []) {
      const t = get(ex.anchor);
      const hd = t ? attach(ex.id, t, opts) : null;
      if (hd) { handles.push(hd); attached.push(ex.id); } else missing.push(ex.id);
    }
    return { attached, missing, dispose() { for (const hd of handles.splice(0)) hd.unregister(); } };
  }

  // ================================================================ developer tour (dev center only)
  let _demo = null;
  async function demo(opts = {}) {
    if (_demo) { _demo.stop = true; return _demo.promise; }
    const ms = U.clamp(Number(opts.ms) || 900, 30, 5000);
    const run = { stop: false, exhibits: 0, motions: 0, steps: 0, errors: [] };
    const wait = (t) => new Promise((r) => setTimeout(r, t));
    run.promise = (async () => {
      try {
        const ids = Array.isArray(opts.exhibits) ? opts.exhibits : Object.keys(X());
        for (const id of ids) {
          if (run.stop) break;
          try { const m = openCard(id, { preview: true }); if (!m) throw new Error('no card'); run.exhibits++; await wait(ms); m.close({ instant: true }); }
          catch (e) { run.errors.push(`${id}: ${e?.message || e}`); }
        }
        const mids = Array.isArray(opts.motions) ? opts.motions : Object.keys(MD());
        for (const id of mids) {
          if (run.stop) break;
          try {
            const m = openMotion(id, { from: { preview: true } });
            if (!m || !_player) throw new Error('no player');
            const ctl = _player;
            ctl.pause();
            for (let i = 0; i < MD()[id].steps.length && !run.stop; i++) { ctl.go(i); run.steps++; await wait(ms); }
            run.motions++;
            m.close({ instant: true });
          } catch (e) { run.errors.push(`${id}: ${e?.message || e}`); }
        }
      } finally { _demo = null; }
      return { exhibits: run.exhibits, motions: run.motions, steps: run.steps, errors: run.errors, stopped: run.stop };
    })();
    _demo = run;
    return run.promise;
  }

  // ================================================================ drawing toolkit (shared by the ten motions)
  const TAU = Math.PI * 2;
  const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  /** progress of x inside [a, b] (0 before, 1 after) */
  const seg = (x, a, b) => c01((x - a) / (b - a));
  const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eo = (t) => 1 - Math.pow(1 - t, 3);
  const eob = (t) => { if (t <= 0) return 0; if (t >= 1) return 1; const a = 1.70158, b = a + 1; return 1 + b * Math.pow(t - 1, 3) + a * Math.pow(t - 1, 2); };
  /** a stable pseudo-random number in 0..1 for an index (particles keep their place between frames) */
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const mix = (a, b, t) => { // '#rrggbb' colours
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(lerp(pa >> 16, pb >> 16, t)), g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t)), bl = Math.round(lerp(pa & 255, pb & 255, t));
    return `rgb(${r},${g},${bl})`;
  };
  function rr(c, x, y, w, hh, r) {
    const k = Math.max(0, Math.min(r, w / 2, hh / 2));
    c.beginPath(); c.moveTo(x + k, y); c.arcTo(x + w, y, x + w, y + hh, k); c.arcTo(x + w, y + hh, x, y + hh, k); c.arcTo(x, y + hh, x, y, k); c.arcTo(x, y, x + w, y, k); c.closePath();
  }
  const box = (c, x, y, w, hh, r, fill, stroke, lw) => { rr(c, x, y, w, hh, r); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.stroke(); } };
  const circ = (c, x, y, r, fill, stroke, lw) => { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.stroke(); } };
  const ell = (c, x, y, rx, ry, fill, rot, stroke, lw) => { c.beginPath(); c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot || 0, 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.stroke(); } };
  const ln = (c, x0, y0, x1, y1, stroke, lw, cap) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = stroke; c.lineWidth = lw || 2; c.lineCap = cap || 'round'; c.stroke(); };
  const poly = (c, pts, fill, stroke, lw, open) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (!open) c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.lineJoin = 'round'; c.stroke(); } };
  const lg = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, col] of stops) g.addColorStop(o, col); return g; };
  const rg = (c, x, y, r0, r1, stops) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); for (const [o, col] of stops) g.addColorStop(o, col); return g; };
  /** a soft light: rgb = 'r,g,b' */
  const glow = (c, x, y, r, rgb, a) => { if (a <= 0 || r <= 0) return; c.fillStyle = rg(c, x, y, 0, r, [[0, `rgba(${rgb},${a})`], [1, `rgba(${rgb},0)`]]); c.fillRect(x - r, y - r, r * 2, r * 2); };
  const alpha = (c, a, fn) => { if (a <= 0.003) return; c.save(); c.globalAlpha *= c01(a); fn(); c.restore(); };
  function txt(c, s, x, y, size, color, o = {}) {
    c.font = `${o.w || 700} ${size}px ${FONT}`;
    c.textAlign = o.a || 'center'; c.textBaseline = o.b || 'middle';
    if (o.stroke) { c.lineWidth = o.sw || size * 0.26; c.strokeStyle = o.stroke; c.lineJoin = 'round'; c.strokeText(s, x, y); }
    c.fillStyle = color; c.fillText(s, x, y);
  }
  /** a name tag: a rounded pill with an optional leader line to the thing it names */
  function tag(c, s, x, y, o = {}) {
    const size = o.size || 30;
    c.font = `700 ${size}px ${FONT}`;
    const w = c.measureText(s).width + size * 1.1, hh = size * 1.55;
    if (o.to) { ln(c, x, y, o.to[0], o.to[1], o.line || 'rgba(74,50,29,.75)', 3); circ(c, o.to[0], o.to[1], 6, o.line || '#4a321d'); }
    c.save(); c.shadowColor = 'rgba(40,24,10,.28)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
    box(c, x - w / 2, y - hh / 2, w, hh, hh / 2, o.fill || '#fffaf0');
    c.restore();
    box(c, x - w / 2, y - hh / 2, w, hh, hh / 2, null, o.edge || '#b98a4e', 2.5);
    txt(c, s, x, y + 1, size, o.color || '#4a321d');
  }
  /** warm hanji paper with fibres and a soft vignette (the common backdrop) */
  function paper(c, tint) {
    c.fillStyle = lg(c, 0, 0, 0, SH, [[0, tint?.[0] || '#fbf3df'], [1, tint?.[1] || '#f1e2c0']]);
    c.fillRect(0, 0, SW, SH);
    c.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = rnd(i) * SW, y = rnd(i + 200) * SH, a = rnd(i + 400) * TAU, l = 8 + rnd(i + 600) * 22;
      ln(c, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, `rgba(150,112,60,${0.05 + rnd(i + 800) * 0.07})`, 1.2);
    }
    c.fillStyle = rg(c, SW / 2, SH / 2, SH * 0.45, SH * 1.05, [[0, 'rgba(120,80,30,0)'], [1, 'rgba(120,80,30,.16)']]);
    c.fillRect(0, 0, SW, SH);
  }
  /** a gentle flame: k = size 0..1, t = time (flicker ≈ 1 Hz, small amplitude — far below the 3 Hz limit) */
  function flame(c, x, y, s, t, k) {
    if (k <= 0.01) return;
    const w = s * (0.75 + 0.25 * k), hh = s * 1.5 * k;
    const sway = Math.sin(t * 5.2) * s * 0.05, f = 1 + Math.sin(t * 6.3 + 1) * 0.05;
    const one = (dx, sw, sh, col) => {
      c.beginPath();
      c.moveTo(x + dx - sw / 2, y);
      c.bezierCurveTo(x + dx - sw * 0.75, y - sh * 0.45, x + dx - sw * 0.1 + sway, y - sh * 0.6, x + dx + sway * 1.6, y - sh * f);
      c.bezierCurveTo(x + dx + sw * 0.2 + sway, y - sh * 0.55, x + dx + sw * 0.8, y - sh * 0.4, x + dx + sw / 2, y);
      c.closePath(); c.fillStyle = col; c.fill();
    };
    glow(c, x, y - hh * 0.35, s * 1.9 * k, '255,150,60', 0.32 * k);
    one(-w * 0.22, w * 0.62, hh * 0.72, '#ff7a2e');
    one(w * 0.24, w * 0.58, hh * 0.64, '#ff8a3c');
    one(0, w * 0.8, hh, '#ff9a3c');
    one(0, w * 0.5, hh * 0.66, '#ffc94a');
    one(0, w * 0.24, hh * 0.36, '#fff3c2');
  }
  /** a friendly face (eyes that blink slowly + a smile) for the little characters */
  function face(c, x, y, s, t, o = {}) {
    const blink = (t % 3.6) > 3.42 ? 0.15 : 1;
    const ex = s * 0.3, ey = -s * 0.08, er = s * 0.11;
    c.fillStyle = o.ink || '#2b2118';
    ell(c, x - ex, y + ey, er, er * blink, o.ink || '#2b2118');
    ell(c, x + ex, y + ey, er, er * blink, o.ink || '#2b2118');
    if (blink === 1) { circ(c, x - ex + er * 0.3, y + ey - er * 0.35, er * 0.35, '#fff'); circ(c, x + ex + er * 0.3, y + ey - er * 0.35, er * 0.35, '#fff'); }
    c.beginPath(); c.arc(x, y + s * 0.1, s * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = o.ink || '#2b2118'; c.lineWidth = Math.max(1.5, s * 0.07); c.lineCap = 'round'; c.stroke();
    if (o.blush !== false) { ell(c, x - s * 0.52, y + s * 0.14, s * 0.12, s * 0.08, 'rgba(255,120,120,.45)'); ell(c, x + s * 0.52, y + s * 0.14, s * 0.12, s * 0.08, 'rgba(255,120,120,.45)'); }
  }
  /** half-width of an onggi jar at height u (0 = foot, 1 = lip) from a profile {base, belly, bellyY, shoulder, shoulderY, mouth} */
  function jarHalf(pr, u) {
    const pts = [[0, pr.base], [pr.bellyY, pr.belly], [pr.shoulderY, pr.shoulder], [0.95, pr.mouth * 0.94], [1, pr.mouth]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [u0, w0] = pts[i], [u1, w1] = pts[i + 1];
      if (u <= u1 || i === pts.length - 2) { const k = c01((u - u0) / Math.max(1e-6, u1 - u0)); const e = k * k * (3 - 2 * k); return lerp(w0, w1, e); }
    }
    return pr.mouth;
  }
  const JAR = { base: 0.52, belly: 1, bellyY: 0.52, shoulder: 0.88, shoulderY: 0.8, mouth: 0.62 };
  function jarPath(c, cx, footY, W, H, pr) {
    const N = 26;
    c.beginPath();
    for (let i = 0; i <= N; i++) { const u = i / N; const x = cx - jarHalf(pr, u) * W, y = footY - u * H; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    for (let i = N; i >= 0; i--) { const u = i / N; c.lineTo(cx + jarHalf(pr, u) * W, footY - u * H); }
    c.closePath();
  }
  /** an onggi jar: cx, footY = where it stands, W = half of its widest width, H = height; o = {pr, lid, tone, wet} */
  function jar(c, cx, footY, W, H, o = {}) {
    const pr = o.pr || JAR;
    const dark = o.tone === 'light' ? '#8a5230' : '#5b3320', mid = o.tone === 'light' ? '#b9743f' : '#8a5230', hi = o.tone === 'light' ? '#d99a5c' : '#b9743f';
    if (o.shadow !== false) ell(c, cx, footY + H * 0.02, W * 0.9, H * 0.07, 'rgba(60,36,14,.22)');
    jarPath(c, cx, footY, W, H, pr);
    c.fillStyle = lg(c, cx - W, 0, cx + W, 0, [[0, dark], [0.28, hi], [0.5, mid], [1, dark]]);
    c.fill();
    c.save(); jarPath(c, cx, footY, W, H, pr); c.clip();
    c.fillStyle = lg(c, 0, footY - H, 0, footY, [[0, 'rgba(255,220,170,.10)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(30,14,4,.35)']]);
    c.fillRect(cx - W, footY - H, W * 2, H);
    ell(c, cx - W * 0.42, footY - H * 0.56, W * 0.1, H * 0.24, 'rgba(255,236,200,.30)', -0.12);   // glaze highlight
    c.restore();
    const mw = jarHalf(pr, 1) * W, top = footY - H;
    ell(c, cx, top, mw, H * 0.035, '#3b2115');                                                 // the mouth
    if (o.lid !== false) {
      const ly = top - H * 0.02 - (o.lidUp || 0);
      ell(c, cx, ly, mw * 1.16, H * 0.05, '#6b3d25');
      ell(c, cx, ly - H * 0.025, mw * 1.02, H * 0.04, '#8a5230');
      ell(c, cx, ly - H * 0.06, mw * 0.22, H * 0.035, '#5b3320');
    }
  }
  /** a block of meju tied with straw rope */
  function meju(c, x, y, w, hh, o = {}) {
    box(c, x - w / 2, y - hh / 2, w, hh, hh * 0.22, lg(c, 0, y - hh / 2, 0, y + hh / 2, [[0, '#c99a5a'], [1, '#9c6f3a']]), '#7a5328', 2.5);
    for (let i = 0; i < 6; i++) circ(c, x - w * 0.36 + rnd(i + (o.seed || 0)) * w * 0.72, y - hh * 0.3 + rnd(i + 9 + (o.seed || 0)) * hh * 0.6, 2.2, 'rgba(110,74,34,.55)');
    if (o.rope) { ln(c, x - w * 0.18, y - hh / 2, x - w * 0.18, y + hh / 2, '#e2c27a', 5); ln(c, x + w * 0.18, y - hh / 2, x + w * 0.18, y + hh / 2, '#e2c27a', 5); }
    if (o.mold) for (let i = 0; i < 9; i++) alpha(c, o.mold, () => circ(c, x - w * 0.4 + rnd(i + 30) * w * 0.8, y - hh * 0.36 + rnd(i + 50) * hh * 0.72, 3 + rnd(i + 70) * 3, i % 3 ? 'rgba(255,255,245,.85)' : 'rgba(250,224,120,.85)'));
  }
  /** a sun with soft rays (the rays turn slowly) */
  function sun(c, x, y, r, t, o = {}) {
    glow(c, x, y, r * 3.2, o.rgb || '255,206,90', 0.35);
    c.save(); c.translate(x, y); c.rotate(t * 0.15);
    c.strokeStyle = o.ray || '#ffc94a'; c.lineWidth = r * 0.16; c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; c.beginPath(); c.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3); c.lineTo(Math.cos(a) * r * (i % 2 ? 1.62 : 1.85), Math.sin(a) * r * (i % 2 ? 1.62 : 1.85)); c.stroke(); }
    c.restore();
    circ(c, x, y, r, rg(c, x - r * 0.3, y - r * 0.3, r * 0.1, r * 1.1, [[0, '#fff3b8'], [1, o.core || '#ffc23a']]), '#f0a418', 3);
  }
  /** smoke puffs rising from (x, y): k = amount 0..1 */
  function smoke(c, x, y, t, k, o = {}) {
    if (k <= 0.01) return;
    const n = o.n || 6, rise = o.rise || 120;
    for (let i = 0; i < n; i++) {
      const ph = ((t * (o.speed || 0.22) + i / n) % 1);
      const px = x + Math.sin((ph * 2 + i) * 2.1) * (10 + ph * 22) + (o.drift || 0) * ph;
      const py = y - ph * rise;
      alpha(c, k * (1 - ph) * 0.55, () => circ(c, px, py, (o.size || 12) * (0.6 + ph * 1.3), o.col || '#d9d2c6'));
    }
  }

  // ================================================================ MOTION DRAWINGS
  // Each drawing: DRAW[id] = { anim (seconds a step animates), hold (seconds it rests), draw(c, s) } with
  // s = { step, p (0..1 inside the step), g = step + p, t (seconds of play time), still, layer(key, fn) }.
  // A drawing is a pure function of (g, t): stepping back and forth, the poster frame and reduce-motion stills (p = 1)
  // all come from the same code.
  /** a polyline as a track: at(u) → the point at the fraction u of its length, trace(c, u0, u1) → a path between two fractions */
  function track(pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = L[L.length - 1];
    const at = (u) => {
      const d = c01(u) * len;
      let i = 1;
      while (i < L.length - 1 && L[i] < d) i++;
      const k = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
      return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
    };
    const trace = (c, u0, u1) => {
      const d0 = c01(u0) * len, d1 = c01(u1) * len, a = at(u0), b = at(u1);
      c.beginPath(); c.moveTo(a[0], a[1]);
      for (let i = 1; i < L.length; i++) if (L[i] > d0 && L[i] < d1) c.lineTo(pts[i][0], pts[i][1]);
      c.lineTo(b[0], b[1]);
    };
    return { len, at, trace, frac: (i) => L[i] / len };
  }
  /** a tag that fades in during step `from` (and stays) */
  const tagAt = (c, s, from, text, x, y, o) => alpha(c, eo(seg(s.g, from + 0.25, from + 0.6)), () => tag(c, text, x, y, o));

  // ---------------------------------------------------------------- 구들에 불이 지나가는 길 (a room in cross-section)
  DRAW.MG_GUDEUL = (() => {
    const GY = 452, FL = 330, SLAB = 16, X0 = 300, X1 = 770, NS = 7;
    const SLW = (X1 - X0 - 8) / NS;
    const flueFloor = (x) => lerp(440, 386, c01((x - X0) / (X1 - X0)));     // lowest at the 아궁이, rising to the 굴뚝
    const pts = [[212, 432], [262, 422], [300, 406]];
    for (let i = 1; i <= 10; i++) { const x = X0 + (X1 - X0) * i / 10; pts.push([x, (FL + SLAB + flueFloor(x)) / 2 + 2]); }
    pts.push([792, 402], [826, 421], [866, 421]);
    const iFlue = pts.length - 1;
    pts.push([868, 380], [868, 300], [868, 226], [868, 176]);
    const way = track(pts);
    const uFlue = way.frac(iFlue), uThroat = way.frac(3);
    const cavity = (c) => {      // the hollow under the floor + the firebox + the 개자리 + the chimney shaft
      c.beginPath();
      c.moveTo(172, 400); c.lineTo(286, 400); c.lineTo(300, 392); c.lineTo(X0, FL + SLAB); c.lineTo(790, FL + SLAB);
      c.lineTo(810, 404); c.lineTo(850, 404); c.lineTo(850, 160); c.lineTo(886, 160); c.lineTo(886, 438);
      c.lineTo(784, 438); c.lineTo(776, flueFloor(X1)); c.lineTo(X0, flueFloor(X0)); c.lineTo(290, GY - 2); c.lineTo(172, GY - 2);
      c.closePath();
    };
    function base(c) {
      paper(c, ['#f7efe0', '#efdfbd']);
      // far hills and ground
      c.fillStyle = '#e3d6b4'; c.beginPath(); c.moveTo(0, 300); c.quadraticCurveTo(140, 210, 300, 290); c.quadraticCurveTo(520, 190, 720, 280); c.quadraticCurveTo(860, 230, SW, 290); c.lineTo(SW, GY); c.lineTo(0, GY); c.closePath(); c.fill();
      c.fillStyle = lg(c, 0, GY, 0, SH, [[0, '#c7a36c'], [1, '#a47d49']]); c.fillRect(0, GY, SW, SH - GY);
      // the earth the room stands on (the flue is dug into it)
      box(c, X0 - 14, FL + 4, X1 - X0 + 34, GY - FL + 20, 8, lg(c, 0, FL, 0, GY + 20, [[0, '#caa672'], [1, '#a98352']]));
      box(c, 780, 392, 130, GY - 392 + 14, 8, lg(c, 0, 392, 0, GY + 14, [[0, '#c4a06c'], [1, '#a98352']]));
      // kitchen floor + the 부뚜막 (stove) of clay and stone
      poly(c, [[138, GY + 4], [138, 386], [150, 378], [300, 378], [300, GY + 4]], lg(c, 0, 378, 0, GY, [[0, '#d2b083'], [1, '#b08a58']]), '#8c693c', 3);
      for (let i = 0; i < 9; i++) ell(c, 150 + rnd(i) * 140, 388 + rnd(i + 20) * 60, 9 + rnd(i + 40) * 8, 5 + rnd(i + 60) * 4, 'rgba(120,86,46,.22)', rnd(i) * 3);
      // the hollow way of the fire
      c.save(); cavity(c); c.fillStyle = lg(c, 0, 340, 0, GY, [[0, '#4a3324'], [1, '#2c1d14']]); c.fill(); c.strokeStyle = '#7a5a3a'; c.lineWidth = 3; c.stroke(); c.restore();
      // 굄돌: the little stone piers that carry the floor stones
      for (let i = 1; i < NS; i++) { const x = X0 + 4 + i * SLW; const fy = flueFloor(x); box(c, x - 7, FL + SLAB, 14, fy - FL - SLAB + 2, 3, '#7d766a', '#5c564c', 1.5); }
      // chimney
      box(c, 842, 150, 52, GY - 150 + 6, 6, null, '#8c693c', 0);
      c.fillStyle = lg(c, 842, 0, 894, 0, [[0, '#c9a678'], [0.5, '#dcc097'], [1, '#b89462']]);
      c.fillRect(838, 160, 12, GY - 160); c.fillRect(886, 160, 12, GY - 160);
      box(c, 830, 146, 76, 16, 5, '#6b4a2c');
      poly(c, [[826, 146], [868, 118], [910, 146]], '#55585f', '#3d4046', 2);
      // walls, posts and beams of the room
      c.fillStyle = '#f6ecd4'; c.fillRect(X0, 140, X1 - X0, FL - 140 - 8);
      c.fillStyle = lg(c, 0, 140, 0, FL, [[0, 'rgba(120,90,50,.10)'], [1, 'rgba(120,90,50,0)']]); c.fillRect(X0, 140, X1 - X0, FL - 148);
      // a paper window with its lattice
      box(c, 470, 176, 150, 112, 4, '#fff8e6', '#6b4429', 6);
      for (let i = 1; i < 6; i++) ln(c, 470 + i * 25, 178, 470 + i * 25, 286, '#8a623c', 2.5, 'butt');
      for (const y of [196, 232, 268]) ln(c, 472, y, 618, y, '#8a623c', 2.5, 'butt');
      for (const x of [X0 - 6, X1 - 10]) box(c, x, 132, 16, FL - 132, 3, lg(c, x, 0, x + 16, 0, [[0, '#5a3820'], [0.5, '#84532f'], [1, '#5a3820']]));
      box(c, X0 - 30, 124, X1 - X0 + 60, 18, 4, '#6b4429');
      // kitchen side: an open shed roof post
      box(c, 96, 150, 14, GY - 150, 3, '#6b4429');
      // tiled roof
      c.beginPath(); c.moveTo(34, 138); c.quadraticCurveTo(430, 176, 826, 138); c.lineTo(690, 62); c.lineTo(170, 62); c.closePath();
      c.fillStyle = lg(c, 0, 58, 0, 166, [[0, '#5d636d'], [1, '#3c4048']]); c.fill(); c.strokeStyle = '#2b2e34'; c.lineWidth = 3; c.lineJoin = 'round'; c.stroke();
      c.save(); c.clip(); c.strokeStyle = 'rgba(20,22,26,.55)'; c.lineWidth = 5;
      for (let i = 0; i <= 30; i++) { const k = i / 30; ln(c, lerp(170, 690, k), 60, lerp(34, 826, k), 170, 'rgba(20,22,26,.5)', 5, 'butt'); ln(c, lerp(170, 690, k) + 5, 60, lerp(34, 826, k) + 6, 170, 'rgba(255,255,255,.10)', 2, 'butt'); }
      c.restore();
      c.beginPath(); c.moveTo(34, 138); c.quadraticCurveTo(430, 176, 826, 138); c.strokeStyle = '#2b2e34'; c.lineWidth = 9; c.lineCap = 'round'; c.stroke();
      box(c, 158, 50, 544, 18, 9, '#42464e', '#2b2e34', 2.5);
      // the floor finish over the stones (clay + oiled paper)
      c.fillStyle = '#e9cf8f'; c.fillRect(X0 + 10, FL - 8, X1 - X0 - 20, 8);
      c.fillStyle = 'rgba(120,80,30,.28)'; c.fillRect(X0 + 10, FL - 1.5, X1 - X0 - 20, 1.5);
      // a cushion and a small table in the room
      box(c, 330, FL - 26, 100, 18, 9, '#c0453a', '#8f2f27', 2); box(c, 336, FL - 22, 88, 6, 3, 'rgba(255,255,255,.22)');
      box(c, 650, FL - 46, 74, 8, 3, '#7a4a2a'); ln(c, 660, FL - 38, 656, FL - 8, '#6b4429', 5); ln(c, 714, FL - 38, 718, FL - 8, '#6b4429', 5);
      // firewood at the mouth of the 아궁이
      c.save(); c.translate(150, 438); c.rotate(-0.12); box(c, -62, -7, 80, 13, 6, '#7a4f2c', '#5a3820', 2); c.restore();
      c.save(); c.translate(150, 446); c.rotate(0.06); box(c, -74, -6, 86, 12, 6, '#8a5a34', '#5a3820', 2); c.restore();
    }
    function pot(c) {      // the iron pot on the stove (drawn over the flame)
      c.fillStyle = lg(c, 186, 0, 274, 0, [[0, '#26272b'], [0.4, '#45464d'], [1, '#222327']]);
      c.beginPath(); c.moveTo(184, 376); c.quadraticCurveTo(188, 408, 230, 408); c.quadraticCurveTo(272, 408, 276, 376); c.closePath(); c.fill();
      ell(c, 230, 375, 52, 9, '#3a3b41'); ell(c, 230, 369, 43, 8, '#9a6e44', 0, '#5a3820', 2); box(c, 221, 354, 18, 11, 5, '#5a3820');
    }
    function cat(c, x, y, t) {
      const br = 1 + Math.sin(t * 1.4) * 0.03;
      ell(c, x, y + 12, 44, 8, 'rgba(60,36,14,.18)');
      ell(c, x, y - 4, 40, 20 * br, '#f0b56a', 0, '#b9792f', 2.5);
      circ(c, x - 32, y - 8, 17, '#f0b56a', '#b9792f', 2.5);
      poly(c, [[x - 46, y - 18], [x - 42, y - 34], [x - 33, y - 23]], '#f0b56a', '#b9792f', 2.5);
      poly(c, [[x - 30, y - 24], [x - 22, y - 36], [x - 18, y - 20]], '#f0b56a', '#b9792f', 2.5);
      c.strokeStyle = '#6a421a'; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.arc(x - 38, y - 9, 4, 0.1 * Math.PI, 0.9 * Math.PI); c.stroke();
      c.beginPath(); c.arc(x - 26, y - 9, 4, 0.1 * Math.PI, 0.9 * Math.PI); c.stroke();
      c.beginPath(); c.moveTo(x + 34, y + 2); c.quadraticCurveTo(x + 58, y + 4, x + 44, y - 16); c.strokeStyle = '#b9792f'; c.lineWidth = 7; c.stroke();
    }
    return {
      anim: 3.6, hold: 2.2,
      draw(c, s) {
        const g = s.g, t = s.t;
        const fire = eo(seg(g, 0.08, 0.75));
        const head = g < 1 ? 0 : g < 2 ? lerp(0, uThroat * 1.5, eio(seg(g, 1.05, 1.9))) : lerp(uThroat * 1.5, uFlue, eio(seg(g, 2.05, 2.92)));
        const warm = (i) => eo(seg(g, 3.05 + i * 0.1, 3.4 + i * 0.1));
        const up = eio(seg(g, 4.05, 4.7));
        const cosy = eio(seg(g, 5.05, 5.8));
        s.layer('base', base);
        // light of the fire in the firebox
        glow(c, 226, 430, 120 * fire, '255,140,50', 0.5 * fire);
        // the heat finds its way: only inside the hollow
        if (head > 0) {
          c.save(); cavity(c); c.clip();
          way.trace(c, 0, head); c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = 'rgba(255,110,40,.34)'; c.lineWidth = 36; c.stroke();
          c.strokeStyle = 'rgba(255,165,60,.62)'; c.lineWidth = 21; c.stroke();
          c.strokeStyle = 'rgba(255,230,160,.92)'; c.lineWidth = 7; c.stroke();
          for (let i = 0; i < 16; i++) {
            const u = (((s.still ? 0.3 : t * 0.14) + i / 16) % 1) * head;
            const q = way.at(u);
            circ(c, q[0], q[1] + Math.sin(t * 2.6 + i * 1.7) * 5, 4.2, 'rgba(255,248,210,.95)');
          }
          const hq = way.at(head);
          glow(c, hq[0], hq[1], 46, '255,200,110', 0.75);
          c.restore();
        }
        // smoke through the 개자리 and up the chimney
        if (up > 0) {
          c.save(); cavity(c); c.clip();
          way.trace(c, uFlue - 0.02, lerp(uFlue, 1, up)); c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = 'rgba(200,196,188,.5)'; c.lineWidth = 30; c.stroke();
          c.strokeStyle = 'rgba(235,232,226,.6)'; c.lineWidth = 14; c.stroke();
          c.restore();
          smoke(c, 868, 150, t, seg(up, 0.85, 1), { n: 7, rise: 130, drift: 60, size: 13, col: '#cfc9bd' });
        }
        // 구들장: the floor stones, warming one after another
        for (let i = 0; i < NS; i++) {
          const x = X0 + 4 + i * SLW, w = warm(i);
          box(c, x + 1.5, FL, SLW - 3, SLAB, 4, mix('#a6a297', '#ff7b3d', w * 0.9), mix('#77736a', '#c2491c', w), 2);
          if (w > 0.02) {
            glow(c, x + SLW / 2, FL + 4, 54, '255,150,70', 0.45 * w);
            c.strokeStyle = `rgba(255,150,70,${0.6 * w})`; c.lineWidth = 3; c.lineCap = 'round';
            for (let j = 0; j < 2; j++) {
              const bx = x + SLW * (0.3 + j * 0.4), ph = (s.still ? 0.4 : t * 0.5) + i * 0.37 + j * 0.5, rise = (ph % 1) * 18;
              c.beginPath(); c.moveTo(bx, FL - 14 - rise);
              c.bezierCurveTo(bx - 7, FL - 24 - rise, bx + 7, FL - 34 - rise, bx, FL - 46 - rise);
              c.globalAlpha = 1 - (ph % 1) * 0.7; c.stroke(); c.globalAlpha = 1;
            }
          }
        }
        // the fire itself (in front of the firebox wall)
        flame(c, 226, 449, 31, t, fire);
        s.layer('pot', pot);
        if (fire > 0.3) smoke(c, 230, 350, t, (fire - 0.3) * 0.9, { n: 4, rise: 64, size: 8, col: '#ffffff', speed: 0.3 });
        // a warm room at the end
        if (cosy > 0) {
          alpha(c, cosy, () => { c.fillStyle = 'rgba(255,170,90,.20)'; c.fillRect(X0 + 10, 168, X1 - X0 - 20, FL - 176); glow(c, 545, 240, 140, '255,224,150', 0.5); });
          alpha(c, eo(seg(cosy, 0.3, 1)), () => cat(c, 545, FL - 22, t));
        }
        tagAt(c, s, 0, '아궁이', 96, 320, { to: [160, 424] });
        tagAt(c, s, 2, '고래', 664, 428, { to: [600, 384] });
        tagAt(c, s, 3, '구들장', 400, 250, { to: [404, FL + 8] });
        tagAt(c, s, 4, '굴뚝', 780, 200, { to: [846, 240] });
      },
    };
  })();

  /** a tag that is shown only while step `i` is on (fades in early in the step, out when the next one starts) */
  const tagNow = (c, s, i, text, x, y, o) => alpha(c, eo(seg(s.g, i + 0.22, i + 0.55)) * (1 - seg(s.g, i + 1, i + 1.18)), () => tag(c, text, x, y, o));
  /** how much of scene `i` shows: in during the first quarter of its step, out during the first quarter of the next */
  const sceneA = (s, i, last) => (i === 0 ? 1 : seg(s.g, i, i + 0.25)) * (last ? 1 : 1 - seg(s.g, i + 1, i + 1.25));

  /** a jar with a window into it: level 0..1 of a liquid, inside(ly) draws what is in it (clipped to the window) */
  function jarCut(c, cx, footY, W, H, level, liquid, inside, pr) {
    pr = pr || JAR;
    jar(c, cx, footY, W, H, { lid: false, pr });
    c.save();
    c.beginPath();
    const N = 20;
    for (let i = 0; i <= N; i++) { const u = lerp(0.07, 0.9, i / N); const x = cx - jarHalf(pr, u) * W * 0.8, y = footY - u * H; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    for (let i = N; i >= 0; i--) { const u = lerp(0.07, 0.9, i / N); c.lineTo(cx + jarHalf(pr, u) * W * 0.8, footY - u * H); }
    c.closePath(); c.fillStyle = '#2b1a12'; c.fill(); c.clip();
    const ly = footY - H * lerp(0.07, 0.84, c01(level));
    if (level > 0) { c.fillStyle = liquid; c.fillRect(cx - W, ly, W * 2, footY - ly); c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(cx - W, ly, W * 2, 5); }
    if (inside) inside(ly);
    c.restore();
  }

  // ---------------------------------------------------------------- 옹기가 숨 쉬는 원리 (a zoom into the wall of a jar)
  DRAW.MG_ONGGI_BREATH = (() => {
    const LUMP = { base: 0.95, belly: 1, bellyY: 0.45, shoulder: 0.96, shoulderY: 0.8, mouth: 0.9 };
    const prMix = (a, b, k) => { const o = {}; for (const key of Object.keys(a)) o[key] = lerp(a[key], b[key], k); return o; };
    const WX0 = 330, WX1 = 630;            // the wall in the close-up
    // clay grains of the wall and the places where water sits between them
    const grains = [];
    for (let r = 0; r < 9; r++) for (let q = 0; q < 6; q++) {
      const i = r * 6 + q;
      grains.push([WX0 + 24 + q * 50 + (r % 2) * 25 + (rnd(i) - 0.5) * 14, 24 + r * 62 + (rnd(i + 99) - 0.5) * 18, 21 + rnd(i + 7) * 9, 17 + rnd(i + 13) * 8, rnd(i + 31) * 3]);
    }
    const drops = [];
    for (let j = 0; j < 15; j++) { const k = j % 5, x = WX0 + 44 + Math.floor(j / 5) * 104 + (rnd(j + 3) - 0.5) * 30; const i = (x - WX0) / ((WX1 - WX0) / 24); drops.push([x, 62 + k * 104 + Math.sin(i * 0.52 + k * 2.1) * 16]); }
    // five little ways through the wall (each passes close to pores)
    const ways = [0, 1, 2, 3, 4].map((k) => {
      const y = 62 + k * 104;
      const pts = [];
      for (let i = -6; i <= 30; i++) { const x = WX0 + i * (WX1 - WX0) / 24; pts.push([x, y + Math.sin(i * 0.52 + k * 2.1) * 16 * c01((i + 6) / 6) * c01((30 - i) / 6)]); }
      return track(pts);
    });
    function kilnBack(c) {
      // a brick kiln: the dark mouth the jar stands in
      c.fillStyle = '#5a3524'; c.beginPath(); c.moveTo(240, 468); c.lineTo(240, 250); c.quadraticCurveTo(240, 70, 480, 70); c.quadraticCurveTo(720, 70, 720, 250); c.lineTo(720, 468); c.closePath(); c.fill();
      c.fillStyle = rg(c, 480, 330, 30, 300, [[0, '#7a3a1c'], [1, '#2c1a12']]); c.beginPath(); c.moveTo(276, 468); c.lineTo(276, 256); c.quadraticCurveTo(276, 108, 480, 108); c.quadraticCurveTo(684, 108, 684, 256); c.lineTo(684, 468); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,220,190,.22)'; c.lineWidth = 2;
      for (let i = 0; i < 9; i++) { const a = Math.PI + (i + 0.5) * Math.PI / 9; ln(c, 480 + Math.cos(a) * 204, 256 + Math.sin(a) * 150 * 1.0 + 0, 480 + Math.cos(a) * 240, 256 + Math.sin(a) * 186, 'rgba(255,220,190,.25)', 2, 'butt'); }
      for (let y = 280; y < 468; y += 34) { ln(c, 240, y, 276, y, 'rgba(255,220,190,.25)', 2, 'butt'); ln(c, 684, y, 720, y, 'rgba(255,220,190,.25)', 2, 'butt'); }
    }
    function sceneJar(c, s, mode) {     // mode 0 = made and fired (steps 0–2), 1 = the finished jar outside (step 5)
      const g = s.g, t = s.t;
      if (mode === 0) {
        const shape = eio(seg(g, 0.05, 0.85)), fired = eio(seg(g, 1.15, 1.9)), kiln = eio(seg(g, 1.0, 1.35));
        const pr = prMix(LUMP, JAR, shape), H = lerp(120, 276, shape), W = lerp(118, 138, shape);
        alpha(c, kiln, () => { kilnBack(c); glow(c, 480, 420, 300, '255,130,40', 0.55 * fired); });
        // the potter's wheel under the wet clay (it stops turning when the shape is done)
        alpha(c, 1 - kiln, () => {
          ell(c, 480, 452, 190, 26, '#8d6a48', 0, '#5f432b', 3); ell(c, 480, 444, 190, 26, '#b08a62', 0, '#5f432b', 3);
          const spin = s.still ? 0.6 : t * 2.2 * (1 - shape);
          for (let i = 0; i < 6; i++) { const a = spin + i * TAU / 6; if (Math.sin(a) > -0.2) ln(c, 480 + Math.cos(a) * 60, 444 + Math.sin(a) * 8, 480 + Math.cos(a) * 180, 444 + Math.sin(a) * 24, 'rgba(95,67,43,.35)', 3); }
        });
        // the jar: wet clay first, fired brown later
        c.save();
        if (fired > 0 && fired < 1) { /* both tones are drawn and blended */ }
        jar(c, 480, 440, W, H, { pr, lid: false, tone: 'light', shadow: kiln > 0.5 });
        alpha(c, fired, () => jar(c, 480, 440, W, H, { pr, lid: false, shadow: false }));
        alpha(c, fired * (1 - seg(g, 2.0, 2.2)), () => { c.save(); jarPath(c, 480, 440, W, H, pr); c.clip(); c.fillStyle = `rgba(255,120,40,${0.28 + (s.still ? 0 : Math.sin(t * 2.1) * 0.05)})`; c.fillRect(300, 120, 360, 340); c.restore(); });
        c.restore();
        if (kiln > 0) { flame(c, 314, 466, 52, t, kiln * (0.6 + 0.4 * fired)); flame(c, 646, 466, 52, t + 1.7, kiln * (0.6 + 0.4 * fired)); flame(c, 392, 468, 36, t + 0.6, kiln * fired); flame(c, 568, 468, 36, t + 2.6, kiln * fired); flame(c, 480, 470, 28, t + 3.4, kiln * fired); }
        // the magnifier that tells where the close-up looks
        alpha(c, seg(g, 1.75, 2.0), () => { circ(c, 596, 300, 40, 'rgba(255,255,255,.18)', '#fff6dc', 6); ln(c, 624, 328, 660, 364, '#fff6dc', 9); });
      } else {
        const br = s.still ? 1 : 1 + Math.sin(t * 1.7) * 0.012;
        // the jar stands on a stone in the yard, among smaller jars
        c.fillStyle = lg(c, 0, 400, 0, SH, [[0, '#d9c59a'], [1, '#c2a876']]); c.fillRect(0, 430, SW, SH - 430);
        box(c, 250, 432, 460, 26, 8, '#a9a59b', '#807c72', 2.5);
        jar(c, 300, 436, 62, 124, {}); jar(c, 668, 436, 74, 150, {});
        c.save(); c.translate(480, 440); c.scale(br, br); c.translate(-480, -440);
        jar(c, 480, 440, 150, 300, {});
        c.restore();
        // air drifting in and out: soft curls on both sides
        for (let i = 0; i < 6; i++) {
          const side = i % 2 ? 1 : -1, ph = ((s.still ? 0.35 : t * 0.22) + i / 6) % 1, y = 190 + (i >> 1) * 80;
          const inw = i % 4 < 2;
          const d = inw ? lerp(150, 40, ph) : lerp(40, 150, ph);
          const x = 480 + side * (150 + d);
          c.strokeStyle = `rgba(110,170,215,${0.75 * Math.sin(ph * Math.PI)})`; c.lineWidth = 6; c.lineCap = 'round';
          c.beginPath(); c.moveTo(x - side * 30, y); c.bezierCurveTo(x - side * 10, y - 16, x + side * 10, y + 16, x + side * 30, y - 2); c.stroke();
          const ax = inw ? x - side * 30 : x + side * 30, dir = inw ? -side : side;
          poly(c, [[ax + dir * 12, y - (inw ? 0 : 2)], [ax - dir * 4, y - 10], [ax - dir * 4, y + 10]], `rgba(110,170,215,${0.8 * Math.sin(ph * Math.PI)})`);
        }
      }
    }
    function wallBase(c) {
      // inside the jar (left) · the clay wall · the air outside (right)
      c.fillStyle = lg(c, 0, 0, WX0, 0, [[0, '#2f1d14'], [1, '#4a2f20']]); c.fillRect(0, 0, WX0, SH);
      c.fillStyle = lg(c, WX1, 0, SW, 0, [[0, '#dff0f4'], [1, '#f4fbfb']]); c.fillRect(WX1, 0, SW - WX1, SH);
      c.fillStyle = '#7d4a2c'; c.fillRect(WX0, 0, WX1 - WX0, SH);
      for (const [x, y, rx, ry, rot] of grains) ell(c, x, y, rx, ry, lg(c, x - rx, y - ry, x + rx, y + ry, [[0, '#c98d58'], [1, '#a26738']]), rot, 'rgba(90,50,24,.5)', 1.5);
      c.fillStyle = lg(c, WX0, 0, WX0 + 26, 0, [[0, 'rgba(40,20,10,.55)'], [1, 'rgba(40,20,10,0)']]); c.fillRect(WX0, 0, 26, SH);   // glaze skin, inside
      c.fillStyle = lg(c, WX1 - 26, 0, WX1, 0, [[0, 'rgba(40,20,10,0)'], [1, 'rgba(40,20,10,.5)']]); c.fillRect(WX1 - 26, 0, 26, SH);
    }
    function sceneWall(c, s) {
      const g = s.g, t = s.t;
      s.layer('wall', wallBase);
      const heat = 1 - eio(seg(g, 3.0, 3.6));
      if (heat > 0) alpha(c, heat * 0.55, () => { c.fillStyle = 'rgba(255,110,40,.5)'; c.fillRect(0, 0, SW, SH); });
      const leave = seg(g, 2.3, 3.0), open = seg(g, 3.05, 3.9), air = seg(g, 4.02, 4.4);
      // pores and the ways between them
      if (open > 0) {
        for (let k = 0; k < ways.length; k++) {
          const q = eio(seg(open, k * 0.08, 0.6 + k * 0.08));
          if (q <= 0) continue;
          ways[k].trace(c, 0.15, lerp(0.15, 0.85, q)); c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = 'rgba(38,20,12,.9)'; c.lineWidth = 11; c.stroke();
          c.strokeStyle = 'rgba(150,200,235,.45)'; c.lineWidth = 4; c.stroke();
        }
      }
      drops.forEach(([x, y], j) => {
        const d = eio(seg(leave, j * 0.03, 0.62 + j * 0.03));
        const pore = eob(seg(open, j * 0.035, 0.34 + j * 0.035));
        if (pore > 0) ell(c, x, y, 17 * pore, 11 * pore, '#24130b', 0, 'rgba(150,200,235,.35)', 2);
        if (d < 1) {
          const out = x < (WX0 + WX1) / 2 ? -1 : 1;
          const px = x + out * d * 190 + (s.still ? 0 : Math.sin(t * 2 + j) * 3 * d), py = y - d * 40;
          alpha(c, 1 - d * d, () => {
            if (d < 0.25) {       // a drop of water between the grains
              c.fillStyle = lg(c, px, py - 20, px, py + 16, [[0, '#b8e4ff'], [1, '#3f9be0']]);
              c.beginPath(); c.moveTo(px, py - 22); c.bezierCurveTo(px + 19, py - 3, px + 16, py + 16, px, py + 16); c.bezierCurveTo(px - 16, py + 16, px - 19, py - 3, px, py - 22); c.fill();
              c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2; c.stroke();
              circ(c, px - 5, py + 2, 4, 'rgba(255,255,255,.85)');
            } else { circ(c, px, py, 12 + d * 14, `rgba(235,245,250,${0.85 - d * 0.5})`); circ(c, px + 13, py - 10, 8 + d * 9, 'rgba(235,245,250,.5)'); }
          });
        }
      });
      // air goes through, both ways
      if (air > 0) {
        for (let k = 0; k < ways.length; k++) for (let i = 0; i < 4; i++) {
          const dir = (k + i) % 2 ? 1 : -1;
          let u = (((s.still ? 0.3 : t * 0.09) + i / 4 + k * 0.13) % 1);
          if (dir < 0) u = 1 - u;
          const q = ways[k].at(u), fade = Math.sin(c01(dir < 0 ? 1 - u : u) * Math.PI);
          alpha(c, air * (0.35 + 0.65 * fade), () => { ln(c, q[0] - dir * 10, q[1], q[0] - dir * 30, q[1], 'rgba(232,246,255,.75)', 5); circ(c, q[0], q[1], 9.5, '#e8f6ff', '#5ea6d8', 3); });
        }
        alpha(c, air, () => { tag(c, '그릇 안', 150, 60, { size: 28 }); tag(c, '바깥', 800, 60, { size: 28 }); tag(c, '공기', 800, 280, { size: 30, fill: '#e9f6ff', edge: '#6fb2e0', color: '#1f5d8a' }); });
      }
      tagNow(c, s, 2, '물기', 150, 300, { size: 30, fill: '#e9f6ff', edge: '#6fb2e0', color: '#1f5d8a' });
      tagNow(c, s, 3, '작은 구멍', 150, 300, { size: 30 });
    }
    return {
      anim: 3.8, hold: 2.2,
      draw(c, s) {
        const g = s.g;
        s.layer('paper', (c2) => paper(c2));
        // zoom: into the wall during step 2, back out during step 5
        const zin = eio(seg(g, 2.0, 2.42)), zout = eio(seg(g, 5.0, 5.45));
        if (zin < 1) {
          c.save(); const z = 1 + zin * 6; c.translate(596, 300); c.scale(z, z); c.translate(-596, -300); c.globalAlpha = 1 - zin; sceneJar(c, s, 0); c.restore();
        }
        if (zin > 0 && zout < 1) {
          c.save(); const z = lerp(0.55, 1, zin) * lerp(1, 0.4, zout); c.translate(480, 270); c.scale(z, z); c.translate(-480, -270); c.globalAlpha = zin * (1 - zout);
          rr(c, 0, 0, SW, SH, zin < 1 || zout > 0 ? 40 : 0); c.clip(); sceneWall(c, s); c.restore();
        }
        if (zout > 0) { alpha(c, zout, () => sceneJar(c, s, 1)); tagNow(c, s, 5, '숨 쉬는 그릇', 480, 86, { size: 34 }); }
      },
    };
  })();

  // ---------------------------------------------------------------- 장 담그기 열두 달 (a ring calendar that turns)
  DRAW.MG_JANG_YEAR = (() => {
    const CX = 232, CY = 250, RO = 190, RI = 124;
    const SEASON = ['#bcd9f0', '#bcd9f0', '#c7e6a8', '#bfe3a0', '#a9dc8e', '#86cf7c', '#7cc874', '#8fcf70', '#f3d67a', '#f2bd66', '#eea85a', '#c9def0'];
    const AT = [10, 12, 13, 15, 15.6, 19, 23];                 // the month under the pointer at each step (unwrapped)
    const ARC = [[9, 12], [11, 13], [12, 15], [14.3, 15.6], [14.3, 15.6], [16, 23], [23, 24]];
    const monthAt = (g) => { const i = Math.min(AT.length - 1, Math.floor(g)); const a = AT[Math.max(0, i - 1)], b = AT[i]; return i === 0 ? AT[0] : lerp(a, b, eio(seg(g, i, i + 0.55))); };
    function ring(c, s) {
      const g = s.g, mon = monthAt(g), rot = -(mon + 0.5) * (TAU / 12);
      const i = Math.min(ARC.length - 1, Math.floor(g));
      c.save(); c.translate(CX, CY);
      ell(c, 0, 8, RO + 6, RO + 6, 'rgba(60,36,14,.16)');
      c.rotate(rot);
      for (let m = 0; m < 24; m++) {      // two turns are drawn so the unwrapped months 12–23 are there too
        const mm = m % 12, a0 = -Math.PI / 2 + m * TAU / 12, a1 = a0 + TAU / 12;
        if (m >= 12 && mon < 6) continue;
        if (m < 12 && mon > 18) continue;
        c.beginPath(); c.arc(0, 0, RO, a0, a1); c.arc(0, 0, RI, a1, a0, true); c.closePath();
        c.fillStyle = SEASON[mm]; c.fill(); c.strokeStyle = 'rgba(90,60,30,.35)'; c.lineWidth = 2; c.stroke();
      }
      // the time of this step, marked on the rim
      const arc = ARC[i], prev = ARC[Math.max(0, i - 1)], k = i === 0 ? 1 : eio(seg(g, i, i + 0.5));
      const b0 = lerp(prev[0], arc[0], k), b1 = lerp(prev[1], arc[1], k);
      c.beginPath(); c.arc(0, 0, RO + 10, -Math.PI / 2 + b0 * TAU / 12, -Math.PI / 2 + b1 * TAU / 12);
      c.strokeStyle = '#d9482b'; c.lineWidth = 12; c.lineCap = 'round'; c.stroke();
      for (let m = 0; m < 12; m++) {
        const a = -Math.PI / 2 + (m + 0.5) * TAU / 12, r = (RO + RI) / 2;
        c.save(); c.translate(Math.cos(a) * r, Math.sin(a) * r); c.rotate(-rot);
        txt(c, `${m + 1}월`, 0, 1, 27, '#4a321d'); c.restore();
      }
      c.restore();
      // hub: the season under the pointer
      circ(c, CX, CY, RI - 8, '#fffaf0', '#b98a4e', 4);
      const mo = ((Math.floor(mon) % 12) + 12) % 12;
      const season = mo === 11 || mo < 2 ? 0 : mo < 5 ? 1 : mo < 8 ? 2 : 3;
      const t = s.t;
      if (season === 0) {        // winter: a snow crystal
        c.save(); c.translate(CX, CY - 6); c.rotate(s.still ? 0 : t * 0.1); c.strokeStyle = '#6aa9d8'; c.lineWidth = 7; c.lineCap = 'round';
        for (let j = 0; j < 6; j++) { c.rotate(TAU / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -56); c.moveTo(0, -34); c.lineTo(-14, -48); c.moveTo(0, -34); c.lineTo(14, -48); c.stroke(); }
        c.restore();
      } else if (season === 1) { // spring: a sprout
        ln(c, CX, CY + 44, CX, CY - 18, '#4f9a3f', 8);
        ell(c, CX - 26, CY - 24, 28, 15, '#7cc874', -0.5, '#4f9a3f', 3); ell(c, CX + 26, CY - 34, 28, 15, '#8fd67e', 0.5, '#4f9a3f', 3);
        ell(c, CX, CY + 50, 56, 12, '#b98a5c');
      } else if (season === 2) sun(c, CX, CY - 4, 34, t);
      else {                     // autumn: a leaf
        c.save(); c.translate(CX, CY - 4); c.rotate(-0.3 + (s.still ? 0 : Math.sin(t * 1.2) * 0.06));
        c.fillStyle = '#e8873a'; c.beginPath(); c.moveTo(0, -56); c.bezierCurveTo(52, -30, 46, 30, 0, 58); c.bezierCurveTo(-46, 30, -52, -30, 0, -56); c.fill();
        ln(c, 0, -46, 0, 70, '#9a4d18', 5); for (const y of [-20, 4, 28]) { ln(c, 0, y, 24, y - 16, '#9a4d18', 3); ln(c, 0, y, -24, y - 16, '#9a4d18', 3); }
        c.restore();
      }
      // pointer
      poly(c, [[CX - 20, CY - RO - 34], [CX + 20, CY - RO - 34], [CX, CY - RO - 2]], '#d9482b', '#8f2a16', 3);
    }
    const SX = 690, SY = 300;     // the middle of the scene on the right
    function sceneBoil(c, s) {    // 메주 빚기
      const a = seg(s.g, 0, 1), t = s.t;
      box(c, SX - 230, SY + 130, 460, 24, 10, '#a47a4c', '#7a5530', 2.5);
      // an iron pot of boiled beans
      c.fillStyle = lg(c, SX - 250, 0, SX - 30, 0, [[0, '#26272b'], [0.4, '#4a4b52'], [1, '#222327']]);
      c.beginPath(); c.moveTo(SX - 250, SY - 30); c.quadraticCurveTo(SX - 240, SY + 96, SX - 140, SY + 96); c.quadraticCurveTo(SX - 40, SY + 96, SX - 30, SY - 30); c.closePath(); c.fill();
      ell(c, SX - 140, SY - 30, 114, 22, '#4a4b52'); ell(c, SX - 140, SY - 33, 96, 15, '#e2c27a');
      for (let i = 0; i < 16; i++) circ(c, SX - 214 + rnd(i) * 148, SY - 40 + rnd(i + 5) * 12, 8, '#f0d48a', '#b9953f', 1.5);
      smoke(c, SX - 140, SY - 56, t, 0.8, { n: 5, rise: 110, size: 13, col: '#ffffff', speed: 0.28 });
      for (let k = 0; k < 3; k++) { const q = eob(seg(a, 0.25 + k * 0.2, 0.55 + k * 0.2)); if (q > 0) { c.save(); c.translate(SX + 60 + k * 104 - (k === 2 ? 156 : 0), SY + 94 - (k === 2 ? 74 : 0)); c.scale(q, q); meju(c, 0, 0, 110, 70, { seed: k * 4 }); c.restore(); } }
    }
    function sceneHang(c, s) {    // 메주 띄우기
      const a = seg(s.g, 1, 2), t = s.t;
      box(c, SX - 200, SY - 150, 400, 16, 6, '#7a4f2c', '#5a3820', 2.5);
      for (let k = 0; k < 3; k++) {
        const x = SX - 130 + k * 130, sw = s.still ? 0 : Math.sin(t * 1.3 + k) * 0.035;
        c.save(); c.translate(x, SY - 136); c.rotate(sw);
        ln(c, 0, 0, 0, 86, '#e2c27a', 6);
        meju(c, 0, 126, 96, 78, { rope: true, mold: eo(seg(a, 0.3, 1)), seed: k * 7 });
        c.restore();
      }
      // a sheaf of rice straw underneath
      for (let i = 0; i < 16; i++) ln(c, SX - 150 + i * 20, SY + 132, SX - 170 + i * 22 + (rnd(i) - 0.5) * 30, SY + 92 - rnd(i + 3) * 12, i % 2 ? '#e2c27a' : '#d1ad5c', 6);
      box(c, SX - 190, SY + 122, 380, 16, 8, '#c9a04e');
      for (let i = 0; i < 9; i++) { const ph = ((s.still ? 0.4 : t * 0.07) + rnd(i)) % 1; alpha(c, 0.8, () => circ(c, SX - 250 + rnd(i + 20) * 520, SY - 230 + ph * 440, 4 + rnd(i + 40) * 3, '#ffffff')); }
    }
    function sceneBrine(c, s) {   // 장 담그기
      const a = seg(s.g, 2, 3);
      const lvl = eio(seg(a, 0.1, 0.7));
      jarCut(c, SX, SY + 140, 170, 330, lvl, '#c7a468', (ly) => {
        for (let k = 0; k < 3; k++) { const d = eio(seg(a, 0.05 + k * 0.1, 0.5 + k * 0.1)); meju(c, SX - 76 + k * 76, lerp(SY - 260, ly + 30 + (k % 2) * 10 + (s.still ? 0 : Math.sin(s.t * 1.1 + k) * 3), d), 70, 46, { seed: k * 5 }); }
        const f = eob(seg(a, 0.72, 0.95));
        if (f > 0) { box(c, SX - 100, ly - 9 * f, 46 * f, 16 * f, 6, '#27221f'); box(c, SX + 54, ly - 8 * f, 40 * f, 15 * f, 6, '#27221f');
          c.save(); c.translate(SX - 16, ly - 2); c.rotate(-0.3); ell(c, 0, 0, 30 * f, 9 * f, '#d9342b'); ln(c, -30 * f, 0, -40 * f, -6 * f, '#3f8a3a', 4); c.restore(); }
      });
      // salt water being poured
      const pour = seg(a, 0.08, 0.2) * (1 - seg(a, 0.6, 0.72));
      alpha(c, pour, () => { c.fillStyle = 'rgba(190,225,240,.85)'; c.beginPath(); c.moveTo(SX + 150, SY - 220); c.quadraticCurveTo(SX + 60, SY - 230, SX + 30, SY - 150); c.lineTo(SX + 46, SY - 150); c.quadraticCurveTo(SX + 74, SY - 210, SX + 150, SY - 200); c.closePath(); c.fill();
        c.save(); c.translate(SX + 186, SY - 214); c.rotate(-0.5); c.fillStyle = '#d9b97a'; c.beginPath(); c.arc(0, 0, 50, 0, Math.PI); c.closePath(); c.fill(); c.strokeStyle = '#8f6d32'; c.lineWidth = 3; c.stroke(); ell(c, 0, 0, 50, 10, '#c7e3ef', 0, '#8f6d32', 3); c.restore(); });
      tagNow(c, s, 2, '소금물', SX + 190, SY - 130, { size: 28, to: [SX + 60, SY - 20] });
      alpha(c, seg(a, 0.85, 1), () => tag(c, '숯과 고추', SX - 190, SY - 150, { size: 26, to: [SX - 70, SY - 70] }));
    }
    function sceneSplit(c, s) {   // 장 가르기 → 간장 · 된장
      const g = s.g, a = seg(g, 3, 4), b = seg(g, 4, 5);
      const move = eio(seg(a, 0.25, 0.9));
      const sx = lerp(SX, SX - 120, move);
      jarCut(c, sx, SY + 140, lerp(170, 120, move), lerp(330, 250, move), lerp(0.84, 0.6, move), mix('#c7a468', '#3a2414', move), null);
      // the solids are lifted out into their own jar
      alpha(c, move, () => jarCut(c, SX + 130, SY + 140, 120, 250, 0, '#000', () => {
        c.fillStyle = '#9a6a36'; c.beginPath(); c.moveTo(SX, SY + 140); c.lineTo(SX, SY + 20); c.quadraticCurveTo(SX + 130, SY - 30, SX + 260, SY + 20); c.lineTo(SX + 260, SY + 140); c.closePath(); c.fill();
        for (let i = 0; i < 14; i++) circ(c, SX + 50 + rnd(i) * 160, SY + 20 + rnd(i + 9) * 100, 5, 'rgba(70,42,16,.45)');
      }));
      for (let k = 0; k < 3; k++) {
        const d = eio(seg(a, 0.3 + k * 0.12, 0.75 + k * 0.12));
        if (d < 1) { const x = lerp(SX - 76 + k * 76, SX + 100 + k * 30, d), y = lerp(SY + 70, SY - 20, d) - Math.sin(d * Math.PI) * 150; alpha(c, 1 - seg(d, 0.85, 1), () => meju(c, x, y, 70, 46, { seed: k * 5 })); }
      }
      alpha(c, eo(seg(b, 0.15, 0.5)), () => { tag(c, '간장', SX - 120, SY - 150, { size: 32, to: [SX - 120, SY - 20] }); tag(c, '된장', SX + 130, SY - 150, { size: 32, to: [SX + 130, SY - 20] }); });
    }
    function sceneAge(c, s) {     // 익히기: days and nights pass over the jars
      const t = s.t, ph = s.still ? 0.2 : (t * 0.09) % 1;
      const day = ph < 0.5, k = (ph % 0.5) * 2, x = SX - 220 + k * 440, y = SY - 110 - Math.sin(k * Math.PI) * 110;
      if (day) sun(c, x, y, 26, t); else { circ(c, x, y, 26, '#f6f0cf', '#d9cf96', 3); circ(c, x + 10, y - 6, 22, '#f1e2c0'); }
      box(c, SX - 250, SY + 140, 500, 24, 8, '#a9a59b', '#807c72', 2.5);
      jar(c, SX - 120, SY + 142, 118, 246, {}); jar(c, SX + 130, SY + 142, 118, 246, {});
      for (let i = 0; i < 6; i++) { const q = ((s.still ? 0.5 : t * 0.25) + i / 6) % 1; alpha(c, Math.sin(q * Math.PI) * 0.9, () => { const sx = SX - 200 + rnd(i) * 400, sy = SY - 60 + rnd(i + 4) * 150; ln(c, sx - 9, sy, sx + 9, sy, '#fff3c2', 4); ln(c, sx, sy - 9, sx, sy + 9, '#fff3c2', 4); }); }
    }
    function sceneGift(c, s) {    // 받는 날
      const a = seg(s.g, 6, 7);
      box(c, SX - 250, SY + 140, 500, 24, 8, '#a9a59b', '#807c72', 2.5);
      jar(c, SX - 130, SY + 142, 118, 246, { lidUp: 0 });
      const q = eob(seg(a, 0.2, 0.6));
      c.save(); c.translate(SX + 70, SY + 140); c.scale(q, q);
      box(c, -70, -110, 140, 110, 18, '#b98a5c', '#7a5530', 3); box(c, -78, -128, 156, 26, 10, '#d9c7a0', '#7a5530', 3); txt(c, '된장', 0, -52, 30, '#fffaf0');
      c.restore();
      const q2 = eob(seg(a, 0.38, 0.78));
      c.save(); c.translate(SX + 200, SY + 140); c.scale(q2, q2);
      box(c, -34, -120, 68, 120, 14, '#3a2414', '#1f130a', 3); box(c, -16, -158, 32, 44, 8, '#3a2414', '#1f130a', 3); box(c, -20, -168, 40, 16, 6, '#d9482b'); txt(c, '간장', 0, -58, 24, '#fffaf0');
      c.restore();
      for (let i = 0; i < 7; i++) { const tw = ((s.still ? 0.5 : s.t * 0.3) + i / 7) % 1; alpha(c, Math.sin(tw * Math.PI) * seg(a, 0.5, 0.8), () => { const sx = SX - 60 + rnd(i + 2) * 320, sy = SY - 200 + rnd(i + 8) * 200, r = 10 + rnd(i) * 6; ln(c, sx - r, sy, sx + r, sy, '#ffcf4a', 5); ln(c, sx, sy - r, sx, sy + r, '#ffcf4a', 5); }); }
    }
    const SCENES = [[sceneBoil, 0], [sceneHang, 1], [sceneBrine, 2], [sceneSplit, 3], [sceneAge, 5], [sceneGift, 6]];
    return {
      anim: 3.8, hold: 2.2,
      draw(c, s) {
        s.layer('paper', (c2) => paper(c2));
        ring(c, s);
        for (const [fn, i] of SCENES) {
          // 가르기 covers two steps (3 and 4)
          const a = i === 3 ? seg(s.g, 3, 3.25) * (1 - seg(s.g, 5, 5.25)) : sceneA(s, i, i === 6);
          alpha(c, a, () => fn(c, s));
        }
      },
    };
  })();

  // ---------------------------------------------------------------- 작은 일꾼 미생물 (friendly little workers)
  DRAW.MG_MICROBE = (() => {
    /** a microbe with a face: 'gocho' (green rod) · 'mold' (purple puff) · 'yeast' (yellow, budding) · 'cho' (pink) · 'lac' (blue pair) */
    function bug(c, x, y, sz, kind, t, ph, still) {
      y += still ? 0 : Math.sin(t * 2.2 + ph) * sz * 0.06;
      if (kind === 'gocho') {
        c.strokeStyle = '#3f8a3a'; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - sz, y); c.quadraticCurveTo(x - sz * 1.5, y - sz * 0.5, x - sz * 1.8, y + sz * 0.1); c.stroke();
        box(c, x - sz, y - sz * 0.55, sz * 2, sz * 1.1, sz * 0.55, lg(c, 0, y - sz * 0.55, 0, y + sz * 0.55, [[0, '#a5e29a'], [1, '#6cc063']]), '#3f8a3a', 3);
        face(c, x, y, sz * 0.62, t + ph);
      } else if (kind === 'mold') {
        for (let i = 0; i < 9; i++) { const a = i * TAU / 9 + 0.2; ln(c, x + Math.cos(a) * sz * 0.7, y + Math.sin(a) * sz * 0.7, x + Math.cos(a) * sz * 1.18, y + Math.sin(a) * sz * 1.18, '#9b86d6', 3.5); circ(c, x + Math.cos(a) * sz * 1.24, y + Math.sin(a) * sz * 1.24, sz * 0.15, '#d9cdfa', '#7d68c2', 2); }
        circ(c, x, y, sz * 0.82, rg(c, x - sz * 0.25, y - sz * 0.3, sz * 0.1, sz * 0.9, [[0, '#cdbdf7'], [1, '#a590e8']]), '#7d68c2', 3);
        face(c, x, y, sz * 0.62, t + ph);
      } else if (kind === 'yeast') {
        circ(c, x + sz * 0.72, y - sz * 0.58, sz * 0.34, '#f9d568', '#b9860f', 3);
        ell(c, x, y, sz * 0.92, sz * 0.78, rg(c, x - sz * 0.3, y - sz * 0.3, sz * 0.1, sz, [[0, '#ffe796'], [1, '#f4c453']]), 0, '#b9860f', 3);
        face(c, x, y, sz * 0.62, t + ph);
      } else if (kind === 'cho') {
        box(c, x - sz * 0.85, y - sz * 0.55, sz * 1.7, sz * 1.1, sz * 0.55, lg(c, 0, y - sz * 0.55, 0, y + sz * 0.55, [[0, '#ffc0cf'], [1, '#f58aa6']]), '#c9516f', 3);
        face(c, x, y, sz * 0.6, t + ph);
      } else {
        box(c, x - sz * 1.75, y - sz * 0.42, sz * 1.1, sz * 0.84, sz * 0.42, '#9fd0f5', '#4a8fc4', 3);
        box(c, x - sz * 0.8, y - sz * 0.55, sz * 1.7, sz * 1.1, sz * 0.55, lg(c, 0, y - sz * 0.55, 0, y + sz * 0.55, [[0, '#bfe2fb'], [1, '#86bfee']]), '#4a8fc4', 3);
        face(c, x + sz * 0.05, y, sz * 0.6, t + ph);
      }
    }
    /** workers hopping from one thing to the next: n of them, staggered; a = progress of the step */
    function hop(c, s, a, n, kinds, from, to, sz) {
      for (let k = 0; k < n; k++) {
        const u = eio(seg(a, 0.08 + k * (0.42 / n), 0.5 + k * (0.42 / n)));
        const x0 = from[0] + (rnd(k + 2) - 0.5) * from[2], y0 = from[1] + (rnd(k + 12) - 0.5) * from[3];
        const x1 = to[0] + ((k + 0.5) / n - 0.5) * to[2], y1 = to[1] + (rnd(k + 32) - 0.5) * to[3];
        const x = lerp(x0, x1, u), y = lerp(y0, y1, u) - Math.sin(u * Math.PI) * 96 - (u > 0 && u < 1 ? Math.abs(Math.sin(u * Math.PI * 3)) * 12 : 0);
        bug(c, x, y, sz, kinds[k % kinds.length], s.t, k * 1.3, s.still);
      }
    }
    const LX = 232, RX = 728, BY = 400;       // the thing on the left, the thing on the right, where they stand
    function arrow(c, a) {
      alpha(c, 0.5 * a, () => {
        c.strokeStyle = '#b98a4e'; c.lineWidth = 6; c.lineCap = 'round'; c.setLineDash([4, 18]);
        c.beginPath(); c.moveTo(LX + 130, BY - 60); c.lineTo(RX - 176, BY - 60); c.stroke(); c.setLineDash([]);
        poly(c, [[RX - 150, BY - 60], [RX - 184, BY - 82], [RX - 184, BY - 38]], '#b98a4e');
      });
    }
    function ground(c) { box(c, 60, BY, 840, 22, 11, '#d9c59a', '#b99f6c', 2.5); }
    function sheaf(c, x, y) {
      for (let i = 0; i < 22; i++) { const k = i / 21 - 0.5; ln(c, x + k * 40, y, x + k * 190 + (rnd(i) - 0.5) * 16, y - 190 - rnd(i + 7) * 40, i % 3 ? '#e6c56f' : '#cfa64a', 7); }
      for (let i = 0; i < 12; i++) { const k = i / 11 - 0.5; ln(c, x + k * 36, y, x + k * 70, y + 6, '#cfa64a', 7); }
      box(c, x - 34, y - 78, 68, 20, 8, '#b98a3e', '#8f6a2a', 2.5);
    }
    function cabbage(c, x, y) {
      ell(c, x, y - 70, 92, 74, '#8fcf70', 0, '#4f9a3f', 3);
      ell(c, x - 44, y - 62, 52, 70, '#a9dc8e', -0.35, '#4f9a3f', 3); ell(c, x + 44, y - 62, 52, 70, '#a9dc8e', 0.35, '#4f9a3f', 3);
      ell(c, x, y - 58, 46, 62, '#dff3c4', 0, '#6fb055', 3);
      ln(c, x, y - 8, x, y - 104, '#ffffff', 7); ln(c, x - 44, y - 14, x - 52, y - 96, 'rgba(255,255,255,.8)', 5); ln(c, x + 44, y - 14, x + 52, y - 96, 'rgba(255,255,255,.8)', 5);
    }
    function nuruk(c, x, y) {
      ell(c, x, y - 14, 104, 34, '#c9a878', 0, '#8f6d42', 3); c.fillStyle = '#c9a878'; c.fillRect(x - 104, y - 44, 208, 30);
      ell(c, x, y - 44, 104, 34, '#e2c79a', 0, '#8f6d42', 3);
      for (let i = 0; i < 16; i++) circ(c, x - 80 + rnd(i) * 160, y - 60 + rnd(i + 5) * 30, 3 + rnd(i + 9) * 3, i % 2 ? 'rgba(160,140,220,.8)' : 'rgba(250,224,120,.9)');
    }
    const BOT = { base: 0.5, belly: 1, bellyY: 0.42, shoulder: 0.7, shoulderY: 0.72, mouth: 0.34 };
    const bubbles = (c, s, x, y, w, hh, n) => { for (let i = 0; i < n; i++) { const ph = ((s.still ? 0.4 : s.t * 0.3) + rnd(i + 3)) % 1; circ(c, x - w / 2 + rnd(i + 20) * w, y - ph * hh, 4 + rnd(i) * 4, null, 'rgba(255,255,255,.7)', 2); } };
    const SC = [
      (c, s) => {      // 0 — all the little workers under a looking glass
        const t = s.t, a = seg(s.g, 0, 1);
        ln(c, 632, 392, 760, 500, '#7a4f2c', 30); ln(c, 632, 392, 760, 500, '#9a6a3c', 16);
        circ(c, 480, 256, 214, '#dfeef2', '#7a4f2c', 18); circ(c, 480, 256, 200, rg(c, 420, 190, 20, 260, [[0, '#ffffff'], [1, '#d5ecf2']]));
        c.save(); c.beginPath(); c.arc(480, 256, 198, 0, TAU); c.clip();
        const who = [['gocho', 380, 200], ['mold', 560, 190], ['yeast', 470, 290], ['cho', 360, 330], ['lac', 600, 320]];
        who.forEach(([k, x, y], i) => { const q = eob(seg(a, 0.1 + i * 0.12, 0.4 + i * 0.12)); if (q > 0) { c.save(); c.translate(x, y); c.scale(q, q); bug(c, 0, 0, 44, k, t, i * 1.4, s.still); c.restore(); } });
        c.restore();
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.arc(480, 256, 176, 1.15 * Math.PI, 1.45 * Math.PI); c.stroke();
        tagNow(c, s, 0, '미생물', 190, 110, { size: 34, to: [330, 190] });
      },
      (c, s) => {      // 1 — 볏짚 → 메주
        const a = seg(s.g, 1, 2);
        ground(c); arrow(c, 1); sheaf(c, LX, BY);
        meju(c, RX, BY - 66, 214, 132, { rope: true, mold: seg(a, 0.55, 1), seed: 3 });
        hop(c, s, a, 5, ['gocho'], [LX, BY - 190, 150, 110], [RX, BY - 152, 180, 16], 28);
        tag(c, '볏짚', LX, BY + 48, { size: 30 }); tag(c, '메주', RX, BY + 48, { size: 30 });
        tagNow(c, s, 1, '고초균', 480, BY - 118, { size: 32, fill: '#e6f7e1', edge: '#3f8a3a', color: '#1f5a1b' });
      },
      (c, s) => {      // 2 — 누룩 → 술
        const a = seg(s.g, 2, 3);
        ground(c); arrow(c, 1); nuruk(c, LX, BY);
        const lvl = eio(seg(a, 0.45, 1)) * 0.74;
        jarCut(c, RX, BY, 130, 260, lvl, '#f1ead8', (ly) => { if (lvl > 0.1) bubbles(c, s, RX, BY - 10, 150, BY - 10 - ly - 6, 7); });
        hop(c, s, a, 6, ['mold', 'yeast'], [LX, BY - 90, 150, 30], [RX, BY - 300, 150, 16], 26);
        tag(c, '누룩', LX, BY + 48, { size: 30 }); tag(c, '술', RX, BY + 48, { size: 30 });
        tagNow(c, s, 2, '곰팡이와 효모', 480, BY - 118, { size: 32, fill: '#efeaff', edge: '#7d68c2', color: '#3b2a86' });
      },
      (c, s) => {      // 3 — 술 → 식초
        const a = seg(s.g, 3, 4);
        ground(c); arrow(c, 1);
        jarCut(c, LX, BY, 112, 224, 0.7, '#f1ead8', null);
        const turn = eio(seg(a, 0.5, 1));
        jarCut(c, RX, BY, 118, 250, 0.72, mix('#f1ead8', '#d98a2b', turn), (ly) => { bubbles(c, s, RX, BY - 10, 120, BY - 10 - ly - 6, 4); }, BOT);
        hop(c, s, a, 5, ['cho'], [LX, BY - 256, 120, 14], [RX, BY - 284, 80, 14], 26);
        tag(c, '술', LX, BY + 48, { size: 30 }); tag(c, '식초', RX, BY + 48, { size: 30 });
        tagNow(c, s, 3, '초산균', 480, BY - 118, { size: 32, fill: '#ffe9ee', edge: '#c9516f', color: '#8a1f3c' });
      },
      (c, s) => {      // 4 — 배추 → 김치
        const a = seg(s.g, 4, 5);
        ground(c); arrow(c, 1); cabbage(c, LX, BY);
        const turn = eio(seg(a, 0.5, 1));
        jarCut(c, RX, BY, 140, 250, 0.78, mix('#e9d9a8', '#d9482b', turn), (ly) => {
          for (let i = 0; i < 9; i++) ell(c, RX - 100 + rnd(i) * 200, ly + 26 + rnd(i + 4) * 110, 34, 15, mix('#dff3c4', '#f2a07a', turn), rnd(i) * 3, 'rgba(120,40,20,.35)', 2);
        });
        hop(c, s, a, 5, ['lac'], [LX, BY - 150, 150, 60], [RX, BY - 290, 170, 14], 24);
        tag(c, '배추', LX, BY + 48, { size: 30 }); tag(c, '김치', RX, BY + 48, { size: 30 });
        tagNow(c, s, 4, '젖산균', 480, BY - 118, { size: 32, fill: '#e6f3ff', edge: '#4a8fc4', color: '#174e7c' });
      },
      (c, s) => {      // 5 — everything the workers made
        const a = seg(s.g, 5, 6), t = s.t;
        ground(c);
        const pop = (i) => eob(seg(a, 0.08 + i * 0.14, 0.4 + i * 0.14));
        const at = (i, fn) => { const q = pop(i); if (q > 0) { c.save(); c.translate(168 + i * 208, BY); c.scale(q, q); fn(); c.restore(); } };
        at(0, () => { meju(c, 0, -62, 150, 100, { rope: true, mold: 1, seed: 3 }); bug(c, 0, -150, 26, 'gocho', t, 0, s.still); });
        at(1, () => { jarCut(c, 0, 0, 78, 170, 0.72, '#f1ead8', null); bug(c, -26, -206, 22, 'mold', t, 1, s.still); bug(c, 32, -204, 22, 'yeast', t, 2, s.still); });
        at(2, () => { jarCut(c, 0, 0, 74, 170, 0.72, '#d98a2b', null, BOT); bug(c, 0, -204, 24, 'cho', t, 3, s.still); });
        at(3, () => { jarCut(c, 0, 0, 84, 164, 0.78, '#d9482b', null); bug(c, 10, -198, 22, 'lac', t, 4, s.still); });
        ['메주', '술', '식초', '김치'].forEach((n, i) => alpha(c, seg(a, 0.3 + i * 0.14, 0.5 + i * 0.14), () => tag(c, n, 168 + i * 208, BY + 48, { size: 28 })));
        for (let i = 0; i < 8; i++) { const tw = ((s.still ? 0.5 : t * 0.28) + i / 8) % 1; alpha(c, Math.sin(tw * Math.PI) * seg(a, 0.6, 0.9), () => { const sx = 90 + rnd(i + 2) * 780, sy = 60 + rnd(i + 8) * 110, r = 9 + rnd(i) * 6; ln(c, sx - r, sy, sx + r, sy, '#ffcf4a', 5); ln(c, sx, sy - r, sx, sy + r, '#ffcf4a', 5); }); }
      },
    ];
    return {
      anim: 3.8, hold: 2.2,
      draw(c, s) {
        s.layer('paper', (c2) => paper(c2, ['#f6f3e4', '#e9e6cc']));
        SC.forEach((fn, i) => alpha(c, sceneA(s, i, i === SC.length - 1), () => fn(c, s)));
      },
    };
  })();

  // ---------------------------------------------------------------- 한옥 뼈대 쌓기 (a house put together piece by piece)
  DRAW.MG_FRAME = (() => {
    const OX = 196, OY = 446, ZX = 0.52, ZY = 0.3;
    const P = (x, y, z) => [OX + x + z * ZX, OY - y - z * ZY];
    const WX = 440, WZ = 230, HP = 30, HC = 150, FOOT = HP + 8, TOP = FOOT + HC;
    const XS = [0, 220, 440], ZS = [WZ, 0];
    const YP = TOP + 44, YR = TOP + 114, SL = (YR - YP) / (WZ / 2), YE = YP - SL * 80;      // purlin top, ridge top, roof slope, eave height
    /** the three faces of a block that can be seen from the front-left-above */
    function block(c, x0, x1, y0, y1, z0, z1, col) {
      poly(c, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], col[0], col[3], 2);            // top
      poly(c, [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], col[2], col[3], 2);            // right side
      poly(c, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], col[1], col[3], 2);            // front
    }
    const STONE = ['#cfcbc0', '#aaa69b', '#8f8b81', '#6f6b62'], WOOD = ['#a9713f', '#8a5630', '#6b4124', '#4a2c17'], WOOD2 = ['#b98049', '#96603a', '#74482a', '#4a2c17'];
    function back(c) {
      paper(c, ['#f3efe0', '#e6dcbb']);
      c.fillStyle = '#d9d2ae'; c.beginPath(); c.moveTo(0, 330); c.quadraticCurveTo(200, 230, 420, 300); c.quadraticCurveTo(640, 220, SW, 310); c.lineTo(SW, SH); c.lineTo(0, SH); c.closePath(); c.fill();
      c.fillStyle = lg(c, 0, 400, 0, SH, [[0, '#cdb480'], [1, '#b0935c']]); c.fillRect(0, 404, SW, SH - 404);
      // a pine at the side
      ln(c, 868, 430, 872, 250, '#6b4429', 12);
      for (const [x, y, r] of [[868, 250, 62], [828, 290, 44], [910, 286, 46], [872, 210, 44]]) ell(c, x, y, r, r * 0.52, '#4f8a4a', 0, '#35653a', 2.5);
    }
    return {
      anim: 3.6, hold: 2.2,
      draw(c, s) {
        const g = s.g, t = s.t;
        s.layer('back', back);
        // 0 — the ground is marked out and the stone platform rises
        const mark = seg(g, 0.02, 0.3), plat = eo(seg(g, 0.25, 0.85));
        if (plat < 1) alpha(c, mark * (1 - plat), () => { c.setLineDash([10, 10]); poly(c, [P(-50, 0, -40), P(WX + 50, 0, -40), P(WX + 50, 0, WZ + 40), P(-50, 0, WZ + 40)], null, '#8a6a3a', 3); c.setLineDash([]); });
        if (plat > 0) {
          ell(c, OX + WX / 2 + 60, OY + 16, 330, 30, 'rgba(60,36,14,.14)');
          block(c, -50, WX + 50, 0, HP * plat, -40, WZ + 40, STONE);
          if (plat > 0.9) { for (let i = 1; i < 9; i++) { const x = -50 + i * (WX + 100) / 9; ln(c, ...P(x, 0, -40), ...P(x, HP, -40), 'rgba(80,76,68,.5)', 2, 'butt'); } }
        }
        // 1 — foot stones drop into place
        ZS.forEach((z, zi) => XS.forEach((x, xi) => {
          const k = seg(g, 1.05 + (zi * 3 + xi) * 0.1, 1.45 + (zi * 3 + xi) * 0.1);
          if (k <= 0) return;
          const dy = (1 - eob(k)) * 110;
          alpha(c, c01(k * 3), () => block(c, x - 22, x + 22, HP + dy, FOOT + dy, z - 20, z + 20, STONE));
        }));
        // the frame is drawn from the back row to the front row
        const colK = (zi, xi) => eo(seg(g, 2.05 + (zi * 3 + xi) * 0.09, 2.5 + (zi * 3 + xi) * 0.09));
        const column = (x, z, k) => {
          if (k <= 0) return;
          const b = P(x, FOOT, z), hh = HC * k;
          const w = (u) => 11 + Math.sin(c01(u) * Math.PI * 0.75 + 0.35) * 3.4;      // a gentle swelling a third of the way up
          c.beginPath();
          for (let i = 0; i <= 10; i++) { const u = i / 10; c.lineTo(b[0] - w(u), b[1] - u * hh); }
          for (let i = 10; i >= 0; i--) { const u = i / 10; c.lineTo(b[0] + w(u), b[1] - u * hh); }
          c.closePath(); c.fillStyle = lg(c, b[0] - 14, 0, b[0] + 14, 0, [[0, '#6b4124'], [0.35, '#b98049'], [1, '#5a351c']]); c.fill();
          ell(c, b[0], b[1] - hh, w(1), 4, '#c08a55');
        };
        const beamK = (xi) => seg(g, 3.08 + xi * 0.2, 3.6 + xi * 0.2);
        const beam = (x, k) => { if (k <= 0) return; const dy = (1 - eo(k)) * 90; alpha(c, c01(k * 2.5), () => block(c, x - 12, x + 12, TOP + dy, TOP + 24 + dy, -16, WZ + 16, WOOD)); };
        const postK = (xi) => eob(seg(g, 4.02 + xi * 0.08, 4.3 + xi * 0.08));
        const purl = (z, y, k) => { if (k > 0) block(c, -44, lerp(-44, WX + 44, k), y, y + 20, z - 10, z + 10, WOOD2); };
        const pK = (i) => eio(seg(g, 4.25 + i * 0.16, 4.75 + i * 0.16));
        const NR = 14, raftK = (i) => eo(seg(g, 5.04 + i * 0.045, 5.3 + i * 0.045));
        const rafter = (i, back, col) => {
          const k = raftK(i);
          if (k <= 0) return;
          const x = -40 + i * (WX + 80) / (NR - 1), a = P(x, YR + 4, WZ / 2), e = back ? P(x, YE, WZ + 80) : P(x, YE, -80);
          ln(c, a[0], a[1], lerp(a[0], e[0], k), lerp(a[1], e[1], k), col, back ? 6 : 8, 'round');
        };
        // back row
        XS.forEach((x, xi) => column(x, WZ, colK(0, xi)));
        purl(WZ, TOP + 24, pK(0));
        for (let i = 0; i < NR; i++) rafter(i, true, '#7a5230');
        // beams (front to back) and what stands on them
        XS.forEach((x, xi) => { beam(x, beamK(xi)); const q = postK(xi); if (q > 0) block(c, x - 9, x + 9, TOP + 24, TOP + 24 + 70 * q, WZ / 2 - 9, WZ / 2 + 9, WOOD); });
        purl(WZ / 2, TOP + 94, pK(1));
        // front row
        XS.forEach((x, xi) => column(x, 0, colK(1, xi)));
        purl(0, TOP + 24, pK(2));
        // 6 — walls of paper doors, then the roof
        const wall = eo(seg(g, 6.5, 6.9));
        if (wall > 0) alpha(c, wall, () => {
          poly(c, [P(WX, FOOT, 0), P(WX, FOOT, WZ), P(WX, TOP, WZ), P(WX, TOP, 0)], '#efe3c6', '#6b4124', 3);
          for (let bay = 0; bay < 2; bay++) {
            const x0 = XS[bay] + 14, x1 = XS[bay + 1] - 14, a = P(x0, FOOT + 14, 0), b = P(x1, TOP - 10, 0);
            box(c, a[0], b[1], b[0] - a[0], a[1] - b[1], 3, '#fff6e0', '#6b4124', 4);
            for (let i = 1; i < 8; i++) ln(c, lerp(a[0], b[0], i / 8), b[1], lerp(a[0], b[0], i / 8), a[1], 'rgba(107,65,36,.7)', 2, 'butt');
            for (const u of [0.2, 0.5, 0.8]) ln(c, a[0], lerp(b[1], a[1], u), b[0], lerp(b[1], a[1], u), 'rgba(107,65,36,.7)', 2, 'butt');
            ln(c, (a[0] + b[0]) / 2, b[1], (a[0] + b[0]) / 2, a[1], '#6b4124', 4, 'butt');
          }
        });
        for (let i = 0; i < NR; i++) rafter(i, false, '#96603a');
        const tile = eo(seg(g, 6.05, 6.6));
        if (tile > 0) {
          const x0 = -64, x1 = WX + 64, yE = YE + 4, yR = YR + 10;
          // gable end (the plastered triangle under the ridge), then the front slope from the eave upward
          alpha(c, tile, () => {
            poly(c, [P(WX, TOP + 24, -12), P(WX, TOP + 24, WZ + 12), P(WX, YR + 2, WZ / 2)], '#efe3c6', '#4a2c17', 3);
            poly(c, [P(x1, yR, WZ / 2), P(x1, yE, WZ + 86), P(x1, yE - 14, WZ + 86), P(x1, yR - 16, WZ / 2)], '#3f434b', '#2b2e34', 2);
          });
          const zt = lerp(-86, WZ / 2, tile), yt = lerp(yE, yR, tile);
          const q = [P(x0, yE, -86), P(x1, yE, -86), P(x1, yt, zt), P(x0, yt, zt)];
          poly(c, q, lg(c, 0, q[3][1], 0, q[0][1], [[0, '#5d636d'], [1, '#3f434b']]), '#2b2e34', 3);
          c.save(); c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.clip();
          for (let i = 0; i <= 28; i++) { const x = x0 + i * (x1 - x0) / 28, a = P(x, yE, -86), b = P(x, yR, WZ / 2); ln(c, a[0], a[1], b[0], b[1], 'rgba(20,22,26,.5)', 5, 'butt'); ln(c, a[0] + 5, a[1], b[0] + 5, b[1], 'rgba(255,255,255,.10)', 2, 'butt'); }
          c.restore();
          ln(c, ...P(x0, yE, -86), ...P(x1, yE, -86), '#2b2e34', 9);
          const ridge = eo(seg(tile, 0.75, 1));
          if (ridge > 0) { const a = P(x0 - 4, yR + 8, WZ / 2), b = P(x1 + 4, yR + 8, WZ / 2); ln(c, a[0], a[1], lerp(a[0], b[0], ridge), lerp(a[1], b[1], ridge), '#2b2e34', 22); ln(c, a[0], a[1] - 3, lerp(a[0], b[0], ridge), lerp(a[1], b[1], ridge) - 3, '#565b65', 8); }
        }
        const fin = seg(g, 6.8, 7);
        for (let i = 0; i < 7; i++) { const tw = ((s.still ? 0.5 : t * 0.3) + i / 7) % 1; alpha(c, Math.sin(tw * Math.PI) * fin, () => { const sx = 150 + rnd(i + 2) * 640, sy = 50 + rnd(i + 8) * 120, r = 10 + rnd(i) * 6; ln(c, sx - r, sy, sx + r, sy, '#ffcf4a', 5); ln(c, sx, sy - r, sx, sy + r, '#ffcf4a', 5); }); }
        tagNow(c, s, 0, '기단', 150, 360, { to: P(40, HP / 2, -40) });
        tagNow(c, s, 1, '주춧돌', 130, 330, { to: P(0, FOOT, 0) });
        tagNow(c, s, 2, '기둥', 110, 250, { to: [P(0, FOOT + 90, 0)[0] - 8, P(0, FOOT + 90, 0)[1]] });
        tagNow(c, s, 3, '대들보', 150, 150, { to: P(0, TOP + 14, 60) });
        tagNow(c, s, 4, '도리', 420, 60, { to: P(200, TOP + 114, WZ / 2) });
        tagNow(c, s, 5, '서까래', 150, 110, { to: P(-40, YP - 10, -30) });
        tagNow(c, s, 6, '기와', 130, 90, { to: P(40, YP + 10, -20) });
      },
    };
  })();

  // ---------------------------------------------------------------- 창살 도감 (six lattices that draw themselves)
  DRAW.MG_CHANGSAL = (() => {
    const A = 352 / 340;      // the big window is a little taller than wide
    const V = (x) => [x, 0, x, 1], Hh = (y) => [0, y, 1, y];
    const diag = (n) => {                    // two families of slanted bars, cut to the window
      const out = [];
      for (let k = -2 * n; k <= 2 * n; k++) {
        const c1 = k / n;                    // x = c1 + y·A
        const ya = Math.max(0, -c1 / A), yb = Math.min(1, (1 - c1) / A);
        if (yb > ya + 1e-6) out.push([c1 + ya * A, ya, c1 + yb * A, yb]);
        const c2 = k / n + 1;                // x = c2 − y·A
        const yc = Math.max(0, (c2 - 1) / A), yd = Math.min(1, c2 / A);
        if (yd > yc + 1e-6) out.push([c2 - yc * A, yc, c2 - yd * A, yd]);
      }
      return out;
    };
    const meander = () => {
      const out = [], cols = 4, rows = 5, cw = 1 / cols, ch = 1 / rows;
      for (let r = 0; r < rows; r++) {
        const y0 = r * ch + ch * 0.22, y1 = (r + 1) * ch - ch * 0.22;
        for (let q = 0; q < cols; q++) {
          const x0 = q * cw, xc = x0 + cw / 2, x1 = x0 + cw, up = (q + r) % 2 === 0;
          out.push([x0, up ? y0 : y1, xc, up ? y0 : y1], [xc, up ? y0 : y1, xc, up ? y1 : y0], [xc, up ? y1 : y0, x1, up ? y1 : y0]);
        }
        if (r < rows - 1) out.push(Hh((r + 1) * ch));
      }
      return out;
    };
    const PAT = [
      { name: '띠살', lines: [1, 2, 3, 4, 5, 6, 7].map((i) => V(i / 8)).concat([0.1, 0.14, 0.18, 0.44, 0.48, 0.52, 0.56, 0.82, 0.86, 0.9].map(Hh)) },
      { name: '정자살', lines: [1, 2, 3, 4, 5].map((i) => V(i / 6)).concat([1, 2, 3, 4, 5, 6, 7].map((i) => Hh(i / 8))) },
      { name: '빗살', lines: diag(5) },
      { name: '용자살', lines: [V(1 / 3), V(2 / 3), Hh(0.25), Hh(0.5), Hh(0.75)] },
      { name: '아자살', lines: [[0.22, 0.12, 0.22, 0.88], [0.78, 0.12, 0.78, 0.88], [0.22, 0.12, 0.78, 0.12], [0.22, 0.88, 0.78, 0.88], [0, 0.36, 0.22, 0.36], [0, 0.64, 0.22, 0.64], [0.78, 0.36, 1, 0.36], [0.78, 0.64, 1, 0.64],
        [0.39, 0, 0.39, 0.12], [0.61, 0, 0.61, 0.12], [0.39, 0.88, 0.39, 1], [0.61, 0.88, 0.61, 1], [0.39, 0.36, 0.61, 0.36], [0.39, 0.64, 0.61, 0.64], [0.39, 0.36, 0.39, 0.64], [0.61, 0.36, 0.61, 0.64]] },
      { name: '완자살', lines: meander() },
    ];
    /** one window: the frame, the paper and the lattice drawn up to q (0..1); glow = light behind the paper */
    function win(c, x, y, w, hh, pat, q, o = {}) {
      const fr = o.frame || 14, lw = o.lw || 7;
      box(c, x - fr, y - fr, w + fr * 2, hh + fr * 2, 6, lg(c, x - fr, 0, x + w + fr, 0, [[0, '#5a351c'], [0.5, '#8a5630'], [1, '#5a351c']]));
      c.fillStyle = o.paper ? mix('#e9dcc0', '#fff4d6', o.paper) : '#e6dcc4'; c.fillRect(x, y, w, hh);
      if (o.glow) { c.save(); c.beginPath(); c.rect(x, y, w, hh); c.clip(); glow(c, x + w * 0.5, y + hh * 0.45, w * 0.9, '255,214,120', 0.6 * o.glow); if (o.shade) o.shade(); c.restore(); }
      const n = pat.lines.length;
      c.lineCap = 'butt';
      pat.lines.forEach((l, i) => {
        const k = eo(seg(q, i / n * 0.72, i / n * 0.72 + 0.28));
        if (k <= 0) return;
        const x0 = x + l[0] * w, y0 = y + l[1] * hh, x1 = x + lerp(l[0], l[2], k) * w, y1 = y + lerp(l[1], l[3], k) * hh;
        ln(c, x0, y0, x1, y1, '#6b4124', lw, 'butt'); ln(c, x0, y0, x1, y1, 'rgba(255,225,180,.25)', Math.max(1, lw * 0.3), 'butt');
        if (k < 1 && o.pen) circ(c, x1, y1, lw * 0.9, '#ffcf4a');
      });
    }
    return {
      anim: 3.4, hold: 2,
      draw(c, s) {
        const g = s.g, t = s.t;
        s.layer('paper', (c2) => { paper(c2, ['#f1ebdc', '#e2d6b8']); c2.fillStyle = 'rgba(107,65,36,.10)'; c2.fillRect(0, 474, SW, 66); });
        const i = Math.min(5, Math.floor(g)), hanji = seg(g, 6, 7);
        // the big window: this step's lattice draws itself (the one before fades away first)
        const BX = 96, BY = 88, BW = 340, BH = 352;
        const q = g >= 6 ? 1 : eio(seg(g - i, 0.1, 0.86));
        const paperK = eio(seg(hanji, 0.05, 0.55));
        win(c, BX, BY, BW, BH, PAT[i], q, {
          pen: true, paper: paperK, glow: eo(seg(hanji, 0.4, 0.95)),
          shade: () => {      // a pine branch's shadow moving a little behind the paper
            c.save(); c.translate(BX + BW * 0.9, BY + 60); c.rotate(-0.2 + (s.still ? 0 : Math.sin(t * 0.7) * 0.03)); c.strokeStyle = 'rgba(90,70,40,.28)'; c.lineCap = 'round';
            c.lineWidth = 9; c.beginPath(); c.moveTo(40, -20); c.quadraticCurveTo(-90, 30, -230, 10); c.stroke();
            c.lineWidth = 3; for (let k = 0; k < 9; k++) { const bx = -20 - k * 24, by = 6 + Math.sin(k) * 8; for (let j = 0; j < 6; j++) { const a = -Math.PI / 2 + (j - 2.5) * 0.36; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a) * 34, by + Math.sin(a) * 34 * (k % 2 ? 1 : -1)); c.stroke(); } }
            c.restore();
          },
        });
        if (g < 6 && g - i < 0.14 && i > 0) alpha(c, 1 - seg(g - i, 0, 0.14), () => win(c, BX, BY, BW, BH, PAT[i - 1], 1, {}));
        // the name of the lattice being drawn
        const nm = g >= 6 ? '한지' : PAT[i].name;
        alpha(c, g >= 6 ? eo(seg(hanji, 0.1, 0.4)) : eo(seg(g - i, 0.08, 0.3)), () => tag(c, nm, BX + BW / 2, 38, { size: 34 }));
        // the collection on the right: every lattice finished so far
        for (let k = 0; k < 6; k++) {
          const cx = 540 + (k % 3) * 134, cy = 62 + Math.floor(k / 3) * 204, done = g >= k + 1, cur = k === i && g < 6;
          const kq = done ? 1 : cur ? q : 0;
          alpha(c, done || cur ? 1 : 0.35, () => {
            if (cur) { c.save(); c.shadowColor = 'rgba(255,190,60,.9)'; c.shadowBlur = 22; box(c, cx - 8, cy - 8, 116, 146, 8, '#ffcf4a'); c.restore(); }
            win(c, cx, cy, 100, 130, PAT[k], kq, { frame: 7, lw: 3, paper: done ? paperK : 0, glow: done ? eo(seg(hanji, 0.4, 0.95)) * 0.8 : 0 });
            txt(c, PAT[k].name, cx + 50, cy + 158, 24, done || cur ? '#4a321d' : 'rgba(74,50,29,.6)');
          });
        }
      },
    };
  })();

  // ---------------------------------------------------------------- 처마와 해 (the eaves and the sun, a house seen from the side)
  DRAW.MG_CHEOMA = (() => {
    const KS = (354 - 250) / 240;              // the slope of the roof
    const FLOOR = -54, POST = -250, RIDGE = [240, -354], BACK = 410;
    const D2R = Math.PI / 180;
    const tipOf = (E) => [-E, POST + KS * E];
    /** where a ray from (ox, oy) going (dx, dy) ends: on the roof (blocked) or on the ground / floor / back wall */
    function cast(ox, oy, dx, dy, E) {
      const T = tipOf(E), segs = [[T, RIDGE], [RIDGE, [RIDGE[0] + 250, RIDGE[1] + KS * 250]]];
      let best = Infinity, kind = 'none';
      for (const [a, b] of segs) {
        const ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best) { best = t; kind = 'roof'; }
      }
      const hit = (t, k) => { if (t > 0 && t < best) { best = t; kind = k; } };
      const tf = (FLOOR - oy) / dy, xf = ox + dx * tf;
      if (xf >= -30 && xf <= BACK) hit(tf, 'floor');
      const tg = (0 - oy) / dy;
      if (ox + dx * tg < -30) hit(tg, 'ground');
      const tw = (BACK - ox) / dx, yw = oy + dy * tw;
      if (yw <= FLOOR && yw >= -280) hit(tw, 'wall');
      return { t: best, kind, x: ox + dx * best, y: oy + dy * best };
    }
    /** the house in its own coordinates: (0, 0) = the foot of the front post on the ground */
    function house(c, E, o = {}) {
      const T = tipOf(E);
      // ground, stone platform, wooden floor
      box(c, -34, -40, 480, 44, 6, lg(c, 0, -40, 0, 4, [[0, '#c9c5ba'], [1, '#a29e93']]), '#807c72', 2.5);
      for (let i = 1; i < 8; i++) ln(c, -34 + i * 60, -38, -34 + i * 60, 2, 'rgba(90,86,78,.4)', 2, 'butt');
      box(c, -30, FLOOR, 446, 14, 3, lg(c, 0, FLOOR, 0, FLOOR + 14, [[0, '#c08a55'], [1, '#96603a']]), '#6b4124', 2);
      // back wall and the room behind the open hall
      box(c, BACK - 4, -284, 18, 284 + FLOOR, 2, '#efe3c6', '#6b4124', 2.5);
      box(c, BACK - 18, -210, 14, 120, 2, '#fff6e0', '#6b4124', 2);
      // posts
      for (const x of [0, BACK]) box(c, x - 9, POST - (x ? 30 : 0), 18, -FLOOR - POST + (x ? 30 : 0), 3, lg(c, x - 9, 0, x + 9, 0, [[0, '#5a351c'], [0.45, '#a9713f'], [1, '#5a351c']]));
      // rafters under the roof, then the tiled roof (a thick slab that follows the slope, lifted a little at the tip)
      const B = [RIDGE[0] + 250, RIDGE[1] + KS * 250];
      poly(c, [[T[0], T[1]], RIDGE, B, [B[0] - 6, B[1] + 14], [RIDGE[0], RIDGE[1] + 18], [T[0] + 6, T[1] + 14]], '#8a5630', '#4a2c17', 2);
      c.beginPath(); c.moveTo(T[0] - 10, T[1] - 4); c.quadraticCurveTo(T[0] + 60, T[1] - 30, RIDGE[0], RIDGE[1] - 26); c.lineTo(B[0] + 10, B[1] - 8); c.lineTo(B[0] + 4, B[1] + 2); c.lineTo(RIDGE[0], RIDGE[1]); c.lineTo(T[0], T[1] + 4); c.closePath();
      c.fillStyle = lg(c, 0, RIDGE[1] - 30, 0, T[1], [[0, '#5d636d'], [1, '#3c4048']]); c.fill(); c.strokeStyle = '#2b2e34'; c.lineWidth = 3; c.lineJoin = 'round'; c.stroke();
      box(c, RIDGE[0] - 16, RIDGE[1] - 40, 32, 22, 8, '#42464e', '#2b2e34', 2.5);
      if (o.snow) alpha(c, o.snow, () => { c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(T[0] - 4, T[1] - 10); c.quadraticCurveTo(T[0] + 60, T[1] - 36, RIDGE[0] - 20, RIDGE[1] - 32); c.stroke(); });
      if (o.mark) alpha(c, o.mark, () => {        // the eaves: the part of the roof that reaches out past the post
        ln(c, 0, POST - 64, 0, POST + 60, '#d9482b', 3); ln(c, T[0], T[1] - 60, T[0], T[1] + 40, '#d9482b', 3);
        c.setLineDash([9, 8]); ln(c, T[0], POST + 44, 0, POST + 44, '#d9482b', 4, 'butt'); c.setLineDash([]);
        poly(c, [[T[0], POST + 44], [T[0] + 16, POST + 34], [T[0] + 16, POST + 54]], '#d9482b'); poly(c, [[0, POST + 44], [-16, POST + 34], [-16, POST + 54]], '#d9482b');
      });
    }
    /** sun rays at `deg` above the horizon, drawn up to k; lights the floor and the wall they reach */
    function rays(c, E, deg, k, col) {
      if (k <= 0) return;
      const dx = Math.cos(deg * D2R), dy = Math.sin(deg * D2R), T = tipOf(E);
      // the shade under the roof: everything the ray past the tip of the eaves does not reach
      const e = cast(T[0] + 0.01, T[1] + 6, dx, dy, E);
      const shade = [[T[0], T[1] + 6], [e.x, e.y]];
      if (e.kind === 'floor') shade.push([BACK - 4, FLOOR]);
      shade.push([BACK - 4, -286], [RIDGE[0], RIDGE[1] + 18]);
      alpha(c, 0.9 * k, () => poly(c, shade, 'rgba(60,100,160,.20)'));
      // light that gets in under the eaves: the beam between the ray past the tip and the edge of the floor
      if (e.kind !== 'ground') alpha(c, k, () => {
        const x1 = e.kind === 'floor' ? e.x : BACK - 4, L = 300;
        const beam = [[T[0] - dx * L, T[1] + 6 - dy * L], [T[0], T[1] + 6], [e.x, e.y]];
        if (e.kind === 'wall') beam.push([BACK - 4, FLOOR]);
        beam.push([-30, FLOOR], [-30 - dx * L, FLOOR - dy * L]);
        poly(c, beam, 'rgba(255,214,110,.34)');
        glow(c, (x1 - 30) / 2, FLOOR, 130, '255,220,120', 0.4);
        ln(c, -30, FLOOR + 1, x1, FLOOR + 1, '#ffd24a', 9, 'butt');
        if (e.kind === 'wall') ln(c, BACK - 5, e.y, BACK - 5, FLOOR, '#ffd24a', 9, 'butt');
      });
      for (let i = 0; i < 12; i++) {
        const ox = -620 + i * 74 - (deg > 50 ? 0 : 260), oy = -470;
        const h1 = cast(ox, oy, dx, dy, E);
        if (!Number.isFinite(h1.t)) continue;
        const t = h1.t * k;
        ln(c, ox, oy, ox + dx * t, oy + dy * t, col, 5);
        if (k >= 1) circ(c, h1.x, h1.y, h1.kind === 'roof' ? 5 : 8, h1.kind === 'roof' ? 'rgba(255,255,255,.7)' : '#fff3c2');
      }
    }
    const sunAt = (deg, r) => [60 - Math.cos(deg * D2R) * (r || 400), -70 - Math.sin(deg * D2R) * (r || 400)];
    function person(c, x, y, t, still) {      // a child resting on the cool floor with a fan
      ell(c, x, y - 8, 40, 12, '#4f86c6', 0, '#2f5f96', 2.5);
      circ(c, x - 46, y - 18, 16, '#f3cfb0', '#b98a6a', 2.5);
      c.beginPath(); c.arc(x - 46, y - 22, 16, Math.PI, TAU); c.fillStyle = '#2a2522'; c.fill();
      const a = still ? 0.2 : Math.sin(t * 2.4) * 0.35;
      c.save(); c.translate(x - 8, y - 22); c.rotate(-0.9 + a); ln(c, 0, 0, 0, -34, '#8a5630', 4); c.beginPath(); c.moveTo(0, -30); c.arc(0, -30, 26, -Math.PI * 0.85, -Math.PI * 0.15); c.closePath(); c.fillStyle = '#fff6e0'; c.fill(); c.strokeStyle = '#b98a4e'; c.lineWidth = 2.5; c.stroke(); c.restore();
    }
    return {
      anim: 3.8, hold: 2.4,
      draw(c, s) {
        const g = s.g, t = s.t;
        const season = eio(seg(g, 3.0, 3.5));              // 0 summer … 1 winter
        s.layer('paper', (c2) => paper(c2, ['#f4efe0', '#e9dfc0']));
        // the sky warms and cools with the season
        c.fillStyle = `rgba(${Math.round(lerp(255, 190, season))},${Math.round(lerp(236, 214, season))},${Math.round(lerp(190, 238, season))},.35)`; c.fillRect(0, 0, SW, 430);
        const two = eio(seg(g, 4.0, 4.5));
        // one big house (steps 0–3)
        if (two < 1) alpha(c, 1 - two, () => {
          c.fillStyle = lg(c, 0, 430, 0, SH, [[0, mix('#cdb480', '#e8e8ea', season * 0.8)], [1, mix('#b0935c', '#cfd2d6', season * 0.8)]]); c.fillRect(0, 432, SW, SH - 432);
          c.save(); c.translate(430, 436);
          const deg = g < 1 ? 50 : lerp(lerp(50, 68, eio(seg(g, 1.0, 1.5))), 27, season);
          const [sx, sy] = sunAt(deg);
          // the way of the sun across the sky
          c.setLineDash([4, 14]); c.beginPath(); c.arc(60, -70, 400, Math.PI + 18 * D2R, Math.PI + 82 * D2R); c.strokeStyle = 'rgba(217,154,50,.6)'; c.lineWidth = 4; c.lineCap = 'round'; c.stroke(); c.setLineDash([]);
          const rk = g < 1 ? 0 : g < 3 ? eo(seg(g, 1.35, 1.95)) : eo(seg(g, 3.45, 3.95));
          const shown = g >= 3 && g < 3.45 ? 1 - seg(g, 3.0, 3.2) : 1;
          house(c, 124, { mark: eo(seg(g, 0.3, 0.7)) * (1 - seg(g, 1.0, 1.3)), snow: season });
          alpha(c, shown, () => rays(c, 124, g >= 3 && g < 3.45 ? 68 : deg, g >= 3 && g < 3.45 ? 1 : rk, 'rgba(255,196,70,.75)'));
          house(c, 124, { snow: season });
          sun(c, sx, sy, lerp(34, 28, season), t, season > 0.5 ? { core: '#ffd97a', rgb: '255,226,150' } : {});
          const cool = eo(seg(g, 2.1, 2.6)) * (1 - season);
          if (cool > 0) alpha(c, cool, () => {
            person(c, 210, FLOOR, t, s.still);
            for (let i = 0; i < 4; i++) { const ph = ((s.still ? 0.4 : t * 0.25) + i / 4) % 1, x = -120 + ph * 420, y = -200 + i * 34; c.strokeStyle = `rgba(90,150,210,${0.7 * Math.sin(ph * Math.PI)})`; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 34, y); c.bezierCurveTo(x - 12, y - 14, x + 12, y + 14, x + 34, y); c.stroke(); }
          });
          c.restore();
          tagNow(c, s, 0, '처마', 250, 130, { to: [372, 250] });
          tagNow(c, s, 1, '여름 해', 160, 60, { size: 30, to: [330, 60] });
          tagNow(c, s, 2, '시원한 그늘', 760, 330, { size: 28, fill: '#e6f3ff', edge: '#4a8fc4', color: '#174e7c', to: [640, 300] });
          tagNow(c, s, 3, '겨울 해', 300, 330, { size: 30, to: [150, 240] });
          alpha(c, eo(seg(g, 3.6, 3.95)) * (1 - two), () => tag(c, '방 안까지 볕', 770, 250, { size: 28, to: [560, 378] }));
        });
        // two small houses side by side (step 4): a short roof edge in the north, a deep one in the south
        if (two > 0) alpha(c, two, () => {
          c.fillStyle = lg(c, 0, 430, 0, SH, [[0, '#cdb480'], [1, '#b0935c']]); c.fillRect(0, 412, SW, SH - 412);
          const grow = eio(seg(g, 4.35, 4.9));
          [[250, 70, '북쪽 지방'], [730, lerp(70, 190, grow), '남쪽 지방']].forEach(([ox, E, name], i) => {
            c.save(); c.translate(ox - 100, 414); c.scale(0.62, 0.62);
            house(c, E, { mark: 1 });
            c.restore();
            tag(c, name, ox + 40, 462, { size: 30, fill: i ? '#fff1d6' : '#eaf2fb', edge: i ? '#d98a2b' : '#4a8fc4' });
          });
          sun(c, 480, 86, 30, t);
          alpha(c, eo(seg(g, 4.6, 4.95)), () => { tag(c, '짧은 처마', 190, 150, { size: 28 }); tag(c, '깊은 처마', 640, 150, { size: 28 }); });
        });
      },
    };
  })();

  // ---------------------------------------------------------------- 우물마루와 들어열개 (the floor from above, then the doors from the yard)
  DRAW.MG_MARU = (() => {
    const FX = 150, FY = 60, FW = 660, FH = 384, COLS = 4, ROWS = 3, LB = 26, SB = 20;       // floor frame, long beams, short beams
    const cw = FW / COLS, rh = FH / ROWS;
    const WD = ['#c9965f', '#b98049', '#d2a26a', '#be8a52'];
    function floor(c, s) {
      const g = s.g;
      // 0 — the long beams, then the short ones between them
      for (let r = 0; r <= ROWS; r++) { const k = eo(seg(g, 0.05 + r * 0.1, 0.5 + r * 0.1)); if (k > 0) box(c, FX - 14, FY + r * rh - LB / 2, (FW + 28) * k, LB, 4, lg(c, 0, FY + r * rh - LB / 2, 0, FY + r * rh + LB / 2, [[0, '#8a5630'], [1, '#6b4124']]), '#4a2c17', 2); }
      for (let r = 0; r < ROWS; r++) for (let q = 0; q <= COLS; q++) {
        const k = eo(seg(g, 0.45 + (r * (COLS + 1) + q) * 0.03, 0.75 + (r * (COLS + 1) + q) * 0.03));
        if (k > 0) box(c, FX + q * cw - SB / 2, FY + r * rh + LB / 2, SB, (rh - LB) * k, 3, '#7a4a2a', '#4a2c17', 2);
      }
      // 1 — boards slide in · 3 — the wood dries, the boards are pushed together and one more goes in
      const dry = eio(seg(g, 3.05, 3.35)), push = eio(seg(g, 3.4, 3.7)), fill = eio(seg(g, 3.72, 3.98));
      for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
        const x0 = FX + q * cw + SB / 2 + 3, y0 = FY + r * rh + LB / 2 + 3, w = cw - SB - 6, hh = rh - LB - 6, n = 3, bh = hh / n;
        const cell = r * COLS + q;
        for (let i = 0; i < n; i++) {
          const k = eo(seg(g, 1.04 + cell * 0.05 + i * 0.03, 1.4 + cell * 0.05 + i * 0.03));
          if (k <= 0) continue;
          const shrink = 5 * dry;                                   // each board is a little narrower when dry
          const yy = lerp(y0 + i * bh + shrink / 2, y0 + i * (bh - shrink), push);
          box(c, x0 + (1 - k) * (w + 40), yy, w, bh - shrink - 1.5, 2, WD[(cell + i) % 4], 'rgba(74,44,23,.55)', 1.5);
          ln(c, x0 + (1 - k) * (w + 40) + 10, yy + (bh - shrink) * 0.5, x0 + (1 - k) * (w + 40) + w - 12, yy + (bh - shrink) * 0.45, 'rgba(74,44,23,.18)', 2);
        }
        // the gaps show the dark space under the floor; the new thin board closes the one that is left
        if (fill > 0) { const gy = y0 + n * (bh - 5); box(c, x0 + (1 - fill) * (w + 40), gy, w, 15 - 1.5, 2, '#e8c48a', '#b98049', 1.5); }
      }
      // 2 — the shape of the character for "well": two beams one way, two the other
      const jung = eo(seg(g, 2.1, 2.7)) * (1 - seg(g, 3.0, 3.25));
      if (jung > 0) alpha(c, jung, () => {
        c.save(); c.shadowColor = 'rgba(255,190,60,.9)'; c.shadowBlur = 18;
        for (const r of [1, 2]) ln(c, FX - 14, FY + r * rh, FX + FW + 14, FY + r * rh, '#ffcf4a', 9, 'butt');
        for (const q of [1, 3]) ln(c, FX + q * cw, FY - 13, FX + q * cw, FY + FH + 13, '#ffcf4a', 9, 'butt');
        c.restore();
      });
      tagNow(c, s, 0, '마루의 틀', 480, 30, { size: 30 });
      tagNow(c, s, 1, '널', 480, 30, { size: 30 });
      tagNow(c, s, 2, '우물마루', 480, 30, { size: 34 });
      alpha(c, eo(seg(g, 3.1, 3.35)) * (1 - seg(g, 3.72, 3.9)), () => tag(c, '틈', 480, 30, { size: 30 }));
      alpha(c, eo(seg(g, 3.8, 3.98)) * (1 - seg(g, 4.0, 4.2)), () => tag(c, '새 널로 메우기', 480, 30, { size: 30 }));
    }
    function door(c, x, y, w, hh, sh) {       // one leaf of the folding doors: lattice above, a board below
      box(c, x, y, w, hh, 3, sh ? '#e2d5b6' : '#fff6e0', '#5a351c', 5);
      const top = hh * 0.74;
      for (let i = 1; i < 6; i++) ln(c, x + i * w / 6, y + 3, x + i * w / 6, y + top, '#7a4a2a', 2.5, 'butt');
      for (const u of [0.08, 0.14, 0.42, 0.48, 0.54, 0.86, 0.92]) ln(c, x + 3, y + top * u, x + w - 3, y + top * u, '#7a4a2a', 2.5, 'butt');
      box(c, x + 2, y + top, w - 4, hh - top - 2, 2, '#96603a', '#5a351c', 3);
    }
    function doors(c, s) {
      const g = s.g, t = s.t;
      const L = 196, R = 764, TOPY = 118, FLY = 420, w = (R - L) / 4, hh = FLY - TOPY;
      // the hall behind the doors
      c.fillStyle = '#efe3c6'; c.fillRect(L, TOPY, R - L, hh);
      c.fillStyle = lg(c, 0, TOPY, 0, FLY, [[0, 'rgba(120,90,50,.28)'], [1, 'rgba(120,90,50,.05)']]); c.fillRect(L, TOPY, R - L, hh);
      poly(c, [[L, FLY], [R, FLY], [R - 70, FLY - 86], [L + 70, FLY - 86]], lg(c, 0, FLY - 86, 0, FLY, [[0, '#a9713f'], [1, '#c9965f']]));
      for (let i = 1; i < 7; i++) ln(c, lerp(L, R, i / 7), FLY, lerp(L + 70, R - 70, i / 7), FLY - 86, 'rgba(74,44,23,.35)', 2, 'butt');
      box(c, 420, 190, 120, 130, 3, '#fff8e6', '#6b4124', 4); ln(c, 440, 250, 520, 232, '#4a321d', 4); ln(c, 452, 280, 506, 270, '#4a321d', 3);        // a scroll on the far wall
      // frame: posts, lintel, the beam the hooks hang from, the edge of the floor
      box(c, L - 30, 44, R - L + 60, 30, 5, '#6b4124'); box(c, L - 22, TOPY - 22, R - L + 44, 24, 4, '#7a4a2a', '#4a2c17', 2);
      box(c, L - 26, FLY, R - L + 52, 26, 4, lg(c, 0, FLY, 0, FLY + 26, [[0, '#b98049'], [1, '#8a5630']]), '#4a2c17', 2);
      box(c, L - 110, FLY + 26, R - L + 220, 26, 5, '#c9c5ba', '#807c72', 2.5);
      const fold = eio(seg(g, 4.15, 4.9)), lift = eio(seg(g, 5.08, 5.75));
      for (const side of [-1, 1]) {
        const outer = side < 0 ? L : R - w, inner = side < 0 ? L + w : R - 2 * w;
        // the folded pair swings up toward the yard and hangs flat from a hook
        const hgt = lerp(hh, 24, lift), y = TOPY;
        if (lift > 0) { const hx = outer + w / 2; ln(c, hx - 30, 74, hx - 30, y + hgt, '#3b2a1c', 4); ln(c, hx + 30, 74, hx + 30, y + hgt, '#3b2a1c', 4); }
        c.save();
        if (lift > 0) { c.translate(0, lerp(0, 14, lift)); }
        const ix = lerp(inner, outer + side * -6, fold);
        if (lift < 1) { door(c, ix, y, w, hgt, fold > 0.5); door(c, outer, y, w, hgt, false); }
        else { box(c, outer - 4, y, w + 8, hgt, 4, '#96603a', '#4a2c17', 3); ln(c, outer, y + hgt - 6, outer + w, y + hgt - 6, '#fff6e0', 5, 'butt'); }
        c.restore();
      }
      for (const x of [L - 26, R]) box(c, x, 60, 26, FLY - 60, 4, lg(c, x, 0, x + 26, 0, [[0, '#5a351c'], [0.45, '#a9713f'], [1, '#5a351c']]));
      // air moves through the open hall
      const breeze = seg(g, 5.6, 5.95);
      for (let i = 0; i < 5; i++) { const ph = ((s.still ? 0.45 : t * 0.22) + i / 5) % 1, x = 120 + ph * 720, y = 170 + i * 44; c.strokeStyle = `rgba(90,150,210,${0.75 * breeze * Math.sin(ph * Math.PI)})`; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 40, y); c.bezierCurveTo(x - 14, y - 16, x + 14, y + 16, x + 40, y); c.stroke(); }
      tagNow(c, s, 4, '분합문', 860, 170, { size: 30, to: [740, 220] });
      tagNow(c, s, 5, '들쇠', 96, 96, { size: 30, to: [232, 100] });
    }
    return {
      anim: 3.8, hold: 2.2,
      draw(c, s) {
        s.layer('paper', (c2) => paper(c2, ['#f2ecdc', '#e4d8b8']));
        const b = eio(seg(s.g, 4.0, 4.3));
        if (b < 1) alpha(c, 1 - b, () => { box(c, FX - 30, FY - 28, FW + 60, FH + 56, 10, '#2f2118'); floor(c, s); });
        if (b > 0) alpha(c, b, () => doors(c, s));
      },
    };
  })();

  // ---------------------------------------------------------------- 고장마다 다른 옹기 (one jar changes its shape)
  DRAW.MG_ONGGI_REGION = (() => {
    const SHAPES = [
      { pr: JAR, sc: 1, at: null, sun: 0.6 },
      { pr: { base: 0.6, belly: 0.86, bellyY: 0.5, shoulder: 0.86, shoulderY: 0.8, mouth: 0.94 }, sc: 1, at: [128, 150], sun: 0.35, part: ['입', 1] },
      { pr: { base: 0.56, belly: 0.92, bellyY: 0.48, shoulder: 0.94, shoulderY: 0.68, mouth: 0.9 }, sc: 0.7, at: [232, 128], sun: 0.35, part: null },
      { pr: { base: 0.66, belly: 1, bellyY: 0.52, shoulder: 0.86, shoulderY: 0.8, mouth: 0.66 }, sc: 1, at: [140, 238], sun: 0.6, part: ['밑', 0.02] },
      { pr: { base: 0.5, belly: 0.98, bellyY: 0.62, shoulder: 1.02, shoulderY: 0.78, mouth: 0.5 }, sc: 1, at: [116, 356], sun: 1, part: ['어깨', 0.78] },
      { pr: { base: 0.42, belly: 1.08, bellyY: 0.55, shoulder: 0.9, shoulderY: 0.82, mouth: 0.44 }, sc: 1, at: [246, 316], sun: 1, part: ['배', 0.55] },
    ];
    const NAMES = ['', '서울·경기', '강원 동쪽', '충청', '남쪽 지방', '경상'];
    const LAND = [[92, 66], [150, 46], [214, 40], [262, 58], [284, 118], [300, 190], [306, 262], [290, 322], [266, 374], [224, 394], [180, 400], [138, 412], [92, 402], [66, 360], [78, 300], [60, 250], [86, 198], [68, 150], [80, 104]];
    function map(c) {
      c.save(); c.translate(30, 34);
      box(c, 6, 6, 330, 444, 22, 'rgba(160,200,225,.45)', 'rgba(90,140,180,.5)', 2.5);
      c.beginPath(); LAND.forEach((p, i) => { const q = LAND[(i + 1) % LAND.length]; const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; if (i) c.quadraticCurveTo(p[0], p[1], mx, my); else c.moveTo(mx, my); });
      const p0 = LAND[0], p1 = LAND[1]; c.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); c.closePath();
      c.fillStyle = lg(c, 0, 40, 0, 410, [[0, '#cfe3b4'], [1, '#e6dba6']]); c.fill(); c.strokeStyle = '#8fae6a'; c.lineWidth = 3; c.stroke();
      ell(c, 124, 436, 34, 11, '#d9e2b0', 0, '#8fae6a', 2.5);
      // the ridge of mountains along the east
      c.strokeStyle = 'rgba(110,140,80,.55)'; c.lineWidth = 3; c.lineJoin = 'round';
      for (let i = 0; i < 7; i++) { const x = 250 - i * 3 + (i % 2) * 6, y = 80 + i * 40; c.beginPath(); c.moveTo(x - 12, y + 10); c.lineTo(x, y - 8); c.lineTo(x + 12, y + 10); c.stroke(); }
      c.restore();
    }
    const prMix = (a, b, k) => { const o = {}; for (const key of Object.keys(a)) o[key] = lerp(a[key], b[key], k); return o; };
    return {
      anim: 3.4, hold: 2.4,
      draw(c, s) {
        const g = s.g, t = s.t, i = Math.min(SHAPES.length - 1, Math.floor(g)), A = SHAPES[Math.max(0, i - 1)], B = SHAPES[i];
        const k = i === 0 ? 1 : eio(seg(g, i + 0.05, i + 0.6));
        s.layer('base', (c2) => { paper(c2, ['#f4f0e2', '#e8dfc2']); map(c2); c2.fillStyle = lg(c2, 0, 420, 0, SH, [[0, '#d9c59a'], [1, '#c2a876']]); c2.fillRect(380, 440, 580, 100); box(c2, 470, 436, 360, 24, 8, '#a9a59b', '#807c72', 2.5); });
        // where on the map
        SHAPES.forEach((sh, j) => {
          if (!sh.at) return;
          const on = j === i ? k : j === i - 1 ? 1 - k : 0, x = 30 + sh.at[0], y = 34 + sh.at[1];
          circ(c, x, y, 9, on > 0.5 ? '#d9482b' : 'rgba(120,90,50,.45)', '#fff', 2.5);
          if (on > 0) { const pulse = s.still ? 0.5 : (t * 0.5) % 1; alpha(c, on * (1 - pulse), () => circ(c, x, y, 12 + pulse * 26, null, '#d9482b', 4)); alpha(c, on, () => tag(c, NAMES[j], x + (x > 200 ? -10 : 20), y - 44, { size: 26, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16' })); }
        });
        // the sun: weak where the days are cool, strong in the south
        const sunK = lerp(A.sun, B.sun, k);
        alpha(c, 0.45 + sunK * 0.55, () => sun(c, 852, 96, 24 + sunK * 22, t));
        // the jar itself
        const pr = prMix(A.pr, B.pr, k), sc = lerp(A.sc, B.sc, k), W = 172 * sc, H = 310 * sc, CX = 650, FOOT = 438;
        const breath = i === 0 && !s.still ? 1 + Math.sin(t * 1.6) * 0.01 : 1;
        c.save(); c.translate(CX, FOOT); c.scale(breath, breath); c.translate(-CX, -FOOT);
        jar(c, CX, FOOT, W, H, { pr });
        c.restore();
        // the part of the jar the caption talks about, with a measure across it
        if (B.part && k > 0.6) alpha(c, eo(seg(k, 0.6, 1)), () => {
          const u = B.part[1], y = FOOT - u * H - (u >= 1 ? H * 0.11 : 0), hw = jarHalf(pr, Math.min(1, u)) * W;
          ln(c, CX - hw, y, CX + hw, y, '#d9482b', 5, 'butt'); ln(c, CX - hw, y - 12, CX - hw, y + 12, '#d9482b', 5, 'butt'); ln(c, CX + hw, y - 12, CX + hw, y + 12, '#d9482b', 5, 'butt');
          tag(c, B.part[0], CX + hw + 64, y, { size: 30, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16' });
          if (i === 3) { const y2 = FOOT - H - H * 0.11, hw2 = jarHalf(pr, 1) * W; ln(c, CX - hw2, y2, CX + hw2, y2, '#d9482b', 5, 'butt'); ln(c, CX - hw2, y2 - 12, CX - hw2, y2 + 12, '#d9482b', 5, 'butt'); ln(c, CX + hw2, y2 - 12, CX + hw2, y2 + 12, '#d9482b', 5, 'butt'); tag(c, '입', CX + hw2 + 64, y2, { size: 30, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16' }); }
        });
        if (i === 2 && k > 0.6) alpha(c, eo(seg(k, 0.6, 1)), () => tag(c, '작아요', CX + 190, FOOT - 130, { size: 30, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16', to: [CX + 110, FOOT - 120] }));
      },
    };
  })();

  // ---------------------------------------------------------------- 24절기 해시계 (the sun's path in twenty-four steps)
  DRAW.MG_JEOLGI = (() => {
    const CX = 250, CY = 252, RO = 196, RI = 132, N = 24, STEP = TAU / N;
    const COL = (i) => (i < 6 ? mix('#c9e8a6', '#8fd67e', i / 5) : i < 12 ? mix('#ffe08a', '#f6b24a', (i - 6) / 5) : i < 18 ? mix('#f2b866', '#d98a4a', (i - 12) / 5) : mix('#d6e6f5', '#a9c8e8', (i - 18) / 5));
    const ang = (i) => -Math.PI / 2 + i * STEP;
    const AT = [0, 0.5, 0, 5, 10, 15];                 // where the sun stands at the end of each step (in segments from 춘분)
    const NAMES = { 0: '춘분', 5: '망종', 10: '처서', 15: '입동' };
    function ring(c) {
      ell(c, CX, CY + 8, RO + 8, RO + 8, 'rgba(60,36,14,.14)');
      for (let i = 0; i < N; i++) {
        c.beginPath(); c.arc(CX, CY, RO, ang(i), ang(i + 1)); c.arc(CX, CY, RI, ang(i + 1), ang(i), true); c.closePath();
        c.fillStyle = COL(i); c.fill(); c.strokeStyle = 'rgba(90,60,30,.4)'; c.lineWidth = 2; c.stroke();
      }
      circ(c, CX, CY, RI - 6, '#fffaf0', '#b98a4e', 4);
      // a little house and field in the middle: the sun's path goes around our year
      c.save(); c.beginPath(); c.arc(CX, CY, RI - 9, 0, TAU); c.clip();
      c.fillStyle = '#e4f1f6'; c.fillRect(CX - RI, CY - RI, RI * 2, RI * 2);
      c.fillStyle = '#b9d98c'; c.beginPath(); c.moveTo(CX - RI, CY + 26); c.quadraticCurveTo(CX, CY - 6, CX + RI, CY + 30); c.lineTo(CX + RI, CY + RI); c.lineTo(CX - RI, CY + RI); c.closePath(); c.fill();
      poly(c, [[CX - 52, CY + 6], [CX, CY - 34], [CX + 52, CY + 6]], '#4d525b', '#33363c', 2.5); box(c, CX - 38, CY + 6, 76, 40, 2, '#efe3c6', '#6b4124', 2.5); box(c, CX - 10, CY + 18, 20, 28, 2, '#fff6e0', '#6b4124', 2);
      jar(c, CX + 74, CY + 56, 16, 30, { shadow: false }); jar(c, CX - 78, CY + 60, 13, 24, { shadow: false });
      c.restore();
    }
    /** the picture on the right for a season: 0 봄 새싹 · 1 모내기와 보리 · 2 늦여름 들판 · 3 김장 */
    function scene(c, k, t, still) {
      const X = 730, Y = 250;
      box(c, X - 190, Y - 150, 380, 300, 26, '#fffaf0', '#b98a4e', 4);
      c.save(); rr(c, X - 184, Y - 144, 368, 288, 22); c.clip();
      const sky = ['#dff1f6', '#e6f4e0', '#fdeec4', '#e3ecf5'][k], land = ['#b9d98c', '#9fd0a0', '#e2c66a', '#d9d2bd'][k];
      c.fillStyle = sky; c.fillRect(X - 190, Y - 150, 380, 300);
      c.fillStyle = land; c.beginPath(); c.moveTo(X - 190, Y + 40); c.quadraticCurveTo(X, Y + 10, X + 190, Y + 46); c.lineTo(X + 190, Y + 150); c.lineTo(X - 190, Y + 150); c.closePath(); c.fill();
      if (k === 0) {
        for (let i = 0; i < 7; i++) { const x = X - 150 + i * 50, y = Y + 80 + (i % 2) * 22, sw = still ? 0 : Math.sin(t * 1.5 + i) * 3; ln(c, x, y, x + sw, y - 34, '#4f9a3f', 6); ell(c, x - 12 + sw, y - 36, 15, 8, '#7cc874', -0.5, '#4f9a3f', 2); ell(c, x + 12 + sw, y - 40, 15, 8, '#8fd67e', 0.5, '#4f9a3f', 2); }
      } else if (k === 1) {
        c.fillStyle = 'rgba(120,180,220,.55)'; c.fillRect(X - 190, Y + 56, 250, 94);
        for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { const x = X - 170 + i * 40, y = Y + 84 + r * 26; ln(c, x, y, x - 5, y - 20, '#3f8a3a', 4); ln(c, x, y, x + 5, y - 22, '#4f9a3f', 4); ln(c, x, y, x, y - 26, '#5aa84a', 4); }
        for (let i = 0; i < 9; i++) { const kx = i / 8 - 0.5; ln(c, X + 120 + kx * 20, Y + 110, X + 120 + kx * 90, Y + 6 - Math.abs(kx) * 20, '#e2c27a', 6); ell(c, X + 120 + kx * 96, Y - 2 - Math.abs(kx) * 20, 6, 14, '#d1a64a', kx); }
        box(c, X + 100, Y + 66, 40, 14, 6, '#b98a3e');
      } else if (k === 2) {
        sun(c, X + 110, Y - 84, 26, t);
        for (let i = 0; i < 16; i++) { const x = X - 176 + i * 23, y = Y + 120 - (i % 3) * 16, sw = still ? 0 : Math.sin(t * 1.3 + i * 0.7) * 4; ln(c, x, y, x + sw, y - 62, '#8fae4a', 5); ell(c, x + sw + 5, y - 66, 6, 16, '#e2b84a', 0.5); }
      } else {
        for (let i = 0; i < 3; i++) { const x = X - 130 + i * 74, y = Y + 96; ell(c, x, y - 26, 32, 28, '#8fcf70', 0, '#4f9a3f', 2.5); ell(c, x, y - 22, 16, 24, '#dff3c4', 0, '#6fb055', 2); }
        jar(c, X + 116, Y + 110, 50, 110, {});
        for (let i = 0; i < 8; i++) { const ph = ((still ? 0.4 : t * 0.08) + rnd(i)) % 1; circ(c, X - 180 + rnd(i + 20) * 360, Y - 150 + ph * 300, 4 + rnd(i + 40) * 2, '#ffffff'); }
      }
      c.restore();
    }
    return {
      anim: 3.6, hold: 2.4,
      draw(c, s) {
        const g = s.g, t = s.t, i = Math.min(AT.length - 1, Math.floor(g));
        s.layer('base', (c2) => { paper(c2, ['#f3efe2', '#e6dcc0']); ring(c2); });
        // 0 — the ring is counted out, one step after another
        if (g < 1) { const n = Math.floor(seg(g, 0.05, 0.8) * N); c.save(); c.beginPath(); c.moveTo(CX, CY); c.arc(CX, CY, RO + 4, ang(n), ang(N)); c.closePath(); c.fillStyle = 'rgba(243,239,226,.9)'; c.fill(); c.restore(); circ(c, CX, CY, RI - 6, null, '#b98a4e', 4); }
        // where the sun is
        const from = AT[Math.max(0, i - 1)], to = AT[i];
        let pos = i === 0 ? seg(g, 0.05, 0.8) * N : lerp(from, to, eio(seg(g, i + 0.05, i + 0.6)));
        if (i === 0 && g >= 0.8) pos = 0;
        const a = ang(pos), sx = CX + Math.cos(a) * (RO + RI) / 2, sy = CY + Math.sin(a) * (RO + RI) / 2;
        // 1 — one step is fifteen degrees
        const wedge = eo(seg(g, 1.15, 1.6)) * (1 - seg(g, 2.0, 2.25));
        if (wedge > 0) alpha(c, wedge, () => {
          c.beginPath(); c.moveTo(CX, CY); c.arc(CX, CY, RO + 22, ang(0), ang(1)); c.closePath(); c.fillStyle = 'rgba(217,72,43,.22)'; c.fill(); c.strokeStyle = '#d9482b'; c.lineWidth = 4; c.stroke();
          tag(c, '15도', CX + 120, CY - RO - 26, { size: 30, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16', to: [CX + 26, CY - RO - 8] });
        });
        // names on the rim for the steps reached so far
        for (const [seg0, name] of Object.entries(NAMES)) {
          const j = Number(seg0), need = j === 0 ? 2 : j === 5 ? 3 : j === 10 ? 4 : 5;
          const on = eo(seg(g, need + 0.45, need + 0.75));
          if (on <= 0) continue;
          const aa = ang(j), x = CX + Math.cos(aa) * (RO + 40), y = CY + Math.sin(aa) * (RO + 40);
          alpha(c, on, () => { ln(c, CX + Math.cos(aa) * RI, CY + Math.sin(aa) * RI, CX + Math.cos(aa) * (RO + 8), CY + Math.sin(aa) * (RO + 8), '#d9482b', 5, 'butt'); tag(c, name, U.clamp(x, 70, 470), U.clamp(y, 30, 470), { size: 26, fill: '#fff1ee', edge: '#d9482b', color: '#8f2a16' }); });
        }
        sun(c, sx, sy, 22, t);
        // the picture and the words on the right
        const TITLE = ['스물네 절기', '한 칸은 15도', '춘분 · 0도', '망종', '처서 · 150도', '입동'], SUB = ['해가 가는 길', '절기 하나', '봄이 한창이에요', '모내기 · 보리 베기', '8월 23일 무렵', '김장 준비'];
        const sc = [0, 0, 0, 1, 2, 3];
        for (let j = Math.max(0, i - 1); j <= i; j++) {
          const al = j === i ? (i === 0 ? 1 : seg(g, i + 0.42, i + 0.62)) : 1 - seg(g, i + 0.22, i + 0.4);
          if (al <= 0) continue;
          alpha(c, al, () => { scene(c, sc[j], t, s.still); txt(c, TITLE[j], 730, 60, 40, '#4a321d'); txt(c, SUB[j], 730, 436, 30, '#7a5530'); });
        }
      },
    };
  })();
  // @@MOTIONS@@

  // ================================================================ system
  const api = {
    name: 'exhibits', order: 65, label: '한옥 전시',
    init() {
      G.bus.on('place:enter', (ev) => { try { onPlaceEnter(ev); } catch (e) { G.log.warn(CAT, 'place:enter', e?.message || e); } });
      // the 도감 behind a card shows the new stamp as soon as the card closes
      G.bus.on('ui:modal-close', ({ id } = {}) => { if (id === 'exhibit-card') refreshBook(); });
      G.bus.on('easy:changed', () => { for (const id of ['exhibit-card', 'exhibit-book', 'exhibit-motion']) G.ui.modal.get(id)?.close({ instant: true }); });
    },
    onStateLoaded() {
      _pendingRoom = null; _bookRoom = null; _byPlace = null;
      const p = PL();
      _visitSnap = p ? Object.assign({}, p.visits) : {};
      syncStats();
    },
    onLogout() {
      if (_demo) _demo.stop = true;
      for (const id of ['exhibit-card', 'exhibit-book', 'exhibit-motion']) G.ui.modal.get(id)?.close({ instant: true });
      _pendingRoom = null; _visitSnap = {};
    },
    open: (id, opts) => openCard(id, opts),
    motion: (id, opts) => openMotion(id, opts),
    board: (motionId, opts) => makeBoard(motionId, opts),
    attach, mount, forPlace,
    anchors: (placeId) => (byPlace()[placeId] || []).map((e) => e.anchor),
    missing: (placeId, keys) => { const have = new Set(Array.isArray(keys) ? keys : keys instanceof Map ? [...keys.keys()] : Object.keys(keys || {})); return (byPlace()[placeId] || []).filter((e) => !have.has(e.anchor)).map((e) => e.id); },
    spec: specOf,
    /** seen(id) → boolean; seen(id, true) records the stamp without a card (a room's own display may do that) */
    seen: (id, mark) => { if (mark !== true) return isSeen(id); const fresh = markSeen(id, {}); if (fresh) { refreshBook(); flushCelebration(); } return fresh; },
    watched: isWatched,
    progress: totals,
    openBook,
    demo,
    motions: () => Object.keys(MD()).filter((id) => !!DRAW[id]),
    player: () => _player,
    /** developer / test hook: one frame of a motion on a fresh canvas (w px wide) */
    frame(motionId, step, p, t, w, o) {
      if (!DRAW[motionId]) return null;
      const cv = document.createElement('canvas');
      const st = makeStage(cv, motionId);
      const ww = U.clamp(Math.round(Number(w) || 960), 64, 1920);
      st.size(ww, Math.round(ww * SH / SW));
      st.render(step, p, t == null ? 1.2 : t, o || {});
      _stages.delete(st);
      return cv;
    },
    /** developer / test hook: a reusable drawing surface for many frames (static layers are kept) — call dispose() */
    stage(motionId, w) {
      const D = DRAW[motionId];
      if (!D) return null;
      const cv = document.createElement('canvas');
      const st = makeStage(cv, motionId);
      const ww = U.clamp(Math.round(Number(w) || 320), 64, 1280);
      st.size(ww, Math.round(ww * SH / SW));
      return { canvas: cv, steps: (MD()[motionId]?.steps || []).length, anim: (i) => animOf(D, i), hold: D.hold ?? 2.2, render: (step, p, t, o) => st.render(step, p, t == null ? 1.2 : t, o || {}), dispose: () => st.dispose() };
    },
    stats: () => ({ stages: _stages.size, boards: _boards.size, attached: _attached.size, playing: !!(_player && _player.playing), fps: FPS }),
  };
  G.register(api);
})();
