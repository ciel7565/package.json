// =============================================================================
// 22-camera.js — third-person orbit camera (G.sys.camera)
//
//   mode: 'follow' | 'cinematic' | 'dialogue' | 'photo' | 'focus'
//   setMode(mode, opts)                         smooth transition between modes
//   getMoveBasis() -> {forward, right}          XZ unit vectors for camera-relative movement
//   cinematic({center:[x,y,z], radius, height, speed, angle})   slow orbit (title screen)
//   focusOn(vec3|Object3D, {distance, height, duration, side})  dialogue framing (over the shoulder)
//   photoControl({dx, dy, zoom, height})        free orbit around the player in photo mode (<= 20 m)
//   shake(amount 0..1), snap(), yaw / pitch / distance
// Drag (G.input.consumeLook) rotates, wheel / pinch (G.input.consumeZoom) zooms 2.5–16 m.
// The camera never goes below the terrain and pulls in when G.world.cameraBlockers occlude the player.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => G.util.angleDiff(a, b);
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  const PMIN = -0.32, PMAX = 1.22;     // follow pitch range (rad)
  const DMIN = 2.5, DMAX = 16;          // follow zoom range (m)
  const DEF = { yaw: 0, pitch: 0.36, distance: 8 };
  const FOV = 55;
  const SAMPLES = [0.35, 0.7, 1];

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _dir = new THREE.Vector3();
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
    _ray: null,

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
      this._yawT = this.yaw = ry + Math.PI;
      this._pitchT = this.pitch = DEF.pitch;
      this._distT = this.distance = this._effDist = DEF.distance;
      this._ftInit = false;
      if (this.mode === 'follow') this.snap();
    },

    // ------------------------------------------------------------ public API
    setMode(mode, opts = {}) {
      const prev = this.mode;
      if (!['follow', 'cinematic', 'dialogue', 'photo', 'focus'].includes(mode)) { G.log.warn('UI', `camera: unknown mode ${mode}`); return; }
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
      if (mode === 'follow') { this._ftInit = this._ftInit && prev !== 'cinematic'; }
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

    shake(amount = 0.4) {
      if (G.settings.cameraShake === false || G.settings.reduceMotion) return;
      this._shake = clamp(this._shake + amount, 0, 1);
    },

    /** place the camera immediately (after teleport / load) */
    snap() {
      this.yaw = this._yawT; this.pitch = this._pitchT; this.distance = this._distT; this._effDist = this._distT;
      this._ftInit = false;
      this._trans = null;
      this._blockTimer = 0;
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
        if (!this._ftInit || dt === 0) { this._ft.copy(_v); this._ftInit = true; }
        else {
          const kh = damp(16, dt), kv = damp(7, dt);
          this._ft.x += (_v.x - this._ft.x) * kh; this._ft.z += (_v.z - this._ft.z) * kh; this._ft.y += (_v.y - this._ft.y) * kv;
        }
        let yaw, pitch, dist;
        if (mode === 'follow') {
          yaw = this.yaw; pitch = this.pitch; dist = this._effDist;
          // closer zoom (or occlusion pull-in) looks at the head / over the shoulder instead of the chest
          // far: pivot above the head so the player sits in the lower third and more of the world shows ahead
          const lift = clamp((5 - this.distance) / 2.5, 0, 1) * 0.28 + clamp((2.4 - dist) / 1.4, 0, 1) * 0.32 + clamp((dist - 2.6) / 5.4, 0, 1.45) * 0.85;
          this._dLook.copy(this._ft); this._dLook.y += lift;
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
        this._blockDist = Infinity;
        if (blockers && blockers.length && (this.mode === 'follow' || this.mode === 'photo')) {
          const look = this._dLook;
          _dir.subVectors(this._dPos, look);
          const len = _dir.length();
          if (len > 0.3) {
            _dir.multiplyScalar(1 / len);
            const r = this._ray;
            r.set(look, _dir);
            r.far = len + 0.3;
            let hits = null;
            try { hits = r.intersectObjects(blockers, true); } catch (e) { hits = null; }
            if (hits && hits.length) this._blockDist = Math.max(1.05, hits[0].distance - 0.35);
          }
        }
      }
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
      if (mode === 'follow') {
        if (look.dx || look.dy) {
          this._yawT -= look.dx * 0.0055;
          this._pitchT = clamp(this._pitchT + look.dy * 0.0042, PMIN, PMAX);
          this._lastUserLook = t;
        }
        if (zoom) this._distT = clamp(this._distT * (1 + zoom * 0.12), DMIN, DMAX);
        this._autoAlign(dt, t);
        const k = damp(15, dt);
        this.yaw += angleDiff(this.yaw, this._yawT) * k;
        this.pitch += (this._pitchT - this.pitch) * k;
        this.distance += (this._distT - this.distance) * damp(9, dt);
      } else if (mode === 'photo') {
        if (look.dx || look.dy || zoom) {
          const ph = this._photo;
          ph.yaw -= look.dx * 0.0055;
          ph.pitch = clamp(ph.pitch + look.dy * 0.0045, -0.5, 1.35);
          if (zoom) ph.dist = clamp(ph.dist * (1 + zoom * 0.12), 1.2, 20);
        }
      } else if (mode === 'focus') {
        const f = this._focus;
        if (look.dx) f.yaw -= look.dx * 0.0055;
        if (look.dy) f.pitch = clamp(f.pitch + look.dy * 0.0042, -0.2, 1.2);
        if (zoom) f.distance = clamp(f.distance * (1 + zoom * 0.12), 1.2, 14);
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
      this._applyToCamera(dt);
    },

    _autoAlign(dt, t) {
      // gently swing behind the player while walking forward with the keyboard (never fights the mouse)
      const p = G.sys.player, ax = G.input?.axis;
      if (!p || !ax || t - this._lastUserLook < 1.8) return;
      const sp = p.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
      if (sp < 1 || ax.y < 0.3 || Math.abs(ax.x) > 0.55) return;
      const behind = Math.atan2(p.velocity.x, p.velocity.z) + Math.PI;
      this._yawT += angleDiff(this._yawT, behind) * damp(0.9 * Math.min(1, sp / 3.2), dt);
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
      // subtle FOV kick while running
      const p = G.sys.player;
      const sp = p?.velocity ? Math.hypot(p.velocity.x, p.velocity.z) : 0;
      const target = this.mode === 'follow' ? FOV + clamp((sp - 3.6) / 2.4, 0, 1) * 4 : FOV;
      this._fov += (target - this._fov) * damp(4, dt || 1);
      if (Math.abs(c.fov - this._fov) > 0.01) { c.fov = this._fov; c.updateProjectionMatrix(); }
    },
  };
  G.register(cam);
})();
