// =============================================================================
// 30-inventory.js — bag (G.sys.inventory) + shop (buy / sell with coins)
//
//   add(itemId, qty=1, {source, silent}) -> added      emits item:added {itemId, qty, source}
//   remove(itemId, qty=1, {source, silent}) -> bool    emits item:removed {itemId, qty, source}
//   has(itemId, qty=1) / count(itemId) / list(type?) -> [{id, item, qty}]
//   open(tab?, {select}) / close() / toggle()          bag modal: tabs, .slot grid, detail pane
//   openShop(shopId) / closeShop()                     buy & sell (coins via G.sys.progression)
//   typeLabel(type)
// Hotkey I, action `inventory`. Registers the shop stall interactable (kind 'shop').
// Also provides G.progToast (small staggered toast queue shared by 30/31/32 modules).
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

  // ---------------------------------------------------------------- helpers
  const items = () => G.data.items || {};
  const itemOf = (id) => items()[id] || null;
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
      this._invModal?.close(); this._shopModal?.close();
    },

    onLogout() {
      this._new.clear();
      G.ui.setBadge('inventory', 0);
      this._invModal?.close(); this._shopModal?.close();
    },

    // ------------------------------------------------------------ core API
    count(itemId) { return Number(G.state?.inventory?.[itemId]) || 0; },
    has(itemId, qty = 1) { return this.count(itemId) >= qty; },
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
        if (!opts.silent) G.progToast(`${josa(it.name, '은/는')} 더 이상 가질 수 없어요. (최대 ${fmt(max)}개)`, { type: 'warn' });
        return 0;
      }
      inv[itemId] = cur + added;
      const source = opts.source || 'unknown';
      G.log.info('INVENTORY', `+${added} ${itemId} (${source}) -> ${inv[itemId]}`);
      if (!this._invModal) { this._new.add(itemId); G.ui.setBadge('inventory', this._new.size); }
      G.dirty('inventory');
      G.bus.emit('item:added', { itemId, qty: added, source });
      if (!opts.silent) {
        G.progToast(`+${it.name} ×${fmt(added)}`, { emoji: it.icon, type: 'success', sound: !QUIET_SOURCES.test(source), cls: 'item-toast' });
        if (added < qty) G.progToast(`가방이 가득 차서 ${fmt(added)}개만 받았어요.`, { type: 'warn' });
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
      if (!m || m.closed) return;
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
      if (!m || m.closed) return;
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

    /** 체험관 안내서: zone list + experience order */
    openGuide() {
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
      btn.addEventListener('click', () => this.buy(id, st ? st.value : 1));
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
      btn.addEventListener('click', () => this.sell(id, st.value));
      return G.ui.h('div', { class: `shop-row t-${it.type}`, role: 'listitem' },
        G.ui.h('div', { class: 'sr-ico' }, G.ui.h('span', { class: 'emoji' }, it.icon || '❔')),
        G.ui.h('div', { class: 'sr-info' },
          G.ui.h('div', { class: 'sr-name' }, G.ui.h('b', {}, it.name), G.ui.h('span', { class: `chip ${TYPE_CHIP[it.type] || ''}` }, TYPE_LABEL[it.type] || ''), G.ui.h('span', { class: 'sr-owned' }, `보유 ${fmt(owned)}`)),
          G.ui.h('small', {}, it.desc || '')),
        G.ui.h('div', { class: 'sr-price sell', html: `${coinIco()}<b>${fmt(it.sell)}</b><small>/개</small>` }),
        st.el,
        btn);
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
        G.progToast(`코인이 부족해요. (필요 ${fmt(total)} · 보유 ${fmt(coins())})`, { type: 'error' });
        return false;
      }
      this.add(itemId, qty, { source: 'shop', silent: true });
      G.sfx('coin');
      G.progToast(`구매 완료: ${it.name} ×${fmt(qty)} (−${fmt(total)} 코인)`, { emoji: it.icon, type: 'success', sound: false });
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
      G.progToast(`판매 완료: ${it.name} ×${fmt(qty)} (+${fmt(total)} 코인)`, { emoji: it.icon, type: 'success', sound: false });
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
      });
    },
  };

  G.register(inventory);
})();
