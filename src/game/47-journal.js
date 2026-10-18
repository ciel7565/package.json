// =============================================================================
// 47-journal.js — work journal (G.sys.journal, order 66). Hotkey J, action 'journal'.
//
//   open({prefill})   form: 날짜 · 지역 (current zone) · 작업 chips (auto from G.state.activity, last 2 h) ·
//                     수확물 (recent harvests) · 발효 상태 (my jar J1) · 배운 내용 (+ recent lessons) · 느낀 점 ·
//                     사진 (pick from G.state.photos or upload png/jpeg/webp ≤ 5 MB -> ≤ 480 px JPEG thumbnail;
//                     server mode uploads it to journal/upload.php and stores the returned url)
//   openList()        cards newest first, zone filter, detail view, delete with confirm
//   openDetail(id) / create(entry) -> entry | null / remove(id) / get(id) / list() / count()
// Emits journal:created {entry} (progression counts it, quests advance). Required: 작업 or 배운 내용 (or a mood).
// 쉬운 모드 (CONTRACT §12, default) = "그림일기": ① mood face (😊😐😢😮😴) ② up to 5 stickers (today's activities are
//   pre-picked ✨) ③ optional photo from the in-game album (no file upload, no typing) -> "📝 다 썼어요!" saves; a live
//   diary page previews it. The list is a 일기장 of big picture pages; delete asks a picture confirm. Entries keep the
//   same validated shape (+ `mood` id), so adult and kid entries show in both looks. Normal mode is unchanged.
// =============================================================================
(function () {
  const U = G.util;
  const esc = U.escapeHtml;
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const THUMB_MAX = 480;
  const RECENT_MS = 2 * 60 * 60 * 1000;
  const MAX_ENTRIES = 300;
  const LIMIT = { note: 200, harvest: 200, ferment: 200, learned: 1000, memo: 1000 };
  const ALLOWED_MIME = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  const MODAL_IDS = ['journal-form', 'journal-list', 'journal-detail'];

  /** task chips; `types` = activity types (G.activity) that auto-select the chip */
  const TASKS = [
    { id: 'water', label: '물주기', icon: '💧', types: ['water'] },
    { id: 'plant', label: '씨앗 심기', icon: '🌱', types: ['plant', 'farm'] },
    { id: 'harvest', label: '수확', icon: '🧺', types: ['harvest'] },
    { id: 'ferment_check', label: '발효 확인', icon: '🔍', types: ['ferment_check'] },
    { id: 'ferment', label: '장독 관리', icon: '🏺', types: ['ferment'] },
    { id: 'craft', label: '재료 만들기', icon: '🛠️', types: ['craft'] },
    { id: 'edu', label: '교육', icon: '📖', types: ['edu', 'exhibit'] },
    { id: 'quiz', label: '퀴즈', icon: '✏️', types: ['quiz'] },
    { id: 'photo', label: '사진', icon: '📷', types: ['photo'] },
    { id: 'talk', label: 'NPC 대화', icon: '💬', types: ['talk', 'npc'] },
    { id: 'tour', label: '둘러보기', icon: '🧭', types: ['visit'] },
    { id: 'shop', label: '매점', icon: '🛒', types: ['shop'] },
  ];
  const TASK = Object.fromEntries(TASKS.map((t) => [t.id, t]));
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  // ---- 쉬운 모드 (그림일기)
  const MOODS = [
    { id: 'happy', emoji: '😊', label: '기뻐요', color: '#ffc93c' },
    { id: 'calm', emoji: '😐', label: '그냥 그래요', color: '#9ad0ff' },
    { id: 'sad', emoji: '😢', label: '슬퍼요', color: '#8fb4ff' },
    { id: 'wow', emoji: '😮', label: '놀라워요', color: '#ff9f43' },
    { id: 'sleepy', emoji: '😴', label: '졸려요', color: '#b48bff' },
  ];
  const MOOD = Object.fromEntries(MOODS.map((m) => [m.id, m]));
  const MAX_STICKERS = 5;
  /** short kid labels for the sticker chips (same ids as TASKS) */
  const KID_TASK = { water: '물 주기', plant: '씨앗 심기', harvest: '채소 거두기', ferment_check: '장독 보기', ferment: '장 담그기', craft: '만들기', edu: '그림 이야기', quiz: '퀴즈', photo: '사진 찍기', talk: '이야기', tour: '구경하기', shop: '가게' };
  const STICKER_COLOR = { water: '#4fb3ff', plant: '#55d187', harvest: '#8fd14f', ferment_check: '#ffc93c', ferment: '#ff9f43', craft: '#d3a46a', edu: '#b48bff', quiz: '#ff7eb6', photo: '#36cfc0', talk: '#6c8cff', tour: '#ffd166', shop: '#ff8a5c' };
  const easyOn = () => !!(G.easy && G.easy.on);
  const kidSay = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };
  function kidDate(iso) {
    if (!validISO(iso)) return String(iso || '');
    const [y, m, d] = iso.split('-').map(Number);
    return `${m}월 ${d}일 ${WEEK[new Date(y, m - 1, d).getDay()]}요일`;
  }

  // ---------------------------------------------------------------- helpers
  const h = (...a) => G.ui.h(...a);
  const pad = (n) => String(n).padStart(2, '0');
  function todayISO(ts = G.time.now()) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function validISO(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false; const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; }
  function fmtDate(iso, withWeek = true) {
    if (!validISO(iso)) return String(iso || '');
    const [y, m, d] = iso.split('-').map(Number);
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return `${y}.${pad(m)}.${pad(d)}${withWeek ? ` (${w})` : ''}`;
  }
  function zones() { const list = (G.data.zones || []).slice(); if (G.data.defaultZone) list.push(G.data.defaultZone); return list; }
  function zoneOf(id) { return zones().find((z) => z.id === id) || null; }
  function currentZoneId() {
    const mm = G.sys.minimap?.currentZone?.id;
    if (mm && zoneOf(mm)) return mm;
    const st = G.state?.player?.zoneId;
    if (st && zoneOf(st)) return st;
    const p = G.sys.player?.position;
    if (p && G.world?.zoneAt) return G.world.zoneAt(p.x, p.z)?.id || 'ZONE_MAIN';
    return 'ZONE_MAIN';
  }
  function clip(s, n) { s = String(s ?? '').replace(/\r\n?/g, '\n').trim(); return s.length > n ? s.slice(0, n) : s; }
  /** only images we produced or an http(s)/relative upload url */
  function safeSrc(src) {
    src = String(src || '');
    if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(src)) return src;
    if (/^(https?:\/\/|\/|\.\/|[\w-]+\/)[^\s"'<>]*$/i.test(src) && !/^javascript:/i.test(src) && !/\.\./.test(src)) return src;
    return null;
  }
  function recentActivity(ms = RECENT_MS) {
    const now = G.time.now();
    return (G.state?.activity || []).filter((a) => a && typeof a === 'object' && now - (Number(a.t) || 0) <= ms);
  }
  /** log an activity unless the owner module already logged the same thing a moment ago */
  function logSoon(type, text, extra, key) {
    setTimeout(() => {
      if (!G.state) return;
      const list = G.state.activity || [];
      const now = G.time.now();
      for (let i = list.length - 1; i >= 0 && i >= list.length - 8; i--) {
        const a = list[i];
        if (!a || now - (a.t || 0) > 6000) break;
        if (a.type === type && (!key || a[key] === extra?.[key])) return;
      }
      G.activity(type, text, extra);
    }, 0);
  }
  function sniff(b) {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  function readHead(file) {
    if (file.slice && typeof file.slice(0, 1).arrayBuffer === 'function') return file.slice(0, 12).arrayBuffer().then((ab) => new Uint8Array(ab));
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(new Uint8Array(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(file.slice(0, 12)); });
  }
  function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).then((bmp) => ({ src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close?.() }));
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  /** validate + decode + resize to a ≤480 px JPEG (q 0.8). -> {dataUrl, blob, width, height} ; throws Error(korean message) */
  async function processPhoto(file) {
    if (!file) throw new Error('사진 파일을 선택해 주세요.');
    const name = String(file.name || '').toLowerCase();
    const kind = ALLOWED_MIME[file.type];
    if (!kind || !/\.(png|jpe?g|webp)$/.test(name)) throw new Error('PNG, JPG, WEBP 형식의 사진만 올릴 수 있어요.');
    if (file.size > MAX_PHOTO_BYTES) throw new Error(`사진 용량은 5MB 이하여야 해요. (선택한 파일 ${Math.max(5.01, file.size / 1048576).toFixed(file.size < 10485760 ? 2 : 1)}MB)`);
    if (file.size < 24) throw new Error('사진 파일이 비어 있거나 손상된 것 같아요.');
    let sig = null;
    try { sig = sniff(await readHead(file)); } catch (e) { sig = null; }
    if (!sig) throw new Error('사진 파일의 형식을 확인할 수 없어요. 다른 사진을 골라 주세요.');
    if (sig !== kind) throw new Error('파일 확장자와 실제 사진 형식이 달라요. 다른 사진을 골라 주세요.');
    let img;
    try { img = await decodeImage(file); } catch (e) { throw new Error('사진을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.'); }
    try {
      if (!img.w || !img.h) throw new Error('사진 크기를 확인할 수 없어요.');
      if (img.w * img.h > 60e6) throw new Error('사진 해상도가 너무 커요. 더 작은 사진을 골라 주세요.');
      const s = Math.min(1, THUMB_MAX / Math.max(img.w, img.h));
      const w = Math.max(1, Math.round(img.w * s)), hh = Math.max(1, Math.round(img.h * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, hh); // flatten transparency for JPEG
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.src, 0, 0, w, hh);
      const dataUrl = c.toDataURL('image/jpeg', 0.8);
      if (!/^data:image\/jpeg;base64,/.test(dataUrl)) throw new Error('사진을 변환하지 못했어요.');
      return { dataUrl, width: w, height: hh };
    } finally { try { img.close?.(); } catch (e) { /* ignore */ } }
  }
  /** JPEG data URL -> Blob (synchronous; canvas.toBlob can be very slow on some devices) */
  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const bin = atob(m[2]);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: m[1] });
  }
  async function uploadPhoto(dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) throw new Error('사진 데이터가 올바르지 않아요.');
    const form = new FormData();
    form.append('photo', blob, `journal_${Date.now().toString(36)}.jpg`);
    const res = await G.net.request('journal/upload.php', { form, timeout: 20000 });
    const url = typeof res === 'string' ? res : (res?.url || res?.path || res?.photo?.url || res?.file?.url || null);
    if (!url || !safeSrc(url)) throw new Error('업로드 응답이 올바르지 않아요.');
    return url;
  }

  // ---------------------------------------------------------------- auto-fill sources
  function autoTasks() {
    const counts = {};
    for (const a of recentActivity()) for (const t of TASKS) if (t.types.includes(a.type)) counts[t.id] = (counts[t.id] || 0) + 1;
    return counts;
  }
  function autoHarvest() {
    const sum = new Map();
    for (const a of recentActivity()) {
      if (!a.itemId || !(a.qty > 0)) continue;
      if (a.type !== 'harvest' && !(a.type === 'ferment' && a.recipeId)) continue;
      sum.set(a.itemId, (sum.get(a.itemId) || 0) + Number(a.qty));
    }
    return [...sum].map(([id, q]) => `${G.data.items?.[id]?.name || id} ×${q}`).join(' · ');
  }
  function autoFerment() {
    const F = G.sys.fermentation;
    let j = null;
    try { j = F?.getJar?.('J1'); } catch (e) { j = null; }
    if (j) {
      const recipe = j.recipe || (j.recipeId && G.data.recipes?.[j.recipeId]) || null;
      const name = j.statusName || G.data.jarStateNames?.[j.status] || j.status || '';
      if (!recipe || j.status === 'EMPTY') return `내 장독: ${name || '비어 있음'}`;
      const parts = [];
      if (j.status === 'COMPLETE') parts.push(`${recipe.name} 완성! 수령을 기다리는 중`);
      else if (j.status === 'CLAIMED') parts.push(`${recipe.name} 수령 완료`);
      else parts.push(`${recipe.name} · ${name}${Number.isFinite(j.progress) ? ` ${Math.round(j.progress)}%` : ''}`);
      if (j.quality) parts.push(`품질 ${Math.round(j.quality)}점${j.grade ? `(${j.grade})` : ''}`);
      if (j.status !== 'COMPLETE' && j.status !== 'CLAIMED' && Number.isFinite(j.temp) && Number.isFinite(j.humidity)) parts.push(`${Math.round(j.temp)}°C · 습도 ${Math.round(j.humidity)}%`);
      return parts.join(' · ');
    }
    const s = G.state?.jars?.J1;
    if (s && s.recipeId) {
      const r = G.data.recipes?.[s.recipeId];
      return `${r?.name || '발효'} · ${G.data.jarStateNames?.[s.status] || s.status || ''}${Number.isFinite(s.progress) ? ` · 진행 ${Math.round(s.progress)}%` : ''}`;
    }
    return '';
  }
  /** recent lessons for the 배운 내용 helper: [{key, label, text}] */
  function lessonSuggestions() {
    const out = [];
    const seen = new Set();
    const list = recentActivity().slice().reverse();
    for (const a of list) {
      if (a.eduId && !seen.has('e:' + a.eduId)) {
        const e = G.data.education?.[a.eduId];
        if (e) { seen.add('e:' + a.eduId); out.push({ key: 'e:' + a.eduId, label: `${e.icon || '📖'} ${e.title}`, text: `「${e.title}」 ${e.summary || ''}`.trim() }); }
      }
      if (a.type === 'quiz' && a.correct && a.quizId && !seen.has('q:' + a.quizId)) {
        const q = G.data.quizzes?.[a.quizId];
        if (q) { seen.add('q:' + a.quizId); out.push({ key: 'q:' + a.quizId, label: '✏️ 퀴즈 정답', text: `퀴즈 「${q.question}」의 답은 ‘${q.choices[q.answer]}’. ${q.explain || ''}`.trim() }); }
      }
      if (out.length >= 6) break;
    }
    return out;
  }
  function recentPhotos(n = 10) {
    const list = Array.isArray(G.state?.photos) ? G.state.photos.filter((p) => p && safeSrc(p.thumb || p.url)) : [];
    return list.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, n);
  }
  /** thumbnail of the in-game album photo `id` (G.state.photos) or null */
  function albumThumb(id) {
    if (!id || !Array.isArray(G.state?.photos)) return null;
    const p = G.state.photos.find((x) => x && x.id === id);
    return p ? safeSrc(p.thumb || p.url) : null;
  }
  // Album photos are referenced by photoId instead of being copied into every entry: a 384 px thumbnail is ~30–40 KB,
  // so ~30 copies used to push the save past the server's 1.5 MB limit (every later save was refused). Entries keep
  // their own copy only for uploads, or when the album no longer has the photo — and those copies share a budget.
  const PHOTO_BUDGET = 320000;   // chars of photo copies kept inside diary entries (≈ 8–10 thumbnails)
  const SAVE_BASE = 80000;       // room left for the rest of the save when the budget is fitted under the server limit
  /** the picture of an entry: its own copy, else the album photo it points to (or the copy kept when the album dropped it) */
  function entryPhoto(e) {
    if (!e) return null;
    return safeSrc(e.photo) || albumThumb(e.photoId) || (e.photoId ? safeSrc(journal._refThumbs.get(e.photoId)) : null);
  }

  // =============================================================================================
  const journal = {
    name: 'journal', order: 66, label: '작업일지',
    _draft: null,
    _form: null, _list: null,
    _refThumbs: new Map(),   // photoId -> album thumbnail an entry points to (copied back in if the album drops it)

    init() {
      G.ui.onAction('journal', () => this.open());
      G.input?.onKey?.('KeyJ', () => { if (!G.state) return false; this.open(); return true; });
      // record activities the owner modules do not log themselves (deduped, deferred)
      G.bus.on('ferment:checked', (p) => logSoon('ferment_check', '내 장독 발효 상태 확인', { jarId: p?.jarId || 'J1' }, 'jarId'));
      G.bus.on('photo:taken', (p) => logSoon('photo', '사진 촬영', { photoId: p?.photoId, photoZoneId: p?.photoZoneId }, 'photoId'));
      G.bus.on('npc:talk', (p) => { const n = G.data.npcs?.[p?.npcId]; if (n) logSoon('talk', `${n.name}${josa(n.name, '과/와')} 대화`, { npcId: p.npcId }, 'npcId'); });
      G.bus.on('zone:enter', (p) => { if (p?.first && p.zone) logSoon('visit', `${p.zone.name} 첫 방문`, { zoneId: p.zoneId }, 'zoneId'); });
      // easy <-> normal at runtime: close the journal windows of the other look (drafts are kept)
      G.bus.on('easy:changed', () => { for (const id of MODAL_IDS) G.ui.modal.get(id)?.close(); });
      // keep the diary photos small in the save (album references, shared budget for copies)
      G.bus.on('state:before-save', (st) => { if (st && st === G.state) this._fitPhotos(); });
      G.bus.on('photo:taken', () => { if (G.state) this._fitPhotos(); }); // the album may just have dropped its oldest photo
    },
    onStateLoaded(state) {
      if (!Array.isArray(state.journal)) state.journal = [];
      this._draft = null;
      this._kidDraft = null;
      this._refThumbs.clear();
      for (const id of MODAL_IDS) G.ui.modal.get(id)?.close();
      this._fitPhotos(); // older saves copied album photos into every entry
    },
    onLogout() {
      this._draft = null;
      this._kidDraft = null;
      this._refThumbs.clear();
      for (const id of MODAL_IDS) G.ui.modal.get(id)?.close();
    },
    /** album photos are referenced (no copy); a photo the album lost is copied back in; copies share PHOTO_BUDGET
     *  (fitted under the server save limit together with the album) — the oldest copies go first */
    _fitPhotos() {
      const list = this.list();
      if (!list.length) { this._refThumbs.clear(); return; }
      const album = new Map();
      let albumChars = 0;
      for (const p of Array.isArray(G.state?.photos) ? G.state.photos : []) {
        const src = p && safeSrc(p.thumb || p.url);
        if (src) { album.set(p.id, src); albumChars += src.length; }
      }
      const refs = new Set();
      let changed = false;
      for (const e of list) {
        if (!e || !e.photoId) continue;
        refs.add(e.photoId);
        const a = album.get(e.photoId);
        if (a) {
          this._refThumbs.set(e.photoId, a);
          if (e.photo && e.photo === a) { e.photo = null; changed = true; }
        } else if (!e.photo && this._refThumbs.has(e.photoId)) { e.photo = this._refThumbs.get(e.photoId); changed = true; }
      }
      for (const id of [...this._refThumbs.keys()]) if (!refs.has(id)) this._refThumbs.delete(id);
      const limit = Number(G.data.serverLimits?.saveMaxBytes) || 1500000;
      const budget = Math.max(0, Math.min(PHOTO_BUDGET, limit * 0.85 - albumChars - SAVE_BASE));
      let used = 0, full = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e || typeof e.photo !== 'string' || !e.photo.startsWith('data:')) continue;
        if (full || used + e.photo.length > budget) { full = true; e.photo = null; changed = true; } else used += e.photo.length;
      }
      if (changed) G.log.info('UI', `journal photos fitted (${Math.round(used / 1024)} KB of copies, budget ${Math.round(budget / 1024)} KB)`);
    },
    // ------------------------------------------------------------ data API
    list() { return Array.isArray(G.state?.journal) ? G.state.journal : []; },
    count() { return this.list().length; },
    get(id) { return this.list().find((e) => e && e.id === id) || null; },
    /** normalize + store an entry. Returns the stored entry or null when invalid / logged out */
    create(entry = {}) {
      if (!G.state) return null;
      if (!Array.isArray(G.state.journal)) G.state.journal = [];
      const tasks = Array.isArray(entry.tasks) ? [...new Set(entry.tasks.filter((t) => TASK[t]))] : [];
      const note = clip(entry.note ?? '', LIMIT.note);
      const learned = clip(entry.learned, LIMIT.learned);
      const mood = typeof entry.mood === 'string' && MOOD[entry.mood] ? entry.mood : null;
      let activityText = clip(entry.activity ?? [tasks.map((t) => TASK[t].label).join(', '), note].filter(Boolean).join(' · '), LIMIT.note + 120);
      if (!activityText && mood) activityText = `오늘 기분: ${MOOD[mood].label}`;
      if (!activityText && !learned) return null;
      const zoneId = zoneOf(entry.zoneId) ? entry.zoneId : currentZoneId();
      const now = G.time.now();
      const src = safeSrc(entry.photo);
      const photoId = src && entry.photoId ? String(entry.photoId).slice(0, 64) : null;
      const album = photoId ? albumThumb(photoId) : null;
      const e = {
        id: U.uid('jr'),
        createdAt: now,
        date: validISO(entry.date) ? entry.date : todayISO(now),
        zoneId,
        zoneName: zoneOf(zoneId)?.name || '',
        tasks,
        note,
        activity: activityText,
        harvest: clip(entry.harvest, LIMIT.harvest),
        ferment: clip(entry.ferment, LIMIT.ferment),
        learned,
        memo: clip(entry.memo, LIMIT.memo),
        photo: null, photoId: null,
        eduIds: Array.isArray(entry.eduIds) ? entry.eduIds.filter((x) => G.data.education?.[x]).slice(0, 12) : [],
        mood,
      };
      // an album photo is only referenced (the album keeps the picture); anything else is stored with the entry
      if (src) { e.photo = album && album === src ? null : src; e.photoId = photoId; }
      if (album && album === src) this._refThumbs.set(photoId, album);
      G.state.journal.push(e);
      if (G.state.journal.length > MAX_ENTRIES) G.state.journal.splice(0, G.state.journal.length - MAX_ENTRIES);
      G.dirty('journal');
      G.log.info('UI', `journal entry created (${G.state.journal.length})`);
      G.bus.emit('journal:created', { entry: e });
      return e;
    },
    remove(id) {
      const list = this.list();
      const i = list.findIndex((e) => e && e.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      G.dirty('journal');
      G.bus.emit('journal:deleted', { id });
      return true;
    },

    // ------------------------------------------------------------ form
    open(opts = {}) {
      if (!G.state) { G.ui.toast('로그인 후 작업일지를 쓸 수 있어요.', { type: 'warn' }); return null; }
      if (easyOn() && !opts.normal) return this._openKid(opts);
      const pre = opts.prefill || {};
      const autoT = autoTasks();
      // "일지에 첨부" (photo card / album) only brings a photo: it joins the draft being written instead of replacing it
      const photoOnly = !!opts.prefill && Object.keys(pre).every((k) => k === 'photo' || k === 'photoId');
      const restoring = !!this._draft?.touched && (!opts.prefill || photoOnly);
      if (restoring && photoOnly && safeSrc(pre.photo)) Object.assign(this._draft, { photo: safeSrc(pre.photo), photoId: pre.photoId || null, photoSource: 'prefill' });
      const d = restoring ? this._draft : {
        date: validISO(pre.date) ? pre.date : todayISO(),
        zoneId: zoneOf(pre.zoneId) ? pre.zoneId : currentZoneId(),
        tasks: Array.isArray(pre.tasks) ? pre.tasks.filter((t) => TASK[t]) : Object.keys(autoT),
        note: pre.note || '',
        harvest: pre.harvest ?? autoHarvest(),
        ferment: pre.ferment ?? autoFerment(),
        learned: pre.learned || '',
        memo: pre.memo || '',
        photo: safeSrc(pre.photo) || null, photoId: pre.photoId || null, photoSource: pre.photo ? 'prefill' : null,
        eduIds: [],
      };
      this._draft = d;
      const ctx = { d, autoT, busy: false };
      const head = h('div', { class: 'jr-switch seg', role: 'tablist' });
      head.innerHTML = `<button type="button" class="active" aria-selected="true">✏️ 일지 쓰기</button><button type="button" data-jr-list>📚 지난 일지 <b>${this.count()}</b></button>`;
      head.querySelector('[data-jr-list]').addEventListener('click', () => { ctx.m.close(); this.openList(); });
      const m = G.ui.modal.open({
        id: 'journal-form', size: 'xl', className: 'journal-modal', title: '작업일지', icon: '📝', headExtra: head,
        autofocus: false,
        onClose: () => { if (this._form === ctx) this._form = null; },
      });
      ctx.m = m;
      this._form = ctx;
      this._buildForm(ctx, restoring);
      return m;
    },
    _buildForm(ctx, restoring) {
      const { d, m, autoT } = ctx;
      const zoneOpts = zones().map((z) => `<option value="${esc(z.id)}" ${z.id === d.zoneId ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
      const chips = TASKS.map((t) => {
        const on = d.tasks.includes(t.id);
        const n = autoT[t.id] || 0;
        return `<button type="button" class="jr-chip ${on ? 'on' : ''} ${n ? 'auto' : ''}" data-task="${t.id}" aria-pressed="${on}"><span class="emoji">${t.icon}</span>${esc(t.label)}${n ? `<small>×${n}</small>` : ''}</button>`;
      }).join('');
      const lessons = lessonSuggestions();
      m.body.innerHTML = `
        ${restoring ? '<div class="notice-box info jr-restore">작성 중이던 일지를 불러왔어요. <button type="button" class="link-btn" data-jr-reset>새로 쓰기</button></div>' : ''}
        <div class="jr-form">
          <section class="jr-col">
            <div class="jr-row2">
              <div class="field"><label for="jr-date">날짜</label><input id="jr-date" type="date" value="${esc(d.date)}" max="${esc(todayISO())}"></div>
              <div class="field"><label for="jr-zone">지역</label><select id="jr-zone">${zoneOpts}</select></div>
            </div>
            <div class="field jr-field-tasks">
              <label>작업 <span class="jr-hint">최근 2시간 활동을 자동으로 골랐어요 · 눌러서 고치기</span></label>
              <div class="jr-chips" role="group" aria-label="작업 선택">${chips}</div>
              <input id="jr-note" type="text" maxlength="${LIMIT.note}" placeholder="직접 적기 (예: 콩밭 김매기, 장독 닦기)" value="${esc(d.note)}">
            </div>
            <div class="field"><label for="jr-harvest">수확물 ${autoHarvest() ? '<span class="jr-auto">자동</span>' : ''}</label><input id="jr-harvest" type="text" maxlength="${LIMIT.harvest}" placeholder="오늘 거둔 작물이나 완성한 발효식품" value="${esc(d.harvest)}"></div>
            <div class="field"><label for="jr-ferment">발효 상태 ${autoFerment() ? '<span class="jr-auto">내 장독</span>' : ''}</label><input id="jr-ferment" type="text" maxlength="${LIMIT.ferment}" placeholder="장독의 발효 상태" value="${esc(d.ferment)}"></div>
            <div class="field jr-photo-field">
              <label>사진 <span class="jr-hint">PNG·JPG·WEBP · 5MB 이하 · 480px로 줄여 저장</span></label>
              <div class="jr-photo">
                <div class="jr-photo-preview" data-jr-preview></div>
                <div class="jr-photo-side">
                  <div class="jr-gallery" data-jr-gallery></div>
                  <div class="row wrap">
                    <button type="button" class="btn btn-sm btn-soft" data-jr-upload><span class="ico ico-sm" data-icon="upload"></span>파일 올리기</button>
                    <button type="button" class="btn btn-sm btn-ghost" data-jr-photo-clear hidden><span class="ico ico-sm" data-icon="trash"></span>사진 빼기</button>
                  </div>
                  <div class="jr-photo-msg" data-jr-photo-msg role="status"></div>
                </div>
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" data-jr-file hidden>
            </div>
          </section>
          <section class="jr-col">
            <div class="field jr-grow">
              <label for="jr-learned">배운 내용 <span class="jr-count" data-count="learned"></span></label>
              ${lessons.length ? `<div class="jr-suggest"><span>최근 학습</span>${lessons.map((l) => `<button type="button" class="chip chip-btn" data-lesson="${esc(l.key)}">＋ ${esc(l.label)}</button>`).join('')}</div>` : ''}
              <textarea id="jr-learned" maxlength="${LIMIT.learned}" placeholder="오늘 새롭게 알게 된 점을 적어 보세요. (예: 메주는 삶은 콩을 찧어 빚은 뒤 말려서 띄워요.)">${esc(d.learned)}</textarea>
            </div>
            <div class="field jr-grow">
              <label for="jr-memo">느낀 점 <span class="jr-count" data-count="memo"></span></label>
              <textarea id="jr-memo" maxlength="${LIMIT.memo}" placeholder="체험하며 느낀 점, 다음에 해 보고 싶은 일">${esc(d.memo)}</textarea>
            </div>
          </section>
        </div>`;
      G.ui.hydrateIcons(m.body);
      const $ = (s) => m.body.querySelector(s);
      const bind = (sel, key) => { const el = $(sel); el?.addEventListener('input', () => { d[key] = el.value; d.touched = true; this._clearError(ctx); this._counts(ctx); }); };
      bind('#jr-date', 'date'); bind('#jr-note', 'note'); bind('#jr-harvest', 'harvest'); bind('#jr-ferment', 'ferment'); bind('#jr-learned', 'learned'); bind('#jr-memo', 'memo');
      $('#jr-zone').addEventListener('change', (ev) => { d.zoneId = ev.target.value; d.touched = true; });
      $('#jr-date').addEventListener('change', (ev) => { d.date = ev.target.value; d.touched = true; });
      m.body.querySelector('.jr-chips').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-task]');
        if (!b) return;
        const id = b.dataset.task;
        const i = d.tasks.indexOf(id);
        if (i >= 0) d.tasks.splice(i, 1); else d.tasks.push(id);
        d.touched = true;
        b.classList.toggle('on', i < 0);
        b.setAttribute('aria-pressed', String(i < 0));
        this._clearError(ctx);
        G.sfx('click');
      });
      m.body.querySelector('.jr-suggest')?.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-lesson]');
        if (!b) return;
        const l = lessons.find((x) => x.key === b.dataset.lesson);
        if (!l) return;
        const ta = $('#jr-learned');
        const cur = ta.value.trim();
        if (cur.includes(l.text)) return;
        ta.value = clip(cur ? `${cur}\n${l.text}` : l.text, LIMIT.learned);
        d.learned = ta.value;
        d.touched = true;
        if (l.key.startsWith('e:') && !d.eduIds.includes(l.key.slice(2))) d.eduIds.push(l.key.slice(2));
        b.classList.add('used');
        this._clearError(ctx); this._counts(ctx);
      });
      $('[data-jr-reset]')?.addEventListener('click', () => { this._draft = null; ctx.m.close(); this.open(); });
      // photo
      const file = $('[data-jr-file]');
      $('[data-jr-upload]').addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        this._photoMsg(ctx, '사진을 확인하는 중…', 'busy');
        try {
          const r = await processPhoto(f);
          if (ctx.m.closed) return;
          d.photo = r.dataUrl; d.photoId = null; d.photoSource = 'upload'; d.touched = true;
          this._renderPhoto(ctx);
          this._photoMsg(ctx, `사진을 ${r.width}×${r.height}px로 줄였어요.${G.net?.mode === 'server' ? ' 저장할 때 서버에 올려요.' : ''}`, 'ok');
        } catch (e) {
          this._photoMsg(ctx, e.message || '사진을 올리지 못했어요.', 'err');
          G.sfx('error');
        }
      });
      $('[data-jr-photo-clear]').addEventListener('click', () => { d.photo = null; d.photoId = null; d.photoSource = null; d.touched = true; this._renderPhoto(ctx); this._photoMsg(ctx, ''); });
      $('[data-jr-gallery]').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-photo]');
        if (!b) return;
        const p = recentPhotos(40).find((x) => x.id === b.dataset.photo);
        if (!p) return;
        if (d.photoId === p.id) { d.photo = null; d.photoId = null; d.photoSource = null; }
        else { d.photo = safeSrc(p.thumb || p.url); d.photoId = p.id; d.photoSource = 'gallery'; }
        d.touched = true;
        this._renderPhoto(ctx); this._photoMsg(ctx, '');
      });
      this._renderPhoto(ctx);
      this._counts(ctx);
      // footer
      const foot = m.foot;
      foot.innerHTML = '';
      foot.classList.add('jr-foot');
      ctx.err = h('div', { class: 'jr-err', role: 'alert' });
      const tip = h('div', { class: 'jr-tip' }, '작업 또는 배운 내용 중 하나는 꼭 적어 주세요.');
      const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, '닫기');
      cancel.addEventListener('click', () => m.close());
      ctx.saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, h('span', { class: 'ico ico-sm', 'data-icon': 'save' }), '저장하기');
      ctx.saveBtn.addEventListener('click', () => this._save(ctx));
      foot.append(h('div', { class: 'jr-foot-msg' }, tip, ctx.err), cancel, ctx.saveBtn);
      G.ui.hydrateIcons(foot);
    },
    _counts(ctx) {
      for (const el of ctx.m.body.querySelectorAll('[data-count]')) {
        const k = el.dataset.count;
        const n = (ctx.d[k] || '').length;
        el.textContent = n ? `${n}/${LIMIT[k]}` : '';
      }
    },
    _renderPhoto(ctx) {
      const { d, m } = ctx;
      const prev = m.body.querySelector('[data-jr-preview]');
      const gal = m.body.querySelector('[data-jr-gallery]');
      const clear = m.body.querySelector('[data-jr-photo-clear]');
      const src = safeSrc(d.photo);
      prev.innerHTML = src ? `<img src="${esc(src)}" alt="선택한 사진">` : '<div class="jr-photo-empty"><span class="ico ico-lg" data-icon="image"></span><span>사진 없음</span></div>';
      prev.classList.toggle('has', !!src);
      clear.hidden = !src;
      const photos = recentPhotos(8);
      gal.innerHTML = photos.length
        ? photos.map((p) => `<button type="button" class="jr-thumb ${d.photoId === p.id ? 'on' : ''}" data-photo="${esc(p.id)}" title="${esc(zoneOf(p.zoneId)?.name || '')} ${p.at ? esc(U.formatDate(p.at, true)) : ''}"><img src="${esc(safeSrc(p.thumb || p.url))}" alt="찍은 사진"></button>`).join('')
        : '<div class="jr-gallery-empty">P 키로 사진을 찍으면 여기에서 고를 수 있어요.</div>';
      G.ui.hydrateIcons(prev);
    },
    _photoMsg(ctx, text, kind = '') {
      const el = ctx.m.body.querySelector('[data-jr-photo-msg]');
      if (!el) return;
      el.textContent = text || '';
      el.className = `jr-photo-msg ${kind}`;
    },
    _clearError(ctx) {
      if (!ctx.err || !ctx.err.textContent) return;
      ctx.err.textContent = '';
      ctx.m.body.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid'));
    },
    async _save(ctx) {
      if (ctx.busy || ctx.m.closed) return;
      const d = ctx.d;
      const hasTask = d.tasks.length > 0 || !!String(d.note || '').trim();
      const hasLearned = !!String(d.learned || '').trim();
      if (!hasTask && !hasLearned) {
        ctx.err.textContent = '작업을 하나 이상 고르거나 배운 내용을 적어 주세요.';
        ctx.m.body.querySelector('.jr-field-tasks')?.classList.add('invalid');
        ctx.m.body.querySelector('#jr-learned')?.closest('.field')?.classList.add('invalid');
        G.sfx('error');
        return;
      }
      if (d.date && !validISO(d.date)) { ctx.err.textContent = '날짜를 다시 확인해 주세요.'; ctx.m.body.querySelector('#jr-date')?.closest('.field')?.classList.add('invalid'); G.sfx('error'); return; }
      let photo = d.photo;
      const st = G.state; // the upload can outlive the session: the entry belongs to this player only
      if (d.photoSource === 'upload' && d.photo && /^data:/.test(d.photo) && G.net?.mode === 'server') {
        ctx.busy = true;
        ctx.saveBtn.disabled = true;
        ctx.saveBtn.lastChild.textContent = '사진 올리는 중…';
        let failed = false;
        try { photo = await uploadPhoto(d.photo); }
        catch (e) {
          G.log.warn('API', 'journal photo upload failed, keeping the thumbnail', e);
          failed = true;
          photo = d.photo;
        } finally {
          ctx.busy = false;
          if (!ctx.m.closed) { ctx.saveBtn.disabled = false; ctx.saveBtn.lastChild.textContent = '저장하기'; }
        }
        if (!G.state || G.state !== st) { G.log.info('UI', 'journal save dropped: the player changed during the photo upload'); return; }
        if (failed) G.ui.toast('사진을 서버에 올리지 못해 작은 사진으로 저장했어요.', { type: 'warn' });
      }
      const entry = this.create({ date: d.date, zoneId: d.zoneId, tasks: d.tasks, note: d.note, harvest: d.harvest, ferment: d.ferment, learned: d.learned, memo: d.memo, photo, photoId: d.photoId, eduIds: d.eduIds });
      if (!entry) { ctx.err.textContent = '작업일지를 저장하지 못했어요. 내용을 확인해 주세요.'; return; }
      this._draft = null;
      ctx.m.close();
      G.sfx('page');
      G.ui.toast(`작업일지를 저장했어요! 지금까지 ${this.count()}개를 기록했어요.`, { type: 'success', emoji: '📝', sound: true });
    },

    // ------------------------------------------------------------ list / detail
    openList(opts = {}) {
      if (!G.state) return null;
      if (easyOn() && !opts.normal) return this._openKidList();
      const ctx = { zone: opts.zone || 'all' };
      const head = h('div', { class: 'jr-switch seg', role: 'tablist' });
      head.innerHTML = `<button type="button" data-jr-write>✏️ 일지 쓰기</button><button type="button" class="active" aria-selected="true">📚 지난 일지 <b data-jr-count>${this.count()}</b></button>`;
      head.querySelector('[data-jr-write]').addEventListener('click', () => { ctx.m.close(); this.open(); });
      const m = G.ui.modal.open({
        id: 'journal-list', size: 'xl', className: 'journal-modal journal-list-modal', title: '작업일지', icon: '📚', headExtra: head,
        onClose: () => { if (this._list === ctx) this._list = null; },
      });
      ctx.m = m; ctx.head = head;
      this._list = ctx;
      m.body.addEventListener('click', (ev) => {
        const c = ev.target.closest('[data-jr-open]');
        if (c) { this.openDetail(c.dataset.jrOpen); return; }
        if (ev.target.closest('[data-jr-new]')) { ctx.m.close(); this.open(); }
      });
      m.body.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const c = ev.target.closest('[data-jr-open]');
        if (c && ev.target === c) { ev.preventDefault(); this.openDetail(c.dataset.jrOpen); }
      });
      m.body.addEventListener('change', (ev) => { if (ev.target.matches('[data-jr-zone]')) { ctx.zone = ev.target.value; this._renderList(ctx); } });
      this._renderList(ctx);
      return m;
    },
    _renderList(ctx) {
      if (!ctx?.m || ctx.m.closed) return;
      const all = this.list().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const usedZones = [...new Set(all.map((e) => e.zoneId).filter(Boolean))];
      if (ctx.zone !== 'all' && !usedZones.includes(ctx.zone)) ctx.zone = 'all';
      const list = ctx.zone === 'all' ? all : all.filter((e) => e.zoneId === ctx.zone);
      const cnt = ctx.head.querySelector('[data-jr-count]');
      if (cnt) cnt.textContent = String(all.length);
      const cards = list.map((e) => {
        const z = zoneOf(e.zoneId);
        const src = entryPhoto(e);
        const moodIco = MOOD[e.mood] ? `<span class="emoji jr-mood" title="${esc(MOOD[e.mood].label)}">${MOOD[e.mood].emoji}</span>` : '';
        const tasks = moodIco + (e.tasks || []).filter((t) => TASK[t]).slice(0, 6).map((t) => `<span class="emoji" title="${esc(TASK[t].label)}">${TASK[t].icon}</span>`).join('');
        const excerpt = e.learned || e.memo || e.activity || '';
        return `<article class="jr-card" style="--zc:${esc(z?.color || '#9aa88f')}" tabindex="0" role="button" data-jr-open="${esc(e.id)}" aria-label="${esc(fmtDate(e.date))} 작업일지 보기">
          <div class="jr-card-pic ${src ? '' : 'none'}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="ico ico-lg" data-icon="${esc(z?.icon || 'journal')}"></span>`}</div>
          <div class="jr-card-body">
            <div class="jr-card-top"><b>${esc(fmtDate(e.date))}</b><span class="jr-zone-chip">${esc(z?.short || z?.name || e.zoneName || '체험관')}</span></div>
            <div class="jr-card-tasks">${tasks || '<span class="muted small">기록</span>'}</div>
            <p class="jr-card-ex">${esc(excerpt)}</p>
          </div>
        </article>`;
      }).join('');
      const zoneOpts = ['<option value="all">모든 지역</option>'].concat(usedZones.map((id) => `<option value="${esc(id)}" ${ctx.zone === id ? 'selected' : ''}>${esc(zoneOf(id)?.name || id)}</option>`)).join('');
      ctx.m.body.innerHTML = `
        <div class="jr-list-bar">
          <div class="jr-list-stat"><span class="emoji">📝</span> 지금까지 <b>${all.length}</b>개의 일지를 썼어요${all.length ? ` · 마지막 기록 ${esc(fmtDate(all[0].date, false))}` : ''}</div>
          ${usedZones.length > 1 ? `<select class="input jr-zone-filter" data-jr-zone aria-label="지역으로 거르기">${zoneOpts}</select>` : ''}
          <button type="button" class="btn btn-primary btn-sm" data-jr-new><span class="ico ico-sm" data-icon="edit"></span>새 일지 쓰기</button>
        </div>
        ${cards ? `<div class="jr-grid">${cards}</div>` : `<div class="empty jr-empty"><div class="emoji">📔</div><b>${all.length ? '이 지역의 일지가 없어요.' : '아직 작성한 작업일지가 없어요.'}</b><p>물주기·수확·발효 확인 같은 체험을 한 뒤 J 키로 오늘의 기록을 남겨 보세요.</p></div>`}`;
      G.ui.hydrateIcons(ctx.m.body);
    },
    openDetail(id) {
      const e = this.get(id);
      if (!e) { G.ui.toast(easyOn() ? '일기를 찾을 수 없어요.' : '일지를 찾을 수 없어요.', { type: 'warn' }); return null; }
      if (easyOn()) return this._openKidDetail(e);
      const z = zoneOf(e.zoneId);
      const src = entryPhoto(e);
      const tasks = (e.tasks || []).filter((t) => TASK[t]).map((t) => `<span class="jr-chip on static"><span class="emoji">${TASK[t].icon}</span>${esc(TASK[t].label)}</span>`).join('');
      const sec = (label, icon, val) => (val ? `<section class="jr-sec"><h4><span class="emoji">${icon}</span>${esc(label)}</h4><p>${esc(val)}</p></section>` : '');
      const body = `<div class="jr-paper">
          <header class="jr-paper-head"><div><div class="jr-paper-date">${esc(fmtDate(e.date))}</div><div class="jr-paper-zone" style="--zc:${esc(z?.color || '#9aa88f')}"><span class="ico ico-sm" data-icon="pin"></span>${esc(z?.name || e.zoneName || '체험관')}</div></div><div class="jr-paper-stamp">작업일지</div></header>
          ${src ? `<figure class="jr-paper-photo"><img src="${esc(src)}" alt="일지 사진"></figure>` : ''}
          ${tasks ? `<div class="jr-paper-tasks">${tasks}</div>` : ''}
          ${MOOD[e.mood] ? sec('기분', MOOD[e.mood].emoji, MOOD[e.mood].label) : ''}
          ${sec('작업', '🧑‍🌾', e.note || (tasks || MOOD[e.mood] ? '' : e.activity))}
          ${sec('수확물', '🧺', e.harvest)}
          ${sec('발효 상태', '🏺', e.ferment)}
          ${sec('배운 내용', '📖', e.learned)}
          ${sec('느낀 점', '💭', e.memo)}
          <footer class="jr-paper-foot">${e.createdAt ? `${esc(U.formatDate(e.createdAt, true))}에 작성` : ''}</footer>
        </div>`;
      return G.ui.modal.open({
        id: 'journal-detail', size: 'md', className: 'journal-detail-modal', title: '작업일지', icon: '📖', body,
        actions: [
          { label: '삭제', class: 'btn-danger', icon: 'trash', onClick: async () => {
            const ok = await G.ui.confirm('이 작업일지를 삭제할까요? 삭제한 일지는 되돌릴 수 없어요.', { title: '일지 삭제', okText: '삭제', danger: true, icon: 'trash' });
            if (!ok) return false;
            this.remove(e.id);
            G.ui.toast('작업일지를 삭제했어요.', { type: 'info', emoji: '🗑️' });
            setTimeout(() => this._renderList(this._list), 0);
            return true;
          } },
          { label: '닫기', class: 'btn-primary' },
        ],
      });
    },

    // ------------------------------------------------------------ 쉬운 모드: 그림일기 (no typing)
    /** 📝 쓰기 | 📚 일기장 switch for the kid modals */
    _kidSwitch(active, ctx) {
      const h = G.ui.h;
      const seg = h('div', { class: 'kd-switch', role: 'tablist' });
      const mk = (id, emoji, label, fn) => {
        const b = h('button', { type: 'button', role: 'tab', class: `kd-switch-btn${active === id ? ' active' : ''}`, 'aria-selected': active === id ? 'true' : 'false' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', null, label));
        b.addEventListener('click', () => { if (active !== id) fn(); });
        seg.appendChild(b);
      };
      mk('write', '📝', '쓰기', () => { ctx.m?.close(); this.open(); });
      mk('list', '📚', `일기장 ${this.count()}`, () => { ctx.m?.close(); this.openList(); });
      return seg;
    },

    _openKid(opts = {}) {
      const h = G.ui.h;
      const pre = opts.prefill || {};
      const autoT = autoTasks();
      const suggested = Object.keys(autoT).filter((t) => TASK[t]).sort((a, b) => autoT[b] - autoT[a]).slice(0, MAX_STICKERS);
      let d = this._kidDraft;
      if (!d || !d.touched) d = this._kidDraft = { mood: null, tasks: suggested.slice(), photo: null, photoId: null, touched: false };
      if (pre.photo && safeSrc(pre.photo)) { d.photo = safeSrc(pre.photo); d.photoId = pre.photoId ? String(pre.photoId).slice(0, 64) : null; d.touched = true; }
      const ctx = { d, suggested };
      const m = G.ui.modal.open({
        id: 'journal-form', size: 'lg', className: 'journal-modal kd-modal', title: '그림일기', icon: '📝',
        headExtra: this._kidSwitch('write', ctx), autofocus: false,
        say: '그림일기를 써요. 오늘 기분과 스티커를 골라요.',
        body: (body) => { body.appendChild(h('div', { class: 'kd-layout' }, h('div', { class: 'kd-steps' }), h('aside', { class: 'kd-page', 'aria-live': 'polite' }))); },
        actions: [],
        onClose: () => { if (this._form === ctx) this._form = null; },
      });
      ctx.m = m;
      this._form = ctx;
      const steps = m.body.querySelector('.kd-steps');
      const sec = (no, title, sub, sayLine) => {
        const head = h('h3', { class: 'kd-sec' }, h('span', { class: 'kd-no', 'aria-hidden': 'true' }, String(no)), h('span', { class: 'kd-sec-t' }, title), sub ? h('small', null, sub) : null);
        const speak = h('button', { type: 'button', class: 'easy-speak kd-say', 'aria-label': '소리로 듣기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊'));
        speak.addEventListener('click', () => kidSay(sayLine, { force: true, priority: 1 }));
        head.appendChild(speak);
        const box = h('section', { class: 'kd-step' }, head);
        steps.appendChild(box);
        return box;
      };
      // ① mood
      const moods = h('div', { class: 'kd-moods', role: 'radiogroup', 'aria-label': '오늘 기분' });
      for (const mo of MOODS) {
        const b = h('button', { type: 'button', role: 'radio', class: 'kd-mood', dataset: { mood: mo.id }, 'aria-label': mo.label, 'data-say': mo.label },
          h('span', { class: 'kd-mood-face emoji', 'aria-hidden': 'true' }, mo.emoji), h('span', { class: 'kd-mood-lbl' }, mo.label));
        b.style.setProperty('--mood', mo.color);
        b.addEventListener('click', () => {
          d.mood = d.mood === mo.id ? null : mo.id;
          d.touched = true;
          G.sfx('click');
          if (d.mood) kidSay(mo.label, { force: false });
          this._kidRefresh(ctx);
        });
        moods.appendChild(b);
      }
      G.kidKit?.gridKeys?.(moods);
      sec(1, '오늘 기분은?', null, '오늘 기분은 어때요? 얼굴을 하나 골라요.').appendChild(moods);
      // ② stickers (max 5; today's activities are pre-picked)
      const stick = h('div', { class: 'kd-stickers', role: 'group', 'aria-label': '오늘 한 일 스티커' });
      for (const t of TASKS) {
        const b = h('button', { type: 'button', class: 'kd-sticker', dataset: { task: t.id }, 'aria-pressed': 'false', 'data-say': KID_TASK[t.id] || t.label },
          h('span', { class: 'kd-st-emoji emoji', 'aria-hidden': 'true' }, t.icon), h('span', { class: 'kd-st-lbl' }, KID_TASK[t.id] || t.label),
          ctx.suggested.includes(t.id) ? h('span', { class: 'kd-today', title: '오늘 한 일', 'aria-hidden': 'true' }, '✨') : null);
        b.style.setProperty('--st', STICKER_COLOR[t.id] || '#ffc93c');
        b.addEventListener('click', () => {
          const i = d.tasks.indexOf(t.id);
          if (i >= 0) d.tasks.splice(i, 1);
          else if (d.tasks.length >= MAX_STICKERS) { G.kidKit?.shake?.(b); G.sfx('wrong'); kidSay('스티커는 다섯 개까지 붙일 수 있어요.', { force: true }); return; }
          else { d.tasks.push(t.id); kidSay(KID_TASK[t.id] || t.label, { force: false }); }
          d.touched = true;
          G.sfx('click');
          this._kidRefresh(ctx);
        });
        stick.appendChild(b);
      }
      G.kidKit?.gridKeys?.(stick);
      sec(2, '무엇을 했나요?', `스티커 ${MAX_STICKERS}개까지`, `오늘 무엇을 했나요? 스티커를 ${MAX_STICKERS}개까지 골라요.`).appendChild(stick);
      // ③ photo (in-game album only: no file upload for children)
      const photos = h('div', { class: 'kd-photos', role: 'radiogroup', 'aria-label': '사진 고르기' });
      const list = recentPhotos(7);
      const none = h('button', { type: 'button', role: 'radio', class: 'kd-photo kd-photo-none', dataset: { photo: '' }, 'aria-label': '사진 없이', 'data-say': '사진 없이' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🚫'), h('span', null, '사진 없이'));
      none.addEventListener('click', () => { d.photo = null; d.photoId = null; d.touched = true; this._kidRefresh(ctx); });
      photos.appendChild(none);
      // a photo attached from the album that is no longer in the recent list stays choosable
      if (d.photo && d.photoId && !list.some((p) => p.id === d.photoId)) list.unshift({ id: d.photoId, thumb: d.photo });
      if (d.photo && !d.photoId) list.unshift({ id: '__pre', thumb: d.photo });
      for (const p of list) {
        const src = safeSrc(p.thumb || p.url);
        if (!src) continue;
        const b = h('button', { type: 'button', role: 'radio', class: 'kd-photo', dataset: { photo: p.id }, 'aria-label': '찍은 사진' }, h('img', { src, alt: '', loading: 'lazy' }));
        b.addEventListener('click', () => { d.photo = src; d.photoId = p.id === '__pre' ? null : p.id; d.touched = true; G.sfx('click'); this._kidRefresh(ctx); });
        photos.appendChild(b);
      }
      G.kidKit?.gridKeys?.(photos);
      const photoSec = sec(3, '사진도 붙일까요?', '안 붙여도 돼요', '사진도 붙일까요? 안 붙여도 괜찮아요.');
      photoSec.appendChild(photos);
      if (!list.length) photoSec.appendChild(h('p', { class: 'kd-tip' }, '📸 사진을 찍으면 여기에 나와요!'));
      // save
      const save = h('button', { type: 'button', class: 'easy-big-btn kd-save', 'data-say': '다 썼어요' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📝'), h('span', null, '다 썼어요!'));
      save.addEventListener('click', () => this._kidSave(ctx, save));
      m.foot.appendChild(save);
      ctx.save = save;
      this._kidRefresh(ctx);
      return m;
    },

    /** sync the chosen states + the live diary page preview */
    _kidRefresh(ctx) {
      const { d, m } = ctx;
      if (!m || m.closed) return;
      const h = G.ui.h;
      for (const b of m.body.querySelectorAll('.kd-mood')) { const on = b.dataset.mood === d.mood; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }
      for (const b of m.body.querySelectorAll('.kd-sticker')) { const on = d.tasks.includes(b.dataset.task); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      for (const b of m.body.querySelectorAll('.kd-photo')) { const on = b.dataset.photo ? (b.dataset.photo === (d.photoId || '__pre') && !!d.photo) : !d.photo; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }
      const count = m.body.querySelector('.kd-step:nth-child(2) .kd-sec small');
      if (count) count.textContent = `스티커 ${d.tasks.length} / ${MAX_STICKERS}`;
      ctx.save?.classList.toggle('ready', !!(d.mood || d.tasks.length));
      const page = m.body.querySelector('.kd-page');
      if (!page) return;
      page.textContent = '';
      const z = zoneOf(currentZoneId());
      const mood = MOOD[d.mood];
      const src = safeSrc(d.photo);
      // h() skips null children; native append() would print "null" — so the parts go through one h() wrapper
      page.appendChild(h('div', { class: 'kd-page-in' },
        h('div', { class: 'kd-page-date' }, kidDate(todayISO())),
        h('div', { class: 'kd-page-zone' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📍'), z?.short || z?.name || '체험관'),
        h('div', { class: `kd-page-mood${mood ? '' : ' empty'}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, mood ? mood.emoji : '🙂'), h('span', null, mood ? mood.label : '기분을 골라요')),
        src ? h('figure', { class: 'kd-page-photo' }, h('img', { src, alt: '고른 사진' })) : null,
        h('div', { class: 'kd-page-stickers' }, d.tasks.length ? d.tasks.map((t) => {
          const s = h('span', { class: 'kd-page-st', title: KID_TASK[t] || TASK[t]?.label || '' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, TASK[t]?.icon || '⭐'));
          s.style.setProperty('--st', STICKER_COLOR[t] || '#ffc93c');
          return s;
        }) : h('span', { class: 'kd-page-hint' }, '스티커를 붙여요'))));
    },

    _kidSave(ctx, btn) {
      const d = ctx.d;
      if (ctx.busy || ctx.m.closed) return;
      if (!d.mood && !d.tasks.length) {
        G.kidKit?.shake?.(ctx.m.body.querySelector('.kd-moods'));
        G.kidKit?.shake?.(btn);
        G.sfx('wrong');
        kidSay('기분이나 스티커를 하나 골라요!', { force: true, priority: 1 });
        return;
      }
      ctx.busy = true;
      const entry = this.create({
        mood: d.mood, tasks: d.tasks.slice(0, MAX_STICKERS), zoneId: currentZoneId(), date: todayISO(),
        harvest: autoHarvest(), ferment: autoFerment(), learned: '', memo: '', note: '',
        photo: d.photo, photoId: d.photoId,
      });
      ctx.busy = false;
      if (!entry) { G.ui.toast('앗, 일기를 못 썼어요. 다시 해 봐요!', { type: 'error', easy: '앗, 일기를 못 썼어요. 다시 해 봐요!' }); return; }
      this._kidDraft = null;
      ctx.m.close();
      G.sfx('page');
      const mo = MOOD[entry.mood];
      try { G.easy?.celebrate?.('일기를 다 썼어요!', { emoji: mo ? mo.emoji : '📝', say: `그림일기를 다 썼어요! 지금까지 ${this.count()}개를 썼어요.` }); } catch (e) { /* cosmetic */ }
    },

    _openKidList() {
      const h = G.ui.h;
      const ctx = {};
      const m = G.ui.modal.open({
        id: 'journal-list', size: 'lg', className: 'journal-modal kd-modal kd-list-modal', title: '내 일기장', icon: '📚',
        headExtra: this._kidSwitch('list', ctx), say: this.count() ? `일기장이에요. 일기가 ${this.count()}개 있어요.` : '일기장이 비어 있어요.',
        body: (body) => body.appendChild(h('div', { class: 'kd-book' })), actions: [],
        onClose: () => { if (this._kidList === ctx) this._kidList = null; },
      });
      ctx.m = m;
      this._kidList = ctx;
      this._renderKidList(ctx);
      return m;
    },

    _renderKidList(ctx) {
      if (!ctx?.m || ctx.m.closed) return;
      const h = G.ui.h;
      const book = ctx.m.body.querySelector('.kd-book');
      if (!book) return;
      book.textContent = '';
      const all = this.list().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const btn = ctx.m.el.querySelector('.kd-switch-btn:last-child span:last-child');
      if (btn) btn.textContent = `일기장 ${all.length}`;
      if (!all.length) {
        book.appendChild(G.kidKit ? G.kidKit.empty('📔', '아직 일기가 없어요.', '오늘 한 일을 그림일기로 남겨 봐요!') : h('p', null, '아직 일기가 없어요.'));
        const w = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes kd-write-first' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📝'), h('span', null, '일기 쓰기'));
        w.addEventListener('click', () => { ctx.m.close(); this.open(); });
        book.appendChild(w);
        return;
      }
      const grid = h('div', { class: 'kd-cards', role: 'list' });
      all.slice(0, 120).forEach((e, i) => {
        const mo = MOOD[e.mood];
        const src = entryPhoto(e);
        const tasks = (e.tasks || []).filter((t) => TASK[t]).slice(0, MAX_STICKERS);
        const card = h('button', { type: 'button', role: 'listitem', class: 'kd-card', 'aria-label': `${kidDate(e.date)} 일기${mo ? `, ${mo.label}` : ''}` },
          h('span', { class: 'kd-card-date' }, kidDate(e.date)),
          h('span', { class: 'kd-card-mood emoji', 'aria-hidden': 'true' }, mo ? mo.emoji : '📝'),
          src ? h('span', { class: 'kd-card-pic' }, h('img', { src, alt: '', loading: 'lazy' })) : null,
          h('span', { class: 'kd-card-st', 'aria-hidden': 'true' }, tasks.map((t) => h('span', { class: 'emoji' }, TASK[t].icon))));
        card.style.setProperty('--i', String(Math.min(i, 16)));
        if (mo) card.style.setProperty('--mood', mo.color);
        card.__easySpeak = { btn: null, text: `${kidDate(e.date)} 일기. ${mo ? `기분은 ${mo.label}.` : ''} ${tasks.map((t) => KID_TASK[t] || TASK[t].label).join(', ')}` };
        card.addEventListener('click', () => this.openDetail(e.id));
        grid.appendChild(card);
      });
      G.kidKit?.gridKeys?.(grid);
      book.appendChild(grid);
    },

    _openKidDetail(e) {
      const h = G.ui.h;
      const mo = MOOD[e.mood];
      const z = zoneOf(e.zoneId);
      const src = entryPhoto(e);
      const tasks = (e.tasks || []).filter((t) => TASK[t]);
      // the jar status line (temperature, quality %) is for the grown-up view; the kid page keeps it simple
      const texts = [['🧑‍🌾', e.note], ['🧺', e.harvest], ['📖', e.learned], ['💭', e.memo]].filter(([, v]) => v && String(v).trim());
      const page = h('div', { class: 'kd-paper' },
        h('header', { class: 'kd-paper-head' },
          h('div', null, h('div', { class: 'kd-paper-date' }, kidDate(e.date)), h('div', { class: 'kd-paper-zone' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📍'), z?.short || z?.name || e.zoneName || '체험관')),
          mo ? h('div', { class: 'kd-paper-mood' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, mo.emoji), h('span', null, mo.label)) : null),
        src ? h('figure', { class: 'kd-paper-photo' }, h('img', { src, alt: '일기 사진' })) : null,
        tasks.length ? h('div', { class: 'kd-paper-stickers' }, tasks.map((t) => {
          const s = h('span', { class: 'kd-paper-st' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, TASK[t].icon), h('span', null, KID_TASK[t] || TASK[t].label));
          s.style.setProperty('--st', STICKER_COLOR[t] || '#ffc93c');
          return s;
        })) : null,
        texts.length ? h('div', { class: 'kd-paper-notes' }, texts.map(([emo, v]) => h('p', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emo), h('span', null, String(v))))) : null);
      const del = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no kd-del', 'data-say': '지우기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🗑️'), h('span', null, '지우기'));
      const ok = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👍'), h('span', null, '다 봤어요'));
      const m = G.ui.modal.open({
        id: 'journal-detail', size: 'md', className: 'kd-detail-modal', title: '그림일기', icon: mo ? mo.emoji : '📝',
        say: `${kidDate(e.date)} 일기. ${mo ? `기분은 ${mo.label}.` : ''} ${tasks.map((t) => KID_TASK[t] || TASK[t].label).join(', ')}`,
        body: page, actions: [],
      });
      m.foot.append(del, ok);
      ok.addEventListener('click', () => m.close());
      del.addEventListener('click', async () => {
        const yes = await (G.easy?.confirm ? G.easy.confirm({ emoji: '🗑️', heading: '지우기', title: '이 일기를 지울까요?', text: '지우면 다시 볼 수 없어요.', danger: true, yes: '지울래요', no: '안 지울래요' }) : G.ui.confirm('이 일기를 지울까요?', { danger: true }));
        if (!yes || !this.get(e.id)) return;
        this.remove(e.id);
        m.close();
        G.ui.toast('일기를 지웠어요.', { type: 'info', emoji: '🗑️' });
        this._renderKidList(this._kidList);
      });
      setTimeout(() => { if (!m.closed) ok.focus({ preventScroll: true }); }, 60);
      return m;
    },
  };

  function josa(word, pair) {
    const [a, b] = pair.split('/');
    const s = String(word || '');
    const ch = s.charCodeAt(s.length - 1);
    if (!(ch >= 0xac00 && ch <= 0xd7a3)) return b;
    return (ch - 0xac00) % 28 ? a : b;
  }

  journal.processPhoto = processPhoto; // exposed for tests
  G.register(journal);
})();
