// =============================================================================
// 62-engagement.js — "오늘의 체험" hub (G.sys.engagement, order 84): one bell, one modal, six tabs
//                    출석 체크 · 오늘의 미션 · 알림함 · 수료증 · 랭킹 · 꾸미기
//
//   open(tab?) / close() / toggle(tab?) / isOpen()       hub modal (id 'engagement', modal-lg). Tabs:
//        checkin | missions | inbox | cert | rank | decor   hotkey N, action `engagement` (HUD bell next to the
//                                                         top-left profile card, unread badge with a wiggle)
//   unreadCount() -> number                               unread notifications + rewards waiting (app menu badge)
//   canCheckin() -> {ok, reason, day, streak, pos}        checkin() -> {day, streak, pos, reward} | null
//   missions() -> [{id, icon, text, target, progress, done, claimed}]   claimMission(id) / claimBonus()
//   notify({type, title, text, icon, act, ref, key, read}) -> notification   markAllRead() / notifications()
//   hasCertificate() / renderCertificate({preview}) -> canvas / downloadCertificate() / printCertificate()
//   ranking({force}) -> Promise<{mode, rows:[{rank, nickname, level, exp, title, me}], me, error}>
//   startDecor() / stopDecor() / placeDecor(item, cx, cz, rot) / removeDecor(id) / rotateDecor(id)
//   yard() -> {x, z, rot, name, cells, ...} | null / decorList()
// Events: engagement:checkin {day, streak, pos, reward} · engagement:mission {missionId, state:'completed'|'claimed'|'bonus', day}
//         engagement:decor {action:'place'|'remove'|'rotate', id, item} · engagement:notify {notification}
// State (created lazily, repaired on every load — imported/odd data is tolerated):
//   G.state.engagement = { v, checkin:{lastDay, streak, best, total, days[], shownDay},
//     daily:{day, missions:[{id, target, progress, done, claimed, param, seen[]}], bonus},
//     notifications:[{id, t, type, icon, title, text, read, act, ref, key, count}],   (newest first, max 100)
//     decor:[{id, item, x, z, rot, cx, cz, at}], yard:{v, x, z, rot, name}, certificate:{issuedAt, no} }
// Day keys are the LOCAL calendar date of G.time.now() (server-adjusted in server mode). Clock-skew rules:
// a day key is granted at most once, never when it is not later than the last claimed day; missions only
// roll forward. Missions are picked deterministically from (profile id + date).
// Security (CSP §11.1): dynamic text only via textContent / G.ui.h children; nicknames on the certificate and the
// yard sign are drawn with canvas fillText; no inline handlers, no eval, no external URLs; server data sanitized.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp;
  const TAU = Math.PI * 2;
  const now = () => G.time.now();
  const fmt = (n) => U.fmt(n);
  const h = (...a) => G.ui.h(...a);
  const CAT = 'ENGAGE';

  const STATE_V = 1, YARD_V = 1;
  const MAX_NOTI = 100, MAX_DECOR = 12, MAX_DAYS = 60;
  const YW = 7, YD = 5, CELL = 1;                 // personal yard: 7 x 5 cells of 1 m
  const YARD_ID = 'ENG_YARD';
  const HUB_ID = 'engagement';
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const SERIF = '"Nanum Myeongjo","Noto Serif KR","Noto Serif CJK KR","AppleMyungjo","Batang",serif';
  const TABS = [
    { id: 'checkin', label: '출석 체크', icon: '📅' },
    { id: 'missions', label: '오늘의 미션', icon: '🎯' },
    { id: 'inbox', label: '알림함', icon: '🔔' },
    { id: 'cert', label: '수료증', icon: '📜' },
    { id: 'rank', label: '랭킹', icon: '🏆' },
    { id: 'decor', label: '꾸미기', icon: '🏡' },
  ];
  const TAB_IDS = TABS.map((t) => t.id);

  // ---------------------------------------------------------------- small safe helpers
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const CTRL_RE = /[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
  /** untrusted value -> trimmed plain string without control / bidi characters (max graphemes-ish by code points) */
  function str(v, max = 200) {
    if (typeof v !== 'string') return '';
    const s = v.replace(CTRL_RE, '').trim();
    if (s.length <= max) return s;
    return Array.from(s).slice(0, max).join('');
  }
  function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function int(v, lo, hi, d = lo) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : d; }
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
  const reduceMotion = () => !!G.settings?.reduceMotion || G.settings?.fxLevel === 'off';
  function josa(word, pair) {
    const [a, b] = pair.split('/');
    const s = String(word ?? '');
    const c = s.charCodeAt(s.length - 1);
    let fin;
    if (c >= 0xac00 && c <= 0xd7a3) { const j = (c - 0xac00) % 28; fin = j > 0 && !(pair === '으로/로' && j === 8); }
    else fin = /[013678lmnr]$/i.test(s);
    return s + (fin ? a : b);
  }
  const itemName = (id) => G.data.items?.[id]?.name || id;
  const itemIcon = (id) => G.data.items?.[id]?.icon || '🎁';

  // ---------------------------------------------------------------- local calendar days
  const pad2 = (n) => String(n).padStart(2, '0');
  function dayKey(ts = now()) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /** noon of a day key (DST-safe arithmetic) or NaN */
  function dayTs(key) {
    const m = typeof key === 'string' ? DAY_RE.exec(key) : null;
    if (!m) return NaN;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : NaN;
  }
  const validDay = (k) => Number.isFinite(dayTs(k));
  function addDays(key, n) { const t = dayTs(key); if (!Number.isFinite(t)) return null; const d = new Date(t); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function dayLabel(key, long = false) {
    const t = dayTs(key);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return long ? `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})` : `${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}`;
  }
  function msToMidnight() {
    const n = new Date(now());
    return Math.max(0, new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0).getTime() - n.getTime());
  }
  function hms(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`; }
  function ago(t) {
    const s = Math.max(0, (now() - t) / 1000);
    if (s < 45) return '방금 전';
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
    const dd = Math.round((dayTs(dayKey()) - dayTs(dayKey(t))) / 86400000);
    if (dd <= 0) return `${Math.floor(s / 3600)}시간 전`;
    if (dd === 1) return '어제';
    if (dd < 7) return `${dd}일 전`;
    return U.formatDate(t);
  }

  // ---------------------------------------------------------------- rewards (kept modest: the server explains them
  // as "unexplained" gains inside its per-save allowance / daily budget — see server/lib/SaveValidator.php)
  const CHECKIN = [
    { coin: 50, exp: 20 },
    { coin: 80, items: { ITEM_SEED_BEAN: 2 } },
    { coin: 100, exp: 30 },
    { coin: 120, items: { ITEM_SEED_LAVENDER: 1 } },
    { coin: 150, exp: 40 },
    { coin: 180, items: { ITEM_SEED_CORN: 2 } },
    { coin: 250, exp: 50, deco: true },          // day 7: a yard decoration (rotates weekly)
  ];
  const DECOR_ITEMS = ['ITEM_SMALL_JAR', 'ITEM_FLOWERPOT', 'ITEM_LANTERN'];
  const DECOR_INFO = {
    ITEM_SMALL_JAR: { r: 0.33, h: 0.66, short: '장독' },
    ITEM_FLOWERPOT: { r: 0.27, h: 0.62, short: '화분' },
    ITEM_LANTERN: { r: 0.2, h: 1.55, short: '초롱' },
  };
  const BONUS_SEEDS = ['ITEM_SEED_PEPPER', 'ITEM_SEED_CABBAGE', 'ITEM_SEED_PERILLA', 'ITEM_SEED_RADISH', 'ITEM_SEED_MINT', 'ITEM_SEED_ROSEMARY', 'ITEM_SEED_LEMONBALM'];
  const posOf = (streak) => ((Math.max(1, streak) - 1) % 7) + 1;
  function checkinReward(streak) {
    const pos = posOf(streak);
    const base = CHECKIN[pos - 1];
    const r = { coin: base.coin || 0, exp: base.exp || 0, items: {} };
    for (const [id, q] of Object.entries(base.items || {})) if (G.data.items?.[id]) r.items[id] = q;
    if (base.deco) { const id = DECOR_ITEMS[Math.floor((Math.max(1, streak) - 1) / 7) % DECOR_ITEMS.length]; if (G.data.items?.[id]) r.items[id] = 1; }
    return r;
  }

  // ---------------------------------------------------------------- daily mission pool
  const zoneName = (id) => G.world?.zoneById?.(id)?.name || (G.data.zones || []).find((z) => z.id === id)?.name || '구역';
  const LOOK_KINDS = new Set(['exhibit', 'tool', 'jardisp', 'sign', 'kiosk', 'board']);
  const hasSeeds = () => Object.entries(G.state?.inventory || {}).some(([id, q]) => q > 0 && G.data.items?.[id]?.type === 'seed');
  const MISSIONS = {
    M_WATER: { icon: '💧', cat: 'farm', ev: 'farm:watered', min: 2, max: 3, text: (n) => `작물에 물 ${n}번 주기`, hint: '전통작물·허브 구역의 밭에서 E 키로 물을 줄 수 있어요.', go: 'ZONE_CROP', reward: { coin: 120, exp: 25 } },
    M_HARVEST: { icon: '🧺', cat: 'farm', ev: 'farm:harvested', min: 1, max: 2, text: (n) => `다 자란 작물 ${n}번 수확하기`, hint: '성장률 100%가 된 밭에서 수확할 수 있어요.', go: 'ZONE_CROP', reward: { coin: 150, exp: 35 } },
    M_PLANT: { icon: '🌱', cat: 'farm', ev: 'farm:planted', min: 1, max: 2, when: () => hasSeeds(), text: (n) => `빈 밭에 씨앗 ${n}번 심기`, hint: '빈 밭에서 E 키를 눌러 가방 속 씨앗을 심어요.', go: 'ZONE_HERB', reward: { coin: 120, exp: 25 } },
    M_QUIZ: { icon: '✅', cat: 'learn', ev: 'quiz:answered', min: 1, max: 1, filter: (p) => p.correct === true, text: () => '전통발효 퀴즈 1문제 맞히기', hint: '안내판·키오스크 교육을 끝까지 보면 퀴즈를 풀 수 있어요.', go: 'ZONE_EDUCATION', reward: { coin: 150, exp: 35 } },
    M_EDU: { icon: '📘', cat: 'learn', ev: 'edu:viewed', min: 1, max: 2, distinct: 'eduId', text: (n) => `교육 콘텐츠 ${n}개 살펴보기`, hint: '키오스크·안내판·전시대에서 교육 콘텐츠를 볼 수 있어요.', go: 'ZONE_EDUCATION', reward: { coin: 120, exp: 25, edu: 5 } },
    M_JOURNAL: { icon: '📝', cat: 'record', ev: 'journal:created', min: 1, max: 1, text: () => '작업일지 1번 쓰기', hint: 'J 키로 작업일지를 열어 오늘의 체험을 기록해요.', act: 'journal', reward: { coin: 150, exp: 35 } },
    M_PHOTO: { icon: '📸', cat: 'record', ev: 'photo:taken', min: 1, max: 2, text: (n) => `기념사진 ${n}장 찍기`, hint: 'P 키로 사진 모드! 포토존에서 찍으면 더 멋져요.', act: 'photo', reward: { coin: 120, exp: 25 } },
    M_CHAT: { icon: '💬', cat: 'social', ev: 'chat:sent', min: 1, max: 1, text: () => '채팅으로 인사 한마디 하기', hint: 'Enter 키로 채팅창을 열고 다른 체험객에게 인사해요.', act: 'chat', reward: { coin: 100, exp: 20 } },
    M_EMOTE: { icon: '😊', cat: 'social', ev: 'emote:played', min: 2, max: 2, text: (n) => `이모지 ${n}번 보내기`, hint: 'T 키로 이모지를 골라 마음을 표현해요.', act: 'emote', reward: { coin: 100, exp: 20 } },
    M_GESTURE: { icon: '🙌', cat: 'social', ev: 'gesture:played', min: 1, max: 2, text: (n) => `제스처 ${n}번 하기`, hint: 'G 키로 인사·박수 같은 제스처를 해 봐요.', act: 'gesture', reward: { coin: 100, exp: 20 } },
    M_TALK: { icon: '🗣️', cat: 'people', ev: 'npc:talk', min: 1, max: 2, distinct: 'npcId', text: (n) => `NPC ${n}명과 이야기하기`, hint: 'NPC에게 다가가 E 키로 말을 걸어요.', go: 'ZONE_MAIN', reward: { coin: 120, exp: 25 } },
    M_VISIT: { icon: '🗺️', cat: 'explore', ev: 'zone:enter', min: 1, max: 1, param: 'zone', filter: (p, m) => p.zoneId === m.param, text: (n, m) => `${zoneName(m.param)} 방문하기`, hint: '걸어가도 좋고, 빠른 이동으로 가도 좋아요.', go: '@param', reward: { coin: 120, exp: 25 } },
    M_WALK: { icon: '👟', cat: 'explore', ev: 'player:distance', min: 300, max: 300, amount: (p) => clamp(num(p.meters), 0, 60), unit: 'm', text: (n) => `체험관 안을 ${n}m 산책하기`, hint: 'WASD로 걸으면 거리가 쌓여요. 순간 이동은 포함되지 않아요.', reward: { coin: 150, exp: 30 } },
    M_JAR: { icon: '🏺', cat: 'ferment', ev: 'ferment:checked', min: 1, max: 1, text: () => '내 장독 발효 상태 확인하기', hint: '장독대의 빛나는 내 장독을 E 키로 살펴봐요.', go: 'ZONE_JANGDOKDAE', reward: { coin: 120, exp: 25 } },
    M_CRAFT: { icon: '🔨', cat: 'ferment', ev: 'craft:done', min: 1, max: 1, when: (c) => c.level >= 3, text: () => '작업대에서 발효 재료 만들기', hint: '발효식품 구역의 작업대에서 재료를 만들 수 있어요.', go: 'ZONE_FERMENTATION', reward: { coin: 180, exp: 40 } },
    M_LOOK: { icon: '🔍', cat: 'explore2', ev: 'interact', min: 3, max: 3, distinct: 'id', filter: (p) => LOOK_KINDS.has(p.kind) && p.id !== YARD_ID, text: (n) => `전시물·도구 ${n}가지 살펴보기`, hint: '전시대·전통도구·옹기·안내판을 E 키로 살펴봐요.', go: 'POI_TOOLS', reward: { coin: 120, exp: 25 } },
  };
  const MISSION_EVENTS = [...new Set(Object.values(MISSIONS).map((m) => m.ev))];
  function missionText(m) { const def = MISSIONS[m.id]; return def ? def.text(m.target, m) : ''; }
  function bonusReward(day) {
    const pid = String(G.state?.profile?.id ?? 'guest');
    const rng = U.rng(`bonus|${pid}|${day}`);
    const seed = BONUS_SEEDS[Math.floor(rng() * BONUS_SEEDS.length)];
    const r = { coin: 200, exp: 50, items: {} };
    if (G.data.items?.[seed]) r.items[seed] = 1;
    return r;
  }

  // ---------------------------------------------------------------- notifications
  const NTYPES = { achievement: '🏆', quest: '📜', level: '⭐', collection: '📖', reward: '🎁', mention: '💬', ferment: '🏺', mission: '🎯', checkin: '📅', cert: '🎓', decor: '🏡', system: '🔔' };
  const NACTS = new Set(['quests', 'achievements', 'collection', 'profile', 'jar', 'chat', 'inventory', 'checkin', 'missions', 'inbox', 'cert', 'rank', 'decor']);
  function cleanNoti(n) {
    if (!isObj(n)) return null;
    const title = str(n.title, 80);
    if (!title) return null;
    const type = typeof n.type === 'string' && own(NTYPES, n.type) ? n.type : 'system';
    const t = num(n.t, 0);
    return {
      id: typeof n.id === 'string' && ID_RE.test(n.id) ? n.id : U.uid('n'),
      t: t > 0 ? Math.min(t, now() + 86400000) : now(),
      type,
      icon: str(n.icon, 8) || NTYPES[type],
      title,
      text: str(n.text, 200),
      read: n.read === true,
      act: typeof n.act === 'string' && NACTS.has(n.act) ? n.act : null,
      ref: typeof n.ref === 'string' && ID_RE.test(n.ref) ? n.ref : null,
      key: str(n.key, 60) || null,
      count: int(n.count, 1, 999, 1),
    };
  }
  function rewardText(r) {
    const p = [];
    if (r?.coin) p.push(`${fmt(r.coin)} 코인`);
    if (r?.exp) p.push(`EXP ${fmt(r.exp)}`);
    if (r?.edu) p.push(`교육 ${fmt(r.edu)}`);
    for (const [id, q] of Object.entries(r?.items || {})) p.push(`${itemName(id)} ×${q}`);
    return p.join(' · ');
  }
  function rewardChips(r, cls = '') {
    const box = h('div', { class: `eng-rw ${cls}` });
    if (r?.coin) box.appendChild(h('span', { class: 'eng-rw-chip coin' }, h('span', { class: 'ico ico-sm', 'data-icon': 'coin' }), fmt(r.coin)));
    if (r?.exp) box.appendChild(h('span', { class: 'eng-rw-chip exp' }, '✨ ', fmt(r.exp)));
    if (r?.edu) box.appendChild(h('span', { class: 'eng-rw-chip edu' }, '📘 ', fmt(r.edu)));
    for (const [id, q] of Object.entries(r?.items || {})) box.appendChild(h('span', { class: 'eng-rw-chip item', title: itemName(id) }, h('span', { class: 'emoji' }, itemIcon(id)), ` ×${q}`));
    G.ui.hydrateIcons(box);
    return box;
  }

  /** apply a reward bundle through the progression system (fallback: plain state edits) */
  function grant(reward, reason) {
    if (!G.state || !reward) return null;
    const r = { coin: int(reward.coin, 0, 1e6, 0), exp: int(reward.exp, 0, 1e6, 0), edu: int(reward.edu, 0, 1e6, 0), items: {} };
    for (const [id, q] of Object.entries(reward.items || {})) if (G.data.items?.[id] && int(q, 0, 999, 0) > 0) r.items[id] = int(q, 0, 999, 0);
    const P = G.sys.progression;
    if (P && !P._failed && typeof P.grant === 'function') return P.grant(r, { reason, popup: false }) || r;
    const s = G.state.stats || (G.state.stats = {});
    s.coin = (Number(s.coin) || 0) + r.coin;
    s.edu = (Number(s.edu) || 0) + r.edu;
    s.exp = (Number(s.exp) || 0) + r.exp;
    s.expTotal = (Number(s.expTotal) || 0) + r.exp;
    for (const [id, q] of Object.entries(r.items)) invGive(id, q, reason);
    G.ui.toast(`보상: ${rewardText(r)}`, { type: 'reward' });
    G.dirty('reward');
    return r;
  }
  /** server mode: persist each claim right away so the server validates it in its own small window */
  function serverSave() { if (G.save?.adapter?.name === 'server' && G.state) { try { G.save.save({ reason: 'engagement' }); } catch (e) { /* retried by autosave */ } } }
  const invCount = (id) => (G.sys.inventory?.count ? G.sys.inventory.count(id) : int(G.state?.inventory?.[id], 0, 1e6, 0));
  function invTake(id, source = 'decor') {
    if (!G.state) return false;
    if (G.sys.inventory?.remove && !G.sys.inventory._failed) return G.sys.inventory.remove(id, 1, { source });
    const inv = G.state.inventory || (G.state.inventory = {});
    if (!((Number(inv[id]) || 0) >= 1)) return false;
    inv[id] = Number(inv[id]) - 1;
    if (!inv[id]) delete inv[id];
    G.bus.emit('item:removed', { itemId: id, qty: 1, source });
    G.dirty('inventory');
    return true;
  }
  function invGive(id, q = 1, source = 'decor') {
    if (!G.state || !G.data.items?.[id]) return false;
    if (G.sys.inventory?.add && !G.sys.inventory._failed) return G.sys.inventory.add(id, q, { source, silent: true }) >= q;
    const inv = G.state.inventory || (G.state.inventory = {});
    const cur = Number(inv[id]) || 0;
    if (cur + q > 999) return false;
    inv[id] = cur + q;
    G.bus.emit('item:added', { itemId: id, qty: q, source });
    G.dirty('inventory');
    return true;
  }

  // ---------------------------------------------------------------- state normalization
  const NORMALIZED = new WeakSet();
  function cleanMission(m) {
    if (!isObj(m) || typeof m.id !== 'string' || !own(MISSIONS, m.id)) return null;
    const def = MISSIONS[m.id];
    const target = int(m.target, 1, 100000, def.min);
    const progress = clamp(num(m.progress, 0), 0, target);
    let param = null;
    if (def.param === 'zone') {
      if (typeof m.param !== 'string' || !(G.data.zones || []).some((z) => z.id === m.param)) return null;
      param = m.param;
    }
    const done = m.done === true || progress >= target;
    return {
      id: m.id, target, progress: done ? target : progress, done, claimed: done && m.claimed === true, param,
      seen: Array.isArray(m.seen) ? m.seen.filter((s) => typeof s === 'string' && s.length <= 48).slice(-20) : [],
      doneAt: num(m.doneAt, 0) || null,
    };
  }
  function normalizeState(raw, refunds) {
    const e = isObj(raw) ? raw : {};
    e.v = STATE_V;
    // check-in
    const c = isObj(e.checkin) ? e.checkin : (e.checkin = {});
    c.lastDay = validDay(c.lastDay) ? c.lastDay : null;
    c.streak = c.lastDay ? int(c.streak, 1, 100000, 1) : 0;
    c.best = Math.max(int(c.best, 0, 100000, 0), c.streak);
    let days = Array.isArray(c.days) ? c.days.filter(validDay) : [];
    if (c.lastDay && !days.includes(c.lastDay)) days.push(c.lastDay);
    days = [...new Set(days)].sort().slice(-MAX_DAYS);
    c.days = days;
    c.total = Math.max(int(c.total, 0, 1e6, 0), days.length);
    c.shownDay = validDay(c.shownDay) ? c.shownDay : null;
    for (const k of Object.keys(c)) if (!['lastDay', 'streak', 'best', 'days', 'total', 'shownDay'].includes(k)) delete c[k];
    e.checkin = c;
    // daily missions
    const d = isObj(e.daily) ? e.daily : {};
    const seenIds = new Set();
    const missions = (Array.isArray(d.missions) ? d.missions : []).map(cleanMission).filter((m) => m && !seenIds.has(m.id) && seenIds.add(m.id)).slice(0, 3);
    e.daily = { day: validDay(d.day) ? d.day : null, missions, bonus: d.bonus === true && missions.length > 0 && missions.every((m) => m.claimed) };
    if (missions.length < 3) e.daily.day = e.daily.day && missions.length ? e.daily.day : null;
    // notifications (newest first)
    const seenN = new Set();
    e.notifications = (Array.isArray(e.notifications) ? e.notifications : []).map(cleanNoti)
      .filter((n) => n && !seenN.has(n.id) && seenN.add(n.id)).sort((a, b) => b.t - a.t).slice(0, MAX_NOTI);
    // decorations: valid entries only; extras over the cap are refunded later by the yard setup
    const seenD = new Set();
    const decor = [];
    for (const x of Array.isArray(e.decor) ? e.decor : []) {
      if (!isObj(x) || typeof x.item !== 'string' || !DECOR_ITEMS.includes(x.item)) continue;
      const id = typeof x.id === 'string' && ID_RE.test(x.id) && !seenD.has(x.id) ? x.id : U.uid('d');
      seenD.add(id);
      const rec = {
        id, item: x.item,
        x: clamp(num(x.x, NaN), -200, 200), z: clamp(num(x.z, NaN), -200, 200),
        rot: Math.round(((num(x.rot, 0) % TAU) + TAU) % TAU / (Math.PI / 4)) % 8 * (Math.PI / 4),
        cx: Number.isInteger(x.cx) && x.cx >= 0 && x.cx < YW ? x.cx : null,
        cz: Number.isInteger(x.cz) && x.cz >= 0 && x.cz < YD ? x.cz : null,
        at: num(x.at, 0) || now(),
      };
      if (decor.length >= MAX_DECOR) { refunds.push(rec.item); continue; }
      decor.push(rec);
    }
    e.decor = decor;
    // yard + certificate
    e.yard = isObj(e.yard) && Number.isFinite(num(e.yard.x, NaN)) && Number.isFinite(num(e.yard.z, NaN))
      ? { v: int(e.yard.v, 0, 1000, 0), x: num(e.yard.x), z: num(e.yard.z), rot: num(e.yard.rot, 0), name: str(e.yard.name, 30) || '내 마당' } : null;
    e.certificate = isObj(e.certificate) && num(e.certificate.issuedAt, 0) > 0
      ? { issuedAt: num(e.certificate.issuedAt), no: /^[0-9A-Z-]{4,20}$/.test(String(e.certificate.no || '')) ? e.certificate.no : null } : null;
    for (const k of Object.keys(e)) if (!['v', 'checkin', 'daily', 'notifications', 'decor', 'yard', 'certificate'].includes(k)) delete e[k];
    return e;
  }

  // ---------------------------------------------------------------- 2D helpers (mascot, particles)
  const FALLBACK_MASCOT = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="eng-jar-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5532"/><stop offset="1" stop-color="#4a2a17"/></linearGradient></defs><ellipse cx="32" cy="59" rx="17" ry="3.2" fill="rgba(0,0,0,.28)"/><path d="M19 17c-9 10-9 30 2 40h22c11-10 11-30 2-40z" fill="url(#eng-jar-g)"/><path d="M17 31h30" stroke="#f4c54a" stroke-width="2.4" stroke-linecap="round" opacity=".9"/><ellipse cx="32" cy="15.5" rx="15" ry="5" fill="#3a2213"/><ellipse cx="32" cy="12" rx="5" ry="2.4" fill="#2a170d"/><circle cx="25.5" cy="40" r="2.6" fill="#1a0f08"/><circle cx="38.5" cy="40" r="2.6" fill="#1a0f08"/><circle cx="26.3" cy="39.2" r=".9" fill="#fff"/><circle cx="39.3" cy="39.2" r=".9" fill="#fff"/><ellipse cx="21.5" cy="45.5" rx="3" ry="1.8" fill="#ff8f8f" opacity=".7"/><ellipse cx="42.5" cy="45.5" rx="3" ry="1.8" fill="#ff8f8f" opacity=".7"/><path d="M28.5 46c1.8 2.2 5.2 2.2 7 0" stroke="#1a0f08" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="24" cy="27" rx="2.4" ry="5" fill="#fff" opacity=".14"/></svg>';
  function mascotSvg(mood = 'happy', size = 64) {
    try { const s = G.mascot?.svg?.(mood, size); if (typeof s === 'string' && /^\s*<svg[\s>]/i.test(s)) return s; } catch (e) { /* companion optional */ }
    return FALLBACK_MASCOT;
  }
  function say(text, opts) { try { G.mascot?.say?.(text, opts); } catch (e) { /* companion optional */ } }
  /** 2D confetti burst out of an element (CSS animated spans; removed after 1.1 s) */
  function burstAt(el, n = 16) {
    if (!el || reduceMotion()) return;
    const host = el.closest('.modal-body') || document.body;
    const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const box = h('div', { class: 'eng-burst', 'aria-hidden': 'true' });
    box.style.left = `${r.left - hr.left + host.scrollLeft + r.width / 2}px`;
    box.style.top = `${r.top - hr.top + host.scrollTop + r.height / 2}px`;
    const colors = ['#f4c54a', '#ff6b5e', '#34c36b', '#4aa8ff', '#ff7eb6', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.4;
      const d = 46 + Math.random() * 60;
      const s = h('i', { class: i % 3 ? 'p' : 'p round' });
      s.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
      s.style.setProperty('--dy', `${(Math.sin(a) * d - 18).toFixed(1)}px`);
      s.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
      s.style.setProperty('--c', colors[i % colors.length]);
      s.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
      box.appendChild(s);
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 1100);
  }
  function stampEl(text = '출석', anim = false) {
    return h('div', { class: `eng-stamp${anim ? ' anim' : ''}`, 'aria-hidden': 'true' }, h('span', null, text), h('i', { class: 'ink' }));
  }
  function bar(value, target, label, cls = '') {
    const pct = clamp(target > 0 ? (value / target) * 100 : 0, 0, 100);
    const b = h('div', { class: `bar bar-lg eng-bar ${cls}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(target), 'aria-valuenow': String(Math.floor(value)) }, h('i'), label ? h('span', null, label) : null);
    b.querySelector('i').style.width = `${pct.toFixed(1)}%`;
    return b;
  }

  // ---------------------------------------------------------------- 3D geometry helpers (procedural decorations)
  const _e3 = new THREE.Euler();
  function at(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e3.set(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    geo.applyMatrix4(m);
    return geo;
  }
  /** non-indexed geometry with position + normal + uniform vertex colour */
  function paint(geo, hex) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  function merge(list) {
    let g = null;
    try { g = ADDONS.BufferGeometryUtils?.mergeGeometries?.(list, false) || null; } catch (e) { g = null; }
    if (g) list.forEach((x) => x.dispose());
    else g = list[0];
    g.computeBoundingSphere();
    return g;
  }
  const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const _UP = new THREE.Vector3(0, 1, 0);
  function rod(x0, y0, z0, x1, y1, z1, r, hex, seg = 6, r2 = r) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const dir = b.clone().sub(a);
    const len = dir.length() || 0.001;
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_UP, dir.normalize()), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return paint(g, hex);
  }
  function geoJar() {
    const p = [];
    p.push(paint(lathe([[0, 0], [0.15, 0], [0.205, 0.03], [0.255, 0.12], [0.284, 0.24], [0.279, 0.33], [0.25, 0.42], [0.195, 0.485], [0.158, 0.512], [0.163, 0.53], [0.15, 0.545]], 22), '#5a321c'));
    p.push(paint(at(new THREE.TorusGeometry(0.2842, 0.007, 5, 28), 0, 0.2, 0, Math.PI / 2), '#7c4b2b'));
    p.push(paint(at(new THREE.TorusGeometry(0.237, 0.016, 6, 26), 0, 0.432, 0, Math.PI / 2), '#cdb06f'));       // 금줄 (straw rope)
    p.push(paint(at(new THREE.BoxGeometry(0.036, 0.075, 0.01), 0.0, 0.392, 0.244, 0.12, 0, 0), '#f3ecdc'));    // white paper
    p.push(paint(at(new THREE.CapsuleGeometry(0.014, 0.05, 2, 6), 0.085, 0.398, 0.228, 0.15, 0.35, 0.2), '#c8322b')); // red pepper
    p.push(paint(at(new THREE.BoxGeometry(0.03, 0.03, 0.03), -0.085, 0.405, 0.23, 0.3, -0.35, 0.4), '#1c1714'));    // charcoal
    p.push(paint(lathe([[0.182, 0.538], [0.19, 0.552], [0.172, 0.575], [0.12, 0.604], [0.05, 0.62], [0, 0.624]], 22), '#3d2213'));
    p.push(paint(at(new THREE.SphereGeometry(0.034, 10, 6), 0, 0.633, 0, 0, 0, 0, 1, 0.75, 1), '#3d2213'));
    return merge(p);
  }
  const FLOWER_TIPS = [[0.0, 0.575, 0.0], [0.085, 0.51, 0.045], [-0.08, 0.53, 0.035], [0.03, 0.49, -0.09], [-0.055, 0.475, -0.065]];
  function geoPotBase() {
    const p = [];
    p.push(paint(lathe([[0, 0], [0.125, 0], [0.142, 0.016], [0.186, 0.255], [0.19, 0.27]], 18), '#b2603a'));
    p.push(paint(at(new THREE.TorusGeometry(0.193, 0.026, 6, 22), 0, 0.282, 0, Math.PI / 2), '#c77749'));
    p.push(paint(at(new THREE.CylinderGeometry(0.174, 0.174, 0.02, 18), 0, 0.272, 0), '#4b2f1d'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      p.push(paint(at(new THREE.SphereGeometry(1, 7, 5), Math.sin(a) * 0.1, 0.33 + (i % 2) * 0.03, Math.cos(a) * 0.1, -0.5 - (i % 3) * 0.13, a, 0, 0.05, 0.014, 0.13), i % 2 ? '#3f8d3a' : '#5bae4b'));
    }
    for (const [x, y, z] of FLOWER_TIPS) {
      p.push(rod(x * 0.25, 0.28, z * 0.25, x, y - 0.01, z, 0.008, '#4f8f3c', 5));
      p.push(paint(at(new THREE.SphereGeometry(0.02, 7, 5), x, y + 0.004, z), '#ffcf3a'));
    }
    return merge(p);
  }
  /** petals are white so each pot can be tinted through instanceColor */
  function geoPotPetals() {
    const p = [];
    for (const [x, y, z] of FLOWER_TIPS) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        p.push(paint(at(new THREE.SphereGeometry(1, 7, 4), x + Math.cos(a) * 0.03, y, z + Math.sin(a) * 0.03, 0, -a, 0.25, 0.034, 0.01, 0.021), '#ffffff'));
      }
    }
    return merge(p);
  }
  const HOOK = new THREE.Vector3(0.3, 1.37, 0); // where the 청사초롱 hangs on its stand (local)
  function geoLanternStand() {
    const p = [];
    p.push(paint(at(new THREE.CylinderGeometry(0.13, 0.17, 0.07, 12), 0, 0.035, 0), '#4a3020'));
    p.push(rod(0, 0.07, 0, 0, 1.48, 0, 0.027, '#6b4428', 8, 0.022));
    p.push(rod(0, 1.42, 0, 0.34, 1.42, 0, 0.016, '#6b4428', 6));
    p.push(rod(0, 1.24, 0, 0.2, 1.42, 0, 0.009, '#5a3820', 5));
    p.push(paint(at(new THREE.SphereGeometry(0.036, 10, 6), 0, 1.5, 0), '#3a2416'));
    p.push(rod(0.3, 1.42, 0, 0.3, 1.37, 0, 0.006, '#26201a', 4));
    return merge(p);
  }
  function geoLanternSilk() { // origin = hook, hanging down
    const p = [];
    p.push(rod(0, 0, 0, 0, -0.07, 0, 0.005, '#2a1a10', 4));
    p.push(paint(at(new THREE.CylinderGeometry(0.065, 0.095, 0.03, 12), 0, -0.085, 0), '#3a2416'));
    p.push(paint(lathe([[0.118, -0.19], [0.122, -0.16], [0.118, -0.13], [0.1, -0.1]], 16), '#2b4ea6'));
    p.push(paint(lathe([[0.118, -0.4], [0.134, -0.35], [0.14, -0.295], [0.134, -0.24], [0.118, -0.19]], 16), '#c62f2a'));
    p.push(paint(lathe([[0.1, -0.49], [0.118, -0.46], [0.122, -0.43], [0.118, -0.4]], 16), '#2b4ea6'));
    p.push(paint(at(new THREE.CylinderGeometry(0.095, 0.065, 0.03, 12), 0, -0.505, 0), '#3a2416'));
    p.push(paint(at(new THREE.SphereGeometry(0.022, 8, 5), 0, -0.535, 0), '#d9a520'));
    p.push(paint(at(new THREE.CylinderGeometry(0.008, 0.03, 0.15, 6), 0, -0.62, 0), '#c62f2a'));
    return merge(p);
  }

  // ---------------------------------------------------------------- yard search
  const YARD_SPOTS = [ // preferred personal-yard spots (rest-garden path first, then the jangdokdae front)
    { x: 26, z: 38, rot: -0.64, name: '휴식정원 가는 길', bonus: 2 },
    { x: 26, z: 25, rot: -Math.PI / 4, name: '휴식정원 길목', bonus: 1.5 },
    { x: 16, z: -3, rot: 0, name: '장독대 앞 마당', bonus: 1 },
    { x: 15, z: 6, rot: 0, name: '장독대 앞 마당', bonus: 0.5 },
  ];
  const CORNERS = [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]];
  const DYNAMIC_TAG = /^(npc|decor|eng|companion|visitor|player|pet|remote)/;
  function colHit(c, x, z, pad) {
    if (c.shape === 'circle') { const dx = x - c.x, dz = z - c.z, r = c.r + pad; return dx * dx + dz * dz <= r * r; }
    const co = Math.cos(-(c.rot || 0)), si = Math.sin(-(c.rot || 0));
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * co + dz * si, lz = -dx * si + dz * co;
    return Math.abs(lx) <= (c.hw || 0) + pad && Math.abs(lz) <= (c.hd || 0) + pad;
  }
  const _rp = new THREE.Vector3();
  function readPos(e) {
    try {
      let v = e.position;
      if (typeof v === 'function') v = v();
      if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) return v;
      if (e.object?.getWorldPosition) return e.object.getWorldPosition(_rp);
    } catch (err) { /* broken provider */ }
    return null;
  }

  // ---------------------------------------------------------------- the system
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const _col = new THREE.Color();
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _hit = new THREE.Vector3();
  const DIRTY = new Set();

  const eng = {
    name: 'engagement', order: 84, label: '오늘의 체험',
    _modal: null, _tab: 'checkin', _pane: null, _tabsEl: null, _heroEl: null, _live: null,
    _loggedIn: false, _loginAt: 0, _today: null, _dayT: 0, _autoTimer: 0, _autoTries: 0, _busyAt: 0,
    _uiTimer: 0, _clockTimer: 0, _clockN: 0, _inboxViewed: false, _inboxFilter: 'all', _animUntil: 0,
    _badgeQueued: false, _lastBadge: -1, _bell: null, _bellBadge: null,
    _rank: null, _rankAt: 0, _rankBusy: null,
    _certCanvas: null, _certKey: '',
    _refunds: [], _yard: null, _edit: null, _starting: false, _bar: null, _recs: new Map(), _byType: {}, _pops: [], _3d: null,
    _mention: { at: 0, id: null }, _claimAt: 0,

    // ============================================================ lifecycle
    init() {
      this._buildBell();
      this._bindEvents();
      this._bindKeys();
      try { this._build3D(); } catch (e) { G.log.warn(CAT, 'decor 3D disabled', e?.message || e); this._3d = null; }
    },

    onStateLoaded(state) {
      if (!state) return;
      this.stopDecor({ silent: true });
      this._rank = null; this._certKey = '';
      const e = this._E();
      if (!e) return;
      this._today = dayKey();
      this._daily(); // roll missions forward if needed
      this._syncCertificate(true);
      try { this._setupYard(); } catch (err) { G.log.warn(CAT, 'yard setup failed', err?.message || err); }
      this._refreshBadge();
      this._uiDirty();
    },

    onLogout() {
      this.stopDecor({ silent: true });
      this.close();
      this._loggedIn = false;
      clearTimeout(this._autoTimer);
      clearInterval(this._clockTimer);
      this._rank = null; this._rankBusy = null; this._certCanvas = null; this._certKey = '';
      this._clear3D();
      G.interact?.unregister?.(YARD_ID);
      this._yard = null;
      this._refunds.length = 0;
      this._lastBadge = -1;
      if (this._bell) { this._bell.classList.remove('has-unread', 'has-claim'); this._bellBadge.hidden = true; }
    },

    update(dt, t) {
      if (!G.state) return;
      // day rollover (local midnight / clock change)
      this._dayT -= dt;
      if (this._dayT <= 0) {
        this._dayT = 1;
        const k = dayKey();
        if (k !== this._today) { const prev = this._today; this._today = k; if (prev) this._onNewDay(prev, k); }
      }
      if (this._3d) this._update3D(dt, t);
    },

    // ============================================================ state
    /** G.state.engagement, created / repaired lazily */
    _E() {
      const st = G.state;
      if (!st || typeof st !== 'object') return null;
      const cur = st.engagement;
      if (cur && NORMALIZED.has(cur)) return cur;
      const e = normalizeState(cur, this._refunds);
      st.engagement = e;
      NORMALIZED.add(e);
      return e;
    },
    /** today's mission record (generates / rolls forward; never rolls back when the clock goes backwards) */
    _daily() {
      const e = this._E();
      if (!e) return null;
      const today = dayKey();
      const d = e.daily;
      if (!d.day || today > d.day) this._genMissions(today);
      else if (d.missions.length < 3) this._genMissions(d.day, d); // repaired data: keep what survived
      return e.daily;
    },
    _genMissions(day, keep = null) {
      const e = this._E();
      const pid = String(G.state.profile?.id ?? 'guest');
      const rng = U.rng(`mission|${pid}|${day}`);
      const ids = Object.keys(MISSIONS);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp; }
      const ctx = { level: Number(G.state.stats?.level) || 1 };
      const out = [];
      const cats = new Set();
      for (let pass = 0; pass < 2 && out.length < 3; pass++) {
        for (const id of ids) {
          if (out.length >= 3) break;
          if (out.some((m) => m.id === id)) continue;
          const def = MISSIONS[id];
          let ok = true;
          try { ok = !def.when || !!def.when(ctx); } catch (err) { ok = false; }
          if (!ok || (pass === 0 && cats.has(def.cat))) continue;
          cats.add(def.cat);
          const r = U.rng(`${pid}|${day}|${id}`);
          const target = def.min + Math.floor(r() * (def.max - def.min + 1));
          let param = null;
          if (def.param === 'zone') {
            const zones = (G.data.visitZones || []).filter((z) => z !== 'ZONE_MAIN' && (G.data.zones || []).some((x) => x.id === z));
            if (!zones.length) continue;
            param = zones[Math.floor(r() * zones.length)];
          }
          out.push({ id, target, progress: 0, done: false, claimed: false, param, seen: [], doneAt: null });
        }
      }
      if (keep && keep.day === day) {
        for (const m of out) { const old = keep.missions.find((x) => x.id === m.id); if (old) Object.assign(m, old); }
      }
      e.daily = { day, missions: out, bonus: !!(keep && keep.day === day && keep.bonus && out.every((m) => m.claimed)) };
      G.dirty('engagement');
      G.log.info(CAT, `daily missions ${day}: ${out.map((m) => m.id).join(', ')}`);
    },
    _onNewDay(prev, today) {
      if (!G.state) return;
      this._daily();
      this._refreshBadge();
      this._uiDirty();
      if (today > prev) {
        G.ui.toast('새로운 하루가 시작됐어요! 출석 체크와 오늘의 미션을 확인해 보세요.', { emoji: '🌅', type: 'info' });
        this._rank = null;
      }
    },

    // ============================================================ HUD bell + badge
    _buildBell() {
      const hud = document.getElementById('hud');
      if (!hud || document.getElementById('hud-bell')) return;
      const b = h('button', { id: 'hud-bell', class: 'glass hud-bell', type: 'button', 'data-action': 'engagement', 'aria-label': '오늘의 체험 열기 — 출석·미션·알림 (N)', title: '오늘의 체험 (N)' },
        h('span', { class: 'ico hud-bell-ico', 'data-icon': 'bell' }),
        h('span', { class: 'badge hud-bell-badge', hidden: true }));
      hud.appendChild(b);
      this._bell = b;
      this._bellBadge = b.querySelector('.hud-bell-badge');
      G.ui.onAction('engagement', () => this.toggle());
      const place = () => this._placeBell();
      const prof = document.getElementById('hud-profile');
      if (prof && typeof ResizeObserver !== 'undefined') { try { new ResizeObserver(place).observe(prof); } catch (e) { /* fallback: resize */ } }
      window.addEventListener('resize', U.throttle(place, 150));
      requestAnimationFrame(place);
    },
    _placeBell() {
      const b = this._bell, prof = document.getElementById('hud-profile');
      if (!b || !prof || !prof.getClientRects().length) return;
      // layout box (offset*) ignores the HUD entry animation's translate, unlike getBoundingClientRect
      const w = prof.offsetWidth;
      if (!(w > 0) || prof.offsetParent !== b.offsetParent) return;
      b.style.left = `${Math.round(prof.offsetLeft + w + 8)}px`;
      b.style.top = `${Math.round(prof.offsetTop + 2)}px`;
    },
    _counts() {
      const e = this._E();
      if (!e) return { unread: 0, claims: 0, check: false, missionClaims: 0, bonus: false };
      let unread = 0;
      for (const n of e.notifications) if (!n.read) unread++;
      const check = this.canCheckin().ok;
      const d = this._daily();
      let missionClaims = 0;
      for (const m of d?.missions || []) if (m.done && !m.claimed) missionClaims++;
      const bonus = !!d && !d.bonus && d.missions.length > 0 && d.missions.every((m) => m.claimed);
      return { unread, claims: (check ? 1 : 0) + missionClaims + (bonus ? 1 : 0), check, missionClaims, bonus };
    },
    unreadCount() { const c = this._counts(); return c.unread + c.claims; },
    _refreshBadge() {
      if (this._badgeQueued) return;
      this._badgeQueued = true;
      setTimeout(() => {
        this._badgeQueued = false;
        const b = this._bell;
        if (!b) return;
        const c = this._counts();
        const n = G.state ? c.unread + c.claims : 0;
        const badge = this._bellBadge;
        badge.hidden = !n;
        badge.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('has-unread', n > 0);
        b.classList.toggle('has-claim', c.claims > 0);
        b.setAttribute('aria-label', n ? `오늘의 체험 열기 — 새 소식 ${n}개 (N)` : '오늘의 체험 열기 — 출석·미션·알림 (N)');
        if (n > this._lastBadge && this._lastBadge >= 0 && !reduceMotion()) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
        this._lastBadge = n;
        this._renderTabBadges(c);
        this._renderHero();
      }, 0);
    },

    // ============================================================ events
    _bindEvents() {
      const on = (name, fn) => G.bus.on(name, (p) => { if (!G.state) return; try { fn(p || {}); } catch (e) { G.log.warn(CAT, `handler ${name}`, e?.message || e); } });
      for (const ev of MISSION_EVENTS) on(ev, (p) => this._missionEvent(ev, p));

      on('game:login', () => {
        this._loggedIn = true;
        this._loginAt = now();
        this._today = dayKey();
        this._mention = { at: 0, id: null };
        setTimeout(() => this._placeBell(), 60);
        setTimeout(() => this._placeBell(), 900); // after the HUD entry animation
        this._autoTries = 0;
        this._busyAt = 0;
        clearTimeout(this._autoTimer);
        this._autoTimer = setTimeout(() => this._autoCheckin(), 2600);
        this._refreshBadge();
      });
      on('achievement:unlocked', ({ id }) => {
        const a = G.data.achievements?.[id];
        if (!a) return;
        this.notify({ type: 'achievement', icon: a.icon || '🏆', title: `업적 달성: ${a.name}`, text: a.desc || '', act: 'achievements', ref: id });
      });
      on('quest:completed', ({ questId }) => {
        const q = G.data.quests?.[questId];
        if (!q) return;
        this.notify({ type: 'quest', icon: q.icon || '📜', title: `퀘스트 완료: ${q.title}`, text: '퀘스트 패널의 “보상 받기”를 눌러 보상을 받으세요.', act: 'quests', ref: questId });
      });
      on('quest:claimed', ({ questId, reward }) => {
        const q = G.data.quests?.[questId];
        if (!q) return;
        this.notify({ type: 'quest', icon: '🎁', title: `퀘스트 보상 수령: ${q.title}`, text: rewardText(reward || q.reward || {}), act: 'quests', ref: questId, read: true });
        if (questId === 'QUEST001') this._syncCertificate(false);
      });
      on('level:up', ({ level }) => {
        const lv = int(level, 1, 999, 1);
        const tname = G.data.levels?.titles?.[lv];
        this.notify({ type: 'level', icon: '⭐', title: `레벨 ${lv} 달성!`, text: tname ? `새 칭호 「${tname}」을(를) 얻었어요.` : '더 많은 체험이 기다리고 있어요.', act: 'profile' });
      });
      on('collection:unlocked', ({ id }) => {
        const c = G.data.collection?.[id];
        if (!c) return;
        const cat = (G.data.collectionCategories || []).find((k) => k.id === c.category)?.name || '';
        this.notify({ type: 'collection', icon: c.icon || '📖', title: `도감 등록: ${c.name}`, text: cat ? `${cat} 도감에 새로 등록됐어요.` : '도감에 새로 등록됐어요.', act: 'collection', ref: id });
      });
      on('reward:granted', ({ reward, reason }) => {
        const why = typeof reason === 'string' ? reason : '';
        if (/^(achievement:|quest:|engagement|harvest|craft)/.test(why)) return;
        const txt = rewardText(reward || {});
        if (!txt) return;
        if (/^quiz:/.test(why)) this.notify({ type: 'reward', icon: '✅', title: '퀴즈 정답 보상', text: txt, key: 'reward:quiz', act: 'profile' });
        else if (why === 'ferment') this.notify({ type: 'ferment', icon: '🏺', title: '발효 완성 보상을 받았어요', text: txt, act: 'inventory' });
        else this.notify({ type: 'reward', icon: '🎁', title: '보상을 받았어요', text: txt, key: `reward:${why.slice(0, 30)}` });
      });
      on('ferment:completed', ({ jarId, recipeId }) => {
        const r = G.data.recipes?.[recipeId];
        const jar = typeof jarId === 'string' && ID_RE.test(jarId) ? jarId : null;
        this.notify({ type: 'ferment', icon: r?.icon || '🏺', title: `${r?.name || '발효'} 완성!`, text: '장독대의 내 장독에서 결과물을 받아 가세요.', act: 'jar', ref: jar, key: `ferment:${jar}` });
      });
      on('chat:message', ({ msg }) => this._onChat(msg));
      on('profile:changed', () => { this._drawSign(); this._certKey = ''; this._renderHero(); });
      on('item:added', ({ itemId }) => { if (DECOR_ITEMS.includes(itemId)) this._decorInvChanged(); });
      on('item:removed', ({ itemId }) => { if (DECOR_ITEMS.includes(itemId)) this._decorInvChanged(); });
      on('photo:mode', ({ active }) => { if (active) this.stopDecor({ silent: true }); });
      on('npc:talk', () => this.stopDecor({ silent: true }));
      on('player:moved', ({ x, z }) => {
        if (!this._edit || !this._yard) return;
        if (Math.hypot(num(x) - this._yard.x, num(z) - this._yard.z) > 30) this.stopDecor({ silent: true });
      });
      G.bus.on('settings:changed', ({ key } = {}) => { if (key === 'uiScale' || key === 'largeText') setTimeout(() => this._placeBell(), 50); });
    },

    _onChat(msg) {
      if (!isObj(msg) || msg.self || msg.kind === 'system' || msg.kind === 'npc' || msg.channel === 'system') return;
      let mention = msg.mention;
      if (mention === undefined) {
        const nick = G.state.profile?.nickname;
        mention = !!nick && Array.from(nick).length >= 2 && String(msg.text || '').toLowerCase().includes(String(nick).toLowerCase());
      }
      if (mention !== true) return;
      const at = num(msg.at, now());
      if (at < this._loginAt - 60000) return;             // chat history replays
      const id = str(msg.id, 48);
      if (id && id === this._mention.id) return;
      const name = str(msg.name, 24) || '체험객';
      if (G.sys.social?.isBlocked?.(name)) return;
      this._mention.id = id;
      this.notify({ type: 'mention', icon: '💬', title: `${name}님이 나를 불렀어요`, text: `“${str(msg.text, 120)}”`, act: 'chat', key: 'mention' });
    },

    // ============================================================ hotkeys
    _bindKeys() {
      const I = G.input;
      if (!I?.onKey) return;
      I.onKey('KeyN', () => {
        if (!G.state || this._edit) return false;
        if (G.ui.modal.isOpen() && G.ui.modal.top()?.id !== HUB_ID) return false;
        if (G.ui.blockers && [...G.ui.blockers].some((k) => !String(k).startsWith('modal:'))) return false;
        this.toggle();
        return true;
      }, { allowInModal: true });
      // decoration edit mode keys (gameplay is blocked while editing, so they need allowInModal)
      const ed = (fn) => (e) => { if (!this._edit || G.ui.modal.isOpen()) return false; fn(e); return true; };
      I.onKey('KeyR', ed(() => this._rotateKey()), { allowInModal: true });
      I.onKey('Delete', ed(() => this._removeSelected()), { allowInModal: true });
      I.onKey('Backspace', ed(() => this._removeSelected()), { allowInModal: true });
      I.onKey('Digit1', ed(() => this._pickItem(DECOR_ITEMS[0])), { allowInModal: true });
      I.onKey('Digit2', ed(() => this._pickItem(DECOR_ITEMS[1])), { allowInModal: true });
      I.onKey('Digit3', ed(() => this._pickItem(DECOR_ITEMS[2])), { allowInModal: true });
      for (const [code, f, r] of [['ArrowUp', 1, 0], ['ArrowDown', -1, 0], ['ArrowLeft', 0, -1], ['ArrowRight', 0, 1], ['KeyW', 1, 0], ['KeyS', -1, 0], ['KeyA', 0, -1], ['KeyD', 0, 1]]) {
        I.onKey(code, ed(() => this._moveCursor(f, r)), { allowInModal: true, repeat: true });
      }
      I.onKey('Enter', ed(() => this._confirmCursor()), { allowInModal: true });
      I.onKey('Space', ed(() => this._confirmCursor()), { allowInModal: true });
    },

    // ============================================================ hub modal
    isOpen() { return !!(this._modal && !this._modal.closed); },
    toggle(tab) { if (this.isOpen()) { this.close(); return null; } return this.open(tab); },
    close() { if (this.isOpen()) this._modal.close(); },
    _smartTab() {
      const c = this._counts();
      if (c.check) return 'checkin';
      if (c.missionClaims || c.bonus) return 'missions';
      if (c.unread) return 'inbox';
      return this._tab || 'checkin';
    },
    open(tab) {
      if (!G.state) return null;
      if (this._edit) this.stopDecor({ silent: true });
      const next = typeof tab === 'string' && TAB_IDS.includes(tab) ? tab : (this.isOpen() ? this._tab : this._smartTab());
      if (this.isOpen()) { this._setTab(next); return this._modal; }
      this._tab = next;
      this._inboxViewed = false;
      const m = G.ui.modal.open({
        id: HUB_ID, title: '오늘의 체험', icon: 'bell', size: 'lg', className: 'eng-modal', autofocus: false,
        body: (body) => this._buildHub(body),
        onClose: () => this._onHubClose(),
      });
      this._modal = m;
      G.ui.setActive('engagement', true);
      setTimeout(() => { if (this._modal === m && !m.closed && !G.input?.touchUI) this._tabsEl?.querySelector('.eng-tab.active')?.focus({ preventScroll: true }); }, 60);
      return m;
    },
    _onHubClose() {
      if (this._inboxViewed) this.markAllRead({ silent: true });
      this._inboxViewed = false;
      this._modal = null; this._pane = null; this._tabsEl = null; this._heroEl = null; this._live = null;
      clearInterval(this._clockTimer);
      clearTimeout(this._uiTimer);
      G.ui.setActive('engagement', false);
      this._refreshBadge();
    },
    _buildHub(body) {
      const hero = h('div', { class: 'eng-hero' });
      const tabs = h('div', { class: 'eng-tabs', role: 'tablist', 'aria-label': '오늘의 체험 메뉴' });
      for (const t of TABS) {
        tabs.appendChild(h('button', { type: 'button', class: 'eng-tab', role: 'tab', id: `eng-tab-${t.id}`, 'data-tab': t.id, 'aria-selected': 'false', 'aria-controls': 'eng-pane', tabindex: '-1' },
          h('span', { class: 'emoji eng-tab-ico', 'aria-hidden': 'true' }, t.icon), h('span', { class: 'eng-tab-lbl' }, t.label), h('span', { class: 'eng-tab-badge', hidden: true })));
      }
      tabs.addEventListener('click', (e) => { const b = e.target.closest('.eng-tab'); if (b) this._setTab(b.dataset.tab, true); });
      tabs.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 }[e.key];
        if (d == null) return;
        e.preventDefault();
        const i = TAB_IDS.indexOf(this._tab);
        const j = clamp(i + d, 0, TAB_IDS.length - 1);
        this._setTab(TAB_IDS[j], true);
        tabs.querySelector(`[data-tab="${TAB_IDS[j]}"]`)?.focus();
      });
      const pane = h('div', { class: 'eng-pane', id: 'eng-pane', role: 'tabpanel' });
      const live = h('div', { class: 'eng-sr', 'aria-live': 'polite' });
      body.classList.add('eng-body');
      body.append(hero, tabs, pane, live);
      this._heroEl = hero; this._tabsEl = tabs; this._pane = pane; this._live = live;
      this._renderHero();
      this._setTab(this._tab);
      clearInterval(this._clockTimer);
      this._clockN = 0;
      this._clockTimer = setInterval(() => this._tickClock(), 1000);
    },
    _setTab(id, user = false) {
      if (!TAB_IDS.includes(id)) id = 'checkin';
      if (this._tab === 'inbox' && id !== 'inbox' && this._inboxViewed) { this._inboxViewed = false; this.markAllRead({ silent: true }); }
      const changed = this._tab !== id;
      this._tab = id;
      if (!this._tabsEl) return;
      const hadFocus = this._tabsEl.contains(document.activeElement);
      for (const b of this._tabsEl.querySelectorAll('.eng-tab')) {
        const on = b.dataset.tab === id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && hadFocus && document.activeElement !== b) b.focus({ preventScroll: true });
        if (on && changed) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
      this._pane?.setAttribute('aria-labelledby', `eng-tab-${id}`);
      this._renderPane(true);
      if (user && changed) G.sfx('page');
    },
    _renderPane(fresh = false) {
      const p = this._pane;
      if (!p || !G.state) return;
      const scroller = this._modal?.body;
      const keep = !fresh && scroller ? scroller.scrollTop : 0;
      p.replaceChildren();
      p.classList.remove('eng-in');
      if (fresh && !reduceMotion()) { void p.offsetWidth; p.classList.add('eng-in'); }
      try {
        switch (this._tab) {
          case 'checkin': this._renderCheckin(p); break;
          case 'missions': this._renderMissions(p); break;
          case 'inbox': this._renderInbox(p); break;
          case 'cert': this._renderCert(p); break;
          case 'rank': this._renderRank(p); break;
          case 'decor': this._renderDecor(p); break;
          default:
        }
      } catch (e) {
        G.log.error(CAT, `render ${this._tab}`, e);
        p.replaceChildren(h('div', { class: 'empty' }, '화면을 그리지 못했어요. 잠시 후 다시 열어 주세요.'));
      }
      G.ui.hydrateIcons(p);
      if (scroller) scroller.scrollTop = fresh ? 0 : keep;
      this._renderTabBadges();
    },
    /** re-render the open hub soon (coalesced; waits while a claim animation plays) */
    _uiDirty(tab) {
      if (!this.isOpen()) return;
      if (tab && tab !== this._tab) { this._renderTabBadges(); return; }
      clearTimeout(this._uiTimer);
      const wait = Math.max(90, this._animUntil - performance.now());
      this._uiTimer = setTimeout(() => { if (this.isOpen()) { this._renderPane(false); this._renderHero(); } }, wait);
    },
    _renderTabBadges(c) {
      const tabs = this._tabsEl;
      if (!tabs || !G.state) return;
      c = c || this._counts();
      const set = (id, n, gold) => {
        const b = tabs.querySelector(`[data-tab="${id}"] .eng-tab-badge`);
        if (!b) return;
        b.hidden = !n;
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('gold', !!gold);
      };
      set('checkin', c.check ? 1 : 0, true);
      set('missions', c.missionClaims + (c.bonus ? 1 : 0), true);
      set('inbox', c.unread, false);
    },
    _renderHero() {
      const el = this._heroEl;
      if (!el || !G.state) return;
      const e = this._E(), d = this._daily(), c = this._counts();
      const nick = G.state.profile?.nickname || '체험객';
      const hr = new Date(now()).getHours();
      const [greet, emo] = hr < 5 ? ['늦은 밤이에요', '🌙'] : hr < 11 ? ['좋은 아침이에요', '🌅'] : hr < 17 ? ['좋은 오후예요', '☀️'] : hr < 21 ? ['좋은 저녁이에요', '🌇'] : ['편안한 밤 보내세요', '🌙'];
      const today = dayKey();
      const ck = e.checkin;
      const streak = ck.lastDay === today || (ck.lastDay && addDays(ck.lastDay, 1) === today) ? ck.streak : 0;
      const done = d.missions.filter((m) => m.done).length;
      const allClaimed = d.missions.length > 0 && d.missions.every((m) => m.claimed);
      const sub = c.check ? '오늘 출석 체크를 아직 하지 않았어요! 📅'
        : c.missionClaims || c.bonus ? '받을 수 있는 미션 보상이 기다리고 있어요 🎁'
          : allClaimed ? '오늘의 미션을 모두 끝냈어요. 정말 대단해요! 🎉'
            : '오늘의 미션에 도전하고 보상을 받아 가세요 🎯';
      const mood = c.claims ? 'cheer' : hr >= 21 || hr < 5 ? 'sleepy' : 'happy';
      const chip = (icon, text, cls = '') => h('span', { class: `eng-hero-chip ${cls}` }, h('span', { class: 'emoji' }, icon), text);
      el.replaceChildren(
        h('div', { class: 'eng-hero-ava', 'aria-hidden': 'true', html: mascotSvg(mood, 64) }),
        h('div', { class: 'eng-hero-txt' },
          h('div', { class: 'eng-hero-hi' }, h('b', null, nick), `님, ${greet} ${emo}`),
          h('div', { class: 'eng-hero-sub' }, sub),
          h('div', { class: 'eng-hero-chips' },
            chip('🔥', `연속 출석 ${streak}일`, streak >= 3 ? 'hot' : ''),
            chip('🎯', `미션 ${done}/${d.missions.length}`, done >= 3 ? 'ok' : ''),
            chip('🔔', `새 알림 ${c.unread}`, c.unread ? 'new' : ''))));
    },
    _tickClock() {
      if (!this.isOpen() || !this._pane) { clearInterval(this._clockTimer); return; }
      const left = hms(msToMidnight());
      for (const s of this._pane.querySelectorAll('[data-clock="midnight"]')) s.textContent = left;
      if (++this._clockN % 15 === 0) for (const s of this._pane.querySelectorAll('[data-t]')) s.textContent = ago(Number(s.dataset.t));
    },
    _say(text) { if (this._live) this._live.textContent = text; },

    // ============================================================ 출석 체크
    canCheckin() {
      const e = this._E();
      if (!e) return { ok: false, reason: 'nostate' };
      const c = e.checkin, today = dayKey();
      if (c.lastDay === today) return { ok: false, reason: 'done', day: today, streak: c.streak, pos: posOf(c.streak) };
      if (c.lastDay && today < c.lastDay) return { ok: false, reason: 'skew', day: today, last: c.lastDay, streak: c.streak, pos: posOf(c.streak) };
      const cont = !!c.lastDay && addDays(c.lastDay, 1) === today;
      const streak = cont ? c.streak + 1 : 1;
      return { ok: true, day: today, streak, pos: posOf(streak), cont, broken: !!c.lastDay && !cont };
    },
    checkin() {
      const can = this.canCheckin();
      if (!can.ok) return null;
      if (performance.now() - this._claimAt < 400) return null; // double-click guard
      this._claimAt = performance.now();
      const e = this._E(), c = e.checkin;
      const reward = checkinReward(can.streak);
      c.lastDay = can.day;
      c.streak = can.streak;
      c.best = Math.max(c.best, c.streak);
      c.total++;
      c.days.push(can.day);
      if (c.days.length > MAX_DAYS) c.days.splice(0, c.days.length - MAX_DAYS);
      c.shownDay = can.day;
      G.dirty('engagement');
      const got = grant(reward, 'engagement:checkin') || reward;
      G.sfx('reward');
      G.log.info(CAT, `check-in ${can.day} streak ${c.streak} (day ${can.pos})`);
      this.notify({ type: 'checkin', icon: '📅', title: `출석 ${can.pos}일차 보상을 받았어요`, text: rewardText(got), act: 'checkin', read: true });
      G.bus.emit('engagement:checkin', { day: can.day, streak: c.streak, pos: can.pos, reward: got });
      if (can.pos === 7) say('7일 연속 출석 성공! 마당을 꾸밀 장식을 선물했어요 🎁 꾸미기 탭에서 놓아 보세요.', { mood: 'cheer', duration: 6000, action: { label: '꾸미기', fn: () => this.open('decor') } });
      else say(`출석 ${can.pos}일차 완료! ${c.streak >= 2 ? `${c.streak}일 연속이에요 🔥` : '내일도 만나요 😊'}`, { mood: 'happy', duration: 4200 });
      serverSave();
      this._refreshBadge();
      return { day: can.day, streak: c.streak, pos: can.pos, reward: got };
    },
    _autoCheckin() {
      clearTimeout(this._autoTimer);
      if (!G.state || !this._loggedIn || G.flags.noTutorial) return;
      const e = this._E();
      const today = dayKey();
      if (!this.canCheckin().ok || e.checkin.shownDay === today) return;
      const busy = !!G.app?.onboarding?.active || G.ui.modal.isOpen() || !!G.sys.dialogue?.active || !!G.sys.photo?.active
        || G.ui.isBlocking() || document.hidden || !!this._edit || document.getElementById('hud')?.hidden;
      if (busy) {
        this._busyAt = performance.now();
        if (++this._autoTries < 600) this._autoTimer = setTimeout(() => this._autoCheckin(), 2000);
        return;
      }
      // give the player a short breather after a tutorial / dialogue / modal before popping the calendar
      if (this._busyAt && performance.now() - this._busyAt < 1800) { this._autoTimer = setTimeout(() => this._autoCheckin(), 1900); return; }
      e.checkin.shownDay = today;
      G.dirty('engagement');
      this.open('checkin');
    },
    _renderCheckin(p) {
      const e = this._E(), c = e.checkin, can = this.canCheckin();
      const today = dayKey();
      const doneToday = can.reason === 'done' || can.reason === 'skew'; // skew: the last claimed slot stays stamped
      const basePos = can.ok ? can.pos : posOf(c.streak || 1);
      const streakAtBase = can.ok ? can.streak : Math.max(1, c.streak);
      const curStreak = doneToday || (c.lastDay && addDays(c.lastDay, 1) === today) ? c.streak : 0;

      p.appendChild(h('div', { class: 'eng-stats' },
        h('div', { class: 'eng-stat hot' }, h('span', { class: 'emoji' }, '🔥'), h('b', null, `${curStreak}일`), h('small', null, '연속 출석')),
        h('div', { class: 'eng-stat' }, h('span', { class: 'emoji' }, '🏅'), h('b', null, `${c.best}일`), h('small', null, '최고 기록')),
        h('div', { class: 'eng-stat' }, h('span', { class: 'emoji' }, '🗓️'), h('b', null, `${c.total}일`), h('small', null, '누적 출석'))));

      const grid = h('div', { class: 'eng-cal', role: 'list', 'aria-label': '7일 출석 달력' });
      for (let i = 1; i <= 7; i++) {
        const r = checkinReward(streakAtBase - basePos + i);
        const state = i < basePos || (i === basePos && doneToday) ? 'stamped' : i === basePos ? (can.ok ? 'today' : 'locked') : 'future';
        const date = addDays(today, i - basePos);
        const items = Object.keys(r.items);
        const gift = items.length ? itemIcon(items[items.length - 1]) : '🪙';
        const lines = [h('span', { class: 'coin' }, h('span', { class: 'ico ico-xs', 'data-icon': 'coin' }), fmt(r.coin))];
        if (r.exp) lines.push(h('span', null, `✨${r.exp}`));
        for (const id of items) lines.push(h('span', { title: itemName(id) }, `${itemIcon(id)}×${r.items[id]}`));
        const cell = h('div', { class: `eng-day ${state}${i === 7 ? ' big' : ''}`, role: 'listitem', 'data-pos': String(i), 'aria-label': `${i}일차 ${dayLabel(date)} ${state === 'stamped' ? '출석 완료' : state === 'today' ? '오늘' : ''} 보상 ${rewardText(r)}` },
          h('div', { class: 'eng-day-top' }, h('b', null, `${i}일차`), h('small', null, dayLabel(date))),
          h('div', { class: 'eng-day-gift emoji', 'aria-hidden': 'true' }, gift),
          h('div', { class: 'eng-day-rw' }, lines),
          i === 7 ? h('div', { class: 'eng-day-ribbon' }, '장식 선물') : null,
          state === 'today' ? h('div', { class: 'eng-day-now' }, '오늘') : null,
          state === 'stamped' ? stampEl() : null);
        cell.style.setProperty('--i', String(i));
        grid.appendChild(cell);
      }
      p.appendChild(grid);

      const act = h('div', { class: 'eng-claim-row' });
      if (can.ok) {
        const reward = checkinReward(can.streak);
        const btn = h('button', { type: 'button', class: 'btn btn-gold btn-lg eng-claim-btn' }, h('span', { class: 'emoji' }, '🎁'), ` 출석 체크하고 ${can.pos}일차 보상 받기`);
        btn.addEventListener('click', () => {
          const res = this.checkin();
          if (!res) { this._uiDirty(); return; }
          this._animUntil = performance.now() + 1300;
          const cell = grid.querySelector(`[data-pos="${res.pos}"]`);
          if (cell) {
            cell.classList.remove('today');
            cell.classList.add('stamped', 'just');
            cell.querySelector('.eng-day-now')?.remove();
            cell.appendChild(stampEl('출석', true));
            setTimeout(() => burstAt(cell, 18), 260);
          }
          btn.disabled = true;
          btn.replaceChildren(h('span', { class: 'emoji' }, '✅'), ' 출석 완료!');
          this._say(`출석 ${res.pos}일차 완료. ${rewardText(res.reward)}을(를) 받았어요.`);
          this._uiDirty();
        });
        act.append(btn, h('div', { class: 'eng-claim-sub' }, '오늘의 보상: ', rewardChips(reward)));
        if (can.broken) p.appendChild(h('div', { class: 'notice-box info eng-note' }, '연속 출석이 끊겨서 1일차부터 다시 시작해요. 오늘부터 다시 이어 가 볼까요? 💪'));
      } else if (can.reason === 'done') {
        act.append(h('button', { type: 'button', class: 'btn btn-lg eng-claim-btn done', disabled: true }, h('span', { class: 'emoji' }, '✅'), ' 오늘 출석 완료!'),
          h('div', { class: 'eng-claim-sub' }, '다음 출석까지 ', h('b', { class: 'eng-clock', 'data-clock': 'midnight' }, hms(msToMidnight()))));
      } else if (can.reason === 'skew') {
        p.appendChild(h('div', { class: 'notice-box eng-note' }, `기기 날짜가 마지막 출석일(${U.formatDate(dayTs(can.last))})보다 이전으로 설정되어 있어요. 날짜·시간 설정을 확인해 주세요. 같은 날짜로 두 번 출석할 수는 없어요.`));
      }
      p.appendChild(act);
      p.appendChild(h('p', { class: 'eng-foot' }, `하루에 한 번 출석하면 보상을 받아요. 7일 연속으로 출석하면 마당을 꾸밀 장식(작은 장독 → 꽃 화분 → 청사초롱)을 선물해요. 날짜는 ${G.net?.mode === 'server' ? '서버 시간' : '이 기기의 시간'} 기준으로 자정에 바뀌어요.`));
    },

    // ============================================================ 오늘의 미션
    missions() {
      const d = this._daily();
      return (d?.missions || []).map((m) => ({ id: m.id, icon: MISSIONS[m.id].icon, text: missionText(m), target: m.target, progress: m.progress, done: m.done, claimed: m.claimed, param: m.param, reward: { ...MISSIONS[m.id].reward } }));
    },
    _missionEvent(ev, p) {
      const d = this._daily();
      if (!d) return;
      let changed = false;
      for (const m of d.missions) {
        const def = MISSIONS[m.id];
        if (!def || def.ev !== ev || m.done) continue;
        if (def.filter) { let ok = false; try { ok = !!def.filter(p, m); } catch (e) { ok = false; } if (!ok) continue; }
        const inc = def.amount ? def.amount(p) : 1;
        if (!(inc > 0)) continue;
        if (def.distinct) {
          const key = str(String(p[def.distinct] ?? ''), 48);
          if (!key || m.seen.includes(key)) continue;
          m.seen.push(key);
          if (m.seen.length > 20) m.seen.shift();
        }
        m.progress = Math.min(m.target, m.progress + inc);
        changed = true;
        if (m.progress >= m.target) this._completeMission(m, def, d);
      }
      if (!changed) return;
      G.dirty('engagement');
      this._refreshBadge();
      this._uiDirty('missions');
    },
    _completeMission(m, def, d) {
      m.done = true;
      m.progress = m.target;
      m.doneAt = now();
      const text = missionText(m);
      G.ui.toast(`오늘의 미션 완료! ${text}`, { type: 'success', emoji: def.icon, duration: 3600 });
      G.sfx('quest');
      this.notify({ type: 'mission', icon: def.icon, title: '오늘의 미션 완료!', text: `${text} — 보상을 받아 가세요.`, act: 'missions', ref: m.id });
      const left = d.missions.filter((x) => !x.done).length;
      say(left ? `미션 완료! “${text}” 🎉 종 버튼(N)에서 보상을 받을 수 있어요.` : '오늘의 미션 3개를 모두 끝냈어요! 보너스 보상까지 챙겨 가세요 🎁',
        { mood: 'cheer', duration: 5200, action: { label: '보상 받기', fn: () => this.open('missions') } });
      try { G.fx?.burst?.('stars', null, { count: 10, lift: 1.2 }); } catch (e) { /* fx optional */ }
      G.log.info(CAT, `mission completed ${m.id}`);
      G.bus.emit('engagement:mission', { missionId: m.id, state: 'completed', day: d.day });
    },
    claimMission(id) {
      const d = this._daily();
      const m = d?.missions.find((x) => x.id === id);
      if (!m || !m.done || m.claimed) return null;
      if (performance.now() - this._claimAt < 350) return null;
      this._claimAt = performance.now();
      m.claimed = true;
      G.dirty('engagement');
      const got = grant(MISSIONS[id].reward, 'engagement:mission') || MISSIONS[id].reward;
      G.sfx('coin');
      G.bus.emit('engagement:mission', { missionId: id, state: 'claimed', day: d.day });
      if (d.missions.every((x) => x.claimed) && !d.bonus) say('미션 보상을 모두 받았어요! 마지막 보너스 상자도 열어 보세요 🎁', { mood: 'wink', duration: 4200 });
      serverSave();
      this._refreshBadge();
      return got;
    },
    claimBonus() {
      const d = this._daily();
      if (!d || d.bonus || !d.missions.length || !d.missions.every((m) => m.claimed)) return null;
      if (performance.now() - this._claimAt < 350) return null;
      this._claimAt = performance.now();
      d.bonus = true;
      G.dirty('engagement');
      const got = grant(bonusReward(d.day), 'engagement:bonus') || bonusReward(d.day);
      G.sfx('achievement');
      this.notify({ type: 'mission', icon: '🎁', title: '오늘의 미션 보너스 획득!', text: rewardText(got), act: 'missions', read: true });
      G.bus.emit('engagement:mission', { missionId: 'BONUS', state: 'bonus', day: d.day });
      try { G.fx?.burst?.('confetti', null, { count: 36 }); } catch (e) { /* fx optional */ }
      say('오늘의 미션 완벽 달성! 내일 또 새로운 미션이 준비돼요 🌟', { mood: 'cheer', duration: 4500 });
      serverSave();
      this._refreshBadge();
      return got;
    },
    _missionGo(m) {
      const def = MISSIONS[m.id];
      if (def.go) {
        const target = def.go === '@param' ? m.param : def.go;
        if (!target || !G.sys.minimap?.travelTo) return;
        this.close();
        G.sys.minimap.travelTo(target);
        return;
      }
      const fns = {
        journal: () => G.sys.journal?.open?.(),
        photo: () => (G.sys.photo?.enter ? G.sys.photo.enter() : G.ui.triggerAction('photo')),
        chat: () => { G.sys.social?.toggleChat?.(true); G.sys.social?.focusChat?.(); },
        emote: () => G.sys.social?.openEmotes?.(document.querySelector('#bottom-bar [data-action="emote"]') || undefined),
        gesture: () => G.sys.social?.openGestures?.(document.querySelector('#bottom-bar [data-action="gesture"]') || undefined),
      };
      const fn = fns[def.act];
      if (!fn) return;
      this.close();
      setTimeout(() => { try { fn(); } catch (e) { G.log.warn(CAT, 'mission shortcut', e?.message || e); } }, 60);
    },
    _renderMissions(p) {
      const d = this._daily();
      const done = d.missions.filter((m) => m.done).length;
      const ring = h('div', { class: 'eng-ring', 'aria-label': `미션 ${done}/${d.missions.length} 완료` }, h('b', null, `${done}/${d.missions.length}`), h('small', null, '완료'));
      ring.style.setProperty('--p', String(d.missions.length ? done / d.missions.length : 0));
      p.appendChild(h('div', { class: 'eng-mhead' },
        ring,
        h('div', { class: 'grow' },
          h('div', { class: 'eng-mhead-title' }, `${dayLabel(d.day, true)}의 미션`),
          h('div', { class: 'eng-mhead-sub' }, '매일 자정에 나만을 위한 미션 3개가 새로 준비돼요.'),
          h('div', { class: 'eng-mhead-sub' }, '새 미션까지 ', h('b', { class: 'eng-clock', 'data-clock': 'midnight' }, hms(msToMidnight()))))));

      const list = h('div', { class: 'eng-mlist' });
      d.missions.forEach((m, i) => {
        const def = MISSIONS[m.id];
        const text = missionText(m);
        const state = m.claimed ? 'claimed' : m.done ? 'done' : 'progress';
        const unit = def.unit ? ` ${def.unit}` : '';
        const label = `${fmt(Math.floor(m.progress))} / ${fmt(m.target)}${unit}`;
        const side = h('div', { class: 'eng-mis-side' }, rewardChips(def.reward));
        if (state === 'claimed') side.appendChild(h('span', { class: 'eng-mis-ok' }, '✅ 받음'));
        else if (state === 'done') {
          const b = h('button', { type: 'button', class: 'btn btn-gold btn-sm eng-pulse' }, '🎁 보상 받기');
          b.addEventListener('click', () => {
            const got = this.claimMission(m.id);
            if (!got) return;
            this._animUntil = performance.now() + 1100;
            const card = b.closest('.eng-mis');
            card?.classList.add('claimed', 'just');
            card?.appendChild(stampEl('완료', true));
            b.replaceWith(h('span', { class: 'eng-mis-ok' }, '✅ 받음'));
            burstAt(card, 14);
            this._say(`${text} 보상 ${rewardText(got)}을(를) 받았어요.`);
            this._uiDirty();
          });
          side.appendChild(b);
        } else {
          const canGo = (def.go && G.sys.minimap?.travelTo && (def.go !== '@param' || m.param)) || def.act;
          if (canGo) {
            const b = h('button', { type: 'button', class: 'btn btn-soft btn-sm' }, def.go ? '📍 바로 가기' : '👉 해 보기');
            b.addEventListener('click', () => this._missionGo(m));
            side.appendChild(b);
          }
        }
        const card = h('div', { class: `eng-mis ${state}` },
          h('div', { class: 'eng-mis-ico emoji', 'aria-hidden': 'true' }, def.icon),
          h('div', { class: 'eng-mis-main' },
            h('div', { class: 'eng-mis-title' }, text),
            h('div', { class: 'eng-mis-hint' }, def.hint),
            bar(m.progress, m.target, label, state === 'progress' ? '' : 'bar-gold')),
          side,
          state === 'claimed' ? stampEl('완료') : null);
        card.style.setProperty('--i', String(i));
        list.appendChild(card);
      });
      p.appendChild(list);

      const allClaimed = d.missions.length > 0 && d.missions.every((m) => m.claimed);
      const br = bonusReward(d.day);
      const bonus = h('div', { class: `eng-bonus${d.bonus ? ' got' : allClaimed ? ' ready' : ''}` },
        h('div', { class: 'eng-bonus-ico emoji', 'aria-hidden': 'true' }, d.bonus ? '🎉' : '🎁'),
        h('div', { class: 'grow' }, h('b', null, '3개 모두 완료 보너스'), h('div', { class: 'eng-mis-hint' }, d.bonus ? '오늘의 보너스를 받았어요. 내일 또 만나요!' : '미션 3개의 보상을 모두 받으면 보너스 상자가 열려요.')),
        rewardChips(br));
      if (!d.bonus) {
        const b = h('button', { type: 'button', class: `btn btn-sm ${allClaimed ? 'btn-gold eng-pulse' : ''}`, disabled: !allClaimed || null }, allClaimed ? '상자 열기' : '🔒 잠김');
        b.addEventListener('click', () => {
          const got = this.claimBonus();
          if (!got) return;
          this._animUntil = performance.now() + 1100;
          bonus.classList.add('got', 'just');
          b.replaceWith(h('span', { class: 'eng-mis-ok' }, '✅ 받음'));
          burstAt(bonus, 24);
          this._say(`보너스 ${rewardText(got)}을(를) 받았어요.`);
          this._uiDirty();
        });
        bonus.appendChild(b);
      } else bonus.appendChild(h('span', { class: 'eng-mis-ok' }, '✅ 받음'));
      p.appendChild(bonus);
      p.appendChild(h('p', { class: 'eng-foot' }, '미션은 체험 활동을 하면 자동으로 진행돼요. 완료하면 종 버튼에 표시가 생기고, 여기서 보상을 받을 수 있어요.'));
    },

    // ============================================================ 알림함
    notifications() { return (this._E()?.notifications || []).map((n) => ({ ...n })); },
    notify(n) {
      const e = this._E();
      if (!e || !isObj(n)) return null;
      const x = cleanNoti({ ...n, id: U.uid('n'), t: now(), count: 1 });
      if (!x) return null;
      if (x.key) { // coalesce repeats of the same kind (mentions, quiz rewards...) for 2 minutes
        const prev = e.notifications.slice(0, 6).find((o) => o.key === x.key && !o.read && now() - o.t < 120000);
        if (prev) {
          prev.count = Math.min(999, (prev.count || 1) + 1);
          prev.t = x.t; prev.text = x.text; prev.title = x.title;
          e.notifications.sort((a, b) => b.t - a.t);
          G.dirty('engagement');
          this._refreshBadge();
          this._uiDirty('inbox');
          return prev;
        }
      }
      e.notifications.unshift(x);
      if (e.notifications.length > MAX_NOTI) e.notifications.length = MAX_NOTI;
      G.dirty('engagement');
      this._refreshBadge();
      this._uiDirty('inbox');
      G.bus.emit('engagement:notify', { notification: { ...x } });
      return x;
    },
    markAllRead(opts = {}) {
      const e = this._E();
      if (!e) return 0;
      let n = 0;
      for (const x of e.notifications) if (!x.read) { x.read = true; n++; }
      if (n) { G.dirty('engagement'); this._refreshBadge(); if (!opts.silent) this._uiDirty('inbox'); }
      return n;
    },
    _clearRead() {
      const e = this._E();
      const before = e.notifications.length;
      e.notifications = e.notifications.filter((x) => !x.read);
      if (e.notifications.length !== before) { G.dirty('engagement'); this._uiDirty('inbox'); G.ui.toast(`읽은 알림 ${before - e.notifications.length}개를 지웠어요.`, { emoji: '🧹', sound: false }); }
    },
    _doAct(act, ref) {
      const tabs = { checkin: 1, missions: 1, inbox: 1, cert: 1, rank: 1, decor: 1 };
      if (tabs[act]) { this._setTab(act, true); return; }
      const fns = {
        quests: () => G.sys.quest?.openLog?.(),
        achievements: () => (G.sys.progression?.openAchievements ? G.sys.progression.openAchievements() : G.sys.progression?.openHub?.('ach')),
        collection: () => G.sys.progression?.openCollection?.(),
        profile: () => G.sys.progression?.openProfile?.(),
        jar: () => { const id = ref && (G.sys.fermentation?.myJarIds?.() || []).includes(ref) ? ref : 'J1'; G.sys.fermentation?.openJar?.(id); },
        chat: () => { G.sys.social?.toggleChat?.(true); G.sys.social?.focusChat?.(); },
        inventory: () => G.sys.inventory?.open?.(),
      };
      const fn = fns[act];
      if (!fn) return;
      this.close();
      setTimeout(() => { try { fn(); } catch (e) { G.log.warn(CAT, 'notification action', e?.message || e); } }, 40);
    },
    _renderInbox(p) {
      const e = this._E();
      this._inboxViewed = true;
      const all = e.notifications;
      const unread = all.filter((n) => !n.read).length;
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '알림 보기' });
      for (const [id, label] of [['all', `전체 ${all.length}`], ['unread', `안 읽음 ${unread}`]]) {
        const b = h('button', { type: 'button', class: this._inboxFilter === id ? 'active' : '', 'aria-pressed': this._inboxFilter === id ? 'true' : 'false' }, label);
        b.addEventListener('click', () => { this._inboxFilter = id; this._renderPane(false); });
        seg.appendChild(b);
      }
      const readAll = h('button', { type: 'button', class: 'btn btn-soft btn-sm', disabled: !unread || null }, '✔ 모두 읽음');
      readAll.addEventListener('click', () => { this.markAllRead(); this._say('모든 알림을 읽음으로 표시했어요.'); });
      const clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !(all.length - unread) || null }, '🧹 읽은 알림 지우기');
      clear.addEventListener('click', () => this._clearRead());
      p.appendChild(h('div', { class: 'eng-itools' }, seg, h('div', { class: 'grow' }), readAll, clear));

      const list = this._inboxFilter === 'unread' ? all.filter((n) => !n.read) : all;
      if (!list.length) {
        p.appendChild(h('div', { class: 'eng-empty' }, h('div', { class: 'eng-empty-ava', 'aria-hidden': 'true', html: mascotSvg('sleepy', 72) }),
          h('b', null, this._inboxFilter === 'unread' ? '새 알림이 없어요' : '아직 알림이 없어요'),
          h('p', null, '업적·퀘스트·레벨 업·발효 완성·채팅 언급 같은 소식이 생기면 여기에 차곡차곡 모여요.')));
        return;
      }
      const today = dayKey(), yday = addDays(today, -1);
      const box = h('div', { class: 'eng-nlist', role: 'list' });
      let group = null;
      list.forEach((n, i) => {
        const k = dayKey(n.t);
        const g = k === today ? '오늘' : k === yday ? '어제' : dayLabel(k, true);
        if (g !== group) { group = g; box.appendChild(h('div', { class: 'eng-ngroup', role: 'presentation' }, g)); }
        const row = h('div', { class: `eng-noti t-${n.type}${n.read ? '' : ' unread'}${n.act ? ' clickable' : ''}`, role: 'listitem', 'data-id': n.id, tabindex: n.act ? '0' : null },
          h('span', { class: 'eng-noti-ico emoji', 'aria-hidden': 'true' }, n.icon || NTYPES[n.type] || '🔔'),
          h('div', { class: 'eng-noti-main' },
            h('div', { class: 'eng-noti-title' }, n.title, n.count > 1 ? h('span', { class: 'eng-noti-count' }, `×${n.count}`) : null),
            n.text ? h('div', { class: 'eng-noti-text' }, n.text) : null),
          h('span', { class: 'eng-noti-ago', 'data-t': String(n.t) }, ago(n.t)),
          n.read ? null : h('i', { class: 'eng-noti-dot', title: '읽지 않음' }));
        row.style.setProperty('--i', String(Math.min(i, 12)));
        box.appendChild(row);
      });
      const activate = (row) => {
        const n = e.notifications.find((x) => x.id === row.dataset.id);
        if (!n) return;
        if (!n.read) { n.read = true; G.dirty('engagement'); row.classList.remove('unread'); row.querySelector('.eng-noti-dot')?.remove(); this._refreshBadge(); }
        if (n.act) this._doAct(n.act, n.ref);
      };
      box.addEventListener('click', (ev) => { const row = ev.target.closest('.eng-noti'); if (row) activate(row); });
      box.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList?.contains('eng-noti')) { ev.preventDefault(); activate(ev.target); } });
      p.appendChild(box);
      p.appendChild(h('p', { class: 'eng-foot' }, `알림은 최근 ${MAX_NOTI}개까지 보관돼요. 알림을 누르면 관련 화면으로 이동해요.`));
    },

    // ============================================================ 수료증
    hasCertificate() { return G.state?.quests?.QUEST001?.status === 'claimed'; },
    _syncCertificate(silent) {
      const e = this._E();
      if (!e || !this.hasCertificate() || e.certificate) return;
      const at = num(G.state.quests?.QUEST001?.claimedAt, 0) || now();
      const pid = String(G.state.profile?.id ?? 'guest');
      const no = `${new Date(at).getFullYear()}-${U.hash(`${pid}|${at}`).slice(-6).toUpperCase()}`;
      e.certificate = { issuedAt: at, no };
      this._certKey = '';
      G.dirty('engagement');
      if (!silent) {
        this.notify({ type: 'cert', icon: '🎓', title: '전통발효체험 수료증이 발급됐어요!', text: '수료증 탭에서 이미지로 저장하거나 인쇄할 수 있어요.', act: 'cert' });
        say('축하해요! 전통발효체험 수료증이 발급됐어요 🎓 종 버튼(N) → 수료증에서 볼 수 있어요.', { mood: 'cheer', duration: 6000, action: { label: '수료증 보기', fn: () => this.open('cert') } });
      }
    },
    _certData(preview) {
      const st = G.state, s = st.stats || {}, e = this._E();
      const visited = (G.data.visitZones || []).filter((z) => st.visited?.[z]);
      const eduDone = Object.keys(st.education?.completed || {}).length;
      const eduSeen = Object.keys(st.education?.viewed || {}).length;
      const n = (k) => int(s[k], 0, 1e9, 0);
      const items = [];
      if (n('waters') || n('harvests')) items.push(`전통작물 재배 체험 (물 주기 ${fmt(n('waters'))}회 · 수확 ${fmt(n('harvests'))}회)`);
      if (n('fermentChecks') || n('fermentsClaimed')) items.push(`장독대 발효 관리 체험${n('fermentsClaimed') ? ` (발효 완성 ${fmt(n('fermentsClaimed'))}회)` : ''}`);
      if (eduDone || eduSeen) items.push(`전통발효 교육 콘텐츠 학습 (${fmt(Math.max(eduDone, eduSeen))}개)`);
      if (n('quizCorrect')) items.push(`전통발효 퀴즈 풀이 (정답 ${fmt(n('quizCorrect'))}문제)`);
      if (n('journals')) items.push(`작업일지 기록 (${fmt(n('journals'))}회)`);
      if (n('crafts')) items.push(`발효 재료 만들기 (${fmt(n('crafts'))}회)`);
      if (n('photos')) items.push(`체험 사진 기록 (${fmt(n('photos'))}장)`);
      if (preview && !items.length) items.push('전통작물 재배 체험', '장독대 발효 관리 체험', '전통발효 교육 콘텐츠 학습');
      if (items.length < 2) items.push('전통발효체험관 둘러보기');
      const cert = e.certificate;
      const issued = cert?.issuedAt || now();
      return {
        nick: str(st.profile?.nickname, 24) || '체험객',
        title: str(st.profile?.title, 20),
        no: cert?.no || '0000-000000',
        issued,
        level: int(s.level, 1, 999, 1),
        quiz: n('quizCorrect'),
        zones: visited.length,
        zoneTotal: (G.data.visitZones || []).length || 9,
        zoneNames: visited.map((z) => G.world?.zoneById?.(z)?.short || zoneName(z)),
        days: Math.max(1, e.checkin.total),
        contents: items.slice(0, 6),
        preview: !!preview,
      };
    },
    renderCertificate(opts = {}) {
      if (!G.state) return null;
      const preview = !!opts.preview || !this.hasCertificate();
      const D = this._certData(preview);
      const key = JSON.stringify(D);
      if (this._certCanvas && this._certKey === key) return this._certCanvas;
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1131;
      const ctx = c.getContext('2d');
      try { drawCertificate(ctx, c.width, c.height, D); } catch (e) { G.log.error(CAT, 'certificate draw', e); }
      this._certCanvas = c;
      this._certKey = key;
      return c;
    },
    downloadCertificate() {
      if (!this.hasCertificate()) { G.ui.toast('수료증은 메인 퀘스트를 마친 뒤에 받을 수 있어요.', { type: 'info' }); return false; }
      const c = this.renderCertificate();
      if (!c?.toBlob) return false;
      const d = new Date(this._E().certificate?.issuedAt || now());
      const name = `certificate_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.png`; // ASCII name (some browsers drop others)
      c.toBlob((blob) => {
        if (!blob) { G.ui.toast('이미지를 만들지 못했어요.', { type: 'error' }); return; }
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: name, rel: 'noopener' });
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        G.ui.toast('수료증 이미지를 저장했어요.', { type: 'success', emoji: '🖼️' });
      }, 'image/png');
      return true;
    },
    printCertificate() {
      if (!this.hasCertificate()) return false;
      const c = this.renderCertificate();
      if (!c) return false;
      let layer = document.getElementById('eng-print-layer');
      if (!layer) { layer = h('div', { id: 'eng-print-layer', 'aria-hidden': 'true' }, h('img', { alt: '전통발효체험 수료증' })); document.body.appendChild(layer); }
      const img = layer.querySelector('img');
      const url = c.toDataURL('image/png');
      const done = () => { document.body.classList.remove('eng-printing'); window.removeEventListener('afterprint', done); };
      const go = () => {
        document.body.classList.add('eng-printing');
        window.addEventListener('afterprint', done);
        setTimeout(done, 60000);
        requestAnimationFrame(() => { try { window.print(); } catch (e) { done(); G.ui.toast('인쇄 창을 열지 못했어요.', { type: 'warn' }); } });
      };
      if (img.getAttribute('src') === url && img.complete) go();
      else { img.addEventListener('load', go, { once: true }); img.src = url; }
      return true;
    },
    _renderCert(p) {
      const has = this.hasCertificate();
      if (has) {
        this._syncCertificate(true);
        const e = this._E();
        const canvas = this.renderCertificate();
        canvas.className = 'eng-cert-canvas';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${G.state.profile?.nickname || '체험객'}님의 전통발효체험 수료증`);
        const save = h('button', { type: 'button', class: 'btn btn-primary' }, h('span', { class: 'ico ico-sm', 'data-icon': 'download' }), ' 이미지로 저장');
        save.addEventListener('click', () => this.downloadCertificate());
        const print = h('button', { type: 'button', class: 'btn btn-soft' }, '🖨️ 인쇄');
        print.addEventListener('click', () => this.printCertificate());
        p.append(
          h('div', { class: 'eng-cert-head' }, h('div', { class: 'grow' }, h('b', null, '🎓 전통발효체험 수료증'), h('small', null, `증서 번호 ${e.certificate?.no || '-'} · 발급일 ${U.formatDate(e.certificate?.issuedAt || now())}`)), save, print),
          h('div', { class: 'eng-cert-frame' }, canvas),
          h('div', { class: 'notice-box eng-note' }, `${G.data.meta?.titleDisclaimer || '게임 내 칭호이며 실제 자격과 무관합니다.'} 이 수료증은 게임 속 체험을 기념하는 증서로, 공식 교육 이수증이나 자격증이 아니에요.`));
        return;
      }
      const prog = G.sys.quest?.progress?.('QUEST001');
      const def = G.data.quests?.QUEST001;
      const objs = prog?.objectives || (def?.objectives || []).map((o, i) => ({ text: o.text, done: (Number(G.state.quests?.QUEST001?.progress?.[i]) || 0) >= (o.count || 1) }));
      const doneN = objs.filter((o) => o.done).length;
      const status = G.state.quests?.QUEST001?.status;
      const go = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, '📜 퀘스트 보기');
      go.addEventListener('click', () => { this.close(); setTimeout(() => G.sys.quest?.openLog?.(status === 'completed' ? 'claimable' : 'active', 'QUEST001'), 40); });
      const ul = h('ul', { class: 'eng-cert-steps' });
      for (const o of objs) ul.appendChild(h('li', { class: o.done ? 'done' : '' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, o.done ? '✅' : '⬜'), o.text));
      const preview = this.renderCertificate({ preview: true });
      preview.className = 'eng-cert-canvas';
      preview.setAttribute('aria-hidden', 'true');
      p.append(
        h('div', { class: 'eng-cert-lock' },
          h('div', { class: 'eng-cert-lock-head' }, h('span', { class: 'emoji' }, '🔒'), h('div', { class: 'grow' }, h('b', null, '수료증까지 한 걸음씩!'),
            h('small', null, status === 'completed' ? '메인 퀘스트를 모두 마쳤어요! 퀘스트 보상을 받으면 수료증이 발급돼요.' : `메인 퀘스트 「${def?.title || '체험관에 오신 것을 환영합니다'}」를 완료하고 보상을 받으면 수료증이 발급돼요.`)), go),
          bar(doneN, objs.length || 1, `${doneN} / ${objs.length}단계`, 'bar-gold'),
          ul),
        h('div', { class: 'eng-cert-frame preview' }, preview, h('div', { class: 'eng-cert-badge' }, '미리보기')));
    },

    // ============================================================ 랭킹
    async ranking(opts = {}) {
      if (!G.state) return { mode: 'local', rows: [], me: null };
      if (!opts.force && this._rank && performance.now() - this._rankAt < 60000) return this._rank;
      if (this._rankBusy) return this._rankBusy;
      const run = async () => {
        let res;
        if (G.net?.mode === 'server') {
          try {
            const d = await G.net.request('ranking/top.php', { timeout: 8000 });
            const rows = (Array.isArray(d?.ranking) ? d.ranking : []).slice(0, 50).map((r, i) => ({
              rank: int(r?.rank, 1, 1e7, i + 1), nickname: str(r?.nickname, 24) || '체험객', level: int(r?.level, 1, 999, 1),
              exp: int(r?.exp, 0, 1e12, 0), title: str(r?.title, 24), me: r?.me === true,
            }));
            const me = isObj(d?.me) ? { rank: int(d.me.rank, 1, 1e7, 1), nickname: str(d.me.nickname, 24) || (G.state.profile?.nickname || '나'), level: int(d.me.level, 1, 999, 1), exp: int(d.me.exp, 0, 1e12, 0), title: str(G.state.profile?.title, 24), me: true } : null;
            res = { mode: 'server', rows, me, total: int(d?.total, 0, 1e9, rows.length) };
          } catch (err) {
            res = this._localRanking();
            res.mode = 'local';
            res.error = str(err?.message, 120) || '서버 랭킹을 불러오지 못했어요.';
          }
        } else res = this._localRanking();
        res.at = now();
        this._rank = res;
        this._rankAt = performance.now();
        return res;
      };
      this._rankBusy = run().finally(() => { this._rankBusy = null; });
      return this._rankBusy;
    },
    _localRanking() {
      const st = G.state, s = st.stats || {};
      const myNick = str(st.profile?.nickname, 24) || '나';
      const names = [];
      for (const o of G.sys.social?.others?.values?.() || []) { const n = str(o?.name, 24); if (n) names.push(n); }
      if (!names.length) for (const n of G.data.visitors?.names || []) names.push(str(n, 24));
      const uniq = [...new Set(names.filter((n) => n && n !== myNick))].slice(0, 30);
      const titles = G.data.levels?.titles || {};
      const titleFor = (lv) => { let t = ''; for (const [k, v] of Object.entries(titles)) if (lv >= Number(k)) t = v; return t; };
      const expFor = (lv) => Math.max(1, Math.round(G.data.levels?.expFor?.(lv) || 100 * lv));
      const rows = uniq.map((name) => {
        const hv = U.hashInt(`rank|${name}`);
        const level = 1 + (hv % 9);
        return { nickname: name, level, exp: Math.floor(hv / 4096) % expFor(level), title: titleFor(level), me: false, sim: true };
      });
      const myLv = int(s.level, 1, 999, 1);
      rows.push({ nickname: myNick, level: myLv, exp: int(s.exp, 0, 1e12, 0), title: str(st.profile?.title, 24) || titleFor(myLv), me: true });
      rows.sort((a, b) => b.level - a.level || b.exp - a.exp || (a.me ? -1 : b.me ? 1 : a.nickname.localeCompare(b.nickname, 'ko')));
      rows.forEach((r, i) => { r.rank = i + 1; });
      return { mode: 'local', rows, me: rows.find((r) => r.me) || null, total: rows.length };
    },
    _renderRank(p) {
      const head = h('div', { class: 'eng-rhead' });
      const body = h('div', { class: 'eng-rbody' }, h('div', { class: 'eng-skel' }, h('i'), h('i'), h('i'), h('i')));
      p.append(head, body);
      const fill = (res) => {
        if (!p.isConnected || this._tab !== 'rank') return;
        const refresh = h('button', { type: 'button', class: 'btn btn-soft btn-sm' }, h('span', { class: 'ico ico-sm', 'data-icon': 'refresh' }), ' 새로고침');
        refresh.addEventListener('click', () => {
          if (performance.now() - this._rankAt < 5000) { G.ui.toast('잠시 후 다시 눌러 주세요.', { sound: false }); return; }
          body.replaceChildren(h('div', { class: 'eng-skel' }, h('i'), h('i'), h('i'), h('i')));
          this.ranking({ force: true }).then(fill);
        });
        head.replaceChildren(
          h('span', { class: `chip ${res.mode === 'server' ? 'chip-blue' : 'chip-green'}` }, res.mode === 'server' ? '🌐 서버 랭킹' : '🏡 로컬 랭킹'),
          h('small', { class: 'muted' }, `레벨·경험치 순 · ${new Date(res.at || now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`),
          h('div', { class: 'grow' }), refresh);
        G.ui.hydrateIcons(head);
        body.replaceChildren();
        if (res.error) body.appendChild(h('div', { class: 'notice-box eng-note' }, `${res.error} 이 기기의 기록으로 대신 보여 드려요.`));
        const rows = res.rows || [];
        if (!rows.length) { body.appendChild(h('div', { class: 'empty' }, '아직 랭킹에 오른 체험객이 없어요. 첫 번째 주인공이 되어 보세요!')); return; }
        const me = res.me || rows.find((r) => r.me);
        if (me) {
          const above = rows.find((r) => r.rank === me.rank - 1);
          const tip = above ? (above.level > me.level ? `${above.nickname}님을 따라잡으려면 레벨 ${above.level}까지 올라가야 해요. 화이팅! 💪` : `${above.nickname}님까지 EXP ${fmt(Math.max(1, above.exp - me.exp + 1))}만 더 모으면 돼요! 💪`) : '지금 1등이에요! 👑 자리를 지켜 보세요.';
          body.appendChild(h('div', { class: 'eng-rme' }, h('span', { class: 'emoji' }, me.rank <= 3 ? ['🥇', '🥈', '🥉'][me.rank - 1] : '🏅'), h('div', null, h('b', null, `내 순위 ${me.rank}위${res.total ? ` / ${fmt(res.total)}명` : ''}`), h('small', null, tip))));
        }
        const avatar = (r) => { const a = h('span', { class: 'eng-rava', 'aria-hidden': 'true' }, Array.from(r.nickname)[0] || '?'); a.style.setProperty('--hue', String(U.hashInt(`hue|${r.nickname}`) % 360)); return a; };
        const pod = h('div', { class: 'eng-podium' });
        const medals = ['🥇', '🥈', '🥉'];
        for (const idx of [1, 0, 2]) {
          const r = rows[idx];
          if (!r) continue;
          const col = h('div', { class: `eng-pod p${idx + 1}${r.me ? ' me' : ''}` },
            h('div', { class: 'eng-pod-medal emoji' }, medals[idx]), avatar(r),
            h('b', { class: 'eng-pod-name' }, r.nickname), r.me ? h('span', { class: 'chip chip-gold' }, '나') : null,
            h('small', null, `Lv.${r.level}`), h('div', { class: 'eng-pod-bar' }, h('span', null, String(idx + 1))));
          pod.appendChild(col);
        }
        body.appendChild(pod);
        const expFor = (lv) => Math.max(1, Math.round(G.data.levels?.expFor?.(lv) || 100 * lv));
        const list = h('div', { class: 'eng-rlist', role: 'list' });
        const rowEl = (r) => {
          const el = h('div', { class: `eng-rrow${r.me ? ' me' : ''}`, role: 'listitem' },
            h('span', { class: 'eng-rrank' }, String(r.rank)), avatar(r),
            h('div', { class: 'eng-rname' }, h('b', null, r.nickname), r.me ? h('span', { class: 'chip chip-gold' }, '나') : null, r.title ? h('small', null, r.title) : null),
            h('span', { class: 'lv-chip' }, `Lv.${r.level}`),
            bar(r.exp, expFor(r.level), `${fmt(r.exp)} EXP`, 'bar-purple'));
          return el;
        };
        rows.slice(3, 30).forEach((r, i) => { const el = rowEl(r); el.style.setProperty('--i', String(Math.min(i, 12))); list.appendChild(el); });
        if (res.me && !rows.some((r) => r.me)) { list.appendChild(h('div', { class: 'eng-rsep' }, '⋯')); list.appendChild(rowEl(res.me)); }
        if (list.children.length) body.appendChild(list);
        body.appendChild(h('p', { class: 'eng-foot' }, res.mode === 'server' ? '서버에 저장된 체험객의 레벨과 누적 경험치로 순위를 매겨요. 닉네임만 공개돼요.' : '로컬 모드에서는 지금 함께 있는 체험객(가상 체험객 포함)과 내 기록을 비교해요.'));
      };
      this.ranking().then(fill).catch(() => fill(this._localRanking()));
    },

    // ============================================================ 꾸미기 — yard
    yard() { const y = this._yard; return y ? { x: y.x, z: y.z, rot: y.rot, name: y.name, w: YW, d: YD, y: y.y, front: y.front, cells: y.cells.map((c) => ({ ix: c.ix, iz: c.iz, x: c.x, z: c.z, ok: c.ok, sign: c.sign })) } : null; },
    decorList() { return (this._E()?.decor || []).map((d) => ({ ...d })); },
    _anchorList() {
      const out = [];
      const L = G.data.layout || {};
      const add = (x, z, r) => { if (Number.isFinite(x) && Number.isFinite(z)) out.push([x, z, r]); };
      for (const e of G.interact?.list?.() || []) {
        if (!e || e.kind === 'npc' || e.kind === 'companion' || String(e.id || '').startsWith('ENG_')) continue;
        const p = readPos(e);
        if (p) add(p.x, p.z, 2.3);
      }
      for (const z of L.photoZones || []) add(z.x, z.z, (z.r || 4) + 0.8);
      for (const b of L.benches || []) add(b.x, b.z, 1.8);
      for (const l of L.lanterns || []) add(l.x, l.z, 1.3);
      for (const s of L.signs || []) add(s.x, s.z, 2.2);
      for (const f of L.flowerBeds || []) add(f.x, f.z, (f.r || 3) + 0.6);
      for (const t of L.landmarkTrees || []) add(t.x, t.z, 2.4 * (t.scale || 1));
      for (const p of L.farmPlots || []) add(p.x, p.z, Math.hypot(p.w || 6, p.d || 6) / 2 + 1.4);
      for (const j of L.jars || []) add(j.x, j.z, 1.8);
      for (const p of L.ponds || []) add(p.x, p.z, (p.r || 5) + 2);
      for (const n of Object.values(G.data.npcs || {})) if (Array.isArray(n.pos)) add(n.pos[0], n.pos[1], 2.6 + (Number(n.wander) || 0));
      return out;
    },
    _staticCols(x, z, R) {
      const out = [];
      const cols = G.world.colliders;
      if (!cols?.values) return out;
      for (const c of cols.values()) {
        if (!c || c.disabled) continue;
        if (typeof c.tag === 'string' && DYNAMIC_TAG.test(c.tag)) continue;
        const ext = c.shape === 'circle' ? c.r : Math.hypot(c.hw || 0, c.hd || 0);
        if (Math.hypot(c.x - x, c.z - z) > R + ext) continue;
        out.push(c);
      }
      return out;
    },
    _cellOk(x, z, cy, y0, env) {
      const W = G.world, b = W.bounds;
      if (!Number.isFinite(cy) || x < b.minX + 3 || x > b.maxX - 3 || z < b.minZ + 3 || z > b.maxZ - 3) return false;
      if (Math.abs(cy - y0) > 0.35) return false;
      if (W.isWater(x, z) || W.surfaceAt(x, z) !== 'grass') return false;
      if (Math.abs(W.heightAt(x, z, cy + 0.5) - cy) > 0.05) return false; // a walkable platform / deck is here
      for (const [dx, dz] of CORNERS) {
        if (Math.abs(W.heightAt(x + dx, z + dz, cy + 0.5) - cy) > 0.14) return false;
        if (W.isWater(x + dx, z + dz) || W.surfaceAt(x + dx, z + dz) !== 'grass') return false;
      }
      for (const c of env.cols) if (colHit(c, x, z, 0.5)) return false;
      for (const a of env.anchors) { const dx = x - a[0], dz = z - a[1]; if (dx * dx + dz * dz < a[2] * a[2]) return false; }
      return true;
    },
    _evalYard(x, z, rot, env) {
      const W = G.world;
      const c = Math.cos(rot), s = Math.sin(rot);
      const y0 = W.terrainHeight(x, z);
      const cells = [];
      let ok = 0;
      for (let iz = 0; iz < YD; iz++) {
        for (let ix = 0; ix < YW; ix++) {
          const lx = (ix - (YW - 1) / 2) * CELL, lz = (iz - (YD - 1) / 2) * CELL;
          const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
          const cy = W.terrainHeight(wx, wz);
          const good = this._cellOk(wx, wz, cy, y0, env);
          if (good) ok++;
          cells.push({ ix, iz, lx, lz, x: wx, z: wz, y: cy, ok: good, sign: false });
        }
      }
      return { x, z, rot, cos: c, sin: s, y: y0, cells, ok };
    },
    _setupYard() {
      this._clear3D();
      const e = this._E();
      if (!this._3d || !e || !G.world?.terrainHeight) { this._yard = null; this._flushRefunds(); return; }
      const anchors = this._anchorList();
      let yard = null;
      if (e.yard && e.yard.v === YARD_V) {
        const env = { anchors, cols: this._staticCols(e.yard.x, e.yard.z, 8) };
        const ev = this._evalYard(e.yard.x, e.yard.z, e.yard.rot, env);
        if (ev.ok >= YW * YD * 0.6) yard = Object.assign(ev, { name: e.yard.name });
      }
      if (!yard) {
        let best = null;
        for (let k = 0; k < YARD_SPOTS.length; k++) {
          const sp = YARD_SPOTS[k];
          const env = { anchors, cols: this._staticCols(sp.x, sp.z, 12) };
          for (const rot of sp.rot ? [sp.rot, 0] : [0]) {
            for (let dz = -3; dz <= 3; dz++) {
              for (let dx = -3; dx <= 3; dx++) {
                const ev = this._evalYard(sp.x + dx, sp.z + dz, rot, env);
                const score = ev.ok + sp.bonus + (rot === sp.rot ? 0.5 : 0) - Math.hypot(dx, dz) * 0.12;
                if (!best || score > best.score) best = Object.assign(ev, { score, name: sp.name });
              }
            }
          }
          if (k === 0 && best && best.ok === YW * YD) break;
        }
        if (best && best.ok >= 8) {
          yard = best;
          e.yard = { v: YARD_V, x: Math.round(best.x * 100) / 100, z: Math.round(best.z * 100) / 100, rot: Math.round(best.rot * 10000) / 10000, name: best.name };
          G.dirty('engagement');
          G.log.info(CAT, `yard at (${best.x}, ${best.z}) rot ${best.rot.toFixed(2)} · ${best.ok}/${YW * YD} cells (${best.name})`);
        }
      }
      this._yard = yard;
      if (!yard) { G.log.warn(CAT, 'no free spot for the personal yard'); this._flushRefunds(); return; }
      // sign cell: on the side of the yard nearer to the plaza (that row is the "front")
      const front = (row) => { const c = yard.cells.find((x) => x.iz === row && x.ix === (YW - 1) / 2); return c ? Math.hypot(c.x, c.z) : Infinity; };
      yard.front = front(0) <= front(YD - 1) ? -1 : 1;
      const row = yard.front < 0 ? 0 : YD - 1;
      const sign = yard.cells.find((c) => c.iz === row && c.ok) || yard.cells.find((c) => c.ok);
      if (sign) sign.sign = true;
      yard.signCell = sign || null;
      yard.center = new THREE.Vector3(yard.x, yard.y + 0.2, yard.z);
      this._remapDecor();
      this._buildGrid();
      this._buildSign();
      this._rebuildDecor(true);
      this._flushRefunds();
    },
    _cellAt(ix, iz) { const y = this._yard; return y && ix >= 0 && iz >= 0 && ix < YW && iz < YD ? y.cells[iz * YW + ix] : null; },
    _cellAtWorld(wx, wz) {
      const y = this._yard;
      if (!y) return null;
      const dx = wx - y.x, dz = wz - y.z;
      const lx = dx * y.cos - dz * y.sin, lz = dx * y.sin + dz * y.cos;
      return this._cellAt(Math.round(lx / CELL + (YW - 1) / 2), Math.round(lz / CELL + (YD - 1) / 2));
    },
    _local(lx, lz) { const y = this._yard; return { x: y.x + lx * y.cos + lz * y.sin, z: y.z - lx * y.sin + lz * y.cos }; },
    _remapDecor() {
      const e = this._E(), y = this._yard;
      const used = new Set();
      const keep = [];
      for (const d of e.decor) {
        let cell = d.cx != null && d.cz != null ? this._cellAt(d.cx, d.cz) : null;
        if (!cell && Number.isFinite(d.x) && Number.isFinite(d.z)) cell = this._cellAtWorld(d.x, d.z);
        if (!cell || !cell.ok || cell.sign || used.has(cell)) { this._refunds.push(d.item); continue; }
        used.add(cell);
        d.cx = cell.ix; d.cz = cell.iz;
        d.x = Math.round(cell.x * 100) / 100; d.z = Math.round(cell.z * 100) / 100;
        keep.push(d);
      }
      if (keep.length !== e.decor.length) G.dirty('engagement');
      e.decor = keep;
      if (y && !keep.length) this._recs.clear();
    },
    _flushRefunds() {
      if (!this._refunds.length || !G.state) return;
      const list = this._refunds.splice(0);
      let n = 0;
      for (const id of list) if (invGive(id, 1, 'decor-refund')) n++;
      if (n) {
        G.dirty('engagement');
        setTimeout(() => { if (G.state) G.ui.toast(`둘 자리가 없는 장식 ${n}개를 가방으로 돌려보냈어요.`, { emoji: '🎒', type: 'info' }); }, 1500);
      }
    },
    _decorAt(cell) { if (!cell) return null; const e = this._E(); return e?.decor.find((d) => d.cx === cell.ix && d.cz === cell.iz) || null; },

    // ============================================================ 꾸미기 — 3D
    _build3D() {
      const scene = G.sys.engine?.scene;
      if (!scene) return;
      const root = new THREE.Group();
      root.name = 'engagement-decor';
      scene.add(root);
      const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
      const glaze = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.06 });
      const petal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
      const silk = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: 0xffffff, emissiveIntensity: 0 });
      // per-vertex emissive: the red silk glows red and the blue bands glow blue at night
      silk.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb * 1.6;'); };
      silk.customProgramCacheKey = () => 'eng-lantern-silk';
      G.world.addNightMaterial?.(silk, 1.25, 0);
      const geo = { jar: geoJar(), potBase: geoPotBase(), potPetals: geoPotPetals(), stand: geoLanternStand(), silk: geoLanternSilk() };
      const inst = (g, m, cast = true) => {
        const im = new THREE.InstancedMesh(g, m, MAX_DECOR);
        im.count = 0; im.castShadow = cast; im.receiveShadow = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        root.add(im);
        return im;
      };
      const meshes = {
        ITEM_SMALL_JAR: [{ mesh: inst(geo.jar, glaze) }],
        ITEM_FLOWERPOT: [{ mesh: inst(geo.potBase, solid) }, { mesh: inst(geo.potPetals, petal), petals: true }],
        ITEM_LANTERN: [{ mesh: inst(geo.stand, solid) }, { mesh: inst(geo.silk, silk), swing: true }],
      };
      const pm = meshes.ITEM_FLOWERPOT[1].mesh;
      for (let i = 0; i < MAX_DECOR; i++) pm.setColorAt(i, _col.set('#ffffff'));
      // night glow sprites for lanterns (one Points draw)
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DECOR * 3), 3).setUsage(THREE.DynamicDrawUsage));
      gGeo.setDrawRange(0, 0);
      const glow = new THREE.Points(gGeo, new THREE.PointsMaterial({ size: 1.5, map: G.gfx.radialTexture(64, 'rgba(255,196,130,1)', 'rgba(255,120,60,0)'), color: 0xffc58a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      glow.frustumCulled = false; glow.visible = false; glow.renderOrder = 5;
      root.add(glow);
      // edit-mode helpers
      const ghostMat = new THREE.MeshBasicMaterial({ color: 0x6dffa0, transparent: true, opacity: 0.5, depthWrite: false });
      const ghosts = {};
      const mk = (g, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, ghostMat); m.position.set(x, y, z); m.renderOrder = 6; return m; };
      ghosts.ITEM_SMALL_JAR = new THREE.Group().add(mk(geo.jar));
      ghosts.ITEM_FLOWERPOT = new THREE.Group().add(mk(geo.potBase), mk(geo.potPetals));
      ghosts.ITEM_LANTERN = new THREE.Group().add(mk(geo.stand), mk(geo.silk, HOOK.x, HOOK.y, HOOK.z));
      for (const g of Object.values(ghosts)) { g.visible = false; root.add(g); }
      const hover = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6dffa0, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
      hover.visible = false; hover.renderOrder = 4;
      const sel = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
      sel.visible = false; sel.renderOrder = 4;
      root.add(hover, sel);
      // yard sign (board texture drawn per profile)
      const sc = document.createElement('canvas');
      sc.width = 256; sc.height = 128;
      const tex = new THREE.CanvasTexture(sc);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.85 });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      const sign = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), wood);
      post.position.y = 0.475; post.castShadow = true;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.04), [wood, wood, wood, wood, face, wood]);
      board.position.set(0, 0.92, 0.04); board.castShadow = true;
      sign.add(post, board);
      sign.visible = false;
      root.add(sign);
      this._3d = { root, geo, meshes, glow, ghostMat, ghosts, hover, sel, sign, signCanvas: sc, signTex: tex, grid: null, signCol: null, lanterns: 0 };
    },
    _clear3D() {
      const T = this._3d;
      for (const id of this._recs.keys()) { const r = this._recs.get(id); if (r.col != null) G.world.removeCollider?.(r.col); }
      this._recs.clear();
      this._byType = {};
      this._pops.length = 0;
      if (!T) return;
      for (const parts of Object.values(T.meshes)) for (const p of parts) p.mesh.count = 0;
      T.glow.geometry.setDrawRange(0, 0);
      T.glow.visible = false;
      T.lanterns = 0;
      T.sign.visible = false;
      if (T.signCol != null) { G.world.removeCollider?.(T.signCol); T.signCol = null; }
      if (T.grid) { T.root.remove(T.grid); T.grid.traverse((o) => o.geometry?.dispose?.()); T.grid = null; }
      for (const g of Object.values(T.ghosts)) g.visible = false;
      T.hover.visible = false; T.sel.visible = false;
    },
    _buildGrid() {
      const T = this._3d, y = this._yard;
      if (!T || !y) return;
      if (T.grid) { T.root.remove(T.grid); T.grid.traverse((o) => o.geometry?.dispose?.()); }
      const okTri = [], badTri = [], lines = [];
      const q = 0.47;
      for (const c of y.cells) {
        const pts = [[-q, -q], [q, -q], [q, q], [-q, q]].map(([a, b]) => { const w = this._local(c.lx + a, c.lz + b); return [w.x, c.y + 0.035, w.z]; });
        const tri = c.ok ? okTri : badTri;
        tri.push(...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]);
        if (c.ok) for (let i = 0; i < 4; i++) lines.push(...pts[i], ...pts[(i + 1) % 4]);
      }
      const grp = new THREE.Group();
      const mkMesh = (arr, color, opacity) => {
        if (!arr.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
        m.renderOrder = 3;
        grp.add(m);
      };
      mkMesh(okTri, 0x7dffb0, 0.12);
      mkMesh(badTri, 0xff6b5e, 0.1);
      if (lines.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }));
        l.renderOrder = 3;
        grp.add(l);
      }
      const hw = (YW * CELL) / 2 + 0.06, hd = (YD * CELL) / 2 + 0.06;
      const border = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]].map(([a, b]) => { const w = this._local(a, b); return new THREE.Vector3(w.x, y.y + 0.05, w.z); });
      const bl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(border), new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, depthWrite: false }));
      bl.renderOrder = 3;
      grp.add(bl);
      grp.visible = !!this._edit;
      T.grid = grp;
      T.root.add(grp);
    },
    _buildSign() {
      const T = this._3d, y = this._yard;
      if (!T || !y) return;
      const c = y.signCell;
      if (!c) { T.sign.visible = false; G.interact?.unregister?.(YARD_ID); return; }
      T.sign.position.set(c.x, c.y, c.z);
      T.sign.rotation.y = y.rot + (y.front < 0 ? Math.PI : 0);
      T.sign.visible = true;
      T.sign.updateMatrixWorld(true);
      if (T.signCol != null) G.world.removeCollider?.(T.signCol);
      T.signCol = G.world.addCollider?.({ shape: 'circle', x: c.x, z: c.z, r: 0.14, maxY: c.y + 1.15, tag: 'eng:sign' }) ?? null;
      this._drawSign();
      const pos = new THREE.Vector3(c.x, c.y + 0.9, c.z);
      G.interact?.register?.({ id: YARD_ID, kind: 'sign', label: '내 마당 꾸미기', position: pos, object: T.sign, radius: 2.4, onInteract: () => this.open('decor') });
    },
    _drawSign() {
      const T = this._3d;
      if (!T || !G.state) return;
      const cv = T.signCanvas, ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#8a5d38'); g.addColorStop(1, '#5e3c22');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.14; ctx.strokeStyle = '#2a170b';
      for (let yy = 12; yy < H; yy += 13) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.bezierCurveTo(W * 0.3, yy + 4, W * 0.7, yy - 4, W, yy + 1); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8);
      const chars = Array.from(str(G.state.profile?.nickname, 24) || '체험객');
      const nick = chars.length > 8 ? `${chars.slice(0, 7).join('')}…` : chars.join('');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff4dc';
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
      let size = 34;
      ctx.font = `800 ${size}px ${FONT}`;
      const line = `${nick}님의 마당`;
      while (ctx.measureText(line).width > W - 30 && size > 14) { size -= 2; ctx.font = `800 ${size}px ${FONT}`; }
      ctx.fillText(line, W / 2, H * 0.42);
      ctx.font = `600 18px ${FONT}`; ctx.fillStyle = '#f4d9a8';
      ctx.fillText('꾸미기 · E', W / 2, H * 0.76);
      ctx.shadowColor = 'transparent';
      T.signTex.needsUpdate = true;
    },
    /** colliders + instance buffers from G.state.engagement.decor */
    _rebuildDecor(structural = true) {
      const T = this._3d, y = this._yard, e = this._E();
      if (!T || !y || !e) return;
      const keep = new Set();
      for (const d of e.decor) {
        keep.add(d.id);
        let r = this._recs.get(d.id);
        const cell = this._cellAt(d.cx, d.cz);
        if (!cell) continue;
        if (!r) {
          const info = DECOR_INFO[d.item];
          r = { d, cell, yaw: y.rot + d.rot, phase: (U.hashInt(d.id) % 1000) / 159, col: null, scale: 1 };
          r.col = G.world.addCollider?.({ shape: 'circle', x: cell.x, z: cell.z, r: info.r, maxY: cell.y + info.h, tag: `decor:${d.id}` }) ?? null;
          this._recs.set(d.id, r);
        }
        r.d = d; r.cell = cell;
      }
      for (const [id, r] of [...this._recs]) if (!keep.has(id)) { if (r.col != null) G.world.removeCollider?.(r.col); this._recs.delete(id); }
      this._byType = {};
      for (const d of e.decor) { const r = this._recs.get(d.id); if (r) (this._byType[d.item] || (this._byType[d.item] = [])).push(r); }
      for (const item of DECOR_ITEMS) this._syncType(item, G.time.elapsed, structural);
    },
    _syncType(item, t, structural, swingOnly = false) {
      const T = this._3d;
      if (!T) return;
      const list = this._byType[item] || [];
      const swingOn = !reduceMotion();
      for (const part of T.meshes[item]) {
        if (swingOnly && !part.swing) continue;
        const mesh = part.mesh;
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          const c = r.cell;
          _m.compose(_p.set(c.x, c.y, c.z), _q.setFromAxisAngle(_UP, r.yaw), _s.setScalar(Math.max(0.001, r.scale)));
          if (part.swing) {
            _m3.makeTranslation(HOOK.x, HOOK.y, HOOK.z);
            const a = swingOn ? Math.sin(t * 1.3 + r.phase) * 0.07 : 0, b = swingOn ? Math.sin(t * 0.9 + r.phase * 1.7) * 0.05 : 0;
            _m2.makeRotationFromEuler(_e3.set(b, 0, a, 'XYZ'));
            _m.multiply(_m3).multiply(_m2);
          }
          mesh.setMatrixAt(i, _m);
          if (part.petals && structural) {
            const pal = ['#ff7eb6', '#ffd23f', '#ffffff', '#b48be0', '#ff9f43', '#ff6b5e', '#7fc4ff'];
            mesh.setColorAt(i, _col.set(pal[U.hashInt(`petal|${r.d.id}`) % pal.length]));
          }
        }
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (part.petals && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (structural) mesh.computeBoundingSphere();
      }
      if (item === 'ITEM_LANTERN' && !swingOnly) {
        const pos = T.glow.geometry.attributes.position;
        for (let i = 0; i < list.length; i++) {
          const r = list[i], c = r.cell;
          _m.compose(_p.set(c.x, c.y, c.z), _q.setFromAxisAngle(_UP, r.yaw), _s.setScalar(Math.max(0.001, r.scale)));
          _v.set(HOOK.x, HOOK.y - 0.29, HOOK.z).applyMatrix4(_m);
          pos.setXYZ(i, _v.x, _v.y, _v.z);
        }
        pos.needsUpdate = true;
        T.glow.geometry.setDrawRange(0, list.length);
        T.lanterns = list.length;
      }
    },
    _update3D(dt, t) {
      const T = this._3d;
      if (!this._yard || !T) return;
      // pop-in animations (elastic overshoot)
      const dirty = DIRTY;
      dirty.clear();
      let ended = false;
      for (let i = this._pops.length - 1; i >= 0; i--) {
        const p = this._pops[i];
        p.t += dt;
        const r = this._recs.get(p.id);
        if (!r) { this._pops.splice(i, 1); continue; }
        const k = clamp(p.t / 0.45, 0, 1);
        r.scale = k >= 1 ? 1 : 1 - Math.cos(k * Math.PI * 2.5) * Math.exp(-k * 5.5) * (1 - k * 0.2);
        if (k >= 1) { r.scale = 1; this._pops.splice(i, 1); ended = true; }
        dirty.add(r.d.item);
      }
      // smooth rotation
      for (const r of this._recs.values()) {
        const want = this._yard.rot + r.d.rot;
        const diff = U.angleDiff(r.yaw, want);
        if (Math.abs(diff) > 0.002) { r.yaw += diff * U.damp(14, dt); dirty.add(r.d.item); }
        else if (r.yaw !== want) { r.yaw = want; dirty.add(r.d.item); }
      }
      for (const item of dirty) this._syncType(item, t, ended); // bounds are recomputed when a pop-in ends
      // lanterns: swing + night glow (only when the camera is near)
      if (T.lanterns) {
        const cam = G.sys.engine?.camera?.position;
        const near = cam ? Math.hypot(cam.x - this._yard.x, cam.z - this._yard.z) < 80 : false;
        if (near && !reduceMotion() && !dirty.has('ITEM_LANTERN')) this._syncType('ITEM_LANTERN', t, false, true);
        const nf = clamp(Number(G.world.nightFactor) || 0, 0, 1);
        const vis = nf > 0.04 && near;
        T.glow.visible = vis;
        if (vis) T.glow.material.opacity = nf * (0.8 + 0.07 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 12.7));
      } else T.glow.visible = false;
      if (this._edit) this._updateEdit(dt, t);
    },

    // ============================================================ 꾸미기 — edit mode
    _canPlace(item, cell) {
      const e = this._E();
      if (!cell) return { ok: false, why: '마당 안을 골라 주세요.' };
      if (!cell.ok) return { ok: false, why: '여기는 놓을 수 없는 자리예요.' };
      if (cell.sign) return { ok: false, why: '마당 표지판 자리예요.' };
      if (this._decorAt(cell)) return { ok: false, why: '이미 장식이 있어요.' };
      if (e.decor.length >= MAX_DECOR) return { ok: false, why: `장식은 ${MAX_DECOR}개까지 놓을 수 있어요.` };
      if (!DECOR_ITEMS.includes(item)) return { ok: false, why: '꾸미기 장식이 아니에요.' };
      if (invCount(item) < 1) return { ok: false, why: `가방에 ${josa(itemName(item), '이/가')} 없어요. 출석 7일차 선물이나 입구 매점에서 구할 수 있어요.` };
      return { ok: true };
    },
    placeDecor(item, cx, cz, rot = 0) {
      if (!G.state || !this._yard || !this._3d) return null;
      const cell = this._cellAt(int(cx, -1, 99, -1), int(cz, -1, 99, -1));
      const can = this._canPlace(item, cell);
      if (!can.ok) { G.ui.toast(can.why, { type: 'warn', sound: false }); G.sfx('error'); return null; }
      if (!invTake(item)) { G.ui.toast(`가방에 ${josa(itemName(item), '이/가')} 없어요.`, { type: 'warn' }); return null; }
      const e = this._E();
      const d = { id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`, item, x: Math.round(cell.x * 100) / 100, z: Math.round(cell.z * 100) / 100, rot: (Math.round(num(rot, 0) / (Math.PI / 4)) % 8 + 8) % 8 * (Math.PI / 4), cx: cell.ix, cz: cell.iz, at: now() };
      e.decor.push(d);
      this._rebuildDecor(true);
      const r = this._recs.get(d.id);
      if (r) { r.yaw = this._yard.rot + d.rot; r.scale = 0.001; this._pops.push({ id: d.id, t: 0 }); this._syncType(item, G.time.elapsed, true); }
      G.sfx('plant');
      try {
        G.fx?.burst?.('dust', { x: cell.x, y: cell.y + 0.05, z: cell.z }, { count: 10 });
        G.fx?.burst?.(item === 'ITEM_FLOWERPOT' ? 'petals' : 'sparkle', { x: cell.x, y: cell.y + 0.4, z: cell.z }, { count: 10 });
      } catch (err) { /* fx optional */ }
      G.dirty('engagement');
      G.bus.emit('engagement:decor', { action: 'place', id: d.id, item });
      if (e.decor.length === 1) this.notify({ type: 'decor', icon: '🏡', title: '나만의 마당을 꾸미기 시작했어요!', text: `${itemName(item)}을(를) 놓았어요. 장식은 최대 ${MAX_DECOR}개까지 놓을 수 있어요.`, act: 'decor', read: true });
      this._renderBar();
      this._uiDirty('decor');
      return { ...d };
    },
    removeDecor(id) {
      const e = this._E();
      const i = e ? e.decor.findIndex((d) => d.id === id) : -1;
      if (i < 0) return false;
      const d = e.decor[i];
      if (!invGive(d.item, 1, 'decor')) { G.ui.toast('가방이 가득 차서 치울 수 없어요.', { type: 'warn' }); return false; }
      e.decor.splice(i, 1);
      const cell = this._cellAt(d.cx, d.cz);
      this._rebuildDecor(true);
      if (this._edit?.sel === id) this._edit.sel = null;
      G.sfx('close');
      try { if (cell) G.fx?.burst?.('dust', { x: cell.x, y: cell.y + 0.1, z: cell.z }, { count: 12 }); } catch (err) { /* fx optional */ }
      G.ui.toast(`${josa(itemName(d.item), '을/를')} 가방에 다시 넣었어요.`, { emoji: itemIcon(d.item), sound: false });
      G.dirty('engagement');
      G.bus.emit('engagement:decor', { action: 'remove', id, item: d.item });
      this._renderBar();
      this._uiDirty('decor');
      return true;
    },
    rotateDecor(id, steps = 1) {
      const d = this._E()?.decor.find((x) => x.id === id);
      if (!d) return false;
      d.rot = (((Math.round(d.rot / (Math.PI / 4)) + steps) % 8) + 8) % 8 * (Math.PI / 4);
      G.sfx('click');
      G.dirty('engagement');
      G.bus.emit('engagement:decor', { action: 'rotate', id, item: d.item });
      return true;
    },
    async startDecor() {
      if (!G.state || this._edit || this._starting) return false;
      if (!this._3d || !this._yard) { G.ui.toast('이 기기에서는 마당을 준비하지 못했어요.', { type: 'warn' }); return false; }
      if (G.sys.dialogue?.active) { G.ui.toast('대화를 마친 뒤에 꾸밀 수 있어요.', { type: 'info' }); return false; }
      if (G.sys.photo?.active) G.sys.photo.exit?.();
      this.close();
      const y = this._yard;
      const pl = G.sys.player;
      const state = G.state;
      if (pl?.position && Math.hypot(pl.position.x - y.x, pl.position.z - y.z) > 12) {
        const f = this._local(0, y.front * (YD / 2 + 1.5));
        this._starting = true;
        try { await pl.teleport?.(f.x, f.z, y.front < 0 ? y.rot : y.rot + Math.PI); } catch (e) { /* stay */ } finally { this._starting = false; }
      } else pl?.cancelWalk?.('decor');
      if (!G.state || G.state !== state || this._edit || this._yard !== y) return false;
      const first = DECOR_ITEMS.find((id) => invCount(id) > 0) || DECOR_ITEMS[0];
      const gc = document.getElementById('game-container');
      const ed = this._edit = { item: first, rot: 0, sel: null, px: null, py: null, dirty: true, cell: null, touchCell: null, cursor: null, offs: [] };
      const onMove = (ev) => { if (ev.pointerType === 'touch' && !ev.isPrimary) return; ed.px = ev.clientX; ed.py = ev.clientY; ed.cursor = null; ed.dirty = true; };
      const onLeave = (ev) => { if (ev.pointerType === 'mouse') { ed.px = null; ed.dirty = true; } };
      gc?.addEventListener('pointermove', onMove, { passive: true });
      gc?.addEventListener('pointerleave', onLeave, { passive: true });
      ed.offs.push(() => { gc?.removeEventListener('pointermove', onMove); gc?.removeEventListener('pointerleave', onLeave); });
      ed.offs.push(G.bus.on('input:click', (ev) => this._onEditClick(ev)));
      ed.offs.push(G.ui.onEscape(() => { if (!this._edit) return false; this.stopDecor(); return true; }, 90));
      G.ui.block('decor-edit');
      document.body.classList.add('eng-decor-on');
      const T = this._3d;
      if (T.grid) T.grid.visible = true;
      G.sys.camera?.setMode?.('focus', { target: y.center, distance: 9.5, height: 1.2, yaw: y.front < 0 ? y.rot + Math.PI : y.rot, pitch: 0.82, duration: 0.9 });
      this._buildBar();
      G.sfx('open');
      if (!G.state.flags?.['eng:decorTip']) {
        G.state.flags['eng:decorTip'] = true;
        say(G.input?.touchUI ? '칸을 한 번 탭하면 미리 보고, 한 번 더 탭하면 놓아요! 놓인 장식을 탭하면 돌리거나 치울 수 있어요.' : '마우스로 칸을 고르고 클릭하면 장식이 놓여요! R로 돌리고, 놓인 장식을 클릭하면 치울 수 있어요.', { mood: 'wink', duration: 6500 });
      }
      G.log.info(CAT, 'decor edit mode on');
      return true;
    },
    stopDecor(opts = {}) {
      const ed = this._edit;
      if (!ed) return;
      this._edit = null;
      for (const off of ed.offs) { try { off(); } catch (e) { /* ignore */ } }
      G.ui.unblock('decor-edit');
      document.body.classList.remove('eng-decor-on');
      this._bar?.remove();
      this._bar = null;
      const T = this._3d;
      if (T) {
        if (T.grid) T.grid.visible = false;
        for (const g of Object.values(T.ghosts)) g.visible = false;
        T.hover.visible = false; T.sel.visible = false;
      }
      if (G.sys.camera?.mode === 'focus') G.sys.camera.setMode?.('follow', { duration: 0.8 });
      G.dirty('engagement');
      if (!opts.silent) {
        const n = this._E()?.decor.length || 0;
        G.ui.toast(n ? `마당 꾸미기 완료! 장식 ${n}개가 마당을 빛내고 있어요.` : '마당 꾸미기를 마쳤어요.', { emoji: '🏡', type: 'success' });
      }
    },
    _buildBar() {
      this._bar?.remove();
      const bar = h('div', { id: 'eng-decor-bar', class: 'eng-decor-bar glass', role: 'toolbar', 'aria-label': '마당 꾸미기 도구' });
      bar.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-edb]');
        if (!b || b.disabled) return;
        const a = b.dataset.edb;
        if (a === 'item') this._pickItem(b.dataset.item);
        else if (a === 'rotate') this._rotateKey();
        else if (a === 'remove') this._removeSelected();
        else if (a === 'place') this._confirmCursor(true);
        else if (a === 'done') this.stopDecor();
      });
      (document.getElementById('app') || document.body).appendChild(bar);
      this._bar = bar;
      this._renderBar();
    },
    _renderBar() {
      const bar = this._bar, ed = this._edit;
      if (!bar || !ed || !G.state) return;
      const e = this._E();
      const items = h('div', { class: 'edb-items' });
      DECOR_ITEMS.forEach((id, i) => {
        const n = invCount(id);
        items.appendChild(h('button', { type: 'button', class: `edb-item${ed.item === id ? ' active' : ''}${n ? '' : ' empty'}`, 'data-edb': 'item', 'data-item': id, 'aria-pressed': ed.item === id ? 'true' : 'false', title: `${itemName(id)} (${i + 1})` },
          h('span', { class: 'emoji' }, itemIcon(id)), h('b', null, DECOR_INFO[id].short), h('small', null, `×${n}`), G.input?.touchUI ? null : h('kbd', null, String(i + 1))));
      });
      const selD = ed.sel ? e.decor.find((d) => d.id === ed.sel) : null;
      const touch = !!G.input?.touchUI;
      const hint = selD ? `선택: ${itemName(selD.item)} — 돌리거나 치울 수 있어요.`
        : invCount(ed.item) < 1 ? `가방에 ${josa(itemName(ed.item), '이/가')} 없어요. 출석 7일차 선물·입구 매점에서 구할 수 있어요.`
          : touch ? '칸을 탭해 미리 보고, 한 번 더 탭하면 놓아요.' : '칸을 클릭해 놓아요 · R 돌리기 · 놓인 장식 클릭 → 선택 · Esc 완료';
      bar.replaceChildren(
        h('div', { class: 'edb-head' }, h('b', null, '🏡 마당 꾸미기'), h('span', { class: 'edb-count' }, `${e.decor.length}/${MAX_DECOR}`)),
        items,
        h('div', { class: 'edb-actions' },
          h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-edb': 'rotate' }, '⟳ 돌리기', touch ? null : h('kbd', null, 'R')),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-edb': 'remove', disabled: !selD || null }, '🗑 치우기', touch ? null : h('kbd', null, 'Del')),
          touch ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-edb': 'place', disabled: !ed.touchCell || null }, '📍 놓기') : null,
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-edb': 'done' }, '✔ 완료')),
        h('div', { class: 'edb-hint', 'aria-live': 'polite' }, hint));
    },
    _decorInvChanged() { if (this._edit) this._renderBar(); this._uiDirty('decor'); },
    _pickItem(id) {
      const ed = this._edit;
      if (!ed || !DECOR_ITEMS.includes(id)) return;
      ed.item = id; ed.sel = null; ed.dirty = true;
      G.sfx('click');
      this._renderBar();
    },
    _rotateKey() {
      const ed = this._edit;
      if (!ed) return;
      if (ed.sel) this.rotateDecor(ed.sel, 1);
      else { ed.rot = (ed.rot + Math.PI / 4) % TAU; G.sfx('click'); }
      ed.dirty = true;
    },
    _removeSelected() {
      const ed = this._edit;
      if (!ed?.sel) return;
      this.removeDecor(ed.sel);
      ed.sel = null; ed.dirty = true;
      this._renderBar();
    },
    _select(id) {
      const ed = this._edit;
      if (!ed) return;
      ed.sel = id; ed.touchCell = null; ed.dirty = true;
      if (id) G.sfx('click');
      this._renderBar();
    },
    _pickCell() {
      const ed = this._edit, y = this._yard, cam = G.sys.engine?.camera;
      if (!ed || !y || !cam) return null;
      if (ed.cursor) return this._cellAt(ed.cursor.ix, ed.cursor.iz);
      if (ed.px == null) return null;
      _ndc.set((ed.px / innerWidth) * 2 - 1, -(ed.py / innerHeight) * 2 + 1);
      _ray.setFromCamera(_ndc, cam);
      _plane.set(_UP, -(y.y + 0.02));
      if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
      return this._cellAtWorld(_hit.x, _hit.z);
    },
    _onEditClick(ev) {
      const ed = this._edit;
      if (!ed || G.ui.modal.isOpen() || (ev.button !== 0 && !ev.touch)) return;
      ed.px = ev.x; ed.py = ev.y; ed.cursor = null; ed.dirty = true;
      const cell = this._pickCell();
      if (!cell) { if (ed.sel) this._select(null); return; }
      this._actOnCell(cell, !!ev.touch);
    },
    _actOnCell(cell, touch) {
      const ed = this._edit;
      const d = this._decorAt(cell);
      if (d) { this._select(ed.sel === d.id ? null : d.id); return; }
      if (ed.sel) { this._select(null); return; }
      if (touch && ed.touchCell !== cell) { ed.touchCell = cell; ed.dirty = true; this._renderBar(); return; }
      ed.touchCell = null;
      this.placeDecor(ed.item, cell.ix, cell.iz, ed.rot);
    },
    _moveCursor(f, r) {
      const ed = this._edit, y = this._yard, cam = G.sys.engine?.camera;
      if (!ed || !y || !cam) return;
      let cur = ed.cursor;
      if (!cur) { const c = this._pickCell() || this._cellAt((YW - 1) / 2, (YD - 1) / 2); cur = { ix: c.ix, iz: c.iz }; }
      // camera forward / right in yard-local axes, snapped to the dominant axis
      cam.getWorldDirection(_v);
      const toL = (x, z) => [x * y.cos - z * y.sin, x * y.sin + z * y.cos];
      const snap = ([a, b]) => (Math.abs(a) > Math.abs(b) ? [Math.sign(a), 0] : [0, Math.sign(b)]);
      const fw = snap(toL(_v.x, _v.z)), rt = snap(toL(-_v.z, _v.x));
      cur = { ix: clamp(cur.ix + fw[0] * f + rt[0] * r, 0, YW - 1), iz: clamp(cur.iz + fw[1] * f + rt[1] * r, 0, YD - 1) };
      ed.cursor = cur; ed.dirty = true;
    },
    _confirmCursor(fromButton) {
      const ed = this._edit;
      if (!ed) return;
      const cell = fromButton ? ed.touchCell : this._pickCell();
      if (!cell) return;
      if (fromButton) { ed.touchCell = null; this.placeDecor(ed.item, cell.ix, cell.iz, ed.rot); this._renderBar(); return; }
      this._actOnCell(cell, false);
    },
    _updateEdit(dt, t) {
      const ed = this._edit, T = this._3d;
      if (!ed || !T) return;
      if (ed.dirty) {
        ed.dirty = false;
        const cell = ed.touchCell || this._pickCell();
        ed.cell = cell;
        for (const [id, g] of Object.entries(T.ghosts)) g.visible = false;
        if (cell) {
          const occ = this._decorAt(cell);
          const can = occ ? { ok: false } : this._canPlace(ed.item, cell);
          T.hover.visible = true;
          T.hover.position.set(cell.x, cell.y + 0.045, cell.z);
          T.hover.rotation.y = this._yard.rot;
          T.hover.material.color.set(occ ? 0xffd34d : can.ok ? 0x6dffa0 : 0xff6b5e);
          if (!occ && !ed.sel) {
            const g = T.ghosts[ed.item];
            g.visible = true;
            g.position.set(cell.x, cell.y, cell.z);
            g.rotation.y = this._yard.rot + ed.rot;
            T.ghostMat.color.set(can.ok ? 0x6dffa0 : 0xff6b5e);
          }
        } else T.hover.visible = false;
      }
      const g = T.ghosts[ed.item];
      if (g.visible) g.rotation.y += U.angleDiff(g.rotation.y, this._yard.rot + ed.rot) * U.damp(16, dt);
      if (ed.sel) {
        const r = this._recs.get(ed.sel);
        if (r) {
          T.sel.visible = true;
          T.sel.position.set(r.cell.x, r.cell.y + 0.05, r.cell.z);
          const s = 1 + Math.sin(t * 5) * 0.06;
          T.sel.scale.set(s, 1, s);
        } else { T.sel.visible = false; ed.sel = null; }
      } else T.sel.visible = false;
      T.ghostMat.opacity = 0.42 + Math.sin(t * 4) * 0.08;
    },
    _renderDecor(p) {
      const y = this._yard, e = this._E();
      if (!y) {
        p.appendChild(h('div', { class: 'eng-empty' }, h('div', { class: 'eng-empty-ava', 'aria-hidden': 'true', html: mascotSvg('sad', 72) }), h('b', null, '마당을 준비하지 못했어요'), h('p', null, '그래픽을 불러오지 못했거나 빈자리를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.')));
        return;
      }
      const map = h('div', { class: 'eng-yard', role: 'img', 'aria-label': `마당 배치도: 장식 ${e.decor.length}개` });
      map.style.setProperty('--cols', String(YW));
      const rows = y.front < 0 ? [...Array(YD).keys()].reverse() : [...Array(YD).keys()];
      for (const iz of rows) {
        for (let k = 0; k < YW; k++) {
          const ix = y.front < 0 ? k : YW - 1 - k;
          const c = this._cellAt(ix, iz);
          const d = this._decorAt(c);
          const cls = !c.ok ? 'bad' : c.sign ? 'sign' : d ? 'deco' : 'free';
          map.appendChild(h('span', { class: `eng-ycell ${cls}` }, c.sign ? '🪧' : d ? itemIcon(d.item) : ''));
        }
      }
      const start = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, '🏡 마당 꾸미기 시작');
      start.addEventListener('click', () => this.startDecor());
      const goto = h('button', { type: 'button', class: 'btn btn-soft' }, '📍 마당으로 이동');
      goto.addEventListener('click', async () => {
        this.close();
        const f = this._local(0, y.front * (YD / 2 + 1.5));
        try { await G.sys.player?.teleport?.(f.x, f.z, y.front < 0 ? y.rot : y.rot + Math.PI); } catch (err) { /* ignore */ }
      });
      const inv = h('div', { class: 'eng-dinv' });
      for (const id of DECOR_ITEMS) {
        const placed = e.decor.filter((d) => d.item === id).length;
        inv.appendChild(h('div', { class: 'eng-dslot' }, h('span', { class: 'emoji' }, itemIcon(id)), h('b', null, itemName(id)), h('small', null, `가방 ${invCount(id)}개 · 마당 ${placed}개`)));
      }
      p.append(
        h('div', { class: 'eng-dhead' },
          h('div', { class: 'grow' }, h('b', null, '🏡 나만의 작은 마당'), h('small', null, `${y.name} 옆, ${YW}×${YD}칸 마당이에요. 장식 ${e.decor.length}/${MAX_DECOR}개`)),
          h('div', { class: 'eng-dhead-btns' }, start, goto)),
        h('div', { class: 'eng-dgrid' }, h('div', { class: 'eng-yard-wrap' }, map, h('small', { class: 'muted' }, '▲ 마당 안쪽 · ▼ 표지판 쪽(입구)')), inv),
        h('ul', { class: 'eng-tips' },
          h('li', null, '장식을 놓으면 가방에서 1개가 빠지고, 치우면 그대로 돌려받아요.'),
          h('li', null, '🏮 청사초롱은 밤이 되면 은은하게 불을 밝혀요.'),
          h('li', null, '장식은 출석 7일차 선물로 받거나 입구 매점에서 살 수 있어요. 꽃 화분은 작업대에서 허브로 만들 수도 있어요.'),
          h('li', null, '마당 표지판 앞에서 E 키를 눌러도 꾸미기를 열 수 있어요.')));
    },
  };

  // ---------------------------------------------------------------- certificate drawing (canvas only — CSP safe)
  function fitFont(ctx, text, weight, size, family, maxW, min = 12) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (ctx.measureText(text).width > maxW && s > min) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
    return s;
  }
  function wrapLines(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
      if (cur) lines.push(cur);
      if (ctx.measureText(w).width <= maxW) { cur = w; continue; }
      let part = '';
      for (const ch of Array.from(w)) { if (ctx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ch; } else part += ch; }
      cur = part;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }
  function meander(ctx, len, hh) {
    const n = Math.max(1, Math.floor(len / (hh * 1.05)));
    const uw = len / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const X = (t) => i * uw + t * uw, Y = (t) => t * hh;
      ctx.moveTo(X(0.08), Y(0.92)); ctx.lineTo(X(0.08), Y(0.1)); ctx.lineTo(X(0.86), Y(0.1)); ctx.lineTo(X(0.86), Y(0.72));
      ctx.lineTo(X(0.32), Y(0.72)); ctx.lineTo(X(0.32), Y(0.36)); ctx.lineTo(X(0.62), Y(0.36));
    }
    ctx.moveTo(0, hh * 0.92); ctx.lineTo(len, hh * 0.92);
    ctx.stroke();
  }
  function rosette(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    for (let k = 0; k < 8; k++) {
      ctx.rotate(TAU / 8);
      ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 0.2, r * 0.44, 0, 0, TAU);
      ctx.fillStyle = k % 2 ? '#f0c75e' : '#e2ad3c'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, TAU); ctx.fillStyle = '#a8322d'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#f6e3a8'; ctx.stroke();
    ctx.restore();
  }
  function cloud(ctx, x, y, s, dir) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(dir * s, s);
    ctx.beginPath();
    ctx.moveTo(-70, 12); ctx.bezierCurveTo(-72, -10, -40, -16, -34, 2);
    ctx.bezierCurveTo(-32, -24, 4, -28, 8, -4);
    ctx.bezierCurveTo(12, -22, 46, -18, 42, 4);
    ctx.bezierCurveTo(40, 16, 22, 15, 24, 4);
    ctx.bezierCurveTo(26, -6, 36, -4, 34, 2);
    ctx.moveTo(-70, 12); ctx.lineTo(60, 12);
    ctx.stroke();
    ctx.restore();
  }
  function arcText(ctx, text, cx, cy, r, mid, step) {
    const chars = Array.from(text);
    let a = mid - ((chars.length - 1) * step) / 2;
    for (const ch of chars) {
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a += step;
    }
  }
  /** text along the bottom of a circle, reading left to right */
  function arcTextBottom(ctx, text, cx, cy, r, mid, step) {
    const chars = Array.from(text);
    let a = mid + ((chars.length - 1) * step) / 2;
    for (const ch of chars) {
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.rotate(a - Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a -= step;
    }
  }
  function jarPath(ctx, cx, cy, s) { // onggi silhouette, base at cy, height ~ 1.9 s
    ctx.beginPath();
    ctx.moveTo(cx - 0.42 * s, cy - 1.62 * s);
    ctx.bezierCurveTo(cx - 1.05 * s, cy - 1.25 * s, cx - 1.02 * s, cy - 0.3 * s, cx - 0.5 * s, cy);
    ctx.lineTo(cx + 0.5 * s, cy);
    ctx.bezierCurveTo(cx + 1.02 * s, cy - 0.3 * s, cx + 1.05 * s, cy - 1.25 * s, cx + 0.42 * s, cy - 1.62 * s);
    ctx.closePath();
  }
  function goldSeal(ctx, cx, cy, R) {
    ctx.save();
    // ribbons
    ctx.fillStyle = '#a8322d';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * R * 0.25, cy + R * 0.55);
      ctx.lineTo(cx + dir * R * 0.75, cy + R * 1.55);
      ctx.lineTo(cx + dir * R * 0.5, cy + R * 1.42);
      ctx.lineTo(cx + dir * R * 0.36, cy + R * 1.66);
      ctx.lineTo(cx - dir * R * 0.05, cy + R * 0.62);
      ctx.closePath();
      ctx.fill();
    }
    // serrated gold medal
    ctx.beginPath();
    const n = 48;
    for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * TAU; const r = i % 2 ? R : R * 0.94; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath();
    let g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#fff3c2'); g.addColorStop(0.45, '#e8bb4c'); g.addColorStop(1, '#a87516');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#8a5d0f'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.8, 0, TAU);
    g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R * 0.8);
    g.addColorStop(0, '#ffe9a0'); g.addColorStop(1, '#c9921f');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#8a5d0f'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(122,80,10,.7)'; ctx.stroke();
    // ring text
    ctx.fillStyle = '#6b4308';
    ctx.font = `800 ${Math.round(R * 0.16)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    arcText(ctx, '전통발효체험관', cx, cy, R * 0.65, -Math.PI / 2, 0.255);
    ctx.font = `700 ${Math.round(R * 0.135)}px ${FONT}`;
    arcTextBottom(ctx, '· 수료 인증 ·', cx, cy, R * 0.66, Math.PI / 2, 0.23);
    // jar emblem
    jarPath(ctx, cx, cy + R * 0.33, R * 0.33);
    g = ctx.createLinearGradient(cx, cy - R * 0.3, cx, cy + R * 0.35);
    g.addColorStop(0, '#8a5532'); g.addColorStop(1, '#4a2a17');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.22, R * 0.17, R * 0.055, 0, 0, TAU); ctx.fillStyle = '#3a2213'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - R * 0.3, cy - R * 0.02); ctx.lineTo(cx + R * 0.3, cy - R * 0.02); ctx.lineWidth = 2.5; ctx.strokeStyle = '#f4c54a'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx - R * 0.12, cy + R * 0.06, R * 0.03, R * 0.1, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill();
    ctx.restore();
  }
  function redSeal(ctx, x, y, s, rng) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(-0.06);
    ctx.beginPath();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    pts.forEach(([a, b], i) => { const jx = (rng() - 0.5) * 3, jy = (rng() - 0.5) * 3; if (i) ctx.lineTo(a * s + jx, b * s + jy); else ctx.moveTo(a * s + jx, b * s + jy); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(176,38,30,.9)'; ctx.fill();
    ctx.strokeStyle = 'rgba(250,236,220,.85)'; ctx.lineWidth = 3; ctx.strokeRect(-s * 0.78, -s * 0.78, s * 1.56, s * 1.56);
    ctx.fillStyle = '#fbefe2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(s * 0.58)}px ${SERIF}`;
    ctx.fillText('발효', 0, -s * 0.32); ctx.fillText('체험', 0, s * 0.36);
    // ink texture
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(250,236,220,${0.05 + rng() * 0.12})`; ctx.fillRect((rng() - 0.5) * s * 1.9, (rng() - 0.5) * s * 1.9, 1 + rng() * 3, 1 + rng() * 2); }
    ctx.restore();
  }
  function check(ctx, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * 0.35, y + s * 0.35); ctx.lineTo(x + s, y - s * 0.45); ctx.stroke();
    ctx.restore();
  }
  function drawCertificate(ctx, W, H, D) {
    const rng = U.rng(`cert|${D.no}|${D.nick}`);
    ctx.save();
    // hanji paper
    let g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.1, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, '#fdf8ec'); g.addColorStop(0.7, '#f3e7cb'); g.addColorStop(1, '#e3cfa2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (let i = 0; i < 380; i++) {
      const x = rng() * W, y = rng() * H, l = 8 + rng() * 34, a = rng() * TAU;
      ctx.strokeStyle = `rgba(${120 + Math.floor(rng() * 40)},${88 + Math.floor(rng() * 30)},52,${(0.035 + rng() * 0.05).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rng() - 0.5) * 7, y + Math.sin(a) * l * 0.5 + (rng() - 0.5) * 7, x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    // 단청 band frame
    const m = 30, bw = 44;
    ctx.fillStyle = '#1f4a45';
    ctx.fillRect(m, m, W - 2 * m, bw); ctx.fillRect(m, H - m - bw, W - 2 * m, bw);
    ctx.fillRect(m, m, bw, H - 2 * m); ctx.fillRect(W - m - bw, m, bw, H - 2 * m);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3;
    ctx.strokeRect(m + 1.5, m + 1.5, W - 2 * m - 3, H - 2 * m - 3);
    ctx.strokeRect(m + bw - 1.5, m + bw - 1.5, W - 2 * (m + bw) + 3, H - 2 * (m + bw) + 3);
    ctx.strokeStyle = '#d8b45a'; ctx.lineWidth = 2.6; ctx.lineCap = 'square';
    const inner = bw - 18;
    ctx.save(); ctx.translate(m + bw, m + 9); meander(ctx, W - 2 * (m + bw), inner); ctx.restore();
    ctx.save(); ctx.translate(W - m - bw, H - m - 9); ctx.rotate(Math.PI); meander(ctx, W - 2 * (m + bw), inner); ctx.restore();
    ctx.save(); ctx.translate(m + 9, H - m - bw); ctx.rotate(-Math.PI / 2); meander(ctx, H - 2 * (m + bw), inner); ctx.restore();
    ctx.save(); ctx.translate(W - m - 9, m + bw); ctx.rotate(Math.PI / 2); meander(ctx, H - 2 * (m + bw), inner); ctx.restore();
    for (const [cx, cy] of [[m, m], [W - m - bw, m], [m, H - m - bw], [W - m - bw, H - m - bw]]) {
      ctx.fillStyle = '#a8322d'; ctx.fillRect(cx, cy, bw, bw);
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.strokeRect(cx + 1.5, cy + 1.5, bw - 3, bw - 3);
      rosette(ctx, cx + bw / 2, cy + bw / 2, bw * 0.42);
    }
    // inner hairline frame with corner brackets
    const f = 96;
    ctx.strokeStyle = 'rgba(168,128,48,.75)'; ctx.lineWidth = 1.6;
    ctx.strokeRect(f, f, W - 2 * f, H - 2 * f);
    ctx.lineWidth = 3;
    for (const [x, y, sx, sy] of [[f + 10, f + 10, 1, 1], [W - f - 10, f + 10, -1, 1], [f + 10, H - f - 10, 1, -1], [W - f - 10, H - f - 10, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * 42); ctx.lineTo(x, y); ctx.lineTo(x + sx * 42, y);
      ctx.moveTo(x + sx * 12, y + sy * 26); ctx.lineTo(x + sx * 12, y + sy * 12); ctx.lineTo(x + sx * 26, y + sy * 12); ctx.stroke();
    }
    // certificate number
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#6b5435'; ctx.textAlign = 'left'; ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`제 ${D.no} 호`, f + 46, f + 62);
    ctx.textAlign = 'right';
    ctx.fillText('전통발효체험관 메타버스', W - f - 46, f + 62);
    // title + clouds
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2b1d10';
    spacing(ctx, 12);
    fitFont(ctx, '전통발효체험 수료증', 800, 88, SERIF, 900);
    ctx.fillText('전통발효체험 수료증', W / 2, 262);
    spacing(ctx, 0);
    ctx.strokeStyle = '#c29a3c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    cloud(ctx, W / 2 - 560, 236, 1.05, 1);
    cloud(ctx, W / 2 + 560, 236, 1.05, -1);
    ctx.fillStyle = '#a07d2c'; ctx.font = `700 19px ${FONT}`;
    spacing(ctx, 5);
    ctx.fillText('CERTIFICATE OF TRADITIONAL FERMENTATION EXPERIENCE', W / 2, 306);
    spacing(ctx, 0);
    ctx.strokeStyle = '#c29a3c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 300, 334); ctx.lineTo(W / 2 - 14, 334); ctx.moveTo(W / 2 + 14, 334); ctx.lineTo(W / 2 + 300, 334); ctx.stroke();
    ctx.save(); ctx.translate(W / 2, 334); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#c29a3c'; ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    // name
    ctx.fillStyle = '#1d140b';
    const ns = fitFont(ctx, D.nick, 800, 66, SERIF, 640, 28);
    const nw = ctx.measureText(D.nick).width;
    ctx.fillText(D.nick, W / 2, 422);
    ctx.font = `600 26px ${FONT}`; ctx.fillStyle = '#7a6040'; ctx.textAlign = 'right';
    ctx.fillText('성 명', W / 2 - nw / 2 - 28, 418);
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(120,90,40,.55)'; ctx.lineWidth = 1.6;
    const ul = Math.max(nw, 300) / 2 + 30;
    ctx.beginPath(); ctx.moveTo(W / 2 - ul, 438 + Math.round(ns * 0.05)); ctx.lineTo(W / 2 + ul, 438 + Math.round(ns * 0.05)); ctx.stroke();
    if (D.title) { ctx.font = `600 23px ${FONT}`; ctx.fillStyle = '#8a6a3a'; ctx.fillText(`「${D.title}」`, W / 2, 474); }
    // body paragraph
    ctx.fillStyle = '#3a2c1c'; ctx.font = `500 28px ${FONT}`;
    const para = '위 사람은 전통발효체험관 메타버스에서 장 담그기와 발효 문화, 전통 농업 체험 과정을 성실히 마쳤기에 그 배움과 노력을 기리어 이 증서를 드립니다.';
    wrapLines(ctx, para, 1040).slice(0, 3).forEach((ln, i) => ctx.fillText(ln, W / 2, 528 + i * 44));
    // info box
    const bx = 214, by = 604, bwid = W - 2 * bx, bh = 232;
    ctx.fillStyle = 'rgba(255,255,255,.36)'; ctx.strokeStyle = 'rgba(160,125,44,.5)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bwid, bh, 18); else ctx.rect(bx, by, bwid, bh);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 + 70, by + 26); ctx.lineTo(W / 2 + 70, by + bh - 26); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7a5a22'; ctx.font = `800 23px ${FONT}`;
    ctx.fillText('체험 내용', bx + 40, by + 44);
    ctx.fillStyle = '#3a2c1c'; ctx.font = `500 21px ${FONT}`;
    D.contents.forEach((t, i) => {
      const yy = by + 80 + i * 28;
      check(ctx, bx + 42, yy - 7, 14, '#2f7d4a');
      fitFont(ctx, t, 500, 21, FONT, W / 2 + 40 - (bx + 70), 14);
      ctx.fillText(t, bx + 70, yy);
    });
    const rx = W / 2 + 108;
    ctx.fillStyle = '#7a5a22'; ctx.font = `800 23px ${FONT}`;
    ctx.fillText('체험 기록', rx, by + 44);
    const rows = [['레벨', `Lv.${D.level}`], ['퀴즈 정답', `${fmt(D.quiz)}문제`], ['방문 구역', `${D.zones} / ${D.zoneTotal}곳`], ['출석', `${fmt(D.days)}일`]];
    rows.forEach(([k, v], i) => {
      const yy = by + 80 + i * 28;
      ctx.font = `600 20px ${FONT}`; ctx.fillStyle = '#7a6040'; ctx.fillText(k, rx, yy);
      ctx.font = `800 21px ${FONT}`; ctx.fillStyle = '#2b1d10'; ctx.fillText(v, rx + 120, yy);
    });
    if (D.zoneNames.length) {
      ctx.font = `500 17px ${FONT}`; ctx.fillStyle = '#6b5435';
      wrapLines(ctx, `방문: ${D.zoneNames.join(' · ')}`, bx + bwid - 36 - rx).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, rx, by + 80 + 4 * 28 + 6 + i * 23));
    }
    // date + issuer + seals
    ctx.textAlign = 'center';
    const dt = new Date(D.issued);
    ctx.fillStyle = '#2b1d10'; ctx.font = `700 30px ${SERIF}`;
    ctx.fillText(`${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`, W / 2, 912);
    ctx.font = `800 34px ${SERIF}`;
    const issuer = '전통발효체험관 메타버스';
    ctx.fillText(issuer, W / 2, 964);
    const iw = ctx.measureText(issuer).width;
    redSeal(ctx, W / 2 + iw / 2 + 52, 952, 34, rng);
    goldSeal(ctx, 246, 930, 72);
    // disclaimer
    ctx.fillStyle = '#7d6a50'; ctx.font = `500 16px ${FONT}`;
    ctx.fillText('※ 이 증서는 게임 속 체험을 기념하는 인증서로, 공식 교육 이수증이나 국가·민간 자격이 아닙니다.', W / 2, 1006);
    ctx.fillText(`※ ${G.data.meta?.titleDisclaimer || '게임 내 칭호이며 실제 자격증·전문 자격과 무관합니다.'}`, W / 2, 1028);
    if (D.preview) {
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(-0.32);
      ctx.fillStyle = 'rgba(168,50,45,.14)'; ctx.font = `800 150px ${FONT}`; ctx.textBaseline = 'middle';
      ctx.fillText('미리보기', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  G.register(eng);
})();
