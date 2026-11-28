// =============================================================================
// 69-healing-hall.js — the house of the 힐링관 (CONTRACT §19.6, lane heal-hall): the building B_HEAL in the valley and
// its inside as places — PL_HEAL (the lobby with the 안내데스크 and a kiosk + ONE corridor behind a glass front with ten
// doors), the nested places PL_HEAL_STAY (숙소), PL_HEAL_TALK (상담실) and PL_HEAL_R1 … PL_HEAL_R10 (the ten rooms).
// This file builds NO visit logic and NO interactables except doors: the program (39-healing.js / 79-healing-acts.js)
// puts its interactables, figures and moving things on the STATIONS registered here.
//
// THE PLAN — one long gallery (chosen over a corridor that turns once): one straight glass front reads as one 통유리
// facade from outside and inside, every door is seen from everywhere along it, the sun falls through it the whole day
// (it faces south), and a child never has to find a corner. The lobby sits in the MIDDLE (the entrance, the desk, the
// kiosk, the doors of the 숙소 and the 상담실), 제1관 … 제5관 open off the east wing, 제6관 … 제10관 off the west wing (the
// quietest room at the far quiet end). Corridor: 171 × 9 m (57 bays of 3 m; the lobby 21 m, each room 15 m of front);
// each room behind its door: 15 × 22 m = 330 m² (≈ 100 평); ten rooms ≈ 3,300 m² (≈ 1,000 평). One storey, a timber
// frame under a tiled roof; the outside shell in the valley is the same house at about one third of its length (the
// valley is 270 m across — as far as the place system allows).
//
// PLACES (origins far from the valley, a row of their own: the hall at (0, 3400), the rooms at z = 3800):
//   PL_HEAL        힐링관          (0, 3400)       171 × 9 × 4.8   door on B_HEAL (the valley), exit back there
//   PL_HEAL_STAY   숙소            (−1100, 3800)   9 × 7 × 3.4     door in the lobby (north wall, x −6, west of the desk)
//   PL_HEAL_TALK   상담실          (1100, 3800)    9 × 7 × 3.4     door in the lobby (north wall, x 6, east of the desk)
//   PL_HEAL_R<n>   제<n>관 …       (−900 + 200·(n − 1), 3800)  15 × 22 × 4.4   door in the corridor (north wall)
//   A nested place leads its way out back into PL_HEAL in front of its own door (the [myroom] exitTo hook of
//   18-places.js); its `exit` (what a save made inside stores) is the valley spot in front of B_HEAL.
//
// STATIONS (the only link to the program; the line below is the same in both fragments):
//   G.healStations.set(room, key, Object3D) while a place is built — an empty Object3D inside the place group at the
//   spot, turned the way a figure / the visitor there faces (rotY). userData { room, key, place, local: {x, y, z, rotY} }.
//   room: 'LOBBY' 'STAY' 'TALK' 'R1' … 'R10'. Keys: LOBBY desk kiosk bench · STAY door shelf rail bed · TALK seat manager
//   · R1 body gut gene salt board · R2 mat tray · R3 seat pot · R4 track gym1 gym2 gym3 · R5 tub kettle herbs · R6 chair
//   stool · R7 bed towel · R8 bed oil · R9 stand plates drums cans bottles rack · R10 studio desk rest; every room (and
//   STAY / TALK / LOBBY) also guide (where the keeper stands) and spot (where the visitor stands or lies). When a place
//   is disposed its stations are removed from the map (event 'heal:stations-gone' { room }).
//
// G.healHall — the hall's small interface:
//   door(room, state)      room 'R1' … 'R10' (or 1 … 10 / 'PL_HEAL_R1'); state 'idle' | 'next' | 'run' | 'done': the
//                          lamp over that corridor door (dim · a slow golden breath · warm amber · a green stamp);
//                          remembered while the hall is not built                             -> bool
//   doors()                { R1: state, … }
//   corridor()             the doors for the map: [{ room, n, name, kidName, place, state, x, z (PL_HEAL local, the
//                          spot in front of the door), wx, wz (world), door: {x, z} (local, in the wall) }] for R1 … R10,
//                          then STAY and TALK; extra fields on the array: place 'PL_HEAL', length, depth, lobby {x, z},
//                          entrance {x, z}, desk {x, z} (local)
//   enter(room)            go into a room / STAY / TALK (from the corridor; from the valley the hall first)  -> Promise
//   gentle()               is 제10관 the gentle 마음 돌아보기 right now (no coffin)? (G.sys.healing.room10Full() when the
//                          program answers; otherwise easy mode = gentle)
//   setRoom10(full)        show / hide the coffin of 제10관 now and in every later build (the program calls it when the
//                          gate opens or closes; null = back to asking G.sys.healing.room10Full() / easy mode)
//   place(room) -> 'PL_HEAL_R1' …          ids: PLACES
//   stations(room) -> [keys]               the station keys of a built room
//   census(room) -> { kind: count }        what the last build of that room holds, by kind (mats, pillows, tubs, …)
// =============================================================================
G.healStations = G.healStations || { map: new Map(),
  set(room, key, at) { this.map.set(room + ':' + key, at); G.bus && G.bus.emit('heal:station', { room, key }); },
  get(room, key) { return this.map.get(room + ':' + key) || null; } };
