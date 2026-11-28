// =============================================================================
// 79-healing-acts.js — the ten activities of the 힐링관 (G.healActs + the system `healacts`, order 67; CONTRACT §19.6,
// lane heal-program). Data: 38-healing-data.js. The visit, the clock and the screens: 39-healing.js (G.sys.healing).
//
//   G.healActs
//     open(roomId, {again}) → the docked card of the room: its hands-on steps (1 – 3 minutes, wide timing, nothing to get
//                             wrong), then the rest with small things now and then; the course runs on by itself
//     close(reason) · left() (the visitor walked out: the dock goes, the course stays) · ended(roomId) (the stamp)
//     station(room, key) (a station appeared: props are rebuilt when it is the open room) · current (room | null)
//     state → null | { room, i, of, mode, rest }           r9 → { lanes, pieces, swings } (tests)
//     press() / release() / tapSpot(i) / choose(id) / auto(maxSec) (tests: plays the open room's steps like a calm visitor)
//   Step kinds (38-healing-data.js): hold · taps · spots · breath · pick · still · scope · pairs · strip · walk · reps ·
//   gear · swing · portrait · letter · lie · three
// Room 9 (stand · plates · drums · cans · bottles · rack): a wooden bat in the right hand; press = a swing, hold and let
// go = a strong one; aim help (a lane button picks the row, the visitor steps up to it, the bat finds the nearest whole
// thing); plates and bottles break into POOLED pre-cut pieces (simple ballistic motion, one bounce, never towards the
// camera), drums take dents (their vertices pushed in), cans flatten and tumble; dust / glints from G.fx; crisp sounds
// (61-audio [healing]); a short vibration on phones where the browser allows it; racks refill a moment after a row is
// empty; every count is kept (visit.r9). Room 10: the portrait (G.sys.photo.snapshot → a small JPEG kept on THIS device),
// the letter (sentence cards; typing only behind G.easy.gate in easy mode; kept on this device), lying in the coffin in a
// slow dark (a veil that fades over 4 s — never a flash) with a breath ring and a voice, the lid opening to morning light,
// three things that matter; the gentle version (easy mode) 오늘의 나 사진 · 고마운 마음 편지 · 별빛 아래 고요한 쉼.
// Never blocked: every step can be held / tapped at any pace, a wrong pick only wiggles, ✖ closes the dock at once and
// the course runs on; reduce motion → no breathing pulse, no wobble.
// =============================================================================
(function () {
  const D = G.data.healing;
  if (!D) return;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const h = (...a) => G.ui.h(...a);
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const reduced = () => !!(G.settings && G.settings.reduceMotion) || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const say = (t) => { try { if (easyOn() && t) G.easy?.say?.(t); } catch (e) { /* voice optional */ } };
  const sfx = (n, o) => { try { G.sys.audio?.play?.(n, o); } catch (e) { /* audio optional */ } };
  const Hs = () => G.sys.healing;
  const P = () => G.sys.player;
  const vis = () => Hs()?.visit || null;
  const mark = () => { try { G.save?.markDirty?.('healing'); G.bus.emit('healing:changed', {}); } catch (e) { /* optional */ } };
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const LITTLE_EVERY = 3 * 60000;   // a new small thing every three course minutes (course time, so the scale applies)

  let dock = null;
  let ses = null;      // { room, R, steps, i, mode, hold, holdT, taps, lastTap, done, t, props, little }
  const props = { group: null, room: null, items: [], update: [] };

  // ---------------------------------------------------------------- poses: sit, lie, stand
  let pose = null;   // { kind: 'lie' | 'sit', prev: { rx, y } }
  /** the yaw a station faces (an Object3D of the hall), or null */
  function stationYaw(room, key) {
    const o = G.healStations.get(room, key);
    if (!o || !o.isObject3D || !o.parent) return fin(o && o.rotY) ? o.rotY : null;
    const q = new THREE.Quaternion(); o.getWorldQuaternion(q);
    return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  }
  /** lying on a mat / bed / in the coffin: the visitor's root stays where it stood (colliders and the ground keep it
   *  there); only the body is laid flat, its middle on the station along the way the station faces — placed every frame
   *  in the root's own frame, so nothing pushes it out of a coffin or onto a bed's top */
  function lie(at, faceDown, yaw) {
    const p = P(); if (!p?.rig || !at) return;
    unpose();
    try { p.cancelWalk?.('heal'); } catch (e) { /* optional */ }
    const g = p.rig.group;
    pose = { kind: 'lie', en: p.enabled, order: g.rotation.order, y0: g.position.y, down: !!faceDown, at: new THREE.Vector3(at.x, fin(at.y) ? at.y : 0, at.z), yaw: fin(yaw) ? yaw : (fin(p.rotY) ? p.rotY : 0) };
    p.enabled = false;
    placeLying();
  }
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function placeLying() {
    const p = P(); if (!pose || pose.kind !== 'lie' || !p?.rig) return;
    const g = p.rig.group, par = g.parent; if (!par) return;
    const k = pose.down ? -0.72 : 0.72, ty = pose.yaw;
    _o.set(pose.at.x + Math.sin(ty) * k, pose.at.y + 0.16, pose.at.z + Math.cos(ty) * k);
    par.updateWorldMatrix(true, false);
    par.worldToLocal(_o);
    g.position.copy(_o);
    par.getWorldQuaternion(_q); _e.setFromQuaternion(_q, 'YXZ');
    g.rotation.order = 'YXZ';
    g.rotation.set(pose.down ? Math.PI / 2 : -Math.PI / 2, ty - _e.y, 0);
  }
  function sit(at) {
    const p = P(); if (!p?.sit) return;
    unpose();
    try { p.sit(at ? { x: at.x, z: at.z, rot: p.rotY, seatY: 0.42 } : null); pose = { kind: 'sit' }; } catch (e) { /* optional */ }
  }
  function unpose() {
    const p = P(); if (!p?.rig || !pose) { pose = null; return; }
    if (pose.kind === 'lie') { const g = p.rig.group; g.rotation.set(0, 0, 0); g.rotation.order = pose.order || 'XYZ'; g.position.set(0, pose.y0 || 0, 0); p.enabled = pose.en !== false; }
    if (pose.kind === 'sit') { try { p.standUp?.(); } catch (e) { /* optional */ } }
    pose = null;
  }

  // ---------------------------------------------------------------- props (moving things on the stations)
  function stationPos(room, key) { return Hs()?.stationPos?.(room, key) || null; }
  function clearProps() {
    for (const o of props.items) { o.parent?.remove(o); o.traverse?.((m) => { if (m.isMesh && m.userData.own) { m.geometry?.dispose?.(); } }); }
    props.items = []; props.update = []; props.room = null;
    if (props.group) { props.group.parent?.remove(props.group); props.group = null; }
    r9 = null;
  }
  function group() {
    if (!props.group) { props.group = new THREE.Group(); props.group.name = 'heal-props'; G.sys.engine?.scene?.add?.(props.group); }
    return props.group;
  }
  const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0 }, o || {}));
  const MAT = {};
  const mat = (k) => MAT[k] || (MAT[k] = ({
    wood: () => std(0x7a5232, { roughness: 0.75 }), darkwood: () => std(0x3c2a1c, { roughness: 0.7 }), ember: () => std(0x3a2a1a, { emissive: 0xff6a1a, emissiveIntensity: 1.2 }),
    moxa: () => std(0xb9a77a, { roughness: 0.9 }), ceramic: () => std(0xf4f1ea, { roughness: 0.22 }), rim: () => std(0x3b5ba5, { roughness: 0.3 }),
    drum: () => std(0x3b5ba5, { roughness: 0.38, metalness: 0.7 }), can: () => std(0xd9534f, { roughness: 0.3, metalness: 0.75 }),
    glass: () => std(0x3f8f5a, { roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 }), shardc: () => std(0xefeae0, { roughness: 0.3, side: THREE.DoubleSide }),
    shardg: () => std(0x4f9f6a, { roughness: 0.05, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), bat: () => std(0xb98a52, { roughness: 0.55 }),
    lid: () => std(0x5a3e28, { roughness: 0.65 }), water: () => std(0x8fc9df, { roughness: 0.05, transparent: true, opacity: 0.55 }),
  })[k]());
  function buildProps(room) {
    clearProps();
    props.room = room;
    const g = group();
    const add = (m) => { g.add(m); props.items.push(m); return m; };
    if (room === 'R2') {
      // moxa holders with glowing tips on a tray (they move to the back / belly with the steps)
      const at = stationPos('R2', 'tray') || stationPos('R2', 'spot');
      if (!at) return;
      const cyl = new THREE.CylinderGeometry(0.035, 0.045, 0.07, 10);
      const tip = new THREE.SphereGeometry(0.022, 8, 6);
      for (let i = 0; i < 5; i++) {
        const o = new THREE.Group();
        const b = new THREE.Mesh(cyl, mat('moxa')); o.add(b);
        const e = new THREE.Mesh(tip, mat('ember')); e.position.y = 0.04; o.add(e);
        o.position.set(at.x - 0.2 + i * 0.1, (at.y || 0) + 0.85, at.z);
        o.userData.ember = e; add(o);
      }
      props.update.push((dt, t) => { const k = reduced() ? 1 : 1 + Math.sin(t * 1.3) * 0.25; mat('ember').emissiveIntensity = 1.1 * k; });
      let puff = 0;
      props.update.push((dt) => { puff -= dt; if (puff > 0 || !ses || ses.room !== 'R2') return; puff = 1.6; const o = props.items[(Math.random() * props.items.length) | 0]; if (o) { o.getWorldPosition(_v); try { G.fx?.burst?.(_v, { type: 'dust', count: 2, color: '#d9d4ca', up: 0.6, spread: 0.05, size: 0.5 }); } catch (e) { /* fx optional */ } } });
    }
    if (room === 'R3' || room === 'R5') {
      const at = stationPos(room, room === 'R3' ? 'pot' : 'tub') || stationPos(room, 'spot');
      if (!at) return;
      let puff = 0;
      props.update.push((dt) => { puff -= dt; if (puff > 0) return; puff = reduced() ? 3 : 1.3; try { G.fx?.burst?.({ x: at.x, y: (at.y || 0) + 0.5, z: at.z }, { type: 'dust', count: 3, color: '#f4f4f0', up: 0.8, spread: 0.18, size: 0.7 }); } catch (e) { /* fx optional */ } });
      if (room === 'R5') { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 24), mat('water')); w.userData.own = true; w.position.set(at.x, (at.y || 0) + 0.32, at.z); w.visible = false; add(w); props.water = w; }
    }
    if (room === 'R9') buildR9();
    if (room === 'R10' && !Hs()?.gentle?.() && stationPos('R10', 'coffin')) {
      // the hall's coffin (69-healing-hall.js shows it for the full version): only a lid of ours that slides away
      const at = stationPos('R10', 'coffin');
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 2.04), mat('lid')); lid.userData.own = true;
      lid.position.set(at.x + 0.8, (at.y || 0) - 0.06, at.z); lid.visible = true;
      add(lid); props.lid = lid; props.lidHome = { x: at.x, y: (at.y || 0) + 0.44, z: at.z }; props.lidOpen = { x: at.x + 0.8, y: (at.y || 0) - 0.06, z: at.z };
    } else if (room === 'R10' && !Hs()?.gentle?.()) {
      const at = stationPos('R10', 'rest');
      if (at) {
        const body = new THREE.Group(); body.name = 'heal-coffin';
        const side = (w, hh, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat('darkwood')); m.userData.own = true; m.position.set(x, y, z); body.add(m); };
        side(2.0, 0.06, 0.62, 0, 0.03, 0); side(2.0, 0.5, 0.05, 0, 0.28, 0.29); side(2.0, 0.5, 0.05, 0, 0.28, -0.29); side(0.05, 0.5, 0.62, 0.98, 0.28, 0); side(0.05, 0.5, 0.62, -0.98, 0.28, 0);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.05, 0.66), mat('lid')); lid.userData.own = true; lid.position.set(0, 0.56, 0.7); body.add(lid);
        body.position.set(at.x, at.y || 0, at.z);
        add(body); props.lid = lid;
      }
    }
  }

  // ---------------------------------------------------------------- room 9: breakables, pooled pieces, the bat
  let r9 = null;
  const LANES = [['plates', '🍽️', '접시'], ['drums', '🛢️', '드럼통'], ['cans', '🥫', '깡통'], ['bottles', '🍾', '유리병']];
  function buildR9() {
    const st = stationPos('R9', 'stand') || stationPos('R9', 'spot') || (P() ? P().position.clone() : null);
    if (!st) return;
    const g = group();
    r9 = { lanes: {}, pieces: [], swing: null, lane: 'plates', swings: 0, hits: 0, refillT: {}, st: st.clone ? st.clone() : new THREE.Vector3(st.x, st.y || 0, st.z) };
    const floorY = st.y || 0;
    r9.floorY = floorY;
    // a cheap shared set of geometries
    const plateG = new THREE.CylinderGeometry(0.17, 0.15, 0.025, 20);
    const canG = new THREE.CylinderGeometry(0.05, 0.05, 0.13, 14);
    const bottleG = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.065, 0.02], [0.065, 0.2], [0.05, 0.25], [0.022, 0.29], [0.02, 0.36], [0.024, 0.37], [0, 0.37]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
    const tableG = new THREE.BoxGeometry(1.7, 0.06, 0.5);
    const legG = new THREE.BoxGeometry(0.06, 0.9, 0.06);
    const shardG = (() => { const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.09, 0.01, 0.02, 0.03, 0, 0.08, 0, 0.012, 0, 0.09, 0.022, 0.02, 0.03, 0.012, 0.08], 3)); gg.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]); gg.computeVertexNormals(); return gg; })();
    r9.geo = { plateG, canG, bottleG, tableG, legG, shardG };
    const defaultAt = (i) => { const a = (i - 1.5) * 1.9; return new THREE.Vector3(st.x + a, floorY, st.z - 2.6); };
    LANES.forEach(([k], li) => {
      const at = stationPos('R9', k) || defaultAt(li);
      const base = new THREE.Vector3(at.x, at.y != null ? at.y : floorY, at.z);
      // the row runs across the line from the stand to the station
      const dir = new THREE.Vector3(base.x - st.x, 0, base.z - st.z); if (dir.lengthSq() < 0.01) dir.set(0, 0, -1); dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const lane = { k, base, dir, side, items: [] };
      // a station high above the floor is the top of the hall's own stand (69-healing-hall.js): the targets stand on its
      // front edge (the hall's display stays behind them); a floor station gets a small table of ours (the test room)
      const onStand = (base.y - floorY) > 0.3;
      if (onStand) base.addScaledVector(dir, -0.14);
      if (k === 'drums') base.addScaledVector(dir, -0.85);
      if (k !== 'drums' && !onStand) {
        const tb = new THREE.Group();
        const top = new THREE.Mesh(tableG, mat('wood')); top.position.y = 0.9; tb.add(top);
        for (const sx of [-0.8, 0.8]) for (const sz of [-0.2, 0.2]) { const l = new THREE.Mesh(legG, mat('wood')); l.position.set(sx, 0.45, sz); tb.add(l); }
        tb.position.copy(base); tb.rotation.y = Math.atan2(side.x, side.z) + Math.PI / 2; g.add(tb); props.items.push(tb);
      }
      const n = 3, gap = k === 'drums' ? 0.85 : 0.5;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * gap;
        const home = base.clone().addScaledVector(side, off);
        let m;
        const top = onStand ? 0 : 0.9;
        if (k === 'plates') { m = new THREE.Mesh(plateG, mat('ceramic')); m.rotation.set(Math.PI / 2 - 0.15, Math.atan2(dir.x, dir.z), 0); home.y += top + 0.17; }
        else if (k === 'cans') { m = new THREE.Mesh(canG, mat('can')); home.y += top + 0.065; }
        else if (k === 'bottles') { m = new THREE.Mesh(bottleG, mat('glass')); home.y += top + 0.005; }
        else { const dg = new THREE.CylinderGeometry(0.28, 0.28, 0.86, 22, 6); m = new THREE.Mesh(dg, mat('drum')); m.userData.own = true; m.userData.orig = Float32Array.from(dg.attributes.position.array); home.y += 0.43; }
        m.castShadow = true; m.position.copy(home); g.add(m); props.items.push(m);
        lane.items.push({ k, m, home, alive: true, dents: 0, rot0: m.rotation.clone(), crushT: -1, wob: 0 });
      }
      r9.lanes[k] = lane;
    });
    // the pool of pieces (pre-cut, shared geometry; two materials)
    for (let i = 0; i < 42; i++) {
      const m = new THREE.Mesh(shardG, mat('shardc')); m.visible = false; m.castShadow = false; g.add(m); props.items.push(m);
      r9.pieces.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, rest: false });
    }
    props.update.push(r9Tick);
  }
  function batOn(on) {
    const p = P(); const hand = p?.rig?.handR;
    if (!hand) return;
    if (on && !props.bat) {
      const g = new THREE.Group(); g.name = 'heal-bat';
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.017, 0.82, 10), mat('bat')); m.userData.own = true; m.position.y = 0.33; g.add(m);
      g.rotation.set(-0.4, 0, 0.2); hand.add(g); props.bat = g;
    } else if (!on && props.bat) { props.bat.parent?.remove(props.bat); props.bat.traverse((x) => { if (x.isMesh) x.geometry.dispose(); }); props.bat = null; }
  }
  function nearestAlive(lane) {
    if (!lane) return null;
    let best = null, bd = 1e9;
    const pp = P()?.position || r9.st;
    for (const it of lane.items) { if (!it.alive) continue; const d = it.home.distanceToSquared(pp); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  function aim(k) {
    if (!r9 || !r9.lanes[k]) return;
    r9.lane = k;
    const L = r9.lanes[k];
    const front = L.base.clone().addScaledVector(L.dir, -1.05);
    try { P()?.walkTo?.({ x: front.x, z: front.z }, { stopDistance: 0.25, path: true, trail: false, onArrive: () => P()?.faceTowards?.(L.base.x, L.base.z) }); } catch (e) { /* walking optional */ }
    renderDock();
  }
  function swing(strong) {
    if (!r9 || r9.swing) return;
    const L = r9.lanes[r9.lane];
    const it = nearestAlive(L) || LANES.map(([k]) => nearestAlive(r9.lanes[k])).find(Boolean);
    r9.swing = { t: 0, strong: !!strong, it, hit: false };
    r9.swings++;
    if (it) P()?.faceTowards?.(it.home.x, it.home.z);
    try { P()?.rig?.setAnim?.('interact', { duration: 0.5 }); } catch (e) { /* anim optional */ }
    sfx('heal_swing', { volume: strong ? 1 : 0.8 });
  }
  function camDirTo(pos, out) {
    const cam = G.sys.engine?.camera || G.camera;
    if (!cam) return out.set(0, 0, -1);
    cam.getWorldPosition(_w);
    return out.set(pos.x - _w.x, 0, pos.z - _w.z).normalize();
  }
  function spawnPieces(it, n, matKey, speed) {
    const away = camDirTo(it.m.position, new THREE.Vector3());
    let made = 0;
    for (const pc of r9.pieces) {
      if (made >= n) break;
      if (pc.m.visible && pc.life < 3.2) continue;
      pc.m.material = mat(matKey);
      pc.m.position.copy(it.m.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.3) * 0.12, (Math.random() - 0.5) * 0.12));
      // out to the sides and up, pushed AWAY from the camera (never at the viewer)
      const a = Math.random() * Math.PI * 2;
      pc.v.set(Math.cos(a) * speed * 0.6, 1.2 + Math.random() * speed * 0.6, Math.sin(a) * speed * 0.6).addScaledVector(away, speed * (0.6 + Math.random() * 0.5));
      if (pc.v.x * away.x + pc.v.z * away.z < 0) { pc.v.x += away.x * speed; pc.v.z += away.z * speed; }
      pc.w.set(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7);
      pc.m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      pc.m.scale.setScalar(0.7 + Math.random() * 0.7);
      pc.m.visible = true; pc.life = 0; pc.rest = false; pc.bounced = 0;
      made++;
    }
  }
  function buzz(ms) { try { if (navigator.vibrate && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) navigator.vibrate(ms); } catch (e) { /* not allowed */ } }
  function hit(it, strong) {
    const v = vis(); if (!v) return;
    v.r9 = v.r9 || { plates: 0, drums: 0, cans: 0, bottles: 0 };
    const pos = it.m.position;
    if (it.k === 'plates' || it.k === 'bottles') {
      it.alive = false; it.m.visible = false;
      spawnPieces(it, strong ? 12 : 8, it.k === 'plates' ? 'shardc' : 'shardg', strong ? 3.2 : 2.3);
      sfx(it.k === 'plates' ? 'heal_plate' : 'heal_glass', { volume: strong ? 1 : 0.85 });
      try { G.fx?.burst?.({ x: pos.x, y: pos.y - 0.1, z: pos.z }, { type: it.k === 'plates' ? 'dust' : 'sparkle', count: strong ? 10 : 6, color: it.k === 'plates' ? '#efe9dd' : '#cfeedd', spread: 0.3 }); } catch (e) { /* fx optional */ }
    } else if (it.k === 'cans') {
      it.alive = false; it.crushT = 0; it.fly = new THREE.Vector3().copy(camDirTo(pos, new THREE.Vector3())).multiplyScalar(strong ? 2.6 : 1.8).add(new THREE.Vector3((Math.random() - 0.5), 1.6, (Math.random() - 0.5)));
      sfx('heal_can', { volume: strong ? 1 : 0.85 });
    } else {
      // a dent: push the vertices that face the stand inwards (the drum never "breaks"; the rack swaps it after six)
      const geo = it.m.geometry, arr = geo.attributes.position.array;
      const pp = P()?.position || r9.st;
      const ang = Math.atan2(pp.x - it.m.position.x, pp.z - it.m.position.z) + (Math.random() - 0.5) * 0.6;
      const hy = (Math.random() - 0.4) * 0.5, depth = strong ? 0.06 : 0.04;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2];
        const r = Math.hypot(x, z); if (r < 0.05) continue;
        let da = Math.atan2(x, z) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
        const f = Math.max(0, 1 - Math.abs(da) / 0.7) * Math.max(0, 1 - Math.abs(y - hy) / 0.3);
        if (f <= 0) continue;
        const nr = Math.max(0.17, r - depth * f);
        arr[i] = x / r * nr; arr[i + 2] = z / r * nr;
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      it.dents++; it.wob = reduced() ? 0 : 1;
      sfx('heal_clang', { volume: strong ? 1 : 0.85 });
      try { G.fx?.burst?.({ x: pos.x, y: pos.y, z: pos.z }, { type: 'sparkle', count: 4, color: '#ffe2a8', spread: 0.2 }); } catch (e) { /* fx optional */ }
      if (it.dents >= 6) it.alive = false;
    }
    v.r9[it.k] = Math.min(D.limits.r9, (v.r9[it.k] || 0) + 1);
    r9.hits++;
    buzz(strong ? 45 : 25);
    mark();
    renderDock(true);
  }
  function refill(lane) {
    for (const it of lane.items) {
      it.alive = true; it.m.visible = true; it.m.position.copy(it.home); it.m.rotation.copy(it.rot0); it.m.scale.set(1, 1, 1); it.crushT = -1; it.fly = null;
      if (it.k === 'drums' && it.m.userData.orig) { it.m.geometry.attributes.position.array.set(it.m.userData.orig); it.m.geometry.attributes.position.needsUpdate = true; it.m.geometry.computeVertexNormals(); it.dents = 0; }
    }
    sfx('pop', { volume: 0.5 });
  }
  function r9Tick(dt) {
    if (!r9) return;
    const s = r9.swing;
    if (s) {
      s.t += dt;
      const dur = s.strong ? 0.34 : 0.26;
      if (props.bat) { const k = clamp(s.t / dur, 0, 1); props.bat.rotation.x = -0.4 - Math.sin(k * Math.PI) * 1.9; props.bat.rotation.z = 0.2 + k * 0.6; }
      if (!s.hit && s.t >= dur * 0.5) { s.hit = true; if (s.it && s.it.alive) hit(s.it, s.strong); }
      if (s.t >= dur + 0.12) { r9.swing = null; if (props.bat) props.bat.rotation.set(-0.4, 0, 0.2); }
    }
    const fy = r9.floorY;
    for (const pc of r9.pieces) {
      if (!pc.m.visible) continue;
      pc.life += dt;
      if (!pc.rest) {
        pc.v.y -= 9.8 * dt;
        pc.m.position.addScaledVector(pc.v, dt);
        pc.m.rotation.x += pc.w.x * dt; pc.m.rotation.y += pc.w.y * dt; pc.m.rotation.z += pc.w.z * dt;
        if (pc.m.position.y < fy + 0.01) {
          pc.m.position.y = fy + 0.01;
          if (pc.bounced < 1 && Math.abs(pc.v.y) > 0.8) { pc.v.y = -pc.v.y * 0.32; pc.v.x *= 0.55; pc.v.z *= 0.55; pc.w.multiplyScalar(0.4); pc.bounced++; }
          else { pc.rest = true; pc.m.rotation.x = Math.PI / 2 * Math.round(pc.m.rotation.x / (Math.PI / 2)); }
        }
      }
      if (pc.life > 3.6) { const k = clamp(1 - (pc.life - 3.6) / 0.6, 0, 1); pc.m.scale.setScalar(Math.max(0.001, k * 0.9)); if (k <= 0) pc.m.visible = false; }
    }
    for (const L of Object.values(r9.lanes)) {
      for (const it of L.items) {
        if (it.k === 'cans' && it.crushT >= 0) {
          it.crushT += dt;
          const k = clamp(it.crushT / 0.08, 0, 1);
          it.m.scale.set(1 + 0.3 * k, 1 - 0.65 * k, 1 + 0.3 * k);
          if (it.fly && it.crushT > 0.08) {
            it.fly.y -= 9.8 * dt; it.m.position.addScaledVector(it.fly, dt); it.m.rotation.z += dt * 6;
            if (it.m.position.y < fy + 0.03) { it.m.position.y = fy + 0.03; if (Math.abs(it.fly.y) > 0.7) { it.fly.y *= -0.3; it.fly.x *= 0.5; it.fly.z *= 0.5; } else it.fly = null; }
          }
        }
        if (it.wob > 0) { it.wob = Math.max(0, it.wob - dt * 1.6); it.m.rotation.z = Math.sin(it.wob * 18) * 0.06 * it.wob; }
      }
      const empty = !L.items.some((x) => x.alive);
      if (empty) { r9.refillT[L.k] = (r9.refillT[L.k] || 0) + dt; if (r9.refillT[L.k] > 1.6) { r9.refillT[L.k] = 0; refill(L); if (ses && ses.room === 'R9') { try { G.ui.toast(`${LANES.find((x) => x[0] === L.k)[2]} 선반이 다시 채워졌어요.`, { emoji: '🔁' }); } catch (e) { /* ui optional */ } } } }
    }
  }

  // ---------------------------------------------------------------- the dock (the step card at the bottom)
  function stepsOf(room) { const R = D.rooms[room]; return room === 'R10' && Hs()?.gentle?.() && R.gentleSteps ? R.gentleSteps : R.steps; }
  function open(room, o) {
    o = o || {};
    const R = D.rooms[room]; if (!R) return false;
    const pid = Hs()?.placeFor?.(room);
    const here = G.sys.places?.current;
    if (pid && here !== pid) { Hs().go(room).then((ok) => { if (ok) setTimeout(() => begin(room, o), 400); }); return true; }
    begin(room, o);
    return true;
  }
  function begin(room, o) {
    close('switch');
    const v = vis(); const c = v && v.rooms[room];
    const steps = stepsOf(room);
    ses = { room, R: D.rooms[room], steps, i: o.again ? 0 : clamp((c && c.step) || 0, 0, steps.length), hold: false, holdT: 0, taps: 0, lastTap: -9, done: 0, t: 0, sub: {}, again: !!o.again };
    buildProps(room);
    if (room === 'R9') batOn(true);
    ensureDock();
    enterStep();
    say(room === 'R10' && Hs()?.gentle?.() ? ses.R.gentleSays.in : ses.R.says.in);
    return true;
  }
  function close(reason) {
    if (ses && ses.veil) veil(null);
    unpose(); batOn(false);
    if (dock) { dock.remove(); dock = null; }
    ses = null;
    if (reason !== 'switch') clearProps();
  }
  function ensureDock() {
    if (dock) return dock;
    dock = h('section', { id: 'heal-dock', class: 'heal-dock', role: 'region', 'aria-label': '힐링관 체험' });
    document.body.appendChild(dock);
    return dock;
  }
  const curStep = () => (ses && ses.i < ses.steps.length ? ses.steps[ses.i] : null);
  function walkTo(key, then) {
    const at = stationPos(ses.room, key) || stationPos(ses.room, 'spot');
    const p = P();
    if (!at || !p?.walkTo) { then && then(); return; }
    const d = Math.hypot(p.position.x - at.x, p.position.z - at.z);
    if (d < 1.6) { then && then(); return; }
    try { p.walkTo({ x: at.x, z: at.z }, { stopDistance: 1.1, trail: true, onArrive: () => { p.faceTowards?.(at.x, at.z); then && then(); }, onFail: () => then && then() }); } catch (e) { then && then(); }
  }
  function enterStep() {
    if (!ses) return;
    const s = curStep();
    ses.hold = false; ses.holdT = 0; ses.taps = 0; ses.sub = {}; ses.t = 0;
    if (!s) { restMode(); return; }
    ses.mode = s.k;
    walkTo(s.at, () => {
      if (!ses || curStep() !== s) return;
      const at = stationPos(ses.room, s.at);
      if (s.k === 'hold' && /엎드|눕|누워|담요/.test(s.t) && at) { /* posed when the hold completes */ }
      if ((s.k === 'breath' || (s.k === 'hold' && /앉/.test(s.t))) && at && ses.room !== 'R7') { /* sitting comes with the hold */ }
    });
    renderDock();
    say(s.say);
  }
  function stepDone() {
    if (!ses) return;
    const s = curStep();
    const room = ses.room;
    sfx('correct', { volume: 0.6 });
    // the pose a finished hold leaves the visitor in (the next steps happen lying or sitting)
    if (s && s.k === 'hold') {
      const at = stationPos(room, s.at) || stationPos(room, 'spot');
      const yaw = stationYaw(room, s.at) ?? stationYaw(room, 'spot');
      if (/엎드/.test(s.t)) lie(at, true, yaw);
      else if (/바로 누워|돌아누워|눕|누워|담요/.test(s.t)) lie(at, false, yaw);
      else if (/앉/.test(s.t)) sit(at);
    }
    if (room === 'R5' && props.water && s && (s.k === 'taps' || s.k === 'hold')) props.water.visible = true;
    if (room === 'R1' && ses.i === ses.steps.length - 1) finishR1();
    ses.i++;
    if (!ses.again) Hs()?.stepOf?.(room, ses.i);
    enterStep();
  }
  function restMode() {
    if (!ses) return;
    ses.mode = 'rest';
    if (ses.room === 'R9') { /* the bat stays: the visitor may keep swinging */ }
    renderDock();
    say(ses.room === 'R10' && Hs()?.gentle?.() ? ses.R.gentleSays.rest : ses.R.says.rest);
  }
  function ended(room) {
    if (!ses || ses.room !== room) return;
    ses.ended = true;
    try { G.fx?.stamp?.('도장 쾅!', { sub: Hs().roomName(room) }); } catch (e) { /* fx optional */ }
    say(room === 'R10' && Hs()?.gentle?.() ? ses.R.gentleSays.end : ses.R.says.end);
    renderDock();
  }

  // R1: the play values and 오늘의 쉼 안내
  function finishR1() {
    const v = vis(); if (!v) return;
    const seed = parseInt(String(v.id).slice(1, 7), 36) || 7;
    const m = D.measure(v.base || D.base({}, {}), seed, {});
    v.r1 = Object.assign({}, m, { pat: ses.sub.pat || v.r1?.pat || '' });
    mark();
  }

  const BIG = (label, emoji, extra) => h('button', Object.assign({ type: 'button', class: 'heal-big', 'data-say': label }, extra || {}), h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'hb-l' }, label), h('i', { class: 'hb-fill', 'aria-hidden': 'true' }));
  function bindPress(btn) {
    const down = (e) => { e.preventDefault?.(); press(); };
    const up = () => release();
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
    btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); press(); } });
    btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); release(); } });
    return btn;
  }
  function renderDock(soft) {
    if (!dock || !ses) return;
    const H = Hs();
    const room = ses.room, R = ses.R, s = curStep();
    if (soft && dock.firstChild) { updateDock(); return; }
    dock.replaceChildren();
    const c = vis()?.rooms?.[room];
    dock.appendChild(h('header', { class: 'hd-head' },
      h('span', { class: 'emoji hd-ico', 'aria-hidden': 'true' }, H.roomEmoji(room)),
      h('span', { class: 'hd-title' }, h('b', {}, H.roomName(room)), h('small', { class: 'hd-sub' }, ses.mode === 'rest' ? (ses.ended ? '도장을 받았어요' : '쉬는 중') : `${ses.i + 1} / ${ses.steps.length} 단계`)),
      h('button', { type: 'button', class: 'hd-x', 'aria-label': '닫기 (코스는 계속돼요)', 'data-say': '닫아요. 코스는 계속돼요.', onclick: () => close('user') }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✖'), h('span', { class: 'hd-x-l' }, '닫기'))));
    if (c && !ses.again) dock.appendChild(H.courseBar(room));
    const body = h('div', { class: 'hd-body' });
    dock.appendChild(body);
    if (ses.mode === 'rest' || !s) { restBody(body); return; }
    body.appendChild(h('p', { class: 'hd-kid', 'data-say': s.say }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, s.emoji), ' ', easyOn() ? s.kid : s.t));
    const k = s.k;
    if (k === 'hold' || k === 'reps' || k === 'strip' || k === 'breath' || k === 'still') {
      const lab = { hold: '꾹 누르고 있어요', reps: '꾹 = 들기 · 놓기 = 내리기', strip: '꾹 눌러 담가요', breath: '꾹 = 들이쉬기 · 놓기 = 내쉬기', still: '가만히 서 있어요' }[k];
      if (k === 'breath') body.appendChild(h('div', { class: 'hd-ring' + (reduced() ? ' still' : '') }, h('i', {})));
      if (k === 'still') body.appendChild(barsR1());
      const btn = bindPress(BIG(lab, s.emoji));
      body.appendChild(h('div', { class: 'hd-ctl' }, btn, h('span', { class: 'hd-count' }, countText())));
    } else if (k === 'taps' || k === 'walk') {
      const btn = BIG(k === 'walk' ? '한 걸음' : '눌러요', s.emoji, { onclick: () => tapOnce() });
      body.appendChild(h('div', { class: 'hd-ctl' }, btn, h('span', { class: 'hd-count' }, countText())));
    } else if (k === 'spots' || k === 'scope') {
      body.appendChild(spotsPanel(s));
    } else if (k === 'pick') {
      body.appendChild(h('div', { class: 'hd-pick' }, ...s.opts.map((o) => h('button', { type: 'button', class: 'heal-tile', 'data-say': o.label, onclick: () => choose(o.id) }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, o.emoji), h('span', {}, o.label)))));
    } else if (k === 'pairs') {
      body.appendChild(pairsPanel());
    } else if (k === 'gear') {
      const have = ses.sub.gear || 0;
      body.appendChild(h('div', { class: 'hd-pick' }, ...[['🥽', '보안경'], ['🧤', '장갑'], ['🦺', '앞치마']].map(([e, l], i) => h('button', { type: 'button', class: 'heal-tile' + (i < have ? ' done' : ''), disabled: i !== have || null, 'data-say': l, onclick: () => { ses.sub.gear = have + 1; sfx('pickup', { volume: 0.6 }); if (ses.sub.gear >= 3) stepDone(); else renderDock(); } }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, e), h('span', {}, i < have ? l + ' ✓' : l)))));
    } else if (k === 'swing') {
      swingBody(body);
    } else if (k === 'portrait') portraitBody(body, s);
    else if (k === 'letter') letterBody(body);
    else if (k === 'lie') lieBody(body, s);
    else if (k === 'three') threeBody(body);
  }
  function updateDock() {
    if (!dock || !ses) return;
    const cnt = dock.querySelector('.hd-count'); if (cnt) cnt.textContent = countText();
    const fill = dock.querySelector('.heal-big .hb-fill');
    if (fill) fill.style.transform = `scaleX(${clamp(fillShare(), 0, 1)})`;
    const cb = dock.querySelector('.heal-course');
    if (cb && ses.room) { const n = Hs().courseBar(ses.room); cb.replaceWith(n); }
    if (ses.room === 'R9') { const t = dock.querySelector('.hd-r9count'); if (t) t.textContent = r9Count(); }
    if (curStep()?.k === 'still') { const b = dock.querySelector('.hd-r1bars'); if (b) b.replaceWith(barsR1()); }
  }
  function countText() {
    const s = curStep(); if (!s) return '';
    if (s.k === 'hold') return s.n > 1 ? `${ses.taps} / ${s.n}` : (ses.hold ? '조금만 더…' : '');
    if (s.k === 'taps') return `${ses.taps} / ${s.n}`;
    if (s.k === 'walk') return `${Math.min(16, ses.taps)} / 16 걸음 · ${['황토', '조약돌', '모래', '황토'][Math.min(3, Math.floor(ses.taps / 4))]} 길`;
    if (s.k === 'reps' || s.k === 'breath') return `${ses.taps} / ${s.n}`;
    if (s.k === 'still') return ses.holdT > 0 ? `${Math.min(s.sec, ses.holdT).toFixed(0)} / ${s.sec}초` : '판 위에서 움직이지 않으면 저절로 차올라요';
    if (s.k === 'strip') return ses.holdT >= s.sec ? '' : '';
    return '';
  }
  function fillShare() {
    const s = curStep(); if (!s) return 0;
    if (s.k === 'hold' || s.k === 'strip' || s.k === 'still') return ses.holdT / s.sec;
    if (s.k === 'reps') return ses.holdT / s.sec;
    if (s.k === 'breath') return ses.holdT / 4;
    if (s.k === 'taps') return ses.taps / s.n;
    if (s.k === 'walk') return ses.taps / 16;
    return 0;
  }
  function barsR1() {
    const s = curStep(); const v = vis();
    const k = s && s.k === 'still' ? clamp(ses.holdT / s.sec, 0, 1) : 1;
    const m = D.measure(v?.base || D.base({}, {}), 7, {});
    return h('div', { class: 'hd-r1bars' }, ...[['⚖️ 균형', m.balance], ['🌬️ 숨', m.breath], ['🧍 자세', m.posture]].map(([l, x]) => h('div', { class: 'hd-r1b' }, h('span', {}, l), h('span', { class: 'bar' }, h('i', { style: { width: Math.round(x * k) + '%' } })), h('b', {}, String(Math.round(x * k))))));
  }
  function spotsPanel(s) {
    const pts = s.k === 'scope' ? Array.from({ length: s.n }, (_, i) => [18 + ((i * 37) % 64), 22 + ((i * 53) % 56)]) : s.pts;
    const done = ses.sub.done || 0;
    const pic = { back: '🧍', belly: '🧍', foot: '🦶', face: '🙂', body: '🧍' }[s.pic] || '🔬';
    const panel = h('div', { class: 'hd-spots' + (s.k === 'scope' ? ' scope' : '') + ' p-' + (s.pic || 'scope') },
      h('span', { class: 'hd-pic emoji', 'aria-hidden': 'true' }, s.k === 'scope' ? '' : pic));
    pts.forEach(([x, y], i) => {
      const b = h('button', {
        type: 'button', class: 'hd-spot' + (i < done ? ' done' : i === done ? ' now' : ''), style: { left: x + '%', top: y + '%' }, 'aria-label': `${i + 1}번째 자리`, 'data-say': i === done ? '여기를 눌러요' : '',
        onclick: () => tapSpot(i),
      }, s.k === 'scope' ? h('span', { class: 'emoji', 'aria-hidden': 'true' }, ['🦠', '🟢', '🟡', '🔵', '🟣'][i % 5]) : null);
      panel.appendChild(b);
    });
    return h('div', { class: 'hd-spotwrap' }, panel, h('span', { class: 'hd-count' }, `${done} / ${pts.length}`));
  }
  const BASE_PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
  function pairsPanel() {
    const s = curStep(); const n = s.n;
    ses.sub.seq = ses.sub.seq || Array.from({ length: n }, (_, i) => 'ATGC'[(i * 3 + (vis()?.at || 0)) % 4]);
    const i = ses.sub.done || 0;
    const left = ses.sub.seq[i] || 'A';
    const right = BASE_PAIR[left];
    const other = ['A', 'T', 'G', 'C'].find((x) => x !== right && x !== left) || 'G';
    const opts = (i % 2 ? [right, other] : [other, right]);
    const wrap = h('div', { class: 'hd-helix' },
      h('div', { class: 'hd-rungs' }, ...ses.sub.seq.map((b, j) => h('span', { class: 'hd-rung' + (j < i ? ' done' : j === i ? ' now' : '') }, h('b', { class: 'b-' + b }, b), h('i', {}), h('b', { class: j < i ? 'b-' + BASE_PAIR[b] : '' }, j < i ? BASE_PAIR[b] : '?')))),
      h('p', { class: 'hd-hint' }, `${left}의 짝꿍은 누구일까요?`),
      h('div', { class: 'hd-pick' }, ...opts.map((x) => h('button', { type: 'button', class: 'heal-tile base b-' + x, 'data-say': x, onclick: (e) => pairPick(x, right, e.currentTarget) }, h('b', { class: 'big' }, x)))));
    return wrap;
  }
  function pairPick(x, right, el) {
    if (x !== right) { el.classList.remove('wiggle'); void el.offsetWidth; el.classList.add('wiggle'); say('다른 짝꿍을 골라 봐요.'); sfx('tap', { volume: 0.4 }); return; }
    ses.sub.done = (ses.sub.done || 0) + 1;
    ses.sub.pat = (ses.sub.pat || '') + ses.sub.seq[ses.sub.done - 1];
    sfx('correct', { volume: 0.5 });
    if (ses.sub.done >= curStep().n) stepDone(); else renderDock();
  }
  function tapSpot(i) {
    const s = curStep(); if (!s || (s.k !== 'spots' && s.k !== 'scope')) return;
    const done = ses.sub.done || 0;
    if (i !== done) { say('빛나는 곳을 눌러요.'); return; }
    ses.sub.done = done + 1;
    sfx(ses.room === 'R2' ? 'heal_ember' : 'tap', { volume: 0.55 });
    if (ses.room === 'R2') { const o = props.items[done % Math.max(1, props.items.length)]; const p = P()?.position; if (o && p) o.position.set(p.x - 0.2 + (done % 5) * 0.1, (p.y || 0) + 0.42, p.z + ((done % 2) ? 0.08 : -0.08)); }
    const total = s.k === 'scope' ? s.n : s.pts.length;
    if (ses.sub.done >= total) stepDone(); else renderDock();
  }
  function choose(id) {
    const s = curStep(); if (!s || s.k !== 'pick') return;
    ses.sub.pick = id;
    if (ses.room === 'R5' || ses.room === 'R3') { const at = stationPos(ses.room, ses.room === 'R5' ? 'tub' : 'pot'); if (at) { try { G.fx?.burst?.(at, { type: 'leaves', count: 6, spread: 0.2 }); } catch (e) { /* fx optional */ } } }
    sfx('pickup', { volume: 0.6 });
    stepDone();
  }
  function tapOnce() {
    const s = curStep(); if (!s) return;
    const t = performance.now() / 1000;
    if (t - ses.lastTap < 0.5) return;   // no fast tapping: a calm pace is the only pace
    ses.lastTap = t; ses.taps++;
    if (s.k === 'taps') { sfx(ses.room === 'R5' ? 'heal_pour' : 'tap', { volume: 0.7 }); const at = stationPos(ses.room, 'tub'); if (ses.room === 'R5' && at) { try { G.fx?.burst?.({ x: at.x, y: (at.y || 0) + 0.3, z: at.z }, { type: 'splash', count: 6 }); } catch (e) { /* fx optional */ } if (props.water) props.water.visible = true; } }
    if (s.k === 'walk') { trackStep(); }
    if ((s.k === 'taps' && ses.taps >= s.n) || (s.k === 'walk' && ses.taps >= 16)) stepDone(); else updateDock();
  }
  function trackStep() {
    const at = stationPos(ses.room, 'track') || stationPos(ses.room, 'spot'); const p = P();
    if (!at || !p?.walkTo) return;
    const a = (ses.taps / 16) * Math.PI * 2;
    try { p.walkTo({ x: at.x + Math.cos(a) * 2.4, z: at.z + Math.sin(a) * 2.4 }, { stopDistance: 0.3, trail: false }); } catch (e) { /* walking optional */ }
    sfx('step', { volume: 0.8, surface: ['earth', 'stone', 'sand', 'earth'][Math.min(3, Math.floor(ses.taps / 4))] });
  }
  function press() {
    if (!ses) return;
    const s = curStep();
    if (ses.room === 'R9' && (s?.k === 'swing' || ses.mode === 'rest')) { ses.hold = true; ses.holdT = 0; return; }
    if (!s) return;
    ses.hold = true;
    if (s.k === 'reps' || s.k === 'breath') ses.holdT = 0;
  }
  function release() {
    if (!ses || !ses.hold) return;
    ses.hold = false;
    const s = curStep();
    if (ses.room === 'R9' && (s?.k === 'swing' || ses.mode === 'rest')) { swing(ses.holdT >= 0.45); ses.holdT = 0; return; }
    if (!s) return;
    if (s.k === 'reps') { if (ses.holdT >= s.sec * 0.6) { ses.taps++; sfx('tap', { volume: 0.5 }); if (ses.taps >= s.n) { stepDone(); return; } } ses.holdT = 0; updateDock(); }
    if (s.k === 'breath') { if (ses.holdT >= 1.2) { ses.taps++; sfx('heal_steam', { volume: 0.35 }); if (ses.taps >= s.n) { stepDone(); return; } } ses.holdT = 0; updateDock(); }
  }
  function frame(dt) {
    if (pose && pose.kind === 'lie') placeLying();
    if (!ses) return;
    ses.t += dt;
    const s = curStep();
    if (ses.room === 'R9' && ses.hold) { ses.holdT += dt; const f = dock?.querySelector('.heal-big .hb-fill'); if (f) f.style.transform = `scaleX(${clamp(ses.holdT / 0.45, 0, 1)})`; }
    if (!s) return;
    if (s.k === 'still') {
      const p = P(); const moving = p && p.velocity && Math.hypot(p.velocity.x, p.velocity.z) > 0.3;
      if (!moving || ses.hold) ses.holdT += dt;
      if (ses.holdT >= s.sec) { stepDone(); return; }
    } else if ((s.k === 'hold' || s.k === 'strip') && ses.hold) {
      ses.holdT += dt;
      if (ses.holdT >= s.sec) {
        if (s.k === 'strip') { const v = vis(); const m = D.measure(v?.base || D.base({}, {}), 7, {}); try { G.ui.toast(`🧪 색깔 종이: ${m.salt < 40 ? '연한 노랑 — 싱거운 편' : m.salt < 60 ? '주황 — 알맞아요' : '진한 빨강 — 조금 짠 편'} (놀이 값)`, { emoji: '🧪' }); } catch (e) { /* ui optional */ } }
        ses.taps++; ses.holdT = 0; ses.hold = false;
        if (ses.taps >= (s.n || 1)) { stepDone(); return; }
      }
    } else if ((s.k === 'reps' || s.k === 'breath') && ses.hold) ses.holdT += dt;
    if (((ses.t * 4) | 0) !== (((ses.t - dt) * 4) | 0)) updateDock();
  }

  // the rest: the course bar, one small thing now and then, ⏸️ / 🗺️ / next room
  function restBody(body) {
    const room = ses.room, R = ses.R, H = Hs();
    const v = vis(), c = v?.rooms?.[room];
    if (room === 'R9') swingBody(body);
    body.appendChild(h('p', { class: 'hd-kid' }, ses.ended ? (room === 'R10' && H.gentle() ? R.gentleSays.end : R.says.end) : (room === 'R10' && H.gentle() ? R.gentleSays.rest : R.says.rest)));
    if (room === 'R1' && v?.r1) body.appendChild(adviceCard());
    const row = h('div', { class: 'hd-row' });
    if (!ses.ended && c && !c.done) {
      const elapsed = H.now() - c.at, scale = H.scale();
      const ready = Math.floor((elapsed * scale) / LITTLE_EVERY) >= (c.small || 0) || (c.small || 0) === 0;
      const lit = R.little[(c.small || 0) % R.little.length];
      if (lit) row.appendChild(h('button', { type: 'button', class: 'btn heal-btn' + (ready ? ' ready' : ''), 'data-say': lit.label, onclick: () => {
        const c2 = vis()?.rooms?.[room]; const el = H.now() - (c2?.at || 0);
        if (!(Math.floor((el * H.scale()) / LITTLE_EVERY) >= (c2?.small || 0) || !(c2?.small))) { try { G.ui.toast('조금 뒤에 또 해요. 지금은 편히 쉬어요.', { emoji: lit.emoji }); } catch (e) { /* ui */ } return; }
        H.little(room); try { G.fx?.emoji3d?.(P()?.object, lit.emoji, { rise: 0.8 }); } catch (e) { /* fx optional */ } renderDock();
      } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, lit.emoji), h('span', {}, lit.label)));
      row.appendChild(h('button', { type: 'button', class: 'btn heal-btn', 'data-say': '오늘은 그만해요', onclick: () => { H.stop(room); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⏸️'), h('span', {}, '오늘은 그만')));
    }
    if (ses.ended || c?.done) {
      const next = H.plan().find((id) => !(v?.rooms?.[id]?.done) && id !== room);
      if (next) row.appendChild(h('button', { type: 'button', class: 'btn btn-primary heal-btn', 'data-say': '다음 관으로 가요', onclick: () => { close('user'); H.go(next).then(() => H.openRoom(next)); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '➡️'), h('span', {}, `다음: ${H.roomName(next)}`)));
      else row.appendChild(h('button', { type: 'button', class: 'btn btn-primary heal-btn', 'data-say': '종합 리포트를 봐요', onclick: () => { close('user'); H.openReport(); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📋'), h('span', {}, '종합 리포트')));
    }
    row.appendChild(h('button', { type: 'button', class: 'btn heal-btn', 'data-say': '복도 지도', onclick: () => H.openMap() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🗺️'), h('span', {}, '지도')));
    body.appendChild(row);
  }
  function adviceCard() {
    const H = Hs(), v = vis();
    const m = v.r1;
    return h('div', { class: 'hd-advice' }, h('b', {}, `📋 ${D.words.advice}`),
      h('p', {}, `균형 ${m.balance} · 숨 ${m.breath} · 자세 ${m.posture} · 고마운 미생물 ${m.microbes} · 짠맛 색 ${m.salt} (놀이 값)`),
      h('ol', {}, ...H.plan().slice(1, 5).map((id) => h('li', {}, `${H.roomEmoji(id)} ${H.roomName(id)} — ${D.rooms[id].min}분`))),
      h('small', {}, D.words.claim));
  }
  function r9Count() { const r = vis()?.r9 || {}; return `🍽️ ${r.plates || 0} · 🛢️ ${r.drums || 0} · 🥫 ${r.cans || 0} · 🍾 ${r.bottles || 0}`; }
  function swingBody(body) {
    if (!r9) buildR9();
    body.appendChild(h('div', { class: 'hd-lanes' }, ...LANES.map(([k, e, l]) => h('button', { type: 'button', class: 'heal-tile lane' + (r9 && r9.lane === k ? ' on' : ''), 'data-say': l, onclick: () => aim(k) }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, e), h('span', {}, l)))));
    const btn = bindPress(BIG('휘두르기 (꾹 = 세게)', '⚾'));
    btn.classList.add('swing');
    body.appendChild(h('div', { class: 'hd-ctl' }, btn, h('span', { class: 'hd-count hd-r9count' }, r9Count())));
    if (curStep()?.k === 'swing' && (vis()?.r9 ? Object.values(vis().r9).reduce((a, b) => a + b, 0) : 0) >= 4) body.appendChild(h('button', { type: 'button', class: 'btn heal-btn', 'data-say': '이제 쉬어요', onclick: () => stepDone() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '😌'), h('span', {}, '이제 쉬기')));
  }

  // room 10 ------------------------------------------------------------------------------------------------------
  function veil(kind) {
    let el = document.getElementById('heal-veil');
    if (!kind) { if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 1200); } if (ses) ses.veil = null; return; }
    if (!el) { el = h('div', { id: 'heal-veil', class: 'heal-veil', 'aria-hidden': 'true' }); document.body.appendChild(el); }
    el.className = 'heal-veil v-' + kind;
    requestAnimationFrame(() => el.classList.add('on'));
    if (ses) ses.veil = kind;
  }
  function portraitBody(body, s) {
    const H = Hs(); const loc = H.local();
    const g = H.gentle();
    const frame = h('div', { class: 'heal-portrait s-' + (loc.style || (g ? 'flower' : 'classic')) }, loc.portrait ? h('img', { src: loc.portrait, alt: g ? '오늘의 나 사진' : '영정 사진' }) : h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖼️'));
    body.appendChild(frame);
    body.appendChild(h('div', { class: 'hd-pick small' }, ...D.portraitStyles.filter((x) => !g || x.id !== 'classic').map((x) => h('button', { type: 'button', class: 'heal-tile' + (loc.style === x.id ? ' on' : ''), 'data-say': x.label, onclick: () => { H.setLocal({ style: x.id }); renderDock(); } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, x.emoji), h('span', {}, x.label)))));
    const row = h('div', { class: 'hd-row' },
      h('button', { type: 'button', class: 'btn btn-primary heal-btn', 'data-say': '사진을 찍어요', onclick: () => shoot() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📸'), h('span', {}, loc.portrait ? '다시 찍기' : '찍기')));
    if (loc.portrait) row.appendChild(h('button', { type: 'button', class: 'btn heal-btn', 'data-say': '다음으로', onclick: () => stepDone() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '➡️'), h('span', {}, '다음')));
    body.appendChild(row);
    body.appendChild(h('small', { class: 'hd-note' }, '사진은 이 기기에만 남아요.'));
  }
  /** a few rendered frames (the camera has moved: the snapshot must show the new view) */
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(res, 4000); });
  /** the middle of the wide view as a 4 : 5 portrait, 240 × 300 JPEG (small: it lives in this device's storage) */
  function cropPortrait(url) {
    return new Promise((res) => {
      try {
        const img = new Image();
        img.onload = () => { try { const W = 240, Hh = 300, c = document.createElement('canvas'); c.width = W; c.height = Hh; const x = c.getContext('2d'); const sh = img.height, sw = sh * W / Hh; x.drawImage(img, (img.width - sw) / 2, 0, sw, sh, 0, 0, W, Hh); res(c.toDataURL('image/jpeg', 0.82)); } catch (e) { res(url); } };
        img.onerror = () => res(url);
        img.src = url;
      } catch (e) { res(url); }
    });
  }
  async function shoot() {
    const H = Hs();
    let url = null;
    // frame the face: the visitor on the studio stool facing the camera on its tripod (the hall's 'camera' station), a
    // narrow lens like a portrait studio; the follow camera comes back afterwards
    const p = P(), cam = G.sys.camera;
    let framed = false;
    try {
      const st = stationPos('R10', 'studio');
      if (st && p) { p.cancelWalk?.('heal'); p.position.set(st.x, p.position.y, st.z); }
      const c = stationPos('R10', 'camera');
      if (p && cam?.shot) {
        const head = new THREE.Vector3(p.position.x, p.position.y + 1.22, p.position.z);
        const from = c ? new THREE.Vector3(c.x, head.y + 0.05, c.z) : new THREE.Vector3(p.position.x + Math.sin(p.rotY || 0) * 2.2, head.y + 0.05, p.position.z + Math.cos(p.rotY || 0) * 2.2);
        p.faceTowards?.(from.x, from.z);
        cam.shot(from, head, { fov: 26, duration: 0 });
        framed = true;
        await frames(4);
      }
    } catch (e) { G.log.warn('HEAL', 'portrait framing failed', e?.message || e); }
    sfx('shutter');
    try {
      const snap = G.sys.photo?.snapshot;
      const blob = typeof snap === 'function' ? await snap.call(G.sys.photo, { format: 'jpg', quality: 0.85, maxWidth: 640, maxHeight: 400 }) : null;
      if (blob) url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => res(null); r.readAsDataURL(blob); });
    } catch (e) { G.log.warn('HEAL', 'portrait snapshot failed', e?.message || e); }
    if (!url) { try { const c = document.createElement('canvas'); c.width = c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#e8dcc6'; x.fillRect(0, 0, 160, 160); x.fillStyle = '#4a3a2c'; x.beginPath(); x.arc(80, 62, 30, 0, 7); x.fill(); x.fillRect(38, 100, 84, 60); url = c.toDataURL('image/jpeg', 0.8); } catch (e) { url = null; } }
    if (url && framed) url = await cropPortrait(url);
    if (framed) { try { cam.setMode?.('follow'); } catch (e) { /* camera optional */ } }
    if (url) H.setLocal({ portrait: url, style: H.local().style || (H.gentle() ? 'flower' : 'classic') });
    renderDock();
  }
  function letterBody(body) {
    const H = Hs(); const g = H.gentle();
    const list = g ? D.letter.gentle : D.letter.full;
    const loc = H.local(); const sel = Array.isArray(loc.cards) ? loc.cards.slice() : [];
    body.appendChild(h('div', { class: 'heal-letter live' }, h('b', {}, g ? '💌 고마운 마음 편지' : '✉️ 나의 편지'), ...sel.map((i) => h('p', {}, list[i] || '')), loc.text ? h('p', { class: 'own' }, loc.text) : null, !sel.length && !loc.text ? h('p', { class: 'hd-hint' }, '아래 카드를 골라 이어 붙여요') : null));
    body.appendChild(h('div', { class: 'hd-cards' }, ...list.map((t, i) => h('button', { type: 'button', class: 'heal-card' + (sel.includes(i) ? ' on' : ''), 'data-say': t, onclick: () => {
      const cur = H.local().cards || []; const at = cur.indexOf(i);
      const next = at >= 0 ? cur.filter((x) => x !== i) : cur.concat([i]).slice(-D.letter.max);
      H.setLocal({ cards: next }); sfx('page', { volume: 0.5 }); renderDock();
    } }, t))));
    const row = h('div', { class: 'hd-row' });
    row.appendChild(h('button', { type: 'button', class: 'btn heal-btn', 'data-say': '직접 써요', onclick: () => typeOwn() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✍️'), h('span', {}, '직접 쓰기')));
    if (sel.length || loc.text) row.appendChild(h('button', { type: 'button', class: 'btn btn-primary heal-btn', 'data-say': '다 썼어요', onclick: () => stepDone() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✅'), h('span', {}, '다 썼어요')));
    body.appendChild(row);
    body.appendChild(h('small', { class: 'hd-note' }, '편지는 이 기기에만 남아요. 서버로 보내지 않아요.'));
  }
  async function typeOwn() {
    // typing: free in normal mode, behind the grown-up gate in easy mode (§12: no typing for children)
    if (easyOn()) { const ok = await (G.easy?.gate?.({ reason: 'heal-letter', title: '어른과 함께 써요' }) || Promise.resolve(false)); if (!ok) return; }
    const H = Hs();
    G.ui.modal.open({
      id: 'heal-type', title: '편지 직접 쓰기', icon: '✍️', size: 'sm', className: 'heal-modal',
      body: (el) => { const ta = h('textarea', { class: 'heal-ta', maxlength: '300', rows: '5', 'aria-label': '편지' }); ta.value = H.local().text || ''; el.appendChild(ta); el.appendChild(h('small', {}, '300자까지 · 이 기기에만 남아요')); },
      actions: [{ label: '저장', class: 'btn-primary', onClick: (m) => { const ta = m.el?.querySelector?.('textarea') || document.querySelector('#modal-root .heal-ta'); H.setLocal({ text: String(ta?.value || '').slice(0, 300) }); renderDock(); } }, { label: '닫기' }],
    });
  }
  function lieBody(body, s) {
    const H = Hs(); const g = H.gentle();
    const at = (!g && stationPos('R10', 'coffin')) || stationPos('R10', 'rest');
    if (!ses.sub.lying) {
      ses.sub.lying = performance.now();
      lie(at, false, stationYaw('R10', !g && stationPos('R10', 'coffin') ? 'coffin' : 'rest'));
      if (props.lid && props.lidHome) { props.lid.position.set(props.lidHome.x, props.lidHome.y, props.lidHome.z); }
      veil(g ? 'stars' : 'dark');
      sfx('heal_bell', { volume: 0.6 });
      ses.sub.voice = 0;
    }
    body.appendChild(h('div', { class: 'hd-ring slow' + (reduced() ? ' still' : '') }, h('i', {})));
    const lines = g ? ['별빛이 반짝여요.', '천천히 숨을 들이쉬어요.', '오늘 고마웠던 일을 떠올려요.', '마음이 포근해져요.'] : ['천천히 숨을 들이쉬고, 내쉬어요.', '고마웠던 사람들을 떠올려요.', '오늘 하루가 참 소중해요.', '이제 아침 햇살이 들어와요.'];
    body.appendChild(h('p', { class: 'hd-kid hd-voice' }, lines[ses.sub.voice % lines.length]));
    const wait = g ? 8 : 15;
    const okAt = (performance.now() - ses.sub.lying) / 1000 >= wait;
    body.appendChild(h('div', { class: 'hd-row' }, h('button', { type: 'button', class: 'btn btn-primary heal-btn' + (okAt ? '' : ' wait'), 'data-say': g ? '일어나요' : '뚜껑을 열어요', onclick: () => {
      if ((performance.now() - ses.sub.lying) / 1000 < wait) { try { G.ui.toast('조금만 더 쉬어요. 천천히 숨 쉬어요.', { emoji: '🌬️' }); } catch (e) { /* ui */ } return; }
      wake();
    } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, g ? '🌅' : '☀️'), h('span', {}, g ? '일어나기' : '뚜껑 열기'))));
  }
  function wake() {
    const g = Hs().gentle();
    if (props.lid && props.lidHome) { const lid = props.lid, a = props.lidHome, b = props.lidOpen; const t0 = performance.now(); const go = () => { const k = clamp((performance.now() - t0) / 2200, 0, 1); const e = k * k * (3 - 2 * k); lid.position.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e + Math.sin(e * Math.PI) * 0.25, a.z + (b.z - a.z) * e); if (k < 1 && lid.parent) requestAnimationFrame(go); }; go(); }
    else if (props.lid) { const lid = props.lid; const t0 = performance.now(); const go = () => { const k = clamp((performance.now() - t0) / 2200, 0, 1); lid.position.z = 0.7 + k * 0.6; lid.position.y = 0.56 - k * 0.5; if (k < 1 && lid.parent) requestAnimationFrame(go); }; go(); }
    veil(g ? 'dawn' : 'morning');
    sfx('heal_bell', { volume: 0.5 });
    setTimeout(() => { veil(null); unpose(); }, 3200);
    stepDone();
  }
  function threeBody(body) {
    const H = Hs(); const loc = H.local(); const sel = Array.isArray(loc.three) ? loc.three.slice() : [];
    body.appendChild(h('div', { class: 'hd-pick three' }, ...D.three.map((x) => h('button', { type: 'button', class: 'heal-tile' + (sel.includes(x.id) ? ' on' : ''), 'data-say': x.label, onclick: () => {
      const cur = H.local().three || []; const next = cur.includes(x.id) ? cur.filter((y) => y !== x.id) : cur.concat([x.id]).slice(-3);
      H.setLocal({ three: next }); sfx('tap', { volume: 0.5 }); renderDock();
    } }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, x.emoji), h('span', {}, x.label)))));
    if (sel.length >= 3) body.appendChild(h('div', { class: 'hd-row' }, h('button', { type: 'button', class: 'btn btn-primary heal-btn', 'data-say': '골랐어요', onclick: () => stepDone() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💐'), h('span', {}, '골랐어요'))));
    else body.appendChild(h('small', { class: 'hd-note' }, `${sel.length} / 3 골랐어요`));
  }

  // ---------------------------------------------------------------- tests: play the open room's steps like a calm visitor
  function auto(maxSec) {
    const log = [];
    let tt = 0;
    while (ses && ses.mode !== 'rest' && tt < (maxSec || 240)) {
      const s = curStep(); if (!s) break;
      if (!log.length || log[log.length - 1].i !== ses.i) log.push({ i: ses.i, k: s.k });
      const k = s.k;
      if (k === 'hold' || k === 'strip' || k === 'still') { if (!ses.hold) press(); }
      else if (k === 'reps' || k === 'breath') { if (!ses.hold) press(); else if (ses.holdT >= (k === 'reps' ? s.sec : 1.5)) release(); }
      else if (k === 'taps' || k === 'walk') { ses.lastTap = -9; tapOnce(); }
      else if (k === 'spots' || k === 'scope') tapSpot(ses.sub.done || 0);
      else if (k === 'pick') choose(s.opts[0].id);
      else if (k === 'pairs') { const i = ses.sub.done || 0; pairsPanel(); pairPick(BASE_PAIR[ses.sub.seq[i]], BASE_PAIR[ses.sub.seq[i]], document.createElement('b')); }
      else if (k === 'gear') { ses.sub.gear = 3; stepDone(); }
      else if (k === 'swing') { for (let n = 0; n < 6; n++) { swing(n % 2 === 1); for (let f = 0; f < 20; f++) r9Tick(1 / 30); } stepDone(); }
      else if (k === 'portrait') { Hs().setLocal({ portrait: 'data:image/jpeg;base64,/9j/', style: 'hanji' }); stepDone(); }
      else if (k === 'letter') { Hs().setLocal({ cards: [0, 2] }); stepDone(); }
      else if (k === 'lie') { if (!ses.sub.lying) { renderDock(); } ses.sub.lying = performance.now() - 60000; wake(); }
      else if (k === 'three') { Hs().setLocal({ three: ['family', 'friend', 'today'] }); stepDone(); }
      if (!ses) break;
      frame(1 / 30); tt += 1 / 30;
    }
    return log;
  }

  G.healActs = {
    open, close, ended, auto, press, release, tapSpot, choose,
    left() { if (ses) close('left'); },
    station(room) { if (props.room === room && ses) { buildProps(room); if (room === 'R9') batOn(true); } },
    get current() { return ses ? ses.room : null; },
    get state() { return ses ? { room: ses.room, i: ses.i, of: ses.steps.length, mode: ses.mode, rest: ses.mode === 'rest', ended: !!ses.ended } : null; },
    get r9() { return r9 ? { lane: r9.lane, swings: r9.swings, hits: r9.hits, lanes: Object.fromEntries(Object.entries(r9.lanes).map(([k, L]) => [k, L.items.map((x) => (x.alive ? 1 : 0))])), pieces: r9.pieces.filter((p) => p.m.visible).length, maxPieceY: Math.max(0, ...r9.pieces.filter((p) => p.m.visible).map((p) => p.m.position.y - r9.floorY)) } : null; },
    aim: (k) => aim(k), swing: (strong) => swing(strong),
  };
  G.register({
    name: 'healacts', order: 67, label: '힐링관 체험',
    init() {
      G.bus.on('game:logout', () => close('logout'));
      G.ui.onEscape?.(() => { if (!dock || G.ui.isBlocking?.()) return false; close('user'); return true; }, 5);
    },
    update(dt, t) {
      try {
        frame(dt);
        for (const f of props.update) f(dt, t ?? performance.now() / 1000);
      } catch (e) {
        const msg = String(e && e.stack || e).slice(0, 300);
        if (this._lastError !== msg) { this._lastError = msg; G.log.warn('HEAL', 'acts frame failed', msg); }
      }
    },
  });
})();
