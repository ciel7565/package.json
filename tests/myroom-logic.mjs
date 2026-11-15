#!/usr/bin/env node
// =============================================================================
// tests/myroom-logic.mjs — 내 방 without a GPU (CONTRACT §17.4)
//
//   node tests/myroom-logic.mjs            (tests/myroom-client.mjs runs it too, as its second Node part)
//
// The REAL fragments run in Node with the real three.js: the building kit (15-buildings.js), the hanok kit
// (19-hanok-kit.js), the catalogue (76-myroom-data.js) and the room itself (75-myroom.js). Only what needs a browser is
// replaced by small stand-ins: the places system (enter / exit / the build context), the UI helpers (elements that
// remember what was put into them), the engine (a real camera, no renderer) and the server (api/room/* in memory).
// So this checks, with no browser at all:
//   · every one of the catalogue's things can be made, is centred on its footprint, stands on the floor (hangs from
//     the ceiling / lies on its wall) and is as big as the catalogue — and with it the server — believes
//   · the edit mode: take, move, turn, raise, size, colour, copy, remove, what stands on a table comes along, red
//     where a thing may not stand, undo / redo, the limit, ready-made rooms, the look of the room, windows
//   · the pointer (follow and put down, drag, tap to move, pinch) and the keys, with real camera rays
//   · that what is drawn is always the room as its data says (G.sys.myroom._audit after every step)
//   · the server side of the app: asking, the kind card without a room, saving with the version, a draft while the
//     network is away, an answer that got lost, a room changed elsewhere, the right taken back
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** the room's world in Node: the real fragments + the stand-ins → what a test needs to drive it (throws when it cannot be made) */
export async function makeRoomWorld(ROOT) {
  const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const BGU = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js')).href);

  // ---------------------------------------------------------------- stand-ins
  const warns = [], toasts = [], modals = [], picks = [], confirms = [], dirty = [], indoor = [], interacts = [], exitDoors = [], escapes = [];
  const answers = { pick: null, confirm: true };
  const blockers = new Set(), colliders = new Map(), win = {}, keysDown = {}, store = new Map(), timers = [], bus = {};
  let cid = 0;
  const els = [];
  class El {
    constructor(tag) { this.tag = String(tag).toLowerCase(); this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.on = {}; this.hidden = false; this.disabled = false; this.cls = new Set(); this.parentNode = null; this._t = ''; this.rect = null; els.push(this); }
    get classList() { const s = this.cls; return { add: (...a) => a.forEach((x) => s.add(x)), remove: (...a) => a.forEach((x) => s.delete(x)), toggle: (c, v) => { const on = v === undefined ? !s.has(c) : !!v; if (on) s.add(c); else s.delete(c); return on; }, contains: (c) => s.has(c) }; }
    set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.cls].join(' '); }
    appendChild(c) { if (c && typeof c === 'object') { c.parentNode = this; this.children.push(c); } return c; }
    insertAdjacentElement(_, c) { if (this.parentNode) this.parentNode.appendChild(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    removeEventListener() {}
    fire(t, e) { for (const f of this.on[t] || []) f({ type: t, target: this, preventDefault() {}, stopPropagation() {}, ...e }); }
    all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
    is(sel) { const m = /^([a-z]+)?(?:\.([\w-]+))?(?:\[([\w-]+)="([^"]*)"\])?$/.exec(sel); if (!m) return false; const [, tag, cls, attr, val] = m; if (tag && this.tag !== tag) return false; if (cls && !this.cls.has(cls)) return false; if (attr) { const got = attr.indexOf('data-') === 0 ? this.dataset[attr.slice(5)] : this.getAttribute(attr); if (String(got) !== val) return false; } return true; }
    querySelectorAll(sel) { return this.all().filter((e) => e.is(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = document.body; }
    contains(o) { return o === this || this.all().includes(o); }
    closest(sel) { for (let n = this; n; n = n.parentNode) if (n.is && n.is(sel)) return n; return null; }
    matches(sel) { return this.is(sel); }
    scrollIntoView() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    set textContent(v) { this._t = String(v == null ? '' : v); this.children = []; }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    get firstChild() { return this.children[0] || null; }
    get lastChild() { return this.children[this.children.length - 1] || null; }
    click() { this.fire('click', { detail: 0 }); }
  }
  const h = (tag, props, ...kids) => {
    const el = new El(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && v && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'hidden' || k === 'disabled' || k === 'id') el[k] = v;
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const c of kids.flat(3)) { if (c == null || c === false) continue; if (typeof c === 'object') el.appendChild(c); else el._t += String(c); }
    if (el.cls.has('mr-top')) el.rect = { left: 8, top: 8, right: 1272, bottom: 72, width: 1264, height: 64 };
    if (el.cls.has('mr-tray')) el.rect = { left: 8, top: 520, right: 1272, bottom: 712, width: 1264, height: 192 };
    return el;
  };
  const body = new El('body'), hudTop = new El('div');
  const document = { body, activeElement: body, getElementById: (id) => (id === 'hud-top-center' ? hudTop : els.find((e) => e.id === id && (e.parentNode || e === body)) || null), createElement: (t) => new El(t), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible' };
  const window = { addEventListener: (t, f) => { (win[t] = win[t] || []).push(f); }, removeEventListener: (t, f) => { win[t] = (win[t] || []).filter((x) => x !== f); }, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  const fakeSetTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const fakeClearTimeout = (id) => { if (id > 0 && timers[id - 1]) timers[id - 1] = null; };
  /** an object that says yes to everything (the parts of the app the kits only touch in passing: textures, the asset pack) */
  const any = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined : k === 'length' ? 0 : (k in t ? t[k] : (t[k] = any()))),
    apply: () => any(), construct: () => any(), set: (t, k, v) => { t[k] = v; return true; }, has: () => true,
  });
  const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : /ImageData$/.test(String(k)) ? (a, b, c, d) => { const w = c || a, hh = d || b; return { data: new Uint8ClampedArray(Math.max(4, w * hh * 4)), width: w, height: hh }; } : /^create.*(Gradient|Pattern)$/.test(String(k)) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const kitDocument = { createElement: (t) => (t === 'canvas' ? { width: 256, height: 256, style: {}, getContext() { return this._c || (this._c = ctx2d()); }, toDataURL: () => 'data:,', addEventListener() {} } : new El(t)), body, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  // the app's own seeded random numbers (00-core.js: rng + hashInt, taken from the source so that things with a random
  // shape — plants, piled fruit, firewood — come out exactly as they do in the app)
  const core = fs.readFileSync(path.join(ROOT, 'src/game/00-core.js'), 'utf8');
  const method = (name) => { const i = core.indexOf(`\n  ${name}(`); const j = core.indexOf('\n  },', i); if (i < 0 || j < 0) throw new Error(`00-core.js: ${name}() not found`); return core.slice(i + 1, j + 4); };
  const coreUtil = vm.runInThisContext(`(function (G) { const u = {${method('rng')},\n${method('hashInt')}\n}; G.util = u; return u; })`)({});
  const mulberry = (seed) => coreUtil.rng(seed);
  // the artworks of the asset pack as the full build has them (sizes from assets/pack/MANIFEST.json; a blank texture)
  const artMeta = new Map();
  try { for (const f of JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/pack/MANIFEST.json'), 'utf8')).files || []) if (f && String(f.name).indexOf('art/') === 0) artMeta.set(f.name, f); } catch (e) { /* a checkout without the pack: scrolls and screens are made blank */ }

  const cam = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 500);
  const srv = { can: false, limit: 80, room: { v: 0, style: {}, items: [], public: false }, calls: [], offline: 0, gets: 0, loseAnswer: false, others: {} };
  const err = (code, status) => Object.assign(new Error(code), { code, status });
  const Gb = {
    data: { layout: {} }, sys: {}, settings: { reduceMotion: true, easyMode: false }, params: new URLSearchParams(''), state: null,
    util: { rng: coreUtil.rng, hashInt: coreUtil.hashInt, clamp: (v, a, b) => (v < a ? a : v > b ? b : v), lerp: (a, b, t) => a + (b - a) * t, isTyping: () => false, nextFrame: () => Promise.resolve() },
    log: { warn: (...a) => warns.push(a.map(String).join(' ')), error: (...a) => warns.push('ERROR ' + a.map(String).join(' ')), info() {}, debug() {} },
    register(s) { Gb.sys[s.name] = s; },
    bus: { on: (t, f) => { (bus[t] = bus[t] || []).push(f); }, emit: (t, p) => { for (const f of bus[t] || []) f(p); }, off() {} },
    dirty: (k) => { dirty.push(k); }, sfx: () => {},
    easy: { on: false, say() {}, pick: async (o) => { picks.push(o); return answers.pick; }, confirm: async (o) => { confirms.push(o); return answers.confirm; } },
    net: { mode: 'local', request: async (p, o = {}) => {
      srv.calls.push({ path: p.replace(/^.*api\/room\//, ''), body: o.body ? JSON.parse(JSON.stringify(o.body)) : null });
      const um = /get\.php\?user=(\d+)$/.exec(p);
      if (um) { const o2 = srv.others[um[1]]; if (!o2 || !o2.public) throw err('NOT_FOUND', 404); return { room: JSON.parse(JSON.stringify(o2)), mine: false, can: false, limit: 0 }; }
      if (/get\.php/.test(p)) { srv.gets++; return { room: JSON.parse(JSON.stringify(srv.room)), mine: true, can: srv.can, limit: srv.can ? srv.limit : 0 }; }
      if (srv.offline > 0) { srv.offline--; throw err('NETWORK_ERROR'); }
      if (!srv.can) throw err('ROOM_FORBIDDEN', 403);
      if (o.body.v !== srv.room.v) throw err('ROOM_STALE', 409);
      srv.room = { v: srv.room.v + 1, style: o.body.style, items: JSON.parse(JSON.stringify(o.body.items)), public: !!o.body.public };
      if (srv.loseAnswer) { srv.loseAnswer = false; throw err('TIMEOUT'); }
      return { v: srv.room.v };
    } },
    auth: { current: { id: 7, kind: 'local' } },
    ui: {
      h, toast: (m) => { toasts.push(String(m)); },
      modal: { open(o) { const el = new El('div'); modals.push({ o, el }); if (typeof o.body === 'function') o.body(el); else if (o.body) el.appendChild(o.body); return { close() {}, el }; }, closeAll() {}, isOpen: () => false },
      block: (k) => { blockers.add(k); }, unblock: (k) => { blockers.delete(k); }, isBlocking: () => blockers.size > 0, onEscape: (fn) => { escapes.push(fn); return () => {}; },
      fadeThrough: async (fn) => { await fn(); }, popover: { close() {} },
    },
    input: { onKey: (code, fn) => { keysDown[code] = fn; }, mouseLook: { release() {} } },
    pack: { has: (n) => artMeta.has(n), usable: (n) => artMeta.has(n), meta: (n) => artMeta.get(n) || null, texture: () => new THREE.Texture() },
    world: { addCollider: (c) => { colliders.set(++cid, c); return cid; }, removeCollider: (id) => { colliders.delete(id); }, nightFactor: () => 0 },
  };
  const G = new Proxy(Gb, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : (t[k] = any())) });
  Gb.sys.engine = { camera: cam, renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }, info: { render: { calls: 0, frame: 0 } } }, setIndoor: (p) => { indoor.push(p); }, frameInfo: { calls: 0, triangles: 0 }, scene: { environment: null }, quality: 'medium', indoor: 1 };
  Gb.sys.camera = { mode: 'follow', shot(pos, look, o) { this.mode = 'shot'; cam.position.copy(pos); if (o && o.fov) cam.fov = o.fov; cam.updateProjectionMatrix(); cam.lookAt(look); cam.updateMatrixWorld(true); }, setMode(m) { this.mode = m; } };
  Gb.sys.player = { position: new THREE.Vector3(), _ready: true, teleport(x, z) { this.position.set(x, 0, z); return Promise.resolve(); }, cancelWalk() {} };
  // the places system: definitions, one built place at a time, the hooks canEnter / exitTo of 18-places.js
  const P = Gb.sys.places = {
    _defs: new Map(), _cur: null, _live: null, ctx: null, updates: [], lastExit: null, busy: false,
    define(d) { const def = { ...d, floorY: 0 }; this._defs.set(d.id, def); return def; },
    def(id) { return this._defs.get(id) || null; },
    doorOf(b) { return { buildingId: b, x: 40, z: 60, exit: { x: 40, z: 61.4, rotY: 0 } }; },
    list() { return [...this._defs.values()].map((d) => ({ id: d.id, door: d.door })); },
    is(id) { return this._cur === id; },
    get current() { return this._cur; },
    async enter(id, opts = {}) {
      const def = this._defs.get(id);
      if (!def) return false;
      if (this._cur === id) return true;
      if (typeof def.canEnter === 'function' && def.canEnter(opts) === false) return false;
      const group = new THREE.Group();
      group.position.set(def.origin.x, 0, def.origin.z);
      this.updates = [];
      const self = this;
      const base = {
        id: def.id, def, place: def, group, size: def.size, origin: def.origin, floorY: 0, low: false, quality: 'medium', preset: { shadows: true },
        own: (x) => x, anchor() {}, board: () => any(), lightCount: 0,
        light: (cfg) => ({ cfg: { ...cfg, color: new THREE.Color(cfg && cfg.color ? cfg.color : '#ffffff') }, light: null, set() {} }),
        addCollider: (c) => Gb.world.addCollider(c), exitDoor: (o) => { exitDoors.push(o); return {}; },
        onUpdate: (fn) => { self.updates.push(fn); }, interact: (o) => { interacts.push(o); return { unregister() {} }; },
      };
      this.ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : (t[k] = any())) });
      this._cur = id;
      this._live = def.build(this.ctx);
      group.updateMatrixWorld(true);
      Gb.bus.emit('place:enter', { id, prev: null, opts });
      return true;
    },
    async exit(opts = {}) {
      if (!this._cur) return false;
      const id = this._cur, def = this._defs.get(id);
      let t = null;
      try { t = typeof def.exitTo === 'function' ? def.exitTo(opts) : null; } catch (e) { t = null; }
      Gb.bus.emit('place:exit', { id, to: t });
      if (this._live && this._live.dispose) this._live.dispose();
      for (const k of [...colliders.keys()]) colliders.delete(k);
      this._cur = null; this._live = null; this.lastExit = t;
      return true;
    },
  };
  const tick = (n = 1) => { for (let k = 0; k < n; k++) { for (const fn of P.updates) fn(0.016, k * 0.016); if (P.ctx) P.ctx.group.updateMatrixWorld(true); } };
  const flush = async () => { const due = timers.splice(0); for (const t of due) if (t) await t.fn(); await Promise.resolve(); };

  // ---------------------------------------------------------------- the real fragments
  const ADDONS = { BufferGeometryUtils: BGU };
  const load = (file, doc, st, ct) => {
    const src = fs.readFileSync(path.join(ROOT, 'src/game', file), 'utf8');
    vm.runInThisContext(`(function (THREE, ADDONS, G, document, window, navigator, performance, requestAnimationFrame, localStorage, Image, setTimeout, clearTimeout) {\n${src}\n})`, { filename: file })(
      THREE, ADDONS, G, doc, window, { userAgent: 'node' }, performance, (f) => setTimeout(f, 16), localStorage, function () {}, st, ct);
  };
  load('15-buildings.js', kitDocument, setTimeout, clearTimeout);
  load('19-hanok-kit.js', kitDocument, setTimeout, clearTimeout);
  load('76-myroom-data.js', kitDocument, setTimeout, clearTimeout);
  load('75-myroom.js', document, fakeSetTimeout, fakeClearTimeout);
  return { THREE, Gb, P, cam, srv, els, body, win, store, timers, warns, toasts, modals, picks, confirms, dirty, indoor, interacts, exitDoors, answers, blockers, colliders, tick, flush, mulberry };
}

