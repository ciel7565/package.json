#!/usr/bin/env node
// =============================================================================
// tests/fishing-logic.mjs — the fishing system's rules without a browser (CONTRACT §18.3)
//
//   node tests/fishing-logic.mjs [--json]
//
// 35-fishing.js is evaluated in Node with real three.js and a small stand-in for the game (river, player, bag, windows).
// The session is then played frame by frame like a child would: every method to a catch, the wide bite window, an early
// press that costs nothing, a missed bite and a fish that got away (kind words, never stuck), a protected fish and a
// closed season (놓아주기 only), the daily keep limit, the 어항 in real time, clean-water neighbours, the 어류 도감,
// the chooser, cancel from every phase, the counters and events the quests and the server read.
// What a browser must show (the fish's skin, the float on the water, the touch button) is in tests/fishing-client.mjs.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOut = process.argv.includes('--json');
let THREE, BufferGeometryUtils;
try {
  THREE = await import(path.join(ROOT, 'node_modules/three/build/three.module.js'));
  BufferGeometryUtils = await import(path.join(ROOT, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'));
} catch (e) { console.error('three.js 가 필요해요 (npm install)', e.message); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); if (!jsonOut) console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 220)}` : ''}`); };

// ---------------------------------------------------------------- a tiny document
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = { setProperty() {} }; this._text = ''; this.hidden = false; this.disabled = false; this.isConnected = true; this.dataset = {};
    const set = new Set(); this._cls = set;
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, contains: (c) => set.has(c) };
  }
  set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this._cls.add(c)); }
  get className() { return [...this._cls].join(' '); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : String(c.data || ''))).join(''); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children[this.children.length - 1]; }
  all(out = []) { for (const c of this.children) if (c instanceof El) { out.push(c); c.all(out); } return out; }
  byClass(cls) { return this.all().filter((e) => e._cls.has(cls)); }
  click() { if (this.disabled) return; for (const fn of this.listeners.click || []) fn({ preventDefault() {}, stopPropagation() {} }); }
  animate() { return {}; }
  setPointerCapture() {}
  getContext() { return null; }
}
const h = (tag, attrs, ...children) => {
  const el = new El(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') el.className = v; else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v); else el.setAttribute(k, v); }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else if (c instanceof El) el.appendChild(c); else el.appendChild({ data: String(c) }); };
  children.forEach(add);
  return el;
};
const document = { createElement: (t) => new El(t), getElementById: () => null, body: new El('body') };

// ---------------------------------------------------------------- a tiny game
const river = [[124, -320], [112, -200], [100, -130], [93, -70], [90, -15], [92, 35], [98, 85], [106, 140], [116, 220], [126, 320]];
const distRiver = (x, z) => { let best = 1e9; for (let i = 0; i < river.length - 1; i++) { const [ax, az] = river[i], [bx, bz] = river[i + 1]; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2))); best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t)); } return best; };
const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function makeGame(opts = {}) {
  const handlers = {}, events = [], modals = [], toasts = [], said = [];
  const site = Object.assign({}, opts.site);
  const mkModal = (o) => { const el = new El('div'); const m = { id: o.id, el, body: el, opts: o, close() { const i = modals.indexOf(m); if (i >= 0) { modals.splice(i, 1); if (o.onClose) o.onClose(); } } }; const old = modals.find((x) => x.id && x.id === o.id); if (old) old.close(); modals.push(m); if (typeof o.body === 'function') o.body(el); return m; };
  const G = {
    data: { layout: { river: { width: 16, points: river }, waterY: -1.1, riverDeck: { id: 'DECK_RIVER', x: 75, z: 46, w: 9, d: 6, top: 0.35 }, anchors: {} }, quests: {}, achievements: {}, collection: {}, collectionCategories: [], items: {}, education: {}, quizzes: {}, lectureDecks: [], educationCategories: {} },
    sys: {}, state: { stats: {}, inventory: Object.assign({}, opts.inventory), collection: {} }, settings: { easyMode: !!opts.easy },
    util: { rng, isTyping: () => false }, log: { warn: (...a) => { G._warn.push(a.map(String).join(' ')); }, info() {}, error: (...a) => { G._warn.push(a.map(String).join(' ')); } }, _warn: [],
    bus: { on: (n, fn) => { (handlers[n] = handlers[n] || []).push(fn); }, emit: (n, p) => { events.push([n, p]); (handlers[n] || []).forEach((fn) => fn(p)); } },
    register(s) { this.sys[s.name] = s; }, dirty() {}, sfx() {}, activity() {}, fx: { burst() {}, kidParty() {} },
    site: { get: (k, d) => (k in site ? site[k] : d) },
    env: { kst: (ms) => { const d = new Date(ms + 9 * 3600000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hour: d.getUTCHours() + d.getUTCMinutes() / 60, key: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate() }; }, now: () => ({ weather: 'CLEAR' }) },
    easy: { on: !!opts.easy, say: (t) => { said.push(String(t)); }, pick: async (o) => (G._pick ? G._pick(o) : o.items[0].id) },
    world: { isWater: (x, z) => distRiver(x, z) < 8, terrainHeight: (x, z) => (distRiver(x, z) < 8 ? -2.6 : Math.min(0.4, -1.1 + (distRiver(x, z) - 8) * 0.5)), heightAt(x, z) { return this.terrainHeight(x, z); }, blocked: () => false, addCollider() {} },
    interact: { list: [], register(o) { this.list.push(o); return o; } },
    ui: {
      h, _blocks: new Set(), _hud: true,
      modal: { open: mkModal, get: (id) => modals.find((m) => m.id === id) || null, isOpen: (id) => (id ? modals.some((m) => m.id === id) : modals.length > 0), closeAll() { while (modals.length) modals[0].close(); } },
      block(k) { this._blocks.add(k); }, unblock(k) { this._blocks.delete(k); }, isBlocking() { return this._blocks.size > 0; }, setHudVisible(v) { this._hud = !!v; },
      toast: (t) => toasts.push(String(t)), onAction() {}, onEscape() {}, alert: async (t) => { said.push('alert: ' + t); }, confirm: async () => (G._confirm ? G._confirm() : true), reducedMotion: () => false,
    },
    progJosa: (w, p) => { const c = String(w).charCodeAt(String(w).length - 1); const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false; const [a, b] = p.split('/'); return w + (jong ? a : b); },
  };
  G.sys.engine = { scene: new THREE.Scene(), onPreRender: () => () => {}, renderer: null };
  G.sys.player = { position: new THREE.Vector3(70, 0.4, 40), velocity: new THREE.Vector3(), rotY: 0, rig: { handR: new THREE.Object3D(), setAnim() {}, stopAction() {} }, walkTo(t, o) { this.position.set(t.x, G.world.heightAt(t.x, t.z), t.z); setTimeout(o.onArrive, 0); return true; }, cancelWalk() {} };
  G.sys.camera = { mode: 'follow', shot() { this.mode = 'shot'; }, setMode(m) { this.mode = m; }, behind() {} };
  G.sys.places = { current: null, hideRoot() {} };
  G.sys.inventory = { full: false, count: (id) => G.state.inventory[id] || 0, add(id, n) { if (this.full) return 0; G.state.inventory[id] = (G.state.inventory[id] || 0) + n; return n; } };
  G.sys.progression = { granted: [], grant(r) { this.granted.push(r); }, unlockCollection(id) { G.state.collection[id] = 1; }, checkAchievements() {} };
  const ctx = vm.createContext({ G, THREE, ADDONS: { BufferGeometryUtils }, window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 }, document, navigator: {}, console, Math, JSON, Object, Array, Number, String, Date, Promise, setTimeout, clearTimeout, setInterval, Float32Array, Uint16Array, Uint32Array, Uint8Array, Map, Set, Symbol, Error, isFinite, parseInt, parseFloat });
  for (const f of ['34-fish-data.js', '35-fishing-kit.js', '35-fishing.js']) vm.runInContext(`(function(){\n${fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8')}\n})()`, ctx, { filename: f });
  const F = G.sys.fishing;
  let T = 0;
  const tick = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { T += dt; F.update(dt, T); } };
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const until = async (pred, max = 3000) => { for (let i = 0; i < max; i++) { if (pred()) return i; tick(1); if (i % 25 === 0) await wait(0); } return -1; };
  const card = () => modals.find((m) => m.id === 'fish-card') || null;
  const buttons = () => (card() ? card().el.byClass('fish-big').map((b) => b.textContent) : []);
  /** stand at a spot and begin (the walk of the stand-in arrives at once) */
  const begin = async (spot, method, force, o) => { const s = F.spots().find((x) => x.id === spot); G.sys.player.position.set(s.x - 1, 0.4, s.z); F.debug.force(force || null); const ok = F.start(spot, method, o); await wait(3); tick(2); return ok; };
  /** play a rod / gyeonji session to the card like a careful child; returns the phases seen */
  const toCard = async () => {
    const log = [F.state.phase]; const note = () => { if (log[log.length - 1] !== F.state.phase) log.push(F.state.phase); };
    F.press(true); F.press(false); note();
    if (F.state.method === 'net') {
      await until(() => F.state.phase === 'net-stir'); note(); F.press(true);
      await until(() => F.state.phase === 'net-run' || F.state.phase === 'missed'); note(); F.press(false);
      if (F.state.phase === 'net-run') { await until(() => F.state.t >= F.state.winA + 0.05); F.press(true); F.press(false); note(); }
    } else {
      await until(() => F.state.phase === 'wait'); note();
      await until(() => F.state.phase === 'bite' || F.state.phase === 'ready'); note();
      if (F.state.phase === 'bite') { F.press(true); F.press(false); note(); for (let i = 0; i < 4000 && F.state.phase === 'reel'; i++) { if (F.state.tension > 0.72) F.press(false); else if (F.state.tension < 0.5) F.press(true); tick(1); } note(); }
    }
    await until(() => !!card() || F.state.phase === 'missed', 600); note();
    return log;
  };
  const answer = async (which) => { const c = card(); if (!c) return false; const bs = c.el.byClass('fish-big'); if (which === 'keep' && bs[1]) bs[1].click(); else if (which === 'button') bs[0].click(); else c.close(); await wait(3); tick(3); return true; };
  return { G, F, tick, wait, until, card, buttons, begin, toCard, answer, events, modals, toasts, said };
}
const JUNE = Date.UTC(2026, 5, 9, 22, 0, 0);          // 2026-06-10 07:00 in Korea
const count = (events, name) => events.filter(([n]) => n === name).length;

