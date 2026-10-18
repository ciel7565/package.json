// =============================================================================
// 52-photo.js — photo mode, capture, photo zones and the album (G.sys.photo)
//
//   active, enter({photoZoneId}), exit(), toggle(), capture() -> Promise<photo|null>
//   openGallery({photoId}), currentPhotoZone (layout.photoZones entry | null), photoZoneAt(x, z)
//   setFilter(id), setFrame(bool), filters
// Photo mode: body.hud-hidden + #photo-ui overlay (top bar, pose picker from G.data.gestures, camera
// distance / height sliders, grid, hide-player, 전통 액자 frame, filters 기본/따뜻한/흑백/빈티지/선명,
// self-timer, big shutter). Camera G.sys.camera.setMode('photo') + photoControl; gameplay input is
// blocked (G.ui.block('photo')) so WASD does not move the player. Hotkey P toggles, Space shoots, Esc exits.
// Capture = engine.render() -> draw the WebGL canvas on a 2D canvas with the filter (+ vignette / grain)
// and the traditional frame + '전통발효체험관' watermark -> PNG download (a[download]) + 384 px JPEG
// thumbnail in G.state.photos (max 24) -> flash, 'shutter' sfx, photo:taken {photoId, zoneId, photoZoneId}.
// Photo zones: interactables kind 'photo' ('포토존 – 사진 찍기') that frame the shot towards the zone's
// look target, plus a small camera label over each zone when near. Emits photo:mode {active}.
// 쉬운 모드 (CONTRACT §12): a separate kid overlay (.ph-kid) replaces the adult panels — ⬅️ 나가기, a giant 📸
// shutter, 5 big pose buttons, 4 fun frames (🌸 꽃 · 🏺 전통 · ⭐ 별 · 🌈 무지개, or 🚫 none), 6 emoji stickers the
// child can tap in and drag around (drawn into the photo), 🤳 앞/뒤 view, 🧽 clear. Shutter = "찰칵!" pop + voice +
// a soft single flash (eased, ≤ 0.5 white; a gold glow instead with reduce-motion). Photos go to the album
// (G.state.photos) exactly as in normal mode; no automatic PNG download in easy mode.
// The flash is the soft one in both modes (photosensitivity: no hard full-screen white).
// =============================================================================
(function () {
  const U = G.util;
  const esc = U.escapeHtml;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const PI = Math.PI, TAU = PI * 2;
  const MAX_PHOTOS = 24;
  const THUMB_W = 384;
  const LS_OPTS = 'tfm.v1.photoOpts';
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const FILTERS = [
    { id: 'none', name: '기본', css: 'none' },
    { id: 'warm', name: '따뜻한', css: 'sepia(0.22) saturate(1.28) hue-rotate(-6deg) brightness(1.04) contrast(1.02)' },
    { id: 'mono', name: '흑백', css: 'grayscale(1) contrast(1.12) brightness(1.03)' },
    { id: 'vintage', name: '빈티지', css: 'sepia(0.5) contrast(0.9) brightness(1.06) saturate(0.85)', vignette: 0.55, grain: true },
    { id: 'vivid', name: '선명', css: 'contrast(1.16) saturate(1.42) brightness(1.02)' },
  ];
  const TIMERS = [0, 3, 10];
  // ---- 쉬운 모드
  const KID_FRAMES = [
    { id: 'none', emoji: '🚫', label: '없음', say: '액자 없이 찍어요.' },
    { id: 'flower', emoji: '🌸', label: '꽃', say: '꽃 액자예요.' },
    { id: 'hanok', emoji: '🏺', label: '전통', say: '알록달록 전통 액자예요.' },
    { id: 'star', emoji: '⭐', label: '별', say: '반짝반짝 별 액자예요.' },
    { id: 'rainbow', emoji: '🌈', label: '무지개', say: '무지개 액자예요.' },
  ];
  const KID_STICKERS = ['😀', '❤️', '⭐', '🌸', '🏺', '🎉'];
  const KID_POSES = ['GES_PHOTO', 'GES_WAVE', 'GES_DANCE', 'GES_CHEER', 'GES_BOW'];
  const KID_POSE_LABEL = { GES_PHOTO: '브이', GES_WAVE: '안녕', GES_DANCE: '춤', GES_CHEER: '응원', GES_BOW: '인사' };
  const STICKER_SLOTS = [[0.24, 0.3], [0.76, 0.3], [0.3, 0.6], [0.7, 0.6], [0.5, 0.2], [0.16, 0.48], [0.84, 0.48], [0.5, 0.74]];
  const MAX_STICKERS = 8;
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const kidSay = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };
  const reduceMotion = () => !!G.settings?.reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const L = () => G.data.layout || {};
  const filterById = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];
  const loadOpts = () => { try { return JSON.parse(localStorage.getItem(LS_OPTS) || '{}') || {}; } catch (e) { return {}; } };
  const _v = new THREE.Vector3();

  // ================================================================= drawing helpers (frame / watermark / effects)
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /** 回-shaped key-fret (번개문) cell of size c at (x, y) */
  function fretCell(ctx, x, y, c) {
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y); ctx.lineTo(x + c, y + c * 0.78);
    ctx.lineTo(x + c * 0.24, y + c * 0.78); ctx.lineTo(x + c * 0.24, y + c * 0.26); ctx.lineTo(x + c * 0.74, y + c * 0.26);
    ctx.lineTo(x + c * 0.74, y + c * 0.54); ctx.lineTo(x + c * 0.48, y + c * 0.54);
  }
  function fretRun(ctx, len, b) {
    const c = b * 0.5, gap = c * 0.32, step = c + gap;
    const n = Math.max(1, Math.floor((len + gap) / step));
    const start = (len - (n * step - gap)) / 2;
    for (let i = 0; i < n; i++) fretCell(ctx, start + i * step, (b - c) / 2, c);
  }
  function rosette(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = '#245f52'; ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.1); ctx.strokeStyle = '#e8c068'; ctx.stroke();
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.rotate((i / 8) * TAU);
      ctx.beginPath(); ctx.ellipse(0, -r * 0.48, r * 0.2, r * 0.38, 0, 0, TAU);
      ctx.fillStyle = i % 2 ? '#f0a3a0' : '#d8473b'; ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fillStyle = '#f4c54a'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.11, 0, TAU); ctx.fillStyle = '#8a2a1e'; ctx.fill();
    ctx.restore();
  }
  /** traditional dancheong-style frame with the 전통발효체험관 cartouche */
  function drawFrame(ctx, w, h, info = {}) {
    const u = Math.min(w, h);
    const b = Math.max(10, Math.round(u * 0.044));
    ctx.save();
    // lacquer band
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(b, b, w - b * 2, h - b * 2);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#6a2117'); g.addColorStop(0.5, '#8e3222'); g.addColorStop(1, '#6a2117');
    ctx.fillStyle = g; ctx.fill('evenodd');
    // dancheong stripes on the inner edge (green · white · blue · red)
    const stripes = [['#2f7d6b', 0.16], ['#f4ecd6', 0.07], ['#2c5aa0', 0.12], ['#c8463a', 0.07]];
    let off = b;
    for (const [col, f] of stripes) {
      const t = Math.max(1, b * f);
      ctx.beginPath(); ctx.rect(off, off, w - off * 2, h - off * 2); ctx.rect(off + t, off + t, w - (off + t) * 2, h - (off + t) * 2);
      ctx.fillStyle = col; ctx.fill('evenodd');
      off += t;
    }
    // gold rules
    ctx.lineWidth = Math.max(1, u * 0.0022); ctx.strokeStyle = '#e1b85a';
    ctx.strokeRect(b * 0.16, b * 0.16, w - b * 0.32, h - b * 0.32);
    ctx.strokeRect(b * 0.9, b * 0.9, w - b * 1.8, h - b * 1.8);
    // key-fret along the four sides
    ctx.lineWidth = Math.max(1, b * 0.075); ctx.strokeStyle = '#e8c068'; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    // [origin x, origin y, rotation, run length]: local x runs along the side, local y crosses the band (0 = outer edge)
    const sides = [[b, 0, 0, w - b * 2], [w, b, PI / 2, h - b * 2], [w - b, h, PI, w - b * 2], [0, h - b, -PI / 2, h - b * 2]];
    for (const [x, y, rot, len] of sides) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath(); fretRun(ctx, len, b); ctx.stroke();
      ctx.restore();
    }
    // corner rosettes
    for (const [x, y] of [[b / 2, b / 2], [w - b / 2, b / 2], [b / 2, h - b / 2], [w - b / 2, h - b / 2]]) rosette(ctx, x, y, b * 0.62);
    // cartouche: 전통발효체험관 + date / place
    const title = '전통발효체험관';
    const sub = [ 'METAVERSE', info.date || U.formatDate(G.time.now()), info.place ].filter(Boolean).join('  ·  ');
    const ts = Math.round(b * 0.78), ss = Math.round(b * 0.36);
    ctx.font = `800 ${ts}px ${FONT}`;
    const tw = ctx.measureText(title).width;
    ctx.font = `600 ${ss}px ${FONT}`;
    const sw = ctx.measureText(sub).width;
    const cw = Math.max(tw, sw) + b * 2.2, ch = b * 1.95;
    // bottom-right stamp: overlaps the band like a seal, keeps the centre of the picture free
    const cx = w - b * 1.6 - cw, cy = h - b - ch * 0.62;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = b * 0.4; ctx.shadowOffsetY = b * 0.08;
    roundRect(ctx, cx, cy, cw, ch, b * 0.42);
    const cg = ctx.createLinearGradient(0, cy, 0, cy + ch);
    cg.addColorStop(0, '#3a2318'); cg.addColorStop(1, '#22140d');
    ctx.fillStyle = cg; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, b * 0.08); ctx.strokeStyle = '#e1b85a'; ctx.stroke();
    roundRect(ctx, cx + b * 0.16, cy + b * 0.16, cw - b * 0.32, ch - b * 0.32, b * 0.3);
    ctx.lineWidth = Math.max(1, b * 0.03); ctx.strokeStyle = 'rgba(225,184,90,0.55)'; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${ts}px ${FONT}`;
    const tg = ctx.createLinearGradient(0, cy, 0, cy + ch * 0.6);
    tg.addColorStop(0, '#ffe7a3'); tg.addColorStop(1, '#e0ad3f');
    ctx.fillStyle = tg;
    ctx.fillText(title, cx + cw / 2, cy + ch * 0.4);
    ctx.font = `600 ${ss}px ${FONT}`; ctx.fillStyle = '#f2e6cc';
    ctx.fillText(sub, cx + cw / 2, cy + ch * 0.76);
    ctx.restore();
  }
  /** small corner watermark used when the frame is off */
  function drawWatermark(ctx, w, h, info = {}) {
    const u = Math.min(w, h), s = Math.max(11, Math.round(u * 0.026));
    ctx.save();
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = s * 0.5;
    ctx.font = `800 ${s}px ${FONT}`; ctx.fillStyle = 'rgba(255,240,200,0.92)';
    ctx.fillText('전통발효체험관', w - s * 0.9, h - s * 1.5);
    ctx.font = `600 ${Math.round(s * 0.55)}px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText([info.date, info.place].filter(Boolean).join(' · '), w - s * 0.9, h - s * 0.7);
    ctx.restore();
  }
  /** five-petal flower */
  function flowerAt(ctx, x, y, r, petal, core) {
    ctx.fillStyle = petal;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - PI / 2;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.48, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r * 0.36, 0, TAU); ctx.fillStyle = core; ctx.fill();
  }
  function starAt(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  /** points evenly spaced along the band centre line (clockwise from the top-left corner) */
  function bandPoints(w, h, b, step) {
    const pts = [];
    const x0 = b / 2, y0 = b / 2, x1 = w - b / 2, y1 = h - b / 2;
    const per = 2 * ((x1 - x0) + (y1 - y0));
    const n = Math.max(8, Math.round(per / step));
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per;
      if (d < x1 - x0) { pts.push([x0 + d, y0]); continue; } d -= x1 - x0;
      if (d < y1 - y0) { pts.push([x1, y0 + d]); continue; } d -= y1 - y0;
      if (d < x1 - x0) { pts.push([x1 - d, y1]); continue; } d -= x1 - x0;
      pts.push([x0, y1 - d]);
    }
    return pts;
  }
  /** rounded-rectangle sub-path WITHOUT beginPath (so several can be combined for an evenodd ring) */
  function rrSub(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /** a rounded "window" band: the outside of an inner rounded rectangle (fill with 'evenodd') */
  function bandPath(ctx, w, h, b, r) {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    rrSub(ctx, b, b, w - b * 2, h - b * 2, r);
  }
  /** fun kid frames: flower / star / rainbow (hanok = the traditional frame, none = watermark only) */
  function drawKidFrame(ctx, w, h, id, info = {}, preview = false) {
    if (id === 'hanok') { drawFrame(ctx, w, h, info); return; }
    if (id !== 'flower' && id !== 'star' && id !== 'rainbow') { if (!preview) drawWatermark(ctx, w, h, info); return; }
    const u = Math.min(w, h);
    const b = Math.max(14, Math.round(u * 0.07));
    const r = b * 0.9;
    ctx.save();
    if (id === 'rainbow') {
      const cols = ['#ff5f5f', '#ff9f43', '#ffd23f', '#55d187', '#4fb3ff', '#8b6fd6'];
      const t = b / cols.length;
      for (let i = 0; i < cols.length; i++) {
        ctx.beginPath();
        if (i === 0) ctx.rect(0, 0, w, h); else rrSub(ctx, i * t, i * t, w - i * t * 2, h - i * t * 2, r + (cols.length - i) * t * 0.6);
        rrSub(ctx, (i + 1) * t, (i + 1) * t, w - (i + 1) * t * 2, h - (i + 1) * t * 2, r + (cols.length - i - 1) * t * 0.6);
        ctx.fillStyle = cols[i]; ctx.fill('evenodd');
      }
      // fluffy clouds on the corners
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = b * 0.25;
      for (const [cx, cy] of [[b * 1.1, b * 1.1], [w - b * 1.1, b * 1.1], [b * 1.1, h - b * 1.1], [w - b * 1.1, h - b * 1.1]]) {
        for (const [dx, dy, rr] of [[-0.5, 0.1, 0.55], [0.1, -0.2, 0.7], [0.65, 0.12, 0.5], [0, 0.3, 0.6]]) { ctx.beginPath(); ctx.arc(cx + dx * b, cy + dy * b, rr * b, 0, TAU); ctx.fill(); }
      }
      ctx.shadowColor = 'transparent';
    } else {
      const flower = id === 'flower';
      bandPath(ctx, w, h, b, r);
      const g = ctx.createLinearGradient(0, 0, w, h);
      if (flower) { g.addColorStop(0, '#ffd1e3'); g.addColorStop(0.5, '#ffe9f2'); g.addColorStop(1, '#ffc6dc'); }
      else { g.addColorStop(0, '#1d2b6b'); g.addColorStop(1, '#2f3f8f'); }
      ctx.fillStyle = g; ctx.fill('evenodd');
      // inner rim
      ctx.lineWidth = Math.max(2, b * 0.09); ctx.strokeStyle = flower ? '#ffffff' : '#ffe27a';
      ctx.beginPath(); roundRect(ctx, b, b, w - b * 2, h - b * 2, r); ctx.stroke();
      const pts = bandPoints(w, h, b, b * 1.25);
      const rnd = U.rng(id === 'flower' ? 77 : 99);
      pts.forEach(([x, y], i) => {
        if (flower) {
          const pal = [['#ff7eb6', '#ffd23f'], ['#ffffff', '#ffb000'], ['#ffb3d1', '#ff7a59'], ['#b48bff', '#ffe27a']][i % 4];
          flowerAt(ctx, x, y, b * (0.34 + rnd() * 0.12), pal[0], pal[1]);
          if (i % 3 === 0) { ctx.fillStyle = '#7fcf6a'; ctx.beginPath(); ctx.ellipse(x + b * 0.32, y + b * 0.2, b * 0.16, b * 0.08, 0.6, 0, TAU); ctx.fill(); }
        } else {
          starAt(ctx, x, y, b * (i % 2 ? 0.2 : 0.34 + rnd() * 0.08), rnd() * 0.6);
          ctx.fillStyle = i % 5 === 0 ? '#ffffff' : '#ffd23f'; ctx.fill();
          if (i % 2 === 0) { ctx.beginPath(); ctx.arc(x + b * 0.32, y - b * 0.28, b * 0.05, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill(); }
        }
      });
    }
    ctx.restore();
    if (preview) return; // the live preview keeps the corners free for the big buttons; the photo gets the name tag
    // small name tag (bottom-right, on the picture)
    const s = Math.max(11, Math.round(u * 0.026));
    ctx.save();
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s * 0.5;
    ctx.font = `800 ${s}px ${FONT}`; ctx.fillStyle = '#ffffff';
    ctx.fillText('전통발효체험관', w - b - s * 0.6, h - b - s * 0.9);
    ctx.font = `600 ${Math.round(s * 0.55)}px ${FONT}`;
    ctx.fillText([info.date, info.place].filter(Boolean).join(' · '), w - b - s * 0.6, h - b - s * 0.2);
    ctx.restore();
  }
  function drawVignette(ctx, w, h, k) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.56);
    g.addColorStop(0, 'rgba(30,18,6,0)'); g.addColorStop(1, `rgba(30,18,6,${k})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function drawGrain(ctx, w, h) {
    const t = document.createElement('canvas'); t.width = 128; t.height = 128;
    const tc = t.getContext('2d');
    const img = tc.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = 110 + Math.random() * 60; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 28; }
    tc.putImageData(img, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  /** per-pixel fallback when CanvasRenderingContext2D.filter is unsupported */
  function manualFilter(ctx, w, h, id) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      if (id === 'mono') { const v = (y - 128) * 1.12 + 132; r = g = b = v; }
      else if (id === 'warm') { r = r * 1.08 + 8; g = g * 1.02 + 2; b = b * 0.9; }
      else if (id === 'vintage') { const sr = y * 1.07 + 22, sg = y * 0.95 + 8, sb = y * 0.78; r = (r * 0.5 + sr * 0.5 - 128) * 0.9 + 134; g = (g * 0.5 + sg * 0.5 - 128) * 0.9 + 134; b = (b * 0.5 + sb * 0.5 - 128) * 0.9 + 130; }
      else if (id === 'vivid') { r = ((y + (r - y) * 1.42) - 128) * 1.16 + 128; g = ((y + (g - y) * 1.42) - 128) * 1.16 + 128; b = ((y + (b - y) * 1.42) - 128) * 1.16 + 128; }
      d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }
  function stamp(ts) {
    const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function download(href, name) {
    const a = document.createElement('a');
    a.href = href; a.download = name; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);
  }
  const safeThumb = (s) => (typeof s === 'string' && /^(data:image\/(png|jpe?g|webp);base64,|blob:|https?:)/.test(s) ? s : '');

  // ================================================================= the system
  const PH = {
    name: 'photo', order: 74, label: '사진',
    active: false, currentPhotoZone: null,
    filter: 'none', frame: true, grid: false, hidePlayer: false, lookAtCam: false, autoSave: true, timer: 0,
    filters: FILTERS,
    _ui: null, _busy: false, _zoneT: 0, _syncT: 0, _lookT: 0, _countdown: null, _labels: [], _full: new Map(),
    _cardTimer: 0, _clean: false,
    kidFrame: 'flower', _stickers: [], _stickerN: 0, _kidFront: false, _kidHinted: false, _kidCardTimer: 0,
    get kidFrames() { return KID_FRAMES; },

    init() {
      const o = loadOpts();
      if (o.filter && FILTERS.some((f) => f.id === o.filter)) this.filter = o.filter;
      if (typeof o.frame === 'boolean') this.frame = o.frame;
      if (typeof o.grid === 'boolean') this.grid = o.grid;
      if (typeof o.autoSave === 'boolean') this.autoSave = o.autoSave;
      if (TIMERS.includes(o.timer)) this.timer = o.timer;
      if (KID_FRAMES.some((f) => f.id === o.kidFrame)) this.kidFrame = o.kidFrame;
      this._buildUi();
      G.ui.onAction('photo', () => this.toggle());
      G.ui.onAction('photo-gallery', () => this.openGallery());
      G.input?.onKey?.('KeyP', () => {
        if (this.active) { if (G.ui.modal.isOpen()) return false; this.exit(); return true; }
        if (!G.state || G.ui.isBlocking()) return false;
        return this.enter() !== false;
      }, { allowInModal: true });
      const shoot = () => { if (!this.active || G.ui.modal.isOpen() || U.isTyping()) return false; this.shoot(); return true; };
      G.input?.onKey?.('Space', shoot, { allowInModal: true });
      G.input?.onKey?.('Enter', shoot, { allowInModal: true });
      G.input?.onKey?.('KeyH', () => { if (!this.active || G.ui.modal.isOpen() || easyOn()) return false; this._toggleClean(); return true; }, { allowInModal: true });
      // switching easy <-> normal while the camera is up: swap the overlay, redraw the right frame, filters
      G.bus.on('easy:changed', () => { if (this.active) { this._ui?.classList.remove('clean'); this._clean = false; this._renderOptions(); this._syncKid(); } });
      G.ui.onEscape(() => {
        if (!this.active) return false;
        if (this._countdown) { this._cancelCountdown(); return true; }
        if (G.ui.modal.isOpen()) return false;
        this.exit();
        return true;
      }, 90);
      G.sys.engine?.onResize?.(() => { if (this.active) this._drawFramePreview(); });
      this._registerZones();
    },

    onStateLoaded(state) {
      if (this.active) this.exit({ silent: true });
      if (state && !Array.isArray(state.photos)) state.photos = [];
      if (state?.photos?.length > MAX_PHOTOS) state.photos.splice(0, state.photos.length - MAX_PHOTOS);
      this._updateCount();
    },
    onLogout() {
      if (this.active) this.exit({ silent: true, logout: true });
      this._clearStickers();
      this._kidHinted = false;
      G.ui.modal.get('photo-gallery')?.close();
      this.currentPhotoZone = null;
      this._lastPhoto = null;
      for (const f of this._full.values()) URL.revokeObjectURL(f.url);
      this._full.clear();
    },

    // ------------------------------------------------------------ photo zones
    _registerZones() {
      const zones = L().photoZones || [];
      for (const pz of zones) {
        const y = () => G.world.surfaceHeight(pz.x, pz.z);
        const pos = new THREE.Vector3(pz.x, y() + 0.3, pz.z);
        G.interact?.register?.({
          id: pz.id, kind: 'photo', label: '포토존 – 사진 찍기', position: pos, radius: Math.min(3.2, (pz.r || 4) * 0.8), priority: -0.2,
          object: G.world.getObject(pz.id) || undefined,
          enabled: () => !this.active,
          onInteract: () => { this.enter({ photoZoneId: pz.id }); },
        });
        const obj = G.world.getObject(pz.id);
        const target = obj ? () => { obj.getWorldPosition(_v); _v.y += 3.25; return _v; } : new THREE.Vector3(pz.x, y() + 2.2, pz.z);
        const lbl = G.ui.label({
          className: 'pz-tag', target, maxDist: 24, fadeDist: 7,
          html: `<span class="pz-ico">${G.icon('camera')}</span><span class="pz-name"><small>포토존</small><b>${esc(pz.name)}</b></span>`,
        });
        lbl.pzId = pz.id;
        this._labels.push(lbl);
      }
      // a frame registered after us (props rebuild) -> attach it for highlight / click
      G.bus.on('world:object', ({ id, obj }) => { if (zones.some((z) => z.id === id) && G.interact?.get?.(id)) G.interact.setObject?.(id, obj); });
    },
    photoZoneAt(x, z) {
      let best = null, bd = Infinity;
      for (const pz of L().photoZones || []) {
        const d = Math.hypot(x - pz.x, z - pz.z);
        if (d <= (pz.r || 4) + 0.8 && d < bd) { bd = d; best = pz; }
      }
      return best;
    },

    // ------------------------------------------------------------ UI
    _buildUi() {
      const root = document.getElementById('photo-ui');
      if (!root) return;
      const h = G.ui.h;
      root.innerHTML = '';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', '사진 모드');
      const poses = (G.data.gestures || []).map((g) => h('button', { type: 'button', class: 'ph-pose', dataset: { pose: g.id }, title: g.name }, h('span', { class: 'emoji' }, g.icon || '🙂'), h('span', null, g.name)));
      const filters = FILTERS.map((f) => h('button', { type: 'button', class: `ph-filter f-${f.id}`, dataset: { filter: f.id }, 'aria-pressed': 'false' }, h('i'), h('span', null, f.name)));
      const toggle = (key, icon, label, hint) => h('button', { type: 'button', class: 'ph-toggle', dataset: { toggle: key }, 'aria-pressed': 'false', title: hint || label },
        h('span', { class: 'ico ico-sm', 'data-icon': icon }), h('span', null, label), h('i', { class: 'ph-sw' }));
      root.append(
        h('canvas', { class: 'ph-frame-preview', 'aria-hidden': 'true' }),
        h('div', { class: 'ph-grid', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
        h('div', { class: 'ph-vignette', 'aria-hidden': 'true' }),
        h('div', { class: 'ph-countdown', 'aria-live': 'assertive', hidden: true }),
        h('header', { class: 'ph-top glass' },
          h('div', { class: 'ph-title' }, h('span', { class: 'ph-title-ico' }, h('span', { class: 'ico', 'data-icon': 'camera' })), h('b', null, '사진 모드'),
            h('span', { class: 'chip chip-gold ph-zone', hidden: true }, h('span', { class: 'ico ico-xs', 'data-icon': 'star' }), h('span', { class: 'ph-zone-name' }, ''))),
          h('div', { class: 'ph-hint' }, h('span', null, h('kbd', null, '드래그'), ' 시점'), h('span', null, h('kbd', null, '휠'), ' 거리'), h('span', null, h('kbd', null, 'Space'), ' 촬영'), h('span', null, h('kbd', null, 'H'), ' 화면 정리'), h('span', null, h('kbd', null, 'Esc'), ' 나가기')),
          h('div', { class: 'ph-top-actions' },
            h('button', { type: 'button', class: 'btn btn-sm btn-soft ph-opts-btn', dataset: { ph: 'opts' }, 'aria-pressed': 'false', title: '카메라·옵션 패널', 'aria-label': '카메라 설정 열기' }, h('span', { class: 'ico ico-sm', 'data-icon': 'settings' })),
            h('button', { type: 'button', class: 'btn btn-sm btn-soft', dataset: { ph: 'gallery' } }, h('span', { class: 'ico ico-sm', 'data-icon': 'image' }), '앨범', h('span', { class: 'ph-count' }, '0')),
            h('button', { type: 'button', class: 'btn btn-sm btn-soft', dataset: { ph: 'exit' } }, h('span', { class: 'ico ico-sm', 'data-icon': 'x' }), '나가기'))),
        h('aside', { class: 'ph-left glass' },
          h('h4', null, '포즈'),
          h('div', { class: 'ph-poses' }, poses),
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-block', dataset: { ph: 'stop' } }, h('span', { class: 'ico ico-sm', 'data-icon': 'refresh' }), '포즈 멈추기')),
        h('aside', { class: 'ph-right glass' },
          h('h4', null, '카메라'),
          h('label', { class: 'ph-range' }, h('span', null, '거리', h('b', { dataset: { val: 'dist' } }, '')), h('input', { type: 'range', min: '1.2', max: '20', step: '0.1', dataset: { ph: 'dist' }, 'aria-label': '카메라 거리' })),
          h('label', { class: 'ph-range' }, h('span', null, '높이', h('b', { dataset: { val: 'height' } }, '')), h('input', { type: 'range', min: '-1', max: '3', step: '0.05', dataset: { ph: 'height' }, 'aria-label': '카메라 높이' })),
          h('div', { class: 'ph-btn-row' },
            h('button', { type: 'button', class: 'btn btn-sm btn-soft', dataset: { ph: 'front' } }, '정면에서'),
            h('button', { type: 'button', class: 'btn btn-sm btn-soft', dataset: { ph: 'back' } }, '뒤에서')),
          h('h4', null, '옵션'),
          toggle('grid', 'expand', '격자', '삼분할 격자 표시'),
          toggle('frame', 'image', '전통 액자', '단청 무늬 액자와 체험관 로고를 넣어요'),
          toggle('hidePlayer', 'eye-off', '캐릭터 숨기기', '풍경만 찍어요'),
          toggle('lookAtCam', 'smile', '카메라 보기', '캐릭터가 카메라를 바라봐요'),
          toggle('autoSave', 'download', 'PNG 자동 저장', '찍을 때마다 원본 PNG를 내려받아요'),
          h('button', { type: 'button', class: 'ph-toggle ph-timer', dataset: { ph: 'timer' }, title: '셀프 타이머' }, h('span', { class: 'ico ico-sm', 'data-icon': 'clock' }), h('span', { class: 'ph-timer-label' }, '타이머 끔'))),
        h('footer', { class: 'ph-bottom' },
          h('div', { class: 'ph-filters glass', role: 'group', 'aria-label': '필터' }, filters),
          h('div', { class: 'ph-shoot-row' },
            h('button', { type: 'button', class: 'ph-side-btn', dataset: { ph: 'gallery' }, title: '앨범', 'aria-label': '앨범' }, h('img', { class: 'ph-last', alt: '', hidden: true }), h('span', { class: 'ico', 'data-icon': 'image' })),
            h('button', { type: 'button', class: 'ph-shutter', dataset: { ph: 'shoot' }, title: '촬영 (Space)', 'aria-label': '사진 촬영' }, h('span')),
            h('button', { type: 'button', class: 'ph-side-btn', dataset: { ph: 'clean' }, title: '화면 정리 (H)', 'aria-label': '화면 정리' }, h('span', { class: 'ico', 'data-icon': 'eye' })))),
        h('div', { class: 'ph-card glass', hidden: true },
          h('img', { alt: '방금 찍은 사진' }),
          h('div', { class: 'ph-card-main' },
            h('b', null, '사진을 저장했어요'),
            h('span', { class: 'ph-card-sub' }, ''),
            h('div', { class: 'ph-card-actions' },
              h('button', { type: 'button', class: 'btn btn-sm btn-soft', dataset: { ph: 'card-gallery' } }, '앨범 보기'),
              h('button', { type: 'button', class: 'btn btn-sm btn-gold', dataset: { ph: 'card-journal' } }, '일지에 첨부')))),
      );
      root.append(this._buildKidUi(), h('div', { class: 'ph-flash', 'aria-hidden': 'true' }));
      G.ui.hydrateIcons(root);
      this._ui = root;
      root.addEventListener('click', (ev) => this._onClick(ev));
      const dist = root.querySelector('[data-ph="dist"]'), height = root.querySelector('[data-ph="height"]');
      dist.addEventListener('input', () => { this._setCamPhoto({ dist: Number(dist.value) }); this._syncSliders(true); });
      height.addEventListener('input', () => { this._setCamPhoto({ height: Number(height.value) }); this._syncSliders(true); });
      // keep keyboard focus off the sliders so Space still shoots
      for (const r of [dist, height]) r.addEventListener('change', () => r.blur());
      this._renderOptions();
    },

    _onClick(ev) {
      const t = ev.target;
      // never keep focus on photo-ui buttons: Space / Enter are the shutter keys
      const btn = t.closest('button');
      if (btn) btn.blur();
      if (t.closest('.ph-kid') && this._onKidClick(t)) return;
      const pose = t.closest('[data-pose]');
      if (pose) { this._playPose(pose.dataset.pose); return; }
      const f = t.closest('[data-filter]');
      if (f) { this.setFilter(f.dataset.filter); G.sfx('click'); return; }
      const tg = t.closest('[data-toggle]');
      if (tg) { this._setOpt(tg.dataset.toggle, !this[tg.dataset.toggle]); G.sfx('click'); return; }
      const b = t.closest('[data-ph]');
      if (!b) return;
      const a = b.dataset.ph;
      if (a === 'shoot') this.shoot();
      else if (a === 'exit') this.exit();
      else if (a === 'gallery' || a === 'card-gallery') this.openGallery();
      else if (a === 'card-journal') { const p = this._lastPhoto; if (p) this._attachToJournal(p); }
      else if (a === 'stop') G.sys.player?.stopAction?.();
      else if (a === 'front') { G.sys.camera?.photoFront?.(); this._syncSliders(true); }
      else if (a === 'back') { const p = G.sys.player; if (p) G.sys.camera?.photoControl?.({ yaw: p.rotY + PI, pitch: 0.22 }); }
      else if (a === 'timer') { const i = (TIMERS.indexOf(this.timer) + 1) % TIMERS.length; this._setOpt('timer', TIMERS[i]); }
      else if (a === 'clean') this._toggleClean();
      else if (a === 'opts') { const on = !this._ui.classList.contains('show-opts'); this._ui.classList.toggle('show-opts', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      if (a !== 'shoot') G.sfx('click');
    },

    _setOpt(key, value) {
      this[key] = value;
      if (key === 'hidePlayer' && this.active) this._applyHide(!!value);
      if (key === 'lookAtCam' && value && this.active) this._faceCamera();
      try { localStorage.setItem(LS_OPTS, JSON.stringify({ filter: this.filter, frame: this.frame, grid: this.grid, autoSave: this.autoSave, timer: this.timer, kidFrame: this.kidFrame })); } catch (e) { /* ignore */ }
      this._renderOptions();
    },
    setFilter(id) { this._setOpt('filter', filterById(id).id); this._applyLiveFilter(); },
    setFrame(on) { this._setOpt('frame', !!on); },

    _renderOptions() {
      const root = this._ui;
      if (!root) return;
      for (const b of root.querySelectorAll('[data-filter]')) { const on = b.dataset.filter === this.filter; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      for (const b of root.querySelectorAll('[data-toggle]')) { const on = !!this[b.dataset.toggle]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      const tl = root.querySelector('.ph-timer-label');
      if (tl) tl.textContent = this.timer ? `타이머 ${this.timer}초` : '타이머 끔';
      root.querySelector('.ph-timer')?.classList.toggle('on', !!this.timer);
      const easy = easyOn();
      root.classList.toggle('show-grid', !!this.grid && !easy);
      root.classList.toggle('show-frame', !!this.frame);
      root.classList.toggle('show-vignette', !!filterById(this.filter).vignette && !easy);
      if (this.active) { this._drawFramePreview(); this._applyLiveFilter(); }
    },

    /** hide / show the player model; only ever restores what photo mode itself hid */
    _applyHide(hide) {
      const o = G.sys.player?.object;
      if (!o) return;
      if (hide) { if (o.visible) { o.visible = false; this._hidPlayer = true; } }
      else if (this._hidPlayer) { o.visible = true; this._hidPlayer = false; }
    },

    _applyLiveFilter() {
      const c = G.sys.engine?.renderer?.domElement;
      if (!c) return;
      const f = filterById(this.filter);
      c.style.filter = this.active && !easyOn() && f.css !== 'none' ? f.css : '';
    },

    _drawFramePreview() {
      const cv = this._ui?.querySelector('.ph-frame-preview');
      if (!cv) return;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      const info = this._info();
      if (easyOn()) drawKidFrame(ctx, w, h, this.kidFrame, info, true);
      else if (this.frame) drawFrame(ctx, w, h, info); else drawWatermark(ctx, w, h, info);
    },

    _info() {
      const zone = G.sys.minimap?.currentZone;
      const pz = this.currentPhotoZone;
      const place = pz ? pz.name : zone && zone.r > 0 ? zone.name : (zone?.name || '');
      return { date: U.formatDate(G.time.now()), place };
    },

    _toggleClean() {
      this._clean = !this._clean;
      this._ui?.classList.toggle('clean', this._clean);
    },

    _updateCount() {
      const n = Array.isArray(G.state?.photos) ? G.state.photos.length : 0;
      const el = this._ui?.querySelector('.ph-count');
      if (el) el.textContent = String(n);
      const p = n ? G.state.photos[n - 1] : null;
      const src = safeThumb(p?.thumb);
      for (const last of this._ui?.querySelectorAll('.ph-last, .phk-last') || []) {
        if (src) { last.src = src; last.hidden = false; } else { last.removeAttribute('src'); last.hidden = true; }
      }
      const kc = this._ui?.querySelector('.phk-count');
      if (kc) kc.textContent = String(n);
    },

    // ------------------------------------------------------------ enter / exit
    enter(opts = {}) {
      if (this.active) return true;
      const pl = G.sys.player;
      if (!G.state || !pl || !pl.object || pl._ready === false) return false;
      if (G.sys.dialogue?.active) {
        if (easyOn()) G.ui.toast('이야기가 끝나면 사진을 찍어요.', { type: 'info', emoji: '📸' });
        else G.ui.toast('대화를 마친 뒤에 사진 모드를 켜 주세요.', { type: 'info' });
        return false;
      }
      if (G.ui.modal.isOpen()) return false;
      G.ui.popover?.close?.();
      pl.cancelWalk?.('photo');
      this.active = true;
      this._clean = false;
      this._ui?.classList.remove('clean');
      G.ui.block('photo');
      document.body.classList.add('hud-hidden', 'photo-mode');
      if (this._ui) this._ui.hidden = false;
      this._updateZone(true);
      const cam = G.sys.camera;
      cam?.setMode?.('photo');
      const pz = opts.photoZoneId ? (L().photoZones || []).find((z) => z.id === opts.photoZoneId) : null;
      if (pz && cam?.photoControl) {
        const p = pl.position;
        const look = pz.look || [pz.x, 1, pz.z - 10];
        let dx = look[0] - p.x, dz = look[2] - p.z;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const yaw = Math.atan2(-dx, -dz);
        cam.photoControl({ yaw, pitch: 0.12, distance: 4.4, height: 0.55 });
        pl.faceTowards?.(p.x - dx * 4, p.z - dz * 4);
        this.currentPhotoZone = pz;
        this._updateZone(true);
      }
      if (this.hidePlayer) this._applyHide(true);
      this._applyLiveFilter();
      this._drawFramePreview();
      this._renderOptions();
      this._syncSliders(true);
      this._updateCount();
      this._kidFront = false;
      this._syncKid();
      G.bus.emit('photo:mode', { active: true });
      G.sfx('open');
      if (easyOn()) {
        kidSay(pz ? `포토존이에요! 큰 사진기 버튼을 눌러 찰칵 찍어요.` : '사진 찍기! 큰 사진기 버튼을 눌러요.', { priority: 1 });
        if (!this._kidHinted) {
          this._kidHinted = true;
          setTimeout(() => { if (this.active && easyOn()) G.easy?.point?.('.phk-shutter', { duration: 3800 }); }, 700);
        }
      }
      G.log.info('UI', `photo mode on${pz ? ` (${pz.id})` : ''}`);
      return true;
    },

    exit(opts = {}) {
      if (!this.active) return;
      this._cancelCountdown();
      this.active = false;
      G.ui.unblock('photo');
      document.body.classList.remove('hud-hidden', 'photo-mode');
      if (this._ui) { this._ui.hidden = true; this._ui.querySelector('.ph-card').hidden = true; this._hideKidCard(); }
      this._clearStickers();
      try { G.easy?.stopPoint?.(); } catch (e) { /* optional */ }
      if (opts.logout) this._hidPlayer = false; // the player module hides the model itself on logout
      else this._applyHide(false);
      this._applyLiveFilter();
      if (G.sys.camera?.mode === 'photo') G.sys.camera.setMode?.('follow');
      G.bus.emit('photo:mode', { active: false });
      if (!opts.silent) G.sfx('close');
      G.log.info('UI', 'photo mode off');
    },
    toggle() { if (this.active) this.exit(); else if (!G.ui.isBlocking()) this.enter(); },

    // ------------------------------------------------------------ per frame
    update(dt, t) {
      this._zoneT -= dt;
      if (this._zoneT <= 0) { this._zoneT = 0.25; this._updateZone(false); }
      if (!this.active) return;
      this._syncT -= dt;
      if (this._syncT <= 0) { this._syncT = 0.12; this._syncSliders(false); }
      if (this.lookAtCam) {
        this._lookT -= dt;
        if (this._lookT <= 0) { this._lookT = 0.3; this._faceCamera(); }
      }
    },

    _faceCamera() {
      const c = G.sys.engine?.camera, pl = G.sys.player;
      if (c && pl?.faceTowards) pl.faceTowards(c.position.x, c.position.z);
    },

    _updateZone(force) {
      const p = G.sys.player?.position;
      const pz = p && G.state ? this.photoZoneAt(p.x, p.z) : null;
      if (pz === this.currentPhotoZone && !force) return;
      this.currentPhotoZone = pz;
      const chip = this._ui?.querySelector('.ph-zone');
      if (chip) {
        chip.hidden = !pz;
        const n = chip.querySelector('.ph-zone-name');
        if (n) n.textContent = pz ? `포토존 · ${pz.name}` : '';
      }
      for (const lbl of this._labels) lbl.el.classList.toggle('here', !!pz && lbl.pzId === pz.id);
      if (this.active) { this._drawFramePreview(); this._syncKid(); }
    },

    /** camera photo orbit through the public API (falls back to photoControl on older cameras) */
    _setCamPhoto(s) {
      const cam = G.sys.camera;
      if (cam?.setPhotoState) cam.setPhotoState(s);
      else cam?.photoControl?.({ distance: s.dist, height: s.height });
    },

    _syncSliders(force) {
      const cam = G.sys.camera;
      const ph = cam?.photoState ? cam.photoState(this._phState || (this._phState = {})) : cam?._photo;
      const root = this._ui;
      if (!ph || !root) return;
      const el = this._sl || (this._sl = {
        d: root.querySelector('[data-ph="dist"]'), h: root.querySelector('[data-ph="height"]'),
        dv: root.querySelector('[data-val="dist"]'), hv: root.querySelector('[data-val="height"]'),
      });
      const dist = Math.round(ph.dist * 10) / 10, hgt = Math.round(ph.height * 20) / 20;
      if (!force && dist === this._slD && hgt === this._slH) return;
      this._slD = dist; this._slH = hgt;
      if (el.d && (force || document.activeElement !== el.d)) el.d.value = String(dist);
      if (el.h && (force || document.activeElement !== el.h)) el.h.value = String(hgt);
      if (el.dv) el.dv.textContent = `${dist.toFixed(1)} m`;
      if (el.hv) el.hv.textContent = `${hgt >= 0 ? '+' : ''}${hgt.toFixed(1)} m`;
    },

    _playPose(id) {
      const g = (G.data.gestures || []).find((x) => x.id === id);
      if (!g) return;
      if (this.hidePlayer) this._setOpt('hidePlayer', false);
      let done = false;
      try { if (G.sys.social?.gesture) done = G.sys.social.gesture(id) !== false; } catch (e) { G.log.warn('UI', 'gesture failed', e); }
      if (!done) G.sys.player?.playAction?.(g.anim, { duration: g.duration, loop: !!g.loop });
      for (const b of this._ui.querySelectorAll('[data-pose]')) b.classList.toggle('active', b.dataset.pose === id);
      clearTimeout(this._poseT);
      this._poseT = setTimeout(() => { for (const b of this._ui?.querySelectorAll('[data-pose].active') || []) b.classList.remove('active'); }, g.loop ? 600 : (g.duration || 2) * 1000);
      G.sfx('click');
    },

    // ------------------------------------------------------------ capture
    shoot() {
      if (!this.active || this._busy) return;
      if (this._countdown) { this._cancelCountdown(); return; }
      if (easyOn()) { this._kidShutter(); return; }
      if (!this.timer) { this.capture(); return; }
      const el = this._ui.querySelector('.ph-countdown');
      let n = this.timer;
      const tick = () => {
        if (!this.active) { this._cancelCountdown(); return; }
        if (n <= 0) { this._cancelCountdown(); this.capture(); return; }
        el.hidden = false;
        el.textContent = String(n);
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        G.sfx('click');
        n--;
        this._countdown = setTimeout(tick, 1000);
      };
      this._ui.classList.add('counting');
      tick();
    },
    _cancelCountdown() {
      clearTimeout(this._countdown);
      this._countdown = null;
      const el = this._ui?.querySelector('.ph-countdown');
      if (el) el.hidden = true;
      this._ui?.classList.remove('counting');
    },

    async capture() {
      if (!this.active || this._busy) return null;
      const E = G.sys.engine;
      const r = E?.renderer;
      if (!r || !G.state) return null;
      // a lost GPU context draws nothing: say so instead of saving a dark, empty picture to the album
      let lost = !!E._lost;
      try { lost = lost || !!r.getContext().isContextLost(); } catch (e) { lost = true; }
      if (lost) {
        G.ui.toast('지금은 사진을 찍을 수 없어요. 잠시 후 다시 찍어 주세요.', { type: 'warn', easy: '앗, 지금은 사진이 안 찍혀요. 조금 있다 다시 눌러 봐요!' });
        return null;
      }
      this._busy = true;
      try {
        const info = this._info();
        const easy = easyOn();
        const f = easy ? FILTERS[0] : filterById(this.filter);
        // fresh frame in the drawing buffer, read it in the same task (preserveDrawingBuffer is off); forced: the
        // engine thins out frames behind large modals
        E.render({ force: true });
        const src = r.domElement;
        const w = src.width, h = src.height;
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const ctx = out.getContext('2d');
        const native = typeof ctx.filter === 'string';
        if (native && f.css !== 'none') ctx.filter = f.css;
        ctx.drawImage(src, 0, 0, w, h);
        if (native) ctx.filter = 'none';
        else if (f.css !== 'none') manualFilter(ctx, w, h, f.id);
        if (f.vignette) drawVignette(ctx, w, h, f.vignette);
        if (f.grain) drawGrain(ctx, w, h);
        if (easy) {
          this._drawStickers(ctx, w, h);
          drawKidFrame(ctx, w, h, this.kidFrame, info);
        } else if (this.frame) drawFrame(ctx, w, h, info); else drawWatermark(ctx, w, h, info);
        this._softFlash();
        G.sfx('shutter');
        // thumbnail (kept in the save)
        const tw = Math.min(THUMB_W, w), th = Math.max(1, Math.round((h * tw) / w));
        const tc = document.createElement('canvas');
        tc.width = tw; tc.height = th;
        const tctx = tc.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(out, 0, 0, tw, th);
        const thumb = tc.toDataURL('image/jpeg', 0.8);
        const now = G.time.now();
        const zone = G.sys.minimap?.currentZone;
        const pz = this.currentPhotoZone;
        const photo = {
          id: U.uid('photo'), at: now,
          zoneId: zone?.id || G.state.player?.zoneId || null,
          photoZoneId: pz?.id || null,
          place: info.place || '', filter: f.id, frame: easy ? this.kidFrame !== 'none' : !!this.frame,
          frameId: easy ? this.kidFrame : (this.frame ? 'hanok' : 'none'), stickers: easy ? this._stickers.length : 0, w, h, thumb,
        };
        const list = Array.isArray(G.state.photos) ? G.state.photos : (G.state.photos = []);
        list.push(photo);
        if (list.length > MAX_PHOTOS) list.splice(0, list.length - MAX_PHOTOS);
        G.dirty('photo');
        this._lastPhoto = photo;
        this._updateCount();
        if (easy) this._showKidCard(photo); else this._showCard(photo);
        // full-size PNG: keep a few in memory for the album, download when enabled
        const name = `jeontong-balhyo_${stamp(now)}.png`; // ASCII: some browsers drop non-ASCII download names
        out.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          this._full.set(photo.id, { url, name });
          while (this._full.size > 6) { const [k, v] = this._full.entries().next().value; URL.revokeObjectURL(v.url); this._full.delete(k); }
          if (this.autoSave && !easy) download(url, name);
        }, 'image/png');
        G.bus.emit('photo:taken', { photoId: photo.id, zoneId: photo.zoneId, photoZoneId: photo.photoZoneId });
        G.log.info('UI', `photo taken ${photo.id} ${w}x${h}${pz ? ` @${pz.id}` : ''}`);
        return photo;
      } catch (e) {
        G.log.error('UI', 'photo capture failed', e);
        G.ui.toast('사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error', easy: '앗, 사진이 안 찍혔어요. 다시 눌러 봐요!', retry: () => { if (this.active) this.shoot(); } });
        return null;
      } finally {
        this._busy = false;
      }
    },

    _showCard(photo) {
      const card = this._ui?.querySelector('.ph-card');
      if (!card) return;
      card.querySelector('img').src = photo.thumb;
      const where = photo.photoZoneId ? `포토존 · ${photo.place}` : photo.place || '체험관';
      card.querySelector('.ph-card-sub').textContent = `${where}${this.autoSave ? ' · PNG 내려받기' : ' · 앨범에 보관'}`;
      card.hidden = false;
      card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
      clearTimeout(this._cardTimer);
      this._cardTimer = setTimeout(() => { card.hidden = true; }, 4800);
    },

    _attachToJournal(p) {
      G.ui.modal.get('photo-gallery')?.close();
      if (this.active) this.exit();
      const J = G.sys.journal;
      if (!J?.open) { G.ui.toast('작업일지를 열 수 없어요.', { type: 'warn' }); return; }
      setTimeout(() => J.open({ prefill: { photo: p.thumb, photoId: p.id } }), 0);
    },

    // ============================================================ 쉬운 모드 overlay
    _buildKidUi() {
      const h = G.ui.h;
      const tile = (attrs, emoji, label) => h('button', { type: 'button', ...attrs }, h('span', { class: 'phk-emo emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'phk-lbl' }, label));
      const gestures = G.data.gestures || [];
      const poses = KID_POSES.map((id) => gestures.find((g) => g.id === id)).filter(Boolean)
        .map((g) => tile({ class: 'phk-tile phk-pose', dataset: { pose: g.id }, 'data-say': g.name, 'aria-label': g.name }, g.icon || '🙂', KID_POSE_LABEL[g.id] || g.name.slice(0, 2)));
      const frames = KID_FRAMES.map((f) => tile({ class: 'phk-tile phk-frame', dataset: { kidFrame: f.id }, 'data-say': f.say, 'aria-label': `${f.label} 액자`, 'aria-pressed': 'false' }, f.emoji, f.label));
      const stickers = KID_STICKERS.map((e) => h('button', { type: 'button', class: 'phk-st-btn', dataset: { sticker: e }, 'aria-label': `${e} 스티커 붙이기`, 'data-say': '스티커 붙이기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e)));
      const ui = h('div', { class: 'ph-kid', 'aria-label': '사진 찍기' },
        h('div', { class: 'phk-stage', 'aria-hidden': 'true' }),
        h('div', { class: 'phk-top' },
          h('button', { type: 'button', class: 'phk-exit easy-big-btn easy-btn-no', dataset: { phk: 'exit' }, 'data-say': '나가기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), h('span', null, '나가기')),
          h('div', { class: 'phk-title glass' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📸'), h('b', null, '사진 찍기'), h('span', { class: 'phk-zone', hidden: true }, '')),
          h('button', { type: 'button', class: 'phk-album glass', dataset: { phk: 'album' }, 'aria-label': '사진첩 보기', 'data-say': '사진첩' },
            h('img', { class: 'phk-last', alt: '', hidden: true }), h('span', { class: 'emoji phk-album-emo', 'aria-hidden': 'true' }, '🖼️'), h('span', { class: 'phk-count' }, '0'))),
        h('aside', { class: 'phk-col phk-left glass', 'aria-label': '포즈' }, h('div', { class: 'phk-col-title' }, '포즈'), poses),
        h('aside', { class: 'phk-col phk-right glass', 'aria-label': '액자' }, h('div', { class: 'phk-col-title' }, '액자'), frames),
        h('div', { class: 'phk-bottom' },
          h('div', { class: 'phk-stickers glass', role: 'group', 'aria-label': '스티커' }, stickers),
          h('div', { class: 'phk-shoot-row' },
            h('button', { type: 'button', class: 'phk-side', dataset: { phk: 'front' }, 'aria-label': '앞에서 찍기', 'data-say': '앞에서 찍기' }, h('span', { class: 'emoji phk-front-emo', 'aria-hidden': 'true' }, '🤳'), h('span', { class: 'phk-lbl phk-front-lbl' }, '앞')),
            h('button', { type: 'button', class: 'phk-shutter', dataset: { phk: 'shoot' }, 'aria-label': '사진 찍기', 'data-say': '찰칵! 사진 찍기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📸')),
            h('button', { type: 'button', class: 'phk-side', dataset: { phk: 'clear' }, 'aria-label': '스티커 모두 지우기', 'data-say': '스티커 지우기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧽'), h('span', { class: 'phk-lbl' }, '지움')))),
        h('div', { class: 'phk-click', 'aria-hidden': 'true' }, '찰칵!'),
        h('div', { class: 'phk-card glass', hidden: true, role: 'status' },
          h('img', { alt: '방금 찍은 사진' }),
          h('div', { class: 'phk-card-main' },
            h('b', null, '사진첩에 쏙 넣었어요!'),
            h('div', { class: 'phk-card-btns' },
              h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes', dataset: { phk: 'card-again' } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📸'), h('span', null, '또 찍기')),
              h('button', { type: 'button', class: 'easy-big-btn easy-btn-no', dataset: { phk: 'card-album' } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖼️'), h('span', null, '사진첩')),
              h('button', { type: 'button', class: 'easy-big-btn easy-btn-no', dataset: { phk: 'card-journal' } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📝'), h('span', null, '일기'))))));
      this._kidStage = ui.querySelector('.phk-stage');
      this._bindStickerDrag(this._kidStage);
      return ui;
    },

    /** kid overlay buttons; true when handled */
    _onKidClick(t) {
      const pose = t.closest('[data-pose]');
      if (pose) { this._playPose(pose.dataset.pose); kidSay(pose.getAttribute('data-say') || '', { priority: 1 }); return true; }
      const fr = t.closest('[data-kid-frame]');
      if (fr) {
        const f = KID_FRAMES.find((x) => x.id === fr.dataset.kidFrame);
        if (f) { this._setOpt('kidFrame', f.id); this._syncKid(); G.sfx('click'); kidSay(f.say, { priority: 1 }); }
        return true;
      }
      const st = t.closest('[data-sticker]');
      if (st) { this._addSticker(st.dataset.sticker); return true; }
      const b = t.closest('[data-phk]');
      if (!b) return false;
      const a = b.dataset.phk;
      if (a === 'shoot') this.shoot();
      else if (a === 'exit') this.exit();
      else if (a === 'album' || a === 'card-album') { this._hideKidCard(); this.openGallery(); }
      else if (a === 'card-again') { this._hideKidCard(); kidSay('또 찍어요!', { priority: 1 }); }
      else if (a === 'card-journal') { const p = this._lastPhoto; this._hideKidCard(); if (p) this._attachToJournal(p); }
      else if (a === 'clear') { this._clearStickers(); kidSay('스티커를 깨끗이 지웠어요.', { priority: 1 }); }
      else if (a === 'front') {
        this._kidFront = !this._kidFront;
        const p = G.sys.player;
        if (this._kidFront) G.sys.camera?.photoFront?.();
        else if (p) G.sys.camera?.photoControl?.({ yaw: p.rotY + PI, pitch: 0.22 });
        this._syncKid();
        kidSay(this._kidFront ? '앞에서 찍어요. 웃어요!' : '뒤에서 찍어요.', { priority: 1 });
      }
      if (a !== 'shoot') G.sfx('click');
      return true;
    },

    /** reflect state on the kid overlay (frame tiles, view toggle, place chip) */
    _syncKid() {
      const ui = this._ui?.querySelector('.ph-kid');
      if (!ui) return;
      for (const b of ui.querySelectorAll('[data-kid-frame]')) { const on = b.dataset.kidFrame === this.kidFrame; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      const fe = ui.querySelector('.phk-front-emo'), fl = ui.querySelector('.phk-front-lbl');
      if (fe) fe.textContent = this._kidFront ? '🔙' : '🤳';
      if (fl) fl.textContent = this._kidFront ? '뒤' : '앞';
      const fb = fe?.closest('button');
      if (fb) { const t = this._kidFront ? '뒤에서 찍기' : '앞에서 찍기'; fb.setAttribute('aria-label', t); fb.setAttribute('data-say', t); }
      const zc = ui.querySelector('.phk-zone');
      if (zc) { const pz = this.currentPhotoZone; zc.hidden = !pz; zc.textContent = pz ? `⭐ ${pz.name}` : ''; }
    },

    /** kid shutter: "찰칵!" pop + voice, then the normal capture */
    _kidShutter() {
      const pop = this._ui?.querySelector('.phk-click');
      if (pop && !reduceMotion()) { pop.classList.remove('on'); void pop.offsetWidth; pop.classList.add('on'); }
      kidSay('찰칵!', { priority: 1 });
      try { G.easy?.stopPoint?.(); } catch (e) { /* optional */ }
      this.capture().then((p) => { if (p && easyOn()) kidSay('멋진 사진이에요! 사진첩에 넣었어요.', { priority: 1, interrupt: false }); });
    },

    /**
     * one soft flash (photosensitivity, CONTRACT §12.4): eased up to ≤ 0.5 white and back over ~0.55 s,
     * never repeated faster than the shutter; reduce-motion gets a gentle gold rim instead
     */
    _softFlash() {
      const el = this._ui?.querySelector('.ph-flash');
      if (!el) return;
      el.classList.remove('on', 'glow'); void el.offsetWidth;
      el.classList.add(reduceMotion() ? 'glow' : 'on');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => el.classList.remove('on', 'glow'), 900);
    },

    // ---- stickers (positions are fractions of the screen = of the captured canvas)
    _addSticker(emoji) {
      if (!this.active || !KID_STICKERS.includes(emoji) || !this._kidStage) return;
      if (this._stickers.length >= MAX_STICKERS) { const old = this._stickers.shift(); old?.el?.remove(); }
      const slot = STICKER_SLOTS[this._stickerN++ % STICKER_SLOTS.length];
      // narrow phones: keep new stickers between the pose / frame columns
      const k = window.innerWidth < 600 ? 0.5 : 1;
      const st = { emoji, fx: 0.5 + (slot[0] - 0.5) * k, fy: slot[1], scale: 1, el: null };
      const el = G.ui.h('span', { class: `phk-sticker emoji${reduceMotion() ? '' : ' pop'}`, role: 'img', 'aria-label': '스티커' }, emoji);
      st.el = el;
      el.__st = st;
      this._placeSticker(st);
      this._kidStage.appendChild(el);
      this._stickers.push(st);
      G.sfx('click');
      kidSay('스티커를 붙였어요. 끌어서 옮겨 봐요!', { priority: 0 });
    },
    _placeSticker(st) {
      if (!st.el) return;
      st.el.style.left = `${(clamp(st.fx, 0.04, 0.96) * 100).toFixed(2)}%`;
      st.el.style.top = `${(clamp(st.fy, 0.06, 0.94) * 100).toFixed(2)}%`;
    },
    _clearStickers() {
      for (const st of this._stickers) st.el?.remove();
      this._stickers.length = 0;
    },
    _bindStickerDrag(stage) {
      let drag = null;
      stage.addEventListener('pointerdown', (ev) => {
        const el = ev.target.closest('.phk-sticker');
        if (!el || !el.__st) return;
        ev.preventDefault(); ev.stopPropagation();
        drag = { id: ev.pointerId, st: el.__st, x: ev.clientX, y: ev.clientY, moved: 0 };
        el.classList.add('dragging');
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      });
      stage.addEventListener('pointermove', (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        ev.preventDefault();
        const w = Math.max(1, window.innerWidth), hh = Math.max(1, window.innerHeight);
        drag.moved += Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y);
        drag.x = ev.clientX; drag.y = ev.clientY;
        drag.st.fx = clamp(ev.clientX / w, 0.04, 0.96);
        drag.st.fy = clamp(ev.clientY / hh, 0.06, 0.94);
        this._placeSticker(drag.st);
      });
      const end = (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        const d = drag; drag = null;
        d.st.el?.classList.remove('dragging');
        if (d.moved < 6 && d.st.el && !reduceMotion()) { const e = d.st.el; e.classList.remove('wiggle'); void e.offsetWidth; e.classList.add('wiggle'); G.sfx('click'); }
      };
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
    },
    _drawStickers(ctx, w, h) {
      if (!this._stickers.length) return;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.min(w, h) * 0.01; ctx.shadowOffsetY = Math.min(w, h) * 0.004;
      for (const st of this._stickers) {
        const size = Math.max(16, Math.round(Math.min(w, h) * 0.12 * (st.scale || 1)));
        ctx.font = `${size}px ${EMOJI_FONT}`;
        const x = clamp(st.fx, 0, 1) * w, y = clamp(st.fy, 0, 1) * h;
        if (Number.isFinite(x) && Number.isFinite(y)) ctx.fillText(st.emoji, x, y);
      }
      ctx.restore();
    },

    _showKidCard(photo) {
      const card = this._ui?.querySelector('.phk-card');
      if (!card) return;
      const src = safeThumb(photo.thumb);
      const img = card.querySelector('img');
      if (src) img.src = src; else img.removeAttribute('src');
      card.hidden = false;
      card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
      clearTimeout(this._kidCardTimer);
      this._kidCardTimer = setTimeout(() => this._hideKidCard(), 7000);
    },
    _hideKidCard() {
      clearTimeout(this._kidCardTimer);
      const card = this._ui?.querySelector('.phk-card');
      if (card) card.hidden = true;
    },

    // ------------------------------------------------------------ album
    openGallery(opts = {}) {
      if (!G.state) return null;
      const h = G.ui.h;
      const easy = easyOn();
      const m = G.ui.modal.open({
        id: 'photo-gallery', size: 'lg', className: `pg-modal${easy ? ' pg-kid' : ''}`, title: easy ? '내 사진첩' : '사진 앨범', icon: easy ? '🖼️' : 'image',
        say: easy ? '내 사진첩이에요. 사진을 눌러 크게 봐요.' : undefined,
        headExtra: h('span', { class: 'chip pg-count' }, ''),
        body: h('div', { class: 'pg' }),
        actions: [],
      });
      this._galleryModal = m;
      if (opts.photoId) this._renderViewer(m, opts.photoId); else this._renderGrid(m);
      return m;
    },
    _photos() { return (Array.isArray(G.state?.photos) ? G.state.photos : []).filter((p) => p && safeThumb(p.thumb)); },

    _renderGrid(m) {
      const h = G.ui.h;
      const list = this._photos().slice().reverse();
      const body = m.body.querySelector('.pg');
      body.innerHTML = '';
      m.el.querySelector('.pg-count').textContent = `${list.length} / ${MAX_PHOTOS}장`;
      const zoneName = (id) => G.world.zoneById(id)?.name || '';
      const easy = easyOn();
      if (!list.length) {
        body.appendChild(h('div', { class: 'empty pg-empty' },
          easy ? h('div', { class: 'pg-empty-emo emoji', 'aria-hidden': 'true' }, '📸') : h('div', { class: 'pg-empty-ico' }, h('span', { class: 'ico ico-lg', 'data-icon': 'camera' })),
          h('b', null, '아직 찍은 사진이 없어요'),
          h('p', { class: 'small' }, easy ? '📸 사진 버튼을 눌러 찍어 봐요!' : 'P 키나 아래 ‘사진’ 버튼으로 사진 모드를 켜 보세요. 금빛 액자가 있는 포토존에서 찍으면 퀘스트도 진행돼요.')));
      } else {
        const grid = h('div', { class: 'pg-grid' }, list.map((p) => {
          const b = h('button', { type: 'button', class: 'pg-item', dataset: { photo: p.id }, title: '크게 보기' },
            h('img', { src: safeThumb(p.thumb), alt: `${p.place || zoneName(p.zoneId) || '체험관'} 사진`, loading: 'lazy' }),
            h('span', { class: 'pg-meta' }, h('b', null, p.place || zoneName(p.zoneId) || '체험관'), h('small', null, U.formatDate(p.at, true))),
            p.photoZoneId ? h('span', { class: 'pg-badge' }, h('span', { class: 'ico ico-xs', 'data-icon': 'star' }), '포토존') : null);
          return b;
        }));
        grid.addEventListener('click', (ev) => { const b = ev.target.closest('[data-photo]'); if (b) this._renderViewer(m, b.dataset.photo); });
        body.appendChild(grid);
      }
      if (!easy) body.appendChild(h('p', { class: 'pg-note tiny muted' }, `앨범에는 최근 ${MAX_PHOTOS}장까지 작은 크기로 보관돼요. 원본 PNG는 촬영할 때 내려받을 수 있어요.`));
      G.ui.hydrateIcons(body);
      const go = { label: easy ? '📸 사진 찍기' : '사진 찍으러 가기', icon: easy ? null : 'camera', class: 'btn-primary', onClick: () => { setTimeout(() => { if (!this.active) this.enter(); }, 0); } };
      m.setActions(easy ? [go] : [go, { label: '닫기', class: 'btn-ghost' }]);
    },

    _renderViewer(m, id) {
      const h = G.ui.h;
      const list = this._photos().slice().reverse();
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) { this._renderGrid(m); return; }
      const p = list[i];
      const body = m.body.querySelector('.pg');
      body.innerHTML = '';
      const zone = G.world.zoneById(p.zoneId);
      const pz = (L().photoZones || []).find((z) => z.id === p.photoZoneId);
      const nav = (d) => { const n = list[(i + d + list.length) % list.length]; if (n) this._renderViewer(m, n.id); };
      const prev = h('button', { type: 'button', class: 'pg-nav prev', 'aria-label': '이전 사진', disabled: list.length < 2 || null }, h('span', { class: 'ico', 'data-icon': 'chevron-left' }));
      const next = h('button', { type: 'button', class: 'pg-nav next', 'aria-label': '다음 사진', disabled: list.length < 2 || null }, h('span', { class: 'ico', 'data-icon': 'chevron-right' }));
      prev.addEventListener('click', () => nav(-1));
      next.addEventListener('click', () => nav(1));
      const full = this._full.get(p.id);
      body.appendChild(h('div', { class: 'pg-viewer' },
        h('div', { class: 'pg-stage' }, h('img', { src: safeThumb(p.thumb), alt: '사진 크게 보기' }), prev, next),
        h('div', { class: 'pg-info' },
          h('dl', { class: 'kv' },
            h('dt', null, '찍은 때'), h('dd', null, U.formatDate(p.at, true)),
            h('dt', null, '장소'), h('dd', null, zone?.name || p.place || '체험관'),
            pz ? h('dt', null, '포토존') : null, pz ? h('dd', null, pz.name) : null,
            h('dt', null, '필터'), h('dd', null, filterById(p.filter).name + (p.frame ? ' · 전통 액자' : '')),
            h('dt', null, '크기'), h('dd', null, full ? `원본 ${p.w}×${p.h} PNG` : `앨범용 ${THUMB_W}px JPEG`)),
          h('div', { class: 'pg-pos tiny muted' }, `${i + 1} / ${list.length}`))));
      G.ui.hydrateIcons(body);
      this._viewerKeys?.();
      const onKey = (e) => { if (m.closed) return; if (e.key === 'ArrowLeft') nav(-1); else if (e.key === 'ArrowRight') nav(1); };
      window.addEventListener('keydown', onKey);
      this._viewerKeys = () => window.removeEventListener('keydown', onKey);
      const prevClose = m.opts.onClose;
      if (!m._pgHooked) { m._pgHooked = true; m.opts.onClose = (mm) => { this._viewerKeys?.(); this._viewerKeys = null; prevClose?.(mm); }; }
      const toList = { label: easyOn() ? '⬅️ 목록' : '목록', icon: easyOn() ? null : 'chevron-left', class: 'btn-ghost', onClick: () => { this._viewerKeys?.(); this._viewerKeys = null; this._renderGrid(m); return false; } };
      const del = { label: easyOn() ? '🗑️ 지우기' : '삭제', icon: easyOn() ? null : 'trash', class: 'btn-danger', onClick: () => { this._deletePhoto(m, p.id); return false; } };
      const toJournal = { label: easyOn() ? '📝 일기에 붙이기' : '작업일지에 첨부', icon: easyOn() ? null : 'journal', class: 'btn-gold', onClick: () => { this._viewerKeys?.(); this._attachToJournal(p); } };
      // easy mode: no file downloads for the child (a grown-up can download in normal mode)
      m.setActions(easyOn() ? [toList, del, toJournal] : [toList, del,
        { label: full ? 'PNG 내려받기' : '내려받기', icon: 'download', class: 'btn-soft', onClick: () => { this._downloadPhoto(p); return false; } }, toJournal]);
    },

    _downloadPhoto(p) {
      const full = this._full.get(p.id);
      if (full) { download(full.url, full.name); return; }
      const src = safeThumb(p.thumb);
      if (!src) return;
      download(src, `jeontong-balhyo_${stamp(p.at || Date.now())}_album.jpg`);
      G.ui.toast('앨범용 작은 사진을 내려받았어요. 원본 PNG는 촬영 직후에만 받을 수 있어요.', { type: 'info', icon: 'download', duration: 3400 });
    },

    async _deletePhoto(m, id) {
      const ok = await G.ui.confirm(easyOn() ? '이 사진을 지울까요?' : '이 사진을 앨범에서 지울까요? 지운 사진은 되돌릴 수 없어요.', { title: '사진 지우기', okText: '지우기', danger: true, icon: 'trash', emoji: '🗑️' });
      if (!ok || !G.state) return;
      const list = G.state.photos || [];
      const i = list.findIndex((p) => p.id === id);
      if (i >= 0) list.splice(i, 1);
      const f = this._full.get(id);
      if (f) { URL.revokeObjectURL(f.url); this._full.delete(id); }
      G.dirty('photo-delete');
      this._updateCount();
      this._viewerKeys?.(); this._viewerKeys = null;
      if (!m.closed) this._renderGrid(m);
      G.ui.toast('사진을 지웠어요.', { type: 'info', icon: 'trash', emoji: '🗑️', sound: false });
    },
  };

  G.register(PH);
})();
