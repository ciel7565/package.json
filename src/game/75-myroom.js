// =============================================================================
// 75-myroom.js — 내 방: a room of one's own that its holder decorates (G.sys.myroom, CONTRACT §17.4)
//
//   G.sys.myroom (order 66)
//     can() -> true | false | null        may this player have a room? (null = not known yet: the server is being asked)
//                                         local mode: always true — a 체험용 room kept on this device
//     enter(opts) -> Promise<bool>        go in (asks the server first when needed; without the right: the kind card)
//     doorAt(spec) -> handle | null       a door to "내 방" for other fragments (the hanok houses of the complex):
//                                         spec { ctx?, x, z, y = 1.3, rotY = 0, label?, kidLabel?, radius = 3.2, id? }
//                                         with ctx (a places build context) x / z are that place's LOCAL metres, the door
//                                         lives and dies with that place and leaving the room brings the player back to
//                                         it; without ctx: world coordinates in the valley
//     state() -> { can, mode: 'local'|'server', loaded, editing, count, limit, v, public, bytes, built, dirty }
//     edit.start() / edit.stop() / edit.active · edit.pick(id) · edit.place() · edit.cancel() · edit.select(index)
//     edit.turn(±1) · edit.raise(±1) · edit.colour(c) · edit.size(±1) · edit.copy() · edit.remove()
//     edit.undo() / edit.redo() · edit.preset(id) · edit.reset() · edit.style(patch)
//     edit.setPublic(on) (server accounts: may friends look at the room?) · visit(presetId) · visitUser(accountId)
//                                         (a friend's PUBLIC room, read-only; the room number is the account id)
//     save() -> Promise<bool> · refresh() -> Promise<bool> · explain() (the card "방은 이렇게 생겨요")
//     room() -> the room being shown (a copy) · stats() -> { calls, tris, protos, batches, items } of the 3D layer
//   Events: myroom:changed { count, v } · myroom:edit { on } · myroom:saved { v, mode }
//
// DRAWING. Every catalogue entry (76-myroom-data.js) is built ONCE per colour into a prototype — one geometry per kit
//   material, with its vertex AO — by running its generator on a collector instead of a room. A placed thing is that
//   prototype written into the room's BATCHES: one dynamic mesh per material (and one per artwork), so the room costs
//   the same draw calls with 1 thing or 160, while editing too. Moving a thing rewrites its own vertices in place;
//   the thing in the hand is drawn apart (the "ghost") and its place in the batches is switched off meanwhile.
// THE SHELL (floor, walls, windows, door) is a G.hanok room built through a proxy of the place context, so a change
//   of style rebuilds it alone behind a short fade. The ceiling is the fragment's own (hidden while decorating: the
//   camera then looks down into the room like into a doll's house).
// KID RULES (§12): decorating needs no typing; every control is a picture button (≥ 56 px in easy mode) with a 🔊 line;
//   the way out of the edit mode ("✅ 다 했어요") and of the room (the HUD chip) is always there; nothing can stand in
//   the keep-clear zone before the door, and a player who ends up inside a thing is put back at the door.
// SECURITY: a room is numbers and catalogue ids only. Every room that arrives (storage, server, another account) goes
//   through G.data.myroom.sanitize before it is drawn; names shown in the UI come from the catalogue, never from data.
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok, BK = G.bkit;
  if (!P || !K || !BK) { G.log.warn('WORLD', 'myroom: places / hanok kit missing — no room'); return; }
  const { M, mul } = BK, geo = BK.geo;
  const PI = Math.PI, TAU = PI * 2;
  const ID = 'PL_MYROOM';
  const MD = () => G.data.myroom;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fin = Number.isFinite;
  const num = (v, d) => (fin(Number(v)) && v != null ? Number(v) : d);
  const h = (...a) => G.ui.h(...a);
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  // (test seam: G.sys.myroom._server = true makes the room behave as with a server account — api/room/* through G.net.request)
  const serverMode = () => (G.sys.myroom && G.sys.myroom._server != null ? !!G.sys.myroom._server : G.net?.mode === 'server' && G.auth?.current?.kind === 'server');
  const reduced = () => !!G.settings?.reduceMotion;
  const say = (t, o) => { try { if (easyOn()) G.easy?.say?.(t, o || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const toast = (m, o) => { try { G.ui.toast(m, o); } catch (e) { /* ui not ready */ } };
  const sfx = (n) => { try { G.sfx?.(n); } catch (e) { /* sound optional */ } };
  /** a Korean particle after a word: josa('소반', '을', '를') → '소반을' */
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return String(w) + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b); };
  const CAT = 'ROOM';
  const LS_DRAFT = 'tfm.v1.myroomDraft.';     // + account id: a room the server has not confirmed yet
  const LAMPS = 6;                             // lamps that really shine (pooled lights); the others only glow
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();

  // ---------------------------------------------------------------- generators the catalogue names beside G.hanok's
  const NC = { cast: false };
  const GEN = {
    scrollW(T, o) { return K.scroll(T, { art: o.art, h: o.h, w: o.w, maxW: 1.6, m: M(0, (o.h - 0.104) / 2, 0) }); },
    fanW(T, o) { return K.fan(T, { ...o, wall: true, m: M(0, 0.07, 0) }); },
    gobiW(T) { return K.gobi(T, { m: M(0, 0.44, 0) }); },
    joriW(T) { return K.jori(T, M(0, 0.02, 0.012), { pair: true }); },
    toolW(T, o) { return K.farmTool(T, o.kind || 'homi', M(0, 0.1, 0), {}); },
    jeoulW(T) { return K.jeoul(T, M(0, 0.36, 0), {}); },
    geumjulDok(T) { K.pot(T, { kind: 'dok', lid: true }); K.geumjul(T, { kind: 'dok' }); },
    jeolgu(T) { K.pot(T, { kind: 'mortar' }); K.gongi(T, { x: 0.02, y: 0.36, z: 0, lean: 0.2, len: 0.95 }); },
    bowls(T) {
      K.bowl(T, M(-0.11, 0, 0), 'daejeop', '#ece8dc', {});
      K.bowl(T, M(0.1, 0, 0.03), 'sabal', '#e9e4d6', {}); K.bowl(T, M(0.1, 0.045, 0.03), 'sabal', '#efeadc', {});
    },
    doeMal(T) { K.doe(T, { kind: 'mal', x: -0.13, fill: 'rice' }); K.doe(T, { kind: 'doe', x: 0.2, z: 0.03, rotY: 0.3, fill: 'bean' }); },
    deungjanLit(T) { K.deungjan(T, {}); T.add('lantern', K.geo.lathe([[0, 0], [0.006, 0.006], [0.009, 0.018], [0.005, 0.034], [0, 0.046]], 8), M(0, 0.486, 0), '#ffd98a', NC); },
  };
  const genOf = (name) => GEN[name] || (typeof K[name] === 'function' ? K[name] : null);

  // ---------------------------------------------------------------- the 3D layer of the built place
  /** everything of the place while it is built (null when it is not) */
  let S = null;
  /** pictures of the catalogue for the tray (kept for the whole session) */
  const thumbs = new Map();

  /** a kit generator's target that keeps the geometry instead of a room */
  class Collector {
    constructor(seed, low) {
      this.B = new BK.Bucket(); this.arts = []; this.junk = [];
      this.rnd = G.util.rng('myroom:' + seed); this.low = low; this.shadows = false;
      const self = this;
      this.ctx = { id: ID, group: null, lightCount: 0, own(x) { if (x && x.isMaterial) self.junk.push(x); return x; }, light() { return { cfg: {}, set() {}, light: null }; } };
    }
    add(key, g, m, tintHex) { if (g) this.B.add(key, g, m, K.tint(key, tintHex)); }
    addMesh(mesh) { this.arts.push(mesh); return mesh; }
    planItem() {}
    onUpdate() {}
    block() { return 0; }
  }
  const hexMul = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  /** the generator options of an entry in colour c of its palette */
  function optionsOf(e, c) {
    const opt = { ...e.opt };
    if (c == null || !e.col) return opt;
    const pal = MD().palettes[e.col[0]], hex = pal && pal[c] ? pal[c][1] : null;
    if (!hex) return opt;
    opt[e.col[1]] = hex;
    if (e.col[1] === 'tone') { opt.frameTone = hexMul(hex, 0.62); opt.panelTone = hexMul(hex, 1.12); }
    return opt;
  }
  /** the prototype of an entry in one colour: { geo: { key: BufferGeometry }, art: [{ name, geo }], box, tris } */
  function protoOf(id, c) {
    const e = MD().items[id], key = id + '|' + (c == null || !e.col ? '' : c);
    let p = S.protos.get(key);
    if (p) return p;
    const T = new Collector(id, S.low), fn = genOf(e.gen);
    try { if (fn) fn(T, optionsOf(e, c)); else G.log.warn(CAT, `myroom: no generator "${e.gen}" for ${id}`); }
    catch (err) { G.log.warn(CAT, `myroom: ${id} could not be made`, err?.message || err); }
    const mats = {};
    for (const k of T.B.parts.keys()) mats[k] = K.mat(k);
    const tmp = new THREE.Group(), flat = e.place === 'W' || e.place === 'H';
    let out = {};
    try { out = T.B.build(tmp, { name: 'mr', materials: mats, shadows: false, ao: S.low ? false : { ground: flat ? -50 : 0, maxAdd: 0 } }); }
    catch (err) { G.log.warn(CAT, `myroom: ${id} could not be merged`, err?.message || err); }
    p = { id, key, geo: {}, art: [], tris: 0, box: new THREE.Box3() };
    for (const k in out) {
      const g = out[k].geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      p.geo[k] = g; p.tris += g.index.count / 3; p.box.union(g.boundingBox);
    }
    for (const mesh of T.arts) {
      const g = mesh.geometry;
      mesh.updateMatrix(); g.applyMatrix4(mesh.matrix);
      if (!g.index) { const n = g.attributes.position.count, idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx); }
      if (!g.attributes.normal) g.computeVertexNormals();
      g.computeBoundingBox();
      p.art.push({ name: String(e.opt.art || ''), geo: g }); p.tris += g.index.count / 3; p.box.union(g.boundingBox);
    }
    for (const m of T.junk) { try { m.dispose(); } catch (err) { /* gone */ } }
    // a thing is drawn round the middle of its own footprint (a wall thing: round its middle on the wall), whatever
    // origin its generator used: the catalogue then only has to know how big it is
    p.shift = [0, 0, 0];
    if (!p.box.isEmpty()) {
      // … and it stands ON the floor (hangs FROM the ceiling) exactly
      const c = p.box.getCenter(_v), sx = -c.x, sy = e.place === 'W' ? -c.y : e.place === 'H' ? -p.box.max.y : -p.box.min.y, sz = e.place === 'W' ? 0 : -c.z;
      if (Math.abs(sx) + Math.abs(sy) + Math.abs(sz) > 1e-4) {
        for (const k in p.geo) p.geo[k].translate(sx, sy, sz);
        for (const a of p.art) a.geo.translate(sx, sy, sz);
        p.box.min.x += sx; p.box.max.x += sx; p.box.min.y += sy; p.box.max.y += sy; p.box.min.z += sz; p.box.max.z += sz;
        p.shift = [sx, sy, sz];
      }
    }
    S.protos.set(key, p);
    return p;
  }

  /** one dynamic mesh of the room: the geometry of every placed thing that uses this material */
  class Batch {
    constructor(name, material, parent, o = {}) {
      this.cap = 0; this.icap = 0; this.vn = 0; this.in = 0; this.dead = 0;
      this.pos = this.nor = this.uv = this.col = this.idx = null;
      const mesh = this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.name = 'myroom:' + name; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
      mesh.castShadow = !!o.cast; mesh.receiveShadow = o.receive !== false; mesh.raycast = () => {};
      if (o.guardSkip) mesh.userData.guardSkip = true;
      mesh.visible = false;
      parent.add(mesh);
    }
    _room(vNeed, iNeed) {
      if (this.vn + vNeed <= this.cap && this.in + iNeed <= this.icap) return;
      const cap = Math.max(1024, Math.ceil((this.vn + vNeed) * 1.5)), icap = Math.max(2048, Math.ceil((this.in + iNeed) * 1.5));
      const grow = (old, n, C) => { const a = new C(n); if (old) a.set(old.subarray(0, Math.min(old.length, n))); return a; };
      this.pos = grow(this.pos, cap * 3, Float32Array); this.nor = grow(this.nor, cap * 3, Float32Array);
      this.uv = grow(this.uv, cap * 2, Float32Array); this.col = grow(this.col, cap * 3, Float32Array);
      this.idx = grow(this.idx, icap, Uint32Array);
      this.cap = cap; this.icap = icap;
      const g = new THREE.BufferGeometry(), A = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
      g.setAttribute('position', A(this.pos, 3)); g.setAttribute('normal', A(this.nor, 3)); g.setAttribute('uv', A(this.uv, 2)); g.setAttribute('color', A(this.col, 3));
      g.setIndex(A(this.idx, 1));
      // the whole room is always in view from inside: fixed bounds, nothing recomputed per edit
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 0), 12);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-8, -0.5, -7), new THREE.Vector3(8, 4, 7));
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
    }
    _mark(attr, start, count) { if (typeof attr.addUpdateRange === 'function') attr.addUpdateRange(start, count); attr.needsUpdate = true; }
    /** append a prototype geometry at matrix m → its range { v0, vn, i0, in } */
    add(pg, m) {
      const vn = pg.attributes.position.count, inn = pg.index.count;
      this._room(vn, inn);
      const r = { v0: this.vn, vn, i0: this.in, in: inn, on: true };
      this.vn += vn; this.in += inn;
      this.write(r, pg, m);
      this.mesh.geometry.setDrawRange(0, this.in);
      this.mesh.visible = this.in > this.dead;
      return r;
    }
    /** (re)write a range from its prototype at matrix m (rotation about Y, a uniform scale, a translation) */
    write(r, pg, m) {
      const e = m.elements, A = pg.attributes, Pp = A.position.array, Np = A.normal.array, sc = Math.hypot(e[0], e[1], e[2]) || 1;
      const pos = this.pos, nor = this.nor;
      for (let i = 0, o = r.v0 * 3, n = r.vn * 3; i < n; i += 3, o += 3) {
        const x = Pp[i], y = Pp[i + 1], z = Pp[i + 2], nx = Np[i], ny = Np[i + 1], nz = Np[i + 2];
        pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        nor[o] = (e[0] * nx + e[4] * ny + e[8] * nz) / sc; nor[o + 1] = (e[1] * nx + e[5] * ny + e[9] * nz) / sc; nor[o + 2] = (e[2] * nx + e[6] * ny + e[10] * nz) / sc;
      }
      if (A.uv) this.uv.set(A.uv.array.subarray(0, r.vn * 2), r.v0 * 2); else this.uv.fill(0, r.v0 * 2, (r.v0 + r.vn) * 2);
      if (A.color) this.col.set(A.color.array.subarray(0, r.vn * 3), r.v0 * 3); else this.col.fill(1, r.v0 * 3, (r.v0 + r.vn) * 3);
      const I = pg.index.array, idx = this.idx;
      if (r.on) for (let i = 0; i < r.in; i++) idx[r.i0 + i] = I[i] + r.v0;
      const g = this.mesh.geometry;
      this._mark(g.attributes.position, r.v0 * 3, r.vn * 3); this._mark(g.attributes.normal, r.v0 * 3, r.vn * 3);
      this._mark(g.attributes.uv, r.v0 * 2, r.vn * 2); this._mark(g.attributes.color, r.v0 * 3, r.vn * 3);
      this._mark(g.index, r.i0, r.in);
    }
    /** switch a range off (its triangles collapse) or on again */
    show(r, pg, on) {
      if (r.on === on) return;
      r.on = on;
      const idx = this.idx, I = pg.index.array;
      if (on) { for (let i = 0; i < r.in; i++) idx[r.i0 + i] = I[i] + r.v0; this.dead -= r.in; }
      else { idx.fill(r.v0, r.i0, r.i0 + r.in); this.dead += r.in; }
      this._mark(this.mesh.geometry.index, r.i0, r.in);
      this.mesh.visible = this.in > this.dead;
    }
    clear() { this.vn = 0; this.in = 0; this.dead = 0; this.mesh.geometry.setDrawRange(0, 0); this.mesh.visible = false; }
    dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); }
  }

  /** the material of one artwork (shown evenly in a dim room, never brighter than paper white) */
  function artMaterial(name) {
    let m = S.artMats.get(name);
    if (m) return m;
    const rec = K.art(name);
    m = new THREE.MeshStandardMaterial({ map: rec.texture || null, roughness: 0.9, metalness: 0, emissiveMap: rec.texture || null, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.28 });
    S.artMats.set(name, m);
    return m;
  }
  function batchOf(key, isArt) {
    const map = isArt ? S.artBatches : S.batches;
    let b = map.get(key);
    if (b) return b;
    const unlit = key === 'glow' || key === 'lantern' || key === 'paper';
    b = new Batch((isArt ? 'art:' : '') + key, isArt ? artMaterial(key) : K.mat(key), S.items, { cast: S.shadows && !unlit && !isArt, receive: !unlit, guardSkip: isArt });
    map.set(key, b);
    return b;
  }
  /** where a placed thing is: its matrix in the room */
  function matrixOf(it, e) {
    const D = MD(), yaw = D.yawOf(it.r);
    if (e.place === 'W') { const n = D.ROOM.wallN; return M(it.x + Math.sin(yaw) * n, it.y, it.z + Math.cos(yaw) * n, yaw); }
    if (e.place === 'H') return M(it.x, D.ROOM.ceil - 0.006, it.z, yaw);
    const lift = e.place === 'R' ? (((Math.round(it.x * 8) * 7 + Math.round(it.z * 8) * 13) & 7) * 0.0012) : 0;   // rugs that overlap do not flicker
    return M(it.x, (it.y || 0) + lift, it.z, yaw, D.dims(it, e).k);
  }
  /** the collider of a thing a child must walk round (things on a table and flat things have none) */
  function colliderOf(it, e) {
    if ((e.place !== 'F' && e.place !== 'T') || (it.y || 0) > 0.01) return 0;
    const D = MD().dims(it, e);
    if (D.h < 0.12) return 0;
    return S.ctx.addCollider({ shape: 'box', x: it.x, z: it.z, hw: D.w / 2, hd: D.d / 2, rot: MD().yawOf(it.r), maxY: D.h, stand: D.h <= 0.6, tag: 'furniture' });
  }
  /** put a thing into the batches → its instance record */
  function addInstance(it) {
    const e = MD().items[it.i], proto = protoOf(it.i, it.c), m = matrixOf(it, e), parts = [];
    for (const k in proto.geo) { const b = batchOf(k, false); parts.push({ b, pg: proto.geo[k], r: b.add(proto.geo[k], m) }); }
    for (const a of proto.art) { const b = batchOf(a.name, true); parts.push({ b, pg: a.geo, r: b.add(a.geo, m) }); }
    return { it, e, proto, parts, col: colliderOf(it, e), off: false };
  }
  function dropCollider(inst) { if (inst.col) { try { G.world.removeCollider(inst.col); } catch (err) { /* gone */ } inst.col = 0; } }
  /** a thing moved, turned or resized: its vertices are rewritten where they are */
  function moveInstance(inst) {
    const m = matrixOf(inst.it, inst.e);
    for (const p of inst.parts) p.b.write(p.r, p.pg, m);
    dropCollider(inst);
    if (!inst.off) inst.col = colliderOf(inst.it, inst.e);
  }
  /** a thing in another colour: the same shape, so its place in the batches stays (else it is taken out and put back) */
  function recolourInstance(inst) {
    const proto = protoOf(inst.it.i, inst.it.c);
    const same = Object.keys(proto.geo).length + proto.art.length === inst.parts.length && inst.parts.every((p) => {
      const pg = p.b.mesh.name.indexOf('myroom:art:') === 0 ? (proto.art.find((a) => batchOf(a.name, true) === p.b) || {}).geo : Object.entries(proto.geo).find(([k]) => batchOf(k, false) === p.b)?.[1];
      if (!pg || pg.attributes.position.count !== p.r.vn || pg.index.count !== p.r.in) return false;
      p._next = pg;
      return true;
    });
    if (!same) { const off = inst.off; hideInstance(inst, true); const n = addInstance(inst.it); inst.parts = n.parts; inst.proto = n.proto; dropCollider(inst); inst.col = n.col; inst.off = false; if (off) hideInstance(inst, true); return; }
    inst.proto = proto;
    const m = matrixOf(inst.it, inst.e);
    for (const p of inst.parts) { p.pg = p._next; p._next = null; p.b.write(p.r, p.pg, m); }
  }
  /** take a thing out of the picture (it is in the hand, or removed) or put it back */
  function hideInstance(inst, off) {
    if (inst.off === off) return;
    inst.off = off;
    for (const p of inst.parts) p.b.show(p.r, p.pg, !off);
    if (off) dropCollider(inst); else if (!inst.col) inst.col = colliderOf(inst.it, inst.e);
  }
  /** draw the whole room again from its data (undo, a ready-made room, a room from the server) */
  function rebuildItems() {
    if (!S) return;
    for (const inst of S.inst) dropCollider(inst);
    for (const b of S.batches.values()) b.clear();
    for (const b of S.artBatches.values()) b.clear();
    S.inst = S.room.items.map((it) => addInstance(it));
    syncLamps();
  }
  /** the lamps of the room: the first LAMPS light-giving things get a pooled light, in the order they were placed */
  const FILL = [[-4.2, -2.4], [4.2, -2.4], [0, 0.2], [-4.2, 2.6], [4.2, 2.6], [0, -3.6]];
  function syncLamps() {
    if (!S) return;
    const D = MD(), def = S.ctx.def, always = S.room.style.mood === 'lamp';
    let n = 0, lit = 0;
    for (const inst of S.inst) {
      if (!inst.e.lamp || inst.off) continue;
      lit++;
      if (n >= S.lamps.length) continue;
      const hnd = S.lamps[n++], it = inst.it, k = D.dims(it, inst.e).k, a = D.yawOf(it.r), L = inst.e.lamp, sh = inst.proto.shift;
      const lx = (L[0] + sh[0]) * k, lz = (L[2] + sh[2]) * k, x = it.x + lx * Math.cos(a) + lz * Math.sin(a), z = it.z - lx * Math.sin(a) + lz * Math.cos(a);
      const y = inst.e.place === 'H' ? D.ROOM.ceil + L[1] + sh[1] : (it.y || 0) + (L[1] + sh[1]) * k;
      const c = hnd.cfg;
      c.x = x; c.y = y; c.z = z; c.intensity = 5.2; c.distance = 9; c.decay = 1.8; c.flicker = 0.05; c.day = always ? 1 : 0.34;
      const l = hnd.light;
      if (l) { l.position.set(def.origin.x + x, def.floorY + y, def.origin.z + z); l.color.copy(c.color); l.distance = c.distance; l.decay = c.decay; }
    }
    // the pooled lamps no thing uses glow softly from under the ceiling: a room is never black at night (the warm
    // light a lit room next door, the lamps in the yard and the moon would give), and the light count stays the same
    for (; n < S.lamps.length; n++) {
      const hnd = S.lamps[n], c = hnd.cfg, f = FILL[n % FILL.length], y = D.ROOM.ceil - 0.45;
      c.x = f[0]; c.y = y; c.z = f[1]; c.intensity = always ? 1.0 : 1.6; c.distance = 8.5; c.decay = 1.6; c.flicker = 0; c.day = 0.12;
      const l = hnd.light;
      if (l) { l.position.set(def.origin.x + f[0], def.floorY + y, def.origin.z + f[1]); l.distance = c.distance; l.decay = c.decay; }
    }
    if (S.lit !== lit) { const was = S.lit; S.lit = lit; if ((was > 0) !== (lit > 0)) applyLight(); }
  }

  // ---------------------------------------------------------------- the shell: a hanok room built through a proxy context
  const MOODS = {
    day: { sun: { az: 150, el: 34 } },
    warm: { sun: { az: 118, el: 17 }, light: { sun: { color: '#ffd2a0', intensity: 3.6 }, warmth: 0.07, exposure: 1.0 } },
    lamp: { sun: { az: 150, el: 26 }, light: { sun: { color: '#ffe2c0', intensity: 1.5 }, hemi: { sky: '#d9c7ae', ground: '#8c6f52', intensity: 0.24 }, exposure: 0.94, warmth: 0.06 } },
    bright: { sun: { az: 150, el: 40 }, light: { hemi: { sky: '#fbf6ec', ground: '#d2b894', intensity: 0.62 }, exposure: 1.1 } },
  };
  function shellSpec(style) {
    const D = MD(), R = D.ROOM, wall = style.wall, mood = MOODS[style.mood] || MOODS.day;
    const bay = (side, i) => {
      const k = D.bayKind(style, side, i);
      if (k === 'door') return { door: 'changho', exit: true, w: R.door.w, h: R.door.h, label: '나가는 문' };
      if (k > 0) return { window: D.PATTERNS[k - 1], w: D.WINDOW.w, h: D.WINDOW.h, sill: D.WINDOW.sill, label: false, wallMat: wall === 'clay' ? 'clay' : undefined };
      return wall;
    };
    const walls = {};
    for (const side of D.SIDES) walls[side] = Array.from({ length: D.SIDE_BAYS[side] }, (_, i) => bay(side, i));
    return {
      w: R.w, d: R.d, post: R.post, ridge: R.h, ceiling: R.ceil, bays: { x: R.baysX, z: R.baysZ }, floor: style.floor, roof: 'none', tone: style.wood, postR: R.postR,
      walls, sun: mood.sun, light: mood.light || undefined, shafts: !S.low,
    };
  }
  function buildShell(style) {
    const ctx = S.ctx, R0 = MD().ROOM, sh = S.shell = { group: new THREE.Group(), colliders: [], updates: [], owned: [], ceil: null };
    sh.group.name = 'myroom-shell';
    S.styleKey = JSON.stringify(style);
    ctx.group.add(sh.group);
    const pctx = Object.create(ctx);
    pctx.group = sh.group;
    pctx.addCollider = (c) => { const id = ctx.addCollider(c); if (id) sh.colliders.push(id); return id; };
    pctx.onUpdate = (fn) => { if (typeof fn === 'function') sh.updates.push(fn); };
    pctx.own = (t) => { if (t && typeof t.dispose === 'function') sh.owned.push(t); return t; };
    Object.defineProperty(pctx, 'lightCount', { get: () => Math.min(S ? S.lit : 0, LAMPS) });
    const R = S.R = K.room(pctx, shellSpec(style));
    // the wall above the lintel (the kit adds it with its own ceilings only), then the things by the door
    const wallKey = style.wall === 'clay' ? 'clay' : 'plaster';
    for (const side of MD().SIDES) {
      const len = R.len[side];
      R.add(wallKey, K.geo.quad(len, R0.ceil - R0.post + 0.02, 0, R0.post), R.wm(side, len / 2, (R0.ceil + R0.post) / 2, 0.012), null, { wall: side, cast: false });
      R.solid[side].push([0, len, R0.post - 0.1, R0.ceil + 0.2]);
    }
    brushStand(R, 1.3, 5.02);
    R.finish();
    ctx.room = R;
    // the ceiling: paper on a light grid, beams on the bay lines — one group, hidden while the room is seen from above
    const Bk = new BK.Bucket(), y = R0.ceil, w = R0.w, d = R0.d;
    Bk.add('hanji', K.geo.floor(w, d, true), M(0, y, 0), K.tint('hanji', '#f1e7d0'));
    const nx = Math.max(2, Math.round(w / 1.2)), nz = Math.max(2, Math.round(d / 1.2));
    for (let i = 1; i < nx; i++) Bk.add('wood', K.geo.timber(d, 0.03, 0.05, 0.004).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), M(-w / 2 + (w * i) / nx, y - 0.012, 0), K.tint('wood', '#a17650'));
    for (let j = 1; j < nz; j++) Bk.add('wood', K.geo.timber(w, 0.03, 0.05, 0.004), M(0, y - 0.012, -d / 2 + (d * j) / nz), K.tint('wood', '#a17650'));
    for (let i = 1; i < R0.baysX; i++) { const x = -w / 2 + (w * i) / R0.baysX; Bk.add('wood', K.geo.span(x, R0.post + 0.14, -d / 2, x, R0.post + 0.14, d / 2, 0.28, 0.22, 0.04), null, K.tint('wood', style.wood === 'dark' ? '#6a4a34' : style.wood === 'pale' ? '#b08a60' : '#7d5437')); }
    sh.ceil = new THREE.Group(); sh.ceil.name = 'myroom-ceiling';
    const out = Bk.build(sh.ceil, { name: ID + ':ceil', materials: { hanji: K.mat('hanji'), wood: K.mat('wood') }, shadows: false, ao: false });
    for (const k in out) out[k].receiveShadow = true;
    sh.group.add(sh.ceil);
    sh.ceil.visible = !(sys.edit && sys.edit.active);
  }
  /** the little stand by the door: a pot of brushes — where decorating starts (the interactable is made in build()) */
  function brushStand(R, x, z) {
    K.table(R, { x, z, w: 0.42, round: true, h: 0.46, legs: 'curved', tone: '#6b3a22' });
    R.add('lacquer', K.geo.lathe([[0, 0], [0.07, 0], [0.078, 0.012], [0.074, 0.16], [0.082, 0.17], [0.07, 0.172], [0.064, 0.02], [0, 0.02]], 14), M(x, 0.46, z), '#9fbfae');
    const cs = ['#c2342e', '#2c4a7a', '#e6b422', '#3d7356', '#8e2a5a'];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3, tx = Math.cos(a) * 0.05, tz = Math.sin(a) * 0.05, y1 = 0.82 + (k % 2) * 0.05;
      R.add('furn', geo.tube(x + tx * 0.3, 0.5, z + tz * 0.3, x + tx, y1, z + tz, 0.007, 5), null, '#7a5232', NC);
      R.add('paint', geo.tube(x + tx, y1, z + tz, x + tx * 1.06, y1 + 0.06, z + tz * 1.06, 0.011, 5), null, cs[k], NC);
    }
    R.block(x, z, 0.24, 0.24);
  }
  function disposeShell() {
    const sh = S && S.shell;
    if (!sh) return;
    for (const id of sh.colliders) { try { G.world.removeCollider(id); } catch (e) { /* gone */ } }
    sh.group.traverse((o) => { if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose(); });
    for (const t of sh.owned) { try { t.dispose(); } catch (e) { /* gone */ } }
    sh.group.parent?.remove(sh.group);
    S.shell = null; S.R = null;
  }
  /** the engine's indoor profile of the room as it is now (the place system asks for it on entering) */
  function lightProfile() { return S && S.R ? S.R.light() : null; }
  function applyLight() {
    const E = G.sys.engine;
    if (!S || !S.R || !P.is(ID) || !E?.setIndoor) return;
    const def = S.ctx.def, p = { ...S.R.light() }, c = p.center || { x: 0, y: 1.2, z: 0 };
    p.center = new THREE.Vector3(def.origin.x + num(c.x, 0), def.floorY + num(c.y, 1.2), def.origin.z + num(c.z, 0));
    if (!fin(Number(p.radius))) p.radius = Math.max(def.size.w, def.size.d) * 0.62 + 1.5;
    if (ED.active) {
      // decorating: an even, bright light whatever the room's mood is — every thing is seen from above as it is
      p.hemi = { sky: '#f7f1e6', ground: '#cdb596', intensity: Math.max(1.05, num(p.hemi && p.hemi.intensity, 0)) };
      p.hemiNight = { sky: '#e9dcc6', ground: '#a98a66', intensity: 1.15 };
      p.exposure = Math.max(1.06, num(p.exposure, 1)); p.exposureNight = Math.max(1.3, num(p.exposureNight, 1.3)); p.envIntensity = 0.8;
    }
    try { E.setIndoor(p, { instant: true }); } catch (e) { G.log.warn(CAT, 'myroom: light profile not applied', e?.message || e); }
  }
  /** a new style: the shell is built again behind a short fade (items = the things are drawn again too) */
  async function restyle(items) {
    if (!S) return;
    const run = () => {
      if (!S) return;
      try { disposeShell(); buildShell(S.room.style); if (items) rebuildItems(); applyLight(); syncLamps(); S.ctx.group.updateMatrixWorld(true); }
      catch (e) { G.log.warn(CAT, 'myroom: the room could not be rebuilt in the new style', e?.message || e); }
    };
    try { G.gfx?.guard?.watchdog?.hold?.(3000); } catch (e) { /* optional */ }
    if (G.ui?.fadeThrough && P.is(ID)) await G.ui.fadeThrough(async () => run(), 200); else run();
  }

  /** build(ctx) of the place */
  function buildPlace(ctx) {
    const D = MD(), E = G.sys.engine;
    S = {
      ctx, low: !!ctx.low, shadows: !!ctx.preset?.shadows && !ctx.low, R: null, shell: null,
      items: new THREE.Group(), batches: new Map(), artBatches: new Map(), artMats: new Map(), protos: new Map(),
      inst: [], lamps: [], lit: 0, room: sys._shown(), ghost: null,
    };
    S.items.name = 'myroom-items';
    for (let k = 0; k < LAMPS; k++) S.lamps.push(ctx.light({ x: 0, y: 1.2, z: 0, color: '#ffb469', intensity: 0, distance: 9, decay: 1.8, flicker: 0.05, day: 0.34 }));
    buildShell(S.room.style);
    ctx.group.add(S.items);
    rebuildItems();
    ctx.interact({
      id: 'MYROOM_EDIT', kind: 'craft', emoji: '🎨', label: '🎨 방 꾸미기', kidLabel: '방 꾸미기', radius: 2.2, priority: 0.2,
      position: { x: 1.3, y: 0.9, z: 5.02 }, enabled: () => !sys.edit.active && !sys._visit, onInteract: () => { sys.edit.start(); },
    });
    ctx.onUpdate((dt, t) => sys._frame(dt, t));
    void E; void D;
    return { dispose() { disposePlace(); } };
  }
  function disposePlace() {
    if (!S) return;
    try { if (sys.edit.active) sys.edit.stop({ silent: true, keep: true }); } catch (e) { /* closing */ }
    for (const b of S.batches.values()) b.dispose();
    for (const b of S.artBatches.values()) b.dispose();
    for (const m of S.artMats.values()) { try { m.dispose(); } catch (e) { /* gone */ } }
    for (const p of S.protos.values()) { for (const k in p.geo) p.geo[k].dispose(); for (const a of p.art) a.geo.dispose(); }
    // (the shell's geometries, colliders and owned things go with the place: 18-places disposes its group)
    for (const t of (S.shell ? S.shell.owned : [])) { try { t.dispose(); } catch (e) { /* gone */ } }
    S = null;
  }
  /** the floor plan for the minimap: the room's own plan + the footprints of the things */
  function drawPlan(c, map) {
    if (!S || !S.R) return;
    S.R.plan(c, map);
    const D = MD();
    for (const inst of S.inst) {
      if (inst.off) continue;
      const e = inst.e;
      if (e.place === 'W' || e.place === 'H') continue;
      const b = D.box(inst.it, e);
      c.save();
      c.translate(map.X(b.cx), map.Y(b.cz)); c.rotate(-D.yawOf(inst.it.r));
      c.fillStyle = e.place === 'R' ? 'rgba(214,180,110,.55)' : 'rgba(90,60,35,.72)';
      c.fillRect(-b.hw * map.S, -b.hd * map.S, b.hw * 2 * map.S, b.hd * 2 * map.S);
      c.restore();
    }
  }

  // ================================================================ whose room it is, and where it is kept
  // LOCAL MODE: the room is part of the save of this device (G.state.myroom) — a 체험용 room everybody has.
  // SERVER MODE: one row per account (api/room/get.php · save.php). The server decides who has a room (`can`) and how
  //   many things fit (`limit`). A save carries the version it was made from: the server takes it only when that is
  //   still the newest (then answers the next version); otherwise the room was changed elsewhere and is read again —
  //   unless the "other" change was this device's own save whose answer got lost on the way.
  //   A room that could not be sent (no network, the page closed) waits as a draft on this device.
  const store = {
    srv: { loaded: false, can: null, limit: 0, room: null, at: 0 },
    busy: null, dirty: false, saving: null, again: false, fails: 0, timer: 0, state: 'ok',
  };
  const acct = () => String(G.auth?.current?.id ?? 'local');
  /** what a room holds, written the same way whatever order its keys were made in */
  const contentOf = (r) => JSON.stringify([r.style.floor, r.style.wall, r.style.wood, r.style.mood, r.style.win, !!r.public, r.items.map((it) => [it.i, it.x, it.y || 0, it.z, it.r, it.s ?? 1, it.c ?? -1])]);
  function readDraft() {
    try {
      const raw = localStorage.getItem(LS_DRAFT + acct());
      if (!raw || raw.length > 80000) return null;
      const d = JSON.parse(raw);
      return d && typeof d === 'object' && Number.isSafeInteger(d.base) && d.room && typeof d.room === 'object' ? d : null;
    } catch (e) { return null; }
  }
  function writeDraft() {
    const r = store.srv.room;
    if (!r || !store.srv.can) return;
    try { localStorage.setItem(LS_DRAFT + acct(), JSON.stringify({ base: r.v | 0, at: Date.now(), room: { style: r.style, items: r.items, public: !!r.public } })); } catch (e) { /* storage full or off: the room is still in memory */ }
  }
  function dropDraft() { try { localStorage.removeItem(LS_DRAFT + acct()); } catch (e) { /* no storage */ } }

  /** the room that is shown and edited — the live object: changes are made in place */
  function liveRoom() {
    const D = MD();
    if (sys._visit) return sys._visit.room;
    if (serverMode()) return store.srv.room || (store.srv.room = D.empty());
    const st = G.state;
    if (!st) return D.empty();
    if (!st.myroom || typeof st.myroom !== 'object' || !Array.isArray(st.myroom.items) || !st.myroom.style) st.myroom = D.sanitize(st.myroom, D.LIMITS.hard);
    return st.myroom;
  }
  /** how many things fit: the room server's own answer (it is the one that checks a save), else the entitlement's,
   *  else the free number */
  function limitNow() {
    const D = MD();
    let n = NaN;
    if (serverMode() && store.srv.loaded && store.srv.can) n = Number(store.srv.limit);
    if (!(n > 0)) { try { n = Number(G.sys.entitle?.limit?.('roomItems')); } catch (e) { n = NaN; } }
    if (!(n > 0)) n = D.LIMITS.free;
    return clamp(Math.floor(n), 1, D.LIMITS.hard);
  }
  function canNow() {
    if (!serverMode()) return true;
    if (store.srv.loaded) return !!store.srv.can;
    let e = null;
    try { e = G.sys.entitle?.has?.('myroom'); } catch (err) { e = null; }
    return typeof e === 'boolean' ? e : null;
  }
  function setSaveState(s) { if (store.state !== s) { store.state = s; uiSave(); } }

  /** read my room from the server (once; force = again) → true when it is known now */
  function loadServer(force) {
    if (!serverMode()) return Promise.resolve(true);
    if (store.srv.loaded && !force) return Promise.resolve(true);
    if (store.busy) return store.busy;
    const who = acct(), D = MD();
    const p = (async () => {
      try {
        const r = await G.net.request('api/room/get.php', { timeout: 10000, quiet: true });
        if (who !== acct() || !serverMode()) return false;               // another account meanwhile
        const srv = store.srv;
        srv.can = !!(r && r.can === true);
        srv.limit = clamp(Math.floor(num(r && r.limit, D.LIMITS.free)), 0, D.LIMITS.hard);
        srv.at = Date.now();
        if (srv.loaded && (store.dirty || store.saving)) return true;    // changes are on their way: a re-read does not undo them
        let room = D.sanitize(r && r.room, D.LIMITS.hard);
        const draft = srv.can ? readDraft() : null;
        if (draft) {
          // made from the version the server still has: it is the newer room. Otherwise the server's wins.
          if (draft.base === room.v) { const v = room.v; room = D.sanitize(draft.room, D.LIMITS.hard); room.v = v; store.dirty = true; }
          else dropDraft();
        }
        srv.room = room; srv.loaded = true;
        if (store.dirty) saveSoon(1500);
        syncShown();
        return true;
      } catch (e) {
        G.log.warn(CAT, 'myroom: the room could not be read from the server', e?.code || e?.message || e);
        return false;
      } finally { if (store.busy === p) store.busy = null; }
    })();
    store.busy = p;
    return p;
  }
  /** the server has another version than the one this save was made from */
  async function recoverStale(room, sent) {
    try {
      const D = MD(), r = await G.net.request('api/room/get.php', { timeout: 10000, quiet: true });
      const theirs = D.sanitize(r && r.room, D.LIMITS.hard), tc = contentOf(theirs);
      if (tc === sent || tc === contentOf(room)) {                       // our own save: only its answer was lost
        room.v = theirs.v;
        store.fails = 0;
        if (contentOf(room) !== tc) store.dirty = true; else dropDraft();
        return 'ours';
      }
      store.srv.room = theirs; store.dirty = false; store.fails = 0; dropDraft();   // changed somewhere else: that room is the room now
      syncShown(true);
      toast(easyOn() ? '방이 다른 곳에서 바뀌어서 새로 불러왔어요.' : '다른 기기에서 방을 바꾸어서 새로 불러왔어요.', { emoji: '🏠', type: 'info' });
      return 'theirs';
    } catch (e) { store.dirty = true; store.fails++; writeDraft(); return ''; }
  }
  /** send my room to the server now → true when the server has it */
  function saveServer() {
    if (!serverMode() || !store.srv.loaded || !store.srv.can || !store.srv.room || sys._visit) return Promise.resolve(false);
    if (store.saving) { store.again = true; return store.saving; }
    clearTimeout(store.timer); store.timer = 0;
    const room = store.srv.room, who = acct(), sent = contentOf(room);
    const body = { v: room.v | 0, style: room.style, items: room.items, public: !!room.public };
    store.dirty = false; setSaveState('saving');
    const p = (async () => {
      let ok = false, synced = false;                                     // synced: nothing of ours is left to send
      try {
        const r = await G.net.request('api/room/save.php', { body, timeout: 12000, quiet: true });
        if (who !== acct()) return false;
        room.v = Math.max(0, Math.floor(num(r && r.v, (room.v | 0) + 1)));
        store.fails = 0; ok = true;
        if (contentOf(room) !== sent) store.dirty = true; else dropDraft();
        G.bus.emit('myroom:saved', { v: room.v, mode: 'server' });
      } catch (e) {
        if (who !== acct()) return false;
        const code = String((e && e.code) || '');
        if (code === 'ROOM_STALE') { const how = await recoverStale(room, sent); ok = how === 'ours'; synced = how === 'theirs'; }
        else if (code === 'ROOM_INVALID' || code === 'ROOM_LIMIT' || code === 'ROOM_FORBIDDEN' || code === 'INVALID_INPUT' || code === 'PAYLOAD_TOO_LARGE') {
          // the server will not take this room as it is: asking again would not help (the room stays on this device)
          store.fails = 99; writeDraft();
          G.log.warn(CAT, 'myroom: the server refused the room', code);
          if (code === 'ROOM_FORBIDDEN') { store.srv.can = false; if (ED.active) EDIT.stop({ silent: true }); }
        } else { store.dirty = true; store.fails++; writeDraft(); G.log.warn(CAT, 'myroom: the room was not saved (it will be sent again)', code || e?.message || e); }
      } finally {
        if (store.saving === p) store.saving = null;
        const more = (store.again || store.dirty) && store.fails < 6 && who === acct();
        store.again = false;
        setSaveState((ok || synced) && !store.dirty ? 'ok' : store.fails ? 'wait' : 'saving');
        if (more) saveSoon(store.fails ? Math.min(60000, 4000 * 2 ** store.fails) : 1200);
      }
      return ok;
    })();
    store.saving = p;
    return p;
  }
  function saveSoon(ms) {
    if (!serverMode() || sys._visit) return;
    store.dirty = true;
    clearTimeout(store.timer);
    store.timer = setTimeout(() => { store.timer = 0; saveServer(); }, Math.max(200, ms || 4000));
  }
  /** the room was changed by its holder */
  function changed() {
    if (sys._visit) return;
    const room = S ? S.room : liveRoom();
    if (serverMode()) { if (store.fails > 3) store.fails = 3; setSaveState('saving'); saveSoon(4000); }
    else { room.v = ((room.v | 0) + 1) % 1000000000; G.dirty?.('myroom'); G.bus.emit('myroom:saved', { v: room.v, mode: 'local' }); }
    G.bus.emit('myroom:changed', { count: room.items.length, v: room.v | 0 });
    uiCount();
  }
  /** the room to show is another one now (another account, the server answered, a visit): the built place follows */
  function syncShown(hard) {
    if (!S) return;
    const room = liveRoom();
    if (S.room === room && !hard) return;
    if (ED.active) editReset();
    const sameStyle = JSON.stringify(room.style) === S.styleKey;
    S.room = room;
    if (sameStyle) rebuildItems(); else restyle(true);
    uiCount();
  }

  // ================================================================ decorating: the thing in the hand
  // ONE thing at a time is "in the hand": the one just taken from the tray, or the one that was tapped. It is drawn
  // apart (the ghost: its own meshes with the real materials, red where it may not stand, a frame round its
  // footprint) and every change that is allowed is written into the room AT ONCE — so there is nothing to confirm and
  // nothing to lose: leaving the edit mode at any moment keeps the room as it looks. A change that is not allowed
  // stays red in the hand; letting go then puts the thing back where it was (a new thing simply goes).
  const ED = {
    active: false, ui: null, cat: 'room', held: null, undo: [], redo: [],
    // look / tLook: the point of the room in the middle of the part of the screen the bars leave free (shiftK moves the
    // camera's own aim towards the viewer so that this point lands there)
    cam: { yaw: 0, pitch: 1.0, dist: 20, fov: 50, look: new THREE.Vector3(0, 0.8, 0), tYaw: 0, tPitch: 1.0, tDist: 20, tLook: new THREE.Vector3(0, 0.8, 0), shiftK: 0, first: true },
    ptr: new Map(), drag: null, pinch: null, hover: null, offs: [], denyAt: 0, hintT: 0,
  };
  const UNDO_MAX = 20;
  const WHY = {
    id: '이건 놓을 수 없어요.', out: '방 밖으로는 나갈 수 없어요.', door: '문 앞은 비워 둬요. 드나드는 길이에요.',
    wall: '벽에 거는 것이에요. 벽 쪽으로 옮겨요.', post: '기둥 위에는 걸 수 없어요. 옆으로 옮겨요.', window: '창문과 문 위에는 걸 수 없어요.',
    air: '받쳐 주는 것이 없어요. 상 위나 바닥에 놓아요.', hit: '다른 것과 겹쳐요. 빈 곳으로 옮겨요.',
  };
  const round2 = (v) => Math.round(v * 100) / 100;
  const snap8 = (v) => Math.round(v * 8) / 8;
  const samePlace = (a, b) => !!a && !!b && a.x === b.x && a.z === b.z && (a.y || 0) === (b.y || 0) && a.r === b.r && (a.s ?? 1) === (b.s ?? 1) && (a.c ?? -1) === (b.c ?? -1);
  const snapshot = () => JSON.stringify({ style: S.room.style, items: S.room.items });
  function pushUndo() {
    ED.undo.push(snapshot());
    if (ED.undo.length > UNDO_MAX) ED.undo.shift();
    ED.redo.length = 0;
    uiUndo();
  }
  /** put a remembered room back (undo / redo) */
  function restore(snap) {
    let o = null;
    try { o = JSON.parse(snap); } catch (e) { o = null; }
    if (!o || !S) return false;
    const D = MD(), room = S.room, clean = D.sanitize({ v: room.v, style: o.style, items: o.items, public: room.public }, D.LIMITS.hard);
    const styleSame = JSON.stringify(clean.style) === JSON.stringify(room.style);
    room.style = clean.style;
    room.items.length = 0;
    for (const it of clean.items) room.items.push(it);
    if (styleSame) rebuildItems(); else restyle(true);
    changed(); uiUndo();
    return true;
  }
  /** forget the hand and the undo list (the room was replaced under the editor) */
  function editReset() {
    const H = ED.held;
    ED.held = null;
    if (H) dropGhost(H);
    ED.undo.length = 0; ED.redo.length = 0;
    uiHeld(); uiUndo();
  }

  // ---- the ghost
  let badMat = null, frameMat = null;
  const badMaterial = () => badMat || (badMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.6, depthWrite: false }));
  const frameMaterial = () => frameMat || (frameMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  /** a flat rectangular ring in the XZ plane */
  function ringGeo(w, d, t) {
    const hw = w / 2, hd = d / 2, pos = [];
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw + t, -hd + t], [hw - t, -hd + t], [hw - t, hd - t], [-hw + t, hd - t]]) pos.push(x, 0, z);
    const idx = [];
    for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; idx.push(k, 4 + k, n, n, 4 + k, 4 + n); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }
  function ghostParts(group, it) {
    const proto = protoOf(it.i, it.c);
    for (const k in proto.geo) { const m = new THREE.Mesh(proto.geo[k], K.mat(k)); m.userData.mat = m.material; group.add(m); }
    for (const a of proto.art) { const m = new THREE.Mesh(a.geo, artMaterial(a.name)); m.userData.mat = m.material; group.add(m); }
    return proto;
  }
  function dropGhost(H) {
    if (!H || !H.group) return;
    H.group.parent?.remove(H.group);
    if (H.ring) H.ring.geometry.dispose();
    H.group = null; H.ring = null;
  }
  function buildGhost(H) {
    dropGhost(H);
    const D = MD(), R0 = D.ROOM, e = H.e, g = H.group = new THREE.Group();
    g.name = 'myroom-ghost';
    H.proto = ghostParts(g, H.it);
    for (const r of H.riders) {
      const o = S.room.items[r.index], sub = new THREE.Group();
      ghostParts(sub, o);
      sub.matrix.copy(M(r.lx, r.ty, r.lz, D.yawOf(r.dr), D.dims(o).k));
      g.add(sub);
    }
    // the frame: on the floor under the thing, or on the wall round it
    let rg, rm;
    if (e.place === 'W') { rg = ringGeo(e.fp[0] + 0.1, e.fp[2] + 0.1, 0.04); rg.rotateX(PI / 2); rm = M(0, 0, -R0.wallN + 0.014); }
    else { rg = ringGeo(e.fp[0] + 0.1, e.fp[1] + 0.1, 0.05); rm = M(0, e.place === 'H' ? 0.03 - (R0.ceil - 0.006) : 0.03, 0); }
    const ring = H.ring = new THREE.Mesh(rg, frameMaterial());
    ring.renderOrder = 6; ring.matrix.copy(rm);
    g.add(ring);
    g.traverse((o) => { o.matrixAutoUpdate = false; if (o.isMesh) { o.frustumCulled = false; o.raycast = () => {}; o.castShadow = false; o.receiveShadow = false; o.userData.guardSkip = true; } });
    H.bad = false;
    S.ctx.group.add(g);
    showGhost(H);
  }
  function showGhost(H) {
    if (!H.group) return;
    H.group.matrix.copy(matrixOf(H.it, H.e));
    H.group.matrixWorldNeedsUpdate = true;
    const bad = !H.ok;
    if (H.bad !== bad) { H.bad = bad; H.group.traverse((o) => { if (o.isMesh && o !== H.ring) o.material = bad ? badMaterial() : o.userData.mat; }); }
    frameMaterial().color.set(bad ? 0xff5a4d : 0xffd34d);
  }

  // ---- what stands on a thing comes along with it
  function ridersOf(index) {
    const D = MD(), room = S.room, base = room.items[index], be = D.items[base.i];
    if (!be || be.place !== 'F' || !be.top) return [];
    const out = [], k = D.dims(base, be).k, a = D.yawOf(base.r), c = Math.cos(a), s = Math.sin(a), ty = Math.round(be.top[2] * k * 1000) / 1000;
    const mx = Math.max(0.02, (be.top[0] * k) / 2 - 0.09), mz = Math.max(0.02, (be.top[1] * k) / 2 - 0.09);
    room.items.forEach((o, j) => {
      if (j === index) return;
      const oe = D.items[o.i];
      if (!oe || oe.place !== 'T' || Math.abs((o.y || 0) - ty) > 0.02) return;
      const dx = o.x - base.x, dz = o.z - base.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > (be.top[0] * k) / 2 + 1e-6 || Math.abs(lz) > (be.top[1] * k) / 2 + 1e-6) return;
      // kept a little inside the edge: after a turn it is put on the fine grid again and must still stand on the top
      out.push({ index: j, lx: clamp(lx, -mx, mx), lz: clamp(lz, -mz, mz), ty, dr: (o.r - base.r + 24) % 24 });
    });
    return out;
  }
  function placeRiders(H) {
    const D = MD(), base = H.it, a = D.yawOf(base.r), c = Math.cos(a), s = Math.sin(a);
    for (const r of H.riders) {
      const o = S.room.items[r.index], inst = S.inst[r.index];
      if (!o || !inst) continue;
      o.x = snap8(base.x + r.lx * c + r.lz * s); o.z = snap8(base.z - r.lx * s + r.lz * c); o.y = r.ty; o.r = (base.r + r.dr) % 24;
      moveInstance(inst);
    }
  }

  // ---- may it be here?
  function validate(H) {
    if (H.index >= 0 && samePlace(H.it, H.orig)) { H.ok = true; H.why = ''; }
    else { const r = MD().check(S.room, H.it, H.index); H.ok = !!r.ok; H.why = r.ok ? '' : String(r.why || 'hit'); }
    showGhost(H);
    return H.ok;
  }
  /** keep a floor thing inside the walls (so a turn or a drag to the edge never ends "outside") */
  function fitInside(it, e) {
    if (e.place === 'W') return;
    const D = MD(), R0 = D.ROOM, b = D.box(it, e), pad = (e.place === 'R' ? 0.05 : e.place === 'H' ? 0.1 : R0.pad) + 1e-4;
    const ex = Math.abs(b.c) * b.hw + Math.abs(b.s) * b.hd, ez = Math.abs(b.s) * b.hw + Math.abs(b.c) * b.hd, f = R0.fine;
    const x0 = Math.ceil((-R0.w / 2 + pad + ex) / f) * f, x1 = Math.floor((R0.w / 2 - pad - ex) / f) * f;
    const z0 = Math.ceil((-R0.d / 2 + pad + ez) / f) * f, z1 = Math.floor((R0.d / 2 - pad - ez) / f) * f;
    if (x0 <= x1) it.x = clamp(it.x, x0, x1);
    if (z0 <= z1) it.z = clamp(it.z, z0, z1);
  }
  function assignItem(dst, src) {
    dst.x = src.x; dst.y = src.y || 0; dst.z = src.z; dst.r = src.r;
    if (src.s === 0 || src.s === 2) dst.s = src.s; else delete dst.s;
    if (Number.isInteger(src.c)) dst.c = src.c; else delete dst.c;
  }
  /** write the thing in the hand into the room (it stays in the hand) */
  function commitHeld() {
    const H = ED.held;
    if (!H || !H.ok || !S) return false;
    const room = S.room;
    if (H.index >= 0 && samePlace(H.it, H.orig)) return true;
    if (H.index < 0) {
      const it = MD().cleanItem(H.it);
      if (!it || room.items.length >= limitNow()) return false;
      pushUndo();
      room.items.push(it);
      H.index = room.items.length - 1;
      const inst = addInstance(it);
      S.inst.push(inst);
      hideInstance(inst, true);
    } else {
      const it = room.items[H.index], inst = S.inst[H.index];
      pushUndo();
      const recolour = (it.c ?? -1) !== (H.it.c ?? -1);
      assignItem(it, H.it);
      if (recolour) recolourInstance(inst); else moveInstance(inst);
      placeRiders(H);
    }
    H.orig = { ...H.it };
    changed();
    return true;
  }
  /** let go of the thing in the hand: it stays where it is allowed, else it goes back (cancel: always back) */
  function release(o = {}) {
    const H = ED.held;
    if (!H || !S) { ED.held = null; return; }
    if (H.ok && !o.cancel) commitHeld();
    ED.held = null;
    dropGhost(H);
    if (H.index >= 0 && S.inst[H.index]) {
      hideInstance(S.inst[H.index], false);
      for (const r of H.riders) if (S.inst[r.index]) hideInstance(S.inst[r.index], false);
    }
    syncLamps();
    uiHeld();
  }
  function deny(H) {
    const now = performance.now(), text = WHY[H.why] || WHY.hit;
    hint(text, 'bad');
    if (now - ED.denyAt > 2600) { ED.denyAt = now; sfx('wrong'); say(text); }
  }
  /** after a change made with a button or a key: keep it when it is allowed, say why when it is not */
  function settle(H, quiet) {
    validate(H);
    if (H.ok) { const ok = commitHeld(); if (ok && !quiet) sfx('click'); hint(''); }
    else deny(H);
    uiHeld();
    return H.ok;
  }
  /** take a thing of the room into the hand */
  function select(index, o = {}) {
    if (!S || !ED.active) return false;
    const room = S.room, it = room.items[index], e = it && MD().items[it.i];
    if (!e || !S.inst[index]) return false;
    if (ED.held && ED.held.index === index) return true;
    release();
    const H = ED.held = { it: { ...it }, e, index, orig: { ...it }, ok: true, why: '', riders: ridersOf(index), group: null, ring: null, proto: null, bad: false, follow: false, grab: null };
    hideInstance(S.inst[index], true);
    for (const r of H.riders) hideInstance(S.inst[r.index], true);
    buildGhost(H);
    syncLamps();
    uiHeld();
    if (!o.quiet) { sfx('tap'); hint(`${e.name} — 끌어서 옮겨요.`); say(`${e.kid}. 끌어서 옮겨요.`); }
    return true;
  }
  /** where the view looks: the quarter turn that faces the camera, and the walls from the far one to the near one */
  const viewR = () => (((Math.round(ED.cam.tYaw / (PI / 2)) * 6) % 24) + 24) % 24;
  function sidesByView() {
    const y = ED.cam.tYaw, f = { N: Math.cos(y), S: -Math.cos(y), W: Math.sin(y), E: -Math.sin(y) };
    return MD().SIDES.slice().sort((a, b) => f[b] - f[a]);
  }
  const uOfPoint = (side, x, z) => { const R0 = MD().ROOM; return side === 'N' ? x + R0.w / 2 : side === 'E' ? z + R0.d / 2 : side === 'S' ? R0.w / 2 - x : R0.d / 2 - z; };
  /** a wall thing at u metres along a wall and v up: inside the bay under it, on the fine grid, at an allowed height */
  function wallPlace(e, it, side, u, v) {
    const D = MD(), R0 = D.ROOM, f = R0.fine, w = D.dims(it, e).w, len = D.SIDE_LEN[side];
    const bay = D.bayOf(side, clamp(u, 0.01, len - 0.01));
    const lo = Math.ceil((bay.u0 + w / 2) / f - 1e-6) * f, hi = Math.floor((bay.u1 - w / 2) / f + 1e-6) * f;
    let uu = D.snapTo(u, R0.grid);
    if (lo <= hi) uu = clamp(uu, lo, hi);
    const at = D.wallSpot(side, clamp(uu, 0, len));
    return { x: at.x, z: at.z, y: round2(clamp(Math.round(v / 0.05) * 0.05, e.yw[0], e.yw[2])), r: at.r };
  }
  /** the first free spot for a new thing (near `near`, else where the view looks) → true when one was found */
  function firstSpot(H, near) {
    const D = MD(), R0 = D.ROOM, e = H.e, it = H.it, c = near || ED.cam.tLook, g = R0.grid, room = S.room;
    if (e.place === 'W') {
      const sides = near && near.side ? [near.side].concat(sidesByView().filter((s) => s !== near.side)) : sidesByView();
      const v = near && fin(near.v) ? near.v : e.yw[1];
      for (const side of sides) {
        const len = D.SIDE_LEN[side], u0 = clamp(near && near.side === side && fin(near.u) ? near.u : uOfPoint(side, c.x, c.z), 0, len);
        for (let k = 0; k * g <= len; k++) for (const sg of k ? [1, -1] : [1]) {
          const u = u0 + sg * k * g;
          if (u < 0 || u > len) continue;
          Object.assign(it, wallPlace(e, it, side, u, v));
          if (D.check(room, it, H.index).ok) return true;
        }
      }
      Object.assign(it, wallPlace(e, it, sides[0], D.SIDE_LEN[sides[0]] / 2, v));
      return false;
    }
    const cx = D.snapTo(clamp(c.x, -R0.w / 2 + 1, R0.w / 2 - 1), g), cz = D.snapTo(clamp(c.z, -R0.d / 2 + 1, R0.d / 2 - 3), g);
    for (let ring = 0; ring <= 30; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = cx + dx * g, z = cz + dz * g;
        if (Math.abs(x) > R0.w / 2 || Math.abs(z) > R0.d / 2) continue;
        it.x = x; it.z = z; it.y = 0;
        if (D.check(room, it, H.index).ok) return true;
      }
    }
    it.x = cx; it.z = cz; it.y = 0;
    return false;
  }
  /** a new thing from the tray. o.follow: it follows the mouse until the first click; o.c: its colour; o.near: where */
  function pickNew(id, o = {}) {
    const D = MD(), e = D.items[id];
    if (!S || !ED.active || !e) return false;
    release();
    if (S.room.items.length >= limitNow()) { full(); return false; }
    const it = { i: id, x: 0, y: 0, z: 0, r: e.place === 'W' || e.place === 'H' ? 0 : viewR() };
    if (e.col && Number.isInteger(o.c) && o.c >= 0 && o.c < D.palettes[e.col[0]].length) it.c = o.c;
    if (e.sz && (o.s === 0 || o.s === 2)) it.s = o.s;
    if (fin(o.r) && e.place !== 'W') it.r = ((Math.round(o.r) % 24) + 24) % 24;
    const H = ED.held = { it, e, index: -1, orig: null, ok: false, why: 'hit', riders: [], group: null, ring: null, proto: null, bad: false, follow: !!o.follow, grab: null };
    H.ok = firstSpot(H, o.near);
    buildGhost(H);
    validate(H);
    if (!H.follow && H.ok) commitHeld();          // it stands in the room at once; then it is moved like every other thing
    syncLamps();
    uiHeld();
    sfx('pop');
    if (H.ok) { hint(H.follow ? `${e.name} — 놓을 곳을 눌러요.` : `${e.name} — 끌어서 옮겨요.`); say(H.follow ? `${e.kid}. 놓을 곳을 눌러요.` : `${e.kid}. 방에 놓았어요. 끌어서 옮겨요.`); }
    else { hint('빈 자리가 없어요. 놓을 곳으로 끌어 봐요.', 'bad'); say('빈 자리가 없어요. 놓을 곳으로 끌어 봐요.'); }
    return true;
  }
  function full() {
    const t = `방이 가득 찼어요 (${limitNow()}개). 하나를 치우면 또 놓을 수 있어요.`;
    hint(t, 'bad'); sfx('wrong'); say('방이 가득 찼어요. 하나를 치우면 또 놓을 수 있어요.');
    toast(t, { emoji: '🧺', type: 'info' });
  }
  /** move the thing in the hand to a spot { x, z, y, r? } */
  function moveHeld(spot) {
    const H = ED.held;
    if (!H || !spot) return false;
    H.it.x = spot.x; H.it.z = spot.z; H.it.y = spot.y || 0;
    if (spot.r != null) H.it.r = spot.r;
    return validate(H);
  }

  // ================================================================ decorating: the view from above, the pointer, the keys
  const ZMIN = 5, ZMAX = 32;
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
  /** the ray under a point of the screen, in the room's own metres: { ox, oy, oz, dx, dy, dz } */
  function rayAt(px, py) {
    const E = G.sys.engine, cam = E?.camera, el = E?.renderer?.domElement;
    if (!cam || !el || !S) return null;
    const rc = el.getBoundingClientRect();
    if (!(rc.width > 0 && rc.height > 0)) return null;
    _ndc.set(((px - rc.left) / rc.width) * 2 - 1, -(((py - rc.top) / rc.height) * 2 - 1));
    _ray.setFromCamera(_ndc, cam);
    const g = S.ctx.group;
    g.worldToLocal(_o.copy(_ray.ray.origin));
    g.worldToLocal(_d.copy(_ray.ray.origin).add(_ray.ray.direction)).sub(_o).normalize();
    return { ox: _o.x, oy: _o.y, oz: _o.z, dx: _d.x, dy: _d.y, dz: _d.z };
  }
  /** a point of the room on the screen (CSS pixels) — for tests and for pointing at things */
  function screenOf(x, y, z) {
    const E = G.sys.engine, cam = E?.camera, el = E?.renderer?.domElement;
    if (!cam || !el || !S) return null;
    const rc = el.getBoundingClientRect();
    S.ctx.group.localToWorld(_o.set(x, y, z)).project(cam);
    return { x: rc.left + ((_o.x + 1) / 2) * rc.width, y: rc.top + ((1 - _o.y) / 2) * rc.height, front: _o.z < 1 };
  }
  /** where a ray meets the level y = hgt: { x, z, t } | null */
  function planeHit(r, hgt) {
    if (Math.abs(r.dy) < 1e-6) return null;
    const t = (hgt - r.oy) / r.dy;
    return t > 0 ? { x: r.ox + r.dx * t, z: r.oz + r.dz * t, t } : null;
  }
  /** how far along a ray a thing's box (G.data.myroom.box) is met | −1 */
  function boxHit(r, b) {
    // into the box's own frame: its X axis is (c, −s), its Z axis (s, c)
    const ox = r.ox - b.cx, oz = r.oz - b.cz;
    const lox = ox * b.c - oz * b.s, loz = ox * b.s + oz * b.c, ldx = r.dx * b.c - r.dz * b.s, ldz = r.dx * b.s + r.dz * b.c;
    let t0 = 0, t1 = Infinity;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      return t0 <= t1;
    };
    const pad = 0.02;
    if (!slab(lox, ldx, -b.hw - pad, b.hw + pad) || !slab(r.oy, r.dy, b.y0 - pad, Math.max(b.y1, b.y0 + 0.06) + pad) || !slab(loz, ldz, -b.hd - pad, b.hd + pad)) return -1;
    return t0;
  }
  const pickBox = (it, e) => { const b = MD().box(it, e); b.hw = Math.max(b.hw, 0.13); b.hd = Math.max(b.hd, 0.13); return b; };
  /** the thing under a point of the screen: { index, e, t, held } | null */
  function pickAt(px, py) {
    const r = rayAt(px, py);
    if (!r) return null;
    const H = ED.held;
    let best = null;
    const test = (it, e, index, held) => { const t = boxHit(r, pickBox(it, e)); if (t >= 0 && (!best || t < best.t)) best = { index, e, t, held }; };
    for (let i = 0; i < S.inst.length; i++) { const inst = S.inst[i]; if (!inst.off) test(inst.it, inst.e, i, false); }
    if (H) test(H.it, H.e, H.index, true);
    return best;
  }
  /** where a ray leaves the room through a wall: { side, u, v, t } | null */
  function wallHit(r) {
    const D = MD(), R0 = D.ROOM, hw = R0.w / 2, hd = R0.d / 2;
    let best = null;
    const tryT = (t, side) => {
      if (!(t > 0)) return;
      const x = r.ox + r.dx * t, y = r.oy + r.dy * t, z = r.oz + r.dz * t, u = uOfPoint(side, x, z), len = D.SIDE_LEN[side];
      if (y < -0.25 || y > R0.ceil + 0.9 || u < -0.3 || u > len + 0.3) return;
      if (!best || t < best.t) best = { side, u: clamp(u, 0, len), v: y, t };
    };
    if (r.dz < -1e-6) tryT((-hd - r.oz) / r.dz, 'N');
    if (r.dz > 1e-6) tryT((hd - r.oz) / r.dz, 'S');
    if (r.dx < -1e-6) tryT((-hw - r.ox) / r.dx, 'W');
    if (r.dx > 1e-6) tryT((hw - r.ox) / r.dx, 'E');
    return best;
  }
  /** the top of a table under a ray (where a small thing would stand): { x, z, y, t, on } | null */
  function topHit(r, skip) {
    const D = MD(), room = S.room;
    let best = null;
    for (let i = 0; i < room.items.length; i++) {
      if (i === skip || (S.inst[i] && S.inst[i].off)) continue;
      const o = room.items[i], oe = D.items[o.i];
      if (!oe || !oe.top || oe.place !== 'F') continue;
      const k = D.dims(o, oe).k, p = planeHit(r, oe.top[2] * k);
      if (!p || (best && p.t >= best.t)) continue;
      const a = D.yawOf(o.r), c = Math.cos(a), s = Math.sin(a), dx = p.x - o.x, dz = p.z - o.z;
      if (Math.abs(dx * c - dz * s) <= (oe.top[0] * k) / 2 && Math.abs(dx * s + dz * c) <= (oe.top[1] * k) / 2) best = { x: p.x, z: p.z, y: Math.round(oe.top[2] * k * 1000) / 1000, t: p.t, on: i };
    }
    return best;
  }
  /** where the thing in the hand would go for a point of the screen → { x, z, y, r? } | null */
  function spotAt(px, py, H) {
    const r = rayAt(px, py);
    if (!r) return null;
    const D = MD(), R0 = D.ROOM, e = H.e, room = S.room;
    if (e.place === 'W') {
      const w = wallHit(r);
      if (w) return wallPlace(e, H.it, w.side, w.u, w.v);
      const f = planeHit(r, 0);
      if (!f) return null;
      const at = D.wallAt(clamp(f.x, -R0.w / 2, R0.w / 2), clamp(f.z, -R0.d / 2, R0.d / 2));
      return wallPlace(e, H.it, at.side, at.u, H.it.y || e.yw[1]);
    }
    if (e.place === 'T') {
      const top = topHit(r, H.index);
      if (top) {
        // the nearest point of the fine grid that still stands on that top
        let best = null;
        for (const sx of [Math.floor(top.x * 8) / 8, Math.ceil(top.x * 8) / 8]) for (const sz of [Math.floor(top.z * 8) / 8, Math.ceil(top.z * 8) / 8]) {
          if (D.rest(room, e, sx, sz, H.index).on !== top.on) continue;
          const dd = (sx - top.x) ** 2 + (sz - top.z) ** 2;
          if (!best || dd < best.dd) best = { x: sx, z: sz, dd };
        }
        if (best) return { x: best.x, z: best.z, y: top.y };
      }
    }
    const g = H.grab, f = planeHit(r, g ? g.y : 0);
    if (!f) return null;
    const spot = { ...H.it, x: D.snapTo(f.x + (g ? g.dx : 0), R0.grid), z: D.snapTo(f.z + (g ? g.dz : 0), R0.grid), y: 0 };
    fitInside(spot, e);
    if (e.place === 'T') spot.y = D.rest(room, e, spot.x, spot.z, H.index).y;
    return { x: spot.x, z: spot.z, y: spot.y };
  }
  /** a small thing may be put ON these: a rug, or (a small thing in the hand) a table */
  const surfaceFor = (H, hit) => hit.e.place === 'R' || (H.e.place === 'T' && hit.e.place === 'F' && !!hit.e.top);
  /** the point of the thing that was grabbed: it stays under the finger while it is dragged */
  function setGrab(dg, H) {
    H.grab = null;
    const r = rayAt(dg.x0, dg.y0);
    if (!r || H.e.place === 'W') return;
    const t = boxHit(r, pickBox(H.it, H.e));
    if (t < 0) return;
    H.grab = { y: clamp(r.oy + r.dy * t, 0, 3), dx: H.it.x - (r.ox + r.dx * t), dz: H.it.z - (r.oz + r.dz * t) };
  }
  function beginDrag(dg) {
    const H = ED.held, hit = dg.hit;
    if (sys._visit) { dg.mode = 'pan'; return; }
    if (H && H.follow) { dg.mode = 'thing'; return; }
    if (hit && hit.held) { dg.mode = 'thing'; setGrab(dg, H); return; }
    if (hit && !(H && surfaceFor(H, hit)) && select(hit.index, { quiet: true })) { dg.mode = 'thing'; setGrab(dg, ED.held); sfx('tap'); return; }
    dg.mode = 'pan';
  }
  function endThingDrag() {
    const H = ED.held;
    if (!H) return;
    H.grab = null; H.follow = false;
    if (H.ok) { if (commitHeld()) sfx('pop'); hint(''); } else deny(H);
    uiHeld();
  }
  function tapAt(dg, x, y) {
    if (sys._visit) return;
    const H = ED.held, hit = dg.hit;
    if (H && H.follow) { moveHeld(spotAt(x, y, H)); endThingDrag(); return; }
    if (hit && hit.held) { hint(`${H.e.name} — 끌어서 옮기거나, 옮길 곳을 눌러요.`); return; }
    if (hit && !(H && surfaceFor(H, hit))) { select(hit.index); return; }
    if (H) { H.grab = null; moveHeld(spotAt(x, y, H)); endThingDrag(); }
  }
  /** slide the view so that the floor stays under the finger */
  function panBy(x0, y0, x1, y1) {
    const a = rayAt(x0, y0), pa = a && planeHit(a, 0), b = rayAt(x1, y1), pb = b && planeHit(b, 0);
    if (!pa || !pb) return;
    const c = ED.cam, R0 = MD().ROOM;
    c.tLook.x = clamp(c.tLook.x - (pb.x - pa.x), -R0.w / 2, R0.w / 2);
    c.tLook.z = clamp(c.tLook.z - (pb.z - pa.z), -R0.d / 2, R0.d / 2);
    c.look.x = c.tLook.x; c.look.z = c.tLook.z;
  }
  function pinchMove() {
    const [a, b] = [...ED.ptr.values()], pn = ED.pinch, c = ED.cam;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    c.tDist = c.dist = clamp(pn.dist * (pn.d / d), ZMIN, ZMAX);
    let da = ang - pn.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (!pn.turning && Math.abs(da) > 0.16) { pn.turning = true; pn.a = ang; da = 0; }   // a clear twist: only then does the view turn
    if (pn.turning) c.tYaw = c.yaw = pn.yaw + da;
    panBy(pn.mx, pn.my, mx, my);
    pn.mx = mx; pn.my = my;
  }
  function stageDown(e) {
    if (!ED.active || !S) return;
    const st = ED.ui.stage;
    if (e.pointerType === 'mouse' && e.button === 1) e.preventDefault();
    try { st.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    try { st.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    ED.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    ED.hover = null;
    if (ED.ptr.size === 2) {                       // two fingers: zoom, twist, slide
      const [a, b] = [...ED.ptr.values()];
      if (ED.drag && ED.drag.mode === 'thing') endThingDrag();
      ED.drag = null;
      ED.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: ED.cam.tDist, yaw: ED.cam.tYaw, turning: false };
      return;
    }
    if (ED.ptr.size > 2) return;
    const orbit = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1);
    ED.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, mode: orbit ? 'orbit' : null, hit: orbit ? null : pickAt(e.clientX, e.clientY), slop: e.pointerType === 'mouse' ? 5 : 10 };
  }
  function stageMove(e) {
    if (!ED.active || !S) return;
    const p = ED.ptr.get(e.pointerId);
    if (!p) { if (e.pointerType !== 'touch') ED.hover = { x: e.clientX, y: e.clientY }; return; }
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ED.pinch) { if (ED.ptr.size >= 2) pinchMove(); return; }
    const dg = ED.drag;
    if (!dg || dg.id !== e.pointerId) return;
    dg.x = e.clientX; dg.y = e.clientY;
    if (!dg.moved) {
      if (Math.hypot(dg.x - dg.x0, dg.y - dg.y0) < dg.slop) return;
      dg.moved = true;
      if (!dg.mode) beginDrag(dg);
    }
    if (dg.mode === 'thing') {
      const H = ED.held;
      if (H) { moveHeld(spotAt(dg.x, dg.y, H)); hint(H.ok ? '' : (WHY[H.why] || WHY.hit), H.ok ? '' : 'bad'); }
    } else if (dg.mode === 'pan') panBy(px, py, dg.x, dg.y);
    else if (dg.mode === 'orbit') {
      const c = ED.cam;
      c.tYaw = c.yaw = c.tYaw + (dg.x - px) * 0.006;
      c.tPitch = c.pitch = clamp(c.tPitch + (dg.y - py) * 0.004, 0.55, 1.35);
    }
  }
  function stageUp(e) {
    const had = ED.ptr.delete(e.pointerId);
    try { ED.ui?.stage.releasePointerCapture(e.pointerId); } catch (err) { /* never captured */ }
    if (!ED.active || !S) return;
    if (ED.pinch) { if (ED.ptr.size < 2) ED.pinch = null; return; }
    const dg = ED.drag;
    if (!had || !dg || dg.id !== e.pointerId) return;
    ED.drag = null;
    if (e.type === 'pointercancel') { if (dg.mode === 'thing') endThingDrag(); return; }
    if (dg.mode === 'orbit') {                     // a right click without a drag lets go of the thing in the hand
      if (!dg.moved && ED.held) { const H = ED.held; release({ cancel: H.follow || !H.ok }); hint(''); }
      return;
    }
    if (!dg.moved) { tapAt(dg, e.clientX, e.clientY); return; }
    if (dg.mode === 'thing') endThingDrag();
  }
  function stageWheel(e) {
    if (!ED.active) return;
    e.preventDefault();
    const c = ED.cam;
    c.tDist = clamp(c.tDist * (1 + Math.sign(e.deltaY) * Math.min(0.3, 0.08 + Math.abs(e.deltaY) / 800)), ZMIN, ZMAX);
  }
  /** the whole room in view (as far as the screen allows), in the part of the screen the bars leave free */
  function fitCamera() {
    const c = ED.cam, R0 = MD().ROOM, ui = ED.ui;
    const w = window.innerWidth || 1280, hh = window.innerHeight || 720;
    let top = 78, bot = hh * 0.32;
    try {
      const a = ui.top.getBoundingClientRect(), b = ui.tray.getBoundingClientRect();
      if (a.height > 0) top = a.bottom + 10;
      if (b.height > 0) bot = hh - b.top + 10;
    } catch (e) { /* not laid out yet */ }
    // the bar of the thing in the hand comes and goes above the tray: its room is kept free all the time, so a thing
    // near the door is never hidden under it and the view does not jump when something is taken
    let actH = 0;
    try { const r = ui.act.getBoundingClientRect(); actH = r.height > 0 ? r.height : 0; } catch (e) { actH = 0; }
    if (actH) ED.actH = actH; else actH = ED.actH || (easyOn() ? 74 : 62);
    bot += actH + 6;
    const portrait = hh > w * 1.05, pitch = 1.0, free = clamp((hh - top - bot) / hh, 0.3, 1);
    c.fov = portrait ? 58 : 50;
    const tf = Math.tan((c.fov * PI) / 360), asp = w / hh, q = ((Math.round(c.tYaw / (PI / 2)) % 4) + 4) % 4;
    const across = q % 2 ? R0.d : R0.w, deep = q % 2 ? R0.w : R0.d;
    // what must fit: the room across the screen, and its depth (foreshortened) plus the far wall up the screen
    const dh = (across / 2 + 0.5) / (tf * asp), dv = ((deep * Math.sin(pitch) + R0.post * Math.cos(pitch)) / 2 + 0.35) / (tf * free);
    c.tPitch = pitch; c.tYaw = Math.round(c.tYaw / (PI / 2)) * (PI / 2);
    c.tDist = clamp(portrait ? Math.min(Math.max(dh, dv), 25) : Math.max(dh, dv), ZMIN + 3, ZMAX);
    c.tLook.set(0, 0.8, 0);
    // the middle of the free part lies above the middle of the screen by this share of its height
    const tanT = ((bot - top) / hh) * tf;
    c.shiftK = tanT / (Math.sin(pitch) + tanT * Math.cos(pitch));
  }
  function viewTurn(dir) {
    const c = ED.cam, q = Math.round(c.tYaw / (PI / 2)) + (dir < 0 ? -1 : 1);
    c.tYaw = q * (PI / 2);
    const keep = c.tDist;
    fitCamera();
    c.tDist = keep;
    sfx('whoosh');
  }
  function zoomBy(dir) { const c = ED.cam; c.tDist = clamp(c.tDist * (dir > 0 ? 1.18 : 0.85), ZMIN, ZMAX); }
  /** the view's "right" and "away" on the floor, each to the nearest axis */
  function viewAxes() {
    const q = ((Math.round(ED.cam.tYaw / (PI / 2)) % 4) + 4) % 4;
    return { right: [[1, 0], [0, -1], [-1, 0], [0, 1]][q], away: [[0, -1], [-1, 0], [0, 1], [1, 0]][q] };
  }
  /** a wall thing one step along its wall; past a post it goes on to the next bay, round the corner too */
  function wallStep(H, side, u, dir) {
    const D = MD(), e = H.e, cur = D.wallOf(H.it);
    let s = wallPlace(e, H.it, side, u, H.it.y);
    if (cur && s.x === H.it.x && s.z === H.it.z) {
      const w = D.dims(H.it, e).w, bay = D.bayOf(side, cur.u);
      let i = bay.i + dir, sd = side;
      if (i < 0 || i >= D.SIDE_BAYS[side]) { sd = D.SIDES[(D.SIDES.indexOf(side) + dir + 4) % 4]; i = dir > 0 ? 0 : D.SIDE_BAYS[sd] - 1; }
      const len = D.SIDE_LEN[sd] / D.SIDE_BAYS[sd];
      s = wallPlace(e, H.it, sd, dir > 0 ? i * len + 0.2 + w / 2 : (i + 1) * len - 0.2 - w / 2, H.it.y);
    }
    return s;
  }
  /** the keys: one step of the thing in the hand (sx: right, sy: away / up) */
  function nudge(sx, sy, big) {
    const H = ED.held, D = MD(), R0 = D.ROOM;
    if (!H) return;
    H.follow = false; H.grab = null;
    if (H.e.place === 'W') {
      if (sy) H.it.y = round2(clamp(H.it.y + sy * (big ? 0.25 : 0.05), H.e.yw[0], H.e.yw[2]));
      const at = sx ? D.wallOf(H.it) : null;
      if (at) Object.assign(H.it, wallStep(H, at.side, at.u + sx * (big ? 1 : R0.grid), sx));
    } else {
      const ax = viewAxes(), step = big ? 1 : R0.grid;
      H.it.x = D.snapTo(H.it.x + (ax.right[0] * sx + ax.away[0] * sy) * step, R0.fine);
      H.it.z = D.snapTo(H.it.z + (ax.right[1] * sx + ax.away[1] * sy) * step, R0.fine);
      fitInside(H.it, H.e);
      H.it.y = H.e.place === 'T' ? D.rest(S.room, H.e, H.it.x, H.it.z, H.index).y : 0;
    }
    settle(H, true);
  }
  function panKeys(sx, sy) {
    const c = ED.cam, ax = viewAxes(), R0 = MD().ROOM;
    c.tLook.x = clamp(c.tLook.x + ax.right[0] * sx + ax.away[0] * sy, -R0.w / 2, R0.w / 2);
    c.tLook.z = clamp(c.tLook.z + ax.right[1] * sx + ax.away[1] * sy, -R0.d / 2, R0.d / 2);
  }
  /** the next (dir 1) or the last (−1) thing of the room into the hand — every thing can be reached without pointing */
  function cycle(dir) {
    const n = S ? S.room.items.length : 0;
    if (!n) { hint('아직 놓은 것이 없어요. 아래 그림을 눌러요.'); return false; }
    const H = ED.held;
    let i = H && H.index >= 0 ? H.index + (dir < 0 ? -1 : 1) : dir < 0 ? n - 1 : 0;
    i = ((i % n) + n) % n;
    return select(i);
  }
  function trayArrow(code, inCats) {
    const ui = ED.ui, list = [...(inCats ? ui.cats : ui.tiles).querySelectorAll('button')], i = list.indexOf(document.activeElement);
    if (code === 'ArrowDown' && inCats) { ui.tiles.querySelector('button')?.focus(); return; }
    if (code === 'ArrowUp' && !inCats) { (ui.cats.querySelector('button[aria-selected="true"]') || ui.cats.querySelector('button'))?.focus(); return; }
    const to = list[clamp(i + (code === 'ArrowRight' || code === 'ArrowDown' ? 1 : -1), 0, list.length - 1)];
    if (!to) return;
    to.focus();
    try { to.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* old browser */ }
    if (inCats) showCat(to.dataset.cat);
  }
  function onKey(e) {
    if (!ED.active || !S || !ED.ui) return;
    if (G.util.isTyping?.() || G.ui.modal?.isOpen?.()) return;
    const code = e.code, ae = document.activeElement;
    const inUi = !!(ae && ae !== document.body && ED.ui.root.contains(ae));
    const inTiles = inUi && !!ae.closest('.mr-tiles'), inCats = inUi && !!ae.closest('.mr-cats');
    const onBtn = inUi && !!ae.matches('button');
    const eat = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.ctrlKey || e.metaKey) {
      if (code === 'KeyZ') { eat(); if (e.shiftKey) EDIT.redo(); else EDIT.undo(); } else if (code === 'KeyY') { eat(); EDIT.redo(); }
      return;
    }
    if (e.altKey || code === 'Escape' || code === 'Tab') return;      // Escape: G.ui.onEscape · Tab: the browser moves the focus
    const H = ED.held;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      if (onBtn) { e.stopPropagation(); return; }                      // the focused button acts (and nothing else does)
      eat();
      if (H && H.follow) { H.follow = false; settle(H); } else if (H) { release(); hint(''); sfx('click'); }
      return;
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, 1], KeyS: [0, -1] }[code];
    if (arrow) {
      eat();
      if ((inTiles || inCats) && code.indexOf('Arrow') === 0) trayArrow(code, inCats);
      else if (H) nudge(arrow[0], arrow[1], e.shiftKey);
      else panKeys(arrow[0], arrow[1]);
      return;
    }
    switch (code) {
      case 'KeyR': eat(); EDIT.turn(e.shiftKey ? -1 : 1); break;
      case 'KeyQ': eat(); viewTurn(-1); break;
      case 'KeyE': eat(); viewTurn(1); break;
      case 'PageUp': case 'BracketRight': eat(); EDIT.raise(1); break;
      case 'PageDown': case 'BracketLeft': eat(); EDIT.raise(-1); break;
      case 'Equal': case 'NumpadAdd': eat(); zoomBy(-1); break;       // (outside the edit mode + / − change the turning speed)
      case 'Minus': case 'NumpadSubtract': eat(); zoomBy(1); break;
      case 'Digit0': case 'Numpad0': eat(); fitCamera(); break;
      case 'KeyC': eat(); EDIT.colour(); break;
      case 'KeyG': eat(); EDIT.size(0); break;
      case 'KeyV': case 'Insert': eat(); EDIT.copy(); break;
      case 'Delete': case 'Backspace': eat(); EDIT.remove(); break;
      case 'KeyZ': eat(); EDIT.undo(); break;
      case 'KeyY': eat(); EDIT.redo(); break;
      case 'KeyN': eat(); cycle(e.shiftKey ? -1 : 1); break;
      case 'KeyT': eat(); (ED.ui.tiles.querySelector('button') || ED.ui.cats.querySelector('button'))?.focus(); break;
      case 'KeyB': eat(); EDIT.stop(); break;
      default: break;
    }
  }
  function onEscape() {
    if (!ED.active) return false;
    if (G.ui.modal?.isOpen?.()) return false;
    const H = ED.held;
    if (H) { release({ cancel: H.follow || !H.ok }); hint(''); return true; }
    EDIT.stop();
    return true;
  }
  /** one frame of the edit mode: the camera, the thing that follows the mouse, a picture or two for the tray */
  function editFrame(dt) {
    const c = ED.cam, def = S.ctx.def, k = c.first || reduced() ? 1 : 1 - Math.exp(-Math.min(0.1, dt || 0.016) * 9);
    let dy = c.tYaw - c.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += dy * k; c.pitch += (c.tPitch - c.pitch) * k; c.dist += (c.tDist - c.dist) * k; c.look.lerp(c.tLook, k);
    if (Math.abs(dy) < 1e-4) c.yaw = c.tYaw;
    const cp = Math.cos(c.pitch), sh = c.dist * c.shiftK;
    const ax = def.origin.x + c.look.x + Math.sin(c.yaw) * sh, az = def.origin.z + c.look.z + Math.cos(c.yaw) * sh, ay = def.floorY + c.look.y;
    _v.set(ax + Math.sin(c.yaw) * cp * c.dist, ay + Math.sin(c.pitch) * c.dist, az + Math.cos(c.yaw) * cp * c.dist);
    _v2.set(ax, ay, az);
    try { G.sys.camera.shot(_v, _v2, { fov: c.fov, duration: c.first && !reduced() ? 0.7 : 0 }); } catch (e) { /* the camera system is optional */ }
    c.first = false;
    if (ED.hover) {
      const hv = ED.hover, H = ED.held;
      ED.hover = null;
      if (H && H.follow) { moveHeld(spotAt(hv.x, hv.y, H)); hint(H.ok ? `${H.e.name} — 놓을 곳을 눌러요.` : (WHY[H.why] || WHY.hit), H.ok ? '' : 'bad'); }
      else if (ED.ui) { const hit = pickAt(hv.x, hv.y); ED.ui.stage.style.cursor = hit ? (hit.held ? 'grab' : 'pointer') : ''; }
    }
    thumbStep();
  }

  // ================================================================ decorating: the bars, the tray and its pictures
  const ROOM_CAT = { id: 'room', emoji: '🏠', name: '방 모양', say: '방의 바닥과 벽, 창문을 바꿔요. 꾸며 둔 방도 있어요.' };
  function btn(cls, emoji, label, line, fn) {
    return h('button', { type: 'button', class: 'mr-btn ' + cls, title: label, 'aria-label': label, dataset: { say: line || label }, onclick: (ev) => { ev.preventDefault(); fn(ev); } },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'mr-l' }, label));
  }
  function tile(data, emoji, name, line, cls) {
    return h('button', { type: 'button', class: 'mr-tile ' + (cls || ''), role: 'option', title: name, dataset: { ...data, say: line } },
      h('span', { class: 'mr-pic' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji)), h('span', { class: 'mr-name' }, name));
  }
  function buildUi() {
    if (ED.ui) return ED.ui;
    const D = MD(), ui = ED.ui = { actKey: null, ptrType: '' };
    ui.stage = h('div', { class: 'mr-stage', tabindex: '0', role: 'application', 'aria-label': '방. 놓은 것을 끌어서 옮겨요. 화살표 키로도 옮길 수 있어요.' });
    ui.count = h('span', { class: 'mr-count', 'aria-live': 'polite' });
    ui.save = h('span', { class: 'mr-save' });
    ui.undo = btn('mr-undo', '↩️', '되돌리기', '되돌리기. 방금 한 것을 되돌려요.', () => EDIT.undo());
    ui.redo = btn('mr-redo', '↪️', '다시 하기', '다시 하기. 되돌린 것을 다시 해요.', () => EDIT.redo());
    ui.top = h('div', { class: 'mr-top glass', role: 'toolbar', 'aria-label': '방 꾸미기' },
      btn('mr-done', '✅', '다 했어요', '다 했어요. 꾸미기를 마치고 방으로 돌아가요.', () => EDIT.stop()),
      ui.undo, ui.redo,
      btn('mr-view', '🔄', '돌려 보기', '돌려 보기. 방을 다른 쪽에서 봐요.', () => viewTurn(1)),
      btn('mr-next', '👆', '다음 물건', '다음 물건. 놓은 것을 차례로 골라요.', () => cycle(1)),
      h('span', { class: 'mr-info' }, ui.count, ui.save));
    ui.hint = h('div', { class: 'mr-hint', role: 'status', 'aria-live': 'polite', hidden: true });
    ui.act = h('div', { class: 'mr-act glass', role: 'toolbar', 'aria-label': '고른 물건', hidden: true });
    ui.cats = h('div', { class: 'mr-cats', role: 'tablist', 'aria-label': '종류' });
    ui.tiles = h('div', { class: 'mr-tiles', role: 'listbox', 'aria-label': '놓을 것' });
    ui.tray = h('div', { class: 'mr-tray glass' }, ui.cats, ui.tiles);
    ui.bottom = h('div', { class: 'mr-bottom' }, ui.act, ui.tray);
    ui.root = h('div', { id: 'myroom-ui', class: 'myroom-ui', hidden: true }, ui.stage, ui.top, ui.hint, ui.bottom);
    for (const c of [ROOM_CAT].concat(D.cats)) {
      ui.cats.appendChild(h('button', { type: 'button', class: 'mr-cat', role: 'tab', 'aria-selected': 'false', title: c.name, dataset: { cat: c.id, say: `${c.name}. ${c.say}` }, onclick: () => { showCat(c.id); sfx('page'); say(`${c.name}. ${c.say}`); } },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji), h('span', { class: 'mr-l' }, c.name)));
    }
    const st = ui.stage;
    st.addEventListener('pointerdown', stageDown);
    st.addEventListener('pointermove', stageMove);
    st.addEventListener('pointerup', stageUp);
    st.addEventListener('pointercancel', stageUp);
    st.addEventListener('wheel', stageWheel, { passive: false });
    st.addEventListener('contextmenu', (e) => e.preventDefault());
    // a picture is taken with one press: with a mouse the thing then follows the pointer until the click that puts it
    // down; with a finger or the keyboard it stands in the room at once and is moved from there
    ui.tiles.addEventListener('pointerdown', (e) => { ui.ptrType = e.pointerType || ''; });
    ui.tiles.addEventListener('click', (e) => {
      const b = e.target.closest('.mr-tile');
      if (!b || !ED.active) return;
      const mouse = e.detail > 0 && (e.pointerType || ui.ptrType) === 'mouse';
      ui.ptrType = '';
      if (b.dataset.id) pickNew(b.dataset.id, { follow: mouse });
      else if (b.dataset.do) roomTile(b.dataset.do);
    });
    document.body.appendChild(ui.root);
    return ui;
  }
  function showCat(id) {
    const D = MD(), ui = ED.ui;
    if (!ui) return;
    ED.cat = id === 'room' || D.cats.some((c) => c.id === id) ? id : 'room';
    for (const b of ui.cats.children) { const on = b.dataset.cat === ED.cat; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.classList.toggle('on', on); b.tabIndex = on ? 0 : -1; }
    ui.tiles.textContent = '';
    ui.tiles.scrollLeft = 0;
    TH.queue.length = 0;
    if (ED.cat === 'room') {
      for (const p of D.presets) ui.tiles.appendChild(tile({ do: 'preset:' + p.id }, p.emoji, p.name, `${p.name}. ${p.say}`, 'mr-tile-room mr-tile-preset'));
      for (const [k, emoji, name, line] of [['floor', '🟨', '바닥', '바닥을 골라요.'], ['wall', '🧱', '벽', '벽을 골라요.'], ['wood', '🪵', '기둥', '기둥 빛깔을 골라요.'], ['mood', '☀️', '빛', '방의 빛을 골라요.'], ['win', '🪟', '창문', '창문을 내거나 막아요.']]) ui.tiles.appendChild(tile({ do: 'style:' + k }, emoji, name, `${name}. ${line}`, 'mr-tile-room'));
      ui.tiles.appendChild(tile({ do: 'reset' }, '🧹', '처음으로', '처음으로. 방을 비우고 처음 모습으로 돌아가요.', 'mr-tile-room'));
      if (serverMode() && !sys._visit) {
        const pub = !!(S && S.room.public);
        const t = tile({ do: 'public' }, pub ? '🌐' : '🔒', pub ? '구경 허락' : '나만 보기', pub ? `구경 허락. 친구가 내 방을 구경할 수 있어요. 내 방 번호는 ${acct()}번이에요. 누르면 나만 봐요.` : '나만 보기. 누르면 친구도 내 방을 구경할 수 있어요.', 'mr-tile-room mr-tile-public');
        t.setAttribute('aria-pressed', pub ? 'true' : 'false');
        ui.tiles.appendChild(t);
        ui.tiles.appendChild(tile({ do: 'friend' }, '👫', '친구 방', '친구 방. 방 번호를 눌러 친구 방을 구경해요.', 'mr-tile-room'));
      }
      return;
    }
    for (const tid of D.order) {
      const e = D.items[tid];
      if (e.cat !== ED.cat) continue;
      const b = tile({ id: tid }, e.emoji, e.name, `${e.kid}. 눌러서 방에 놓아요.`, '');
      ui.tiles.appendChild(b);
      thumbFor(tid, b);
    }
  }
  function hint(text, kind) {
    const ui = ED.ui;
    if (!ui) return;
    ui.hint.textContent = text || '';
    ui.hint.hidden = !text;
    ui.hint.classList.toggle('bad', kind === 'bad');
  }
  function uiCount() {
    try { syncFab(); } catch (e) { /* HUD not there yet */ }
    const ui = ED.ui;
    if (!ui || !S) return;
    const n = S.room.items.length, lim = limitNow();
    ui.count.textContent = `🧺 ${n} / ${lim}`;
    ui.count.title = `놓은 것 ${n}개 · ${lim}개까지 놓을 수 있어요`;
    ui.count.classList.toggle('full', n >= lim);
    ui.root.classList.toggle('is-full', n >= lim);
  }
  function uiSave() {
    const ui = ED.ui;
    if (!ui) return;
    const st = serverMode() ? store.state : 'local';
    ui.save.dataset.state = st;
    ui.save.textContent = st === 'local' ? '💾 이 기기에 저장' : st === 'ok' ? '💾 저장됨' : st === 'saving' ? '⏳ 저장 중' : '📴 조금 뒤에 저장';
  }
  function uiUndo() {
    const ui = ED.ui;
    if (!ui) return;
    ui.undo.setAttribute('aria-disabled', ED.undo.length ? 'false' : 'true');
    ui.redo.setAttribute('aria-disabled', ED.redo.length ? 'false' : 'true');
  }
  /** the buttons for the thing in the hand (built again only when another kind of thing is taken: the focus stays) */
  function uiHeld() {
    const ui = ED.ui;
    if (!ui) return;
    const H = ED.held, act = ui.act, easy = easyOn(), key = H ? `${H.it.i}|${easy ? 1 : 0}` : '';
    ui.root.classList.toggle('has-held', !!H);
    if (ui.actKey === key) return;
    ui.actKey = key;
    act.textContent = '';
    act.hidden = !H;
    if (!H) return;
    const e = H.e, add = (...a) => act.appendChild(btn(...a));
    act.appendChild(h('span', { class: 'mr-held' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e.emoji), h('span', { class: 'mr-held-name' }, e.name)));
    if (e.place === 'W') {
      add('mr-a', '⬆️', '위로', '위로. 조금 높이 걸어요.', () => EDIT.raise(1));
      add('mr-a', '⬇️', '아래로', '아래로. 조금 낮게 걸어요.', () => EDIT.raise(-1));
    } else {
      if (!easy) add('mr-a', '↺', '왼쪽으로 돌리기', '왼쪽으로 돌리기.', () => EDIT.turn(-1));
      add('mr-a', '↻', easy ? '돌리기' : '오른쪽으로 돌리기', '돌리기. 누를 때마다 조금씩 돌아요.', () => EDIT.turn(1));
    }
    if (e.sz) add('mr-a', '📏', '크기', '크기. 작게, 보통, 크게 바꿔요.', () => EDIT.size(0));
    if (e.col) add('mr-a', '🎨', '색', '색. 다른 색으로 바꿔요.', () => EDIT.colour());
    add('mr-a', '➕', '하나 더', '하나 더. 똑같은 것을 하나 더 놓아요.', () => EDIT.copy());
    add('mr-a mr-del', '🗑️', '치우기', '치우기. 방에서 치워요.', () => EDIT.remove());
    add('mr-a mr-ok', '👌', '놓기', '놓기. 여기에 두고 손을 떼요.', () => EDIT.place());
  }
  function roomTile(what) {
    const [kind, arg] = String(what).split(':');
    if (kind === 'preset') return EDIT.preset(arg);
    if (kind === 'reset') return EDIT.reset();
    if (kind === 'public') return EDIT.setPublic(!(S && S.room.public));
    if (kind === 'friend') return friendPad();
    if (kind === 'style') return arg === 'win' ? windowEditor() : stylePick(arg);
    return false;
  }
  /** a friend's room: the room number is put together on big number buttons (no typing) → sys.visitUser(number) */
  function friendPad() {
    if (!serverMode() || !G.ui?.modal?.open) return false;
    let digits = '';
    const shown = h('div', { class: 'mr-pad-num', role: 'status', 'aria-live': 'polite' });
    const paint = () => { shown.textContent = digits || '방 번호'; shown.classList.toggle('empty', !digits); };
    const key = (label, line, fn, cls) => h('button', { type: 'button', class: 'mr-pad-key ' + (cls || ''), 'aria-label': line, dataset: { say: line }, onclick: (ev) => { ev.preventDefault(); fn(); paint(); sfx('tap'); } }, label);
    const pad = h('div', { class: 'mr-pad' });
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) pad.appendChild(key(d, d, () => { if (digits.length < 9) digits = (digits + d).replace(/^0+/, ''); }));
    pad.appendChild(key('⌫', '하나 지우기', () => { digits = digits.slice(0, -1); }, 'mr-pad-fn'));
    pad.appendChild(key('0', '0', () => { if (digits && digits.length < 9) digits += '0'; }));
    pad.appendChild(key('🧹', '모두 지우기', () => { digits = ''; }, 'mr-pad-fn'));
    paint();
    G.ui.modal.open({
      id: 'myroom-friend', title: '친구 방 구경', icon: '👫', className: 'mr-padmodal',
      body: (el) => { el.appendChild(h('p', { class: 'mr-wtext' }, '친구가 알려 준 방 번호를 눌러요.')); el.appendChild(shown); el.appendChild(pad); },
      actions: [
        { label: '👀 구경 가기', class: 'btn-primary', close: true, onClick: () => { if (digits) sys.visitUser(Number(digits)); else toast('방 번호를 먼저 눌러요.', { emoji: '👫', type: 'info' }); } },
        { label: '닫기', close: true },
      ],
    });
    say('친구 방 구경. 친구가 알려 준 방 번호를 눌러요.', { force: true, priority: 1 });
    return true;
  }
  async function ask(emoji, title, text, yes, no) {
    if (!G.easy?.confirm) return true;
    try { return !!(await G.easy.confirm({ emoji, title, text, say: `${title} ${text}`, yes, no })); } catch (e) { return false; }
  }
  async function stylePick(key) {
    const D = MD(), opts = D.styles[key], names = { floor: '바닥', wall: '벽', wood: '기둥', mood: '빛' };
    if (!opts || !S || !G.easy?.pick) return false;
    const cur = S.room.style[key];
    const id = await G.easy.pick({ id: 'myroom-style', title: `${names[key]} 고르기`, emoji: '🏠', say: `${names[key]} 고르기. 그림을 눌러요.`, columns: Math.min(4, opts.length),
      items: opts.map((o) => ({ id: o.id, emoji: o.emoji, label: o.name, say: `${o.name}. ${o.say}`, selected: o.id === cur, badge: o.id === cur ? '✔' : '' })) });
    if (!id || !ED.active) return false;
    return EDIT.style({ [key]: id });
  }
  /** the windows: a plan of the room whose 18 bays are buttons — each press turns a bay into the next kind */
  function windowEditor() {
    const D = MD();
    if (!S || !ED.active || !G.ui.modal?.open) return false;
    let win = S.room.style.win;
    const sideName = { N: '뒤쪽 벽', E: '오른쪽 벽', S: '문이 있는 벽', W: '왼쪽 벽' }, cells = [];
    const paint = () => {
      for (const c of cells) {
        const k = c.door ? -1 : win.charCodeAt(c.idx) - 48, name = c.door ? '문' : k > 0 ? `${D.PATTERN_NAMES[k]} 창` : '벽';
        c.el.dataset.k = String(k);
        c.el.firstChild.textContent = c.door ? '🚪' : k > 0 ? '🪟' : '🧱';
        c.el.lastChild.textContent = c.door ? '문' : D.PATTERN_NAMES[k];
        c.el.setAttribute('aria-label', `${sideName[c.side]} ${c.i + 1}번째 칸: ${name}`);
      }
    };
    const cell = (side, i) => {
      const idx = D.winIndex(side, i), door = idx === D.WIN_DOOR;
      const el = h('button', { type: 'button', class: 'mr-wcell', disabled: door }, h('span', { class: 'emoji', 'aria-hidden': 'true' }), h('span', { class: 'mr-wn' }));
      cells.push({ el, side, i, idx, door });
      if (!door) el.addEventListener('click', () => {
        const k = (win.charCodeAt(idx) - 48 + 1) % 7;
        win = win.slice(0, idx) + String(k) + win.slice(idx + 1);
        paint(); sfx('click');
        say(k ? `${D.PATTERN_NAMES[k]} 창문.` : '벽.');
      });
      return el;
    };
    G.ui.modal.open({
      id: 'myroom-win', title: '창문', icon: '🪟', className: 'mr-winmodal',
      body: (el) => {
        el.appendChild(h('p', { class: 'mr-wtext' }, '칸을 누르면 벽이 창문으로 바뀌어요. 또 누르면 창살 무늬가 바뀌어요.'));
        el.appendChild(h('div', { class: 'mr-wplan' },
          h('div', { class: 'mr-wrow' }, Array.from({ length: 5 }, (_, i) => cell('N', i))),
          h('div', { class: 'mr-wmid' },
            h('div', { class: 'mr-wcol' }, Array.from({ length: 4 }, (_, i) => cell('W', 3 - i))),
            h('div', { class: 'mr-wfloor' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏠'), h('span', null, '방 안')),
            h('div', { class: 'mr-wcol' }, Array.from({ length: 4 }, (_, i) => cell('E', i)))),
          h('div', { class: 'mr-wrow' }, Array.from({ length: 5 }, (_, i) => cell('S', 4 - i)))));
        paint();
      },
      actions: [
        { label: '✅ 이렇게 할래요', class: 'btn-primary', close: true, onClick: () => { EDIT.style({ win }); } },
        { label: '그만두기', close: true },
      ],
    });
    say('창문. 칸을 누르면 벽이 창문으로 바뀌어요.');
    return true;
  }

  // ---- pictures of the catalogue: each thing rendered once, small, with its real materials
  const TH = { size: 132, scene: null, cam: null, rt: null, lut: null, holder: null, queue: [], busy: false, decoded: 0 };
  function putThumb(tileEl, src) {
    const pic = tileEl.querySelector('.mr-pic');
    if (!pic) return;
    const cv = h('canvas', { class: 'mr-cv', width: String(TH.size), height: String(TH.size), 'aria-hidden': 'true' });
    const c2 = cv.getContext('2d');
    if (!c2) return;
    c2.drawImage(src, 0, 0);
    pic.textContent = '';
    pic.appendChild(cv);
  }
  function thumbFor(id, tileEl) {
    const cv = thumbs.get(id);
    if (cv) putThumb(tileEl, cv);
    else if (!TH.queue.includes(id)) TH.queue.push(id);
  }
  /** render the waiting pictures, one after the other (the pixels are read back without holding up a frame) */
  function thumbStep() {
    if (TH.busy || !TH.queue.length || !S || !ED.ui) return;
    const E = G.sys.engine, r = E?.renderer;
    if (!r || E._isLost?.() || typeof r.readRenderTargetPixels !== 'function') { TH.queue.length = 0; return; }
    const id = TH.queue.shift();
    if (thumbs.has(id)) return;
    TH.busy = true;
    renderThumb(id, r, E).then((cv) => {
      if (!cv) return;
      thumbs.set(id, cv);
      const tileEl = ED.ui && ED.ui.tiles.querySelector(`[data-id="${id}"]`);
      if (tileEl) putThumb(tileEl, cv);
    }, (e) => { G.log.warn(CAT, `myroom: no picture of ${id}`, e?.message || e); }).then(() => { TH.busy = false; });
  }
  /** one catalogue entry as a small picture → a canvas | null (nothing could be drawn) */
  async function renderThumb(id, r, E) {
    const e = MD().items[id], Z = TH.size;
    if (!e || !S) return null;
    if (!TH.scene) {
      const sc = TH.scene = new THREE.Scene(), Kp = 0.5;    // half power keeps the picture below 8-bit clipping; the gain restores it
      const key = new THREE.DirectionalLight(0xfff0dc, 3.0 * Kp), fill = new THREE.DirectionalLight(0xdce8ff, 1.0 * Kp);
      key.position.set(1.6, 3.0, 2.4); fill.position.set(-2.6, 1.2, 1.4);
      sc.add(new THREE.HemisphereLight(0xfff6e8, 0x8d7f6c, 1.6 * Kp), key, fill);
      TH.cam = new THREE.PerspectiveCamera(22, 1, 0.05, 80);
      TH.rt = new THREE.WebGLRenderTarget(Z, Z, { samples: 4 });
      TH.holder = new THREE.Group();
      sc.add(TH.holder);
      const lut = TH.lut = new Uint8Array(1024);
      const aces = (x) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1), srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
      for (let i = 0; i < 1024; i++) lut[i] = Math.round(srgb(aces((i / 1023) * 4)) * 255);
    }
    const sc = TH.scene, cam = TH.cam, hold = TH.holder, rt = TH.rt, pkey = id + '|', had = S.protos.has(pkey), proto = protoOf(id, null);
    sc.environment = E.scene?.environment || null;
    sc.environmentIntensity = 0.5;
    hold.clear();
    for (const k in proto.geo) hold.add(new THREE.Mesh(proto.geo[k], K.mat(k)));
    for (const a of proto.art) hold.add(new THREE.Mesh(a.geo, artMaterial(a.name)));
    const drawn = hold.children.length > 0 && !proto.box.isEmpty();
    if (drawn) {
      // from the front, a little from the right and from above (a rug: from above; a wall thing: nearly straight on)
      const c = proto.box.getCenter(_v), rad = Math.max(0.08, proto.box.getSize(_v2).length() / 2);
      const dir = e.place === 'R' ? [0.25, 1, 0.7] : e.place === 'W' ? [0.3, 0.12, 1] : e.place === 'H' ? [0.4, 0.08, 1] : [0.55, 0.55, 1];
      const dl = Math.hypot(dir[0], dir[1], dir[2]), dist = (rad / Math.sin((cam.fov * PI) / 360)) * 1.03;
      cam.position.set(c.x + (dir[0] / dl) * dist, c.y + (dir[1] / dl) * dist, c.z + (dir[2] / dl) * dist);
      cam.near = Math.max(0.02, dist - rad * 1.6); cam.far = dist + rad * 1.6;
      cam.updateProjectionMatrix();
      cam.lookAt(c.x, c.y, c.z);
      sc.updateMatrixWorld(true);
      const prevRT = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
      try { r.setClearColor(0x000000, 0); r.setRenderTarget(rt); r.clear(); r.render(sc, cam); }
      finally { r.setRenderTarget(prevRT); r.setClearColor(prevColor, prevAlpha); }
    }
    hold.clear();
    // its prototype is kept only while the room uses it: a tray of 148 pictures must not keep 148 sets of geometry
    if (!had && !S.inst.some((i) => i.proto === proto) && !(ED.held && ED.held.proto === proto)) {
      for (const k in proto.geo) proto.geo[k].dispose();
      for (const a of proto.art) a.geo.dispose();
      S.protos.delete(pkey);
    }
    if (!drawn) return null;
    // the pixels: asked for now (the read is part of this frame's commands), fetched when the GPU has them. Another
    // reader of the engine may be waiting with a pixel buffer bound — a plain read is refused then, so it is unbound
    // (that reader binds its buffer again before it fetches).
    const buf = new Uint8Array(Z * Z * 4);
    if (typeof r.readRenderTargetPixelsAsync === 'function') await r.readRenderTargetPixelsAsync(rt, 0, 0, Z, Z, buf);
    else { try { const gl = r.getContext(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); } catch (err) { /* WebGL 1 */ } r.readRenderTargetPixels(rt, 0, 0, Z, Z, buf); }
    if (E._isLost?.() || rt !== TH.rt) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Z;
    const c2 = cv.getContext('2d');
    if (!c2) return null;
    const img = c2.createImageData(Z, Z), d = img.data, lut = TH.lut, gain = 1.44;
    let lit = 0;
    for (let y = 0; y < Z; y++) {
      const src = (Z - 1 - y) * Z * 4, dst = y * Z * 4;         // WebGL rows are bottom-up
      for (let x = 0; x < Z * 4; x += 4) {
        const a = buf[src + x + 3];
        if (!a) continue;
        const k = (gain / a) * (1023 / 4);                      // un-premultiply the smoothed edges, apply the gain, map to the curve
        d[dst + x] = lut[Math.min(1023, Math.round(buf[src + x] * k))]; d[dst + x + 1] = lut[Math.min(1023, Math.round(buf[src + x + 1] * k))];
        d[dst + x + 2] = lut[Math.min(1023, Math.round(buf[src + x + 2] * k))]; d[dst + x + 3] = a;
        lit++;
      }
    }
    if (lit < 12) return null;                                  // nothing came back (a failed draw): the emoji stays
    c2.putImageData(img, 0, 0);
    return cv;
  }

  // ================================================================ decorating: what can be done (G.sys.myroom.edit)
  const EDIT = {
    get active() { return ED.active; },
    /** what is in the hand: { id, index, x, y, z, r, s, c, ok, why, follow } | null */
    get held() { const H = ED.held; return H ? { id: H.it.i, index: H.index, x: H.it.x, y: H.it.y || 0, z: H.it.z, r: H.it.r, s: H.it.s ?? 1, c: H.it.c ?? null, ok: H.ok, why: H.why, follow: H.follow, riders: H.riders.length } : null; },
    get category() { return ED.cat; },
    get undoCount() { return ED.undo.length; },
    get redoCount() { return ED.redo.length; },
    start() {
      if (ED.active) return true;
      if (!S || !P.is(ID) || sys._visit || !G.state) return false;
      if (serverMode() && !store.srv.can) { sys.explain(); return false; }
      ED.active = true; ED.held = null; ED.undo.length = 0; ED.redo.length = 0; ED.ptr.clear(); ED.drag = null; ED.pinch = null; ED.hover = null;
      try { G.ui.modal.closeAll?.(); G.ui.popover?.close?.(); } catch (e) { /* nothing open */ }
      try { G.input?.mouseLook?.release?.('myroom'); } catch (e) { /* no pointer lock */ }
      G.ui.block('myroom-edit');
      document.body.classList.add('hud-hidden', 'myroom-edit');
      // the player waits by the door (nothing can be put there) and is out of the way
      try { const def = S.ctx.def, sp = MD().ROOM.spawn; G.sys.player?.cancelWalk?.('myroom'); G.sys.player?.teleport?.(def.origin.x + sp.x, def.origin.z + sp.z, sp.rotY, { fade: false, silent: true }); } catch (e) { /* stays where it is */ }
      const ui = buildUi();
      ui.root.hidden = false;
      ui.actKey = null;
      if (S.shell && S.shell.ceil) S.shell.ceil.visible = false;
      applyLight();
      showCat(ED.cat === 'room' && S.room.items.length ? 'furn' : ED.cat);
      uiHeld(); uiUndo(); uiCount(); uiSave();
      // a tall screen (a phone held upright) looks along the room's long side, so the whole room fits its width
      ED.cam.first = true; ED.cam.tYaw = ED.cam.yaw = (window.innerHeight || 720) > (window.innerWidth || 1280) * 1.05 ? PI / 2 : 0;
      fitCamera();
      ED.cam.pitch = ED.cam.tPitch; ED.cam.dist = ED.cam.tDist; ED.cam.look.copy(ED.cam.tLook);
      ED.offs.push(G.ui.onEscape(onEscape, 40));
      window.addEventListener('keydown', onKey, true);
      const onResize = () => { if (ED.active) fitCamera(); };
      window.addEventListener('resize', onResize);
      ED.offs.push(() => window.removeEventListener('keydown', onKey, true), () => window.removeEventListener('resize', onResize));
      hint(easyOn() ? '그림을 눌러서 방에 놓아요.' : '그림을 눌러 방에 놓아요. 놓은 것은 끌어서 옮기고, 화살표 키로도 옮겨요.');
      say('방을 꾸며요. 아래 그림을 누르면 방에 놓여요.');
      sfx('open');
      G.bus.emit('myroom:edit', { on: true });
      return true;
    },
    /** leave the edit mode: the room stays as it looks (a thing that is red in the hand goes back where it was) */
    stop(o = {}) {
      if (!ED.active) return true;
      try { if (S) release(); } catch (e) { ED.held = null; }
      ED.active = false; ED.drag = null; ED.pinch = null; ED.hover = null; ED.ptr.clear(); TH.queue.length = 0;
      for (const off of ED.offs.splice(0)) { try { off(); } catch (e) { /* gone */ } }
      if (ED.ui) { ED.ui.root.hidden = true; ED.ui.stage.style.cursor = ''; }
      G.ui.unblock('myroom-edit');
      document.body.classList.remove('hud-hidden', 'myroom-edit');
      if (S) {
        if (S.shell && S.shell.ceil) S.shell.ceil.visible = true;
        applyLight();
        if (!o.keep) { try { rebuildItems(); } catch (e) { G.log.warn(CAT, 'myroom: the room could not be drawn again', e?.message || e); } }   // one tidy set of batches
      }
      try { if (G.sys.camera?.mode === 'shot') G.sys.camera.setMode('follow', { duration: o.silent || reduced() ? 0 : 0.7 }); } catch (e) { /* camera optional */ }
      if (serverMode()) { if (store.dirty) saveServer(); } else G.dirty?.('myroom');
      syncFab();
      if (!o.silent) { sfx('close'); const n = S ? S.room.items.length : 0; say(n ? '방이 멋져졌어요! 걸어 다니며 구경해요.' : '언제든 다시 꾸밀 수 있어요.'); }
      G.bus.emit('myroom:edit', { on: false });
      return true;
    },
    /** take a new thing from the catalogue: pick(id, { c, s, r, near: { x, z } | { side, u, v }, follow }) */
    pick(id, o) { return pickNew(String(id), o || {}); },
    select(index) { return select(index | 0); },
    next(dir) { return cycle(dir); },
    /** move the thing in the hand: to(x, z) on the floor (a small thing climbs onto the table under it) or
     *  to({ side, u, v }) on a wall → true when it may be there (it is kept then) */
    to(x, z) {
      const H = ED.held, D = MD();
      if (!H) return false;
      H.follow = false; H.grab = null;
      if (H.e.place === 'W') {
        const w = x && typeof x === 'object' ? x : D.wallAt(num(x, 0), num(z, 0));
        if (!D.SIDE_LEN[w.side]) return false;
        Object.assign(H.it, wallPlace(H.e, H.it, w.side, num(w.u, 0), fin(w.v) ? w.v : (H.it.y || H.e.yw[1])));
      } else {
        H.it.x = D.snapTo(num(x, 0), D.ROOM.fine); H.it.z = D.snapTo(num(z, 0), D.ROOM.fine);
        fitInside(H.it, H.e);                                             // like the pointer: never further than the wall
        H.it.y = H.e.place === 'T' ? D.rest(S.room, H.e, H.it.x, H.it.z, H.index).y : 0;
      }
      return settle(H, true);
    },
    /** let go of the thing in the hand (it stays; red: it goes back where it was) */
    place() {
      const H = ED.held;
      if (!H) return false;
      const ok = H.ok;
      release({ cancel: !ok });
      if (ok) { hint(''); sfx('click'); } else { hint(H.index >= 0 ? '놓을 수 없는 곳이라 제자리에 돌려놓았어요.' : '놓을 곳이 없어서 다시 넣어 두었어요.'); say(H.index >= 0 ? '제자리에 돌려놓았어요.' : '다시 넣어 두었어요.'); }
      return ok;
    },
    cancel() { const H = ED.held; if (!H) return false; release({ cancel: true }); hint(''); return true; },
    turn(dir) {
      const H = ED.held;
      if (!H) { hint('먼저 돌릴 것을 눌러요.'); return false; }
      if (H.e.place === 'W') return false;
      const step = easyOn() ? 3 : 1;
      H.it.r = (((H.it.r + (dir < 0 ? -step : step)) % 24) + 24) % 24;
      fitInside(H.it, H.e);
      return settle(H);
    },
    raise(dir) {
      const H = ED.held;
      if (!H || H.e.place !== 'W') return false;
      H.it.y = round2(clamp(H.it.y + (dir < 0 ? -1 : 1) * (easyOn() ? 0.15 : 0.05), H.e.yw[0], H.e.yw[2]));
      return settle(H);
    },
    /** size(0): the next of small / normal / large · size(±1): smaller / larger */
    size(dir) {
      const H = ED.held;
      if (!H || !H.e.sz) return false;
      const cur = H.it.s ?? 1, next = dir ? clamp(cur + (dir < 0 ? -1 : 1), 0, 2) : (cur + 1) % 3;
      if (next === 1) delete H.it.s; else H.it.s = next;
      fitInside(H.it, H.e);
      const ok = settle(H);
      if (ok) say(['작게.', '보통 크기.', '크게.'][next]);
      return ok;
    },
    /** colour(c): palette index (−1 = its own colours) · colour(): ask with pictures */
    async colour(c) {
      const H = ED.held, D = MD();
      if (!H || !H.e.col) return false;
      const pal = D.palettes[H.e.col[0]];
      if (c == null) {
        if (!G.easy?.pick) return false;
        const cur = H.it.c ?? -1;
        const got = await G.easy.pick({ id: 'myroom-colour', title: '색 고르기', emoji: '🎨', say: '어떤 색으로 할까요? 그림을 눌러요.', columns: 4,
          items: [{ id: 'own', emoji: H.e.emoji, label: '원래 색', color: '#f3e7cf', selected: cur < 0 }].concat(pal.map((p, i) => ({ id: 'c' + i, emoji: '🎨', label: p[0], color: p[1], selected: cur === i }))) });
        if (!got || ED.held !== H) return false;
        c = got === 'own' ? -1 : Number(String(got).slice(1));
      }
      if (Number.isInteger(c) && c >= 0 && c < pal.length) H.it.c = c; else delete H.it.c;
      buildGhost(H);
      return settle(H);
    },
    /** one more of the thing in the hand, beside it (the copy is in the hand then) */
    copy() {
      const H = ED.held;
      if (!H) { hint('먼저 하나 더 놓을 것을 눌러요.'); return false; }
      if (!H.ok) { deny(H); return false; }
      const src = { ...H.it }, e = H.e, D = MD();
      const near = e.place === 'W' ? (() => { const at = D.wallOf(src) || { side: 'N', u: 1 }; return { side: at.side, u: at.u + D.dims(src, e).w + 0.25, v: src.y }; })() : { x: src.x + viewAxes().right[0] * 0.5, z: src.z + viewAxes().right[1] * 0.5 };
      return pickNew(src.i, { c: src.c, s: src.s, r: src.r, near });
    },
    /** take the thing in the hand out of the room (what stands on it goes too) */
    remove() {
      const H = ED.held;
      if (!H) { hint('먼저 치울 것을 눌러요.'); return false; }
      const name = H.e.name;
      if (H.index < 0) { release({ cancel: true }); hint(''); return true; }
      const gone = [H.index].concat(H.riders.map((r) => r.index)).sort((a, b) => b - a);
      ED.held = null;
      dropGhost(H);
      pushUndo();
      for (const i of gone) S.room.items.splice(i, 1);
      rebuildItems();
      uiHeld();
      changed();
      sfx('whoosh'); hint(`${gone.length > 1 ? josa(name, '과', '와') + ' 그 위에 있던 것을' : josa(name, '을', '를')} 치웠어요. ↩️ 로 되돌릴 수 있어요.`); say('치웠어요.');
      return true;
    },
    undo() {
      if (!ED.active || !S) return false;
      if (ED.held && (ED.held.index < 0 || !ED.held.ok)) { release({ cancel: true }); hint(''); return true; }   // first: what is red in the hand
      if (!ED.undo.length) { hint('되돌릴 것이 없어요.'); return false; }
      release();
      const now = snapshot(), snap = ED.undo.pop();
      ED.redo.push(now);
      restore(snap);
      sfx('page'); hint('되돌렸어요.');
      return true;
    },
    redo() {
      if (!ED.active || !S) return false;
      if (!ED.redo.length) { hint('다시 할 것이 없어요.'); return false; }
      release();
      const now = snapshot(), snap = ED.redo.pop();
      ED.undo.push(now);
      restore(snap);
      sfx('page'); hint('다시 했어요.');
      return true;
    },
    /** a ready-made room instead of this one (asks first when the room is not empty; o.force: no question) */
    async preset(id, o = {}) {
      const D = MD(), p = D.preset(id);
      if (!p || !S || !ED.active) return false;
      const meta = D.presets.find((q) => q.id === id);
      if (!o.force && S.room.items.length && !(await ask(meta.emoji, '이 방으로 바꿀까요?', `${meta.name} — 지금 방에 놓은 것 대신 꾸며 둔 방이 놓여요. ↩️ 로 되돌릴 수 있어요.`, '바꿀래요', '그대로 둘래요'))) return false;
      if (!S || !ED.active) return false;
      release();
      pushUndo();
      const room = S.room, lim = limitNow();
      room.style = p.style;
      room.items.length = 0;
      for (const it of p.items.slice(0, lim)) room.items.push(it);
      await restyle(true);
      changed();
      sfx('sparkle'); hint(`${meta.name}! 이제 마음대로 바꿔 봐요.`); say(`${meta.name}. ${meta.say}`);
      return true;
    },
    /** empty the room and give it its first look again (asks first; o.force: no question) */
    async reset(o = {}) {
      if (!S || !ED.active) return false;
      const D = MD();
      if (!o.force && !(await ask('🧹', '처음으로 돌아갈까요?', '놓은 것을 모두 치우고 방을 처음 모습으로 돌려요. ↩️ 로 되돌릴 수 있어요.', '처음으로', '그대로 둘래요'))) return false;
      if (!S || !ED.active) return false;
      release({ cancel: true });
      pushUndo();
      const room = S.room, e = D.empty();
      room.style = e.style;
      room.items.length = 0;
      await restyle(true);
      changed();
      sfx('whoosh'); hint('처음 모습이 되었어요.'); say('방이 처음 모습이 되었어요.');
      return true;
    },
    /** may others look at this room? (server accounts only: a friend then visits it with the room number) */
    setPublic(on) {
      if (!S || !ED.active || sys._visit || !serverMode()) return false;
      const room = S.room, v = !!on;
      if (!!room.public === v) return true;
      room.public = v;
      changed();
      if (ED.cat === 'room') showCat('room');
      sfx(v ? 'sparkle' : 'page');
      const line = v ? `이제 친구가 내 방을 구경할 수 있어요. 내 방 번호는 ${acct()}번이에요.` : '이제 나만 내 방을 볼 수 있어요.';
      hint(line); say(line, { force: true, priority: 1 });
      return true;
    },
    /** another floor / wall / wood / mood / windows: style({ floor: 'maru' }) */
    async style(patch) {
      if (!S || !ED.active || !patch || typeof patch !== 'object') return false;
      const D = MD(), room = S.room, next = D.cleanStyle({ ...room.style, ...patch });
      if (JSON.stringify(next) === JSON.stringify(room.style)) return true;
      release();
      pushUndo();
      room.style = next;
      // a wall thing that would now hang across a window is taken down (↩️ brings it back)
      let gone = 0;
      for (let k = room.items.length - 1; k >= 0; k--) {
        const it = room.items[k], e = D.items[it.i];
        if (e && e.place === 'W' && D.check(room, it, k).why === 'window') { room.items.splice(k, 1); gone++; }
      }
      await restyle(true);
      changed();
      sfx('sparkle');
      hint(gone ? '창문 자리에 걸려 있던 것은 치웠어요. ↩️ 로 되돌릴 수 있어요.' : '방이 달라졌어요.');
      return true;
    },
    /** show a category of the tray */
    show(cat) { showCat(String(cat)); return ED.cat; },
    /** for tests and guides: a point of the room on the screen, and the thing under a point of the screen */
    screenOf(x, y, z) { return screenOf(num(x, 0), num(y, 0), num(z, 0)); },
    thingAt(px, py) { const hit = pickAt(px, py); return hit ? { index: hit.index, id: hit.held && ED.held ? ED.held.it.i : S.room.items[hit.index]?.i, held: !!hit.held } : null; },
    view(o) { const c = ED.cam; if (o && fin(o.yaw)) c.tYaw = o.yaw; if (o && fin(o.dist)) c.tDist = clamp(o.dist, ZMIN, ZMAX); if (o && o.fit) fitCamera(); if (o && o.snap) { c.yaw = c.tYaw; c.dist = c.tDist; c.pitch = c.tPitch; c.look.copy(c.tLook); } return { yaw: c.tYaw, pitch: c.tPitch, dist: c.tDist, fov: c.fov, look: { x: c.tLook.x, z: c.tLook.z } }; },
    thumbs() { return { made: thumbs.size, waiting: TH.queue.length }; },
  };

  // ================================================================ the system: the door, the right to a room, the place
  /** the button "🎨 방 꾸미기" under the place chip (there while the holder is in the room and not decorating) */
  function syncFab() {
    const host = document.getElementById('hud-top-center');
    if (!host) return;
    let b = sys._fab;
    if (!b) {
      b = sys._fab = h('button', { type: 'button', id: 'myroom-fab', class: 'myroom-fab', hidden: true, dataset: { say: '방 꾸미기. 내 방을 꾸며요.' }, onclick: () => { sfx('click'); EDIT.start(); } },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎨'), h('span', { class: 'mr-l' }, '방 꾸미기'));
      const chip = document.getElementById('place-chip');
      if (chip && chip.parentNode === host) chip.insertAdjacentElement('afterend', b); else host.appendChild(b);
    }
    b.hidden = !(P.is(ID) && !ED.active && !sys._visit && canNow() !== false);
  }
  const sys = {
    name: 'myroom', order: 66, label: '내 방',
    edit: EDIT,
    _visit: null, _back: null, _fab: null, _doorN: 0, _warned: false, _server: null,

    init() {
      const D = MD();
      if (!D) { G.log.warn(CAT, 'myroom: the catalogue (76-myroom-data.js) is missing — no room'); return; }
      const R0 = D.ROOM;
      // the door: the front of 한옥 B_HANOK3 (a little to the side when another place already has its door there)
      let door = P.doorOf('B_HANOK3');
      if (door && P.list().some((p) => p.id !== ID && p.door && Math.hypot(p.door.x - door.x, p.door.z - door.z) < 3.4)) door = P.doorOf('B_HANOK3', { side: 3.6 }) || door;
      P.define({
        id: ID, name: '내 방', kidName: '내 방', emoji: '🏠', color: '#f0c987', desc: '내가 꾸미는 한옥 방',
        origin: { x: R0.origin.x, z: R0.origin.z }, size: { w: R0.w, d: R0.d, h: R0.h }, surface: 'wood', indoor: true,
        spawn: { x: R0.spawn.x, z: R0.spawn.z, rotY: R0.spawn.rotY },
        door: door ? { buildingId: door.buildingId, x: door.x, z: door.z, label: '🏠 내 방 들어가기', kidLabel: '내 방 가기' } : null,
        exit: door ? door.exit : null,
        camera: { dist: 5.6, min: 2.4, max: 8.5, pitch: 0.24, ceil: R0.ceil - 0.25 },
        far: 150, light: () => lightProfile(), minimap: drawPlan, build: buildPlace,
        canEnter: (opts) => sys._gate(opts), exitTo: () => sys._exitTo(),
      });
      G.bus.on('place:enter', (p) => { if (p && p.id === ID) sys._entered(); else syncFab(); });
      G.bus.on('place:exit', (p) => { if (ED.active) EDIT.stop({ silent: true }); if (p && p.id === ID) sys._left(); syncFab(); });
      G.bus.on('easy:changed', () => { if (ED.ui) { ED.ui.actKey = null; uiHeld(); } syncFab(); });
      G.bus.on('entitle:changed', () => { uiCount(); });
      // pictures made before the textures of the asset pack had arrived are made again once
      G.bus.on('pack:idle', (p) => { const n = Number(p && p.decoded) || 0; if (n > TH.decoded) { TH.decoded = n; thumbs.clear(); if (ED.active) showCat(ED.cat); } });
      G.input?.onKey?.('KeyB', () => { if (P.is(ID) && !ED.active && !sys._visit && canNow() !== false) { EDIT.start(); return true; } return false; });
      // a room on its way to the server is not lost with the page: it waits as a draft on this device
      window.addEventListener('pagehide', () => { if (serverMode() && (store.dirty || store.saving)) writeDraft(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && serverMode() && store.dirty) { writeDraft(); saveServer(); } });
    },
    onStateLoaded() { this._reset(); },
    onLogout() { this._reset(); },
    _reset() {
      if (ED.active) EDIT.stop({ silent: true });
      this._visit = null; this._back = null;
      clearTimeout(store.timer);
      Object.assign(store, { busy: null, dirty: false, saving: null, again: false, fails: 0, timer: 0, state: 'ok' });
      store.srv = { loaded: false, can: null, limit: 0, room: null, at: 0 };
      const D = MD();
      if (D && G.state && !serverMode()) G.state.myroom = D.sanitize(G.state.myroom, D.LIMITS.hard);
      syncShown();
      try { syncFab(); } catch (e) { /* HUD not there yet */ }
    },

    // ------------------------------------------------------------ public API
    /** may this player have a room? true | false | null (the server has not been asked yet) */
    can() { return canNow(); },
    /** how many things fit into the room */
    limit() { return limitNow(); },
    /** ask the server again (who has a room, how many things, the room itself) */
    refresh() { return loadServer(true).then((ok) => { syncFab(); return ok; }); },
    /** save now → true when the room is safe (server mode: the server has it) */
    save() {
      if (this._visit) return Promise.resolve(false);
      if (serverMode()) return saveServer();
      G.dirty?.('myroom');
      return Promise.resolve(true);
    },
    state() {
      const D = MD(), room = liveRoom(), srv = serverMode();
      return {
        can: canNow(), mode: srv ? 'server' : 'local', loaded: !srv || store.srv.loaded, editing: ED.active, visiting: !!this._visit,
        count: room.items.length, limit: limitNow(), v: room.v | 0, public: !!room.public, bytes: D.bytes(room), built: !!S,
        dirty: srv ? !!(store.dirty || store.saving) : false, save: srv ? store.state : 'local',
      };
    },
    /** the room that is shown (a copy) */
    room() { return JSON.parse(JSON.stringify(liveRoom())); },
    /** the 3D layer: draw calls of the last frame, triangles of the things, prototypes, batches */
    stats() {
      const info = G.sys.engine?.renderer?.info;
      let tris = 0;
      if (S) for (const i of S.inst) tris += i.proto.tris;
      return { calls: info ? info.render.calls : 0, tris, protos: S ? S.protos.size : 0, batches: S ? S.batches.size + S.artBatches.size : 0, items: S ? S.inst.length : 0, lit: S ? S.lit : 0 };
    },
    /** go into my room (asks the server first when it must; without the right: the kind card, never a silent "no") */
    async enter(opts = {}) {
      if (!G.state || !P.def(ID)) return false;
      if (serverMode()) {
        const stale = !store.srv.loaded || (!store.srv.can && Date.now() - store.srv.at > 20000);
        if (stale) await loadServer(true);
        if (!store.srv.loaded) {
          toast(easyOn() ? '지금은 방에 들어갈 수 없어요. 조금 뒤에 다시 해 봐요!' : '내 방을 불러오지 못했어요. 잠시 뒤에 다시 해 주세요.', { type: 'warn', emoji: '🏠' });
          return false;
        }
        if (!store.srv.can) { this.explain(); return false; }
      }
      if (this._visit) { this._visit = null; syncShown(); }
      if (P.is(ID)) { syncFab(); return true; }
      this._back = opts && opts.back && typeof opts.back === 'object' ? opts.back : null;
      const o = { ...opts, _ok: true };
      delete o.back;
      const ok = await P.enter(ID, o);
      if (!ok) this._back = null;
      return ok;
    },
    /** look at a ready-made room (nothing can be changed there): visit('seonbi' | 'anbang' | 'janchi') */
    async visit(id) {
      const D = MD(), room = D.preset(id || 'anbang');
      if (!room || !G.state || !P.def(ID)) return false;
      if (ED.active) EDIT.stop({ silent: true });
      this._visit = { room, sample: true };
      syncShown();
      const ok = P.is(ID) ? true : await P.enter(ID, { _ok: true });
      if (!ok) { this._visit = null; syncShown(); }
      syncFab();
      return ok;
    },
    /** look at another account's room (server mode): only a room its holder made public — the server answers the
     *  same 404 for every other number. Read-only, nothing is saved; one's own number is one's own room. */
    async visitUser(userId) {
      const n = Number(userId), D = MD();
      if (!serverMode() || !Number.isSafeInteger(n) || n < 1 || !G.state || !P.def(ID)) return false;
      if (String(n) === acct()) return this.enter({});
      let r = null;
      try { r = await G.net.request('api/room/get.php?user=' + n, { timeout: 10000, quiet: true }); }
      catch (e) {
        const gone = e && (e.code === 'NOT_FOUND' || e.status === 404);
        toast(gone ? '그 방은 지금 구경할 수 없어요. 방 번호를 다시 봐 주세요.' : '지금은 그 방을 볼 수 없어요. 조금 뒤에 다시 해 봐요!', { emoji: '👫', type: 'info' });
        say(gone ? '그 방은 지금 구경할 수 없어요. 방 번호를 다시 봐요.' : '지금은 그 방을 볼 수 없어요.', { force: true, priority: 1 });
        return false;
      }
      if (r && r.mine === true) return this.enter({});
      const room = D.sanitize(r && r.room, D.LIMITS.hard);
      if (ED.active) EDIT.stop({ silent: true });
      this._visit = { room, user: n };
      syncShown();
      const ok = P.is(ID) ? true : await P.enter(ID, { _ok: true });
      if (!ok) { this._visit = null; syncShown(); }
      syncFab();
      return ok;
    },
    /**
     * a door to "내 방" somewhere else (the houses of the complex): doorAt({ ctx?, x, z, y = 1.3, rotY = 0, label?,
     * kidLabel?, radius = 3.2, id? }) → the interactable's handle | null. With ctx (a places build context) x / z are
     * that place's local metres and leaving the room leads back to that door; without: world coordinates in the valley.
     * rotY: the way the door faces (the visitor comes back one step in front of it).
     */
    doorAt(spec = {}) {
      if (!spec || !fin(Number(spec.x)) || !fin(Number(spec.z))) return null;
      const ctx = spec.ctx && typeof spec.ctx.interact === 'function' && spec.ctx.def ? spec.ctx : null;
      const x = Number(spec.x), z = Number(spec.z), y = num(spec.y, 1.3), rotY = num(spec.rotY, 0), radius = clamp(num(spec.radius, 3.2), 1.5, 6);
      const id = /^[A-Z][A-Z0-9_]{2,40}$/.test(String(spec.id || '')) ? String(spec.id) : `MYROOM_DOOR_${++this._doorN}`;
      const label = String(spec.label || '🏠 내 방 들어가기').slice(0, 40), kidLabel = String(spec.kidLabel || '내 방 가기').slice(0, 24);
      const fx = x + Math.sin(rotY) * 1.4, fz = z + Math.cos(rotY) * 1.4;
      const go = () => { sys.enter({ back: ctx ? { place: ctx.def.id, spawn: { x: fx, z: fz, rotY } } : { to: { x: fx, z: fz, rotY } } }); };
      const o = { id, kind: 'door', emoji: '🚪', label, kidLabel, radius, priority: 0.6, onInteract: go };
      try {
        if (ctx) return ctx.interact({ ...o, position: { x, y, z } }) || null;
        if (!G.interact?.register) return null;
        return G.interact.register({ ...o, position: new THREE.Vector3(x, y, z), enabled: () => !P.current && !P.busy });
      } catch (e) { G.log.warn(CAT, 'myroom: a door could not be made', e?.message || e); return null; }
    },
    /** the card "내 방": what the room is, who gets one — and a ready-made room to look at meanwhile */
    explain() {
      if (!G.ui?.modal?.open) return false;
      const easy = easyOn(), no = canNow() === false, n = MD().order.length;
      G.ui.modal.open({
        id: 'myroom-explain', title: '내 방', icon: '🏠', className: 'mr-explain',
        body: (el) => {
          el.appendChild(h('div', { class: 'mr-ex' },
            h('div', { class: 'mr-ex-pic emoji', 'aria-hidden': 'true' }, '🏠'),
            h('p', { class: 'mr-ex-lead' }, no ? '내 방은 분양을 받은 분께 드리는 방이에요.' : '내 방은 내가 마음대로 꾸미는 한옥 방이에요.'),
            h('ul', { class: 'mr-ex-list' },
              h('li', null, `🪑 가구와 병풍, 항아리, 꽃, 악기 같은 것 ${n}가지를 골라 놓아요.`),
              h('li', null, '🎨 바닥과 벽, 창문과 빛도 바꿀 수 있어요.'),
              h('li', null, no ? (easy ? '👩‍🏫 선생님이나 어른께 여쭤보면 방을 받을 수 있어요.' : '🏺 분양을 받거나 관리자가 방을 열어 주면 바로 쓸 수 있어요.') : '💾 꾸민 방은 저절로 저장돼요.'))));
        },
        actions: [
          { label: '👀 꾸며 둔 방 구경하기', class: 'btn-primary', close: true, onClick: () => { sys.visit('anbang'); } },
          serverMode() ? { label: '👫 친구 방 구경하기', close: true, onClick: () => { setTimeout(friendPad, 0); } } : null,
          !easy && no && G.sys.allot?.open ? { label: '🏺 분양 알아보기', close: true, onClick: () => { try { G.sys.allot.open('guide'); } catch (e) { /* the allotment screen is optional */ } } } : null,
          { label: '닫기', close: true },
        ].filter(Boolean),
      });
      say(no ? '내 방은 분양을 받으면 생겨요. 먼저 꾸며 둔 방을 구경해 볼까요?' : '내 방은 내가 마음대로 꾸미는 방이에요.', { force: true, priority: 1 });
      return true;
    },

    // ------------------------------------------------------------ hooks of the place
    /** places.enter asks: may the visitor in? (a "no" never stays silent: the server is asked, then the card explains) */
    _gate(opts) {
      if (opts && opts._ok) return true;
      this._back = null;
      if ((opts && opts.quiet) || !serverMode() || (store.srv.loaded && store.srv.can)) { if (this._visit) { this._visit = null; syncShown(); } return true; }
      this.enter(opts || {});
      return false;
    },
    /** places.exit asks: where does the way out lead? (back to the door the visitor came through) */
    _exitTo() {
      const b = this._back;
      this._back = null;
      if (!b) return null;
      if (b.place && P.def(b.place)) return { place: b.place, spawn: b.spawn };
      return b.to ? { to: b.to } : null;
    },
    _entered() {
      syncFab();
      if (this._visit) { toast('구경하는 방이에요. 다 보면 🚪 밖으로 를 눌러요.', { emoji: '👀', type: 'info' }); return; }
      if (!liveRoom().items.length) setTimeout(() => { if (P.is(ID) && !ED.active && !sys._visit) { toast('🎨 방 꾸미기를 누르면 방을 꾸밀 수 있어요.', { emoji: '🏠', type: 'info' }); say('방 꾸미기 그림을 누르면 방을 꾸밀 수 있어요.'); } }, 3600);
    },
    _left() {
      this._back = null;
      if (this._visit) { this._visit = null; syncShown(); }
      if (serverMode() && store.dirty) saveServer();
    },
    _shown() { return liveRoom(); },
    /** test seams (the room must be built): the box a catalogue entry really fills → { min, max, tris, parts, art };
     *  a picture of it as a data URL at `size` pixels */
    _measure(id) {
      if (!S || !MD().items[id]) return null;
      const key = id + '|', had = S.protos.has(key), p = protoOf(id, null), b = p.box;
      const out = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], tris: Math.round(p.tris), parts: Object.keys(p.geo), art: p.art.length };
      if (!had && !S.inst.some((i) => i.proto === p) && !(ED.held && ED.held.proto === p)) { for (const k in p.geo) p.geo[k].dispose(); for (const a of p.art) a.geo.dispose(); S.protos.delete(key); }
      return out;
    },
    /** test seam: is what is drawn the room as its data says? → what is wrong (an empty list: all is well) */
    _audit() {
      if (!S) return ['the room is not built'];
      const out = [], items = S.room.items, D = MD(), H = ED.held, used = new Map();
      if (S.inst.length !== items.length) out.push(`${S.inst.length} drawn things for ${items.length} things of the room`);
      S.inst.forEach((inst, i) => {
        if (inst.it !== items[i]) { out.push(`#${i}: the drawn thing is not thing ${i} of the room`); return; }
        const held = !!H && (H.index === i || H.riders.some((r) => r.index === i));
        if (inst.off !== held) out.push(`#${i} ${inst.it.i}: ${inst.off ? 'hidden but not in the hand' : 'in the hand but still drawn'}`);
        const dm = D.dims(inst.it, inst.e), solid = !inst.off && (inst.e.place === 'F' || inst.e.place === 'T') && (inst.it.y || 0) <= 0.01 && dm.h >= 0.12;
        if (!!inst.col !== solid) out.push(`#${i} ${inst.it.i}: ${inst.col ? 'a collider too many' : 'no collider'}`);
        for (const p of inst.parts) {
          const r = p.r, b = p.b;
          if (r.v0 < 0 || r.v0 + r.vn > b.vn || r.i0 < 0 || r.i0 + r.in > b.in || r.vn !== p.pg.attributes.position.count || r.in !== p.pg.index.count) out.push(`#${i} ${inst.it.i}: its place in ${b.mesh.name} does not fit`);
          if (r.on === inst.off) out.push(`#${i} ${inst.it.i}: ${r.on ? 'drawn' : 'not drawn'} in ${b.mesh.name}`);
          if (!used.has(b)) used.set(b, []);
          used.get(b).push(r);
        }
      });
      for (const [b, list] of used) {
        list.sort((a, c) => a.v0 - c.v0);
        for (let k = 1; k < list.length; k++) if (list[k].v0 < list[k - 1].v0 + list[k - 1].vn) { out.push(`two things share vertices in ${b.mesh.name}`); break; }
        let dead = 0;
        for (const r of list) if (!r.on) dead += r.in;
        // (a thing that changed its shape with its colour leaves its old place behind, hidden: more may be counted than is in use)
        if (dead > b.dead || b.mesh.visible !== b.in > b.dead) out.push(`${b.mesh.name}: ${b.dead} hidden indices counted, ${dead} really hidden`);
      }
      return out;
    },
    async _thumb(id, size) {
      const E = G.sys.engine, r = E?.renderer;
      if (!S || !r || !MD().items[id]) return null;
      for (let k = 0; TH.busy && k < 200; k++) await G.util.nextFrame();
      const keep = TH.size, z = clamp(Math.round(size || keep), 32, 1024);
      const fresh = () => { if (TH.rt) TH.rt.dispose(); TH.scene = TH.cam = TH.rt = TH.holder = null; };
      TH.busy = true;
      let cv = null;
      try {
        if (z !== keep) { fresh(); TH.size = z; }
        cv = await renderThumb(id, r, E);
      } catch (e) { cv = null; } finally {
        if (z !== keep) { fresh(); TH.size = keep; }
        TH.busy = false;
      }
      return cv ? cv.toDataURL('image/png') : null;
    },
    _frame(dt, t) {
      if (!S) return;
      try {
        const sh = S.shell;
        if (sh) for (let i = 0; i < sh.updates.length; i++) sh.updates[i](dt, t);
        if (ED.active) editFrame(dt);
      } catch (e) { if (!this._warned) { this._warned = true; G.log.warn(CAT, 'myroom: a frame of the room failed', e?.message || e); } }
    },
  };
  G.register(sys);
})();
