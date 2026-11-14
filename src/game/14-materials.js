// =============================================================================
// 14-materials.js — G.mat: photographed PBR surfaces from the asset pack (CONTRACT §16.2).
//
//   G.mat.sets                      { set: { tile: [u, v] metres per repeat, avg: [r, g, b] sRGB, rough, normalScale, grain?, c, n, r } }
//                                   the 20 sets of the contract + pine_timber, pine_planks, flagstone, straw_rope, bamboo
//   G.mat.alias                     wood_beam, wood_floor, plaster, clay, giwa, thatch, hanji, jangpan, onggi, soil, dirt, granite,
//                                   doldam, bark (+ timber, planks, rope) → set name
//   G.mat.usable(set)               the set is in the page AND the preset is not `low` AND WebGL is there
//   G.mat.apply(material, set, opt) gives a MeshStandardMaterial the set's map / normalMap / roughnessMap. The textures are
//                                   G.pack placeholders (1×1) until decoded, so call it WHEN THE MATERIAL IS CREATED: the
//                                   shader is compiled once, with the maps. A no-op on `low` or without the pack.
//       opt.tile        [u, v] | n      metres per repeat (default: the set's)
//       opt.rotation    radians         turn the texture (Math.PI / 2 puts a grain that runs along U along V)
//       opt.look        [r, g, b] sRGB  the average colour the surface must keep (the material colour becomes look / the
//                                       photo's own average) — existing surfaces keep their colour design, vertex colours
//                                       keep tinting them
//       opt.tint        [r, g, b] | hex a plain multiplier instead of `look`
//       opt.roughness   0..1            mean roughness to keep (default: the material's own roughness). The roughness map
//                                       multiplies, so material.roughness becomes target / the map's mean and
//                                       material.userData.gmRoughScale = 1 / the map's mean (rain code multiplies by it)
//       opt.normalScale number          default: the set's
//       opt.detail      true            keep material.map (a procedural pattern: block joints, furrows, a painted band) and
//                                       multiply the photograph in as a detail layer; opt.world: true takes the detail UV
//                                       from the world XZ plane (ground surfaces whose own UVs are not in metres) and bends
//                                       the normal in world space (flat ground only); opt.strength 0..1 fades the layer
//       opt.normal / opt.rough  false   leave that map out
//       opt.macro       0..0.3          low-frequency world-space tint (weathering; breaks the tiling grid from far away)
//       opt.blend       0..1            blends in the same map at a second scale where a slow noise says so (no repeat grid)
//       opt.env         number          envMapIntensity
//       opt.priority    0..9            decode order (0 first)
//   G.mat.get(key, opt)             a shared MeshStandardMaterial of a set or alias (opt as above + vertexColors, side,
//                                   transparent / alphaTest …). On `low` / without the pack: the set's average colour, no maps.
//   G.mat.patch(material, {macro, blend, detail})   the shader patch on its own (used by apply)
//   G.mat.applied                   [{ material, set }] every material that got maps (tests, the developer centre)
// Normal maps need no tangents: three.js derives the tangent frame from screen-space derivatives of the map's own UVs,
// so mirrored and rotated UVs light correctly.
// =============================================================================
(function () {
  const PI = Math.PI;
  // metres per repeat are estimated from what the photograph shows (board widths, stone sizes, weave pitch)
  const SETS = {
    giwa_roof_tile: { tile: [2.4, 2.4], avg: [73, 74, 75], rough: 0.82, normalScale: 1.2 },
    thatch_choga: { tile: [1.6, 1.6], avg: [111, 99, 85], rough: 1.0, normalScale: 1.0 },
    lime_plaster_wall: { tile: [2.2, 2.2], avg: [216, 212, 209], rough: 0.93, normalScale: 0.8 },
    hwangto_clay_wall: { tile: [2.0, 2.0], avg: [150, 98, 74], rough: 0.95, normalScale: 0.9 },
    timber_beam_dark: { tile: [1.2, 1.2], avg: [88, 61, 43], rough: 0.72, normalScale: 0.8, grain: 'u' },
    wood_planks_dark: { tile: [2.0, 2.0], avg: [90, 79, 70], rough: 0.85, normalScale: 1.0, grain: 'u' },
    maru_floor: { tile: [1.8, 1.8], avg: [95, 78, 60], rough: 0.58, normalScale: 0.8, grain: 'v' },
    hanji_paper: { tile: [1.0, 0.586], avg: [245, 244, 242], rough: 0.9, normalScale: 0.5 },
    jangpan_floor_paper: { tile: [1.5, 1.5], avg: [165, 135, 104], rough: 0.5, normalScale: 0.3 },
    straw_mat: { tile: [1.2, 1.2], avg: [217, 193, 123], rough: 0.9, normalScale: 0.9 },
    woven_basket: { tile: [0.4, 0.4], avg: [160, 136, 107], rough: 0.7, normalScale: 1.0 },
    hemp_linen: { tile: [0.3, 0.3], avg: [199, 194, 185], rough: 0.95, normalScale: 0.8 },
    onggi_glaze: { tile: [0.8, 0.8], avg: [152, 86, 47], rough: 0.26, normalScale: 0.5 },
    field_soil: { tile: [1.6, 1.6], avg: [89, 68, 57], rough: 1.0, normalScale: 1.0 },
    yard_dirt_path: { tile: [2.5, 2.5], avg: [150, 144, 123], rough: 1.0, normalScale: 0.9 },
    gravel: { tile: [1.6, 1.6], avg: [131, 127, 116], rough: 1.0, normalScale: 1.0 },
    grass: { tile: [2.0, 2.0], avg: [100, 112, 53], rough: 0.95, normalScale: 0.7 },
    granite_stone: { tile: [2.5, 2.5], avg: [148, 145, 136], rough: 0.9, normalScale: 0.9 },
    stone_wall_doldam: { tile: [1.6, 1.6], avg: [129, 114, 95], rough: 0.95, normalScale: 1.2 },
    pine_bark: { tile: [0.9, 1.8], avg: [124, 104, 83], rough: 1.0, normalScale: 1.2, grain: 'v' },
    pine_timber: { tile: [1.1, 1.1], avg: [178, 145, 103], rough: 0.78, normalScale: 0.7, grain: 'u' },
    pine_planks: { tile: [2.2, 2.2], avg: [196, 171, 118], rough: 0.82, normalScale: 1.0, grain: 'u' },
    flagstone: { tile: [2.2, 2.2], avg: [145, 139, 119], rough: 0.92, normalScale: 1.0 },
    straw_rope: { tile: [0.24, 0.12], avg: [124, 109, 80], rough: 1.0, normalScale: 1.0 },
    bamboo: { tile: [0.9, 0.9], avg: [129, 110, 71], rough: 0.6, normalScale: 1.0, grain: 'v' },
  };
  for (const [name, s] of Object.entries(SETS)) { s.c = `mat/${name}/c`; s.n = `mat/${name}/n`; s.r = `mat/${name}/r`; }
  const ALIAS = {
    wood_beam: 'timber_beam_dark', wood_floor: 'maru_floor', plaster: 'lime_plaster_wall', clay: 'hwangto_clay_wall', giwa: 'giwa_roof_tile',
    thatch: 'thatch_choga', hanji: 'hanji_paper', jangpan: 'jangpan_floor_paper', onggi: 'onggi_glaze', soil: 'field_soil', dirt: 'yard_dirt_path',
    granite: 'granite_stone', doldam: 'stone_wall_doldam', bark: 'pine_bark', timber: 'pine_timber', planks: 'pine_planks', rope: 'straw_rope',
  };
  const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lin3 = (rgb) => [s2l(rgb[0]), s2l(rgb[1]), s2l(rgb[2])];
  const applied = [];
  const cache = new Map();

  /** the photograph's average colour (linear), from the pack's manifest or the table above */
  function avgLin(set) {
    const m = G.pack && G.pack.meta && G.pack.meta(SETS[set].c);
    return lin3((m && Array.isArray(m.avg) && m.avg) || SETS[set].avg);
  }
  function roughAvg(set) {
    const m = G.pack && G.pack.meta && G.pack.meta(SETS[set].r);
    return m && Number.isFinite(m.avg) ? clamp(m.avg / 255, 0.05, 1) : 1;
  }
  function usable(set) {
    set = ALIAS[set] || set;
    const s = SETS[set];
    return !!(s && G.pack && G.pack.usable && G.pack.usable(s.c));
  }
  function anisotropy() {
    const e = G.sys && G.sys.engine, p = e && e.preset;
    if (p && Number.isFinite(p.aniso)) return p.aniso;
    return e && e.quality === 'high' ? 8 : 4;
  }
  function toLinearTint(t) {
    if (t == null) return null;
    if (Array.isArray(t)) return [t[0], t[1], t[2]];
    const c = new THREE.Color(t);
    return [c.r, c.g, c.b];
  }

  // ---------------------------------------------------------------- shader patch (macro tint · second scale · detail layer)
  const GLSL_NOISE = `
float gmHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gmNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gmHash(i), gmHash(i + vec2(1.0, 0.0)), u.x), mix(gmHash(i + vec2(0.0, 1.0)), gmHash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
  /**
   * features: { macro: 0..0.3, blend: 0..1,
   *             detail: { texture, repeat: [u, v], gain: [r, g, b], world: bool, strength: 0..1, normal: texture, normalScale } }
   * Uniforms live in material.userData.gm (tweak them freely; nothing recompiles). An existing onBeforeCompile is kept.
   */
  function patch(material, f) {
    if (!material || !f) return material;
    const macro = +f.macro || 0, blend = +f.blend || 0, detail = f.detail || null;
    if (!macro && !blend && !detail) return material;
    const U = material.userData.gm || (material.userData.gm = {});
    U.gmMacro = { value: macro };
    U.gmBlend = { value: blend };
    if (detail) {
      U.gmDetail = { value: detail.texture };
      U.gmDetailTf = { value: new THREE.Vector2(detail.repeat[0], detail.repeat[1]) };
      U.gmDetailGain = { value: new THREE.Vector3(detail.gain[0], detail.gain[1], detail.gain[2]) };
      U.gmDetailK = { value: Number.isFinite(detail.strength) ? detail.strength : 1 };
      if (detail.normal) { U.gmDetailN = { value: detail.normal }; U.gmDetailNK = { value: Number.isFinite(detail.normalScale) ? detail.normalScale : 1 }; }
    }
    const dn = !!(detail && detail.world && detail.normal);
    const flags = `${macro ? 'M' : ''}${blend ? 'B' : ''}${detail ? (detail.world ? 'W' : 'D') : ''}${dn ? 'N' : ''}`;
    const prevCompile = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = function (sh, renderer) {
      if (typeof prevCompile === 'function') prevCompile.call(this, sh, renderer);
      Object.assign(sh.uniforms, U);
      const defs = `${macro ? '#define GM_MACRO\n' : ''}${blend ? '#define GM_BLEND\n' : ''}${detail ? '#define GM_DETAIL\n' : ''}${dn ? '#define GM_DETAIL_N\n' : ''}`;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${defs}varying vec3 vGmW;\n#ifdef GM_DETAIL\nuniform vec2 gmDetailTf;\nvarying vec2 vGmD;\n#endif`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 gmWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            gmWp = instanceMatrix * gmWp;
          #endif
          gmWp = modelMatrix * gmWp;
          vGmW = gmWp.xyz;
          #ifdef GM_DETAIL
            vGmD = ${detail && detail.world ? 'gmWp.xz' : 'uv'} * gmDetailTf;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${defs}varying vec3 vGmW;\nuniform float gmMacro;\nuniform float gmBlend;\n#ifdef GM_DETAIL\nuniform sampler2D gmDetail;\nuniform vec3 gmDetailGain;\nuniform float gmDetailK;\nvarying vec2 vGmD;\n#endif\n#ifdef GM_DETAIL_N\nuniform sampler2D gmDetailN;\nuniform float gmDetailNK;\n#endif\n${GLSL_NOISE}`)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            #ifdef GM_BLEND
              // the same map again at a second scale, where a slow noise says so: no texel grid lines up twice
              float gmB = smoothstep(0.32, 0.68, gmNoise(vGmW.xz * 0.23 + vGmW.y * 0.19));
              vec3 gmC2 = texture2D( map, vMapUv * 0.37 + vec2(0.37, 0.71) ).rgb;
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, gmC2, gmB * gmBlend);
            #endif
            diffuseColor *= sampledDiffuseColor;
          #endif
          #ifdef GM_DETAIL
            diffuseColor.rgb *= mix(vec3(1.0), min(texture2D( gmDetail, vGmD ).rgb * gmDetailGain, vec3(2.6)), gmDetailK);
          #endif
          #ifdef GM_MACRO
            float gmM = gmNoise(vGmW.xz * 0.061 + vGmW.y * 0.047) * 0.62 + gmNoise(vGmW.xz * 0.19 + vGmW.y * 0.13 + 7.3) * 0.38;
            diffuseColor.rgb *= 1.0 + (gmM - 0.5) * 2.0 * gmMacro;
          #endif`);
      if (dn) {
        // ground only: the detail normal map lies in the world XZ plane, so it bends the world-space normal directly
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 gmDn = (texture2D( gmDetailN, vGmD ).xy * 2.0 - 1.0) * gmDetailNK;
            vec3 gmNw = inverseTransformDirection( normal, viewMatrix );
            gmNw = normalize( gmNw + vec3( gmDn.x, 0.0, gmDn.y ) * step( 0.5, gmNw.y ) );
            normal = normalize( ( viewMatrix * vec4( gmNw, 0.0 ) ).xyz );
          }`);
      }
    };
    material.customProgramCacheKey = function () { return `${typeof prevKey === 'function' ? prevKey.call(this) : ''}|gm:${flags}`; };
    return material;
  }

  // ---------------------------------------------------------------- apply
  function apply(material, setName, opt = {}) {
    const set = ALIAS[setName] || setName, S = SETS[set];
    if (!material || !S) { if (!S) G.log.warn('MAT', `unknown set ${setName}`); return material; }
    if (!usable(set)) return material;                       // low / no pack / no WebGL: the caller's own look stays
    if (!material.isMeshStandardMaterial) { G.log.warn('MAT', `${set}: not a MeshStandardMaterial (${material.type})`); return material; }
    const P = G.pack;
    const tile = Array.isArray(opt.tile) ? opt.tile : (Number.isFinite(opt.tile) ? [opt.tile, opt.tile] : S.tile);
    const repeat = [1 / tile[0], 1 / tile[1]];
    const rotation = Number.isFinite(opt.rotation) ? opt.rotation : 0;
    const aniso = anisotropy();
    const pr = Number.isFinite(opt.priority) ? opt.priority : 2;
    const tx = (name, extra) => P.texture(name, { repeat, rotation, anisotropy: aniso, ...extra });
    const avg = avgLin(set);
    let detail = null;
    if (opt.detail) {
      // the procedural pattern stays in material.map; the photograph is a detail layer with mean 1
      const dr = repeat;
      detail = { texture: P.texture(S.c, { repeat: [1, 1], anisotropy: aniso, priority: pr }), repeat: dr, world: !!opt.world,
        strength: Number.isFinite(opt.strength) ? opt.strength : 1,
        gain: [clamp(1 / Math.max(avg[0], 1e-3), 0, 12), clamp(1 / Math.max(avg[1], 1e-3), 0, 12), clamp(1 / Math.max(avg[2], 1e-3), 0, 12)] };
      if (opt.world && opt.normal !== false) {
        detail.normal = P.texture(S.n, { repeat: [1, 1], anisotropy: aniso, priority: pr + 1 });
        detail.normalScale = Number.isFinite(opt.normalScale) ? opt.normalScale : S.normalScale;
      }
      const t = toLinearTint(opt.tint);
      if (t) material.color.setRGB(material.color.r * t[0], material.color.g * t[1], material.color.b * t[2]);
    } else {
      material.map = tx(S.c, { priority: pr });
      let t = toLinearTint(opt.tint);
      if (opt.look) { const L = lin3(opt.look); t = [L[0] / Math.max(avg[0], 1e-3), L[1] / Math.max(avg[1], 1e-3), L[2] / Math.max(avg[2], 1e-3)]; if (opt.tint != null) { const k = toLinearTint(opt.tint); t = [t[0] * k[0], t[1] * k[1], t[2] * k[2]]; } }
      if (t) material.color.setRGB(clamp(material.color.r * t[0], 0, 4), clamp(material.color.g * t[1], 0, 4), clamp(material.color.b * t[2], 0, 4));
    }
    if (material.bumpMap) material.bumpMap = null;           // the photographed normal map replaces a procedural bump
    if (opt.normal !== false && !(opt.detail && opt.world)) {
      material.normalMap = tx(S.n, { priority: pr + 1 });
      const ns = Number.isFinite(opt.normalScale) ? opt.normalScale : S.normalScale;
      material.normalScale.set(ns, ns);
    }
    if (opt.rough !== false && !(opt.detail && opt.world)) {
      material.roughnessMap = tx(S.r, { priority: pr + 2 });
      const target = Number.isFinite(opt.roughness) ? opt.roughness : (Number.isFinite(material.roughness) ? material.roughness : S.rough);
      const ra = roughAvg(set);
      material.roughness = clamp(target / ra, 0, 4);          // the map multiplies: its mean lands on the target
      material.userData.gmRoughScale = 1 / ra;                // code that sets a roughness later (rain) multiplies by this
    }
    if (Number.isFinite(opt.env)) material.envMapIntensity = opt.env;
    patch(material, { macro: opt.macro, blend: opt.detail ? 0 : opt.blend, detail });
    material.userData.gmSet = set;
    material.needsUpdate = true;
    applied.push({ material, set });
    return material;
  }

  // ---------------------------------------------------------------- shared materials by name
  function get(key, opt = {}) {
    const set = ALIAS[key] || key, S = SETS[set];
    if (!S) throw new Error('G.mat: unknown material ' + key);
    const id = set + '|' + JSON.stringify(opt, (k, v) => (v && v.isColor ? '#' + v.getHexString() : v));
    let m = cache.get(id);
    if (m) return m;
    const { tile, rotation, look, tint, roughness, normalScale, detail, world, normal, rough, macro, blend, env, priority, ...rest } = opt;
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: Number.isFinite(roughness) ? roughness : S.rough, metalness: 0, ...rest });
    m.name = 'gm-' + set;
    if (usable(set)) apply(m, set, opt);
    else {
      // low / no pack: the photograph's average colour (or the wanted look), no maps
      const base = look ? lin3(look) : avgLin(set), t = toLinearTint(tint) || [1, 1, 1];
      m.color.setRGB(clamp(base[0] * t[0], 0, 4), clamp(base[1] * t[1], 0, 4), clamp(base[2] * t[2], 0, 4));
      if (Number.isFinite(env)) m.envMapIntensity = env;
    }
    cache.set(id, m);
    return m;
  }

  G.mat = { sets: SETS, alias: ALIAS, usable, apply, get, patch, applied, glslNoise: GLSL_NOISE, _avgLin: avgLin, PI_2: PI / 2 };
})();
