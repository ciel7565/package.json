// =============================================================================
// 24-wardrobe.js — clothes as things the player owns (CONTRACT §19.1, lane wardrobe)
//
// DATA + RULES (pure: evaluable in Node without DOM / THREE — tools/build.mjs [wardrobe] exports them):
//   G.data.wardrobe = {
//     v, slots [{ key, name, colorKey, empty }]   the keys that are things to wear (G.data.avatar.slots of lane hanbok,
//                                                 or today's wearable keys) — read at start, never a hand-written id list
//     items [WEAR_<KEY>_<ID>]   one item of type `wear` per value of a slot key (also merged into G.data.items)
//     byKey { key: [itemId] }   starter [itemId]   price { base, mul, over }   rarity { itemId: tier }
//     shops ['SHOP_HANBOK']     gifts { QUEST / ACH id: itemId }   traits [words]   homes [{ id, name }]
//     limits { sets 12, traits 3, setName 12 }   expressions [{ id, name, emoji }]
//     itemId(key, id) / parse(itemId) → { key, id } | null / priceOf(itemId) / sellOf(itemId) / isStarter(itemId)
//     blank() → an empty state   sanitize(w) → a clean state (unknown ids dropped, sizes bounded)
//     owns(w, itemId, admin) / wornItems(app) → [itemId] / fit(app, w, admin) → { app, changed } (pieces not owned are
//     put back to an owned piece of the slot) / migrate(w, app) → w (the pieces an existing look wears become owned)
//     canBuy(w, itemId, coins, admin) / canSell(w, app, itemId) → { ok, why }   applyGifts(data)   serverTable()
//   }
// SYSTEM (G.sys.wardrobe, the page only) — see the second half of this file.
// =============================================================================
(function () {
  const D = G.data;
  const AV = D.avatar || {};
  const OPT = AV.options || {};
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  // ------------------------------------------------------------------ slots (lane hanbok's list, or today's wearables)
  const FALLBACK_SLOTS = [
    { key: 'outer', name: '겉옷', colorKey: 'outerColor', empty: 'none' },
    { key: 'top', name: '저고리', colorKey: 'topColor', empty: null },
    { key: 'bottom', name: '아래옷', colorKey: 'bottomColor', empty: null },
    { key: 'hat', name: '쓰개', colorKey: 'hatColor', empty: 'none' },
    { key: 'footwear', name: '신', colorKey: 'shoes', empty: null },
    { key: 'bag', name: '짐', colorKey: 'bagColor', empty: 'none' },
    { key: 'accessory', name: '꾸미개', colorKey: 'accessoryColor', empty: 'none' },
  ];
  const slotSrc = Array.isArray(AV.slots) && AV.slots.length ? AV.slots : FALLBACK_SLOTS;
  const slots = [];
  for (const s of slotSrc) {
    if (!s || typeof s.key !== 'string' || !Array.isArray(OPT[s.key])) continue; // only keys the table really has
    if (slots.some((x) => x.key === s.key)) continue;
    const empty = typeof s.empty === 'string' && OPT[s.key].includes(s.empty) ? s.empty : (OPT[s.key].includes('none') ? 'none' : null);
    slots.push({ key: s.key, name: String(s.name || s.key), colorKey: typeof s.colorKey === 'string' && Array.isArray(OPT[s.colorKey]) ? s.colorKey : null, empty });
  }
  const SLOT = Object.fromEntries(slots.map((s) => [s.key, s]));

  // ------------------------------------------------------------------ ids
  const up = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  const itemId = (key, id) => `WEAR_${up(key)}_${up(id)}`;
  const items = [];
  const byKey = {};
  const back = {}; // itemId → { key, id }
  for (const s of slots) {
    byKey[s.key] = [];
    for (const id of OPT[s.key]) {
      if (typeof id !== 'string' || id === s.empty) continue;
      const iid = itemId(s.key, id);
      if (own(back, iid)) continue;
      back[iid] = { key: s.key, id };
      items.push(iid);
      byKey[s.key].push(iid);
    }
  }
  const parse = (iid) => (typeof iid === 'string' && own(back, iid) ? { key: back[iid].key, id: back[iid].id } : null);

  // ------------------------------------------------------------------ the starter kit: a plain everyday kit (never sold)
  // the defaults of a new profile + plain basics where the table has them (ids that are not in the table are skipped)
  const STARTER_IDS = { top: ['hanbok', 'min', 'minjeogori'], bottom: ['pants', 'skirt', 'baji', 'chima', 'pulchima', 'sapokbaji'], footwear: ['gomusin'], hair: ['short', 'long', 'bun', 'daenggi', 'side'] };
  const starter = [];
  const addStarter = (key, id) => { const iid = itemId(key, id); if (own(back, iid) && !starter.includes(iid)) starter.push(iid); };
  for (const s of slots) {
    const d = AV.defaults && AV.defaults[s.key];
    if (typeof d === 'string' && d !== s.empty) addStarter(s.key, d);
    for (const id of STARTER_IDS[s.key] || []) addStarter(s.key, id);
    // a slot that cannot be empty always has at least one free piece
    if (!s.empty && !byKey[s.key].some((x) => starter.includes(x)) && byKey[s.key].length) starter.push(byKey[s.key][0]);
  }
  const STARTER = new Set(starter);

  // ------------------------------------------------------------------ prices: by rule (slot base × rarity), overrides win
  const base = { outer: 1400, top: 700, bottom: 600, hat: 500, footwear: 400, bag: 300, accessory: 300, hair: 250, belt: 300, binyeo: 300, norigae: 350, jumeoni: 250, fan: 300, daenggi: 200, pack: 300 };
  const mul = { common: 1, fine: 2, rare: 4, treasure: 9 };
  // the rarity of a piece by its id (ids of the table that are not named here are `common`)
  const TIER = {
    treasure: ['hwarot', 'wonsam', 'jeogui', 'hwagwan', 'jokduri_gold', 'gujeongbok', 'myeonryugwan'],
    rare: ['dopo', 'cheollik', 'gugunbok', 'jeonbok', 'dangui', 'jangot', 'sseugaechima', 'kkachi', 'kkachidurumagi', 'jokduri', 'jeongjagwan', 'jeollip', 'sangmo', 'taesahye', 'danghye', 'unhye', 'mokhwa', 'tteoljam', 'dwikkoji', 'samhoejang', 'seuran', 'seuranchima', 'daeran', 'daeranchima', 'gwangdahoe', 'gold', 'geumbak'],
    fine: ['durumagi', 'kwaeja', 'dapho', 'baeja', 'magoja', 'nubi', 'nubiot', 'saekdong', 'banhoejang', 'kkaekki', 'kkotsin', 'gatsin', 'gat', 'chorip', 'hogeon', 'bokgeon', 'gulle', 'jobawi', 'ayam', 'nambawi', 'pungcha', 'jeonmo', 'norigae', 'fan', 'buchae', 'binyeo', 'dangi', 'seojodae', 'gwijumeoni', 'durujumeoni', 'tongchima', 'pungchabaji'],
  };
  const tierOfId = {};
  for (const t of ['common', 'fine', 'rare', 'treasure']) for (const id of TIER[t] || []) tierOfId[id] = t;
  const over = {}; // itemId → price (a piece whose rule price feels wrong; none yet)
  const rarity = {};
  const priceMap = {};
  for (const iid of items) {
    const { key, id } = back[iid];
    const t = tierOfId[id] || 'common';
    rarity[iid] = t;
    priceMap[iid] = STARTER.has(iid) ? 0 : (own(over, iid) ? over[iid] : Math.round(((base[key] || 400) * mul[t]) / 10) * 10);
  }
  const priceOf = (iid) => (own(priceMap, iid) ? priceMap[iid] : 0);
  const sellOf = (iid) => (STARTER.has(iid) ? 0 : Math.floor(priceOf(iid) / 2));
  const isStarter = (iid) => STARTER.has(iid);

  // ------------------------------------------------------------------ names (the avatar's Hangul labels where known)
  const SLOT_ICON = { outer: '🧥', top: '👘', bottom: '👗', hat: '🎩', footwear: '🥿', bag: '🧺', accessory: '🧧', hair: '💇' };
  function labelOf(key, id) {
    const L = (AV.names && AV.names[key]) || (AV.labels && AV.labels[key]) || (G.avatar && G.avatar.labels && G.avatar.labels[key]) || null;
    return (L && typeof L[id] === 'string' && L[id]) || id;
  }
  const aboutOf = (key, id) => (AV.about && AV.about[key] && typeof AV.about[key][id] === 'string' ? AV.about[key][id] : '');
  // items of type `wear` (never stacked, never in the bag: they live in G.state.wardrobe.own)
  D.items = D.items || {};
  for (const iid of items) {
    const { key, id } = back[iid];
    if (own(D.items, iid)) continue;
    D.items[iid] = {
      name: labelOf(key, id), type: 'wear', icon: SLOT_ICON[key] || '👘', price: priceMap[iid], sell: sellOf(iid), stack: false, max: 1,
      slot: key, wear: id, rarity: rarity[iid], starter: STARTER.has(iid) || undefined,
      desc: aboutOf(key, id) || `${(SLOT[key] && SLOT[key].name) || key} · ${labelOf(key, id)}`,
    };
  }

  // ------------------------------------------------------------------ the 한복집 (a shop whose shelves are the slots)
  D.shops = D.shops || {};
  if (!own(D.shops, 'SHOP_HANBOK')) {
    D.shops.SHOP_HANBOK = {
      name: '한복집', npc: 'NPC005', kind: 'wear',
      sells: items.filter((x) => !STARTER.has(x)),
      buysTypes: ['wear'],
      shelves: slots.map((s) => s.key),
    };
  }

  // ------------------------------------------------------------------ gifts: a piece as a reward (ids that exist only)
  // source id (quest / achievement) → wanted pieces in order, 'key:id' or a bare 'id' (then the first slot that has it);
  // the first one the table has is given — the table may move a piece to another slot and the gift follows it
  const GIFT_WANT = {
    QUEST001: ['pouch:bokjumeoni', 'accessory:bokjumeoni', 'bokjumeoni', 'ribbon:jebi', 'norigae'],
    Q_TOUR: ['hat:bokgeon', 'hat:jobawi', 'hat:strawhat'],
    Q_FARMER: ['hat:strawhat', 'hat:paeraengi', 'hat:satgat'],
    Q_MEJU: ['bag:basket', 'bag:bojagi', 'bag:botjim'],
    Q_DOENJANG: ['outer:baeja', 'outer:jokki', 'outer:magoja'],
    Q_CULTURE: ['footwear:jipsin', 'footwear:mituri', 'footwear:namaksin'],
    Q_HOUSE_ROOMS: ['top:saekdong', 'top:banhoejang', 'top:jeoksam'],
    Q_PHOTO: ['ribbon:jebi', 'ribbon:baessi', 'fan:danseon'],
    ACH_FIRST_FERMENT: ['norigae:danjak', 'norigae', 'accessory:norigae', 'pouch:durujumeoni'],
    ACH_LEVEL5: ['outer:durumagi', 'outer:kwaeja', 'outer:baeja'],
    ACH_FISH_FIRST: ['hat:satgat', 'hat:strawhat', 'hat:paeraengi'],
    ACH_FISH_SPECIES10: ['outer:jeonbok', 'outer:kwaeja', 'outer:baeja'],
    ACH_COOK_1: ['fan:hapjuk', 'accessory:fan', 'fan', 'belt:saekdi'],
    ACH_COOK_STARS: ['outer:dangui', 'outer:magoja', 'outer:durumagi'],
    ACH_HOUSE_ALL: ['footwear:kkotsin', 'footwear:taesahye', 'footwear:unhye'],
    ACH_EXHIBIT40: ['hairpin:binyeo', 'pattern:geumbak', 'belt:gwangdahoe'],
  };
  const findPiece = (want) => {
    const at = want.indexOf(':');
    if (at > 0) { const iid = itemId(want.slice(0, at), want.slice(at + 1)); return own(back, iid) ? iid : null; }
    for (const s of slots) { const iid = itemId(s.key, want); if (own(back, iid)) return iid; }
    return null;
  };
  const gifts = {};
  for (const [src, wants] of Object.entries(GIFT_WANT)) {
    for (const want of wants) { const iid = findPiece(want); if (iid && !STARTER.has(iid)) { gifts[src] = iid; break; } }
  }
  /** put the gift pieces into the rewards of quests / achievements (idempotent; later fragments' ids too) */
  function applyGifts(data) {
    const d = data || D;
    for (const [src, iid] of Object.entries(gifts)) {
      const q = (d.quests && own(d.quests, src) && d.quests[src]) || (d.achievements && own(d.achievements, src) && d.achievements[src]);
      if (!q) continue;
      q.reward = q.reward || {};
      q.reward.items = q.reward.items || {};
      if (!own(q.reward.items, iid)) q.reward.items[iid] = 1;
    }
  }
  applyGifts(D);

  // ------------------------------------------------------------------ 기본 정보: words of character, where one belongs
  const traits = ['차분해요', '씩씩해요', '다정해요', '부지런해요', '호기심 많아요', '용감해요', '꼼꼼해요', '느긋해요', '밝아요', '수줍어요',
    '재미있어요', '친절해요', '참을성 있어요', '솜씨 좋아요', '노래를 좋아해요', '책을 좋아해요', '흙을 좋아해요', '장 담그기를 좋아해요',
    '물고기를 좋아해요', '요리를 좋아해요', '그림을 좋아해요', '춤을 좋아해요', '잘 웃어요', '잘 도와줘요', '꿈이 커요', '바람을 좋아해요'];
  const homes = [
    { id: 'jangdok', name: '장독대 마을' }, { id: 'sangol', name: '산골 밭' }, { id: 'seodang', name: '서당' }, { id: 'hanok', name: '한옥 마을' },
    { id: 'river', name: '맑은 냇가' }, { id: 'market', name: '장터' }, { id: 'healing', name: '힐링관' }, { id: 'manjang', name: '만장대' },
  ];
  // the nine calm faces (lane hanbok's G.data.avatar.expressions when it is there)
  const EXPR_FALLBACK = [
    { id: 'neutral', name: '무표정', emoji: '😐' }, { id: 'smile', name: '미소', emoji: '🙂' }, { id: 'grin', name: '활짝 웃음', emoji: '😄' },
    { id: 'surprise', name: '놀람', emoji: '😮' }, { id: 'curious', name: '궁금', emoji: '🤔' }, { id: 'proud', name: '뿌듯', emoji: '😌' },
    { id: 'shy', name: '수줍음', emoji: '☺️' }, { id: 'sleepy', name: '졸림', emoji: '😪' }, { id: 'focus', name: '집중', emoji: '🧐' },
  ];
  const EXPR_EMOJI = { neutral: '😐', smile: '🙂', laugh: '😄', grin: '😄', surprise: '😮', curious: '🤔', proud: '😌', shy: '☺️', sleepy: '😪', focus: '🧐' };
  const expressions = (Array.isArray(AV.expressions) && AV.expressions.length ? AV.expressions : EXPR_FALLBACK)
    .map((e) => (typeof e === 'string' ? { id: e, name: e, emoji: '🙂' } : e))
    .filter((e) => e && typeof e.id === 'string')
    .map((e) => ({ id: e.id, name: String(e.name || e.id), say: String(e.say || e.name || e.id), emoji: String(e.emoji || EXPR_EMOJI[e.id] || '🙂') }));
  const EXPR_IDS = new Set(expressions.map((e) => e.id));
  const limits = { sets: 12, traits: 3, setName: 12, own: 2000 };

  // ------------------------------------------------------------------ state rules
  const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const blank = () => ({ v: 1, own: {}, sets: [], sheet: { traits: [], home: null }, expr: null });
  /** the look keys a saved outfit may carry: the slot keys and their colour keys (and the pattern) */
  const SET_KEYS = new Set([].concat(...slots.map((s) => [s.key, s.colorKey].filter(Boolean)), Array.isArray(OPT.pattern) ? ['pattern'] : [],
    (AV.colorKeys || []).filter((k) => k !== 'skin' && k !== 'hairColor' && Array.isArray(OPT[k]))));
  const HEX = /^#[0-9a-f]{6}$/i;
  function cleanLook(src) {
    const out = {};
    if (!isMap(src)) return out;
    for (const k of SET_KEYS) {
      if (!own(src, k)) continue;
      const v = src[k];
      if (Array.isArray(OPT[k]) && OPT[k].includes(v)) out[k] = v;
      else if (typeof v === 'string' && HEX.test(v) && (AV.colorKeys || []).includes(k)) out[k] = v.toLowerCase();
    }
    return out;
  }
  function cleanName(s, max) {
    // letters, digits, spaces, · and - only (the server's rule too), trimmed and bounded; shown with textContent
    return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ·-]/gu, '').trim().slice(0, max);
  }
  function sanitize(w) {
    const out = blank();
    if (!isMap(w)) return out;
    if (isMap(w.own)) {
      let n = 0;
      for (const k of Object.keys(w.own)) {
        if (n >= limits.own) break;
        if (own(back, k) && w.own[k]) { out.own[k] = 1; n++; }
      }
    }
    if (Array.isArray(w.sets)) {
      for (const s of w.sets.slice(0, limits.sets)) {
        if (!isMap(s)) continue;
        const look = cleanLook(s.app);
        if (!Object.keys(look).length) continue;
        const id = typeof s.id === 'string' && /^[a-z0-9_]{1,24}$/i.test(s.id) ? s.id : `set${out.sets.length + 1}`;
        if (out.sets.some((x) => x.id === id)) continue;
        out.sets.push({ id, name: cleanName(s.name, limits.setName) || `갖춤 ${out.sets.length + 1}`, app: look });
      }
    }
    if (isMap(w.sheet)) {
      const t = Array.isArray(w.sheet.traits) ? w.sheet.traits.filter((x) => traits.includes(x)) : [];
      out.sheet.traits = t.filter((x, i) => t.indexOf(x) === i).slice(0, limits.traits);
      out.sheet.home = homes.some((h) => h.id === w.sheet.home) ? w.sheet.home : null;
    }
    out.expr = typeof w.expr === 'string' && EXPR_IDS.has(w.expr) ? w.expr : null;
    if (w.v === 1 && w.migrated === true) out.migrated = true;
    return out;
  }
  const owns = (w, iid, admin) => !!admin || STARTER.has(iid) || !!(w && isMap(w.own) && w.own[iid]);
  /** the items a look wears (empty slots wear nothing) */
  function wornItems(app) {
    const out = [];
    if (!isMap(app)) return out;
    for (const s of slots) {
      const v = app[s.key];
      if (typeof v !== 'string' || v === s.empty) continue;
      const iid = itemId(s.key, v);
      if (own(back, iid)) out.push(iid);
    }
    return out;
  }
  /** a look that wears owned pieces only: a piece not owned goes back to the slot's empty value or an owned / starter piece */
  function fit(app, w, admin) {
    const out = Object.assign({}, isMap(app) ? app : {});
    let changed = false;
    if (admin) return { app: out, changed };
    for (const s of slots) {
      const v = out[s.key];
      if (typeof v !== 'string' || v === s.empty) continue;
      const iid = itemId(s.key, v);
      if (!own(back, iid) || owns(w, iid, false)) continue; // an id the table does not know is the avatar's normalize to judge
      changed = true;
      if (s.empty) { out[s.key] = s.empty; continue; }
      const d = AV.defaults && AV.defaults[s.key];
      const alt = (typeof d === 'string' && owns(w, itemId(s.key, d), false) && d) || ((byKey[s.key] || []).map((x) => back[x].id).find((id) => owns(w, itemId(s.key, id), false)));
      out[s.key] = alt || (byKey[s.key][0] ? back[byKey[s.key][0]].id : v);
    }
    return { app: out, changed };
  }
  /** an existing profile (no wardrobe yet) keeps every piece it wears: they become owned, once */
  function migrate(w, app) {
    const out = sanitize(w);
    if (out.migrated) return out;
    for (const iid of wornItems(app)) if (!STARTER.has(iid)) out.own[iid] = 1;
    out.migrated = true;
    return out;
  }
  function canBuy(w, iid, coins, admin) {
    if (!own(back, iid)) return { ok: false, why: 'unknown' };
    if (owns(w, iid, admin)) return { ok: false, why: 'owned' };
    const p = priceOf(iid);
    if (!(Number(coins) >= p)) return { ok: false, why: 'coins', need: p - (Number(coins) || 0) };
    return { ok: true, price: p };
  }
  function canSell(w, app, iid) {
    if (!own(back, iid)) return { ok: false, why: 'unknown' };
    if (STARTER.has(iid)) return { ok: false, why: 'starter' };
    if (!(w && isMap(w.own) && w.own[iid])) return { ok: false, why: 'notOwned' };
    if (wornItems(app).includes(iid)) return { ok: false, why: 'worn' };
    return { ok: true, price: sellOf(iid) };
  }
  /** what Tfm\SaveValidator needs (game-data.json `wardrobe`): ids by slot, the starter kit, sell values, the limits */
  function serverTable() {
    return {
      v: 1,
      slots: slots.map((s) => ({ key: s.key, empty: s.empty })),
      items: Object.fromEntries(items.map((iid) => [iid, [back[iid].key, back[iid].id, sellOf(iid)]])),
      starter: starter.slice(),
      traits: traits.slice(), homes: homes.map((h) => h.id), expressions: expressions.map((e) => e.id),
      setKeys: Array.from(SET_KEYS), limits: Object.assign({}, limits),
    };
  }

  D.wardrobe = {
    v: 1, slots, items, byKey, starter, price: { base, mul, over }, rarity, shops: ['SHOP_HANBOK'], gifts, traits, homes, expressions, limits,
    itemId, parse, priceOf, sellOf, isStarter, labelOf, blank, sanitize, cleanLook, cleanName, owns, wornItems, fit, migrate, canBuy, canSell,
    applyGifts, serverTable,
  };

  // the page part needs the engine; in Node (the build's data export, tests) the data above is all there is
  if (typeof G.register !== 'function' || typeof document === 'undefined') return;
  // ====================================================================================== SYSTEM (G.sys.wardrobe)
  //   open(tab?) 'equip' | 'color' | 'face' | 'info' | 'sets' | 'sheet' → the 옷장 window   close()
  //   openShop(shopId = 'SHOP_HANBOK', {slot}) → the 한복집 window (shelves by slot, 입어 보기, 사기 · 팔기)
  //   decorateShop(modal, shopId, kid)  the 한복 corner button of the 매점 (30-inventory.js calls it)
  //   owns(itemId) · look() · grant(itemId, {source, silent}) → bool (30-inventory.js add() sends clothes here)
  //   buy(itemId) / sell(itemId) → { ok, why?, price? } · wear(key, id) → bool · takeOff(key) · setColor(key, hex)
  //   setExpr(id) · saveSet(name?) / wearSet(id) / renameSet(id, name) / removeSet(id) · setTraits([w]) · setHome(id)
  //   makeSheet() → Promise<{ canvas, photo } | null>   (the 설정 시트 picture, kept in the album)
  //   events: wardrobe:changed { kind: grant | buy | sell | wear | set | sheet, itemId? }
  const U = G.util;
  const W = D.wardrobe;
  const h = (...a) => G.ui.h(...a);
  const fmt = (n) => U.fmt(n);
  const easyOn = () => !!G.easy?.on;
  const say = (t, o) => { try { G.easy?.say?.(t, o); } catch (e) { /* voice is optional */ } };
  const toast = (msg, o) => { try { G.ui.toast(msg, o); } catch (e) { /* ui */ } };
  const isAdmin = () => { try { return !!G.sys.entitle?.isAdmin?.(); } catch (e) { return false; } };
  const coins = () => Number(G.state?.stats?.coin) || 0;
  const josa = (w, pair) => (G.kidKit?.josa ? G.kidKit.josa(w, pair) : String(w));
  const reduceMotion = () => !!G.settings?.reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const IDLE = { speed: 0, grounded: true, vy: 0 };
  const FRAME = { hat: 'head', hair: 'hair', outer: 'body', top: 'body', bottom: 'full', footwear: 'feet', bag: 'back', pattern: 'body', norigae: 'body', pouch: 'body', fan: 'body', hairpin: 'back', ribbon: 'back', belt: 'body', accessory: 'body' };
  const RARITY = { common: ['', '보통'], fine: ['✨', '고운 옷'], rare: ['🌟', '귀한 옷'], treasure: ['👑', '아주 귀한 옷'] };
  const TABS = [
    { id: 'equip', emoji: '👘', label: '장비', say: '입을 옷을 칸마다 골라요.' },
    { id: 'color', emoji: '🎨', label: '색', say: '옷의 물감 색을 골라요.' },
    { id: 'face', emoji: '😊', label: '표정', say: '아홉 가지 얼굴 가운데 평소 얼굴을 골라요.' },
    { id: 'info', emoji: '📇', label: '기본 정보', say: '이름표와 키, 사는 곳, 성격을 골라요.' },
    { id: 'sets', emoji: '🧺', label: '갖춤', say: '옷 한 벌을 모아 두고 한 번에 입어요.' },
    { id: 'sheet', emoji: '🖼️', label: '설정 시트', say: '내 캐릭터를 한 장의 그림으로 만들어요.' },
  ];
  const HEIGHTS = [0.9, 0.95, 1, 1.05, 1.1];
  const playHeight = (k) => Math.round(145 * (Number(k) || 1)); // a play number for the figure, never a real height
  const colorName = (hex) => {
    const x = String(hex || '').toLowerCase();
    const d = Array.isArray(AV.dyes) ? AV.dyes.find((c) => String(c.hex || c[2] || '').toLowerCase() === x) : null;
    return (d && (d.name || d[1])) || G.avatar?.labels?.colors?.[x] || x;
  };
  const slotOf = (key) => W.slots.find((s) => s.key === key) || null;
  const nameOf = (key, id) => (id == null || (slotOf(key) && id === slotOf(key).empty) ? '안 입어요' : W.labelOf(key, id));

  // ------------------------------------------------------------------ thumbnails (one per frame, shared preview renderer)
  const thumbCache = new Map(); // key → ImageData (bounded)
  function thumbKey(app, frame) { return frame + '|' + JSON.stringify(app); }
  function queueThumb(ctx, canvas, app, frame) {
    // [people] §19.9 a 겉옷 tile shows the whole figure (the length tells the robes apart) in a readable tone of its dye:
    // a dark dye (the default navy) read as a near-black torso on every tile of the shelf
    if (canvas && canvas.dataset && canvas.dataset.outerTile === '1') {
      frame = 'full';
      try {
        const c = new THREE.Color(app.outerColor), hsl = {}; c.getHSL(hsl);
        if (hsl.l < 0.3) {
          let best = null, bd = 9;
          for (const hx of G.data.avatar?.options?.outerColor || []) { const d = new THREE.Color(hx), q = {}; d.getHSL(q); if (q.l < 0.38 || q.l > 0.72) continue; const dh = Math.min(Math.abs(q.h - hsl.h), 1 - Math.abs(q.h - hsl.h)) + Math.abs(q.s - hsl.s) * 0.3; if (dh < bd) { bd = dh; best = hx; } }
          if (best) app = Object.assign({}, app, { outerColor: best });
        }
      } catch (e) { /* keep the dye */ }
    }
    const key = thumbKey(app, frame);
    const hit = thumbCache.get(key);
    if (hit) { try { canvas.getContext('2d')?.putImageData(hit, 0, 0); canvas.classList.add('ready'); } catch (e) { /* ignore */ } return; }
    ctx.q.push({ canvas, app, frame, key });
  }
  function pumpThumbs(ctx) {
    const pv = ctx.pv;
    if (!pv || pv.disposed || !ctx.q.length) return;
    for (let n = 0; n < 2 && ctx.q.length; n++) {
      const t = ctx.q.shift();
      if (!t.canvas.isConnected) continue;
      const img = pv.thumb(t.app, t.frame);
      if (!img) return;
      thumbCache.set(t.key, img);
      while (thumbCache.size > 240) thumbCache.delete(thumbCache.keys().next().value);
      try { t.canvas.getContext('2d')?.putImageData(img, 0, 0); t.canvas.classList.add('ready'); } catch (e) { /* ignore */ }
    }
  }
  const thumbCanvas = (cls) => h('canvas', { class: `wd-thumb ${cls || ''}`, width: '112', height: '112', 'aria-hidden': 'true' });

  // ------------------------------------------------------------------ the figure on the left (a turntable)
  function makeStage(host, app, ctx) {
    const P = G.app?.avatarPreview;
    if (!P || G.unsupported) {
      host.appendChild(h('div', { class: 'wd-nofig' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧍'), h('p', null, '이 기기에서는 3D 모습을 보여 줄 수 없어요. 고른 옷은 그대로 입혀져요.')));
      return null;
    }
    let pv = null;
    try { pv = new P(host, app); } catch (e) { G.log.warn('WARDROBE', 'preview failed', e?.message || e); return null; }
    if (pv.failed) return null;
    pv.onFrame = () => pumpThumbs(ctx);
    return pv;
  }
  function setView(pv, v) {
    if (!pv || pv.disposed) return;
    const yaw = { front: 0, left: -Math.PI / 2, back: Math.PI, right: Math.PI / 2 }[v];
    if (v === 'face') { pv.setView('face'); pv.yaw = 0; } else { pv.setView('full'); if (yaw != null) pv.yaw = yaw; }
    pv._idle = -1e9; // hold the chosen side (a drag lets it sway again)
  }

  const sys = {
    name: 'wardrobe', order: 52, label: '옷장',
    _m: null, _shop: null, _tab: 'equip', _slot: null, _seen: 0,

    init() {
      W.applyGifts(D); // achievements / quests of the fragments after this one
      G.bus.on('player:appearance', (e) => this._guard(e && e.appearance));
      G.bus.on('entitle:changed', () => this._refit());
      G.bus.on('easy:changed', () => { this._m?.close(); this._shop?.close(); });
      G.ui.onAction?.('wardrobe', () => this.open());
    },

    onStateLoaded(state) {
      if (!state) return;
      let w = W.sanitize(state.wardrobe);
      const app = G.avatar.normalize(state.profile?.avatar || G.avatar.defaultAppearance);
      if (!w.migrated) { w = W.migrate(w, app); state.wardrobe = w; G.dirty('wardrobe'); G.log.info('WARDROBE', `migrated: ${Object.keys(w.own).length} pieces kept`); }
      else state.wardrobe = w;
      // clothes that slipped into the bag of an older client belong in the 옷장
      for (const k of Object.keys(state.inventory || {})) if (W.parse(k)) { w.own[k] = 1; delete state.inventory[k]; G.dirty('wardrobe'); }
      if (Array.isArray(OPT.expr) && app.expr && OPT.expr.includes(app.expr)) w.expr = app.expr;
      this._refit();
    },

    // ------------------------------------------------------------ state
    w() {
      if (!G.state) return W.blank();
      if (!G.state.wardrobe || typeof G.state.wardrobe !== 'object') G.state.wardrobe = W.sanitize(null);
      return G.state.wardrobe;
    },
    owns(iid) { return W.owns(this.w(), iid, isAdmin()); },
    look() { return G.avatar.normalize(G.state?.profile?.avatar || G.avatar.defaultAppearance); },
    _setLook(app) {
      const n = G.avatar.normalize(app);
      if (G.sys.player?.rig && G.sys.player.setAppearance) return G.sys.player.setAppearance(n);
      if (G.state?.profile) { G.state.profile.avatar = { ...n }; G.dirty('avatar'); G.bus.emit('player:appearance', { appearance: n }); }
      return n;
    },
    _refit() {
      if (!G.state) return;
      const f = W.fit(this.look(), this.w(), isAdmin());
      if (f.changed) { G.log.info('WARDROBE', 'the look wore pieces that are not owned: put back'); this._setLook(f.app); }
      this._lastLook = this.look();
    },
    _guard(app) {
      if (this._guarding || !G.state || !app) return;
      const f = W.fit(app, this.w(), isAdmin());
      if (!f.changed) { this._lastLook = Object.assign({}, app); return; }
      const prev = this._lastLook;
      if (prev) for (const s of W.slots) if (f.app[s.key] !== app[s.key] && typeof prev[s.key] === 'string' && (prev[s.key] === s.empty || this.owns(W.itemId(s.key, prev[s.key])))) f.app[s.key] = prev[s.key];
      this._guarding = true;
      try { this._setLook(f.app); } finally { this._guarding = false; }
      toast(easyOn() ? '옷장에 있는 옷만 입을 수 있어요. 한복집에서 사 봐요!' : '옷장에 있는 옷만 입을 수 있어요. 없는 옷은 한복집에서 살 수 있어요.', { type: 'info', emoji: '👘' });
    },
    _changed(kind, iid) { G.dirty('wardrobe'); G.bus.emit('wardrobe:changed', { kind, itemId: iid || null }); this._redraw(); },

    grant(iid, opts = {}) {
      const it = D.items[iid];
      if (!it || it.type !== 'wear' || !G.state) return false;
      const w = this.w();
      if (W.owns(w, iid, false)) {
        // already in the 옷장: its value in coins instead (never lost)
        const v = W.sellOf(iid);
        if (v > 0) G.sys.progression?.addCoin?.(v, { silent: true });
        if (!opts.silent) toast(easyOn() ? `${josa(it.name, '은/는')} 벌써 있어서 코인으로 바꿨어요!` : `${josa(it.name, '은/는')} 이미 옷장에 있어서 코인 ${fmt(v)}개로 바꿨어요.`, { type: 'info', emoji: '🪙' });
        return true;
      }
      w.own[iid] = 1;
      this._seen++;
      G.ui.setBadge?.('avatar', this._seen);
      this._changed('grant', iid);
      G.log.info('WARDROBE', `+${iid} (${opts.source || 'gift'})`);
      if (!opts.silent) toast(easyOn() ? `새 옷 ${josa(it.name, '을/를')} 받았어요! 옷장에서 입어 봐요.` : `새 옷 「${it.name}」 — 옷장에 넣었어요.`, { type: 'success', emoji: it.icon || '👘' });
      return true;
    },
    buy(iid) {
      const r = W.canBuy(this.w(), iid, coins(), isAdmin());
      if (!r.ok) return r;
      const P = G.sys.progression;
      const paid = P?.spendCoin ? P.spendCoin(r.price, { reason: 'hanbok' }) : false;
      if (!paid) return { ok: false, why: 'coins' };
      this.w().own[iid] = 1;
      try { G.sfx?.('coin'); } catch (e) { /* sound */ }
      G.activity?.('shop', `한복집 · ${D.items[iid].name}`);
      this._changed('buy', iid);
      return { ok: true, price: r.price };
    },
    sell(iid) {
      const r = W.canSell(this.w(), this.look(), iid);
      if (!r.ok) return r;
      delete this.w().own[iid];
      G.sys.progression?.addCoin?.(r.price, { silent: true });
      try { G.sfx?.('coin'); } catch (e) { /* sound */ }
      this._changed('sell', iid);
      return { ok: true, price: r.price };
    },
    wear(key, id) {
      const s = slotOf(key);
      if (!s || !G.state) return false;
      if (id !== s.empty && !this.owns(W.itemId(key, id))) return false;
      const app = this.look();
      app[key] = id;
      this._setLook(app);
      this._changed('wear', W.itemId(key, id));
      return true;
    },
    takeOff(key) {
      const s = slotOf(key);
      if (!s) return false;
      if (s.empty) return this.wear(key, s.empty);
      const d = AV.defaults && AV.defaults[key];
      const alt = (typeof d === 'string' && W.isStarter(W.itemId(key, d)) && d) || (W.starter.map((x) => W.parse(x)).find((x) => x.key === key) || {}).id;
      return alt ? this.wear(key, alt) : false;
    },
    setColor(key, hex) { if (!G.state || !(OPT[key] || []).includes(hex)) return false; const app = this.look(); app[key] = hex; this._setLook(app); this._changed('wear'); return true; },
    setBody(key, v) { if (!G.state) return false; const app = this.look(); app[key] = v; this._setLook(app); this._changed('wear'); return true; },
    setExpr(id) {
      if (!W.expressions.some((e) => e.id === id)) return false;
      this.w().expr = id;
      if (Array.isArray(OPT.expr) && OPT.expr.includes(id)) { const app = this.look(); app.expr = id; this._setLook(app); }
      else { try { G.sys.player?.rig?.setExpression?.(id, 4); } catch (e) { /* older rig */ } }
      this._changed('wear');
      return true;
    },
    saveSet(name) {
      const w = this.w();
      if (w.sets.length >= W.limits.sets) return null;
      let n = w.sets.length + 1;
      while (w.sets.some((s) => s.id === `set${n}`)) n++;
      const s = { id: `set${n}`, name: W.cleanName(name, W.limits.setName) || `갖춤 ${w.sets.length + 1}`, app: W.cleanLook(this.look()) };
      w.sets.push(s);
      this._changed('set');
      return s;
    },
    wearSet(id, src) {
      const set = src || this.w().sets.find((s) => s.id === id);
      if (!set) return { ok: false, missing: [] };
      const app = Object.assign(this.look(), W.cleanLook(set.app));
      const f = W.fit(app, this.w(), isAdmin());
      const missing = W.wornItems(app).filter((iid) => !this.owns(iid));
      this._setLook(f.app);
      this._changed('wear');
      return { ok: !missing.length, missing };
    },
    renameSet(id, name) { const s = this.w().sets.find((x) => x.id === id); const nm = W.cleanName(name, W.limits.setName); if (!s || !nm) return false; s.name = nm; this._changed('set'); return true; },
    removeSet(id) { const w = this.w(); const i = w.sets.findIndex((x) => x.id === id); if (i < 0) return false; w.sets.splice(i, 1); this._changed('set'); return true; },
    setTraits(list) { const t = W.sanitize({ sheet: { traits: list } }).sheet.traits; this.w().sheet.traits = t; this._changed('set'); return t; },
    setHome(id) { this.w().sheet.home = W.homes.some((x) => x.id === id) ? id : null; this._changed('set'); return this.w().sheet.home; },

    // ------------------------------------------------------------ the 옷장 window
    close() { this._m?.close(); },
    open(tab) {
      if (!G.state) return null;
      if (tab && TABS.some((t) => t.id === tab)) this._tab = tab;
      const kid = easyOn();
      this._seen = 0; G.ui.setBadge?.('avatar', 0);
      const ctx = { q: [], pv: null };
      const m = G.ui.modal.open({
        id: 'wardrobe', title: '옷장', icon: '👘', size: 'xl', className: `wd-modal${kid ? ' kid' : ''}`, autofocus: false,
        say: kid ? '옷장이에요. 칸을 눌러 옷을 골라요.' : undefined,
        body: (body) => {
          const stage = h('div', { class: 'wd-stage' });
          const views = h('div', { class: 'wd-views', role: 'group', 'aria-label': '돌려 보기' });
          for (const [v, e, l] of [['front', '🧍', '앞'], ['left', '⬅️', '왼쪽'], ['back', '🔙', '뒤'], ['right', '➡️', '오른쪽'], ['face', '🙂', '얼굴']]) {
            views.appendChild(h('button', { type: 'button', class: 'wd-view', dataset: { view: v }, 'data-say': `${l}에서 봐요.`, 'aria-label': `${l}에서 보기`, onclick: () => { setView(ctx.pv, v); for (const b of views.children) b.classList.toggle('on', b.dataset.view === v); } },
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, e), h('span', null, l)));
          }
          const card = h('div', { class: 'wd-card' });
          const tabs = h('div', { class: 'wd-tabs', role: 'tablist' });
          for (const t of TABS) {
            tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'wd-tab', dataset: { tab: t.id }, 'data-say': t.say, onclick: () => { this._tab = t.id; this._slot = null; this._render(); } },
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji), h('span', null, t.label)));
          }
          body.appendChild(h('div', { class: 'wd' },
            h('div', { class: 'wd-figure' }, stage, views, card),
            h('div', { class: 'wd-main' }, tabs, h('div', { class: 'wd-panel', role: 'tabpanel' }))));
          ctx.stage = stage;
        },
        actions: kid ? [{ label: '✅ 다 됐어요', class: 'btn-primary wd-done' }] : [
          { label: '한복집 가기', class: 'btn-soft', onClick: () => { this.openShop('SHOP_HANBOK'); } },
          { label: '닫기', class: 'btn-primary' },
        ],
        onClose: () => { ctx.pv?.dispose(); ctx.pv = null; ctx.q.length = 0; if (this._m === m) this._m = null; G.ui.setActive?.('avatar', false); },
      });
      m._ctx = ctx;
      this._m = m;
      G.ui.setActive?.('avatar', true);
      ctx.pv = makeStage(ctx.stage, this.look(), ctx);
      this._render();
      G.log.info('WARDROBE', `open ${this._tab}${kid ? ' (easy)' : ''}`);
      return m;
    },
    _redraw() {
      if (this._m && !this._m.closed) { this._m._ctx.pv?.setAppearance(this.look()); this._render(); }
      if (this._shop && !this._shop.closed) this._renderShop();
    },
    _render() {
      const m = this._m;
      if (!m || m.closed || !G.state) return;
      const ctx = m._ctx;
      ctx.q.length = 0;
      for (const b of m.body.querySelectorAll('.wd-tab')) { const on = b.dataset.tab === this._tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      this._renderCard(m.body.querySelector('.wd-card'));
      const p = m.body.querySelector('.wd-panel');
      const scroll = p.scrollTop;
      p.innerHTML = '';
      const f = { equip: this._pEquip, color: this._pColor, face: this._pFace, info: this._pInfo, sets: this._pSets, sheet: this._pSheet }[this._tab] || this._pEquip;
      f.call(this, p, ctx);
      p.scrollTop = this._keepScroll ? scroll : 0;
      this._keepScroll = false;
      G.kidKit?.gridKeys?.(p, 'button');
    },
    _renderCard(el) {
      if (!el) return;
      const p = G.state.profile || {}, app = this.look(), w = this.w();
      const home = W.homes.find((x) => x.id === w.sheet.home);
      el.innerHTML = '';
      el.append(...[
        h('b', { class: 'wd-nick' }, String(p.nickname || '체험객')),
        p.title ? h('span', { class: 'wd-title' }, `🏅 ${p.title}`) : null,
        h('span', { class: 'wd-meta' }, `키 숫자 ${playHeight(app.height)}${home ? ` · ${home.name}` : ''}`),
        w.sheet.traits.length ? h('span', { class: 'wd-traits' }, w.sheet.traits.join(' · ')) : null,
        h('span', { class: 'wd-coin', 'aria-label': `코인 ${fmt(coins())}개` }, `🪙 ${fmt(coins())}`)].filter(Boolean));
    },

    // ① 장비: one tile per slot; a tap lists that slot's pieces (owned first, the rest greyed with their price)
    _pEquip(p, ctx) {
      const app = this.look();
      if (this._slot) { this._pSlot(p, ctx, this._slot); return; }
      p.appendChild(h('p', { class: 'wd-hint' }, easyOn() ? '칸을 누르면 그 칸에 입을 옷이 나와요.' : '칸을 누르면 가진 옷과 한복집에서 살 수 있는 옷이 나와요.'));
      const grid = h('div', { class: 'wd-grid wd-slots', role: 'list' });
      for (const s of W.slots) {
        const v = app[s.key];
        const nm = nameOf(s.key, v);
        const cv = thumbCanvas();
        const n = (W.byKey[s.key] || []).filter((iid) => this.owns(iid)).length;
        const b = h('button', { type: 'button', role: 'listitem', class: 'wd-tile wd-slot', dataset: { slot: s.key }, 'data-say': `${s.name}. 지금은 ${nm}.`, 'aria-label': `${s.name}: ${nm}`, onclick: () => { this._slot = s.key; this._render(); } },
          cv, h('span', { class: 'wd-tl' }, s.name), h('span', { class: 'wd-ts' }, nm), h('span', { class: 'wd-badge', title: '가진 옷' }, String(n)));
        grid.appendChild(b);
        queueThumb(ctx, cv, app, FRAME[s.key] || 'body');
      }
      p.appendChild(grid);
    },
    _pSlot(p, ctx, key) {
      const s = slotOf(key), app = this.look(), kid = easyOn();
      p.appendChild(h('div', { class: 'wd-bar' },
        h('button', { type: 'button', class: 'btn btn-ghost wd-back', 'data-say': '모든 칸으로 돌아가요.', onclick: () => { this._slot = null; this._render(); } }, '⬅️ 모든 칸'),
        h('b', null, `${s.name} · 지금 ${nameOf(key, app[key])}`)));
      const grid = h('div', { class: 'wd-grid', role: 'list' });
      const tile = (id, owned) => {
        const iid = id === s.empty ? null : W.itemId(key, id);
        const it = iid ? D.items[iid] : null;
        const on = app[key] === id;
        const cv = thumbCanvas();
        const r = it ? RARITY[it.rarity] || RARITY.common : RARITY.common;
        const sub = !iid ? '벗어요' : owned ? (on ? '입고 있어요' : (W.isStarter(iid) ? '기본 옷' : '가진 옷')) : `🪙 ${fmt(it.price)}`;
        const b = h('button', { type: 'button', role: 'listitem', class: `wd-tile${on ? ' on' : ''}${owned ? '' : ' locked'}`, 'aria-pressed': on ? 'true' : 'false',
          'data-say': it ? `${it.name}. ${owned ? (on ? '입고 있어요.' : '눌러서 입어요.') : `한복집에서 코인 ${it.price}개예요.`}` : '안 입어요.',
          'aria-label': `${it ? it.name : '안 입기'} · ${sub}` },
        cv, h('span', { class: 'wd-tl' }, it ? it.name : '안 입기'), h('span', { class: 'wd-ts' }, sub), r[0] ? h('span', { class: 'wd-rar', title: r[1] }, r[0]) : null);
        b.addEventListener('click', () => {
          if (owned) { this.wear(key, id); if (kid) say(it ? `${josa(it.name, '을/를')} 입었어요!` : '벗었어요.'); return; }
          ctx.pv?.setAppearance(Object.assign(this.look(), { [key]: id }));
          this._offerShop(it, key);
        });
        grid.appendChild(b);
        if (key === 'outer') cv.dataset.outerTile = '1'; // [people] §19.9
        queueThumb(ctx, cv, Object.assign({}, app, { [key]: id }), FRAME[key] || 'body');
      };
      if (s.empty) tile(s.empty, true);
      const ids = (W.byKey[key] || []).map((iid) => W.parse(iid).id);
      for (const id of ids) if (this.owns(W.itemId(key, id))) tile(id, true);
      for (const id of ids) if (!this.owns(W.itemId(key, id))) tile(id, false);
      p.appendChild(grid);
    },
    async _offerShop(it, key) {
      const ok = await G.ui.confirm(easyOn() ? `${josa(it.name, '은/는')} 한복집에 있어요. 보러 갈까요?` : `「${it.name}」은(는) 아직 없는 옷이에요. 한복집에서 코인 ${fmt(it.price)}개에 살 수 있어요. 한복집에서 입어 볼까요?`,
        { title: '한복집', okText: easyOn() ? '👘 보러 가요' : '한복집에서 보기', emoji: '👘', icon: 'bag' });
      if (ok) this.openShop('SHOP_HANBOK', { slot: key, pick: W.itemId(key, it.wear) });
      else this._m?._ctx.pv?.setAppearance(this.look());
    },

    // ② 색: the named dyes of every worn piece
    _pColor(p) {
      const app = this.look();
      const row = (key, title) => {
        const list = OPT[key];
        if (!Array.isArray(list) || !list.length) return;
        const box = h('div', { class: 'wd-swatches', role: 'radiogroup', 'aria-label': title });
        for (const hex of list) {
          const nm = colorName(hex), on = String(app[key]).toLowerCase() === String(hex).toLowerCase();
          box.appendChild(h('button', { type: 'button', role: 'radio', class: `wd-sw${on ? ' on' : ''}`, 'aria-checked': on ? 'true' : 'false', title: nm, 'aria-label': nm, 'data-say': nm,
            style: { background: hex }, onclick: () => { this._keepScroll = true; this.setColor(key, hex); if (easyOn()) say(`${nm}이에요.`); } }));
        }
        p.append(h('h4', { class: 'wd-h' }, title, h('small', null, ` · ${colorName(app[key])}`)), box);
      };
      const used = new Set();
      for (const s of W.slots) {
        if (!s.colorKey || used.has(s.colorKey)) continue;
        if (s.empty && app[s.key] === s.empty) continue;
        used.add(s.colorKey);
        row(s.colorKey, `${s.name} 색 — ${nameOf(s.key, app[s.key])}`);
      }
      const extra = (AV.colorKeys || []).filter((k) => !used.has(k) && k !== 'skin' && k !== 'hairColor' && Array.isArray(OPT[k]));
      const XL = { trimColor: '깃·고름 색', accessoryColor: '꾸미개 색', outerColor: '겉옷 색' };
      for (const k of extra) row(k, XL[k] || G.avatar?.labels?.keys?.[k] || '그 밖의 색');
      if (!p.children.length) p.appendChild(h('p', { class: 'wd-hint' }, '색을 바꿀 옷이 없어요.'));
    },

    // ③ 표정: the nine faces, one is the usual face
    _pFace(p, ctx) {
      const cur = this.w().expr || this.look().expr || null;
      p.appendChild(h('p', { class: 'wd-hint' }, easyOn() ? '얼굴을 누르면 그 얼굴이 돼요. 별이 평소 얼굴이에요.' : '고른 얼굴이 평소 얼굴이 돼요. 다른 일이 있으면 잠깐 다른 얼굴도 해요.'));
      const grid = h('div', { class: 'wd-grid wd-faces', role: 'list' });
      for (const e of W.expressions) {
        const on = cur === e.id;
        grid.appendChild(h('button', { type: 'button', role: 'listitem', class: `wd-tile wd-face${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-say': e.say || e.name, 'aria-label': `${e.name}${on ? ' (평소 얼굴)' : ''}`,
          onclick: () => { this.setExpr(e.id); setView(ctx.pv, 'face'); try { ctx.pv?.rig?.setExpression?.(e.id, 3); } catch (err) { /* rig */ } } },
        h('span', { class: 'wd-emo emoji', 'aria-hidden': 'true' }, e.emoji), h('span', { class: 'wd-tl' }, e.name), on ? h('span', { class: 'wd-rar', title: '평소 얼굴' }, '⭐') : null));
      }
      p.appendChild(grid);
    },

    // ④ 기본 정보: nickname, 칭호, the figure's height as a play number, where it belongs, three words — no real data
    _pInfo(p) {
      const prof = G.state.profile || {}, app = this.look(), w = this.w(), kid = easyOn();
      p.appendChild(h('p', { class: 'wd-hint' }, '여기에는 놀이 속 이야기만 적어요. 진짜 이름이나 나이, 사는 곳은 적지 않아요.'));
      p.append(h('h4', { class: 'wd-h' }, '이름표'), h('div', { class: 'wd-kv' }, h('b', null, String(prof.nickname || '체험객')),
        kid ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { this.close(); G.app?.avatarEditor?.open?.(); } }, '닉네임 바꾸기')));
      const titles = G.sys.progression?.titles?.() || [];
      if (titles.length) {
        const box = h('div', { class: 'wd-chips', role: 'radiogroup', 'aria-label': '칭호' });
        for (const t of [''].concat(titles)) {
          const on = (prof.title || '') === t;
          box.appendChild(h('button', { type: 'button', role: 'radio', class: `wd-chip${on ? ' on' : ''}`, 'aria-checked': on ? 'true' : 'false', 'data-say': t || '칭호 없이',
            onclick: () => { this._keepScroll = true; G.sys.progression?.setTitle?.(t || null); this._render(); } }, t ? `🏅 ${t}` : '없음'));
        }
        p.append(h('h4', { class: 'wd-h' }, '칭호'), box);
      }
      const hb = h('div', { class: 'wd-chips', role: 'radiogroup', 'aria-label': '키' });
      for (const k of HEIGHTS) {
        const on = Math.abs((Number(app.height) || 1) - k) < 0.026;
        hb.appendChild(h('button', { type: 'button', role: 'radio', class: `wd-chip${on ? ' on' : ''}`, 'aria-checked': on ? 'true' : 'false', 'data-say': `키 숫자 ${playHeight(k)}`, onclick: () => { this._keepScroll = true; this.setBody('height', k); } }, `📏 ${playHeight(k)}`));
      }
      p.append(h('h4', { class: 'wd-h' }, '키 숫자', h('small', null, ' · 놀이 속 숫자예요')), hb);
      const home = h('div', { class: 'wd-chips', role: 'radiogroup', 'aria-label': '사는 곳' });
      for (const x of W.homes) {
        const on = w.sheet.home === x.id;
        home.appendChild(h('button', { type: 'button', role: 'radio', class: `wd-chip${on ? ' on' : ''}`, 'aria-checked': on ? 'true' : 'false', 'data-say': x.name, onclick: () => { this._keepScroll = true; this.setHome(on ? null : x.id); } }, x.name));
      }
      p.append(h('h4', { class: 'wd-h' }, '사는 곳', h('small', null, ' · 놀이 속 마을')), home);
      const tr = h('div', { class: 'wd-chips', role: 'group', 'aria-label': '성격 세 낱말' });
      for (const t of W.traits) {
        const on = w.sheet.traits.includes(t);
        tr.appendChild(h('button', { type: 'button', class: `wd-chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-say': t, onclick: () => {
          this._keepScroll = true;
          const cur = w.sheet.traits.slice();
          if (on) cur.splice(cur.indexOf(t), 1); else if (cur.length < W.limits.traits) cur.push(t); else { toast(kid ? '세 개까지 고를 수 있어요.' : '성격 낱말은 세 개까지 골라요. 하나를 먼저 빼 주세요.', { type: 'info' }); return; }
          this.setTraits(cur);
        } }, t));
      }
      p.append(h('h4', { class: 'wd-h' }, '성격 세 낱말', h('small', null, ` · ${w.sheet.traits.length} / 3`)), tr);
      // the body: free to change (no items)
      const free = [['style', '모습'], ['skin', '피부색'], ['face', '눈매'], ['hairColor', '머리 색']];
      for (const [k, title] of free) {
        const list = OPT[k];
        if (!Array.isArray(list)) continue;
        const box = h('div', { class: k === 'skin' || k === 'hairColor' ? 'wd-swatches' : 'wd-chips', role: 'radiogroup', 'aria-label': title });
        for (const v of list) {
          const on = String(app[k]) === String(v);
          const isHex = /^#/.test(String(v));
          const label = isHex ? colorName(v) : (G.avatar?.labels?.[k]?.[v] || W.labelOf(k, v));
          box.appendChild(h('button', { type: 'button', role: 'radio', class: isHex ? `wd-sw${on ? ' on' : ''}` : `wd-chip${on ? ' on' : ''}`, 'aria-checked': on ? 'true' : 'false', 'aria-label': label, title: label, 'data-say': label,
            style: isHex ? { background: v } : null, onclick: () => { this._keepScroll = true; this.setBody(k, v); } }, isHex ? null : label));
        }
        p.append(h('h4', { class: 'wd-h' }, title), box);
      }
    },

    // ⑥ 갖춤: saved outfits and the ready-made sets
    _pSets(p, ctx) {
      const w = this.w(), kid = easyOn();
      p.appendChild(h('div', { class: 'wd-bar' },
        h('button', { type: 'button', class: 'btn btn-primary wd-save', disabled: w.sets.length >= W.limits.sets || null, 'data-say': '지금 입은 옷을 한 벌로 모아 둬요.', onclick: () => { const s = this.saveSet(); if (s) { toast(kid ? '지금 옷을 모아 뒀어요!' : `「${s.name}」${josa(s.name, '으로/로').slice(s.name.length)} 모아 뒀어요.`, { type: 'success', emoji: '🧺' }); } } }, '🧺 지금 옷 모아 두기'),
        h('small', null, `${w.sets.length} / ${W.limits.sets}`)));
      const grid = h('div', { class: 'wd-grid wd-sets', role: 'list' });
      for (const s of w.sets) {
        const cv = thumbCanvas();
        const card = h('div', { class: 'wd-set', role: 'listitem' }, cv, h('b', null, s.name),
          h('div', { class: 'wd-acts' },
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-say': `${s.name}을 입어요.`, onclick: () => { const r = this.wearSet(s.id); if (!r.ok) toast('없는 옷은 빼고 입었어요.', { type: 'info' }); else if (kid) say('갈아입었어요!'); } }, kid ? '👘 입기' : '입기'),
            h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-say': '이름을 바꿔요.', onclick: () => this._renameSet(s) }, kid ? '🏷️' : '이름'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-say': '지워요.', 'aria-label': '지우기', onclick: async () => { if (await G.ui.confirm(kid ? '이 갖춤을 지울까요?' : `「${s.name}」 갖춤을 지울까요? 옷은 옷장에 그대로 있어요.`, { title: '갖춤 지우기', okText: '지우기', danger: true, emoji: '🗑️' })) this.removeSet(s.id); } }, '🗑️')));
        grid.appendChild(card);
        queueThumb(ctx, cv, Object.assign(this.look(), s.app), 'full');
      }
      if (!w.sets.length) grid.appendChild(h('p', { class: 'wd-hint' }, '아직 모아 둔 갖춤이 없어요.'));
      p.appendChild(grid);
      const presets = G.avatar?.presets || [];
      if (presets.length) {
        p.appendChild(h('h4', { class: 'wd-h' }, '추천 갖춤', h('small', null, ' · 옛날 옷차림 한 벌')));
        const pg = h('div', { class: 'wd-grid wd-sets', role: 'list' });
        for (const pr of presets) {
          const look = W.cleanLook(pr.appearance);
          const full = Object.assign(this.look(), look);
          const missing = W.wornItems(full).filter((iid) => !this.owns(iid));
          const cost = missing.reduce((a, iid) => a + W.priceOf(iid), 0);
          const cv = thumbCanvas();
          pg.appendChild(h('div', { class: 'wd-set', role: 'listitem' }, cv, h('b', null, `${pr.emoji || ''} ${pr.label}`),
            h('small', { class: 'wd-ts' }, missing.length ? `없는 옷 ${missing.length}벌 · 🪙 ${fmt(cost)}` : '다 있어요'),
            h('div', { class: 'wd-acts' }, missing.length
              ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-say': `${pr.label}. 없는 옷이 ${missing.length}벌 있어요. 한복집에서 볼까요?`, onclick: () => { const iid = missing[0]; this.openShop('SHOP_HANBOK', { slot: W.parse(iid).key, pick: iid }); } }, kid ? '👘 한복집' : '한복집에서 보기')
              : h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-say': `${pr.label}을 입어요.`, onclick: () => { this.wearSet(null, { app: look }); if (kid) say('갈아입었어요!'); } }, kid ? '👘 입기' : '입기'))));
          queueThumb(ctx, cv, full, 'full');
        }
        p.appendChild(pg);
      }
    },
    async _renameSet(s) {
      let name = null;
      if (easyOn()) {
        const ideas = ['나들이 옷', '설빔', '일하는 옷', '잔칫날 옷', '겨울 옷', '여름 옷', '서당 옷', '장터 옷', '산책 옷', '꽃놀이 옷'];
        const id = await G.easy?.pick?.({ title: '이름 고르기', say: '갖춤 이름을 골라요.', emoji: '🏷️', items: ideas.map((x) => ({ id: x, emoji: '🏷️', label: x })), columns: 2 });
        name = id || null;
      } else {
        name = await new Promise((resolve) => {
          const inp = h('input', { type: 'text', class: 'input', maxlength: String(W.limits.setName), value: s.name, 'aria-label': '갖춤 이름' });
          G.ui.modal.open({ id: 'wd-rename', title: '갖춤 이름', icon: '🏷️', size: 'sm', body: (b) => { b.append(h('p', { class: 'small muted' }, '글자와 숫자로 12자까지 적어요.'), inp); setTimeout(() => inp.focus(), 30); },
            actions: [{ label: '취소', class: 'btn-ghost', onClick: () => resolve(null) }, { label: '바꾸기', class: 'btn-primary', onClick: () => resolve(inp.value) }], onClose: () => resolve(null) });
        });
      }
      if (name != null && !this.renameSet(s.id, name)) toast('이름은 글자와 숫자로 적어 주세요.', { type: 'warn' });
    },

    // ⑦ 설정 시트: one picture in the layout of a character sheet, kept in the album
    _pSheet(p) {
      const kid = easyOn();
      p.appendChild(h('p', { class: 'wd-hint' }, kid ? '내 캐릭터를 한 장의 그림으로 만들어요. 앨범에 넣어 둬요.' : '네 방향 모습, 얼굴, 아홉 표정, 색, 자세히 본 곳 세 군데, 입은 옷 이름을 한 장에 모아요. 앨범에 들어가요.'));
      const out = h('div', { class: 'wd-sheet-out' });
      const btn = h('button', { type: 'button', class: 'btn btn-primary wd-make', 'data-say': '설정 시트를 만들어요.', onclick: async () => {
        btn.disabled = true; btn.textContent = '그리는 중…';
        const r = await this.makeSheet();
        btn.disabled = false; btn.textContent = '🖼️ 설정 시트 만들기';
        if (r) this._showSheet(out, r);
      } }, '🖼️ 설정 시트 만들기');
      p.append(btn, out);
      if (this._last && this._last.url) this._showSheet(out, this._last);
    },
    _showSheet(out, r) {
      const kid = easyOn();
      out.innerHTML = '';
      const img = h('img', { class: 'wd-sheet-img', alt: '내 캐릭터 설정 시트' });
      img.src = r.url || r.photo.thumb;
      const acts = h('div', { class: 'wd-acts' },
        h('button', { type: 'button', class: 'btn btn-soft', 'data-say': '앨범을 열어요.', onclick: () => { this.close(); G.sys.photo?.openGallery?.({ photoId: r.photo.id }); } }, '📒 앨범 보기'),
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-say': '어른과 함께 내려받아요.', onclick: async () => {
          // leaving the app sits behind the grown-up gate (as photos do)
          if (kid && G.easy?.gate && !(await G.easy.gate({ reason: 'download', title: '그림 내려받기' }))) return;
          const a = h('a', { href: r.url || r.photo.thumb, download: `character-sheet_${Date.now()}.png` });
          document.body.appendChild(a); a.click(); a.remove();
        } }, kid ? '🔒 어른과 내려받기' : '내려받기'));
      out.append(img, acts);
    },

    async makeSheet() {
      const ctx = this._m?._ctx;
      let pv = ctx?.pv, own = false;
      try {
        if (!pv) {
          const P = G.app?.avatarPreview;
          if (!P || G.unsupported) throw new Error('3D unavailable');
          const host = h('div', { class: 'wd-offstage' });
          document.body.appendChild(host);
          pv = new P(host, this.look()); own = host;
          if (pv.failed) throw new Error('no preview');
        }
        const canvas = await drawSheet(pv.renderer, this.look(), this.w(), G.state.profile || {});
        const photo = addToAlbum(canvas);
        const url = await new Promise((res) => canvas.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/png'));
        if (url) { try { G.sys.photo?._full?.set(photo.id, { url, name: `character-sheet_${photo.at}.png` }); } catch (e) { /* the album keeps the small copy */ } }
        this._last = { canvas, photo, url };
        G.bus.emit('wardrobe:changed', { kind: 'sheet' });
        toast(easyOn() ? '설정 시트를 앨범에 넣었어요!' : '설정 시트를 만들어 앨범에 넣었어요.', { type: 'success', emoji: '🖼️' });
        return this._last;
      } catch (e) {
        G.log.warn('WARDROBE', 'sheet failed', e?.message || e);
        toast('그림을 만들지 못했어요. 잠시 후 다시 해 주세요.', { type: 'error' });
        return null;
      } finally {
        if (own) { try { pv.dispose(); } catch (e) { /* ignore */ } own.remove(); }
      }
    },

    // ------------------------------------------------------------ the 한복집 (shelves by slot, 입어 보기, buy / sell)
    decorateShop(m, shopId, kid) {
      if (!m || !m.body || shopId === 'SHOP_HANBOK' || !D.shops.SHOP_HANBOK) return;
      const b = kid
        ? h('button', { type: 'button', class: 'easy-tile kk-tile wd-corner kid', 'data-say': '한복 코너. 한복을 사고팔아요.', 'aria-label': '한복 코너 열기' }, h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, '👘'), h('span', { class: 'et-label' }, '한복 코너'))
        : h('button', { type: 'button', class: 'btn btn-soft wd-corner' }, '👘 한복 코너 — 옷을 입어 보고 사고팔아요');
      b.addEventListener('click', () => { m.close(); this.openShop('SHOP_HANBOK'); });
      m.body.insertBefore(b, m.body.firstChild);
    },
    openShop(shopId = 'SHOP_HANBOK', opts = {}) {
      const shop = D.shops[shopId];
      if (!shop || !G.state) return null;
      const kid = easyOn();
      this._m?.close();
      const shelves = (shop.shelves || W.slots.map((s) => s.key)).filter((k) => (W.byKey[k] || []).some((iid) => shop.sells.includes(iid)));
      const st = this._shopSt = { id: shopId, tab: 'buy', slot: opts.slot && shelves.includes(opts.slot) ? opts.slot : shelves[0], pick: opts.pick || null, shelves };
      const ctx = { q: [], pv: null };
      const m = G.ui.modal.open({
        id: 'hanbokshop', title: shop.name || '한복집', icon: '👘', size: 'xl', className: `wd-modal wd-shopm${kid ? ' kid' : ''}`, autofocus: false,
        say: kid ? '한복집이에요. 옷을 눌러 입어 봐요.' : undefined,
        body: (body) => {
          const stage = h('div', { class: 'wd-stage' });
          const views = h('div', { class: 'wd-views' });
          for (const [v, e, l] of [['front', '🧍', '앞'], ['left', '⬅️', '왼쪽'], ['back', '🔙', '뒤'], ['right', '➡️', '오른쪽']]) {
            views.appendChild(h('button', { type: 'button', class: 'wd-view', 'data-say': `${l}에서 봐요.`, 'aria-label': `${l}에서 보기`, onclick: () => setView(ctx.pv, v) }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e), h('span', null, l)));
          }
          const seg = h('div', { class: 'wd-seg', role: 'tablist' });
          for (const [id, e, l, s] of [['buy', '🛍️', '사기', '옷을 사요.'], ['sell', '💰', '팔기', '옷을 팔아요. 반값을 받아요.']]) {
            seg.appendChild(h('button', { type: 'button', role: 'tab', class: 'wd-segb', dataset: { tab: id }, 'data-say': s, onclick: () => { st.tab = id; st.pick = null; ctx.pv?.setAppearance(this.look()); this._renderShop(); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e), h('span', null, l)));
          }
          body.appendChild(h('div', { class: 'wd' },
            h('div', { class: 'wd-figure' }, stage, views, h('div', { class: 'wd-try' })),
            h('div', { class: 'wd-main' },
              h('div', { class: 'wd-shopbar' }, h('span', { class: 'wd-clerk emoji', 'aria-hidden': 'true' }, '🧑‍💼'), h('p', { class: 'wd-bubble' }, kid ? '어서 와요! 옷을 눌러 입어 봐요.' : '어서 오세요. 옷을 고르면 먼저 입어 볼 수 있어요.'), h('span', { class: 'wd-coin' })),
              seg, h('div', { class: 'wd-shelves', role: 'tablist', 'aria-label': '옷 칸' }), h('div', { class: 'wd-panel' }), h('div', { class: 'wd-detail' }))));
          ctx.stage = stage;
        },
        actions: kid ? [{ label: '✅ 다 봤어요', class: 'btn-primary' }] : [
          { label: '옷장 열기', class: 'btn-soft', onClick: () => { this.open('equip'); } },
          { label: '닫기', class: 'btn-primary' },
        ],
        onClose: () => { ctx.pv?.dispose(); ctx.pv = null; ctx.q.length = 0; if (this._shop === m) this._shop = null; },
      });
      m._ctx = ctx;
      this._shop = m;
      ctx.pv = makeStage(ctx.stage, this.look(), ctx);
      this._renderShop();
      G.activity?.('shop', `${shop.name} 방문`);
      G.log.info('WARDROBE', `shop open ${shopId}${kid ? ' (easy)' : ''}`);
      return m;
    },
    _renderShop() {
      const m = this._shop, st = this._shopSt;
      if (!m || m.closed || !st || !G.state) return;
      const ctx = m._ctx, kid = easyOn(), shop = D.shops[st.id], w = this.w(), app = this.look();
      ctx.q.length = 0;
      m.body.querySelector('.wd-shopbar .wd-coin').textContent = `🪙 ${fmt(coins())}`;
      for (const b of m.body.querySelectorAll('.wd-segb')) { const on = b.dataset.tab === st.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      const sh = m.body.querySelector('.wd-shelves');
      sh.innerHTML = '';
      const pool = st.tab === 'buy' ? (k) => (W.byKey[k] || []).filter((iid) => shop.sells.includes(iid)) : (k) => (W.byKey[k] || []).filter((iid) => w.own[iid] && !W.isStarter(iid));
      const shelves = st.shelves.filter((k) => pool(k).length);
      if (st.tab === 'sell' && !shelves.includes(st.slot)) st.slot = shelves[0] || null;
      for (const k of shelves) {
        const s = slotOf(k);
        sh.appendChild(h('button', { type: 'button', role: 'tab', class: `wd-shelf${st.slot === k ? ' active' : ''}`, 'aria-selected': st.slot === k ? 'true' : 'false', 'data-say': s.name, onclick: () => { st.slot = k; st.pick = null; ctx.pv?.setAppearance(this.look()); this._renderShop(); } }, `${s.name} ${pool(k).length}`));
      }
      const p = m.body.querySelector('.wd-panel');
      p.innerHTML = '';
      const grid = h('div', { class: 'wd-grid', role: 'list' });
      if (!st.slot) grid.appendChild(G.kidKit?.empty ? G.kidKit.empty('👘', st.tab === 'sell' ? '팔 수 있는 옷이 없어요.' : '살 옷이 없어요.', st.tab === 'sell' ? '기본 옷과 입고 있는 옷은 팔지 않아요.' : '') : h('p', null, '옷이 없어요.'));
      for (const iid of st.slot ? pool(st.slot) : []) {
        const it = D.items[iid], { key, id } = W.parse(iid);
        const owned = this.owns(iid), worn = app[key] === id, poor = st.tab === 'buy' && !owned && coins() < it.price;
        const cv = thumbCanvas();
        const r = RARITY[it.rarity] || RARITY.common;
        const sub = st.tab === 'buy' ? (owned ? '✅ 있어요' : `🪙 ${fmt(it.price)}`) : (worn ? '입고 있어요' : `🪙 ${fmt(W.sellOf(iid))} 받아요`);
        const b = h('button', { type: 'button', role: 'listitem', class: `wd-tile${st.pick === iid ? ' on' : ''}${poor ? ' poor' : ''}${owned && st.tab === 'buy' ? ' owned' : ''}`, dataset: { item: iid },
          'data-say': `${it.name}. ${st.tab === 'buy' ? (owned ? '벌써 있어요.' : `코인 ${it.price}개예요.`) : `팔면 코인 ${W.sellOf(iid)}개를 받아요.`}`, 'aria-label': `${it.name} · ${sub}` },
        cv, h('span', { class: 'wd-tl' }, it.name), h('span', { class: 'wd-ts' }, sub), r[0] ? h('span', { class: 'wd-rar', title: r[1] }, r[0]) : null);
        b.addEventListener('click', () => { st.pick = iid; ctx.pv?.setAppearance(Object.assign(this.look(), { [key]: id })); this._renderShop(); if (kid) say(`${josa(it.name, '을/를')} 입어 봐요.`); });
        grid.appendChild(b);
        if (key === 'outer') cv.dataset.outerTile = '1'; // [people] §19.9
        queueThumb(ctx, cv, Object.assign({}, app, { [key]: id }), FRAME[key] || 'body');
      }
      p.appendChild(grid);
      G.kidKit?.gridKeys?.(grid, 'button');
      this._renderDetail(m.body.querySelector('.wd-detail'), m.body.querySelector('.wd-try'));
    },
    _renderDetail(el, tryEl) {
      const st = this._shopSt, m = this._shop, kid = easyOn();
      el.innerHTML = ''; tryEl.innerHTML = '';
      if (!st.pick || !D.items[st.pick]) { el.appendChild(h('p', { class: 'wd-hint' }, kid ? '옷 그림을 누르면 내 캐릭터가 입어 봐요.' : '옷을 고르면 왼쪽 모습에 먼저 입혀 봐요 (입어 보기). 사기 전에는 진짜로 입지 않아요.')); return; }
      const iid = st.pick, it = D.items[iid], { key, id } = W.parse(iid), owned = this.owns(iid), r = RARITY[it.rarity] || RARITY.common;
      const worn = this.look()[key] === id;
      tryEl.append(h('span', null, `입어 보는 중: ${it.name}`), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-say': '원래 옷으로 봐요.', onclick: () => { st.pick = null; m._ctx.pv?.setAppearance(this.look()); this._renderShop(); } }, '↩️ 원래대로'));
      el.append(h('div', { class: 'wd-dhead' }, h('b', null, it.name), r[1] && it.rarity !== 'common' ? h('span', { class: 'chip chip-gold' }, `${r[0]} ${r[1]}`) : null, h('span', { class: 'wd-dslot' }, slotOf(key).name)),
        it.desc ? h('p', { class: 'wd-about' }, it.desc) : '');
      const acts = h('div', { class: 'wd-acts' });
      if (st.tab === 'buy') {
        if (owned) acts.appendChild(h('button', { type: 'button', class: 'btn btn-primary', disabled: worn || null, 'data-say': '지금 입어요.', onclick: () => { this.wear(key, id); say(kid ? '입었어요!' : ''); } }, worn ? '입고 있어요' : (kid ? '👘 입기' : '입기')));
        else acts.appendChild(h('button', { type: 'button', class: 'btn btn-gold wd-buy', 'data-say': `코인 ${it.price}개로 사요.`, onclick: () => this._askBuy(iid) }, `🪙 ${fmt(it.price)} ${kid ? '사기' : '에 사기'}`));
      } else {
        if (worn) acts.appendChild(h('button', { type: 'button', class: 'btn btn-soft', 'data-say': '먼저 갈아입고 팔아요.', onclick: () => this._askSell(iid, true) }, kid ? '👕 벗고 팔기' : '먼저 갈아입고 팔기'));
        else acts.appendChild(h('button', { type: 'button', class: 'btn btn-gold wd-sell', 'data-say': `팔고 코인 ${W.sellOf(iid)}개를 받아요.`, onclick: () => this._askSell(iid, false) }, `🪙 ${fmt(W.sellOf(iid))} 받고 팔기`));
      }
      el.appendChild(acts);
    },
    async _askBuy(iid) {
      const it = D.items[iid], kid = easyOn(), { key, id } = W.parse(iid);
      if (coins() < it.price) {
        const need = it.price - coins();
        if (kid) { G.easy?.alert?.({ emoji: '🪙', title: '코인이 조금 모자라요', text: `코인 ${fmt(need)}개가 더 있으면 살 수 있어요. 밭일과 놀이를 하면 코인이 생겨요!`, say: '코인이 조금 모자라요. 놀이를 하면 코인이 생겨요.' }); }
        else toast(`코인이 ${fmt(need)}개 모자라요.`, { type: 'warn', emoji: '🪙' });
        return;
      }
      const ok = await G.ui.confirm(kid ? `${josa(it.name, '을/를')} 코인 ${fmt(it.price)}개로 살까요?` : `「${it.name}」을(를) 코인 ${fmt(it.price)}개에 살까요? 나중에 반값(${fmt(W.sellOf(iid))})에 되팔 수 있어요.`, { title: '옷 사기', okText: kid ? '🛍️ 살래요' : '사기', emoji: it.icon || '👘', icon: 'bag' });
      if (!ok) return;
      const r = this.buy(iid);
      if (!r.ok) { toast(r.why === 'coins' ? '코인이 모자라요.' : '살 수 없는 옷이에요.', { type: 'warn' }); return; }
      if (kid) G.easy?.celebrate?.(`${it.name}! 내 옷이 됐어요`, { emoji: it.icon || '👘', say: `${josa(it.name, '을/를')} 샀어요!` });
      else toast(`「${it.name}」을(를) 샀어요. 옷장에 넣었어요.`, { type: 'success', emoji: it.icon || '👘' });
      const wearNow = await G.ui.confirm(kid ? '지금 입을까요?' : '지금 입을까요?', { title: '입기', okText: kid ? '👘 입어요' : '입기', emoji: '👘' });
      if (wearNow) this.wear(key, id);
    },
    async _askSell(iid, takeOffFirst) {
      const it = D.items[iid], kid = easyOn(), { key } = W.parse(iid);
      if (takeOffFirst) {
        const ok = await G.ui.confirm(kid ? `${josa(it.name, '을/를')} 입고 있어요. 벗고 팔까요?` : `「${it.name}」을(를) 입고 있어요. 다른 옷으로 갈아입고 팔까요?`, { title: '갈아입기', okText: kid ? '👕 벗고 팔기' : '갈아입고 팔기', emoji: '👕' });
        if (!ok || !this.takeOff(key)) return;
      }
      const ok = await G.ui.confirm(kid ? `${josa(it.name, '을/를')} 팔고 코인 ${fmt(W.sellOf(iid))}개를 받을까요?` : `「${it.name}」을(를) 팔까요? 코인 ${fmt(W.sellOf(iid))}개를 받아요.`, { title: '옷 팔기', okText: kid ? '💰 팔래요' : '팔기', emoji: '💰' });
      if (!ok) return;
      const r = this.sell(iid);
      if (!r.ok) { toast(r.why === 'worn' ? '입고 있는 옷은 팔 수 없어요.' : r.why === 'starter' ? '기본 옷은 팔지 않아요.' : '팔 수 없는 옷이에요.', { type: 'warn' }); return; }
      this._shopSt.pick = null;
      this._shop?._ctx.pv?.setAppearance(this.look());
      toast(kid ? `코인 ${fmt(r.price)}개를 받았어요!` : `「${it.name}」을(를) 팔고 코인 ${fmt(r.price)}개를 받았어요.`, { type: 'success', emoji: '🪙' });
      this._renderShop();
    },
  };

  // ------------------------------------------------------------------ the album entry of a sheet (as 52-photo.js stores photos)
  function addToAlbum(canvas) {
    const TW = 480;
    const tw = Math.min(TW, canvas.width), th = Math.max(1, Math.round((canvas.height * tw) / canvas.width));
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const t = tc.getContext('2d');
    if (!t) throw new Error('no 2D context for the thumbnail');
    t.imageSmoothingQuality = 'high';
    t.drawImage(canvas, 0, 0, tw, th);
    const now = G.time?.now?.() || Date.now();
    const photo = { id: U.uid('photo'), at: now, zoneId: G.state.player?.zoneId || null, photoZoneId: null, place: '설정 시트', filter: 'none', frame: false, frameId: 'none', stickers: 0, w: canvas.width, h: canvas.height, thumb: tc.toDataURL('image/jpeg', 0.84), fmt: 'png' };
    const list = Array.isArray(G.state.photos) ? G.state.photos : (G.state.photos = []);
    list.push(photo);
    if (list.length > 24) list.splice(0, list.length - 24);
    G.dirty('photo');
    return photo;
  }

  // ------------------------------------------------------------------ the 설정 시트 picture (2D canvas + small 3D renders)
  // The layout of a character sheet: four views with a height mark, the face close up beside the card of 기본 정보, nine
  // expressions (3 × 3), the palette with the dye names, three details, and every worn piece drawn on its own with its name.
  async function drawSheet(renderer, app, w, prof) {
    const R = renderer;
    if (!R) throw new Error('no renderer');
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xfff4e2, 0x6a604e, 1.7);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.5); key.position.set(1.6, 2.6, 3);
    const fill = new THREE.DirectionalLight(0xcfe2ff, 0.8); fill.position.set(-2.4, 1.4, 1.8);
    const rim = new THREE.DirectionalLight(0xffe2b0, 1.3); rim.position.set(-1.5, 2.4, -2.6);
    scene.add(hemi, key, fill, rim);
    const rig = G.avatar.create(app, { shadow: false });
    scene.add(rig.group);
    const cam = new THREE.PerspectiveCamera(22, 1, 0.03, 30);
    const real = rig.style === 'real', hs = rig.heightMul || Number(app.height) || 1;
    const H = (real ? (rig.K?.height || 1.62) : 1.45) * hs, hc = (rig.K?.HC || (real ? 1.55 : 1.11)) * hs; // [people] §19.9 a child's stature
    const settle = (n = 6) => { for (let i = 0; i < n; i++) rig.update(1 / 30, IDLE); };
    const shot = (pw, ph, yaw, pos, look, fov = 22) => {
      rig.group.rotation.y = yaw;
      rig.group.updateMatrixWorld(true);
      cam.fov = fov; cam.aspect = pw / ph; cam.position.set(pos[0], pos[1], pos[2]); cam.lookAt(look[0], look[1], look[2]); cam.updateProjectionMatrix();
      const rt = new THREE.WebGLRenderTarget(pw, ph, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      const px = new Uint8Array(pw * ph * 4);
      const prevAlpha = R.getClearAlpha();
      try { R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam); R.readRenderTargetPixels(rt, 0, 0, pw, ph, px); }
      finally { R.setRenderTarget(null); R.setClearAlpha(prevAlpha); rt.dispose(); }
      const img = new ImageData(pw, ph), row = pw * 4;
      for (let y = 0; y < ph; y++) img.data.set(px.subarray((ph - 1 - y) * row, (ph - y) * row), y * row);
      const c = document.createElement('canvas'); c.width = pw; c.height = ph; c.getContext('2d').putImageData(img, 0, 0);
      return c;
    };
    // the framing of a piece (the same frames as the tile pictures): [yaw, camera y, distance, look y]
    const frameOf = (f) => ({
      head: [0.4, hc + 0.05, real ? 0.95 : 1.6, hc + 0.02], hair: [0.85, hc + 0.02, real ? 0.85 : 1.55, hc - 0.01],
      body: [0.3, H * 0.66, real ? 2.3 : 2.2, H * 0.62], full: [0.3, H * 0.55, real ? 4.6 : 4.0, H * 0.5],
      feet: [0.5, 0.32 * hs, 1.15, 0.1 * hs], back: [Math.PI - 0.5, H * 0.66, 2.6, H * 0.6],
    }[f] || [0.3, H * 0.55, 4.4, H * 0.5]);
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    settle(8);
    const dist = (H * 1.12 / 2) / Math.tan((22 * Math.PI / 180) / 2);
    const views = [];
    for (const [yaw, label] of [[0, '앞'], [-Math.PI / 2, '왼쪽'], [Math.PI, '뒤'], [Math.PI / 2, '오른쪽']]) {
      views.push([shot(300, 560, yaw, [0, H * 0.54, dist], [0, H * 0.5, 0]), label]);
      await tick();
    }
    const face = shot(320, 320, 0.12, [0, hc + 0.02, real ? 0.78 : 1.4], [0, hc, 0], 22);
    await tick();
    const faces = [];
    for (const e of W.expressions.slice(0, 9)) {
      try { rig.setExpression?.(e.id, 30); } catch (err) { /* older rig */ }
      settle(18);
      faces.push([shot(160, 160, 0.1, [0, hc + 0.02, real ? 0.72 : 1.3], [0, hc, 0], 22), e.name]);
    }
    try { rig.setExpression?.(null, 0); } catch (err) { /* ignore */ }
    settle(4);
    await tick();
    // three details: the pieces that tell most (headwear, the collar and its 고름, a 꾸미개 or the shoes)
    const worn = W.wornItems(app);
    const has = (k) => worn.some((iid) => W.parse(iid).key === k);
    const det = [];
    if (has('hat')) det.push(['쓰개', nameOf('hat', app.hat), 0.5, [0, hc + 0.08, real ? 0.9 : 1.5], [0, hc + 0.05, 0]]);
    else det.push(['머리', nameOf('hair', app.hair), Math.PI - 0.6, [0, hc + 0.02, real ? 0.85 : 1.5], [0, hc, 0]]);
    det.push(['깃과 고름', nameOf('top', app.top), 0.2, [0, H * 0.74, real ? 0.95 : 1.5], [0, H * 0.7, 0]]);
    const acc = ['norigae', 'pouch', 'belt', 'fan'].filter(has);
    if (acc.length) det.push(['꾸미개', acc.map((k) => nameOf(k, app[k])).join(' · '), 0.35, [0, H * 0.56, real ? 1.0 : 1.5], [0, H * 0.55, 0]]);
    else det.push(['신', nameOf('footwear', app.footwear), 0.5, [0, 0.3 * hs, real ? 1.05 : 1.2], [0, 0.1 * hs, 0]]);
    const details = det.slice(0, 3).map(([a, b, yaw, pos, look]) => [shot(240, 240, yaw, pos, look, 22), a, b]);
    await tick();
    // every worn piece on its own (the figure framed on that piece), with its name
    const pieces = [];
    for (const s of W.slots) {
      const v = app[s.key];
      if (v == null || (s.empty && v === s.empty)) continue;
      const f = frameOf(FRAME[s.key] || 'body');
      pieces.push([shot(150, 150, f[0], [0, f[1], f[2]], [0, f[3], 0], 24), s.name, nameOf(s.key, v), W.itemId(s.key, v)]);
    }
    try { rig.dispose(); } catch (e) { /* ignore */ }
    for (const l of [hemi, key, fill, rim]) l.dispose?.();

    // ---- the 2D layout on a sheet of hanji
    const CW = 1800, CH = 1320;
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2D context');
    g.fillStyle = '#f3ead6'; g.fillRect(0, 0, CW, CH);
    const rnd = U.rng ? U.rng(7) : Math.random;
    g.globalAlpha = 0.07; g.strokeStyle = '#8a7350'; g.lineWidth = 1;
    for (let i = 0; i < 1100; i++) { const x = rnd() * CW, y = rnd() * CH, a = rnd() * Math.PI, l = 6 + rnd() * 22; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    g.globalAlpha = 1;
    const box = (x, y, ww, hh, col = '#8a3b4b') => { g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(x + 0.5, y + 0.5, ww, hh); g.strokeStyle = 'rgba(46,63,110,.5)'; g.lineWidth = 1; g.strokeRect(x + 6.5, y + 6.5, ww - 12, hh - 12); };
    const text = (str, x, y, size = 22, col = '#2c2a26', weight = 600, align = 'left', maxW) => { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; if (maxW) g.fillText(String(str), x, y, maxW); else g.fillText(String(str), x, y); };
    const band = (x, y, ww, label) => {
      g.fillStyle = '#2e3f6e'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + ww - 18, y); g.lineTo(x + ww, y + 17); g.lineTo(x + ww - 18, y + 34); g.lineTo(x, y + 34); g.closePath(); g.fill();
      g.fillStyle = '#d9534f'; g.fillRect(x, y + 34, ww, 3);
      text(label, x + 14, y + 25, 20, '#f6efe0', 700);
    };
    const pane = (x, y, ww, hh) => { g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x, y, ww, hh); };
    box(14, 14, CW - 28, CH - 28);
    // title
    text('캐릭터 설정 시트', 44, 74, 40, '#2e3f6e', 800);
    text(`${prof.nickname || '체험객'}${prof.title ? ` · ${prof.title}` : ''}`, 44, 112, 26, '#5a4636', 700);
    text(`${new Date().toISOString().slice(0, 10)} · 전통발효체험관`, CW - 44, 74, 20, '#7a6a55', 500, 'right');
    // four views with a height mark beside the front view
    band(40, 130, 1010, '네 방향 모습');
    views.forEach(([cv, label], i) => {
      const x = 92 + i * 240, y = 180;
      pane(x, y, 228, 426);
      g.drawImage(cv, x, y, 228, 426);
      text(label, x + 114, y + 452, 22, '#2c2a26', 700, 'center');
    });
    g.strokeStyle = '#5a4636'; g.lineWidth = 2;
    const top = 180 + 426 * 0.06, bot = 180 + 426 * 0.97;
    g.beginPath(); g.moveTo(70, top); g.lineTo(70, bot); g.moveTo(62, top); g.lineTo(78, top); g.moveTo(62, bot); g.lineTo(78, bot); g.stroke();
    g.save(); g.translate(60, (top + bot) / 2); g.rotate(-Math.PI / 2); text(`키 숫자 ${playHeight(app.height)}`, 0, 0, 17, '#5a4636', 700, 'center'); g.restore();
    // face + 기본 정보
    band(1070, 130, 690, '얼굴과 기본 정보');
    pane(1080, 180, 270, 270); g.drawImage(face, 1080, 180, 270, 270); box(1080, 180, 270, 270, '#b45a73');
    const home = W.homes.find((x) => x.id === w.sheet.home);
    const facts = [['이름표', prof.nickname || '체험객'], ['칭호', prof.title || '—'], ['키 숫자', `${playHeight(app.height)} (놀이 숫자)`], ['사는 곳', home ? home.name : '—'], ['성격', w.sheet.traits.length ? w.sheet.traits.join(', ') : '—'],
      ['평소 얼굴', (W.expressions.find((e) => e.id === (w.expr || app.expr)) || { name: '—' }).name]];
    facts.forEach(([k, v], i) => {
      const y = 196 + i * 42;
      g.fillStyle = '#2e3f6e'; g.fillRect(1366, y, 92, 32); text(k, 1412, y + 23, 17, '#f6efe0', 700, 'center');
      text(v, 1470, y + 24, 19, '#2c2a26', 600, 'left', 285);
    });
    // nine faces, 3 × 3
    band(1070, 468, 690, '아홉 가지 표정');
    faces.forEach(([cv, label], i) => {
      const x = 1118 + (i % 3) * 222, y = 514 + Math.floor(i / 3) * 166;
      pane(x, y, 132, 132); g.drawImage(cv, x, y, 132, 132); box(x, y, 132, 132, '#7a6a55');
      text(label, x + 66, y + 154, 18, '#2c2a26', 700, 'center');
    });
    // palette
    band(40, 650, 500, '색 (전통 물감)');
    const cols = [];
    const usedK = new Set();
    for (const s of W.slots) if (s.colorKey && !usedK.has(s.colorKey) && !(s.empty && app[s.key] === s.empty) && app[s.colorKey]) { usedK.add(s.colorKey); cols.push([app[s.colorKey], s.name]); }
    for (const k of ['skin', 'hairColor']) if (app[k] && !usedK.has(k)) { usedK.add(k); cols.push([app[k], k === 'skin' ? '피부' : '머리']); }
    cols.slice(0, 12).forEach(([hex, label], i) => {
      const x = 52 + (i % 3) * 164, y = 700 + Math.floor(i / 3) * 70;
      g.fillStyle = hex || '#ccc'; g.fillRect(x, y, 50, 50); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 50, 50);
      text(colorName(hex), x + 58, y + 22, 17, '#2c2a26', 700, 'left', 96); text(label, x + 58, y + 44, 14, '#7a6a55', 500, 'left', 96);
    });
    // details
    band(560, 650, 490, '자세히 본 곳');
    details.forEach(([cv, a, b], i) => {
      const x = 572 + i * 160, y = 700;
      pane(x, y, 150, 150); g.drawImage(cv, x, y, 150, 150); box(x, y, 150, 150, '#2f7d4a');
      text(a, x + 75, y + 174, 16, '#2f5a3c', 700, 'center', 150);
      text(b, x + 75, y + 196, 15, '#2c2a26', 600, 'center', 150);
    });
    // every worn piece, drawn on its own
    band(40, 1030, 1720, '입은 옷 (장비)');
    pieces.slice(0, 14).forEach(([cv, slot, nm], i) => {
      const x = 52 + (i % 14) * 122, y = 1082;
      pane(x, y, 112, 112); g.drawImage(cv, x, y, 112, 112); box(x, y, 112, 112, '#8a5a3b');
      text(slot, x + 56, y + 134, 14, '#8a3b4b', 700, 'center', 112);
      text(nm, x + 56, y + 154, 15, '#2c2a26', 700, 'center', 112);
    });
    text('이 그림은 놀이 속 캐릭터예요. 진짜 사람의 정보는 들어 있지 않아요.', CW - 44, CH - 30, 15, '#7a6a55', 500, 'right');
    return c;
  }

  G.register(sys);
})();
