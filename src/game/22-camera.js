// =============================================================================
// 22-camera.js — third-person orbit camera (G.sys.camera)
//
//   mode: 'follow' | 'cinematic' | 'dialogue' | 'photo' | 'focus'
//   setMode(mode, opts)                         smooth transition between modes
//   getMoveBasis() -> {forward, right}          XZ unit vectors for camera-relative movement
//   cinematic({center:[x,y,z], radius, height, speed, angle})   slow orbit (title screen)
//   focusOn(vec3|Object3D, {distance, height, duration, side})  dialogue framing (over the shoulder)
//   photoControl({dx, dy, zoom, height})        free orbit around the player in photo mode (<= 20 m)
//   shake(amount 0..1), snap(), yaw / pitch / distance, gentle (easy-mode camera active)
//   shot(pos, look, {fov, duration}) / setMode('shot')   scripted cinematography (intro, telescope tour):
//                                               the caller moves pos/look every frame; setMode('follow') ends it
// Follow at speed (phase 4: 9.6 / 18 m/s): the target is fed forward with the player's own motion (zero
// lag, zero jitter), the view leads a little in the direction of travel, pulls back and widens the FOV a
// touch at a sprint (normal mode only), and auto-swings behind the runner with a capped turn rate.
// Drag (G.input.consumeLook) rotates, wheel / pinch (G.input.consumeZoom) zooms 2.5–16 m.
// The camera never goes below the terrain and pulls in when G.world.cameraBlockers occlude the player.
// 쉬운 모드 (CONTRACT §12): a gentle camera for small children — softer drag (x0.62), a comfortable
// zoom range (4.5–12.5 m, default 9 m a little higher up), it swings behind the walking player by itself
// (also during auto-walk), never shakes and keeps a fixed field of view (no running FOV kick).
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => G.util.angleDiff(a, b);
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  const PMIN = -0.32, PMAX = 1.22;     // follow pitch range (rad)
  const DMIN = 2.5, DMAX = 16;          // follow zoom range (m)
  const DEF = { yaw: 0, pitch: 0.36, distance: 8 };
  const EASY = { dmin: 4.5, dmax: 12.5, pitch: 0.42, distance: 9, look: 0.62, pmin: -0.05, pmax: 1.05 };
  const gentle = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const FOV = 55;
  const SAMPLES = [0.35, 0.7, 1];
  const MODES = ['follow', 'cinematic', 'dialogue', 'photo', 'focus', 'shot'];
  // speed-aware follow (phase 4): numbers relative to the player's WALK / RUN constants
  const WALK = () => G.sys.player?.WALK || 9.6;
  const RUN = () => G.sys.player?.RUN || 18;
  const LEAD = 1.7, LEAD_EASY = 0.9;   // m the view leads at a full sprint
  const DOLLY = 0.9, DOLLY_EASY = 0.45; // m pulled back at a full sprint
  const FOV_KICK = 7;                   // deg at a full sprint (normal mode only)
  const SWING_MAX = 1.5;                // rad/s cap for automatic swings behind the runner

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  // ---- occlusion queries against G.world.cameraBlockers (allocation-light, both faces)
  // vertical clearance the camera keeps from blocker surfaces (near plane 0.1 m): roofs are the open (single-sheet)
  // blockers, sloped at most ~45°, so 0.45 m straight up / down ≈ 0.32 m off the slope. Closed blockers (hulls,
  // wall boxes, canopy proxies) are caught by the line of sight itself when the camera would be inside them.
  const NEAR_CLEAR = 0.45;
  const PROBES = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
  const _box = new THREE.Box3(), _bp = new THREE.Vector3(), _probe = new THREE.Vector3(), _hits = [];
  /** can the segment origin -> origin + dir·far touch blocker o? (world AABB pre-test: most blockers are far away) */
  function mayHit(o, ray, far) {
    const g = o.geometry;
    if (!g || (o.children && o.children.length)) return true;   // groups / odd objects: let three test them
    if (!g.boundingBox) g.computeBoundingBox();
    _box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    if (_box.containsPoint(ray.origin)) return true;
    const p = ray.intersectBox(_box, _bp);
    return !!p && p.distanceToSquared(ray.origin) <= far * far;
  }
  /**
   * distance to the nearest blocker surface along the ray between near and far (Infinity when none). Both faces
   * count: a single-sided roof seen from under its eaves, or from inside its volume, still stops the camera.
   */
  function castBlockers(rc, origin, dir, far, blockers, near = 0) {
    rc.set(origin, dir); rc.near = near; rc.far = far;
    let best = Infinity;
    for (let i = 0; i < blockers.length; i++) {
      const o = blockers[i];
      if (!o || !mayHit(o, rc.ray, far)) continue;
      const m = o.material, side = m && !Array.isArray(m) && m.side !== THREE.DoubleSide ? m.side : -1;
      if (side >= 0) m.side = THREE.DoubleSide;           // restored right below (nothing renders in between)
      _hits.length = 0;
      try { rc.intersectObject(o, true, _hits); } catch (e) { _hits.length = 0; }
      if (side >= 0) m.side = side;
      if (_hits.length && _hits[0].distance < best) best = _hits[0].distance;
    }
    _hits.length = 0;
    return best;
  }
  /** is a blocker surface closer than NEAR_CLEAR above or below point p? */
  function crowded(rc, p, blockers) {
    for (let i = 0; i < PROBES.length; i++) if (castBlockers(rc, p, PROBES[i], NEAR_CLEAR, blockers) < NEAR_CLEAR) return true;
    return false;
  }
  const NO_OPTS = Object.freeze({});
  /** [x,y,z] | {x,y,z} -> out (false when missing / not finite) */
  function readVec(v, out) {
    if (!v) return false;
    const x = Array.isArray(v) ? v[0] : v.x, y = Array.isArray(v) ? v[1] : v.y, z = Array.isArray(v) ? v[2] : v.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    out.set(x, y, z); return true;
  }
  const _basis = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };

  const cam = {
    name: 'camera', order: 35, label: '카메라',
    mode: 'follow',
    yaw: DEF.yaw, pitch: DEF.pitch, distance: DEF.distance,
    _yawT: DEF.yaw, _pitchT: DEF.pitch, _distT: DEF.distance,
    _effDist: DEF.distance,          // distance after occlusion pull-in
    _blockDist: Infinity, _blockTimer: 0,
    _ft: new THREE.Vector3(),        // smoothed follow target
    _ftInit: false,
    _pos: new THREE.Vector3(0, 12, 30), _look: new THREE.Vector3(),
    _dPos: new THREE.Vector3(), _dLook: new THREE.Vector3(),
    _trans: null,                    // {t, dur, fromPos, fromLook}
    _shake: 0, _t: 0, _fov: FOV,
    _lastUserLook: -10,
    _cine: { center: new THREE.Vector3(0, 6, -30), radius: 70, height: 26, speed: 0.045, angle: 0.6 },
    _focus: { point: new THREE.Vector3(), obj: null, distance: 3.4, height: 1.75, side: 0.95, dir: new THREE.Vector3(0, 0, 1), orbit: false, yaw: 0, pitch: 0.25, pair: 0 },
    _photo: { yaw: 0, pitch: 0.2, dist: 4.5, height: 0 },
    _shot: { pos: new THREE.Vector3(0, 30, 60), look: new THREE.Vector3(0, 0, 0), fov: null },
    _lead: new THREE.Vector3(), _prevTarget: new THREE.Vector3(), _hasPrev: false, _speedK: 0,
    _ray: null,
    _occ: { n: -1, look: new THREE.Vector3(), dir: new THREE.Vector3(), wanted: 0 },   // last occlusion query (reused at rest)

    init() {
      this._ray = new THREE.Raycaster();
      this._ray.near = 0.2;
      const c = G.sys.engine?.camera;
      if (c) { this._pos.copy(c.position); this._look.set(0, 0, 0); }
      this._fromPos = new THREE.Vector3(); this._fromLook = new THREE.Vector3();
    },

    onStateLoaded() {
      const p = G.sys.player;
      const ry = p ? p.rotY : 0;
      const easy = gentle();
      this._yawT = this.yaw = ry + Math.PI;
      this._pitchT = this.pitch = easy ? EASY.pitch : DEF.pitch;
      this._distT = this.distance = this._effDist = easy ? EASY.distance : DEF.distance;
      this._ftInit = false;
      this._wasGentle = easy;
      if (this.mode === 'follow') this.snap();
    },

    /** easy-mode camera active (soft drag, comfortable zoom, auto-follow, no shake) */
    get gentle() { return gentle(); },
    /** easy <-> normal at runtime: ease into the other comfort range instead of jumping */
    _syncGentle() {
      const easy = gentle();
      if (easy === this._wasGentle) return;
      this._wasGentle = easy;
      if (easy) {
        this._distT = clamp(this._distT, EASY.dmin, EASY.dmax);
        if (Math.abs(this._distT - EASY.distance) > 2.5) this._distT = EASY.distance;
        this._pitchT = clamp(this._pitchT, EASY.pmin, EASY.pmax);
        this._shake = 0;
      }
      this._pitchT = clamp(this._pitchT, PMIN, PMAX);
    },

    // ------------------------------------------------------------ public API
    setMode(mode, opts = {}) {
      const prev = this.mode;
      if (!MODES.includes(mode)) { G.log.warn('UI', `camera: unknown mode ${mode}`); return; }
      if (mode === 'shot') return this.shot(opts.pos || this._pos, opts.look || this._look, opts);
      if (mode === 'cinematic') return this.cinematic(opts);
      if (mode === 'dialogue') return this.focusOn(opts.target || opts.point || G.sys.player?.position || _v.set(0, 1.4, 0), opts);
      if (mode === 'photo') {
        const ph = this._photo;
        ph.yaw = this.yaw; ph.pitch = clamp(this.pitch, -0.2, 1.0); ph.dist = clamp(Math.min(this.distance, 6), 1.6, 20); ph.height = 0;
      }
      if (mode === 'focus') {
        const f = this._focus;
        this._setFocusTarget(opts.target || opts.point);
        f.distance = opts.distance ?? 4; f.height = opts.height ?? 1.2; f.orbit = true;
        f.yaw = opts.yaw ?? this.yaw; f.pitch = opts.pitch ?? 0.3;
      }
      this._beginTransition(opts.duration ?? (prev === 'cinematic' ? 1.6 : 0.7));
      this.mode = mode;
      if (mode === 'follow') { this._ftInit = this._ftInit && prev !== 'cinematic' && prev !== 'shot'; this._lead.set(0, 0, 0); }
      G.bus.emit('camera:mode', { mode, prev });
    },

    cinematic(opts = {}) {
      const c = this._cine;
      if (opts.center) { if (Array.isArray(opts.center)) c.center.set(opts.center[0], opts.center[1] ?? 0, opts.center[2] ?? 0); else c.center.copy(opts.center); }
      if (opts.radius != null) c.radius = opts.radius;
      if (opts.height != null) c.height = opts.height;
      if (opts.speed != null) c.speed = opts.speed;
      if (opts.angle != null) c.angle = opts.angle;
      const prev = this.mode;
      if (prev !== 'cinematic') this._beginTransition(opts.duration ?? (G.ready ? 1.4 : 0));
      this.mode = 'cinematic';
      if (prev !== 'cinematic') G.bus.emit('camera:mode', { mode: 'cinematic', prev });
    },

    focusOn(target, opts = {}) {
      const f = this._focus;
      this._setFocusTarget(target);
      f.distance = opts.distance ?? 3.4;
      f.height = opts.height ?? 1.75;
      f.side = opts.side ?? 0.95;
      f.orbit = false;
      // 3/4 two-shot: camera on the player's side of the target, rotated towards the side the camera is already on
      this._focusPoint(_v);
      const pp = G.sys.player?.position;
      let ax = 0, az = 0;
      if (pp) { ax = pp.x - _v.x; az = pp.z - _v.z; }
      if (ax * ax + az * az < 0.04) { ax = this._pos.x - _v.x; az = this._pos.z - _v.z; }
      let l = Math.hypot(ax, az);
      if (l < 1e-3) { ax = 0; az = 1; l = 1; }
      ax /= l; az /= l;
      let px = -az, pz = ax;
      if (px * (this._pos.x - _v.x) + pz * (this._pos.z - _v.z) < 0) { px = -px; pz = -pz; }
      const c = Math.cos(f.side), sn = Math.sin(f.side);
      f.dir.set(ax * c + px * sn, 0, az * c + pz * sn).normalize();
      f.pair = pp ? Math.hypot(pp.x - _v.x, pp.z - _v.z) : 0;
      const prev = this.mode;
      this._beginTransition(opts.duration ?? 0.8);
      this.mode = 'dialogue';
      if (prev !== 'dialogue') G.bus.emit('camera:mode', { mode: 'dialogue', prev });
    },

    /**
     * scripted shot: put the camera at pos looking at look (Vector3 | [x,y,z] | {x,y,z}). Call it every frame
     * to fly a path; the first call eases in over opts.duration (default 0 = cut). opts.fov overrides the FOV.
     */
    shot(pos, look, opts = NO_OPTS) {
      const sh = this._shot;
      if (readVec(pos, _v3)) sh.pos.copy(_v3);
      if (readVec(look, _v2)) sh.look.copy(_v2);
      // narrow angles are allowed here (telescope views)
      sh.fov = opts && Number.isFinite(opts.fov) ? clamp(opts.fov, 10, 100) : (opts && opts.fov === null ? null : sh.fov);
      const prev = this.mode;
      if (prev !== 'shot') {
        this._beginTransition(opts && Number.isFinite(opts.duration) ? opts.duration : 0);
        this.mode = 'shot';
        G.bus.emit('camera:mode', { mode: 'shot', prev });
      }
    },

    photoControl(o = {}) {
      const ph = this._photo;
      if (o.dx) ph.yaw -= o.dx * 0.0055;
      if (o.dy) ph.pitch = clamp(ph.pitch + o.dy * 0.0045, -0.5, 1.35);
      if (o.zoom) ph.dist = clamp(ph.dist * (1 + o.zoom * 0.12), 1.2, 20);
      if (o.distance != null) ph.dist = clamp(o.distance, 1.2, 20);
      if (o.height != null) ph.height = clamp(o.height, -1, 3);
      if (o.yaw != null) ph.yaw = o.yaw;
      if (o.pitch != null) ph.pitch = clamp(o.pitch, -0.5, 1.35);
    },
    /** photo helper: put the camera in front of the player (selfie view) */
    photoFront() { const p = G.sys.player; if (p) { this._photo.yaw = p.rotY; this._photo.pitch = 0.12; this._photo.dist = 3.2; } },
    /** snapshot of the photo orbit {yaw, pitch, dist, height} (pass `out` to reuse an object every frame) */
    photoState(out) { const ph = this._photo, o = out || {}; o.yaw = ph.yaw; o.pitch = ph.pitch; o.dist = ph.dist; o.height = ph.height; return o; },
    /** set part of the photo orbit: setPhotoState({dist, height, yaw, pitch}) (values are clamped) */
    setPhotoState(s = {}) {
      if (!s || typeof s !== 'object') return this.photoState();
      const o = {};
      if (Number.isFinite(s.dist)) o.distance = s.dist;
      else if (Number.isFinite(s.distance)) o.distance = s.distance;
      if (Number.isFinite(s.height)) o.height = s.height;
      if (Number.isFinite(s.yaw)) o.yaw = s.yaw;
      if (Number.isFinite(s.pitch)) o.pitch = s.pitch;
      this.photoControl(o);
      return this.photoState();
    },

    shake(amount = 0.4) {
      if (G.settings.cameraShake === false || G.settings.reduceMotion || gentle()) return;
      if (!Number.isFinite(amount)) return;
      this._shake = clamp(this._shake + amount, 0, 1);
    },

    /** place the camera immediately (after teleport / load) */
    snap() {
      this.yaw = this._yawT; this.pitch = this._pitchT; this.distance = this._distT; this._effDist = this._distT;
      this._ftInit = false;
      this._lead.set(0, 0, 0); this._hasPrev = false; this._speedK = 0;
      this._trans = null;
      this._blockTimer = 0; this._occ.n = -1;
      this._computeDesired(0);
      this._pos.copy(this._dPos); this._look.copy(this._dLook);
      this._applyToCamera();
    },

    getMoveBasis() {
      let yaw;
      if (this.mode === 'follow' || this.mode === 'photo') yaw = this.mode === 'photo' ? this._photo.yaw : this.yaw;
      else {
        _v.subVectors(this._look, this._pos); _v.y = 0;
        yaw = _v.lengthSq() > 1e-6 ? Math.atan2(-_v.x, -_v.z) : this.yaw;
      }
      const s = Math.sin(yaw), c = Math.cos(yaw);
      _basis.forward.set(-s, 0, -c);
      _basis.right.set(c, 0, -s);
      return _basis;
    },

    /** yaw that puts the camera behind a character facing rotY */
    behind(rotY, instant) { this._yawT = rotY + Math.PI; if (instant) this.yaw = this._yawT; },

    // ------------------------------------------------------------ internals
    _setFocusTarget(t) {
      const f = this._focus;
      if (t && t.isObject3D) { f.obj = t; t.getWorldPosition(f.point); }
      else if (t) { f.obj = null; f.point.set(t.x ?? t[0] ?? 0, t.y ?? t[1] ?? 1.4, t.z ?? t[2] ?? 0); }
    },
    _focusPoint(out) { const f = this._focus; if (f.obj) f.obj.getWorldPosition(f.point); return out.copy(f.point); },
    _beginTransition(dur) {
      if (!(dur > 0)) { this._trans = null; return; }
      this._fromPos.copy(this._pos); this._fromLook.copy(this._look);
      this._trans = { t: 0, dur };
    },
    _playerTarget(out) {
      const p = G.sys.player;
      if (p && p.position) {
        const h = (p.rig?.height || 1.45);
        out.set(p.position.x, p.position.y + h * 0.78, p.position.z);
      } else out.copy(G.sys.engine?.focus || _v3.set(0, 0, 0)).y += 1.1;
      return out;
    },

    _computeDesired(dt) {
      const mode = this.mode;
      if (mode === 'follow' || mode === 'photo') {
        this._playerTarget(_v);
        const pl = G.sys.player;
        if (!this._ftInit || dt === 0 || !this._hasPrev) { this._ft.copy(_v); this._ftInit = true; }
        else {
          // feed forward with the player's own motion (continuous movement: zero lag, zero jitter) and only
          // smooth what is left (step-ups, small corrections); jumps are followed softly in height
          const mx = _v.x - this._prevTarget.x, my = _v.y - this._prevTarget.y, mz = _v.z - this._prevTarget.z;
          if (Math.abs(mx) < 4 && Math.abs(mz) < 4) { this._ft.x += mx; this._ft.z += mz; }
          if (pl?.grounded !== false && Math.abs(my) < 1) this._ft.y += my * 0.85;
          const kh = damp(14, dt), kv = damp(pl?.grounded === false ? 4 : 8, dt);
          this._ft.x += (_v.x - this._ft.x) * kh; this._ft.z += (_v.z - this._ft.z) * kh; this._ft.y += (_v.y - this._ft.y) * kv;
        }
        this._prevTarget.copy(_v); this._hasPrev = true;
        // speed factor 0 (<= walk pace) .. 1 (full sprint): look-ahead, dolly
        const vel = pl?.velocity;
        const sp = vel ? Math.hypot(vel.x, vel.z) : 0;
        const sk = Number.isFinite(sp) ? clamp(sp / RUN(), 0, 1) : 0;
        this._speedK += (sk - this._speedK) * damp(3, dt || 1);
        if (mode === 'follow' && vel && sp > 0.5 && Number.isFinite(sp)) {
          // reduce motion: no speed look-ahead (and no dolly / FOV kick below) — the view stays put
          const lead = G.settings?.reduceMotion ? 0 : (this._wasGentle ? LEAD_EASY : LEAD) * this._speedK;
          _v2.set(vel.x / sp * lead, 0, vel.z / sp * lead);
        } else _v2.set(0, 0, 0);
        this._lead.lerp(_v2, damp(2.4, dt || 1));
        let yaw, pitch, dist;
        if (mode === 'follow') {
          yaw = this.yaw; pitch = this.pitch;
          dist = this._effDist + (G.settings?.reduceMotion ? 0 : (this._wasGentle ? DOLLY_EASY : DOLLY) * this._speedK * (this._effDist / Math.max(1, this.distance)));
          // closer zoom (or occlusion pull-in) looks at the head / over the shoulder instead of the chest
          // far: pivot above the head so the player sits in the lower third and more of the world shows ahead
          const lift = clamp((5 - this.distance) / 2.5, 0, 1) * 0.28 + clamp((2.4 - dist) / 1.4, 0, 1) * 0.32 + clamp((dist - 2.6) / 5.4, 0, 1.45) * 0.85;
          this._dLook.copy(this._ft).add(this._lead); this._dLook.y += lift;
        } else {
          const ph = this._photo;
          yaw = ph.yaw; pitch = ph.pitch; dist = Math.min(ph.dist, this._blockDist);
          this._dLook.copy(this._ft); this._dLook.y += ph.height - 0.2;
        }
        const cp = Math.cos(pitch);
        this._dPos.set(this._dLook.x + Math.sin(yaw) * cp * dist, this._dLook.y + Math.sin(pitch) * dist, this._dLook.z + Math.cos(yaw) * cp * dist);
      } else if (mode === 'cinematic') {
        const c = this._cine;
        c.angle += c.speed * dt;
        this._dLook.copy(c.center);
        this._dPos.set(c.center.x + Math.sin(c.angle) * c.radius, c.center.y + c.height, c.center.z + Math.cos(c.angle) * c.radius);
      } else if (mode === 'dialogue') {
        const f = this._focus;
        this._focusPoint(_v);
        const gy = G.world.heightAt(_v.x, _v.z, _v.y + 0.5);
        if (_v.y - gy < 0.6) _v.y = gy + 1.25; // a feet-level target: frame the head instead
        const p = G.sys.player;
        const look = this._dLook.copy(_v);
        if (p && f.pair > 0 && f.pair < 8) { this._playerTarget(_v2); look.x += (_v2.x - _v.x) * 0.4; look.z += (_v2.z - _v.z) * 0.4; }
        const dist = Math.max(f.distance, (f.pair || 0) * 0.9 + 2.0);
        this._dPos.set(look.x + f.dir.x * dist, gy + f.height, look.z + f.dir.z * dist);
        look.y = _v.y - 0.12;
      } else if (mode === 'shot') {
        this._dPos.copy(this._shot.pos);
        this._dLook.copy(this._shot.look);
      } else if (mode === 'focus') {
        const f = this._focus;
        this._focusPoint(this._dLook);
        this._dLook.y += f.height - 1.2;
        const cp = Math.cos(f.pitch);
        this._dPos.set(this._dLook.x + Math.sin(f.yaw) * cp * f.distance, this._dLook.y + Math.sin(f.pitch) * f.distance, this._dLook.z + Math.cos(f.yaw) * cp * f.distance);
      }
      this._avoidGround(this._dPos, this._dLook);
    },

    /** keep the camera (and the line of sight) above terrain / water */
    _avoidGround(pos, look) {
      const W = G.world;
      let need = -Infinity;
      for (let i = 0; i < SAMPLES.length; i++) {
        const f = SAMPLES[i];
        const x = look.x + (pos.x - look.x) * f, z = look.z + (pos.z - look.z) * f;
        let h = W.heightAt(x, z, f === 1 ? pos.y + 0.3 : Infinity);
        if (W.isWater(x, z)) h = Math.max(h, (G.data.layout?.waterY ?? -1.1));
        const clearance = f === 1 ? 0.45 : 0.3;
        const y = look.y + (h + clearance - look.y) / f;
        if (y > need) need = y;
      }
      if (pos.y < need) pos.y = need;
    },

    _occlusion(dt) {
      // throttled raycast from the look target to the desired camera position against camera blockers
      this._blockTimer -= dt;
      const blockers = G.world.cameraBlockers;
      if (this._blockTimer <= 0) {
        this._blockTimer = 0.08;
        const oc = this._occ;
        if (blockers && blockers.length && (this.mode === 'follow' || this.mode === 'photo')) {
          const look = this._dLook;
          _dir.subVectors(this._dPos, look);
          const len = _dir.length();
          const wanted = this.mode === 'follow' ? this.distance : len;
          if (len > 0.3) _dir.multiplyScalar(1 / len);
          // nothing moved (a child standing still, the photo view at rest): the last answer still holds
          if (len > 0.3 && oc.n === blockers.length && oc.look.distanceToSquared(look) < 0.0025 && oc.dir.dot(_dir) > 0.9999 && Math.abs(oc.wanted - wanted) < 0.05) return this._effFollow(dt);
          this._blockDist = Infinity;
          if (len > 0.3) {
            // test the whole WANTED distance, not just the current (already pulled-in) one: otherwise the ray stops
            // short of the blocker once the camera has moved in, the pull-in is released, the camera slides back
            // into the roof and is pulled in again — a frame-by-frame flicker in and out of roofs
            const hit = castBlockers(this._ray, look, _dir, Math.max(len, wanted + 1.2) + 0.3, blockers, 0.2);
            let d = Number.isFinite(hit) ? Math.max(1.05, hit - 0.35) : Infinity;
            // clearance at the spot the camera would take: a roof just above (camera under the eaves) or just below
            // fills the near plane although the line of sight slips past it — move in to the largest clear distance
            // between 1.05 m and here (bisection, 4 probes: within 1/16 of that span): a low roof (정자) keeps the
            // distance it allows instead of losing up to 0.6 m to fixed steps
            let at = Math.min(d, wanted);
            if (at > 1.05) {
              _probe.copy(look).addScaledVector(_dir, at);
              if (crowded(this._ray, _probe, blockers)) {
                let lo = 1.05, hi = at;
                for (let k = 0; k < 4; k++) {
                  const mid = (lo + hi) * 0.5;
                  _probe.copy(look).addScaledVector(_dir, mid);
                  if (crowded(this._ray, _probe, blockers)) hi = mid; else lo = mid;
                }
                at = lo;
                d = at;
              }
            }
            this._blockDist = d;
            oc.n = blockers.length; oc.look.copy(look); oc.dir.copy(_dir); oc.wanted = wanted;
          } else oc.n = -1;
        } else { this._blockDist = Infinity; oc.n = -1; }
      }
      this._effFollow(dt);
    },
    /** ease the effective follow distance towards min(zoom, occlusion limit): in fast, out slowly */
    _effFollow(dt) {
      if (this.mode === 'follow') {
        const want = Math.min(this.distance, this._blockDist);
        this._effDist += (want - this._effDist) * damp(want < this._effDist ? 20 : 3, dt);
      } else this._effDist = this.distance;
    },

    update(dt, t) {
      this._t = t;
      const look = G.input?.consumeLook?.() || { dx: 0, dy: 0 };
      const zoom = G.input?.consumeZoom?.() || 0;
      const mode = this.mode;
      if (!Number.isFinite(look.dx)) look.dx = 0;
      if (!Number.isFinite(look.dy)) look.dy = 0;
      const zm = Number.isFinite(zoom) ? clamp(zoom, -4, 4) : 0;
      this._syncGentle();
      if (mode === 'follow') {
        const easy = this._wasGentle;
        const ls = easy ? EASY.look : 1;
        if (look.dx || look.dy) {
          this._yawT -= look.dx * 0.0055 * ls;
          this._pitchT = clamp(this._pitchT + look.dy * 0.0042 * ls, easy ? EASY.pmin : PMIN, easy ? EASY.pmax : PMAX);
          this._lastUserLook = t;
        }
        if (zm) this._distT = clamp(this._distT * (1 + zm * (easy ? 0.09 : 0.12)), easy ? EASY.dmin : DMIN, easy ? EASY.dmax : DMAX);
        if (easy) this._autoFollow(dt, t); else this._autoAlign(dt, t);
        const k = damp(15, dt);
        this.yaw += angleDiff(this.yaw, this._yawT) * k;
        this.pitch += (this._pitchT - this.pitch) * k;
        this.distance += (this._distT - this.distance) * damp(9, dt);
      } else if (mode === 'photo') {
        if (look.dx || look.dy || zm) {
          const ph = this._photo;
          const ls = this._wasGentle ? 0.75 : 1;
          ph.yaw -= look.dx * 0.0055 * ls;
          ph.pitch = clamp(ph.pitch + look.dy * 0.0045 * ls, -0.5, 1.35);
          if (zm) ph.dist = clamp(ph.dist * (1 + zm * 0.12), 1.2, 20);
        }
      } else if (mode === 'focus') {
        const f = this._focus;
        if (look.dx) f.yaw -= look.dx * 0.0055;
        if (look.dy) f.pitch = clamp(f.pitch + look.dy * 0.0042, -0.2, 1.2);
        if (zm) f.distance = clamp(f.distance * (1 + zm * 0.12), 1.2, 14);
      }
      this._occlusion(dt);
      this._computeDesired(dt);

      // smoothing + mode transitions
      if (this._trans) {
        const tr = this._trans;
        tr.t += dt;
        const k = ease(tr.t / tr.dur);
        this._pos.lerpVectors(this._fromPos, this._dPos, k);
        this._look.lerpVectors(this._fromLook, this._dLook, k);
        this._avoidGround(this._pos, this._look);
        if (tr.t >= tr.dur) this._trans = null;
      } else if (mode === 'dialogue' || mode === 'focus') {
        const k = damp(6, dt);
        this._pos.lerp(this._dPos, k); this._look.lerp(this._dLook, k);
      } else {
        this._pos.copy(this._dPos); this._look.copy(this._dLook);
      }
      this._guardFinite();
      this._applyToCamera(dt);
    },

    /** a NaN target (bad position, zero-length focus) must never poison the camera: restore the last finite frame */
    _guardFinite() {
      const ok = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
      if (!this._goodPos) { this._goodPos = new THREE.Vector3(0, 8, 14); this._goodLook = new THREE.Vector3(0, 1, 0); }
      if (ok(this._pos) && ok(this._look)) { this._goodPos.copy(this._pos); this._goodLook.copy(this._look); return; }
      this._pos.copy(this._goodPos); this._look.copy(this._goodLook);
      this._trans = null;
      for (const k of ['yaw', '_yawT']) if (!Number.isFinite(this[k])) this[k] = 0;
      for (const k of ['pitch', '_pitchT']) if (!Number.isFinite(this[k])) this[k] = 0.35;
      for (const k of ['distance', '_distT']) if (!Number.isFinite(this[k])) this[k] = 6;
      const f = this._focus;
      if (!ok(f.point)) { f.obj = null; f.point.copy(this._goodLook); }
      if (!Number.isFinite(f.distance)) f.distance = 3.4;
      if (!Number.isFinite(f.yaw)) f.yaw = 0;
      if (!Number.isFinite(f.pitch)) f.pitch = 0.25;
      const now = performance.now();
      if (now - (this._nanWarnAt || 0) > 5000) { this._nanWarnAt = now; G.log.warn('UI', 'camera: non-finite target repaired'); }
    },

    /**
     * easy mode: gently swing behind the walking player — joystick / keys forward-ish and auto-walk (walkTo) —
     * and ease the pitch back to the comfortable default; never while (or right after) the child drags the view.
     */
    _autoFollow(dt, t) {
      const p = G.sys.player, ax = G.input?.axis;
      if (!p || !p.velocity || t - this._lastUserLook < 2.2) return;
      const sp = Math.hypot(p.velocity.x, p.velocity.z);
      if (!(sp > WALK() * 0.09)) return;
      const manual = !!ax && Math.hypot(ax.x, ax.y) > 0.05;
      if (manual && (ax.y < 0.3 || Math.abs(ax.x) > 0.6)) return; // strafing / backing up: do not chase (no circling)
      const behind = Math.atan2(p.velocity.x, p.velocity.z) + Math.PI;
      if (!Number.isFinite(behind)) return;
      const k = damp((p.isWalking && !manual ? 1.5 : 1.25) * Math.min(1, sp / WALK()), dt);
      this._yawT += clamp(angleDiff(this._yawT, behind) * k, -SWING_MAX * dt, SWING_MAX * dt);
      this._pitchT += (EASY.pitch - this._pitchT) * damp(0.5, dt);
    },

    _autoAlign(dt, t) {
      // gently swing behind the player while walking forward with the keyboard (never fights the mouse)
      const p = G.sys.player, ax = G.input?.axis;
      if (!p || !ax || t - this._lastUserLook < 1.8) return;
      const sp = p.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
      if (!(sp >= WALK() * 0.1) || ax.y < 0.3 || Math.abs(ax.x) > 0.55) return;
      const behind = Math.atan2(p.velocity.x, p.velocity.z) + Math.PI;
      if (!Number.isFinite(behind)) return;
      this._yawT += clamp(angleDiff(this._yawT, behind) * damp(0.9 * Math.min(1, sp / WALK()), dt), -SWING_MAX * dt, SWING_MAX * dt);
    },

    _applyToCamera(dt = 0) {
      const c = G.sys.engine?.camera;
      if (!c) return;
      c.position.copy(this._pos);
      c.lookAt(this._look);
      // trauma shake (small rotations)
      if (this._shake > 0.001) {
        const s = this._shake * this._shake, t = this._t;
        c.rotateX((Math.sin(t * 41.3) * 0.6 + Math.sin(t * 23.7) * 0.4) * 0.035 * s);
        c.rotateY((Math.sin(t * 37.9 + 1.3) * 0.6 + Math.sin(t * 19.1) * 0.4) * 0.035 * s);
        c.rotateZ(Math.sin(t * 29.3 + 2.1) * 0.02 * s);
        this._shake = Math.max(0, this._shake - (dt || 0.016) * 1.4);
      }
      // subtle FOV kick from walk pace to a full sprint (normal mode only; easy mode keeps a fixed FOV)
      const p = G.sys.player;
      const sp = p?.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
      let target = FOV;
      if (this.mode === 'shot' && Number.isFinite(this._shot.fov)) target = this._shot.fov;
      else if (this.mode === 'follow' && !this._wasGentle && !G.settings?.reduceMotion && Number.isFinite(sp)) target = FOV + clamp((sp - WALK() * 1.05) / (RUN() - WALK() * 1.05), 0, 1) * FOV_KICK;
      this._fov += (target - this._fov) * damp(this.mode === 'shot' ? 6 : 3, dt || 1);
      if (!Number.isFinite(this._fov)) this._fov = FOV;
      if (Math.abs(c.fov - this._fov) > 0.01) { c.fov = this._fov; c.updateProjectionMatrix(); }
    },
  };
  G.register(cam);
})();
