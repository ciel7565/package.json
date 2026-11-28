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
