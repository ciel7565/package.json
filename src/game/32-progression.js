// =============================================================================
// 32-progression.js — stats / level / coin / exp / edu / achievements / collection (도감) / titles / HUD
//
//   grant(reward{coin,exp,edu,items,title}, {reason, popup=true, title, eyebrow, note, silent}) -> reward
//   addCoin(n, {silent}) / spendCoin(n) -> bool / addExp(n) / addEdu(n)
//   incStat(key, n=1) / getStat(key) (derived: level zonesVisited npcsTalked cropKinds socials) / expToNext()
//   unlockCollection(id, {silent}) / isCollected(id) / openCollection(category?)
//   openAchievements(tab?) / openProfile() / openHub('col'|'ach'|'me') — ONE tabbed modal '도감 · 업적'
//   (id 'collection') with 도감 / 업적 / 내 기록 tabs; hotkey C + actions `collection`, `achievements`.
//   setTitle(name) / addTitle(name, {silent}) / titles()
//   celebrate('levelup'|'quest') / refreshHud()
// Stats are maintained only here, from bus events (CONTRACT §4). exp = progress inside the current level,
// expTotal = lifetime exp (monotonic, handy for server-side validation).
// Emits reward:granted, level:up, achievement:unlocked, collection:unlocked. Hotkey C, action `collection`.
// =============================================================================
(function () {
  const STAT_KEYS = ['level', 'exp', 'expTotal', 'coin', 'edu', 'logins', 'playTime', 'distance', 'waters', 'plants', 'harvests', 'harvestedItems',
    'fermentsStarted', 'fermentsClaimed', 'fermentChecks', 'quizCorrect', 'quizAnswered', 'eduCompleted', 'journals', 'photos',
    'emotes', 'gestures', 'chats', 'talks', 'crafts', 'interacts'];
  const STAT_INFO = { // label + unit for achievements / profile
    logins: ['접속 횟수', '회'], playTime: ['플레이 시간', ''], distance: ['이동 거리', 'm'], waters: ['물 주기', '회'], plants: ['씨앗 심기', '회'],
    harvests: ['수확', '회'], harvestedItems: ['수확한 작물', '개'], fermentsStarted: ['발효 시작', '회'], fermentsClaimed: ['발효 완성', '회'],
    fermentChecks: ['장독 확인', '회'], quizCorrect: ['퀴즈 정답', '개'], quizAnswered: ['퀴즈 응답', '회'], eduCompleted: ['교육 완료', '개'],
    journals: ['작업일지', '회'], photos: ['사진', '장'], emotes: ['이모지', '회'], gestures: ['제스처', '회'], chats: ['채팅', '회'],
    talks: ['NPC 대화', '회'], crafts: ['재료 만들기', '회'], interacts: ['살펴보기', '회'], level: ['레벨', ''], zonesVisited: ['방문 구역', '곳'],
    npcsTalked: ['만난 NPC', '명'], cropKinds: ['수확한 작물 종류', '종'], socials: ['이모지·제스처', '회'],
  };
  const esc = (s) => G.util.escapeHtml(s);
  const fmt = (n) => G.util.fmt(n);
  const josa = (w, p) => (G.progJosa ? G.progJosa(w, p) : `${w}${p.split('/')[0]}(${p.split('/')[1]})`);
  const ptc = (w, p) => (G.progJosa?.p ? G.progJosa.p(w, p) : `${p.split('/')[0]}(${p.split('/')[1]})`);
  const toastQ = (msg, opts) => (G.progToast ? G.progToast(msg, opts) : G.ui.toast(msg, opts));
  const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const now = () => G.time.now();
  const LV = () => G.data.levels || { max: 50, expFor: (l) => 100 * l, titles: {} };
  const expFor = (lv) => Math.max(1, Math.round(LV().expFor(lv)));
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- collection rule index
  const ruleIdx = {};
  function buildIndex() {
    for (const k of Object.keys(ruleIdx)) delete ruleIdx[k];
    for (const [id, c] of Object.entries(G.data.collection || {})) {
      for (const r of c.unlock || []) {
        const key = r.crop || r.item || r.npc || r.edu || r.id || r.zone || r.recipe || '*';
        const m = ruleIdx[r.on] || (ruleIdx[r.on] = {});
        (m[key] || (m[key] = [])).push(id);
      }
    }
  }
  function ruleHint(r) {
    switch (r.on) {
      case 'harvest': { const c = G.data.crops?.[r.crop]; return c ? `${josa(c.name, '을/를')} 수확하면 등록돼요.` : null; }
      case 'item': { const it = G.data.items?.[r.item]; return it ? `${josa(it.name, '을/를')} 손에 넣으면 등록돼요.` : null; }
      case 'talk': { const n = G.data.npcs?.[r.npc]; return n ? `${josa(n.name, '과/와')} 대화하면 등록돼요.` : null; }
      case 'edu': { const e = G.data.education?.[r.edu]; const col = Object.values(G.data.collection || {}).find((c) => c.unlock?.some((u) => u.on === 'edu' && u.edu === r.edu)); const t = e?.title || col?.name || '교육'; return `교육 콘텐츠 「${t}」${ptc(t, '을/를')} 끝까지 보면 등록돼요.`; }
      case 'interact': { const a = G.data.layout?.get?.(r.id); return a ? `${a.name || a.title || '전시물'}에 다가가 E 키로 살펴보면 등록돼요.` : null; }
      case 'visit': { const z = (G.data.zones || []).find((x) => x.id === r.zone); return z ? `${josa(z.name, '을/를')} 방문하면 등록돼요.` : null; }
      case 'claim': { const rc = G.data.recipes?.[r.recipe]; return rc ? `장독에서 「${rc.name}」${ptc(rc.name, '을/를')} 완성해 수령하면 등록돼요.` : '장독 발효를 완성해 수령하면 등록돼요.'; }
      default: return null;
    }
  }

  // ---------------------------------------------------------------- 3D celebration burst (lazy, pooled single instance)
  function buildBurst(scene) {
    const N = 64;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const seeds = new Float32Array(N * 4);
    const r = G.util.rng(77);
    for (let i = 0; i < N; i++) { seeds[i * 4] = r() * Math.PI * 2; seeds[i * 4 + 1] = 0.6 + r() * 1.6; seeds[i * 4 + 2] = 1.2 + r() * 2.6; seeds[i * 4 + 3] = r() * 0.25; }
    const tex = G.gfx.radialTexture(64, 'rgba(255,240,190,1)', 'rgba(255,190,60,0)');
    const ptsMat = new THREE.PointsMaterial({ size: 0.34, map: tex, color: 0xffd36a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, ptsMat);
    pts.frustumCulled = false;
    const ringTex = G.gfx.canvasTexture(128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(0.7, 'rgba(255,225,140,1)'); g.addColorStop(0.8, 'rgba(255,250,220,1)'); g.addColorStop(1, 'rgba(255,190,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const pillarGeo = new THREE.CylinderGeometry(0.38, 0.6, 1, 24, 1, true);
    pillarGeo.translate(0, 0.5, 0);
    const pillarTex = G.gfx.canvasTexture(4, 64, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(255,200,90,0.75)'); g.addColorStop(0.35, 'rgba(255,200,90,0.3)'); g.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    const pillarMat = new THREE.MeshBasicMaterial({ map: pillarTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    const group = new THREE.Group();
    group.name = 'celebration-fx';
    group.add(pillar, ring, pts);
    group.visible = false;
    scene.add(group);
    return { N, group, pts, pos, geo, seeds, ptsMat, ring, ringMat, pillar, pillarMat, t: 0, dur: 1.6, big: true, active: false };
  }

  // ---------------------------------------------------------------- the system
  const progression = {
    name: 'progression', order: 54, label: '성장·도감',
    _loginCounted: false, _checking: false, _recheck: false,
    _coinShown: 0, _coinTarget: 0, _newCol: new Set(), _newAch: new Set(), _hubModal: null, _hubTab: 'col', _fx: null, _luQueue: [], _luShowing: false,
    _hudKey: '', _distSince: 0,

    init() {
      buildIndex();
      this._bindEvents();
      G.ui.onAction('collection', () => this.toggleCollection());
      G.ui.onAction('achievements', () => this.openAchievements());
      // hub stays in sync with unlocks that happen while it is open (quest rewards, jar claims...)
      G.bus.on('collection:unlocked', () => { this._hubTabCounts(this._hubModal); if (this._hubModal?._tab !== 'me') this._hubRefresh(); });
      G.bus.on('achievement:unlocked', () => { this._hubTabCounts(this._hubModal); this._hubRefresh(); });
      G.input?.onKey?.('KeyC', () => { this.toggleCollection(); return true; }, { allowInModal: true });
      // level-up overlay
      const lu = G.ui.h('div', { id: 'levelup-fx', class: 'levelup-fx', 'aria-live': 'assertive', hidden: true });
      document.getElementById('app')?.appendChild(lu);
      this._luEl = lu;
      const hp = $('hud-player');
      if (hp) hp.title = G.data.meta?.titleDisclaimer || '';
    },

    onStateLoaded(state) {
      const s = state.stats || (state.stats = {});
      for (const k of STAT_KEYS) { const v = Number(s[k]); s[k] = Number.isFinite(v) && v >= 0 ? v : 0; }
      s.level = G.util.clamp(Math.floor(s.level) || 1, 1, LV().max || 50);
      for (const k of ['exp', 'coin', 'edu']) s[k] = Math.floor(s[k]);
      if (!s.expTotal) { let t = s.exp; for (let l = 1; l < s.level; l++) t += expFor(l); s.expTotal = t; }
      for (const k of ['achievements', 'collection', 'cropKinds', 'npcsTalked', 'visited', 'flags']) if (!state[k] || typeof state[k] !== 'object' || Array.isArray(state[k])) state[k] = {};
      const p = state.profile || (state.profile = {});
      if (!Array.isArray(p.titles)) p.titles = [];
      p.titles = p.titles.filter((t) => typeof t === 'string' && t);
      if (typeof p.title !== 'string') p.title = '';
      if (p.title && !p.titles.includes(p.title)) p.titles.push(p.title);
      // level titles earned so far (silent: they belong to the save already)
      for (const [lv, name] of Object.entries(LV().titles || {})) if (s.level >= Number(lv)) this.addTitle(name, { silent: true, equip: !p.title && !state.flags['title:manual'] });
      this._newCol.clear();
      this._newAch.clear();
      G.ui.setBadge('collection', 0);
      this._reevalCollection();
      this._coinShown = this._coinTarget = s.coin;
      this._hudKey = '';
      this.refreshHud(true);
      this._loginCounted = false;
      this._luQueue.length = 0;
      // achievements earned by stats in the save but never recorded (e.g. new achievements in an update)
      setTimeout(() => { if (G.state === state) this.checkAchievements(); }, 1200);
    },

    onLogout() {
      this._loginCounted = false;
      this._newCol.clear();
      this._newAch.clear();
      this._luQueue.length = 0;
      G.progToast?.clear?.();
      clearTimeout(this._hubRefreshT);
      for (const id of ['collection', 'achievements', 'profile']) G.ui.modal.get(id)?.close();
      this._hubModal = null;
      G.ui.setBadge('collection', 0);
      if (this._fx) { this._fx.active = false; this._fx.group.visible = false; }
    },

    update(dt) {
      if (!G.state) return;
      // coin count-up tween
      if (this._coinShown !== this._coinTarget) {
        const diff = this._coinTarget - this._coinShown;
        const step = Math.max(1, Math.abs(diff) * Math.min(1, dt * 7));
        this._coinShown = Math.abs(diff) <= step ? this._coinTarget : this._coinShown + Math.sign(diff) * step;
        const el = $('hud-coin');
        if (el) el.textContent = fmt(Math.round(this._coinShown));
      }
      // celebration burst
      const fx = this._fx;
      if (fx && fx.active) this._animBurst(fx, dt);
    },

    // ------------------------------------------------------------ events -> stats
    _bindEvents() {
      const on = (name, fn) => G.bus.on(name, (p) => { if (!G.state) return; try { fn(p || {}); } catch (e) { G.log.error('PLAYER', `progression handler ${name}`, e); } });
      const inc = (k, n) => this.incStat(k, n);
      on('game:login', () => this._countLogin());
      on('game:ready', () => this._countLogin());
      on('farm:watered', () => inc('waters'));
      on('farm:planted', () => inc('plants'));
      on('farm:harvested', (p) => {
        if (p.cropId && !G.state.cropKinds[p.cropId]) G.state.cropKinds[p.cropId] = now();
        if (p.qty) G.state.stats.harvestedItems = (G.state.stats.harvestedItems || 0) + int(p.qty);
        inc('harvests');
        if (p.cropId) this._unlockBy('harvest', p.cropId);
      });
      on('ferment:started', () => inc('fermentsStarted'));
      on('ferment:checked', () => inc('fermentChecks'));
      on('ferment:claimed', (p) => { inc('fermentsClaimed'); this._unlockBy('claim', p.recipeId); this._unlockBy('claim', '*'); });
      // quizCorrect = distinct quizzes solved (re-answering a solved quiz does not inflate it); quizAnswered = attempts
      on('quiz:answered', (p) => {
        if (p.correct && p.first !== false) G.state.stats.quizCorrect = (G.state.stats.quizCorrect || 0) + 1;
        inc('quizAnswered');
      });
      on('edu:completed', (p) => {
        // distinct contents finished (re-reading does not inflate the stat)
        const set = new Set(Object.keys(G.state.education?.completed || {}));
        if (p.eduId) set.add(p.eduId);
        G.state.stats.eduCompleted = Math.max(G.state.stats.eduCompleted || 0, set.size);
        this._statChanged();
        if (p.eduId) this._unlockBy('edu', p.eduId);
      });
      on('journal:created', () => inc('journals'));
      on('photo:taken', () => inc('photos'));
      on('emote:played', () => inc('emotes'));
      on('gesture:played', () => inc('gestures'));
      on('chat:sent', () => inc('chats'));
      on('npc:talk', (p) => {
        if (p.npcId && !G.state.npcsTalked[p.npcId]) G.state.npcsTalked[p.npcId] = now();
        inc('talks');
        if (p.npcId) this._unlockBy('talk', p.npcId);
      });
      on('craft:done', () => inc('crafts'));
      on('interact', (p) => {
        inc('interacts');
        if (p.id) this._unlockBy('interact', p.id);
        if (p.kind === 'npc' && p.id && G.data.npcs?.[p.id]) { // works even without the dialogue system
          if (!G.state.npcsTalked[p.id]) { G.state.npcsTalked[p.id] = now(); this._statChanged(); }
          this._unlockBy('talk', p.id);
        }
      });
      on('player:distance', (p) => {
        const m = Number(p.meters) || 0;
        if (!(m > 0) || m > 500) return; // teleports are not walking
        G.state.stats.distance = Math.round(((G.state.stats.distance || 0) + m) * 10) / 10;
        this._distSince += m;
        if (this._distSince >= 25) { this._distSince = 0; this._statChanged(); }
      });
      // the minimap records G.state.visited around this event: evaluate zonesVisited right after it
      on('zone:enter', (p) => { if (p.zoneId) this._unlockBy('visit', p.zoneId); setTimeout(() => { if (G.state) this.checkAchievements(); }, 0); });
      on('item:added', (p) => { if (p.itemId) this._unlockBy('item', p.itemId); });
      on('profile:changed', () => this.refreshHud(true)); // e.g. nickname edited by the app shell
    },

    _countLogin() {
      if (this._loginCounted || !G.state) return;
      this._loginCounted = true;
      this.incStat('logins', 1);
    },

    incStat(key, n = 1) {
      if (!G.state || !key) return 0;
      const s = G.state.stats;
      s[key] = (Number(s[key]) || 0) + (Number(n) || 0);
      this._statChanged();
      return s[key];
    },
    _statChanged() { G.dirty('stats'); this.checkAchievements(); },

    getStat(key) {
      const st = G.state;
      if (!st) return 0;
      switch (key) {
        case 'level': return st.stats.level || 1;
        case 'zonesVisited': { const v = st.visited || {}; return (G.data.visitZones || []).filter((z) => v[z]).length; }
        case 'npcsTalked': return Object.keys(st.npcsTalked || {}).length;
        case 'cropKinds': return Object.keys(st.cropKinds || {}).length;
        case 'socials': return (st.stats.emotes || 0) + (st.stats.gestures || 0);
        default: return Number(st.stats?.[key]) || 0;
      }
    },
    expToNext() { const s = G.state?.stats; if (!s) return 0; return s.level >= (LV().max || 50) ? 0 : Math.max(0, expFor(s.level) - s.exp); },

    // ------------------------------------------------------------ currencies & rewards
    addCoin(n, opts = {}) {
      n = int(n);
      if (!G.state || !n) return G.state?.stats?.coin || 0;
      G.state.stats.coin = (G.state.stats.coin || 0) + n;
      this._coinTarget = G.state.stats.coin;
      this._delta(`+${fmt(n)}`, 'coin');
      G.dirty('coin');
      if (!opts.silent) toastQ(`+${fmt(n)} 코인`, { type: 'reward', icon: 'coin' });
      this.refreshHud();
      return G.state.stats.coin;
    },
    spendCoin(n) {
      n = int(n);
      if (!G.state) return false;
      if ((G.state.stats.coin || 0) < n) return false;
      G.state.stats.coin -= n;
      this._coinTarget = G.state.stats.coin;
      if (n) this._delta(`−${fmt(n)}`, 'coin spend');
      G.dirty('coin');
      this.refreshHud();
      return true;
    },
    addEdu(n, opts = {}) {
      n = int(n);
      if (!G.state || !n) return G.state?.stats?.edu || 0;
      G.state.stats.edu = (G.state.stats.edu || 0) + n;
      this._delta(`+${fmt(n)}`, 'edu');
      G.dirty('edu');
      if (!opts.silent) toastQ(`교육 포인트 +${fmt(n)}`, { emoji: '📘', type: 'success' });
      this.refreshHud();
      return G.state.stats.edu;
    },
    addExp(n, opts = {}) {
      n = int(n);
      if (!G.state || !n) return;
      const s = G.state.stats;
      const max = LV().max || 50;
      s.expTotal = (s.expTotal || 0) + n;
      s.exp = (s.exp || 0) + n;
      let ups = 0;
      while (s.level < max && s.exp >= expFor(s.level)) { s.exp -= expFor(s.level); s.level++; ups++; this._onLevelUp(s.level); }
      if (s.level >= max) s.exp = Math.min(s.exp, expFor(max));
      if (!opts.silent && !ups) toastQ(`EXP +${fmt(n)}`, { emoji: '✨', type: 'success', sound: false });
      G.dirty('exp');
      this.refreshHud();
      if (ups) this._statChanged();
    },
    _onLevelUp(level) {
      G.log.info('PLAYER', `level up -> ${level}`);
      const tname = LV().titles?.[level] || null;
      if (tname) this.addTitle(tname, { silent: true });
      G.bus.emit('level:up', { level });
      G.activity('level', `레벨 ${level} 달성`);
      this._luQueue.push({ level, title: tname });
      this._pumpLevelUp();
    },

    /** apply a reward bundle. opts: {reason, popup=true, title, eyebrow, note, silent} */
    grant(reward, opts = {}) {
      if (!reward || !G.state) return null;
      const r = { coin: int(reward.coin), exp: int(reward.exp), edu: int(reward.edu), items: {}, title: reward.title || null };
      for (const [id, q] of Object.entries(reward.items || {})) if (int(q) > 0 && G.data.items?.[id]) r.items[id] = int(q);
      const popup = opts.popup !== false;
      const quiet = popup || !!opts.silent;
      if (r.coin) this.addCoin(r.coin, { silent: true });
      if (r.edu) this.addEdu(r.edu, { silent: true });
      for (const [id, q] of Object.entries(r.items)) {
        if (G.sys.inventory?.add) G.sys.inventory.add(id, q, { source: opts.reason || 'reward', silent: quiet });
        else { G.state.inventory[id] = (G.state.inventory[id] || 0) + q; G.bus.emit('item:added', { itemId: id, qty: q, source: opts.reason || 'reward' }); }
      }
      if (r.title) this.addTitle(r.title, { silent: popup || !!opts.silent });
      if (popup) {
        G.ui.rewardPopup({ eyebrow: opts.eyebrow || 'REWARD', title: opts.title || '보상 획득!', coin: r.coin, exp: r.exp, edu: r.edu, items: r.items, titleName: r.title, note: opts.note || (r.title ? G.data.meta?.titleDisclaimer : null), sound: opts.sound });
      } else if (!opts.silent) {
        const parts = [];
        if (r.coin) parts.push(`+${fmt(r.coin)} 코인`);
        if (r.exp) parts.push(`EXP +${fmt(r.exp)}`);
        if (r.edu) parts.push(`교육 +${fmt(r.edu)}`);
        if (parts.length) toastQ(parts.join(' · '), { type: 'reward', icon: r.coin ? 'coin' : undefined, emoji: r.coin ? undefined : '✨', cls: 'reward-toast' });
      }
      if (r.exp) this.addExp(r.exp, { silent: true });
      G.bus.emit('reward:granted', { reward: r, reason: opts.reason || null });
      G.dirty('reward');
      return r;
    },

    // ------------------------------------------------------------ titles
    titles() { return (G.state?.profile?.titles || []).slice(); },
    /** opts: {silent, equip} — by default the newest title is worn until the player picks one (flag title:manual) */
    addTitle(name, opts = {}) {
      if (!G.state || !name) return false;
      const p = G.state.profile;
      if (p.titles.includes(name)) return false;
      p.titles.push(name);
      const equip = opts.equip ?? !G.state.flags['title:manual'];
      if (equip) p.title = name;
      if (!opts.silent) toastQ(`새 칭호 획득: 「${name}」`, { emoji: '🏅', type: 'success', cls: 'title-toast' });
      G.dirty('title');
      this.refreshHud();
      return true;
    },
    setTitle(name) {
      if (!G.state) return false;
      const p = G.state.profile;
      name = name || '';
      if (name && !p.titles.includes(name)) return false;
      p.title = name;
      G.state.flags['title:manual'] = true;
      G.dirty('title');
      this.refreshHud();
      return true;
    },

    // ------------------------------------------------------------ achievements
    checkAchievements() {
      if (!G.state) return;
      if (this._checking) { this._recheck = true; return; }
      this._checking = true;
      try {
        do {
          this._recheck = false;
          for (const [id, a] of Object.entries(G.data.achievements || {})) {
            if (G.state.achievements[id] || !a.condition) continue;
            if (this.getStat(a.condition.stat) >= (a.condition.gte || 1)) this._unlockAchievement(id, a);
          }
        } while (this._recheck);
      } finally { this._checking = false; }
    },
    _unlockAchievement(id, a) {
      G.state.achievements[id] = now();
      G.log.info('PLAYER', `achievement ${id}`);
      const r = a.reward || {};
      const parts = [];
      if (r.coin) parts.push(`+${fmt(r.coin)} 코인`);
      if (r.exp) parts.push(`EXP +${fmt(r.exp)}`);
      if (r.edu) parts.push(`교육 +${fmt(r.edu)}`);
      if (r.title) parts.push(`칭호 「${r.title}」`);
      toastQ(`<b>업적 달성!</b> ${esc(a.name)}${parts.length ? ` <span class="t-sub">${esc(parts.join(' · '))}</span>` : ''}`, { html: true, emoji: a.icon || '🏆', type: 'reward', cls: 'ach-toast', duration: 3600, gap: 420 });
      G.sfx('achievement');
      this.grant(r, { popup: false, silent: true, reason: `achievement:${id}` });
      this._newAch.add(id);
      this._hubBadge();
      G.bus.emit('achievement:unlocked', { id });
      G.activity('achievement', `업적 「${a.name}」 달성`);
      G.dirty('achievement');
    },

    // ------------------------------------------------------------ collection
    isCollected(id) { return !!G.state?.collection?.[id]; },
    unlockCollection(id, opts = {}) {
      const c = G.data.collection?.[id];
      if (!c || !G.state || G.state.collection[id]) return false;
      const zoneId = G.sys.minimap?.currentZone?.id || G.state.player?.zoneId || null;
      G.state.collection[id] = { at: now(), zoneId };
      G.log.info('PLAYER', `collection ${id}`);
      if (!opts.silent) {
        toastQ(`<b>도감 등록</b> ${esc(c.name)} <span class="t-sub">${esc(G.data.collectionCategories?.find((k) => k.id === c.category)?.name || '')}</span>`, { html: true, emoji: c.icon || '📖', type: 'success', cls: 'col-toast' });
        this._newCol.add(id);
        this._hubBadge();
      }
      G.bus.emit('collection:unlocked', { id });
      G.dirty('collection');
      return true;
    },
    _unlockBy(on, key) {
      const ids = ruleIdx[on]?.[key];
      if (!ids) return;
      for (const id of ids) this.unlockCollection(id);
    },
    /** state-based collection rules after load (silent) */
    _reevalCollection() {
      const st = G.state;
      const silent = { silent: true };
      const each = (on, keys) => { for (const k of keys) for (const id of ruleIdx[on]?.[k] || []) this.unlockCollection(id, silent); };
      each('harvest', Object.keys(st.cropKinds || {}));
      each('item', Object.keys(st.inventory || {}).filter((k) => st.inventory[k] > 0));
      each('talk', Object.keys(st.npcsTalked || {}));
      each('edu', Object.keys(st.education?.completed || {}));
      each('visit', Object.keys(st.visited || {}));
    },

    // ------------------------------------------------------------ 도감 · 업적 · 내 기록 hub (one tabbed modal)
    // openCollection(category) / openAchievements(tab) / openProfile() all open the same hub on their tab,
    // so the HUD button, hotkey C, NPC/app/jar links and the menu never stack duplicate modals.
    _hubBadge() { G.ui.setBadge('collection', this._newCol.size + this._newAch.size); },

    toggleCollection() {
      const m = G.ui.modal.get('collection');
      if (m && G.ui.modal.top() === m) { m.close(); return; }
      if (G.ui.isBlocking() && !m && G.ui.blockers && [...G.ui.blockers].some((k) => !String(k).startsWith('modal:'))) return;
      // unseen achievements first, otherwise the tab used last
      this.openHub(this._newAch.size && !this._newCol.size ? 'ach' : null);
    },

    openCollection(category) {
      const cats = G.data.collectionCategories || [];
      if (category && cats.some((c) => c.id === category)) { this._colCat = category; this._colSel = null; }
      return this.openHub('col');
    },
    openAchievements(tab) {
      if (tab && ['all', 'todo', 'done'].includes(tab)) this._achTab = tab;
      return this.openHub('ach');
    },
    openProfile() { return this.openHub('me'); },

    openHub(tab) {
      if (!G.state) return null;
      const TABS = ['col', 'ach', 'me'];
      tab = TABS.includes(tab) ? tab : (TABS.includes(this._hubTab) ? this._hubTab : 'col');
      const open = G.ui.modal.get('collection');
      if (open && open._hub && !open.closed) { open._hub.set(tab); return open; }
      this._colCat = this._colCat || 'all';
      this._achTab = this._achTab || 'all';
      const counts = this._hubCounts();
      const chipCol = G.ui.h('span', { class: 'chip chip-gold hub-chip', title: '도감 수집' }, `📖 ${counts.colN}/${counts.colT}`);
      const chipAch = G.ui.h('span', { class: 'chip chip-gold hub-chip', title: '업적 달성' }, `🏆 ${counts.achN}/${counts.achT}`);
      const m = G.ui.modal.open({
        id: 'collection', title: '도감 · 업적', icon: 'collection', size: 'xl', className: 'col-modal prog-hub',
        headExtra: G.ui.h('span', { class: 'hub-chips' }, chipCol, chipAch),
        body: (body) => { body.innerHTML = '<div class="hub-tabs"></div><div class="hub-pane" role="tabpanel"></div>'; },
        onClose: () => { G.ui.setActive('collection', false); if (this._hubModal === m) this._hubModal = null; },
      });
      m._chips = { col: chipCol, ach: chipAch };
      m._fresh = new Set();
      m._freshAch = new Set();
      this._hubModal = m;
      G.ui.setActive('collection', true);
      const tabList = [
        { id: 'col', icon: '📖', label: '도감' },
        { id: 'ach', icon: '🏆', label: '업적' },
        { id: 'me', icon: '📊', label: '내 기록' },
      ];
      const tabsEl = m.body.querySelector('.hub-tabs');
      m._hub = G.ui.tabs(tabsEl, tabList, (id) => this._showHubTab(m, id), tab);
      for (const b of tabsEl.querySelectorAll('.tab')) {
        b.setAttribute('role', 'tab');
        if (b.dataset.tab !== 'me') b.appendChild(G.ui.h('span', { class: 'tab-count' }, ''));
        b.appendChild(G.ui.h('span', { class: 'hub-dot', hidden: true }, ''));
      }
      this._hubTabCounts(m);
      return m;
    },

    _hubCounts() {
      const st = G.state;
      const colT = Object.keys(G.data.collection || {}).length;
      const colN = Object.keys(st?.collection || {}).filter((k) => G.data.collection?.[k]).length;
      const achT = Object.keys(G.data.achievements || {}).length;
      const achN = Object.keys(st?.achievements || {}).filter((k) => G.data.achievements?.[k]).length;
      return { colN, colT, achN, achT };
    },
    /** refresh tab counters, head chips and "new" dots without re-rendering the pane */
    _hubTabCounts(m) {
      if (!m || m.closed) return;
      const c = this._hubCounts();
      const set = (id, txt) => { const el = m.body.querySelector(`.hub-tabs [data-tab="${id}"] .tab-count`); if (el && el.textContent !== txt) el.textContent = txt; };
      set('col', `${c.colN}/${c.colT}`);
      set('ach', `${c.achN}/${c.achT}`);
      if (m._chips) { m._chips.col.textContent = `📖 ${c.colN}/${c.colT}`; m._chips.ach.textContent = `🏆 ${c.achN}/${c.achT}`; }
      const dot = (id, on) => { const el = m.body.querySelector(`.hub-tabs [data-tab="${id}"] .hub-dot`); if (el) el.hidden = !on; };
      dot('col', this._newCol.size > 0);
      dot('ach', this._newAch.size > 0);
    },

    _showHubTab(m, tab) {
      if (!m || m.closed) return;
      this._hubTab = tab;
      m._tab = tab;
      const pane = m.body.querySelector('.hub-pane');
      if (!pane) return;
      pane.className = `hub-pane hub-${tab}`;
      pane.innerHTML = '';
      if (tab === 'col') {
        for (const id of this._newCol) m._fresh.add(id);
        this._newCol.clear();
        this._renderColPane(m, pane);
      } else if (tab === 'ach') {
        for (const id of this._newAch) m._freshAch.add(id);
        this._newAch.clear();
        this._renderAchPane(m, pane);
      } else this._renderMePane(m, pane);
      this._hubBadge();
      this._hubTabCounts(m);
      if (!m._keepScroll) m.body.scrollTop = 0;
    },
    /** re-render the visible pane (new unlocks while the hub is open) */
    _hubRefresh() {
      const m = this._hubModal;
      if (!m || m.closed || !m._tab) return;
      clearTimeout(this._hubRefreshT);
      this._hubRefreshT = setTimeout(() => {
        if (this._hubModal !== m || m.closed) return;
        const y = m.body.scrollTop;
        m._keepScroll = true;
        try { this._showHubTab(m, m._tab); } finally { m._keepScroll = false; }
        m.body.scrollTop = y;
      }, 60);
    },

    // ---- 도감 pane
    _renderColPane(m, pane) {
      const cats = G.data.collectionCategories || [];
      const all = Object.values(G.data.collection || {});
      const got = all.filter((c) => G.state.collection[c.id]).length;
      const pct = all.length ? Math.round((got / all.length) * 100) : 0;
      pane.innerHTML = `<div class="col-summary"><div class="col-sum-txt"><b>${pct}%</b><span>전통발효 도감 완성도</span></div>${G.ui.bar(pct, { cls: 'bar-gold', lg: true })}</div>
        <div class="col-tabs"></div><div class="col-layout"><div class="col-grid" role="listbox" aria-label="도감 목록"></div><aside class="col-detail" aria-live="polite"></aside></div>`;
      const tabsEl = pane.querySelector('.col-tabs');
      const tabList = [{ id: 'all', label: '전체', icon: '📚' }].concat(cats.map((c) => ({ id: c.id, label: c.name, icon: c.icon })));
      if (!tabList.some((t) => t.id === this._colCat)) this._colCat = 'all';
      G.ui.tabs(tabsEl, tabList, (id) => { this._colCat = id; this._colSel = null; this._renderColGrid(m); }, this._colCat);
      for (const b of tabsEl.querySelectorAll('.tab')) {
        const list = all.filter((c) => b.dataset.tab === 'all' || c.category === b.dataset.tab);
        b.appendChild(G.ui.h('span', { class: 'tab-count' }, `${list.filter((c) => G.state.collection[c.id]).length}/${list.length}`));
      }
    },

    _renderColGrid(m = this._hubModal) {
      if (!m || m.closed) return;
      const grid = m.body.querySelector('.col-grid');
      if (!grid) return;
      const all = Object.values(G.data.collection || {});
      const list = all.filter((c) => this._colCat === 'all' || c.category === this._colCat);
      if (!this._colSel || !list.some((c) => c.id === this._colSel)) this._colSel = (list.find((c) => m._fresh?.has(c.id)) || list.find((c) => G.state.collection[c.id]) || list[0])?.id || null;
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const c of list) {
        const got = !!G.state.collection[c.id];
        const no = String(all.indexOf(c) + 1).padStart(3, '0');
        const card = G.ui.h('button', { type: 'button', role: 'option', class: `col-card ${got ? 'got' : 'locked'} cat-${c.category}${c.id === this._colSel ? ' selected' : ''}${m._fresh?.has(c.id) ? ' is-new' : ''}`, 'aria-selected': c.id === this._colSel ? 'true' : 'false', title: got ? c.name : '아직 발견하지 못했어요', dataset: { col: c.id } },
          G.ui.h('span', { class: 'col-no' }, `No.${no}`),
          G.ui.h('span', { class: 'col-ico emoji' }, c.icon || '❔'),
          G.ui.h('span', { class: 'col-name' }, got ? c.name : '???'));
        card.addEventListener('click', () => {
          this._colSel = c.id; m._fresh?.delete(c.id);
          for (const el of grid.querySelectorAll('.col-card.selected')) { el.classList.remove('selected'); el.setAttribute('aria-selected', 'false'); }
          card.classList.add('selected'); card.classList.remove('is-new'); card.setAttribute('aria-selected', 'true');
          this._renderColDetail(m);
        });
        frag.appendChild(card);
      }
      grid.appendChild(frag);
      this._renderColDetail(m);
    },

    _renderColDetail(m = this._hubModal) {
      if (!m || m.closed) return;
      const pane = m.body.querySelector('.col-detail');
      if (!pane) return;
      pane.innerHTML = '';
      const c = G.data.collection?.[this._colSel];
      if (!c) { pane.appendChild(G.ui.h('div', { class: 'empty' }, '항목을 선택하세요.')); return; }
      const rec = G.state.collection[c.id];
      const all = Object.values(G.data.collection || {});
      const cat = G.data.collectionCategories?.find((k) => k.id === c.category);
      pane.appendChild(G.ui.h('div', { class: `col-d-art ${rec ? 'got' : 'locked'} cat-${c.category}` }, G.ui.h('span', { class: 'emoji' }, c.icon || '❔'), G.ui.h('span', { class: 'col-d-no' }, `No.${String(all.indexOf(c) + 1).padStart(3, '0')}`)));
      pane.appendChild(G.ui.h('div', { class: 'col-d-name' }, G.ui.h('h3', {}, rec ? c.name : '???'), G.ui.h('span', { class: 'chip' }, `${cat?.icon || ''} ${cat?.name || ''}`)));
      if (rec) {
        pane.appendChild(G.ui.h('p', { class: 'col-d-desc' }, c.desc || ''));
        const zone = rec.zoneId ? G.world.zoneById?.(rec.zoneId)?.name : null;
        const at = Number(rec.at) || 0;
        pane.appendChild(G.ui.h('dl', { class: 'kv col-d-kv', html: `<dt>획득 위치</dt><dd>${esc(c.location || '-')}</dd>${at ? `<dt>등록일</dt><dd>${esc(G.util.formatDate(at, true))}</dd>` : ''}${zone ? `<dt>발견한 곳</dt><dd>${esc(zone)}</dd>` : ''}` }));
        if (c.category === 'fermented') pane.appendChild(G.ui.h('p', { class: 'tiny muted' }, G.data.meta?.disclaimer || ''));
      } else {
        pane.appendChild(G.ui.h('p', { class: 'col-d-desc muted' }, '아직 발견하지 못한 항목이에요.'));
        const hints = (c.unlock || []).map(ruleHint).filter(Boolean);
        if (hints.length) pane.appendChild(G.ui.h('div', { class: 'notice-box col-hint' }, G.ui.h('b', {}, '💡 힌트 '), hints.join(' 또는 ')));
        pane.appendChild(G.ui.h('dl', { class: 'kv col-d-kv', html: `<dt>획득 위치</dt><dd>${esc(c.location || '-')}</dd>` }));
      }
    },

    // ---- 업적 pane
    _renderAchPane(m, pane) {
      const list = Object.values(G.data.achievements || {});
      const got = list.filter((a) => G.state.achievements[a.id]).length;
      const pct = list.length ? Math.round((got / list.length) * 100) : 0;
      // the closest unfinished goals ("거의 다 왔어요!")
      const near = list.filter((a) => !G.state.achievements[a.id] && a.condition)
        .map((a) => ({ a, r: Math.min(1, this.getStat(a.condition.stat) / (a.condition.gte || 1)) }))
        .filter((x) => x.r > 0).sort((x, y) => y.r - x.r).slice(0, 3);
      pane.innerHTML = `<div class="col-summary"><div class="col-sum-txt"><b>${pct}%</b><span>업적 달성률 · ${got}/${list.length}</span></div>${G.ui.bar(pct, { cls: 'bar-gold', lg: true })}</div>
        ${near.length ? `<div class="ach-near"><span class="ach-near-t">🔥 거의 다 왔어요</span>${near.map((x) => `<span class="ach-near-i" title="${esc(x.a.desc)}"><span class="emoji">${esc(x.a.icon || '🏆')}</span>${esc(x.a.name)} <b>${Math.floor(x.r * 100)}%</b></span>`).join('')}</div>` : ''}
        <div class="ach-tabs"></div><div class="ach-list"></div>`;
      G.ui.tabs(pane.querySelector('.ach-tabs'), [{ id: 'all', label: '전체' }, { id: 'todo', label: '진행 중' }, { id: 'done', label: '달성' }], (id) => { this._achTab = id; this._renderAch(m); }, this._achTab || 'all');
    },
    _renderAch(m = this._hubModal) {
      if (!m || m.closed) return;
      const el = m.body.querySelector('.ach-list');
      if (!el) return;
      const rows = Object.values(G.data.achievements || {}).map((a) => {
        const goal = a.condition?.gte || 1;
        const cur = Math.min(goal, this.getStat(a.condition?.stat));
        return { a, goal, cur, at: Number(G.state.achievements[a.id]) || 0, ratio: cur / goal };
      }).filter((r) => this._achTab === 'all' || (this._achTab === 'done' ? r.at : !r.at));
      rows.sort((x, y) => (!!x.at - !!y.at) || (x.at ? y.at - x.at : y.ratio - x.ratio));
      el.innerHTML = '';
      for (const r of rows) {
        const unit = STAT_INFO[r.a.condition?.stat]?.[1] || '';
        const rw = r.a.reward || {};
        const rewards = [rw.coin ? `<span class="ql-rw"><span class="ico ico-sm" data-icon="coin"></span>${fmt(rw.coin)}</span>` : '', rw.exp ? `<span class="ql-rw">✨ ${fmt(rw.exp)}</span>` : '', rw.edu ? `<span class="ql-rw">📘 ${fmt(rw.edu)}</span>` : '', rw.title ? `<span class="ql-rw ql-rw-title">🏅 「${esc(rw.title)}」</span>` : ''].join('');
        const isNew = m._freshAch?.has(r.a.id);
        el.appendChild(G.ui.h('div', {
          class: `ach-row ${r.at ? 'got' : ''}${isNew ? ' is-new' : ''}`,
          html: `<div class="ach-ico emoji">${esc(r.a.icon || '🏆')}</div>
            <div class="ach-main"><div class="ach-name">${esc(r.a.name)}${r.at ? '<span class="chip chip-gold">달성</span>' : ''}${isNew ? '<span class="chip chip-new">NEW</span>' : ''}</div><div class="ach-desc">${esc(r.a.desc)}</div>
            <div class="ach-prog">${G.ui.bar(r.ratio * 100, { cls: r.at ? 'bar-gold' : '' })}<span>${fmt(r.cur)} / ${fmt(r.goal)}${esc(unit)}</span></div></div>
            <div class="ach-side"><div class="ach-rewards">${rewards}</div>${r.at ? `<small>${esc(G.util.formatDate(r.at))}</small>` : ''}</div>`,
        }));
      }
      if (!rows.length) {
        const none = this._achTab === 'done';
        const box = G.ui.h('div', { class: 'empty ach-empty' }, none ? '아직 달성한 업적이 없어요. 체험을 시작해 보세요!' : '모든 업적을 달성했어요! 🎉');
        // mascot 옹이 (65-companion) cheers in empty states when available — its SVG is module-generated, not user data
        try { const svg = G.mascot?.svg?.(none ? 'think' : 'cheer', 72); if (typeof svg === 'string' && svg.startsWith('<svg')) box.insertAdjacentHTML('afterbegin', `<div class="ach-empty-mascot" aria-hidden="true">${svg}</div>`); } catch (e) { /* optional */ }
        el.appendChild(box);
      }
      G.ui.hydrateIcons(el);
    },

    // ---- 내 기록 pane (profile · titles · stats)
    _renderMePane(m, pane) {
      const st = G.state, s = st.stats, p = st.profile;
      const need = expFor(s.level);
      const maxed = s.level >= (LV().max || 50);
      const c = this._hubCounts();
      const statRows = [
        ['logins', s.logins], ['playTime', G.util.formatDuration(s.playTime || 0)], ['distance', s.distance >= 1000 ? `${(s.distance / 1000).toFixed(2)}km` : `${fmt(Math.round(s.distance))}m`],
        ['zonesVisited', `${this.getStat('zonesVisited')}/${(G.data.visitZones || []).length}`], ['npcsTalked', `${this.getStat('npcsTalked')}/${Object.keys(G.data.npcs || {}).length}`],
        ['waters', s.waters], ['plants', s.plants], ['harvests', s.harvests], ['harvestedItems', s.harvestedItems], ['cropKinds', this.getStat('cropKinds')],
        ['fermentChecks', s.fermentChecks], ['fermentsStarted', s.fermentsStarted], ['fermentsClaimed', s.fermentsClaimed], ['crafts', s.crafts],
        ['eduCompleted', s.eduCompleted], ['quizCorrect', `${fmt(s.quizCorrect)}/${fmt(s.quizAnswered)}`], ['journals', s.journals], ['photos', s.photos],
        ['socials', this.getStat('socials')], ['chats', s.chats],
      ];
      const initial = esc((p.nickname || '게').trim().charAt(0) || '게');
      pane.innerHTML = `<div class="pf-head"><div class="pf-avatar">${initial}</div>
          <div class="pf-id"><div class="pf-row"><span class="lv-chip">Lv.${s.level}</span><b class="pf-nick">${esc(p.nickname || '')}</b><span class="title-chip"${p.title ? '' : ' hidden'}>${esc(p.title || '')}</span></div>
          <div class="bar bar-exp pf-exp"><i style="width:${maxed ? 100 : Math.round(G.util.clamp(s.exp / need, 0, 1) * 100)}%"></i><span>${maxed ? 'MAX' : `${fmt(s.exp)} / ${fmt(need)} EXP`}</span></div>
          <small class="dim">${maxed ? '최고 레벨에 도달했어요!' : `다음 레벨까지 ${fmt(this.expToNext())} EXP · 누적 ${fmt(s.expTotal)} EXP`}</small></div>
          <button type="button" class="btn btn-soft btn-sm pf-avatar-btn" data-hub="avatar"><span class="emoji">🎨</span> 아바타 꾸미기</button></div>
        <div class="grid grid-4 pf-cur">
          <div class="stat"><span>코인</span><b class="gold">${fmt(s.coin)}</b></div>
          <div class="stat"><span>교육 포인트</span><b class="blue">${fmt(s.edu)}</b></div>
          <div class="stat pf-link" data-hub="ach" role="button" tabindex="0"><span>🏆 업적</span><b>${c.achN}/${c.achT}</b></div>
          <div class="stat pf-link" data-hub="col" role="button" tabindex="0"><span>📖 도감</span><b>${c.colN}/${c.colT}</b></div></div>
        <h4 class="ql-sub">칭호</h4><div class="pf-titles"></div><p class="tiny muted">${esc(G.data.meta?.titleDisclaimer || '')}</p>
        <h4 class="ql-sub">체험 기록</h4><div class="pf-stats">${statRows.map(([k, v]) => `<div class="pf-stat"><span>${esc(STAT_INFO[k]?.[0] || k)}</span><b>${typeof v === 'number' ? fmt(v) + esc(STAT_INFO[k]?.[1] || '') : esc(v)}</b></div>`).join('')}</div>`;
      pane.querySelectorAll('[data-hub]').forEach((el) => {
        const go = () => {
          const t = el.dataset.hub;
          if (t === 'avatar') { m.close(); G.ui.triggerAction('avatar', el); return; }
          m._hub?.set(t);
        };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
      this._renderTitles(m);
    },
    _renderTitles(m) {
      const box = m?.body?.querySelector('.pf-titles');
      if (!box) return;
      const p = G.state.profile;
      box.innerHTML = '';
      const mk = (name, label) => {
        const b = G.ui.h('button', { type: 'button', class: `pf-title${(p.title || '') === name ? ' active' : ''}`, 'aria-pressed': (p.title || '') === name ? 'true' : 'false' }, label);
        b.addEventListener('click', () => { this.setTitle(name); this._renderTitles(m); const chip = m.body.querySelector('.pf-row .title-chip'); if (chip) { chip.textContent = name; chip.hidden = !name; } });
        return b;
      };
      box.appendChild(mk('', '칭호 숨기기'));
      for (const t of p.titles) box.appendChild(mk(t, `🏅 ${t}`));
      if (!p.titles.length) box.appendChild(G.ui.h('span', { class: 'muted small' }, '아직 얻은 칭호가 없어요.'));
    },

    // ------------------------------------------------------------ HUD
    refreshHud(immediate) {
      const st = G.state;
      if (!st) return;
      const s = st.stats, p = st.profile;
      const max = LV().max || 50;
      const need = expFor(s.level);
      const maxed = s.level >= max;
      const key = `${s.level}|${s.exp}|${s.edu}|${p.nickname}|${p.title}|${s.coin}`;
      if (key === this._hudKey && !immediate) return;
      const lvChanged = this._hudKey && this._hudKey.split('|')[0] !== String(s.level);
      this._hudKey = key;
      const lv = $('hud-level');
      if (lv) { lv.textContent = `Lv.${s.level}`; if (lvChanged) { lv.classList.remove('lv-pop'); void lv.offsetWidth; lv.classList.add('lv-pop'); } }
      const nick = $('hud-nickname');
      if (nick) nick.textContent = p.nickname || '게스트';
      const tt = $('hud-title');
      if (tt) { tt.textContent = p.title || ''; tt.hidden = !p.title; tt.title = p.title ? `칭호 · ${G.data.meta?.titleDisclaimer || ''}` : ''; }
      const bar = $('hud-exp-bar');
      if (bar) bar.style.width = `${maxed ? 100 : G.util.clamp((s.exp / need) * 100, 0, 100).toFixed(1)}%`;
      const et = $('hud-exp-text');
      if (et) et.textContent = maxed ? 'MAX' : `${fmt(s.exp)} / ${fmt(need)}`;
      bar?.parentElement?.setAttribute('title', maxed ? '최고 레벨' : `경험치 ${fmt(s.exp)} / ${fmt(need)} (다음 레벨까지 ${fmt(need - s.exp)})`);
      const edu = $('hud-edu');
      if (edu) edu.textContent = fmt(s.edu);
      this._coinTarget = s.coin;
      if (immediate) { this._coinShown = s.coin; const c = $('hud-coin'); if (c) c.textContent = fmt(s.coin); }
    },
    _delta(text, cls) {
      const target = cls.startsWith('edu') ? $('hud-edu') : $('hud-coin');
      const host = target?.parentElement;
      if (!host || document.body.classList.contains('hud-hidden')) return;
      const el = G.ui.h('span', { class: `hud-delta ${cls}` }, text);
      host.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    },

    // ------------------------------------------------------------ celebrations
    _pumpLevelUp() {
      if (this._luShowing || !this._luQueue.length) return;
      // wait for any reward popup to finish so the two never overlap
      if (document.querySelector('#reward-root .reward-pop')) { setTimeout(() => this._pumpLevelUp(), 350); return; }
      const { level, title } = this._luQueue.shift();
      this._luShowing = true;
      // the motion-graphics module (66-fx) owns the full-screen level-up show + 3D burst when present:
      // never play two celebrations on top of each other
      const fxOwned = typeof G.fx?.levelUp === 'function';
      const el = fxOwned ? null : this._luEl;
      if (!fxOwned) { G.sfx('levelup'); this.celebrate('levelup'); }
      toastQ(`레벨 업! Lv.${level} 달성${title ? ` · 새 칭호 「${title}」` : ''}`, { emoji: '⭐', type: 'success', sound: false, cls: 'lv-toast' });
      if (el) {
        el.innerHTML = `<div class="lu-rays"></div><div class="lu-card"><div class="lu-eyebrow">LEVEL UP!</div><div class="lu-level"><span>Lv.</span><b>${level}</b></div>${title ? `<div class="lu-sub">새 칭호 「${esc(title)}」</div>` : `<div class="lu-sub">다음 레벨까지 ${fmt(expFor(level))} EXP</div>`}</div>`;
        el.hidden = false;
        el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      }
      setTimeout(() => {
        if (el) { el.classList.remove('show'); el.hidden = true; }
        this._luShowing = false;
        this._pumpLevelUp();
      }, fxOwned ? 900 : G.settings.reduceMotion ? 1600 : 2700);
    },

    /** small 3D burst around the player ('levelup' big gold pillar, 'quest' sparkle) */
    celebrate(kind = 'quest') {
      // 66-fx plays quest / level-up bursts from the same events: one celebration, not two stacked
      if (typeof G.fx?.burst === 'function') return;
      const scene = G.sys.engine?.scene;
      const pl = G.sys.player;
      if (!scene || !pl?.position) return;
      if (!this._fx) this._fx = buildBurst(scene);
      const fx = this._fx;
      fx.big = kind === 'levelup';
      fx.dur = fx.big ? 1.9 : 1.2;
      fx.t = 0;
      fx.active = true;
      fx.group.visible = true;
      fx.pillar.visible = fx.big;
      fx.group.position.copy(pl.position);
    },
    _animBurst(fx, dt) {
      fx.t += dt;
      const k = fx.t / fx.dur;
      if (k >= 1) { fx.active = false; fx.group.visible = false; return; }
      const pl = G.sys.player?.position;
      if (pl) fx.group.position.copy(pl);
      const ease = 1 - Math.pow(1 - k, 3);
      const R = fx.big ? 3.4 : 2.2;
      fx.ring.position.y = 0.06;
      fx.ring.scale.setScalar(0.6 + ease * R * 2);
      fx.ringMat.opacity = (1 - k) * (fx.big ? 0.6 : 0.75);
      if (fx.big) {
        fx.pillar.scale.set(1 + ease * 0.4, 2 + ease * 5, 1 + ease * 0.4);
        fx.pillarMat.opacity = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.42;
      }
      const pos = fx.pos, sd = fx.seeds;
      for (let i = 0; i < fx.N; i++) {
        const delay = sd[i * 4 + 3];
        const lt = G.util.clamp((k - delay) / (1 - delay), 0, 1);
        const a = sd[i * 4] + lt * 2.2;
        const r = (fx.big ? 0.5 : 0.35) + sd[i * 4 + 1] * (1 - Math.pow(1 - lt, 2)) * (fx.big ? 1.1 : 0.7);
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = 0.2 + sd[i * 4 + 2] * lt * (fx.big ? 1.2 : 0.8);
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      fx.geo.attributes.position.needsUpdate = true;
      fx.ptsMat.opacity = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 2);
      fx.ptsMat.size = fx.big ? 0.3 : 0.24;
    },
  };

  G.register(progression);
})();