try {
  // ================================================================ normal mode
  {
    const K = makeGame({ inventory: { ITEM_DOENJANG: 1 } });
    const { G, F } = K;
    F.init();
    const spots = F.spots();
    const valley = spots.filter((s) => s.river === 'valley');
    check('the valley\'s four spots stand on the bank, never in the water', valley.length === 4 && valley.every((s) => s.ready && !G.world.isWater(s.x, s.z) && s.y > G.data.layout.waterY), valley.map((s) => `${s.id} ${s.x.toFixed(1)},${s.z.toFixed(1)}`).join(' · '));
    check('each spot is an interactable of kind fishspot with its own id, and a marker anchor for the quests', G.interact.list.length === 4 && G.interact.list.every((o) => o.kind === 'fishspot' && valley.some((s) => s.id === o.id) && typeof o.onInteract === 'function') && valley.every((s) => G.data.layout.anchors[s.id]));
    check('the complex\'s spots wait for their place (a part of PL_ALLOT)', spots.filter((s) => s.river === 'complex').length === 3 && spots.filter((s) => s.river === 'complex').every((s) => !s.ready && s.place === 'PL_ALLOT'));
    K.tick(40);
    const info = F.debug.info();
    check('schools swim near the player: at most four draw calls for all of them', info.schools.calls >= 1 && info.schools.calls <= 4 && info.schools.fish >= 6, `${info.schools.fish} fish in ${info.schools.calls} draw calls · ${[...new Set(info.schools.list)].join(', ')}`);
    F.debug.setNow(JUNE); F.debug.setSeed(5);

    // ---- 대낚시: a catch that is taken along
    check('a session begins only at a spot of the place the player is in, with a method the spot has', F.start('FS_NOPE', 'rod') === false && F.start('FS_V_DECK', 'harpoon') === false && F.state.phase === 'idle');
    await K.begin('FS_V_DECK', 'rod', 'SANCHEONEO', { bait: 'worm' });
    check('the session takes the controls: input is blocked for the world, the HUD steps aside, the camera frames the float', F.state.phase === 'ready' && G.ui.isBlocking() && G.ui._hud === false && G.sys.camera.mode === 'shot');
    // an early press while waiting costs nothing
    F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'wait');
    const before = F.state.biteAt; F.press(true); F.press(false);
    check('pressing too early loses nothing: the fish only takes a little longer', F.state.phase === 'wait' && F.state.biteAt > before && F.state.biteAt - before <= 1);
    await K.until(() => F.state.phase === 'bite');
    const win = F.state.window;
    check('the bite window in normal mode is at least 1.2 seconds', win >= 1.2 && win <= 2.2, `${win.toFixed(2)} s`);
    F.press(true); F.press(false);
    check('pressing in the window hooks the fish', F.state.phase === 'reel' && F.state.mm > 0);
    for (let i = 0; i < 4000 && F.state.phase === 'reel'; i++) { if (F.state.tension > 0.72) F.press(false); else if (F.state.tension < 0.5) F.press(true); K.tick(1); }
    await K.until(() => !!K.card(), 400);
    check('winding with pauses lands the fish: the catch card opens', !!K.card() && /산천어/.test(K.card().opts.title), K.card()?.opts.title);
    check('a fish that may be taken has both choices', K.buttons().length === 2 && /놓아주기/.test(K.buttons()[0]) && /데려가기/.test(K.buttons()[1]), K.buttons().join(' | '));
    await K.answer('keep');
    const st = G.state.fishing;
    check('데려가기 puts the item FISH_<ID> in the bag and counts the day', G.state.inventory.FISH_SANCHEONEO === 1 && st.book.SANCHEONEO.n === 1 && st.book.SANCHEONEO.kept === 1 && st.day.kept === 1 && st.day.key === 20260610, JSON.stringify(st.day));
    check('the first meeting stamps the sticker book and pays the first-time bonus quietly', G.state.collection.COL_FISH_SANCHEONEO === 1 && G.sys.progression.granted.some((r) => r.exp >= 30 && r.edu === 2));
    check('events for the quests: fish:landed (first) and fish:kept', K.events.some(([n, p]) => n === 'fish:landed' && p.id === 'SANCHEONEO' && p.first === true && p.method === 'rod' && p.spot === 'FS_V_DECK' && p.mm > 0 && p.protected === false) && K.events.some(([n, p]) => n === 'fish:kept' && p.itemId === 'FISH_SANCHEONEO'));
    check('after the card the session is ready for the next cast', F.state.phase === 'ready');

    // ---- a protected fish
    F.debug.force('EOREUMCHI');
    let log = await K.toCard();
    check('a protected fish can only go back: one choice, with the reason in plain words', K.buttons().length === 1 && /놓아주기/.test(K.buttons()[0]) && K.card().el.byClass('fish-why').some((e) => /천연기념물|멸종위기/.test(e.textContent)), `${log.join('>')} · ${K.card().el.byClass('fish-why').map((e) => e.textContent).join(' ').slice(0, 90)}`);
    await K.answer('button');
    check('letting it go: no item, a thank-you, fish:released { protected }', !G.state.inventory.FISH_EOREUMCHI && st.book.EOREUMCHI.rel === 1 && st.book.EOREUMCHI.kept === 0 && K.toasts.some((t) => /어름치를 지켜 줘서 고마워요/.test(t)) && K.events.some(([n, p]) => n === 'fish:released' && p.id === 'EOREUMCHI' && p.protected === true));
    check('counters: caught 2 · kept 1 · released 1 · species 2 · protected species 1', G.state.stats.fishCaught === 2 && G.state.stats.fishKept === 1 && G.state.stats.fishReleased === 1 && G.state.stats.fishSpecies === 2 && G.state.stats.fishGuarded === 1, JSON.stringify(G.state.stats));

    // ---- a missed bite and a fish that got away
    F.debug.force('BEODEULCHI');
    F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'bite');
    await K.until(() => F.state.phase !== 'bite');
    check('a missed bite gets a kind word and the session goes on by itself', F.state.phase === 'missed' && /괜찮아요/.test(F.state.hint), F.state.hint);
    await K.until(() => F.state.phase === 'ready', 200);
    check('… back to ready without any press', F.state.phase === 'ready');
    F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'bite');
    const wide = F.state.window;
    F.press(true); F.press(false);
    F.press(true);                                             // hold without ever letting go: the line gets too tight
    await K.until(() => F.state.phase !== 'reel', 3000);
    check('normal mode: holding through every pull lets the fish get away — with a kind word and a tip', F.state.phase === 'missed' && /괜찮아요|다음에는/.test(F.state.hint), F.state.hint);
    F.press(false);
    await K.until(() => F.state.phase === 'ready', 200);
    F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'bite'); F.press(true); F.press(false);
    await K.until(() => F.state.phase !== 'reel', 3000);       // never winding at all
    check('never winding: the fish slips away after a long while, the session is not stuck', F.state.phase === 'missed', F.state.hint);
    // two missed bites in a row: the third bite waits half as long again
    for (let i = 0; i < 2; i++) { await K.until(() => F.state.phase === 'ready', 200); F.press(true); F.press(false); await K.until(() => F.state.phase === 'bite'); await K.until(() => F.state.phase !== 'bite'); }
    await K.until(() => F.state.phase === 'ready', 200); F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'bite');
    check('after two missed bites in a row the next bite waits half as long again', Math.abs(F.state.window - wide * 1.5) < 0.01 && F.state.window >= 2.5, `${wide.toFixed(2)} → ${F.state.window.toFixed(2)} s`);
    F.cancel('test');
    check('cancel gives everything back: phase idle, input free, HUD back, camera follows', F.state.phase === 'idle' && !G.ui.isBlocking() && G.ui._hud === true && G.sys.camera.mode === 'follow' && count(K.events, 'fishing:end') === count(K.events, 'fishing:start'));

    // ---- 견지낚시, 족대, a neighbour
    const gy = valley.find((s) => s.methods.includes('gyeonji'));
    await K.begin(gy.id, 'gyeonji', 'SWIRI');
    log = await K.toCard();
    check('견지낚시 to a catch', !!K.card() && /쉬리/.test(K.card().opts.title), log.join('>'));
    await K.answer('release'); F.cancel('test');
    const nt = valley.find((s) => s.methods.includes('net'));
    await K.begin(nt.id, 'net', 'DOLGOGI');
    log = await K.toCard();
    check('족대 to a catch: set → lift the stone slowly (hold) → lift the net while the shadow is over it', !!K.card() && /돌고기/.test(K.card().opts.title) && log.includes('net-stir') && log.includes('net-run'), log.join('>'));
    await K.answer('release');
    F.debug.force('GAJAE');
    log = await K.toCard();
    check('a clean-water neighbour in the net is looked at and put back (never an item)', !!K.card() && /가재/.test(K.card().opts.title) && K.buttons().length === 1 && st.seen.GAJAE === 1 && !Object.keys(G.state.inventory).some((k) => /GAJAE/.test(k)) && K.events.some(([n, p]) => n === 'fish:seen' && p.id === 'GAJAE'), log.join('>'));
    await K.answer('button');
    // the net's window: too early is only a hint
    F.debug.force('DOLGOGI');
    F.press(true); F.press(false);
    await K.until(() => F.state.phase === 'net-stir'); F.press(true);
    await K.until(() => F.state.phase === 'net-run'); F.press(false);
    const wA = F.state.winA, wB = F.state.winB;
    F.press(true); F.press(false);
    check('족대: lifting before the shadow arrives is only a hint; the window is wide (≥ 1.5 s)', F.state.phase === 'net-run' && wB - wA >= 1.5, `${(wB - wA).toFixed(2)} s`);
    F.cancel('test');

    // ---- the 어항 in real time
    const tp = valley.find((s) => s.methods.includes('trap'));
    await K.begin(tp.id, 'trap', null);
    await K.wait(3);
    check('어항: set with 된장 when the bag has some, standing in the water in real time; the session ends by itself', st.traps[tp.id] && st.traps[tp.id].bait === 'doenjang' && st.traps[tp.id].at === JUNE && F.state.phase === 'idle' && G.state.inventory.ITEM_DOENJANG === 1, JSON.stringify(st.traps));
    const info1 = F.spots().find((s) => s.id === tp.id).trap;
    check('… not ready before its minutes have passed', info1 && info1.ready === false && Math.round(info1.leftMs / 60000) === 10, JSON.stringify(info1));
    G._confirm = () => false;                                  // "더 기다리기"
    await K.begin(tp.id, 'trap', null); await K.wait(3);
    check('looking too early offers to wait: the trap stays', !!st.traps[tp.id] && F.state.phase === 'idle');
    F.debug.setNow(JUNE + 10 * 60000 + 2000);
    check('… ready after ten real minutes (the label of the spot says so)', F.spots().find((s) => s.id === tp.id).trap.ready === true && /어항/.test(G.interact.list.find((o) => o.id === tp.id).label()));
    const p = F.open(tp.id);
    const titles = [];
    for (let i = 0; i < 6; i++) { await K.wait(3); K.tick(2); if (!K.card()) break; titles.push(K.card().opts.title); await K.answer('release'); }
    await p; await K.wait(3);
    check('a ready 어항 holds one to three small fish, each with its own card; then it is taken out', titles.length >= 1 && titles.length <= 3 && !st.traps[tp.id] && F.state.phase === 'idle', titles.join(' · '));
    F.debug.setNow(JUNE);

    // ---- the daily keep limit
    await K.begin('FS_V_DECK', 'rod', 'BEODEULCHI');
    for (let i = 0; i < 5; i++) { await K.toCard(); await K.answer('keep'); }
    check('six fish taken today', st.day.kept === 6 && G.state.inventory.FISH_BEODEULCHI === 5, JSON.stringify(st.day));
    await K.toCard();
    check('the seventh can only go back: one choice and the reason', K.buttons().length === 1 && K.card().el.byClass('fish-why').some((e) => /오늘은 먹을 만큼/.test(e.textContent)), K.card().el.byClass('fish-why').map((e) => e.textContent).join(' '));
    await K.answer('button');
    F.debug.setNow(JUNE + 24 * 3600000);
    await K.toCard();
    check('a new Korean day: the limit starts again', K.buttons().length === 2);
    await K.answer('keep');
    check('… and the day of the save is the new day', st.day.key === 20260611 && st.day.kept === 1);
    // a full bag
    G.sys.inventory.full = true;
    await K.toCard(); await K.answer('keep');
    check('a full bag: the fish goes back to the water instead of being lost silently', st.day.kept === 1 && K.toasts.some((t) => /가방이 가득/.test(t)));
    G.sys.inventory.full = false;
    F.cancel('test');

    // ---- a closed season
    F.debug.setNow(Date.UTC(2026, 4, 1, 1, 0, 0));           // 1 May, 10:00 in Korea
    const eu = F.spots().find((s) => s.ready) && 'FS_V_DECK';
    await K.begin(eu, 'rod', 'EUNEO');
    await K.toCard();
    check('a fish in its closed season can only go back (은어, 1 May)', K.buttons().length === 1 && K.card().el.byClass('fish-why').length === 1, K.card().el.byClass('fish-why').map((e) => e.textContent).join(' ').slice(0, 120));
    await K.answer('button'); F.cancel('test');
    F.debug.setNow(JUNE + 24 * 3600000);

    // ---- the 어류 도감 and the chooser
    F.book();
    const book = K.modals.find((m) => m.id === 'fish-book');
    const tiles = book.el.byClass('fish-tile');
    check('어류 도감: a tile for each of the 31 fish; unmet ones are locked and nameless', tiles.length === 31 && tiles.filter((t) => t._cls.has('is-locked')).length === 31 - Object.keys(st.book).length && tiles.filter((t) => t._cls.has('is-locked')).every((t) => /\?\?\?/.test(t.textContent)), `${Object.keys(st.book).length} met`);
    tiles[0].click();
    check('a page tells size, signs, home, water grade, food, spawning, season, method and why clean water matters — with its sources', book.el.byClass('fish-row').length >= 11 && book.el.byClass('fish-src').length === 1 && /출처/.test(book.el.byClass('fish-src')[0].textContent), `${book.el.byClass('fish-row').length} rows`);
    book.el.byClass('fish-back')[0].click();
    book.el.byClass('fish-tab')[1].click();
    check('… the neighbours of clean water (7) and what to know (7 cards)', book.el.byClass('fish-tile').length === 7 && (book.el.byClass('fish-tab')[2].click(), book.el.byClass('fish-know-card').length === 7));
    book.close();
    const pc = F.open('FS_V_DECK'); await K.wait(3);
    const ch = K.modals.find((m) => m.id === 'fish-choose');
    check('the chooser (normal mode): the spot\'s methods, baits of the method, who is about now', !!ch && ch.el.byClass('fish-method').length === F.spots().find((s) => s.id === 'FS_V_DECK').methods.length && ch.el.byClass('fish-bait').length >= 2 && ch.el.byClass('fish-who').length === 1, ch ? ch.el.byClass('fish-who')[0].textContent : '');
    ch.close(); await pc;
    const pv = F.preview('YEOLMOGEO'); await K.wait(2); K.card().close();
    check('preview(id) shows a card and records nothing', (await pv) === 'release' && !st.book.YEOLMOGEO);
    // moving away ends the session
    await K.begin('FS_V_DECK', 'rod', 'BEODEULCHI');
    G.sys.player.position.x -= 12; K.tick(2);
    check('walking away ends the session (never stuck)', F.state.phase === 'idle' && !G.ui.isBlocking());
    // the book never runs behind the counters
    const sum = Object.values(st.book).reduce((a, b) => a + b.n, 0);
    check('the counters never run ahead of the book (the server checks the same)', G.state.stats.fishCaught === sum && G.state.stats.fishSpecies === Object.keys(st.book).length && G.state.stats.fishKept + G.state.stats.fishReleased === sum && Object.values(st.book).every((b) => b.kept + b.rel === b.n), JSON.stringify(G.state.stats));
    check('protected fish never have "kept" in the book and never an item', Object.entries(st.book).every(([id, b]) => !G.data.fish.byId[id].protected || (b.kept === 0 && !G.state.inventory[`FISH_${id}`])));
    check('the state stays in the documented shape', JSON.stringify(G.data.fish.sanitizeState(JSON.parse(JSON.stringify(st)))) === JSON.stringify(st));
    check('no warning was logged', G._warn.length === 0, G._warn.slice(0, 3).join(' | '));
  }

  // ================================================================ easy mode and operator settings
  {
    const K = makeGame({ easy: true });
    const { G, F } = K;
    F.init(); F.debug.setNow(JUNE); F.debug.setSeed(9);
    let picked = null;
    G._pick = (o) => { picked = o; return 'rod'; };
    const p = F.open('FS_V_DECK');
    await p; await K.wait(3); K.tick(2);
    check('easy mode: the spot opens a picture chooser (methods + the 도감), no typing', picked && picked.items.length >= 3 && picked.items.every((i) => i.emoji && i.label && i.say) && picked.items.some((i) => i.id === '__book') && F.state.phase === 'ready', picked ? picked.items.map((i) => i.label).join(' · ') : '');
    const windows = [];
    for (const id of ['BEODEULCHI', 'YEOLMOGEO', 'KKEOKJI']) {
      F.debug.force(id); F.press(true); F.press(false);
      await K.until(() => F.state.phase === 'bite'); windows.push(F.state.window);
      F.press(true); F.press(false);
      F.press(true);                                           // a small child holds the button down the whole time
      await K.until(() => F.state.phase !== 'reel', 6000);
      await K.until(() => !!K.card(), 400);
      F.press(false);
      if (!K.card()) break;
      await K.answer('release');
    }
    check('easy mode: the bite window is at least 1.2 s for every fish (here ≥ 1.9 s)', windows.length === 3 && windows.every((w) => w >= 1.9), windows.map((w) => w.toFixed(2)).join(' · '));
    check('easy mode: holding the button the whole time never breaks the line — the fish still lands', Object.keys(G.state.fishing.book).length === 3, Object.keys(G.state.fishing.book).join(', '));
    check('easy mode speaks its hints in short 해요체 sentences', K.said.length >= 3 && K.said.every((t) => t.length <= 60 && !/[A-Za-z]{3,}/.test(t)), K.said.slice(0, 3).join(' / '));
    F.cancel('test');
  }
  {
    const K = makeGame({ site: { 'fishing.keep_per_day': 0, 'fishing.trap_minutes': 30 } });
    const { G, F } = K;
    F.init(); F.debug.setNow(JUNE); F.debug.setSeed(3);
    check('operator settings are read: keep limit 0, trap 30 minutes', F.keepLimit() === 0 && F.trapMinutes() === 30);
    await K.begin('FS_V_DECK', 'rod', 'BEODEULCHI'); await K.toCard();
    check('keep limit 0: every fish goes back', K.buttons().length === 1);
    await K.answer('button'); F.cancel('test');
    const K2 = makeGame({ site: { 'fishing.enabled': false } });
    K2.F.init();
    check('fishing switched off by the operator: the spots rest', (await K2.F.open('FS_V_DECK')) === false && K2.G.interact.list.every((o) => o.enabled() === false) && K2.toasts.length === 1);
  }
} catch (e) {
  check('the test ran to its end', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
}

const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
