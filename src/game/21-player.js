// =============================================================================
// 21-player.js — local player controller (G.sys.player)
//
//   object, position, rotY, velocity, grounded, rig, radius, enabled, speed, sitting, isWalking, walkInfo
//   teleport(x, z, rotY?, {fade=true}) -> Promise
//   walkTo({x,z}, {stopDistance=1.2, onArrive, onFail, run, path=true, rescue, trail, label}) -> walk id | false
//        path: plan around colliders (grid A* + string pulling, re-planned when blocked)
//        rescue (default: easy mode): never stays stuck — after re-plans / a time budget it fades and
//               teleports next to the destination, then arrives normally (the walk id stays the same)
//        trail  (default: easy mode): golden footprints along the planned route + a bouncing star at the goal
//   cancelWalk(reason), planPath(from, to) -> [{x,z}...] | null, playAction(anim, {duration, loop}),
//   stopAction(), faceTowards(x, z), sit(benchAnchor?), standUp(), setAppearance(app)
// Camera-relative WASD (walk 3.2 m/s, Shift run 6 m/s), Space jump, smooth turning, step-up via
// G.world.heightAt, colliders via G.world.resolve, water/bounds/steep-slope blocking, footsteps.
// Events: player:moved {x,z} (<=4/s), player:distance {meters} (batched >= 5 m),
//         player:arrived {id, x, z, rescued} (a walkTo reached its goal), player:appearance {appearance}.
// Every number that reaches a matrix is checked with Number.isFinite (a NaN here would poison the
// camera, the shadow map and — on Direct3D — bloom).
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => G.util.angleDiff(a, b);
  const fin = Number.isFinite;

  const WALK = 3.2, RUN = 6.0;
  const GRAVITY = 22, JUMP_V = 5.7;
  const ACCEL = 18, DECEL = 22, AIR_ACCEL = 6;
  const MAX_SLOPE = Math.tan(40 * Math.PI / 180);
  const RADIUS = 0.35;
  const DEFAULT_SEAT = 0.42;
  const WADE_DEPTH = 0.18; // deepest shallow water (below the surface) the player may wade into
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);

  const _t1 = new THREE.Vector3();
  const _fallbackBasis = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };

  // =========================================================================== navigation (grid A*)
  // One reusable search grid (typed arrays, generation stamps instead of clearing): planning a 70 m
  // detour touches a few thousand cells once, never per frame.
  const NAV = { cell: 0.8, margin: 14, maxSide: 150, fineSide: 120, maxExpand: 9000, clear: RADIUS + 0.12, sample: 0.35 };
  const MAXN = NAV.maxSide * NAV.maxSide;
  const nav = {
    gen: 1,
    stamp: new Uint32Array(MAXN),
    flag: new Uint8Array(MAXN),     // 1 evaluated · 2 passable · 4 closed
    g: new Float32Array(MAXN),
    y: new Float32Array(MAXN),
    parent: new Int32Array(MAXN),
    heap: new Int32Array(MAXN * 3),
    heapF: new Float32Array(MAXN * 3),
    hn: 0,
  };
  function heapPush(i, f) {
    if (nav.hn >= nav.heap.length) return false;
    let k = nav.hn++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (nav.heapF[p] <= f) break;
      nav.heap[k] = nav.heap[p]; nav.heapF[k] = nav.heapF[p]; k = p;
    }
    nav.heap[k] = i; nav.heapF[k] = f;
    return true;
  }
  function heapPop() {
    const top = nav.heap[0];
    const n = --nav.hn;
    if (n > 0) {
      const li = nav.heap[n], lf = nav.heapF[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && nav.heapF[c + 1] < nav.heapF[c]) c++;
        if (nav.heapF[c] >= lf) break;
        nav.heap[k] = nav.heap[c]; nav.heapF[k] = nav.heapF[c]; k = c;
      }
      nav.heap[k] = li; nav.heapF[k] = lf;
    }
    return top;
  }

  /** can a walker stand at (x, z) with feet at y? (r = clearance radius) */
  function freeAt(x, z, y, r = NAV.clear) {
    const W = G.world, b = W.bounds;
    if (!(x > b.minX + 0.3 && x < b.maxX - 0.3 && z > b.minZ + 0.3 && z < b.maxZ - 0.3)) return false;
    if (W.isWater(x, z)) return false;
    return !W.blocked(x, z, r, y);
  }
  /** feet height after stepping from (feet y0) to (x, z), or NaN when the step is impossible (cliff, deep bank) */
  function stepHeight(x, z, y0, run) {
    const W = G.world;
    const y = W.heightAt(x, z, y0 + 0.05);
    if (!fin(y)) return NaN;
    const wy = G.data.layout?.waterY ?? -1.1;
    if (y < wy - WADE_DEPTH) return NaN;
    const rise = y - y0;
    if (rise > 0.02) {
      const tn = W.terrainHeight(x, z);
      const onTerrain = Math.abs(y - tn) < 0.01;
      if (onTerrain ? rise > run * MAX_SLOPE + 0.06 : rise > W.STEP + 0.02) return NaN;
    }
    return y;
  }
  /** straight walkable line a -> b (sampled), starting with feet at y0 */
  let lineBudget = Infinity; // max samples a single planning pass may spend on line checks
  function lineClear(ax, az, y0, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (!fin(len)) return false;
    if (len < 1e-3) return true;
    const n = Math.max(1, Math.ceil(len / NAV.sample));
    if (n > lineBudget) return false;
    lineBudget -= n;
    const step = len / n;
    let y = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + dx * t, z = az + dz * t;
      const ny = stepHeight(x, z, y, step);
      // right next to the start the walker may already brush a wall: only demand the body radius there
      if (!fin(ny) || !freeAt(x, z, ny, t * len < 0.75 ? RADIUS + 0.02 : NAV.clear)) return false;
      y = ny;
    }
    return true;
  }

  /**
   * plan from (sx, sz, feet sy) to (tx, tz). Returns [{x,z}, ...] (first point = start) or null.
   * goalR: any cell within this radius of the target counts as arrival (targets inside props / NPCs).
   */
  function planPath(sx, sz, sy, tx, tz, goalR) {
    if (![sx, sz, sy, tx, tz].every(fin)) return null;
    goalR = fin(goalR) ? Math.max(0.5, goalR) : 1;
    // straight line clear up to where the walker stops (targets are often inside a prop / an NPC)
    {
      const len = Math.hypot(tx - sx, tz - sz);
      const k = len > 1e-3 ? Math.max(0, len - goalR * 0.9) / len : 0;
      if (lineClear(sx, sz, sy, sx + (tx - sx) * k, sz + (tz - sz) * k)) return [{ x: sx, z: sz }, { x: tx, z: tz }];
    }
    const W = G.world, b = W.bounds;
    let cell = NAV.cell;
    let x0 = Math.min(sx, tx) - NAV.margin, x1 = Math.max(sx, tx) + NAV.margin;
    let z0 = Math.min(sz, tz) - NAV.margin, z1 = Math.max(sz, tz) + NAV.margin;
    x0 = Math.max(x0, b.minX); z0 = Math.max(z0, b.minZ); x1 = Math.min(x1, b.maxX); z1 = Math.min(z1, b.maxZ);
    const span = Math.max(x1 - x0, z1 - z0);
    if (span / cell > NAV.fineSide) cell = span / NAV.fineSide; // big detours plan on a coarser grid (bounded cost)
    const nx = Math.max(2, Math.min(NAV.maxSide, Math.ceil((x1 - x0) / cell) + 1));
    const nz = Math.max(2, Math.min(NAV.maxSide, Math.ceil((z1 - z0) / cell) + 1));
    const cx = (x) => clamp(Math.round((x - x0) / cell), 0, nx - 1);
    const cz = (z) => clamp(Math.round((z - z0) / cell), 0, nz - 1);
    const wx = (i) => x0 + (i % nx) * cell, wz = (i) => z0 + Math.floor(i / nx) * cell;

    if (++nav.gen > 0xfffffff0) { nav.gen = 1; nav.stamp.fill(0); }
    const gen = nav.gen;
    nav.hn = 0;
    const start = cz(sz) * nx + cx(sx);
    const goalCell = cz(tz) * nx + cx(tx);
    const touch = (i) => { if (nav.stamp[i] !== gen) { nav.stamp[i] = gen; nav.flag[i] = 0; nav.g[i] = Infinity; nav.parent[i] = -1; } };
    /** evaluate passability of cell i when entered from a parent with feet at y0; caches y */
    const passable = (i, y0, run) => {
      touch(i);
      const f = nav.flag[i];
      if (f & 1) return (f & 2) !== 0;
      const x = wx(i), z = wz(i);
      const y = stepHeight(x, z, y0, run);
      const ok = fin(y) && freeAt(x, z, y);
      nav.flag[i] = 1 | (ok ? 2 : 0);
      nav.y[i] = fin(y) ? y : y0;
      return ok;
    };
    touch(start);
    nav.flag[start] = 3; nav.y[start] = sy; nav.g[start] = 0;
    const octile = (i) => { const dx = Math.abs(wx(i) - tx), dz = Math.abs(wz(i) - tz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    heapPush(start, octile(start));
    let found = -1, best = start, bestH = Math.hypot(sx - tx, sz - tz), expanded = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (nav.hn > 0 && expanded < NAV.maxExpand) {
      const i = heapPop();
      if (nav.flag[i] & 4) continue;
      nav.flag[i] |= 4;
      expanded++;
      const ix = i % nx, iz = Math.floor(i / nx);
      const px = wx(i), pz = wz(i);
      const h = Math.hypot(px - tx, pz - tz);
      if (h < bestH) { bestH = h; best = i; }
      if (i === goalCell || h <= goalR) { found = i; break; }
      const y0 = nav.y[i], g0 = nav.g[i];
      for (let k = 0; k < 8; k++) {
        const d = D[k];
        const jx = ix + d[0], jz = iz + d[1];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (d[2] > 1) { // no corner cutting
          if (!passable(iz * nx + jx, y0, cell) || !passable(jz * nx + ix, y0, cell)) continue;
        }
        if (!passable(j, y0, cell * d[2])) continue;
        if (nav.flag[j] & 4) continue;
        const ng = g0 + d[2] * cell;
        if (ng < nav.g[j]) {
          nav.g[j] = ng; nav.parent[j] = i;
          if (!heapPush(j, ng + octile(j))) { expanded = NAV.maxExpand; break; }
        }
      }
    }
    let end = found;
    if (end < 0) {
      // unreachable / budget: walk as close as we can (only when that is real progress)
      if (best === start || Math.hypot(sx - tx, sz - tz) - bestH < 2) return null;
      end = best;
    }
    const cells = [];
    for (let i = end, guard = 0; i >= 0 && guard < 20000; i = nav.parent[i], guard++) { cells.push(i); if (i === start) break; }
    cells.reverse();
    const pts = [{ x: sx, z: sz, y: sy }];
    for (let k = 1; k < cells.length; k++) pts.push({ x: wx(cells[k]), z: wz(cells[k]), y: nav.y[cells[k]] });
    // the exact target joins the corner list only when it is standable (inside a prop it is the steering goal only)
    if (found >= 0 && freeAt(tx, tz, pts[pts.length - 1].y)) pts.push({ x: tx, z: tz, y: pts[pts.length - 1].y });
    // string pulling: keep only the corners we cannot see past (bounded look-ahead + sample budget:
    // a long winding route never costs more than a few milliseconds; leftovers just keep extra corners)
    const out = [pts[0]];
    let a = 0;
    lineBudget = 24000;
    try {
      while (a < pts.length - 1) {
        let bIdx = a + 1;
        for (let c = Math.min(pts.length - 1, a + 48); c > a + 1; c--) {
          if (lineClear(pts[a].x, pts[a].z, pts[a].y, pts[c].x, pts[c].z)) { bIdx = c; break; }
        }
        out.push(pts[bIdx]);
        a = bIdx;
      }
    } finally { lineBudget = Infinity; }
    return out.map((p) => ({ x: p.x, z: p.z }));
  }

  // =========================================================================== route trail (easy mode)
  const TRAIL_MAX = 96, TRAIL_GAP = 0.95;
  const _m4 = new THREE.Matrix4();
  const trail = {
    mesh: null, star: null, built: false, visible: false,
    dots: new Float32Array(TRAIL_MAX * 5), // x, y, z, yaw, s(arc length)
    n: 0, goal: { x: 0, y: 0, z: 0 }, t: 0,
    build() {
      if (this.built) return !!this.mesh;
      this.built = true;
      const E = G.sys.engine;
      if (!E?.scene) return false;
      try {
        const tex = G.gfx.canvasTexture(64, 96, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 8;
          ctx.fillStyle = '#ffffff';
          // sole: ball + heel, five little toes (top = walking direction)
          ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.42, w * 0.25, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(w * 0.52, h * 0.75, w * 0.18, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
          const toes = [[0.3, 0.17, 0.075], [0.42, 0.12, 0.07], [0.54, 0.11, 0.065], [0.65, 0.14, 0.06], [0.74, 0.2, 0.055]];
          for (const [tx, ty, tr] of toes) { ctx.beginPath(); ctx.arc(w * tx, h * ty, w * tr, 0, Math.PI * 2); ctx.fill(); }
        });
        const geo = new THREE.PlaneGeometry(0.52, 0.78);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(Math.PI); // texture top -> +Z (local forward)
        const mat = new THREE.MeshBasicMaterial({
          map: tex, color: 0xffdc4a, transparent: true, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, TRAIL_MAX);
        mesh.name = 'walk-trail';
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.renderOrder = 6;
        mesh.raycast = () => {};
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < TRAIL_MAX; i++) { _m4.makeTranslation(0, -500, 0); mesh.setMatrixAt(i, _m4); }
        mesh.visible = false;
        E.scene.add(mesh);
        this.mesh = mesh;
        const stex = G.gfx.canvasTexture(128, 128, (ctx, w, h) => {
          const c = w / 2;
          const g = ctx.createRadialGradient(c, c, 4, c, c, c);
          g.addColorStop(0, 'rgba(255,236,150,0.85)'); g.addColorStop(0.55, 'rgba(255,214,90,0.25)'); g.addColorStop(1, 'rgba(255,214,90,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? w * 0.17 : w * 0.38;
            ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fillStyle = '#ffd23f'; ctx.fill();
          ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        });
        const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        star.scale.set(0.95, 0.95, 0.95);
        star.renderOrder = 7;
        star.visible = false;
        star.raycast = () => {};
        star.name = 'walk-goal-star';
        E.scene.add(star);
        this.star = star;
        return true;
      } catch (e) {
        G.log.warn('PLAYER', 'route trail unavailable', e);
        this.mesh = null; this.star = null;
        return false;
      }
    },
    /** lay footprints along a path ([{x,z}], first point = start) */
    set(path, feetY) {
      if (!this.build() || !path || path.length < 2) { this.hide(); return; }
      const W = G.world;
      let n = 0, s = 0, next = TRAIL_GAP, y = fin(feetY) ? feetY : 0, side = 1;
      for (let k = 0; k < path.length - 1 && n < TRAIL_MAX; k++) {
        const a = path[k], b = path[k + 1];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (!(len > 1e-4)) continue;
        const yaw = Math.atan2(dx, dz), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        while (next <= s + len && n < TRAIL_MAX) {
          const t = (next - s) / len;
          const px = a.x + dx * t + rx * 0.11 * side, pz = a.z + dz * t + rz * 0.11 * side;
          let gy = W.heightAt(px, pz, y + 0.4);
          if (!fin(gy)) gy = y;
          y = gy;
          const o = n * 5;
          this.dots[o] = px; this.dots[o + 1] = gy + 0.07; this.dots[o + 2] = pz; this.dots[o + 3] = yaw; this.dots[o + 4] = next;
          n++; side = -side; next += TRAIL_GAP;
        }
        s += len;
      }
      this.n = n;
      const end = path[path.length - 1];
      let gy = W.heightAt(end.x, end.z, y + 0.4);
      if (!fin(gy)) gy = y;
      this.goal.x = end.x; this.goal.y = gy; this.goal.z = end.z;
      this.visible = n > 0;
      if (this.mesh) this.mesh.visible = this.visible;
      if (this.star) this.star.visible = this.visible;
      this.t = 0;
    },
    hide() {
      this.visible = false; this.n = 0;
      if (this.mesh) { this.mesh.visible = false; this.mesh.count = 0; }
      if (this.star) this.star.visible = false;
    },
    /** progress = arc length already walked; footprints behind the walker disappear, the next ones pop in */
    update(dt, progress) {
      if (!this.visible || !this.mesh) return;
      this.t += dt;
      const rm = !!G.settings?.reduceMotion;
      const t = this.t;
      let c = 0;
      for (let i = 0; i < this.n; i++) {
        const o = i * 5, s = this.dots[o + 4];
        const ahead = s - progress;
        if (ahead < 0.35) continue;
        const appear = clamp((ahead - 0.35) / 0.9, 0, 1) * clamp((t * 14 - i * 0.6) / 3, 0, 1); // pop in one by one
        const wave = rm ? 0 : Math.max(0, Math.sin(s * 1.25 - t * 4.2)) * 0.22;          // a slow wave runs towards the goal
        const sc = clamp(0.06 + appear * (0.94 + wave), 0.06, 1.3);
        const x = this.dots[o], y = this.dots[o + 1], z = this.dots[o + 2], yaw = this.dots[o + 3];
        if (!fin(x) || !fin(y) || !fin(z) || !fin(yaw)) continue;
        _m4.makeRotationY(yaw);
        _m4.elements[0] *= sc; _m4.elements[1] *= sc; _m4.elements[2] *= sc;
        _m4.elements[4] *= sc; _m4.elements[5] *= sc; _m4.elements[6] *= sc;
        _m4.elements[8] *= sc; _m4.elements[9] *= sc; _m4.elements[10] *= sc;
        _m4.setPosition(x, y, z);
        this.mesh.setMatrixAt(c++, _m4);
      }
      this.mesh.count = c;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.star) {
        const bob = rm ? 0 : Math.sin(t * 3) * 0.14;
        const gy = this.goal.y + 1.15 + bob;
        if (fin(gy)) this.star.position.set(this.goal.x, gy, this.goal.z);
        this.star.material.rotation = rm ? 0 : Math.sin(t * 1.4) * 0.25;
      }
    },
  };

  // =========================================================================== the player system
  const player = {
    name: 'player', order: 30, label: '플레이어',
    object: null, position: null, rotY: Math.PI,
    velocity: new THREE.Vector3(), grounded: true, rig: null, radius: RADIUS, enabled: true,
    speed: 0, sitting: null,
    _walk: null, _walkSeq: 0, _faceT: null, _slide: null,
    _jumpBuf: 0, _coyote: 0,
    _rigParams: { speed: 0, grounded: true, vy: 0 },
    _stepOpts: { surface: 'grass', run: false },
    _steps: 0, _lastEmit: new THREE.Vector3(), _emitT: 0, _distAcc: 0, _saveT: 0, _tagT: 0, _tagKey: '',
    _prevPos: new THREE.Vector3(), _ready: false,

    get isWalking() { return !!this._walk; },
    /** small read-only summary of the running walk (for HUD / dev tools) */
    get walkInfo() {
      const w = this._walk;
      if (!w) return null;
      return { id: w.id, x: w.x, z: w.z, waypoints: w.path ? w.path.length - 1 : 1, index: w.pi, replans: w.replans, rescuing: !!w.rescuing, label: w.label || '' };
    },

    init() {
      const E = G.sys.engine;
      this.object = new THREE.Group();
      this.object.name = 'player';
      this.position = this.object.position;
      const sp = G.data.layout?.spawn || { x: 0, z: 9, rotY: Math.PI };
      this.rotY = sp.rotY ?? Math.PI;
      this.rig = G.avatar.create(G.avatar.defaultAppearance, { shadow: true });
      this.object.add(this.rig.group);
      this.position.set(sp.x, G.world.heightAt(sp.x, sp.z), sp.z);
      this.object.rotation.y = this.rotY;
      this.object.visible = false;
      E.scene.add(this.object);
      this._prevPos.copy(this.position);
      this._lastEmit.copy(this.position);

      this.nametag = G.ui.label({ className: 'nametag me', html: '', target: this.rig.headAnchor, maxDist: 48, fadeDist: 8 });
      this.nametag.setVisible(false);

      G.bus.on('input:move-start', () => {
        if (!this._ready) return;
        this.cancelWalk('manual');
        if (this.sitting) this.standUp();
      });
      G.bus.on('state:before-save', () => this._writeState());
      G.bus.on('world:object', ({ id, obj }) => {
        if (/^BENCH_\d+$/.test(id) && G.interact?.get?.(id)) G.interact.setObject?.(id, obj);
      });
      // the footprint trail is an easy-mode helper: switching modes mid-walk shows / hides it right away
      G.bus.on('easy:changed', () => {
        const w = this._walk;
        if (!w) return;
        w.trail = w.trailOpt != null ? !!w.trailOpt : easyOn();
        w.rescue = w.rescueOpt != null ? !!w.rescueOpt : easyOn();
        if (w.trail && w.path) trail.set(w.path, this.position.y); else trail.hide();
      });
    },

    postInit() { this._registerBenches(); },

    _registerBenches() {
      const list = G.data.layout?.benches || [];
      if (!G.interact?.register) return;
      list.forEach((b, i) => {
        const id = 'BENCH_' + i;
        const pos = new THREE.Vector3(b.x, G.world.surfaceHeight(b.x, b.z) + 0.45, b.z);
        const here = () => this.sitting && this.sitting.bench && this.sitting.bench.id === id;
        G.interact.register({
          id, kind: 'bench', radius: 2.2, priority: -0.5,
          label: () => (here() ? '일어나기' : '벤치에 앉기'),
          position: pos,
          object: G.world.getObject(id) || undefined,
          onInteract: () => {
            if (here()) { this.standUp(); return; }
            const obj = G.world.getObject(id);
            const seat = Number(obj?.userData?.seatY);
            this.sit({ id, x: b.x, z: b.z, rot: b.rot || 0, seatY: fin(seat) ? seat : DEFAULT_SEAT });
          },
        });
      });
    },

    // ------------------------------------------------------------ state
    onStateLoaded(state) {
      const app = state?.profile?.avatar ? state.profile.avatar : G.avatar.defaultAppearance;
      this.rig.setAppearance(app);
      const L = G.data.layout || {};
      const sp = L.spawn || { x: 0, z: 9, rotY: Math.PI };
      const p = state?.player || {};
      let x = Number(p.x), z = Number(p.z), y = Number(p.y), ry = Number(p.rotY);
      const b = G.world.bounds;
      const valid = fin(x) && fin(z) && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && !state?._isNew;
      if (!valid) { x = sp.x; z = sp.z; ry = sp.rotY; y = 0; }
      const free = this._findFree(x, z, fin(y) ? y : 0);
      if (!free) { x = sp.x; z = sp.z; } else { x = free.x; z = free.z; }
      const gy = G.world.heightAt(x, z, (fin(y) ? y : 0) + 0.3);
      this.position.set(x, fin(gy) ? gy : 0, z);
      this.rotY = fin(ry) ? ry : (sp.rotY ?? Math.PI);
      this.object.rotation.y = this.rotY;
      this.velocity.set(0, 0, 0);
      this.grounded = true;
      this.sitting = null; this._faceT = null; this._slide = null;
      this._dropWalk();
      this.rig.stopAll();
      this.rig.setHeld(null);
      this.object.visible = true;
      this.nametag.setVisible(true);
      this._tagKey = '';
      this._refreshTag();
      this._prevPos.copy(this.position);
      this._lastEmit.copy(this.position);
      this._distAcc = 0;
      this._ready = true;
      G.sys.engine.focus.copy(this.position);
      this._writeState();
      G.bus.emit('player:moved', { x: this.position.x, z: this.position.z });
      G.log.info('PLAYER', `spawned at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    },

    onLogout() {
      this._ready = false;
      this.cancelWalk('logout');
      this.sitting = null;
      this.rig.stopAll();
      this.rig.setHeld(null);
      this.object.visible = false;
      this.nametag.setVisible(false);
      trail.hide();
    },

    _writeState() {
      const s = G.state?.player;
      if (!s || !this._ready) return;
      const p = this.position;
      if (!fin(p.x) || !fin(p.y) || !fin(p.z) || !fin(this.rotY)) return;
      s.x = Math.round(p.x * 100) / 100;
      s.y = Math.round(p.y * 100) / 100;
      s.z = Math.round(p.z * 100) / 100;
      s.rotY = Math.round(this.rotY * 1000) / 1000;
    },

    _refreshTag() {
      const pr = G.state?.profile;
      const nick = pr?.nickname || '게스트';
      const title = pr?.title || '';
      const key = nick + '|' + title;
      if (key === this._tagKey) return;
      this._tagKey = key;
      const esc = G.util.escapeHtml;
      this.nametag.setHTML(`${title ? `<span class="role">${esc(title)}</span>` : ''}<span class="nm">${esc(nick)}</span>`);
    },

    // ------------------------------------------------------------ public API
    async teleport(x, z, rotY, opts = {}) {
      if (x && typeof x === 'object') { opts = (rotY && typeof rotY === 'object') ? rotY : opts; rotY = typeof z === 'number' ? z : x.rotY; z = x.z; x = x.x; }
      opts = opts && typeof opts === 'object' ? opts : {};
      if (!fin(x) || !fin(z)) { G.log.warn('PLAYER', 'teleport ignored: non-finite target', x, z); return; }
      const keep = opts._keepWalk || null;
      const run = () => {
        const f = this._findFree(x, z, G.world.surfaceHeight(x, z)) || { x, z };
        if (!keep || this._walk !== keep) this.cancelWalk('teleport');
        this.sitting = null; this._slide = null; this._faceT = null;
        this.rig.stopAll();
        const y = G.world.surfaceHeight(f.x, f.z);
        this.position.set(f.x, fin(y) ? y : 0, f.z);
        G.world.clampToBounds(this.position);
        if (rotY != null && fin(rotY)) this.rotY = rotY;
        this.object.rotation.y = this.rotY;
        this.velocity.set(0, 0, 0);
        this.grounded = true;
        this._prevPos.copy(this.position);
        this._lastEmit.copy(this.position);
        G.sys.engine.focus.copy(this.position);
        if (G.sys.camera?.mode === 'follow') { G.sys.camera.behind?.(this.rotY, true); G.sys.camera.snap?.(); }
        this._writeState();
        G.bus.emit('player:moved', { x: this.position.x, z: this.position.z });
        G.log.info('PLAYER', `teleport -> (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
      };
      G.sfx('teleport');
      if (opts.fade !== false && G.ui?.fadeThrough) await G.ui.fadeThrough(run, 260);
      else run();
      return this.position;
    },

    /**
     * walk to {x, z}. Returns the walk id (number) or false. The walk re-plans around new obstacles,
     * cancels on joystick / keyboard input ('manual'), and calls onFail(reason) for every other end:
     * 'manual' | 'replaced' | 'teleport' | 'stuck' | 'unreachable' | 'sit' | 'action' | 'logout' | ...
     */
    walkTo(target, opts = {}) {
      if (!target || !fin(target.x) || !fin(target.z)) return false;
      opts = opts && typeof opts === 'object' ? opts : {};
      if (!this._ready) return false;
      if (this.sitting) this.standUp();
      if (this.rig.actionFullBody) this.rig.stopAction();
      if (this._walk) this.cancelWalk('replaced');
      const b = G.world.bounds;
      const tx = clamp(target.x, b.minX, b.maxX), tz = clamp(target.z, b.minZ, b.maxZ);
      const p = this.position;
      const d = Math.hypot(tx - p.x, tz - p.z);
      const stop = Math.max(0.15, fin(opts.stopDistance) ? opts.stopDistance : 1.2);
      const w = {
        id: ++this._walkSeq, x: tx, z: tz, stop,
        onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
        onFail: typeof opts.onFail === 'function' ? opts.onFail : null,
        run: opts.run ?? d > 16, label: String(opts.label || '').slice(0, 24),
        usePath: opts.path !== false,
        rescueOpt: opts.rescue == null ? null : !!opts.rescue, trailOpt: opts.trail == null ? null : !!opts.trail,
        rescue: false, trail: false,
        path: null, pi: 1, rem: null, replans: 0, lastPlanT: -10, skipT: 0,
        best: Infinity, bestT: G.time.elapsed, startT: G.time.elapsed, budget: 30, rescuing: false,
      };
      w.rescue = w.rescueOpt != null ? w.rescueOpt : easyOn();
      w.trail = w.trailOpt != null ? w.trailOpt : easyOn();
      this._walk = w;
      this._faceT = null;
      this._plan(w, G.time.elapsed);
      return w.id;
    },
    cancelWalk(reason) {
      const w = this._walk;
      if (!w) return;
      this._walk = null;
      trail.hide();
      if (reason && reason !== 'arrived') { try { w.onFail?.(reason); } catch (e) { G.log.error('PLAYER', e); } }
    },
    /** plan a route between two points without walking it (dev tools / other modules) */
    planPath(from, to, goalR = 1) {
      if (!from || !to) return null;
      const y = fin(from.y) ? from.y : G.world.heightAt(from.x, from.z);
      try { return planPath(from.x, from.z, y, to.x, to.z, goalR); } catch (e) { G.log.warn('PLAYER', 'planPath failed', e); return null; }
    },

    playAction(anim, opts = {}) {
      if (!anim || !this.rig) return;
      if (anim === 'sit') { this.sit(opts.bench || null); return; }
      if (anim === 'idle' || anim === 'walk' || anim === 'run') { this.stopAction(); return; }
      const def = G.avatar.actions[anim];
      if (def?.fullBody) { this.cancelWalk('action'); this.velocity.x = 0; this.velocity.z = 0; }
      if (this.sitting && def?.fullBody) this.standUp();
      this.rig.setAnim(anim, opts);
    },
    stopAction() {
      if (!this.rig) return;
      if (this.rig._act && !this.rig._act.stopping) this.rig.stopAction();
      else if (this.sitting) this.standUp();
    },

    faceTowards(x, z) {
      if (!fin(x) || !fin(z)) return;
      const dx = x - this.position.x, dz = z - this.position.z;
      if (dx * dx + dz * dz < 1e-4) return;
      this._faceT = Math.atan2(dx, dz);
    },

    sit(bench) {
      this.cancelWalk('sit');
      this.velocity.set(0, 0, 0);
      let seatY = 0;
      if (bench && fin(bench.x) && fin(bench.z)) {
        const rot = fin(bench.rot) ? bench.rot : 0;
        const fx = Math.sin(rot), fz = Math.cos(rot);
        const gx = bench.x + fx * 0.06, gz = bench.z + fz * 0.06;
        let gy = G.world.heightAt(gx, gz, this.position.y);
        if (!(gy <= this.position.y + 0.25)) gy = this.position.y;
        this._slideTo(gx, gy, gz, 0.28);
        this.rotY = rot;
        this._faceT = null;
        seatY = fin(bench.seatY) ? bench.seatY : DEFAULT_SEAT;
      }
      this.sitting = { bench: bench || null, seatY, at: G.time.elapsed };
      this.rig.setAnim('sit', { loop: true, seatY });
      G.log.debug('PLAYER', 'sit', bench?.id || 'ground');
    },
    standUp() {
      const s = this.sitting;
      if (!s) return;
      this.sitting = null;
      this.rig.stopAll();
      if (s.bench) {
        const fx = Math.sin(this.rotY), fz = Math.cos(this.rotY);
        _t1.set(this.position.x + fx * 0.55, this.position.y, this.position.z + fz * 0.55);
        G.world.resolve(_t1, RADIUS, this.position.y);
        if (!G.world.isWater(_t1.x, _t1.z)) this._slideTo(_t1.x, G.world.heightAt(_t1.x, _t1.z, this.position.y + 0.1), _t1.z, 0.25);
      }
    },

    setAppearance(app) {
      const n = G.avatar.normalize(app);
      this.rig.setAppearance(n);
      if (G.state?.profile) { G.state.profile.avatar = { ...n }; G.dirty('avatar'); }
      G.bus.emit('player:appearance', { appearance: n });
      G.log.info('PLAYER', 'appearance updated');
      return n;
    },

    // ------------------------------------------------------------ walking internals
    /** (re)plan the route of walk w from the current position */
    _plan(w, t) {
      const p = this.position;
      w.lastPlanT = t;
      let path = null;
      if (w.usePath) {
        try { path = planPath(p.x, p.z, p.y, w.x, w.z, Math.max(w.stop, 0.6)); } catch (e) { G.log.warn('PLAYER', 'path planning failed', e); path = null; }
      }
      if (!path || path.length < 2) path = [{ x: p.x, z: p.z }, { x: w.x, z: w.z }];
      // the goal is the real target: the walker steers there on the last leg and stops at stopDistance
      const last = path[path.length - 1];
      if (Math.hypot(last.x - w.x, last.z - w.z) > 0.05) path.push({ x: w.x, z: w.z });
      w.path = path;
      w.pi = 1;
      // remaining length after each waypoint (progress metric for stuck detection) + arc length up to it (trail)
      const n = path.length;
      w.rem = new Float32Array(n);
      w.arc = new Float32Array(n);
      for (let i = n - 2; i >= 0; i--) w.rem[i] = w.rem[i + 1] + Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
      for (let i = 1; i < n; i++) w.arc[i] = w.arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      w.best = Infinity; w.bestT = t;
      // generous time budget: 1.9x the walking time of the planned route + 8 s (re-plans extend it)
      w.budget = Math.max(w.budget, (t - w.startT) + 8 + (w.rem[0] / WALK) * 1.9);
      if (w.trail) trail.set(path, p.y); else trail.hide();
      if (n > 2) G.log.debug('PLAYER', `walk ${w.id}: ${n - 2} waypoint(s), ${w.rem[0].toFixed(1)} m`);
    },

    _arrive(w, rescued) {
      if (this._walk !== w) return;
      this._walk = null;
      trail.hide();
      G.bus.emit('player:arrived', { id: w.id, x: this.position.x, z: this.position.z, rescued: !!rescued });
      try { w.onArrive?.(); } catch (e) { G.log.error('PLAYER', 'onArrive', e); }
    },

    /** last resort: fade, hop next to the goal, arrive (the walk keeps its id so callers see a normal arrival) */
    async _rescue(w) {
      if (w.rescuing || this._walk !== w) return;
      w.rescuing = true;
      this.velocity.x = 0; this.velocity.z = 0;
      const p = this.position;
      let dx = p.x - w.x, dz = p.z - w.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) { dx /= l; dz /= l; } else { dx = 0; dz = 1; }
      const off = Math.min(Math.max(w.stop * 0.75, 0.6), 2.2);
      const gx = w.x + dx * off, gz = w.z + dz * off;
      G.log.info('PLAYER', `walk ${w.id}: stuck -> hop to the goal`);
      try {
        await this.teleport(gx, gz, Math.atan2(-dx, -dz), { _keepWalk: w });
      } catch (e) { G.log.warn('PLAYER', 'rescue teleport failed', e); }
      if (this._walk !== w) return; // the child moved / a new walk started during the fade
      w.rescuing = false;
      this.faceTowards(w.x, w.z);
      this._arrive(w, true);
    },

    /** dropped silently (state reload): nobody is waiting for it any more */
    _dropWalk() { this._walk = null; trail.hide(); },

    _stuck(w, t, why) {
      if (w.replans < 3 && t - w.lastPlanT > 0.6) {
        w.replans++;
        G.log.debug('PLAYER', `walk ${w.id}: ${why} -> re-plan #${w.replans}`);
        this._plan(w, t);
        return;
      }
      if (w.rescue) { this._rescue(w); return; }
      G.log.debug('PLAYER', `walk ${w.id}: ${why}`);
      this.cancelWalk('stuck');
    },

    /** steering for the auto-walk: writes the wanted direction into out {dx, dz, want}; false = no walk this frame */
    _steer(w, t, dt, out) {
      const p = this.position;
      if (w.rescuing) { out.want = 0; return true; }
      const fx = w.x - p.x, fz = w.z - p.z;
      const dFinal = Math.hypot(fx, fz);
      if (!fin(dFinal)) { this.cancelWalk('invalid'); return false; }
      if (dFinal <= w.stop) { this._arrive(w, false); return false; }
      const path = w.path;
      // advance past waypoints we reached (or can already see past)
      while (w.pi < path.length - 1 && Math.hypot(path[w.pi].x - p.x, path[w.pi].z - p.z) < 0.7) w.pi++;
      w.skipT -= dt;
      if (w.skipT <= 0 && w.pi < path.length - 1) {
        w.skipT = 0.3;
        const nx = path[w.pi + 1];
        if (lineClear(p.x, p.z, p.y, nx.x, nx.z)) w.pi++;
      }
      const wp = path[w.pi] || path[path.length - 1];
      let dx = wp.x - p.x, dz = wp.z - p.z;
      let d = Math.hypot(dx, dz);
      if (!(d > 1e-4)) { dx = fx; dz = fz; d = dFinal; }
      out.dx = dx / d; out.dz = dz / d;
      const lastLeg = w.pi >= path.length - 1;
      out.want = (w.run ? RUN : WALK) * (lastLeg ? clamp((dFinal - w.stop) / 1.1 + 0.35, 0.35, 1) : 1);
      // progress (remaining route length) -> stuck detection / re-plan / rescue
      const remaining = d + (w.rem ? w.rem[Math.min(w.pi, w.rem.length - 1)] : 0);
      if (remaining < w.best - 0.2) { w.best = remaining; w.bestT = t; }
      else if (t - w.bestT > 1.5) { w.bestT = t; this._stuck(w, t, 'no progress'); if (this._walk !== w || w.rescuing) { out.want = 0; return this._walk === w; } }
      if (t - w.startT > w.budget) { w.budget = Infinity; if (w.rescue) this._rescue(w); else this.cancelWalk('stuck'); out.want = 0; return this._walk === w; }
      // arc length walked (for the trail)
      w.progress = (w.arc ? w.arc[Math.min(w.pi, w.arc.length - 1)] : 0) - d;
      return true;
    },

    // ------------------------------------------------------------ internals
    _slideTo(x, y, z, dur) {
      if (![x, y, z].every(fin)) return;
      this._slide = { fx: this.position.x, fy: this.position.y, fz: this.position.z, x, y, z, t: 0, dur };
    },

    /** nearest walkable spot (not water, not inside colliders, not down in a pond / river basin) within ~8 m */
    _findFree(x, z, y = 0) {
      const W = G.world;
      if (!fin(x) || !fin(z)) return null;
      if (!fin(y)) y = 0;
      const deep = (G.data.layout?.waterY ?? -1.1) - WADE_DEPTH;
      const ok = (px, pz, fy) => { const gy = W.heightAt(px, pz, fy + 0.3); return fin(gy) && gy >= deep && !W.blocked(px, pz, RADIUS * 0.9, gy); };
      if (ok(x, z, y)) return { x, z };
      for (let r = 0.75; r <= 8; r += 0.75) {
        const n = Math.max(8, Math.round(r * 6));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (ok(px, pz, y)) return { x: px, z: pz };
        }
      }
      return null;
    },

    /** single collision-checked step to (tx, tz); returns false when blocked */
    _tryStep(tx, tz) {
      const W = G.world, p = this.position;
      if (!fin(tx) || !fin(tz)) return false;
      if (W.isWater(tx, tz)) return false;
      const wy = G.data.layout?.waterY ?? -1.1;
      if (p.y < wy + 0.6) {
        // shallow banks below the water surface: ankle-deep wading only (climbing out is always allowed)
        const gn = W.heightAt(tx, tz, p.y + 0.05);
        if (gn < wy - WADE_DEPTH && gn < p.y - 0.005) return false;
      }
      const tc = W.terrainHeight(p.x, p.z), tn = W.terrainHeight(tx, tz);
      if (tn > p.y + 0.02) {
        const g = W.heightAt(tx, tz, p.y);
        const onTerrain = Math.abs(g - tn) < 0.01;
        if (onTerrain) {
          if (!this.grounded && tn > p.y + 0.05) return false;              // never move into terrain mid-air
          const run = Math.hypot(tx - p.x, tz - p.z);
          if (this.grounded && tn - tc > run * MAX_SLOPE + 0.015) return false; // steeper than ~40 degrees
        }
      }
      _t1.set(tx, p.y, tz);
      W.resolve(_t1, RADIUS, p.y);
      W.clampToBounds(_t1);
      if (!fin(_t1.x) || !fin(_t1.z) || W.isWater(_t1.x, _t1.z)) return false;
      p.x = _t1.x; p.z = _t1.z;
      return true;
    },
    /** try to move horizontally to (nx, nz), sliding along blockers; returns true if any movement happened */
    _move(nx, nz) {
      const p = this.position;
      if (this._tryStep(nx, nz)) return true;
      const ox = p.x, oz = p.z;
      if (Math.abs(nx - ox) > 1e-5 && this._tryStep(nx, oz)) return true;
      if (Math.abs(nz - oz) > 1e-5 && this._tryStep(ox, nz)) return true;
      return false;
    },

    _steerOut: { dx: 0, dz: 0, want: 0 },

    update(dt, t) {
      const input = G.input;
      input?.update?.();
      if (!this._ready) { this.rig.update(dt, this._rigParams); return; }
      if (!(dt > 0) || !fin(dt)) dt = 0;
      const W = G.world, p = this.position, v = this.velocity;
      const ctl = this.enabled && (input ? input.gameplay() : true);

      // ---- smooth reposition (sit / stand up)
      if (this._slide) {
        const s = this._slide;
        s.t += dt;
        const k = clamp(s.t / Math.max(1e-3, s.dur), 0, 1), e = k * k * (3 - 2 * k);
        p.set(s.fx + (s.x - s.fx) * e, s.fy + (s.y - s.fy) * e, s.fz + (s.z - s.fz) * e);
        if (k >= 1) this._slide = null;
      }

      // ---- desired direction
      let dx = 0, dz = 0, want = 0;
      const ax = input ? input.axis : null;
      const mag = ax ? Math.min(1, Math.hypot(ax.x, ax.y)) : 0;
      if (ctl && mag > 0.05 && fin(mag)) {
        const bs = G.sys.camera?.getMoveBasis?.() || _fallbackBasis;
        dx = bs.forward.x * ax.y + bs.right.x * ax.x;
        dz = bs.forward.z * ax.y + bs.right.z * ax.x;
        const l = Math.hypot(dx, dz);
        if (l > 1e-6 && fin(l)) { dx /= l; dz /= l; want = (input.running ? RUN : WALK) * mag; } else { dx = 0; dz = 0; }
        this._faceT = null;
      } else if (this._walk) {
        const w = this._walk;
        if (!ctl) {
          // paused by a modal / dialogue: freeze the stuck & time budget clocks
          w.bestT = t; w.startT += dt;
        } else {
          const o = this._steerOut;
          if (this._steer(w, t, dt, o) && o.want > 0) { dx = o.dx; dz = o.dz; want = o.want; }
        }
      }
      if (this.sitting || this._slide) want = 0;
      if (want > 0 && this.rig.actionFullBody) this.rig.stopAction();

      // ---- horizontal velocity
      const tvx = dx * want, tvz = dz * want;
      const acc = this.grounded ? (want > 0 ? ACCEL : DECEL) : AIR_ACCEL;
      let ddx = tvx - v.x, ddz = tvz - v.z;
      const dl = Math.hypot(ddx, ddz), maxd = acc * dt;
      if (dl > maxd && dl > 1e-9) { ddx *= maxd / dl; ddz *= maxd / dl; }
      v.x += ddx; v.z += ddz;
      if (!fin(v.x) || !fin(v.z)) { v.x = 0; v.z = 0; }

      // ---- turning
      if (want > 0.1) {
        this.rotY += angleDiff(this.rotY, Math.atan2(dx, dz)) * damp(this.grounded ? 13 : 6, dt);
      } else if (this._faceT != null && !this.sitting) {
        const diff = angleDiff(this.rotY, this._faceT);
        this.rotY += diff * damp(10, dt);
        if (Math.abs(diff) < 0.01) this._faceT = null;
      }
      this.rotY = Math.atan2(Math.sin(this.rotY), Math.cos(this.rotY));
      if (!fin(this.rotY)) this.rotY = 0;

      // ---- jump (buffered input + coyote time)
      const jumped = input ? input.consumeJump() : false;
      if (jumped && ctl) {
        if (this.sitting) this.standUp();
        else this._jumpBuf = 0.15;
      }
      this._jumpBuf -= dt;
      this._coyote = this.grounded ? 0.1 : this._coyote - dt;
      if (this._jumpBuf > 0 && this._coyote > 0 && !this.sitting && !this._slide) {
        v.y = JUMP_V; this.grounded = false; this._coyote = 0; this._jumpBuf = 0;
        if (this.rig.actionFullBody) this.rig.stopAction();
        G.sfx('jump');
      }

      // ---- horizontal move with collisions
      let blocked = false;
      if (!this._slide && (Math.abs(v.x) > 1e-4 || Math.abs(v.z) > 1e-4)) {
        const ox = p.x, oz = p.z;
        if (!this._move(p.x + v.x * dt, p.z + v.z * dt)) { v.x = 0; v.z = 0; blocked = true; }
        else if (dt > 0) {
          // keep velocity consistent with what actually happened (sliding along walls)
          const mvx = (p.x - ox) / dt, mvz = (p.z - oz) / dt;
          if (Math.hypot(mvx, mvz) < Math.hypot(v.x, v.z) * 0.6) { v.x = mvx; v.z = mvz; }
        }
      }

      // ---- vertical
      if (!this._slide) {
        const ground = W.heightAt(p.x, p.z, p.y + 0.05);
        if (this.grounded) {
          if (v.y > 0) this.grounded = false;
          else if (ground < p.y - 0.42) { this.grounded = false; v.y = 0; }
          else if (ground > p.y) {
            const diff = ground - p.y;
            p.y = diff < 0.004 ? ground : p.y + diff * damp(26, dt);
          } else p.y = ground;
        }
        if (!this.grounded) {
          v.y -= GRAVITY * dt;
          p.y += v.y * dt;
          const g2 = W.heightAt(p.x, p.z, p.y + 0.3);
          if (p.y <= g2 && v.y <= 0) {
            const impact = -v.y;
            p.y = g2; v.y = 0; this.grounded = true;
            if (impact > 3) {
              this._stepOpts.surface = W.surfaceAt(p.x, p.z); this._stepOpts.run = false;
              G.sfx('land', this._stepOpts);
            }
            if (impact > 10) G.sys.camera?.shake?.(Math.min(0.5, (impact - 10) * 0.06));
          }
        }
      }
      // safety net (NaN / fell out of the world)
      if (!fin(p.x) || !fin(p.y) || !fin(p.z) || p.y < -40 || !fin(v.y)) {
        const sp = G.data.layout?.spawn || { x: 0, z: 9 };
        p.set(sp.x, W.surfaceHeight(sp.x, sp.z), sp.z); v.set(0, 0, 0); this.grounded = true;
        if (!fin(p.y)) p.y = 0;
        this._dropWalk();
        G.log.warn('PLAYER', 'invalid position -> respawn');
      }

      this.object.rotation.y = this.rotY;
      const hs = Math.hypot(v.x, v.z);
      this.speed = hs;

      // ---- animation
      const rp = this._rigParams;
      rp.speed = blocked ? 0 : this.grounded ? hs : hs * 0.5; rp.grounded = this.grounded; rp.vy = v.y;
      this.rig.update(dt, rp);
      if (this.rig.steps !== this._steps) {
        this._steps = this.rig.steps;
        this._stepOpts.surface = p.y < (G.data.layout?.waterY ?? -1.1) - 0.02 ? 'water' : W.surfaceAt(p.x, p.z);
        this._stepOpts.run = hs > 4.5;
        G.sfx('step', this._stepOpts);
      }

      // ---- route trail
      const w = this._walk;
      if (trail.visible) {
        if (w && w.trail) trail.update(dt, fin(w.progress) ? w.progress : 0);
        else trail.hide();
      }

      G.sys.engine.focus.copy(p);

      // ---- events (moved <= 4/s, distance batched)
      const mx = p.x - this._prevPos.x, mz = p.z - this._prevPos.z;
      const md = Math.hypot(mx, mz);
      if (md < 5) this._distAcc += md; // ignore teleports
      this._prevPos.copy(p);
      if (this._distAcc >= 5) {
        const m = Math.floor(this._distAcc);
        this._distAcc -= m;
        G.bus.emit('player:distance', { meters: m });
      }
      this._emitT += dt;
      if (this._emitT >= 0.25) {
        const ed = Math.hypot(p.x - this._lastEmit.x, p.z - this._lastEmit.z);
        if (ed > 0.05) {
          this._emitT = 0;
          this._lastEmit.copy(p);
          G.bus.emit('player:moved', { x: p.x, z: p.z });
        }
      }
      // ---- persistence (no G.dirty: autosave + before-save hook persist it)
      this._saveT += dt;
      if (this._saveT >= 1) { this._saveT = 0; this._writeState(); }
      this._tagT += dt;
      if (this._tagT >= 1) { this._tagT = 0; this._refreshTag(); }
    },
  };
  G.register(player);
})();
