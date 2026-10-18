// =============================================================================
// 17-manjangdae.js — 정선 만장대 (phase 4 start point): lookout landmark, telescope tour, intro cinematic
//
//   G.sys.manjangdae (order 27)
//     zoneId                        'ZONE_MANJANGDAE'
//     lookout {x, y, z}             the viewing spot on the deck (= layout.spawn), y = plateau height
//     intro({force, reduced}) -> Promise<{skipped, reduced}>   first-entry cinematic (≤ 9 s, skippable with any
//                                   key / tap; reduceMotion -> a short fade + 2D title). One at a time.
//     introActive / whenIntroDone() -> Promise   (other modules may wait for it, e.g. the onboarding coach)
//     titleShot() -> {pos:[x,y,z], look:[x,y,z], cinematic:{center, radius, height, angle, speed}}  title screen framing
//     tour(startZoneId?) -> Promise  telescope view: the camera zooms over the valley and names each zone
//     openGuide()                   the view guide (안내판 / 표지석)
//     walkSpot(from?) -> {x,z}|null a safe 1.8-3 m walking target on the deck in front of the camera (tutorials)
//   Events: manjangdae:intro {phase:'start'|'end', skipped, reduced}, manjangdae:tour {phase, zoneId}
//
// The hill, plateau and switchback bench are terrain (11-terrain, layout.manjangdae). This module builds what
// stands on it: paved deck + stone retaining ring + stone balustrade (gap where the path leaves), an octagonal
// pavilion (팔각정) with dancheong beams / brackets / rafters with painted ends, a concave tiled roof with
// upturned corners and a finial, a carved marker stone "旌善 萬丈臺 · 정선 만장대", stone lanterns glowing at
// night (G.world.addNightMaterial), four Korean red pines, a coin-telescope, an info board, rope fences and
// stone stair nosings along the path, rock outcrops on the valley face. Geometry is merged per material (~13 draw calls), every normal is
// repaired by G.gfx.fixNormals (computeVertexNormals / applyMatrix4 are patched by the engine), nothing is
// allocated per frame. Colliders keep the player on the deck and the path (the sub-stepped player can not
// tunnel through the 0.12 m rails); walkables make the pavilion floor and its steps walkable.
// Location naming is in-game styling, not verified geography (G.data.meta.addressNote).
// =============================================================================
(function () {
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 4));
  const fin = Number.isFinite;
  const BGU = ADDONS.BufferGeometryUtils;
  const L = () => G.data.layout || {};
  const MDL = () => L().manjangdae || null;
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const reduceMotion = () => !!G.settings?.reduceMotion;
  const say = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };
  const SERIF = '"Noto Serif KR","Nanum Myeongjo","Batang","AppleMyungjo","Gungsuh","Noto Serif CJK KR",serif';
  const SANS = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const ZONE_EMOJI = {
    ZONE_MAIN: '⛲', ZONE_CROP: '🌱', ZONE_HALL: '🏛️', ZONE_HERB: '🌿', ZONE_EDUCATION: '📖', ZONE_FERMENTATION: '🍲',
    ZONE_JANGDOKDAE: '🏺', ZONE_REST: '🌸', ZONE_ENTRANCE: '🚪',
  };
  const ZONE_KID = {
    ZONE_MAIN: '동그란 광장이에요. 발효마스터가 기다려요!', ZONE_CROP: '채소를 기르는 밭이에요.', ZONE_HALL: '아주 큰 체험관이에요.',
    ZONE_HERB: '향기로운 허브 밭이에요.', ZONE_EDUCATION: '이야기를 배우는 곳이에요.', ZONE_FERMENTATION: '된장, 간장, 김치를 볼 수 있어요.',
    ZONE_JANGDOKDAE: '장독이 정말 많아요!', ZONE_REST: '꽃과 연못이 있는 정원이에요.', ZONE_ENTRANCE: '체험관에 들어오는 문이에요.',
  };

  // ---------------------------------------------------------------- reusable math objects (no per-frame allocation)
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _camPos = new THREE.Vector3(), _camLook = new THREE.Vector3();
  const _shotOpts = { fov: 50, duration: undefined };   // reused every frame (no per-frame garbage)
  /** matrix: translate (x,y,z), rotate (rx, ry, rz; order YXZ), scale */
  function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }
  /** matrix placing a unit-Y geometry (e.g. a cylinder of height 1 centred at 0) between points a and b */
  function between(ax, ay, az, bx, by, bz, r = 1) {
    _v1.set(bx - ax, by - ay, bz - az);
    const len = _v1.length();
    if (!(len > 1e-5)) return null;
    _v1.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_v2.set(0, 1, 0), _v1);
    return new THREE.Matrix4().compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(r, len, r));
  }
  const bearingPt = (cx, cz, r, a) => [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  // walkSpot: bearings tried around the camera's forward direction (front first, then wider)
  const WALK_SIDES = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.3, -2.3];
  const PROMPT_SKIP = new Set(['companion', 'bench', 'decor']);
  /** would standing at (x, z) bring up another gold prompt (an interactable within its reach)? */
  function promptNear(x, z) {
    const I = G.interact;
    if (!I?.list) return false;
    for (const e of I.list()) {
      if (!e || PROMPT_SKIP.has(e.kind) || e.disabled) continue;
      let v = null;
      try { v = typeof e.position === 'function' ? e.position() : e.position; } catch (err) { v = null; }
      if (!v || !fin(v.x) || !fin(v.z)) continue;
      const r = (I.radiusOf ? I.radiusOf(e) : e.radius || 2.6) + 0.4;
      if ((v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) < r * r) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- merge buckets
  // Every part becomes non-indexed, gets a vertex colour (jittered per part), is transformed in world space and
  // merged into one geometry per material. `uv` buckets keep (or add) uv coordinates.
  class Bucket {
    constructor(name, uv) { this.name = name; this.uv = !!uv; this.parts = []; }
    add(geo, matrix, color, jit = 0, rnd = Math.random) {
      if (!geo) return;
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (this.uv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!this.uv && g.attributes.uv) g.deleteAttribute('uv');
      if (matrix) g.applyMatrix4(matrix);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      const c = color && color.isColor ? color : new THREE.Color(color || '#ffffff');
      const f = jit ? 1 + (rnd() - 0.5) * 2 * jit : 1;
      for (let i = 0; i < n; i++) { col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.parts.push(g);
    }
    build(material, opts = {}) {
      if (!this.parts.length) return null;
      let geo = null;
      try { geo = this.parts.length === 1 ? this.parts[0] : BGU.mergeGeometries(this.parts, false); } catch (e) { G.log.warn('WORLD', `manjangdae: merge ${this.name} failed`, e); }
      if (geo !== this.parts[0]) for (const p of this.parts) p.dispose();
      this.parts = [];
      if (!geo) return null;
      G.gfx.fixNormals(geo);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'manjangdae-' + this.name;
      mesh.castShadow = !!opts.cast; mesh.receiveShadow = opts.receive !== false;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      return mesh;
    }
  }
  /** flip a geometry's winding when its average normal points away from `want` (normalised) */
  function orient(geo, want) {
    geo.computeVertexNormals();
    const n = geo.attributes.normal.array;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n.length; i += 3) { sx += n[i]; sy += n[i + 1]; sz += n[i + 2]; }
    if (sx * want.x + sy * want.y + sz * want.z < 0) {
      const idx = geo.index;
      if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } idx.needsUpdate = true; }
      geo.computeVertexNormals();
    }
    return geo;
  }
  /** grid surface from a point function f(u, v, out:{x,y,z}) over nu x nv cells (+ uv scaled by su, sv) */
  function surface(nu, nv, f, su = 1, sv = 1) {
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2);
    const o = { x: 0, y: 0, z: 0, u: null, v: null };
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      o.u = null; o.v = null;
      f(i / nu, j / nv, o);
      const k = j * (nu + 1) + i;
      pos[k * 3] = fin(o.x) ? o.x : 0; pos[k * 3 + 1] = fin(o.y) ? o.y : 0; pos[k * 3 + 2] = fin(o.z) ? o.z : 0;
      uv[k * 2] = o.u != null ? o.u : (i / nu) * su; uv[k * 2 + 1] = o.v != null ? o.v : (j / nv) * sv;
    }
    const idx = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  /** tapered tube along points [{x,y,z}] with radii r[i] (rings of `seg` vertices; never collapses to 0) */
  function taperTube(pts, radii, seg = 7) {
    const n = pts.length;
    const pos = new Float32Array(n * seg * 3), uv = new Float32Array(n * seg * 2), idx = [];
    const t = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), alt = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      t.set(b.x - a.x, b.y - a.y, b.z - a.z);
      if (t.lengthSq() < 1e-10) t.set(0, 1, 0);
      t.normalize();
      nrm.crossVectors(Math.abs(t.y) > 0.95 ? alt : up, t);
      if (nrm.lengthSq() < 1e-10) nrm.set(1, 0, 0);
      nrm.normalize(); bin.crossVectors(t, nrm).normalize();
      const r = Math.max(0.01, radii[i]);
      for (let k = 0; k < seg; k++) {
        const ang = (k / seg) * TAU, c = Math.cos(ang), s = Math.sin(ang);
        const o = (i * seg + k);
        pos[o * 3] = pts[i].x + (nrm.x * c + bin.x * s) * r;
        pos[o * 3 + 1] = pts[i].y + (nrm.y * c + bin.y * s) * r;
        pos[o * 3 + 2] = pts[i].z + (nrm.z * c + bin.z * s) * r;
        uv[o * 2] = k / seg; uv[o * 2 + 1] = i / (n - 1);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------------------------------------------------------------- procedural textures
  function graniteTexture() {
    return G.gfx.canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#ddd7cb'; ctx.fillRect(0, 0, w, h);
      const r = G.util.rng(17);
      for (let i = 0; i < 2600; i++) {
        const x = r() * w, y = r() * h, s = 0.6 + r() * 1.8, v = r();
        ctx.fillStyle = v < 0.45 ? `rgba(60,58,54,${0.12 + r() * 0.25})` : v < 0.8 ? `rgba(255,255,255,${0.2 + r() * 0.3})` : `rgba(150,120,95,${0.1 + r() * 0.15})`;
        ctx.fillRect(x, y, s, s);
      }
    }, { repeat: [1, 1] });
  }
  function pavingTexture() {
    return G.gfx.canvasTexture(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#6d675e'; ctx.fillRect(0, 0, w, h);
      const r = G.util.rng(2026);
      let y = 0;
      while (y < h) {
        const rh = 64 + Math.floor(r() * 46);
        let x = -Math.floor(r() * 90);
        while (x < w) {
          const rw = 80 + Math.floor(r() * 120);
          const l = 136 + Math.floor(r() * 42), tint = Math.floor(r() * 16) - 8;
          ctx.fillStyle = `rgb(${l + 6 + tint},${l + tint},${l - 14})`;
          const jx = r() * 3, jy = r() * 3;
          ctx.fillRect(x + 3 + jx, y + 3 + jy, rw - 6, Math.min(rh, h - y) - 6);
          // weathering
          ctx.fillStyle = `rgba(90,82,70,${0.05 + r() * 0.08})`;
          ctx.fillRect(x + 3 + jx, y + 3 + jy + (rh - 6) * 0.6, rw - 6, (rh - 6) * 0.4);
          x += rw;
        }
        y += rh;
      }
      for (let i = 0; i < 9000; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(40,38,34,0.18)' : 'rgba(255,255,255,0.18)'; ctx.fillRect(r() * w, r() * h, 1.4, 1.4); }
      // a little moss in the joints
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#5f7a3c';
      for (let i = 0; i < 180; i++) { ctx.beginPath(); ctx.arc(r() * w, r() * h, 2 + r() * 5, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }, { repeat: [3.2, 3.2] });
  }
  function tileTexture() {
    return G.gfx.canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2f3339'; ctx.fillRect(0, 0, w, h);
      const cols = 8, cw = w / cols;
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        // convex cover tile (수키와): rounded light ridge
        const g = ctx.createLinearGradient(x, 0, x + cw, 0);
        g.addColorStop(0, '#22262b'); g.addColorStop(0.28, '#4b5058'); g.addColorStop(0.5, '#5f646c'); g.addColorStop(0.72, '#454a52'); g.addColorStop(1, '#1d2025');
        ctx.fillStyle = g; ctx.fillRect(x + cw * 0.18, 0, cw * 0.64, h);
      }
      // courses
      for (let y = 0; y < h; y += 32) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y, w, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, y + 3, w, 2);
      }
    }, { repeat: [1, 1] });
  }
  /** dancheong beam: 머리초 medallions at both ends, 녹청 body with 긋기 lines */
  function dancheongTexture() {
    return G.gfx.canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#2f7464'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1f4f45'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
      ctx.fillStyle = '#f2ecdc'; ctx.fillRect(0, 10, w, 3); ctx.fillRect(0, h - 13, w, 3);
      const end = (x0, dir) => {
        const bands = ['#1d1d1f', '#c8452c', '#f2ecdc', '#2c5f9e', '#e8b84a', '#3f8f6a', '#f2ecdc', '#c8452c'];
        let x = x0;
        for (let i = 0; i < bands.length; i++) { const bw = i % 3 === 0 ? 8 : 6; ctx.fillStyle = bands[i]; ctx.fillRect(dir > 0 ? x : x - bw, 13, bw, h - 26); x += dir * bw; }
        // medallion (연화 머리초)
        const cx = x + dir * 34, cy = h / 2;
        const rings = [['#c8452c', 30], ['#f2ecdc', 25], ['#2c5f9e', 21], ['#e8b84a', 15], ['#c8452c', 9], ['#f8f2e2', 4]];
        for (const [c, rr] of rings) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = '#f2ecdc'; ctx.lineWidth = 2;
        for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15); ctx.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); ctx.stroke(); }
        // half petals towards the body
        ctx.fillStyle = '#3f8f6a';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + dir * 46, cy + s * 22, 14, 9, 0, 0, TAU); ctx.fill(); }
      };
      end(0, 1); end(w, -1);
      // body 긋기
      ctx.strokeStyle = 'rgba(242,236,220,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(140, 32); ctx.lineTo(w - 140, 32); ctx.moveTo(140, h - 32); ctx.lineTo(w - 140, h - 32); ctx.stroke();
    }, { anisotropy: 4 });
  }
  function lotusTexture() {
    return G.gfx.canvasTexture(64, 64, (ctx, w) => {
      const c = w / 2;
      const rings = [['#245a4d', 32], ['#f2ecdc', 27], ['#c8452c', 22], ['#e8b84a', 14], ['#2c5f9e', 8], ['#f8f2e2', 3]];
      for (const [col, r] of rings) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.fill(); }
    });
  }
  function markerTexture() {
    return G.gfx.canvasTexture(1024, 640, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const carve = (text, y, size, weight = 700, spacing = 0) => {
        ctx.font = `${weight} ${size}px ${SERIF}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
        ctx.fillStyle = 'rgba(255,250,236,0.55)'; ctx.fillText(text, w / 2 + 3, y + 4);   // lit lower lip of the groove
        ctx.fillStyle = 'rgba(22,20,18,0.92)'; ctx.fillText(text, w / 2, y);              // groove
      };
      carve('旌善', 112, 96, 600, 40);
      carve('萬丈臺', 300, 230, 800, 30);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.font = `700 74px ${SANS}`;
      ctx.fillStyle = 'rgba(255,250,236,0.5)'; ctx.fillText('정선 만장대', w / 2 + 2, 520 + 3);
      ctx.fillStyle = 'rgba(28,26,22,0.9)'; ctx.fillText('정선 만장대', w / 2, 520);
    }, { srgb: true });
  }
  function boardTexture() {
    return G.gfx.canvasTexture(1024, 640, (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#f3ead6'); bg.addColorStop(1, '#e4d6b8');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#5b3a22'; ctx.lineWidth = 18; ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.fillStyle = '#5b3a22'; ctx.fillRect(9, 9, w - 18, 112);
      ctx.fillStyle = '#fff6e0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 62px ${SANS}`; ctx.fillText('정선 만장대 전망 안내', w / 2, 66);
      // panorama: ridge silhouettes + valley
      const Y0 = 210;
      const ridge = (base, amp, col, seed) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(30, h - 120);
        for (let x = 30; x <= w - 30; x += 8) ctx.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x / 61 + seed) * Math.cos(x / 23 + seed * 2)));
        ctx.lineTo(w - 30, h - 120); ctx.closePath(); ctx.fill();
      };
      ridge(Y0 + 40, 70, '#b9c7b4', 1); ridge(Y0 + 90, 60, '#8fa98a', 3); ridge(Y0 + 150, 40, '#6f9363', 5);
      ctx.fillStyle = '#6fa1c6'; ctx.beginPath(); ctx.moveTo(w - 210, h - 120); ctx.bezierCurveTo(w - 260, Y0 + 220, w - 170, Y0 + 170, w - 150, Y0 + 110); ctx.lineTo(w - 120, Y0 + 110); ctx.bezierCurveTo(w - 140, Y0 + 180, w - 220, Y0 + 230, w - 160, h - 120); ctx.closePath(); ctx.fill();
      const pins = [[500, Y0 + 120, '체험관'], [470, Y0 + 205, '작물밭'], [520, Y0 + 255, '광장'], [690, Y0 + 245, '장독대'], [310, Y0 + 235, '발효식품'], [250, Y0 + 170, '교육'], [770, Y0 + 300, '휴식정원'], [470, Y0 + 320, '정문']];
      ctx.font = `700 30px ${SANS}`;
      for (const [x, y, t] of pins) {
        ctx.fillStyle = '#c8452c'; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
        const tw = ctx.measureText(t).width + 18;
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x - tw / 2, y - 50, tw, 36);
        ctx.fillStyle = '#2f261c'; ctx.fillText(t, x, y - 32);
      }
      ctx.fillStyle = '#4a3a2c'; ctx.font = `600 26px ${SANS}`;
      ctx.fillText('망원경으로 구역을 하나씩 살펴보세요 · 게임 속 풍경 안내예요', w / 2, h - 52);
    });
  }
  function titleCardTexture() {
    return G.gfx.canvasTexture(2048, 768, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // soft backing glow
      // (elliptical, and fully faded well inside the canvas so the card never shows an edge)
      ctx.save();
      ctx.translate(w / 2, h * 0.47); ctx.scale(1, 0.4);
      const g = ctx.createRadialGradient(0, 0, 30, 0, 0, w * 0.4);
      g.addColorStop(0, 'rgba(10,22,18,0.5)'); g.addColorStop(0.55, 'rgba(10,22,18,0.28)'); g.addColorStop(1, 'rgba(10,22,18,0)');
      ctx.fillStyle = g; ctx.fillRect(-w * 0.5, -h * 1.25, w, h * 2.5);
      ctx.restore();
      ctx.font = `600 70px ${SERIF}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '26px';
      ctx.fillStyle = 'rgba(244,214,140,0.95)'; ctx.fillText('旌善 萬丈臺', w / 2, 170);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '14px';
      ctx.font = `900 250px ${SANS}`;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(16,30,24,0.55)'; ctx.lineWidth = 22; ctx.strokeText('정선 만장대', w / 2, 380);
      ctx.fillStyle = '#fffaf0'; ctx.fillText('정선 만장대', w / 2, 380);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.font = `600 64px ${SANS}`;
      ctx.fillStyle = 'rgba(255,250,236,0.95)'; ctx.fillText('전통발효체험관이 한눈에 내려다보여요', w / 2, 590);
      ctx.fillStyle = 'rgba(244,214,140,0.9)'; ctx.fillRect(w / 2 - 260, 662, 520, 5);
    });
  }

  // ---------------------------------------------------------------- the system
  const MDS = {
    name: 'manjangdae', order: 27, label: '정선 만장대',
    zoneId: 'ZONE_MANJANGDAE',
    lookout: { x: 52, y: 22, z: 109.4 },
    root: null, meshes: {}, colliders: [], walkables: [], built: false,
    introActive: false, tourActive: false,
    _intro: null, _introDone: null, _tour: null, _ui: null, _card: null, _t: 0,

    get data() { return MDL(); },

    async init() {
      const md = MDL(), eng = G.sys.engine;
      if (!md || !eng?.scene) { G.log.info('WORLD', 'manjangdae: no layout / scene'); return; }
      try { G.sys.terrain?.ensureFields?.(); } catch (e) { G.log.warn('WORLD', 'manjangdae: terrain fields unavailable', e); }
      const top = this._groundY(md.deck.x, md.deck.z, md.top);
      this.lookout = { x: md.deck.x, y: top, z: md.deck.z };
      const root = new THREE.Group(); root.name = 'manjangdae';
      eng.scene.add(root);
      this.root = root;
      const preset = eng.preset || { name: 'medium', shadows: true };
      this._low = preset.name === 'low';
      this._shadows = !!preset.shadows;
      this._camProxy = [];   // camera-only proxy shapes collected by the builders, merged in _flush
      const steps = [
        ['materials', () => this._materials()],
        ['plateau', () => this._buildPlateau(md, top)],
        ['pavilion', () => this._buildPavilion(md, top)],
        ['marker', () => this._buildMarker(md, top)],
        ['lanterns', () => this._buildLanterns(md, top)],
        ['pines', () => this._buildPines(md, top)],
        ['telescope', () => this._buildTelescope(md, top)],
        ['board', () => this._buildBoard(md, top)],
        ['path', () => this._buildPath(md)],
        ['crags', () => this._buildCrags(md, top)],
        ['merge', () => this._flush()],
      ];
      for (const [name, fn] of steps) {
        try { fn(); } catch (e) { G.log.error('WORLD', `manjangdae: ${name} failed`, e); G.__systemErrors?.push?.({ system: 'manjangdae', phase: 'init:' + name, message: String(e && e.stack || e) }); }
      }
      this.built = true;
      G.bus.on('game:login', ({ isNew } = {}) => this._onLogin(!!isNew));
      G.log.info('WORLD', `manjangdae: built (${root.children.length} meshes, ${this.colliders.length} colliders)`);
    },

    postInit() {
      if (!this.built) return;
      const md = MDL();
      const I = G.interact;
      if (!I?.register) return;
      const tel = md.telescope, brd = md.board, mk = md.marker;
      const y = this.lookout.y;
      // no focus ring / prompt while the intro or the telescope view owns the camera
      const busyOff = () => !this.tourActive && !this.introActive;
      if (tel) I.register({
        id: tel.id, kind: 'telescope', label: '망원경으로 둘러보기', kidLabel: '망원경', emoji: '🔭', radius: 2.4, priority: 1,
        position: new THREE.Vector3(tel.x, y + 1.15, tel.z), object: this.meshes.telescopeHit || undefined, enabled: busyOff,
        onInteract: () => { this.tour(); },
      });
      if (brd) I.register({
        id: brd.id, kind: 'sign', label: '전망 안내판 보기', kidLabel: '안내판', emoji: '🪧', radius: 2.4,
        position: new THREE.Vector3(brd.x, y + 1.2, brd.z), object: this.meshes.boardHit || undefined, enabled: busyOff,
        onInteract: () => this.openGuide(),
      });
      if (mk) I.register({
        id: mk.id, kind: 'exhibit', label: '표지석 살펴보기', kidLabel: '표지석', emoji: '🪨', radius: 2.8, priority: -0.2,
        position: new THREE.Vector3(mk.x, y + 1.0, mk.z), object: this.meshes.markerHit || undefined, enabled: busyOff,
        onInteract: () => this.openGuide('name'),
      });
    },

    onLogout() { this._abortIntro(); this._endTour(true); },

    _groundY(x, z, fallback = 0) {
      const y = G.world?.terrainHeight?.(x, z);
      return fin(y) ? y : fallback;
    },

    // ============================================================== materials
    _materials() {
      const mat = (key, f) => G.gfx.material('md-' + key, f);
      const graniteTex = graniteTexture();
      this.mats = {
        // warm granite multiplier: the valley's sky light is bright, untinted stone read as white plastic
        stone: mat('stone', () => new THREE.MeshStandardMaterial({ color: 0xd8d1c3, vertexColors: true, map: graniteTex, roughness: 0.94, metalness: 0 })),
        paint: mat('paint', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 })),
        beam: mat('beam', () => new THREE.MeshStandardMaterial({ map: dancheongTexture(), roughness: 0.66, metalness: 0 })),
        roof: mat('roof', () => new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.8, metalness: 0.05, side: THREE.FrontSide })),
        rafterEnd: mat('rafter-end', () => new THREE.MeshStandardMaterial({ map: lotusTexture(), roughness: 0.6 })),
        paving: mat('paving', () => new THREE.MeshStandardMaterial({ color: 0xd9d0bf, map: pavingTexture(), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })),
        bark: mat('bark', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })),
        needles: mat('needles', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true })),
        metal: mat('metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.55 })),
        glow: mat('glow', () => {
          const m = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffb050, emissiveIntensity: 0.06, roughness: 0.5 });
          G.world.addNightMaterial(m, 2.4, 0.06);
          return m;
        }),
        text: mat('marker-text', () => new THREE.MeshStandardMaterial({ map: markerTexture(), transparent: true, depthWrite: false, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })),
        board: mat('board', () => new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.82 })),
      };
      this.B = {
        stone: new Bucket('stone', true), paint: new Bucket('paint', false), beam: new Bucket('beam', true), roof: new Bucket('roof', true),
        rafterEnd: new Bucket('rafter-end', true), bark: new Bucket('bark', false), needles: new Bucket('needles', false), metal: new Bucket('metal', false),
        glow: new Bucket('glow', false),
      };
      this.rnd = G.util.rng(118);
    },
    _flush() {
      const B = this.B, m = this.mats, sh = this._shadows;
      const add = (mesh, key) => { if (mesh) { this.root.add(mesh); this.meshes[key] = mesh; } return mesh; };
      add(B.stone.build(m.stone, { cast: sh }), 'stone');
      add(B.paint.build(m.paint, { cast: sh }), 'paint');
      add(B.beam.build(m.beam, { cast: false }), 'beam');
      const roof = add(B.roof.build(m.roof, { cast: sh }), 'roof');
      add(B.rafterEnd.build(m.rafterEnd, { cast: false }), 'rafterEnd');
      add(B.bark.build(m.bark, { cast: sh }), 'bark');
      add(B.needles.build(m.needles, { cast: sh }), 'needles');
      add(B.metal.build(m.metal, { cast: sh }), 'metal');
      add(B.glow.build(m.glow, { cast: false, receive: false }), 'glow');
      if (roof) G.world.cameraBlockers.push(roof);
      // the decorative paint mesh (columns, beams, brackets, rafters, railings: ~8k triangles) is NOT a camera blocker:
      // the follow camera's rays would walk every one of its triangles on the deck, where the game starts. Low-poly
      // invisible proxies stand in for what the camera must not enter: the roof hull (below), the columns and the
      // pine canopies (_camProxy, merged into one mesh).
      // the tiled roof is single-sided, so a follow-camera ray coming up from the deck slips under the eaves and the
      // camera could settle on (or in) the tiles. An invisible closed octagonal hull that wraps the whole roof with a
      // margin (double-sided: hit from outside and from under the eaves) keeps the camera out of it.
      const hb = this._roofHull;
      if (hb) {
        // octagonal lathe: flat underside below the dancheong beam ring (창방), a rim that also covers the upturned
        // corners (앙곡), and a cone above the concave tiles up to the finial
        const R = hb.Rc + 0.6, yLo = (hb.yTop ?? hb.yE) - 0.48, yRim = hb.yE + (hb.lift || 0.62) + 0.45;
        const prof = [[0.02, hb.yA + 0.6], [R * 0.42, hb.yE + (hb.yA - hb.yE) * 0.62], [R, yRim], [R, yLo], [0.02, yLo]].map(([r, y]) => new THREE.Vector2(r, y));
        const g = new THREE.LatheGeometry(prof, 8, hb.A0, TAU);
        g.translate(hb.cx, 0, hb.cz);
        const hull = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false }));
        hull.name = 'manjangdae-roof-hull';
        hull.visible = false; hull.castShadow = false; hull.receiveShadow = false; hull.frustumCulled = false;
        hull.userData.cameraOnly = true;
        this.root.add(hull);
        hull.updateMatrixWorld(true);
        this.meshes.roofHull = hull;
        G.world.cameraBlockers.push(hull);
      }
      const px = this._camProxy;
      if (px && px.length) {
        const parts = [];
        for (const q of px) {
          const g = q.kind === 'col' ? new THREE.CylinderGeometry(q.r, q.r, q.h, 6, 1) : new THREE.IcosahedronGeometry(1, 0);
          if (q.kind === 'col') g.translate(q.x, q.y + q.h / 2, q.z);
          else { g.scale(q.rx, q.ry, q.rx); g.translate(q.x, q.y, q.z); }
          parts.push(g.index ? g.toNonIndexed() : g);
          if (g.index) g.dispose();
        }
        let geo = null;
        try { geo = parts.length === 1 ? parts[0] : BGU.mergeGeometries(parts, false); } catch (e) { G.log.warn('WORLD', 'manjangdae: camera proxies failed', e); }
        if (geo !== parts[0]) for (const g of parts) g.dispose();
        if (geo) {
          geo.computeBoundingBox(); geo.computeBoundingSphere();
          const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false }));
          m.name = 'manjangdae-camera-proxies';
          m.visible = false; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
          m.userData.cameraOnly = true;
          this.root.add(m);
          m.updateMatrixWorld(true);
          this.meshes.cameraProxies = m;
          G.world.cameraBlockers.push(m);
        }
      }
      this._camProxy = null;
    },
    _col(c) { const id = G.world.addCollider({ tag: 'manjangdae', ...c }); this.colliders.push(id); return id; },
    /** a geometry that already carries vertex colours -> non-indexed position/normal/color only */
    _pushColored(bucket, geo) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      bucket.parts.push(g);
      if (g !== geo) geo.dispose();
    },
    _walk(w) { const id = G.world.addWalkable({ surface: 'stone', ...w }); this.walkables.push(id); return id; },

    // ============================================================== plateau: paving, retaining ring, balustrade
    _buildPlateau(md, top) {
      const B = this.B, rnd = this.rnd;
      const cx = md.x, cz = md.z, R = md.r;
      const gapB = md.gap?.bearing ?? -PI * 0.75, gapH = md.gap?.half ?? 0.17;
      // paving disc (texture, own mesh)
      const disc = new THREE.CircleGeometry(R - 0.05, this._low ? 40 : 72);
      disc.rotateX(-PI / 2);
      const pave = new THREE.Mesh(disc, this.mats.paving);
      pave.position.set(cx, top + 0.025, cz);
      pave.receiveShadow = true; pave.name = 'manjangdae-paving';
      pave.matrixAutoUpdate = false; pave.updateMatrix();
      this.root.add(pave); this.meshes.paving = pave;
      // retaining ring (석축) + coping, open at the path gap
      const a0 = gapB + gapH, a1 = gapB + TAU - gapH, nSeg = this._low ? 48 : 96;
      const wall = surface(nSeg, 3, (u, v, o) => {
        const a = lerp(a0, a1, u), r = R + 0.18 + v * 0.12;
        o.x = cx + Math.sin(a) * r; o.z = cz + Math.cos(a) * r; o.y = top + 0.16 - v * 2.4;
        o.u = (u * (a1 - a0) * R) / 1.6; o.v = v * 1.5;
      });
      orient(wall, _v3.set(0, 0, 0)); // (radial orientation checked below)
      { // outward normals: compare with the radial direction at the middle vertex
        wall.computeVertexNormals();
        const n = wall.attributes.normal, p = wall.attributes.position, k = Math.floor(p.count / 2);
        const rx = p.getX(k) - cx, rz = p.getZ(k) - cz;
        if (n.getX(k) * rx + n.getZ(k) * rz < 0) { const a = wall.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } wall.computeVertexNormals(); }
      }
      B.stone.add(wall, null, '#a8a195', 0);
      const cop = surface(nSeg, 1, (u, v, o) => {
        const a = lerp(a0, a1, u), r = lerp(R - 0.3, R + 0.36, v);
        o.x = cx + Math.sin(a) * r; o.z = cz + Math.cos(a) * r; o.y = top + 0.16;
      });
      orient(cop, _v3.set(0, 1, 0));
      B.stone.add(cop, null, '#c9c3b6', 0);
      // balustrade (돌난간): posts every ~2 m on the chords, top / bottom rails and little 동자 posts; colliders per chord
      const rr = R - 0.12, span = a1 - a0;
      const nPost = Math.max(6, Math.round((span * rr) / 2.05));
      const postGeo = new THREE.BoxGeometry(0.22, 1.0, 0.22), capGeo = new THREE.IcosahedronGeometry(0.15, 0), dongGeo = new THREE.BoxGeometry(0.09, 0.46, 0.09);
      let prev = null;
      for (let i = 0; i <= nPost; i++) {
        const a = a0 + span * (i / nPost);
        const [px, pz] = bearingPt(cx, cz, rr, a);
        const end = i === 0 || i === nPost;
        B.stone.add(postGeo, M(px, top + 0.66, pz, 0, a, 0, end ? 1.35 : 1, end ? 1.18 : 1, end ? 1.35 : 1), '#c6bfb0', 0.05, rnd);
        B.stone.add(capGeo, M(px, top + (end ? 1.38 : 1.25), pz, 0, a, 0, end ? 1.3 : 1, 1.2, end ? 1.3 : 1), '#bfb8a8', 0.05, rnd);
        if (prev) {
          const mx = (px + prev[0]) / 2, mz = (pz + prev[1]) / 2, len = Math.hypot(px - prev[0], pz - prev[1]);
          const ra = Math.atan2(mx - cx, mz - cz); // radial bearing of the chord
          B.stone.add(new THREE.BoxGeometry(len, 0.11, 0.13), M(mx, top + 1.02, mz, 0, ra, 0), '#cbc4b5', 0.04, rnd);
          B.stone.add(new THREE.BoxGeometry(len, 0.16, 0.18), M(mx, top + 0.3, mz, 0, ra, 0), '#b8b1a2', 0.04, rnd);
          const nd = Math.max(1, Math.round(len / 0.62) - 1);
          for (let k = 1; k <= nd; k++) {
            const t = k / (nd + 1);
            B.stone.add(dongGeo, M(lerp(prev[0], px, t), top + 0.61, lerp(prev[1], pz, t), 0, ra, 0), '#c1baab', 0.04, rnd);
          }
          this._col({ shape: 'box', x: mx, z: mz, hw: len / 2 + 0.08, hd: 0.13, rot: ra });
        }
        prev = [px, pz];
      }
      postGeo.dispose(); capGeo.dispose(); dongGeo.dispose();
      // walkable plateau (the paving sits 2.5 cm above the terrain; feet stay on the stone)
      this._walk({ shape: 'circle', x: cx, z: cz, r: R - 0.1, top: top + 0.02 });
    },

    // ============================================================== 팔각정 (octagonal pavilion)
    _buildPavilion(md, top) {
      const B = this.B, rnd = this.rnd, P = md.pavilion;
      const cx = P.x, cz = P.z, base = P.base || 0.62;
      const A0 = PI / 8;                              // corners at 22.5° + k·45°: flat sides face N / E / S / W
      const yF = top + base;                          // floor level
      const colR = P.r || 3.9, colH = 2.72;
      const RED = '#8c3a2b', GREEN = '#2f6f5f', DGREEN = '#24574b', WHITE = '#efe8d8', GOLD = '#d9a441';
      // ---- stone base (기단) + coping + steps
      B.stone.add(new THREE.CylinderGeometry(colR + 0.62, colR + 0.78, base - 0.08, 8, 1, false, A0), M(cx, top + (base - 0.08) / 2, cz), '#b9b2a4', 0.03, rnd);
      B.stone.add(new THREE.CylinderGeometry(colR + 0.7, colR + 0.7, 0.1, 8, 1, false, A0), M(cx, yF - 0.05, cz), '#d3cdc0', 0.02, rnd);
      const ap = (colR + 0.7) * Math.cos(PI / 8);       // apothem of the coping
      for (const side of [PI, 0]) {                     // north + south steps
        const [sx, sz] = bearingPt(cx, cz, ap + 0.32, side);
        B.stone.add(new THREE.BoxGeometry(2.3, base / 2, 0.62), M(sx, top + base / 4, sz, 0, side, 0), '#cbc4b6', 0.03, rnd);
        this._walk({ shape: 'box', x: sx, z: sz, hw: 1.15, hd: 0.33, rot: side, top: top + base / 2 });
      }
      this._walk({ shape: 'circle', x: cx, z: cz, r: ap - 0.02, top: yF });
      // floor (우물마루)
      B.paint.add(new THREE.CylinderGeometry(colR + 0.45, colR + 0.45, 0.06, 8, 1, false, A0), M(cx, yF + 0.005, cz), '#9b6a40', 0);
      for (let k = -3; k <= 3; k++) B.paint.add(new THREE.BoxGeometry(0.06, 0.012, (colR + 0.2) * 2 * Math.cos(Math.abs(k) / 3.6)), M(cx + k * 1.0, yF + 0.04, cz), '#7a5130', 0);
      // ---- columns + 초석 + colliders
      const cols = [];
      for (let k = 0; k < 8; k++) {
        const a = A0 + k * (PI / 4);
        const [x, z] = bearingPt(cx, cz, colR, a);
        cols.push([x, z, a]);
        B.stone.add(new THREE.CylinderGeometry(0.27, 0.31, 0.14, 8), M(x, yF + 0.07, z), '#c2bbad', 0.04, rnd);
        B.paint.add(new THREE.CylinderGeometry(0.16, 0.175, colH, 12), M(x, yF + 0.14 + colH / 2, z), RED, 0.03, rnd);
        this._col({ shape: 'circle', x, z, r: 0.22, minY: yF - 0.4 });
        this._camProxy.push({ kind: 'col', x, z, r: 0.24, y: yF, h: colH + 0.2 });
      }
      const yTop = yF + 0.14 + colH;                     // column tops
      // ---- railing (계자난간) on the floor edge, open at the north and south steps
      const railR = colR + 0.32;
      for (let k = 0; k < 8; k++) {
        const aMid = (k + 1) * (PI / 4);                 // side mid bearing
        const sideMid = ((aMid % TAU) + TAU) % TAU;
        if (Math.abs(sideMid - PI) < 0.1 || sideMid < 0.1 || Math.abs(sideMid - TAU) < 0.1) continue; // N / S open
        const [ax, az] = bearingPt(cx, cz, railR, A0 + k * (PI / 4)), [bx, bz] = bearingPt(cx, cz, railR, A0 + (k + 1) * (PI / 4));
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
        B.paint.add(new THREE.BoxGeometry(len, 0.08, 0.1), M(mx, yF + 0.62, mz, 0, aMid, 0), RED, 0);
        B.paint.add(new THREE.BoxGeometry(len, 0.07, 0.08), M(mx, yF + 0.18, mz, 0, aMid, 0), RED, 0);
        for (let i = 1; i < 5; i++) { const t = i / 5; B.paint.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), M(lerp(ax, bx, t), yF + 0.4, lerp(az, bz, t), 0, aMid, 0), GREEN, 0); }
        this._col({ shape: 'box', x: mx, z: mz, hw: len / 2, hd: 0.1, rot: aMid });
      }
      // ---- beams: 창방 (dancheong), 평방 (dancheong), 도리 (green) between the columns
      for (let k = 0; k < 8; k++) {
        const [ax, az] = cols[k], [bx, bz] = cols[(k + 1) % 8];
        const aMid = (k + 1) * (PI / 4);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
        B.beam.add(new THREE.BoxGeometry(len + 0.12, 0.32, 0.22), M(mx, yTop - 0.2, mz, 0, aMid, 0), '#ffffff', 0);
        const [px, pz] = bearingPt(cx, cz, colR * Math.cos(PI / 8) + 0.02, aMid);
        B.beam.add(new THREE.BoxGeometry(len + 0.2, 0.17, 0.3), M(px, yTop + 0.08, pz, 0, aMid, 0), '#ffffff', 0);
        const [dx, dz] = bearingPt(cx, cz, colR * Math.cos(PI / 8) + 0.14, aMid);
        const dg = new THREE.CylinderGeometry(0.13, 0.13, len + 0.45, 10); dg.rotateZ(PI / 2);
        B.paint.add(dg, M(dx, yTop + 0.47, dz, 0, aMid, 0), DGREEN, 0);
        // 화반 (decorative block) on the mid of each side
        const [hx, hz] = bearingPt(cx, cz, colR * Math.cos(PI / 8) + 0.04, aMid);
        B.paint.add(new THREE.BoxGeometry(0.48, 0.2, 0.16), M(hx, yTop + 0.27, hz, 0, aMid, 0), RED, 0);
        B.paint.add(new THREE.BoxGeometry(0.3, 0.06, 0.18), M(hx, yTop + 0.38, hz, 0, aMid, 0), GOLD, 0);
      }
      // ---- brackets (주두 + 익공) on every column
      for (const [x, z, a] of cols) {
        B.paint.add(new THREE.BoxGeometry(0.4, 0.16, 0.4), M(x, yTop + 0.02, z, 0, a, 0), GREEN, 0.04, rnd);
        const [ex, ez] = bearingPt(cx, cz, colR + 0.28, a);
        B.paint.add(new THREE.BoxGeometry(0.15, 0.22, 0.95), M(ex, yTop + 0.18, ez, 0, a, 0), GREEN, 0.04, rnd);
        const [tx, tz] = bearingPt(cx, cz, colR + 0.72, a);
        B.paint.add(new THREE.BoxGeometry(0.16, 0.12, 0.16), M(tx, yTop + 0.16, tz, 0, a, 0), RED, 0);
        B.paint.add(new THREE.BoxGeometry(0.17, 0.05, 0.62), M(ex, yTop + 0.3, ez, 0, a, 0), WHITE, 0);
        B.paint.add(new THREE.BoxGeometry(0.26, 0.12, 0.26), M(x, yTop + 0.36, z, 0, a, 0), GOLD, 0);
      }
      // ---- roof: 8 concave facets, upturned corners (앙곡), inward-bowed eaves (안허리), tile texture
      const yE = yTop + 0.62, yA = yTop + 3.35, lift = 0.62, Rc = colR + 2.05, bow = 0.2, VMAX = 0.94;
      this._roofHull = { cx, cz, Rc, yE, yA, A0, lift, yTop };
      const corner = (k, r) => bearingPt(cx, cz, r, A0 + k * (PI / 4));
      const eaveAt = (k, u, out) => {
        const [ax, az] = corner(k, Rc), [bx, bz] = corner(k + 1, Rc);
        let x = lerp(ax, bx, u), z = lerp(az, bz, u);
        const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
        const b = bow * Math.sin(PI * u);
        x -= (dx / l) * b; z -= (dz / l) * b;
        out.x = x; out.z = z; out.y = yE + lift * Math.pow(Math.abs(2 * u - 1), 2.4);
        return out;
      };
      const _ea = { x: 0, y: 0, z: 0 };
      const roofPoint = (k, u, v, o, drop = 0) => {
        eaveAt(k, u, _ea);
        const vv = v * VMAX;
        o.x = lerp(_ea.x, cx, vv); o.z = lerp(_ea.z, cz, vv);
        o.y = _ea.y + (yA - _ea.y) * Math.pow(vv, 1.55) - drop;
      };
      const sideLen = 2 * Rc * Math.sin(PI / 8);
      const slant = Math.hypot(Rc - 0.4, yA - yE);
      for (let k = 0; k < 8; k++) {
        const facet = surface(this._low ? 8 : 14, this._low ? 7 : 12, (u, v, o) => { roofPoint(k, u, v, o); o.u = u * (sideLen / 0.36); o.v = v * (slant / 0.42); });
        orient(facet, _v3.set(0, 1, 0));
        B.roof.add(facet, null, '#ffffff', 0);
        // fascia under the eave edge (dark green) + soffit boards (뇌록) up to the 도리
        const fascia = surface(this._low ? 8 : 14, 1, (u, v, o) => { eaveAt(k, u, o); o.y -= v * 0.17; });
        { fascia.computeVertexNormals(); const p = fascia.attributes.position, n = fascia.attributes.normal, j = 3; if (n.getX(j) * (p.getX(j) - cx) + n.getZ(j) * (p.getZ(j) - cz) < 0) { const a = fascia.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } fascia.computeVertexNormals(); } }
        B.paint.add(fascia, null, DGREEN, 0);
        const soffit = surface(this._low ? 8 : 14, 3, (u, v, o) => {
          eaveAt(k, u, _ea);
          const [ix, iz] = (() => { const [p0x, p0z] = corner(k, colR + 0.05), [p1x, p1z] = corner(k + 1, colR + 0.05); return [lerp(p0x, p1x, u), lerp(p0z, p1z, u)]; })();
          o.x = lerp(_ea.x, ix, v); o.z = lerp(_ea.z, iz, v); o.y = lerp(_ea.y - 0.17, yTop + 0.62, v);
        });
        orient(soffit, _v3.set(0, -1, 0));
        B.paint.add(soffit, null, '#3f7f6c', 0);
        // hip ridge (추녀마루) along the corner line
        const ridgePts = [], radii = [];
        for (let i = 0; i <= 12; i++) { const o = { x: 0, y: 0, z: 0 }; roofPoint(k, 0, i / 12, o); o.y += 0.1; ridgePts.push(o); radii.push(lerp(0.15, 0.1, i / 12)); }
        // tip extends a little past the eave corner, curling up
        const t0 = ridgePts[0], t1 = ridgePts[1];
        ridgePts.unshift({ x: t0.x + (t0.x - t1.x) * 0.55, y: t0.y + 0.16, z: t0.z + (t0.z - t1.z) * 0.55 }); radii.unshift(0.11);
        B.paint.add(taperTube(ridgePts, radii, 7), null, '#e6e1d5', 0);
        // rafters (서까래) under the facet + painted rafter ends
        const nr = this._low ? 5 : 8;
        for (let i = 0; i < nr; i++) {
          const u = (i + 0.5) / nr;
          eaveAt(k, u, _ea);
          const [p0x, p0z] = corner(k, colR - 0.05), [p1x, p1z] = corner(k + 1, colR - 0.05);
          const ix = lerp(p0x, p1x, u), iz = lerp(p0z, p1z, u);
          const ox = lerp(ix, _ea.x, 0.96), oz = lerp(iz, _ea.z, 0.96), oy = _ea.y - 0.24;
          const mm = between(ix, yTop + 0.55, iz, ox, oy, oz, 0.07);
          if (mm) B.paint.add(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), mm, DGREEN, 0.05, rnd);
          const me = between(ox, oy, oz, ox + (ox - ix) * 0.012, oy + (oy - yTop - 0.55) * 0.012, oz + (oz - iz) * 0.012, 0.072);
          if (me) B.rafterEnd.add(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false), me, '#ffffff', 0);
        }
      }
      // inner ceiling (우물천장) seen from inside the pavilion
      const ceil = new THREE.CylinderGeometry(colR + 0.05, colR + 0.05, 0.04, 8, 1, false, A0);
      B.paint.add(ceil, M(cx, yTop + 0.63, cz), '#3a7a68', 0);
      for (let k = 0; k < 4; k++) B.paint.add(new THREE.BoxGeometry(0.08, 0.05, colR * 2), M(cx, yTop + 0.6, cz, 0, k * (PI / 4), 0), RED, 0);
      // finial (절병통) on a plastered cap
      const capY = yA - 0.18;
      B.paint.add(new THREE.CylinderGeometry(0.5, 0.62, 0.32, 8, 1, false, A0), M(cx, capY, cz), '#e6e1d5', 0);
      const prof = [[0.001, 0], [0.34, 0], [0.38, 0.08], [0.22, 0.2], [0.33, 0.38], [0.34, 0.5], [0.19, 0.66], [0.24, 0.73], [0.13, 0.88], [0.15, 0.94], [0.05, 1.06], [0.001, 1.14]].map(([r, y]) => new THREE.Vector2(r, y));
      B.paint.add(new THREE.LatheGeometry(prof, 12), M(cx, capY + 0.14, cz, 0, 0, 0, 1, 1.05, 1), '#4f4b45', 0);
      // 현판 (name board) under the north eave + 청사초롱 lanterns hanging inside
      const [hbx, hbz] = bearingPt(cx, cz, colR * Math.cos(PI / 8) + 0.2, PI);
      B.paint.add(new THREE.BoxGeometry(1.5, 0.56, 0.08), M(hbx, yTop - 0.62, hbz, -0.12, PI, 0), '#2a2420', 0);
      this._hyeonpan(hbx, yTop - 0.62, hbz);
      for (const s of [-1, 1]) {
        const lx = cx + s * 1.25, lz = cz - 0.6, ly = yTop - 0.65;
        B.paint.add(new THREE.CylinderGeometry(0.005, 0.005, 0.7, 4), M(lx, ly + 0.55, lz), '#222', 0);
        B.paint.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), M(lx, ly + 0.22, lz), '#2c4f9e', 0);
        B.paint.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), M(lx, ly - 0.22, lz), '#b2302a', 0);
        B.glow.add(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 12), M(lx, ly, lz), '#ffffff', 0);
      }
      // one warm light inside the pavilion at night (medium / high)
      if (!this._low) {
        const pl = new THREE.PointLight(0xffc27a, 0, 13, 1.6);
        pl.position.set(cx, yTop - 0.4, cz);
        pl.castShadow = false;
        this.root.add(pl);
        G.world.addNightLight(pl, 5.5);
      }
      this.pavilionTop = yA + 1.3;
    },
    _hyeonpan(x, y, z) {
      const tex = G.gfx.canvasTexture(512, 192, (ctx, w, h) => {
        ctx.fillStyle = '#231d1a'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#c99a3f'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = '#e7bf6a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `700 118px ${SERIF}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '22px';
        ctx.fillText('萬丈臺', w / 2 + 11, h / 2 + 6);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.46), G.gfx.material('md-hyeonpan', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      m.position.set(x, y, z - 0.045);
      m.rotation.set(0.12, PI, 0, 'YXZ');
      m.name = 'manjangdae-hyeonpan';
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.root.add(m);
    },

    // ============================================================== 표지석 (marker stone)
    _buildMarker(md, top) {
      const mk = md.marker;
      if (!mk) return;
      const rot = mk.rot || 0, B = this.B;
      const x = mk.x, z = mk.z;
      // granite plinth
      B.stone.add(new THREE.BoxGeometry(2.7, 0.24, 1.3), M(x, top + 0.12, z, 0, rot, 0), '#bdb6a8', 0.02, this.rnd);
      // natural rock with a flattened, slightly tilted carving face (local +Z)
      const g = new THREE.IcosahedronGeometry(1, this._low ? 2 : 3);
      const p = g.attributes.position, nz = G.sys.terrain?.noise3 || ((a, b, c) => Math.sin(a * 3.1 + b * 1.7 + c * 2.3) * 0.5);
      for (let i = 0; i < p.count; i++) {
        let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const n = nz(vx * 1.7 + 3, vy * 1.7, vz * 1.7 - 2) * 0.16 + nz(vx * 4.1, vy * 4.1 + 7, vz * 4.1) * 0.05;
        vx *= 1.18 * (1 + n); vy *= 0.92 * (1 + n * 0.8); vz *= 0.5 * (1 + n * 0.6);
        if (vz > 0.34) vz = 0.34 + (vz - 0.34) * 0.12;                // carving face
        if (vy < -0.62) vy = -0.62;                                     // flat bottom on the plinth
        p.setXYZ(i, vx, vy, vz);
      }
      g.computeVertexNormals();
      B.stone.add(g, M(x, top + 0.24 + 0.62, z, -0.08, rot, 0), '#9a958b', 0);
      g.dispose();
      // carved text plane on the face
      const tp = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), this.mats.text);
      const fx = Math.sin(rot), fz = Math.cos(rot);
      tp.position.set(x + fx * 0.36, top + 0.24 + 0.66, z + fz * 0.36);
      tp.rotation.set(-0.08, rot, 0, 'YXZ');
      tp.name = 'manjangdae-marker-text'; tp.renderOrder = 2;
      tp.matrixAutoUpdate = false; tp.updateMatrix();
      this.root.add(tp);
      this.meshes.markerHit = tp;
      this._col({ shape: 'box', x, z, hw: 1.3, hd: 0.62, rot });
    },

    // ============================================================== 암벽 (crags): rock outcrops on the steep valley face below the deck
    _buildCrags(md, top) {
      const T = G.sys.terrain?.manjangdae, W = G.world, B = this.B;
      const nz = G.sys.terrain?.noise3 || ((a, b, c) => Math.sin(a * 3.1 + b * 1.7 + c * 2.3) * 0.5);
      const rnd = G.util.rng(910);
      const n = this._low ? 10 : 18;
      const base = new THREE.IcosahedronGeometry(1, 1);          // faceted, like the valley's boulders
      const placed = [];
      let tries = 0;
      while (placed.length < n && tries++ < n * 12) {
        const b = PI + (rnd() - 0.5) * 1.9;                       // around north (the valley side)
        const r = md.r + 1.6 + rnd() * rnd() * 15;
        const [x, z] = bearingPt(md.x, md.z, r, b);
        const y = W.terrainHeight(x, z);
        if (!fin(y)) continue;
        const s = (1.1 + rnd() * 1.9) * (r < md.r + 5 ? 0.8 : 1);
        if (y + s * 0.62 > top - 1.25) continue;                  // never rises into the view from the deck
        if (T?.nearest && T.nearest(x, z).d < T.hw + 1.4 + s) continue;   // keep the stair path clear
        if (placed.some((q) => Math.hypot(q[0] - x, q[1] - z) < (q[2] + s) * 0.9)) continue;
        placed.push([x, z, s]);
        const g = base.clone();
        const p = g.attributes.position, sd = rnd() * 50;
        for (let i = 0; i < p.count; i++) {
          let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
          const k = 1 + nz(vx * 1.1 + sd, vy * 1.1, vz * 1.1 - sd) * 0.42 + nz(vx * 2.9, vy * 2.9 + sd, vz * 2.9) * 0.12;
          vx *= k * 1.35; vy *= k * 0.72; vz *= k;
          if (vy > 0.38) vy = 0.38 + (vy - 0.38) * 0.3;              // sheared, layered tops (bedded rock)
          p.setXYZ(i, vx, vy, vz);
        }
        g.computeVertexNormals();
        // weathered grey-brown schist; sRGB lightness so it sits with the valley's boulders
        const c = new THREE.Color().setHSL(0.08 + rnd() * 0.04, 0.05 + rnd() * 0.06, 0.44 + rnd() * 0.1, THREE.SRGBColorSpace);
        // tilted into the slope (outcrops lean out of the hill, they are not dropped on it)
        const tilt = 0.18 + rnd() * 0.22;
        B.stone.add(g, M(x, y - s * 0.4, z, Math.cos(b) * tilt, b + (rnd() - 0.5) * 0.8, -Math.sin(b) * tilt * 0.6, s, s * (0.8 + rnd() * 0.4), s * (0.8 + rnd() * 0.3)), c, 0);
        g.dispose();
        // walk-blocking only at the rock's own height (never reaches the deck above)
        this._col({ shape: 'circle', x, z, r: s * 1.15, minY: y - 1, maxY: y + s * 0.5 });
      }
      base.dispose();
    },

    // ============================================================== 석등 (stone lanterns): pavilion pair, path gap pair, hairpins
    _buildLanterns(md, top) {
      const list = (md.lanterns || []).map((l) => ({ x: l.x, z: l.z, y: top, big: true }));
      const gapB = md.gap?.bearing ?? -PI * 0.75, gapH = md.gap?.half ?? 0.17;
      for (const s of [-1, 1]) { const [x, z] = bearingPt(md.x, md.z, md.r - 0.95, gapB + s * (gapH + 0.07)); list.push({ x, z, y: top, big: true }); }
      // low path lights on the outer side of every switchback (the original corner points)
      // (the corners are filleted, so each light stands just outside the curve, beside the fence)
      const route = md.route || [], T = G.sys.terrain?.manjangdae;
      for (let i = 1; i < route.length - 1; i++) {
        let [x, z] = route[i];
        if (T?.nearest) {
          const nn = T.nearest(x, z), dx = x - nn.x, dz = z - nn.z, d = Math.hypot(dx, dz);
          if (d > 0.3) { const k = Math.min(d, T.hw + 0.85) / d; x = nn.x + dx * k; z = nn.z + dz * k; }
        }
        const y = G.world.terrainHeight(x, z);
        if (fin(y)) list.push({ x, z, y, big: false });
      }
      const B = this.B, rnd = this.rnd;
      for (const l of list) {
        const s = l.big ? 1 : 0.62, x = l.x, z = l.z, y = l.y;
        B.stone.add(new THREE.CylinderGeometry(0.34 * s, 0.4 * s, 0.18 * s, 8), M(x, y + 0.09 * s, z), '#bcb5a7', 0.04, rnd);
        B.stone.add(new THREE.CylinderGeometry(0.12 * s, 0.15 * s, 0.82 * s, 8), M(x, y + 0.59 * s, z), '#c7c0b2', 0.04, rnd);
        B.stone.add(new THREE.CylinderGeometry(0.3 * s, 0.24 * s, 0.12 * s, 8), M(x, y + 1.06 * s, z), '#bdb6a8', 0.04, rnd);
        // light chamber (화사석): four posts around a glowing core
        for (let k = 0; k < 4; k++) { const a = PI / 4 + k * (PI / 2); B.stone.add(new THREE.BoxGeometry(0.09 * s, 0.4 * s, 0.09 * s), M(x + Math.sin(a) * 0.17 * s, y + 1.32 * s, z + Math.cos(a) * 0.17 * s), '#cbc4b6', 0.03, rnd); }
        B.glow.add(new THREE.BoxGeometry(0.24 * s, 0.32 * s, 0.24 * s), M(x, y + 1.32 * s, z), '#ffffff', 0);
        B.stone.add(new THREE.CylinderGeometry(0.06 * s, 0.46 * s, 0.24 * s, 8), M(x, y + 1.64 * s, z), '#b7b0a2', 0.04, rnd);
        B.stone.add(new THREE.SphereGeometry(0.09 * s, 8, 6), M(x, y + 1.82 * s, z), '#bdb6a8', 0.03, rnd);
        this._col({ shape: 'circle', x, z, r: 0.38 * s });
      }
    },

    // ============================================================== 소나무 (Korean red pines)
    _buildPines(md, top) {
      const B = this.B, rnd = G.util.rng(77);
      for (const pn of md.pines || []) {
        const s = pn.s || 1, x0 = pn.x, z0 = pn.z;
        const y0 = this._groundY(x0, z0, top);
        // lean outwards from the plateau centre
        let lx = x0 - md.x, lz = z0 - md.z; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
        const lean = pn.lean || 0.15, H = 6.4 * s;
        const pts = [], radii = [];
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const bend = Math.sin(t * PI * 1.3) * 0.35 * s;
          pts.push({ x: x0 + lx * (lean * H * t * t + bend * 0.4) + Math.cos(t * 5 + x0) * 0.12 * s, y: y0 - 0.15 + H * t, z: z0 + lz * (lean * H * t * t + bend * 0.4) + Math.sin(t * 4 + z0) * 0.12 * s });
          radii.push(lerp(0.3, 0.09, t) * s);
        }
        const trunk = taperTube(pts, radii, this._low ? 6 : 8);
        // bark: grey-brown at the foot, the red-orange of 적송 higher up
        const tp = trunk.attributes.position, col = new Float32Array(tp.count * 3), c0 = new THREE.Color('#5d4637'), c1 = new THREE.Color('#b0603e'), cc = new THREE.Color();
        for (let i = 0; i < tp.count; i++) { const t = clamp((tp.getY(i) - y0) / H, 0, 1); cc.copy(c0).lerp(c1, smooth(0.15, 0.7, t)); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
        trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this._pushColored(B.bark, trunk);
        // branches + flat cloud-like canopy pads
        const pads = [];
        const top3 = pts[n];
        pads.push([top3.x, top3.y + 0.2 * s, top3.z, 2.1 * s, 0.75 * s]);
        const nb = this._low ? 3 : 5;
        for (let b = 0; b < nb; b++) {
          const t = 0.55 + (b / nb) * 0.35, i = Math.round(t * n), q = pts[i];
          const a = rnd() * TAU, len = (1.4 + rnd() * 1.2) * s;
          const ex = q.x + Math.sin(a) * len, ez = q.z + Math.cos(a) * len, ey = q.y + (0.3 + rnd() * 0.5) * s;
          const br = taperTube([{ x: q.x, y: q.y, z: q.z }, { x: lerp(q.x, ex, 0.55), y: lerp(q.y, ey, 0.4), z: lerp(q.z, ez, 0.55) }, { x: ex, y: ey, z: ez }], [0.09 * s, 0.06 * s, 0.035 * s], 5);
          const bp = br.attributes.position, bc = new Float32Array(bp.count * 3);
          for (let k = 0; k < bp.count; k++) { bc[k * 3] = c1.r * 0.85; bc[k * 3 + 1] = c1.g * 0.85; bc[k * 3 + 2] = c1.b * 0.85; }
          br.setAttribute('color', new THREE.BufferAttribute(bc, 3));
          this._pushColored(B.bark, br);
          pads.push([ex, ey + 0.15 * s, ez, (1.3 + rnd() * 0.6) * s, (0.5 + rnd() * 0.2) * s]);
        }
        for (const [px, py, pz, rr, hh] of pads) {
          const g = new THREE.IcosahedronGeometry(1, this._low ? 1 : 2);
          const gp = g.attributes.position;
          for (let i = 0; i < gp.count; i++) {
            const vx = gp.getX(i), vy = gp.getY(i), vz = gp.getZ(i);
            const k = 1 + Math.sin(vx * 5.1 + px) * 0.09 + Math.cos(vz * 4.3 + pz) * 0.09;
            gp.setXYZ(i, vx * rr * k, (vy < 0 ? vy * 0.45 : vy) * hh * k, vz * rr * k);
          }
          g.computeVertexNormals();
          const shade = 0.82 + rnd() * 0.3;
          B.needles.add(g, M(px, py, pz, 0, rnd() * TAU, 0), new THREE.Color('#2f5a2c').multiplyScalar(shade), 0);
          g.dispose();
          this._camProxy.push({ kind: 'pad', x: px, y: py, z: pz, rx: rr * 1.12, ry: hh * 1.15 });
        }
        this._col({ shape: 'circle', x: x0, z: z0, r: 0.34 * s });
      }
    },

    // ============================================================== 망원경 (coin telescope)
    _buildTelescope(md, top) {
      const tl = md.telescope;
      if (!tl) return;
      const B = this.B, rot = tl.rot ?? PI, x = tl.x, z = tl.z;
      const fx = Math.sin(rot), fz = Math.cos(rot);
      const GREEN = '#2e5c4b', BRASS = '#c9a24e', DARK = '#26292c';
      B.stone.add(new THREE.CylinderGeometry(0.42, 0.48, 0.14, 10), M(x, top + 0.07, z), '#bdb6a8', 0.03, this.rnd);
      B.metal.add(new THREE.CylinderGeometry(0.07, 0.09, 0.98, 10), M(x, top + 0.63, z), GREEN, 0);
      B.metal.add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 10), M(x, top + 1.12, z), BRASS, 0);
      // head: body box + twin barrels (forward = rot) + eyepiece hood (back)
      const hy = top + 1.3;
      B.metal.add(new THREE.BoxGeometry(0.44, 0.24, 0.3), M(x, hy, z, -0.12, rot, 0), GREEN, 0);
      for (const s of [-1, 1]) {
        const bx = x + Math.cos(rot) * s * 0.11 + fx * 0.22, bz = z - Math.sin(rot) * s * 0.11 + fz * 0.22;
        const g = new THREE.CylinderGeometry(0.075, 0.068, 0.34, 12); g.rotateX(PI / 2);
        B.metal.add(g, M(bx, hy + 0.03, bz, -0.12, rot, 0), GREEN, 0);
        const r = new THREE.CylinderGeometry(0.082, 0.082, 0.03, 12); r.rotateX(PI / 2);
        B.metal.add(r, M(bx + fx * 0.17, hy + 0.05, bz + fz * 0.17, -0.12, rot, 0), BRASS, 0);
        const eye = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10); eye.rotateX(PI / 2);
        B.metal.add(eye, M(x + Math.cos(rot) * s * 0.11 - fx * 0.19, hy - 0.01, z - Math.sin(rot) * s * 0.11 - fz * 0.19, -0.12, rot, 0), DARK, 0);
      }
      B.metal.add(new THREE.BoxGeometry(0.5, 0.04, 0.36), M(x, hy + 0.14, z, -0.12, rot, 0), BRASS, 0);
      this._col({ shape: 'circle', x, z, r: 0.36 });
      // invisible hit box for clicks
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x, top + 0.75, z); hit.name = 'manjangdae-telescope-hit';
      this.root.add(hit); this.meshes.telescopeHit = hit;
      this.telescopeEye = { x: x - fx * 0.32, y: hy + 0.12, z: z - fz * 0.32, rot };
    },

    // ============================================================== 안내판 (info board)
    _buildBoard(md, top) {
      const bd = md.board;
      if (!bd) return;
      const B = this.B, rot = bd.rot || 0, x = bd.x, z = bd.z;
      const fx = Math.sin(rot), fz = Math.cos(rot), tx = Math.cos(rot), tz = -Math.sin(rot);
      for (const s of [-1, 1]) {
        B.paint.add(new THREE.BoxGeometry(0.12, 1.75, 0.12), M(x + tx * s * 0.86, top + 0.875, z + tz * s * 0.86, 0, rot, 0), '#5b3a22', 0.04, this.rnd);
        B.stone.add(new THREE.BoxGeometry(0.26, 0.12, 0.26), M(x + tx * s * 0.86, top + 0.06, z + tz * s * 0.86, 0, rot, 0), '#bdb6a8', 0.03, this.rnd);
      }
      B.paint.add(new THREE.BoxGeometry(1.86, 1.12, 0.08), M(x - fx * 0.03, top + 1.24, z - fz * 0.03, -0.1, rot, 0), '#6b4a2e', 0);
      // little tiled hood
      B.roof.add(new THREE.BoxGeometry(2.1, 0.08, 0.5), M(x + fx * 0.05, top + 1.86, z + fz * 0.05, 0.22, rot, 0), '#ffffff', 0);
      B.roof.add(new THREE.BoxGeometry(2.1, 0.08, 0.5), M(x - fx * 0.27, top + 1.86, z - fz * 0.27, -0.22, rot, 0), '#ffffff', 0);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 1.02), this.mats.board);
      face.position.set(x + fx * 0.015, top + 1.24, z + fz * 0.015);
      face.rotation.set(-0.1, rot, 0, 'YXZ');
      face.name = 'manjangdae-board-face';
      face.matrixAutoUpdate = false; face.updateMatrix();
      this.root.add(face);
      this.meshes.boardHit = face;
      this._col({ shape: 'box', x, z, hw: 0.98, hd: 0.14, rot: rot });
    },

    // ============================================================== path: stone stair nosings + rope fences (both sides)
    _buildPath(md) {
      const T = G.sys.terrain?.manjangdae;
      if (!T || !T.pts || T.pts.length < 3) return;
      const B = this.B, W = G.world, hw = T.hw;
      const pts = T.pts, n = pts.length;
      const tan = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let x = b[0] - a[0], z = b[1] - a[1]; const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
      // stair nosings every ~0.6 m of arc (decorative granite treads; the walking surface is the carved ramp)
      const stepGeo = new THREE.BoxGeometry(hw * 2 - 0.25, 0.13, 0.3);
      let next = 1.2;
      for (let i = 0; i < n - 1; i++) {
        const s0 = T.s[i], s1 = T.s[i + 1];
        while (next <= s1 && next < T.len - 0.8) {
          const t = (next - s0) / Math.max(1e-6, s1 - s0);
          const x = lerp(pts[i][0], pts[i + 1][0], t), z = lerp(pts[i][1], pts[i + 1][1], t);
          const [dx, dz] = tan(i);
          const y = T.pathY(next);
          B.stone.add(stepGeo, M(x, y + 0.03, z, 0, Math.atan2(dx, dz), 0), '#a59e90', 0.06, this.rnd);
          next += 0.62;
        }
      }
      stepGeo.dispose();
      // rope fences: posts on both sides; skip posts that would stand on the path itself (hairpin insides),
      // near the plateau gap or at the foot; colliders on every span between two kept posts
      const off = hw + 0.28, gap = 2.3;
      const postGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.0, 6);
      for (const side of [-1, 1]) {
        let last = null, sNext = 0.9;
        for (let i = 0; i < n - 1; i++) {
          const s0 = T.s[i], s1 = T.s[i + 1];
          while (sNext <= s1) {
            const t = (sNext - s0) / Math.max(1e-6, s1 - s0);
            const cxp = lerp(pts[i][0], pts[i + 1][0], t), czp = lerp(pts[i][1], pts[i + 1][1], t);
            const [dx, dz] = tan(i);
            const px = cxp + dz * side * off, pz = czp - dx * side * off;
            const sAt = sNext;
            sNext += gap;
            const nn = T.nearest(px, pz);
            const nearPlateau = Math.hypot(px - md.x, pz - md.z) < md.r + 0.6;
            const atFoot = sAt > T.len - 1.6;
            if (nn.d < off - 0.12 || nearPlateau || atFoot) { last = null; continue; }
            const py = W.terrainHeight(px, pz);
            if (!fin(py)) { last = null; continue; }
            B.paint.add(postGeo, M(px, py + 0.5, pz), '#6b4a2e', 0.06, this.rnd);
            if (last && Math.hypot(px - last[0], pz - last[2]) < gap * 1.6) {
              // two sagging ropes
              for (const h of [0.55, 0.92]) {
                const ax = last[0], ay = last[1] + h, az = last[2], bx = px, by = py + h, bz = pz;
                const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2 - 0.09;
                for (const [qx, qy, qz, rx, ry, rz] of [[ax, ay, az, mx, my, mz], [mx, my, mz, bx, by, bz]]) {
                  const mm = between(qx, qy, qz, rx, ry, rz, 0.022);
                  if (mm) B.paint.add(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), mm, '#d8c79a', 0);
                }
              }
              const len = Math.hypot(px - last[0], pz - last[2]);
              // collider whose local X runs along the span: local X = (cos rot, -sin rot)  ->  rot = atan2(-dz, dx)
              this._col({ shape: 'box', x: (px + last[0]) / 2, z: (pz + last[2]) / 2, hw: len / 2 + 0.06, hd: 0.07, rot: Math.atan2(-(pz - last[2]), px - last[0]) });
            }
            last = [px, py, pz];
          }
        }
      }
      postGeo.dispose();
    },

    // ============================================================== intro cinematic
    whenIntroDone() { return this._introDone || Promise.resolve(); },
    _onLogin(isNew) {
      if (!isNew || !this.built) return;
      if (G.flags?.noTutorial || G.flags?.nointro || /[?&]nointro=1/.test(location.search)) return;
      // only when the new player really stands on the deck
      const p = G.sys.player?.position;
      if (!p || Math.hypot(p.x - this.lookout.x, p.z - this.lookout.z) > 6) return;
      setTimeout(() => { if (G.state && G.ready) this.intro(); }, 60);
    },
    /** first-entry cinematic. Resolves {skipped, reduced} when the follow camera has control again. */
    intro(opts = {}) {
      if (this._intro) return this._introDone;
      const cam = G.sys.camera, pl = G.sys.player;
      if (!cam || !pl || !this.built) return Promise.resolve({ skipped: true, reduced: false });
      const reduced = opts.reduced ?? reduceMotion();
      let resolve;
      this._introDone = new Promise((r) => { resolve = r; });
      const it = this._intro = { t: 0, rt0: performance.now(), reduced, resolve, skipped: false, ending: false, said: false, cardIn: false };
      this.introActive = true;
      document.body.classList.add('md-intro');
      G.ui.block('md-intro');
      this._hud(false);
      const ui = this._ensureUi();
      ui.root.hidden = false;
      ui.root.classList.remove('leaving'); ui.root.removeAttribute('aria-hidden');
      ui.root.classList.toggle('reduced', reduced);
      ui.skip.hidden = false;
      ui.title.classList.remove('on');
      requestAnimationFrame(() => { ui.root.classList.add('on'); });
      // skip with any key / tap / click (after a short grace so the login click does not skip it)
      it.armAt = performance.now() + 450;
      it.onKey = (e) => { if (performance.now() < it.armAt || this._intro !== it) return; if (e.type === 'keydown' && /^(F\d+|Shift|Control|Alt|Meta|Tab)$/.test(e.key)) return; e.preventDefault?.(); e.stopPropagation?.(); this._skipIntro(); };
      window.addEventListener('keydown', it.onKey, true);
      ui.root.addEventListener('pointerdown', it.onKey);
      G.bus.emit('manjangdae:intro', { phase: 'start', reduced });
      G.log.info('WORLD', `manjangdae intro start${reduced ? ' (reduced motion)' : ''}`);
      if (reduced) {
        // a short fade instead of flying: title card in 2D, camera cut behind the player
        // (a skip / logout during any await ends this intro: every step after an await checks it is still the one)
        (async () => {
          await G.ui.fade(true, 260);
          if (this._intro !== it) return;
          try { cam.setMode('follow', { duration: 0 }); cam.behind?.(pl.rotY, true); cam.snap?.(); } catch (e) { /* camera optional */ }
          ui.title.classList.add('on');
          await G.ui.fade(false, 420);
          if (this._intro !== it || it.ending) return;
          if (easyOn()) say('정선 만장대에 왔어요! 체험관이 다 보여요.', { priority: 1, intro: true });
          await G.util.sleep(1700);
          if (this._intro === it && !it.ending) this._finishIntro(false);
        })();
      } else {
        this._prepIntroPath();
        // a soft cinematic grade for the flight (eased by the engine, removed at the hand-off)
        try { G.sys.engine?.grade?.({ vignette: 0.14, warmth: 0.08, contrast: 1.03 }, 'md-intro'); } catch (e) { /* grade optional */ }
        G.ui.fade(true, 0).then(() => G.ui.fade(false, 700));
        try { cam.shot(this._introPosCurve.getPoint(0), this._introLookCurve.getPoint(0), { fov: 50, duration: 0 }); } catch (e) { G.log.warn('WORLD', 'intro shot failed', e); }
      }
      return this._introDone;
    },
    _prepIntroPath() {
      if (this._introPosCurve) return;
      const md = MDL(), lk = this.lookout, y = lk.y;
      const P = (x, yy, z) => new THREE.Vector3(x, yy, z);
      // drone: high over the hall, down the valley, up the ridge, around the pavilion, settling behind the player
      this._introPosCurve = new THREE.CatmullRomCurve3([
        P(-6, 66, -96), P(4, 48, -30), P(22, 40, 34), P(40, y + 20, 82), P(70, y + 14, 106), P(70, y + 11, 128), P(md.x + 1.5, y + 8.5, lk.z + 13), P(lk.x, y + 5.6, lk.z + 8.2),
      ], false, 'centripetal');
      this._introLookCurve = new THREE.CatmullRomCurve3([
        P(10, 6, 30), P(30, 10, 80), P(46, y - 2, 110), P(md.x, y + 2, md.z + 2), P(md.pavilion.x, y + 3, md.pavilion.z), P(md.pavilion.x - 2, y + 2.5, md.pavilion.z - 6), P(lk.x, y + 3.4, lk.z - 8), P(lk.x, y + 3.6, lk.z - 22),
      ], false, 'centripetal');
    },
    _skipIntro() {
      const it = this._intro;
      if (!it || it.ending) return;
      it.skipped = true;
      it.ending = true;
      (async () => {
        await G.ui.fade(true, 300);
        this._cardOff(true);
        await G.util.sleep(40);
        if (this._intro === it) this._finishIntro(true, true);
        await G.ui.fade(false, 380);
      })();
    },
    _finishIntro(skipped, cut, logout) {
      const it = this._intro;
      if (!it) return;
      this._intro = null;
      this.introActive = false;
      window.removeEventListener('keydown', it.onKey, true);
      const ui = this._ui;
      if (ui) {
        // the letterbox fades out over ~0.7 s; it stops catching taps right away (the HUD is back now) and leaves
        // the accessibility tree with its skip button
        ui.root.removeEventListener('pointerdown', it.onKey);
        if (ui.root.contains(document.activeElement)) document.activeElement.blur?.();
        ui.root.classList.remove('on'); ui.root.classList.add('leaving'); ui.root.setAttribute('aria-hidden', 'true');
        ui.title.classList.remove('on');
        setTimeout(() => { if (!this._intro && ui) { ui.root.hidden = true; ui.root.classList.remove('leaving'); } }, 700);
      }
      this._cardOff(true);
      const cam = G.sys.camera, pl = G.sys.player;
      try {
        if (cam) {
          cam.behind?.(pl?.rotY ?? PI, true);
          cam.setMode('follow', { duration: cut ? 0 : 0.75 });
          if (cut) cam.snap?.();
        }
      } catch (e) { G.log.warn('WORLD', 'intro hand-off failed', e); }
      try { G.sys.engine?.grade?.(null, 'md-intro'); } catch (e) { /* grade optional */ }
      document.body.classList.remove('md-intro');
      G.ui.unblock('md-intro');
      if (!logout) this._hud(true);   // (on logout the app owns the HUD)
      G.bus.emit('manjangdae:intro', { phase: 'end', skipped: !!skipped, reduced: !!it.reduced });
      G.log.info('WORLD', `manjangdae intro end${skipped ? ' (skipped)' : ''}`);
      try { it.resolve({ skipped: !!skipped, reduced: !!it.reduced }); } catch (e) { /* ignore */ }
    },
    _abortIntro() {
      if (!this._intro) return;
      this._finishIntro(true, true, true);
    },
    _hud(on) { try { G.ui.setHudVisible(!!on && !!G.state); } catch (e) { /* hud optional */ } },
    _updateIntro(dt) {
      const it = this._intro;
      if (!it || it.reduced) return;
      // the flight runs on game time, but never slower than the wall clock: on a slow device (the loop clamps dt to
      // 0.1 s, so < 10 fps would stretch it) the cinematic still hands the controls back after 8.3 s of real time
      it.t = Math.max(it.t + dt, (performance.now() - it.rt0) / 1000);
      const T = 8.3, t = it.t;
      if (!it.ending) {
        const k = easeIO(clamp(t / 7.6, 0, 1));
        this._introPosCurve.getPoint(k, _camPos);
        this._introLookCurve.getPoint(k, _camLook);
        _shotOpts.fov = lerp(50, 55, smooth(5.5, 7.6, t)); _shotOpts.duration = undefined;
        try { G.sys.camera.shot(_camPos, _camLook, _shotOpts); } catch (e) { /* camera optional */ }
      }
      if (t > 1.2 && !it.subOn) { it.subOn = true; this._ui?.sub.classList.add('on'); }
      if (t > 4.0 && it.subOn && !it.subOff) { it.subOff = true; this._ui?.sub.classList.remove('on'); }
      if (t > 4.4 && !it.cardIn) { it.cardIn = true; this._cardOn(); }
      if (t > 4.9 && !it.said) { it.said = true; if (easyOn()) say('정선 만장대에 왔어요! 저 아래 체험관이 다 보여요.', { priority: 1, intro: true }); }
      if (t > 7.4 && !it.cardOut) { it.cardOut = true; this._cardOff(false); }
      if (t > 7.6 && !it.barsOut) { it.barsOut = true; this._ui?.root.classList.remove('on'); }
      if (t >= T && !it.ending) { it.ending = true; this._finishIntro(false); }
    },
    // ---- 3D title card (billboard with a slow light sweep; built on demand, disposed afterwards)
    _cardOn() {
      if (this._card) return;
      const lk = this.lookout;
      const tex = titleCardTexture();
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uOpacity: { value: 0 }, uSweep: { value: -0.4 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
          'uniform sampler2D map; uniform float uOpacity; uniform float uSweep; varying vec2 vUv;',
          'void main(){',
          '  vec4 c = texture2D(map, vUv);',
          '  float d = vUv.x + (vUv.y - 0.5) * 0.35 - uSweep;',
          '  float band = clamp(1.0 - abs(d) * 9.0, 0.0, 1.0);',
          '  vec3 col = c.rgb + vec3(1.0, 0.9, 0.7) * band * band * 0.45 * c.a;',
          '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(c.a * uOpacity, 0.0, 1.0));',
          '  #include <colorspace_fragment>',
          '}',
        ].join('\n'),
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), mat);
      mesh.position.set(lk.x, lk.y + 9.5, lk.z - 22);
      mesh.renderOrder = 20; mesh.frustumCulled = false;
      mesh.name = 'manjangdae-title-card';
      G.sys.engine.scene.add(mesh);
      this._card = { mesh, mat, tex, t: 0, out: false };
    },
    _cardOff(now) {
      const c = this._card;
      if (!c) return;
      if (!now) { c.out = true; c.outT = 0; return; }
      c.mesh.parent?.remove(c.mesh);
      c.mesh.geometry.dispose(); c.mat.dispose(); c.tex.dispose();
      this._card = null;
    },
    _updateCard(dt) {
      const c = this._card;
      if (!c) return;
      const now = performance.now();
      if (!c.rt) c.rt = now;
      const rdt = Math.min(1, Math.max(dt, (now - c.rt) / 1000));   // wall-clock pacing on slow devices too
      c.rt = now;
      dt = rdt;
      c.t += dt;
      const cam = G.sys.engine?.camera;
      let op = easeOut(clamp(c.t / 0.9, 0, 1));
      if (c.out) { c.outT += dt; op *= 1 - clamp(c.outT / 0.6, 0, 1); if (c.outT >= 0.6) { this._cardOff(true); return; } }
      c.mat.uniforms.uOpacity.value = op;
      c.mat.uniforms.uSweep.value = lerp(-0.4, 1.4, clamp((c.t - 0.7) / 1.8, 0, 1));
      let sc = lerp(0.94, 1, easeOut(clamp(c.t / 1.1, 0, 1)));
      // narrow (portrait phone) screens: shrink the 16 m card to fit the visible width at its distance
      if (cam && cam.isPerspectiveCamera) {
        const d = cam.position.distanceTo(c.mesh.position);
        const vis = 2 * d * Math.tan((cam.fov * PI) / 360) * Math.max(0.2, cam.aspect || 1);
        if (fin(vis) && vis > 0) sc *= Math.min(1, (vis * 0.9) / 16);
      }
      c.mesh.scale.setScalar(sc);
      c.mesh.position.y = this.lookout.y + 9.5 + 0.35 * easeOut(clamp(c.t / 1.6, 0, 1));
      if (cam) c.mesh.quaternion.copy(cam.quaternion);
    },

    // ============================================================== telescope tour
    _tourTargets() {
      if (this._tourCache) return this._tourCache;
      const zs = (G.data.zones || []).filter((z) => z && z.id !== this.zoneId && Array.isArray(z.center) && z.r > 0);
      const eye = this.telescopeEye || { x: this.lookout.x, z: this.lookout.z };
      const blds = G.data.layout?.buildings || [];
      const ground = (x, z) => { const y = G.world?.terrainHeight?.(x, z); return fin(y) ? y : 0; };
      // what the lens aims at: the zone's landmark building (the biggest one inside it — the 정문 for 입구, the hall
      // for 체험관…), at roughly half its height; otherwise the zone centre a little above the ground
      const aimOf = (z) => {
        let best = null, area = 0;
        for (const b of blds) {
          if (!b || !fin(b.x) || !fin(b.z) || Math.hypot(b.x - z.center[0], b.z - z.center[1]) > z.r) continue;
          const a = (Number(b.w) || 4) * (Number(b.d) || 4) * (b.type === 'gate' ? 4 : 1);
          if (a > area) { area = a; best = b; }
        }
        if (best) return { x: best.x, z: best.z, y: ground(best.x, best.z) + (best.type === 'hall' ? 8 : best.type === 'gate' ? 4.2 : 3) };
        return { x: z.center[0], z: z.center[1], y: ground(z.center[0], z.center[1]) + 1.4 };
      };
      // left to right as seen from the deck (looking north): sort by bearing
      this._tourCache = zs.map((z) => {
        const a = aimOf(z);
        return { id: z.id, name: z.name, short: z.short || z.name, emoji: z.emoji || ZONE_EMOJI[z.id] || '📍', desc: z.desc || '', kid: z.kidDesc || ZONE_KID[z.id] || '', x: a.x, z: a.z, ly: a.y, d: Math.hypot(a.x - eye.x, a.z - eye.z), b: Math.atan2(a.x - eye.x, -(a.z - eye.z)) };
      }).sort((a, b) => a.b - b.b);
      return this._tourCache;
    },
    /** telescope view over the valley; resolves when closed */
    tour(startId) {
      if (this._tour) return this._tour.promise;
      if (this._intro || !G.sys.camera || !G.state) return Promise.resolve(false);
      const targets = this._tourTargets();
      if (!targets.length) return Promise.resolve(false);
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      // without a choice the tour starts where the adventure goes next: the plaza (발효마스터), not the nearest edge
      let idx = targets.findIndex((t) => t.id === (startId || 'ZONE_MAIN'));
      if (idx < 0) idx = 0;
      const eye = this.telescopeEye || { x: this.lookout.x, y: this.lookout.y + 1.4, z: this.lookout.z };
      const tr = this._tour = { targets, idx, t: 0, hold: 0, promise, resolve, eye, look: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), blend: 1, auto: true };
      const first = targets[idx];
      tr.look.set(first.x, first.ly ?? 1.2, first.z); tr.from.copy(tr.look); tr.to.copy(tr.look);
      G.ui.block('md-scope');
      this.tourActive = true;
      // the lens is see-through in the middle: the HUD (and cards living in it) step aside while looking
      const hudEl = document.getElementById('hud');
      tr.hud = !!hudEl && !hudEl.hidden;
      if (tr.hud) this._hud(false);
      document.body.classList.add('md-scoping');
      const pl = G.sys.player;
      tr.hid = !!(pl?.object && pl.object.visible);
      if (tr.hid) { pl.object.visible = false; pl.nametag?.setVisible?.(false); }
      try { G.sys.player?.faceTowards?.(first.x, first.z); } catch (e) { /* optional */ }
      const ui = this._ensureUi();
      ui.scope.hidden = false;
      requestAnimationFrame(() => ui.scope.classList.add('on'));
      this._tourShow(true);
      tr.offEsc = G.ui.onEscape(() => { if (this._tour === tr) { this._endTour(); return true; } return false; }, 300);
      // physical keys (e.code): with a Korean input source e.key is 'ㅇ' / 'ㅁ' / 'ㄷ' for D / A / E. A key the view
      // uses stops here (capture phase on window): closing with Enter must not also reach the chat's Enter shortcut,
      // nor E the interact key, once the view has given the controls back.
      tr.onKey = (e) => {
        if (this._tour !== tr || e.isComposing || G.util.isTyping?.()) return;
        const c = e.code;
        let act = 0;
        if (c === 'ArrowRight' || c === 'KeyD') act = 1;
        else if (c === 'ArrowLeft' || c === 'KeyA') act = -1;
        else if (c === 'KeyE' || c === 'Enter' || c === 'NumpadEnter') act = 2;
        if (!act) return;
        e.preventDefault(); e.stopPropagation();
        if (e.repeat && act === 2) return;
        if (act === 2) this._endTour(); else this._tourGo(act);
      };
      window.addEventListener('keydown', tr.onKey, true);
      G.sfx('open');
      G.bus.emit('manjangdae:tour', { phase: 'start', zoneId: first.id });
      return promise;
    },
    _tourGo(step, auto) {
      const tr = this._tour;
      if (!tr) return;
      const n = tr.targets.length;
      tr.idx = (tr.idx + step + n) % n;
      if (!auto) tr.auto = false;
      const tg = tr.targets[tr.idx];
      tr.from.copy(tr.look); tr.to.set(tg.x, tg.ly ?? 1.2, tg.z); tr.blend = 0; tr.hold = 0;
      this._tourShow();
      G.sfx('page');
      G.bus.emit('manjangdae:tour', { phase: 'zone', zoneId: tg.id });
    },
    _tourShow(first) {
      const tr = this._tour, ui = this._ui;
      if (!tr || !ui) return;
      const tg = tr.targets[tr.idx];
      const easy = easyOn();
      ui.zEmoji.textContent = tg.emoji;
      ui.zName.textContent = easy ? tg.short : tg.name;
      ui.zDesc.textContent = easy ? (tg.kid || tg.short) : tg.desc;
      ui.zMeta.textContent = `${Math.round(tg.d)}m · ${this._dirName(tg)}`;
      ui.dots.textContent = '';
      tr.targets.forEach((_, i) => ui.dots.appendChild(G.ui.h('i', { class: i === tr.idx ? 'on' : '' })));
      ui.card.classList.remove('pop'); void ui.card.offsetWidth; ui.card.classList.add('pop');
      if (easy) say(`${tg.short}. ${tg.kid || ''}`, { priority: first ? 1 : 0, intro: true });
    },
    _dirName(tg) {
      const eye = this._tour?.eye || this.lookout;
      const a = Math.atan2(tg.x - eye.x, -(tg.z - eye.z)) * 180 / PI;   // 0 = north, + = east
      const n = ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'];
      return n[((Math.round(a / 45) % 8) + 8) % 8];
    },
    _endTour(silent) {
      const tr = this._tour;
      if (!tr) return;
      this._tour = null;
      this.tourActive = false;
      window.removeEventListener('keydown', tr.onKey, true);
      try { tr.offEsc?.(); } catch (e) { /* ignore */ }
      const ui = this._ui;
      if (ui) { ui.scope.classList.remove('on'); setTimeout(() => { if (!this._tour && ui) ui.scope.hidden = true; }, 420); }
      G.ui.unblock('md-scope');
      document.body.classList.remove('md-scoping');
      if (tr.hud && !silent && G.state) this._hud(true);   // (silent = logout: the app owns the HUD then)
      const pl = G.sys.player;
      if (tr.hid && pl?.object && G.state) { pl.object.visible = true; pl.nametag?.setVisible?.(true); }
      try { G.sys.camera?.setMode?.('follow', { duration: silent ? 0 : 0.6 }); } catch (e) { /* camera optional */ }
      if (!silent) G.sfx('close');
      G.bus.emit('manjangdae:tour', { phase: 'end', zoneId: tr.targets[tr.idx]?.id || null });
      try { tr.resolve(true); } catch (e) { /* ignore */ }
    },
    _updateTour(dt) {
      const tr = this._tour;
      if (!tr) return;
      tr.t += dt;
      if (tr.blend < 1) { tr.blend = Math.min(1, tr.blend + dt / (reduceMotion() ? 0.01 : 0.85)); tr.look.lerpVectors(tr.from, tr.to, easeIO(tr.blend)); }
      tr.hold += dt;
      if (tr.auto && tr.blend >= 1 && tr.hold > (easyOn() ? 4.2 : 3.4)) {
        if (tr.idx === tr.targets.length - 1) { tr.auto = false; } else this._tourGo(1, true);
      }
      const e = tr.eye, tg = tr.targets[tr.idx];
      // a gentle drift so the view feels hand-held (never with reduceMotion)
      const rm = reduceMotion();
      _camLook.set(tr.look.x + (rm ? 0 : Math.sin(tr.t * 0.7) * 0.6), tr.look.y + (rm ? 0 : Math.sin(tr.t * 0.53) * 0.3), tr.look.z);
      // the lens sits a little out in front of the telescope and above the balustrade, so neither the rails nor
      // the telescope itself ever fill the view at a narrow field of view
      let dx = tr.look.x - e.x, dz = tr.look.z - e.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-3) { dx /= dl; dz /= dl; } else { dx = 0; dz = -1; }
      // near targets sit low in the view, behind the deck edge and the switchback path below it: the lens moves out
      // past the balustrade and up a little more for them, so neither rails nor the path's rope fence fill the view
      const near = clamp((110 - Math.min(tg.d, dl)) / 50, 0, 1);
      _camPos.set(e.x + dx * (1.5 + 2.5 * near), this.lookout.y + 2.25 + 2.2 * near, e.z + dz * (1.5 + 2.5 * near));
      const fov = clamp(1400 / Math.max(40, tg.d), 14, 30);
      _shotOpts.fov = fov; _shotOpts.duration = tr.t < dt * 1.5 ? 0.6 : undefined;
      try { G.sys.camera.shot(_camPos, _camLook, _shotOpts); } catch (err) { /* camera optional */ }
    },

    // ============================================================== view guide (안내판 / 표지석)
    openGuide(section) {
      if (!G.state) return null;
      const easy = easyOn(), h = G.ui.h;
      const targets = this._tourTargets();
      const body = h('div', { class: 'md-guide' + (easy ? ' easy' : '') },
        h('div', { class: 'md-guide-hero' },
          h('div', { class: 'md-guide-name' }, h('span', { class: 'hanja', lang: 'zh-Hant' }, '旌善 萬丈臺'), h('b', null, '정선 만장대')),
          h('p', null, easy ? '높은 산 위 전망대예요. 체험관이 다 보여요!' : '체험관과 계곡이 한눈에 내려다보이는 전망대예요. 팔각정에서 쉬어 가고, 망원경으로 구역을 하나씩 살펴보세요.'),
          section === 'name' || !easy ? h('p', { class: 'md-guide-word' }, '‘만장(萬丈)’은 아주 높다는 뜻이고, ‘대(臺)’는 멀리 바라보도록 높게 만든 곳을 말해요.') : null),
        h('div', { class: 'md-guide-grid' }, targets.map((tg) => h('button', {
          type: 'button', class: 'md-guide-tile', 'data-say': `${tg.short}. ${tg.kid || ''}`,
          onclick: () => { G.ui.modal.get('md-guide')?.close(); setTimeout(() => this.tour(tg.id), 60); },
        }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, tg.emoji), h('b', null, easy ? tg.short : tg.name), easy ? null : h('small', null, `${Math.round(tg.d)}m · ${this._dirName(tg)}`)))),
        // kids get one plain sentence; grown-ups also see the data's address note (display-only, not verified geography)
        h('p', { class: 'md-guide-note' }, easy ? '게임 속 풍경이에요. 진짜 만장대와는 조금 달라요.' : '※ 게임 속 전망대와 풍경은 실제 지형·시설을 그대로 옮긴 것이 아니에요. ' + (G.data.meta?.addressNote || '')),
      );
      return G.ui.modal.open({
        id: 'md-guide', title: easy ? '만장대 안내' : '정선 만장대 전망 안내', icon: '🏔️', size: 'md', className: 'md-guide-modal', body,
        say: easy ? '만장대 안내예요. 보고 싶은 곳을 누르면 망원경으로 보여 줘요.' : undefined,
        actions: [{ label: easy ? '🔭 망원경' : '망원경으로 둘러보기', class: 'btn-primary', onClick: () => { setTimeout(() => this.tour(), 60); } }, { label: '닫기', class: 'btn-ghost' }],
      });
    },

    // ============================================================== DOM overlay (letterbox, skip, title, scope)
    _ensureUi() {
      if (this._ui) return this._ui;
      const h = G.ui.h;
      const skip = h('button', { type: 'button', class: 'md-skip', 'aria-label': '건너뛰기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⏭️'), h('span', { class: 'md-skip-lbl' }, '건너뛰기'));
      skip.addEventListener('click', (e) => { e.stopPropagation(); this._skipIntro(); });
      const sub = h('div', { class: 'md-sub' }, '산과 계곡이 품은 전통발효체험관');
      const title = h('div', { class: 'md-title2d' }, h('small', null, '旌善 萬丈臺'), h('b', null, '정선 만장대'), h('span', null, '전통발효체험관이 한눈에 내려다보여요'));
      const root = h('div', { class: 'md-cine', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'md-bar top', 'aria-hidden': 'true' }), h('div', { class: 'md-bar bottom', 'aria-hidden': 'true' }), sub, title, skip);
      const zEmoji = h('span', { class: 'md-z-emoji', 'aria-hidden': 'true' }), zName = h('b', { class: 'md-z-name' }), zDesc = h('p', { class: 'md-z-desc' }), zMeta = h('small', { class: 'md-z-meta' });
      const dots = h('div', { class: 'md-dots', 'aria-hidden': 'true' });
      const prev = h('button', { type: 'button', class: 'md-nav prev', 'aria-label': '이전 구역' }, '◀');
      const next = h('button', { type: 'button', class: 'md-nav next', 'aria-label': '다음 구역' }, '▶');
      const close = h('button', { type: 'button', class: 'md-close', 'aria-label': '망원경 그만 보기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✖'), h('span', null, '그만 보기'));
      prev.addEventListener('click', () => this._tourGo(-1));
      next.addEventListener('click', () => this._tourGo(1));
      close.addEventListener('click', () => this._endTour());
      const card = h('div', { class: 'md-zcard' }, zEmoji, h('div', { class: 'md-z-text' }, zName, zDesc, zMeta));
      const scope = h('div', { class: 'md-scope', hidden: true }, h('div', { class: 'md-lens' }), h('div', { class: 'md-scope-ui' }, prev, card, next), dots, close);
      document.body.append(root, scope);
      this._ui = { root, skip, sub, title, scope, card, zEmoji, zName, zDesc, zMeta, dots };
      return this._ui;
    },

    /**
     * a short, safe walking target on the deck (tutorial "tap the ground" steps): 1.8-3 m from the player,
     * in front of the follow camera (or of the player while a cinematic owns the camera), never past the
     * balustrade. null when the player is not on the plateau.
     */
    walkSpot(from) {
      const md = MDL(), pl = G.sys.player, p = from || pl?.position;
      if (!md || !p || !this.built || Math.hypot(p.x - md.x, p.z - md.z) > md.r) return null;
      // "in front": the follow camera's heading (its yaw, not the rendered camera of a mid-blend frame). While the
      // intro, the telescope or a camera hand-off owns the view, the screen says nothing about where the child will
      // look next: the player's facing is used instead (the follow camera ends up behind it), with no on-screen test.
      const C = G.sys.camera, follow = C?.mode === 'follow' && !C._trans && !this._intro && !this._tour;
      let fx = 0, fz = -1;
      if (follow && C.getMoveBasis) { const f = C.getMoveBasis().forward; fx = f.x; fz = f.z; }
      else if (pl && fin(pl.rotY)) { fx = Math.sin(pl.rotY); fz = Math.cos(pl.rotY); }
      const cam = follow ? G.sys.engine?.camera : null;
      const a0 = Math.atan2(fx, fz), y = this.lookout.y;
      const free = (x, z) => {
        if (Math.hypot(x - md.x, z - md.z) > md.r - 1.2) return false;
        try { return !G.world.blocked?.(x, z, 0.45, y); } catch (e) { return true; }
      };
      // far enough that the "move" step counts (> 1.8 m after a 0.3 m stop), reachable in a straight line,
      // on screen, and — preferably — out of reach of the deck's own prompts (telescope, board, marker), so the
      // next coach step ("👉 같이 가기") is the one obvious thing on screen when the child arrives
      let fallback = null;
      for (const side of WALK_SIDES) {
        for (const d of [3, 2.6, 2.2]) {
          const x = p.x + Math.sin(a0 + side) * d, z = p.z + Math.cos(a0 + side) * d;
          if (!free(x, z)) continue;
          let clear = true;
          for (let i = 1; i < 4 && clear; i++) clear = free(p.x + Math.sin(a0 + side) * d * i / 4, p.z + Math.cos(a0 + side) * d * i / 4);
          if (!clear) continue;
          if (cam) {
            _v2.set(x, y + 0.1, z).project(cam);
            if (!(Math.abs(_v2.x) < 0.82 && _v2.y > -0.7 && _v2.y < 0.75 && _v2.z < 1)) continue;
          }
          if (!promptNear(x, z)) return { x, z };
          if (!fallback) fallback = { x, z };
        }
      }
      return fallback;
    },

    /** framing for the title screen (70-app): a slow orbit around the pavilion with the valley behind */
    titleShot() {
      const md = MDL() || { x: 52, z: 118, pavilion: { x: 52, z: 124 } };
      const y = this.lookout.y;
      // authored from the south-west, over the pavilion roof towards the valley: this arc is clear of the big
      // canopies on the ridge (the old 0.72 rad framing sat inside them); 70-app's TitleCam still checks the ring
      const A = 5.7, R = 36, H = 14;
      return {
        pos: [md.x + Math.sin(A) * R, y + 3 + H, md.z + Math.cos(A) * R], look: [md.x, y + 3, md.z],
        cinematic: { center: [md.x, y + 3, md.z], radius: R, height: H, angle: A, speed: 0.018 },
      };
    },

    update(dt, t) {
      if (!this.built) return;
      if (!(dt > 0) || !fin(dt)) return;
      this._t += dt;
      if (this._intro) this._updateIntro(dt);
      if (this._card) this._updateCard(dt);
      if (this._tour) this._updateTour(dt);
    },
  };
  G.register(MDS);
})();
