// =============================================================================
// 47-journal.js — work journal (G.sys.journal, order 66). Hotkey J, action 'journal'.
//
//   open({prefill})   form: 날짜 · 지역 (current zone) · 작업 chips (auto from G.state.activity, last 2 h) ·
//                     수확물 (recent harvests) · 발효 상태 (my jar J1) · 배운 내용 (+ recent lessons) · 느낀 점 ·
//                     사진 (pick from G.state.photos or upload png/jpeg/webp ≤ 5 MB -> ≤ 480 px JPEG thumbnail;
//                     server mode uploads it to journal/upload.php and stores the returned url)
//   openList()        cards newest first, zone filter, detail view, delete with confirm
//   openDetail(id) / create(entry) -> entry | null / remove(id) / get(id) / list() / count()
// Emits journal:created {entry} (progression counts it, quests advance). Required: 작업 or 배운 내용.
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

  // =============================================================================================
  const journal = {
    name: 'journal', order: 66, label: '작업일지',
    _draft: null,
    _form: null, _list: null,

    init() {
      G.ui.onAction('journal', () => this.open());
      G.input?.onKey?.('KeyJ', () => { if (!G.state) return false; this.open(); return true; });
      // record activities the owner modules do not log themselves (deduped, deferred)
      G.bus.on('ferment:checked', (p) => logSoon('ferment_check', '내 장독 발효 상태 확인', { jarId: p?.jarId || 'J1' }, 'jarId'));
      G.bus.on('photo:taken', (p) => logSoon('photo', '사진 촬영', { photoId: p?.photoId, photoZoneId: p?.photoZoneId }, 'photoId'));
      G.bus.on('npc:talk', (p) => { const n = G.data.npcs?.[p?.npcId]; if (n) logSoon('talk', `${n.name}${josa(n.name, '과/와')} 대화`, { npcId: p.npcId }, 'npcId'); });
      G.bus.on('zone:enter', (p) => { if (p?.first && p.zone) logSoon('visit', `${p.zone.name} 첫 방문`, { zoneId: p.zoneId }, 'zoneId'); });
    },
    onStateLoaded(state) {
      if (!Array.isArray(state.journal)) state.journal = [];
      this._draft = null;
      for (const id of MODAL_IDS) G.ui.modal.get(id)?.close();
    },
    onLogout() {
      this._draft = null;
      for (const id of MODAL_IDS) G.ui.modal.get(id)?.close();
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
      const activityText = clip(entry.activity ?? [tasks.map((t) => TASK[t].label).join(', '), note].filter(Boolean).join(' · '), LIMIT.note + 120);
      if (!activityText && !learned) return null;
      const zoneId = zoneOf(entry.zoneId) ? entry.zoneId : currentZoneId();
      const now = G.time.now();
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
        photo: safeSrc(entry.photo) || null,
        photoId: entry.photo && entry.photoId ? String(entry.photoId).slice(0, 64) : null,
        eduIds: Array.isArray(entry.eduIds) ? entry.eduIds.filter((x) => G.data.education?.[x]).slice(0, 12) : [],
      };
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
      const pre = opts.prefill || {};
      const autoT = autoTasks();
      const restoring = !!this._draft?.touched && !opts.prefill;
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
      if (d.photoSource === 'upload' && d.photo && /^data:/.test(d.photo) && G.net?.mode === 'server') {
        ctx.busy = true;
        ctx.saveBtn.disabled = true;
        ctx.saveBtn.lastChild.textContent = '사진 올리는 중…';
        try { photo = await uploadPhoto(d.photo); }
        catch (e) {
          G.log.warn('API', 'journal photo upload failed, keeping the thumbnail', e);
          G.ui.toast('사진을 서버에 올리지 못해 작은 사진으로 저장했어요.', { type: 'warn' });
          photo = d.photo;
        } finally {
          ctx.busy = false;
          if (!ctx.m.closed) { ctx.saveBtn.disabled = false; ctx.saveBtn.lastChild.textContent = '저장하기'; }
        }
        if (!G.state) return;
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
        const src = safeSrc(e.photo);
        const tasks = (e.tasks || []).filter((t) => TASK[t]).slice(0, 6).map((t) => `<span class="emoji" title="${esc(TASK[t].label)}">${TASK[t].icon}</span>`).join('');
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
      if (!e) { G.ui.toast('일지를 찾을 수 없어요.', { type: 'warn' }); return null; }
      const z = zoneOf(e.zoneId);
      const src = safeSrc(e.photo);
      const tasks = (e.tasks || []).filter((t) => TASK[t]).map((t) => `<span class="jr-chip on static"><span class="emoji">${TASK[t].icon}</span>${esc(TASK[t].label)}</span>`).join('');
      const sec = (label, icon, val) => (val ? `<section class="jr-sec"><h4><span class="emoji">${icon}</span>${esc(label)}</h4><p>${esc(val)}</p></section>` : '');
      const body = `<div class="jr-paper">
          <header class="jr-paper-head"><div><div class="jr-paper-date">${esc(fmtDate(e.date))}</div><div class="jr-paper-zone" style="--zc:${esc(z?.color || '#9aa88f')}"><span class="ico ico-sm" data-icon="pin"></span>${esc(z?.name || e.zoneName || '체험관')}</div></div><div class="jr-paper-stamp">작업일지</div></header>
          ${src ? `<figure class="jr-paper-photo"><img src="${esc(src)}" alt="일지 사진"></figure>` : ''}
          ${tasks ? `<div class="jr-paper-tasks">${tasks}</div>` : ''}
          ${sec('작업', '🧑‍🌾', e.note || (tasks ? '' : e.activity))}
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