export async function roomLogic({ check, log, ROOT }) {
  let W;
  try { W = await makeRoomWorld(ROOT); }
  catch (e) { check('the building kit, the hanok kit, the catalogue and the room load in Node with the real three.js (npm install)', false, String(e.stack || e).slice(0, 400)); return; }
  const { THREE, Gb, P, srv, els, body, win, store, timers, warns, toasts, modals, picks, confirms, dirty, indoor, interacts, exitDoors, answers, blockers, colliders, tick, flush, mulberry } = W;
  const D = Gb.data.myroom, M = Gb.sys.myroom, K = Gb.hanok;
  check('the building kit, the hanok kit, the catalogue and the room load in Node with the real three.js', !!Gb.bkit && !!K && typeof K.room === 'function' && !!D && !!M && typeof M.init === 'function', `three r${THREE.REVISION}`);
  if (!M) return;
  const E = M.edit;
  const audit = () => M._audit();
  const norm = (items) => JSON.stringify((items || []).map((it) => [it.i, it.x, it.y || 0, it.z, it.r, it.s ?? 1, it.c ?? -1]));
  const items = () => M.room().items;
  const stage = () => els.filter((e) => e.cls.has('mr-stage')).pop();
  const ptr = (type, id, p, kind = 'mouse', button = 0) => stage().fire(type, { pointerId: id, pointerType: kind, clientX: p.x, clientY: p.y, button });
  const key = (code, o = {}) => { for (const f of win.keydown || []) f({ code, shiftKey: !!o.shift, ctrlKey: !!o.ctrl, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} }); };
  const part = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to its end`, false, String(e.stack || e).slice(0, 460)); } };

  // ---------------------------------------------------------------- the place
  log('— the room without a GPU (Node, real kits and three.js)');
  await part('the place', async () => {
    Gb.state = {};
    M.init();
    M.onStateLoaded();
    const def = P.def('PL_MYROOM');
    check('init: the place PL_MYROOM is defined with its door on the hanok, the hooks canEnter / exitTo, a light profile and a plan for the minimap', !!def && !!def.door && def.door.kidLabel === '내 방 가기' && typeof def.canEnter === 'function' && typeof def.exitTo === 'function' && typeof def.light === 'function' && typeof def.minimap === 'function' && def.size.w === 14 && def.size.d === 11, JSON.stringify(def && def.door));
    const ok = await M.enter();
    tick(2);
    const st = M.state(), shellColliders = colliders.size;
    check('entering builds the room: a hanok shell with a way out, the stand where decorating starts, walls that stop the player — and no thing yet', ok === true && P.current === 'PL_MYROOM' && st.built && st.mode === 'local' && st.can === true && st.limit === 80 && M.stats().items === 0 && exitDoors.length === 1 && interacts.some((i) => i.id === 'MYROOM_EDIT') && shellColliders >= 4 && !audit().length && typeof def.light() === 'object', JSON.stringify({ st, exits: exitDoors.length, shellColliders, audit: audit() }));
  });

  // ---------------------------------------------------------------- every thing of the catalogue, as it is really made
  await part('the catalogue as it is made', async () => {
    const off = [], broken = [], uncentred = [], heavy = [];
    let tris = 0, parts = 0;
    for (const id of D.order) {
      const e = D.items[id];
      let m = null;
      try { m = M._measure(id); } catch (err2) { broken.push(`${id}: ${String(err2.message || err2).slice(0, 60)}`); continue; }
      if (!m || !(m.parts.length + m.art) || !m.tris) { broken.push(`${id}: nothing was made`); continue; }
      tris += m.tris; parts += m.parts.length + m.art;
      if (m.tris > 9000) heavy.push(`${id} ${m.tris}`);
      const w = m.max[0] - m.min[0], hh = m.max[1] - m.min[1], d = m.max[2] - m.min[2];
      const tol = 0.021;
      if (Math.abs(w - e.fp[0]) > tol || Math.abs(d - e.fp[1]) > tol || Math.abs(hh - e.fp[2]) > tol) off.push(`${id} is ${w.toFixed(2)}×${d.toFixed(2)}×${hh.toFixed(2)}, the catalogue says ${e.fp.join('×')}`);
      const cx = Math.abs(m.min[0] + m.max[0]) / 2, cz = Math.abs(m.min[2] + m.max[2]) / 2;
      const stands = e.place === 'W' ? Math.abs(m.min[1] + m.max[1]) / 2 < 0.002 && cx < 0.002 : e.place === 'H' ? Math.abs(m.max[1]) < 0.002 && cx < 0.002 && cz < 0.002 : Math.abs(m.min[1]) < 0.002 && cx < 0.002 && cz < 0.002;
      if (!stands) uncentred.push(id);
    }
    check(`every one of the ${D.order.length} things can be made by its generator (real geometry: ${Math.round(tris).toLocaleString('en')} triangles in all, none above 9,000)`, !broken.length && !heavy.length, [...broken, ...heavy].slice(0, 8).join(' · '));
    check('every thing is as big as the catalogue says (± 2 cm) — the footprint the rules and the server check is the real one', !off.length, `${off.length} differ: ${off.slice(0, 40).join(" · ")}`);
    check('every thing is drawn round the middle of its footprint and stands on the floor (hangs from the ceiling, lies on its wall)', !uncentred.length, uncentred.slice(0, 12).join(' '));
    const noMake = warns.filter((x) => /could not be made|no generator|could not be merged/.test(x));
    check('no generator complained while the catalogue was made', !noMake.length, noMake.slice(0, 4).join(' | '));
  });

  // ---------------------------------------------------------------- decorating through the API
  await part('decorating', async () => {
    const started = E.start();
    tick(2);
    check('the edit mode starts: the world is blocked, the HUD class is set, the camera is the edit camera, the player waits by the door, the light is the bright decorating light', started === true && E.active && blockers.has('myroom-edit') && body.cls.has('hud-hidden') && Gb.sys.camera.mode === 'shot' && Math.abs(Gb.sys.player.position.z - (P.def('PL_MYROOM').origin.z + D.ROOM.spawn.z)) < 1e-6 && indoor.length >= 1 && indoor[indoor.length - 1].hemi.intensity >= 1.05, JSON.stringify({ started, mode: Gb.sys.camera.mode, indoor: indoor.length }));
    // a new thing stands in the room at once; every allowed change is kept at once
    const r = {};
    r.pick = E.pick('F_BANDAJI'); r.n1 = items().length; r.held = E.held;
    r.to = E.to(2, -3); r.turn = [E.turn(1), E.turn(1), E.turn(-1)]; r.afterTurn = items()[0].r;
    E.turn(-1);
    r.col = await E.colour(2); r.c = items()[0].c;
    r.copy = E.copy(); r.n2 = items().length; r.copyHeld = E.held;
    check('a new thing stands in the room at once; moving, turning (15° steps), a colour and a copy are each kept as they are made', r.pick && r.n1 === 1 && r.held.index === 0 && r.held.ok && r.to === true && r.afterTurn === 1 && r.col === true && r.c === 2 && r.copy === true && r.n2 === 2 && r.copyHeld.index === 1 && items()[1].c === 2 && (items()[1].x !== 2 || items()[1].z !== -3) && E.undoCount === 8 && !audit().length, JSON.stringify({ r, undo: E.undoCount, audit: audit() }));
    // a small thing on the table, sizes, the table takes it along
    const topY = D.items.F_BANDAJI.top[2];
    E.place();
    r.jar = E.pick('J_DANJI', { near: { x: 2, z: -3 } });
    r.onTop = E.to(2, -3); r.jarY = items()[2].y;
    r.sizes = [E.size(0), items()[2].s, E.size(0), items()[2].s, E.size(0), items()[2].s];
    E.place(); E.select(0);
    r.riders = E.held.riders; r.move = E.to(-4.5, 1);
    check('a small thing put where a table stands rests on its top; 크기 goes large → small → normal; the table takes along what stands on it', r.jar && r.onTop === true && Math.abs(r.jarY - topY) < 1e-9 && r.sizes[1] === 2 && r.sizes[3] === 0 && r.sizes[5] === undefined && r.riders === 1 && r.move === true && items()[2].x === -4.5 && items()[2].z === 1 && Math.abs(items()[2].y - topY) < 1e-9 && !audit().length, JSON.stringify({ r, jar: items()[2], audit: audit() }));
    // a wall thing
    E.place();
    r.fan = E.pick('W_FAN'); const f0 = { ...items()[3] };
    r.fanTo = E.to({ side: 'N', u: 9.75, v: 1.5 }); const f1 = { ...items()[3] };
    r.raise = [E.raise(1), E.raise(1), E.raise(-1)]; r.raised = items()[3].y; r.noTurn = E.turn(1);
    r.post = E.to({ side: 'N', u: 2.8, v: 1.5 }); const f2 = { ...items()[3] };
    r.window = [E.to({ side: 'E', u: 4.125, v: 1.5 }), E.held.why];
    r.wback = E.place();
    check('a wall thing lies on its wall at the height asked for, goes up and down in 5 cm steps, cannot be turned, slides into a bay at a post, is red over a window and goes back when let go', r.fan && D.check({ ...M.room(), items: [] }, f0, -1).ok && r.fanTo && f1.x === 2.75 && f1.z === -5.5 && f1.y === 1.5 && f1.r === 0 && Math.abs(r.raised - 1.55) < 1e-9 && r.noTurn === false && r.post === true && Math.abs(f2.x + 7 - 2.8) >= D.items.W_FAN.fp[0] / 2 - 1e-6 && r.window[0] === false && r.window[1] === 'window' && r.wback === false && items()[3].x === f2.x && !audit().length, JSON.stringify({ f0, f1, f2, r, audit: audit() }));
    // red: the way to the door, another thing; letting go; the wall keeps a thing inside
    r.soban = E.pick('F_SOBAN'); const stood = { ...items()[4] };
    r.door = [E.to(0, 4), E.held.ok, E.held.why]; r.hintBad = els.filter((e) => e.cls.has('mr-hint')).pop().cls.has('bad');
    r.hit = [E.to(-4.5, 1), E.held.why]; r.kept = norm([items()[4]]) === norm([stood]);
    r.place = E.place(); r.back = norm([items()[4]]) === norm([stood]);
    E.select(4); r.edge = [E.to(40, 40), E.held.x, E.held.z]; E.remove();
    check('red before the door and on another thing (the room keeps the thing where it stood, letting go puts it back); pushed past the wall a thing stops at the wall', r.soban && r.door[0] === false && r.door[2] === 'door' && r.hintBad && r.hit[1] === 'hit' && r.kept && r.place === false && r.back && r.edge[0] === true && Math.abs(r.edge[1]) < 7 && Math.abs(r.edge[2]) < 5.5 && items().length === 4 && !audit().length, JSON.stringify({ r, audit: audit() }));
    // remove with what stands on it; undo / redo; the list holds 20
    const before = items();
    E.select(0); r.rm = E.remove(); const afterRm = items().map((it) => it.i).join();
    r.u = E.undo(); const u1 = items(); r.re = E.redo(); const r1 = items().map((it) => it.i).join(); E.undo();
    const stack = E.undoCount;
    let n = 0; while (E.undo() && n++ < 40);
    const zero = { n: items().length, undo: E.undoCount, redo: E.redoCount, audit: audit() };
    n = 0; while (E.redo() && n++ < 40);
    const redone = { items: items().map((it) => it.i).join(), redo: E.redoCount, undo: E.undoCount };
    E.undo();                                               // (the last step done again was the 치우기: one back is the room with its table)
    check('치우기 takes a table with what stands on it; ↩️ / ↪️ bring it back and take it again; the last 20 steps can be undone one by one and all of them done again', r.rm && afterRm === 'F_BANDAJI,W_FAN' && norm(u1) === norm(before) && r1 === 'F_BANDAJI,W_FAN' && stack === 19 && zero.undo === 0 && zero.redo === 20 && zero.n < before.length && !zero.audit.length && redone.items === 'F_BANDAJI,W_FAN' && redone.redo === 0 && redone.undo === 20 && norm(items()) === norm(before) && !audit().length, JSON.stringify({ afterRm, stack, zero, redone, now: items().length, audit: audit() }));
    // the limit
    Gb.sys.entitle = { has: () => true, limit: (k2) => (k2 === 'roomItems' ? 5 : undefined) };
    E.place();
    const l = { limit: M.limit(), a: E.pick('G_GONGGI'), n: (E.place(), items().length), b: E.pick('G_GONGGI'), copy: (E.select(0), E.copy()), n2: items().length };
    delete Gb.sys.entitle;
    E.place(); E.select(4); E.remove();
    check('the limit: a sixth thing and a copy are refused with a kind line when five are allowed', l.limit === 5 && l.a === true && l.n === 5 && l.b === false && l.copy === false && l.n2 === 5 && toasts.some((t) => /가득/.test(t)) && M.limit() === 80 && items().length === 4, JSON.stringify(l));
  });

  // ---------------------------------------------------------------- the pointer and the keys (real camera rays)
  await part('pointer and keys', async () => {
    tick(2);
    const corners = [[-7, 0, -5.5], [7, 0, -5.5], [-7, 0, 5.5], [7, 0, 5.5]].map((p) => E.screenOf(...p));
    check('the view from above: the whole floor lies between the top bar (72 px) and the tray (520 px) of a 1280 × 720 screen', corners.every((p) => p.front && p.x >= 0 && p.x <= 1280 && p.y >= 72 && p.y <= 520), JSON.stringify(corners.map((p) => [Math.round(p.x), Math.round(p.y)])));
    E.place();
    const n0 = items().length;
    // with a mouse the picture follows the pointer until the click that puts it down
    E.pick('F_SOBAN', { follow: true });
    const p1 = E.screenOf(3, 0, 2);
    ptr('pointermove', 1, p1); tick(1);
    const follow = { n: items().length, held: E.held };
    ptr('pointerdown', 1, p1); ptr('pointerup', 1, p1);
    const put = items()[n0];
    check('mouse: a taken picture follows the pointer (not yet in the room) and the click puts it there, on the 0.25 m grid', follow.n === n0 && follow.held.follow && follow.held.x === 3 && follow.held.z === 2 && !!put && put.i === 'F_SOBAN' && put.x === 3 && put.z === 2 && E.held.index === n0 && !E.held.follow && !audit().length, JSON.stringify({ follow, put, audit: audit() }));
    // drag: the point that was grabbed stays under the pointer
    const a = E.screenOf(3, 0.15, 2), b = E.screenOf(5, 0.15, 0.5), undo0 = E.undoCount;
    ptr('pointerdown', 1, a);
    for (let k = 1; k <= 6; k++) ptr('pointermove', 1, { x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 });
    ptr('pointerup', 1, b);
    const dragged = items()[n0];
    check('mouse: a drag moves the thing by what the pointer moved (one step to undo)', Math.abs(dragged.x - 5) <= 0.26 && Math.abs(dragged.z - 0.5) <= 0.26 && E.undoCount === Math.min(20, undo0 + 1) && !audit().length, JSON.stringify({ dragged, undo: [undo0, E.undoCount] }));
    // a tap on another thing takes that one; a tap on a free spot moves the thing in the hand there
    const other = items()[1], po = E.screenOf(other.x, 0.4, other.z);
    ptr('pointerdown', 2, po, 'touch'); ptr('pointerup', 2, po, 'touch');
    const took = E.held && E.held.index;
    const free = E.screenOf(-2, 0, -4);
    ptr('pointerdown', 2, free, 'touch'); ptr('pointerup', 2, free, 'touch');
    check('touch: a tap on a thing takes it into the hand; a tap on a free spot moves it there (dragging is never the only way)', took === 1 && items()[1].x === -2 && items()[1].z === -4 && !audit().length, JSON.stringify({ took, now: items()[1] }));
    // two fingers
    const d0 = E.view().dist;
    ptr('pointerdown', 11, { x: 560, y: 300 }, 'touch'); ptr('pointerdown', 12, { x: 720, y: 300 }, 'touch');
    for (let k = 1; k <= 5; k++) { ptr('pointermove', 11, { x: 560 - k * 30, y: 300 }, 'touch'); ptr('pointermove', 12, { x: 720 + k * 30, y: 300 }, 'touch'); }
    ptr('pointerup', 11, { x: 410, y: 300 }, 'touch'); ptr('pointerup', 12, { x: 870, y: 300 }, 'touch');
    check('touch: two fingers moving apart bring the room closer; the things stay where they are', E.view().dist < d0 * 0.6 && items()[1].x === -2 && !audit().length, JSON.stringify({ d0, d1: E.view().dist }));
    key('Digit0'); tick(2);
    // the keys
    E.place(); E.select(n0);
    const k0 = { ...items()[n0] };
    key('ArrowRight'); key('ArrowRight'); key('ArrowUp');
    const k1 = { ...items()[n0] };
    key('KeyR'); key('KeyR'); key('KeyR', { shift: true });
    const k2 = { ...items()[n0] };
    key('Enter'); const loose = E.held;
    key('KeyN'); const first = E.held && E.held.index; key('KeyN', { shift: true }); const last = E.held && E.held.index;
    key('Delete'); const gone = items().length; key('KeyZ'); const back = items().length; key('KeyY');
    const z0 = E.view().dist; key('Equal'); const z1 = E.view().dist; key('Minus'); key('KeyE'); const yaw = E.view().yaw; key('KeyQ');
    check('keys: the arrows move the thing one grid step (right, right, away), R / Shift+R turn it, Enter lets go, N / Shift+N go through the things, Delete removes, Z / Y undo and redo, + zooms, E / Q turn the view', Math.abs(k1.x - (k0.x + 0.5)) < 1e-9 && Math.abs(k1.z - (k0.z - 0.25)) < 1e-9 && k2.r === (k0.r + 1) % 24 && loose === null && first === 0 && last === n0 && gone === n0 && back === n0 + 1 && items().length === n0 && z1 < z0 && Math.abs(yaw - Math.PI / 2) < 1e-9 && E.view().yaw === 0 && !audit().length, JSON.stringify({ k0, k1, r: k2.r, first, last, gone, back, z0, z1, yaw, audit: audit() }));
    // turned a quarter, "right" on the screen is another way in the room
    E.select(1); const q0 = { ...items()[1] }; key('KeyE'); key('ArrowRight'); const q1 = { ...items()[1] }; key('KeyQ'); E.place();
    check('keys: after the view was turned a quarter the arrows still move the thing the way it looks on the screen', (q1.x !== q0.x) !== (q1.z !== q0.z) && Math.abs(q1.x - q0.x) + Math.abs(q1.z - q0.z) === 0.25, JSON.stringify({ q0, q1 }));
  });

  // ---------------------------------------------------------------- ready-made rooms, the look, leaving
  await part('ready-made rooms and the look of the room', async () => {
    answers.confirm = false;
    const no = await E.preset('anbang'), kept = items().length;
    answers.confirm = true;
    const yes = await E.preset('anbang');
    check('a ready-made room asks first when the room is not empty ("그대로 둘래요" keeps it); with "바꿀래요" the room is replaced', no === false && kept === 4 && yes === true && confirms.length === 2 && /바꿀까요/.test(confirms[0].title) && items().length === D.preset('anbang').items.length && M.room().style.wall === 'clay' && !audit().length, JSON.stringify({ no, kept, yes, n: items().length, audit: audit() }));
    const meshes = {};
    for (const p of D.presets) {
      await E.preset(p.id, { force: true });
      tick(1);
      let n = 0, tri = 0;
      P.ctx.group.traverse((o) => { if (o.isMesh && o.visible) { n++; const g = o.geometry; tri += (g.drawRange && Number.isFinite(g.drawRange.count) ? Math.min(g.drawRange.count, g.index ? g.index.count : 0) : g.index ? g.index.count : 0) / 3; } });
      meshes[p.id] = { things: items().length, meshes: n, batches: M.stats().batches, tris: Math.round(tri), audit: audit().length, lit: M.stats().lit };
    }
    check('the three ready-made rooms are drawn as their data says: each thing once, one mesh per material however many things there are', D.presets.every((p) => meshes[p.id].things === D.preset(p.id).items.length && meshes[p.id].audit === 0 && meshes[p.id].batches <= 30 && meshes[p.id].meshes <= 90), JSON.stringify(meshes));
    answers.pick = 'stone';
    const els0 = els.length;
    const picked = await (async () => { const t = els.filter((e) => e.dataset.do === 'style:floor').pop(); if (!t) { E.show('room'); } const tile2 = els.filter((e) => e.dataset.do === 'style:floor').pop(); els.filter((e) => e.cls.has('mr-tiles')).pop().fire('click', { target: tile2, detail: 1, pointerType: 'mouse' }); await Promise.resolve(); await Promise.resolve(); await flush(); return M.room().style.floor; })();
    check('방 모양: the tile 바닥 asks with pictures (four floors) and the chosen one is laid', picked === 'stone' && picks.length >= 1 && picks[picks.length - 1].items.length === 4 && els.length > els0 - 1, JSON.stringify({ picked, picks: picks.length }));
    await E.preset('seonbi', { force: true });
    const n0 = items().length, north = items().filter((it) => it.z === -5.5).length;
    await E.style({ win: '666660660100010000' });
    const hint = els.filter((e) => e.cls.has('mr-hint')).pop().textContent;
    check('a wall that becomes windows gives up what hung there, and ↩️ brings it back', north >= 1 && items().length === n0 - north && /창문/.test(hint) && E.undo() === true && items().length === n0 && !audit().length, JSON.stringify({ n0, north, now: items().length, hint }));
    await E.reset({ force: true });
    const emptied = items().length === 0 && JSON.stringify(M.room().style) === JSON.stringify(D.DEFAULT_STYLE);
    E.undo();
    check('처음으로 empties the room and gives it its first look; ↩️ undoes even that', emptied && items().length === n0 && !audit().length, `${items().length} things`);
    await E.preset('janchi', { force: true });
    const v0 = M.state().v, d0 = dirty.length, coll0 = colliders.size;
    const stopped = E.stop(); tick(1);
    check('leaving the edit mode: the world is free again, the room is drawn tidily, its things are solid, and the save of this device is marked', stopped && !E.active && !blockers.has('myroom-edit') && !body.cls.has('hud-hidden') && Gb.sys.camera.mode === 'follow' && !audit().length && colliders.size >= coll0 && dirty.length > d0 && Gb.state.myroom.items.length === D.preset('janchi').items.length && v0 > 0, JSON.stringify({ stopped, audit: audit(), colliders: colliders.size, v0 }));
    const saved = JSON.parse(JSON.stringify(Gb.state));
    await P.exit();
    Gb.state = saved; M.onStateLoaded();
    await M.enter(); tick(1);
    check('out and in again (the save read back): the same room is built, thing for thing', norm(items()) === norm(D.preset('janchi').items) && M.stats().items === items().length && !audit().length, `${items().length} things`);
  });

  // ---------------------------------------------------------------- a full room
  await part('a full room', async () => {
    await P.exit();
    const room = D.empty(), rnd = mulberry(20240917);
    let guard = 0;
    while (room.items.length < 160 && guard++ < 80000) {
      const id = D.order[Math.floor(rnd() * D.order.length)], e = D.items[id];
      let it;
      if (e.place === 'W') { const side = D.SIDES[Math.floor(rnd() * 4)], sp = D.wallSpot(side, Math.round(rnd() * D.SIDE_LEN[side] * 8) / 8); it = { i: id, x: sp.x, y: e.yw[1], z: sp.z, r: sp.r }; }
      else it = { i: id, x: Math.round((rnd() - 0.5) * 13 * 4) / 4, y: 0, z: Math.round((rnd() - 0.5) * 10 * 4) / 4, r: Math.floor(rnd() * 4) * 6 };
      if (e.sz && e.place !== 'W' && rnd() < 0.3) it.s = rnd() < 0.5 ? 0 : 2;
      if (e.col && rnd() < 0.5) it.c = Math.floor(rnd() * D.palettes[e.col[0]].length);
      if (D.check(room, it, -1).ok) room.items.push(it);
    }
    Gb.sys.entitle = { has: () => true, limit: (k2) => (k2 === 'roomItems' ? 160 : undefined) };
    Gb.state = { myroom: D.sanitize(room, 200) };
    M.onStateLoaded();
    const t0 = performance.now();
    await M.enter(); tick(1);
    const ms = performance.now() - t0;
    let n = 0, tri = 0;
    P.ctx.group.traverse((o) => { if (o.isMesh && o.visible) { n++; const g = o.geometry; tri += (g.drawRange && Number.isFinite(g.drawRange.count) ? Math.min(g.drawRange.count, g.index ? g.index.count : 0) : g.index ? g.index.count : 0) / 3; } });
    const st = M.stats();
    check(`a full room of 160 things (${new Set(Gb.state.myroom.items.map((it) => it.i)).size} kinds) is ${n} meshes — ${st.batches} for all the things, the rest is the room itself — and is built in ${Math.round(ms)} ms`, Gb.state.myroom.items.length === 160 && st.items === 160 && st.batches <= 40 && n <= 110 && !audit().length && D.bytes(Gb.state.myroom) < D.LIMITS.bytes, JSON.stringify({ meshes: n, batches: st.batches, tris: Math.round(tri), bytes: D.bytes(Gb.state.myroom), audit: audit().slice(0, 3) }));
    E.start(); tick(2);
    E.select(Gb.state.myroom.items.findIndex((it) => D.items[it.i].place === 'F'));
    const t1 = performance.now(); let okMoves = 0;
    for (let k = 0; k < 100; k++) if (E.to(-6 + (k % 20) * 0.5, -4.5 + Math.floor(k / 20))) okMoves++;
    const moveMs = performance.now() - t1;
    check('in a full room 100 moves of a thing (rule check + its vertices rewritten in place) take well under a second, and the drawing still agrees with the data', moveMs < 600 && !audit().length, `${moveMs.toFixed(0)} ms · ${okMoves} allowed`);
    E.cancel(); E.stop({ silent: true });
    delete Gb.sys.entitle;
    await P.exit();
  });

  // ---------------------------------------------------------------- the server side of the app
  await part('a server account', async () => {
    Gb.state = { myroom: D.preset('janchi') };
    M._server = true;
    M.onStateLoaded();
    const st0 = M.state();
    // no right: the door asks, stays shut, the card explains
    const gate = P.def('PL_MYROOM').canEnter({});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const card = modals[modals.length - 1];
    check('an account without a room: the door asks the server once, stays shut and the card "내 방" explains (who gets a room, a ready-made room to look at)', st0.mode === 'server' && st0.loaded === false && gate === false && srv.gets === 1 && P.current === null && M.can() === false && !!card && /mr-explain/.test(card.o.className) && /분양/.test(card.el.textContent) && card.o.actions.some((x) => /구경하기/.test(x.label)) && card.o.actions.some((x) => /닫기/.test(x.label)), JSON.stringify({ st0, gate, gets: srv.gets, text: card && card.el.textContent.slice(0, 80) }));
    card.o.actions.find((x) => /구경하기/.test(x.label)).onClick();
    await Promise.resolve(); await Promise.resolve(); tick(1);
    const vis = { cur: P.current, st: M.state(), items: M.stats().items, edit: E.start(), saves: srv.calls.filter((c) => /save/.test(c.path)).length };
    check('구경하기: a ready-made room to walk through, where nothing can be changed and nothing is saved', vis.cur === 'PL_MYROOM' && vis.st.visiting && vis.items === D.preset('anbang').items.length && vis.edit === false && !E.active && vis.saves === 0, JSON.stringify(vis));
    await P.exit();
    // with the right
    Object.assign(srv, { can: true, limit: 160, room: D.sanitize({ v: 3, style: D.DEFAULT_STYLE, items: [{ i: 'F_SOBAN', x: 2, y: 0, z: -1, r: 0 }, { i: 'W_FAN', x: 0, y: 1.6, z: -5.5, r: 0, c: 4 }], public: false }, 200), calls: [], gets: 0 });
    M.onStateLoaded();
    const entered = await M.enter(); tick(1);
    const sv = { st: M.state(), n: items().length, local: Gb.state.myroom.items.length };
    check('an account with a room: the server\'s room is shown with its version and its limit (160); the room of this device is left alone', entered === true && sv.st.can === true && sv.st.limit === 160 && sv.st.v === 3 && sv.n === 2 && M.stats().items === 2 && sv.local === D.preset('janchi').items.length && srv.gets === 1 && !audit().length, JSON.stringify(sv));
    E.start(); tick(1);
    E.pick('J_DANJI'); E.place();
    const waiting = { timers: timers.filter(Boolean).length, save: M.state().save };
    const ok1 = await M.save(), last = srv.calls.filter((c) => /save/.test(c.path)).pop();
    check('a change is sent with the version it was made from ({v, style, items, public}: ids and numbers only); the answer\'s version is kept; until then a timer waits (the changes of four seconds go in one save)', waiting.timers >= 1 && waiting.save === 'saving' && ok1 === true && M.state().v === 4 && last.body.v === 3 && last.body.items.length === 3 && Object.keys(last.body).sort().join() === 'items,public,style,v' && last.body.items.every((it) => Object.keys(it).every((k2) => 'ixyzrsc'.includes(k2))) && M.state().save === 'ok' && !M.state().dirty, JSON.stringify({ waiting, ok1, v: M.state().v, sent: last && last.body.v }));
    srv.offline = 1;
    E.pick('G_GONGGI'); E.place();
    const off = await M.save(), draftKey = [...store.keys()].find((k2) => k2.indexOf('tfm.v1.myroomDraft.') === 0), draft = draftKey ? JSON.parse(store.get(draftKey)) : null, offState = M.state().save;
    const later = await M.save();
    check('no network: the room waits as a draft on this device (state "wait") and is sent when the network is back — then the draft is gone', off === false && offState === 'wait' && draft && draft.base === 4 && draft.room.items.length === 4 && later === true && M.state().v === 5 && srv.room.items.length === 4 && ![...store.keys()].some((k2) => k2.indexOf('tfm.v1.myroomDraft.') === 0) && M.state().save === 'ok', JSON.stringify({ off, offState, draft: draft && draft.base, later, v: M.state().v }));
    srv.loseAnswer = true;
    E.pick('G_JEGI'); E.place();
    const a = await M.save(), b = await M.save();
    check('a save whose answer is lost: the next try sees that the newer room on the server is its own and goes on (nothing lost, nothing asked, the undo list stays)', a === false && b === true && items().length === 5 && srv.room.items.length === 5 && M.state().v === srv.room.v && M.state().save === 'ok' && E.active && E.undoCount === 3, JSON.stringify({ a, b, v: M.state().v, sv: srv.room.v, undo: E.undoCount }));
    srv.room = { ...D.sanitize({ v: 0, style: { ...D.DEFAULT_STYLE, floor: 'maru' }, items: [{ i: 'F_SANG', x: -2, y: 0, z: -2, r: 0 }], public: false }, 200), v: srv.room.v + 3 };
    E.pick('G_TOP'); E.place();
    const t0 = toasts.length, c = await M.save(); tick(1);
    check('the room was changed somewhere else: the save is refused, the newer room is read and shown, the undo list starts afresh, a line says what happened and the state is "ok"', c === false && M.state().v === srv.room.v && items().map((it) => it.i).join() === 'F_SANG' && M.stats().items === 1 && M.room().style.floor === 'maru' && E.undoCount === 0 && E.held === null && toasts.slice(t0).some((t) => /새로 불러왔어요/.test(t)) && M.state().save === 'ok' && !audit().length, JSON.stringify({ c, v: M.state().v, items: items().length, save: M.state().save, audit: audit() }));
    // P1: friends may look — the switch in 방 모양, then a friend's public room by its number (read-only)
    const pubOn = E.setPublic(true), pubSave = await M.save(), pubBody = srv.calls.filter((c2) => /save/.test(c2.path)).pop().body;
    check('구경 허락: the switch makes the room public (saved with the next save, the room number is said); 나만 보기 turns it back', pubOn === true && pubSave === true && pubBody.public === true && M.state().public === true && srv.room.public === true && E.setPublic(false) === true && M.state().public === false && (await M.save()) === true && srv.room.public === false, JSON.stringify({ pubOn, pubSave, pub: pubBody.public }));
    srv.others = { 42: D.sanitize({ ...D.preset('seonbi'), public: true }, 200), 43: D.sanitize({ ...D.preset('janchi'), public: false }, 200) };
    const tv0 = toasts.length, savesBefore = srv.calls.filter((c2) => /save/.test(c2.path)).length;
    const vNo = await M.visitUser(43), vBad = await M.visitUser('1; drop'), vYes = await M.visitUser(42); tick(1);
    const vis2 = { no: vNo, bad: vBad, yes: vYes, st: M.state(), n: M.stats().items, edit: E.active, cur: P.current, save: await M.save(), saves: srv.calls.filter((c2) => /save/.test(c2.path)).length - savesBefore, said: toasts.slice(tv0).some((t) => /구경할 수 없어요/.test(t)) };
    check('친구 방: a room that is not public is the same "cannot look" as a wrong number; a public one is shown read-only (edit mode closed, nothing saved)', vis2.no === false && vis2.bad === false && vis2.said && vis2.yes === true && vis2.st.visiting === true && vis2.n === D.preset('seonbi').items.length && vis2.edit === false && vis2.cur === 'PL_MYROOM' && vis2.save === false && vis2.saves === 0 && E.start() === false && !audit().length, JSON.stringify(vis2));
    const own = await M.visitUser(7); tick(1);
    check('one\'s own room number leads back to one\'s own room (not a visit)', own === true && M.state().visiting === false && M.stats().items === srv.room.items.length, JSON.stringify(M.state()));
    E.start(); tick(1);
    srv.can = false;
    E.pick('G_TOP'); E.place();
    const f = await M.save();
    check('the right is taken back while decorating: the save is refused, the edit mode closes by itself and nothing stays blocked', f === false && !E.active && M.can() === false && blockers.size === 0, JSON.stringify({ f, active: E.active, can: M.can() }));
    await P.exit();
    M._server = null; M.onStateLoaded();
    check('back in local mode the room of this device is untouched', M.state().mode === 'local' && M.room().items.length === D.preset('janchi').items.length, JSON.stringify(M.state()));
  });

  // ---------------------------------------------------------------- a door somewhere else
  await part('a door for other fragments', async () => {
    Gb.interact = { register: (o) => { interacts.push(o); return { unregister() {}, entry: o }; } };
    const hnd = M.doorAt({ x: 5, z: 7, rotY: 0, id: 'MYROOM_TEST_DOOR' });
    const bad = M.doorAt({ x: 'a', z: 1 }) === null && M.doorAt(null) === null;
    hnd.entry.onInteract();
    await Promise.resolve(); await Promise.resolve();
    const inside = P.current;
    await P.exit();
    check('doorAt(): a door to "내 방" anywhere — leaving the room then leads back to one step in front of that door, not to the hanok', !!hnd && bad && inside === 'PL_MYROOM' && P.lastExit && P.lastExit.to && P.lastExit.to.x === 5 && Math.abs(P.lastExit.to.z - 8.4) < 1e-9, JSON.stringify(P.lastExit));
    await M.enter(); await P.exit();
    check('through its own door the way out is the usual one (no leftover from the other door)', P.lastExit === null);
  });

  const unexpected = warns.filter((x) => !/the room was not saved \(it will be sent again\)|the server refused the room/.test(x));
  check('the room wrote no warning other than the two expected ones about refused / failed saves', !unexpected.length, unexpected.slice(0, 5).join(' | '));
}

// run alone
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? "  ✔" : "  ✖"} ${name}${detail !== "" && detail != null ? ` — ${String(detail).slice(0, ok ? 200 : 3000)}` : ""}`); };
  await roomLogic({ check, log: (...a) => console.log(...a), ROOT });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? '✖' : '✔'} myroom-logic: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
