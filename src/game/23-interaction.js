// =============================================================================
// 23-interaction.js — interactable registry, focus highlight, E / click interaction (G.interact)
//
//   G.interact.register({id, kind, label: string|()=>string, position: Vector3|()=>Vector3, object?: Object3D,
//                        radius=2.6, priority=0, enabled?: ()=>bool, onInteract: ()=>void, highlight=true})
//      -> {id, unregister(), setEnabled(b)}
//   G.interact.unregister(id), get(id), list(kind?), current, hovered, trigger(), activate(id) (walks there first),
//   setObject(id, obj) (attach a mesh built after registration)
// Each frame the best candidate (distance + player facing / camera forward + priority) gets the
// #interact-prompt and a soft gold ground ring + bobbing arrow. E / d-pad centre / mobile E trigger it,
// then 'interact' {kind, id} is emitted. Clicking a registered object interacts (or walks there first);
// clicking the ground walks there with a destination marker when G.settings.clickToMove is on.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const KIND_ICON = {
    npc: '💬', jar: '🏺', plot: '🌱', sign: '🪧', kiosk: '🖥️', exhibit: '🍲', tool: '🧺', jardisp: '🏺', craft: '🛠️',
    shop: '🛒', door: '🚪', board: '📋', photo: '📷', bench: '🪑',
  };
  // kinds where the player does a small "reach / look" gesture on interaction
  const GESTURE_KINDS = new Set(['sign', 'kiosk', 'exhibit', 'tool', 'jardisp', 'board', 'door', 'craft', 'shop', 'jar']);

  const entries = new Map();
  const objToEntry = new Map();
  let pickList = [];               // [entry objects..., ground meshes..., camera blockers...]
  let pickKey = '';
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _box = new THREE.Box3(), _size = new THREE.Vector3(), _ctr = new THREE.Vector3();
  const _quat = new THREE.Quaternion(), _eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const RING_MAX = 2.1;       // largest round highlight (m); bigger footprints get a rectangular outline
  const RECT_MIN = 3.4;       // footprint (m) from which the outline is rectangular
  const RECT_W = 0.34;        // outline strip width (m)

  function readPos(e, out) {
    try {
      let v = e.position;
      if (typeof v === 'function') v = v();
      if (v) {
        if (Array.isArray(v)) return out.set(v[0], v[1] ?? 0, v[2] ?? 0);
        return out.set(v.x, v.y ?? 0, v.z);
      }
      if (e.object) return e.object.getWorldPosition(out);
    } catch (err) { /* broken provider */ }
    return null;
  }
  function isEnabled(e) {
    if (e.disabled) return false;
    if (!e.enabled) return true;
    try { return !!e.enabled(); } catch (err) { return false; }
  }
  function labelOf(e) {
    try { return String((typeof e.label === 'function' ? e.label() : e.label) ?? ''); } catch (err) { return ''; }
  }

  const interact = {
    name: 'interaction', order: 40, label: '상호작용',
    current: null,
    hovered: null,
    _lastTrigger: 0,
    _promptKey: '',
    _fx: null,              // highlight state {ringR, offX, offZ, top}
    _lookV: new THREE.Vector3(), _lookOwned: false,
    _dest: null,            // destination marker state
    _hoverT: 0, _hoverXY: null,

    // ------------------------------------------------------------ registry
    register(opts) {
      if (!opts || !opts.id) { G.log.warn('UI', 'interact.register: id is required'); return null; }
      if (entries.has(opts.id)) this.unregister(opts.id);
      const e = {
        id: opts.id, kind: opts.kind || 'object', label: opts.label ?? '살펴보기', position: opts.position || null,
        object: opts.object || null, radius: opts.radius ?? 2.6, priority: opts.priority || 0, enabled: opts.enabled || null,
        onInteract: opts.onInteract || null, highlight: opts.highlight !== false, disabled: false,
      };
      entries.set(e.id, e);
      if (e.object) objToEntry.set(e.object, e);
      pickKey = '';
      const self = this;
      return {
        id: e.id,
        unregister() { self.unregister(e.id); },
        setEnabled(b) { e.disabled = !b; },
        get entry() { return e; },
      };
    },
    unregister(id) {
      const e = entries.get(id);
      if (!e) return;
      entries.delete(id);
      if (e.object && objToEntry.get(e.object) === e) objToEntry.delete(e.object);
      pickKey = '';
      if (this.current === e) this._setCurrent(null);
      if (this.hovered === e) this.hovered = null;
    },
    get(id) { return entries.get(id) || null; },
    /** attach / replace the 3D object of an entry (e.g. when the mesh is built after registration) */
    setObject(id, obj) {
      const e = entries.get(id);
      if (!e) return false;
      if (e.object && objToEntry.get(e.object) === e) objToEntry.delete(e.object);
      e.object = obj || null;
      if (e.object) objToEntry.set(e.object, e);
      pickKey = '';
      if (this.current === e) { this.current = null; this._setCurrent(e); }
      return true;
    },
    list(kind) { const out = []; for (const e of entries.values()) if (!kind || e.kind === kind) out.push(e); return out; },

    /** interact with the focused candidate */
    trigger(source = 'api') { return this.current ? this._do(this.current, source) : false; },
    /** interact with a specific entry by id (walks there first when far away) */
    activate(id, opts = {}) {
      const e = entries.get(id);
      if (!e) return false;
      return this._approach(e, opts.walk !== false);
    },

    // ------------------------------------------------------------ lifecycle
    init() {
      this._buildFx();
      this._bindPrompt();
      G.bus.on('input:interact', () => {
        if (G.ui?.isBlocking?.() || !this._playerReady()) return;
        this.trigger('input');
      });
      G.bus.on('input:click', (ev) => this._onClick(ev));
      const cont = document.getElementById('game-container');
      if (cont && !G.input?.touchUI) {
        const hxy = { x: 0, y: 0 };
        cont.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') { hxy.x = ev.clientX; hxy.y = ev.clientY; this._hoverXY = hxy; this._hoverDirty = true; } });
        cont.addEventListener('pointerleave', () => { this._hoverXY = null; this._setCursor(''); });
      }
    },

    onLogout() {
      this._setCurrent(null);
      this._hideDest();
      this._setCursor('');
    },

    _playerReady() {
      const p = G.sys.player;
      return !!(p && p.object && p.object.visible && p._ready !== false);
    },

    // ------------------------------------------------------------ fx (ring, arrow, destination marker)
    _buildFx() {
      const scene = G.sys.engine.scene;
      const ringTex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
        const c = w / 2;
        const g = ctx.createRadialGradient(c, c, 0, c, c, c);
        g.addColorStop(0, 'rgba(255,214,102,0.10)');
        g.addColorStop(0.62, 'rgba(255,214,102,0.16)');
        g.addColorStop(0.74, 'rgba(255,214,102,0.0)');
        g.addColorStop(0.80, 'rgba(255,220,120,0.85)');
        g.addColorStop(0.86, 'rgba(255,246,205,1)');
        g.addColorStop(0.92, 'rgba(255,214,102,0.55)');
        g.addColorStop(1, 'rgba(255,214,102,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      });
      const dashTex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
        const c = w / 2;
        ctx.strokeStyle = 'rgba(255,240,190,0.95)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
        for (let i = 0; i < 12; i++) {
          const a0 = (i / 12) * Math.PI * 2, a1 = a0 + 0.24;
          ctx.beginPath(); ctx.arc(c, c, c * 0.955, a0, a1); ctx.stroke();
        }
      });
      const mk = (tex, color, opacity) => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const ring = new THREE.Group(); ring.name = 'interactRing';
      this._ringA = new THREE.Mesh(plane, mk(ringTex, 0xffe08a, 0.9));
      this._ringB = new THREE.Mesh(plane, mk(dashTex, 0xffe9b0, 0.75));
      this._ringB.position.y = 0.005;
      ring.add(this._ringA, this._ringB);
      ring.visible = false; ring.renderOrder = 3;
      this._ringA.renderOrder = 3; this._ringB.renderOrder = 4;
      scene.add(ring);
      this._ring = ring;

      // rectangular outline for large footprints (farm beds): 4 glowing strips, glow across the strip width
      const stripTex = G.gfx.canvasTexture(8, 64, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(255,214,102,0)');
        g.addColorStop(0.3, 'rgba(255,214,102,0.28)');
        g.addColorStop(0.46, 'rgba(255,236,170,0.95)');
        g.addColorStop(0.5, 'rgba(255,250,225,1)');
        g.addColorStop(0.54, 'rgba(255,236,170,0.95)');
        g.addColorStop(0.7, 'rgba(255,214,102,0.28)');
        g.addColorStop(1, 'rgba(255,214,102,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
      const cornerTex = G.gfx.radialTexture(64, 'rgba(255,246,205,1)', 'rgba(255,214,102,0)');
      const rect = new THREE.Group(); rect.name = 'interactRect';
      const stripMat = mk(stripTex, 0xffe08a, 0.9);
      const cornerMat = mk(cornerTex, 0xfff0c0, 0.9);
      this._rectStrips = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(plane, stripMat);
        m.renderOrder = 3;
        if (i >= 2) m.rotation.y = Math.PI / 2; // strips 2/3 run along local Z
        rect.add(m); this._rectStrips.push(m);
      }
      this._rectCorners = [];
      for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(plane, cornerMat); c.renderOrder = 4; rect.add(c); this._rectCorners.push(c); }
      this._rectMat = stripMat; this._rectCornerMat = cornerMat;
      rect.visible = false; rect.renderOrder = 3;
      scene.add(rect);
      this._rect = rect;

      // bobbing arrow (shaft + head), own material (never shared)
      const head = new THREE.ConeGeometry(0.15, 0.26, 20).rotateX(Math.PI).translate(0, -0.13, 0);
      const shaft = new THREE.CylinderGeometry(0.055, 0.055, 0.2, 14).translate(0, 0.1, 0);
      const arrowGeo = ADDONS.BufferGeometryUtils.mergeGeometries([head, shaft], false);
      head.dispose(); shaft.dispose();
      const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffd766, emissive: 0xffaa22, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.15, transparent: true, opacity: 1 });
      this._arrow = new THREE.Mesh(arrowGeo, arrowMat);
      this._arrow.name = 'interactArrow';
      this._arrow.visible = false;
      this._arrow.renderOrder = 5;
      scene.add(this._arrow);

      // click-to-move destination marker (ripple + dot)
      const destTex = G.gfx.canvasTexture(128, 128, (ctx, w) => {
        const c = w / 2;
        const g = ctx.createRadialGradient(c, c, c * 0.62, c, c, c);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
      });
      const dotTex = G.gfx.radialTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
      const dest = new THREE.Group(); dest.name = 'moveMarker';
      this._destR1 = new THREE.Mesh(plane, mk(destTex, 0xa8f0c0, 0.9));
      this._destR2 = new THREE.Mesh(plane, mk(destTex, 0xa8f0c0, 0.9));
      this._destDot = new THREE.Mesh(plane, mk(dotTex, 0xd8ffe6, 0.9));
      this._destDot.scale.setScalar(0.42);
      dest.add(this._destR1, this._destR2, this._destDot);
      dest.visible = false;
      scene.add(dest);
      this._destG = dest;
      // fx are never pick targets (other modules may raycast the whole scene)
      const noRay = () => {};
      for (const m of [this._ringA, this._ringB, this._arrow, this._destR1, this._destR2, this._destDot, ...this._rectStrips, ...this._rectCorners]) m.raycast = noRay;
    },

    _bindPrompt() {
      const el = document.getElementById('interact-prompt');
      if (!el) return;
      el.innerHTML = '<kbd class="ip-key">E</kbd><span class="ip-ico emoji" aria-hidden="true"></span><span class="interact-text"></span>';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-live', 'polite');
      if (G.input?.touchUI) el.classList.add('touch');
      el.addEventListener('click', (ev) => { ev.stopPropagation(); this.trigger('prompt'); });
      this._promptEl = el;
      this._promptText = el.querySelector('.interact-text');
      this._promptIco = el.querySelector('.ip-ico');
    },

    _setCurrent(e) {
      if (this.current === e) return;
      this.current = e;
      this._promptKey = '';
      if (!e) {
        if (this._promptEl) this._promptEl.hidden = true;
        this._fx = null;
        if (this._ring) this._ring.visible = false;
        if (this._rect) this._rect.visible = false;
        if (this._arrow) this._arrow.visible = false;
        this._releaseLook();
        return;
      }
      // highlight geometry from the object's bounds (offset kept relative to the live entry position)
      const pos = readPos(e, _p) ? _p : null;
      let ringR = 0.75, offX = 0, offZ = 0, top = 1.6, rect = null;
      if (pos && e.object) {
        try {
          _box.setFromObject(e.object);
          if (!_box.isEmpty()) {
            _box.getSize(_size); _box.getCenter(_ctr);
            const foot = Math.max(_size.x, _size.z);
            ringR = clamp(foot * 0.5 + 0.35, 0.6, RING_MAX);
            offX = _ctr.x - pos.x; offZ = _ctr.z - pos.z;
            if (Math.hypot(offX, offZ) > 3) { offX = 0; offZ = 0; }
            top = clamp(_box.max.y - pos.y, 0.3, 6);
            // large footprints (8 m farm beds...) get a snug oriented rectangle instead of a huge ring
            const ud = e.object.userData || {};
            const plot = ud.plot && Number(ud.plot.w) > 0 && Number(ud.plot.d) > 0 ? ud.plot : null;
            if (plot || e.kind === 'plot' || foot > RECT_MIN) {
              let w, d, yaw = 0;
              if (plot) {
                w = Number(plot.w); d = Number(plot.d);
                e.object.getWorldQuaternion(_quat); _eul.setFromQuaternion(_quat, 'YXZ'); yaw = _eul.y;
                e.object.getWorldPosition(_ctr);
                offX = _ctr.x - pos.x; offZ = _ctr.z - pos.z;
              } else { w = _size.x; d = _size.z; }
              rect = { w: clamp(w, 0.6, 30) + 0.6, d: clamp(d, 0.6, 30) + 0.6, yaw, bed: !!plot || e.kind === 'plot' };
            }
          }
        } catch (err) { /* ignore */ }
      } else if (pos) {
        ringR = clamp(e.radius * 0.3, 0.6, 1.6);
        top = 1.2;
      }
      if (e.kind === 'npc') top += 0.35;
      this._fx = { ringR, offX, offZ, top, rect, t: 0 };
      if (rect) this._layoutRect(rect);
    },

    /** size the 4 strips + corner glints of the rectangular outline for a w x d footprint */
    _layoutRect(rc) {
      const S = this._rectStrips, C = this._rectCorners;
      if (!S || !C) return;
      const hw = rc.w / 2, hd = rc.d / 2;
      // strips 0/1 along X (full length incl. corners), 2/3 along Z (between them -> no double blending)
      S[0].position.set(0, 0, -hd); S[0].scale.set(rc.w + RECT_W, 1, RECT_W);
      S[1].position.set(0, 0, hd); S[1].scale.set(rc.w + RECT_W, 1, RECT_W);
      S[2].position.set(-hw, 0.002, 0); S[2].scale.set(Math.max(0.01, rc.d - RECT_W), 1, RECT_W);
      S[3].position.set(hw, 0.002, 0); S[3].scale.set(Math.max(0.01, rc.d - RECT_W), 1, RECT_W);
      const cs = RECT_W * 3.2;
      C[0].position.set(-hw, 0.004, -hd); C[1].position.set(hw, 0.004, -hd); C[2].position.set(-hw, 0.004, hd); C[3].position.set(hw, 0.004, hd);
      for (const c of C) c.scale.set(cs, 1, cs);
    },

    _releaseLook() {
      if (this._lookOwned) {
        const rig = G.sys.player?.rig;
        if (rig && rig._look === this._lookV) rig.setLookTarget(null);
        this._lookOwned = false;
      }
    },

    // ------------------------------------------------------------ per frame
    update(dt, t) {
      const pl = G.sys.player;
      const ready = this._playerReady();
      const allowed = ready && pl.enabled !== false && !G.ui?.isBlocking?.() && (!G.sys.camera || G.sys.camera.mode === 'follow');
      let best = null;
      if (allowed) {
        const pp = pl.position;
        const fx = Math.sin(pl.rotY), fz = Math.cos(pl.rotY);
        const cb = G.sys.camera?.getMoveBasis?.();
        const cfx = cb ? cb.forward.x : fx, cfz = cb ? cb.forward.z : fz;
        let bestScore = Infinity;
        for (const e of entries.values()) {
          if (!isEnabled(e)) continue;
          if (!readPos(e, _q)) continue;
          const dx = _q.x - pp.x, dz = _q.z - pp.z;
          const d2 = dx * dx + dz * dz, r = e.radius;
          if (d2 > r * r) continue;
          if (Math.abs(_q.y - pp.y) > 3.5) continue;
          const d = Math.sqrt(d2);
          let face = 1;
          if (d > 0.6) { const nx = dx / d, nz = dz / d; face = Math.max(fx * nx + fz * nz, (cfx * nx + cfz * nz) * 0.85); }
          let score = d / r + (1 - face) * 0.5 - e.priority * 0.3;
          if (e === this.current) score -= 0.15;
          if (score < bestScore) { bestScore = score; best = e; }
        }
      }
      this._setCurrent(best);
      this._updatePrompt();
      this._updateFx(dt, t);
      this._updateDest(dt, t);
      this._updateHover(dt);
    },

    _updatePrompt() {
      const el = this._promptEl;
      if (!el) return;
      const e = this.current;
      if (!e) { if (!el.hidden) el.hidden = true; return; }
      const text = labelOf(e) || '살펴보기';
      const key = e.id + '|' + text;
      if (key !== this._promptKey) {
        this._promptKey = key;
        this._promptText.textContent = text;
        const ico = KIND_ICON[e.kind] || '✨';
        this._promptIco.textContent = /^\p{Extended_Pictographic}/u.test(text) ? '' : ico;
        el.dataset.kind = e.kind;
        el.title = text;
      }
      if (el.hidden) el.hidden = false;
    },

    _updateFx(dt, t) {
      const e = this.current, fx = this._fx;
      const ring = this._ring, arrow = this._arrow;
      if (!ring) return;
      const seated = e && e.kind === 'bench' && G.sys.player?.sitting;
      const rect = this._rect;
      if (!e || !fx || !e.highlight || seated || !readPos(e, _p)) {
        ring.visible = false; arrow.visible = false;
        if (rect) rect.visible = false;
        this._releaseLook();
        return;
      }
      fx.t += dt;
      const fade = clamp(fx.t / 0.18, 0, 1);
      const cx = _p.x + fx.offX, cz = _p.z + fx.offZ;
      const gy = G.world.heightAt(cx, cz, _p.y + 0.6);
      const pulse = 1 + Math.sin(t * 4.2) * 0.035;
      if (fx.rect && rect) {
        ring.visible = false;
        rect.visible = true;
        // raised beds: a selection frame hovering just above the rim (always visible from the follow camera)
        const ry = fx.rect.bed ? Math.max(gy, _p.y) + 0.12 : gy + 0.045;
        rect.position.set(cx, ry, cz);
        rect.rotation.y = fx.rect.yaw;
        const s = 1 + (pulse - 1) * 0.5;
        rect.scale.set(s * (0.94 + 0.06 * fade), 1, s * (0.94 + 0.06 * fade));
        this._rectMat.opacity = (0.82 + 0.18 * Math.sin(t * 4.2)) * fade;
        this._rectCornerMat.opacity = (0.6 + 0.4 * Math.sin(t * 4.2 + 1.2)) * fade;
      } else {
        if (rect) rect.visible = false;
        ring.visible = true;
        ring.position.set(cx, gy + 0.04, cz);
        ring.scale.setScalar(fx.ringR * 2 * pulse * (0.85 + 0.15 * fade));
        this._ringA.material.opacity = (0.72 + 0.18 * Math.sin(t * 4.2)) * fade;
        this._ringB.material.opacity = 0.7 * fade;
        this._ringB.rotation.y = t * 0.6;
      }
      const reduce = G.settings.reduceMotion;
      arrow.visible = true;
      arrow.position.set(cx, _p.y + fx.top + 0.42 + (reduce ? 0 : Math.sin(t * 3.4) * 0.09), cz);
      arrow.rotation.y = reduce ? 0 : t * 1.6;
      arrow.material.opacity = fade;
      // player glances at the focused object (only if nobody else drives the look target)
      const rig = G.sys.player?.rig;
      if (rig && (!rig._look || rig._look === this._lookV)) {
        this._lookV.set(cx, _p.y + Math.min(fx.top, 1.6) * 0.7, cz);
        if (rig._look !== this._lookV) rig.setLookTarget(this._lookV);
        this._lookOwned = true;
      }
    },

    // ------------------------------------------------------------ interaction
    _do(e, source) {
      const now = performance.now();
      if (now - this._lastTrigger < 250) return false;
      if (!isEnabled(e)) return false;
      this._lastTrigger = now;
      const pl = G.sys.player;
      if (pl && readPos(e, _p)) {
        pl.faceTowards?.(_p.x, _p.z);
        if (GESTURE_KINDS.has(e.kind) && !pl.sitting && pl.rig && !pl.rig.currentAction) pl.playAction?.('interact');
      }
      try { e.onInteract?.(); } catch (err) { G.log.error('UI', `interact ${e.id} failed`, err); }
      G.bus.emit('interact', { kind: e.kind, id: e.id });
      G.log.debug('UI', 'interact', e.kind, e.id, source);
      return true;
    },

    /** walk to an entry if needed, then interact */
    _approach(e, walk = true) {
      const pl = G.sys.player;
      if (!pl || !readPos(e, _p) || !isEnabled(e)) return false;
      const d = Math.hypot(_p.x - pl.position.x, _p.z - pl.position.z);
      if (d <= e.radius * 1.6 || !walk) {
        if (d > e.radius * 1.6) return false;
        return this._do(e, 'click');
      }
      const id = e.id;
      pl.walkTo({ x: _p.x, z: _p.z }, {
        stopDistance: clamp(e.radius * 0.55, 0.9, 2.2),
        onArrive: () => {
          const en = entries.get(id);
          if (!en || !readPos(en, _q)) return;
          const dd = Math.hypot(_q.x - pl.position.x, _q.z - pl.position.z);
          if (dd <= en.radius * 1.3) this._do(en, 'click');
        },
      });
      this._showDest(_p.x, _p.z, true);
      return true;
    },

    _buildPickList() {
      const ground = G.world.groundMeshes || [], blockers = G.world.cameraBlockers || [];
      const key = `${entries.size}|${objToEntry.size}|${ground.length}|${blockers.length}`;
      if (key === pickKey) return pickList;
      pickKey = key;
      pickList = [];
      this._entryObjs = [];
      for (const o of objToEntry.keys()) { pickList.push(o); this._entryObjs.push(o); }
      this._groundSet = new Set(ground);
      for (const o of ground) pickList.push(o);
      for (const o of blockers) if (!objToEntry.has(o)) pickList.push(o);
      return pickList;
    },
    /** ray-march the walkable heightfield (terrain + platforms) under a screen point; fallback when no ground mesh is hit */
    _marchGround(x, y) {
      const E = G.sys.engine, cam = E?.camera;
      if (!cam) return null;
      const rc = this._rc || (this._rc = new THREE.Raycaster());
      this._ndc = this._ndc || new THREE.Vector2();
      this._ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      rc.setFromCamera(this._ndc, cam);
      const o = rc.ray.origin, d = rc.ray.direction;
      const W = G.world;
      let prev = 0;
      for (let t = 0.5; t <= 160; t += t < 20 ? 0.25 : 0.75) {
        const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
        if (py <= W.surfaceHeight(px, pz)) {
          let a = prev, b = t;
          for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (o.y + d.y * m <= W.surfaceHeight(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
          const tx = o.x + d.x * b, tz = o.z + d.z * b;
          return { ground: true, point: _q.set(tx, W.surfaceHeight(tx, tz), tz) };
        }
        prev = t;
      }
      return null;
    },
    _entryOf(obj) {
      let o = obj, depth = 0;
      while (o && depth < 14) { const e = objToEntry.get(o); if (e) return e; o = o.parent; depth++; }
      return null;
    },
    _isGround(obj) {
      let o = obj, depth = 0;
      while (o && depth < 6) { if (this._groundSet?.has(o)) return true; o = o.parent; depth++; }
      return false;
    },
    _pick(x, y, entriesOnly = false) {
      const E = G.sys.engine;
      const all = this._buildPickList();
      const list = entriesOnly ? this._entryObjs : all;
      if (!E) return null;
      let hits = [];
      if (list && list.length) { try { hits = E.raycastScreen(x, y, list, true); } catch (err) { hits = []; } }
      for (const h of hits) {
        if (!h.object.visible) continue;
        if (h.object.name === 'interactArrow' || h.object.parent === this._ring || h.object.parent === this._rect || h.object.parent === this._destG) continue;
        const e = this._entryOf(h.object);
        if (e) return { entry: e, point: h.point };
        if (entriesOnly) continue;
        if (this._isGround(h.object)) return { ground: true, point: h.point };
        return { blocker: true, point: h.point };
      }
      return entriesOnly ? null : this._marchGround(x, y);
    },

    _onClick(ev) {
      if (!ev || (ev.button !== 0 && !ev.touch)) return;
      if (!this._playerReady() || G.ui?.isBlocking?.()) return;
      const pl = G.sys.player;
      if (pl.enabled === false || (G.sys.camera && G.sys.camera.mode !== 'follow')) return;
      const hit = this._pick(ev.x, ev.y);
      if (!hit) return;
      if (hit.entry) {
        if (isEnabled(hit.entry)) this._approach(hit.entry, true);
        return;
      }
      if (hit.ground && G.settings.clickToMove !== false) {
        const p = hit.point;
        if (G.world.isWater(p.x, p.z)) { G.ui?.toast?.('물속으로는 들어갈 수 없어요.', { type: 'info', duration: 1600, sound: false }); return; }
        const b = G.world.bounds;
        if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) return;
        if (Math.hypot(p.x - pl.position.x, p.z - pl.position.z) < 0.4) return;
        pl.walkTo({ x: p.x, z: p.z }, { stopDistance: 0.3 });
        this._showDest(p.x, p.z, false);
      }
    },

    _showDest(x, z, forEntry) {
      if (!this._destG) return;
      this._dest = { x, z, t: 0, forEntry, id: G.sys.player?._walkSeq };
      const y = G.world.heightAt(x, z, (G.sys.player?.position.y ?? 0) + 0.7);
      this._destG.position.set(x, y + 0.035, z);
      this._destG.visible = !forEntry;
    },
    _hideDest() { this._dest = null; if (this._destG) this._destG.visible = false; },
    _updateDest(dt, t) {
      const d = this._dest;
      if (!d) return;
      const pl = G.sys.player;
      if (!pl || !pl.isWalking || pl._walkSeq !== d.id) { this._hideDest(); return; }
      if (d.forEntry) return;
      d.t += dt;
      const ph1 = (d.t * 0.9) % 1, ph2 = (d.t * 0.9 + 0.5) % 1;
      this._destR1.scale.setScalar(0.35 + ph1 * 1.1); this._destR1.material.opacity = 0.9 * (1 - ph1);
      this._destR2.scale.setScalar(0.35 + ph2 * 1.1); this._destR2.material.opacity = 0.9 * (1 - ph2);
      this._destDot.material.opacity = 0.75 + 0.2 * Math.sin(t * 6);
    },

    _setCursor(c) {
      const el = G.sys.engine?.renderer?.domElement;
      if (el && el.style.cursor !== c) el.style.cursor = c;
    },
    _updateHover(dt) {
      if (!this._hoverXY) return;
      this._hoverT -= dt;
      if (this._hoverT > 0 || !this._hoverDirty) return;
      this._hoverT = 0.15;
      this._hoverDirty = false;
      if (G.input?.pointerDown || !this._playerReady() || G.ui?.isBlocking?.() || (G.sys.camera && G.sys.camera.mode !== 'follow')) { this.hovered = null; this._setCursor(''); return; }
      const hit = this._pick(this._hoverXY.x, this._hoverXY.y, true);
      const e = hit && hit.entry && isEnabled(hit.entry) ? hit.entry : null;
      this.hovered = e;
      this._setCursor(e ? 'pointer' : '');
    },
  };

  G.interact = interact;
  G.register(interact);
})();
