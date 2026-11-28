// =============================================================================
// 12-seasons.js — the real seasons of 정선 (CONTRACT §19.5): G.env (the day of the year, today's weather and
// temperature, the weather of the last weeks) becomes ONE slowly changing state G.season that the world's looks read.
//
//   G.season (the state; read it, never write it)
//     { id 'spring'|'summer'|'autumn'|'winter', name '봄'…, phase 0…1 (how far into that season), doy,
//       leaf 0…1 (leaves on the broadleaf trees), fresh 0…1 (the light new green of spring), autumn 0…1 (colour),
//       brown 0…1 (withered), bare 0…1 (= 1 − leaf), blossom 0…1 (the flowering weeks of spring), grass 1 green … 0 straw,
//       snow 0…1 (snow lying on the ground and the roofs), branch 0…1 (fresh snow on twigs and needles),
//       frost 0…1, ice 0…1 (ice at the river's edge), breath 0…1 (breath shows in the cold), temp °C, tMean (10-day mean),
//       flowers { amount 0…1, colors: ['#rrggbb', …], names: [...] } (wild flowers of the month), source 'real'|'fixed'|'forced' }
//   G.sys.season (system 'season', order 73 — after env 71 and weather 72)
//     core                 the pure rules (no DOM, no THREE): phen(doy), history(ms, modelAt), state(ms, opts) — run in
//                          Node by tests/seasons-logic.mjs
//     mode()               'real' | 'fixed' | 'spring' | 'summer' | 'autumn' | 'winter' (the query ?season= decides;
//                          under automation the fixed test season 'summer' stays unless ?season=real or ?clock=kst)
//     force(mode)          the same at run time (developer centre, tests); 'auto' goes back to the default
//     U                    the shared uniforms every season hook reads (one object each: updating them costs nothing)
//     glsl                 GLSL pieces for the hooks of 12-nature.js / 11-terrain.js (leaf colour and thinning, straw)
//     LEAF                 the phenology table the GLSL is generated from (days of the year)
//     refresh()            recompute the target now (it is recomputed every minute and on weather:changed)
//   Events: season:changed { id, prev } when the season id changes.
//   Snow on everything: one global shader hook (THREE.ShaderChunk emissivemap_*) lays snow on every lit built-in
//   material (standard / physical / lambert / phong — not skinned people) by the WORLD normal, gathered by a noise so
//   that it starts on the flattest surfaces and melts back in patches; one shared uniform tfmSnowU. Off inside rooms.
//   `low` gets the colours only: the snow colour without rime, no thinning (G.sys.nature recolours its plain trees on
//   the CPU), no breath.
//   Query: ?season=spring|summer|autumn|winter|real · ?doy=1…366 (a day of the year) · ?snow=0…1 (snow cover).
// =============================================================================
(function () {
  // ---------------------------------------------------------------- the pure core (also loaded by Node tests)
  const core = (function () {
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // phenology of the 정선 valley floor (~340 m), days of the year (research notes: 산림청 단풍 예측, 기상청 개화)
    const LEAF = {
      outA: 104, outB: 140,          // leaf-out 4/14 → full 5/20
      freshA: 104, freshP: 124, freshB: 165,   // the light new green: rises with leaf-out, deep green by mid June
      colA: 278, colB: 299,          // colour 10/5 → full 10/26
      fallA: 300, fallB: 322,        // leaves fall 10/27 → bare 11/18
      brownA: 296, brownB: 318,      // withering of what is still hanging
      bloomA: 93, bloomP: 106, bloomB: 122,    // blossom weeks (생강나무 · 개나리 · 진달래 · 벚꽃 · 산벚)
      grassUpA: 95, grassUpB: 132,   // straw → green (4/5 → 5/12)
      grassDnA: 272, grassDnB: 308,  // green → straw (9/29 → 11/4)
    };
    // the fixed days for ?season= (what the photographs of those months show)
    const FORCED = { spring: 114, summer: 196, autumn: 298, winter: 20 };
    const NAMES = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
    // wild flowers of the month (colour palette of the meadow; amount 0…1)
    const FLOWERS = [
      { m: 1, amount: 0, colors: [], names: [] },
      { m: 2, amount: 0, colors: [], names: [] },
      { m: 3, amount: 0.15, colors: ['#f2d23a', '#f6e27a'], names: ['생강나무', '산수유'] },
      { m: 4, amount: 0.75, colors: ['#f5d327', '#e45aa6', '#f7d7e4', '#f3e04a', '#ffffff'], names: ['개나리', '진달래', '벚꽃', '민들레', '냉이꽃'] },
      { m: 5, amount: 0.85, colors: ['#e86aa8', '#f4e04a', '#ffffff', '#c9a3e6'], names: ['철쭉', '애기똥풀', '아까시꽃', '제비꽃'] },
      { m: 6, amount: 0.8, colors: ['#f2c21b', '#ffffff', '#f4f0c8', '#d98bd0'], names: ['금계국', '개망초', '찔레꽃', '엉겅퀴'] },
      { m: 7, amount: 0.7, colors: ['#f08a24', '#7fa6e0', '#f7b7c8', '#ffffff'], names: ['원추리', '수국', '연꽃', '개망초'] },
      { m: 8, amount: 0.7, colors: ['#f5c518', '#d77fcf', '#ffffff', '#f08a24'], names: ['해바라기', '무궁화', '참취꽃', '참나리'] },
      { m: 9, amount: 0.85, colors: ['#ffffff', '#f4a6c8', '#c96fb0', '#b8a3e8', '#ffffff'], names: ['메밀꽃', '코스모스', '코스모스', '벌개미취', '구절초'] },
      { m: 10, amount: 0.55, colors: ['#f7f0f0', '#b9a8e0', '#e6d9b8'], names: ['구절초', '쑥부쟁이', '억새'] },
      { m: 11, amount: 0.08, colors: ['#e6d9b8'], names: ['억새'] },
      { m: 12, amount: 0, colors: [], names: [] },
    ];
    /** the curves of one day of the year (no weather): broadleaf trees, blossom, grass */
    function phen(doy, shiftS = 0, shiftA = 0) {
      const dS = doy + shiftS, dA = doy - shiftA;
      const L = LEAF;
      const out = sstep(L.outA, L.outB, dS), fall = sstep(L.fallA, L.fallB, dA);
      const leaf = clamp(out * (1 - fall), 0, 1);
      const fresh = dS < L.freshP ? sstep(L.freshA, L.freshP, dS) : 1 - sstep(L.freshP, L.freshB, dS);
      const autumn = sstep(L.colA, L.colB, dA) * (dA > 200 ? 1 : 0);
      const brown = sstep(L.brownA, L.brownB, dA) * (dA > 200 ? 1 : 0);
      const blossom = dS < L.bloomP ? sstep(L.bloomA, L.bloomP, dS) : 1 - sstep(L.bloomP, L.bloomB, dS);
      const grass = doy < 200 ? sstep(L.grassUpA, L.grassUpB, dS) : 1 - sstep(L.grassDnA, L.grassDnB, dA);
      return { leaf, fresh: clamp(fresh, 0, 1), autumn, brown, blossom: clamp(blossom, 0, 1), grass: clamp(grass, 0, 1) };
    }
    function seasonOf(doy) {
      // meteorological seasons by month-ish day ranges (3–5 spring, 6–8 summer, 9–11 autumn, 12–2 winter)
      if (doy >= 60 && doy < 152) return { id: 'spring', phase: (doy - 60) / 92 };
      if (doy >= 152 && doy < 244) return { id: 'summer', phase: (doy - 152) / 92 };
      if (doy >= 244 && doy < 335) return { id: 'autumn', phase: (doy - 244) / 91 };
      return { id: 'winter', phase: doy >= 335 ? (doy - 335) / 90 : (doy + 30) / 90 };
    }
    const monthOfDoy = (doy) => { const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; let d = doy; for (let m = 0; m < 12; m++) { if (d <= md[m]) return m + 1; d -= md[m]; } return 12; };
    /**
     * the weather of the last weeks, hour by hour, from a weather function (the env model; optionally the real
     * snapshot of now): snow depth (cm, a degree-hour melt), fresh snow on the twigs, the 10-day mean temperature, the
     * cold spell that freezes the river's edge.  wx(ms) → { weather, temp, rain1h }.
     */
    function history(ms, wx, days = 21) {
      const H = 3600000, n = days * 24;
      let depth = 0, branch = 0, iceT = 0, sum10 = 0, cnt10 = 0, lastSnow = -1;
      const t0 = Math.floor(ms / H) * H - n * H;
      for (let i = 0; i <= n; i++) {
        const t = t0 + i * H, w = wx(t);
        const temp = Number.isFinite(w.temp) ? w.temp : 5, p = Number.isFinite(w.rain1h) ? w.rain1h : 0;
        if (w.weather === 'SNOW') { const add = 0.35 + p * 1.0; depth += add; branch = clamp(branch + add * 0.35, 0, 1); lastSnow = i; }
        else if (w.weather === 'RAIN') { depth -= 0.25 + p * 0.5; branch = 0; }
        // melt: degree-hours above freezing, a little sun on clear days, settling
        if (temp > 0) depth -= temp * 0.05;
        if (w.weather === 'CLEAR') depth -= 0.02;
        depth = depth < 0 ? 0 : depth * 0.9985;
        branch -= temp > -1 ? 0.05 + Math.max(0, temp) * 0.03 : 0.004;
        if (w.weather === 'CLEAR') branch -= 0.01;
        branch = branch < 0 ? 0 : branch;
        // ice: hours with a cold mean build it, warm hours take it
        iceT += temp < -2 ? (-2 - temp) * 0.004 : -Math.max(0, temp + 1) * 0.01;
        iceT = clamp(iceT, 0, 1);
        if (i >= n - 240) { sum10 += temp; cnt10++; }
      }
      return { depth, branch, ice: iceT, tMean: cnt10 ? sum10 / cnt10 : 5, hoursSinceSnow: lastSnow < 0 ? 1e9 : n - lastSnow };
    }
    const cover = (depthCm) => clamp(1 - Math.exp(-depthCm / 2.4), 0, 1);
    /** the normal 10-day mean temperature of a month (from the climate normals { max: [], min: [] }) */
    function normalMean(norm, doy) {
      if (!norm || !norm.max) return 5;
      const m = monthOfDoy(doy) - 1, mid = [16, 46, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350];
      const a = mid[m], j = doy >= a ? (m + 1) % 12 : (m + 11) % 12, b = mid[j];
      let span = doy >= a ? b - a : a - b; if (span <= 0) span += 365;
      const f = Math.abs(doy - a) / span;
      const mean = (k) => (norm.max[k] + norm.min[k]) / 2;
      return mean(m) + (mean(j) - mean(m)) * clamp(f, 0, 1);
    }
    /**
     * the whole state of one moment.
     * opts: { doy (KST day of the year), hour, wx(ms) (weather function for the history), now { weather, temp }
     *         (the current weather; default wx(ms)), norm (climate normals), forced (a season id or null),
     *         snow (override 0…1 or null) }
     */
    function state(ms, opts = {}) {
      const doy = opts.forced && FORCED[opts.forced] ? FORCED[opts.forced] : opts.doy;
      const hour = Number.isFinite(opts.hour) ? opts.hour : 12;
      const se = seasonOf(doy);
      let hist = null, shiftS = 0, shiftA = 0, temp, now;
      if (opts.forced) {
        // the photograph days: a typical day of that season (no random weather)
        const T = { spring: 14, summer: 26, autumn: 11, winter: -4 }[opts.forced];
        temp = T; now = { weather: 'CLEAR', temp: T };
        hist = { depth: opts.forced === 'winter' ? 3.2 : 0, branch: opts.forced === 'winter' ? 0.45 : 0, ice: opts.forced === 'winter' ? 0.7 : 0, tMean: T - 2, hoursSinceSnow: 30 };
      } else {
        const wx = opts.wx || (() => ({ weather: 'CLEAR', temp: 10, rain1h: 0 }));
        hist = history(ms, wx, opts.days || 21);
        now = opts.now || wx(ms);
        temp = Number.isFinite(now.temp) ? now.temp : hist.tMean;
        const anom = hist.tMean - normalMean(opts.norm, doy);
        shiftS = clamp(anom * 2.5, -8, 8);      // a warm spring comes earlier
        shiftA = clamp(anom * 2.0, -8, 8);      // a warm autumn colours later
      }
      const p = phen(doy, shiftS, shiftA);
      let snow = cover(hist.depth);
      if (Number.isFinite(opts.snow)) snow = clamp(opts.snow, 0, 1);
      const branch = Number.isFinite(opts.snow) ? clamp(opts.snow * 0.5, 0, 1) : clamp(hist.branch, 0, 1) * (snow > 0.05 ? 1 : 0);
      // frost: clear cold mornings (white rime on grass and roofs until the sun is up)
      const morning = hour < 6 ? 1 : hour < 10.5 ? 1 - (hour - 6) / 4.5 : 0;
      const frost = clamp((1.5 - temp) / 5, 0, 1) * (now.weather === 'CLEAR' || now.weather === 'FOG' ? 1 : 0.4) * Math.max(morning, temp < -4 ? 0.6 : 0) * (1 - snow);
      const breath = clamp((6 - temp) / 8, 0, 1);
      const mo = monthOfDoy(doy), fl = FLOWERS[mo - 1];
      const flowers = { amount: fl.amount * (1 - snow), colors: fl.colors.slice(), names: fl.names.slice() };
      return {
        id: se.id, name: NAMES[se.id], phase: Math.round(se.phase * 1000) / 1000, doy, month: mo,
        leaf: p.leaf, fresh: p.fresh * p.leaf, autumn: p.autumn, brown: p.brown, bare: 1 - p.leaf, blossom: p.blossom * (1 - snow * 0.7),
        grass: p.grass * (1 - snow * 0.5), snow, branch, frost, ice: clamp(hist.ice, 0, 1), breath,
        temp: Math.round(temp * 10) / 10, tMean: Math.round(hist.tMean * 10) / 10, shiftS, shiftA, flowers,
        weather: now.weather || 'CLEAR',
      };
    }
    return { LEAF, FORCED, NAMES, FLOWERS, clamp, sstep, phen, seasonOf, monthOfDoy, history, cover, normalMean, state };
  })();
  if (typeof module === 'object' && module && module.exports) { module.exports = core; return; }
  if (typeof G === 'undefined') return;

  // ---------------------------------------------------------------- shared uniforms (plain objects: shared by reference
  // through three's uniform cloning, so ONE write reaches every program)
  const U = {
    // x: day of the year for the spring curves, y: for the autumn curves, z: blossom 0…1, w: 1 = the season hooks run
    tfmSeasT: { value: { x: 196, y: 196, z: 0, w: 0 } },
    // x: snow cover 0…1 (0 = the snow code is skipped), y: fresh snow on twigs, z: frost, w: wet
    tfmSnowU: { value: { x: 0, y: 0, z: 0, w: 0 } },
    // x: grass green 1 … straw 0, y: leaf 0…1 (mean), z: autumn colour (mean), w: ice 0…1
    tfmSeasG: { value: { x: 1, y: 1, z: 0, w: 0 } },
  };
  const L = core.LEAF;
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  // GLSL: the same curves as core.phen, per tree (dS / dA already carry the tree's own offset in days)
  const GLSL_PHEN = `
uniform vec4 tfmSeasT; uniform vec4 tfmSeasG;
float tfmLeafAmt(float dS, float dA) { return smoothstep(${f1(L.outA)}, ${f1(L.outB)}, dS) * (1.0 - smoothstep(${f1(L.fallA)}, ${f1(L.fallB)}, dA)); }
float tfmFresh(float dS) { return dS < ${f1(L.freshP)} ? smoothstep(${f1(L.freshA)}, ${f1(L.freshP)}, dS) : 1.0 - smoothstep(${f1(L.freshP)}, ${f1(L.freshB)}, dS); }
float tfmColour(float dA) { return dA > 200.0 ? smoothstep(${f1(L.colA)}, ${f1(L.colB)}, dA) : 0.0; }
float tfmBrown(float dA) { return dA > 200.0 ? smoothstep(${f1(L.brownA)}, ${f1(L.brownB)}, dA) : 0.0; }
float tfmBloom(float dS) { return dS < ${f1(L.bloomP)} ? smoothstep(${f1(L.bloomA)}, ${f1(L.bloomP)}, dS) : 1.0 - smoothstep(${f1(L.bloomP)}, ${f1(L.bloomB)}, dS); }
float tfmH1(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tfmN1(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tfmH1(i), tfmH1(i + vec2(1.0, 0.0)), u.x), mix(tfmH1(i + vec2(0.0, 1.0)), tfmH1(i + vec2(1.0, 1.0)), u.x), u.y); }
// the autumn colour of a kind (0 birch, 1 zelkova, 2 maple, 3 oak, 4 red maple), r 0…1 a per-card variation
vec3 tfmAutumnCol(float k, float r) {
  vec3 c = vec3(0.80, 0.60, 0.10);
  if (k > 0.5) c = mix(vec3(0.74, 0.36, 0.08), vec3(0.62, 0.42, 0.12), r);
  if (k > 1.5) c = mix(vec3(0.78, 0.12, 0.04), vec3(0.88, 0.40, 0.05), r * r);
  if (k > 2.5) c = mix(vec3(0.58, 0.40, 0.12), vec3(0.46, 0.30, 0.12), r);
  if (k > 3.5) c = vec3(0.50, 0.05, 0.04);
  return c;
}
// recolour a leaf colour col; k kind, r variation, dS / dA the tree's days; returns the colour, a = how much of the
// leaf is still on the tree (cards with r above it drop)
vec4 tfmLeafSeason(vec3 col, float k, float r, float dS, float dA, float blossomTree) {
  float lum = dot(col, vec3(0.30, 0.55, 0.15));
  float kd = k < 0.5 ? -6.0 : k < 1.5 ? -3.0 : k > 2.5 && k < 3.5 ? 4.0 : 0.0;   // birch early · oak late
  float aA = dA - kd;
  float amt = tfmLeafAmt(dS, aA);
  if (k > 2.5 && k < 3.5 && aA > 200.0) amt = max(amt, 0.18 * (1.0 - smoothstep(${f1(L.fallB)}, ${f1(L.fallB + 50)}, aA)));   // 참나무: dead leaves hang on into the winter
  float colr = tfmColour(aA), brn = tfmBrown(aA);
  float fr = tfmFresh(dS);
  vec3 freshC = col * vec3(1.18, 1.16, 0.70) + vec3(0.02, 0.03, 0.0);
  col = mix(col, freshC, fr * 0.85);
  vec3 ac = tfmAutumnCol(k, r);
  vec3 tgt = ac * (lum / max(dot(ac, vec3(0.30, 0.55, 0.15)), 0.02)) * 1.25;
  col = mix(col, tgt, colr);
  vec3 bc = vec3(0.36, 0.23, 0.12) * (lum / 0.245) * 1.1;
  col = mix(col, bc, brn * (k > 3.5 ? 0.4 : 0.75));
  // blossom trees (산벚 · 생강나무): pale pink or yellow flowers before the leaves
  float bl = tfmBloom(dS) * blossomTree;
  if (bl > 0.01) { col = mix(col, (r > 0.6 ? vec3(0.92, 0.84, 0.36) : vec3(0.97, 0.86, 0.90)) * (0.55 + 0.45 * lum / 0.25), bl); amt = max(amt, bl * 0.8); }
  return vec4(col, amt);
}
`;
  const glsl = { phen: GLSL_PHEN };

  // ---------------------------------------------------------------- the global snow hook (every lit built-in material)
  const SNOW_DECL = `
#if ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) ) && ! defined( USE_SKINNING ) && ! defined( TFM_NO_SNOW )
uniform vec4 tfmSnowU;
float tfmSnH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tfmSnN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tfmSnH(i), tfmSnH(i + vec2(1.0, 0.0)), u.x), mix(tfmSnH(i + vec2(0.0, 1.0)), tfmSnH(i + vec2(1.0, 1.0)), u.x), u.y); }
#endif
`;
  const SNOW_CODE = `
#if ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) ) && ! defined( USE_SKINNING ) && ! defined( TFM_NO_SNOW )
  if ( tfmSnowU.x > 0.002 || tfmSnowU.z > 0.002 ) {
    vec3 tfmWn = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
    vec3 tfmWp = cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
    float tfmNz = tfmSnN( tfmWp.xz * 0.55 ) * 0.55 + tfmSnN( tfmWp.xz * 2.9 + 11.0 ) * 0.3 + tfmSnN( tfmWp.xz * 11.0 + vec2( tfmWp.y * 3.0, 5.0 ) ) * 0.15;
    float tfmCov = tfmSnowU.x;
    // where it lies: the flattest first; with more snow steeper surfaces fill too; patches melt first where the noise is low
    float tfmA = smoothstep( 0.30, 0.62, tfmWn.y * 0.6 + ( tfmNz - 0.5 ) * 0.6 + tfmCov * 1.05 - 0.75 );
    tfmA *= smoothstep( 0.0, 0.18, tfmCov ) * smoothstep( 0.12, 0.42, tfmWn.y );
    float tfmF = tfmSnowU.z * smoothstep( 0.1, 0.7, tfmWn.y ) * ( 0.35 + 0.4 * tfmNz );
    vec3 tfmSc = vec3( 0.70, 0.73, 0.79 ) * ( 0.9 + 0.12 * tfmNz );
    diffuseColor.rgb = mix( diffuseColor.rgb, tfmSc, clamp( tfmA, 0.0, 1.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.70, 0.76 ), clamp( tfmF, 0.0, 0.6 ) );
    #ifdef STANDARD
      roughnessFactor = mix( roughnessFactor, 0.72, tfmA );
      metalnessFactor = mix( metalnessFactor, 0.0, tfmA );
    #endif
  }
#endif
`;
  try {
    const SC = THREE.ShaderChunk;
    if (SC && SC.emissivemap_pars_fragment && SC.emissivemap_pars_fragment.indexOf('tfmSnowU') < 0) {
      SC.emissivemap_pars_fragment += SNOW_DECL;
      SC.emissivemap_fragment += SNOW_CODE;
      const SL = THREE.ShaderLib;
      for (const k of ['standard', 'physical', 'lambert', 'phong', 'toon']) if (SL[k] && SL[k].uniforms) SL[k].uniforms.tfmSnowU = U.tfmSnowU;
    }
  } catch (e) { G.log?.warn?.('SEASON', 'snow hook not installed', e); }

  // ---------------------------------------------------------------- the system
  const QS = (() => { try { const u = new URLSearchParams(location.search); return { season: u.get('season'), doy: u.get('doy'), snow: u.get('snow'), clock: u.get('clock') }; } catch (e) { return {}; } })();
  const AUTOMATED = (() => { try { return !!navigator.webdriver; } catch (e) { return false; } })();
  const MODES = ['real', 'fixed', 'spring', 'summer', 'autumn', 'winter'];
  const KEYS = ['leaf', 'fresh', 'autumn', 'brown', 'blossom', 'grass', 'snow', 'branch', 'frost', 'ice', 'breath'];
  const clamp = core.clamp;

  const STATE = { id: 'summer', name: '여름', phase: 0.5, doy: 196, month: 7, leaf: 1, fresh: 0, autumn: 0, brown: 0, bare: 0, blossom: 0, grass: 1, snow: 0, branch: 0, frost: 0, ice: 0, breath: 0, temp: 24, tMean: 24, flowers: { amount: 0.7, colors: [], names: [] }, source: 'fixed', weather: 'CLEAR' };
  G.season = STATE;

  const SYS = {
    name: 'season', order: 73, label: '정선의 계절',
    core, U, glsl, LEAF: core.LEAF,
    _mode: null, _target: null, _t: 0, _live: 0, _first: true, _shift: { s: 0, a: 0 }, _doyQ: null, _snowQ: null,
    init() {
      const q = String(QS.season || '').toLowerCase();
      this._query = MODES.includes(q) ? q : null;
      const d = Number(QS.doy); this._doyQ = Number.isFinite(d) && d >= 1 && d <= 366 && QS.doy !== null && QS.doy !== '' ? Math.round(d) : null;
      const s = Number(QS.snow); this._snowQ = QS.snow !== null && QS.snow !== undefined && QS.snow !== '' && Number.isFinite(s) ? clamp(s, 0, 1) : null;
      G.bus.on('weather:changed', () => { this._t = 0; });
      G.bus.on('env:changed', () => { this._t = 0; });
      this.refresh(true);
      G.log.info('SEASON', `${STATE.name} (${this.mode()}) · doy ${STATE.doy} · leaf ${STATE.leaf.toFixed(2)} · autumn ${STATE.autumn.toFixed(2)} · snow ${STATE.snow.toFixed(2)}`);
    },
    /** 'real' | 'fixed' | a season id */
    mode() {
      if (this._mode) return this._mode;
      if (this._query) return this._query;
      if (AUTOMATED && QS.clock !== 'kst') return 'fixed';
      return 'real';
    },
    force(m) {
      if (m === 'auto' || m == null) this._mode = null;
      else if (MODES.includes(m)) this._mode = m;
      else return false;
      this.refresh(true);
      return true;
    },
    /** the target state of now */
    _compute() {
      const mode = this.mode();
      const env = G.env, now = G.time?.now ? G.time.now() : Date.now();
      const k = env?.kst ? env.kst(now) : { doy: 196, hour: 12 };
      const opts = { hour: k.hour, norm: env?.core?.NORM, doy: k.doy };
      if (this._doyQ) {
        // a chosen day of the year: its curves with a typical temperature of that day and no random weather
        opts.doy = this._doyQ;
        const T = core.normalMean(opts.norm, this._doyQ);
        opts.wx = () => ({ weather: 'CLEAR', temp: T, rain1h: 0 });
        opts.now = { weather: 'CLEAR', temp: T };
      } else if (mode === 'fixed') opts.forced = 'summer';
      else if (mode !== 'real') opts.forced = mode;
      else {
        const mc = env?.core;
        if (mc?.modelAt) opts.wx = (t) => mc.modelAt(t);
        const snap = env?.now?.();
        if (snap) opts.now = { weather: snap.weather, temp: snap.temp };
      }
      if (this._snowQ !== null) opts.snow = this._snowQ;
      const st = core.state(now, opts);
      st.source = mode === 'real' ? 'real' : mode === 'fixed' ? 'fixed' : 'forced';
      return st;
    },
    refresh(jump) {
      const tg = this._compute();
      this._target = tg;
      const prev = STATE.id;
      // the things that are no levels: copied at once
      STATE.id = tg.id; STATE.name = tg.name; STATE.phase = tg.phase; STATE.doy = tg.doy; STATE.month = tg.month;
      STATE.temp = tg.temp; STATE.tMean = tg.tMean; STATE.flowers = tg.flowers; STATE.source = tg.source; STATE.weather = tg.weather;
      this._shift = { s: tg.shiftS || 0, a: tg.shiftA || 0 };
      if (jump || this._first) { for (const key of KEYS) STATE[key] = tg[key]; this._first = false; this._live = 0; }
      STATE.bare = 1 - STATE.leaf;
      this._push();
      if (prev !== STATE.id) G.bus.emit('season:changed', { id: STATE.id, prev });
    },
    /** the levels → the shared uniforms */
    _push() {
      const eng = G.sys.engine, low = (eng?.quality || eng?.preset?.name) === 'low';
      const indoor = !!G.sys.places?.indoor;
      const T = U.tfmSeasT.value, S = U.tfmSnowU.value, Gv = U.tfmSeasG.value;
      T.x = STATE.doy + this._shift.s; T.y = STATE.doy - this._shift.a; T.z = STATE.blossom;
      T.w = 1;
      const snow = Math.max(STATE.snow, this._live);
      // `low`: the snow colour only (no rime, no twig snow); inside a room nothing (rooms stand in the same scene)
      S.x = indoor ? 0 : snow; S.y = low || indoor ? 0 : STATE.branch; S.z = low || indoor ? 0 : STATE.frost; S.w = 0;
      Gv.x = STATE.grass; Gv.y = STATE.leaf; Gv.z = STATE.autumn; Gv.w = STATE.ice;
    },
    update(dt) {
      if (!(dt > 0)) return;
      this._t -= dt;
      if (this._t <= 0) { this._t = 60; this.refresh(false); }
      const tg = this._target;
      if (!tg) return;
      // the levels follow the target slowly (about two minutes for a whole change)
      const k = Math.min(1, dt / 120);
      for (const key of KEYS) { const d = tg[key] - STATE[key]; if (Math.abs(d) > 1e-4) STATE[key] += Math.sign(d) * Math.min(Math.abs(d), Math.abs(d) * k + dt / 600); }
      STATE.bare = 1 - STATE.leaf;
      // snow that falls on screen gathers; it melts again above freezing (not in the fixed test season)
      const W = G.sys.weather, mode = this.mode();
      if (W && mode !== 'fixed') {
        const falling = (W.mix && W.mix.SNOW) || 0;
        const temp = Number.isFinite(W.temperature) ? W.temperature : STATE.temp;
        if (falling > 0.3) this._live = Math.min(1, this._live + dt * falling / 150);
        else if (this._live > 0) this._live = Math.max(0, this._live - dt * (temp > 0.5 ? (0.4 + temp * 0.1) / 300 : 1 / 3000));
      }
      this._push();
      try { this._breathTick(Math.min(dt, 0.1)); } catch (e) { if (!this._bErr) { this._bErr = true; G.log.warn('SEASON', 'breath failed', e?.message || e); } }
    },
    // ------------------------------------------------------------ breath in the cold (medium / high, outdoors)
    /** a few soft puffs at the player's mouth, one breath every ~3 s (faster when running): ONE draw call while shown */
    _breathTick(dt) {
      const eng = G.sys.engine, P = G.sys.player;
      const on = STATE.breath > 0.05 && eng && (eng.quality || 'low') !== 'low' && !G.sys.places?.indoor && P?.object && eng.feature?.('smoke') !== false;
      const B = this._breath;
      if (!on) { if (B) B.pts.visible = false; return; }
      if (!B) { this._buildBreath(eng); return; }
      B.pts.visible = true;
      const run = P.speed > 4.5 || P.isRunning;
      B.t -= dt;
      if (B.t <= 0) {
        B.t = run ? 1.4 : 2.9;
        const ry = P.rotY || 0, fx = Math.sin(ry), fz = Math.cos(ry), o = P.object.position;
        const h = (P.rig?.height || 1.62) * 0.93;
        for (let k = 0; k < 3; k++) {
          const i = B.next; B.next = (B.next + 1) % B.n;
          B.age[i] = -k * 0.12;
          B.pos[i * 3] = o.x + fx * 0.22; B.pos[i * 3 + 1] = o.y + h; B.pos[i * 3 + 2] = o.z + fz * 0.22;
          B.vel[i * 3] = fx * (0.32 + k * 0.05) + (Math.random() - 0.5) * 0.06; B.vel[i * 3 + 1] = 0.05 + Math.random() * 0.05; B.vel[i * 3 + 2] = fz * (0.32 + k * 0.05) + (Math.random() - 0.5) * 0.06;
        }
      }
      const A = B.geo.attributes.position.array, S = B.geo.attributes.aA.array, life = 1.7;
      for (let i = 0; i < B.n; i++) {
        const a = B.age[i];
        if (a > life) { S[i * 2] = 0; continue; }
        B.age[i] = a + dt;
        if (a < 0) { S[i * 2] = 0; continue; }
        B.pos[i * 3] += B.vel[i * 3] * dt; B.pos[i * 3 + 1] += B.vel[i * 3 + 1] * dt; B.pos[i * 3 + 2] += B.vel[i * 3 + 2] * dt;
        B.vel[i * 3] *= 0.97; B.vel[i * 3 + 2] *= 0.97;
        A[i * 3] = B.pos[i * 3]; A[i * 3 + 1] = B.pos[i * 3 + 1]; A[i * 3 + 2] = B.pos[i * 3 + 2];
        const f = a / life;
        S[i * 2] = (1 - f) * (1 - f) * 0.34 * clamp(STATE.breath, 0, 1) * (0.4 + 0.6 * Math.min(1, f * 6));
        S[i * 2 + 1] = 0.12 + f * 0.55;
      }
      B.geo.attributes.position.needsUpdate = true; B.geo.attributes.aA.needsUpdate = true;
      const night = clamp(G.world?.nightFactor || 0, 0, 1);
      B.mat.uniforms.uLight.value = 1 - night * 0.75;
    },
    _buildBreath(eng) {
      const n = 12, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uLight: { value: 1 }, uScale: { value: 620 } },
        vertexShader: `
          attribute vec2 aA; uniform float uScale; varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vA = aA.x;
            gl_PointSize = aA.x > 0.0 ? clamp(aA.y * uScale / max(-mv.z, 0.2), 1.0, 160.0) : 0.0;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform float uLight; varying float vA;
          void main() {
            vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
            float a = vA * (1.0 - smoothstep(0.15, 1.0, r));
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(0.86, 0.88, 0.92) * uLight, a);
          }`,
        transparent: true, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.name = 'season-breath'; pts.frustumCulled = false; pts.renderOrder = 3; pts.raycast = () => {};
      pts.userData.guardSkip = true;
      eng.scene.add(pts);
      this._breath = { geo, mat, pts, n, t: 0.5, next: 0, age: new Float32Array(n).fill(9), pos: new Float32Array(n * 3), vel: new Float32Array(n * 3) };
    },
    /** what the developer centre and tests read */
    info() { return { mode: this.mode(), state: JSON.parse(JSON.stringify(STATE)), live: this._live, shift: this._shift }; },
  };
  G.register(SYS);
  G.seasons = SYS;
  // the settings row (체험 › 계절 풍경): the device may look at another season; 실제 = the real 정선 (the default)
  (G.settingsQueue = G.settingsQueue || []).push({
    id: 'seasonLook', tab: 'game', group: '계절', type: 'select', label: '계절 풍경', order: 40, scope: 'device', default: 'real',
    hint: '보통은 지금 정선의 계절과 날씨를 따라요. 다른 계절을 골라 구경할 수도 있어요.',
    words: '계절 봄 여름 가을 겨울 단풍 눈 꽃 season',
    options: [{ v: 'real', l: '지금 정선', e: '📅' }, { v: 'spring', l: '봄', e: '🌸' }, { v: 'summer', l: '여름', e: '🌿' }, { v: 'autumn', l: '가을', e: '🍁' }, { v: 'winter', l: '겨울', e: '❄️' }],
    apply(v) { try { SYS.force(v === 'real' || !v ? 'auto' : v); } catch (e) { /* before init: init reads the query and the mode */ } },
  });
})();