(function () {
  const PI = Math.PI, TAU = PI * 2;
  const fin = Number.isFinite;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const still = () => !!G.settings?.reduceMotion;
  const warn = (m, e) => G.log.warn('WORLD', 'healing-hall: ' + m, e?.message || e || '');

  // ---------------------------------------------------------------- the plan (numbers shared by the house and its places)
  const HALL = { id: 'PL_HEAL', origin: { x: 0, z: 3400 }, W: 171, D: 9, H: 4.8, POST: 3.7, CEIL: 4.15, BAY: 3 };
  const LOBBY_W = 21, ROOM_FRONT = 15;
  const ROOM = { w: 15, d: 22, h: 4.4, post: 3.4, ceil: 3.8 };
  const SMALL = { w: 9, d: 7, h: 3.4, post: 2.7, ceil: 3.0 };
  const ROOMS = [
    { n: 1, key: 'R1', name: '기본 검사관', kid: '기본 검사관', emoji: '🔍', floor: 'maru', tone: 'pale', wall: 'plaster', mood: 'bright', min: 10 },
    { n: 2, key: 'R2', name: '쑥뜸관', kid: '쑥뜸관', emoji: '🔥', floor: 'jangpan', tone: 'warm', wall: 'clay', mood: 'warm', min: 60 },
    { n: 3, key: 'R3', name: '좌훈관', kid: '좌훈관', emoji: '♨️', floor: 'maru', tone: 'warm', wall: 'board', mood: 'warm', min: 30 },
    { n: 4, key: 'R4', name: '실내 맨발걷기 · 헬스', kid: '맨발걷기 · 헬스', emoji: '👣', floor: 'maru', tone: 'pale', wall: 'plaster', mood: 'bright', tall: true, min: 60 },
    { n: 5, key: 'R5', name: '족욕관', kid: '족욕관', emoji: '🛁', floor: 'stone', tone: 'warm', wall: 'clay', mood: 'warm', min: 60 },
    { n: 6, key: 'R6', name: '발마사지관', kid: '발마사지관', emoji: '🌿', floor: 'jangpan', tone: 'warm', wall: 'clay', mood: 'calm', min: 30 },
    { n: 7, key: 'R7', name: '얼굴마사지관', kid: '얼굴마사지관', emoji: '😌', floor: 'maru', tone: 'pale', wall: 'plaster', mood: 'calm', min: 60 },
    { n: 8, key: 'R8', name: '바디마사지관', kid: '바디마사지관', emoji: '💆', floor: 'jangpan', tone: 'warm', wall: 'clay', mood: 'calm', min: 60 },
    { n: 9, key: 'R9', name: '스트레스 해소관', kid: '스트레스 해소관', emoji: '💥', floor: 'stone', tone: 'dark', wall: 'board', mood: 'bright', min: 30 },
    { n: 10, key: 'R10', name: '임종체험관', kid: '마음 돌아보기', emoji: '🕯️', kidEmoji: '🌙', floor: 'maru', tone: 'dark', wall: 'plaster', mood: 'calm', min: 60 },
  ];
  for (const r of ROOMS) {
    r.place = 'PL_HEAL_R' + r.n;
    r.zone = 'ZONE_PL_HEAL_R' + r.n;
    r.origin = { x: -900 + 200 * (r.n - 1), z: 3800 };
    // the door in the corridor's north wall: 제1관 … 제5관 east of the lobby, 제6관 … 제10관 west of it
    const k = r.n <= 5 ? r.n - 1 : r.n - 6, sx = r.n <= 5 ? 1 : -1;
    r.doorX = sx * (LOBBY_W / 2 + ROOM_FRONT * k + ROOM_FRONT / 2);
  }
  const EXTRA = [
    { key: 'STAY', place: 'PL_HEAL_STAY', zone: 'ZONE_PL_HEAL_STAY', name: '숙소', kid: '숙소', emoji: '🛏️', origin: { x: -1100, z: 3800 }, doorX: -6 },
    { key: 'TALK', place: 'PL_HEAL_TALK', zone: 'ZONE_PL_HEAL_TALK', name: '상담실', kid: '상담실', emoji: '💬', origin: { x: 1100, z: 3800 }, doorX: 6 },
  ];
  const BY_KEY = new Map([...ROOMS, ...EXTRA].map((r) => [r.key, r]));
  const DOOR_Z = -HALL.D / 2, FRONT_Z = HALL.D / 2;
  const PLACES = ['PL_HEAL', ...EXTRA.map((r) => r.place), ...ROOMS.map((r) => r.place)];

  // ---------------------------------------------------------------- stations
  const stationsOf = new Map();   // room -> [keys]
  function station(ctx, room, key, x, y, z, rotY = 0) {
    const o = new THREE.Object3D();
    o.name = 'heal-station:' + room + ':' + key;
    o.position.set(x, y, z); o.rotation.y = rotY;
    o.userData = { room, key, place: ctx.id, local: { x, y, z, rotY } };
    ctx.group.add(o); o.updateMatrixWorld(true);
    try { G.healStations.set(room, key, o); } catch (e) { warn('station ' + room + ':' + key, e); }
    const l = stationsOf.get(room) || []; if (!l.includes(key)) l.push(key); stationsOf.set(room, l);
    return o;
  }
  function dropStations(room) {
    const l = stationsOf.get(room) || [];
    for (const k of l) G.healStations.map.delete(room + ':' + k);
    stationsOf.delete(room);
    try { G.bus.emit('heal:stations-gone', { room }); } catch (e) { /* bus optional */ }
  }

  // [heal-look] the census of things: what a layout puts into a room, by kind (tests/heal-hall-unit.mjs reads it)
  const tallies = new Map();   // room -> { kind: count }
  function tally(room, kind, n = 1) { const t = tallies.get(room) || {}; t[kind] = (t[kind] || 0) + n; tallies.set(room, t); }

  // ---------------------------------------------------------------- door states (kept while the hall is not built)
  const STATES = ['idle', 'next', 'run', 'done'];
  const doorState = {};
  for (const r of ROOMS) doorState[r.key] = 'idle';
  let hallLive = null;     // { lamps, signs, … } while PL_HEAL is built
  const roomKey = (room) => {
    if (typeof room === 'number' && room >= 1 && room <= 10) return 'R' + (room | 0);
    const s = String(room || '');
    if (/^R([1-9]|10)$/.test(s)) return s;
    const m = /^PL_HEAL_R([1-9]|10)$/.exec(s);
    return m ? 'R' + m[1] : (s === 'STAY' || s === 'TALK' || s === 'PL_HEAL_STAY' || s === 'PL_HEAL_TALK') ? s.replace('PL_HEAL_', '') : null;
  };

  // room 10: gentle (no coffin, no words about death) unless the program says the full sequence is open
  let room10Set = null;    // setRoom10(full) remembered (also for the next build); null = ask the program / easy mode
  function gentle() {
    if (room10Set !== null) return !room10Set;
    try { const f = G.sys.healing?.room10Full?.(); if (f === true) return false; if (f === false) return true; } catch (e) { /* program optional */ }
    return easyOn();
  }
  let room10Live = null;   // { coffin: Group, setGentle(b) } while 제10관 is built

  // ---------------------------------------------------------------- small helpers
  const P = () => G.sys.places;
  const K = () => G.hanok;
  const BK = () => G.bkit;
  function canvasTex(w, h, draw) {
    if (G.gfx?.canvasTexture) return G.gfx.canvasTexture(w, h, draw);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  /** a wooden name board (현판 style): its own small canvas; returns the mesh (redraw(text, sub) to change it) */
  function nameBoard(ctx, R, o) {
    const cw = 512, ch = 192, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const c2 = cv.getContext('2d');
    const paint = (title, sub) => {
      const g = c2.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, o.bg1 || '#6b4426'); g.addColorStop(1, o.bg2 || '#4a2c17');
      c2.fillStyle = g; c2.fillRect(0, 0, cw, ch);
      c2.strokeStyle = o.border || '#c9a35c'; c2.lineWidth = 8; c2.strokeRect(10, 10, cw - 20, ch - 20);
      c2.fillStyle = o.color || '#fff4d8'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.font = `800 ${sub ? 66 : 76}px ${FONT}`; c2.fillText(title, cw / 2, sub ? ch * 0.38 : ch / 2, cw - 40);
      if (sub) { c2.font = `700 40px ${FONT}`; c2.fillStyle = o.subColor || '#f1d9a6'; c2.fillText(sub, cw / 2, ch * 0.74, cw - 40); }
    };
    paint(o.title, o.sub);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    ctx.own(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, color: 0xe8e0d2 });
    ctx.own(mat);
    const geo = new THREE.PlaneGeometry(o.w || 1.6, (o.w || 1.6) * ch / cw);
    ctx.own(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.x, o.y, o.z); mesh.rotation.y = o.rotY || 0;
    mesh.name = 'heal-sign'; mesh.userData.guardSkip = true; mesh.raycast = () => {};
    if (R && R.addMesh) R.addMesh(mesh, null); else ctx.group.add(mesh);
    mesh.userData.redraw = (t, s) => { paint(t, s); tex.needsUpdate = true; };
    return mesh;
  }
  const M = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0) => {
    const m = new THREE.Matrix4();
    return m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  /** a long block with metre UVs (the photographed surfaces would stretch on a plain box) */
  const slab = (w, h, d) => (K()?.geo?.slab ? K().geo.slab(w, h, d, 0.01) : box(w, h, d));
  const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);

  // ================================================================ the lobby and the corridor (PL_HEAL)
  function buildHall(ctx) {
    const Kt = K(), low = ctx.low, W = HALL.W, D = HALL.D, BAY = HALL.BAY, NB = Math.round(W / BAY);
    // the north wall: one entry per bay, LEFT -> RIGHT seen from inside (looking north: left = west)
    const N = [];
    const doorAt = new Map();
    for (const r of [...ROOMS, ...EXTRA]) doorAt.set(Math.floor((r.doorX + W / 2) / BAY), r);
    for (let i = 0; i < NB; i++) {
      const r = doorAt.get(i);
      if (r) N.push({ door: 'changho', w: 1.9, h: 2.6, label: null });
      else N.push(i % 5 === 2 ? 'board' : 'plaster');
    }
    const S = [];
    for (let i = 0; i < NB; i++) S.push('none');
    const R = Kt.room(ctx, {
      w: W, d: D, post: HALL.POST, ridge: HALL.H, ceiling: HALL.CEIL, bays: { x: NB, z: 3 }, floor: 'maru', roof: 'ceiling', tone: 'pale',
      walls: { N, S, E: ['plaster', { window: 'yongja', w: 1.6, h: 1.4, sill: 0.8 }, 'plaster'], W: ['plaster', { window: 'yongja', w: 1.6, h: 1.4, sill: 0.8 }, 'plaster'] },
      sun: { az: 180, el: 30 }, shafts: false,
    });
    // the glass front: the 'none' bays must not cast the window sun's shadow (only the lintel band above the glass does)
    if (R.solid && Array.isArray(R.solid.S)) R.solid.S = R.solid.S.map((s) => (s[2] === 0 && s[3] === R.post ? [s[0], s[1], R.post - 0.32, R.post] : s));
    const live = { lamps: null, signs: {}, lightSpots: [], handles: [], updates: [], ports: [] };

    // ---- glass: one pane per bay between the posts, a slim transom and a slim middle mullion in the rhythm of the bays
    const panes = [];
    const gy0 = 0.06, gTop = R.post - 0.3, trY = 2.72;
    for (let i = 0; i < NB; i++) {
      const x0 = -W / 2 + i * BAY + 0.17, x1 = -W / 2 + (i + 1) * BAY - 0.17, cx = (x0 + x1) / 2, pw = x1 - x0;
      const entrance = Math.abs(cx) < BAY / 2;
      // 머름-like sill rail, transom, mullion (pine, slim)
      R.add('wood', box(pw, 0.08, 0.1), M(cx, gy0 - 0.02, FRONT_Z - 0.02), '#c9ab83');
      R.add('wood', box(pw, 0.06, 0.09), M(cx, trY, FRONT_Z - 0.02), '#c9ab83');
      if (!entrance) R.add('wood', box(0.05, trY - gy0, 0.08), M(cx, (gy0 + trY) / 2, FRONT_Z - 0.02), '#c9ab83');
      R.add('wood', box(0.05, gTop - trY, 0.08), M(cx, (trY + gTop) / 2, FRONT_Z - 0.02), '#c9ab83');
      const g = new THREE.PlaneGeometry(pw, gTop - gy0); g.translate(cx, (gy0 + gTop) / 2, FRONT_Z - 0.01);
      // the sun-patch decal: the two half-panes under the transom (the mullion between them), and the upper light
      if (!entrance) { live.ports.push([x0, cx - 0.03, gy0 + 0.04, trY - 0.03], [cx + 0.03, x1, gy0 + 0.04, trY - 0.03], [x0, x1, trY + 0.03, gTop]); }
      else live.ports.push([x0, x1, gy0 + 0.1, trY - 0.06], [x0, x1, trY + 0.03, gTop]);
      if (entrance) {   // the entrance: two glass leaves slid half open, a wooden frame and a step out to the garden
        const lw = pw / 2;
        for (const s of [-1, 1]) {
          const lx = cx + s * (lw * 1.25);
          R.add('wood', box(lw, 0.07, 0.07), M(lx, trY - 0.06, FRONT_Z + 0.05), '#a8865c');
          R.add('wood', box(0.06, trY - 0.1, 0.07), M(lx - s * lw / 2, trY / 2, FRONT_Z + 0.05), '#a8865c');
          R.add('iron', box(0.03, 0.42, 0.03), M(lx - s * (lw / 2 - 0.12), 1.05, FRONT_Z + 0.1), '#2f2b28');
          const lg = new THREE.PlaneGeometry(lw - 0.06, trY - 0.16); lg.translate(lx, trY / 2, FRONT_Z + 0.05); panes.push(lg);
        }
        const tg = new THREE.PlaneGeometry(pw, gTop - trY); tg.translate(cx, (trY + gTop) / 2, FRONT_Z - 0.01); panes.push(tg);
      } else panes.push(g);
    }
    {
      const BGU = (typeof ADDONS !== 'undefined' && ADDONS.BufferGeometryUtils) || null;
      const merged = BGU ? BGU.mergeGeometries(panes, false) : null;
      const list = merged ? [merged] : panes;
      const gm = low
        ? new THREE.MeshBasicMaterial({ color: 0xcfe2e6, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0xdcecee, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.15, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
      ctx.own(gm);
      for (const g of list) {
        ctx.own(g);
        const mesh = new THREE.Mesh(g, gm);
        mesh.name = 'heal-glass'; mesh.renderOrder = 2; mesh.userData.guardSkip = true; mesh.raycast = () => {};
        R.addMesh(mesh, null);
      }
      if (merged) for (const g of panes) g.dispose();
      live.glassMat = gm;
    }
    // the floor: a faint wax sheen over the 우물마루 (medium / high) — the glass and the sun patches glint in it
    if (!low) {
      const sg = new THREE.PlaneGeometry(W - 0.4, D - 0.4); sg.rotateX(-PI / 2); sg.translate(0, 0.006, 0);
      const sm = new THREE.MeshStandardMaterial({ color: 0x2a1c10, transparent: true, opacity: 0.12, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.2, depthWrite: false });
      ctx.own(sg); ctx.own(sm);
      const sheen = new THREE.Mesh(sg, sm); sheen.name = 'heal-floor-sheen'; sheen.renderOrder = 1; sheen.userData.guardSkip = true; sheen.raycast = () => {};
      sheen.receiveShadow = true;
      R.addMesh(sheen, null);
    }
    // ---- eaves outside the glass: 서까래 ends under a board soffit, 처마 edge (they cast the shadow line on the floor)
    {
      const ey = R.post + 0.05, ov = 2.1;
      R.add('wood', slab(W + 2.4, 0.06, ov + 0.3), M(0, ey + 0.34, FRONT_Z + ov / 2), '#b99872');
      for (let x = -W / 2 - 1; x <= W / 2 + 1; x += 0.42) R.add('wood', cyl(0.06, 0.06, ov, 6), M(x, ey + 0.26, FRONT_Z + ov / 2, 0, 1, 1, 1, PI / 2), '#a07a52', { cast: false });
      R.add('wood', slab(W + 2.4, 0.22, 0.14), M(0, ey + 0.28, FRONT_Z + ov + 0.05), '#8a6644');
      R.add('paint', slab(W + 2.6, 0.2, 0.5), M(0, ey + 0.5, FRONT_Z + ov + 0.2), '#3e4246');
      R.add('wood', slab(W + 0.4, 0.3, 0.26), M(0, R.post + 0.02, FRONT_Z + 0.05), '#a8865c');       // 창방 over the glass
    }
    // ---- the 기단 and the garden strip outside the glass (stone edge, gravel, stepping stones, pines, jars, a pond)
    const garden = buildGarden(ctx, R, live);
    // ---- inside: ceiling lamps (한지 boxes) every two bays, benches by the glass, potted plants, the lobby
    const lampXs = [];
    for (let i = 1; i < NB; i += 2) lampXs.push(-W / 2 + i * BAY + BAY / 2);
    for (const x of lampXs) {
      R.add('wood', box(0.72, 0.05, 0.72), M(x, HALL.CEIL - 0.03, 0), '#8a6a4a', { cast: false });
      R.add('glow', box(0.6, 0.18, 0.6), M(x, HALL.CEIL - 0.16, 0), '#ffe2b0', { cast: false });
      R.add('wood', box(0.64, 0.03, 0.64), M(x, HALL.CEIL - 0.26, 0), '#8a6a4a', { cast: false });
      live.lightSpots.push({ x, y: HALL.CEIL - 0.5, z: 0 });
    }
    if (!low) for (let i = 0; i < 6; i++) live.handles.push(ctx.light({ x: lampXs[i] || 0, y: HALL.CEIL - 0.5, z: 0, color: 0xffd6a0, intensity: 5, distance: 13, decay: 2, day: 0.12 }));
    for (let x = -W / 2 + 6; x < W / 2 - 4; x += 12) {
      if (Math.abs(x) < LOBBY_W / 2 + 1) continue;
      bench(R, ctx, x, FRONT_Z - 1.15);
    }
    for (let x = -W / 2 + 12; x < W / 2 - 6; x += 24) if (Math.abs(x) > LOBBY_W / 2 + 2) plant(R, ctx, x, FRONT_Z - 0.75, 1);
    buildLobby(ctx, R, live);
    // ---- the doors: a name board over each, a lamp that tells its state, the interactable that leads in
    buildDoors(ctx, R, live);
    try { hangPaintings(ctx, R); } catch (e) { warn('paintings', e); }
    R.finish({ exit: { x: 0, z: FRONT_Z - 0.6 } });
    // the follow camera stays inside: an invisible blocker along the glass (and the two end walls)
    live.blockers = [];
    try {
      const bm = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }); ctx.own(bm);
      for (const [x, z, w, ry] of [[0, FRONT_Z + 0.08, W + 2, 0], [-W / 2 - 0.08, 0, D + 2, PI / 2], [W / 2 + 0.08, 0, D + 2, PI / 2]]) {
        const g = new THREE.PlaneGeometry(w, HALL.CEIL + 0.6); g.translate(0, (HALL.CEIL + 0.6) / 2 - 0.3, 0); ctx.own(g);
        const m = new THREE.Mesh(g, bm); m.position.set(x, 0, z); m.rotation.y = ry; m.name = 'heal-camera-blocker'; m.visible = false;
        ctx.group.add(m); m.updateMatrixWorld(true);
        if (G.world?.cameraBlockers) { G.world.cameraBlockers.push(m); live.blockers.push(m); }
      }
    } catch (e) { warn('camera blockers', e); }
    // the light: the real sun through the glass (the shadow frustum follows the visitor), dimmed by clouds and rain
    setupSun(ctx, live);
    try { sunPatches(ctx, R, live); } catch (e) { warn('sun patches', e); }
    emitter(ctx, 'water', -26, FRONT_Z + 11, 0.35);
    for (const x of [-60, 0, 60]) emitter(ctx, 'bell', x, FRONT_Z + 2.0, 0.25);
    hallLive = live;
    applyDoorStates();
    ctx.onUpdate((dt, t) => { for (const f of live.updates) f(dt, t); });
    return { dispose() { if (hallLive === live) hallLive = null; dropStations('LOBBY'); dropEmitters(ctx.id); const cb = G.world?.cameraBlockers; if (cb) for (const m of live.blockers || []) { const i = cb.indexOf(m); if (i >= 0) cb.splice(i, 1); } } };
  }

  function bench(R, ctx, x, z) {
    R.add('furn', box(2.2, 0.08, 0.5), M(x, 0.44, z), '#b8875a');
    for (const s of [-1, 1]) R.add('furn', box(0.08, 0.42, 0.42), M(x + s * 0.95, 0.21, z), '#8a5f3c');
    ctx.addCollider({ shape: 'box', x, z, hw: 1.1, hd: 0.25, maxY: 0.5, stand: true });
  }
  function plant(R, ctx, x, z, s = 1) {
    const Kt = K();
    if (Kt.pot) Kt.pot(R, { x, z, kind: 'danji', s: 1.3 * s });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU, l = 0.5 + (k % 3) * 0.16;
      R.add('paint', new THREE.ConeGeometry(0.06, l, 5), M(x + Math.cos(a) * 0.06, 0.5 * s + l / 2, z + Math.sin(a) * 0.06, a, 1, 1, 1, 0.35), '#4f7a3a', { cast: false });
    }
    ctx.addCollider({ shape: 'circle', x, z, r: 0.35 * s });
  }

  // ---------------------------------------------------------------- the lobby (x −10.5 … 10.5)
  function buildLobby(ctx, R, live) {
    const Kt = K(), Z0 = DOOR_Z;
    // the 안내데스크: a long counter of pine with a stone top, a low back cabinet against the wall, a 한지 light box
    const deskZ = Z0 + 2.2;
    R.add('furn', box(5.2, 1.0, 0.7), M(0, 0.5, deskZ), '#9c6b42');
    R.add('stone', box(5.4, 0.06, 0.82), M(0, 1.03, deskZ), '#e4ddd0');
    for (let i = -2; i <= 2; i++) R.add('wood', box(0.04, 0.86, 0.02), M(i * 1.0, 0.48, deskZ + 0.36), '#7a4f2c');
    R.add('furn', box(5.6, 0.9, 0.45), M(0, 0.45, Z0 + 0.4), '#8a5a36');
    ctx.addCollider({ shape: 'box', x: 0, z: deskZ, hw: 2.7, hd: 0.42, maxY: 1.06, stand: false });
    ctx.addCollider({ shape: 'box', x: 0, z: Z0 + 0.4, hw: 2.8, hd: 0.3, maxY: 0.95 });
    nameBoard(ctx, R, { title: '안내데스크', sub: '체크인 · 체크아웃', x: 0, y: 2.2, z: Z0 + 0.06, w: 2.2 });
    nameBoard(ctx, R, { title: '힐링관', sub: '쉬어 가는 열 개의 방', x: 0, y: 3.2, z: Z0 + 0.06, w: 2.9, bg1: '#3f2a18', bg2: '#2a1a0e' });
    // a calm line: this is play, not a real test or treatment (§19.0)
    nameBoard(ctx, R, { title: '놀이로 해 보는 쉼 체험이에요', sub: '진짜 검사나 치료가 아니에요', x: 3.0, y: 1.78, z: Z0 + 0.06, w: 1.7, bg1: '#f3ead8', bg2: '#e8dcc4', border: '#b08a5a', color: '#3a2616', subColor: '#6a4a2a' });
    station(ctx, 'LOBBY', 'desk', 0, 0, deskZ + 1.1, PI);
    station(ctx, 'LOBBY', 'guide', 0, 0, deskZ - 0.75, 0);
    // the kiosk: a slim wooden stand with a lit screen
    const kx = -3.4, kz = FRONT_Z - 3.4;        // beside the way in from the glass doors, its screen towards them
    R.add('furn', box(0.62, 1.15, 0.4), M(kx, 0.575, kz), '#7a5234');
    R.add('glow', box(0.54, 0.4, 0.04), M(kx, 1.3, kz + 0.12, 0, 1, 1, 1, -0.35), '#cfe6ff');
    R.add('wood', box(0.7, 0.05, 0.48), M(kx, 1.18, kz), '#5a3a22');
    ctx.addCollider({ shape: 'box', x: kx, z: kz, hw: 0.34, hd: 0.24, maxY: 1.5 });
    station(ctx, 'LOBBY', 'kiosk', kx, 0, kz + 0.9, PI);
    // the waiting bench by the glass + 장독 and a pine bonsai on a stand
    bench(R, ctx, 5.2, FRONT_Z - 1.3); bench(R, ctx, -6.0, FRONT_Z - 1.3);
    station(ctx, 'LOBBY', 'bench', 5.2, 0.44, FRONT_Z - 1.3, PI);
    station(ctx, 'LOBBY', 'spot', 0, 0, deskZ + 1.6, PI);
    plant(R, ctx, 9.4, Z0 + 1.0, 1.2); plant(R, ctx, -9.4, Z0 + 1.0, 1.2);
    if (Kt.screen) try { Kt.screen(R, { x: 8.4, z: FRONT_Z - 3.2, rotY: -PI / 2, panels: 6, h: 1.6 }); } catch (e) { /* optional */ }
    // wayfinding where the lobby opens into the two wings (both faces: towards the lobby and back towards it)
    for (const sx of [1, -1]) {
      const x = sx * (LOBBY_W / 2), wing = sx > 0 ? '제1관 ~ 제5관' : '제6관 ~ 제10관';
      R.add('wood', box(0.05, 0.5, 0.05), M(x, HALL.CEIL - 0.25, -0.75), '#5a3a22', { cast: false }); R.add('wood', box(0.05, 0.5, 0.05), M(x, HALL.CEIL - 0.25, 0.75), '#5a3a22', { cast: false });
      nameBoard(ctx, R, { title: wing, sub: '이쪽으로 가요', x: x - sx * 0.02, y: HALL.CEIL - 0.72, z: 0, rotY: sx > 0 ? -PI / 2 : PI / 2, w: 1.7 });
      nameBoard(ctx, R, { title: '로비', sub: '안내데스크 · 숙소 · 상담실', x: x + sx * 0.02, y: HALL.CEIL - 0.72, z: 0, rotY: sx > 0 ? PI / 2 : -PI / 2, w: 1.7 });
    }
    // a woven mat under the waiting benches
    if (Kt.floorMat) try { Kt.floorMat(R, { x: 0, z: FRONT_Z - 2.0, w: 8, d: 2.4 }); } catch (e) { /* optional */ }
  }

  // ---------------------------------------------------------------- the doors of the corridor
  const LAMP_COL = { idle: new THREE.Color('#5a4a3a'), next: new THREE.Color('#ffc65a'), run: new THREE.Color('#ff9a3c'), done: new THREE.Color('#5fbf6a') };
  function buildDoors(ctx, R, live) {
    const all = [...ROOMS, ...EXTRA];
    const lampGeo = new THREE.SphereGeometry(0.13, 12, 8);
    ctx.own(lampGeo);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    ctx.own(lampMat);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, ROOMS.length);
    lamps.name = 'heal-door-lamps'; lamps.userData.guardSkip = true; lamps.raycast = () => {};
    const tmp = new THREE.Object3D();
    ROOMS.forEach((r, i) => { tmp.position.set(r.doorX + 1.25, 2.55, DOOR_Z + 0.12); tmp.updateMatrix(); lamps.setMatrixAt(i, tmp.matrix); lamps.setColorAt(i, LAMP_COL.idle); });
    lamps.instanceMatrix.needsUpdate = true; if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    R.addMesh(lamps, null);
    live.lamps = lamps;
    for (const r of all) {
      const isRoom = !!r.n;
      // a lamp bracket of brass under each state lamp
      if (isRoom) R.add('brass', box(0.2, 0.04, 0.16), M(r.doorX + 1.25, 2.4, DOOR_Z + 0.08), '#c9a24a', { cast: false });
      const title = isRoom ? `제${r.n}관` : r.name;
      const sub = isRoom ? `${r.n === 10 && gentle() ? r.kid : r.name} · ${r.min}분` : (r.key === 'STAY' ? '예약한 방' : '담당 매니저');
      live.signs[r.key] = nameBoard(ctx, R, { title, sub, x: r.doorX, y: 3.0, z: DOOR_Z + 0.07, w: 1.55 });
      ctx.interact({
        id: 'heal-door-' + r.key, kind: 'door', emoji: isRoom ? (r.n === 10 && gentle() ? r.kidEmoji : r.emoji) : r.emoji, radius: 2.6, priority: 0.7,
        label: `🚪 ${isRoom ? `제${r.n}관 ${r.name}` : r.name} 들어가기`, kidLabel: isRoom ? `제${r.n}관 ${r.n === 10 && gentle() ? r.kid : r.kid}` : r.kid,
        position: { x: r.doorX, y: 1.2, z: DOOR_Z + 0.5 },
        onInteract: () => { enterRoom(r.key); },
      });
    }
  }
  /** ink-wash pictures between the doors (painted here: no artwork with a seal or an inscription can slip in) —
   *  four pictures on one canvas, every frame of the corridor one merged mesh (one draw call) */
  function hangPaintings(ctx, R) {
    const low = ctx.low, rnd = G.util?.rng ? G.util.rng('heal:ink') : Math.random;
    const tex = canvasTex(low ? 1024 : 2048, low ? 512 : 1024, (c, w, h) => {
      const cw = w / 2, ch = h / 2;
      const paper = (x0, y0) => { const g = c.createLinearGradient(x0, y0, x0, y0 + ch); g.addColorStop(0, '#f3ead6'); g.addColorStop(1, '#e8dcc2'); c.fillStyle = g; c.fillRect(x0, y0, cw, ch); };
      const ink = (a) => `rgba(34,30,26,${a})`;
      // 1 · mountains in mist
      paper(0, 0);
      for (let k = 0; k < 4; k++) { c.fillStyle = ink(0.12 + k * 0.13); c.beginPath(); c.moveTo(0, ch); for (let x = 0; x <= cw; x += 6) c.lineTo(x, ch * (0.42 + k * 0.12) - Math.sin(x * (0.012 + k * 0.004) + k) * ch * (0.12 - k * 0.02) - Math.sin(x * 0.041 + k * 2) * ch * 0.03); c.lineTo(cw, ch); c.fill(); }
      c.fillStyle = 'rgba(243,234,214,0.55)'; c.fillRect(0, ch * 0.62, cw, ch * 0.08);
      c.fillStyle = 'rgba(170,40,30,0.0)';
      // 2 · a pine branch
      paper(cw, 0);
      c.strokeStyle = ink(0.85); c.lineWidth = 10; c.lineCap = 'round'; c.beginPath(); c.moveTo(cw + 20, ch * 0.85); c.bezierCurveTo(cw + cw * 0.35, ch * 0.55, cw + cw * 0.55, ch * 0.62, cw + cw * 0.95, ch * 0.3); c.stroke();
      for (let i = 0; i < 9; i++) { const t = i / 8, x = cw + 20 + t * cw * 0.85, y = ch * (0.85 - t * 0.55); for (let k = 0; k < 26; k++) { const a = -PI / 2 + (k / 25 - 0.5) * 2.6; c.strokeStyle = ink(0.55 + rnd() * 0.3); c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 16); c.lineTo(x + Math.cos(a) * 46, y - 16 + Math.sin(a) * 30); c.stroke(); } }
      // 3 · a plum branch in blossom
      paper(0, ch);
      c.strokeStyle = ink(0.8); c.lineWidth = 8; c.beginPath(); c.moveTo(cw * 0.1, ch * 1.92); c.lineTo(cw * 0.35, ch * 1.55); c.lineTo(cw * 0.3, ch * 1.3); c.moveTo(cw * 0.35, ch * 1.55); c.lineTo(cw * 0.75, ch * 1.38); c.lineTo(cw * 0.9, ch * 1.18); c.stroke();
      for (let i = 0; i < 26; i++) { const x = cw * (0.2 + rnd() * 0.7), y = ch * (1.15 + rnd() * 0.5); c.fillStyle = `rgba(${200 + rnd() * 40 | 0},${110 + rnd() * 40 | 0},${120 + rnd() * 30 | 0},0.85)`; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + Math.cos(k * 1.256) * 7, y + Math.sin(k * 1.256) * 7, 6, 0, TAU); c.fill(); } }
      // 4 · reeds by the water and wild geese
      paper(cw, ch);
      c.strokeStyle = ink(0.35); c.lineWidth = 2; for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(cw + cw * 0.1, ch * (1.75 + k * 0.03)); c.lineTo(cw + cw * 0.9, ch * (1.75 + k * 0.03)); c.stroke(); }
      for (let i = 0; i < 30; i++) { const x = cw + cw * (0.05 + rnd() * 0.35), b = ch * 1.9; c.strokeStyle = ink(0.6 + rnd() * 0.3); c.lineWidth = 3; c.beginPath(); c.moveTo(x, b); c.quadraticCurveTo(x + 10, b - 90, x + 20 + rnd() * 30, b - 160 - rnd() * 60); c.stroke(); }
      for (let i = 0; i < 7; i++) { const x = cw + cw * (0.45 + i * 0.06), y = ch * (1.25 + Math.abs(i - 3) * 0.04); c.strokeStyle = ink(0.8); c.lineWidth = 4; c.beginPath(); c.moveTo(x - 18, y - 6); c.quadraticCurveTo(x, y + 4, x + 18, y - 6); c.stroke(); }
      // the mounting: a silk border around each picture
      c.strokeStyle = '#b7a58a'; c.lineWidth = 18; for (const [x0, y0] of [[0, 0], [cw, 0], [0, ch], [cw, ch]]) c.strokeRect(x0 + 9, y0 + 9, cw - 18, ch - 18);
    });
    ctx.own(tex);
    const mat = low ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
    ctx.own(mat);
    const geos = [], spots = [];
    for (const r of ROOMS) spots.push(r.doorX - 3);
    spots.push(-9, 9);
    spots.forEach((x, i) => {
      const k = i % 4, pw = 1.5, ph = 0.75;
      const g = new THREE.PlaneGeometry(pw, ph), uv = g.attributes.uv;
      const u0 = (k % 2) * 0.5, v0 = k < 2 ? 0.5 : 0;
      for (let q = 0; q < uv.count; q++) uv.setXY(q, u0 + uv.getX(q) * 0.5, v0 + uv.getY(q) * 0.5);
      g.translate(x, 1.75, DOOR_Z + 0.07);
      geos.push(g);
      R.add('wood', box(pw + 0.1, ph + 0.1, 0.03), M(x, 1.75, DOOR_Z + 0.045), '#5a3a22', { cast: false });
    });
    const BGU = (typeof ADDONS !== 'undefined' && ADDONS.BufferGeometryUtils) || null;
    const merged = BGU ? BGU.mergeGeometries(geos, false) : null;
    for (const g of merged ? [merged] : geos) { ctx.own(g); const m = new THREE.Mesh(g, mat); m.name = 'heal-ink'; m.receiveShadow = true; m.userData.guardSkip = true; m.raycast = () => {}; R.addMesh(m, null); }
    if (merged) for (const g of geos) g.dispose();
  }
  function applyDoorStates() {
    const L = hallLive;
    if (!L || !L.lamps) return;
    ROOMS.forEach((r, i) => L.lamps.setColorAt(i, LAMP_COL[doorState[r.key]] || LAMP_COL.idle));
    if (L.lamps.instanceColor) L.lamps.instanceColor.needsUpdate = true;
    const s10 = L.signs.R10;
    if (s10 && s10.userData.redraw) { const g = gentle(); if (L._g10 !== g) { L._g10 = g; s10.userData.redraw('제10관', (g ? '마음 돌아보기' : '임종체험관') + ' · 60분'); } }
  }
  // the 'next' lamp breathes slowly (0.4 Hz; steady with reduce motion)
  function lampTick(t) {
    const L = hallLive;
    if (!L || !L.lamps) return;
    let any = false;
    ROOMS.forEach((r, i) => {
      if (doorState[r.key] !== 'next') return;
      const k = still() ? 1 : 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * TAU * 0.4));
      L.lamps.setColorAt(i, _c.copy(LAMP_COL.next).multiplyScalar(k)); any = true;
    });
    if (any && L.lamps.instanceColor) L.lamps.instanceColor.needsUpdate = true;
  }
  const _c = new THREE.Color();

  // ---------------------------------------------------------------- the sun through the glass, clouds, the lamps
  function setupSun(ctx, live) {
    const E = G.sys.engine, origin = HALL.origin;
    let base = null, tAcc = 1;
    const dir = new THREE.Vector3();
    live.updates.push((dt, t) => {
      lampTick(t);
      tAcc += dt;
      if (tAcc < 0.35) return;
      tAcc = 0;
      const I = E && E._indoor, pl = G.sys.player, Wx = G.sys.weather;
      if (I && I.center && pl && pl.position && P()?.is?.(HALL.id)) {
        // the shadow frustum (and the sun's aim) follow the visitor along the 171 m: crisp mullion shadows near them
        const lx = clamp(pl.position.x - origin.x, -HALL.W / 2 + 20, HALL.W / 2 - 20);
        I.center.set(origin.x + lx, HALL.H / 2, origin.z);
        // where the real sun stands (the weather system's clock: KST, the game clock or the fixed test hour)
        const az = Number(Wx?.sunAzimuth), el = Number(Wx?.sunElevation);
        if (fin(az) && fin(el)) {
          const a = az * PI / 180, e = clamp(el, 3, 80) * PI / 180;
          dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
          if (dir.lengthSq() > 1e-6 && I.dir) I.dir.copy(dir.normalize());
        }
        if (!base && I.sun) base = { sun: I.sun.intensity, hemi: I.hemi?.intensity };
        if (base && I.sun) {
          const m = Wx?.mix || {};
          const clear = fin(m.CLEAR) ? m.CLEAR : 1, k = clear + 0.3 * (m.CLOUDY || 0) + 0.22 * (m.FOG || 0) + 0.14 * (m.RAIN || 0) + 0.24 * (m.SNOW || 0);
          const low = fin(el) ? clamp((el + 2) / 10, 0, 1) : 1;
          I.sun.intensity = base.sun * clamp(k, 0.1, 1) * lerp(0.25, 1, low);
          if (I.hemi && fin(base.hemi)) I.hemi.intensity = base.hemi * lerp(1.18, 1, clamp(k, 0, 1));
        }
      }
      // the six pooled lamps go to the ceiling lamps nearest the visitor
      if (pl && pl.position && live.handles.length) {
        const px = pl.position.x - origin.x;
        const near = live.lightSpots.slice().sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px));
        live.handles.forEach((h, i) => { const s = near[i], l = h.light; if (s && l) l.position.set(origin.x + s.x, s.y, origin.z + s.z); });
      }
    });
  }

  /** sun patches on the corridor floor: every glass port projected along the REAL sun direction (the same sun the
   *  engine aims), cut by the eaves and the back wall — drawn when the window sun casts no real shadow here (the kit's
   *  rooms do the same with their windows); additive, warm, fading with clouds, a low sun and the night */
  function sunPatches(ctx, R, live) {
    const ports = live.ports, n = ports.length;
    if (!n) return;
    const pos = new Float32Array(n * 4 * 3), idx = [];
    for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); ctx.own(g);
    const m = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }); ctx.own(m);
    const mesh = new THREE.Mesh(g, m); mesh.name = 'heal-sun-patches'; mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.userData.guardSkip = true; mesh.raycast = () => {};
    R.addMesh(mesh, null);
    const E = G.sys.engine, Y = 0.012, eaveY = R.post + 0.3, eaveZ = FRONT_Z + 2.1, backZ = DOOR_Z + 0.05;
    let acc = 1;
    live.updates.push((dt) => {
      acc += dt;
      if (acc < 0.4) return;
      acc = 0;
      const Wx = G.sys.weather, az = Number(Wx?.sunAzimuth), el = Number(Wx?.sunElevation), nf = clamp(Number(G.world?.nightFactor) || 0, 0, 1);
      const shadows = !!E?.indoorShadows;
      if (!fin(az) || !fin(el) || el < 1 || shadows) { mesh.visible = false; return; }
      const a = az * PI / 180, e = el * PI / 180, dx = Math.sin(a) * Math.cos(e), dy = Math.sin(e), dz = -Math.cos(a) * Math.cos(e);
      if (dz < 0.05) { mesh.visible = false; return; }      // the sun is behind the house: no light comes through the glass
      // a ray from a pane point towards the sun must pass under the eave edge (z = eaveZ, y = eaveY)
      const k = dy / dz;                                       // rise per metre towards the sun
      const capY = Math.min(R.post, eaveY - (eaveZ - FRONT_Z) * k);
      for (let i = 0; i < n; i++) {
        const [x0, x1, y0, y1raw] = ports[i], y1 = Math.min(y1raw, capY), o = i * 12;
        if (y1 <= y0 + 0.02) { pos.fill(0, o, o + 12); continue; }
        // a pane point (x, y, FRONT_Z) lands on the floor at x − dx / dy · y, z = FRONT_Z − dz / dy · y (stopped at the back wall)
        const put = (j, x, y) => { let zf = FRONT_Z - (dz / dy) * y, xf = x - (dx / dy) * y; if (zf < backZ) { const t = (FRONT_Z - backZ) / (FRONT_Z - zf); xf = x - (dx / dy) * y * t; zf = backZ; } pos[o + j * 3] = xf; pos[o + j * 3 + 1] = Y; pos[o + j * 3 + 2] = zf; };
        put(0, x0, y0); put(1, x1, y0); put(2, x1, y1); put(3, x0, y1);
      }
      g.attributes.position.needsUpdate = true;
      const mix = Wx?.mix || {}, clear = fin(mix.CLEAR) ? mix.CLEAR : 1, wk = clamp(clear + 0.25 * (mix.CLOUDY || 0), 0, 1);
      m.opacity = 0.2 * wk * clamp((el - 1) / 8, 0, 1) * (1 - nf);
      mesh.visible = m.opacity > 0.005;
    });
  }

  // ================================================================ the garden strip and the far view (outside the glass)
  function seasonId() {
    try {
      const s = G.season?.id || G.sys.season?.mode?.() || null;
      if (s) return typeof s === 'string' ? s : s.id;
    } catch (e) { /* optional */ }
    try { return G.env?.season?.()?.id || 'autumn'; } catch (e) { return 'autumn'; }
  }
  function buildGarden(ctx, R, live) {
    const Kt = K(), low = ctx.low, W = HALL.W, Z = FRONT_Z, rnd = G.util?.rng ? G.util.rng('heal:garden') : Math.random;
    const o = { cast: false };
    // 기단: the stone edge the glass stands on, a step down to the garden
    R.add('stone', slab(W + 3, 0.5, 2.6), M(0, -0.25, Z + 1.3), '#cdc6b8', o);
    R.add('stone', box(4.4, 0.24, 0.6), M(0, -0.38, Z + 2.9), '#bdb6a8', o);
    // the garden ground (lies 0.5 m below the floor): gravel near the house, then moss and grass
    const gz0 = Z + 2.6, gz1 = Z + 19;
    const ground = new THREE.PlaneGeometry(W + 60, gz1 - gz0 + 2, 1, 1); ground.rotateX(-PI / 2); ground.translate(0, -0.5, (gz0 + gz1) / 2);
    const gmat = low ? new THREE.MeshLambertMaterial({ color: 0x8c8a6a }) : new THREE.MeshStandardMaterial({ color: 0x8c8a6a, roughness: 0.96 });
    ctx.own(ground); ctx.own(gmat);
    const gmesh = new THREE.Mesh(ground, gmat); gmesh.name = 'heal-garden-ground'; gmesh.receiveShadow = true; gmesh.userData.guardSkip = true;
    R.addMesh(gmesh, null);
    R.add('stone', slab(W + 40, 0.04, 2.2), M(0, -0.49, Z + 3.7), '#e2dccf', o);     // the gravel band
    // the stone wall (돌담) with a tile cap at the far edge of the garden
    R.add('stone', slab(W + 60, 1.3, 0.6), M(0, -0.5 + 0.65, gz1), '#d9cdb6', o);
    R.add('paint', slab(W + 60, 0.1, 0.85), M(0, 0.85, gz1), '#45494e', o);
    R.add('paint', slab(W + 60, 0.09, 0.36), M(0, 0.94, gz1), '#3c4045', o);
    // stepping stones, rocks, stone lanterns (lit at night), 장독대 clusters, a small pond with a stone rim
    for (let x = -W / 2 + 4; x < W / 2 - 4; x += 2.1 + rnd() * 1.2) R.add('stone', cyl(0.3 + rnd() * 0.12, 0.34 + rnd() * 0.12, 0.08, 9), M(x, -0.46, Z + 5.4 + (rnd() - 0.5) * 0.8, rnd() * 3), '#aaa395', o);
    for (let i = 0; i < 26; i++) { const s = 0.4 + rnd() * 0.9, x = (rnd() - 0.5) * (W + 20), z = Z + 7 + rnd() * 9; R.add('stone', new THREE.DodecahedronGeometry(s, 0), M(x, -0.5 + s * 0.35, z, rnd() * 6, 1.3, 0.6, 1.0), '#8f897c', o); }
    const lanterns = [];
    for (let x = -W / 2 + 9; x < W / 2 - 6; x += 18) {
      const z = Z + 6.6;
      R.add('stone', box(0.5, 0.12, 0.5), M(x, -0.44, z), '#b9b2a4', o);
      R.add('stone', cyl(0.09, 0.11, 0.8, 8), M(x, 0.02, z), '#b9b2a4', o);
      R.add('stone', box(0.46, 0.08, 0.46), M(x, 0.46, z), '#b0a99b', o);
      R.add('glow', box(0.3, 0.3, 0.3), M(x, 0.66, z), '#ffcf8a', o);
      R.add('stone', new THREE.ConeGeometry(0.42, 0.32, 4), M(x, 0.97, z, PI / 4), '#a9a294', o);
      lanterns.push({ x, z });
    }
    // jars on low stone platforms (a 장독대 every 40 m)
    if (Kt.pot) for (let cx = -W / 2 + 22; cx < W / 2 - 10; cx += 40) {
      R.add('stone', box(4.2, 0.2, 2.2), M(cx, -0.4, Z + 9.5), '#bdb6a8', o);
      const kinds = ['dok', 'hangari', 'jungduri', 'danji', 'hangari', 'dok', 'danji'];
      kinds.forEach((kind, i) => { try { Kt.pot(R, { x: cx - 1.6 + i * 0.53, y: -0.3, z: Z + 9.5 + (i % 2 ? 0.45 : -0.4), kind, s: kind === 'dok' ? 0.9 : 0.8, lid: true }); } catch (e) { /* optional */ } });
    }
    // the pond (west of the entrance): a dark still water with a stone rim
    {
      const px = -26, pz = Z + 11, pr = 3.4;
      const wg = new THREE.CircleGeometry(pr, low ? 20 : 40); wg.rotateX(-PI / 2); wg.scale(1.6, 1, 1); wg.translate(px, -0.42, pz);
      const wm = low ? new THREE.MeshLambertMaterial({ color: 0x3e5a5c }) : new THREE.MeshStandardMaterial({ color: 0x26393b, roughness: 0.05, metalness: 0.35, envMapIntensity: 1.4 });
      ctx.own(wg); ctx.own(wm);
      const wmesh = new THREE.Mesh(wg, wm); wmesh.name = 'heal-pond'; wmesh.userData.guardSkip = true; R.addMesh(wmesh, null);
      for (let k = 0; k < 22; k++) { const a = (k / 22) * TAU, s = 0.3 + rnd() * 0.2; R.add('stone', new THREE.DodecahedronGeometry(s, 0), M(px + Math.cos(a) * pr * 1.6, -0.45, pz + Math.sin(a) * pr, rnd() * 6, 1.2, 0.55, 1), '#9a9486', o); }
      live.pond = wm;
    }
    // pines (evergreen) and broadleaf trees that follow the season
    const pines = [], leafy = [];
    for (let x = -W / 2 + 3; x < W / 2; x += 9 + rnd() * 7) { if (Math.abs(x + 26) < 6) continue; (rnd() < 0.62 ? pines : leafy).push({ x, z: Z + 12 + rnd() * 5, s: 0.8 + rnd() * 0.5 }); }
    for (const p of pines) pine(R, p.x, p.z, p.s, rnd);
    const crowns = [];
    for (const p of leafy) {
      const h = 3.2 * p.s;
      R.add('wood', cyl(0.12 * p.s, 0.18 * p.s, h, 7), M(p.x, -0.5 + h / 2, p.z), '#5d4a3a', { cast: true });
      for (let b = 0; b < 5; b++) { const a = (b / 5) * TAU + rnd(); R.add('wood', cyl(0.03, 0.06, 1.6 * p.s, 5), M(p.x + Math.cos(a) * 0.5 * p.s, -0.5 + h * 0.85, p.z + Math.sin(a) * 0.5 * p.s, a, 1, 1, 1, 0.7), '#5d4a3a', o); }
      for (let c = 0; c < 4; c++) { const g = new THREE.IcosahedronGeometry(1.1 * p.s, 1); g.translate(p.x + (rnd() - 0.5) * 1.4 * p.s, -0.5 + h + 0.4 + (rnd() - 0.2) * p.s, p.z + (rnd() - 0.5) * 1.2 * p.s); crowns.push(g); }
    }
    // the crowns are one mesh of their own: their colour follows the season (bare in winter: hidden)
    if (crowns.length) {
      const BGU = (typeof ADDONS !== 'undefined' && ADDONS.BufferGeometryUtils) || null;
      const cg = BGU ? BGU.mergeGeometries(crowns, false) : crowns[0];
      if (BGU) for (const g of crowns) g.dispose();
      const cm = low ? new THREE.MeshLambertMaterial({ color: 0x6a8a44 }) : new THREE.MeshStandardMaterial({ color: 0x6a8a44, roughness: 0.9, flatShading: true });
      ctx.own(cg); ctx.own(cm);
      const mesh = new THREE.Mesh(cg, cm); mesh.name = 'heal-crowns'; mesh.castShadow = !low; mesh.userData.guardSkip = true; R.addMesh(mesh, null);
      live.crowns = mesh;
    }
    // the meadow beyond the wall and the far view of the hills (a long painted panorama far out)
    {
      const mg = new THREE.PlaneGeometry(900, 140, 1, 1); mg.rotateX(-PI / 2); mg.translate(0, -1.6, gz1 + 70);
      const mm = low ? new THREE.MeshLambertMaterial({ color: 0x7a8456 }) : new THREE.MeshStandardMaterial({ color: 0x7a8456, roughness: 1 });
      ctx.own(mg); ctx.own(mm);
      const meadow = new THREE.Mesh(mg, mm); meadow.name = 'heal-meadow'; meadow.userData.guardSkip = true; meadow.receiveShadow = false; R.addMesh(meadow, null);
      live.meadow = mm;
      const tex = canvasTex(low ? 2048 : 4096, low ? 256 : 512, (c, w, h) => paintPanorama(c, w, h));
      tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(2, 1);
      ctx.own(tex);
      const pg = new THREE.PlaneGeometry(1100, 150); pg.translate(0, 150 / 2 - 22, gz1 + 140);
      pg.rotateY(PI);  // its front faces the house (−Z)
      pg.translate(0, 0, 2 * (gz1 + 140));
      const pm = new THREE.MeshBasicMaterial({ map: tex, fog: false });
      ctx.own(pg); ctx.own(pm);
      const pano = new THREE.Mesh(pg, pm); pano.name = 'heal-far-view'; pano.userData.guardSkip = true; pano.raycast = () => {}; pano.renderOrder = -2;
      R.addMesh(pano, null);
      live.pano = pm;
    }
    // weather and the hour outside: lamps at night, the sky's tint on the far view, snow on the ground, the season
    const day = new THREE.Color(1, 1, 1), dusk = new THREE.Color(1.0, 0.78, 0.62), night = new THREE.Color(0.13, 0.15, 0.24);
    const gDay = new THREE.Color(0x8c8a6a), gSnow = new THREE.Color(0xe9eef2), mDay = new THREE.Color(0x7a8456);
    const lanternLights = [];
    if (!low) for (const l of lanterns.slice(0, 4)) lanternLights.push({ h: ctx.light({ x: l.x, y: 0.7, z: l.z, color: 0xffc070, intensity: 3, distance: 6, decay: 2, day: 0, flicker: 0.04 }), x: l.x, z: l.z });
    const SEASON_LEAF = { spring: '#9cc46a', summer: '#4f7f34', autumn: '#c0662c', winter: null };
    let acc = 1, lastSeason = null;
    const _leaf = new THREE.Color(), _tmpC = new THREE.Color();
    live.updates.push((dt) => {
      acc += dt;
      if (acc < 0.5) return;
      acc = 0;
      const nf = clamp(Number(G.world?.nightFactor) || 0, 0, 1), Wx = G.sys.weather;
      const el = Number(Wx?.sunElevation);
      const duskK = fin(el) ? clamp(1 - Math.abs(el - 2) / 10, 0, 1) * (1 - nf) : 0;
      if (live.pano) live.pano.color.copy(day).lerp(dusk, duskK * 0.8).lerp(night, nf);
      // snow lying in the garden: the season's snow cover (12-seasons; its global hook is off indoors) or falling snow
      const SN = G.season, snow = clamp(Number(Wx?.precipitation?.snow) || Number(Wx?.mix?.SNOW) || 0, 0, 1), cover = clamp(Math.max(fin(Number(SN?.snow)) ? Number(SN.snow) : 0, snow), 0, 1);
      live.snowK = lerp(live.snowK || 0, cover, 0.3);
      // (lit by the room's own sun / moon: no extra darkening at night — the screen watchdog wants no black block)
      gmat.color.copy(gDay).lerp(gSnow, live.snowK * 0.9);
      if (live.meadow) live.meadow.color.copy(mDay).lerp(gSnow, live.snowK * 0.85);
      // the broadleaf crowns follow G.season (leaf, fresh green, autumn colour, withered); without it the season id
      if (live.crowns) {
        if (SN && fin(Number(SN.leaf))) {
          const leaf = clamp(Number(SN.leaf), 0, 1);
          live.crowns.visible = leaf > 0.12;
          _leaf.set('#4f7f34').lerp(_tmpC.set('#9cc46a'), clamp(Number(SN.fresh) || 0, 0, 1)).lerp(_tmpC.set('#c8642a'), clamp(Number(SN.autumn) || 0, 0, 1)).lerp(_tmpC.set('#8a6a3a'), clamp(Number(SN.brown) || 0, 0, 1) * 0.8)
            .lerp(_tmpC.set('#f3d6de'), clamp(Number(SN.blossom) || 0, 0, 1) * 0.6);
          live.crowns.material.color.copy(_leaf);
          live.crowns.scale.setScalar(1);
        } else {
          const s = seasonId();
          if (s !== lastSeason) {
            lastSeason = s;
            const col = SEASON_LEAF[s] !== undefined ? SEASON_LEAF[s] : SEASON_LEAF.autumn;
            live.crowns.visible = !!col;
            if (col) live.crowns.material.color.set(col);
          }
        }
      }
    });
    // rain and snow outside the glass (medium / high): streaks / flakes in a box that follows the visitor along the
    // front, drops that slide slowly down the panes; nothing falls inside (indoor place)
    if (!low) {
      const N = 900, pos = new Float32Array(N * 6), sp = new Float32Array(N);
      const X = 36, z0 = Z + 2.6, z1 = Z + 22, y0 = -0.5, y1 = 9;
      for (let i = 0; i < N; i++) { const x = (rnd() - 0.5) * 2 * X, y = y0 + rnd() * (y1 - y0), z = z0 + rnd() * (z1 - z0); pos.set([x, y, z, x, y + 0.35, z], i * 6); sp[i] = 0.8 + rnd() * 0.4; }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); ctx.own(rg);
      const rm = new THREE.LineBasicMaterial({ color: 0xc8d4dc, transparent: true, opacity: 0.0, depthWrite: false }); ctx.own(rm);
      const rain = new THREE.LineSegments(rg, rm); rain.name = 'heal-rain-out'; rain.frustumCulled = false; rain.userData.guardSkip = true; rain.raycast = () => {}; rain.visible = false;
      R.addMesh(rain, null);
      const fpos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) fpos.set([pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]], i * 3);
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3)); ctx.own(fg);
      const fm = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.0, depthWrite: false }); ctx.own(fm);
      const snowP = new THREE.Points(fg, fm); snowP.name = 'heal-snow-out'; snowP.frustumCulled = false; snowP.userData.guardSkip = true; snowP.raycast = () => {}; snowP.visible = false;
      R.addMesh(snowP, null);
      // drops on the panes: a canvas of beads and short trails, scrolled down very slowly (no flicker)
      const dropTex = canvasTex(256, 512, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        for (let i = 0; i < 140; i++) { const x = rnd() * w, y = rnd() * h, r0 = 1 + rnd() * 3.2; c.fillStyle = 'rgba(235,242,246,0.55)'; c.beginPath(); c.ellipse(x, y, r0 * 0.8, r0, 0, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.arc(x - r0 * 0.25, y - r0 * 0.3, r0 * 0.3, 0, TAU); c.fill(); if (rnd() < 0.25) { c.strokeStyle = 'rgba(230,238,242,0.35)'; c.lineWidth = r0 * 0.6; c.beginPath(); c.moveTo(x, y - r0); c.lineTo(x + (rnd() - 0.5) * 3, y - r0 - 10 - rnd() * 40); c.stroke(); } }
      });
      dropTex.wrapS = dropTex.wrapT = THREE.RepeatWrapping; dropTex.repeat.set(W / 3, 1);
      ctx.own(dropTex);
      const dg = new THREE.PlaneGeometry(W, R.post - 0.36); dg.translate(0, (R.post - 0.36) / 2 + 0.04, Z + 0.035); ctx.own(dg);
      const dm = new THREE.MeshBasicMaterial({ map: dropTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }); ctx.own(dm);
      const drops = new THREE.Mesh(dg, dm); drops.name = 'heal-pane-drops'; drops.renderOrder = 3; drops.userData.guardSkip = true; drops.raycast = () => {}; drops.visible = false;
      R.addMesh(drops, null);
      let rainK = 0, snowK = 0;
      live.updates.push((dt, t) => {
        const Wx = G.sys.weather, pr = Wx?.precipitation || {};
        rainK = lerp(rainK, clamp(Number(pr.rain) || 0, 0, 1), Math.min(1, dt * 1.5));
        snowK = lerp(snowK, clamp(Number(pr.snow) || 0, 0, 1), Math.min(1, dt * 1.5));
        const pl = G.sys.player, px = pl && pl.position ? pl.position.x - HALL.origin.x : 0;
        const calm = still();
        rain.visible = rainK > 0.02; snowP.visible = snowK > 0.02; drops.visible = rainK > 0.02;
        rm.opacity = 0.42 * rainK; fm.opacity = 0.9 * snowK; dm.opacity = 0.7 * rainK;
        if (drops.visible && !calm) dropTex.offset.y = (dropTex.offset.y + dt * 0.012) % 1;
        if (!rain.visible && !snowP.visible) return;
        const d = Math.min(dt, 0.1), rv = calm ? 4 : 9, sv = calm ? 0.5 : 1.1;
        for (let i = 0; i < N; i++) {
          let x = pos[i * 6], y = pos[i * 6 + 1], z = pos[i * 6 + 2];
          if (x < px - X) x += 2 * X; else if (x > px + X) x -= 2 * X;
          if (rain.visible) y -= rv * sp[i] * d; else y -= sv * sp[i] * d;
          if (y < y0) y += y1 - y0;
          pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x - 0.04; pos[i * 6 + 4] = y + 0.38; pos[i * 6 + 5] = z;
          if (snowP.visible) { fpos[i * 3] = x + (calm ? 0 : Math.sin(t * 0.7 + i) * 0.3); fpos[i * 3 + 1] = y; fpos[i * 3 + 2] = z; }
        }
        if (rain.visible) rg.attributes.position.needsUpdate = true;
        if (snowP.visible) fg.attributes.position.needsUpdate = true;
      });
    }
    return { lanterns, lanternLights };
  }
  function pine(R, x, z, s, rnd) {
    const h = 4.6 * s;
    R.add('wood', cyl(0.1 * s, 0.2 * s, h, 7), M(x, -0.5 + h / 2, z, 0, 1, 1, 1, (rnd() - 0.5) * 0.12), '#6a4a34', { cast: true });
    for (let k = 0; k < 4; k++) {
      const y = -0.5 + h * (0.42 + k * 0.17), r = (1.7 - k * 0.32) * s;
      const g = new THREE.ConeGeometry(r, 1.1 * s, 8, 1); g.scale(1, 1, 0.85);
      R.add('paint', g, M(x + (rnd() - 0.5) * 0.3, y, z + (rnd() - 0.5) * 0.3, rnd() * 6), k % 2 ? '#2f5a34' : '#355f3a', { cast: true });
    }
  }
  /** the far view: a soft sky, three ridges fading with distance, wooded slopes, a breath of haze — seamless across */
  function paintPanorama(c, w, h) {
    const rnd = G.util?.rng ? G.util.rng('heal:pano') : Math.random;
    const hz = h * 0.7;
    const sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#86aed8'); sky.addColorStop(0.6, '#b9d1e6'); sky.addColorStop(1, '#e2e9e6');
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * w, y = h * (0.06 + rnd() * 0.32), r0 = 60 + rnd() * 140, g = c.createRadialGradient(x, y, 0, x, y, r0);
      g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.save(); c.translate(x, y); c.scale(2.8, 0.45); c.translate(-x, -y); c.fillStyle = g; c.fillRect(x - r0, y - r0, r0 * 2, r0 * 2); c.restore();
    }
    // ridges with whole numbers of waves across the width (the picture repeats without a seam)
    const ridge = (base, amp, col, f1, f2, f3, ph) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) { const u = (x / w) * TAU; c.lineTo(x, base - (Math.sin(u * f1 + ph) * 0.5 + Math.sin(u * f2 + ph * 2.1) * 0.3 + Math.sin(u * f3 + ph * 0.7) * 0.12) * amp - amp * 0.55); }
      c.lineTo(w, h); c.fill();
    };
    ridge(hz - h * 0.04, h * 0.16, '#a6bccb', 3, 7, 19, 0.4);
    ridge(hz - h * 0.0, h * 0.12, '#8caa9e', 4, 9, 23, 1.7);
    ridge(hz + h * 0.04, h * 0.08, '#6e9479', 5, 11, 29, 2.9);
    for (let pass = 0; pass < 3; pass++) {
      const n = 260 + pass * 120;
      for (let i = 0; i < n; i++) {
        const x = rnd() * w, s = h * (0.012 + rnd() * 0.014) * (1 + pass * 0.5), y = hz + h * (0.06 + pass * 0.04) + rnd() * h * 0.03, pn = rnd() < 0.5;
        const g0 = 66 + pass * 9 + rnd() * 24;
        c.fillStyle = `rgb(${g0 * 0.58 | 0},${g0 * 1.08 | 0},${g0 * 0.64 | 0})`;
        if (pn) { c.beginPath(); c.moveTo(x, y - s * 2.1); c.lineTo(x + s * 0.6, y); c.lineTo(x - s * 0.6, y); c.fill(); }
        else { c.beginPath(); c.ellipse(x, y - s * 0.8, s * 0.85, s * 0.9, 0, 0, TAU); c.fill(); }
      }
    }
    const gr = c.createLinearGradient(0, hz + h * 0.12, 0, h);
    gr.addColorStop(0, '#5a7a4c'); gr.addColorStop(1, '#7c855a');
    c.fillStyle = gr; c.fillRect(0, hz + h * 0.17, w, h);
    const hg = c.createLinearGradient(0, hz - h * 0.06, 0, hz + h * 0.14);
    hg.addColorStop(0, 'rgba(232,238,232,0)'); hg.addColorStop(1, 'rgba(232,238,232,0.38)');
    c.fillStyle = hg; c.fillRect(0, hz - h * 0.06, w, h * 0.2);
  }

  // ================================================================ the rooms
  /** the light of a room's theme (overrides of the kit profile; never so dark that a wall sinks to a black block) */
  function moodLight(mood) {
    const sh = !!G.sys.engine?.indoorShadows;
    if (mood === 'bright') return { hemi: { sky: '#f7f6f2', ground: '#cdbca4', intensity: sh ? 0.56 : 1.0 }, exposure: 1.08, warmth: 0.0 };
    if (mood === 'calm') return { hemi: { sky: '#eadac2', ground: '#8f735a', intensity: sh ? 0.34 : 0.74 }, exposure: 0.95, exposureNight: 1.3, warmth: 0.07, background: '#463c33' };
    return { hemi: { sky: '#f3e2c6', ground: '#b8946a', intensity: sh ? 0.44 : 0.88 }, exposure: 1.0, warmth: 0.06 };
  }
  /** what makes every room lived-in: plants by the door, a runner from the door, a low cabinet with jars */
  function furnish(ctx, R, r) {
    const Kt = K(), Z = ROOM.d / 2;
    for (const x of [-2.5, 2.5]) plant(R, ctx, x, Z - 0.7, 1.0);
    if (['R1', 'R3', 'R5', 'R7'].includes(r.key) && Kt.floorMat) try { Kt.floorMat(R, { x: 0, z: Z - 4.6, w: 1.4, d: 7.6, tint: r.mood === 'calm' ? '#a58a64' : '#c4ab7c' }); } catch (e) { /* optional */ }
    if (['R3', 'R5'].includes(r.key)) {   // [heal-look] 제6관 … 제8관 have their own wall furniture now
      R.add('furn', box(0.5, 0.62, 2.2), M(6.6, 0.31, 1.6), '#7a5234');
      R.add('furn', box(0.56, 0.04, 2.3), M(6.6, 0.64, 1.6), '#9c6b42');
      if (Kt.pot) ['hangari', 'danji', 'bottle', 'danji'].forEach((kind, i) => { try { Kt.pot(R, { x: 6.6, y: 0.66, z: 0.8 + i * 0.52, kind, s: kind === 'hangari' ? 0.5 : 0.55, lid: kind !== 'bottle' }); } catch (e) { /* optional */ } });
      ctx.addCollider({ shape: 'box', x: 6.6, z: 1.6, hw: 0.28, hd: 1.15, maxY: 0.9 });
    }
  }
  /** the shell of a room: door in the south wall (back to the corridor), windows of 한지 on the north wall */
  function roomShell(ctx, r, o = {}) {
    const Kt = K(), w = ROOM.w, d = ROOM.d;
    const win = (p, wd = 1.6, hg = 1.5, sill = 0.7) => ({ window: p, w: wd, h: hg, sill });
    const P_ = r.wall || 'plaster', tall = !!(o.tall || r.tall);
    const R = Kt.room(ctx, {
      w, d, post: ROOM.post, ridge: ROOM.h, ceiling: ROOM.ceil, bays: { x: 5, z: 8 }, floor: o.floor || r.floor, roof: 'ceiling', tone: o.tone || r.tone,
      walls: o.walls || {
        N: [P_, win(o.pattern || 'ttisal', 1.8, tall ? 2.4 : 1.5, tall ? 0.35 : 0.7), tall ? win('ttisal', 1.8, 2.4, 0.35) : P_, win(o.pattern || 'ttisal', 1.8, tall ? 2.4 : 1.5, tall ? 0.35 : 0.7), P_],
        E: [P_, P_, win('yongja'), P_, P_, win('yongja'), P_, P_],
        S: [P_, P_, { door: 'changho', exit: true, w: 1.9, h: 2.6 }, P_, P_],
        W: [P_, P_, win('yongja'), P_, P_, win('yongja'), P_, P_],
      },
      sun: o.sun || { az: 180, el: 30 }, light: o.light || moodLight(r.mood),
    });
    // the room's name board over the inside of its door
    nameBoard(ctx, R, { title: r.n ? `제${r.n}관` : r.name, sub: r.n ? (r.n === 10 && gentle() ? r.kid : r.name) : '', x: 0, y: 3.05, z: d / 2 - 0.08, rotY: PI, w: 1.6 });
    return R;
  }
  const SPAWN_IN = { x: 0, z: ROOM.d / 2 - 2.2, rotY: PI };
  // per-room layouts: the things of each theme, its light and sound, and its stations
  const LAYOUT = {
    // 제1관 기본 검사관: clean and bright — pale wood, white, instruments on stands, a board for 오늘의 쉼 안내
    R1(ctx, R) {
      const Kt = K(), low = ctx.low, Z = ROOM.d / 2;
      // 1 · the 인바디 plate: a low white platform with two grips on a column and a lit screen
      { const x = -4.6, z = -5.2;
        R.add('paint', box(0.62, 0.08, 0.78), M(x, 0.04, z), '#f4f4f2');
        R.add('iron', box(0.5, 0.012, 0.18), M(x, 0.086, z - 0.16), '#9aa3a8'); R.add('iron', box(0.5, 0.012, 0.18), M(x, 0.086, z + 0.16), '#9aa3a8');
        R.add('paint', cyl(0.05, 0.06, 1.05, 10), M(x, 0.6, z - 0.42), '#e9ecee');
        R.add('paint', box(0.5, 0.32, 0.08), M(x, 1.22, z - 0.42, 0, 1, 1, 1, -0.3), '#f2f3f3');
        R.add('glow', box(0.36, 0.2, 0.01), M(x, 1.24, z - 0.37, 0, 1, 1, 1, -0.3), '#bfe3ff');
        for (const s of [-1, 1]) R.add('iron', cyl(0.018, 0.018, 0.34, 8), M(x + s * 0.3, 1.0, z - 0.32, 0, 1, 1, 1, PI / 2), '#cfd5d8');
        ctx.addCollider({ shape: 'box', x, z: z - 0.42, hw: 0.28, hd: 0.08, maxY: 1.4 });
        station(ctx, 'R1', 'body', x, 0.08, z, PI); }
      // 2 · the microscope table (장내미생물): a white bench, a microscope, little jars of the day's foods
      { const x = -1.5, z = -6.6;
        R.add('furn', box(1.6, 0.82, 0.7), M(x, 0.41, z), '#f1ece4'); R.add('stone', box(1.7, 0.05, 0.78), M(x, 0.845, z), '#ffffff');
        R.add('iron', box(0.2, 0.03, 0.26), M(x, 0.885, z), '#2f3338'); R.add('iron', box(0.05, 0.36, 0.06), M(x, 1.05, z - 0.09), '#2f3338');
        R.add('iron', cyl(0.035, 0.03, 0.28, 10), M(x, 1.16, z + 0.0, 0, 1, 1, 1, 0.45), '#3a3f44'); R.add('glow', cyl(0.025, 0.025, 0.005, 10), M(x, 0.905, z), '#e8f4ff');
        if (Kt.pot) ['bottle', 'bowl', 'bottle'].forEach((k, i) => { try { Kt.pot(R, { x: x + 0.45 + i * 0.16, y: 0.87, z: z + 0.12, kind: k, s: 0.42, mat: 'onggi' }); } catch (e) { /* optional */ } });
        ctx.addCollider({ shape: 'box', x, z, hw: 0.82, hd: 0.38, maxY: 0.9 });
        station(ctx, 'R1', 'gut', x, 0, z + 0.85, PI); }
      // 3 · the double helix (유전자) on a stand: two strands of beads with rungs between them
      { const x = 1.6, z = -6.6, beads = low ? 14 : 22;
        R.add('furn', box(1.0, 0.82, 0.7), M(x, 0.41, z), '#f1ece4'); R.add('stone', box(1.1, 0.05, 0.78), M(x, 0.845, z), '#ffffff');
        R.add('wood', cyl(0.014, 0.014, 1.15, 6), M(x, 1.45, z), '#c9ab83');
        const cols = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f'];
        for (let i = 0; i < beads; i++) {
          const y = 0.92 + (i / (beads - 1)) * 1.05, a = i * 0.55;
          for (const s of [0, PI]) R.add('paint', new THREE.SphereGeometry(0.03, 8, 6), M(x + Math.cos(a + s) * 0.13, y, z + Math.sin(a + s) * 0.13), s ? '#4a6fa5' : '#c4554d', { cast: false });
          if (i % 2 === 0) R.add('paint', cyl(0.008, 0.008, 0.26, 5), M(x, y, z, -a, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(PI / 2)), cols[(i / 2) % 4], { cast: false });
        }
        ctx.addCollider({ shape: 'box', x, z, hw: 0.52, hd: 0.38, maxY: 0.9 });
        station(ctx, 'R1', 'gene', x, 0, z + 0.85, PI); }
      // 4 · the salt strips (소변염분 as a colour strip of the day's dishes): a rack of test strips and a colour chart
      { const x = 4.6, z = -5.2;
        R.add('furn', box(1.3, 0.82, 0.62), M(x, 0.41, z), '#f1ece4'); R.add('stone', box(1.4, 0.05, 0.7), M(x, 0.845, z), '#ffffff');
        R.add('wood', box(0.5, 0.06, 0.12), M(x - 0.3, 0.9, z - 0.1), '#c9ab83');
        ['#f6e7a1', '#efc96a', '#e3a04a', '#d1732f', '#b64a2a'].forEach((c, i) => R.add('paint', box(0.025, 0.16, 0.006), M(x - 0.48 + i * 0.09, 1.0, z - 0.1), c, { cast: false }));
        R.add('paint', box(0.5, 0.36, 0.02), M(x + 0.3, 1.1, z - 0.24, 0, 1, 1, 1, -0.2), '#fbfaf6');
        ['#f6e7a1', '#efc96a', '#e3a04a', '#d1732f', '#b64a2a'].forEach((c, i) => R.add('paint', box(0.07, 0.07, 0.01), M(x + 0.12 + i * 0.09, 1.12, z - 0.225, 0, 1, 1, 1, -0.2), c, { cast: false }));
        ctx.addCollider({ shape: 'box', x, z, hw: 0.66, hd: 0.32, maxY: 0.9 });
        station(ctx, 'R1', 'salt', x, 0, z + 0.8, PI); }
      // the board for 오늘의 쉼 안내 on the north wall (the program draws on it), a waiting bench, white curtains
      { const p = R.wp('N', ROOM.w / 2, 1.75, 0.06);
        R.add('wood', box(3.4, 1.9, 0.06), M(p.x, p.y, p.z + 0.02), '#c9ab83'); R.add('paint', box(3.2, 1.7, 0.02), M(p.x, p.y, p.z + 0.06), '#fbfaf6');
        station(ctx, 'R1', 'board', p.x, p.y, p.z + 0.09, 0); }
      bench(R, ctx, -4.6, 4.0); bench(R, ctx, 4.6, 4.0);
      for (const x of [-6.6, 6.6]) for (let k = 0; k < 6; k++) R.add('cloth', box(0.02, 2.5, 0.42), M(x, 1.35, -9.8 + k * 0.4, k % 2 ? 0.25 : -0.25), '#f4f2ec', { cast: false });
      plant(R, ctx, 6.6, 8.6, 1.1); plant(R, ctx, -6.6, 8.6, 1.1);
      for (let i = 0; i < 3; i++) R.add('glow', box(2.6, 0.04, 0.5), M(0, ROOM.ceil - 0.03, -6 + i * 5), '#f3f7ff', { cast: false });
      station(ctx, 'R1', 'guide', -2.8, 0, -3.6, PI / 2);
      station(ctx, 'R1', 'spot', 0, 0, -3.0, PI);
      if (!low) ctx.light({ x: 0, y: ROOM.ceil - 0.4, z: -4, color: 0xf4f6ff, intensity: 6, distance: 16, decay: 2, day: 0.35 });
    },
    // 제2관 쑥뜸관: a warm 온돌 floor (장판) with twelve mats in two rows, pillows and folded blankets, a moxa tray with
    // glowing cones and a thread of smoke by each mat, low screens between them, 쑥 bundles drying on a line, a brazier.
    // [heal-look] The program's mat (−1.6, −4.2) and tray stay; an aisle runs down the middle of the back row.
    R2(ctx, R) {
      const Kt = K(), low = ctx.low, T = (k, n = 1) => tally('R2', k, n);
      const mat = (x, z, i) => {
        if (Kt.floorMat) try { Kt.floorMat(R, { x, z, w: 1.25, d: 2.3, tint: i % 3 === 1 ? '#c2a466' : '#c9a96a', border: '#6a4a2a' }); T('mat'); } catch (e) { /* optional */ }
        if (Kt.roll) try { Kt.roll(R, { x, z: z - 1.0, len: 0.8, r: 0.1, tint: '#efe6d0' }); T('pillow'); } catch (e) { /* optional */ }
        R.add('cloth', box(0.9, 0.12, 0.42), M(x, 0.06, z + 0.88), ['#9fb3c8', '#d9a7a0', '#b8c4a0', '#e9dfc6'][i % 4], { cast: false }); T('blanket');
        // the moxa tray: a brass tray on a low stand with three little cones (glowing tips), smoke from every other one
        R.add('furn', box(0.4, 0.22, 0.3), M(x + 0.95, 0.11, z), '#6a4428');
        R.add('brass', cyl(0.16, 0.14, 0.03, 16), M(x + 0.95, 0.235, z), '#c9a24a');
        for (let k = 0; k < 3; k++) { R.add('straw', new THREE.ConeGeometry(0.025, 0.06, 7), M(x + 0.9 + k * 0.05, 0.28, z + (k - 1) * 0.04), '#8a7a4a', { cast: false }); R.add('glow', new THREE.SphereGeometry(0.008, 6, 4), M(x + 0.9 + k * 0.05, 0.31, z + (k - 1) * 0.04), '#ff8a3a', { cast: false }); }
        T('moxa tray');
        if (!low && Kt.smoke && i % 2 === 0) try { Kt.smoke(R, { x: x + 0.95, y: 0.32, z, s: 0.3 }); T('smoke'); } catch (e) { /* optional */ }
      };
      const rowA = [-5.8, -3.7, -1.6, 0.5, 2.6, 4.7], rowB = [-5.8, -3.7, -1.6, 1.6, 3.7, 5.8];
      rowA.forEach((x, i) => mat(x, -4.2, i)); rowB.forEach((x, i) => mat(x, 1.4, i + 1));
      // low screens between the mats, at the heads
      if (Kt.screen) for (const [sx, sz] of [[-4.75, -5.2], [1.55, -5.2], [-4.75, 0.4], [4.75, 0.4]]) try { Kt.screen(R, { x: sx, z: sz, rotY: PI / 2, panels: 2, h: 0.9 }); T('low screen'); } catch (e) { /* optional */ }
      if (Kt.screen) try { Kt.screen(R, { x: 0, z: -9.6, rotY: 0, panels: 8, h: 1.6 }); T('screen'); } catch (e) { /* optional */ }
      if (Kt.chest) try { Kt.chest(R, { x: -6.3, z: 5.2, rotY: PI / 2, w: 1.4, d: 0.5, h: 0.8, fittings: 'brass' }); R.block?.(-6.3, 5.2, 0.25, 0.7); for (let k = 0; k < 4; k++) R.add('cloth', box(0.42, 0.09, 1.2), M(-6.3, 0.85 + k * 0.095, 5.2), ['#f3ede0', '#d9a7a0', '#e9dfc6', '#9fb3c8'][k]); T('bedding chest'); } catch (e) { /* optional */ }
      // 쑥 bundles drying on two lines under the beams along the north and east walls
      if (Kt.rope) for (const [ax, az, bx, bz] of [[-6.6, -10.3, 6.6, -10.3], [7.0, -8.5, 7.0, -1.5]]) try {
        Kt.rope(R, { points: [[ax, 2.5, az], [bx, 2.5, bz]], r: 0.01, sag: 0.18 });
        const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.55);
        for (let k = 1; k < n; k++) { const t = k / n, sag = 0.18 * 4 * t * (1 - t); R.add('paint', new THREE.ConeGeometry(0.075, 0.45, 6), M(ax + (bx - ax) * t, 2.5 - sag - 0.24, az + (bz - az) * t, k, 1, 1, 1, PI), k % 2 ? '#7a8a4a' : '#8a9a58', { cast: false }); R.add('straw', cyl(0.012, 0.012, 0.06, 5), M(ax + (bx - ax) * t, 2.5 - sag - 0.02, az + (bz - az) * t), '#c8b07a', { cast: false }); }
        T('쑥 bundle', n - 1);
      } catch (e) { /* optional */ }
      // the brazier with glowing charcoal (east, by the door), a basket of dried 쑥 beside it
      if (Kt.pot) try { Kt.pot(R, { x: 5.6, z: 5.6, kind: 'brazier', s: 1.0 }); for (let k = 0; k < 7; k++) R.add('glow', new THREE.DodecahedronGeometry(0.04, 0), M(5.6 + Math.cos(k * 0.9) * 0.1 * (k % 3), 0.33, 5.6 + Math.sin(k * 0.9) * 0.1 * (k % 3), k), k % 2 ? '#ff7a2a' : '#c8401a', { cast: false }); ctx.addCollider({ shape: 'circle', x: 5.6, z: 5.6, r: 0.42, maxY: 0.4 }); T('brazier'); } catch (e) { /* optional */ }
      if (Kt.basket) try { Kt.basket(R, { x: 6.6, z: 5.0, r: 0.3, h: 0.2, kind: 'round' }); for (let k = 0; k < 6; k++) R.add('paint', new THREE.ConeGeometry(0.05, 0.3, 5), M(6.6 + (k - 2.5) * 0.07, 0.22, 5.0, k, 1, 1, 1, 1.3), '#7a8a4a', { cast: false }); ctx.addCollider({ shape: 'circle', x: 6.6, z: 5.0, r: 0.32 }); T('쑥 basket'); } catch (e) { /* optional */ }
      for (const [x, z] of [[-6.4, -8.6], [6.4, -8.6], [6.4, 8.4], [-6.9, -1.4]]) { if (Kt.jwadeung) try { Kt.jwadeung(R, { x, z, h: 0.9 }); T('paper lamp'); if (!low && Kt.lamp && z < 0 && Math.abs(x) < 6.6) Kt.lamp(R, { x, y: 0.75, z, s: 0.5, intensity: 2.4, distance: 7 }); } catch (e) { /* optional */ } }
      if (!low && Kt.lamp) try { Kt.lamp(R, { x: 6.4, y: 0.75, z: 8.4, s: 0.5, intensity: 2.4, distance: 7 }); } catch (e) { /* optional */ }
      bench(R, ctx, -4.6, 8.6); T('bench');
      station(ctx, 'R2', 'mat', -1.6, 0.04, -4.2, 0);
      station(ctx, 'R2', 'tray', -0.65, 0.25, -4.2, -PI / 2);
      station(ctx, 'R2', 'guide', 0.2, 0, -2.4, PI);
      station(ctx, 'R2', 'spot', -1.6, 0.04, -4.2, 0);
      emitter(ctx, 'fire', -0.65, -4.2, 0.35);
    },
    // 제3관 좌훈관: wooden seats over herb pots, steam, herb bundles drying under the beams
    R3(ctx, R) {
      const Kt = K(), low = ctx.low;
      for (let i = 0; i < 3; i++) {
        const x = -3.6 + i * 3.6, z = -4.4;
        if (Kt.pot) try { Kt.pot(R, { x, z, kind: 'sot', s: 1.0, mat: 'onggi' }); } catch (e) { /* optional */ }
        // the seat: a board ring on four legs over the pot
        R.add('furn', box(0.86, 0.05, 0.22), M(x, 0.5, z - 0.32), '#a57446'); R.add('furn', box(0.86, 0.05, 0.22), M(x, 0.5, z + 0.32), '#a57446');
        R.add('furn', box(0.22, 0.05, 0.42), M(x - 0.32, 0.5, z), '#a57446'); R.add('furn', box(0.22, 0.05, 0.42), M(x + 0.32, 0.5, z), '#a57446');
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) R.add('furn', box(0.05, 0.48, 0.05), M(x + a * 0.38, 0.24, z + b * 0.38), '#7a5234');
        ctx.addCollider({ shape: 'box', x, z, hw: 0.44, hd: 0.44, maxY: 0.52, stand: true });
        if (!low && Kt.steam) try { Kt.steam(R, { x, y: 0.55, z, s: 0.5 }); } catch (e) { /* optional */ }
        // a cloth to drape over the knees
        if (Kt.cloth) try { Kt.cloth(R, { x: x + 0.8, z: z + 0.2, w: 0.5, d: 0.35, drop: 0.2, tint: '#d9c7a4' }); } catch (e) { /* optional */ }
      }
      // herb bundles hanging from the beams (쑥 and 약쑥 drying)
      if (Kt.rope && Kt.straw) for (const x of [-5.4, -2, 2, 5.4]) try {
        Kt.rope(R, { points: [[x - 1.2, ROOM.ceil - 0.25, -8.2], [x + 1.2, ROOM.ceil - 0.25, -8.2]], r: 0.01, sag: 0.25 });
        for (let k = 0; k < 4; k++) R.add('paint', new THREE.ConeGeometry(0.07, 0.42, 6), M(x - 0.8 + k * 0.53, ROOM.ceil - 0.66, -8.2, 0, 1, 1, 1, PI), k % 2 ? '#7a8a4a' : '#8a9a58', { cast: false });
      } catch (e) { /* optional */ }
      if (Kt.shelf) try { const sp = Kt.shelf(R, { x: 6.6, z: -6, rotY: -PI / 2, w: 1.6, d: 0.4, h: 1.6, levels: 3 }); (sp || []).slice(0, 6).forEach((p, i) => { if (Kt.pot) Kt.pot(R, { x: p.x, y: p.y, z: p.z, kind: i % 2 ? 'danji' : 'bottle', s: 0.5 }); }); ctx.addCollider({ shape: 'box', x: 6.6, z: -6, hw: 0.22, hd: 0.82, maxY: 1.7 }); } catch (e) { /* optional */ }
      bench(R, ctx, -4.8, 5.0); bench(R, ctx, 4.8, 5.0);
      emitter(ctx, 'water', 0, -4.4, 0.18);
      station(ctx, 'R3', 'seat', 0, 0.52, -4.4, PI);
      station(ctx, 'R3', 'pot', 0, 0.1, -4.4, 0);
      station(ctx, 'R3', 'guide', 1.8, 0, -2.6, PI);
      station(ctx, 'R3', 'spot', 0, 0.52, -4.4, PI);
    },
    // 제4관 맨발걷기 · 헬스: a barefoot loop of 황토, pebbles and sand around three slow strength stations; tall windows
    R4(ctx, R) {
      const Kt = K(), low = ctx.low, rnd = G.util?.rng ? G.util.rng('heal:r4') : Math.random;
      // the loop: an outer rectangle 12 × 17 m, 1.6 m wide, in three stretches of ground
      const ox = 6.0, oz = 8.5, bw = 1.6, y = 0.02;
      const seg = (x0, z0, x1, z1, kind) => {
        const w = Math.abs(x1 - x0) || bw, d = Math.abs(z1 - z0) || bw, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const col = kind === 'clay' ? '#b8743e' : kind === 'sand' ? '#e2cf9e' : '#a59c8c';
        R.add(kind === 'pebble' ? 'stone' : 'clay', slab(w, 0.04, d), M(cx, y, cz), kind === 'clay' ? '#c98a55' : kind === 'sand' ? '#f2e2b4' : '#b9b2a4', { cast: false });
        if (kind === 'pebble') for (let i = 0; i < (low ? 60 : 220); i++) { const s = 0.03 + rnd() * 0.04; R.add('stone', new THREE.DodecahedronGeometry(s, 0), M(cx + (rnd() - 0.5) * (w - 0.1), y + 0.02, cz + (rnd() - 0.5) * (d - 0.1), rnd() * 6, 1.3, 0.55, 1), rnd() < 0.5 ? '#bfb6a6' : '#8f887a', { cast: false }); }
        if (kind === 'sand') for (let i = 0; i < 18; i++) R.add('clay', box(0.4 + rnd() * 0.5, 0.005, 0.02), M(cx + (rnd() - 0.5) * (w - 0.4), y + 0.022, cz + (rnd() - 0.5) * (d - 0.4), rnd() * 3), '#cdb985', { cast: false });
      };
      seg(-ox, -oz, ox, -oz + bw, 'clay'); seg(ox - bw, -oz + bw, ox, oz - bw, 'pebble'); seg(-ox, oz - bw, ox, oz, 'sand'); seg(-ox, -oz + bw, -ox + bw, oz - bw, 'clay');
      // a low wooden kerb around the inside of the loop
      R.add('wood', box(2 * (ox - bw), 0.08, 0.08), M(0, 0.04, -oz + bw + 0.04), '#8a6644'); R.add('wood', box(2 * (ox - bw), 0.08, 0.08), M(0, 0.04, oz - bw - 0.04), '#8a6644');
      R.add('wood', box(0.08, 0.08, 2 * (oz - bw)), M(-ox + bw + 0.04, 0.04, 0), '#8a6644'); R.add('wood', box(0.08, 0.08, 2 * (oz - bw)), M(ox - bw - 0.04, 0.04, 0), '#8a6644');
      // gym1: a rack of wooden dumbbells · gym2: a 철봉-like wooden bar frame · gym3: a mat with stone weights (돌 역기)
      { const x = -2.6, z = -2.5;
        R.add('furn', box(1.2, 0.6, 0.4), M(x, 0.3, z - 0.5), '#8a5a36');
        for (let k = 0; k < 4; k++) { const dx = x - 0.42 + k * 0.28; R.add('iron', cyl(0.016, 0.016, 0.26, 8), M(dx, 0.66, z - 0.5, 0, 1, 1, 1, PI / 2), '#3a3430'); for (const s of [-1, 1]) R.add('furn', cyl(0.05, 0.05, 0.05, 10), M(dx, 0.66, z - 0.5 + s * 0.12, 0, 1, 1, 1, PI / 2), '#6a4428'); }
        ctx.addCollider({ shape: 'box', x, z: z - 0.5, hw: 0.62, hd: 0.22, maxY: 0.8 });
        station(ctx, 'R4', 'gym1', x, 0, z + 0.3, PI); }
      { const x = 0, z = -4.2;
        for (const s of [-1, 1]) R.add('wood', cyl(0.07, 0.08, 2.3, 10), M(x + s * 0.8, 1.15, z), '#9a6a40');
        R.add('wood', cyl(0.025, 0.025, 1.7, 10), M(x, 2.1, z, 0, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(PI / 2)), '#c9ab83');
        for (const s of [-1, 1]) ctx.addCollider({ shape: 'circle', x: x + s * 0.8, z, r: 0.12 });
        station(ctx, 'R4', 'gym2', x, 0, z + 0.6, PI); }
      { const x = 2.6, z = -2.5;
        if (Kt.floorMat) try { Kt.floorMat(R, { x, z, w: 1.0, d: 1.8, tint: '#6a7a5a' }); } catch (e) { /* optional */ }
        for (const s of [-1, 1]) R.add('stone', cyl(0.14, 0.15, 0.1, 12), M(x + s * 0.34, 0.05, z - 0.6, 0, 1, 1, 1, PI / 2), '#8f887a');
        R.add('wood', cyl(0.02, 0.02, 0.9, 8), M(x, 0.05, z - 0.6, 0, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(PI / 2)), '#c9ab83');
        station(ctx, 'R4', 'gym3', x, 0.02, z, PI); }
      // a water jar with a gourd ladle and towels on a peg rail by the door
      if (Kt.pot) try { Kt.pot(R, { x: -6.5, z: 9.6, kind: 'dok', s: 0.8, lid: true }); ctx.addCollider({ shape: 'circle', x: -6.5, z: 9.6, r: 0.38 }); } catch (e) { /* optional */ }
      for (let k = 0; k < 4; k++) R.add('cloth', box(0.3, 0.5, 0.02), M(5.2 + k * 0.42, 1.35, ROOM.d / 2 - 0.06), k % 2 ? '#e6efe8' : '#f4efe4', { cast: false });
      station(ctx, 'R4', 'track', -ox + bw / 2, 0.02, 4.5, PI);
      station(ctx, 'R4', 'guide', 0, 0, 1.6, PI);
      station(ctx, 'R4', 'spot', -ox + bw / 2, 0.02, 4.5, PI);
    },
    // 제5관 족욕관: sixteen staved foot tubs along the north windows in two rows — the back row before a long bench
    // under the glass, the front row with a stool behind each tub, everyone looking out; herbs floating on warm water,
    // steam, kettles on two braziers, towels on a rack and in stacks. [heal-look] The program's tub (0, z0 + 0.95), the
    // bench spot, the kettle and the herb basket stay; the gap west of the program's tub is the way to its bench seat.
    R5(ctx, R) {
      const Kt = K(), low = ctx.low, z0 = -ROOM.d / 2 + 1.3, T = (k, n = 1) => tally('R5', k, n);
      R.add('furn', box(14.4, 0.44, 0.5), M(0, 0.22, z0), '#9a6a40');
      R.add('furn', box(14.6, 0.05, 0.62), M(0, 0.46, z0), '#b8875a');
      ctx.addCollider({ shape: 'box', x: 0, z: z0, hw: 7.2, hd: 0.25, maxY: 0.48, stand: true });
      T('long bench');
      const leaves = (x, z, y) => { for (let k = 0; k < 4; k++) R.add('paint', box(0.06, 0.004, 0.03), M(x + Math.cos(k * 1.7) * 0.14, y, z + Math.sin(k * 1.7) * 0.14, k * 0.8), k % 2 ? '#5f7f3a' : '#7a9a4a', { cast: false }); T('floating herbs'); };
      const rowA = [0, 1.8, -3.6, 3.6, -5.4, 5.4, -6.9, 6.9];
      rowA.forEach((x, i) => {
        const z = z0 + 0.95;
        tub(R, x, z, 1); leaves(x, z, 0.315); T('foot tub');
        ctx.addCollider({ shape: 'circle', x, z, r: 0.36, maxY: 0.42, stand: true });
        if (!low && Kt.steam && i % 2 === 0) try { Kt.steam(R, { x, y: 0.36, z, s: 0.4 }); T('steam'); } catch (e) { /* optional */ }
        if (i < 5) emitter(ctx, 'water', x, z, 0.22);
      });
      // the front row: tubs with a low stool behind each (the visitor sits facing the glass)
      const rowB = [-6.6, -4.9, -3.2, -1.5, 1.5, 3.2, 4.9, 6.6], zb = -4.4;   // (a 1.6 m way between the rows and the brazier)
      rowB.forEach((x, i) => {
        tub(R, x, zb, 1); leaves(x, zb, 0.315); T('foot tub');
        ctx.addCollider({ shape: 'circle', x, z: zb, r: 0.36, maxY: 0.42, stand: true });
        R.add('furn', box(0.42, 0.06, 0.32), M(x, 0.36, zb + 0.72), '#b8875a'); for (const s of [-1, 1]) R.add('furn', box(0.06, 0.33, 0.28), M(x + s * 0.17, 0.165, zb + 0.72), '#8a5f3c', { cast: false });
        ctx.addCollider({ shape: 'box', x, z: zb + 0.72, hw: 0.21, hd: 0.16, maxY: 0.4, stand: true }); T('stool');
        R.add('cloth', box(0.3, 0.05, 0.22), M(x + 0.32, 0.03, zb + 0.72), '#f4efe4', { cast: false }); T('towel');
        if (!low && Kt.steam && i % 3 === 1) try { Kt.steam(R, { x, y: 0.36, z: zb, s: 0.36 }); T('steam'); } catch (e) { /* optional */ }
      });
      // the kettle on a little brazier and a basket of herbs (the program's), a second brazier with a kettle in the west
      const kettle = (x, y, z) => {
        R.add('brass', new THREE.SphereGeometry(0.13, 12, 8), M(x, y + 0.11, z, 0, 1, 0.8, 1), '#b08a4a');
        R.add('brass', cyl(0.018, 0.03, 0.2, 6), M(x + 0.15, y + 0.15, z, 0, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.9)), '#b08a4a', { cast: false });
        R.add('iron', new THREE.TorusGeometry(0.09, 0.008, 4, 12, PI), M(x, y + 0.2, z), '#3a3430', { cast: false });
        T('kettle');
      };
      if (Kt.pot) try { Kt.pot(R, { x: 1.3, z: z0 + 2.4, kind: 'brazier', s: 0.8 }); Kt.pot(R, { x: 1.3, y: 0.38, z: z0 + 2.4, kind: 'sot', s: 0.42 }); T('brazier'); } catch (e) { /* optional */ }
      if (Kt.basket) try { Kt.basket(R, { x: 2.5, z: z0 + 2.4, r: 0.28, h: 0.18, kind: 'round' }); for (let k = 0; k < 6; k++) R.add('paint', new THREE.ConeGeometry(0.03, 0.22, 5), M(2.5 + (k - 2.5) * 0.06, 0.22, z0 + 2.4, k, 1, 1, 1, 1.2), '#6f8a4a', { cast: false }); T('herb basket'); } catch (e) { /* optional */ }
      ctx.addCollider({ shape: 'circle', x: 1.9, z: z0 + 2.4, r: 0.75, maxY: 0.6 });
      if (Kt.pot) try { Kt.pot(R, { x: -6.6, z: -1.6, kind: 'brazier', s: 0.8 }); kettle(-6.6, 0.36, -1.6); for (let k = 0; k < 5; k++) R.add('glow', new THREE.DodecahedronGeometry(0.035, 0), M(-6.6 + Math.cos(k) * 0.08, 0.3, -1.6 + Math.sin(k) * 0.08, k), '#ff7a2a', { cast: false }); ctx.addCollider({ shape: 'circle', x: -6.6, z: -1.6, r: 0.4, maxY: 0.6 }); T('brazier'); } catch (e) { /* optional */ }
      // a low table with spare kettles and cups by the second brazier
      R.add('furn', box(0.8, 0.04, 0.5), M(-6.6, 0.4, -0.4), '#8a5a36'); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) R.add('furn', box(0.04, 0.4, 0.04), M(-6.6 + a * 0.36, 0.2, -0.4 + b * 0.21), '#6a4428', { cast: false });
      kettle(-6.8, 0.42, -0.4); for (let k = 0; k < 3; k++) { R.add('onggi', cyl(0.035, 0.03, 0.06, 8), M(-6.45 + k * 0.09, 0.45, -0.3), '#e8e2d6', { cast: false }); T('cup'); }
      ctx.addCollider({ shape: 'box', x: -6.6, z: -0.4, hw: 0.4, hd: 0.25, maxY: 0.45 }); T('table');
      // a towel rack on the east wall: three bars with towels hanging over them, and towel stacks by the door
      { const x = 7.05, z = -1.2;
        for (const s of [-1, 1]) R.add('wood', box(0.05, 1.3, 0.05), M(x, 0.65, z + s * 0.75), '#7a5234');
        for (let k = 0; k < 3; k++) { R.add('wood', cyl(0.015, 0.015, 1.5, 6), M(x - 0.06 * k, 0.55 + k * 0.32, z, 0, 1, 1, 1, PI / 2), '#9a6a40', { cast: false }); for (let j = 0; j < 3; j++) R.add('cloth', box(0.02, 0.42, 0.34), M(x - 0.06 * k, 0.38 + k * 0.32, z - 0.45 + j * 0.45), j % 2 ? '#e6efe8' : '#f4efe4', { cast: false }); }
        ctx.addCollider({ shape: 'box', x, z, hw: 0.2, hd: 0.8, maxY: 1.3 }); T('towel rack'); T('towel', 9); }
      for (const x of [-4.5, 4.5]) for (let k = 0; k < 5; k++) R.add('cloth', box(0.36, 0.06, 0.28), M(x, 0.48 + k * 0.065, ROOM.d / 2 - 0.9), '#f4efe4');
      T('towel', 10);
      if (Kt.screen) try { Kt.screen(R, { x: -6.4, z: 3.2, rotY: PI / 2, panels: 6, h: 1.5 }); T('screen'); } catch (e) { /* optional */ }
      for (const [px, pz] of [[-6.6, 6.6], [6.6, 6.0]]) { plant(R, ctx, px, pz, 1.0); T('plant'); }
      bench(R, ctx, -3.0, 7.2); bench(R, ctx, 3.0, 7.2); T('bench', 2);
      station(ctx, 'R5', 'tub', 0, 0.12, z0 + 0.95, PI);
      station(ctx, 'R5', 'kettle', 1.3, 0.62, z0 + 2.4, 0);
      station(ctx, 'R5', 'herbs', 2.5, 0.3, z0 + 2.4, 0);
      station(ctx, 'R5', 'guide', 0.8, 0, z0 + 1.7, PI);
      station(ctx, 'R5', 'spot', 0, 0.47, z0, PI);
    },
    // 제6관 발마사지관: low light, folding screens without written characters, a reclining chair and a stool
    R6(ctx, R) { calmRoom(ctx, R, 'R6', 'chair'); },
    // 제7관 얼굴마사지관: a padded bed with a face cradle, a towel warmer
    R7(ctx, R) { calmRoom(ctx, R, 'R7', 'face'); },
    // 제8관 바디마사지관: a broad bed under a blanket, oil bottles on a little table
    R8(ctx, R) { calmRoom(ctx, R, 'R8', 'body'); },
    // 제9관 스트레스 해소관: a sturdy workshop — thick mats, nets, racks of plates, steel drums, cans, bottles, a gear shelf
    R9(ctx, R) {
      const Kt = K(), low = ctx.low, rnd = G.util?.rng ? G.util.rng('heal:r9') : Math.random;
      // thick mats in the middle (the striking floor) and a painted box where the visitor stands
      R.add('paint', box(9, 0.08, 7), M(0, 0.04, -3.5), '#3f5a4a', { cast: false });
      for (let i = 1; i < 6; i++) R.add('paint', box(0.03, 0.082, 7), M(-4.5 + i * 1.5, 0.041, -3.5), '#2f4538', { cast: false });
      R.add('paint', box(1.4, 0.084, 0.06), M(0, 0.042, -0.9), '#e8c23a', { cast: false }); R.add('paint', box(1.4, 0.084, 0.06), M(0, 0.042, -2.2), '#e8c23a', { cast: false });
      // nets on three sides of the striking floor (posts + a net texture of its own)
      const netTex = canvasTex(256, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(40,40,40,0.85)'; c.lineWidth = 3; for (let k = 0; k <= 16; k++) { c.beginPath(); c.moveTo(k * w / 16, 0); c.lineTo(k * w / 16, h); c.stroke(); c.beginPath(); c.moveTo(0, k * h / 16); c.lineTo(w, k * h / 16); c.stroke(); } });
      netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(4, 1.4);
      ctx.own(netTex);
      const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
      ctx.own(netMat);
      for (const [x, z, ry, len] of [[0, -7.6, 0, 9.4], [-4.7, -3.5, PI / 2, 8.2], [4.7, -3.5, PI / 2, 8.2]]) {
        const g = new THREE.PlaneGeometry(len, 2.8); ctx.own(g);
        const net = new THREE.Mesh(g, netMat); net.position.set(x, 1.45, z); net.rotation.y = ry; net.name = 'heal-net'; net.userData.guardSkip = true; net.raycast = () => {};
        R.addMesh(net, null);
      }
      for (const [x, z] of [[-4.7, -7.6], [4.7, -7.6], [-4.7, 0.6], [4.7, 0.6]]) { R.add('iron', cyl(0.05, 0.05, 3.0, 8), M(x, 1.5, z), '#3a3f44'); ctx.addCollider({ shape: 'circle', x, z, r: 0.12 }); }
      ctx.addCollider({ shape: 'box', x: 0, z: -7.7, hw: 4.7, hd: 0.06 });
      // the targets, on low stands along the back net: plates on a rack, steel drums, a pyramid of cans, bottles on a board
      { const x = -3.2, z = -6.6;
        R.add('furn', box(1.6, 1.0, 0.36), M(x, 0.5, z), '#6a4a30');
        for (let k = 0; k < 7; k++) R.add('paint', cyl(0.11, 0.09, 0.015, 16), M(x - 0.6 + k * 0.2, 1.11, z, 0, 1, 1, 1, PI / 2 - 0.2), '#f1efe8');
        ctx.addCollider({ shape: 'box', x, z, hw: 0.8, hd: 0.2, maxY: 1.2 });
        station(ctx, 'R9', 'plates', x, 1.0, z, 0); }
      { const x = -1.1, z = -6.5;
        for (let k = 0; k < 2; k++) { const dx = x + k * 0.72; R.add('iron', cyl(0.29, 0.29, 0.88, 18), M(dx, 0.44, z), k ? '#3e6a8a' : '#4d5d6c'); for (const yy of [0.18, 0.44, 0.7]) R.add('iron', cyl(0.3, 0.3, 0.03, 18), M(dx, yy, z), '#5a6773'); ctx.addCollider({ shape: 'circle', x: dx, z, r: 0.31, maxY: 0.9 }); }
        station(ctx, 'R9', 'drums', x + 0.36, 0, z, 0); }
      { const x = 1.3, z = -6.6;
        R.add('furn', box(1.2, 0.6, 0.5), M(x, 0.3, z), '#6a4a30');
        const can = (cx, cy, c) => R.add('iron', cyl(0.045, 0.045, 0.13, 12), M(cx, cy, z), c);
        let n = 0; for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) can(x - 0.15 * (3 - row) / 2 * 1 + k * 0.1 - 0.0, 0.665 + row * 0.13, ['#c43b33', '#d9a43a', '#3c7f5a', '#2f5a8a'][(n++) % 4]);
        ctx.addCollider({ shape: 'box', x, z, hw: 0.6, hd: 0.26, maxY: 1.0 });
        station(ctx, 'R9', 'cans', x, 0.6, z, 0); }
      { const x = 3.4, z = -6.6;
        R.add('furn', box(1.3, 0.9, 0.36), M(x, 0.45, z), '#6a4a30');
        for (let k = 0; k < 6; k++) { const bx = x - 0.5 + k * 0.2; R.add('lacquer', cyl(0.035, 0.04, 0.2, 10), M(bx, 1.0, z), k % 3 === 0 ? '#2f6a3a' : k % 3 === 1 ? '#6a3f1f' : '#9fb8b0'); R.add('lacquer', cyl(0.015, 0.025, 0.08, 8), M(bx, 1.14, z), k % 3 === 0 ? '#2f6a3a' : k % 3 === 1 ? '#6a3f1f' : '#9fb8b0'); }
        ctx.addCollider({ shape: 'box', x, z, hw: 0.66, hd: 0.2, maxY: 1.2 });
        station(ctx, 'R9', 'bottles', x, 0.9, z, 0); }
      // the refill rack on the east wall: shelves stacked with plates, cans and bottles; the gear shelf by the door
      if (Kt.shelf) try {
        const sp = Kt.shelf(R, { x: 6.7, z: 3.4, rotY: -PI / 2, w: 2.4, d: 0.45, h: 1.9, levels: 4 }) || [];
        sp.forEach((p, i) => { for (let k = 0; k < 4; k++) R.add(i % 2 ? 'iron' : 'paint', cyl(i % 2 ? 0.045 : 0.1, i % 2 ? 0.045 : 0.09, i % 2 ? 0.13 : 0.02, 12), M(p.x, p.y + (i % 2 ? 0.07 : 0.012 + k * 0.022), p.z - 0.8 + (i % 2 ? k * 0.4 : 0.8)), i % 2 ? '#8a8f94' : '#f1efe8'); });
        ctx.addCollider({ shape: 'box', x: 6.7, z: 3.4, hw: 0.24, hd: 1.22, maxY: 2.0 });
      } catch (e) { /* optional */ }
      station(ctx, 'R9', 'rack', 6.1, 0, 3.4, -PI / 2);
      { const x = -6.7, z = 7.4;
        R.add('furn', box(0.42, 1.8, 2.0), M(x, 0.9, z), '#5a3c26');
        for (let k = 0; k < 4; k++) { R.add('paint', box(0.2, 0.06, 0.14), M(x + 0.25, 1.62, z - 0.7 + k * 0.45), '#2a2f33'); R.add('lacquer', box(0.04, 0.05, 0.12), M(x + 0.34, 1.63, z - 0.7 + k * 0.45), '#cfe6f2'); }
        for (let k = 0; k < 4; k++) R.add('cloth', box(0.08, 0.2, 0.14), M(x + 0.27, 1.25, z - 0.7 + k * 0.45), '#c9a24a');
        for (let k = 0; k < 3; k++) R.add('cloth', box(0.04, 0.8, 0.5), M(x + 0.25, 0.55, z - 0.55 + k * 0.55), ['#2f4a6a', '#6a3a2a', '#3a5a3a'][k]);
        ctx.addCollider({ shape: 'box', x, z, hw: 0.22, hd: 1.0, maxY: 1.9 });
        station(ctx, 'R9', 'gear', x + 0.9, 0, z, PI / 2); }
      // the wooden bats on a wall rack
      for (let k = 0; k < 4; k++) R.add('wood', cyl(0.022, 0.04, 0.84, 8), M(-6.75, 1.0, -1.0 + k * 0.3, 0, 1, 1, 1, 0.08), '#c9a273');
      // bright work lamps
      for (const x of [-3, 3]) R.add('glow', box(1.6, 0.06, 0.3), M(x, ROOM.ceil - 0.05, -3.5), '#fff6e6', { cast: false });
      if (!low) ctx.light({ x: 0, y: ROOM.ceil - 0.4, z: -3.5, color: 0xfff1dc, intensity: 6, distance: 16, decay: 2, day: 0.4 });
      station(ctx, 'R9', 'stand', 0, 0.08, -1.55, PI);
      station(ctx, 'R9', 'guide', 3.6, 0, 1.4, -PI / 2 - 0.4);
      station(ctx, 'R9', 'spot', 0, 0.08, -1.55, PI);
    },
    // 제10관 임종체험관 / 마음 돌아보기: quiet — a portrait corner, a writing desk under a lamp, a plain coffin on a low
    // stand in a soft pool of light (the full version only), a resting mat under a ceiling of small star lights
    R10(ctx, R) {
      const Kt = K(), low = ctx.low, rnd = G.util?.rng ? G.util.rng('heal:r10') : Math.random;
      // the portrait corner: a grey cloth backdrop on a frame, a stool, a camera on a tripod, a soft box light
      { const x = -4.6, z = -8.4;
        R.add('wood', cyl(0.025, 0.025, 2.4, 8), M(x - 1.3, 1.2, z), '#3a3430'); R.add('wood', cyl(0.025, 0.025, 2.4, 8), M(x + 1.3, 1.2, z), '#3a3430');
        R.add('cloth', box(2.6, 2.3, 0.02), M(x, 1.2, z + 0.03), '#8f949a', { cast: false });
        R.add('furn', cyl(0.2, 0.22, 0.46, 12), M(x, 0.23, z + 1.1), '#6a4428');
        const cz = z + 3.6;
        for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; R.add('iron', cyl(0.012, 0.012, 1.3, 6), M(x + Math.cos(a) * 0.22, 0.62, cz + Math.sin(a) * 0.22, a, 1, 1, 1, 0.18), '#2a2a2a'); }
        R.add('iron', box(0.22, 0.14, 0.12), M(x, 1.28, cz), '#1f2226'); R.add('lacquer', cyl(0.045, 0.05, 0.12, 12), M(x, 1.28, cz - 0.11, 0, 1, 1, 1, PI / 2), '#2c3036');
        R.add('paint', box(0.6, 0.6, 0.05), M(x + 1.5, 1.7, z + 2.0, -0.6), '#f6f4ee', { cast: false }); R.add('iron', cyl(0.015, 0.015, 1.7, 6), M(x + 1.5, 0.85, z + 2.05), '#2a2a2a');
        ctx.addCollider({ shape: 'circle', x, z: cz, r: 0.3 });
        station(ctx, 'R10', 'studio', x, 0.46, z + 1.1, 0);
        station(ctx, 'R10', 'camera', x, 1.28, cz, PI); }
      // the writing desk (서안) under a lamp: paper, a brush, an ink stone
      { const x = 4.6, z = -7.6;
        if (Kt.table) try { Kt.table(R, { x, z, w: 1.1, d: 0.5, h: 0.34, legs: 'curved' }); } catch (e) { /* optional */ }
        R.add('hanji', box(0.42, 0.004, 0.3), M(x - 0.1, 0.345, z), '#f4ead3', { cast: false });
        R.add('stone', box(0.14, 0.03, 0.2), M(x + 0.38, 0.355, z), '#2a2826');
        R.add('wood', cyl(0.006, 0.006, 0.22, 6), M(x + 0.24, 0.35, z + 0.05, 0.3, 1, 1, 1, PI / 2), '#6a4428');
        if (Kt.cushion) try { Kt.cushion(R, { x, z: z + 0.75, tint: '#5a5048', trim: '#a8946a' }); } catch (e) { /* optional */ }
        if (Kt.deungjan) try { Kt.deungjan(R, { x: x + 0.75, z: z - 0.15, h: 0.45 }); if (!low && Kt.lamp) Kt.lamp(R, { x: x + 0.75, y: 0.47, z: z - 0.15, s: 0.45, intensity: 2.2, distance: 5 }); } catch (e) { /* optional */ }
        ctx.addCollider({ shape: 'box', x, z, hw: 0.56, hd: 0.26, maxY: 0.36 });
        station(ctx, 'R10', 'desk', x, 0.09, z + 0.75, PI); }
      // the coffin: plain pine on a low stand, the lid beside it, in a soft pool of light (hidden in the gentle version)
      const coffin = new THREE.Group(); coffin.name = 'heal-r10-coffin';
      { const x = 0, z = -3.4;
        const cw = ctx.own(new THREE.MeshStandardMaterial({ color: 0xd8bf96, roughness: 0.72 }));
        const dk = ctx.own(new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.8 }));
        const add = (g, m, px, py, pz, ry = 0) => { ctx.own(g); const me = new THREE.Mesh(g, m); me.position.set(px, py, pz); me.rotation.y = ry; me.castShadow = !low; me.receiveShadow = true; coffin.add(me); return me; };
        add(box(0.9, 0.24, 2.2), dk, x, 0.12, z);
        const t = 0.04, L = 2.0, Wd = 0.62, Hh = 0.46, y0 = 0.24;
        add(box(Wd, t, L), cw, x, y0 + t / 2, z);
        for (const s of [-1, 1]) add(box(t, Hh, L), cw, x + s * (Wd / 2 - t / 2), y0 + Hh / 2, z);
        for (const s of [-1, 1]) add(box(Wd, Hh, t), cw, x, y0 + Hh / 2, z + s * (L / 2 - t / 2));
        add(box(Wd + 0.04, 0.05, L + 0.04), cw, x + 0.95, 0.025 + 0.2, z, 0.04).rotation.z = 0.0;
        add(box(0.7, 0.2, 2.1), dk, x + 0.95, 0.1, z, 0.04);
        R.addMesh(coffin, null);
        ctx.addCollider({ shape: 'box', x: x + 0.45, z, hw: 0.95, hd: 1.1, maxY: 0.72, stand: true });
        if (!low) ctx.light({ x, y: ROOM.ceil - 0.3, z, color: 0xffe2b8, intensity: 4.2, distance: 6.5, decay: 2, day: 0.5 });
        // the soft pool on the floor (a faint additive disc)
        const pg = new THREE.CircleGeometry(1.8, 32); pg.rotateX(-PI / 2); pg.translate(x, 0.01, z); ctx.own(pg);
        const pm = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }); ctx.own(pm);
        const pool = new THREE.Mesh(pg, pm); pool.name = 'heal-r10-pool'; pool.userData.guardSkip = true; pool.raycast = () => {}; R.addMesh(pool, null);
        coffin.userData.pool = pool;
        station(ctx, 'R10', 'coffin', x, y0 + t, z, PI); }
      // the resting mat (gentle version) under small star lights on the ceiling
      { const x = 0, z = 3.0;
        if (Kt.floorMat) try { Kt.floorMat(R, { x, z, w: 1.2, d: 2.2, tint: '#7a8aa0' }); } catch (e) { /* optional */ }
        if (Kt.cushion) try { Kt.cushion(R, { x, z: z - 0.85, w: 0.5, d: 0.3, h: 0.12, tint: '#e9e6dc', trim: '#9aa7b8' }); } catch (e) { /* optional */ }
        const n = low ? 60 : 160, pos = [];
        for (let i = 0; i < n; i++) pos.push((rnd() - 0.5) * 9, ROOM.ceil - 0.02, z + (rnd() - 0.5) * 9);
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ctx.own(sg);
        const sm = new THREE.PointsMaterial({ color: 0xfff2d0, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }); ctx.own(sm);
        const stars = new THREE.Points(sg, sm); stars.name = 'heal-r10-stars'; stars.userData.guardSkip = true; stars.raycast = () => {}; R.addMesh(stars, null);
        ctx.onUpdate((dt, t) => { if (!still()) sm.opacity = 0.75 + 0.2 * Math.sin(t * 0.6); });
        station(ctx, 'R10', 'rest', x, 0.04, z, PI); }
      if (Kt.screen) try { Kt.screen(R, { x: -6.4, z: 0, rotY: PI / 2, panels: 8, h: 1.7 }); } catch (e) { /* optional */ }
      for (const [x, z] of [[-6.4, 6], [6.4, 6]]) { if (Kt.jwadeung) try { Kt.jwadeung(R, { x, z, h: 0.9 }); } catch (e) { /* optional */ } }
      const setGentle = (g) => { coffin.visible = !g; if (coffin.userData.pool) coffin.userData.pool.visible = !g; };
      setGentle(gentle());
      room10Live = { coffin, setGentle };
      station(ctx, 'R10', 'guide', 1.8, 0, 0.4, PI);
      station(ctx, 'R10', 'spot', 0, 0, 1.0, PI);
    },
  };
  /** 제6관 · 제7관 · 제8관: calm rooms full of guests' places — rows of chairs or beds, each with its own table, low
   *  folding screens without written characters, soft paper lamps. [heal-look] The program's own chair / bed stays at
   *  (0, −4.2) with its stations exactly where they were; the rows are built around it (one merged mesh per material). */
  function calmRoom(ctx, R, key, kind) {
    const Kt = K(), low = ctx.low, x = 0, z = -4.2;
    const T = (kind_, n = 1) => tally(key, kind_, n);
    const scr = (sx, sz, ry, panels, h, collide = true) => {
      if (!Kt.screen) return;
      try { Kt.screen(R, { x: sx, z: sz, rotY: ry, panels, h }); T('screen'); } catch (e) { return; }
      if (collide) { const half = panels * 0.45 * Math.cos(0.35) / 2; ctx.addCollider({ shape: 'box', x: sx, z: sz, hw: Math.abs(Math.sin(ry)) > 0.5 ? 0.12 : half, hd: Math.abs(Math.sin(ry)) > 0.5 ? half : 0.12, maxY: h }); }
    };
    const bowl = (bx, by, bz, c = '#6a3f22', r = 0.07) => { R.add('onggi', cyl(r, r * 0.6, r * 0.7, 10), M(bx, by + r * 0.35, bz), c, { cast: false }); R.add('lacquer', new THREE.CircleGeometry(r * 0.85, 10), M(bx, by + r * 0.66, bz, 0, 1, 1, 1, -PI / 2), '#c99a3a', { cast: false }); T('bowl'); };
    const bottle = (bx, by, bz, c = '#7a4a22') => { R.add('lacquer', cyl(0.035, 0.04, 0.16, 8), M(bx, by + 0.08, bz), c, { cast: false }); R.add('lacquer', cyl(0.012, 0.02, 0.06, 6), M(bx, by + 0.19, bz), c, { cast: false }); T('oil bottle'); };
    const towel = (tx, ty, tz, ry = 0, c = '#f6f2e8') => { R.add('cloth', box(0.34, 0.06, 0.26), M(tx, ty + 0.03, tz, ry), c, { cast: false }); R.add('cloth', cyl(0.035, 0.035, 0.3, 8), M(tx, ty + 0.095, tz, ry, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(PI / 2)), c, { cast: false }); T('towel'); };
    const table = (tx, tz, top = 0.46, w = 0.44, d = w) => {
      R.add('furn', box(w, 0.035, d), M(tx, top, tz), '#8a5a36');
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) R.add('furn', box(0.035, top, 0.035), M(tx + a * (w / 2 - 0.03), top / 2, tz + b * (d / 2 - 0.03)), '#6a4428', { cast: false });
      ctx.addCollider({ shape: 'box', x: tx, z: tz, hw: w / 2, hd: d / 2, maxY: top + 0.05 });
      T('table'); return top + 0.018;
    };
    const vase = (vx, vy, vz, petal = '#f3d6dc') => {
      R.add('onggi', cyl(0.035, 0.05, 0.16, 8), M(vx, vy + 0.08, vz), '#e8e2d6', { cast: false });
      for (let k = 0; k < 5; k++) { const a = k * 1.3; R.add('paint', cyl(0.004, 0.004, 0.18, 4), M(vx + Math.cos(a) * 0.02, vy + 0.24, vz + Math.sin(a) * 0.02, 0, 1, 1, 1, 0.2 * Math.cos(a)), '#4f7a3a', { cast: false }); R.add('paint', new THREE.SphereGeometry(0.03, 6, 4), M(vx + Math.cos(a) * 0.05, vy + 0.33 + (k % 2) * 0.03, vz + Math.sin(a) * 0.05), k % 2 ? petal : '#ffffff', { cast: false }); }
      T('flowers');
    };
    const floorLamp = (lx, lz) => { R.add('furn', box(0.26, 0.04, 0.26), M(lx, 0.02, lz), '#5a3c26', { cast: false }); R.add('glow', box(0.2, 0.32, 0.2), M(lx, 0.2, lz), '#ffd9a0', { cast: false }); R.add('wood', box(0.24, 0.03, 0.24), M(lx, 0.375, lz), '#6a4428', { cast: false }); T('floor lamp'); };
    const paperLamp = (lx, lz, light) => { if (!Kt.jwadeung) return; try { Kt.jwadeung(R, { x: lx, z: lz, h: 0.9 }); T('paper lamp'); if (light && !low && Kt.lamp) Kt.lamp(R, { x: lx, y: 0.75, z: lz, s: 0.5, intensity: 2.2, distance: 7 }); } catch (e) { /* optional */ } };
    const runner = (rx, rz, w, d, tint) => { if (Kt.floorMat) try { Kt.floorMat(R, { x: rx, z: rz, w, d, tint }); T('mat'); } catch (e) { /* optional */ } };

    if (kind === 'chair') {
      // 제6관 발마사지관: eleven reclining chairs in two rows facing the garden side (south), a foot stool before each,
      // a low table with oil bowls and a rolled towel beside it, low screens between the chairs of the front row
      const chair = (cx, cz, side) => {
        R.add('furn', box(0.8, 0.36, 1.0), M(cx, 0.18, cz), '#6a4428');
        R.add('cloth', box(0.72, 0.12, 0.9), M(cx, 0.42, cz + 0.05), '#cdbfa5');
        R.add('cloth', box(0.72, 0.1, 0.9), M(cx, 0.75, cz - 0.55, 0, 1, 1, 1, -0.95), '#cdbfa5');
        R.add('cloth', box(0.6, 0.1, 0.55), M(cx, 0.38, cz + 0.8, 0, 1, 1, 1, 0.25), '#cdbfa5');
        R.add('cloth', box(0.5, 0.08, 0.2), M(cx, 1.02, cz - 0.86, 0, 1, 1, 1, -0.95), '#f4efe4', { cast: false });
        for (const s of [-1, 1]) R.add('furn', box(0.07, 0.05, 0.78), M(cx + s * 0.42, 0.56, cz - 0.05), '#7a5234');
        ctx.addCollider({ shape: 'box', x: cx, z: cz + 0.1, hw: 0.42, hd: 1.0, maxY: 0.6, stand: true });
        R.add('furn', cyl(0.2, 0.22, 0.42, 12), M(cx, 0.21, cz + 1.6), '#7a5234');
        R.add('cloth', cyl(0.19, 0.19, 0.04, 12), M(cx, 0.44, cz + 1.6), '#e9e1cf', { cast: false });
        ctx.addCollider({ shape: 'circle', x: cx, z: cz + 1.6, r: 0.22, maxY: 0.44, stand: true });
        T('chair'); T('foot stool');
        if (side) { const tx = cx + side * 0.86, ty = table(tx, cz + 0.3); bowl(tx - 0.08, ty, cz + 0.22); bowl(tx + 0.1, ty, cz + 0.34, '#5a3a22', 0.055); bottle(tx - 0.1, ty, cz + 0.44); towel(tx + 0.04, ty, cz + 0.12, PI / 2); }
      };
      for (const cx of [-5.6, -2.8, 2.8, 5.6]) chair(cx, z, cx < 0 ? -1 : 1);
      chair(x, z, -1);
      R.add('cloth', box(0.36, 0.06, 0.28), M(x + 0.9, 0.5, z + 0.6), '#f4efe4');
      for (const cx of [-6.4, -4.15, -1.9, 1.9, 4.15, 6.4]) chair(cx, 1.0, Math.abs(cx) < 6 ? Math.sign(cx) * 1.0 : 0);
      for (const sx of [-4.2, 4.2]) scr(sx, z - 0.2, PI / 2, 3, 1.15);
      scr(x, z - 2.6, 0, 6, 1.7); scr(-4.4, z - 2.4, 0, 6, 1.7); scr(4.4, z - 2.4, 0, 6, 1.7);
      runner(0, z + 0.6, 13.4, 3.4, '#b39a6a'); runner(0, 1.6, 14.2, 3.6, '#a8906a');
      // a towel warmer by the west wall: a cabinet with a warm glow behind its lattice and rolled towels inside
      { const wx = -6.95, wz = -9.0;
        R.add('furn', box(0.5, 1.3, 1.0), M(wx, 0.65, wz), '#6a4428');
        R.add('glow', box(0.02, 0.9, 0.8), M(wx + 0.26, 0.75, wz), '#ffcf96', { cast: false });
        for (let k = 0; k < 8; k++) R.add('cloth', cyl(0.045, 0.045, 0.3, 8), M(wx + 0.22, 0.45 + Math.floor(k / 4) * 0.4, wz - 0.3 + (k % 4) * 0.2, 0, 1, 1, 1, PI / 2), '#f8f5ee', { cast: false });
        ctx.addCollider({ shape: 'box', x: wx, z: wz, hw: 0.26, hd: 0.5, maxY: 1.35 }); T('towel warmer'); }
      for (const [px, pz, s] of [[-6.6, -10.2, 1.1], [6.6, -10.2, 1.1], [-2.2, -10.3, 0.9], [2.2, -10.3, 0.9], [-6.8, 4.6, 1.0], [6.8, 4.6, 1.0]]) { plant(R, ctx, px, pz, s); T('plant'); }
      for (const [lx, lz] of [[-6.9, -1.8], [6.9, -1.8], [6.4, 8]]) paperLamp(lx, lz, true);
      for (const lx of [-4.2, -1.4, 1.4, 4.2]) floorLamp(lx, z + 1.1);
      station(ctx, key, 'chair', x, 0.48, z, PI);
      station(ctx, key, 'stool', x, 0.42, z + 1.6, PI);
      station(ctx, key, 'guide', x, 0, z + 2.1, PI);
      station(ctx, key, 'spot', x, 0.48, z, PI);
    } else {
      // a padded bed: a wooden frame, a mattress under a white sheet, a pillow (a face cradle for the face room)
      const L = kind === 'body' ? 2.1 : 2.0, Wd = kind === 'body' ? 0.95 : 0.85;
      const bed = (bx, bz, ry = 0) => {
        const m = (dx, dy, dz) => M(bx + Math.cos(ry) * dx + Math.sin(ry) * dz, dy, bz - Math.sin(ry) * dx + Math.cos(ry) * dz, ry);
        R.add('furn', box(Wd, 0.5, L), m(0, 0.25, 0), '#6a4428');
        R.add('cloth', box(Wd - 0.04, 0.14, L - 0.04), m(0, 0.57, 0), '#efe9dc');
        R.add('cloth', box(Wd + 0.02, 0.02, L * 0.55), m(0, 0.645, L * 0.18), kind === 'body' ? '#9aa98a' : '#d8cdb8');
        R.add('cloth', box(Wd + 0.03, 0.2, 0.012), m(0, 0.52, L * 0.18 + L * 0.275), kind === 'body' ? '#9aa98a' : '#d8cdb8', { cast: false });
        if (kind === 'face') R.add('cloth', cyl(0.18, 0.2, 0.1, 16), m(0, 0.69, -L / 2 + 0.25), '#ffffff');
        else R.add('cloth', box(0.5, 0.1, 0.3), m(0, 0.69, -L / 2 + 0.25), '#ffffff');
        const hw = Math.abs(Math.cos(ry)) > 0.5 ? Wd / 2 + 0.02 : L / 2, hd = Math.abs(Math.cos(ry)) > 0.5 ? L / 2 : Wd / 2 + 0.02;
        ctx.addCollider({ shape: 'box', x: bx, z: bz, hw, hd, maxY: 0.66, stand: true });
        T('bed');
      };
      const tray = (tx, ty, tz) => {   // a brass tray with three bowls and a hand mirror
        R.add('brass', cyl(0.17, 0.16, 0.015, 14), M(tx, ty + 0.008, tz), '#c9a24a', { cast: false });
        bowl(tx - 0.07, ty + 0.015, tz - 0.05, '#e8e2d6', 0.045); bowl(tx + 0.06, ty + 0.015, tz - 0.06, '#d9c9a8', 0.04); bowl(tx, ty + 0.015, tz + 0.07, '#efe6d6', 0.04);
        R.add('lacquer', cyl(0.055, 0.055, 0.01, 14), M(tx + 0.2, ty + 0.02, tz + 0.05, 0.4, 1, 1, 1, 0), '#2a2422', { cast: false });
        R.add('lacquer', cyl(0.045, 0.045, 0.004, 14), M(tx + 0.2, ty + 0.027, tz + 0.05), '#dfe8ee', { cast: false });
        R.add('lacquer', box(0.022, 0.01, 0.09), M(tx + 0.2 + 0.03, ty + 0.02, tz + 0.05 + 0.1, 0.3), '#2a2422', { cast: false });
        T('tray'); T('hand mirror');
      };
      if (kind === 'face') {
        // 제7관 얼굴마사지관: nine padded beds in two rows, heads to the north; a stool at each head for the keeper,
        // a tray of bowls with a hand mirror and a vase of flowers on a little table beside each bed
        // (the tables stand between the beds; the west and east aisles and the one west of the program's bed stay free)
        const rowA = [-5.2, -2.6, 2.6, 5.2], rowB = [-5.0, -2.2, 2.2, 5.0];
        bed(x, z);
        for (const bx of rowA) bed(bx, z);
        for (const bx of rowB) bed(bx, 1.8);
        // one table between two beds: a tray (bowls and a hand mirror) for each of them and a vase of flowers
        const side = (tx, bz, s) => { const ty = table(tx, bz - 0.4, 0.62, 0.5, 0.9); tray(tx - 0.02, ty, bz - 0.62); tray(tx - 0.02, ty, bz - 0.2); vase(tx + 0.17, ty, bz - 0.41, s > 0 ? '#f3d6dc' : '#f6e7b0'); };
        for (const tx of [-3.9, 3.9]) side(tx, z, Math.sign(tx));
        for (const tx of [-3.6, 3.6]) side(tx, 1.8, Math.sign(tx));
        for (const bx of rowA) { R.add('furn', cyl(0.19, 0.2, 0.46, 12), M(bx, 0.23, z - L / 2 - 0.55), '#7a5234'); ctx.addCollider({ shape: 'circle', x: bx, z: z - L / 2 - 0.55, r: 0.2, maxY: 0.48, stand: true }); T('stool'); }
        for (const bx of rowB) { R.add('furn', cyl(0.19, 0.2, 0.46, 12), M(bx, 0.23, 1.8 - L / 2 - 0.55), '#7a5234'); ctx.addCollider({ shape: 'circle', x: bx, z: 1.8 - L / 2 - 0.55, r: 0.2, maxY: 0.48, stand: true }); T('stool'); }
        // the program's own bed: its little table (as before) with bowls, a tray and flowers
        R.add('furn', box(0.5, 0.75, 0.4), M(x + 1.4, 0.375, z - 0.4), '#7a5234');
        if (Kt.pot) for (let k = 0; k < 3; k++) try { Kt.pot(R, { x: x + 1.27 + k * 0.13, y: 0.75, z: z - 0.4, kind: 'bowl', s: 0.34, mat: 'onggi' }); } catch (e) { /* optional */ }
        vase(x + 1.4, 0.75, z - 0.25);
        ctx.addCollider({ shape: 'box', x: x + 1.4, z: z - 0.4, hw: 0.26, hd: 0.22, maxY: 0.8 });
        R.add('furn', box(0.9, 1.1, 0.45), M(-5.8, 0.55, -9.9), '#7a5234');
        for (let k = 0; k < 6; k++) R.add('cloth', box(0.32, 0.05, 0.24), M(-5.8 + (k % 2 ? 0.18 : -0.18), 1.14 + Math.floor(k / 2) * 0.055, -9.9), '#f8f5ee');
        ctx.addCollider({ shape: 'box', x: -5.8, z: -9.9, hw: 0.46, hd: 0.24, maxY: 1.3 }); T('towel cabinet');
        // low screens behind the heads, flowers by the windows, soft lamps
        scr(-4.05, z - 2.4, 0, 6, 1.45); scr(4.05, z - 2.4, 0, 6, 1.45); scr(x, z - 2.6, 0, 4, 1.45);
        for (const [px, pz] of [[-3.0, -10.3], [0, -10.3], [3.0, -10.3], [6.6, -10.2]]) { R.add('onggi', cyl(0.12, 0.09, 0.34, 10), M(px, 0.17, pz), '#ddd5c6'); vase(px, 0.34, pz, '#f0c3cf'); ctx.addCollider({ shape: 'circle', x: px, z: pz, r: 0.16 }); }
        for (const [lx, lz] of [[-6.9, -1.6], [6.9, -1.6], [6.4, 8]]) paperLamp(lx, lz, true);
        for (const lx of [-6.9, 6.9]) paperLamp(lx, 4.4, false);
        runner(0, z + 0.2, 14.2, 3.2, '#b7a07a'); runner(0, 2.0, 14.2, 3.0, '#ad977a');
        station(ctx, key, 'bed', x, 0.66, z, PI); station(ctx, key, 'towel', -5.8, 1.2, -9.6, 0); station(ctx, key, 'guide', x, 0, z - L / 2 - 0.55, 0);
      } else {
        // 제8관 바디마사지관: eight broad beds, each in a bay of its own — folding screens around the front row, hanging
        // cloths between the beds of the back row and one more bay along the north wall; oil bottles on a shelf, a
        // basket of warm stones, lamps on the floor
        const rowB = [-5.6, -2.6, 2.6, 5.6];
        bed(x, z); bed(-4.8, z); bed(4.8, z);
        for (const bx of rowB) bed(bx, 2.4);
        bed(-3.4, -9.4, PI / 2);
        // the program's oil table (as before) and the same little table by every other bed
        R.add('furn', box(0.5, 0.75, 0.4), M(x + 1.4, 0.375, z - 0.4), '#7a5234');
        if (Kt.pot) for (let k = 0; k < 3; k++) try { Kt.pot(R, { x: x + 1.27 + k * 0.13, y: 0.75, z: z - 0.4, kind: 'bottle', s: 0.34, mat: 'onggi' }); } catch (e) { /* optional */ }
        ctx.addCollider({ shape: 'box', x: x + 1.4, z: z - 0.4, hw: 0.26, hd: 0.22, maxY: 0.8 });
        const side = (tx, tz) => { const ty = table(tx, tz, 0.62, 0.42); bottle(tx - 0.1, ty, tz - 0.05); bottle(tx + 0.02, ty, tz + 0.08, '#a8742e'); towel(tx + 0.08, ty, tz - 0.08, 0, '#f1ead8'); };
        side(-4.8 + 1.4, z - 0.4); side(4.8 + 1.4, z - 0.4);
        for (const bx of rowB) side(Math.abs(bx) < 4 ? bx - Math.sign(bx) * 1.3 : bx + Math.sign(bx) * 1.25, 2.0);
        side(-3.4, -8.55);
        // the bays: screens around the front row, curtains on rails between the back-row beds
        for (const sx of [-2.4, 2.4]) scr(sx, z, PI / 2, 5, 1.75);
        for (const sx of [-4.8, 0, 4.8]) scr(sx, z - 2.3, 0, 7, 1.75);
        for (const cx of [-4.1, 4.1, -7.2, 7.2]) {
          if (Math.abs(cx) < 7) { R.add('wood', cyl(0.025, 0.025, 2.6, 8), M(cx, 2.35, 2.4, 0, 1, 1, 1, PI / 2), '#8a5a36'); for (const s of [-1, 1]) R.add('wood', cyl(0.03, 0.03, 2.35, 8), M(cx, 1.18, 2.4 + s * 1.3), '#7a5234'); }
          for (let k = 0; k < 5; k++) R.add('cloth', box(0.02, 2.1, 0.5), M(cx + (k % 2 ? 0.05 : -0.05), 1.27, 2.4 - 1.0 + k * 0.5, k % 2 ? 0.2 : -0.2), k % 2 ? '#e9dfcb' : '#f1e8d6', { cast: false });
          ctx.addCollider({ shape: 'box', x: cx, z: 2.4, hw: 0.1, hd: 1.3, maxY: 2.3 }); T('hanging cloth');
        }
        scr(-1.6, -9.4, PI / 2, 4, 1.6); scr(-5.2, -9.4, PI / 2, 4, 1.6);
        // oil bottles on a shelf (north wall, east), the basket of warm stones, lamps on the floor
        if (Kt.shelf) try { const sp = Kt.shelf(R, { x: 3.6, z: -10.6, rotY: 0, w: 1.8, d: 0.36, h: 1.5, levels: 3 }) || []; sp.forEach((p) => { for (let k = 0; k < 6; k++) bottle(p.x - 0.7 + k * 0.28, p.y, p.z, ['#7a4a22', '#a8742e', '#5a3a1a'][k % 3]); }); ctx.addCollider({ shape: 'box', x: 3.6, z: -10.6, hw: 0.92, hd: 0.2, maxY: 1.6 }); T('oil shelf'); } catch (e) { /* optional */ }
        if (Kt.basket) try { Kt.basket(R, { x: 5.6, z: -9.6, r: 0.3, h: 0.18, kind: 'round' }); for (let k = 0; k < 9; k++) R.add('stone', new THREE.DodecahedronGeometry(0.055, 0), M(5.6 + Math.cos(k * 2.4) * 0.15 * (k % 3) / 2, 0.16 + (k % 2) * 0.03, -9.6 + Math.sin(k * 2.4) * 0.15 * (k % 3) / 2, k, 1.3, 0.6, 1), '#2f2d2b', { cast: false }); ctx.addCollider({ shape: 'circle', x: 5.6, z: -9.6, r: 0.32 }); T('warm stones'); } catch (e) { /* optional */ }
        for (const [lx, lz] of [[-2.4, z + 1.5], [2.4, z + 1.5], [-4.1, 4.0], [4.1, 4.0], [-7.0, -6.8], [7.0, -6.8], [0, -10.4]]) floorLamp(lx, lz);
        for (const [lx, lz] of [[-6.9, -1.6], [6.9, -1.6], [6.4, 8]]) paperLamp(lx, lz, true);
        runner(0, z + 0.3, 14.2, 3.4, '#a58e6a'); runner(0, 2.4, 14.2, 3.2, '#9c8664');
        station(ctx, key, 'bed', x, 0.66, z, PI); station(ctx, key, 'oil', x + 1.4, 0.76, z - 0.4, 0); station(ctx, key, 'guide', x - 0.9, 0, z, PI / 2);
      }
      station(ctx, key, 'spot', x, 0.66, z, PI);
    }
    // a little 수반 with stones (not in 제8관: the warm stones stand there) and a waiting bench by the door
    if (kind !== 'body' && Kt.pot) try { Kt.pot(R, { x: kind === 'face' ? 6.0 : 5.6, z: kind === 'face' ? -8.6 : -8.8, kind: 'basin', s: 1.3 }); for (let k = 0; k < 5; k++) R.add('stone', new THREE.DodecahedronGeometry(0.06, 0), M((kind === 'face' ? 5.9 : 5.5) + k * 0.05, 0.12, (kind === 'face' ? -8.6 : -8.8) + (k % 2) * 0.06, k), '#5a5650', { cast: false }); T('water basin'); } catch (e) { /* optional */ }
    bench(R, ctx, 4.6, 7.6); bench(R, ctx, -4.6, 7.6); T('bench', 2);
  }
  /** a staved wooden foot tub with two iron hoops and warm water */
  function tub(R, x, z, s = 1) {
    const r = 0.32 * s, h = 0.36 * s;
    R.add('furn', cyl(r, r * 0.9, h, 18), M(x, h / 2, z), '#a8784a');
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; R.add('wood', box(0.012, h, 0.01), M(x + Math.cos(a) * r * 0.97, h / 2, z + Math.sin(a) * r * 0.97, -a), '#6a4428', { cast: false }); }
    for (const yy of [0.08, h - 0.08]) R.add('iron', new THREE.TorusGeometry(r * (yy < 0.1 ? 0.92 : 0.99), 0.012, 5, 20), M(x, yy, z, 0, 1, 1, 1, PI / 2), '#3a3430', { cast: false });
    R.add('lacquer', new THREE.CircleGeometry(r * 0.9, 18), M(x, h - 0.05, z, 0, 1, 1, 1, -PI / 2), '#6f8f86', { cast: false });
  }
  /** a sound of the room (61-audio emitters), removed with the place */
  const roomEmitters = new Map();
  function emitter(ctx, kind, x, z, gain = 0.5) {
    try {
      const A = G.sys.audio;
      if (!A || typeof A.emitter !== 'function') return;
      const o = ctx.def.origin, h = A.emitter({ kind, x: o.x + x, z: o.z + z, place: ctx.id, gain });
      const l = roomEmitters.get(ctx.id) || []; l.push(h); roomEmitters.set(ctx.id, l);
    } catch (e) { /* sound optional */ }
  }
  function dropEmitters(id) { for (const h of roomEmitters.get(id) || []) { try { h.remove(); } catch (e) { /* gone */ } } roomEmitters.delete(id); }

  function buildRoom(r) {
    return function (ctx) {
      tallies.set(r.key, {});
      const R = roomShell(ctx, r, r.shell || {});
      try { LAYOUT[r.key](ctx, R, r); } catch (e) { warn('room ' + r.key + ' layout', e); }
      try { furnish(ctx, R, r); } catch (e) { warn('room ' + r.key + ' furnish', e); }
      R.finish({ exit: { x: 0, z: ROOM.d / 2 - 0.6 } });
      return { dispose() { dropStations(r.key); dropEmitters(ctx.id); if (r.key === 'R10') room10Live = null; } };
    };
  }
  // the lodging (숙소) and the 상담실
  function buildStay(ctx) {
    const Kt = K(), w = SMALL.w, d = SMALL.d;
    const R = Kt.room(ctx, {
      w, d, post: SMALL.post, ridge: SMALL.h, ceiling: SMALL.ceil, bays: { x: 3, z: 3 }, floor: 'jangpan', roof: 'ceiling', tone: 'warm',
      walls: { N: ['plaster', { window: 'ttisal', w: 1.4, h: 1.2, sill: 0.6 }, 'plaster'], E: ['plaster', { window: 'aja', w: 1.2, h: 1.1 }, 'plaster'],
        S: ['plaster', { door: 'changho', exit: true, w: 1.6, h: 2.2 }, 'plaster'], W: ['plaster', 'plaster', 'plaster'] },
    });
    // a shelf for the bundle, a clothes rail (횃대), the bedding (요 and 이불) folded on a chest
    const shelf = Kt.shelf ? Kt.shelf(R, { x: -w / 2 + 0.5, z: -1.2, rotY: PI / 2, w: 1.2, d: 0.4, h: 1.5, levels: 3 }) : null;
    ctx.addCollider({ shape: 'box', x: -w / 2 + 0.4, z: -1.2, hw: 0.25, hd: 0.65, maxY: 1.6 });
    station(ctx, 'STAY', 'shelf', -w / 2 + 1.3, 0, -1.2, -PI / 2);
    R.add('wood', cyl(0.025, 0.025, 1.6, 8), M(1.2, 1.75, -d / 2 + 0.25, 0, 1, 1, 1, 0).multiply(new THREE.Matrix4().makeRotationZ(PI / 2)), '#8a5a36');
    for (const s of [-1, 1]) R.add('iron', box(0.03, 0.3, 0.03), M(1.2 + s * 0.8, 1.88, -d / 2 + 0.22), '#3a3430');
    station(ctx, 'STAY', 'rail', 1.2, 0, -d / 2 + 1.1, PI);
    if (Kt.cushion) try { Kt.cushion(R, { x: 2.4, z: 1.2, w: 1.0, d: 2.0, h: 0.14, tint: '#f1ead8', trim: '#b85a4a' }); } catch (e) { /* optional */ }
    station(ctx, 'STAY', 'bed', 2.4, 0.14, 1.2, PI);
    // the bedding chest with folded 이불, a low tea table, a 경대 (mirror chest), a paper lamp
    if (Kt.chest) try { Kt.chest(R, { x: w / 2 - 0.45, z: -1.4, rotY: -PI / 2, w: 1.2, d: 0.45, h: 0.7, fittings: 'brass' }); for (let k = 0; k < 4; k++) R.add('cloth', box(0.42, 0.09, 1.0), M(w / 2 - 0.45, 0.75 + k * 0.095, -1.4), ['#f3ede0', '#d9a7a0', '#e9dfc6', '#9fb3c8'][k]); ctx.addCollider({ shape: 'box', x: w / 2 - 0.45, z: -1.4, hw: 0.25, hd: 0.62, maxY: 1.2 }); } catch (e) { /* optional */ }
    if (Kt.table) try { Kt.table(R, { x: -0.6, z: 1.6, w: 0.7, d: 0.45, h: 0.3 }); if (Kt.pot) for (let k = 0; k < 2; k++) Kt.pot(R, { x: -0.75 + k * 0.3, y: 0.3, z: 1.6, kind: 'bowl', s: 0.3 }); ctx.addCollider({ shape: 'box', x: -0.6, z: 1.6, hw: 0.36, hd: 0.24, maxY: 0.32 }); } catch (e) { /* optional */ }
    if (Kt.chest) try { Kt.chest(R, { x: -w / 2 + 0.5, z: 2.2, rotY: PI / 2, w: 0.6, d: 0.38, h: 0.35, drawers: 2 }); R.add('lacquer', box(0.02, 0.5, 0.36), M(-w / 2 + 0.36, 0.62, 2.2, PI / 2), '#cfd9de'); ctx.addCollider({ shape: 'box', x: -w / 2 + 0.5, z: 2.2, hw: 0.2, hd: 0.32, maxY: 0.9 }); } catch (e) { /* optional */ }
    if (Kt.jwadeung) try { Kt.jwadeung(R, { x: w / 2 - 0.6, z: 2.6, h: 0.9 }); if (!ctx.low && Kt.lamp) Kt.lamp(R, { x: w / 2 - 0.6, y: 0.75, z: 2.6, s: 0.5, intensity: 2.2, distance: 6 }); } catch (e) { /* optional */ }
    if (Kt.floorMat) try { Kt.floorMat(R, { x: 0.4, z: 0.2, w: 2.4, d: 3.2, tint: '#c9b27c' }); } catch (e) { /* optional */ }
    station(ctx, 'STAY', 'door', 0, 0, d / 2 - 1.0, PI);
    station(ctx, 'STAY', 'guide', -1.4, 0, 1.6, PI);
    station(ctx, 'STAY', 'spot', 0, 0, 0.6, PI);
    nameBoard(ctx, R, { title: '숙소', sub: '짐을 풀고 옷을 갈아입어요', x: 0, y: 2.35, z: d / 2 - 0.08, rotY: PI, w: 1.5 });
    R.finish({ exit: { x: 0, z: d / 2 - 0.6 } });
    return { dispose() { dropStations('STAY'); dropEmitters(ctx.id); } };
  }
  function buildTalk(ctx) {
    const Kt = K(), w = SMALL.w, d = SMALL.d;
    const R = Kt.room(ctx, {
      w, d, post: SMALL.post, ridge: SMALL.h, ceiling: SMALL.ceil, bays: { x: 3, z: 3 }, floor: 'maru', roof: 'ceiling', tone: 'warm',
      walls: { N: ['plaster', { window: 'yongja', w: 1.4, h: 1.2, sill: 0.6 }, 'plaster'], E: ['plaster', 'plaster', 'plaster'],
        S: ['plaster', { door: 'changho', exit: true, w: 1.6, h: 2.2 }, 'plaster'], W: ['plaster', { window: 'aja', w: 1.2, h: 1.1 }, 'plaster'] },
    });
    if (Kt.table) try { Kt.table(R, { x: 0, z: -0.6, w: 1.2, d: 0.7, h: 0.34 }); } catch (e) { /* optional */ }
    ctx.addCollider({ shape: 'box', x: 0, z: -0.6, hw: 0.6, hd: 0.36, maxY: 0.36 });
    if (Kt.cushion) for (const z of [0.4, -1.6]) try { Kt.cushion(R, { x: 0, z, tint: '#7a8a5a', trim: '#d9b24c' }); } catch (e) { /* optional */ }
    // a tea set on the table, a screen without written characters behind the manager, a lamp, a plant, a bookcase
    if (Kt.pot) try { Kt.pot(R, { x: 0.25, y: 0.34, z: -0.6, kind: 'bottle', s: 0.36 }); for (const [dx, dz] of [[-0.2, -0.35], [-0.2, -0.85]]) Kt.pot(R, { x: dx, y: 0.34, z: -0.6 + dz + 0.6, kind: 'bowl', s: 0.24 }); } catch (e) { /* optional */ }
    if (Kt.screen) try { Kt.screen(R, { x: 0, z: -d / 2 + 0.9, rotY: 0, panels: 6, h: 1.5 }); } catch (e) { /* optional */ }
    if (Kt.jwadeung) try { Kt.jwadeung(R, { x: -w / 2 + 0.7, z: -d / 2 + 0.8, h: 0.9 }); if (!ctx.low && Kt.lamp) Kt.lamp(R, { x: -w / 2 + 0.7, y: 0.75, z: -d / 2 + 0.8, s: 0.5, intensity: 2.2, distance: 6 }); } catch (e) { /* optional */ }
    plant(R, ctx, w / 2 - 0.7, -d / 2 + 0.8, 1.1);
    if (Kt.shelf) try { const sp = Kt.shelf(R, { x: w / 2 - 0.4, z: 1.0, rotY: -PI / 2, w: 1.2, d: 0.35, h: 1.5, levels: 3 }) || []; sp.forEach((q) => { for (let k = 0; k < 5; k++) R.add('paint', box(0.05, 0.24, 0.17), M(q.x, q.y + 0.12, q.z - 0.3 + k * 0.12), ['#6a3a2a', '#2f4a6a', '#3a5a3a', '#8a6a3a', '#5a4a6a'][k]); }); ctx.addCollider({ shape: 'box', x: w / 2 - 0.4, z: 1.0, hw: 0.2, hd: 0.62, maxY: 1.6 }); } catch (e) { /* optional */ }
    station(ctx, 'TALK', 'seat', 0, 0.09, 0.4, PI);
    station(ctx, 'TALK', 'manager', 0, 0.09, -1.6, 0);
    station(ctx, 'TALK', 'guide', 0, 0.09, -1.6, 0);
    station(ctx, 'TALK', 'spot', 0, 0.09, 0.4, PI);
    nameBoard(ctx, R, { title: '상담실', sub: '오늘의 쉼 이야기', x: 0, y: 2.35, z: d / 2 - 0.08, rotY: PI, w: 1.5 });
    R.finish({ exit: { x: 0, z: d / 2 - 0.6 } });
    return { dispose() { dropStations('TALK'); dropEmitters(ctx.id); } };
  }

  // ================================================================ moving between the hall and its rooms
  const fromDoor = {};      // place -> true when entered through its corridor door (the way out leads back there)
  function spotBefore(key) {
    const r = BY_KEY.get(key);
    return r ? { x: r.doorX, z: DOOR_Z + 1.7, rotY: 0 } : null;
  }
  function enterRoom(key) {
    const r = BY_KEY.get(key), Pl = P();
    if (!r || !Pl) return Promise.resolve(false);
    return Pl.enter(r.place).catch((e) => { warn('enter ' + r.place, e); return false; });
  }
  async function enterFromAnywhere(key) {
    const r = BY_KEY.get(roomKey(key) || key), Pl = P();
    if (!r || !Pl) return false;
    if (Pl.is(r.place)) return true;
    if (!Pl.is(HALL.id)) {
      // from the valley or another place: into the hall first (in front of that door), then the room
      const ok = await Pl.enter(HALL.id, { spawn: spotBefore(r.key) });
      if (!ok) return false;
    }
    return enterRoom(r.key);
  }

  // ================================================================ definitions
  function define() {
    const Pl = P();
    if (!Pl || !K() || typeof K().room !== 'function') { warn('places / hanok kit missing — no 힐링관 inside'); return; }
    const door = Pl.doorOf('B_HEAL');
    const exit = door ? door.exit : { x: 38, z: -104.5, rotY: 0 };
    Pl.define({
      id: HALL.id, name: '힐링관', kidName: '힐링관', emoji: '🌿', zoneId: 'ZONE_PL_HEAL', color: '#a8c99a',
      desc: '통유리 앞으로 정원이 보이는 긴 복도와 열 개의 쉼 체험 방이 있는 한옥이에요. 놀이로 해 보는 쉼 체험이에요.',
      origin: HALL.origin, size: { w: HALL.W, d: HALL.D, h: HALL.H }, floorY: 0, surface: 'wood',
      spawn: { x: 0, z: FRONT_Z - 2.0, rotY: PI },
      door: door ? { buildingId: 'B_HEAL', x: door.x, z: door.z, label: '🚪 힐링관 들어가기', kidLabel: '힐링관' } : undefined,
      exit, indoor: true, far: 400,
      camera: { dist: 6.2, min: 2.4, max: 9.5, pitch: 0.16, pmin: -0.1, pmax: 0.85, ceil: HALL.CEIL - 0.55 },
      light: (ctx) => {
        const p = ctx.room && ctx.room.light ? ctx.room.light() : {};
        return Object.assign(p, {
          radius: 26, radiusY: 14, dist: 70,
          hemi: { sky: '#eef3f6', ground: '#c7ad8c', intensity: (p.hemi?.intensity || 0.5) * 1.35 },
          background: '#9fb6c6', backgroundNight: '#1b2130', fog: { color: '#c9d6dc', density: 0.0016 },
          exposure: 0.96, exposureNight: 1.28, fill: 0.08,
          shadow: { bias: -0.0005, normalBias: 0.012, radius: 1.5, mapSize: 2048 },
        });
      },
      build: buildHall,
    });
    const nested = (r, build, size, extra = {}) => Pl.define(Object.assign({
      id: r.place, name: r.n ? `제${r.n}관 ${r.name}` : r.name, kidName: r.n ? `제${r.n}관 ${r.kid}` : r.kid, emoji: r.emoji, zoneId: r.zone,
      color: '#c9b48a', desc: r.n ? `힐링관의 제${r.n}관이에요.` : `힐링관의 ${r.name}이에요.`,
      origin: r.origin, size, floorY: 0, surface: r.floor === 'stone' ? 'stone' : r.floor === 'earth' ? 'dirt' : 'wood',
      spawn: { x: 0, z: size.d / 2 - (r.n ? 5.0 : 2.0), rotY: PI }, exit, indoor: true, far: 150,
      camera: r.n ? { dist: 5.6, min: 2.4, max: 8, pitch: 0.18, pmin: -0.1, pmax: 0.85, ceil: ROOM.ceil - 0.5 } : { dist: 4.0, min: 2.0, max: 5.4, pitch: 0.2, pmin: -0.1, pmax: 0.85, ceil: SMALL.ceil - 0.45 },
      // came in from the hall (its corridor door, the map, G.healHall.enter): the way out leads back into the corridor
      // in front of this door; came another way (the 가기 picture menu from the valley): out to the valley like any room
      canEnter: (o) => { fromDoor[r.place] = !(o && o.quiet) && PLACES.includes(P().current); return true; },
      exitTo: (o) => { const back = fromDoor[r.place]; fromDoor[r.place] = false; return o && o.to ? null : back ? { place: HALL.id, spawn: spotBefore(r.key) } : null; },
      build,
    }, extra));
    nested(EXTRA[0], buildStay, { w: SMALL.w, d: SMALL.d, h: SMALL.h });
    nested(EXTRA[1], buildTalk, { w: SMALL.w, d: SMALL.d, h: SMALL.h });
    for (const r of ROOMS) nested(r, buildRoom(r), { w: ROOM.w, d: ROOM.d, h: ROOM.h }, r.n === 10 ? { kidName: '제10관 마음 돌아보기', emoji: '🌙' } : {});
    try { Pl.hideRoot?.('heal-house'); } catch (e) { /* optional */ }
  }

  // ================================================================ the house in the valley (B_HEAL)
  function buildHouse() {
    const Bk = BK(), b = (G.data.layout?.buildings || []).find((x) => x.id === 'B_HEAL'), E = G.sys.engine;
    if (!Bk || !b || !E?.scene || typeof Bk.Site !== 'function') return null;
    const site = new Bk.Site(b), B = site.B, geo = Bk.geo, Mb = Bk.M;
    const w = b.w, d = b.d, baseH = 0.5, ph = 3.4, topY = baseH + ph, nb = Math.round(w / 3), bay = w / nb;
    // 기단 with a granite coping, steps at the entrance
    B.add('stone', geo.box(w + 1.8, baseH + 0.7, d + 1.8, 'world'), Mb(0, (baseH - 0.7) / 2, 0), '#c9c3b8');
    B.add('stone', geo.box(w + 1.9, 0.08, d + 1.9, 'world', 0.3, 0.7), Mb(0, baseH - 0.04, 0), '#dcd7cd');
    for (let i = 0; i < 2; i++) { const top = baseH * (i + 1) / 3, zf = d / 2 + 0.9 + 0.42 * (2 - i); B.add('stone', geo.box(4.2, top + 0.4, 0.44, 'world', i * 0.7), Mb(0, (top - 0.4) / 2, zf - 0.21), '#d2cdc3'); site.walk(0, zf - 0.21, 2.1, 0.22, top, 'stone'); }
    // the body: glass along the whole front between round pillars, plaster and timber at the back and the ends
    for (let i = 0; i <= nb; i++) {
      const x = -w / 2 + i * bay;
      for (const z of [d / 2, -d / 2]) {
        B.add('stone', geo.cyl(0.3, 0.34, 0.16, 10), Mb(x, baseH + 0.08, z), '#d9d4cb');
        B.add('wood', geo.cyl(0.17, 0.18, ph - 0.16, 12), Mb(x, baseH + 0.16 + (ph - 0.16) / 2, z), '#a8693f');
      }
    }
    for (const z of [d / 2, -d / 2]) B.add('wood', geo.box(w + 0.3, 0.34, 0.26, 'grain'), Mb(0, topY - 0.14, z), '#94653f');
    for (const x of [-w / 2, w / 2]) B.add('wood', geo.box(0.26, 0.34, d + 0.3, 'grain'), Mb(x, topY - 0.14, 0), '#94653f');
    B.add('glass', geo.box(w - 0.2, ph - 0.5, 0.08, 'world'), Mb(0, baseH + (ph - 0.5) / 2 + 0.06, d / 2 - 0.05), '#ffffff');
    for (let i = 0; i < nb; i++) { const cx = -w / 2 + (i + 0.5) * bay; B.add('wood', geo.box(0.06, ph - 0.5, 0.1), Mb(cx, baseH + (ph - 0.5) / 2 + 0.06, d / 2 + 0.01), '#c9ab83'); }
    B.add('wood', geo.box(w - 0.2, 0.07, 0.1), Mb(0, baseH + 2.6, d / 2 + 0.01), '#c9ab83');
    B.add('plaster', geo.box(w - 0.2, ph - 0.3, 0.2, 'world'), Mb(0, baseH + (ph - 0.3) / 2, -d / 2 + 0.1), '#ffffff');
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) B.add('plaster', geo.box(0.2, ph - 0.3, d - 0.2, 'world'), Mb(x, baseH + (ph - 0.3) / 2, 0), '#ffffff');
    B.add('plank', geo.box(w - 0.3, 0.12, d - 0.3, 'world'), Mb(0, baseH + 0.06, 0), '#d6b48a');
    // the roof: a long 팔작 roof of grey tiles
    const ro = { mode: 'paljak', hw: w / 2, hd: d / 2, ov: 2.0, out: 0.55, lift: 0.55, t: 0.3, tint: '#f1f3f5', vres: 1 };
    ro.rise = (ro.hd + ro.ov) * 0.62;
    ro.y = Bk.roofBaseFor ? Bk.roofBaseFor(ro, topY + 0.46) : topY + 0.6;
    ro.ridge = { w: 0.44, h: 0.44 };
    try { Bk.roof(B, Mb(0, 0, 0), ro); } catch (e) { warn('house roof', e); }
    site.box(0, 0, w / 2 + 0.4, d / 2 + 0.4);
    // two stone lanterns and low pines flanking the entrance steps
    for (const sx of [-1, 1]) {
      const lx = sx * 3.6, lz = d / 2 + 2.6;
      B.add('stone', geo.box(0.6, 0.14, 0.6, 'world'), Mb(lx, 0.07, lz), '#bdb6a8');
      B.add('stone', geo.cyl(0.1, 0.13, 0.9, 8), Mb(lx, 0.59, lz), '#bdb6a8');
      B.add('stone', geo.box(0.56, 0.1, 0.56, 'world'), Mb(lx, 1.09, lz), '#b3ac9e');
      B.add('glow', geo.box(0.34, 0.34, 0.34, 'world'), Mb(lx, 1.31, lz), '#ffcf8a');
      B.add('stone', geo.box(0.62, 0.12, 0.62, 'world'), Mb(lx, 1.54, lz), '#a9a294');
      site.circle(lx, lz, 0.38);
      const px = sx * 7.4, pz = d / 2 + 2.2;
      B.add('wood', geo.cyl(0.1, 0.16, 2.4, 7), Mb(px, 1.2, pz), '#6a4a34');
      for (let k = 0; k < 3; k++) B.add('paint', geo.cyl(0.05, 1.2 - k * 0.3, 0.8, 8), Mb(px + (k - 1) * 0.15, 1.9 + k * 0.5, pz), k % 2 ? '#2f5a34' : '#355f3a');
      site.circle(px, pz, 0.3);
    }
    const root = new THREE.Group(); root.name = 'heal-house';
    E.scene.add(root);
    site.finish(root, { blockKeys: ['roof', 'soffit', 'fascia'] });
    // the 현판 over the entrance
    try {
      const tex = canvasTex(1024, 320, (c, cw, ch) => {
        const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, '#5a3a22'); g.addColorStop(1, '#3a2414'); c.fillStyle = g; c.fillRect(0, 0, cw, ch);
        c.strokeStyle = '#d2a85a'; c.lineWidth = 12; c.strokeRect(14, 14, cw - 28, ch - 28);
        c.fillStyle = '#fff1d2'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 150px ${FONT}`; c.fillText('힐링관', cw / 2, ch * 0.44);
        c.font = `700 52px ${FONT}`; c.fillStyle = '#f0d49a'; c.fillText('쉬어 가는 열 개의 방', cw / 2, ch * 0.8);
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd9d2c4 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), mat);
      sign.position.set(0, topY - 0.75, d / 2 + 0.22); sign.name = 'heal-house-sign';
      site.group.add(sign);
    } catch (e) { /* the sign is optional */ }
    return { root, site };
  }

  // ================================================================ the interface
  G.healHall = {
    PLACES, HALL: { id: HALL.id, length: HALL.W, depth: HALL.D, origin: { ...HALL.origin } },
    place(room) { const k = roomKey(room); const r = k && BY_KEY.get(k); return r ? r.place : null; },
    door(room, state) {
      const k = roomKey(room);
      if (!k || !k.startsWith('R') || !STATES.includes(state)) return false;
      doorState[k] = state;
      applyDoorStates();
      return true;
    },
    doors() { return { ...doorState }; },
    corridor() {
      const o = HALL.origin;
      const list = [...ROOMS, ...EXTRA].map((r) => {
        const s = spotBefore(r.key);
        return { room: r.key, n: r.n || 0, name: r.n ? `제${r.n}관 ${r.name}` : r.name, kidName: r.n ? `제${r.n}관 ${r.n === 10 && gentle() ? r.kid : r.kid}` : r.kid, place: r.place, state: doorState[r.key] || null, minutes: r.min || 0, x: s.x, z: s.z, wx: o.x + s.x, wz: o.z + s.z, door: { x: r.doorX, z: DOOR_Z } };
      });
      list.place = HALL.id; list.length_m = HALL.W; list.depth = HALL.D;
      list.lobby = { x: 0, z: DOOR_Z + 3.4 }; list.entrance = { x: 0, z: FRONT_Z - 0.6 }; list.desk = { x: 0, z: DOOR_Z + 3.3 };
      list.bounds = { minX: -HALL.W / 2, maxX: HALL.W / 2, minZ: -HALL.D / 2, maxZ: HALL.D / 2 };
      return list;
    },
    enter(room) { return enterFromAnywhere(room); },
    gentle,
    setRoom10(full) { room10Set = full == null ? null : !!full; if (room10Live) room10Live.setGentle(gentle()); applyDoorStates(); return true; },
    stations(room) { return (stationsOf.get(room) || []).slice(); },
    census(room) { return { ...(tallies.get(room) || {}) }; },
  };

  G.register({
    name: 'healHall', order: 31, label: '힐링관 (건물 · 복도 · 열 개의 방)',
    init() {
      try { define(); } catch (e) { warn('the places could not be defined', e); }
      try { this.house = buildHouse(); } catch (e) { warn('the house could not be built', e); }
      G.bus.on('easy:changed', () => applyDoorStates());
    },
    update() { /* the places run their own updates (ctx.onUpdate) */ },
  });
})();
