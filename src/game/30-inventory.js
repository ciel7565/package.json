// =============================================================================
// 30-inventory.js — bag (G.sys.inventory) + shop (buy / sell with coins)
//
//   add(itemId, qty=1, {source, silent}) -> added      emits item:added {itemId, qty, source}
//   remove(itemId, qty=1, {source, silent}) -> bool    emits item:removed {itemId, qty, source}
//   has(itemId, qty=1) / count(itemId) / list(type?) -> [{id, item, qty}]
//   open(tab?, {select}) / close() / toggle()          bag modal: tabs, .slot grid, detail pane
//   openShop(shopId) / closeShop()                     buy & sell (coins via G.sys.progression)
//   typeLabel(type)
//   openItem(itemId)                                   kid item card (easy mode): picture, 🔊, big emoji actions
// Hotkey I, action `inventory`. Registers the shop stall interactable (kind 'shop').
// Also provides G.progToast (small staggered toast queue shared by 30/31/32 modules) and G.kidKit
// (tiny kid-UI helpers shared by 30/31/32/47: josa, coin chip, empty state, arrow-key grids).
//
// 쉬운 모드 (CONTRACT §12, default): open() = picture bag (sections, big tiles with count badges; tap -> item card
// with 🌱 심기 (auto-walks to an empty plot and plants) / 💰 팔기 / 🛒 가게 가기 / 🏡 꾸미기 / ✖), openShop() = picture
// shop (🛍️ 사기 · 💰 팔기 tabs, 🪙 price pictures, one tap + G.easy.confirm, friendly "🪙가 조금 모자라요" path),
// guidebook = picture guide + 🗺️ 어디 갈까?. No typing, no quantity steppers. Normal mode is unchanged.
// =============================================================================
(function () {
  const TYPE_LABEL = { seed: '씨앗', crop: '작물', ingredient: '재료', fermented: '발효식품', tool: '도구', decoration: '장식', quest: '퀘스트' };
  const TYPE_CHIP = { seed: 'chip-green', crop: 'chip-green', ingredient: 'chip-blue', fermented: 'chip-gold', tool: '', decoration: 'chip-purple', quest: 'chip-red' };
  const TYPE_ORDER = ['seed', 'crop', 'ingredient', 'fermented', 'tool', 'decoration', 'quest'];
  const TABS = [
    { id: 'all', label: '전체', types: null },
    { id: 'seed', label: '씨앗', types: ['seed'] },
    { id: 'crop', label: '작물', types: ['crop'] },
    { id: 'ingredient', label: '재료', types: ['ingredient'] },
    { id: 'fermented', label: '발효식품', types: ['fermented'] },
    { id: 'tool', label: '도구', types: ['tool', 'quest'] },
    { id: 'decoration', label: '장식', types: ['decoration'] },
  ];
  const SHOP_FILTERS = [
    { id: 'all', label: '전체', types: null },
    { id: 'seed', label: '씨앗·모종', types: ['seed'] },
    { id: 'ingredient', label: '재료', types: ['ingredient', 'crop'] },
    { id: 'tool', label: '도구', types: ['tool'] },
    { id: 'decoration', label: '장식', types: ['decoration'] },
  ];
  // sources whose systems already play their own sound -> item toast stays quiet
  const QUIET_SOURCES = /^(harvest|farm|craft|ferment|shop)/;
  const MIN_GRID = 24;

  const esc = (s) => G.util.escapeHtml(s);
  const fmt = (n) => G.util.fmt(n);
  const coinIco = () => '<span class="ico ico-sm" data-icon="coin"></span>';

  /** Korean particle only: particle('콩', '을/를') -> '을', particle('메주 빚기', '으로/로') -> '로' (trailing punctuation ignored) */
  function particle(word, pair) {
    const w = String(word ?? '').replace(/[\s?!.,)」』"'\]]+$/, '');
    const [a, b] = pair.split('/');
    const code = w.charCodeAt(w.length - 1);
    if (!(code >= 0xac00 && code <= 0xd7a3)) return `${a}(${b})`;
    const jong = (code - 0xac00) % 28;
    if (pair === '으로/로') return jong === 0 || jong === 8 ? b : a;
    return jong ? a : b;
  }
  /** Korean particle helper: josa('콩', '을/를') -> '콩을' */
  function josa(word, pair) { return String(word ?? '') + particle(word, pair); }

  // ---------------------------------------------------------------- shared staggered toast queue (30/31/32)
  if (!G.progToast) {
    const queue = [];
    let busy = false;
    const pump = () => {
      const n = queue.shift();
      if (!n) { busy = false; return; }
      busy = true;
      try {
        const el = G.ui.toast(n.msg, n.opts);
        if (el && n.opts.cls) el.classList.add(...String(n.opts.cls).split(/\s+/).filter(Boolean));
      } catch (e) { G.log.warn('UI', 'toast failed', e); }
      setTimeout(pump, n.opts.gap ?? 280);
    };
    G.progToast = function (msg, opts = {}) {
      queue.push({ msg, opts });
      if (queue.length > 12) queue.splice(0, queue.length - 12); // never let a burst pile up for minutes
      if (!busy) pump();
    };
    G.progToast.clear = () => { queue.length = 0; };
  }
  G.progJosa = G.progJosa || josa;
  G.progJosa.p = G.progJosa.p || particle;

  // ---------------------------------------------------------------- shared kid-UI kit (30/31/32/47, CONTRACT §12)
  /** easy mode is on AND the kid toolkit (08-easy) is alive — otherwise every module falls back to the adult UI */
  const easyOn = () => !!(G.easy && G.easy.on);
  /** josa that never prints "을(를)": non-Hangul endings take the vowel form, digits are read in Sino-Korean */
  function kjosa(word, pair) {
    const w = String(word ?? '');
    const [a, b] = String(pair).split('/');
    const s = w.replace(/[\s?!.,)」』"'\]]+$/, '');
    const c = s.charCodeAt(s.length - 1);
    let jong = false;
    if (c >= 0xac00 && c <= 0xd7a3) jong = (c - 0xac00) % 28 !== 0;
    else if (/[0-9]$/.test(s)) jong = /[013678]$/.test(s);
    if (pair === '으로/로' && c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8) jong = false; // ㄹ받침 + 로
    return w + (jong ? a : b);
  }
  if (!G.kidKit) {
    G.kidKit = {
      on: easyOn,
      josa: kjosa,
      /** '콩' -> '콩이에요', '고추' -> '고추예요' */
      iyeyo: (w) => kjosa(w, '이에요/예요'),
      /** 🪙 coin chip for kid modal headers; .set(n) updates it */
      coinChip() {
        const b = G.ui.h('b', null, '0');
        const el = G.ui.h('span', { class: 'kk-coin', role: 'img', 'aria-label': '내 코인' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🪙'), b);
        el.set = (n) => { const t = G.util.fmt(Math.max(0, Math.floor(Number(n) || 0))); if (b.textContent !== t) b.textContent = t; el.setAttribute('aria-label', `내 코인 ${t}개`); el.__easySpeak = { btn: null, text: `코인 ${t}개 있어요.` }; };
        return el;
      },
      /** friendly empty state: mascot (or emoji) + one sentence + an optional hint */
      empty(emoji, title, hint, mood = 'think') {
        let face = null;
        try { const svg = G.mascot?.svg?.(mood, 84); if (typeof svg === 'string' && svg.trim().startsWith('<svg')) face = G.ui.h('span', { class: 'kk-empty-face', 'aria-hidden': 'true', html: svg }); } catch (e) { face = null; }
        return G.ui.h('div', { class: 'kk-empty', role: 'status' },
          face || G.ui.h('span', { class: 'kk-empty-emoji emoji', 'aria-hidden': 'true' }, emoji || '🙂'),
          G.ui.h('b', null, String(title || '')),
          hint ? G.ui.h('span', null, String(hint)) : null);
      },
      /** arrow keys / Home / End move the focus between the buttons of a picture grid (idempotent) */
      gridKeys(grid, selector = 'button') {
        if (!grid || grid.__kidKeys) return;
        grid.__kidKeys = true;
        grid.addEventListener('keydown', (e) => {
          const tiles = Array.from(grid.querySelectorAll(selector)).filter((t) => !t.disabled && t.offsetParent !== null);
          const i = tiles.indexOf(document.activeElement);
          if (i < 0) return;
          let cols = 1;
          try { const tpl = getComputedStyle(grid).gridTemplateColumns; cols = tpl && tpl !== 'none' ? Math.max(1, tpl.split(' ').filter(Boolean).length) : 1; } catch (err) { cols = 1; }
          const mv = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -1e4, End: 1e4 }[e.key];
          if (mv == null) return;
          e.preventDefault();
          tiles[G.util.clamp(i + mv, 0, tiles.length - 1)].focus();
        });
      },
      /** read a line aloud with the voice guide (never throws) */
      say(text, opts) { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } },
      /** set CSS custom properties (G.ui.h's style object cannot) and return the element */
      vars(el, map) { if (el) for (const [k, v] of Object.entries(map || {})) el.style.setProperty(k, String(v)); return el; },
      /** wiggle an element (wrong / not allowed) */
      shake(el) { if (!el) return; el.classList.remove('easy-shake'); void el.offsetWidth; el.classList.add('easy-shake'); },
    };
  }
  const KK = G.kidKit;

  // kid categories (bag sections) — the colour is the tile frame (--tile), never user data
  const KID_TYPE = {
    seed: { label: '씨앗', emoji: '🌱', color: '#55d187' },
    crop: { label: '채소', emoji: '🥕', color: '#8fd14f' },
    ingredient: { label: '재료', emoji: '🧂', color: '#4fb3ff' },
    fermented: { label: '발효 음식', emoji: '🏺', color: '#ffc93c' },
    tool: { label: '도구', emoji: '🧰', color: '#d3a46a' },
    decoration: { label: '꾸미기', emoji: '✨', color: '#b48bff' },
    quest: { label: '특별한 것', emoji: '📘', color: '#ff8a5c' },
  };
  /** one short, warm sentence about an item (no numbers, no jargon) */
  function kidDesc(it) {
    const n = String(it?.name || '');
    switch (it?.type) {
      case 'seed': { const c = G.data.crops?.[it.crop]; return c ? `밭에 심으면 ${kjosa(c.name, '이/가')} 자라요.` : '밭에 심는 씨앗이에요.'; }
      case 'crop': return `밭에서 거둔 ${KK.iyeyo(n)}.`;
      case 'ingredient': return `${KK.iyeyo(n)}. 맛있는 장을 만들 때 써요.`;
      case 'fermented': return `장독에서 익힌 ${KK.iyeyo(n)}.`;
      case 'tool': return `${KK.iyeyo(n)}. 가방에 있으면 저절로 써요.`;
      case 'decoration': return `${KK.iyeyo(n)}. 마당을 예쁘게 꾸며요.`;
      case 'quest': return `${KK.iyeyo(n)}. 어디서 놀지 알려 줘요.`;
      default: return `${KK.iyeyo(n)}.`;
    }
  }
  /** nearest empty plot that can take this crop (crop beds vs herb beds), from the farming system or the save */
  function emptyPlotFor(cropId) {
    const crop = G.data.crops?.[cropId];
    if (!crop) return null;
    const herb = crop.category === 'herb';
    const p = G.sys.player?.position;
    let best = null, bd = Infinity;
    for (const d of G.data.layout?.farmPlots || []) {
      if ((d.zone === 'ZONE_HERB') !== herb) continue;
      let info = null;
      try { info = G.sys.farming?.getPlot?.(d.id) || null; } catch (e) { info = null; }
      const empty = info ? !!info.empty : !(G.state?.farm?.plots?.[d.id]?.cropId ?? d.crop);
      if (!empty) continue;
      const dist = p ? Math.hypot(d.x - p.x, d.z - p.z) : 0;
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }
  /** a walkable spot just outside a rectangular bed, on the side facing the player */
  function approachPoint(def, margin = 1.15) {
    const hw = (Number(def.w) || 4) / 2, hd = (Number(def.d) || 4) / 2;
    const p = G.sys.player?.position || { x: def.x, z: def.z + hd + 6 };
    let x = G.util.clamp(p.x, def.x - hw, def.x + hw), z = G.util.clamp(p.z, def.z - hd, def.z + hd);
    const dx = (p.x - def.x) / hw, dz = (p.z - def.z) / hd;
    if (Math.abs(dx) > Math.abs(dz)) x = def.x + (dx >= 0 ? 1 : -1) * (hw + margin);
    else z = def.z + (dz >= 0 ? 1 : -1) * (hd + margin);
    return { x, z };
  }
  const KID_MODALS = ['inv-item', 'guidebook'];

  // ---------------------------------------------------------------- helpers
  const items = () => G.data.items || {};
  const itemOf = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(items(), id) ? items()[id] : null); // ids come from saves too
  const coins = () => Number(G.state?.stats?.coin) || 0;
  function sortEntries(arr) {
    return arr.sort((a, b) => {
      const ta = TYPE_ORDER.indexOf(a.item.type), tb = TYPE_ORDER.indexOf(b.item.type);
      if (ta !== tb) return ta - tb;
      return a.item.name.localeCompare(b.item.name, 'ko');
    });
  }
  function spend(n) {
    const P = G.sys.progression;
    if (P?.spendCoin) return P.spendCoin(n, { reason: 'shop' });
    if (coins() < n) return false;
    G.state.stats.coin = coins() - n;
    G.dirty('coin');
    return true;
  }
  function earn(n) {
    const P = G.sys.progression;
    if (P?.addCoin) return P.addCoin(n, { reason: 'shop', silent: true });
    G.state.stats.coin = coins() + n;
    G.dirty('coin');
    return G.state.stats.coin;
  }

  /** − [n] + stepper. onChange(n) */
  function stepper(value, min, max, onChange) {
    let v = G.util.clamp(value, min, Math.max(min, max));
    const input = G.ui.h('input', { type: 'number', class: 'stp-input', min: String(min), max: String(Math.max(min, max)), value: String(v), 'aria-label': '수량', inputmode: 'numeric' });
    const set = (n, fire = true) => {
      const nv = G.util.clamp(Math.round(Number(n) || min), min, Math.max(min, max));
      v = nv; input.value = String(nv);
      minus.disabled = nv <= min; plus.disabled = nv >= max;
      if (fire) onChange?.(nv);
    };
    const minus = G.ui.h('button', { type: 'button', class: 'stp-btn', 'aria-label': '하나 빼기', onclick: () => set(v - 1) }, '−');
    const plus = G.ui.h('button', { type: 'button', class: 'stp-btn', 'aria-label': '하나 더하기', onclick: () => set(v + 1) }, '+');
    const maxBtn = G.ui.h('button', { type: 'button', class: 'stp-max', onclick: () => set(max) }, '최대');
    input.addEventListener('change', () => set(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const el = G.ui.h('div', { class: 'stepper' }, minus, input, plus, maxBtn);
    set(v, false);
    return { el, get value() { return v; }, set };
  }

  /** what an item is used for (crafts / recipes / crops) -> [{icon, text}] */
  function usesOf(id) {
    const out = [];
    const it = itemOf(id);
    if (!it) return out;
    if (it.type === 'seed' && it.crop) {
      const c = G.data.crops?.[it.crop];
      if (c) {
        const [a, b] = c.harvestAmount || [1, 1];
        out.push({ icon: '🌱', text: `${c.name} 재배 · 물을 잘 주면 약 ${G.util.formatDuration(c.growthTime)} 만에 다 자라요 · 수확 ${a}~${b}개` });
        out.push({ icon: '💡', text: c.category === 'herb' ? '허브 구역의 빈 밭에 다가가 E 키로 심어 보세요.' : '전통작물 구역의 빈 밭에 다가가 E 키로 심어 보세요.' });
      }
    }
    for (const c of Object.values(G.data.crops || {})) {
      if (c.harvestItem === id) out.push({ icon: '🧺', text: `${c.name} 밭에서 수확해 얻을 수 있어요.` });
    }
    for (const cr of Object.values(G.data.crafts || {})) {
      if (cr.in?.[id]) out.push({ icon: cr.icon || '🛠️', text: `작업대 「${cr.name}」 재료 · ${cr.in[id]}개 필요` });
      if (cr.out?.[id]) out.push({ icon: cr.icon || '🛠️', text: `작업대 「${cr.name}」${particle(cr.name, '으로/로')} 만들 수 있어요.` });
    }
    for (const r of Object.values(G.data.recipes || {})) {
      if (r.ingredients?.[id]) out.push({ icon: r.icon || '🏺', text: `장독 「${r.name}」 재료 · ${r.ingredients[id]}개 필요` });
      if (r.resultItem === id) out.push({ icon: r.icon || '🏺', text: `장독 「${r.name}」${particle(r.name, '을/를')} 완성하면 얻을 수 있어요.` });
    }
    return out;
  }

  function shopSells(shopId, id) { return !!G.data.shops?.[shopId]?.sells?.includes(id); }
  function canSellTo(shop, it) { return !!shop && !!it && (it.sell || 0) > 0 && (shop.buysTypes || []).includes(it.type); }

  // ---------------------------------------------------------------- system
  const inventory = {
    name: 'inventory', order: 50, label: '가방',
    typeLabel: (t) => TYPE_LABEL[t] || '기타',
    _new: new Set(),            // item ids added since the bag was last opened (badge + NEW dot)
    _shopId: null,
    _invModal: null, _invTab: 'all', _invSel: null,
    _shopModal: null, _shopTab: 'buy', _shopFilter: 'all', _qty: {},
    _kidWalk: 0, _kidAsk: false,
    _refreshQueued: false,
    _offs: [],

    init() {
      G.ui.onAction('inventory', () => this.toggle());
      G.input?.onKey?.('KeyI', () => { this.toggle(); return true; }, { allowInModal: true });
      // keep modals in sync when other systems change the bag or coins
      const sync = () => this._queueRefresh();
      this._offs.push(G.bus.on('item:added', sync), G.bus.on('item:removed', sync), G.bus.on('reward:granted', sync));
      this._offs.push(G.bus.on('world:object', ({ id, obj }) => {
        if ((id === 'SHOP_STALL' || id === 'B_SHOP') && obj) { try { G.interact?.setObject?.('SHOP_STALL', obj); } catch (e) { /* optional */ } }
      }));
      // easy <-> normal at runtime: the open bag / shop belong to the other look, close them (the HUD reopens them)
      this._offs.push(G.bus.on('easy:changed', () => this._closeAll()));
    },

    _closeAll() {
      for (const id of KID_MODALS) G.ui.modal.get(id)?.close();
      this._invModal?.close();
      this._shopModal?.close();
    },

    postInit() {
      // shop stall interactable (kind 'shop') — the props/buildings modules only build the mesh
      const s = G.data.layout?.shopStall;
      if (!s || !G.interact?.register) return;
      const pos = new THREE.Vector3(s.x, 0, s.z);
      let yReady = false;
      const obj = G.world.getObject('SHOP_STALL') || G.world.getObject('B_SHOP') || null;
      G.interact.register({
        id: 'SHOP_STALL', kind: 'shop', radius: 3.4, priority: 1,
        label: () => `${G.data.shops?.[s.shop || 'SHOP_GENERAL']?.name || '매점'} 이용하기`,
        position: () => { if (!yReady) { pos.y = G.world.heightAt(s.x, s.z) + 1.1; yReady = true; } return pos; },
        object: obj,
        onInteract: () => this.openShop(s.shop || 'SHOP_GENERAL'),
      });
    },

    onStateLoaded(state) {
      if (!state.inventory || typeof state.inventory !== 'object' || Array.isArray(state.inventory)) state.inventory = {};
      // sanitize: positive integers capped at the item max (unknown ids are kept for newer data versions)
      for (const [id, q] of Object.entries(state.inventory)) {
        const n = Math.floor(Number(q));
        if (!(n > 0)) delete state.inventory[id];
        else state.inventory[id] = Math.min(n, itemOf(id)?.max || 999);
      }
      this._new.clear();
      G.ui.setBadge('inventory', 0);
      this._kidWalk++; this._kidAsk = false;
      this._closeAll();
    },

    onLogout() {
      this._new.clear();
      G.ui.setBadge('inventory', 0);
      this._kidWalk++; this._kidAsk = false;
      this._closeAll();
    },

    // ------------------------------------------------------------ core API
    count(itemId) { return Number(G.state?.inventory?.[itemId]) || 0; },
    has(itemId, qty = 1) { return this.count(itemId) >= qty; },
    /** how many more of itemId fit in the bag (0 = that stack is full; harvest / jar / craft check it before using things up) */
    room(itemId) {
      const it = itemOf(itemId);
      if (!it || !G.state) return 0;
      return Math.max(0, (it.stack === false ? 1 : (it.max || 999)) - this.count(itemId));
    },
    /** the "가방이 꽉 찼어요" notice for itemId (kid words in 쉬운 모드) */
    fullNotice(itemId) {
      const it = itemOf(itemId);
      if (!it) return;
      const max = it.stack === false ? 1 : (it.max || 999);
      if (easyOn()) G.progToast(`가방에 ${kjosa(it.name, '이/가')} 꽉 찼어요! 가게에 팔고 와요.`, { type: 'warn', emoji: '🎒', say: `가방에 ${kjosa(it.name, '이/가')} 꽉 찼어요! 가게에 팔고 와요.` });
      else G.progToast(`${josa(it.name, '은/는')} 더 이상 가질 수 없어요. (최대 ${fmt(max)}개) 매점에 판 뒤 다시 해 주세요.`, { type: 'warn' });
    },
    list(type) {
      const inv = G.state?.inventory || {};
      const out = [];
      for (const [id, q] of Object.entries(inv)) {
        const it = itemOf(id);
        if (!it || !(q > 0)) continue;
        if (type && (Array.isArray(type) ? !type.includes(it.type) : it.type !== type)) continue;
        out.push({ id, item: it, qty: q });
      }
      return sortEntries(out);
    },

    add(itemId, qty = 1, opts = {}) {
      const it = itemOf(itemId);
      if (!it) { G.log.warn('INVENTORY', `unknown item "${itemId}"`); return 0; }
      if (!G.state) return 0;
      qty = Math.floor(Number(qty));
      if (!(qty > 0)) return 0;
      const inv = G.state.inventory || (G.state.inventory = {});
      const cur = Number(inv[itemId]) || 0;
      const max = it.stack === false ? 1 : (it.max || 999);
      const added = Math.max(0, Math.min(qty, max - cur));
      if (!added) {
        if (!opts.silent) G.progToast(easyOn() ? `가방에 ${kjosa(it.name, '이/가')} 꽉 찼어요!` : `${josa(it.name, '은/는')} 더 이상 가질 수 없어요. (최대 ${fmt(max)}개)`, { type: 'warn', emoji: easyOn() ? '🎒' : undefined });
        return 0;
      }
      inv[itemId] = cur + added;
      const source = opts.source || 'unknown';
      G.log.info('INVENTORY', `+${added} ${itemId} (${source}) -> ${inv[itemId]}`);
      if (!this._invModal) { this._new.add(itemId); G.ui.setBadge('inventory', this._new.size); }
      G.dirty('inventory');
      G.bus.emit('item:added', { itemId, qty: added, source });
      if (!opts.silent) {
        G.progToast(easyOn() ? `${it.name} ${fmt(added)}개 받았어요!` : `+${it.name} ×${fmt(added)}`, { emoji: it.icon, type: 'success', sound: !QUIET_SOURCES.test(source), cls: 'item-toast' });
        if (added < qty) G.progToast(easyOn() ? '가방이 꽉 찼어요!' : `가방이 가득 차서 ${fmt(added)}개만 받았어요.`, { type: 'warn' });
      }
      this._queueRefresh();
      return added;
    },

    remove(itemId, qty = 1, opts = {}) {
      if (!G.state) return false;
      qty = Math.floor(Number(qty));
      if (!(qty > 0)) return false;
      const inv = G.state.inventory || {};
      const cur = Number(inv[itemId]) || 0;
      if (cur < qty) return false;
      const left = cur - qty;
      if (left > 0) inv[itemId] = left; else { delete inv[itemId]; this._new.delete(itemId); }
      G.log.info('INVENTORY', `-${qty} ${itemId} (${opts.source || 'use'}) -> ${left}`);
      G.dirty('inventory');
      G.bus.emit('item:removed', { itemId, qty, source: opts.source || 'use' });
      if (!this._invModal) G.ui.setBadge('inventory', this._new.size);
      this._queueRefresh();
      return true;
    },

    // ------------------------------------------------------------ bag modal
    toggle(tab) {
      if (this._invModal && G.ui.modal.top() === this._invModal) { this._invModal.close(); return; }
      if (G.ui.isBlocking() && !this._invModal) {
        // another modal / dialogue is in front: only open over plain modals, not dialogue or rewards
        if (G.ui.blockers && [...G.ui.blockers].some((k) => !String(k).startsWith('modal:'))) return;
      }
      this.open(tab);
    },
    close() { this._invModal?.close(); },

    open(tab, opts = {}) {
      if (!G.state) return null;
      if (easyOn() && !opts.normal) return this._openKidBag(opts);
      if (tab && TABS.some((t) => t.id === tab)) this._invTab = tab;
      else if (tab && TYPE_LABEL[tab]) this._invTab = TABS.find((t) => t.types?.includes(tab))?.id || 'all';
      if (opts.select) this._invSel = opts.select;
      const newSet = new Set(this._new);
      this._new.clear();
      G.ui.setBadge('inventory', 0);
      const coinChip = G.ui.h('span', { class: 'chip chip-gold inv-coin', title: '보유 코인' });
      const m = G.ui.modal.open({
        id: 'inventory', title: '가방', icon: 'bag', size: 'lg', className: 'inv-modal',
        headExtra: coinChip,
        body: (body) => {
          body.innerHTML = '<div class="inv-tabs"></div><div class="inv-layout"><div class="inv-main"><div class="inv-grid" role="listbox" aria-label="아이템 목록"></div><div class="inv-foot"></div></div><aside class="inv-detail" aria-live="polite"></aside></div>';
        },
        onClose: () => { if (this._invModal === m) this._invModal = null; G.ui.setActive('inventory', false); },
      });
      m._newSet = newSet;
      m._coinChip = coinChip;
      this._invModal = m;
      G.ui.setActive('inventory', true);
      this._renderInv();
      return m;
    },

    _renderInv() {
      const m = this._invModal;
      if (!m || m.closed || !G.state) return;
      if (m._kid) { this._renderKidBag(); return; }
      const body = m.body;
      m._coinChip.innerHTML = `${coinIco()}${fmt(coins())}`;
      G.ui.hydrateIcons(m._coinChip);
      const all = this.list();
      // tabs with counts
      const tabsEl = body.querySelector('.inv-tabs');
      const counts = {};
      for (const t of TABS) counts[t.id] = t.types ? all.filter((e) => t.types.includes(e.item.type)).length : all.length;
      if (!tabsEl._built) {
        tabsEl._built = true;
        tabsEl._api = G.ui.tabs(tabsEl, TABS.map((t) => ({ id: t.id, label: t.label })), (id) => { this._invTab = id; this._renderInvGrid(); }, this._invTab);
      }
      for (const b of tabsEl.querySelectorAll('.tab')) {
        const t = TABS.find((x) => x.id === b.dataset.tab);
        let c = b.querySelector('.tab-count');
        if (!c) { c = G.ui.h('span', { class: 'tab-count' }); b.appendChild(c); }
        c.textContent = String(counts[t.id] || 0);
      }
      this._renderInvGrid();
    },

    _renderInvGrid() {
      const m = this._invModal;
      if (!m || m.closed || m._kid) return;
      const body = m.body;
      const tab = TABS.find((t) => t.id === this._invTab) || TABS[0];
      const list = tab.types ? this.list(tab.types) : this.list();
      const grid = body.querySelector('.inv-grid');
      if (this._invSel && !list.some((e) => e.id === this._invSel)) this._invSel = null;
      if (!this._invSel && list.length) this._invSel = list[0].id;
      const scroll = grid.scrollTop;
      grid.innerHTML = '';
      for (const e of list) {
        const btn = G.ui.h('button', {
          type: 'button', role: 'option', class: `slot inv-slot t-${e.item.type}${e.id === this._invSel ? ' selected' : ''}${m._newSet?.has(e.id) ? ' is-new' : ''}`,
          'aria-selected': e.id === this._invSel ? 'true' : 'false', title: e.item.name, dataset: { id: e.id },
        },
        G.ui.h('span', { class: 'emoji' }, e.item.icon || '❔'),
        G.ui.h('span', { class: 'slot-name' }, e.item.name),
        e.qty > 1 || e.item.type !== 'tool' ? G.ui.h('span', { class: 'qty' }, `×${fmt(e.qty)}`) : null);
        btn.addEventListener('click', () => { this._invSel = e.id; m._newSet?.delete(e.id); this._renderInvGrid(); });
        btn.addEventListener('dblclick', () => this._primaryAction(e.id));
        grid.appendChild(btn);
      }
      const filler = Math.max(MIN_GRID - list.length, (6 - (list.length % 6)) % 6);
      for (let i = 0; i < filler; i++) grid.appendChild(G.ui.h('div', { class: 'slot inv-empty', 'aria-hidden': 'true' }));
      grid.scrollTop = scroll;
      if (!list.length) {
        const msg = G.ui.h('div', { class: 'inv-empty-msg' }, tab.id === 'all' ? '가방이 비어 있어요.' : `${tab.label} 아이템이 없어요.`);
        grid.prepend(msg);
      }
      // footer summary
      const totalKinds = this.list().length;
      const totalQty = this.list().reduce((s, e) => s + e.qty, 0);
      body.querySelector('.inv-foot').innerHTML = `<span>보유 아이템 <b>${fmt(totalKinds)}</b>종 · <b>${fmt(totalQty)}</b>개</span>${this._shopId ? '<span class="chip chip-gold">매점 이용 중 · 바로 팔 수 있어요</span>' : '<span class="muted">아이템을 누르면 자세한 정보가 보여요</span>'}`;
      this._renderInvDetail();
    },

    _renderInvDetail() {
      const m = this._invModal;
      if (!m || m.closed || m._kid) return;
      const pane = m.body.querySelector('.inv-detail');
      pane.innerHTML = '';
      const id = this._invSel;
      const it = itemOf(id);
      if (!it) {
        pane.appendChild(G.ui.h('div', { class: 'inv-detail-empty' }, G.ui.h('span', { class: 'emoji' }, '🎒'), G.ui.h('p', {}, '아이템을 선택하면 자세한 정보가 표시돼요.')));
        return;
      }
      const qty = this.count(id);
      const shop = this._shopId ? G.data.shops?.[this._shopId] : null;
      const head = G.ui.h('div', { class: 'inv-d-head' },
        G.ui.h('div', { class: `inv-d-icon t-${it.type}` }, G.ui.h('span', { class: 'emoji' }, it.icon || '❔')),
        G.ui.h('div', { class: 'inv-d-name' }, G.ui.h('h3', {}, it.name), G.ui.h('span', { class: `chip ${TYPE_CHIP[it.type] || ''}` }, TYPE_LABEL[it.type] || '기타')));
      pane.appendChild(head);
      pane.appendChild(G.ui.h('p', { class: 'inv-d-desc' }, it.desc || ''));
      const kv = [`<dt>보유</dt><dd>${fmt(qty)}개</dd>`];
      if ((it.sell || 0) > 0) kv.push(`<dt>판매가</dt><dd class="gold">${coinIco()} ${fmt(it.sell)}</dd>`);
      else kv.push('<dt>판매</dt><dd class="muted">팔 수 없음</dd>');
      if ((it.price || 0) > 0 && Object.keys(G.data.shops || {}).some((s) => shopSells(s, id))) kv.push(`<dt>매점 가격</dt><dd>${coinIco()} ${fmt(it.price)}</dd>`);
      pane.appendChild(G.ui.h('dl', { class: 'kv inv-d-kv', html: kv.join('') }));
      const uses = usesOf(id);
      if (uses.length) {
        pane.appendChild(G.ui.h('h4', { class: 'inv-d-sub' }, '쓰임새'));
        pane.appendChild(G.ui.h('ul', { class: 'inv-d-uses' }, uses.map((u) => G.ui.h('li', {}, G.ui.h('span', { class: 'emoji' }, u.icon), G.ui.h('span', {}, u.text)))));
      }
      if (it.type === 'decoration') pane.appendChild(G.ui.h('div', { class: 'notice-box' }, '장식 아이템은 앞으로 열릴 ‘장독대 꾸미기’에서 사용할 수 있어요. 그때까지 가방에 모아 두거나 매점에 되팔 수 있어요.'));
      if (it.type === 'fermented') pane.appendChild(G.ui.h('div', { class: 'notice-box info small' }, G.data.meta?.disclaimer || ''));
      if (it.type === 'tool') pane.appendChild(G.ui.h('div', { class: 'notice-box info' }, '도구는 가방에 있으면 체험할 때 자동으로 사용돼요.'));
      if (it.type === 'quest') pane.appendChild(G.ui.h('div', { class: 'notice-box info' }, '퀘스트 아이템은 버리거나 팔 수 없어요.'));

      const actions = G.ui.h('div', { class: 'inv-d-actions' });
      if (id === 'ITEM_GUIDEBOOK') actions.appendChild(G.ui.h('button', { class: 'btn btn-primary btn-block', onclick: () => this.openGuide() }, G.ui.h('span', { class: 'ico ico-sm', 'data-icon': 'book' }), '안내서 읽기'));
      if (shop && canSellTo(shop, it) && qty > 0) {
        const total = G.ui.h('b', { class: 'gold' });
        const sellBtn = G.ui.h('button', { class: 'btn btn-gold btn-block' });
        const st = stepper(1, 1, qty, (n) => upd(n));
        const upd = (n) => { total.innerHTML = `${coinIco()} ${fmt(n * it.sell)}`; G.ui.hydrateIcons(total); sellBtn.textContent = `${fmt(n)}개 팔기`; };
        upd(1);
        sellBtn.addEventListener('click', () => { this.sell(id, st.value); });
        actions.append(G.ui.h('div', { class: 'inv-sell-row' }, st.el, total), sellBtn);
      } else if (!shop && canSellTo(Object.values(G.data.shops || {})[0], it)) {
        actions.appendChild(G.ui.h('p', { class: 'tiny muted' }, '입구의 매점에서 팔 수 있어요.'));
      }
      pane.appendChild(actions);
      G.ui.hydrateIcons(pane);
    },

    _primaryAction(id) {
      if (id === 'ITEM_GUIDEBOOK') return this.openGuide();
      const it = itemOf(id);
      if (this._shopId && canSellTo(G.data.shops?.[this._shopId], it)) return this.sell(id, 1);
    },

    // ------------------------------------------------------------ 쉬운 모드: picture bag
    _openKidBag(opts = {}) {
      G.ui.modal.get('inv-item')?.close(); // never leave a stale item card behind the reopened bag
      const newSet = new Set(this._new);
      this._new.clear();
      G.ui.setBadge('inventory', 0);
      const coinChip = KK.coinChip();
      const m = G.ui.modal.open({
        id: 'inventory', title: '내 가방', icon: '🎒', size: 'lg', className: 'inv-modal kk-bag-modal',
        say: '내 가방이에요. 그림을 눌러 봐요.', headExtra: coinChip,
        body: (body) => { body.appendChild(G.ui.h('div', { class: 'kbag-wrap' })); },
        actions: [],
        onClose: () => { if (this._invModal === m) this._invModal = null; G.ui.setActive('inventory', false); },
      });
      m._kid = true;
      m._newSet = newSet;
      m._coinChip = coinChip;
      this._invModal = m;
      G.ui.setActive('inventory', true);
      // one obvious way out of the bag besides ⬅️: walk to the shop (hidden while a shop is open)
      if (!this._shopId && G.data.layout?.shopStall && G.easy?.goTo) {
        const go = G.ui.h('button', { type: 'button', class: 'easy-big-btn kbag-shop-btn', 'data-say': '가게에 같이 가요.' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🛒'), G.ui.h('span', null, '가게 가기'));
        go.addEventListener('click', () => this._kidGoShop('buy'));
        m.foot.appendChild(go);
      }
      this._renderKidBag();
      if (opts.select && itemOf(opts.select)) setTimeout(() => { if (!m.closed) this.openItem(opts.select); }, 0);
      return m;
    },

    _renderKidBag() {
      const m = this._invModal;
      if (!m || m.closed || !m._kid || !G.state) return;
      m._coinChip.set(coins());
      const wrap = m.body.querySelector('.kbag-wrap');
      if (!wrap) return;
      const all = this.list();
      const first = !m._drawn;
      m._drawn = true;
      const scroll = m.body.scrollTop;
      wrap.textContent = '';
      if (!all.length) {
        wrap.appendChild(KK.empty('🎒', '가방이 비어 있어요.', '밭에서 채소를 거둬 봐요!'));
        return;
      }
      let i = 0;
      for (const type of TYPE_ORDER) {
        const list = all.filter((e) => e.item.type === type);
        if (!list.length) continue;
        const kt = KID_TYPE[type] || KID_TYPE.quest;
        wrap.appendChild(KK.vars(G.ui.h('h3', { class: 'kk-sec' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, kt.emoji), kt.label), { '--sec': kt.color }));
        const grid = G.ui.h('div', { class: 'kk-grid kbag-grid', role: 'list' });
        for (const e of list) grid.appendChild(this._kidSlot(e, kt, first ? i++ : -1, !!m._newSet?.has(e.id)));
        KK.gridKeys(grid);
        wrap.appendChild(grid);
      }
      m.body.scrollTop = scroll;
    },

    _kidSlot(e, kt, i, isNew) {
      const showCount = e.qty > 1 || (e.item.type !== 'tool' && e.item.type !== 'quest');
      const b = G.ui.h('button', {
        type: 'button', role: 'listitem', class: `easy-tile kk-tile kbag-tile${i < 0 ? ' still' : ''}${isNew ? ' is-new' : ''}`,
        'aria-label': `${e.item.name} ${e.qty}개`, dataset: { id: e.id },
      },
      G.ui.h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, e.item.icon || '❔'),
      G.ui.h('span', { class: 'et-label' }, e.item.name),
      showCount ? G.ui.h('span', { class: 'et-badge' }, fmt(e.qty)) : null,
      isNew ? G.ui.h('span', { class: 'kk-new', 'aria-hidden': 'true' }, '새것') : null);
      b.style.setProperty('--tile', kt.color);
      if (i >= 0) b.style.setProperty('--i', String(Math.min(i, 18)));
      b.__easySpeak = { btn: null, text: `${e.item.name}. ${fmt(e.qty)}개 있어요.` };
      b.addEventListener('click', () => { this._invModal?._newSet?.delete(e.id); this.openItem(e.id); });
      return b;
    },

    /** kid item card: big picture, short name, 🔊, big emoji actions */
    openItem(id) {
      const it = itemOf(id);
      if (!it || !G.state) return null;
      if (!easyOn()) return this.open('all', { select: id, normal: true });
      const qty = this.count(id);
      if (qty < 1) return null;
      const kt = KID_TYPE[it.type] || KID_TYPE.quest;
      const shop = this._shopId ? G.data.shops?.[this._shopId] : null;
      const desc = kidDesc(it);
      const close = () => G.ui.modal.get('inv-item')?.close();
      const acts = [];
      const add = (emoji, label, cls, fn, sayLine) => acts.push({ emoji, label, cls, fn, sayLine });
      let note = null;
      if (it.type === 'seed' && it.crop) {
        if (emptyPlotFor(it.crop)) add('🌱', '심기', 'easy-btn-yes', () => { close(); this._kidPlant(id); }, '빈 밭에 같이 가서 심어요.');
        else {
          note = G.data.crops?.[it.crop]?.category === 'herb' ? '🌿 빈 허브밭이 없어요. 다 자란 허브를 먼저 거둬요!' : '🌾 빈 밭이 없어요. 다 자란 채소를 먼저 거둬요!';
          add('🌱', '심기', 'easy-btn-no is-off', (btn) => { KK.shake(btn); KK.say(note, { force: true }); }, '빈 밭이 없어요.');
        }
      }
      if (it.type === 'decoration' && G.sys.engagement?.open) add('🏡', '꾸미기', 'easy-btn-yes', () => { this._closeAll(); G.sys.engagement.open('decor'); }, '내 마당을 꾸며요.');
      if (id === 'ITEM_GUIDEBOOK') add('📖', '보기', 'easy-btn-yes', () => { close(); this.openGuide(); }, '안내서를 봐요.');
      if (canSellTo(shop || G.data.shops?.SHOP_GENERAL, it)) {
        if (shop) add('💰', '팔기', 'kitem-sell', () => this._kidSell(id), `팔면 코인 ${it.sell}개를 받아요.`);
        else if (G.data.layout?.shopStall && G.easy?.goTo) add('🛒', '팔러 가기', 'kitem-sell', () => this._kidGoShop('sell'), '가게에 가서 팔아요.');
      }
      add('✖', '닫기', 'easy-btn-no', () => close(), '닫아요.');
      const btns = G.ui.h('div', { class: `kitem-btns n${Math.min(acts.length, 3)}` });
      for (const a of acts) {
        const b = G.ui.h('button', { type: 'button', class: `easy-big-btn ${a.cls}`, 'data-say': a.sayLine || a.label }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, a.emoji), G.ui.h('span', null, a.label));
        b.addEventListener('click', () => { try { a.fn(b); } catch (e) { G.log.error('INVENTORY', 'kid item action', e); } });
        btns.appendChild(b);
      }
      const count = G.ui.h('span', { class: 'kitem-count' }, `${fmt(qty)}개`);
      const art = KK.vars(G.ui.h('div', { class: 'kitem-art' },
        G.ui.h('span', { class: 'kitem-rays', 'aria-hidden': 'true' }),
        G.ui.h('span', { class: 'kitem-emoji emoji', 'aria-hidden': 'true' }, it.icon || '❔'), count), { '--tile': kt.color });
      const body = G.ui.h('div', { class: 'kitem' }, art,
        KK.vars(G.ui.h('div', { class: 'kitem-type' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, kt.emoji), kt.label), { '--tile': kt.color }),
        G.ui.h('p', { class: 'kitem-desc' }, desc),
        it.type === 'fermented' ? G.ui.h('p', { class: 'kitem-note' }, '게임 속 체험이에요.') : null,
        note ? G.ui.h('p', { class: 'kitem-hint' }, note) : null,
        btns);
      const m = G.ui.modal.open({ id: 'inv-item', title: it.name, icon: it.icon || '🎒', size: 'sm', className: 'kk-card-modal', say: `${it.name}. ${fmt(qty)}개 있어요. ${desc}`, body, actions: [] });
      m._itemId = id;
      m._count = count;
      setTimeout(() => { if (!m.closed) btns.querySelector('button')?.focus({ preventScroll: true }); }, 60);
      return m;
    },

    /** 🌱 심기: walk to the nearest empty bed for this seed, then plant it there */
    async _kidPlant(seedId) {
      const it = itemOf(seedId);
      const cropId = it?.crop;
      const plot = emptyPlotFor(cropId);
      if (!plot) { G.easy?.alert?.({ emoji: '🌱', heading: '심기', title: '빈 밭이 없어요', text: '다 자란 채소를 먼저 거둬요!' }); return false; }
      if (!G.easy?.goTo) return false;
      // the newest walk wins: a later tap (or the joystick) replaces this one and its arrival is ignored
      const token = ++this._kidWalk;
      const st = G.state;
      try {
        this._closeAll();
        const pt = approachPoint(plot);
        const ok = await G.easy.goTo({ x: pt.x, z: pt.z }, { label: '빈 밭', stopDistance: 1.0 });
        if (!ok || token !== this._kidWalk || !G.state || G.state !== st || !this.has(seedId)) return false;
        const target = emptyPlotFor(cropId)?.id === plot.id ? plot : emptyPlotFor(cropId);
        if (!target) { KK.say('앗, 빈 밭이 없어졌어요.', { force: true }); return false; }
        return !!G.sys.farming?.plant?.(target.id, cropId);
      } catch (e) {
        G.log.warn('INVENTORY', 'kid plant failed', e);
        return false;
      }
    },

    /** walk to the shop stall and open the picture shop on a tab */
    async _kidGoShop(tab = 'buy') {
      const s = G.data.layout?.shopStall;
      if (!s || !G.easy?.goTo) return false;
      const token = ++this._kidWalk;
      const st = G.state;
      this._closeAll();
      const ok = await G.easy.goTo({ x: s.x, z: s.z }, { label: '가게', stopDistance: 3.2 });
      if (!ok || token !== this._kidWalk || !G.state || G.state !== st) return false;
      this._shopTab = tab;
      return !!this.openShop(s.shop || 'SHOP_GENERAL');
    },

    // ------------------------------------------------------------ 쉬운 모드: picture shop
    _openKidShop(shopId, shop) {
      this._qty = {};
      const coinChip = KK.coinChip();
      const greet = (G.sys.weather?.hour >= 20 || G.sys.weather?.hour < 5) ? '늦게까지 노네요! 천천히 골라요.' : '어서 와요! 무엇을 살까요?';
      const m = G.ui.modal.open({
        id: 'shop', title: '가게', icon: '🛒', size: 'lg', className: 'shop-modal kk-shop-modal', headExtra: coinChip, say: greet,
        body: (body) => {
          const tabs = G.ui.h('div', { class: 'kk-seg', role: 'tablist' });
          for (const t of [{ id: 'buy', emoji: '🛍️', label: '사기' }, { id: 'sell', emoji: '💰', label: '팔기' }]) {
            const b = G.ui.h('button', { type: 'button', role: 'tab', class: 'kk-seg-btn', dataset: { tab: t.id }, 'data-say': t.id === 'buy' ? '물건을 사요.' : '물건을 팔아요.' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji), G.ui.h('span', null, t.label));
            b.addEventListener('click', () => { if (this._shopTab !== t.id) { this._shopTab = t.id; this._renderKidShop(); KK.say(t.id === 'buy' ? '무엇을 살까요?' : '무엇을 팔까요?', { force: false }); } });
            tabs.appendChild(b);
          }
          body.append(
            G.ui.h('div', { class: 'kshop-greet' }, G.ui.h('span', { class: 'kshop-clerk emoji', 'aria-hidden': 'true' }, '🧑‍💼'), G.ui.h('p', { class: 'kshop-bubble' }, greet)),
            tabs, G.ui.h('div', { class: 'kshop-wrap' }));
        },
        actions: [],
        onClose: () => { if (this._shopModal === m) { this._shopModal = null; this._shopId = null; this._queueRefresh(); } },
      });
      m._kid = true;
      m._coinChip = coinChip;
      this._shopModal = m;
      this._shopId = shopId;
      if (this._shopTab !== 'sell') this._shopTab = 'buy';
      this._renderKidShop();
      G.log.info('INVENTORY', `shop open ${shopId} (easy)`);
      G.activity('shop', `${shop.name} 방문`);
      return m;
    },

    _renderKidShop() {
      const m = this._shopModal;
      if (!m || m.closed || !m._kid || !G.state) return;
      const shop = G.data.shops?.[this._shopId];
      if (!shop) return;
      m._coinChip.set(coins());
      for (const b of m.body.querySelectorAll('.kk-seg-btn')) { const on = b.dataset.tab === this._shopTab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      const bubble = m.body.querySelector('.kshop-bubble');
      if (bubble && m._drawnTab !== this._shopTab && m._drawnTab) bubble.textContent = this._shopTab === 'sell' ? '무엇을 팔까요? 그림을 눌러요.' : '무엇을 살까요? 그림을 눌러요.';
      const wrap = m.body.querySelector('.kshop-wrap');
      if (!wrap) return;
      const key = this._shopTab;
      const first = m._drawnTab !== key;
      m._drawnTab = key;
      const scroll = first ? 0 : m.body.scrollTop;
      wrap.textContent = '';
      const grid = G.ui.h('div', { class: 'kk-grid kshop-grid', role: 'list' });
      let i = 0;
      if (key === 'buy') {
        for (const id of shop.sells || []) {
          const it = itemOf(id);
          if (!it) continue;
          const owned = this.count(id);
          const have = it.type === 'tool' && owned > 0;
          const poor = !have && coins() < (it.price || 0);
          const kt = KID_TYPE[it.type] || KID_TYPE.quest;
          const b = G.ui.h('button', {
            type: 'button', role: 'listitem', class: `easy-tile kk-tile kshop-tile${first ? '' : ' still'}${have ? ' is-disabled' : ''}${poor ? ' is-poor' : ''}`,
            'aria-label': `${it.name} 코인 ${it.price}개${have ? ', 이미 있어요' : ''}`,
          },
          G.ui.h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, it.icon || '❔'),
          G.ui.h('span', { class: 'et-label' }, it.name),
          G.ui.h('span', { class: 'et-sub kshop-price' }, have ? '✅ 있어요' : `🪙 ${fmt(it.price || 0)}`),
          owned > 0 && !have ? G.ui.h('span', { class: 'et-badge', title: '가방에 있는 개수' }, fmt(owned)) : null);
          b.style.setProperty('--tile', kt.color);
          if (first) b.style.setProperty('--i', String(Math.min(i++, 18)));
          b.__easySpeak = { btn: null, text: have ? `${it.name}. 벌써 있어요.` : `${it.name}. 코인 ${it.price}개예요.` };
          b.addEventListener('click', () => {
            if (have) { KK.shake(b); KK.say(`${kjosa(it.name, '은/는')} 벌써 있어요!`, { force: true }); return; }
            if (coins() < (it.price || 0)) { this._kidPoor(it); return; }
            this._kidBuy(id);
          });
          grid.appendChild(b);
        }
        wrap.appendChild(grid);
      } else {
        const sellable = this.list().filter((e) => canSellTo(shop, e.item));
        if (!sellable.length) { wrap.appendChild(KK.empty('🧺', '팔 물건이 없어요.', '밭에서 채소를 거둬 와요!')); return; }
        for (const e of sellable) {
          const kt = KID_TYPE[e.item.type] || KID_TYPE.quest;
          const b = G.ui.h('button', { type: 'button', role: 'listitem', class: `easy-tile kk-tile kshop-tile${first ? '' : ' still'}`, 'aria-label': `${e.item.name} ${e.qty}개, 하나에 코인 ${e.item.sell}개` },
            G.ui.h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, e.item.icon || '❔'),
            G.ui.h('span', { class: 'et-label' }, e.item.name),
            G.ui.h('span', { class: 'et-sub kshop-price sell' }, `+🪙 ${fmt(e.item.sell)}`),
            G.ui.h('span', { class: 'et-badge' }, fmt(e.qty)));
          b.style.setProperty('--tile', kt.color);
          if (first) b.style.setProperty('--i', String(Math.min(i++, 18)));
          b.__easySpeak = { btn: null, text: `${e.item.name}. 팔면 코인 ${e.item.sell}개를 받아요.` };
          b.addEventListener('click', () => this._kidSell(e.id));
          grid.appendChild(b);
        }
        wrap.appendChild(grid);
        wrap.appendChild(G.ui.h('p', { class: 'kshop-note' }, '🌱 씨앗과 🧰 도구는 팔 수 없어요.'));
      }
      KK.gridKeys(grid);
      m.body.scrollTop = scroll;
    },

    /** one tap + a picture confirm -> buy 1 */
    async _kidBuy(id) {
      const it = itemOf(id);
      if (!it || this._kidAsk) return false;
      this._kidAsk = true;
      try {
        const ok = await G.easy.confirm({ emoji: it.icon || '🛍️', heading: '사기', title: `${kjosa(it.name, '을/를')} 살까요?`, text: `🪙 ${fmt(it.price || 0)}`, say: `${kjosa(it.name, '을/를')} 살까요? 코인 ${it.price}개예요.`, yes: '살래요', no: '안 살래요' });
        if (!ok || !G.state || !this._shopModal) return false;
        if (coins() < (it.price || 0)) { this._kidPoor(it); return false; }
        return this.buy(id, 1);
      } finally { this._kidAsk = false; }
    },

    async _kidSell(id) {
      const it = itemOf(id);
      const shop = G.data.shops?.[this._shopId];
      if (!it || !canSellTo(shop, it) || this.count(id) < 1 || this._kidAsk) return false;
      this._kidAsk = true;
      try {
        const ok = await G.easy.confirm({ emoji: it.icon || '💰', heading: '팔기', title: `${it.name} 1개를 팔까요?`, text: `+🪙 ${fmt(it.sell)}`, say: `${it.name} 하나를 팔면 코인 ${it.sell}개를 받아요. 팔까요?`, yes: '팔래요', no: '안 팔래요' });
        if (!ok || !G.state || !this._shopId) return false;
        return this.sell(id, 1); // an open item card follows the new count via _queueRefresh
      } finally { this._kidAsk = false; }
    },

    /** friendly "not enough coins" path (never a red error) */
    async _kidPoor(it) {
      const shop = G.data.shops?.[this._shopId];
      const need = Math.max(1, (it.price || 0) - coins());
      const canSell = !!shop && this.list().some((e) => canSellTo(shop, e.item));
      G.log.info('INVENTORY', `kid shop: ${it.id} needs ${need} more coins`);
      if (canSell) {
        const go = await G.easy.confirm({ emoji: '🪙', heading: '앗!', title: '🪙가 조금 모자라요', text: '물건을 팔면 🪙가 생겨요. 팔아 볼까요?', say: '코인이 조금 모자라요. 물건을 팔아 볼까요?', yes: '팔러 가기', no: '괜찮아요' });
        if (go && this._shopModal) { this._shopTab = 'sell'; this._renderKidShop(); }
      } else {
        await G.easy.alert({ emoji: '🪙', heading: '앗!', title: '🪙가 조금 모자라요', text: '밭에서 채소를 거둬서 팔면 🪙가 생겨요!', say: '코인이 조금 모자라요. 밭에서 채소를 거둬서 팔면 코인이 생겨요!' });
      }
    },

    /** 쉬운 모드 안내서: five picture steps + 🗺️ 어디 갈까? */
    _openKidGuide() {
      const steps = [
        { emoji: '👋', text: '발효마스터랑 인사해요', color: '#ff8a5c' },
        { emoji: '💧', text: '밭에 물을 줘요', color: '#4fb3ff' },
        { emoji: '🏺', text: '반짝이는 장독을 봐요', color: '#ffc93c' },
        { emoji: '📖', text: '그림 이야기를 봐요', color: '#b48bff' },
        { emoji: '📝', text: '그림일기를 써요', color: '#55d187' },
      ];
      const grid = G.ui.h('ol', { class: 'kk-grid kguide-steps' });
      steps.forEach((s, i) => {
        const b = G.ui.h('button', { type: 'button', class: 'easy-tile kk-tile kguide-step' },
          G.ui.h('span', { class: 'kguide-no', 'aria-hidden': 'true' }, String(i + 1)),
          G.ui.h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, s.emoji),
          G.ui.h('span', { class: 'et-label' }, s.text));
        b.style.setProperty('--tile', s.color);
        b.style.setProperty('--i', String(i));
        b.addEventListener('click', () => KK.say(`${i + 1}번. ${s.text}.`, { force: true }));
        grid.appendChild(G.ui.h('li', null, b));
      });
      KK.gridKeys(grid);
      const where = G.ui.h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes kguide-where', 'data-say': '어디로 갈지 골라요.' }, G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🗺️'), G.ui.h('span', null, '어디 갈까?'));
      const m = G.ui.modal.open({
        id: 'guidebook', title: '놀이 안내서', icon: '📘', size: 'lg', className: 'guide-modal kk-guide-modal',
        say: '이렇게 놀아요. 하나, 발효마스터랑 인사해요. 둘, 밭에 물을 줘요. 셋, 반짝이는 장독을 봐요. 넷, 그림 이야기를 봐요. 다섯, 그림일기를 써요.',
        body: G.ui.h('div', { class: 'kg' }, G.ui.h('p', { class: 'kguide-lead' }, '이렇게 놀아요!'), grid), actions: [],
      });
      where.addEventListener('click', () => { m.close(); this._closeAll(); if (G.ui.triggerAction) G.ui.triggerAction('where', where); else G.easy?.travelMenu?.(); });
      m.foot.appendChild(where);
      return m;
    },

    /** 체험관 안내서: zone list + experience order */
    openGuide() {
      if (easyOn()) return this._openKidGuide();
      const zones = (G.data.zones || []).map((z) => `<li><span class="guide-dot" style="background:${esc(z.color)}"></span><div><b>${esc(z.name)}</b><p>${esc(z.desc)}</p></div></li>`).join('');
      const steps = ['발효마스터와 인사하기', '전통작물 구역에서 물 주고 수확하기', '장독대에서 빛나는 내 장독 확인하기', '안내판·키오스크로 배우고 퀴즈 풀기', '작업일지(J)에 오늘의 체험 기록하기'];
      G.ui.modal.open({
        id: 'guidebook', title: '체험관 안내서', icon: '📘', size: 'md', className: 'guide-modal',
        body: `<p class="dim">${esc(G.data.meta?.title || '')} · ${esc(G.data.meta?.address || '')}</p>
          <h4 class="inv-d-sub">추천 체험 순서</h4><ol class="guide-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <h4 class="inv-d-sub">구역 안내</h4><ul class="guide-zones">${zones}</ul>
          <p class="tiny muted mt-1">${esc(G.data.meta?.addressNote || '')}</p>`,
        actions: [
          G.sys.minimap?.openWorldMap ? { label: '전체 지도 열기', icon: 'map', class: 'btn-soft', onClick: () => { G.sys.minimap.openWorldMap(); } } : null,
          { label: '닫기', class: 'btn-primary' },
        ].filter(Boolean),
      });
    },

    // ------------------------------------------------------------ shop
    closeShop() { this._shopModal?.close(); },

    openShop(shopId = 'SHOP_GENERAL') {
      const shop = G.data.shops?.[shopId];
      if (!shop) { G.log.warn('INVENTORY', `unknown shop ${shopId}`); return null; }
      if (!G.state) return null;
      if (easyOn()) return this._openKidShop(shopId, shop);
      this._qty = {};
      const npc = G.data.npcs?.[shop.npc];
      const coinChip = G.ui.h('span', { class: 'chip chip-gold inv-coin', title: '보유 코인' });
      const m = G.ui.modal.open({
        id: 'shop', title: shop.name, icon: '🛒', size: 'lg', className: 'shop-modal',
        headExtra: coinChip,
        body: (body) => {
          body.innerHTML = `<div class="shop-greet"><span class="emoji">🧑‍💼</span><div><b>${esc(npc?.name || '점원')}</b><p>${esc(this._greeting(shop))}</p></div></div>
            <div class="shop-tabs"></div><div class="shop-filters"></div><div class="shop-list" role="list"></div>`;
        },
        actions: [
          { label: '가방 보기', icon: 'bag', class: 'btn-soft', onClick: () => { this.open(this._shopTab === 'sell' ? 'all' : undefined); return false; } },
          { label: '닫기', class: 'btn-primary' },
        ],
        onClose: () => { if (this._shopModal === m) { this._shopModal = null; this._shopId = null; this._queueRefresh(); } },
      });
      m._coinChip = coinChip;
      // assign after open(): re-opening closes the previous shop modal, whose onClose resets these
      this._shopModal = m;
      this._shopId = shopId;
      this._queueRefresh();
      const tabsEl = m.body.querySelector('.shop-tabs');
      G.ui.tabs(tabsEl, [{ id: 'buy', label: '구매', icon: '🛍️' }, { id: 'sell', label: '판매', icon: '💰' }], (id) => { this._shopTab = id; this._renderShop(); }, this._shopTab || 'buy');
      G.log.info('INVENTORY', `shop open ${shopId}`);
      G.activity('shop', `${shop.name} 방문`);
      return m;
    },

    _greeting(shop) {
      const hour = G.sys.weather?.hour;
      if (hour != null && (hour >= 20 || hour < 5)) return '늦은 시간까지 체험하시네요! 필요한 게 있으면 천천히 골라 보세요.';
      return shop.npc === 'NPC005' ? '어서 오세요! 씨앗과 재료, 장식품이 준비되어 있어요. 수확물과 발효식품도 사 드려요.' : '어서 오세요! 천천히 둘러보세요.';
    },

    _renderShop() {
      const m = this._shopModal;
      if (!m || m.closed || !G.state) return;
      if (m._kid) { this._renderKidShop(); return; }
      const shop = G.data.shops?.[this._shopId];
      if (!shop) return;
      m._coinChip.innerHTML = `${coinIco()}${fmt(coins())}`;
      G.ui.hydrateIcons(m._coinChip);
      const listEl = m.body.querySelector('.shop-list');
      const filtersEl = m.body.querySelector('.shop-filters');
      const scroll = listEl.scrollTop;
      listEl.innerHTML = '';
      filtersEl.innerHTML = '';
      if (this._shopTab === 'buy') {
        filtersEl.hidden = false;
        for (const f of SHOP_FILTERS) {
          const n = (shop.sells || []).filter((id) => itemOf(id) && (!f.types || f.types.includes(itemOf(id).type))).length;
          if (!n && f.id !== 'all') continue;
          filtersEl.appendChild(G.ui.h('button', { type: 'button', class: `chip shop-filter${this._shopFilter === f.id ? ' active' : ''}`, onclick: () => { this._shopFilter = f.id; this._renderShop(); } }, `${f.label} ${n}`));
        }
        const filt = SHOP_FILTERS.find((f) => f.id === this._shopFilter) || SHOP_FILTERS[0];
        const ids = (shop.sells || []).filter((id) => itemOf(id) && (!filt.types || filt.types.includes(itemOf(id).type)));
        for (const id of ids) listEl.appendChild(this._buyRow(id));
        if (!ids.length) listEl.appendChild(G.ui.h('div', { class: 'empty' }, '이 분류의 상품이 없어요.'));
      } else {
        filtersEl.hidden = true;
        const sellable = this.list().filter((e) => canSellTo(shop, e.item));
        for (const e of sellable) listEl.appendChild(this._sellRow(e.id));
        if (!sellable.length) listEl.appendChild(G.ui.h('div', { class: 'empty' }, G.ui.h('div', { class: 'emoji big' }, '🧺'), '팔 수 있는 물건이 없어요.', G.ui.h('br'), G.ui.h('span', { class: 'small' }, '작물을 수확하거나 장독에서 발효식품을 완성해 보세요.')));
        else listEl.appendChild(G.ui.h('p', { class: 'tiny muted shop-note' }, '씨앗·도구·퀘스트 아이템은 매점에서 사들이지 않아요.'));
      }
      listEl.scrollTop = scroll;
      G.ui.hydrateIcons(m.body);
    },

    _buyRow(id) {
      const it = itemOf(id);
      const owned = this.count(id);
      const isTool = it.type === 'tool';
      const maxAfford = Math.floor(coins() / Math.max(1, it.price || 1));
      const maxQty = isTool ? (owned ? 0 : 1) : Math.max(0, Math.min(99, (it.max || 999) - owned, maxAfford));
      const key = 'b:' + id;
      const q = G.util.clamp(this._qty[key] || 1, 1, Math.max(1, maxQty));
      const btn = G.ui.h('button', { type: 'button', class: 'btn btn-primary btn-sm sr-btn' });
      const update = (n) => {
        this._qty[key] = n;
        const total = n * (it.price || 0);
        btn.innerHTML = `구매 <span class="sr-total">${coinIco()}${fmt(total)}</span>`;
        G.ui.hydrateIcons(btn);
        btn.disabled = maxQty <= 0 || total > coins();
      };
      const st = isTool ? null : stepper(q, 1, Math.max(1, maxQty), update);
      update(q);
      if (isTool && owned) { btn.textContent = '보유 중'; btn.disabled = true; btn.classList.replace('btn-primary', 'btn-soft'); }
      else if (maxAfford <= 0) btn.title = '코인이 부족해요';
      btn.addEventListener('click', (ev) => { if (this._oneTrade(ev, key)) this.buy(id, st ? st.value : 1); });
      return G.ui.h('div', { class: `shop-row t-${it.type}`, role: 'listitem' },
        G.ui.h('div', { class: 'sr-ico' }, G.ui.h('span', { class: 'emoji' }, it.icon || '❔')),
        G.ui.h('div', { class: 'sr-info' },
          G.ui.h('div', { class: 'sr-name' }, G.ui.h('b', {}, it.name), G.ui.h('span', { class: `chip ${TYPE_CHIP[it.type] || ''}` }, TYPE_LABEL[it.type] || ''), owned ? G.ui.h('span', { class: 'sr-owned' }, `보유 ${fmt(owned)}`) : null),
          G.ui.h('small', {}, it.desc || '')),
        G.ui.h('div', { class: 'sr-price', html: `${coinIco()}<b>${fmt(it.price || 0)}</b>` }),
        st ? st.el : G.ui.h('div', { class: 'stepper stepper-fixed' }, '1개'),
        btn);
    },

    _sellRow(id) {
      const it = itemOf(id);
      const owned = this.count(id);
      const key = 's:' + id;
      const q = G.util.clamp(this._qty[key] || 1, 1, owned);
      const btn = G.ui.h('button', { type: 'button', class: 'btn btn-gold btn-sm sr-btn' });
      const update = (n) => { this._qty[key] = n; btn.innerHTML = `판매 <span class="sr-total">${coinIco()}${fmt(n * it.sell)}</span>`; G.ui.hydrateIcons(btn); };
      const st = stepper(q, 1, owned, update);
      update(q);
      btn.addEventListener('click', (ev) => { if (this._oneTrade(ev, key)) this.sell(id, st.value); });
      return G.ui.h('div', { class: `shop-row t-${it.type}`, role: 'listitem' },
        G.ui.h('div', { class: 'sr-ico' }, G.ui.h('span', { class: 'emoji' }, it.icon || '❔')),
        G.ui.h('div', { class: 'sr-info' },
          G.ui.h('div', { class: 'sr-name' }, G.ui.h('b', {}, it.name), G.ui.h('span', { class: `chip ${TYPE_CHIP[it.type] || ''}` }, TYPE_LABEL[it.type] || ''), G.ui.h('span', { class: 'sr-owned' }, `보유 ${fmt(owned)}`)),
          G.ui.h('small', {}, it.desc || '')),
        G.ui.h('div', { class: 'sr-price sell', html: `${coinIco()}<b>${fmt(it.sell)}</b><small>/개</small>` }),
        st.el,
        btn);
    },

    /** one press = one trade: the 2nd click of a double-click (or a click within 350 ms on the same row) is ignored —
     *  the row refreshes a frame later, so its button would otherwise still be live for that click */
    _oneTrade(ev, key) {
      if (ev && ev.detail > 1) return false;
      const t = performance.now();
      const map = this._tradeAt || (this._tradeAt = new Map());
      if (t - (map.get(key) || -1e9) < 350) return false;
      map.set(key, t);
      return true;
    },
    /** buy qty of itemId from the open shop (or shopId) */
    buy(itemId, qty = 1, shopId = this._shopId) {
      const it = itemOf(itemId);
      if (!it || !G.state) return false;
      if (!shopSells(shopId, itemId)) { G.progToast('이 매점에서는 팔지 않는 물건이에요.', { type: 'warn' }); return false; }
      qty = Math.max(1, Math.floor(Number(qty) || 1));
      if (it.type === 'tool' && this.count(itemId) > 0) { G.progToast(`${josa(it.name, '은/는')} 이미 가지고 있어요.`, { type: 'info' }); return false; }
      const room = (it.max || 999) - this.count(itemId);
      if (room < qty) { G.progToast('가방에 더 넣을 수 없어요.', { type: 'warn' }); return false; }
      const total = qty * (it.price || 0);
      if (!spend(total)) {
        if (easyOn()) G.progToast('🪙가 조금 모자라요.', { type: 'warn', emoji: '🪙' });
        else G.progToast(`코인이 부족해요. (필요 ${fmt(total)} · 보유 ${fmt(coins())})`, { type: 'error' });
        return false;
      }
      this.add(itemId, qty, { source: 'shop', silent: true });
      G.sfx('coin');
      if (easyOn()) G.progToast(`${kjosa(it.name, '을/를')} 샀어요! 가방에 넣었어요.`, { emoji: it.icon, type: 'success', sound: false, say: `${kjosa(it.name, '을/를')} 샀어요!` });
      else G.progToast(`구매 완료: ${it.name} ×${fmt(qty)} (−${fmt(total)} 코인)`, { emoji: it.icon, type: 'success', sound: false });
      G.activity('shop', `${it.name} ${fmt(qty)}개 구매`);
      G.log.info('INVENTORY', `buy ${itemId} x${qty} for ${total}`);
      this._queueRefresh();
      return true;
    },

    /** sell qty of itemId to the open shop (or shopId) */
    sell(itemId, qty = 1, shopId = this._shopId) {
      const it = itemOf(itemId);
      const shop = G.data.shops?.[shopId];
      if (!it || !G.state) return false;
      if (!canSellTo(shop, it)) { G.progToast('이 물건은 팔 수 없어요.', { type: 'warn' }); return false; }
      qty = Math.max(1, Math.floor(Number(qty) || 1));
      if (!this.remove(itemId, qty, { source: 'sell' })) { G.progToast('수량이 부족해요.', { type: 'warn' }); return false; }
      const total = qty * it.sell;
      earn(total);
      G.sfx('coin');
      if (easyOn()) G.progToast(`${kjosa(it.name, '을/를')} 팔았어요! 🪙 +${fmt(total)}`, { emoji: it.icon, type: 'success', sound: false, say: `${kjosa(it.name, '을/를')} 팔고 코인 ${total}개를 받았어요!` });
      else G.progToast(`판매 완료: ${it.name} ×${fmt(qty)} (+${fmt(total)} 코인)`, { emoji: it.icon, type: 'success', sound: false });
      G.activity('shop', `${it.name} ${fmt(qty)}개 판매`);
      G.log.info('INVENTORY', `sell ${itemId} x${qty} for ${total}`);
      this._queueRefresh();
      return true;
    },

    // ------------------------------------------------------------ refresh (coalesced to one per frame)
    _queueRefresh() {
      if (this._refreshQueued) return;
      this._refreshQueued = true;
      requestAnimationFrame(() => {
        this._refreshQueued = false;
        try { if (this._invModal && !this._invModal.closed) this._renderInv(); } catch (e) { G.log.error('INVENTORY', e); }
        try { if (this._shopModal && !this._shopModal.closed) this._renderShop(); } catch (e) { G.log.error('INVENTORY', e); }
        try {
          const card = G.ui.modal.get('inv-item');
          if (card && card._itemId && card._count) {
            const n = this.count(card._itemId);
            if (n < 1) card.close();
            else card._count.textContent = `${fmt(n)}개`;
          }
        } catch (e) { G.log.error('INVENTORY', e); }
      });
    },
  };

  G.register(inventory);
})();
