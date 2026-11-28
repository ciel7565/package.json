// =============================================================================
// 64-interiors-e.js — rooms ⑤: the ten hanok of the 장터 거리 and the 공방 마을 (CONTRACT §19.2, lane buildings)
//   한복집 PL_HANBOK · 염색 공방 PL_DYE · 주막 PL_JUMAK · 떡집 PL_TTEOK · 한지 공방 PL_HANJI (장터 거리, west of the gate path)
//   서당 PL_SEODANG · 대장간 PL_FORGE · 방앗간 PL_MILL · 약초방 PL_HERB · 찻집 PL_TEA (공방 마을, east of the main hall)
//
// A GENERATOR FROM DATA. The rows are G.data.crafts.houses (48-interior-data.js, [buildings] block: place, zone, building,
// names, origin, size, floor, keeper); the plots are the [buildings] block of 02-layout.js (type 'craft'). This file adds:
//   G.bkit.craft(site, b, H)   the OUTSIDE of a house in the valley, called by the BUILDERS of 15-buildings.js with its
//                              own builders H = { buildHanok, buildThatched, addSignBoard, WOOD, SMOKE_SOURCES }:
//                              a tiled hanok or a thatched house, its 현판 (one sign atlas of this file), and what the
//                              house shows outside (EXT[craft]: drying lines, a water wheel, a forge chimney …)
//   the PLACES                 P.define() for every row at load: the door from G.sys.places.doorOf(building), build(ctx)
//                              = the shell from the row (G.hanok.room, walls made from the size) + FURNISH[id] (the props
//                              of the house, its exhibit anchors) + the keeper + R.finish()
//   the KEEPER                 one person in hanbok per house (G.avatar.create with a named set of G.data.avatar.presets,
//                              looked up at run time — never a hand-written id list), standing by the work place, turning
//                              to the visitor; tapping them opens the house menu (G.easy.pick): 배워요 (the house's
//                              exhibit cards, G.sys.exhibits), 해 봐요 (the one thing to do), the house's own extra (the
//                              한복집: 옷 사고팔기 → G.sys.wardrobe.openShop('SHOP_HANBOK'), 옷장 → G.sys.wardrobe.open())
//   the ONE THING TO DO        ACT[id] = { title, emoji, steps: [{ emoji, label, say, run(live, i) }] }: two to four big
//                              taps, each read aloud, each moving something in the room; it cannot fail, every step has
//                              a way out (그만), and the end is a stamp: the house's 'HX_<ID>_DO' exhibit is marked seen
//                              (G.state.places.seen — a save field the server already accepts) + G.easy.celebrate
//   G.crafts                   { houses, live(placeId), menu(placeId), act(placeId, {auto}) } — tests and the dev center
// Every room: an exit door in the south wall (kit), colliders with true tops, the kit's light and minimap plan, ≥ 2 living
// details, ≤ 200 draw calls on high, flat colours on low; no prices are shown in a room; no health claims; nothing
// flashes (all motion below 3 Hz, still under reduce motion).
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok, BK = G.bkit;
  const ROWS = (G.data.crafts && Array.isArray(G.data.crafts.houses)) ? G.data.crafts.houses : [];
  if (!P || !K || typeof K.room !== 'function' || !BK) { G.log.warn('WORLD', 'interiors-e: places / hanok kit missing — no 장터 거리 rooms'); return; }
  const PI = Math.PI, TAU = PI * 2;
  const M = BK.M, geo = BK.geo, mul = BK.mul;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const has = (name) => typeof K[name] === 'function';
  const easyOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const reduceMotion = () => !!G.settings?.reduceMotion || !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const say = (t, o) => { try { return Promise.resolve(G.easy?.say?.(t, o)).catch(() => false); } catch (e) { return Promise.resolve(false); } };
  const toast = (msg, o) => { try { G.ui?.toast?.(msg, o); } catch (e) { /* ui optional */ } };
  const byId = {}, byPlace = {}, byBuilding = {};
  for (const r of ROWS) { byId[r.id] = r; byPlace[r.place] = r; byBuilding[r.building] = r; }
  const live = {};            // placeId -> { R, ctx, keeper, things… } while the place is built

  // ============================================================================================ the OUTSIDE (valley)
  // one sign atlas of our own (the buildings atlas of 15-buildings.js is nearly full): ten 512 × 256 현판
  let ATLAS = null;
  const HYEONPAN = BK.HYEONPAN || { bg1: '#3b2a1d', bg2: '#21160e', border: '#a8823e', color: '#f2d27e', subColor: '#e9d5a6' };
  function atlas() {
    if (ATLAS) return ATLAS;
    ATLAS = new BK.SignAtlas('crafts', 1024, 1536);
    BK.registerMaterial('craftsign', () => new THREE.MeshStandardMaterial({ map: ATLAS.getTexture(), roughness: 0.72, metalness: 0.04 }));
    return ATLAS;
  }
  /** a 현판 on the front of a house: local matrix m faces +Z */
  function signBoard(site, text, w, m, frame = '#4a2f1c') {
    const rect = atlas().sign(String(text || ''), null, HYEONPAN);
    const h = w / 2;
    site.B.add('craftsign', geo.quad(w, h, rect), m);
    site.B.add('wood', geo.box(w + 0.14, h + 0.14, 0.06), mul(m, M(0, 0, -0.035)), frame);
  }
  const THATCHED = new Set(['jumak', 'forge', 'mill']);
  /** the outside of one house (15-buildings.js BUILDERS.craft) */
  BK.craft = function craft(site, b, H) {
    const row = byBuilding[b.id] || null, kind = b.craft || row?.id || '';
    const r = BK.rngOf ? BK.rngOf(b.id) : Math.random;
    let topY;
    if (THATCHED.has(kind)) {
      H.buildThatched(site, b);
      topY = 0.32 + 2.25;
      signBoard(site, b.sign || b.name, 1.5, M(b.w / 6 + 0.25, topY - 0.42, b.d / 2 + 0.16, 0, 1, 1, 1, -0.05));
    } else {
      const ph = clamp(2.55 + b.d * 0.06, 2.6, 3.2);
      H.buildHanok(site, b, { ph, veranda: b.d >= 6.5 ? 1.2 : 0.9, pillarTint: r() < 0.5 ? '#a8693f' : '#9a6440', roofTint: r() < 0.5 ? '#ffffff' : '#ece6dc', wallTint: '#fbf6ea', chimney: true, sign: null });
      topY = 0.55 + ph;
      signBoard(site, b.sign || b.name, 1.9, M(0, topY - 0.26 - 0.475, b.d / 2 + 0.2, 0, 1, 1, 1, -0.06));
    }
    try { EXT[kind]?.(site, b, H, row, topY); } catch (e) { G.log.warn('WORLD', `craft ${b.id}: outside extras failed`, e?.message || e); }
    return site;
  };
  // what a house shows outside (filled per house)
  const EXT = {};

  // ============================================================================================ the KEEPER
  const IDLE = { speed: 0, grounded: true, vy: 0 };
  function keeperLook(row) {
    const sets = Array.isArray(G.avatar?.presets) ? G.avatar.presets : (G.data.avatar?.presets || []);
    for (const id of row.keeper?.sets || []) {
      const p = sets.find((s) => s && s.id === id);
      if (p) return p.appearance || p.app || null;
    }
    return sets[0]?.appearance || G.data.avatar?.defaults || null;
  }
  /** the keeper of a house at a local spot, facing rotY; tapping opens the house menu */
  function keeper(ctx, row, spot) {
    const out = { rig: null, spot };
    try {
      if (G.avatar?.create) {
        const look = keeperLook(row);
        const rig = G.avatar.create(look ? (G.avatar.normalize ? G.avatar.normalize(look) : look) : undefined, { shadow: !ctx.low });
        rig.group.name = 'keeper:' + row.id;
        rig.group.position.set(spot.x, spot.y || 0, spot.z);
        rig.group.rotation.y = spot.rotY || 0;
        ctx.group.add(rig.group);
        out.rig = rig;
      }
    } catch (e) { G.log.warn('WORLD', `craft ${row.id}: keeper not made`, e?.message || e); }
    ctx.addCollider({ shape: 'circle', x: spot.x, z: spot.z, r: 0.38, maxY: 1.7 });
    ctx.interact({
      id: row.place + ':keeper', kind: 'talk', label: `💬 ${row.keeper?.name || '주인'}과 이야기하기`, kidLabel: `${row.keeper?.name || '주인'} 만나기`,
      emoji: '💬', radius: 3.2, priority: 0.9, position: { x: spot.x, y: 1.5, z: spot.z },
      onInteract: () => { menu(row.place); },
    });
    const _p = new THREE.Vector3(), _w = new THREE.Vector3();
    let look = 0;
    ctx.onUpdate((dt) => {
      const rig = out.rig;
      if (!rig) return;
      try { rig.update?.(dt, IDLE); } catch (e) { /* one frame */ }
      look -= dt;
      if (look > 0) return;
      look = 0.25;
      const pp = G.sys.player?.position;
      if (!pp) return;
      rig.group.getWorldPosition(_w);
      const dx = pp.x - _w.x, dz = pp.z - _w.z, d2 = dx * dx + dz * dz;
      const want = d2 < 49 ? Math.atan2(dx, dz) : (spot.rotY || 0);
      const cur = rig.group.rotation.y;
      const dd = G.util?.angleDiff ? G.util.angleDiff(cur, want) : (want - cur);
      rig.group.rotation.y = cur + clamp(dd, -0.5, 0.5);
      try { rig.setLookTarget?.(d2 < 25 ? _p.set(pp.x, pp.y + 1.4, pp.z) : null); } catch (e) { /* optional */ }
    });
    return out;
  }

  // ============================================================================================ the HOUSE MENU
  let menuOpen = false;
  async function menu(placeId) {
    const row = byPlace[placeId];
    if (!row || menuOpen || !G.easy?.pick) return null;
    menuOpen = true;
    try {
      const k = row.keeper || {};
      const items = [];
      const extra = EXTRA[row.id];
      if (extra) for (const it of extra.items) items.push({ id: 'x:' + it.id, emoji: it.emoji, label: it.label, say: it.say });
      items.push({ id: 'learn', emoji: '📖', label: '배워요', say: `${row.name}에서 알아볼 것을 골라요.` });
      if (ACT[row.id]) items.push({ id: 'do', emoji: ACT[row.id].emoji || '✋', label: '해 봐요', say: ACT[row.id].say || ACT[row.id].title });
      items.push({ id: 'bye', emoji: '👋', label: '그만', say: '다음에 또 와요.' });
      const pick = await G.easy.pick({ title: `${row.emoji} ${k.name || row.name}`, say: k.hello || row.desc, emoji: row.emoji, items, columns: items.length > 4 ? 3 : 2 });
      menuOpen = false;
      if (!pick || pick === 'bye') return pick;
      if (pick === 'learn') return learn(row);
      if (pick === 'do') return act(placeId);
      if (pick.startsWith('x:') && extra) { const it = extra.items.find((x) => 'x:' + x.id === pick); try { it?.run?.(row); } catch (e) { G.log.warn('UI', `craft ${row.id}: ${it?.id} failed`, e?.message || e); } }
      return pick;
    } catch (e) {
      G.log.warn('UI', `craft ${row.id}: menu failed`, e?.message || e);
      return null;
    } finally { menuOpen = false; }
  }
  /** the house's exhibit cards (G.sys.exhibits) as a picture list */
  async function learn(row) {
    const EX = G.sys.exhibits;
    const list = (EX?.forPlace?.(row.place) || []).filter((e) => !/_DO$/.test(e.id));
    if (!list.length) { toast(`${row.name} 이야기를 준비하고 있어요.`, { emoji: row.emoji }); return null; }
    const id = await G.easy.pick({ title: `📖 ${row.name}에서 배워요`, say: '궁금한 것을 눌러요.', emoji: '📖', columns: list.length > 4 ? 3 : 2,
      items: list.slice(0, 8).map((e) => ({ id: e.id, emoji: e.emoji || '📖', label: e.title, say: e.kid, badge: e.seen ? '✔' : '' })) });
    if (id && EX?.open) EX.open(id, { via: 'keeper' });
    return id;
  }

  // ============================================================================================ the ONE THING TO DO
  // per house: { title, emoji, say, end, steps: [{ emoji, label, say, done, run(L, i) }] } — a step's run() calls the room's
  // own hook L.step(i) (set by FURNISH: the cloth deepens, the fire grows, the pestle falls …); nothing can go wrong
  const stepRun = (L, i) => { if (L && typeof L.step === 'function') return L.step(i); return null; };
  const steps = (rows) => rows.map(([emoji, label, s, done]) => ({ emoji, label, say: s, done, run: stepRun }));
  const ACT = {
    hanbok: { title: '저고리 짓기', emoji: '🪡', say: '옷감을 골라 저고리를 지어 봐요.', end: '참 잘했어요. 고운 저고리가 다 지어졌어요.', steps: steps([
      ['🧵', '옷감 고르기', '선반에서 고운 옷감을 골라요.', '고운 옷감을 골랐어요.'],
      ['✂️', '마름질하기', '옷본을 대고 옷감을 알맞게 잘라요.', '조각조각 잘랐어요.'],
      ['🪡', '바느질하기', '한 땀 한 땀 바느질로 이어요.', '저고리가 다 지어졌어요.']]) },
    dye: { title: '쪽물 들이기', emoji: '🫙', say: '흰 천을 쪽물에 담가 봐요. 담글 때마다 색이 짙어져요.', end: '참 잘했어요. 하늘빛이 바다빛이 되었어요.', steps: steps([
      ['🫙', '한 번 담그기', '흰 천을 쪽물에 살짝 담가요.', '옅은 하늘빛이 들었어요.'],
      ['🫙', '두 번 담그기', '한 번 더 담가요. 바람에 말리면 더 파래져요.', '조금 더 짙어졌어요.'],
      ['🫙', '세 번 담그기', '마지막으로 한 번 더 담가요.', '짙은 쪽빛이 되었어요.']]) },
    jumak: { title: '국밥 한 상 차리기', emoji: '🍲', say: '배고픈 길손에게 국밥 한 상을 차려 봐요.', end: '참 잘했어요. 따끈한 국밥 한 상이에요.', steps: steps([
      ['🥄', '국 뜨기', '가마솥에서 뜨끈한 국을 떠요.', '김이 모락모락 나요.'],
      ['🍚', '밥 말기', '국에 밥을 말아요.', '국밥이 되었어요.'],
      ['🥤', '식혜 내기', '시원한 식혜도 한 그릇 곁들여요.', '한 상이 다 차려졌어요.']]) },
    tteok: { title: '떡메 치기', emoji: '🔨', say: '찐 찹쌀을 떡메로 쳐서 인절미를 만들어 봐요.', end: '참 잘했어요. 쫀득한 인절미가 되었어요.', steps: steps([
      ['🔨', '쿵! 한 번', '떡메를 들어 쿵 내려쳐요.', '쿵!'],
      ['🔨', '쿵! 두 번', '한 번 더 쿵 쳐요.', '떡이 차져요.'],
      ['🔨', '쿵! 세 번', '마지막으로 쿵!', '찰떡이 되었어요.'],
      ['🫘', '콩고물 묻히기', '콩고물을 솔솔 묻혀요.', '인절미가 다 되었어요.']]) },
    hanji: { title: '종이 뜨기', emoji: '📜', say: '대나무 발로 종이를 한 장 떠 봐요.', end: '참 잘했어요. 고운 한지 한 장이 생겼어요.', steps: steps([
      ['🌊', '발 담그기', '발을 닥물 통에 넣어 앞뒤로 흔들어요.', '섬유가 고르게 퍼졌어요.'],
      ['🖐️', '종이 들어 올리기', '살살 들어 올려 물을 빼요.', '얇은 종이가 떠졌어요.'],
      ['☀️', '말리기', '판에 붙여 말려요.', '보송보송 말랐어요.']]) },
    seodang: { title: '셈하기와 한글 놀이', emoji: '✏️', say: '산가지로 셈을 하고 한글을 써 봐요.', end: '참 잘했어요. 훈장님이 칭찬하셨어요.', steps: steps([
      ['🥢', '산가지 세 개', '산가지 세 개를 놓아요. 하나, 둘, 셋!', '세 개예요.'],
      ['🥢', '두 개 더하기', '두 개를 더 놓아요. 모두 몇 개일까요? 다섯 개예요!', '셋 더하기 둘은 다섯이에요.'],
      ['🖌️', '한글 쓰기', '붓으로 기역과 아를 모아 가를 써요.', '가 글자를 썼어요.']]) },
    forge: { title: '풀무질하기', emoji: '💨', say: '풀무를 밀어 화덕에 바람을 넣어 봐요. 불은 멀리서 봐요.', end: '참 잘했어요. 불이 살아나 쇠가 빨갛게 달았어요.', steps: steps([
      ['💨', '풀무 밀기', '풀무를 쭉 밀어요.', '불이 조금 살아났어요.'],
      ['💨', '한 번 더', '한 번 더 밀어요.', '불이 환해졌어요.'],
      ['🔨', '쇠 두드리기', '대장장이가 달군 쇠를 모루에서 두드려요.', '땅, 땅! 호미 날이 섰어요.']]) },
    mill: { title: '디딜방아 찧기', emoji: '🦶', say: '디딜방아를 밟아 곡식을 찧어 봐요.', end: '참 잘했어요. 곡식이 고운 쌀이 되었어요.', steps: steps([
      ['🦶', '꾹 밟기', '방아채 끝을 꾹 밟아요.', '공이가 번쩍 들렸어요.'],
      ['🦶', '쿵 놓기', '발을 떼면 공이가 쿵 떨어져요.', '쿵! 곡식이 찧어져요.'],
      ['🦶', '한 번 더', '한 번 더 밟았다 놓아요.', '껍질이 벗겨졌어요.']]) },
    herb: { title: '향 맡아 보기', emoji: '👃', say: '말린 풀 단지를 열어 향을 맡아 봐요.', end: '참 잘했어요. 풀마다 향이 다 달라요.', steps: steps([
      ['🌱', '쑥 향', '쑥 단지를 열어요. 향긋한 냄새가 나요.', '쑥 냄새예요.'],
      ['🌼', '국화 향', '국화 단지를 열어요. 꽃 향이 은은해요.', '국화 냄새예요.'],
      ['🍂', '감잎 향', '감잎 단지를 열어요. 풀 냄새가 나요.', '감잎 냄새예요.']]) },
    tea: { title: '차 한 잔 우리기', emoji: '🍵', say: '찻잔을 데우고, 따르고, 기다려 봐요.', end: '참 잘했어요. 맑은 차 한 잔이에요.', steps: steps([
      ['♨️', '잔 데우기', '따뜻한 물로 찻잔을 데워요.', '찻잔이 따뜻해졌어요.'],
      ['🫖', '차 따르기', '다관에서 찻잔에 차를 따라요.', '맑은 차가 담겼어요.'],
      ['⏳', '기다리기', '조금 식을 때까지 기다려요. 하나, 둘, 셋.', '알맞게 식었어요.']]) },
  };
  // per house: { items: [{ id, emoji, label, say, run(row) }] } — the house's own choices in the keeper's menu
  const wardrobe = (fn, ...a) => { const W = G.sys.wardrobe; if (W && typeof W[fn] === 'function') return W[fn](...a); toast('옷장을 준비하고 있어요. 조금만 기다려 주세요.', { emoji: '👘' }); return null; };
  const EXTRA = {
    hanbok: { items: [
      { id: 'shop', emoji: '🛍️', label: '옷 사고팔기', say: '한복집에서 옷을 사고팔아요.', run: () => wardrobe('openShop', 'SHOP_HANBOK') },
      { id: 'closet', emoji: '🪞', label: '옷장 열기', say: '거울 앞에서 옷을 갈아입어요.', run: () => wardrobe('open') },
    ] },
  };
  let acting = false;
  /** run the house's activity: auto = true runs every step without a picker (tests, the dev center) */
  async function act(placeId, o = {}) {
    const row = byPlace[placeId], A = row ? ACT[row.id] : null;
    if (!A || acting) return false;
    acting = true;
    try {
      const L = live[placeId] || null;
      for (let i = 0; i < A.steps.length; i++) {
        const s = A.steps[i];
        if (!o.auto) {
          const pick = await G.easy.pick({ title: `${A.emoji || '✋'} ${A.title} (${i + 1}/${A.steps.length})`, say: s.say, emoji: s.emoji,
            items: [{ id: 'go', emoji: s.emoji, label: s.label, say: s.say }, { id: 'stop', emoji: '👋', label: '그만', say: '그만할게요. 언제든 다시 해요.' }], columns: 2 });
          if (pick !== 'go') return false;
        }
        try { await s.run?.(L, i); } catch (e) { G.log.warn('WORLD', `craft ${row.id}: step ${i} failed`, e?.message || e); }
        if (s.done) say(s.done, { priority: 1 });
        if (!o.auto) await wait(reduceMotion() ? 300 : 1300);
      }
      stamp(row, o);
      return true;
    } finally { acting = false; }
  }
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  /** the end of an activity: the house's stamp (a seen exhibit) + a celebration */
  function stamp(row, o = {}) {
    const id = 'HX_' + row.id.toUpperCase() + '_DO';
    try { if (G.data.exhibits?.[id]) G.sys.exhibits?.seen?.(id, true); } catch (e) { /* the stamp is optional */ }
    const A = ACT[row.id];
    try { G.bus?.emit?.('craft:done', { id: row.id, place: row.place }); } catch (e) { /* bus */ }
    if (!o.auto && G.easy?.celebrate) G.easy.celebrate(`${A?.title || row.name} 했어요!`, { emoji: A?.emoji || row.emoji, say: A?.end || `참 잘했어요. ${row.name} 도장을 찍었어요.` });
  }

  // ============================================================================================ the ROOM SHELL
  const odd = (n) => (n % 2 ? n : n + 1);
  /** walls made from the size: the south wall has the exit door in its middle bay */
  function shellSpec(row) {
    const w = row.size.w, d = row.size.d;
    const nx = Math.max(3, odd(Math.round(w / 2.9))), nz = Math.max(2, Math.round(d / 3));
    const mid = (nx - 1) / 2;
    const S = [], N = [];
    for (let i = 0; i < nx; i++) {
      S.push(i === mid ? { door: 'changho', exit: true, w: 1.7, h: 2.15 } : (Math.abs(i - mid) === 1 ? { window: 'jeongja', w: 2.0, h: 1.25, sill: 0.75 } : 'plaster'));
      N.push(i === mid ? { window: 'ttisal', w: 1.8, h: 1.2, sill: 0.9 } : 'plaster');
    }
    const side = (n) => Array.from({ length: n }, (_, j) => (j === Math.floor(n / 2) ? { window: 'ttisal', w: 1.4, h: 1.1, sill: 0.95 } : 'plaster'));
    return { w, d, post: row.post || 2.7, ridge: row.size.h, bays: { x: nx, z: nz }, floor: row.floor || 'maru', roof: row.roof || 'rafters', tone: row.tone || 'warm',
      walls: Object.assign({ N, E: side(nz), S, W: side(nz) }, row.walls || {}), sun: { az: 170, el: 34 } };
  }
  const FURNISH = {};   // per house: (R, ctx, row, L) → the props, anchors, living details (L = the live record)

  function buildHouse(row) {
    return function build(ctx) {
      const L = { row, ctx };
      const R = K.room(ctx, shellSpec(row));
      L.R = R;
      const A = (key, spot) => ctx.anchor(key, spot);
      L.A = A;
      try {
        if (FURNISH[row.id]) FURNISH[row.id](R, ctx, row, L);
        else plain(R, ctx, row, L);
      } catch (e) { G.log.warn('WORLD', `craft ${row.id}: furnishing failed`, e?.message || e); }
      ctx.onUpdate((dt) => runTweens(L, dt));
      // the keeper (where FURNISH said, or by the north wall)
      const ks = L.keeperSpot || { x: 0, z: -row.size.d / 2 + 1.6, rotY: 0 };
      L.keeper = keeper(ctx, row, ks);
      // the fallback shelf for exhibits whose anchor is missing
      if (!L.shelf) R.shelfWall('E', 0, { levels: 2, slots: 3, w: 1.8, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));
      R.finish();
      live[row.place] = L;
      return { dispose() { try { L.keeper?.rig?.dispose?.(); } catch (e) { /* gone */ } if (live[row.place] === L) delete live[row.place]; } };
    };
  }
  /** a plain room: a name plate, a mat, a lamp (until a house has its own furnishing) */
  function plain(R, ctx, row) {
    R.label(row.name, { side: 'N', u: row.size.w / 2, v: 2.2, n: 0.09, w: 1.6, h: 0.32, style: 'wood' });
    K.floorMat(R, { x: 0, z: 0.5, w: 3.2, d: 2.2 });
    if (has('jwadeung')) K.jwadeung(R, { x: row.size.w / 2 - 1.0, z: -row.size.d / 2 + 0.9 });
    ctx.light({ x: 0, y: 2.2, z: 0, color: '#ffc98a', intensity: 3.0, distance: 8, decay: 1.8, day: 0.2 });
    K.dust(R, { count: 60 });
  }

  // ============================================================================================ shared pieces
  /** the named dyes of the avatar table (G.data.avatar.dyes) by id, read at run time; a fallback colour without it */
  function dye(id, fb) { const d = (G.data.avatar?.dyes || []).find((x) => x && x.id === id); return d ? d.hex : fb; }
  function dyeName(id, fb) { const d = (G.data.avatar?.dyes || []).find((x) => x && x.id === id); return d ? d.name : fb; }
  /**
   * cloth strips that move in the wind: ONE mesh (vertex colours, a sway in the vertex shader that grows towards the free
   * end), a material of its own. strips: [{x, y, z, w, h, color, rotY}] (top edge centre); returns { mesh, update(dt, k) }.
   * k = wind strength (0 = still: reduce motion). Never faster than 0.5 Hz.
   */
  function windCloth(strips, o = {}) {
    const pos = [], nor = [], col = [], sway = [], idx = [];
    const c = new THREE.Color();
    const NX = 4, NY = 8;
    for (const s of strips) {
      c.set(s.color || '#ffffff');
      const cs = Math.cos(s.rotY || 0), sn = Math.sin(s.rotY || 0), ph = Math.random() * TAU;
      const base0 = pos.length / 3;
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        const u = (i / NX - 0.5) * s.w, v = -(j / NY) * s.h;
        pos.push(s.x + u * cs, s.y + v, s.z - u * sn); nor.push(sn, 0, cs);
        const shade = 0.92 + 0.08 * Math.sin(i * 2.1 + j);
        col.push(c.r * shade, c.g * shade, c.b * shade); sway.push(j / NY, ph);
      }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = base0 + j * (NX + 1) + i, b = a + 1, d = a + NX + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const U = { uT: { value: 0 }, uK: { value: 1 }, uDir: { value: new THREE.Vector2(0.8, 0.6) } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aSway; uniform float uT; uniform float uK; uniform vec2 uDir;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float sw = aSway.x * aSway.x;
          float w1 = sin(uT * 1.7 + aSway.y + position.y * 2.0) * 0.6 + sin(uT * 2.9 + aSway.y * 1.3) * 0.25;
          transformed.x += uDir.x * (0.05 + 0.07 * w1) * sw * uK;
          transformed.z += uDir.y * (0.05 + 0.07 * w1) * sw * uK;`);
    };
    mat.customProgramCacheKey = () => 'tfm-windcloth';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = o.name || 'wind-cloth';
    mesh.castShadow = !!o.cast; mesh.receiveShadow = true;
    return { mesh, uniforms: U, update(dt, k) { U.uT.value = (U.uT.value + Math.min(dt || 0, 0.1)) % 1000; U.uK.value = reduceMotion() ? 0 : (k == null ? 1 : k); } };
  }
  /** a hanging jeogori (저고리), front view, its top centre at m (faces +Z) — boxes only, merge-friendly */
  function jeogori(T, m, o = {}) {
    const body = o.tint || '#f1ece1', trim = o.trim || '#24508e', go = o.goreum || '#c23a4a', s = o.s || 1;
    const S = (x, y, z, w, h, d, tn, rz = 0) => T.add('cloth', K.geo.slab(w * s, h * s, d, 0.004), mul(m, M(x * s, y * s, z, 0, 1, 1, 1, 0, rz)), tn, o);
    S(0, -0.19, 0, 0.5, 0.36, 0.035, body);                                     // 길 (body)
    for (const sx of [-1, 1]) {
      S(sx * 0.42, -0.12, 0, 0.42, 0.17, 0.03, body, sx * -0.38);              // 소매 (sleeves), drooping
      S(sx * 0.6, -0.26, 0.002, 0.07, 0.19, 0.034, trim, sx * -0.38);          // 끝동 (cuffs)
    }
    S(-0.07, -0.13, 0.02, 0.06, 0.3, 0.012, trim, -0.62);                      // 깃 (collar), crossing
    S(-0.055, -0.115, 0.027, 0.02, 0.27, 0.008, '#ffffff', -0.62);              // 동정 (white collar strip)
    S(0.09, -0.24, 0.026, 0.035, 0.26, 0.008, go, 0.08);                         // 고름 (long ribbon)
    S(0.13, -0.2, 0.026, 0.03, 0.14, 0.008, go, -0.25);                          // 고름 (short ribbon)
  }
  /** a pleated 치마 hung by its waistband at m (faces +Z): a grid that widens downward, pleats as a zigzag */
  function chima(T, m, o = {}) {
    const w0 = (o.w || 0.6), w1 = w0 * 1.5, h = o.h || 1.05, tn = o.tint || '#d9534f', NX = 24, NY = 6;
    for (const flip of [false, true]) {
      const g = geo.grid(NX, NY, (i, j, out) => {
        const u = i / NX, v = j / NY, w = w0 + (w1 - w0) * v;
        out[0] = (u - 0.5) * w; out[1] = -v * h; out[2] = (i % 2 ? 0.018 : -0.018) * (0.4 + v) + (flip ? -0.004 : 0);
        out[3] = u * w; out[4] = v * h;
      }, flip);
      T.add('cloth', g, m, tn, o);
    }
    T.add('cloth', K.geo.slab(w0 + 0.04, 0.06, 0.03, 0.004), mul(m, M(0, -0.02, 0)), o.band || '#f1ece1', o);   // 허리말기
  }
  /** a 횃대: a bar on two posts with things hanging from it; returns the hook spots (local to the room) */
  function haetdae(R, o) {
    const len = o.len || 2.4, y = o.y || 1.95, ry = o.rotY || 0, m0 = M(o.x, 0, o.z, ry);
    for (const sx of [-1, 1]) {
      R.add('furn', K.geo.slab(0.06, y + 0.08, 0.06, 0.008), mul(m0, M(sx * len / 2, (y + 0.08) / 2, 0)), '#5a3822');
      R.add('furn', K.geo.slab(0.36, 0.05, 0.3, 0.008), mul(m0, M(sx * len / 2, 0.025, 0)), '#5a3822');
    }
    const bar = geo.cyl(0.022, 0.022, len + 0.16, 10); bar.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
    R.add('furn', bar, mul(m0, M(0, y, 0)), '#6e4129');
    return { m0, y, len };
  }
  /** a tween helper for room hooks: run fn(t 0..1) over sec seconds inside the room's update loop */
  function tween(L, sec, fn, done) {
    (L.tweens || (L.tweens = [])).push({ t: 0, sec: reduceMotion() ? 0.01 : sec, fn, done });
  }
  /** run the room's tweens (buildHouse registers it with ctx.onUpdate) */
  function runTweens(L, dt) {
    const list = L.tweens;
    if (!list || !list.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const tw = list[i];
      tw.t = Math.min(1, tw.t + (dt || 0) / tw.sec);
      try { tw.fn(tw.t); } catch (e) { /* one frame */ }
      if (tw.t >= 1) { list.splice(i, 1); try { tw.done?.(); } catch (e) { /* done */ } }
    }
  }
  const ease = (t) => t * t * (3 - 2 * t);

  // ============================================================================================ 한복집 PL_HANBOK
  // A tailor's shop under open rafters: shelves of cloth bolts (필) in the named dyes along the north wall, the keeper behind
  // a long cutting table (ruler, scissors, thread, the 인두 in its 화로), hanging 저고리 and 치마 on two 횃대, a 다듬잇돌, a
  // tall mirror (→ 옷장), folded clothes on a 반닫이, cushions for customers by the door. Thing to do: 저고리 짓기 — the
  // chosen colour's bolt comes to the table, is cut into pieces, and a new jeogori in that colour hangs on the stand.
  FURNISH.hanbok = function (R, ctx, row, L) {
    const A = L.A, w = row.size.w, d = row.size.d, hw = w / 2, hd = d / 2;
    const DY = ['jjok', 'cheong', 'ok', 'chorok', 'songhwa', 'chija', 'dahong', 'yeonji', 'bunhong', 'jaju', 'bora', 'nam', 'mosi', 'so', 'gal', 'meok'];
    const cols = DY.map((k) => dye(k, '#c9b38f'));
    // ---- north wall: four shelf units full of bolts; the name board over the middle window
    let n = 0;
    for (const sx of [-5.6, -2.8, 2.8, 5.6]) {
      const spots = K.shelf(R, { x: sx, z: -hd + 0.32, w: 2.3, d: 0.48, h: 2.05, levels: 4, back: true, tone: '#5e3a22' });
      spots.forEach((sp) => {
        for (let k = 0; k < 6; k++) { K.roll(R, { x: sp.x - 0.9 + k * 0.36, y: sp.y, z: sp.z + 0.02, len: 0.42, r: 0.072, tint: cols[(n * 5 + k * 3) % cols.length], band: '#e9dcc0', rotY: PI / 2 }); }
        n++;
      });
      R.block(sx, -hd + 0.32, 1.17, 0.26, { maxY: 2.1 });
    }
    R.label('한복집', { side: 'N', u: hw, v: 2.35, n: 0.09, w: 1.5, h: 0.32, style: 'wood' });
    A('otgam', { x: -2.8, y: 1.5, z: -hd + 0.75 });
    // ---- the cutting table and what lies on it
    const tz = -1.0, tw = K.table(R, { x: 0, z: tz, w: 2.8, d: 1.1, h: 0.76, legs: 'straight', tone: '#7a4a2c' });
    const top = tw.top;
    R.block(0, tz, 1.42, 0.57, { maxY: top + 0.05 });
    R.add('cloth', K.geo.slab(1.3, 0.012, 0.62, 0.003), M(-0.45, top + 0.006, tz + 0.05, 0.08), dye('mosi', '#e8d9b5'));          // a length of 모시 laid out
    R.add('furn', K.geo.slab(0.9, 0.01, 0.04, 0.002), M(-0.45, top + 0.018, tz + 0.42, 0.08), '#c9a46a');                           // 자 (ruler)
    for (const [x, z, tn] of [[0.75, tz - 0.2, '#c23a4a'], [0.86, tz - 0.12, '#24508e'], [0.8, tz - 0.32, '#f2e18c']]) {          // 실패 (thread spools)
      R.add('furn', geo.cyl(0.03, 0.03, 0.07, 10), M(x, top + 0.035, z), '#8a5a36'); R.add('cloth', geo.cyl(0.026, 0.026, 0.05, 10), M(x, top + 0.035, z), tn);
    }
    R.add('iron', K.geo.slab(0.16, 0.012, 0.03, 0.002), M(0.4, top + 0.008, tz + 0.3, 0.5), '#6a6a6a');                              // 가위 (scissors)
    R.add('iron', K.geo.slab(0.16, 0.012, 0.03, 0.002), M(0.4, top + 0.008, tz + 0.3, -0.2), '#6a6a6a');
    K.pot(R, { kind: 'brazier', x: 1.15, y: top, z: tz + 0.1, s: 0.7 });                                                              // 화로 with the 인두
    R.add('iron', geo.cyl(0.004, 0.004, 0.32, 6), M(1.1, top + 0.22, tz + 0.1, 0, 1, 1, 1, 0, 0.7), '#3a3a3a');
    R.add('iron', K.geo.slab(0.05, 0.012, 0.09, 0.002), M(1.0, top + 0.12, tz + 0.1, 0.3), '#2e2e2e');
    if (has('bojagi')) K.bojagi(R, { x: -1.2, y: top, z: tz - 0.32, w: 0.26, h: 0.12, tint: dye('dahong', '#d9534f'), trim: dye('songhwa', '#f2e18c') });
    A('indu', { x: 1.1, y: top + 0.35, z: tz + 0.5 });
    L.keeperSpot = { x: 0.3, z: tz - 1.0, rotY: 0 };
    // ---- west: two 횃대 with hanging clothes (they sway a little when the door lets the air in)
    const hangs = [
      { x: -hw + 0.9, z: -1.2, rotY: PI / 2, items: [['j', 'ok', 'jajeok'], ['c', 'dahong'], ['j', 'songhwa', 'nam']] },
      { x: -hw + 0.9, z: 2.0, rotY: PI / 2, items: [['j', 'mosi', 'gam'], ['c', 'nam'], ['j', 'yeonji', 'chorok']] },
    ];
    for (const hg of hangs) {
      const H0 = haetdae(R, { x: hg.x, z: hg.z, rotY: hg.rotY, len: 2.3, y: 1.95 });
      R.block(hg.x, hg.z, 0.32, 1.25, { maxY: 2.0 });
      hg.items.forEach(([kind, c1, c2], i) => {
        const u = (i - 1) * 0.76;
        const S = has('sway') ? K.sway(R, { x: hg.x, y: H0.y, z: hg.z + u, amp: 0.025, speed: 0.4 + i * 0.07, axis: 'z' }) : R;
        const m = mul(H0.m0, M(u, H0.y - 0.02, 0.04));
        if (kind === 'j') jeogori(S, m, { tint: dye(c1, '#f1ece1'), trim: dye(c2, '#24508e'), goreum: dye(c2, '#c23a4a') });
        else chima(S, m, { tint: dye(c1, '#d9534f'), w: 0.56, h: 1.0 });
        if (S !== R) S.done();
      });
    }
    A('jeogori', { x: -hw + 1.3, y: 1.6, z: -1.2 });
    A('chima', { x: -hw + 1.3, y: 1.3, z: 2.0 });
    A('goreum', { x: -hw + 1.3, y: 1.7, z: -2.0 });
    // ---- the display stand where the visitor's jeogori will hang (thing to do), by the table
    const st = haetdae(R, { x: 2.6, z: -2.25, rotY: 0, len: 1.2, y: 1.8 });
    R.block(2.6, -2.25, 0.7, 0.22, { maxY: 1.85 });
    // ---- east: the tall mirror (→ 옷장), a 반닫이 with folded clothes, the 다듬잇돌
    const mx = hw - 0.45, mz = 0.6;
    R.add('furn', K.geo.slab(0.08, 2.0, 0.9, 0.01), M(mx, 1.05, mz), '#4a2a18');
    R.add('furn', K.geo.slab(0.5, 0.08, 1.1, 0.01), M(mx - 0.1, 0.04, mz), '#4a2a18');
    R.add('brass', K.geo.slab(0.012, 0.1, 0.1, 0.002), M(mx - 0.045, 1.98, mz), '#c9a24a');
    const mirrorMat = ctx.own(new THREE.MeshStandardMaterial({ color: ctx.low ? '#b9c4c8' : '#e6ebee', metalness: ctx.low ? 0.2 : 1.0, roughness: 0.06 }));
    const mirror = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(0.76, 1.8)), mirrorMat);
    mirror.position.set(mx - 0.046, 1.08, mz); mirror.rotation.y = -PI / 2; mirror.name = 'hanbok-mirror';
    R.addMesh(mirror);
    R.block(mx - 0.05, mz, 0.3, 0.55, { maxY: 2.1 });
    ctx.interact({ id: 'PL_HANBOK:mirror', kind: 'wardrobe', label: '🪞 옷장 열기 (거울)', kidLabel: '거울 보고 옷 입기', emoji: '🪞', radius: 2.8, priority: 0.7,
      position: { x: mx - 0.6, y: 1.2, z: mz }, onInteract: () => wardrobe('open') });
    const ch = K.chest(R, { x: hw - 0.55, z: -2.6, rotY: -PI / 2, w: 1.3, d: 0.5, h: 0.78, doors: 2, fittings: 'brass', tone: '#7a3e24' });
    R.block(hw - 0.55, -2.6, 0.27, 0.67, { maxY: 0.8 });
    ['so', 'ok', 'dahong', 'nam'].forEach((k, i) => R.add('cloth', K.geo.slab(0.42, 0.05, 0.36, 0.01), M(hw - 0.56, 0.78 + 0.03 + i * 0.052, -2.6 + (i % 2 ? 0.02 : -0.02), 0.05 * i), dye(k, '#e9dcc0')));
    if (has('dadeumitdol')) { K.dadeumitdol(R, { x: hw - 1.3, z: 2.9, rotY: -PI / 2 }); R.block(hw - 1.3, 2.9, 0.18, 0.36, { maxY: 0.3 }); }
    A('dadeumi', { x: hw - 1.3, y: 0.5, z: 2.9 });
    // ---- by the door: cushions and a low table for customers, a pair of 꽃신 on the step, 청사초롱
    for (const x of [-3.4, -2.4]) K.cushion(R, { x, z: hd - 1.4, w: 0.62, d: 0.62, tint: dye('dahong', '#b8322e'), trim: dye('nam', '#2f4f8a') });
    if (has('shoes')) { K.shoes(R, { x: -0.9, z: hd - 0.55, kind: 'kkotsin', tint: dye('bunhong', '#f08bb0') }); }
    if (has('chorong')) for (const x of [-1.4, 1.4]) K.chorong(R, { x, y: R.post - 0.05, z: tz, hang: true, drop: 0.45 });
    if (has('jogakbo')) K.jogakbo(R, { m: R.wm('E', 1.4, 1.55, 0.04), w: 0.9, h: 0.9, seed: 7, wall: 'E' });
    // ---- light and life
    ctx.light({ x: 0, y: 2.3, z: tz, color: '#ffcf8f', intensity: 5.0, distance: 9, decay: 1.7, flicker: 0.04, day: 0.25 });
    ctx.light({ x: hw - 1.2, y: 2.0, z: 0.6, color: '#ffd6a0', intensity: 2.4, distance: 6, decay: 1.8, day: 0.15 });
    K.dust(R, { count: 90 });
    // ---- the thing to do: the bolt, the cut pieces, the new jeogori (own material, coloured at step 0)
    const dm = ctx.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 }));
    const bolt = new THREE.Mesh(ctx.own(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16).rotateZ(PI / 2)), dm);
    bolt.position.set(0.25, top + 0.09, tz - 0.05); bolt.visible = false; R.addMesh(bolt);
    const pieces = new THREE.Group(); pieces.visible = false;
    for (const [x, z, sw, sd, r] of [[0.1, -0.15, 0.45, 0.3, 0.1], [0.55, -0.12, 0.3, 0.18, -0.2], [0.5, 0.12, 0.3, 0.18, 0.25], [0.12, 0.2, 0.28, 0.12, 0]]) {
      const p = new THREE.Mesh(ctx.own(new THREE.BoxGeometry(sw, 0.012, sd)), dm); p.position.set(x, top + 0.012, tz + z); p.rotation.y = r; pieces.add(p);
    }
    R.addMesh(pieces);
    const newJ = new THREE.Group(); newJ.visible = false; newJ.name = 'hanbok-new-jeogori';
    const JB = new BK.Bucket(); const JT = { add: (key, g, m, tn) => JB.add(key, g, m, tn) };
    jeogori(JT, M(0, 0, 0), { tint: '#ffffff', trim: '#ffffff', goreum: '#ffffff' });
    JB.build(newJ, { name: 'hanbok-new', materials: { cloth: dm }, shadows: false, ao: false });
    newJ.position.set(2.6, st.y - 0.02, -2.25 + 0.05); R.addMesh(newJ);
    A('do', { x: 2.6, y: 1.5, z: -1.9 });
    const pickCol = ['jjok', 'dahong', 'ok', 'songhwa', 'yeonji', 'chorok'];
    L.step = (i) => {
      if (i === 0) {
        L.color = dye(pickCol[(Math.random() * pickCol.length) | 0], '#24508e');
        dm.color.set(L.color); bolt.visible = true; pieces.visible = false; newJ.visible = false;
        bolt.position.y = top + 0.6;
        tween(L, 0.8, (t) => { bolt.position.y = top + 0.09 + (1 - ease(t)) * 0.5; });
        return dyeName(pickCol[0]);
      }
      if (i === 1) { bolt.visible = false; pieces.visible = true; pieces.scale.setScalar(0.6); tween(L, 0.6, (t) => pieces.scale.setScalar(0.6 + 0.4 * ease(t))); return null; }
      pieces.visible = false; newJ.visible = true; newJ.scale.setScalar(0.3);
      tween(L, 0.9, (t) => newJ.scale.setScalar(0.3 + 0.7 * ease(t)));
      return null;
    };
  };

  // ============================================================================================ 염색 공방 PL_DYE
  // An earth-floored workshop under smoke-dark rafters: five dye jars along the north wall (쪽 · 홍화 · 치자 · 소목 · 감물),
  // each with what it is made from in a basket and its name on the wall; a drying line across the room with strips in the
  // named dyes of G.data.avatar moving in the draught; a hearth with a cauldron of 소목 simmering (fire, steam); the
  // dipping frame over the big 쪽물 jar where the visitor dips a white cloth three times — it deepens dip by dip.
  const DYE_VATS = [
    { key: 'jjok', dye: 'jjok', liquid: '#1d3f73', name: '쪽', raw: 'leaf' },
    { key: 'honghwa', dye: 'yeonji', liquid: '#9e2238', name: '홍화', raw: 'petal' },
    { key: 'chija', dye: 'chija', liquid: '#e0a92e', name: '치자', raw: 'fruit' },
    { key: 'somok', dye: 'jaju', liquid: '#6a1f33', name: '소목', raw: 'chip' },
    { key: 'gammul', dye: 'gal', liquid: '#6a4a30', name: '감물', raw: 'persimmon' },
  ];
  FURNISH.dye = function (R, ctx, row, L) {
    const A = L.A, w = row.size.w, d = row.size.d, hw = w / 2, hd = d / 2;
    // ---- the five jars along the north wall, what each is made from, the names on the wall
    DYE_VATS.forEach((v, i) => {
      const x = -5.2 + i * 2.6, z = -hd + 0.9;
      const p = K.pot(R, { kind: 'dok', x, z, s: 0.82 });
      R.add('paint', geo.cyl(0.33, 0.33, 0.012, 22), M(x, p.top - 0.08, z), v.liquid);
      R.block(x, z, 0.4, 0.4, { maxY: p.top });
      const bx = x + 0.75, bz = z + 0.35;
      K.basket(R, { x: bx, z: bz, r: 0.22, h: 0.13 });
      const rnd = R.rnd || Math.random;
      for (let k = 0; k < 14; k++) {
        const a = rnd() * TAU, rr = rnd() * 0.15, px = bx + Math.cos(a) * rr, pz = bz + Math.sin(a) * rr, py = 0.12 + rnd() * 0.03;
        if (v.raw === 'leaf') R.add('cloth', K.geo.slab(0.07, 0.006, 0.035, 0.001), M(px, py, pz, a), '#3f6b3a');
        else if (v.raw === 'petal') R.add('cloth', K.geo.slab(0.03, 0.008, 0.018, 0.001), M(px, py, pz, a), k % 3 ? '#e2562a' : '#f2a03a');
        else if (v.raw === 'fruit') R.add('paint', geo.cyl(0.018, 0.022, 0.05, 6), M(px, py + 0.01, pz, a, 1, 1, 1, PI / 2), '#e07a1f');
        else if (v.raw === 'chip') R.add('furn', K.geo.slab(0.06, 0.012, 0.02, 0.002), M(px, py, pz, a), '#9a3b2a');
        else R.add('paint', geo.cyl(0.026, 0.03, 0.04, 8), M(px, py + 0.01, pz, a), '#6f8a3a');
      }
      R.label(v.name, { side: 'N', u: x + hw, v: 1.75, n: 0.08, w: 0.7, h: 0.28, style: 'paper' });
      A(v.key, { x, y: 1.05, z: z + 0.3 });
    });
    // ---- the drying line: strips in the named dyes of the avatar table, moving in the draught
    const DRY = ['jjok', 'cheong', 'ok', 'cheoncheong', 'dahong', 'yeonji', 'bunhong', 'chija', 'hwang', 'songhwa', 'jaju', 'gal', 'godong', 'ssuk'];
    const strips = [];
    const lineY = R.post - 0.12, lz = 0.6;
    DRY.forEach((k, i) => strips.push({ x: -hw + 1.3 + i * ((w - 2.6) / (DRY.length - 1)), y: lineY - 0.02, z: lz, w: 0.5, h: 0.95 + (i % 3) * 0.08, color: dye(k, '#c9b38f') }));
    for (const sx of [-1, 1]) R.add('furn', K.geo.slab(0.08, lineY + 0.1, 0.08, 0.01), M(sx * (hw - 0.5), (lineY + 0.1) / 2, lz), '#4a2f1c');
    if (has('rope')) K.rope(R, { points: [[-hw + 0.5, lineY + 0.02, lz], [0, lineY - 0.06, lz], [hw - 0.5, lineY + 0.02, lz]], r: 0.012, tint: '#b89a62' });
    for (const sx of [-1, 1]) R.block(sx * (hw - 0.5), lz, 0.06, 0.06, { maxY: lineY });
    const WC = windCloth(strips, { name: 'dye-line', cast: false });
    R.addMesh(WC.mesh);
    ctx.onUpdate((dt) => WC.update(dt, 0.55));
    A('line', { x: 0, y: 1.6, z: lz });
    // ---- east: the hearth with the 소목 cauldron (fire, steam); firewood
    if (has('buttumak')) {
      const bt = K.buttumak(R, { x: hw - 0.75, z: 1.6, rotY: -PI / 2, w: 2.2, d: 0.95, h: 0.72, mouths: [0], pots: [{ u: 0, s: 0.85 }], fireS: 0.7 });
      R.block(hw - 0.75, 1.6, 0.5, 1.12, { maxY: bt?.top || 0.8 });
    } else {
      K.pot(R, { kind: 'sot', x: hw - 0.9, z: 1.6, lid: true }); K.fire(R, { x: hw - 0.9, y: 0.05, z: 1.6, s: 0.6 }); R.block(hw - 0.9, 1.6, 0.45, 0.45, { maxY: 0.6 });
    }
    if (has('jangjak')) { K.jangjak(R, { x: hw - 0.7, z: 3.7, rotY: -PI / 2, w: 1.2 }); R.block(hw - 0.7, 3.7, 0.3, 0.62, { maxY: 0.8 }); }
    // ---- west: shelves of folded dyed cloth and the 잿물 jars; a 함지박 of rinse water
    const spots = K.shelf(R, { x: -hw + 0.4, z: -0.6, rotY: PI / 2, w: 2.2, d: 0.5, h: 1.8, levels: 3, back: true, tone: '#4e321e' });
    spots.forEach((sp, li) => { for (let k = 0; k < 4; k++) R.add('cloth', K.geo.slab(0.4, 0.07, 0.34, 0.01), M(sp.x, sp.y + 0.035 + (k % 2) * 0.072, sp.z - 0.75 + k * 0.5, 0.05), dye(DRY[(li * 4 + k) % DRY.length], '#c9b38f')); });
    R.block(-hw + 0.4, -0.6, 0.27, 1.12, { maxY: 1.85 });
    for (const z of [2.0, 2.8]) { K.pot(R, { kind: 'hangari', x: -hw + 0.6, z, s: 0.55, lid: true }); R.block(-hw + 0.6, z, 0.25, 0.25, { maxY: 0.6 }); }
    A('jaetmul', { x: -hw + 0.9, y: 0.9, z: 2.4 });
    if (has('hamjibak')) K.hamjibak(R, { x: -2.4, z: 2.6, r: 0.42, fill: 'water' });
    R.block(-2.4, 2.6, 0.42, 0.42, { maxY: 0.2 });
    // ---- the dipping place: the big 쪽물 jar with a frame; the white cloth that deepens dip by dip
    const vx = 0.4, vz = -1.3;
    const big = K.pot(R, { kind: 'dok', x: vx, z: vz, s: 1.05 });
    R.add('paint', geo.cyl(0.43, 0.43, 0.012, 24), M(vx, big.top - 0.1, vz), '#16335e');
    R.block(vx, vz, 0.5, 0.5, { maxY: big.top });
    const fy = 2.05;
    for (const sx of [-1, 1]) R.add('furn', K.geo.slab(0.07, fy, 0.07, 0.008), M(vx + sx * 0.75, fy / 2, vz), '#4a2f1c');
    const bar = geo.cyl(0.025, 0.025, 1.6, 8); bar.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
    R.add('furn', bar, M(vx, fy, vz), '#5e3a22');
    for (const sx of [-1, 1]) R.block(vx + sx * 0.75, vz, 0.06, 0.06, { maxY: fy });
    const cm = ctx.own(new THREE.MeshStandardMaterial({ color: dye('so', '#f1ece1'), roughness: 0.92, side: THREE.DoubleSide }));
    const cloth = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(0.62, 1.0, 1, 6).translate(0, -0.5, 0)), cm);
    cloth.position.set(vx, fy - 0.02, vz); cloth.name = 'dye-cloth';
    R.addMesh(cloth);
    L.keeperSpot = { x: vx + 1.35, z: vz - 0.4, rotY: -0.5 };
    A('do', { x: vx, y: 1.3, z: vz + 0.55 });
    // dip shades: white → sky → blue → deep indigo (쪽빛), read from the dye table
    const shades = [dye('so', '#f1ece1'), dye('cheoncheong', '#6fc3df'), dye('cheong', '#4a78c8'), dye('jjok', '#24508e')];
    L.dips = 0;
    L.step = (i) => {
      const from = new THREE.Color(shades[Math.min(i, 3)]), to = new THREE.Color(shades[Math.min(i + 1, 3)]);
      L.dips = i + 1;
      tween(L, 2.4, (t) => {
        // down into the jar (0 … 0.45), a rest, up and drip-dry (0.55 … 1); the colour turns while it is under
        const k = t < 0.45 ? ease(t / 0.45) : t < 0.55 ? 1 : 1 - ease((t - 0.55) / 0.45);
        cloth.position.y = fy - 0.02 - k * 0.95;
        if (t >= 0.45) cm.color.copy(from).lerp(to, Math.min(1, (t - 0.45) / 0.3));
      }, () => cm.color.copy(to));
      return null;
    };
    // ---- light and life: the window sun, a lamp over the jars, the hearth glow (its own fire light)
    ctx.light({ x: 0, y: 2.4, z: -hd + 1.6, color: '#ffd29a', intensity: 4.0, distance: 10, decay: 1.7, flicker: 0.03, day: 0.2 });
    K.dust(R, { count: 110 });
    L.shelf = true;
    R.shelfWall('S', 0, { levels: 2, slots: 3, w: 1.8, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));
  };
  /** a bowl (사발) with what is in it: fill = a colour (soup, 식혜) and / or rice */
  function bowlWith(R, x, y, z, o = {}) {
    const s = o.s || 1.6, p = K.pot(R, { kind: 'bowl', x, y, z, s, tint: o.tint || '#e9e4d6' });
    if (o.fill) R.add('paint', geo.cyl(0.092 * s, 0.09 * s, 0.004, 16), M(x, y + 0.058 * s, z), o.fill);
    if (o.rice) R.add('cloth', K.geo.slab(0.07 * s, 0.025 * s, 0.07 * s, 0.012 * s), M(x, y + 0.062 * s, z), '#f4f1e8');
    return p;
  }
  /** a small group of its own (own material, a coloured mesh per entry) for things that appear during an activity */
  function showGroup(R, ctx, parts, name) {
    const g = new THREE.Group(); g.name = name || 'act'; g.visible = false;
    for (const p of parts) {
      const mat = ctx.own(new THREE.MeshStandardMaterial({ color: p.color || '#ffffff', roughness: p.rough ?? 0.7, metalness: 0, transparent: !!p.opacity, opacity: p.opacity || 1 }));
      const mesh = new THREE.Mesh(ctx.own(p.geo), mat);
      mesh.position.set(p.x || 0, p.y || 0, p.z || 0); if (p.ry) mesh.rotation.y = p.ry; if (p.rx) mesh.rotation.x = p.rx;
      g.add(mesh);
    }
    R.addMesh(g);
    return g;
  }
  const popIn = (L, g, sec = 0.6) => { g.visible = true; g.scale.setScalar(0.3); tween(L, sec, (t) => g.scale.setScalar(0.3 + 0.7 * ease(t))); };

  // ============================================================================================ 주막 PL_JUMAK
  // An earth-floored inn room: the 부뚜막 along the north wall with two cauldrons (국밥 simmering — fire, steam), a 살강
  // of white bowls, the 식혜 and 수정과 jars with their 바가지, two 평상 with 소반 laid for guests, 곶감 strings that sway
  // (for the 수정과), a lantern by the door. No alcohol anywhere. Thing to do: 국밥 한 상 — soup ladled, rice in, 식혜 beside.
  FURNISH.jumak = function (R, ctx, row, L) {
    const A = L.A, w = row.size.w, d = row.size.d, hw = w / 2, hd = d / 2;
    const bz = -hd + 0.55;
    let pots = [];
    if (has('buttumak')) {
      const bt = K.buttumak(R, { x: -1.2, z: bz, w: 4.2, d: 1.0, h: 0.78, mouths: [-1.05, 1.05], pots: [{ u: -1.05, s: 1.05 }, { u: 1.05, s: 0.9 }], fireS: 0.8 });
      pots = bt?.pots || [];
      R.block(-1.2, bz, 2.15, 0.55, { maxY: bt?.top || 0.8 });
    }
    for (const mx of [-2.25, -0.15]) ctx.light({ x: mx, y: 0.35, z: bz + 0.7, color: '#ff9a4a', intensity: 3.2, distance: 5, decay: 1.9, flicker: 0.12, day: 0.4 });
    A('gukbap', { x: -2.25, y: 1.2, z: bz + 0.5 });
    if (has('salgang')) { try { K.salgang(R, 'W', 1, { levels: 2, y: 1.15 }); } catch (e) { /* the wall bay */ } }
    // the 식혜 and 수정과 jars by the east end of the 부뚜막, a 바가지 on each lid, a 소반 with the dipper
    const jx = 2.4;
    for (const [x, kind, s] of [[jx, 'hangari', 0.75], [jx + 1.1, 'hangari', 0.7]]) { K.pot(R, { kind, x, z: bz + 0.1, s, lid: true }); R.block(x, bz + 0.1, 0.32, 0.32, { maxY: 0.9 }); }
    if (has('bagaji')) { K.bagaji(R, { x: jx, y: 0.75 * 1.25 + 0.12, z: bz + 0.1, r: 0.1 }); K.bagaji(R, { x: jx + 1.1, y: 0.7 * 1.25 + 0.12, z: bz + 0.1, r: 0.1 }); }
    R.label('식혜', { side: 'N', u: hw + jx, v: 1.55, n: 0.08, w: 0.6, h: 0.24, style: 'paper' });
    R.label('수정과', { side: 'N', u: hw + jx + 1.1, v: 1.55, n: 0.08, w: 0.7, h: 0.24, style: 'paper' });
    A('sikhye', { x: jx, y: 1.1, z: bz + 0.5 });
    A('sujeonggwa', { x: jx + 1.1, y: 1.1, z: bz + 0.5 });
    // two 평상 for guests, each with a 소반 laid: 국밥, 김치, 식혜
    const tables = [[-3.0, 1.2], [1.6, 1.8]];
    for (const [px, pz] of tables) {
      const ps = has('pyeongsang') ? K.pyeongsang(R, { x: px, z: pz, w: 2.2, d: 1.5, h: 0.42 }) : K.table(R, { x: px, z: pz, w: 2.2, d: 1.5, h: 0.42 });
      const ph = (ps && ps.top) || 0.42;
      R.block(px, pz, 1.1, 0.75, { maxY: ph, stand: true });
      const sb = K.table(R, { x: px + 0.3, y: ph, z: pz, w: 0.7, d: 0.5, h: 0.28, tone: '#6b3d26', round: true });
      bowlWith(R, px + 0.18, sb.top, pz - 0.05, { fill: '#b9733a', rice: true });
      bowlWith(R, px + 0.45, sb.top, pz + 0.08, { fill: '#efe6cc', s: 1.2 });
      bowlWith(R, px + 0.36, sb.top, pz - 0.16, { fill: '#b8322e', s: 0.9 });
      K.cushion(R, { x: px - 0.55, y: ph, z: pz, w: 0.55, d: 0.55, h: 0.08, tint: '#8a5a36', trim: '#5e3a22' });
    }
    A('jumak', { x: -3.0, y: 1.0, z: 1.9 });
    // 곶감 strings under the rafters (they sway), a lantern by the door, straw shoes
    if (has('sway') && has('strings')) for (const [x, ph] of [[-4.5, 0], [4.6, 1.4]]) { const S = K.sway(R, { x, y: R.post - 0.1, z: -0.6, amp: 0.035, speed: 0.5, phase: ph }); K.strings(S, { x, y: R.post - 0.1, z: -0.6, kind: 'gotgam', w: 1.0, drop: 0.26 }); S.done(); }
    if (has('chorong')) K.chorong(R, { x: 1.4, y: R.post - 0.05, z: hd - 1.2, hang: true, drop: 0.5, tint: '#c23a4a' });
    if (has('jipsin')) { K.jipsin(R, { x: -0.9, z: hd - 0.5, rotY: 0.2 }); K.jipsin(R, { x: -0.6, z: hd - 0.55, rotY: -0.1 }); }
    if (has('jangjak')) { K.jangjak(R, { x: -hw + 0.7, z: bz + 0.4, rotY: PI / 2, w: 1.1 }); R.block(-hw + 0.7, bz + 0.4, 0.3, 0.58, { maxY: 0.8 }); }
    ctx.light({ x: 0, y: 2.3, z: 1.2, color: '#ffc58a', intensity: 4.2, distance: 9, decay: 1.7, flicker: 0.05, day: 0.2 });
    K.dust(R, { count: 80 });
    L.keeperSpot = { x: 0.4, z: bz + 1.25, rotY: 0.3 };
    // the thing to do: a 소반 on the front 평상 — the soup, the rice, the 식혜
    const tx = 1.6 + 0.3, tz = 1.8, ty = 0.42 + 0.28;
    const soup = showGroup(R, ctx, [
      { geo: new THREE.CylinderGeometry(0.15, 0.09, 0.1, 18), color: '#efe9da', y: 0.05 },
      { geo: new THREE.CylinderGeometry(0.135, 0.135, 0.006, 18), color: '#a8622e', y: 0.088 },
    ], 'jumak-soup');
    soup.position.set(tx - 0.55, ty, tz + 0.3);
    const rice = showGroup(R, ctx, [{ geo: new THREE.SphereGeometry(0.075, 12, 8, 0, TAU, 0, PI / 2), color: '#f5f2ea', y: 0.088 }], 'jumak-rice');
    rice.position.copy(soup.position);
    const drink = showGroup(R, ctx, [
      { geo: new THREE.CylinderGeometry(0.11, 0.07, 0.08, 16), color: '#efe9da', y: 0.04 },
      { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.005, 16), color: '#efe2be', y: 0.07 },
    ], 'jumak-sikhye');
    drink.position.set(tx - 0.2, ty, tz + 0.42);
    A('do', { x: tx - 0.4, y: 1.0, z: tz + 0.6 });
    L.step = (i) => { if (i === 0) { rice.visible = false; drink.visible = false; popIn(L, soup); } else if (i === 1) popIn(L, rice, 0.5); else popIn(L, drink); };
  };

  // ============================================================================================ 떡집 PL_TTEOK
  // A rice-cake kitchen: the 부뚜막 with a 시루 sealed on the cauldron (steam rising), a 떡판 with its 떡메 where the
  // visitor pounds 인절미, a 맷돌 and a 절구 for the flour, 채반 and trays of finished 떡 on shelves, a 함지박 of 콩고물.
  FURNISH.tteok = function (R, ctx, row, L) {
    const A = L.A, w = row.size.w, d = row.size.d, hw = w / 2, hd = d / 2;
    const bz = -hd + 0.55;
    if (has('buttumak')) {
      const bt = K.buttumak(R, { x: -2.2, z: bz, w: 3.0, d: 1.0, h: 0.78, mouths: [-0.7, 0.75], pots: [{ u: -0.7, s: 1.0, siru: true }, { u: 0.75, s: 0.85 }], fireS: 0.75 });
      R.block(-2.2, bz, 1.55, 0.55, { maxY: bt?.top || 0.8 });
    }
    for (const mx of [-2.9, -1.45]) ctx.light({ x: mx, y: 0.35, z: bz + 0.7, color: '#ff9a4a', intensity: 3.0, distance: 5, decay: 1.9, flicker: 0.12, day: 0.4 });
    A('siru', { x: -2.9, y: 1.4, z: bz + 0.4 });
    A('sirutteok', { x: -1.45, y: 1.2, z: bz + 0.5 });
    // shelves of finished 떡 on the east wall
    const spots = K.shelf(R, { x: hw - 0.45, z: -1.2, rotY: -PI / 2, w: 2.4, d: 0.5, h: 1.7, levels: 3, back: true, tone: '#5e3a22' });
    spots.forEach((sp, li) => { for (let k = -1; k <= 1; k++) { if (has('dish')) K.dish(R, { x: sp.x, y: sp.y, z: sp.z + k * 0.7, kind: ['tteok', 'songpyeon', 'yakgwa'][(li + k + 3) % 3] }); else K.basket(R, { x: sp.x, y: sp.y, z: sp.z + k * 0.7, kind: 'sieve', r: 0.22 }); } });
    R.block(hw - 0.45, -1.2, 0.27, 1.22, { maxY: 1.75 });
    A('nanum', { x: hw - 0.9, y: 1.2, z: -1.2 });
    // 맷돌, 절구 with its 공이, a 체 and a 키
    K.pot(R, { kind: 'millstone', x: -hw + 1.0, z: 1.2, s: 1.1 }); R.block(-hw + 1.0, 1.2, 0.32, 0.32, { maxY: 0.26 });
    K.pot(R, { kind: 'mortar', x: -hw + 1.0, z: 2.6, s: 1.0 }); R.block(-hw + 1.0, 2.6, 0.27, 0.27, { maxY: 0.58 });
    if (has('gongi')) K.gongi(R, { x: -hw + 1.25, y: 0, z: 2.5, rotY: 0.4 });
    K.basket(R, { x: -hw + 1.9, z: 3.4, kind: 'sieve', r: 0.26 });
    K.basket(R, { x: -hw + 2.6, z: 3.5, r: 0.28, h: 0.16 });
    if (has('hamjibak')) { K.hamjibak(R, { x: 1.9, z: -0.6, r: 0.34, fill: 'flour' }); R.block(1.9, -0.6, 0.34, 0.34, { maxY: 0.18 }); }
    // the 떡판 and the 떡메 (the thing to do)
    const px = 0.2, pz = 0.9;
    R.add('furn', K.geo.slab(1.5, 0.12, 0.62, 0.02), M(px, 0.3, pz), '#9a6a42');
    for (const sx of [-1, 1]) R.add('furn', K.geo.slab(0.12, 0.26, 0.5, 0.01), M(px + sx * 0.6, 0.12, pz), '#6e4a2c');
    R.block(px, pz, 0.78, 0.33, { maxY: 0.38 });
    const dough = showGroup(R, ctx, [{ geo: new THREE.SphereGeometry(0.26, 18, 10), color: '#f4f0e6', rough: 0.55 }], 'tteok-dough');
    dough.position.set(px, 0.38, pz); dough.visible = true; dough.scale.set(1, 0.5, 0.8);
    const malletG = new THREE.Group(); malletG.name = 'tteok-mallet';
    const mm = ctx.own(new THREE.MeshStandardMaterial({ color: '#8a6040', roughness: 0.8 }));
    const handle = new THREE.Mesh(ctx.own(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 8)), mm); handle.position.set(0, 0.55, 0);
    const head = new THREE.Mesh(ctx.own(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 14).rotateZ(PI / 2)), mm); head.position.set(0, 1.1, 0);
    malletG.add(handle, head);
    // the mallet turns about the end of its handle (held at the board's east end): upright = rotation 0, on the dough = π/2
    const pivot = new THREE.Group(); pivot.position.set(px + 1.1, 0.5, pz); pivot.add(malletG);
    const REST = 0.22, BACK = -0.18, HIT = PI / 2 - 0.02;
    pivot.rotation.z = REST;
    R.addMesh(pivot);
    const gomul = showGroup(R, ctx, [
      { geo: new THREE.BoxGeometry(0.1, 0.05, 0.08), color: '#d9b45a', x: -0.15 }, { geo: new THREE.BoxGeometry(0.1, 0.05, 0.08), color: '#d9b45a', x: 0 },
      { geo: new THREE.BoxGeometry(0.1, 0.05, 0.08), color: '#d9b45a', x: 0.15 }, { geo: new THREE.BoxGeometry(0.1, 0.05, 0.08), color: '#d9b45a', x: 0.07, z: 0.1 },
    ], 'tteok-injeolmi');
    gomul.position.set(px, 0.39, pz);
    A('injeolmi', { x: px, y: 0.9, z: pz + 0.45 });
    A('do', { x: px + 0.4, y: 0.9, z: pz + 0.45 });
    L.keeperSpot = { x: px - 1.2, z: pz - 0.4, rotY: 0.9 };
    L.step = (i) => {
      if (i === 0) { gomul.visible = false; dough.visible = true; dough.scale.set(1, 0.5, 0.8); }
      if (i < 3) {
        tween(L, 1.1, (t) => {
          pivot.rotation.z = t < 0.45 ? REST + (BACK - REST) * ease(t / 0.45) : BACK + (HIT - BACK) * ease((t - 0.45) / 0.55);   // back, then down onto the dough
          if (t > 0.95) dough.scale.set(1.05 + i * 0.08, 0.42 - i * 0.07, 0.85 + i * 0.05);
        }, () => tween(L, 0.7, (t) => { pivot.rotation.z = HIT + (REST - HIT) * ease(t); }));
        try { G.sfx?.('thud'); } catch (e) { /* a sound */ }
      } else { dough.visible = false; popIn(L, gomul); }
    };
    ctx.light({ x: 0, y: 2.3, z: 0.6, color: '#ffc98a', intensity: 4.0, distance: 9, decay: 1.7, day: 0.2 });
    K.dust(R, { count: 90 });
  };

  // ============================================================================================ 한지 공방 PL_HANJI
  // A paper workshop: the 지통 (paper vat) of milky 닥 water with the bamboo screen hung over it from a pole, bundles of
  // 닥나무 and soaking bark, the beating stone with its stick, drying boards on the east wall with sheets on them, a stack
  // of finished sheets, 한지 lamps glowing. Thing to do: 종이 뜨기 — dip the screen, lift a sheet, dry it on the board.
  FURNISH.hanji = function (R, ctx, row, L) {
    const A = L.A, w = row.size.w, d = row.size.d, hw = w / 2, hd = d / 2;
    const vx = -0.6, vz = -1.2, VW = 2.0, VD = 1.3, VH = 0.78;
    // the vat: four board walls on a low frame, milky water
    for (const [x, z, sw, sd] of [[0, -VD / 2, VW, 0.07], [0, VD / 2, VW, 0.07], [-VW / 2, 0, 0.07, VD], [VW / 2, 0, 0.07, VD]]) R.add('furn', K.geo.slab(sw, VH, sd, 0.01), M(vx + x, VH / 2, vz + z), '#8a6440');
    R.add('paint', K.geo.slab(VW - 0.08, 0.01, VD - 0.08, 0.002), M(vx, VH - 0.12, vz), '#dcd8c8');
    R.block(vx, vz, VW / 2 + 0.04, VD / 2 + 0.04, { maxY: VH });
    A('dakpul', { x: vx - 0.6, y: 1.1, z: vz + 0.7 });
    // the pole and the screen hanging from it (외발뜨기)
    const poleY = 2.25;
    for (const sz of [-1, 1]) R.add('furn', K.geo.slab(0.07, poleY, 0.07, 0.008), M(vx + VW / 2 + 0.35, poleY / 2, vz + sz * 0.55), '#4a2f1c');
    const pole = geo.cyl(0.03, 0.03, 1.4, 8); pole.applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2));
    R.add('furn', pole, M(vx + VW / 2 + 0.35, poleY, vz), '#5e3a22');
    for (const sz of [-1, 1]) R.block(vx + VW / 2 + 0.35, vz + sz * 0.55, 0.06, 0.06, { maxY: poleY });
    const screen = new THREE.Group(); screen.name = 'hanji-screen';
    const fm = ctx.own(new THREE.MeshStandardMaterial({ color: '#b08a52', roughness: 0.8 }));
    for (const [x, z, sw, sd] of [[0, -0.42, 1.25, 0.04], [0, 0.42, 1.25, 0.04], [-0.6, 0, 0.04, 0.84], [0.6, 0, 0.04, 0.84]]) { const b = new THREE.Mesh(ctx.own(new THREE.BoxGeometry(sw, 0.03, sd)), fm); b.position.set(x, 0, z); screen.add(b); }
    const reed = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(1.18, 0.8).rotateX(-PI / 2)), ctx.own(new THREE.MeshStandardMaterial({ color: '#c9b080', roughness: 0.9, side: THREE.DoubleSide })));
    screen.add(reed);
    const sheetM = ctx.own(new THREE.MeshStandardMaterial({ color: '#f6f1e2', roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    const sheet = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(1.1, 0.74).rotateX(-PI / 2)), sheetM); sheet.position.y = 0.012; sheet.visible = false;
    screen.add(sheet);
    const SY = VH + 0.35;
    screen.position.set(vx, SY, vz);
    R.addMesh(screen);
    A('oebal', { x: vx + 0.2, y: 1.4, z: vz + 0.6 });
    // 닥나무 bundles and soaking bark, the beating stone
    for (let k = 0; k < 3; k++) for (let j = 0; j < 9; j++) R.add('furn', geo.cyl(0.025, 0.03, 1.6, 6), M(-hw + 0.5 + (j % 3) * 0.07, 0.8, -hd + 0.6 + k * 0.42 + ((j / 3) | 0) * 0.07, 0, 1, 1, 1, 0.04 * (j - 4), 0.03 * (k - 1)), '#8a7458');
    R.block(-hw + 0.6, -hd + 1.0, 0.25, 0.6, { maxY: 1.6 });
    A('dak', { x: -hw + 0.9, y: 1.3, z: -hd + 1.1 });
    K.pot(R, { kind: 'basin', x: -hw + 1.3, z: 1.0, s: 1.3 });
    R.add('paint', geo.cyl(0.4, 0.4, 0.008, 18), M(-hw + 1.3, 0.2, 1.0), '#c9bd96');
    for (let k = 0; k < 8; k++) R.add('cloth', K.geo.slab(0.4, 0.008, 0.05, 0.002), M(-hw + 1.3 + Math.cos(k) * 0.12, 0.21, 1.0 + Math.sin(k * 1.7) * 0.12, k * 0.8), '#e6dcc0');
    R.block(-hw + 1.3, 1.0, 0.48, 0.48, { maxY: 0.3 });
    R.add('stone', K.geo.slab(0.8, 0.28, 0.5, 0.04), M(-hw + 1.2, 0.14, 2.6), '#8a8478');
    R.add('furn', geo.cyl(0.035, 0.04, 0.8, 8), M(-hw + 1.25, 0.32, 2.6, 0, 1, 1, 1, 0, PI / 2 - 0.1), '#7a5636');
    R.block(-hw + 1.2, 2.6, 0.4, 0.25, { maxY: 0.3 });
    // drying boards on the east wall with sheets; a stack of finished sheets on a low table
    for (const [z, n] of [[-2.6, 2], [-0.4, 2], [1.8, 1]]) {
      R.add('furn', K.geo.slab(0.06, 1.7, 1.5, 0.01), M(hw - 0.28, 0.95, z, 0, 1, 1, 1, 0, 0.06), '#a07c50');
      for (let k = 0; k < n; k++) R.add('paint', K.geo.slab(0.01, 0.62, 0.9, 0.001), M(hw - 0.33, 0.62 + k * 0.72, z, 0, 1, 1, 1, 0, 0.06), '#f6f0de');
      R.block(hw - 0.3, z, 0.18, 0.78, { maxY: 1.8 });
    }
    const board = { x: hw - 0.34, y: 1.34, z: 1.8 };
    const tb = K.table(R, { x: 2.2, z: 2.4, w: 1.3, d: 0.8, h: 0.42, tone: '#6b3d26' });
    for (let k = 0; k < 14; k++) R.add('paint', K.geo.slab(0.92, 0.006, 0.62, 0.001), M(2.2 + (k % 3 - 1) * 0.008, tb.top + 0.004 + k * 0.007, 2.4, (k % 4 - 1.5) * 0.01), '#f4eee0');
    R.block(2.2, 2.4, 0.66, 0.42, { maxY: 0.55 });
    A('sseuim', { x: 2.2, y: 0.9, z: 2.9 });
    if (has('paperLamp')) for (const [x, z] of [[-hw + 2.5, -hd + 0.6], [hw - 1.2, hd - 0.9]]) K.paperLamp(R, { x, z, h: 0.7 });
    if (has('sway')) { const S = K.sway(R, { x: 1.2, y: R.post - 0.15, z: 0.2, amp: 0.03, speed: 0.45, axis: 'z' }); for (let k = 0; k < 3; k++) S.add('paint', K.geo.slab(0.6, 0.85, 0.004, 0.001), M(0.4 + k * 0.7, R.post - 0.6, 0.2), '#f5efdc'); S.done(); }
    ctx.light({ x: -hw + 2.5, y: 0.9, z: -hd + 0.9, color: '#ffd9a8', intensity: 2.4, distance: 6, decay: 1.8, flicker: 0.05, day: 0.2 });
    ctx.light({ x: 0, y: 2.3, z: 0.4, color: '#fff0d8', intensity: 3.6, distance: 9, decay: 1.7, day: 0.15 });
    K.dust(R, { count: 100 });
    L.keeperSpot = { x: vx - 1.4, z: vz + 0.1, rotY: PI / 2 };
    A('do', { x: vx + 0.6, y: 1.2, z: vz + 0.9 });
    // the drying sheet the visitor made (appears on the free board)
    const mine = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(0.9, 0.62)), sheetM); mine.position.set(board.x - 0.012, board.y, board.z); mine.rotation.y = -PI / 2; mine.visible = false;
    R.addMesh(mine);
    L.step = (i) => {
      if (i === 0) {
        mine.visible = false; sheet.visible = false;
        tween(L, 2.2, (t) => {
          const k = t < 0.35 ? ease(t / 0.35) : t < 0.75 ? 1 : 1 - ease((t - 0.75) / 0.25);
          screen.position.y = SY - k * 0.42;
          screen.rotation.x = t > 0.35 && t < 0.75 ? Math.sin((t - 0.35) / 0.4 * PI * 3) * 0.05 : 0;   // rocked gently, 0.4 Hz
        });
      } else if (i === 1) { sheet.visible = true; tween(L, 0.8, (t) => { screen.position.y = SY + 0.2 * ease(t); }); }
      else { sheet.visible = false; mine.visible = true; mine.scale.setScalar(0.4); tween(L, 0.8, (t) => { mine.scale.setScalar(0.4 + 0.6 * ease(t)); screen.position.y = SY + 0.2 * (1 - ease(t)); }); }
    };
  };

  // outside: a drying rack in the side yard (west of the house, towards the 주막), strips in the named dyes, in the wind
  const yardCloth = [];
  EXT.dye = function (site, b) {
    const B = site.B, hw = b.w / 2, x0 = -hw - 0.9 - 1.9;   // the middle of the 3.8 m side yard
    const H = 2.35, z0 = -b.d / 2 + 0.6, z1 = b.d / 2 - 0.4;
    for (const z of [z0, z1]) {
      B.add('wood', geo.cyl(0.05, 0.06, H, 8), M(x0, H / 2, z), '#5a3c26');
      site.circle(x0, z, 0.12);
    }
    B.add('wood', geo.tube(x0, H - 0.05, z0, x0, H - 0.05, z1, 0.022, 6), BK.I4, '#7a5a3e');
    const ks = ['jjok', 'dahong', 'chija', 'ok', 'jaju', 'gal', 'cheong', 'yeonji'];
    const n = ks.length, strips = [];
    for (let i = 0; i < n; i++) {
      const lz = z0 + 0.35 + i * ((z1 - z0 - 0.7) / (n - 1));
      strips.push({ x: site.wx(x0, lz), y: site.gy + H - 0.08, z: site.wz(x0, lz), w: 0.55, h: 1.25 - (i % 2) * 0.12, color: dye(ks[i], '#c9b38f'), rotY: (b.rot || 0) + PI / 2 });
    }
    const WC = windCloth(strips, { name: 'dye-yard', cast: true });
    yardCloth.push({ WC, x: site.x, z: site.z });
    try { G.sys.engine?.scene?.add(WC.mesh); } catch (e) { /* the engine */ }
    site.blocker(x0, 0, (z0 + z1) / 2, 0.2, H, z1 - z0);
  };
  // the outdoor cloth moves only while somebody is near enough to see it (and never inside a place)
  G.register({
    name: 'crafts', order: 72, label: '공방 마을',
    init() {
      G.bus.on('place:enter', () => { for (const y of yardCloth) y.WC.mesh.visible = false; });
      G.bus.on('place:exit', () => { for (const y of yardCloth) y.WC.mesh.visible = true; });
    },
    update(dt) {
      if (!yardCloth.length || G.sys.places?.current) return;
      const p = G.sys.player?.position;
      if (!p) return;
      const W = G.sys.nature?.uniforms?.uWindStrength?.value;
      for (const y of yardCloth) { if ((p.x - y.x) ** 2 + (p.z - y.z) ** 2 < 90 * 90) y.WC.update(dt, W == null ? 0.8 : clamp(0.35 + W * 0.5, 0.2, 1.2)); }
    },
  });

  // ============================================================================================ the PLACES
  for (const row of ROWS) {
    const b = (G.data.layout?.buildings || []).find((x) => x.id === row.building);
    if (!b) { G.log.warn('WORLD', `craft ${row.id}: no plot ${row.building}`); continue; }
    const door = P.doorOf(row.building, THATCHED.has(row.id) ? { side: -b.w / 6 } : {});
    const d = row.size.d;
    P.define({
      id: row.place, name: row.name, kidName: row.kidName || row.name, emoji: row.emoji, zoneId: row.zone, color: row.color,
      desc: row.desc,
      origin: { x: row.origin.x, z: row.origin.z }, size: { w: row.size.w, d, h: row.size.h }, floorY: 0,
      surface: row.floor === 'earth' ? 'dirt' : row.floor === 'stone' ? 'stone' : 'wood',
      spawn: { x: 0, z: d / 2 - 1.5, rotY: PI },
      door: door ? { buildingId: row.building, x: door.x, z: door.z, label: `🚪 ${row.name} 들어가기`, kidLabel: `${row.name} 가기` } : undefined,
      exit: door ? door.exit : undefined,
      indoor: true, camera: { dist: 4.8, min: 2.2, max: 6.6, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: Math.min(row.post || 2.7, row.size.h) - 0.2 }, far: 150,
      build: buildHouse(row),
    });
  }

  G.crafts = {
    houses: ROWS, ACT, EXTRA, EXT, FURNISH,
    live: (placeId) => live[placeId] || null,
    menu, act, learn, stamp: (placeId) => { const r = byPlace[placeId]; if (r) stamp(r, { auto: true }); },
  };
})();
