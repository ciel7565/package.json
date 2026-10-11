// =============================================================================
// 50-minimap.js — zone/POI detection, minimap panel, world map, fast travel (G.sys.minimap)
//
//   currentZone / currentPoi          zone (G.data.zones entry or G.data.defaultZone) / poi | null
//   worldToMap(x, z) -> {x, y, u, v}  base-map pixel (x, y) and normalised (u, v 0..1) coordinates
//   ONE travel flow (duplicates merged): every "go somewhere" entry point ends in travelTo()
//   openWorldMap({zoneId, full})      large map: zone chips -> description + '여기로 이동'; the zone list on the
//                                     right has a direct 이동 button per zone (this replaced the old fast-travel list)
//   openFastTravel()                  = the world map's zone list (normal) / the picture menu (easy)
//   openPictureTravel()               쉬운 모드 "🗺️ 어디 갈까?": big picture tiles (⭐ quest goal, 🏺 my jar, 9 zones)
//   travelTo(id | {x,z}, {say}) -> Promise<bool>   zone / POI / NPC / layout anchor / point: fade + teleport
//                                     to a free arrival spot (one travel at a time; kid voice + sparkle on arrival)
//   arrivalFor(id) -> {x, z, rotY} | null
//   setVisible(bool) / toggle() / setCollapsed(bool) / zoomIn() / zoomOut()
// Easy mode: M / 'move' / minimap tap open the picture menu; the minimap shows big zone emoji and bigger
// markers, and tapping a zone on it travels there.
// Zone detection every 0.25 s (with hysteresis) -> zone:exit / zone:enter {zoneId, zone, first},
// poi:enter {poiId, poi, first}; first visits are stored in G.state.visited / poisVisited.
// Actions: minimap (toggle panel), move, minimap-collapse, minimap-close, minimap-zoom-in/out. Hotkey M.
// The base map is pre-rendered once from the terrain colour/height fields + layout vectors + nature trees.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const PI = Math.PI, TAU = PI * 2;
  const BASE = { x0: -150, z0: -150, size: 300, ppm: 4 };     // 1200 x 1200 px base canvas
  const ZOOMS = [50, 80, 120, 180, 260];                      // metres across the minimap width
  const DEFAULT_ZOOM = 2;
  const LS_ZOOM = 'tfm.v1.mmZoom', LS_COLLAPSED = 'tfm.v1.mmCollapsed', LS_CLOSE_HINT = 'tfm.v1.mmCloseHint';
  const WORLD_VIEW = { cx: 4, cz: -8, size: 236 };            // default world-map framing (m)
  const BG_FOREST = '#2d4a2b';
  // arrival spots for fast travel [x, z, rotY] (free ground, facing the zone's highlight)
  const ARRIVE = {
    ZONE_MAIN: [0, 6.5, PI],
    ZONE_CROP: [0, -18.5, PI],
    ZONE_HALL: [0, -63, PI],
    ZONE_HERB: [-33, -30, -PI / 2],
    ZONE_EDUCATION: [-44, -50, PI],
    ZONE_FERMENTATION: [-24, 3, -PI / 2],
    ZONE_JANGDOKDAE: [20.5, 2, PI / 2],
    ZONE_REST: [38, 37.5, 0.75],
    ZONE_ENTRANCE: [0, 66, PI],
    // points of interest next to water: stand on the bank, looking at the sight (never in the pond basin)
    POI_WATERFALL: [-18, -58, -2.415],
    POI_PAVILION: [43, 47, 2.28],
    POI_RIVERSIDE: [74, 46, 1.89],
  };
  const KIND_R = { pine: 2.1, oak: 2.6, maple: 2.5, zelkova: 3.6, conifer: 1.55 };
  const EASY_ZOOM = 3;                                        // 180 m across: more zones to tap
  const ZONE_EMOJI = {
    ZONE_MAIN: '⛲', ZONE_CROP: '🌱', ZONE_HALL: '🏛️', ZONE_HERB: '🌿', ZONE_EDUCATION: '📖', ZONE_FERMENTATION: '🍲',
    ZONE_JANGDOKDAE: '🏺', ZONE_REST: '🌸', ZONE_ENTRANCE: '🚪', ZONE_TRAIL: '🚶',
  };
  const ZONE_SAY = {
    ZONE_MAIN: '분수가 있는 광장', ZONE_CROP: '채소를 기르는 밭', ZONE_HALL: '큰 체험관', ZONE_HERB: '향기로운 허브 밭',
    ZONE_EDUCATION: '이야기를 배우는 곳', ZONE_FERMENTATION: '맛있는 발효 음식', ZONE_JANGDOKDAE: '장독이 가득한 곳',
    ZONE_REST: '꽃과 연못 정원', ZONE_ENTRANCE: '들어오는 문',
  };
  const POI_KID = {
    POI_STORAGE: ['🍶', '저장고', '커다란 옹기가 모여 있는 저장고'], POI_TOOLS: ['🛠️', '옛날 도구', '옛날 농기구를 구경하는 곳'],
    POI_PAVILION: ['🪷', '정자', '연못가의 예쁜 정자'], POI_WATERFALL: ['💦', '폭포', '시원한 작은 폭포'],
    POI_RIVERSIDE: ['🏞️', '계곡', '맑은 계곡물을 보는 곳'], POI_PARKING: ['🚗', '주차장', '자동차가 쉬는 곳'],
    POI_HANOK_VILLAGE: ['🏡', '한옥마을', '옛날 집이 모여 있는 마을'],
  };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  /**
   * a dry, free spot near (x, z): not water, not inside a collider, and not down in a pond / river basin
   * (feet must stay above the water surface) — searched in growing rings up to ~14 m; null when none
   */
  function safeSpot(x, z) {
    const W = G.world, b = W.bounds;
    const wy = L().waterY ?? -1.1;
    const ok = (px, pz) => {
      if (!(px > b.minX + 1 && px < b.maxX - 1 && pz > b.minZ + 1 && pz < b.maxZ - 1)) return false;
      if (W.isWater(px, pz)) return false;
      const y = W.heightAt(px, pz);
      return Number.isFinite(y) && y > wy + 0.08 && !W.blocked(px, pz, 0.45, y);
    };
    if (ok(x, z)) return { x, z };
    for (let r = 0.8; r <= 14; r += 0.8) {
      const n = Math.max(8, Math.round(r * 5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }
  const say = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };
  const kidToast = (msg, emoji = '🗺️') => G.ui.toast(msg, { type: 'info', emoji, sound: false, duration: 2400 });

  const L = () => G.data.layout || {};
  const TR = () => G.sys.terrain || null;
  const zones = () => G.data.zones || [];
  const zoneIndex = (id) => zones().findIndex((z) => z.id === id);
  const _c = new THREE.Color(), _rgb = { r: 0, g: 0, b: 0 };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };

  /** css colour string of a linear THREE.Color, optionally scaled */
  function sRGB(col, mul = 1) {
    col.getRGB(_rgb, THREE.SRGBColorSpace);
    return `rgb(${Math.round(clamp(_rgb.r * mul, 0, 1) * 255)},${Math.round(clamp(_rgb.g * mul, 0, 1) * 255)},${Math.round(clamp(_rgb.b * mul, 0, 1) * 255)})`;
  }
  function hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const _rgbaCache = new Map();
  function rgba(hex, a) {
    const k = hex + a;
    let v = _rgbaCache.get(k);
    if (!v) { const [r, g, b] = hexToRgb(hex); v = `rgba(${r},${g},${b},${a})`; if (_rgbaCache.size < 256) _rgbaCache.set(k, v); }
    return v;
  }
  /** Korean particle 으로/로 */
  function ro(word) {
    const w = String(word || ''), c = w.charCodeAt(w.length - 1) - 0xac00;
    if (!(c >= 0 && c <= 11171)) return `${w}로`;
    const jong = c % 28;
    return `${w}${jong === 0 || jong === 8 ? '로' : '으로'}`;
  }

  // =============================================================== base map rendering
  function strokeLine(ctx, pts, width, color, dash) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width; ctx.strokeStyle = color;
    ctx.setLineDash(dash || []);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }
  function rotRect(ctx, x, z, w, d, rot, fill, stroke, lw) {
    ctx.save();
    ctx.translate(x, z); ctx.rotate(-(rot || 0));
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(-w / 2, -d / 2, w, d); }
    if (stroke) { ctx.lineWidth = lw || 0.3; ctx.strokeStyle = stroke; ctx.strokeRect(-w / 2, -d / 2, w, d); }
    ctx.restore();
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawTerrainRaster(ctx, N) {
    const T = TR();
    const S = 0.75, n = Math.round(BASE.size / S), n2 = n + 2;
    const small = document.createElement('canvas');
    small.width = n; small.height = n;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(n, n);
    const data = img.data;
    const H = new Float32Array(n2 * n2);
    const hAt = (x, z) => { try { return T ? T.heightAt(x, z) : G.world.terrainHeight(x, z); } catch (e) { return 0; } };
    for (let j = 0; j < n2; j++) {
      const z = BASE.z0 + (j - 0.5) * S;
      for (let i = 0; i < n2; i++) H[j * n2 + i] = hAt(BASE.x0 + (i - 0.5) * S, z);
    }
    const wy = L().waterY ?? -1.1;
    // terrain colours live on the terrain grid vertices (nearest lookup) -> cache them and interpolate bilinearly
    const step = T?.core?.step > 0 ? T.core.step : 0;
    let cg = null, cgN = 0, cgX0 = 0;
    if (T && T.colorAt && step) {
      cgX0 = Math.floor((BASE.x0 - step) / step) * step;
      cgN = Math.ceil((BASE.size + step * 3) / step) + 1;
      cg = new Float32Array(cgN * cgN * 3);
      for (let j = 0; j < cgN; j++) for (let i = 0; i < cgN; i++) {
        T.colorAt(cgX0 + i * step, cgX0 + j * step, _c); _c.getRGB(_rgb, THREE.SRGBColorSpace);
        const o = (j * cgN + i) * 3; cg[o] = _rgb.r * 255; cg[o + 1] = _rgb.g * 255; cg[o + 2] = _rgb.b * 255;
      }
    }
    const colorAt = (x, z, out) => {
      if (cg) {
        const fx = (x - cgX0) / step, fz = (z - cgX0) / step;
        const i = clamp(Math.floor(fx), 0, cgN - 2), j = clamp(Math.floor(fz), 0, cgN - 2);
        const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
        const a = (j * cgN + i) * 3, b = a + 3, c = a + cgN * 3, d = c + 3;
        for (let k = 0; k < 3; k++) out[k] = (cg[a + k] * (1 - tx) + cg[b + k] * tx) * (1 - tz) + (cg[c + k] * (1 - tx) + cg[d + k] * tx) * tz;
      } else if (T && T.colorAt) { T.colorAt(x, z, _c); _c.getRGB(_rgb, THREE.SRGBColorSpace); out[0] = _rgb.r * 255; out[1] = _rgb.g * 255; out[2] = _rgb.b * 255; }
      else { out[0] = 104; out[1] = 150; out[2] = 74; }
      return out;
    };
    const col = [0, 0, 0];
    // light from the north-west, high
    const lx = -0.55, ly = 0.72, lz = -0.42, ll = Math.hypot(lx, ly, lz);
    const Lx = lx / ll, Ly = ly / ll, Lz = lz / ll;
    const deep = [36, 104, 146], shallow = [86, 176, 207];
    for (let j = 0; j < n; j++) {
      const z = BASE.z0 + (j + 0.5) * S;
      for (let i = 0; i < n; i++) {
        const x = BASE.x0 + (i + 0.5) * S;
        const k = (j + 1) * n2 + (i + 1);
        const h = H[k];
        let r, g, b;
        if (h < wy - 0.32) {
          const dep = clamp((wy - h) / 1.6, 0, 1);
          r = shallow[0] + (deep[0] - shallow[0]) * dep; g = shallow[1] + (deep[1] - shallow[1]) * dep; b = shallow[2] + (deep[2] - shallow[2]) * dep;
          // ripple shimmer
          const sh = 1 + 0.05 * Math.sin(x * 0.9 + z * 0.35) * Math.sin(z * 1.3 - x * 0.2);
          r *= sh; g *= sh; b *= sh;
        } else {
          colorAt(x, z, col); r = col[0]; g = col[1]; b = col[2];
          const dx = (H[k + 1] - H[k - 1]) / (2 * S), dz = (H[k + n2] - H[k - n2]) / (2 * S);
          const nl = Math.hypot(dx, 1, dz);
          const dif = (-dx * Lx + Ly - dz * Lz) / nl;
          const shade = clamp(0.62 + 0.5 * (dif / Ly - 0.55) + 0.4, 0.55, 1.28);
          // gentle elevation tint: high ground slightly cooler & lighter (aerial perspective)
          const hk = clamp(h / 60, 0, 1);
          r = (r * shade) * (1 - hk * 0.18) + 120 * hk * 0.18;
          g = (g * shade) * (1 - hk * 0.18) + 140 * hk * 0.18;
          b = (b * shade) * (1 - hk * 0.18) + 130 * hk * 0.18;
        }
        const o = (j * n + i) * 4;
        data[o] = clamp(r, 0, 255); data[o + 1] = clamp(g, 0, 255); data[o + 2] = clamp(b, 0, 255); data[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, N, N);
  }

  function drawWater(ctx) {
    const T = TR();
    const river = T?.riverLine || L().river?.points;
    const hw = T?.riverHalfWidth || ((L().river?.width || 16) / 2);
    if (river && river.length > 1) {
      strokeLine(ctx, river, hw * 2 + 3.4, 'rgba(222,206,164,0.55)');
      strokeLine(ctx, river, hw * 2 - 1.2, 'rgba(66,150,196,0.92)');
      strokeLine(ctx, river, hw * 1.1, 'rgba(98,182,216,0.55)');
      strokeLine(ctx, river, hw * 0.35, 'rgba(160,216,236,0.35)');
      // flow streaks
      ctx.save();
      ctx.globalAlpha = 0.35;
      strokeLine(ctx, river, 0.25, '#e6f6ff', [3, 7]);
      ctx.restore();
    }
    for (const p of L().ponds || []) {
      ctx.beginPath(); ctx.arc(p.x, p.z, p.r + 1.1, 0, TAU); ctx.fillStyle = '#cfc2a0'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.z, p.r + 0.4, 0, TAU); ctx.fillStyle = '#9d9483'; ctx.fill();
      const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.z - p.r * 0.3, p.r * 0.1, p.x, p.z, p.r);
      g.addColorStop(0, '#79cbe6'); g.addColorStop(1, '#2f84b0');
      ctx.beginPath(); ctx.arc(p.x, p.z, p.r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      if (p.waterfall) {
        const w = p.waterfall;
        ctx.beginPath(); ctx.arc(w.x, w.z, 1.2, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        ctx.beginPath(); ctx.arc(w.x + 0.8, w.z + 1.4, 1.6, 0, TAU); ctx.fillStyle = 'rgba(230,248,255,0.5)'; ctx.fill();
      }
      // lily pads
      const r = U.rng(p.id || 'pond');
      for (let i = 0; i < 6; i++) {
        const a = r() * TAU, d = p.r * (0.45 + r() * 0.4);
        ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 0.45 + r() * 0.3, 0, TAU); ctx.fillStyle = '#5c9a4a'; ctx.fill();
      }
    }
  }

  function drawRoads(ctx) {
    const T = TR();
    const roads = T?.roadLines?.length ? T.roadLines : (L().roads || []).map((r) => ({ width: r.width || 7, pts: r.points }));
    for (const r of roads) strokeLine(ctx, r.pts, r.width + 1.6, '#8a8475');
    for (const r of roads) strokeLine(ctx, r.pts, r.width, '#4c5056');
    for (const r of roads) strokeLine(ctx, r.pts, r.width - 0.7, 'rgba(236,236,230,0.85)');
    for (const r of roads) strokeLine(ctx, r.pts, r.width - 1.15, '#50555b');
    for (const r of roads) if (r.width >= 6.5) strokeLine(ctx, r.pts, 0.24, '#f3cf4e', [2.6, 2.4]);
  }

  function drawPaths(ctx) {
    const T = TR();
    const paths = T?.pathLines?.length ? T.pathLines : (L().paths || []).map((p) => ({ type: p.type, width: p.width || 2.5, pts: p.points }));
    const STY = {
      stone: ['#9e9583', '#ddd5c5'], dirt: ['#a1825a', '#d2b47f'], wood: ['#5d3e24', '#ab7a4c'], asphalt: ['#3e4246', '#575c62'],
    };
    for (const p of paths) strokeLine(ctx, p.pts, p.width + 0.55, (STY[p.type] || STY.dirt)[0]);
    for (const p of paths) strokeLine(ctx, p.pts, p.width, (STY[p.type] || STY.dirt)[1]);
    // stone slab joints / wood planks
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const p of paths) {
      if (p.type === 'stone') strokeLine(ctx, p.pts, p.width * 0.92, '#a89e8b', [0.12, 1.1]);
      if (p.type === 'wood') strokeLine(ctx, p.pts, p.width * 0.95, '#4a301b', [0.1, 0.45]);
    }
    ctx.restore();
  }

  function drawPlazas(ctx) {
    const pz = L().plaza;
    if (pz) {
      ctx.beginPath(); ctx.arc(pz.x, pz.z, pz.r + 0.9, 0, TAU); ctx.fillStyle = '#9f9686'; ctx.fill();
      const g = ctx.createRadialGradient(pz.x, pz.z, 1, pz.x, pz.z, pz.r);
      g.addColorStop(0, '#e6e1d6'); g.addColorStop(1, '#cfc8b9');
      ctx.beginPath(); ctx.arc(pz.x, pz.z, pz.r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 0.14; ctx.strokeStyle = 'rgba(150,140,124,0.55)';
      for (let r = 2.6; r < pz.r; r += 1.25) { ctx.beginPath(); ctx.arc(pz.x, pz.z, r, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(pz.x, pz.z, 2.3, 0, TAU); ctx.fillStyle = '#f2eee5'; ctx.fill();
      ctx.lineWidth = 0.25; ctx.strokeStyle = '#a99f8e'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(pz.x, pz.z, 1.2, 0.85, 0, 0, TAU); ctx.fillStyle = '#6b4128'; ctx.fill();
    }
    const hp = L().hallPlaza;
    if (hp) {
      rotRect(ctx, hp.x, hp.z, hp.w + 0.8, hp.d + 0.8, 0, '#a49b8b');
      rotRect(ctx, hp.x, hp.z, hp.w, hp.d, 0, '#d8d1c3');
      ctx.lineWidth = 0.08; ctx.strokeStyle = 'rgba(140,130,114,0.5)';
      for (let x = hp.x - hp.w / 2 + 2.4; x < hp.x + hp.w / 2; x += 2.4) { ctx.beginPath(); ctx.moveTo(x, hp.z - hp.d / 2); ctx.lineTo(x, hp.z + hp.d / 2); ctx.stroke(); }
      for (let z = hp.z - hp.d / 2 + 2.4; z < hp.z + hp.d / 2; z += 2.4) { ctx.beginPath(); ctx.moveTo(hp.x - hp.w / 2, z); ctx.lineTo(hp.x + hp.w / 2, z); ctx.stroke(); }
    }
  }

  function drawParking(ctx) {
    const pk = L().parking;
    if (!pk) return;
    ctx.save();
    ctx.translate(pk.x, pk.z); ctx.rotate(-(pk.rot || 0));
    ctx.fillStyle = '#7d7a72'; ctx.fillRect(-pk.w / 2 - 0.6, -pk.d / 2 - 0.6, pk.w + 1.2, pk.d + 1.2);
    ctx.fillStyle = '#56595e'; ctx.fillRect(-pk.w / 2, -pk.d / 2, pk.w, pk.d);
    ctx.strokeStyle = 'rgba(240,240,236,0.85)'; ctx.lineWidth = 0.14;
    const n = Math.max(4, Math.floor(pk.w / 2.6));
    for (let i = 0; i <= n; i++) {
      const x = -pk.w / 2 + (i / n) * pk.w;
      ctx.beginPath(); ctx.moveTo(x, -pk.d / 2); ctx.lineTo(x, -pk.d / 2 + 4.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, pk.d / 2); ctx.lineTo(x, pk.d / 2 - 4.6); ctx.stroke();
    }
    const cols = ['#e8e8e8', '#2f4f7a', '#b8382f', '#d9d4c7', '#3d3f44', '#7a8a96', '#f0f0f0', '#1f2b3a'];
    const r = U.rng('cars');
    for (let i = 0; i < (pk.cars || 6); i++) {
      const slot = Math.floor(r() * n), top = r() < 0.5;
      const x = -pk.w / 2 + ((slot + 0.5) / n) * pk.w, z = top ? -pk.d / 2 + 2.4 : pk.d / 2 - 2.4;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 0.85 + 0.3, z - 2.1 + 0.3, 1.7, 4.2);
      roundRectPath(ctx, x - 0.85, z - 2.1, 1.7, 4.2, 0.45); ctx.fillStyle = cols[i % cols.length]; ctx.fill();
      ctx.fillStyle = 'rgba(40,60,80,0.75)'; ctx.fillRect(x - 0.65, z + (top ? -1.1 : 0.4), 1.3, 0.7);
    }
    ctx.restore();
  }

  function drawDeck(ctx) {
    const d = L().riverDeck;
    if (!d) return;
    rotRect(ctx, d.x, d.z, d.w + 0.4, d.d + 0.4, d.rot, '#5d3e24');
    rotRect(ctx, d.x, d.z, d.w, d.d, d.rot, '#b07f50');
    ctx.save(); ctx.translate(d.x, d.z); ctx.rotate(-(d.rot || 0));
    ctx.strokeStyle = 'rgba(80,50,28,0.5)'; ctx.lineWidth = 0.06;
    for (let x = -d.w / 2 + 0.4; x < d.w / 2; x += 0.4) { ctx.beginPath(); ctx.moveTo(x, -d.d / 2); ctx.lineTo(x, d.d / 2); ctx.stroke(); }
    ctx.restore();
  }

  function jarDot(ctx, x, z, s) {
    ctx.beginPath(); ctx.arc(x + 0.12, z + 0.14, 0.44 * s, 0, TAU); ctx.fillStyle = 'rgba(40,25,15,0.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, z, 0.42 * s, 0, TAU); ctx.fillStyle = '#5a3421'; ctx.fill();
    ctx.beginPath(); ctx.arc(x - 0.1 * s, z - 0.1 * s, 0.2 * s, 0, TAU); ctx.fillStyle = '#8c5a3a'; ctx.fill();
  }

  function drawJangdokdae(ctx) {
    const J = L().jangdokdae;
    if (!J) return;
    const plats = J.platforms || [];
    for (const p of plats) {
      if (p.shape === 'box') {
        rotRect(ctx, p.x + 0.35, p.z + 0.35, p.hw * 2 + 0.9, p.hd * 2 + 0.9, p.rot, 'rgba(30,25,18,0.3)');
        rotRect(ctx, p.x, p.z, p.hw * 2 + 0.9, p.hd * 2 + 0.9, p.rot, '#8f8572');
        rotRect(ctx, p.x, p.z, p.hw * 2, p.hd * 2, p.rot, '#d2c8b4');
      } else if (p.shape === 'circle') {
        ctx.beginPath(); ctx.arc(p.x + 0.5, p.z + 0.5, p.r + 0.4, 0, TAU); ctx.fillStyle = 'rgba(30,25,18,0.3)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.z, p.r + 0.4, 0, TAU); ctx.fillStyle = '#8f8572'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.z, p.r, 0, TAU); ctx.fillStyle = '#d9d0bf'; ctx.fill();
        for (const [rr, col] of [[13.4, '#cfc6b3'], [8.6, '#c8bfac'], [3.3, '#e3dccd']]) {
          ctx.beginPath(); ctx.arc(p.x, p.z, rr, 0, TAU); ctx.fillStyle = col; ctx.fill();
          ctx.lineWidth = 0.22; ctx.strokeStyle = '#a99f8c'; ctx.stroke();
        }
      }
    }
    // ring-field aisles
    const R = J.rings;
    const ring = plats.find((p) => p.shape === 'circle');
    if (R && ring) {
      const aw = R.aisleWidth || 2.6;
      for (let i = 0; i < (R.aisles || 4); i++) {
        const a = (i / (R.aisles || 4)) * TAU;
        ctx.save(); ctx.translate(R.cx, R.cz); ctx.rotate(a);
        ctx.fillStyle = '#ebe5d8'; ctx.fillRect(3.3, -aw / 2 + 0.15, ring.r - 3.3, aw - 0.3);
        ctx.restore();
      }
      // jars on the rings (mirrors the props layout: no jars on the 4 aisles)
      const rr = U.rng('ringjars');
      for (const r of R.radii || []) {
        const n = Math.round((TAU * r) / (R.spacing || 1.3));
        const off = rr() * TAU;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          const px = Math.cos(a) * r, pz = Math.sin(a) * r;
          let blocked = false;
          for (let k = 0; k < (R.aisles || 4); k++) {
            const aa = (k / (R.aisles || 4)) * TAU, dx = Math.cos(aa), dz = Math.sin(aa);
            if (px * dx + pz * dz <= 0) continue;
            if (Math.abs(-px * dz + pz * dx) < aw / 2 + 0.42) { blocked = true; break; }
          }
          if (!blocked) jarDot(ctx, R.cx + px, R.cz + pz, r < 8 ? 0.85 : r < 13 ? 0.95 : 1.05);
        }
      }
      jarDot(ctx, R.cx, R.cz, 2.2);
    }
    // tier-1 rows
    const W = J.rows;
    if (W) {
      const aisle = W.aisleZ || [0, 0];
      const nRows = Math.round((W.x1 - W.x0) / W.step) + 1;
      for (let i = 0; i < nRows; i++) {
        const x = W.x0 + i * W.step;
        for (const [z0, z1] of [[W.z0, aisle[0] - 0.55], [aisle[1] + 0.55, W.z1]]) {
          if (z1 - z0 < 0.8) continue;
          ctx.fillStyle = '#c2bba9'; ctx.fillRect(x - 0.5, z0 - 0.45, 1.0, z1 - z0 + 0.9);
          const n = Math.max(1, Math.round((z1 - z0) / 1.06));
          for (let k = 0; k <= n; k++) jarDot(ctx, x, z0 + ((z1 - z0) * k) / n, 0.95 + i * 0.03);
        }
      }
    }
    for (const j of L().jars || []) jarDot(ctx, j.x, j.z, 1.05);
    for (const j of L().jarDisplays || []) jarDot(ctx, j.x, j.z, 1.1);
  }

  function drawPlots(ctx) {
    const crops = G.data.crops || {};
    for (const p of L().farmPlots || []) {
      const fw = p.w + 0.6, fd = p.d + 0.6;
      rotRect(ctx, p.x + 0.25, p.z + 0.25, fw, fd, 0, 'rgba(25,18,10,0.28)');
      rotRect(ctx, p.x, p.z, fw, fd, 0, '#8a6038');
      rotRect(ctx, p.x, p.z, p.w, p.d, 0, '#6a4a2f');
      // furrows + crops
      const crop = crops[p.crop];
      const leaf = crop?.color || '#6aa443', fruit = crop?.fruit || leaf;
      const rows = Math.max(2, Math.round(p.w / 1.15));
      for (let i = 0; i < rows; i++) {
        const x = p.x - p.w / 2 + (i + 0.5) * (p.w / rows);
        ctx.fillStyle = '#5a3e27'; ctx.fillRect(x - 0.18, p.z - p.d / 2 + 0.3, 0.36, p.d - 0.6);
        if (!crop) continue;
        const n = Math.max(2, Math.round(p.d / 0.95));
        for (let k = 0; k < n; k++) {
          const z = p.z - p.d / 2 + (k + 0.5) * (p.d / n);
          ctx.beginPath(); ctx.arc(x, z, 0.4, 0, TAU); ctx.fillStyle = leaf; ctx.fill();
          if ((i + k) % 3 === 0) { ctx.beginPath(); ctx.arc(x + 0.12, z - 0.1, 0.16, 0, TAU); ctx.fillStyle = fruit; ctx.fill(); }
        }
      }
      ctx.lineWidth = 0.12; ctx.strokeStyle = '#c9a874';
      ctx.strokeRect(p.x - fw / 2 - 0.25, p.z - fd / 2 - 0.25, fw + 0.5, fd + 0.5);
    }
  }

  function drawFlowers(ctx) {
    for (const f of L().flowerBeds || []) {
      ctx.beginPath(); ctx.arc(f.x, f.z, f.r + 0.4, 0, TAU); ctx.fillStyle = '#7a5a3a'; ctx.fill();
      ctx.beginPath(); ctx.arc(f.x, f.z, f.r, 0, TAU); ctx.fillStyle = '#4f8a3a'; ctx.fill();
      const r = U.rng(`fl${f.x},${f.z}`);
      const cols = f.colors || ['#ff7eb6'];
      const n = Math.round(f.r * f.r * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * (f.r - 0.2);
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, 0.22, 0, TAU); ctx.fillStyle = cols[i % cols.length]; ctx.fill();
      }
    }
  }

  function drawWalls(ctx) {
    for (const w of L().stoneWalls || []) strokeLine(ctx, [[w[0], w[1]], [w[2], w[3]]], 0.75, '#8f8778');
    for (const w of L().stoneWalls || []) strokeLine(ctx, [[w[0], w[1]], [w[2], w[3]]], 0.4, '#bdb5a6');
  }

  function drawTrees(ctx) {
    const grp = G.sys.nature?.meshes?.trees;
    const list = [];
    const x0 = BASE.x0 - 4, x1 = BASE.x0 + BASE.size + 4, z0 = BASE.z0 - 4, z1 = BASE.z0 + BASE.size + 4;
    if (grp && grp.children) {
      const col = new THREE.Color();
      for (const mesh of grp.children) {
        if (!mesh.isInstancedMesh || /far/.test(mesh.name || '')) continue;
        const kind = (/trees-(?:campus|slope)-(\w+)/.exec(mesh.name || '') || [])[1] || 'oak';
        const base = KIND_R[kind] || 2.4;
        const arr = mesh.instanceMatrix.array, cols = mesh.instanceColor ? mesh.instanceColor.array : null;
        for (let i = 0; i < mesh.count; i++) {
          const o = i * 16;
          const x = arr[o + 12], z = arr[o + 14];
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          const s = Math.hypot(arr[o], arr[o + 1], arr[o + 2]);
          let fill = '#3f6f35', hi = '#5c8f46';
          if (cols) { col.setRGB(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]); fill = sRGB(col, 1.05); hi = sRGB(col, 1.38); }
          list.push([x, z, base * s, fill, hi]);
        }
      }
    }
    if (!list.length) {
      // no nature module: speckle forest on the mountain slopes
      const T = TR();
      const r = U.rng('mmtrees');
      for (let i = 0; i < 3500; i++) {
        const x = BASE.x0 + r() * BASE.size, z = BASE.z0 + r() * BASE.size;
        const m = T?.mountainMask ? T.mountainMask(x, z) : (Math.max(Math.abs(x), Math.abs(z)) > 120 ? 1 : 0);
        if (m < 0.35 || G.world.isWater(x, z)) continue;
        list.push([x, z, 1.6 + r() * 1.4, r() < 0.5 ? '#2f5a2c' : '#3a6a33', '#4f8a41']);
      }
    }
    // shadows, crowns, highlights (sun from the north-west)
    ctx.fillStyle = 'rgba(12,28,10,0.32)';
    for (const t of list) { ctx.beginPath(); ctx.arc(t[0] + t[2] * 0.42, t[1] + t[2] * 0.42, t[2] * 0.95, 0, TAU); ctx.fill(); }
    for (const t of list) { ctx.beginPath(); ctx.arc(t[0], t[1], t[2], 0, TAU); ctx.fillStyle = t[3]; ctx.fill(); }
    ctx.globalAlpha = 0.55;
    for (const t of list) { ctx.beginPath(); ctx.arc(t[0] - t[2] * 0.28, t[1] - t[2] * 0.3, t[2] * 0.5, 0, TAU); ctx.fillStyle = t[4]; ctx.fill(); }
    ctx.globalAlpha = 1;
    return list.length;
  }

  function drawRoof(ctx, b) {
    const type = b.type;
    const w = b.w, d = b.d;
    const shadowOff = type === 'hall' ? 3.2 : type === 'pavilion' || type === 'gate' || type === 'stall' ? 0.9 : 1.4;
    ctx.save();
    ctx.translate(b.x, b.z);
    // shadow (unrotated offset towards the south-east)
    ctx.save();
    ctx.translate(shadowOff, shadowOff);
    ctx.rotate(-(b.rot || 0));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    if (type === 'thatched') { roundRectPath(ctx, -w / 2 - 0.6, -d / 2 - 0.6, w + 1.2, d + 1.2, 2.2); ctx.fill(); }
    else ctx.fillRect(-w / 2 - 0.8, -d / 2 - 0.9, w + 1.6, d + 1.8);
    ctx.restore();
    ctx.rotate(-(b.rot || 0));
    const tiles = (x0, y0, ww, hh, base, line, ridge, ridgeHi) => {
      ctx.fillStyle = base; ctx.fillRect(x0, y0, ww, hh);
      ctx.strokeStyle = line; ctx.lineWidth = 0.09;
      for (let x = x0 + 0.45; x < x0 + ww; x += 0.45) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + hh); ctx.stroke(); }
      // eave shading (outer edge darker) + ridge along local X
      const g = ctx.createLinearGradient(0, y0, 0, y0 + hh);
      g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g; ctx.fillRect(x0, y0, ww, hh);
      ctx.fillStyle = ridge; ctx.fillRect(x0 + ww * 0.12, y0 + hh / 2 - 0.32, ww * 0.76, 0.64);
      ctx.fillStyle = ridgeHi; ctx.fillRect(x0 + ww * 0.12, y0 + hh / 2 - 0.1, ww * 0.76, 0.2);
      ctx.lineWidth = 0.12; ctx.strokeStyle = 'rgba(20,20,24,0.65)'; ctx.strokeRect(x0, y0, ww, hh);
    };
    if (type === 'hall') {
      // glass + stone podium, three stacked giwa roofs
      ctx.fillStyle = '#8f8a80'; ctx.fillRect(-w / 2 - 1, -d / 2 - 1, w + 2, d + 2);
      ctx.fillStyle = '#86b3cf'; ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.12;
      for (let x = -w / 2 + 2; x < w / 2; x += 2) { ctx.beginPath(); ctx.moveTo(x, -d / 2); ctx.lineTo(x, d / 2); ctx.stroke(); }
      tiles(-w * 0.44, -d * 0.36, w * 0.88, d * 0.72, '#454b53', 'rgba(25,28,33,0.5)', '#2b2f35', '#d8d2c4');
      tiles(-w * 0.3, -d * 0.2, w * 0.6, d * 0.4, '#3c4148', 'rgba(25,28,33,0.5)', '#262a2f', '#e2dccf');
      // front portico
      tiles(-6, d / 2 - 1.6, 12, 4.6, '#41464d', 'rgba(25,28,33,0.5)', '#292d32', '#d8d2c4');
    } else if (type === 'thatched') {
      roundRectPath(ctx, -w / 2 - 0.7, -d / 2 - 0.7, w + 1.4, d + 1.4, 2.4);
      const g = ctx.createLinearGradient(0, -d / 2, 0, d / 2);
      g.addColorStop(0, '#b38f4f'); g.addColorStop(0.5, '#d8b672'); g.addColorStop(1, '#9e7b40');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(110,80,40,0.45)'; ctx.lineWidth = 0.08;
      for (let x = -w / 2; x < w / 2; x += 0.35) { ctx.beginPath(); ctx.moveTo(x, -d / 2 - 0.5); ctx.lineTo(x + 0.2, d / 2 + 0.5); ctx.stroke(); }
      ctx.fillStyle = '#8a6a36'; ctx.fillRect(-w / 2 + 0.6, -0.3, w - 1.2, 0.6);
    } else if (type === 'pavilion') {
      const s = Math.max(w, d) + 1.6;
      ctx.fillStyle = '#9b8f7a'; ctx.fillRect(-w / 2 - 0.4, -d / 2 - 0.4, w + 0.8, d + 0.8);
      ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath();
      ctx.fillStyle = '#464b52'; ctx.fill();
      ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = 0.28;
      ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 0.6, 0, TAU); ctx.fillStyle = '#2a2d31'; ctx.fill();
    } else if (type === 'gate') {
      ctx.fillStyle = '#7a6a58'; ctx.fillRect(-w / 2, -0.6, w, 1.2);
      tiles(-w / 2 - 0.8, -d / 2 - 0.8, w + 1.6, d + 1.6, '#41464d', 'rgba(25,28,33,0.5)', '#292d32', '#d8d2c4');
      tiles(-2.8, -d / 2 - 1.1, 5.6, d + 2.2, '#3a3f45', 'rgba(25,28,33,0.5)', '#24272c', '#e2dccf');
    } else if (type === 'stall') {
      const n = 8;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#f3efe4' : '#cf4a3f'; ctx.fillRect(-w / 2 - 0.4 + (i * (w + 0.8)) / n, -d / 2 - 0.5, (w + 0.8) / n, d + 1); }
      ctx.strokeStyle = 'rgba(60,20,15,0.6)'; ctx.lineWidth = 0.12; ctx.strokeRect(-w / 2 - 0.4, -d / 2 - 0.5, w + 0.8, d + 1);
    } else if (type === 'storage') {
      tiles(-w / 2 - 0.9, -d / 2 - 1.1, w + 1.8, d + 2.2, '#5d554d', 'rgba(30,24,20,0.5)', '#3c352f', '#cfc8b8');
    } else {
      // hanok / classroom
      tiles(-w / 2 - 1.1, -d / 2 - 1.3, w + 2.2, d + 2.6, '#4a5058', 'rgba(25,28,33,0.5)', '#2e3238', '#ddd7c9');
    }
    ctx.restore();
  }

  function renderBase() {
    const N = BASE.size * BASE.ppm;
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const ctx = cv.getContext('2d');
    const t0 = performance.now();
    ctx.fillStyle = BG_FOREST; ctx.fillRect(0, 0, N, N);
    try { drawTerrainRaster(ctx, N); } catch (e) { G.log.warn('UI', 'minimap terrain raster failed', e); }
    ctx.save();
    ctx.scale(BASE.ppm, BASE.ppm);
    ctx.translate(-BASE.x0, -BASE.z0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    let trees = 0;
    const steps = [
      ['water', () => drawWater(ctx)], ['roads', () => drawRoads(ctx)], ['paths', () => drawPaths(ctx)], ['plazas', () => drawPlazas(ctx)],
      ['parking', () => drawParking(ctx)], ['deck', () => drawDeck(ctx)], ['jangdokdae', () => drawJangdokdae(ctx)], ['plots', () => drawPlots(ctx)],
      ['flowers', () => drawFlowers(ctx)], ['walls', () => drawWalls(ctx)], ['trees', () => { trees = drawTrees(ctx); }],
      ['buildings', () => { for (const b of L().buildings || []) drawRoof(ctx, b); }],
    ];
    for (const [name, fn] of steps) {
      ctx.save();
      try { fn(); } catch (e) { G.log.warn('UI', `minimap layer "${name}" failed`, e); }
      ctx.restore();
    }
    ctx.restore();
    G.log.info('UI', `minimap base ${N}px rendered in ${Math.round(performance.now() - t0)}ms (${trees} trees)`);
    return cv;
  }

  /** draw the part of the base map visible in a view centred on (cx, cz) with `scale` px per metre */
  function blitBase(ctx, base, cx, cz, scale, W, H) {
    ctx.fillStyle = BG_FOREST;
    ctx.fillRect(0, 0, W, H);
    if (!base) return;
    const wx0 = cx - W / 2 / scale, wz0 = cz - H / 2 / scale, wx1 = cx + W / 2 / scale, wz1 = cz + H / 2 / scale;
    const bx0 = Math.max(wx0, BASE.x0), bz0 = Math.max(wz0, BASE.z0);
    const bx1 = Math.min(wx1, BASE.x0 + BASE.size), bz1 = Math.min(wz1, BASE.z0 + BASE.size);
    if (bx1 <= bx0 || bz1 <= bz0) return;
    const p = BASE.ppm;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = scale > p ? 'high' : 'medium';
    ctx.drawImage(base, (bx0 - BASE.x0) * p, (bz0 - BASE.z0) * p, (bx1 - bx0) * p, (bz1 - bz0) * p,
      (bx0 - wx0) * scale, (bz0 - wz0) * scale, (bx1 - bx0) * scale, (bz1 - bz0) * scale);
  }

  // =============================================================== marker glyphs (shared by minimap + world map)
  function drawPlayerArrow(ctx, x, y, rotY, s) {
    ctx.save();
    ctx.translate(x, y);
    // soft pulse ring
    ctx.beginPath(); ctx.arc(0, 0, 11 * s, 0, TAU); ctx.fillStyle = 'rgba(74,168,255,0.22)'; ctx.fill();
    ctx.rotate(PI - rotY);
    ctx.beginPath();
    ctx.moveTo(0, -8.5 * s); ctx.lineTo(6.2 * s, 6.5 * s); ctx.lineTo(0, 3.4 * s); ctx.lineTo(-6.2 * s, 6.5 * s); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4 * s;
    ctx.fillStyle = '#2f8cff'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.8 * s; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  function drawViewCone(ctx, x, y, fx, fz, s) {
    const a = Math.atan2(fz, fx);
    const R = 34 * s;
    const g = ctx.createRadialGradient(x, y, 2 * s, x, y, R);
    g.addColorStop(0, 'rgba(120,190,255,0.42)'); g.addColorStop(1, 'rgba(120,190,255,0)');
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, R, a - 0.62, a + 0.62); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }
  function drawNpc(ctx, x, y, s, marker) {
    ctx.beginPath(); ctx.arc(x, y, 5.6 * s, 0, TAU);
    ctx.fillStyle = '#f4c54a'; ctx.fill();
    ctx.lineWidth = 1.5 * s; ctx.strokeStyle = '#4a3300'; ctx.stroke();
    ctx.fillStyle = '#4a3300';
    ctx.beginPath(); ctx.arc(x, y - 1.6 * s, 1.6 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y + 2.4 * s, 2.7 * s, 1.7 * s, 0, PI, TAU); ctx.fill();
    if (marker) {
      const by = y - 11 * s;
      ctx.beginPath(); ctx.arc(x, by, 4.4 * s, 0, TAU); ctx.fillStyle = marker === '?' ? '#ffe27a' : '#ffd23f'; ctx.fill();
      ctx.lineWidth = 1.2 * s; ctx.strokeStyle = '#5a3d00'; ctx.stroke();
      ctx.fillStyle = '#3a2800'; ctx.font = `800 ${Math.round(7 * s)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(marker, x, by + 0.4 * s);
    }
  }
  function drawOther(ctx, x, y, s) {
    ctx.beginPath(); ctx.arc(x, y, 4 * s, 0, TAU);
    ctx.fillStyle = '#8fd0ff'; ctx.fill();
    ctx.lineWidth = 1.4 * s; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  }
  function drawDiamond(ctx, x, y, s, t, primary) {
    const k = 1 + Math.sin(t * 4) * 0.12;
    const r = (primary ? 7 : 5.5) * s * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(244,197,74,0.85)'; ctx.shadowBlur = 8 * s;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.75, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.75, 0); ctx.closePath();
    ctx.fillStyle = primary ? '#ffd23f' : '#f6c94e'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.4 * s; ctx.strokeStyle = '#5a3d00'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.38, 0); ctx.lineTo(0, r * 0.1); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
    ctx.restore();
  }
  function drawEdgeArrow(ctx, x, y, ang, s) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(9 * s, 0); ctx.lineTo(-3 * s, -6 * s); ctx.lineTo(-1 * s, 0); ctx.lineTo(-3 * s, 6 * s); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.lineWidth = 1.2 * s; ctx.strokeStyle = '#5a3d00'; ctx.stroke();
    ctx.restore();
  }
  function drawCamera(ctx, x, y, s) {
    ctx.beginPath(); ctx.arc(x, y, 6 * s, 0, TAU);
    ctx.fillStyle = 'rgba(28,36,32,0.88)'; ctx.fill();
    ctx.lineWidth = 1.2 * s; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, x - 3.4 * s, y - 2 * s, 6.8 * s, 4.6 * s, 1 * s); ctx.fill();
    ctx.fillRect(x - 1.3 * s, y - 3.1 * s, 2.6 * s, 1.4 * s);
    ctx.beginPath(); ctx.arc(x, y + 0.3 * s, 1.35 * s, 0, TAU); ctx.fillStyle = 'rgba(28,36,32,0.95)'; ctx.fill();
  }
  function drawMyJar(ctx, x, y, s, t) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9 * s);
    g.addColorStop(0, `rgba(255,214,90,${0.55 + Math.sin(t * 3) * 0.15})`); g.addColorStop(1, 'rgba(255,214,90,0)');
    ctx.beginPath(); ctx.arc(x, y, 9 * s, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 2 * s, y - 4 * s); ctx.lineTo(x + 2 * s, y - 4 * s);
    ctx.quadraticCurveTo(x + 5 * s, y - 1 * s, x + 3 * s, y + 4 * s); ctx.lineTo(x - 3 * s, y + 4 * s);
    ctx.quadraticCurveTo(x - 5 * s, y - 1 * s, x - 2 * s, y - 4 * s); ctx.closePath();
    ctx.fillStyle = '#7a4a2c'; ctx.fill();
    ctx.lineWidth = 1.1 * s; ctx.strokeStyle = '#ffd766'; ctx.stroke();
  }

  /** iterate other players (G.sys.social.others is a Map or object of records) */
  function eachOther(fn) {
    const o = G.sys.social?.others;
    if (!o) return;
    const vals = typeof o.values === 'function' ? o.values() : Array.isArray(o) ? o : Object.values(o);
    for (const r of vals) {
      if (!r) continue;
      const p = r.position || r.group?.position || r.pos || r;
      const x = Number(p.x), z = Number(p.z);
      if (Number.isFinite(x) && Number.isFinite(z)) fn(x, z, r);
    }
  }
  function questMarkers() {
    try { const m = G.sys.quest?.getMarkers?.(); return Array.isArray(m) ? m : []; } catch (e) { return []; }
  }

  // =============================================================== the system
  const MM = {
    name: 'minimap', order: 70, label: '지도',
    currentZone: null, currentPoi: null,
    base: null,
    visible: true, collapsed: false, zoom: DEFAULT_ZOOM,
    _detT: 0, _drawT: 0, _clockT: 0, _initialPending: false, _bannerAt: {},
    _canvas: null, _ctx: null, _dpr: 1, _W: 0, _H: 0,
    _wm: null, _travel: null, _pickOpen: false,

    init() {
      this.zoom = clamp(parseInt(lsGet(LS_ZOOM, DEFAULT_ZOOM), 10) || DEFAULT_ZOOM, 0, ZOOMS.length - 1);
      this.collapsed = lsGet(LS_COLLAPSED, '0') === '1';
      this.visible = G.settings.minimapVisible !== false;
      this.base = renderBase();
      this._setupPanel();
      this._applyPanelState();
      this._setZoom(this.zoom);

      G.ui.onAction('minimap', () => this.toggle());
      G.ui.onAction('minimap-collapse', () => this.setCollapsed(!this.collapsed));
      G.ui.onAction('minimap-close', () => this.setVisible(false, true));
      G.ui.onAction('minimap-zoom-in', () => this.zoomIn());
      G.ui.onAction('minimap-zoom-out', () => this.zoomOut());
      G.ui.onAction('move', () => this.openFastTravel());
      G.input?.onKey?.('KeyM', () => {
        if (!G.state) return false;
        const m = G.ui.modal.get('world-map') || G.ui.modal.get('easy-where');
        if (m) { m.close(); return true; }
        if (G.ui.isBlocking()) return false;
        this.openWorldMap();
        return true;
      }, { allowInModal: true });
      G.bus.on('settings:changed', ({ key }) => { if (key === 'minimapVisible') { this.visible = G.settings.minimapVisible !== false; this._applyPanelState(); } });
      G.bus.on('player:moved', () => { this._drawT = 1; });
      G.bus.on('easy:changed', () => {
        this._setZoneLabel(this.currentZone);
        this._setZoom(this.zoom);
        this._drawT = 1;
        // the grown-up world map is not part of the kid flow (and the picture menu is not part of the adult one)
        if (easyOn()) G.ui.modal.get('world-map')?.close();
      });
    },

    onStateLoaded(state) {
      this.currentZone = null;
      this.currentPoi = null;
      if (state) {
        if (!state.visited || typeof state.visited !== 'object' || Array.isArray(state.visited)) state.visited = {};
        if (!state.poisVisited || typeof state.poisVisited !== 'object' || Array.isArray(state.poisVisited)) state.poisVisited = {};
      }
      this._initialPending = true;   // detect on the next tick (after every system loaded its state)
      this._drawT = 1;
    },

    onLogout() {
      this.currentZone = null;
      this.currentPoi = null;
      this._initialPending = false;
      this._wm?.m?.close?.();
      G.ui.modal.get('easy-where')?.close?.();
      this._setZoneLabel(null);
    },

    update(dt, t) {
      // zone / poi detection (4x per second)
      this._detT += dt;
      if (this._initialPending || this._detT >= 0.25) {
        this._detT = 0;
        try { this._detect(this._initialPending); } catch (e) { G.log.error('UI', 'zone detection failed', e); }
      }
      // minimap redraw (~15 fps while visible)
      this._drawT += dt;
      if (this._drawT >= 1 / 15 && this.visible && !this.collapsed && !this._hudOff()) {
        this._drawT = 0;
        this._draw(t);
      }
      this._clockT -= dt;
      if (this._clockT <= 0) { this._clockT = 0.5; this._updateClock(); }
    },

    _hudOff() {
      const hud = this._hud || (this._hud = document.getElementById('hud'));
      return !hud || hud.hidden || document.body.classList.contains('hud-hidden');
    },

    // ------------------------------------------------------------ panel
    _setupPanel() {
      const panel = document.getElementById('minimap-panel');
      const canvas = document.getElementById('minimap-canvas');
      if (!panel || !canvas) return;
      this._panel = panel;
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      canvas.title = '클릭하면 전체 지도가 열려요 (M)';
      canvas.setAttribute('role', 'button');
      canvas.setAttribute('aria-label', '미니맵 — 클릭하면 전체 지도 열기');
      canvas.tabIndex = 0;
      canvas.addEventListener('click', (ev) => { if (!G.state) return; if (easyOn()) this._easyTap(ev); else this.openWorldMap(); });
      canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (G.state) this.openWorldMap(); } });
      const wrap = panel.querySelector('.minimap-wrap');
      if (wrap && !wrap.querySelector('.mm-zone')) {
        wrap.appendChild(G.ui.h('div', { class: 'mm-zone', 'aria-live': 'polite' }, G.ui.h('span', { class: 'ico ico-xs', 'data-icon': 'pin' }), G.ui.h('b', null, '')));
        wrap.appendChild(G.ui.h('div', { class: 'mm-compass', 'aria-hidden': 'true' }, G.ui.h('i'), G.ui.h('span', null, 'N')));
        wrap.appendChild(G.ui.h('div', { class: 'mm-clock', title: '게임 시간' }, G.ui.h('span', { class: 'ico ico-xs', 'data-icon': 'clock' }), G.ui.h('b', null, '')));
        wrap.appendChild(G.ui.h('div', { class: 'mm-scale', 'aria-hidden': 'true' }, G.ui.h('i'), G.ui.h('span', null, '')));
      }
      this._zoneEl = wrap?.querySelector('.mm-zone b');
      this._clockEl = wrap?.querySelector('.mm-clock b');
      this._clockIco = wrap?.querySelector('.mm-clock .ico');
      this._scaleEl = wrap?.querySelector('.mm-scale');
      const resize = () => this._resizeCanvas();
      if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(resize); this._ro.observe(canvas); }
      window.addEventListener('resize', resize);
      this._resizeCanvas();
    },

    _resizeCanvas() {
      const c = this._canvas;
      if (!c) return;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = Math.round(c.clientWidth || 272), h = Math.round(c.clientHeight || (w * 196) / 272);
      if (!w || !h) return;
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      this._dpr = dpr; this._W = W; this._H = H;
      this._drawT = 1;
      this._updateScaleBar();
    },

    _applyPanelState() {
      const p = this._panel || document.getElementById('minimap-panel');
      if (!p) return;
      p.hidden = !this.visible;
      p.classList.toggle('collapsed', this.collapsed);
      const btn = p.querySelector('[data-action="minimap-collapse"]');
      if (btn) {
        const ico = btn.querySelector('.ico');
        if (ico) G.ui.setIcon(ico, this.collapsed ? 'plus' : 'minus');
        btn.title = this.collapsed ? '펼치기' : '접기';
        btn.setAttribute('aria-label', this.collapsed ? '미니맵 펼치기' : '미니맵 접기');
        btn.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
      }
      G.ui.setActive('minimap', this.visible);
      if (this.visible && !this.collapsed) setTimeout(() => this._resizeCanvas(), 0);
    },
    setVisible(v, fromClose) {
      v = !!v;
      if (v && this.collapsed) { this.collapsed = false; lsSet(LS_COLLAPSED, '0'); }
      this.visible = v;
      if ((G.settings.minimapVisible !== false) !== v) G.setSetting('minimapVisible', v);
      this._applyPanelState();
      if (!v && fromClose && lsGet(LS_CLOSE_HINT, '0') !== '1') {
        lsSet(LS_CLOSE_HINT, '1');
        G.ui.toast('미니맵을 닫았어요. 왼쪽 메뉴의 ‘미니맵’ 버튼으로 다시 열 수 있어요.', { type: 'info', icon: 'map' });
      }
    },
    toggle() { this.setVisible(!this.visible); },
    setCollapsed(c) { this.collapsed = !!c; lsSet(LS_COLLAPSED, this.collapsed ? '1' : '0'); this._applyPanelState(); },
    zoomIn() { this._setZoom(this.zoom - 1); },
    zoomOut() { this._setZoom(this.zoom + 1); },
    _setZoom(z) {
      z = clamp(z, 0, ZOOMS.length - 1);
      this.zoom = z;
      lsSet(LS_ZOOM, z);
      this._drawT = 1;
      this._updateScaleBar();
      const p = this._panel;
      p?.querySelector('[data-action="minimap-zoom-in"]')?.toggleAttribute('disabled', z === 0);
      p?.querySelector('[data-action="minimap-zoom-out"]')?.toggleAttribute('disabled', z === ZOOMS.length - 1);
    },
    /** zoom level actually drawn: a fixed kid-friendly overview in easy mode (the adult zoom is kept) */
    _zoomIdx() { return easyOn() ? EASY_ZOOM : this.zoom; },
    _updateScaleBar() {
      const el = this._scaleEl;
      if (!el || !this._W) return;
      const meters = ZOOMS[this._zoomIdx()];
      const cssW = this._W / this._dpr;
      const step = meters <= 60 ? 10 : meters <= 130 ? 20 : 50;
      el.querySelector('i').style.width = `${(step / meters) * cssW}px`;
      el.querySelector('span').textContent = `${step} m`;
    },
    _updateClock() {
      const w = G.sys.weather;
      if (!this._clockEl) return;
      if (!w || typeof w.timeString !== 'function') { this._clockEl.parentElement.hidden = true; return; }
      const txt = w.timeString();
      if (this._clockEl.textContent !== txt) this._clockEl.textContent = txt;
      const night = (w.nightFactor || 0) > 0.55;
      if (this._clockIco && this._clockIco.dataset.iconDone !== (night ? 'moon' : 'sun')) G.ui.setIcon(this._clockIco, night ? 'moon' : 'sun');
    },
    _setZoneLabel(zone) {
      if (!this._zoneEl) return;
      this._zoneEl.textContent = zone ? (easyOn() ? `${ZONE_EMOJI[zone.id] || '📍'} ${zone.short || zone.name}` : zone.name) : '';
      this._zoneEl.parentElement.style.setProperty('--zc', zone?.color || '#9aa88f');
      this._zoneEl.parentElement.hidden = !zone;
    },

    // ------------------------------------------------------------ detection
    _detect(initial) {
      const p = G.sys.player;
      if (!G.state || !p || !p.position || p._ready === false) return;
      this._initialPending = false;
      const x = p.position.x, z = p.position.z;
      let zone = G.world.zoneAt(x, z);
      const cur = this.currentZone;
      if (cur && zone !== cur && cur.r > 0 && !initial) {
        const d = Math.hypot(x - cur.center[0], z - cur.center[1]);
        if (d <= cur.r + 1.5 && (!(zone.r > 0) || zone.r >= cur.r)) zone = cur; // hysteresis (still allow entering a smaller zone)
      }
      if (zone !== cur) this._enterZone(zone, cur, initial);
      // points of interest
      let poi = G.world.poiAt(x, z);
      const cp = this.currentPoi;
      if (cp && poi !== cp && Math.hypot(x - cp.x, z - cp.z) <= cp.r + 1) poi = cp;
      if (poi !== cp) {
        this.currentPoi = poi || null;
        if (poi) {
          const st = G.state.poisVisited || (G.state.poisVisited = {});
          const first = !st[poi.id];
          if (first) { st[poi.id] = G.time.now(); G.dirty('poi'); }
          G.bus.emit('poi:enter', { poiId: poi.id, poi, first });
          if (first && !initial) G.ui.toast(`${poi.name} 발견!`, { type: 'success', icon: poi.icon || 'pin', sound: false, duration: 2400 });
        }
      }
    },

    _enterZone(zone, prev, initial) {
      if (prev) G.bus.emit('zone:exit', { zoneId: prev.id, zone: prev, first: false });
      const real = zone && zone.r > 0 && zone.id !== G.data.defaultZone?.id;
      let first = false;
      if (real) {
        const v = G.state.visited || (G.state.visited = {});
        if (!v[zone.id]) { v[zone.id] = G.time.now(); first = true; G.dirty('visit'); }
      }
      this.currentZone = zone;
      if (G.state.player) G.state.player.zoneId = zone.id;
      this._setZoneLabel(zone);
      G.bus.emit('zone:enter', { zoneId: zone.id, zone, first });
      if (real) {
        const now = performance.now();
        if (initial || first || !this._bannerAt[zone.id] || now - this._bannerAt[zone.id] > 6000) {
          this._bannerAt[zone.id] = now;
          G.ui.zoneBanner(zone.name, first && !initial ? '새로운 구역 발견!' : '현재 위치');
        }
      }
      if (this._wm && !this._wm.m.closed) this._wmRenderCard();
      G.log.debug('UI', `zone -> ${zone.id}${first ? ' (first visit)' : ''}`);
    },

    /** re-render the base map (e.g. after the world layout changed) */
    redrawBase() { this.base = renderBase(); this._drawT = 1; if (this._wm) this._wm.dirty = true; return this.base; },

    // ------------------------------------------------------------ helpers
    worldToMap(x, z) {
      const u = (x - BASE.x0) / BASE.size, v = (z - BASE.z0) / BASE.size;
      return { x: u * BASE.size * BASE.ppm, y: v * BASE.size * BASE.ppm, u, v };
    },
    zoneStatus(id) {
      const v = G.state?.visited?.[id];
      return { visited: !!v, at: v || null, current: this.currentZone?.id === id };
    },

    // ------------------------------------------------------------ minimap drawing
    _draw(t) {
      const ctx = this._ctx;
      if (!ctx || !this._W) return;
      const W = this._W, H = this._H, s = this._dpr;
      const pl = G.sys.player;
      const hasP = !!(pl && pl.position && G.state);
      const cx = hasP ? pl.position.x : 0, cz = hasP ? pl.position.z : 0;
      const easy = easyOn();
      const meters = ZOOMS[this._zoomIdx()];
      const scale = W / meters;
      const big = easy ? 1.45 : 1;      // bigger, chunkier markers for small fingers / eyes
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      blitBase(ctx, this.base, cx, cz, scale, W, H);
      const X = (x) => (x - cx) * scale + W / 2, Y = (z) => (z - cz) * scale + H / 2;
      const inView = (px, py, m = 0) => px >= -m && px <= W + m && py >= -m && py <= H + m;
      // night tint
      const nf = G.world.nightFactor || 0;
      if (nf > 0.02) { ctx.fillStyle = `rgba(8,16,40,${nf * 0.32})`; ctx.fillRect(0, 0, W, H); }
      // current zone boundary
      const zn = this.currentZone;
      if (zn && zn.r > 0) {
        ctx.beginPath(); ctx.arc(X(zn.center[0]), Y(zn.center[1]), zn.r * scale, 0, TAU);
        ctx.setLineDash([5 * s, 4 * s]); ctx.lineWidth = 1.6 * s; ctx.strokeStyle = rgba(zn.color || '#ffffff', 0.85); ctx.stroke(); ctx.setLineDash([]);
      }
      // easy mode: a big picture badge per zone (tap it to go there)
      if (easy) this._drawZoneBadges(ctx, X, Y, inView, s, zn);
      // photo zones + my jar (when zoomed in)
      if (meters <= 180) {
        if (!easy) for (const pz of L().photoZones || []) { const px = X(pz.x), py = Y(pz.z); if (inView(px, py, 10)) drawCamera(ctx, px, py, s * 0.95); }
        const j1 = L().get?.('J1');
        if (j1) { const px = X(j1.x), py = Y(j1.z); if (inView(px, py, 10)) drawMyJar(ctx, px, py, s * big, t); }
      }
      // other players
      eachOther((x, z) => { const px = X(x), py = Y(z); if (inView(px, py, 6)) drawOther(ctx, px, py, s * (easy ? 1.15 : 1)); });
      // NPCs
      const npcs = G.sys.npc?.list?.() || [];
      for (const r of npcs) {
        const p = r.position || r.group?.position;
        if (!p) continue;
        const px = X(p.x), py = Y(p.z);
        if (inView(px, py, 8)) drawNpc(ctx, px, py, s * big, r.marker || null);
      }
      // quest markers (clamped to the edge with an arrow when outside)
      const pad = 12 * s;
      for (const m of questMarkers()) {
        if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
        let px = X(m.x), py = Y(m.z);
        if (inView(px, py, -pad * 0.4)) drawDiamond(ctx, px, py, s * big, t, !!m.primary);
        else {
          const dx = px - W / 2, dy = py - H / 2;
          const k = Math.min((W / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (H / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
          px = W / 2 + dx * k; py = H / 2 + dy * k;
          drawEdgeArrow(ctx, px, py, Math.atan2(dy, dx), s * big * (m.primary ? 1.05 : 0.85));
        }
      }
      // player + view cone
      if (hasP) {
        const b = G.sys.camera?.getMoveBasis?.();
        if (b) drawViewCone(ctx, W / 2, H / 2, b.forward.x, b.forward.z, s * big);
        drawPlayerArrow(ctx, W / 2, H / 2, Number.isFinite(pl.rotY) ? pl.rotY : 0, s * big);
      }
    },

    /** easy minimap: round picture badges at the zone centres (the current zone gets a soft gold halo) */
    _drawZoneBadges(ctx, X, Y, inView, s, here) {
      const R = 12.5 * s;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(15 * s)}px ${EMOJI_FONT}`;
      for (const z of zones()) {
        if (!(z.r > 0)) continue;
        const px = X(z.center[0]), py = Y(z.center[1]);
        if (!inView(px, py, R)) continue;
        const cur = here && here.id === z.id;
        ctx.globalAlpha = cur ? 0.55 : 0.95;
        ctx.beginPath(); ctx.arc(px, py + 1.5 * s, R, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, R, 0, TAU); ctx.fillStyle = rgba(z.color || '#ffffff', 0.92); ctx.fill();
        ctx.lineWidth = 2 * s; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.globalAlpha = cur ? 0.7 : 1;
        ctx.fillStyle = '#000';
        ctx.fillText(ZONE_EMOJI[z.id] || '📍', px, py + 1 * s);
      }
      ctx.restore();
    },

    /** easy minimap tap: a zone (or its badge) under the finger -> go there; otherwise the picture menu */
    _easyTap(ev) {
      const c = this._canvas;
      const pl = G.sys.player;
      if (!c || !this._W || !pl?.position) { this.openPictureTravel(); return; }
      const r = c.getBoundingClientRect();
      if (!(r.width > 0)) { this.openPictureTravel(); return; }
      const dpr = this._W / r.width;
      const scale = this._W / ZOOMS[this._zoomIdx()];
      const wx = pl.position.x + ((ev.clientX - r.left) * dpr - this._W / 2) / scale;
      const wz = pl.position.z + ((ev.clientY - r.top) * dpr - this._H / 2) / scale;
      if (!Number.isFinite(wx) || !Number.isFinite(wz)) { this.openPictureTravel(); return; }
      const badgeR = (16 * this._dpr) / scale; // the badge radius in metres (+ a little slack for small fingers)
      let best = null, bd = Infinity;
      for (const z of zones()) {
        if (!(z.r > 0)) continue;
        const d = Math.hypot(wx - z.center[0], wz - z.center[1]);
        const hit = d <= badgeR * 1.25 ? -1 : d <= z.r ? d / z.r : Infinity;
        if (hit < bd) { bd = hit; best = z; }
      }
      if (!best || best.id === this.currentZone?.id) { this.openPictureTravel(); return; }
      G.sfx('click');
      this.travelTo(best.id);
    },

    // ============================================================ world map
    openWorldMap(opts = {}) {
      opts = opts && typeof opts === 'object' ? opts : {};
      // kid flow: the picture menu (fire and forget: callers awaiting a modal action must not wait for the whole trip)
      if (easyOn() && !opts.full) { this.openPictureTravel(); return null; }
      if (!G.state) return null;
      if (G.sys.photo?.active) G.sys.photo.exit?.();
      const ex = G.ui.modal.get('world-map');
      if (ex) { if (opts.zoneId) this._wmSelect(opts.zoneId); return ex; }
      const h = G.ui.h;
      const cur = this.currentZone;
      const headChip = h('span', { class: 'chip chip-green wm-here' }, h('span', { class: 'ico ico-xs', 'data-icon': 'pin' }), cur && cur.r > 0 ? cur.name : (cur?.name || '체험관'));
      const st = { m: null, view: { ...WORLD_VIEW }, sel: opts.zoneId || null, hover: null, raf: 0, last: 0, dirty: true, drag: null, font: getComputedStyle(document.body).fontFamily || 'sans-serif' };
      this._wm = st;
      const m = G.ui.modal.open({
        id: 'world-map', size: 'xl', className: 'wm-modal', title: '전체 지도', icon: 'map', headExtra: headChip,
        body: (body) => this._wmBuild(body, st),
        actions: [],
        onClose: () => { cancelAnimationFrame(st.raf); st.ro?.disconnect?.(); if (this._wm === st) this._wm = null; },
      });
      st.m = m;
      this._wmRenderCard();
      this._wmResize();
      const loop = (now) => {
        if (m.closed) return;
        st.raf = requestAnimationFrame(loop);
        if (st.dirty || now - st.last > 160) { st.last = now; st.dirty = false; this._wmDraw(now / 1000); }
      };
      st.raf = requestAnimationFrame(loop);
      G.log.info('UI', 'world map opened');
      return m;
    },

    _wmBuild(body, st) {
      const h = G.ui.h;
      const zs = zones();
      const chips = zs.map((z, i) => {
        const b = h('button', { type: 'button', class: 'wm-chip', dataset: { zone: z.id }, title: z.name },
          h('span', { class: 'wm-chip-num' }, String(i + 1)),
          h('span', { class: 'wm-chip-name' }, z.short || z.name),
          h('span', { class: 'wm-chip-check ico ico-xs', 'data-icon': 'check' }));
        b.style.setProperty('--c', z.color || '#34c36b');
        return b;
      });
      const canvas = h('canvas', { class: 'wm-canvas', 'aria-label': '전통발효체험관 전체 지도' });
      const mapbox = h('div', { class: 'wm-mapbox' },
        canvas,
        h('div', { class: 'wm-chips' }, chips),
        h('div', { class: 'wm-tools' },
          h('button', { type: 'button', class: 'icon-btn', dataset: { wm: 'in' }, title: '확대', 'aria-label': '확대' }, h('span', { class: 'ico ico-sm', 'data-icon': 'plus' })),
          h('button', { type: 'button', class: 'icon-btn', dataset: { wm: 'out' }, title: '축소', 'aria-label': '축소' }, h('span', { class: 'ico ico-sm', 'data-icon': 'minus' })),
          h('button', { type: 'button', class: 'icon-btn', dataset: { wm: 'me' }, title: '내 위치로', 'aria-label': '내 위치로' }, h('span', { class: 'ico ico-sm', 'data-icon': 'target' })),
          h('button', { type: 'button', class: 'icon-btn', dataset: { wm: 'fit' }, title: '전체 보기', 'aria-label': '전체 보기' }, h('span', { class: 'ico ico-sm', 'data-icon': 'expand' }))),
        h('div', { class: 'wm-compass', 'aria-hidden': 'true' }, h('i'), h('span', null, 'N')),
        h('div', { class: 'wm-scale', 'aria-hidden': 'true' }, h('i'), h('span', null, '')),
        h('div', { class: 'wm-hint' }, '끌어서 이동 · 휠로 확대 · 구역을 눌러 자세히 보기'));
      const side = h('aside', { class: 'wm-side' }, h('div', { class: 'wm-card' }), this._wmLegend());
      body.appendChild(h('div', { class: 'wm' }, mapbox, side));
      st.canvas = canvas; st.ctx = canvas.getContext('2d'); st.mapbox = mapbox; st.chipEls = chips; st.card = side.querySelector('.wm-card');
      st.scaleEl = mapbox.querySelector('.wm-scale');
      // chips
      mapbox.querySelector('.wm-chips').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-zone]');
        if (b) this._wmSelect(b.dataset.zone);
      });
      for (const b of chips) {
        b.addEventListener('pointerenter', () => { st.hover = b.dataset.zone; st.dirty = true; });
        b.addEventListener('pointerleave', () => { if (st.hover === b.dataset.zone) st.hover = null; st.dirty = true; });
      }
      // tools
      mapbox.querySelector('.wm-tools').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-wm]');
        if (!b) return;
        const a = b.dataset.wm;
        if (a === 'in') this._wmZoom(1 / 1.35);
        else if (a === 'out') this._wmZoom(1.35);
        else if (a === 'fit') { Object.assign(st.view, WORLD_VIEW); st.dirty = true; }
        else if (a === 'me') { const p = G.sys.player?.position; if (p) { st.view.cx = p.x; st.view.cz = p.z; st.view.size = Math.min(st.view.size, 120); this._wmClampView(); st.dirty = true; } }
      });
      // pan / zoom / click
      canvas.addEventListener('pointerdown', (ev) => {
        st.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: 0 };
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      });
      canvas.addEventListener('pointermove', (ev) => {
        const d = st.drag;
        if (!d || d.id !== ev.pointerId) { this._wmHover(ev); return; }
        const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
        d.x = ev.clientX; d.y = ev.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
        const sc = this._wmScale() / st.dpr;
        st.view.cx -= dx / sc; st.view.cz -= dy / sc;
        this._wmClampView(); st.dirty = true;
      });
      const up = (ev) => {
        const d = st.drag;
        if (!d || d.id !== ev.pointerId) return;
        st.drag = null;
        if (ev.type === 'pointerup' && d.moved < 6) this._wmClick(ev);
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', () => { if (!st.drag && st.hoverZone) { st.hoverZone = null; st.dirty = true; } });
      canvas.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const r = canvas.getBoundingClientRect();
        this._wmZoom(ev.deltaY > 0 ? 1.18 : 1 / 1.18, ev.clientX - r.left, ev.clientY - r.top);
      }, { passive: false });
      if (typeof ResizeObserver !== 'undefined') { st.ro = new ResizeObserver(() => this._wmResize()); st.ro.observe(mapbox); }
    },

    _wmLegend() {
      const h = G.ui.h;
      const item = (cls, label) => h('li', null, h('span', { class: `wm-lg ${cls}` }), label);
      return h('div', { class: 'wm-legend' },
        h('div', { class: 'wm-sub' }, '범례'),
        h('ul', null,
          item('me', '나'), item('npc', 'NPC'), item('quest', '퀘스트 목표'), item('cam', '포토존'),
          item('other', '다른 체험객'), item('jar', '내 장독'), item('poi', '주요 장소')));
    },

    _wmScale() { const st = this._wm; return st ? Math.min(st.W, st.H) / st.view.size : 1; },
    _wmClampView() {
      const v = this._wm.view;
      v.size = clamp(v.size, 40, 300);
      const half = v.size / 2;
      v.cx = clamp(v.cx, BASE.x0 + half * 0.4, BASE.x0 + BASE.size - half * 0.4);
      v.cz = clamp(v.cz, BASE.z0 + half * 0.4, BASE.z0 + BASE.size - half * 0.4);
    },
    _wmZoom(f, sx, sy) {
      const st = this._wm;
      if (!st) return;
      const v = st.view;
      const before = this._wmScale();
      let wx = v.cx, wz = v.cz;
      if (sx != null) { wx = v.cx + (sx * st.dpr - st.W / 2) / before; wz = v.cz + (sy * st.dpr - st.H / 2) / before; }
      v.size = clamp(v.size * f, 40, 300);
      const after = this._wmScale();
      if (sx != null) { v.cx = wx - (sx * st.dpr - st.W / 2) / after; v.cz = wz - (sy * st.dpr - st.H / 2) / after; }
      this._wmClampView();
      st.dirty = true;
    },
    _wmResize() {
      const st = this._wm;
      if (!st || !st.canvas) return;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      // layout size (unaffected by the modal's pop-in transform)
      const W = Math.max(50, Math.round((st.mapbox.clientWidth || 600) * dpr)), H = Math.max(50, Math.round((st.mapbox.clientHeight || 600) * dpr));
      if (st.canvas.width !== W || st.canvas.height !== H) { st.canvas.width = W; st.canvas.height = H; }
      st.W = W; st.H = H; st.dpr = dpr;
      st.dirty = true;
    },
    _wmToWorld(clientX, clientY) {
      const st = this._wm;
      const r = st.canvas.getBoundingClientRect();
      const sc = this._wmScale();
      return { x: st.view.cx + ((clientX - r.left) * st.dpr - st.W / 2) / sc, z: st.view.cz + ((clientY - r.top) * st.dpr - st.H / 2) / sc };
    },
    _wmZoneAtScreen(ev) {
      const p = this._wmToWorld(ev.clientX, ev.clientY);
      let best = null;
      for (const z of zones()) { if (Math.hypot(p.x - z.center[0], p.z - z.center[1]) <= z.r && (!best || z.r < best.r)) best = z; }
      return best;
    },
    _wmHover(ev) {
      const st = this._wm;
      const z = this._wmZoneAtScreen(ev);
      const id = z ? z.id : null;
      if (id !== st.hoverZone) { st.hoverZone = id; st.dirty = true; st.canvas.style.cursor = id ? 'pointer' : 'grab'; }
    },
    _wmClick(ev) {
      const z = this._wmZoneAtScreen(ev);
      if (z) this._wmSelect(z.id);
      else this._wmSelect(null);
    },
    _wmSelect(id) {
      const st = this._wm;
      if (!st) return;
      st.sel = id || null;
      st.dirty = true;
      for (const b of st.chipEls || []) b.classList.toggle('selected', b.dataset.zone === st.sel);
      this._wmRenderCard();
      if (id) G.sfx('click');
    },

    _wmRenderCard() {
      const st = this._wm;
      if (!st || !st.card) return;
      const h = G.ui.h;
      const card = st.card;
      card.innerHTML = '';
      const zs = zones();
      const visited = G.state?.visited || {};
      const vz = (G.data.visitZones || zs.map((z) => z.id));
      const nVisited = vz.filter((id) => visited[id]).length;
      // chips: visited state
      for (const b of st.chipEls || []) {
        const id = b.dataset.zone;
        b.classList.toggle('visited', !!visited[id]);
        b.classList.toggle('here', this.currentZone?.id === id);
      }
      const z = st.sel ? G.world.zoneById(st.sel) : null;
      if (!z) {
        card.appendChild(h('div', { class: 'wm-overview' },
          h('div', { class: 'wm-ov-head' }, h('span', { class: 'ico', 'data-icon': 'map' }), h('div', null, h('b', null, '전통발효체험관'), h('span', { class: 'muted small' }, G.data.meta?.address || ''))),
          h('div', { class: 'wm-progress' },
            h('div', { class: 'row-between small' }, h('span', { class: 'dim' }, '방문한 구역'), h('b', null, `${nVisited} / ${vz.length}`)),
            h('div', { class: 'bar bar-gold', html: `<i style="width:${Math.round((nVisited / Math.max(1, vz.length)) * 100)}%"></i>` })),
          h('div', { class: 'wm-sub' }, '구역 목록'),
          h('div', { class: 'wm-zone-list' }, zs.map((zz, i) => {
            const here = this.currentZone?.id === zz.id;
            const goal = questMarkers().some((m) => Number.isFinite(m.x) && Math.hypot(m.x - zz.center[0], m.z - zz.center[1]) <= zz.r + 2);
            const row = h('div', { class: `wm-zl ${visited[zz.id] ? 'visited' : ''} ${here ? 'here' : ''}` },
              h('button', { type: 'button', class: 'wm-zl-main', dataset: { zone: zz.id }, title: `${zz.name} 자세히 보기` },
                h('span', { class: 'wm-chip-num' }, String(i + 1)), h('span', { class: 'grow' }, zz.name),
                goal ? h('span', { class: 'wm-zl-goal', title: '퀘스트 목표' }, '◆') : null,
                here ? h('span', { class: 'chip chip-green' }, '여기') : visited[zz.id] ? h('span', { class: 'ico ico-xs wm-ok', 'data-icon': 'check' }) : h('span', { class: 'tiny muted' }, '미방문')),
              h('button', { type: 'button', class: 'btn btn-sm btn-primary wm-zl-go', dataset: { go: zz.id }, disabled: here || null, title: `${zz.name}${ro(zz.name).slice(zz.name.length)} 이동`, 'aria-label': `${zz.name}${ro(zz.name).slice(zz.name.length)} 이동` },
                h('span', { class: 'ico ico-xs', 'data-icon': 'teleport' }), '이동'));
            row.style.setProperty('--c', zz.color || '#34c36b');
            row.querySelector('.wm-zl-main').addEventListener('click', () => this._wmSelect(zz.id));
            row.querySelector('.wm-zl-go').addEventListener('click', (e) => { e.stopPropagation(); this.travelTo(zz.id); });
            return row;
          }))));
        G.ui.hydrateIcons(card);
        return;
      }
      const idx = zoneIndex(z.id);
      const stt = this.zoneStatus(z.id);
      const pois = (G.data.pois || []).filter((p) => G.world.zoneAt(p.x, p.z)?.id === z.id || Math.hypot(p.x - z.center[0], p.z - z.center[1]) < z.r + 4);
      const npcs = Object.values(G.data.npcs || {}).filter((n) => n.zone === z.id);
      const marks = questMarkers().filter((m) => Number.isFinite(m.x) && Math.hypot(m.x - z.center[0], m.z - z.center[1]) <= z.r + 2);
      const pzs = (L().photoZones || []).filter((p) => Math.hypot(p.x - z.center[0], p.z - z.center[1]) <= z.r + 2);
      const head = h('div', { class: 'wm-card-head' },
        h('span', { class: 'wm-card-ico' }, h('span', { class: 'ico', 'data-icon': z.icon || 'pin' })),
        h('div', { class: 'grow' },
          h('div', { class: 'wm-card-eyebrow' }, `구역 ${idx + 1}`),
          h('h3', null, z.name),
          h('div', { class: 'row wrap wm-badges' },
            stt.current ? h('span', { class: 'chip chip-green' }, h('span', { class: 'ico ico-xs', 'data-icon': 'pin' }), '현재 위치') : null,
            stt.visited ? h('span', { class: 'chip chip-gold' }, h('span', { class: 'ico ico-xs', 'data-icon': 'check' }), `방문 ${U.formatDate(stt.at)}`) : h('span', { class: 'chip' }, '아직 방문하지 않았어요'),
            marks.length ? h('span', { class: 'chip chip-gold' }, `◆ 목표 ${marks.length}`) : null)));
      head.style.setProperty('--c', z.color || '#34c36b');
      card.appendChild(head);
      card.appendChild(h('p', { class: 'wm-desc' }, z.desc || ''));
      if (marks.length) {
        card.appendChild(h('div', { class: 'wm-sub' }, '진행 중인 목표'));
        card.appendChild(h('ul', { class: 'wm-list' }, marks.map((mk) => h('li', null, h('span', { class: 'wm-lg quest' }), mk.label || '퀘스트 목표'))));
      }
      if (pois.length || pzs.length) {
        card.appendChild(h('div', { class: 'wm-sub' }, '이곳의 장소'));
        const wrapEl = h('div', { class: 'wm-places' });
        for (const p of pois) {
          const seen = !!G.state?.poisVisited?.[p.id];
          const b = h('button', { type: 'button', class: `chip wm-place ${seen ? 'seen' : ''}`, title: p.desc || p.name }, h('span', { class: 'ico ico-xs', 'data-icon': p.icon || 'pin' }), p.name);
          b.addEventListener('click', () => this.travelTo(p.id));
          wrapEl.appendChild(b);
        }
        for (const p of pzs) wrapEl.appendChild(h('span', { class: 'chip wm-place cam', title: '포토존' }, h('span', { class: 'ico ico-xs', 'data-icon': 'camera' }), `포토존 · ${p.name}`));
        card.appendChild(wrapEl);
      }
      if (npcs.length) {
        card.appendChild(h('div', { class: 'wm-sub' }, '만날 수 있는 사람'));
        card.appendChild(h('div', { class: 'wm-places' }, npcs.map((n) => h('span', { class: 'chip chip-gold wm-npc' }, h('span', { class: 'wm-lg npc' }), `${n.name}`, h('small', null, n.role || '')))));
      }
      const go = h('button', { type: 'button', class: 'btn btn-primary btn-block wm-go', disabled: stt.current || null },
        h('span', { class: 'ico ico-sm', 'data-icon': 'teleport' }), stt.current ? '지금 이 구역에 있어요' : '여기로 이동');
      go.addEventListener('click', () => this.travelTo(z.id));
      const back = h('button', { type: 'button', class: 'btn btn-ghost btn-block btn-sm' }, h('span', { class: 'ico ico-sm', 'data-icon': 'chevron-left' }), '전체 구역 보기');
      back.addEventListener('click', () => this._wmSelect(null));
      card.appendChild(h('div', { class: 'wm-actions' }, go, back));
      G.ui.hydrateIcons(card);
    },

    _wmDraw(t) {
      const st = this._wm;
      if (!st || !st.ctx || !st.W) return;
      const ctx = st.ctx, W = st.W, H = st.H, v = st.view, s = st.dpr;
      const sc = this._wmScale();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      blitBase(ctx, this.base, v.cx, v.cz, sc, W, H);
      const X = (x) => (x - v.cx) * sc + W / 2, Y = (z) => (z - v.cz) * sc + H / 2;
      const inView = (px, py, m = 0) => px >= -m && px <= W + m && py >= -m && py <= H + m;
      const nf = G.world.nightFactor || 0;
      if (nf > 0.02) { ctx.fillStyle = `rgba(8,16,40,${nf * 0.22})`; ctx.fillRect(0, 0, W, H); }
      // zones
      const visited = G.state?.visited || {};
      for (const z of zones()) {
        const px = X(z.center[0]), py = Y(z.center[1]), r = z.r * sc;
        if (!inView(px, py, r)) continue;
        const sel = st.sel === z.id, hov = st.hover === z.id || st.hoverZone === z.id;
        ctx.beginPath(); ctx.arc(px, py, r, 0, TAU);
        ctx.fillStyle = rgba(z.color || '#ffffff', sel ? 0.26 : hov ? 0.2 : 0.1); ctx.fill();
        ctx.lineWidth = (sel ? 2.6 : 1.6) * s;
        ctx.setLineDash(sel ? [] : [6 * s, 5 * s]);
        ctx.strokeStyle = rgba(z.color || '#ffffff', sel || hov ? 1 : visited[z.id] ? 0.8 : 0.55);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // POIs
      const small = v.size < 170;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const p of G.data.pois || []) {
        const px = X(p.x), py = Y(p.z);
        if (!inView(px, py, 20)) continue;
        ctx.beginPath(); ctx.arc(px, py, 4.2 * s, 0, TAU);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.lineWidth = 1.6 * s; ctx.strokeStyle = '#2b3a33'; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 1.7 * s, 0, TAU); ctx.fillStyle = '#2b3a33'; ctx.fill();
        if (small) {
          ctx.font = `700 ${Math.round(11 * s)}px ${st.font}`;
          ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(10,16,13,0.8)'; ctx.strokeText(p.name, px + 7 * s, py);
          ctx.fillStyle = '#ffffff'; ctx.fillText(p.name, px + 7 * s, py);
        }
      }
      for (const pz of L().photoZones || []) { const px = X(pz.x), py = Y(pz.z); if (inView(px, py, 10)) drawCamera(ctx, px, py, s); }
      const j1 = L().get?.('J1');
      if (j1) { const px = X(j1.x), py = Y(j1.z); if (inView(px, py, 10)) drawMyJar(ctx, px, py, s * 1.1, t); }
      eachOther((x, z) => { const px = X(x), py = Y(z); if (inView(px, py, 6)) drawOther(ctx, px, py, s); });
      for (const r of G.sys.npc?.list?.() || []) {
        const p = r.position || r.group?.position;
        if (!p) continue;
        const px = X(p.x), py = Y(p.z);
        if (!inView(px, py, 10)) continue;
        drawNpc(ctx, px, py, s * 1.1, r.marker || null);
        if (small && r.data?.name) {
          ctx.font = `700 ${Math.round(10.5 * s)}px ${st.font}`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(10,16,13,0.85)'; ctx.strokeText(r.data.name, px, py + 14 * s);
          ctx.fillStyle = '#ffe08a'; ctx.fillText(r.data.name, px, py + 14 * s);
          ctx.textAlign = 'left';
        }
      }
      for (const m of questMarkers()) {
        if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
        const px = X(m.x), py = Y(m.z);
        if (inView(px, py, 10)) drawDiamond(ctx, px, py, s * 1.15, t, !!m.primary);
      }
      const pl = G.sys.player;
      if (pl?.position && G.state) {
        const px = X(pl.position.x), py = Y(pl.position.z);
        if (inView(px, py, 12)) {
          const b = G.sys.camera?.getMoveBasis?.();
          if (b) drawViewCone(ctx, px, py, b.forward.x, b.forward.z, s * 1.1);
          drawPlayerArrow(ctx, px, py, pl.rotY || 0, s * 1.15);
        }
      }
      // zone chips follow the view
      for (const b of st.chipEls || []) {
        const z = G.world.zoneById(b.dataset.zone);
        if (!z) continue;
        const px = X(z.center[0]) / s, py = Y(z.center[1]) / s;
        const vis = px > -40 && px < W / s + 40 && py > -20 && py < H / s + 20;
        b.hidden = !vis;
        if (vis) b.style.transform = `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      }
      // scale bar
      if (st.scaleEl) {
        const cssPerM = sc / s;
        const step = v.size <= 70 ? 10 : v.size <= 160 ? 20 : 50;
        st.scaleEl.querySelector('i').style.width = `${step * cssPerM}px`;
        const label = `${step} m`;
        const sp = st.scaleEl.querySelector('span');
        if (sp.textContent !== label) sp.textContent = label;
      }
    },

    // ============================================================ travel (one flow for every entry point)
    /** the zone list lives in the world map now (normal) / the picture menu (easy) — kept as an API alias */
    openFastTravel() {
      if (!G.state) return null;
      if (easyOn()) { this.openPictureTravel(); return null; }
      return this.openWorldMap({ full: true });
    },

    /** 쉬운 모드 "🗺️ 어디 갈까?": one big picture menu — ⭐ quest goal, 🏺 my jar, every zone */
    async openPictureTravel() {
      if (!G.state) return null;
      const open = G.ui.modal.get('easy-where');
      if (open) { open.close(); return null; }
      if (this._pickOpen) return null;
      if (G.sys.photo?.active) G.sys.photo.exit?.();
      if (!G.easy?.pick) return this.openWorldMap({ full: true });
      G.ui.popover?.close?.();
      const here = this.currentZone?.id || G.state.player?.zoneId || null;
      const marks = questMarkers();
      const visited = G.state.visited || {};
      const items = [];
      // ⭐ the next quest goal (walk there with the footprint trail)
      let step = null;
      try { step = G.easy.nextStep?.() || null; } catch (e) { step = null; }
      const goal = step && step.target && Number.isFinite(step.target.x) && Number.isFinite(step.target.z) ? step.target : null;
      if (goal) items.push({ id: '@goal', emoji: '⭐', label: '금빛 별', color: '#ffd23f', badge: '👉', say: `금빛 별을 찾아가요. ${step.say || step.text || ''}` });
      // 🏺 my jar
      const j1 = L().get?.('J1');
      if (j1 && Number.isFinite(j1.x)) items.push({ id: '@jar', emoji: '🏺', label: '내 장독', color: '#c98a5a', say: '내 장독이 있는 곳으로 가요.' });
      zones().forEach((z) => {
        if (!z || !(z.r > 0) || !Array.isArray(z.center)) return;
        const isHere = here === z.id;
        const isGoal = marks.some((m) => m && m.primary && Number.isFinite(m.x) && Math.hypot(m.x - z.center[0], m.z - z.center[1]) <= z.r + 2);
        const name = String(z.short || z.name);
        items.push({
          id: z.id, emoji: ZONE_EMOJI[z.id] || '📍', label: name, color: z.color,
          badge: isHere ? '📍' : isGoal ? '⭐' : (visited[z.id] ? '' : '✨'),
          selected: isHere,
          say: isHere ? `${name}. 지금 여기 있어요.` : `${name}. ${ZONE_SAY[z.id] || ''}${isGoal ? '. 금빛 별이 있어요!' : ''}`,
        });
      });
      // ✨ more places (points of interest) on a second page
      const pois = (G.data.pois || []).filter((p) => p && p.id && Number.isFinite(p.x) && Number.isFinite(p.z));
      if (pois.length) items.push({ id: '@more', emoji: '✨', label: '더 보기', color: '#b48bff', say: '다른 곳도 더 볼까요?' });
      this._pickOpen = true;
      let id = null;
      try {
        for (let page = 0; page < 6; page++) {
          id = await G.easy.pick({ id: 'easy-where', title: '어디 갈까?', emoji: '🗺️', say: page ? '' : '어디로 갈까요? 그림을 눌러요.', items, columns: 4, className: 'mm-pick' });
          if (id !== '@more') break;
          const seen = G.state?.poisVisited || {};
          const more = [{ id: '@back', emoji: '⬅️', label: '처음으로', color: '#9fb4c8', say: '처음 그림으로 돌아가요.' }].concat(pois.map((p) => {
            const k = POI_KID[p.id] || ['📍', String(p.name).slice(0, 6), String(p.name)];
            return { id: p.id, emoji: k[0], label: k[1], badge: seen[p.id] ? '' : '✨', say: `${k[1]}. ${k[2]}` };
          }));
          id = await G.easy.pick({ id: 'easy-where', title: '더 많은 곳', emoji: '✨', say: '더 많은 곳이에요. 그림을 눌러요.', items: more, columns: 4, className: 'mm-pick' });
          if (id !== '@back') break;
        }
      } finally { this._pickOpen = false; }
      if (!id || id === '@more' || id === '@back' || !G.state) return null; // (a logout during the menu ends the trip too)
      if (id === '@goal' && goal) {
        G.easy.goTo?.({ x: goal.x, z: goal.z }, { label: '' });
        return id;
      }
      if (id === '@jar' && j1) {
        G.easy.goTo?.({ x: j1.x - 1.6, z: j1.z }, { label: '내 장독', stopDistance: 0.9 });
        return id;
      }
      if (id === here) { say('지금 여기에 있어요!', { force: true }); return id; }
      await this.travelTo(id);
      return id;
    },

    /** arrival spot for a zone / POI / NPC / layout anchor id: {x, z, rotY} | null */
    arrivalFor(id) {
      if (typeof id !== 'string' || !id) return null;
      const a = ARRIVE[id];
      if (a) return { x: a[0], z: a[1], rotY: a[2] };
      const zn = G.world.zoneById(id);
      if (zn && zn.r > 0) return { x: zn.center[0], z: zn.center[1], rotY: undefined };
      const poi = (G.data.pois || []).find((p) => p.id === id);
      if (poi) return { x: poi.x, z: poi.z, rotY: undefined };
      // an NPC: stand ~2.4 m in front of them (towards the plaza), facing them
      const npc = G.sys.npc?.get?.(id);
      const np = npc?.position || npc?.group?.position;
      const nd = G.data.npcs?.[id];
      const nx = Number(np?.x ?? nd?.pos?.[0]), nz = Number(np?.z ?? nd?.pos?.[1]);
      if (Number.isFinite(nx) && Number.isFinite(nz)) {
        let dx = -nx, dz = -nz;
        const l = Math.hypot(dx, dz);
        if (l > 1e-3) { dx /= l; dz /= l; } else { dx = 0; dz = 1; }
        return { x: nx + dx * 2.4, z: nz + dz * 2.4, rotY: Math.atan2(-dx, -dz) };
      }
      const an = L().get?.(id);
      if (an && Number.isFinite(an.x) && Number.isFinite(an.z)) return { x: an.x, z: an.z + 2, rotY: Math.PI };
      return null;
    },

    /**
     * the single travel step behind the world map, the picture menu, the minimap tap, NPC "map" actions,
     * missions and G.easy.goTo: fade + teleport to a free arrival spot. One travel at a time (double taps
     * share the running one). Accepts an id (zone / POI / NPC / anchor) or a point {x, z, label?}.
     */
    travelTo(id, opts = {}) {
      if (this._travel) return this._travel;
      const p = this._doTravel(id, opts && typeof opts === 'object' ? opts : {});
      this._travel = p;
      const clear = () => { if (this._travel === p) this._travel = null; };
      p.then(clear, clear);
      return p;
    },
    async _doTravel(id, opts) {
      const pl = G.sys.player;
      const easy = easyOn();
      if (!G.state || !pl?.teleport || pl._ready === false) {
        if (easy) kidToast('지금은 갈 수 없어요. 조금 뒤에 해 봐요!'); else G.ui.toast('지금은 이동할 수 없어요.', { type: 'warn' });
        return false;
      }
      if (G.sys.dialogue?.active) {
        if (easy) kidToast('이야기가 끝나면 갈 수 있어요.', '💬'); else G.ui.toast('대화를 마친 뒤에 이동해 주세요.', { type: 'info' });
        return false;
      }
      let a = null, name = '', zoneId = null;
      if (id && typeof id === 'object') {
        const x = Number(id.x), z = Number(id.z);
        if (Number.isFinite(x) && Number.isFinite(z)) { a = { x, z, rotY: Number.isFinite(id.rotY) ? id.rotY : undefined }; name = String(id.label || '').slice(0, 20); }
      } else if (typeof id === 'string') {
        a = this.arrivalFor(id);
        const zn = G.world.zoneById(id);
        zoneId = zn && zn.r > 0 ? zn.id : null;
        name = zn ? String((easy && zn.short) || zn.name) : (G.data.pois || []).find((p) => p.id === id)?.name || G.data.npcs?.[id]?.name || '';
      }
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) { G.log.warn('UI', 'travelTo: unknown target', id); return false; }
      const b = G.world.bounds;
      a.x = clamp(a.x, b.minX + 1, b.maxX - 1); a.z = clamp(a.z, b.minZ + 1, b.maxZ - 1);
      const spot = safeSpot(a.x, a.z);
      if (spot) { a.x = spot.x; a.z = spot.z; }
      if (G.sys.photo?.active) G.sys.photo.exit?.();
      // whatever screen sent us here (map, picture menu, mission card, bag...) closes: we are leaving
      G.ui.modal.closeAll();
      G.ui.popover?.close?.();
      try { pl.cancelWalk?.('travel'); } catch (e) { /* ignore */ }
      if (easy && opts.say !== false) say(name ? `${name}${ro(name).slice(name.length)} 가요!` : '출발!', { priority: 1 });
      try {
        await pl.teleport(a.x, a.z, a.rotY);
        this._detT = 1; // detect right away
        this._drawT = 1;
        G.log.info('UI', `travel -> ${typeof id === 'string' ? id : `(${a.x.toFixed(1)}, ${a.z.toFixed(1)})`}`);
        G.bus.emit('travel:arrived', { id: typeof id === 'string' ? id : null, zoneId, x: pl.position.x, z: pl.position.z });
        if (easy) {
          if (!G.settings?.reduceMotion) { try { G.fx?.burst?.({ x: pl.position.x, y: pl.position.y + 1.2, z: pl.position.z }, { type: 'sparkle', count: 22 }); } catch (e) { /* fx optional */ } }
          // (when G.easy.goTo used this hop to get closer, its walk has started by now and it greets the arrival itself)
          if (opts.say !== false) setTimeout(() => { if (!pl.isWalking) say(name ? `${name}에 도착했어요!` : '도착했어요!', { priority: 1 }); }, 120);
        }
        return true;
      } catch (e) {
        G.log.warn('UI', 'fast travel failed', e);
        if (easy) kidToast('앗, 못 갔어요. 다시 눌러 봐요!'); else G.ui.toast(`${ro(name || '그곳')} 이동하지 못했어요.`, { type: 'error' });
        return false;
      }
    },
  };

  G.register(MM);
})();
