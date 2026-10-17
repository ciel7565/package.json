// =============================================================================
// 25-npc.js — NPCs (G.sys.npc, order 45) + dialogue system (G.sys.dialogue, order 46)
//
// G.sys.npc
//   get(id) -> {id, data, rig, group, position, marker, talking} | null       list() -> [records]
//   talk(id)                        start the NPC's conversation (fallback without dialogue system: greeting bubble)
//   setMarker(id, '!'|'?'|null)     quest badge over the name tag ('!' gold = new quest, '?' silver-gold = report)
//   say(id, text, {duration, chat}) speech bubble above the head (~3 s), optionally echoed to the chat
//   portrait(id) -> dataURL | null  head-and-shoulders portrait rendered once from the NPC's own avatar
//   icon(id) -> emoji               setTalking(id, bool) / setSpeaking(id, bool) / playAnim(id, anim)
// NPCs come from G.data.npcs (G.avatar.create; capsule fallback). Idle variety (look-around, nods, role
// gestures), wandering within `wander` m of home (G.world.blocked, walkable height, no crops / water), turn and
// look at the player within ~7 m, wave + greeting bubble when the player first comes near, name tag
// (.nametag.npc name + role) with a marker slot, interactable kind 'npc' (id = NPC id) → talk().
// Phase 4 (CONTRACT §13.4): the ! / ? marker is a bouncing, spinning 3D glyph with a soft glow and drifting
// sparkles (shared geometry/materials, built on first use; steps aside while the quest system's own gem hangs over
// the same NPC); its tap target is a transparent DOM button on the same world point (≥ 56 px in 쉬운 모드).
// Idle life: blinking (avatar rig), glances at nearby NPCs / 옹이 / the view, a surprised look at a player racing
// past, a smile while the player stands close, role gestures, and a warm turn towards the player on talk.
//
// G.sys.dialogue
//   start(dialogueId, {npcId, node}) -> bool    close()    active -> {dialogueId, npcId, nodeId, ...} | null
//   choose(index) / advance() / check(cond) / run(actions) / fill(text)
// Bottom-centre glass box in #dialogue-root: gold speaker chip, portrait, typewriter text (click / Space /
// Enter / E skip and continue), numbered choices (1–4, ↑/↓ + Enter), close button, Esc (priority 90).
// Blocks gameplay (G.ui.block('dialogue')), dims the HUD, camera focusOn the NPC, NPC faces the player and
// plays 'talk' while the line types. Optional TTS (G.settings.voiceOver → G.sys.audio.speak).
// Emits npc:talk {npcId} at the start and dialogue:end {npcId, dialogueId} when it closes.
// Data format (conditions / actions / placeholders): see the header of 26-dialogues.js.
// 쉬운 모드 (CONTRACT §12): big portrait + big short kid lines (node.kid / variant.kid, falling back to text),
// every line read aloud with G.easy.say, tap ANYWHERE to continue, choices as 2–3 big picture buttons
// (choice.kid / choice.emoji; choice.easy === false hides grown-up extras), a big "✖ 그만" exit. The first
// greeting of each NPC is read aloud too. Switching modes while talking re-renders the current line.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const smoothstep01 = (x) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
  /** does the quest system's gem marker (G.sys.quest.getMarkers, the minimap list) sit over this NPC? */
  function questGemOn(rec) {
    let list = null;
    try { list = G.sys.quest?.getMarkers?.(); } catch (e) { list = null; }
    if (!Array.isArray(list)) return false;
    const p = rec.group.position;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (m._t && m._t.npc != null) { if (m._t.npc === rec.id) return true; continue; }
      if ((m.kind === 'giver' || m._t?.kind === 'npc') && Math.abs(m.x - p.x) < 1.2 && Math.abs(m.z - p.z) < 1.2) return true;
    }
    return false;
  }
  const angleDiff = (a, b) => G.util.angleDiff(a, b);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const TAU = Math.PI * 2;
  const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // ---------------------------------------------------------------- korean particles
  const JOSA = { '을/를': ['을', '를'], '이/가': ['이', '가'], '은/는': ['은', '는'], '과/와': ['과', '와'], '와/과': ['과', '와'], '으로/로': ['으로', '로'], '아/야': ['아', '야'], '이에요/예요': ['이에요', '예요'] };
  function finalCode(word) {
    const s = String(word ?? '').replace(/[\s)\]"'’”]+$/, '');
    if (!s) return -1;
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
    return /[013678lmnr]$/i.test(s) ? 4 : 0; // digits / latin read with a final consonant (approximation)
  }
  /** josa('전통사랑', '과/와') -> '전통사랑과' */
  function josa(word, pair) {
    const f = JOSA[pair];
    if (!f) return `${word}${pair}`;
    const fc = finalCode(word);
    if (pair === '으로/로' && (fc === 8 || fc <= 0)) return `${word}${f[1]}`;
    return `${word}${fc > 0 ? f[0] : f[1]}`;
  }

  // ---------------------------------------------------------------- shared state helpers (conditions / placeholders)
  function flags() { if (!G.state) return {}; if (!G.state.flags || typeof G.state.flags !== 'object') G.state.flags = {}; return G.state.flags; }
  function questStatus(q) {
    try { const s = G.sys.quest?.status?.(q); if (s) return s; } catch (e) { /* optional */ }
    return G.state?.quests?.[q]?.status || 'locked';
  }
  function questStep(q) {
    try { const p = G.sys.quest?.progress?.(q); if (p) return p.current; } catch (e) { /* optional */ }
    const e = G.state?.quests?.[q], d = G.data.quests?.[q];
    if (!e || !d || !['accepted', 'progress'].includes(e.status)) return -1;
    for (let i = 0; i < d.objectives.length; i++) if ((e.progress?.[i] || 0) < (d.objectives[i].count || 1)) return i;
    return -1;
  }
  function itemCount(id) {
    try { const n = G.sys.inventory?.count?.(id); if (Number.isFinite(n)) return n; } catch (e) { /* optional */ }
    return Number(G.state?.inventory?.[id]) || 0;
  }
  function typeCount(type) {
    let n = 0;
    for (const [id, q] of Object.entries(G.state?.inventory || {})) if (G.data.items?.[id]?.type === type) n += Number(q) || 0;
    return n;
  }
  function jarInfo(id) {
    try { const j = G.sys.fermentation?.getJar?.(id); if (j && j.status) return j; } catch (e) { /* optional */ }
    const s = G.state?.jars?.[id];
    const status = s?.status || (id === 'J1' ? 'FERMENTING' : 'EMPTY');
    return { id, status, statusName: G.data.jarStateNames?.[status] || status, progress: s?.progress ?? (id === 'J1' ? G.data.fermentation?.starterProgress : 0), recipeId: s?.recipeId || (id === 'J1' ? G.data.fermentation?.starterRecipe : null) };
  }
  function plotStates() {
    let list = null;
    try { list = G.sys.farming?.plots?.() || null; } catch (e) { list = null; }
    if (Array.isArray(list) && list.length) return list;
    const out = [];
    for (const def of G.data.layout?.farmPlots || []) {
      const s = G.state?.farm?.plots?.[def.id];
      const cropId = s ? s.cropId : def.crop;
      const growth = s ? Number(s.growth) || 0 : def.prefill?.growth || 0;
      const water = s ? Number(s.water) || 0 : def.prefill?.water || 0;
      out.push({ id: def.id, def, cropId, empty: !cropId, ready: !!cropId && growth >= 100, growth, water });
    }
    return out;
  }
  function plotMatch(state, zone) {
    const dry = G.data.farming?.dryThreshold ?? 25;
    return plotStates().some((p) => {
      if (zone && (p.def?.zone || G.data.layout?.get?.(p.id)?.zone) !== zone) return false;
      if (state === 'ready') return !!p.ready;
      if (state === 'empty') return !!p.empty || !p.cropId;
      if (state === 'dry') return !!p.cropId && !p.ready && (Number(p.water) || 0) < dry;
      if (state === 'growing') return !!p.cropId && !p.ready;
      return false;
    });
  }
  function weatherId() { const c = G.sys.weather?.current; return (c && typeof c === 'object' ? c.id : c) || 'CLEAR'; }
  function phaseId() { const p = G.sys.weather?.phase; return (p && typeof p === 'object' ? p.id : p) || 'DAY'; }
  const STATUS_ALIASES = { active: ['accepted', 'progress'], open: ['available', 'accepted', 'progress'], done: ['completed', 'claimed'], notDone: ['locked', 'available', 'accepted', 'progress'] };
  function statusIs(actual, want) {
    for (const w of arr(want)) { if (w === actual) return true; if (STATUS_ALIASES[w]?.includes(actual)) return true; }
    return false;
  }

  const warnedConds = new Set();
  /** evaluate a dialogue condition object (all keys must hold) */
  function check(c) {
    if (c == null || c === true) return true;
    if (c === false) return false;
    if (Array.isArray(c)) return c.every(check);
    if (typeof c === 'function') { try { return !!c(); } catch (e) { return false; } }
    if (typeof c !== 'object') return !!c;
    for (const k of Object.keys(c)) {
      const v = c[k];
      switch (k) {
        case 'questStatus': for (const q of Object.keys(v || {})) if (!statusIs(questStatus(q), v[q])) return false; break;
        case 'questStep': for (const q of Object.keys(v || {})) if (!arr(v[q]).includes(questStep(q))) return false; break;
        case 'hasItem': for (const it of Object.keys(v || {})) if (itemCount(it) < (Number(v[it]) || 1)) return false; break;
        case 'itemType': for (const t of Object.keys(v || {})) if (typeCount(t) < (Number(v[t]) || 1)) return false; break;
        case 'flag': for (const f of arr(v)) if (!flags()[f]) return false; break;
        case 'notFlag': for (const f of arr(v)) if (flags()[f]) return false; break;
        case 'level': if ((G.state?.stats?.level || 1) < Number(v)) return false; break;
        case 'jarStatus': for (const j of Object.keys(v || {})) if (!arr(v[j]).includes(jarInfo(j).status)) return false; break;
        case 'jarRecipe': for (const j of Object.keys(v || {})) if (!arr(v[j]).includes(jarInfo(j).recipeId)) return false; break;
        case 'plot': if (!plotMatch(typeof v === 'object' ? v.state : v, typeof v === 'object' ? v.zone : null)) return false; break;
        case 'phase': if (!arr(v).includes(phaseId())) return false; break;
        case 'weather': if (!arr(v).includes(weatherId())) return false; break;
        case 'visited': for (const z of arr(v)) if (!G.state?.visited?.[z]) return false; break;
        case 'any': if (!arr(v).some(check)) return false; break;
        case 'all': if (!arr(v).every(check)) return false; break;
        case 'not': if (check(v)) return false; break;
        case 'chance': if (Math.random() >= Number(v)) return false; break;
        case 'easy': if (!!v !== kidOn()) return false; break; // 쉬운 모드 only (true) / normal mode only (false)
        default:
          if (!warnedConds.has(k)) { warnedConds.add(k); G.log.warn('UI', `dialogue: unknown condition "${k}"`); }
          return false;
      }
    }
    return true;
  }

  function jarText(id = 'J1') {
    const j = jarInfo(id);
    const name = j.statusName || G.data.jarStateNames?.[j.status] || j.status;
    const active = ['PREPARING', 'FERMENTING', 'AGING'].includes(j.status);
    return active && Number.isFinite(Number(j.progress)) ? `${name} · ${Math.floor(Number(j.progress))}%` : name;
  }
  const PLACEHOLDERS = {
    nickname: () => G.state?.profile?.nickname || '체험객',
    level: () => String(G.state?.stats?.level || 1),
    coin: () => G.util.fmt(G.state?.stats?.coin || 0),
    objective: () => {
      try {
        const p = G.sys.quest?.progress?.('QUEST001');
        const o = p && p.current >= 0 ? p.objectives[p.current] : null;
        if (o) return o.text;
      } catch (e) { /* optional */ }
      return '자유롭게 체험하기';
    },
    jar: () => jarText('J1'),
    /** the "다음 할 일" sentence of the easy HUD (kid words), falling back to the quest objective */
    next: () => { try { const t = G.easy?.nextStep?.()?.text; if (t) return t; } catch (e) { /* optional */ } return PLACEHOLDERS.objective(); },
    weather: () => G.data.weather?.[weatherId()]?.name || '맑음',
    temp: () => (Number.isFinite(G.sys.weather?.temperature) ? `${Math.round(G.sys.weather.temperature)}°C` : '23°C'),
    phase: () => (G.data.dayPhases || []).find((p) => p.id === phaseId())?.name || '낮',
  };
  /** replace {nickname} {objective} {next} {jar} {level} {coin} {weather} {temp} {phase} */
  function fill(str) {
    return String(str ?? '').replace(/\{(\w+)\}/g, (m, k) => { try { return PLACEHOLDERS[k] ? PLACEHOLDERS[k]() : m; } catch (e) { return ''; } });
  }

  // ---------------------------------------------------------------- per-NPC personality (idle gestures, pace)
  const PERSONA = {
    NPC001: { icon: '🧑‍🍳', gestures: ['nod', 'think', 'point', 'clap', 'nod'], walk: 1.3 },
    NPC002: { icon: '👨‍🌾', gestures: ['water', 'harvest', 'think', 'water', 'nod'], walk: 1.35 },
    NPC003: { icon: '👩', gestures: ['wave', 'clap', 'heart', 'nod', 'think'], walk: 1.3 },
    NPC004: { icon: '👴', gestures: ['interact', 'think', 'nod', 'bow', 'interact'], walk: 1.05 },
    NPC005: { icon: '🧑‍💼', gestures: ['bow', 'wave', 'point', 'nod'], walk: 1.35 },
  };
  const DEFAULT_PERSONA = { icon: '🙂', gestures: ['nod', 'think'], walk: 1.3 };

  const LOOK_R = 7;            // looks at the player within
  const FACE_R = 3.8;          // turns the body towards the player within
  const GREET_R = 5.2;         // first-approach greeting radius
  const RESET_R = 11;          // leaving this radius re-arms the approach greeting
  const GREET_COOLDOWN = 70;   // s between approach greetings of one NPC
  const LABEL_DIST = 38, LABEL_DIST_MARK = 90, TAG_FAR = 30;
  const SMILE_R = 3.6;         // smiles while the player stands this close
  const NOTICE_R = 8;          // notices a sprinting player within (phase 4: 18 m/s runs)
  const MARK_UP = 0.74;        // 3D quest mark: metres above the head top

  // ---------------------------------------------------------------- 3D quest marks ('!' gold / '?' silver-gold), shared assets
  let markAssets = null;
  function buildMarkAssets() {
    if (markAssets) return markAssets;
    const merge = (list) => { const g = ADDONS.BufferGeometryUtils.mergeGeometries(list, false); for (const x of list) x.dispose(); return g; };
    const strip = (g) => { g.deleteAttribute('uv'); return g; };
    // '!' = rounded bar + dot
    const bar = strip(new THREE.CapsuleGeometry(0.072, 0.25, 6, 14)); bar.translate(0, 0.1, 0);
    const dot = strip(new THREE.SphereGeometry(0.082, 16, 12)); dot.translate(0, -0.21, 0);
    const ex = merge([bar, dot]);
    // '?' = 3/4 arc over the top, a short stem from the arc's bottom end, and the dot
    const arc = strip(new THREE.TorusGeometry(0.115, 0.052, 10, 28, Math.PI * 1.5)); arc.rotateZ(-Math.PI / 2); arc.translate(0, 0.15, 0);
    const stem = strip(new THREE.CapsuleGeometry(0.052, 0.05, 4, 10)); stem.translate(0, 0.0, 0);
    const qd = strip(new THREE.SphereGeometry(0.078, 16, 12)); qd.translate(0, -0.2, 0);
    const qm = merge([arc, stem, qd]);
    const gold = G.gfx.material('npc:mark:gold', () => new THREE.MeshStandardMaterial({ color: 0xf6c23a, emissive: 0xff8f10, emissiveIntensity: 0.6, metalness: 0.55, roughness: 0.24 }));
    const silver = G.gfx.material('npc:mark:silver', () => new THREE.MeshStandardMaterial({ color: 0xf3f6fb, emissive: 0xffd58a, emissiveIntensity: 0.42, metalness: 0.5, roughness: 0.22 }));
    const glowTex = G.gfx.radialTexture(128, 'rgba(255,224,140,1)', 'rgba(255,180,60,0)');
    markAssets = { ex, qm, gold, silver, glowTex };
    return markAssets;
  }

  /** minimal stand-in rig when the avatar module is missing */
  function capsuleRig(app, shadow) {
    const a = app || {};
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: a.topColor || '#6d8f4e', roughness: 0.75 });
    const headMat = new THREE.MeshStandardMaterial({ color: a.skin || '#efc6a2', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 6, 14), bodyMat);
    body.position.y = 0.52;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), headMat);
    head.position.y = 1.12;
    body.castShadow = head.castShadow = shadow !== false;
    group.add(body, head);
    const headAnchor = new THREE.Object3D();
    headAnchor.position.y = 1.5;
    group.add(headAnchor);
    let t = 0, act = 0;
    return {
      group, headAnchor, height: 1.45, currentAction: null, actionFullBody: false, isFallback: true,
      update(dt, p) {
        t += dt;
        if (this.currentAction) { act -= dt; if (act <= 0) this.currentAction = null; }
        const moving = p && p.speed > 0.1;
        head.position.y = 1.12 + (moving ? Math.abs(Math.sin(t * 7)) * 0.04 : Math.sin(t * 2) * 0.008) + (this.currentAction === 'nod' ? Math.sin(t * 10) * 0.03 : 0);
      },
      setAnim(name, o = {}) { this.currentAction = name && name !== 'idle' ? name : null; act = o.loop ? Infinity : (o.duration || 1.6); },
      stopAction() { this.currentAction = null; }, stopAll() { this.currentAction = null; },
      setLookTarget() {}, setExpression() {}, setHeld() {},
      dispose() { group.parent?.remove(group); body.geometry.dispose(); head.geometry.dispose(); bodyMat.dispose(); headMat.dispose(); },
    };
  }

  // ---------------------------------------------------------------- portrait encoding (linear RT pixels -> sRGB PNG)
  function aces(x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1); }
  function srgb(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  /** linear RGBA (premultiplied by MSAA edges) -> tone-mapped sRGB canvas -> PNG object URL */
  function encodePortrait(buf, S, gain) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true }); // CPU-backed: no GPU round trip
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const lut = new Uint8Array(1024);   // tone curve lookup over 0..4 linear
    for (let i = 0; i < 1024; i++) lut[i] = Math.round(srgb(aces((i / 1023) * 4)) * 255);
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4, dst = y * S * 4;   // WebGL rows are bottom-up
      for (let x = 0; x < S * 4; x += 4) {
        const a = buf[src + x + 3];
        if (!a) { d[dst + x + 3] = 0; continue; }
        const k = (gain / a) * (1023 / 4);   // un-premultiply MSAA edges, apply gain, map to LUT index
        d[dst + x] = lut[Math.min(1023, Math.round(buf[src + x] * k))];
        d[dst + x + 1] = lut[Math.min(1023, Math.round(buf[src + x + 1] * k))];
        d[dst + x + 2] = lut[Math.min(1023, Math.round(buf[src + x + 2] * k))];
        d[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    // toBlob encodes off the main thread; fall back to a data URL where it is missing
    return new Promise((resolve) => {
      if (typeof c.toBlob !== 'function') { resolve(c.toDataURL('image/png')); return; }
      c.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : c.toDataURL('image/png')), 'image/png');
    });
  }

  const _v = new THREE.Vector3();
  const _fv = new THREE.Vector3(), _fv2 = new THREE.Vector3(), _fv3 = new THREE.Vector3();

  // =========================================================================================== NPC system
  const npc = {
    name: 'npc', order: 45, label: 'NPC',
    records: new Map(),
    _list: [],                 // same records as an array (allocation-free per-frame iteration)
    _root: null, _photo: false, _crops: [],

    init() {
      const E = G.sys.engine;
      this._root = new THREE.Group();
      this._root.name = 'npcs';
      E.scene.add(this._root);
      const shadow = !!E.preset?.shadows;
      this._crops = (G.data.layout?.farmPlots || []).map((p) => ({ x: p.x, z: p.z, hw: (p.w || 6) / 2 + 0.55, hd: (p.d || 6) / 2 + 0.55 }));
      try { G.avatar?.warm?.(Object.values(G.data.npcs || {}).map((n) => n.appearance)); } catch (e) { /* optional */ }
      for (const [id, data] of Object.entries(G.data.npcs || {})) {
        try { this._spawn(id, data, shadow); } catch (e) { G.log.error('NPC', `spawn ${id} failed`, e); }
      }
      G.bus.on('photo:mode', (p) => { this._photo = !!p?.active; });
      G.log.info('NPC', `spawned ${this.records.size} NPCs`);
    },

    postInit() {
      // walkable platforms (jangdokdae tiers, decks) exist now: snap feet to them
      for (const rec of this.records.values()) {
        const p = rec.group.position;
        const y = G.world.surfaceHeight(p.x, p.z);
        if (Number.isFinite(y)) p.y = y;
      }
      this._schedulePortraits();
    },

    onStateLoaded() {
      for (const rec of this.records.values()) this._reset(rec);
    },

    onLogout() {
      for (const rec of this.records.values()) { this._reset(rec); this.setMarker(rec.id, null); }
    },

    _reset(rec) {
      const h = rec.home;
      const y = G.world.surfaceHeight(h.x, h.z);
      rec.group.position.set(h.x, Number.isFinite(y) ? y : 0, h.z);
      rec.rotY = h.rotY;
      rec.group.rotation.y = h.rotY;
      rec.talking = false; rec.speaking = false; rec.near = false; rec.greeted = false; rec.lastGreet = -1e9;
      rec.ai.state = 'idle'; rec.ai.t = rand(1.5, 5);
      rec.params.speed = 0;
      rec.rig.stopAll?.();
      rec.rig.setHeld?.(null);
      this._setLook(rec, null);
      rec.bubbleT = 0;
      rec.el.bubble.hidden = true;
      rec.el.root.classList.remove('talking');
      if (rec.colliderId != null) { G.world.moveCollider(rec.colliderId, h.x, h.z); rec.lastColX = h.x; rec.lastColZ = h.z; }
    },

    _spawn(id, data, shadow) {
      const [hx, hz] = Array.isArray(data.pos) ? data.pos : [0, 0];
      let rig = null;
      try { rig = G.avatar?.create ? G.avatar.create(data.appearance || {}, { shadow }) : null; } catch (e) { G.log.warn('NPC', `avatar for ${id} failed, using a capsule`, e); rig = null; }
      if (!rig) rig = capsuleRig(data.appearance, shadow);
      const group = new THREE.Group();
      group.name = 'npc:' + id;
      group.userData.npcId = id;
      group.add(rig.group);
      // dialogue camera aim point (waist height): keeps both characters above the dialogue box
      const focusAnchor = new THREE.Object3D();
      focusAnchor.name = 'npcFocus';
      focusAnchor.position.y = 0.8 * (Number(data.appearance?.height) || 1);
      group.add(focusAnchor);
      const y = G.world.surfaceHeight(hx, hz);
      group.position.set(hx, Number.isFinite(y) ? y : 0, hz);
      group.rotation.y = data.rotY || 0;
      this._root.add(group);
      // 3D quest mark anchor (the DOM tap target is a world label on the same point)
      const markAnchor = new THREE.Object3D();
      markAnchor.name = 'npcMark';
      markAnchor.position.y = (Number(rig.height) || 1.45) + 0.1 + MARK_UP;
      group.add(markAnchor);
      const rec = {
        id, data, rig, group, position: group.position, focusAnchor, markAnchor, mark3d: null,
        persona: PERSONA[id] || DEFAULT_PERSONA,
        rotY: data.rotY || 0,
        home: { x: hx, z: hz, rotY: data.rotY || 0, wander: Math.max(0, Number(data.wander) || 0) },
        marker: null, talking: false, speaking: false, near: false, greeted: false, lastGreet: -1e9, playerDist: Infinity,
        ai: { state: 'idle', t: rand(1.5, 5), tx: hx, tz: hz },
        params: { speed: 0, grounded: true, vy: 0 },
        animAcc: 0, camDist: 0, far: null, bubbleT: 0, look: null,
        colliderId: null, lastColX: hx, lastColZ: hz,
        portrait: null,
        // idle life: glances at things around, notices sprinting players, smiles when you stand close
        glanceV: new THREE.Vector3(), glanceT: rand(3, 8), glanceUntil: 0, noticeAt: -1e9, smileT: 0, sparkT: rand(0.3, 0.9), markPh: Math.random() * TAU, gemChkT: 0, gemOver: false, markBaseY: (Number(rig.height) || 1.45) + 0.1, markBub: false, tagPx: 0,
      };
      rec.colliderId = G.world.addCollider({ shape: 'circle', x: hx, z: hz, r: 0.4, tag: 'npc:' + id });
      this._buildLabel(rec);
      this.records.set(id, rec);
      this._list.push(rec);
      G.world.registerObject?.('NPC_' + id, group);
      G.interact?.register?.({
        id, kind: 'npc', radius: 3.2, priority: 1,
        label: () => this._promptLabel(rec),
        kidLabel: () => this._kidPromptLabel(rec),
        emoji: () => (rec.marker === '?' ? '🎁' : rec.marker === '!' ? '🙋' : rec.persona.icon || '💬'),
        handOffset: () => (rec.marker ? 1.3 : 0.45), // above the ! / ? quest mark (and its greeting bubble) when one is shown
        position: () => rec.group.position,
        object: rig.group,
        enabled: () => !rec.talking,
        onInteract: () => this.talk(id),
      });
    },

    _buildLabel(rec) {
      const h = G.ui.h;
      const bubble = h('div', { class: 'bubble npc-bubble', hidden: true });
      // the ! / ? quest mark: a 3D bouncing mark over the head (25-npc update) + this DOM button as its tap target,
      // centred on the same world point (its own label), transparent while the 3D mark is drawn
      const mark = h('button', { class: 'npc-mark', type: 'button', hidden: true, tabindex: '-1', 'aria-label': `${rec.data.name}에게 가기` });
      mark.addEventListener('click', (ev) => { ev.stopPropagation(); if (!G.ui.isBlocking()) G.interact?.activate?.(rec.id); });
      const markWrap = h('div', { class: 'npc-mark-wl', dataset: { npc: rec.id } }, mark);
      // 쉬운 모드: a picture in front of the name so children who cannot read yet recognise each NPC
      const tag = h('div', { class: 'nametag npc' },
        h('span', { class: 'nm' }, h('span', { class: 'nm-ico emoji easy-only', 'aria-hidden': 'true' }, rec.persona.icon || '🙂'), String(rec.data.name || rec.id)),
        rec.data.role ? h('span', { class: 'role', text: rec.data.role }) : null);
      const root = h('div', { class: 'npc-label', dataset: { npc: rec.id } }, bubble, tag);
      rec.el = { root, bubble, mark, tag, markWrap };
      rec.label = G.ui.label({ el: root, target: rec.rig.headAnchor, offsetY: 0.04, maxDist: LABEL_DIST, fadeDist: 8 });
      rec.markLabel = G.ui.label({ el: markWrap, target: rec.markAnchor, offsetY: 0, maxDist: LABEL_DIST_MARK, fadeDist: 14, visible: false });
      rec.markLabel.setVisible(false);
    },

    /** build the 3D mark of an NPC on first use (shared geometry & materials; own glow sprite) */
    _ensureMark3d(rec) {
      if (rec.mark3d) return rec.mark3d;
      try {
        const A = buildMarkAssets();
        const pivot = new THREE.Group();
        pivot.name = 'npcMark3d';
        const ex = new THREE.Mesh(A.ex, A.gold), qm = new THREE.Mesh(A.qm, A.silver);
        const glowMat = new THREE.SpriteMaterial({ map: A.glowTex, color: 0xffc04a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
        const glow = new THREE.Sprite(glowMat);
        glow.scale.setScalar(0.95); glow.renderOrder = 5;
        for (const m of [ex, qm]) { m.castShadow = false; m.receiveShadow = false; m.raycast = () => {}; }
        glow.raycast = () => {};
        pivot.add(ex, qm);
        rec.markAnchor.add(pivot, glow);
        pivot.visible = false; glow.visible = false;
        rec.mark3d = { pivot, ex, qm, glow, glowMat };
        rec.el.mark.classList.add('has3d');
      } catch (e) {
        G.log.warn('NPC', `3D quest mark for ${rec.id} failed, the 2D badge stays`, e);
        rec.mark3d = false;
      }
      return rec.mark3d;
    },
    /** per-frame bounce / spin / squash of the 3D mark + a few sparkles (fx-gated) */
    _animMark(rec, dt, t, show) {
      const M = rec.mark3d;
      const el = rec.el.mark;
      if (!show) {
        if (M) { if (M.pivot.visible) { M.pivot.visible = false; M.glow.visible = false; } }
        if (rec.markLabel.visible) rec.markLabel.setVisible(false);
        return;
      }
      if (!rec.markLabel.visible) rec.markLabel.setVisible(true);
      // twice a second (and at once when a speech bubble pops): the on-screen height of the name tag (+ bubble),
      // and whether the quest system already hangs its own gem + beam over this NPC (its focus target)
      const bub = rec.bubbleT > 0;
      if (bub !== rec.markBub) { rec.markBub = bub; rec.gemChkT = 0; }
      rec.gemChkT -= dt;
      if (!(rec.gemChkT > 0)) {
        rec.gemChkT = 0.5;
        rec.gemOver = M ? questGemOn(rec) : false;
        rec.tagPx = rec.far && !bub ? 0 : (rec.el.root.offsetHeight || 0);
      }
      // grows with distance so it still reads as a "!" across a field (same size up close)
      const far = clamp((rec.camDist - 8) / 30, 0, 1.6);
      const s = (1 + far) * (rec.marker === '?' ? 1.02 : 1);
      // float just above the name tag: its pixel height in metres at this distance, so the DOM tag never covers
      // the glyph (the tap target follows the same anchor)
      const cam = G.sys.engine?.camera;
      const fov = cam && cam.fov > 1 ? cam.fov : 55;
      const wpp = (2 * Math.max(0.5, rec.camDist) * Math.tan(fov * Math.PI / 360)) / Math.max(200, innerHeight || 0);
      const want = rec.markBaseY + Math.min(3.2, (rec.tagPx || 0) * wpp) + 0.27 * s;
      const cy = rec.markAnchor.position.y;
      if (Number.isFinite(want) && Math.abs(want - cy) > 0.002) rec.markAnchor.position.y = cy + (want - cy) * Math.min(1, dt * 7);
      if (!M) return;
      const reduce = !!G.settings.reduceMotion;
      // one marker only: under the quest gem the glyph steps aside (the tap target and sparkles stay)
      if (rec.gemOver) {
        if (M.pivot.visible) { M.pivot.visible = false; M.glow.visible = false; }
      } else if (!M.pivot.visible) { M.pivot.visible = true; M.glow.visible = true; }
      M.ex.visible = rec.marker === '!';
      M.qm.visible = rec.marker === '?';
      // a hop: fast up, slow at the top, quick soft landing with a little squash (≤ 0.4 Hz, no flashing)
      const ph = t * 2.3 + rec.markPh;
      const b = reduce ? 0.5 : Math.abs(Math.sin(ph));
      const land = reduce ? 0 : 1 - smoothstep01(b / 0.28);
      M.pivot.position.y = b * 0.17;
      M.pivot.scale.set(s * (1 + 0.08 * land), s * (1 - 0.14 * land), s * (1 + 0.08 * land));
      M.pivot.rotation.y = reduce ? 0.35 : t * 1.25 + rec.markPh;
      M.glow.position.y = M.pivot.position.y;
      M.glow.scale.setScalar(0.95 * s * (1 + 0.06 * Math.sin(t * 2.4 + rec.markPh)));
      M.glowMat.opacity = 0.42 + 0.12 * Math.sin(t * 2.4 + rec.markPh);
      M.glowMat.color.setHex(rec.marker === '?' ? 0xffe2a0 : 0xffc04a);
      // sparkles drifting off the mark (G.fx thins / drops them for fxLevel low / off)
      rec.sparkT -= dt;
      if (rec.sparkT <= 0) {
        rec.sparkT = reduce ? 2.2 : rand(0.55, 0.95);
        if (rec.camDist < 46 && G.fx?.burst) {
          rec.markAnchor.getWorldPosition(_v);
          _v.y += M.pivot.position.y;
          try { G.fx.burst('sparkle', _v, { count: 3, lift: 0, spread: 0.35, up: 0.45, size: 0.8 }); } catch (e) { /* fx optional */ }
        }
      }
    },

    _promptLabel(rec) {
      const base = `${josa(rec.data.name || '', '과/와')} 대화하기`;
      if (rec.marker === '!') return `${base} · 새 퀘스트`;
      if (rec.marker === '?') return `${base} · 퀘스트`;
      return base;
    },
    /** 쉬운 모드 prompt words: "발효마스터랑 이야기" (the picture shows 🙋 new task / 🎁 report) */
    _kidPromptLabel(rec) {
      const n = String(rec.data.name || '');
      const fc = finalCode(n);
      return `${n}${fc > 0 ? '이랑' : '랑'} 이야기`;
    },

    // ------------------------------------------------------------ public API
    get(id) { return this.records.get(id) || null; },
    list() { return Array.from(this.records.values()); },
    portrait(id) { return this.records.get(id)?.portrait || null; },
    icon(id) { return (PERSONA[id] || null)?.icon || G.data.collection?.['COL_' + id]?.icon || DEFAULT_PERSONA.icon; },

    talk(id) {
      const rec = this.records.get(id);
      if (!rec || !G.state) return false;
      if (G.sys.dialogue?.start && G.sys.dialogue._initialized && !G.sys.dialogue._failed) return G.sys.dialogue.start(rec.data.dialogue || null, { npcId: id });
      // without the dialogue system: greet with a bubble and still count the conversation
      const pp = G.sys.player?.position;
      if (pp) rec.rotY = Math.atan2(pp.x - rec.group.position.x, pp.z - rec.group.position.z);
      this._play(rec, 'wave');
      this.say(id, rec.data.greeting || '안녕하세요!', { duration: 3.5 });
      G.bus.emit('npc:talk', { npcId: id });
      return true;
    },

    setMarker(id, m) {
      const rec = this.records.get(id);
      if (!rec) return false;
      m = m === '!' || m === '?' ? m : null;
      if (rec.marker === m) return true;
      rec.marker = m;
      const el = rec.el.mark;
      el.hidden = !m;
      el.textContent = m || '';
      el.classList.toggle('ex', m === '!');
      el.classList.toggle('qm', m === '?');
      el.title = m === '!' ? '새 퀘스트' : m === '?' ? '퀘스트 진행' : '';
      el.setAttribute('aria-label', m === '!' ? `${rec.data.name}에게 새 퀘스트 받으러 가기` : m === '?' ? `${rec.data.name}에게 퀘스트 알리러 가기` : `${rec.data.name}에게 가기`);
      el.classList.remove('pop'); void el.offsetWidth; if (m) el.classList.add('pop');
      rec.el.root.classList.toggle('has-mark', !!m);
      if (m) this._ensureMark3d(rec);
      return true;
    },

    say(id, text, opts = {}) {
      const rec = this.records.get(id);
      if (!rec || !text) return false;
      const t = fill(text);
      const b = rec.el.bubble;
      b.textContent = t;
      b.hidden = false;
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      rec.bubbleT = opts.duration ?? clamp(1.6 + t.length * 0.07, 2.8, 5.5);
      if (opts.chat) { try { G.sys.social?.npcSay?.(rec.data.name, t); } catch (e) { /* optional */ } }
      return true;
    },

    setTalking(id, on) {
      const rec = this.records.get(id);
      if (!rec) return false;
      on = !!on;
      if (rec.talking === on) return true;
      rec.talking = on;
      rec.el.root.classList.toggle('talking', on);
      rec.params.speed = 0;
      if (on) {
        rec.ai.state = 'idle'; rec.ai.t = 999;
        if (rec.rig.currentAction) rec.rig.stopAction();
        rec.el.bubble.hidden = true; rec.bubbleT = 0;
        rec.glanceUntil = 0;
        this._setLook(rec, G.sys.player?.rig?.headAnchor || null);
        // turn to face the player with a warm little acknowledgement (the dialogue line's own emote follows)
        try { rec.rig.setExpression?.('happy', 2.2); } catch (e) { /* cosmetic */ }
        const pp = G.sys.player?.position;
        if (pp) {
          const want = Math.atan2(pp.x - rec.group.position.x, pp.z - rec.group.position.z);
          // most of the turn happens at once (snappy), the rest eases in _think (no robotic snap)
          rec.rotY += angleDiff(rec.rotY, want) * 0.55;
        }
      } else {
        rec.speaking = false;
        if (rec.rig.currentAction === 'talk') rec.rig.stopAction();
        rec.ai.state = 'idle'; rec.ai.t = rand(2.5, 5);
        rec.near = true; rec.greeted = true; rec.lastGreet = G.time.elapsed; // no instant re-greeting after a chat
      }
      return true;
    },

    setSpeaking(id, on) {
      const rec = this.records.get(id);
      if (!rec) return false;
      rec.speaking = !!on && rec.talking;
      if (!rec.speaking && rec.rig.currentAction === 'talk') rec.rig.stopAction();
      return true;
    },

    playAnim(id, anim, opts) {
      const rec = this.records.get(id);
      return rec ? this._play(rec, anim, opts) : false;
    },

    _play(rec, anim, opts) {
      if (!anim) return false;
      if (!rec.rig.isFallback && G.avatar?.actions && !G.avatar.actions[anim]) return false;
      try { rec.rig.setAnim(anim, opts || {}); return true; } catch (e) { return false; }
    },

    // ------------------------------------------------------------ per frame
    update(dt, t) {
      const list = this._list;
      if (!list.length) return;
      const cam = G.sys.engine.camera.position;
      const pl = G.sys.player;
      const pp = pl && pl._ready && pl.object?.visible && G.state ? pl.position : null;
      const dlgBusy = !!G.sys.dialogue?.active;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const p = rec.group.position;
        let pd = Infinity;
        if (pp) { const dx = pp.x - p.x, dz = pp.z - p.z; pd = Math.sqrt(dx * dx + dz * dz); }
        rec.playerDist = pd;
        this._think(rec, dt, pp, pd, dlgBusy);
        rec.rotY = Math.atan2(Math.sin(rec.rotY), Math.cos(rec.rotY));
        rec.group.rotation.y = rec.rotY;
        if (rec.colliderId != null && Math.abs(p.x - rec.lastColX) + Math.abs(p.z - rec.lastColZ) > 0.08) {
          G.world.moveCollider(rec.colliderId, p.x, p.z);
          rec.lastColX = p.x; rec.lastColZ = p.z;
        }
        if (rec.speaking && !rec.rig.currentAction) rec.rig.setAnim('talk', { loop: true });
        // animation at a reduced rate far from the camera
        const cd = cam.distanceTo(p);
        rec.camDist = cd;
        let adt = dt;
        if (cd > 55 && !rec.talking) {
          rec.animAcc += dt;
          if (rec.animAcc < (cd > 110 ? 0.25 : 0.1)) adt = 0; else { adt = rec.animAcc; rec.animAcc = 0; }
        }
        if (adt > 0) rec.rig.update(adt, rec.params);
        // 3D quest mark (hidden while talking / in photo mode / far away)
        if (rec.marker || rec.markLabel.visible || (rec.mark3d && rec.mark3d.pivot.visible)) {
          this._animMark(rec, dt, t, !!rec.marker && !rec.talking && !this._photo && cd < 130 && !!G.state);
        }
        // label: far -> marker only; bubble timer
        const far = cd > TAG_FAR;
        if (far !== rec.far) { rec.far = far; rec.el.root.classList.toggle('far', far); }
        if (rec.bubbleT > 0) {
          rec.bubbleT -= dt;
          if (rec.bubbleT <= 0 || far || rec.talking) { rec.bubbleT = 0; rec.el.bubble.hidden = true; }
        }
      }
    },

    _think(rec, dt, pp, pd, dlgBusy) {
      const ai = rec.ai, p = rec.group.position;
      const head = G.sys.player?.rig?.headAnchor || null;
      if (rec.talking) {
        if (pp) this._turnTo(rec, Math.atan2(pp.x - p.x, pp.z - p.z), 7, dt);
        this._setLook(rec, head);
        rec.params.speed = 0;
        return;
      }
      const near = !!pp && pd < LOOK_R && !this._photo;
      if (pp && !dlgBusy && !this._photo) {
        if (!rec.near && pd < GREET_R) { rec.near = true; this._greet(rec); }
        else if (rec.near && pd > RESET_R) rec.near = false;
        this._life(rec, dt, pp, pd);
      }
      let speed = 0;
      if (ai.state === 'walk') {
        if (near && pd < 3) { ai.state = 'idle'; ai.t = rand(2, 4); }
        else speed = this._walkStep(rec, dt, pp);
      } else if (ai.state === 'gesture') {
        ai.t -= dt;
        if (near && pd < FACE_R && !rec.rig.actionFullBody) this._turnTo(rec, Math.atan2(pp.x - p.x, pp.z - p.z), 2.5, dt);
        if (ai.t <= 0 || !rec.rig.currentAction) { ai.state = 'idle'; ai.t = rand(3, 7); }
      } else {
        ai.t -= dt;
        if (near && pd < FACE_R) this._turnTo(rec, Math.atan2(pp.x - p.x, pp.z - p.z), 3.2, dt);
        else if (!near && rec.home.wander === 0) this._turnTo(rec, rec.home.rotY, 1.4, dt);
        if (ai.t <= 0) this._decide(rec, near, pd);
      }
      // look: the player when near; otherwise a short glance at something nearby (another NPC, 옹이, the view)
      const glancing = !near && G.time.elapsed < rec.glanceUntil;
      this._setLook(rec, near ? head : glancing ? rec.glanceV : null);
      rec.params.speed = speed;
    },

    /** idle life: glances around, a surprised look at a sprinting player, a smile when the player stands close */
    _life(rec, dt, pp, pd) {
      const now = G.time.elapsed;
      const rig = rec.rig;
      // notice a player racing past (phase-4 speeds): turn the head, raise the brows, sometimes a little start
      const pl = G.sys.player;
      const fast = (Number(pl?.speed) || 0) > (Number(pl?.RUN) || 18) * 0.62;
      if (fast && pd < NOTICE_R && now - rec.noticeAt > 16 && !rec.talking) {
        rec.noticeAt = now;
        try { rig.setExpression?.('surprise', 1.3); } catch (e) { /* cosmetic */ }
        if (rec.ai.state !== 'walk' && !rig.currentAction && Math.random() < 0.4) this._play(rec, 'surprise', { duration: 1.1 });
        rec.glanceUntil = 0;
        return;
      }
      // smile while the player stands close (re-armed every half second)
      if (pd < SMILE_R) {
        rec.smileT -= dt;
        if (rec.smileT <= 0) { rec.smileT = 0.5; try { if (now - rec.noticeAt > 1.4) rig.setExpression?.('happy', 0.8); } catch (e) { /* cosmetic */ } }
        return;
      }
      // glance at something nearby every few seconds (a moment of attention, then back)
      rec.glanceT -= dt;
      if (rec.glanceT > 0 || rec.ai.state === 'walk') return;
      rec.glanceT = rand(4.5, 9.5);
      if (Math.random() < 0.3) return;   // not every time: sometimes they just stand
      const p = rec.group.position;
      const head = (Number(rig.height) || 1.45) * 0.95;
      let best = null, bd = 13;
      for (const o of this._list) {
        if (o === rec) continue;
        const d = Math.hypot(o.group.position.x - p.x, o.group.position.z - p.z);
        if (d < bd) { bd = d; best = o.group.position; }
      }
      const C = G.sys.companion;
      if (!best && C?.visible && C.position && Math.hypot(C.position.x - p.x, C.position.z - p.z) < 9) { best = C.position; rec.glanceV.set(best.x, (C.groundY ?? best.y) + 0.35, best.z); }
      else if (best) rec.glanceV.set(best.x, best.y + head, best.z);
      else {
        const a = rec.rotY + rand(-1.1, 1.1);
        rec.glanceV.set(p.x + Math.sin(a) * 4, p.y + head + rand(-0.4, 0.5), p.z + Math.cos(a) * 4);
      }
      rec.glanceUntil = now + rand(1.2, 2.4);
    },

    _decide(rec, near, pd) {
      const ai = rec.ai, r = Math.random();
      if (!near && rec.home.wander > 0 && r < 0.55 && this._pickTarget(rec)) { ai.state = 'walk'; return; }
      if (r < (near ? 0.4 : 0.8)) {
        const g = near ? (pd < 2.2 ? 'nod' : pick(['nod', 'nod', 'think', 'wave'])) : pick(rec.persona.gestures);
        if (this._play(rec, g)) { ai.state = 'gesture'; ai.t = (G.avatar?.actions?.[g]?.duration || 1.8) + 0.4; return; }
      }
      ai.t = rand(3.5, 8);
    },

    _turnTo(rec, yaw, k, dt) { rec.rotY += angleDiff(rec.rotY, yaw) * damp(k, dt); },
    _setLook(rec, target) { if (rec.look !== target) { rec.look = target; rec.rig.setLookTarget?.(target); } },

    _pickTarget(rec) {
      const h = rec.home, p = rec.group.position;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * h.wander;
        const tx = h.x + Math.cos(a) * r, tz = h.z + Math.sin(a) * r;
        if (Math.hypot(tx - p.x, tz - p.z) < 1.2) continue;
        if (this._pathClear(rec, p.x, p.z, p.y, tx, tz)) { rec.ai.tx = tx; rec.ai.tz = tz; return true; }
      }
      return false;
    },
    _pathClear(rec, x0, z0, y0, x1, z1) {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.6));
      let y = y0;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const ny = this._walkY(rec, x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, y);
        if (ny == null) return false;
        y = ny;
      }
      return true;
    },
    /** ground height for this NPC at (x, z), or null when it should not walk there */
    _walkY(rec, x, z, fromY) {
      const W = G.world, b = W.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
      if (W.isWater(x, z)) return null;
      for (const c of this._crops) if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return null;
      const own = rec.colliderId != null ? W.colliders?.get?.(rec.colliderId) : null;
      if (own) own.disabled = true;
      let hit = false;
      try { hit = W.blocked(x, z, 0.36, fromY); } finally { if (own) own.disabled = false; }
      if (hit) return null;
      const y = W.heightAt(x, z, fromY + 0.3);
      if (!Number.isFinite(y) || Math.abs(y - fromY) > 0.3) return null;   // no hopping off terrace walls
      return y;
    },
    _walkStep(rec, dt, pp) {
      const ai = rec.ai, p = rec.group.position;
      const dx = ai.tx - p.x, dz = ai.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.18) { ai.state = 'idle'; ai.t = rand(2.5, 7); return 0; }
      const want = Math.atan2(dx, dz);
      this._turnTo(rec, want, 7, dt);
      const align = Math.cos(angleDiff(rec.rotY, want));
      if (align < 0.35) return 0.25;   // turn on the spot first
      const sp = (rec.persona.walk || 1.3) * clamp(d / 0.8, 0.45, 1) * align;
      const step = Math.min(d, sp * dt);
      const nx = p.x + (dx / d) * step, nz = p.z + (dz / d) * step;
      if (pp && Math.hypot(pp.x - nx, pp.z - nz) < 1.0) { ai.state = 'idle'; ai.t = rand(1.5, 3); return 0; }
      const ny = this._walkY(rec, nx, nz, p.y);
      if (ny == null) { ai.state = 'idle'; ai.t = rand(1, 2.5); return 0; }
      p.x = nx; p.z = nz;
      p.y += (ny - p.y) * damp(18, dt);
      return sp;
    },

    _greet(rec) {
      const now = G.time.elapsed;
      if (rec.greeted && now - rec.lastGreet < GREET_COOLDOWN) return;
      const first = !rec.greeted;
      const kid = kidOn();
      const def = G.data.dialogues?.[rec.data.dialogue];
      const text = first ? ((kid && def?.kidGreeting) || rec.data.greeting) : this._bark(rec);
      if (!text) return;
      rec.greeted = true;
      rec.lastGreet = now;
      if (!rec.rig.actionFullBody && this._play(rec, first || Math.random() < 0.45 ? 'wave' : 'nod')) {
        rec.ai.state = 'gesture';
        rec.ai.t = 2.6;
      } else if (rec.ai.state === 'walk') { rec.ai.state = 'idle'; rec.ai.t = rand(3, 5); }
      this.say(rec.id, text, { duration: kid ? 4.2 : 3.4, chat: first });
      // 쉬운 모드: the very first hello of each NPC is read aloud (queued behind anything already speaking)
      if (kid && first && !G.ui.isBlocking()) { try { G.easy?.say?.(fill(text), { interrupt: false }); } catch (e) { /* voice optional */ } }
    },

    /** proximity line: conditional barks win over generic ones (쉬운 모드: bark.kid / dialogue.kidBarks) */
    _bark(rec) {
      const def = G.data.dialogues?.[rec.data.dialogue];
      const list = def?.barks;
      if (!Array.isArray(list) || !list.length) return rec.data.greeting || null;
      const kid = kidOn();
      const cond = [], plain = [];
      for (const b of list) {
        if (typeof b === 'string') plain.push(b);
        else if (b && b.text && check(b.if)) cond.push(kid && b.kid ? b.kid : b.text);
      }
      const kidPlain = kid && Array.isArray(def.kidBarks) && def.kidBarks.length ? def.kidBarks : null;
      const pool = cond.length ? cond : (kidPlain || plain);
      return pool.length ? pick(pool) : null;
    },

    // ------------------------------------------------------------ portraits (rendered once, cached as PNG data URLs)
    // Runs after the game is ready, off the loading path: shaders compile in parallel (compileAsync) and
    // pixels come back through an async PBO read, so neither loading nor gameplay frames stall.
    // Until a portrait exists the dialogue shows the NPC's emoji.
    _schedulePortraits() {
      if (this._portraitJob) return;
      const go = () => {
        if (this._portraitJob) return;
        this._portraitJob = 'pending';
        const run = () => { this._renderPortraits().catch((e) => G.log.warn('NPC', 'portraits skipped', e)); };
        setTimeout(() => { if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3000 }); else run(); }, 1500);
      };
      if (G.ready) go(); else G.bus.once('game:ready', go);
    },

    async _renderPortraits() {
      const E = G.sys.engine, r = E?.renderer;
      if (!r || !G.avatar?.create || typeof r.readRenderTargetPixels !== 'function' || !this.records.size) return;
      this._portraitJob = 'running';
      const S = 192, K = 0.5; // lights at half power to stay below 8-bit clipping; the gain restores them
      const scene = new THREE.Scene();
      scene.environment = E.scene?.environment || null;
      scene.environmentIntensity = 0.5;
      const key = new THREE.DirectionalLight(0xfff0d8, 3.2 * K); key.position.set(1.6, 2.4, 3);
      const fill = new THREE.DirectionalLight(0xd2e4ff, 1.1 * K); fill.position.set(-2.6, 1.0, 1.6);
      const rim = new THREE.DirectionalLight(0xffe0a8, 2.2 * K); rim.position.set(-1.2, 2.4, -2.6);
      scene.add(new THREE.HemisphereLight(0xfff4e2, 0x56674a, 1.5 * K), key, fill, rim);
      const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
      const params = { speed: 0, grounded: true, vy: 0 };
      const t0 = performance.now();
      const jobs = [];
      for (const rec of this.records.values()) {
        try {
          const rig = G.avatar.create(rec.data.appearance || {}, { shadow: false });
          rig.setExpression?.('happy', 60);
          for (let i = 0; i < 4; i++) rig.update(1 / 30, params);
          rig.group.visible = false;
          scene.add(rig.group);
          jobs.push({ rec, rig });
        } catch (e) { G.log.warn('NPC', `portrait rig for ${rec.id} failed`, e); }
      }
      const frame = (rig) => {
        for (const j of jobs) j.rig.group.visible = j.rig === rig;
        scene.updateMatrixWorld(true);
        rig.headAnchor.getWorldPosition(_v);
        const cy = _v.y - 0.42;
        cam.position.set(0.42, cy + 0.1, 1.78);
        cam.lookAt(0, cy, 0);
      };
      let made = 0;
      try {
        if (!jobs.length) return;
        frame(jobs[0].rig);
        // parallel compile only where the driver supports it (otherwise three warns and compiles on first render anyway)
        if (typeof r.compileAsync === 'function' && r.extensions?.has?.('KHR_parallel_shader_compile')) {
          try { await r.compileAsync(scene, cam); } catch (e) { /* compile on first render instead */ }
        }
        for (const { rec, rig } of jobs) {
          if (!this.records.has(rec.id)) continue;
          const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
          const buf = new Uint8Array(S * S * 4);
          try {
            frame(rig);
            const prevRT = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
            try {
              r.setClearColor(0x000000, 0);
              r.setRenderTarget(rt);
              r.clear();
              r.render(scene, cam);
            } finally {
              r.setRenderTarget(prevRT);
              r.setClearColor(prevColor, prevAlpha);
            }
            if (typeof r.readRenderTargetPixelsAsync === 'function') await r.readRenderTargetPixelsAsync(rt, 0, 0, S, S, buf);
            else r.readRenderTargetPixels(rt, 0, 0, S, S, buf);
            rec.portrait = await encodePortrait(buf, S, 0.72 / K);
            made++;
          } catch (e) {
            G.log.warn('NPC', `portrait for ${rec.id} failed`, e);
          } finally {
            rt.dispose();
          }
          await G.util.nextFrame();
        }
      } finally {
        for (const { rig } of jobs) { scene.remove(rig.group); try { rig.dispose(); } catch (e) { /* ignore */ } }
        this._portraitJob = 'done';
      }
      G.log.info('NPC', `rendered ${made} portraits in ${Math.round(performance.now() - t0)}ms`);
      try { G.sys.dialogue?._refreshSpeaker?.(); } catch (e) { /* cosmetic */ }
    },
  };
  G.register(npc);

  // =========================================================================================== dialogue system
  const UI_ACTIONS = new Set(['openEdu', 'openQuiz', 'openLibrary', 'openShop', 'openCraft', 'openJar', 'openMap', 'openFastTravel', 'openJournal', 'openQuestLog', 'openInventory', 'openCollection', 'teleport']);
  const KNOWN_ACTIONS = new Set([...UI_ACTIONS, 'acceptQuest', 'claimQuest', 'giveItem', 'takeItem', 'setFlag', 'clearFlag', 'emote', 'npcAnim', 'event', 'toast', 'sfx', 'activity']);
  const KNOWN_CONDS = new Set(['questStatus', 'questStep', 'hasItem', 'itemType', 'flag', 'notFlag', 'level', 'jarStatus', 'jarRecipe', 'plot', 'phase', 'weather', 'visited', 'any', 'all', 'not', 'chance', 'easy']);
  const CPS = 40;                       // typewriter characters per second
  const ACTION_ICON = { openShop: '🛒', openMap: '🗺️', openFastTravel: '🧭', teleport: '🧭', openEdu: '📖', openLibrary: '📚', openQuiz: '✏️', openJar: '🏺', openCraft: '🛠️', openJournal: '📝', openQuestLog: '📜', openInventory: '🎒', openCollection: '📗', giveItem: '🎁' };
  const defs = () => G.data.dialogues || {};

  function normAction(a) {
    if (!a) return null;
    if (typeof a === 'string') return { type: a };
    if (typeof a !== 'object') return null;
    if (a.type) return a;
    if (a.do) return { ...a, type: a.do };
    const keys = Object.keys(a);
    if (keys.length === 1) {
      const k = keys[0], v = a[k];
      return v && typeof v === 'object' && !Array.isArray(v) ? { type: k, ...v } : { type: k, value: v };
    }
    return null;
  }
  /** "**강조**" -> [{t, hl}] */
  function parseRich(text) {
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index), hl: false });
      out.push({ t: m[1], hl: true });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ t: text.slice(last), hl: false });
    return out;
  }
  function choiceStyle(c) {
    const types = (c.actions || []).map((x) => normAction(x)?.type).filter(Boolean);
    if (types.includes('claimQuest')) return { cls: 'claim', icon: c.icon || '🎁' };
    if (types.includes('acceptQuest')) return { cls: 'quest', icon: c.icon || '❗' };
    if (c.icon) return { cls: c.kind || '', icon: c.icon };
    for (const t of types) if (ACTION_ICON[t]) return { cls: 'action', icon: ACTION_ICON[t] };
    if (c.end && !c.next) return { cls: 'leave', icon: '' };
    return { cls: '', icon: '' };
  }
  /** a "goodbye" choice: ends the talk without doing anything but a farewell animation */
  function isLeave(c) {
    if (!c.end || c.next) return false;
    return arr(c.actions).every((x) => { const t = normAction(x)?.type; return t === 'npcAnim' || t === 'emote'; });
  }
  /**
   * 쉬운 모드 choices: at most 3 big picture buttons. Choices marked `easy: false` are grown-up extras; when more
   * than 3 remain, plain goodbyes go first (the big "✖ 그만" button already ends the talk).
   */
  function kidChoices(list) {
    let l = list.filter((c) => c.easy !== false);
    if (!l.length) l = list.slice();
    if (l.length > 3) { const keep = l.filter((c) => !isLeave(c)); if (keep.length >= 2) l = keep; }
    return l.slice(0, 3);
  }
  const KID_CLS_EMOJI = { claim: '🎁', quest: '👍', leave: '👋' };
  function kidChoiceEmoji(c, st) {
    const own = typeof c.emoji === 'string' && c.emoji.trim() ? c.emoji.trim().slice(0, 16) : '';
    return own || KID_CLS_EMOJI[st.cls] || st.icon || (isLeave(c) ? '👋' : '💬');
  }
  function pickQuiz(spec, edu) {
    const Q = G.data.quizzes || {};
    if (spec && Q[spec]) return spec;
    const st = G.state?.education?.quiz || {};
    const solved = (id) => { const v = st[id]; return v === true || v === 'correct' || !!(v && typeof v === 'object' && (v.correct || v.solved || v.rewarded)); };
    const ids = Object.keys(Q).filter((id) => !edu || Q[id]?.edu === edu);
    const open = ids.filter((id) => !solved(id));
    const pool = open.length ? open : ids;
    return pool.length ? pick(pool) : null;
  }

  const dialogue = {
    name: 'dialogue', order: 46, label: '대화',
    active: null,
    _seq: 0, _typing: false, _segs: [], _flat: [], _total: 0, _shown: 0, _acc: 0, _pause: 0,
    _choices: [], _focus: -1, _unblockT: 0, _hideT: 0, _playerLook: null,
    check, fill, josa,

    init() {
      const root = document.getElementById('dialogue-root');
      if (!root) throw new Error('#dialogue-root missing');
      const h = G.ui.h;
      root.innerHTML = '';
      root.classList.add('dlg-root');
      const shade = h('div', { class: 'dlg-shade', 'aria-hidden': 'true' });
      // 쉬운 모드: a full-screen catcher behind the box — tap anywhere to continue
      const tap = h('div', { class: 'dlg-tap', 'aria-hidden': 'true' });
      const box = h('section', { class: 'dlg', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'dlg-name', hidden: true });
      box.innerHTML = `
        <div class="dlg-portrait" aria-hidden="true"><img class="dlg-img" alt="" hidden><span class="dlg-face emoji"></span></div>
        <header class="dlg-head">
          <span class="dlg-name" id="dlg-name"></span><span class="dlg-role"></span>
          <button class="icon-btn dlg-close" type="button" tabindex="-1" aria-label="대화 닫기" title="대화 닫기 (Esc)"><span class="ico" data-icon="x"></span><span class="dlg-close-lbl">그만</span></button>
        </header>
        <div class="dlg-text" aria-hidden="true"></div>
        <div class="dlg-sr" aria-live="polite"></div>
        <div class="dlg-choices" role="group" aria-label="대답 고르기"></div>
        <footer class="dlg-foot">
          <span class="dlg-hint"></span>
          <button class="btn btn-sm dlg-next" type="button" tabindex="-1" hidden></button>
        </footer>`;
      G.ui.hydrateIcons(box);
      root.append(shade, tap, box);
      const $ = (s) => box.querySelector(s);
      this._root = root; this._box = box; this._shade = shade; this._tap = tap;
      this._img = $('.dlg-img'); this._face = $('.dlg-face');
      this._nameEl = $('.dlg-name'); this._roleEl = $('.dlg-role');
      this._textEl = $('.dlg-text'); this._srEl = $('.dlg-sr');
      this._choicesEl = $('.dlg-choices'); this._nextBtn = $('.dlg-next'); this._hintEl = $('.dlg-hint');
      this._caret = h('span', { class: 'dlg-caret', 'aria-hidden': 'true' });
      this._applyMode();

      $('.dlg-close').addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
      this._nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.advance(); });
      // text / portrait click continues (normal); in 쉬운 모드 a tap anywhere in or around the box does
      box.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (!kidOn() && !e.target.closest('.dlg-text, .dlg-portrait')) return;
        this._onTapAnywhere();
      });
      tap.addEventListener('click', (e) => { e.stopPropagation(); if (kidOn()) this._onTapAnywhere(); });
      G.bus.on('easy:changed', () => this._onModeChange());
      this._choicesEl.addEventListener('click', (e) => {
        const b = e.target.closest('.dlg-choice');
        if (b) { e.stopPropagation(); this.choose(Number(b.dataset.i)); }
      });
      this._choicesEl.addEventListener('pointermove', (e) => {
        const b = e.target.closest('.dlg-choice');
        if (b && e.pointerType === 'mouse') this._setFocus(Number(b.dataset.i));
      });
      box.addEventListener('pointerdown', (e) => e.stopPropagation());

      // keyboard (gameplay is blocked while talking, so these need allowInModal)
      const bind = (codes, fn) => codes.forEach((code) => G.input?.onKey?.(code, (e) => {
        if (!this.active || this._foreign()) return false;
        fn(e);
        return true;
      }, { allowInModal: true }));
      for (let n = 1; n <= 4; n++) bind([`Digit${n}`, `Numpad${n}`], () => { if (this._typing) this._finishTyping(); else this.choose(n - 1); });
      bind(['Space', 'Enter', 'NumpadEnter', 'KeyE'], () => this.advance());
      bind(['ArrowDown'], () => this._moveFocus(1));
      bind(['ArrowUp'], () => this._moveFocus(-1));
      G.ui.onEscape(() => {
        if (!this.active || this._foreign()) return false;
        this.close();
        return true;
      }, 90);
    },

    postInit() { try { this._validate(); } catch (e) { G.log.warn('UI', 'dialogue data check failed', e); } },
    // a new / reset / imported state voids the running conversation (no dialogue:end: it must not count for the new save)
    onStateLoaded() { if (this.active) this.close({ silent: true, immediate: true, emit: false }); },
    onLogout() { if (this.active) this.close({ silent: true, immediate: true, emit: false }); },

    update(dt) {
      if (!this._typing) return;
      if (this._pause > 0) { this._pause -= dt; return; }
      this._acc += dt * CPS;
      let n = this._shown;
      while (this._acc >= 1 && n < this._total) {
        this._acc -= 1;
        const ch = this._flat[n++];
        if (ch === '.' || ch === '!' || ch === '?' || ch === '…' || ch === '\n') { this._pause = 0.2; this._acc = 0; break; }
        if (ch === ',' || ch === '·') { this._pause = 0.08; this._acc = 0; break; }
      }
      if (n !== this._shown) this._reveal(n);
      if (n >= this._total) this._finishTyping();
    },

    // ------------------------------------------------------------ public API
    start(dialogueId, opts = {}) {
      if (!G.state || !this._box) return false;
      let def = dialogueId ? defs()[dialogueId] : null;
      const npcId = opts.npcId || def?.npc || null;
      if (this.active) {
        if (this.active.dialogueId === (dialogueId || null) && this.active.npcId === npcId) return true;
        this.close({ immediate: true });
      }
      if (!def) {
        if (dialogueId) G.log.warn('UI', `dialogue "${dialogueId}" not found — using the NPC greeting`);
        def = this._fallbackDef(npcId);
        if (!def) return false;
      }
      const nodeId = opts.node || this._entryNode(def);
      const rec = npcId ? G.sys.npc?.get?.(npcId) : null;
      const data = rec?.data || G.data.npcs?.[npcId] || null;
      const a = this.active = { dialogueId: dialogueId || null, npcId, def, data, nodeId: null, node: null, token: ++this._seq, afterClose: [], visits: {}, startedAt: G.time.now() };

      clearTimeout(this._unblockT); clearTimeout(this._hideT);
      G.ui.block('dialogue');
      document.body.classList.add('dialogue-open');
      this._applyMode();
      try { G.easy?.stopPoint?.(); } catch (e) { /* optional */ }
      try { G.ui.popover?.close?.(); } catch (e) { /* ignore */ }
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
      this._setSpeaker(data, npcId);
      const box = this._box;
      box.hidden = false;
      box.classList.remove('out');
      box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');

      const pl = G.sys.player;
      if (pl) {
        pl.cancelWalk?.('dialogue');
        if (rec) pl.faceTowards?.(rec.position.x, rec.position.z);
        if (rec?.rig?.headAnchor && pl.rig?.setLookTarget) { pl.rig.setLookTarget(rec.rig.headAnchor); this._playerLook = rec.rig.headAnchor; }
      }
      if (rec) {
        G.sys.npc.setTalking(npcId, true);
        // two-shot framing only when the player actually stands next to the NPC (API calls from afar keep the follow camera)
        const pp = pl?.position;
        const near = !pp || Math.hypot(pp.x - rec.position.x, pp.z - rec.position.z) < 7;
        if (near) { try { this._frameCamera(rec); } catch (e) { G.log.warn('UI', 'dialogue camera', e); } }
      }
      G.sfx('open');
      G.log.info('UI', `dialogue ${a.dialogueId || '(greeting)'} with ${npcId || '-'} -> ${nodeId}`);
      if (npcId) G.bus.emit('npc:talk', { npcId });
      if (this.active !== a) return true;   // a listener ended it
      this._show(nodeId);
      return true;
    },

    close(opts = {}) {
      const a = this.active;
      if (!a) return false;
      this.active = null;
      this._typing = false;
      this._choices = [];
      this._stopSpeech();
      const box = this._box;
      box.classList.remove('in');
      box.classList.add('out');
      clearTimeout(this._hideT);
      this._hideT = setTimeout(() => { if (!this.active) { box.hidden = true; box.classList.remove('out'); } }, 220);
      document.body.classList.remove('dialogue-open');
      clearTimeout(this._unblockT);
      // short grace period: the key that closed the dialogue must not also jump / interact
      if (opts.immediate) G.ui.unblock('dialogue');
      else this._unblockT = setTimeout(() => { if (!this.active) G.ui.unblock('dialogue'); }, 160);
      if (a.npcId) G.sys.npc?.setTalking?.(a.npcId, false);
      const pr = G.sys.player?.rig;
      if (pr && this._playerLook && pr._look === this._playerLook) pr.setLookTarget(null);
      this._playerLook = null;
      if (G.sys.camera?.mode === 'dialogue') { try { G.sys.camera.setMode('follow', { duration: 0.7 }); } catch (e) { /* ignore */ } }
      if (opts.emit !== false) G.bus.emit('dialogue:end', { npcId: a.npcId, dialogueId: a.dialogueId });
      if (!opts.silent) G.sfx('close');
      const after = a.afterClose;
      if (after.length && !opts.silent) setTimeout(() => { for (const act of after) this._exec(act, a); }, 40);
      return true;
    },

    /** pick visible choice #i (0-based) */
    choose(i) {
      const a = this.active;
      if (!a || this._typing) return false;
      const c = this._choices[i];
      if (!c) return false;
      G.sfx('click');
      const token = a.token;
      // the player character reacts to what they said
      const pl = G.sys.player;
      if (pl?.playAction && !pl.sitting && !pl.rig?.currentAction) {
        const types = arr(c.actions).map((x) => normAction(x)?.type);
        try {
          if (types.includes('claimQuest')) pl.playAction('celebrate');
          else if (types.includes('acceptQuest')) pl.playAction('thumbsup');
          else if (!c.end && Math.random() < 0.3) pl.playAction('nod');
        } catch (e) { /* cosmetic */ }
      }
      this._runActions(c.actions, a);
      if (this.active !== a || a.token !== token) return true;
      if (c.end) { this.close(); return true; }
      const next = this._resolveNext(c.next);
      if (next && next !== 'END') {
        if (a.npcId && Math.random() < 0.45) G.sys.npc?.playAnim?.(a.npcId, 'nod');
        this._show(next);
        return true;
      }
      this.close();   // no (matching) next: the conversation ends and deferred UI actions run
      return true;
    },

    /** tap on the text / portrait (normal) or anywhere (쉬운 모드) */
    _onTapAnywhere() {
      if (!this.active || this._foreign()) return;
      if (kidOn() && !this._typing && this._choices.length) { this._nudgeChoices(); return; }
      this.advance();
    },
    /** 쉬운 모드: the child tapped beside the picture buttons — wiggle them and say what to do */
    _nudgeChoices() {
      const el = this._choicesEl;
      el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge');
      try { G.easy?.say?.('아래 그림 중에 하나를 골라요!', { priority: 1 }); } catch (e) { /* voice optional */ }
    },
    /** apply normal / 쉬운 모드 presentation (box class, hint, button words) */
    _applyMode() {
      const kid = kidOn();
      this._box?.classList.toggle('kid', kid);
      if (!this._hintEl) return;
      if (this._hintMode === kid) return;
      this._hintMode = kid;
      // static strings only
      this._hintEl.innerHTML = kid
        ? '<span class="h-line"><span class="emoji">👆</span> 아무 데나 눌러요</span><span class="h-pick"><span class="emoji">👇</span> 그림을 하나 골라요</span>'
        : G.input?.touchUI
          ? '화면을 눌러 넘기기'
          : '<span class="h-line"><kbd>Space</kbd> 다음</span><span class="h-pick"><kbd>1</kbd>–<kbd>4</kbd> 선택 <span class="sep">·</span> <kbd>↑</kbd><kbd>↓</kbd> 이동</span> <span class="sep">·</span> <kbd>Esc</kbd> 닫기';
    },
    /** easy mode switched while talking: same line, other words / buttons (actions are NOT run again) */
    _onModeChange() {
      this._applyMode();
      const a = this.active;
      if (!a || !a.node || !a.texts) return;
      const text = kidOn() ? a.texts.k : a.texts.n;
      this._type(text);
      if (kidOn()) this._speak(text);
    },

    /** skip the typewriter, or continue when the line has no choices */
    advance() {
      const a = this.active;
      if (!a) return false;
      if (this._typing) { this._finishTyping(); return true; }
      if (this._choices.length) { if (this._focus >= 0) this.choose(this._focus); return true; }
      const next = this._resolveNext(a.node?.next);
      if (next && next !== 'END') this._show(next); else this.close();
      return true;
    },

    /** run actions now (UI-opening ones are deferred until the conversation closes) */
    run(actions) { return this._runActions(actions, this.active); },
    isOpen() { return !!this.active; },

    // ------------------------------------------------------------ internals
    /**
     * Two-shot dialogue framing via camera.focusOn. Narrow (portrait) screens swing the camera closer to the
     * player→NPC axis. The camera side is chosen so the shot is not blocked by buildings / props: candidate
     * positions are predicted the same way the camera module places them and tested against colliders and
     * G.world.cameraBlockers.
     */
    _frameCamera(rec) {
      const cam = G.sys.camera;
      if (!cam?.focusOn) return;
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const base = aspect < 0.9 ? { distance: 4.6, height: 1.9, side: 0.32 } : aspect < 1.35 ? { distance: 3.9, height: 1.75, side: 0.6 } : { distance: 3.4, height: 1.62, side: 0.95 };
      const target = rec.focusAnchor || rec.rig.headAnchor;
      const pp = G.sys.player?.position;
      const cpos = G.sys.engine?.camera?.position;
      let side = base.side;
      if (pp && cpos) {
        target.getWorldPosition(_fv);
        let ax = pp.x - _fv.x, az = pp.z - _fv.z;
        const pair = Math.hypot(ax, az);
        if (pair > 0.05) {
          ax /= pair; az /= pair;
          let px = -az, pz = ax;
          if (px * (cpos.x - _fv.x) + pz * (cpos.z - _fv.z) < 0) { px = -px; pz = -pz; }
          const lx = _fv.x + (pp.x - _fv.x) * (pair < 8 ? 0.4 : 0), lz = _fv.z + (pp.z - _fv.z) * (pair < 8 ? 0.4 : 0);
          const gy = G.world.heightAt(_fv.x, _fv.z, _fv.y + 0.5);
          const dist = Math.max(base.distance, pair * 0.9 + 2.0);
          const camY = gy + base.height;
          const clear = (s) => {
            const c = Math.cos(s), sn = Math.sin(s);
            let dx = ax * c + px * sn, dz = az * c + pz * sn;
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            for (let k = 0.3; k <= 1.0001; k += 0.14) {
              const x = lx + dx * dist * k, z = lz + dz * dist * k;
              if (G.world.blocked(x, z, 0.3, camY - 1.15)) return false;
              if (G.world.terrainHeight(x, z) > camY - 0.35) return false;
            }
            const blockers = G.world.cameraBlockers;
            if (blockers?.length) {
              const ray = this._ray || (this._ray = new THREE.Raycaster());
              _fv2.set(lx, gy + 1.3, lz);
              _fv3.set(dx, (camY - _fv2.y) / dist, dz).normalize();
              ray.set(_fv2, _fv3);
              ray.far = Math.hypot(dist, camY - _fv2.y);
              try { if (ray.intersectObjects(blockers, true).length) return false; } catch (e) { /* ignore */ }
            }
            return true;
          };
          const tries = [side, -side, side * 0.5, -side * 0.5, side * 1.45, -side * 1.45, 0];
          side = tries.find(clear) ?? side;
        }
      }
      cam.focusOn(target, { distance: base.distance, height: base.height, side, duration: 0.85 });
    },

    _foreign() {
      for (const k of G.ui.blockers) if (k !== 'dialogue') return true;
      return false;
    },

    _entryNode(def) {
      for (const e of def.entries || []) { if (e && e.node && check(e.if)) return e.node; }
      return def.nodes?.start ? 'start' : Object.keys(def.nodes || {})[0];
    },
    _fallbackDef(npcId) {
      const d = G.data.npcs?.[npcId];
      if (!d) return null;
      return { npc: npcId, nodes: { start: { text: d.greeting || '안녕하세요!', choices: [{ text: '안녕히 계세요', end: true }] } } };
    },
    _resolveNext(next) {
      if (!next) return null;
      if (typeof next === 'string') return next;
      for (const n of arr(next)) {
        if (!n) continue;
        if (typeof n === 'string') return n;
        if (check(n.if)) return n.node || n.next || null;
      }
      return null;
    },

    _show(nodeId) {
      const a = this.active;
      if (!a) return;
      if (!nodeId || nodeId === 'END') { this.close(); return; }
      const node = a.def.nodes?.[nodeId];
      if (!node) { G.log.warn('UI', `dialogue node missing: ${a.dialogueId}.${nodeId}`); this.close(); return; }
      a.nodeId = nodeId; a.node = node;
      a.visits[nodeId] = (a.visits[nodeId] || 0) + 1;
      const token = a.token;
      this._runActions(node.actions, a);
      if (this.active !== a || a.token !== token) return;
      this._setSpeaker(a.data, a.npcId, node.speaker ? fill(node.speaker) : null);
      this._choicesEl.innerHTML = '';
      this._choices = [];
      this._focus = -1;
      this._nextBtn.hidden = true;
      this._box.classList.remove('has-choices');
      a.texts = this._nodeTexts(node);
      const text = kidOn() ? a.texts.k : a.texts.n;
      if (a.npcId) {
        if (node.emote) G.sys.npc?.playAnim?.(a.npcId, node.emote);
        G.sys.npc?.setSpeaking?.(a.npcId, !!text);
      }
      if (node.expression && a.npcId) { try { G.sys.npc?.get?.(a.npcId)?.rig?.setExpression?.(node.expression, 4); } catch (e) { /* cosmetic */ } }
      this._type(text);
      this._speak(text);
      G.sfx('chat');
    },

    /** the line of a node in the current mode */
    _nodeText(node) { const t = this._nodeTexts(node); return kidOn() ? t.k : t.n; },
    /**
     * {n: normal line, k: kid line} — the first matching variant wins (its own `kid`, else its normal text);
     * otherwise node.text / node.kid. Arrays pick one random line (the kid array uses the same index).
     */
    _nodeTexts(node) {
      let t = null, k = null;
      if (Array.isArray(node.variants)) for (const v of node.variants) { if (v && v.text != null && check(v.if)) { t = v.text; k = v.kid ?? null; break; } }
      if (t == null) { t = node.text; k = node.kid ?? null; }
      if (Array.isArray(t)) {
        const i = t.length ? Math.floor(Math.random() * t.length) : 0;
        if (Array.isArray(k)) k = k.length ? k[Math.min(i, k.length - 1)] : null;
        t = t.length ? t[i] : '';
      } else if (Array.isArray(k)) k = k.length ? pick(k) : null;
      const n = fill(t == null ? '' : String(t));
      const kk = k != null && String(k).trim() ? fill(String(k)) : n;
      return { n, k: kk };
    },

    /** re-apply the speaker chip / portrait (e.g. when the NPC portrait finished rendering) */
    _refreshSpeaker() {
      const a = this.active;
      if (a) this._setSpeaker(a.data, a.npcId, a.node?.speaker ? fill(a.node.speaker) : null);
    },

    _setSpeaker(data, npcId, override) {
      const name = override || data?.name || '안내';
      this._nameEl.textContent = name;
      this._roleEl.textContent = override ? '' : (data?.role || '');
      this._roleEl.hidden = !this._roleEl.textContent;
      const url = !override && npcId ? G.sys.npc?.portrait?.(npcId) : null;
      if (url) {
        if (this._img.getAttribute('src') !== url) this._img.src = url;
        this._img.hidden = false;
        this._face.textContent = '';
      } else {
        this._img.hidden = true;
        this._face.textContent = override ? '💬' : (G.sys.npc?.icon?.(npcId) || '🙂');
      }
      this._box.dataset.npc = npcId || '';
      this._box.setAttribute('aria-label', `${josa(name, '과/와')}의 대화`);
    },

    // typewriter
    _type(text) {
      const el = this._textEl;
      el.textContent = '';
      this._segs = [];
      this._flat = [];
      let total = 0;
      for (const s of parseRich(text)) {
        const span = document.createElement(s.hl ? 'b' : 'span');
        if (s.hl) span.className = 'hl';
        const chars = Array.from(s.t);
        el.appendChild(span);
        this._segs.push({ span, chars, full: s.t, start: total, k: 0 });
        for (const ch of chars) this._flat.push(ch);
        total += chars.length;
      }
      this._caret.hidden = true;
      el.appendChild(this._caret);
      this._total = total; this._shown = 0; this._acc = 0; this._pause = 0.05;
      this._srEl.textContent = text.replace(/\*\*/g, '');
      this._typing = total > 0;
      this._box.classList.toggle('typing', this._typing);
      if (!this._typing || G.settings.reduceMotion) this._finishTyping();
    },
    _reveal(n) {
      for (const s of this._segs) {
        const k = clamp(n - s.start, 0, s.chars.length);
        if (k !== s.k) { s.k = k; s.span.textContent = k === s.chars.length ? s.full : s.chars.slice(0, k).join(''); }
      }
      this._shown = n;
    },
    _finishTyping() {
      this._typing = false;
      this._box.classList.remove('typing');
      this._reveal(this._total);
      const a = this.active;
      if (!a) return;
      if (a.npcId) G.sys.npc?.setSpeaking?.(a.npcId, false);
      this._renderChoices();
    },

    _renderChoices() {
      const a = this.active;
      const node = a?.node;
      if (!node) return;
      const h = G.ui.h;
      const kid = kidOn();
      let list = (node.choices || []).filter((c) => c && c.text != null && check(c.if)).slice(0, 6);
      if (kid) list = kidChoices(list);
      this._choices = list;
      this._focus = -1;
      const box = this._choicesEl;
      box.innerHTML = '';
      box.classList.toggle('kid', kid);
      box.dataset.n = String(list.length);
      if (list.length) {
        list.forEach((c, i) => {
          const st = choiceStyle(c);
          const b = kid
            ? h('button', { class: `dlg-choice kid ${st.cls}`.trim(), type: 'button', tabindex: '-1', dataset: { i: String(i), say: fill(c.kid ?? c.text) } },
              h('span', { class: 'dc-emo emoji', 'aria-hidden': 'true' }, kidChoiceEmoji(c, st)),
              h('span', { class: 'dc-text', text: fill(c.kid ?? c.text) }))
            : h('button', { class: `dlg-choice ${st.cls}`.trim(), type: 'button', tabindex: '-1', dataset: { i: String(i) } },
              i < 9 ? h('kbd', null, String(i + 1)) : null,
              st.icon ? h('span', { class: 'dc-ico emoji', 'aria-hidden': 'true' }, st.icon) : null,
              h('span', { class: 'dc-text', text: fill(c.text) }));
          b.style.animationDelay = `${i * (kid ? 90 : 50)}ms`;
          box.appendChild(b);
        });
        this._caret.hidden = true;
        this._nextBtn.hidden = true;
      } else {
        const next = this._resolveNext(node.next);
        const more = !!next && next !== 'END';
        // static strings only
        this._nextBtn.innerHTML = kid
          ? (more ? '<span class="emoji">👉</span> 다음' : '<span class="emoji">👋</span> 안녕')
          : (more ? '다음 <span class="arr">▶</span>' : '대화 마치기');
        this._nextBtn.classList.toggle('end', !more);
        this._nextBtn.hidden = false;
        this._caret.hidden = !more;
      }
      this._box.classList.toggle('has-choices', list.length > 0);
    },
    _setFocus(i) {
      this._focus = i;
      this._choicesEl.querySelectorAll('.dlg-choice').forEach((b, k) => b.classList.toggle('focus', k === i));
    },
    _moveFocus(d) {
      if (this._typing || !this._choices.length) return;
      const n = this._choices.length;
      this._setFocus(this._focus < 0 ? (d > 0 ? 0 : n - 1) : (this._focus + d + n) % n);
    },

    // actions
    _runActions(list, a) {
      for (const raw of arr(list)) {
        const act = normAction(raw);
        if (!act) { G.log.warn('UI', 'dialogue: malformed action', raw); continue; }
        if (UI_ACTIONS.has(act.type) && a) a.afterClose.push(act);
        else this._exec(act, a);
      }
    },
    _missing(what) {
      G.log.warn('UI', `dialogue action needs the "${what}" system, which is not available`);
      G.ui.toast(`지금은 ${what} 기능을 사용할 수 없어요.`, { type: 'warn' });
    },
    _exec(act, ctx) {
      const S = G.sys;
      const v = act.value;
      try {
        switch (act.type) {
          case 'acceptQuest': {
            const q = act.quest ?? v;
            if (!S.quest?.accept) { this._missing('퀘스트'); return; }
            if (!S.quest.accept(q)) G.log.info('QUEST', `dialogue: ${q} not accepted (status ${questStatus(q)})`);
            return;
          }
          case 'claimQuest': {
            const q = act.quest ?? v;
            if (!S.quest?.claim) { this._missing('퀘스트'); return; }
            if (!S.quest.claim(q)) G.log.info('QUEST', `dialogue: ${q} not claimed (status ${questStatus(q)})`);
            return;
          }
          case 'giveItem': {
            const id = act.item ?? v, n = Math.max(1, Math.floor(Number(act.qty) || 1));
            if (!G.data.items?.[id]) { G.log.warn('INVENTORY', `dialogue: unknown item ${id}`); return; }
            if (S.inventory?.add) { S.inventory.add(id, n, { source: 'npc' }); return; }
            const inv = G.state.inventory || (G.state.inventory = {});
            inv[id] = (Number(inv[id]) || 0) + n;
            G.dirty('inventory');
            G.ui.toast(`+${G.ui.itemName(id)} ×${n}`, { emoji: G.ui.itemIcon(id), type: 'success' });
            return;
          }
          case 'takeItem': {
            const id = act.item ?? v, n = Math.max(1, Math.floor(Number(act.qty) || 1));
            if (S.inventory?.remove) { S.inventory.remove(id, n, { source: 'npc' }); return; }
            const inv = G.state.inventory || {};
            if ((Number(inv[id]) || 0) >= n) { inv[id] -= n; if (!inv[id]) delete inv[id]; G.dirty('inventory'); }
            return;
          }
          case 'setFlag': { const f = act.flag ?? v; if (f && G.state) { flags()[f] = act.flag && v != null ? v : G.time.now(); G.dirty('flag'); } return; }
          case 'clearFlag': { const f = act.flag ?? v; if (f && G.state && flags()[f] != null) { delete flags()[f]; G.dirty('flag'); } return; }
          case 'emote': {
            const id = act.emote ?? v;
            if (S.social?.emote) { S.social.emote(id); return; }
            const em = (G.data.emotes || []).find((e) => e.id === id) || (G.data.gestures || []).find((g) => g.id === id);
            if (em?.anim) S.player?.playAction?.(em.anim);
            return;
          }
          case 'npcAnim': { const id = act.npc || ctx?.npcId; if (id) S.npc?.playAnim?.(id, act.anim ?? v); return; }
          case 'event': if (act.name) G.bus.emit(act.name, act.payload ?? {}); return;
          case 'toast': G.ui.toast(fill(act.text ?? v ?? ''), { type: act.kind || 'info', emoji: act.emoji }); return;
          case 'sfx': G.sfx(act.name ?? v); return;
          case 'activity': G.activity('npc', fill(act.text ?? v ?? '')); return;
          // ---- UI (normally deferred until the conversation closes)
          case 'openEdu': {
            const edu = act.edu ?? v ?? 'EDU_FERMENT';
            if (!S.education?.open) { this._missing('교육 콘텐츠'); return; }
            S.education.open(edu, act.page != null ? { page: act.page } : undefined);
            return;
          }
          case 'openQuiz': {
            const edu = act.edu || null;
            const want = act.quiz ?? v;
            let id = want && G.data.quizzes?.[want] ? want : null;
            if (!id) { try { id = S.education?.pickQuiz?.(edu) || null; } catch (e) { id = null; } }
            if (!id) id = pickQuiz(null, edu);
            if (id && S.education?.openQuiz) { S.education.openQuiz(id); return; }
            if (S.education?.open) { S.education.open(edu || G.data.quizzes?.[id]?.edu || 'EDU_FERMENT'); return; }
            this._missing('퀴즈');
            return;
          }
          case 'openLibrary': {
            if (S.education?.openLibrary) { S.education.openLibrary(); return; }
            if (S.education?.open) { S.education.open('EDU_FERMENT'); return; }
            this._missing('배움터');
            return;
          }
          case 'openShop': if (S.inventory?.openShop) S.inventory.openShop(act.shop ?? v ?? 'SHOP_GENERAL'); else this._missing('매점'); return;
          case 'openCraft': if (S.fermentation?.openCraft) S.fermentation.openCraft(); else this._missing('작업대'); return;
          case 'openJar': if (S.fermentation?.openJar) S.fermentation.openJar(act.jar ?? v ?? 'J1'); else this._missing('장독'); return;
          case 'openMap': if (S.minimap?.openWorldMap) S.minimap.openWorldMap(); else this._missing('지도'); return;
          case 'openFastTravel':
            // 쉬운 모드: the picture "어디 갈까?" menu (08-easy owns the 'where' action)
            if (kidOn() && G.ui.triggerAction('where')) return;
            if (S.minimap?.openFastTravel) S.minimap.openFastTravel();
            else if (S.minimap?.openWorldMap) S.minimap.openWorldMap();
            else this._missing('이동 메뉴');
            return;
          case 'openJournal': if (S.journal?.open) S.journal.open(); else this._missing('작업일지'); return;
          case 'openQuestLog': if (S.quest?.openLog) S.quest.openLog(act.tab ?? null, act.quest ?? null); else this._missing('퀘스트 목록'); return;
          case 'openInventory': if (S.inventory?.open) S.inventory.open(act.tab); else this._missing('가방'); return;
          case 'openCollection': if (S.progression?.openCollection) S.progression.openCollection(act.category); else this._missing('도감'); return;
          case 'teleport': {
            const zone = act.zone ?? v;
            const z = zone ? G.world.zoneById(zone) : null;
            const x = Number.isFinite(act.x) ? act.x : z?.center?.[0];
            const tz = Number.isFinite(act.z) ? act.z : z?.center?.[1];
            if (!Number.isFinite(x) || !Number.isFinite(tz)) { G.log.warn('UI', `dialogue teleport: unknown target ${zone}`); return; }
            let rotY = Number.isFinite(act.rotY) ? act.rotY : undefined;
            if (rotY === undefined && z && Math.hypot(z.center[0] - x, z.center[1] - tz) > 1) rotY = Math.atan2(z.center[0] - x, z.center[1] - tz);
            if (!S.player?.teleport) { this._missing('순간 이동'); return; }
            Promise.resolve(S.player.teleport(x, tz, rotY)).catch((e) => G.log.warn('PLAYER', 'teleport failed', e));
            return;
          }
          default:
            G.log.warn('UI', `dialogue: unknown action "${act.type}"`, act);
        }
      } catch (e) {
        G.log.error('UI', `dialogue action ${act.type} failed`, e);
      }
    },

    // voice-over (쉬운 모드: every line through the shared kid voice queue, so it never fights other prompts)
    _speak(text) {
      if (!text) return;
      const plain = text.replace(/\*\*/g, '');
      if (kidOn() && G.easy?.say) { try { G.easy.say(plain, { priority: 1 }); } catch (e) { /* voice optional */ } return; }
      if (!G.settings.voiceOver) return;
      try {
        if (G.sys.audio?.speak) { G.sys.audio.speak(plain); return; }
        const ss = window.speechSynthesis;
        if (!ss || typeof window.SpeechSynthesisUtterance !== 'function') return;
        ss.cancel();
        const u = new window.SpeechSynthesisUtterance(plain);
        u.lang = 'ko-KR'; u.rate = 1.05;
        ss.speak(u);
      } catch (e) { /* speech is optional */ }
    },
    _stopSpeech() {
      if (kidOn()) { try { G.easy?.stop?.(); } catch (e) { /* optional */ } }
      if (!G.settings.voiceOver) return;
      try { G.sys.audio?.stopSpeaking?.(); } catch (e) { /* optional */ }
      try { window.speechSynthesis?.cancel?.(); } catch (e) { /* optional */ }
    },

    /** warn about broken references in G.data.dialogues (missing nodes / NPCs / unknown actions) */
    _validate() {
      const issues = [];
      for (const [id, def] of Object.entries(defs())) {
        const nodes = def.nodes || {};
        if (def.npc && !G.data.npcs?.[def.npc]) issues.push(`${id}: unknown npc ${def.npc}`);
        const ref = (next, where) => {
          for (const n of arr(next)) {
            const t = typeof n === 'string' ? n : n && (n.node || n.next);
            if (t && t !== 'END' && !nodes[t]) issues.push(`${id}.${where} -> missing node "${t}"`);
          }
        };
        const conds = (c, where) => {
          if (!c || typeof c !== 'object') return;
          if (Array.isArray(c)) { c.forEach((x) => conds(x, where)); return; }
          for (const k of Object.keys(c)) {
            if (!KNOWN_CONDS.has(k)) issues.push(`${id}.${where}: unknown condition "${k}"`);
            else if (k === 'any' || k === 'all') conds(c[k], where);
            else if (k === 'not') conds(c[k], where);
            else if (k === 'questStatus' || k === 'questStep') for (const q of Object.keys(c[k] || {})) if (!G.data.quests?.[q]) issues.push(`${id}.${where}: unknown quest ${q}`);
          }
        };
        const acts = (list, where) => {
          for (const raw of arr(list)) {
            const a = normAction(raw);
            if (!a || !KNOWN_ACTIONS.has(a.type)) issues.push(`${id}.${where}: unknown action ${JSON.stringify(raw)}`);
            else if ((a.type === 'acceptQuest' || a.type === 'claimQuest') && !G.data.quests?.[a.quest ?? a.value]) issues.push(`${id}.${where}: unknown quest ${a.quest ?? a.value}`);
            else if (a.type === 'giveItem' && !G.data.items?.[a.item ?? a.value]) issues.push(`${id}.${where}: unknown item ${a.item ?? a.value}`);
          }
        };
        (def.entries || []).forEach((e, i) => { ref(e?.node, `entries[${i}]`); conds(e?.if, `entries[${i}]`); });
        (def.barks || []).forEach((b, i) => { if (b && typeof b === 'object') conds(b.if, `barks[${i}]`); });
        for (const [nid, n] of Object.entries(nodes)) {
          if (!n) { issues.push(`${id}.${nid}: empty node`); continue; }
          if (n.text == null && !n.variants) issues.push(`${id}.${nid}: no text`);
          ref(n.next, nid);
          for (const x of arr(n.next)) if (x && typeof x === 'object') conds(x.if, `${nid}.next`);
          for (const v of n.variants || []) conds(v?.if, `${nid}.variants`);
          acts(n.actions, nid);
          (n.choices || []).forEach((c, i) => {
            ref(c.next, `${nid}.choices[${i}]`); acts(c.actions, `${nid}.choices[${i}]`); conds(c.if, `${nid}.choices[${i}]`);
            for (const x of arr(c.next)) if (x && typeof x === 'object') conds(x.if, `${nid}.choices[${i}].next`);
          });
          if ((n.choices || []).length > 8) issues.push(`${id}.${nid}: more than 8 choices (max 4 should be visible at once)`);
        }
      }
      for (const [nid, n] of Object.entries(G.data.npcs || {})) if (n.dialogue && !defs()[n.dialogue]) issues.push(`npc ${nid}: dialogue "${n.dialogue}" missing`);
      if (issues.length) G.log.warn('UI', `dialogue data: ${issues.length} problem(s)\n  ${issues.slice(0, 20).join('\n  ')}`);
      else G.log.debug('UI', `dialogue data ok (${Object.keys(defs()).length} dialogues)`);
      return issues;
    },
  };
  G.register(dialogue);
})();
