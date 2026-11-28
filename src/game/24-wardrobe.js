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
  if (typeof G._wardrobeSystem === 'function') G._wardrobeSystem();
})();
