// =============================================================================
// 37-cooking.js — the kitchen: stations in the 부엌, a 화덕 by the river, cooking a dish step by step with food that
// changes in 3D, the 소반, the 요리 도감 (G.sys.cooking, CONTRACT §18.4, lane cooking). Data: 36-cooking-data.js.
//
//   G.sys.cooking (order 64)
//     open(stationId?)        the dish picker (the 찬장 opens the pantry, the 양념 선반 the shelf, the 소반 the table)
//     start(dishId, {where: 'kitchen' | 'river'}) -> bool   reserves the ingredients and begins at step 1
//     state                   null | { dish, step, of, where, mode, progress, heat, stars? }   (read-only view)
//     cancel()                stops; nothing is used up (ingredients are taken only when the dish is served)
//     book()                  the 요리 도감 (every dish: thumbnail, best stars, times cooked, what it needs)
//     table()                 the 소반: dishes served (eat · share · photo)
//     pantry()                the 찬장: three of each kitchen staple a real day
//     can(dishId) -> { ok, missing: [{ kind, id, name, where }], fish: [{ itemId, n }] }
//     fishIn(cls) -> [{ itemId, name, count }]   the player's catch of a fish class (protected species never)
//     model(dishId, {cook = 1}) -> THREE.Group   a dish on its vessel (contact sheets, the 도감 thumbnails, tests)
//     thumb(dishId) -> Promise<dataURL | null>    a small picture of the cooked dish (rendered once, cached)
//     timeScale               1 (tests speed the clock up)          stations() -> [{ id, x, y, z, place }]
//   Events: cooking:start {dish} · cooking:step {dish, step, action} · cooking:done {dish, stars, where} ·
//           cooking:share {dish} · cooking:eat {dish} · 'interact' {kind: cooking | cookfish | cookbook | cookjeongseon |
//           cookshare} (quests) · stats dishesCooked / dishKinds / dishesShared / dishStars3 (achievements)
//
// Stations appear in PL_BUEOK when the room is built ('place:built'; 29-interiors-c.js is never rewritten): the 물두멍,
// 가마솥 (+ its 아궁이), 시루, 맷돌 and 절구 that the room already has (found through its anchors: gamasot · siru ·
// agungi · maetdol · soban · salgang), and the new 도마 on a low table, 화로와 석쇠, 솥뚜껑 on three stones over a small fire,
// 양념 선반 (the player's own jar products as little jars) and a serving 소반. Everything static is merged per
// material (one Bucket, ≤ 10 draw calls); a cooking dish adds ≤ 16. By the river (valley) a 화덕 of stones lets a child
// cook a fresh catch outdoors (the dishes marked `outdoor`).
// Cooking: the camera frames the station, the player stands at it, a docked card at the bottom shows the step (big
// buttons; holds instead of fast taps; a turn window ≥ 2.5 s, 4 s in 쉬운 모드; nothing burns, a late turn only costs a
// star). Food changes in 3D: raw → cooked colours drawn into its textures, a grill crust with 석쇠 marks, salt specks,
// broth that clouds and boils with bubbles, steam that rises, rice that swells with 누룽지 at the rim, oil that sizzles.
// Stars = timing (steps) × 0.45 + freshness (the catch's age) × 0.25 + seasoning (my own 장 beats the kitchen's) × 0.3.
// Rewards: no coin or exp per dish (the server could not explain them); quests and achievements carry the rewards.
// Kid rules: no knives as toys (the 손질 is done "with a grown-up"), no blood, no health claims, a 🔥 line on fire steps,
// every screen has ⬅️ / ✖, data-say lines, ≥ 56 px targets, reduce motion → no camera drift and still steam.
// =============================================================================
(function () {
  const C = G.data.cooking;
  if (!C) { G.log.warn('COOK', '36-cooking-data.js missing — no kitchen'); return; }
  try { C.mergeContent(); } catch (e) { G.log.warn('COOK', 'mergeContent failed', e?.message || e); }

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fin = Number.isFinite;
  const now = () => (G.time && typeof G.time.now === 'function' ? G.time.now() : Date.now());
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const reduced = () => !!(G.settings && G.settings.reduceMotion) || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const h = (...a) => G.ui.h(...a);
  const ROOM = 'PL_BUEOK';
  const BK = G.bkit, K = G.hanok;
  const M = BK ? BK.M : null, mul = BK ? BK.mul : null;
  const col = (hex) => new THREE.Color(hex);
  const say = (t) => { try { if (easyOn()) G.easy?.say?.(t); } catch (e) { /* voice optional */ } };
  const sfx = (n, o) => { try { G.sys.audio?.play?.(n, o); } catch (e) { /* audio optional */ } };

  // ---------------------------------------------------------------- stand-in fish items (until 34-fish-data.js lands)
  // Local only (never exported): without lane fishing's items a FISH_ id could not live in the bag at all.
  if (!(G.data.fish && Array.isArray(G.data.fish.species) && G.data.fish.species.length) && !Object.keys(G.data.items).some((k) => k.indexOf('FISH_') === 0)) {
    for (const [cls, fc] of Object.entries(C.fishClasses)) for (const s of fc.standIn) {
      const id = 'FISH_' + s.id;
      if (!G.data.items[id]) G.data.items[id] = { id, name: s.name, type: 'ingredient', icon: '🐟', price: 0, sell: 0, desc: `${fc.name} — 냇가에서 잡은 물고기예요.`, stack: true, max: 20, standIn: true, cook: cls };
    }
  }

  // ---------------------------------------------------------------- state (G.state.cooking)
  function st() {
    const s = G.state;
    if (!s) return null;
    const clean = C.sanitize ? C.sanitize(s.cooking) : null;
    if (clean && s.cooking !== clean) s.cooking = clean;
    if (!s.cooking || typeof s.cooking !== 'object') s.cooking = { v: 1, book: {}, pantry: { day: '', got: {} }, catches: {}, table: [], shared: 0 };
    return s.cooking;
  }
  const dayKey = () => { const d = new Date(now() + 9 * 3600e3); return d.toISOString().slice(0, 10); };   // Korean day

  // ---------------------------------------------------------------- inventory helpers (bag + 곳간)
  const inv = () => G.sys.inventory;
  const store = () => G.sys.storage;
  const countOf = (id) => (Number(inv()?.count?.(id)) || 0) + (store()?.storable?.(id) ? (Number(store()?.count?.(id)) || 0) : 0);
  function takeItem(id, n) {
    let left = n;
    const inBag = Number(inv()?.count?.(id)) || 0;
    const a = Math.min(inBag, left);
    if (a > 0 && inv()?.remove?.(id, a, { source: 'cooking', silent: true })) left -= a;
    if (left > 0 && store()?.storable?.(id)) {
      const moved = Number(store()?.take?.(id, left)) || 0;
      if (moved > 0 && inv()?.remove?.(id, Math.min(moved, left), { source: 'cooking', silent: true })) left -= Math.min(moved, left);
    }
    return n - left;
  }
  const itemName = (id) => G.data.items[id]?.name || id;
  const itemIcon = (id) => G.data.items[id]?.icon || '🥣';
  /** the player's catch of a class: [{itemId, name, count}] (protected species never resolve) */
  function fishIn(cls) {
    return C.fishFor(cls).map((f) => ({ itemId: f.itemId, name: f.name, count: G.data.items[f.itemId] ? countOf(f.itemId) : 0 })).filter((f) => f.count > 0);
  }
  const where = {
    fish: { emoji: '🎣', label: '냇가에서 낚시해요', go: () => goRiver() },
    crop: { emoji: '🌱', label: '밭에서 길러요', go: () => G.easy?.goTo?.('ZONE_CROP', { label: '밭' }) },
    jar: { emoji: '🏺', label: '장독대에서 담가요', go: () => G.easy?.goTo?.('ZONE_JANGDOKDAE', { label: '장독대' }) },
    pantry: { emoji: '🗄️', label: '부엌 찬장에서 꺼내요', go: () => api.pantry() },
    shop: { emoji: '🛍️', label: '가게에서 구해요', go: () => G.sys.inventory?.openShop?.('SHOP_GENERAL') },
  };
  function whereOf(itemId) {
    const d = G.data;
    if (C.pantry.includes(itemId)) return 'pantry';
    if (Object.values(d.crops || {}).some((c) => c.harvestItem === itemId)) return 'crop';
    if (Object.values(d.recipes || {}).some((r) => r.resultItem === itemId)) return 'jar';
    return 'shop';
  }
  /** can this dish be cooked now? -> {ok, missing, plan}  plan = the items the dish will take when it is served */
  function can(dishId) {
    const d = C.dishes[dishId];
    if (!d) return { ok: false, missing: [{ kind: 'dish', id: dishId, name: '?', where: null }], plan: [] };
    const missing = [], plan = [];
    for (const g of d.ingredients) {
      if (g.fish) {
        const have = fishIn(g.fish);
        let need = g.n;
        for (const f of have) { const k = Math.min(f.count, need); if (k > 0) { plan.push({ itemId: f.itemId, n: k, fish: true }); need -= k; } if (!need) break; }
        if (need > 0) missing.push({ kind: 'fish', id: g.fish, name: C.fishClasses[g.fish]?.name || '물고기', n: need, where: 'fish' });
      } else if (g.season) {
        const own = g.season.find((id) => countOf(id) >= g.n);
        if (own) plan.push({ itemId: own, n: g.n, season: true, optional: true });
      } else {
        const have = countOf(g.item);
        if (have >= g.n) plan.push({ itemId: g.item, n: g.n, optional: !!(g.opt || g.base) });
        else if (!g.opt && !g.base) missing.push({ kind: 'item', id: g.item, name: itemName(g.item), n: g.n - have, where: whereOf(g.item) });
      }
    }
    return { ok: missing.length === 0, missing, plan };
  }

  // ---------------------------------------------------------------- freshness of the catch
  G.bus.on('item:added', (p) => {
    if (!p || typeof p.itemId !== 'string' || p.itemId.indexOf('FISH_') !== 0) return;
    const s = st();
    if (!s) return;
    const arr = Array.isArray(s.catches[p.itemId]) ? s.catches[p.itemId] : (s.catches[p.itemId] = []);
    for (let i = 0; i < Math.min(10, Math.max(1, p.qty | 0)); i++) arr.push(Math.round(now()));
    while (arr.length > 10) arr.shift();
    const keys = Object.keys(s.catches);
    if (keys.length > 30) delete s.catches[keys[0]];
  });
  /** 1 = caught within half an hour … 0.6 after a day (no stamp = 0.8) */
  function freshness(itemId) {
    const arr = st()?.catches?.[itemId];
    if (!Array.isArray(arr) || !arr.length) return 0.8;
    const age = (now() - arr[arr.length - 1]) / 60000;
    return age <= 30 ? 1 : age >= 1440 ? 0.6 : lerp(1, 0.6, (age - 30) / 1410);
  }

  // ================================================================= materials and textures (shared, made lazily)
  const MAT = {};
  function mat(key, make) { if (!MAT[key]) MAT[key] = make(); return MAT[key]; }
  const STD = (o) => new THREE.MeshStandardMaterial(o);
  const canvasTex = (w, hh, draw, o = {}) => {
    const t = G.gfx.canvasTexture(w, hh, draw, o);
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  };
  const noise = (s) => { let x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
  // vessels
  const vesselMat = (kind) => mat('v:' + kind, () => {
    if (kind === 'onggi') return STD({ color: 0x4d2f1f, roughness: 0.32, metalness: 0.02, map: canvasTex(128, 128, (c, w, hh) => { c.fillStyle = '#7b5034'; c.fillRect(0, 0, w, hh); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${40 + noise(i) * 30},${22 + noise(i + 3) * 20},12,${0.15 + noise(i + 7) * 0.2})`; c.fillRect(noise(i + 1) * w, noise(i + 2) * hh, 2 + noise(i + 4) * 5, 1 + noise(i + 5) * 3); } for (let y = 0; y < hh; y += 9) { c.fillStyle = 'rgba(30,16,8,.18)'; c.fillRect(0, y, w, 2); } }, { repeat: true }) });
    if (kind === 'baekja') return STD({ color: 0xf3f1ea, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.2 });
    if (kind === 'yugi') return STD({ color: 0xd2a650, roughness: 0.3, metalness: 0.95, envMapIntensity: 1.3 });
    if (kind === 'iron') return STD({ color: 0x2a2725, roughness: 0.62, metalness: 0.72 });
    if (kind === 'wood') return STD({ color: 0xc3a26a, roughness: 0.82, map: canvasTex(128, 128, (c, w, hh) => { c.fillStyle = '#cfb27a'; c.fillRect(0, 0, w, hh); c.strokeStyle = 'rgba(110,80,40,.45)'; c.lineWidth = 2; for (let i = 0; i < w; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, hh); c.stroke(); } for (let j = 0; j < hh; j += 8) { c.strokeStyle = 'rgba(90,64,30,.35)'; c.beginPath(); c.moveTo(0, j); c.lineTo(w, j); c.stroke(); } }, { repeat: true }) });
    return STD({ color: 0xcccccc, roughness: 0.5 });
  });
  const softSprite = () => mat('t:soft', () => canvasTex(64, 64, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.45, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }));
  const flameSprite = () => mat('t:flame', () => canvasTex(64, 128, (c, w, hh) => { const g = c.createRadialGradient(w / 2, hh * 0.72, 2, w / 2, hh * 0.62, hh * 0.5); g.addColorStop(0, 'rgba(255,248,210,1)'); g.addColorStop(0.25, 'rgba(255,190,80,.95)'); g.addColorStop(0.6, 'rgba(240,90,20,.55)'); g.addColorStop(1, 'rgba(200,40,0,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(w / 2, 4); c.bezierCurveTo(w * 0.95, hh * 0.45, w * 0.9, hh * 0.95, w / 2, hh - 2); c.bezierCurveTo(w * 0.1, hh * 0.95, w * 0.05, hh * 0.45, w / 2, 4); c.fill(); }));

  // ---------------------------------------------------------------- fish skins (drawn per species look or class)
  const CLASS_LOOK = {
    trout: { colours: ['#3f4a3a', '#9aa38c', '#eef0e6'], marks: 'parr', spots: '#1d2218', band: 'rgba(214,150,140,.35)' },
    small: { colours: ['#5a6e72', '#c3ccc8', '#f4f6f2'], marks: 'bars', spots: null, band: 'rgba(120,160,190,.35)' },
    bottom: { colours: ['#3b3a30', '#6f6a55', '#d8d2bc'], marks: 'mottle', spots: '#22201a', band: null },
  };
  function lookOfFish(itemId, cls) {
    const id = String(itemId || '').replace(/^FISH_/, '');
    const sp = G.data.fish?.byId?.[id] || G.data.fish?.species?.find?.((s) => s && s.id === id);
    const base = CLASS_LOOK[cls] || CLASS_LOOK.small;
    const lk = sp && sp.look ? sp.look : null;
    let cs = base.colours;
    if (lk && lk.colours && typeof lk.colours === 'object' && !Array.isArray(lk.colours)) cs = [lk.colours.back || cs[0], lk.colours.side || cs[1], lk.colours.belly || cs[2]];
    else if (lk && Array.isArray(lk.colours) && lk.colours.length >= 2) cs = lk.colours.map(String);
    const spec = lk && Array.isArray(lk.marks) ? lk.marks.filter((m) => m && m.t !== 'fin').slice(0, 12) : null;
    return { id, colours: [cs[0], cs[1] || cs[0], cs[2] || '#f0f0e8'], spec, marks: spec ? null : base.marks, spots: spec ? null : base.spots, band: spec ? null : base.band, scaleless: (lk ? lk.scales === 'none' : cls === 'bottom') };
  }
  /** lane fishing's mark list painted onto the mirrored skin (u along the body, v 0 = the back … 1 = the belly) */
  function paintMarks(c, w, H, marks) {
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rows = (v) => [v * 0.5 * H, H - v * 0.5 * H];
    for (const m of marks) {
      seed = (m.seed || 7) * 97 + 13;
      c.globalAlpha = m.a == null ? 0.7 : Math.max(0, Math.min(1, m.a));
      c.fillStyle = m.c || '#222';
      const u0 = m.u0 ?? 0.1, u1 = m.u1 ?? 0.98;
      if (m.t === 'spots' || m.t === 'mottle') {
        const n = Math.min(220, m.n || 40);
        for (let i = 0; i < n; i++) {
          const u = u0 + rnd() * (u1 - u0), v = (m.v0 ?? 0) + rnd() * ((m.v1 ?? 1) - (m.v0 ?? 0));
          const r = ((m.r0 ?? 0.006) + rnd() * ((m.r1 ?? 0.012) - (m.r0 ?? 0.006))) * H * (m.t === 'mottle' ? 1.2 : 1);
          for (const y of rows(v)) { c.beginPath(); c.ellipse(u * w, y, r * (m.t === 'mottle' ? 2.2 : 1.2), r, rnd() * 3, 0, TAU); c.fill(); }
        }
      } else if (m.t === 'parr' || m.t === 'bars' || m.t === 'saddles') {
        const n = Math.min(16, m.n || 8);
        for (let i = 0; i < n; i++) {
          const u = u0 + (i + 0.5) / n * (u1 - u0);
          const v = m.t === 'saddles' ? 0.08 : (m.v ?? 0.5);
          const rx = (m.rx ?? 0.02) * w, ry = (m.ry ?? (m.t === 'saddles' ? 0.12 : 0.2)) * 0.5 * H;
          for (const y of rows(v)) { c.beginPath(); c.ellipse(u * w, y, rx, ry, 0, 0, TAU); c.fill(); }
        }
      } else if (m.t === 'band' || m.t === 'rows') {
        const v = m.v ?? 0.5, bw = (m.w ?? 0.08) * 0.5 * H;
        for (const y of rows(v)) {
          if (m.t === 'rows') { const n = Math.min(40, m.n || 24); for (let i = 0; i < n; i++) { c.beginPath(); c.arc((u0 + (i + 0.5) / n * (u1 - u0)) * w, y, Math.max(1, bw * 0.35), 0, TAU); c.fill(); } }
          else c.fillRect(u0 * w, y - bw / 2, (u1 - u0) * w, bw);
        }
      } else if (m.t === 'blotch') {
        for (const y of rows(m.v ?? 0.5)) { c.beginPath(); c.ellipse((m.u ?? 0.5) * w, y, (m.rx ?? 0.2) * w, (m.ry ?? 0.1) * 0.5 * H, 0, 0, TAU); c.fill(); }
      }
    }
    c.globalAlpha = 1;
  }
  const skinCache = new Map();
  function skinTexture(look) {
    const key = (look.id || '') + look.colours.join() + (look.marks || '') + (look.spec ? look.spec.length : 0);
    if (skinCache.has(key)) return skinCache.get(key);
    const t = canvasTex(256, 128, (c, w, hh) => {
      // v = 0 the back, 0.5 the belly, 1 the back again: a mirrored gradient
      const g = c.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, look.colours[0]); g.addColorStop(0.28, look.colours[1]); g.addColorStop(0.5, look.colours[2]); g.addColorStop(0.72, look.colours[1]); g.addColorStop(1, look.colours[0]);
      c.fillStyle = g; c.fillRect(0, 0, w, hh);
      if (look.spec) paintMarks(c, w, hh, look.spec);
      if (look.band) { c.fillStyle = look.band; c.fillRect(0, hh * 0.22, w, hh * 0.07); c.fillRect(0, hh * 0.71, w, hh * 0.07); }
      const sideRow = (fn) => { for (const yy of [0.25, 0.75]) fn(yy * hh); };
      if (look.marks === 'parr') sideRow((y) => { for (let i = 0; i < 9; i++) { c.fillStyle = 'rgba(40,46,40,.45)'; c.beginPath(); c.ellipse(w * (0.14 + i * 0.085), y, 7, 11, 0, 0, TAU); c.fill(); } });
      if (look.marks === 'bars') sideRow((y) => { for (let i = 0; i < 10; i++) { c.fillStyle = 'rgba(70,90,110,.28)'; c.fillRect(w * (0.15 + i * 0.075), y - 12, 6, 24); } });
      if (look.marks === 'mottle') for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(20,20,14,${0.18 + noise(i) * 0.22})`; c.beginPath(); c.ellipse(noise(i + 1) * w, noise(i + 2) * hh, 4 + noise(i + 3) * 9, 3 + noise(i + 4) * 6, noise(i) * 3, 0, TAU); c.fill(); }
      if (look.spots || look.marks === 'spots') for (let i = 0; i < 90; i++) { const v = noise(i + 9); if (v > 0.35 && v < 0.65) continue; c.fillStyle = look.spots || 'rgba(30,30,25,.7)'; c.beginPath(); c.arc(noise(i + 5) * w, v * hh, 1.2 + noise(i + 6) * 1.6, 0, TAU); c.fill(); }
      // scales: fine arcs (not on the scaleless catfish)
      if (!look.scaleless) { c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; for (let y = 4; y < hh; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) { c.beginPath(); c.arc(x, y, 3, 0.2, PI - 0.2); c.stroke(); } }
      // the eye at the head end (u ≈ 0.05), and the gill line
      c.strokeStyle = 'rgba(40,30,20,.45)'; c.lineWidth = 2; for (const yy of [0.25, 0.75]) { c.beginPath(); c.arc(w * 0.12, yy * hh, 14, -1.2, 1.2); c.stroke(); }
    });
    skinCache.set(key, t);
    return t;
  }
  const crustTex = () => mat('t:crust', () => canvasTex(256, 128, (c, w, hh) => {
    c.clearRect(0, 0, w, hh);
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(${120 + noise(i) * 40},${70 + noise(i + 1) * 30},${30 + noise(i + 2) * 20},${0.25 + noise(i + 3) * 0.35})`; c.beginPath(); c.arc(noise(i + 4) * w, noise(i + 5) * hh, 2 + noise(i + 6) * 6, 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(48,26,10,.85)'; c.lineWidth = 5;   // 석쇠 marks across the side
    for (let x = -hh; x < w; x += 26) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + hh * 0.6, hh); c.stroke(); }
  }));
  const saltTex = () => mat('t:salt', () => canvasTex(128, 64, (c, w, hh) => { c.clearRect(0, 0, w, hh); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.55 + noise(i) * 0.45})`; c.fillRect(noise(i + 1) * w, noise(i + 2) * hh, 1 + noise(i + 3) * 2, 1 + noise(i + 4) * 2); } }));

  // ---------------------------------------------------------------- fish body: rings along the length (u), round (v)
  function fishGeometry(cls, len) {
    const L = len, segs = 22, around = 14;
    // depth (height) and width as fractions of L along u (0 = snout, 1 = tail fork base)
    const prof = cls === 'bottom'
      ? (u) => [0.11 + 0.1 * Math.sin(PI * Math.min(1, u * 1.4)) * (1 - u * 0.6), 0.16 * (1 - u * 0.75) + 0.02]   // flat head, wide
      : cls === 'trout'
        ? (u) => [0.03 + 0.2 * Math.pow(Math.sin(PI * Math.min(1, u * 1.15)), 0.8) * (1 - u * 0.45), 0.02 + 0.11 * Math.sin(PI * Math.min(1, u * 1.2))]
        : (u) => [0.03 + 0.21 * Math.pow(Math.sin(PI * Math.min(1, u * 1.12)), 0.85) * (1 - u * 0.4), 0.015 + 0.085 * Math.sin(PI * Math.min(1, u * 1.18))];
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, [dp, wd] = prof(Math.max(0.02, u));
      for (let j = 0; j <= around; j++) {
        const a = (j / around) * TAU;
        pos.push(u * L - L / 2, Math.cos(a) * dp * L * 0.5, Math.sin(a) * wd * L * 0.5);
        uv.push(u, j / around);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < around; j++) { const a = i * (around + 1) + j, b = a + around + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function finGeometry(cls, len) {
    // tail (forked for trout / small, round for the bottom fish), a dorsal and two pectorals; one geometry
    const L = len, parts = [];
    const tri = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.computeVertexNormals(); return g; };
    const tx = L / 2 - 0.005, fork = cls === 'bottom' ? 0.0 : 0.05 * L, th = (cls === 'bottom' ? 0.13 : 0.17) * L;
    parts.push(tri([[tx, 0, 0], [tx + 0.16 * L, th, 0], [tx + 0.12 * L - fork, 0, 0]]));
    parts.push(tri([[tx, 0, 0], [tx + 0.12 * L - fork, 0, 0], [tx + 0.16 * L, -th, 0]]));
    const dx = cls === 'bottom' ? 0.02 : -0.06, dh = (cls === 'trout' ? 0.1 : 0.09) * L;
    parts.push(tri([[dx * L, 0.09 * L, 0], [(dx + 0.14) * L, 0.075 * L, 0], [(dx + 0.05) * L, 0.09 * L + dh, 0]]));
    for (const s of [1, -1]) parts.push(tri([[-0.28 * L, -0.03 * L, s * 0.04 * L], [-0.17 * L, -0.07 * L, s * 0.08 * L], [-0.24 * L, -0.06 * L, s * 0.03 * L]]));
    if (cls === 'bottom') for (const s of [1, -1]) parts.push(tri([[-0.49 * L, -0.005 * L, s * 0.03 * L], [-0.62 * L, -0.05 * L, s * 0.12 * L], [-0.49 * L, -0.012 * L, s * 0.032 * L]]));   // barbels
    const BGU = ADDONS.BufferGeometryUtils;
    const merged = BGU && BGU.mergeGeometries ? BGU.mergeGeometries(parts, false) : parts[0];
    return merged;
  }
  /** a single fish from lane fishing's kit (G.fishkit: the species' own lofted body and painted skin), dressed for
   *  the kitchen: cooked = its material turns paler and golden, a grill crust = dark 석쇠 stripes over the side that
   *  faces up, salt = white grains on it. null when the kit or the species is not in this build. */
  function fishFromKit(itemId, len, own, place) {
    const FK = G.fishkit, id = String(itemId || '').replace(/^FISH_/, '');
    if (!FK || typeof FK.build !== 'function' || !G.data.fish?.byId?.[id]) return null;
    let fish = null;
    try { fish = FK.build(id, { length: len, swim: false }); } catch (e) { fish = null; }
    if (!fish) return null;
    own({ dispose: () => fish.userData.fish?.dispose?.() });
    const inner = new THREE.Group(); inner.add(fish);
    // centre it on its own box so it lies where the kitchen puts it
    const bb = new THREE.Box3().setFromObject(fish), c = bb.getCenter(new THREE.Vector3());
    fish.position.sub(c);
    const size = bb.getSize(new THREE.Vector3());
    const mats = [];
    fish.traverse((o) => { if (o.isMesh && o.material && o.material.color) mats.push({ m: o.material, base: o.material.color.clone(), r: o.material.roughness }); });
    // 석쇠 marks over the side that faces up when the fish lies on a plate (local −Z of the group → world up)
    const marks = [];
    for (let i = -3; i <= 3; i++) marks.push(placed(new THREE.BoxGeometry(0.012, size.y * 0.8, 0.002), { x: i * size.x * 0.11, z: -size.z / 2 - 0.0015, rz: 0.5 }));
    const crustMat = own(new THREE.MeshStandardMaterial({ color: 0x3a1e0c, roughness: 0.8, transparent: true, opacity: 0, depthWrite: false }));
    const crust = new THREE.Mesh(own(mergeAll(marks)), crustMat);
    const grains = [];
    for (let i = 0; i < 60; i++) grains.push(placed(new THREE.BoxGeometry(0.003, 0.003, 0.002), { x: (noise(i + 300) - 0.5) * size.x * 0.8, y: (noise(i + 301) - 0.5) * size.y * 0.6, z: -size.z / 2 - 0.002 }));
    const saltMat = own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0, depthWrite: false }));
    const salt = new THREE.Mesh(own(mergeAll(grains)), saltMat);
    const g = new THREE.Group(); g.add(inner, new THREE.Object3D(), crust, salt);
    if (place) { g.position.set(place.x || 0, place.y || 0, place.z || 0); g.rotation.set(place.rx || 0, place.ry || 0, place.rz || 0); }
    const DONE = col('#e9caa0'), GLAZE = col('#b3402a'), tmp = new THREE.Color();
    // the same child order as the merged fish: [body, fins, crust, salt, eyes] — the tests read children[2] for the crust
    const handle = { group: g, kit: true, set(cook, crustK, saltK, glazeK) {
      for (const x of mats) { tmp.copy(x.base).lerp(DONE, clamp(cook, 0, 1) * 0.7); if (glazeK) tmp.lerp(GLAZE, clamp(glazeK, 0, 1) * 0.55); x.m.color.copy(tmp); if (x.r != null) x.m.roughness = lerp(x.r, 0.7, clamp(cook, 0, 1)); }
      crustMat.opacity = clamp(crustK, 0, 1) * 0.85;
      saltMat.opacity = clamp(saltK, 0, 1) * (1 - clamp(crustK, 0, 1) * 0.6);
    } };
    return handle;
  }
  /** merge geometries (each already placed) into one; one draw call */
  function mergeAll(list) {
    const BGU = ADDONS.BufferGeometryUtils;
    if (list.length === 1) return list[0];
    for (const g of list) { if (g.index === null) continue; }
    const norm = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const keep = ['position', 'normal', 'uv'];
    for (const g of norm) { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); }
    const m = BGU && BGU.mergeGeometries ? BGU.mergeGeometries(norm, false) : null;
    return m || list[0];
  }
  const placed = (g, p) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)), new THREE.Vector3(p.s || 1, p.s || 1, p.s || 1)));
  /** one or many fish of one species, merged (body · fins · crust · salt · eyes = 5 draw calls for any count):
   *  {group, set(cook, crust, salt, glaze)} — the body texture is the species' skin; cooked = paler and golden */
  function makeFish(itemId, cls, len, own, places) {
    let kitFish = null;
    if (!places || places.length <= 1) { try { kitFish = fishFromKit(itemId, len, own, places && places[0]); } catch (e) { G.log.warn('COOK', 'fish kit body failed — the kitchen draws its own', e?.message || e); kitFish = null; } }
    if (kitFish) return kitFish;
    const look = lookOfFish(itemId, cls);
    const P2 = places && places.length ? places : [{}];
    const g = new THREE.Group();
    const bodyMat = own(STD({ map: skinTexture(look), roughness: 0.22, metalness: 0.08, color: 0xffffff }));
    const bodyG = own(mergeAll(P2.map((p) => placed(fishGeometry(cls, len), p))));
    const body = new THREE.Mesh(bodyG, bodyMat);
    const finMat = own(STD({ color: col(look.colours[0]).lerp(col('#b8b0a0'), 0.4), roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    const fins = new THREE.Mesh(own(mergeAll(P2.map((p) => placed(finGeometry(cls, len), p)))), finMat);
    const eyeMat = own(STD({ color: 0x111111, roughness: 0.1, metalness: 0.2 }));
    const eyes = new THREE.Mesh(own(mergeAll(P2.flatMap((p) => [1, -1].map((sd) => placed(placed(new THREE.SphereGeometry(0.012 * len / 0.3, 8, 6), { x: -len * 0.4, y: len * 0.02, z: sd * len * 0.032 }), p))))), eyeMat);
    const crustMat = own(new THREE.MeshStandardMaterial({ map: crustTex(), transparent: true, opacity: 0, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    const crust = new THREE.Mesh(bodyG, crustMat);
    const saltMat = own(new THREE.MeshStandardMaterial({ map: saltTex(), transparent: true, opacity: 0, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
    const salt = new THREE.Mesh(bodyG, saltMat);
    for (const m of [body, fins, eyes]) m.castShadow = true;
    g.add(body, fins, crust, salt, eyes);
    const RAW = new THREE.Color(0xffffff), DONE = col('#e9caa0');
    const h2 = {
      group: g, glazeColor: col('#b3402a'),
      set(cook, crustK, saltK, glazeK) {
        bodyMat.color.copy(RAW).lerp(DONE, clamp(cook, 0, 1) * 0.85);
        if (glazeK) bodyMat.color.lerp(h2.glazeColor, clamp(glazeK, 0, 1) * 0.75);
        bodyMat.roughness = lerp(0.22, 0.62, clamp(cook, 0, 1));
        eyeMat.color.setRGB(lerp(0.07, 0.85, cook), lerp(0.07, 0.83, cook), lerp(0.07, 0.78, cook));   // the eye turns white when cooked
        crustMat.opacity = clamp(crustK, 0, 1) * 0.95;
        saltMat.opacity = clamp(saltK, 0, 1) * (1 - clamp(crustK, 0, 1) * 0.6);
      },
    };
    return h2;
  }

  // ---------------------------------------------------------------- vessels (lathe profiles, metres)
  const VP = {
    ttukbaegi: [[0, 0], [0.07, 0], [0.078, 0.006], [0.09, 0.05], [0.096, 0.08], [0.1, 0.088], [0.092, 0.09], [0.084, 0.06], [0.074, 0.016], [0, 0.016]],
    bowl: [[0, 0], [0.04, 0], [0.042, 0.008], [0.085, 0.045], [0.1, 0.068], [0.095, 0.07], [0.08, 0.05], [0.038, 0.014], [0, 0.012]],
    jubal: [[0, 0], [0.038, 0], [0.04, 0.008], [0.064, 0.05], [0.068, 0.082], [0.062, 0.084], [0.058, 0.054], [0.036, 0.014], [0, 0.012]],
    plate: [[0, 0], [0.06, 0], [0.065, 0.006], [0.12, 0.016], [0.135, 0.026], [0.128, 0.028], [0.112, 0.02], [0.06, 0.01], [0, 0.01]],
    lid: [[0, 0.06], [0.03, 0.06], [0.03, 0.045], [0.08, 0.03], [0.2, 0.012], [0.25, 0.004], [0.255, 0.0], [0.24, 0.01], [0.19, 0.02], [0.07, 0.036], [0, 0.04]],
    chaebang: [[0, 0], [0.12, 0], [0.16, 0.02], [0.17, 0.04], [0.162, 0.04], [0.15, 0.022], [0.11, 0.01], [0, 0.01]],
  };
  const lathe = (p, seg = 28) => new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  function vessel(id, own) {
    const v = C.vessels[id] || C.vessels.baekja_bowl;
    const g = new THREE.Group();
    const m = vesselMat(v.kind);
    let prof = VP.bowl, fill = 0.055, rim = 0.09, sx = 1;
    if (id === 'ttukbaegi') { prof = VP.ttukbaegi; fill = 0.072; rim = 0.088; }
    else if (id === 'yugi_jubal') { prof = VP.jubal; fill = 0.07; rim = 0.062; }
    else if (id === 'baekja_plate') { prof = VP.plate; fill = 0.016; rim = 0.11; }
    else if (id === 'baekja_long') { prof = VP.plate; fill = 0.016; rim = 0.11; sx = 1.75; }
    else if (id === 'sotttukkeong') { prof = VP.lid; fill = 0.012; rim = 0.22; }
    else if (id === 'chaebang') { prof = VP.chaebang; fill = 0.012; rim = 0.15; }
    const mesh = new THREE.Mesh(own(lathe(prof)), m);
    mesh.scale.set(sx, 1, 1); mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    if (id === 'sotttukkeong') { const knob = new THREE.Mesh(own(new THREE.CylinderGeometry(0.03, 0.035, 0.03, 12)), m); knob.position.y = -0.012; g.add(knob); }
    if (id === 'yugi_jubal') { const lid = new THREE.Mesh(own(lathe([[0, 0.03], [0.015, 0.03], [0.016, 0.022], [0.06, 0.012], [0.07, 0.0], [0.064, 0.0], [0, 0.008]])), m); lid.position.set(0.12, 0, 0.02); lid.rotation.z = 0.0; g.add(lid); }
    return { group: g, fill, rim, sx };
  }
  const discMat = (hex, own, o = {}) => own(STD(Object.assign({ color: col(hex), roughness: 0.12, metalness: 0.0 }, o)));

  // ---------------------------------------------------------------- dish models (cook 0 → 1; the parts that move with it)
  /** -> {group, update(dt, t), setCook(k), crust(k), salt(k), glaze(k), boil(k), steam(k), dispose()} */
  function buildDish(dishId, opts = {}) {
    const d = C.dishes[dishId];
    if (!d) return null;
    const owned = [];
    const own = (x) => { if (x && typeof x.dispose === 'function') owned.push(x); return x; };
    const L = d.look || { type: 'soup' };
    const root = new THREE.Group(); root.name = 'dish:' + dishId;
    const ves = opts.noVessel ? { group: new THREE.Group(), fill: 0.05, rim: 0.09, sx: 1 } : vessel(d.vessel, own);
    root.add(ves.group);
    const parts = { fish: [], broth: null, bubbles: null, steam: [], tint: [], cook: 0, crust: 0, salt: 0, glaze: 0, boil: 0, steamK: 0 };
    const fishItem = opts.fishItem || (C.fishFor(L.fish || 'small')[0] || {}).itemId;
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); m.castShadow = true; root.add(m); return m; };
    const tintPart = (mesh, raw, done) => { parts.tint.push({ m: mesh.material, raw: col(raw), done: col(done) }); return mesh; };
    const y0 = ves.fill;
    // broth: a disc with drawn flecks (pepper, oil) that clouds as it cooks
    const broth = (raw, done, flecks) => {
      const tex = own(canvasTex(128, 128, (c, w) => {
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w);
        for (let i = 0; i < (flecks || 0); i++) { c.fillStyle = `rgba(${150 + noise(i) * 60},${30 + noise(i + 1) * 30},20,${0.4 + noise(i + 2) * 0.4})`; c.fillRect(noise(i + 3) * w, noise(i + 4) * w, 1 + noise(i + 5) * 3, 1 + noise(i + 6) * 2); }
        for (let i = 0; i < 26; i++) { c.fillStyle = 'rgba(255,230,160,.35)'; c.beginPath(); c.arc(noise(i + 11) * w, noise(i + 12) * w, 1.5 + noise(i + 13) * 5, 0, TAU); c.fill(); }   // oil drops
      }));
      const m = new THREE.Mesh(own(new THREE.CircleGeometry(ves.rim * 0.93, 32).rotateX(-PI / 2)), discMat(raw, own, { map: tex, roughness: 0.06 }));
      add(m, 0, y0, 0); m.scale.x = ves.sx;
      tintPart(m, raw, done);
      parts.broth = m;
      return m;
    };
    const BIT = {
      radish: [() => new THREE.BoxGeometry(0.03, 0.012, 0.024), '#f0ece0', ['#f4f1e6', '#e6d5ae'], 0.4],
      scallion: [() => new THREE.TorusGeometry(0.006, 0.0022, 4, 8).rotateX(PI / 2), '#5c9a3a', null, 0.5],
      cabbage: [() => new THREE.CircleGeometry(0.018, 7, 0, PI * 1.3).rotateX(-PI / 2), '#9cbf68', null, 0.5, true],
      squash: [() => new THREE.CircleGeometry(0.016, 9).rotateX(-PI / 2), '#a8c060', null, 0.5, true],
      kimchi: [() => new THREE.CircleGeometry(0.018, 7, 0, PI * 1.3).rotateX(-PI / 2), '#c8492e', null, 0.5, true],
      bean: [() => new THREE.SphereGeometry(0.007, 7, 5).scale(1.2, 0.9, 1), '#a4844e', null, 0.5],
      potato: [() => new THREE.SphereGeometry(0.016, 8, 6).scale(1.2, 0.8, 1), '#efe0b8', ['#f2e8cc', '#e8d09a'], 0.6],
      rice: [() => new THREE.SphereGeometry(0.004, 5, 4).scale(1.6, 0.8, 1), '#f6f3ea', null, 0.4],
      fish: [() => new THREE.BoxGeometry(0.035, 0.014, 0.022), '#e6e0d4', ['#e3dcd0', '#f3eadb'], 0.5],
    };
    /** n small pieces of one kind scattered in the vessel: one merged mesh */
    const bits = (kind, n, r, y, seed) => {
      const b = BIT[kind];
      if (!b) return null;
      const list = [];
      for (let i = 0; i < n; i++) {
        const a = noise(seed + i) * TAU, rr = Math.sqrt(noise(seed + i + 50)) * r;
        list.push(placed(b[0](), { x: Math.cos(a) * rr * ves.sx, y: y + noise(seed + i + 30) * 0.004, z: Math.sin(a) * rr, ry: noise(seed + i + 9) * TAU }));
      }
      const m = new THREE.Mesh(own(mergeAll(list)), discMat(b[1], own, { roughness: b[3], side: b[4] ? THREE.DoubleSide : THREE.FrontSide }));
      m.castShadow = true; root.add(m);
      if (b[2]) tintPart(m, b[2][0], b[2][1]);
      return m;
    };
    const steamSprites = (n, spread, baseY) => {
      const m = own(new THREE.SpriteMaterial({ map: softSprite(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      for (let i = 0; i < n; i++) { const s = new THREE.Sprite(m); s.userData = { ph: noise(i + 70), x: (noise(i + 71) - 0.5) * spread, z: (noise(i + 72) - 0.5) * spread, base: baseY }; s.scale.setScalar(0.08); root.add(s); parts.steam.push(s); }
      parts.steamMat = m;
    };
    const bubbles = (r, yy) => {
      const g = own(new THREE.SphereGeometry(1, 8, 6));
      const m = discMat('#fff8e8', own, { roughness: 0.05, transparent: true, opacity: 0.75 });
      const im = new THREE.InstancedMesh(g, m, 14);
      im.userData = { r, y: yy, ph: Array.from({ length: 14 }, (_, i) => noise(i + 90)) };
      const z = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < 14; i++) im.setMatrixAt(i, z);
      root.add(im); parts.bubbles = im;
    };
    const fishOn = (cls, count, len, layout) => {
      const places = [];
      for (let i = 0; i < count; i++) places.push(layout ? layout(i, count) : { x: 0, y: y0 + len * 0.06, z: 0 });
      const f = makeFish(fishItem, cls, len, own, places);
      if (L.type === 'fried' && f.glazeColor) f.glazeColor = col(L.batter || '#e0b060');
      root.add(f.group); parts.fish.push(f);
    };
    const t = L.type;
    if (t === 'grill' || t === 'steamed_fish') {
      fishOn(L.fish || 'trout', L.count || 1, 0.3, () => ({ x: 0, y: y0 + 0.022, z: 0, ry: 0, rx: PI / 2 * 0.98 }));
      if (L.garnish === 'scallion') bits('scallion', 7, 0.05, y0 + 0.045, 3);
      if (t === 'steamed_fish') { const s = new THREE.Mesh(own(new THREE.PlaneGeometry(0.22, 0.05).rotateX(-PI / 2)), discMat(L.sauce || '#7a4a22', own, { transparent: true, opacity: 0.7 })); add(s, 0, y0 + 0.004, 0.0); }
      steamSprites(6, 0.18, y0 + 0.05);
    } else if (t === 'round') {
      fishOn(L.fish || 'small', L.count || 9, 0.17, (i, n) => { const a = (i / n) * TAU; return { x: Math.cos(a) * 0.115, y: y0 + 0.016, z: Math.sin(a) * 0.115, ry: -a + PI, rx: PI / 2 }; });
      steamSprites(5, 0.25, y0 + 0.04);
    } else if (t === 'fried') {
      fishOn(L.fish || 'small', L.count || 6, 0.15, (i, n) => ({ x: (i % 3 - 1) * 0.085, y: y0 + 0.016 + (i > 2 ? 0.014 : 0), z: (i > 2 ? 0.04 : -0.04), ry: (i % 2) * 0.4 - 0.2 + PI / 2, rx: PI / 2 }));
      parts.batter = L.batter || '#e6c27a';
      steamSprites(4, 0.2, y0 + 0.04);
    } else if (t === 'braise') {
      for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(own(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14)), discMat('#f0eadb', own, { roughness: 0.5 })); tintPart(r, '#f2eee2', '#9c5a2c'); add(r, (i - 1.5) * 0.06, y0 + 0.006, 0.01); }
      fishOn(L.fish || 'bottom', 1, 0.26, () => ({ x: 0, y: y0 + 0.03, z: 0, rx: PI / 2 }));
      const s = new THREE.Mesh(own(new THREE.CircleGeometry(0.1, 20).rotateX(-PI / 2)), discMat(L.sauce || '#7a3414', own, { transparent: true, opacity: 0.0 })); add(s, 0, y0 + 0.002, 0); parts.sauce = s.material;
      steamSprites(5, 0.18, y0 + 0.06);
    } else if (t === 'stew' || t === 'soup' || t === 'porridge' || t === 'noodlesoup' || t === 'dumplingsoup') {
      const b = L.broth || ['#e0d4b8', '#b07040'];
      broth(b[0], b[1], t === 'stew' ? 160 : 40);
      if (t === 'porridge') { parts.broth.material.roughness = 0.3; bits('rice', 40, ves.rim * 0.8, y0 + 0.002, 7); }
      if (t === 'noodlesoup') {
        const ng = [];
        for (let i = 0; i < 9; i++) { const pts = []; for (let k = 0; k < 7; k++) { const a = noise(i * 7 + k) * TAU, r = (0.2 + noise(i * 3 + k) * 0.7) * ves.rim * 0.85; pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + 0.001 + noise(i + k) * 0.006, Math.sin(a) * r)); } ng.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, dishId === 'DISH_KOTDEUNGCHIGI' ? 0.0045 : 0.0028, 5)); }
        const BGU = ADDONS.BufferGeometryUtils;
        const nm = new THREE.Mesh(own(BGU && BGU.mergeGeometries ? BGU.mergeGeometries(ng, false) : ng[0]), discMat(L.noodle || '#efe4c8', own, { roughness: 0.45 }));
        root.add(nm); tintPart(nm, '#d9ccb0', L.noodle || '#efe4c8');
      }
      if (t === 'dumplingsoup') { const list = []; for (let i = 0; i < 9; i++) { const a = noise(i + 40) * TAU, r = Math.sqrt(noise(i + 41)) * ves.rim * 0.7; list.push(placed(new THREE.SphereGeometry(0.017, 10, 8).scale(1, 0.8 + noise(i) * 0.15, 1), { x: Math.cos(a) * r, y: y0 + 0.006, z: Math.sin(a) * r, ry: a })); } const bm = new THREE.Mesh(own(mergeAll(list)), discMat(L.ball || '#e9dfc3', own, { roughness: 0.25 })); root.add(bm); tintPart(bm, '#e8e0cc', '#f1ead4'); }
      for (const [i, c2] of (L.chunks || []).entries()) bits(c2, c2 === 'scallion' ? 10 : 6, ves.rim * 0.75, y0 + 0.004, 11 + i * 17);
      if (L.fish && t === 'stew') fishOn(L.fish, 1, 0.16, () => ({ x: 0.01, y: y0 + 0.006, z: 0.0, rx: PI / 2, ry: 0.6 }));
      bubbles(ves.rim * 0.8, y0);
      steamSprites(8, ves.rim * 1.2, y0 + 0.03);
    } else if (t === 'rice' || t === 'bibim') {
      const tex = own(canvasTex(128, 128, (c, w) => {
        c.fillStyle = L.rice || '#f4f0e6'; c.fillRect(0, 0, w, w);
        for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,255,255,${0.35 + noise(i) * 0.5})`; c.beginPath(); c.ellipse(noise(i + 1) * w, noise(i + 2) * w, 2.4, 1.1, noise(i + 3) * PI, 0, TAU); c.fill(); c.strokeStyle = 'rgba(190,180,160,.25)'; c.stroke(); }
        if (L.mix) for (let i = 0; i < 90; i++) { c.fillStyle = L.mix; c.beginPath(); c.ellipse(noise(i + 400) * w, noise(i + 401) * w, 2 + noise(i + 402) * 3, 1.4 + noise(i + 403) * 2, noise(i + 404) * PI, 0, TAU); c.fill(); }
      }));
      const dome = new THREE.Mesh(own(new THREE.SphereGeometry(ves.rim * 0.9, 24, 10, 0, TAU, 0, PI / 2).scale(1, 0.45, 1)), discMat('#ffffff', own, { map: tex, roughness: 0.55 }));
      add(dome, 0, y0 - 0.006, 0); parts.dome = dome; tintPart(dome, '#d8d2c2', '#ffffff');
      if (t === 'bibim') (L.toppings || []).forEach((c2, i) => { const a = (i / 4) * TAU; const s = new THREE.Mesh(own(new THREE.CircleGeometry(0.028, 10).rotateX(-PI / 2)), discMat(c2, own, { roughness: 0.6 })); add(s, Math.cos(a) * 0.035, y0 + ves.rim * 0.36, Math.sin(a) * 0.035); });
      if (t === 'bibim') { const gj = new THREE.Mesh(own(new THREE.SphereGeometry(0.014, 10, 6).scale(1, 0.6, 1)), discMat('#a8261a', own, { roughness: 0.3 })); add(gj, 0, y0 + ves.rim * 0.42, 0); }
      if (L.nurungji) { const n = new THREE.Mesh(own(new THREE.CircleGeometry(0.045, 9).rotateX(-PI / 2)), discMat('#c98a3e', own, { roughness: 0.8, side: THREE.DoubleSide })); n.visible = false; add(n, ves.rim + 0.07, 0.006, 0.04); parts.nurungji = n; }
      steamSprites(6, 0.08, y0 + 0.05);
    } else if (t === 'pancake' || t === 'leafcake') {
      const cs = L.color || ['#efe2c2', '#d98a4a'];
      const tex = own(canvasTex(128, 128, (c, w) => {
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w);
        if (t === 'leafcake') { c.strokeStyle = L.leaf || '#8fae5a'; c.lineWidth = 6; c.beginPath(); c.moveTo(w * 0.15, w * 0.5); c.lineTo(w * 0.9, w * 0.5); c.stroke(); c.lineWidth = 2.5; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w * (0.25 + i * 0.1), w * 0.5); c.lineTo(w * (0.35 + i * 0.1), w * (i % 2 ? 0.2 : 0.8)); c.stroke(); } }
        if (L.dots) for (let i = 0; i < 60; i++) { c.fillStyle = L.dots; c.fillRect(noise(i + 1) * w, noise(i + 2) * w, 2 + noise(i) * 5, 2 + noise(i + 3) * 3); }
        for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(150,80,20,${0.12 + noise(i + 30) * 0.25})`; c.beginPath(); c.arc(noise(i + 31) * w, noise(i + 32) * w, 3 + noise(i + 33) * 8, 0, TAU); c.fill(); }   // browned spots (shown by the crust)
      }));
      const pc = new THREE.Mesh(own(new THREE.CylinderGeometry(0.11, 0.112, 0.012, 28)), discMat(cs[0], own, { map: tex, roughness: 0.55 }));
      add(pc, 0, y0 + 0.006, 0); tintPart(pc, cs[0], cs[1]); parts.flat = pc;
      steamSprites(5, 0.16, y0 + 0.04);
    } else if (t === 'roll' || t === 'halfmoon') {
      const cs = L.color || ['#ddd3bd', '#b89a6a'];
      for (let i = 0; i < (L.count || 3); i++) {
        let m;
        if (t === 'roll') { m = new THREE.Mesh(own(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 14)), discMat(cs[0], own, { roughness: 0.5 })); m.rotation.z = PI / 2; m.rotation.y = 0.3; const f = new THREE.Mesh(own(new THREE.CircleGeometry(0.014, 10)), discMat(L.fill || '#c2452c', own)); f.position.y = 0.0605; f.rotation.x = -PI / 2; m.add(f); add(m, -0.01, y0 + 0.018, (i - 1) * 0.04); }
        else { m = new THREE.Mesh(own(new THREE.CylinderGeometry(0.045, 0.045, 0.014, 18, 1, false, 0, PI)), discMat(cs[0], own, { roughness: 0.45 })); m.rotation.y = i * 0.5; add(m, (i - 1) * 0.07, y0 + 0.008 + i * 0.002, (i % 2) * 0.03); }
        tintPart(m, cs[0], cs[1]);
      }
      steamSprites(4, 0.12, y0 + 0.04);
    } else if (t === 'olchaengi') {
      const b = new THREE.Mesh(own(new THREE.CircleGeometry(ves.rim * 0.9, 28).rotateX(-PI / 2)), discMat(L.broth || '#8a5a2a', own, { transparent: true, opacity: 0.85 })); add(b, 0, y0 - 0.004, 0);
      const tg = own(new THREE.SphereGeometry(0.006, 7, 5).scale(2.4, 0.9, 1));
      const tm = discMat(L.color || '#e9d27a', own, { roughness: 0.2 });
      const tl = []; for (let i = 0; i < 46; i++) { const a = noise(i + 60) * TAU, r = Math.sqrt(noise(i + 61)) * ves.rim * 0.8; tl.push(placed(tg.clone(), { x: Math.cos(a) * r, y: y0 + noise(i + 63) * 0.01, z: Math.sin(a) * r, ry: noise(i + 62) * TAU })); }
      root.add(new THREE.Mesh(own(mergeAll(tl)), tm));
      parts.tint.push({ m: tm, raw: col('#cdbb78'), done: col(L.color || '#e9d27a') });
      bits('kimchi', 4, 0.03, y0 + 0.012, 5);
    } else if (t === 'corn') {
      const tex = own(canvasTex(64, 128, (c, w, hh) => { c.fillStyle = '#d6a92c'; c.fillRect(0, 0, w, hh); for (let y = 2; y < hh; y += 7) for (let x = (y / 7) % 2 ? 3 : 0; x < w; x += 7) { c.fillStyle = '#f2d264'; c.beginPath(); c.ellipse(x + 3, y + 3, 3, 3.2, 0, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x + 2, y + 1, 2, 2); } }));
      for (let i = 0; i < (L.count || 3); i++) { const m = new THREE.Mesh(own(new THREE.CylinderGeometry(0.032, 0.026, 0.2, 18)), discMat('#ffffff', own, { map: tex, roughness: 0.35 })); m.rotation.z = PI / 2; m.rotation.y = (i - 1) * 0.3; add(m, 0, y0 + 0.033, (i - 1) * 0.07); tintPart(m, '#e8dca0', '#ffffff'); const husk = new THREE.Mesh(own(new THREE.ConeGeometry(0.022, 0.06, 7)), discMat('#c9c27a', own, { roughness: 0.7 })); husk.rotation.z = -PI / 2; husk.position.y = 0.11; m.add(husk); }
      steamSprites(6, 0.14, y0 + 0.06);
    } else if (t === 'potato') {
      const tex = own(canvasTex(64, 64, (c, w) => { c.fillStyle = '#b8935a'; c.fillRect(0, 0, w, w); for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(90,60,30,${0.2 + noise(i) * 0.3})`; c.beginPath(); c.arc(noise(i + 1) * w, noise(i + 2) * w, 1 + noise(i + 3) * 2.5, 0, TAU); c.fill(); } }));
      for (let i = 0; i < (L.count || 5); i++) { const m = new THREE.Mesh(own(new THREE.SphereGeometry(0.032, 14, 10).scale(1.25, 0.85, 1)), discMat('#ffffff', own, { map: tex, roughness: 0.75 })); const a = (i / 5) * TAU; add(m, Math.cos(a) * 0.06, y0 + 0.026 + (i === 0 ? 0.02 : 0), Math.sin(a) * 0.06); m.rotation.y = a; tintPart(m, '#ffffff', '#f4e2b4'); }
      steamSprites(6, 0.14, y0 + 0.06);
    } else if (t === 'salad') {
      const sg = own(new THREE.BoxGeometry(0.05, 0.004, 0.004));
      const sm = discMat(L.color || '#e05a3a', own, { roughness: 0.4 });
      const sl = []; for (let i = 0; i < 90; i++) { const a = noise(i + 20) * TAU, r = Math.sqrt(noise(i + 21)) * 0.06; sl.push(placed(sg.clone(), { x: Math.cos(a) * r, y: y0 + 0.004 + (0.06 - r) * 0.5 + noise(i) * 0.006, z: Math.sin(a) * r, ry: noise(i + 22) * TAU, rz: (noise(i + 23) - 0.5) * 0.4 })); }
      root.add(new THREE.Mesh(own(mergeAll(sl)), sm));
      parts.tint.push({ m: sm, raw: col(L.base || '#f3efe2'), done: col(L.color || '#e05a3a') });
    }
    root.traverse((o) => { if (o.isMesh) o.userData.guardSkip = true; });
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    const api = {
      group: root, def: d, parts,
      setCook(k) { parts.cook = clamp(k, 0, 1); for (const tp of parts.tint) tp.m.color.copy(tp.raw).lerp(tp.done, parts.cook); for (const f of parts.fish) f.set(parts.cook, parts.crust, parts.salt, parts.glaze); if (parts.dome) parts.dome.scale.y = lerp(0.85, 1.05, parts.cook); if (parts.sauce) parts.sauce.opacity = parts.cook * 0.8; },
      crust(k) { if (t === 'fried') { api.glaze(k); return; } parts.crust = clamp(k, 0, 1); for (const f of parts.fish) f.set(parts.cook, parts.crust, parts.salt, parts.glaze); if (parts.flat) parts.flat.material.color.copy(col((d.look.color || ['#eee', '#d98a4a'])[0])).lerp(col((d.look.color || ['#eee', '#d98a4a'])[1]), parts.crust); },
      salt(k) { parts.salt = clamp(k, 0, 1); for (const f of parts.fish) f.set(parts.cook, parts.crust, parts.salt, parts.glaze); },
      glaze(k) { parts.glaze = clamp(k, 0, 1); for (const f of parts.fish) f.set(parts.cook, parts.crust, parts.salt, parts.glaze); },
      boil(k) { parts.boil = clamp(k, 0, 1); },
      steam(k) { parts.steamK = clamp(k, 0, 1); },
      nurungji(on) { if (parts.nurungji) parts.nurungji.visible = !!on; },
      update(dt, tt) {
        const calm = reduced();
        if (parts.bubbles) {
          const im = parts.bubbles, ud = im.userData, k = parts.boil;
          for (let i = 0; i < 14; i++) {
            const ph = (tt * (0.55 + ud.ph[i] * 0.5) + ud.ph[i]) % 1;   // ≤ 1.05 Hz per bubble: a calm simmer, never a flash
            const on = k > 0.05 && (i / 14) < k;
            const r = on ? Math.sin(ph * PI) * (0.004 + ud.ph[i] * 0.006) * (calm ? 0.6 : 1) : 0;
            const a = ud.ph[i] * TAU * 7.3, rr = Math.sqrt(ud.ph[(i + 3) % 14]) * ud.r;
            _p.set(Math.cos(a) * rr, ud.y + r * 0.3, Math.sin(a) * rr); _s.set(r, r * 0.6, r);
            _m4.compose(_p, _q, _s); im.setMatrixAt(i, _m4);
          }
          im.instanceMatrix.needsUpdate = true;
        }
        if (parts.steam.length) {
          const k = parts.steamK;
          parts.steamMat.opacity = k * 0.42;
          for (const s of parts.steam) {
            const ud = s.userData, ph = calm ? ud.ph : (tt * 0.22 + ud.ph) % 1;
            s.position.set(ud.x + Math.sin(ph * 5 + ud.ph * 9) * 0.02, ud.base + ph * 0.32, ud.z);
            s.scale.setScalar(0.05 + ph * 0.14);
            s.material.opacity = k * 0.42;
          }
        }
      },
      dispose() { root.parent?.remove(root); for (const o of owned) { try { o.dispose(); } catch (e) { /* gone */ } } owned.length = 0; },
    };
    api.setCook(opts.cook ?? 1);
    if ((opts.cook ?? 1) >= 1) { if (['grill', 'pancake', 'leafcake', 'round', 'fried', 'halfmoon'].includes(t)) api.crust(1); if (t === 'round') api.glaze(1); if (L.nurungji) api.nurungji(true); }
    return api;
  }

  // ================================================================= the stations in the 부엌
  // positions in the room's frame (PL_BUEOK, 11 × 8): resolved from the room's anchors where it has them
  const NEW_AT = {
    doma: { x: -2.5, z: -1.55 }, hwaro: { x: -2.35, z: 1.55 }, sotttukkeong: { x: -0.7, z: 0.95 },
    yangnyeom: { x: 5.12, z: 1.95 }, soban: { x: 0.9, z: -1.45 }, muldumeong: { x: -3.95, z: -2.5 }, chanjang: { x: 1.4, z: -3.2 },
  };
  let room = null;          // { group, placeGroup, spots: {id: {work: V3 local, stand: {x,z}, face, look}}, interacts: [], colliders: [], shelf: [], fires: {} }
  let river = null;         // the 화덕 by the river (valley; built once)

  function anchorLocal(pg, key) {
    const n = pg.getObjectByName('anchor:' + key) || (() => { let f = null; pg.traverse((o) => { if (!f && o.userData && o.userData.anchor === key) f = o; }); return f; })();
    return n ? n.position.clone() : null;
  }
  const KIT_KEYS = ['wood', 'floor', 'furn', 'plaster', 'clay', 'stone', 'earth', 'straw', 'basket', 'onggi', 'cloth', 'hanji', 'brass', 'iron', 'lacquer', 'paint', 'glow'];
  const kitMats = () => { const o = {}; for (const k of KIT_KEYS) { try { o[k] = K.mat(k); } catch (e) { /* key unknown to this kit */ } } return o; };
  function bucketOf() {
    const B = new BK.Bucket();
    const T = { add: (key, g, m, tint) => B.add(key, g, m || BK.I4, K.tint(key, tint)), block() {}, planItem() {} };
    return { B, T };
  }
  function buildRoomStations(pg) {
    const E = G.sys.engine, low = (E?.preset?.name || 'low') === 'low';
    const grp = new THREE.Group(); grp.name = 'cooking-stations';
    pg.add(grp);
    const R = { group: grp, placeGroup: pg, spots: {}, interacts: [], colliders: [], fires: {}, shelfJars: null, servedModels: [], t: 0 };
    const { B, T } = bucketOf();
    const A = (k) => anchorLocal(pg, k);
    const gam = A('gamasot'), siru = A('siru'), agu = A('agungi'), mae = A('maetdol'), sob = A('soban');
    // the big 가마솥 sits 0.35 m west of its anchor; its 아궁이 mouth is on the 부뚜막 front at the pot's z
    const pot = gam ? new THREE.Vector3(gam.x - 0.35, gam.y - 0.05, gam.z) : new THREE.Vector3(-5.0, 0.95, -0.5);
    const sru = siru ? new THREE.Vector3(siru.x - 0.3, siru.y - 0.1, siru.z) : new THREE.Vector3(-5.0, 1.0, 1.3);
    const mouthX = agu ? agu.x - 0.35 : -4.5;
    // ---- 물두멍: a wooden 함지박 (wash basin) on the floor in front of it
    const md = NEW_AT.muldumeong;
    K.pot(T, { kind: 'basin', x: md.x, z: md.z, s: 1.15, tint: '#9a6a44' });
    // ---- 도마: a low 안반 table with a board and a 함지 of water
    const dm = NEW_AT.doma;
    const tb = K.table(T, { x: dm.x, z: dm.z, w: 0.95, d: 0.52, h: 0.34, legs: 'straight', tone: '#7a5232', rotY: 0.08 });
    T.add('furn', K.geo.slab(0.56, 0.035, 0.3, 0.008), M(dm.x + 0.08, (tb?.top ?? 0.34) + 0.018, dm.z, 0.08), '#c8a57a');
    // ---- 화로와 석쇠: an earthen brazier with coals and an iron grid
    const hw = NEW_AT.hwaro;
    K.pot(T, { kind: 'brazier', x: hw.x, z: hw.z, s: 1.25, mat: 'onggi', tint: '#7d5a40' });
    const hTop = 0.36;
    for (let i = -4; i <= 4; i++) T.add('iron', K.geo.slab(0.36, 0.006, 0.006, 0.001), M(hw.x, hTop + 0.02, hw.z + i * 0.035), '#3a3836');
    for (const s of [-1, 1]) T.add('iron', K.geo.slab(0.008, 0.008, 0.33, 0.001), M(hw.x + s * 0.17, hTop + 0.024, hw.z), '#3a3836');
    T.add('iron', K.geo.slab(0.012, 0.012, 0.22, 0.002), M(hw.x + 0.29, hTop + 0.024, hw.z), '#3a3836');   // the handle
    // ---- 솥뚜껑 on three stones over a small fire
    const sl = NEW_AT.sotttukkeong;
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.3; T.add('stone', new THREE.DodecahedronGeometry(0.11, 0).scale(1, 1.35, 1), M(sl.x + Math.cos(a) * 0.2, 0.13, sl.z + Math.sin(a) * 0.2, a), '#a39b8c'); }
    T.add('earth', new THREE.CircleGeometry(0.26, 14).rotateX(-PI / 2), M(sl.x, 0.006, sl.z), '#4a3a2c');
    for (let i = 0; i < 4; i++) T.add('wood', new THREE.CylinderGeometry(0.022, 0.026, 0.34, 6).rotateZ(PI / 2), M(sl.x, 0.04 + (i % 2) * 0.03, sl.z, i * 0.8), '#5a4030');
    // ---- 양념 선반 on the east wall: two boards on brackets; the jars are drawn from the player's own products
    const yn = NEW_AT.yangnyeom;
    for (const y of [0.9, 1.35]) { T.add('furn', K.geo.slab(0.32, 0.03, 1.1, 0.006), M(yn.x, y, yn.z), '#7b5536'); for (const dz of [-0.45, 0.45]) T.add('furn', K.geo.slab(0.04, 0.12, 0.03, 0.004), M(yn.x + 0.12, y - 0.07, yn.z + dz), '#6a4628'); }
    // ---- the serving 소반 on a straw mat
    const sv = NEW_AT.soban;
    K.floorMat?.(T, { x: sv.x, z: sv.z, w: 1.6, d: 1.1, tint: '#cdb27a' });
    const st2 = K.table(T, { x: sv.x, z: sv.z, w: 0.7, d: 0.5, h: 0.3, legs: 'curved', tone: '#6b3a22', round: false });
    const sTop = st2?.top ?? 0.3;
    B.build(grp, { name: 'cook', materials: kitMats() });
    // ---- the 아궁이 fires (my own: a flame sprite + an ember glow at the big mouth, the brazier and the 솥뚜껑 fire)
    const fire = (x, y, z, s) => {
      const g = new THREE.Group(); g.position.set(x, y, z);
      const fm = new THREE.SpriteMaterial({ map: flameSprite(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      const fl = []; for (let i = 0; i < 3; i++) { const sp = new THREE.Sprite(fm); sp.position.set((i - 1) * 0.06 * s, 0.08 * s, (i % 2) * 0.03); sp.scale.set(0.14 * s, 0.26 * s, 1); g.add(sp); fl.push(sp); }
      const em = new THREE.Mesh(new THREE.CircleGeometry(0.16 * s, 12).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: new THREE.Color('#ff6a1a'), emissiveIntensity: 0.2, roughness: 0.9 }));
      em.position.y = 0.01; g.add(em);
      grp.add(g);
      return { g, fm, fl, em, level: 0, s };
    };
    R.fires.gamasot = fire(mouthX + 0.05, 0.16, pot.z, 1.0);
    R.fires.hwaro = fire(hw.x, hTop - 0.04, hw.z, 0.9);
    R.fires.sotttukkeong = fire(sl.x, 0.03, sl.z, 1.1);
    // the 솥뚜껑 itself and the 가마솥 collar (my meshes: they open when something cooks in them)
    const lidV = vessel('sotttukkeong', (x) => x);
    lidV.group.position.set(sl.x, 0.27, sl.z); grp.add(lidV.group);
    // ---- spots: work = where the food sits (local), stand = where the player stands, face = what the camera looks at
    const sp = (id, work, stand) => { R.spots[id] = { work, stand }; };
    sp('muldumeong', new THREE.Vector3(md.x, 0.12, md.z), { x: md.x + 0.75, z: md.z + 0.7 });
    sp('doma', new THREE.Vector3(dm.x + 0.08, (tb?.top ?? 0.34) + 0.036, dm.z), { x: dm.x + 0.75, z: dm.z + 0.65 });
    sp('gamasot', pot.clone().setY(pot.y + 0.47 * 1.15), { x: mouthX + 1.05, z: pot.z + 0.45 });
    sp('siru', sru.clone().setY(sru.y + 0.33), { x: mouthX + 1.0, z: sru.z - 0.4 });
    sp('hwaro', new THREE.Vector3(hw.x, hTop + 0.04, hw.z), { x: hw.x + 0.8, z: hw.z - 0.5 });
    sp('sotttukkeong', new THREE.Vector3(sl.x, 0.29, sl.z), { x: sl.x + 0.85, z: sl.z - 0.35 });
    sp('maetdol', mae ? new THREE.Vector3(1.25, 0.24, 2.95) : new THREE.Vector3(1.25, 0.24, 2.95), { x: 1.25, z: 2.15 });
    sp('yangnyeom', new THREE.Vector3(yn.x - 0.05, 0.92, yn.z), { x: yn.x - 0.95, z: yn.z });
    sp('chanjang', new THREE.Vector3(1.4, 1.0, -3.45), { x: 1.4, z: -2.55 });
    sp('soban', new THREE.Vector3(sv.x, sTop, sv.z), { x: sv.x, z: sv.z + 0.85 });
    // the 소반 of the room (the laid one) is decoration; the serving 소반 is ours
    void sob;
    // ---- colliders (things a child walks around)
    const P = G.sys.places, def = P?.def?.(ROOM), ox = def?.origin.x || 0, oz = def?.origin.z || 2000;
    const box = (x, z, hw2, hd) => { const id = G.world.addCollider({ shape: 'box', x: x + ox, z: z + oz, hw: hw2, hd, rot: 0, tag: 'cooking' }); R.colliders.push(id); };
    box(dm.x, dm.z, 0.5, 0.3); box(hw.x, hw.z, 0.24, 0.24); box(sl.x, sl.z, 0.3, 0.3); box(sv.x, sv.z, 0.38, 0.28); box(md.x, md.z, 0.3, 0.3);
    // ---- interactables
    const W = (v) => new THREE.Vector3(v.x + ox, (v.y ?? 1) + (def?.floorY || 0), v.z + oz);
    const reg = (id, label, kidLabel, emoji, pos, fn, radius = 2.1) => {
      const hnd = G.interact?.register?.({ id: 'COOK_' + id, kind: 'kitchen', label, kidLabel, emoji, position: W(pos), radius, priority: 0.6,
        enabled: () => P?.is?.(ROOM) && !session, onInteract: fn });
      if (hnd) R.interacts.push(hnd);
    };
    for (const [id, s] of Object.entries(C.stations)) {
      if (id === 'hwadeok') continue;
      const spot = R.spots[id];
      if (!spot) continue;
      const pos = { x: spot.work.x, y: Math.max(0.8, spot.work.y + 0.4), z: spot.work.z };
      reg(id, `${s.emoji} ${s.name} — ${id === 'chanjang' ? '재료 꺼내기' : id === 'yangnyeom' ? '내 장 보기' : id === 'soban' ? '차린 상 보기' : '요리하기'}`, id === 'chanjang' ? '재료 꺼내요' : id === 'soban' ? '상을 봐요' : '요리해요', s.emoji, pos, () => api.open(id));
    }
    R.lidV = lidV;
    // the 가마솥 opened: its own lid is part of the room's merged mesh, so while something cooks in it an iron collar
    // rises from the rim around the lid (the pot reads deeper and open) and the food's surface sits at the collar's top
    {
      const r = 0.3 * 1.15, top = R.spots.gamasot.work.y + 0.05, bottom = pot.y + 0.41 * 1.15 - 0.01;
      const cm = K.mat('iron');
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.05, top - bottom), 28, 1, true), cm);
      collar.position.set(pot.x, (top + bottom) / 2, pot.z);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 28).rotateX(PI / 2), cm);
      lip.position.set(pot.x, top, pot.z);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 28).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 0.8 }));
      inside.position.set(pot.x, top - 0.035, pot.z);
      const cg = new THREE.Group(); cg.add(collar, lip, inside); cg.visible = false; grp.add(cg);
      R.collar = cg;
    }
    refreshShelf(R);
    refreshTable(R);
    if (low) for (const f of Object.values(R.fires)) f.fm.opacity = 0;
    return R;
  }
  function disposeRoomStations() {
    if (!room) return;
    for (const h2 of room.interacts) { try { h2.unregister(); } catch (e) { /* gone */ } }
    for (const id of room.colliders) G.world.removeCollider?.(id);
    for (const m of room.servedModels) m.dispose();
    if (room.shelfJars) room.shelfJars.dispose?.();
    room.group.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    room.group.parent?.remove(room.group);
    room = null;
  }
  /** the 양념 선반 shows the player's own jar products: a small 단지 per product kind (≤ 8), with a paper name tag */
  function refreshShelf(R) {
    if (!R) return;
    if (R.shelfJars) { R.shelfJars.dispose(); R.shelfJars = null; }
    const seasonIds = [...new Set(Object.values(C.dishes).flatMap((d) => d.ingredients.filter((g) => g.season).flatMap((g) => g.season)))];
    const mine = seasonIds.filter((id) => countOf(id) > 0).slice(0, 8);
    const { B, T } = bucketOf();
    const yn = NEW_AT.yangnyeom;
    mine.forEach((id, i) => {
      const y = i < 4 ? 0.915 : 1.365, z = yn.z - 0.39 + (i % 4) * 0.26;
      K.pot(T, { kind: 'danji', x: yn.x - 0.02, y, z, s: 0.36, lid: true, tint: id === 'ITEM_GANJANG' ? '#4a2c1c' : '#7a4a30' });
    });
    const g = new THREE.Group(); g.name = 'cook-shelf';
    B.build(g, { name: 'cook-shelf', materials: kitMats() });
    // name tags (one canvas)
    if (mine.length) {
      const tex = G.gfx.canvasTexture(512, 64, (c, w, hh) => { c.fillStyle = '#f2e6c8'; c.fillRect(0, 0, w, hh); c.fillStyle = '#4a3320'; c.font = '700 26px "PretendardEmbed","Pretendard","Noto Sans KR",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; mine.forEach((id, i) => c.fillText(itemName(id).slice(0, 4), (i + 0.5) * (w / 8), hh / 2)); });
      const tm = new THREE.MeshBasicMaterial({ map: tex, color: 0xd8d0c0 });
      mine.forEach((id, i) => {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.05), tm);
        const geo2 = pl.geometry; const uv = geo2.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 8); uv.needsUpdate = true;
        const y = i < 4 ? 0.86 : 1.31, z = yn.z - 0.39 + (i % 4) * 0.26;
        pl.position.set(yn.x - 0.165, y, z); pl.rotation.y = -PI / 2; g.add(pl);
      });
      g.userData.disposeExtra = [tex, tm];
    }
    R.group.add(g);
    R.shelfJars = { dispose() { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const x of g.userData.disposeExtra || []) x.dispose(); g.parent?.remove(g); } };
  }
  /** the dishes on the serving 소반 (the last ones served, ≤ 3 drawn) */
  function refreshTable(R) {
    if (!R) return;
    for (const m of R.servedModels) m.dispose();
    R.servedModels = [];
    const list = (st()?.table || []).slice(-3);
    const sv = R.spots.soban.work;
    list.forEach((e, i) => {
      const m = buildDish(e.d, { cook: 1 });
      if (!m) return;
      const n = list.length, x = sv.x + (i - (n - 1) / 2) * 0.24;
      m.group.position.set(x, sv.y, sv.z); m.group.scale.setScalar(n > 2 ? 0.8 : 0.95);
      m.steam(0.25);
      R.group.add(m.group); R.servedModels.push(m);
    });
  }

  // ================================================================= the 화덕 by the river (valley)
  function riverSpot() {
    const W = G.world, T = G.sys.terrain;
    const cands = [[81, 55], [80, 58], [82, 52], [79, 61], [83, 49], [78, 64]];
    for (const [x, z] of cands) {
      const rd = T?.riverDistance ? T.riverDistance(x, z) : 12;
      if (rd < 8 || rd > 16) continue;
      if (W.isWater?.(x, z)) continue;
      return { x, z };
    }
    return { x: 81, z: 55 };
  }
  function buildRiver() {
    if (river || !BK || !K) return;
    const E = G.sys.engine;
    if (!E?.scene || !G.world) return;
    const at = riverSpot(), y = G.world.heightAt ? G.world.heightAt(at.x, at.z) : 0;
    const grp = new THREE.Group(); grp.name = 'cooking-hwadeok'; grp.position.set(at.x, y, at.z);
    const { B, T } = bucketOf();
    // a ring of river stones, a flat 솥 stone, a grill and a small pot, a log to sit on
    for (let i = 0; i < 9; i++) { const a = i * TAU / 9; T.add('stone', new THREE.DodecahedronGeometry(0.17 + noise(i) * 0.06, 0).scale(1, 0.8, 1), M(Math.cos(a) * 0.48, 0.1, Math.sin(a) * 0.48, a), noise(i + 3) > 0.5 ? '#9c9584' : '#b3ab9a'); }
    T.add('earth', new THREE.CircleGeometry(0.4, 16).rotateX(-PI / 2), M(0, 0.01, 0), '#3d2f24');
    for (let i = 0; i < 5; i++) T.add('wood', new THREE.CylinderGeometry(0.03, 0.035, 0.5, 6).rotateZ(PI / 2), M(0, 0.05 + (i % 2) * 0.04, 0, i * 0.63), '#5c4330');
    for (let i = -4; i <= 4; i++) T.add('iron', K.geo.slab(0.6, 0.008, 0.008, 0.001), M(0, 0.36, i * 0.05), '#3a3836');
    T.add('wood', new THREE.CylinderGeometry(0.14, 0.15, 1.3, 9).rotateZ(PI / 2), M(1.25, 0.15, 0.4, 0.5), '#7a5a3c');
    T.add('stone', K.geo.slab(0.6, 0.08, 0.45, 0.03), M(-1.1, 0.04, 0.3, 0.2), '#a8a090');
    B.build(grp, { name: 'hwadeok', materials: kitMats() });
    const fm = new THREE.SpriteMaterial({ map: flameSprite(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const fl = []; for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(fm); s.position.set((i - 1.5) * 0.09, 0.2, (i % 2) * 0.05); s.scale.set(0.2, 0.36, 1); grp.add(s); fl.push(s); }
    const em = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: new THREE.Color('#ff6a1a'), emissiveIntensity: 0.15, roughness: 0.9 }));
    em.position.y = 0.02; grp.add(em);
    E.scene.add(grp);
    try { G.sys.places?.hideRoot?.('cooking-hwadeok'); } catch (e) { /* places optional */ }
    G.world.addCollider?.({ shape: 'circle', x: at.x, z: at.z, r: 0.7, tag: 'cooking' });
    // a small 🔥 sign board: the river spot's name
    const sign = G.gfx.canvasTexture(256, 96, (c, w, hh) => { c.fillStyle = '#e9dcbc'; c.fillRect(0, 0, w, hh); c.strokeStyle = '#6a4a2a'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, hh - 6); c.fillStyle = '#4a3220'; c.font = '800 40px "PretendardEmbed","Pretendard","Noto Sans KR",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🔥 냇가 화덕', w / 2, hh / 2); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }));
    sm.position.set(-0.9, 1.05, -0.6); sm.rotation.y = 0.6; grp.add(sm);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.0, 6), K.mat('wood')); post.position.set(-0.9, 0.5, -0.62); grp.add(post);
    river = { group: grp, at, y, fire: { g: grp, fm, fl, em, level: 0, s: 1.4 }, spot: { work: new THREE.Vector3(0, 0.37, 0), stand: { x: 0.9, z: 0.85 } } };
    G.interact?.register?.({ id: 'COOK_hwadeok', kind: 'kitchen', label: '🔥 냇가 화덕 — 갓 잡은 물고기 굽기', kidLabel: '물고기 구워요', emoji: '🔥',
      position: new THREE.Vector3(at.x, y + 0.9, at.z), radius: 2.6, priority: 0.5, enabled: () => !G.sys.places?.current && !session, onInteract: () => api.open('hwadeok') });
  }
  function goRiver() {
    buildRiver();
    if (!river) return;
    try { if (G.sys.places?.current) G.sys.places.exit({ to: { x: river.at.x + 1.6, z: river.at.z + 1.6 } }); } catch (e) { /* fallback below */ }
    G.easy?.goTo?.({ x: river.at.x + 1.4, z: river.at.z + 1.4 }, { label: '냇가 화덕' });
  }

  // ================================================================= a cooking session
  let session = null;
  /** world position of a station spot (local room spot → world) */
  function spotWorld(stationId) {
    if (session?.where === 'river') {
      const r = river; if (!r) return null;
      return { work: r.spot.work.clone().add(r.group.position), stand: { x: r.at.x + r.spot.stand.x, z: r.at.z + r.spot.stand.z } };
    }
    const s = room?.spots?.[stationId];
    const def = G.sys.places?.def?.(ROOM);
    if (!s || !def) return null;
    return { work: s.work.clone().add(new THREE.Vector3(def.origin.x, def.floorY || 0, def.origin.z)), stand: { x: s.stand.x + def.origin.x, z: s.stand.z + def.origin.z } };
  }
  const BANDS = { low: [0.18, 0.45], mid: [0.4, 0.7], high: [0.62, 0.92] };
  function start(dishId, opts = {}) {
    const d = C.dishes[dishId];
    if (!d || session) return false;
    const whereAt = opts.where === 'river' ? 'river' : 'kitchen';
    if (whereAt === 'river' && !d.outdoor) { G.ui.toast?.('이 음식은 부엌에서 만들어요', { type: 'info', emoji: '🍚' }); return false; }
    if (whereAt === 'kitchen' && !(G.sys.places?.is?.(ROOM) && room)) { G.ui.toast?.('부엌 안에서 만들어요', { type: 'info', emoji: '🍚' }); return false; }
    if (whereAt === 'river' && !river) buildRiver();
    const c = can(dishId);
    if (!c.ok) { showMissing(d, c); return false; }
    session = { dish: d, where: whereAt, i: -1, plan: c.plan, scores: [], season: null, heat: 0, t0: now(), model: null, opt: c.plan.filter((p) => p.optional && !p.season).length };
    // the food model: built once, moved from station to station
    const fishPlan = c.plan.find((p) => p.fish);
    session.model = buildDish(d.id, { cook: 0, fishItem: fishPlan?.itemId });
    G.ui.block('cooking');
    G.bus.emit('cooking:start', { dish: d.id, where: whereAt });
    sfx('open');
    openDock();
    next();
    return true;
  }
  function next() {
    const s = session;
    if (!s) return;
    s.i++;
    if (s.i >= s.dish.steps.length) return finish();
    const step = s.dish.steps[s.i];
    const act = C.actions[step.action] || { mode: 'tap' };
    s.step = step; s.act = act; s.mode = act.mode; s.p = 0; s.hold = false; s.taps = 0; s.lastTap = 0; s.tWait = 0; s.inBand = 0; s.total = 0;
    s.turnAt = null; s.picked = null;
    s.need = Math.max(1, step.seconds) * (easyOn() && act.mode === 'wait' ? 0.85 : 1);
    if (act.mode === 'fire') s.heat = Math.min(s.heat, 0.1);
    placeModel(step.station);
    standAt(step.station);
    renderStep();
    G.bus.emit('cooking:step', { dish: s.dish.id, step: s.i, action: step.action });
    say(step.kid);
  }
  function stepScore(x) { session.scores.push(clamp(x, 0, 1)); }
  function complete(score = 1, msg) {
    if (!session) return;
    stepScore(score);
    sfx(score >= 0.95 ? 'pop' : 'tap');
    if (msg) G.ui.toast?.(msg, { type: 'info', emoji: '🙂', duration: 2200 });
    // the model's lasting change after a step
    const m = session.model, a = session.step.action;
    if (m) {
      if (a === 'salt') m.salt(1);
      if (a === 'brush' || (a === 'season' && session.dish.look.type === 'round')) m.glaze(1);
      if (a === 'serve') { m.steam(0.4); }
    }
    next();
  }
  function cancel() {
    if (!session) return false;
    session.model?.dispose();
    session = null;
    closeDock();
    if (room?.collar) room.collar.visible = false;
    G.ui.unblock('cooking');
    try { G.sys.camera?.setMode?.('follow'); } catch (e) { /* camera optional */ }
    for (const f of fireList()) f.level = 0;
    G.ui.toast?.('그만했어요. 재료는 그대로 있어요.', { type: 'info', emoji: '🧺' });
    return true;
  }
  /** where the food model sits for a station (the vessel of the station, or the 도마 / the 소반) */
  function placeModel(stationId) {
    const s = session, m = s?.model;
    if (!m) return;
    const sw = spotWorld(stationId === 'yangnyeom' ? lastCookStation() : stationId);
    if (!sw) return;
    const sc = G.sys.engine?.scene;
    if (m.group.parent !== sc) sc?.add(m.group);
    m.group.position.copy(sw.work);
    m.group.rotation.set(0, 0, 0);
    // the vessel shows only when the food is served; on the 도마 / in the pot the food sits on its own
    const v = m.group.children[0];
    if (v) v.visible = stationId === 'soban' || session.dish.vessel === 'sotttukkeong' && stationId === 'sotttukkeong';
    if (stationId === 'gamasot' || stationId === 'siru') m.group.position.y += stationId === 'siru' ? 0.02 : -0.02;
    if (room?.collar) room.collar.visible = session.where === 'kitchen' && stationId === 'gamasot';
  }
  function lastCookStation() {
    const s = session;
    for (let i = s.i; i >= 0; i--) { const st2 = s.dish.steps[i].station; if (st2 !== 'yangnyeom') return st2; }
    return 'doma';
  }
  function standAt(stationId) {
    const sw = spotWorld(stationId === 'yangnyeom' ? 'yangnyeom' : stationId);
    if (!sw) return;
    const P = G.sys.player;
    const dx = sw.work.x - sw.stand.x, dz = sw.work.z - sw.stand.z;
    try { P?.teleport?.(sw.stand.x, sw.stand.z, Math.atan2(dx, dz), { fade: false, silent: true }); } catch (e) { /* player optional */ }
    session.cam = { look: sw.work.clone(), pos: new THREE.Vector3(sw.stand.x - dx * 0.25, sw.work.y + 0.95, sw.stand.z - dz * 0.25 + 0.0) };
    // the camera sits behind and above the player's shoulder, looking down at the food
    const len = Math.hypot(dx, dz) || 1;
    session.cam.pos.set(sw.stand.x - (dx / len) * 0.9 + (dz / len) * 0.45, sw.work.y + 1.05, sw.stand.z - (dz / len) * 0.9 - (dx / len) * 0.45);
  }
  const fireList = () => [...(room ? Object.values(room.fires) : []), ...(river ? [river.fire] : [])];
  function fireFor(stationId) {
    if (session?.where === 'river') return river?.fire || null;
    if (!room) return null;
    if (stationId === 'siru') return room.fires.gamasot;
    return room.fires[stationId] || null;
  }

  // ---------------------------------------------------------------- per frame
  function tick(dt, t) {
    const s = session, ts = Math.max(0.1, api.timeScale || 1);
    const sdt = dt * ts;
    // fires: what heat they show (the session's heat at the station that cooks, a low glow elsewhere while a dish is on)
    const cookSt = s ? (s.step && s.step.station !== 'yangnyeom' && s.step.station !== 'doma' && s.step.station !== 'muldumeong' && s.step.station !== 'soban' ? s.step.station : lastCookStationSafe()) : null;
    for (const f of fireList()) {
      const target = s && fireFor(cookSt) === f ? s.heat : 0;
      f.level = lerp(f.level, target, 1 - Math.exp(-dt * 3));
      const lv = f.level, calm = reduced();
      f.fm.opacity = lv > 0.02 ? clamp(0.25 + lv * 0.8, 0, 1) : 0;
      f.fl.forEach((sp, i) => { const fl = calm ? 1 : 0.9 + 0.1 * Math.sin(t * (2.1 + i * 0.37) + i); sp.scale.set(0.14 * f.s * (0.6 + lv * 0.6), 0.26 * f.s * (0.4 + lv * 0.9) * fl, 1); sp.position.y = 0.08 * f.s * (0.6 + lv); });
      f.em.material.emissiveIntensity = 0.15 + lv * 1.6;
    }
    if (room) for (const m of room.servedModels) m.update(dt, t);
    if (!s || !s.step) return;
    s.clock = (s.clock || 0) + dt;
    const step = s.step, m = s.model;
    // the cook level of the model rises over the cooking steps (wait / fire / stir / grill / fry / boil / steam)
    const cookSteps = s.dish.steps.filter((x) => ['boil', 'grill', 'steam', 'fry', 'stir', 'rest'].includes(x.action));
    const done = s.dish.steps.slice(0, s.i).filter((x) => ['boil', 'grill', 'steam', 'fry', 'stir', 'rest'].includes(x.action)).length;
    const live = ['boil', 'grill', 'steam', 'fry', 'stir', 'rest'].includes(step.action) ? clamp(s.p, 0, 1) : 0;
    const cookK = cookSteps.length ? (done + live) / cookSteps.length : 1;
    if (m) {
      m.setCook(cookK);
      const heatK = s.heat;
      if (['boil', 'stir'].includes(step.action)) m.boil(0.25 + 0.75 * heatK); else m.boil(step.action === 'fire' ? heatK * 0.4 : Math.max(0, (m.parts.boil || 0) - dt * 0.3));
      m.steam(clamp(cookK * 0.6 + (step.action === 'steam' ? live * 0.8 : 0), 0, 1));
      if (step.action === 'grill' || step.action === 'fry') m.crust(clamp((m.parts.crust || 0) + sdt / Math.max(4, s.need) * 0.5, 0, 1));
      if (step.action === 'rest' && s.p > 0.6) m.nurungji(true);
      m.update(dt, t);
      // a calm wash / grind / stir motion of the food itself
      if (!reduced()) {
        if (step.action === 'wash' || step.action === 'rinse') m.group.rotation.y = s.hold ? Math.sin(t * 2.2) * 0.25 : m.group.rotation.y * 0.9;
        else if (step.action === 'stir' || step.action === 'grind') m.group.rotation.y += s.hold ? dt * 1.2 : 0;
      }
    }
    // heat: sinks slowly; a fire step keeps it where the child holds it; later steps keep the last band's middle
    const band = BANDS[step.heat] || null;
    if (s.mode === 'fire') {
      const up = easyOn() ? 0.22 : 0.28, down = easyOn() ? 0.035 : 0.06;
      s.heat = clamp(s.heat + (s.hold ? up : -down) * sdt, 0, 1);
      s.total += sdt;
      if (band && s.heat >= band[0] && s.heat <= band[1]) { s.inBand += sdt; s.p = clamp(s.inBand / s.need, 0, 1); }
      s.lastBand = band;
      if (s.p >= 1) return complete(clamp(0.6 + 0.4 * (s.inBand / Math.max(s.inBand, s.total)), 0, 1));
      if (G.sys.audio && (s._crackle = (s._crackle || 0) - sdt) <= 0) { s._crackle = 0.6 - s.heat * 0.3; if (s.heat > 0.15) sfx('fire_crackle', { volume: 0.4 + s.heat * 0.4 }); }
    } else if (['boil', 'grill', 'steam', 'fry', 'stir', 'rest'].includes(step.action)) {
      const want = s.lastBand ? (s.lastBand[0] + s.lastBand[1]) / 2 : 0.55;
      s.heat = lerp(s.heat, step.action === 'rest' ? 0.2 : want, 1 - Math.exp(-dt * 0.8));
      if (G.sys.audio && (s._snd = (s._snd || 0) - sdt) <= 0) {
        const n = step.action === 'fry' || step.action === 'grill' ? 'sizzle' : step.action === 'steam' ? 'steam_hiss' : step.action === 'stir' ? 'stir' : 'boil';
        s._snd = n === 'boil' ? 0.7 : 1.1; sfx(n, { volume: 0.5 });
      }
    }
    if (s.mode === 'hold') {
      if (s.hold) { s.p = clamp(s.p + sdt / s.need, 0, 1); if ((s._hs = (s._hs || 0) - sdt) <= 0) { s._hs = 0.55; sfx(holdSound(step.action), { volume: 0.45 }); } }
      if (s.p >= 1) return complete(1);
    } else if (s.mode === 'wait') {
      s.p = clamp(s.p + sdt / s.need, 0, 1);
      if (s.p >= 1) return complete(1);
    } else if (s.mode === 'window') {
      // the edge browns (the 굽기 before it already started it); the window opens at 0.72, lasts ≥ 2.5 s (4 s easy)
      const win = easyOn() ? 4 : 2.6;
      s.p = clamp(s.p + sdt / (s.need + win), 0, 1);
      if (s.turnAt === null && s.p >= 0.72) { s.turnAt = s.p; sfx('notify', { volume: 0.5 }); say('지금 뒤집어요!'); }
      if (s.p >= 1) return complete(0.75, '조금 진하게 구워졌어요. 괜찮아요!');
    }
    updateDock();
    // the camera: a shot over the shoulder onto the food
    if (s.cam && G.sys.camera?.shot) {
      try { G.sys.camera.shot(s.cam.pos, s.cam.look, { fov: easyOn() ? 46 : 42, duration: 0.9 }); } catch (e) { /* camera optional */ }
    }
  }
  function lastCookStationSafe() { try { return lastCookStation(); } catch (e) { return null; } }
  const holdSound = (a) => (a === 'wash' || a === 'rinse' || a === 'pour' || a === 'drop' ? 'pour' : a === 'grind' ? 'grind' : a === 'stir' ? 'stir' : a === 'knead' || a === 'mix' ? 'knead' : 'chop');

  // ---------------------------------------------------------------- input on the dock
  function pressDown() {
    const s = session; if (!s) return;
    if (s.mode === 'hold' || s.mode === 'fire') { s.hold = true; return; }
    if (s.mode === 'taps') {
      const t = s.clock || 0;   // the session's own clock (real seconds, advanced every frame)
      if (s.taps > 0 && t - s.lastTap < 0.6) { G.ui.toast?.('천천히 해요 🙂', { type: 'info', duration: 1400 }); return; }
      s.lastTap = t; s.taps++; sfx(s.step.action === 'pound' ? 'pound' : 'tap', { volume: 0.6 });
      const n = s.step.count || 3; s.p = s.taps / n;
      if (s.model && s.step.action === 'salt') s.model.salt(s.p);
      updateDock();
      if (s.taps >= n) complete(1);
      return;
    }
    if (s.mode === 'tap') { sfx(s.step.action === 'serve' ? 'place' : 'pop'); return complete(1); }
    if (s.mode === 'window') {
      if (s.p < 0.5) { G.ui.toast?.('아직 덜 노릇해요. 조금만 더 기다려요.', { type: 'info', emoji: '⏳', duration: 1800 }); return; }
      const inWin = s.turnAt !== null;
      if (s.model) { s.model.group.rotation.z = 0; s.model.crust(Math.max(s.model.parts.crust, 0.5)); }
      sfx('turn');
      return complete(inWin ? 1 : 0.7, inWin ? null : '조금 일찍 뒤집었어요. 괜찮아요!');
    }
  }
  function pressUp() { if (session) session.hold = false; }
  function pick(itemId) {
    const s = session; if (!s || s.mode !== 'pick') return;
    s.season = itemId || null;
    sfx(itemId ? 'jar' : 'tap');
    complete(itemId ? 1 : 0.6, itemId ? null : '부엌 양념으로 맛을 냈어요');
  }

  // ---------------------------------------------------------------- the end: stars, the 소반, the 도감
  function finish() {
    const s = session;
    if (!s) return;
    const d = s.dish;
    // take the ingredients now (cancel never used anything up)
    const used = [];
    for (const p of s.plan) {
      if (p.season && p.itemId !== s.season) continue;
      const n = takeItem(p.itemId, p.n);
      if (n > 0) used.push({ itemId: p.itemId, n });
    }
    const fishUsed = used.filter((u) => u.itemId.indexOf('FISH_') === 0);
    const fresh = fishUsed.length ? fishUsed.reduce((a, u) => a + freshness(u.itemId), 0) / fishUsed.length : 0.9;
    for (const u of fishUsed) { const arr = st()?.catches?.[u.itemId]; if (Array.isArray(arr)) arr.splice(Math.max(0, arr.length - u.n), u.n); }
    const timing = s.scores.length ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : 1;
    const hasSeason = d.ingredients.some((g) => g.season);
    const own = hasSeason ? (s.season ? 1 : 0.6) : 0.85;
    const season = clamp(own + Math.min(0.15, s.opt * 0.05), 0, 1);
    const score = timing * 0.45 + fresh * 0.25 + season * 0.3;
    const stars = score >= 0.86 ? 3 : score >= 0.62 ? 2 : 1;
    const S2 = st();
    const first = !S2.book[d.id];
    const b = S2.book[d.id] || (S2.book[d.id] = { n: 0, best: 0, first: Math.round(now()), last: 0 });
    b.n = Math.min(1e6, b.n + 1); b.best = Math.max(b.best, stars); b.last = Math.round(now());
    S2.table.push({ d: d.id, s: stars, t: Math.round(now()) });
    while (S2.table.length > C.limits.tableMax) S2.table.shift();
    const P = G.sys.progression;
    P?.incStat?.('dishesCooked', 1);
    if (first) P?.incStat?.('dishKinds', 1);
    if (stars === 3) P?.incStat?.('dishStars3', 1);
    const n = P?.getStat?.('dishesCooked') || b.n;
    G.bus.emit('interact', { kind: 'cooking', id: 'cook-' + n });
    if (d.kind === 'fish') G.bus.emit('interact', { kind: 'cookfish', id: 'cookfish-' + n });
    G.bus.emit('interact', { kind: 'cookbook', id: d.id });
    if (d.kind === 'jeongseon') G.bus.emit('interact', { kind: 'cookjeongseon', id: d.id });
    G.bus.emit('cooking:done', { dish: d.id, stars, where: s.where, fresh, timing, season: s.season });
    sfx('reward');
    const model = s.model; s.model = null;
    const whereAt = s.where;
    session = null;
    closeDock();
    if (room?.collar) room.collar.visible = false;
    G.ui.unblock('cooking');
    for (const f of fireList()) f.level = 0;
    try { G.sys.camera?.setMode?.('follow'); } catch (e) { /* camera optional */ }
    // leave the served dish where it is: on the 소반 inside (redrawn from the table), at the 화덕 for a moment outside
    if (whereAt === 'kitchen') { model?.dispose(); refreshTable(room); refreshShelf(room); }
    else if (model) { model.steam(0.3); model.group.position.add(new THREE.Vector3(-1.1, -0.29, 0.3)); river.lastModel?.dispose(); river.lastModel = model; }
    showResult(d, { stars, timing, fresh, season: s.season, first, fishUsed });
    G.save?.markDirty?.('cooking');
  }

  // ================================================================= the dock (cooking card at the bottom)
  let dock = null, dockEsc = null;
  function openDock() {
    closeDock();
    const root = document.getElementById('hud') || document.body;
    dock = h('section', { class: 'cook-dock', role: 'region', 'aria-label': '요리하기', 'data-cook': '1' });
    root.appendChild(dock);
    dockEsc = G.ui.onEscape(() => { if (!session) return false; confirmCancel(); return true; }, 20);
  }
  function closeDock() { dock?.remove(); dock = null; dockEsc?.(); dockEsc = null; }
  async function confirmCancel() {
    const ok = easyOn() ? await G.easy.confirm({ emoji: '🧺', title: '그만할까요?', text: '재료는 그대로 있어요.', say: '그만할까요? 재료는 그대로 있어요.', yes: '그만해요', no: '계속해요' })
      : await G.ui.confirm('쓴 재료는 없어요. 처음부터 다시 할 수 있어요.', { title: '요리를 그만할까요?', okText: '그만하기', cancelText: '계속하기' });
    if (ok) cancel();
  }
  const FIRE_STEPS = new Set(['fire', 'boil', 'grill', 'fry', 'turn', 'steam', 'stir', 'rest', 'brush']);
  function renderStep() {
    if (!dock || !session) return;
    const s = session, d = s.dish, step = s.step, act = s.act, easy = easyOn();
    const stn = C.stations[s.where === 'river' && ['gamasot', 'hwaro', 'sotttukkeong', 'siru'].includes(step.station) ? 'hwadeok' : step.station] || {};
    dock.textContent = '';
    dock.className = 'cook-dock' + (easy ? ' cook-easy' : '');
    const head = h('header', { class: 'cook-head' },
      h('span', { class: 'cook-dish emoji', 'aria-hidden': 'true' }, d.emoji),
      h('div', { class: 'cook-title' }, h('b', null, d.name), h('span', { class: 'cook-count' }, `${s.i + 1} / ${d.steps.length}`)),
      h('button', { type: 'button', class: 'cook-stop', 'aria-label': '그만하기', 'data-say': '그만할래요', onclick: () => confirmCancel() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✖'), h('span', null, '그만')));
    const dots = h('div', { class: 'cook-dots', 'aria-hidden': 'true' });
    d.steps.forEach((x, i) => dots.appendChild(h('i', { class: i < s.i ? 'done' : i === s.i ? 'now' : '' })));
    const body = h('div', { class: 'cook-step' },
      h('div', { class: 'cook-what' }, h('span', { class: 'cook-ico emoji', 'aria-hidden': 'true' }, act.emoji || '🥣'),
        h('div', null, h('div', { class: 'cook-verb' }, `${act.verb}`), h('div', { class: 'cook-where' }, `${stn.emoji || ''} ${stn.name || ''}`))),
      h('p', { class: 'cook-kid', 'data-say': step.kid }, step.kid),
      easy ? null : h('p', { class: 'cook-note' }, step.note),
      FIRE_STEPS.has(step.action) ? h('p', { class: 'cook-safe' }, '🔥 불 곁에서는 어른과 함께해요. 뜨거운 솥과 기름은 만지지 않아요.') : null,
      d.kind === 'fish' && (step.action === 'rinse') ? h('p', { class: 'cook-safe' }, '🧽 ' + C.safety) : null);
    const ctl = h('div', { class: 'cook-ctl' });
    s.ui = { ctl };
    if (s.mode === 'pick') {
      const g = d.ingredients.find((x) => x.season) || { season: [] };
      const own2 = g.season.filter((id) => countOf(id) > 0);
      const grid = h('div', { class: 'cook-picks' });
      for (const id of own2) grid.appendChild(h('button', { type: 'button', class: 'cook-pick mine', 'data-say': `내가 담근 ${itemName(id)}`, onclick: () => pick(id) }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, itemIcon(id)), h('b', null, itemName(id)), h('small', null, '⭐ 내가 담근 장')));
      grid.appendChild(h('button', { type: 'button', class: 'cook-pick', 'data-say': '부엌 양념', onclick: () => pick(null) }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧂'), h('b', null, '부엌 양념'), h('small', null, own2.length ? '조금 심심해요' : '장독대에서 장을 담그면 더 맛있어요')));
      ctl.appendChild(grid);
    } else {
      const big = h('button', { type: 'button', class: 'cook-big', 'data-say': step.kid, 'aria-label': act.verb });
      const label = s.mode === 'hold' || s.mode === 'fire' ? (s.mode === 'fire' ? '🪵 장작 넣기 (꾹)' : '꾹 누르기') : s.mode === 'taps' ? `톡 (${step.count || 3}번)` : s.mode === 'wait' ? '⏳ 기다려요' : s.mode === 'window' ? '🔄 뒤집기' : act.verb;
      big.appendChild(h('span', { class: 'emoji', 'aria-hidden': 'true' }, act.emoji || '🥣'));
      big.appendChild(h('span', { class: 'cook-big-l' }, label));
      if (s.mode === 'wait') big.disabled = true;
      const down = (e) => { e.preventDefault(); try { big.setPointerCapture?.(e.pointerId); } catch (er) { /* ok */ } pressDown(); };
      const up = () => pressUp();
      big.addEventListener('pointerdown', down);
      big.addEventListener('pointerup', up); big.addEventListener('pointercancel', up); big.addEventListener('lostpointercapture', up);
      big.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); pressDown(); } });
      big.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressUp(); } });
      big.addEventListener('click', (e) => { if (e.detail === 0 && !['hold', 'fire'].includes(s.mode)) { /* keyboard click already handled on keydown */ } });
      const bar = h('div', { class: 'cook-bar' + (s.mode === 'fire' ? ' fire' : '') }, h('i', { class: 'fill' }));
      if (s.mode === 'fire') {
        const b2 = BANDS[step.heat] || BANDS.mid;
        bar.appendChild(h('span', { class: 'band', style: `left:${b2[0] * 100}%;width:${(b2[1] - b2[0]) * 100}%` }));
        bar.appendChild(h('span', { class: 'needle' }));
      }
      if (s.mode === 'window') bar.appendChild(h('span', { class: 'band turn', style: 'left:72%;width:28%' }));
      s.ui.big = big; s.ui.bar = bar; s.ui.msg = h('div', { class: 'cook-msg', 'aria-live': 'polite' });
      ctl.append(big, bar, s.ui.msg);
    }
    dock.append(head, dots, body, ctl);
    if (s.ui.big && !G.input?.touchUI) setTimeout(() => { try { s.ui?.big?.focus({ preventScroll: true }); } catch (e) { /* ok */ } }, 30);
    updateDock();
  }
  function updateDock() {
    const s = session;
    if (!dock || !s || !s.ui || !s.ui.bar) return;
    const fill = s.ui.bar.querySelector('.fill'), needle = s.ui.bar.querySelector('.needle');
    if (s.mode === 'fire') {
      if (fill) fill.style.transform = `scaleX(${clamp(s.p, 0, 1).toFixed(3)})`;
      if (needle) needle.style.transform = `translateX(${(s.heat * 100).toFixed(1)}%)`;
      const b2 = BANDS[s.step.heat] || BANDS.mid;
      const msg = s.heat < b2[0] ? '불이 약해요 — 장작을 더 넣어요' : s.heat > b2[1] ? '불이 세요 — 손을 떼고 기다려요' : '알맞아요! 그대로 지켜요';
      if (s.ui.msg.textContent !== msg) s.ui.msg.textContent = msg;
      s.ui.bar.style.setProperty('--heat', s.heat.toFixed(3));
    } else {
      if (fill) fill.style.transform = `scaleX(${clamp(s.p, 0, 1).toFixed(3)})`;
      if (s.mode === 'window' && s.ui.big) { const ready = s.turnAt !== null; s.ui.big.classList.toggle('ready', ready); const msg = ready ? '지금이에요! 뒤집어요' : s.p < 0.5 ? '가장자리를 지켜봐요' : '노릇노릇해지고 있어요'; if (s.ui.msg.textContent !== msg) s.ui.msg.textContent = msg; }
      if (s.mode === 'wait') { const left = Math.max(0, Math.ceil((1 - s.p) * s.need / Math.max(0.1, api.timeScale || 1))); const msg = `${left}초쯤 기다려요`; if (s.ui.msg.textContent !== msg) s.ui.msg.textContent = msg; }
      if (s.mode === 'hold') { const msg = s.hold ? '잘하고 있어요!' : '꾹 누르고 있어요'; if (s.ui.msg.textContent !== msg) s.ui.msg.textContent = msg; }
      if (s.mode === 'taps') { const msg = `${s.taps} / ${s.step.count || 3}`; if (s.ui.msg.textContent !== msg) s.ui.msg.textContent = msg; }
    }
  }

  // ================================================================= screens: the picker, missing things, the result
  function dishTile(d, onClick) {
    const c = can(d.id), b = st()?.book?.[d.id];
    return h('button', { type: 'button', class: 'cook-tile' + (c.ok ? ' ok' : ' miss') + (b ? ' made' : ''), 'data-dish': d.id, 'data-say': `${d.name}. ${c.ok ? '만들 수 있어요' : '재료가 조금 모자라요'}`, onclick: () => onClick(d) },
      h('span', { class: 'cook-tile-e emoji', 'aria-hidden': 'true' }, d.emoji),
      h('b', null, d.name),
      h('small', null, c.ok ? '✅ 만들 수 있어요' : '🧺 ' + c.missing.map((x) => x.kind === 'fish' ? '🐟' : itemIcon(x.id)).join('')),
      b ? h('span', { class: 'cook-tile-s', 'aria-label': `별 ${b.best}개` }, '⭐'.repeat(b.best)) : null);
  }
  function open(stationId) {
    if (session) return;
    if (stationId === 'chanjang') return pantry();
    if (stationId === 'soban') return table();
    if (stationId === 'yangnyeom') return shelf();
    const atRiver = stationId === 'hwadeok';
    const list = Object.values(C.dishes).filter((d) => (atRiver ? d.outdoor : true));
    // dishes that use this station come first
    if (stationId && !atRiver) list.sort((a, b) => (b.steps.some((x) => x.station === stationId) ? 1 : 0) - (a.steps.some((x) => x.station === stationId) ? 1 : 0) || (can(b.id).ok ? 1 : 0) - (can(a.id).ok ? 1 : 0));
    else list.sort((a, b) => (can(b.id).ok ? 1 : 0) - (can(a.id).ok ? 1 : 0));
    const pickDish = (d) => details(d, atRiver ? 'river' : 'kitchen');
    G.ui.modal.open({
      id: 'cook-pick', title: atRiver ? '냇가 화덕 — 무엇을 구울까요?' : '오늘은 무엇을 만들까요?', icon: atRiver ? '🔥' : '🍳', size: 'lg', className: 'cook-modal', say: atRiver ? '갓 잡은 물고기로 무엇을 만들까요?' : '무엇을 만들까요?',
      body: (el) => {
        el.appendChild(h('p', { class: 'cook-lead', 'data-say': '그림을 누르면 만드는 차례를 볼 수 있어요' }, '그림을 누르면 만드는 차례와 재료를 볼 수 있어요.'));
        if (atRiver) { el.appendChild(h('div', { class: 'cook-grid' }, ...list.map((d) => dishTile(d, pickDish)))); return; }
        for (const [k, name] of Object.entries(C.kinds)) {
          const ds = list.filter((d) => d.kind === k);
          if (!ds.length) continue;
          el.appendChild(h('h3', { class: 'cook-kind' }, name));
          el.appendChild(h('div', { class: 'cook-grid' }, ...ds.map((d) => dishTile(d, pickDish))));
        }
        el.appendChild(h('div', { class: 'cook-links' },
          h('button', { type: 'button', class: 'btn cook-link', 'data-say': '요리 도감', onclick: () => book() }, '📖 요리 도감'),
          h('button', { type: 'button', class: 'btn cook-link', 'data-say': '찬장에서 재료 꺼내기', onclick: () => pantry() }, '🗄️ 찬장')));
      },
      actions: [],
    });
  }
  function details(d, whereAt) {
    const c = can(d.id), easy = easyOn();
    G.ui.modal.open({
      id: 'cook-dish', title: d.name, icon: d.emoji, size: 'md', className: 'cook-modal', say: `${d.name}. ${d.kid}`,
      body: (el) => {
        const pic = h('div', { class: 'cook-pic' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, d.emoji));
        thumb(d.id).then((url) => { if (url && pic.isConnected) { pic.textContent = ''; pic.appendChild(h('img', { src: url, alt: d.name, width: 160, height: 120 })); } });
        el.appendChild(pic);
        el.appendChild(h('p', { class: 'cook-kid', 'data-say': d.kid }, d.kid));
        const ing = h('ul', { class: 'cook-ings' });
        for (const g of d.ingredients) {
          if (g.fish) { const have = fishIn(g.fish).reduce((a, f) => a + f.count, 0); ing.appendChild(h('li', { class: have >= g.n ? 'have' : 'need' }, `🐟 ${C.fishClasses[g.fish].name} ${g.n}마리 ${have >= g.n ? '✅' : `(지금 ${have})`}`)); continue; }
          if (g.season) { const own2 = g.season.filter((id) => countOf(id) > 0); ing.appendChild(h('li', { class: own2.length ? 'have' : 'base' }, `🏺 ${g.season.map(itemName).join(' · ')} ${own2.length ? '— 내 장 ⭐' : '— 없으면 부엌 양념'}`)); continue; }
          const have = countOf(g.item);
          ing.appendChild(h('li', { class: have >= g.n ? 'have' : g.base ? 'base' : g.opt ? 'opt' : 'need' }, `${itemIcon(g.item)} ${itemName(g.item)} ${g.n > 1 ? g.n + '개 ' : ''}${have >= g.n ? '✅' : g.base ? '— 부엌에 조금 있어요' : g.opt ? '— 있으면 더 맛있어요' : '— 모자라요'}`));
        }
        el.appendChild(h('h4', null, '재료'));
        el.appendChild(ing);
        if (!c.ok) {
          const mis = h('div', { class: 'cook-missing' });
          for (const x of c.missing) { const w = where[x.where] || where.shop; if (easy && x.where === 'shop') continue; mis.appendChild(h('button', { type: 'button', class: 'btn cook-go', 'data-say': w.label, onclick: () => { G.ui.modal.closeAll?.(); w.go(); } }, `${w.emoji} ${x.name} — ${w.label}`)); }
          el.appendChild(mis);
        }
        const steps = h('ol', { class: 'cook-steps' });
        for (const s of d.steps) steps.appendChild(h('li', null, `${C.actions[s.action]?.emoji || ''} ${easy ? s.kid : s.note}`));
        el.appendChild(h('h4', null, '만드는 차례'));
        el.appendChild(steps);
        if (d.safety) el.appendChild(h('p', { class: 'cook-safe' }, '🔥 ' + d.safety));
        el.appendChild(h('p', { class: 'cook-origin' }, d.origin));
        if (!easy) el.appendChild(h('p', { class: 'cook-src' }, '자료: ' + d.sources.map((s) => s.label).join(' · ')));
      },
      actions: [
        { label: c.ok ? '🍳 만들기 시작' : '🧺 재료가 모자라요', class: 'btn-primary cook-start', onClick: () => { if (!c.ok) return false; G.ui.modal.closeAll?.(); setTimeout(() => start(d.id, { where: whereAt }), 60); return true; } },
        { label: '⬅️ 다른 음식', onClick: () => { open(whereAt === 'river' ? 'hwadeok' : null); return true; } },
      ],
    });
  }
  function showMissing(d, c) {
    const items = c.missing.map((x) => `${x.kind === 'fish' ? '🐟' : itemIcon(x.id)} ${x.name}`).join(', ');
    G.ui.toast?.(`재료가 모자라요: ${items}`, { type: 'info', emoji: '🧺', duration: 3200 });
  }
  function showResult(d, r) {
    const easy = easyOn();
    const lines = [
      ['⏱️', r.timing >= 0.95 ? '차례를 꼼꼼히 지켰어요' : '차례를 잘 따라왔어요'],
      r.fishUsed.length ? ['🐟', r.fresh >= 0.95 ? '갓 잡은 물고기라 싱싱해요' : r.fresh >= 0.75 ? '물고기가 꽤 싱싱해요' : '조금 지난 물고기였어요'] : null,
      d.ingredients.some((g) => g.season) ? ['🏺', r.season ? `내가 담근 ${itemName(r.season)}로 맛을 냈어요` : '부엌 양념으로 맛을 냈어요'] : null,
    ].filter(Boolean);
    G.ui.modal.open({
      id: 'cook-result', title: r.first ? `새 음식! ${d.name}` : `${d.name} 완성`, icon: d.emoji, size: 'md', className: 'cook-modal cook-result', say: `${d.name}을 만들었어요. 별 ${r.stars}개!`,
      body: (el) => {
        const pic = h('div', { class: 'cook-pic big' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, d.emoji));
        thumb(d.id).then((url) => { if (url && pic.isConnected) { pic.textContent = ''; pic.appendChild(h('img', { src: url, alt: d.name, width: 240, height: 180 })); } });
        el.appendChild(pic);
        el.appendChild(h('div', { class: 'cook-stars', 'aria-label': `별 ${r.stars}개` }, ...[1, 2, 3].map((i) => h('span', { class: 'emoji' + (i <= r.stars ? ' on' : '') }, '⭐'))));
        el.appendChild(h('ul', { class: 'cook-why' }, ...lines.map(([e, t]) => h('li', { 'data-say': t }, `${e} ${t}`))));
        if (d.safety) el.appendChild(h('p', { class: 'cook-safe' }, '🔥 ' + d.safety));
        if (!easy) el.appendChild(h('p', { class: 'cook-origin' }, d.origin));
      },
      actions: [
        { label: '🍽️ 먹기', class: 'btn-primary', onClick: () => { eat(); return true; } },
        { label: '🤝 나누기', onClick: () => { share(); return true; } },
        { label: '📸 사진', onClick: () => { setTimeout(() => G.sys.photo?.enter?.({}), 120); return true; } },
        { label: '📖 도감', onClick: () => { book(); return true; } },
      ],
    });
  }
  function eat() {
    const S2 = st(); const e = S2?.table?.pop();
    if (!e) return;
    sfx('pop');
    G.bus.emit('cooking:eat', { dish: e.d });
    G.save?.markDirty?.('cooking');
    const d = C.dishes[e.d];
    G.ui.toast?.(`냠냠, ${d?.name || '음식'} 맛있게 먹었어요!`, { type: 'success', emoji: '😋' });
    say('냠냠, 맛있어요!');
    refreshTable(room);
  }
  const NEIGHBOURS = ['NPC004', 'NPC002', 'NPC001', 'NPC003', 'NPC005'];
  function share() {
    const S2 = st(); const e = S2?.table?.pop();
    if (!e) return;
    S2.shared = Math.min(C.limits.sharedMax, (S2.shared || 0) + 1);
    G.sys.progression?.incStat?.('dishesShared', 1);
    const who = G.data.npcs?.[NEIGHBOURS[S2.shared % NEIGHBOURS.length]]?.name || '이웃';
    const d = C.dishes[e.d];
    G.bus.emit('cooking:share', { dish: e.d, npc: who });
    G.save?.markDirty?.('cooking');
    G.bus.emit('interact', { kind: 'cookshare', id: 'share-' + S2.shared });
    sfx('reward');
    const line = `${who}님이 “${d?.name || '음식'} 고마워요, 잘 먹을게요!” 하고 웃어요.`;
    G.ui.toast?.(line, { type: 'success', emoji: '🤝', duration: 3600 });
    say(`${who}님이 고맙대요!`);
    refreshTable(room);
  }
  function table() {
    const S2 = st(); const list = (S2?.table || []).slice().reverse();
    G.ui.modal.open({
      id: 'cook-table', title: '차린 상', icon: '🍽️', size: 'md', className: 'cook-modal', say: list.length ? '차린 음식이에요' : '아직 차린 음식이 없어요',
      body: (el) => {
        if (!list.length) { el.appendChild(h('p', { class: 'cook-lead', 'data-say': '부엌에서 음식을 만들면 여기에 올라와요' }, '부엌에서 음식을 만들면 여기 소반에 올라와요.')); return; }
        el.appendChild(h('div', { class: 'cook-grid' }, ...list.map((e) => { const d = C.dishes[e.d]; return h('div', { class: 'cook-tile ok' }, h('span', { class: 'cook-tile-e emoji', 'aria-hidden': 'true' }, d?.emoji || '🍽️'), h('b', null, d?.name || ''), h('span', { class: 'cook-tile-s' }, '⭐'.repeat(e.s))); })));
      },
      actions: list.length ? [{ label: '🍽️ 먹기', class: 'btn-primary', onClick: () => { eat(); return true; } }, { label: '🤝 나누기', onClick: () => { share(); return true; } }, { label: '📸 사진', onClick: () => { setTimeout(() => G.sys.photo?.enter?.({}), 120); return true; } }] : [],
    });
  }
  function pantry() {
    const S2 = st();
    if (!S2) return;
    const day = dayKey();
    if (S2.pantry.day !== day) S2.pantry = { day, got: {} };
    G.ui.modal.open({
      id: 'cook-pantry', title: '찬장', icon: '🗄️', size: 'md', className: 'cook-modal', say: '찬장에서 재료를 꺼내요. 하루에 세 개씩이에요.',
      body: (el) => {
        el.appendChild(h('p', { class: 'cook-lead', 'data-say': '부엌에 늘 두는 재료예요. 하루에 세 개씩 꺼낼 수 있어요.' }, '부엌에 늘 두는 재료예요. 하루에 한 가지씩 세 개까지 꺼낼 수 있어요.'));
        const grid = h('div', { class: 'cook-grid' });
        for (const id of C.pantry) {
          const got = S2.pantry.got[id] | 0, left = Math.max(0, C.limits.pantryPerDay - got);
          grid.appendChild(h('button', { type: 'button', class: 'cook-tile' + (left ? ' ok' : ' miss'), 'data-item': id, 'data-say': `${itemName(id)} ${left ? '꺼내기' : '내일 또 있어요'}`, disabled: !left || null,
            onclick: (ev) => {
              const g2 = S2.pantry.got[id] | 0;
              if (g2 >= C.limits.pantryPerDay) return;
              const n = C.limits.pantryPerDay - g2;
              const added = Number(inv()?.add?.(id, n, { source: 'pantry' })) || 0;
              if (added > 0) { S2.pantry.got[id] = g2 + added; G.save?.markDirty?.('pantry'); sfx('pickup'); const tile = ev.currentTarget; tile.disabled = true; tile.classList.remove('ok'); tile.classList.add('miss'); const sm = tile.querySelector('small'); if (sm) sm.textContent = '내일 또 있어요'; }
            } },
            h('span', { class: 'cook-tile-e emoji', 'aria-hidden': 'true' }, itemIcon(id)), h('b', null, itemName(id)), h('small', null, left ? `${left}개 꺼내기` : '내일 또 있어요')));
        }
        el.appendChild(grid);
      },
      actions: [{ label: '🍳 요리하러 가기', class: 'btn-primary', onClick: () => { setTimeout(() => open(null), 80); return true; } }],
    });
  }
  function shelf() {
    const seasonIds = [...new Set(Object.values(C.dishes).flatMap((d) => d.ingredients.filter((g) => g.season).flatMap((g) => g.season)))];
    G.ui.modal.open({
      id: 'cook-shelf', title: '양념 선반 — 내 장', icon: '🏺', size: 'md', className: 'cook-modal', say: '내가 담근 장이 여기에 놓여요',
      body: (el) => {
        el.appendChild(h('p', { class: 'cook-lead', 'data-say': '장독대에서 담근 장을 쓰면 별을 더 받아요' }, '장독대에서 담가 꺼낸 장과 김치가 여기 놓여요. 내 장으로 맛을 내면 별을 더 받아요.'));
        el.appendChild(h('div', { class: 'cook-grid' }, ...seasonIds.map((id) => { const n = countOf(id); return h('div', { class: 'cook-tile' + (n ? ' ok' : ' miss') }, h('span', { class: 'cook-tile-e emoji', 'aria-hidden': 'true' }, itemIcon(id)), h('b', null, itemName(id)), h('small', null, n ? `${n}개 있어요` : '장독대에서 담가요')); })));
      },
      actions: [{ label: '🏺 장독대로', onClick: () => { where.jar.go(); return true; } }],
    });
  }
  function book() {
    const S2 = st();
    const all = Object.values(C.dishes);
    const made = all.filter((d) => S2?.book?.[d.id]).length;
    G.ui.modal.open({
      id: 'cook-book', title: `요리 도감 ${made} / ${all.length}`, icon: '📖', size: 'lg', className: 'cook-modal cook-book', say: `요리 도감이에요. ${made}가지를 만들었어요.`,
      body: (el) => {
        for (const [k, name] of Object.entries(C.kinds)) {
          const ds = all.filter((d) => d.kind === k);
          el.appendChild(h('h3', { class: 'cook-kind' }, name));
          const grid = h('div', { class: 'cook-grid' });
          for (const d of ds) {
            const b = S2?.book?.[d.id];
            const pic = h('span', { class: 'cook-tile-e emoji', 'aria-hidden': 'true' }, b ? d.emoji : '❔');
            const tile = h('button', { type: 'button', class: 'cook-tile book' + (b ? ' made' : ' locked'), 'data-dish': d.id, 'data-say': b ? `${d.name}. ${b.n}번 만들었어요` : `${d.name}. 아직 안 만들었어요`, onclick: () => details(d, d.outdoor && !G.sys.places?.current ? 'river' : 'kitchen') },
              pic, h('b', null, d.name), h('small', null, b ? `${b.n}번 · ${'⭐'.repeat(b.best)}` : '아직이에요'));
            if (b) thumb(d.id).then((url) => { if (url && pic.isConnected) { pic.textContent = ''; pic.classList.remove('emoji'); pic.appendChild(h('img', { src: url, alt: '', width: 96, height: 72 })); } });
            grid.appendChild(tile);
          }
          el.appendChild(grid);
        }
      },
      actions: [],
    });
  }

  // ================================================================= thumbnails (rendered once per dish, cached)
  const thumbs = new Map();
  let thumbBusy = Promise.resolve();
  function thumb(dishId) {
    if (thumbs.has(dishId)) return Promise.resolve(thumbs.get(dishId));
    const E = G.sys.engine, rnd = E?.renderer;
    if (!rnd || !C.dishes[dishId] || (E?.preset?.name || 'low') === 'low') return Promise.resolve(null);
    thumbBusy = thumbBusy.then(() => new Promise((res) => {
      setTimeout(() => {
        let url = null;
        try {
          const W = 240, H2 = 180;
          const sc = new THREE.Scene();
          sc.background = new THREE.Color('#e8dcc4');
          sc.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a48, 1.6));
          const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(0.6, 1.2, 0.8); sc.add(dl);
          const m = buildDish(dishId, { cook: 1 });
          m.steam(0); sc.add(m.group);
          const box = new THREE.Box3().setFromObject(m.group), size = box.getSize(new THREE.Vector3()), c2 = box.getCenter(new THREE.Vector3());
          const r = Math.max(size.x, size.z, size.y * 1.6) * 0.62 + 0.02;
          const cam = new THREE.PerspectiveCamera(32, W / H2, 0.01, 10);
          cam.position.set(c2.x + r * 0.25, c2.y + r * 1.25, c2.z + r * 1.7); cam.lookAt(c2);
          const rt = new THREE.WebGLRenderTarget(W, H2, { samples: 0 });
          rt.texture.colorSpace = THREE.SRGBColorSpace;   // the shader writes sRGB into the target (no tone mapping off screen)
          const prev = rnd.getRenderTarget();
          rnd.setRenderTarget(rt); rnd.render(sc, cam);
          const px = new Uint8Array(W * H2 * 4); rnd.readRenderTargetPixels(rt, 0, 0, W, H2, px);
          rnd.setRenderTarget(prev);
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H2;
          const cx = cv.getContext('2d'), img = cx.createImageData(W, H2);
          for (let y = 0; y < H2; y++) img.data.set(px.subarray((H2 - 1 - y) * W * 4, (H2 - y) * W * 4), y * W * 4);
          cx.putImageData(img, 0, 0);
          url = cv.toDataURL('image/jpeg', 0.85);
          rt.dispose(); m.dispose();
        } catch (e) { G.log.warn('COOK', 'thumbnail failed', e?.message || e); url = null; }
        thumbs.set(dishId, url);
        res(url);
      }, 16);
    }));
    return thumbBusy;
  }

  // ================================================================= the system
  const api = {
    name: 'cooking', order: 64, label: '요리 · 부엌',
    timeScale: 1,
    get state() {
      const s = session;
      if (!s) return null;
      return { dish: s.dish.id, step: s.i, of: s.dish.steps.length, where: s.where, mode: s.mode, action: s.step?.action, station: s.step?.station, progress: s.p, heat: s.heat, hold: !!s.hold, turnReady: s.turnAt !== null };
    },
    get busy() { return !!session; },
    open, start, cancel, book, table, pantry, can, fishIn, thumb,
    model: (id, o = {}) => buildDish(id, o),
    stations() {
      const out = [];
      if (room) for (const [id, s] of Object.entries(room.spots)) { const w = spotWorld(id); out.push({ id, place: ROOM, x: w?.work.x, y: w?.work.y, z: w?.work.z }); }
      if (river) out.push({ id: 'hwadeok', place: null, x: river.at.x, y: river.y, z: river.at.z });
      return out;
    },
    /** tests: press / release the big button, pick a seasoning, run the clock */
    test: {
      /** a camera shot onto a station (contact sheets, evidence): dist = metres back from the food */
      frame(id, dist = 1.0) {
        const sw = spotWorld(id) || (id === 'hwadeok' && river ? { work: river.spot.work.clone().add(river.group.position), stand: { x: river.at.x + 0.9, z: river.at.z + 0.85 } } : null);
        if (!sw) return false;
        const dx = sw.work.x - sw.stand.x, dz = sw.work.z - sw.stand.z, len = Math.hypot(dx, dz) || 1;
        const pos = new THREE.Vector3(sw.work.x - (dx / len) * dist, sw.work.y + dist * 0.75, sw.work.z - (dz / len) * dist);
        try { G.sys.camera.shot(pos, sw.work.clone(), { fov: 40, duration: 0 }); } catch (e) { return false; }
        return true;
      },
      /** a contact sheet: dishes on their own 소반 in a grid at world (x, z) (cols per row, gap m) -> [{id, name, x, y, z}];
       *  look(from) frames it with the camera; clearSheet() removes it */
      sheet(ids, at = { x: 75, z: 46 }, o = {}) {
        api.test.clearSheet();
        const cols = o.cols || 5, gap = o.gap || 0.95, y0 = o.y ?? (G.world.heightAt ? G.world.heightAt(at.x, at.z) : 0);
        const grp = new THREE.Group(); grp.name = 'cook-sheet';
        const { B, T } = bucketOf();
        const out = [], models = [];
        ids.forEach((id, i) => {
          const r = Math.floor(i / cols), c = i % cols, n = Math.min(cols, ids.length - r * cols);
          const x = (c - (n - 1) / 2) * gap, z = r * gap * 0.92;
          const tb = K.table(T, { x, z, w: 0.62, d: 0.46, h: 0.28, legs: 'curved', tone: i % 2 ? '#6b3a22' : '#5f3420', round: C.dishes[id]?.vessel === 'yugi_jubal' });
          const m = buildDish(id, { cook: 1 });
          if (!m) return;
          const sc = ['baekja_long', 'sotttukkeong', 'chaebang'].includes(C.dishes[id].vessel) ? 0.95 : 1.25;
          m.group.position.set(x, (tb?.top ?? 0.28), z); m.group.scale.setScalar(sc); m.steam(0.3);
          grp.add(m.group); models.push(m);
          out.push({ id, name: C.dishes[id].name, x: at.x + x, y: y0 + 0.05, z: at.z + z + 0.3 });
        });
        B.build(grp, { name: 'cook-sheet', materials: kitMats() });
        grp.position.set(at.x, y0, at.z);
        G.sys.engine.scene.add(grp);
        api.test._sheet = { grp, models };
        return out;
      },
      clearSheet() { const S2 = api.test._sheet; if (!S2) return; for (const m of S2.models) m.dispose(); S2.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); S2.grp.parent?.remove(S2.grp); api.test._sheet = null; },
      look(pos, at, fov = 40) { try { G.sys.camera.shot(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Vector3(at.x, at.y, at.z), { fov, duration: 0 }); return true; } catch (e) { return false; } },
      tick(sec) { const s0 = session; if (!s0) return; for (let k = 0; k < sec * 30; k++) tick(1 / 30, performance.now() / 1000 + k / 30); },
      down: () => pressDown(), up: () => pressUp(), pick: (id) => pick(id), get room() { return room; }, get river() { return river; }, buildRiver: () => buildRiver(), refresh: () => { refreshShelf(room); refreshTable(room); } },
    init() {
      G.bus.on('place:built', (p) => {
        if (!p || p.id !== ROOM) return;
        const pg = G.sys.places?._root?.getObjectByName?.('place:' + ROOM);
        if (!pg) { G.log.warn('COOK', 'the 부엌 group was not found'); return; }
        disposeRoomStations();
        try { room = buildRoomStations(pg); G.log.info('COOK', `kitchen stations ready (${Object.keys(room.spots).length} spots)`); } catch (e) { G.log.warn('COOK', 'kitchen stations failed', e?.message || e); room = null; }
      });
      G.bus.on('place:exit', (p) => { if (p && p.id === ROOM && session && session.where === 'kitchen') cancel(); });
      G.bus.on('game:logout', () => { if (session) cancel(); });
      G.bus.on('item:added', (p) => { if (room && p && /^ITEM_/.test(p.itemId || '') && Object.values(C.dishes).some((d) => d.ingredients.some((g) => g.season && g.season.includes(p.itemId)))) refreshShelf(room); });
      G.bus.on('game:ready', () => { try { buildRiver(); } catch (e) { G.log.warn('COOK', 'river 화덕 failed', e?.message || e); } });
      if (G.ready) setTimeout(() => { try { buildRiver(); } catch (e) { /* later */ } }, 0);
    },
    update(dt, t) {
      // the place group went away (LRU dispose): drop our stations with it
      if (room && !room.placeGroup.parent) { disposeRoomStations(); }
      // a failing frame must never freeze a child's cooking (the core would switch this system off after 60): the
      // error is kept for the developer centre / tests and logged once per message
      try { tick(dt, t ?? performance.now() / 1000); } catch (e) {
        const msg = String(e && e.stack || e).slice(0, 400);
        if (api._lastError !== msg) { api._lastError = msg; G.log.warn('COOK', 'frame failed', msg); }
        api.errors = (api.errors || 0) + 1;
      }
    },
  };
  G.register(api);
})();
