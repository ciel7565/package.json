// =============================================================================
// 09-pack.js — G.pack: the embedded, licence-checked asset pack (CONTRACT §16.1).
//
// tools/build.mjs appends, after the main script, one inert block per file of assets/pack/ —
//   <script type="application/json" id="pack-manifest">{ version, bytes, files: [{ name, kind, w, h, bytes, mime, … }] }</script>
//   <script type="application/octet-stream" data-pack="mat/grass/c" data-mime="image/webp">BASE64</script>
// (--no-assets builds have none: every call below then answers "not there" and callers keep their procedural look).
// Nothing is fetched: a block is turned into a Blob with atob() and decoded with createImageBitmap(blob) or an Image
// element on a blob: URL. The same code runs on file:// and http(s).
//
//   G.pack.ready                    Promise → G.pack, resolved once the blocks are in the DOM (DOMContentLoaded)
//   G.pack.has(name)                the file is embedded in this page (aliases resolve: 'sky/sky_clear_noon' → 'sky/clear_noon')
//   G.pack.usable(name)             has(name) && the quality preset is not `low` && WebGL is available
//   G.pack.names(prefix = '')       embedded names, e.g. names('art/')
//   G.pack.meta(name)               { name, kind, w, h, bytes, mime, license, source, title, credit, titleKo?, avg?, enc?, sunDir?… } | null
//   G.pack.blob(name)               Blob | null (synchronous; cached)
//   G.pack.url(name)                blob: URL for an Image element / CSS background (cached, never revoked) | ''
//   G.pack.image(name, {priority, force})
//                                   Promise → upright ImageBitmap / HTMLImageElement for 2D canvases | null.
//                                   On `low` it resolves null unless force: true (a picture a person opened in a 2D panel).
//   G.pack.texture(name, {srgb, repeat: [x, y], rotation, offset: [x, y], wrap: 'repeat'|'clamp'|'mirror', anisotropy,
//                         priority, onLoad})
//                                   a THREE.Texture returned AT ONCE with a 1×1 placeholder texel (colour: the map's own
//                                   average, normal: 128,128,255, rough: its average or white); the image is swapped in
//                                   when decoded. Assign it when the material is created: the material's shader never
//                                   recompiles. The same name + options gives the same Texture; other options give a
//                                   Texture that shares the image (one decode, one upload per sampler setting).
//                                   texture.userData.pack = { name, ready, failed }.
//   G.pack.hdr(name, {force})       Promise → { data: Uint16Array (half float RGBA, rows bottom-to-top: ready for a
//                                   THREE.DataTexture), w, h, meta } | null
//   G.pack.credits()                [{ name, kind, title, titleKo, credit, license, source }] of every embedded file
//   G.pack.idle()                   Promise resolved when nothing is decoding or waiting (tests, environment re-bakes)
//   G.pack.hold(on)                 true: the queue waits (placeholders stay); false: it runs. ?packhold=1 starts held (tests)
//   G.pack.unload(name)             drop the decoded image of a texture again (rooms' LRU); it is decoded anew on demand
//   G.pack.stats                    { files, bytes, decoded, decoding, queued, failed, firstDecodeAt, lastDecodeAt, decodeMs }
//   events: 'pack:texture' { name } after a swap, 'pack:idle' { decoded, failed } when the queue ran dry
//
// Rules (§16.0): decoding starts after the first rendered frame, at most 2 at a time, smaller `priority` first
// (0 = terrain / walls … 9 = whenever), and never on `low` (textures stay placeholders; G.mat does not even ask).
// A decode failure is a G.log.warn and a kept placeholder — never a console.error.
//
// Encodings the recipe (assets/pack/src/make_pack.py) uses:
//   normal maps  enc 'xy': a greyscale image, left half = X, right half = Y (OpenGL, Y+); Z is rebuilt here. Lossy
//                WebP subsamples chroma, which would destroy an RGB normal map; no colour-space conversion anywhere.
//   sky HDRIs    enc 'rgbe-split': left half = RGB mantissa, right half = exponent + 128; value = (rgb + 0.5) / 256 · 2^(E − 128)
// Decoded images stay referenced (ImageBitmap / ImageData), so three.js re-uploads them after a WebGL context loss.
// =============================================================================
(function () {
  const files = new Map();      // canonical name → record
  const aliases = new Map();    // alias → canonical name
  const texCache = new Map();   // name + sampler options → THREE.Texture
  const stats = { files: 0, bytes: 0, decoded: 0, decoding: 0, queued: 0, failed: 0, firstDecodeAt: 0, lastDecodeAt: 0, decodeMs: 0 };
  const MAX_ACTIVE = 2;
  const KIND_TEXEL = { color: [128, 128, 128, 255], normal: [128, 128, 255, 255], rough: [255, 255, 255, 255], art: [214, 202, 176, 255], sky: [150, 172, 204, 255], alpha: [128, 128, 128, 0], noise: [128, 128, 128, 255] };
  const SRGB_KINDS = { color: 1, art: 1, alpha: 1 };
  const REPEAT_KINDS = { color: 1, normal: 1, rough: 1, noise: 1 };
  let scanned = false, started = false, seq = 0, active = 0;
  let flipOK = null, noisy = null, scratch = null, warnedLow = false;
  const queue = [];
  const idleWaiters = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const warn = (...a) => { try { G.log.warn('PACK', ...a); } catch (e) { /* logging is optional */ } };

  // ---------------------------------------------------------------- the blocks
  function scan() {
    if (scanned || typeof document === 'undefined') return scanned;
    const man = document.getElementById('pack-manifest');
    if (!man && document.readyState === 'loading') return false;   // the parser has not reached the blocks yet
    scanned = true;
    if (!man) return true;                                          // a --no-assets build
    let list = [];
    try { list = JSON.parse(man.textContent || '{}').files || []; } catch (e) { warn('manifest block is not valid JSON', e?.message || e); }
    const blocks = new Map();
    for (const el of document.querySelectorAll('script[data-pack]')) blocks.set(el.getAttribute('data-pack'), el);
    for (const m of list) {
      if (!m || typeof m.name !== 'string' || !blocks.has(m.name)) continue;
      const el = blocks.get(m.name);
      const meta = Object.freeze({ ...m, mime: m.mime || el.getAttribute('data-mime') || 'image/webp' });
      files.set(m.name, { name: m.name, meta, el, blob: null, url: '', tex: null, img: null, hdr: null });
      for (const a of m.alias || []) aliases.set(a, m.name);
      stats.files++; stats.bytes += m.bytes | 0;
    }
    return true;
  }
  const rec = (name) => { scan(); return files.get(name) || files.get(aliases.get(name)) || null; };

  function quality() {
    const e = G.sys && G.sys.engine;
    if (e && e.quality) return e.quality;
    const q = (G.flags && G.flags.quality) || (G.settings && G.settings.quality);
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  }
  const lowNow = () => quality() === 'low';
  const webglOK = () => !G.unsupported && !(G.sys && G.sys.engine && G.sys.engine.renderer === null);

  function getBlob(r) {
    if (r.blob) return r.blob;
    if (!r.el) return null;
    try {
      const bin = atob(r.el.textContent.trim());
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      r.blob = new Blob([u8], { type: r.meta.mime });
      r.el.textContent = '';              // the base64 text is not needed twice (frees ~1.33× the file size)
    } catch (e) { warn(`${r.name}: the data block cannot be read`, e?.message || e); r.blob = null; }
    return r.blob;
  }

  // ---------------------------------------------------------------- decoding helpers
  function scratchCtx(w, h) {
    if (typeof document === 'undefined') return null;
    if (!scratch) { scratch = document.createElement('canvas'); scratch._ctx = scratch.getContext('2d', { willReadFrequently: true }); }
    const ctx = scratch._ctx;
    if (!ctx) return null;
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    else ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  /** RGBA pixels of an image source (upright), or null without a 2D canvas */
  function readPixels(src, w, h) {
    const ctx = scratchCtx(w, h);
    if (!ctx) return null;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(src, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }
  /** privacy browsers add noise to canvas read-backs: the HDR exponent plane must then be cleaned (see despeckle) */
  function canvasNoisy() {
    if (noisy !== null) return noisy;
    noisy = false;
    try {
      const n = 16, src = new Uint8ClampedArray(n * n * 4);
      for (let i = 0; i < src.length; i++) src[i] = (i & 3) === 3 ? 255 : (i * 37 + 11) & 255;
      const ctx = scratchCtx(n, n);
      if (!ctx) return noisy;
      ctx.putImageData(new ImageData(src, n, n), 0, 0);
      const back = ctx.getImageData(0, 0, n, n).data;
      for (let i = 0; i < src.length; i++) if (back[i] !== src[i]) { noisy = true; break; }
    } catch (e) { noisy = false; }
    return noisy;
  }
  const BMP_TEX = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const BMP_RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  /** does createImageBitmap honour imageOrientation: 'flipY'? (WebGL ignores UNPACK_FLIP_Y for an ImageBitmap) */
  async function flipSupported() {
    if (flipOK !== null) return flipOK;
    flipOK = false;
    try {
      if (typeof createImageBitmap !== 'function') return flipOK;
      const d = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 1, 2);   // red over blue
      const b = await createImageBitmap(d, BMP_TEX);
      const px = readPixels(b, 1, 2);
      try { b.close(); } catch (e) { /* older engines */ }
      flipOK = !!px && px.data[2] > 200 && px.data[0] < 60;                                    // blue is on top now
    } catch (e) { flipOK = false; }
    return flipOK;
  }
  function htmlImage(r) {
    return new Promise((resolve, reject) => {
      const blob = getBlob(r);
      if (!blob) { reject(new Error('no data')); return; }
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('the image cannot be decoded'));
      img.src = urlOf(r);
    });
  }
  function urlOf(r) {
    if (!r.url) { const b = getBlob(r); r.url = b ? URL.createObjectURL(b) : ''; }
    return r.url;
  }
  /** upright, raw pixels (no premultiplication, no colour conversion) */
  async function rawBitmap(r) {
    const blob = getBlob(r);
    if (!blob) throw new Error('no data');
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, BMP_RAW); } catch (e) { /* options not supported: plain call below */ }
      try { return await createImageBitmap(blob); } catch (e) { /* fall through to the Image element */ }
    }
    return htmlImage(r);
  }
  /** 'xy' greyscale halves → an RGBA normal map (ImageData, upright; the texture uploads it with flipY) */
  function xyToNormal(px, w, h) {
    const src = px.data, W2 = px.width, out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      let i = y * W2 * 4, j = i + w * 4, o = y * w * 4;
      for (let x = 0; x < w; x++, i += 4, j += 4, o += 4) {
        const nx = src[i] / 127.5 - 1, ny = src[j] / 127.5 - 1, z2 = 1 - nx * nx - ny * ny;
        out[o] = src[i]; out[o + 1] = src[j]; out[o + 2] = z2 > 0 ? Math.round(Math.sqrt(z2) * 127.5 + 127.5) : 128; out[o + 3] = 255;
      }
    }
    return new ImageData(out, w, h);
  }
  /** RGB floats: a texel whose luminance is far off the median of its 3×3 neighbourhood is scaled back to it */
  function despeckle(f, w, h) {
    const L = new Float32Array(w * h), m = new Float32Array(9);
    for (let i = 0, k = 0; i < L.length; i++, k += 3) L[i] = 0.2126 * f[k] + 0.7152 * f[k + 1] + 0.0722 * f[k + 2];
    let fixed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -1; dx <= 1; dx++) m[n++] = L[yy * w + ((x + dx + w) % w)]; }
      const s = Array.prototype.slice.call(m).sort((a, b) => a - b), med = s[4], v = L[y * w + x];
      if (med > 1e-6 && v > 1e-6 && (v > med * 1.9 || v < med / 1.9)) { const k = (y * w + x) * 3, g = med / v; f[k] *= g; f[k + 1] *= g; f[k + 2] *= g; fixed++; }
    }
    return fixed;
  }
  /** 'rgbe-split' pixels → half-float RGBA, rows bottom-to-top */
  function rgbeToHalf(px, w, h, clean) {
    const src = px.data, W2 = px.width, f = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      let i = y * W2 * 4, e = i + w * 4, o = y * w * 3;
      for (let x = 0; x < w; x++, i += 4, e += 4, o += 3) {
        const s = Math.pow(2, src[e] - 128) / 256;
        f[o] = (src[i] + 0.5) * s; f[o + 1] = (src[i + 1] + 0.5) * s; f[o + 2] = (src[i + 2] + 0.5) * s;
      }
    }
    if (clean) despeckle(f, w, h);
    const toHalf = THREE.DataUtils.toHalfFloat, out = new Uint16Array(w * h * 4), one = toHalf(1);
    for (let y = 0; y < h; y++) {
      let o = (h - 1 - y) * w * 4, k = y * w * 3;
      for (let x = 0; x < w; x++, o += 4, k += 3) {
        out[o] = toHalf(Math.min(f[k], 65000)); out[o + 1] = toHalf(Math.min(f[k + 1], 65000)); out[o + 2] = toHalf(Math.min(f[k + 2], 65000)); out[o + 3] = one;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- the queue
  function enqueue(r, kind, priority, force, run) {
    return new Promise((resolve) => {
      queue.push({ r, kind, pr: Number.isFinite(priority) ? priority : 5, seq: seq++, force: !!force, run, resolve });
      stats.queued = queue.length;
      pump();
    });
  }
  // ?packhold=1 (tests): the queue waits until G.pack.hold(false) — the frame with placeholders can be looked at
  let held = false;
  try { held = !!(G.params && G.params.get('packhold') === '1'); } catch (e) { held = false; }
  stats.held = held;
  function runnable(job) { return job.force || (started && !held && !lowNow()); }
  function pump() {
    while (active < MAX_ACTIVE) {
      let best = -1;
      for (let i = 0; i < queue.length; i++) {
        const j = queue[i];
        if (!runnable(j)) continue;
        if (best < 0 || j.pr < queue[best].pr || (j.pr === queue[best].pr && j.seq < queue[best].seq)) best = i;
      }
      if (best < 0) break;
      const job = queue.splice(best, 1)[0];
      stats.queued = queue.length;
      active++; stats.decoding = active;
      const t0 = now();
      Promise.resolve().then(job.run).then((v) => {
        stats.decoded++; stats.lastDecodeAt = now(); if (!stats.firstDecodeAt) stats.firstDecodeAt = stats.lastDecodeAt;
        stats.decodeMs += now() - t0;
        return v;
      }, (e) => { stats.failed++; warn(`${job.r.name}: decode failed — the placeholder stays`, e?.message || e); return null; })
        .then((v) => { active--; stats.decoding = active; job.resolve(v); pump(); });
    }
    if (!active && !queue.some(runnable)) {
      if (lowNow() && queue.length && !warnedLow) { warnedLow = true; try { G.log.info('PACK', `quality low: ${queue.length} pack image(s) stay placeholders`); } catch (e) { /* optional */ } }
      const w = idleWaiters.splice(0);
      for (const fn of w) fn();
      if (w.length || stats.decoded) { try { G.bus.emit('pack:idle', { decoded: stats.decoded, failed: stats.failed }); } catch (e) { /* bus optional */ } }
    }
  }
  /** decoding may start: the first frame is on screen (or nothing will ever render: 2D-only mode, hidden tab) */
  function start() { if (started) return; started = true; pump(); }
  function armStart() {
    let n = 0;
    const tick = () => {
      if (started) return;
      if ((G.time && G.time.frame >= 2) || ++n > 3600) { start(); return; }
      requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    setTimeout(start, 45000);      // rAF never fires in a hidden tab: start anyway
  }

  // ---------------------------------------------------------------- textures
  function texelOf(meta, kind) {
    if (meta && meta.kind === 'color' && Array.isArray(meta.avg)) return [meta.avg[0], meta.avg[1], meta.avg[2], 255];
    if (meta && meta.kind === 'rough' && Number.isFinite(meta.avg)) return [meta.avg, meta.avg, meta.avg, 255];
    return KIND_TEXEL[(meta && meta.kind) || kind] || KIND_TEXEL.color;
  }
  function placeholder(texel) {
    if (typeof ImageData === 'function') return new ImageData(new Uint8ClampedArray(texel), 1, 1);
    return { data: new Uint8Array(texel), width: 1, height: 1 };
  }
  const WRAP = () => ({ repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping });
  function makeTexture(image, kind, o, source) {
    const t = new THREE.Texture(image);
    if (source) t.source = source;
    t.colorSpace = (o.srgb != null ? o.srgb : !!SRGB_KINDS[kind]) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrap = WRAP()[o.wrap] || (REPEAT_KINDS[kind] ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    t.wrapS = t.wrapT = wrap;
    if (Array.isArray(o.repeat)) t.repeat.set(+o.repeat[0] || 1, +o.repeat[1] || 1);
    if (Array.isArray(o.offset)) t.offset.set(+o.offset[0] || 0, +o.offset[1] || 0);
    if (Number.isFinite(o.rotation)) t.rotation = o.rotation;
    t.anisotropy = Number.isFinite(o.anisotropy) ? o.anisotropy : 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }
  async function decodeTexture(r) {
    const meta = r.meta;
    if (meta.enc === 'xy') {
      const bmp = await rawBitmap(r);
      const px = readPixels(bmp, meta.w * 2, meta.h);
      try { bmp.close && bmp.close(); } catch (e) { /* an Image element has no close() */ }
      if (!px) throw new Error('no 2D canvas to rebuild the normal map');
      return { image: xyToNormal(px, meta.w, meta.h), flipY: true };
    }
    if (await flipSupported()) {
      const blob = getBlob(r);
      if (!blob) throw new Error('no data');
      try { return { image: await createImageBitmap(blob, BMP_TEX), flipY: false }; } catch (e) { /* the Image element below */ }
    }
    return { image: await htmlImage(r), flipY: true };
  }
  /** swap the decoded image into every Texture of the record (dispose first: the 1×1 storage is immutable) */
  function applyDecoded(r, dec) {
    const tx = r.tex;
    if (!tx || !dec) return;
    for (const t of tx.list) t.dispose();
    tx.source.data = dec.image;
    tx.flipY = dec.flipY; tx.state = 'ready';
    for (const t of tx.list) {
      t.flipY = dec.flipY; t.needsUpdate = true;
      t.userData.pack.ready = true;
    }
    try { G.bus.emit('pack:texture', { name: r.name }); } catch (e) { /* bus optional */ }
    for (const t of tx.list) { const cb = t.userData.pack.onLoad; if (cb) { t.userData.pack.onLoad = null; try { cb(t); } catch (e) { warn(`${r.name}: onLoad threw`, e?.message || e); } } }
  }
  function wantTexture(r, priority) {
    const tx = r.tex;
    if (tx.state !== 'idle') return;
    tx.state = 'queued';
    enqueue(r, 'tex', priority, false, () => decodeTexture(r)).then((dec) => {
      if (!dec) { tx.state = 'failed'; for (const t of tx.list) t.userData.pack.failed = true; return; }
      if (tx.state !== 'queued') { try { dec.image.close && dec.image.close(); } catch (e) { /* unloaded meanwhile */ } return; }
      applyDecoded(r, dec);
    });
  }

  const pack = {
    stats,
    get count() { scan(); return files.size; },
    has(name) { return !!rec(name); },
    usable(name) { return !!rec(name) && !lowNow() && webglOK(); },
    names(prefix = '') { scan(); return [...files.keys()].filter((n) => n.startsWith(prefix)); },
    meta(name) { const r = rec(name); return r ? r.meta : null; },
    blob(name) { const r = rec(name); return r ? getBlob(r) : null; },
    url(name) { const r = rec(name); return r ? urlOf(r) : ''; },

    image(name, opts = {}) {
      const r = rec(name);
      if (!r) return Promise.resolve(null);
      if (lowNow() && !opts.force) return Promise.resolve(null);
      if (!r.img) {
        r.img = enqueue(r, 'img', opts.priority ?? 6, opts.force, async () => {
          const blob = getBlob(r);
          if (!blob) throw new Error('no data');
          if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(blob); } catch (e) { /* the Image element below */ } }
          return htmlImage(r);
        }).then((v) => { if (!v) r.img = null; return v; });
      }
      return r.img;
    },

    texture(name, opts = {}) {
      const r = rec(name);
      const kind = (r && r.meta.kind) || opts.kind || 'color';
      const key = `${r ? r.name : '?' + name}|${opts.srgb ?? ''}|${opts.wrap || ''}|${Array.isArray(opts.repeat) ? opts.repeat.join(',') : ''}|${Array.isArray(opts.offset) ? opts.offset.join(',') : ''}|${opts.rotation || 0}|${opts.anisotropy ?? ''}`;
      let t = texCache.get(key);
      if (t) { if (r && r.tex.state === 'idle' && !lowNow()) wantTexture(r, opts.priority); return t; }
      if (!r) {
        // not in this page (a --no-assets build, a typo): a neutral texel, so the material still renders
        t = makeTexture(placeholder(texelOf(null, kind)), kind, opts, null);
        t.userData.pack = { name, ready: false, failed: false, missing: true, onLoad: null };
        texCache.set(key, t);
        return t;
      }
      if (!r.tex) r.tex = { state: 'idle', source: null, list: [], flipY: true };
      const tx = r.tex;
      t = makeTexture(tx.source ? tx.source.data : placeholder(texelOf(r.meta, kind)), kind, opts, tx.source);
      if (!tx.source) tx.source = t.source;
      t.flipY = tx.flipY;
      t.userData.pack = { name: r.name, ready: tx.state === 'ready', failed: tx.state === 'failed', missing: false, onLoad: null };
      tx.list.push(t);
      texCache.set(key, t);
      if (tx.state === 'ready') { if (opts.onLoad) { try { opts.onLoad(t); } catch (e) { warn(`${r.name}: onLoad threw`, e?.message || e); } } }
      else {
        if (opts.onLoad) t.userData.pack.onLoad = opts.onLoad;
        if (!lowNow()) wantTexture(r, opts.priority);
      }
      return t;
    },

    hdr(name, opts = {}) {
      const r = rec(name);
      if (!r || r.meta.enc !== 'rgbe-split') return Promise.resolve(null);
      if (lowNow() && !opts.force) return Promise.resolve(null);
      if (!r.hdr) {
        r.hdr = enqueue(r, 'hdr', opts.priority ?? 2, opts.force, async () => {
          const bmp = await rawBitmap(r);
          const px = readPixels(bmp, r.meta.w * 2, r.meta.h);
          try { bmp.close && bmp.close(); } catch (e) { /* an Image element has no close() */ }
          if (!px) throw new Error('no 2D canvas to read the HDR image');
          return { data: rgbeToHalf(px, r.meta.w, r.meta.h, canvasNoisy()), w: r.meta.w, h: r.meta.h, meta: r.meta };
        }).then((v) => { if (!v) r.hdr = null; return v; });
      }
      return r.hdr;
    },

    credits() {
      scan();
      return [...files.values()].map(({ meta: m }) => ({ name: m.name, kind: m.kind, title: m.title, titleKo: m.titleKo || null, credit: m.credit, license: m.license, source: m.source, artist: m.artist || null, date: m.date || null }));
    },

    /** hold(true): non-forced decodes wait (textures stay placeholders); hold(false) lets the queue run. → held? */
    hold(on) {
      if (on !== undefined) { held = !!on; stats.held = held; if (!held) pump(); }
      return held;
    },

    idle() {
      return new Promise((resolve) => {
        const check = () => { if (started && !active && !queue.some(runnable)) resolve(pack.stats); else { idleWaiters.push(check); if (started) pump(); } };
        if (started) check(); else { idleWaiters.push(check); }
      });
    },

    unload(name) {
      const r = rec(name);
      if (!r) return false;
      if (r.img) { r.img.then((b) => { try { b && b.close && b.close(); } catch (e) { /* an Image element has no close() */ } }); r.img = null; }
      r.hdr = null;
      const tx = r.tex;
      if (!tx || !tx.source) return true;
      const old = tx.source.data;
      for (const t of tx.list) t.dispose();
      tx.source.data = placeholder(texelOf(r.meta, r.meta.kind));
      tx.state = 'idle';
      for (const t of tx.list) { t.needsUpdate = true; t.userData.pack.ready = false; }
      try { old && old.close && old.close(); } catch (e) { /* not an ImageBitmap */ }
      return true;
    },

    /** ask again for every placeholder texture (the quality went up from `low`, a failed decode is retried) */
    refresh() {
      for (const r of files.values()) {
        if (r.tex && (r.tex.state === 'idle' || r.tex.state === 'failed') && r.tex.list.length && !lowNow()) { r.tex.state = 'idle'; wantTexture(r, 5); }
      }
      pump();
    },

    // internals the developer centre's self-tests exercise
    _xyToNormal: xyToNormal, _rgbeToHalf: rgbeToHalf, _despeckle: despeckle, _started: () => started, _flipSupported: flipSupported,
  };
  pack.ready = new Promise((resolve) => {
    const done = () => { scan(); armStart(); resolve(pack); };
    if (typeof document === 'undefined') { scanned = true; resolve(pack); }
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', done, { once: true });
    else done();
  });
  G.pack = pack;
  // a quality change may unlock the queue (low → medium / high) — nothing is decoded while the preset is `low`
  try { G.bus.on('engine:quality', () => pack.refresh()); } catch (e) { /* bus missing in an isolated build */ }
})();
