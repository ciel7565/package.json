// =============================================================================
// 60-social.js — chat, speech bubbles, emotes & gestures, simulated visitors (local mode), presence + chat
//                polling (server mode), voice dictation  (G.sys.social, order 80)
//
//   G.sys.social.others        Map id -> {id, name, kind:'visitor'|'remote', group, rig, position, rotY, zoneId}
//   G.sys.social.online        number of people online (me + others)
//   G.sys.social.messages      chat history (max 120): {id, name, text, channel:'all'|'local'|'system'|'npc', at, self, kind}
//   system(text) / npcSay(name, text) / sendChat(text, channel='all') -> bool / say(text) (my bubble)
//   emote(id) / gesture(id) / openEmotes(anchor?) / openGestures(anchor?) / toggleVoice()
//   setTab('all'|'local'|'system') / toggleChat(force?) / collapse(bool) / focusChat()
//   block(name) / unblock(name) / isBlocked(name) / report({name, id, text})
//   filter(text) -> bad words masked with '♡♡'
//   maskPII(text) -> phones / e-mails / URLs / SNS ids / addresses / schools -> 🔒 (all modes, in AND out; mirror of
//        server/lib/ChatFilter.php) · hasPII(text) · the sender gets a mascot tip "이름·전화번호·주소는 비밀이에요!"
//   쉬운 모드 (CONTRACT §12): openKidChat(anchor) — 💬 phrase picker (👋 인사 · 😊 기분 · 🙌 칭찬 · 🌱 놀이, 24 phrases +
//        an emoji row; no typing while easy && kidChat; replies are read aloud) · sendKidPhrase(id) · sendKidEmoji(e) ·
//        kidPhrases() · closeKidChat() · openExpress(anchor) — ONE picture picker for emotes + gestures (duplicates
//        merged) · express(id) · expressItems(). Normal mode: T / G open one merged popover (tabs 이모지 / 제스처).
//        Visitors talk in short kid lines; a tapped name opens a picture menu (👋 인사 · 📍 가까이 · 🙈 안 볼래요 ·
//        🚨 어른에게 = one-tap report + block); unblocking asks the parent gate.
// Actions: chat, chat-collapse, emote, gesture, voice (08-easy owns kid-chat / express and calls the methods above)
// Hotkeys: Enter (chat; kid chat → picker), T (emotes), G (gestures) — T/G open 표현하기 in 쉬운 모드, 1–8 in a picker.
// Events: chat:sent {text, channel} · chat:message {msg} · emote:played {emoteId} · gesture:played {gestureId} ·
//         kid:phrase {phraseId}
//
// Local mode: 8–11 visitors (G.avatar) walk a navigation graph built from the layout (paths, plaza, a coarse
// walkability grid and destination spots; A* + line-of-sight smoothing + local avoidance), sit on benches,
// water plots, pose at photo zones, chat in pairs, say lines from G.data.visitors.lines, react to the player's
// emotes / greetings / questions, and occasionally leave or arrive.
// Server mode (G.net.mode === 'server'): presence/update.php every 2 s (remote avatars with interpolation),
// chat/list.php?after= every 3 s, chat/send.php, chat/report.php; exponential back-off on network errors;
// guests (no account) can only read.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => U.angleDiff(a, b);
  const TAU = Math.PI * 2;
  const esc = U.escapeHtml;

  const MAX_MSG = 120, MAX_LEN = 120, RATE_MS = 1200, LOCAL_R = 30;
  const DUP_MS = 20000, BURST_N = 5, BURST_MS = 10000, BURST_COOL = 8000; // spam guard
  const LABEL_DIST = 40, HIDE_DIST = 90, FAR_DIST = 55, SLEEP_STEP = 0.5;  // visitors: hide + sleep beyond 90 m
  const MAX_REMOTES = 60, MAX_ROWS = 120, WORLD_LIM = 135;               // server payload limits
  const QUICK = ['EMO_HELLO', 'EMO_SMILE', 'EMO_THUMBS', 'EMO_CLAP', 'EMO_LIKE', 'EMO_LAUGH', 'EMO_WOW'];
  const DEFLECT = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]; // heading offsets tried when the way ahead is blocked
  const LS_COLLAPSED = 'tfm.v1.chat.collapsed', LS_TAB = 'tfm.v1.chat.tab', LS_REPORTS = 'tfm.v1.chat.reports';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };

  // fallbacks (G.data.visitors provides the main content)
  const FALLBACK = {
    mention: ['네, 불러 주셨어요? 😊', '저요? ㅎㅎ 반가워요!', '네~ 무슨 일이세요?'],
    agree: ['맞아요!', '저도요 ㅎㅎ', '좋아요~', '오 정말요?', '그러게요 ㅎㅎ'],
    congrats: ['레벨 업 축하해요! 🎉', '와, 축하드려요!', '축하합니다~ 👏'],
    chat: ['안녕하세요!', '멋진 공간이네요!', '오늘 날씨가 좋네요!'],
    greet: ['안녕하세요!', '반갑습니다!'], thanks: ['천만에요!'], question: ['저도 궁금해요!'],
  };

  // ---------------------------------------------------------------- korean particles
  function hasFinal(word) {
    const s = String(word ?? '').replace(/[\s)\]"'’”」』>]+$/, '');
    if (!s) return false;
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 > 0;
    return /[013678lmnr]$/i.test(s);
  }
  function finalIsRieul(word) {
    const s = String(word ?? '').trim();
    const c = s.charCodeAt(s.length - 1);
    return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
  }
  const J = {
    iga: (w) => w + (hasFinal(w) ? '이' : '가'),
    eulreul: (w) => w + (hasFinal(w) ? '을' : '를'),
    euro: (w) => w + (hasFinal(w) && !finalIsRieul(w) ? '으로' : '로'),
    nim: (w) => w + '님',
  };

  // ================================================================= text hygiene (every chat / name string is untrusted)
  // C0/C1 controls, soft hyphen, zero-width & joiners, bidi overrides/isolates (spoofing), BOM, Hangul fillers
  // (used for "blank" nicknames), interlinear annotation, ...
  const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad], [0x34f], [0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e],
    [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x3164], [0xfeff], [0xffa0], [0xfff0, 0xfffb], [0xe0000, 0xe007f]];
  // (server/lib/ChatFilter.php INVISIBLE_CLASS is the same list; Users::cleanText strips it on the server)
  const hexEsc = (n) => '\\' + 'u{' + n.toString(16) + '}';
  const INVISIBLE_RE = new RegExp('[' + INVISIBLE_RANGES.map(([a, b]) => (b ? hexEsc(a) + '-' + hexEsc(b) : hexEsc(a))).join('') + ']', 'gu');
  let MARKS_RE = null;
  try { MARKS_RE = new RegExp('(\\p{M}{2})\\p{M}+', 'gu'); } catch (e) { MARKS_RE = null; } // "zalgo" stacks
  /** NFC, invisible/control characters removed, whitespace collapsed, at most `max` code points */
  function cleanText(s, max = 120) {
    let t = String(s ?? '');
    if (t.length > max * 8) t = t.slice(0, max * 8);
    try { t = t.normalize('NFC'); } catch (e) { /* very old engine */ }
    t = t.replace(INVISIBLE_RE, ' ');
    if (MARKS_RE) t = t.replace(MARKS_RE, '$1');
    t = t.replace(/\s+/g, ' ').trim();
    const cps = Array.from(t);
    return cps.length > max ? cps.slice(0, max).join('').trim() : t;
  }
  const cpLen = (s) => Array.from(String(s)).length;
  const RESERVED = ['시스템', 'system', '운영자', '관리자', '운영진', 'admin', 'gm', '공지', '알림'];
  /** display name of another person: cleaned, never blank, cannot impersonate the system or an NPC */
  function cleanName(s, kind) {
    let n = cleanText(s, 20).replace(/[<>"'`]/g, '');
    if (!n) n = '체험객';
    if (kind === 'visitor' || kind === 'remote') {
      const low = n.toLowerCase();
      const npcNames = Object.values(G.data.npcs || {}).map((x) => String(x?.name || '').toLowerCase());
      if (RESERVED.includes(low) || npcNames.includes(low)) n = `${n}(체험객)`;
      n = maskBad(n);
      // a name that carries a phone number / e-mail / address / platform id / school is shown as a neutral name (§12.4)
      if (kind === 'remote' ? nicknameLooksPersonal(n) : maskPIIInfo(n).hits) n = '체험객';
    }
    return n;
  }

  // ================================================================= bad-word filter
  // Matching runs on a "skeleton" of the message that undoes common evasion tricks — spaces / dots / digits
  // between letters, zero-width characters, full-width letters, decomposed or spelled-out jamo (ㅅㅣㅂㅏㄹ),
  // l33t (sh1t) — and then masks the ORIGINAL characters of every match with ♡♡.
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', $: 's', '@': 'a', '!': 'i', '|': 'l', '+': 't', '*': '*' };
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  // ordinary words that contain a listed word (never masked)
  const ALLOW = ['시발점', '시발역', '시발택시', '시발자동차'];
  const isHangulCh = (k) => k === 'H' || k === 'J';
  /** conjoining jamo (U+1100…) -> compatibility jamo */
  function conj2compat(cp) {
    if (cp >= 0x1100 && cp <= 0x1112) return CHO[cp - 0x1100];
    if (cp >= 0x1161 && cp <= 0x1175) return JUNG[cp - 0x1161];
    if (cp >= 0x11a8 && cp <= 0x11c2) return JONG[cp - 0x11a7];
    return null;
  }
  /** -> { s: skeleton string, items: [{c, s, e}] } (items[i] maps skeleton char i to the source span [s, e)) */
  function skeleton(text) {
    const raw = [];
    let pos = 0;
    for (const ch of String(text)) {
      const s = pos; pos += ch.length;
      const cp = ch.codePointAt(0);
      if (cp >= 0xac00 && cp <= 0xd7a3) { raw.push({ c: ch, k: 'H', s, e: pos }); continue; }
      if (cp >= 0x3131 && cp <= 0x3163) { raw.push({ c: ch, k: 'J', s, e: pos }); continue; }
      if (cp >= 0x1100 && cp <= 0x11ff) { const m = conj2compat(cp); if (m) raw.push({ c: m, k: 'J', s, e: pos }); continue; }
      if (/\s/.test(ch)) { raw.push({ c: ' ', k: 'S', s, e: pos }); continue; }
      let n = ch;
      try { n = ch.normalize('NFKC'); } catch (e) { /* ignore */ }
      n = n.toLowerCase();
      if (/^[a-z]+$/.test(n)) { for (const x of n) raw.push({ c: x, k: 'L', s, e: pos }); continue; }
      if (LEET[n]) raw.push({ c: LEET[n], k: 'D', s, e: pos });
      // anything else (punctuation, emoji, symbols, digits used as separators) is ignored
    }
    // leet characters count only inside latin words ("sh1t"); between Hangul they are separators ("시1발")
    const latinNear = (i, dir) => { for (let j = i + dir; j >= 0 && j < raw.length; j += dir) { const k = raw[j].k; if (k === 'D') continue; return k === 'L'; } return false; };
    const kept = [];
    for (let i = 0; i < raw.length; i++) {
      const it = raw[i];
      if (it.k === 'D') { if (latinNear(i, -1) || latinNear(i, 1)) kept.push({ ...it, k: 'L' }); continue; }
      kept.push(it);
    }
    // whitespace: join when one of the neighbouring tokens is a single letter ("시 발", "f u c k"), else a word boundary
    const tokLen = (i, dir) => { let n = 0; for (let j = i + dir; j >= 0 && j < kept.length && kept[j].k !== 'S'; j += dir) n++; return n; };
    const joined = [];
    for (let i = 0; i < kept.length; i++) {
      const it = kept[i];
      if (it.k !== 'S') { joined.push(it); continue; }
      if (!joined.length || joined[joined.length - 1].c === '|') continue;
      const l = tokLen(i, -1), r = tokLen(i, 1);
      if (!r) continue;
      if (l === 1 || r === 1) continue;
      joined.push({ c: '|', k: 'B', s: it.s, e: it.e });
    }
    // compose spelled-out jamo into syllables: ㅅㅣㅂㅏㄹ -> 시발
    const out = [];
    for (let i = 0; i < joined.length; i++) {
      const a = joined[i], b = joined[i + 1];
      const ci = a.k === 'J' ? CHO.indexOf(a.c) : -1;
      const vi = b && b.k === 'J' ? JUNG.indexOf(b.c) : -1;
      if (ci >= 0 && vi >= 0) {
        let ti = 0, end = b.e, used = 2;
        const c = joined[i + 2], d = joined[i + 3];
        const tc = c && c.k === 'J' ? JONG.indexOf(c.c) : -1;
        if (tc > 0 && !(d && d.k === 'J' && JUNG.includes(d.c))) { ti = tc; end = c.e; used = 3; }
        out.push({ c: String.fromCharCode(0xac00 + (ci * 21 + vi) * 28 + ti), k: 'H', s: a.s, e: end });
        i += used - 1;
        continue;
      }
      out.push(a);
    }
    return { s: out.map((x) => x.c).join(''), items: out };
  }
  const BAD = { re: null, src: '' };
  function badRegex() {
    const words = Array.isArray(G.data.badWords) ? G.data.badWords : [];
    const key = words.join('|');
    if (BAD.src === key) return BAD.re;
    BAD.src = key;
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = [];
    for (const w0 of words) {
      const w = skeleton(String(w0 || '')).s.replace(/\|/g, '');
      if (!w) continue;
      // latin letters may repeat ("fuuuck") and vowels may be starred ("f*ck")
      parts.push([w.length, Array.from(w).map((ch) => (/[aeiou]/.test(ch) ? `[${ch}*]+` : /[a-z]/.test(ch) ? `${ch}+` : escRe(ch))).join('')]);
    }
    parts.sort((a, b) => b[0] - a[0]);
    try { BAD.re = parts.length ? new RegExp(parts.map((p) => p[1]).join('|'), 'g') : null; } catch (e) { BAD.re = null; }
    return BAD.re;
  }
  /** [[start, end), ...] source ranges of bad words in text */
  function badRanges(text) {
    const re = badRegex();
    if (!re || !text) return [];
    const sk = skeleton(text);
    if (!sk.s) return [];
    const allow = [];
    for (const w of ALLOW) { let i = -1; while ((i = sk.s.indexOf(w, i + 1)) >= 0) allow.push([i, i + w.length]); }
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sk.s))) {
      const a = m.index, b = a + m[0].length;
      if (b <= a) { re.lastIndex++; continue; }
      if (allow.some(([x, y]) => a >= x && b <= y)) continue;
      out.push([sk.items[a].s, sk.items[b - 1].e]);
    }
    return out;
  }
  function maskBad(text) {
    const t = String(text ?? '');
    const r = badRanges(t);
    if (!r.length) return t;
    let out = t;
    for (let i = r.length - 1; i >= 0; i--) out = out.slice(0, r[i][0]) + '♡♡' + out.slice(r[i][1]);
    return out;
  }
  // ================================================================= personal information (kid safety, CONTRACT §12.4)
  // >>> PII ENGINE — client mirror of server/lib/ChatFilter.php (same fold, same ordered rules, same predicates).
  // Keep both in sync: tests/pii-vectors.json is run on BOTH sides by tests/server-e2e.mjs + tests/pii-client.mjs
  // (which also diff client vs server output), and in the browser by the developer-center self-tests.
  //
  // How it works: the text is cut into units, one per code point, each carrying a "folded" form the rules see —
  // invisible / format characters and combining marks vanish, NFKC (０１０ ＠ ① ⁰ 𝟎 …), every digit script and the
  // dingbat / CJK numerals become ASCII digits, letters are lower-cased, O/l look-alikes inside digit tokens become
  // 0/1 and "k i d d i n o" spaced letters join up. Each match is mapped back to the ORIGINAL characters it covers,
  // so the shown text only changes where 🔒 replaces something (emoji, ZWJ sequences, spelling stay as typed).
  // Digit runs that look like counting (1 2 3 …, 10 20 30, 369 369 369, 1000000000, dates) are kept.
  const PII_MARK = '🔒';
  const PII_MAX = 400; // code points looked at (chat ≤ 120, reports ≤ 300); anything longer is cut
  const PR = String.raw;
  // ---- building blocks (the very same strings appear in ChatFilter.php)
  const P_SEP = PR`(?:[^\p{L}\p{N}🔒]|[ㄱ-ㆎ]|하고|그리고|(?:그\s?)?다음(?:에|으로)?|이랑(?=[\s0-9])|에|and|x)`;  // one separator unit between digit groups
  const P_GAP = `${P_SEP}{0,6}`;
  const P_KDW = PR`(?:다섯|여섯|일곱|여덟|아홉|하나|둘|셋|넷|[공영빵일이삼사오육륙칠팔구]|(?<![a-z])(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)(?![a-z])|[0-9])`;
  const P_JOSA = '(?:이야|이에요|이예요|예요|에요|이고|이랑|이요|이다|이라고|라고|입니다|야|요|고|랑|로|으로|번|이|가|은|는|을|를|에|도|만)';
  const P_COUNTER = '(?:코인|원|개|점|명|번|살|등|마리|씩|층|미터|킬로|그램|년|월|일|시|분|초|까지|사이|m|cm|km|g|kg|%)';
  const P_CITY = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북|충청남|전북|전남|전라북|전라남|경북|경남|경상북|경상남|제주)';
  const P_NOTCOUNT = '(?![0-9개번명층살점분초시원마리등위레렙일월년주판칸장권%])'; // "새로 30개", "2층으로 3번" are counts
  const P_LOT = PR`(?:\s*[0-9]{1,5}(?:\s*-\s*[0-9]{1,5})?` + P_NOTCOUNT + PR`(?:\s*번지)?)?`;
  // "ⓐ" folds to a plain "a": a lone "a" between spaces counts as an at-sign in front of a host + dot + TLD
  const P_AT = PR`(?:@|\(at\)|\[at\]|\{at\}|<at>|골뱅(?:이)?|앳|엣|에이티|(?<=\s)a(?=\s))`;
  const P_DOT = PR`(?:\.|。|\(dot\)|\[dot\]|\{dot\}|\(\.\)|\[\.\]|\{\.\}|닷|쩜|점|[•·ㆍ‧∙・])`;
  const P_TLDW = PR`(?:(?=[a-z0-9]*[a-z])[a-z0-9]{2,}|컴|넷|케이알|코리아)`;  // any e-mail TLD (c0m too)
  const P_TLD_STRONG = '(?:com|net|org|kr|io|gg|xyz|cc|jp|cn|tk|ml|ga|cf|gq|pw|ws|info|biz|club|online|site|shop|store|website|link|games?|app|dev)';
  const P_TLD_WEAK = '(?:me|to|be|us|co|so|ai|fm|tv|ly|top|fun|live|life|art|kids|chat|zone|today|world|space|page|pro|vip|lol|click|social)';
  const P_PROV = '(?:naver|gmail|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud|네이버|지메일|다음|한메일|카카오|네이트|핫메일|아웃룩|야후)';
  const P_SNS_KO = '(?:카톡|카카오톡|카카오|인스타(?:그램)?|틱톡|디엠|텔레그램|텔레|라인|디코|디스코드|페메|페북|페이스북|유튜브|트위터|스냅챗|위챗|왓츠앱|ㅋㅌ|ㅇㅅㅌ|아이디|아디)';
  const P_SNS_GAME = '(?:로블록스|로블|제페토|마인크래프트|마크|포트나이트|브롤스타즈|브롤|쿠키런|메이플|roblox|zepeto|minecraft|fortnite)';
  const P_SNS_EN = '(?:insta(?:gram)?|ig|tiktok|dm|telegram|line|discord|facebook|fb|youtube|yt|twitter|snapchat|snap|wechat|whatsapp|kakao(?:talk)?|roblox|zepeto|minecraft|fortnite|twitch)';
  const P_SNS_EN_PLAIN = '(?:insta(?:gram)?|ig|discord|tiktok|telegram|snapchat|snap|kakao(?:talk)?|roblox|zepeto|minecraft|fortnite|twitch|youtube|yt)';
  const P_FOLLOW = PR`(?:팔로우|팔로|follow|친추|친구\s*추가|친구|추가|add|놀러|들어와|와|검색|찾아|쳐(?:봐|봐요|보세요)?|구독|입력)`;
  const P_SNS_PART = '(?:에서는|에선|에서|에|으로|로|은|는|이|가)?';   // "로블록스에서 …", "제페토에 …"
  const P_POINT = PR`(?:[:：→➡👉=]|->|=>)`;                          // "인스타: dino", "insta → dino", "인스타 👉 dino"
  const P_ANY_SNS = '(?:' + P_SNS_KO + '|' + P_SNS_GAME + ')';
  const P_LATIN_ID = PR`[a-z0-9][a-z0-9._#\-]{2,}`;
  // an id that has a digit / _ . # (and a letter or _ . #: "dino12", "kid_7"); an all-digit id only from 5 digits up and
  // not followed by a counter word ("로블록스 100판 했어" stays, "로블록스 12345678" goes)
  const P_ODD_ID = PR`(?:(?=[a-z0-9._#\-]{3,})(?=[a-z0-9._#\-]*[a-z_.#])[a-z0-9]*[0-9_.#][a-z0-9._#\-]*|[0-9]{5,}(?![0-9가-힣]))`;
  const P_HANGUL_ID = PR`(?:[가-힣]{1,10}[0-9][가-힣0-9]{0,10}|[0-9]{1,10}[가-힣]{1,10})`;
  const P_KID_STOP = '(?:우리|오늘|내일|어제|이제|아직|저기|빨리|진짜|정말|엄마|아빠|동생|누나|언니|오빠|친구|같은|무슨|어느|옛날|다른|그냥|매일|요즘|지금)';
  /** [name, source, flags, predicate?] — ChatFilter::piiPatterns() has the same list in the same order */
  const PII_SRC = [
    // ---- e-mail: "kid@x.com", "kid 골뱅이 naver 닷 com", "kid(at)gmail(dot)com", "kid@gmail" (no TLD), "kid dot dino at gmail dot com"
    ['email', PR`[\p{L}\p{N}._%+\-]+\s*` + P_AT + PR`\s*[\p{L}\p{N}\-]+(?:\s*` + P_DOT + PR`\s*` + P_TLDW + ')+', 'giu'],
    ['emailWords', PR`[\p{L}\p{N}._%+\-]+(?:\s+dot\s+[\p{L}\p{N}._%+\-]+)*\s+at\s+[\p{L}\p{N}\-]+(?:\s+(?!dot\s)[a-z0-9\-]{1,12}){0,2}(?:\s+dot\s+(?=[a-z0-9]*[a-z])[a-z0-9]{2,})+`, 'giu'],
    ['emailHost', PR`[\p{L}\p{N}._%+\-]{2,}\s*(?:@|\(at\)|\[at\]|\{at\}|골뱅이|앳)\s*` + P_PROV + PR`(?![\p{L}\p{N}])`, 'giu'],
    ['emailHostAt', PR`(?<![\p{L}\p{N}._%+\-])(?!(?:look|looks|looking|meet|see|me|you|we|they|it|is|am|are|was|were|be|this|that|go|come|stay|play|eat|sit|wait|good|bad|laugh|smile|point|stare|arrive|here|there|home|school)\s)[\p{L}\p{N}._%+\-]{2,}\s+at\s+` + P_PROV + PR`(?![\p{L}\p{N}])`, 'giu'],
    ['emailNoTld', PR`[\p{L}\p{N}._%+\-]{2,}\s*@\s*[a-z][a-z0-9\-]{2,}(?![\p{L}\p{N}.@])`, 'giu'],               // "kid@protonmail"
    ['mailWord', PR`(?:이메일|메일)\s*(?:주소)?\s*(?:은|는|이|가|:)?\s*[a-z0-9][a-z0-9._%+\-]{2,}|e-?mail\s*(?:address\s*)?(?:is|:)\s*` + P_ODD_ID, 'giu'],
    // ---- links: scheme / www, invite & short links, bare domains, disguised dots, IP addresses
    ['url', PR`(?:https?|hxxps?):\/\/[^\s<>"]+|www\.[^\s<>"]+`, 'giu'],
    ['shortLink', PR`(?<![\p{L}\p{N}])(?:t\.me|discord\.gg|bit\.ly|youtu\.be|open\.kakao\.com|qr\.kakao\.com|band\.us|toss\.me|linktr\.ee|naver\.me)(?:\/[^\s<>"]*)?`, 'giu'],
    ['mailHost', PR`(?:naver|gmail|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud)\s*(?:\.|닷|쩜|점)\s*(?:com|net|co\s*\.\s*kr)(?![a-z])`, 'giu'],
    ['domain', PR`(?<![\p{L}\p{N}@.\-])(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)*(?:[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]\.` + P_TLD_STRONG + PR`|[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]\.` + P_TLD_WEAK + PR`)(?![a-z0-9])(?:\/[^\s<>"]*)?`, 'giu'],
    ['urlDot', PR`(?<![\p{L}\p{N}@.\-])[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]\s*(?:\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}|\[dot\]|\(dot\)|\{dot\}|\s+dot\s+|닷|쩜|점|\s\.\s?|\.\s)\s*(?:` + P_TLD_STRONG + PR`|컴|넷|케이알|코리아)(?![a-z0-9])`, 'giu'],
    // "bad,com" "bad。com" "bad·com" "bad[점]com" "bad(닷)com" "bad d0t com" "bad.c0m" (the common TLDs only: lists stay)
    ['urlDot2', PR`(?<![\p{L}\p{N}@.\-])[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]\s*(?:[,。、·•ㆍ‧∙・.]|\[\s*(?:점|닷|쩜)\s*\]|\(\s*(?:점|닷|쩜)\s*\)|\s+d[o0]t\s+)\s*(?:com|net|org|kr|c0m|n3t)(?![a-z0-9])`, 'giu'],
    ['shortLinkSpaced', PR`(?<![\p{L}\p{N}])(?:t|bit|discord|youtu|band|toss|linktr|naver)\s*(?:\.|점|닷|쩜)\s*(?:me|ly|gg|be|us|ee)\s*\/\s*[a-z0-9_\-]{2,}`, 'giu'],
    ['hangulDomain', PR`[가-힣a-z0-9]{2,15}\s?(?:닷|쩜|점)\s?(?:컴|넷)(?![가-힣])`, 'giu'],
    ['ip', PR`(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])`, 'gu'],
    // ---- messenger / SNS / game ids: "카톡 아이디 dino123", "로블록스 dino12 친추", "insta dinokid 팔로우해", "@dino 인스타로 와"
    ['handleKo', P_SNS_KO + PR`\s*(?:(?:아이디|아디|id|계정|주소|닉네임|닉|코드)\s*(?:은|는|이|가|:)?\s*@?(?:` + P_LATIN_ID + '|' + P_HANGUL_ID + PR`)|(?:은|는|이|가|:)?\s*(?:@` + P_LATIN_ID + '|' + P_ODD_ID + PR`|[a-z0-9]{6,}|` + P_LATIN_ID + PR`(?=\s*` + P_FOLLOW + ')|' + P_HANGUL_ID + '))', 'giu'],
    ['handleGame', P_SNS_GAME + PR`\s*(?:(?:아이디|아디|id|닉네임|닉|계정|친구\s*코드|코드)\s*(?:은|는|이|가|:)?\s*@?(?:` + P_LATIN_ID + '|' + P_HANGUL_ID + PR`)|@?(?:` + P_ODD_ID + '|' + P_LATIN_ID + PR`(?=\s*` + P_FOLLOW + ')))', 'giu'],
    // a platform with a particle / pointer / "친구 추가" before the id, a tag, a channel, or a nickname after "이름"
    ['handleKo2', P_SNS_KO + P_SNS_PART + PR`\s*(?:(?:친구\s*추가|친추|검색|팔로우|팔로|추가)(?:해|해줘|해요|하면)?\s*:?\s*@?` + P_LATIN_ID + PR`|(?:채널|태그)\s*(?:은|는|:)?\s*@?` + P_LATIN_ID + PR`|(?:으로|로)?\s*` + P_POINT + PR`\s*@?[a-z0-9][a-z0-9._#\-]{1,}|@?(?:` + P_ODD_ID + '|' + P_LATIN_ID + PR`(?=\s*` + P_FOLLOW + ')))', 'giu'],
    ['handleGame2', P_SNS_GAME + P_SNS_PART + PR`\s*(?:내\s*)?(?:(?:아이디|아디|id|닉네임|닉|이름|계정|친구\s*코드|코드|태그|tag)\s*(?:은|는|이|가|:)?\s*(?:[@#]?(?:` + P_LATIN_ID + '|' + P_HANGUL_ID + PR`)|[가-힣]{2,12}(?=\s*` + P_FOLLOW + PR`))|[@#]?(?:` + P_ODD_ID + '|' + P_LATIN_ID + PR`(?=\s*` + P_FOLLOW + ')))', 'giu'],
    ['handleEn2', PR`(?<![a-z0-9])` + P_SNS_EN + PR`\s*` + P_POINT + PR`\s*@?[a-z0-9][a-z0-9._#\-]{1,}`, 'giu'],
    ['discordTag', PR`(?:디코|디스코드|discord)\s*(?:아이디|id|:)?\s*[a-z0-9][a-z0-9._\-]{1,31}\s*#\s*[0-9]{4}(?![0-9])`, 'giu'],
    // the id first, the platform after: "dino77 카톡으로 와", "dinokid 인스타 팔로우해", "내 닉은 dinokid야 로블록스"
    ['idThenPlatform', PR`(?<![\p{L}\p{N}._#@\-])@?(?:(?=[a-z0-9._#\-]*[a-z])` + P_ODD_ID + PR`(?=\s*(?:` + P_SNS_KO + '|' + P_SNS_GAME + '|' + P_SNS_EN + PR`)(?:으로|로|에서|에|를|을)?(?![a-z]))|` + P_LATIN_ID + PR`(?=\s*` + P_ANY_SNS + PR`(?:으로|로|에서|에)?\s*` + P_FOLLOW + '))', 'giu'],
    ['nickThenPlatform', PR`(?:닉네임|닉|아이디|아디)\s*(?:은|는|이|가|:)?\s*@?[a-z0-9][a-z0-9._#\-]{2,}(?=(?:이야|야|이에요|예요|에요|이고|고|이요|요)?\s*` + P_ANY_SNS + ')', 'giu'],
    ['openChat', PR`(?:오픈채팅|오픈톡|오픈카톡|단톡)\s*(?:방)?\s*(?:이름|제목)?\s*(?:은|는|:)?\s*[가-힣a-z0-9][가-힣a-z0-9._#\-]+`, 'giu'],
    ['handleEn', PR`(?<![a-z0-9])` + P_SNS_EN + PR`\s*(?:id\s*:?|:|@)\s*@?` + P_LATIN_ID, 'giu'],
    ['handleEnPlain', PR`(?<![a-z0-9])` + P_SNS_EN_PLAIN + PR`\s+@?(?:` + P_ODD_ID + '|' + P_LATIN_ID + PR`(?=\s*` + P_FOLLOW + '))', 'giu'],
    ['atHandle', PR`(?<![\p{L}\p{N}])@[a-z0-9][a-z0-9._]{2,}(?=\s*(?:인스타|틱톡|디코|카톡|유튜브|트위터|로블록스|제페토|insta|tiktok|discord|youtube|twitter|roblox|zepeto|ig(?![a-z])))`, 'giu'],
    // ---- phone numbers: any separator between the groups ("010,1234,5678", "010😀1234😀5678", "010 하고 1234 …")
    ['phone', PR`(?<![0-9])(?:\+` + P_GAP + '82' + P_GAP + '0?|0)1[016789]' + P_GAP + '[0-9]{3,4}' + P_GAP + PR`[0-9]{4}(?![0-9])`, 'gu'],
    // any filler between the three groups of a mobile number ("010번 1234번 5678", "010 우리엄마 1234 5678", 7+ emoji)
    ['phoneLoose', PR`(?<![0-9])01[016789] *(?:[^0-9 ] *){0,12}[0-9]{3,4} *(?:[^0-9 ] *){0,12}[0-9]{4}(?![0-9])`, 'gu'], // ≤ 12 junk chars per gap, spaces free (a ZWJ family emoji becomes 4 emoji + 3 spaces after cleanText)
    ['landline', PR`(?<![0-9])0(?:2|[3-6][1-5]|70|50[0-9]?|80)` + P_GAP + '[0-9]{3,4}' + P_GAP + PR`[0-9]{4}(?![0-9])`, 'gu'],
    ['digits', PR`(?<![0-9])(?:[0-9]` + P_GAP + PR`){8,}[0-9](?![0-9])`, 'gu', piiNotCounting], // ≥ 9 digits: ids, cards, accounts
    ['localNumber', PR`(?<![0-9])[0-9]{3,4}\s*(?:[\p{Pd}−~.·•ㆍㅡᅳ]\s*)+[0-9]{4}(?![0-9])(?!\s*` + P_COUNTER + ')', 'gu'],
    ['telHint', PR`(?<![0-9])[0-9]{4}(?![0-9])(?=\s*(?:으로|로|번으로)?\s*(?:연락|전화|문자|카톡))`, 'gu'],
    ['phonePrefix', PR`(?<![0-9])01[016789]` + P_GAP + PR`[0-9]{3,4}(?![0-9])`, 'gu'],
    // digits spelled as words (공일공 일이삼사 오육칠팔 · 하나둘셋넷 · zero one zero …), numerals mixed in
    ['wordDigits', PR`(?:(?<![가-힣])|(?<=[는은번호폰]))` + P_KDW + '(?:' + P_GAP + P_KDW + '){7,15}(?=' + P_JOSA + PR`?(?![가-힣]))`, 'giu', piiWordDigits],
    ['zeroOneZero', '(?:공|영|빵)일(?:공|영|빵)', 'gu'],
    // ---- street addresses (a trailing lot number goes with them: "서울시 강남구 역삼동 123-4")
    ['cityDistrict', P_CITY + PR`(?:(?:특별시|광역시|특별자치시|특별자치도|시|도)\s*[가-힣]{1,5}|\s*[가-힣]{2,5})(?:시|군|구)(?![가-힣])(?:\s*[가-힣]{1,5}(?:구|읍|면|동|리)(?![가-힣]))*` + P_LOT, 'gu'],
    ['districtDong', PR`[가-힣]{2,5}(?:구|군)\s*[가-힣]{1,6}(?:동|읍|면|리)(?![가-힣])` + P_LOT, 'gu'],
    ['cityLoose', P_CITY + PR`(?:\s+[가-힣]{2,4}){1,3}\s+[가-힣]{1,6}(?:동|읍|면|리)(?![가-힣])` + P_LOT, 'gu'],   // "경기 성남 분당 정자동 123"
    ['roadWords', PR`[가-힣]{1,10}(?<![으새서별주바따실])(?:로|길)\s*[일이삼사오육칠팔구십백천]{3,6}(?:\s*번지|\s*번길)?(?![가-힣])`, 'gu'],
    ['postcode', PR`(?:우편\s*번호|zip\s*code|postal\s*code)\s*(?:은|는|가|이|:)?\s*[0-9]{5}(?![0-9])`, 'giu'],
    ['road', PR`[가-힣0-9]{1,10}(?<![으새서별주바따실])(?:로|길)\s*(?:[0-9]{1,4}\s*(?:번길|길)\s*)?[0-9]{1,4}(?:\s*-\s*[0-9]{1,4})?` + P_NOTCOUNT + PR`(?:\s*번지)?`, 'gu'],
    ['lot', PR`[가-힣]{1,8}(?:동|리|가)\s*[0-9]{1,5}(?:\s*-\s*[0-9]{1,5})?\s*번지|[가-힣]{1,8}(?:동|리)\s*[0-9]{1,5}\s*-\s*[0-9]{1,5}`, 'gu'],
    ['aptName', PR`[가-힣a-z]{2,12}\s?[0-9]{2,4}\s*동(?![가-힣])`, 'giu'],
    ['apartment', PR`[0-9]{1,4}\s*동\s*[0-9]{1,4}\s*호|(?<![0-9])[0-9]{3,4}\s*호(?![선기실점])(?!\s*(?:교실|강의실|방|차|관|열차))|[가-힣a-z0-9]{1,12}(?:아파트|빌라|오피스텔|맨션)(?![가-힣])`, 'giu'],
    ['aptWords', PR`(?:[0-9]{1,4}|[일이삼사오육칠팔구십백천공영]{2,6})\s*동\s*(?:[0-9]{1,4}|[일이삼사오육칠팔구십백천공영]{2,6})\s*호`, 'gu'],
    ['aptBlockWords', PR`(?:아파트|빌라|맨션)\s*(?:[0-9]{1,4}|[일이삼사오육칠팔구십백천공영]{2,6})\s*동(?![가-힣])`, 'gu'],
    // ---- school / kindergarten / class ("해바라기 초등학교", "해바라기초 2학년", "해바라기 유치원 다녀", "2학년 3반", "이학년 삼반")
    ['schoolShort', PR`[가-힣]{2,10}\s?초(?=\s*(?:[0-9]{1,2}|[일이삼사오육])\s*학년|\s*(?:에\s*)?다(?:녀|니|녔)|\s*학생)`, 'gu'],
    ['kinder', PR`(?<![가-힣])(?!` + P_KID_STOP + PR`\s)[가-힣]{2,10}\s(?:유치원|어린이집)(?=\s*(?:에\s*)?(?:다녀|다니|다녔|친구|선생|이야|야|이에요|예요|이고|에서|[가-힣]{0,4}반|원생|학생|가요|갔|간다))`, 'gu'],
    ['schoolChodeung', PR`(?<![가-힣])(?!` + P_KID_STOP + PR`\s)[가-힣]{2,10}\s?초등(?=\s*(?:[0-9]{1,2}|[일이삼사오육])\s*학년|\s*학생|\s*(?:에\s*)?다(?:녀|니|녔))`, 'gu'],
    ['schoolNamed', PR`학교\s*(?:는|가|은|이름은|이름이)?\s*:?\s*[가-힣]{2,10}(?<!식)초(?:등학교)?(?=` + P_JOSA + PR`?(?![가-힣]))`, 'gu'],
    ['schoolGrade', PR`(?<![가-힣])(?!` + P_KID_STOP + PR`\s)(?!(?:나는|저는|난|전|내|제|형은|형이|누나는|언니는|오빠는|동생은)\s)[가-힣]{2,10}\s?(?:중|고)(?=\s*(?:[0-9]|[일이삼])\s*학년)`, 'gu'],
    ['schoolEn', PR`(?<![a-z])(?!(?:to|a|an|the|my|our|in|at|of|go|like|love|and|or|is|was|big|small|new|old|this|that)\s)[a-z]{2,20}\s+(?:elementary|primary|middle\s+school|high\s+school|kindergarten)`, 'giu'],
    ['school', PR`[가-힣]{1,10}(?:초등학교|초교|중학교|고등학교|유치원|어린이집)|(?<![가-힣])(?!` + P_KID_STOP + PR`\s)[가-힣]{2,10}\s(?:초등학교|중학교|고등학교)|[0-9]\s*학년\s*[0-9]{1,2}\s*반`, 'gu'],
    ['classWords', PR`[일이삼사오육]\s*학년\s*[일이삼사오육칠팔구십]{1,3}\s*반|(?<![0-9])[1-6]\s*-\s*[0-9]{1,2}\s*반`, 'gu'],
  ];

  // ---- predicates (ChatFilter::notCounting / ::wordDigits)
  /** counting, not contact data: the same group repeated, 1 2 3 … / 10 20 30 …, a round number, 123456789, a date */
  function piiNotCounting(m) {
    const g = String(m).split(/[^0-9]+/).filter(Boolean);
    if (!g.length) return false;
    const all = g.join('');
    if (/^([0-9])\1+$/.test(all)) return false;
    if (/^\s*[0-9]+\.[0-9]+\s*$/.test(m)) return false;                                        // 3.141592653589
    if (/^\s*(?:[0-2]?[0-9]:[0-5][0-9][^0-9]*)+$/.test(m)) return false;                      // 10:00 11:00 12:00
    if (g.length === 1) return !(/^[1-9]0+$/.test(all) || piiIsRun(all));
    if (g.length >= 3) {
      if (g.every((x) => x === g[0])) return false;
      const v = g.map(Number);
      const d = v[1] - v[0];
      if (d !== 0 && v.every((x, i) => i === 0 || x - v[i - 1] === d)) return false;
      if (v[0] >= 1900 && v[0] <= 2099 && v[1] >= 1 && v[1] <= 12 && v[2] >= 1 && v[2] <= 31) return false;
    }
    return true;
  }
  /** 123456789 / 987654321 (each digit one up or one down) */
  function piiIsRun(s) {
    if (s.length < 3) return false;
    let up = true, dn = true;
    for (let i = 1; i < s.length; i++) {
      const a = s.charCodeAt(i - 1) - 48, b = s.charCodeAt(i) - 48;
      if (b !== (a + 1) % 10) up = false;
      if (b !== (a + 9) % 10) dn = false;
    }
    return up || dn;
  }
  const PII_WD = { 다섯: '5', 여섯: '6', 일곱: '7', 여덟: '8', 아홉: '9', 하나: '1', 둘: '2', 셋: '3', 넷: '4', zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', 공: '0', 영: '0', 빵: '0', 일: '1', 이: '2', 삼: '3', 사: '4', 오: '5', 육: '6', 륙: '6', 칠: '7', 팔: '8', 구: '9' };
  const PII_WD_RE = /다섯|여섯|일곱|여덟|아홉|하나|둘|셋|넷|zero|one|two|three|four|five|six|seven|eight|nine|oh|[공영빵일이삼사오육륙칠팔구]/gu;
  const PII_WD_SEPS = /하고|이랑|그리고|랑|and/gu;
  /** a run of digit words (maybe with numerals) that is shaped like a phone / local number, not counting */
  function piiWordDigits(m) {
    const t = String(m).toLowerCase().replace(PII_WD_SEPS, ' ');
    if (!/다섯|여섯|일곱|여덟|아홉|하나|둘|셋|넷|zero|one|two|three|four|five|six|seven|eight|nine|oh|[공영빵일이삼사오육륙칠팔구]/u.test(t)) return false; // numerals only: the digit rules decide
    const d = t.replace(PII_WD_RE, (w) => PII_WD[w] ?? w).replace(/[^0-9]+/g, ' ').trim();
    const g = d.split(' ').filter(Boolean);
    const all = g.join('');
    if (all.length < 8 || all.length > 14 || !piiNotCounting(d)) return false;
    if (all[0] === '0' && all.length >= 9) return true;                                      // 0… phone / landline
    if (g.length >= 2 && g[g.length - 1].length === 4 && g[g.length - 2].length >= 3) return true; // …1234 5678
    return /[0-9]/.test(m) && all.length >= 9;                                                 // numerals mixed in
  }

  // ---- fold (ChatFilter::foldChar): what the rules see for one original code point
  let RX_DROP = null, RX_CTRL = null, RX_ND = null;
  try {
    RX_DROP = /^[\p{Cf}\p{Mn}\p{Me}\u3164\u115F\u1160\uFFA0]$/u;
    RX_CTRL = /^[\p{Cc}\p{Zl}\p{Zp}\u2800]$/u;
    RX_ND = /\p{Nd}/u;
  } catch (e) { /* very old engine: no folding (the patterns still run on the text as written) */ }
  const PII_CJK = { '〇': '0', '零': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
    '壹': '1', '貳': '2', '參': '3', '肆': '4', '伍': '5', '陸': '6', '柒': '7', '捌': '8', '玖': '9' }; // + the banking (갖은자) forms
  /** dingbat / double-circled digits that NFKC leaves alone */
  function piiDigitLike(cp) {
    if (cp >= 0x2776 && cp <= 0x277F) return String(cp - 0x2775);
    if (cp >= 0x2780 && cp <= 0x2789) return String(cp - 0x277F);
    if (cp >= 0x278A && cp <= 0x2793) return String(cp - 0x2789);
    if (cp >= 0x24EB && cp <= 0x24F4) return String(cp - 0x24EB + 11);
    if (cp >= 0x24F5 && cp <= 0x24FE) return String(cp - 0x24F4);
    if (cp === 0x24FF) return '0';
    return null;
  }
  const PII_FOLD_CACHE = new Map();
  function piiFoldChar(c) {
    let f = PII_FOLD_CACHE.get(c);
    if (f !== undefined) return f;
    const cp = c.codePointAt(0);
    if (RX_DROP && RX_DROP.test(c)) f = '';
    else if (RX_CTRL && RX_CTRL.test(c)) f = ' ';
    else if ((cp >= 0x3131 && cp <= 0x318E) || (cp >= 0xFFA0 && cp <= 0xFFDC)) f = c; // Hangul jamo stay as typed (ㅋㅋ, ㅡ, ㆍ)
    else if (piiDigitLike(cp) !== null) f = piiDigitLike(cp);
    else if (PII_CJK[c]) f = PII_CJK[c];
    else {
      let n = c;
      try { n = c.normalize('NFKC'); } catch (e) { n = c; }
      let out = '';
      for (const ch of n) {
        if (RX_DROP && RX_DROP.test(ch)) continue;
        if (RX_ND && RX_ND.test(ch) && !(ch >= '0' && ch <= '9')) {
          const z0 = ch.codePointAt(0);
          let z = z0;
          // Unicode encodes every decimal digit set as 10 contiguous code points 0..9
          while (z0 - z < 9 && z > 0 && RX_ND.test(String.fromCodePoint(z - 1))) z--;
          out += String((z0 - z) % 10);
        } else out += ch.toLowerCase();
      }
      f = out;
    }
    if (PII_FOLD_CACHE.size < 4000) PII_FOLD_CACHE.set(c, f);
    return f;
  }
  /** units: [{s: folded, a, b: original code point range, mask?}] */
  function piiUnits(cps) {
    const u = cps.map((c, i) => ({ s: piiFoldChar(c), a: i, b: i + 1 }));
    const one = (x) => x && x.s.length === 1;
    // O / l / I / S look-alikes inside a digit token: "O1O-1234", "o1o", "010-l234", "S678" (a token = a run of [0-9a-z])
    for (let i = 0; i < u.length;) {
      if (!one(u[i]) || !/[0-9olis|]/.test(u[i].s)) { i++; continue; }
      let j = i;
      while (j < u.length && one(u[j]) && /[0-9olis|]/.test(u[j].s)) j++;
      const before = i > 0 ? u[i - 1].s : '', after = j < u.length ? u[j].s : '';
      const run = u.slice(i, j);
      if (run.length >= 3 && !/[a-z]$/.test(before) && !/^[a-z]/.test(after) && run.some((x) => /[0-9]/.test(x.s)) && run.some((x) => /[olis|]/.test(x.s))) {
        for (const x of run) x.s = x.s === 'o' ? '0' : x.s === 's' ? '5' : /[li|]/.test(x.s) ? '1' : x.s;
      }
      i = j;
    }
    // "k i d d i n o @ g m a i l . c o m": ≥ 4 single letters / @ . _ - separated by single spaces join up
    for (let i = 0; i < u.length;) {
      const isTok = (k) => one(u[k]) && /[a-z@._\-]/.test(u[k].s) && (k === 0 || u[k - 1].s === ' ') && (k + 1 >= u.length || u[k + 1].s === ' ');
      if (!isTok(i)) { i++; continue; }
      let j = i, n = 1;
      while (j + 2 < u.length && u[j + 1].s === ' ' && isTok(j + 2)) { j += 2; n++; }
      if (n >= 4) for (let k = i + 1; k < j; k += 2) u[k].s = '';
      i = j + 1;
    }
    return u;
  }
  let PII_RE = null;
  /** compiled once; an engine without look-behind support drops just the look-behind (stricter, never looser) */
  function piiRegexes() {
    if (PII_RE) return PII_RE;
    PII_RE = [];
    for (const [name, src, flags, pred] of PII_SRC) {
      let re = null;
      try { re = new RegExp(src, flags); } catch (e) {
        try { re = new RegExp(src.replace(/\(\?<[!=][^)]*\)/g, ''), flags); } catch (e2) { re = null; }
      }
      if (re) PII_RE.push([name, re, pred || null]); else G.log.warn('SOCIAL', `PII pattern ${name} unsupported`);
    }
    return PII_RE;
  }
  /** one rule over the units: every match becomes one 🔒 unit covering the original characters it spans */
  function piiApply(units, re, pred) {
    let s = '';
    const pos = [];
    for (let i = 0; i < units.length; i++) { const x = units[i].s; for (let k = 0; k < x.length; k++) pos.push(i); s += x; }
    pos.push(units.length);
    re.lastIndex = 0;
    const spans = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (pred && !pred(m[0])) continue;
      spans.push([pos[m.index], pos[m.index + m[0].length - 1]]);
    }
    for (let k = spans.length - 1; k >= 0; k--) {
      const i = spans[k][0];
      let j = spans[k][1];
      while (j + 1 < units.length && units[j + 1].s === '' && !units[j + 1].mask) j++; // marks / invisibles right after go too
      units.splice(i, j - i + 1, { s: PII_MARK, a: units[i].a, b: units[j].b, mask: true });
    }
    return spans.length;
  }
  const PII_COLLAPSE = /🔒(?:(?:[^\p{L}\p{N}🔒]|[ㄱ-ㆎ]){0,8}🔒)+/gu;
  /** -> {text, hits}: personal information replaced with 🔒 (the rest of the text exactly as written) */
  function maskPIIInfo(text) {
    let t = String(text ?? '');
    if (!t) return { text: t, hits: 0 };
    try { t = t.normalize('NFC'); } catch (e) { /* old engine */ }
    let cps = Array.from(t);
    if (cps.length > PII_MAX) cps = cps.slice(0, PII_MAX);
    const units = piiUnits(cps);
    let hits = 0;
    for (const [, re, pred] of piiRegexes()) hits += piiApply(units, re, pred);
    let out = '';
    for (const x of units) out += x.mask ? PII_MARK : cps.slice(x.a, x.b).join('');
    if (hits) out = out.replace(PII_COLLAPSE, PII_MARK);
    return { text: out, hits };
  }
  /**
   * nicknames are public and permanent: stricter than chat (ChatFilter::nicknameLooksPersonal) — any PII, ≥ 7 digits,
   * 010…, messenger / game platform + an id-like tail ("로블록스dino12", "인스타dino"), school / grade / class.
   */
  function nicknameLooksPersonal(nick) {
    const n = String(nick ?? '');
    if (!n) return false;
    if (maskPIIInfo(n).hits) return true;
    const f = Array.from(n.normalize('NFC')).map(piiFoldChar).join('');
    if ((f.match(/[0-9공영빵일이삼사오육륙칠팔구]/gu) || []).length >= 7) return true; // digits, also as words
    if (/01[016789][0-9]{3,}|공일공|영일영/u.test(f)) return true;
    if (/카톡|카카오톡|인스타|틱톡|디코|디스코드|텔레그램|페메|유튜브|로블록스|로블|제페토|마인크래프트|마크|포트나이트|브롤|insta|kakao|tiktok|discord|telegram|youtube|snapchat|roblox|zepeto|minecraft|fortnite/iu.test(f) && /[0-9a-z_]{3,}|[0-9]{2,}/i.test(f.replace(/insta|kakao|tiktok|discord|telegram|youtube|snapchat|roblox|zepeto|minecraft|fortnite/giu, ''))) return true;
    if (/학년|[0-9일이삼사오육칠팔구]반$|초등|중학|고등|유치원|어린이집|[가-힣]{2,}초[0-9일이삼사오육]/u.test(f)) return true;
    if (/^(?:ig|yt|tt|dc|snap|kt|insta|fb|tw|tg|dm)[._]/u.test(f)) return true;               // "ig_dino", "snap.dino77"
    if (/[가-힣]{2,}(?<!식)초$|[가-힣]{2,}(?:중|고)[0-9일이삼]|[가-힣]{1,6}동[0-9]{2,}/u.test(f)) return true; // 해바라기초 · 해바라기중1 · 정자동123
    return false;
  }
  // <<< PII ENGINE

  /** repeat-spam key (mirrors the server: case-folded, no spaces/punctuation, repeated letters squashed) */
  function spamKey(text) {
    let k = skeleton(text).s.replace(/\|/g, '').replace(/(.)\1{2,}/g, '$1$1');
    if (!k) k = String(text).toLowerCase().replace(/\s+/g, '');
    return k.slice(0, 200);
  }

  // ================================================================= emoji shortcuts
  const EMOJI_NAMES = {
    smile: '😊', happy: '😄', laugh: '😆', lol: '😆', wink: '😉', love: '🥰', cool: '😎', wow: '😮', cry: '😢', sad: '😢', think: '🤔',
    heart: '❤️', thumbsup: '👍', '+1': '👍', ok: '👌', clap: '👏', wave: '👋', hi: '👋', pray: '🙏', muscle: '💪', party: '🎉', tada: '🎉',
    star: '⭐', sparkles: '✨', fire: '🔥', '100': '💯', sun: '☀️', rain: '🌧️', snow: '❄️', flower: '🌸', leaf: '🌿', tree: '🌳',
    jar: '🏺', bean: '🫘', rice: '🍚', kimchi: '🥬', pepper: '🌶️', water: '💧', camera: '📷', music: '🎶', book: '📖', gift: '🎁',
    웃음: '😊', 하하: '😆', 사랑: '🥰', 하트: '❤️', 최고: '👍', 박수: '👏', 인사: '👋', 감사: '🙏', 축하: '🎉', 반짝: '✨', 별: '⭐',
    장독: '🏺', 항아리: '🏺', 콩: '🫘', 김치: '🥬', 고추: '🌶️', 밥: '🍚', 꽃: '🌸', 나무: '🌳', 해: '☀️', 비: '🌧️', 물: '💧', 사진: '📷',
  };
  const EMOTICONS = [[':-)', '😊'], [':)', '😊'], ['(:', '😊'], [':-D', '😄'], [':D', '😄'], [';-)', '😉'], [';)', '😉'], [':-(', '😢'], [':(', '😢'],
    [':P', '😛'], [':p', '😛'], [':O', '😮'], [':o', '😮'], ['<3', '❤️'], ['</3', '💔'], ['xD', '😆'], ['XD', '😆'], ['B-)', '😎'], [':*', '😘']];
  const EMOTICON_RE = new RegExp(`(^|\\s)(${EMOTICONS.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')})(?=\\s|$)`, 'g');
  const EMOTICON_MAP = Object.fromEntries(EMOTICONS);
  const NAMED_RE = /:([a-z0-9_+ㄱ-ㆎ가-힣]{1,12}):/gi;
  /** :heart: -> ❤️ always; standalone emoticons (":)", "<3") only when the message is sent */
  function applyShortcuts(text, final) {
    let t = String(text).replace(NAMED_RE, (m, name) => EMOJI_NAMES[name.toLowerCase()] || m);
    if (final) t = t.replace(EMOTICON_RE, (m, pre, emo) => pre + (EMOTICON_MAP[emo] || emo));
    return t;
  }

  // ================================================================= 쉬운 모드 content (CONTRACT §12): phrase picker, merged express picker
  /** kid chat = preset phrases only (no typing): 4 picture categories x 6 short, warm 해요체 lines */
  const KID_CATS = [
    { id: 'hello', emoji: '👋', label: '인사', color: '#4fb3ff', say: '인사말이에요', reply: 'greet' },
    { id: 'feel', emoji: '😊', label: '기분', color: '#ffc93c', say: '내 기분이에요', reply: 'feel' },
    { id: 'praise', emoji: '🙌', label: '칭찬', color: '#ff7eb6', say: '칭찬하는 말이에요', reply: 'praise' },
    { id: 'play', emoji: '🌱', label: '놀이', color: '#55d187', say: '같이 노는 말이에요', reply: 'play' },
  ];
  const KID_PHRASES = [
    { id: 'hi', cat: 'hello', emoji: '👋', text: '안녕하세요!' },
    { id: 'nice', cat: 'hello', emoji: '😊', text: '반가워요!' },
    { id: 'friend', cat: 'hello', emoji: '🤝', text: '우리 친구 해요!' },
    { id: 'welcome', cat: 'hello', emoji: '🙌', text: '어서 와요!' },
    { id: 'thanks', cat: 'hello', emoji: '🙏', text: '고마워요!' },
    { id: 'bye', cat: 'hello', emoji: '🙋', text: '잘 가요! 또 만나요!' },
    { id: 'happy', cat: 'feel', emoji: '😄', text: '정말 신나요!' },
    { id: 'like', cat: 'feel', emoji: '🥰', text: '여기가 좋아요!' },
    { id: 'fun', cat: 'feel', emoji: '🤩', text: '너무 재밌어요!' },
    { id: 'wow', cat: 'feel', emoji: '😮', text: '우와, 멋져요!' },
    { id: 'yum', cat: 'feel', emoji: '😋', text: '맛있겠다!' },
    { id: 'sleepy', cat: 'feel', emoji: '😴', text: '조금 졸려요' },
    { id: 'best', cat: 'praise', emoji: '👍', text: '최고예요!' },
    { id: 'good', cat: 'praise', emoji: '👏', text: '잘했어요!' },
    { id: 'pretty', cat: 'praise', emoji: '✨', text: '정말 예뻐요!' },
    { id: 'cool', cat: 'praise', emoji: '😎', text: '멋있어요!' },
    { id: 'cheer', cat: 'praise', emoji: '💪', text: '힘내요!' },
    { id: 'great', cat: 'praise', emoji: '🌟', text: '대단해요!' },
    { id: 'together', cat: 'play', emoji: '🤗', text: '같이 놀아요!' },
    { id: 'follow', cat: 'play', emoji: '🏃', text: '나를 따라와요!' },
    { id: 'farm', cat: 'play', emoji: '🌱', text: '같이 밭에 가요!' },
    { id: 'jar', cat: 'play', emoji: '🏺', text: '장독 보러 가요!' },
    { id: 'photo', cat: 'play', emoji: '📸', text: '같이 사진 찍어요!' },
    { id: 'dance', cat: 'play', emoji: '💃', text: '같이 춤춰요!' },
  ];
  const KID_EMOJI = ['😊', '😆', '🥰', '👍', '👏', '👋', '🎉', '❤️'];
  const KID_EMOJI_SET = new Set(KID_EMOJI);
  /** ONE picture picker for emotes + gestures; duplicates merged (👋 인사 = EMO_HELLO + GES_WAVE, 🙌 만세 = EMO_WELCOME + GES_CHEER) */
  const EXPRESS = [
    { id: 'smile', emoji: '😊', label: '웃어요', say: '방긋 웃어요', emote: 'EMO_SMILE' },
    { id: 'laugh', emoji: '😆', label: '하하', say: '하하 웃어요', emote: 'EMO_LAUGH' },
    { id: 'hello', emoji: '👋', label: '안녕', say: '손을 흔들어 인사해요', emote: 'EMO_HELLO', gesture: 'GES_WAVE' },
    { id: 'love', emoji: '❤️', label: '좋아요', say: '좋아요 하트', emote: 'EMO_LIKE' },
    { id: 'clap', emoji: '👏', label: '박수', say: '짝짝짝 박수', emote: 'EMO_CLAP' },
    { id: 'thumbs', emoji: '👍', label: '최고', say: '엄지 척 최고', emote: 'EMO_THUMBS' },
    { id: 'wow', emoji: '😮', label: '깜짝', say: '깜짝 놀라요', emote: 'EMO_WOW' },
    { id: 'hooray', emoji: '🙌', label: '만세', say: '만세를 해요', emote: 'EMO_WELCOME', gesture: 'GES_CHEER' },
    { id: 'bow', emoji: '🙇', label: '꾸벅', say: '꾸벅 절해요', gesture: 'GES_BOW' },
    { id: 'dance', emoji: '💃', label: '춤추기', say: '신나게 춤춰요', gesture: 'GES_DANCE' },
    { id: 'sit', emoji: '🪑', label: '앉기', say: '털썩 앉아요', gesture: 'GES_SIT' },
    { id: 'vsign', emoji: '✌️', label: '브이', say: '브이 포즈', gesture: 'GES_PHOTO' },
    { id: 'think', emoji: '🤔', label: '음…', say: '음 생각해요', gesture: 'GES_THINK' },
    { id: 'point', emoji: '👉', label: '저기!', say: '저기를 가리켜요', gesture: 'GES_POINT' },
  ];
  /** what simulated visitors say while 쉬운 모드 is on: short, warm, picture words */
  const KID_TALK = {
    lines: ['안녕하세요! 😊', '여기 정말 예뻐요 🌸', '장독이 엄청 많아요! 🏺', '콩이 쑥쑥 자라요 🌱', '물 주기 재밌어요 💧', '나비를 봤어요! 🦋',
      '같이 사진 찍을래요? 📸', '오늘 날씨 좋아요 ☀️', '김치 냠냠 😋', '옹이 귀여워요 💕', '정자에서 쉬어요 🌿', '춤추고 싶어요 💃'],
    greet: ['안녕하세요! 반가워요 😊', '안녕! 👋', '어서 와요~ 😄', '반가워요! 같이 놀아요 🙌'],
    thanks: ['천만에요! 😊', '헤헤, 고마워요 💕'],
    feel: ['나도 신나요! 😆', '맞아요, 여기 정말 좋아요 🥰', '우와, 진짜요? 😮'],
    praise: ['고마워요! 😊', '헤헤, 부끄러워요 ☺️', '너도 최고예요! 👍'],
    play: ['좋아요! 같이 가요 🙌', '와, 재밌겠다! 😄', '나도 갈래요! 🏃'],
    question: ['음… 나도 궁금해요 🤔', '반짝이는 별을 따라가 봐요 ⭐'],
    mention: ['네! 불렀어요? 😊', '저요? 반가워요! 👋'],
    agree: ['맞아요! 😊', '나도요! 🙌', '좋아요~ 😄'],
    congrats: ['우와, 축하해요! 🎉', '최고예요! 👏'],
    chat: ['안녕하세요! 😊'],
  };
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const kidSay = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };

  // ---- what the voice guide may read from OTHER people (kid safety §12.4): only lines this code wrote.
  // Another account's free text — and its nickname — is never spoken: a pre-reader cannot tell a stranger's
  // "엄마한테 비밀로 하고 …" from a game line, and any PII-filter gap would be read out loud. A remote message that
  // is exactly a preset kid phrase / kid emoji is read from the LOCAL phrase book (never from the received text).
  const normLine = (s) => { let t = String(s ?? ''); try { t = t.normalize('NFC'); } catch (e) { /* old engine */ } return t.replace(/[\uFE0E\uFE0F]/g, '').replace(/\s+/g, ' ').trim(); };
  const PRESET_LINES = new Map(); // normalised text -> what may be read ('' = emoji only: a chime, nothing to read)
  const PRESET_SHOW = new Map();  // normalised text -> what kid chat may SHOW (always the local phrase-book string)
  const addPreset = (text, spoken) => {
    const k = normLine(text);
    if (k && !PRESET_LINES.has(k)) { PRESET_LINES.set(k, spoken); PRESET_SHOW.set(k, String(text)); }
  };
  for (const p of KID_PHRASES) { addPreset(`${p.text} ${p.emoji}`, p.text); addPreset(p.text, p.text); }
  for (const e of KID_EMOJI) addPreset(e, '');
  for (const list of Object.values(KID_TALK)) for (const l of list) addPreset(l, l);
  // the 👋 인사 of the kid user menu is sent as "<name>, 안녕하세요! 👋". The part before the comma is free text from
  // the sender (anything up to 24 characters), so it is NEVER shown or read: the child sees and hears only the
  // phrase-book greeting below.
  const RX_KID_HI = /^.{1,24}, 안녕하세요! 👋$/u;
  const KID_HI_SHOW = '👋 안녕하세요!';
  /** a preset (code-written) line → the text the voice may read ('' = emoji only), otherwise null */
  function presetLine(text) {
    const k = normLine(text);
    if (PRESET_LINES.has(k)) return PRESET_LINES.get(k);
    if (RX_KID_HI.test(k)) return '안녕하세요!';
    return null;
  }
  /** what kid chat may DISPLAY for another account's message: the local phrase-book text, or null (hidden) */
  function presetShow(text) {
    const k = normLine(text);
    if (PRESET_SHOW.has(k)) return PRESET_SHOW.get(k);
    if (RX_KID_HI.test(k)) return KID_HI_SHOW;
    return null;
  }

  function nameHue(name) { return U.hashInt(String(name)) % 360; }
  function nameColor(name) { return `hsl(${nameHue(name)} 78% 74%)`; }
  function hhmm(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

  // ================================================================= navigation graph for visitors
  const NAV = { nodes: [], cell: 10, hash: new Map(), crops: [], ready: false, bounds: { minX: -84, maxX: 88, minZ: -104, maxZ: 86 } };
  const hkey = (cx, cz) => cx * 7919 + cz;
  function inCrop(x, z) {
    for (const c of NAV.crops) if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return true;
    return false;
  }
  /** ground height for a visitor stepping onto (x, z) from fromY, or null when not walkable */
  function walkY(x, z, fromY, r = 0.38) {
    const W = G.world, b = NAV.bounds;
    if (!(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return null;
    if (inCrop(x, z)) return null;
    if (W.blocked(x, z, r, fromY)) return null; // also rejects water
    const y = W.heightAt(x, z, fromY + 0.35);
    if (!Number.isFinite(y) || Math.abs(y - fromY) > 0.52) return null;
    return y;
  }
  function segClear(ax, az, ay, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.6));
    let y = ay;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const ny = walkY(ax + (bx - ax) * k, az + (bz - az) * k, y);
      if (ny == null) return null;
      y = ny;
    }
    return y;
  }
  function navNear(x, z, r) {
    const out = [], c = NAV.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const list = NAV.hash.get(hkey(cx, cz));
        if (list) for (const i of list) { const n = NAV.nodes[i]; const dd = Math.hypot(n.x - x, n.z - z); if (dd <= r) out.push([dd, n]); }
      }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }
  function nearestNode(x, z, y) {
    const cand = navNear(x, z, 14);
    let tries = 0;
    for (const [, n] of cand) {
      if (!n.main) continue;
      if (segClear(x, z, y, n.x, n.z) != null) return n;
      if (++tries >= 7) break;
    }
    return null;
  }
  /** A* over the graph -> array of nodes or null */
  function astar(start, goal) {
    if (!start || !goal) return null;
    if (start === goal) return [start];
    const N = NAV.nodes.length;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = []; // [f, idx]
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    g[start.i] = 0; push(Math.hypot(goal.x - start.x, goal.z - start.z), start.i);
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === goal.i) break;
      closed[i] = 1;
      const n = NAV.nodes[i];
      for (const [j, c] of n.adj) {
        if (closed[j]) continue;
        const ng = g[i] + c;
        if (ng < g[j]) { g[j] = ng; from[j] = i; const m = NAV.nodes[j]; push(ng + Math.hypot(goal.x - m.x, goal.z - m.z), j); }
      }
    }
    if (from[goal.i] < 0) return null;
    const path = [];
    for (let i = goal.i; i >= 0; i = from[i]) { path.push(NAV.nodes[i]); if (i === start.i) break; }
    return path.reverse();
  }

  // ================================================================= the system
  const social = {
    name: 'social', order: 80, label: '커뮤니티',
    others: new Map(),
    messages: [],
    tab: 'all',
    spots: [],
    _seq: 0, _chat: null, _stick: true, _unread: 0, _lastSent: -1e9, _lastText: '', _repeat: 0,
    _me: null, _picker: null, _rec: null, _badRe: null,
    _pool: [], _target: 0, _vroot: null, _lineT: 12, _cycleT: 200, _joinT: -1, _recentLines: [], _replyT: 0,
    _sessionKey: null, _loggedOut: true, _mode: 'local', _srv: null, _timers: new Set(),
    _lastEmote: -1e9, _emoteSeq: 0, _emoteState: null,
    _sendLog: [], _recentKeys: [], _muteUntil: 0, _typingNames: new Map(), _suggest: null, _gatherAt: -1e9, _mentionAt: -1e9,
    stats: { plans: 0, planFails: 0, arrivals: 0, stuck: 0, lines: 0, replies: 0, joins: 0, leaves: 0 },

    get online() { return 1 + this.others.size; },

    // ------------------------------------------------------------ lifecycle
    init() {
      this._buildFilter();
      piiRegexes();
      this._initChat();
      this._wasEasy = kidOn();
      this._syncKidChat();
      this._initActions();
      this._initMyBubble();
      this._initVisitors();
      this._initEvents();
      this._updateOnline();
    },

    async postInit() {
      try { await this._buildNav(); } catch (e) { G.log.warn('SOCIAL', 'navigation graph failed', e); }
    },

    onStateLoaded(state) {
      const mode = G.net?.mode === 'server' ? 'server' : 'local';
      const key = `${state?.profile?.id || 'guest'}|${mode}`;
      const fresh = this._loggedOut || key !== this._sessionKey;
      this._sessionKey = key;
      this._loggedOut = false;
      // imported / old saves: keep only sane, unique names
      if (state) {
        const raw = Array.isArray(state.blocked) ? state.blocked : [];
        const list = [];
        for (const n of raw) { if (typeof n !== 'string') continue; const c = cleanText(n, 32); if (c && !list.includes(c)) list.push(c); if (list.length >= 200) break; }
        if (!Array.isArray(state.blocked) || list.length !== raw.length) state.blocked = list;
      }
      if (fresh) {
        this._stopServer();
        this._clearRemotes();
        this._mode = mode;
        this._resetChat();
        this._seedChat();
        if (mode === 'local') { this._spawnVisitors(); this._later(rand(6500, 9000), () => this._welcomePlayer()); } else { this._despawnVisitors(); this._startServer(); }
        this._clearMyBubble();
      } else {
        this._refreshBlocked(); // re-applied state (reset / import): keep the session going
      }
      this._applyChatVisibility();
      this._updateGuestUi();
      this._syncKidChat();
      this._updateOnline();
    },

    onLogout() {
      this.closeKidChat();
      this._kidListenUntil = 0;
      this._kidCat = null;
      this._loggedOut = true;
      this._stopServer();
      this._clearRemotes();
      this._despawnVisitors();
      this._closePicker();
      this.stopVoice();
      this._clearMyBubble();
      for (const t of this._timers) clearTimeout(t);
      this._timers.clear();
      this._typingNames.clear();
      this._renderTyping();
      this._hideSuggest();
      if (this._chat) { this._chat.input.value = ''; this._chat.input.blur(); this._updateCount(); }
      document.body.classList.remove('show-chat');
      this._updateOnline();
    },

    _later(ms, fn) {
      const id = setTimeout(() => { this._timers.delete(id); try { fn(); } catch (e) { G.log.error('SOCIAL', e); } }, ms);
      this._timers.add(id);
      return id;
    },

    // ================================================================ chat
    _initChat() {
      const panel = document.getElementById('chat-panel');
      const log = document.getElementById('chat-log');
      const form = document.getElementById('chat-form');
      const input = document.getElementById('chat-input');
      if (!panel || !log || !form || !input) { G.log.warn('UI', 'chat DOM missing'); return; }
      const h = G.ui.h;
      const C = this._chat = { panel, log, form, input, send: form.querySelector('button[type="submit"]'), tabs: Array.from(panel.querySelectorAll('.chat-tabs [data-channel]')) };
      input.setAttribute('enterkeyhint', 'send');
      input.maxLength = MAX_LEN;
      C.placeholder = input.getAttribute('placeholder') || '메시지를 입력하세요...';
      // header extras: unread counter (collapsed) + collapse icon state
      C.collapseBtn = panel.querySelector('[data-action="chat-collapse"]');
      C.unread = h('span', { class: 'chat-unread', hidden: true });
      C.collapseBtn?.before(C.unread);
      // "new messages" pill when scrolled up
      C.pill = h('button', { class: 'chat-new', type: 'button', hidden: true }, '새 메시지', h('span', { class: 'ico ico-xs', 'data-icon': 'chevron-down' }));
      C.pill.addEventListener('click', () => this._scrollBottom(true));
      panel.insertBefore(C.pill, form);
      // voice indicator + length counter inside the form
      C.voiceInd = h('span', { class: 'chat-voice-ind', hidden: true, title: '음성 인식 중' }, h('i'), h('i'), h('i'));
      form.insertBefore(C.voiceInd, input);
      C.count = h('span', { class: 'chat-count', hidden: true });
      form.insertBefore(C.count, C.send);
      // "OO님이 입력 중…" line + quick reaction row (emotes) + @name / :emoji: suggestions
      C.typing = h('div', { class: 'chat-typing', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'ct-pill' }, h('span', { class: 'soc-dots' }, h('i'), h('i'), h('i')), h('span', { class: 'ct-txt' })));
      C.quick = h('div', { class: 'chat-quick', role: 'toolbar', 'aria-label': '빠른 반응' });
      for (const id of QUICK) {
        const e = (G.data.emotes || []).find((x) => x.id === id);
        if (!e) continue;
        const b = h('button', { type: 'button', class: 'cq-btn', dataset: { emote: e.id }, title: `${e.name} — 내 머리 위에 띄우기`, 'aria-label': e.name }, h('span', { class: 'emoji' }, e.icon));
        C.quick.appendChild(b);
      }
      C.quickMore = h('button', { type: 'button', class: 'cq-btn cq-more', title: '이모지 전체 보기 (T)', 'aria-label': '이모지 전체 보기' }, h('span', { class: 'ico ico-sm', 'data-icon': 'plus' }));
      C.quickHelp = h('button', { type: 'button', class: 'cq-btn cq-help', title: '채팅 단축키 보기', 'aria-label': '채팅 단축키 보기' }, ':)');
      C.quick.append(C.quickMore, C.quickHelp);
      C.quick.addEventListener('click', (e) => {
        const b = e.target.closest('.cq-btn');
        if (!b) return;
        if (b === C.quickMore) { this.openEmotes(b); return; }
        if (b === C.quickHelp) { this._openShortcutHelp(b); return; }
        if (this.emote(b.dataset.emote)) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); }
      });
      C.suggest = h('div', { class: 'chat-suggest glass', role: 'listbox', hidden: true });
      C.suggest.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the input focused
      C.suggest.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) this._acceptSuggest(Number(b.dataset.i)); });
      panel.insertBefore(C.typing, form);
      panel.insertBefore(C.quick, form);
      panel.insertBefore(C.suggest, form);
      // 쉬운 모드 (kid chat): no text box — one big "말하기" button opens the phrase picker, ✖ hides the log
      C.kidTalk = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes ck-talk', 'data-say': '말하기. 친구에게 할 말을 골라요.' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💬'), h('span', null, '말하기'));
      C.kidHide = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no ck-hide', 'aria-label': '이야기 창 닫기', 'data-say': '이야기 창을 닫아요.' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✖'));
      C.kidRow = h('div', { class: 'chat-kid-row easy-only' }, C.kidTalk, C.kidHide);
      C.kidTalk.addEventListener('click', () => this.openKidChat(C.kidTalk));
      C.kidHide.addEventListener('click', () => this.toggleChat(false));
      panel.appendChild(C.kidRow);

      for (const b of C.tabs) {
        b.setAttribute('type', 'button');
        b.addEventListener('click', () => this.setTab(b.dataset.channel));
      }
      log.addEventListener('scroll', () => {
        this._stick = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
        if (this._stick) C.pill.hidden = true;
      }, { passive: true });
      log.addEventListener('click', (e) => {
        const who = e.target.closest('.who');
        if (!who || who.dataset.kind === 'system' || who.dataset.kind === 'me') return;
        e.stopPropagation();
        // open beside the chat panel, level with the clicked name
        const pr = panel.getBoundingClientRect(), wr = who.getBoundingClientRect();
        const anchor = { getBoundingClientRect: () => ({ left: pr.right, right: pr.right, width: 0, top: wr.top, bottom: wr.bottom, height: wr.height }), contains: (n) => who.contains(n) };
        this._openUser(anchor, { name: who.dataset.name, kind: who.dataset.kind, id: who.dataset.uid || null, msgId: who.closest('.chat-msg')?.dataset.id || null });
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this._kidChatOn()) { input.value = ''; input.blur(); this.openKidChat(); return; } // no free text for children
        const v = input.value;
        if (!v.trim()) { input.blur(); return; }
        const ch = this.tab === 'local' ? 'local' : 'all';
        if (this.sendChat(v, ch)) {
          input.value = '';
          this._updateCount();
          input.blur();
          if (this.tab === 'system') this.setTab('all');
        }
      });
      input.addEventListener('input', (e) => {
        // complete ":name:" shortcuts turn into emoji right away (keeps the caret in place)
        if (!e.isComposing && input.value.includes(':')) {
          const pos = input.selectionStart ?? input.value.length;
          const before = input.value.slice(0, pos), after = input.value.slice(pos);
          const nb = applyShortcuts(before, false);
          if (nb !== before) { input.value = nb + after; try { input.setSelectionRange(nb.length, nb.length); } catch (err) { /* ignore */ } }
        }
        this._updateCount();
        this._updateSuggest();
      });
      input.addEventListener('focus', () => { panel.classList.add('typing'); this._markRead(); });
      input.addEventListener('blur', () => { panel.classList.remove('typing'); this._hideSuggest(); });
      // suggestion navigation; IME composition (Korean) must never submit half-composed syllables
      input.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) { if (e.key === 'Enter') e.stopPropagation(); return; }
        const S = this._suggest;
        if (!S) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { S.active = (S.active + (e.key === 'ArrowDown' ? 1 : -1) + S.items.length) % S.items.length; this._renderSuggest(); }
        else if (e.key === 'Tab' || e.key === 'Enter') this._acceptSuggest(S.active);
        else if (e.key === 'Escape') this._hideSuggest();
        else return;
        e.preventDefault(); e.stopPropagation();
      });

      if (lsGet(LS_COLLAPSED, '0') === '1') this.collapse(true, { silent: true });
      const t = lsGet(LS_TAB, 'all');
      this.setTab(['all', 'local', 'system'].includes(t) ? t : 'all', { silent: true });
      G.ui.hydrateIcons(panel);
    },

    // ------------------------------------------------------------ @name / :emoji: suggestions
    _updateSuggest() {
      const C = this._chat;
      if (!C || document.activeElement !== C.input) { this._hideSuggest(); return; }
      const pos = C.input.selectionStart ?? C.input.value.length;
      const before = C.input.value.slice(0, pos);
      let m, items = [];
      if ((m = /(^|\s)@([^\s@]{0,12})$/.exec(before))) {
        const frag = m[2].toLowerCase();
        const pp = G.sys.player?.position;
        const seen = new Set();
        const cand = [];
        const add = (name, icon, x, z, sub) => {
          if (!name || seen.has(name) || this._isBlocked(name)) return;
          if (frag && !name.toLowerCase().includes(frag)) return;
          seen.add(name);
          cand.push({ label: name, icon, sub, insert: `@${name} `, d: pp && Number.isFinite(x) ? Math.hypot(x - pp.x, z - pp.z) : 999, start: pos - m[2].length - 1 });
        };
        for (const o of this.others.values()) add(o.name, '🙂', o.position?.x, o.position?.z, o.kind === 'remote' ? '접속 중' : '체험객');
        for (const r of G.sys.npc?.list?.() || []) add(r.data?.name, '⭐', r.position?.x, r.position?.z, r.data?.role || 'NPC');
        cand.sort((a, b) => (a.label.toLowerCase().startsWith(frag) ? 0 : 1) - (b.label.toLowerCase().startsWith(frag) ? 0 : 1) || a.d - b.d);
        items = cand.slice(0, 5).map((c) => ({ ...c, sub: c.d < 999 ? `${c.sub} · ${Math.round(c.d)}m` : c.sub }));
      } else if ((m = /(^|\s):([a-z0-9_+ㄱ-ㆎ가-힣]{1,12})$/i.exec(before))) {
        const frag = m[2].toLowerCase();
        const seen = new Set();
        for (const [name, emo] of Object.entries(EMOJI_NAMES)) {
          if (!name.startsWith(frag) || seen.has(emo + name)) continue;
          seen.add(emo + name);
          items.push({ label: `:${name}:`, icon: emo, insert: emo + ' ', start: pos - m[2].length - 1 });
          if (items.length >= 6) break;
        }
      }
      if (!items.length) { this._hideSuggest(); return; }
      const prev = this._suggest;
      this._suggest = { items, active: prev && prev.items.length === items.length ? Math.min(prev.active, items.length - 1) : 0, end: pos };
      this._renderSuggest();
    },
    _renderSuggest() {
      const C = this._chat, S = this._suggest;
      if (!C || !S) return;
      const h = G.ui.h;
      C.suggest.replaceChildren(...S.items.map((it, i) => h('button', { type: 'button', class: `cs-item${i === S.active ? ' active' : ''}`, role: 'option', 'aria-selected': i === S.active ? 'true' : 'false', dataset: { i: String(i) } },
        h('span', { class: 'emoji' }, it.icon), h('b', null, it.label), it.sub ? h('small', null, it.sub) : null)));
      C.suggest.appendChild(h('div', { class: 'cs-tip' }, '↑↓ 선택 · Tab/Enter 입력 · Esc 닫기'));
      C.suggest.hidden = false;
    },
    _hideSuggest() { this._suggest = null; if (this._chat) this._chat.suggest.hidden = true; },
    _acceptSuggest(i) {
      const C = this._chat, S = this._suggest;
      if (!C || !S || !S.items[i]) return;
      const it = S.items[i];
      const v = C.input.value;
      const nv = (v.slice(0, it.start) + it.insert + v.slice(S.end)).slice(0, MAX_LEN);
      C.input.value = nv;
      const caret = Math.min(nv.length, it.start + it.insert.length);
      try { C.input.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
      this._hideSuggest();
      this._updateCount();
      C.input.focus({ preventScroll: true });
    },
    /** cheat sheet of emoji shortcuts (click inserts into the chat input) */
    _openShortcutHelp(anchor) {
      const h = G.ui.h;
      const rows = [[':)', '😊'], [':D', '😄'], [';)', '😉'], ['<3', '❤️'], [':(', '😢'], [':O', '😮'], [':하트:', '❤️'], [':최고:', '👍'], [':박수:', '👏'], [':축하:', '🎉'], [':장독:', '🏺'], [':김치:', '🥬']];
      const grid = h('div', { class: 'soc-sc-grid' });
      for (const [k, e] of rows) {
        const b = h('button', { type: 'button', class: 'soc-sc', title: `${k} → ${e}` }, h('span', { class: 'emoji' }, e), h('code', null, k));
        b.addEventListener('click', () => {
          G.ui.popover.close();
          if (this._guestReadOnly() || !this.focusChat()) return;
          const C = this._chat;
          const v = C.input.value;
          C.input.value = (v && !/\s$/.test(v) ? v + ' ' : v) + e + ' ';
          this._updateCount();
        });
        grid.appendChild(b);
      }
      const box = h('div', { class: 'soc-picker soc-shortcuts' },
        h('div', { class: 'soc-pk-head' }, h('h4', null, '채팅 단축키'), h('kbd', null, 'Enter')),
        grid,
        h('p', { class: 'soc-pk-tip' }, '메시지에 :) 나 :하트: 를 쓰면 이모지로 바뀌어요. @이름 으로 다른 체험객을 부를 수 있어요.'));
      G.ui.popover.open(anchor, box, { id: 'social-shortcuts', placement: 'top', className: 'soc-pop' });
    },

    _updateCount() {
      const C = this._chat;
      if (!C) return;
      const n = C.input.value.length;
      C.count.hidden = n < MAX_LEN - 30;
      C.count.textContent = `${n}/${MAX_LEN}`;
      C.count.classList.toggle('full', n >= MAX_LEN);
    },

    setTab(id, opts = {}) {
      const C = this._chat;
      if (!C || !['all', 'local', 'system'].includes(id)) return;
      this.tab = id;
      C.log.dataset.tab = id;
      for (const b of C.tabs) { const on = b.dataset.channel === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      C.input.placeholder = this._guestReadOnly() ? '게스트는 채팅을 읽을 수만 있어요' : id === 'local' ? `주변 ${LOCAL_R}m 안의 사람에게 말하기...` : C.placeholder;
      if (!opts.silent) { lsSet(LS_TAB, id); G.sfx('click'); }
      this._scrollBottom(true);
    },

    collapse(on, opts = {}) {
      const C = this._chat;
      if (!C) return;
      on = on ?? !C.panel.classList.contains('collapsed');
      C.panel.classList.toggle('collapsed', on);
      if (C.collapseBtn) {
        G.ui.setIcon(C.collapseBtn.querySelector('.ico') || C.collapseBtn, on ? 'plus' : 'minus');
        C.collapseBtn.title = on ? '채팅 펼치기' : '채팅 접기';
        C.collapseBtn.setAttribute('aria-label', C.collapseBtn.title);
      }
      if (!opts.silent) lsSet(LS_COLLAPSED, on ? '1' : '0');
      if (!on) { this._markRead(); this._scrollBottom(true); }
    },

    _smallScreen() { return !!window.matchMedia?.('(max-width: 560px)').matches; },
    /** 쉬운 모드 shows the chat log only with body.show-chat (the panel is a 💬 button otherwise) */
    _easyLayout() { return document.body.classList.contains('easy'); },
    _chatShown() {
      const C = this._chat;
      if (!C) return false;
      if (C.panel.classList.contains('chat-off') || C.panel.classList.contains('collapsed')) return false;
      if (this._smallScreen() || this._easyLayout()) return document.body.classList.contains('show-chat');
      return true;
    },
    /** chat button: show/hide the chat window (body.show-chat on small screens and in 쉬운 모드) */
    toggleChat(force) {
      const C = this._chat;
      if (!C) return;
      if (this._smallScreen() || this._easyLayout()) {
        const on = force ?? !document.body.classList.contains('show-chat');
        document.body.classList.toggle('show-chat', on);
        if (on) { C.panel.classList.remove('chat-off'); this.collapse(false, { silent: this._easyLayout() }); this._markRead(); this._scrollBottom(true); }
        else if (C.input === document.activeElement) C.input.blur();
        G.ui.setActive('chat', on);
        G.ui.setActive('kid-chat', on);
        return;
      }
      const shown = this._chatShown();
      const on = force ?? !shown;
      if (on) {
        C.panel.classList.remove('chat-off');
        if (C.panel.classList.contains('collapsed')) this.collapse(false);
        if (G.settings.chatVisible === false) G.setSetting('chatVisible', true);
        this._markRead();
        this._scrollBottom(true);
      } else {
        C.panel.classList.add('chat-off');
        if (G.settings.chatVisible !== false) G.setSetting('chatVisible', false);
      }
    },
    _applyChatVisibility() {
      const C = this._chat;
      if (!C) return;
      C.panel.classList.toggle('chat-off', G.settings.chatVisible === false);
    },
    /** make sure the chat window is open (keeps the chatVisible setting in sync) */
    _showPanel() {
      const C = this._chat;
      if (!C) return;
      if (this._smallScreen() || this._easyLayout()) { document.body.classList.add('show-chat'); G.ui.setActive('chat', true); G.ui.setActive('kid-chat', true); }
      C.panel.classList.remove('chat-off');
      if (G.settings.chatVisible === false) G.setSetting('chatVisible', true);
      if (C.panel.classList.contains('collapsed')) this.collapse(false, { silent: this._easyLayout() });
    },
    /** Enter: open the chat input (kid chat: the phrase picker — children never type) */
    focusChat() {
      const C = this._chat;
      if (!C || !G.state) return false;
      if (G.sys.photo?.active) return false;
      if (this._kidChatOn()) { if (G.ui.isBlocking()) return false; this.openKidChat(); return true; }
      if (this._guestReadOnly()) { G.ui.toast('게스트는 채팅을 읽을 수만 있어요. 로그인하면 대화에 참여할 수 있어요.', { type: 'info', sound: false }); return true; }
      this._showPanel();
      C.input.focus({ preventScroll: true });
      this._markRead();
      return true;
    },

    _scrollBottom(force) {
      const C = this._chat;
      if (!C) return;
      if (force || this._stick) {
        C.log.scrollTop = C.log.scrollHeight;
        this._stick = true;
        C.pill.hidden = true;
      }
    },
    _markRead() {
      this._unread = 0;
      this._unreadMention = false;
      const C = this._chat;
      if (C) { C.unread.hidden = true; C.unread.classList.remove('mention'); }
      G.ui.setBadge('chat', 0);
      for (const b of document.querySelectorAll('#hud-left-menu [data-action="chat"] .badge, #bottom-bar [data-action="chat"] .badge')) b.classList.remove('mention');
    },

    _resetChat() {
      this.messages.length = 0;
      if (this._chat) { this._chat.log.replaceChildren(); this._chat.input.value = ''; this._updateCount(); this._hideSuggest(); }
      this._typingNames.clear();
      this._renderTyping();
      this._recentKeys.length = 0; this._sendLog.length = 0; this._muteUntil = 0;
      this._markRead();
      this._stick = true;
    },

    _seedChat() {
      const kid = kidOn();
      this.system(kid ? '🌿 전통발효체험관에 온 걸 환영해요!' : '전통발효체험관 메타버스에 오신 것을 환영합니다!');
      this.system(kid ? '💬 버튼을 누르면 친구에게 인사할 수 있어요. 이름·전화번호·주소는 비밀이에요 🤫' : 'Enter 채팅 · T 이모지 · G 제스처 — 서로 배려하는 대화를 나눠 주세요. 욕설과 개인정보는 자동으로 가려져요.');
      if (this._mode === 'server') this.system(this._guestReadOnly() ? (kid ? '로그인하면 친구와 이야기할 수 있어요.' : '게스트로 접속했어요. 채팅을 읽을 수는 있지만 메시지를 보내려면 로그인이 필요해요.') : (kid ? '친구들과 함께 놀아요!' : '서버에 연결되었어요. 다른 체험객과 실시간으로 대화할 수 있어요.'));
      const nick = G.state?.profile?.nickname || '체험객';
      const npc = (id, fallback) => G.data.npcs?.[id]?.name || fallback;
      this._later(1600, () => { if (G.state) this.npcSay(npc('NPC001', '발효마스터'), kidOn() ? `${nick}, 반가워요! 같이 놀아요!` : `${J.nim(nick)}, 3D 체험관에 오신 것을 환영합니다!`); });
      this._later(3400, () => { if (G.state) this.npcSay(npc('NPC002', '산골농부'), kidOn() ? '반짝이는 별을 따라가 봐요! ⭐' : '항아리와 금빛 표식을 클릭해 보세요.'); });
    },

    /** add a message to the log. m: {name, text, channel, kind, self, near, uid, sid, history} */
    _push(m) {
      const kind = m.kind || (m.self ? 'me' : m.channel === 'system' ? 'system' : m.channel === 'npc' ? 'npc' : 'visitor');
      const msg = {
        id: m.sid != null ? `s${m.sid}` : `m${++this._seq}`,
        name: kind === 'visitor' || kind === 'remote' ? cleanName(m.name, kind) : cleanText(m.name || '익명', 24) || '익명',
        text: cleanText(m.text, 300),
        channel: ['all', 'local', 'system', 'npc'].includes(m.channel) ? m.channel : 'all',
        at: Number.isFinite(m.at) && m.at > 0 ? m.at : G.time.now(),
        self: !!m.self,
        kind,
        near: !!m.near,
        uid: m.uid != null ? String(m.uid).slice(0, 40) : null,
        mention: false,
        preset: null,
      };
      // personal information is hidden in every message, whoever sent it and in every mode (§12.4)
      if (kind !== 'system' && msg.text) msg.text = maskPIIInfo(msg.text).text;
      if (!msg.text) return null;
      // what the voice guide may read: our own lines (system / NPC / simulated visitors / me) as they are,
      // another account's message only when it is a preset kid phrase (then from the local phrase book)
      msg.preset = kind === 'remote' ? presetLine(msg.text) : msg.text;
      // @mention of my nickname (or the plain nickname) in someone else's message
      const nick = G.state?.profile?.nickname;
      if (!msg.self && kind !== 'system' && nick && cpLen(nick) >= 2 && msg.text.toLowerCase().includes(String(nick).toLowerCase())) msg.mention = true;
      this.messages.push(msg);
      while (this.messages.length > MAX_MSG) { const old = this.messages.shift(); old._el?.remove(); }
      this._render(msg);
      const pub = { ...msg }; delete pub._el; delete pub._txt; delete pub._kidHid;
      // listeners (알림함 …) get what a child may see: another account's free text stays hidden in kid chat, and a
      // preset phrase arrives as the local phrase-book text (never the received characters)
      if (this._kidHidden(msg)) { pub.text = '✉️ 글자 메시지예요'; pub.kidHidden = true; }
      else if (this._kidPhraseView(msg)) { pub.text = this._kidText(msg); pub.kidPhrase = true; }
      G.bus.emit('chat:message', { msg: pub });
      if (!msg.self && !m.history) {
        const visibleHere = !(this._isBlocked(msg.name) && msg.kind !== 'system' && msg.kind !== 'npc') && !(msg.channel === 'local' && !msg.near);
        if (visibleHere) this._kidHear(msg);
        if (visibleHere && msg.mention) {
          G.bus.emit('chat:mention', { msg: pub });
          const now = performance.now();
          if (now - this._mentionAt > 1500) { this._mentionAt = now; G.sfx('notify'); }
        }
        if (visibleHere && !this._chatShown()) {
          this._unread++;
          if (msg.mention) this._unreadMention = true;
          const C = this._chat;
          if (C) { C.unread.hidden = false; C.unread.textContent = this._unread > 99 ? '99+' : String(this._unread); C.unread.classList.toggle('mention', !!this._unreadMention); }
          G.ui.setBadge('chat', this._unread);
          if (this._unreadMention) for (const b of document.querySelectorAll('#hud-left-menu [data-action="chat"] .badge, #bottom-bar [data-action="chat"] .badge')) b.classList.add('mention');
        }
      }
      return msg;
    },
    /** message text as DOM nodes: @tokens and my nickname highlighted (text nodes only — never HTML) */
    _textNodes(text, nick) {
      const h = G.ui.h;
      const parts = [];
      const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let re;
      try { re = new RegExp(`@[^\\s@]{1,20}${nick && cpLen(nick) >= 2 ? `|${escRe(nick)}` : ''}`, 'gi'); } catch (e) { return [text]; }
      let last = 0, mm, guard = 0;
      while ((mm = re.exec(text)) && guard++ < 40) {
        if (mm.index > last) parts.push(text.slice(last, mm.index));
        const tok = mm[0];
        const mine = !!nick && tok.replace(/^@/, '').toLowerCase().startsWith(String(nick).toLowerCase());
        parts.push(h('mark', { class: mine ? 'at me' : 'at' }, tok));
        last = mm.index + tok.length;
      }
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    },

    _render(msg) {
      const C = this._chat;
      if (!C) return;
      const h = G.ui.h;
      const cls = ['chat-msg', msg.kind];
      if (msg.near || msg.self) cls.push('near');
      if (msg.channel === 'local') cls.push('ch-local');
      if (msg.kind !== 'system' && msg.kind !== 'npc' && !msg.self && this._isBlocked(msg.name)) cls.push('blocked');
      if (msg.mention) cls.push('mention');
      const el = h('div', { class: cls.join(' '), dataset: { id: msg.id } });
      if (msg.channel === 'local') el.appendChild(h('span', { class: 'ch-tag' }, '지역'));
      const isBtn = msg.kind !== 'system' && msg.kind !== 'me';
      const who = h(isBtn ? 'button' : 'span', { class: 'who', type: isBtn ? 'button' : null, dataset: { name: msg.name, kind: msg.kind, uid: msg.uid ?? '' }, title: isBtn ? `${msg.name} — 메뉴 열기` : null }, `${msg.name}:`);
      if (msg.kind === 'visitor' || msg.kind === 'remote') who.style.color = nameColor(msg.name);
      if (msg.kind === 'remote') who.dataset.say = '친구 이름이에요. 누르면 친구 메뉴가 열려요.';
      const txt = msg.kind === 'system' ? msg.text : this._textNodes(msg.text, msg.self ? null : G.state?.profile?.nickname);
      const txtEl = h('span', { class: 'txt' }, txt);
      el.append(who, txtEl, h('time', { class: 'time', datetime: new Date(msg.at).toISOString() }, hhmm(msg.at)));
      if (msg.kind === 'remote') { msg._txt = txtEl; this._applyKidView(msg); }
      C.log.appendChild(el);
      msg._el = el;
      if (this._stick) this._scrollBottom(true);
      else if (!el.classList.contains('blocked')) C.pill.hidden = false;
    },

    // ------------------------------------------------------------ public chat API
    /** system line that replaces its own previous copy when repeated within 20 s (weather / time slider spam) */
    _systemOnce(key, text) {
      this._sysOnce = this._sysOnce || {};
      const prev = this._sysOnce[key];
      if (prev && performance.now() - prev.at < 20000 && prev.msg?._el?.isConnected) {
        prev.msg.text = text;
        const t = prev.msg._el.querySelector('.txt');
        if (t) t.textContent = text;
        prev.at = performance.now();
        return prev.msg;
      }
      const msg = this.system(text);
      this._sysOnce[key] = { at: performance.now(), msg };
      return msg;
    },
    system(text) { if (!text) return null; return this._push({ name: '시스템', text: String(text), channel: 'system', kind: 'system' }); },

    npcSay(name, text) {
      if (!text) return null;
      let near = false;
      try {
        const pp = G.sys.player?.position;
        const rec = G.sys.npc?.list?.().find((r) => r.data?.name === name);
        if (pp && rec?.position) near = Math.hypot(rec.position.x - pp.x, rec.position.z - pp.z) <= LOCAL_R;
      } catch (e) { /* optional */ }
      return this._push({ name: name || 'NPC', text: this.filter(String(text)), channel: 'npc', kind: 'npc', near });
    },

    /** bad words masked with ♡♡ (spacing / punctuation / jamo / l33t / full-width tricks normalised first) */
    filter(text) { try { return maskBad(text); } catch (e) { G.log.warn('SOCIAL', 'filter failed', e); return String(text ?? ''); } },
    hasBadWord(text) { try { return badRanges(String(text ?? '')).length > 0; } catch (e) { return false; } },
    /** shared helpers (used by the developer self-test and other modules) */
    cleanText(text, max = MAX_LEN) { return cleanText(text, max); },
    cleanName(name) { return cleanName(name, 'remote'); },
    emojify(text) { return applyShortcuts(String(text ?? ''), true); },
    _buildFilter() { this._badRe = badRegex(); },

    _guestReadOnly() {
      if (this._mode !== 'server') return false;
      const p = G.save?.profile || G.state?.profile || {};
      return !!(p.guest || p.role === 'guest' || /^guest/i.test(String(p.id || 'guest')));
    },
    _updateGuestUi() {
      const C = this._chat;
      if (!C) return;
      const ro = this._guestReadOnly();
      C.input.disabled = ro;
      if (C.send) C.send.disabled = ro;
      C.panel.classList.toggle('read-only', ro);
      this.setTab(this.tab, { silent: true });
    },

    /** opts: {reply: 'greet'|'feel'|'praise'|'play'|'emoji'} how simulated visitors should answer (kid phrases) */
    sendChat(text, channel = 'all', opts = {}) {
      if (!G.state) return false;
      let t = cleanText(applyShortcuts(cleanText(text, MAX_LEN * 2), true), MAX_LEN);
      if (!t) return false;
      const kid = kidOn();
      const warn = (adult, child, emoji) => { G.ui.toast(kid ? child : adult, { type: 'warn', emoji, say: kid ? child : undefined }); };
      if (this._guestReadOnly()) { warn('게스트는 채팅을 보낼 수 없어요. 로그인 후 이용해 주세요.', '로그인하면 친구와 이야기할 수 있어요.', '🔒'); return false; }
      // personal information never leaves the device (the server masks again): 🔒 + a friendly tip from 옹이
      const pii = maskPIIInfo(t);
      if (pii.hits) {
        t = pii.text;
        this._piiTip();
        if (!t.replace(/🔒|[\s\p{P}\p{S}]/gu, '')) { G.log.info('UI', 'chat: personal information only — not sent'); return false; }
      }
      const now = performance.now();
      // spam guard: 1.2 s between messages, ≤ 5 messages per 10 s, no repeating the same text within 20 s
      if (now < this._muteUntil) { warn(`잠깐 쉬어 가요! ${Math.ceil((this._muteUntil - now) / 1000)}초 뒤에 다시 보낼 수 있어요.`, '잠깐 쉬었다가 다시 말해요!', '⏳'); return false; }
      if (now - this._lastSent < RATE_MS) { warn('메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', '천천히 말해요!', '⏳'); return false; }
      while (this._sendLog.length && now - this._sendLog[0] > BURST_MS) this._sendLog.shift();
      if (this._sendLog.length >= BURST_N) {
        this._muteUntil = now + BURST_COOL;
        warn('메시지를 너무 많이 보냈어요. 8초 뒤에 다시 보낼 수 있어요.', '말을 많이 했어요. 조금 쉬어요!', '⏳');
        return false;
      }
      const key = spamKey(t);
      while (this._recentKeys.length && (now - this._recentKeys[0].at > DUP_MS || this._recentKeys.length > 3)) this._recentKeys.shift();
      if (this._recentKeys.some((r) => r.key === key)) { warn('같은 메시지를 연달아 보낼 수 없어요. 조금 뒤에 다시 보내 주세요.', '방금 한 말이에요. 다른 말을 골라 봐요!', '🔁'); return false; }
      this._recentKeys.push({ key, at: now });
      this._sendLog.push(now);
      this._lastSent = now;
      this._lastText = t;
      const ch = channel === 'local' ? 'local' : 'all';
      const masked = this.filter(t);
      if (masked !== t) G.ui.toast(kid ? '고운 말을 써요! 💚' : '고운 말을 써 주세요. 일부 표현이 ♡♡로 가려졌어요.', { type: 'info', emoji: '💚', sound: false, duration: 2200 });
      const nick = G.state.profile?.nickname || '나';
      const msg = this._push({ name: nick, text: masked, channel: ch, kind: 'me', self: true, near: true, uid: G.save?.profile?.id ?? null });
      this.say(masked);
      G.sfx('chat');
      G.bus.emit('chat:sent', { text: masked, channel: ch });
      G.log.info('UI', `chat sent (${ch}, ${cpLen(masked)}자)`); // never log message contents
      if (this._mode === 'server') this._serverSend(masked, ch, msg);
      else this._visitorsHear(masked, ch, opts.reply || null);
      return true;
    },
    /** 옹이's friendly reminder after personal information was masked (at most every 12 s) */
    _piiTip() {
      const now = performance.now();
      if (now - (this._piiTipAt || -1e9) < 12000) return;
      this._piiTipAt = now;
      // "자물쇠" keeps the sentence whole when the voice guide drops the emoji
      const line = '이름·전화번호·주소는 비밀이에요! 🤫 자물쇠 🔒로 가렸어요.';
      let shown = false;
      try { shown = !!G.mascot?.say?.(line, { mood: 'think', priority: true, force: true, duration: 5200, source: 'pii' }); } catch (e) { shown = false; }
      if (!shown) G.ui.toast(line, { type: 'info', emoji: '🤫', say: kidOn() ? line : undefined });
      G.log.info('UI', 'chat: personal information masked');
    },
    /** personal information -> 🔒 (phones, e-mails, URLs, SNS ids, addresses, schools); mirror of ChatFilter::maskPII */
    maskPII(text) { try { return maskPIIInfo(text).text; } catch (e) { G.log.warn('SOCIAL', 'maskPII failed', e); return String(text ?? ''); } },
    hasPII(text) { try { return maskPIIInfo(text).hits > 0; } catch (e) { return false; } },
    /** nickname rule shared with the server (ChatFilter::nicknameLooksPersonal): PII, platform ids, school / class */
    nicknameLooksPersonal(nick) { try { return nicknameLooksPersonal(nick); } catch (e) { return true; } },
    /** the ordered PII rules (tests/pii-sync.mjs exports them to server/lib/pii-rules.json; dev-center checks) */
    _piiRules() { return PII_SRC.map(([name, src, flags, pred]) => ({ name, src, flags, pred: pred ? pred.name : null })); },

    // ================================================================ bubbles
    _bubbleEl(cls) { return G.ui.h('div', { class: `bubble soc-bubble ${cls || ''}`, hidden: true, role: 'status' }); },
    _initMyBubble() {
      const h = G.ui.h;
      const bubble = this._bubbleEl('me');
      const wrap = h('div', { class: 'soc-me-wrap' }, bubble);
      const head = () => G.sys.player?.rig?.headAnchor || null;
      const label = G.ui.label({ el: wrap, target: head, offsetY: 0.04, maxDist: 70, fadeDist: 10 });
      label.setVisible(false);
      this._me = { label, bubble, t: 0 };
    },
    _clearMyBubble() { if (this._me) { this._me.t = 0; this._me.bubble.hidden = true; this._me.label.setVisible(false); } },
    /** show text (or an emoji with {emote:true}) in a bubble holder {bubble, t, label?} */
    _bubble(holder, text, opts = {}) {
      if (!holder || (!text && !opts.typing)) return;
      const b = holder.bubble;
      b.classList.toggle('emote', !!opts.emote);
      b.classList.toggle('typing', !!opts.typing);
      b.classList.remove('out');
      holder.out = false;
      if (opts.typing) { const h = G.ui.h; b.replaceChildren(h('span', { class: 'soc-dots' }, h('i'), h('i'), h('i'))); }
      else b.textContent = String(text);
      // what a long-press may read (another account's bubble: never its free text)
      if (opts.say) b.dataset.say = String(opts.say).slice(0, 140); else delete b.dataset.say;
      b.hidden = false;
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      holder.t = opts.dur ?? (opts.emote ? 2.6 : clamp(2.4 + cpLen(text) * 0.07, 3, 6.5));
      holder.label?.setVisible?.(true);
    },
    _tickBubble(holder, dt) {
      if (!holder || holder.t <= 0) return;
      holder.t -= dt;
      if (holder.t <= 0.26 && !holder.out) { holder.out = true; holder.bubble.classList.remove('pop'); holder.bubble.classList.add('out'); }
      if (holder.t <= 0) { holder.bubble.hidden = true; holder.bubble.classList.remove('out', 'typing'); holder.label?.setVisible?.(false); }
    },
    _hideBubble(holder) { if (!holder) return; holder.t = 0; holder.out = false; holder.bubble.hidden = true; holder.bubble.classList.remove('out', 'typing'); holder.label?.setVisible?.(false); },
    /** my own speech bubble */
    say(text) { if (G.state && text) this._bubble(this._me, String(text)); },

    // ================================================================ emotes & gestures
    _initActions() {
      const A = G.ui;
      A.onAction('chat', () => this.toggleChat());
      A.onAction('chat-collapse', () => this.collapse());
      A.onAction('emote', (el) => this.openEmotes(el));
      A.onAction('gesture', (el) => this.openGestures(el));
      A.onAction('voice', () => this.toggleVoice());
      const IN = G.input;
      if (!IN?.onKey) return;
      for (const code of ['Enter', 'NumpadEnter']) IN.onKey(code, () => this.focusChat());
      IN.onKey('KeyT', () => { if (!G.state || G.sys.photo?.active) return false; if (kidOn()) this.openExpress(); else this.openEmotes(); return true; });
      IN.onKey('KeyG', () => { if (!G.state || G.sys.photo?.active) return false; if (kidOn()) this.openExpress(); else this.openGestures(); return true; });
      for (let i = 1; i <= 8; i++) {
        const sel = () => {
          const p = this._picker;
          if (!p || p.pop?.closed || (p.kind !== 'emote' && p.kind !== 'gesture')) return false;
          const list = p.kind === 'emote' ? G.data.emotes : G.data.gestures;
          const it = list?.[i - 1];
          if (!it) return false;
          G.ui.popover.close();
          if (p.kind === 'emote') this.emote(it.id); else this.gesture(it.id);
          return true;
        };
        IN.onKey('Digit' + i, sel);
        IN.onKey('Numpad' + i, sel);
      }
    },

    _anchorFor(action) {
      const el = document.querySelector(`#bottom-bar [data-action="${action}"]`);
      return el && el.offsetParent !== null ? el : document.querySelector('#bottom-bar') || document.body;
    },
    _closePicker() { if (this._picker) { try { this._picker.pop?.close(); } catch (e) { /* closed */ } this._picker = null; } },

    /** ONE picker for emotes + gestures (normal mode): T opens the 이모지 tab, G the 제스처 tab, the tabs switch in place */
    _openPicker(kind, anchor) {
      if (!G.state) return;
      const cur = this._picker;
      if (cur && !cur.pop?.closed) {
        if (cur.kind === kind) { this._closePicker(); return; }
        if (cur.render) { cur.render(kind); G.sfx('click'); return; }
      }
      anchor = anchor && anchor.isConnected ? anchor : this._anchorFor(kind);
      const h = G.ui.h;
      const grid = h('div', { class: 'pick-grid' });
      const title = h('h4');
      const key = h('kbd');
      const tip = h('p', { class: 'soc-pk-tip' });
      const tabs = h('div', { class: 'soc-pk-tabs', role: 'tablist', 'aria-label': '표현 종류' });
      const tabBtn = {};
      for (const [k, emo, label] of [['emote', '😊', '이모지'], ['gesture', '🙌', '제스처']]) {
        const b = h('button', { type: 'button', role: 'tab', class: 'soc-pk-tab', dataset: { k } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emo), label);
        b.addEventListener('click', () => { if (picker.kind !== k) { render(k); G.sfx('click'); } });
        tabBtn[k] = b;
        tabs.appendChild(b);
      }
      const box = h('div', { class: 'soc-picker soc-picker-express' }, h('div', { class: 'soc-pk-head' }, title, tabs, key), grid, tip);
      const picker = { kind, pop: null, render: null };
      const render = (k) => {
        picker.kind = k;
        box.classList.toggle('soc-picker-emote', k === 'emote');
        box.classList.toggle('soc-picker-gesture', k === 'gesture');
        title.textContent = k === 'emote' ? '이모지 보내기' : '제스처';
        key.textContent = k === 'emote' ? 'T' : 'G';
        tip.textContent = k === 'emote' ? '숫자 키 1–8로도 바로 보낼 수 있어요. 가까운 체험객이 반응할지도 몰라요!' : '반복 동작은 다시 누르거나 움직이면 멈춰요.';
        for (const [kk, b] of Object.entries(tabBtn)) { const on = kk === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
        const list = (k === 'emote' ? G.data.emotes : G.data.gestures) || [];
        const current = G.sys.player?.rig?.currentAction || null;
        grid.replaceChildren();
        list.forEach((it, i) => {
          const loopOn = k === 'gesture' && it.loop && current === it.anim;
          const b = h('button', { class: `pick${loopOn ? ' active' : ''}`, type: 'button', dataset: { id: it.id }, title: `${it.name} (${i + 1})` },
            h('span', { class: 'emoji' }, it.icon), h('span', { class: 'pk-name' }, it.name), h('kbd', { class: 'pk-key' }, String(i + 1)),
            k === 'gesture' && it.loop ? h('span', { class: 'pk-loop', title: '반복 동작' }, loopOn ? '중지' : '반복') : null);
          b.style.setProperty('--i', String(i));
          grid.appendChild(b);
        });
      };
      picker.render = render;
      render(kind);
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.pick');
        if (!b) return;
        G.ui.popover.close();
        if (picker.kind === 'emote') this.emote(b.dataset.id); else { this.gesture(b.dataset.id); G.sfx('click'); }
      });
      const pop = G.ui.popover.open(anchor, box, { id: 'social-express', placement: 'top', className: 'soc-pop', onClose: () => { if (this._picker?.pop === pop) this._picker = null; } });
      picker.pop = pop;
      this._picker = pop ? picker : null;
      if (pop) G.sfx('open');
    },
    openEmotes(anchor) { if (kidOn()) return this.openExpress(anchor); this._openPicker('emote', anchor); return null; },
    openGestures(anchor) { if (kidOn()) return this.openExpress(anchor); this._openPicker('gesture', anchor); return null; },

    // ================================================================ 쉬운 모드: 😊 표현하기 (one picture picker for emotes + gestures)
    /** -> [{id, emoji, label, say, emote?, gesture?, active}] (devcenter / tests) */
    expressItems() {
      const pl = G.sys.player;
      const cur = pl?.rig?.currentAction || null;
      const okE = (id) => !id || (G.data.emotes || []).some((e) => e.id === id);
      const okG = (id) => !id || (G.data.gestures || []).some((g) => g.id === id);
      return EXPRESS.filter((it) => okE(it.emote) && okG(it.gesture)).map((it) => {
        const g = it.gesture ? (G.data.gestures || []).find((x) => x.id === it.gesture) : null;
        const active = !!(g && g.loop && !it.emote && (cur === g.anim || (g.anim === 'sit' && pl?.sitting)));
        return { ...it, active };
      });
    },
    /** 😊 표현하기: big picture tiles in 쉬운 모드, the merged popover otherwise */
    async openExpress(anchor) {
      if (!G.state) return null;
      if (!kidOn() || !G.easy?.pick) { this._openPicker('emote', anchor); return null; }
      if (G.ui.modal.get('express')) { G.ui.modal.get('express').close(); return null; }
      this._closePicker();
      const items = this.expressItems().map((it) => ({
        id: it.id, emoji: it.emoji, label: it.active ? '그만' : it.label, say: it.active ? `${it.label} 그만해요` : it.say, selected: it.active, badge: it.active ? '⏹' : null,
      }));
      const id = await G.easy.pick({ id: 'express', title: '마음 보여 주기', emoji: '😊', say: '어떤 마음을 보여 줄까요? 그림을 눌러요.', items, columns: 4, className: 'soc-express-pick' });
      if (!id) return null;
      return this.express(id) ? id : null;
    },
    /** play one 표현하기 item: emote bubble + animation, gestures, or both for merged items (both events fire) */
    express(id) {
      const it = EXPRESS.find((x) => x.id === id);
      if (!it || !G.state) return false;
      if (it.emote) {
        this._lastEmote = -1e9; // a deliberate tap is never swallowed by the emote cool-down
        if (!this.emote(it.emote)) return false;
        if (it.gesture) {
          // merged tile: the emote already plays the same animation — count the gesture too (quests / missions)
          const g = (G.data.gestures || []).find((x) => x.id === it.gesture);
          if (g) {
            this._gestureState = { id: g.id, anim: g.anim, loop: !!g.loop };
            G.bus.emit('gesture:played', { gestureId: g.id });
            if (this._mode === 'local') this._visitorsSeeGesture(g);
          }
        }
        return true;
      }
      const wasActive = !!this.expressItems().find((x) => x.id === id)?.active;
      if (!this.gesture(it.gesture)) return false;
      if (wasActive) { G.sfx('pop'); return true; } // a looping gesture (dance / sit) chosen again stops
      this._bubble(this._me, it.emoji, { emote: true });
      try { G.fx?.emoji3d?.(null, it.emoji, { scale: 0.9, rise: 1.0 }); } catch (e) { /* fx optional */ }
      G.sfx('emote');
      return true;
    },

    emote(id) {
      const e = (G.data.emotes || []).find((x) => x.id === id);
      if (!e || !G.state) return false;
      const now = performance.now();
      if (now - this._lastEmote < 650) return false;
      this._lastEmote = now;
      this._bubble(this._me, e.icon, { emote: true });
      try { G.sys.player?.playAction?.(e.anim); } catch (err) { G.log.warn('SOCIAL', 'emote anim failed', err); }
      G.sfx('emote');
      this._emoteState = { id: e.id, at: G.time.now(), seq: ++this._emoteSeq };
      G.bus.emit('emote:played', { emoteId: e.id });
      if (this._mode === 'local') this._visitorsSeeEmote(e);
      return true;
    },

    gesture(id) {
      const g = (G.data.gestures || []).find((x) => x.id === id);
      if (!g || !G.state) return false;
      const pl = G.sys.player;
      if (!pl) return false;
      const cur = pl.rig?.currentAction;
      // looping gestures toggle off when chosen again
      if (g.loop && (cur === g.anim || (g.anim === 'sit' && pl.sitting))) {
        try { if (g.anim === 'sit') pl.standUp?.(); else pl.stopAction?.(); } catch (e) { /* ignore */ }
        return true;
      }
      try { pl.playAction?.(g.anim, { duration: g.duration, loop: !!g.loop }); } catch (e) { G.log.warn('SOCIAL', 'gesture failed', e); }
      this._gestureState = { id: g.id, anim: g.anim, loop: !!g.loop };
      G.bus.emit('gesture:played', { gestureId: g.id });
      if (this._mode === 'local') this._visitorsSeeGesture(g);
      return true;
    },

    // ================================================================ 쉬운 모드: 💬 kid chat (preset phrases + emoji only, no typing)
    _kidChatOn() { return kidOn() && G.settings?.kidChat !== false; },
    /** the phrase book (devcenter / tests): {categories, phrases, emoji} */
    kidPhrases() { return { categories: KID_CATS.map((c) => ({ ...c })), phrases: KID_PHRASES.map((p) => ({ ...p })), emoji: KID_EMOJI.slice() }; },
    /** easy mode / kidChat changed (boot, profile load, settings, runtime switch): text box hidden, tabs reset */
    _syncKidChat() {
      const on = this._kidChatOn();
      const easy = kidOn();
      document.body.classList.toggle('kid-chat', on);
      const C = this._chat;
      if (C) {
        if (on) {
          if (document.activeElement === C.input) C.input.blur();
          C.input.value = '';
          this._updateCount();
          this._hideSuggest();
          if (this._rec) this.stopVoice();
        }
        if (easy) {
          if (this.tab !== 'all') this.setTab('all', { silent: true });
          if (C.panel.classList.contains('collapsed')) this.collapse(false, { silent: true });
        } else if (this._wasEasy) {
          const t = lsGet(LS_TAB, 'all');
          this.setTab(['all', 'local', 'system'].includes(t) ? t : 'all', { silent: true });
          if (lsGet(LS_COLLAPSED, '0') === '1') this.collapse(true, { silent: true });
        }
      }
      if (!on) this.closeKidChat();
      if (!easy) G.ui.modal.get('express')?.close();
      this._wasEasy = easy;
      this._refreshKidView();
    },
    closeKidChat() { const m = G.ui.modal.get('kid-chat'); if (m) m.close(); },

    /** 💬 (08-easy 'kid-chat' action): the phrase picker; with kidChat off it opens the ordinary chat input */
    openKidChat(anchor) {
      if (!G.state) return null;
      if (!this._kidChatOn()) { this._showPanel(); this.focusChat(); return null; }
      const open = G.ui.modal.get('kid-chat');
      if (open) { open.close(); return null; }
      if (G.sys.photo?.active) return null;
      this._closePicker();
      this._markRead();
      if (this._guestReadOnly()) {
        this._showPanel();
        G.easy?.alert?.({ emoji: '🔒', heading: '이야기', title: '로그인하면 친구와 이야기할 수 있어요.', text: '지금은 친구들의 이야기를 볼 수만 있어요.' });
        return null;
      }
      const h = G.ui.h;
      const st = { cat: KID_CATS.some((c) => c.id === this._kidCat) ? this._kidCat : 'hello', off: null, raf: 0, modal: null };
      this._kidUi = st;
      // last few messages as big bubbles, so a pre-reader sees (and hears) the answers right here
      const recent = h('div', { class: 'skc-recent', 'aria-live': 'polite' });
      const renderRecent = () => {
        st.raf = 0;
        const list = [];
        for (let i = this.messages.length - 1; i >= 0 && list.length < 3; i--) {
          const m = this.messages[i];
          if (m.kind === 'system' || m.kind === 'npc') continue;
          if (!m.self && this._isBlocked(m.name)) continue;
          if (m.channel === 'local' && !m.near) continue;
          list.unshift(m);
        }
        if (!list.length) {
          recent.replaceChildren(h('div', { class: 'skc-empty' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🙂'), '아직 조용해요. 먼저 인사해 볼까요?'));
          return;
        }
        recent.replaceChildren(...list.map((m) => {
          const ava = h('span', { class: 'skc-ava', 'aria-hidden': 'true' }, m.self ? '😊' : Array.from(m.name)[0] || '?');
          if (!m.self) ava.style.background = `hsl(${nameHue(m.name)} 70% 62%)`;
          const hidden = this._kidHidden(m);
          const row = h('div', { class: `skc-msg${m.self ? ' me' : ''}` }, ava, h('div', { class: 'skc-bub' }, h('b', null, m.self ? '나' : m.name), hidden ? h('span', { class: 'kid-hidden' }, '✉️ 글자 메시지예요') : h('span', null, this._kidText(m))));
          row.__easySpeak = { btn: null, text: this._kidSpeakText(m) };
          row.dataset.say = row.__easySpeak.text;
          return row;
        }));
      };
      const cats = h('div', { class: 'skc-cats', role: 'tablist', 'aria-label': '말 종류' });
      for (const c of KID_CATS) {
        const b = h('button', { type: 'button', class: 'skc-cat', role: 'tab', dataset: { cat: c.id }, 'data-say': `${c.label}. ${c.say}` },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji), h('span', { class: 'skc-cat-lbl' }, c.label));
        b.style.setProperty('--tile', c.color);
        cats.appendChild(b);
      }
      const grid = h('div', { class: 'easy-pick skc-grid', role: 'listbox', 'aria-label': '할 말 고르기' });
      grid.style.setProperty('--cols', '3');
      grid.style.setProperty('--cols-s', '2');
      grid.style.setProperty('--cols-xs', '2');
      const renderGrid = () => {
        for (const b of cats.children) { const on = b.dataset.cat === st.cat; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
        const color = KID_CATS.find((c) => c.id === st.cat)?.color || '#ffc93c';
        grid.replaceChildren(...KID_PHRASES.filter((p) => p.cat === st.cat).map((p, i) => {
          const b = h('button', { type: 'button', class: 'easy-tile skc-tile', role: 'option', dataset: { id: p.id } },
            h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, p.emoji), h('span', { class: 'et-label' }, p.text));
          b.style.setProperty('--tile', color);
          b.style.setProperty('--i', String(i));
          b.__easySpeak = { btn: null, text: p.text };
          return b;
        }));
      };
      const emo = h('div', { class: 'skc-emoji-row', role: 'group', 'aria-label': '이모지 보내기' });
      for (const e of KID_EMOJI) emo.appendChild(h('button', { type: 'button', class: 'skc-emo', dataset: { e }, 'aria-label': `${e} 보내기` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e)));
      const showing = () => document.body.classList.contains('show-chat');
      const logBtn = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no skc-log' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, showing() ? '🙈' : '👀'), h('span', null, showing() ? '이야기 숨기기' : '이야기 보기'));
      const body = h('div', { class: 'skc' },
        recent,
        cats,
        grid,
        h('div', { class: 'skc-sub' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✨'), '그림 하나로 말해요'),
        emo,
        h('div', { class: 'skc-foot' }, logBtn, h('span', { class: 'skc-safe' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🤫'), '이름·주소는 비밀!')));
      const sent = (el) => {
        el.classList.add('is-chosen');
        G.sfx('pop');
        this._kidCat = st.cat;
        setTimeout(() => { if (st.modal && !st.modal.closed) st.modal.close(); this.toggleChat(true); }, G.settings?.reduceMotion ? 60 : 380);
      };
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.skc-tile');
        if (!b) return;
        if (this.sendKidPhrase(b.dataset.id)) sent(b);
        else { b.classList.remove('easy-shake'); void b.offsetWidth; b.classList.add('easy-shake'); }
      });
      emo.addEventListener('click', (e) => {
        const b = e.target.closest('.skc-emo');
        if (!b) return;
        if (this.sendKidEmoji(b.dataset.e)) sent(b);
        else { b.classList.remove('easy-shake'); void b.offsetWidth; b.classList.add('easy-shake'); }
      });
      cats.addEventListener('click', (e) => {
        const b = e.target.closest('.skc-cat');
        if (!b || b.dataset.cat === st.cat) return;
        st.cat = b.dataset.cat;
        renderGrid();
        G.sfx('page');
        const c = KID_CATS.find((x) => x.id === st.cat);
        if (c) kidSay(`${c.label}. ${c.say}`, { force: true, priority: 1 });
      });
      // arrow keys move between the phrase tiles (keyboard users)
      grid.addEventListener('keydown', (e) => {
        const tiles = Array.from(grid.querySelectorAll('.skc-tile'));
        const i = tiles.indexOf(document.activeElement);
        if (i < 0) return;
        let c = 3;
        try { const tpl = getComputedStyle(grid).gridTemplateColumns; if (tpl && tpl !== 'none') c = tpl.split(' ').filter(Boolean).length || 3; } catch (err) { c = 3; }
        const mv = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: c, ArrowUp: -c }[e.key];
        if (mv == null) return;
        e.preventDefault();
        tiles[clamp(i + mv, 0, tiles.length - 1)].focus();
      });
      logBtn.addEventListener('click', () => { const on = !showing(); this.toggleChat(on); st.modal?.close(); });
      renderGrid();
      renderRecent();
      st.off = G.bus.on('chat:message', ({ msg } = {}) => {
        if (!st.raf) st.raf = requestAnimationFrame(renderRecent);
        if (msg && !msg.self) this._markRead();
      });
      const m = G.ui.modal.open({
        id: 'kid-chat', title: '친구에게 말해요', icon: '💬', size: 'lg', className: 'skc-modal easy-pick-modal', autofocus: false,
        say: '친구에게 무슨 말을 할까요? 그림을 눌러요.', body, actions: [],
        onClose: () => {
          try { st.off?.(); } catch (e) { /* ignore */ }
          cancelAnimationFrame(st.raf);
          if (this._kidUi === st) this._kidUi = null;
          G.ui.setActive('kid-chat', showing());
        },
      });
      st.modal = m;
      G.ui.setActive('kid-chat', true);
      if (!G.input?.touchUI) setTimeout(() => { if (!m.closed) grid.querySelector('.skc-tile')?.focus({ preventScroll: true }); }, 60);
      return m;
    },
    /** send one preset phrase (kid chat). Visitors answer in kind; replies are read aloud for 12 s */
    sendKidPhrase(id) {
      const p = KID_PHRASES.find((x) => x.id === id);
      if (!p || !G.state) return false;
      const cat = KID_CATS.find((c) => c.id === p.cat);
      if (!this.sendChat(`${p.text} ${p.emoji}`, 'all', { reply: cat?.reply || 'greet' })) return false;
      this._kidListenUntil = performance.now() + 12000;
      G.bus.emit('kid:phrase', { phraseId: p.id });
      kidSay(p.text, { priority: 1 });
      return true;
    },
    /** send one emoji from the kid emoji row */
    sendKidEmoji(e) {
      if (!KID_EMOJI_SET.has(e) || !G.state) return false;
      if (!this.sendChat(e, 'all', { reply: 'emoji' })) return false;
      this._kidListenUntil = performance.now() + 8000;
      G.bus.emit('kid:phrase', { phraseId: `emoji:${e}` });
      return true;
    },
    /**
     * 쉬운 모드: read an incoming line aloud while the child is chatting. Never another account's free text or
     * nickname: a remote preset phrase is read from the local phrase book as "친구가 말해요. …", anything else
     * (and every @mention) only chimes. Simulated visitors speak code-written lines, so they are read as they are.
     */
    _kidHear(msg) {
      if (!msg || msg.self || !kidOn() || (msg.kind !== 'visitor' && msg.kind !== 'remote')) return;
      const listening = !!this._kidUi || performance.now() < (this._kidListenUntil || 0);
      if (!listening && !msg.mention) return;
      const line = msg.kind === 'remote' ? presetLine(msg.text) : msg.preset;
      if (!listening || line == null || line === '') {
        // free text from a person, an emoji, or a mention outside the chat window: a soft chime, no words
        const now = performance.now();
        if (now - (this._kidChimeAt || -1e9) > 1500) { this._kidChimeAt = now; G.sfx(msg.mention ? 'notify' : 'chat', { volume: 0.7 }); }
        return;
      }
      kidSay(msg.kind === 'remote' ? `친구가 말해요. ${line}` : `${J.iga(msg.name)} 말해요. ${line}`, { interrupt: false });
    },
    /** what a 🔊 / long-press may read for a chat line (same rule as _kidHear) */
    _kidSpeakText(m) {
      if (m.self) return `내가 말했어요. ${m.text}`;
      if (m.kind === 'remote') { const p = presetLine(m.text); return p ? `친구가 말했어요. ${p}` : (p === '' ? '친구가 그림말을 보냈어요.' : '친구가 글자로 말했어요. 어른과 함께 봐요.'); }
      return `${J.iga(m.name)} 말했어요. ${m.preset ?? m.text}`;
    },
    /**
     * kid chat (easy + 아이 채팅): another account's free text is not shown to the child either — only preset
     * phrases and emoji (the same set the child can send). A grown-up who turns 아이 채팅 off sees the real text.
     */
    _kidHidden(m) { return !!m && m.kind === 'remote' && !m.self && this._kidChatOn() && presetShow(m.text) == null; },
    /** kid chat shows another account's preset phrase from the local phrase book (not the received characters) */
    _kidPhraseView(m) { return !!m && m.kind === 'remote' && !m.self && this._kidChatOn() && presetShow(m.text) != null; },
    /** the text a message shows right now (kid chat: phrase-book text for remote presets) */
    _kidText(m) { return this._kidPhraseView(m) ? presetShow(m.text) : m?.text; },
    _applyKidView(m) {
      const t = m?._txt;
      if (!t) return;
      const hide = this._kidHidden(m);
      const view = hide ? '#hidden' : this._kidPhraseView(m) ? '#phrase' : '#text';
      if (m._kidHid === view) return;
      m._kidHid = view;
      t.classList.toggle('kid-hidden', hide);
      if (hide) {
        t.replaceChildren(G.ui.h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✉️'), ' 글자 메시지예요');
        t.dataset.say = '친구가 글자로 말했어요. 어른과 함께 봐요.';
      } else if (view === '#phrase') {
        t.replaceChildren(document.createTextNode(presetShow(m.text)));
        t.dataset.say = this._kidSpeakText(m);
      } else {
        t.replaceChildren(...[].concat(this._textNodes(m.text, G.state?.profile?.nickname)));
        if (m.kind === 'remote') t.dataset.say = this._kidSpeakText(m); else delete t.dataset.say;
      }
    },
    _refreshKidView() { for (const m of this.messages || []) if (m.kind === 'remote') this._applyKidView(m); },

    /** 쉬운 모드 user menu (a name tag / chat name tapped): big pictures, no typing */
    async _kidUser(info, rec, npcRec) {
      if (!G.easy?.pick) return;
      const name = info.name;
      const kind = info.kind === 'npc' ? 'npc' : info.kind === 'remote' ? 'remote' : 'visitor';
      const blocked = this._isBlocked(name);
      const pos = rec?.position || npcRec?.position || null;
      // another account's nickname is free text chosen by a stranger: it may be SHOWN, but the voice only ever says
      // "친구" (NPC and simulated visitor names are written by this game and are read as they are)
      const who = kind === 'remote' ? '친구' : name;
      const items = [];
      if (kind !== 'npc' && !blocked) items.push({ id: 'hi', emoji: '👋', label: '인사', say: `${who}에게 인사해요`, color: '#4fb3ff' });
      if (pos) items.push({ id: 'go', emoji: '📍', label: '가까이', say: `${who}에게 가요`, color: '#55d187' });
      if (kind !== 'npc') {
        items.push(blocked ? { id: 'unblock', emoji: '👀', label: '다시 보기', say: '다시 볼까요? 어른이 도와줘요.', color: '#b48bff' }
          : { id: 'block', emoji: '🙈', label: '안 볼래요', say: `${who}의 말을 안 볼래요`, color: '#ffc93c' });
        items.push({ id: 'report', emoji: '🚨', label: '어른에게', say: '싫은 말을 했나요? 어른에게 알려요.', color: '#ff7a59' });
      }
      if (!items.length) return;
      const picking = G.easy.pick({ id: 'kid-user', title: name, emoji: kind === 'npc' ? '⭐' : '🙂', say: kind === 'remote' ? '친구에게 무엇을 할까요?' : `${name}. 무엇을 할까요?`, items, columns: Math.min(items.length, 4) });
      // a long-press on the title reads this line instead of the stranger's nickname
      if (kind === 'remote') { const t = G.ui.modal?.get?.('kid-user')?.el?.querySelector?.('.modal-head h2'); if (t) t.dataset.say = '친구 메뉴예요. 무엇을 할까요?'; }
      const id = await picking;
      if (!id || !G.state) return;
      if (id === 'hi') { if (this.sendChat(`${name}, 안녕하세요! 👋`, 'all', { reply: 'greet' })) { this._kidListenUntil = performance.now() + 12000; if (rec?.position) G.sys.player?.faceTowards?.(rec.position.x, rec.position.z); this._lastEmote = -1e9; this.emote('EMO_HELLO'); } }
      else if (id === 'go') {
        if (npcRec && G.interact?.activate) G.interact.activate(npcRec.id);
        else if (pos && G.easy?.goTo) G.easy.goTo({ x: pos.x, z: pos.z, label: who }, { stopDistance: 2 });
        else this._goTo(info, rec, npcRec);
      } else if (id === 'block') {
        const ok = await G.easy.confirm({ emoji: '🙈', heading: '안 볼래요', title: `${name}의 말을 안 볼까요?`, say: `${who}의 말을 안 볼까요?`, yes: '안 볼래요', no: '아니요' });
        if (ok) this.block(name);
      } else if (id === 'unblock') {
        if (await G.easy.gate({ reason: 'unblock', title: '다시 보기' })) this.unblock(name);
      } else if (id === 'report') this._kidReport(info);
    },
    /** one-tap report for children: confirm → report (+ block) → "어른에게도 말해 줘요" */
    async _kidReport(info) {
      const ok = await G.easy?.confirm?.({ emoji: '🚨', heading: '어른에게 알리기', title: `${info.name}의 말이 싫었나요?`, text: '알리면 이 친구의 말이 더 이상 안 보여요.', say: '친구의 말이 싫었나요? 알리면 이 친구의 말이 더 이상 안 보여요.', yes: '알려요', no: '아니요' });
      if (!ok || !G.state) return false;
      const lastMsg = info.msgId ? this.messages.find((m) => m.id === info.msgId) : [...this.messages].reverse().find((m) => m.name === info.name && !m.self);
      const done = await this._fileReport(info, 'kid', '', lastMsg, { quiet: true });
      if (!this._isBlocked(info.name)) this.block(info.name);
      G.easy?.alert?.({ emoji: done ? '🛡️' : '🙈', heading: '잘했어요', title: done ? '어른에게 알렸어요!' : '이제 이 친구의 말은 안 보여요.', text: '어른에게도 꼭 말해 줘요.' });
      return done;
    },

    // ================================================================ voice dictation (Web Speech API)
    toggleVoice() {
      if (this._rec) { this.stopVoice(); return false; }
      if (this._kidChatOn()) { this.openKidChat(); return false; } // dictation = free text: not for kid chat
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { G.ui.toast('이 브라우저는 음성 입력을 지원하지 않습니다', { type: 'warn', emoji: '🎙️' }); return false; }
      if (!G.state) return false;
      if (this._guestReadOnly()) { G.ui.toast('게스트는 채팅을 보낼 수 없어요. 로그인 후 이용해 주세요.', { type: 'warn' }); return false; }
      const C = this._chat;
      let rec;
      try { rec = new SR(); } catch (e) { G.ui.toast('음성 입력을 시작하지 못했어요.', { type: 'error' }); return false; }
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      const base = C && C.input.value.trim() ? C.input.value.trim() + ' ' : '';
      let finalText = '', failed = false, started = false;
      const finish = () => {
        clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
        if (this._rec === rec) this._rec = null;
        this._voiceUi(false);
      };
      rec.onstart = () => {
        started = true;
        clearTimeout(this._voiceWatch);
        if (C) C.input.placeholder = '듣고 있어요… 말씀해 주세요';
        G.sfx('pop');
      };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        if (C) { C.input.value = (base + finalText + interim).replace(/\s+/g, ' ').slice(0, MAX_LEN); this._updateCount(); }
      };
      rec.onerror = (e) => {
        failed = true;
        const MSG = {
          'not-allowed': '마이크 사용이 허용되지 않았어요. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.',
          'service-not-allowed': '이 환경에서는 음성 인식을 사용할 수 없어요. (https 주소에서 이용해 주세요)',
          'no-speech': '음성이 들리지 않았어요. 다시 시도해 주세요.',
          'audio-capture': '마이크를 찾을 수 없어요. 마이크 연결을 확인해 주세요.',
          network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
          aborted: null,
          'language-not-supported': '이 브라우저는 한국어 음성 인식을 지원하지 않아요.',
        };
        const m = e.error in MSG ? MSG[e.error] : '음성 인식 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
        if (m) G.ui.toast(m, { type: 'warn', emoji: '🎙️' });
        G.log.warn('UI', 'speech recognition error', e.error);
      };
      rec.onend = () => {
        if (this._rec !== rec) return; // superseded / already cleaned up
        finish();
        const text = finalText.trim();
        if (C && text && !failed) {
          C.input.focus({ preventScroll: true });
          try { C.input.setSelectionRange(C.input.value.length, C.input.value.length); } catch (e) { /* ignore */ }
          G.ui.toast('음성이 입력되었어요. Enter를 누르면 전송돼요.', { type: 'success', emoji: '🎙️', sound: false, duration: 2200 });
        } else if (C && !failed) {
          C.input.value = base.trim();
          this._updateCount();
          if (started) G.ui.toast('음성이 인식되지 않았어요. 다시 시도해 주세요.', { type: 'info', emoji: '🎙️', sound: false });
        }
      };
      try { rec.start(); } catch (e) { G.ui.toast('음성 입력을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'warn' }); return false; }
      this._rec = rec;
      this._voiceUi(true);
      if (C) C.input.placeholder = '음성 인식을 준비하고 있어요…';
      G.sys.audio?.duck?.('voice', 0.2);
      // some browsers never answer (no microphone / offline engine): give up with a clear message
      clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
      this._voiceWatch = setTimeout(() => {
        if (this._rec !== rec || started) return;
        failed = true;
        try { rec.abort(); } catch (e) { /* ignore */ }
        finish();
        G.ui.toast('음성 인식을 시작하지 못했어요. 마이크 연결과 브라우저 권한을 확인해 주세요.', { type: 'warn', emoji: '🎙️' });
      }, 5000);
      this._voiceMax = setTimeout(() => { if (this._rec === rec) { try { rec.stop(); } catch (e) { /* ignore */ } } }, 15000);
      return true;
    },
    stopVoice() {
      const r = this._rec;
      this._rec = null;
      clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
      if (r) { try { r.abort(); } catch (e) { try { r.stop(); } catch (e2) { /* ignore */ } } }
      this._voiceUi(false);
    },
    _voiceUi(on) {
      G.ui.setActive('voice', on);
      document.body.classList.toggle('voice-listening', on);
      const C = this._chat;
      if (C) {
        C.form.classList.toggle('listening', on);
        C.voiceInd.hidden = !on;
        if (on) this._showPanel();
        else this.setTab(this.tab, { silent: true });
      }
      if (!on) G.sys.audio?.unduck?.('voice');
    },

    // ================================================================ blocking / reporting
    _blockedList() { const s = G.state; if (!s) return []; if (!Array.isArray(s.blocked)) s.blocked = []; return s.blocked; },
    _isBlocked(name) { return !!name && this._blockedList().includes(String(name)); },
    isBlocked(name) { return this._isBlocked(name); },
    block(name) {
      if (!name || !G.state) return false;
      const list = this._blockedList();
      if (!list.includes(name)) { list.push(String(name)); G.dirty('blocked'); }
      this._refreshBlocked();
      G.ui.toast(kidOn() ? `${name}의 말이 이제 안 보여요.` : `${J.eulreul(J.nim(name))} 차단했어요. 이 사용자의 채팅과 말풍선이 더 이상 보이지 않아요.`, { type: 'success', emoji: kidOn() ? '🙈' : '🚫' });
      G.log.info('UI', `blocked ${name}`);
      return true;
    },
    unblock(name) {
      if (!name || !G.state) return false;
      const list = this._blockedList();
      const i = list.indexOf(String(name));
      if (i >= 0) { list.splice(i, 1); G.dirty('blocked'); }
      this._refreshBlocked();
      G.ui.toast(kidOn() ? `${name}의 말이 다시 보여요.` : `${J.nim(name)}의 차단을 해제했어요.`, { type: 'info', emoji: kidOn() ? '👀' : '🔓' });
      return true;
    },
    _refreshBlocked() {
      for (const m of this.messages) {
        if (!m._el || m.kind === 'system' || m.kind === 'npc' || m.self) continue;
        m._el.classList.toggle('blocked', this._isBlocked(m.name));
      }
      for (const o of this.others.values()) {
        const b = this._isBlocked(o.name);
        o.el?.root?.classList.toggle('blocked', b);
        if (b && o.bub) this._hideBubble(o.bub);
      }
      this._renderTyping();
      this._hideSuggest();
    },

    /** store / send one report -> Promise<bool> (server mode: chat/report.php; local: this device only) */
    async _fileReport(info, reason, memo, lastMsg, opts = {}) {
      const payload = { target: info.name, targetId: info.id || null, messageId: lastMsg?.id?.startsWith('s') ? Number(lastMsg.id.slice(1)) : null, text: lastMsg?.text || '', reason, memo: String(memo || '').slice(0, 200), at: G.time.now() };
      if (this._mode === 'server') {
        try {
          await G.net.request('chat/report.php', { body: payload, timeout: 8000 });
          if (!opts.quiet) G.ui.toast('신고가 접수되었어요. 운영자가 확인 후 조치할 예정이에요.', { type: 'success', emoji: '🚨' });
        } catch (e) {
          if (!opts.quiet) G.ui.toast(e?.message || '신고를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
          return false;
        }
      } else {
        try {
          const list = JSON.parse(lsGet(LS_REPORTS, '[]')) || [];
          list.push({ ...payload, reporter: G.state?.profile?.nickname || '' });
          while (list.length > 50) list.shift();
          lsSet(LS_REPORTS, JSON.stringify(list));
        } catch (e) { /* storage blocked */ }
        if (!opts.quiet) G.ui.toast('신고 내용이 기록되었어요. (로컬 모드에서는 이 기기에만 저장돼요)', { type: 'success', emoji: '🚨' });
      }
      G.log.info('UI', `report ${info.name} (${reason})`);
      return true;
    },

    report(info) {
      if (!info?.name) return;
      if (kidOn() && G.easy?.confirm) { this._kidReport(info); return; }
      const h = G.ui.h;
      const REASONS = [['abuse', '욕설·비방'], ['spam', '도배·광고'], ['harass', '불쾌한 행동'], ['privacy', '개인정보 노출'], ['etc', '기타']];
      let reason = 'abuse';
      const lastMsg = info.msgId ? this.messages.find((m) => m.id === info.msgId) : [...this.messages].reverse().find((m) => m.name === info.name && !m.self);
      G.ui.modal.open({
        id: 'chat-report', title: `${J.nim(info.name)} 신고하기`, icon: '🚨', size: 'sm', className: 'soc-report', autofocus: false,
        body: (body) => {
          const seg = h('div', { class: 'soc-reasons', role: 'radiogroup' });
          for (const [id, label] of REASONS) {
            const b = h('button', { type: 'button', class: `chip${id === reason ? ' chip-red' : ''}`, dataset: { r: id }, role: 'radio', 'aria-checked': id === reason ? 'true' : 'false' }, label);
            b.addEventListener('click', () => { reason = id; for (const x of seg.children) { const on = x.dataset.r === id; x.classList.toggle('chip-red', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } });
            seg.appendChild(b);
          }
          body.append(
            h('p', { class: 'dim small' }, '신고 사유를 선택해 주세요. 허위 신고는 제재될 수 있어요.'),
            seg,
            lastMsg ? h('div', { class: 'soc-quote' }, h('small', null, '신고할 메시지'), h('q', null, lastMsg.text)) : null,
            h('div', { class: 'field' }, h('label', { for: 'soc-report-memo' }, '추가 설명 (선택)'), h('textarea', { id: 'soc-report-memo', maxlength: '200', rows: '3', placeholder: '상황을 간단히 적어 주세요.' })),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'soc-report-block', checked: !this._isBlocked(info.name) }), '이 사용자도 차단하기'),
          );
        },
        actions: [
          { label: '취소', class: 'btn-ghost' },
          {
            label: '신고하기', class: 'btn-danger', onClick: async (m) => {
              const memo = m.body.querySelector('#soc-report-memo')?.value.trim().slice(0, 200) || '';
              const alsoBlock = !!m.body.querySelector('#soc-report-block')?.checked;
              if (!(await this._fileReport(info, reason, memo, lastMsg))) return false;
              if (alsoBlock && !this._isBlocked(info.name)) this.block(info.name);
              return true;
            },
          },
        ],
      });
    },

    /** small popover when a name (chat log or name tag) is clicked */
    _openUser(anchor, info) {
      if (!G.state || !info?.name) return;
      const h = G.ui.h;
      const kind = info.kind === 'npc' ? 'npc' : info.kind === 'remote' ? 'remote' : 'visitor';
      const rec = kind === 'npc' ? null : [...this.others.values()].find((o) => o.name === info.name) || null;
      const npcRec = kind === 'npc' ? (G.sys.npc?.list?.() || []).find((r) => r.data?.name === info.name) : null;
      if (kidOn() && G.easy?.pick) { this._kidUser(info, rec, npcRec); return; }
      const pos = rec?.position || npcRec?.position || null;
      const pp = G.sys.player?.position;
      const dist = pos && pp ? Math.round(Math.hypot(pos.x - pp.x, pos.z - pp.z)) : null;
      const zone = pos ? G.world.zoneAt(pos.x, pos.z) : null;
      const sub = kind === 'npc' ? (npcRec?.data?.role || 'NPC') : `${kind === 'remote' ? '접속 중인 체험객' : '체험객'}${zone ? ' · ' + zone.short : ''}${dist != null ? ` · ${dist}m` : ''}`;
      const blocked = this._isBlocked(info.name);
      const initial = Array.from(info.name)[0] || '?';
      const color = kind === 'npc' ? 'linear-gradient(160deg,#ffd766,#e2aa22)' : `linear-gradient(160deg, hsl(${nameHue(info.name)} 70% 62%), hsl(${(nameHue(info.name) + 40) % 360} 60% 42%))`;
      const actions = h('div', { class: 'soc-user-actions' });
      const add = (icon, label, fn, cls = '') => {
        const b = h('button', { type: 'button', class: `btn btn-sm ${cls}` }, h('span', { class: 'emoji' }, icon), label);
        b.addEventListener('click', () => { G.ui.popover.close(); fn(); });
        actions.appendChild(b);
      };
      if (pos) add('📍', kind === 'npc' ? '찾아가기' : '가까이 가기', () => this._goTo(info, rec, npcRec));
      if (kind !== 'npc') {
        add('👋', '인사하기', () => this._greetUser(info.name, rec));
        add(blocked ? '🔓' : '🚫', blocked ? '차단 해제' : '차단하기', () => (blocked ? this.unblock(info.name) : this.block(info.name)));
        add('🚨', '신고하기', () => this.report(info), 'btn-danger');
      }
      const box = h('div', { class: 'soc-user' },
        h('div', { class: 'soc-user-head' },
          h('span', { class: 'soc-ava', style: { background: color } }, kind === 'npc' ? (G.sys.npc?.icon?.(npcRec?.id) || '🧑') : initial),
          h('div', { class: 'soc-user-id' }, h('b', null, info.name), h('small', null, sub)),
          blocked ? h('span', { class: 'chip chip-red' }, '차단됨') : null),
        actions);
      G.ui.popover.open(anchor, box, { id: 'social-user', placement: anchor.closest?.('#labels-layer') ? 'top' : 'right', className: 'soc-pop soc-pop-user' });
    },
    _goTo(info, rec, npcRec) {
      const pl = G.sys.player;
      if (!pl) return;
      if (npcRec && G.interact?.activate) { G.interact.activate(npcRec.id); return; }
      const p = rec?.position || npcRec?.position;
      if (p) pl.walkTo?.({ x: p.x, z: p.z }, { stopDistance: 1.8, onArrive: () => pl.faceTowards?.(p.x, p.z) });
    },
    _greetUser(name, rec) {
      const nick = J.nim(name);
      if (!this.sendChat(`${nick}, 안녕하세요! 👋`, 'all')) return;
      if (rec?.position) G.sys.player?.faceTowards?.(rec.position.x, rec.position.z);
      this._lastEmote = -1e9;
      this.emote('EMO_HELLO');
    },

    // ================================================================ events → system messages / reactions
    _initEvents() {
      const on = (n, fn) => G.bus.on(n, (p) => { if (G.state) fn(p || {}); });
      const T = (adult, child) => (kidOn() ? child : adult);
      on('level:up', ({ level }) => {
        this.system(T(`🎉 레벨 ${level} 달성! 축하합니다.`, `⭐ 레벨 ${level}! 쑥쑥 컸어요!`));
        if (this._mode !== 'local') return;
        this._later(1200, () => {
          const before = this._gatherAt;
          this._gather('level');
          if (this._gatherAt === before) { const v = this._nearestVisitor(LOCAL_R, true); if (v) { this._visitorFace(v); this._visitorSay(v, this._replyLine('congrats'), { anim: 'clap' }); } }
        });
      });
      on('quest:claimed', () => { if (this._mode === 'local') this._later(1400, () => this._gather('quest')); });
      on('ferment:claimed', () => { if (this._mode === 'local') this._later(1400, () => this._gather('ferment')); });
      on('achievement:unlocked', ({ id }) => { const a = G.data.achievements?.[id]; if (a) this.system(T(`🏆 업적 달성: ${a.icon || ''} ${a.name}`, `🏅 메달을 받았어요: ${a.icon || ''} ${a.name}`)); });
      on('quest:completed', ({ questId }) => { const q = G.data.quests?.[questId]; if (q) this.system(T(`📜 퀘스트 완료: ${q.title} — 퀘스트 패널에서 보상을 받으세요.`, `🎁 잘했어요! 선물을 받아요: ${q.title}`)); });
      on('collection:unlocked', ({ id }) => { const c = G.data.collection?.[id]; if (c) this.system(T(`📖 도감에 등록됐어요: ${c.icon || ''} ${c.name}`, `📖 새 스티커: ${c.icon || ''} ${c.name}`)); });
      on('ferment:completed', ({ recipeId }) => { const r = G.data.recipes?.[recipeId]; this.system(T(`🏺 ${r ? r.name.replace(/ 체험$/, '') : '장독'} 발효가 완성되었어요! 장독대에서 수령해 보세요.`, '🏺 장독의 장이 다 익었어요!')); });
      on('weather:changed', ({ id, prev, source }) => {
        if (!prev || source === 'init' || prev === id) return;
        const w = G.data.weather?.[id];
        if (w) this._systemOnce('weather', `${{ CLEAR: '☀️', CLOUDY: '☁️', RAIN: '🌧️', FOG: '🌫️', SNOW: '❄️' }[id] || '🌤️'} 날씨가 ‘${w.name}’${hasFinal(w.name) && !finalIsRieul(w.name) ? '으로' : '로'} 바뀌었어요.`);
      });
      on('time:phase', ({ name, initial, prev }) => { if (!initial && prev && name) this._systemOnce('phase', `${{ 아침: '🌅', 낮: '☀️', 저녁: '🌇', 밤: '🌙' }[name] || '🕰️'} ${J.iga(name)} 되었어요.`); });
      G.bus.on('photo:mode', () => this._closePicker());
      G.bus.on('ui:modal-open', () => this._closePicker());
      G.bus.on('settings:changed', ({ key } = {}) => {
        if (key === 'chatVisible') this._applyChatVisibility();
        else if (key === 'easyMode' || key === 'kidChat') this._syncKidChat();
      });
      G.bus.on('easy:changed', () => this._syncKidChat());
      G.bus.on('engine:quality', () => { /* visitors keep their meshes; shadows follow the renderer */ });
    },

    _updateOnline() {
      const el = document.getElementById('hud-online-count');
      const n = this._mode === 'server' && this._srv?.online ? Math.max(this._srv.online, 1 + this.others.size) : this.online;
      if (el && el.textContent !== String(n)) el.textContent = String(n);
      const box = el?.closest('.hud-online');
      if (box) box.title = this._mode === 'server' ? `서버 접속자 ${n}명` : `체험객 ${n}명이 함께하고 있어요`;
    },

    // ================================================================ visitors (local simulation)
    _initVisitors() {
      if (!G.avatar?.create || !G.sys.engine?.scene) return;
      const names = (G.data.visitors?.names || []).slice();
      if (!names.length) return;
      const preset = G.sys.engine.preset || {};
      const want = preset.name === 'low' ? 8 : 11;
      this._target = Math.min(want, names.length);
      this._vroot = new THREE.Group();
      this._vroot.name = 'visitors';
      G.sys.engine.scene.add(this._vroot);
      this._shadow = !!preset.shadows;
      // build the pool now (loading screen) so logging in never hitches
      const poolSize = Math.min(names.length, this._target + 1);
      for (let i = 0; i < poolSize; i++) {
        try { this._pool.push(this._makeVisitor(names[i])); } catch (e) { G.log.warn('SOCIAL', `visitor ${names[i]} failed`, e); }
      }
      G.log.info('SOCIAL', `visitor pool: ${this._pool.length} (target ${this._target})`);
    },

    _makeVisitor(name) {
      const h = G.ui.h;
      const rig = G.avatar.create(G.avatar.random(U.hashInt('visitor:' + name)), { shadow: this._shadow });
      const group = new THREE.Group();
      group.name = 'visitor';
      group.add(rig.group);
      group.visible = false;
      this._vroot.add(group);
      const bubble = this._bubbleEl('visitor');
      const dot = h('i', { class: 'soc-dot' });
      const nm = h('span', { class: 'nm' });
      const tag = h('button', { class: 'nametag visitor', type: 'button' }, dot, nm);
      const root = h('div', { class: 'soc-label' }, bubble, tag);
      const v = {
        id: '', name: '', kind: 'visitor', rig, group, position: group.position, rotY: 0, zoneId: null,
        el: { root, bubble, tag, dot, nm }, bub: null, label: null,
        params: { speed: 0, grounded: true, vy: 0 },
        state: 'idle', t: 0, path: null, pi: 0, spot: null, prevSpot: null, stuck: 0, wait: 0, slide: null,
        react: null, talk: null, act: 0, simAcc: 0, animAcc: 0, camDist: 0, hidden: true, onScreen: true,
        speed: rand(1.15, 1.5), greetAt: -1e9, leaving: false, active: false, nextLineOk: 0,
      };
      v.label = G.ui.label({ el: root, target: rig.headAnchor, offsetY: 0.04, maxDist: LABEL_DIST, fadeDist: 8 });
      v.label.setVisible(false);
      v.bub = { bubble, t: 0, label: null };
      tag.addEventListener('click', (e) => { e.stopPropagation(); this._openUser(tag, { name: v.name, kind: 'visitor', id: v.id }); });
      this._assignName(v, name);
      return v;
    },
    _assignName(v, name) {
      v.name = name;
      v.id = 'V_' + name;
      v.el.nm.textContent = name;
      v.el.dot.style.background = nameColor(name);
      v.el.tag.title = `${name} · 클릭하면 메뉴가 열려요`;
      try { v.rig.setAppearance(G.avatar.random(U.hashInt('visitor:' + name))); } catch (e) { /* keep the old look */ }
    },

    // ---------------------------------------------------------------- navigation graph
    async _buildNav() {
      const L = G.data.layout || {};
      const W = G.world;
      NAV.nodes = []; NAV.hash = new Map(); NAV.ready = false;
      NAV.crops = (L.farmPlots || []).map((p) => ({ x: p.x, z: p.z, hw: (p.w || 6) / 2 + 0.45, hd: (p.d || 6) / 2 + 0.45 }));
      let budget = performance.now();
      const breathe = async () => { if (performance.now() - budget > 10) { await U.nextFrame(); budget = performance.now(); } };
      const t0 = performance.now();
      const nodes = NAV.nodes;
      const tryAdd = (x, z, kind, gap = 2.2) => {
        const y = W.surfaceHeight(x, z);
        if (!Number.isFinite(y) || y > 3.2 || y < -0.6) return null;
        if (walkY(x, z, y, 0.42) == null) return null;
        if (gap > 0) for (const [d] of navNear(x, z, gap)) if (d < gap) return null;
        const n = { i: nodes.length, x, z, y, kind, adj: [], main: false, path: kind === 'path' };
        nodes.push(n);
        const c = NAV.cell, k = hkey(Math.floor(x / c), Math.floor(z / c));
        if (!NAV.hash.has(k)) NAV.hash.set(k, []);
        NAV.hash.get(k).push(n.i);
        return n;
      };
      // 1) destination spots (validated, get their own node)
      this.spots = this._buildSpots();
      for (const s of this.spots) { const n = tryAdd(s.x, s.z, 'spot', 0); s.node = n; }
      await breathe();
      // 2) paths sampled every 4 m
      for (const p of L.paths || []) {
        const pts = p.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(d / 4));
          for (let k = 0; k <= n; k++) tryAdd(ax + (bx - ax) * (k / n), az + (bz - az) * (k / n), 'path', 2.4);
        }
      }
      // 3) plaza rings
      const pz = L.plaza || { x: 0, z: 0, r: 13 };
      for (const r of [4.5, 8.5, 11.5]) for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; tryAdd(pz.x + Math.cos(a) * r, pz.z + Math.sin(a) * r, 'path', 2.4); }
      await breathe();
      // 4) coarse walkability grid (open lawns)
      const b = NAV.bounds;
      for (let x = b.minX + 4; x <= b.maxX - 4; x += 7) {
        for (let z = b.minZ + 4; z <= b.maxZ - 4; z += 7) tryAdd(x + rand(-0.6, 0.6), z + rand(-0.6, 0.6), 'grid', 3.2);
        await breathe();
      }
      // 5) edges (line of sight, spatial hash)
      const R = 10.6;
      for (const n of nodes) {
        let checked = 0;
        for (const [d, m] of navNear(n.x, n.z, R)) {
          if (m.i === n.i || d < 0.3) continue;
          if (++checked > 16) break;
          if (m.i < n.i) continue; // pair handled from the other side
          const y = segClear(n.x, n.z, n.y, m.x, m.z);
          if (y == null || Math.abs(y - m.y) > 0.6) continue;
          const mult = n.path && m.path ? 0.82 : n.kind === 'grid' || m.kind === 'grid' ? 1.25 : 1;
          const c = d * mult;
          n.adj.push([m.i, c]); m.adj.push([n.i, c]);
        }
        await breathe();
      }
      // 6) keep the largest connected component
      const comp = new Int32Array(nodes.length).fill(-1);
      let best = -1, bestSize = 0, cid = 0;
      for (const n of nodes) {
        if (comp[n.i] >= 0) continue;
        let size = 0; const stack = [n.i]; comp[n.i] = cid;
        while (stack.length) { const i = stack.pop(); size++; for (const [j] of nodes[i].adj) if (comp[j] < 0) { comp[j] = cid; stack.push(j); } }
        if (size > bestSize) { bestSize = size; best = cid; }
        cid++;
      }
      for (const n of nodes) n.main = comp[n.i] === best;
      this.spots = this.spots.filter((s) => s.node && s.node.main);
      NAV.ready = nodes.length > 10 && this.spots.length > 4;
      G.log.info('SOCIAL', `nav graph: ${nodes.length} nodes, ${bestSize} reachable, ${this.spots.length} spots (${Math.round(performance.now() - t0)} ms)`);
    },

    /** visitor destinations from the layout: benches, photo zones, signs, plots, jangdokdae, pavilion, ... */
    _buildSpots() {
      const L = G.data.layout || {};
      const out = [];
      const fwd = (rot) => [Math.sin(rot || 0), Math.cos(rot || 0)];
      const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
      // keep visitors out of the NPCs' personal space (name tags would overlap)
      const npcs = Object.values(G.data.npcs || {}).filter((n) => Array.isArray(n.pos)).map((n) => ({ x: n.pos[0], z: n.pos[1], r: 3.2 + (Number(n.wander) || 0) * 0.5 }));
      const add = (s) => {
        for (const n of npcs) {
          const dx = s.x - n.x, dz = s.z - n.z, d = Math.hypot(dx, dz);
          if (d < n.r) {
            if (s.kind !== 'hang' && s.kind !== 'jang') return;
            if (d > 0.01) { s.x = n.x + (dx / d) * n.r; s.z = n.z + (dz / d) * n.r; } else { s.x = n.x + n.r; }
          }
        }
        const free = this._freeNear(s.x, s.z, s.search ?? 2.5);
        if (!free) return;
        s.x = free.x; s.z = free.z;
        s.id = s.id || `${s.kind}_${out.length}`;
        s.cap = s.cap || 1;
        s.users = new Set();
        s.zoneId = G.world.zoneAt(s.x, s.z)?.id || null;
        s.stay = s.stay || [10, 24];
        s.w = s.w ?? 1;
        out.push(s);
      };
      (L.benches || []).forEach((b, i) => {
        const [fx, fz] = fwd(b.rot);
        const obj = G.world.getObject?.('BENCH_' + i);
        const seatY = Number(obj?.userData?.seatY);
        add({ id: 'BENCH_' + i, kind: 'bench', x: b.x + fx * 0.95, z: b.z + fz * 0.95, face: b.rot || 0, seat: { x: b.x + fx * 0.06, z: b.z + fz * 0.06, y: Number.isFinite(seatY) ? seatY : 0.44 }, stay: [16, 40], w: 1.3, search: 0.8, shelter: false });
      });
      for (const p of L.photoZones || []) {
        const look = p.look || [p.x, 0, p.z - 5];
        add({ id: p.id, kind: 'photo', x: p.x, z: p.z, face: yawTo(p.x, p.z, look[0], look[2]), anims: ['photo', 'photo', 'wave', 'point'], cap: 2, w: 0.9 });
      }
      for (const s of L.signs || []) {
        const [fx, fz] = fwd(s.rot);
        add({ id: s.id, kind: 'sign', x: s.x + fx * 2.1, z: s.z + fz * 2.1, face: (s.rot || 0) + Math.PI, anims: ['think', 'point', 'nod'], cap: 2, w: 0.55, stay: [6, 14] });
      }
      for (const k of L.kiosks || []) {
        const [fx, fz] = fwd(k.rot);
        add({ id: k.id, kind: 'kiosk', x: k.x + fx * 1.35, z: k.z + fz * 1.35, face: (k.rot || 0) + Math.PI, anims: ['interact', 'think', 'nod'], w: 0.6, stay: [8, 16] });
      }
      for (const e of L.exhibits || []) {
        const [fx, fz] = fwd(e.rot);
        add({ id: e.id, kind: 'exhibit', x: e.x + fx * 1.7, z: e.z + fz * 1.7, face: (e.rot || 0) + Math.PI, anims: ['think', 'point', 'interact'], w: 0.7, stay: [7, 15] });
      }
      if (L.craftTable) { const c = L.craftTable, [fx, fz] = fwd(c.rot); add({ id: c.id, kind: 'craft', x: c.x + fx * 1.5, z: c.z + fz * 1.5, face: (c.rot || 0) + Math.PI, anims: ['interact', 'think'], w: 0.4 }); }
      for (const d of L.jarDisplays || []) add({ id: d.id, kind: 'jardisp', x: d.x, z: d.z + 1.7, face: Math.PI, anims: ['think', 'point'], w: 0.45, stay: [6, 12] });
      for (const p of L.farmPlots || []) {
        add({ id: 'PLOT_' + p.id, kind: 'plot', x: p.x + rand(-1.2, 1.2), z: p.z + (p.d || 6) / 2 + 1.25, face: Math.PI, anims: ['water', 'point', 'think', 'harvest'], w: 0.85, stay: [8, 18], search: 1.2 });
      }
      const J = L.jangdokdae;
      if (J) {
        const wx = J.frontWalkX ? (J.frontWalkX[0] + J.frontWalkX[1]) / 2 - 0.6 : 22.6;
        for (const z of [-12, -8, 7, 12]) add({ id: `JANG_${z}`, kind: 'jang', x: wx, z, face: Math.PI / 2, anims: ['think', 'point', 'photo', 'nod'], w: 0.7, stay: [8, 18], search: 1.2 });
        const rg = J.rings;
        if (rg) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; const r = 8.6; add({ id: `RING_${i}`, kind: 'ring', x: rg.cx + Math.cos(a) * r, z: rg.cz + Math.sin(a) * r, face: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2, anims: ['think', 'photo', 'point'], w: 0.5, stay: [8, 16], search: 1 }); }
      }
      const pav = (L.buildings || []).find((b) => b.type === 'pavilion');
      if (pav) for (const [dx, dz] of [[0, 0.6], [-1.4, -0.6], [1.4, -0.6]]) add({ kind: 'pavilion', x: pav.x + dx, z: pav.z + dz, face: 0, anims: ['think', 'nod', 'photo', 'wave'], w: 0.6, stay: [14, 30], shelter: true, search: 1.2 });
      if (L.riverDeck) add({ id: 'DECK', kind: 'deck', x: L.riverDeck.x, z: L.riverDeck.z, face: Math.PI / 2, anims: ['photo', 'point', 'think'], cap: 2, w: 0.7 });
      // social hangouts in each zone
      const hang = [[-8.5, -1.5], [5, -4], [-7, 3.5], [6.5, 3], [0, -9.5], [-4, -69], [5, -70], [-44, -59], [-44, -30], [-35, 4.5], [-36, -2], [44, 47], [58, 46], [-4, 64], [5, 64], [-58, 22], [30, 28], [36, -18]];
      for (const [x, z] of hang) add({ kind: 'hang', x, z, face: null, anims: ['nod', 'wave', 'think', 'clap'], cap: 2, w: 1.25, stay: [10, 22], social: true });
      // shelters (rain) under eaves
      const hall = (L.buildings || []).find((b) => b.type === 'hall');
      if (hall) add({ id: 'SHELTER_HALL', kind: 'shelter', x: hall.x - 6, z: hall.z + hall.d / 2 + 3.2, face: 0, anims: ['think', 'nod'], cap: 3, w: 0.25, shelter: true, stay: [20, 40] });
      const sto = (L.buildings || []).find((b) => b.type === 'storage');
      if (sto) add({ id: 'SHELTER_STORAGE', kind: 'shelter', x: sto.x + 3, z: sto.z + sto.d / 2 + 2.2, face: 0, anims: ['think', 'nod'], cap: 2, w: 0.25, shelter: true, stay: [20, 40] });
      // exits (leaving visitors walk here)
      add({ id: 'EXIT_GATE', kind: 'exit', x: 0, z: 67, face: 0, w: 0, cap: 99, search: 3 });
      return out;
    },
    _freeNear(x, z, R) {
      const W = G.world;
      const ok = (px, pz) => { const y = W.surfaceHeight(px, pz); return Number.isFinite(y) && walkY(px, pz, y, 0.45) != null; };
      if (ok(x, z)) return { x, z };
      for (let r = 0.4; r <= R; r += 0.4) {
        const n = Math.max(8, Math.round(r * 7));
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
      }
      return null;
    },

    // ---------------------------------------------------------------- spawning
    _spawnVisitors() {
      this._despawnVisitors();
      if (!this._pool.length || !this._target) { this._updateOnline(); return; }
      const spots = this.spots;
      const pl = G.sys.player?.position || { x: 0, z: 9 };
      const usable = spots.filter((s) => s.kind !== 'exit');
      const near = usable.filter((s) => Math.hypot(s.x - pl.x, s.z - pl.z) < 26 && s.kind !== 'bench' && Math.hypot(s.x - pl.x, s.z - pl.z) > 4);
      for (let i = 0; i < this._target && i < this._pool.length; i++) {
        const v = this._pool[i];
        let spot = null;
        if (i < 3 && near.length) spot = this._chooseSpot(v, near);
        if (!spot) spot = this._chooseSpot(v, usable);
        this._activate(v, spot, { stagger: true });
      }
      this._lineT = rand(9, 16);
      this._cycleT = rand(160, 300);
      this._joinT = -1;
      this._updateOnline();
    },
    _activate(v, spot, opts = {}) {
      v.active = true; v.leaving = false;
      v.react = null; v.talk = null; v.path = null; v.slide = null; v.stuck = 0; v.wait = 0;
      v.rig.stopAll?.(); v.rig.setHeld?.(null); v.rig.setLookTarget?.(null);
      v.bub.t = 0; v.bub.bubble.hidden = true;
      let x, z, y;
      if (opts.at) { x = opts.at.x; z = opts.at.z; } else if (spot) { this._occupy(v, spot); x = v.goal.x; z = v.goal.z; } else { const n = pick(NAV.nodes.filter((q) => q.main)) || { x: 0, z: 0 }; x = n.x; z = n.z; }
      y = G.world.surfaceHeight(x, z);
      v.position.set(x, Number.isFinite(y) ? y : 0, z);
      v.rotY = spot?.face ?? rand(-Math.PI, Math.PI);
      v.group.rotation.y = v.rotY;
      v.group.visible = true; v.hidden = false;
      v.label.setVisible(true);
      v.el.root.classList.toggle('blocked', this._isBlocked(v.name));
      this.others.set(v.id, v);
      this._activeDirty = true;
      v.zoneId = G.world.zoneAt(x, z)?.id || null;
      if (!spot || opts.at) this._release(v);
      if (spot && !opts.at) {
        this._arrive(v, { silent: true });
        if (opts.stagger) v.t = rand(2, 14);
      } else { v.state = 'idle'; v.t = opts.stagger ? rand(0.5, 3) : 0.2; }
    },
    _deactivate(v) {
      this._release(v);
      v.active = false; v.leaving = false;
      v.group.visible = false; v.hidden = true;
      v.label.setVisible(false);
      v.bub.t = 0; v.bub.bubble.hidden = true;
      v.rig.stopAll?.(); v.rig.setHeld?.(null);
      v.talk = null; v.react = null;
      this.others.delete(v.id);
      this._activeDirty = true;
    },
    _despawnVisitors() {
      for (const v of this._pool) if (v.active) this._deactivate(v);
      for (const s of this.spots) { s.users?.clear(); s.slotOf?.clear(); }
      this._activeDirty = true;
    },

    _occupy(v, spot) {
      this._release(v);
      v.spot = spot;
      spot.users.add(v.id);
      if (!spot.slotOf) spot.slotOf = new Map();
      const taken = new Set(spot.slotOf.values());
      let slot = 0;
      while (taken.has(slot)) slot++;
      spot.slotOf.set(v.id, slot);
      v.slot = slot;
      v.goal = this._spotPos(spot, slot);
    },
    _release(v) { if (v.spot) { v.spot.users.delete(v.id); v.spot.slotOf?.delete(v.id); } v.spot = null; },
    /** stand point for the n-th visitor at a spot (side by side, never on the same point) */
    _spotPos(spot, slot) {
      if (!slot || spot.kind === 'bench' || spot.kind === 'exit') return { x: spot.x, z: spot.z };
      spot.slotPos = spot.slotPos || [];
      if (spot.slotPos[slot]) return spot.slotPos[slot];
      const base = (spot.face ?? (U.hashInt(spot.id) % 628) / 100) + Math.PI / 2;
      const side = slot % 2 ? 1 : -1, r = 1.25 * Math.ceil(slot / 2);
      let pos = { x: spot.x, z: spot.z };
      for (const k of [1, 0.75, 0.5]) {
        const x = spot.x + Math.sin(base) * side * r * k, z = spot.z + Math.cos(base) * side * r * k;
        const y = G.world.surfaceHeight(x, z);
        if (Number.isFinite(y) && walkY(x, z, y, 0.4) != null && segClear(spot.x, spot.z, G.world.surfaceHeight(spot.x, spot.z), x, z) != null) { pos = { x, z }; break; }
      }
      spot.slotPos[slot] = pos;
      return pos;
    },

    _chooseSpot(v, list) {
      const W = G.sys.weather;
      const raining = (W?.precipitation?.rain ?? (W?.current === 'RAIN' ? 1 : 0)) > 0.4;
      const night = (W?.nightFactor ?? 0) > 0.6;
      const pp = G.sys.player?.sitting?.bench?.id || null;
      const p = v.position;
      let tot = 0;
      const cand = [];
      for (const s of list || this.spots) {
        if (s.kind === 'exit' || s === v.spot || s === v.prevSpot) continue;
        if (s.users.size >= s.cap) continue;
        if (s.kind === 'bench' && pp === s.id) continue;
        let w = s.w;
        const d = v.active ? Math.hypot(s.x - p.x, s.z - p.z) : 30;
        w *= d < 8 ? 0.3 : d > 80 ? 0.35 : 1;
        if (raining) w *= s.shelter ? 8 : s.kind === 'bench' || s.kind === 'plot' ? 0.2 : 0.5;
        if (night && (s.kind === 'hang' || s.kind === 'pavilion' || s.kind === 'bench')) w *= 1.6;
        if (w <= 0) continue;
        tot += w; cand.push([s, w]);
      }
      if (!cand.length) return null;
      let x = Math.random() * tot;
      for (const [s, w] of cand) { x -= w; if (x <= 0) return s; }
      return cand[cand.length - 1][0];
    },

    _plan(v, spot) {
      if (!NAV.ready || !spot?.node) return false;
      const p = v.slide ? { x: v.slide.x, z: v.slide.z, y: v.position.y } : v.position;
      const start = nearestNode(p.x, p.z, p.y);
      if (!start) return false;
      const nodes = astar(start, spot.node);
      if (!nodes) return false;
      const pts = nodes.map((n) => ({ x: n.x + rand(-0.25, 0.25), z: n.z + rand(-0.25, 0.25) }));
      const goal = v.goal || spot;
      pts.push({ x: goal.x, z: goal.z, last: true });
      v.path = pts; v.pi = 0;
      this._pull(v);
      return true;
    },
    /** line-of-sight smoothing: skip waypoints that can be reached directly */
    _pull(v) {
      const p = v.position, path = v.path;
      if (!path || v.slide) return;
      let best = v.pi;
      for (let k = v.pi + 1; k < Math.min(path.length, v.pi + 4); k++) {
        if (segClear(p.x, p.z, p.y, path[k].x, path[k].z) != null) best = k; else break;
      }
      v.pi = best;
    },

    _startWalk(v, spot) {
      if (!spot) return false;
      if (v.rig.sitting || v.slide) this._standUp(v);
      v.rig.stopAction?.();
      v.rig.setLookTarget?.(null);
      const prev = v.spot;
      this._occupy(v, spot);
      this.stats.plans++;
      if (!this._plan(v, spot)) { this.stats.planFails++; this._release(v); if (prev) this._occupy(v, prev); return false; }
      v.prevSpot = prev;
      v.state = 'walk';
      v.stuck = 0; v.wait = 0;
      const d = Math.hypot(spot.x - v.position.x, spot.z - v.position.z);
      v.run = d > 45 && Math.random() < 0.18;
      return true;
    },

    _arrive(v, opts = {}) {
      const s = v.spot;
      if (!opts.silent) this.stats.arrivals++;
      v.path = null;
      v.state = 'idle';
      v.t = s ? rand(s.stay[0], s.stay[1]) : rand(4, 9);
      v.act = rand(1.2, 4);
      if (!s) return;
      if (s.kind === 'exit' && v.leaving) { this._leaveDone(v); return; }
      if (s.kind === 'bench' && s.seat) {
        v.state = 'sit';
        v.slide = { fx: v.position.x, fz: v.position.z, x: s.seat.x, z: s.seat.z, t: 0, dur: opts.silent ? 0.001 : 0.45 };
        v.rotY = opts.silent ? s.face : v.rotY;
        v.faceYaw = s.face;
        v.rig.setAnim('sit', { loop: true, seatY: s.seat.y });
        return;
      }
      if (s.kind === 'gather') { // celebrating next to the player
        this._visitorFace(v);
        this._visitorAnim(v, pick(s.anims));
        this._visitorEmote(v, pick(['👏', '🎉', '✨', '🙌', '😆']));
        return;
      }
      v.faceYaw = s.face ?? null;
      if (!opts.silent && s.anims && Math.random() < 0.65) this._visitorAnim(v, pick(s.anims));
      if (s.social && !opts.silent) this._tryTalk(v);
    },
    _standUp(v) {
      if (v.spot?.kind === 'bench') {
        const s = v.spot;
        v.slide = { fx: v.position.x, fz: v.position.z, x: s.x, z: s.z, t: 0, dur: 0.35 };
      }
      v.rig.stopAll?.();
    },

    _visitorAnim(v, anim, opts = {}) {
      if (!anim || !G.avatar?.actions?.[anim]) return false;
      try { v.rig.setAnim(anim, { duration: opts.duration ?? G.avatar.actions[anim].duration ?? 2, loop: !!opts.loop }); return true; } catch (e) { return false; }
    },
    _visitorFace(v, x, z) {
      const pp = x == null ? G.sys.player?.position : { x, z };
      if (!pp) return;
      v.faceYaw = Math.atan2(pp.x - v.position.x, pp.z - v.position.z);
      if (x == null) v.rig.setLookTarget?.(G.sys.player?.rig?.headAnchor || null);
    },
    /** stop and react for a while (keeps the current plan) */
    _react(v, seconds, fn) {
      if (!v.active || v.leaving) return;
      if (v.state === 'sit') { v.react = { t: seconds }; this._visitorFace(v); fn?.(); return; }
      v.react = { t: seconds };
      v.params.speed = 0;
      this._visitorFace(v);
      fn?.();
    },

    /** a visitor speaks: "…" typing dots above the head (+ "OO님이 입력 중" in the chat panel), then the line */
    _visitorSay(v, text, opts = {}) {
      if (!v?.active || !text) return;
      const line = String(text).replace(/\{nickname\}/g, G.state?.profile?.nickname || '체험객');
      if (opts.typing === false || this._isBlocked(v.name)) { this._visitorSayNow(v, line, opts); return; }
      const name = v.name;
      const pp = G.sys.player?.position;
      const d = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : Infinity;
      const inChat = (opts.channel || 'all') !== 'local' || d <= LOCAL_R;
      const secs = clamp(0.7 + cpLen(line) * 0.045, 0.9, 2.6);
      if (d < LABEL_DIST) this._bubble(v.bub, '', { typing: true, dur: secs + 0.4 });
      if (inChat) this._typingStart(name);
      this._later(secs * 1000, () => {
        if (inChat) this._typingEnd(name);
        if (v.active && v.name === name && G.state) this._visitorSayNow(v, line, opts);
      });
    },
    _visitorSayNow(v, line, opts = {}) {
      if (!v?.active) return;
      const pp = G.sys.player?.position;
      const d = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : Infinity;
      const channel = opts.channel || 'all';
      if (channel === 'local' && d > LOCAL_R) { if (!this._isBlocked(v.name)) this._bubble(v.bub, line); return; }
      const msg = this._push({ name: v.name, text: this.filter(line), channel, kind: 'visitor', near: d <= LOCAL_R, uid: v.id });
      if (!this._isBlocked(v.name)) {
        this._bubble(v.bub, msg?.text || line);
        if (d < 45) G.sfx('chat', { at: v.position, volume: 0.6 });
      }
      if (opts.anim && v.state !== 'walk') this._visitorAnim(v, opts.anim);
    },
    _typingStart(name) { this._typingNames.set(name, (this._typingNames.get(name) || 0) + 1); this._renderTyping(); },
    _typingEnd(name) {
      const n = (this._typingNames.get(name) || 0) - 1;
      if (n > 0) this._typingNames.set(name, n); else this._typingNames.delete(name);
      this._renderTyping();
    },
    _renderTyping() {
      const C = this._chat;
      if (!C?.typing) return;
      const names = [...this._typingNames.keys()].filter((n) => !this._isBlocked(n));
      if (!names.length) { C.typing.hidden = true; return; }
      const txt = names.length === 1 ? `${J.nim(names[0])}이 입력 중…` : names.length === 2 ? `${J.nim(names[0])}, ${J.nim(names[1])}이 입력 중…` : `${J.nim(names[0])} 외 ${names.length - 1}명이 입력 중…`;
      C.typing.querySelector('.ct-txt').textContent = txt;
      C.typing.hidden = false;
    },

    /** a couple of nearby visitors welcome the player after logging in */
    _welcomePlayer() {
      if (this._mode !== 'local' || !G.state) return;
      const nick = G.state.profile?.nickname || '체험객';
      const pp = G.sys.player?.position;
      const vis = this._activeVisitors().filter((v) => !v.leaving && !this._isBlocked(v.name));
      if (!vis.length) return;
      const byDist = pp ? vis.slice().sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z)) : vis;
      const first = byDist[0];
      const kid = kidOn();
      const lines = kid
        ? [`${nick}, 어서 와요! 😊`, `${nick}, 반가워요! 같이 놀아요 👋`, `안녕, ${nick}! 장독대 가 봤어요? 🏺`]
        : [`@${nick} 님, 어서 오세요! 😊`, `${J.nim(nick)} 반가워요! 같이 둘러봐요 👋`, `@${nick} 님 환영해요~ 장독대 꼭 가 보세요!`];
      const near = pp && Math.hypot(first.position.x - pp.x, first.position.z - pp.z) < 25;
      if (near) this._react(first, 3, () => this._visitorEmote(first, '👋', 'wave'));
      this._visitorSay(first, pick(lines));
      const second = byDist[1];
      if (second && Math.random() < 0.6) this._later(rand(2600, 4200), () => { if (second.active && G.state) this._visitorSay(second, pick(kid ? ['반가워요~ 👋', '어서 와요! 😄', '같이 놀아요 🙌'] : ['반가워요~ 👋', '어서 오세요!', '환영합니다 🙌'])); });
    },

    /** celebrations: up to three nearby visitors walk over, face the player and clap / cheer */
    _gather(kind) {
      if (this._mode !== 'local' || !G.state || !NAV.ready) return;
      const now = performance.now();
      if (now - this._gatherAt < 40000) return;
      const pp = G.sys.player?.position;
      if (!pp || G.sys.photo?.active) return;
      const cand = this._activeVisitors()
        .filter((v) => !v.leaving && !v.talk && !this._isBlocked(v.name) && v.state !== 'sit' && !v.slide)
        .map((v) => [v, Math.hypot(v.position.x - pp.x, v.position.z - pp.z)])
        .filter(([, d]) => d > 2.4 && d < 38)
        .sort((a, b) => a[1] - b[1]).slice(0, 3);
      if (!cand.length) return;
      this._gatherAt = now;
      const LINES = kidOn() ? {
        level: ['우와, 축하해요! 🎉', '쑥쑥 컸어요! 👏', '최고예요! 🌟'],
        quest: ['참 잘했어요! 👏', '대단해요! 🌟', '우와, 해냈어요! 🎉'],
        ferment: ['장 담그기 성공! 🏺', '맛있겠다~ 😋', '우와, 축하해요! 🎉'],
      } : {
        level: ['레벨 업 축하해요! 🎉', '와, 레벨 업! 👏', '축하드려요~ 🙌'],
        quest: ['퀘스트 완료 축하해요! 👏', '대단해요! 🎉', '오, 벌써 끝냈어요? 👍'],
        ferment: ['와, 장 담그기 성공! 🏺', '맛있겠다~ 😋', '발효 완성 축하해요! 🎉'],
      };
      cand.forEach(([v, d], i) => {
        const base = Math.atan2(v.position.x - pp.x, v.position.z - pp.z) + (i - (cand.length - 1) / 2) * 0.55;
        const r = 2.4 + (i % 2) * 0.45;
        const free = this._freeNear(pp.x + Math.sin(base) * r, pp.z + Math.cos(base) * r, 1.6);
        if (!free) return;
        const y = G.world.surfaceHeight(free.x, free.z);
        const spot = {
          id: `GATHER_${v.id}`, kind: 'gather', x: free.x, z: free.z, face: Math.atan2(pp.x - free.x, pp.z - free.z),
          anims: ['clap', 'celebrate', 'thumbsup'], cap: 1, users: new Set(), stay: [6, 10], w: 0,
          node: nearestNode(free.x, free.z, Number.isFinite(y) ? y : 0),
        };
        if (!spot.node) return;
        this._later(i * 450, () => {
          if (!v.active || v.leaving || !G.state) return;
          v.react = null;
          if (this._startWalk(v, spot)) {
            v.run = d > 14;
            if (i === 0) this._later(rand(1500, 2600), () => { if (v.active && G.state) this._visitorSay(v, pick(LINES[kind] || LINES.level)); });
          }
        });
      });
    },
    _visitorEmote(v, emo, anim) {
      if (!v?.active) return;
      if (!this._isBlocked(v.name)) this._bubble(v.bub, emo, { emote: true });
      if (anim) this._visitorAnim(v, anim);
    },

    _replyLine(kind) {
      let list;
      if (kidOn()) list = KID_TALK[kind] || KID_TALK.agree; // 쉬운 모드: short, warm kid lines
      else {
        const R = G.data.visitors?.replies || {};
        list = Array.isArray(R[kind]) && R[kind].length ? R[kind] : FALLBACK[kind] || FALLBACK.agree;
      }
      // two visitors answering together never say the very same line
      const recent = this._recentReplies || (this._recentReplies = []);
      const fresh = list.filter((l) => !recent.includes(l));
      const line = pick(fresh.length ? fresh : list);
      recent.push(line);
      if (recent.length > 3) recent.shift();
      return line;
    },
    /** a line from G.data.visitors.lines (쉬운 모드: kid lines), weighted by where the visitor is */
    _pickLine(v) {
      const lines = kidOn() ? KID_TALK.lines : G.data.visitors?.lines?.length ? G.data.visitors.lines : FALLBACK.chat;
      const z = v.zoneId || '';
      const HINT = [
        [/장독|발효 언제/, ['ZONE_JANGDOKDAE']], [/콩|물 주|수확/, ['ZONE_CROP', 'ZONE_HERB']], [/정자|사진/, ['ZONE_REST']],
        [/허브/, ['ZONE_HERB']], [/교육관|퀴즈/, ['ZONE_EDUCATION', 'ZONE_HALL']], [/메주|된장/, ['ZONE_FERMENTATION', 'ZONE_JANGDOKDAE']],
        [/계곡/, ['ZONE_REST']], [/처음 왔/, ['ZONE_ENTRANCE', 'ZONE_MAIN']],
      ];
      let tot = 0;
      const cand = lines.map((l) => {
        let w = this._recentLines.includes(l) ? 0 : 1;
        for (const [re, zones] of HINT) if (re.test(l)) w *= zones.includes(z) ? 5 : 0.45;
        tot += w;
        return [l, w];
      });
      let x = Math.random() * tot, out = lines[0];
      for (const [l, w] of cand) { x -= w; if (x <= 0) { out = l; break; } }
      this._recentLines.push(out);
      if (this._recentLines.length > Math.min(8, lines.length - 2)) this._recentLines.shift();
      return out;
    },

    /** active visitors (cached array, rebuilt only when someone arrives or leaves — no per-frame allocation) */
    _activeVisitors() {
      if (this._activeDirty || !this._active) {
        this._active = [];
        for (const o of this.others.values()) if (o.kind === 'visitor' && o.active) this._active.push(o);
        this._activeDirty = false;
      }
      return this._active;
    },
    _nearestVisitor(maxD, idleOnly) {
      const pp = G.sys.player?.position;
      if (!pp) return null;
      let best = null, bd = maxD;
      for (const v of this._activeVisitors()) {
        if (v.leaving || (idleOnly && v.talk)) continue;
        const d = Math.hypot(v.position.x - pp.x, v.position.z - pp.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },

    // ---------------------------------------------------------------- reactions to the player
    _visitorsHear(text, channel, reply) {
      const vis = this._activeVisitors();
      if (!vis.length) return;
      const now = performance.now();
      const t = text.toLowerCase();
      let kind = null;
      if (reply === 'emoji') { this._visitorsEchoEmoji(text); return; }
      if (reply && KID_TALK[reply]) kind = reply;
      else if (/안녕|반가|하이|ㅎㅇ|hello|\bhi\b|헬로|어서\s?오|반갑/.test(t)) kind = 'greet';
      else if (/고마|감사|땡큐|thank|ㄱㅅ|고맙/.test(t)) kind = 'thanks';
      else if (/[?？]|어디|어떻게|뭐|언제|왜|몇|누구|있나요|인가요|할까요/.test(t)) kind = 'question';
      if (kind && !kidOn() && !G.data.visitors?.replies?.[kind] && !FALLBACK[kind]) kind = 'greet';
      const named = vis.find((v) => text.includes(v.name));
      if (!kind && !named) return;
      if (now - this._replyT < 3500 && !named) return;
      this._replyT = now;
      const pp = G.sys.player?.position;
      const near = vis.filter((v) => !v.leaving && pp && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) <= (channel === 'local' ? LOCAL_R : 60))
        .sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z));
      let responders = named ? [named] : near.slice(0, kind === 'greet' ? (Math.random() < 0.5 ? 2 : 1) : 1);
      if (!responders.length && channel !== 'local') responders = [pick(vis)];
      responders.forEach((v, i) => {
        this._later((rand(1, 3) + i * 1.2) * 1000, () => {
          if (!v.active || !G.state) return;
          const k = kind || 'mention';
          const pd = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : 99;
          this.stats.replies++;
          const ANIM = { greet: 'wave', thanks: 'nod', question: 'think', feel: 'nod', praise: 'thumbsup', play: 'celebrate', mention: 'wave' };
          if (pd < 25) this._react(v, 3.2, () => this._visitorAnim(v, ANIM[k] || 'wave'));
          const nick = G.state.profile?.nickname;
          const direct = nick && (named || Math.random() < (kidOn() ? 0.6 : 0.35));
          // children cannot read "@name": in 쉬운 모드 the visitor simply calls them by name
          this._visitorSay(v, (direct ? (kidOn() ? `${nick}, ` : `@${nick} `) : '') + this._replyLine(k), { channel });
        });
      });
    },

    /** an emoji-only kid message: one or two nearby visitors answer with an emoji of their own */
    _visitorsEchoEmoji(text) {
      const pp = G.sys.player?.position;
      if (!pp) return;
      const now = performance.now();
      if (now - this._replyT < 2500) return;
      this._replyT = now;
      const vis = this._activeVisitors().filter((v) => !v.leaving && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) < 22)
        .sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z)).slice(0, 2);
      const ANSWER = { '😊': ['😊', '🥰'], '😆': ['😆', '🤣'], '🥰': ['🥰', '💕'], '👍': ['👍', '😎'], '👏': ['👏', '🎉'], '👋': ['👋', '😊'], '🎉': ['🎉', '🥳'], '❤️': ['💕', '🥰'] };
      const first = Array.from(String(text).trim())[0] || '😊';
      const key = Object.keys(ANSWER).find((k) => String(text).includes(k)) || first;
      vis.forEach((v, i) => {
        this._later((rand(0.7, 1.6) + i * 0.8) * 1000, () => {
          if (!v.active || !G.state) return;
          const emo = pick(ANSWER[key] || ['😊', '👋']);
          this._react(v, 2.6, () => this._visitorEmote(v, emo, key === '👋' ? 'wave' : key === '👏' ? 'clap' : key === '👍' ? 'thumbsup' : 'nod'));
          if (i === 0 && Math.random() < 0.5) this._later(700, () => { if (v.active && G.state) this._visitorSay(v, emo, { channel: 'local', typing: false }); });
        });
      });
    },

    _visitorsSeeEmote(e) {
      const pp = G.sys.player?.position;
      if (!pp) return;
      const vis = this._activeVisitors().filter((v) => !v.leaving && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) < 13)
        .sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z)).slice(0, 2);
      const friendly = e.id === 'EMO_HELLO' || e.id === 'EMO_WELCOME';
      vis.forEach((v, i) => {
        if (Math.random() > (friendly ? 0.85 : 0.5)) return;
        this._later((rand(0.6, 1.6) + i * 0.7) * 1000, () => {
          if (!v.active) return;
          const map = {
            EMO_HELLO: ['👋', 'wave'], EMO_WELCOME: ['🙌', 'celebrate'], EMO_CLAP: ['👏', 'clap'], EMO_THUMBS: ['👍', 'thumbsup'],
            EMO_LIKE: [pick(['❤️', '💕', '🥰', '💖']), 'heart'], EMO_WOW: [pick(['😮', '😆']), 'surprise'], EMO_SMILE: ['😊', 'nod'], EMO_LAUGH: ['😆', 'nod'],
          };
          const [emo, anim] = map[e.id] || ['😊', 'nod'];
          this._react(v, 2.8, () => this._visitorEmote(v, emo, anim));
          if (e.id === 'EMO_HELLO' && Math.random() < 0.4) this._later(900, () => this._visitorSay(v, this._replyLine('greet'), { channel: 'local' }));
        });
      });
    },

    _visitorsSeeGesture(g) {
      const pp = G.sys.player?.position;
      if (!pp) return;
      const vis = this._activeVisitors().filter((v) => !v.leaving && v.state !== 'sit' && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) < 11);
      if (!vis.length) return;
      if (g.anim === 'dance') {
        vis.slice(0, 2).forEach((v, i) => {
          if (Math.random() < 0.6) this._later((1 + i * 0.8) * 1000, () => { if (!v.active) return; const secs = rand(5, 9); this._react(v, secs, () => { this._visitorAnim(v, 'dance', { duration: secs, loop: false }); this._visitorEmote(v, pick(['🎶', '💃', '😆'])); }); });
        });
      } else if (g.anim === 'bow' || g.anim === 'wave') {
        const v = vis[0];
        if (Math.random() < 0.7) this._later(rand(700, 1400), () => { if (v.active) this._react(v, 2.6, () => this._visitorAnim(v, g.anim)); });
      } else if (g.anim === 'celebrate') {
        const v = vis[0];
        if (Math.random() < 0.6) this._later(900, () => { if (v.active) this._react(v, 2.6, () => this._visitorEmote(v, '👏', 'clap')); });
      }
    },

    _tryTalk(v) {
      if (v.talk) return;
      const partner = this._activeVisitors().find((o) => o !== v && !o.talk && !o.leaving && o.state === 'idle' && !o.react && Math.hypot(o.position.x - v.position.x, o.position.z - v.position.z) < 3.8);
      if (!partner || Math.random() < 0.35) return;
      const secs = rand(7, 11);
      const pair = { a: v, b: partner, t: secs, step: 0, next: 0.6 };
      v.talk = pair; partner.talk = pair;
      v.t = Math.max(v.t, secs + 1); partner.t = Math.max(partner.t, secs + 1);
      v.faceYaw = Math.atan2(partner.position.x - v.position.x, partner.position.z - v.position.z);
      partner.faceYaw = Math.atan2(v.position.x - partner.position.x, v.position.z - partner.position.z);
      v.rig.setLookTarget?.(partner.rig.headAnchor); partner.rig.setLookTarget?.(v.rig.headAnchor);
    },
    _tickTalk(pair, dt) {
      pair.t -= dt; pair.next -= dt;
      const { a, b } = pair;
      if (!a.active || !b.active || pair.t <= 0 || a.state !== 'idle' || b.state !== 'idle') {
        for (const v of [a, b]) { if (v.talk === pair) { v.talk = null; v.rig.setLookTarget?.(null); if (v.rig.currentAction === 'talk') v.rig.stopAction(); } }
        return;
      }
      if (pair.next <= 0) {
        const speaker = pair.step % 2 === 0 ? a : b, listener = speaker === a ? b : a;
        pair.step++;
        pair.next = rand(2.2, 3.4);
        this._visitorAnim(speaker, 'talk', { duration: pair.next - 0.3 });
        if (Math.random() < 0.6) this._visitorAnim(listener, 'nod');
        if (pair.step <= 2 && Math.random() < 0.75) {
          const text = pair.step === 1 ? this._pickLine(speaker) : this._replyLine(/[?？]/.test(this._lastPairLine || '') ? 'question' : 'agree');
          this._lastPairLine = text;
          this._visitorSay(speaker, text, { channel: 'local' });
        }
      }
    },

    // ---------------------------------------------------------------- per-frame visitor update
    _updateVisitors(dt) {
      const list = this._activeVisitors();
      if (!list.length) return;
      const E = G.sys.engine, cam = E.camera, cp = cam.position;
      const pl = G.sys.player;
      const pp = pl?._ready && G.state && pl.object?.visible !== false ? pl.position : null;
      const talks = this._talkSet || (this._talkSet = new Set());
      talks.clear();
      for (const v of list) {
        const p = v.position;
        const cd = Math.hypot(p.x - cp.x, p.z - cp.z);
        v.camDist = cd;
        const hide = cd > HIDE_DIST;
        if (hide !== v.hidden) { v.hidden = hide; v.group.visible = !hide; v.label.setVisible(!hide); }
        // simulate at a reduced rate far away
        v.simAcc += dt;
        const simStep = hide ? SLEEP_STEP : cd > FAR_DIST ? 0.066 : 0; // asleep when hidden, coarse when far
        if (v.simAcc >= simStep) {
          const sdt = Math.min(0.3, v.simAcc);
          v.simAcc = 0;
          this._think(v, sdt, pp, list);
        }
        if (v.talk) talks.add(v.talk);
        // animation (skip off-screen / far)
        if (!hide) {
          let adt = dt;
          if (cd > 45) { v.animAcc += dt; if (v.animAcc < (cd > 85 ? 0.2 : 0.08)) adt = 0; else { adt = v.animAcc; v.animAcc = 0; } }
          if (adt > 0) {
            _tv.copy(p); _tv.y += 0.8; _tv.project(cam);
            const onScreen = _tv.z < 1 && Math.abs(_tv.x) < 1.25 && Math.abs(_tv.y) < 1.3;
            if (onScreen || (v.offAcc = (v.offAcc || 0) + adt) > 0.5) { v.rig.update(onScreen ? adt : v.offAcc || adt, v.params); v.offAcc = 0; }
          }
          v.group.rotation.y = v.rotY;
        }
        this._tickBubble(v.bub, dt);
      }
      for (const pair of talks) this._tickTalk(pair, dt);
    },

    _think(v, dt, pp, list) {
      const p = v.position;
      // slide (sitting down / standing up)
      if (v.slide) {
        const s = v.slide;
        s.t += dt;
        const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
        p.x = s.fx + (s.x - s.fx) * e; p.z = s.fz + (s.z - s.fz) * e;
        if (k >= 1) v.slide = null;
      }
      // zone (cheap: every ~1 s)
      v.zt = (v.zt || 0) - dt;
      if (v.zt <= 0) { v.zt = 1; v.zoneId = G.world.zoneAt(p.x, p.z)?.id || null; }
      // greet the player when they come close
      if (pp && v.state !== 'walk' && !v.react && !v.talk) {
        const pd = Math.hypot(pp.x - p.x, pp.z - p.z);
        const now = G.time.elapsed;
        if (pd < 3.4 && now - v.greetAt > 150) {
          v.greetAt = now;
          if (Math.random() < 0.4) this._react(v, 2.6, () => this._visitorEmote(v, pick(['👋', '😊']), 'wave'));
        }
      }
      let speed = 0;
      if (v.react) {
        v.react.t -= dt;
        if (v.faceYaw != null && v.state !== 'sit') v.rotY += angleDiff(v.rotY, v.faceYaw) * damp(6, dt);
        if (v.react.t <= 0) { v.react = null; v.rig.setLookTarget?.(null); v.faceYaw = v.spot && v.state !== 'walk' ? v.spot.face ?? null : null; }
      } else if (v.state === 'walk') {
        speed = this._walkStep(v, dt, pp, list);
      } else {
        // idle / sit at a spot
        v.t -= dt; v.act -= dt;
        if (v.faceYaw != null && !v.slide) v.rotY += angleDiff(v.rotY, v.faceYaw) * damp(v.state === 'sit' ? 12 : 3, dt);
        if (v.state === 'sit' && pp && G.sys.player?.sitting?.bench?.id === v.spot?.id) v.t = Math.min(v.t, 0.5); // make room for the player
        if (v.act <= 0 && !v.talk) {
          v.act = rand(7, 15);
          const r = Math.random();
          if (v.state === 'sit') { if (r < 0.35) this._visitorAnim(v, pick(['nod', 'wave', 'think', 'clap'])); else if (r < 0.5) this._visitorEmote(v, pick(['😊', '🌿', '☀️', '😌'])); }
          else if (r < 0.45 && v.spot?.anims) this._visitorAnim(v, pick(v.spot.anims));
          else if (r < 0.6) this._visitorEmote(v, pick(['😊', '👍', '😆', '✨', '🙌']), pick(['nod', 'thumbsup', 'clap', null]));
          else if (r < 0.8 && v.spot?.social) this._tryTalk(v);
          else v.faceYaw = (v.spot?.face ?? v.rotY) + rand(-0.9, 0.9);
        }
        if (v.t <= 0 && !v.talk) this._next(v);
      }
      v.params.speed = speed;
      v.speedNow = speed;
    },

    _next(v) {
      if (v.leaving) {
        const exit = this.spots.find((s) => s.kind === 'exit');
        if (!exit || !this._startWalk(v, exit)) this._leaveDone(v);
        return;
      }
      const spot = this._chooseSpot(v);
      if (!spot || !this._startWalk(v, spot)) { v.state = v.rig.sitting ? 'sit' : 'idle'; v.t = rand(3, 7); }
    },

    _walkStep(v, dt, pp, list) {
      const p = v.position, path = v.path;
      if (v.slide) return 0; // still standing up from a bench
      if (!path || v.pi >= path.length) { this._arrive(v); return 0; }
      const tgt = path[v.pi];
      let dx = tgt.x - p.x, dz = tgt.z - p.z;
      const d = Math.hypot(dx, dz);
      const last = v.pi === path.length - 1;
      if (d < (last ? 0.28 : 0.85)) {
        if (last) { this._arrive(v); return 0; }
        v.pi++;
        this._pull(v);
        return v.speedNow || 0;
      }
      dx /= d; dz /= d;
      // local avoidance: separation from other visitors and the player
      let sx = 0, sz = 0, blockedAhead = false;
      for (const o of list) {
        if (o === v) continue;
        const ox = p.x - o.position.x, oz = p.z - o.position.z, od = Math.hypot(ox, oz);
        if (od < 1.05 && od > 1e-4) { const k = (1.05 - od) / od; sx += ox * k; sz += oz * k; }
      }
      if (pp) {
        const ox = p.x - pp.x, oz = p.z - pp.z, od = Math.hypot(ox, oz);
        if (od < 1.4 && od > 1e-4) {
          const k = (1.4 - od) / od * 1.6; sx += ox * k; sz += oz * k;
          if (-(ox * dx + oz * dz) / od > 0.75 && od < 1.25) blockedAhead = true;
        }
      }
      if (blockedAhead) {
        v.wait += dt;
        if (v.wait < 1.1) { v.rotY += angleDiff(v.rotY, Math.atan2(dx, dz)) * damp(5, dt); return 0; }
      } else v.wait = Math.max(0, v.wait - dt);
      const want = Math.atan2(dx + sx * 0.9, dz + sz * 0.9);
      v.rotY += angleDiff(v.rotY, want) * damp(8, dt);
      const align = Math.cos(angleDiff(v.rotY, want));
      if (align < 0.3) return 0.3;
      // a running visitor keeps pace with the 3× world (G.sys.player.speedScale); strolls stay leisurely
      const base = v.run ? 3.4 * clamp(Number(G.sys.player?.speedScale) || 1, 1, 3) : v.speed;
      const sp = base * clamp(align, 0.45, 1) * (last && d < 1.4 ? Math.max(0.45, d / 1.4) : 1);
      const step = Math.min(sp * dt, d + 0.05);
      // move along the facing direction; deflect around unexpected obstacles (NPCs, props)
      for (const off of DEFLECT) {
        const a = v.rotY + off;
        const nx = p.x + Math.sin(a) * step, nz = p.z + Math.cos(a) * step;
        const y = walkY(nx, nz, p.y, 0.32);
        if (y == null) continue;
        p.x = nx; p.z = nz;
        p.y += (y - p.y) * damp(16, dt);
        if (off !== 0) v.rotY += angleDiff(v.rotY, a) * damp(4, dt);
        v.stuck = Math.max(0, v.stuck - dt);
        return sp;
      }
      v.stuck += dt;
      if (v.stuck > 1.6) { v.stuck = 0; v.state = 'idle'; v.t = rand(0.5, 1.5); v.path = null; this.stats.stuck++; }
      return 0;
    },

    // ---------------------------------------------------------------- arrivals & departures
    _leaveDone(v) {
      const name = v.name;
      this.stats.leaves++;
      this._deactivate(v);
      this.system(`🚪 ${J.nim(name)}이 체험관을 떠났어요.`);
      this._updateOnline();
      if (this._joinT < 0) this._joinT = rand(25, 70);
    },
    _join() {
      const free = this._pool.find((v) => !v.active);
      if (!free) return;
      const used = new Set(this._activeVisitors().map((v) => v.name));
      const names = (G.data.visitors?.names || []).filter((n) => !used.has(n));
      if (!names.length) return;
      this._assignName(free, pick(names));
      this.stats.joins++;
      const exit = this.spots.find((s) => s.kind === 'exit');
      this._activate(free, null, { at: exit ? { x: exit.x, z: exit.z + 1 } : { x: 0, z: 68 } });
      free.rotY = Math.PI;
      free.state = 'idle'; free.t = 0.6;
      this.system(`👋 ${J.nim(free.name)}이 입장했어요. 반갑게 인사해 보세요!`);
      this._updateOnline();
      this._later(rand(5000, 9000), () => {
        if (!free.active || !G.state) return;
        if (Math.random() < 0.7) this._visitorSay(free, pick(['안녕하세요!', '저 처음 왔어요!', '모두 반갑습니다~', '와, 공기가 정말 좋네요!']));
        // someone already here welcomes the newcomer
        const host = pick(this._activeVisitors().filter((o) => o !== free && !o.leaving && !o.talk));
        if (host && Math.random() < 0.65) this._later(rand(2500, 4500), () => { if (host.active && free.active && G.state) this._visitorSay(host, pick([`@${free.name} 님 어서 오세요! 😊`, `${J.nim(free.name)} 반가워요~ 👋`, `환영해요, ${J.nim(free.name)}!`])); });
      });
    },

    _updateVisitorScheduler(dt) {
      const vis = this._activeVisitors();
      // ambient chat lines (every 25–60 s overall)
      this._lineT -= dt;
      if (this._lineT <= 0 && vis.length) {
        this._lineT = rand(25, 60);
        const pp = G.sys.player?.position;
        let tot = 0;
        const cand = vis.filter((v) => !v.leaving && !this._isBlocked(v.name)).map((v) => {
          const d = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : 50;
          const w = d < LOCAL_R ? 3 : d < 60 ? 1.4 : 0.6;
          tot += w; return [v, w];
        });
        let x = Math.random() * tot, sp = null;
        for (const [v, w] of cand) { x -= w; if (x <= 0) { sp = v; break; } }
        if (sp) {
          const line = this._pickLine(sp);
          this.stats.lines++;
          this._visitorSay(sp, line, { anim: Math.random() < 0.4 ? pick(['wave', 'nod', 'clap']) : null });
          // sometimes someone answers
          if (Math.random() < 0.35) {
            const other = pick(vis.filter((o) => o !== sp && !o.leaving));
            const kind = /안녕|반가|처음/.test(line) ? 'greet' : /[?？]/.test(line) ? 'question' : 'agree';
            if (other) this._later(rand(2200, 4200), () => { if (other.active && G.state) this._visitorSay(other, this._replyLine(kind)); });
          }
        }
      }
      // occasional departures and arrivals keep the crowd alive
      this._cycleT -= dt;
      if (this._cycleT <= 0) {
        this._cycleT = rand(170, 320);
        const pp = G.sys.player?.position;
        if (vis.length > 8 && Math.random() < 0.65) {
          const cand = vis.filter((v) => !v.leaving && !v.talk && (!pp || Math.hypot(v.position.x - pp.x, v.position.z - pp.z) > 18));
          const v = cand.length ? pick(cand) : null;
          if (v) { v.leaving = true; if (v.state !== 'walk') v.t = Math.min(v.t, rand(1, 4)); else { const exit = this.spots.find((s) => s.kind === 'exit'); if (!exit || !this._startWalk(v, exit)) this._leaveDone(v); } }
        } else if (vis.length < this._target) this._joinT = rand(5, 20);
      }
      if (this._joinT >= 0) {
        this._joinT -= dt;
        if (this._joinT < 0 && this._activeVisitors().length < this._target) this._join();
      }
    },

    // ================================================================ server mode (presence + chat polling)
    _startServer() {
      const now = performance.now();
      // network timers run on the wall clock (game dt is capped and slows down on weak devices)
      this._srv = { nextPres: now + 300, nextChat: now + 150, presBusy: false, chatBusy: false, fails: 0, lastId: 0, first: true, presFirst: true, online: 0, appKey: '', appT: 0, pending: [], sentIds: new Set(), missing: new Map(), warned: false };
      G.log.info('NETWORK', 'social: server presence & chat polling started');
    },
    _stopServer() { this._srv = null; },
    /** poll interval in seconds: exponential back-off on failures (×2 per failure, ≤ 30 s) with ±15 % jitter */
    _backoff(base) { const f = this._srv?.fails || 0; return Math.min(30, base * Math.pow(2, Math.min(4, f))) * rand(0.85, 1.15); },
    _netFail(e) {
      const S = this._srv;
      if (!S) return;
      S.fails++;
      if (S.fails >= 3 && !S.warned) {
        S.warned = true;
        this.system('⚠️ 서버 연결이 불안정해요. 자동으로 다시 연결하는 중이에요.');
        G.ui.toast('서버 연결이 불안정해요. 잠시 후 자동으로 다시 시도합니다.', { type: 'warn' });
      }
      G.log.warn('NETWORK', 'social request failed', e?.code || e);
    },
    _netOk() {
      const S = this._srv;
      if (!S) return;
      if (S.warned) { S.warned = false; this.system('✅ 서버에 다시 연결되었어요.'); }
      S.fails = 0;
    },
    _updateServer(dt) {
      const S = this._srv;
      if (!S) return;
      const canWrite = !this._guestReadOnly();
      const now = performance.now();
      // every 2 s, every second while moving faster than a stroll (3× speed: up to 18 m between updates otherwise)
      const fast = (G.sys.player?.speed || 0) > (Number(G.sys.player?.WALK) || 9.6) * 0.5;
      if (canWrite && now >= S.nextPres && !S.presBusy) { S.nextPres = now + this._backoff(fast ? 1 : 2) * 1000; this._presence(); }
      if (now >= S.nextChat && !S.chatBusy) { S.nextChat = now + this._backoff(3) * 1000; this._pollChat(); }
      this._updateRemotes(dt);
    },
    async _presence() {
      const S = this._srv, pl = G.sys.player;
      if (!S || !pl?.position || !G.state) return;
      S.presBusy = true;
      try {
        const p = pl.position;
        const app = G.state.profile?.avatar || G.avatar?.defaultAppearance || null;
        const appKey = JSON.stringify(app || {});
        S.appT -= 1;
        const sendApp = appKey !== S.appKey || S.appT <= 0;
        const runAt = ((Number(pl.WALK) || 9.6) + (Number(pl.RUN) || 18)) / 2;   // between walk and run pace
        const anim = pl.rig?.currentAction || (pl.sitting ? 'sit' : pl.speed > runAt ? 'run' : pl.speed > 0.2 ? 'walk' : 'idle');
        const body = {
          x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, rotY: Math.round((pl.rotY || 0) * 1000) / 1000,
          anim, speed: Math.round((pl.speed || 0) * 10) / 10, zoneId: G.state.player?.zoneId || G.sys.minimap?.currentZone?.id || null,
          emote: this._emoteState?.id || null, emoteAt: this._emoteState?.at || 0, nickname: G.state.profile?.nickname || '',
        };
        if (sendApp) { body.appearance = app; S.appKey = appKey; S.appT = 10; }
        const data = await G.net.request('presence/update.php', { body, timeout: 6000, quiet: true });
        if (this._srv !== S) return;
        this._netOk();
        this._applyPresence(data);
      } catch (e) { if (this._srv === S) this._netFail(e); }
      finally { S.presBusy = false; }
    },
    _applyPresence(data) {
      const S = this._srv;
      if (!S) return;
      const raw = Array.isArray(data) ? data : Array.isArray(data?.players) ? data.players : [];
      const me = String(G.save?.profile?.id ?? '');
      const seen = new Set();
      let n = 0;
      for (const r of raw) {
        if (n >= MAX_REMOTES) break;                       // never spawn an unbounded crowd
        if (!r || typeof r !== 'object' || Array.isArray(r)) continue; // malformed row
        const id = String(r.id ?? r.userId ?? r.user_id ?? '').slice(0, 40);
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || id === me) continue;
        const key = 'P_' + id;
        if (seen.has(key)) continue;
        seen.add(key);
        n++;
        try { this._upsertRemote(key, id, r); } catch (e) { G.log.warn('NETWORK', 'remote player update failed', e); }
      }
      for (const [key, o] of this.others) {
        if (o.kind !== 'remote' || seen.has(key)) continue;
        const miss = (S.missing.get(key) || 0) + 1;
        S.missing.set(key, miss);
        if (miss >= 2) { this._removeRemote(o); S.missing.delete(key); }
      }
      for (const key of seen) S.missing.delete(key);
      const online = Number(data?.online ?? data?.count);
      S.online = Number.isFinite(online) && online > 0 ? Math.min(Math.floor(online), 99999) : 1 + seen.size;
      S.presFirst = false;
      this._updateOnline();
    },
    /** validated remote row -> {name, x, y, z, rot, zoneId, anim, emote, emoteAt, appearance} or null */
    _remoteRow(r) {
      const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      let x = num(r.x), z = num(r.z), y = num(r.y), rot = num(r.rotY ?? r.rot ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      x = clamp(x, -WORLD_LIM, WORLD_LIM); z = clamp(z, -WORLD_LIM, WORLD_LIM);
      y = Number.isFinite(y) ? clamp(y, -10, 80) : null;
      rot = Number.isFinite(rot) ? Math.atan2(Math.sin(rot), Math.cos(rot)) : 0;
      const zoneId = typeof r.zoneId === 'string' && /^[A-Z0-9_]{1,40}$/.test(r.zoneId) ? r.zoneId : null;
      const anim = typeof r.anim === 'string' && G.avatar?.actions && Object.prototype.hasOwnProperty.call(G.avatar.actions, r.anim) ? r.anim : null;
      const emote = typeof r.emote === 'string' && (G.data.emotes || []).some((q) => q.id === r.emote) ? r.emote : null;
      const emoteAt = num(r.emoteAt);
      let appearance = null;
      if (r.appearance && typeof r.appearance === 'object' && !Array.isArray(r.appearance)) {
        try { appearance = G.avatar?.normalize ? G.avatar.normalize(r.appearance) : null; } catch (e) { appearance = null; }
      }
      const speed = num(r.speed);
      return { name: cleanName(r.nickname ?? r.name ?? '체험객', 'remote'), x, y, z, rot, zoneId, anim, emote, emoteAt: Number.isFinite(emoteAt) ? emoteAt : 0, appearance, speed: Number.isFinite(speed) ? clamp(speed, 0, 30) : 0 };
    },
    _upsertRemote(key, id, raw) {
      const r = this._remoteRow(raw);
      if (!r) return;
      const { name, x, y, z, rot } = r;
      let o = this.others.get(key);
      if (!o) {
        if (!G.avatar?.create || !this._vroot) return;
        const h = G.ui.h;
        const rig = G.avatar.create(r.appearance || G.avatar.random(U.hashInt(name)), { shadow: this._shadow });
        const group = new THREE.Group(); group.name = 'remote'; group.add(rig.group);
        this._vroot.add(group);
        const bubble = this._bubbleEl('remote');
        const dot = h('i', { class: 'soc-dot', style: { background: nameColor(name) } });
        const nm = h('span', { class: 'nm' }, name);
        const tag = h('button', { class: 'nametag remote', type: 'button', title: `${name} · 클릭하면 메뉴가 열려요`, 'data-say': '친구예요. 누르면 친구 메뉴가 열려요.' }, dot, nm);
        const root = h('div', { class: 'soc-label' }, bubble, tag);
        const label = G.ui.label({ el: root, target: rig.headAnchor, offsetY: 0.04, maxDist: LABEL_DIST, fadeDist: 8 });
        o = { id: key, uid: id, name, kind: 'remote', rig, group, position: group.position, rotY: rot, zoneId: r.zoneId, label, el: { root, bubble, tag, dot, nm }, bub: { bubble, t: 0 }, params: { speed: 0, grounded: true, vy: 0 }, tx: x, tz: z, ty: y, trot: rot, anim: null, emoteAt: r.emoteAt, appKey: '', hidden: false };
        tag.addEventListener('click', (e) => { e.stopPropagation(); this._openUser(tag, { name: o.name, kind: 'remote', id }); });
        group.position.set(x, y != null ? y : G.world.surfaceHeight(x, z), z);
        group.rotation.y = rot;
        root.classList.toggle('blocked', this._isBlocked(name));
        this.others.set(key, o);
        if (!this._srv?.presFirst) this.system(`👋 ${J.nim(name)}이 접속했어요.`);
      } else if (o.name !== name) { // account renamed
        o.name = name;
        o.el.nm.textContent = name;
        o.el.dot.style.background = nameColor(name);
        o.el.tag.title = `${name} · 클릭하면 메뉴가 열려요`;
        o.el.root.classList.toggle('blocked', this._isBlocked(name));
      }
      if (r.appearance) { const k = JSON.stringify(r.appearance); if (k !== o.appKey) { o.appKey = k; try { o.rig.setAppearance(r.appearance); } catch (e) { /* keep */ } } }
      if (Math.hypot(x - o.position.x, z - o.position.z) > 20) { o.position.set(x, y != null ? y : o.position.y, z); } // teleported: snap
      o.tx = x; o.tz = z; o.ty = y; o.trot = rot; o.zoneId = r.zoneId || o.zoneId;
      // dead reckoning between updates: keep going the way the player faces at the reported pace (walk / run only)
      o.tsp = r.anim === 'walk' || r.anim === 'run' ? r.speed : 0; o.tAt = performance.now();
      const anim = r.anim;
      if (anim !== o.anim) {
        o.anim = anim;
        if (anim) {
          const def = G.avatar.actions[anim];
          const onBench = (G.data.layout?.benches || []).some((b) => Math.hypot(b.x - x, b.z - z) < 1.2);
          o.rig.setAnim(anim, { loop: def.loop || anim === 'sit' || anim === 'dance', seatY: anim === 'sit' ? (onBench ? 0.44 : 0) : undefined });
        } else o.rig.stopAll?.();
      }
      if (r.emote && r.emoteAt > o.emoteAt) {
        o.emoteAt = r.emoteAt;
        const e = (G.data.emotes || []).find((q) => q.id === r.emote);
        if (e && !this._isBlocked(o.name) && Math.abs(G.time.now() - r.emoteAt) < 15000) { this._bubble(o.bub, e.icon, { emote: true }); o.rig.setAnim(e.anim, {}); }
      }
    },
    _updateRemotes(dt) {
      const cam = G.sys.engine.camera.position;
      const nowMs = performance.now();
      for (const o of this.others.values()) {
        if (o.kind !== 'remote') continue;
        const p = o.position;
        const ox = p.x, oz = p.z;
        // where the player should be by now: the last report + up to 1.2 s of its reported motion (stops at walls)
        let ex = o.tx, ez = o.tz;
        if (o.tsp > 0.2 && o.tAt) {
          const lead = o.tsp * Math.min(1.2, (nowMs - o.tAt) / 1000);
          const fx = o.tx + Math.sin(o.trot) * lead, fz = o.tz + Math.cos(o.trot) * lead;
          let free = true;
          try { free = !G.world.blocked(fx, fz, 0.3, p.y); } catch (e) { free = true; }
          if (free) { ex = fx; ez = fz; }
        }
        const gap = Math.hypot(ex - p.x, ez - p.z);
        if (gap > 20) { p.x = ex; p.z = ez; }                                  // far behind: snap
        const k = damp(3.2 + Math.min(6, gap * 0.35), dt);                     // catch up faster when further behind
        p.x += (ex - p.x) * k; p.z += (ez - p.z) * k;
        const gy = o.ty != null ? o.ty : G.world.heightAt(p.x, p.z, p.y + 0.3);
        p.y += (gy - p.y) * damp(8, dt);
        o.rotY += angleDiff(o.rotY, o.trot) * damp(6, dt);
        o.group.rotation.y = o.rotY;
        const sp = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0;
        o.params.speed += (sp - o.params.speed) * damp(6, dt);
        const cd = Math.hypot(p.x - cam.x, p.z - cam.z);
        const hide = cd > HIDE_DIST;
        o.group.visible = !hide;
        if (!hide) o.rig.update(dt, o.params);
        this._tickBubble(o.bub, dt);
      }
    },
    _removeRemote(o) {
      try { o.label?.remove(); o.rig?.dispose?.(); o.group?.parent?.remove(o.group); } catch (e) { /* ignore */ }
      this.others.delete(o.id);
      if (G.state && this._srv) this.system(`🚪 ${J.nim(o.name)}이 나갔어요.`);
    },
    _clearRemotes() {
      for (const o of [...this.others.values()]) {
        if (o.kind !== 'remote') continue;
        try { o.label?.remove(); o.rig?.dispose?.(); o.group?.parent?.remove(o.group); } catch (e) { /* ignore */ }
        this.others.delete(o.id);
      }
    },
    async _pollChat() {
      const S = this._srv;
      if (!S || !G.state) return;
      S.chatBusy = true;
      try {
        const after = Number.isSafeInteger(S.lastId) && S.lastId >= 0 ? S.lastId : 0;
        const data = await G.net.request(`chat/list.php?after=${encodeURIComponent(String(after))}`, { timeout: 6000, quiet: true });
        if (this._srv !== S) return;
        this._netOk();
        const raw = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
        const rows = [];
        for (const m of raw.slice(0, MAX_ROWS)) {
          if (!m || typeof m !== 'object' || Array.isArray(m)) continue;  // malformed row
          const id = Number(m.id);
          if (!Number.isSafeInteger(id) || id <= 0 || id <= S.lastId) continue;
          if (typeof (m.text ?? m.message) !== 'string') continue;
          rows.push([id, m]);
        }
        rows.sort((a, b) => a[0] - b[0]);
        const me = String(G.save?.profile?.id ?? '');
        const pp = G.sys.player?.position;
        const now = G.time.now();
        for (const [id, m] of rows) {
          S.lastId = id;
          if (S.sentIds.has(id)) continue;
          const uid = String(m.userId ?? m.user_id ?? '').slice(0, 40);
          const text = this.filter(cleanText(m.text ?? m.message, MAX_LEN * 2));
          if (!text) continue;
          const self = !!uid && uid === me;
          if (self) {
            const i = S.pending.indexOf(spamKey(text));
            if (i >= 0) { S.pending.splice(i, 1); continue; }
          }
          const channel = ['all', 'local', 'system'].includes(m.channel) ? m.channel : 'all';
          const name = channel === 'system' ? '시스템' : cleanName(m.nickname ?? m.name ?? '체험객', self ? 'me' : 'remote');
          const rawAt = m.createdAt ?? m.created_at ?? m.at;
          let at = Number(rawAt);
          if (!Number.isFinite(at) || at <= 0) at = Date.parse(String(rawAt ?? '').replace(' ', 'T'));
          if (Number.isFinite(at) && at > 0 && at < 1e11) at *= 1000; // seconds -> ms
          if (!Number.isFinite(at) || at < 1.5e12 || at > now + 864e5) at = now; // implausible timestamps
          let remote = null;
          for (const o of this.others.values()) if (o.kind === 'remote' && (o.uid === uid || o.name === name)) { remote = o; break; }
          const near = remote && pp ? Math.hypot(remote.position.x - pp.x, remote.position.z - pp.z) <= LOCAL_R : false;
          if (channel === 'local' && !near && !self) continue;
          const pushed = this._push({ name, text, channel, kind: channel === 'system' ? 'system' : self ? 'me' : 'remote', self, near: near || self, uid, sid: id, at, history: S.first });
          // the bubble shows the same masked text as the log (personal information → 🔒)
          if (pushed && !S.first && !self && remote && !this._isBlocked(name)) {
            const hid = this._kidHidden(pushed);
            this._bubble(remote.bub, hid ? '✉️' : this._kidText(pushed), { emote: hid, say: this._kidSpeakText(pushed) });
            G.sfx('chat', { volume: 0.6 });
          }
        }
        const lastId = Number(data?.lastId);
        if (Number.isSafeInteger(lastId) && lastId > S.lastId && lastId < S.lastId + 1e6) S.lastId = lastId; // skipped hidden rows
        S.first = false;
        const online = Number(data?.online);
        if (Number.isFinite(online) && online > 0) { S.online = Math.min(Math.floor(online), 99999); this._updateOnline(); }
      } catch (e) { if (this._srv === S) this._netFail(e); }
      finally { S.chatBusy = false; }
    },
    async _serverSend(text, channel) {
      const S = this._srv;
      if (!S) return;
      const key = spamKey(text); // the server may mask differently: match my echo by its skeleton
      S.pending.push(key);
      if (S.pending.length > 20) S.pending.shift();
      const drop = () => { const i = S.pending.indexOf(key); if (i >= 0) S.pending.splice(i, 1); };
      try {
        const data = await G.net.request('chat/send.php', { body: { text, channel }, timeout: 8000 });
        const id = Number(data?.message?.id ?? data?.id);
        if (Number.isSafeInteger(id) && id > 0) {
          S.sentIds.add(id);
          drop();
          if (S.sentIds.size > 200) S.sentIds = new Set([...S.sentIds].slice(-100));
        }
        this._netOk();
      } catch (e) {
        drop();
        if (e?.code === 'RATE_LIMITED' || e?.status === 429) G.ui.toast('메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', { type: 'warn' });
        else G.ui.toast(e?.message || '메시지를 보내지 못했어요.', { type: 'error' });
        this.system('⚠️ 마지막 메시지가 전송되지 않았어요.');
      }
    },

    // ================================================================ frame
    update(dt) {
      this._tickBubble(this._me, dt);
      if (!G.state) return;
      if (this._mode === 'local') {
        this._updateVisitors(dt);
        this._updateVisitorScheduler(dt);
      } else this._updateServer(dt);
    },
  };

  const _tv = new THREE.Vector3();
  G.register(social);
})();
