// =============================================================================
// 21-player.js — local player controller (G.sys.player)
//
//   object, position, rotY, velocity, grounded, rig, radius, enabled, speed, sitting, isWalking
//   teleport(x, z, rotY?, {fade=true}) -> Promise
//   walkTo({x,z}, {stopDistance=1.2, onArrive, onFail, run})   click-to-move / auto-interact steering
//   cancelWalk(), playAction(anim, {duration, loop}), stopAction(), faceTowards(x, z)
//   sit(benchAnchor?), standUp(), setAppearance(app)
// Camera-relative WASD (walk 3.2 m/s, Shift run 6 m/s), Space jump, smooth turning, step-up via
// G.world.heightAt, colliders via G.world.resolve, water/bounds/steep-slope blocking, footsteps.
// Events: player:moved {x,z} (<=4/s), player:distance {meters} (batched >= 5 m).
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => G.util.angleDiff(a, b);

  const WALK = 3.2, RUN = 6.0;
  const GRAVITY = 22, JUMP_V = 5.7;
  const ACCEL = 18, DECEL = 22, AIR_ACCEL = 6;
  const MAX_SLOPE = Math.tan(40 * Math.PI / 180);
  const RADIUS = 0.35;
  const DEFAULT_SEAT = 0.42;
  const WADE_DEPTH = 0.18; // deepest shallow water (below the surface) the player may wade into

  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
  const _fallbackBasis = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };

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
            this.sit({ id, x: b.x, z: b.z, rot: b.rot || 0, seatY: Number.isFinite(seat) ? seat : DEFAULT_SEAT });
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
      const valid = Number.isFinite(x) && Number.isFinite(z) && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && !state?._isNew;
      if (!valid) { x = sp.x; z = sp.z; ry = sp.rotY; y = 0; }
      const free = this._findFree(x, z, Number.isFinite(y) ? y : 0);
      if (!free) { x = sp.x; z = sp.z; } else { x = free.x; z = free.z; }
      const gy = G.world.heightAt(x, z, (Number.isFinite(y) ? y : 0) + 0.3);
      this.position.set(x, Number.isFinite(gy) ? gy : 0, z);
      this.rotY = Number.isFinite(ry) ? ry : (sp.rotY ?? Math.PI);
      this.object.rotation.y = this.rotY;
      this.velocity.set(0, 0, 0);
      this.grounded = true;
      this.sitting = null; this._walk = null; this._faceT = null; this._slide = null;
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
    },

    _writeState() {
      const s = G.state?.player;
      if (!s || !this._ready) return;
      s.x = Math.round(this.position.x * 100) / 100;
      s.y = Math.round(this.position.y * 100) / 100;
      s.z = Math.round(this.position.z * 100) / 100;
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
      if (!Number.isFinite(x) || !Number.isFinite(z)) { G.log.warn('PLAYER', 'teleport ignored: non-finite target', x, z); return; }
      const run = () => {
        const f = this._findFree(x, z, G.world.surfaceHeight(x, z)) || { x, z };
        this.cancelWalk('teleport');
        this.sitting = null; this._slide = null; this._faceT = null;
        this.rig.stopAll();
        const y = G.world.surfaceHeight(f.x, f.z);
        this.position.set(f.x, Number.isFinite(y) ? y : 0, f.z);
        G.world.clampToBounds(this.position);
        if (rotY != null && Number.isFinite(rotY)) this.rotY = rotY;
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

    walkTo(target, opts = {}) {
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return false;
      if (this.sitting) this.standUp();
      if (this.rig.actionFullBody) this.rig.stopAction();
      const d = Math.hypot(target.x - this.position.x, target.z - this.position.z);
      this._walk = {
        id: ++this._walkSeq, x: target.x, z: target.z, stop: Math.max(0.15, opts.stopDistance ?? 1.2),
        onArrive: opts.onArrive || null, onFail: opts.onFail || null, run: opts.run ?? d > 16,
        best: d, bestT: G.time.elapsed,
      };
      this._faceT = null;
      return this._walk.id;
    },
    cancelWalk(reason) {
      const w = this._walk;
      if (!w) return;
      this._walk = null;
      if (reason && reason !== 'arrived') { try { w.onFail?.(reason); } catch (e) { G.log.error('PLAYER', e); } }
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
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const dx = x - this.position.x, dz = z - this.position.z;
      if (dx * dx + dz * dz < 1e-4) return;
      this._faceT = Math.atan2(dx, dz);
    },

    sit(bench) {
      this.cancelWalk('sit');
      this.velocity.set(0, 0, 0);
      let seatY = 0;
      if (bench && Number.isFinite(bench.x) && Number.isFinite(bench.z)) {
        const rot = bench.rot || 0;
        const fx = Math.sin(rot), fz = Math.cos(rot);
        const gx = bench.x + fx * 0.06, gz = bench.z + fz * 0.06;
        let gy = G.world.heightAt(gx, gz, this.position.y);
        if (!(gy <= this.position.y + 0.25)) gy = this.position.y;
        this._slideTo(gx, gy, gz, 0.28);
        this.rotY = rot;
        this._faceT = null;
        seatY = Number.isFinite(bench.seatY) ? bench.seatY : DEFAULT_SEAT;
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

    // ------------------------------------------------------------ internals
    _slideTo(x, y, z, dur) {
      this._slide = { fx: this.position.x, fy: this.position.y, fz: this.position.z, x, y, z, t: 0, dur };
    },

    /** nearest walkable spot (not water, not inside colliders) within ~8 m */
    _findFree(x, z, y = 0) {
      const W = G.world;
      if (!W.blocked(x, z, RADIUS * 0.9, y)) return { x, z };
      for (let r = 0.75; r <= 8; r += 0.75) {
        const n = Math.max(8, Math.round(r * 6));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (!W.blocked(px, pz, RADIUS * 0.9, W.heightAt(px, pz, y + 0.3))) return { x: px, z: pz };
        }
      }
      return null;
    },

    /** single collision-checked step to (tx, tz); returns false when blocked */
    _tryStep(tx, tz) {
      const W = G.world, p = this.position;
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
      if (W.isWater(_t1.x, _t1.z)) return false;
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

    update(dt, t) {
      const input = G.input;
      input?.update?.();
      if (!this._ready) { this.rig.update(dt, this._rigParams); return; }
      const W = G.world, p = this.position, v = this.velocity;
      const ctl = this.enabled && (input ? input.gameplay() : true);

      // ---- smooth reposition (sit / stand up)
      if (this._slide) {
        const s = this._slide;
        s.t += dt;
        const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
        p.set(s.fx + (s.x - s.fx) * e, s.fy + (s.y - s.fy) * e, s.fz + (s.z - s.fz) * e);
        if (k >= 1) this._slide = null;
      }

      // ---- desired direction
      let dx = 0, dz = 0, want = 0;
      const ax = input ? input.axis : null;
      const mag = ax ? Math.min(1, Math.hypot(ax.x, ax.y)) : 0;
      if (ctl && mag > 0.05) {
        const bs = G.sys.camera?.getMoveBasis?.() || _fallbackBasis;
        dx = bs.forward.x * ax.y + bs.right.x * ax.x;
        dz = bs.forward.z * ax.y + bs.right.z * ax.x;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        want = (input.running ? RUN : WALK) * mag;
        this._faceT = null;
      } else if (this._walk && ctl) {
        const w = this._walk;
        const ex = w.x - p.x, ez = w.z - p.z;
        const d = Math.hypot(ex, ez);
        if (d <= w.stop) {
          this._walk = null;
          try { w.onArrive?.(); } catch (e) { G.log.error('PLAYER', 'onArrive', e); }
        } else {
          dx = ex / d; dz = ez / d;
          want = (w.run ? RUN : WALK) * clamp((d - w.stop) / 1.1 + 0.35, 0.35, 1);
          if (d < w.best - 0.15) { w.best = d; w.bestT = t; }
          else if (t - w.bestT > 1.6) { G.log.debug('PLAYER', 'walkTo stuck'); this.cancelWalk('stuck'); want = 0; }
        }
      }
      if (this.sitting || this._slide) want = 0;
      if (want > 0 && this.rig.actionFullBody) this.rig.stopAction();

      // ---- horizontal velocity
      const tvx = dx * want, tvz = dz * want;
      const acc = this.grounded ? (want > 0 ? ACCEL : DECEL) : AIR_ACCEL;
      let ddx = tvx - v.x, ddz = tvz - v.z;
      const dl = Math.hypot(ddx, ddz), maxd = acc * dt;
      if (dl > maxd) { ddx *= maxd / dl; ddz *= maxd / dl; }
      v.x += ddx; v.z += ddz;

      // ---- turning
      if (want > 0.1) {
        this.rotY += angleDiff(this.rotY, Math.atan2(dx, dz)) * damp(this.grounded ? 13 : 6, dt);
      } else if (this._faceT != null && !this.sitting) {
        const diff = angleDiff(this.rotY, this._faceT);
        this.rotY += diff * damp(10, dt);
        if (Math.abs(diff) < 0.01) this._faceT = null;
      }
      this.rotY = Math.atan2(Math.sin(this.rotY), Math.cos(this.rotY));

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
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || p.y < -40) {
        const sp = G.data.layout?.spawn || { x: 0, z: 9 };
        p.set(sp.x, W.surfaceHeight(sp.x, sp.z), sp.z); v.set(0, 0, 0); this.grounded = true;
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
