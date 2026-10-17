// =============================================================================
// 23-interaction.js — interactable registry, focus highlight, E / click interaction (G.interact)
//
//   G.interact.register({id, kind, label: string|()=>string, position: Vector3|()=>Vector3, object?: Object3D,
//                        radius=2.6, priority=0, enabled?: ()=>bool, onInteract: ()=>void, highlight=true})
//      -> {id, unregister(), setEnabled(b)}
//   G.interact.unregister(id), get(id), list(kind?), current, hovered, hint, trigger(), activate(id) (walks there first),
//   setObject(id, obj) (attach a mesh built after registration), showDest(x, z, forEntry) / hideDest()
//   hover glow (CONTRACT §13.4): the mouse-hovered entry and the focused one get G.sys.engine.setOutline (rebuilt
//   only when the pair changes); without it a soft additive halo pulses behind the object (≤ 1 Hz, steady with
//   reduceMotion). Entries with highlight:false and farm beds (their own frame) are skipped.
//   optional entry fields for 쉬운 모드 (CONTRACT §12): kidLabel: string|()=>string (short kid words, no emoji),
//   emoji: string|()=>string (the picture in the big round prompt; default = label's leading emoji / kind icon),
//   handOffset: m above the object's top for the 👆 (default 0.55; raise it above world labels such as plot tags)
//               — a number, or a cheap function returning one (read every frame for the pointed-at entry only)
// Each frame the best candidate (distance + player facing / camera forward + priority) gets the
// #interact-prompt and a soft gold ground ring + bobbing arrow. E / d-pad centre / mobile E trigger it,
// then 'interact' {kind, id} is emitted. Clicking a registered object interacts (or walks there first);
// clicking the ground walks there with a destination marker when G.settings.clickToMove is on.
// 쉬운 모드: radius ×1.3, a big gold "picture + words + 👆 눌러요!" prompt (tappable everywhere, read aloud after a
// short pause, long-press reads it), a bouncing 👆 above the focused object (replaces the 3D arrow) and a softer
// 👆 "hint" over the nearest thing within 11 m when nothing is in reach yet (tap it → walk there and use it).
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const KIND_ICON = {
    npc: '💬', jar: '🏺', plot: '🌱', sign: '🪧', kiosk: '🖥️', exhibit: '🍲', tool: '🧺', jardisp: '🏺', craft: '🛠️',
    shop: '🛒', door: '🚪', board: '📋', photo: '📷', bench: '🪑', companion: '🏺', decor: '🏡',
  };
  // kinds where the player does a small "reach / look" gesture on interaction
  const GESTURE_KINDS = new Set(['sign', 'kiosk', 'exhibit', 'tool', 'jardisp', 'board', 'door', 'craft', 'shop', 'jar']);
  // 쉬운 모드
  const EASY_RADIUS = 1.3;          // interaction radius multiplier (CONTRACT §12: +30 %)
  const HINT_R2 = 11 * 11;          // the "look here" hand appears over the nearest thing within 11 m
  const HINT_SKIP = new Set(['companion', 'bench', 'decor']); // things that are always around: no hint hand
  const SAY_DWELL = 1.1;            // s on the same target before its words are read aloud
  const SAY_AGAIN = 25000;          // ms before the same target is read again
  const easyOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const RX_LEAD_EMOJI = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\uFE0F)|[\u{1F3FB}-\u{1F3FF}])*)\s*/u;

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
  function valOf(v) {
    try { const r = typeof v === 'function' ? v() : v; return r == null ? '' : String(r); } catch (err) { return ''; }
  }
  /** short kid words for the prompt: entry.kidLabel, else the label without " · detail" and leading emoji */
  function kidLabelOf(e) {
    let t = e.kidLabel != null ? valOf(e.kidLabel) : '';
    if (!t) {
      t = labelOf(e);
      const cut = t.indexOf(' · ');
      if (cut > 0) t = t.slice(0, cut);
    }
    t = t.replace(RX_LEAD_EMOJI, '').trim();
    return (t || '살펴보기').slice(0, 18);
  }
  /** the picture in the big round prompt */
  function emojiOf(e) {
    const own = e.emoji != null ? valOf(e.emoji).trim() : '';
    if (own) return own.slice(0, 16);
    const m = RX_LEAD_EMOJI.exec(labelOf(e));
    return m ? m[1] : (KIND_ICON[e.kind] || '✨');
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
    hint: null,             // 쉬운 모드: nearest interactable that is not in reach yet (gets the soft 👆)
    _hintFx: null,          // {id, offX, offZ, top} measured once per hint target
    _sayFor: null, _sayT: 0, _said: new Map(),

    // ------------------------------------------------------------ registry
    register(opts) {
      if (!opts || !opts.id) { G.log.warn('UI', 'interact.register: id is required'); return null; }
      if (entries.has(opts.id)) this.unregister(opts.id);
      const e = {
        id: opts.id, kind: opts.kind || 'object', label: opts.label ?? '살펴보기', position: opts.position || null,
        object: opts.object || null, radius: opts.radius ?? 2.6, priority: opts.priority || 0, enabled: opts.enabled || null,
        onInteract: opts.onInteract || null, highlight: opts.highlight !== false, disabled: false,
        kidLabel: opts.kidLabel ?? null, emoji: opts.emoji ?? null,
        handOffset: Number.isFinite(opts.handOffset) || typeof opts.handOffset === 'function' ? opts.handOffset : 0.55,
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
      if (this.hint === e) { this.hint = null; this._hintFx = null; }
    },
    get(id) { return entries.get(id) || null; },
    /** effective interaction radius of an entry (×1.3 in 쉬운 모드) */
    radiusOf(e) { return (e?.radius || 0) * (easyOn() ? EASY_RADIUS : 1); },
    /** the words / picture the prompt shows for an entry ({text, emoji, kid}) */
    promptOf(e) {
      if (!e) return null;
      const kid = easyOn();
      return { text: kid ? kidLabelOf(e) : (labelOf(e) || '살펴보기'), emoji: kid ? emojiOf(e) : (KIND_ICON[e.kind] || '✨'), kid };
    },
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
    /** ground destination marker (ripple) at x,z; forEntry = walking to an interactable (marker hidden) */
    showDest(x, z, forEntry = false) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
      this._showDest(x, z, !!forEntry);
      return true;
    },
    hideDest() { this._hideDest(); },

    // ------------------------------------------------------------ lifecycle
    init() {
      this._buildFx();
      this._bindPrompt();
      this._buildHand();
      G.bus.on('input:interact', () => {
        if (G.ui?.isBlocking?.() || !this._playerReady()) return;
        this.trigger('input');
      });
      G.bus.on('input:click', (ev) => this._onClick(ev));
      // switching 쉬운 모드 at runtime: re-render the prompt in the other style right away
      G.bus.on('easy:changed', () => { this._promptKey = ''; this._sayFor = null; this._setHint(null); });
      const cont = document.getElementById('game-container');
      if (cont && !G.input?.touchUI) {
        const hxy = { x: 0, y: 0 };
        cont.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') { hxy.x = ev.clientX; hxy.y = ev.clientY; this._hoverXY = hxy; this._hoverDirty = true; } });
        cont.addEventListener('pointerleave', () => { this._hoverXY = null; this._setCursor(''); });
      }
    },

    onLogout() {
      this._setCurrent(null);
      this._setHint(null);
      this._hideDest();
      this._setCursor('');
      this.hovered = null;
      this._updateGlow(0, 0, false);
      this._said.clear();
      this._sayFor = null;
      if (this._hand) this._hand.setVisible(false);
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
      // static markup only; the target's words go in through textContent (_updatePrompt)
      el.innerHTML = '<kbd class="ip-key">E</kbd><span class="ip-ico emoji" aria-hidden="true"></span><span class="interact-text"></span>'
        + '<span class="ip-tap" aria-hidden="true"><span class="ip-tap-hand emoji">👆</span><span class="ip-tap-lbl">눌러요!</span></span>';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-live', 'polite');
      el.tabIndex = -1;
      if (G.input?.touchUI) el.classList.add('touch');
      el.addEventListener('click', (ev) => { ev.stopPropagation(); this.trigger('prompt'); });
      this._promptEl = el;
      this._promptText = el.querySelector('.interact-text');
      this._promptIco = el.querySelector('.ip-ico');
    },

    /** 쉬운 모드: one bouncing 👆 world label (above the focused thing, or a soft hint over the nearest one) */
    _buildHand() {
      if (!G.ui?.label) return;
      const el = G.ui.h('div', { class: 'ix-hand', 'aria-hidden': 'true' }, G.ui.h('span', { class: 'ixh-glyph emoji' }, '👆'));
      this._handPos = new THREE.Vector3();
      this._handMode = '';
      this._hand = G.ui.label({
        el, target: this._handPos, maxDist: 46, fadeDist: 6,
        onClick: (ev) => {
          ev.stopPropagation();
          if (G.ui.isBlocking() || !this._playerReady()) return;
          if (this.current) this.trigger('hand');
          else if (this.hint) this._approach(this.hint, true);
        },
      });
      this._hand.setVisible(false);
    },
    _setHint(e) {
      if (this.hint === e) return;
      this.hint = e || null;
      this._hintFx = e ? this._measure(e) : null;
    },
    /** highlight offset / top of an entry relative to its position (bounds measured once) */
    _measure(e) {
      const out = { offX: 0, offZ: 0, top: 1.4 };
      const pos = readPos(e, _p) ? _p : null;
      if (!pos) return out;
      if (e.object) {
        try {
          _box.setFromObject(e.object);
          if (!_box.isEmpty()) {
            _box.getCenter(_ctr);
            out.offX = _ctr.x - pos.x; out.offZ = _ctr.z - pos.z;
            if (Math.hypot(out.offX, out.offZ) > 3) { out.offX = 0; out.offZ = 0; }
            out.top = clamp(_box.max.y - pos.y, 0.3, 6);
          }
        } catch (err) { /* keep defaults */ }
      } else out.top = 1.2;
      if (e.kind === 'npc') out.top += 0.35;
      return out;
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
      const kid = easyOn();
      const rk = kid ? EASY_RADIUS : 1;
      let best = null, hint = null;
      // 쉬운 모드: the thing the "다음 할 일" card talks about wins over a nearer sign / bed (card and prompt agree)
      this._goalT = (this._goalT || 0) - (dt || 0);
      if (this._goalT <= 0) {
        this._goalT = 0.4;
        let gid = null;
        if (kid) { try { const tg = G.sys.quest?.focus?.()?.target; gid = tg ? (tg.id || tg.npc || null) : null; } catch (e) { gid = null; } }
        this._goalId = gid;
      }
      const goalId = kid ? this._goalId : null;
      if (allowed) {
        const pp = pl.position;
        const fx = Math.sin(pl.rotY), fz = Math.cos(pl.rotY);
        const cb = G.sys.camera?.getMoveBasis?.();
        const cfx = cb ? cb.forward.x : fx, cfz = cb ? cb.forward.z : fz;
        let bestScore = Infinity, hintD2 = HINT_R2;
        for (const e of entries.values()) {
          if (!isEnabled(e)) continue;
          if (!readPos(e, _q)) continue;
          if (Math.abs(_q.y - pp.y) > 3.5) continue;
          const dx = _q.x - pp.x, dz = _q.z - pp.z;
          const d2 = dx * dx + dz * dz, r = e.radius * rk;
          if (d2 > r * r) {
            // 쉬운 모드: remember the nearest thing just out of reach for the "look here" hand
            if (kid && d2 < hintD2 && !HINT_SKIP.has(e.kind)) { hintD2 = d2; hint = e; }
            continue;
          }
          const d = Math.sqrt(d2);
          let face = 1;
          if (d > 0.6) { const nx = dx / d, nz = dz / d; face = Math.max(fx * nx + fz * nz, (cfx * nx + cfz * nz) * 0.85); }
          let score = d / r + (1 - face) * 0.5 - e.priority * 0.3;
          if (e === this.current) score -= 0.15;
          if (goalId && e.id === goalId) score -= 0.6;
          if (score < bestScore) { bestScore = score; best = e; }
        }
      }
      this._setCurrent(best);
      this._setHint(best ? null : hint);
      this._updatePrompt();
      this._updateFx(dt, t);
      this._updateHand(t, kid);
      this._updateSay(dt, kid);
      this._updateDest(dt, t);
      this._updateHover(dt);
      this._updateGlow(dt, t, allowed);
    },

    /**
     * hover glow (CONTRACT §13.4): the mouse-hovered interactable and the focused one get the engine's soft rim
     * outline (G.sys.engine.setOutline — only re-built when the pair changes); without it a soft additive halo
     * pulses behind the object instead (≤ 1 Hz, steady with reduceMotion). Big farm beds keep their frame only.
     */
    _updateGlow(dt, t, allowed) {
      const hv = allowed && this.hovered && this.hovered.highlight && this.hovered.object && isEnabled(this.hovered) ? this.hovered : null;
      const cur = this.current;
      const cu = allowed && cur && cur !== hv && cur.highlight && cur.object && cur.kind !== 'plot' && !(cur.kind === 'bench' && G.sys.player?.sitting) ? cur : null;
      const key = (hv ? hv.id : '') + '|' + (cu ? cu.id : '');
      const eng = G.sys.engine;
      if (typeof eng?.setOutline === 'function') {
        if (key !== this._glowKey) {
          this._glowKey = key;
          const list = [];
          if (hv) list.push(hv.object);
          if (cu) list.push(cu.object);
          try { eng.setOutline(list.length ? list : null, { color: 0xffd36a, strength: hv ? 1.1 : 0.85 }); } catch (err) { G.log.warn('UI', 'outline failed', err); }
        }
        return;
      }
      // fallback: a soft halo sprite behind the hovered / focused object
      const e = hv || cu;
      const H = this._halo ?? (this._halo = this._buildHalo() || false);   // false: failed once, never retried per frame
      if (!H) return;
      if (!e || !readPos(e, _p)) { if (H.sprite.visible) H.sprite.visible = false; this._haloFor = null; return; }
      if (this._haloFor !== e) {
        this._haloFor = e;
        H.m = this._measure(e);
        H.t = 0;
      }
      H.t += dt;
      const m = H.m;
      const reduce = !!G.settings.reduceMotion;
      H.sprite.position.set(_p.x + m.offX, _p.y + m.top * 0.55, _p.z + m.offZ);
      H.sprite.scale.setScalar(clamp(m.top * 1.6, 1.2, 5));
      H.mat.opacity = clamp(H.t / 0.2, 0, 1) * (reduce ? 0.32 : 0.26 + 0.1 * Math.sin(t * Math.PI * 1.6));
      H.sprite.visible = true;
    },
    _buildHalo() {
      try {
        const tex = G.gfx.radialTexture(128, 'rgba(255,226,140,0.85)', 'rgba(255,200,80,0)');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        const sprite = new THREE.Sprite(mat);
        sprite.name = 'interactHalo'; sprite.visible = false; sprite.renderOrder = 2; sprite.raycast = () => {};
        G.sys.engine.scene.add(sprite);
        return { sprite, mat, t: 0, m: null };
      } catch (err) { return null; }
    },

    _updatePrompt() {
      const el = this._promptEl;
      if (!el) return;
      const e = this.current;
      if (!e) { if (!el.hidden) el.hidden = true; return; }
      const kid = easyOn();
      // cheap per-frame key (labels are short strings); DOM is touched only when something changed
      const raw = labelOf(e);
      const key = (kid ? 'k|' : 'n|') + e.id + '|' + raw + (kid ? '|' + valOf(e.kidLabel) + '|' + valOf(e.emoji) : '');
      if (key !== this._promptKey) {
        this._promptKey = key;
        if (kid) {
          const text = kidLabelOf(e);
          this._promptText.textContent = text;
          this._promptIco.textContent = emojiOf(e);
          el.title = text;
          el.dataset.say = `${text}. 눌러 봐요!`;
          this._kidText = text;
        } else {
          const text = raw || '살펴보기';
          this._promptText.textContent = text;
          this._promptIco.textContent = /^\p{Extended_Pictographic}/u.test(text) ? '' : (KIND_ICON[e.kind] || '✨');
          el.title = text;
          delete el.dataset.say;
        }
        el.classList.toggle('kid', kid);
        el.dataset.kind = e.kind;
      }
      if (el.hidden) el.hidden = false;
    },

    /** 쉬운 모드: the bouncing 👆 above the focused thing (or the softer hint hand over the nearest one) */
    _updateHand(t, kid) {
      const L = this._hand;
      if (!L) return;
      const e = kid ? (this.current || this.hint) : null;
      const seated = e && e.kind === 'bench' && G.sys.player?.sitting;
      if (!e || seated || !e.highlight || !readPos(e, _p)) {
        if (L.visible) L.setVisible(false);
        return;
      }
      const m = e === this.current ? this._fx : this._hintFx;
      if (!m) { if (L.visible) L.setVisible(false); return; }
      const reduce = !!G.settings.reduceMotion;
      // world-space bob (≤ 1 Hz); the DOM label follows the projected point every frame (04-ui updateLabels)
      let ho = e.handOffset;
      if (typeof ho === 'function') { try { ho = Number(ho()); } catch (err) { ho = NaN; } if (!Number.isFinite(ho)) ho = 0.55; }
      this._handPos.set(_p.x + m.offX, _p.y + m.top + ho + (reduce ? 0 : Math.abs(Math.sin(t * 2.6)) * 0.16), _p.z + m.offZ);
      const mode = e === this.current ? 'on' : 'hint';
      if (mode !== this._handMode) { this._handMode = mode; L.el.classList.toggle('hint', mode === 'hint'); }
      if (!L.visible) L.setVisible(true);
    },

    /** 쉬운 모드: read the focused target's words once the child stops next to it for a moment */
    _updateSay(dt, kid) {
      const e = this.current;
      if (!kid || !e) { this._sayFor = null; return; }
      if (e !== this._sayFor) { this._sayFor = e; this._sayT = 0; return; }
      if (this._sayT < 0) return;
      this._sayT += dt;
      if (this._sayT < SAY_DWELL) return;
      this._sayT = -1; // once per focus
      const now = performance.now();
      if (now - (this._said.get(e.id) || -1e9) < SAY_AGAIN) return;
      if (G.easy?.speaking || G.sys.dialogue?.active) return;
      this._said.set(e.id, now);
      if (this._said.size > 80) this._said.clear();
      try { G.easy?.say?.(`${this._kidText || kidLabelOf(e)}. 눌러 봐요!`, { interrupt: false }); } catch (err) { /* voice optional */ }
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
      // 쉬운 모드 shows the bouncing 👆 label instead of the 3D arrow (one pointer, not two)
      arrow.visible = !easyOn() || !this._hand;
      if (arrow.visible) {
        arrow.position.set(cx, _p.y + fx.top + 0.42 + (reduce ? 0 : Math.sin(t * 3.4) * 0.09), cz);
        arrow.rotation.y = reduce ? 0 : t * 1.6;
        arrow.material.opacity = fade;
      }
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
      const R = this.radiusOf(e);
      if (d <= R * 1.6 || !walk) {
        if (d > R * 1.6) return false;
        return this._do(e, 'click');
      }
      const id = e.id;
      pl.walkTo({ x: _p.x, z: _p.z }, {
        stopDistance: clamp(e.radius * 0.55, 0.9, 2.2),
        onArrive: () => {
          const en = entries.get(id);
          if (!en || !readPos(en, _q)) return;
          const dd = Math.hypot(_q.x - pl.position.x, _q.z - pl.position.z);
          if (dd <= this.radiusOf(en) * 1.3) this._do(en, 'click');
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
