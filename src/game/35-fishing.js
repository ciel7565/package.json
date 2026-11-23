// =============================================================================
// 35-fishing.js — fishing in the first-grade water of 강원도 (G.sys.fishing, order 63, CONTRACT §18.3).
//
//   G.sys.fishing
//     spots() → [{ id, name, kidName, emoji, river, place (null | 'PL_ALLOT'), methods, habitat, x, y, z, ready, trap }]
//     open(spotId)                     the chooser of a spot: method (+ bait in normal mode), then start()
//     start(spot | spotId, method, { bait? }) → bool      begin a session at the spot (walks the player to the bank)
//     state                            { phase, spot, method, bait, … } — phase: idle | walk | ready | cast | wait | bite |
//                                      reel | land | card | missed | net-set | net-stir | net-run | trap (read-only)
//     press(down = true) / release()   the one big action of a session (the on-screen button, Space / E / Enter)
//     cancel(reason?)                  end the session (never stuck: the bar's 그만하기, Esc, leaving the place, logout)
//     book(id?)                        the 어류 도감 (a species id opens its page)
//     preview(id)                      the catch card of a species without recording anything (developer centre, kid audit)
//     nearestSpot() → spot | null      for quest markers
//     keepLimit() / keptToday()        the daily limit (site setting fishing.keep_per_day) and today's count (KST day)
//     debug                            test seam: setNow(ms | null) · setSeed(n) · setWeather(id | null) · force(id | null)
//                                      · speed(k) · trapReady(spotId) · info()
//   Events (G.bus): 'fish:landed' { id, method, spot, mm, protected, first } · 'fish:kept' { id, itemId, mm } ·
//     'fish:released' { id, protected, mm } · 'fish:seen' { id } (a clean-water neighbour) · 'fishing:start' / 'fishing:end'
//     { spot, method }
//
// How it plays (calm and fair for a small child — §12): one big button, never fast tapping.
//   대낚시 (rod and float): 던져요 → the float sits on the water, rings spread → a shadow comes, the float trembles and
//     goes under (seen, heard, felt) → 당겨요 within a wide window (≥ 1.2 s; 2.6 s in easy mode) → 감아요: hold to wind,
//     let go while the fish pulls hard (a calm bar; easy mode never breaks the line) → the fish lands → the catch card.
//   견지낚시: the same hands, no float — the line drifts down the riffle and the bite is a tug on the line.
//   족대 (hand net): the net is set below a stone → hold to lift the stone slowly → a shadow darts for the net →
//     들어요 while it is over the net.
//   어항 (trap): set it with 된장 or 떡밥; it works in REAL time (site setting fishing.trap_minutes) — come back and
//     look. Up to three small fish, each with its own card.
//   The catch card: the fish turning in 3D, its length, a stamp in the 도감 when it is new → 놓아주기 or 데려가기.
//   A protected fish (천연기념물, 멸종위기 야생생물) and a fish in its closed season only go back, with a kind word why;
//   the daily keep limit keeps it calm; a fish that got away gets a kind word too.
// Who bites is decided by the real Korean day (G.env: month, hour, weather) — G.data.fish.candidates().
// Schools of the spot's species are seen in the water (≤ 4 instanced draw calls for all of them) and scatter when
// someone runs up to the bank. Water rings, drops and the line are drawn, eased, never flashed.
// State: G.state.fishing (shape: 34-fish-data.js). This fragment sanitises it itself (G.data.fish.sanitizeState) when
// a profile is loaded; the server re-checks it (SaveValidator [fishing]). Items FISH_<ID> go to the bag.
// =============================================================================
(function () {
  const TAU = Math.PI * 2, PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const FD = () => (G.data && G.data.fish) || null;
  const h = (...a) => G.ui.h(...a);
  const easyOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const reduced = () => !!(G.ui?.reducedMotion?.() || G.settings?.reduceMotion);
  const say = (text, o) => { try { return G.easy?.say?.(text, o); } catch (e) { return null; } };
  const sfx = (n, o) => { try { G.sfx?.(n, o); } catch (e) { /* audio optional */ } };
  const josa = (w, p) => (G.progJosa ? G.progJosa(w, p) : `${w}${String(p).split('/')[0]}`);
  const site = (k, d) => { try { const v = G.site?.get?.(k, d); return v == null ? d : v; } catch (e) { return d; } };
  const CAT = 'FISH';
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const _eY = new THREE.Euler(0, 0, 0, 'YXZ'), _camP = new THREE.Vector3(), _camL = new THREE.Vector3();

  // ---------------------------------------------------------------- the test seam: clock, chance, weather
  const dbg = { now: null, weather: null, force: null, speed: 1 };
  let rnd = Math.random;
  const now = () => (dbg.now != null ? dbg.now : Date.now());
  /** the Korean calendar day and hour of `now` (G.env when it is there, else the same arithmetic) */
  function kst() {
    try { if (G.env?.kst) return G.env.kst(now()); } catch (e) { /* fall through */ }
    const d = new Date(now() + 9 * 3600000);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return { y, mo, d: dd, hour: d.getUTCHours() + d.getUTCMinutes() / 60, key: y * 10000 + mo * 100 + dd };
  }
  const weatherNow = () => { try { return dbg.weather || G.env?.now?.()?.weather || 'CLEAR'; } catch (e) { return 'CLEAR'; } };
  const WEATHER_KO = { CLEAR: ['☀️', '맑음'], CLOUDY: ['☁️', '흐림'], RAIN: ['🌧️', '비'], FOG: ['🌫️', '안개'], SNOW: ['❄️', '눈'] };

  // ---------------------------------------------------------------- the save block
  let _san = null;
  /** G.state.fishing in the documented shape (sanitised once per loaded profile) */
  function fst() {
    const s = G.state;
    if (!s || !FD()) return null;
    if (s.fishing !== _san || !s.fishing) { s.fishing = FD().sanitizeState(s.fishing); _san = s.fishing; }
    return s.fishing;
  }
  const dirty = () => { try { G.dirty('fishing'); } catch (e) { /* save optional */ } };
  function syncStats() {
    const st = G.state?.stats, f = fst();
    if (!st || !f) return;
    const ids = Object.keys(f.book);
    st.fishSpecies = ids.length;
    st.fishGuarded = ids.filter((id) => FD().byId[id]?.protected).length;
    // the totals never run ahead of the book (the server checks the same)
    let n = 0, rel = 0, kept = 0;
    for (const id of ids) { n += f.book[id].n; rel += f.book[id].rel; kept += f.book[id].kept; }
    st.fishCaught = Math.min(Number(st.fishCaught) || 0, n);
    st.fishReleased = Math.min(Number(st.fishReleased) || 0, rel);
    st.fishKept = Math.min(Number(st.fishKept) || 0, kept);
  }

  // ---------------------------------------------------------------- small 3D parts (no texture maps: every preset)
  const BGU = () => ADDONS.BufferGeometryUtils;
  function tint(geo, hex) {
    const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  }
  const put = (geo, x, y, z, rx, ry, rz) => { if (rx || ry || rz) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx || 0, ry || 0, rz || 0))); geo.translate(x || 0, y || 0, z || 0); return geo; };
  const clean = (geo) => { const g = geo.index ? geo.toNonIndexed() : geo; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
  let _matV = null;
  const matV = () => _matV || (_matV = new THREE.MeshLambertMaterial({ vertexColors: true }));
  /** a wooden sign post with a carved fish — the 🎣 mark of a spot (local origin at its foot, front +Z) */
  function signGeometry() {
    const L = [];
    L.push(tint(put(new THREE.CylinderGeometry(0.055, 0.07, 1.5, 8), 0, 0.75, 0), '#6b4a2e'));
    L.push(tint(put(new THREE.BoxGeometry(0.92, 0.5, 0.06), 0, 1.38, 0.02), '#8a6238'));
    L.push(tint(put(new THREE.BoxGeometry(0.98, 0.05, 0.1), 0, 1.655, 0.02), '#5a3c22'));
    // the carved fish: body, tail, eye (flat shapes just proud of the board)
    const body = new THREE.Shape();
    body.moveTo(0.3, 0); body.quadraticCurveTo(0.12, 0.15, -0.14, 0.05); body.lineTo(-0.3, 0.14); body.lineTo(-0.25, 0); body.lineTo(-0.3, -0.14); body.lineTo(-0.14, -0.05); body.quadraticCurveTo(0.12, -0.15, 0.3, 0);
    L.push(tint(put(new THREE.ShapeGeometry(body, 8), 0, 1.38, 0.056), '#f2e7c8'));
    L.push(tint(put(new THREE.CircleGeometry(0.022, 10), 0.19, 1.4, 0.06), '#3a2a1a'));
    // a little hook line above it
    L.push(tint(put(new THREE.BoxGeometry(0.012, 0.16, 0.012), 0.33, 1.52, 0.056), '#f2e7c8'));
    const g = BGU().mergeGeometries(L.map(clean), false);
    g.computeVertexNormals();
    return g;
  }
  /** the float (찌): red top, white body, dark stem — a little larger than life so a child sees it */
  function floatMesh() {
    const L = [];
    L.push(tint(put(new THREE.SphereGeometry(0.075, 12, 8), 0, 0.02, 0), '#f5f2ea'));
    L.push(tint(put(new THREE.ConeGeometry(0.06, 0.2, 12), 0, 0.17, 0), '#e2432f'));
    L.push(tint(put(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), 0, 0.34, 0), '#f7c63a'));
    L.push(tint(put(new THREE.ConeGeometry(0.05, 0.16, 12), 0, -0.1, 0, PI, 0, 0), '#3a3530'));
    const m = new THREE.Mesh(BGU().mergeGeometries(L.map(clean), false), matV());
    m.geometry.computeVertexNormals();
    m.name = 'fish-float'; m.castShadow = false;
    return m;
  }
  /** a bamboo rod of four tapering joints that bend at their knots (children of each other) */
  function rodObject() {
    const root = new THREE.Group(); root.name = 'fish-rod';
    const joints = [];
    let parent = root;
    const lens = [1.05, 0.95, 0.8, 0.6], rad = [0.018, 0.014, 0.01, 0.006, 0.003];
    for (let i = 0; i < 4; i++) {
      const g = tint(put(new THREE.CylinderGeometry(rad[i + 1], rad[i], lens[i], 6), 0, lens[i] / 2, 0), i % 2 ? '#b8963c' : '#c9a548');
      const seg = new THREE.Mesh(g, matV()); seg.castShadow = false;
      const j = new THREE.Group(); j.add(seg);
      if (i > 0) j.position.y = lens[i - 1];
      parent.add(j); parent = j; joints.push(j);
    }
    const tip = new THREE.Object3D(); tip.position.y = lens[3]; parent.add(tip);
    root.userData = { joints, tip, length: lens.reduce((a, b) => a + b, 0) };
    return root;
  }
  /** the 견지: a short handle with the flat wooden reel */
  function gyeonjiObject() {
    const root = new THREE.Group(); root.name = 'fish-gyeonji';
    const L = [];
    L.push(tint(put(new THREE.CylinderGeometry(0.014, 0.018, 0.42, 6), 0, 0.21, 0), '#8a6238'));
    L.push(tint(put(new THREE.BoxGeometry(0.2, 0.3, 0.02), 0, 0.5, 0), '#c9a26a'));
    L.push(tint(put(new THREE.BoxGeometry(0.14, 0.22, 0.03), 0, 0.5, 0), '#efe6d2'));
    const m = new THREE.Mesh(BGU().mergeGeometries(L.map(clean), false), matV()); m.geometry.computeVertexNormals(); m.castShadow = false;
    root.add(m);
    const tip = new THREE.Object3D(); tip.position.y = 0.66; root.add(tip);
    root.userData = { joints: [], tip, length: 0.66 };
    return root;
  }
  /** the 족대: two poles with a sagging net between them (lines) */
  function netObject() {
    const root = new THREE.Group(); root.name = 'fish-net';
    const L = [];
    for (const sx of [-0.55, 0.55]) L.push(tint(put(new THREE.CylinderGeometry(0.016, 0.02, 1.25, 6), sx, 0.5, 0, 0.25, 0, 0), '#9a7442'));
    const poles = new THREE.Mesh(BGU().mergeGeometries(L.map(clean), false), matV()); poles.geometry.computeVertexNormals(); poles.castShadow = false;
    root.add(poles);
    const pts = [];
    const P = (u, v) => { const x = lerp(-0.55, 0.55, u), sag = Math.sin(u * PI) * Math.sin(v * PI * 0.5 + 0.2) * 0.34; return [x, lerp(0.95, 0.02, v) + 0.0, -sag - v * 0.12]; };
    for (let i = 0; i <= 10; i++) for (let j = 0; j < 8; j++) { pts.push(...P(i / 10, j / 8), ...P(i / 10, (j + 1) / 8)); if (i < 10) pts.push(...P(i / 10, j / 8), ...P((i + 1) / 10, j / 8)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const net = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe9e2cf, transparent: true, opacity: 0.85 }));
    root.add(net);
    return root;
  }
  /** the 어항: a clear bulb with a funnel mouth, a cord and a stake on the bank */
  function trapObject() {
    const root = new THREE.Group(); root.name = 'fish-trap';
    const prof = [[0.0, 0.0], [0.12, 0.01], [0.17, 0.08], [0.17, 0.22], [0.11, 0.32], [0.06, 0.36], [0.085, 0.4]].map(([x, y]) => new THREE.Vector2(x, y));
    const bulb = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), new THREE.MeshLambertMaterial({ color: 0xbfe3ea, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
    bulb.rotation.z = PI / 2; bulb.position.y = 0.17; bulb.castShadow = false; bulb.renderOrder = 3;
    root.add(bulb);
    const bait = new THREE.Mesh(tint(new THREE.SphereGeometry(0.045, 8, 6), '#7a5230'), matV()); bait.position.set(0.12, 0.12, 0); root.add(bait);
    return root;
  }

  // ---------------------------------------------------------------- where the rivers are
  /** the valley river at z: centre x and the unit tangent (downstream = +z) */
  function valleyAt(z) {
    const pts = G.data.layout?.river?.points || [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (z >= a[1] && z <= b[1]) { const t = (z - a[1]) / (b[1] - a[1]); const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { x: lerp(a[0], b[0], t), tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l }; }
    }
    return null;
  }
  /** resolve a valley spot of the data: the stand on the bank, the place the float lands, the sign */
  function resolveValley(def) {
    const W = G.world, L = G.data.layout || {};
    const hw = ((L.river && L.river.width) || 16) / 2, wy = L.waterY ?? -1.1;
    for (const dz of [0, 2, -2, 4, -4, 6, -6, 9, -9]) {
      const c = valleyAt(def.z + dz);
      if (!c) continue;
      // the normal that points to the wanted bank
      let nx = c.tz, nz = -c.tx;
      if ((def.side === 'west') !== (nx < 0)) { nx = -nx; nz = -nz; }
      let edge = -1;
      for (let d = 1; d <= hw + 14; d += 0.25) { const x = c.x + nx * d, z = def.z + dz + nz * d; if (!W.isWater(x, z) && W.terrainHeight(x, z) > wy + 0.1) { edge = d; break; } }
      if (edge < 0) continue;
      let sx = c.x + nx * (edge + 1.25), sz = def.z + dz + nz * (edge + 1.25), onDeck = false;
      if (def.deck && L.riverDeck && dz === 0) {
        // the deck is the place to stand only when its edge reaches the water; otherwise the bank in front of it
        const ex = L.riverDeck.x + L.riverDeck.w / 2 - 0.8, ez = L.riverDeck.z;
        if (Math.hypot(ex - (c.x + nx * edge), ez - (def.z + nz * edge)) <= 3.2) { sx = ex; sz = ez; onDeck = true; }
      }
      if (W.isWater(sx, sz)) continue;
      if (!onDeck && W.blocked?.(sx, sz, 0.45, W.heightAt(sx, sz))) continue;
      const wd = Math.max(1.6, edge - 2.9);
      const wx = c.x + nx * wd, wz = def.z + dz + nz * wd;
      if (!W.isWater(wx, wz)) continue;
      // the sign stands a step to the side of the angler, back from the water
      const gx = sx + nx * 0.9 + c.tx * 1.3, gz = sz + nz * 0.9 + c.tz * 1.3;
      return { x: sx, z: sz, y: W.heightAt(sx, sz), wx, wz, wy, gx, gz, gy: W.heightAt(gx, gz), nx, nz, tx: c.tx, tz: c.tz, hw, cx: c.x, cz: def.z + dz };
    }
    return null;
  }
  /** the same for the river of 만장대 단지, in plan coordinates (C = G.data.complex) */
  function resolveComplex(def, C) {
    const R = C.byId?.('RIVER');
    if (!R || !Array.isArray(R.pts)) return null;
    const pts = R.pts, hw = (R.w || 18) / 2;
    for (const dz of [0, 3, -3, 6, -6, 10, -10, 15, -15]) {
      const z0 = def.z + dz;
      let c = null;
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (z0 >= a[1] && z0 <= b[1]) { const t = (z0 - a[1]) / (b[1] - a[1]); const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; c = { x: lerp(a[0], b[0], t), tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l }; break; } }
      if (!c) continue;
      let nx = c.tz, nz = -c.tx;
      if ((def.side === 'east') !== (nx > 0)) { nx = -nx; nz = -nz; }
      let edge = -1;
      for (let d = hw - 1; d <= hw + 16; d += 0.25) { const x = c.x + nx * d, z = z0 + nz * d; if (!C.inWater(x, z) && C.walkable(x, z) && C.height(x, z) > C.waterY(c.x, z0) + 0.15) { edge = d; break; } }
      if (edge < 0) continue;
      const sx = c.x + nx * (edge + 0.9), sz = z0 + nz * (edge + 0.9);
      if (!C.walkable(sx, sz)) continue;
      const wd = hw - 3.2;
      const wx = c.x + nx * wd, wz = z0 + nz * wd;
      if (!C.inWater(wx, wz)) continue;
      const gx = sx + nx * 0.9 + c.tx * 1.3, gz = sz + nz * 0.9 + c.tz * 1.3;
      return { x: sx, z: sz, y: C.height(sx, sz), wx, wz, wy: C.waterY(wx, wz), gx, gz, gy: C.height(gx, gz), nx, nz, tx: c.tx, tz: c.tz, hw, cx: c.x, cz: z0 };
    }
    return null;
  }

  // ---------------------------------------------------------------- schools: instanced silhouettes
  const SCHOOL_PARS = 'attribute vec3 aSwim;\nattribute float aPhase;\nuniform vec3 uSwim;\n';
  const SCHOOL_MAIN = 'transformed.z += sin(uSwim.x * (0.8 + fract(aPhase) * 0.5) + aPhase * 6.2832 - aSwim.x * uSwim.y) * uSwim.z * aSwim.y;\n';
  const MAX_PER_KIND = 40;
  class Schools {
    constructor(parent, waterYAt, inWater) {
      this.parent = parent; this.waterYAt = waterYAt; this.inWater = inWater;
      this.uniforms = { uSwim: { value: new THREE.Vector3(0, 6.5, 0.09) } };
      this.meshes = {}; this.list = []; this._acc = 0;
      for (const kind of ['fusi', 'deep', 'long', 'flat']) {
        const geo = G.fishkit.silhouette(kind).clone();
        geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND), 1));
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        mat.onBeforeCompile = (sh) => { sh.uniforms.uSwim = this.uniforms.uSwim; sh.vertexShader = SCHOOL_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SCHOOL_MAIN); };
        mat.customProgramCacheKey = () => 'fish-school';
        const m = new THREE.InstancedMesh(geo, mat, MAX_PER_KIND);
        m.name = 'fish-school:' + kind; m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        parent.add(m); this.meshes[kind] = m;
      }
    }
    /** a school of a species round a spot (r = the resolved spot in the parent's coordinates) */
    add(spotId, r, speciesId, n) {
      const sp = FD().byId[speciesId];
      if (!sp) return;
      const fish = [];
      // seen from the bank a 10 cm fish is a speck: schools are drawn about twice life size, the big ones less so
      const len = clamp((sp.size.usual[0] + sp.size.usual[1]) / 200 * 2.1, 0.2, 0.62);
      for (let i = 0; i < n; i++) fish.push({ a: rnd() * TAU, r: 0.25 + rnd() * 0.9, w: 0.5 + rnd() * 0.7, d: 0.22 + rnd() * 0.5, s: len * (0.85 + rnd() * 0.3), ph: rnd() });
      const c = new THREE.Color(sp.look.colours.back).lerp(new THREE.Color(sp.look.colours.side), 0.25);
      this.list.push({ spotId, id: speciesId, kind: G.fishkit.kindOf(speciesId), fish, col: c, hx: r.wx, hz: r.wz, cx: r.wx, cz: r.wz, tx: r.tx, tz: r.tz, nx: r.nx, nz: r.nz, hw: r.hw, rx: r.cx, rz: r.cz, along: (rnd() - 0.5) * 6, across: 0, dir: rnd() < 0.5 ? 1 : -1, flee: 0, t: rnd() * 10, bottom: sp.habitat.includes('stone') || sp.habitat.includes('gravel') });
    }
    clear() { this.list.length = 0; for (const m of Object.values(this.meshes)) m.count = 0; }
    /** fish near (x, z) dart away (someone splashed in) */
    scare(x, z, radius) {
      let n = 0;
      for (const s of this.list) if (Math.hypot(s.cx - x, s.cz - z) < (radius || 5)) { s.flee = 2.6; s.fx = x; s.fz = z; n++; }
      return n;
    }
    update(dt, t, eye) {
      this._acc += dt;
      if (this._acc < 1 / 30) return;
      const step = Math.min(this._acc, 0.1); this._acc = 0;
      this.uniforms.uSwim.value.x = t * 7;
      const count = { fusi: 0, deep: 0, long: 0, flat: 0 };
      for (const s of this.list) {
        if (eye && Math.hypot(s.hx - eye.x, s.hz - eye.z) > 70) continue;
        s.t += step;
        // the school wanders along the river about its home and a little across it
        const fleeing = s.flee > 0;
        if (fleeing) {
          s.flee -= step;
          const dx = s.cx - s.fx, dz = s.cz - s.fz, dl = Math.hypot(dx, dz) || 1;
          s.along += ((dx / dl) * s.tx + (dz / dl) * s.tz) * 3.2 * step;
          s.across += ((dx / dl) * s.nx + (dz / dl) * s.nz) * 2.0 * step;
        } else {
          s.along += s.dir * 0.32 * step * (0.6 + 0.4 * Math.sin(s.t * 0.21));
          if (Math.abs(s.along) > 7) s.dir = -Math.sign(s.along);
          s.across += (Math.sin(s.t * 0.13 + s.hx) * 1.4 - s.across) * 0.4 * step;
        }
        s.along = clamp(s.along, -11, 11); s.across = clamp(s.across, -2.2, 2.6);
        s.cx = s.hx + s.tx * s.along + s.nx * s.across; s.cz = s.hz + s.tz * s.along + s.nz * s.across;
        const m = this.meshes[s.kind];
        const heading = Math.atan2(-(s.tz * s.dir), s.tx * s.dir);
        const spread = fleeing ? 1 + (2.6 - Math.max(0, s.flee)) * 1.2 : 1;
        for (const f of s.fish) {
          const k = count[s.kind];
          if (k >= MAX_PER_KIND) break;
          const a = f.a + s.t * f.w * 0.35 * (fleeing ? 2.4 : 1);
          const x = s.cx + (Math.cos(a) * f.r * 1.5 * s.tx - Math.sin(a) * f.r * s.nx) * spread;
          const z = s.cz + (Math.cos(a) * f.r * 1.5 * s.tz - Math.sin(a) * f.r * s.nz) * spread;
          if (!this.inWater(x, z)) continue;
          const y = this.waterYAt(x, z) - (s.bottom ? 0.45 + f.d * 0.5 : f.d);
          const yaw = heading + Math.sin(a) * 0.5 * (fleeing ? 2 : 1);
          _q.setFromEuler(_e.set(0, yaw, 0)); _s.setScalar(f.s);
          m.setMatrixAt(k, _m.compose(_v.set(x, y, z), _q, _s));
          m.setColorAt(k, s.col);
          m.geometry.attributes.aPhase.setX(k, f.ph + k);
          count[s.kind] = k + 1;
        }
      }
      for (const kind of Object.keys(count)) {
        const m = this.meshes[kind];
        m.count = count[kind]; m.visible = count[kind] > 0;
        if (count[kind]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.geometry.attributes.aPhase.needsUpdate = true; }
      }
    }
    get visibleFish() { return Object.values(this.meshes).reduce((a, m) => a + (m.visible ? m.count : 0), 0); }
    get drawCalls() { return Object.values(this.meshes).filter((m) => m.visible && m.count > 0).length; }
    dispose() { for (const m of Object.values(this.meshes)) { m.parent?.remove(m); m.geometry.dispose(); m.material.dispose(); } this.list.length = 0; }
  }

  // ---------------------------------------------------------------- the system
  const IDLE = () => ({ phase: 'idle', spot: null, method: null, bait: null, t: 0 });
  const sys = {
    name: 'fishing', order: 63, label: '낚시',
    state: IDLE(),
    _spots: new Map(),      // id → { def, r (resolved, WORLD coordinates), place, handle, label, trapObj }
    _root: null, _schools: null, _cxSchools: null, _ui: null, _gear: null, _rings: [], _held: false, _misses: 0,

    // ------------------------------------------------------------ life cycle
    init() {
      if (!FD() || !G.fishkit) { G.log.warn(CAT, 'the fish data or the fish kit is missing: fishing is off'); return; }
      const eng = G.sys.engine;
      if (!eng?.scene) return;
      this._root = new THREE.Group(); this._root.name = 'fishing';
      eng.scene.add(this._root);
      // the session's gear (rod, line, float, rings, the landing fish) lives in WORLD coordinates and shows in every place
      this._gearRoot = new THREE.Group(); this._gearRoot.name = 'fishing-gear';
      eng.scene.add(this._gearRoot);
      try { G.sys.places?.hideRoot?.('fishing'); } catch (e) { /* places optional */ }
      this._buildValley();
      this._buildUi();
      G.ui.onAction?.('fish-book', () => this.book());
      G.ui.onEscape?.(() => { if (this.state.phase !== 'idle' && !G.ui.modal.isOpen()) { this.cancel('escape'); return true; } return false; }, 60);
      window.addEventListener('keydown', (e) => this._key(e, true), true);
      window.addEventListener('keyup', (e) => this._key(e, false), true);
      const off = () => { this.cancel('session'); _san = null; };
      G.bus.on('state:loaded', () => { _san = null; fst(); syncStats(); this._syncTraps(); });
      G.bus.on('game:logout', off);
      G.bus.on('place:exit', () => this.cancel('place'));
      G.bus.on('place:enter', () => this.cancel('place'));
      fst(); syncStats(); this._syncTraps();
    },

    /** the valley's spots: signs (one merged mesh), interactables, labels, schools */
    _buildValley() {
      const defs = FD().spots.filter((s) => s.river === 'valley');
      const signs = [];
      const W = G.world;
      this._schools = new Schools(this._root, () => G.data.layout?.waterY ?? -1.1, (x, z) => W.isWater(x, z));
      for (const def of defs) {
        let r = null;
        try { r = resolveValley(def); } catch (e) { G.log.warn(CAT, `spot ${def.id} could not be placed`, e?.message || e); }
        if (!r) { G.log.warn(CAT, `spot ${def.id}: no free place on the bank`); continue; }
        const rec = { def, r, place: null, handle: null, trapObj: null };
        this._spots.set(def.id, rec);
        signs.push(put(signGeometry(), r.gx, r.gy, r.gz, 0, Math.atan2(-r.nx, -r.nz) + PI, 0));
        try { W.addCollider?.({ shape: 'circle', x: r.gx, z: r.gz, r: 0.16, tag: 'sign' }); } catch (e) { /* cosmetic */ }
        if (G.data.layout?.anchors) G.data.layout.anchors[def.id] = { id: def.id, x: r.x, z: r.z, name: def.name, title: def.name };
        rec.handle = G.interact?.register?.({
          id: def.id, kind: 'fishspot', emoji: () => (this._trapReady(def.id) ? '🫙' : '🎣'),
          label: () => (this._trapReady(def.id) ? `🫙 어항 살펴보기 · ${def.name}` : `🎣 낚시하기 · ${def.name}`),
          kidLabel: () => (this._trapReady(def.id) ? '어항을 봐요' : '낚시해요'),
          position: () => _v2.set(r.gx, r.gy + 1.2, r.gz), radius: 3.4, priority: 1,
          enabled: () => this.state.phase === 'idle' && site('fishing.enabled', true) !== false,
          onInteract: () => this.open(def.id),
        }) || null;
        this._seedSchools(this._schools, def, r);
      }
      if (signs.length) {
        const m = new THREE.Mesh(BGU().mergeGeometries(signs, false), matV());
        m.name = 'fish-signs'; m.castShadow = true; m.receiveShadow = true;
        this._root.add(m); this._signs = m;
      }
    },
    /** two or three schools of the spot's species (who is there this month) */
    _seedSchools(schools, def, r) {
      const k = kst();
      const seen = new Set();
      for (const method of def.methods) for (const c of FD().candidates({ spot: def, method, month: k.mo, hour: 12, weather: 'CLEAR' }).sort((a, b) => b.w - a.w)) {
        if (seen.size >= 3) break;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        schools.add(def.id, r, c.id, FD().byId[c.id].size.usual[1] > 20 ? 3 : 7 + Math.floor(rnd() * 5));
      }
    },

    // ------------------------------------------------------------ the complex's river (a part of PL_ALLOT)
    _complexPart(ctx, C) {
      const self = this;
      if (!FD() || !G.fishkit) return { dispose() {} };
      const defs = FD().spots.filter((s) => s.river === 'complex');
      const group = new THREE.Group(); group.name = 'fishing-complex';
      ctx.group.add(group);
      const O = ctx.origin || { x: 0, z: 0 };
      const signs = [], made = [];
      const schools = new Schools(group, (x, z) => { const y = C.waterY(x, z); return Number.isFinite(y) ? y : 0; }, (x, z) => C.inWater(x, z));
      for (const def of defs) {
        let r = null;
        try { r = resolveComplex(def, C); } catch (e) { G.log.warn(CAT, `spot ${def.id} could not be placed`, e?.message || e); }
        if (!r) { G.log.warn(CAT, `spot ${def.id}: no free place on the bank`); continue; }
        signs.push(put(signGeometry(), r.gx, r.gy, r.gz, 0, Math.atan2(-r.nx, -r.nz) + PI, 0));
        try { ctx.addCollider?.({ shape: 'circle', x: r.gx, z: r.gz, r: 0.16, tag: 'sign' }); } catch (e) { /* cosmetic */ }
        // the same spot in WORLD coordinates for the session
        const fy = Number(self._floorY) || 0;
        const w = Object.assign({}, r, { x: r.x + O.x, z: r.z + O.z, wx: r.wx + O.x, wz: r.wz + O.z, gx: r.gx + O.x, gz: r.gz + O.z, cx: r.cx + O.x, cz: r.cz + O.z, y: r.y + fy, wy: r.wy + fy, gy: r.gy + fy });
        const rec = { def, r: w, local: r, place: ctx.id, handle: null, trapObj: null, group };
        self._spots.set(def.id, rec); made.push(def.id);
        rec.handle = ctx.interact({
          id: def.id, kind: 'fishspot', emoji: () => (self._trapReady(def.id) ? '🫙' : '🎣'),
          label: () => (self._trapReady(def.id) ? `🫙 어항 살펴보기 · ${def.name}` : `🎣 낚시하기 · ${def.name}`),
          kidLabel: () => (self._trapReady(def.id) ? '어항을 봐요' : '낚시해요'),
          position: { x: r.gx, y: r.gy + 1.2, z: r.gz }, radius: 3.4, priority: 1,
          enabled: () => self.state.phase === 'idle' && site('fishing.enabled', true) !== false,
          onInteract: () => self.open(def.id),
        });
        self._seedSchools(schools, def, r);
      }
      if (signs.length) { const m = new THREE.Mesh(BGU().mergeGeometries(signs, false), matV()); m.name = 'fish-signs'; m.castShadow = true; group.add(m); }
      self._cxSchools = schools; self._cxGroup = group;
      self._syncTraps();
      return {
        update(dt, t) { try { const p = G.sys.player?.position; schools.update(dt, t, p ? { x: p.x - O.x, z: p.z - O.z } : null); self._scareCheck(schools, O); } catch (e) { /* cosmetic */ } },
        dispose() { schools.dispose(); for (const id of made) self._spots.delete(id); if (self._cxSchools === schools) { self._cxSchools = null; self._cxGroup = null; } group.parent?.remove(group); },
      };
    },

    // ------------------------------------------------------------ public reads
    spots() {
      return FD().spots.map((d) => { const rec = this._spots.get(d.id); return { id: d.id, name: d.name, kidName: d.kidName, emoji: d.emoji, river: d.river, place: rec ? rec.place : (d.river === 'complex' ? 'PL_ALLOT' : null), methods: d.methods.slice(), habitat: d.habitat.slice(), x: rec ? rec.r.x : null, y: rec ? rec.r.y : null, z: rec ? rec.r.z : null, ready: !!rec, trap: this._trapInfo(d.id) }; });
    },
    nearestSpot() {
      const p = G.sys.player?.position, cur = G.sys.places?.current || null;
      let best = null, bd = Infinity;
      for (const [id, rec] of this._spots) { if ((rec.place || null) !== cur) continue; const d = p ? Math.hypot(rec.r.x - p.x, rec.r.z - p.z) : 0; if (d < bd) { bd = d; best = { id, name: rec.def.name, x: rec.r.x, z: rec.r.z }; } }
      return best;
    },
    keepLimit() { return clamp(Math.round(Number(site('fishing.keep_per_day', FD().rules.keepPerDay)) || 0), 0, 20); },
    keptToday() { const f = fst(); if (!f) return 0; const k = kst().key; return f.day.key === k ? f.day.kept : 0; },
    trapMinutes() { return clamp(Number(site('fishing.trap_minutes', FD().rules.trapMinutes)) || FD().rules.trapMinutes, 0.05, 240); },

    // ------------------------------------------------------------ traps (real time)
    _trapInfo(spotId) {
      const t = fst()?.traps?.[spotId];
      if (!t) return null;
      const left = t.at + this.trapMinutes() * 60000 - now();
      return { at: t.at, bait: t.bait, ready: left <= 0, leftMs: Math.max(0, left) };
    },
    _trapReady(spotId) { const i = this._trapInfo(spotId); return !!(i && i.ready); },
    /** the 어항 that stand in the water are shown where they were set */
    _syncTraps() {
      const f = fst();
      for (const [id, rec] of this._spots) {
        const want = !!(f && f.traps[id]);
        if (want && !rec.trapObj) {
          const o = trapObject();
          const r = rec.local || rec.r;
          // in the shallows by the bank, half under water, its mouth downstream
          const d = 1.6;
          o.position.set(r.x - r.nx * d + r.tx * 0.6, r.wy - 0.2, r.z - r.nz * d + r.tz * 0.6);
          o.rotation.y = Math.atan2(-r.tz, r.tx);
          (rec.group || this._root).add(o); rec.trapObj = o;
        } else if (!want && rec.trapObj) { rec.trapObj.parent?.remove(rec.trapObj); rec.trapObj = null; }
      }
    },

    // ------------------------------------------------------------ the chooser
    async open(spotId) {
      const rec = this._spots.get(spotId);
      if (!rec || !G.state || this.state.phase !== 'idle') return false;
      if (site('fishing.enabled', true) === false) { G.ui.toast('지금은 낚시를 쉬고 있어요.', { emoji: '🎣' }); return false; }
      const def = rec.def, F = FD();
      const trap = this._trapInfo(spotId);
      if (trap && trap.ready) return this.start(spotId, 'trap');
      const k = kst(), band = F.hourBand(k.hour), wz = WEATHER_KO[weatherNow()] || WEATHER_KO.CLEAR;
      const cond = `${wz[0]} ${wz[1]} · ${F.hourBands[band].name} · ${k.mo}월`;
      if (easyOn()) {
        const items = def.methods.map((m) => ({ id: m, emoji: F.methods[m].emoji, label: F.methods[m].kidName, sub: m === 'trap' && trap ? '기다리는 중' : '', say: `${F.methods[m].kidName}. ${F.methods[m].kid}` }));
        items.push({ id: '__book', emoji: '📖', label: '물고기 도감', say: '물고기 도감. 만난 물고기를 봐요.' });
        const pick = await G.easy.pick({ id: 'fish-pick', title: `${def.emoji} ${def.kidName}`, say: `${def.kidName}에 왔어요. 어떻게 낚시할까요?`, emoji: '🎣', text: cond, items, columns: Math.min(3, items.length) });
        if (!pick) return false;
        if (pick === '__book') { this.book(); return false; }
        return this.start(spotId, pick);
      }
      return new Promise((resolve) => {
        let method = def.methods[0], bait = null, done = false;
        const m = G.ui.modal.open({
          id: 'fish-choose', title: `낚시터 · ${def.name}`, icon: '🎣', className: 'fish-choose-modal', size: 'md',
          body: (el) => {
            const draw = () => {
              el.textContent = '';
              el.appendChild(h('p', { class: 'fish-cond' }, `${cond} · 오늘 데려간 물고기 ${this.keptToday()} / ${this.keepLimit()}마리`));
              el.appendChild(h('p', { class: 'fish-place' }, def.habitat.map((x) => `${F.habitats[x].emoji} ${F.habitats[x].name}`).join(' · ')));
              const row = h('div', { class: 'fish-methods', role: 'radiogroup', 'aria-label': '낚시 방법' });
              for (const id of def.methods) {
                const M = F.methods[id];
                row.appendChild(h('button', { type: 'button', class: `fish-method${id === method ? ' is-on' : ''}`, role: 'radio', 'aria-checked': id === method ? 'true' : 'false', onclick: () => { method = id; bait = null; draw(); } },
                  h('span', { class: 'emoji', 'aria-hidden': 'true' }, M.emoji), h('b', {}, M.name), h('small', {}, id === 'trap' && trap ? `기다리는 중 · ${Math.ceil(trap.leftMs / 60000)}분 남음` : M.kid)));
              }
              el.appendChild(row);
              el.appendChild(h('p', { class: 'fish-desc' }, F.methods[method].desc));
              const baits = F.methods[method].baits;
              if (baits.length) {
                const br = h('div', { class: 'fish-baits', role: 'radiogroup', 'aria-label': '미끼' });
                if (!bait || !baits.includes(bait)) bait = this._defaultBait(method);
                for (const b of baits) {
                  const ok = b !== 'doenjang' || this._hasDoenjang();
                  br.appendChild(h('button', { type: 'button', class: `fish-bait${b === bait ? ' is-on' : ''}`, role: 'radio', 'aria-checked': b === bait ? 'true' : 'false', disabled: ok ? null : '', title: ok ? F.baits[b].kid : '장독에서 된장을 익히면 미끼로 쓸 수 있어요.', onclick: () => { bait = b; draw(); } },
                    h('span', { class: 'emoji', 'aria-hidden': 'true' }, F.baits[b].emoji), F.baits[b].name));
                }
                el.appendChild(br);
                el.appendChild(h('p', { class: 'fish-desc' }, F.baits[bait].kid));
              }
              const who = F.candidates({ spot: def, method, bait, month: k.mo, hour: k.hour, weather: weatherNow() }).sort((a, b) => b.w - a.w).slice(0, 4).map((c) => F.byId[c.id].name);
              if (who.length) el.appendChild(h('p', { class: 'fish-who' }, `지금 이곳에서 잘 만나는 물고기: ${who.join(' · ')}`));
            };
            draw();
          },
          actions: [
            { label: '📖 어류 도감', onClick: () => { this.book(); return false; }, close: false },
            { label: '낚시 시작', class: 'btn-primary', onClick: () => { done = true; setTimeout(() => resolve(this.start(spotId, method, { bait })), 0); } },
          ],
          onClose: () => { if (!done) resolve(false); },
        });
        if (!m) resolve(false);
      });
    },
    _hasDoenjang() { try { return (G.sys.inventory?.count?.('ITEM_DOENJANG') || 0) > 0; } catch (e) { return false; } },
    _defaultBait(method) {
      const b = FD().methods[method].baits;
      if (!b.length) return null;
      if (method === 'trap') return this._hasDoenjang() ? 'doenjang' : 'paste';
      return b[0];
    },

    // ------------------------------------------------------------ a session
    start(spot, method, opts) {
      const id = typeof spot === 'string' ? spot : spot?.id;
      const rec = this._spots.get(id);
      const F = FD();
      if (!rec || !G.state || !F || this.state.phase !== 'idle') return false;
      if (!F.methods[method] || !rec.def.methods.includes(method)) return false;
      if ((rec.place || null) !== (G.sys.places?.current || null)) return false;
      const p = G.sys.player;
      if (!p?.position) return false;
      let bait = opts && opts.bait && F.methods[method].baits.includes(opts.bait) ? opts.bait : this._defaultBait(method);
      if (bait === 'doenjang' && !this._hasDoenjang()) bait = 'paste';
      const r = rec.r;
      this.state = { phase: 'walk', spot: id, method, bait, t: 0, misses: 0, caught: 0 };
      this._rec = rec; this._held = false; this._misses = 0;
      try { G.ui.block('fishing'); } catch (e) { /* ui optional */ }
      const arrive = () => { if (this.state.phase !== 'walk' || this.state.spot !== id) return; this._arrive(); };
      const far = Math.hypot(p.position.x - r.x, p.position.z - r.z);
      this._walkT = 0;
      if (far > 0.5) {
        let ok = false;
        try { ok = p.walkTo({ x: r.x, z: r.z }, { stopDistance: 0.25, onArrive: arrive, onFail: () => this._snapToSpot(arrive), path: far > 4, rescue: false, trail: false }) !== false; } catch (e) { ok = false; }
        if (!ok) this._snapToSpot(arrive);
      } else arrive();
      G.bus.emit('fishing:start', { spot: id, method });
      return true;
    },
    _snapToSpot(done) {
      const p = G.sys.player, r = this._rec?.r;
      if (!p || !r) return;
      try { p.cancelWalk?.('action'); } catch (e) { /* fine */ }
      p.position.set(r.x, G.world.heightAt(r.x, r.z, r.y + 0.5), r.z);
      if (p.velocity) p.velocity.set(0, 0, 0);
      done();
    },
    _arrive() {
      const p = G.sys.player, r = this._rec.r, st = this.state;
      try { p.cancelWalk?.('action'); } catch (e) { /* fine */ }
      p.rotY = Math.atan2(r.wx - r.x, r.wz - r.z); p._faceT = null;
      if (p.velocity) p.velocity.set(0, 0, 0);
      this._hud(false);
      this._showUi(true);
      this._gearFor(st.method);
      this._camT = 0;
      if (st.method === 'trap') this._trapStep();
      else if (st.method === 'net') this._phase('net-ready');
      else this._phase('ready');
      if (!fst().tut) { fst().tut = 1; dirty(); }
    },
    _hud(on) { try { G.ui.setHudVisible?.(on); } catch (e) { /* hud optional */ } document.body.classList.toggle('fishing-on', !on); },
    /** end the session: everything back as it was */
    cancel(reason) {
      const st = this.state;
      if (st.phase === 'idle') return false;
      const was = { spot: st.spot, method: st.method };
      this.state = IDLE();
      this._held = false;
      try { G.sys.player?.cancelWalk?.('action'); } catch (e) { /* fine */ }
      try { G.sys.player?.rig?.stopAction?.(); } catch (e) { /* fine */ }
      try { G.ui.modal.get('fish-card')?.close({ instant: true }); } catch (e) { /* fine */ }
      this._clearGear();
      this._showUi(false);
      this._hud(true);
      try { G.ui.unblock('fishing'); } catch (e) { /* ui optional */ }
      try { const c = G.sys.camera; if (c?.mode === 'shot') { c.setMode('follow'); c.behind?.(G.sys.player?.rotY || 0, false); } } catch (e) { /* camera optional */ }
      G.bus.emit('fishing:end', Object.assign({ reason: reason || 'done' }, was));
      return true;
    },

    // ------------------------------------------------------------ gear in the world
    _gearFor(method) {
      this._clearGear();
      const g = { method, rod: null, line: null, float: null, net: null, biter: null, fish: null };
      const root = this._gearRoot;
      if (method === 'rod' || method === 'gyeonji') {
        g.rod = method === 'rod' ? rodObject() : gyeonjiObject();
        root.add(g.rod);
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
        g.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xf2f6f6, transparent: true, opacity: 0.9 }));
        g.line.frustumCulled = false; g.line.visible = false; root.add(g.line);
        g.float = floatMesh(); g.float.visible = false; root.add(g.float);
        if (method === 'gyeonji') g.float.scale.setScalar(0.001);
      } else if (method === 'net') {
        g.net = netObject(); g.net.visible = false; g.net.rotation.order = 'YXZ'; root.add(g.net);
        const sm = new THREE.Mesh(tint(new THREE.SphereGeometry(0.34, 10, 6), '#7b7f78'), matV()); sm.scale.set(1, 0.5, 0.8); sm.visible = false; sm.castShadow = false;
        g.stone = sm; root.add(sm);
      }
      // a shadow that comes to the bait / runs for the net
      const bm = new THREE.Mesh(G.fishkit.silhouette('fusi'), new THREE.MeshBasicMaterial({ color: 0x1d2a2a, transparent: true, opacity: 0.0, depthWrite: false }));
      bm.visible = false; bm.castShadow = false; bm.renderOrder = 1; g.biter = bm; root.add(bm);
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.74, 0.82, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -PI / 2; ring.visible = false; ring.userData = { t: -1, dur: 1.6, max: 1.8 }; ring.renderOrder = 4;
        root.add(ring); this._rings.push(ring);
      }
      this._gear = g;
    },
    _clearGear() {
      const g = this._gear;
      if (g) for (const k of ['rod', 'line', 'float', 'net', 'biter', 'stone']) { const o = g[k]; if (!o) continue; o.parent?.remove(o); o.traverse?.((x) => { if (x.isMesh || x.isLine) { if (x.geometry && !x.geometry.userData?.shared && x.name !== '' ) { /* small one-off geometries: let GC take them */ } } }); }
      if (g?.fish) { try { g.fish.userData.fish.dispose(); } catch (e) { /* gone */ } }
      for (const r of this._rings) { r.parent?.remove(r); r.geometry.dispose(); r.material.dispose(); }
      this._rings.length = 0;
      this._gear = null;
    },
    /** a ring that spreads on the water at (x, z) */
    _ring(x, z, y, o) {
      const r = this._rings.find((q) => q.userData.t < 0) || this._rings[0];
      if (!r) return;
      r.position.set(x, y + 0.03, z); r.userData.t = 0; r.userData.dur = (o && o.dur) || 1.7; r.userData.max = (o && o.max) || 1.7; r.userData.a = (o && o.a) || 0.55; r.visible = true;
    },
    _splash(x, z, y, big) {
      try { G.fx?.burst?.({ x, y: y + 0.05, z }, { type: 'splash', count: big ? 16 : 8 }); } catch (e) { /* fx optional */ }
      this._ring(x, z, y, { max: big ? 2.2 : 1.4 });
      sfx(big ? 'splash' : 'drip', { volume: big ? 0.7 : 0.6, at: { x, z } });
    },

    // ------------------------------------------------------------ phases
    _phase(name, extra) {
      const st = this.state;
      st.phase = name; st.t = 0;
      if (extra) Object.assign(st, extra);
      this._renderUi();
    },
    /** the big action: pressed (down) or let go */
    press(down) {
      const st = this.state;
      const d = down !== false;
      if (st.phase === 'idle' || st.phase === 'walk' || st.phase === 'card' || G.ui.modal.isOpen()) return false;
      if (!d) { this._held = false; return true; }
      this._held = true;
      const R = FD().rules;
      switch (st.phase) {
        case 'ready': this._cast(); return true;
        case 'wait': {
          // too early: nothing is lost, the fish just takes a little longer
          st.early = Math.min(3, (st.early || 0) + 1);
          st.biteAt += 0.6;
          this._hint('아직이에요. 찌가 물속으로 쏙 들어가면 눌러요.', '아직이에요. 찌가 쏙 들어가면 눌러요.');
          return true;
        }
        case 'bite': this._hooked(); return true;
        case 'net-ready': this._phase('net-set'); sfx('water', { volume: 0.5 }); return true;
        case 'net-run': {
          if (st.t >= st.winA && st.t <= st.winB) this._landFromNet(); else this._hint('조금만 더 기다려요. 그림자가 족대 위에 올 때 들어요.', '그림자가 족대에 오면 들어요.');
          return true;
        }
        default: return R ? true : false;
      }
    },
    release() { return this.press(false); },
    _key(e, down) {
      if (this.state.phase === 'idle' || this.state.phase === 'walk') return;
      if (G.ui.modal.isOpen() || (G.util.isTyping && G.util.isTyping())) return;
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault(); e.stopPropagation();
        if (down && e.repeat) return;
        this.press(down);
      }
    },
    _hint(normal, kid, opts) {
      const text = easyOn() ? (kid || normal) : normal;
      this.state.hint = text;
      if (this._ui) { this._ui.hint.textContent = text; }
      if (!(opts && opts.quiet)) say(text, { interrupt: false });
    },
    _cast() {
      const st = this.state, r = this._rec.r;
      this._phase('cast');
      try { G.sys.player?.rig?.setAnim?.('point', { loop: true }); } catch (e) { /* anim optional */ }
      sfx('whoosh', { volume: 0.5 });
      // where the float lands: the spot's place in the water, a little different every time
      st.fx = r.wx + r.tx * (rnd() - 0.5) * 2.4; st.fz = r.wz + r.tz * (rnd() - 0.5) * 2.4;
      if (st.method === 'gyeonji') { st.fx += r.tx * 1.2; st.fz += r.tz * 1.2; }
    },
    _beginWait() {
      const st = this.state, F = FD(), R = F.rules;
      const k = kst();
      const list = F.candidates({ spot: this._rec.def, method: st.method, bait: st.bait, month: k.mo, hour: k.hour, weather: weatherNow() });
      const forced = dbg.force && F.byId[dbg.force] ? dbg.force : null;
      st.fish = forced || F.pick(list, rnd);
      const range = easyOn() ? R.waitSeconds.easy : R.waitSeconds.normal;
      st.biteAt = st.fish ? lerp(range[0], range[1], rnd()) : 9999;
      st.early = 0; st.nibbled = false;
      this._phase('wait');
      if (!st.fish) this._hint('오늘은 물고기가 숨었나 봐요. 다른 방법이나 다른 자리를 골라 봐요.', '물고기가 숨었어요. 다른 곳에 가 봐요.');
      else if (st.method === 'gyeonji') this._hint('줄이 물살을 타고 흘러가요. 줄이 팽팽해지며 톡톡 떨리면 눌러요.', '줄이 톡톡 떨리면 눌러요.');
      else this._hint('찌를 잘 봐요. 찌가 물속으로 쏙 들어가면 눌러요.', '찌가 쏙 들어가면 눌러요.');
      if (this._schoolsNow()) this._schoolsNow().scare(st.fx - (this._rec.place ? this._rec.r.x - this._rec.local.x : 0), st.fz - (this._rec.place ? this._rec.r.z - this._rec.local.z : 0), 1.2);
    },
    _schoolsNow() { return this._rec?.place ? this._cxSchools : this._schools; },
    _biteWindow() {
      const R = FD().rules, sp = FD().byId[this.state.fish];
      const d = sp ? sp.difficulty : 1;
      const base = easyOn() ? R.biteWindow.easy : R.biteWindow.normal;
      let w = base - (d - 1) * (easyOn() ? 0.15 : 0.1);
      if (this._misses >= 2) w *= 1.5;     // two misses in a row: the next bite waits longer for the child
      return Math.max(R.biteWindow.min, w);
    },
    _bite() {
      const st = this.state;
      st.window = this._biteWindow();
      this._phase('bite');
      sfx('drip', { volume: 0.9 }); setTimeout(() => sfx('pop', { volume: 0.7 }), 140);
      try { navigator.vibrate?.(80); } catch (e) { /* no vibration */ }
      this._splash(st.fx, st.fz, this._rec.r.wy, false);
      this._hint(st.method === 'gyeonji' ? '지금이에요! 줄을 당겨요!' : '지금이에요! 낚싯대를 당겨요!', '지금이에요! 눌러요!');
      this._pulseBtn();
    },
    _miss() {
      const st = this.state;
      this._misses++;
      st.misses = (st.misses || 0) + 1;
      this._phase('missed');
      sfx('oops', { volume: 0.5 });
      this._hint('물고기가 미끼만 먹고 갔어요. 괜찮아요, 다시 던져 봐요.', '물고기가 먹이만 먹고 갔어요. 괜찮아요!');
    },
    _hooked() {
      const st = this.state, sp = FD().byId[st.fish];
      if (!sp) return this._miss();
      this._misses = 0;
      st.mm = FD().rollLength(sp, rnd);
      // how hard it pulls: bigger and harder fish take longer, never long
      st.prog = 0; st.tension = 0.35; st.surge = 0; st.nextSurge = 1.6 + rnd() * 1.4; st.idle = 0; st.hot = 0;
      st.rate = clamp(0.34 - sp.difficulty * 0.03 - Math.min(0.08, st.mm / 5000), 0.14, 0.34);
      this._phase('reel');
      sfx('turn', { volume: 0.6 });
      this._hint('꾹 눌러서 감아요. 물고기가 세게 당기면 잠깐 손을 떼요.', '꾹 눌러서 감아요. 빨간 칸에서는 잠깐 쉬어요.');
    },
    _escape(why) {
      this._phase('missed');
      sfx('oops', { volume: 0.5 });
      if (why === 'snap') this._hint('줄이 너무 팽팽했어요. 물고기가 빠져나갔어요. 다음에는 물고기가 세게 당길 때 잠깐 쉬어요.', '물고기가 달아났어요. 괜찮아요, 다시 해 봐요!');
      else this._hint('물고기가 슬그머니 빠져나갔어요. 괜찮아요, 다시 던져 봐요.', '물고기가 달아났어요. 괜찮아요!');
    },
    _landFromNet() {
      const st = this.state;
      sfx('splash', { volume: 0.7 });
      try { G.sys.player?.rig?.setAnim?.('harvest', { restart: true }); } catch (e) { /* anim optional */ }
      if (st.neighbour) { this._phase('land', { landKind: 'neighbour' }); return; }
      const sp = FD().byId[st.fish];
      if (!sp) return this._miss();
      st.mm = FD().rollLength(sp, rnd);
      this._phase('land', { landKind: 'fish' });
    },

    // ------------------------------------------------------------ the trap
    async _trapStep() {
      const st = this.state, id = st.spot, F = FD(), f = fst();
      const info = this._trapInfo(id);
      this._phase('trap');
      if (!info) {
        const n = Object.keys(f.traps).length;
        if (n >= F.rules.trapMax) { await this._tell('🫙', '어항이 모자라요', `어항은 ${F.rules.trapMax}개까지 놓을 수 있어요. 먼저 놓아 둔 어항을 살펴봐요.`); return this.cancel('trap-max'); }
        f.traps[id] = { at: now(), bait: st.bait || 'paste' };
        dirty(); this._syncTraps();
        const r = this._rec.r;
        this._splash(r.x - r.nx * 1.6, r.z - r.nz * 1.6, r.wy, false);
        try { G.sys.player?.rig?.setAnim?.('harvest', { restart: true }); } catch (e) { /* anim optional */ }
        const min = this.trapMinutes();
        const mt = min >= 1 ? `${Math.round(min)}분` : '조금';
        await this._tell('🫙', '어항을 놓았어요', `${josa(F.baits[f.traps[id].bait].name, '을/를')} 넣은 어항을 물속에 두었어요. ${mt} 뒤에 다시 와서 살펴봐요. 그동안 다른 놀이를 해도 돼요.`, `어항을 놓았어요. ${mt} 뒤에 와서 봐요.`);
        G.bus.emit('fish:trap', { spot: id, set: true });
        return this.cancel('trap-set');
      }
      if (!info.ready) {
        const left = Math.max(1, Math.ceil(info.leftMs / 60000));
        const take = await G.ui.confirm(`물고기가 들어오기를 기다리는 중이에요. ${left}분쯤 남았어요. 지금 어항을 그냥 거둘까요?`, { title: '어항이 기다리는 중', icon: '🫙', okText: '그냥 거두기', cancelText: '더 기다리기', yes: '거둘래요', no: '기다릴래요', emoji: '🫙', heading: '어항', say: `${left}분쯤 더 기다려야 해요. 지금 거둘까요?` });
        if (take && this.state.phase === 'trap') { delete f.traps[id]; dirty(); this._syncTraps(); }
        return this.cancel('trap-wait');
      }
      // ready: one to three small fish, decided by when it was set (the same answer however often it is asked)
      const seedRnd = G.util.rng((info.at % 2147483647) ^ (id.length * 7919));
      const k = kst();
      const list = F.candidates({ spot: this._rec.def, method: 'trap', bait: info.bait, month: k.mo, hour: k.hour, weather: weatherNow() });
      const count = F.rules.trapFish[0] + Math.floor(seedRnd() * (F.rules.trapFish[1] - F.rules.trapFish[0] + 1));
      const catches = [];
      for (let i = 0; i < count; i++) { const sid = dbg.force && F.byId[dbg.force] ? dbg.force : F.pick(list, seedRnd); if (sid) catches.push({ id: sid, mm: F.rollLength(F.byId[sid], seedRnd) }); }
      delete f.traps[id]; dirty(); this._syncTraps();
      sfx('splash', { volume: 0.6 });
      try { G.sys.player?.rig?.setAnim?.('harvest', { restart: true }); } catch (e) { /* anim optional */ }
      if (!catches.length) { await this._tell('🫙', '어항이 비었어요', '이번에는 아무도 들어오지 않았어요. 미끼를 바꾸거나 다른 자리에 놓아 봐요.', '어항이 비었어요. 다시 놓아 봐요.'); return this.cancel('trap-empty'); }
      for (const c of catches) {
        if (this.state.phase !== 'trap') return;
        await this._landed(c.id, c.mm, 'trap');
      }
      if (this.state.phase === 'trap') this.cancel('trap-done');
    },
    _tell(emoji, title, text, kid) {
      const t = easyOn() ? (kid || text) : text;
      try { return G.ui.alert(t, { title, icon: emoji, emoji, heading: title, say: t, ok: '알았어요', okText: '알았어요' }); } catch (e) { return Promise.resolve(); }
    },

    // ------------------------------------------------------------ a fish is landed
    /** record the meeting, show the card, keep or release; resolves when the card is answered */
    async _landed(id, mm, method) {
      const F = FD(), sp = F.byId[id], f = fst(), st = this.state;
      if (!sp || !f || !G.state) return;
      const prevPhase = st.phase;
      st.phase = 'card';
      const first = !f.book[id];
      const b = f.book[id] || (f.book[id] = { n: 0, kept: 0, rel: 0, max: 0, first: now() });
      b.n++; b.max = Math.max(b.max, mm);
      const S = G.state.stats;
      S.fishCaught = (Number(S.fishCaught) || 0) + 1;
      syncStats(); dirty();
      const R = F.rules;
      const reward = { exp: R.expByDifficulty[sp.difficulty] || 6, edu: 0 };
      if (first) { reward.exp += R.firstBonus.exp; reward.edu += R.firstBonus.edu; }
      try { G.sys.progression?.grant?.(reward, { reason: 'fishing', popup: false, silent: true }); } catch (e) { /* progression optional */ }
      if (first) { try { G.sys.progression?.unlockCollection?.(`COL_FISH_${id}`, { silent: true }); } catch (e) { /* sticker book optional */ } }
      try { G.sys.progression?.checkAchievements?.(); } catch (e) { /* optional */ }
      G.bus.emit('fish:landed', { id, method, spot: st.spot, mm, protected: !!sp.protected, first });
      try { G.activity?.('fishing', `${josa(sp.name, '을/를')} 만났어요 (${(mm / 10).toFixed(1)} cm)`); } catch (e) { /* journal optional */ }
      st.caught = (st.caught || 0) + 1;
      const choice = await this._card(sp, mm, first);
      if (!G.state || fst() !== f) return;
      if (choice === 'keep') {
        const k = kst();
        if (f.day.key !== k.key) { f.day.key = k.key; f.day.kept = 0; }
        let got = 0;
        try { got = G.sys.inventory?.add?.(F.itemId(id), 1, { source: 'fishing' }) || 0; } catch (e) { got = 0; }
        if (got > 0) {
          f.day.kept++; b.kept++;
          S.fishKept = (Number(S.fishKept) || 0) + 1;
          G.bus.emit('fish:kept', { id, itemId: F.itemId(id), mm });
          G.ui.toast(easyOn() ? `${josa(sp.name, '을/를')} 바구니에 담았어요.` : `${sp.name} 1마리를 가방에 담았어요. 부엌에서 익혀서 요리해요. (오늘 ${f.day.kept} / ${this.keepLimit()})`, { emoji: '🧺', type: 'success' });
        } else {
          b.rel++; S.fishReleased = (Number(S.fishReleased) || 0) + 1;
          G.ui.toast('가방이 가득 차서 물로 돌려보냈어요.', { emoji: '🌊' });
          G.bus.emit('fish:released', { id, protected: !!sp.protected, mm });
        }
      } else {
        b.rel++;
        S.fishReleased = (Number(S.fishReleased) || 0) + 1;
        try { G.sys.progression?.grant?.({ exp: R.releaseBonus.exp }, { reason: 'fishing', popup: false, silent: true }); } catch (e) { /* optional */ }
        const r = this._rec?.r;
        if (r) this._splash(r.wx, r.wz, r.wy, false);
        const line = sp.protected ? `${josa(sp.name, '을/를')} 지켜 줘서 고마워요!` : `${josa(sp.name, '이/가')} 물로 돌아갔어요. 다음에 또 만나요!`;
        G.ui.toast(line, { emoji: sp.protected ? '🛟' : '🌊', type: 'success', say: line });
        G.bus.emit('fish:released', { id, protected: !!sp.protected, mm });
      }
      syncStats(); dirty();
      try { G.sys.progression?.checkAchievements?.(); } catch (e) { /* optional */ }
      if (this.state === st && st.phase === 'card') st.phase = prevPhase === 'trap' ? 'trap' : 'card-done';
    },
    /** a clean-water neighbour turned up in the net: looked at, never taken */
    async _neighbour(nb) {
      const f = fst(), st = this.state;
      st.phase = 'card';
      const first = !f.seen[nb.id];
      f.seen[nb.id] = 1; dirty();
      G.bus.emit('fish:seen', { id: nb.id, first });
      if (first) { try { G.sys.progression?.grant?.({ exp: 15, edu: 1 }, { reason: 'fishing', popup: false, silent: true }); } catch (e) { /* optional */ } }
      await new Promise((resolve) => {
        const line = `${josa(nb.name, '을/를')} 만났어요! ${nb.kid} 살펴보고 제자리에 놓아줘요.`;
        G.ui.modal.open({
          id: 'fish-card', title: `${josa(nb.name, '을/를')} 만났어요`, icon: nb.emoji, className: 'fish-card-modal fish-neighbour', size: 'md', say: line,
          body: (el) => {
            el.appendChild(h('div', { class: 'fish-nb-pic', 'aria-hidden': 'true' }, nb.emoji));
            el.appendChild(h('p', { class: 'fish-sci' }, nb.sci));
            if (nb.protected) el.appendChild(h('p', { class: 'fish-chip is-guard' }, `🛟 ${nb.protected.label}`));
            el.appendChild(h('p', { class: 'fish-kid' }, nb.kid));
            const ul = h('ul', { class: 'fish-facts' }); for (const t of nb.facts) ul.appendChild(h('li', {}, t)); el.appendChild(ul);
            el.appendChild(h('p', { class: 'fish-note' }, `${FD().water[nb.grade].short}에 사는 이웃이에요. 맑은 물의 지표 생물은 데려가지 않고 눈으로만 봐요.`));
            el.appendChild(h('div', { class: 'fish-card-actions' }, h('button', { type: 'button', class: 'btn btn-primary fish-big', 'data-say': '놓아주기. 제자리에 놓아줘요.', onclick: () => G.ui.modal.get('fish-card')?.close() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🌊'), '놓아주기')));
          },
          onClose: () => resolve(),
        });
      });
      if (this.state === st && st.phase === 'card') st.phase = 'card-done';
    },
    /** the catch card → Promise<'keep' | 'release'> (closing it releases the fish) */
    _card(sp, mm, first) {
      const F = FD();
      const k = kst();
      const can = F.canKeep(sp, k.mo, k.d);
      const limit = this.keepLimit(), kept = this.keptToday();
      const full = can.ok && kept >= limit;
      const spawning = sp.spawn.includes(k.mo);
      const cm = (mm / 10).toFixed(1);
      const eul = josa(sp.name, '을/를').slice(sp.name.length);
      let why = '';
      if (can.why === 'protected') why = sp.protected.kind === 'care' ? sp.protected.note : `${sp.protected.label}이에요. ${sp.protected.note} 눈으로 보고 바로 놓아줘요.`;
      else if (can.why === 'closed') why = `${sp.closed.say} 오늘은 놓아줘요.`;
      else if (full) why = `오늘은 먹을 만큼 데려갔어요 (${kept} / ${limit}마리). 이제는 놓아주기만 해요.`;
      const sayLine = `${sp.name}${eul} 만났어요! ${sp.kid} ${why || (spawning ? '지금은 알을 낳는 철이에요. 놓아주면 더 좋아요.' : '')}`.trim();
      return new Promise((resolve) => {
        let answer = 'release', view = null;
        const close = () => G.ui.modal.get('fish-card')?.close();
        const m = G.ui.modal.open({
          id: 'fish-card', title: `${sp.name}${eul} 만났어요!`, icon: sp.protected ? '🛟' : '🐟', className: `fish-card-modal${sp.protected ? ' is-protected' : ''}`, size: 'md', say: sayLine,
          body: (el) => {
            const wrap = h('div', { class: 'fish-view' });
            const cv = h('canvas', { class: 'fish-canvas', width: 640, height: 384, 'aria-label': `${sp.name}의 모습` });
            wrap.appendChild(cv);
            if (first) wrap.appendChild(h('div', { class: 'fish-stamp', 'aria-hidden': 'true' }, '새 도감!'));
            el.appendChild(wrap);
            try { view = G.fishkit.studio.show(cv, sp.id, { month: k.mo, turn: !reduced() }); } catch (e) { view = null; }
            el.appendChild(h('p', { class: 'fish-sci' }, h('i', {}, sp.sci), ` · ${sp.family}${sp.endemic ? ' · 우리나라 고유종' : ''}`));
            const chips = h('div', { class: 'fish-chips' });
            chips.appendChild(h('span', { class: 'fish-chip' }, `📏 길이 ${cm} cm`));
            if (mm >= sp.size.usual[1] * 10) chips.appendChild(h('span', { class: 'fish-chip is-big' }, '🌟 큰 녀석이에요'));
            if (sp.protected) chips.appendChild(h('span', { class: 'fish-chip is-guard' }, `🛟 ${sp.protected.label}`));
            if (can.why === 'closed') chips.appendChild(h('span', { class: 'fish-chip is-guard' }, '📅 잡지 않는 때'));
            if (spawning && can.ok) chips.appendChild(h('span', { class: 'fish-chip is-care' }, '🥚 알 낳는 철'));
            el.appendChild(chips);
            el.appendChild(h('p', { class: 'fish-kid' }, sp.kid));
            el.appendChild(h('p', { class: 'fish-sign' }, sp.sign));
            if (why) el.appendChild(h('p', { class: 'fish-why' }, why));
            else if (spawning) el.appendChild(h('p', { class: 'fish-why is-soft' }, '지금은 알을 낳는 철이에요. 놓아주면 내년에 더 많은 친구를 만날 수 있어요.'));
            const act = h('div', { class: 'fish-card-actions' });
            act.appendChild(h('button', { type: 'button', class: `btn fish-big ${can.ok && !full ? '' : 'btn-primary'}`, 'data-say': '놓아주기. 물로 돌려보내요.', onclick: () => { answer = 'release'; close(); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🌊'), '놓아주기'));
            if (can.ok && !full) act.appendChild(h('button', { type: 'button', class: 'btn btn-primary fish-big', 'data-say': '데려가기. 바구니에 담아 부엌으로 가져가요.', onclick: () => { answer = 'keep'; close(); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧺'), '데려가기'));
            el.appendChild(act);
            el.appendChild(h('button', { type: 'button', class: 'btn btn-ghost fish-more', onclick: () => { this.book(sp.id); } }, '📖 도감에서 더 보기'));
          },
          onClose: () => { try { view?.stop(); } catch (e) { /* gone */ } resolve(answer); },
        });
        if (!m) resolve('release');
        if (first) { sfx('stamp', { volume: 0.7 }); try { G.fx?.kidParty && easyOn() && G.fx.kidParty(null, { rain: false, burst: true, emoji: '🐟' }); } catch (e) { /* fx optional */ } }
        else sfx('reward', { volume: 0.5 });
      });
    },

    /** the catch card of a species as a preview: nothing is recorded (developer centre, kid audit) → Promise<'keep' | 'release' | null> */
    preview(id) {
      const sp = FD() && FD().byId[id];
      return sp && G.state ? this._card(sp, FD().rollLength(sp, rnd), false) : Promise.resolve(null);
    },

    // ------------------------------------------------------------ the 어류 도감
    book(openId) {
      const F = FD(), f = fst();
      if (!F || !f) return false;
      let tab = 'fish', detail = openId && F.byId[openId] ? openId : null, view = null;
      const stopView = () => { try { view?.stop(); } catch (e) { /* gone */ } view = null; };
      const k = kst();
      const m = G.ui.modal.open({
        id: 'fish-book', title: '어류 도감', icon: '📖', className: 'fish-book-modal', size: 'md', say: '어류 도감. 만난 물고기에 도장이 찍혀요.',
        body: (el) => {
          const draw = () => {
            stopView();
            el.textContent = '';
            if (detail) return drawDetail(F.byId[detail]);
            const met = Object.keys(f.book).length;
            el.appendChild(h('div', { class: 'fish-book-head' },
              h('div', { class: 'fish-tabs', role: 'tablist' },
                ...[['fish', `🐟 물고기 ${met} / ${F.species.length}`], ['nb', `🦞 이웃 ${Object.keys(f.seen).length} / ${F.neighbours.length}`], ['know', '💡 알아 두기']].map(([id, label]) => h('button', { type: 'button', role: 'tab', class: `fish-tab${tab === id ? ' is-on' : ''}`, 'aria-selected': tab === id ? 'true' : 'false', onclick: () => { tab = id; draw(); } }, label)))));
            if (tab === 'know') {
              const box = h('div', { class: 'fish-know' });
              for (const kn of F.knowledge) box.appendChild(h('section', { class: 'fish-know-card', 'data-say': `${kn.title}. ${kn.text}` }, h('h3', {}, h('span', { class: 'emoji', 'aria-hidden': 'true' }, kn.emoji), kn.title), h('p', {}, kn.text), kn.sources.length ? h('small', {}, `출처: ${kn.sources.map((s) => F.sources[s].label).join(' · ')}`) : null));
              el.appendChild(box);
              return;
            }
            if (tab === 'nb') {
              const grid = h('div', { class: 'fish-grid is-nb', role: 'list' });
              for (const nb of F.neighbours) {
                const seen = !!f.seen[nb.id];
                grid.appendChild(h('div', { class: `fish-tile${seen ? '' : ' is-locked'}`, role: 'listitem', 'data-say': seen ? `${nb.name}. ${nb.kid}` : '아직 못 만난 이웃이에요. 족대로 돌 밑을 살펴봐요.' },
                  h('div', { class: 'fish-nb-pic', 'aria-hidden': 'true' }, seen ? nb.emoji : '❔'), h('b', {}, seen ? nb.name : '???'), h('small', {}, seen ? nb.kid : '족대로 돌 밑을 살펴봐요')));
              }
              el.appendChild(grid);
              return;
            }
            const grid = h('div', { class: 'fish-grid', role: 'list' });
            for (const sp of F.species) {
              const b = f.book[sp.id];
              const img = h('img', { class: 'fish-thumb', alt: '', width: 240, height: 150, loading: 'lazy' });
              const tile = h('button', { type: 'button', class: `fish-tile${b ? '' : ' is-locked'}${sp.protected ? ' is-protected' : ''}`, role: 'listitem', 'aria-label': b ? `${sp.name}, ${b.n}번 만났어요` : '아직 못 만난 물고기', 'data-say': b ? `${sp.name}. ${sp.kid}` : '아직 못 만난 물고기예요. 눌러서 어디 사는지 봐요.', onclick: () => { detail = sp.id; draw(); } },
                img, h('b', {}, b ? sp.name : '???'), h('small', {}, b ? `${b.n}번 · 가장 큰 ${(b.max / 10).toFixed(1)} cm` : sp.habitat.map((x) => F.habitats[x].emoji).join(' ')),
                b ? h('span', { class: 'fish-seal', 'aria-hidden': 'true' }, sp.protected ? '🛟' : '✔') : null);
              grid.appendChild(tile);
              G.fishkit.studio.thumb(sp.id, { w: 240, h: 150 }).then((url) => { if (url && img.isConnected) img.src = url; });
            }
            el.appendChild(grid);
          };
          const drawDetail = (sp) => {
            const b = f.book[sp.id];
            el.appendChild(h('button', { type: 'button', class: 'btn fish-back', 'data-say': '뒤로. 도감 목록으로 돌아가요.', onclick: () => { detail = null; draw(); } }, '⬅️ 목록으로'));
            const wrap = h('div', { class: `fish-view${b ? '' : ' is-locked'}` });
            const cv = h('canvas', { class: 'fish-canvas', width: 640, height: 384, 'aria-label': `${sp.name}의 모습` });
            wrap.appendChild(cv); el.appendChild(wrap);
            try { view = G.fishkit.studio.show(cv, sp.id, { month: k.mo, turn: !reduced() }); } catch (e) { view = null; }
            el.appendChild(h('h3', { class: 'fish-name' }, sp.name, sp.protected ? h('span', { class: 'fish-chip is-guard' }, `🛟 ${sp.protected.label}`) : null));
            el.appendChild(h('p', { class: 'fish-sci' }, h('i', {}, sp.sci), ` · ${sp.family}${sp.endemic ? ' · 우리나라 고유종' : ''}`));
            if (!b) el.appendChild(h('p', { class: 'fish-why is-soft' }, '아직 만나지 못했어요. 아래에 적힌 곳과 때를 보고 찾아가 봐요.'));
            el.appendChild(h('p', { class: 'fish-kid', 'data-say': sp.kid }, sp.kid));
            const row = (label, text) => h('div', { class: 'fish-row' }, h('dt', {}, label), h('dd', {}, text));
            const dl = h('dl', { class: 'fish-dl' });
            dl.appendChild(row('크기', `보통 ${sp.size.usual[0]}~${sp.size.usual[1]} cm, 큰 것은 ${sp.size.max} cm`));
            dl.appendChild(row('알아보는 법', sp.sign));
            dl.appendChild(row('사는 곳', `${sp.habitat.map((x) => `${F.habitats[x].emoji} ${F.habitats[x].name}`).join(' · ')}`));
            dl.appendChild(row('진짜 고향', sp.home));
            dl.appendChild(row('물길', sp.basin === 'west' ? '한강과 임진강 윗물 (큰 산줄기의 서쪽)' : sp.basin === 'east' ? '동해로 흐르는 강 (큰 산줄기의 동쪽)' : '산줄기 양쪽 모두'));
            dl.appendChild(row('물의 등급', `${F.water[sp.water].short} — ${F.water[sp.water].kid}`));
            dl.appendChild(row('먹이', sp.food));
            dl.appendChild(row('알 낳는 때', `${sp.spawn.join('·')}월`));
            dl.appendChild(row('잘 만나는 때', `${sp.months.join('·')}월 · ${sp.hours.map((x) => F.hourBands[x].name).join(', ')}`));
            dl.appendChild(row('낚시 방법', `${sp.method.map((x) => `${F.methods[x].emoji} ${F.methods[x].name}`).join(' · ')}${sp.bait.length ? ` (미끼: ${sp.bait.map((x) => F.baits[x].name).join(', ')})` : ''}`));
            if (sp.closed) dl.appendChild(row('잡지 않는 때', sp.closed.say));
            dl.appendChild(row('맑은 물이 중요한 까닭', sp.clean));
            if (sp.guard) dl.appendChild(row('누가 지키나요', sp.guard));
            if (b) dl.appendChild(row('내 기록', `${b.n}번 만났어요 · 가장 큰 것 ${(b.max / 10).toFixed(1)} cm · 놓아준 것 ${b.rel}마리${sp.protected ? '' : ` · 데려간 것 ${b.kept}마리`}`));
            el.appendChild(dl);
            const ul = h('ul', { class: 'fish-facts' }); for (const t of sp.facts) ul.appendChild(h('li', {}, t)); el.appendChild(ul);
            el.appendChild(h('p', { class: 'fish-src' }, `출처: ${sp.sources.map((s) => F.sources[s].label).join(' · ')} (쉽게 풀어 쓴 요약)`));
          };
          draw();
        },
        onClose: () => stopView(),
      });
      return !!m;
    },

    // ------------------------------------------------------------ the session's 2D controls
    _buildUi() {
      const root = h('div', { id: 'fishing-ui', class: 'fish-ui', hidden: '' });
      const top = h('div', { class: 'fish-top glass' });
      const chipSpot = h('span', { class: 'fish-top-chip' }), chipCond = h('span', { class: 'fish-top-chip is-cond' });
      const bookBtn = h('button', { type: 'button', class: 'btn fish-top-btn', 'data-say': '물고기 도감. 만난 물고기를 봐요.', onclick: () => this.book() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📖'), h('span', { class: 'fish-top-label' }, '도감'));
      const exit = h('button', { type: 'button', class: 'btn fish-top-btn fish-exit', 'data-say': '그만하기. 낚시를 마쳐요.', onclick: () => this.cancel('button') }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), h('span', { class: 'fish-top-label' }, '그만하기'));
      top.append(exit, chipSpot, chipCond, bookBtn);
      const hint = h('div', { class: 'fish-hint glass', role: 'status', 'aria-live': 'polite' });
      const zone = h('i', { class: 'fish-bar-zone' }), mark = h('i', { class: 'fish-bar-mark' }), prog = h('i', { class: 'fish-bar-fill' }), progFish = h('span', { class: 'emoji' }, '🐟');
      const bar = h('div', { class: 'fish-bar glass', hidden: '', 'aria-hidden': 'true' }, h('div', { class: 'fish-bar-track' }, zone, mark), h('div', { class: 'fish-bar-prog' }, prog, progFish));
      const act = h('button', { type: 'button', class: 'fish-act', 'aria-live': 'polite' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎣'), h('b', {}, '던져요'));
      const down = (e) => { e.preventDefault(); try { act.setPointerCapture?.(e.pointerId); } catch (x) { /* fine */ } this.press(true); };
      const up = (e) => { e.preventDefault(); this.press(false); };
      act.addEventListener('pointerdown', down);
      act.addEventListener('pointerup', up);
      act.addEventListener('pointercancel', up);
      act.addEventListener('contextmenu', (e) => e.preventDefault());
      // keyboard users: Enter / Space on the focused button are handled by the key listener of the session
      act.addEventListener('click', (e) => e.preventDefault());
      root.append(top, hint, bar, act);
      (document.getElementById('app') || document.body).appendChild(root);
      this._ui = { root, top, chipSpot, chipCond, hint, bar, act, mark, prog, progFish, zone };
    },
    _showUi(on) {
      const ui = this._ui;
      if (!ui) return;
      ui.root.hidden = !on;
      if (on) {
        const def = this._rec.def, F = FD(), k = kst(), wz = WEATHER_KO[weatherNow()] || WEATHER_KO.CLEAR;
        ui.chipSpot.textContent = `${F.methods[this.state.method].emoji} ${easyOn() ? def.kidName : def.name}`;
        ui.chipCond.textContent = `${wz[0]} ${F.hourBands[F.hourBand(k.hour)].name} · ${k.mo}월`;
      }
    },
    _pulseBtn() { const a = this._ui?.act; if (!a || reduced()) return; try { a.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' }); } catch (e) { /* no WAAPI */ } },
    /** the button's face for the phase */
    _renderUi() {
      const ui = this._ui, st = this.state;
      if (!ui || st.phase === 'idle') return;
      const set = (emoji, text, o) => {
        ui.act.firstChild.textContent = emoji; ui.act.lastChild.textContent = text;
        ui.act.classList.toggle('is-wait', !!(o && o.wait)); ui.act.classList.toggle('is-go', !!(o && o.go));
        ui.act.disabled = !!(o && o.off);
        ui.act.setAttribute('aria-label', text);
        ui.act.hidden = !!(o && o.hide);
      };
      ui.bar.hidden = st.phase !== 'reel' && st.phase !== 'net-stir';
      ui.bar.classList.toggle('is-stir', st.phase === 'net-stir');
      switch (st.phase) {
        case 'ready': set('🎣', st.method === 'gyeonji' ? '흘려요' : '던져요'); this._hint(st.method === 'gyeonji' ? '여울에 미끼를 흘려보내요. 단추를 눌러요.' : '찌를 물에 던져요. 단추를 눌러요.', st.method === 'gyeonji' ? '단추를 눌러 줄을 흘려요.' : '단추를 눌러 찌를 던져요.'); break;
        case 'cast': set('🌊', '던지는 중', { wait: true }); break;
        case 'wait': set('👀', '기다려요', { wait: true }); break;
        case 'bite': set('❗', '당겨요!', { go: true }); break;
        case 'reel': set('🧵', '감아요'); break;
        case 'land': set('🐟', '올라와요', { wait: true }); break;
        case 'missed': set('💧', '다시 해요', { wait: true }); break;
        case 'net-ready': set('🥅', '족대 대기'); this._hint('족대를 돌 아래쪽 물에 대요. 단추를 눌러요.', '단추를 눌러 족대를 대요.'); break;
        case 'net-set': set('🥅', '대는 중', { wait: true }); break;
        case 'net-stir': set('🪨', '돌 들추기'); this._hint('단추를 꾹 눌러 돌을 살살 들춰요.', '꾹 눌러서 돌을 들춰요.'); break;
        case 'net-run': set('⬆️', '들어요!', { go: true }); break;
        case 'trap': set('🫙', '어항', { hide: true }); break;
        case 'card': case 'card-done': set('🐟', '만났어요', { wait: true }); break;
        default: break;
      }
    },

    // ------------------------------------------------------------ every frame
    update(dt, t) {
      if (!this._root) return;
      const p = G.sys.player?.position;
      // the valley's schools (the complex's are updated by its part)
      if (this._schools && !G.sys.places?.current) {
        try { this._schools.update(dt, t, p || null); this._scareCheck(this._schools, null); } catch (e) { /* cosmetic */ }
      }
      for (const r of this._rings) {
        const u = r.userData;
        if (u.t < 0) continue;
        u.t += dt;
        const q = u.t / u.dur;
        if (q >= 1) { u.t = -1; r.visible = false; r.material.opacity = 0; continue; }
        const s = lerp(0.2, u.max, 1 - Math.pow(1 - q, 2));
        r.scale.set(s, s, 1); r.material.opacity = u.a * (1 - q) * (1 - q);
      }
      const st = this.state;
      if (st.phase === 'idle') return;
      const k = clamp(dbg.speed, 0.1, 60);
      const sdt = dt * k;
      st.t += sdt;
      if (st.phase === 'walk') { this._walkT += dt; if (this._walkT > 6) this._snapToSpot(() => this._arrive()); return; }
      if (!this._rec || !this._gear) return;
      if (!p || Math.hypot(p.x - this._rec.r.x, p.z - this._rec.r.z) > 3) { this.cancel('moved'); return; }
      try { this._step(sdt, t); } catch (e) { G.log.warn(CAT, 'the session stopped', e?.message || e); this.cancel('error'); return; }
      try { this._pose(dt, t); this._camera(dt); } catch (e) { /* cosmetic */ }
    },
    /** fish near the bank dart away when someone runs up to the water */
    _scareCheck(schools, O) {
      const pl = G.sys.player;
      if (!pl?.position || !pl.velocity || this.state.phase !== 'idle') return;
      const sp = Math.hypot(pl.velocity.x, pl.velocity.z);
      if (sp < 5) return;
      const x = pl.position.x - (O ? O.x : 0), z = pl.position.z - (O ? O.z : 0);
      schools.scare(x, z, 5.5);
    },
    _step(dt, t) {
      const st = this.state, g = this._gear, r = this._rec.r, R = FD().rules;
      switch (st.phase) {
        case 'cast': if (st.t >= 0.95) { this._splash(st.fx, st.fz, r.wy, true); this._ring(st.fx, st.fz, r.wy, { max: 2.4, dur: 2.2 }); this._beginWait(); } break;
        case 'wait': {
          if (!st.fish) { if (st.t > 5) { this._phase('ready'); } break; }
          // rings now and then, a shadow that comes close, then two gentle nibbles before the float goes under
          if (Math.floor(st.t / 2.6) !== Math.floor((st.t - dt) / 2.6)) this._ring(st.fx, st.fz, r.wy, { max: 1.1, a: 0.3 });
          if (!st.nibbled && st.t >= st.biteAt - 1.3) { st.nibbled = true; sfx('drip', { volume: 0.45 }); this._ring(st.fx, st.fz, r.wy, { max: 0.9, a: 0.45, dur: 1.2 }); }
          if (st.t >= st.biteAt) this._bite();
          break;
        }
        case 'bite': if (st.t >= st.window) this._miss(); break;
        case 'missed': if (st.t >= 2.4) { this._phase(st.method === 'net' ? 'net-ready' : 'ready'); } break;
        case 'reel': {
          const easy = easyOn();
          // the fish pulls in slow waves; a surge is announced by the bar's colour, never by a flash
          st.nextSurge -= dt;
          if (st.surge <= 0 && st.nextSurge <= 0) { st.surge = 1.1 + rnd() * 0.5; st.nextSurge = 2.4 + rnd() * 1.6; sfx('water', { volume: 0.35 }); }
          const pull = st.surge > 0 ? 1 : 0;
          if (st.surge > 0) st.surge -= dt;
          if (this._held) { st.tension += dt * (0.42 + pull * 0.75); st.idle = 0; } else { st.tension -= dt * 0.8; st.idle += dt; }
          st.tension = clamp(st.tension, 0, 1);
          const inGreen = st.tension >= 0.22 && st.tension <= 0.8;
          if (this._held && inGreen) st.prog += dt * st.rate;
          else if (this._held && st.tension > 0.8) st.prog += dt * st.rate * (easy ? 0.1 : 0.2);
          else if (!this._held) st.prog -= dt * (pull ? 0.05 : 0.015);
          st.prog = clamp(st.prog, 0, 1);
          st.hot = st.tension > 0.96 ? st.hot + dt : 0;
          if (!easy && st.hot > 1.0) { this._escape('snap'); break; }
          if (st.idle > (easy ? 14 : 9)) { this._escape('slack'); break; }
          if (st.prog >= 1) { sfx('splash', { volume: 0.7 }); this._phase('land', { landKind: 'fish' }); }
          break;
        }
        case 'land': {
          if (st.t < 0.05 && !g.fish && st.landKind === 'fish') {
            const sp = FD().byId[st.fish];
            try { g.fish = G.fishkit.build(st.fish, { length: clamp(st.mm / 1000 * 2.2, 0.22, 0.75), month: kst().mo }); if (g.fish) this._gearRoot.add(g.fish); } catch (e) { g.fish = null; }
            if (sp) this._splash(st.fx != null ? st.fx : r.wx, st.fz != null ? st.fz : r.wz, r.wy, true);
          }
          if (st.t >= 1.05) {
            if (g.fish) { try { g.fish.userData.fish.dispose(); } catch (e) { /* gone */ } g.fish = null; }
            const kind = st.landKind;
            (kind === 'neighbour' ? this._neighbour(st.neighbour) : this._landed(st.fish, st.mm, st.method)).then(() => {
              if (this.state !== st) return;
              st.neighbour = null;
              try { G.sys.player?.rig?.stopAction?.(); } catch (e) { /* fine */ }
              this._phase(st.method === 'net' ? 'net-ready' : 'ready');
            });
          }
          break;
        }
        case 'net-set': if (st.t >= 0.9) { this._phase('net-stir', { stir: 0 }); } break;
        case 'net-stir': {
          if (this._held) st.stir += dt / 1.4; else st.stir = Math.max(0, st.stir - dt * 0.4);
          if (Math.floor(st.t / 0.9) !== Math.floor((st.t - dt) / 0.9) && this._held) { sfx('bubble', { volume: 0.5 }); this._ring(st.nx0, st.nz0, r.wy, { max: 0.8, a: 0.35, dur: 1.1 }); }
          if (st.stir >= 1) {
            // who was under the stone?
            const F = FD(), kk = kst();
            const list = F.candidates({ spot: this._rec.def, method: 'net', month: kk.mo, hour: kk.hour, weather: weatherNow() });
            const nbs = F.neighbours.filter((n) => n.id !== 'SUDAL' && n.where.some((w) => this._rec.def.habitat.includes(w)));
            st.neighbour = null; st.fish = null;
            if (dbg.force && F.byId[dbg.force]) st.fish = dbg.force;
            else if (dbg.force && F.neighbours.some((n) => n.id === dbg.force)) st.neighbour = F.neighbours.find((n) => n.id === dbg.force);
            else if (nbs.length && rnd() < 0.2) st.neighbour = nbs[Math.floor(rnd() * nbs.length)];
            else st.fish = F.pick(list, rnd);
            if (!st.fish && !st.neighbour) { this._hint('이 돌 밑에는 아무도 없었어요. 다시 해 봐요.', '아무도 없었어요. 다시 해 봐요!'); this._phase('missed'); break; }
            const sp = st.fish ? F.byId[st.fish] : null;
            // the shadow takes a moment to reach the net and stays over it for a wide moment
            const lead = 0.9 + rnd() * 0.5, stay = Math.max(1.5, (easyOn() ? 2.8 : 1.9) - (sp ? sp.difficulty - 1 : 0) * 0.12);
            this._phase('net-run', { winA: lead, winB: lead + stay, runEnd: lead + stay + 0.7 });
            sfx('drip', { volume: 0.7 });
            try { navigator.vibrate?.(60); } catch (e) { /* no vibration */ }
            this._hint('그림자가 족대 쪽으로 가요! 족대 위에 오면 들어요.', '그림자가 족대에 오면 들어요!');
            this._pulseBtn();
          }
          break;
        }
        case 'net-run': if (st.t >= st.runEnd) { this._misses++; this._phase('missed'); sfx('oops', { volume: 0.5 }); this._hint('물고기가 족대 옆으로 빠져나갔어요. 괜찮아요, 다시 해 봐요.', '옆으로 빠져나갔어요. 괜찮아요!'); } break;
        default: break;
      }
      // the bar
      const ui = this._ui;
      if (ui && st.phase === 'reel') {
        ui.mark.style.transform = `translateX(${(st.tension * 100).toFixed(1)}%)`;
        ui.prog.style.transform = `scaleX(${st.prog.toFixed(3)})`;
        ui.progFish.style.transform = `translateX(${(st.prog * 100).toFixed(1)}%)`;
        ui.bar.classList.toggle('is-hot', st.tension > 0.8);
        const lab = st.tension > 0.8 ? '쉬어요' : '감아요';
        if (ui.act.lastChild.textContent !== lab) { ui.act.lastChild.textContent = lab; ui.act.firstChild.textContent = st.tension > 0.8 ? '✋' : '🧵'; }
      } else if (ui && st.phase === 'net-stir') {
        ui.prog.style.transform = `scaleX(${clamp(st.stir, 0, 1).toFixed(3)})`;
        ui.progFish.style.transform = `translateX(${(clamp(st.stir, 0, 1) * 100).toFixed(1)}%)`;
      }
    },
    /** rod, line, float, net, the shadow, the landing fish — where they are this frame */
    _pose(dt, t) {
      const st = this.state, g = this._gear, r = this._rec.r, pl = G.sys.player;
      const px = pl.position.x, py = pl.position.y, pz = pl.position.z;
      const dirx = (r.wx - r.x), dirz = (r.wz - r.z), dl = Math.hypot(dirx, dirz) || 1, ux = dirx / dl, uz = dirz / dl;
      const wy = r.wy;
      if (g.rod) {
        // the grip is at the right hand; the rod points at the water, lifted — it bows when a fish pulls
        const hand = pl.rig?.handR;
        if (hand?.getWorldPosition) hand.getWorldPosition(_v); else _v.set(px + uz * 0.3, py + 1.0, pz - ux * 0.3);
        if (!(Math.hypot(_v.x - px, _v.z - pz) < 1.5)) _v.set(px + uz * 0.3, py + 1.0, pz - ux * 0.3);
        g.rod.position.copy(_v);
        const cast = st.phase === 'cast' ? st.t / 0.95 : 1;
        const lift = st.phase === 'cast' ? lerp(1.35, 0.55, smooth(0.15, 0.8, cast)) : st.phase === 'reel' ? 0.95 - st.tension * 0.25 : st.phase === 'bite' ? 0.62 : st.phase === 'land' ? 1.2 : 0.7;
        const yaw = Math.atan2(ux, uz);
        g.rod.rotation.set(0, 0, 0);
        g.rod.quaternion.setFromEuler(_eY.set(PI / 2 - lift, yaw, 0, 'YXZ'));
        const bend = st.phase === 'reel' ? 0.1 + st.tension * 0.22 : st.phase === 'bite' ? 0.2 : st.phase === 'land' ? 0.12 : 0.03 + Math.sin(t * 1.3) * 0.006;
        for (let i = 1; i < g.rod.userData.joints.length; i++) g.rod.userData.joints[i].rotation.x = bend * (0.6 + i * 0.35);
        g.rod.updateMatrixWorld(true);
        g.rod.userData.tip.getWorldPosition(_v2);
        // the float
        const fl = g.float;
        let fxp = st.fx, fzp = st.fz, fyp = wy;
        if (st.phase === 'cast') {
          const q = smooth(0.25, 0.95, cast);
          fxp = lerp(_v2.x, st.fx, q); fzp = lerp(_v2.z, st.fz, q); fyp = lerp(_v2.y, wy, q) + Math.sin(q * PI) * 1.6;
          fl.visible = q > 0.02;
        } else if (st.phase === 'wait') {
          const nib = st.nibbled ? Math.sin((st.t - (st.biteAt - 1.3)) * 9) * 0.035 * smooth(0, 0.2, st.t - (st.biteAt - 1.3)) : 0;
          fyp = wy + Math.sin(t * 1.7) * 0.018 + nib;
          if (st.method === 'gyeonji') { const d = Math.min(3, st.t * 0.5); fxp = st.fx + r.tx * d; fzp = st.fz + r.tz * d; }
        } else if (st.phase === 'bite') { fyp = wy - 0.2 * smooth(0, 0.25, st.t) + Math.sin(st.t * 7) * 0.02; if (st.method === 'gyeonji') { fxp = st.fx + r.tx * 3; fzp = st.fz + r.tz * 3; } }
        else if (st.phase === 'reel') { const q = st.prog; fxp = lerp(st.fx, r.x + ux * 1.6, q) + Math.sin(t * 2.1) * 0.35 * (1 - q); fzp = lerp(st.fz, r.z + uz * 1.6, q) + Math.cos(t * 1.7) * 0.35 * (1 - q); fyp = wy - 0.12; if (Math.floor(st.t / 0.8) !== Math.floor((st.t - dt) / 0.8)) this._ring(fxp, fzp, wy, { max: 0.9, a: 0.35, dur: 1.0 }); }
        else if (st.phase === 'land') { const q = smooth(0, 1, st.t / 1.0); fxp = lerp(r.x + ux * 1.6, px + ux * 0.6, q); fzp = lerp(r.z + uz * 1.6, pz + uz * 0.6, q); fyp = lerp(wy, py + 1.25, q) + Math.sin(q * PI) * 0.7; }
        else { fl.visible = false; }
        if (st.phase !== 'ready' && st.phase !== 'missed' && st.phase !== 'card' && st.phase !== 'card-done') { fl.visible = st.phase !== 'cast' || fl.visible; fl.position.set(fxp, fyp, fzp); fl.rotation.z = st.phase === 'bite' ? 0.5 : Math.sin(t * 1.1) * 0.06; } else fl.visible = false;
        if (st.method === 'gyeonji') fl.visible = false;
        this._fp = { x: fxp, y: fyp, z: fzp };
        // the line: from the tip to the float, sagging when slack
        const show = st.phase !== 'ready' && st.phase !== 'missed' && st.phase !== 'card' && st.phase !== 'card-done';
        g.line.visible = show;
        if (show) {
          const A = g.line.geometry.attributes.position;
          const sag = st.phase === 'reel' ? 0.05 + (1 - st.tension) * 0.35 : st.phase === 'bite' ? 0.04 : st.phase === 'cast' ? 0.2 : 0.55;
          for (let i = 0; i < 16; i++) { const q = i / 15; A.setXYZ(i, lerp(_v2.x, fxp, q), lerp(_v2.y, fyp + 0.2, q) - Math.sin(q * PI) * sag, lerp(_v2.z, fzp, q)); }
          A.needsUpdate = true;
        }
        // the landing fish hangs where the float is
        if (g.fish) { g.fish.position.set(fxp, fyp - 0.1, fzp); g.fish.rotation.set(0, yaw + PI / 2, -0.9 + Math.sin(st.t * 14) * 0.25); g.fish.userData.fish.uniforms.uSwim.value.x = t * 14; g.fish.userData.fish.uniforms.uSwim.value.z = 0.07; }
      }
      // the net stands in the shallows in front of the angler
      if (g.net) {
        const nxp = r.x + ux * 2.0, nzp = r.z + uz * 2.0;
        st.nx0 = nxp + ux * 0.9; st.nz0 = nzp + uz * 0.9;
        const on = st.phase !== 'net-ready' && st.phase !== 'card' && st.phase !== 'card-done';
        g.net.visible = on;
        const liftQ = st.phase === 'land' ? smooth(0, 0.6, st.t) : 0;
        const setQ = st.phase === 'net-set' ? smooth(0, 0.9, st.t) : 1;
        g.net.position.set(nxp, lerp(py + 0.9, wy - 0.35, setQ) + liftQ * 0.9, nzp);
        g.net.rotation.set(-0.35 - liftQ * 0.5, Math.atan2(ux, uz), 0);
        g.stone.visible = on;
        const stir = st.phase === 'net-stir' ? st.stir : (st.phase === 'net-run' || st.phase === 'land') ? 1 : 0;
        g.stone.position.set(st.nx0, wy - 0.25 + stir * 0.22, st.nz0);
        g.stone.rotation.set(stir * 0.5, 0.4, 0);
        if (g.fish && st.phase === 'land') { g.fish.position.set(nxp, wy + liftQ * 0.9 - 0.1, nzp); g.fish.rotation.set(0, st.t * 3, 0.3); g.fish.userData.fish.uniforms.uSwim.value.x = t * 14; }
      }
      // the shadow
      const b = g.biter;
      if (b) {
        let vis = false, bx = 0, bz = 0, ang = 0, op = 0;
        const sp = st.fish ? FD().byId[st.fish] : null;
        const len = sp ? clamp((sp.size.usual[0] + sp.size.usual[1]) / 200 * 2.2, 0.22, 0.7) : 0.3;
        if (st.phase === 'wait' && sp && st.t > st.biteAt - 2.6) {
          const q = smooth(st.biteAt - 2.6, st.biteAt - 0.2, st.t), a = t * 1.6;
          const rad = lerp(2.2, 0.35, q);
          bx = this._fp.x + Math.cos(a) * rad; bz = this._fp.z + Math.sin(a) * rad; ang = -a - PI / 2; op = 0.5 * q; vis = true;
        } else if (st.phase === 'bite' && sp) { bx = this._fp.x; bz = this._fp.z; ang = t * 4; op = 0.55; vis = true; }
        else if (st.phase === 'reel' && sp) { bx = this._fp.x; bz = this._fp.z; ang = Math.atan2(-(r.z - this._fp.z), r.x - this._fp.x) + PI + Math.sin(t * 3) * 0.5; op = 0.6; vis = true; }
        else if (st.phase === 'net-run') {
          const q = clamp(st.t / st.winA, 0, 1), away = clamp((st.t - st.winB) / 0.7, 0, 1);
          const nxp = r.x + ux * 2.0, nzp = r.z + uz * 2.0;
          bx = lerp(st.nx0, nxp, smooth(0, 1, q)) + (-uz) * away * 1.8; bz = lerp(st.nz0, nzp, smooth(0, 1, q)) + ux * away * 1.8;
          ang = Math.atan2(-(nzp - st.nz0), nxp - st.nx0); op = 0.65 * (1 - away); vis = true;
        }
        b.visible = vis;
        if (vis) { b.position.set(bx, wy - 0.2, bz); b.rotation.set(0, ang, 0); b.scale.setScalar(len); b.material.opacity = clamp(op, 0, 0.8); }
      }
    },
    /** a calm view over the angler's shoulder, onto the float */
    _camera(dt) {
      const cam = G.sys.camera, pl = G.sys.player, r = this._rec.r;
      if (!cam?.shot || !pl) return;
      const dx = r.wx - r.x, dz = r.wz - r.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const narrow = window.innerHeight > window.innerWidth;
      const back = narrow ? 6.4 : 4.6, up = narrow ? 3.6 : 2.7, side = narrow ? 0.6 : 1.5;
      _camP.set(pl.position.x - ux * back + uz * side, pl.position.y + up, pl.position.z - uz * back - ux * side);
      _camL.set(pl.position.x + ux * dl * 0.62, r.wy + 0.5, pl.position.z + uz * dl * 0.62);
      cam.shot(_camP, _camL, { fov: narrow ? 62 : 52, duration: this._camT ? 0 : 0.7 });
      this._camT = 1;
    },

    // ------------------------------------------------------------ the test seam
    debug: {
      setNow(ms) { dbg.now = ms == null ? null : Number(ms); },
      setSeed(n) { rnd = n == null ? Math.random : G.util.rng(Number(n) || 1); },
      setWeather(id) { dbg.weather = id && WEATHER_KO[id] ? id : null; },
      force(id) { dbg.force = id || null; },
      speed(k) { dbg.speed = Number(k) > 0 ? Number(k) : 1; },
      trapReady(spotId) { const t = fst()?.traps?.[spotId]; if (t) { t.at = now() - sys.trapMinutes() * 60000 - 1000; return true; } return false; },
      info() { return { now: now(), kst: kst(), weather: weatherNow(), spots: sys._spots.size, schools: sys._schools ? { fish: sys._schools.visibleFish, calls: sys._schools.drawCalls, list: sys._schools.list.map((s) => s.id) } : null, cxSchools: sys._cxSchools ? { fish: sys._cxSchools.visibleFish, calls: sys._cxSchools.drawCalls, list: sys._cxSchools.list.map((s) => s.id) } : null, kit: G.fishkit?.stats }; },
    },
  };
  G.register(sys);

  // the river of 만장대 단지: a part of PL_ALLOT (the registry line every complex fragment starts with)
  const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
  CX.add('fishing', (ctx, C) => sys._complexPart(ctx, C), 60);
})();
