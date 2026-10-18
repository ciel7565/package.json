// =============================================================================
// 46-education.js — education system (G.sys.education, order 64)
//
//   open(eduId, {page})     paged content modal: visual (3D model / emoji / svg / steps) + text, 이전/다음,
//                           last page -> 학습 완료 (edu:completed once, +5 교육 포인트) + 퀴즈 풀기
//   openQuiz(quizId|eduId)  4-choice quiz: correct -> green + first-time reward (progression.grant), wrong ->
//                           red + explanation + 다시 풀기. Emits quiz:answered on every attempt.
//   answer(quizId, index)   programmatic answer (same rules as clicking)
//   openLibrary({tab})      배움터: every content with completion / quiz progress
//   openExhibit(id)         fermented-food card (layout.exhibits) with a small 3D model + "자세히 알아보기"
//   openTool(id)            traditional tool card (layout.tools, G.data.toolInfo) — same card look as the exhibits
//   openHallGuide()         체험관 안내 (HALL_DOOR): floors & related contents
//   readSign(id) / openInfo(title, text, opts)
//   isCompleted(id), isQuizSolved(id), pickQuiz(eduId?), stats()
//   G.sys.education.Viewer  small separate WebGLRenderer turntable viewer (disposed with its modal)
//
// Interactables: layout.signs (kind 'sign'), layout.kiosks ('kiosk'), layout.exhibits ('exhibit'), layout.tools ('tool'),
// layout.eduBoard ('board'), layout.hallDoor ('door').
// State: G.state.education = { viewed:{id:{at,pages[],last}}, completed:{id:ts}, quiz:{id:{correct,attempts,at,firstTry,lastAt}} }
// =============================================================================
(function () {
  const U = G.util;
  const esc = U.escapeHtml;
  const clamp = U.clamp;
  const TAU = Math.PI * 2;
  const EDU = () => G.data.education || {};
  const QZ = () => G.data.quizzes || {};
  const CATS = () => G.data.educationCategories || {};
  const L = () => G.data.layout || {};
  const COMPLETE_EDU_POINTS = 5;
  const MODAL_IDS = ['edu-content', 'edu-quiz', 'edu-library', 'edu-sign', 'edu-exhibit', 'edu-hall', 'edu-map'];

  // ---------------------------------------------------------------- small helpers
  function h(...a) { return G.ui.h(...a); }
  function eduIds() {
    const all = EDU();
    const out = (G.data.educationIds || []).filter((id) => all[id]);
    for (const id of Object.keys(all)) if (!out.includes(id)) out.push(id);
    return out;
  }
  function quizIdsOf(eduId) {
    const e = EDU()[eduId];
    const out = (e?.quizzes || (e?.quiz ? [e.quiz] : [])).filter((q) => QZ()[q]);
    for (const [id, q] of Object.entries(QZ())) if (q.edu === eduId && !out.includes(id)) out.push(id);
    return out;
  }
  /** G.state.education with a guaranteed shape (null when logged out) */
  function est() {
    if (!G.state) return null;
    let s = G.state.education;
    if (!s || typeof s !== 'object') s = G.state.education = {};
    if (!s.viewed || typeof s.viewed !== 'object') s.viewed = {};
    if (!s.completed || typeof s.completed !== 'object') s.completed = {};
    if (!s.quiz || typeof s.quiz !== 'object') s.quiz = {};
    return s;
  }
  function quizRec(id) { return est()?.quiz?.[id] ?? null; }
  function solvedVal(v) { return v === true || v === 'correct' || !!(v && typeof v === 'object' && v.correct); }
  function catOf(e) {
    const c = CATS()[e?.cat] || {};
    return { name: e?.category || c.name || '교육', color: e?.color || c.color || '#34c36b', icon: c.icon || e?.icon || '📖' };
  }
  function catChip(e, extra = '') { const c = catOf(e); return `<span class="edu-cat ${extra}" style="--c:${esc(c.color)}">${esc(c.name)}</span>`; }
  /** 을/를, 이/가, 은/는, 과/와, 으로/로 on the last Hangul syllable */
  function josa(word, pair) {
    const [a, b] = pair.split('/');
    const s = String(word ?? '');
    let ch = 0;
    for (let i = s.length - 1; i >= 0; i--) { const c = s.charCodeAt(i); if (c >= 0xac00 && c <= 0xd7a3) { ch = c; break; } if (/[0-9a-zA-Z]/.test(s[i])) break; }
    if (!ch) return s + b;
    const jong = (ch - 0xac00) % 28;
    if (pair === '으로/로') return s + (jong && jong !== 8 ? a : b);
    return s + (jong ? a : b);
  }
  function sanitizeSvg(svg) {
    return String(svg || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/javascript:/gi, '');
  }
  function addEduPoints(n) {
    if (!G.state || !n) return;
    if (G.sys.progression?.addEdu) G.sys.progression.addEdu(n, { silent: true });
    else { G.state.stats.edu = (G.state.stats.edu || 0) + n; G.dirty('edu'); }
  }
  function grantReward(reward, reason) {
    if (!G.state || !reward) return;
    if (G.sys.progression?.grant) { G.sys.progression.grant(reward, { popup: false, silent: true, reason }); return; }
    const s = G.state.stats;
    s.exp = (s.exp || 0) + (reward.exp || 0);
    s.edu = (s.edu || 0) + (reward.edu || 0);
    s.coin = (s.coin || 0) + (reward.coin || 0);
    G.dirty('reward');
  }
  // ---------------------------------------------------------------- 쉬운 모드 helpers
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const kidSay = (text, opts) => { try { G.easy?.say?.(text, opts || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const kidSpeakable = (el, fn) => { try { G.easy?.speakable?.(el, fn); } catch (e) { /* optional */ } };
  /** kid slides of a content (null when the content has none / bad data) */
  function kidOf(e) { const k = e?.kid; return k && Array.isArray(k.slides) && k.slides.length ? k : null; }
  /** kid quiz of a quiz: {q, choices:[{e,t}], answer} or {q, ox:true, answer:bool} (null when missing / invalid) */
  function kidQuizOf(q) {
    const k = q?.kid;
    if (!k || typeof k.q !== 'string') return null;
    if (k.ox) return typeof k.answer === 'boolean' ? k : null;
    return Array.isArray(k.choices) && k.choices.length >= 2 && Number.isInteger(k.answer) && k.choices[k.answer] ? k : null;
  }
  /** the kid tiles in slot order; `order` (from kidOrder) shuffles picture choices — colours stay with the slot */
  function kidChoicesOf(k, order) {
    if (k.ox) return [{ e: '⭕', t: '맞아요', ok: k.answer === true, c: '#55d187' }, { e: '❌', t: '아니에요', ok: k.answer === false, c: '#ff8a5c' }];
    const colors = ['#4fb3ff', '#ffc93c', '#b48bff'];
    const list = k.choices.slice(0, 3).map((c, i) => ({ e: c.e || '⭐', t: c.t || '', ok: i === k.answer }));
    const shown = Array.isArray(order) && order.length === list.length ? order.map((j) => list[j]) : list;
    return shown.map((c, i) => ({ ...c, c: colors[i % colors.length] }));
  }
  /** a fresh slot order per quiz opening (the data lists the right picture first; ⭕ / ❌ keep their places) */
  function kidOrder(k) {
    if (k.ox) return null;
    const o = k.choices.slice(0, 3).map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    return o;
  }
  function kidTitle(e) { return kidOf(e)?.title || e?.title || '교육'; }
  function mascotSvg(mood, size) {
    try { const v = G.mascot?.svg?.(mood, size); return typeof v === 'string' && v.trim().startsWith('<svg') ? v : ''; } catch (e) { return ''; }
  }

  // =============================================================================================
  // procedural 3D models for the education viewer
  // =============================================================================================
  const MODEL_EMOJI = { jar: '🏺', meju: '🧱', bean: '🫘', pepper: '🌶️', cabbage: '🥬', kimchi: '🥬', jige: '🪵', maetdol: '🪨', tools: '🛠️', soy: '🫙', doenjang: '🟤', gochujang: '🔴', vinegar: '🍶', season: '🌞' };
  const UPV = new THREE.Vector3(0, 1, 0);
  let simplex = null;
  try { if (ADDONS.SimplexNoise) simplex = new ADDONS.SimplexNoise({ random: U.rng('edu-noise') }); } catch (e) { simplex = null; }
  function noise3(x, y, z) {
    if (simplex) return simplex.noise3d(x, y, z);
    return Math.sin(x * 1.7 + Math.sin(y * 2.3) * 1.3) * Math.cos(z * 1.9 + Math.sin(x * 1.1)) * 0.8;
  }
  function smooth01(a, b, v) { return U.smoothstep(a, b, v); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  function mixHex(a, b, t, out) { _c1.set(a); _c2.set(b); return (out || new THREE.Color()).copy(_c1).lerp(_c2, clamp(t, 0, 1)); }

  /** resource kit for one viewer: every geometry/material/texture is tracked and disposed with the viewer */
  function makeKit(own) {
    const K = {
      t(o) { if (o) own.add(o); return o; },
      g(geo) { return K.t(geo); },
      std(color, o) { return K.t(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0 }, o || {}))); },
      phys(color, o) { return K.t(new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.4, metalness: 0 }, o || {}))); },
      tex(w, hh, draw, o) { return K.t(G.gfx.canvasTexture(w, hh, draw, o || {})); },
      mesh(geo, mat, parent, shadow = true) {
        const m = new THREE.Mesh(K.g(geo), mat);
        m.castShadow = shadow; m.receiveShadow = true;
        if (parent) parent.add(m);
        return m;
      },
      /** lathe from [r,y] points; `smooth` resamples them with a spline first; `tail` raw points appended */
      profile(pts, smooth, tail, segs = 64) {
        let v = [];
        if (pts && pts.length) {
          const base = pts.map((p) => new THREE.Vector2(p[0], p[1]));
          v = smooth ? new THREE.SplineCurve(base).getPoints(smooth) : base;
        }
        if (tail) for (const p of tail) v.push(new THREE.Vector2(p[0], p[1]));
        v = v.map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
        return K.g(new THREE.LatheGeometry(v, segs));
      },
      /** cylinder between two points */
      beam(a, b, r1, r2, mat, parent, radial = 10) {
        const dir = new THREE.Vector3().subVectors(b, a);
        const len = dir.length();
        const m = K.mesh(new THREE.CylinderGeometry(r2, r1, len, radial, 1), mat, parent);
        m.position.copy(a).addScaledVector(dir, 0.5);
        m.quaternion.setFromUnitVectors(UPV, dir.normalize());
        return m;
      },
      tube(points, r, mat, parent, { seg = 48, radial = 7, closed = false } = {}) {
        const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))), closed);
        return K.mesh(new THREE.TubeGeometry(curve, seg, r, radial, closed), mat, parent);
      },
    };
    return K;
  }

  /** weld normals of vertices sharing a position (box faces are split per face) */
  function weldNormals(geo) {
    geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const acc = new Map();
    const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    for (let i = 0; i < pos.count; i++) {
      const k = key(i);
      const a = acc.get(k) || [0, 0, 0];
      a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
      acc.set(k, a);
    }
    for (let i = 0; i < pos.count; i++) {
      const a = acc.get(key(i));
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
    }
    nor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- textures
  function onggiTex(K, o = {}) {
    const rng = U.rng(o.seed || 'onggi');
    const base = o.base || ['#6c4126', '#4e2c19', '#3a2012'];
    const bandY = o.bandY ?? 0.3;
    const pattern = o.pattern !== false;
    const drawPattern = (c, w, hh, stroke, lw) => {
      const y0 = hh * bandY;
      c.strokeStyle = stroke; c.lineWidth = lw; c.lineCap = 'round';
      const reps = o.reps || 4;
      for (let k = 0; k < reps; k++) {
        const cx = (k + 0.5) * w / reps;
        for (let j = -2; j <= 2; j++) {
          c.beginPath();
          c.moveTo(cx + j * 5, y0 + 30);
          c.quadraticCurveTo(cx + j * 20, y0 + 6, cx + j * 30 + (j >= 0 ? 8 : -8), y0 - 20 + Math.abs(j) * 8);
          c.stroke();
        }
      }
      c.lineWidth = lw * 0.7;
      c.beginPath(); c.moveTo(0, y0 + 42); c.lineTo(w, y0 + 42); c.stroke();
      c.beginPath(); c.moveTo(0, y0 - 32); c.lineTo(w, y0 - 32); c.stroke();
      c.beginPath();
      for (let x = 0; x <= w; x += 4) { const yy = y0 + 54 + Math.sin((x / w) * TAU * 6) * 5; if (x) c.lineTo(x, yy); else c.moveTo(x, yy); }
      c.stroke();
    };
    const map = K.tex(512, 512, (c, w, hh) => {
      const g = c.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, base[0]); g.addColorStop(0.55, base[1]); g.addColorStop(1, base[2]);
      c.fillStyle = g; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 80; i++) {
        const x = rng() * w, len = hh * (0.15 + rng() * 0.6), wd = 2 + rng() * 9;
        const gr = c.createLinearGradient(0, 0, 0, len);
        const light = rng() < 0.6;
        gr.addColorStop(0, light ? `rgba(${(160 + rng() * 40) | 0},${(98 + rng() * 30) | 0},${(48 + rng() * 22) | 0},${0.1 + rng() * 0.18})` : `rgba(18,8,3,${0.12 + rng() * 0.2})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr; c.fillRect(x, hh * (0.01 + rng() * 0.08), wd, len);
      }
      if (pattern) drawPattern(c, w, hh, 'rgba(228,186,124,.62)', 3);
      for (let i = 0; i < 1200; i++) { c.fillStyle = rng() < 0.55 ? 'rgba(18,8,3,.28)' : 'rgba(214,160,96,.14)'; c.fillRect(rng() * w, rng() * hh, 1.6, 1.6); }
      // unglazed foot band
      const fg = c.createLinearGradient(0, hh * 0.93, 0, hh);
      fg.addColorStop(0, 'rgba(120,80,50,0)'); fg.addColorStop(1, 'rgba(150,104,70,.85)');
      c.fillStyle = fg; c.fillRect(0, hh * 0.93, w, hh * 0.07);
    });
    const bump = K.tex(512, 512, (c, w, hh) => {
      c.fillStyle = '#808080'; c.fillRect(0, 0, w, hh);
      for (let y = 0; y < hh; y += 5 + rng() * 6) { c.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)'; c.fillRect(0, y, w, 1.5 + rng() * 2); }
      if (pattern) drawPattern(c, w, hh, 'rgba(255,255,255,.55)', 4);
    }, { srgb: false });
    map.wrapS = bump.wrapS = THREE.RepeatWrapping;
    return { map, bump };
  }
  function onggiMat(K, o = {}) {
    const t = onggiTex(K, o);
    return K.phys('#ffffff', { map: t.map, bumpMap: t.bump, bumpScale: o.bumpScale ?? 1.4, roughness: o.roughness ?? 0.36, clearcoat: o.clearcoat ?? 0.65, clearcoatRoughness: 0.24, side: o.side || THREE.FrontSide });
  }
  function woodTex(K, base = '#8a5a3b', seed = 'wood') {
    const rng = U.rng(seed);
    const t = K.tex(256, 256, (c, w, hh) => {
      c.fillStyle = base; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 52; i++) {
        const x = rng() * w, a = 0.05 + rng() * 0.13;
        c.strokeStyle = rng() < 0.62 ? `rgba(40,22,10,${a})` : `rgba(255,222,172,${a * 0.75})`;
        c.lineWidth = 0.6 + rng() * 2.2;
        c.beginPath();
        for (let y = 0; y <= hh; y += 8) { const xx = x + Math.sin(y * 0.03 + i) * 3 + Math.sin(y * 0.11 + i * 2) * 1.2; if (y) c.lineTo(xx, y); else c.moveTo(xx, y); }
        c.stroke();
      }
      for (let k = 0; k < 2; k++) {
        const kx = rng() * w, ky = rng() * hh;
        for (let r = 3; r < 12; r += 2.5) { c.strokeStyle = 'rgba(50,28,12,.25)'; c.lineWidth = 1; c.beginPath(); c.ellipse(kx, ky, r * 0.6, r * 1.6, 0, 0, TAU); c.stroke(); }
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function woodMat(K, base, seed, o) { return K.std('#ffffff', Object.assign({ map: woodTex(K, base, seed), roughness: 0.72 }, o || {})); }
  function strawMat(K, seed = 'straw') {
    const rng = U.rng(seed);
    const t = K.tex(256, 64, (c, w, hh) => {
      c.fillStyle = '#d6b55e'; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 70; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(140,100,36,.38)' : 'rgba(255,242,186,.38)'; c.fillRect(0, rng() * hh, w, 0.8 + rng() * 2); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 1);
    return K.std('#ffffff', { map: t, roughness: 0.86 });
  }
  function stoneTex(K, base = '#8d8a84', seed = 'stone') {
    const rng = U.rng(seed);
    const t = K.tex(256, 256, (c, w, hh) => {
      c.fillStyle = base; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 2600; i++) {
        const r = rng();
        c.fillStyle = r < 0.35 ? 'rgba(30,30,30,.45)' : r < 0.7 ? 'rgba(235,232,225,.35)' : 'rgba(120,100,90,.35)';
        const s = 0.8 + rng() * 2.2;
        c.fillRect(rng() * w, rng() * hh, s, s);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---------------------------------------------------------------- shared shapes
  /** jar body lathe (profile ends inside the rim) */
  function jarBody(K, mat, parent, P) {
    return K.mesh(K.profile(P.body, P.smooth || 90, P.lip, 72), mat, parent);
  }
  const JAR_PROFILE = {
    body: [[0, 0], [0.24, 0], [0.3, 0.03], [0.4, 0.18], [0.49, 0.4], [0.53, 0.6], [0.5, 0.78], [0.41, 0.93], [0.31, 1.01]],
    lip: [[0.285, 1.04], [0.29, 1.075], [0.31, 1.09], [0.312, 1.105], [0.295, 1.115], [0.265, 1.11], [0.255, 1.07], [0.25, 1.0]],
  };
  const KIMCHI_JAR_PROFILE = {
    body: [[0, 0], [0.22, 0], [0.28, 0.03], [0.38, 0.2], [0.45, 0.45], [0.46, 0.62], [0.43, 0.8], [0.37, 0.92]],
    lip: [[0.35, 0.95], [0.352, 0.98], [0.372, 0.995], [0.374, 1.01], [0.355, 1.02], [0.335, 1.005], [0.33, 0.95], [0.32, 0.9]],
  };
  const DANJI_PROFILE = {
    body: [[0, 0], [0.18, 0], [0.22, 0.03], [0.3, 0.14], [0.34, 0.28], [0.33, 0.4], [0.27, 0.5], [0.2, 0.55]],
    lip: [[0.19, 0.58], [0.2, 0.6], [0.215, 0.61], [0.215, 0.625], [0.2, 0.63], [0.18, 0.62], [0.175, 0.58], [0.17, 0.52]],
  };
  function lidGeo(K, r = 0.335, segs = 64) {
    return K.profile(null, 0, [[0, 0.13 * r / 0.335], [0.03, 0.13 * r / 0.335], [0.045, 0.118 * r / 0.335], [0.04, 0.1 * r / 0.335], [0.05, 0.085 * r / 0.335], [r * 0.36, 0.07 * r / 0.335], [r * 0.66, 0.045 * r / 0.335], [r * 0.9, 0.012], [r, -0.012], [r, -0.03], [r * 0.95, -0.03], [r * 0.6, 0.012]], segs);
  }
  /** surface patch wrapped around the Y axis (napa cabbage / kimchi leaves). colorFn(u -1..1, v 0..1, outColor) */
  function wrapLeafGeo(K, o) {
    const segU = o.segU || 16, segV = o.segV || 22;
    const H = o.H ?? 1, R0 = o.R0 ?? 0.2, span = o.span ?? 1.2, flare = o.flare ?? 0, ruffle = o.ruffle ?? 0.02, rib = o.rib ?? 0.012;
    const pos = [], col = [], uv = [], idx = [];
    const c = new THREE.Color();
    const phase = o.phase ?? 0;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      let r = R0 * (o.prof ? o.prof(v) : (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, v * 0.92 + 0.1))));
      r += flare * Math.pow(smooth01(0.62, 1, v), 2);
      let s = span * (0.42 + 0.58 * Math.sin(Math.min(1, v * 1.7) * Math.PI / 2));
      if (v > 0.9) s *= Math.sqrt(Math.max(0.05, 1 - Math.pow((v - 0.9) / 0.105, 2)));
      for (let i = 0; i <= segU; i++) {
        const u = (i / segU) * 2 - 1;
        const th = u * s;
        let rr = r + ruffle * Math.sin(u * 11 + v * 30 + phase) * smooth01(0.5, 1, v) * (0.35 + 0.65 * u * u);
        rr += rib * Math.max(0, 1 - Math.abs(u) / 0.17) * (1 - v * 0.55);
        const y = v * H - 0.05 * H * u * u * smooth01(0.82, 1, v);
        pos.push(Math.sin(th) * rr, y, Math.cos(th) * rr);
        o.colorFn(u, v, c);
        col.push(c.r, c.g, c.b);
        uv.push((u + 1) / 2, v);
      }
    }
    const row = segU + 1;
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return K.g(g);
  }
  /** flat ovate leaflet growing along +Y, face normal +Z (cup = edges up, droop = tip down) */
  function leafletGeo(K, len, wid, colA, colB, o = {}) {
    const segU = 6, segV = 10, cup = o.cup ?? 0.22, droop = o.droop ?? 0.22;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const w = wid * Math.sin(Math.PI * Math.pow(v, 0.72)) * (v > 0.96 ? 0.6 : 1);
      for (let i = 0; i <= segU; i++) {
        const u = (i / segU) * 2 - 1;
        pos.push(u * w, v * len, cup * u * u * w - droop * v * v * len);
        mixHex(colA, colB, Math.min(1, Math.abs(u) * 1.3 + v * 0.25), c);
        if (Math.abs(u) < 0.2) c.lerp(_c1.set('#b9d98a'), 0.45);
        col.push(c.r, c.g, c.b);
      }
    }
    const row = segU + 1;
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) { const a = j * row + i; idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return K.g(g);
  }
  /** chili pepper along -Y from the origin (stem end), bent toward +X */
  function pepperGeo(K, len = 0.5, r = 0.055, bend = 0.14) {
    const pts = [[0, 0.004]];
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let rad = t < 0.08 ? r * (0.6 + 0.4 * Math.sin((t / 0.08) * Math.PI / 2)) : r * Math.pow(Math.max(0, 1 - (t - 0.08) / 0.92), 0.72) * (1 + 0.035 * Math.sin(t * 22));
      pts.push([Math.max(0.0008, rad), -t * len]);
    }
    pts.push([0, -len - 0.008]);
    pts.reverse();
    const g = K.profile(null, 0, pts, 20);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = -p.getY(i) / len;
      p.setX(i, p.getX(i) + bend * t * t * len);
      p.setZ(i, p.getZ(i) + 0.05 * Math.sin(t * 3.2) * t * len);
    }
    g.computeVertexNormals();
    return g;
  }
  function pepperGroup(K, mats, geo, calyxGeo) {
    const grp = new THREE.Group();
    K.mesh(geo, mats.fruit, grp);
    const cx = K.mesh(calyxGeo, mats.calyx, grp);
    cx.position.y = -0.004;
    K.tube([[0, 0.0, 0], [0.004, 0.035, 0], [0.022, 0.07, 0.004]], 0.0075, mats.calyx, grp, { seg: 8, radial: 6 });
    return grp;
  }
  function calyxGeo(K) {
    const g = K.profile(null, 0, [[0, -0.004], [0.034, -0.012], [0.046, -0.022], [0.052, -0.03], [0.058, -0.016], [0.046, 0.0], [0.026, 0.01], [0, 0.012]], 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.18 * Math.sin(a * 5); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals();
    return g;
  }
  function beanInstances(K, parent, list, color = '#e8c98a', r = 0.03) {
    const geo = K.g(new THREE.SphereGeometry(r, 12, 9));
    const mat = K.std(color, { roughness: 0.48 });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const d = new THREE.Object3D();
    list.forEach((b, i) => {
      d.position.set(b[0], b[1], b[2]);
      d.rotation.set(b[3] || 0, b[4] || 0, b[5] || 0);
      d.scale.set(1, 0.84, 0.9);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    parent.add(im);
    return im;
  }
  function beanPile(rng, cx, cz, n, rad, y0 = 0, r = 0.03) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * rad;
      const layer = d < rad * 0.4 ? (rng() < 0.6 ? 1 : 0) : 0;
      out.push([cx + Math.cos(a) * d, y0 + r * 0.84 + layer * r * 1.5, cz + Math.sin(a) * d, rng() * TAU, rng() * TAU, rng() * TAU]);
    }
    return out;
  }
  /** irregular mound (paste / kimchi base): hemisphere with noise, vertex colours */
  function moundGeo(K, r, hgt, colA, colB, o = {}) {
    const g = new THREE.SphereGeometry(r, 40, 16, 0, TAU, 0, Math.PI / 2);
    const p = g.attributes.position;
    const col = [];
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = noise3(x * 7 + (o.seed || 0), y * 7, z * 7) * 0.5 + noise3(x * 19, y * 19 + 3, z * 19) * 0.25;
      const k = 1 + n * (o.rough ?? 0.12) * (y / r);
      x *= k; z *= k;
      y = (y / r) * hgt * (1 + n * 0.25);
      if (o.peak) y += o.peak * Math.exp(-(x * x + z * z) / (r * r * 0.08));
      p.setXYZ(i, x, y, z);
      mixHex(colA, colB, 0.5 + n * 0.9, c);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return K.g(g);
  }

  // ---------------------------------------------------------------- model builders  (root: THREE.Group, units ~ meters, feet at y=0)
  const MODELS = {};

  MODELS.jar = function (K, root, o = {}) {
    const mat = onggiMat(K, { seed: 'jar' });
    jarBody(K, mat, root, JAR_PROFILE);
    const fill = K.mesh(new THREE.CircleGeometry(0.256, 48), K.phys('#3c2412', { roughness: 0.28, clearcoat: 0.8 }), root, false);
    fill.rotation.x = -Math.PI / 2; fill.position.y = 1.0;
    const lidMat = onggiMat(K, { seed: 'lid', pattern: false, side: THREE.DoubleSide, bumpScale: 0.6 });
    const lid = new THREE.Group();
    K.mesh(lidGeo(K, 0.335), lidMat, lid);
    root.add(lid);
    if (o.lidOpen) {
      lid.position.set(0.2, 1.42, 0.06); lid.rotation.set(0.08, 0, -0.42);
      root.userData.update = (dt, t) => { lid.position.y = 1.42 + Math.sin(t * 1.6) * 0.022; lid.rotation.z = -0.42 + Math.sin(t * 1.15) * 0.04; };
      // sunlight motes over the open jar
      const motes = K.g(new THREE.BufferGeometry());
      const pts = []; const rng = U.rng('motes');
      for (let i = 0; i < 40; i++) pts.push((rng() - 0.5) * 0.5, 1.05 + rng() * 0.5, (rng() - 0.5) * 0.5);
      motes.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const pm = K.t(new THREE.PointsMaterial({ color: 0xfff1b8, size: 0.035, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, map: K.t(G.gfx.radialTexture(64)) }));
      const P = new THREE.Points(motes, pm);
      root.add(P);
      const upd = root.userData.update;
      root.userData.update = (dt, t) => { upd(dt, t); P.rotation.y = t * 0.25; P.position.y = Math.sin(t * 0.8) * 0.03; };
    } else {
      lid.position.y = 1.105;
    }
  };

  MODELS.meju = function (K, root) {
    const rng = U.rng('meju');
    const W = 0.9, H = 0.56, D = 0.58;
    const RB = ADDONS.RoundedBoxGeometry;
    const geo = K.g(RB ? new RB(W, H, D, 6, 0.1) : new THREE.BoxGeometry(W, H, D, 10, 8, 8));
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = noise3(v.x * 3.2, v.y * 3.2, v.z * 3.2) * 0.024 + noise3(v.x * 9, v.y * 9, v.z * 9) * 0.008;
      const len = v.length() || 1;
      v.multiplyScalar(1 + n / len);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    weldNormals(geo);
    const map = K.tex(512, 512, (c, w, hh) => {
      c.fillStyle = '#c49a5c'; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 160; i++) {
        const x = rng() * w, y = rng() * hh, r = 8 + rng() * 40;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        const dark = rng() < 0.55;
        g.addColorStop(0, dark ? `rgba(120,80,40,${0.18 + rng() * 0.2})` : `rgba(225,190,128,${0.18 + rng() * 0.2})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // mould bloom (white / yellow patches of a well-fermented meju)
      for (let i = 0; i < 46; i++) {
        const x = rng() * w, y = rng() * hh, r = 6 + rng() * 26;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rng() < 0.6 ? 'rgba(250,246,226,.62)' : 'rgba(236,206,112,.5)');
        g.addColorStop(1, 'rgba(250,246,226,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // cracks
      c.strokeStyle = 'rgba(70,44,20,.7)'; c.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        let x = rng() * w, y = rng() * hh, a = rng() * TAU;
        c.lineWidth = 1 + rng() * 2;
        c.beginPath(); c.moveTo(x, y);
        for (let k = 0; k < 8; k++) { a += (rng() - 0.5) * 1.2; x += Math.cos(a) * 9; y += Math.sin(a) * 9; c.lineTo(x, y); }
        c.stroke();
      }
      // crushed bean bits
      for (let i = 0; i < 260; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(150,104,52,.55)' : 'rgba(232,200,140,.5)'; c.beginPath(); c.ellipse(rng() * w, rng() * hh, 1.5 + rng() * 3, 1 + rng() * 2, rng() * 3, 0, TAU); c.fill(); }
    });
    const bump = K.tex(256, 256, (c, w, hh) => {
      c.fillStyle = '#808080'; c.fillRect(0, 0, w, hh);
      for (let i = 0; i < 700; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.2)'; c.beginPath(); c.arc(rng() * w, rng() * hh, 0.8 + rng() * 2.8, 0, TAU); c.fill(); }
      c.strokeStyle = 'rgba(0,0,0,.6)';
      for (let i = 0; i < 8; i++) { let x = rng() * w, y = rng() * hh, a = rng() * TAU; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 7; k++) { a += (rng() - 0.5) * 1.2; x += Math.cos(a) * 5; y += Math.sin(a) * 5; c.lineTo(x, y); } c.stroke(); }
    }, { srgb: false });
    const brick = K.mesh(geo, K.std('#ffffff', { map, bumpMap: bump, bumpScale: 2.2, roughness: 0.93 }), root);
    brick.position.y = H / 2;
    // straw twine: a cross binding + hanging loop
    const straw = strawMat(K, 'meju-straw');
    const rope = (sample, strands = 2, r = 0.011, twist = 24, seg = 200) => {
      const pts = []; for (let i = 0; i < 64; i++) pts.push(sample((i / 64) * TAU));
      const center = new THREE.CatmullRomCurve3(pts, true);
      const fr = center.computeFrenetFrames(seg, true);
      for (let s = 0; s < strands; s++) {
        const q = [];
        for (let i = 0; i < seg; i++) {
          const t = i / seg; const cp = center.getPointAt(t);
          const a = t * twist * TAU + (s * TAU) / strands;
          q.push(cp.addScaledVector(fr.normals[i], Math.cos(a) * r * 0.85).addScaledVector(fr.binormals[i], Math.sin(a) * r * 0.85));
        }
        K.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(q, true), seg, r, 6, true), straw, root);
      }
    };
    const sup = (a, b, th, n = 5) => { const c = Math.cos(th), s = Math.sin(th); return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]; };
    rope((th) => { const [x, y] = sup(W / 2 + 0.018, H / 2 + 0.018, th); return new THREE.Vector3(x, y + H / 2, 0); });
    rope((th) => { const [z, y] = sup(D / 2 + 0.02, H / 2 + 0.02, th); return new THREE.Vector3(0, y + H / 2, z); });
    // hanging loop from the top knot
    const top = H + 0.02;
    rope((th) => new THREE.Vector3(Math.sin(th) * 0.075 * (1 - 0.35 * Math.cos(th)), top + 0.17 - Math.cos(th) * 0.17, 0));
    const knot = K.mesh(new THREE.TorusGeometry(0.03, 0.016, 8, 18), straw, root);
    knot.position.set(0, top + 0.005, 0); knot.rotation.x = Math.PI / 2;
    // loose straw ends
    for (let i = 0; i < 7; i++) {
      const a = rng() * TAU;
      const s = new THREE.Vector3(Math.cos(a) * 0.03, top + 0.01, Math.sin(a) * 0.03);
      const e = s.clone().add(new THREE.Vector3(Math.cos(a) * (0.08 + rng() * 0.1), 0.02 + rng() * 0.08, Math.sin(a) * (0.08 + rng() * 0.1)));
      K.beam(s, e, 0.0045, 0.003, straw, root, 5);
    }
    beanInstances(K, root, beanPile(rng, 0.62, 0.32, 9, 0.1));
  };

  MODELS.bean = function (K, root) {
    const rng = U.rng('beanplant');
    const wood = woodMat(K, '#7a5232', 'tub');
    K.mesh(K.profile(null, 0, [[0, 0], [0.3, 0], [0.322, 0.02], [0.35, 0.235], [0.37, 0.25], [0.372, 0.272], [0.345, 0.276], [0.33, 0.25], [0.315, 0.2]], 48), wood, root);
    for (const y of [0.05, 0.2]) { const band = K.mesh(new THREE.TorusGeometry(0.33 + y * 0.12, 0.011, 6, 48), K.std('#3d2a1c', { roughness: 0.6, metalness: 0.2 }), root); band.rotation.x = Math.PI / 2; band.position.y = y; }
    const soilTex = K.tex(256, 256, (c, w, hh) => { c.fillStyle = '#4a321f'; c.fillRect(0, 0, w, hh); for (let i = 0; i < 1600; i++) { c.fillStyle = rng() < 0.5 ? 'rgba(20,12,6,.5)' : 'rgba(140,100,64,.4)'; const s = 1 + rng() * 3; c.fillRect(rng() * w, rng() * hh, s, s); } });
    const soil = K.mesh(moundGeo(K, 0.335, 0.035, '#5a3d26', '#3a2616', { seed: 2, rough: 0.05 }), K.std('#ffffff', { map: soilTex, vertexColors: true, roughness: 0.98 }), root);
    soil.position.y = 0.235;
    const stemMat = K.std('#5f8f34', { roughness: 0.7 });
    const leafMat = K.std('#ffffff', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 });
    const podMat = K.std('#a3b257', { roughness: 0.8 });
    const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.24, 0), new THREE.Vector3(0.02, 0.5, 0.01), new THREE.Vector3(-0.012, 0.8, 0.02), new THREE.Vector3(0.008, 1.06, 0)]);
    K.mesh(new THREE.TubeGeometry(stem, 24, 0.017, 7), stemMat, root);
    const leafBig = leafletGeo(K, 0.25, 0.1, '#3f8a2e', '#69a84a');
    const leafSmall = leafletGeo(K, 0.2, 0.08, '#468f33', '#74b153');
    const trifoliate = (pt, ang, tilt, scale = 1) => {
      const grp = new THREE.Group();
      grp.position.copy(pt);
      const mk = (geo, da, s) => {
        const m = K.mesh(geo, leafMat, grp);
        m.rotation.order = 'YXZ';
        m.rotation.set(-Math.PI / 2 + tilt, ang + Math.PI + da, 0);
        m.scale.setScalar(s * scale);
      };
      mk(leafBig, 0, 1); mk(leafSmall, 0.95, 0.95); mk(leafSmall, -0.95, 0.95);
      root.add(grp);
    };
    // pods: one shared lathe geometry, instanced
    const podPts = []; const PL = 0.2, PR = 0.024;
    for (let i = 0; i <= 24; i++) { const t = i / 24; const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.6); const bump = 0.78 + 0.22 * Math.abs(Math.sin(t * Math.PI * 3)); podPts.push([PR * env * bump, -t * PL]); }
    podPts.reverse();
    const podGeo = K.profile(null, 0, podPts, 12);
    podGeo.scale(1, 1, 0.62);
    { const pp = podGeo.attributes.position; for (let i = 0; i < pp.count; i++) { const t = -pp.getY(i) / PL; pp.setX(i, pp.getX(i) + 0.05 * t * t); } podGeo.computeVertexNormals(); }
    const pods = [];
    const nodes = 6;
    for (let i = 0; i < nodes; i++) {
      const t = 0.28 + i * 0.13;
      const pt = stem.getPointAt(Math.min(t, 0.97));
      const ang = i * 2.4 + 0.4;
      const dir = new THREE.Vector3(Math.sin(ang), 0.5 + rng() * 0.3, Math.cos(ang)).normalize();
      const len = 0.17 + rng() * 0.09;
      const end = pt.clone().addScaledVector(dir, len);
      const mid = pt.clone().lerp(end, 0.5); mid.y += 0.035;
      K.mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pt, mid, end), 8, 0.0065, 5), stemMat, root);
      trifoliate(end, ang, 0.25 + rng() * 0.25, 0.9 + (1 - i / nodes) * 0.25);
      if (i < 4) for (let k = 0; k < 3; k++) pods.push({ p: pt.clone().add(new THREE.Vector3(Math.sin(ang + (k - 1) * 0.9) * 0.025, -0.01, Math.cos(ang + (k - 1) * 0.9) * 0.025)), a: ang + (k - 1) * 0.9, tilt: 0.25 + rng() * 0.3 });
    }
    trifoliate(stem.getPointAt(1), 0.3, 0.75, 0.85);
    const pim = new THREE.InstancedMesh(podGeo, podMat, pods.length);
    const d = new THREE.Object3D();
    pods.forEach((q, i) => { d.position.copy(q.p); d.rotation.order = 'YXZ'; d.rotation.set(q.tilt, q.a, 0); d.scale.setScalar(0.9 + rng() * 0.25); d.updateMatrix(); pim.setMatrixAt(i, d.matrix); });
    pim.castShadow = true; pim.receiveShadow = true;
    root.add(pim);
    beanInstances(K, root, beanPile(rng, 0.46, 0.34, 22, 0.13).concat(beanPile(rng, -0.42, 0.4, 7, 0.07)));
  };

  MODELS.pepper = function (K, root) {
    const rng = U.rng('pepper');
    const weave = K.tex(256, 256, (c, w, hh) => {
      c.fillStyle = '#c99d5c'; c.fillRect(0, 0, w, hh);
      const s = 16;
      for (let y = 0; y < hh; y += s) for (let x = 0; x < w; x += s) {
        const odd = ((x + y) / s) % 2;
        const g = c.createLinearGradient(x, y, odd ? x + s : x, odd ? y : y + s);
        g.addColorStop(0, '#a87b3e'); g.addColorStop(0.5, '#e2bf82'); g.addColorStop(1, '#a87b3e');
        c.fillStyle = g; c.fillRect(x + 1, y + 1, s - 2, s - 2);
      }
    });
    weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(10, 3);
    const trayMat = K.std('#ffffff', { map: weave, roughness: 0.82, side: THREE.DoubleSide });
    K.mesh(K.profile(null, 0, [[0, 0], [0.26, 0], [0.45, 0.04], [0.58, 0.12], [0.62, 0.17], [0.615, 0.182], [0.57, 0.132], [0.44, 0.062], [0.25, 0.026], [0, 0.026]], 64), trayMat, root);
    const rim = K.mesh(new THREE.TorusGeometry(0.616, 0.02, 8, 72), K.std('#8a5f30', { roughness: 0.7 }), root);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.178;
    const red = K.phys('#c8161d', { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 });
    const deep = K.phys('#a50f16', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.14 });
    const green = K.phys('#3d8a2c', { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.2 });
    const calyx = K.std('#3f7a2a', { roughness: 0.6 });
    const cg = calyxGeo(K);
    const geos = [pepperGeo(K, 0.5, 0.055, 0.14), pepperGeo(K, 0.44, 0.05, -0.1), pepperGeo(K, 0.54, 0.058, 0.2)];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.35 + (rng() - 0.5) * 0.25;
      const fruit = i === 3 ? green : i % 2 ? deep : red;
      const pg = pepperGroup(K, { fruit, calyx }, geos[i % 3], cg);
      pg.rotation.order = 'YXZ';
      pg.rotation.set(Math.PI / 2 + 0.2, a + Math.PI, (rng() - 0.5) * 0.6);
      pg.position.set(Math.sin(a) * 0.1, 0.085, Math.cos(a) * 0.1);
      root.add(pg);
    }
    const topP = pepperGroup(K, { fruit: red, calyx }, geos[2], cg);
    topP.rotation.order = 'YXZ'; topP.rotation.set(Math.PI / 2 + 0.05, 0.9, 0.4); topP.position.set(-0.18, 0.17, -0.12);
    root.add(topP);
  };

  function napaLeafColor(inner) {
    return (u, v, c) => {
      const au = Math.abs(u);
      if (inner) mixHex('#f7f3cf', '#cfe48a', smooth01(0.3, 1, v) * (0.5 + au * 0.5), c);
      else { mixHex('#eef3c8', '#9ccb62', smooth01(0.22, 0.7, v), c); if (v > 0.6) c.lerp(_c2.set('#5c9a37'), smooth01(0.6, 1, v) * (0.55 + au * 0.45)); }
      if (au < 0.18) c.lerp(_c1.set(inner ? '#fbf8e2' : '#f3f2dc'), (1 - au / 0.18) * (1 - v * 0.7));
      return c;
    };
  }
  MODELS.cabbage = function (K, root) {
    const mat = K.std('#ffffff', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.55 });
    const layers = [
      { R0: 0.075, H: 0.9, span: 1.6, n: 3, inner: true, tilt: 0.0, flare: 0.0 },
      { R0: 0.115, H: 0.95, span: 1.4, n: 3, inner: true, tilt: 0.02, flare: 0.01 },
      { R0: 0.155, H: 0.98, span: 1.28, n: 3, inner: false, tilt: 0.03, flare: 0.03 },
      { R0: 0.19, H: 1.0, span: 1.2, n: 4, inner: false, tilt: 0.05, flare: 0.06 },
      { R0: 0.225, H: 0.94, span: 1.12, n: 4, inner: false, tilt: 0.1, flare: 0.13 },
    ];
    layers.forEach((Ly, li) => {
      for (let k = 0; k < Ly.n; k++) {
        const geo = wrapLeafGeo(K, { R0: Ly.R0, H: Ly.H, span: Ly.span, flare: Ly.flare, ruffle: Ly.inner ? 0.012 : 0.022, rib: Ly.inner ? 0.008 : 0.014, phase: li * 3 + k, colorFn: napaLeafColor(Ly.inner) });
        const g = new THREE.Group();
        g.rotation.y = (k / Ly.n) * TAU + li * 0.7;
        const m = K.mesh(geo, mat, g);
        m.rotation.x = Ly.tilt;
        root.add(g);
      }
    });
    const base = K.mesh(new THREE.CircleGeometry(0.2, 32), K.std('#efe6c4', { roughness: 0.8 }), root);
    base.rotation.x = Math.PI / 2; base.position.y = 0.004;
    // one peeled outer leaf lying beside the head
    const leaf = wrapLeafGeo(K, { R0: 0.26, H: 0.82, span: 0.9, flare: 0.2, ruffle: 0.03, colorFn: napaLeafColor(false), phase: 9 });
    const lg = new THREE.Group();
    const lm = K.mesh(leaf, mat, lg);
    lm.rotation.x = 1.35; lm.position.set(0, 0.02, 0.05);
    lg.rotation.y = 2.4;
    root.add(lg);
  };

  MODELS.kimchi = function (K, root) {
    const rng = U.rng('kimchi');
    const mat = onggiMat(K, { seed: 'kimchi', bandY: 0.34, base: ['#704428', '#52301b', '#3c2213'] });
    jarBody(K, mat, root, KIMCHI_JAR_PROFILE);
    const kimchiMat = K.phys('#ffffff', { vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    const baseMound = K.mesh(moundGeo(K, 0.335, 0.15, '#a3271a', '#5e140a', { seed: 4, rough: 0.22 }), kimchiMat, root);
    baseMound.position.y = 0.93;
    const redLeaf = (u, v, c) => {
      const au = Math.abs(u);
      mixHex('#c4462a', '#8a1d0f', smooth01(0.1, 0.8, v) * 0.75 + au * 0.25, c);
      if (au < 0.22) c.lerp(_c1.set('#e9a27a'), (1 - au / 0.22) * (1 - v * 0.8) * 0.85);
      const fl = noise3(u * 9, v * 14, 2.2);
      if (fl > 0.4) c.lerp(_c2.set('#5e0f06'), 0.55);
      return c;
    };
    for (let i = 0; i < 13; i++) {
      const geo = wrapLeafGeo(K, { R0: 0.06 + rng() * 0.04, H: 0.12 + rng() * 0.07, span: 1.3 + rng() * 0.6, flare: 0.015, ruffle: 0.008, rib: 0.008, segU: 10, segV: 10, phase: i, colorFn: redLeaf });
      const g = new THREE.Group();
      const a = (i / 13) * TAU * 2 + rng() * 0.5, d = i < 2 ? rng() * 0.05 : 0.07 + rng() * 0.17;
      g.position.set(Math.cos(a) * d, 0.93 + 0.15 * (1 - (d / 0.335) ** 2) - 0.015, Math.sin(a) * d);
      g.rotation.order = 'YXZ';
      g.rotation.set(1.3 + rng() * 0.3, a + Math.PI / 2 + (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.4);
      K.mesh(geo, kimchiMat, g);
      root.add(g);
    }
    const scal = K.std('#4f9a3a', { roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const a = rng() * TAU, d = rng() * 0.22;
      const s = new THREE.Vector3(Math.cos(a) * d, 1.04 + rng() * 0.08, Math.sin(a) * d);
      const e = s.clone().add(new THREE.Vector3((rng() - 0.5) * 0.14, (rng() - 0.3) * 0.05, (rng() - 0.5) * 0.14));
      K.beam(s, e, 0.008, 0.008, scal, root, 6);
    }
  };

  function buildJige(K, root) {
    const wood = woodMat(K, '#8a5c34', 'jige');
    const dark = woodMat(K, '#6e4826', 'jige2');
    const straw = strawMat(K, 'jige-straw');
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // main poles (legs at the bottom, converging toward the top)
    for (const s of [-1, 1]) K.beam(V(s * 0.27, 0, 0.04), V(s * 0.15, 1.5, -0.02), 0.036, 0.028, wood, root, 10);
    // cross bars (세장)
    for (const [y, r] of [[0.5, 0.017], [0.72, 0.016], [0.98, 0.015], [1.24, 0.015], [1.42, 0.014]]) {
      const t = y / 1.5; const x = 0.27 + (0.15 - 0.27) * t; const z = 0.04 - 0.06 * t;
      K.beam(V(-x, y, z), V(x, y, z), r, r, dark, root, 8);
    }
    // prongs (가지) sticking out the back
    for (const s of [-1, 1]) {
      const a = V(s * 0.245, 0.5, 0.02), b = V(s * 0.28, 0.78, -0.24), c = V(s * 0.3, 0.98, -0.36);
      K.beam(a, b, 0.03, 0.026, wood, root, 8);
      K.beam(b, c, 0.026, 0.02, wood, root, 8);
    }
    // straw back pad (등태) and shoulder straps (멜빵)
    const pad = K.mesh(new THREE.BoxGeometry(0.3, 0.32, 0.05, 1, 1, 1), straw, root);
    pad.position.set(0, 0.86, 0.06);
    for (const s of [-1, 1]) K.tube([[s * 0.13, 1.24, 0.05], [s * 0.16, 1.12, 0.2], [s * 0.18, 0.86, 0.22], [s * 0.2, 0.6, 0.12], [s * 0.22, 0.52, 0.04]], 0.016, straw, root, { seg: 30 });
    // firewood bundle on the prongs
    const bark = woodMat(K, '#6b5038', 'logs');
    const rng = U.rng('logs');
    for (let i = 0; i < 7; i++) {
      const y = 0.86 + (i % 3) * 0.05 + rng() * 0.01, z = -0.2 - Math.floor(i / 3) * 0.06 + (i % 2) * 0.02;
      K.beam(V(-0.42, y, z + (rng() - 0.5) * 0.03), V(0.42, y + (rng() - 0.5) * 0.04, z), 0.024, 0.022, bark, root, 7);
    }
    for (const x of [-0.25, 0.25]) { const band = K.mesh(new THREE.TorusGeometry(0.1, 0.008, 5, 18), straw, root); band.position.set(x, 0.92, -0.25); band.rotation.y = Math.PI / 2; band.scale.set(1, 1.05, 1.2); }
    // support stick (지겟작대기) with a fork
    const sA = V(0, 0, -0.62), sB = V(0, 0.98, -0.1);
    K.beam(sA, sB, 0.02, 0.018, dark, root, 8);
    for (const s of [-1, 1]) K.beam(sB, V(s * 0.06, 1.07, -0.08), 0.016, 0.012, dark, root, 6);
  }
  function buildMaetdol(K, root) {
    const rng = U.rng('maetdol');
    const rings = K.tex(512, 512, (c, w, hh) => {
      c.fillStyle = '#cfa762'; c.fillRect(0, 0, w, hh);
      for (let r = 4; r < w / 2; r += 7) { c.strokeStyle = r % 14 < 7 ? 'rgba(150,104,40,.55)' : 'rgba(250,224,160,.45)'; c.lineWidth = 3.5; c.beginPath(); c.arc(w / 2, hh / 2, r, 0, TAU); c.stroke(); }
      for (let i = 0; i < 40; i++) { const a = rng() * TAU; c.strokeStyle = 'rgba(120,80,30,.4)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * 30, hh / 2 + Math.sin(a) * 30); c.lineTo(w / 2 + Math.cos(a) * w / 2, hh / 2 + Math.sin(a) * hh / 2); c.stroke(); }
    });
    const matSide = strawMat(K, 'mat-side');
    const matTop = K.std('#ffffff', { map: rings, roughness: 0.88 });
    K.mesh(new THREE.CylinderGeometry(0.72, 0.74, 0.05, 64), [matSide, matTop, matSide], root).position.y = 0.025;
    const rim = K.mesh(new THREE.TorusGeometry(0.72, 0.03, 8, 72), matSide, root);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.06;
    const st = stoneTex(K, '#8f8c86', 'maetdol');
    const stone = K.std('#ffffff', { map: st, roughness: 0.88, bumpMap: st, bumpScale: 1.2 });
    K.mesh(K.profile(null, 0, [[0, 0.05], [0.4, 0.05], [0.43, 0.07], [0.44, 0.2], [0.42, 0.22], [0.03, 0.225]], 64), stone, root);
    const spout = K.mesh(new THREE.BoxGeometry(0.12, 0.05, 0.16), stone, root);
    spout.position.set(0, 0.12, 0.48); spout.rotation.x = 0.25;
    const upper = K.mesh(K.profile(null, 0, [[0.045, 0.255], [0.38, 0.235], [0.405, 0.25], [0.41, 0.4], [0.385, 0.425], [0.075, 0.425], [0.055, 0.405], [0.045, 0.3]], 64), stone, root);
    upper.rotation.y = 0.3;
    const hole = K.mesh(new THREE.CircleGeometry(0.047, 24), K.std('#2c2a27', { roughness: 1 }), root, false);
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.3;
    const handleWood = woodMat(K, '#7a5232', 'handle');
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    K.beam(V(0.36, 0.33, 0), V(0.66, 0.33, 0), 0.026, 0.024, handleWood, root, 10);
    K.beam(V(0.62, 0.33, 0), V(0.62, 0.6, 0), 0.026, 0.023, handleWood, root, 10);
    beanInstances(K, root, beanPile(rng, 0.12, 0.08, 14, 0.12, 0.425).concat(beanPile(rng, -0.38, 0.38, 8, 0.08, 0.05)));
    // ground bean paste trickling from the spout
    const paste = K.mesh(moundGeo(K, 0.13, 0.05, '#efe3c6', '#d9c49a', { seed: 7, rough: 0.3 }), K.std('#ffffff', { vertexColors: true, roughness: 0.6 }), root);
    paste.position.set(0, 0.05, 0.6);
  }
  MODELS.jige = function (K, root) { buildJige(K, root); };
  MODELS.maetdol = function (K, root) { buildMaetdol(K, root); };
  MODELS.tools = function (K, root) {
    const a = new THREE.Group(); buildJige(K, a); a.position.set(-0.55, 0, -0.1); a.rotation.y = 0.5; a.scale.setScalar(0.9);
    const b = new THREE.Group(); buildMaetdol(K, b); b.position.set(0.55, 0, 0.25); b.scale.setScalar(0.75);
    root.add(a, b);
  };

  function porcelainBowl(K, parent, r = 0.39, depth = 0.28) {
    const k = r / 0.39, d = depth / 0.28;
    const mat = K.phys('#f6f2ea', { roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08 });
    K.mesh(K.profile(null, 0, [[0, 0], [0.15 * k, 0], [0.16 * k, 0.035 * d], [0.145 * k, 0.04 * d], [0.2 * k, 0.07 * d], [0.32 * k, 0.17 * d], [0.38 * k, 0.26 * d], [0.39 * k, 0.28 * d], [0.375 * k, 0.285 * d], [0.36 * k, 0.26 * d], [0.3 * k, 0.17 * d], [0.18 * k, 0.09 * d], [0, 0.075 * d]], 64), mat, parent);
    const band = K.mesh(new THREE.TorusGeometry(0.352 * k, 0.006 * k, 6, 64), K.phys('#2d5fa8', { roughness: 0.2, clearcoat: 1 }), parent);
    band.rotation.x = Math.PI / 2; band.position.y = 0.215 * d;
    return mat;
  }
  MODELS.soy = function (K, root) {
    const rng = U.rng('soy');
    porcelainBowl(K, root);
    const soy = K.phys('#170703', { roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.35 });
    const liq = K.mesh(new THREE.CircleGeometry(0.33, 48), soy, root, false);
    liq.rotation.x = -Math.PI / 2; liq.position.y = 0.225;
    const g = new THREE.Group(); g.position.set(0.5, 0, 0.25); root.add(g);
    porcelainBowl(K, g, 0.16, 0.12);
    const liq2 = K.mesh(new THREE.CircleGeometry(0.135, 32), soy, g, false);
    liq2.rotation.x = -Math.PI / 2; liq2.position.y = 0.092;
    beanInstances(K, root, beanPile(rng, -0.5, 0.3, 12, 0.1));
    // small onggi soy bottle
    const bottle = new THREE.Group(); bottle.position.set(-0.32, 0, -0.42); root.add(bottle);
    const bm = onggiMat(K, { seed: 'soybottle', pattern: false });
    K.mesh(K.profile([[0, 0], [0.1, 0], [0.13, 0.05], [0.14, 0.16], [0.11, 0.26], [0.055, 0.32], [0.045, 0.36]], 30, [[0.055, 0.375], [0.05, 0.39], [0.035, 0.385], [0.03, 0.36]], 32), bm, bottle);
    const cork = K.mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.06, 14), K.std('#c49a5c', { roughness: 0.9 }), bottle);
    cork.position.y = 0.4;
  };
  function onggiBowl(K, parent, seed) {
    const m = onggiMat(K, { seed, pattern: false, bumpScale: 0.8 });
    K.mesh(K.profile(null, 0, [[0, 0], [0.22, 0], [0.24, 0.02], [0.34, 0.12], [0.38, 0.24], [0.385, 0.27], [0.37, 0.285], [0.35, 0.262], [0.32, 0.14], [0.21, 0.065], [0, 0.055]], 64), m, parent);
  }
  MODELS.doenjang = function (K, root) {
    const rng = U.rng('doenjang');
    onggiBowl(K, root, 'doenjang-bowl');
    const paste = K.mesh(moundGeo(K, 0.345, 0.12, '#7d5431', '#4f3219', { seed: 3, rough: 0.16, peak: 0.03 }), K.std('#ffffff', { vertexColors: true, roughness: 0.72 }), root);
    paste.position.y = 0.2;
    const bits = [];
    for (let i = 0; i < 26; i++) { const a = rng() * TAU, d = Math.sqrt(rng()) * 0.28; bits.push([Math.cos(a) * d, 0.2 + 0.11 * (1 - (d / 0.345) ** 2) + 0.005, Math.sin(a) * d, rng() * 3, rng() * 3, rng() * 3]); }
    beanInstances(K, root, bits, '#a0743f', 0.022);
    const spoonWood = woodMat(K, '#b88a55', 'spoon');
    const sp = new THREE.Group();
    const handle = K.mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.6, 10), spoonWood, sp);
    handle.rotation.z = Math.PI / 2; handle.position.x = 0.33;
    const bowl = K.mesh(new THREE.SphereGeometry(0.075, 18, 10, 0, TAU, 0, Math.PI / 2), spoonWood, sp);
    bowl.scale.set(1.35, 0.42, 1); bowl.rotation.x = Math.PI;
    sp.position.set(0.02, 0.33, 0.06); sp.rotation.set(0, -0.6, 0.32);
    root.add(sp);
  };
  MODELS.gochujang = function (K, root) {
    const mat = onggiMat(K, { seed: 'danji', bandY: 0.36, reps: 3 });
    jarBody(K, mat, root, DANJI_PROFILE);
    const paste = K.mesh(moundGeo(K, 0.19, 0.07, '#b3241a', '#7a130c', { seed: 8, rough: 0.12, peak: 0.07 }), K.phys('#ffffff', { vertexColors: true, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.25 }), root);
    paste.position.y = 0.56;
    const lidMat = onggiMat(K, { seed: 'danji-lid', pattern: false, side: THREE.DoubleSide, bumpScale: 0.6 });
    const lid = K.mesh(lidGeo(K, 0.23), lidMat, root);
    lid.position.set(0.48, 0.03, 0.12); lid.rotation.set(0.05, 0, -0.08);
    const red = K.phys('#c8161d', { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 });
    const calyx = K.std('#3f7a2a', { roughness: 0.6 });
    const cg = calyxGeo(K);
    const pg = pepperGeo(K, 0.42, 0.048, 0.12);
    const p1 = pepperGroup(K, { fruit: red, calyx }, pg, cg); p1.rotation.order = 'YXZ'; p1.rotation.set(Math.PI / 2, -2.3, 0.3); p1.position.set(-0.38, 0.05, 0.22);
    const p2 = pepperGroup(K, { fruit: red, calyx }, pg, cg); p2.rotation.order = 'YXZ'; p2.rotation.set(Math.PI / 2, -1.6, -0.6); p2.position.set(-0.3, 0.05, 0.42);
    root.add(p1, p2);
  };
  MODELS.vinegar = function (K, root) {
    const glazeTex = onggiTex(K, { seed: 'vinegar', pattern: false, base: ['#8a6a3a', '#6a4a22', '#4a3216'] });
    const m = K.phys('#ffffff', { map: glazeTex.map, bumpMap: glazeTex.bump, bumpScale: 0.6, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    K.mesh(K.profile([[0, 0], [0.13, 0], [0.16, 0.03], [0.21, 0.13], [0.215, 0.22], [0.17, 0.32], [0.105, 0.37], [0.1, 0.4], [0.14, 0.47], [0.145, 0.54], [0.11, 0.62], [0.055, 0.68], [0.045, 0.73]], 80, [[0.056, 0.75], [0.05, 0.77], [0.036, 0.765], [0.032, 0.74]], 64), m, root);
    const cork = K.mesh(new THREE.CylinderGeometry(0.042, 0.034, 0.07, 14), K.std('#c49a5c', { roughness: 0.92 }), root);
    cork.position.y = 0.79;
    const straw = strawMat(K, 'vin-straw');
    for (const y of [0.385, 0.405]) { const t = K.mesh(new THREE.TorusGeometry(0.108, 0.011, 6, 32), straw, root); t.rotation.x = Math.PI / 2; t.position.y = y; }
    const cup = new THREE.Group(); cup.position.set(0.36, 0, 0.18); root.add(cup);
    porcelainBowl(K, cup, 0.11, 0.12);
    const liq = K.mesh(new THREE.CircleGeometry(0.093, 28), K.phys('#d9a441', { roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 }), cup, false);
    liq.rotation.x = -Math.PI / 2; liq.position.y = 0.088;
  };
  MODELS.season = function (K, root) {
    const TERMS = ['입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지', '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지', '소한', '대한'];
    const SEASON = [['봄', '#8fd16a', '#5ea83c'], ['여름', '#ffc94a', '#e89b1c'], ['가을', '#f08a4b', '#c95a22'], ['겨울', '#8cc4f0', '#4f8fc9']];
    const font = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const draw = (c, w) => {
      const cx = w / 2, R = w / 2;
      c.clearRect(0, 0, w, w);
      c.fillStyle = '#f6ecd8'; c.beginPath(); c.arc(cx, cx, R, 0, TAU); c.fill();
      // 24 terms ring (입춘 at the top, clockwise)
      for (let i = 0; i < 24; i++) {
        const a0 = -Math.PI / 2 + (i - 0.5) * (TAU / 24), a1 = a0 + TAU / 24;
        const s = SEASON[Math.floor(i / 6)];
        c.fillStyle = i % 2 ? s[1] : s[2];
        c.beginPath(); c.moveTo(cx, cx); c.arc(cx, cx, R * 0.97, a0, a1); c.closePath(); c.fill();
        c.save(); c.translate(cx, cx); c.rotate((a0 + a1) / 2 + Math.PI / 2);
        c.fillStyle = '#24170a'; c.font = `900 ${Math.round(w * 0.046)}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(TERMS[i], 0, -R * 0.82);
        c.restore();
      }
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = w * 0.004;
      for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 + (i - 0.5) * (TAU / 24); c.beginPath(); c.moveTo(cx + Math.cos(a) * R * 0.66, cx + Math.sin(a) * R * 0.66); c.lineTo(cx + Math.cos(a) * R * 0.97, cx + Math.sin(a) * R * 0.97); c.stroke(); }
      // inner season quadrants
      c.fillStyle = '#fbf5e8'; c.beginPath(); c.arc(cx, cx, R * 0.66, 0, TAU); c.fill();
      for (let q = 0; q < 4; q++) {
        const a0 = -Math.PI / 2 - TAU / 48 + q * (TAU / 4), a1 = a0 + TAU / 4;
        c.fillStyle = SEASON[q][1] + '66';
        c.beginPath(); c.moveTo(cx, cx); c.arc(cx, cx, R * 0.62, a0, a1); c.closePath(); c.fill();
        const am = (a0 + a1) / 2;
        c.fillStyle = SEASON[q][2]; c.font = `900 ${Math.round(w * 0.075)}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(SEASON[q][0], cx + Math.cos(am) * R * 0.42, cx + Math.sin(am) * R * 0.42);
      }
      c.fillStyle = '#6b4a2b'; c.beginPath(); c.arc(cx, cx, R * 0.2, 0, TAU); c.fill();
      c.fillStyle = '#fff6e0'; c.font = `900 ${Math.round(w * 0.05)}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('24절기', cx, cx);
    };
    const face = K.tex(1024, 1024, (c, w) => draw(c, w), { anisotropy: 8 });
    // redraw once the web font is ready (canvas text needs the font loaded)
    try {
      if (document.fonts && document.fonts.load) {
        document.fonts.load(`800 40px "PretendardEmbed"`).then(() => { const c = face.image.getContext('2d'); draw(c, face.image.width); face.needsUpdate = true; }).catch(() => {});
      }
    } catch (e) { /* fonts api optional */ }
    const wood = woodMat(K, '#7a5232', 'wheel');
    const disc = K.mesh(new THREE.CylinderGeometry(1.0, 1.02, 0.08, 96), [wood, K.std('#ffffff', { map: face, roughness: 0.7 }), wood], root);
    disc.position.y = 0.04;
    disc.rotation.y = Math.PI / 2; // cap UVs put the canvas top at +X; turn it so 입춘 faces away from the camera
    const ring = K.mesh(new THREE.TorusGeometry(1.14, 0.006, 6, 140), K.std('#f4c54a', { emissive: '#8a6a10', emissiveIntensity: 0.4, roughness: 0.4 }), root, false);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
    const sun = new THREE.Group(); root.add(sun);
    const ball = K.mesh(new THREE.SphereGeometry(0.08, 28, 18), K.std('#ffd34d', { emissive: '#ffa31a', emissiveIntensity: 1.3, roughness: 0.4 }), sun, false);
    const halo = new THREE.Sprite(K.t(new THREE.SpriteMaterial({ map: K.t(G.gfx.radialTexture(128, 'rgba(255,214,90,0.8)', 'rgba(255,190,40,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 })));
    halo.scale.setScalar(0.34); sun.add(halo);
    const light = new THREE.PointLight(0xffd27a, 0.6, 1.2, 2); sun.add(light);
    root.userData.update = (dt, t) => {
      const a = -Math.PI / 2 + t * 0.45;
      sun.position.set(Math.cos(a) * 1.14, 0.2, Math.sin(a) * 1.14);
      ball.rotation.y = t;
      halo.scale.setScalar(0.32 + Math.sin(t * 3) * 0.02);
    };
    root.userData.update(0, 0);
    root.userData.extras = [sun]; // orbiting sun does not count for framing
  };
  // viewer framing hints
  const VIEW = {
    season: { elev: 1.0, noSpin: true, stand: false, size: 2.3, dist: 0.9, lookZ: 0.12 },
    jige: { elev: 0.22, size: 1.6 },
    tools: { elev: 0.3 },
    cabbage: { elev: 0.24 },
    jar: { elev: 0.28 },
    kimchi: { elev: 0.42 },
    doenjang: { elev: 0.62 },
    soy: { elev: 0.6 },
    gochujang: { elev: 0.45 },
    pepper: { elev: 0.7 },
    meju: { elev: 0.34 },
    maetdol: { elev: 0.45 },
    bean: { elev: 0.3 },
    vinegar: { elev: 0.3 },
  };

  // =============================================================================================
  // turntable viewer (separate small WebGLRenderer)
  // =============================================================================================
  class EduViewer {
    constructor(host) {
      this.host = host;
      this.ok = false;
      this.lost = false;
      this.disposed = false;
      this.own = new Set();
      this.models = new Map();
      this.current = null;
      this.visible = true;
      this.yaw = 0.55; this.yawVel = 0; this.idle = 3; this.dragging = false;
      this.elev = 0.3; this.elevTarget = 0.3; this.zoom = 1; this.zoomTarget = 1;
      this.t = 0;
      this._target = new THREE.Vector3();
      this._tick = this._tick.bind(this);
      try { this._init(); this.ok = true; } catch (e) {
        G.log.warn('UI', 'education 3D viewer unavailable, using illustrations instead', e);
        this.dispose();
      }
    }
    _init() {
      const canvas = document.createElement('canvas');
      canvas.className = 'edu-gl';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '3D 모델 (드래그해서 돌려 보기)');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
      this.renderer = r;
      this.canvas = canvas;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.02;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.setClearColor(0x000000, 0);
      this.host.prepend(canvas);
      const scene = this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
      scene.add(new THREE.HemisphereLight(0xfff3df, 0x4a3524, 0.55));
      const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
      key.position.set(-2.4, 4.2, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -1.7, right: 1.7, top: 1.7, bottom: -1.7, near: 0.5, far: 12 });
      key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
      scene.add(key);
      this.key = key;
      const rim = new THREE.DirectionalLight(0xcfe2ff, 1.25);
      rim.position.set(2.8, 2.2, -3.4);
      scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffe2c0, 0.45);
      fill.position.set(3, 1.2, 2.6);
      scene.add(fill);
      this._buildEnv();
      // turntable stand
      const K = makeKit(this.own);
      const top = K.tex(512, 512, (c, w) => {
        const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, '#9a6a40'); g.addColorStop(1, '#6e4626');
        c.fillStyle = g; c.fillRect(0, 0, w, w);
        for (let r = 6; r < w / 2; r += 5 + Math.sin(r) * 2) { c.strokeStyle = `rgba(50,28,12,${0.08 + (r % 3) * 0.03})`; c.lineWidth = 1.4; c.beginPath(); c.arc(w / 2 + Math.sin(r * 0.1) * 3, w / 2, r, 0, TAU); c.stroke(); }
      });
      const side = woodMat(K, '#6e4626', 'stand-side');
      this.stand = K.mesh(new THREE.CylinderGeometry(1, 1.03, 0.07, 72), [side, K.std('#ffffff', { map: top, roughness: 0.62 }), side], scene, false);
      this.stand.position.y = -0.035;
      this.stand.receiveShadow = true;
      this.pivot = new THREE.Group();
      scene.add(this.pivot);
      this._bind();
      this._resize();
      if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this._resize()); this.ro.observe(this.host); }
      this._onLost = (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); };
      canvas.addEventListener('webglcontextlost', this._onLost);
      this._last = performance.now();
      this.raf = requestAnimationFrame(this._tick);
    }
    _buildEnv() {
      const env = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const p = geo.attributes.position;
      const col = [];
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / 10;
        if (y > 0) mixHex('#f3e2c4', '#fffaf2', y, c); else mixHex('#f3e2c4', '#3a2a1c', -y * 1.6, c);
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const sm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      env.add(new THREE.Mesh(geo, sm));
      const boxGeo = new THREE.PlaneGeometry(5, 3.5);
      const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      boxMat.color.setScalar(3.2);
      const b1 = new THREE.Mesh(boxGeo, boxMat); b1.position.set(-5, 6, 5); b1.lookAt(0, 0, 0); env.add(b1);
      const b2 = new THREE.Mesh(boxGeo, boxMat); b2.position.set(6, 3, -3); b2.lookAt(0, 0, 0); b2.scale.setScalar(0.6); env.add(b2);
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pm.fromScene(env, 0.035);
      pm.dispose();
      geo.dispose(); sm.dispose(); boxGeo.dispose(); boxMat.dispose();
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.85;
    }
    _bind() {
      const c = this.canvas;
      this._h = {
        down: (e) => { this.dragging = true; this.px = e.clientX; this.py = e.clientY; this.idle = 0; this.yawVel = 0; try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } },
        move: (e) => {
          if (!this.dragging) return;
          const dx = e.clientX - this.px, dy = e.clientY - this.py;
          this.px = e.clientX; this.py = e.clientY;
          this.yaw += dx * 0.011;
          this.yawVel = dx * 0.35;
          this.elevTarget = clamp(this.elevTarget + dy * 0.004, -0.05, 1.25);
        },
        up: () => { this.dragging = false; this.idle = 0; },
        wheel: (e) => { e.preventDefault(); this.zoomTarget = clamp(this.zoomTarget * (e.deltaY > 0 ? 0.92 : 1.08), 0.8, 1.7); this.idle = 0; },
        dbl: () => { this.zoomTarget = 1; this.elevTarget = this.current?.view.elev ?? 0.3; },
      };
      c.addEventListener('pointerdown', this._h.down);
      c.addEventListener('pointermove', this._h.move);
      c.addEventListener('pointerup', this._h.up);
      c.addEventListener('pointercancel', this._h.up);
      c.addEventListener('wheel', this._h.wheel, { passive: false });
      c.addEventListener('dblclick', this._h.dbl);
    }
    _resize() {
      if (!this.renderer || this.disposed) return;
      const w = Math.max(40, this.host.clientWidth), hh = Math.max(40, this.host.clientHeight);
      if (w === this._w && hh === this._h2) return;
      this._w = w; this._h2 = hh;
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    }
    /** show a model by name; returns false when unknown / unavailable */
    setModel(name, opts = {}) {
      if (!this.ok || this.disposed || this.lost) return false;
      const key = name + (opts && opts.lidOpen ? ':open' : '');
      let entry = this.models.get(key);
      if (!entry) {
        const build = MODELS[name];
        if (!build) return false;
        try {
          const root = new THREE.Group();
          build(makeKit(this.own), root, opts || {});
          entry = this._normalize(root, VIEW[name] || {});
          this.models.set(key, entry);
        } catch (e) {
          G.log.warn('UI', `edu model "${name}" failed`, e);
          return false;
        }
      }
      if (this.current && this.current !== entry) this.pivot.remove(this.current.box);
      if (!entry.box.parent) this.pivot.add(entry.box);
      if (this.current !== entry) {
        this.current = entry;
        this.elevTarget = entry.view.elev ?? 0.3;
        this.elev = this.elevTarget;
        this.zoomTarget = 1; this.zoom = 1;
        this.yaw = entry.view.noSpin ? 0 : 0.55;
        this.yawVel = 0; this.idle = 3;
      }
      this.stand.visible = entry.view.stand !== false;
      this.stand.scale.set(entry.standR, 1, entry.standR);
      this.show(true);
      return true;
    }
    _normalize(root, view) {
      const extras = (root.userData.extras || []).filter((o) => o.parent === root);
      for (const o of extras) root.remove(o);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      for (const o of extras) root.add(o);
      const size = box.getSize(new THREE.Vector3());
      const s = (view.size || 1.5) / Math.max(size.x, size.y, size.z, 0.01);
      root.scale.setScalar(s);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      root.position.set(-cx * s, -box.min.y * s, -cz * s);
      const wrap = new THREE.Group();
      wrap.add(root);
      const hgt = size.y * s;
      const foot = Math.hypot(size.x, size.z) * s / 2;
      const radius = Math.sqrt(foot * foot + (hgt / 2) * (hgt / 2));
      return { box: wrap, root, view, height: hgt, radius, standR: Math.max(0.55, foot * 0.92 + 0.12) };
    }
    show(on) {
      this.visible = !!on;
      if (this.canvas) this.canvas.hidden = !on;
    }
    _tick(now) {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(this._tick);
      const dt = Math.min(0.05, Math.max(0, (now - this._last) / 1000));
      this._last = now;
      if (!this.visible || !this.current || this.lost || document.hidden || !this.host.isConnected) return;
      if (this.isActive && !this.isActive()) return; // covered by another modal: save GPU time
      this.t += dt;
      const reduce = !!G.settings?.reduceMotion;
      const v = this.current.view;
      if (!this.dragging) {
        this.idle += dt;
        this.yaw += this.yawVel * dt;
        this.yawVel *= Math.exp(-3.2 * dt);
        if (this.idle > 2.2 && !reduce && !v.noSpin) this.yaw += dt * 0.42;
      }
      this.pivot.rotation.y = this.yaw;
      this.elev += (this.elevTarget - this.elev) * (1 - Math.exp(-7 * dt));
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-7 * dt));
      try { this.current.root.userData.update?.(dt, reduce ? 0 : this.t); } catch (e) { /* cosmetic */ }
      const cam = this.camera;
      const half = THREE.MathUtils.degToRad(cam.fov / 2);
      const hHalf = Math.atan(Math.tan(half) * cam.aspect);
      const fit = Math.min(half, hHalf);
      const dist = (this.current.radius / Math.sin(fit)) * (v.dist || 1.04) / this.zoom;
      const ty = this.current.height * (v.lookY ?? 0.45);
      const tz = (v.lookZ || 0) * this.current.radius;
      this._target.set(0, ty, tz);
      cam.position.set(0, ty + Math.sin(this.elev) * dist, tz + Math.cos(this.elev) * dist);
      cam.lookAt(this._target);
      this.renderer.render(this.scene, cam);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      try { this.ro?.disconnect(); } catch (e) { /* ignore */ }
      const c = this.canvas;
      if (c && this._h) {
        c.removeEventListener('pointerdown', this._h.down); c.removeEventListener('pointermove', this._h.move);
        c.removeEventListener('pointerup', this._h.up); c.removeEventListener('pointercancel', this._h.up);
        c.removeEventListener('wheel', this._h.wheel); c.removeEventListener('dblclick', this._h.dbl);
        c.removeEventListener('webglcontextlost', this._onLost);
      }
      for (const o of this.own) { try { o.dispose?.(); } catch (e) { /* ignore */ } }
      this.own.clear();
      this.models.clear();
      try { this.envRT?.dispose(); } catch (e) { /* ignore */ }
      try { this.key?.shadow?.dispose(); } catch (e) { /* ignore */ }
      try { this.renderer?.dispose(); this.renderer?.forceContextLoss?.(); } catch (e) { /* ignore */ }
      c?.remove();
      this.scene = null; this.renderer = null; this.current = null;
    }
  }

  // =============================================================================================
  // visuals (shared by the content modal and the exhibit card)
  // =============================================================================================
  /** render a page visual into a `.edu-visual` box. state: {viewer} (created lazily) */
  function renderVisual(box, vis, st, fallbackIcon) {
    const layer = box.querySelector('.edu-vis-layer');
    const cap = box.querySelector('.edu-vis-caption');
    const hint = box.querySelector('.edu-vis-hint');
    layer.innerHTML = '';
    layer.className = 'edu-vis-layer';
    box.classList.remove('is-3d');
    let used3d = false;
    st.vis = vis; st.fallbackIcon = fallbackIcon;
    if (vis && vis.type === 'model') {
      if (!st.viewer) {
        st.viewer = new EduViewer(box);
        const modalEl = box.closest('.modal');
        st.viewer.isActive = () => { const t = G.ui.modal.top?.(); return !t || !modalEl || t.el === modalEl; };
        st.viewer.onLost = () => { if (box.isConnected) renderVisual(box, st.vis, st, st.fallbackIcon); };
      }
      if (st.viewer.ok && !st.viewer.lost && st.viewer.setModel(vis.model, vis.opts)) { used3d = true; box.classList.add('is-3d'); }
    }
    if (!used3d) st.viewer?.show(false);
    if (!used3d) {
      const t = vis?.type;
      if (t === 'svg' && vis.svg) {
        layer.classList.add('edu-vis-svg');
        layer.innerHTML = sanitizeSvg(vis.svg);
      } else if (t === 'steps' && Array.isArray(vis.items)) {
        layer.classList.add('edu-vis-steps');
        const wrap = h('div', { class: 'edu-steps' });
        vis.items.forEach((it, i) => {
          if (i > 0) { const sep = it.sep ?? vis.sep ?? '→'; if (sep) wrap.appendChild(h('span', { class: 'edu-step-sep', style: `--i:${i}` }, sep)); }
          wrap.appendChild(h('div', { class: 'edu-step', style: `--i:${i}` }, h('span', { class: 'emoji' }, it.icon || '•'), h('span', { class: 'edu-step-lbl' }, it.label || '')));
        });
        layer.appendChild(wrap);
      } else {
        const em = t === 'emoji' ? vis.emoji : (t === 'model' ? MODEL_EMOJI[vis.model] : null);
        layer.classList.add('edu-vis-emoji-wrap');
        layer.appendChild(h('div', { class: 'edu-vis-emoji emoji' }, em || fallbackIcon || '📖'));
      }
    }
    if (cap) { cap.textContent = vis?.caption || ''; cap.hidden = !vis?.caption; }
    if (hint) hint.hidden = !used3d;
    return used3d;
  }
  function visualBox(extraClass = '') {
    return h('div', { class: `edu-visual ${extraClass}` },
      h('div', { class: 'edu-vis-layer' }),
      h('div', { class: 'edu-vis-hint', hidden: true }, h('span', { class: 'emoji' }, '🖐️'), ' 드래그해서 돌려 보기'),
      h('div', { class: 'edu-vis-caption', hidden: true }));
  }
  function confetti(host) {
    if (!host || G.settings?.reduceMotion) return;
    const box = h('div', { class: 'quiz-confetti', 'aria-hidden': 'true' });
    const colors = ['#f4c54a', '#34c36b', '#4aa8ff', '#ff7eb6', '#ff9f43', '#a07dff'];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('i');
      const a = Math.random() * TAU, d = 90 + Math.random() * 150;
      s.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(0)}px`);
      s.style.setProperty('--dy', `${(Math.sin(a) * d - 70).toFixed(0)}px`);
      s.style.setProperty('--r', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = `${(Math.random() * 80).toFixed(0)}ms`;
      box.appendChild(s);
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 1500);
  }

  // =============================================================================================
  // hall guide illustration
  // =============================================================================================
  function hallSvg(floors) {
    const ys = [[84, 148], [152, 216], [220, 286]];
    const fl = floors.map((f, i) => {
      const [y0, y1] = ys[i] || ys[2];
      const mull = [];
      for (let x = 46; x < 216; x += 17) mull.push(`<path d="M${x} ${y0 + 6}V${y1 - (i < 2 ? 12 : 4)}" stroke="#d9ecf7" stroke-opacity=".55" stroke-width="1.4"/>`);
      return `<g class="hall-fl" data-i="${i}" tabindex="0" role="button" aria-label="${esc(f.floor + ' ' + f.name)}">
<rect x="36" y="${y0}" width="188" height="${y1 - y0}" fill="url(#hgGlass)"/>
${mull.join('')}
${i < 2 ? `<rect x="30" y="${y1 - 12}" width="200" height="8" rx="2" fill="#8a5a3b"/><path d="M34 ${y1 - 12}v-10M226 ${y1 - 12}v-10M34 ${y1 - 22}h192" stroke="#a8774f" stroke-width="2"/>` : ''}
<rect class="hall-fl-hit" x="30" y="${y0}" width="200" height="${y1 - y0}" rx="3"/>
<g class="hall-fl-tag"><rect x="44" y="${y0 + 10}" width="${26 + f.name.length * 12.5}" height="24" rx="12" fill="rgba(14,22,18,.78)"/><text x="56" y="${y0 + 27}" font-size="12.5" font-weight="800" fill="${esc(f.color || '#f4c54a')}">${esc(f.floor)}</text><text x="80" y="${y0 + 27}" font-size="12" font-weight="700" fill="#fff">${esc(f.name)}</text></g>
<text x="206" y="${y0 + 40}" font-size="22" text-anchor="middle">${esc(f.icon || '')}</text>
</g>`;
    }).join('');
    return `<svg class="hall-svg" viewBox="0 0 260 320" xmlns="http://www.w3.org/2000/svg" font-family="PretendardEmbed,Pretendard,'Noto Sans KR',sans-serif">
<defs><linearGradient id="hgSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9d6ff"/><stop offset="1" stop-color="#eaf6ff"/></linearGradient>
<linearGradient id="hgGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb4d6"/><stop offset=".5" stop-color="#a9d3ea"/><stop offset="1" stop-color="#5f93b8"/></linearGradient>
<linearGradient id="hgRoof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5058"/><stop offset="1" stop-color="#2b3036"/></linearGradient></defs>
<rect width="260" height="320" rx="18" fill="url(#hgSky)"/>
<path d="M0 150 L50 96 L96 132 L150 80 L210 128 L260 100 V300 H0z" fill="#86b87a" opacity=".75"/>
<path d="M0 190 L70 140 L130 176 L200 130 L260 170 V300 H0z" fill="#5f9a52" opacity=".8"/>
<rect x="0" y="286" width="260" height="34" fill="#b9b1a3"/><rect x="0" y="286" width="260" height="5" fill="#d2ccc0"/>
<rect x="30" y="80" width="200" height="208" rx="3" fill="#e8e2d6"/>
<path d="M8 82 Q30 76 46 60 L214 60 Q230 76 252 82 L240 88 Q130 78 20 88 Z" fill="url(#hgRoof)"/>
<path d="M46 60 Q130 44 214 60" fill="none" stroke="#1d2126" stroke-width="5" stroke-linecap="round"/>
<g stroke="#5c636c" stroke-width="1.2" opacity=".8">${Array.from({ length: 16 }, (_, k) => `<path d="M${52 + k * 10.3} 62 L${46 + k * 11} 82"/>`).join('')}</g>
${fl}
<rect x="112" y="250" width="36" height="36" rx="2" fill="#2b3a44"/><path d="M130 250v36" stroke="#9fc3d8" stroke-width="2"/><rect x="104" y="246" width="52" height="6" rx="2" fill="#8a5a3b"/>
<text x="130" y="306" text-anchor="middle" font-size="11" font-weight="800" fill="#4a3c2c">전통발효체험관</text>
</svg>`;
  }

  // =============================================================================================
  // system
  // =============================================================================================
  const SIGN_LINKS = { SIGN_HERB: 'EDU_FARMING', SIGN_STORAGE: 'EDU_JANGDOK', SIGN_EDU: '@library', SIGN_ENTRANCE: '@hall', SIGN_REST: null };

  const education = {
    name: 'education', order: 64, label: '교육 콘텐츠',
    Viewer: EduViewer,
    MODELS,
    _edu: null, _quiz: null, _lib: null, _hall: null,
    _interactIds: new Set(),
    _viewLog: new Map(),

    init() {
      this._registerInteractables();
      const on = (ev, fn) => G.bus.on(ev, fn);
      on('edu:completed', () => this._refreshOpen());
      on('quiz:answered', () => this._refreshOpen());
      on('world:object', ({ id, obj }) => { if (this._interactIds.has(id) && obj) G.interact?.setObject?.(id, obj); });
      // keyboard: page turning / quiz choices while my modals are on top
      const top = () => G.ui.modal.top?.()?.id;
      const nav = (d) => () => { if (top() !== 'edu-content' || !this._edu) return false; this._go(this._edu, this._edu.page + d); return true; };
      for (const code of ['ArrowRight', 'PageDown']) G.input?.onKey?.(code, nav(1), { allowInModal: true });
      for (const code of ['ArrowLeft', 'PageUp']) G.input?.onKey?.(code, nav(-1), { allowInModal: true });
      const choose = (i) => () => {
        if (top() !== 'edu-quiz' || !this._quiz) return false;
        const q = this._quiz;
        if (q.kid) { if (q.phase !== 'right') this._kidPick(q, i); return true; }
        if (q.phase === 'ask' || q.phase === 'wrong') { if (q.phase === 'wrong') { q.phase = 'ask'; q.picked = -1; } this._pick(q, i); return true; }
        return false;
      };
      [['Digit1', 0], ['Digit2', 1], ['Digit3', 2], ['Digit4', 3], ['Numpad1', 0], ['Numpad2', 1], ['Numpad3', 2], ['Numpad4', 3]].forEach(([code, i]) => G.input?.onKey?.(code, choose(i), { allowInModal: true }));
      // 쉬운 모드 switched while one of my windows is on top: reopen it in the other style
      on('easy:changed', () => {
        const t = G.ui.modal.top?.();
        if (!t || !G.state) return;
        const kid = kidOn();
        const c = this._edu, q = this._quiz;
        if (t.id === 'edu-content' && c && c.m === t && !!c.kid !== (kid && !!kidOf(c.e))) { t.close(); this.open(c.eduId); }
        else if (t.id === 'edu-quiz' && q && q.m === t && !!q.kid !== (kid && !!kidQuizOf(q.q))) { t.close(); this.openQuiz(q.quizId); }
        else if (t.id === 'edu-library' && this._lib && this._lib.m === t && !!this._lib.kid !== kid) { t.close(); this.openLibrary(); }
        else if (t.id === 'edu-hall' && this._hall && this._hall.m === t && !!this._hall.kid !== kid) { t.close(); this.openHallGuide(); }
      });
      G.log.info('UI', `education: ${eduIds().length} contents, ${Object.keys(QZ()).length} quizzes, ${this._interactIds.size} interactables`);
    },

    onStateLoaded() {
      est();
      // a different player / imported save: close anything showing the previous state
      this._closeAll();
    },
    onLogout() { this._closeAll(); this._viewLog.clear(); },

    _closeAll() { for (const id of MODAL_IDS) { try { G.ui.modal.get(id)?.close(); } catch (e) { /* ignore */ } } },

    // ------------------------------------------------------------ queries
    ids() { return eduIds(); },
    isCompleted(id) { return !!est()?.completed?.[id]; },
    isQuizSolved(id) { return solvedVal(quizRec(id)); },
    quizIds(eduId) { return quizIdsOf(eduId); },
    viewedPages(id) { const v = est()?.viewed?.[id]; return Array.isArray(v?.pages) ? v.pages.slice() : []; },
    stats() {
      const ids = eduIds();
      const qids = Object.keys(QZ());
      return {
        contents: ids.length, completed: ids.filter((i) => this.isCompleted(i)).length,
        quizzes: qids.length, solved: qids.filter((q) => this.isQuizSolved(q)).length,
        edu: G.state?.stats?.edu || 0,
      };
    },
    /** an unsolved quiz of eduId (else any of it); without eduId: any unsolved quiz (content order) */
    pickQuiz(eduId, exclude) {
      const pool = eduId ? quizIdsOf(eduId) : eduIds().flatMap((e) => quizIdsOf(e));
      const open = pool.filter((q) => q !== exclude && !this.isQuizSolved(q));
      if (open.length) return open[0];
      if (eduId) return pool.find((q) => q !== exclude) || pool[0] || null;
      return null;
    },

    // ------------------------------------------------------------ content modal
    open(eduId, opts = {}) {
      const e = EDU()[eduId];
      if (!e || !Array.isArray(e.pages) || !e.pages.length) {
        G.log.warn('UI', 'unknown education content', eduId);
        G.ui.toast('교육 콘텐츠를 찾을 수 없어요.', { type: 'warn' });
        return null;
      }
      if (kidOn() && kidOf(e)) return this._openKid(eduId, opts);
      const n = e.pages.length;
      const seen = this.viewedPages(eduId);
      const ctx = {
        eduId, e, page: -1, n,
        maxSeen: this.isCompleted(eduId) ? n - 1 : Math.max(-1, ...seen),
        vis: { viewer: null }, justCompleted: false,
      };
      const start = opts.page != null && Number.isFinite(+opts.page) ? clamp(Math.floor(+opts.page), 0, n - 1) : 0;
      ctx.maxSeen = Math.max(ctx.maxSeen, start);
      const head = h('div', { class: 'edu-head-extra' });
      head.innerHTML = catChip(e);
      ctx.dots = h('div', { class: 'edu-dots', role: 'tablist', 'aria-label': '페이지' });
      head.appendChild(ctx.dots);
      const m = G.ui.modal.open({
        id: 'edu-content', size: 'xl', className: 'edu-modal', title: e.title, icon: e.icon || '📖', headExtra: head,
        onClose: () => {
          ctx.vis.viewer?.dispose(); ctx.vis.viewer = null;
          if (this._edu === ctx) this._edu = null;
          setTimeout(() => this._refreshOpen(), 0);
        },
      });
      ctx.m = m;
      ctx.box = visualBox();
      ctx.text = h('div', { class: 'edu-text scroll' });
      const layout = h('div', { class: 'edu-layout' }, ctx.box, ctx.text);
      m.body.appendChild(layout);
      ctx.text.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-edu-open]');
        if (b) { this.open(b.dataset.eduOpen); return; }
        const q = ev.target.closest('[data-quiz-open]');
        if (q) this.openQuiz(q.dataset.quizOpen);
      });
      ctx.dots.addEventListener('click', (ev) => { const b = ev.target.closest('[data-page]'); if (b && !b.disabled) this._go(ctx, +b.dataset.page); });
      this._edu = ctx;
      this._logView(eduId, e);
      this._go(ctx, start);
      return m;
    },
    _logView(eduId, e) {
      const now = Date.now();
      const last = this._viewLog.get(eduId) || 0;
      if (now - last > 10 * 60 * 1000) { this._viewLog.set(eduId, now); G.activity('edu', `「${e.title}」 교육 보기`, { eduId }); }
    },
    _go(ctx, page) {
      if (!ctx || ctx.m?.closed) return;
      if (ctx.kid) { this._kidGo(ctx, page); return; }
      const n = ctx.n;
      page = clamp(page, 0, n - 1);
      if (page > ctx.maxSeen + 1 && !this.isCompleted(ctx.eduId)) page = ctx.maxSeen + 1;
      if (page === ctx.page) return;
      const dir = page > ctx.page ? 1 : -1;
      const firstShow = ctx.page === -1;
      ctx.page = page;
      ctx.maxSeen = Math.max(ctx.maxSeen, page);
      // state + events
      const S = est();
      if (S) {
        const v = S.viewed[ctx.eduId] && typeof S.viewed[ctx.eduId] === 'object' ? S.viewed[ctx.eduId] : (S.viewed[ctx.eduId] = { at: G.time.now(), pages: [] });
        if (!Array.isArray(v.pages)) v.pages = [];
        if (!v.pages.includes(page)) v.pages.push(page);
        v.last = page; v.lastAt = G.time.now();
        G.dirty('edu');
      }
      G.bus.emit('edu:viewed', { eduId: ctx.eduId, page });
      if (!firstShow) G.sfx('page');
      if (page === n - 1 && !this.isCompleted(ctx.eduId)) ctx.justCompleted = this._complete(ctx.eduId);
      this._renderPage(ctx, dir);
    },
    _complete(eduId) {
      const S = est();
      const e = EDU()[eduId];
      if (!S || !e || S.completed[eduId]) return false;
      S.completed[eduId] = G.time.now();
      G.dirty('edu');
      addEduPoints(COMPLETE_EDU_POINTS);
      G.activity('edu', `「${e.title}」 학습 완료`, { eduId, completed: true });
      G.log.info('UI', `education completed: ${eduId}`);
      G.bus.emit('edu:completed', { eduId });
      if (kidOn() && G.easy?.celebrate) G.easy.celebrate('다 배웠어요!', { emoji: e.icon || '📖', say: `${kidTitle(e)}, 다 배웠어요! 최고예요!`, sound: 'reward', duration: 1800 });
      else {
        G.ui.toast(`「${e.title}」 학습 완료! 교육 포인트 +${COMPLETE_EDU_POINTS}`, { type: 'success', emoji: '📖', sound: false });
        G.sfx('reward');
      }
      return true;
    },
    _renderPage(ctx, dir) {
      const { e, page, n } = ctx;
      const p = e.pages[page];
      const last = page === n - 1;
      renderVisual(ctx.box, p.visual, ctx.vis, e.icon);
      ctx.box.classList.remove('edu-swap'); void ctx.box.offsetWidth; ctx.box.classList.add('edu-swap');
      // dots
      ctx.dots.innerHTML = '';
      const done = this.isCompleted(ctx.eduId);
      for (let i = 0; i < n; i++) {
        const reachable = done || i <= ctx.maxSeen + 1;
        ctx.dots.appendChild(h('button', { type: 'button', class: `edu-dot ${i === page ? 'on' : ''} ${i <= ctx.maxSeen ? 'seen' : ''}`, 'data-page': i, disabled: !reachable, 'aria-label': `${i + 1}쪽`, title: `${i + 1}쪽 · ${e.pages[i].title}` }));
      }
      // text
      const c = catOf(e);
      const pts = Array.isArray(p.points) && p.points.length ? `<ul class="edu-points">${p.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
      let doneBox = '';
      if (last) {
        const qids = quizIdsOf(ctx.eduId);
        const solved = qids.filter((q) => this.isQuizSolved(q)).length;
        const rel = (e.related || []).filter((r) => EDU()[r]);
        doneBox = `<div class="edu-done ${ctx.justCompleted ? 'fresh' : ''}">
          <div class="ed-title">${ctx.justCompleted ? `🎉 학습 완료! <span class="chip chip-gold">교육 포인트 +${COMPLETE_EDU_POINTS}</span>` : '✅ 끝까지 학습한 콘텐츠예요'}</div>
          ${qids.length ? `<p class="ed-sub">배운 내용을 퀴즈로 확인해 보세요. <b>${solved}/${qids.length}</b> 문제 정답 <span class="ed-rw">첫 정답마다 EXP +100 · 교육 +10</span></p>` : ''}
          ${rel.length ? `<div class="edu-related"><span class="er-lbl">함께 보면 좋아요</span>${rel.map((r) => `<button type="button" class="chip chip-btn" data-edu-open="${esc(r)}">${esc(EDU()[r].icon || '📖')} ${esc(EDU()[r].title)}${this.isCompleted(r) ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
        </div>`;
      }
      ctx.text.innerHTML = `<div class="edu-text-inner ${dir < 0 ? 'edu-anim-back' : 'edu-anim-in'}">
        <div class="edu-eyebrow" style="--c:${esc(c.color)}">${esc(c.name)} · ${page + 1} / ${n}</div>
        <h3 class="edu-page-title">${esc(p.title)}</h3>
        <p class="edu-body-text">${esc(p.text)}</p>
        ${pts}
        ${doneBox}
        <div class="edu-source"><span class="ico ico-xs" data-icon="info"></span><span>출처: ${esc(e.source || '일반 상식 요약(교육용)')}${e.verified || /감수/.test(e.source || '') ? '' : ' · 전문가 감수 전'}${last && G.data.meta?.disclaimer ? `<br>${esc(G.data.meta.disclaimer)}` : ''}</span></div>
      </div>`;
      G.ui.hydrateIcons(ctx.text);
      ctx.text.scrollTop = 0;
      // footer
      const foot = ctx.m.foot;
      foot.innerHTML = '';
      foot.classList.add('edu-foot');
      const lib = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: '모든 교육 콘텐츠 보기' }, h('span', { class: 'emoji' }, '📚'), ' 배움터');
      lib.addEventListener('click', () => { ctx.m.close(); this.openLibrary(); });
      const prev = h('button', { type: 'button', class: 'btn', disabled: page === 0 }, h('span', { class: 'ico ico-sm', 'data-icon': 'chevron-left' }), '이전');
      prev.addEventListener('click', () => this._go(ctx, ctx.page - 1));
      const pageNo = h('span', { class: 'edu-pageno' }, `${page + 1} / ${n}`);
      foot.append(lib, h('span', { class: 'spacer' }), prev, pageNo);
      if (!last) {
        const next = h('button', { type: 'button', class: 'btn btn-primary' }, '다음', h('span', { class: 'ico ico-sm', 'data-icon': 'chevron-right' }));
        next.addEventListener('click', () => this._go(ctx, ctx.page + 1));
        foot.append(next);
      } else {
        const qid = this.pickQuiz(ctx.eduId);
        if (qid) {
          const qb = h('button', { type: 'button', class: 'btn btn-gold' }, h('span', { class: 'emoji' }, '✏️'), ' 퀴즈 풀기');
          qb.addEventListener('click', () => this.openQuiz(qid));
          foot.append(qb);
        }
        const close = h('button', { type: 'button', class: 'btn' }, '닫기');
        close.addEventListener('click', () => ctx.m.close());
        foot.append(close);
      }
      G.ui.hydrateIcons(foot);
    },

    // ------------------------------------------------------------ quiz
    openQuiz(quizId, opts = {}) {
      let id = quizId;
      if (!QZ()[id]) id = this.pickQuiz(EDU()[quizId] ? quizId : null) || (EDU()[quizId] ? quizIdsOf(quizId)[0] : null) || Object.keys(QZ())[0];
      const q = QZ()[id];
      if (!q) { G.ui.toast('퀴즈를 찾을 수 없어요.', { type: 'warn' }); return null; }
      const e = EDU()[q.edu];
      if (kidOn() && kidQuizOf(q)) return this._openKidQuiz(id, q, e);
      const head = h('div', { class: 'edu-head-extra' });
      if (e) head.innerHTML = catChip(e);
      const ctx = { quizId: id, q, e, phase: 'ask', picked: -1, reward: null };
      const m = G.ui.modal.open({
        id: 'edu-quiz', size: 'lg', className: 'quiz-modal', title: e ? `${e.title} 퀴즈` : '전통발효 퀴즈', icon: '✏️', headExtra: head,
        onClose: () => { if (this._quiz === ctx) this._quiz = null; setTimeout(() => this._refreshOpen(), 0); },
      });
      ctx.m = m;
      this._quiz = ctx;
      this._renderQuiz(ctx);
      return m;
    },
    _renderQuiz(ctx) {
      const { q, e, quizId } = ctx;
      const qids = e ? quizIdsOf(q.edu) : [quizId];
      const idx = qids.indexOf(quizId);
      const solvedBefore = this.isQuizSolved(quizId) && !(ctx.phase === 'right' && ctx.reward);
      const L4 = ['A', 'B', 'C', 'D'];
      const body = ctx.m.body;
      body.innerHTML = '';
      const meta = h('div', { class: 'quiz-meta' });
      meta.innerHTML = `<span>${qids.length > 1 ? `문제 ${idx + 1} / ${qids.length}` : '문제'}</span><span class="quiz-dots">${qids.map((x) => `<i class="${x === quizId ? 'cur' : ''} ${this.isQuizSolved(x) ? 'ok' : ''}"></i>`).join('')}</span>${solvedBefore ? '<span class="chip chip-green">✓ 이미 맞힌 문제 · 보상은 처음 한 번만</span>' : '<span class="chip chip-gold">첫 정답 보상 EXP +100 · 교육 +10</span>'}`;
      const card = h('div', { class: 'quiz-q' }, h('span', { class: 'q-badge' }, 'Q'), h('h3', null, q.question));
      const grid = h('div', { class: `quiz-choices ${ctx.animated ? 'no-anim' : ''}`, role: 'group', 'aria-label': '보기' });
      ctx.animated = true;
      q.choices.forEach((txt, i) => {
        let cls = 'quiz-choice';
        if (ctx.phase === 'right') cls += i === q.answer ? ' correct' : ' dim';
        else if (ctx.phase === 'wrong') cls += i === ctx.picked ? ' wrong' : ' dim';
        const b = h('button', { type: 'button', class: cls, disabled: ctx.phase !== 'ask', style: `--i:${i}` }, h('span', { class: 'q-letter' }, L4[i]), h('span', { class: 'q-text' }, txt), h('kbd', { class: 'q-key' }, String(i + 1)));
        b.addEventListener('click', () => this._pick(ctx, i));
        grid.appendChild(b);
      });
      body.append(meta, card, grid);
      if (ctx.phase !== 'ask') {
        const ok = ctx.phase === 'right';
        const res = h('div', { class: `quiz-result ${ok ? 'ok' : 'bad'}`, role: 'status' });
        res.innerHTML = `<div class="qr-ico emoji">${ok ? '🎉' : '🤔'}</div><div class="qr-body"><h4>${ok ? '정답이에요!' : '아쉬워요! 다시 생각해 볼까요?'}</h4><p>${esc(q.explain || '')}</p>${ok && ctx.reward ? `<div class="quiz-reward"><span class="chip chip-gold">✨ EXP +${U.fmt(ctx.reward.exp || 0)}</span><span class="chip chip-blue">📘 교육 +${U.fmt(ctx.reward.edu || 0)}</span></div>` : ''}${ok && !ctx.reward ? '<p class="small muted">이미 보상을 받은 퀴즈라 이번에는 보상이 없어요.</p>' : ''}</div>`;
        body.appendChild(res);
      }
      // footer
      const foot = ctx.m.foot;
      foot.innerHTML = '';
      foot.classList.add('quiz-foot');
      const btn = (label, cls, fn) => { const b = h('button', { type: 'button', class: `btn ${cls || ''}` }, label); b.addEventListener('click', fn); foot.appendChild(b); return b; };
      if (ctx.phase === 'ask') {
        if (e) btn('📖 교육 보기', 'btn-ghost', () => this._toContent(ctx));
        btn('닫기', '', () => ctx.m.close());
      } else if (ctx.phase === 'wrong') {
        if (e) btn('📖 교육 다시 보기', 'btn-ghost', () => this._toContent(ctx));
        btn('다시 풀기', 'btn-primary', () => { ctx.phase = 'ask'; ctx.picked = -1; this._renderQuiz(ctx); }).focus({ preventScroll: true });
      } else {
        const next = this.pickQuiz(q.edu, quizId);
        const nextOpen = next && !this.isQuizSolved(next) ? next : this.pickQuiz(null, quizId);
        if (nextOpen) btn('다음 퀴즈 ›', 'btn-primary', () => { ctx.m.close(); this.openQuiz(nextOpen); });
        btn('확인', nextOpen ? '' : 'btn-primary', () => ctx.m.close());
      }
    },
    _toContent(ctx) {
      const eduId = ctx.q.edu;
      ctx.m.close();
      if (!this._edu || this._edu.eduId !== eduId || this._edu.m.closed) this.open(eduId);
    },
    _pick(ctx, i) {
      if (!ctx || ctx.m.closed || ctx.phase !== 'ask') return;
      const r = this.answer(ctx.quizId, i);
      if (!r) return;
      ctx.picked = i;
      ctx.phase = r.correct ? 'right' : 'wrong';
      ctx.reward = r.rewarded ? r.reward : null;
      this._renderQuiz(ctx);
      if (r.correct) confetti(ctx.m.el);
    },
    /** answer a quiz: returns {correct, rewarded, reward, attempts} (null for unknown quiz / no state) */
    answer(quizId, index, opts = {}) {
      const q = QZ()[quizId];
      const S = est();
      if (!q || !S) return null;
      const correct = Number(index) === q.answer;
      let rec = S.quiz[quizId];
      if (!rec || typeof rec !== 'object') rec = S.quiz[quizId] = { correct: solvedVal(rec), attempts: 0 };
      rec.attempts = (rec.attempts || 0) + 1;
      rec.lastAt = G.time.now();
      const first = correct && !rec.correct;
      if (first) { rec.correct = true; rec.at = G.time.now(); rec.firstTry = rec.attempts === 1; }
      G.dirty('quiz');
      G.bus.emit('quiz:answered', { quizId, correct, first });
      if (correct || rec.attempts === 1) G.activity('quiz', `퀴즈 ${correct ? '정답' : '도전'}: ${q.question}`, { quizId, eduId: q.edu, correct });
      // opts.quiet: the caller shows its own feedback (쉬운 모드 quiz screen) — state, events and rewards are identical
      const quiet = !!opts.quiet;
      if (!quiet) G.sfx(correct ? 'correct' : 'wrong');
      const reward = q.reward || { exp: 100, edu: 10 };
      if (first) {
        grantReward(reward, `quiz:${quizId}`);
        if (!quiet) G.ui.toast(kidOn() ? '정답! 선물을 받았어요 🎁' : `정답! EXP +${U.fmt(reward.exp || 0)} · 교육 포인트 +${U.fmt(reward.edu || 0)}`, { type: 'reward', emoji: '🎉', sound: false });
      } else if (correct && !quiet) {
        G.ui.toast(kidOn() ? '정답이에요! 또 맞혔어요 👍' : '정답이에요! (보상은 처음 맞혔을 때 한 번만 받아요)', { type: 'success', emoji: '✅', sound: false });
      }
      return { correct, rewarded: first, reward: first ? reward : null, attempts: rec.attempts };
    },

    // ------------------------------------------------------------ library
    openLibrary(opts = {}) {
      if (kidOn()) return this._openKidLibrary();
      const ctx = { tab: opts.tab || 'all' };
      const m = G.ui.modal.open({
        id: 'edu-library', size: 'xl', className: 'edu-lib', title: '배움터 · 교육 콘텐츠', icon: '📚',
        actions: [{ label: '닫기', class: 'btn-primary' }],
        onClose: () => { if (this._lib === ctx) this._lib = null; },
      });
      ctx.m = m;
      this._lib = ctx;
      m.body.addEventListener('click', (ev) => {
        const qb = ev.target.closest('[data-lib-quiz]');
        if (qb) { ev.stopPropagation(); this.openQuiz(qb.dataset.libQuiz); return; }
        const tab = ev.target.closest('[data-lib-tab]');
        if (tab) { ctx.tab = tab.dataset.libTab; this._renderLibrary(ctx); return; }
        const card = ev.target.closest('[data-lib-open]');
        if (card) this.open(card.dataset.libOpen);
      });
      m.body.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const card = ev.target.closest('[data-lib-open]');
        if (card && ev.target === card) { ev.preventDefault(); this.open(card.dataset.libOpen); }
      });
      this._renderLibrary(ctx);
      return m;
    },
    _renderLibrary(ctx) {
      if (!ctx?.m || ctx.m.closed) return;
      if (ctx.kid) { this._renderKidLibrary(ctx); return; }
      const st = this.stats();
      const ids = eduIds();
      const cats = [];
      for (const id of ids) { const c = EDU()[id].cat; if (c && !cats.includes(c)) cats.push(c); }
      if (ctx.tab !== 'all' && !cats.includes(ctx.tab)) ctx.tab = 'all';
      const list = ids.filter((id) => ctx.tab === 'all' || EDU()[id].cat === ctx.tab);
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
      const cards = list.map((id) => {
        const e = EDU()[id];
        const c = catOf(e);
        const n = e.pages.length;
        const seen = new Set(this.viewedPages(id).filter((p) => p >= 0 && p < n)).size;
        const done = this.isCompleted(id);
        const qids = quizIdsOf(id);
        const solved = qids.filter((q) => this.isQuizSolved(q)).length;
        const status = done ? '<span class="chip chip-green">학습 완료</span>' : seen ? `<span class="chip chip-blue">학습 중 ${seen}/${n}</span>` : '<span class="chip chip-gold">NEW</span>';
        const qz = qids.length ? `<button type="button" class="chip chip-btn lc-quiz ${solved === qids.length ? 'all' : ''}" data-lib-quiz="${esc(this.pickQuiz(id) || qids[0])}" title="퀴즈 풀기">✏️ 퀴즈 ${solved}/${qids.length}</button>` : '';
        return `<div class="lib-card ${done ? 'done' : ''}" style="--c:${esc(c.color)}" role="button" tabindex="0" data-lib-open="${esc(id)}" aria-label="${esc(e.title)} 열기">
          <div class="lc-top"><span class="lc-ico emoji">${esc(e.icon || '📖')}</span><div class="lc-head"><span class="lc-cat">${esc(c.name)}</span><span class="lc-title">${esc(e.title)}</span></div></div>
          <p class="lc-sum">${esc(e.summary || '')}</p>
          <div class="bar lc-bar"><i style="width:${done ? 100 : pct(seen, n)}%"></i></div>
          <div class="lc-foot">${status}<span class="chip">${n}쪽</span>${qz}</div>
        </div>`;
      }).join('');
      const tabs = [['all', '전체', '📚']].concat(cats.map((c) => [c, CATS()[c]?.name || c, CATS()[c]?.icon || '📖']));
      ctx.m.body.innerHTML = `
        <div class="lib-stats">
          <div class="lib-stat lib-stat-main"><span>학습 완료</span><b>${st.completed} <small>/ ${st.contents}</small></b><div class="bar bar-gold"><i style="width:${pct(st.completed, st.contents)}%"></i></div></div>
          <div class="lib-stat"><span>퀴즈 정답</span><b>${st.solved} <small>/ ${st.quizzes}</small></b><div class="bar"><i style="width:${pct(st.solved, st.quizzes)}%"></i></div></div>
          <div class="lib-stat"><span>교육 포인트</span><b>📘 ${U.fmt(st.edu)}</b><small class="muted">콘텐츠 완료 +${COMPLETE_EDU_POINTS} · 퀴즈 첫 정답 +10</small></div>
        </div>
        <div class="tabs lib-tabs">${tabs.map(([id, label, ic]) => `<button type="button" class="tab ${ctx.tab === id ? 'active' : ''}" data-lib-tab="${esc(id)}"><span class="emoji">${ic}</span> ${esc(label)}</button>`).join('')}</div>
        <div class="lib-grid">${cards || '<div class="empty">콘텐츠가 없어요.</div>'}</div>
        <p class="lib-note"><span class="ico ico-xs" data-icon="info"></span> 교육 내용은 일반 상식을 쉽게 풀어 쓴 요약이며 전문가 감수 전이에요. ${esc(G.data.meta?.disclaimer || '')}</p>`;
      G.ui.hydrateIcons(ctx.m.body);
    },
    _refreshOpen() {
      if (this._lib && !this._lib.m.closed) this._renderLibrary(this._lib);
      if (this._hall && !this._hall.m.closed) this._renderHall(this._hall);
    },

    // ------------------------------------------------------------ signs / info
    readSign(signId) {
      const s = (L().signs || []).find((x) => x.id === signId);
      if (!s) return false;
      if (s.action === 'edu' && s.edu && EDU()[s.edu]) return !!this.open(s.edu);
      if (s.action === 'map') {
        if (G.sys.minimap?.openWorldMap) { G.sys.minimap.openWorldMap(); return true; }
        return !!this.openMapFallback(s.title);
      }
      return !!this.openInfo(s.title, s.text || '', { sign: s });
    },
    /** wooden-board style info modal. opts: {sign, links:[{label, edu|fn}]} */
    openInfo(title, text, opts = {}) {
      if (kidOn()) return this._kidInfo(title, text, opts);
      const s = opts.sign || null;
      const zone = s && G.world?.zoneAt ? G.world.zoneAt(s.x, s.z) : null;
      const actions = [];
      const link = s ? SIGN_LINKS[s.id] : null;
      if (link === '@library') actions.push({ label: '배움터 열기', class: 'btn-soft', icon: 'book', onClick: () => { setTimeout(() => this.openLibrary(), 0); } });
      else if (link === '@hall') {
        actions.push({ label: '체험관 안내', class: 'btn-soft', icon: 'home', onClick: () => { setTimeout(() => this.openHallGuide(), 0); } });
        actions.push({ label: '배움터 열기', class: 'btn-soft', icon: 'book', onClick: () => { setTimeout(() => this.openLibrary(), 0); } });
      } else if (link && EDU()[link]) actions.push({ label: `관련 교육: ${EDU()[link].title}`, class: 'btn-soft', icon: 'book', onClick: () => { setTimeout(() => this.open(link), 0); } });
      for (const l of opts.links || []) actions.push({ label: l.label, class: 'btn-soft', onClick: () => { setTimeout(() => (l.edu ? this.open(l.edu) : l.fn?.()), 0); } });
      actions.push({ label: '확인', class: 'btn-primary' });
      return G.ui.modal.open({
        id: 'edu-sign', size: 'md', className: 'sign-modal', title: '안내판', icon: '🪧',
        body: `<div class="sign-board"><div class="sb-nail l"></div><div class="sb-nail r"></div><h3>${esc(title || '안내')}</h3><p>${esc(text || '')}</p></div>
          ${zone && zone.id !== G.data.defaultZone?.id ? `<div class="sign-zone"><span class="ico ico-sm" data-icon="pin"></span><b>${esc(zone.name)}</b><span class="muted">${esc(zone.desc || '')}</span></div>` : ''}`,
        actions,
      });
    },
    /** world-map fallback when the minimap module is missing: zone directory */
    openMapFallback(title) {
      const zones = (G.data.zones || []);
      const cur = G.sys.minimap?.currentZone?.id || G.state?.player?.zoneId;
      return G.ui.modal.open({
        id: 'edu-map', size: 'lg', className: 'sign-modal map-fallback', title: title || '안내도', icon: '🗺️',
        body: `<p class="dim">전통발효체험관의 구역을 소개해요.</p><div class="map-zones">${zones.map((z, i) => `<div class="mz ${z.id === cur ? 'here' : ''}" style="--c:${esc(z.color || '#34c36b')}"><span class="mz-num">${i + 1}</span><div><b>${esc(z.name)}</b>${z.id === cur ? ' <span class="chip chip-green">현재 위치</span>' : ''}<p>${esc(z.desc || '')}</p></div></div>`).join('')}</div>`,
        actions: [{ label: '확인', class: 'btn-primary' }],
      });
    },

    // ------------------------------------------------------------ exhibits (fermented food cards)
    openExhibit(exhId) {
      const x = (L().exhibits || []).find((o) => o.id === exhId);
      if (!x) return null;
      const info = G.data.exhibitInfo?.[exhId] || {};
      const item = G.data.items?.[x.food] || null;
      const e = EDU()[x.edu] || null;
      const st = { viewer: null };
      const desc = info.text || (item?.desc || '').replace(/\s*\(게임 체험 결과물\)\s*$/, '');
      if (kidOn()) return this._kidExhibit(x, info, item, e, st, desc);
      const facts = (info.facts || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      const box = visualBox('exh-visual');
      const right = h('div', { class: 'exh-info' });
      right.innerHTML = `<div class="exh-head"><span class="exh-ico emoji">${esc(item?.icon || '🍲')}</span><div><div class="exh-tag">${esc(info.tagline || '발효식품 전시')}</div><div class="exh-name">${esc(x.title || item?.name || '전시')}</div></div></div>
        <p class="exh-text">${esc(desc)}</p>
        ${facts ? `<dl class="exh-facts">${facts}</dl>` : ''}
        ${e ? `<div class="exh-edu">${catChip(e)}<span>관련 교육 「${esc(e.title)}」${this.isCompleted(x.edu) ? ' <b class="green">✓ 학습 완료</b>' : ''}</span></div>` : ''}
        <p class="exh-note">${esc(G.data.meta?.disclaimer || '')}</p>`;
      const m = G.ui.modal.open({
        id: 'edu-exhibit', size: 'lg', className: 'exhibit-modal', title: `${x.title || item?.name || ''} 전시`, icon: item?.icon || '🍲',
        body: (b) => { b.appendChild(h('div', { class: 'exh-layout' }, box, right)); },
        actions: [
          { label: '닫기', class: 'btn-ghost' },
          ...(e ? [{ label: '자세히 알아보기', class: 'btn-primary', icon: 'book', onClick: () => { setTimeout(() => this.open(x.edu), 0); } }] : []),
        ],
        onClose: () => { st.viewer?.dispose(); st.viewer = null; },
      });
      renderVisual(box, info.model ? { type: 'model', model: info.model } : { type: 'emoji', emoji: item?.icon || '🍲' }, st, item?.icon);
      G.activity('exhibit', `「${x.title || item?.name}」 전시 관람`, { exhibitId: exhId, eduId: x.edu });
      return m;
    },

    // ------------------------------------------------------------ traditional tools (layout.tools: quest Q_CULTURE + 도감)
    openTool(toolId) {
      const t = (L().tools || []).find((o) => o.id === toolId);
      if (!t) return null;
      const info = G.data.toolInfo?.[toolId] || {};
      const col = G.data.collection?.[`COL_${toolId}`] || null;
      const x = { id: t.id, title: t.name, edu: 'EDU_TOOLS' };
      const item = { name: t.name, icon: info.icon || col?.icon || '🛠️' };
      const e = EDU()[x.edu] || null;
      const st = { viewer: null };
      const desc = info.text || col?.desc || '';
      if (kidOn()) return this._kidExhibit(x, info, item, e, st, desc);
      const facts = (info.facts || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      const box = visualBox('exh-visual');
      const right = h('div', { class: 'exh-info' });
      right.innerHTML = `<div class="exh-head"><span class="exh-ico emoji">${esc(item.icon)}</span><div><div class="exh-tag">${esc(info.tagline || '전통 생활 도구')}</div><div class="exh-name">${esc(t.name)}</div></div></div>
        <p class="exh-text">${esc(desc)}</p>
        ${facts ? `<dl class="exh-facts">${facts}</dl>` : ''}
        ${e ? `<div class="exh-edu">${catChip(e)}<span>관련 교육 「${esc(e.title)}」${this.isCompleted(x.edu) ? ' <b class="green">✓ 학습 완료</b>' : ''}</span></div>` : ''}`;
      const m = G.ui.modal.open({
        id: 'edu-exhibit', size: 'lg', className: 'exhibit-modal tool-modal', title: `${t.name} · 전통도구`, icon: item.icon,
        body: (b) => { b.appendChild(h('div', { class: 'exh-layout' }, box, right)); },
        actions: [
          { label: '닫기', class: 'btn-ghost' },
          ...(e ? [{ label: '자세히 알아보기', class: 'btn-primary', icon: 'book', onClick: () => { setTimeout(() => this.open(x.edu), 0); } }] : []),
        ],
        onClose: () => { st.viewer?.dispose(); st.viewer = null; },
      });
      renderVisual(box, info.model ? { type: 'model', model: info.model } : { type: 'emoji', emoji: item.icon }, st, item.icon);
      G.activity('exhibit', `「${t.name}」 전통도구 관람`, { exhibitId: t.id, eduId: x.edu });
      return m;
    },

    // ------------------------------------------------------------ hall guide
    openHallGuide() {
      const H = G.data.hallGuide;
      if (!H) return null;
      const kid = kidOn();
      const ctx = { sel: H.floors.length - 1, kid };
      const m = G.ui.modal.open({
        id: 'edu-hall', size: kid ? 'md' : 'xl', className: kid ? 'hall-modal hall-kid' : 'hall-modal', title: H.title || '체험관 안내', icon: '🏛️',
        say: kid ? H.kidIntro || H.title : undefined,
        actions: kid
          ? [{ label: '📚 배움터', class: 'btn-soft', onClick: () => { setTimeout(() => this.openLibrary(), 0); } }, { label: '👍 알았어요', class: 'btn-primary' }]
          : [{ label: '배움터 열기', class: 'btn-soft', icon: 'book', onClick: () => { setTimeout(() => this.openLibrary(), 0); } }, { label: '확인', class: 'btn-primary' }],
        onClose: () => { if (this._hall === ctx) this._hall = null; },
      });
      ctx.m = m;
      this._hall = ctx;
      m.body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-edu-open]');
        if (b) { this.open(b.dataset.eduOpen); return; }
        const f = ev.target.closest('[data-i]');
        if (f) {
          ctx.sel = +f.dataset.i; this._selectFloor(ctx, true);
          const fl = (H.floors || [])[ctx.sel];
          if (ctx.kid && fl) kidSay(`${fl.name}. ${fl.kid || fl.desc}`, { priority: 1 });
        }
      });
      m.body.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const f = ev.target.closest('.hall-fl[data-i], .hk-floor[data-i]');
        if (f && ev.target === f) { ev.preventDefault(); ctx.sel = +f.dataset.i; this._selectFloor(ctx, true); }
      });
      this._renderHall(ctx);
      return m;
    },
    _renderHall(ctx) {
      const H = G.data.hallGuide;
      if (!H || !ctx?.m || ctx.m.closed) return;
      if (ctx.kid) { this._renderKidHall(ctx, H); return; }
      const floors = H.floors || [];
      const cards = floors.map((f, i) => `<article class="hall-floor" data-i="${i}" style="--c:${esc(f.color || '#f4c54a')}">
          <div class="hf-badge">${esc(f.floor)}</div>
          <div class="hf-body"><h4><span class="emoji">${esc(f.icon || '')}</span> ${esc(f.name)}</h4><p>${esc(f.desc)}</p>
          <div class="hall-edu-btns">${(f.edu || []).filter((id) => EDU()[id]).map((id) => `<button type="button" class="btn btn-sm ${this.isCompleted(id) ? 'done' : ''}" data-edu-open="${esc(id)}"><span class="emoji">${esc(EDU()[id].icon || '📖')}</span>${esc(EDU()[id].title)}${this.isCompleted(id) ? ' <b class="green">✓</b>' : ''}</button>`).join('')}</div></div>
        </article>`).join('');
      ctx.m.body.innerHTML = `<p class="hall-intro">${esc(H.intro || '')}</p>
        <div class="hall-layout"><div class="hall-pic">${hallSvg(floors)}<p class="tiny muted center">층을 눌러 전시를 확인하세요</p></div><div class="hall-floors">${cards}</div></div>
        ${H.note ? `<p class="hall-note"><span class="ico ico-xs" data-icon="info"></span> ${esc(H.note)}</p>` : ''}`;
      G.ui.hydrateIcons(ctx.m.body);
      this._selectFloor(ctx, false);
    },
    _selectFloor(ctx, scroll) {
      const body = ctx.m.body;
      body.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('on', +el.dataset.i === ctx.sel));
      if (scroll) body.querySelector(`.hall-floor[data-i="${ctx.sel}"]`)?.scrollIntoView({ block: 'nearest', behavior: G.settings?.reduceMotion ? 'auto' : 'smooth' });
    },

    // ============================================================ 쉬운 모드 (CONTRACT §12)
    // ------------------------------------------------------------ 3 big picture slides, read aloud
    _openKid(eduId, opts = {}) {
      const e = EDU()[eduId];
      const K = kidOf(e);
      const n = K.slides.length;
      const done = this.isCompleted(eduId);
      const ctx = { eduId, e, K, kid: true, page: -1, n, maxSeen: done ? n - 1 : -1, vis: { viewer: null }, justCompleted: false };
      const start = opts.page != null && Number.isFinite(+opts.page) ? clamp(Math.floor(+opts.page), 0, n - 1) : 0;
      const m = G.ui.modal.open({
        id: 'edu-content', size: 'md', className: 'edu-modal edu-kid', title: K.title || e.title, icon: e.icon || '📖',
        say: K.title || e.title,
        onClose: () => {
          ctx.vis.viewer?.dispose(); ctx.vis.viewer = null;
          if (this._edu === ctx) this._edu = null;
          setTimeout(() => this._refreshOpen(), 0);
        },
      });
      ctx.m = m;
      ctx.box = visualBox('ek-visual');
      const hint = ctx.box.querySelector('.edu-vis-hint');
      if (hint) { hint.textContent = ''; hint.append(h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖐️'), ' 돌려 봐요!'); }
      ctx.dots = h('div', { class: 'ek-dots', 'aria-hidden': 'true' });
      ctx.sayT = h('span', { class: 'ek-text-t' });
      ctx.say = h('p', { class: 'ek-text', 'aria-live': 'polite' }, ctx.sayT);
      ctx.done = h('div', { class: 'ek-done', hidden: true });
      ctx.btns = h('div', { class: 'ek-btns' });
      m.body.classList.add('ek-body');
      m.body.append(ctx.box, ctx.dots, ctx.say, ctx.done, ctx.btns);
      kidSpeakable(ctx.say, () => ctx.sayT.textContent);
      m.setActions([]);
      this._edu = ctx;
      this._logView(eduId, e);
      this._go(ctx, start);
      return m;
    },
    _kidGo(ctx, page) {
      const n = ctx.n;
      page = clamp(Math.floor(Number(page) || 0), 0, n - 1);
      if (page === ctx.page) return;
      const dir = page > ctx.page ? 1 : -1;
      const first = ctx.page === -1;
      ctx.page = page;
      ctx.maxSeen = Math.max(ctx.maxSeen, page);
      const slide = ctx.K.slides[page];
      // the slide stands for one of the grown-up pages: record that page as seen (same state shape as normal mode)
      const src = Number.isInteger(slide?.vis) && slide.vis >= 0 && slide.vis < ctx.e.pages.length ? slide.vis : Math.min(page, ctx.e.pages.length - 1);
      const S = est();
      if (S) {
        const v = S.viewed[ctx.eduId] && typeof S.viewed[ctx.eduId] === 'object' ? S.viewed[ctx.eduId] : (S.viewed[ctx.eduId] = { at: G.time.now(), pages: [] });
        if (!Array.isArray(v.pages)) v.pages = [];
        if (!v.pages.includes(src)) v.pages.push(src);
        v.last = src; v.lastAt = G.time.now();
        G.dirty('edu');
      }
      G.bus.emit('edu:viewed', { eduId: ctx.eduId, page: src });
      if (!first) G.sfx('page');
      if (page === n - 1 && !this.isCompleted(ctx.eduId)) ctx.justCompleted = this._complete(ctx.eduId);
      this._renderKidSlide(ctx, dir, first);
    },
    /** picture for a kid slide: a grown-up page's visual (3D model / illustration), a picture row or one big emoji */
    _kidVisual(e, slide) {
      if (Number.isInteger(slide?.vis) && e.pages[slide.vis]?.visual) return Object.assign({}, e.pages[slide.vis].visual, { caption: '' });
      if (Array.isArray(slide?.steps) && slide.steps.length) return { type: 'steps', items: slide.steps.map(([icon, label]) => ({ icon, label })) };
      return { type: 'emoji', emoji: slide?.emoji || e.icon || '📖' };
    },
    _renderKidSlide(ctx, dir, first) {
      const { e, K, page, n } = ctx;
      const slide = K.slides[page] || {};
      const last = page === n - 1;
      renderVisual(ctx.box, this._kidVisual(e, slide), ctx.vis, e.icon);
      ctx.box.classList.remove('edu-swap'); void ctx.box.offsetWidth; ctx.box.classList.add('edu-swap');
      ctx.dots.textContent = '';
      for (let i = 0; i < n; i++) ctx.dots.appendChild(h('i', { class: i === page ? 'on' : i < page || i <= ctx.maxSeen ? 'seen' : '' }));
      ctx.sayT.textContent = String(slide.text || '');
      ctx.say.classList.remove('ek-in', 'ek-back'); void ctx.say.offsetWidth; ctx.say.classList.add(dir < 0 ? 'ek-back' : 'ek-in');
      // last slide: "다 배웠어요" ribbon
      ctx.done.hidden = !last;
      if (last) {
        ctx.done.textContent = '';
        ctx.done.append(h('span', { class: 'emoji', 'aria-hidden': 'true' }, ctx.justCompleted ? '🎉' : '✅'), h('b', null, ctx.justCompleted ? '다 배웠어요!' : '다 배운 이야기예요'));
      }
      // big buttons
      ctx.btns.textContent = '';
      const big = (cls, emoji, label, fn) => {
        const b = h('button', { type: 'button', class: `easy-big-btn ${cls}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', null, label));
        b.addEventListener('click', fn);
        ctx.btns.appendChild(b);
        return b;
      };
      if (page > 0) big('ek-prev', '⬅️', '앞으로', () => this._go(ctx, ctx.page - 1));
      if (!last) big('easy-btn-yes', '👉', '다음', () => this._go(ctx, ctx.page + 1));
      else {
        const qid = this.pickQuiz(ctx.eduId);
        if (qid) big('easy-btn-yes ek-quiz', '✏️', '퀴즈 놀이', () => { ctx.m.close(); this.openQuiz(qid); });
        big('ek-more', '📚', '다른 이야기', () => { ctx.m.close(); this.openLibrary(); });
      }
      // read the slide aloud (the first one waits for the title the window reads)
      kidSay(String(slide.text || ''), { interrupt: !first, priority: 1 });
    },

    // ------------------------------------------------------------ kid quiz: 2–3 big pictures or ⭕ / ❌
    _openKidQuiz(id, q, e) {
      const K = kidQuizOf(q);
      const ctx = { quizId: id, q, e, K, kid: true, phase: 'ask', wrong: new Set(), picked: -1, reward: null, order: kidOrder(K) };
      const m = G.ui.modal.open({
        id: 'edu-quiz', size: 'md', className: 'quiz-modal quiz-kid', title: '퀴즈 놀이', icon: '✏️', say: K.q,
        onClose: () => { if (this._quiz === ctx) this._quiz = null; setTimeout(() => this._refreshOpen(), 0); },
      });
      ctx.m = m;
      m.body.classList.add('kq-body');
      m.setActions([]);
      this._quiz = ctx;
      this._renderKidQuiz(ctx);
      return m;
    },
    _renderKidQuiz(ctx) {
      const { K, m } = ctx;
      const body = m.body;
      body.textContent = '';
      const right = ctx.phase === 'right';
      const mood = right ? 'cheer' : ctx.phase === 'wrong' ? 'think' : 'happy';
      const svg = mascotSvg(mood, 84);
      const face = svg ? h('span', { class: 'kq-face', 'aria-hidden': 'true', html: svg }) : h('span', { class: 'kq-face emoji', 'aria-hidden': 'true' }, right ? '🥳' : '🤔');
      const qT = h('span', { class: 'kq-q-t' }, K.q);
      const qEl = h('p', { class: 'kq-q' }, qT);
      body.appendChild(h('div', { class: 'kq-head' }, face, h('div', { class: 'kq-bubble' }, qEl)));
      kidSpeakable(qEl, () => qT.textContent);
      const list = kidChoicesOf(K, ctx.order);
      const grid = h('div', { class: `kq-choices n${list.length}${K.ox ? ' ox' : ''}`, role: 'group', 'aria-label': '골라요' });
      list.forEach((c, i) => {
        let cls = 'easy-tile kq-choice';
        if (right) cls += c.ok ? ' is-right' : ' is-dim';
        else if (ctx.wrong.has(i)) cls += ' is-wrong';
        const b = h('button', { type: 'button', class: cls, dataset: { i: String(i) }, 'aria-disabled': right || ctx.wrong.has(i) ? 'true' : null },
          h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, c.e),
          h('span', { class: 'et-label' }, c.t),
          right && c.ok ? h('span', { class: 'et-badge' }, '⭕') : ctx.wrong.has(i) ? h('span', { class: 'et-badge' }, '❌') : null);
        b.style.setProperty('--tile', c.c);
        b.style.setProperty('--i', String(i));
        b.__easySpeak = { btn: null, text: c.t };
        b.addEventListener('click', () => this._kidPick(ctx, i, b));
        grid.appendChild(b);
      });
      body.appendChild(grid);
      if (ctx.phase === 'wrong') {
        body.appendChild(h('div', { class: 'kq-msg hint', role: 'status' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💡'), h('span', null, `괜찮아요! 힌트: ${K.hint || '다시 한번 생각해 봐요.'}`)));
      } else if (right) {
        const msg = h('div', { class: 'kq-msg ok', role: 'status' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎉'), h('span', null, `정답이에요! ${K.why || ''}`));
        body.appendChild(msg);
        body.appendChild(ctx.reward
          ? h('div', { class: 'kq-gift' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎁'), h('b', null, '선물을 받았어요!'), h('span', { class: 'chip chip-gold' }, `✨ +${U.fmt(ctx.reward.exp || 0)}`), h('span', { class: 'chip chip-blue' }, `📘 +${U.fmt(ctx.reward.edu || 0)}`))
          : h('div', { class: 'kq-gift again' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👍'), h('b', null, '또 맞혔어요! 똑똑해요!')));
      }
      // buttons
      const btns = h('div', { class: 'ek-btns' });
      const big = (cls, emoji, label, fn) => {
        const b = h('button', { type: 'button', class: `easy-big-btn ${cls}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', null, label));
        b.addEventListener('click', fn);
        btns.appendChild(b);
        return b;
      };
      if (right) {
        const next = this.pickQuiz(ctx.q.edu, ctx.quizId);
        const nextOpen = next && !this.isQuizSolved(next) ? next : this.pickQuiz(null, ctx.quizId);
        if (nextOpen) big('easy-btn-yes', '👉', '다음 퀴즈', () => { ctx.m.close(); this.openQuiz(nextOpen); });
        big(nextOpen ? 'ek-more' : 'easy-btn-yes', '👍', '좋아요', () => ctx.m.close());
      } else if (ctx.e && kidOf(ctx.e)) {
        big('ek-more', '📖', '이야기 보기', () => this._toContent(ctx));
      }
      if (btns.childNodes.length) body.appendChild(btns);
    },
    _kidPick(ctx, i, btn) {
      if (!ctx || ctx.m.closed || ctx.phase === 'right') return;
      const list = kidChoicesOf(ctx.K, ctx.order);
      const c = list[i];
      if (!c) return;
      if (ctx.wrong.has(i)) { kidSay('그건 아니었어요. 다른 그림을 골라 봐요!', { priority: 1 }); return; }
      if (c.ok) {
        const r = this.answer(ctx.quizId, ctx.q.answer, { quiet: true });
        if (!r) return;
        ctx.phase = 'right'; ctx.picked = i; ctx.reward = r.rewarded ? r.reward : null;
        this._renderKidQuiz(ctx);
        confetti(ctx.m.el);
        const why = String(ctx.K.why || '');
        if (G.easy?.celebrate) G.easy.celebrate('정답이에요!', { emoji: '🎉', say: `정답이에요! ${why}`, sound: 'correct', duration: 1500 });
        else G.sfx('correct');
        return;
      }
      // a wrong picture is a recorded try (same state as a wrong answer in the grown-up quiz), then a gentle hint
      const n = Array.isArray(ctx.q.choices) && ctx.q.choices.length > 1 ? ctx.q.choices.length : 2;
      this.answer(ctx.quizId, (ctx.q.answer + 1) % n, { quiet: true });
      ctx.wrong.add(i);
      ctx.phase = 'wrong';
      this._renderKidQuiz(ctx);
      G.sfx('notify');
      const tile = ctx.m.body.querySelector(`.kq-choice[data-i="${i}"]`) || btn;
      if (tile) { tile.classList.remove('kq-shake'); void tile.offsetWidth; tile.classList.add('kq-shake'); }
      kidSay(`괜찮아요! 힌트를 줄게요. ${ctx.K.hint || '다시 한번 생각해 봐요.'}`, { priority: 1 });
    },

    // ------------------------------------------------------------ kid library: picture tiles + quiz tile
    _openKidLibrary() {
      const ctx = { kid: true };
      const m = G.ui.modal.open({
        id: 'edu-library', size: 'lg', className: 'edu-lib edu-lib-kid', title: '배움터', icon: '📚', say: '무엇을 배워 볼까요? 그림을 골라요.',
        onClose: () => { if (this._lib === ctx) this._lib = null; },
      });
      ctx.m = m;
      this._lib = ctx;
      m.setActions([]);
      m.body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-kl]');
        if (!b || !m.body.contains(b)) return;
        const id = b.dataset.kl;
        if (id === '__quiz') {
          const q = this.pickQuiz(null) || Object.keys(QZ())[0];
          if (!this.pickQuiz(null)) kidSay('퀴즈를 모두 맞혔어요! 다시 풀어 볼까요?', { priority: 1 });
          if (q) this.openQuiz(q);
        } else if (EDU()[id]) this.open(id);
      });
      this._renderLibrary(ctx);
      return m;
    },
    _renderKidLibrary(ctx) {
      const body = ctx.m.body;
      const st = this.stats();
      body.textContent = '';
      body.appendChild(h('div', { class: 'kl-stats' },
        h('span', { class: 'kl-stat' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📖'), h('b', null, `${st.completed} / ${st.contents}`), h('span', null, '다 배웠어요')),
        h('span', { class: 'kl-stat' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⭐'), h('b', null, `${st.solved} / ${st.quizzes}`), h('span', null, '퀴즈 정답'))));
      const grid = h('div', { class: 'easy-pick kl-grid', role: 'list' });
      grid.style.setProperty('--cols', '4'); grid.style.setProperty('--cols-s', '3'); grid.style.setProperty('--cols-xs', '2');
      eduIds().forEach((id, i) => {
        const e = EDU()[id];
        const K = kidOf(e);
        const done = this.isCompleted(id);
        const qids = quizIdsOf(id);
        const solved = qids.filter((q) => this.isQuizSolved(q)).length;
        const stars = qids.length ? '⭐'.repeat(solved) + '☆'.repeat(Math.max(0, qids.length - solved)) : '';
        const b = h('button', { type: 'button', class: `easy-tile kl-tile${done ? ' is-done' : ''}`, role: 'listitem', dataset: { kl: id }, 'aria-label': `${kidTitle(e)}${done ? ', 다 배웠어요' : ''}` },
          h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, e.icon || '📖'),
          h('span', { class: 'et-label' }, kidTitle(e)),
          stars ? h('span', { class: 'et-sub kl-stars', 'aria-hidden': 'true' }, stars) : null,
          done ? h('span', { class: 'et-badge' }, '✅') : null);
        b.style.setProperty('--tile', catOf(e).color);
        b.style.setProperty('--i', String(i));
        b.__easySpeak = { btn: null, text: `${kidTitle(e)}. ${K?.summary || e.summary || ''}` };
        grid.appendChild(b);
      });
      const open = this.pickQuiz(null);
      const qb = h('button', { type: 'button', class: 'easy-tile kl-tile kl-quiz', role: 'listitem', dataset: { kl: '__quiz' }, 'aria-label': '퀴즈 놀이' },
        h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, '✏️'),
        h('span', { class: 'et-label' }, '퀴즈 놀이'),
        h('span', { class: 'et-sub' }, open ? `⭐ ${st.solved} / ${st.quizzes}` : '🏆 다 맞혔어요!'));
      qb.style.setProperty('--tile', '#ffc93c');
      qb.__easySpeak = { btn: null, text: '퀴즈 놀이. 그림을 골라 퀴즈를 맞혀요.' };
      grid.appendChild(qb);
      body.appendChild(grid);
    },

    // ------------------------------------------------------------ kid sign / exhibit / hall
    _kidInfo(title, text, opts = {}) {
      const s = opts.sign || null;
      const link = s ? SIGN_LINKS[s.id] : null;
      const actions = [];
      if (link === '@library') actions.push({ label: '📚 배움터', class: 'btn-soft', onClick: () => { setTimeout(() => this.openLibrary(), 0); } });
      else if (link === '@hall') actions.push({ label: '🏛️ 체험관 안내', class: 'btn-soft', onClick: () => { setTimeout(() => this.openHallGuide(), 0); } });
      else if (link && EDU()[link]) actions.push({ label: `${EDU()[link].icon || '📖'} 배워 볼까요?`, class: 'btn-soft', onClick: () => { setTimeout(() => this.open(link), 0); } });
      for (const l of opts.links || []) actions.push({ label: l.label, class: 'btn-soft', onClick: () => { setTimeout(() => (l.edu ? this.open(l.edu) : l.fn?.()), 0); } });
      actions.push({ label: '👍 알았어요', class: 'btn-primary' });
      // signboards carry grown-up 합니다체 text: children see (and hear) their own short words
      const ks = s ? G.data.kidSigns?.[s.id] : null;
      const t = String(ks?.title || title || '안내'), x = String(ks?.text || (s ? '안내판이에요. 같이 둘러봐요! 👀' : text) || '');
      return G.ui.modal.open({
        id: 'edu-sign', size: 'sm', className: 'sign-modal sign-kid', title: '안내판', icon: '🪧', say: `${t}. ${x}`,
        body: (b) => {
          const pT = h('span', null, x);
          const p = h('p', { class: 'sk-text' }, pT);
          b.appendChild(h('div', { class: 'sign-board' }, h('div', { class: 'sb-nail l' }), h('div', { class: 'sb-nail r' }), h('h3', null, t), p));
          kidSpeakable(p, () => `${t}. ${pT.textContent}`);
        },
        actions,
      });
    },
    _kidExhibit(x, info, item, e, st, desc) {
      const name = x.title || item?.name || '전시';
      const line = String(info.kid || desc || '');
      const box = visualBox('exh-visual');
      const hint = box.querySelector('.edu-vis-hint');
      if (hint) { hint.textContent = ''; hint.append(h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖐️'), ' 돌려 봐요!'); }
      const m = G.ui.modal.open({
        id: 'edu-exhibit', size: 'md', className: 'exhibit-modal exh-kid', title: name, icon: item?.icon || '🍲', say: `${name}. ${line}`,
        body: (b) => {
          const pT = h('span', null, line);
          const p = h('p', { class: 'xk-text' }, pT);
          b.append(box, h('div', { class: 'xk-name' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, item?.icon || '🍲'), h('b', null, name)), p);
          kidSpeakable(p, () => pT.textContent);
        },
        actions: [
          ...(e ? [{ label: '📖 더 알아보기', class: 'btn-soft', onClick: () => { setTimeout(() => this.open(x.edu), 0); } }] : []),
          { label: '👍 좋아요', class: 'btn-primary' },
        ],
        onClose: () => { st.viewer?.dispose(); st.viewer = null; },
      });
      renderVisual(box, info.model ? { type: 'model', model: info.model } : { type: 'emoji', emoji: item?.icon || '🍲' }, st, item?.icon);
      G.activity('exhibit', `「${name}」 전시 관람`, { exhibitId: x.id, eduId: x.edu });
      return m;
    },
    _renderKidHall(ctx, H) {
      const body = ctx.m.body;
      body.textContent = '';
      body.appendChild(h('p', { class: 'hk-intro' }, H.kidIntro || H.intro || ''));
      const list = h('div', { class: 'hk-floors' });
      (H.floors || []).forEach((f, i) => {
        const edus = (f.edu || []).filter((id) => EDU()[id]);
        list.appendChild(h('article', { class: 'hk-floor', dataset: { i: String(i) }, role: 'button', tabindex: '0', 'aria-label': `${f.floor} ${f.name}` },
          h('div', { class: 'hk-badge' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, f.icon || '🏛️'), h('b', null, f.floor)),
          h('div', { class: 'hk-body' },
            h('b', { class: 'hk-name' }, f.name),
            h('p', { class: 'hk-text' }, f.kid || f.desc || ''),
            h('div', { class: 'hk-edus' }, edus.map((id) => h('button', { type: 'button', class: `hk-edu${this.isCompleted(id) ? ' done' : ''}`, dataset: { eduOpen: id } },
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, EDU()[id].icon || '📖'), h('span', null, kidTitle(EDU()[id])), this.isCompleted(id) ? h('span', { class: 'hk-ok', 'aria-hidden': 'true' }, '✅') : null))))));
        list.lastChild.style.setProperty('--c', /^#[0-9a-f]{3,8}$/i.test(f.color || '') ? f.color : '#f4c54a');
      });
      body.appendChild(list);
      this._selectFloor(ctx, false);
    },

    // ------------------------------------------------------------ world interactables
    _registerInteractables() {
      const I = G.interact;
      if (!I || typeof I.register !== 'function') { G.log.warn('UI', 'interaction system missing: education interactables skipped'); return; }
      const lay = L();
      const ground = (x, z) => { try { return G.world?.surfaceHeight ? G.world.surfaceHeight(x, z) : (G.world?.terrainHeight?.(x, z) || 0); } catch (e) { return 0; } };
      const reg = (o, x, z, dy) => {
        const pos = new THREE.Vector3(x, ground(x, z) + dy, z);
        const obj = G.world?.getObject?.(o.id) || null;
        const r = I.register(Object.assign({ position: pos, object: obj }, o));
        if (r) this._interactIds.add(o.id);
      };
      const short = (t, n = 13) => {
        t = String(t || '').trim();
        if (t.length <= n) return t;
        const cut = t.lastIndexOf(' ', n);
        return cut >= 4 ? t.slice(0, cut) : t.slice(0, n - 1) + '…';
      };
      for (const s of lay.signs || []) {
        reg({ id: s.id, kind: 'sign', label: `안내판 읽기 · ${short(s.title)}`, kidLabel: '안내판 보기', emoji: '🪧', radius: 2.9, onInteract: () => this.readSign(s.id) }, s.x, s.z, 1.3);
      }
      for (const k of lay.kiosks || []) {
        reg({ id: k.id, kind: 'kiosk', label: `키오스크 보기 · ${short(EDU()[k.edu]?.title || k.title)}`, kidLabel: '이야기 듣기', emoji: EDU()[k.edu]?.icon || '📺', radius: 2.6, onInteract: () => this.open(EDU()[k.edu] ? k.edu : 'EDU_FERMENT') }, k.x, k.z, 1.3);
      }
      for (const x of lay.exhibits || []) {
        reg({ id: x.id, kind: 'exhibit', label: `전시 살펴보기 · ${short(x.title)}`, kidLabel: '구경하기', emoji: G.data.items?.[x.food]?.icon || '🍲', radius: 2.4, onInteract: () => this.openExhibit(x.id) }, x.x, x.z, 0.95);
      }
      // 전통도구 전시장: each tool is its own stop (quest Q_CULTURE counts 3 different ones, COL_TOOL_* stickers unlock)
      for (const t of lay.tools || []) {
        const icon = G.data.toolInfo?.[t.id]?.icon || G.data.collection?.[`COL_${t.id}`]?.icon || '🛠️';
        reg({ id: t.id, kind: 'tool', label: `전통도구 살펴보기 · ${short(t.name)}`, kidLabel: `${t.name} 보기`, emoji: icon, radius: 1.9, onInteract: () => this.openTool(t.id) }, t.x, t.z, 0.6);
      }
      const eb = lay.eduBoard;
      if (eb) reg({ id: eb.id || 'EDU_BOARD', kind: 'board', label: '교육 게시판 보기', kidLabel: '배움터', emoji: '📚', radius: 3.6, onInteract: () => this.openLibrary() }, eb.x, eb.z, 1.9);
      const hd = lay.hallDoor;
      if (hd) reg({ id: hd.id || 'HALL_DOOR', kind: 'door', label: '체험관 안내', kidLabel: '체험관 안내', emoji: '🏛️', radius: 4.2, priority: 1, onInteract: () => this.openHallGuide() }, hd.x, hd.z, 1.4);
    },
  };

  G.register(education);
})();
