// =============================================================================
// 18-places.js — places: walk-in rooms and districts (G.sys.places, CONTRACT §16.4)
//
// A PLACE is a region of the same scene far away from the valley (rooms near z = 2000, 200 m apart; the district at
// (0, 2600)). Entering swaps what "the world" means for the player — bounds, ground, water, surface, zone, camera,
// light, weather, sound — behind ONE fade; leaving puts everything back. Colliders need no swapping (spatial hashes).
//
//   define({ id: 'PL_…', name, kidName, emoji, zoneId: 'ZONE_PL_…', origin: {x, z}, size: {w, d, h}, floorY = 0 (or (lx, lz) -> y),
//            surface = 'wood', spawn: {x, z, rotY} (LOCAL), door: {buildingId, x, z, label, kidLabel} (WORLD; or an
//            array; optional), exit: {x, z, rotY} (WORLD), indoor = true, camera: {dist, min, max, pitch, pmin, pmax,
//            ceil}, light: profile | (ctx) => profile (10-engine setIndoor; indoor places), far, keepAlive (the
//            district), heightAt / isWater / surfaceAt (lx, lz) (outdoor places with their own ground),
//            exhibits: [{id, anchor, title, emoji, kid, detail}] (shown when 49-exhibits is absent),
//            minimap(ctx2d, map), build(ctx) -> { dispose()? } })                        -> the stored definition
//   enter(id, {fade = true, spawn, quiet}) -> Promise<bool>     exit({fade = true, to, quiet}) -> Promise<bool>
//                                    (quiet: a technical visit — nothing counted, no sound, banner, voice or event)
//   travel(id) -> Promise<bool>      walk to the door, then enter (direct in easy mode, from another place, or far away)
//   current (id | null) · is(id) · def(id) · list() · indoor · contains(x, z, id = current)
//   toLocal(x, z) / toWorld(placeId, x, z) · hub() (the rescue point inside: the place spawn, world) · saveSpot()
//   doorOf(buildingId, {out, side}) -> {x, z, rotY, exit: {x, z, rotY}}   the middle of a building's front + the spot
//                                                                        2.6 m in front of it (for define())
//   hideRoot(name | RegExp)          another module's main-world scene root that must not draw inside a place
//   pickTravel() -> Promise<id|null> the "🏠 집 구경" picture menu (가기 lists)
//   events: 'place:built' {id} · 'place:enter' {id, prev} · 'place:exit' {id, to, reason}
//
// build(ctx) works in LOCAL coordinates (origin = the middle of the floor, +Y up, north = −Z):
//   ctx.group            THREE.Group at the place origin (add meshes here)       ctx.id / ctx.def / ctx.size / ctx.preset
//   ctx.quality          'low' | 'medium' | 'high'      ctx.low (bool)           ctx.kit (= G.hanok)
//   ctx.addCollider({shape: 'box'|'circle', x, z, hw, hd, rot, r, minY, maxY, stand})   minY / maxY above the floor
//   ctx.addWalkable({shape, x, z, hw, hd, r, top, surface})                              top above the floor
//   ctx.interact({id, kind, label, kidLabel, emoji, position: {x, y, z}, object, radius, onInteract}) -> handle
//   ctx.anchor(key | [keys], Object3D | {x, y, z}) -> Object3D   an exhibit anchor (§16.6); exhibits are attached
//                        after build() (G.sys.exhibits.attach(id, anchorObject3D)); 'shelf:0…n' = the fallback shelf
//   ctx.board(motionId, {x, y, z, rotY, w, h, title}) -> Mesh   a framed motion board (G.sys.exhibits.board; a still
//                        poster without it); redrawn only while the player is within 12 m
//   ctx.light({x, y, z, color, intensity, distance, decay, flicker, day}) -> handle   a lamp / fire light from the
//                        engine's pool (nothing on `low`); ctx.lights(n) -> PointLight[] (raw; their values are
//                        remembered after build())
//   ctx.onUpdate(fn(dt, t))   every frame while the player is in this place
//   ctx.exitDoor(x, z, {y})   where the door back out is (its interactable has radius 3.2)
//   ctx.own(thing)            a texture / material / geometry made for this place only (disposed with it)
// The system removes colliders, walkables, interactables, boards and anchors on dispose; geometries are disposed,
// shared materials are kept. At most two rooms (+ places with keepAlive) stay built (least recently used goes).
//
// Never stuck (kids): the HUD chip "📍 <place> · 🚪 밖으로" is always there, the exit door reaches 3.2 m, every
// teleport / walk / travel to somewhere else leaves first, the rescue point is the place spawn, a save made inside
// stores the exit spot (a load resumes outside), logout / reset / import leave at once, no double jump indoors.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const RX_ID = /^PL_[A-Z0-9_]{2,24}$/, RX_ZONE = /^ZONE_[A-Z0-9_]{1,30}$/;
  const LRU_ROOMS = 2;
  const EXIT_RADIUS = 3.2, DOOR_RADIUS = 3.2;
  // main-world scene roots that are hidden while the player is in a place (their lights are kept by the engine's pool)
  const WORLD_ROOTS = new Set(['terrain-core', 'terrain-outer', 'terrain-backdrop', 'roads', 'paths', 'nature', 'clouds', 'valley-mist',
    'water', 'waterfall', 'buildings', 'props', 'manjangdae', 'npcs', 'quest-markers', 'engagement-decor', 'puddles', 'place-doors']);
  const WORLD_ROOT_RX = [/^jar:/, /^rtbed:/, /^crop[:-]/, /^plot[:-]/];
  // … and inside a room also the sky layers (the engine's own sky dome is hidden by reference)
  const INDOOR_ROOTS = new Set(['weather-sky', 'rain', 'rain-splashes', 'snow']);

  const defs = new Map();      // id -> def
  const zoneToPlace = new Map();
  const live = new Map();      // id -> built place (insertion order = least recently used first)
  const base = { terrain: null, water: null, surface: null, zoneAt: null, zoneById: null };
  const _v = new THREE.Vector3();
  let cur = null;              // the built place the player is in
  let saved = null;            // { bounds, far } of the main world while inside

  const num = (v, d) => (fin(Number(v)) ? Number(v) : d);
  const spot = (o, d) => (o && fin(Number(o.x)) && fin(Number(o.z)) ? { x: Number(o.x), z: Number(o.z), rotY: num(o.rotY, d?.rotY ?? 0) } : d || null);

  // ---------------------------------------------------------------- the world as a place sees it
  /** the ground of a place in its own coordinates: floorY as a function and / or heightAt (summed); null = flat */
  function floorFn(d) {
    const f = typeof d.floorY === 'function' ? d.floorY : null, h = typeof d.heightAt === 'function' ? d.heightAt : null;
    if (!f) return h;
    return (lx, lz) => { const a = Number(f(lx, lz)); return (fin(a) ? a : 0) + (h ? (Number(h(lx, lz)) || 0) : 0); };
  }
  function installWorldHooks() {
    const W = G.world;
    if (!W || base.terrain) return;
    base.terrain = W._terrain; base.water = W._water; base.surface = W._surface;
    W._terrain = (x, z) => {
      if (!cur) return base.terrain(x, z);
      const d = cur.def;
      return d.heightAt ? d.floorY + (Number(d.heightAt(x - d.origin.x, z - d.origin.z)) || 0) : d.floorY;
    };
    W._water = (x, z) => (cur ? (cur.def.isWater ? !!cur.def.isWater(x - cur.def.origin.x, z - cur.def.origin.z) : false) : base.water(x, z));
    W._surface = (x, z) => {
      if (!cur) return base.surface ? base.surface(x, z) : 'grass';
      const d = cur.def;
      return (d.surfaceAt && d.surfaceAt(x - d.origin.x, z - d.origin.z)) || d.surface;
    };
    // a module that installs its functions later (or again) lands below the place layer
    W.setTerrain = (fn) => { if (typeof fn === 'function') base.terrain = fn; };
    W.setWaterFn = (fn) => { if (typeof fn === 'function') base.water = fn; };
    W.setSurfaceFn = (fn) => { base.surface = typeof fn === 'function' ? fn : null; };
    // the synthetic zone of a place (never pushed into G.data.zones — ~40 readers iterate those)
    base.zoneAt = W.zoneAt; base.zoneById = W.zoneById;
    W.zoneAt = (x, z) => (cur ? cur.def.zone : base.zoneAt.call(W, x, z));
    W.zoneById = (id) => { const p = zoneToPlace.get(id); return p ? p.zone : base.zoneById.call(W, id); };
  }

  // ---------------------------------------------------------------- built places
  class Built {
    constructor(def) {
      this.def = def;
      this.group = new THREE.Group();
      this.group.name = 'place:' + def.id;
      this.group.position.set(def.origin.x, def.floorY, def.origin.z);
      this.group.visible = false;
      this.group.updateMatrix(); this.group.updateMatrixWorld(true);
      this.colliders = []; this.walkables = []; this.interacts = []; this.boards = []; this.updates = []; this.owned = [];
      this.anchors = new Map(); this.attached = []; this.lightCfg = []; this.rawLights = null;
      this.exitAt = null; this.result = null; this.quality = G.sys.engine?.preset?.name || 'low';
    }
  }

  function makeCtx(L) {
    const def = L.def, ox = def.origin.x, oz = def.origin.z, fy = def.floorY, E = G.sys.engine, W = G.world;
    const worldPos = (p) => {
      if (typeof p === 'function') return () => { const q = p(); return q ? _v.set(num(q.x, 0) + ox, num(q.y, 0) + fy, num(q.z, 0) + oz) : _v.set(ox, fy, oz); };
      return new THREE.Vector3(num(p?.x, 0) + ox, num(p?.y, 0) + fy, num(p?.z, 0) + oz);
    };
    const ctx = {
      id: def.id, def, place: def, group: L.group, size: def.size, origin: def.origin, floorY: fy,
      preset: E?.preset || { name: 'low' }, quality: L.quality, low: L.quality === 'low', kit: G.hanok || null,
      addCollider(c) {
        if (!c) return 0;
        const s = { ...c, x: num(c.x, 0) + ox, z: num(c.z, 0) + oz, tag: c.tag || def.id };
        if (c.minY != null) s.minY = fy + Number(c.minY);
        if (c.maxY != null) s.maxY = fy + Number(c.maxY);
        const id = W.addCollider(s);
        L.colliders.push(id);
        return id;
      },
      addWalkable(w) {
        if (!w) return 0;
        const id = W.addWalkable({ ...w, x: num(w.x, 0) + ox, z: num(w.z, 0) + oz, top: fy + num(w.top, 0) });
        L.walkables.push(id);
        return id;
      },
      interact(spec) {
        if (!spec || !G.interact?.register) return null;
        const user = typeof spec.enabled === 'function' ? spec.enabled : null;
        const h = G.interact.register({
          ...spec, id: spec.id || `${def.id}:${L.interacts.length}`,
          position: spec.position ? worldPos(spec.position) : (spec.object ? null : worldPos({ x: 0, y: 1, z: 0 })),
          enabled: () => cur === L && (!user || !!user()),
        });
        if (h) L.interacts.push(h);
        return h;
      },
      anchor(key, target) {
        let node = target && target.isObject3D ? target : null;
        if (!node) {
          node = new THREE.Object3D();
          node.position.set(num(target?.x, 0), num(target?.y, 1), num(target?.z, 0));
          L.group.add(node);
        }
        const keys = Array.isArray(key) ? key : [key];
        node.name = node.name || 'anchor:' + keys[0];
        node.userData.anchor = String(keys[0]); node.userData.place = def.id;
        for (const k of keys) if (k != null && k !== '') L.anchors.set(String(k), node);
        return node;
      },
      board(motionId, o = {}) { return makeBoard(L, ctx, motionId, o); },
      light(cfg = {}) {
        const c = {
          x: num(cfg.x, 0), y: num(cfg.y, 1.2), z: num(cfg.z, 0), color: new THREE.Color(cfg.color ?? 0xffb46a),
          intensity: clamp(num(cfg.intensity, 4), 0, 60), distance: clamp(num(cfg.distance, 8), 0.5, 60), decay: clamp(num(cfg.decay, 2), 0, 4),
          flicker: clamp(num(cfg.flicker, 0), 0, 0.3), day: clamp(num(cfg.day, 0.4), 0, 1), phase: Math.random() * 6.28, k: 1,
        };
        L.lightCfg.push(c);
        return { cfg: c, set(v) { Object.assign(c, v || {}); }, get light() { return c._light || null; } };
      },
      lights(n) {
        const list = E?.lightPool ? E.lightPool(n) : [];
        if (cur !== L) { /* borrowed for the build: the values are read back in finishBuild */ }
        L.rawLights = list;
        return list;
      },
      /** how many lamps this place asked for so far (ctx.light) */
      get lightCount() { return L.lightCfg.length; },
      onUpdate(fn) { if (typeof fn === 'function') L.updates.push(fn); },
      exitDoor(x, z, o = {}) { L.exitAt = { x: num(x, 0), y: num(o.y, 1.1), z: num(z, 0) }; },
      own(thing) { if (thing && typeof thing.dispose === 'function') L.owned.push(thing); return thing; },
    };
    return ctx;
  }

  /** a framed board showing a motion graphic (G.sys.exhibits.board) or, without that system, a still poster */
  function makeBoard(L, ctx, motionId, o) {
    const w = clamp(num(o.w, 1.92), 0.4, 6), h = clamp(num(o.h, 1.08), 0.3, 4);
    let src = null;
    try { src = G.sys.exhibits?.board?.(motionId, { w: 512, h: 288 }) || null; } catch (e) { G.log.warn('WORLD', `place ${L.def.id}: board ${motionId} failed`, e?.message || e); src = null; }
    let tex = src && src.texture && src.texture.isTexture ? src.texture : null;
    if (!tex) {
      const title = String(o.title || G.data.motions?.[motionId]?.title || '움직이는 그림');
      tex = G.gfx.canvasTexture(512, 288, (c, cw, ch) => {
        const g = c.createLinearGradient(0, 0, 0, ch);
        g.addColorStop(0, '#f1e6cf'); g.addColorStop(1, '#e2d2b0');
        c.fillStyle = g; c.fillRect(0, 0, cw, ch);
        c.strokeStyle = 'rgba(90,60,30,.55)'; c.lineWidth = 6; c.strokeRect(10, 10, cw - 20, ch - 20);
        c.fillStyle = '#4a3320'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const font = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
        let size = 44; c.font = `800 ${size}px ${font}`;
        while (c.measureText(title).width > cw * 0.8 && size > 18) { size -= 2; c.font = `800 ${size}px ${font}`; }
        c.fillText(title, cw / 2, ch * 0.46);
        c.font = `600 22px ${font}`; c.fillStyle = '#7a5a38';
        c.fillText('▶ 가까이 가서 눌러 보세요', cw / 2, ch * 0.72);
      });
      L.owned.push(tex);
    }
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xe9e4da, fog: false });
    L.owned.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.name = 'place-board';
    mesh.position.set(num(o.x, 0), num(o.y, 1.6), num(o.z, 0));
    mesh.rotation.y = num(o.rotY, 0);
    mesh.userData.guardSkip = true;   // an opaque picture on a wall: world geometry for the render guard
    L.group.add(mesh);
    const b = { mesh, src, motionId, t: 0 };
    L.boards.push(b);
    if (G.interact?.register && (G.sys.exhibits?.motion || src)) {
      const h2 = ctx.interact({
        id: `${L.def.id}:board:${L.boards.length}`, kind: 'board', label: '움직이는 그림 보기', kidLabel: '그림 보기', emoji: '▶️', radius: 3,
        position: { x: mesh.position.x + Math.sin(mesh.rotation.y) * 0.9, y: mesh.position.y, z: mesh.position.z + Math.cos(mesh.rotation.y) * 0.9 },
        onInteract: () => { try { G.sys.exhibits?.motion?.(motionId); } catch (e) { G.log.warn('UI', 'motion player failed', e?.message || e); } },
      });
      b.handle = h2;
    }
    return mesh;
  }

  function disposeBuilt(L) {
    const W = G.world;
    try { L.result?.dispose?.(); } catch (e) { G.log.warn('WORLD', `place ${L.def.id}: dispose() failed`, e?.message || e); }
    for (const id of L.colliders) W.removeCollider(id);
    for (const id of L.walkables) W.removeWalkable(id);
    for (const h of L.interacts) { try { h.unregister?.(); } catch (e) { /* gone */ } }
    for (const a of L.attached) { try { (a.dispose || a.unregister || a.remove)?.call(a); } catch (e) { /* gone */ } }
    for (const b of L.boards) { try { b.src?.dispose?.(); } catch (e) { /* gone */ } }
    L.group.traverse((o) => { if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose(); });
    for (const t of L.owned) { try { t.dispose(); } catch (e) { /* gone */ } }
    L.group.parent?.remove(L.group);
    L.colliders.length = L.walkables.length = L.interacts.length = L.boards.length = L.updates.length = L.owned.length = L.attached.length = 0;
    L.anchors.clear();
  }

  // ---------------------------------------------------------------- exhibits (49-exhibits.js when present)
  function openStaticExhibit(ex) {
    const h = G.ui.h;
    const kid = String(ex.kid || '').slice(0, 80), detail = String(ex.detail || '');
    G.ui.modal.open({
      id: 'place-exhibit', title: String(ex.title || '전시'), icon: 'book', size: 'sm', className: 'place-exhibit-modal', say: kid || String(ex.title || ''),
      body: (el) => {
        el.appendChild(h('div', { class: 'pex-emoji emoji', 'aria-hidden': 'true' }, String(ex.emoji || '🏠')));
        if (kid) el.appendChild(h('p', { class: 'pex-kid', 'data-say': kid }, kid));
        if (detail) {
          const d = h('details', { class: 'pex-detail' }, h('summary', null, '어른용 설명'), h('p', null, detail));
          el.appendChild(d);
        }
      },
      actions: [],
    });
    G.bus.emit('place:exhibit', { id: ex.id, place: cur?.def.id || null });
  }
  function attachExhibits(L, ctx) {
    const def = L.def, X = G.sys.exhibits;
    let list = null;
    try { const r = X?.forPlace?.(def.id); if (Array.isArray(r)) list = r; } catch (e) { list = null; }
    const usesSystem = !!(list && typeof X.attach === 'function');
    if (!usesSystem) list = Array.isArray(def.exhibits) ? def.exhibits : [];
    let shelf = 0;
    const spare = () => {
      for (; shelf < 40; shelf++) { const n = L.anchors.get('shelf:' + shelf); if (n) { shelf++; return n; } if (shelf > 12) break; }
      // no shelf slot left: a spot beside the door, so nothing is unreachable
      const s = def.spawn;
      return ctx.anchor(`spare:${shelf++}`, { x: s.x + Math.cos(s.rotY) * 1.6, y: 1.1, z: s.z - Math.sin(s.rotY) * 1.6 });
    };
    let placed = 0;
    for (const ex of list) {
      const id = typeof ex === 'string' ? ex : ex?.id;
      if (!id) continue;
      const data = (typeof ex === 'object' && ex) || G.data.exhibits?.[id] || {};
      const key = data.anchor ?? G.data.exhibits?.[id]?.anchor;
      const node = (key != null && L.anchors.get(String(key))) || spare();
      try {
        if (usesSystem) { const a = X.attach(id, node); if (a && typeof a === 'object') L.attached.push(a); }
        else {
          ctx.interact({
            id: `${def.id}:ex:${id}`, kind: 'exhibit', label: `전시 살펴보기 · ${String(data.title || '').slice(0, 14)}`, kidLabel: `${String(data.title || '전시').slice(0, 10)} 보기`,
            emoji: data.emoji || '🔎', radius: 2.4, object: node, position: () => { node.getWorldPosition(_v); return { x: _v.x - def.origin.x, y: _v.y - def.floorY, z: _v.z - def.origin.z }; },
            onInteract: () => openStaticExhibit(data),
          });
        }
        placed++;
      } catch (e) { G.log.warn('WORLD', `place ${def.id}: exhibit ${id} not attached`, e?.message || e); }
    }
    L.exhibitCount = placed;
  }

  function build(def) {
    const E = G.sys.engine, P = places;
    const L = new Built(def);
    const ctx = makeCtx(L);
    L.ctx = ctx;
    P._root.add(L.group);
    const t0 = performance.now();
    try {
      L.result = def.build ? def.build(ctx) || null : null;
      // the door back out: where build() said, else right behind the spawn
      const s = def.spawn, ex = L.exitAt || { x: s.x - Math.sin(s.rotY) * 1.1, y: 1.1, z: s.z - Math.cos(s.rotY) * 1.1 };
      L.exitAt = ex;
      ctx.interact({
        id: 'EXIT_' + def.id, kind: 'door', label: '🚪 밖으로 나가기', kidLabel: '밖으로 나가기', emoji: '🚪', radius: EXIT_RADIUS, priority: 0.4,
        position: { x: ex.x, y: ex.y, z: ex.z }, onInteract: () => { P.exit(); },
      });
      // raw pooled lights: remember what build() set on them (the pool hands the same lights out every time)
      if (L.rawLights && L.rawLights.length) {
        for (const l of L.rawLights) {
          L.lightCfg.push({ x: l.position.x - def.origin.x, y: l.position.y - def.floorY, z: l.position.z - def.origin.z, color: l.color.clone(), intensity: l.intensity, distance: l.distance, decay: l.decay, flicker: num(l.userData.flicker, 0), day: 0.4, phase: Math.random() * 6.28, k: 1 });
        }
        L.rawLights = null;
      }
      attachExhibits(L, ctx);
      L.group.updateMatrixWorld(true);
    } catch (e) {
      disposeBuilt(L);
      if (!cur) E?.releaseLights?.();
      throw e;
    }
    if (!cur) E?.releaseLights?.();   // lights borrowed during a build go back until the place is entered
    L.buildMs = Math.round(performance.now() - t0);
    live.set(def.id, L);
    G.log.info('WORLD', `place ${def.id} built in ${L.buildMs} ms (${L.colliders.length} colliders, ${L.interacts.length} interactables, ${L.anchors.size} anchors, ${L.boards.length} boards)`);
    G.bus.emit('place:built', { id: def.id });
    return L;
  }

  const places = {
    name: 'places', order: 28, label: '집 안 · 장소',
    _root: null, _hidden: null, _hideScanN: -1, _busy: null, _moving: false, _doors: new Map(), _chip: null, _t: 0,

    // ------------------------------------------------------------ registry
    define(d) {
      if (!d || typeof d !== 'object' || !RX_ID.test(String(d.id || ''))) { G.log.warn('WORLD', 'places.define: bad id', d && d.id); return null; }
      const id = d.id;
      const zoneId = RX_ZONE.test(String(d.zoneId || '')) ? d.zoneId : 'ZONE_' + id;
      const size = { w: clamp(num(d.size?.w, 12), 2, 800), d: clamp(num(d.size?.d, 9), 2, 800), h: clamp(num(d.size?.h, 3.2), 2, 60) };
      const origin = { x: num(d.origin?.x, 0), z: num(d.origin?.z, 2000) };
      const indoor = d.indoor !== false;
      const spawn = spot(d.spawn, { x: 0, z: size.d / 2 - 1.6, rotY: Math.PI });
      const doors = (Array.isArray(d.door) ? d.door : d.door ? [d.door] : []).map((o) => (o && fin(Number(o.x)) && fin(Number(o.z))
        ? { buildingId: o.buildingId || null, x: Number(o.x), z: Number(o.z), label: String(o.label || ''), kidLabel: String(o.kidLabel || ''), radius: Math.max(3, num(o.radius, DOOR_RADIUS)) } : null)).filter(Boolean);
      let exit = spot(d.exit, null);
      if (!exit && doors[0]) {
        const b = doors[0].buildingId ? (G.data.layout?.buildings || []).find((x) => x.id === doors[0].buildingId) : null;
        let dx = b ? doors[0].x - b.x : 0, dz = b ? doors[0].z - b.z : 1;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        exit = { x: doors[0].x + dx * 2.6, z: doors[0].z + dz * 2.6, rotY: Math.atan2(dx, dz) };
      }
      if (!exit) { const sp = G.data.layout?.plaza || { x: 0, z: 9 }; exit = { x: sp.x, z: sp.z, rotY: Math.PI }; }
      const name = String(d.name || id), kidName = String(d.kidName || d.name || id), emoji = String(d.emoji || '🏠');
      const cam = d.camera || {};
      const def = {
        // floorY may be a function (lx, lz) -> y (an outdoor place with terraces, §16.4): it becomes the place's ground and
        // the place's own coordinates start at y = 0 (heightAt, when given too, is added on top of it)
        id, name, kidName, emoji, zoneId, origin, size, floorY: typeof d.floorY === 'function' ? 0 : num(d.floorY, 0), surface: String(d.surface || 'wood'),
        spawn, doors, door: doors[0] || null, exit, indoor,
        camera: {
          dist: clamp(num(cam.dist, indoor ? 5.2 : 9), 1.5, 30), min: clamp(num(cam.min, indoor ? 2.4 : 4.5), 1.2, 20), max: clamp(num(cam.max, indoor ? 7.5 : 14), 2, 40),
          pitch: clamp(num(cam.pitch, indoor ? 0.2 : 0.42), -0.3, 1.2), pmin: clamp(num(cam.pmin, -0.12), -0.4, 0.5), pmax: clamp(num(cam.pmax, indoor ? 0.9 : 1.05), 0.2, 1.3),
          ceil: indoor ? clamp(num(cam.ceil, size.h - 0.5), 1.8, 60) : null,
        },
        light: d.light || null, far: clamp(num(d.far, indoor ? 150 : 1600), 30, 3000), keepAlive: !!d.keepAlive,
        heightAt: floorFn(d), isWater: typeof d.isWater === 'function' ? d.isWater : null,
        surfaceAt: typeof d.surfaceAt === 'function' ? d.surfaceAt : null,
        exhibits: Array.isArray(d.exhibits) ? d.exhibits : null,
        minimap: typeof d.minimap === 'function' ? d.minimap : null, build: typeof d.build === 'function' ? d.build : null,
        margin: clamp(num(d.margin, 0.3), 0, 20),
      };
      def.zone = { id: zoneId, name, short: kidName, emoji, center: [origin.x, origin.z], r: 0, color: String(d.color || '#e8c58a'), icon: 'home', desc: String(d.desc || ''), place: id };
      def.bounds = { minX: origin.x - size.w / 2 - def.margin, maxX: origin.x + size.w / 2 + def.margin, minZ: origin.z - size.d / 2 - def.margin, maxZ: origin.z + size.d / 2 + def.margin };
      // [complex-ground] an outdoor district whose plan is not centred on its origin: bounds in LOCAL metres
      if (d.bounds && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => fin(Number(d.bounds[k]))) && d.bounds.maxX > d.bounds.minX && d.bounds.maxZ > d.bounds.minZ) def.bounds = { minX: origin.x + Number(d.bounds.minX) - def.margin, maxX: origin.x + Number(d.bounds.maxX) + def.margin, minZ: origin.z + Number(d.bounds.minZ) - def.margin, maxZ: origin.z + Number(d.bounds.maxZ) + def.margin };
      // [complex-ground] a door may go without the automatic guide sign (its owner builds a better one)
      (Array.isArray(d.door) ? d.door : d.door ? [d.door] : []).filter((o) => o && fin(Number(o.x)) && fin(Number(o.z))).forEach((o, i) => { if (o.sign === false && doors[i]) doors[i].noSign = true; });
      const old = defs.get(id);
      if (old) { zoneToPlace.delete(old.zoneId); if (cur && cur.def === old) this._leaveSync('redefine'); const L = live.get(id); if (L) { disposeBuilt(L); live.delete(id); } }
      defs.set(id, def);
      zoneToPlace.set(zoneId, def);
      if (this._ready) this._syncDoors();
      return def;
    },
    def(id) { return defs.get(id) || null; },
    is(id) { return !!cur && cur.def.id === id; },
    get current() { return cur ? cur.def.id : null; },
    get indoor() { return !!cur && cur.def.indoor; },
    get busy() { return !!this._busy; },
    /** places for menus: [{id, name, kidName, emoji, color, indoor, door, visits, here}] */
    list() {
      const v = G.state?.places?.visits || {};
      return [...defs.values()].map((d) => ({ id: d.id, name: d.name, kidName: d.kidName, emoji: d.emoji, color: d.zone.color, indoor: d.indoor, zoneId: d.zoneId, door: d.door ? { x: d.door.x, z: d.door.z } : null, visits: Math.max(0, v[d.id] | 0), here: !!cur && cur.def === d }));
    },
    /** built places right now (dev tools / tests): [{id, current, quality, colliders, interactables, anchors, boards, exhibits, buildMs}] */
    built() { return [...live.values()].map((L) => ({ id: L.def.id, current: L === cur, quality: L.quality, colliders: L.colliders.length, interactables: L.interacts.length, anchors: L.anchors.size, boards: L.boards.length, exhibits: L.exhibitCount || 0, lights: L.lightCfg.length, buildMs: L.buildMs })); },
    anchorsOf(id) { const L = live.get(id); return L ? [...L.anchors.keys()] : []; },
    contains(x, z, id) {
      const d = id ? defs.get(id) : cur?.def;
      if (!d) return false;
      const b = d.bounds;
      return x >= b.minX - 2 && x <= b.maxX + 2 && z >= b.minZ - 2 && z <= b.maxZ + 2;
    },
    toLocal(x, z) { const d = cur?.def; return d ? { x: x - d.origin.x, z: z - d.origin.z } : { x, z }; },
    toWorld(id, x, z) { const d = defs.get(id); return d ? { x: x + d.origin.x, z: z + d.origin.z, y: d.floorY } : null; },
    /** the rescue point while inside (world): the place spawn — null outside (the caller uses the plaza) */
    hub() { const d = cur?.def; return d ? { x: d.origin.x + d.spawn.x, z: d.origin.z + d.spawn.z, rotY: d.spawn.rotY } : null; },
    /** what a save stores for the player's position while inside: the exit spot outside (a load resumes there) */
    saveSpot() {
      const d = cur?.def;
      if (!d) return null;
      let y = 0;
      try { y = base.terrain ? base.terrain(d.exit.x, d.exit.z) : 0; } catch (e) { y = 0; }
      return { x: d.exit.x, y: fin(y) ? y : 0, z: d.exit.z, rotY: d.exit.rotY };
    },
    /** the valley's bounds (also while a place has swapped G.world.bounds) */
    worldBounds() { return saved ? saved.bounds : G.world.bounds; },
    /** run fn() against the valley (its ground, water, bounds) although the player is inside a place — synchronous
     *  queries only (a travel target is settled this way before the teleport leaves the place) */
    outside(fn) {
      if (!cur || !saved) return fn();
      const L = cur, W = G.world, b = { ...W.bounds };
      cur = null; Object.assign(W.bounds, saved.bounds);
      try { return fn(); } finally { cur = L; Object.assign(W.bounds, b); }
    },
    noDoubleJump() { return !!cur && cur.def.indoor; },
    hideRoot(name) { if (name instanceof RegExp) WORLD_ROOT_RX.push(name); else if (name) WORLD_ROOTS.add(String(name)); this._hideScanN = -1; },
    /** the middle of a building's front (local +Z) and the spot in front of it — for define({door, exit}) */
    doorOf(buildingId, o = {}) {
      const b = (G.data.layout?.buildings || []).find((x) => x.id === buildingId);
      if (!b) return null;
      const rot = b.rot || 0, s = Math.sin(rot), c = Math.cos(rot), side = num(o.side, 0), out = num(o.out, 0.3), gap = num(o.gap, 2.6);
      const fx = (dz) => b.x + side * c + dz * s, fz = (dz) => b.z - side * s + dz * c;
      const front = (b.d || 4) / 2 + out;
      return { buildingId, x: fx(front), z: fz(front), rotY: rot, exit: { x: fx(front + gap), z: fz(front + gap), rotY: rot } };
    },

    // ------------------------------------------------------------ presence mapping (60-social.js)
    /** my position as other clients get it: place-local x / z + the place zone id while inside (else null) */
    presenceOut(p) {
      const d = cur?.def;
      if (!d || !p) return null;
      return { x: p.x - d.origin.x, y: (p.y || 0) - d.floorY, z: p.z - d.origin.z, zoneId: d.zoneId };
    },
    /** a remote row: undefined = a valley row (use as it is) · null = a place this page does not know · {x, y, z} world */
    presenceIn(x, y, z, zoneId) {
      if (typeof zoneId !== 'string' || zoneId.indexOf('ZONE_PL_') !== 0) return undefined;
      const d = zoneToPlace.get(zoneId);
      if (!d) return null;
      const lim = Math.max(d.size.w, d.size.d) / 2 + 4;
      return { x: d.origin.x + clamp(x, -lim, lim), y: fin(y) ? d.floorY + clamp(y, d.heightAt ? -200 : -5, d.heightAt ? 600 : 60) : null, z: d.origin.z + clamp(z, -lim, lim) };
    },
    /** is a remote player of that zone somewhere I cannot see from here? (another place, or the valley while I am inside) */
    remoteHidden(zoneId) {
      const there = (typeof zoneId === 'string' && zoneToPlace.get(zoneId)) || null;
      return there !== (cur ? cur.def : null);
    },

    // ------------------------------------------------------------ boot
    init() {
      const E = G.sys.engine;
      this._root = new THREE.Group();
      this._root.name = 'places';
      E?.scene?.add(this._root);
      installWorldHooks();
      this._bindChip();
      G.bus.on('engine:quality', () => this._onQuality());
      G.bus.on('easy:changed', () => this._syncChip());
      G.ui?.onAction?.('place-exit', () => { this.exit(); });
    },
    postInit() {
      installWorldHooks();
      this._ready = true;
      this._syncDoors();
    },
    onStateLoaded() {
      // a new state (login, reset, import) always starts outside — before the player system reads its position
      if (cur) this._leaveSync('state');
      this._busy = null;
      this._syncChip();
    },
    onLogout() {
      if (cur) this._leaveSync('logout');
      this._busy = null;
      this._syncChip();
    },

    // ------------------------------------------------------------ doors (outside)
    _syncDoors() {
      const I = G.interact;
      if (!I?.register) return;
      const want = new Set();
      for (const d of defs.values()) {
        d.doors.forEach((o, i) => {
          const id = `DOOR_${d.id}${i ? '_' + i : ''}`;
          want.add(id);
          if (this._doors.has(id) && this._doors.get(id).def === d) return;
          this._dropDoor(id);
          let y = 1.3;
          try { y = (base.terrain ? base.terrain(o.x, o.z) : 0) + 1.3; } catch (e) { y = 1.3; }
          const handle = I.register({
            id, kind: 'door', radius: o.radius, priority: 0.6, emoji: '🚪',
            label: o.label || `🚪 ${d.name} 들어가기`, kidLabel: o.kidLabel || `${d.kidName} 구경`,
            position: new THREE.Vector3(o.x, fin(y) ? y : 1.3, o.z),
            enabled: () => !cur && !this._busy,
            onInteract: () => { this.enter(d.id); },
          });
          let sign = null;
          if (!o.noSign) try { sign = this._doorSign(d, o); } catch (e) { G.log.warn('WORLD', `places: guide sign of ${id} failed`, e?.message || e); }   // [complex-ground] noSign
          this._doors.set(id, { def: d, handle, sign });
        });
      }
      for (const id of [...this._doors.keys()]) if (!want.has(id)) this._dropDoor(id);
      G.bus.emit('place:doors', { count: this._doors.size });
    },
    _dropDoor(id) {
      const rec = this._doors.get(id);
      if (!rec) return;
      rec.handle?.unregister?.();
      if (rec.sign) {
        rec.sign.parent?.remove(rec.sign);
        rec.sign.traverse((o) => { if (!o.isMesh) return; o.geometry?.dispose?.(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.placeSign) { m.map?.dispose?.(); m.dispose(); } });
      }
      this._doors.delete(id);
    },
    /** a small guide sign beside a door outside: a stake with a name board, turned to the people coming (all signs live in
     *  the scene root 'place-doors', which is hidden with the valley while inside). No collider: it stands off the way in. */
    _doorSign(d, o) {
      const E = G.sys.engine;
      if (!E?.scene || !G.gfx?.signTexture) return null;
      let root = this._doorRoot;
      if (!root || root.parent !== E.scene) { root = this._doorRoot = new THREE.Group(); root.name = 'place-doors'; E.scene.add(root); }
      const ex = d.exit || { x: o.x, z: o.z + 2.6 };
      let ox = ex.x - o.x, oz = ex.z - o.z;
      const ol = Math.hypot(ox, oz);
      if (ol > 0.01) { ox /= ol; oz /= ol; } else { ox = 0; oz = 1; }
      const x = o.x + ox * 0.9 - oz * 1.4, z = o.z + oz * 0.9 + ox * 1.4;     // a step out of the door, 1.4 m to the side
      let y = 0;
      try { y = base.terrain ? base.terrain(x, z) : 0; } catch (e) { y = 0; }
      const wood = G.gfx.material('place-sign-wood', () => new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.86, metalness: 0 }));
      const face = new THREE.MeshStandardMaterial({ map: G.gfx.signTexture(d.kidName, '안으로 들어가 봐요', { w: 384, h: 192, size: 64 }), roughness: 0.82, metalness: 0 });
      face.userData.placeSign = true;
      const g = new THREE.Group();
      g.name = 'door-sign:' + d.id;
      g.position.set(x, fin(y) ? y : 0, z);
      g.rotation.y = Math.atan2(ox, oz);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), wood);
      post.position.y = 0.5;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.05), [wood, wood, wood, wood, face, wood]);
      board.position.set(0, 1.12, 0.03);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.13), wood);
      cap.position.set(0, 1.345, 0.03);
      for (const m of [post, board, cap]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
      root.add(g);
      return g;
    },

    // ------------------------------------------------------------ enter / exit
    /** enter a place behind one fade. opts: {fade = true, spawn: {x, z, rotY} (local), quiet: true = a technical visit
     *  (self-tests): no visit counted, no sound, no banner, no voice, no place:enter event} */
    enter(id, opts = {}) {
      const def = defs.get(id);
      if (!def) { G.log.warn('WORLD', `places.enter: unknown place ${id}`); return Promise.resolve(false); }
      if (cur && cur.def === def) return Promise.resolve(true);
      if (this._busy) return this._busy.then(() => this.is(id));
      const pl = G.sys.player;
      if (!G.state || !pl || pl._ready === false) return Promise.resolve(false);
      if (G.sys.dialogue?.active) { G.ui.toast(easyOn() ? '이야기가 끝나면 들어가요.' : '대화를 마친 뒤에 들어갈 수 있어요.', { emoji: '💬', type: 'info' }); return Promise.resolve(false); }
      const prev = cur ? cur.def.id : null;
      const p = this._transition(opts, async () => {
        let L = live.get(id);
        if (L && L.quality !== (G.sys.engine?.preset?.name || 'low')) { disposeBuilt(L); live.delete(id); L = null; }
        if (!L) L = build(def);                       // may throw: nothing was changed yet
        if (!cur) { try { this._snapOutside(L, opts.fade !== false && !!G.ui?.fadeThrough); } catch (e) { G.log.warn('WORLD', `places: outside view of ${id} not taken`, e?.message || e); } }
        if (cur) this._leaveSync('switch', { x: def.origin.x, z: def.origin.z });
        this._activate(L);
        const sp = spot(opts.spawn, def.spawn);
        this._moving = true;
        try { await pl.teleport(def.origin.x + sp.x, def.origin.z + sp.z, sp.rotY, { fade: false, silent: true }); } finally { this._moving = false; }
        try { G.sys.companion?.snapToPlayer?.(); } catch (e) { /* optional */ }
        // link the room's programs behind the fade (the first frame inside must not stall)
        const E = G.sys.engine;
        if (E?.precompile && opts.fade !== false) { try { await Promise.race([E.precompile(5000), G.util.sleep(5000)]); } catch (e) { /* compiled on first use */ } }
        return true;
      }).then((ok) => {
        if (!ok) return false;
        if (opts.quiet) return true;
        const st = G.state && (G.state.places && typeof G.state.places === 'object' ? G.state.places : (G.state.places = { visits: {}, seen: {} }));
        if (st) { if (!st.visits || typeof st.visits !== 'object') st.visits = {}; st.visits[id] = Math.min(9999, (st.visits[id] | 0) + 1); G.dirty?.('place'); }
        G.sfx('open');
        G.bus.emit('place:enter', { id, prev, opts: { ...opts } });   // [complex-ground] the options of enter() (focusUnit …)
        try { G.ui.zoneBanner?.(def.name, '집 안 구경'); } catch (e) { /* cosmetic */ }
        if (easyOn()) { try { G.easy?.say?.(`${def.kidName}에 들어왔어요. 나갈 때는 문 그림을 눌러요.`, { priority: 1 }); } catch (e) { /* voice optional */ } }
        return true;
      }, (e) => {
        G.log.warn('WORLD', `places.enter(${id}) failed`, e?.message || e);
        if (cur && cur.def === def) this._leaveSync('error');
        G.ui.toast(easyOn() ? '지금은 들어갈 수 없어요. 조금 뒤에 다시 해 봐요!' : `${def.name}에 들어가지 못했어요.`, { type: 'warn', emoji: '🚪' });
        return false;
      });
      return this._track(p);
    },
    /** A room with open doors shows the REAL valley behind them: a picture taken where the house's door stands outside,
     *  right before the valley is hidden — three slices onto the kit's far-view arc, with the shadow map of the last
     *  frame. It is drawn with the programs the frame already has (no new shader variants): into a linear half-float
     *  target where the composer runs, into a corner of the canvas behind the fade where it does not (`low`; skipped
     *  without a fade). The pixels are read back into a canvas, so a lost GL context cannot take the picture away. */
    _snapOutside(L, faded) {
      const R = L.ctx && L.ctx.room, def = L.def, E = G.sys.engine, r = E && E.renderer;
      const A = R && R.farArc;
      if (!A || typeof R.setFarView !== 'function' || !r || !E.scene || E._isLost?.() || !def.exit || !def.door) return false;
      const direct = !E.composer;
      if (direct && !faded) return false;
      const pr = r.getPixelRatio(), size = r.getDrawingBufferSize(new THREE.Vector2());
      const n = 3, half = A.arc / n / 2, tl = Math.tan(half);
      let sw = (E.preset?.name || 'low') === 'low' ? 256 : 512;
      if (direct) sw = Math.min(sw, Math.floor(size.x), Math.floor((size.y * 2 * tl) / (A.down + A.up)));
      const sh = Math.round((sw * (A.down + A.up)) / (2 * tl)), W = sw * n, H = sh;
      if (!(sw >= 64 && sh >= 24)) return false;
      const halfOk = !direct && (!r.capabilities.textureTypeReadable || r.capabilities.textureTypeReadable(THREE.HalfFloatType));
      let gy = 0;
      try { gy = base.terrain ? base.terrain(def.exit.x, def.exit.z) : 0; } catch (e) { gy = 0; }
      let fx = def.exit.x - def.door.x, fz = def.exit.z - def.door.z;
      const fl = Math.hypot(fx, fz);
      if (fl > 0.01) { fx /= fl; fz /= fl; } else { fx = 0; fz = 1; }
      const yaw0 = Math.atan2(-fx, -fz);                      // a camera looks down its −Z
      const cam = new THREE.PerspectiveCamera(50, sw / sh, 0.4, 1400);
      cam.position.set(def.exit.x, (fin(gy) ? gy : 0) + 1.6, def.exit.z);
      cam.projectionMatrix.makePerspective(-tl * cam.near, tl * cam.near, A.up * cam.near, -A.down * cam.near, cam.near, cam.far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      // only the valley is in the picture: no avatar, companion, markers or effects
      const off = [];
      for (const o of E.scene.children) { if (o.visible && !o.isLight && !o.isCamera && o !== E.sky && !this._matches(o, def)) { o.visible = false; off.push(o); } }
      const rt = direct ? null : new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType });
      const prevRT = r.getRenderTarget(), vp = r.getViewport(new THREE.Vector4()), sc = r.getScissor(new THREE.Vector4()), st = r.getScissorTest(), auto = r.shadowMap.autoUpdate;
      const px = new Uint8ClampedArray(W * H * 4);              // the panorama, bottom row first, left of the view first
      try {
        // one throw-away frame first, with the shadow maps updating as usual: right after a room was built (new programs,
        // new lights) the first frame drawn into a fresh target came back empty on `high` (measured: all zeros)
        cam.rotation.set(0, yaw0, 0, 'YXZ'); cam.updateMatrixWorld(true);
        r.setRenderTarget(rt); r.clear(); r.render(E.scene, cam);
        r.shadowMap.autoUpdate = false;
        if (direct) { r.setRenderTarget(null); r.setScissorTest(true); }
        const gl = r.getContext(), one = direct ? new Uint8Array(sw * sh * 4) : null;
        for (let i = 0; i < n; i++) {                           // i = 0: the left of the view
          cam.rotation.set(0, yaw0 + (1 - i) * half * 2, 0, 'YXZ');
          cam.updateMatrixWorld(true);
          // the screen: the renderer's viewport (CSS pixels, scaled by the pixel ratio); a render target: its own
          // viewport / scissor in its pixels, applied when it is bound
          if (direct) { r.setViewport(0, 0, sw / pr, sh / pr); r.setScissor(0, 0, sw / pr, sh / pr); }
          else { rt.viewport.set(i * sw, 0, sw, sh); rt.scissor.set(i * sw, 0, sw, sh); rt.scissorTest = true; r.setRenderTarget(rt); }
          r.clear();
          r.render(E.scene, cam);
          if (direct) {                                         // tone-mapped, display-ready bytes straight from the back buffer
            gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, one);
            for (let y = 0; y < sh; y++) px.set(one.subarray(y * sw * 4, (y + 1) * sw * 4), (y * W + i * sw) * 4);
          }
        }
        if (!direct && halfOk) {
          const hf = new Uint16Array(W * H * 4);
          r.readRenderTargetPixels(rt, 0, 0, W, H, hf);
          const lut = this._hfLut || (this._hfLut = (() => {    // half float (linear light) -> sRGB byte
            const t = new Uint8Array(65536);
            for (let h = 0; h < 65536; h++) { let v = THREE.DataUtils.fromHalfFloat(h); v = !(v > 0) ? 0 : v > 1 ? 1 : v; t[h] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
            return t;
          })());
          for (let k = 0; k < hf.length; k += 4) { px[k] = lut[hf[k]]; px[k + 1] = lut[hf[k + 1]]; px[k + 2] = lut[hf[k + 2]]; }
        } else if (!direct) {
          const u8 = new Uint8Array(W * H * 4);
          r.readRenderTargetPixels(rt, 0, 0, W, H, u8);
          for (let k = 0; k < u8.length; k += 4) for (let c = 0; c < 3; c++) { const v = u8[k + c] / 255; px[k + c] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
        }
      } finally {
        r.shadowMap.autoUpdate = auto;
        r.setRenderTarget(prevRT); r.setViewport(vp); r.setScissor(sc); r.setScissorTest(st);
        if (rt) rt.dispose();
        for (const o of off) o.visible = true;
      }
      const cv = L.farCanvas || (L.farCanvas = document.createElement('canvas'));
      cv.width = W; cv.height = H;
      const c2 = cv.getContext('2d');
      if (!c2) return false;
      const img = c2.createImageData(W, H), d = img.data;
      let lit = 0;
      for (let y = 0; y < H; y++) {                             // rows come bottom-up; the arc is seen from inside: mirrored
        const src = (H - 1 - y) * W * 4, dst = y * W * 4;
        for (let x = 0; x < W; x++) {
          const s = src + (W - 1 - x) * 4, t = dst + x * 4;
          d[t] = px[s]; d[t + 1] = px[s + 1]; d[t + 2] = px[s + 2]; d[t + 3] = 255;
          if (px[s] + px[s + 1] + px[s + 2] > 3) lit++;          // not black (a valley at night is dark, but never 0)
        }
      }
      if (lit < W * H * 0.02) return false;                     // nothing came back (a failed draw): the painted view stays
      c2.putImageData(img, 0, 0);
      return R.setFarView(cv, clamp(fin(G.world.nightFactor) ? G.world.nightFactor : 0, 0, 1), { display: direct });
    },
    /** leave the current place. opts: {fade = true, to: {x, z, rotY} (world; default = the place's exit spot), quiet} */
    exit(opts = {}) {
      if (!cur) return Promise.resolve(true);
      if (this._busy) return this._busy.then(() => !cur);
      const pl = G.sys.player, def = cur.def;
      if (!G.state || !pl || pl._ready === false) { this._leaveSync('exit'); return Promise.resolve(true); }
      const to = spot(opts.to, def.exit);
      const p = this._transition(opts, async () => {
        this._leaveSync('exit', to);
        this._moving = true;
        try { await pl.teleport(to.x, to.z, to.rotY, { fade: false, silent: true }); } finally { this._moving = false; }
        try { G.sys.companion?.snapToPlayer?.(); } catch (e) { /* optional */ }
        return true;
      }).then(() => { if (!opts.quiet) G.sfx('close'); return true; }, (e) => {
        G.log.warn('WORLD', 'places.exit failed', e?.message || e);
        if (cur) this._leaveSync('error', to);
        return !cur;
      });
      return this._track(p);
    },
    /** go to a place: walk to its door and enter (direct in easy mode, from inside another place, or from far away) */
    travel(id) {
      const def = defs.get(id);
      if (!def) { G.log.warn('WORLD', `places.travel: unknown place ${id}`); return Promise.resolve(false); }
      if (cur && cur.def === def) return Promise.resolve(true);
      const pl = G.sys.player;
      if (!G.state || !pl || pl._ready === false) return Promise.resolve(false);
      try { G.ui.modal.closeAll?.(); G.ui.popover?.close?.(); } catch (e) { /* nothing open */ }
      const door = def.door;
      if (easyOn() || cur || !door || typeof pl.walkTo !== 'function') return this.enter(id);
      const d = Math.hypot(door.x - pl.position.x, door.z - pl.position.z);
      if (d > 90) return this.enter(id);
      if (d < door.radius) return this.enter(id);
      return new Promise((resolve) => {
        const go = () => this.enter(id).then(resolve, () => resolve(false));
        const ok = pl.walkTo({ x: def.exit.x, z: def.exit.z }, { stopDistance: 0.8, label: def.name, onArrive: go, onFail: (why) => { if (why === 'stuck' || why === 'unreachable') go(); else resolve(false); } });
        if (!ok) go();
      });
    },
    /** the "🏠 집 구경" picture menu: pick a place and go there */
    async pickTravel() {
      const list = this.list();
      if (!list.length || !G.easy?.pick) return null;
      const items = list.map((p) => ({ id: p.id, emoji: p.emoji, label: p.kidName, color: p.color, badge: p.here ? '📍' : (p.visits ? '' : '✨'), selected: p.here, say: p.here ? `${p.kidName}. 지금 여기 있어요.` : `${p.kidName}. 안으로 들어가 봐요.` }));
      const id = await G.easy.pick({ id: 'easy-where', title: '집 구경', emoji: '🏠', say: '어느 집에 들어가 볼까요? 그림을 눌러요.', items, columns: list.length > 4 ? 4 : Math.max(2, list.length), className: 'mm-pick' });
      if (!id || !defs.has(id) || !G.state) return null;
      if (cur && cur.def.id === id) { try { G.easy?.say?.('지금 여기에 있어요!', { force: true }); } catch (e) { /* voice optional */ } return id; }
      await this.travel(id);
      return id;
    },

    _track(p) {
      this._busy = p;
      const done = () => { if (this._busy === p) this._busy = null; this._syncChip(); };
      p.then(done, done);
      return p;
    },
    /** run fn behind the DOM fade (never a WebGL fade: the screen watchdog would read it as a black frame) */
    async _transition(opts, fn) {
      const wd = G.gfx?.guard?.watchdog;
      wd?.hold?.(4000);
      try { G.sys.player?.cancelWalk?.('travel'); } catch (e) { /* no walk */ }
      let out = false, err = null;
      const run = async () => { try { out = await fn(); } catch (e) { err = e; } };
      if (opts.fade !== false && G.ui?.fadeThrough) await G.ui.fadeThrough(run, 260); else await run();
      wd?.hold?.(2500);
      if (err) throw err;
      return out;
    },

    /** swap the world to place L (bounds, ground, zone, hidden valley, camera, light, lamps) — synchronous */
    _activate(L) {
      const E = G.sys.engine, W = G.world, def = L.def;
      if (!saved) saved = { bounds: { ...W.bounds }, far: E?.camera ? E.camera.far : 3000 };
      Object.assign(W.bounds, def.bounds);
      cur = L;
      live.delete(def.id); live.set(def.id, L);          // most recently used
      for (const o of live.values()) o.group.visible = o === L;
      this._hideWorld(def);
      if (E?.camera) { E.camera.far = def.far; E.camera.updateProjectionMatrix(); }
      const c = def.camera;
      G.sys.camera?.setProfile?.({ dist: c.dist, min: c.min, max: c.max, pitch: c.pitch, pmin: c.pmin, pmax: c.pmax, maxY: c.ceil != null ? def.floorY + c.ceil : null });
      this._applyLight(L);
      this._applyLamps(L);
      this._evict();
      this._syncChip();
    },
    _profile(L) {
      const def = L.def;
      let p = null;
      try {
        p = typeof def.light === 'function' ? def.light(L.ctx) : def.light;
        if (p == null && L.ctx.room && typeof L.ctx.room.light === 'function') p = L.ctx.room.light();   // a room built with G.hanok brings its own
      } catch (e) { G.log.warn('WORLD', `place ${def.id}: light profile failed`, e?.message || e); p = null; }
      p = p && typeof p === 'object' ? { ...p } : {};
      const c = p.center || { x: 0, y: 1.2, z: 0 };
      p.center = new THREE.Vector3(def.origin.x + num(c.x, 0), def.floorY + num(c.y, 1.2), def.origin.z + num(c.z, 0));
      if (!fin(Number(p.radius))) p.radius = Math.max(def.size.w, def.size.d) * 0.62 + 1.5;
      return p;
    },
    _applyLight(L) {
      const E = G.sys.engine, def = L.def;
      if (!E) return;
      if (def.indoor) { E.skyFollow?.(false); E.setIndoor?.(this._profile(L), { instant: true }); }
      else { E.setIndoor?.(null, { instant: true }); E.skyFollow?.(true); }
    },
    _applyLamps(L) {
      const E = G.sys.engine, def = L.def;
      if (!E?.lightPool) return;
      const pool = E.lightPool(L.lightCfg.length);       // holds every pooled lamp in the scene (the light count stays)
      L.lightCfg.forEach((c, i) => {
        const l = pool[i] || null;
        c._light = l;
        if (!l) return;
        l.position.set(def.origin.x + c.x, def.floorY + c.y, def.origin.z + c.z);
        l.color.copy(c.color); l.distance = c.distance; l.decay = c.decay; l.intensity = 0;
      });
    },
    /** put the valley back (bounds, ground, zone, roots, camera, light, lamps); emits 'place:exit' — synchronous */
    _leaveSync(reason, to) {
      const L = cur;
      if (!L) return;
      const E = G.sys.engine, W = G.world;
      cur = null;
      if (saved) { Object.assign(W.bounds, saved.bounds); if (E?.camera) { E.camera.far = saved.far; E.camera.updateProjectionMatrix(); } saved = null; }
      L.group.visible = false;
      this._showWorld();
      for (const c of L.lightCfg) c._light = null;
      E?.releaseLights?.();
      E?.setIndoor?.(null, { instant: true });
      E?.skyFollow?.(false);
      G.sys.camera?.setProfile?.(null, { restore: reason === 'exit' || reason === 'teleport' });
      G.gfx?.guard?.watchdog?.hold?.(2500);
      this._syncChip();
      G.bus.emit('place:exit', { id: L.def.id, to: to ? { x: to.x, z: to.z } : null, reason: reason || 'exit' });
    },
    _evict() {
      let rooms = 0;
      for (const L of live.values()) if (!L.def.keepAlive) rooms++;
      for (const [id, L] of [...live]) {
        if (rooms <= LRU_ROOMS) break;
        if (L === cur || L.def.keepAlive) continue;
        disposeBuilt(L); live.delete(id); rooms--;
        G.log.info('WORLD', `place ${id} disposed (least recently used)`);
      }
    },

    // ------------------------------------------------------------ the valley's scene roots
    _matches(o, def) {
      const n = o.name || '';
      if (WORLD_ROOTS.has(n) || (def.indoor && INDOOR_ROOTS.has(n))) return true;
      for (const rx of WORLD_ROOT_RX) if (rx.test(n)) return true;
      return false;
    },
    _hideWorld(def) {
      const E = G.sys.engine;
      if (!E?.scene) return;
      const st = this._hidden || (this._hidden = []);
      const have = new Set(st.map((h) => h.o));
      for (const o of E.scene.children) {
        if (!o || o === this._root || have.has(o) || !this._matches(o, def)) continue;
        st.push({ o, vis: o.visible }); o.visible = false;
      }
      if (def.indoor && E.sky && !have.has(E.sky)) { st.push({ o: E.sky, vis: E.sky.visible }); E.sky.visible = false; }
      this._hideScanN = E.scene.children.length;
    },
    _showWorld() {
      const st = this._hidden;
      if (!st) return;
      for (const h of st) h.o.visible = h.vis;
      this._hidden = null; this._hideScanN = -1;
    },
    /** right before every rendered frame (10-engine): a root its owner switched back on stays hidden while inside */
    _frame() {
      const st = this._hidden;
      if (!st || !cur) return;
      for (let i = 0; i < st.length; i++) { const h = st[i]; if (h.o.visible) { h.vis = true; h.o.visible = false; } }
      const n = G.sys.engine?.scene?.children.length;
      if (n !== this._hideScanN) this._hideWorld(cur.def);   // a root added while inside (a new jar, a late module)
    },

    // ------------------------------------------------------------ hooks for the player (21-player.js)
    /** a teleport is about to move the player: one that leaves the place puts the valley back first (same fade) */
    _beforeTeleport(x, z) {
      if (!cur || this._moving || this.contains(x, z)) return;
      this._leaveSync('teleport', { x, z });
    },
    /** a walk to somewhere outside the place: leave through the fade, then walk (the walk keeps its id) */
    _walkOutside(target, opts) {
      const pl = G.sys.player;
      const id = ++pl._walkSeq;
      this.exit().then(() => {
        if (pl._walkSeq !== id || !G.state) { try { opts?.onFail?.('replaced'); } catch (e) { /* caller */ } return; }
        if (!pl.walkTo(target, { ...(opts || {}), _id: id })) { try { opts?.onFail?.('refused'); } catch (e) { /* caller */ } }
      });
      return id;
    },
    /** the easy-mode "다음 할 일" card while inside: a goal that is elsewhere shows the door (the go button leaves first) */
    stepHint(st) {
      if (!cur || !st || !st.target || this.contains(st.target.x, st.target.z)) return st;
      return { ...st, key: st.key + '|out', emoji: '🚪' };
    },
    /** where guidance should point from inside when the goal is elsewhere: the door back out (world) | null */
    exitPoint() {
      const L = cur;
      if (!L || !L.exitAt) return null;
      return { x: L.def.origin.x + L.exitAt.x, y: L.def.floorY + L.exitAt.y, z: L.def.origin.z + L.exitAt.z };
    },

    // ------------------------------------------------------------ HUD chip
    _bindChip() {
      let el = document.getElementById('place-chip');
      if (!el) {
        const host = document.getElementById('hud-top-center');
        if (!host || !G.ui?.h) return;
        const h = G.ui.h;
        el = h('div', { id: 'place-chip', class: 'glass place-chip', hidden: '' },
          h('span', { class: 'pc-here' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📍'), h('b', { class: 'pc-name' }, '')),
          h('button', { type: 'button', class: 'pc-exit', 'data-action': 'place-exit', 'data-say': '밖으로 나가요.' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🚪'), h('span', { class: 'pc-exit-lbl' }, '밖으로')));
        host.appendChild(el);
      }
      this._chip = el;
    },
    _syncChip() {
      const el = this._chip;
      if (!el) return;
      const on = !!cur && !!G.state;
      el.hidden = !on;
      document.body.classList.toggle('in-place', on);
      document.body.classList.toggle('in-room', on && cur.def.indoor);
      if (!on) return;
      const d = cur.def;
      const nm = el.querySelector('.pc-name');
      if (nm) nm.textContent = `${d.emoji} ${easyOn() ? d.kidName : d.name}`;
      const btn = el.querySelector('.pc-exit');
      if (btn) { btn.disabled = !!this._busy; btn.setAttribute('aria-label', `${d.name}에서 밖으로 나가기`); }
    },

    // ------------------------------------------------------------ quality / frame
    _onQuality() {
      const L = cur;
      // rooms are built for one preset (textures, lamps, effects): the others go now, the current one is rebuilt in place
      for (const [id, o] of [...live]) if (o !== L && o.quality !== (G.sys.engine?.preset?.name || 'low')) { disposeBuilt(o); live.delete(id); }
      if (!L || L.quality === (G.sys.engine?.preset?.name || 'low') || this._busy) { if (L) { this._applyLight(L); this._applyLamps(L); } return; }
      const def = L.def;
      const p = this._transition({}, async () => {
        if (cur !== L) return false;
        const E = G.sys.engine;
        E?.releaseLights?.();
        disposeBuilt(L); live.delete(def.id);
        let N = null;
        try { N = build(def); } catch (e) { G.log.warn('WORLD', `place ${def.id}: rebuild after a quality change failed`, e?.message || e); }
        if (!N) { cur = L; this._leaveSync('error', def.exit); const pl = G.sys.player; this._moving = true; try { await pl?.teleport?.(def.exit.x, def.exit.z, def.exit.rotY, { fade: false, silent: true }); } finally { this._moving = false; } return false; }
        cur = N;
        for (const o of live.values()) o.group.visible = o === N;
        this._applyLight(N); this._applyLamps(N);
        return true;
      }).catch((e) => { G.log.warn('WORLD', 'place rebuild failed', e?.message || e); return false; });
      this._track(p);
    },

    update(dt, t) {
      const L = cur;
      if (!L) return;
      this._t = t;
      for (let i = 0; i < L.updates.length; i++) { try { L.updates[i](dt, t); } catch (e) { if (!L._updErr) { L._updErr = true; G.log.warn('WORLD', `place ${L.def.id}: update failed`, e?.message || e); } } }
      // lamps: brighter at night, a slow flicker (two sines under 3 Hz; steady with reduce motion)
      if (L.lightCfg.length) {
        const nf = clamp(Number(G.world.nightFactor) || 0, 0, 1), still = !!G.settings?.reduceMotion;
        for (let i = 0; i < L.lightCfg.length; i++) {
          const c = L.lightCfg[i], l = c._light;
          if (!l) continue;
          const f = still || !c.flicker ? 1 : 1 + c.flicker * (0.62 * Math.sin(t * 5.3 + c.phase) + 0.38 * Math.sin(t * 13.1 + c.phase * 2.7));
          l.intensity = c.intensity * (c.day + (1 - c.day) * nf) * f * (fin(c.k) ? c.k : 1);
        }
      }
      // motion boards: only while the player is close (the drawing itself is throttled by 49-exhibits)
      if (L.boards.length) {
        const pp = G.sys.player?.position;
        for (let i = 0; i < L.boards.length; i++) {
          const b = L.boards[i];
          if (!b.src || typeof b.src.update !== 'function' || !pp) continue;
          b.mesh.getWorldPosition(_v);
          if (_v.distanceToSquared(pp) < 144) { try { b.src.update(dt); } catch (e) { b.src = null; } }
        }
      }
    },
  };

  G.register(places);
})();
