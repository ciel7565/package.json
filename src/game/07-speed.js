// =============================================================================
// 07-speed.js — progression / movement speed tiers (G.sys.speed), CONTRACT §14.1
//
//   tier             1 | 2 | 3 | 4 — read-only. Since phase 9 (CONTRACT §17.2) it is the tier of the account's
//                    ENTITLEMENT (G.sys.entitle, the server's `ent`): a 토스 plan's tier, or — for an administrator —
//                    the top tier on sale without paying. Without that module (or with a server that sends no `ent`)
//                    it mirrors G.state.sub.tier as before. Local mode is always 1.
//   progression()    -> ent.speed.grow (default = tier)   crop growth and fermentation progress, offline catch-up included
//   movement()       -> ent.speed.move (default = min(tier, 3))   the player's WALK / RUN multiplier (tier 4 moves 3×,
//                    grows 4×); 21-player reads it every frame, the camera (22), 옹이 (65) and the social anim
//                    thresholds (60) follow it. Both numbers are operator settings on the server (sub.move_N / sub.grow_N),
//                    and the server judges saves with the same two numbers.
//   setFromServer(sub) validates + stores {tier, status, expiresAt, autoRenew, source:'server'} in G.state.sub and emits
//                    speed:changed {tier, prev} when the effective tier changed; G.bus 'sub:changed' calls it too
//   label(tier?)     '⚡2×' … ('' at tier 1);  labelKo(tier?)  '⚡ 2배 빨라요'   (the #hud-speed chip, sub-ui)
//   devTier(n)       a temporary tier for measurements — only while the developer center is open (or ?debug=1) and never
//                    in 쉬운 모드; never saved; logs "[speed] dev tier"; devTier(0) turns it off
//   events           speed:changed {tier, prev}  (prev = null right after a profile loaded; also sent when only a
//                    multiplier changed — then tier === prev)
// Nothing protective ever scales with the tier: healthy-play timers, the parent-gate cool-down, chat rate limits, rest
// reminders and jar hygiene decay read wall-clock seconds and never consult this module.
// =============================================================================
(function () {
  const clampTier = (t) => { const n = Math.floor(Number(t)); return n >= 1 && n <= 4 ? n : 1; };
  const LABEL = { 1: '', 2: '⚡2×', 3: '⚡⚡3×', 4: '⚡⚡⚡4×' };
  const LABEL_KO = { 1: '', 2: '⚡ 2배 빨라요', 3: '⚡ 3배 빨라요', 4: '⚡ 4배 빨라요' };
  const serverMode = () => G.net?.mode === 'server';
  const clampMove = (m, d) => { const n = Math.floor(Number(m)); return n >= 1 && n <= 3 ? n : d; };

  const speed = {
    name: 'speed', order: 12, label: '속도 단계',
    _dev: 0,            // dev-center override (never saved)
    _last: 1,           // the tier announced last (speed:changed is emitted on change only)
    _pendingSub: null,  // a server answer that arrived before the state existed
    _entC: undefined,   // [entitle] {tier, move, grow} of the entitlement, null without one (undefined = ask again)
    _lastSig: '1/1/1',

    /** [entitle] the account's entitlement as three numbers (CONTRACT §17.2); cached until entitle:changed */
    _ent() {
      if (this._entC !== undefined) return this._entC;
      let c = null;
      try {
        const E = G.sys.entitle;
        const e = E && !E._failed && typeof E.get === 'function' ? E.get() : null;
        if (e && e.speed) { const t = clampTier(e.tier); c = { tier: t, move: clampMove(e.speed.move, Math.min(t, 3)), grow: clampTier(e.speed.grow) }; }
      } catch (x) { c = null; }
      this._entC = c;
      return c;
    },
    /** the effective tier (1..4) */
    get tier() {
      if (this._dev) return this._dev;
      if (!serverMode() || !G.state) return 1;
      const e = this._ent();
      return e ? e.tier : clampTier(G.state.sub?.tier);
    },
    /** growth / fermentation multiplier */
    progression() {
      if (this._dev || !serverMode() || !G.state) return this.tier;
      const e = this._ent();
      return e ? e.grow : this.tier;
    },
    /** movement multiplier (tier 4 still moves 3×: collision, camera and 옹이 are tuned up to RUN 36 m/s) */
    movement() {
      if (this._dev || !serverMode() || !G.state) return Math.min(this.tier, 3);
      const e = this._ent();
      return e ? e.move : Math.min(this.tier, 3);
    },
    label(t) { return LABEL[clampTier(t == null ? this.tier : t)] || ''; },
    labelKo(t) { return LABEL_KO[clampTier(t == null ? this.tier : t)] || ''; },

    /** the server told us the subscription: validate, store, announce */
    setFromServer(sub) {
      const clean = G.save?.sanitizeSub ? G.save.sanitizeSub(sub, 'server') : { tier: clampTier(sub && sub.tier), status: 'none', expiresAt: 0, autoRenew: false, source: 'server' };
      if (!G.state) { this._pendingSub = clean; return clean; }
      G.state.sub = clean;
      this._announce();
      return clean;
    },
    /** dev center only: pretend tier n (0 = off). Refused in easy mode and when the center is closed. */
    devTier(n) {
      if (G.easy?.on) { G.log.warn('SPEED', '[speed] dev tier refused: 쉬운 모드'); return this.tier; }
      if (!G.sys.devcenter?.isOpen?.() && !G.flags?.debug) { G.log.warn('SPEED', '[speed] dev tier refused: open the developer center first'); return this.tier; }
      const t = n ? clampTier(n) : 0;
      this._dev = t;
      G.log.info('SPEED', `[speed] dev tier ${t || 'off'}`);
      this._announce();
      return this.tier;
    },
    _announce(force) {
      this._entC = undefined; // [entitle] read the entitlement afresh
      const t = this.tier, prev = this._last;
      const sig = `${t}/${this.movement()}/${this.progression()}`;
      if (sig === this._lastSig && !force) return;
      this._last = t;
      this._lastSig = sig;
      G.bus.emit('speed:changed', { tier: t, prev: force ? null : prev });
      if (!force) G.log.info('SPEED', `tier ${prev} -> ${t} (movement ×${this.movement()}, progression ×${this.progression()})`);
    },

    init() {
      G.bus.on('sub:changed', (p) => this.setFromServer(p && p.sub && typeof p.sub === 'object' ? p.sub : p));
      G.bus.on('game:logout', () => { this._dev = 0; this._pendingSub = null; this._last = 1; this._lastSig = '1/1/1'; this._entC = undefined; });
      G.bus.on('entitle:changed', () => this._announce()); // [entitle] a plan, an administrator, an operator's new multiplier
    },
    onStateLoaded(state) {
      if (serverMode()) {
        // the server's current subscription (player/get.php, or an answer that came in before the state) wins over the
        // stored copy's own `sub` — a save never carries a stale tier back into the app
        const srv = G.save?.ServerAdapter?.sub || this._pendingSub;
        if (srv) state.sub = G.save.sanitizeSub(srv, 'server');
      } else if (G.save?.sanitizeSub) state.sub = G.save.sanitizeSub(null, 'local');
      this._pendingSub = null;
      this._announce(true);
    },
  };
  G.register(speed);
})();
