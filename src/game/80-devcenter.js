// =============================================================================
// 80-devcenter.js — 개발자 점검·인수인계 센터 (CONTRACT §11.6)        G.sys.devcenter (order 95)
//
//   Open: ?dev=1 (after boot) · Ctrl+Shift+D · F9 / ` (the app shell toggles it) · main menu (action 'devcenter')
//         · G.sys.devcenter.open(tab). Esc closes. Access: always in local mode; in server mode only for an admin
//         account (G.auth.current.role from the server — never the save's profile.role) or ?dev=1 on localhost.
//   Tabs: overview 개요 · system 시스템 점검 (+ 🖥️ GPU 안전) · kids 👶 쉬운 모드 점검 · modules 모듈 상태 · data 데이터 검증 ·
//         save 저장 데이터 · server 서버 점검 · tests 자가 테스트 · debug 디버그 도구 · source 소스 구조 · docs 문서 · handover 인수인계
//   In easy mode (CONTRACT §12) opening the center asks the parent gate first (G.easy.gate); automation may pass {gate:false}.
//
//   G.sys.devcenter.open(tab?) / close() / toggle(tab?) / isOpen() / tab
//   G.sys.devcenter.lint() -> {issues, counts, byCat, entities, ms}       cross-reference linter over G.data
//   G.sys.devcenter.runTests() -> Promise<{passed, failed, skipped, total, ms, results}>   (never touches the real save)
//   G.sys.devcenter.health() -> {score, grade, ...}                       G.sys.devcenter.report() -> Promise<object>
//   G.sys.devcenter.downloadReport('md'|'json'|'both') · cheat(cmd, arg) · probe (read-only diagnostics)
//   G.sys.devcenter.kidAudit({scope, screen}) -> audit of what is on screen (tap size, labels, free text, overlap, contrast…)
//   G.sys.devcenter.kidTour({onStep}) -> Promise<{rows, totals}> opens the main screens through public APIs and audits each
//   G.sys.devcenter.kidScreens() · gpuScan() · nanTest() · showElement(el, caption)   (tools/kid-audit.mjs uses these)
//
// Instrumentation installed when this fragment is evaluated (before any system init): CSP violation listener,
// window error / unhandled rejection + console.error/warn ring buffers (pass-through), G.bus emit/on counters
// with listener attribution to the system whose lifecycle method was running, and an FPS history ring.
// Security: every dynamic string is escaped (G.util.escapeHtml) or set with textContent; the markdown renderer
// escapes first and only links http(s) URLs / in-page anchors; no inline handlers, no eval; the report and the
// screens never show password hashes, salts, CSRF tokens or full e-mail addresses.
// localStorage: tfm.v1.dev.tab · tfm.v1.dev.handover (checklist) · tfm.v1.dev.cheatlog (last 50 cheats) · tfm.v1.dev.doc
// =============================================================================
(function () {
  const U = G.util;
  const esc = (v) => U.escapeHtml(v == null ? '' : String(v));
  const fmt = (n) => U.fmt(n);
  const now = () => Date.now();
  const perf = () => performance.now();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const has = (o, k) => o != null && k != null && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const params = G.params || new URLSearchParams(location.search);
  const DEV_PARAM = params.get('dev') === '1';
  const LS = { tab: 'tfm.v1.dev.tab', handover: 'tfm.v1.dev.handover', log: 'tfm.v1.dev.cheatlog', doc: 'tfm.v1.dev.doc' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };
  const kb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} B`);
  const ago = (t) => {
    if (!t) return '-';
    const s = Math.max(0, Math.round((now() - t) / 1000));
    if (s < 5) return '방금';
    if (s < 60) return `${s}초 전`;
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
  };
  const stamp = (t = now()) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const dateTime = (t) => (t ? U.formatDate(t, true) : '-');
  const maskEmail = (e) => {
    const s = String(e || '');
    const at = s.indexOf('@');
    if (at < 1) return s ? '***' : '-';
    return `${s.slice(0, Math.min(2, at))}***${s.slice(at)}`;
  };
  const safeName = (s) => String(s || 'player').replace(/[^\w가-힣-]+/g, '_').slice(0, 32) || 'player';
  const reduceMotion = () => !!G.settings?.reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isTypingEl = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

  // =========================================================================== probe (installed at evaluation time)
  const MAX_ERR = 120, MAX_CSP = 60, MAX_EVENTS = 400, FPS_N = 120;
  const Probe = {
    bootAt: now(),
    csp: [],
    errors: [],          // {at, level:'error'|'warn'|'window'|'rejection', msg}
    bus: new Map(),      // name -> {emits, last, owners: Map(owner -> registrations)}
    owner: null,         // system whose lifecycle method is running (listener attribution)
    fps: new Float32Array(FPS_N), fpsN: 0, fpsI: 0,
    cspCount: 0, errorCount: 0, warnCount: 0,
  };

  function pushErr(level, msg) {
    if (level === 'warn') Probe.warnCount++; else Probe.errorCount++;
    const text = String(msg || '').slice(0, 600);
    const last = Probe.errors[Probe.errors.length - 1];
    if (last && last.level === level && last.msg === text && now() - last.at < 2000) { last.n = (last.n || 1) + 1; last.at = now(); return; }
    if (Probe.errors.length >= MAX_ERR) Probe.errors.shift();
    Probe.errors.push({ at: now(), level, msg: text });
  }
  /** cheap, bounded description of a console argument (never serialises big objects such as G.state) */
  function argText(a) {
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? ` @ ${String(a.stack).split('\n').slice(1, 2).join('').trim()}` : ''}`;
    if (typeof a === 'string') return a.length > 600 ? a.slice(0, 600) : a;
    if (a == null || typeof a !== 'object') return String(a);
    try {
      if (typeof a.message === 'string') return `${a.name || a.constructor?.name || 'Error'}: ${a.message.slice(0, 300)}`;
      if (Array.isArray(a)) return `[Array(${a.length})]`;
      const keys = Object.keys(a);
      return `${a.constructor?.name && a.constructor.name !== 'Object' ? a.constructor.name + ' ' : ''}{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}}`;
    } catch (e) { return '[object]'; }
  }
  try {
    document.addEventListener('securitypolicyviolation', (e) => {
      Probe.cspCount++;
      if (Probe.csp.length >= MAX_CSP) Probe.csp.shift();
      Probe.csp.push({
        at: now(), directive: String(e.effectiveDirective || e.violatedDirective || '').slice(0, 80),
        blocked: String(e.blockedURI || '').slice(0, 160), source: String(e.sourceFile || '').slice(0, 160),
        line: e.lineNumber | 0, sample: String(e.sample || '').slice(0, 80), disposition: String(e.disposition || ''),
      });
    });
    window.addEventListener('error', (e) => { if (e && (e.error || e.message)) pushErr('window', e.error ? argText(e.error) : e.message); }, true);
    window.addEventListener('unhandledrejection', (e) => pushErr('rejection', argText(e?.reason)));
    for (const level of ['error', 'warn']) {
      const orig = console[level];
      if (typeof orig !== 'function' || orig.__dcWrapped) continue;
      const wrapped = function (...args) {
        try { pushErr(level, args.map(argText).join(' ')); } catch (err) { /* never break logging */ }
        return orig.apply(this, args);
      };
      wrapped.__dcWrapped = true;
      console[level] = wrapped;
    }
  } catch (e) { /* instrumentation is optional */ }

  function busStat(name) {
    let r = Probe.bus.get(name);
    if (!r) {
      if (Probe.bus.size >= MAX_EVENTS) return null;
      r = { emits: 0, last: 0, owners: new Map() };
      Probe.bus.set(name, r);
    }
    return r;
  }
  (function wrapBus() {
    const bus = G.bus;
    if (!bus || bus.__dcWrapped) return;
    const on0 = bus.on, emit0 = bus.emit;
    bus.on = function (name, fn) {
      const off = on0.call(bus, name, fn);
      try { const r = busStat(String(name)); if (r) { const o = Probe.owner || 'boot'; r.owners.set(o, (r.owners.get(o) || 0) + 1); } } catch (e) { /* stats only */ }
      return off;
    };
    bus.emit = function (name, payload) {
      const r = busStat(String(name));
      if (r) { r.emits++; r.last = now(); }
      return emit0.call(bus, name, payload);
    };
    bus.__dcWrapped = true;
  })();
  const LIFECYCLE = ['init', 'postInit', 'onStateLoaded', 'onLogout'];
  function wrapLifecycle(sys) {
    if (!sys || sys.__dcLife) return;
    sys.__dcLife = true;
    for (const k of LIFECYCLE) {
      const orig = sys[k];
      if (typeof orig !== 'function' || orig.__dc) continue;
      const w = function (...a) {
        const prev = Probe.owner;
        Probe.owner = sys.name;
        try { return orig.apply(this, a); } finally { Probe.owner = prev; }
      };
      w.__dc = true;
      sys[k] = w;
    }
  }
  try {
    for (const s of G.systems?.() || []) wrapLifecycle(s);
    const reg0 = G.register;
    if (typeof reg0 === 'function' && !reg0.__dc) {
      const reg = function (sys) { const r = reg0.call(this, sys); try { wrapLifecycle(sys); } catch (e) { /* stats only */ } return r; };
      reg.__dc = true;
      G.register = reg;
    }
  } catch (e) { /* stats only */ }

  function fpsStats() {
    const n = Probe.fpsN;
    if (!n) { const c = Math.round(num(G.sys.engine?.fps)); return { cur: c, min: c, avg: c, max: c, series: [] }; }
    const series = new Array(n);
    let min = Infinity, max = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const v = Probe.fps[(Probe.fpsI - n + i + FPS_N) % FPS_N];
      series[i] = v; sum += v; if (v < min) min = v; if (v > max) max = v;
    }
    return { cur: Math.round(num(G.sys.engine?.fps)), min: Math.round(min), avg: Math.round(sum / n), max: Math.round(max), series };
  }

  // =========================================================================== access control
  const isLocalHost = () => location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(location.hostname);
  function access() {
    if (G.net?.mode !== 'server') return { ok: true, reason: 'local', label: '로컬 모드 (이 브라우저 전용)' };
    const role = G.auth?.current?.role || G.auth?.serverUser?.role;
    if (role === 'admin') return { ok: true, reason: 'admin', label: '서버 관리자 계정' };
    if (DEV_PARAM && isLocalHost()) return { ok: true, reason: 'dev-localhost', label: '?dev=1 · 서버 PC(localhost)' };
    return { ok: false, reason: 'denied', label: '권한 없음' };
  }

  // =========================================================================== static knowledge (source map, events)
  const OWNER = {
    core: '코어(리드)', terrain: '월드-지형', buildings: '월드-건물', player: '플레이어', npc: 'NPC', progression: '성장',
    farm: '농사·발효', edu: '교육·일지', map: '지도·날씨·사진', social: '소셜·오디오', app: '앱 셸', engagement: '참여',
    companion: '동반자', fx: '연출', devcenter: '개발자 센터', server: '서버', tools: '빌드 도구',
  };
  const F = (name, owner, purpose) => ({ name, owner, purpose });
  const SOURCE = [
    { dir: 'src/game', emoji: '🧠', desc: '게임 로직 조각(fragment) — 파일명 순서대로 한 클로저에 합쳐집니다', files: [
      F('00-core.js', 'core', '로거·이벤트 버스·유틸·아이콘·시스템 등록·게임 루프·부팅 폴백'),
      F('01-data.js', 'core', '콘텐츠 데이터: 구역·아이템·작물·레시피·NPC·퀘스트·업적·도감·팁·서버 검증 한도'),
      F('02-layout.js', 'core', '월드 배치 좌표(건물·밭·장독·안내판·포토존)와 앵커 조회 layout.get(id)'),
      F('03-state.js', 'core', '설정(기기 ↔ 프로필 키 분리·검증)·네트워크(G.net)·저장(G.save: 체크섬·백업·마이그레이션·가져오기)'),
      F('04-ui.js', 'core', 'UI 도구: 모달·토스트·보상 팝업·팝오버·월드 라벨·로딩·이스케이프'),
      F('05-input.js', 'core', '키보드·마우스·터치 조이스틱·D-패드 입력과 단축키 등록'),
      F('06-world.js', 'core', '지형 높이·충돌·구역·앵커 레지스트리, 충돌체 디버그 표시'),
      F('08-easy.js', 'core', '쉬운 모드 G.easy: 읽어주기·보호자 확인(마구 누르기 방지)·그림 고르기·다음 할 일·같이 가기·축하·놀이 시간 알림'),
      F('10-engine.js', 'core', '렌더러·씬·카메라·하늘·태양·그림자·블룸·그래픽 품질 프리셋'),
      F('11-terrain.js', 'terrain', '지형 높이장·산·강 바닥·도로·오솔길·지표 판정'),
      F('12-nature.js', 'terrain', '나무·바위·풀·꽃·구름·새·나비·반딧불 (인스턴싱)'),
      F('13-water.js', 'terrain', '강·연못 셰이더·폭포·물보라·물까지 거리'),
      F('15-buildings.js', 'buildings', '체험관 본관·한옥·초가·정자·정문·매점 건물'),
      F('16-props.js', 'buildings', '장독대·밭·안내판·키오스크·석등·벤치·전시 소품'),
      F('17-manjangdae.js', 'terrain', '시작점 정선 만장대: 전망대·팔각정·돌계단 길·첫 입장 인트로 시네마틱·망원경 투어·걷기 안내 지점(walkSpot)'),
      F('20-avatar.js', 'player', '3등신 아바타 리그·애니메이션·꾸미기 옵션·아이 모습 6종(presets)'),
      F('21-player.js', 'player', '플레이어 이동·점프·충돌·순간이동·앉기·길 찾기 걷기(walkTo·금빛 발자국)·위치 저장'),
      F('22-camera.js', 'player', '3인칭 카메라(쉬운 모드: 부드러운 카메라)·시네마틱·대화/사진 모드'),
      F('23-interaction.js', 'player', '상호작용 대상 선택(쉬운 모드: 다음 할 일 대상 우선)·금빛 👆 프롬프트·클릭 이동'),
      F('25-npc.js', 'npc', 'NPC 생성·배회·이름표 + 대화 시스템(조건·액션·타자기 효과)'),
      F('26-dialogues.js', 'npc', 'NPC 5명의 대화 트리 데이터'),
      F('30-inventory.js', 'progression', '가방·상점(구매/판매)·아이템 안내 + 그림 가방/가게, 공용 아이 도구 G.kidKit'),
      F('31-quest.js', 'progression', '퀘스트 상태 머신·퀘스트 패널·금빛 표식·목표 안내·current()/renderList(스티커 카드)'),
      F('32-progression.js', 'progression', '레벨·코인·통계·업적·도감·칭호·HUD 갱신 + 📖 스티커북(할 일·도감·업적·나)'),
      F('40-farming.js', 'farm', '밭 성장 시뮬레이션·물주기·심기·수확·작물 표현·한 번 누르기(쉬운 모드)'),
      F('41-fermentation.js', 'farm', '장독 발효 시뮬레이션·품질 공식·재료 만들기·장독 얼굴 카드(쉬운 모드)'),
      F('45-education-data.js', 'edu', '교육 콘텐츠 9종·퀴즈 25개 + 아이용 그림 이야기·그림 퀴즈 (순수 데이터)'),
      F('46-education.js', 'edu', '교육 뷰어·3D 모형·퀴즈·안내판·키오스크·전시'),
      F('47-journal.js', 'edu', '작업일지 작성·목록·사진 첨부(검증·축소) + 그림 일기(기분·스티커)'),
      F('50-minimap.js', 'map', '구역 감지·미니맵·월드맵(빠른 이동 통합)·그림 지도 "어디 갈까?"'),
      F('51-weather.js', 'map', '날씨·하루 시간·하늘·강수 파티클·기온/습도·아이 날씨 카드'),
      F('52-photo.js', 'map', '사진 모드·필터·프레임·포즈·갤러리·아이 사진(그림 틀·스티커)'),
      F('60-social.js', 'social', '채팅·필터·개인정보 가림(maskPII)·말풍선·아이 말하기(문장 고르기)·표현하기·체험객·서버 접속자'),
      F('61-audio.js', 'social', '절차적 효과음·환경음·국악풍 BGM·음성 합성'),
      F('62-engagement.js', 'engagement', '출석·오늘의 미션·알림함·수료증·랭킹·마당 꾸미기 (쉬운 모드: 🔔 오늘 스티커북)'),
      F('65-companion.js', 'companion', '마스코트 옹이(2D SVG·3D 동반자)·상황별 도움말·읽어주기·멈춰 있을 때 안내·쉬는 시간 연기'),
      F('66-fx.js', 'fx', '파티클·3D 이모지·레벨업·코인 비행·도장 연출·아이 축하(kidParty)·광과민 안전'),
      F('70-app.js', 'app', '부팅·인증(PBKDF2)·아이 타이틀(타자 없음)·그림 메뉴/설정/도움말·보호자 확인 연결·아바타 꾸미기·쉬운 튜토리얼'),
      F('80-devcenter.js', 'devcenter', '개발자 점검·인수인계 센터 (이 화면)'),
    ] },
    { dir: 'src/styles', emoji: '🎨', desc: '스타일 — 같은 번호의 JS 모듈 화면을 꾸밉니다', files: [
      F('00-base.css', 'core', '디자인 토큰(색·반경·그림자·z-index)과 공용 컴포넌트(.btn .card .chip .modal …)'),
      F('01-hud.css', 'core', 'HUD 배치(프로필·메뉴·미니맵·퀘스트·채팅·하단바)'),
      F('02-responsive.css', 'core', '화면 크기별 반응형 규칙(노트북·태블릿·모바일)'),
      F('08-easy.css', 'core', '쉬운 모드 화면 부품(큰 버튼·그림 고르기·보호자 확인·다음 할 일 카드)'),
      F('17-manjangdae.css', 'terrain', '만장대 인트로(레터박스·건너뛰기·2D 제목)·망원경 화면·전망 안내'),
      F('23-interaction.css', 'player', '상호작용 프롬프트·도착 표식'),
      F('25-npc.css', 'npc', '대화창·NPC 이름표'),
      F('30-inventory.css', 'progression', '가방·상점 화면'),
      F('31-quest.css', 'progression', '퀘스트 패널·퀘스트 일지'),
      F('32-progression.css', 'progression', '레벨업·도감·업적·프로필'),
      F('40-farming.css', 'farm', '밭 정보 창·밭 라벨'),
      F('41-fermentation.css', 'farm', '장독 창·작업대'),
      F('46-education.css', 'edu', '교육 뷰어·퀴즈·도서관'),
      F('47-journal.css', 'edu', '작업일지'),
      F('50-minimap.css', 'map', '미니맵·월드맵(이동 목록 포함)'),
      F('51-weather.css', 'map', '날씨 팝오버·아이 날씨 카드'),
      F('52-photo.css', 'map', '사진 모드 UI·갤러리'),
      F('60-social.css', 'social', '채팅·말풍선·이모지 선택·아이 말하기(skc-*)'),
      F('62-engagement.css', 'engagement', '참여 허브(출석·미션·알림·수료증·랭킹·꾸미기)'),
      F('65-companion.css', 'companion', '옹이 말풍선·놀이 메뉴'),
      F('66-fx.css', 'fx', '2D 연출(레벨업·도장·코인)'),
      F('70-app.css', 'app', '타이틀·로그인·메뉴·설정·도움말·아바타·튜토리얼'),
      F('80-devcenter.css', 'devcenter', '개발자 센터 화면'),
    ] },
    { dir: 'server', emoji: '🐘', desc: '선택형 PHP 서버 모드 (빌드 시 dist/metaverse 로 복사)', files: [
      F('admin.php', 'server', '관리자 센터: 대시보드·시스템 점검·사용자·신고·감사 로그·유지보수'),
      F('api/ping.php', 'server', '서버 모드 감지·CSRF 토큰·서버 시각'),
      F('api/time.php', 'server', '서버 시계 동기화'),
      F('api/auth/register.php', 'server', '회원가입 (검증·password_hash)'),
      F('api/auth/login.php', 'server', '로그인 (시도 제한·세션 재발급)'),
      F('api/auth/logout.php', 'server', '로그아웃'),
      F('api/auth/me.php', 'server', '현재 세션 사용자'),
      F('api/player/get.php', 'server', '내 저장 불러오기'),
      F('api/player/save.php', 'server', '저장 + 서버 검증(보상표·시간 검사, 위반 시 409)'),
      F('api/chat/list.php', 'server', '채팅 목록(after 커서)'),
      F('api/chat/send.php', 'server', '채팅 보내기(필터·빈도 제한)'),
      F('api/chat/report.php', 'server', '채팅 신고'),
      F('api/presence/update.php', 'server', '접속자 위치·상태 교환'),
      F('api/journal/upload.php', 'server', '작업일지 사진 업로드(MIME·크기 검사·재인코딩)'),
      F('api/ranking/top.php', 'server', '랭킹'),
      F('api/admin/stats.php', 'server', '관리자 통계'),
      F('api/admin/health.php', 'server', '환경·보안 자가 점검 (이 화면의 서버 점검 탭)'),
      F('lib/bootstrap.php', 'server', '오토로드·설정·오류 처리'),
      F('lib/Api.php', 'server', 'JSON 응답·메서드/CSRF/빈도 제한 공통 처리'),
      F('lib/Core.php', 'server', '설정·로그·시계·HTTP 도우미'),
      F('lib/Db.php', 'server', 'PDO(SQLite/MySQL)·마이그레이션'),
      F('lib/Session.php', 'server', '세션 쿠키(HttpOnly·SameSite·Secure)·CSRF'),
      F('lib/Security.php', 'server', '보안 헤더·빈도 제한·입력 정리'),
      F('lib/Users.php', 'server', '계정·권한·정지'),
      F('lib/SaveValidator.php', 'server', '저장 데이터 부정 진행 검증'),
      F('lib/GameData.php', 'server', 'data/game-data.json 보상표 읽기'),
      F('lib/ChatFilter.php', 'server', '채팅 욕설 필터 · 어린이 개인정보 가림(🔒)'),
      F('lib/pii-rules.json', 'server', '개인정보 가림 규칙 목록 — tests/pii-sync.mjs 가 게임(60-social)에서 만들어요 (손으로 고치지 않기)'),
      F('lib/Presence.php', 'server', '접속자 관리'),
      F('lib/Upload.php', 'server', '업로드 검사·재인코딩'),
      F('lib/Admin.php', 'server', '관리자 기능·통계·상태 점검'),
      F('cli/tfm.php', 'server', '서버 PC 전용 관리 명령 (관리자 지정·정리·백업)'),
      F('config/config.php', 'server', '기본 설정 (덮어쓰기는 config.local.php)'),
      F('database/schema.sql', 'server', 'MySQL/MariaDB 스키마'),
      F('database/schema.sqlite.sql', 'server', 'SQLite 스키마'),
      F('README-SERVER.md', 'server', '서버 설치·설정·보안·문제 해결 안내'),
    ] },
    { dir: 'tools · tests · vendor', emoji: '🧰', desc: '빌드·테스트·배포 도구', files: [
      F('tools/build.mjs', 'core', '단일 HTML 빌드: 조각 합치기·문법 검사·CSP 해시·매니페스트·문서 번들'),
      F('tools/smoke.mjs', 'core', '헤드리스 브라우저 스모크 테스트·스크린샷'),
      F('tools/package.mjs', 'core', '배포 zip 만들기 (엄격 빌드 + 소스)'),
      F('tools/kid-audit.mjs', 'devcenter', '쉬운 모드 화면 자동 점검 (QA용 · JSON + 표)'),
      F('tests/server-e2e.mjs', 'server', '서버 보안·기능 E2E 테스트 (개인정보 가림 벡터·DB 스팸 키 확인 포함)'),
      F('tests/pii-vectors.json', 'server', '개인정보 가림 공통 테스트 벡터 — 서버 ChatFilter 와 게임 maskPII 가 같이 통과해야 해요'),
      F('tests/pii-sync.mjs', 'server', '게임의 개인정보 가림 규칙 → server/lib/pii-rules.json 생성 (--check: 최신인지 확인)'),
      F('tests/pii-client.mjs', 'server', '빌드된 게임의 maskPII·닉네임 검사를 공통 벡터로 확인 (서버 필터와 비교)'),
      F('tests/pii-server.php', 'server', '테스트용 CLI: 진짜 서버 필터(ChatFilter·닉네임 검사)를 실행 (웹에 올리지 않음)'),
      F('vendor/three-entry.js', 'core', 'three.js r170 + 애드온 번들 진입점'),
      F('src/template.html', 'core', 'HUD 뼈대 (빌드가 CSS·JS·글꼴·CSP 를 주입)'),
      F('package.json', 'core', 'npm 스크립트·개발 의존성'),
    ] },
    { dir: 'docs', emoji: '📚', desc: '문서 — 빌드가 HTML 안에 묶어 넣어 문서 탭에서 읽을 수 있어요', files: [
      F('README.md', 'core', '사용자·개발자 첫 안내 (실행·조작·기능)'),
      F('ARCHITECTURE.md', 'core', '전체 구조·데이터 흐름·보안·성능'),
      F('CONTRACT.md', 'core', '모듈 간 약속: API·이벤트·저장 구조·보안 규칙'),
      F('HANDOVER.md', 'devcenter', '인수인계 문서 (실행·빌드·구조·콘텐츠 추가·문제 해결)'),
    ] },
  ];
  const SOURCE_BY_NAME = new Map();
  for (const g of SOURCE) for (const f of g.files) SOURCE_BY_NAME.set(f.name, f);

  /** CONTRACT §4 + phase-2 events: name -> [emitter, main listeners, description] */
  const EVENTS = {
    'game:ready': ['app · core', 'engagement · companion · devcenter', '로그인 후 게임 시작'],
    'game:login': ['app', 'engagement · progression', '로그인 {profile, isNew}'],
    'state:loaded': ['core', '여러 모듈', 'G.state 적용 완료'],
    'state:before-save': ['core', '플레이어·각 모듈', '저장 직전 동기화'],
    'state:saved': ['core', 'app', '저장 완료'],
    'settings:changed': ['core', 'engine · audio · fx · app', '설정 변경 {key, value}'],
    'zone:enter': ['minimap', 'quest · progression · audio · companion', '구역 진입'],
    'zone:exit': ['minimap', 'audio', '구역 이탈'],
    'poi:enter': ['minimap', 'quest · progression', '명소 진입'],
    'player:moved': ['player', 'minimap · social', '위치 변경 (초당 4회 이하)'],
    'player:distance': ['player', 'progression', '이동 거리 (5 m 단위)'],
    interact: ['interaction', 'quest · progression', '상호작용 {kind, id}'],
    'npc:talk': ['dialogue', 'quest · progression · app', '대화 시작'],
    'dialogue:end': ['dialogue', 'quest · app', '대화 종료'],
    'item:added': ['inventory', 'quest · progression · engagement', '아이템 획득'],
    'item:removed': ['inventory', 'engagement', '아이템 사용'],
    'farm:watered': ['farming', 'quest · progression · fx · engagement', '물 주기'],
    'farm:planted': ['farming', 'quest · progression · fx', '씨앗 심기'],
    'farm:harvested': ['farming', 'quest · progression · fx · engagement', '수확'],
    'ferment:checked': ['fermentation', 'quest · progression', '장독 확인'],
    'ferment:started': ['fermentation', 'quest · progression', '발효 시작'],
    'ferment:completed': ['fermentation', 'companion · engagement', '발효 완성'],
    'ferment:claimed': ['fermentation', 'quest · progression · fx', '발효 수령'],
    'craft:done': ['fermentation', 'quest · progression · fx', '재료 만들기'],
    'edu:viewed': ['education', 'quest · progression', '교육 페이지 열람'],
    'edu:completed': ['education', 'quest · progression', '교육 완료'],
    'quiz:answered': ['education', 'quest · progression · engagement', '퀴즈 응답'],
    'journal:created': ['journal', 'quest · progression · engagement', '작업일지 작성'],
    'photo:taken': ['photo', 'quest · progression · engagement', '사진 촬영'],
    'photo:mode': ['photo', 'app · companion', '사진 모드 전환'],
    'emote:played': ['social', 'quest · progression · fx', '이모지'],
    'gesture:played': ['social', 'quest · progression', '제스처'],
    'chat:sent': ['social', 'quest · progression · engagement', '채팅 보냄'],
    'chat:message': ['social', 'companion', '채팅 수신'],
    'quest:accepted': ['quest', 'engagement · companion', '퀘스트 수락'],
    'quest:progress': ['quest', 'engagement', '퀘스트 진행'],
    'quest:completed': ['quest', 'fx · engagement · companion', '퀘스트 완료'],
    'quest:claimed': ['quest', 'fx · engagement', '퀘스트 보상 수령'],
    'reward:granted': ['progression', 'fx · companion', '보상 지급'],
    'level:up': ['progression', 'fx · engagement · audio', '레벨 업'],
    'achievement:unlocked': ['progression', 'fx · engagement', '업적 달성'],
    'collection:unlocked': ['progression', 'fx · engagement', '도감 등록'],
    'weather:changed': ['weather', 'nature · audio · farming · companion', '날씨 변경'],
    'time:phase': ['weather', 'audio · companion · npc', '아침/낮/저녁/밤'],
    'ui:modal-open': ['ui(core)', 'audio', '모달 열림'],
    'ui:modal-close': ['ui(core)', 'audio', '모달 닫힘'],
    'ui:action': ['ui(core)', 'engagement', 'HUD 버튼 실행'],
    'input:interact': ['input(core)', 'interaction', 'E 키 / 상호작용 버튼'],
    'input:click': ['input(core)', 'interaction', '3D 화면 클릭'],
    'input:move-start': ['input(core)', 'player · interaction', '이동 시작'],
    'input:menu': ['input(core)', 'app', 'Esc 메뉴'],
    'world:object': ['world(core)', 'quest · interaction', '앵커 오브젝트 등록'],
    activity: ['core', 'journal · engagement', '최근 활동 기록'],
    'engine:quality': ['engine', 'app · nature', '그래픽 품질 변경'],
    'profile:changed': ['app', 'progression · social', '프로필 변경'],
    'player:appearance': ['player', 'app', '아바타 변경'],
    'easy:changed': ['easy(core)', '모든 화면', '쉬운 모드 켜짐/꺼짐 {on}'],
    'easy:say': ['easy(core)', 'devcenter · companion', '읽어주기 {text}'],
    'easy:gate': ['easy(core)', 'devcenter · app', '보호자 확인 결과 {reason, ok}'],
    'easy:point': ['easy(core)', '—', '손가락 안내 {label}'],
    'kid:phrase': ['social', 'quest · engagement', '어린이 문장 고르기 {phraseId}'],
    'dev:tests': ['devcenter', '—', '자가 테스트 완료 {passed, failed, total}'],
    'dev:open': ['누구나', 'devcenter', '개발자 센터 열기 요청 {tab}'],
  };

  const AVATAR_ANIMS = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'sit', 'wave', 'bow', 'clap', 'thumbsup', 'point', 'photo', 'celebrate', 'surprise', 'nod', 'heart', 'dance', 'think', 'water', 'harvest', 'interact', 'talk']);
  const ITEM_TYPES = new Set(['seed', 'crop', 'ingredient', 'fermented', 'quest', 'tool', 'decoration']);
  const OBJECTIVE_TYPES = new Set(['talk', 'visit', 'water', 'plant', 'harvest', 'ferment_check', 'ferment_start', 'ferment_claim', 'edu', 'quiz', 'journal', 'photo', 'emote', 'gesture', 'interact', 'collect', 'craft', 'chat', 'visit_all', 'level']);
  const INTERACT_KINDS = new Set(['npc', 'jar', 'plot', 'sign', 'kiosk', 'exhibit', 'tool', 'jardisp', 'craft', 'shop', 'door', 'board', 'photo', 'bench', 'companion']);
  const UNLOCK_ON = new Set(['harvest', 'item', 'talk', 'edu', 'interact', 'claim', 'visit', 'quiz', 'craft', 'ferment', 'photo']);
  const DIALOGUE_ACTIONS = new Set(['openEdu', 'openQuiz', 'openLibrary', 'openShop', 'openCraft', 'openJar', 'openMap', 'openFastTravel', 'openJournal', 'openQuestLog', 'openInventory', 'openCollection', 'teleport', 'acceptQuest', 'claimQuest', 'giveItem', 'takeItem', 'setFlag', 'clearFlag', 'emote', 'npcAnim', 'event', 'toast', 'sfx', 'activity']);
  const DIALOGUE_CONDS = new Set(['questStatus', 'questStep', 'hasItem', 'itemType', 'flag', 'notFlag', 'level', 'jarStatus', 'jarRecipe', 'plot', 'phase', 'weather', 'visited', 'any', 'all', 'not', 'chance', 'easy']);
  const BASE_STATS = ['level', 'exp', 'coin', 'edu', 'logins', 'playTime', 'distance', 'waters', 'plants', 'harvests', 'harvestedItems', 'fermentsStarted', 'fermentsClaimed', 'fermentChecks', 'quizCorrect', 'quizAnswered', 'eduCompleted', 'journals', 'photos', 'emotes', 'gestures', 'chats', 'talks', 'crafts', 'interacts'];
  const DERIVED_STATS = ['zonesVisited', 'npcsTalked', 'cropKinds', 'socials'];
  const EXPECTED_SYSTEMS = ['engine', 'terrain', 'nature', 'water', 'buildings', 'props', 'manjangdae', 'player', 'camera', 'interaction', 'npc', 'dialogue', 'inventory', 'quest', 'progression', 'farming', 'fermentation', 'education', 'journal', 'minimap', 'weather', 'photo', 'social', 'companion', 'fx', 'engagement', 'audio', 'easy', 'app', 'devcenter'];
  const HANGUL = /[가-힣]/;
  const CROP_MODELS = new Set(['bean', 'pepper', 'cabbage', 'perilla', 'corn', 'radish', 'mint', 'lavender', 'rosemary', 'lemonbalm']);

  // =========================================================================== data linter (G.data cross references)
  const LINT_CATS = {
    quests: { label: '퀘스트', emoji: '📜' },
    collection: { label: '도감', emoji: '📗' },
    shops: { label: '상점', emoji: '🛒' },
    items: { label: '아이템·작물', emoji: '🌾' },
    recipes: { label: '발효·재료 만들기', emoji: '🏺' },
    npcs: { label: 'NPC·대화', emoji: '💬' },
    layout: { label: '월드 배치', emoji: '🗺️' },
    education: { label: '교육·퀴즈', emoji: '📖' },
    achievements: { label: '업적·레벨', emoji: '🏆' },
    social: { label: '이모지·제스처·날씨', emoji: '😊' },
    ids: { label: '중복·ID 규칙', emoji: '🆔' },
    i18n: { label: '한국어 이름', emoji: '🇰🇷' },
  };
  const SEV = { error: { label: '오류', emoji: '⛔', rank: 0 }, warn: { label: '경고', emoji: '⚠️', rank: 1 }, info: { label: '참고', emoji: '💡', rank: 2 } };

  const Lint = {
    result: null,
    run() {
      const t0 = perf();
      const issues = [];
      const byCat = {};
      for (const c of Object.keys(LINT_CATS)) byCat[c] = { error: 0, warn: 0, info: 0, checked: 0 };
      const add = (sev, cat, msg, ref = '') => { issues.push({ sev, cat, msg, ref }); byCat[cat][sev]++; };
      const chk = (cat, n = 1) => { byCat[cat].checked += n; };
      const d = G.data || {};
      const obj = (v) => (isObj(v) ? v : {});
      const items = obj(d.items), crops = obj(d.crops), recipes = obj(d.recipes), crafts = obj(d.crafts), shops = obj(d.shops);
      const npcs = obj(d.npcs), quests = obj(d.quests), ach = obj(d.achievements), col = obj(d.collection);
      const edu = obj(d.education), quizzes = obj(d.quizzes), dialogues = obj(d.dialogues), L = obj(d.layout);
      const arr = (v) => (Array.isArray(v) ? v : []);
      const zoneIds = new Set(arr(d.zones).map((z) => z?.id));
      if (d.defaultZone?.id) zoneIds.add(d.defaultZone.id);
      const poiIds = new Set(arr(d.pois).map((p) => p?.id));
      const emoteIds = new Set(arr(d.emotes).map((e) => e?.id));
      const gestureIds = new Set(arr(d.gestures).map((e) => e?.id));
      const photoZoneIds = new Set(arr(L.photoZones).map((p) => p?.id));
      const jarIds = new Set(arr(L.jars).map((j) => j?.id));
      const anchorIds = new Set(Object.keys(obj(L.anchors)));
      const colCats = new Set(arr(d.collectionCategories).map((c) => c?.id));
      const itemOk = (id) => has(items, id);
      const name = (o) => (o && (o.name || o.title)) || '';
      const korean = (cat, o, ref, field = '이름') => { chk('i18n'); if (!HANGUL.test(String(name(o)))) add('warn', 'i18n', `${field}에 한국어가 없어요: "${String(name(o)).slice(0, 40)}"`, ref); };
      const koText = (text, ref, label) => { chk('i18n'); if (!HANGUL.test(String(text || ''))) add('warn', 'i18n', `${label}에 한국어가 없어요`, ref); };
      const keyId = (map, label) => { for (const [k, v] of Object.entries(map)) { if (isObj(v) && v.id != null && v.id !== k) add('warn', 'ids', `${label} 키와 id 가 달라요 (${k} ≠ ${v.id})`, k); } };
      const uniq = (list, label, cat = 'ids') => {
        const seen = new Map();
        for (const x of list) { if (x == null) continue; seen.set(x, (seen.get(x) || 0) + 1); }
        for (const [k, n] of seen) if (n > 1) add('error', cat, `${label} ID "${k}" 가 ${n}번 정의됐어요`, String(k));
      };
      const range = (v, a, b) => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[0] <= v[1] && v[0] >= a && v[1] <= b;

      try { // hostile/odd data must never break the screen: an exception becomes one finding
      // ---------------------------------------------------------------- items & crops
      keyId(items, '아이템'); keyId(crops, '작물'); keyId(recipes, '레시피'); keyId(quests, '퀘스트'); keyId(npcs, 'NPC'); keyId(col, '도감');
      for (const [id, it] of Object.entries(items)) {
        chk('items');
        if (!isObj(it)) { add('error', 'items', '아이템 정의가 객체가 아니에요', id); continue; }
        korean('items', it, id);
        if (!ITEM_TYPES.has(it.type)) add('error', 'items', `알 수 없는 아이템 종류 "${it.type}"`, id);
        if (!(num(it.price, -1) >= 0) || !(num(it.sell, -1) >= 0)) add('error', 'items', '가격(price/sell)이 0 이상의 숫자가 아니에요', id);
        if (!it.icon) add('info', 'items', '아이콘(이모지)이 없어요', id);
        if (it.type === 'seed') {
          if (!it.crop) add('error', 'items', '씨앗인데 crop 이 없어요', id);
          else if (!has(crops, it.crop)) add('error', 'items', `씨앗의 작물 ${it.crop} 이 crops 에 없어요`, id);
          else if (crops[it.crop].seedItem !== id) add('warn', 'items', `작물 ${it.crop} 의 seedItem 이 이 씨앗을 가리키지 않아요`, id);
        }
      }
      for (const [id, c] of Object.entries(crops)) {
        chk('items');
        if (!isObj(c)) continue;
        korean('items', c, id);
        if (!itemOk(c.seedItem)) add('error', 'items', `씨앗 아이템 ${c.seedItem} 이 없어요`, id);
        else if (items[c.seedItem].type !== 'seed') add('warn', 'items', `seedItem ${c.seedItem} 의 종류가 seed 가 아니에요`, id);
        if (!itemOk(c.harvestItem)) add('error', 'items', `수확 아이템 ${c.harvestItem} 이 없어요`, id);
        if (!(num(c.growthTime) > 0)) add('error', 'items', 'growthTime 이 0보다 커야 해요', id);
        if (!(num(c.waterUse) > 0)) add('error', 'items', 'waterUse 가 0보다 커야 해요', id);
        if (!range(c.harvestAmount, 1, 99)) add('warn', 'items', 'harvestAmount 는 [최소, 최대] 형식이어야 해요', id);
        if (!['crop', 'herb'].includes(c.category)) add('info', 'items', `분류(category) "${c.category}" — crop/herb 가 아니에요`, id);
        if (!CROP_MODELS.has(c.model)) add('info', 'items', `3D 모델 "${c.model}" 이 40-farming.js MODELS 에 없으면 밭에 보이지 않아요`, id);
        if (!Object.values(col).some((x) => arr(x?.unlock).some((u) => u?.crop === id))) add('info', 'collection', `작물 ${id} 를 등록하는 도감 항목이 없어요`, id);
      }
      for (const [id, q] of Object.entries(obj(d.startingInventory))) { chk('items'); if (!itemOk(id)) add('error', 'items', `시작 아이템 ${id} 이 items 에 없어요`, id); else if (!(num(q) > 0)) add('warn', 'items', '시작 수량이 0 이하예요', id); }
      const stages = arr(d.cropStages);
      if (stages.length) {
        chk('items');
        for (let i = 1; i < stages.length; i++) if (!(num(stages[i].min) > num(stages[i - 1].min))) add('error', 'items', '작물 단계 min 값이 오름차순이 아니에요', `cropStages[${i}]`);
      }

      // ---------------------------------------------------------------- recipes & crafts
      for (const [id, r] of Object.entries(recipes)) {
        chk('recipes');
        if (!isObj(r)) continue;
        korean('recipes', r, id);
        if (!itemOk(r.resultItem)) add('error', 'recipes', `결과 아이템 ${r.resultItem} 이 없어요`, id);
        else if (items[r.resultItem].type !== 'fermented') add('info', 'recipes', `결과 아이템 ${r.resultItem} 의 종류가 fermented 가 아니에요`, id);
        const ing = obj(r.ingredients);
        if (!Object.keys(ing).length) add('warn', 'recipes', '재료(ingredients)가 비어 있어요', id);
        for (const [iid, n] of Object.entries(ing)) { if (!itemOk(iid)) add('error', 'recipes', `재료 ${iid} 이 items 에 없어요`, id); if (!(num(n) > 0)) add('error', 'recipes', `재료 ${iid} 수량이 0 이하예요`, id); }
        if (!(num(r.baseDuration) > 0)) add('error', 'recipes', 'baseDuration 이 0보다 커야 해요', id);
        if (!range(r.idealTemp, -30, 60)) add('error', 'recipes', 'idealTemp 는 [최저, 최고] °C 여야 해요', id);
        if (!range(r.idealHumidity, 0, 100)) add('error', 'recipes', 'idealHumidity 는 [최저, 최고] % 여야 해요', id);
        if (r.edu && !has(edu, r.edu)) add('warn', 'recipes', `연결된 교육 ${r.edu} 이 없어요`, id);
        if (r.baseQuality != null && !(num(r.baseQuality, -1) >= 0 && num(r.baseQuality) <= 100)) add('warn', 'recipes', 'baseQuality 는 0~100 이어야 해요', id);
      }
      const FD = obj(d.fermentation);
      if (FD.starterRecipe && !has(recipes, FD.starterRecipe)) add('error', 'recipes', `시작 레시피 ${FD.starterRecipe} 이 없어요`, 'fermentation.starterRecipe');
      if (isObj(FD.stages)) {
        chk('recipes');
        const s = FD.stages;
        if (!(num(s.PREPARING) < num(s.FERMENTING) && num(s.FERMENTING) < num(s.AGING) && num(s.AGING) < 100)) add('error', 'recipes', '발효 단계 기준(PREPARING < FERMENTING < AGING < 100)이 맞지 않아요', 'fermentation.stages');
      }
      for (const [id, c] of Object.entries(crafts)) {
        chk('recipes');
        if (!isObj(c)) continue;
        korean('recipes', c, id);
        for (const side of ['in', 'out']) {
          const m = obj(c[side]);
          if (!Object.keys(m).length) add('error', 'recipes', `${side === 'in' ? '재료' : '결과'}가 비어 있어요`, id);
          for (const [iid, n] of Object.entries(m)) { if (!itemOk(iid)) add('error', 'recipes', `${side === 'in' ? '재료' : '결과'} ${iid} 이 items 에 없어요`, id); if (!(num(n) > 0)) add('error', 'recipes', `${iid} 수량이 0 이하예요`, id); }
        }
      }

      // ---------------------------------------------------------------- shops
      for (const [id, s] of Object.entries(shops)) {
        chk('shops');
        if (!isObj(s)) continue;
        korean('shops', s, id);
        if (s.npc && !has(npcs, s.npc)) add('error', 'shops', `상점 NPC ${s.npc} 가 없어요`, id);
        else if (s.npc && npcs[s.npc].shop !== id) add('warn', 'shops', `NPC ${s.npc} 의 shop 이 이 상점을 가리키지 않아요`, id);
        for (const iid of arr(s.sells)) {
          chk('shops');
          if (!itemOk(iid)) add('error', 'shops', `판매 아이템 ${iid} 이 없어요`, id);
          else if (!(num(items[iid].price) > 0)) add('warn', 'shops', `판매 아이템 ${iid} 의 가격(price)이 0이에요`, id);
        }
        for (const t of arr(s.buysTypes)) if (!ITEM_TYPES.has(t)) add('error', 'shops', `매입 종류 "${t}" 를 알 수 없어요`, id);
      }

      // ---------------------------------------------------------------- npcs & dialogues
      for (const [id, n] of Object.entries(npcs)) {
        chk('npcs');
        if (!isObj(n)) continue;
        korean('npcs', n, id);
        if (n.zone && !zoneIds.has(n.zone)) add('error', 'npcs', `NPC 구역 ${n.zone} 이 없어요`, id);
        if (!n.dialogue) add('warn', 'npcs', '대화(dialogue)가 지정되지 않았어요', id);
        else if (!has(dialogues, n.dialogue)) add('error', 'npcs', `대화 ${n.dialogue} 가 G.data.dialogues 에 없어요`, id);
        if (n.shop && !has(shops, n.shop)) add('error', 'npcs', `상점 ${n.shop} 이 없어요`, id);
        if (!Array.isArray(n.pos) || n.pos.length < 2 || !n.pos.every(Number.isFinite)) add('error', 'npcs', '위치(pos)가 [x, z] 숫자가 아니에요', id);
        else if (G.world?.isWater?.(n.pos[0], n.pos[1])) add('warn', 'layout', `NPC 위치가 물 위예요 (${n.pos.join(', ')})`, id);
        if (!Object.values(col).some((x) => arr(x?.unlock).some((u) => u?.npc === id))) add('info', 'collection', `NPC ${id} 를 등록하는 도감 항목이 없어요`, id);
      }
      const normAction = (a) => {
        if (!a) return null;
        if (typeof a === 'string') return { type: a };
        if (!isObj(a)) return null;
        if (a.type) return a;
        if (a.do) return { ...a, type: a.do };
        const ks = Object.keys(a);
        if (ks.length === 1) { const v = a[ks[0]]; return isObj(v) ? { type: ks[0], ...v } : { type: ks[0], value: v }; }
        return null;
      };
      const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      for (const [did, dlg] of Object.entries(dialogues)) {
        chk('npcs');
        if (!isObj(dlg)) { add('error', 'npcs', '대화 정의가 객체가 아니에요', did); continue; }
        const nodes = obj(dlg.nodes);
        if (dlg.npc && !has(npcs, dlg.npc)) add('error', 'npcs', `대화의 NPC ${dlg.npc} 가 없어요`, did);
        else if (dlg.npc && npcs[dlg.npc].dialogue !== did) add('warn', 'npcs', `NPC ${dlg.npc} 가 이 대화를 쓰지 않아요`, did);
        const reached = new Set();
        const ref = (next, where) => {
          for (const x of list(next)) {
            const t = typeof x === 'string' ? x : x && (x.node || x.next);
            if (!t || t === 'END') continue;
            reached.add(t);
            if (!has(nodes, t)) add('error', 'npcs', `없는 노드 "${t}" 로 연결돼요`, `${did}.${where}`);
            if (isObj(x)) cond(x.if, where);
          }
        };
        const cond = (c, where) => {
          if (!c || typeof c !== 'object') return;
          if (Array.isArray(c)) { c.forEach((x) => cond(x, where)); return; }
          for (const [k, v] of Object.entries(c)) {
            if (!DIALOGUE_CONDS.has(k)) { add('warn', 'npcs', `알 수 없는 조건 "${k}"`, `${did}.${where}`); continue; }
            if (k === 'any' || k === 'all' || k === 'not') cond(v, where);
            else if (k === 'questStatus' || k === 'questStep') { for (const q of Object.keys(obj(v))) if (!has(quests, q)) add('error', 'npcs', `조건의 퀘스트 ${q} 가 없어요`, `${did}.${where}`); }
            else if (k === 'hasItem') { for (const i of Object.keys(obj(v))) if (!itemOk(i)) add('error', 'npcs', `조건의 아이템 ${i} 이 없어요`, `${did}.${where}`); }
            else if (k === 'jarStatus' || k === 'jarRecipe') {
              for (const [j, val] of Object.entries(obj(v))) {
                if (!jarIds.has(j)) add('error', 'npcs', `조건의 장독 ${j} 가 없어요`, `${did}.${where}`);
                if (k === 'jarRecipe') for (const r of list(val)) if (!has(recipes, r)) add('error', 'npcs', `조건의 레시피 ${r} 가 없어요`, `${did}.${where}`);
              }
            } else if (k === 'visited') { for (const z of list(v)) if (typeof z === 'string' && !zoneIds.has(z) && !poiIds.has(z)) add('warn', 'npcs', `조건의 방문 장소 ${z} 가 없어요`, `${did}.${where}`); }
          }
        };
        const act = (lst, where) => {
          for (const raw of list(lst)) {
            const a = normAction(raw);
            if (!a || !DIALOGUE_ACTIONS.has(a.type)) { add('error', 'npcs', `알 수 없는 액션 ${String(JSON.stringify(raw)).slice(0, 60)}`, `${did}.${where}`); continue; }
            const v = (k) => a[k] ?? a.value;
            if ((a.type === 'acceptQuest' || a.type === 'claimQuest') && !has(quests, v('quest'))) add('error', 'npcs', `액션의 퀘스트 ${v('quest')} 가 없어요`, `${did}.${where}`);
            if ((a.type === 'giveItem' || a.type === 'takeItem') && !itemOk(v('item'))) add('error', 'npcs', `액션의 아이템 ${v('item')} 이 없어요`, `${did}.${where}`);
            if (a.type === 'openEdu' && !has(edu, v('edu'))) add('error', 'npcs', `액션의 교육 ${v('edu')} 이 없어요`, `${did}.${where}`);
            if (a.type === 'openQuiz' && a.quiz && !has(quizzes, a.quiz)) add('error', 'npcs', `액션의 퀴즈 ${a.quiz} 가 없어요`, `${did}.${where}`);
            if (a.type === 'openQuiz' && a.edu && !has(edu, a.edu)) add('error', 'npcs', `액션의 교육 ${a.edu} 이 없어요`, `${did}.${where}`);
            if (a.type === 'openShop' && a.shop && !has(shops, a.shop)) add('error', 'npcs', `액션의 상점 ${a.shop} 이 없어요`, `${did}.${where}`);
            if (a.type === 'openJar' && a.jar && !jarIds.has(a.jar)) add('error', 'npcs', `액션의 장독 ${a.jar} 가 없어요`, `${did}.${where}`);
            if (a.type === 'teleport' && a.zone && !zoneIds.has(a.zone) && !poiIds.has(a.zone)) add('error', 'npcs', `순간이동 구역 ${a.zone} 이 없어요`, `${did}.${where}`);
            if (a.type === 'emote' && a.emote && !emoteIds.has(a.emote) && !AVATAR_ANIMS.has(a.emote)) add('warn', 'npcs', `이모지/동작 ${a.emote} 을 알 수 없어요`, `${did}.${where}`);
            if (a.type === 'npcAnim' && (a.anim || a.value) && !AVATAR_ANIMS.has(a.anim || a.value)) add('warn', 'npcs', `NPC 동작 ${a.anim || a.value} 을 알 수 없어요`, `${did}.${where}`);
          }
        };
        const entries = arr(dlg.entries);
        if (!entries.length) add('error', 'npcs', '시작 항목(entries)이 없어요', did);
        entries.forEach((e, i) => { ref(e?.node, `entries[${i}]`); cond(e?.if, `entries[${i}]`); });
        arr(dlg.barks).forEach((b, i) => { if (isObj(b)) cond(b.if, `barks[${i}]`); });
        for (const [nid, n] of Object.entries(nodes)) {
          chk('npcs');
          if (!isObj(n)) { add('error', 'npcs', '빈 노드예요', `${did}.${nid}`); continue; }
          if (n.text == null && !n.variants) add('error', 'npcs', '대사(text)가 없어요', `${did}.${nid}`);
          ref(n.next, nid);
          arr(n.variants).forEach((v) => cond(v?.if, `${nid}.variants`));
          act(n.actions, nid);
          arr(n.choices).forEach((c, i) => { if (!c?.text) add('warn', 'npcs', '선택지 문구가 비어 있어요', `${did}.${nid}.choices[${i}]`); ref(c?.next, `${nid}.choices[${i}]`); act(c?.actions, `${nid}.choices[${i}]`); cond(c?.if, `${nid}.choices[${i}]`); });
          if (arr(n.choices).length > 8) add('warn', 'npcs', '선택지가 8개를 넘어요 (한 번에 4개까지 보여요)', `${did}.${nid}`);
        }
        for (const nid of Object.keys(nodes)) if (!reached.has(nid)) add('info', 'npcs', '어디에서도 연결되지 않는 노드예요', `${did}.${nid}`);
      }

      // ---------------------------------------------------------------- quests
      // registered interactables (23-interaction) once systems are up: what a player can really use
      const IX = G.interact && typeof G.interact.list === 'function' && typeof G.interact.get === 'function' && G.interact.list().length ? G.interact : null;
      const visitTargets = (o) => (o.zone ? zoneIds.has(o.zone) : true) && (o.poi ? poiIds.has(o.poi) : true);
      for (const [id, q] of Object.entries(quests)) {
        chk('quests');
        if (!isObj(q)) continue;
        koText(q.title, id, '퀘스트 제목');
        if (q.giver && !has(npcs, q.giver)) add('error', 'quests', `퀘스트를 주는 NPC ${q.giver} 가 없어요`, id);
        for (const r of arr(q.requires)) if (!has(quests, r)) add('error', 'quests', `선행 퀘스트 ${r} 가 없어요`, id);
        const objs = arr(q.objectives);
        if (!objs.length) add('error', 'quests', '목표(objectives)가 없어요', id);
        objs.forEach((o, i) => {
          const at = `${id}.objectives[${i}]`;
          chk('quests');
          if (!isObj(o)) { add('error', 'quests', '목표가 객체가 아니에요', at); return; }
          if (!OBJECTIVE_TYPES.has(o.type)) add('error', 'quests', `알 수 없는 목표 종류 "${o.type}"`, at);
          if (!(Number.isInteger(o.count) && o.count > 0)) add('warn', 'quests', 'count 는 1 이상의 정수여야 해요', at);
          if (!o.text) add('warn', 'quests', '목표 설명(text)이 없어요', at);
          if (o.npc && !has(npcs, o.npc)) add('error', 'quests', `NPC ${o.npc} 가 없어요`, at);
          if (o.type === 'visit' && !o.zone && !o.poi) add('error', 'quests', 'visit 목표에 zone/poi 가 없어요', at);
          if (!visitTargets(o)) add('error', 'quests', `장소 ${o.zone || o.poi} 가 없어요`, at);
          if (o.crop && !has(crops, o.crop)) add('error', 'quests', `작물 ${o.crop} 이 없어요`, at);
          if (o.category && !['crop', 'herb'].includes(o.category)) add('warn', 'quests', `작물 분류 ${o.category} 를 알 수 없어요`, at);
          if (o.recipe && !has(recipes, o.recipe)) add('error', 'quests', `레시피 ${o.recipe} 가 없어요`, at);
          if (o.edu && !has(edu, o.edu)) add('error', 'quests', `교육 ${o.edu} 이 없어요`, at);
          if (o.quiz && !has(quizzes, o.quiz)) add('error', 'quests', `퀴즈 ${o.quiz} 가 없어요`, at);
          if (o.emote && !emoteIds.has(o.emote)) add('error', 'quests', `이모지 ${o.emote} 가 없어요`, at);
          if (o.gesture && !gestureIds.has(o.gesture)) add('error', 'quests', `제스처 ${o.gesture} 가 없어요`, at);
          if (o.craft && !has(crafts, o.craft)) add('error', 'quests', `재료 만들기 ${o.craft} 가 없어요`, at);
          if (o.item && !itemOk(o.item)) add('error', 'quests', `아이템 ${o.item} 이 없어요`, at);
          if (o.photoZone && o.photoZone !== '*' && !photoZoneIds.has(o.photoZone)) add('error', 'quests', `포토존 ${o.photoZone} 이 없어요`, at);
          if (o.kind && !INTERACT_KINDS.has(o.kind)) add('warn', 'quests', `상호작용 종류 ${o.kind} 를 알 수 없어요`, at);
          // interact targets: the registered interactables are the truth once the world is up (quests count distinct
          // ids, so a kind needs at least `count` of them); before that, the layout anchors
          if (o.type === 'interact' && IX) {
            if (o.id && !IX.get(o.id)) add('error', 'quests', `상호작용 대상 ${o.id} 가 등록되지 않았어요 — 이 목표는 끝낼 수 없어요`, at);
            else if (!o.id && o.kind) { const n = IX.list(o.kind).length, need = Math.max(1, num(o.count, 1)); if (n < need) add('error', 'quests', `상호작용 종류 ${o.kind} 가 ${n}개만 등록돼 있어요 (목표 ${need}개) — 이 목표는 끝낼 수 없어요`, at); }
          } else if (o.type === 'interact' && o.id && !anchorIds.has(o.id)) add('warn', 'quests', `상호작용 대상 ${o.id} 가 배치(layout)에 없어요`, at);
          if (o.type === 'visit_all' && o.count > arr(d.visitZones).length) add('error', 'quests', `visit_all 목표 수(${o.count})가 방문 구역 수(${arr(d.visitZones).length})보다 커요`, at);
        });
        const rw = obj(q.reward);
        for (const k of ['coin', 'exp', 'edu']) if (rw[k] != null && !(num(rw[k], -1) >= 0)) add('error', 'quests', `보상 ${k} 가 0 이상의 숫자가 아니에요`, id);
        for (const [iid, n] of Object.entries(obj(rw.items))) { if (!itemOk(iid)) add('error', 'quests', `보상 아이템 ${iid} 이 없어요`, id); if (!(num(n) > 0)) add('error', 'quests', `보상 아이템 ${iid} 수량이 0 이하예요`, id); }
        if (q.autoAccept && q.giver) add('info', 'quests', '자동 수락 퀘스트인데 giver 도 지정돼 있어요', id);
      }
      // requires cycles
      const state = {};
      const visit = (id, path) => {
        if (state[id] === 2) return;
        if (state[id] === 1) { add('error', 'quests', `선행 퀘스트가 순환해요: ${[...path, id].join(' → ')}`, id); return; }
        state[id] = 1;
        for (const r of arr(quests[id]?.requires)) if (has(quests, r)) visit(r, [...path, id]);
        state[id] = 2;
      };
      for (const id of Object.keys(quests)) visit(id, []);

      // ---------------------------------------------------------------- achievements & levels
      const statOk = new Set([...BASE_STATS, ...DERIVED_STATS]);
      for (const [id, a] of Object.entries(ach)) {
        chk('achievements');
        if (!isObj(a)) continue;
        korean('achievements', a, id);
        const c = obj(a.condition);
        if (!statOk.has(c.stat)) add('error', 'achievements', `조건 통계 "${c.stat}" 를 알 수 없어요`, id);
        if (!(num(c.gte) > 0)) add('warn', 'achievements', '조건 gte 가 0보다 커야 해요', id);
        for (const iid of Object.keys(obj(a.reward?.items))) if (!itemOk(iid)) add('error', 'achievements', `보상 아이템 ${iid} 이 없어요`, id);
        if (c.stat === 'zonesVisited' && num(c.gte) > arr(d.visitZones).length) add('error', 'achievements', '방문 구역 수보다 큰 목표예요', id);
        if (c.stat === 'npcsTalked' && num(c.gte) > Object.keys(npcs).length) add('error', 'achievements', 'NPC 수보다 큰 목표예요', id);
      }
      const lv = d.levels;
      if (lv && typeof lv.expFor === 'function') {
        chk('achievements');
        let prev = 0, bad = 0;
        for (let i = 1; i < num(lv.max, 50); i++) { const e = num(lv.expFor(i)); if (!(e > prev)) bad++; prev = e; }
        if (bad) add('error', 'achievements', `레벨 경험치 표가 ${bad}곳에서 증가하지 않아요`, 'levels.expFor');
        for (const k of Object.keys(obj(lv.titles))) if (!Number.isInteger(Number(k))) add('warn', 'achievements', `칭호 레벨 키 "${k}" 가 정수가 아니에요`, 'levels.titles');
      } else add('error', 'achievements', 'levels.expFor 함수가 없어요', 'levels');
      for (const z of arr(d.visitZones)) if (!zoneIds.has(z)) add('error', 'layout', `visitZones 의 구역 ${z} 가 없어요`, 'visitZones');

      // ---------------------------------------------------------------- collection
      for (const [id, c] of Object.entries(col)) {
        chk('collection');
        if (!isObj(c)) continue;
        korean('collection', c, id);
        if (!colCats.has(c.category)) add('error', 'collection', `도감 분류 ${c.category} 가 collectionCategories 에 없어요`, id);
        const un = arr(c.unlock);
        if (!un.length) add('error', 'collection', '등록 조건(unlock)이 없어요', id);
        un.forEach((u, i) => {
          const at = `${id}.unlock[${i}]`;
          if (!isObj(u)) { add('error', 'collection', '등록 조건이 객체가 아니에요', at); return; }
          if (!UNLOCK_ON.has(u.on)) add('error', 'collection', `알 수 없는 등록 조건 on="${u.on}"`, at);
          if (u.crop && !has(crops, u.crop)) add('error', 'collection', `작물 ${u.crop} 이 없어요`, at);
          if (u.item && !itemOk(u.item)) add('error', 'collection', `아이템 ${u.item} 이 없어요`, at);
          if (u.npc && !has(npcs, u.npc)) add('error', 'collection', `NPC ${u.npc} 가 없어요`, at);
          if (u.edu && !has(edu, u.edu)) add('error', 'collection', `교육 ${u.edu} 이 없어요`, at);
          if (u.zone && !zoneIds.has(u.zone)) add('error', 'collection', `구역 ${u.zone} 이 없어요`, at);
          if (u.poi && !poiIds.has(u.poi)) add('error', 'collection', `명소 ${u.poi} 가 없어요`, at);
          if (u.quest && !has(quests, u.quest)) add('error', 'collection', `퀘스트 ${u.quest} 가 없어요`, at);
          if (u.recipe && !has(recipes, u.recipe)) add('error', 'collection', `레시피 ${u.recipe} 가 없어요`, at);
          if (u.on === 'interact' && u.id && IX) {
            if (!IX.get(u.id)) add(un.length > 1 ? 'info' : 'error', 'collection', `상호작용 ID ${u.id} 가 등록되지 않았어요${un.length > 1 ? ' (다른 조건으로 등록 가능)' : ' — 이 도감 칸은 채울 수 없어요'}`, at);
          } else if (u.on === 'interact' && u.id && !anchorIds.has(u.id)) add(un.length > 1 ? 'info' : 'warn', 'collection', `상호작용 ID ${u.id} 가 배치(layout)에 없어요${un.length > 1 ? ' (다른 조건으로 등록 가능)' : ''}`, at);
        });
      }
      for (const eid of Object.keys(edu)) if (!Object.values(col).some((x) => arr(x?.unlock).some((u) => u?.edu === eid))) add('info', 'collection', `교육 ${eid} 를 등록하는 도감 항목이 없어요`, eid);

      // ---------------------------------------------------------------- education & quizzes
      const eduIds = arr(d.educationIds);
      for (const id of eduIds) if (!has(edu, id)) add('error', 'education', `educationIds 의 ${id} 가 education 에 없어요`, id);
      for (const [id, e] of Object.entries(edu)) {
        chk('education');
        if (!isObj(e)) continue;
        koText(e.title, id, '교육 제목');
        if (eduIds.length && !eduIds.includes(id)) add('warn', 'education', 'educationIds 목록에 빠져 있어요', id);
        const pages = arr(e.pages);
        if (!pages.length) add('error', 'education', '페이지가 없어요', id);
        pages.forEach((p, i) => { if (!p?.text && !p?.title) add('error', 'education', '페이지 내용이 비어 있어요', `${id}.pages[${i}]`); });
        if (!e.quiz) add('warn', 'education', '대표 퀴즈(quiz)가 없어요', id);
        else if (!has(quizzes, e.quiz)) add('error', 'education', `대표 퀴즈 ${e.quiz} 가 없어요`, id);
        for (const qz of arr(e.quizzes)) { if (!has(quizzes, qz)) add('error', 'education', `퀴즈 ${qz} 가 없어요`, id); else if (quizzes[qz].edu !== id) add('warn', 'education', `퀴즈 ${qz} 의 edu 가 ${quizzes[qz].edu} 예요`, id); }
        if (!e.source) add('info', 'education', '출처(source)가 적혀 있지 않아요', id);
      }
      for (const [id, q] of Object.entries(quizzes)) {
        chk('education');
        if (!isObj(q)) continue;
        if (!has(edu, q.edu)) add('error', 'education', `퀴즈의 교육 ${q.edu} 이 없어요`, id);
        const ch = arr(q.choices);
        if (ch.length < 2) add('error', 'education', '보기가 2개 미만이에요', id);
        else if (ch.length !== 4) add('warn', 'education', `보기가 ${ch.length}개예요 (권장 4개)`, id);
        if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < ch.length)) add('error', 'education', `정답 번호 ${q.answer} 가 보기 범위를 벗어나요`, id);
        if (new Set(ch).size !== ch.length) add('warn', 'education', '같은 보기가 중복돼요', id);
        if (!q.question) add('error', 'education', '문제(question)가 비어 있어요', id);
        if (!q.explain) add('info', 'education', '해설(explain)이 없어요', id);
      }

      // ---------------------------------------------------------------- layout (anchors referenced by systems)
      const B = L.bounds || { minX: -135, maxX: 135, minZ: -135, maxZ: 135 };
      const inBounds = (x, z) => x >= B.minX - 1 && x <= B.maxX + 1 && z >= B.minZ - 1 && z <= B.maxZ + 1;
      const anchorLists = ['buildings', 'jars', 'jarDisplays', 'farmPlots', 'signs', 'kiosks', 'exhibits', 'tools', 'photoZones', 'ponds'];
      const allAnchors = [];
      for (const k of anchorLists) for (const a of arr(L[k])) { allAnchors.push(a?.id); chk('layout'); if (a && Number.isFinite(a.x) && Number.isFinite(a.z) && !inBounds(a.x, a.z)) add('warn', 'layout', `플레이 영역 밖에 있어요 (${a.x}, ${a.z})`, `${k}:${a.id}`); }
      for (const k of ['craftTable', 'shopStall', 'hallDoor', 'eduBoard', 'riverDeck']) if (L[k]?.id) allAnchors.push(L[k].id);
      uniq(allAnchors, '배치 앵커');
      for (const p of arr(L.farmPlots)) {
        if (p.crop && !has(crops, p.crop)) add('error', 'layout', `밭의 작물 ${p.crop} 이 없어요`, p.id);
        if (p.zone && !zoneIds.has(p.zone)) add('error', 'layout', `밭의 구역 ${p.zone} 이 없어요`, p.id);
        if (p.prefill) for (const k of ['growth', 'water', 'health']) if (!(num(p.prefill[k], -1) >= 0 && num(p.prefill[k]) <= 100)) add('warn', 'layout', `prefill.${k} 는 0~100 이어야 해요`, p.id);
      }
      for (const s of arr(L.signs)) { if (s.action === 'edu' && !has(edu, s.edu)) add('error', 'layout', `안내판의 교육 ${s.edu} 이 없어요`, s.id); if (!s.title) add('warn', 'layout', '안내판 제목이 없어요', s.id); }
      for (const k of arr(L.kiosks)) if (k.edu && !has(edu, k.edu)) add('error', 'layout', `키오스크의 교육 ${k.edu} 이 없어요`, k.id);
      for (const x of arr(L.exhibits)) { if (x.food && !itemOk(x.food)) add('error', 'layout', `전시 음식 ${x.food} 이 없어요`, x.id); if (x.edu && !has(edu, x.edu)) add('error', 'layout', `전시의 교육 ${x.edu} 이 없어요`, x.id); }
      for (const t of [...arr(L.tools), ...arr(L.jarDisplays)]) if (!Object.values(col).some((c) => arr(c?.unlock).some((u) => u?.id === t.id))) add('info', 'collection', `${t.id} 를 등록하는 도감 항목이 없어요`, t.id);
      if (L.shopStall?.shop && !has(shops, L.shopStall.shop)) add('error', 'layout', `매점의 상점 ${L.shopStall.shop} 이 없어요`, L.shopStall.id);
      for (const j of arr(L.jars)) if (G.world?.isWater?.(j.x, j.z)) add('error', 'layout', '장독이 물 위에 있어요', j.id);
      if (L.spawn && G.world?.isWater?.(L.spawn.x, L.spawn.z)) add('error', 'layout', '시작 위치가 물 위예요', 'spawn');
      // interactive anchors should have a 3D object registered after init
      if (G.world?.getObject && G.systems?.().some((s) => s.name === 'props' && s._initialized)) {
        for (const k of ['jars', 'farmPlots', 'signs', 'kiosks', 'exhibits', 'tools', 'jarDisplays']) {
          for (const a of arr(L[k])) if (a?.id && !G.world.getObject(a.id)) add('info', 'layout', `3D 오브젝트가 등록되지 않았어요 (registerObject)`, `${k}:${a.id}`);
        }
      }
      for (const z of arr(d.zones)) { chk('layout'); if (!(Array.isArray(z?.center) && z.center.length === 2 && num(z.r) > 0)) add('error', 'layout', '구역 center/r 가 올바르지 않아요', z?.id); if (z) koText(z.name, z.id, '구역 이름'); }
      for (const p of arr(d.pois)) if (p) koText(p.name, p.id, '명소 이름');

      // ---------------------------------------------------------------- emotes / gestures / weather / engagement
      for (const e of arr(d.emotes)) { chk('social'); if (!AVATAR_ANIMS.has(e?.anim)) add('warn', 'social', `이모지 동작 ${e?.anim} 를 아바타가 몰라요`, e?.id); korean('social', e, e?.id); }
      for (const e of arr(d.gestures)) { chk('social'); if (!AVATAR_ANIMS.has(e?.anim)) add('warn', 'social', `제스처 동작 ${e?.anim} 를 아바타가 몰라요`, e?.id); korean('social', e, e?.id); }
      for (const [id, w] of Object.entries(obj(d.weather))) { chk('social'); korean('social', w, id); if (!(num(w?.humidity, -1) >= 0 && num(w?.humidity) <= 100)) add('warn', 'social', '습도는 0~100 이어야 해요', id); }
      const phases = arr(d.dayPhases);
      if (phases.length) {
        chk('social');
        let cover = 0;
        for (const p of phases) cover += num(p.to) - num(p.from);
        if (Math.abs(cover - 24) > 0.01) add('warn', 'social', `하루 시간대 합계가 ${cover}시간이에요 (24시간이어야 해요)`, 'dayPhases');
      }
      for (const id of ['ITEM_SMALL_JAR', 'ITEM_FLOWERPOT', 'ITEM_LANTERN']) { chk('items'); if (!itemOk(id)) add('error', 'items', `꾸미기 아이템 ${id} 이 없어요 (참여 허브 마당 꾸미기)`, id); else if (items[id].type !== 'decoration') add('warn', 'items', '꾸미기 아이템의 종류가 decoration 이 아니에요', id); }
      if (!arr(d.tips).length) add('info', 'social', '로딩 팁이 없어요', 'tips');
      if (!arr(d.badWords).length) add('warn', 'social', '금칙어 목록(badWords)이 비어 있어요', 'badWords');

      // ---------------------------------------------------------------- duplicated ids in arrays
      uniq(arr(d.zones).map((z) => z?.id), '구역');
      uniq(arr(d.pois).map((p) => p?.id), '명소');
      uniq(arr(d.emotes).map((e) => e?.id), '이모지');
      uniq(arr(d.gestures).map((e) => e?.id), '제스처');
      for (const k of ['zones', 'pois', 'emotes', 'gestures']) chk('ids', arr(d[k]).length);
      const clash = Object.keys(items).filter((k) => has(crops, k) || has(quests, k));
      for (const k of clash) add('warn', 'ids', `아이템 ID ${k} 가 다른 종류와 겹쳐요`, k);

      } catch (e) { add('error', 'ids', `검사 도중 예외가 났어요 (데이터 형식 확인): ${String(e?.message || e).slice(0, 160)}`, 'lint'); G.log.warn('DEV', 'lint exception', e); }
      issues.sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank || a.cat.localeCompare(b.cat));
      const counts = { error: 0, warn: 0, info: 0 };
      for (const i of issues) counts[i.sev]++;
      const entities = {
        items: Object.keys(items).length, crops: Object.keys(crops).length, recipes: Object.keys(recipes).length, crafts: Object.keys(crafts).length,
        shops: Object.keys(shops).length, npcs: Object.keys(npcs).length, dialogues: Object.keys(dialogues).length,
        dialogueNodes: Object.values(dialogues).reduce((n, x) => n + Object.keys(obj(x?.nodes)).length, 0),
        quests: Object.keys(quests).length, achievements: Object.keys(ach).length, collection: Object.keys(col).length,
        education: Object.keys(edu).length, quizzes: Object.keys(quizzes).length, zones: arr(d.zones).length, pois: arr(d.pois).length,
        anchors: anchorIds.size, emotes: arr(d.emotes).length, gestures: arr(d.gestures).length,
      };
      this.result = { issues, counts, byCat, entities, ms: perf() - t0, at: now() };
      return this.result;
    },
    get() { return this.result || this.run(); },
  };

  // =========================================================================== safe markdown renderer (escape first)
  const Md = {
    slug(text, used) {
      let s = String(text).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'section';
      let out = s, i = 2;
      while (used.has(out)) out = `${s}-${i++}`;
      used.add(out);
      return 'dcdoc-' + out;
    },
    /** inline markdown on ALREADY-ESCAPED text */
    inline(t) {
      const codes = [];
      t = t.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => Md.link(label, url));
      t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}${Md.link(url, url)}`);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
      t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      t = t.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
      return t;
    },
    link(label, url) {
      // `url` is escaped text: &amp; is fine inside an attribute, quotes are &quot; so attributes cannot break out
      if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      if (/^#[\w가-힣-]+$/.test(url)) return `<a href="#" data-dc-anchor="${url.slice(1)}">${label}</a>`;
      return `<span class="dc-md-badlink" title="허용되지 않는 링크">${label}</span>`;
    },
    render(src, opts = {}) {
      const used = new Set();
      const toc = [];
      const lines = String(src || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0002]/g, '').split('\n');
      const out = [];
      let i = 0;
      const para = [];
      const flush = () => { if (para.length) { out.push(`<p>${Md.inline(esc(para.join(' ')))}</p>`); para.length = 0; } };
      const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
      // split on unescaped pipes (no regex lookbehind: older Safari would reject the whole script)
      const cells = (l) => {
        let s = l.trim().replace(/\\\|/g, '\u0002');
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);
        return s.split('|').map((c) => c.trim().replace(/\u0002/g, '|'));
      };
      while (i < lines.length) {
        const line = lines[i];
        const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)\s*$/);
        if (fence) {
          flush();
          const buf = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
          i++;
          out.push(`<pre class="dc-code"${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
          continue;
        }
        const hm = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (hm) {
          flush();
          const lvl = hm[1].length;
          const html = Md.inline(esc(hm[2]));
          const id = Md.slug(hm[2], used);
          if (lvl <= 3) toc.push({ lvl, id, text: hm[2].replace(/[`*]/g, '') });
          out.push(`<h${lvl} id="${id}">${html}</h${lvl}>`);
          i++; continue;
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
        if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          flush();
          const head = cells(line);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
          out.push(`<div class="dc-md-table"><table><thead><tr>${head.map((c) => `<th>${Md.inline(esc(c))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${Md.inline(esc(r[k] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
          continue;
        }
        if (/^\s*>/.test(line)) {
          flush();
          const buf = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
          out.push(`<blockquote>${Md.render(buf.join('\n'), { nested: true }).html}</blockquote>`);
          continue;
        }
        const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (lm) {
          flush();
          // nested lists by indentation (2+ spaces per level)
          const stack = [];
          while (i < lines.length) {
            const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
            if (!m) {
              if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && stack.length) { out.push(` ${Md.inline(esc(lines[i].trim()))}`); i++; continue; }
              break;
            }
            const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
            const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
            while (stack.length > depth + 1) out.push(`</li></${stack.pop()}>`);
            if (stack.length < depth + 1) { out.push(`<${tag}>`); stack.push(tag); }
            else out.push('</li>');
            let text = m[3];
            const task = text.match(/^\[([ xX])\]\s+(.*)$/);
            if (task) text = `${task[1].trim() ? '✅' : '⬜'} ${task[2]}`;
            out.push(`<li>${Md.inline(esc(text))}`);
            i++;
          }
          while (stack.length) out.push(`</li></${stack.pop()}>`);
          continue;
        }
        if (!line.trim()) { flush(); i++; continue; }
        para.push(line.trim());
        i++;
      }
      flush();
      return { html: out.join('\n'), toc };
    },
  };

  // =========================================================================== kid safety helpers (CONTRACT §12)
  /** shared PII vectors — the same cases as server/lib/ChatFilter.php and tests/server-e2e.mjs */
  const PII_VECTORS = {
    phone: ['010-1234-5678', '01012345678', '+82 10 1234 5678', '내 번호는 010 1234 5678 이야', '02-123-4567'],
    email: ['kid@example.com', '메일 kid.dino@gmail.com 로 줘'],
    url: ['https://evil.example.com/x', 'www.abc.kr 와봐'],
    address: ['서울시 강남구 테헤란로 123', '세종대로 110', '101동 1203호'],
    keep: ['오늘 콩 3개 심었어요!', '레벨 12 됐어요', '2024년 가을', '새로 30개 심었어', '서울 친구 만났어', '유치원 가기 싫어', '@발효1234 안녕', '안녕하세요 반가워요 😊', '물 주기 5번 했어'],
  };
  const maskOut = (r) => (typeof r === 'string' ? r : r && typeof r.text === 'string' ? r.text : String(r ?? ''));
  /** tests/pii-vectors.json, embedded by tools/build.mjs (the same file the server e2e runs through ChatFilter.php) */
  const sharedPII = () => {
    const v = window.__BUILD__?.piiVectors;
    return v && Array.isArray(v.whole) && Array.isArray(v.partial) && Array.isArray(v.keep) ? v : null;
  };
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const RX_EMOJI = /\p{Extended_Pictographic}/u;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 220); });

  /** ring logs of kid-mode events (read by the 👶 tab and the report) */
  const KidLog = { say: [], gate: [], changed: 0 };
  const pushRing = (arr, v, n = 20) => { arr.push(v); if (arr.length > n) arr.shift(); };

  /** short, stable CSS path for an element (ids win; class names are kept short) */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 6; e = e.parentElement, i++) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift(`#${e.id}`); break; }
      let p = e.tagName.toLowerCase();
      const cls = Array.from(e.classList).filter((c) => /^[A-Za-z][\w-]*$/.test(c) && !/^(active|open|on|show|is-|dc-in)/.test(c)).slice(0, 2);
      if (cls.length) p += `.${cls.join('.')}`;
      const da = e.getAttribute('data-action');
      if (da && /^[\w:-]{1,30}$/.test(da)) p += `[data-action="${da}"]`;
      else if (e.parentElement) {
        const same = Array.from(e.parentElement.children).filter((c) => c.tagName === e.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(p);
    }
    return parts.join(' > ').slice(0, 160);
  }
  /** colour helpers for the WCAG quick check */
  function parseColor(s) {
    const m = String(s || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!Number.isFinite(a)) a = 1;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  const over = (top, under) => {
    const a = top.a + under.a * (1 - top.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (k) => (top[k] * top.a + under[k] * under.a * (1 - top.a)) / a;
    return { r: mix('r'), g: mix('g'), b: mix('b'), a };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const contrastRatio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** the 3D world behind glass panels: a mid-dark summer valley (estimate used when no opaque layer is found) */
  const BACKDROP = { r: 58, g: 80, b: 62, a: 1 };

  // =========================================================================== 👶 kid usability audit (what is on screen)
  const KID_KINDS = {
    freetext: { emoji: '⌨️', label: '글자 입력칸', desc: '쉬운 모드에서는 타자 없이 그림으로 골라요 (0개여야 해요)' },
    tap: { emoji: '👆', label: '누르기 크기', desc: '손가락 크기 이상: 쉬운 모드 56 px · 보통 40 px (44 px 미만은 치명)' },
    errtext: { emoji: '🐞', label: '오류 글자', desc: '화면에 NaN · undefined · [object …] 같은 글자가 보여요' },
    exit: { emoji: '🚪', label: '나가기 버튼', desc: '모든 창에는 크게 ✖ / ⬅️ 가 있어야 해요 (막다른 길 금지)' },
    name: { emoji: '🏷️', label: '이름·그림', desc: '버튼에 읽을 이름(aria-label)과 그림(이모지)이 있어야 해요' },
    label: { emoji: '🔤', label: '긴 버튼 글자', desc: '버튼 글자는 6글자 이하 + 큰 그림' },
    overlap: { emoji: '🧱', label: 'HUD 겹침', desc: '화면 고정 요소끼리 겹치면 누르기 어려워요' },
    contrast: { emoji: '🌗', label: '글자 대비', desc: 'WCAG AA: 보통 글자 4.5 : 1 · 큰 글자 3 : 1 (배경 추정 포함)' },
    fontsize: { emoji: '🔠', label: '작은 글자', desc: '쉬운 모드 글자는 16 px 이상' },
    flash: { emoji: '⚡', label: '깜빡임', desc: '초당 3번보다 빠르게 깜빡이면 안 돼요 (광과민)' },
    speak: { emoji: '🔊', label: '읽어주기', desc: '쉬운 모드의 안내 문장은 🔊 로 다시 들을 수 있어야 해요' },
    focus: { emoji: '🎯', label: '한 가지 행동', desc: '한 화면의 큰 버튼은 3개 이하가 좋아요' },
    hanja: { emoji: '🈶', label: '한자', desc: '쉬운 모드에서는 한자·어려운 말을 피해요' },
    gate: { emoji: '🔒', label: '보호자 확인', desc: '쉬운 모드에서 어른용 화면(설정·로그아웃·초기화)은 보호자 확인 뒤에만 열려요' },
  };
  const KID_SEV = { critical: { label: '치명', emoji: '⛔', rank: 0 }, warn: { label: '경고', emoji: '⚠️', rank: 1 }, info: { label: '참고', emoji: '💡', rank: 2 } };
  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [role="radio"], [role="slider"], [data-action], [contenteditable=""], [contenteditable="true"]';
  const FREETEXT = 'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=password], input[type=tel], input[type=url], input[type=number], textarea, [contenteditable=""], [contenteditable="true"]';
  const BUTTONISH = 'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [data-action]';
  const EXIT_RX = /닫기|뒤로|돌아가기|그만|나가기|취소|close|back|✖|✕|×|⬅|←|❌/i;
  const ERR_RX = /\bNaN\b|\bundefined\b|\[object [A-Za-z]+\]|\bInfinity\b|\bnull\b|TypeError|ReferenceError|ERR_[A-Z_]{3,}/;
  const LAYERS = new Set(['labels-layer', 'modal-root', 'popover-root', 'reward-root', 'toast-root', 'fade', 'screen-root', 'loading-screen', 'game-container', 'dialogue-root', 'devcenter', 'hud', 'app']);
  const kidExcluded = (el) => !!el.closest('#devcenter, .dc-spot, .dc-tour-pill, [data-kid-exempt]');

  const KidAudit = {
    last: null,
    tapMin() {
      const easy = easyOn();
      let v = parseFloat(getComputedStyle(document.body).getPropertyValue('--tap'));
      if (!(v >= 20 && v <= 120)) v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap'));
      if (!(v >= 20 && v <= 120)) v = easy ? 56 : 40;
      return { easy, min: v, critical: easy ? 44 : 24 };
    },
    /** visible box of an element on screen (null = hidden / off screen / collapsed), cached per run */
    box(el, cache) {
      if (cache.has(el)) return cache.get(el);
      let out = null;
      try {
        const r = el.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && !(r.width <= 2 && r.height <= 2)) {
          out = r;
          for (let e = el, i = 0; e && e !== document.body && i < 16; e = e.parentElement, i++) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || (i === 0 && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || Number(cs.opacity) < 0.05) { out = null; break; }
          }
        }
      } catch (e) { out = null; }
      cache.set(el, out);
      return out;
    },
    /** is the element (or a descendant) the topmost thing under its centre? (modal backdrops cover the HUD) */
    onTop(el, r) {
      const x = clamp(r.left + r.width / 2, 0, innerWidth - 1), y = clamp(r.top + r.height / 2, 0, innerHeight - 1);
      let stack;
      try { stack = document.elementsFromPoint(x, y); } catch (e) { return true; }
      const top = stack.find((e) => !kidExcluded(e));
      return !top || top === el || el.contains(top) || top.contains(el) && !LAYERS.has(top.id);
    },
    name(el) {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
      if (el.value && /^(button|submit|reset)$/i.test(el.type || '')) return String(el.value);
      const t = el.getAttribute('title') || el.querySelector?.('img[alt]')?.getAttribute('alt') || el.querySelector?.('svg title')?.textContent || '';
      if (t.trim()) return t.trim();
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent.trim()) return l.textContent.trim(); }
      const wrap = el.closest('label');
      if (wrap && wrap !== el && wrap.textContent.trim()) return wrap.textContent.trim();
      return (el.getAttribute('placeholder') || '').trim();
    },
    hasPicture(el, text) {
      return RX_EMOJI.test(text) || !!el.querySelector?.('svg, img, canvas, .ico, .emoji, [data-icon], i[class]') || /^(✖|✕|×|⬅|←|→|➡|↻|＋|－|\+|-)$/.test(text.trim());
    },
    /** the box a kid actually taps: labels around checkboxes/radios count */
    targetBox(el, cache) {
      let r = this.box(el, cache);
      if ((el.type === 'checkbox' || el.type === 'radio') && el.tagName === 'INPUT') {
        const lab = el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        const lr = lab ? this.box(lab, cache) : null;
        if (lr) r = lr;
      }
      return r;
    },
    /** painted area of a fixed HUD block (transparent wrappers → union of visible children) */
    paintBox(el, cache, depth = 0) {
      const r = this.box(el, cache);
      if (!r) return null;
      const cs = getComputedStyle(el);
      const painted = parseColor(cs.backgroundColor).a > 0.05 || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || (parseFloat(cs.borderTopWidth) > 0 && parseColor(cs.borderTopColor).a > 0.05);
      if (painted || depth >= 2 || Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return r;
      let u = null;
      for (const c of el.children) {
        const b = this.paintBox(c, cache, depth + 1);
        if (!b) continue;
        u = u ? { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }
      return u ? { left: u.left, top: u.top, right: u.right, bottom: u.bottom, width: u.right - u.left, height: u.bottom - u.top } : null;
    },
    bgOf(el) {
      let acc = { r: 0, g: 0, b: 0, a: 0 };
      let estimated = true;
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        let c = parseColor(cs.backgroundColor);
        if (c.a < 0.02 && cs.backgroundImage && cs.backgroundImage !== 'none') {
          // gradients: average of the colour stops (quick estimate)
          const stops = cs.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
          if (stops.length) {
            const cs2 = stops.map(parseColor);
            c = { r: cs2.reduce((n, x) => n + x.r, 0) / cs2.length, g: cs2.reduce((n, x) => n + x.g, 0) / cs2.length, b: cs2.reduce((n, x) => n + x.b, 0) / cs2.length, a: Math.min(1, cs2.reduce((n, x) => n + x.a, 0) / cs2.length) };
          }
        }
        if (c.a > 0.01) acc = over(acc, c); // acc is on top of c: compose "under"
        if (acc.a >= 0.985) { estimated = false; break; }
      }
      if (acc.a < 0.985) acc = over(acc, BACKDROP);
      return { color: acc, estimated };
    },

    /**
     * Audit what is on screen. opts: {scope: Element (default: whole page), screen: id, label, hud: include overlap check}
     * Never mutates the page. Elements inside the developer center are ignored.
     */
    run(opts = {}) {
      const t0 = perf();
      const cache = new Map();
      const root = opts.scope && opts.scope.isConnected ? opts.scope : document.body;
      const tap = this.tapMin();
      const easy = tap.easy;
      const items = [];
      const counts = { critical: 0, warn: 0, info: 0 };
      const byKind = {};
      for (const k of Object.keys(KID_KINDS)) byKind[k] = { critical: 0, warn: 0, info: 0 };
      const stats = { interactive: 0, covered: 0, textChecked: 0, prompts: 0, speakable: 0, modals: 0, anims: 0 };
      const add = (sev, kind, el, text, detail, r) => {
        counts[sev]++; byKind[kind][sev]++;
        if (items.length < 400) items.push({ sev, kind, sel: cssPath(el), text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60), detail, box: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, el });
      };
      // dc-open hides the interact prompt / mascot bubble while the panel is up: audit the real game screen
      const hadOpen = document.body.classList.contains('dc-open');
      if (hadOpen) document.body.classList.remove('dc-open');
      try {
        // ---------------------------------------------------------------- interactive targets
        const all = Array.from(root.querySelectorAll(INTERACTIVE)).filter((el) => !kidExcluded(el));
        const seen = new Set();
        for (const el of all) {
          const r = this.targetBox(el, cache);
          if (!r) continue;
          // a control nested in another control of (almost) the same size is the same target
          const outer = el.parentElement?.closest(INTERACTIVE);
          if (outer && !kidExcluded(outer) && seen.has(outer)) {
            const orr = this.box(outer, cache);
            if (orr && orr.width * orr.height <= r.width * r.height * 1.6) continue;
          }
          if (!this.onTop(el, r)) { stats.covered++; continue; }
          seen.add(el);
          stats.interactive++;
          const name = this.name(el);
          const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
          const inlineLink = el.tagName === 'A' && el.parentElement && /^(P|LI|SPAN|SMALL|TD)$/.test(el.parentElement.tagName) && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 8;
          // 👆 tap size
          const m = Math.min(r.width, r.height);
          if (m < tap.min - 0.5) { // half a pixel of sub-pixel layout (55.99 px) is still the full size
            const sev = disabled || inlineLink ? 'info' : m < tap.critical ? 'critical' : 'warn';
            add(sev, 'tap', el, name, `${Math.round(r.width)}×${Math.round(r.height)} px (최소 ${tap.min} px)${disabled ? ' · 꺼진 버튼' : inlineLink ? ' · 글 속 링크' : ''}`, r);
          }
          const buttonish = el.matches(BUTTONISH);
          // 🏷️ accessible name + picture
          const vis = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (!name) add(el.getAttribute('aria-hidden') === 'true' ? 'info' : 'warn', 'name', el, '', '읽을 이름이 없어요 → aria-label 을 넣어 주세요', r);
          else if (buttonish && easy && !this.hasPicture(el, vis || name) && !disabled) add('info', 'name', el, name, '그림(이모지)이 없어요 — 글을 못 읽는 아이도 알 수 있게', r);
          // 🔤 long label
          if (buttonish && vis) {
            const hangul = (vis.match(/[가-힣]/g) || []).length;
            const pic = this.hasPicture(el, vis);
            if (hangul > 6 && !pic) add(easy ? 'warn' : 'info', 'label', el, vis, `${hangul}글자 · 그림 없음 (6글자 이하 + 그림)`, r);
            else if (hangul > 12) add('info', 'label', el, vis, `${hangul}글자 — 더 짧게`, r);
          }
        }
        // ---------------------------------------------------------------- ⌨️ free-text inputs
        for (const el of root.querySelectorAll(FREETEXT)) {
          if (kidExcluded(el) || el.readOnly || el.disabled) continue;
          const r = this.box(el, cache);
          if (!r) continue;
          if (easy) add('critical', 'freetext', el, this.name(el) || el.getAttribute('placeholder') || el.type || 'text', `쉬운 모드에서 글자 입력칸이 보여요 (${el.tagName.toLowerCase()}${el.type ? `[type=${el.type}]` : ''})`, r);
        }
        // ---------------------------------------------------------------- 🚪 exits & 🎯 one obvious action (dialogs)
        const dialogs = Array.from(root.querySelectorAll('.modal, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')).filter((d) => !kidExcluded(d) && this.box(d, cache));
        if (root !== document.body && root.matches?.('.modal, [role="dialog"], [aria-modal="true"]') && !dialogs.includes(root)) dialogs.unshift(root);
        const outerDialogs = dialogs.filter((d) => !dialogs.some((o) => o !== d && o.contains(d)));
        for (const d of outerDialogs) {
          stats.modals++;
          const btns = Array.from(d.querySelectorAll('button, [role="button"], a[href]')).filter((b) => this.box(b, cache));
          const title = (d.querySelector('h1, h2, h3, .modal-head')?.textContent || d.getAttribute('aria-label') || '').trim();
          const r = this.box(d, cache);
          if (!btns.length) add('critical', 'exit', d, title, '버튼이 하나도 없는 창 — 막다른 길이에요', r);
          else if (!btns.some((b) => EXIT_RX.test(`${this.name(b)} ${b.textContent}`))) add('warn', 'exit', d, title, '✖ 닫기 / ⬅️ 뒤로 버튼이 없어요', r);
          const big = btns.filter((b) => b.matches('.btn-primary, .btn-gold, .btn-lg, .btn-xl, .easy-big, [data-primary]')).length;
          if (big > 3) add('info', 'focus', d, title, `큰 버튼이 ${big}개 — 다음 할 일이 하나로 보이면 좋아요`, r);
        }
        // ---------------------------------------------------------------- text: contrast, size, error words, hanja
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
        const textEls = new Set();
        for (let n = walker.nextNode(); n && textEls.size < 700; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!el || textEls.has(el) || kidExcluded(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE|OPTION)$/.test(el.tagName)) continue;
          textEls.add(el);
        }
        const contrastSeen = new Set();
        for (const el of textEls) {
          const r = this.box(el, cache);
          if (!r) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden') continue;
          stats.textChecked++;
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
          if (ERR_RX.test(own)) add('critical', 'errtext', el, own, '화면에 프로그램 오류 글자가 보여요', r);
          if (easy && /[㐀-䶿一-鿿]/.test(own)) add('info', 'hanja', el, own, '한자가 있어요', r);
          // SVG text (illustrations): its CSS font size is in drawing units, scaled with the picture → measure the
          // size on screen; its colour is `fill` over the drawing's own shapes, which a CSS background walk cannot see
          const svgText = typeof SVGElement !== 'undefined' && el instanceof SVGElement;
          let size = parseFloat(cs.fontSize) || 16;
          if (svgText) { try { const m = el.getScreenCTM?.(); const k = m ? Math.hypot(m.a, m.b) : 1; if (k > 0.05) size *= k; } catch (e) { /* keep CSS size */ } }
          if (easy && own.length > 1 && !RX_EMOJI.test(own.length <= 2 ? own : '')) {
            if (size < 13.5) add('warn', 'fontsize', el, own, `${size.toFixed(0)} px (16 px 이상)`, r);
            else if (size < 15.5) add('info', 'fontsize', el, own, `${size.toFixed(1)} px (16 px 이상)`, r);
          }
          if (svgText) continue;
          const fg = parseColor(cs.color);
          // emoji are coloured pictures: also drop their joiners / variation selectors (❤️ = U+2764 U+FE0F)
          if (fg.a < 0.05 || !own.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u20e3]|\s/gu, '')) continue;
          const bg = this.bgOf(el);
          const ink = over({ ...fg }, bg.color);
          const ratio = contrastRatio(ink, bg.color);
          const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const shadow = cs.textShadow && cs.textShadow !== 'none';
          const need = large || shadow ? 3 : 4.5;
          if (ratio < need) {
            const key = `${cs.color}|${bg.color.r | 0},${bg.color.g | 0},${bg.color.b | 0}|${large}`;
            if (contrastSeen.has(key) && items.length > 200) continue;
            contrastSeen.add(key);
            add('warn', 'contrast', el, own, `${ratio.toFixed(2)} : 1 (필요 ${need} : 1)${bg.estimated ? ' · 3D 배경 추정' : ''}`, r);
          }
        }
        // ---------------------------------------------------------------- 🔊 speakable prompts (easy mode)
        if (easy) {
          const prompts = Array.from(root.querySelectorAll('.modal-head h2, #objective-hint, [data-say], [data-speak], [class*="next-step"], [class*="nextstep"], #dialogue-root [class*="text"]')).filter((el) => !kidExcluded(el) && this.box(el, cache) && el.textContent.trim());
          const speakBtn = (scope) => Array.from(scope.querySelectorAll('button, [role="button"]')).some((b) => /🔊|📢/.test(b.textContent) || /읽어|듣기|소리로/.test(b.getAttribute('aria-label') || '') || b.hasAttribute('data-say') || b.hasAttribute('data-speak'));
          for (const p of prompts) {
            stats.prompts++;
            const host = p.closest('.modal-head, header, [class*="card"], #dialogue-root, .modal') || p.parentElement || p;
            if (p.hasAttribute('data-say') || p.hasAttribute('data-speak') || speakBtn(host) || speakBtn(p)) stats.speakable++;
            else add('info', 'speak', p, p.textContent, '🔊 다시 듣기 버튼이 없어요', this.box(p, cache));
          }
        }
        // ---------------------------------------------------------------- 🧱 fixed HUD overlaps
        if (opts.hud !== false && root === document.body) {
          const cands = [];
          const vw = innerWidth * innerHeight;
          for (const el of document.querySelectorAll('#hud > *, body > *, #app > *, #popover-root > *')) {
            if (kidExcluded(el) || LAYERS.has(el.id) || el.matches('script, style, canvas')) continue;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
            const b = this.paintBox(el, cache);
            if (!b || b.width * b.height > vw * 0.55 || b.width * b.height < 64) continue;
            cands.push({ el, b });
          }
          for (let i = 0; i < cands.length; i++) {
            for (let j = i + 1; j < cands.length; j++) {
              const A = cands[i], B = cands[j];
              if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
              const w = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left), h = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
              if (w <= 2 || h <= 2) continue;
              const ratio = (w * h) / Math.min(A.b.width * A.b.height, B.b.width * B.b.height);
              if (ratio < 0.06 || w * h < 120) continue;
              add(ratio > 0.3 ? 'warn' : 'info', 'overlap', A.el, `${cssPath(A.el)} ↔ ${cssPath(B.el)}`, `${Math.round(ratio * 100)}% 겹침 (${Math.round(w)}×${Math.round(h)} px)`, { left: Math.max(A.b.left, B.b.left), top: Math.max(A.b.top, B.b.top), width: w, height: h });
            }
          }
        }
        // ---------------------------------------------------------------- ⚡ photosensitivity (> 3 Hz infinite flashes)
        try {
          for (const a of document.getAnimations?.() || []) {
            const t = a.effect?.target;
            if (!t || t.nodeType !== 1 || kidExcluded(t) || (root !== document.body && !root.contains(t)) || a.playState !== 'running') continue;
            stats.anims++;
            const ct = a.effect.getComputedTiming?.() || {};
            const dur = Number(ct.duration) / Math.max(0.01, Math.abs(a.playbackRate || 1));
            if (ct.iterations !== Infinity || !(dur > 0) || dur >= 333) continue;
            const props = new Set();
            for (const k of a.effect.getKeyframes?.() || []) for (const p of Object.keys(k)) props.add(p);
            if (['opacity', 'backgroundColor', 'background', 'filter', 'color', 'visibility', 'boxShadow'].some((p) => props.has(p))) {
              const r = this.box(t, cache);
              if (r) add('warn', 'flash', t, a.animationName || [...props].join(','), `${(1000 / dur).toFixed(1)} Hz 반복 (3 Hz 이하로)`, r);
            }
          }
        } catch (e) { /* getAnimations unsupported */ }
      } finally {
        if (hadOpen) document.body.classList.add('dc-open');
      }
      items.sort((a, b) => KID_SEV[a.sev].rank - KID_SEV[b.sev].rank || a.kind.localeCompare(b.kind));
      const score = Math.round(clamp(100 - counts.critical * 10 - Math.min(40, counts.warn * 2) - Math.min(10, counts.info * 0.25), 0, 100));
      const result = {
        at: now(), ms: perf() - t0, screen: opts.screen || 'live', label: opts.label || '지금 화면', easy, tap, score, counts, byKind, stats, items,
        viewport: `${innerWidth}×${innerHeight}`, scope: root === document.body ? 'page' : cssPath(root),
      };
      if (!opts.keep) this.last = result;
      return result;
    },
    /** JSON-safe copy (no element references) */
    plain(r) {
      if (!r) return null;
      const { items, ...rest } = r;
      return { ...rest, items: items.map(({ el, ...x }) => x) };
    },
  };

  // =========================================================================== parent gate / speech / easy status
  function easyStatus() {
    const E = G.easy;
    let unlocked = null;
    try {
      if (typeof E?.gateStatus === 'function') unlocked = !!E.gateStatus()?.unlocked;
      else if (typeof E?.isUnlocked === 'function') unlocked = !!E.isUnlocked();
      else if (typeof E?.gateUnlocked === 'boolean') unlocked = E.gateUnlocked;
      else { const u = Number(E?.gateUnlockedUntil ?? E?.unlockedUntil); if (Number.isFinite(u) && u > 0) unlocked = u > Date.now(); }
    } catch (e) { unlocked = null; }
    let voices = 0, ko = 0;
    try { const v = window.speechSynthesis?.getVoices?.() || []; voices = v.length; ko = v.filter((x) => /^ko/i.test(x.lang)).length; } catch (e) { /* unsupported */ }
    const api = ['set', 'say', 'stop', 'speakable', 'gate', 'pick', 'confirm', 'celebrate', 'point', 'nextStep', 'goTo', 't', 'nameIdeas'];
    return {
      present: !!E, on: easyOn(), api: api.map((k) => ({ k, ok: typeof E?.[k] === 'function' })),
      voiceGuide: G.settings?.voiceGuide !== false, voiceRate: num(G.settings?.voiceRate, 0.95), muted: !!G.settings?.muted,
      speech: !!window.speechSynthesis, voices, koVoices: ko, kidChat: G.settings?.kidChat !== false,
      parentGate: G.settings?.parentGate !== false, unlocked, reminder: num(G.settings?.playReminderMin, 30),
      tap: KidAudit.tapMin().min, bodyClass: document.body.classList.contains('easy') ? 'easy' : document.body.classList.contains('easy-off') ? 'easy-off' : '-',
      maskPII: typeof G.sys.social?.maskPII === 'function', sayLog: KidLog.say.slice(), gateLog: KidLog.gate.slice(),
    };
  }
  /** switch easy mode; turning it OFF asks the parent gate (G.easy.set) — the panel steps aside so it can be seen */
  async function setEasy(on) {
    if (typeof G.easy?.set === 'function') {
      const st = safe(() => G.easy.gateStatus?.()) || {};
      const gated = !on && easyOn() && G.settings?.parentGate !== false && !st.unlocked;
      if (gated && ui.opened) { panelAway(true); tourPill('🔒 보통 모드로 바꾸려면 보호자 확인을 풀어 주세요'); }
      try { await G.easy.set(!!on); } catch (e) { G.log.warn('DEV', 'easy toggle failed', e); }
      finally { if (gated) { tourPill(null); if (ui.opened && ui.away) panelAway(false); } }
    } else { G.setSetting('easyMode', !!on); G.applySettingsToDom?.(); }
    return easyOn();
  }

  // =========================================================================== 🎬 tour: open the main screens through public APIs and audit each
  const firstKey = (o) => (o && typeof o === 'object' ? Object.keys(o)[0] : undefined);
  const fnOf = (obj, ...names) => { for (const n of names) if (typeof obj?.[n] === 'function') return obj[n].bind(obj); return null; };
  const KID_SCREENS = [
    { id: 'hud', emoji: '🏠', label: '게임 화면 (HUD)', hud: true, fn: () => (G.state ? () => true : null) },
    { id: 'bag', emoji: '🎒', label: '가방', fn: () => fnOf(G.sys.inventory, 'open') },
    { id: 'shop', emoji: '🛒', label: '가게', fn: () => { const f = fnOf(G.sys.inventory, 'openShop'); return f && (() => f(firstKey(G.data.shops))); } },
    { id: 'sticker', emoji: '📖', label: '스티커북 (도감·업적)', fn: () => fnOf(G.sys.progression, 'openStickerbook', 'openHub', 'openCollection') },
    { id: 'today', emoji: '🔔', label: '오늘 (출석·미션)', fn: () => fnOf(G.sys.engagement, 'open') },
    { id: 'quest', emoji: '📜', label: '할 일 (퀘스트)', fn: () => fnOf(G.sys.quest, 'openLog') },
    { id: 'journal', emoji: '📝', label: '일기 쓰기', fn: () => fnOf(G.sys.journal, 'open') },
    { id: 'edu', emoji: '📚', label: '배움터', fn: () => fnOf(G.sys.education, 'openLibrary') },
    { id: 'lesson', emoji: '📗', label: '배움 이야기', fn: () => { const f = fnOf(G.sys.education, 'open'); const id = (G.data.educationIds || [])[0] || firstKey(G.data.education); return f && id ? () => f(id) : null; } },
    { id: 'quiz', emoji: '❓', label: '퀴즈', fn: () => { const f = fnOf(G.sys.education, 'openQuiz'); const id = firstKey(G.data.quizzes); return f && id ? () => f(id) : null; } },
    { id: 'map', emoji: '🗺️', label: '어디 갈까 (지도)', fn: () => fnOf(G.sys.minimap, 'openFastTravel', 'openWorldMap') },
    { id: 'emote', emoji: '😊', label: '표현하기', fn: () => { const f = fnOf(G.sys.social, 'openExpress', 'openEmotes'); return f && (() => f(document.querySelector('[data-action="emote"]') || undefined)); } },
    { id: 'chat', emoji: '💬', label: '말하기 (채팅)', fn: () => { const f = fnOf(G.sys.social, 'openKidChat', 'openPhrases'); if (f) return f; return typeof G.ui?.triggerAction === 'function' ? () => G.ui.triggerAction('chat') : null; } },
    { id: 'avatar', emoji: '👕', label: '꾸미기 (아바타)', fn: () => fnOf(G.app, 'openAvatar') },
    { id: 'menu', emoji: '☰', label: '메뉴', fn: () => fnOf(G.app, 'openMenu') },
    // kid settings sheet (소리·음악·읽어주기·쉬운 모드) is ungated on purpose (§12.4 quick toggles);
    // the grown-up settings must show the parent gate first
    { id: 'settings-kid', emoji: '🔊', label: '설정 (아이용)', fn: () => fnOf(G.app, 'openKidSettings', 'openSettings') },
    { id: 'settings', emoji: '⚙️', label: '어른 설정 (보호자 확인)', gate: true, fn: () => fnOf(G.app, 'openAdultSettings') || (typeof G.app?.openSettings === 'function' ? () => G.app.openSettings({ adult: true }) : null) },
    { id: 'help', emoji: '❔', label: '도움말', fn: () => fnOf(G.app, 'openHelp') },
    { id: 'photo', emoji: '📸', label: '사진 찍기', fn: () => fnOf(G.sys.photo, 'enter'), scope: () => document.getElementById('photo-ui'), close: () => { if (G.sys.photo?.active) G.sys.photo.exit?.({ silent: true }); } },
  ];
  const Tour = {
    running: false, stop: false, result: null, step: null, _p: null,
    screens() { return KID_SCREENS.map((s) => ({ id: s.id, emoji: s.emoji, label: s.label, available: !!safe(() => s.fn()) })); },
    snapshot() { return { modals: document.querySelectorAll('#modal-root .modal').length, top: G.ui?.modal?.top?.() || null, pop: !!G.ui?.popover?.isOpen?.(), photo: !!G.sys.photo?.active, layers: document.body.querySelectorAll('[role="dialog"], [aria-modal="true"]').length }; },
    changed(a) { const b = this.snapshot(); return b.modals !== a.modals || b.top !== a.top || b.pop !== a.pop || b.photo !== a.photo || b.layers !== a.layers; },
    scopeFor(s) {
      const sc = s.scope?.();
      if (sc && sc.isConnected && !sc.hidden) return sc;
      const top = G.ui?.modal?.top?.();
      if (top?.el?.isConnected) return top.el;
      const dlg = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter((d) => !kidExcluded(d) && d.getBoundingClientRect().width > 1).pop();
      if (dlg) return dlg;
      const pop = document.querySelector('#popover-root > *');
      return pop && pop.getBoundingClientRect().width > 1 ? pop : null;
    },
    /** wait until enter animations of the screen (and of its backdrop / ancestors) have finished */
    async settle(scope, maxMs = 1400) {
      await nextFrame(); await nextFrame();
      const related = (t) => !!t && t.nodeType === 1 && (!scope || scope.contains(t) || t.contains(scope));
      const running = () => (document.getAnimations?.() || []).filter((a) => (a.playState === 'running' || a.pending) && Number.isFinite(a.effect?.getComputedTiming?.().endTime) && related(a.effect?.target));
      try {
        const anims = running();
        if (anims.length) await Promise.race([Promise.allSettled(anims.map((a) => a.finished)), sleep(maxMs)]);
        // a staggered entrance (header, then up to 16 cards, then the footer) can outlast maxMs on a slow device whose
        // main thread is busy rendering 3D: keep polling (wall clock) until no finite entrance animation is left
        const end = perf() + 9000;
        while (perf() < end && scope?.isConnected !== false && running().length) await sleep(90);
        if (scope?.querySelector?.('.is-entering') || scope?.classList?.contains?.('is-entering')) { const e2 = perf() + 2500; while (perf() < e2 && (scope.classList?.contains('is-entering') || scope.querySelector('.is-entering'))) await sleep(90); }
      } catch (e) { /* no Web Animations */ }
      // still fading in (opacity on an ancestor)? poll briefly until the screen is really visible
      if (scope) { const end = perf() + 900; while (perf() < end && !KidAudit.box(scope, new Map())) await sleep(60); }
      // slow devices (software WebGL, < 5 fps): staggered entrance animations can still hold every button at
      // opacity 0 — wait by FRAMES (not wall time) until at least one button is really visible, so a window that is
      // still fading in is not reported as a dead end
      if (scope) {
        const hasBtn = () => Array.from(scope.querySelectorAll('button, [role="button"], a[href]')).some((b) => KidAudit.box(b, new Map()));
        const end = perf() + 10000;
        for (let i = 0; i < 60 && perf() < end && scope.isConnected && !hasBtn(); i++) await nextFrame();
      }
      await nextFrame();
    },
    async closeAll(s) {
      try { s?.close?.(); } catch (e) { /* ignore */ }
      try { G.easy?.stop?.(); } catch (e) { /* ignore */ }
      try { G.ui?.popover?.close?.(); } catch (e) { /* ignore */ }
      try { G.ui?.modal?.closeAll?.(); } catch (e) { /* ignore */ }
      if (G.sys.photo?.active) { try { G.sys.photo.exit({ silent: true }); } catch (e) { /* ignore */ } }
      const ae = document.activeElement;
      if (ae && ae !== document.body && !kidExcluded(ae) && isTypingEl(ae)) ae.blur();
      // overlays that are not G.ui modals (gate, pickers): close buttons first, Escape only when something is open
      for (let i = 0; i < 3; i++) {
        const open = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter((d) => !kidExcluded(d) && d.isConnected && d.getBoundingClientRect().width > 1);
        if (!open.length) break;
        const btn = open[open.length - 1].querySelector('[aria-label*="닫기"], [aria-label*="뒤로"], [data-close], .close, .icon-btn');
        if (btn) btn.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await nextFrame();
      }
    },
    /** opts: {onStep(row, i, n), screens:[ids]} — returns {at, easy, rows, totals} */
    run(opts = {}) {
      if (this.running) return this._p;
      this.running = true; this.stop = false;
      this._p = (async () => {
        const t0 = perf();
        const rows = [];
        const list = KID_SCREENS.filter((s) => !opts.screens || opts.screens.includes(s.id));
        const wasOpen = ui.opened;
        if (wasOpen) panelAway(true, '🎬 화면을 차례로 점검하고 있어요…');
        const hadBlock = !!G.ui?.blockers?.has?.('devcenter');
        if (hadBlock) G.ui.unblock('devcenter');
        try {
          await this.closeAll();
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (this.stop) break;
            this.step = { i, n: list.length, label: s.label, emoji: s.emoji };
            tourPill(`${s.emoji} ${i + 1}/${list.length} · ${s.label}`);
            const row = { id: s.id, emoji: s.emoji, label: s.label, status: 'skip', note: '', audit: null, ms: 0 };
            const t1 = perf();
            const fn = safe(() => s.fn());
            if (!fn) { row.note = '공개 API 가 없어요 (건너뜀)'; rows.push(row); opts.onStep?.(row, i, list.length); continue; }
            try {
              const before = this.snapshot();
              const ret = await Promise.race([Promise.resolve().then(fn), sleep(1500).then(() => 'pending')]);
              if (s.id !== 'hud') { const until = perf() + 1600; while (perf() < until && !this.changed(before)) await sleep(60); }
              const scope = s.id === 'hud' ? null : this.scopeFor(s);
              if (s.id !== 'hud' && !scope && ret === false) { row.status = 'skip'; row.note = '열리지 않았어요 (지금은 열 수 없는 상태)'; }
              else {
                await this.settle(scope);
                row.audit = KidAudit.run({ scope: scope || undefined, screen: s.id, label: s.label, hud: !!s.hud, keep: true });
                row.status = 'ok';
                if (!scope && s.id !== 'hud') row.note = '창을 찾지 못해 전체 화면을 점검했어요';
                // kid safety: in easy mode a grown-up screen must show the parent gate first, never the screen itself
                if (s.gate && easyOn() && G.settings?.parentGate !== false && typeof G.easy?.gate === 'function') {
                  const gateShown = !!scope && /\d{2}\s*[×xX*]\s*\d/.test(scope.textContent || '');
                  const unlocked = easyStatus().unlocked === true;
                  if (!gateShown && !unlocked) {
                    const a = row.audit;
                    a.counts.critical++; a.byKind.gate.critical++;
                    a.items.unshift({ sev: 'critical', kind: 'gate', sel: scope ? cssPath(scope) : 'body', text: s.label, detail: '보호자 확인 없이 어른용 화면이 열렸어요', box: null, el: scope || null });
                    a.score = Math.max(0, a.score - 10);
                  } else row.note = gateShown ? '보호자 확인 화면이 먼저 나와요 ✅' : '보호자 확인이 이미 풀려 있어요 (어른 화면이 열려 있어요)';
                }
              }
            } catch (e) {
              row.status = 'fail'; row.note = `열다가 오류: ${String(e?.message || e).slice(0, 100)}`;
              G.log.warn('DEV', `kid tour ${s.id} failed`, e);
            } finally {
              await this.closeAll(s);
              // closed screens are detached: drop their element references (no DOM kept alive by old results)
              if (row.audit) for (const it of row.audit.items) if (it.el && !it.el.isConnected) it.el = null;
            }
            row.ms = perf() - t1;
            rows.push(row);
            opts.onStep?.(row, i, list.length);
          }
        } finally {
          await this.closeAll();
          if (hadBlock && ui.opened) G.ui.block('devcenter');
          tourPill(null);
          if (wasOpen) panelAway(false);
          this.running = false; this.step = null;
        }
        const totals = { critical: 0, warn: 0, info: 0, screens: rows.filter((r) => r.status === 'ok').length, skipped: rows.filter((r) => r.status === 'skip').length, failed: rows.filter((r) => r.status === 'fail').length };
        for (const r of rows) if (r.audit) for (const k of ['critical', 'warn', 'info']) totals[k] += r.audit.counts[k];
        this.result = { at: now(), ms: perf() - t0, easy: easyOn(), viewport: `${innerWidth}×${innerHeight}`, rows, totals, stopped: this.stop };
        G.log.info('DEV', `kid tour: ${totals.screens} screens, critical ${totals.critical}, warn ${totals.warn}`);
        G.bus.emit('dev:kid-tour', { totals });
        return this.result;
      })();
      return this._p;
    },
    plain(r) { return r ? { ...r, rows: r.rows.map((x) => ({ ...x, audit: KidAudit.plain(x.audit) })) } : null; },
  };
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  // =========================================================================== 🖥️ GPU safety (black-rectangle bug, CONTRACT §11 / a954f38)
  const SCRUB_FALLBACK = {
    name: 'NaNScrubShader',
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(tDiffuse, vUv);\n  if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);\n  gl_FragColor = vec4(min(max(c.rgb, vec3(0.0)), vec3(48.0)), clamp(c.a, 0.0, 1.0));\n}',
  };
  const objPath = (o) => { const p = []; for (let x = o; x && p.length < 5; x = x.parent) if (x.parent || x.name) p.unshift(x.name || x.type); return p.join(' / ').slice(0, 120); };
  const LIT = (m) => !!m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial || m.isMeshMatcapMaterial || m.isMeshNormalMaterial || (m.isShaderMaterial && m.lights));
  const Gpu = {
    last: null, nan: null,
    /** read-only scan of the whole scene: zero/NaN normals, NaN positions, flattened (zero-scale axis) lit meshes */
    scan() {
      const E = G.sys.engine;
      if (!E?.scene) return null;
      const t0 = perf();
      const out = { at: now(), meshes: 0, geometries: 0, vertices: 0, badNormals: 0, badNormalGeos: [], nanPositions: 0, nanPosGeos: [], flat: [], flatInstances: 0, flatInstMeshes: [], instancedChecked: 0, shaders: [], repaired: num(G.gfx?.normalsRepaired), fixNormals: typeof G.gfx?.fixNormals === 'function' };
      const seen = new Set();
      const shaderSeen = new Set();
      E.scene.traverse((o) => {
        if (!o.isMesh) return;
        out.meshes++;
        const g = o.geometry;
        if (g && !seen.has(g)) {
          seen.add(g); out.geometries++;
          const n = g.attributes?.normal, p = g.attributes?.position;
          if (p) out.vertices += p.count;
          if (n && n.itemSize === 3) {
            let bad = 0;
            if (n.isInterleavedBufferAttribute) { for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = x * x + y * y + z * z; if (!(l > 1e-12) || !Number.isFinite(l)) bad++; } }
            else { const a = n.array; for (let i = 0; i + 2 < a.length; i += 3) { const l = a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]; if (!(l > 1e-12) || !Number.isFinite(l)) bad++; } }
            if (bad) { out.badNormals += bad; if (out.badNormalGeos.length < 12) out.badNormalGeos.push({ obj: objPath(o), n: bad, geo: g.type }); }
          }
          if (p && !p.isInterleavedBufferAttribute && p.array) {
            let nanP = 0;
            const a = p.array;
            for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nanP++;
            if (nanP) { out.nanPositions += nanP; if (out.nanPosGeos.length < 8) out.nanPosGeos.push({ obj: objPath(o), n: nanP }); }
          }
        }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && (m.isShaderMaterial || m.isRawShaderMaterial) && !shaderSeen.has(m)) {
          shaderSeen.add(m);
          if (out.shaders.length < 24) {
            const src = String(m.fragmentShader || '');
            out.shaders.push({ name: m.name || objPath(o) || m.type, ops: ['normalize', 'pow', 'sqrt', 'log', 'inversesqrt', 'atan'].filter((op) => src.includes(`${op}(`)) });
          }
        }
        let vis = true;
        for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
        if (!vis || !mats.some(LIT)) return;
        const e = o.matrixWorld.elements;
        const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
        const mx = Math.max(sx, sy, sz), mn = Math.min(sx, sy, sz);
        if (mx > 1e-6 && mn < mx * 1e-4 && out.flat.length < 20) out.flat.push({ obj: objPath(o), scale: [sx, sy, sz].map((v) => +v.toFixed(4)) });
        if (o.isInstancedMesh && o.instanceMatrix?.array) {
          const a = o.instanceMatrix.array;
          let k = 0;
          for (let i = 0, cnt = Math.min(o.count, a.length / 16); i < cnt; i++) {
            const j = i * 16;
            const ix = a[j] * a[j] + a[j + 1] * a[j + 1] + a[j + 2] * a[j + 2], iy = a[j + 4] * a[j + 4] + a[j + 5] * a[j + 5] + a[j + 6] * a[j + 6], iz = a[j + 8] * a[j + 8] + a[j + 9] * a[j + 9] + a[j + 10] * a[j + 10];
            const M = Math.max(ix, iy, iz), m = Math.min(ix, iy, iz);
            if (M > 1e-12 && m < M * 1e-8) k++; // a zero axis with others non-zero: the instancing normal divide hits 0/0
            out.instancedChecked++;
          }
          if (k) { out.flatInstances += k; if (out.flatInstMeshes.length < 12) out.flatInstMeshes.push({ obj: objPath(o), n: k, count: o.count }); }
        }
      });
      out.passes = this.passes();
      out.ms = perf() - t0;
      out.ok = out.badNormals === 0 && out.nanPositions === 0 && !out.flat.length && !out.flatInstances && out.passes.ok !== false;
      this.last = out;
      return out;
    },
    /** repair every geometry in the scene with the engine's helper (counts go to G.gfx.normalsRepaired) */
    fixAll() {
      const E = G.sys.engine;
      if (!E?.scene || typeof G.gfx?.fixNormals !== 'function') return 0;
      const before = num(G.gfx.normalsRepaired);
      const seen = new Set();
      E.scene.traverse((o) => { const g = o.geometry; if (g && !seen.has(g)) { seen.add(g); G.gfx.fixNormals(g); } });
      return num(G.gfx.normalsRepaired) - before;
    },
    passes() {
      const E = G.sys.engine, A = ADDONS || {};
      const c = E?.composer;
      if (!c || !Array.isArray(c.passes)) return { composer: false, bloomPreset: !!E?.preset?.bloom, list: [], ok: null };
      const list = c.passes.map((p) => {
        let name = p.material?.name && p.material.name !== 'unspecified' ? p.material.name : '';
        if (A.UnrealBloomPass && p instanceof A.UnrealBloomPass) name = 'UnrealBloomPass';
        else if (A.RenderPass && p instanceof A.RenderPass) name = 'RenderPass';
        else if (A.OutputPass && p instanceof A.OutputPass) name = 'OutputPass';
        return { name: name || p.constructor?.name || 'Pass', enabled: p.enabled !== false };
      });
      const scrub = list.findIndex((x) => /NaNScrub/i.test(x.name) && x.enabled);
      const bloom = list.findIndex((x) => /Bloom/i.test(x.name) && x.enabled);
      return { composer: true, list, scrub, bloom, ok: bloom < 0 ? true : scrub >= 0 && scrub < bloom };
    },
    scrubShader() {
      const p = G.sys.engine?.composer?.passes?.find?.((x) => x.material?.name === 'NaNScrubShader');
      if (p?.material?.fragmentShader) return { shader: { name: 'NaNScrubShader', uniforms: { tDiffuse: { value: null } }, vertexShader: p.material.vertexShader, fragmentShader: p.material.fragmentShader }, source: '엔진 컴포저의 셰이더' };
      const s = G.gfx?.nanScrubShader;
      if (s?.fragmentShader) return { shader: { name: 'NaNScrubShader', uniforms: { tDiffuse: { value: null } }, vertexShader: s.vertexShader || SCRUB_FALLBACK.vertexShader, fragmentShader: s.fragmentShader }, source: 'G.gfx.nanScrubShader' };
      return { shader: SCRUB_FALLBACK, source: '같은 셰이더 사본 (블룸 꺼짐)' };
    },
    /**
     * NaN injection: a temporary ShaderMaterial computes z/z with a uniform z = 0 on a tiny quad in front of a test
     * camera; the frame goes through the same chain as the engine (HalfFloat → [NaN scrub] → UnrealBloom) into a
     * small 8-bit target. Without the scrub, bloom smears NaN into a black box on GPUs that produce NaN; with it the
     * frame must be ≤ 1 % black. Every resource is disposed and the renderer state restored.
     */
    nanTest() {
      const E = G.sys.engine, r = E?.renderer, A = ADDONS || {};
      if (!r || !A.ShaderPass || !A.UnrealBloomPass) return { skip: true, detail: '렌더러 또는 후처리 모듈이 없어요' };
      const S = 64;
      const res = { at: now(), size: S, rawNaN: null, blackNoScrub: null, blackScrub: null, ok: false, source: '', frames: {}, ms: 0 };
      const t0 = perf();
      const prev = { rt: r.getRenderTarget(), autoClear: r.autoClear, color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
      const trash = [];
      const keep = (x) => { trash.push(x); return x; };
      const black = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) <= 12) n++; return n / (px.length / 4); };
      // three's readRenderTargetPixelsAsync (NPC/avatar portraits) keeps a PIXEL_PACK_BUFFER bound while it awaits the GPU
      // fence; a synchronous readPixels into JS memory then fails (INVALID_OPERATION, the array stays 0). Unbind around
      // our reads and put the binding back so the pending async read still completes.
      const gl = r.getContext();
      const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const readPx = (target, arr) => {
        const pack = gl2 ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) : null;
        if (pack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        try { r.readRenderTargetPixels(target, 0, 0, S, S, arr); } finally { if (pack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack); }
        return arr;
      };
      try {
        const scene = new THREE.Scene();
        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        cam.position.set(0, 0, 2);
        const bgGeo = keep(new THREE.PlaneGeometry(2, 2)), bgMat = keep(new THREE.MeshBasicMaterial({ color: 0x9fb39f }));
        scene.add(new THREE.Mesh(bgGeo, bgMat));
        const nanGeo = keep(new THREE.PlaneGeometry(0.125, 0.125)); // 4×4 px of 64×64 ≈ 0.4 % of the frame
        const nanMat = keep(new THREE.ShaderMaterial({
          name: 'DevNaNInjector',
          uniforms: { z: { value: 0 } },
          vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform float z;\nvoid main() { float v = z / z; gl_FragColor = vec4(v, v, v, 1.0); }',
        }));
        const quad = new THREE.Mesh(nanGeo, nanMat);
        quad.position.set(0.31, -0.22, 0.5);
        scene.add(quad);
        const { shader, source } = this.scrubShader();
        res.source = source;
        const scrub = keep(new A.ShaderPass(shader));
        const copy = keep(new A.ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: SCRUB_FALLBACK.vertexShader, fragmentShader: 'uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0); }' }));
        const rt = (type) => keep(new THREE.WebGLRenderTarget(S, S, { type, depthBuffer: false }));
        // raw probe: can this GPU produce NaN at all? (float target when readable)
        try {
          if (r.extensions?.has?.('EXT_color_buffer_float')) {
            const f = rt(THREE.FloatType);
            r.setRenderTarget(f); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam);
            const px = readPx(f, new Float32Array(S * S * 4));
            let n = 0, alpha = 0;
            for (let i = 0; i < px.length; i += 4) { if (Number.isNaN(px[i]) || !Number.isFinite(px[i])) n++; if (px[i + 3] > 0.5) alpha++; }
            res.rawNaN = alpha ? n : null; // alpha 0 everywhere = the read did not happen
          }
        } catch (e) { res.rawNaN = null; }
        const pass = (withScrub) => {
          const a = rt(THREE.HalfFloatType), b = rt(THREE.HalfFloatType), out = rt(THREE.UnsignedByteType);
          const bloom = keep(new A.UnrealBloomPass(new THREE.Vector2(S, S), 0.24, 0.4, 1.05)); // the engine's settings
          r.setRenderTarget(a); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam);
          let read = a, write = b;
          if (withScrub) { scrub.render(r, write, read); [read, write] = [write, read]; }
          bloom.render(r, write, read, 0, false);
          copy.render(r, out, read);
          return readPx(out, new Uint8Array(S * S * 4));
        };
        const opaque = (px) => { for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false; return true; };
        const no = pass(false), yes = pass(true);
        if (!opaque(no) || !opaque(yes)) { res.skip = true; res.detail = '테스트 화면을 읽지 못했어요 (다른 GPU 읽기와 겹침) — 잠시 후 다시 실행해 주세요'; return res; }
        res.blackNoScrub = black(no); res.blackScrub = black(yes);
        res.frames = { noScrub: no, scrub: yes };
        res.ok = res.blackScrub <= 0.01;
        res.gpuMakesNaN = res.rawNaN == null ? null : res.rawNaN > 0;
        res.detail = `스크럽 없음 검정 ${(res.blackNoScrub * 100).toFixed(1)}% → 스크럽 ${(res.blackScrub * 100).toFixed(2)}% (기준 ≤ 1%)${res.rawNaN == null ? '' : res.rawNaN ? ` · 원본 NaN ${res.rawNaN}화소` : ' · 이 GPU 는 0/0 을 NaN 으로 만들지 않아요'}`;
      } catch (e) {
        res.error = String(e?.message || e).slice(0, 200);
        res.detail = `테스트 실행 오류: ${res.error}`;
      } finally {
        try { r.setRenderTarget(prev.rt); r.autoClear = prev.autoClear; r.setClearColor(prev.color, prev.alpha); } catch (e) { /* ignore */ }
        // FullScreenQuad.dispose() would dispose three's SHARED full-screen triangle (also used by the engine's
        // composer): keep it, dispose only what this test created
        for (const x of trash) { try { if (x.fsQuad) x.fsQuad.dispose = () => {}; x.dispose?.(); } catch (e) { /* ignore */ } }
        res.ms = perf() - t0;
      }
      this.nan = res;
      return res;
    },
    plainNan(n) { if (!n) return null; const { frames, ...rest } = n; return rest; },
  };

  // =========================================================================== in-browser self tests (never mutate the real save)
  const SKIP = (why) => ({ skip: true, detail: why });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const TESTS = [];
  const T = (group, name, fn) => TESTS.push({ group, name, fn });

  // ---- 유틸리티
  T('🧰 유틸리티', 'clamp · lerp · invLerp 경계값', () => U.clamp(5, 0, 3) === 3 && U.clamp(-1, 0, 3) === 0 && U.lerp(0, 10, 0.25) === 2.5 && U.invLerp(0, 10, 5) === 0.5 && U.invLerp(2, 2, 9) === 0);
  T('🧰 유틸리티', 'angleDiff 는 ±π 를 넘어 가장 짧은 각을 줘요', () => near(U.angleDiff(3.1, -3.1), Math.PI * 2 - 6.2) && near(U.angleDiff(0, Math.PI / 2), Math.PI / 2));
  T('🧰 유틸리티', 'rng(seed) 는 같은 씨앗이면 같은 수열 · [0,1) 범위', () => {
    const a = U.rng(42), b = U.rng(42), c = U.rng(43);
    const sa = [a(), a(), a(), a(), a()], sb = [b(), b(), b(), b(), b()], sc = [c(), c(), c()];
    return eq(sa, sb) && sa.every((v) => v >= 0 && v < 1) && !eq(sa.slice(0, 3), sc) && eq([U.rng('메주')()], [U.rng('메주')()]);
  });
  T('🧰 유틸리티', 'hash 는 안정적이고 입력이 다르면 달라요', () => U.hash('abc') === U.hash('abc') && U.hash('abc') !== U.hash('abd') && U.hash('').length === 14);
  T('🧰 유틸리티', 'formatDuration 한국어 표기', () => U.formatDuration(75) === '1분 15초' && U.formatDuration(3600) === '1시간' && U.formatDuration(0) === '0초' && U.formatDuration(3720) === '1시간 2분');
  T('🧰 유틸리티', 'formatDate 형식 YYYY.MM.DD (HH:MM)', () => /^\d{4}\.\d{2}\.\d{2}$/.test(U.formatDate(Date.now())) && /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/.test(U.formatDate(Date.now(), true)));
  T('🧰 유틸리티', 'pointInPoly · distToPolyline 기하 계산', () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const d = U.distToPolyline(0, 1, [[-1, 0], [1, 0]]);
    return U.pointInPoly(5, 5, sq) && !U.pointInPoly(11, 5, sq) && near(d.d, 1) && near(d.t, 0.5);
  });
  T('🧰 유틸리티', 'defaults 는 빠진 키만 채우고 clone 은 깊은 복사', () => {
    const t = { a: 1, n: { x: 1 } };
    U.defaults(t, { a: 9, b: 2, n: { x: 9, y: 3 } });
    const src = { k: { v: [1, 2] } }, cp = U.clone(src);
    cp.k.v.push(3);
    return t.a === 1 && t.b === 2 && t.n.x === 1 && t.n.y === 3 && src.k.v.length === 2;
  });

  // ---- 보안·이스케이프
  T('🛡️ 보안·이스케이프', 'G.ui.esc 는 태그를 무력화해요 (XSS)', () => { const s = G.ui.esc('<img src=x onerror=alert(1)>'); return !/[<>]/.test(s) && s.includes('&lt;img'); });
  T('🛡️ 보안·이스케이프', '따옴표·앰퍼샌드 이스케이프', () => G.ui.esc(`"'&`) === '&quot;&#39;&amp;' && G.ui.esc(null) === '');
  T('🛡️ 보안·이스케이프', 'G.ui.h 자식 문자열은 HTML 로 해석되지 않아요', () => { const el = G.ui.h('div', null, '<b>x</b>'); return !el.querySelector('b') && el.textContent === '<b>x</b>'; });
  T('🛡️ 보안·이스케이프', '문서 렌더러: <script> 와 이벤트 속성 차단', () => {
    const html = Md.render('# 제목 <script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n| a | <b onmouseover=x>b</b> |\n|---|---|\n| 1 | 2 |').html;
    return !/<script/i.test(html) && !/<img/i.test(html) && !/<b /i.test(html) && html.includes('&lt;script&gt;');
  });
  T('🛡️ 보안·이스케이프', '문서 렌더러: javascript: 링크는 링크가 되지 않아요', () => {
    const html = Md.render('[누르기](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com/a?b=1&c=2)').html;
    return !/href="javascript/i.test(html) && !/href="data:/i.test(html) && html.includes('href="https://example.com/a?b=1&amp;c=2"') && html.includes('rel="noopener noreferrer"');
  });
  T('🛡️ 보안·이스케이프', '문서 렌더러: 따옴표로 속성을 깨는 시도 차단', () => {
    const html = Md.render('[x](https://a.b/"onmouseover="alert(1))').html;
    return !/onmouseover="/.test(html.replace(/&quot;onmouseover=&quot;/g, ''));
  });
  T('🛡️ 보안·이스케이프', 'CSP 메타 태그: 해시 기반 script-src · eval 금지', () => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!m) return SKIP('빌드되지 않은 개발 파일이라 CSP 가 없어요');
    const c = m.getAttribute('content') || '';
    return { ok: /script-src[^;]*'sha256-/.test(c) && !/unsafe-eval/.test(c) && /object-src 'none'/.test(c) && /default-src 'none'/.test(c), detail: `${(c.match(/'sha256-/g) || []).length}개 스크립트 해시` };
  });
  T('🛡️ 보안·이스케이프', '채팅 욕설 필터 · 정상 문장은 그대로', () => {
    const S = G.sys.social;
    if (!S?.filter || !S.hasBadWord) return SKIP('채팅 시스템이 없어요');
    const bad = G.data.badWords?.[0] || '시발';
    return S.filter(`${bad} 안녕`) !== `${bad} 안녕` && S.hasBadWord(`오늘 ${bad}`) && !S.hasBadWord('안녕하세요 반가워요');
  });
  T('🛡️ 보안·이스케이프', '채팅 텍스트 정리: 제어 문자·방향 바꾸기 문자 제거', () => {
    const S = G.sys.social;
    if (!S?.cleanText) return SKIP('채팅 시스템이 없어요');
    const s = S.cleanText('가\u0000나\u202E다\u200B라', 120);
    return !/[\u0000\u202E]/.test(s) && s.includes('가') && s.includes('라');
  });
  T('🛡️ 보안·이스케이프', '계정 비밀번호·이메일 정책', () => {
    const V = G.auth?.validate;
    if (!V?.password) return SKIP('앱 인증 모듈이 없어요');
    return !!V.password('abcdefgh') && !!V.password('12345678') && !V.password('Hanok2026!') && !V.email('name@example.com') && !!V.email('bad@@x');
  });
  T('🛡️ 보안·이스케이프', 'PBKDF2·SHA-256 암호 자가 점검 (RFC 벡터)', async () => {
    if (!G.auth?.selfTest) return SKIP('앱 인증 모듈이 없어요');
    const r = await G.auth.selfTest();
    const bad = (r.results || []).filter((x) => !x.ok).map((x) => x.name);
    return { ok: !!r.ok, detail: bad.length ? `실패: ${bad.join(', ')}` : `${(r.results || []).length}개 항목 통과` };
  });

  // ---- 저장
  T('💾 저장 (G.save)', 'checksum 은 같은 입력에 같고 1글자만 달라도 바뀌어요', () => { const s = JSON.stringify({ a: 1, b: '된장' }); return G.save.checksum(s) === G.save.checksum(s) && G.save.checksum(s) !== G.save.checksum(s + ' '); });
  T('💾 저장 (G.save)', 'createDefaultState 기본 구조', () => {
    const s = G.save.createDefaultState({ id: 'dc_test', nickname: '테스트' });
    return s.version === G.save.STATE_VERSION && s.stats.level === 1 && Array.isArray(s.journal) && Array.isArray(s.photos) && s.profile.id === 'dc_test' && isObj(s.quests) && isObj(s.farm?.plots);
  });
  T('💾 저장 (G.save)', 'normalize: 손상된 필드를 고치고 기존 값은 지켜요', () => {
    const n = G.save.normalize({ journal: 'broken', photos: null, stats: { coin: 5 }, version: 1 }, null);
    return Array.isArray(n.journal) && Array.isArray(n.photos) && n.stats.coin === 5 && n.stats.level === 1 && isObj(n.inventory);
  });
  T('💾 저장 (G.save)', 'normalize(null) 은 새 기본 상태', () => { const n = G.save.normalize(null, { id: 'x' }); return n.profile.id === 'x' && n.stats.level === 1; });
  T('💾 저장 (G.save)', '저장 왕복: 직렬화 → 체크섬 → 복원이 같아요', () => {
    const s = G.save.createDefaultState({ id: 'dc_rt' });
    s.inventory.ITEM_BEAN = 7; s.flags['dev:test'] = true;
    const data = JSON.stringify(s);
    const env = JSON.stringify({ version: G.save.STATE_VERSION, checksum: G.save.checksum(data), data });
    const back = JSON.parse(env);
    if (G.save.checksum(back.data) !== back.checksum) return false;
    const r = G.save.normalize(JSON.parse(back.data), null);
    return JSON.stringify(r) === data;
  });
  T('💾 저장 (G.save)', 'migrate 는 현재 버전으로 맞춰요', () => G.save.migrate({ version: 0 }).version === G.save.STATE_VERSION);
  T('💾 저장 (G.save)', '잘못된 저장 파일은 상태를 바꾸지 않고 거부해요', () => {
    const before = G.state;
    let threw = 0;
    try { G.save.importJSON('{"app":"other","state":{}}'); } catch (e) { threw++; }
    try { G.save.importJSON('not json'); } catch (e) { threw++; }
    return threw === 2 && G.state === before;
  });
  T('💾 저장 (G.save)', '내보내기 JSON 형식 (읽기 전용)', () => {
    if (!G.state) return SKIP('로그인 전이라 상태가 없어요');
    const o = JSON.parse(G.save.exportJSON());
    return o.app === 'tfm-metaverse' && o.version === G.save.STATE_VERSION && isObj(o.state) && o.state.profile?.id === G.state.profile?.id;
  });

  // ---- 월드
  T('🌍 월드 (G.world)', 'resolve: 임시 원형 충돌체 밖으로 밀어내요', () => {
    const id = G.world.addCollider({ shape: 'circle', x: 5000, z: 5000, r: 1, tag: 'dc-test' });
    try {
      const p = { x: 5000.2, y: 0, z: 5000 };
      const hit = G.world.resolve(p, 0.35, 0);
      return { ok: hit && near(Math.hypot(p.x - 5000, p.z - 5000), 1.35, 1e-3), detail: `거리 ${Math.hypot(p.x - 5000, p.z - 5000).toFixed(3)} m` };
    } finally { G.world.removeCollider(id); }
  });
  T('🌍 월드 (G.world)', 'resolve: 회전한 상자 충돌체 · 제거 후에는 막히지 않아요', () => {
    const id = G.world.addCollider({ shape: 'box', x: 6000, z: 6000, hw: 1, hd: 2, rot: Math.PI / 4, tag: 'dc-test' });
    let inside = false, pushed = false;
    try {
      inside = G.world.blocked(6000, 6000, 0.35, 0);
      const p = { x: 6000.05, y: 0, z: 6000.05 };
      G.world.resolve(p, 0.35, 0);
      pushed = !G.world.blocked(p.x, p.z, 0.3, 0);
    } finally { G.world.removeCollider(id); }
    return inside && pushed && !G.world.blocked(6000, 6000, 0.35, 0);
  });
  T('🌍 월드 (G.world)', 'zoneAt: 광장 중심은 중앙 광장, 먼 곳은 기본 구역', () => G.world.zoneAt(0, 0)?.id === 'ZONE_MAIN' && G.world.zoneAt(9999, 9999) === G.data.defaultZone);
  T('🌍 월드 (G.world)', 'zoneAt: 각 구역 중심은 그 구역(또는 더 작은 구역) 안', () => (G.data.zones || []).every((z) => num(G.world.zoneAt(z.center[0], z.center[1])?.r) <= z.r));
  T('🌍 월드 (G.world)', '지면 높이: 시작 지점과 광장이 평평해요', () => {
    const sp = G.data.layout?.spawn || { x: 0, z: 9 };
    const a = G.world.heightAt(sp.x, sp.z), b = G.world.heightAt(0, 0);
    return { ok: Number.isFinite(a) && Number.isFinite(b) && Math.abs(b) < 0.7, detail: `광장 ${b.toFixed(2)} m · 시작점 ${a.toFixed(2)} m` };
  });
  T('🌍 월드 (G.world)', '내 장독 J1 앵커와 3D 오브젝트', () => {
    const a = G.data.layout?.get?.('J1');
    if (!a) return false;
    return { ok: !!a, detail: G.world.getObject('J1') ? '3D 오브젝트 등록됨' : '앵커만 있음 (오브젝트 미등록)' };
  });

  // ---- 퀘스트
  T('📜 퀘스트', '상태 머신 순서 locked → … → claimed', () => eq(G.data.questStates, ['locked', 'available', 'accepted', 'progress', 'completed', 'claimed']));
  T('📜 퀘스트', 'status(): 없는 ID 는 null, 있는 ID 는 정의된 상태', () => {
    const Q = G.sys.quest;
    if (!Q?.status) return SKIP('퀘스트 시스템이 없어요');
    const s = Q.status('QUEST001');
    return Q.status('__no_such_quest__') === null && G.data.questStates.includes(s);
  });
  T('📜 퀘스트', '순차 퀘스트의 현재 목표 계산 (_currentIdx)', () => {
    const Q = G.sys.quest;
    if (typeof Q?._currentIdx !== 'function') return SKIP('내부 도우미가 공개돼 있지 않아요');
    const q = { objectives: [{ count: 1 }, { count: 2 }, { count: 1 }] };
    return Q._currentIdx(q, { progress: [1, 1, 0] }) === 1 && Q._currentIdx(q, { progress: [1, 2, 1] }) === -1 && Q._currentIdx(q, { progress: [] }) === 0;
  });
  T('📜 퀘스트', '선행 퀘스트에 순환이 없어요', () => !(Lint.get().issues.some((i) => i.cat === 'quests' && /순환/.test(i.msg))));
  T('📜 퀘스트', 'craftNeed: 만들기 재료가 모자라면 무엇이 몇 개 필요한지 알려 줘요 (아이 "콩을 모아요" 단계)', () => {
    const Q = G.sys.quest;
    if (typeof Q?.craftNeed !== 'function') return SKIP('G.sys.quest.craftNeed 가 없어요');
    if (Q.craftNeed('__NO_SUCH_CRAFT__') !== null) return { ok: false, detail: '없는 만들기 ID 는 null 이어야 해요' };
    const bad = [];
    let n = 0;
    for (const [id, r] of Object.entries(G.data.crafts || {})) {
      n++;
      const short = Object.entries(r.in || {}).find(([item, k]) => (Number(G.sys.inventory?.count?.(item)) || 0) < Math.max(1, Math.round(Number(k) || 1)));
      const got = Q.craftNeed(id);
      if (!short) { if (got !== null) bad.push(`${id}: 재료가 다 있는데 ${got.item}`); continue; }
      const crop = Object.keys(G.data.crops || {}).find((c) => G.data.crops[c]?.harvestItem === short[0]) || null;
      if (!got || got.item !== short[0] || got.need !== Math.max(1, Math.round(Number(short[1]) || 1)) || got.crop !== crop) bad.push(`${id}: ${JSON.stringify(got)}`);
    }
    return { ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join(' · ') : `만들기 ${n}가지 확인 (가방 그대로)` };
  });

  // ---- 농사
  T('🌱 농사 계산', '작물 단계는 0 → 100 오름차순', () => { const s = G.data.cropStages || []; return s.length >= 2 && s[0].min === 0 && s[s.length - 1].min === 100 && s.every((x, i) => !i || x.min > s[i - 1].min); });
  T('🌱 농사 계산', '건강·수분이 충분하면 정확히 growthTime 초에 다 자라요', () => {
    const Fm = G.sys.farming;
    if (typeof Fm?._eta !== 'function') return SKIP('농사 시스템이 없어요');
    const bad = Object.values(G.data.crops || {}).filter((c) => !near(Fm._eta({ growth: 0, health: 100, water: 100 }, c).full, c.growthTime, 1e-6));
    return { ok: !bad.length, detail: bad.length ? `불일치: ${bad.map((c) => c.id).join(', ')}` : `${Object.keys(G.data.crops || {}).length}종 확인` };
  });
  T('🌱 농사 계산', '물이 없으면 성장이 멈춰요 (예상 시간 ∞)', () => {
    const Fm = G.sys.farming;
    if (typeof Fm?._eta !== 'function') return SKIP('농사 시스템이 없어요');
    const c = Object.values(G.data.crops || {})[0];
    const e = Fm._eta({ growth: 10, health: 100, water: 0 }, c);
    return e.now === Infinity && e.full > 0;
  });
  T('🌱 농사 계산', '농사 설정값 범위 (건조 기준·오프라인 보정)', () => { const f = G.data.farming || {}; return f.dryThreshold > 0 && f.dryThreshold < 100 && f.offlineCatchUpMax > 0 && f.waterPerAction > 0; });

  // ---- 발효
  const sampleJar = (hyg) => ({ progress: 100, hygiene: hyg, acc: { t: 100, temp: 80, hum: 75, hyg: hyg * 100 } });
  T('🏺 발효 계산', '품질 점수는 0~100 · 등급 이름이 있어요', () => {
    const J = G.sys.fermentation;
    if (typeof J?._quality !== 'function') return SKIP('발효 시스템이 없어요');
    const rec = Object.values(G.data.recipes || {})[0];
    const rs = [100, 70, 40, 0].map((h) => J._quality(sampleJar(h), rec));
    return { ok: rs.every((q) => q.total >= 0 && q.total <= 100 && typeof q.grade !== 'undefined'), detail: rs.map((q) => q.total).join(' · ') };
  });
  T('🏺 발효 계산', '위생이 나쁠수록 품질이 같거나 낮아요', () => {
    const J = G.sys.fermentation;
    if (typeof J?._quality !== 'function') return SKIP('발효 시스템이 없어요');
    const rec = Object.values(G.data.recipes || {})[0];
    const a = J._quality(sampleJar(100), rec).total, b = J._quality(sampleJar(60), rec).total, c = J._quality(sampleJar(20), rec).total;
    return a >= b && b >= c && a > c;
  });
  T('🏺 발효 계산', '알맞은 온도·습도에서 발효가 더 빨라요', () => {
    const J = G.sys.fermentation;
    if (typeof J?._speed !== 'function') return SKIP('발효 시스템이 없어요');
    const rec = Object.values(G.data.recipes || {})[0];
    const s = { tempOff: 0, humOff: 0 };
    const ideal = J._speed(s, rec, { temp: (rec.idealTemp[0] + rec.idealTemp[1]) / 2, humidity: (rec.idealHumidity[0] + rec.idealHumidity[1]) / 2 });
    const bad = J._speed(s, rec, { temp: 45, humidity: 5 });
    return { ok: ideal.speed > bad.speed && near(ideal.ts, 1, 1e-6), detail: `${ideal.speed.toFixed(2)}× vs ${bad.speed.toFixed(2)}×` };
  });

  // ---- 데이터
  T('📦 데이터 불변식', '데이터 검사 오류 0건', () => { const r = Lint.run(); const first = r.issues.find((i) => i.sev === 'error'); return { ok: r.counts.error === 0, detail: first ? `${first.ref}: ${first.msg}` : `경고 ${r.counts.warn} · 참고 ${r.counts.info}` }; });
  T('📦 데이터 불변식', '레벨 경험치 표가 계속 증가해요', () => { const lv = G.data.levels; let p = 0; for (let i = 1; i < (lv?.max || 50); i++) { const e = lv.expFor(i); if (!(e > p)) return false; p = e; } return true; });
  T('📦 데이터 불변식', '퀴즈 정답 번호가 보기 안에 있어요', () => Object.values(G.data.quizzes || {}).every((q) => Number.isInteger(q.answer) && q.answer >= 0 && q.answer < (q.choices || []).length));
  T('📦 데이터 불변식', '모든 씨앗 ↔ 작물이 서로 가리켜요', () => Object.values(G.data.crops || {}).every((c) => G.data.items?.[c.seedItem]?.crop === c.id && !!G.data.items?.[c.harvestItem]));

  // ---- 시스템
  T('🧩 시스템', '이벤트 버스 on / emit / off / once', () => {
    const name = 'dc:selftest';
    let n = 0, m = 0;
    const off = G.bus.on(name, () => n++);
    G.bus.once(name, () => m++);
    G.bus.emit(name); G.bus.emit(name);
    off();
    G.bus.emit(name);
    return n === 2 && m === 1 && G.bus.count(name) === 0;
  });
  T('🧩 시스템', '모든 시스템 초기화 성공', () => { const bad = G.systems().filter((s) => s._failed || !s._initialized).map((s) => s.name); return { ok: !bad.length, detail: bad.length ? bad.join(', ') : `${G.systems().length}개 정상` }; });
  T('🧩 시스템', '조각(fragment) 로드 오류 없음', () => { const e = G.__fragmentErrors || []; return { ok: !e.length, detail: e.map((x) => x.name).join(', ') || `${(G.__fragments || []).length}개 로드` }; });
  // a new module must be added to the SOURCE map and EXPECTED_SYSTEMS (otherwise the 모듈 상태 tab can not report it missing)
  T('🧩 시스템', '새 파일·새 시스템이 소스 지도와 필수 시스템 목록에 있어요', () => {
    const man = window.__BUILD__?.manifest || {};
    const files = [...(man.js || []), ...(man.css || [])].map((f) => f.name).filter((n) => !SOURCE_BY_NAME.has(n));
    const sys = G.systems().map((s) => s.name).filter((n) => !EXPECTED_SYSTEMS.includes(n));
    return { ok: !files.length && !sys.length, detail: [files.length ? `SOURCE 에 없음: ${files.join(', ')}` : '', sys.length ? `EXPECTED_SYSTEMS 에 없음: ${sys.join(', ')}` : ''].filter(Boolean).join(' · ') || `파일 ${(man.js || []).length + (man.css || []).length}개 · 시스템 ${G.systems().length}개` };
  });
  T('🧩 시스템', 'WebGL 컨텍스트 정상', () => {
    const r = G.sys.engine?.renderer;
    if (!r) return false;
    const gl = r.getContext();
    return { ok: !!gl && !gl.isContextLost(), detail: `${r.capabilities?.isWebGL2 === false ? 'WebGL 1' : 'WebGL 2'} · 최대 텍스처 ${r.capabilities?.maxTextureSize || '?'}` };
  });
  T('🧩 시스템', 'localStorage 쓰기·읽기·삭제', () => {
    const k = 'tfm.v1.dev.probe';
    try { localStorage.setItem(k, '1'); const ok = localStorage.getItem(k) === '1'; localStorage.removeItem(k); return ok && localStorage.getItem(k) === null; } catch (e) { return { ok: false, detail: '저장소가 차단돼 있어요' }; }
  });


  // ---- GPU 안전 (검은 사각형 버그 a954f38 재발 방지)
  T('🖥️ GPU 안전', '장면 전체에 길이 0·NaN 정점 노멀이 없어요', () => {
    const s = Gpu.scan();
    if (!s) return SKIP('3D 장면이 아직 없어요');
    return { ok: s.badNormals === 0, detail: s.badNormals ? `${s.badNormals}개 — ${s.badNormalGeos.map((g) => g.obj).slice(0, 3).join(', ')}` : `메시 ${fmt(s.meshes)} · 정점 ${fmt(s.vertices)} 검사 · 엔진이 고친 노멀 누적 ${fmt(s.repaired)}개` };
  });
  T('🖥️ GPU 안전', '정점 위치에 NaN/Infinity 가 없어요', () => {
    const s = Gpu.last && now() - Gpu.last.at < 5000 ? Gpu.last : Gpu.scan();
    if (!s) return SKIP('3D 장면이 아직 없어요');
    return { ok: s.nanPositions === 0, detail: s.nanPositions ? s.nanPosGeos.map((g) => `${g.obj} ×${g.n}`).join(', ') : `${fmt(s.geometries)}개 지오메트리 정상` };
  });
  T('🖥️ GPU 안전', '한 축만 0 으로 납작한 조명 메시·인스턴스가 없어요 (노멀 행렬 0 → NaN)', () => {
    const s = Gpu.last && now() - Gpu.last.at < 5000 ? Gpu.last : Gpu.scan();
    if (!s) return SKIP('3D 장면이 아직 없어요');
    const bad = [...s.flat.map((f) => `${f.obj} (${f.scale.join('·')})`), ...s.flatInstMeshes.map((f) => `${f.obj} 인스턴스 ${f.n}개`)];
    return { ok: !bad.length, detail: bad.length ? bad.slice(0, 4).join(', ') : `인스턴스 ${fmt(s.instancedChecked)}개 포함 정상` };
  });
  T('🖥️ GPU 안전', '후처리: NaN 청소(NaNScrubShader)가 블룸보다 먼저', () => {
    const p = Gpu.passes();
    if (!p.composer) return SKIP(p.bloomPreset ? '컴포저가 아직 없어요' : '이 품질에서는 블룸이 꺼져 있어요 (NaN 이 번지지 않아요)');
    return { ok: p.ok, detail: p.list.map((x) => x.name).join(' → ') };
  });
  T('🖥️ GPU 안전', 'NaN 주입 → 청소 패스를 거치면 검은 화소 ≤ 1%', () => {
    const r = Gpu.nanTest();
    if (r.skip) return SKIP(r.detail);
    return { ok: !r.error && r.ok, detail: r.detail };
  });

  // ---- 쉬운 모드 (G.easy, CONTRACT §12.2)
  const EASY_API = ['set', 'say', 'stop', 'speakable', 'gate', 'pick', 'confirm', 'celebrate', 'point', 'nextStep', 'goTo', 't', 'nameIdeas'];
  T('👶 쉬운 모드', 'G.easy 공개 API 가 모두 있어요', () => {
    if (!G.easy) return SKIP('08-easy.js (G.easy) 가 아직 없어요');
    const miss = EASY_API.filter((k) => typeof G.easy[k] !== 'function');
    return { ok: !miss.length && typeof G.easy.on === 'boolean', detail: miss.length ? `없음: ${miss.join(', ')}` : `${EASY_API.length}개 · 지금 ${G.easy.on ? '쉬운 모드' : '보통 모드'}` };
  });
  T('👶 쉬운 모드', 'body 클래스 · --tap 이 설정과 같아요', () => {
    const on = G.settings?.easyMode !== false;
    const b = document.body.classList;
    const tap = KidAudit.tapMin().min;
    if (!b.contains('easy') && !b.contains('easy-off')) return SKIP('body.easy / easy-off 클래스가 아직 없어요');
    return { ok: b.contains('easy') === on && b.contains('easy-off') === !on && tap === (on ? 56 : 40), detail: `easyMode=${on} · body.${on ? 'easy' : 'easy-off'} · --tap ${tap}px` };
  });
  T('👶 쉬운 모드', 't(보통, 쉬운) 은 모드에 맞는 문구를 줘요', () => {
    if (typeof G.easy?.t !== 'function') return SKIP('G.easy.t 가 없어요');
    return G.easy.t('보통', '쉬운') === (easyOn() ? '쉬운' : '보통');
  });
  T('👶 쉬운 모드', 'say() 는 음성이 없는 환경에서도 오류 없이 끝나요', async () => {
    if (typeof G.easy?.say !== 'function') return SKIP('G.easy.say 가 없어요');
    let threw = null;
    try { const p = G.easy.say('', { interrupt: false }); if (p && typeof p.then === 'function') await Promise.race([p, sleep(1500)]); G.easy.stop?.(); } catch (e) { threw = e; }
    return { ok: !threw, detail: threw ? String(threw.message || threw) : `speechSynthesis ${window.speechSynthesis ? '있음' : '없음'}` };
  });
  T('👶 쉬운 모드', 'nameIdeas: 아이 친화 닉네임 (금칙어·개인정보 없음, 닉네임 규칙 통과)', () => {
    if (typeof G.easy?.nameIdeas !== 'function') return SKIP('G.easy.nameIdeas 가 없어요');
    const list = G.easy.nameIdeas(40);
    if (!Array.isArray(list) || list.length < 8) return { ok: false, detail: `결과가 ${Array.isArray(list) ? list.length : typeof list}개` };
    const bad = [];
    const S = G.sys.social;
    for (const n of list) {
      const s = String(n ?? '');
      const why = [];
      if (S?.hasBadWord?.(s) || (G.data.badWords || []).some((w) => w && s.toLowerCase().includes(String(w).toLowerCase()))) why.push('금칙어');
      if (typeof S?.maskPII === 'function' && maskOut(S.maskPII(s)) !== s) why.push('개인정보');
      const v = G.auth?.validate?.nickname?.(s);
      if (v) why.push(`규칙: ${v}`);
      if (/[0-9]{3,}/.test(s)) why.push('숫자');
      if (why.length) bad.push(`"${s}" ${why.join('·')}`);
    }
    const uniq = new Set(list).size;
    return { ok: !bad.length && uniq >= Math.min(list.length, 8), detail: bad.length ? bad.slice(0, 3).join(' / ') : `${list.length}개 · 서로 다른 이름 ${uniq}개 · 예: ${list.slice(0, 3).join(', ')}` };
  });
  /** find a visible button (outside the dev center) whose text contains `text` */
  const findKidButton = (text) => Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => !kidExcluded(b) && b.isConnected && (b.textContent || '').includes(text));
  async function waitFor(fn, ms = 1500) { const end = perf() + ms; for (;;) { const v = fn(); if (v) return v; if (perf() > end) return null; await sleep(40); } }
  T('👶 쉬운 모드', 'pick(): 고른 그림의 id 로 끝나고 ✖ 는 null', async () => {
    if (typeof G.easy?.pick !== 'function') return SKIP('G.easy.pick 가 없어요');
    const items = [{ id: 'dc-apple', emoji: '🍎', label: '사과깡' }, { id: 'dc-banana', emoji: '🍌', label: '바나나깡' }];
    const p1 = G.easy.pick({ title: '개발자 테스트', items, say: '' });
    const b = await waitFor(() => findKidButton('바나나깡'));
    if (!b) { G.ui.modal?.closeAll?.(); await Promise.race([p1, sleep(500)]); return SKIP('고르기 화면의 버튼을 찾지 못했어요'); }
    b.click();
    const v1 = await Promise.race([p1, sleep(1500).then(() => '__timeout')]);
    const p2 = G.easy.pick({ title: '개발자 테스트', items, say: '' });
    await waitFor(() => findKidButton('사과깡'));
    const close = Array.from(document.querySelectorAll('button')).reverse().find((x) => !kidExcluded(x) && x.isConnected && /닫기|뒤로|close/i.test(x.getAttribute('aria-label') || x.textContent || ''));
    if (close) close.click(); else G.ui.modal?.closeAll?.();
    const v2 = await Promise.race([p2, sleep(1500).then(() => '__timeout')]);
    return { ok: v1 === 'dc-banana' && v2 === null, detail: `선택 → ${JSON.stringify(v1)} · 닫기 → ${JSON.stringify(v2)}` };
  });
  T('👶 쉬운 모드', 'confirm(): 좋아요 → true · 아니요 → false', async () => {
    if (typeof G.easy?.confirm !== 'function') return SKIP('G.easy.confirm 가 없어요');
    const p1 = G.easy.confirm({ emoji: '🧪', title: '개발자 테스트', say: '', yes: '네맞아요', no: '아니에요' });
    const yes = await waitFor(() => findKidButton('네맞아요'));
    if (!yes) { G.ui.modal?.closeAll?.(); await Promise.race([p1, sleep(500)]); return SKIP('확인 화면의 버튼을 찾지 못했어요'); }
    yes.click();
    const v1 = await Promise.race([p1, sleep(1500).then(() => '__timeout')]);
    const p2 = G.easy.confirm({ emoji: '🧪', title: '개발자 테스트', say: '', yes: '네맞아요', no: '아니에요' });
    const no = await waitFor(() => findKidButton('아니에요'));
    no?.click();
    const v2 = await Promise.race([p2, sleep(1500).then(() => '__timeout')]);
    return { ok: v1 === true && v2 === false, detail: `좋아요 → ${JSON.stringify(v1)} · 아니요 → ${JSON.stringify(v2)}` };
  });
  T('👶 쉬운 모드', '퀘스트를 주는 NPC는 아이에게 제안 대사부터 보여 줘요 (메뉴 헤매기 없음)', () => {
    const D = G.sys.dialogue;
    if (typeof D?.check !== 'function') return SKIP('G.sys.dialogue.check 가 없어요');
    const on = !!G.easy?.on;
    if (D.check({ easy: on }) !== true || D.check({ easy: !on }) !== false) return { ok: false, detail: '대화 조건 easy 가 지금 모드와 달라요' };
    const qs = G.data.quests || {};
    const defs = Object.values(G.data.dialogues || {});
    const accepts = (node, id) => (node?.choices || []).some((c) => (c.actions || []).some((a) => a && a.type === 'acceptQuest' && a.quest === id));
    const bad = [];
    let n = 0;
    for (const [id, q] of Object.entries(qs)) {
      if (!q?.giver || q.autoAccept) continue;
      const def = defs.find((d) => d && d.npc === q.giver);
      if (!def) continue;
      n++;
      const ok = (def.entries || []).some((e) => e && JSON.stringify(e.if || {}).includes(`"${id}":"available"`) && accepts(def.nodes?.[e.node], id));
      if (!ok) bad.push(id);
    }
    return { ok: !bad.length, detail: bad.length ? `제안으로 바로 가지 않아요: ${bad.join(', ')}` : `퀘스트 ${n}개 모두 제안부터` };
  });
  T('🔒 개인정보 가림', '설정: 프로필 키(쉬운 모드·아이 채팅·보호자 확인)는 기기 저장소에 새지 않아요', () => {
    if (typeof G.setSetting !== 'function') return SKIP('G.setSetting 이 없어요');
    const KEY = 'tfm.v1.settings';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return null; } };
    const before = read();
    if (!before) return SKIP('기기 저장소를 읽을 수 없어요');
    const cur = !!G.settings.showFps;
    G.setSetting('showFps', !cur); G.setSetting('showFps', cur); // one ordinary device setting, then back
    const after = read() || {};
    const leaked = (G.settingsProfileKeys || ['easyMode', 'kidChat', 'parentGate']).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    const ok = !leaked.length && after._v === 2 && after.showFps === cur;
    return { ok, detail: ok ? `기기 저장소 형식 _v=${after._v} · 프로필 키 그대로 (${G.state ? '프로필 열림' : '처음 화면'})` : `새어 나감: ${leaked.join(', ') || '없음'} · _v=${after._v}` };
  });
  T('👶 쉬운 모드', '보호자 확인: 아무리 빨리 눌러도 문제 하나에 답 하나 (마구 누르기 방지)', async () => {
    if (typeof G.easy?.gate !== 'function') return SKIP('G.easy.gate 가 없어요');
    if (!easyOn() || G.settings.parentGate === false) return SKIP('쉬운 모드/보호자 확인이 꺼져 있어요');
    if (G.easy.gateStatus?.().unlocked) return SKIP('보호자 확인이 이미 풀려 있어요 (어른 화면이 열려 있어요)');
    if (G.easy.gateStatus?.().cooldownLeft > 0) return SKIP('보호자 확인이 쉬는 중이에요');
    const need = Math.max(1, Number(G.easy.gateStatus?.().need) || 1);
    const LS = 'tfm.v1.gate';
    let saved = null;
    try { saved = localStorage.getItem(LS); } catch (e) { saved = null; }
    const p = G.easy.gate({ reason: 'dev-test-mash', title: '개발자 테스트' });
    try {
      // one question: the right tile, then every other tile in the same moment (a mashing finger). Each round waits
      // for a NEW armed question (the grid unlocks after a short pause; slow devices take longer).
      let lastQ = null;
      const mash = async () => {
        const armed = await waitFor(() => {
          const g = document.querySelector('.easy-gate-modal:not(.modal-closing) .easy-gate-choices');
          if (!g || g.hidden || g.classList.contains('is-locked')) return null;
          const b = g.querySelector('.easy-gate-choice:not([disabled])');
          return b && b.dataset.q !== lastQ ? b : null;
        }, 5000);
        if (!armed) return null;
        lastQ = armed.dataset.q;
        const m = armed.closest('.easy-gate-modal');
        const spans = Array.from(m.querySelectorAll('.easy-gate-q span')).map((x) => x.textContent);
        const ans = Number(spans[0]) * Number(spans[2]);
        const btns = Array.from(m.querySelectorAll('.easy-gate-choice'));
        const right = btns.find((b) => Number(b.dataset.v) === ans);
        if (!right) return null;
        right.click();
        for (const b of btns) if (b !== right) b.click();
        return btns.length - 1;
      };
      const w0 = G.easy.gateStatus().wrong;
      const n1 = await mash();
      if (n1 == null) return SKIP('보호자 확인 문제가 나타나지 않았어요');
      const st1 = G.easy.gateStatus();
      // rules: `need` right answers in a row; the extra taps on the same question must not count as wrong answers
      let steps = 1;
      while (steps < need) {
        if ((await mash()) == null) break;
        steps++;
      }
      // the pass is announced a moment after the last right answer: the gate's own promise says whether it opened
      const passed = (await Promise.race([p, sleep(4000).then(() => 'timeout')])) === true;
      const st = G.easy.gateStatus();
      const okFirst = need > 1 ? (st1.streak === 1 && !st1.unlocked) : true;
      const ok = okFirst && passed && steps === need && st.wrong <= w0 && st.cooldownLeft === 0;
      return { ok, detail: `정답 → 바로 다른 보기 ${n1}개 → 연속 ${st1.streak}/${need} · ${steps}문제 뒤 통과 ${passed ? '✅' : '❌'} · 틀림 ${w0} → ${st.wrong} (늘면 안 돼요)` };
    } finally {
      G.ui.modal?.get?.('easy-gate')?.close?.();
      await Promise.race([p, sleep(1500)]);
      try { if (saved == null) localStorage.removeItem(LS); else localStorage.setItem(LS, saved); } catch (e) { /* storage blocked */ }
      G.easy.lockGate?.();
    }
  });
  T('👶 쉬운 모드', '보호자 확인: 두 자리 × 한 자리 · 보기 여러 개 중 정답 하나 · ✖ 는 false', async () => {
    if (typeof G.easy?.gate !== 'function') return SKIP('G.easy.gate 가 없어요');
    const NCH = Math.max(2, Number(G.easy.gateStatus?.().choices) || 4);
    // pure helper first (if the module exposes one), then the real screen
    const q = safe(() => (G.easy._gateQuestion || G.easy.gateQuestion)?.call(G.easy));
    if (q && Array.isArray(q.choices)) {
      const okq = q.a >= 10 && q.a <= 99 && q.b >= 2 && q.b <= 9 && q.choices.length === NCH && new Set(q.choices).size === NCH && q.choices.filter((c) => c === q.a * q.b).length === 1;
      if (!okq) return { ok: false, detail: `문제 ${JSON.stringify(q)} · 보기 ${NCH}개여야 해요` };
    }
    if (!easyOn() || G.settings.parentGate === false) {
      const v = await Promise.race([G.easy.gate({ reason: 'dev-test' }), sleep(800).then(() => '__timeout')]);
      return { ok: v === true, detail: `쉬운 모드/보호자 확인이 꺼져 있으면 바로 통과 → ${JSON.stringify(v)}` };
    }
    const before = KidLog.gate.length;
    const p = G.easy.gate({ reason: 'dev-test', title: '개발자 테스트' });
    const host = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal')).reverse().find((d) => !kidExcluded(d) && /\d{2}\s*[×xX*]\s*\d/.test(d.textContent || '')), 1200);
    if (!host) {
      const v = await Promise.race([p, sleep(400).then(() => '__pending')]);
      if (v === true) return SKIP('보호자 확인이 이미 풀려 있어요 (어른 화면이 열려 있어요)');
      G.ui.modal?.closeAll?.();
      return SKIP('보호자 확인 화면의 문제를 읽지 못했어요');
    }
    const m = (host.textContent || '').match(/(\d{2})\s*[×xX*]\s*(\d)/);
    const a = Number(m[1]), b2 = Number(m[2]);
    const choices = Array.from(host.querySelectorAll('button')).map((x) => x.textContent.replace(/[^\d]/g, '')).filter((t) => t.length >= 2).map(Number);
    const right = choices.filter((c) => c === a * b2).length;
    const close = Array.from(host.querySelectorAll('button')).find((x) => /닫기|뒤로|그만|close/i.test(`${x.getAttribute('aria-label') || ''} ${x.textContent}`));
    if (close) close.click(); else { G.ui.modal?.closeAll?.(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); }
    const v = await Promise.race([p, sleep(1500).then(() => '__timeout')]);
    const evt = KidLog.gate.length > before ? KidLog.gate[KidLog.gate.length - 1] : null;
    const ok = a >= 10 && a <= 99 && b2 >= 2 && b2 <= 9 && choices.length === NCH && new Set(choices).size === NCH && right === 1 && v === false;
    return { ok, detail: `${a} × ${b2} · 보기 ${choices.length}/${NCH}개 ${choices.join('/')} · 닫기 → ${JSON.stringify(v)}${evt ? ` · easy:gate ok=${evt.ok}` : ''}` };
  });

  // ---- 개인정보 가림 (CONTRACT §12.4, client mirror of server/lib/ChatFilter.php)
  const piiCheck = (cases) => {
    const M = G.sys.social?.maskPII;
    if (typeof M !== 'function') return SKIP('G.sys.social.maskPII 가 아직 없어요');
    const bad = [];
    for (const t of cases) {
      const o = maskOut(M.call(G.sys.social, t));
      if (!o.includes('🔒') || /[0-9]{4}|@[a-z]|\.com|\.kr|테헤란로|강남구|1203호/i.test(o)) bad.push(`${t} → ${o}`);
    }
    return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join(' / ') : cases.map((t) => maskOut(M.call(G.sys.social, t))).slice(0, 2).join(' · ') };
  };
  T('🔒 개인정보 가림', '전화번호 (010-1234-5678 · 01012345678 · +82 10 1234 5678)', () => piiCheck(PII_VECTORS.phone));
  T('🔒 개인정보 가림', '이메일 · 링크', () => piiCheck([...PII_VECTORS.email, ...PII_VECTORS.url]));
  T('🔒 개인정보 가림', '주소 (서울시 강남구 테헤란로 123 · 동·호수)', () => piiCheck(PII_VECTORS.address));
  T('🔒 개인정보 가림', '보통 문장은 그대로 (숫자·@멘션·지명)', () => {
    const M = G.sys.social?.maskPII;
    if (typeof M !== 'function') return SKIP('G.sys.social.maskPII 가 아직 없어요');
    const keep = [...new Set([...PII_VECTORS.keep, ...(sharedPII()?.keep || [])])];
    const bad = keep.filter((t) => maskOut(M.call(G.sys.social, t)) !== t);
    return { ok: !bad.length, detail: bad.length ? `잘못 가림: ${bad.slice(0, 3).join(' / ')}` : `${keep.length}문장 그대로` };
  });
  T('🔒 개인정보 가림', '숨긴 번호·주소도 가려요 (전각 ０１０ · 010/1234 · 공일공-일이삼사 · at…dot · bad[.]com) — tests/pii-vectors.json', () => {
    const M = G.sys.social?.maskPII;
    if (typeof M !== 'function') return SKIP('G.sys.social.maskPII 가 아직 없어요');
    const v = sharedPII();
    if (!v || !v.whole.length) return SKIP('빌드에 공유 테스트 벡터(window.__BUILD__.piiVectors)가 없어요');
    const bad = [];
    for (const t of v.whole) { const o = maskOut(M.call(G.sys.social, t)); if (o !== '🔒') bad.push(`${t} → ${o}`); }
    for (const t of v.partial) { const o = maskOut(M.call(G.sys.social, t)); if (!o.includes('🔒') || /[0-9]{4}|@[a-z]|\.com|\.kr|dino|강남구|역삼동/iu.test(o)) bad.push(`${t} → ${o}`); }
    return { ok: !bad.length, detail: bad.length ? bad.slice(0, 2).join(' / ') : `${v.whole.length + v.partial.length}개 모두 🔒 (서버 ChatFilter 와 같은 벡터)` };
  });
  T('🔒 개인정보 가림', '쉬운 모드 채팅은 글자 입력 없이 고르기만 (kidChat)', () => {
    if (!easyOn()) return SKIP('보통 모드예요');
    if (G.settings.kidChat === false) return { ok: false, detail: '쉬운 모드인데 kidChat 이 꺼져 있어요' };
    const inputs = Array.from(document.querySelectorAll('#chat-panel input, #chat-panel textarea, #chat-form input')).filter((el) => !el.disabled && !el.readOnly && KidAudit.box(el, new Map()));
    return { ok: !inputs.length, detail: inputs.length ? `보이는 채팅 입력칸 ${inputs.length}개` : '보이는 채팅 입력칸 없음' };
  });

  // ---- phase 5 round 1: regression guards for the bug-sweep fixes (cheap; the real save is never changed)
  T('💾 저장 (G.save)', 'normalize: 잘못된 형식 고치기 (stats 글자 · 가방 배열 · 일기 null · player.x 글자 · constructor 키)', () => {
    const P = { id: 'dc_t', nickname: 'dc' };
    const n = G.save.normalize({ stats: 'x', inventory: [], journal: [null, { id: 'a' }], player: { x: 'NaN' }, visited: JSON.parse('{"constructor":1,"Z":1}') }, P);
    const empty = G.save.normalize({ inventory: {} }, P);
    const bad = [];
    if (!isObj(n.stats) || !Number.isFinite(n.stats.coin)) bad.push('stats');
    if (!isObj(n.inventory)) bad.push('가방');
    if (!isObj(empty.inventory) || Object.keys(empty.inventory).length) bad.push('다 쓴 빈 가방이 다시 채워져요');
    if (!Array.isArray(n.journal) || n.journal.length !== 1) bad.push(`일기 ${n.journal?.length}개`);
    if (!Number.isFinite(n.player?.x)) bad.push('player.x');
    if (!isObj(n.visited) || Object.prototype.hasOwnProperty.call(n.visited, 'constructor') || n.visited.Z !== 1) bad.push('visited');
    return { ok: !bad.length, detail: bad.join(' · ') || '모두 고쳐졌어요' };
  });
  T('👶 쉬운 모드', "josa '으로/로': 한옥마을로 · 밭으로 · 참가자1로 · 참가자3으로", () => {
    if (typeof G.easy?.josa !== 'function') return SKIP('G.easy.josa 가 없어요');
    const got = ['한옥마을', '밭', '참가자1', '참가자3'].map((w) => G.easy.josa(w, '으로/로'));
    return { ok: eq(got, ['한옥마을로', '밭으로', '참가자1로', '참가자3으로']), detail: got.join(' · ') };
  });
  T('👶 쉬운 모드', '보호자 확인: 기기 시계가 뒤로 가도 쉬는 시간은 5분을 넘지 않아요 (저장된 끝 시각도 줄여요)', () => {
    if (typeof G.easy?.gateStatus !== 'function') return SKIP('G.easy.gateStatus 가 없어요');
    const KEY = 'tfm.v1.gate';
    let prev;
    try { prev = localStorage.getItem(KEY); } catch (e) { return SKIP('기기 저장소를 쓸 수 없어요'); }
    try {
      localStorage.setItem(KEY, JSON.stringify({ until: Date.now() + 1e9, strikes: 0, wrong: 0, wt: 0 }));
      const left = num(G.easy.gateStatus().cooldownLeft, Infinity);
      const stored = num(JSON.parse(localStorage.getItem(KEY) || '{}').until);
      const capped = stored <= Date.now() + 300000 + 1000;
      return { ok: left <= 300000 && capped, detail: `남은 시간 ${Math.round(left / 1000)}초 · 저장된 끝 시각 ${capped ? '줄였어요' : '그대로예요'}` };
    } finally {
      try { if (prev == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch (e) { /* storage blocked */ }
    }
  });
  T('📦 데이터 불변식', '퀘스트·도감의 상호작용 대상이 모두 등록돼 있어요 (끝낼 수 없는 목표 없음)', () => {
    if (!G.interact?.list?.().length) return SKIP('상호작용 대상이 아직 등록되지 않았어요');
    const bad = Lint.run().issues.filter((i) => i.sev === 'error' && /등록되지 않았어요|개만 등록돼 있어요/.test(i.msg));
    return { ok: !bad.length, detail: bad.length ? `${bad[0].ref}: ${bad[0].msg}` : `상호작용 대상 ${G.interact.list().length}개 등록됨` };
  });
  T('👶 쉬운 모드', '퀴즈 놀이: 그림 보기 순서가 열 때마다 섞여요 (정답이 늘 첫 칸이 아니에요)', () => {
    const E = G.sys.education;
    if (typeof E?._kidOrder !== 'function') return SKIP('G.sys.education._kidOrder 가 없어요');
    const k = G.data.quizzes?.QZ_BEAN_1?.kid;
    if (!k || k.ox || !Array.isArray(k.choices)) return SKIP('QZ_BEAN_1 아이 퀴즈가 없어요');
    const n = Math.min(3, k.choices.length), want = [...Array(n).keys()].join(), slots = [];
    for (let i = 0; i < 12; i++) {
      const o = E._kidOrder('QZ_BEAN_1');
      if (!Array.isArray(o) || [...o].sort().join() !== want) return { ok: false, detail: `순서가 이상해요: ${JSON.stringify(o)}` };
      slots.push(o.indexOf(k.answer));
    }
    return { ok: slots.some((s) => s !== 0), detail: `정답 칸 ${slots.join(' ')}` };
  });
  T('🌍 월드 (G.world)', 'heightAt: 낮은 충돌체(maxY) 위에 선 사람은 그 위 · 아래에 있으면 땅 · 머리 위 들보(minY)는 막지 않아요 · 덤불(stand:false)은 발판이 아니에요', () => {
    const x = 30, z = -110, t = G.world.heightAt(x, z, Infinity);
    if (!Number.isFinite(t)) return SKIP('시험 자리의 땅 높이를 모르겠어요');
    const top = G.world.addCollider({ shape: 'box', x, z, hw: 1, hd: 1, maxY: t + 0.6, tag: 'dc-test' });
    let onTop, below, beam;
    try { onTop = G.world.heightAt(x, z, t + 1); below = G.world.heightAt(x, z, t); } finally { G.world.removeCollider(top); }
    const lid = G.world.addCollider({ shape: 'box', x, z, hw: 1, hd: 1, minY: t + 3, tag: 'dc-test' });
    try { beam = G.world.blocked(x, z, 0.35, t); } finally { G.world.removeCollider(lid); }
    // a bush / small decor (stand:false) still blocks at the ground but is never a platform
    let bushTop, bushBlocks;
    const bush = G.world.addCollider({ shape: 'circle', x, z, r: 0.8, maxY: t + 0.55, stand: false, tag: 'dc-test' });
    try { bushTop = G.world.heightAt(x, z, t + 1); bushBlocks = G.world.blocked(x, z, 0.35, t); } finally { G.world.removeCollider(bush); }
    const ok = near(onTop, t + 0.6, 1e-3) && near(below, t, 1e-3) && beam === false && near(bushTop, t, 1e-3) && bushBlocks === true;
    return { ok, detail: `위 ${(onTop - t).toFixed(2)} m · 아래 ${(below - t).toFixed(2)} m · 들보 ${beam ? '막아요 ❌' : '안 막아요'} · 덤불 위 ${(bushTop - t).toFixed(2)} m${bushBlocks ? '' : ' (안 막아요 ❌)'}` };
  });
  T('🌍 월드 (G.world)', '길 찾기: 0.1 m 난간 바로 옆에서 출발해도 길이 난간을 뚫지 않아요', () => {
    const pl = G.sys.player;
    if (typeof pl?.planPath !== 'function') return SKIP('G.sys.player.planPath 가 없어요');
    const X = 30, Z = -100, HD = 5, y = G.world.heightAt(X, Z, Infinity);
    if (!Number.isFinite(y)) return SKIP('시험 자리의 땅 높이를 모르겠어요');
    const id = G.world.addCollider({ shape: 'box', x: X, z: Z, hw: 0.05, hd: HD, rot: 0, tag: 'dc-test' });
    let path = null;
    try { path = pl.planPath({ x: X - 0.4, y, z: Z }, { x: X + 1.6, z: Z }, 0.5); } finally { G.world.removeCollider(id); }
    if (!Array.isArray(path) || path.length < 2) return { ok: false, detail: '길을 못 찾았어요' };
    // a segment crosses the rail when it changes sides of x = X between its ends while within the rail's length
    let cross = -1;
    for (let i = 1; i < path.length && cross < 0; i++) {
      const a = path[i - 1], b = path[i];
      if ((a.x - X) * (b.x - X) >= 0) continue;
      const k = (X - a.x) / (b.x - a.x), zc = a.z + (b.z - a.z) * k;
      if (Math.abs(zc - Z) <= HD + 0.05) cross = i;
    }
    return { ok: cross < 0, detail: cross < 0 ? `점 ${path.length}개 · 난간 끝으로 돌아가요` : `${cross}번째 구간이 난간을 지나요` };
  });
  T('💬 소셜', '접속 친구: 달리기 보고(anim run · 18 m/s)는 달리기로 읽어요', () => {
    const S = G.sys.social;
    if (typeof S?._remoteRow !== 'function') return SKIP('G.sys.social._remoteRow 가 없어요');
    const r = S._remoteRow({ x: 1, z: 1, anim: 'run', speed: 18 });
    return { ok: r?.loco === 'run' && r.speed === 18, detail: `loco ${r?.loco} · speed ${r?.speed}` };
  });
  T('💬 소셜', '접속 친구: 1초 동안 18 m/s 로 17~19 m 앞서 그려지고 이름표는 그대로예요 (이름 바꾸기 포함)', () => {
    const S = G.sys.social;
    if (typeof S?._upsertRemote !== 'function' || typeof S._updateRemotes !== 'function' || !G.avatar?.create || !S._vroot) return SKIP('접속 친구를 그릴 준비가 안 됐어요');
    const KEY = 'P_dc_test', X0 = 30, Z0 = -110;
    const prevSrv = S._srv;
    let o = null;
    try {
      S._srv = prevSrv || { presFirst: true }; // no "접속했어요" chat line for this stand-in
      S._upsertRemote(KEY, 'dc', { x: X0, z: Z0, anim: 'run', speed: 18, rotY: 0, nickname: '시험친구' });
      o = S.others.get(KEY);
      if (!o) return SKIP('접속 친구를 만들지 못했어요');
      const z0 = o.position.z;
      for (let i = 0; i < 30; i++) S._updateRemotes(1 / 30);
      const moved = o.position.z - z0;
      S._upsertRemote(KEY, 'dc', { x: X0, z: o.position.z, anim: 'run', speed: 18, rotY: 0, nickname: '시험친구2' });
      const tagOk = o.el && o.el.nm instanceof Element && o.el.nm.textContent === '시험친구2';
      return { ok: moved >= 17 && moved <= 19 && tagOk, detail: `${moved.toFixed(2)} m${tagOk ? '' : ' · 이름표가 망가졌어요'}` };
    } finally {
      if (o) S._removeRemote(o); else S.others.delete(KEY);
      S._srv = prevSrv;
    }
  });
  T('💬 소셜', '쉬운 모드 신고: 확인 창 제목에 다른 사람의 닉네임을 쓰지 않아요', async () => {
    const S = G.sys.social;
    if (!easyOn() || typeof S?._kidReport !== 'function' || typeof G.easy?.confirm !== 'function') return SKIP('쉬운 모드에서만 확인해요');
    if (G.ui.modal.get('easy-confirm')) return SKIP('다른 확인 창이 열려 있어요');
    const nick = '엄마몰래만나';
    const run = S._kidReport({ name: nick, kind: 'remote' });
    let title = '';
    try {
      await nextFrame();
      const el = document.querySelector('.easy-confirm-modal .ec-title');
      title = el ? G.easy.textOf(el) : '';
    } finally { G.ui.modal.get('easy-confirm')?.close(); }
    await run;
    if (!title) return SKIP('확인 창이 열리지 않았어요');
    return { ok: !title.includes(nick), detail: title };
  });
  T('⌨️ 입력', '창 안의 Tab: 끝이 아닐 땐 브라우저가 옮기고, 마지막 칸에서만 처음으로 돌아가요', async () => {
    if (G.ui.modal.isOpen?.()) return SKIP('다른 창이 열려 있어요');
    const h = G.ui.h;
    const body = h('div', null, h('button', { type: 'button', class: 'btn' }, '하나'), h('button', { type: 'button', class: 'btn' }, '둘'), h('button', { type: 'button', class: 'btn' }, '셋'));
    const m = G.ui.modal.open({ id: 'dc-tab-test', size: 'sm', title: 'Tab 시험', body, actions: [] });
    const tab = (shift) => {
      const opts = { key: 'Tab', code: 'Tab', shiftKey: !!shift, bubbles: true, cancelable: true };
      const ev = new KeyboardEvent('keydown', opts);
      window.dispatchEvent(ev);
      window.dispatchEvent(new KeyboardEvent('keyup', opts));
      return ev.defaultPrevented;
    };
    // the developer-center panel is a modal dialog too: it steps aside (inert) while the test window is on top
    const aside = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((d) => d !== m?.el && !d.inert);
    for (const d of aside) d.inert = true;
    try {
      await nextFrame(); await nextFrame();
      const root = m?.el;
      const items = root ? [...root.querySelectorAll('button')].filter((b) => b.getClientRects().length) : [];
      if (items.length < 3) return SKIP('시험 창의 버튼이 안 보여요');
      items[0].focus();
      const mid = tab(false);
      items[items.length - 1].focus();
      const wrap = tab(false), back = document.activeElement === items[0];
      return { ok: !mid && wrap && back, detail: `가운데 ${mid ? '막힘 ❌' : '통과'} · 마지막 ${wrap && back ? '처음으로' : '그대로 ❌'}` };
    } finally { for (const d of aside) d.inert = false; m?.close?.(); }
  });
  T('🎆 효과', '머리 위 이모지: 104 % 까지만 커졌다가 자리 잡아요 (튀는 반동 없음)', () => {
    const F = G.sys.fx;
    if (typeof G.fx?.emoji3d !== 'function' || typeof F?._stepEmoji !== 'function' || !F._emo) return SKIP('3D 이모지를 쓸 수 없어요 (효과 끔)');
    if (!G.fx.emoji3d(null, '🎉')) return SKIP('이모지를 띄우지 못했어요');
    const it = F._emoInst[F._emoInst.length - 1];
    let max = 0;
    try {
      for (let s = 0; s < 40; s++) {
        F._stepEmoji(1 / 60);
        const k = F._emoInst.indexOf(it);
        if (k < 0) break;
        max = Math.max(max, F._emo.iData[k * 4] / it.size);
      }
    } finally { const k = F._emoInst.indexOf(it); if (k >= 0) { F._emoInst.splice(k, 1); F._stepEmoji(0); } }
    return { ok: max > 0 && max <= 1.041, detail: `가장 클 때 ${(max * 100).toFixed(1)} %` };
  });
  T('🖱️ 상호작용', '키오스크 누르기: 화면에서 체험관 안내 키오스크를 누르면 그 키오스크가 골라져요', () => {
    const I = G.sys.interaction, E = G.sys.engine, cam = E?.camera;
    const root = G.world.getObject?.('K_HALL');
    const proxy = root?.getObjectByName?.('pick-proxy');
    if (typeof I?._pick !== 'function' || !cam || !proxy) return SKIP('키오스크가 아직 없어요');
    const c = new THREE.Vector3(); new THREE.Box3().setFromObject(proxy).getCenter(c);
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    try {
      cam.position.set(c.x, c.y + 2.2, c.z + 8);
      cam.lookAt(c);
      cam.updateMatrixWorld(true);
      const s = E.worldToScreen(c);
      if (!s.visible) return SKIP('키오스크가 화면에 안 보여요');
      const hit = I._pick(s.x, s.y);
      return { ok: hit?.entry?.id === 'K_HALL', detail: hit?.entry ? `고른 것 ${hit.entry.id}` : hit?.ground ? '땅을 골랐어요 ❌' : hit?.blocker ? '다른 물체가 가렸어요 ❌' : '아무것도 안 골라요 ❌' };
    } finally { cam.position.copy(pos); cam.quaternion.copy(quat); cam.updateMatrixWorld(true); }
  });
  T('🖥️ 렌더', '하늘 빛 다시 굽기: scene.environment 텍스처가 같은 객체로 남아요 (재질 프로그램 유지)', () => {
    const E = G.sys.engine;
    if (typeof E?.updateEnvironment !== 'function' || !E.scene) return SKIP('엔진이 없어요');
    const before = E.scene.environment;
    if (!before) return SKIP('이 품질에서는 환경 텍스처를 쓰지 않아요');
    E.updateEnvironment(true);
    return { ok: E.scene.environment === before, detail: E.scene.environment === before ? '같은 텍스처' : '새 텍스처로 바뀌었어요' };
  });
  T('🖥️ 렌더', '테두리 빛(hover): 다른 물체로 옮겨도 새 셰이더 프로그램을 만들지 않아요', () => {
    const E = G.sys.engine, r = E?.renderer;
    if (typeof E?.setOutline !== 'function' || !r?.info?.programs) return SKIP('엔진이 없어요');
    const objs = [];
    G.world.getObject?.('J1') && objs.push(G.world.getObject('J1'));
    G.world.getObject?.('K_HALL') && objs.push(G.world.getObject('K_HALL'));
    if (objs.length < 2) return SKIP('시험할 물체가 없어요');
    const prev = E._outline ? { list: E._outline.list.slice(), color: E._outline.color, strength: E._outline.strength } : null;
    try {
      E.setOutline(objs[0]); E.render({ force: true });
      const n1 = r.info.programs.length;
      E.setOutline(objs[1]); E.render({ force: true });
      const n2 = r.info.programs.length;
      return { ok: n2 === n1, detail: `프로그램 ${n1} → ${n2}` };
    } finally { if (prev && prev.list.length) E.setOutline(prev.list, { color: prev.color, strength: prev.strength }); else E.setOutline(null); }
  });
  T('🖥️ 렌더', '화면 배율: 렌더러 픽셀 비율 = min(기기 배율, 품질 상한) · 등불 빛 크기도 같은 배율', () => {
    const E = G.sys.engine, r = E?.renderer;
    if (!r || !E.preset) return SKIP('엔진이 없어요');
    const want = Math.min(Number(window.devicePixelRatio) > 0 ? Number(window.devicePixelRatio) : 1, E.preset.pixelRatio);
    const pr = r.getPixelRatio();
    const u = G.sys.props?.glow?.material?.uniforms?.uScale?.value;
    const glowOk = u == null || near(u, window.innerHeight * 0.5 * pr, 0.5);
    return { ok: near(pr, want, 1e-6) && glowOk && Array.isArray(E._cull?.items ?? []), detail: `배율 ${pr} (기대 ${want})${u == null ? '' : ` · 등불 ${Math.round(u)}${glowOk ? '' : ' ❌'}`}` };
  });
  T('🖥️ 렌더', '사진: GPU 화면을 잃었을 때 찍으면 빈 사진을 앨범에 넣지 않아요', async () => {
    const P = G.sys.photo, gl = G.sys.engine?.renderer?.getContext?.();
    if (typeof P?.capture !== 'function' || !gl || !G.state) return SKIP('사진 기능을 시험할 수 없어요');
    if (P.active || P._busy) return SKIP('사진 모드가 열려 있어요');
    const n = Array.isArray(G.state.photos) ? G.state.photos.length : 0;
    const toast = G.ui.toast;
    let res;
    P.active = true;
    gl.isContextLost = () => true;
    G.ui.toast = () => null;
    try { res = P.capture(); } finally { delete gl.isContextLost; P.active = false; G.ui.toast = toast; }
    const out = await res;
    const n2 = Array.isArray(G.state.photos) ? G.state.photos.length : 0;
    return { ok: out == null && n2 === n, detail: out == null ? `찍지 않았어요 · 앨범 ${n2}장 그대로` : '사진을 찍었어요 ❌' };
  });

  const Tests = {
    result: null, running: false, live: null,
    count: () => TESTS.length,
    async runAll(opts = {}) {
      if (this.running) return this._promise;
      this.running = true;
      const t0 = perf();
      const results = [];
      this.live = { results, done: 0, total: TESTS.length };
      this._promise = (async () => {
        let lastGroup = '';
        for (const t of TESTS) {
          if (t.group !== lastGroup) { lastGroup = t.group; opts.onProgress?.(this.live); await U.nextFrame(); }
          const s = perf();
          let status = 'fail', detail = '';
          try {
            const r = await t.fn();
            if (r && typeof r === 'object' && r.skip) { status = 'skip'; detail = r.detail || ''; }
            else if (r && typeof r === 'object' && 'ok' in r) { status = r.ok ? 'pass' : 'fail'; detail = r.detail || ''; }
            else status = r ? 'pass' : 'fail';
          } catch (e) { status = 'fail'; detail = `예외: ${String(e?.message || e).slice(0, 160)}`; }
          results.push({ group: t.group, name: t.name, status, detail: String(detail).slice(0, 240), ms: perf() - s });
          this.live.done++;
        }
        const r = {
          at: now(), ms: perf() - t0, total: results.length,
          passed: results.filter((x) => x.status === 'pass').length,
          failed: results.filter((x) => x.status === 'fail').length,
          skipped: results.filter((x) => x.status === 'skip').length,
          results,
        };
        this.result = r;
        this.running = false;
        this.live = null;
        G.log.info('DEV', `self test: ${r.passed}/${r.total} passed, ${r.failed} failed, ${r.skipped} skipped (${r.ms.toFixed(0)} ms)`);
        G.bus.emit('dev:tests', { passed: r.passed, failed: r.failed, total: r.total });
        return r;
      })();
      try { return await this._promise; } catch (e) { this.running = false; this.live = null; throw e; }
    },
  };

  // =========================================================================== diagnostics collectors
  function glInfo() {
    const r = G.sys.engine?.renderer;
    if (!r) return null;
    if (glInfo._c) return glInfo._c;
    const gl = r.getContext();
    const caps = r.capabilities || {};
    const P = (k) => { try { const v = gl.getParameter(gl[k]); return v && typeof v === 'object' && 'length' in v ? Array.from(v).join(' × ') : v; } catch (e) { return null; } };
    let vendor = null, renderer = null;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) { vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL); renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL); }
    } catch (e) { /* masked */ }
    const isGL2 = caps.isWebGL2 !== false && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const attrs = (() => { try { return gl.getContextAttributes() || {}; } catch (e) { return {}; } })();
    const info = {
      version: isGL2 ? 'WebGL 2' : 'WebGL 1', webgl1: typeof WebGLRenderingContext !== 'undefined', webgl2: typeof WebGL2RenderingContext !== 'undefined',
      glVersion: P('VERSION'), shading: P('SHADING_LANGUAGE_VERSION'), vendor: vendor || P('VENDOR'), renderer: renderer || P('RENDERER'), unmasked: !!renderer,
      maxTexture: P('MAX_TEXTURE_SIZE'), maxCube: P('MAX_CUBE_MAP_TEXTURE_SIZE'), maxRenderbuffer: P('MAX_RENDERBUFFER_SIZE'), maxViewport: P('MAX_VIEWPORT_DIMS'),
      maxAttribs: P('MAX_VERTEX_ATTRIBS'), maxVUniforms: P('MAX_VERTEX_UNIFORM_VECTORS'), maxFUniforms: P('MAX_FRAGMENT_UNIFORM_VECTORS'),
      maxTexUnits: P('MAX_TEXTURE_IMAGE_UNITS'), maxCombinedUnits: P('MAX_COMBINED_TEXTURE_IMAGE_UNITS'),
      maxSamples: isGL2 ? P('MAX_SAMPLES') : null, max3D: isGL2 ? P('MAX_3D_TEXTURE_SIZE') : null, maxDrawBuffers: isGL2 ? P('MAX_DRAW_BUFFERS') : null,
      anisotropy: caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : caps.maxAnisotropy, precision: caps.precision, logDepth: !!caps.logarithmicDepthBuffer,
      antialias: !!attrs.antialias, powerPreference: attrs.powerPreference || '-', alpha: !!attrs.alpha,
      extensions: (gl.getSupportedExtensions?.() || []).slice().sort(),
    };
    glInfo._c = info;
    return info;
  }
  function rendererStats() {
    const r = G.sys.engine?.renderer;
    if (!r) return null;
    const i = r.info || {};
    return { calls: i.render?.calls || 0, triangles: i.render?.triangles || 0, points: i.render?.points || 0, lines: i.render?.lines || 0, geometries: i.memory?.geometries || 0, textures: i.memory?.textures || 0, programs: (i.programs || []).length, frame: i.render?.frame || 0 };
  }
  function cspInfo() {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const content = m?.getAttribute('content') || '';
    const dirs = {};
    for (const part of content.split(';')) { const p = part.trim(); if (!p) continue; const [k, ...v] = p.split(/\s+/); dirs[k] = v; }
    const scripts = dirs['script-src'] || [];
    const checks = [
      ['CSP 메타 태그', !!m, m ? '빌드가 넣은 정책이 있어요' : '없음 — 빌드된 파일인지 확인하세요'],
      ['default-src none', (dirs['default-src'] || []).includes("'none'"), (dirs['default-src'] || []).join(' ') || '-'],
      ['스크립트는 해시로만 실행', scripts.length > 0 && scripts.every((s) => s.startsWith("'sha256-")), `${scripts.length}개 해시`],
      ['eval 금지 (unsafe-eval 없음)', !content.includes('unsafe-eval'), content.includes('unsafe-eval') ? '허용됨' : '차단'],
      ['플러그인 금지 (object-src none)', (dirs['object-src'] || []).includes("'none'"), (dirs['object-src'] || []).join(' ') || '-'],
      ['외부 연결 차단 (connect-src self)', (dirs['connect-src'] || []).every((s) => s === "'self'"), (dirs['connect-src'] || []).join(' ') || '-'],
      ['base 태그 금지', (dirs['base-uri'] || []).includes("'none'"), (dirs['base-uri'] || []).join(' ') || '-'],
      ['리퍼러 숨김 (no-referrer)', document.querySelector('meta[name="referrer"]')?.getAttribute('content') === 'no-referrer', document.querySelector('meta[name="referrer"]')?.getAttribute('content') || '-'],
    ];
    return { present: !!m, dirs, checks, violations: Probe.csp.slice(), violationCount: Probe.cspCount };
  }
  function lsUsage() {
    const rows = [];
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k == null) continue;
        const v = localStorage.getItem(k) || '';
        const bytes = (k.length + v.length) * 2;
        total += bytes;
        let kind = '기타', emoji = '📦';
        if (/^tfm\.v1\.save\..+\.bak$/.test(k)) { kind = '저장 백업'; emoji = '🗄️'; }
        else if (/^tfm\.v1\.save\./.test(k)) { kind = '게임 저장'; emoji = '💾'; }
        else if (k === 'tfm.v1.accounts') { kind = '로컬 계정 (비밀번호 해시 · 내용 비공개)'; emoji = '🔐'; }
        else if (k === 'tfm.v1.settings') { kind = '기기 설정'; emoji = '⚙️'; }
        else if (k === 'tfm.v1.profiles') { kind = '최근 플레이 목록'; emoji = '🧑'; }
        else if (/^tfm\.v1\.dev\./.test(k)) { kind = '개발자 센터'; emoji = '🛠️'; }
        else if (/^tfm\./.test(k)) { kind = '게임 환경값'; emoji = '🎮'; }
        rows.push({ key: k, bytes, kind, emoji });
      }
    } catch (e) { return { rows: [], total: 0, blocked: true }; }
    rows.sort((a, b) => b.bytes - a.bytes);
    return { rows, total, blocked: false };
  }
  function stateSize() {
    if (!G.state) return 0;
    try { return JSON.stringify(G.state, (k, v) => (k.startsWith('_') ? undefined : v)).length * 2; } catch (e) { return 0; }
  }
  function browserInfo() {
    const n = navigator;
    const mm = (q) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
    const AC = window.AudioContext || window.webkitAudioContext;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let voices = [];
    try { voices = window.speechSynthesis?.getVoices?.() || []; } catch (e) { voices = []; }
    const mem = performance.memory;
    return {
      ua: n.userAgent, platform: n.userAgentData?.platform || n.platform || '-', mobile: n.userAgentData?.mobile ?? /Mobi|Android/i.test(n.userAgent),
      brands: (n.userAgentData?.brands || []).map((b) => `${b.brand} ${b.version}`).join(', '), language: (n.languages || [n.language]).join(', '),
      timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return '-'; } })(),
      cores: n.hardwareConcurrency || '-', memory: n.deviceMemory ? `${n.deviceMemory} GB 이상` : '알 수 없음', dpr: window.devicePixelRatio || 1,
      screen: `${screen.width} × ${screen.height}`, viewport: `${innerWidth} × ${innerHeight}`, colorDepth: screen.colorDepth,
      touch: n.maxTouchPoints || 0, coarse: mm('(pointer: coarse)'), hover: mm('(hover: hover)'), touchUI: !!G.input?.touchUI,
      online: n.onLine, cookies: n.cookieEnabled, secure: !!window.isSecureContext, isolated: !!window.crossOriginIsolated, protocol: location.protocol,
      reducedMotion: mm('(prefers-reduced-motion: reduce)'), dark: mm('(prefers-color-scheme: dark)'),
      audio: !!AC, audioState: G.sys.audio?.debug?.()?.state || (AC ? '대기 (첫 입력 후 시작)' : '-'),
      speech: !!window.speechSynthesis, voices: voices.length, koVoices: voices.filter((v) => /^ko/i.test(v.lang)).length, recognition: !!SR,
      subtle: !!(window.crypto && window.crypto.subtle), randomValues: !!window.crypto?.getRandomValues, storageApi: !!n.storage?.estimate,
      heap: mem ? `${kb(mem.usedJSHeapSize)} / ${kb(mem.jsHeapSizeLimit)}` : null,
      pointer: !!window.PointerEvent, fullscreen: !!document.fullscreenEnabled, webp: (() => { try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch (e) { return false; } })(),
    };
  }
  async function storageEstimate() {
    const out = { usage: null, quota: null, persisted: null };
    try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; } } catch (e) { /* unsupported */ }
    try { if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) { /* unsupported */ }
    return out;
  }
  const publicApi = (sys) => Object.keys(sys).filter((k) => typeof sys[k] === 'function' && !k.startsWith('_') && !['init', 'postInit', 'onStateLoaded', 'onLogout', 'update'].includes(k)).sort();
  function moduleRows() {
    const list = G.systems ? G.systems() : [];
    const errs = G.__systemErrors || [];
    const rows = list.map((s) => {
      const e = errs.filter((x) => x.system === s.name);
      const status = s._failed ? 'failed' : s._updateDisabled ? 'disabled' : s._initialized ? 'ok' : 'pending';
      return { name: s.name, order: s.order, label: s.label || '', status, api: publicApi(s), errors: e, hasUpdate: typeof s.update === 'function' };
    });
    const names = new Set(list.map((s) => s.name));
    const missing = EXPECTED_SYSTEMS.filter((n) => !names.has(n));
    return { rows, missing };
  }
  function errorSummary() {
    const sys = G.__systemErrors || [], frag = G.__fragmentErrors || [];
    const consoleErrors = Probe.errors.filter((e) => e.level !== 'warn');
    return { system: sys.length, fragment: frag.length, console: consoleErrors.length, warnings: Probe.warnCount, csp: Probe.cspCount, total: sys.length + frag.length + consoleErrors.length };
  }

  function health() {
    const mods = moduleRows();
    const failed = mods.rows.filter((r) => r.status === 'failed').length;
    const disabled = mods.rows.filter((r) => r.status === 'disabled').length;
    const err = errorSummary();
    const lint = Lint.get();
    const tests = Tests.result;
    const fps = fpsStats();
    let score = 100;
    const reasons = [];
    const minus = (n, why) => { if (n > 0) { score -= n; reasons.push(`${why} −${Math.round(n)}`); } };
    minus(failed * 15, `실패한 시스템 ${failed}개`);
    minus(disabled * 8, `업데이트가 멈춘 시스템 ${disabled}개`);
    minus(mods.missing.length * 3, `없는 시스템 ${mods.missing.length}개`);
    minus(Math.min(24, (err.system + err.fragment) * 6), `시스템·조각 오류 ${err.system + err.fragment}건`);
    minus(Math.min(10, err.console * 2), `콘솔 오류 ${err.console}건`);
    minus(Math.min(10, err.csp * 2), `CSP 위반 ${err.csp}건`);
    minus(Math.min(20, lint.counts.error * 5), `데이터 오류 ${lint.counts.error}건`);
    minus(Math.min(8, lint.counts.warn), `데이터 경고 ${lint.counts.warn}건`);
    if (tests) minus(Math.min(25, tests.failed * 5), `테스트 실패 ${tests.failed}건`);
    if (fps.cur && fps.cur < 15) minus(4, `낮은 FPS (${fps.cur})`);
    const K = KidAudit.last;
    if (K) { minus(Math.min(15, K.counts.critical * 3), `어린이 사용성 치명 ${K.counts.critical}건`); minus(Math.min(5, Math.floor(K.counts.warn / 5)), `어린이 사용성 경고 ${K.counts.warn}건`); }
    const Gs = Gpu.last;
    if (Gs && !Gs.ok) minus(8, 'GPU 안전 문제 (노멀·NaN·후처리)');
    if (Gpu.nan && !Gpu.nan.skip && !Gpu.nan.ok) minus(10, 'NaN 주입 테스트 실패');
    score = Math.round(clamp(score, 0, 100));
    const grade = score >= 90 ? { label: '아주 건강해요', emoji: '🟢', tone: 'ok', mood: 'cheer' } : score >= 75 ? { label: '양호해요', emoji: '🟢', tone: 'ok', mood: 'happy' } : score >= 50 ? { label: '살펴볼 곳이 있어요', emoji: '🟡', tone: 'warn', mood: 'think' } : { label: '점검이 필요해요', emoji: '🔴', tone: 'bad', mood: 'surprised' };
    return { score, grade, reasons, modules: { total: mods.rows.length, ok: mods.rows.filter((r) => r.status === 'ok').length, failed, disabled, missing: mods.missing }, errors: err, lint: lint.counts, tests: tests ? { passed: tests.passed, failed: tests.failed, skipped: tests.skipped, total: tests.total } : null, fps, kids: K ? { score: K.score, ...K.counts } : null, gpu: Gs ? { ok: Gs.ok, nan: Gpu.nan ? (Gpu.nan.skip ? 'skip' : Gpu.nan.ok) : null } : null };
  }

  // =========================================================================== report (JSON + Markdown)
  async function buildReport() {
    if (!Tests.result && !Tests.running) await Tests.runAll();
    else if (Tests.running) await Tests._promise;
    const lint = Lint.run();
    const B = window.__BUILD__ || {};
    const est = await storageEstimate();
    const mods = moduleRows();
    const acc = access();
    const st = G.state;
    return {
      app: 'tfm-metaverse', kind: 'diagnostic-report', generatedAt: new Date().toISOString(),
      build: { version: B.version || G.VERSION, builtAt: B.builtAt || null, three: B.three || null, threeRevision: THREE.REVISION, fragments: B.fragments ?? (G.__fragments || []).length, fontEmbedded: !!B.manifest?.fontEmbedded },
      runtime: { mode: G.net?.mode || 'local', access: acc.reason, uptimeSec: Math.round((now() - Probe.bootAt) / 1000), url: location.protocol + '//' + location.host + location.pathname, flags: { ...G.flags }, quality: G.sys.engine?.quality || null, loggedIn: !!G.app?.loggedIn, profileKind: G.auth?.current?.kind || null, role: G.auth?.current?.role || null },
      health: health(),
      system: { browser: browserInfo(), webgl: (() => { const g = glInfo(); return g ? { ...g, extensions: g.extensions.length } : null; })(), renderer: rendererStats(), storage: { ...est, localStorageBytes: lsUsage().total, stateBytes: stateSize() }, csp: (() => { const c = cspInfo(); return { present: c.present, checks: c.checks.map(([k, ok, v]) => ({ check: k, ok, value: v })), violations: c.violations }; })() },
      modules: mods.rows.map((r) => ({ name: r.name, order: r.order, label: r.label, status: r.status, api: r.api.length, errors: r.errors.length })), missingSystems: mods.missing,
      errors: { system: (G.__systemErrors || []).map((e) => ({ system: e.system, phase: e.phase, message: String(e.message).slice(0, 800) })), fragment: (G.__fragmentErrors || []).map((e) => ({ name: e.name, message: String(e.message).slice(0, 800) })), console: Probe.errors.slice(-50) },
      dataLint: { counts: lint.counts, byCategory: lint.byCat, entities: lint.entities, issues: lint.issues.slice(0, 400) },
      tests: Tests.result ? { passed: Tests.result.passed, failed: Tests.result.failed, skipped: Tests.result.skipped, total: Tests.result.total, ms: Math.round(Tests.result.ms), results: Tests.result.results.map((r) => ({ ...r, ms: +r.ms.toFixed(2) })) } : null,
      events: [...Probe.bus.entries()].sort((a, b) => b[1].emits - a[1].emits).slice(0, 60).map(([name, r]) => ({ name, emits: r.emits, listeners: G.bus.count?.(name) || 0 })),
      save: st ? { version: st.version, savedAt: st.savedAt || null, bytes: stateSize(), level: st.stats?.level, quests: Object.keys(st.quests || {}).length, journal: (st.journal || []).length, photos: (st.photos || []).length } : null,
      kids: (() => {
        const e = easyStatus();
        const live = KidAudit.plain(KidAudit.run({ keep: true }));
        // texts on screen may carry the nickname: the report keeps kinds, selectors and sizes only
        live.items = live.items.map(({ text, ...x }) => x);
        const tour = Tour.plain(Tour.result);
        if (tour) for (const r of tour.rows) if (r.audit) r.audit.items = r.audit.items.slice(0, 40).map(({ text, ...x }) => x);
        return { status: { ...e, sayLog: e.sayLog.length, gateLog: e.gateLog.slice(-10) }, live, tour };
      })(),
      gpu: { scan: Gpu.last && now() - Gpu.last.at < 10000 ? Gpu.last : Gpu.scan(), nan: Gpu.plainNan(Gpu.nan) },
      manifest: B.manifest || null,
    };
  }
  function reportMarkdown(r) {
    const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').slice(0, 300);
    const L = [];
    const h = r.health;
    L.push(`# 전통발효체험관 메타버스 — 진단 보고서`, '');
    L.push(`- 생성: ${r.generatedAt}`, `- 버전: v${r.build.version} · 빌드 ${r.build.builtAt || '-'} · three.js r${r.build.threeRevision} (${r.build.three || '-'})`, `- 모드: ${r.runtime.mode === 'server' ? '서버' : '로컬'} · 그래픽 ${r.runtime.quality || '-'} · 접근 ${r.runtime.access}`, '');
    L.push(`## 건강 점수: ${h.score}/100 ${h.grade.emoji} ${h.grade.label}`, '');
    for (const x of h.reasons) L.push(`- ${x}`);
    if (!h.reasons.length) L.push('- 감점 항목 없음');
    L.push('', '| 항목 | 값 |', '|---|---|');
    L.push(`| 시스템 | ${h.modules.ok}/${h.modules.total} 정상, 실패 ${h.modules.failed}, 업데이트 중지 ${h.modules.disabled} |`);
    L.push(`| 오류 | 시스템 ${h.errors.system} · 조각 ${h.errors.fragment} · 콘솔 ${h.errors.console} · CSP ${h.errors.csp} |`);
    L.push(`| 데이터 검사 | 오류 ${h.lint.error} · 경고 ${h.lint.warn} · 참고 ${h.lint.info} |`);
    L.push(`| 자가 테스트 | ${h.tests ? `${h.tests.passed}/${h.tests.total} 통과, 실패 ${h.tests.failed}, 건너뜀 ${h.tests.skipped}` : '실행 안 함'} |`);
    L.push(`| FPS | 현재 ${h.fps.cur} · 평균 ${h.fps.avg} · 최소 ${h.fps.min} |`);
    if (h.kids) L.push(`| 👶 쉬운 모드 점검 | 아이 점수 ${h.kids.score} · 치명 ${h.kids.critical} · 경고 ${h.kids.warn} · 참고 ${h.kids.info} |`);
    if (h.gpu) L.push(`| 🖥️ GPU 안전 | ${h.gpu.ok ? '✅' : '⛔'} · NaN 테스트 ${h.gpu.nan === null ? '실행 안 함' : h.gpu.nan === 'skip' ? '건너뜀' : h.gpu.nan ? '통과' : '실패'} |`);
    L.push('', '## 시스템 환경', '', '| 항목 | 값 |', '|---|---|');
    const b = r.system.browser;
    for (const [k, v] of [['브라우저', b.ua], ['플랫폼', b.platform], ['CPU 코어', b.cores], ['메모리', b.memory], ['화면 / DPR', `${b.screen} @${b.dpr}`], ['보안 컨텍스트', b.secure ? '예' : '아니오'], ['WebGL', r.system.webgl ? `${r.system.webgl.version} · ${r.system.webgl.renderer}` : '-'], ['최대 텍스처', r.system.webgl?.maxTexture], ['draw calls', r.system.renderer?.calls], ['저장 크기', kb(r.system.storage.stateBytes)]]) L.push(`| ${cell(k)} | ${cell(v)} |`);
    L.push('', '## 모듈', '', '| 순서 | 시스템 | 상태 | API | 오류 |', '|---|---|---|---|---|');
    for (const m of r.modules) L.push(`| ${m.order} | ${cell(m.name)} (${cell(m.label)}) | ${m.status} | ${m.api} | ${m.errors} |`);
    if (r.missingSystems.length) L.push('', `없는 시스템: ${r.missingSystems.join(', ')}`);
    const errs = [...r.errors.system.map((e) => `[${e.system}/${e.phase}] ${e.message}`), ...r.errors.fragment.map((e) => `[조각 ${e.name}] ${e.message}`)];
    L.push('', '## 오류', '');
    if (errs.length) { L.push('```text'); for (const e of errs) L.push(e.replace(/```/g, "'''").slice(0, 800)); L.push('```'); } else L.push('- 시스템·조각 오류 없음');
    L.push('', '## 데이터 검사', '', '| 분류 | 오류 | 경고 | 참고 | 검사 수 |', '|---|---|---|---|---|');
    for (const [c, v] of Object.entries(r.dataLint.byCategory)) L.push(`| ${LINT_CATS[c]?.label || c} | ${v.error} | ${v.warn} | ${v.info} | ${v.checked} |`);
    const top = r.dataLint.issues.filter((i) => i.sev !== 'info').slice(0, 60);
    if (top.length) { L.push(''); for (const i of top) L.push(`- ${SEV[i.sev].emoji} **${cell(i.ref)}** ${cell(i.msg)}`); }
    L.push('', '## 자가 테스트', '');
    if (r.tests) { L.push(`${r.tests.passed}/${r.tests.total} 통과 · 실패 ${r.tests.failed} · 건너뜀 ${r.tests.skipped} · ${r.tests.ms} ms`, '', '| 결과 | 그룹 | 테스트 | 비고 |', '|---|---|---|---|'); for (const t of r.tests.results) L.push(`| ${t.status === 'pass' ? '✅' : t.status === 'skip' ? '⏭️' : '❌'} | ${cell(t.group)} | ${cell(t.name)} | ${cell(t.detail)} |`); }
    else L.push('- 실행 안 함');
    const K = r.kids;
    if (K) {
      const e = K.status, a = K.live;
      L.push('', '## 👶 쉬운 모드 점검', '');
      L.push(`- 모드: ${e.on ? '쉬운 모드' : '보통 모드'} · 누르기 최소 ${e.tap}px · 화면 ${a.viewport} · 아이 점수 ${a.score}/100`);
      L.push(`- G.easy: ${e.present ? `있음 (API ${e.api.filter((x) => x.ok).length}/${e.api.length}${e.api.some((x) => !x.ok) ? `, 없음: ${e.api.filter((x) => !x.ok).map((x) => x.k).join(', ')}` : ''})` : '없음'} · 읽어주기 ${e.voiceGuide ? '켬' : '끔'} · 보호자 확인 ${e.parentGate ? '켬' : '끔'} · 아이 채팅 ${e.kidChat ? '고르기만' : '자유 입력'} · 개인정보 가림(maskPII) ${e.maskPII ? '있음' : '없음'}`);
      L.push('', '| 종류 | ⛔ 치명 | ⚠️ 경고 | 💡 참고 |', '|---|---|---|---|');
      for (const [k, m] of Object.entries(KID_KINDS)) { const v = a.byKind[k]; if (v.critical || v.warn || v.info) L.push(`| ${m.emoji} ${m.label} | ${v.critical} | ${v.warn} | ${v.info} |`); }
      L.push(`| **합계** | **${a.counts.critical}** | **${a.counts.warn}** | **${a.counts.info}** |`);
      const top = a.items.filter((x) => x.sev !== 'info').slice(0, 30);
      if (top.length) { L.push(''); for (const x of top) L.push(`- ${KID_SEV[x.sev].emoji} ${KID_KINDS[x.kind].emoji} ${cell(x.detail)} — \`${cell(x.sel)}\``); }
      if (K.tour) {
        L.push('', `### 🎬 화면별 점검 (${K.tour.easy ? '쉬운 모드' : '보통 모드'}, ${K.tour.viewport})`, '', '| 화면 | 상태 | ⛔ | ⚠️ | 💡 | 점수 |', '|---|---|---|---|---|---|');
        for (const row of K.tour.rows) L.push(`| ${row.emoji} ${cell(row.label)} | ${row.status === 'ok' ? '✅' : row.status === 'skip' ? `⏭️ ${cell(row.note)}` : `⛔ ${cell(row.note)}`} | ${row.audit ? row.audit.counts.critical : '-'} | ${row.audit ? row.audit.counts.warn : '-'} | ${row.audit ? row.audit.counts.info : '-'} | ${row.audit ? row.audit.score : '-'} |`);
      }
    }
    const Gs = r.gpu?.scan;
    if (Gs) {
      L.push('', '## 🖥️ GPU 안전 (검은 사각형 방지)', '', '| 항목 | 값 |', '|---|---|');
      L.push(`| 길이 0·NaN 노멀 | ${Gs.badNormals} (엔진이 고친 누적 ${Gs.repaired}) |`, `| NaN 정점 위치 | ${Gs.nanPositions} |`, `| 납작한 메시 / 인스턴스 | ${Gs.flat.length} / ${Gs.flatInstances} |`);
      L.push(`| 후처리 순서 | ${Gs.passes.composer ? `${Gs.passes.list.map((x) => x.name).join(' → ')} ${Gs.passes.ok ? '✅' : '⛔'}` : '블룸 꺼짐 (후처리 없음)'} |`);
      const n = r.gpu.nan;
      L.push(`| NaN 주입 테스트 | ${n ? (n.skip ? `⏭️ ${cell(n.detail)}` : `${n.ok ? '✅' : '⛔'} ${cell(n.detail)}`) : '실행 안 함'} |`);
    }
    L.push('', '## 빌드 매니페스트', '', '| 파일 | 줄 | 크기 | sha |', '|---|---|---|---|');
    for (const f of [...(r.manifest?.js || []), ...(r.manifest?.css || [])]) L.push(`| ${cell(f.name)} | ${f.lines} | ${kb(f.bytes)} | \`${cell(f.sha)}\` |`);
    if (r.manifest?.skipped?.length) { L.push('', '빌드에서 빠진 조각:'); for (const s of r.manifest.skipped) L.push(`- ${cell(s.name)}: ${cell(s.reason)}`); }
    L.push('', '---', '', '> 이 보고서에는 비밀번호 해시·CSRF 토큰·이메일·닉네임·저장 내용을 넣지 않아요 (콘솔 기록은 그대로 들어가니 공유 전에 한 번 훑어보세요). 전체 기계 판독 데이터는 같은 이름의 .json 보고서를 보세요.', '');
    return L.join('\n');
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // =========================================================================== cheats (the single place for debug tools)
  const CheatLog = {
    list() { const l = store.get(LS.log, []); return Array.isArray(l) ? l.filter((x) => x && typeof x.cmd === 'string').slice(-50) : []; },
    push(e) { const l = this.list(); l.push(e); store.set(LS.log, l.slice(-50)); },
    clear() { store.del(LS.log); },
  };
  const CHEAT_LABEL = {
    coin: '💰 코인 +1,000', exp: '✨ 경험치 +500', edu: '📘 교육 포인트 +50', seeds: '🌱 씨앗 모두 ×5', ingredients: '🧂 재료·작물 ×5', decor: '🏮 꾸미기 아이템 ×1',
    save: '💾 즉시 저장', objective: '🎯 현재 목표 완료', claimall: '🎁 완료 보상 모두 받기', tutorial: '🧭 튜토리얼 다시',
    grow: '🌾 작물 100% 성장', water: '💧 밭 물 100%', ffwd: '⏩ 10분 빨리 감기', ferment: '🏺 내 장독 발효 완료', ferment1: '⏱️ 발효 +1분',
    weather: '🌤️ 날씨', hour: '🕐 시간', autoWeather: '🔁 자동 날씨', lockTime: '⏸️ 시간 멈춤', tp: '📍 순간이동',
    colliders: '🧱 충돌체 보기', fps: '⚡ FPS 표시', quality: '🖥️ 그래픽 품질', easy: '👶 쉬운 모드 켜기/끄기',
    fxConfetti: '🎉 축하 파티클', fxCoins: '🪙 코인 연출', fxStamp: '✅ 완료 도장', fxLevel: '⭐ 레벨업 연출', mascot: '🏺 옹이 한마디',
  };
  const NEEDS_STATE = new Set(['coin', 'exp', 'edu', 'seeds', 'ingredients', 'decor', 'save', 'objective', 'claimall', 'tutorial', 'grow', 'water', 'ffwd', 'ferment', 'ferment1', 'tp', 'fxCoins', 'fxLevel', 'fxConfetti']);
  const Cheats = {
    colliders: false,
    serverConfirmed: false,
    /** returns {ok, msg, close?} ; never throws */
    run(cmd, arg) {
      const label = CHEAT_LABEL[cmd] || cmd;
      const a = access();
      if (!a.ok) return { ok: false, msg: '권한이 없어 디버그 도구를 쓸 수 없어요.' };
      if (NEEDS_STATE.has(cmd) && !G.state) return { ok: false, msg: '게임에 입장한 뒤에 쓸 수 있어요.' };
      let res;
      try { res = this._run(cmd, arg) || { ok: true, msg: label }; } catch (e) { G.log.error('DEV', `cheat ${cmd} failed`, e); res = { ok: false, msg: `실행하지 못했어요: ${String(e?.message || e).slice(0, 80)}` }; }
      const argText = arg == null ? '' : String(arg).slice(0, 24);
      G.log.info('DEV', `cheat ${cmd}${argText ? `(${argText})` : ''} -> ${res.ok ? 'ok' : 'fail'}`);
      CheatLog.push({ t: now(), cmd, arg: argText, ok: !!res.ok, mode: G.net?.mode || 'local' });
      return res;
    },
    _run(cmd, arg) {
      const st = G.state, S = G.sys;
      const P = S.progression, I = S.inventory, Q = S.quest, Fm = S.farming, J = S.fermentation, W = S.weather;
      const giveTypes = (types, n) => {
        let k = 0;
        for (const [id, it] of Object.entries(G.data.items || {})) {
          if (!types.includes(it.type)) continue;
          if (I?.add) I.add(id, n, { source: 'debug', silent: true }); else st.inventory[id] = (Number(st.inventory[id]) || 0) + n;
          k++;
        }
        G.dirty('debug');
        return k;
      };
      switch (cmd) {
        case 'coin': if (P?.addCoin) P.addCoin(1000); else { st.stats.coin = num(st.stats.coin) + 1000; G.dirty('debug'); } return { ok: true, msg: '코인 +1,000 🪙' };
        case 'exp': if (P?.addExp) P.addExp(500); else { st.stats.exp = num(st.stats.exp) + 500; G.dirty('debug'); } return { ok: true, msg: '경험치 +500 ✨' };
        case 'edu': if (P?.addEdu) P.addEdu(50); else { st.stats.edu = num(st.stats.edu) + 50; G.dirty('debug'); } return { ok: true, msg: '교육 포인트 +50 📘' };
        case 'seeds': return { ok: true, msg: `씨앗 ${giveTypes(['seed'], 5)}종을 5개씩 넣었어요 🌱` };
        case 'ingredients': return { ok: true, msg: `재료·작물 ${giveTypes(['ingredient', 'crop'], 5)}종을 5개씩 넣었어요 🧂` };
        case 'decor': return { ok: true, msg: `꾸미기 아이템 ${giveTypes(['decoration'], 1)}종을 1개씩 넣었어요 🏮` };
        case 'save': G.save.save({ reason: 'manual', notify: true }); return { ok: true, msg: '저장을 요청했어요 💾', silent: true };
        case 'objective': {
          if (!Q) return { ok: false, msg: '퀘스트 시스템이 없어요.' };
          if (typeof Q.debugCompleteObjective === 'function') { Q.debugCompleteObjective(); return { ok: true, msg: '현재 목표를 완료했어요 🎯' }; }
          const f = Q.focus?.();
          if (f?.mode === 'objective' && f.questId != null && f.objective >= 0) {
            const o = G.data.quests?.[f.questId]?.objectives?.[f.objective];
            if (o && typeof Q._advance === 'function') { Q._advance(f.questId, f.objective, 0, null, { set: o.count || 1 }); return { ok: true, msg: `목표 완료: ${o.text || ''}` }; }
          }
          if (f?.mode === 'claim') { Q.claim?.(f.questId); return { ok: true, msg: '완료된 퀘스트 보상을 받았어요 🎁' }; }
          if (f?.mode === 'giver') { Q.accept?.(f.questId); return { ok: true, msg: '새 퀘스트를 수락했어요 📜' }; }
          return { ok: false, msg: '진행 중인 목표가 없어요.' };
        }
        case 'claimall': {
          let n = 0;
          for (const id of Object.keys(G.data.quests || {})) if (Q?.status?.(id) === 'completed' && Q.claim?.(id)) n++;
          return n ? { ok: true, msg: `보상 ${n}개를 받았어요 🎁` } : { ok: false, msg: '받을 보상이 없어요.' };
        }
        case 'tutorial': {
          st.tutorial = { step: 0, done: false };
          G.dirty('tutorial');
          if (G.flags.noTutorial) return { ok: false, msg: '주소에 notutorial=1 이 있어 튜토리얼이 꺼져 있어요.' };
          G.app?.onboarding?.start?.(0);
          return { ok: true, msg: '튜토리얼을 처음부터 다시 시작해요 🧭', close: true };
        }
        case 'grow': if (Fm?.growAll) { Fm.growAll(100); return { ok: true, msg: '모든 작물을 다 키웠어요 🌾' }; } return { ok: false, msg: '농장 시스템이 없어요.' };
        case 'water': {
          if (!Fm?.setPlot) return { ok: false, msg: '농장 시스템이 없어요.' };
          for (const id of Fm.plotIds?.() || Object.keys(st.farm?.plots || {})) Fm.setPlot(id, { water: 100, health: 100 });
          return { ok: true, msg: '모든 밭에 물을 듬뿍 줬어요 💧' };
        }
        case 'ffwd': {
          const a = Fm?.fastForward ? (Fm.fastForward(600), 1) : 0;
          const b = J?.fastForward ? (J.fastForward(600), 1) : 0;
          return a || b ? { ok: true, msg: '밭과 장독의 시간을 10분 앞당겼어요 ⏩' } : { ok: false, msg: '농장·발효 시스템이 없어요.' };
        }
        case 'ferment': {
          if (!J?.setJar) return { ok: false, msg: '발효 시스템이 없어요.' };
          const s = st.jars?.J1;
          if (!s?.recipeId || s.status === 'CLAIMED' || s.status === 'EMPTY') return { ok: false, msg: '내 장독(J1)에 진행 중인 발효가 없어요.' };
          J.setJar('J1', { progress: 100 });
          return { ok: true, msg: '내 장독의 발효를 완료했어요 🏺' };
        }
        case 'ferment1': if (J?.fastForward) { J.fastForward(60); return { ok: true, msg: '발효 시간을 1분 앞당겼어요 ⏱️' }; } return { ok: false, msg: '발효 시스템이 없어요.' };
        case 'weather': {
          if (!W?.set) return { ok: false, msg: '날씨 시스템이 없어요.' };
          const id = String(arg || '').toUpperCase();
          if (!has(G.data.weather, id)) return { ok: false, msg: '알 수 없는 날씨예요.' };
          if (G.settings.autoWeather) W.setAuto?.(false);
          W.set(id, { source: 'debug' });
          return { ok: true, msg: `날씨: ${G.data.weather[id].name} (자동 날씨 꺼짐)` };
        }
        case 'hour': {
          const h = Number(arg);
          if (!W?.setHour || !Number.isFinite(h) || h < 0 || h >= 24) return { ok: false, msg: '시간을 바꿀 수 없어요.' };
          W.setHour(h);
          return { ok: true, msg: `시간: ${W.timeString?.() || h}` };
        }
        case 'autoWeather': if (!W?.setAuto) return { ok: false, msg: '날씨 시스템이 없어요.' }; W.setAuto(!G.settings.autoWeather); return { ok: true, msg: `자동 날씨 ${G.settings.autoWeather ? '켜짐' : '꺼짐'}` };
        case 'lockTime': if (!W?.setLockTime) return { ok: false, msg: '날씨 시스템이 없어요.' }; W.setLockTime(!G.settings.lockTime); return { ok: true, msg: `시간 흐름 ${G.settings.lockTime ? '멈춤' : '재개'}` };
        case 'tp': {
          const id = String(arg || '');
          const z = G.world.zoneById?.(id) || (G.data.pois || []).find((p) => p.id === id);
          if (!z) return { ok: false, msg: '알 수 없는 장소예요.' };
          if (S.minimap?.travelTo) S.minimap.travelTo(id);
          else if (S.player?.teleport) { const c = z.center || [z.x, z.z]; S.player.teleport(c[0], c[1] + 3); }
          else return { ok: false, msg: '이동할 수 없어요.' };
          return { ok: true, msg: `${z.name || id}(으)로 이동해요 📍`, close: true };
        }
        case 'colliders': this.colliders = !this.colliders; G.world.debugDraw?.(this.colliders); return { ok: true, msg: `충돌체 보기 ${this.colliders ? '켜짐 (빨강=충돌, 파랑=발판)' : '꺼짐'}` };
        case 'fps': G.setSetting('showFps', !G.settings.showFps); return { ok: true, msg: `FPS 표시 ${G.settings.showFps ? '켜짐' : '꺼짐'}` };
        case 'easy': {
          const want = !easyOn();
          setEasy(want).then((on) => { toast(on === want ? (on ? '쉬운 모드 켜짐 👶' : '보통 모드 🧑 (쉬운 모드 꺼짐)') : '보호자 확인을 통과하지 않아 그대로예요', on === want ? 'success' : 'info', '👶'); if (ui.opened && !ui.away && ui.tab === 'debug') render(); });
          return { ok: true, msg: '', silent: true };
        }
        case 'quality': {
          if (!['low', 'medium', 'high', 'auto'].includes(arg)) return { ok: false, msg: '알 수 없는 품질이에요.' };
          G.setSetting('quality', arg);
          return { ok: true, msg: `그래픽 품질: ${({ low: '낮음', medium: '중간', high: '높음', auto: '자동' })[arg]}` };
        }
        case 'fxConfetti': {
          if (!G.fx?.burst) return { ok: false, msg: '연출 모듈이 없어요.' };
          const p = S.player?.position;
          if (p) G.fx.burst({ x: p.x, y: p.y + 1.6, z: p.z }, { type: 'confetti', count: 60 });
          G.fx.pulse?.('#f4c54a');
          return { ok: true, msg: '축하 파티클! 🎉', close: true };
        }
        case 'fxCoins': if (!G.fx?.coinFly) return { ok: false, msg: '연출 모듈이 없어요.' }; G.fx.coinFly({ x: innerWidth / 2, y: innerHeight / 2 }, 100, { holdHud: false }); return { ok: true, msg: '코인 연출 (지급 없음) 🪙', close: true };
        case 'fxStamp': if (!G.fx?.stamp) return { ok: false, msg: '연출 모듈이 없어요.' }; G.fx.stamp('완료!', { color: '#34c36b' }); return { ok: true, msg: '도장 연출 ✅', close: true };
        case 'fxLevel': if (!G.fx?.levelUp) return { ok: false, msg: '연출 모듈이 없어요.' }; G.fx.levelUp(num(st.stats?.level, 1)); return { ok: true, msg: '레벨업 연출 미리보기 (실제 레벨은 그대로) ⭐', close: true };
        case 'mascot': {
          if (!G.mascot?.say) return { ok: false, msg: '마스코트 모듈이 없어요.' };
          const hint = G.mascot.hint?.() || '안녕하세요! 저는 옹이예요 🏺';
          G.mascot.say(typeof hint === 'string' ? hint : hint.text, { mood: 'wink', force: true });
          return { ok: true, msg: '옹이가 한마디 해요 🏺', close: true };
        }
        default: return { ok: false, msg: '알 수 없는 명령이에요.' };
      }
    },
  };

  // =========================================================================== UI
  const TABS = [
    { id: 'overview', emoji: '📊', label: '개요', desc: '건강 점수 · 빌드 정보 · 실행 환경 한눈에 보기' },
    { id: 'system', emoji: '🖥️', label: '시스템 점검', desc: '브라우저 · WebGL/GPU · GPU 안전(검은 사각형 방지) · 렌더러 · 보안(CSP) · 저장소 · 미디어 API' },
    { id: 'kids', emoji: '👶', label: '쉬운 모드 점검', desc: '아이 눈높이 점검: 누르기 크기 · 글자 입력칸 · 겹침 · 대비 · 읽어주기 · 보호자 확인 · 주요 화면 차례로 점검' },
    { id: 'modules', emoji: '🧩', label: '모듈 상태', desc: '시스템 초기화 순서 · 공개 API · 오류 · 빌드 조각 목록' },
    { id: 'data', emoji: '🔍', label: '데이터 검증', desc: 'G.data 교차 참조 검사 — 퀘스트·도감·상점·대화·배치·교육' },
    { id: 'save', emoji: '💾', label: '저장 데이터', desc: '현재 상태 트리 · 내보내기/가져오기/초기화 · 저장소 키 · 로컬 계정' },
    { id: 'server', emoji: '🌐', label: '서버 점검', desc: 'PHP API 연결 · 세션 · 관리자 상태 점검 · 응답 시간' },
    { id: 'tests', emoji: '🧪', label: '자가 테스트', desc: '실제 저장을 건드리지 않는 브라우저 안 단위 테스트' },
    { id: 'debug', emoji: '🛠️', label: '디버그 도구', desc: '자원 · 퀘스트 · 농장/발효 · 날씨/시간 · 순간이동 · 표시 · 연출 미리보기' },
    { id: 'source', emoji: '🗂️', label: '소스 구조', desc: '파일 지도(담당·역할·크기) · 이벤트 흐름 지도' },
    { id: 'docs', emoji: '📚', label: '문서', desc: '빌드에 포함된 README · 아키텍처 · 계약서 · 인수인계 · 서버 문서' },
    { id: 'handover', emoji: '🤝', label: '인수인계', desc: '인수인계 체크리스트 · 어디를 고치면 되나요?' },
  ];
  const TAB_IDS = new Set(TABS.map((t) => t.id));
  const TAB_ALIAS = { dashboard: 'overview', stats: 'overview', admin: 'overview', home: 'overview', health: 'server', test: 'tests', cheats: 'debug', cheat: 'debug', tools: 'debug', files: 'source', events: 'source', doc: 'docs', readme: 'docs', checklist: 'handover', lint: 'data', storage: 'save', saves: 'save', env: 'system', modules: 'modules', kid: 'kids', easy: 'kids', audit: 'kids', child: 'kids', a11y: 'kids', gpu: 'system' };
  const normTab = (t) => { const s = String(t || '').toLowerCase(); return TAB_IDS.has(s) ? s : TAB_ALIAS[s] || null; };
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  const ui = {
    root: null, body: null, title: null, sub: null, emoji: null, fps: null, pop: null, layer: null,
    tab: 'overview', opened: false, prevFocus: null, dialog: null,
    docs: null, docCache: new Map(), docId: null, docQuery: '',
    srv: { running: false, results: null, health: null, at: 0, err: '' },
    lint: { sev: 'all', cat: 'all', q: '' }, modQ: '', srcQ: '', evQ: '',
    kid: { sev: 'all', kind: 'all', view: 'live', sayN: -1, gateN: -1 }, away: false, gating: null,
  };
  const toast = (msg, type = 'info', emoji) => G.ui?.toast?.(msg, { type, emoji, sound: type !== 'info' });
  const yes = (v, y = '예', n = '아니오') => (v ? `<span class="dc-yes">✅ ${y}</span>` : `<span class="dc-no">— ${n}</span>`);
  const pill = (tone, text) => `<span class="dc-pill dc-pill-${tone}">${text}</span>`;
  const kvRows = (rows) => rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  const mono = (s) => `<code class="dc-mono">${esc(s)}</code>`;
  const kindLabel = (k) => ({ guest: '게스트', local: '로컬 계정', server: '서버 계정' })[k] || '계정';
  const mascot = (mood, size = 72) => { try { return G.mascot?.svg?.(mood, size, { bob: !reduceMotion() }) || ''; } catch (e) { return ''; } };
  const emptyBox = (text, mood = 'happy') => `<div class="dc-empty"><div class="dc-empty-art">${mascot(mood, 64) || '🏺'}</div><p>${esc(text)}</p></div>`;
  const STATUS = {
    ok: { tone: 'ok', text: '✅ 정상' }, failed: { tone: 'bad', text: '⛔ 초기화 실패' }, disabled: { tone: 'warn', text: '⚠️ 업데이트 중지' },
    pending: { tone: 'skip', text: '⏳ 초기화 전' }, missing: { tone: 'bad', text: '❔ 없음' },
  };
  function sparkline(series, w = 132, h = 34) {
    if (!series.length) return '';
    const max = Math.max(60, ...series);
    const step = series.length > 1 ? w / (series.length - 1) : w;
    const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="dc-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // ---------------------------------------------------------------- shell
  function build() {
    if (ui.root) return;
    const B = window.__BUILD__ || {};
    const root = document.createElement('div');
    root.id = 'devcenter';
    root.className = 'dc-root';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'dc-brand-title');
    root.innerHTML = `
      <div class="dc-shell">
        <aside class="dc-side">
          <div class="dc-brand">
            <div class="dc-brand-art" aria-hidden="true">${mascot('wink', 52) || '🏺'}</div>
            <div class="dc-brand-text"><small>DEV CENTER</small><b id="dc-brand-title">개발자 점검·인수인계 센터</b><span class="dc-ver">v${esc(B.version || G.VERSION)} · three r${esc(THREE.REVISION)}</span></div>
          </div>
          <nav class="dc-nav" role="tablist" aria-orientation="vertical" aria-label="개발자 센터 메뉴">
            ${TABS.map((t) => `<button type="button" role="tab" class="dc-nav-btn" id="dc-tab-${t.id}" data-dc="tab" data-tab="${t.id}" aria-controls="dc-body" aria-selected="false" tabindex="-1" title="${esc(t.desc)}"><span class="dc-nav-emoji" aria-hidden="true">${t.emoji}</span><span class="dc-nav-label">${esc(t.label)}</span><span class="dc-nav-badge" hidden></span></button>`).join('')}
          </nav>
          <div class="dc-side-foot">
            <div class="dc-access"></div>
            <button type="button" class="btn btn-gold btn-sm btn-block" data-dc="report-menu"><span class="ico ico-sm" data-icon="download"></span>진단 보고서 다운로드</button>
            <div class="dc-keys"><kbd>Esc</kbd> 닫기 <kbd>F9</kbd> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd></div>
          </div>
        </aside>
        <main class="dc-main">
          <header class="dc-head">
            <div class="dc-head-title"><span class="dc-head-emoji" aria-hidden="true"></span><div class="dc-head-text"><h2 class="dc-h2"></h2><p class="dc-head-sub"></p></div></div>
            <div class="dc-head-tools">
              <span class="dc-fps-chip" title="현재 FPS">⚡ <b>-</b> FPS</span>
              <button type="button" class="dc-icon dc-only-mobile" data-dc="report-menu" title="진단 보고서" aria-label="진단 보고서 다운로드"><span class="ico" data-icon="download"></span></button>
              <button type="button" class="dc-icon" data-dc="refresh" title="새로고침" aria-label="새로고침"><span class="ico" data-icon="refresh"></span></button>
              <button type="button" class="dc-icon dc-close" data-dc="close" title="닫기 (Esc)" aria-label="개발자 센터 닫기"><span class="ico" data-icon="x"></span></button>
            </div>
          </header>
          <div class="dc-body" id="dc-body" role="tabpanel" tabindex="-1"></div>
        </main>
      </div>
      <div class="dc-pop" role="menu" hidden></div>
      <div class="dc-layer" hidden></div>
      <input type="file" accept=".json,application/json" data-dc-file="import" hidden>`;
    G.ui.hydrateIcons(root);
    (document.getElementById('app') || document.body).appendChild(root);
    ui.root = root;
    ui.body = root.querySelector('.dc-body');
    ui.title = root.querySelector('.dc-h2');
    ui.sub = root.querySelector('.dc-head-sub');
    ui.emoji = root.querySelector('.dc-head-emoji');
    ui.fps = root.querySelector('.dc-fps-chip b');
    ui.pop = root.querySelector('.dc-pop');
    ui.layer = root.querySelector('.dc-layer');

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('pointerdown', (e) => { if (!ui.pop.hidden && !ui.pop.contains(e.target) && !e.target.closest('[data-dc="report-menu"]')) closePop(); });
  }

  function onKeydown(e) {
    const passThrough = e.code === 'Escape' || e.code === 'F9' || (e.code === 'Backquote' && !isTypingEl(e.target)) || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyD');
    if (e.key === 'Tab') {
      const scope = ui.dialog || ui.root;
      const f = Array.from(scope.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (f.length) {
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    }
    const navBtn = e.target.closest?.('.dc-nav-btn');
    if (navBtn && ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const btns = Array.from(ui.root.querySelectorAll('.dc-nav-btn'));
      let i = btns.indexOf(navBtn);
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = btns.length - 1;
      else i = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
      btns[i].focus();
      setTab(btns[i].dataset.tab);
    }
    if (e.key === '/' && !isTypingEl(e.target)) {
      const s = ui.body.querySelector('[data-dc-search]');
      if (s) { e.preventDefault(); s.focus(); s.select?.(); }
    }
    if (!passThrough) e.stopPropagation(); // keep game hotkeys (H, I, J, WASD …) out while the center is open
  }

  function closePop() { if (ui.pop && !ui.pop.hidden) { ui.pop.hidden = true; ui.pop.innerHTML = ''; } }
  function openReportMenu(anchor) {
    if (!ui.pop.hidden) { closePop(); return; }
    ui.pop.innerHTML = `<div class="dc-pop-title">📥 진단 보고서</div>
      <button type="button" role="menuitem" data-dc="report" data-fmt="md">📄 마크다운 (.md) <small>사람이 읽기 좋은 요약</small></button>
      <button type="button" role="menuitem" data-dc="report" data-fmt="json">🧾 JSON (.json) <small>도구·이슈 첨부용 원본</small></button>
      <button type="button" role="menuitem" data-dc="report" data-fmt="both">📦 둘 다 받기</button>
      <p class="dc-pop-note">비밀번호 해시·CSRF 토큰·이메일·저장 내용은 넣지 않아요.</p>`;
    ui.pop.hidden = false;
    const r = anchor.getBoundingClientRect(), pr = ui.pop.getBoundingClientRect();
    const x = clamp(r.right - pr.width, 8, innerWidth - pr.width - 8);
    let y = r.bottom + 8;
    if (y + pr.height > innerHeight - 8) y = Math.max(8, r.top - pr.height - 8);
    ui.pop.style.left = `${x}px`; ui.pop.style.top = `${y}px`;
    ui.pop.querySelector('button')?.focus();
  }

  /** in-panel confirm (the center sits above G.ui modals, so their confirm would be hidden) */
  function confirmBox({ title, message, okText = '확인', cancelText = '취소', danger = false, emoji = '❓' }) {
    return new Promise((resolve) => {
      closeDialog(false);
      const prev = document.activeElement;
      const box = document.createElement('div');
      box.className = 'dc-dialog';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<div class="dc-dialog-emoji" aria-hidden="true">${esc(emoji)}</div><h3></h3><p></p><div class="dc-dialog-actions"><button type="button" class="btn btn-ghost" data-v="0"></button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1"></button></div>`;
      box.querySelector('h3').textContent = title || '확인';
      box.querySelector('p').textContent = message || '';
      box.querySelector('[data-v="0"]').textContent = cancelText;
      box.querySelector('[data-v="1"]').textContent = okText;
      ui.layer.innerHTML = '';
      ui.layer.appendChild(box);
      ui.layer.hidden = false;
      const done = (v) => { if (ui.dialog !== box) return; ui.dialog = null; ui.layer.hidden = true; ui.layer.innerHTML = ''; try { prev?.focus?.(); } catch (e) { /* ignore */ } resolve(v); };
      box._done = done;
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
      ui.layer.onclick = null;
      ui.dialog = box;
      setTimeout(() => box.querySelector(danger ? '[data-v="0"]' : '[data-v="1"]')?.focus(), 20);
    });
  }
  function closeDialog(v = false) { if (ui.dialog) ui.dialog._done?.(v); }

  // ---------------------------------------------------------------- open / close / tabs
  function setTab(id, opts = {}) {
    const t = normTab(id) || 'overview';
    const changed = t !== ui.tab;
    ui.tab = t;
    store.set(LS.tab, t);
    if (ui.opened) render({ scrollTop: changed || opts.scrollTop });
  }
  function render(opts = {}) {
    if (!ui.root) return;
    const t = TABS.find((x) => x.id === ui.tab) || TABS[0];
    ui.title.textContent = t.label;
    ui.sub.textContent = t.desc;
    ui.emoji.textContent = t.emoji;
    let activeBtn = null;
    for (const b of ui.root.querySelectorAll('.dc-nav-btn')) {
      const on = b.dataset.tab === t.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) activeBtn = b;
    }
    // keep the active tab visible in the (mobile) horizontal strip
    try { activeBtn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old browsers */ }
    ui.body.setAttribute('aria-labelledby', `dc-tab-${t.id}`);
    const keepScroll = opts.scrollTop ? 0 : ui.body.scrollTop;
    try { RENDER[t.id](ui.body); }
    catch (e) {
      G.log.error('DEV', `render ${t.id} failed`, e);
      ui.body.innerHTML = `<div class="dc-empty"><p>⛔ 이 화면을 그리지 못했어요.</p><pre class="dc-pre">${esc(String(e?.stack || e).slice(0, 1200))}</pre></div>`;
    }
    G.ui.hydrateIcons(ui.body);
    ui.body.scrollTop = keepScroll;
    if (opts.scrollTop !== false && opts.scrollTop) ui.body.scrollTop = 0;
    if (!reduceMotion()) { ui.body.classList.remove('dc-anim'); void ui.body.offsetWidth; ui.body.classList.add('dc-anim'); }
    countUp(ui.body);
    badges();
    access2Side();
    // a re-render may remove the focused control: keep keyboard focus inside the center (game hotkeys stay out)
    const ae = document.activeElement;
    if (!ui.dialog && (!ae || ae === document.body || !ui.root.contains(ae))) { try { activeBtn?.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function countUp(scope) {
    const els = scope.querySelectorAll('[data-countup]');
    if (!els.length) return;
    if (reduceMotion()) return;
    const t0 = perf(), dur = 700;
    const targets = Array.from(els).map((el) => ({ el, v: Number(el.dataset.countup) || 0 }));
    const step = () => {
      const k = clamp((perf() - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      for (const x of targets) x.el.textContent = String(Math.round(x.v * e));
      if (k < 1 && ui.opened) requestAnimationFrame(step); else for (const x of targets) x.el.textContent = String(x.v);
    };
    requestAnimationFrame(step);
  }
  function badges() {
    if (!ui.root) return;
    const set = (tab, text, tone) => {
      const b = ui.root.querySelector(`#dc-tab-${tab} .dc-nav-badge`);
      if (!b) return;
      if (text == null || text === '') { b.hidden = true; return; }
      b.hidden = false; b.textContent = String(text); b.dataset.tone = tone;
    };
    const mods = moduleRows();
    const bad = mods.rows.filter((r) => r.status === 'failed' || r.status === 'disabled').length + mods.missing.length;
    set('modules', bad || '', 'bad');
    const L = Lint.result;
    set('data', L ? (L.counts.error || L.counts.warn || '') : '', L?.counts.error ? 'bad' : 'warn');
    const T2 = Tests.result;
    set('tests', Tests.running ? '…' : T2 ? (T2.failed ? T2.failed : '✓') : '', T2?.failed ? 'bad' : 'ok');
    const err = errorSummary();
    set('overview', err.total ? err.total : '', 'bad');
    set('handover', (() => { const c = handoverProgress(); return c.done === c.total ? '✓' : `${c.done}/${c.total}`; })(), 'info');
    const K = KidAudit.last;
    set('kids', K ? (K.counts.critical || K.counts.warn || '✓') : '', K?.counts.critical ? 'bad' : K?.counts.warn ? 'warn' : 'ok');
    const Gs = Gpu.last;
    if (Gs && (!Gs.ok || (Gpu.nan && !Gpu.nan.ok && !Gpu.nan.skip))) set('system', '!', 'bad');
  }
  function access2Side() {
    const el = ui.root?.querySelector('.dc-access');
    if (!el) return;
    const a = access();
    el.innerHTML = `<span class="dc-dot ${G.net?.mode === 'server' ? 'srv' : ''}"></span><span>${G.net?.mode === 'server' ? '🌐 서버 모드' : '💻 로컬 모드'}</span><small>${esc(a.label)}</small>`;
  }

  /**
   * Open the center. In easy mode a child must not wander in: the parent gate (G.easy.gate, CONTRACT §12.4) runs
   * first and the result is awaited (returns a Promise then). Automation passes {gate:false}. A failing gate keeps
   * the center closed (kid safety first); grown-ups can switch easy mode off or open it from the console.
   */
  function open(tab, opts = {}) {
    if (!access().ok) return openNow(tab, opts);
    if (ui.opened || opts.gate === false || typeof G.easy?.gate !== 'function' || !easyOn() || G.settings?.parentGate === false) return openNow(tab, opts);
    if (ui.gating) return ui.gating;
    ui.gating = Promise.resolve()
      .then(() => G.easy.gate({ reason: 'devcenter', title: '개발자 센터는 어른만 열 수 있어요' }))
      .then((ok) => { ui.gating = null; if (ok === true) return openNow(tab, opts); G.log.info('DEV', 'dev center: parent gate not passed'); return false; },
        (e) => { ui.gating = null; G.log.warn('DEV', 'parent gate failed — dev center stays closed', e); toast('보호자 확인을 열지 못했어요. 잠시 후 다시 해 주세요.', 'warn', '🔒'); return false; });
    return ui.gating;
  }
  function openNow(tab, opts = {}) {
    const a = access();
    if (!a.ok) {
      toast('개발자 센터는 서버 관리자 계정이나 서버 PC(localhost)의 ?dev=1 주소에서만 열 수 있어요.', 'warn', '🔒');
      G.log.warn('DEV', 'dev center access denied');
      return false;
    }
    build();
    const t = normTab(tab) || (ui.opened ? ui.tab : normTab(store.get(LS.tab, 'overview')) || 'overview');
    ui.tab = t;
    if (!ui.opened) {
      ui.prevFocus = document.activeElement;
      ui.opened = true;
      ui.root.hidden = false;
      document.body.classList.add('dc-open');
      G.ui.block('devcenter');
      try { G.ui.popover?.close?.(); } catch (e) { /* ignore */ }
      if (!Lint.result) Lint.run();
      G.log.info('DEV', `dev center open (${a.reason}) tab=${t}`);
      G.sfx('open');
    }
    render({ scrollTop: true });
    setTimeout(() => { if (ui.opened && !ui.dialog) ui.root?.querySelector('.dc-nav-btn.active')?.focus({ preventScroll: true }); }, 30);
    if (opts.auto) G.log.info('DEV', 'opened automatically (?dev=1)');
    return true;
  }
  function close() {
    if (!ui.opened) return false;
    closeDialog(false);
    closePop();
    Spot.hide(true);
    if (Tour.running) Tour.stop = true;
    ui.away = false;
    ui.opened = false;
    ui.root.hidden = true;
    document.body.classList.remove('dc-open');
    G.ui.unblock('devcenter');
    const pf = ui.prevFocus;
    ui.prevFocus = null;
    try { if (pf && pf.isConnected && pf !== document.body) pf.focus({ preventScroll: true }); else document.querySelector('#game-container canvas')?.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    G.sfx('close');
    return true;
  }

  // ---------------------------------------------------------------- live refresh (2 Hz while open)
  function live() {
    if (!ui.opened) return;
    const f = Math.round(num(G.sys.engine?.fps));
    if (ui.fps && ui.fps.textContent !== String(f)) { ui.fps.textContent = String(f); ui.fps.parentElement.dataset.tone = f >= 45 ? 'ok' : f >= 25 ? 'warn' : 'bad'; }
    LIVE[ui.tab]?.(ui.body);
  }
  const setText = (scope, sel, text) => { const el = scope.querySelector(sel); if (el && el.textContent !== text) el.textContent = text; };
  const LIVE = {
    overview(b) {
      const fps = fpsStats();
      setText(b, '[data-live="fps"]', String(fps.cur));
      setText(b, '[data-live="fps-sub"]', `평균 ${fps.avg} · 최소 ${fps.min} · 최대 ${fps.max}`);
      const sp = b.querySelector('[data-live="spark"]');
      if (sp) sp.innerHTML = sparkline(fps.series);
      setText(b, '[data-live="uptime"]', U.formatDuration((now() - Probe.bootAt) / 1000));
    },
    system(b) {
      const r = rendererStats();
      if (!r) return;
      setText(b, '[data-live="calls"]', fmt(r.calls));
      setText(b, '[data-live="tris"]', fmt(r.triangles));
      setText(b, '[data-live="geo"]', fmt(r.geometries));
      setText(b, '[data-live="tex"]', fmt(r.textures));
      setText(b, '[data-live="prog"]', fmt(r.programs));
      setText(b, '[data-live="sfps"]', `${Math.round(num(G.sys.engine?.fps))} FPS`);
    },
    debug(b) {
      const box = b.querySelector('[data-live="dbg"]');
      if (!box) return;
      const p = G.sys.player?.position;
      const zone = p ? G.world.zoneAt?.(p.x, p.z) : null;
      const r = rendererStats();
      const W = G.sys.weather;
      const items = [
        `📍 ${p ? `${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}` : '-'}`,
        `🗺️ ${zone?.name || '-'}`,
        `⚡ ${Math.round(num(G.sys.engine?.fps))} FPS · ${G.sys.engine?.quality || '-'}`,
        `🎨 ${fmt(r?.calls || 0)} draw · ${fmt(Math.round((r?.triangles || 0) / 1000))}k tri`,
        `🌤️ ${G.data.weather?.[W?.current]?.name || W?.current || '-'} · ${typeof W?.timeString === 'function' ? W.timeString() : '-'}`,
        `👥 ${fmt(G.sys.social?.online || 1)}명 · ${G.save?.adapter?.name || '-'}`,
      ];
      const spans = box.children;
      if (spans.length !== items.length) { box.textContent = ''; for (const t of items) { const s = document.createElement('span'); s.textContent = t; box.appendChild(s); } }
      else for (let i = 0; i < items.length; i++) if (spans[i].textContent !== items[i]) spans[i].textContent = items[i];
    },
    tests(b) { if (Tests.running) renderTestProgress(b); },
    kids(b) {
      if (KidLog.say.length === ui.kid.sayN && KidLog.gate.length === ui.kid.gateN) return;
      ui.kid.sayN = KidLog.say.length; ui.kid.gateN = KidLog.gate.length;
      const box = b.querySelector('[data-live="kidlog"]');
      if (box) box.innerHTML = kidLogHtml();
    },
  };

  // ---------------------------------------------------------------- tab renderers
  const RENDER = {};

  RENDER.overview = (b) => {
    const H = health();
    const B = window.__BUILD__ || {};
    const C = 2 * Math.PI * 52;
    const fps = H.fps;
    const err = H.errors;
    const st = G.state;
    const cur = G.auth?.current;
    const bubble = H.score >= 90 ? '모든 시스템이 건강해요! 오늘도 순조로운 발효 중이에요 🌿' : H.score >= 75 ? '대체로 좋아요. 아래 카드에서 조금만 살펴봐 주세요 🙂' : H.score >= 50 ? '살펴볼 곳이 있어요. 빨간 카드부터 눌러 볼까요? 🔎' : '점검이 필요해요! 모듈 상태와 오류부터 확인해요 🚨';
    const card = (tab, emoji, label, value, sub, tone, extra = '') => `<button type="button" class="dc-stat" data-dc="goto" data-tab="${tab}" data-tone="${tone}"><span class="dc-stat-emoji" aria-hidden="true">${emoji}</span><span class="dc-stat-label">${esc(label)}</span><b class="dc-stat-value">${value}</b><span class="dc-stat-sub">${sub}</span>${extra}</button>`;
    const testsCard = H.tests ? card('tests', '🧪', '자가 테스트', `<span data-countup="${H.tests.passed}">${H.tests.passed}</span><small>/${H.tests.total}</small>`, `실패 ${H.tests.failed} · 건너뜀 ${H.tests.skipped}`, H.tests.failed ? 'bad' : 'ok')
      : card('tests', '🧪', '자가 테스트', '<small>실행 전</small>', `${Tests.count()}개 테스트 준비됨 · 눌러서 실행`, 'info');
    const recent = [
      ...(G.__systemErrors || []).map((e) => ({ k: `${e.system} · ${e.phase}`, m: e.message })),
      ...(G.__fragmentErrors || []).map((e) => ({ k: `조각 ${e.name}`, m: e.message })),
      ...Probe.errors.filter((e) => e.level !== 'warn').slice(-6).map((e) => ({ k: `콘솔 · ${ago(e.at)}`, m: e.msg })),
    ].slice(-6).reverse();
    b.innerHTML = `
      <section class="dc-hero dc-in" data-tone="${H.grade.tone}" style="--i:0">
        <div class="dc-gauge" role="img" aria-label="건강 점수 ${H.score}점">
          <svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="dc-g-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e3a8"/><stop offset="1" stop-color="#f4c54a"/></linearGradient></defs>
            <circle cx="60" cy="60" r="52" class="dc-gauge-bg"/><circle cx="60" cy="60" r="52" class="dc-gauge-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - H.score / 100)).toFixed(1)}" style="--c:${C.toFixed(1)}"/></svg>
          <div class="dc-gauge-num"><b data-countup="${H.score}">${H.score}</b><small>/ 100</small></div>
        </div>
        <div class="dc-hero-text">
          <div class="dc-eyebrow">HEALTH SCORE · 건강 점수</div>
          <h3>${H.grade.emoji} ${esc(H.grade.label)}</h3>
          <p class="dc-reasons">${H.reasons.length ? H.reasons.map((r) => `<span class="chip">${esc(r)}</span>`).join(' ') : '<span class="chip chip-green">감점 항목 없음 🎉</span>'}</p>
          <div class="dc-row wrap">
            <button type="button" class="btn btn-primary btn-sm" data-dc="run-tests">🧪 자가 테스트 실행</button>
            <button type="button" class="btn btn-soft btn-sm" data-dc="relint">🔍 데이터 다시 검사</button>
            <button type="button" class="btn btn-soft btn-sm" data-dc="goto" data-tab="debug">🛠️ 디버그 도구</button>
            <button type="button" class="btn btn-gold btn-sm" data-dc="report-menu">📥 진단 보고서</button>
          </div>
        </div>
        <div class="dc-hero-mascot" aria-hidden="true">${mascot(H.grade.mood, 88)}<div class="dc-bubble">${esc(bubble)}</div></div>
      </section>
      <div class="dc-cards">
        ${card('modules', '🧩', '모듈', `<span data-countup="${H.modules.ok}">${H.modules.ok}</span><small>/${H.modules.total}</small>`, `실패 ${H.modules.failed} · 멈춤 ${H.modules.disabled}${H.modules.missing.length ? ` · 없음 ${H.modules.missing.length}` : ''}`, H.modules.failed || H.modules.missing.length ? 'bad' : H.modules.disabled ? 'warn' : 'ok')}
        ${card('modules', '🐞', '오류', `<span data-countup="${err.total}">${err.total}</span>`, `시스템 ${err.system} · 조각 ${err.fragment} · 콘솔 ${err.console} · 경고 ${err.warnings}`, err.total ? 'bad' : err.warnings ? 'warn' : 'ok')}
        ${card('data', '🔍', '데이터 검증', `<span data-countup="${H.lint.error}">${H.lint.error}</span><small> 오류</small>`, `경고 ${H.lint.warn} · 참고 ${H.lint.info}`, H.lint.error ? 'bad' : H.lint.warn ? 'warn' : 'ok')}
        ${testsCard}
        ${card('system', '⚡', 'FPS', `<span data-live="fps">${fps.cur}</span>`, `<span data-live="fps-sub">평균 ${fps.avg} · 최소 ${fps.min} · 최대 ${fps.max}</span>`, fps.cur >= 45 ? 'ok' : fps.cur >= 25 ? 'warn' : 'bad', `<span class="dc-stat-spark" data-live="spark">${sparkline(fps.series)}</span>`)}
        ${card('save', '💾', '저장 데이터', st ? kb(stateSize()) : '<small>로그인 전</small>', st ? `마지막 저장 ${esc(ago(G.save?.lastSavedAt || st.savedAt))}${G.save?.dirty ? ' · 변경 있음' : ''}` : '게임에 입장하면 보여요', st ? 'ok' : 'info')}
      </div>
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:2"><h4>🏗️ 빌드 정보</h4><dl class="dc-kv">${kvRows([
          ['버전', `<b>v${esc(B.version || G.VERSION)}</b>`],
          ['빌드 시각', esc(B.builtAt ? dateTime(Date.parse(B.builtAt)) : '개발 빌드')],
          ['three.js', `r${esc(THREE.REVISION)} <span class="muted">(${esc(B.three || '-')})</span>`],
          ['JS 조각', `${fmt(B.manifest?.js?.length ?? (G.__fragments || []).length)}개 · ${kb((B.manifest?.js || []).reduce((n, f) => n + f.bytes, 0))}`],
          ['CSS 파일', `${fmt(B.manifest?.css?.length || 0)}개 · ${kb((B.manifest?.css || []).reduce((n, f) => n + f.bytes, 0))}`],
          ['빌드 제외 조각', (B.manifest?.skipped || []).length ? pill('bad', `${B.manifest.skipped.length}개`) : pill('ok', '없음')],
          ['글꼴 내장', yes(B.manifest?.fontEmbedded, '내장', '시스템 글꼴')],
          ['내장 문서', `${fmt(Object.keys(loadDocs()).length)}개`],
        ])}</dl></section>
        <section class="dc-card dc-in" style="--i:3"><h4>🧭 실행 환경</h4><dl class="dc-kv">${kvRows([
          ['모드', G.net?.mode === 'server' ? `🌐 서버 <span class="muted">(API v${esc(G.net.serverInfo?.version || '?')} · ${esc(G.net.serverInfo?.db || '?')})</span>` : '💻 로컬 (이 브라우저에 저장)'],
          ['접근 권한', esc(access().label)],
          ['프로필', cur ? `${esc(kindLabel(cur.kind))} · ${cur.role === 'admin' ? pill('gold', '관리자') : '사용자'}` : '<span class="muted">로그인 전</span>'],
          ['그래픽 품질', `${esc(G.sys.engine?.preset?.label || G.sys.engine?.quality || '-')} <span class="muted">(설정: ${esc(G.settings?.quality || 'auto')})</span>`],
          ['URL 플래그', Object.entries(G.flags || {}).filter(([, v]) => v).map(([k, v]) => mono(v === true ? k : `${k}=${v}`)).join(' ') + (DEV_PARAM ? ` ${mono('dev')}` : '') || '<span class="muted">없음</span>'],
          ['실행 시간', `<span data-live="uptime">${esc(U.formatDuration((now() - Probe.bootAt) / 1000))}</span>`],
          ['이벤트', `${fmt(Probe.bus.size)}종 · ${fmt([...Probe.bus.values()].reduce((n, r) => n + r.emits, 0))}회 발행`],
          ['CSP 위반', Probe.cspCount ? pill('bad', `${Probe.cspCount}건`) : pill('ok', '0건')],
        ])}</dl></section>
      </div>
      <section class="dc-card dc-in" style="--i:4"><div class="dc-card-head"><h4>🚨 최근 오류</h4><button type="button" class="btn btn-ghost btn-sm" data-dc="goto" data-tab="modules">모두 보기 ›</button></div>
        ${recent.length ? `<ul class="dc-errlist">${recent.map((e) => `<li><b>${esc(e.k)}</b><span>${esc(String(e.m).split('\n')[0].slice(0, 220))}</span></li>`).join('')}</ul>` : emptyBox('오류가 하나도 없어요. 깨끗해요! ✨', 'cheer')}
      </section>`;
  };

  RENDER.system = (b) => {
    const bi = browserInfo();
    const gi = glInfo();
    const rs = rendererStats() || {};
    const csp = cspInfo();
    const ls = lsUsage();
    const E = G.sys.engine;
    const P = E?.preset || {};
    const maxLs = ls.rows[0]?.bytes || 1;
    b.innerHTML = `
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:0"><h4>🌐 브라우저 · 기기</h4><dl class="dc-kv">${kvRows([
          ['사용자 에이전트', `<span class="dc-wrap">${esc(bi.ua)}</span>`],
          bi.brands ? ['브랜드', esc(bi.brands)] : null,
          ['플랫폼', `${esc(bi.platform)}${bi.mobile ? ' · 모바일' : ''}`],
          ['언어 · 시간대', `${esc(bi.language)} · ${esc(bi.timezone)}`],
          ['CPU 코어', esc(bi.cores)], ['기기 메모리', esc(bi.memory)],
          bi.heap ? ['JS 힙', esc(bi.heap)] : null,
          ['화면 · 창', `${esc(bi.screen)} · ${esc(bi.viewport)} <span class="muted">(${bi.colorDepth}bit)</span>`],
          ['픽셀 비율(DPR)', `${esc(bi.dpr)} <span class="muted">→ 렌더 ${esc(E?.renderer?.getPixelRatio?.() ?? '-')}</span>`],
          ['터치 · 포인터', `터치 ${bi.touch}점 · ${bi.coarse ? '굵은 포인터' : '정밀 포인터'}${bi.hover ? ' · 호버' : ''} · 모바일 UI ${bi.touchUI ? '켜짐' : '꺼짐'}`],
          ['네트워크', `${yes(bi.online, '온라인', '오프라인')} · 쿠키 ${bi.cookies ? '허용' : '차단'}`],
          ['접근성 선호', `${bi.reducedMotion ? '동작 줄이기 · ' : ''}${bi.dark ? '다크 모드' : '라이트 모드'}`],
        ])}</dl></section>
        <section class="dc-card dc-in" style="--i:1"><h4>🎮 WebGL · GPU</h4>${gi ? `<dl class="dc-kv">${kvRows([
          ['버전', `<b>${esc(gi.version)}</b> <span class="muted">${esc(gi.glVersion || '')}</span>`],
          ['지원', `WebGL1 ${gi.webgl1 ? '✅' : '—'} · WebGL2 ${gi.webgl2 ? '✅' : '—'}`],
          ['GPU', `<span class="dc-wrap">${esc(gi.renderer || '-')}</span>${gi.unmasked ? '' : ' <span class="muted">(브라우저가 가림)</span>'}`],
          ['제조사', esc(gi.vendor || '-')],
          ['셰이더', esc(gi.shading || '-')],
          ['최대 텍스처', `${fmt(gi.maxTexture)} px · 큐브 ${fmt(gi.maxCube)} · 렌더버퍼 ${fmt(gi.maxRenderbuffer)}`],
          ['뷰포트 최대', esc(gi.maxViewport)],
          ['텍스처 유닛', `${esc(gi.maxTexUnits)} (합계 ${esc(gi.maxCombinedUnits)})`],
          ['유니폼 벡터', `정점 ${esc(gi.maxVUniforms)} · 픽셀 ${esc(gi.maxFUniforms)} · 속성 ${esc(gi.maxAttribs)}`],
          gi.maxSamples != null ? ['MSAA · 3D 텍스처', `${esc(gi.maxSamples)}x · ${fmt(gi.max3D)} · 드로우 버퍼 ${esc(gi.maxDrawBuffers)}`] : null,
          ['비등방 필터 · 정밀도', `${esc(gi.anisotropy)}x · ${esc(gi.precision)}`],
          ['컨텍스트', `안티앨리어싱 ${gi.antialias ? '켜짐' : '꺼짐'} · ${esc(gi.powerPreference)}`],
        ])}</dl><details class="dc-details"><summary>확장 기능 ${gi.extensions.length}개</summary><div class="dc-chips">${gi.extensions.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></details>` : emptyBox('렌더러가 아직 없어요.', 'sleepy')}</section>
      </div>
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:2"><h4>🎨 렌더러 · 엔진 <span class="dc-live-dot" title="실시간"></span></h4><dl class="dc-kv">${kvRows([
          ['FPS', `<b data-live="sfps">${Math.round(num(E?.fps))} FPS</b>`],
          ['draw calls', `<b data-live="calls">${fmt(rs.calls)}</b> <span class="muted">(목표 고품질 ~400 미만)</span>`],
          ['삼각형', `<span data-live="tris">${fmt(rs.triangles)}</span>`],
          ['지오메트리 · 텍스처', `<span data-live="geo">${fmt(rs.geometries)}</span> · <span data-live="tex">${fmt(rs.textures)}</span>`],
          ['셰이더 프로그램', `<span data-live="prog">${fmt(rs.programs)}</span>`],
          ['품질 프리셋', `${esc(P.label || E?.quality || '-')} · 픽셀비 ${esc(P.pixelRatio ?? '-')} · 그림자 ${P.shadows ? `${esc(P.shadowSize)}px` : '꺼짐'} · 블룸 ${P.bloom ? '켜짐' : '꺼짐'}`],
          ['밀도', `나무 ${Math.round(num(P.treeDensity) * 100)}% · 풀 ${Math.round(num(P.grassDensity) * 100)}% · 시야 ${fmt(P.drawDistance)} m`],
          ['장면 객체', fmt((() => { let n = 0; E?.scene?.traverse?.(() => { n++; }); return n; })())],
        ])}</dl></section>
        <section class="dc-card dc-in" style="--i:3"><h4>🔐 보안</h4>
          <dl class="dc-kv">${kvRows([
            ['보안 컨텍스트', yes(bi.secure, '예 (HTTPS/localhost)', '아니오 — crypto.subtle·마이크 제한')],
            ['프로토콜', mono(bi.protocol)],
            ['교차 출처 격리', yes(bi.isolated, '격리됨', '아님 (정상)')],
          ])}</dl>
          <ul class="dc-checks">${csp.checks.map(([k, ok, v]) => `<li data-ok="${ok ? 1 : 0}"><span>${ok ? '✅' : '⚠️'}</span><b>${esc(k)}</b><small>${esc(v)}</small></li>`).join('')}</ul>
          <div class="dc-sub-h">🚫 CSP 위반 기록 ${Probe.cspCount ? pill('bad', `${Probe.cspCount}건`) : pill('ok', '0건')}</div>
          ${csp.violations.length ? `<ul class="dc-errlist">${csp.violations.slice(-12).reverse().map((v) => `<li><b>${esc(v.directive)}</b><span>${esc(v.blocked || v.sample || '-')} ${v.source ? `@ ${esc(v.source.split('/').pop())}:${v.line}` : ''}</span></li>`).join('')}</ul>` : '<p class="dc-note">이 페이지가 열린 뒤 차단된 스크립트·연결이 없어요. (securitypolicyviolation 감시 중)</p>'}
        </section>
      </div>
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:4"><h4>💽 저장소</h4>
          <dl class="dc-kv" data-live-est>${kvRows([['브라우저 저장 공간', '<span class="muted">계산 중…</span>'], ['영구 저장', '<span class="muted">확인 중…</span>']])}</dl>
          <div class="dc-sub-h">localStorage ${kb(ls.total)} · ${ls.rows.length}개 키 <span class="muted">(대개 5 MB 한도)</span></div>
          ${ls.blocked ? '<p class="dc-note">⚠️ 저장소 접근이 차단돼 있어요 (사생활 보호 모드?).</p>' : `<div class="dc-bars">${ls.rows.slice(0, 14).map((r) => `<div class="dc-bar-row"><span class="dc-bar-label" title="${esc(r.key)}">${r.emoji} ${esc(r.key)}</span><span class="dc-bar"><i style="width:${Math.max(2, (r.bytes / maxLs) * 100).toFixed(1)}%"></i></span><span class="dc-bar-val">${kb(r.bytes)}</span></div>`).join('')}</div>`}
        </section>
        <section class="dc-card dc-in" style="--i:5"><h4>🔊 미디어 · 웹 API</h4><dl class="dc-kv">${kvRows([
          ['Web Audio', `${yes(bi.audio, '지원')} <span class="muted">${esc(bi.audioState)}</span>`],
          ['음성 합성 (TTS)', `${yes(bi.speech, '지원')} <span class="muted">목소리 ${bi.voices}개 · 한국어 ${bi.koVoices}개</span>`],
          ['음성 인식', yes(bi.recognition, '지원 (채팅 음성 입력)', '미지원 — 음성 버튼 대체 안내')],
          ['crypto.subtle', yes(bi.subtle, 'PBKDF2 WebCrypto', '없음 — JS 대체 구현 사용')],
          ['난수 생성기', yes(bi.randomValues, 'crypto.getRandomValues')],
          ['저장소 API', yes(bi.storageApi, 'navigator.storage')],
          ['포인터 이벤트', yes(bi.pointer)],
          ['전체 화면', yes(bi.fullscreen)],
          ['WebP 인코딩', yes(bi.webp, '가능 (사진 축소)')],
        ])}</dl></section>
      </div>
      ${gpuCardHtml()}`;
    drawNan(b);
    storageEstimate().then((e) => {
      const dl = b.querySelector('[data-live-est]');
      if (!dl || ui.tab !== 'system') return;
      dl.innerHTML = kvRows([
        ['브라우저 저장 공간', e.usage != null ? `${kb(e.usage)} 사용 / ${kb(e.quota)} <span class="muted">(${e.quota ? ((e.usage / e.quota) * 100).toFixed(2) : 0}%)</span>` : '<span class="muted">이 브라우저는 알려 주지 않아요</span>'],
        ['영구 저장', e.persisted == null ? '<span class="muted">알 수 없음</span>' : yes(e.persisted, '허용됨', '기본 (공간이 부족하면 지워질 수 있어요)')],
      ]);
    });
  };

  // ---------------------------------------------------------------- step away from the panel (highlight · tour · gate test)
  function panelAway(on) {
    if (!ui.root) return;
    ui.away = !!on && ui.opened;
    ui.root.hidden = ui.away || !ui.opened;
    document.body.classList.toggle('dc-open', ui.opened && !ui.away);
    if (!ui.away && ui.opened) {
      render();
      setTimeout(() => { if (ui.opened && !ui.away && !ui.dialog) ui.root?.querySelector('.dc-nav-btn.active')?.focus({ preventScroll: true }); }, 30);
    }
  }
  /** small floating status pill while the panel is away (tour progress / stop) */
  function tourPill(text) {
    let el = document.querySelector('.dc-tour-pill');
    if (text == null) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'dc-tour-pill';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<span class="dc-tour-spin" aria-hidden="true">🎬</span><b></b><button type="button" class="dc-tour-stop" aria-label="점검 멈추기">⏹ 멈추기</button>';
      el.querySelector('button').addEventListener('click', () => { Tour.stop = true; el.querySelector('b').textContent = '멈추는 중…'; });
      document.body.appendChild(el);
    }
    el.querySelector('b').textContent = text;
  }
  /** "👀 보기": hide the panel and outline one element on the live screen */
  const Spot = {
    el: null, target: null, timer: 0,
    get active() { return !!this.el; },
    show(target, caption) {
      if (!target || !target.isConnected) { toast('그 요소가 지금은 화면에 없어요. 그 화면을 열고 "지금 화면 점검" 을 눌러 주세요.', 'warn', '👀'); return false; }
      this.hide(true);
      const wrap = document.createElement('div');
      wrap.className = 'dc-spot';
      wrap.innerHTML = '<div class="dc-spot-box" aria-hidden="true"></div><div class="dc-spot-cap" role="status"></div><button type="button" class="dc-spot-back">⬅️ 점검으로 돌아가기 <kbd>Esc</kbd></button>';
      wrap.querySelector('.dc-spot-cap').textContent = caption || cssPath(target);
      wrap.querySelector('.dc-spot-back').addEventListener('click', () => this.hide());
      document.body.appendChild(wrap);
      this.el = wrap; this.target = target;
      if (ui.opened) panelAway(true);
      try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old browsers */ }
      this.place();
      this.timer = setInterval(() => this.place(), 200);
      setTimeout(() => wrap.querySelector('.dc-spot-back')?.focus(), 40);
      return true;
    },
    place() {
      if (!this.el) return;
      const box = this.el.querySelector('.dc-spot-box'), cap = this.el.querySelector('.dc-spot-cap');
      const r = this.target?.isConnected ? this.target.getBoundingClientRect() : null;
      if (!r || (r.width < 1 && r.height < 1)) { box.hidden = true; cap.style.left = '50%'; cap.style.top = '40%'; return; }
      box.hidden = false;
      const pad = 6;
      Object.assign(box.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const below = r.bottom + 12 + 60 < innerHeight;
      cap.style.left = `${clamp(r.left + r.width / 2, 120, innerWidth - 120)}px`;
      cap.style.top = below ? `${r.bottom + pad + 10}px` : `${Math.max(8, r.top - pad - 10)}px`;
      cap.dataset.pos = below ? 'below' : 'above';
    },
    hide(silent) {
      clearInterval(this.timer); this.timer = 0;
      if (this.el) this.el.remove();
      this.el = null; this.target = null;
      if (!silent && ui.opened && ui.away) panelAway(false);
    },
  };

  // ---------------------------------------------------------------- 👶 쉬운 모드 점검 tab
  const kidItems = () => {
    if (ui.kid.view !== 'live' && Tour.result?.rows?.[ui.kid.view]?.audit) return { audit: Tour.result.rows[ui.kid.view].audit, src: Tour.result.rows[ui.kid.view] };
    return { audit: KidAudit.last, src: null };
  };
  RENDER.kids = (b) => {
    if (!KidAudit.last) KidAudit.run();
    const st = easyStatus();
    const { audit: A, src } = kidItems();
    const easy = st.on;
    const C = 2 * Math.PI * 52;
    const tone = A.counts.critical ? 'bad' : A.counts.warn ? 'warn' : 'ok';
    const apiOk = st.api.filter((x) => x.ok).length;
    const screens = Tour.screens();
    const bubble = !st.present ? '쉬운 모드 도구(G.easy)가 아직 없어요. 08-easy.js 를 확인해 주세요 🧐'
      : A.counts.critical ? `치명 ${A.counts.critical}건! 빨간 줄부터 "👀 보기" 로 확인해요 🚨`
        : A.counts.warn ? '거의 다 왔어요. 경고만 고치면 아이가 더 쉽게 써요 🙂' : '아이도 쉽게 쓸 수 있는 화면이에요! 🎉';
    const kindTiles = Object.entries(KID_KINDS).map(([k, m]) => {
      const v = A.byKind[k] || { critical: 0, warn: 0, info: 0 };
      const t = v.critical ? 'bad' : v.warn ? 'warn' : v.info ? 'info' : 'ok';
      if (!easy && (k === 'freetext' || k === 'speak' || k === 'fontsize' || k === 'hanja') && !v.critical && !v.warn && !v.info) return '';
      return `<button type="button" class="dc-kid-kind" data-dc="kid-kind" data-kind="${k}" data-tone="${t}" aria-pressed="${ui.kid.kind === k}" title="${esc(m.desc)}"><span class="dc-kid-kind-emoji" aria-hidden="true">${m.emoji}</span><b>${esc(m.label)}</b><span class="dc-cat-counts">${v.critical ? `<i data-s="error">⛔${v.critical}</i>` : ''}${v.warn ? `<i data-s="warn">⚠️${v.warn}</i>` : ''}${v.info ? `<i data-s="info">💡${v.info}</i>` : ''}${!v.critical && !v.warn && !v.info ? '<i data-s="ok">✅</i>' : ''}</span></button>`;
    }).join('');
    const tr = Tour.result;
    b.innerHTML = `
      <section class="dc-hero dc-in" data-tone="${tone}" style="--i:0">
        <div class="dc-gauge" role="img" aria-label="아이 친화 점수 ${A.score}점">
          <svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="dc-g-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e3a8"/><stop offset="1" stop-color="#f4c54a"/></linearGradient></defs><circle cx="60" cy="60" r="52" class="dc-gauge-bg"/><circle cx="60" cy="60" r="52" class="dc-gauge-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - A.score / 100)).toFixed(1)}" style="--c:${C.toFixed(1)}"/></svg>
          <div class="dc-gauge-num"><b data-countup="${A.score}">${A.score}</b><small>아이 점수</small></div>
        </div>
        <div class="dc-hero-text">
          <div class="dc-eyebrow">KID MODE · 쉬운 모드 점검 · ${esc(src ? `${src.emoji} ${src.label}` : '지금 화면')}</div>
          <h3>${easy ? '👶 쉬운 모드 켜짐' : '🧑 보통 모드'} <span class="muted small">· 누르기 최소 ${st.tap}px · ${esc(A.viewport)}</span></h3>
          <p class="dc-reasons">${pill(A.counts.critical ? 'bad' : 'ok', `⛔ 치명 ${A.counts.critical}`)} ${pill(A.counts.warn ? 'warn' : 'ok', `⚠️ 경고 ${A.counts.warn}`)} ${pill('info', `💡 참고 ${A.counts.info}`)} <span class="muted small">버튼 ${fmt(A.stats.interactive)}개 · 가려짐 ${fmt(A.stats.covered)} · 글자 ${fmt(A.stats.textChecked)}개 · ${A.ms.toFixed(0)} ms · ${esc(ago(A.at))}</span></p>
          <div class="dc-row wrap">
            <button type="button" class="btn btn-primary btn-sm" data-dc="kid-audit">🔍 지금 화면 점검</button>
            <button type="button" class="btn btn-gold btn-sm" data-dc="kid-tour" ${Tour.running ? 'disabled' : ''}>${Tour.running ? '⏳ 점검 중…' : `🎬 주요 화면 차례로 (${screens.filter((x) => x.available).length}개)`}</button>
            <button type="button" class="btn btn-soft btn-sm" data-dc="kid-easy">${easy ? '🧑 보통 모드로 바꾸기' : '👶 쉬운 모드로 바꾸기'}</button>
            <button type="button" class="btn btn-soft btn-sm" data-dc="kid-gate" ${st.api.find((x) => x.k === 'gate')?.ok ? '' : 'disabled'}>🔒 보호자 확인 시험</button>
          </div>
        </div>
        <div class="dc-hero-mascot" aria-hidden="true">${mascot(A.counts.critical ? 'surprised' : A.counts.warn ? 'think' : 'cheer', 84)}<div class="dc-bubble">${esc(bubble)}</div></div>
      </section>
      <div class="dc-kid-kinds dc-in" style="--i:1">${kindTiles}</div>
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:2"><h4>🧸 쉬운 모드 상태</h4><dl class="dc-kv">${kvRows([
          ['G.easy', st.present ? `${pill(apiOk === st.api.length ? 'ok' : 'warn', `API ${apiOk}/${st.api.length}`)}${apiOk < st.api.length ? ` <span class="muted small">없음: ${esc(st.api.filter((x) => !x.ok).map((x) => x.k).join(', '))}</span>` : ''}` : pill('bad', '없음 (08-easy.js)')],
          ['화면 표시', `body.${esc(st.bodyClass)} · --tap ${st.tap}px`],
          ['읽어주기', `${yes(st.voiceGuide, '켜짐', '꺼짐')} · 속도 ${st.voiceRate} · ${st.speech ? `음성 ${st.voices}개 (한국어 ${st.koVoices})` : '이 브라우저는 음성 합성 없음'}${st.muted ? ' · 🔇 음소거' : ''}`],
          ['보호자 확인', `${yes(st.parentGate, '켜짐', '꺼짐')}${st.unlocked == null ? '' : st.unlocked ? ` ${pill('warn', '🔓 지금 풀려 있음 (어른 화면이 열려 있는 동안)')}` : ` ${pill('ok', '🔒 잠김')}`}`],
          ['아이 채팅', `${yes(st.kidChat, st.on ? '고르기만 (글자 입력 없음)' : '쉬운 모드일 때 고르기만', '자유 입력')} · 개인정보 가림 ${st.maskPII ? pill('ok', 'maskPII ✅') : pill('warn', 'maskPII 없음')}`],
          ['놀이 시간 알림', st.reminder ? `${st.reminder}분마다` : '꺼짐'],
          ['읽어주기 범위', A.stats.prompts ? `${A.stats.speakable}/${A.stats.prompts} 안내 문장에 🔊` : '<span class="muted">안내 문장 없음</span>'],
        ])}</dl></section>
        <section class="dc-card dc-in" style="--i:3"><h4>🔊 최근 읽어준 말 · 🔒 보호자 확인 기록</h4><div data-live="kidlog">${kidLogHtml()}</div></section>
      </div>
      <section class="dc-card dc-in" style="--i:4"><div class="dc-card-head"><h4>🎬 화면별 점검 ${tr ? `<span class="muted small">${esc(ago(tr.at))} · ${tr.easy ? '쉬운 모드' : '보통 모드'} · ${(tr.ms / 1000).toFixed(1)}초${tr.stopped ? ' · 중간에 멈춤' : ''}</span>` : ''}</h4>${ui.kid.view !== 'live' ? '<button type="button" class="btn btn-ghost btn-sm" data-dc="kid-row" data-i="live">지금 화면 결과 보기</button>' : ''}</div>
        ${tr ? `<div class="dc-table-wrap"><table class="dc-table dc-kid-table"><thead><tr><th>화면</th><th>상태</th><th>⛔</th><th>⚠️</th><th>💡</th><th>점수</th><th>먼저 볼 문제</th><th></th></tr></thead><tbody>${tr.rows.map((r, i) => {
          const a = r.audit;
          const top = a?.items?.[0];
          return `<tr data-on="${ui.kid.view === i ? 1 : 0}"><td><b>${r.emoji} ${esc(r.label)}</b></td><td>${r.status === 'ok' ? pill(a.counts.critical ? 'bad' : a.counts.warn ? 'warn' : 'ok', a.counts.critical ? '⛔ 고쳐요' : a.counts.warn ? '⚠️ 살펴요' : '✅ 좋아요') : r.status === 'skip' ? pill('skip', '⏭️ 건너뜀') : pill('bad', '⛔ 실패')}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</td><td class="dc-num">${a ? a.counts.critical : '-'}</td><td class="dc-num">${a ? a.counts.warn : '-'}</td><td class="dc-num">${a ? a.counts.info : '-'}</td><td class="dc-num">${a ? a.score : '-'}</td><td class="small">${top ? `${KID_KINDS[top.kind].emoji} ${esc(top.detail)}${top.text ? ` <span class="muted">· ${esc(top.text.slice(0, 24))}</span>` : ''}` : '<span class="muted">—</span>'}</td><td>${a ? `<button type="button" class="btn btn-ghost btn-sm" data-dc="kid-row" data-i="${i}">자세히</button>` : ''}</td></tr>`;
        }).join('')}</tbody><tfoot><tr><td><b>합계</b></td><td>${tr.totals.screens}개 화면 · 건너뜀 ${tr.totals.skipped}</td><td class="dc-num">${tr.totals.critical}</td><td class="dc-num">${tr.totals.warn}</td><td class="dc-num">${tr.totals.info}</td><td></td><td></td><td></td></tr></tfoot></table></div>`
          : `<p class="dc-note">"🎬 주요 화면 차례로" 를 누르면 센터가 잠깐 숨고 가방 · 가게 · 스티커북 · 오늘 · 일기 · 배움터 · 퀴즈 · 지도 · 설정 · 도움말 · 사진 … 을 공개 API 로 하나씩 열어 점검한 뒤 돌아와요. (API 가 없는 화면은 건너뛰어요 · 아무것도 사거나 저장하지 않지만 배움 이야기 첫 쪽은 '본 것' 으로 기록될 수 있어요)</p><div class="dc-chips">${screens.map((x) => `<span class="chip ${x.available ? '' : 'dc-chip-off'}">${x.emoji} ${esc(x.label)}${x.available ? '' : ' ⏭️'}</span>`).join('')}</div>`}
      </section>
      <section class="dc-card dc-in" style="--i:5">
        <div class="dc-toolbar">
          <div class="seg" role="group" aria-label="심각도">${[['all', '전체'], ['critical', '⛔ 치명'], ['warn', '⚠️ 경고'], ['info', '💡 참고']].map(([v, l]) => `<button type="button" class="${ui.kid.sev === v ? 'active' : ''}" data-dc="kid-sev" data-sev="${v}">${l}</button>`).join('')}</div>
          ${ui.kid.kind !== 'all' ? `<button type="button" class="chip chip-gold" data-dc="kid-kind" data-kind="all">${KID_KINDS[ui.kid.kind]?.emoji || ''} ${esc(KID_KINDS[ui.kid.kind]?.label || ui.kid.kind)} ✕</button>` : ''}
          <span class="muted small">${esc(src ? `${src.emoji} ${src.label} 화면 결과` : '지금 화면 결과')} · 범위 ${esc(A.scope)}</span>
        </div>
        <div id="dc-kid-list"></div>
      </section>`;
    renderKidList(b);
    ui.kid.sayN = KidLog.say.length; ui.kid.gateN = KidLog.gate.length;
  };
  function kidLogHtml() {
    const say = KidLog.say.slice(-8).reverse();
    const gate = KidLog.gate.slice(-6).reverse();
    return `${say.length ? `<ul class="dc-errlist dc-kid-log">${say.map((x) => `<li><b>🔊 ${esc(ago(x.at))}</b><span>${esc(x.text || '(빈 문장)')}</span></li>`).join('')}</ul>` : '<p class="dc-note">아직 읽어준 말이 없어요. (쉬운 모드 + 읽어주기 켜짐일 때 easy:say 로 기록돼요)</p>'}
      <div class="dc-sub-h">🔒 보호자 확인</div>${gate.length ? `<ul class="dc-errlist">${gate.map((x) => `<li><b>${x.ok ? '✅ 통과' : '✋ 닫음/틀림'} · ${esc(ago(x.at))}</b><span>${esc(x.reason || '-')}</span></li>`).join('')}</ul>` : '<p class="dc-note">기록 없음</p>'}`;
  }
  function renderKidList(scope) {
    const box = scope.querySelector('#dc-kid-list');
    if (!box) return;
    const { audit: A } = kidItems();
    const list = (A?.items || []).filter((x) => (ui.kid.sev === 'all' || x.sev === ui.kid.sev) && (ui.kid.kind === 'all' || x.kind === ui.kid.kind));
    if (!list.length) { box.innerHTML = emptyBox(A?.items?.length ? '조건에 맞는 항목이 없어요.' : '문제가 하나도 없어요! 아이가 쓰기 좋은 화면이에요.', 'cheer'); return; }
    const LIMIT = 200;
    box.innerHTML = `<ul class="dc-issues dc-kid-issues">${list.slice(0, LIMIT).map((x) => {
      const idx = A.items.indexOf(x);
      return `<li data-sev="${x.sev === 'critical' ? 'error' : x.sev}"><span class="dc-issue-sev" title="${KID_SEV[x.sev].label}">${KID_SEV[x.sev].emoji}</span><span class="chip">${KID_KINDS[x.kind].emoji} ${esc(KID_KINDS[x.kind].label)}</span><span class="dc-issue-msg"><b>${esc(x.detail)}</b>${x.text ? ` <span class="muted">“${esc(x.text)}”</span>` : ''}<br>${mono(x.sel)}</span>${x.el ? `<button type="button" class="btn btn-ghost btn-sm dc-kid-show" data-dc="kid-show" data-i="${idx}" aria-label="화면에서 보기">👀 보기</button>` : ''}</li>`;
    }).join('')}</ul>${list.length > LIMIT ? `<p class="dc-note">… 외 ${list.length - LIMIT}건</p>` : ''}`;
  }
  async function kidGateTest() {
    if (typeof G.easy?.gate !== 'function') return;
    panelAway(true);
    tourPill('🔒 보호자 확인 시험 중 — 문제를 풀거나 ✖ 로 닫아요');
    let ok = null;
    try { ok = await G.easy.gate({ reason: 'dev-check', title: '보호자 확인 시험' }); } catch (e) { G.log.warn('DEV', 'gate test failed', e); }
    tourPill(null);
    panelAway(false);
    toast(ok === true ? '보호자 확인 통과 ✅ (이 시험은 화면을 열지 않으니 곧 다시 잠겨요)' : ok === false ? '보호자 확인을 닫았어요 ✋' : '보호자 확인을 열지 못했어요', ok === true ? 'success' : 'info', '🔒');
  }
  async function kidTourUi() {
    if (Tour.running) return;
    // the tour closes whatever is open underneath the center (an unsent journal draft would be lost): ask first
    if (G.ui?.modal?.isOpen?.() || G.sys.photo?.active) {
      const ok = await confirmBox({ title: '열려 있는 게임 창을 닫고 점검할까요?', message: '화면을 하나씩 열어 보려면 지금 열린 창(작성 중인 일기 등)을 먼저 닫아야 해요.', okText: '닫고 점검', emoji: '🎬' });
      if (!ok) return;
    }
    toast('주요 화면을 차례로 열어 점검해요. 끝나면 돌아와요 🎬', 'info', '👶');
    const r = await Tour.run({});
    ui.kid.view = 'live';
    KidAudit.run();
    if (ui.opened) { ui.tab = 'kids'; render({ scrollTop: false }); }
    toast(r.totals.critical ? `화면 점검: 치명 ${r.totals.critical}건 · 경고 ${r.totals.warn}건이에요.` : `화면 ${r.totals.screens}개 점검 완료 — 치명 문제 없음 🎉`, r.totals.critical ? 'warn' : 'success', '🎬');
  }

  // ---------------------------------------------------------------- 🖥️ GPU 안전 card (system tab)
  function gpuCardHtml() {
    const g = Gpu.last && now() - Gpu.last.at < 4000 ? Gpu.last : Gpu.scan();
    if (!g) return '<section class="dc-card dc-in dc-gpu" style="--i:6"><h4>🖥️ GPU 안전</h4><p class="dc-note">3D 장면이 아직 없어요.</p></section>';
    const p = g.passes;
    const n = Gpu.nan;
    const passTxt = p.composer ? p.list.map((x, i) => `<span class="chip ${i === p.scrub ? 'chip-green' : i === p.bloom ? 'chip-gold' : ''}">${esc(x.name)}${x.enabled ? '' : ' (꺼짐)'}</span>`).join('<span class="dc-arrow" aria-hidden="true">→</span>') : `<span class="muted">${p.bloomPreset ? '컴포저 준비 전' : '블룸이 꺼진 품질 — 후처리 없음 (NaN 이 번지지 않아요)'}</span>`;
    return `<section class="dc-card dc-in dc-gpu" style="--i:6" data-tone="${g.ok && (!n || n.ok || n.skip) ? 'ok' : 'bad'}">
      <div class="dc-card-head"><h4>🖥️ GPU 안전 <span class="muted small">검은 사각형 버그 방지 (a954f38)</span></h4>
        <div class="dc-row wrap"><button type="button" class="btn btn-soft btn-sm" data-dc="gpu-scan">🔍 다시 검사</button>${g.badNormals && g.fixNormals ? '<button type="button" class="btn btn-gold btn-sm" data-dc="gpu-fix">🔧 노멀 고치기</button>' : ''}<button type="button" class="btn btn-primary btn-sm" data-dc="gpu-nan">🧪 NaN 주입 테스트</button></div></div>
      <p class="dc-note">Windows(Direct3D) GPU 는 길이 0 노멀을 <code>normalize(0)</code> 하면 NaN 을 만들고, 블룸이 그 한 점을 큰 검은 사각형으로 번지게 해요. 엔진은 노멀을 고치고(<code>G.gfx.fixNormals</code>) 블룸 전에 NaN 을 지워요(<code>NaNScrubShader</code>).</p>
      <dl class="dc-kv dc-kv-3">${kvRows([
        ['길이 0·NaN 노멀', `${g.badNormals ? pill('bad', `⛔ ${fmt(g.badNormals)}개`) : pill('ok', '✅ 0개')} <span class="muted small">메시 ${fmt(g.meshes)} · 정점 ${fmt(g.vertices)}</span>`],
        ['엔진이 고친 노멀 (누적)', `${fmt(g.repaired)}개 <span class="muted small">G.gfx.normalsRepaired</span>`],
        ['NaN 정점 위치', g.nanPositions ? pill('bad', `⛔ ${fmt(g.nanPositions)}개`) : pill('ok', '✅ 0개')],
        ['납작한 조명 메시 (축 하나가 0)', g.flat.length ? pill('bad', `⛔ ${g.flat.length}개`) : pill('ok', '✅ 0개')],
        ['납작한 인스턴스', g.flatInstances ? pill('bad', `⛔ ${fmt(g.flatInstances)}개`) : pill('ok', `✅ 0개 / ${fmt(g.instancedChecked)}`)],
        ['검사 시간', `${g.ms.toFixed(1)} ms · ${esc(ago(g.at))}`],
        ['지금 프레임', (() => {
          const f = G.sys.engine?.frameInfo, c = G.sys.engine?.cullStats;
          if (!f) return '<span class="muted small">-</span>';
          return `draw calls ${fmt(Number(f.calls) || 0)} · 삼각형 ${fmt(Number(f.triangles) || 0)}${c ? ` <span class="muted small">거리 컷 ${fmt(Number(c.culled) || 0)}/${fmt(Number(c.items) || 0)}${Number.isFinite(c.dist) ? ` (${c.dist} m)` : ''}</span>` : ''}`;
        })()],
      ])}</dl>
      ${[...g.badNormalGeos.map((x) => `노멀 ${x.n}개 · ${x.obj}`), ...g.nanPosGeos.map((x) => `NaN 위치 ${x.n}개 · ${x.obj}`), ...g.flat.map((x) => `납작 ${x.scale.join('·')} · ${x.obj}`), ...g.flatInstMeshes.map((x) => `납작 인스턴스 ${x.n}/${x.count} · ${x.obj}`)].length ? `<ul class="dc-errlist">${[...g.badNormalGeos.map((x) => `노멀 ${x.n}개 · ${x.obj}`), ...g.nanPosGeos.map((x) => `NaN 위치 ${x.n}개 · ${x.obj}`), ...g.flat.map((x) => `납작 ${x.scale.join('·')} · ${x.obj}`), ...g.flatInstMeshes.map((x) => `납작 인스턴스 ${x.n}/${x.count} · ${x.obj}`)].slice(0, 12).map((t) => `<li><b>⛔</b><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
      <div class="dc-sub-h">🎞️ 후처리 순서 ${p.ok === false ? pill('bad', '⛔ NaN 청소가 블룸 뒤에 있어요') : p.ok ? pill('ok', '✅ 청소 → 블룸') : ''}</div>
      <div class="dc-chips dc-passes">${passTxt}</div>
      <div class="dc-sub-h">🧪 NaN 주입 테스트 ${n ? (n.skip ? pill('skip', '⏭️ 건너뜀') : n.ok ? pill('ok', '✅ 통과') : pill('bad', '⛔ 실패')) : '<span class="muted small">(버튼을 눌러 실행 · 게임 화면은 바뀌지 않아요)</span>'}</div>
      ${n && !n.skip ? `<div class="dc-nan"><figure><canvas data-nan="noScrub" width="64" height="64" aria-label="청소 없이"></canvas><figcaption>청소 없이<br><b>${(n.blackNoScrub * 100).toFixed(1)}%</b> 검정</figcaption></figure><span class="dc-arrow" aria-hidden="true">→</span><figure><canvas data-nan="scrub" width="64" height="64" aria-label="청소 후"></canvas><figcaption>NaN 청소 후<br><b>${(n.blackScrub * 100).toFixed(2)}%</b> 검정</figcaption></figure><p class="dc-note">${esc(n.detail || '')} · 셰이더: ${esc(n.source)} · ${n.ms.toFixed(0)} ms</p></div>` : n?.skip ? `<p class="dc-note">${esc(n.detail)}</p>` : ''}
      ${g.shaders.length ? `<details class="dc-details"><summary>커스텀 셰이더 ${g.shaders.length}개 — 0 나누기·normalize·pow·sqrt 를 쓰면 입력이 0/음수일 때를 막았는지 확인하세요</summary><div class="dc-chips">${g.shaders.map((x) => `<span class="chip">${esc(x.name)}${x.ops.length ? ` <small class="muted">${esc(x.ops.join(' · '))}</small>` : ''}</span>`).join('')}</div></details>` : ''}
    </section>`;
  }
  function drawNan(scope) {
    const n = Gpu.nan;
    if (!n?.frames) return;
    for (const [k, px] of Object.entries(n.frames)) {
      const c = scope.querySelector(`canvas[data-nan="${k}"]`);
      if (!c || !px) continue;
      const S = n.size;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4); // readPixels is bottom-up
      ctx.putImageData(img, 0, 0);
    }
  }

  RENDER.modules = (b) => {
    const { rows, missing } = moduleRows();
    const err = errorSummary();
    const B = window.__BUILD__ || {};
    const fragErr = new Set((G.__fragmentErrors || []).map((e) => e.name));
    const counts = { ok: 0, failed: 0, disabled: 0, pending: 0 };
    for (const r of rows) counts[r.status]++;
    const manRow = (f, kind) => {
      const meta = SOURCE_BY_NAME.get(f.name);
      const st = fragErr.has(f.name) ? pill('bad', '⛔ 오류') : pill('ok', '✅');
      return `<tr data-q="${esc(`${f.name} ${meta?.purpose || ''} ${OWNER[meta?.owner] || ''}`.toLowerCase())}"><td>${mono(f.name)}</td><td>${esc(OWNER[meta?.owner] || '—')}</td><td class="dc-num">${fmt(f.lines)}</td><td class="dc-num">${kb(f.bytes)}</td><td>${mono(f.sha)}</td><td>${kind === 'js' ? st : ''}</td></tr>`;
    };
    b.innerHTML = `
      <div class="dc-toolbar dc-in" style="--i:0">
        <div class="dc-chips">${pill('ok', `✅ 정상 ${counts.ok}`)} ${counts.failed ? pill('bad', `⛔ 실패 ${counts.failed}`) : ''} ${counts.disabled ? pill('warn', `⚠️ 멈춤 ${counts.disabled}`) : ''} ${counts.pending ? pill('skip', `⏳ 초기화 전 ${counts.pending}`) : ''} ${missing.length ? pill('bad', `❔ 없음 ${missing.length}`) : ''} ${pill('info', `🐞 오류 ${err.system + err.fragment}`)}</div>
        <label class="dc-search"><span aria-hidden="true">🔎</span><input type="search" data-dc-search data-dc-input="modules" placeholder="시스템·API 검색 ( / )" value="${esc(ui.modQ)}" aria-label="모듈 검색"></label>
      </div>
      <section class="dc-card dc-in" style="--i:1"><h4>⚙️ 시스템 (초기화 순서)</h4>
        <div class="dc-table-wrap"><table class="dc-table dc-mod-table"><thead><tr><th>순서</th><th>시스템</th><th>상태</th><th>공개 API</th><th>오류</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="dc-mod-row" data-q="${esc(`${r.name} ${r.label} ${r.api.join(' ')}`.toLowerCase())}" data-dc="mod-toggle" tabindex="0" aria-expanded="false">
            <td class="dc-num">${esc(r.order)}</td><td><b>${esc(r.name)}</b> <span class="muted">${esc(r.label)}</span></td>
            <td>${pill(STATUS[r.status].tone, STATUS[r.status].text)}</td><td class="dc-num">${r.api.length}</td>
            <td class="dc-num">${r.errors.length ? pill('bad', r.errors.length) : '0'}</td><td class="dc-caret" aria-hidden="true">▾</td></tr>
          <tr class="dc-mod-detail" hidden><td colspan="6">
            <div class="dc-sub-h">공개 API ${r.api.length}개 ${mono(`G.sys.${r.name}`)}${r.hasUpdate ? ' · 매 프레임 update' : ''}</div>
            <div class="dc-chips">${r.api.map((m) => `<span class="chip dc-api">${esc(m)}()</span>`).join('') || '<span class="muted">공개 메서드 없음</span>'}</div>
            ${r.errors.length ? `<div class="dc-sub-h">마지막 오류</div>${r.errors.slice(-3).map((e) => `<pre class="dc-pre"><b>[${esc(e.phase)}]</b> ${esc(String(e.message).slice(0, 1500))}</pre>`).join('')}` : ''}
          </td></tr>`).join('')}
        ${missing.map((n) => `<tr><td class="dc-num">-</td><td><b>${esc(n)}</b></td><td>${pill('bad', STATUS.missing.text)}</td><td class="dc-num">-</td><td class="dc-num">-</td><td></td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="dc-card dc-in" style="--i:2"><h4>🧱 조각 로드 오류 · 빌드 제외</h4>
        ${(G.__fragmentErrors || []).length ? (G.__fragmentErrors || []).map((e) => `<pre class="dc-pre"><b>${esc(e.name)}</b>\n${esc(String(e.message).slice(0, 1500))}</pre>`).join('') : '<p class="dc-note">✅ 모든 조각이 오류 없이 실행됐어요.</p>'}
        ${(B.manifest?.skipped || []).length ? `<ul class="dc-errlist">${B.manifest.skipped.map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.reason)}</span></li>`).join('')}</ul>` : '<p class="dc-note">✅ 빌드에서 빠진 조각이 없어요.</p>'}
      </section>
      <section class="dc-card dc-in" style="--i:3"><div class="dc-card-head"><h4>🖨️ 최근 콘솔 오류·경고 <span class="muted">(${fmt(Probe.errorCount)} 오류 · ${fmt(Probe.warnCount)} 경고)</span></h4></div>
        ${Probe.errors.length ? `<ul class="dc-errlist dc-console">${Probe.errors.slice(-30).reverse().map((e) => `<li data-level="${esc(e.level)}"><b>${e.level === 'warn' ? '⚠️' : '⛔'} ${esc(ago(e.at))}${e.n > 1 ? ` ×${e.n}` : ''}</b><span>${esc(e.msg.slice(0, 400))}</span></li>`).join('')}</ul>` : emptyBox('콘솔 오류·경고가 없어요.', 'happy')}
      </section>
      <section class="dc-card dc-in" style="--i:4"><h4>📦 빌드 매니페스트 <span class="muted">(window.__BUILD__.manifest)</span></h4>
        ${B.manifest ? `<div class="dc-table-wrap"><table class="dc-table dc-man"><thead><tr><th>파일</th><th>담당</th><th>줄</th><th>크기</th><th>sha256 (12)</th><th>상태</th></tr></thead><tbody>
          ${(B.manifest.js || []).map((f) => manRow(f, 'js')).join('')}${(B.manifest.css || []).map((f) => manRow(f, 'css')).join('')}</tbody></table></div>` : '<p class="dc-note">빌드 정보가 없어요 (개발 중 파일?).</p>'}
      </section>`;
    filterRows(b, ui.modQ);
  };
  function filterRows(scope, q) {
    const s = String(q || '').trim().toLowerCase();
    for (const tr of scope.querySelectorAll('tr[data-q]')) {
      const show = !s || tr.dataset.q.includes(s);
      tr.hidden = !show;
      const next = tr.nextElementSibling;
      if (next?.classList.contains('dc-mod-detail') && !show) next.hidden = true;
    }
  }

  RENDER.data = (b) => {
    const r = Lint.get();
    const f = ui.lint;
    const ent = r.entities;
    const ENT = [['아이템', ent.items], ['작물', ent.crops], ['레시피', ent.recipes], ['재료 만들기', ent.crafts], ['상점', ent.shops], ['NPC', ent.npcs], ['대화', `${ent.dialogues} (노드 ${ent.dialogueNodes})`], ['퀘스트', ent.quests], ['업적', ent.achievements], ['도감', ent.collection], ['교육', ent.education], ['퀴즈', ent.quizzes], ['구역', ent.zones], ['명소', ent.pois], ['배치 앵커', ent.anchors], ['이모지', ent.emotes], ['제스처', ent.gestures]];
    b.innerHTML = `
      <section class="dc-lint-head dc-in" style="--i:0">
        <button type="button" class="dc-lint-big" data-dc="lint-sev" data-sev="error" data-tone="${r.counts.error ? 'bad' : 'ok'}" aria-pressed="${f.sev === 'error'}"><b data-countup="${r.counts.error}">${r.counts.error}</b><span>⛔ 오류</span></button>
        <button type="button" class="dc-lint-big" data-dc="lint-sev" data-sev="warn" data-tone="${r.counts.warn ? 'warn' : 'ok'}" aria-pressed="${f.sev === 'warn'}"><b data-countup="${r.counts.warn}">${r.counts.warn}</b><span>⚠️ 경고</span></button>
        <button type="button" class="dc-lint-big" data-dc="lint-sev" data-sev="info" data-tone="info" aria-pressed="${f.sev === 'info'}"><b data-countup="${r.counts.info}">${r.counts.info}</b><span>💡 참고</span></button>
        <div class="dc-lint-meta">
          <p>${r.counts.error ? '오류는 게임이 깨질 수 있는 잘못된 참조예요. 먼저 고쳐 주세요.' : '치명적인 데이터 오류가 없어요! 🎉'}</p>
          <p class="muted small">${esc(dateTime(r.at))} 검사 · ${r.ms.toFixed(1)} ms</p>
          <button type="button" class="btn btn-primary btn-sm" data-dc="relint">🔁 다시 검사</button>
        </div>
      </section>
      <div class="dc-cat-grid dc-in" style="--i:1">
        ${Object.entries(LINT_CATS).map(([id, c]) => { const v = r.byCat[id]; const tone = v.error ? 'bad' : v.warn ? 'warn' : 'ok'; return `<button type="button" class="dc-cat" data-dc="lint-cat" data-cat="${id}" data-tone="${tone}" aria-pressed="${f.cat === id}"><span class="dc-cat-emoji" aria-hidden="true">${c.emoji}</span><b>${esc(c.label)}</b><small>${fmt(v.checked)}건 검사</small><span class="dc-cat-counts">${v.error ? `<i data-s="error">⛔${v.error}</i>` : ''}${v.warn ? `<i data-s="warn">⚠️${v.warn}</i>` : ''}${v.info ? `<i data-s="info">💡${v.info}</i>` : ''}${!v.error && !v.warn && !v.info ? '<i data-s="ok">✅</i>' : ''}</span></button>`; }).join('')}
      </div>
      <section class="dc-card dc-in" style="--i:2"><h4>📦 데이터 규모</h4><div class="dc-chips">${ENT.map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div></section>
      <section class="dc-card dc-in" style="--i:3">
        <div class="dc-toolbar">
          <div class="seg" role="group" aria-label="심각도">${[['all', '전체'], ['error', '⛔ 오류'], ['warn', '⚠️ 경고'], ['info', '💡 참고']].map(([v, l]) => `<button type="button" class="${f.sev === v ? 'active' : ''}" data-dc="lint-sev" data-sev="${v}">${l}</button>`).join('')}</div>
          ${f.cat !== 'all' ? `<button type="button" class="chip chip-gold" data-dc="lint-cat" data-cat="all">${esc(LINT_CATS[f.cat]?.label || f.cat)} ✕</button>` : ''}
          <label class="dc-search"><span aria-hidden="true">🔎</span><input type="search" data-dc-search data-dc-input="lint" placeholder="ID·메시지 검색 ( / )" value="${esc(f.q)}" aria-label="검사 결과 검색"></label>
        </div>
        <div id="dc-lint-list"></div>
      </section>`;
    renderLintList(b);
  };
  function renderLintList(scope) {
    const box = scope.querySelector('#dc-lint-list');
    if (!box) return;
    const r = Lint.get();
    const f = ui.lint;
    const q = f.q.trim().toLowerCase();
    const list = r.issues.filter((i) => (f.sev === 'all' || i.sev === f.sev) && (f.cat === 'all' || i.cat === f.cat) && (!q || `${i.ref} ${i.msg}`.toLowerCase().includes(q)));
    if (!list.length) { box.innerHTML = emptyBox(r.issues.length ? '조건에 맞는 항목이 없어요.' : '검사 결과가 깨끗해요! 모든 참조가 올바르게 연결돼 있어요.', 'cheer'); return; }
    const LIMIT = 300;
    box.innerHTML = `<ul class="dc-issues">${list.slice(0, LIMIT).map((i) => `<li data-sev="${i.sev}"><span class="dc-issue-sev" title="${SEV[i.sev].label}">${SEV[i.sev].emoji}</span><span class="chip">${LINT_CATS[i.cat]?.emoji || ''} ${esc(LINT_CATS[i.cat]?.label || i.cat)}</span>${i.ref ? mono(i.ref) : ''}<span class="dc-issue-msg">${esc(i.msg)}</span></li>`).join('')}</ul>${list.length > LIMIT ? `<p class="dc-note">… 외 ${list.length - LIMIT}건 (검색으로 좁혀 보세요)</p>` : ''}`;
  }

  RENDER.save = (b) => {
    const st = G.state;
    const ls = lsUsage();
    const accounts = (() => { try { return G.auth?.accounts?.() || []; } catch (e) { return []; } })();
    const cur = G.auth?.current;
    const server = G.net?.mode === 'server';
    b.innerHTML = `
      <section class="dc-card dc-in" style="--i:0"><h4>🧾 현재 저장 상태</h4>
        ${st ? `<dl class="dc-kv dc-kv-3">${kvRows([
          ['저장 방식', server ? '🌐 서버 DB (검증 저장)' : '💻 이 브라우저 (localStorage · 백업본 + 체크섬)'],
          ['프로필', `${esc(cur ? kindLabel(cur.kind) : '-')} · ID ${mono(String(st.profile?.id || '-').slice(0, 40))}`],
          ['상태 버전', `v${esc(st.version)} <span class="muted">(현재 v${esc(G.save.STATE_VERSION)})</span>`],
          ['크기', `${kb(stateSize())} <span class="muted">(서버 한도 ${kb(num(G.data.serverLimits?.saveMaxBytes, 1500000))})</span>`],
          ['마지막 저장', `${esc(dateTime(st.savedAt))} <span class="muted">(${esc(ago(G.save.lastSavedAt || st.savedAt))})</span>`],
          ['변경 대기', G.save.dirty ? pill('warn', '저장 대기 중') : pill('ok', '모두 저장됨')],
          ['진행', `Lv.${esc(st.stats?.level)} · 코인 ${fmt(st.stats?.coin)} · 퀘스트 ${Object.keys(st.quests || {}).length} · 일지 ${(st.journal || []).length} · 사진 ${(st.photos || []).length}`],
        ])}</dl>
        <div class="dc-row wrap dc-actions">
          <button type="button" class="btn btn-primary btn-sm" data-dc="save-now">💾 지금 저장</button>
          <button type="button" class="btn btn-soft btn-sm" data-dc="save-export">⬇️ 내보내기 (.json)</button>
          <button type="button" class="btn btn-soft btn-sm" data-dc="save-import">⬆️ 가져오기</button>
          <button type="button" class="btn btn-danger btn-sm" data-dc="save-reset">♻️ 진행 초기화</button>
        </div>
        <p class="dc-note">가져온 파일은 검증·정규화(normalize)된 뒤 적용돼요.${server ? ' 서버 모드에서는 서버가 다시 검사해 부정 진행이면 서버 저장본으로 되돌려요.' : ''}</p>` : emptyBox('게임에 입장하면 저장 상태와 상태 트리를 볼 수 있어요.', 'sleepy')}
      </section>
      ${st ? `<section class="dc-card dc-in" style="--i:1"><div class="dc-card-head"><h4>🌳 G.state 트리 <span class="muted">(읽기 전용 · 클릭해서 펼치기)</span></h4><button type="button" class="btn btn-ghost btn-sm" data-dc="tree-refresh">↻ 새로 읽기</button></div><div class="dc-tree" id="dc-tree"></div></section>` : ''}
      <div class="dc-grid2">
        <section class="dc-card dc-in" style="--i:2"><h4>🗝️ localStorage 키 <span class="muted">${kb(ls.total)}</span></h4>
          ${ls.blocked ? '<p class="dc-note">⚠️ 저장소 접근이 차단돼 있어요.</p>' : `<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>키</th><th>종류</th><th>크기</th></tr></thead><tbody>${ls.rows.map((r) => `<tr><td>${mono(r.key)}</td><td>${r.emoji} ${esc(r.kind)}</td><td class="dc-num">${kb(r.bytes)}</td></tr>`).join('')}</tbody></table></div><p class="dc-note">값은 보여 주지 않아요. 계정 키에는 PBKDF2 해시만 들어 있어요.</p>`}
        </section>
        <section class="dc-card dc-in" style="--i:3"><h4>👥 이 브라우저의 로컬 계정 <span class="muted">${accounts.length}개</span></h4>
          ${server ? '<p class="dc-note">서버 모드에서는 계정이 서버 DB 에 있어요. 관리는 admin.php 에서 하세요.</p>' : ''}
          ${accounts.length ? `<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>닉네임</th><th>이메일</th><th>권한</th><th>보호</th><th>가입</th><th>마지막 접속</th></tr></thead><tbody>${accounts.map((a) => `<tr><td><b>${esc(a.nickname)}</b>${cur?.id === a.id ? ' <span class="chip chip-green">나</span>' : ''}</td><td>${esc(maskEmail(a.email))}</td><td>${a.role === 'admin' ? pill('gold', '관리자') : '사용자'}</td><td>${/pbkdf2/i.test(String(a.algo || '')) ? pill('ok', `PBKDF2 ${fmt(num(a.iter))}회`) : pill('warn', '이전 방식 (다음 로그인 때 갱신)')}</td><td>${esc(U.formatDate(num(a.createdAt)))}</td><td>${esc(ago(num(a.lastLogin)))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dc-note">로컬 계정이 없어요 (게스트만 사용).</p>'}
        </section>
      </div>`;
    if (st) renderTree(b.querySelector('#dc-tree'));
  };
  function renderTree(box) {
    if (!box) return;
    box.textContent = '';
    if (!G.state) return;
    box.appendChild(treeNode('G.state', G.state, 0));
  }
  function treeNode(key, val, depth) {
    const isArr = Array.isArray(val);
    const kind = val === null ? 'null' : isArr ? 'array' : typeof val;
    if (kind === 'object' || kind === 'array') {
      const det = document.createElement('details');
      det.className = 'dc-tn';
      const sum = document.createElement('summary');
      const k = document.createElement('span'); k.className = 'dc-tn-key' + (String(key).startsWith('_') ? ' dim' : ''); k.textContent = String(key);
      const n = isArr ? val.length : Object.keys(val).length;
      const t = document.createElement('span'); t.className = 'dc-tn-type'; t.textContent = isArr ? `[${n}]` : `{${n}}`;
      sum.append(k, t);
      det.appendChild(sum);
      let built = false;
      const buildKids = () => {
        if (built) return;
        built = true;
        const kids = document.createElement('div');
        kids.className = 'dc-tn-kids';
        const entries = isArr ? val.map((v, i) => [i, v]) : Object.entries(val);
        const LIMIT = 150;
        for (const [ck, cv] of entries.slice(0, LIMIT)) kids.appendChild(treeNode(ck, cv, depth + 1));
        if (entries.length > LIMIT) { const m = document.createElement('div'); m.className = 'dc-tn-more'; m.textContent = `… 외 ${entries.length - LIMIT}개`; kids.appendChild(m); }
        det.appendChild(kids);
      };
      det.addEventListener('toggle', () => { if (det.open) buildKids(); });
      if (depth === 0) { det.open = true; buildKids(); }
      return det;
    }
    const row = document.createElement('div');
    row.className = 'dc-tn-leaf';
    const k = document.createElement('span'); k.className = 'dc-tn-key' + (String(key).startsWith('_') ? ' dim' : ''); k.textContent = String(key);
    const v = document.createElement('span'); v.className = `dc-tn-val t-${kind}`;
    if (kind === 'string') {
      const s = val;
      if (/^data:image\//.test(s)) v.textContent = `🖼️ [이미지 데이터 ${kb(s.length)}]`;
      else v.textContent = JSON.stringify(s.length > 160 ? `${s.slice(0, 160)}…` : s) + (s.length > 160 ? ` (${fmt(s.length)}자)` : '');
    } else if (kind === 'number' && Number.isFinite(val) && val > 1.5e12 && val < 4e12) v.textContent = `${val}  🕒 ${dateTime(val)}`;
    else v.textContent = String(val);
    row.append(k, v);
    return row;
  }

  RENDER.server = (b) => {
    const server = G.net?.mode === 'server';
    const httpish = /^https?:$/.test(location.protocol);
    if (!server) {
      b.innerHTML = `
        <section class="dc-hero dc-hero-2 dc-in" data-tone="info" style="--i:0">
          <div class="dc-hero-mascot" aria-hidden="true">${mascot('think', 88)}</div>
          <div class="dc-hero-text"><div class="dc-eyebrow">LOCAL MODE</div><h3>💻 지금은 로컬 모드예요</h3>
            <p>게임이 ${httpish ? `이 주소(${esc(location.host)})에서 <code>api/ping.php</code> 를 찾지 못해` : '파일(file://)로 열려서'} 이 브라우저(localStorage)에 저장하고 있어요. 서버 점검은 서버 모드에서만 실행돼요.</p>
            <div class="dc-row wrap">${httpish ? '<button type="button" class="btn btn-primary btn-sm" data-dc="srv-detect">🔁 서버 다시 찾기</button>' : ''}<button type="button" class="btn btn-soft btn-sm" data-dc="doc-open" data-doc="README-SERVER.md">📚 서버 안내 문서</button></div>
          </div>
        </section>
        <section class="dc-card dc-in" style="--i:1"><h4>🐘 서버 모드 켜는 법</h4>
          <ol class="dc-steps">
            <li><b>빌드</b> — <code>node tools/build.mjs</code> → <code>dist/metaverse/</code> (index.html + PHP 서버 파일)</li>
            <li><b>XAMPP</b> — 그 폴더를 <code>C:\\xampp\\htdocs\\metaverse</code> 로 복사하고 Apache 시작 (SQLite 기본, MySQL 선택)</li>
            <li><b>접속</b> — <code>http://localhost/metaverse/</code> → 화면 위 칩이 <b>서버</b> 인지 확인</li>
            <li><b>관리자</b> — 서버 PC 에서 <code>admin.php</code> 로그인 → "이 계정을 관리자로 지정"</li>
            <li><b>점검</b> — 이 탭의 "점검 실행" 과 admin.php 의 시스템 점검에서 ⛔/⚠️ 를 모두 해결</li>
            <li><b>개발용</b> — <code>php -S 127.0.0.1:8080 -t dist/metaverse</code> 후 <code>node tests/server-e2e.mjs http://127.0.0.1:8080/</code></li>
          </ol>
          <p class="dc-note">⚠️ 운영은 반드시 HTTPS 로 하세요. 로컬 모드는 서버가 없어 클라이언트 저장이 전부라 부정 진행을 막을 수 없어요.</p>
        </section>`;
      return;
    }
    const si = G.net.serverInfo || {};
    const S = ui.srv;
    const res = S.results;
    b.innerHTML = `
      <section class="dc-card dc-in" style="--i:0"><div class="dc-card-head"><h4>🌐 서버 연결</h4><button type="button" class="btn btn-primary btn-sm" data-dc="srv-run" ${S.running ? 'disabled' : ''}>${S.running ? '⏳ 점검 중…' : '▶ 점검 실행'}</button></div>
        <dl class="dc-kv dc-kv-3">${kvRows([
          ['API', `${esc(si.app || '-')} v${esc(si.version || '?')}`], ['DB', esc(si.db || '?')], ['주소', mono(`${location.origin}${location.pathname.replace(/[^/]*$/, '')}${G.net.base}`)],
          ['CSRF 토큰', G.net.csrf ? pill('ok', '보유 (값은 숨김)') : pill('warn', '없음')], ['서버 시계 차이', `${fmt(Math.round(G.time.serverOffset || 0))} ms`],
          ['로그인', G.auth?.current ? `${esc(kindLabel(G.auth.current.kind))} · ${G.auth.current.role === 'admin' ? pill('gold', '관리자') : '사용자'}` : '로그인 전'],
          ['HTTPS', yes(location.protocol === 'https:', '사용 중', 'http — 운영 전 HTTPS 필요')],
        ])}</dl>
      </section>
      <section class="dc-card dc-in" style="--i:1"><h4>📡 읽기 전용 엔드포인트 점검 ${S.at ? `<span class="muted">${esc(ago(S.at))}</span>` : ''}</h4>
        ${res ? `<div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>엔드포인트</th><th>용도</th><th>결과</th><th>응답 시간</th><th>비고</th></tr></thead><tbody>${res.map((r) => `<tr><td>${mono(r.path)}</td><td>${esc(r.label)}</td><td>${pill(r.tone, r.text)}</td><td class="dc-num">${r.ms != null ? `${Math.round(r.ms)} ms` : '-'}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div>` : `<p class="dc-note">"점검 실행" 을 누르면 GET 요청만 보내요 (저장·채팅을 바꾸지 않아요).</p>`}
        ${S.err ? `<p class="dc-note">⚠️ ${esc(S.err)}</p>` : ''}
      </section>
      <section class="dc-card dc-in" style="--i:2"><h4>🩺 관리자 상태 점검 <span class="muted">(api/admin/health.php)</span></h4>${renderHealth(S.health)}</section>`;
  };
  const HEALTH_GROUP = { php: '🐘 PHP · 확장', security: '🔐 보안', files: '📁 폴더 · 권한', db: '🗃️ 데이터베이스', app: '🧩 앱 설정', server: '🖥️ 웹 서버', session: '🍪 세션' };
  function renderHealth(h) {
    if (!h) return '<p class="dc-note">점검을 실행하면 PHP·확장·DB·폴더 권한·세션·HTTPS·보안 헤더 점검 결과가 여기에 나와요. (관리자 또는 관리자가 없을 때의 서버 PC 만)</p>';
    if (h.error) return `<p class="dc-note">🔒 ${esc(h.error)}</p>`;
    const tone = (s) => (s === 'ok' || s === 'pass' ? 'ok' : s === 'warn' ? 'warn' : s === 'fail' || s === 'error' ? 'bad' : 'info');
    const icon = (s) => (tone(s) === 'ok' ? '✅' : tone(s) === 'warn' ? '⚠️' : tone(s) === 'bad' ? '⛔' : 'ℹ️');
    const checks = (Array.isArray(h.checks) ? h.checks : []).filter(isObj);
    const sm = isObj(h.summary) ? h.summary : null;
    const summary = sm ? `정상 ${num(sm.ok)} · 경고 ${num(sm.warn)} · 실패 ${num(sm.fail)}` : String(h.summary || h.status || '-');
    const item = (c) => `<li data-ok="${tone(c.status) === 'ok' ? 1 : 0}"><span>${icon(c.status)}</span><b>${esc(c.label || c.id)}</b><small>${esc(c.value ?? '')}${c.hint && tone(c.status) !== 'ok' ? ` — ${esc(c.hint)}` : ''}</small></li>`;
    const attention = checks.filter((c) => tone(c.status) === 'bad' || tone(c.status) === 'warn').sort((a, b) => (tone(a.status) === 'bad' ? 0 : 1) - (tone(b.status) === 'bad' ? 0 : 1));
    const groups = new Map();
    for (const c of checks) { const g = String(c.group || '기타'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
    const db = isObj(h.db) ? h.db : {};
    const ses = isObj(h.session) ? h.session : {};
    return `<div class="dc-row wrap">${pill(tone(h.status), `${icon(h.status)} ${esc(summary)}`)} <span class="muted small">PHP ${esc(h.php?.version || '-')} · DB ${esc(db.driver || '-')}${db.users != null ? ` (사용자 ${fmt(db.users)}명)` : ''} · 세션 ${ses.httponly ? 'HttpOnly' : '-'}${ses.samesite ? ` · SameSite=${esc(ses.samesite)}` : ''}${ses.secure ? ' · Secure' : ''} · 접근 ${esc(h.access || '-')}</span></div>
      ${attention.length ? `<div class="dc-sub-h">👀 먼저 확인할 항목 ${attention.length}개</div><ul class="dc-checks">${attention.map(item).join('')}</ul>` : '<p class="dc-note">✅ 경고·실패 항목이 없어요.</p>'}
      ${[...groups.entries()].map(([g, list]) => `<details class="dc-details"><summary>${esc(HEALTH_GROUP[g] || g)} · ${list.length}개 (${list.filter((c) => tone(c.status) === 'ok').length} 정상)</summary><ul class="dc-checks">${list.map(item).join('')}</ul></details>`).join('')}`;
  }
  const SERVER_CHECKS = [
    { path: 'ping.php', label: '서버 감지 · CSRF' },
    { path: 'time.php', label: '서버 시계' },
    { path: 'auth/me.php', label: '내 세션' },
    { path: 'player/get.php', label: '내 저장 읽기', size: true, auth: true },
    { path: 'ranking/top.php', label: '랭킹 읽기' },
    { path: 'chat/list.php?after=0&channel=all', label: '채팅 목록 읽기' },
    { path: 'admin/health.php?quick=1', label: '관리자 상태 점검', health: true },
  ];
  /** same-origin GET api/ping.php without touching G.net state -> data | null */
  async function probeServer() {
    if (!/^https?:$/.test(location.protocol)) return null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), 4000);
    try {
      const res = await fetch(`${G.net?.base || 'api/'}ping.php`, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: ctrl?.signal });
      const j = await res.json().catch(() => null);
      return j && j.success === true && j.data?.app === 'tfm-metaverse' ? j.data : null;
    } catch (e) { return null; } finally { clearTimeout(timer); }
  }
  async function runServerChecks() {
    const S = ui.srv;
    if (S.running || G.net?.mode !== 'server') return;
    S.running = true; S.err = ''; S.results = []; S.health = null;
    if (ui.tab === 'server') render();
    const loggedIn = G.auth?.current?.kind === 'server';
    for (const c of SERVER_CHECKS) {
      const t0 = perf();
      const row = { path: c.path, label: c.label, ms: null, tone: 'info', text: '…', note: '' };
      if (c.auth && !loggedIn) { row.tone = 'skip'; row.text = '⏭️ 건너뜀'; row.note = '서버 계정으로 로그인하면 확인해요'; S.results.push(row); continue; }
      try {
        const d = await G.net.request(c.path, { timeout: 9000, quiet: true });
        row.ms = perf() - t0;
        row.tone = 'ok'; row.text = '✅ 정상';
        if (c.path === 'ping.php') row.note = d?.app === 'tfm-metaverse' ? `v${d.version || '?'} · ${d.db || '?'}` : '예상과 다른 응답';
        else if (c.path === 'time.php') row.note = d?.serverTime ? `차이 ${Math.round(Number(d.serverTime) - Date.now())} ms` : '';
        else if (c.size) row.note = d?.save ? `저장 ${kb(JSON.stringify(d.save).length * 2)}` : '저장 없음';
        else if (c.path === 'auth/me.php') row.note = d && (d.user || d.id) ? '로그인됨' : '비로그인';
        if (c.health) S.health = d;
      } catch (e) {
        row.ms = perf() - t0;
        const st = Number(e?.status) || 0;
        if (st === 401 || st === 403 || /AUTH|FORBIDDEN|LOGIN/.test(String(e?.code))) { row.tone = 'warn'; row.text = '🔒 권한 필요'; row.note = String(e?.code || st); if (c.health) S.health = { error: e?.message || '관리자 권한이 필요해요.' }; }
        else if (st === 429) { row.tone = 'warn'; row.text = '⏳ 빈도 제한'; row.note = '잠시 후 다시'; }
        else { row.tone = 'bad'; row.text = '⛔ 실패'; row.note = `${e?.code || 'ERROR'}${st ? ` (HTTP ${st})` : ''}`; }
      }
      S.results.push(row);
      if (ui.tab === 'server' && ui.opened) render();
    }
    S.running = false; S.at = now();
    G.log.info('DEV', `server checks: ${S.results.filter((r) => r.tone === 'ok').length}/${S.results.length} ok`);
    if (ui.tab === 'server' && ui.opened) render();
  }

  RENDER.tests = (b) => {
    const r = Tests.result;
    const groups = [];
    for (const t of TESTS) if (!groups.includes(t.group)) groups.push(t.group);
    const byName = new Map((Tests.live?.results || r?.results || []).map((x) => [`${x.group}|${x.name}`, x]));
    b.innerHTML = `
      <section class="dc-test-head dc-in" style="--i:0">
        <button type="button" class="btn btn-primary btn-lg" data-dc="run-tests" ${Tests.running ? 'disabled' : ''}>${Tests.running ? '⏳ 실행 중…' : r ? '🔁 모두 다시 실행' : '▶ 모두 실행'}</button>
        <div class="dc-test-sum">
          ${r && !Tests.running ? `${pill(r.failed ? 'bad' : 'ok', `${r.failed ? '❌' : '✅'} ${r.passed}/${r.total} 통과`)} ${r.failed ? pill('bad', `실패 ${r.failed}`) : ''} ${r.skipped ? pill('skip', `⏭️ 건너뜀 ${r.skipped}`) : ''} <span class="muted small">${r.ms.toFixed(0)} ms · ${esc(ago(r.at))}</span>` : `<span class="muted">${TESTS.length}개 테스트 · 순수 계산과 안전한 시스템 호출만 써요 (실제 저장은 건드리지 않아요)</span>`}
          <div class="bar bar-lg dc-test-bar"><i style="width:${Tests.running ? ((Tests.live.done / Tests.live.total) * 100).toFixed(1) : r ? 100 : 0}%"></i></div>
        </div>
      </section>
      ${groups.map((g, gi) => {
        const list = TESTS.filter((t) => t.group === g);
        const res = list.map((t) => byName.get(`${t.group}|${t.name}`));
        const fail = res.filter((x) => x?.status === 'fail').length;
        return `<section class="dc-card dc-in dc-test-group" style="--i:${gi + 1}" data-tone="${fail ? 'bad' : res.every((x) => x) ? 'ok' : 'info'}"><h4>${esc(g)} <span class="muted small">${res.filter((x) => x?.status === 'pass').length}/${list.length}</span></h4>
          <ul class="dc-tests">${list.map((t, i) => { const x = res[i]; const s = x?.status || (Tests.running ? 'run' : 'wait'); return `<li data-s="${s}"><span class="dc-t-ico">${{ pass: '✅', fail: '❌', skip: '⏭️', run: '⏳', wait: '⚪' }[s]}</span><span class="dc-t-name">${esc(t.name)}</span>${x?.detail ? `<span class="dc-t-detail">${esc(x.detail)}</span>` : ''}<span class="dc-t-ms">${x ? `${x.ms.toFixed(1)} ms` : ''}</span></li>`; }).join('')}</ul></section>`;
      }).join('')}`;
  };
  function renderTestProgress(b) {
    const bar = b.querySelector('.dc-test-bar i');
    if (bar && Tests.live) bar.style.width = `${((Tests.live.done / Tests.live.total) * 100).toFixed(1)}%`;
  }
  async function runTestsUi() {
    if (Tests.running) return;
    const p = Tests.runAll({ onProgress: () => { if (ui.opened && ui.tab === 'tests') RENDER.tests(ui.body); } });
    if (ui.opened) render();
    const r = await p;
    if (ui.opened) render();
    toast(r.failed ? `자가 테스트: ${r.failed}개 실패했어요. 결과를 확인해 주세요.` : `자가 테스트 ${r.passed}개 모두 통과! 🎉`, r.failed ? 'warn' : 'success', r.failed ? '🧪' : '✅');
    if (!r.failed && !reduceMotion() && ui.opened) celebrate();
    return r;
  }
  function celebrate() {
    const host = ui.root?.querySelector('.dc-main');
    if (!host) return;
    const box = document.createElement('div');
    box.className = 'dc-confetti';
    box.setAttribute('aria-hidden', 'true');
    const E = ['🎉', '✨', '🌿', '🏺', '⭐', '🫘'];
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('span');
      s.textContent = E[i % E.length];
      s.style.left = `${5 + Math.random() * 90}%`;
      s.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
      s.style.setProperty('--dx', `${(Math.random() * 80 - 40).toFixed(0)}px`);
      box.appendChild(s);
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 2200);
  }

  RENDER.debug = (b) => {
    const a = access();
    const W = G.sys.weather;
    const st = !!G.state;
    const btn = (cmd, arg, label, on) => `<button type="button" class="dc-cheat${on ? ' on' : ''}" data-dc="cheat" data-cmd="${esc(cmd)}"${arg != null ? ` data-arg="${esc(arg)}"` : ''}${NEEDS_STATE.has(cmd) && !st ? ' disabled' : ''}>${label}</button>`;
    const zones = (G.data.zones || []).map((z) => btn('tp', z.id, `${esc(z.short || z.name)}`)).join('') + (G.data.pois || []).map((p) => btn('tp', p.id, `📌 ${esc(p.name)}`)).join('');
    const weathers = Object.entries(G.data.weather || {}).map(([id, w]) => btn('weather', id, `${({ CLEAR: '☀️', CLOUDY: '☁️', RAIN: '🌧️', FOG: '🌫️', SNOW: '❄️' })[id] || '🌤️'} ${esc(w.name)}`, W?.current === id)).join('');
    const q = G.settings.quality || 'auto';
    const log = CheatLog.list().slice(-14).reverse();
    b.innerHTML = `
      ${!a.ok ? '<p class="dc-note">🔒 권한이 없어 디버그 도구를 쓸 수 없어요.</p>' : ''}
      ${G.net?.mode === 'server' ? '<div class="notice-box dc-in" style="--i:0">🛡️ 서버 모드예요. 서버가 저장을 검증하므로 치트로 늘린 코인·경험치는 저장할 때 거부되고 서버 저장본으로 되돌아갈 수 있어요. 모든 명령은 기록돼요.</div>' : ''}
      ${!st ? '<div class="notice-box info dc-in" style="--i:0">🎮 게임에 입장하면 자원·퀘스트·농장 명령을 쓸 수 있어요. 날씨·표시·품질은 지금도 바꿀 수 있어요.</div>' : ''}
      <section class="dc-card dc-in dc-live-strip" style="--i:1"><div class="dc-dbg-live" data-live="dbg"></div></section>
      <div class="dc-cheat-grid">
        <section class="dc-card dc-in" style="--i:2"><h4>💰 자원</h4><div class="dc-cheats">${btn('coin', null, CHEAT_LABEL.coin)}${btn('exp', null, CHEAT_LABEL.exp)}${btn('edu', null, CHEAT_LABEL.edu)}${btn('seeds', null, CHEAT_LABEL.seeds)}${btn('ingredients', null, CHEAT_LABEL.ingredients)}${btn('decor', null, CHEAT_LABEL.decor)}${btn('save', null, CHEAT_LABEL.save)}</div></section>
        <section class="dc-card dc-in" style="--i:3"><h4>📜 퀘스트 · 튜토리얼</h4><div class="dc-cheats">${btn('objective', null, CHEAT_LABEL.objective)}${btn('claimall', null, CHEAT_LABEL.claimall)}${btn('tutorial', null, CHEAT_LABEL.tutorial)}</div></section>
        <section class="dc-card dc-in" style="--i:4"><h4>🌱 농장 · 발효</h4><div class="dc-cheats">${btn('grow', null, CHEAT_LABEL.grow)}${btn('water', null, CHEAT_LABEL.water)}${btn('ffwd', null, CHEAT_LABEL.ffwd)}${btn('ferment', null, CHEAT_LABEL.ferment)}${btn('ferment1', null, CHEAT_LABEL.ferment1)}</div></section>
        <section class="dc-card dc-in" style="--i:5"><h4>🌤️ 날씨 · 시간</h4><div class="dc-cheats">${weathers}</div>
          <div class="dc-cheats">${[[6.5, '🌅 아침 6:30'], [12, '☀️ 낮 12:00'], [18.5, '🌇 저녁 18:30'], [22, '🌙 밤 22:00']].map(([h, l]) => btn('hour', h, l)).join('')}${btn('autoWeather', null, CHEAT_LABEL.autoWeather, G.settings.autoWeather)}${btn('lockTime', null, CHEAT_LABEL.lockTime, G.settings.lockTime)}</div></section>
        <section class="dc-card dc-in dc-span2" style="--i:6"><h4>📍 순간이동 <span class="muted small">(누르면 센터가 닫히고 이동해요)</span></h4><div class="dc-cheats">${zones}</div></section>
        <section class="dc-card dc-in" style="--i:7"><h4>🖥️ 표시 · 품질</h4><div class="dc-cheats">${btn('colliders', null, CHEAT_LABEL.colliders, Cheats.colliders)}${btn('fps', null, CHEAT_LABEL.fps, G.settings.showFps)}${btn('easy', null, CHEAT_LABEL.easy, easyOn())}</div>
          <div class="dc-cheats">${[['low', '낮음'], ['medium', '중간'], ['high', '높음'], ['auto', '자동']].map(([v, l]) => btn('quality', v, `🖥️ ${l}`, q === v)).join('')}</div></section>
        <section class="dc-card dc-in" style="--i:8"><h4>🎬 연출 미리보기 <span class="muted small">(보상 지급 없음)</span></h4><div class="dc-cheats">${btn('fxConfetti', null, CHEAT_LABEL.fxConfetti)}${btn('fxCoins', null, CHEAT_LABEL.fxCoins)}${btn('fxStamp', null, CHEAT_LABEL.fxStamp)}${btn('fxLevel', null, CHEAT_LABEL.fxLevel)}${btn('mascot', null, CHEAT_LABEL.mascot)}</div></section>
      </div>
      <section class="dc-card dc-in" style="--i:9"><div class="dc-card-head"><h4>🧾 명령 기록 <span class="muted small">(이 브라우저 · 최근 50개)</span></h4>${log.length ? '<button type="button" class="btn btn-ghost btn-sm" data-dc="cheat-log-clear">기록 지우기</button>' : ''}</div>
        ${log.length ? `<ul class="dc-errlist dc-cheatlog">${log.map((l) => `<li><b>${l.ok ? '✅' : '⛔'} ${esc(dateTime(l.t))}</b><span>${esc(CHEAT_LABEL[l.cmd] || l.cmd)}${l.arg ? ` · ${esc(l.arg)}` : ''} <span class="muted">(${l.mode === 'server' ? '서버' : '로컬'})</span></span></li>`).join('')}</ul>` : '<p class="dc-note">아직 실행한 명령이 없어요.</p>'}
      </section>`;
    LIVE.debug(b);
  };
  async function runCheat(cmd, arg) {
    if (G.net?.mode === 'server' && !Cheats.serverConfirmed && ['coin', 'exp', 'edu', 'seeds', 'ingredients', 'decor', 'objective', 'claimall', 'grow', 'ffwd', 'ferment', 'ferment1'].includes(cmd)) {
      const ok = await confirmBox({ title: '서버 모드에서 치트를 쓸까요?', message: '서버가 저장을 검증해서 치트로 바뀐 진행은 거부되고 서버 저장본으로 되돌아갈 수 있어요. 테스트 계정에서만 사용하세요.', okText: '이해했어요, 실행', emoji: '🛡️' });
      if (!ok) return;
      Cheats.serverConfirmed = true;
    }
    const r = Cheats.run(cmd, arg);
    if (!r.silent) toast(r.msg, r.ok ? 'success' : 'warn', r.ok ? '🛠️' : undefined);
    if (r.ok && r.close) close();
    else if (ui.opened && ui.tab === 'debug') render();
  }

  RENDER.source = (b) => {
    const B = window.__BUILD__ || {};
    const man = new Map([...(B.manifest?.js || []), ...(B.manifest?.css || [])].map((f) => [f.name, f]));
    const fragErr = new Set((G.__fragmentErrors || []).map((e) => e.name));
    const skipped = new Map((B.manifest?.skipped || []).map((s) => [s.name, s.reason]));
    const docs = loadDocs();
    const totals = (list) => list.reduce((a, f) => ({ lines: a.lines + f.lines, bytes: a.bytes + f.bytes }), { lines: 0, bytes: 0 });
    const tj = totals(B.manifest?.js || []), tc = totals(B.manifest?.css || []);
    const unknown = [...man.keys()].filter((n) => !SOURCE_BY_NAME.has(n));
    const row = (g, f) => {
      const m = man.get(f.name);
      let status = '';
      if (g.dir === 'src/game' || g.dir === 'src/styles') status = skipped.has(f.name) ? pill('bad', '⏭️ 빌드 제외') : fragErr.has(f.name) ? pill('bad', '⛔ 실행 오류') : m ? pill('ok', '✅ 포함') : pill('skip', '— 빌드에 없음');
      else if (g.dir === 'docs') status = docs[f.name] ? pill('ok', '📄 내장') : pill('skip', '— 미포함');
      else if (f.name === 'README-SERVER.md') status = docs[f.name] ? pill('ok', '📄 내장') : '';
      return `<li class="dc-file" data-q="${esc(`${g.dir}/${f.name} ${f.purpose} ${OWNER[f.owner] || ''}`.toLowerCase())}"><span class="dc-file-ico" aria-hidden="true">${/\.css$/.test(f.name) ? '🎨' : /\.php$/.test(f.name) ? '🐘' : /\.md$/.test(f.name) ? '📄' : /\.sql$/.test(f.name) ? '🗃️' : /\.html$/.test(f.name) ? '🧱' : /\.json$/.test(f.name) ? '🧾' : '📜'}</span><span class="dc-file-main"><span class="dc-file-name">${mono(f.name)}</span><span class="dc-file-purpose">${esc(f.purpose)}</span></span><span class="chip dc-owner">${esc(OWNER[f.owner] || f.owner)}</span><span class="dc-file-stat">${m ? `${fmt(m.lines)}줄 · ${kb(m.bytes)} · ${mono(m.sha)}` : ''}</span>${status}</li>`;
    };
    const evNames = new Set([...Object.keys(EVENTS), ...[...Probe.bus.keys()].filter((n) => n !== 'dc:selftest')]);
    const evRows = [...evNames].sort().map((name) => {
      const s = EVENTS[name];
      const r = Probe.bus.get(name);
      const owners = r ? [...r.owners.entries()].sort((a, b2) => b2[1] - a[1]).map(([o, n]) => `${o}${n > 1 ? `×${n}` : ''}`).join(', ') : '';
      return `<tr data-q="${esc(`${name} ${s?.[0] || ''} ${s?.[1] || ''} ${s?.[2] || ''} ${owners}`.toLowerCase())}"><td>${mono(name)}${s ? '' : ' <span class="chip chip-purple">실행 중 발견</span>'}<div class="muted small">${esc(s?.[2] || '')}</div></td><td>${esc(s?.[0] || '—')}</td><td>${esc(s?.[1] || '—')}</td><td class="dc-num">${fmt(G.bus.count?.(name) || 0)}</td><td class="small">${esc(owners || '—')}</td><td class="dc-num">${r ? fmt(r.emits) : 0}</td><td class="small">${r?.last ? esc(ago(r.last)) : '—'}</td></tr>`;
    }).join('');
    b.innerHTML = `
      <div class="dc-toolbar dc-in" style="--i:0">
        <div class="dc-chips">${pill('info', `📜 JS ${fmt(tj.lines)}줄 · ${kb(tj.bytes)}`)} ${pill('info', `🎨 CSS ${fmt(tc.lines)}줄 · ${kb(tc.bytes)}`)} ${pill('info', `📚 문서 ${Object.keys(docs).length}개`)} ${pill('info', `🔔 이벤트 ${evNames.size}종`)}</div>
        <label class="dc-search"><span aria-hidden="true">🔎</span><input type="search" data-dc-search data-dc-input="source" placeholder="파일·역할·담당·이벤트 검색 ( / )" value="${esc(ui.srcQ)}" aria-label="소스 검색"></label>
      </div>
      ${SOURCE.map((g, gi) => `<details class="dc-card dc-folder dc-in" style="--i:${gi + 1}" ${gi < 2 ? 'open' : ''}><summary><span class="dc-folder-emoji" aria-hidden="true">${g.emoji}</span><b>${esc(g.dir)}</b><span class="muted small">${esc(g.desc)} · ${g.files.length}개</span></summary><ul class="dc-files">${g.files.map((f) => row(g, f)).join('')}</ul></details>`).join('')}
      ${unknown.length ? `<section class="dc-card dc-in"><h4>🆕 설명이 없는 새 파일</h4><p class="dc-note">80-devcenter.js 의 SOURCE 지도에 담당·역할을 추가해 주세요.</p><div class="dc-chips">${unknown.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div></section>` : ''}
      <section class="dc-card dc-in" style="--i:7"><h4>🔔 이벤트 흐름 지도 <span class="muted small">(정적 계약 + 부팅 이후 실시간 집계)</span></h4>
        <p class="dc-note">시스템끼리는 직접 부르지 않고 <code>G.bus.emit</code> 이벤트로 소통해요. "등록 모듈" 은 각 시스템의 init/onStateLoaded 중 등록된 구독을 센 값이에요 (boot = 시스템 밖).</p>
        <div class="dc-table-wrap"><table class="dc-table dc-ev"><thead><tr><th>이벤트</th><th>발행</th><th>주요 구독 (계약)</th><th>현재 구독</th><th>등록 모듈 (실시간)</th><th>발행 횟수</th><th>마지막</th></tr></thead><tbody>${evRows}</tbody></table></div>
      </section>`;
    filterSource(b, ui.srcQ);
  };
  function filterSource(scope, q) {
    const s = String(q || '').trim().toLowerCase();
    for (const el of scope.querySelectorAll('.dc-file[data-q], .dc-ev tr[data-q]')) el.hidden = !!s && !el.dataset.q.includes(s);
    if (s) for (const d of scope.querySelectorAll('details.dc-folder')) d.open = !!d.querySelector('.dc-file:not([hidden])');
  }

  // ---------------------------------------------------------------- docs
  const DOC_ORDER = ['HANDOVER.md', 'README.md', 'ARCHITECTURE.md', 'CONTRACT.md', 'README-SERVER.md'];
  const DOC_LABEL = { 'HANDOVER.md': '🤝 인수인계', 'README.md': '📘 README', 'ARCHITECTURE.md': '🏛️ 아키텍처', 'CONTRACT.md': '📜 모듈 계약서', 'README-SERVER.md': '🐘 서버 안내' };
  function loadDocs() {
    if (ui.docs) return ui.docs;
    let d = {};
    try {
      const el = document.getElementById('build-docs');
      const parsed = el ? JSON.parse(el.textContent || '{}') : {};
      if (isObj(parsed)) for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && /^[\w.-]{1,60}\.md$/.test(k)) d[k] = v.slice(0, 400000);
    } catch (e) { G.log.warn('DEV', 'build docs unreadable', e); d = {}; }
    ui.docs = d;
    return d;
  }
  function docList() {
    const d = loadDocs();
    return Object.keys(d).sort((a, b) => { const ia = DOC_ORDER.indexOf(a), ib = DOC_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
  }
  function docRendered(name) {
    if (!ui.docCache.has(name)) ui.docCache.set(name, Md.render(loadDocs()[name] || ''));
    return ui.docCache.get(name);
  }
  /** search across docs -> [{doc, id, line, snippet}] (heading ids follow the renderer's order) */
  function searchDocs(q) {
    q = String(q || '').trim();
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const out = [];
    for (const name of docList()) {
      const lines = loadDocs()[name].replace(/\r\n?/g, '\n').split('\n');
      const used = new Set();
      let id = null, heading = '', fence = null;
      for (const line of lines) {
        const fm = line.match(/^\s*(```|~~~)/);
        if (fm) { fence = fence ? null : fm[1]; }
        else if (!fence) {
          const hm = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
          if (hm) { id = Md.slug(hm[2], used); heading = hm[2].replace(/[`*]/g, ''); }
        }
        const i = line.toLowerCase().indexOf(ql);
        if (i < 0) continue;
        const a = Math.max(0, i - 36), z = Math.min(line.length, i + q.length + 60);
        const snippet = `${a > 0 ? '…' : ''}${esc(line.slice(a, i))}<mark>${esc(line.slice(i, i + q.length))}</mark>${esc(line.slice(i + q.length, z))}${z < line.length ? '…' : ''}`;
        out.push({ doc: name, id, heading, snippet });
        if (out.length >= 60) return out;
      }
    }
    return out;
  }
  RENDER.docs = (b) => {
    const list = docList();
    if (!list.length) { b.innerHTML = emptyBox('이 빌드에는 내장 문서가 없어요. tools/build.mjs 로 빌드하면 docs/*.md 가 들어가요.', 'sleepy'); return; }
    if (!ui.docId || !list.includes(ui.docId)) ui.docId = list.includes(store.get(LS.doc, '')) ? store.get(LS.doc, '') : list[0];
    const doc = docRendered(ui.docId);
    const results = searchDocs(ui.docQuery);
    b.innerHTML = `
      <div class="dc-docs">
        <aside class="dc-docs-side dc-in" style="--i:0">
          <label class="dc-search"><span aria-hidden="true">🔎</span><input type="search" data-dc-search data-dc-input="docs" placeholder="모든 문서 검색 ( / )" value="${esc(ui.docQuery)}" aria-label="문서 검색"></label>
          <div class="dc-doc-list" role="list">${list.map((n) => `<button type="button" class="dc-doc-btn${n === ui.docId ? ' active' : ''}" data-dc="doc-open" data-doc="${esc(n)}"><span>${esc(DOC_LABEL[n] || `📄 ${n.replace(/\.md$/, '')}`)}</span><small>${kb(loadDocs()[n].length * 2)}</small></button>`).join('')}</div>
          ${ui.docQuery.trim().length >= 2 ? `<div class="dc-sub-h">검색 결과 ${results.length}${results.length >= 60 ? '+' : ''}건</div><ul class="dc-doc-results">${results.map((r) => `<li><button type="button" data-dc="doc-jump" data-doc="${esc(r.doc)}" data-anchor="${esc(r.id || '')}"><b>${esc(DOC_LABEL[r.doc] || r.doc)}${r.heading ? ` › ${esc(r.heading.slice(0, 40))}` : ''}</b><span>${r.snippet}</span></button></li>`).join('') || '<li class="muted small">찾는 내용이 없어요.</li>'}</ul>` : ''}
          ${doc.toc.length ? `<div class="dc-sub-h">목차</div><nav class="dc-toc">${doc.toc.map((t) => `<a href="#" data-dc-anchor="${esc(t.id.replace(/^dcdoc-/, ''))}" data-lvl="${t.lvl}">${esc(t.text)}</a>`).join('')}</nav>` : ''}
        </aside>
        <article class="dc-md dc-in" style="--i:1" aria-label="${esc(ui.docId)}">${doc.html}</article>
      </div>`;
  };
  function scrollToAnchor(anchor) {
    if (!anchor || !ui.root) return;
    const a = String(anchor);
    const el = ui.root.querySelector(`#${CSS.escape(a.startsWith('dcdoc-') ? a : `dcdoc-${a}`)}`) || ui.root.querySelector(`#${CSS.escape(a)}`);
    if (el) { el.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }); el.classList.add('dc-flash'); setTimeout(() => el.classList.remove('dc-flash'), 1400); }
  }

  // ---------------------------------------------------------------- handover
  const HANDOVER = [
    { id: 'build', emoji: '🏗️', title: '빌드', items: [
      ['b1', '<code>npm install</code> 로 개발 도구(three · esbuild · playwright · pretendard)를 설치했어요'],
      ['b2', '<code>node tools/build.mjs</code> 가 <code>dist/metaverse/index.html</code> 을 만들고 경고가 없어요'],
      ['b3', '배포 전 <code>node tools/build.mjs --strict</code> (문법 오류 조각이 있으면 실패) 를 통과했어요'],
      ['b4', '모듈 상태 탭에서 "빌드에서 빠진 조각" 과 조각 오류가 0개예요'] ] },
    { id: 'test', emoji: '🧪', title: '테스트', items: [
      ['t1', '<code>node tools/smoke.mjs --params "autostart=1&amp;quality=low"</code> 결과가 ✔ SMOKE OK 예요'],
      ['t2', '자가 테스트 탭에서 "모두 실행" 이 전부 통과했어요'],
      ['t3', '데이터 검증 탭의 오류가 0건이에요 (경고는 이유를 확인)'],
      ['t4', '모바일(390×844, --mobile)과 그래픽 낮음에서 화면이 깨지지 않아요'],
      ['t5', '서버 모드라면 <code>node tests/server-e2e.mjs</code> 가 통과했어요'],
      ['t6', '<code>node tools/kid-audit.mjs</code> (쉬운 모드 화면 점검) 의 ⛔ 치명이 0건이에요'],
      ['t7', '시스템 점검 › 🖥️ GPU 안전이 모두 ✅ 이고 NaN 주입 테스트가 통과했어요'] ] },
    { id: 'deploy', emoji: '🚀', title: '배포', items: [
      ['d1', '<code>npm run package</code> 로 <code>release/fermentation-metaverse.zip</code> 을 만들었어요'],
      ['d2', '파일 실행판(전통발효체험관.html 더블클릭)이 인터넷 없이 동작해요'],
      ['d3', '웹 배포 시 HTTPS 를 적용하고 <code>metaverse/</code> 폴더 전체를 올렸어요'],
      ['d4', '배포 후 진단 보고서(.md)를 받아 버전·빌드 시각을 기록했어요'] ] },
    { id: 'server', emoji: '🐘', title: '서버 설정', items: [
      ['s1', 'XAMPP <code>htdocs/metaverse</code> 에 복사하고 Apache 를 시작했어요 (SQLite 기본)'],
      ['s2', '서버 PC 에서 <code>admin.php</code> 로 첫 관리자를 지정했어요'],
      ['s3', '<code>config/config.local.php</code> 에 DB·admin_emails·data 경로(웹 루트 밖)를 적었어요'],
      ['s4', '서버 점검 탭과 admin.php 시스템 점검의 ⛔/⚠️ 를 모두 해결했어요'],
      ['s5', 'data/ 폴더와 DB 백업 일정을 정했어요'] ] },
    { id: 'security', emoji: '🔐', title: '보안 점검', items: [
      ['x1', '시스템 점검의 CSP 항목이 모두 ✅ 이고 CSP 위반이 0건이에요'],
      ['x2', '새 코드에서 사용자 문자열은 <code>esc()</code>·textContent 로만 넣고 <code>onclick=</code> 같은 인라인 핸들러를 쓰지 않았어요'],
      ['x3', '로컬 계정이 PBKDF2 로 보호돼요 (저장 데이터 탭의 계정 목록)'],
      ['x4', '서버는 HTTPS · Secure 쿠키 · data/ 웹 접근 차단을 확인했어요'],
      ['x5', '관리자 비밀번호를 공유하지 않고, 인수인계 때 새로 바꿨어요'],
      ['x6', '자가 테스트 › 🔒 개인정보 가림 · 👶 쉬운 모드(보호자 확인) 가 통과하고, admin.php 의 "어린이 개인정보 가림" 점검이 ✅ 예요'] ] },
    { id: 'content', emoji: '✍️', title: '콘텐츠 추가 방법', items: [
      ['c1', '작물 추가 절차를 읽었어요 (HANDOVER.md §6 — items · crops · collection)'],
      ['c2', '퀘스트·NPC 대사·교육/퀴즈 추가 절차를 읽었어요'],
      ['c3', '추가한 뒤 데이터 검증 탭으로 교차 참조를 확인하는 습관을 들였어요'] ] },
    { id: 'issues', emoji: '🐞', title: '알려진 이슈', items: [
      ['k1', '저사양 GPU·헤드리스에서는 FPS 가 낮아요 → 품질 자동 하향 / 설정에서 낮음'],
      ['k2', '로컬 모드 저장은 브라우저마다 따로예요 → 정기적으로 내보내기 권장'],
      ['k3', '음성 입력은 HTTPS(또는 localhost)와 지원 브라우저에서만 돼요'],
      ['k4', '실시간 채팅은 폴링 방식이라 1~2초 지연이 있어요'] ] },
    { id: 'roadmap', emoji: '🗺️', title: '로드맵', items: [
      ['r1', 'GLB 고품질 모델 교체 (<code>G.data.modelOverrides</code>)'],
      ['r2', 'WebSocket 실시간 동기화 · WebRTC 음성 대화'],
      ['r3', '다국어(영어) 지원과 교사용 학급 대시보드'],
      ['r4', '자동 테스트를 CI(빌드 서버)에서 매번 실행'] ] },
  ];
  const GUIDE = [
    ['🌱 작물 추가', '01-data.js — items(씨앗·수확물) + crops + collection(COL_*)', '데이터 검증 › 아이템·작물'],
    ['📜 퀘스트 추가', '01-data.js quests (+ 26-dialogues.js 에 giver 대사)', '데이터 검증 › 퀘스트'],
    ['🏺 발효 레시피', '01-data.js recipes + items(fermented) + collection', '자가 테스트 › 발효 계산'],
    ['💬 NPC 대사', '26-dialogues.js nodes · choices · actions', '데이터 검증 › NPC·대화'],
    ['📖 교육·퀴즈', '45-education-data.js (EDU_* · QZ_*)', '데이터 검증 › 교육·퀴즈'],
    ['🏠 건물·소품 위치', '02-layout.js (좌표·회전)', '디버그 도구 › 충돌체 보기'],
    ['⚖️ 보상·밸런스', '01-data.js reward · farming · fermentation · serverLimits', '서버 저장 검증(SaveValidator)'],
    ['📅 출석·미션', '62-engagement.js (미션 풀·보상)', '참여 허브'],
    ['🎬 연출·파티클', '66-fx.js', '디버그 도구 › 연출 미리보기'],
    ['🏺 마스코트 대사', '65-companion.js (팁·대사)', '디버그 도구 › 옹이 한마디'],
    ['🎨 색·크기·글꼴', 'src/styles/00-base.css 디자인 토큰', '-'],
    ['⌨️ 단축키·도움말', '해당 모듈 init 의 G.input.onKey + 70-app.js 도움말', '-'],
    ['🔐 보안 정책(CSP)', 'tools/build.mjs (CSP 해시)', '시스템 점검 › 보안'],
    ['🐘 서버 API', 'server/api/*.php + server/lib/*.php', '서버 점검'],
    ['👶 쉬운 모드 화면', '08-easy.js (G.easy) + 각 모듈의 easy 분기 · 08-easy.css', '👶 쉬운 모드 점검 · tools/kid-audit.mjs'],
    ['🔒 개인정보 가림', '60-social.js maskPII + server/lib/ChatFilter.php (같은 규칙)', '자가 테스트 › 🔒 개인정보 가림 · server E2E'],
    ['🖥️ 검은 사각형(NaN)', '10-engine.js fixNormals · NaNScrubShader', '시스템 점검 › 🖥️ GPU 안전'],
  ];
  function handoverState() { const s = store.get(LS.handover, {}); return isObj(s) ? s : {}; }
  function handoverProgress() {
    const s = handoverState();
    let total = 0, done = 0;
    for (const g of HANDOVER) for (const [id] of g.items) { total++; if (s[id]) done++; }
    return { total, done };
  }
  RENDER.handover = (b) => {
    const s = handoverState();
    const p = handoverProgress();
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    const H = health();
    b.innerHTML = `
      <section class="dc-hero dc-hero-2 dc-in" data-tone="${pct === 100 ? 'ok' : 'info'}" style="--i:0">
        <div class="dc-hero-mascot" aria-hidden="true">${mascot(pct === 100 ? 'cheer' : 'happy', 84)}</div>
        <div class="dc-hero-text"><div class="dc-eyebrow">HANDOVER · 인수인계</div><h3>${pct === 100 ? '🎉 인수인계 준비 완료!' : `🤝 체크리스트 ${p.done}/${p.total}`}</h3>
          <div class="bar bar-lg bar-gold dc-hand-bar"><i style="width:${pct}%"></i><span>${pct}%</span></div>
          <p class="dc-note">체크 상태는 이 브라우저에 저장돼요. 현재 건강 점수 ${H.score}점 · 데이터 오류 ${H.lint.error}건 · 테스트 ${H.tests ? `${H.tests.passed}/${H.tests.total}` : '실행 전'}.</p>
          <div class="dc-row wrap"><button type="button" class="btn btn-soft btn-sm" data-dc="doc-open" data-doc="HANDOVER.md">📚 HANDOVER.md 읽기</button><button type="button" class="btn btn-ghost btn-sm" data-dc="handover-reset">체크 모두 해제</button></div>
        </div>
      </section>
      <div class="dc-hand-grid">
        ${HANDOVER.map((g, gi) => { const d = g.items.filter(([id]) => s[id]).length; return `<section class="dc-card dc-in dc-hand" style="--i:${gi + 1}" data-done="${d === g.items.length ? 1 : 0}"><h4>${g.emoji} ${esc(g.title)} <span class="muted small">${d}/${g.items.length}</span></h4><ul class="dc-checklist">${g.items.map(([id, html]) => `<li><label class="dc-check"><input type="checkbox" data-dc-check="${id}" ${s[id] ? 'checked' : ''}><span class="dc-box" aria-hidden="true"></span><span class="dc-check-text">${html}</span></label></li>`).join('')}</ul></section>`; }).join('')}
      </div>
      <section class="dc-card dc-in" style="--i:10"><h4>🧭 어디를 고치면 되나요?</h4>
        <div class="dc-table-wrap"><table class="dc-table"><thead><tr><th>하고 싶은 일</th><th>고칠 곳</th><th>확인하는 곳</th></tr></thead><tbody>${GUIDE.map(([a, f, c]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(f)}</td><td class="muted">${esc(c)}</td></tr>`).join('')}</tbody></table></div>
      </section>`;
  };

  // ---------------------------------------------------------------- delegated events
  async function onClick(e) {
    const anchor = e.target.closest('[data-dc-anchor]');
    if (anchor) { e.preventDefault(); scrollToAnchor(anchor.dataset.dcAnchor); return; }
    const link = e.target.closest('a[href]');
    if (link && link.getAttribute('href') === '#') { e.preventDefault(); return; }
    const el = e.target.closest('[data-dc]');
    if (!el || !ui.root.contains(el) || el.disabled) return;
    const act = el.dataset.dc;
    switch (act) {
      case 'tab': setTab(el.dataset.tab); return;
      case 'goto': closePop(); setTab(el.dataset.tab, { scrollTop: true }); return;
      case 'close': close(); return;
      case 'refresh': glInfo._c = null; if (ui.tab === 'data') Lint.run(); render(); toast('새로 읽었어요', 'info', '↻'); return;
      case 'report-menu': openReportMenu(el); return;
      case 'report': closePop(); await downloadReport(el.dataset.fmt); return;
      case 'run-tests': if (ui.tab !== 'tests' && !Tests.running) setTab('tests'); await runTestsUi(); return;
      case 'relint': Lint.run(); render(); toast(`데이터 검사 완료: 오류 ${Lint.result.counts.error} · 경고 ${Lint.result.counts.warn}`, Lint.result.counts.error ? 'warn' : 'success', '🔍'); return;
      case 'lint-sev': ui.lint.sev = ui.lint.sev === el.dataset.sev && el.classList.contains('dc-lint-big') ? 'all' : el.dataset.sev; render(); return;
      case 'lint-cat': ui.lint.cat = ui.lint.cat === el.dataset.cat ? 'all' : el.dataset.cat; render(); return;
      case 'mod-toggle': {
        const next = el.nextElementSibling;
        if (next?.classList.contains('dc-mod-detail')) { next.hidden = !next.hidden; el.setAttribute('aria-expanded', next.hidden ? 'false' : 'true'); el.classList.toggle('open', !next.hidden); }
        return;
      }
      case 'cheat': await runCheat(el.dataset.cmd, el.dataset.arg); return;
      case 'cheat-log-clear': CheatLog.clear(); render(); return;
      case 'save-now': { const ok = await G.save.save({ reason: 'manual', notify: true }); if (ui.opened) render(); if (!ok) toast('저장하지 못했어요. 로그를 확인해 주세요.', 'warn'); return; }
      case 'save-export': {
        if (!G.state) return;
        try { download(`tfm-save-${safeName(G.state.profile?.nickname)}-${stamp()}.json`, G.save.exportJSON(), 'application/json'); toast('저장 파일을 내보냈어요 ⬇️', 'success'); G.log.info('DEV', 'save exported'); }
        catch (err) { toast('내보내지 못했어요.', 'error'); G.log.error('DEV', 'export failed', err); }
        return;
      }
      case 'save-import': ui.root.querySelector('[data-dc-file="import"]')?.click(); return;
      case 'save-reset': {
        if (!G.state) return;
        const ok = await confirmBox({ title: '진행 상황을 처음부터 다시 시작할까요?', message: '레벨·코인·퀘스트·밭·장독·일지·사진이 모두 초기화돼요. 되돌릴 수 없으니 먼저 내보내기를 권장해요.', okText: '초기화', danger: true, emoji: '♻️' });
        if (!ok) return;
        try { await G.save.resetProgress(); toast('진행 상황을 초기화했어요.', 'success', '♻️'); G.log.warn('DEV', 'progress reset from dev center'); }
        catch (err) { toast('초기화하지 못했어요.', 'error'); G.log.error('DEV', 'reset failed', err); }
        if (ui.opened) render();
        return;
      }
      case 'tree-refresh': renderTree(ui.body.querySelector('#dc-tree')); return;
      case 'srv-run': await runServerChecks(); return;
      case 'kid-audit': KidAudit.run(); ui.kid.view = 'live'; render(); toast(`지금 화면: 치명 ${KidAudit.last.counts.critical} · 경고 ${KidAudit.last.counts.warn} · 참고 ${KidAudit.last.counts.info}`, KidAudit.last.counts.critical ? 'warn' : 'success', '👶'); return;
      case 'kid-tour': await kidTourUi(); return;
      case 'kid-easy': {
        const want = !easyOn();
        const on = await setEasy(want);
        if (on !== want) { toast('보호자 확인을 통과하지 않아 그대로예요 🔒', 'info', '👶'); return; }
        await nextFrame(); await nextFrame();
        KidAudit.run(); ui.kid.view = 'live';
        if (ui.opened) render();
        toast(on ? '쉬운 모드로 바꿨어요 👶' : '보통 모드로 바꿨어요 🧑', 'info', on ? '👶' : '🧑');
        return;
      }
      case 'kid-gate': await kidGateTest(); return;
      case 'kid-kind': ui.kid.kind = ui.kid.kind === el.dataset.kind || el.dataset.kind === 'all' ? 'all' : el.dataset.kind; render(); return;
      case 'kid-sev': ui.kid.sev = el.dataset.sev; renderKidList(ui.body); for (const x of ui.body.querySelectorAll('[data-dc="kid-sev"]')) x.classList.toggle('active', x.dataset.sev === ui.kid.sev); return;
      case 'kid-row': ui.kid.view = el.dataset.i === 'live' ? 'live' : Number(el.dataset.i); ui.kid.kind = 'all'; render(); setTimeout(() => ui.body.querySelector('#dc-kid-list')?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }), 40); return;
      case 'kid-show': {
        const it = kidItems().audit?.items?.[Number(el.dataset.i)];
        if (it) Spot.show(it.el, `${KID_SEV[it.sev].emoji} ${KID_KINDS[it.kind].emoji} ${it.detail}${it.text ? ` · “${it.text}”` : ''}`);
        return;
      }
      case 'gpu-scan': Gpu.scan(); render(); toast(Gpu.last?.ok ? 'GPU 안전 검사: 문제 없어요 ✅' : 'GPU 안전 검사: 살펴볼 곳이 있어요', Gpu.last?.ok ? 'success' : 'warn', '🖥️'); return;
      case 'gpu-fix': { const n = Gpu.fixAll(); Gpu.scan(); render(); toast(`노멀 ${fmt(n)}개를 고쳤어요 🔧`, 'success', '🖥️'); G.log.info('DEV', `fixed ${n} normals from the dev center`); return; }
      case 'gpu-nan': {
        el.disabled = true;
        await nextFrame();
        const r = Gpu.nanTest();
        Gpu.scan();
        render();
        toast(r.skip ? `NaN 테스트를 건너뛰었어요: ${r.detail}` : r.ok ? `NaN 주입 테스트 통과 ✅ (${(r.blackScrub * 100).toFixed(2)}% 검정)` : `NaN 주입 테스트 실패: ${r.detail}`, r.ok ? 'success' : 'warn', '🧪');
        return;
      }
      case 'srv-detect': {
        // probe only — never switch G.net.mode in the middle of a session (saves/chat would mix modes)
        el.disabled = true;
        const found = await probeServer();
        toast(found ? `서버(API v${String(found.version || '?').slice(0, 12)})가 응답해요! 새로고침하면 서버 모드로 시작해요.` : '서버(api/ping.php)를 찾지 못했어요. PHP 와 폴더 위치를 확인해 주세요.', found ? 'success' : 'warn', '🌐');
        if (ui.opened) render();
        return;
      }
      case 'doc-open': ui.docId = el.dataset.doc; store.set(LS.doc, ui.docId); if (ui.tab !== 'docs') { ui.tab = 'docs'; store.set(LS.tab, 'docs'); } render({ scrollTop: true }); ui.body.querySelector('.dc-md')?.scrollTo?.(0, 0); return;
      case 'doc-jump': {
        ui.docId = el.dataset.doc; store.set(LS.doc, ui.docId);
        render();
        const id = el.dataset.anchor;
        setTimeout(() => { if (id) scrollToAnchor(id); else ui.body.querySelector('.dc-md')?.scrollIntoView({ block: 'start' }); }, 30);
        return;
      }
      case 'handover-reset': {
        const ok = await confirmBox({ title: '체크리스트를 모두 해제할까요?', message: '이 브라우저에 저장된 인수인계 체크 표시가 지워져요.', okText: '모두 해제', emoji: '🤝' });
        if (ok) { store.del(LS.handover); render(); }
        return;
      }
      default:
    }
  }
  function onInput(e) {
    const el = e.target;
    const kind = el?.dataset?.dcInput;
    if (!kind) return;
    const v = String(el.value || '').slice(0, 80);
    if (kind === 'modules') { ui.modQ = v; filterRows(ui.body, v); }
    else if (kind === 'lint') { ui.lint.q = v; renderLintList(ui.body); }
    else if (kind === 'source') { ui.srcQ = v; filterSource(ui.body, v); }
    else if (kind === 'docs') {
      ui.docQuery = v;
      clearTimeout(onInput._t);
      onInput._t = setTimeout(() => {
        if (ui.tab !== 'docs' || !ui.opened) return;
        const pos = el.selectionStart;
        render();
        const s = ui.body.querySelector('[data-dc-input="docs"]');
        if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
      }, 220);
    }
  }
  async function onChange(e) {
    const el = e.target;
    if (el?.dataset?.dcCheck) {
      const s = handoverState();
      if (el.checked) s[el.dataset.dcCheck] = now(); else delete s[el.dataset.dcCheck];
      store.set(LS.handover, s);
      const sec = el.closest('.dc-hand');
      if (sec) {
        const boxes = sec.querySelectorAll('input[data-dc-check]');
        const d = Array.from(boxes).filter((x) => x.checked).length;
        sec.dataset.done = d === boxes.length ? '1' : '0';
        const m = sec.querySelector('h4 .muted'); if (m) m.textContent = `${d}/${boxes.length}`;
      }
      const p = handoverProgress();
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      const bar = ui.body.querySelector('.dc-hand-bar');
      if (bar) { bar.querySelector('i').style.width = `${pct}%`; bar.querySelector('span').textContent = `${pct}%`; }
      const h3 = ui.body.querySelector('.dc-hero h3');
      if (h3) h3.textContent = pct === 100 ? '🎉 인수인계 준비 완료!' : `🤝 체크리스트 ${p.done}/${p.total}`;
      if (pct === 100 && el.checked && !reduceMotion()) celebrate();
      badges();
      return;
    }
    if (el?.dataset?.dcFile === 'import') {
      const file = el.files?.[0];
      el.value = '';
      if (!file) return;
      if (!G.state) { toast('게임에 입장한 뒤에 가져올 수 있어요.', 'warn'); return; }
      if (file.size > 3 * 1024 * 1024) { toast('파일이 너무 커요 (최대 3 MB).', 'error'); return; }
      let text = '';
      try { text = await file.text(); } catch (err) { toast('파일을 읽지 못했어요.', 'error'); return; }
      let obj = null;
      try { obj = JSON.parse(text); } catch (err) { obj = null; }
      if (!obj || obj.app !== 'tfm-metaverse' || !isObj(obj.state)) { toast('전통발효체험관 저장 파일(.json)이 아니에요.', 'error'); return; }
      const lvl = num(obj.state.stats?.level, 1);
      const ok = await confirmBox({ title: '이 저장 파일을 가져올까요?', message: `현재 진행 상황을 덮어써요. (파일: Lv.${lvl} · 내보낸 시각 ${String(obj.exportedAt || '-').slice(0, 19).replace('T', ' ')})`, okText: '가져오기', danger: true, emoji: '⬆️' });
      if (!ok) return;
      try { await G.save.importJSON(text); G.log.info('DEV', 'save imported'); }
      catch (err) { toast(`가져오지 못했어요: ${String(err?.message || err).slice(0, 80)}`, 'error'); G.log.warn('DEV', 'import failed', err); }
      if (ui.opened) render();
    }
  }

  async function downloadReport(fmtKind = 'both') {
    toast('진단 보고서를 만드는 중이에요… (자가 테스트 포함)', 'info', '📥');
    try {
      const r = await buildReport();
      const base = `tfm-diagnostic-${stamp()}`;
      if (fmtKind === 'md' || fmtKind === 'both') download(`${base}.md`, reportMarkdown(r), 'text/markdown;charset=utf-8');
      if (fmtKind === 'json' || fmtKind === 'both') setTimeout(() => download(`${base}.json`, JSON.stringify(r, null, 2), 'application/json'), fmtKind === 'both' ? 350 : 0);
      G.log.info('DEV', `diagnostic report downloaded (${fmtKind})`);
      toast('진단 보고서를 내려받았어요 📥', 'success');
      if (ui.opened) render();
      return r;
    } catch (e) {
      G.log.error('DEV', 'report failed', e);
      toast('보고서를 만들지 못했어요.', 'error');
      return null;
    }
  }

  // =========================================================================== system
  const devcenter = {
    name: 'devcenter', order: 95, label: '개발자 센터',
    _fpsT: 0, _liveT: 0, _autoOpened: false,
    get opened() { return ui.opened; },
    get tab() { return ui.tab; },
    probe: Probe,

    init() {
      const appOk = () => { const a = G.sys.app; return !!a && !a._failed && a._initialized; };
      // Ctrl+Shift+D always; F9 / ` only when the app shell (which owns them) is missing or failed
      G.input?.onKey?.('KeyD', (e) => { if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return false; this.toggle(); return true; }, { allowInModal: true });
      const fk = () => { if (appOk()) return false; this.toggle(); return true; };
      G.input?.onKey?.('F9', fk, { allowInModal: true });
      G.input?.onKey?.('Backquote', fk, { allowInModal: true });
      if (!appOk()) G.ui.onAction('devcenter', () => this.open());
      G.ui.onEscape(() => {
        if (Spot.active) { Spot.hide(); return true; }
        if (Tour.running) return false; // the tour itself sends Escape to close kid overlays
        if (!ui.opened || ui.away) return false;
        if (ui.dialog) { closeDialog(false); return true; }
        if (ui.pop && !ui.pop.hidden) { closePop(); return true; }
        close();
        return true;
      }, 125);
      G.bus.on('dev:open', (p) => this.open(p?.tab));
      // kid-mode event logs for the 👶 tab (texts are prompts, never typed by the child)
      G.bus.on('easy:say', (p) => pushRing(KidLog.say, { at: now(), text: String(p?.text ?? '').replace(/\s+/g, ' ').slice(0, 140) }));
      G.bus.on('easy:gate', (p) => pushRing(KidLog.gate, { at: now(), reason: String(p?.reason ?? '').slice(0, 40), ok: !!p?.ok }));
      G.bus.on('easy:changed', () => {
        KidLog.changed++;
        if (!ui.opened || ui.away || ui.tab !== 'kids' || Tour.running) return;
        clearTimeout(this._kt);
        this._kt = setTimeout(() => { if (ui.opened && !ui.away && ui.tab === 'kids') { KidAudit.run(); render(); } }, 160);
      });
      G.log.info('DEV', `dev center ready (${TESTS.length} self tests, ${Object.keys(LINT_CATS).length} lint categories)`);
    },

    onStateLoaded() {
      if (!ui.opened) return;
      clearTimeout(this._rt);
      this._rt = setTimeout(() => { if (ui.opened) render(); }, 0);
    },

    onLogout() {
      close();
      if (Cheats.colliders) { Cheats.colliders = false; try { G.world.debugDraw?.(false); } catch (e) { /* ignore */ } }
      Cheats.serverConfirmed = false;
      Tests.result = null;
      ui.srv = { running: false, results: null, health: null, at: 0, err: '' };
      Spot.hide(true);
      if (Tour.running) Tour.stop = true;
      KidAudit.last = null; Tour.result = null; KidLog.say.length = 0; KidLog.gate.length = 0;
      ui.kid.view = 'live';
    },

    update(dt) {
      this._fpsT += dt;
      if (this._fpsT >= 0.5) {
        this._fpsT = 0;
        Probe.fps[Probe.fpsI] = num(G.sys.engine?.fps);
        Probe.fpsI = (Probe.fpsI + 1) % FPS_N;
        if (Probe.fpsN < FPS_N) Probe.fpsN++;
      }
      if (DEV_PARAM && !this._autoOpened) {
        const ls = document.getElementById('loading-screen');
        if (!ls || ls.hidden || ls.classList.contains('done')) {
          this._autoOpened = true;
          setTimeout(() => { if (!ui.opened) this.open('overview', { auto: true }); }, 450);
        }
      }
      if (!ui.opened) return;
      this._liveT -= dt;
      if (this._liveT <= 0) { this._liveT = 0.5; live(); }
    },

    // ---------------------------------------------------------------- public API
    open(tab, opts) { return open(tab, opts || {}); },
    close() { return close(); },
    toggle(tab) { if (ui.gating) return ui.gating; if (ui.opened && (!tab || normTab(tab) === ui.tab)) return close(); return open(tab); },
    isOpen() { return ui.opened; },
    setTab(tab) { if (normTab(tab)) setTab(tab, { scrollTop: true }); },
    lint() { return Lint.run(); },
    runTests() { return Tests.runAll(); },
    testCount() { return TESTS.length; },
    health() { return health(); },
    report() { return buildReport(); },
    reportMarkdown(r) { return reportMarkdown(r); },
    downloadReport(kind) { return downloadReport(kind); },
    cheat(cmd, arg) { return Cheats.run(cmd, arg); },
    access() { return { ...access() }; },
    renderMarkdown(src) { return Md.render(src).html; },
    docs() { return docList(); },
    /** 👶 audit of what is on screen; opts.scope may be an Element or a CSS selector (JSON-safe result) */
    kidAudit(opts = {}) {
      const o = { ...opts };
      if (typeof o.scope === 'string') o.scope = document.querySelector(o.scope) || undefined;
      return KidAudit.plain(KidAudit.run(o));
    },
    kidTour(opts) { return Tour.run(opts || {}).then((r) => Tour.plain(r)); },
    kidStop() { Tour.stop = true; },
    kidScreens() { return Tour.screens(); },
    easyStatus() { const e = easyStatus(); return { ...e, sayLog: e.sayLog.length, gateLog: e.gateLog }; },
    gpuScan() { return Gpu.scan(); },
    nanTest() { return Gpu.plainNan(Gpu.nanTest()); },
    showElement(el, caption) { return Spot.show(typeof el === 'string' ? document.querySelector(el) : el, caption); },
  };
  G.register(devcenter);
})();
