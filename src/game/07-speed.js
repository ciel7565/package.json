// =============================================================================
// 07-speed.js — progression / movement speed tiers (G.sys.speed), CONTRACT §14.1
//
//   tier             1 | 2 | 3 | 4 — read-only mirror of G.state.sub.tier. Local mode is always 1 (nothing can be
//                    bought without a server); server mode shows whatever auth/me.php, auth/login.php, player/get.php
//                    and player/save.php report under `sub` (server-authoritative, §14.6).
//   progression()    -> tier         crop growth and fermentation progress, offline catch-up included
//   movement()       -> min(tier, 3) the player's WALK / RUN multiplier (tier 4 moves 3×, grows 4×); 21-player reads it
//                    every frame, the camera (22), 옹이 (65) and the social anim thresholds (60) follow it
//   setFromServer(sub) validates + stores {tier, status, expiresAt, autoRenew, source:'server'} in G.state.sub and emits
//                    speed:changed {tier, prev} when the effective tier changed; G.bus 'sub:changed' calls it too
//   label(tier?)     '⚡2×' … ('' at tier 1);  labelKo(tier?)  '⚡ 2배 빨라요'   (the #hud-speed chip, sub-ui)
//   devTier(n)       a temporary tier for measurements — only while the developer center is open (or ?debug=1) and never
//                    in 쉬운 모드; never saved; logs "[speed] dev tier"; devTier(0) turns it off
//   events           speed:changed {tier, prev}  (prev = null right after a profile loaded)
// Nothing protective ever scales with the tier: healthy-play timers, the parent-gate cool-down, chat rate limits, rest
// reminders and jar hygiene decay read wall-clock seconds and never consult this module.
// =============================================================================
(function () {
  const clampTier = (t) => { const n = Math.floor(Number(t)); return n >= 1 && n <= 4 ? n : 1; };
  const LABEL = { 1: '', 2: '⚡2×', 3: '⚡⚡3×', 4: '⚡⚡⚡4×' };
  const LABEL_KO = { 1: '', 2: '⚡ 2배 빨라요', 3: '⚡ 3배 빨라요', 4: '⚡ 4배 빨라요' };
  const serverMode = () => G.net?.mode === 'server';

  const speed = {
    name: 'speed', order: 12, label: '속도 단계',
    _dev: 0,            // dev-center override (never saved)
    _last: 1,           // the tier announced last (speed:changed is emitted on change only)
    _pendingSub: null,  // a server answer that arrived before the state existed

    /** the effective tier (1..4) */
    get tier() {
      if (this._dev) return this._dev;
      if (!serverMode() || !G.state) return 1;
      return clampTier(G.state.sub?.tier);
    },
    /** growth / fermentation multiplier */
    progression() { return this.tier; },
    /** movement multiplier (tier 4 still moves 3×: collision, camera and 옹이 are tuned up to RUN 36 m/s) */
    movement() { return Math.min(this.tier, 3); },
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
      const t = this.tier, prev = this._last;
      if (t === prev && !force) return;
      this._last = t;
      G.bus.emit('speed:changed', { tier: t, prev: force ? null : prev });
      if (!force) G.log.info('SPEED', `tier ${prev} -> ${t} (movement ×${this.movement()}, progression ×${this.progression()})`);
    },

    init() {
      G.bus.on('sub:changed', (p) => this.setFromServer(p && p.sub && typeof p.sub === 'object' ? p.sub : p));
      G.bus.on('game:logout', () => { this._dev = 0; this._pendingSub = null; this._last = 1; });
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
