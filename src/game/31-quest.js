// =============================================================================
// 31-quest.js — quest state machine, quest panel, quest log, objective hint, gold 3D markers
//
//   G.sys.quest.accept(id, {silent}) -> bool        quest:accepted {questId}
//   G.sys.quest.claim(id) -> reward | null          quest:claimed {questId, reward} (via progression.grant)
//   G.sys.quest.status(id) -> 'locked'|'available'|'accepted'|'progress'|'completed'|'claimed'|null
//   G.sys.quest.progress(id) -> {status, objectives:[{text,type,value,target,done,current}], done, total, ratio, current}
//   G.sys.quest.track(id, bool) / isTracked(id)
//   G.sys.quest.openLog(tab?, questId?)              tabs: active | claimable | done | all
//   G.sys.quest.getMarkers() -> [{x, z, kind, label, primary, questId}]   (minimap)
//   G.sys.quest.focus() -> {mode, questId, objective, target} | null   suspendHint(bool) (onboarding may borrow #objective-hint)
//   G.sys.quest.craftNeed(craftId) -> {item, have, need, crop} | null  (쉬운 모드 craft steps lead to the missing ingredient)
//   G.sys.quest.current() -> {questId, mode, title, easyTitle, icon, step, steps,
//        objective:{index, type, kind, text, easyText, emoji, target:{x,z,label}|null, value, count}} | null
//        what to do next, with one short kid sentence per objective kind (쉬운 모드 "다음 할 일")
//   G.sys.quest.easyTitle(id) / easyText(objective)   kid wording for a quest / an objective
//   G.sys.quest.renderList(el, {easy, close}) -> {refresh(), destroy()}   quest list as sticker cards (big 🎁 받기,
//        👉 같이 가기, 🙋 만나러 가기); live-updates on quest events until el leaves the DOM
// 쉬운 모드: openLog() / hotkeys Q·L open the 📖 스티커북 on its 📜 할 일 tab (one place for quests), toasts are short
// kid sentences, reward popups use the kid title.
// State: G.state.quests[id] = {status, progress[], acceptedAt, completedAt, claimedAt, tracked, seen{}}
// Objective types (01-data.js): talk visit water plant harvest ferment_check ferment_start ferment_claim edu quiz
//   journal photo emote gesture interact collect craft chat visit_all level. Sequential quests only count the
//   current objective; progress events only while accepted/progress; distinct-target objectives are deduped.
// Hotkeys Q / L, actions `quests`, `quest-collapse`.
// =============================================================================
(function () {
  const ACTIVE = new Set(['accepted', 'progress']);
  const STATUS_LABEL = { locked: '잠김', available: '수락 가능', accepted: '진행 중', progress: '진행 중', completed: '보상 대기', claimed: '완료' };
  const STATUS_CHIP = { locked: '', available: 'chip-blue', accepted: 'chip-green', progress: 'chip-green', completed: 'chip-gold', claimed: '' };
  const CAT_LABEL = { main: '메인', farm: '농사', journal: '작업일지', explore: '탐험', ferment: '발효', edu: '교육', social: '소통', npc: 'NPC', event: '이벤트' };
  // objective types whose count means "distinct targets" (payload key used for dedupe)
  const DEDUPE = { talk: true, edu: true, quiz: true, interact: true };
  const STATE_BASED = new Set(['collect', 'visit_all', 'level']);
  const MAX_PANEL = 4;
  const MAX_MARKERS = 4;
  const LS_COLLAPSE = 'tfm.v1.questCollapsed';

  const esc = (s) => G.util.escapeHtml(s);
  const fmt = (n) => G.util.fmt(n);
  const josa = (w, p) => (G.progJosa ? G.progJosa(w, p) : `${w}${p.split('/')[0]}(${p.split('/')[1]})`);
  const toastQ = (msg, opts) => (G.progToast ? G.progToast(msg, opts) : G.ui.toast(msg, opts));
  const defs = () => G.data.quests || {};
  const L = () => G.data.layout || {};
  const now = () => G.time.now();

  // ---------------------------------------------------------------- small world helpers
  const _pp = { x: 0, z: 0 };
  function playerXZ() {
    const p = G.sys.player?.position;
    if (p) { _pp.x = p.x; _pp.z = p.z; } else { _pp.x = L().spawn?.x || 0; _pp.z = L().spawn?.z || 0; }
    return _pp;
  }
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function nearestOf(list, filter) {
    const p = playerXZ();
    let best = null, bd = Infinity;
    for (const a of list || []) {
      if (!a || (filter && !filter(a))) continue;
      const d = d2(a.x, a.z, p.x, p.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  const ground = (x, z) => { try { const y = G.world.surfaceHeight(x, z); return Number.isFinite(y) ? y : 0; } catch (e) { return 0; } };
  const zoneDef = (id) => (G.data.zones || []).find((z) => z.id === id) || null;
  const poiDef = (id) => (G.data.pois || []).find((p) => p.id === id) || null;
  const npcName = (id) => G.data.npcs?.[id]?.name || '안내원';
  const cropOk = (o, cropId) => (!o.crop || o.crop === cropId) && (!o.category || G.data.crops?.[cropId]?.category === o.category);

  /** normalized plot info {cropId, growth, water} — farming system, saved state, or layout prefill */
  function plotInfo(def) {
    let p = null;
    try { p = G.sys.farming?.getPlot?.(def.id) || null; } catch (e) { p = null; }
    let s = p && typeof p === 'object' ? (p.state && typeof p.state === 'object' ? p.state : p) : null;
    if (!s) s = G.state?.farm?.plots?.[def.id] || null;
    if (!s) return { cropId: def.crop || null, growth: def.prefill?.growth ?? 0, water: def.prefill?.water ?? 0 };
    return { cropId: s.cropId ?? s.crop ?? null, growth: Number(s.growth) || 0, water: Number(s.water) || 0 };
  }
  function jarStatus(id) { return G.state?.jars?.[id]?.status || (id === 'J1' ? 'FERMENTING' : 'EMPTY'); }
  function myJars() {
    let ids = null;
    try { ids = G.sys.fermentation?.myJarIds?.(); } catch (e) { ids = null; }
    if (!Array.isArray(ids) || !ids.length) ids = (L().jars || []).filter((j) => j.id === 'J1' || G.state?.jars?.[j.id]?.owned).map((j) => j.id);
    return (L().jars || []).filter((j) => ids.includes(j.id));
  }

  // ---------------------------------------------------------------- marker visuals (shared assets, pooled)
  let assets = null;
  function buildAssets() {
    if (assets) return assets;
    const gemGeo = new THREE.OctahedronGeometry(0.3, 0);
    gemGeo.scale(1, 1.45, 1);
    const gemMat = G.gfx.material('quest:gem', () => new THREE.MeshStandardMaterial({ color: 0xf0b02a, emissive: 0xff8f00, emissiveIntensity: 0.62, metalness: 0.55, roughness: 0.26, flatShading: true }));
    const glowTex = G.gfx.radialTexture(128, 'rgba(255,220,120,1)', 'rgba(255,170,40,0)');
    const ringTex = G.gfx.canvasTexture(128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.28, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,214,110,0)'); g.addColorStop(0.62, 'rgba(255,214,110,0.95)'); g.addColorStop(0.74, 'rgba(255,240,190,1)'); g.addColorStop(1, 'rgba(255,190,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
    const discTex = G.gfx.radialTexture(128, 'rgba(255,205,90,0.85)', 'rgba(255,170,40,0)');
    const beamGeo = new THREE.CylinderGeometry(0.11, 0.36, 1, 24, 1, true);
    beamGeo.translate(0, 0.5, 0);
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc94a) }, uTime: { value: 0 }, uOpacity: { value: 0.5 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.7);
          float fade = pow(1.0 - vUv.y, 1.35) * smoothstep(0.0, 0.05, vUv.y);
          float bands = 0.7 + 0.3 * sin((vUv.y * 7.0 - uTime * 0.9) * 6.2831);
          float a = edge * fade * bands * uOpacity;
          gl_FragColor = vec4(uColor * (0.75 + 0.7 * edge), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    assets = { gemGeo, gemMat, glowTex, ringTex, discTex, beamGeo, planeGeo, beamMat };
    return assets;
  }

  function makeMarker(root) {
    const A = buildAssets();
    const group = new THREE.Group();
    group.name = 'quest-marker';
    group.visible = false;
    const gemPivot = new THREE.Group();
    const gem = new THREE.Mesh(A.gemGeo, A.gemMat);
    gemPivot.add(gem);
    const glowMat = new THREE.SpriteMaterial({ map: A.glowTex, color: 0xffb02e, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(1.7);
    glow.renderOrder = 5;
    const beamMat = A.beamMat.clone();
    beamMat.uniforms = THREE.UniformsUtils.clone(A.beamMat.uniforms);
    const beam = new THREE.Mesh(A.beamGeo, beamMat);
    beam.renderOrder = 4;
    beam.frustumCulled = false;
    const ringMat = new THREE.MeshBasicMaterial({ map: A.ringTex, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
    const ring = new THREE.Mesh(A.planeGeo, ringMat);
    ring.renderOrder = 3;
    const rippleMat = ringMat.clone();
    const ripple = new THREE.Mesh(A.planeGeo, rippleMat);
    ripple.renderOrder = 3;
    const discMat = new THREE.MeshBasicMaterial({ map: A.discTex, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1 });
    const disc = new THREE.Mesh(A.planeGeo, discMat);
    disc.renderOrder = 2;
    group.add(beam, disc, ring, ripple, gemPivot, glow);
    group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    root.add(group);
    return { group, gemPivot, glow, glowMat, beam, beamMat, ring, ringMat, ripple, rippleMat, disc, discMat, target: null, phase: Math.random() * 6.28, fade: 0 };
  }

  // ---------------------------------------------------------------- objective hints
  function objHint(o) {
    switch (o.type) {
      case 'talk': return o.npc ? `${npcName(o.npc)}에게 다가가 E 키를 눌러 대화하세요.` : '체험관의 NPC에게 말을 걸어 보세요.';
      case 'visit': { const n = o.zone ? zoneDef(o.zone)?.name : poiDef(o.poi)?.name; return `금빛 표식을 따라 ${josa(n || '목적지', '으로/로')} 가 보세요.`; }
      case 'water': return '작물이 있는 밭에 다가가 E 키로 물을 주세요. 수분이 낮은 밭부터 챙겨 주세요.';
      case 'plant': return '빈 밭에 다가가 E 키를 누르고 심을 씨앗을 골라 보세요.';
      case 'harvest': return o.category === 'herb' ? '허브 구역에서 성장률 100%가 된 허브를 E 키로 수확하세요.' : '성장률 100%가 된 밭에서 E 키로 수확하세요.';
      case 'ferment_check': return '장독대에서 금빛으로 빛나는 내 장독을 클릭하거나 E 키로 확인하세요.';
      case 'ferment_start': return '비어 있는 내 장독에서 레시피를 골라 발효를 시작하세요.';
      case 'ferment_claim': return '발효가 완성되면 장독을 열어 결과물을 수령하세요. 환기·햇볕 쬐기로 품질을 높일 수 있어요.';
      case 'edu': return '안내판·키오스크·전시대에서 E 키로 교육 콘텐츠를 열어 보세요.';
      case 'quiz': return '교육 콘텐츠의 마지막 장에서 ‘퀴즈 풀기’를 눌러 정답을 맞혀 보세요.';
      case 'journal': return 'J 키 또는 하단의 ‘작업일지’ 버튼으로 오늘의 체험을 기록하세요.';
      case 'photo': return '포토존(금빛 액자)에 들어가 P 키로 사진 모드를 켜고 촬영하세요.';
      case 'emote': return 'T 키 또는 하단의 ‘이모지’ 버튼에서 이모지를 골라 보세요.';
      case 'gesture': return 'G 키 또는 하단의 ‘제스처’ 버튼에서 동작을 골라 보세요.';
      case 'interact': return o.kind === 'tool' ? '전통도구 전시장의 옛 농기구에 다가가 E 키로 살펴보세요.' : '금빛 표식이 있는 물건에 다가가 E 키로 살펴보세요.';
      case 'collect': { const it = G.data.items?.[o.item]; return `${josa(it?.name || '아이템', '을/를')} ${o.count}개 모아 가방에 보관하세요.`; }
      case 'craft': return '발효식품 구역의 작업대에서 재료를 만들어 보세요.';
      case 'chat': return 'Enter 키로 채팅창을 열어 인사를 건네 보세요.';
      case 'visit_all': return '지도(M)를 열어 아직 가 보지 않은 구역을 찾아보세요.';
      case 'level': return '퀘스트와 체험으로 경험치를 모아 레벨을 올려 보세요.';
      default: return '';
    }
  }

  // ---------------------------------------------------------------- 쉬운 모드 wording (CONTRACT §12)
  const easyOn = () => !!(G.easy && G.easy.on);
  const kjo = (w, p) => (G.kidKit?.josa ? G.kidKit.josa(w, p) : `${w}${String(p).split('/')[1]}`);
  /** short, friendly quest names for children (unknown ids fall back to the data title) */
  const KID_TITLE = {
    QUEST001: '체험관 첫 나들이', Q_FIRST_WATER: '첫 물 주기', Q_HARVEST3: '채소 3번 거두기', Q_JOURNAL5: '그림일기 5번 쓰기',
    Q_TOUR: '큰 건물 구경하기', Q_STORAGE: '항아리 창고 가 보기', Q_ALL_ZONES: '모든 곳 가 보기', Q_FARMER: '산골농부 돕기',
    Q_HERB: '향긋한 허브 거두기', Q_MEJU: '메주 만들기', Q_DOENJANG: '된장 완성하기', Q_NEW_FERMENT: '새 장 담그기',
    Q_QUIZ3: '퀴즈 3개 맞히기', Q_CULTURE: '옛날 도구 구경하기', Q_PHOTO: '사진 찍기', Q_GREET: '반갑게 인사하기',
  };
  const kidTitle = (q) => (q ? KID_TITLE[q.id] || q.title || '할 일' : '할 일');
  const OBJ_EMOJI = {
    talk: '💬', visit: '🚶', visit_all: '🗺️', water: '💧', plant: '🌱', harvest: '🧺', collect: '🎒', ferment_check: '🏺',
    ferment_start: '🫙', ferment_claim: '🎉', edu: '📖', quiz: '❓', journal: '📝', photo: '📸', emote: '👋', gesture: '🙌',
    interact: '👆', craft: '🔨', chat: '💬', level: '⭐', claim: '🎁', giver: '🙋',
  };
  const KID_CRAFT = { CRAFT_MEJU: '작업대에서 메주를 빚어요', CRAFT_GOCHUGARU: '작업대에서 고춧가루를 빻아요', CRAFT_HERB_TEA: '작업대에서 허브 다발을 묶어요' };
  const shortRecipe = (r) => String(r?.name || '장').replace(/\s*체험$/, '');
  /** one short kid sentence (≤ 12 words, 해요체, no keys / numbers jargon) per objective kind */
  function kidObjective(o) {
    if (!o) return '금빛 표시를 따라가요';
    const crop = o.crop ? G.data.crops?.[o.crop]?.name : null;
    switch (o.type) {
      case 'talk': return o.npc ? `${kjo(npcName(o.npc), '이랑/랑')} 이야기해요` : '친구랑 이야기해요';
      case 'visit': {
        const z = o.zone ? zoneDef(o.zone) : null;
        const n = z ? (z.short || z.name) : poiDef(o.poi)?.name;
        return n ? `${n}에 가 봐요` : '반짝이는 곳에 가 봐요';
      }
      case 'visit_all': return '아직 안 가 본 곳에 가 봐요';
      case 'water': return crop ? `${crop}밭에 물을 줘요` : '밭에 물을 줘요';
      case 'plant': return crop ? `${crop} 씨앗을 심어요` : o.category === 'herb' ? '허브를 심어요' : '빈 밭에 씨앗을 심어요';
      case 'harvest': return crop ? `${kjo(crop, '을/를')} 거둬요` : o.category === 'herb' ? '향긋한 허브를 거둬요' : '다 자란 채소를 거둬요';
      case 'collect': { const it = G.data.items?.[o.item]; return it ? `${kjo(it.name, '을/를')} 모아요` : '재료를 모아요'; }
      case 'ferment_check': return '반짝이는 내 장독을 봐요';
      case 'ferment_start': return '장독에 새 장을 담가요';
      case 'ferment_claim': return `다 익은 ${kjo(shortRecipe(G.data.recipes?.[o.recipe]), '을/를')} 꺼내요`;
      case 'edu': return '그림 이야기를 봐요';
      case 'quiz': return '퀴즈를 맞혀요';
      case 'journal': return '그림일기를 써요';
      case 'photo': return '사진을 찍어요';
      case 'emote': return o.emote === 'EMO_HELLO' ? '손 흔들어 인사해요' : '내 마음을 보여 줘요';
      case 'gesture': return '몸으로 표현해요';
      case 'interact': return o.kind === 'tool' ? '옛날 도구를 살펴봐요' : '반짝이는 것을 눌러 봐요';
      case 'craft': return KID_CRAFT[o.craft] || '작업대에서 만들어요';
      case 'chat': return '친구에게 인사해요';
      case 'level': return `레벨 ${Math.max(1, Number(o.count) || 1)}까지 놀아요`;
      default: return '금빛 표시를 따라가요';
    }
  }
  /** reward as pictures: [{emoji, text}] (no "EXP" words) */
  function kidReward(r = {}) {
    const out = [];
    if (r.coin) out.push({ emoji: '🪙', text: fmt(r.coin) });
    if (r.exp) out.push({ emoji: '✨', text: fmt(r.exp) });
    for (const [id, n] of Object.entries(r.items || {})) { const it = G.data.items?.[id]; if (it) out.push({ emoji: it.icon || '🎁', text: `${fmt(n)}` }); }
    if (r.title) out.push({ emoji: '🏅', text: '이름표' });
    return out;
  }

  // ---------------------------------------------------------------- the system
  const quest = {
    name: 'quest', order: 52, label: '퀘스트',
    STATUS_LABEL, CAT_LABEL,
    _panelDirty: true, _npcDirty: true, _targetsDirty: true,
    _markers: [], _markerRoot: null, _targets: [], _mapMarkers: [], _focus: null,
    _targetT: 0, _hintT: 0, _npcT: 0, _hintKey: '', _photoMode: false,
    _npcMarks: {}, _fresh: {}, _flash: {},
    _logModal: null, _logTab: 'active', _logSel: null,
    _loaded: false, _immediateQueued: false,

    // ------------------------------------------------------------ lifecycle
    init() {
      this._bindEvents();
      G.ui.onAction('quests', () => this.toggleLog());
      G.ui.onAction('quest-collapse', () => this.setCollapsed(!this._collapsed));
      const hk = () => { this.toggleLog(); return true; };
      G.input?.onKey?.('KeyQ', hk, { allowInModal: true });
      G.input?.onKey?.('KeyL', hk, { allowInModal: true });
      // quest panel interactions (delegated)
      const list = document.getElementById('quest-list');
      if (list) {
        list.addEventListener('click', (e) => {
          const claimBtn = e.target.closest('[data-claim]');
          if (claimBtn) { e.stopPropagation(); this.claim(claimBtn.dataset.claim); return; }
          const item = e.target.closest('[data-quest]');
          if (item) this.openLog(null, item.dataset.quest);
        });
        list.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          const item = e.target.closest('[data-quest]');
          if (item && !e.target.closest('[data-claim]')) { e.preventDefault(); this.openLog(null, item.dataset.quest); }
        });
      }
      let collapsed = false;
      try { collapsed = localStorage.getItem(LS_COLLAPSE) === '1'; } catch (e) { /* storage blocked */ }
      this.setCollapsed(collapsed, false);
      // 3D markers
      const scene = G.sys.engine?.scene;
      if (scene) {
        this._markerRoot = new THREE.Group();
        this._markerRoot.name = 'quest-markers';
        scene.add(this._markerRoot);
        for (let i = 0; i < MAX_MARKERS; i++) this._markers.push(makeMarker(this._markerRoot));
      }
      this._arrow = G.ui.h('span', { class: 'oh-arrow', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="M12 3 19 19 12 15.5 5 19z" fill="currentColor"/></svg>' });
      // easy <-> normal: the adult quest log does not belong in easy mode (the 스티커북 shows quests there)
      G.bus.on('easy:changed', ({ on } = {}) => { if (on) this._logModal?.close(); this._hintKey = ''; });
    },

    onStateLoaded(state) {
      if (!state.quests || typeof state.quests !== 'object') state.quests = {};
      for (const id of Object.keys(defs())) this._ensure(id);
      this._refreshAvailability({ silent: true });
      // re-evaluate state-based objectives (collect / visit_all / level) and "already there" visits
      for (const id of Object.keys(defs())) if (ACTIVE.has(state.quests[id].status)) this._evalState(id, { silent: true });
      this._immediateQueued = true; // once the player has been placed
      this._npcMarks = {};
      this._fresh = {};
      this._loaded = true;
      this._changed();
      this._logModal?.close();
      // HUD should be correct immediately after login/reset/import, not one frame later
      this._panelDirty = false;
      this._renderPanel();
      this._updateBadge();
    },

    onLogout() {
      this._loaded = false;
      this._logModal?.close();
      for (const m of this._markers) { m.group.visible = false; m.target = null; }
      this._targets = []; this._mapMarkers.length = 0; this._focus = null;
      for (const id of Object.keys(this._npcMarks)) { try { G.sys.npc?.setMarker?.(id, null); } catch (e) { /* optional */ } }
      this._npcMarks = {};
      G.ui.objective(null);
      G.ui.setBadge('quests', 0);
      const list = document.getElementById('quest-list');
      if (list) { list.innerHTML = ''; list._emptyHtml = null; }
    },

    update(dt, t) {
      if (!this._loaded || !G.state) return;
      if (this._immediateQueued && G.sys.player?.position) { this._immediateQueued = false; this._checkAllImmediate(); }
      if (this._panelDirty) { this._panelDirty = false; this._panelRefresh = false; this._renderPanel(); this._updateBadge(); if (this._logModal && !this._logModal.closed) this._renderLog(); }
      else if (this._panelRefresh) { this._panelRefresh = false; this._renderPanel(); }
      this._npcT -= dt;
      if (this._npcDirty || this._npcT <= 0) { this._npcDirty = false; this._npcT = 2; this._updateNpcMarkers(); }
      this._targetT -= dt;
      if (this._targetsDirty || this._targetT <= 0) { this._targetsDirty = false; this._targetT = 0.5; this._computeTargets(); }
      this._animateMarkers(dt, t);
      this._hintT -= dt;
      if (this._hintT <= 0) { this._hintT = 0.25; this._updateHint(); }
      this._updateArrow();
    },

    // ------------------------------------------------------------ state helpers
    _ensure(id) {
      const q = defs()[id];
      const all = G.state.quests;
      let e = all[id];
      if (!e || typeof e !== 'object') e = all[id] = { status: 'locked', progress: [], acceptedAt: 0, completedAt: 0, claimedAt: 0, tracked: !!q?.tracked, seen: {} };
      if (!G.data.questStates.includes(e.status)) e.status = 'locked';
      if (!Array.isArray(e.progress)) e.progress = [];
      if (!e.seen || typeof e.seen !== 'object') e.seen = {};
      if (typeof e.tracked !== 'boolean') e.tracked = !!q?.tracked;
      if (q) {
        const n = q.objectives.length;
        e.progress.length = n;
        for (let i = 0; i < n; i++) e.progress[i] = G.util.clamp(Math.floor(Number(e.progress[i]) || 0), 0, q.objectives[i].count || 1);
        // data changed under a saved quest: an active quest whose objectives are all done becomes completed
        if (ACTIVE.has(e.status) && this._allDone(q, e)) { e.status = 'completed'; e.completedAt = e.completedAt || now(); }
      }
      return e;
    },
    _allDone(q, e) { return q.objectives.every((o, i) => (e.progress[i] || 0) >= (o.count || 1)); },
    _currentIdx(q, e) { for (let i = 0; i < q.objectives.length; i++) if ((e.progress[i] || 0) < (q.objectives[i].count || 1)) return i; return -1; },
    _requirementsMet(q) {
      const st = G.state.quests;
      if ((q.requires || []).some((r) => st[r]?.status !== 'claimed')) return false;
      if (q.minLevel && (G.state.stats?.level || 1) < q.minLevel) return false;
      return true;
    },

    /** locked -> available (and autoAccept). Returns ids that newly became available. */
    _refreshAvailability(opts = {}) {
      const fresh = [];
      for (const [id, q] of Object.entries(defs())) {
        const e = this._ensure(id);
        if (e.status !== 'locked' || !this._requirementsMet(q)) continue;
        e.status = 'available';
        if (q.autoAccept) this.accept(id, { silent: opts.silent, auto: true });
        else fresh.push(id);
      }
      if (fresh.length && !opts.silent) {
        const first = defs()[fresh[0]];
        const giver = first.giver ? `${npcName(first.giver)}에게서 ` : '';
        if (easyOn()) toastQ(fresh.length > 1 ? `새 할 일이 ${fresh.length}개 생겼어요!` : `새 할 일이 생겼어요! ${kidTitle(first)}`, { emoji: '🙋', type: 'info', cls: 'quest-toast', say: '새 할 일이 생겼어요!' });
        else toastQ(fresh.length > 1 ? `새 퀘스트 ${fresh.length}개가 열렸어요! ${giver}「${first.title}」 외 ${fresh.length - 1}개` : `새 퀘스트가 열렸어요! ${giver}「${first.title}」`, { emoji: '❗', type: 'info', cls: 'quest-toast' });
        for (const id of fresh) this._fresh[id] = performance.now();
      }
      if (fresh.length) { G.dirty('quest'); this._changed(); }
      return fresh;
    },

    // ------------------------------------------------------------ public API
    status(id) { return G.state?.quests?.[id]?.status || (defs()[id] ? 'locked' : null); },
    isTracked(id) { return !!G.state?.quests?.[id]?.tracked; },

    progress(id) {
      const q = defs()[id];
      if (!q || !G.state) return null;
      const e = this._ensure(id);
      const cur = this._currentIdx(q, e);
      let sum = 0, tot = 0, done = 0;
      const objectives = q.objectives.map((o, i) => {
        const target = o.count || 1, value = Math.min(e.progress[i] || 0, target);
        sum += value; tot += target;
        if (value >= target) done++;
        return { index: i, type: o.type, text: o.text, value, target, done: value >= target, current: e.status !== 'claimed' && e.status !== 'completed' && (q.sequential ? i === cur : value < target) };
      });
      const finished = e.status === 'completed' || e.status === 'claimed';
      return { status: e.status, objectives, done: finished ? q.objectives.length : done, total: q.objectives.length, ratio: finished ? 1 : (tot ? sum / tot : 0), current: finished ? -1 : cur };
    },

    accept(id, opts = {}) {
      const q = defs()[id];
      if (!q || !G.state) return false;
      const e = this._ensure(id);
      if (e.status === 'locked' && this._requirementsMet(q)) e.status = 'available';
      if (e.status !== 'available') return false;
      e.status = 'accepted';
      e.acceptedAt = now();
      e.progress = q.objectives.map(() => 0);
      e.seen = {};
      if (!opts.auto) e.tracked = true; // a quest the player chose to take is followed on the panel & markers
      else if (typeof e.tracked !== 'boolean') e.tracked = !!q.tracked;
      G.log.info('QUEST', `accepted ${id}${opts.auto ? ' (auto)' : ''}`);
      G.bus.emit('quest:accepted', { questId: id });
      if (!opts.silent) {
        toastQ(easyOn() ? `새 할 일: ${kidTitle(q)}` : `퀘스트 수락: 「${q.title}」`, { emoji: q.icon || '📜', type: 'info', cls: 'quest-toast' });
        G.sfx('quest');
        this._fresh[id] = performance.now();
        G.activity('quest', `퀘스트 「${q.title}」 시작`);
      }
      G.dirty('quest');
      this._evalState(id, { silent: !!opts.silent });
      if (ACTIVE.has(e.status)) this._checkImmediate(id);
      this._changed();
      return true;
    },

    claim(id) {
      const q = defs()[id];
      if (!q || !G.state) return null;
      const e = this._ensure(id);
      if (e.status !== 'completed') return null;
      e.status = 'claimed';           // flip first: a re-entrant call can never grant twice
      e.claimedAt = now();
      G.dirty('quest');
      const reward = G.util.clone(q.reward || {});
      let granted = reward;
      try {
        const P = G.sys.progression;
        if (P?.grant) granted = P.grant(reward, { reason: `quest:${id}`, popup: true, title: easyOn() ? `${kidTitle(q)} 성공` : q.title, eyebrow: q.category === 'main' ? 'MAIN QUEST CLEAR' : 'QUEST CLEAR' }) || reward;
        else this._fallbackGrant(reward);
      } catch (err) { G.log.error('QUEST', 'reward grant failed', err); }
      G.log.info('QUEST', `claimed ${id}`, reward);
      G.bus.emit('quest:claimed', { questId: id, reward: granted });
      G.activity('quest', `퀘스트 「${q.title}」 완료`);
      try { G.sys.progression?.celebrate?.('quest'); } catch (err) { /* cosmetic */ }
      this._refreshAvailability();
      this._changed();
      return granted;
    },

    _fallbackGrant(r) {
      const s = G.state.stats;
      s.coin = (s.coin || 0) + (r.coin || 0);
      s.exp = (s.exp || 0) + (r.exp || 0);
      s.edu = (s.edu || 0) + (r.edu || 0);
      for (const [it, n] of Object.entries(r.items || {})) G.sys.inventory?.add?.(it, n, { source: 'quest', silent: true });
      G.ui.rewardPopup({ eyebrow: 'QUEST CLEAR', title: '보상 획득!', coin: r.coin, exp: r.exp, edu: r.edu, items: r.items, titleName: r.title });
    },

    track(id, on = true) {
      const e = G.state?.quests?.[id];
      if (!e || !defs()[id]) return false;
      e.tracked = !!on;
      G.dirty('quest');
      this._changed();
      return true;
    },

    focus() { return this._focus; },
    /**
     * craft objective helper: the first ingredient of G.data.crafts[craftId] the player is short of ->
     * {item, have, need, crop} (crop = the crop that grows it, or null) | null when everything is in the bag
     */
    craftNeed(craftId) {
      const r = G.data.crafts?.[craftId];
      if (!r || !r.in || !G.state) return null;
      for (const [item, n] of Object.entries(r.in)) {
        const need = Math.max(1, Math.round(Number(n) || 1));
        const have = Math.max(0, Number(G.sys.inventory?.count?.(item)) || 0);
        if (have < need) {
          const crop = Object.keys(G.data.crops || {}).find((id) => G.data.crops[id]?.harvestItem === item) || null;
          return { item, have, need, crop };
        }
      }
      return null;
    },
    getMarkers() { return this._mapMarkers; },

    // ------------------------------------------------------------ 쉬운 모드 helpers
    easyTitle(id) { return kidTitle(defs()[id]); },
    easyText(o) { return kidObjective(o); },

    /** what to do next (same priority as the gold marker), with kid wording — drives the easy "다음 할 일" card */
    current() {
      const f = this._focus;
      const q = f ? defs()[f.questId] : null;
      if (!f || !q || !G.state) return null;
      const e = G.state.quests[f.questId] || { progress: [] };
      // a person is a place to walk to by name ("발효마스터"), never by the adult objective sentence
      const tg = f.target && Number.isFinite(f.target.x) && Number.isFinite(f.target.z)
        ? { x: f.target.x, z: f.target.z, kind: f.target.kind || null, label: String((f.target.npc ? npcName(f.target.npc) : f.target.label) || '') } : null;
      let objective;
      if (f.mode === 'claim') {
        objective = { index: -1, type: 'claim', kind: 'claim', text: '퀘스트 보상 받기', easyText: '잘했어요! 선물을 받아요', emoji: OBJ_EMOJI.claim, target: null, value: 1, count: 1 };
      } else if (f.mode === 'giver') {
        const n = npcName(q.giver);
        objective = { index: -1, type: 'talk', kind: 'giver', text: `${n}에게 말을 걸어 「${q.title}」 받기`, easyText: `${n}에게 가 봐요`, emoji: OBJ_EMOJI.giver, target: tg, value: 0, count: 1 };
      } else {
        const o = q.objectives[f.objective];
        if (!o) return null;
        const count = o.count || 1;
        objective = { index: f.objective, type: o.type, kind: o.type, text: o.text, easyText: kidObjective(o), emoji: OBJ_EMOJI[o.type] || '⭐', target: tg, value: Math.min(count, Number(e.progress[f.objective]) || 0), count };
      }
      return { questId: f.questId, mode: f.mode, title: q.title, easyTitle: kidTitle(q), icon: q.icon || '📜', category: q.category, step: Math.max(0, f.objective) + 1, steps: q.objectives.length, objective };
    },

    /**
     * Quest list as sticker cards (easy) or compact rows (normal) inside `el`.
     * opts: {easy = G.easy.on, close: fn (called before an action takes the child into the world)}
     * -> {root, refresh(), destroy()} ; re-renders itself on quest events until `el` leaves the DOM.
     */
    renderList(el, opts = {}) {
      if (!el || !G.state) return null;
      const easy = opts.easy ?? easyOn();
      const root = G.ui.h('div', { class: `kq ${easy ? 'kq-easy' : 'kq-normal'}` });
      el.appendChild(root);
      let raf = 0, drawn = false;
      const ctl = { root, destroyed: false };
      const draw = () => {
        if (ctl.destroyed) return;
        if (!G.state) { root.textContent = ''; return; }
        try { this._drawList(root, easy, opts, !drawn); drawn = true; } catch (err) { G.log.error('QUEST', 'renderList failed', err); }
      };
      const queue = () => {
        if (ctl.destroyed || raf) return;
        raf = requestAnimationFrame(() => { raf = 0; if (root.isConnected) draw(); else ctl.destroy(); });
      };
      const offs = ['quest:accepted', 'quest:progress', 'quest:completed', 'quest:claimed', 'state:loaded'].map((n) => G.bus.on(n, queue));
      ctl.refresh = draw;
      ctl.destroy = () => {
        if (ctl.destroyed) return;
        ctl.destroyed = true;
        cancelAnimationFrame(raf);
        for (const off of offs) { try { off(); } catch (err) { /* already gone */ } }
      };
      draw();
      return ctl;
    },

    _drawList(root, easy, opts, first) {
      const st = G.state.quests;
      const ids = Object.keys(defs());
      const order = (id) => ids.indexOf(id) + (defs()[id].category === 'main' ? -1000 : 0) + (st[id]?.tracked ? -100 : 0);
      const by = (fn) => ids.filter((id) => fn(st[id]?.status)).sort((a, b) => order(a) - order(b));
      const claim = by((s) => s === 'completed');
      const active = by((s) => ACTIVE.has(s));
      const avail = by((s) => s === 'available').filter((id) => !!defs()[id].giver);
      const done = by((s) => s === 'claimed');
      const locked = by((s) => s === 'locked').length;
      const y = root.closest('.modal-body')?.scrollTop;
      root.textContent = '';
      const h = G.ui.h;
      if (!easy) {
        for (const id of claim.concat(active, avail)) root.appendChild(this._adultRow(id, opts));
        if (!root.childElementCount) root.appendChild(h('div', { class: 'empty' }, '진행 중인 퀘스트가 없어요.'));
        return;
      }
      let i = 0;
      const sec = (emoji, text, cls = '') => root.appendChild(h('h3', { class: `kk-sec kq-sec ${cls}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), text));
      if (claim.length) { sec('🎁', '선물을 받을 수 있어요!', 'gold'); for (const id of claim) root.appendChild(this._kidCard(id, 'claim', opts, first ? i++ : -1)); }
      if (active.length) { sec('🏃', '하고 있어요'); for (const id of active) root.appendChild(this._kidCard(id, 'active', opts, first ? i++ : -1)); }
      if (avail.length) { sec('🙋', '새로 할 수 있어요'); for (const id of avail) root.appendChild(this._kidCard(id, 'avail', opts, first ? i++ : -1)); }
      if (done.length) {
        sec('✅', `다 했어요 (${done.length})`);
        const grid = h('div', { class: 'kk-grid kq-done' });
        for (const id of done) {
          const q = defs()[id];
          const b = h('button', { type: 'button', class: `easy-tile kk-tile kq-done-tile${first ? '' : ' still'}`, 'aria-label': `${kidTitle(q)}, 다 했어요` },
            h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, q.icon || '📜'),
            h('span', { class: 'et-label' }, kidTitle(q)),
            h('span', { class: 'et-badge', 'aria-hidden': 'true' }, '✅'));
          b.style.setProperty('--tile', '#55d187');
          b.addEventListener('click', () => G.kidKit?.say?.(`${kidTitle(q)}. 다 했어요! 멋져요!`, { force: true }));
          grid.appendChild(b);
        }
        G.kidKit?.gridKeys?.(grid);
        root.appendChild(grid);
      }
      if (!claim.length && !active.length && !avail.length) {
        const all = !locked;
        root.prepend(G.kidKit ? G.kidKit.empty(all ? '🎉' : '🧭', all ? '할 일을 모두 했어요!' : '지금은 할 일이 없어요.', all ? '마음껏 구경해요!' : '친구들에게 말을 걸어 봐요!', all ? 'cheer' : 'think') : h('div', { class: 'empty' }, '지금은 할 일이 없어요.'));
      }
      if (locked) root.appendChild(h('p', { class: 'kq-locked' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔒'), ` 더 놀면 새 할 일이 생겨요! (${locked}개)`));
      if (y != null) { const mb = root.closest('.modal-body'); if (mb) mb.scrollTop = y; }
    },

    /** one sticker card: claim / active / avail */
    _kidCard(id, kind, opts, i) {
      const h = G.ui.h;
      const q = defs()[id], e = G.state.quests[id];
      const p = this.progress(id);
      const title = kidTitle(q);
      let line = '', lineEmoji = '';
      let o = null;
      if (kind === 'claim') { line = '다 했어요! 선물을 받아요'; lineEmoji = '🎉'; }
      else if (kind === 'avail') { line = `${npcName(q.giver)}에게 가면 알려 줘요`; lineEmoji = '🙋'; }
      else {
        const idx = p.current >= 0 ? p.current : q.objectives.findIndex((x, k) => (e.progress[k] || 0) < (x.count || 1));
        o = idx >= 0 ? q.objectives[idx] : null;
        line = kidObjective(o);
        lineEmoji = OBJ_EMOJI[o?.type] || '⭐';
        o = o ? { o, idx } : null;
      }
      const card = h('div', { class: `kq-card kq-${kind}${q.category === 'main' ? ' is-main' : ''}${i < 0 ? ' still' : ''}`, role: 'group', 'aria-label': `${title}. ${line}` });
      if (i >= 0) card.style.setProperty('--i', String(Math.min(i, 12)));
      // progress as pictures: one pip per step (sequential) or per count
      let pips = null;
      if (kind === 'active') {
        const pipsOf = (n, on, cur) => { const w = h('div', { class: 'kq-pips', role: 'img', 'aria-label': `${n}개 중에 ${on}개 했어요` }); for (let k = 0; k < n; k++) w.appendChild(h('i', { class: k < on ? 'on' : k === cur ? 'now' : '' })); return w; };
        if (q.objectives.length > 1) pips = pipsOf(q.objectives.length, p.done, p.current);
        else {
          const ob = p.objectives[0];
          if (ob.target > 1 && ob.target <= 10) pips = pipsOf(ob.target, ob.value, ob.value);
          else if (ob.target > 10) pips = h('div', { class: 'kq-pips' }, h('b', null, `⭐ ${fmt(ob.value)} / ${fmt(ob.target)}`));
        }
      }
      const rw = kidReward(q.reward);
      const reward = rw.length ? h('div', { class: 'kq-reward', 'aria-label': '선물' }, h('span', { class: 'kq-gift emoji', 'aria-hidden': 'true' }, '🎁'), rw.slice(0, 4).map((r) => h('span', { class: 'kq-rw' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, r.emoji), r.text))) : null;
      const main = h('div', { class: 'kq-main' },
        h('div', { class: 'kq-title' }, title),
        h('div', { class: 'kq-line' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, lineEmoji), h('span', null, line)),
        pips, reward);
      const sayLine = `${title}. ${line}.`;
      const sayBtn = h('button', { type: 'button', class: 'easy-speak kq-say', 'aria-label': '소리로 듣기', title: '소리로 듣기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊'));
      sayBtn.addEventListener('click', () => G.kidKit?.say?.(sayLine, { force: true, priority: 1 }));
      const act = this._kidAct(id, kind, o, opts);
      let btn = null;
      if (act) {
        btn = h('button', { type: 'button', class: `easy-big-btn kq-btn ${act.cls || 'easy-btn-yes'}`, 'data-say': act.label }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, act.emoji), h('span', null, act.label));
        btn.addEventListener('click', () => { try { act.fn(card, btn); } catch (err) { G.log.error('QUEST', 'kid card action', err); } });
      }
      card.append(h('div', { class: 'kq-sticker emoji', 'aria-hidden': 'true' }, q.icon || '📜'), main, h('div', { class: 'kq-side' }, sayBtn, btn));
      card.__easySpeak = { btn: sayBtn, text: sayLine };
      return card;
    },

    /** the one big button of a card -> {emoji, label, cls, fn} | null */
    _kidAct(id, kind, cur, opts) {
      const leave = () => { try { opts.close?.(); } catch (e) { /* ignore */ } };
      const walk = (t, label) => { leave(); if (G.easy?.goTo) G.easy.goTo({ x: t.x, z: t.z }, { label: label || '' }); };
      if (kind === 'claim') return { emoji: '🎁', label: '선물 받기', cls: 'kq-claim', fn: (card, btn) => this._kidClaim(id, card, btn) };
      if (kind === 'avail') {
        const q = defs()[id];
        const t = this._npcTarget(q.giver, npcName(q.giver));
        return t ? { emoji: '🙋', label: '만나러 가기', fn: () => walk(t, '') } : null;
      }
      if (!cur) return null;
      const t = cur.o.type;
      const trig = (action) => () => { leave(); G.ui.triggerAction(action); };
      if (t === 'journal') return { emoji: '📝', label: '일기 쓰기', fn: () => { leave(); G.sys.journal?.open?.(); } };
      if (t === 'photo') return { emoji: '📸', label: '사진 찍기', fn: trig('photo') };
      if (t === 'emote' || t === 'gesture') return { emoji: '😊', label: '표현하기', fn: trig('express') };
      if (t === 'chat') return { emoji: '💬', label: '인사하기', fn: trig('kid-chat') };
      let target = null;
      try { target = this._targetFor(id, cur.idx); } catch (e) { target = null; }
      if (target && G.easy?.goTo) return { emoji: '👉', label: '같이 가기', fn: () => walk(target, '') };
      if ((t === 'edu' || t === 'quiz') && G.sys.education?.openLibrary) return { emoji: '📖', label: '보러 가기', fn: () => { leave(); G.sys.education.openLibrary(); } };
      return null;
    },

    /** 🎁 선물 받기: a short celebration, then the reward popup */
    async _kidClaim(id, card, btn) {
      if (this.status(id) !== 'completed' || card?._busy) return null;
      if (card) card._busy = true;
      if (btn) btn.disabled = true;
      card?.classList.add('opening');
      const q = defs()[id];
      const st = G.state;
      try { if (G.easy?.celebrate) await G.easy.celebrate('다 했어요!', { emoji: q.icon || '🎁', duration: 1100 }); } catch (e) { /* cosmetic */ }
      if (!G.state || G.state !== st) return null; // logged out / another player meanwhile
      return this.claim(id);
    },

    /** compact adult row (normal-mode renderList) */
    _adultRow(id, opts) {
      const h = G.ui.h;
      const q = defs()[id], e = G.state.quests[id];
      const p = this.progress(id);
      const cur = p.current >= 0 ? q.objectives[p.current] : null;
      const row = h('div', { class: `kq-row s-${e.status}` },
        h('span', { class: 'kq-row-ico emoji', 'aria-hidden': 'true' }, q.icon || '📜'),
        h('div', { class: 'kq-row-main' }, h('b', null, q.title), h('small', null, e.status === 'completed' ? '보상을 받을 수 있어요' : e.status === 'available' ? `${npcName(q.giver)}에게서 받을 수 있어요` : (cur?.text || q.desc)),
          ACTIVE.has(e.status) ? h('span', { class: 'bar', html: `<i style="width:${Math.round(p.ratio * 100)}%"></i>` }) : null));
      if (e.status === 'completed') {
        const b = h('button', { type: 'button', class: 'btn btn-gold btn-sm' }, '보상 받기');
        b.addEventListener('click', () => this.claim(id));
        row.appendChild(b);
      } else {
        const b = h('button', { type: 'button', class: 'btn btn-soft btn-sm' }, '자세히');
        b.addEventListener('click', () => { try { opts.close?.(); } catch (err) { /* ignore */ } this.openLog(null, id, { normal: true }); });
        row.appendChild(b);
      }
      return row;
    },

    // ------------------------------------------------------------ progress
    _changed() { this._panelDirty = true; this._npcDirty = true; this._targetsDirty = true; this._hintT = 0; },

    /** iterate countable objectives of active quests matching type & predicate */
    _event(type, match, key) {
      if (!G.state || !this._loaded) return;
      for (const [id, q] of Object.entries(defs())) {
        const e = G.state.quests[id];
        if (!e || !ACTIVE.has(e.status)) continue;
        if (q.sequential) {
          const i = this._currentIdx(q, e);
          if (i >= 0 && q.objectives[i].type === type && match(q.objectives[i])) this._advance(id, i, 1, key);
        } else {
          for (let i = 0; i < q.objectives.length; i++) {
            const o = q.objectives[i];
            if (o.type === type && (e.progress[i] || 0) < (o.count || 1) && match(o)) this._advance(id, i, 1, key);
            if (!ACTIVE.has(e.status)) break;
          }
        }
      }
    },

    /** add `amount` (or set to `opts.set`) on objective i of quest id */
    _advance(id, i, amount, key, opts = {}) {
      const q = defs()[id], e = G.state.quests[id];
      if (!q || !e || !ACTIVE.has(e.status)) return false;
      const o = q.objectives[i];
      const target = o.count || 1;
      const before = e.progress[i] || 0;
      if (before >= target && opts.set == null) return false;
      if (key != null && DEDUPE[o.type]) {
        const seen = e.seen[i] || (e.seen[i] = []);
        if (seen.includes(key)) return false;
        seen.push(key);
      }
      let after = opts.set != null ? G.util.clamp(Math.floor(opts.set), 0, target) : Math.min(target, before + amount);
      if (before >= target) after = target; // completed objectives never regress
      if (after === before) return false;
      e.progress[i] = after;
      if (e.status === 'accepted' && after > 0) e.status = 'progress';
      G.dirty('quest');
      G.bus.emit('quest:progress', { questId: id, objective: i, value: after, target });
      this._flash[id] = performance.now();
      if (after >= target && before < target) {
        G.log.info('QUEST', `${id} objective ${i} done (${o.text})`);
        if (this._allDone(q, e)) { this._complete(id, opts); return true; }
        if (!opts.silent) {
          if (easyOn()) toastQ('잘했어요! 하나 끝났어요 ✅', { emoji: OBJ_EMOJI[o.type] || '✅', type: 'success', cls: 'quest-toast' });
          else toastQ(`목표 달성: ${o.text}`, { emoji: '✅', type: 'success', cls: 'quest-toast' });
        }
        if (q.sequential) {
          this._evalState(id, opts);
          if (ACTIVE.has(e.status)) this._checkImmediate(id);
        }
      }
      this._changed();
      return true;
    },

    _complete(id, opts = {}) {
      const q = defs()[id], e = G.state.quests[id];
      if (!ACTIVE.has(e.status)) return;
      e.status = 'completed';
      e.completedAt = now();
      G.dirty('quest');
      G.log.info('QUEST', `completed ${id}`);
      G.bus.emit('quest:completed', { questId: id });
      if (!opts.silent) {
        G.sfx('quest');
        if (easyOn()) toastQ(`다 했어요! 🎁 선물을 받아요`, { emoji: q.icon || '🎉', type: 'success', sound: false, cls: 'quest-toast quest-done-toast', duration: 4200, say: `${kidTitle(q)}, 다 했어요! 선물을 받아요.` });
        else toastQ(`퀘스트 완료! 「${q.title}」 — ‘보상 받기’를 눌러 주세요`, { emoji: q.icon || '🎉', type: 'success', sound: false, cls: 'quest-toast quest-done-toast', duration: 4200 });
      }
      this._changed();
    },

    /** state-based objectives: collect / visit_all / level */
    _evalState(id, opts = {}) {
      const q = defs()[id], e = G.state?.quests?.[id];
      if (!q || !e || !ACTIVE.has(e.status)) return;
      const idxs = q.sequential ? [this._currentIdx(q, e)] : q.objectives.map((_, i) => i);
      for (const i of idxs) {
        if (i < 0 || !ACTIVE.has(e.status)) continue;
        const o = q.objectives[i];
        if (!STATE_BASED.has(o.type)) continue;
        const v = this._stateValue(o, opts);
        if (v != null && v !== e.progress[i]) this._advance(id, i, 0, null, { set: v, silent: opts.silent });
      }
    },
    _stateValue(o, opts = {}) {
      if (o.type === 'collect') return o.item ? (G.sys.inventory?.count?.(o.item) ?? (Number(G.state.inventory?.[o.item]) || 0)) : null;
      if (o.type === 'visit_all') { const v = G.state.visited || {}; return (G.data.visitZones || []).filter((z) => v[z] || z === opts.zoneId).length; }
      if (o.type === 'level') return G.state.stats?.level || 1;
      return null;
    },

    /** an objective just became current: complete it right away if the player already satisfies it */
    _checkImmediate(id) {
      const q = defs()[id], e = G.state?.quests?.[id];
      if (!q || !e || !ACTIVE.has(e.status) || !G.sys.player?.position) return;
      const idxs = q.sequential ? [this._currentIdx(q, e)] : q.objectives.map((_, i) => i);
      const p = G.sys.player.position;
      for (const i of idxs) {
        if (i < 0 || !ACTIVE.has(e.status)) continue;
        const o = q.objectives[i];
        if (o.type !== 'visit' || (e.progress[i] || 0) >= (o.count || 1)) continue;
        if (o.zone && G.world.zoneAt(p.x, p.z)?.id === o.zone) this._advance(id, i, 1);
        else if (o.poi && G.world.poiAt(p.x, p.z)?.id === o.poi) this._advance(id, i, 1);
      }
    },
    _checkAllImmediate() { for (const id of Object.keys(defs())) if (ACTIVE.has(G.state.quests[id]?.status)) this._checkImmediate(id); },

    _bindEvents() {
      const on = (name, fn) => G.bus.on(name, (p) => { try { fn(p || {}); } catch (e) { G.log.error('QUEST', `handler ${name}`, e); } });
      const talk = (npcId) => { if (npcId) this._event('talk', (o) => !o.npc || o.npc === npcId, npcId); };
      on('npc:talk', (p) => talk(p.npcId));
      on('dialogue:end', (p) => talk(p.npcId));
      on('zone:enter', (p) => {
        if (p.zoneId) this._event('visit', (o) => o.zone === p.zoneId, null);
        this._eachActive((id) => this._evalStateType(id, 'visit_all', null, { zoneId: p.zoneId }));
        this._targetsDirty = true;
      });
      on('poi:enter', (p) => { if (p.poiId) this._event('visit', (o) => o.poi === p.poiId, null); });
      on('farm:watered', (p) => this._event('water', (o) => cropOk(o, p.cropId) && (!o.plot || o.plot === p.plotId), null));
      on('farm:planted', (p) => this._event('plant', (o) => cropOk(o, p.cropId) && (!o.plot || o.plot === p.plotId), null));
      on('farm:harvested', (p) => this._event('harvest', (o) => cropOk(o, p.cropId) && (!o.plot || o.plot === p.plotId), null));
      on('ferment:checked', (p) => this._event('ferment_check', (o) => !o.jar || o.jar === p.jarId, null));
      on('ferment:started', (p) => this._event('ferment_start', (o) => (!o.recipe || o.recipe === p.recipeId) && (!o.jar || o.jar === p.jarId), null));
      on('ferment:claimed', (p) => this._event('ferment_claim', (o) => (!o.recipe || o.recipe === p.recipeId) && (!o.jar || o.jar === p.jarId), null));
      on('craft:done', (p) => this._event('craft', (o) => !o.craft || o.craft === p.craftId, null));
      const edu = (p) => { if (p.eduId) this._event('edu', (o) => !o.edu || o.edu === p.eduId, p.eduId); };
      on('edu:viewed', edu);
      on('edu:completed', edu);
      on('quiz:answered', (p) => { if (p.correct) this._event('quiz', (o) => (!o.quiz || o.quiz === p.quizId) && (!o.edu || G.data.quizzes?.[p.quizId]?.edu === o.edu), p.quizId || G.util.uid('quiz')); });
      on('journal:created', () => this._event('journal', () => true, null));
      on('photo:taken', (p) => this._event('photo', (o) => (o.photoZone === '*' ? !!p.photoZoneId : (!o.photoZone || o.photoZone === p.photoZoneId)), null));
      on('emote:played', (p) => this._event('emote', (o) => !o.emote || o.emote === p.emoteId, null));
      on('gesture:played', (p) => this._event('gesture', (o) => !o.gesture || o.gesture === p.gestureId, null));
      on('chat:sent', () => this._event('chat', () => true, null));
      on('interact', (p) => {
        if (p.kind === 'npc') talk(p.id); // robust even when the dialogue system is absent (deduped per NPC)
        this._event('interact', (o) => (!o.kind || o.kind === p.kind) && (!o.id || o.id === p.id), p.id || p.kind);
        this._targetsDirty = true;
      });
      const inv = (p) => { this._eachActive((id) => this._evalStateType(id, 'collect', p.itemId)); this._targetsDirty = true; };
      on('item:added', inv);
      on('item:removed', inv);
      on('level:up', () => { this._eachActive((id) => this._evalStateType(id, 'level')); this._refreshAvailability(); });
      on('ferment:completed', () => { this._targetsDirty = true; });
      on('photo:mode', (p) => { this._photoMode = !!p.active; });
      on('ui:modal-close', ({ id }) => { if (id === 'quest-log') { this._logModal = null; G.ui.setActive('quests', false); } });
    },
    _eachActive(fn) { if (!G.state || !this._loaded) return; for (const id of Object.keys(defs())) if (ACTIVE.has(G.state.quests[id]?.status)) fn(id); },
    _evalStateType(id, type, itemId, opts) {
      const q = defs()[id];
      if (!q.objectives.some((o) => o.type === type && (!itemId || o.item === itemId))) return;
      this._evalState(id, opts);
    },

    // ------------------------------------------------------------ quest panel (#quest-list)
    _panelQuests() {
      const st = G.state.quests;
      const rows = [];
      let order = 0;
      for (const [id, q] of Object.entries(defs())) {
        order++;
        const e = st[id];
        if (!e || !(ACTIVE.has(e.status) || e.status === 'completed')) continue;
        const rank = q.category === 'main' ? 0 : e.status === 'completed' ? 1 : e.tracked ? 2 : 3;
        rows.push({ id, q, e, rank, order });
      }
      rows.sort((a, b) => a.rank - b.rank || a.order - b.order);
      return rows.slice(0, MAX_PANEL);
    },

    _rewardHtml(r) {
      if (!r) return '';
      if (r.coin) return `<span class="ico ico-sm" data-icon="coin"></span>${fmt(r.coin)}`;
      if (r.exp) return `<span class="q-exp">EXP</span>${fmt(r.exp)}`;
      if (r.edu) return `<span class="emoji">📘</span>${fmt(r.edu)}`;
      return '';
    },

    /** keyed, non-destructive render: rows are rewritten only when their content changes, so a click on
     *  "보상 받기" can never be swallowed by a refresh between mousedown and mouseup */
    _renderPanel() {
      const list = document.getElementById('quest-list');
      if (!list || !G.state) return;
      const rows = this._panelQuests();
      const t = performance.now();
      if (!rows.length) {
        const anyLeft = Object.keys(defs()).some((id) => G.state.quests[id]?.status !== 'claimed');
        const html = `<div class="quest-empty"><span class="emoji">${anyLeft ? '🧭' : '🎉'}</span><p>${anyLeft ? '진행 중인 퀘스트가 없어요.<br><b>NPC</b>에게 말을 걸어 새 퀘스트를 받아 보세요.' : '모든 퀘스트를 완료했어요!<br>자유롭게 체험관을 즐겨 보세요.'}</p></div>`;
        if (list._emptyHtml !== html) { list.innerHTML = html; list._emptyHtml = html; }
        return;
      }
      list._emptyHtml = null;
      const keep = new Map();
      for (const el of Array.from(list.children)) {
        if (el.dataset && el.dataset.quest) keep.set(el.dataset.quest, el); else el.remove();
      }
      let prev = null;
      for (const { id, q, e } of rows) {
        const p = this.progress(id);
        const multi = q.objectives.length > 1;
        const done = e.status === 'completed';
        const cur = p.current >= 0 ? q.objectives[p.current] : null;
        const count = done ? '완료' : multi ? `${p.done}/${p.total}` : `${fmt(p.objectives[0].value)}/${fmt(p.objectives[0].target)}`;
        const desc = multi && cur ? `▸ ${cur.text}${(cur.count || 1) > 1 ? ` (${fmt(e.progress[p.current] || 0)}/${fmt(cur.count)})` : ''}` : q.desc;
        const foot = done
          ? `<div class="q-foot q-foot-done"><span class="q-reward">${this._rewardHtml(q.reward)}</span><button class="btn btn-gold btn-sm q-claim" data-claim="${esc(id)}" type="button">보상 받기</button></div>`
          : `<div class="q-foot"><div class="bar q-bar"><i style="width:${Math.round(p.ratio * 100)}%"></i></div><span class="q-reward">${this._rewardHtml(q.reward)}</span></div>`;
        const html = `<span class="q-ico emoji">${esc(q.icon || '📜')}${q.category === 'main' ? '<span class="q-tag">메인</span>' : ''}</span>
          <span class="q-title">${esc(q.title)}</span><span class="q-count">${esc(count)}</span>
          ${done ? '' : `<span class="q-desc">${esc(desc)}</span>`}${foot}`;
        let el = keep.get(id);
        if (!el) {
          el = document.createElement('div');
          el.dataset.quest = id;
          el.setAttribute('role', 'button');
          el.tabIndex = 0;
        }
        keep.delete(id);
        if (el._html !== html) { el.innerHTML = html; el._html = html; G.ui.hydrateIcons(el); }
        const cls = ['quest-item', done ? 'done' : '', q.category === 'main' ? 'q-main' : '', e.tracked ? 'tracked' : '',
          this._fresh[id] && t - this._fresh[id] < 6000 ? 'q-new' : '', this._flash[id] && t - this._flash[id] < 900 ? 'q-flash' : ''].filter(Boolean).join(' ');
        if (el.className !== cls) el.className = cls;
        el.setAttribute('aria-label', `${q.title} ${count}`);
        const ref = prev ? prev.nextSibling : list.firstChild;
        if (el !== ref) list.insertBefore(el, ref);
        prev = el;
      }
      for (const el of keep.values()) el.remove();
      // clear transient classes later (class-only updates, no DOM replacement)
      const pend = Object.values(this._fresh).concat(Object.values(this._flash)).some((v) => t - v < 6000);
      if (pend) { clearTimeout(this._panelTimer); this._panelTimer = setTimeout(() => { this._panelRefresh = true; }, 1000); }
    },

    _updateBadge() {
      if (!G.state) return;
      const n = Object.keys(defs()).filter((id) => G.state.quests[id]?.status === 'completed').length;
      G.ui.setBadge('quests', n);
    },

    setCollapsed(on, persist = true) {
      this._collapsed = !!on;
      const panel = document.getElementById('quest-panel');
      if (panel) {
        panel.classList.toggle('collapsed', this._collapsed);
        const btn = panel.querySelector('[data-action="quest-collapse"]');
        if (btn) {
          const ico = btn.querySelector('[data-icon]');
          if (ico) G.ui.setIcon(ico, this._collapsed ? 'plus' : 'minus');
          btn.title = this._collapsed ? '펼치기' : '접기';
          btn.setAttribute('aria-label', this._collapsed ? '퀘스트 펼치기' : '퀘스트 접기');
          btn.setAttribute('aria-expanded', String(!this._collapsed));
        }
      }
      if (persist) { try { localStorage.setItem(LS_COLLAPSE, this._collapsed ? '1' : '0'); } catch (e) { /* storage blocked */ } }
    },

    // ------------------------------------------------------------ NPC '!' / '?' markers
    _updateNpcMarkers() {
      const npc = G.sys.npc;
      if (!npc?.setMarker || !G.state) return;
      const want = {};
      for (const id of Object.keys(G.data.npcs || {})) want[id] = null;
      for (const [id, q] of Object.entries(defs())) {
        const e = G.state.quests[id];
        if (!e) continue;
        if (q.giver && e.status === 'available' && !q.autoAccept && want[q.giver] !== '?') want[q.giver] = '!';
        if (q.giver && e.status === 'completed') want[q.giver] = '?';
        if (ACTIVE.has(e.status)) {
          const i = this._currentIdx(q, e);
          const idxs = q.sequential ? [i] : q.objectives.map((_, k) => k);
          for (const k of idxs) {
            const o = q.objectives[k];
            if (k >= 0 && o.type === 'talk' && o.npc && (e.progress[k] || 0) < (o.count || 1)) want[o.npc] = '?';
          }
        }
      }
      for (const [id, m] of Object.entries(want)) {
        if (this._npcMarks[id] === m) continue;
        try { npc.setMarker(id, m); this._npcMarks[id] = m; } catch (e) { /* NPC not spawned yet: retry next tick */ }
      }
    },

    // ------------------------------------------------------------ targets & 3D markers
    /** world target for an objective -> {x, z, y, gemY, follow, followOff, beam, kind, label} | null */
    _targetFor(id, i) {
      const q = defs()[id], e = G.state.quests[id], o = q.objectives[i];
      const loc = (x, z, h, kind, label, beam = true) => { const y = ground(x, z); return { x, z, y, gemY: y + h, follow: null, followOff: 0, beam, kind, label }; };
      switch (o.type) {
        case 'talk': return o.npc ? this._npcTarget(o.npc, o.text) : null;
        case 'visit': {
          if (o.zone) { const z = zoneDef(o.zone); return z ? loc(z.center[0], z.center[1], 2.6, 'zone', z.name) : null; }
          if (o.poi) { const p = poiDef(o.poi); return p ? loc(p.x, p.z, 2.6, 'poi', p.name) : null; }
          return null;
        }
        case 'visit_all': {
          const v = G.state.visited || {};
          const z = nearestOf((G.data.visitZones || []).filter((zid) => !v[zid]).map((zid) => { const zd = zoneDef(zid); return zd ? { x: zd.center[0], z: zd.center[1], name: zd.name } : null; }));
          return z ? loc(z.x, z.z, 2.6, 'zone', z.name) : null;
        }
        case 'water': case 'harvest': case 'plant': return this._plotTarget(o);
        case 'collect': {
          const crop = Object.values(G.data.crops || {}).find((c) => c.harvestItem === o.item);
          if (crop) return this._plotTarget({ type: 'harvest', crop: crop.id });
          const s = L().shopStall;
          if (s && Object.values(G.data.shops || {}).some((sh) => sh.sells?.includes(o.item))) return loc(s.x, s.z, 3.4, 'shop', '매점');
          return null;
        }
        case 'ferment_check': case 'ferment_start': case 'ferment_claim': {
          const jars = myJars();
          let j = null;
          if (o.jar) j = (L().jars || []).find((x) => x.id === o.jar);
          else if (o.type === 'ferment_start') j = nearestOf(jars, (x) => ['EMPTY', 'CLAIMED'].includes(jarStatus(x.id)));
          else if (o.type === 'ferment_claim') j = nearestOf(jars, (x) => jarStatus(x.id) === 'COMPLETE' && (!o.recipe || G.state.jars?.[x.id]?.recipeId === o.recipe));
          if (!j) j = (L().jars || []).find((x) => x.id === 'J1');
          return j ? this._objTarget(j.id, j.x, j.z, 2.1, 'jar', '내 장독') : null;
        }
        case 'edu': case 'quiz': {
          let eduId = o.edu || null;
          if (o.type === 'quiz' && o.quiz) eduId = G.data.quizzes?.[o.quiz]?.edu || eduId;
          const pool = [];
          for (const s of L().signs || []) if (s.action === 'edu' && (!eduId || s.edu === eduId)) pool.push({ x: s.x, z: s.z, h: 2.7, kind: 'sign', name: s.title });
          for (const k of L().kiosks || []) if (!eduId || k.edu === eduId) pool.push({ x: k.x, z: k.z, h: 2.6, kind: 'kiosk', name: k.title });
          if (o.type === 'edu') for (const x of L().exhibits || []) if (!eduId || x.edu === eduId) pool.push({ x: x.x, z: x.z, h: 2.2, kind: 'exhibit', name: x.title });
          const best = nearestOf(o.type === 'quiz' && !eduId ? pool.filter((p) => p.kind === 'kiosk') : pool);
          return best ? loc(best.x, best.z, best.h, best.kind, best.name) : null;
        }
        case 'photo': {
          const pz = nearestOf(L().photoZones || [], (z) => !o.photoZone || o.photoZone === '*' || z.id === o.photoZone);
          return pz ? loc(pz.x, pz.z, 2.4, 'photo', `포토존 · ${pz.name}`) : null;
        }
        case 'craft': {
          // 쉬운 모드: short of an ingredient (e.g. 콩 3개 for 메주) -> lead to where it comes from first, not to a
          // workbench whose picture is locked (08-easy says "콩을 모아요 1/3" for the same case)
          const need = easyOn() && o.craft ? this.craftNeed(o.craft) : null;
          if (need) { const t = this._ingredientTarget(need, loc); if (t) return t; }
          const c = L().craftTable; return c ? this._objTarget(c.id, c.x, c.z, 2.3, 'craft', c.title || '작업대') : null;
        }
        case 'interact': {
          const seen = e.seen?.[i] || [];
          if (o.id) { const a = L().get?.(o.id); return a ? this._objTarget(o.id, a.x, a.z, 2.2, o.kind || 'object', a.name || a.title || '') : null; }
          const byKind = { tool: L().tools, sign: L().signs, kiosk: L().kiosks, exhibit: L().exhibits, jardisp: L().jarDisplays, jar: L().jars, photo: L().photoZones };
          const arr = byKind[o.kind];
          if (!arr) return null;
          const a = nearestOf(arr, (x) => !seen.includes(x.id));
          return a ? this._objTarget(a.id, a.x, a.z, o.kind === 'tool' ? 1.9 : 2.3, o.kind, a.name || a.title || '') : null;
        }
        default: return null;
      }
    },
    _npcTarget(npcId, label) {
      let rec = null;
      try { rec = G.sys.npc?.get?.(npcId) || null; } catch (e) { rec = null; }
      const group = rec?.group || null;
      const n = G.data.npcs?.[npcId];
      if (!group && !n) return null;
      const h = (rec?.rig?.height || 1.45) + 0.95;
      const x = n?.pos?.[0] ?? 0, z = n?.pos?.[1] ?? 0;
      const y = ground(x, z);
      return { x, z, y, gemY: y + h, follow: group, followOff: h, beam: true, beamFromGem: true, kind: 'npc', npc: npcId, label: label || n?.name || '' };
    },
    _objTarget(id, x, z, h, kind, label) {
      const obj = G.world.getObject?.(id);
      const y = ground(x, z);
      return { id, x, z, y, gemY: y + h, follow: null, followOff: 0, beam: true, kind, label, _obj: obj };
    },
    /** where an ingredient comes from: its crop's ripe / growing bed -> an empty bed (seeds in the bag) -> the shop */
    _ingredientTarget(need, loc) {
      if (need.crop) {
        const t = this._plotTarget({ type: 'harvest', crop: need.crop });
        if (t) return t;
        const seed = G.data.crops?.[need.crop]?.seedItem;
        if (seed && (Number(G.sys.inventory?.count?.(seed)) || 0) > 0) { const p = this._plotTarget({ type: 'plant', crop: need.crop }); if (p) return p; }
      }
      const s = L().shopStall;
      return s ? loc(s.x, s.z, 3.4, 'shop', '매점') : null;
    },
    _plotTarget(o) {
      const plots = L().farmPlots || [];
      if (!plots.length) return null;
      let best = null;
      if (o.type === 'plant') {
        const zoneWanted = o.category === 'herb' || G.data.crops?.[o.crop]?.category === 'herb' ? 'ZONE_HERB' : (o.crop || o.category ? 'ZONE_CROP' : null);
        best = nearestOf(plots, (pd) => !plotInfo(pd).cropId && (!zoneWanted || pd.zone === zoneWanted));
      } else if (o.type === 'water') {
        const cand = plots.filter((pd) => { const s = plotInfo(pd); return s.cropId && cropOk(o, s.cropId) && s.growth < 100; });
        // every starter bed can be ripe already: then any bed with a crop that still takes water (one tap waters it
        // while the water step is current — 40-farming), and with no crop anywhere an empty bed (plant first)
        best = nearestOf(cand, (pd) => plotInfo(pd).water < 65) || nearestOf(cand)
          || nearestOf(plots, (pd) => { const s = plotInfo(pd); return !!s.cropId && cropOk(o, s.cropId) && s.water < 95; })
          || nearestOf(plots, (pd) => !!plotInfo(pd).cropId)
          || nearestOf(plots, (pd) => !plotInfo(pd).cropId);
      } else {
        const cand = plots.filter((pd) => { const s = plotInfo(pd); return s.cropId && cropOk(o, s.cropId); });
        best = nearestOf(cand, (pd) => plotInfo(pd).growth >= 100);
        if (!best && cand.length) {
          let g = -1;
          for (const pd of cand) { const s = plotInfo(pd); if (s.growth > g) { g = s.growth; best = pd; } }
        }
      }
      if (!best) return null;
      const y = ground(best.x, best.z);
      const s = plotInfo(best);
      const crop = G.data.crops?.[s.cropId];
      return { id: best.id, x: best.x, z: best.z, y, gemY: y + 2.1, follow: null, followOff: 0, beam: true, kind: 'plot', label: crop ? `${best.label}번 ${crop.name}밭` : `${best.label}번 밭` };
    },

    /**
     * What the player should do next (one priority order for the 3D marker, the hint and the minimap):
     * active main quest -> claimable reward -> tracked objective with a world target -> quest giver (!) ->
     * tracked objective without a target (journal, emote...) -> any active objective.
     * -> {mode: 'objective'|'claim'|'giver', questId, objective, target}
     */
    _pickFocus(rows) {
      const st = G.state.quests;
      const ids = Object.keys(defs());
      const mainId = ids.find((id) => defs()[id].category === 'main');
      const ms = mainId ? st[mainId]?.status : null;
      const objFocus = (id) => { const q = defs()[id], e = st[id]; const i = this._currentIdx(q, e); return i >= 0 ? { mode: 'objective', questId: id, objective: i } : null; };
      if (mainId && ACTIVE.has(ms)) { const f = objFocus(mainId); if (f) return f; }
      if (mainId && ms === 'completed') return { mode: 'claim', questId: mainId, objective: -1 };
      const claim = ids.find((id) => st[id]?.status === 'completed');
      if (claim) return { mode: 'claim', questId: claim, objective: -1 };
      let noTarget = null;
      for (const r of rows) {
        if (!ACTIVE.has(r.e.status) || !r.e.tracked) continue;
        const f = objFocus(r.id);
        if (!f) continue;
        let t = null;
        try { t = this._targetFor(r.id, f.objective); } catch (err) { t = null; }
        if (t) return f;
        noTarget = noTarget || f;
      }
      const giverQ = ids.find((id) => st[id]?.status === 'available' && defs()[id].giver && !defs()[id].autoAccept);
      if (giverQ) return { mode: 'giver', questId: giverQ, objective: -1 };
      if (noTarget) return noTarget;
      for (const r of rows) if (ACTIVE.has(r.e.status)) { const f = objFocus(r.id); if (f) return f; }
      return null;
    },

    _computeTargets() {
      this._targets.length = 0;
      this._mapMarkers.length = 0;
      this._focus = null;
      if (!G.state) return;
      const rows = this._panelQuests();
      const push = (t, qid, key, primary) => {
        if (!t || this._targets.length >= MAX_MARKERS) return null;
        if (this._targets.some((o) => d2(o.x, o.z, t.x, t.z) < 9)) return null; // dedupe near-identical spots
        t.questId = qid; t.primary = primary;
        t.key = `${key}:${Math.round(t.x)}:${Math.round(t.z)}`;
        this._targets.push(t);
        return t;
      };
      const add = (qid, i, primary) => {
        let t = null;
        try { t = this._targetFor(qid, i); } catch (e) { G.log.warn('QUEST', 'target failed', qid, e); }
        return push(t, qid, `${qid}:${i}`, primary);
      };
      const f = this._pickFocus(rows);
      if (f) {
        this._focus = { ...f, target: null };
        if (f.mode === 'objective') {
          this._focus.target = add(f.questId, f.objective, true);
          const q = defs()[f.questId], e = G.state.quests[f.questId];
          if (!q.sequential) for (let i = 0; i < q.objectives.length; i++) if (i !== f.objective && (e.progress[i] || 0) < (q.objectives[i].count || 1)) add(f.questId, i, false);
        } else if (f.mode === 'giver') {
          const q = defs()[f.questId];
          this._focus.target = push(this._npcTarget(q.giver, `${npcName(q.giver)} · 새 퀘스트`), f.questId, `giver:${q.giver}`, true);
        }
      }
      // secondary markers: the other tracked quests' current objectives
      for (const r of rows) {
        if ((f && r.id === f.questId) || !ACTIVE.has(r.e.status) || !(r.e.tracked || r.q.category === 'main')) continue;
        const i = this._currentIdx(r.q, r.e);
        if (i >= 0) add(r.id, i, false);
      }
      // minimap markers: objective targets + quest givers
      for (const t of this._targets) this._mapMarkers.push({ x: t.x, z: t.z, kind: t.kind === 'npc' && t.key.startsWith('giver:') ? 'giver' : 'quest', label: t.label, primary: !!t.primary, questId: t.questId, _t: t });
      for (const [id, q] of Object.entries(defs())) {
        const e = G.state.quests[id];
        if (!q.giver || !e) continue;
        const kind = e.status === 'available' && !q.autoAccept ? 'giver' : e.status === 'completed' ? 'turnin' : null;
        if (!kind) continue;
        const n = G.data.npcs?.[q.giver];
        if (!n || this._mapMarkers.some((m) => m.npc === q.giver || (m._t && m._t.key.startsWith(`giver:${q.giver}:`)))) continue;
        let g = null;
        try { g = G.sys.npc?.get?.(q.giver)?.group || null; } catch (err) { g = null; }
        this._mapMarkers.push({ x: n.pos[0], z: n.pos[1], kind, label: `${n.name} ${kind === 'giver' ? '!' : '?'}`, primary: false, questId: id, npc: q.giver, _g: g });
      }
    },

    _animateMarkers(dt, t) {
      const ms = this._markers;
      if (!ms.length) return;
      const hide = this._photoMode || !this._loaded;
      const p = G.sys.player?.position;
      const reduce = G.settings.reduceMotion;
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k];
        const tg = this._targets[k] || null;
        if (m.key !== (tg ? tg.key : null)) { m.key = tg ? tg.key : null; m.fade = 0; }
        m.target = tg;
        if (!tg || hide) { m.group.visible = false; continue; }
        // follow moving targets (NPCs)
        if (tg.follow) {
          tg.follow.getWorldPosition(_mv);
          tg.x = _mv.x; tg.z = _mv.z; tg.y = _mv.y; tg.gemY = _mv.y + tg.followOff;
        }
        m.fade = Math.min(1, m.fade + dt * 2.5);
        const dist = p ? Math.hypot(tg.x - p.x, tg.z - p.z) : 30;
        const far = G.util.clamp((dist - 16) / 55, 0, 1.3);
        const base = (tg.primary ? 1 : 0.78) * (1 + far);
        const near = G.util.clamp((dist - 2.2) / 6, 0.12, 1);
        const g = m.group;
        g.visible = true;
        g.position.set(tg.x, tg.y, tg.z);
        const bob = reduce ? 0 : Math.sin(t * 2.3 + m.phase) * 0.13;
        const gy = tg.gemY - tg.y + bob + far * 0.6;
        m.gemPivot.position.y = gy;
        m.gemPivot.rotation.y = reduce ? 0.6 : t * 1.7 + m.phase;
        m.gemPivot.scale.setScalar(base * (0.6 + 0.4 * m.fade));
        m.glow.position.y = gy;
        m.glow.scale.setScalar(1.7 * base * (0.92 + 0.08 * Math.sin(t * 4.1 + m.phase)));
        m.glowMat.opacity = 0.42 * m.fade * (0.45 + 0.55 * near);
        // beam: from the ground (locations) or from just above the gem (NPC heads)
        if (tg.beam) {
          m.beam.visible = true;
          const from = tg.beamFromGem ? gy + 0.45 * base : 0.05;
          m.beam.position.y = from;
          m.beam.scale.set(base * (tg.primary ? 1 : 0.8), (tg.primary ? 9 : 6.5) * (1 + far * 0.8), base * (tg.primary ? 1 : 0.8));
          m.beamMat.uniforms.uTime.value = t + m.phase;
          m.beamMat.uniforms.uOpacity.value = (tg.primary ? 0.6 : 0.42) * m.fade * near;
        } else m.beam.visible = false;
        // ground ring + ripple + disc (hidden for NPCs that walk around; kept for places)
        const showGround = tg.kind !== 'npc';
        m.ring.visible = m.ripple.visible = m.disc.visible = showGround;
        if (showGround) {
          const rr = tg.kind === 'zone' || tg.kind === 'poi' ? 2.6 : tg.kind === 'plot' ? 2.2 : 1.6;
          m.ring.position.y = m.ripple.position.y = 0.06; m.disc.position.y = 0.04;
          m.ring.scale.setScalar(rr * (1 + (reduce ? 0 : Math.sin(t * 3 + m.phase) * 0.04)));
          m.ringMat.opacity = 0.75 * m.fade * (0.5 + 0.5 * near);
          const ph = reduce ? 0.5 : ((t * 0.55 + m.phase) % 1);
          m.ripple.scale.setScalar(rr * (0.55 + ph * 1.1));
          m.rippleMat.opacity = (1 - ph) * 0.7 * m.fade;
          m.disc.scale.setScalar(rr * 2.1);
          m.discMat.opacity = 0.32 * m.fade;
        }
      }
      // keep minimap markers glued to moving NPCs
      for (const mm of this._mapMarkers) {
        if (mm._t) { mm.x = mm._t.x; mm.z = mm._t.z; }
        else if (mm._g) { mm._g.getWorldPosition(_mv); mm.x = _mv.x; mm.z = _mv.z; }
      }
    },

    // ------------------------------------------------------------ objective hint (top center)
    /** let another system (e.g. onboarding coach marks) own #objective-hint for a while */
    suspendHint(on) { this._hintSuspended = !!on; this._hintKey = ''; if (on) this._arrow?.remove(); },

    _updateHint() {
      if (this._hintSuspended) return;
      if (!G.state) { G.ui.objective(null); return; }
      let text = null, label = '현재 목표', dist = null, done = false;
      const f = this._focus;
      if (f) {
        const q = defs()[f.questId], e = G.state.quests[f.questId];
        if (f.mode === 'claim') {
          done = true;
          label = q.category === 'main' ? '퀘스트 완료' : '보상 대기';
          text = `「${q.title}」 — 퀘스트 패널에서 ‘보상 받기’를 눌러 주세요`;
        } else if (f.mode === 'giver') {
          label = '새 퀘스트';
          text = `${npcName(q.giver)}에게 말을 걸어 「${q.title}」 퀘스트를 받아 보세요`;
        } else {
          const o = q.objectives[f.objective];
          const n = o.count || 1;
          text = `${o.text}${n > 1 ? ` (${fmt(e.progress[f.objective] || 0)}/${fmt(n)})` : ''}`;
          label = q.category === 'main' ? `현재 목표 ${f.objective + 1}/${q.objectives.length}` : '현재 목표';
        }
        const tg = f.target, p = G.sys.player?.position;
        if (tg && p) dist = Math.hypot(tg.x - p.x, tg.z - p.z);
      }
      const showDist = dist != null && dist > 3;
      const key = `${label}|${text}|${showDist ? Math.round(dist) : ''}`;
      if (key === this._hintKey) return;
      this._hintKey = key;
      G.ui.objective(text, { label, dist: showDist ? dist : null });
      const el = document.getElementById('objective-hint');
      if (el && text) {
        el.classList.toggle('oh-done', done);
        if (showDist) el.prepend(this._arrow); else this._arrow.remove();
      }
    },

    _updateArrow() {
      const a = this._arrow;
      if (!a || !a.isConnected) return;
      const tg = this._focus?.target, p = G.sys.player?.position;
      const basis = G.sys.camera?.getMoveBasis?.();
      if (!tg || !p || !basis) return;
      const dx = tg.x - p.x, dz = tg.z - p.z;
      const fx = basis.forward.x * dx + basis.forward.z * dz;
      const rx = basis.right.x * dx + basis.right.z * dz;
      const ang = Math.atan2(rx, fx);
      const deg = Math.round(ang * 57.2958);
      if (deg !== this._arrowDeg) { this._arrowDeg = deg; a.style.transform = `rotate(${deg}deg)`; }
    },

    // ------------------------------------------------------------ quest log modal
    toggleLog() {
      if (easyOn() && G.sys.progression?.openHub) {
        // 쉬운 모드: quests live on the 스티커북's 📜 할 일 tab (one place, no duplicate quest window)
        const hub = G.ui.modal.get('collection');
        if (hub && G.ui.modal.top() === hub && hub._kidTab === 'quest') { hub.close(); return; }
        if (G.ui.isBlocking() && !hub && G.ui.blockers && [...G.ui.blockers].some((k) => !String(k).startsWith('modal:'))) return;
        G.sys.progression.openHub('quest');
        return;
      }
      if (this._logModal && !this._logModal.closed && G.ui.modal.top() === this._logModal) { this._logModal.close(); return; }
      if (G.ui.isBlocking() && !(this._logModal && !this._logModal.closed)) {
        if (G.ui.blockers && [...G.ui.blockers].some((k) => !String(k).startsWith('modal:'))) return;
      }
      this.openLog();
    },

    _tabOf(status) { return status === 'completed' ? 'claimable' : status === 'claimed' ? 'done' : (ACTIVE.has(status) || status === 'available') ? 'active' : 'all'; },

    openLog(tab, questId, opts = {}) {
      if (!G.state) return null;
      if (easyOn() && !opts.normal && G.sys.progression?.openHub) return G.sys.progression.openHub('quest');
      const ALIAS = { progress: 'active', accepted: 'active', available: 'active', '진행중': 'active', '진행 중': 'active', completed: 'claimable', reward: 'claimable', '완료 가능': 'claimable', '보상 대기': 'claimable', claimed: 'done', '완료': 'done', '전체': 'all' };
      if (tab && ALIAS[tab]) tab = ALIAS[tab];
      if (tab && !['active', 'claimable', 'done', 'all'].includes(tab)) tab = null;
      if (questId && defs()[questId]) { this._logSel = questId; if (!tab) tab = this._tabOf(this.status(questId)); }
      if (tab) this._logTab = tab;
      else if (!questId) {
        const anyClaimable = Object.keys(defs()).some((id) => G.state.quests[id]?.status === 'completed');
        this._logTab = anyClaimable ? 'claimable' : 'active';
      }
      const m = G.ui.modal.open({
        id: 'quest-log', title: '퀘스트', icon: 'quest', size: 'xl', className: 'quest-log-modal',
        body: (body) => { body.innerHTML = '<div class="ql-tabs"></div><div class="ql-layout"><div class="ql-list" role="listbox" aria-label="퀘스트 목록"></div><section class="ql-detail" aria-live="polite"></section></div>'; },
      });
      this._logModal = m;
      G.ui.setActive('quests', true);
      this._renderLog();
      return m;
    },

    _logLists() {
      const st = G.state.quests;
      const ids = Object.keys(defs());
      return {
        active: ids.filter((id) => ACTIVE.has(st[id]?.status) || st[id]?.status === 'available'),
        claimable: ids.filter((id) => st[id]?.status === 'completed'),
        done: ids.filter((id) => st[id]?.status === 'claimed'),
        all: ids,
      };
    },

    _renderLog() {
      const m = this._logModal;
      if (!m || m.closed || !G.state) return;
      const lists = this._logLists();
      const tabsEl = m.body.querySelector('.ql-tabs');
      const TABS = [{ id: 'active', label: '진행 중' }, { id: 'claimable', label: '보상 대기' }, { id: 'done', label: '완료' }, { id: 'all', label: '전체' }];
      if (!tabsEl._api) tabsEl._api = G.ui.tabs(tabsEl, TABS, (id) => { if (this._logTab !== id) { this._logTab = id; this._logSel = null; } if (tabsEl._api) this._renderLogBody(); }, this._logTab);
      for (const b of tabsEl.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === this._logTab);
      for (const b of tabsEl.querySelectorAll('.tab')) {
        let c = b.querySelector('.tab-count');
        if (!c) { c = G.ui.h('span', { class: 'tab-count' }); b.appendChild(c); }
        const n = lists[b.dataset.tab]?.length || 0;
        c.textContent = String(n);
        b.classList.toggle('has-gold', b.dataset.tab === 'claimable' && n > 0);
      }
      this._renderLogBody();
    },

    _renderLogBody() {
      const m = this._logModal;
      if (!m || m.closed || !G.state) return;
      const lists = this._logLists();
      const ids = lists[this._logTab] || lists.all;
      const listEl = m.body.querySelector('.ql-list');
      if (!this._logSel || !ids.includes(this._logSel)) this._logSel = ids[0] || null;
      const scroll = listEl.scrollTop;
      listEl.innerHTML = '';
      const st = G.state.quests;
      const section = (title) => listEl.appendChild(G.ui.h('div', { class: 'ql-section' }, title));
      let lastGroup = null;
      const sorted = ids.slice().sort((a, b) => {
        const ra = this._logRank(a), rb = this._logRank(b);
        return ra - rb;
      });
      for (const id of sorted) {
        const q = defs()[id], e = st[id];
        if (this._logTab === 'active') {
          const g = e.status === 'available' ? '새로 받을 수 있는 퀘스트' : '진행 중인 퀘스트';
          if (g !== lastGroup) { section(g); lastGroup = g; }
        }
        const p = this.progress(id);
        const item = G.ui.h('button', { type: 'button', role: 'option', class: `ql-item s-${e.status}${id === this._logSel ? ' selected' : ''}${q.category === 'main' ? ' q-main' : ''}`, 'aria-selected': id === this._logSel ? 'true' : 'false', dataset: { id } },
          G.ui.h('span', { class: 'ql-ico emoji' }, e.status === 'locked' ? '🔒' : (q.icon || '📜')),
          G.ui.h('span', { class: 'ql-main' },
            G.ui.h('span', { class: 'ql-title' }, q.title),
            G.ui.h('span', { class: 'ql-meta' }, G.ui.h('span', { class: 'chip' }, CAT_LABEL[q.category] || '퀘스트'), G.ui.h('span', { class: `chip ${STATUS_CHIP[e.status] || ''}` }, STATUS_LABEL[e.status] || e.status), e.tracked && ACTIVE.has(e.status) ? G.ui.h('span', { class: 'ql-track', title: '추적 중' }, '📍') : null),
            ACTIVE.has(e.status) ? G.ui.h('span', { class: 'bar ql-bar', html: `<i style="width:${Math.round(p.ratio * 100)}%"></i>` }) : null));
        item.addEventListener('click', () => { this._logSel = id; this._renderLogBody(); });
        listEl.appendChild(item);
      }
      if (!sorted.length) listEl.appendChild(G.ui.h('div', { class: 'empty' }, this._logTab === 'claimable' ? '받을 보상이 없어요.' : this._logTab === 'done' ? '아직 완료한 퀘스트가 없어요.' : '진행 중인 퀘스트가 없어요.'));
      listEl.scrollTop = scroll;
      const sel = listEl.querySelector('.ql-item.selected');
      if (sel && (sel.offsetTop < listEl.scrollTop || sel.offsetTop + sel.offsetHeight > listEl.scrollTop + listEl.clientHeight)) sel.scrollIntoView({ block: 'nearest' });
      this._renderLogDetail();
    },
    _logRank(id) {
      const q = defs()[id], s = G.state.quests[id].status;
      const sr = { completed: 0, progress: 1, accepted: 1, available: 2, locked: 4, claimed: 3 }[s] ?? 5;
      return sr * 100 + (q.category === 'main' ? 0 : 10) + Object.keys(defs()).indexOf(id) * 0.01;
    },

    _renderLogDetail() {
      const m = this._logModal;
      if (!m || m.closed) return;
      const pane = m.body.querySelector('.ql-detail');
      pane.innerHTML = '';
      const id = this._logSel;
      const q = defs()[id];
      if (!q) { pane.appendChild(G.ui.h('div', { class: 'ql-empty' }, G.ui.h('span', { class: 'emoji' }, '📜'), G.ui.h('p', {}, '퀘스트를 선택하면 자세한 내용을 볼 수 있어요.'))); return; }
      const e = G.state.quests[id];
      const p = this.progress(id);
      const giver = q.giver ? G.data.npcs?.[q.giver] : null;
      const giverZone = giver ? zoneDef(giver.zone)?.name : null;
      pane.appendChild(G.ui.h('div', { class: 'ql-head' },
        G.ui.h('div', { class: 'ql-head-ico' }, G.ui.h('span', { class: 'emoji' }, q.icon || '📜')),
        G.ui.h('div', { class: 'ql-head-txt' },
          G.ui.h('div', { class: 'ql-head-chips' }, G.ui.h('span', { class: `chip ${q.category === 'main' ? 'chip-gold' : ''}` }, CAT_LABEL[q.category] || '퀘스트'), G.ui.h('span', { class: `chip ${STATUS_CHIP[e.status] || ''}` }, STATUS_LABEL[e.status])),
          G.ui.h('h3', {}, q.title),
          giver ? G.ui.h('div', { class: 'ql-giver' }, `의뢰인 · ${giver.name}${giverZone ? ` (${giverZone})` : ''}`) : G.ui.h('div', { class: 'ql-giver' }, q.autoAccept ? '자동으로 시작되는 퀘스트' : '체험관 퀘스트'))));
      pane.appendChild(G.ui.h('p', { class: 'ql-desc' }, q.desc));
      if (e.status === 'locked') {
        const req = (q.requires || []).map((r) => `「${defs()[r]?.title || r}」`).join(', ');
        pane.appendChild(G.ui.h('div', { class: 'notice-box' }, `🔒 ${req ? `${req} 퀘스트의 보상을 받으면 열려요.` : ''}${q.minLevel ? ` 레벨 ${q.minLevel} 이상이 필요해요.` : ''}`));
      }
      // objectives checklist
      pane.appendChild(G.ui.h('h4', { class: 'ql-sub' }, `목표 ${q.sequential && q.objectives.length > 1 ? '(순서대로 진행)' : ''}`));
      const ol = G.ui.h('ol', { class: 'ql-objs' });
      p.objectives.forEach((o, i) => {
        const future = q.sequential && !o.done && !o.current && e.status !== 'claimed';
        const state = o.done ? 'done' : o.current && ACTIVE.has(e.status) ? 'current' : future ? 'future' : 'todo';
        ol.appendChild(G.ui.h('li', { class: `ql-obj ${state}` },
          G.ui.h('span', { class: 'ql-check', 'aria-hidden': 'true' }, o.done ? '✓' : state === 'current' ? '▶' : String(i + 1)),
          G.ui.h('span', { class: 'ql-obj-text' }, o.text, state === 'current' && objHint(q.objectives[i]) ? G.ui.h('small', { class: 'ql-hint' }, `💡 ${objHint(q.objectives[i])}`) : null),
          G.ui.h('b', { class: 'ql-obj-count' }, `${fmt(o.value)}/${fmt(o.target)}`)));
      });
      pane.appendChild(ol);
      if (ACTIVE.has(e.status)) pane.appendChild(G.ui.h('div', { class: 'ql-progress' }, G.ui.h('span', { class: 'bar bar-lg', html: `<i style="width:${Math.round(p.ratio * 100)}%"></i>` }), G.ui.h('b', {}, `${Math.round(p.ratio * 100)}%`)));
      // rewards
      const r = q.reward || {};
      const chips = [];
      if (r.coin) chips.push(`<span class="ql-rw"><span class="ico ico-sm" data-icon="coin"></span>${fmt(r.coin)} 코인</span>`);
      if (r.exp) chips.push(`<span class="ql-rw"><span class="emoji">✨</span>EXP ${fmt(r.exp)}</span>`);
      if (r.edu) chips.push(`<span class="ql-rw"><span class="emoji">📘</span>교육 ${fmt(r.edu)}</span>`);
      for (const [it, n] of Object.entries(r.items || {})) chips.push(`<span class="ql-rw"><span class="emoji">${esc(G.data.items?.[it]?.icon || '🎁')}</span>${esc(G.data.items?.[it]?.name || it)} ×${fmt(n)}</span>`);
      if (r.title) chips.push(`<span class="ql-rw ql-rw-title"><span class="emoji">🏅</span>칭호 「${esc(r.title)}」</span>`);
      pane.appendChild(G.ui.h('h4', { class: 'ql-sub' }, '보상'));
      pane.appendChild(G.ui.h('div', { class: 'ql-rewards', html: chips.join('') || '<span class="muted">보상 없음</span>' }));
      if (r.title) pane.appendChild(G.ui.h('p', { class: 'tiny muted' }, G.data.meta?.titleDisclaimer || ''));
      if (e.status === 'claimed' && e.claimedAt) pane.appendChild(G.ui.h('p', { class: 'small dim ql-date' }, `✔ ${G.util.formatDate(e.claimedAt, true)} 완료`));
      // actions
      const act = G.ui.h('div', { class: 'ql-actions' });
      if (e.status === 'available') act.appendChild(G.ui.h('button', { class: 'btn btn-primary', onclick: () => { this.accept(id); this._renderLog(); } }, '퀘스트 수락'));
      if (e.status === 'completed') act.appendChild(G.ui.h('button', { class: 'btn btn-gold btn-lg', onclick: () => { this.claim(id); } }, '🎁 보상 받기'));
      if (ACTIVE.has(e.status)) {
        act.appendChild(G.ui.h('button', { class: `btn ${e.tracked ? 'btn-soft' : 'btn-ghost'}`, onclick: () => { this.track(id, !e.tracked); this._renderLogBody(); } }, e.tracked ? '📍 추적 해제' : '📍 추적하기'));
        const o = q.objectives[p.current];
        const sc = o && this._shortcut(o);
        if (sc) act.appendChild(G.ui.h('button', { class: 'btn btn-soft', onclick: () => { m.close(); sc.fn(); } }, sc.label));
      }
      pane.appendChild(act);
      G.ui.hydrateIcons(pane);
    },

    _shortcut(o) {
      if (o.type === 'journal' && G.sys.journal?.open) return { label: '📝 작업일지 쓰기', fn: () => G.sys.journal.open() };
      if ((o.type === 'edu' || o.type === 'quiz') && G.sys.education?.openLibrary) return { label: '📖 교육 콘텐츠 보기', fn: () => G.sys.education.openLibrary() };
      if (['visit', 'visit_all', 'talk', 'water', 'plant', 'harvest', 'ferment_check', 'ferment_start', 'ferment_claim', 'interact', 'craft', 'photo'].includes(o.type) && G.sys.minimap?.openWorldMap) return { label: '🗺️ 지도 보기', fn: () => G.sys.minimap.openWorldMap() };
      return null;
    },
  };
  const _mv = new THREE.Vector3();

  G.register(quest);
})();
