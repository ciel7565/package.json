// =============================================================================
// 65-companion.js — mascot "옹이" (a little onggi-jar spirit): 2D SVG portraits, speech cards,
// contextual hints, a 3D companion that follows the player, its play menu and a helper-tip engine.
//
//   G.mascot.svg(mood='happy', size=96, {outfit, bob, blink=true, pop, label, className}) -> '<svg ...>' (CSP-safe)
//        moods: happy wink surprised sleepy cheer think sad · outfit: {color, hat, scarf} | 'current'
//   G.mascot.say(text, {mood, duration, action:{label, fn}, priority, ttl, force, voice}) -> bool   queued speech card
//        (easy mode reads it aloud via G.easy.say unless voice === false — pass that when you already spoke it)
//   G.mascot.hint({detail}) -> string | {text, mood, action, key}   best contextual tip for the current state
//   G.mascot.tell()          say the current hint      G.mascot.dismiss() / clear()     G.mascot.showcase() (test album)
//   G.mascot.moods · G.mascot.name()
//
//   쉬운 모드 (G.easy.on) — 옹이 is the voice guide:
//     every speech card is also read aloud (G.easy.say, queued, opts.voice === false = silent) with a 🔊 replay;
//     kid sentences for every tip; idle 20 s → "다음 할 일" card + G.easy.point at the target / 👉 같이 가기
//     (3 nudges per idle spell: 20 s, 45 s, 90 s); delivers the healthy-play reminder & rest (sleepy 옹이,
//     naps during the rest screen, cheers afterwards); companion menu / rename = big picture tiles
//     (G.easy.pick, preset names — no typing); far targets use G.easy.goTo.
//     NEW-2: the "다음 할 일" card (G.easy.nextStep) is the one source of what to do — tips about anything else are
//     dropped, step tips carry the card's own action (opts.stepAction), any other card loses its button while a
//     step is open (and lines from other modules are not read aloud then); no tips while the gold prompt is up or
//     for 20 s after a walk arrives.
//
//   G.sys.companion (order 82)
//     openMenu() / closeMenu() / toggleMenu()     radial play menu (쓰다듬기 · 한마디 · 옷 갈아입히기 · 이름 바꾸기), hotkey O
//     pet() · openWardrobe() · openRename() · setOutfit({color,hat,scarf}) · setName(name) · react(kind)
//     visible · position (Vector3) · object (THREE.Group)
//   Interactable kind 'companion' ('옹이와 놀기'). Setting G.settings.companion (default true).
//   State G.state.companion = {name, outfit:{color,hat,scarf}, affection 0..100, met, affDay, affToday, pets, milestones[]}
//
// 3D: lathe-turned glazed jar body (canvas glaze texture with a lighter belly band), canvas face decal that
// blinks and changes expression, lid hat with a sprout, stubby arms & feet, outfit variants, blob shadow.
// Arrive-steering follow ~1.6 m behind-right, squash & stretch hops, idle look/spin/bounce/hum, sleeps at
// night (Zz), jumps + sparkles on rewards, points at the quest target, leaf umbrella in rain, re-appears
// next to the player after teleports. Phase 4 (WALK 9.6 / RUN 18 m/s): accelerates with the player's pace, long
// bounding catch-up hops with dust puffs, sub-stepped collision, a puff + dizzy pop-up next to the player when it
// lags > 13 m for ~1 s; sprint lean + arms back + "💨 wee", claps on quest completion, dances along with GES_DANCE,
// yawns before napping, shivers in snow. No collider of its own (never blocks the player); it lightly resolves
// against world colliders and never walks into water.
// Security: every user/remote string is rendered with textContent; SVG markup is generated only from
// whitelisted ids and numbers; names are NFC-cleaned, length/charset checked and bad-word filtered.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp, lerp = U.lerp, damp = U.damp;
  const TAU = Math.PI * 2;
  const pnow = () => performance.now();
  const esc = U.escapeHtml;

  // ================================================================= catalog
  const MOODS = ['happy', 'wink', 'surprised', 'sleepy', 'cheer', 'think', 'sad'];
  const MOOD_SET = new Set(MOODS);
  const MOOD_NAME = { happy: '기쁨', wink: '찡긋', surprised: '깜짝', sleepy: '졸려요', cheer: '신나요', think: '골똘', sad: '시무룩' };
  const DEFAULT_NAME = '옹이';
  const NAME_MAX = 8;

  // glaze palettes (2D + 3D share them)
  const COLORS = {
    brown: { name: '옹기 갈색', emoji: '🟤', unlock: { level: 1 }, hi: '#ad7146', mid: '#6e3f24', dark: '#2e180c', bandHi: '#f3cc98', bandLo: '#d39a60', lid: '#4b2b19', lidHi: '#86542f', line: '#3b2113', pattern: '#e8b67f' },
    ochre: { name: '황토빛', emoji: '🟠', unlock: { level: 2 }, hi: '#e6aa63', mid: '#b0712f', dark: '#5e3512', bandHi: '#fde6ba', bandLo: '#e9bd7b', lid: '#8a5226', lidHi: '#c78645', line: '#6b3c15', pattern: '#ffdba4' },
    celadon: { name: '청자 비색', emoji: '🟢', unlock: { level: 3 }, hi: '#bfe6cf', mid: '#6fa98d', dark: '#2f5a48', bandHi: '#f1faf2', bandLo: '#cfe7d6', lid: '#4f8a72', lidHi: '#93c9b0', line: '#2d5a47', pattern: '#e6f6ea' },
    black: { name: '흑유 검정', emoji: '⚫', unlock: { level: 4 }, hi: '#776a66', mid: '#2f2928', dark: '#0d0a0a', bandHi: '#e8c095', bandLo: '#bd8d5c', lid: '#1d1918', lidHi: '#544846', line: '#000000', pattern: '#a3876c' },
    white: { name: '백자 순백', emoji: '⚪', unlock: { level: 5 }, hi: '#ffffff', mid: '#e6e2d6', dark: '#a9a395', bandHi: '#fffbf2', bandLo: '#f3e5ca', lid: '#d2ccbd', lidHi: '#f7f4ec', line: '#bdb5a2', pattern: '#7f9cc4' },
    buncheong: { name: '분청 회청', emoji: '🔵', unlock: { level: 7 }, hi: '#c0c9bf', mid: '#7d8a82', dark: '#3c4640', bandHi: '#f6f0e2', bandLo: '#ddd3bd', lid: '#5d6a63', lidHi: '#a1ada5', line: '#3e4842', pattern: '#f2ecdc' },
    sakura: { name: '벚꽃 분홍', emoji: '🌸', unlock: { affection: 50 }, hi: '#ffd8e3', mid: '#e397ad', dark: '#9a4d66', bandHi: '#fff6f8', bandLo: '#ffdbe4', lid: '#c96f8a', lidHi: '#f4afc3', line: '#9a4d66', pattern: '#fff0f4' },
  };
  const HATS = {
    lid: { name: '뚜껑 모자', emoji: '🏺', unlock: { level: 1 } },
    none: { name: '모자 벗기', emoji: '🌱', unlock: { level: 1 } },
    straw: { name: '밀짚모자', emoji: '👒', unlock: { level: 2 } },
    flower: { name: '꽃 화관', emoji: '🌼', unlock: { level: 3 } },
    gat: { name: '선비 갓', emoji: '🎩', unlock: { level: 5 } },
    jobawi: { name: '조바위', emoji: '🎀', unlock: { level: 6 } },
    lotus: { name: '연잎 모자', emoji: '🍃', unlock: { affection: 30 } },
  };
  const SCARVES = {
    none: { name: '없음', emoji: '➖', unlock: { level: 1 } },
    red: { name: '빨간 목도리', emoji: '🧣', unlock: { level: 2 } },
    saekdong: { name: '색동 목도리', emoji: '🌈', unlock: { level: 4 } },
    heart: { name: '하트 스카프', emoji: '💗', unlock: { affection: 80 } },
  };
  const SLOTS = { color: COLORS, hat: HATS, scarf: SCARVES };
  const DEFAULT_OUTFIT = Object.freeze({ color: 'brown', hat: 'lid', scarf: 'none' });
  const AFFECTION_MILESTONES = [30, 50, 80, 100];

  function normOutfit(o) {
    const src = o && typeof o === 'object' ? o : DEFAULT_OUTFIT;
    return {
      color: Object.prototype.hasOwnProperty.call(COLORS, src.color) ? src.color : DEFAULT_OUTFIT.color,
      hat: Object.prototype.hasOwnProperty.call(HATS, src.hat) ? src.hat : DEFAULT_OUTFIT.hat,
      scarf: Object.prototype.hasOwnProperty.call(SCARVES, src.scarf) ? src.scarf : DEFAULT_OUTFIT.scarf,
    };
  }
  function playerLevel() { return Math.max(1, Math.floor(Number(G.state?.stats?.level) || 1)); }
  function affection() { return clamp(Number(G.state?.companion?.affection) || 0, 0, 100); }
  /** {ok, need} for an unlock rule */
  function unlockInfo(rule) {
    if (!rule) return { ok: true, need: '' };
    if (rule.level && playerLevel() < rule.level) return { ok: false, need: kidOn() ? `⭐${rule.level}` : `Lv.${rule.level}` };
    if (rule.affection && affection() < rule.affection) return { ok: false, need: `💗 ${rule.affection}` };
    return { ok: true, need: '' };
  }
  const isUnlocked = (slot, id) => !!SLOTS[slot]?.[id] && unlockInfo(SLOTS[slot][id].unlock).ok;

  // ================================================================= text helpers
  // control / invisible / bidi characters (built from code points so the source stays plain ASCII)
  const CTRL_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0]];
  const uEsc = (n) => '\\u' + n.toString(16).padStart(4, '0');
  const CTRL_RE = new RegExp('[' + CTRL_RANGES.map(([a, b]) => (a === b ? uEsc(a) : uEsc(a) + '-' + uEsc(b))).join('') + ']', 'g');
  function cleanText(s, max = 180) {
    let t = String(s ?? '');
    if (t.length > max * 8) t = t.slice(0, max * 8);
    try { t = t.normalize('NFC'); } catch (e) { /* old engine */ }
    t = t.replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
    const cps = Array.from(t);
    return cps.length > max ? cps.slice(0, max).join('').trim() + '…' : t;
  }
  /** Korean particle: josa('옹이', '과/와') -> '옹이와'; non-Hangul endings get both forms */
  function josa(word, pair) {
    const w = String(word ?? '');
    const [a, b] = pair.split('/');
    const code = w.trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return `${w}${a}(${b})`;
    const fin = code % 28;
    if (a === '으로') return w + (fin === 0 || fin === 8 ? '로' : '으로');
    return w + (fin ? a : b);
  }
  const copula = (w) => josa(w, '이에요/예요');
  const nick = () => cleanText(G.state?.profile?.nickname || '체험객', 20) || '체험객';
  const myName = () => (G.state?.companion?.name) || DEFAULT_NAME;
  // 쉬운 모드 (default): kid sentences, voice, big tiles. Never throws when 08-easy is missing.
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const kidT = (adult, kid) => (kidOn() ? kid : adult);
  function kidVoice(text, opts) { try { return G.easy?.say?.(text, opts || {}); } catch (e) { return null; } }
  /** a reminder card / rest screen from 08-easy is on screen (옹이 stays quiet and delivers it instead) */
  function restShowing() {
    try { return !!document.querySelector('#easy-layer .easy-rest-card:not(.out), #easy-layer .easy-rest:not(.out)'); } catch (e) { return false; }
  }
  // preset companion names for the kid rename picker (all pass validName)
  const KID_NAMES = [['옹이', '🏺'], ['콩이', '🌱'], ['단지', '🍯'], ['방울이', '💧'], ['뽀송이', '☁️'], ['토리', '🌰'], ['별이', '⭐'], ['초롱이', '🏮']];

  const NAME_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 _-]+$/;
  const RESERVED_NAMES = ['시스템', 'system', '운영자', '관리자', '운영진', 'admin', 'gm', '공지', '알림', 'null', 'undefined'];
  function hasBad(text) {
    try { if (G.sys.social?.hasBadWord) return !!G.sys.social.hasBadWord(text); } catch (e) { /* fall back */ }
    const low = String(text).toLowerCase().replace(/[\s_-]/g, '');
    return (G.data.badWords || []).some((w) => w && low.includes(String(w).toLowerCase()));
  }
  /** -> {ok, name, msg} */
  function validName(raw) {
    const n = cleanText(raw, 40);
    const len = Array.from(n).length;
    if (!len) return { ok: false, name: n, msg: '이름을 1글자 이상 적어 주세요.' };
    if (len > NAME_MAX) return { ok: false, name: n, msg: `이름은 ${NAME_MAX}글자까지 지을 수 있어요.` };
    if (!NAME_RE.test(n)) return { ok: false, name: n, msg: '한글·영문·숫자와 띄어쓰기, -, _ 만 쓸 수 있어요.' };
    const low = n.toLowerCase().replace(/\s/g, '');
    const npcNames = Object.values(G.data.npcs || {}).map((x) => String(x?.name || '').toLowerCase());
    if (RESERVED_NAMES.includes(low) || npcNames.includes(low)) return { ok: false, name: n, msg: '다른 이름을 골라 주세요.' };
    if (hasBad(n)) return { ok: false, name: n, msg: '바르고 고운 이름을 지어 주세요.' };
    return { ok: true, name: n, msg: '' };
  }

  // ================================================================= 2D SVG mascot
  let svgSeq = 0;
  const nn = (v) => Math.round(v * 10) / 10;
  const INK = '#1d0f08', MOUTH = '#4a170d', TONGUE = '#ff8a80';
  const BODY_PATH = 'M42 114C27 112 15 99 15 79C15 58 27 44 40 39L80 39C93 44 105 58 105 79C105 99 93 112 78 114Z';
  const ARMS = {
    down: [[16, 88, 30], [104, 88, -30]],
    out: [[11, 79, 62], [109, 79, -62]],
    up: [[14, 61, -30], [106, 61, 30]],
    waveR: [[16, 88, 30], [107, 60, 26]],
    droop: [[19, 92, 12], [101, 92, -12]],
  };
  const MOOD_ARMS = { happy: 'down', wink: 'waveR', surprised: 'out', sleepy: 'droop', cheer: 'up', think: 'down', sad: 'droop' };

  function star4(cx, cy, r, fill, op = 1) {
    const k = r * 0.24;
    return `<path d="M${nn(cx)} ${nn(cy - r)}Q${nn(cx + k)} ${nn(cy - k)} ${nn(cx + r)} ${nn(cy)}Q${nn(cx + k)} ${nn(cy + k)} ${nn(cx)} ${nn(cy + r)}Q${nn(cx - k)} ${nn(cy + k)} ${nn(cx - r)} ${nn(cy)}Q${nn(cx - k)} ${nn(cy - k)} ${nn(cx)} ${nn(cy - r)}Z" fill="${fill}" opacity="${op}"/>`;
  }

  /** hat artwork -> {svg, sproutY, sproutScale, tilt} (drawn inside a tilt group around the neck) */
  function hatSvg(hat, pal, id) {
    const lid = `<path d="M34 37C35 24 85 24 86 37Z" fill="url(#${id}h)"/><ellipse cx="60" cy="37" rx="27.5" ry="4.8" fill="${pal.lid}"/>`
      + `<path d="M43 30C48 26.5 55 25.6 62 26" stroke="#fff" stroke-opacity=".32" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      + `<ellipse cx="60" cy="24.6" rx="5.8" ry="3.6" fill="${pal.lidHi}"/><ellipse cx="58.4" cy="23.6" rx="2" ry="1" fill="#fff" opacity=".35"/>`;
    switch (hat) {
      case 'none':
        return { svg: `<ellipse cx="60" cy="39" rx="18.5" ry="3.9" fill="#1a0d07"/><path d="M42 39.6Q60 44 78 39.6" stroke="${pal.lidHi}" stroke-opacity=".5" stroke-width="1.2" fill="none"/>`, sproutY: 38.5, sproutScale: 1, tilt: 0 };
      case 'straw':
        return {
          svg: `<ellipse cx="60" cy="35.5" rx="41" ry="8.6" fill="#d9b25c"/><ellipse cx="60" cy="34.4" rx="39" ry="7.4" fill="#ecca78"/>`
            + `<path d="M26 35.5Q60 44 94 35.5M30 32.4Q60 40 90 32.4" stroke="#b98b3c" stroke-opacity=".45" stroke-width=".9" fill="none"/>`
            + `<path d="M41 34.5C41 19.5 79 19.5 79 34.5Z" fill="#f0d389"/><path d="M41.2 31.6C50 34.3 70 34.3 78.8 31.6L79 27.6C70 30.3 50 30.3 41 27.6Z" fill="#d9483f"/>`
            + `<path d="M46 25.5C51 22 58 21.5 64 22" stroke="#fff" stroke-opacity=".38" stroke-width="2" fill="none" stroke-linecap="round"/>`,
          sproutY: 22, sproutScale: 0.95, tilt: -6,
        };
      case 'flower': {
        const fl = [[36, 34.5, '#ff8fb3'], [46.5, 31, '#fff4ec'], [60, 29.6, '#c9a5ff'], [73.5, 31, '#ff8fb3'], [84, 34.5, '#fff4ec']];
        let f = '';
        for (const [x, y, c] of fl) {
          for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU - Math.PI / 2; f += `<circle cx="${nn(x + Math.cos(a) * 3)}" cy="${nn(y + Math.sin(a) * 3)}" r="2.7" fill="${c}"/>`; }
          f += `<circle cx="${x}" cy="${y}" r="2" fill="#ffd54a"/>`;
        }
        return { svg: lid + `<path d="M33 35Q60 27 87 35" stroke="#5aa64a" stroke-width="2" fill="none"/>` + f, sproutY: 22, sproutScale: 1, tilt: -7 };
      }
      case 'gat':
        return {
          svg: `<ellipse cx="60" cy="35" rx="45" ry="7.8" fill="#1b1716" fill-opacity=".86"/><ellipse cx="60" cy="35" rx="45" ry="7.8" fill="none" stroke="#5c514d" stroke-width=".9"/>`
            + `<path d="M48 34L50 18.5C53 16.6 67 16.6 70 18.5L72 34Z" fill="#141010"/><ellipse cx="60" cy="18.6" rx="10.2" ry="2.5" fill="#2c2524"/>`
            + `<path d="M48.3 30.5C55 32.4 65 32.4 71.7 30.5L71.9 33.4C65 35.3 55 35.3 48.1 33.4Z" fill="#4a2c22"/>`
            + `<path d="M52 21C55 19.8 60 19.6 63 20" stroke="#fff" stroke-opacity=".28" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
          sproutY: 17, sproutScale: 0.72, tilt: -4,
        };
      case 'jobawi':
        return {
          svg: `<ellipse cx="60" cy="39" rx="18.5" ry="3.9" fill="#1a0d07"/>`
            + `<path d="M31 44C29 27 43 19 60 19C77 19 91 27 89 44C83 36 72 32.5 60 32.5C48 32.5 37 36 31 44Z" fill="#43285a"/>`
            + `<path d="M31 44C28.5 49 29.5 55 33.5 58L38 44.5Z M89 44C91.5 49 90.5 55 86.5 58L82 44.5Z" fill="#3a2250"/>`
            + `<path d="M33 41C39 34.5 49 31.4 60 31.4C71 31.4 81 34.5 87 41" stroke="#f4c54a" stroke-width="1.6" fill="none"/>`
            + `<path d="M36 28C44 22 52 20.6 60 20.6C68 20.6 76 22 84 28" stroke="#f4c54a" stroke-width="1.3" fill="none" stroke-dasharray="2 2.2"/>`
            + `<circle cx="60" cy="22" r="3.2" fill="#ff6f91"/><path d="M60 25v7" stroke="#ff6f91" stroke-width="1.6" stroke-linecap="round"/><circle cx="60" cy="33" r="1.6" fill="#ffd54a"/>`,
          sproutY: 36, sproutScale: 0.9, tilt: -3,
        };
      case 'lotus': {
        let veins = '';
        for (let k = 0; k < 9; k++) { const a = Math.PI + (k / 8) * Math.PI; veins += `M60 31L${nn(60 + Math.cos(a) * 34)} ${nn(31 + Math.sin(a) * -7.5)}`; }
        return {
          svg: `<ellipse cx="60" cy="33" rx="38" ry="9.6" fill="#3f8f3b"/><ellipse cx="60" cy="31.4" rx="36" ry="8.2" fill="url(#${id}l)"/>`
            + `<path d="${veins}" stroke="#c9f0a8" stroke-opacity=".55" stroke-width=".9" fill="none"/>`
            + `<circle cx="74" cy="29.4" r="3.1" fill="#bfe9ff" opacity=".9"/><circle cx="73" cy="28.4" r="1" fill="#fff"/>`,
          sproutY: 29.5, sproutScale: 0.9, tilt: -8,
        };
      }
      case 'lid':
      default:
        return { svg: lid, sproutY: 22.5, sproutScale: 1, tilt: -7 };
    }
  }

  function scarfSvg(scarf, id) {
    if (scarf === 'none' || !SCARVES[scarf]) return '';
    const fill = scarf === 'saekdong' ? `url(#${id}s)` : scarf === 'heart' ? '#ff8db5' : '#d9443c';
    const tail = scarf === 'saekdong' ? `url(#${id}s)` : scarf === 'heart' ? '#f56d9d' : '#b8322b';
    let s = `<path d="M71 47L80 63L72.5 65.5L67.5 49Z" fill="${tail}"/>`
      + `<path d="M36.5 40.5C45 47.5 75 47.5 83.5 40.5L84.8 47C75.5 54.5 44.5 54.5 35.2 47Z" fill="${fill}"/>`
      + `<path d="M38 43.6C47 49.6 73 49.6 82 43.6" stroke="#fff" stroke-opacity=".28" stroke-width="1.4" fill="none"/>`;
    if (scarf === 'heart') {
      s += `<circle cx="44" cy="46" r="1.1" fill="#fff" opacity=".85"/><circle cx="54" cy="49" r="1.1" fill="#fff" opacity=".85"/><circle cx="66" cy="49" r="1.1" fill="#fff" opacity=".85"/><circle cx="77" cy="46" r="1.1" fill="#fff" opacity=".85"/>`
        + `<path d="M60 56.5C55 53 54.5 49.4 57.3 48.8C58.6 48.5 59.6 49.3 60 50.4C60.4 49.3 61.4 48.5 62.7 48.8C65.5 49.4 65 53 60 56.5Z" fill="#e8344f" stroke="#fff" stroke-width=".8"/>`;
    }
    return s;
  }

  /** onggi-jar spirit 옹이 as inline SVG markup (generated only from whitelisted values) */
  function mascotSvg(mood, size, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const m = MOOD_SET.has(mood) ? mood : 'happy';
    const sz = clamp(Math.round(Number(size) || 96), 12, 640);
    const of = normOutfit(o.outfit === 'current' ? G.state?.companion?.outfit : o.outfit);
    const pal = COLORS[of.color];
    const id = 'ong' + (++svgSeq).toString(36);
    const cls = ['ong-svg', 'mascot-svg', 'ong-m-' + m];
    if (o.bob) cls.push('ong-bob');
    if (o.blink !== false) cls.push('ong-blink');
    if (o.pop) cls.push('ong-pop');
    if (typeof o.className === 'string' && /^[\w -]{1,60}$/.test(o.className)) cls.push(o.className);
    const aria = o.label ? ` role="img" aria-label="${esc(cleanText(o.label, 40))}"` : ' aria-hidden="true"';
    const H = Math.round((sz * 128) / 120);

    let s = `<svg class="${cls.join(' ')}" viewBox="0 0 120 128" width="${sz}" height="${H}" xmlns="http://www.w3.org/2000/svg" focusable="false"${aria}>`;
    s += '<defs>'
      + `<radialGradient id="${id}b" cx=".34" cy=".3" r=".86"><stop offset="0" stop-color="${pal.hi}"/><stop offset=".52" stop-color="${pal.mid}"/><stop offset="1" stop-color="${pal.dark}"/></radialGradient>`
      + `<linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.bandHi}"/><stop offset="1" stop-color="${pal.bandLo}"/></linearGradient>`
      + `<radialGradient id="${id}e" cx=".42" cy=".34" r=".74"><stop offset="0" stop-color="#6a4532"/><stop offset=".48" stop-color="#26150c"/><stop offset="1" stop-color="#080302"/></radialGradient>`
      + `<radialGradient id="${id}c"><stop offset="0" stop-color="#ff7b8e" stop-opacity=".8"/><stop offset="1" stop-color="#ff7b8e" stop-opacity="0"/></radialGradient>`
      + `<linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a7ea79"/><stop offset="1" stop-color="#3f9d3a"/></linearGradient>`
      + `<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.mid}"/><stop offset="1" stop-color="${pal.dark}"/></linearGradient>`
      + `<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.lidHi}"/><stop offset="1" stop-color="${pal.lid}"/></linearGradient>`
      + `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e5463d"/><stop offset=".2" stop-color="#e5463d"/><stop offset=".2" stop-color="#ffcf3f"/><stop offset=".4" stop-color="#ffcf3f"/><stop offset=".4" stop-color="#46b55a"/><stop offset=".6" stop-color="#46b55a"/><stop offset=".6" stop-color="#3f8de0"/><stop offset=".8" stop-color="#3f8de0"/><stop offset=".8" stop-color="#ff7fb2"/><stop offset="1" stop-color="#ff7fb2"/></linearGradient>`
      + `<clipPath id="${id}k"><path d="${BODY_PATH}"/></clipPath>`
      + '</defs>';
    // ground shadow + feet
    s += `<ellipse cx="60" cy="122.5" rx="33" ry="4.6" fill="#000" opacity=".2"/>`
      + `<ellipse cx="46" cy="116.5" rx="9.4" ry="5.8" fill="url(#${id}a)"/><ellipse cx="74" cy="116.5" rx="9.4" ry="5.8" fill="url(#${id}a)"/>`
      + `<ellipse cx="44" cy="114.6" rx="3.6" ry="1.5" fill="#fff" opacity=".18"/><ellipse cx="72" cy="114.6" rx="3.6" ry="1.5" fill="#fff" opacity=".18"/>`;
    // arms (behind the body)
    const arms = ARMS[MOOD_ARMS[m]] || ARMS.down;
    for (const [x, y, a] of arms) s += `<ellipse cx="${x}" cy="${y}" rx="6.2" ry="9.6" transform="rotate(${a} ${x} ${y})" fill="url(#${id}a)"/>`;
    // body, belly band, onggi patterns, glaze shine
    s += `<path d="${BODY_PATH}" fill="url(#${id}b)"/>`
      + `<g clip-path="url(#${id}k)">`
      + `<path d="M4 67Q60 76 116 67L116 97Q60 106 4 97Z" fill="url(#${id}d)"/>`
      + `<path d="M4 67Q60 76 116 67M4 97Q60 106 116 97" stroke="${pal.line}" stroke-opacity=".38" stroke-width="1.5" fill="none"/>`
      + `<path d="M14 105.5q5-4.2 10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0" stroke="${pal.pattern}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".55"/>`
      + `<path d="M35 47q2 6 0 11M47 43q1.6 5 0 8.5M81 44q1.6 6 0 9.5" stroke="${pal.hi}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".4"/>`
      + `<path d="M97 60C104 70 105 88 99 101" stroke="#fff" stroke-opacity=".16" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + '</g>'
      + `<ellipse cx="33" cy="55" rx="5.4" ry="10.5" transform="rotate(28 33 55)" fill="#fff" opacity=".3"/><circle cx="39.5" cy="47.5" r="2.3" fill="#fff" opacity=".6"/>`
      + `<ellipse cx="60" cy="39.2" rx="22.5" ry="5.2" fill="${pal.dark}"/><path d="M38.5 39.5Q60 45.8 81.5 39.5" stroke="${pal.hi}" stroke-opacity=".55" stroke-width="1.3" fill="none"/>`;
    // scarf
    s += scarfSvg(of.scarf, id);
    // gat strings hang beside the face
    if (of.hat === 'gat') s += `<path d="M47 37Q41 58 45 76M73 37Q79 58 75 76" stroke="#3a2a20" stroke-width="1.3" stroke-dasharray="1.6 2.4" fill="none" stroke-linecap="round"/><circle cx="45" cy="77" r="1.8" fill="#c8a24a"/><circle cx="75" cy="77" r="1.8" fill="#c8a24a"/>`;
    // hat + sprout (tilted together)
    const hat = hatSvg(of.hat, pal, id);
    const by = hat.sproutY, k = hat.sproutScale;
    const sprout = `<g transform="translate(60 ${by}) scale(${k}) translate(-60 ${-by})">`
      + `<path d="M60 ${by}Q58.8 ${by - 5} 60.6 ${by - 9.5}" stroke="#4f9e3d" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      + `<path d="M60.4 ${by - 8}C53 ${by - 15.5} 44.5 ${by - 12.5} 45.5 ${by - 6}C50.5 ${by - 3.6} 57 ${by - 4.6} 60.4 ${by - 8}Z" fill="url(#${id}l)"/>`
      + `<path d="M61 ${by - 9.2}C67 ${by - 19.5} 78.5 ${by - 17.5} 77.5 ${by - 10}C72.5 ${by - 4.8} 65 ${by - 5.8} 61 ${by - 9.2}Z" fill="url(#${id}l)"/>`
      + `<path d="M49 ${by - 9}Q54 ${by - 8.6} 58.6 ${by - 8.2}M64 ${by - 10.4}Q69 ${by - 12.4} 74 ${by - 12.4}" stroke="#e6ffd2" stroke-opacity=".55" stroke-width=".9" fill="none" stroke-linecap="round"/>`
      + '</g>';
    s += `<g transform="rotate(${hat.tilt} 60 38)">${hat.svg}${sprout}</g>`;

    // face on the belly band
    const LX = 47, RX = 73, EY = 81;
    const eyeO = (x, y, rx, ry, dx = 0, dy = 0) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${id}e)"/>`
      + `<ellipse cx="${nn(x - rx * 0.3 + dx)}" cy="${nn(y - ry * 0.36 + dy)}" rx="${nn(rx * 0.42)}" ry="${nn(ry * 0.34)}" fill="#fff"/>`
      + `<circle cx="${nn(x + rx * 0.38 + dx * 0.5)}" cy="${nn(y + ry * 0.42 + dy * 0.5)}" r="${nn(rx * 0.2)}" fill="#fff" opacity=".85"/>`;
    const eyeUp = (x, y) => `<path d="M${x - 6} ${y + 2.6}Q${x} ${y - 6.4} ${x + 6} ${y + 2.6}" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
    const eyeDown = (x, y) => `<path d="M${x - 6.2} ${y - 0.6}Q${x} ${y + 5.2} ${x + 6.2} ${y - 0.6}" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    let eyes = '', brows = '', mouth = '', deco = '', front = '';
    const smile = `<path d="M54 89.6Q60 98.4 66 89.6Q60 91.6 54 89.6Z" fill="${MOUTH}"/><path d="M56.9 93.2Q60 96.4 63.1 93.2Q60 91.8 56.9 93.2Z" fill="${TONGUE}"/>`;
    switch (m) {
      case 'wink':
        eyes = `<g class="ong-eyes">${eyeO(LX, EY, 6.2, 7.4)}</g>` + eyeUp(RX, EY);
        mouth = smile; deco = star4(91, 69, 4.2, '#ffd54a') + star4(98, 78, 2.4, '#fff3b0', 0.9);
        break;
      case 'surprised':
        eyes = `<g class="ong-eyes">${eyeO(LX, EY - 0.5, 7.2, 8.6)}${eyeO(RX, EY - 0.5, 7.2, 8.6)}</g>`;
        brows = `<path d="M40.5 69.5Q47 64.6 53.5 68.4M66.5 68.4Q73 64.6 79.5 69.5" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        mouth = `<ellipse cx="60" cy="93.6" rx="3.7" ry="4.6" fill="${MOUTH}"/>`;
        deco = `<path d="M99 29l4.5-7.5M105 36.5l7.8-3M104.5 46l8 1" stroke="#ffd54a" stroke-width="2.4" stroke-linecap="round"/>`;
        break;
      case 'sleepy':
        eyes = eyeDown(LX, EY + 1) + eyeDown(RX, EY + 1);
        mouth = `<ellipse cx="60" cy="93" rx="2.6" ry="2" fill="${MOUTH}"/>`;
        deco = `<path d="M90 23h7.5l-7.5 8h7.5M101.5 12.5h5.5l-5.5 6h5.5" stroke="#a9d8ff" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
        break;
      case 'cheer':
        eyes = eyeUp(LX, EY) + eyeUp(RX, EY);
        mouth = `<path d="M52.4 88.4Q60 102 67.6 88.4Q60 91 52.4 88.4Z" fill="${MOUTH}"/><path d="M55.8 94.6Q60 99.6 64.2 94.6Q60 92.6 55.8 94.6Z" fill="${TONGUE}"/>`;
        deco = star4(13, 42, 5.2, '#ffd54a') + star4(107, 38, 4.4, '#ffd54a') + star4(102, 54, 2.8, '#fff3b0', 0.95) + star4(19, 30, 2.6, '#fff3b0', 0.9);
        break;
      case 'think':
        eyes = `<g class="ong-eyes">${eyeO(LX, EY - 1, 6, 7.2, 1.6, -1.6)}${eyeO(RX, EY - 1, 6, 7.2, 1.6, -1.6)}</g>`;
        brows = `<path d="M41 71.4L52.6 70.8M66.8 68.6Q73 64.2 79.4 67.4" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        mouth = `<path d="M56 93.4Q60.4 91.2 64.8 92.4" stroke="${MOUTH}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
        deco = `<path d="M100.5 23.5q0-6.2 6.2-6.2q6.2 0 6.2 5.6q0 3.8-5.4 5.6v3.2" stroke="#ffd54a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="107.5" cy="36.2" r="1.7" fill="#ffd54a"/>`;
        front = `<ellipse cx="88" cy="99" rx="6.2" ry="8.6" transform="rotate(-52 88 99)" fill="url(#${id}a)"/><ellipse cx="86" cy="96.6" rx="2.4" ry="1.4" transform="rotate(-52 86 96.6)" fill="#fff" opacity=".2"/>`;
        break;
      case 'sad':
        eyes = `<g class="ong-eyes">${eyeO(LX, EY + 0.5, 6, 7.2)}${eyeO(RX, EY + 0.5, 6, 7.2)}</g>`;
        brows = `<path d="M41 72.6L52.4 68.4M79 72.6L67.6 68.4" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        mouth = `<path d="M55 95.6Q60 89.8 65 95.6" stroke="${MOUTH}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
        deco = `<path d="M38.6 88.5q-3.4 5.4 0 7.6q3.4-2.2 0-7.6z" fill="#8fd3ff"/>`;
        break;
      case 'happy':
      default:
        eyes = `<g class="ong-eyes">${eyeO(LX, EY, 6.2, 7.4)}${eyeO(RX, EY, 6.2, 7.4)}</g>`;
        mouth = smile;
        break;
    }
    s += `<ellipse cx="36.5" cy="90.5" rx="7.2" ry="4.4" fill="url(#${id}c)"/><ellipse cx="83.5" cy="90.5" rx="7.2" ry="4.4" fill="url(#${id}c)"/>`;
    s += brows + eyes + mouth + front + deco + '</svg>';
    return s;
  }

  // ================================================================= speech cards (queued, rate-limited)
  /** card sources that are 옹이's own lines (they keep their voice when a competing button is dropped in 쉬운 모드) */
  const OWN_SOURCES = new Set(['greet', 'affection', 'levelup', 'pet', 'rename', 'settings', 'tip', 'hint', 'nudge', 'rest']);
  /** 쉬운 모드: does the "다음 할 일" card currently ask for something (anything but free exploring)? */
  function kidStepBusy() {
    try { const st = G.easy?.nextStep?.(); return !!st && st.key !== 'explore'; } catch (e) { return false; }
  }
  const Say = {
    q: [], cur: null, cardEl: null, root: null, timer: 0, pumpTimer: 0, typeTimer: 0, placeTimer: 0,
    lastShownAt: 0, recent: new Map(), remaining: 0, startedAt: 0, paused: false,
    GAP: 900,

    blocked() {
      if (!G.state || !G.ready) return true;
      const b = document.body;
      if (!b || b.classList.contains('hud-hidden') || b.classList.contains('title-open')) return true;
      const hud = document.getElementById('hud');
      if (!hud || hud.hidden) return true;
      if (G.ui?.modal?.isOpen?.()) return true;
      if (G.sys.dialogue?.active || companion._menu) return true;
      const bl = G.ui?.blockers;
      if (bl && (bl.has('reward') || bl.has('tutorial') || bl.has('easy-rest'))) return true;
      if (restShowing()) return true;    // the healthy-play card owns the bottom-left corner meanwhile
      return false;
    },

    push(text, opts = {}) {
      if (!G.state && !opts.force) return false;   // no session (title screen): nothing to say
      const t = cleanText(text, 180);
      if (!t) return false;
      const now = pnow();
      // identical lines within 15 s are dropped (spam guard)
      const last = this.recent.get(t);
      if (!opts.force && last && now - last < 15000) return false;
      if (!opts.force && (this.cur?.text === t || this.q.some((x) => x.text === t))) return false;
      this.recent.set(t, now);
      if (this.recent.size > 40) { for (const [k, v] of this.recent) if (now - v > 60000) this.recent.delete(k); }
      let action = null;
      if (opts.action && typeof opts.action.fn === 'function') action = { label: cleanText(opts.action.label || '확인', 14) || '확인', fn: opts.action.fn };
      // 쉬운 모드 (NEW-2): while the "다음 할 일" card has a step to do, a card never carries a second, different big
      // button — only actions derived from that same step (opts.stepAction) stay. Any other card becomes a quiet note
      // (no button; lines from other modules are not read aloud either, so the last voice line is still the step).
      let voice = opts.voice !== false;
      if (action && !opts.stepAction && kidOn() && kidStepBusy()) {
        action = null;
        if (!OWN_SOURCES.has(opts.source)) voice = false;
      }
      const chars = Array.from(t).length;
      // read-aloud lines (easy mode) stay up long enough for the voice to finish
      const auto = kidOn() ? 3400 + chars * 115 + (action ? 3200 : 0) : 2600 + chars * 75 + (action ? 2600 : 0);
      let dur = Number(opts.duration) || auto;
      if (kidOn()) dur = Math.max(dur, auto * 0.8);
      dur = clamp(dur, 2200, 15000);
      const item = { text: t, mood: MOOD_SET.has(opts.mood) ? opts.mood : 'happy', duration: dur, action, expires: now + clamp(Number(opts.ttl) || 30000, 2000, 120000), source: opts.source || 'say', voice, prio: !!opts.priority };
      // bounded queue (5): a full queue refuses ordinary lines; a priority line pushes out the newest ordinary one
      if (this.q.length >= 5) {
        if (!opts.priority) return false;
        this.q.pop();
      }
      if (opts.priority) this.q.unshift(item); else this.q.push(item);
      this.schedule(0);
      return true;
    },

    schedule(ms) { clearTimeout(this.pumpTimer); this.pumpTimer = setTimeout(() => this.pump(), Math.max(0, ms)); },

    pump() {
      if (this.cur) return;
      const now = pnow();
      while (this.q.length && this.q[0].expires < now) this.q.shift();
      if (!this.q.length) return;
      if (this.blocked()) { this.schedule(600); return; }
      const wait = this.lastShownAt + this.GAP - now;
      if (wait > 0) { this.schedule(wait); return; }
      this.show(this.q.shift());
    },

    ensureRoot() {
      if (this.root && this.root.isConnected) return this.root;
      const hud = document.getElementById('hud');
      if (!hud) return null;
      this.root = G.ui.h('div', { class: 'ong-say', 'aria-live': 'polite' });
      hud.appendChild(this.root);
      return this.root;
    },

    show(item) {
      const root = this.ensureRoot();
      if (!root) { this.q.unshift(item); this.schedule(800); return; }
      const h = G.ui.h;
      this.cur = item;
      this.lastShownAt = pnow();
      root.innerHTML = '';
      const name = myName();
      const card = h('div', { class: `ong-card ong-mood-${item.mood}`, role: 'status' });
      const face = h('button', { class: 'ong-card-face', type: 'button', title: `${josa(name, '과/와')} 놀기`, 'aria-label': `${josa(name, '과/와')} 놀기`,
        html: mascotSvg(item.mood, 66, { outfit: 'current', bob: true }) });
      face.addEventListener('click', () => { this.hide('face'); companion.openMenu(); });
      const tw = h('span', { class: 'ong-card-tw', 'aria-hidden': 'true' });
      const sr = h('span', { class: 'ong-sr', text: item.text });
      const main = h('div', { class: 'ong-card-main' },
        h('div', { class: 'ong-card-name' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏺'), h('b', { text: name })),
        h('p', { class: 'ong-card-text' }, tw, sr));
      const kid = kidOn();
      if (item.action) {
        const act = item.action;
        const b = kid
          ? h('button', { class: 'easy-big-btn easy-btn-yes ong-card-act', type: 'button', 'data-say': act.label }, h('span', null, act.label))
          : h('button', { class: 'btn btn-sm btn-gold ong-card-act', type: 'button' }, act.label, h('span', { class: 'ico ico-xs', 'data-icon': 'chevron-right' }));
        b.addEventListener('click', () => { this.hide('action'); try { act.fn(); } catch (e) { G.log.error('UI', 'mascot action failed', e); } });
        main.appendChild(h('div', { class: 'ong-card-actions' }, b));
      }
      const x = h('button', { class: 'ong-card-x', type: 'button', 'aria-label': '말풍선 닫기', title: '닫기' }, h('span', { class: 'ico ico-sm', 'data-icon': 'x' }));
      x.addEventListener('click', () => this.hide('close'));
      const bar = h('div', { class: 'ong-card-time', 'aria-hidden': 'true' }, h('i', { style: { animationDuration: item.duration + 'ms' } }));
      card.append(face, main, x, bar);
      card.addEventListener('pointerenter', () => this.pause(true));
      card.addEventListener('pointerleave', () => this.pause(false));
      if (kid) {
        card.classList.add('ong-kid');
        // 🔊 replay for children who missed it (long-press reads the sentence too)
        try { G.easy?.speakable?.(main, item.text); } catch (e) { /* voice optional */ }
        card.__easySpeak = { btn: null, text: item.text };
      }
      root.appendChild(card);
      this.cardEl = card;
      G.ui.hydrateIcons?.(card);
      this.place();
      clearInterval(this.placeTimer);
      this.placeTimer = setInterval(() => this.place(), 1000);
      this.typewrite(tw, item.text);
      this.remaining = item.duration; this.startedAt = pnow(); this.paused = false;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.hide('timeout'), item.duration);
      G.sfx('pop', { volume: 0.55 });
      // 옹이 is the voice guide in easy mode: queue behind whatever is being read (never cut a sentence off)
      if (kid && item.voice) kidVoice(item.text, { interrupt: false, priority: item.prio ? 1 : 0 });
      companion._onSay(item);
    },

    typewrite(el, text) {
      clearInterval(this.typeTimer);
      let parts;
      try { parts = typeof Intl !== 'undefined' && Intl.Segmenter ? Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text), (x) => x.segment) : Array.from(text); }
      catch (e) { parts = Array.from(text); }
      if (G.settings.reduceMotion || parts.length < 2) { el.textContent = text; return; }
      let i = 0;
      const step = Math.max(1, Math.round(parts.length / 70));
      el.textContent = '';
      this.typeTimer = setInterval(() => {
        i = Math.min(parts.length, i + step);
        el.textContent = parts.slice(0, i).join('');
        if (i >= parts.length) clearInterval(this.typeTimer);
      }, 26);
    },

    pause(on) {
      if (!this.cur || this.paused === on) return;
      this.paused = on;
      this.cardEl?.classList.toggle('paused', on);
      if (on) { clearTimeout(this.timer); this.remaining = Math.max(600, this.remaining - (pnow() - this.startedAt)); }
      else { this.startedAt = pnow(); clearTimeout(this.timer); this.timer = setTimeout(() => this.hide('timeout'), this.remaining); }
    },

    place() {
      const root = this.root;
      if (!root || !root.firstElementChild) return;
      const gap = 12;
      let left = gap, bottom = G.input?.touchUI ? 200 : 96;
      const chat = document.getElementById('chat-panel');
      if (chat && chat.offsetParent !== null) {
        const r = chat.getBoundingClientRect();
        if (r.height > 0 && r.width > 0) { left = r.left; bottom = innerHeight - r.top + 10; }
      }
      root.style.left = left + 'px';
      root.style.bottom = bottom + 'px';
      root.style.maxWidth = Math.max(220, innerWidth - left - 10) + 'px';
      // stay clear of the objective hint / interaction prompt / yard-decor toolbar (they sit low on small screens)
      for (let pass = 0; pass < 2; pass++) {
        const cr = root.getBoundingClientRect();
        for (const sel of ['#objective-hint', '#interact-prompt', '.eng-decor-bar']) {
          const o = document.querySelector(sel);
          if (!o || o.hidden || !o.getClientRects().length) continue;   // (offsetParent is null for fixed bars)
          const r = o.getBoundingClientRect();
          if (r.width && cr.left < r.right && cr.right > r.left && cr.top < r.bottom + 6 && cr.bottom > r.top - 6) {
            bottom = Math.max(bottom, innerHeight - r.top + 8);
            root.style.bottom = bottom + 'px';
          }
        }
      }
      // never cover the left vertical menu
      const lm = document.getElementById('hud-left-menu');
      if (lm && lm.offsetParent !== null) {
        const lr = lm.getBoundingClientRect(), cr = root.getBoundingClientRect();
        if (cr.top < lr.bottom + 6 && cr.left < lr.right + 6 && cr.right > lr.left) {
          const nl = lr.right + 10;
          root.style.left = nl + 'px';
          root.style.maxWidth = Math.max(200, innerWidth - nl - 10) + 'px';
        }
      }
    },

    hide(reason) {
      clearTimeout(this.timer); clearInterval(this.typeTimer); clearInterval(this.placeTimer);
      const card = this.cardEl;
      const had = !!this.cur;
      this.cur = null; this.cardEl = null; this.paused = false;
      if (card) {
        card.classList.add('out');
        setTimeout(() => { if (card.isConnected && card !== this.cardEl) card.remove(); }, 260);
      }
      if (had) this.schedule(reason === 'timeout' ? this.GAP : 320);
    },

    clear() {
      this.q.length = 0;
      clearTimeout(this.pumpTimer);
      this.hide('clear');
      if (this.root) this.root.innerHTML = '';
    },
  };

  // ================================================================= hints & tips content
  const OBJ_EMOJI = { talk: '💬', visit: '🧭', water: '💧', plant: '🌱', harvest: '🧺', ferment_check: '🏺', ferment_start: '🫘', ferment_claim: '🏺', edu: '📖', quiz: '❓', journal: '📝', photo: '📸', emote: '😊', gesture: '👋', interact: '✨', collect: '🎒', craft: '🛠️', chat: '💬', visit_all: '🗺️', level: '⭐' };
  const FACTS = [
    ['think', '옹기는 흙 속 미세한 숨구멍 덕분에 “숨 쉬는 그릇”이라고 불려요 🏺'],
    ['wink', '장독은 햇볕이 잘 들고 바람이 잘 통하는 곳에 두면 좋대요 ☀️'],
    ['happy', '메주는 삶은 콩을 찧어 네모나게 빚은 뒤 말리고 띄워서 만들어요 🫘'],
    ['think', '메주를 소금물에 담가 숙성시킨 뒤 건더기는 된장, 장물은 간장이 돼요 🥣'],
    ['wink', '김치는 채소를 소금에 절여 양념에 버무린 뒤 발효시키는 음식이에요 🥬'],
    ['happy', '고추장에는 고춧가루, 찹쌀, 메줏가루, 소금 같은 재료가 들어가요 🌶️'],
    ['think', '발효는 작은 미생물들이 음식을 천천히 바꾸어 가는 과정이에요 🦠✨'],
    ['wink', '맑은 날 장독 뚜껑을 열어 햇볕을 쬐어 주는 풍습도 있었대요 🌤️'],
    ['happy', '사진 모드(P)에서 저랑 같이 기념사진 찍어요! 📸'],
    ['cheer', '작업일지(J)에 오늘 한 일을 적으면 배운 게 오래 남아요 📝'],
  ];
  // 쉬운 모드: one short picture sentence each (read aloud)
  const KID_FACTS = [
    ['think', '옹기는 숨을 쉬는 그릇이에요 🏺'],
    ['wink', '장독은 햇볕을 좋아해요 ☀️'],
    ['happy', '메주는 콩으로 만들어요 🌱'],
    ['think', '된장이랑 간장은 메주로 만들어요 🥣'],
    ['wink', '김치는 배추로 만들어요 🥬'],
    ['happy', '고추장은 맛있게 매워요 🌶️'],
    ['think', '작은 미생물 친구가 맛있게 바꿔 줘요 🦠'],
    ['cheer', '사진도 찍어 봐요! 📸'],
    ['cheer', '그림일기도 써 봐요! 📝'],
  ];
  const PET_LINES = ['헤헤, 간지러워요! 💕', '기분 최고예요! ✨', '쓰담쓰담 너무 좋아요~ 🥰', '{nick}님 손은 참 따뜻해요 🌞', '더 열심히 도울게요! 💪', '우리 오늘도 신나게 놀아요! 🎶'];

  function entryPos(e) {
    try {
      let v = e.position;
      if (typeof v === 'function') v = v();
      if (v) return { x: v.x, z: v.z };
      if (e.object) { const w = e.object.getWorldPosition(new THREE.Vector3()); return { x: w.x, z: w.z }; }
    } catch (err) { /* broken provider */ }
    return null;
  }
  function distTo(x, z) { const p = G.sys.player?.position; return p ? Math.hypot(x - p.x, z - p.z) : Infinity; }
  /** walk to an interactable and use it (close), or open the world map when it is far away */
  function goInteract(id) {
    const e = G.interact?.get?.(id);
    if (!e) { if (kidOn()) G.ui.triggerAction?.('where'); else G.sys.minimap?.openWorldMap?.(); return false; }
    const p = entryPos(e);
    if (p && distTo(p.x, p.z) > 70) {
      // easy mode never sends a child to a map: 옹이 walks (or travels) there with them
      if (kidOn() && G.easy?.goTo) { G.easy.goTo({ x: p.x, z: p.z }, { label: '' }); return true; }
      G.ui.toast('조금 멀어요! 지도에서 위치를 확인해 보세요 🗺️', { type: 'info', emoji: '🏺' }); G.sys.minimap?.openWorldMap?.(); return false;
    }
    return !!G.interact.activate(id);
  }
  function goTo(x, z, label) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (kidOn() && G.easy?.goTo) { G.easy.goTo({ x, z, label: label || '' }, { label: label || '' }); return true; }
    if (distTo(x, z) > 70) { G.sys.minimap?.openWorldMap?.(); return false; }
    return !!G.sys.player?.walkTo?.({ x, z }, { stopDistance: 2.2 });
  }
  /** 쉬운 모드 action for a G.easy.nextStep() result: its own act, or 👉 같이 가기 */
  function kidStepAction(st) {
    if (!st) return null;
    if (st.act) return { label: `${st.actEmoji || '👉'} ${st.actLabel || '하기'}`, fn: () => st.act() };
    if (st.target) return { label: '👉 같이 가기', fn: () => goTo(st.target.x, st.target.z, st.target.label) };
    return null;
  }

  function objectiveHint() {
    const f = G.sys.quest?.focus?.();
    if (!f || f.mode === 'claim') return null;
    const q = G.data.quests?.[f.questId];
    if (!q) return null;
    const tg = f.target;
    const dist = tg ? distTo(tg.x, tg.z) : null;
    const go = tg ? { label: dist > 70 ? '지도 보기' : '같이 가기', fn: () => goTo(tg.x, tg.z) } : null;
    if (f.mode === 'giver') {
      const nm = G.data.npcs?.[q.giver]?.name || '안내원';
      return { key: 'giver:' + f.questId, mood: 'wink', text: `${nm}에게 말을 걸면 새 퀘스트 「${q.title}」${josa(q.title.slice(-1), '을/를').slice(1)} 받을 수 있어요! 💬`, action: go };
    }
    const o = q.objectives?.[f.objective];
    if (!o) return null;
    const em = OBJ_EMOJI[o.type] || '✨';
    let where = '';
    if (tg && Number.isFinite(dist)) {
      const lbl = cleanText(tg.label || '', 24);
      const d = Math.round(dist);
      where = dist <= 4 ? ' 바로 근처예요!' : lbl && !String(o.text).includes(lbl) && !lbl.includes(String(o.text)) ? ` ${lbl}까지 ${d}m 남았어요!` : ` 여기서 ${d}m만 가면 돼요!`;
    }
    return { key: `obj:${f.questId}:${f.objective}`, mood: 'think', text: `다음 할 일: ${o.text} ${em}${where}`, action: go };
  }

  // 쉬운 모드 (NEW-2): the "다음 할 일" card (G.easy.nextStep) is the ONE source of what to do. An actionable tip is
  // only offered when it is about that same step — and then it carries the card's own action (same words, same
  // button); tips about anything else are dropped, so 옹이 never contradicts the card or adds a second big button.
  /** where 옹이 points: in 쉬운 모드 always the "다음 할 일" card's own target (never a second, competing goal) */
  function pointTarget() {
    if (kidOn()) {
      try { const t = G.easy?.nextStep?.()?.target; return t && Number.isFinite(t.x) && Number.isFinite(t.z) ? t : null; } catch (e) { return null; }
    }
    return G.sys.quest?.focus?.()?.target || null;
  }
  function kidStepMatch(st, kind) {
    if (!st) return false;
    const k = String(st.key || '');
    switch (kind) {
      case 'claim': return k.startsWith('claim:');
      case 'jar': return st.type === 'ferment_claim' || st.type === 'ferment_check';
      case 'ready': return st.type === 'harvest' || st.type === 'collect';
      case 'dry': return st.type === 'water';
      default: return false;
    }
  }
  /** every tip that fits the current state, best first */
  function candidates() {
    const out = [];
    const st = G.state;
    if (!st) return out;
    const now = G.time.now();
    const kid = kidOn();
    let step = null;
    if (kid) { try { step = G.easy?.nextStep?.() || null; } catch (e) { step = null; } }
    // 1) unclaimed quest rewards (쉬운 모드: only the gift the card is about, with the card's 🎁 button)
    for (const [id, e] of Object.entries(st.quests || {})) {
      if (!e || e.status !== 'completed') continue;
      const q = G.data.quests?.[id];
      if (!q) continue;
      if (kid) {
        if (!kidStepMatch(step, 'claim')) break;
        out.push({ key: 'claim:' + id, prio: 100, mood: 'cheer', cd: 150, age: now - (Number(e.completedAt) || now),
          text: '선물이 기다려요! 🎁 받아 볼까요?', action: kidStepAction(step), stepAction: true });
        break;
      }
      out.push({ key: 'claim:' + id, prio: 100, mood: 'cheer', cd: 150, age: now - (Number(e.completedAt) || now),
        text: `「${q.title}」 보상이 기다리고 있어요! 얼른 받아요 🎁`,
        action: { label: '보상 받기', fn: () => G.sys.quest?.claim?.(id) } });
      break;
    }
    // 2) finished jars
    const F = G.sys.fermentation;
    try {
      for (const jid of F?.myJarIds?.() || []) {
        const j = F.getJar?.(jid);
        if (!j || j.status !== 'COMPLETE') continue;
        const rn = j.recipe?.name || '장';
        if (kid && !kidStepMatch(step, 'jar')) break;
        out.push({ key: `jar:${jid}:${j.state?.startedAt || 0}`, prio: 90, mood: 'cheer', cd: 600,
          text: kid ? `내 장독의 ${josa(rn, '이/가')} 다 익었어요! 🏺 열어 봐요!` : `내 항아리의 ${josa(rn, '이/가')} 다 익었어요! 🏺✨ 열어 볼까요?`,
          action: kid ? kidStepAction(step) : { label: '항아리로 가기', fn: () => goInteract(jid) }, stepAction: kid });
        break;
      }
    } catch (e) { /* fermentation optional */ }
    // 3) crops: ready to harvest / thirsty (water < 25)
    try {
      let ready = null, dry = null;
      for (const p of G.sys.farming?.plots?.() || []) {
        if (!p || p.empty || !p.crop) continue;
        if (p.ready) { if (!ready) ready = p; continue; }
        const w = Number(p.water);
        if (Number.isFinite(w) && w < 25 && (!dry || w < Number(dry.water))) dry = p;
      }
      if (ready && (!kid || kidStepMatch(step, 'ready'))) out.push({ key: `ready:${ready.id}:${ready.plantedAt || 0}`, prio: 80, mood: 'cheer', cd: 420,
        text: kid ? `${josa(ready.crop.name, '이/가')} 다 자랐어요! 🧺 거두러 가요!` : `${josa(ready.crop.name, '이/가')} 다 자랐어요! 수확하러 가 볼까요? 🧺`,
        action: kid ? kidStepAction(step) : { label: '밭으로 가기', fn: () => goInteract(ready.id) }, stepAction: kid });
      if (dry && (!kid || kidStepMatch(step, 'dry'))) out.push({ key: 'dry:' + dry.id, prio: 75, mood: 'surprised', cd: 300,
        text: kid ? `${josa(dry.crop.name, '이/가')} 목말라요! 💧 물을 줘요!` : `${dry.crop.name}밭이 목말라 보여요! 💧`,
        action: kid ? kidStepAction(step) : { label: '물 주러 가기', fn: () => goInteract(dry.id) }, stepAction: kid });
    } catch (e) { /* farming optional */ }
    // 4) the current objective (easy mode: the HUD card already shows it; 옹이 nudges after 20 s idle instead)
    if (!kid) { try { const ob = objectiveHint(); if (ob) out.push(Object.assign(ob, { prio: 60, cd: 180, idle: 60 })); } catch (e) { /* quest optional */ } }
    // 5) situational
    const W = G.sys.weather;
    // rain: never "you can skip watering" while watering IS the current step (card or quest objective)
    let waterStep = false;
    if (kid) waterStep = step?.type === 'water';
    else { try { const f = G.sys.quest?.focus?.(); waterStep = f?.mode !== 'claim' && G.data.quests?.[f?.questId]?.objectives?.[f?.objective]?.type === 'water'; } catch (e) { waterStep = false; } }
    if (W && (W.current === 'RAIN' || (W.precipitation?.rain || 0) > 0.35)) {
      out.push({ key: 'rain', prio: 40, mood: 'wink', cd: 1200, text: waterStep
        ? (kid ? '비가 와요 ☔ 그래도 물뿌리개로 밭에 물을 줘 봐요!' : '비가 와요 ☔ 그래도 지금은 직접 물을 주는 연습을 해 봐요!')
        : (kid ? '비가 와요 ☔ 비가 밭에 물을 줘요!' : '비가 와요 ☔ 빗물이 밭을 촉촉하게 적셔 주니까 물 주기는 잠깐 쉬어도 돼요!') });
    }
    if ((W?.isNight || G.world.nightFactor > 0.6) && !st.flags?.['companion:night']) out.push({ key: 'night', prio: 45, mood: 'surprised', cd: 0, once: 'companion:night', text: kid ? '밤이 됐어요 🏮 초롱불이 반짝반짝해요!' : '밤에는 청사초롱이 켜져요 🏮 은은한 불빛을 따라 산책해 봐요!' });
    const coin = Number(st.stats?.coin) || 0;
    if (coin < 30 && !kid) {   // no money talk for children
      const sellable = Object.entries(st.inventory || {}).some(([iid, n]) => n > 0 && (G.data.items?.[iid]?.sell || 0) > 0 && G.data.items?.[iid]?.type === 'crop');
      out.push({ key: 'coins', prio: 30, mood: 'think', cd: 900, idle: 15, text: sellable ? '코인이 부족할 땐 수확한 작물을 매점에 팔아 보세요 🛒💰' : '코인은 퀘스트 보상과 작물 판매로 모을 수 있어요 🪙 매점 구경도 해 봐요!', action: G.interact?.get?.('SHOP_STALL') ? { label: '매점 가기', fn: () => goInteract('SHOP_STALL') } : null });
    }
    // 6) friendly facts
    const facts = kid ? KID_FACTS : FACTS;
    const f = facts[Math.floor((now / 60000) % facts.length)];
    out.push({ key: 'fact', prio: 5, mood: f[0], cd: 300, idle: 90, text: f[1] });
    out.sort((a, b) => b.prio - a.prio);
    return out;
  }

  let lastHintKey = '', lastHintAt = 0;
  function hint(opts = {}) {
    const list = candidates();
    let pick = list[0] || null;
    // asking again quickly cycles through the other useful lines
    if (pick && list.length > 1 && pick.key === lastHintKey && pnow() - lastHintAt < 25000) pick = list[1];
    if (pick && pick.key === 'fact') { const facts = kidOn() ? KID_FACTS : FACTS; const f = facts[Math.floor(Math.random() * facts.length)]; pick = { key: 'fact', mood: f[0], text: f[1] }; }
    if (!pick) pick = { key: 'none', mood: 'happy', text: kidT('오늘도 즐겁게 체험해요! 🌿', '오늘도 신나게 놀아요! 🌿') };
    lastHintKey = pick.key; lastHintAt = pnow();
    const res = { key: pick.key, text: pick.text, mood: pick.mood || 'happy', action: pick.action || null };
    return opts.detail ? res : res.text;
  }

  // ================================================================= 3D model
  const S = 1.12;                // model scale (jar ≈ 0.6 m incl. feet)
  const BODY_Y = 0.035;          // jar sits on its feet
  const TOP_Y = 0.515;
  const BAND = [0.168, 0.362];
  const FACE = { y0: 0.17, y1: 0.36, phi: 1.9 };
  const KEY_PROFILE = [[0.120, 0.000], [0.150, 0.020], [0.188, 0.050], [0.222, 0.090], [0.248, 0.140], [0.262, 0.200], [0.262, 0.260], [0.250, 0.310],
    [0.226, 0.360], [0.193, 0.405], [0.160, 0.440], [0.135, 0.465], [0.124, 0.480], [0.128, 0.493], [0.132, 0.505], [0.122, 0.515]];
  let PROFILE = null, SIDE = null;
  function profile() {
    if (PROFILE) return PROFILE;
    const curve = new THREE.SplineCurve(KEY_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
    SIDE = curve.getPoints(30);
    PROFILE = [new THREE.Vector2(0, 0), ...SIDE, new THREE.Vector2(0, TOP_Y)];
    return PROFILE;
  }
  function rAt(y) {
    profile();
    if (y <= SIDE[0].y) return SIDE[0].x;
    for (let i = 1; i < SIDE.length; i++) {
      const a = SIDE[i - 1], b = SIDE[i];
      if (y <= b.y) return lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y));
    }
    return SIDE[SIDE.length - 1].x;
  }
  function heightAtV(v) {
    const P = profile(), N = P.length;
    const f = clamp(v, 0, 1) * (N - 1), i = Math.floor(f), k = f - i;
    if (i >= N - 1) return P[N - 1].y;
    return lerp(P[i].y, P[i + 1].y, k);
  }
  function rowOfY(y, H) {
    const P = profile(), N = P.length;
    for (let i = 1; i < N - 1; i++) {
      if (P[i].y >= y) { const a = P[i - 1].y, b = P[i].y; const v = (i - 1 + (y - a) / Math.max(1e-6, b - a)) / (N - 1); return (1 - v) * H; }
    }
    return 0;
  }
  const hexMix = (a, b, t) => { const c = new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1)); return '#' + c.getHexString(); };

  function paintBody(ctx, W, H, pal) {
    const N = profile().length;
    for (let py = 0; py < H; py++) {
      const v = 1 - (py + 0.5) / H;
      const j = v * (N - 1);
      let col;
      if (j < 1) col = pal.dark;
      else if (j > N - 2) col = '#140a05';
      else {
        const y = heightAtV(v);
        col = y < 0.11 ? hexMix(pal.dark, pal.mid, y / 0.11) : y > 0.47 ? hexMix(pal.mid, pal.dark, (y - 0.47) / 0.045) : pal.mid;
        if (y > 0.38 && y < 0.46) col = hexMix(col, pal.hi, 0.18 * Math.sin(((y - 0.38) / 0.08) * Math.PI));
        if (y >= BAND[0] && y <= BAND[1]) {
          const tt = (y - BAND[0]) / (BAND[1] - BAND[0]);
          // the glossy 3D glaze reads lighter than the flat 2D art: keep the band a warm tan
          const bc = hexMix(hexMix(pal.bandLo, pal.mid, 0.22), hexMix(pal.bandHi, pal.bandLo, 0.25), tt);
          const edge = Math.min(y - BAND[0], BAND[1] - y);
          col = hexMix(col, bc, clamp(edge / 0.006, 0, 1));
        }
        if (Math.abs(y - BAND[0]) < 0.004 || Math.abs(y - BAND[1]) < 0.004) col = hexMix(col, pal.line, 0.45);
      }
      ctx.fillStyle = col;
      ctx.fillRect(0, py, W, 1);
    }
    const rnd = U.rng(20261010);
    // glaze drips from the shoulder
    ctx.lineCap = 'round';
    ctx.strokeStyle = pal.hi; ctx.lineWidth = 3; ctx.globalAlpha = 0.3;
    const yTop = rowOfY(0.455, H);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, len = rowOfY(0.39 + rnd() * 0.035, H) - yTop;
      ctx.beginPath(); ctx.moveTo(x, yTop);
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 6, yTop + len * 0.5, x + (rnd() - 0.5) * 3, yTop + len);
      ctx.stroke();
    }
    // 물결무늬 (wave line) around the lower body, like the 2D portrait
    ctx.strokeStyle = pal.pattern; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.55;
    const wy = rowOfY(0.072, H), amp = Math.max(2, (rowOfY(0.06, H) - rowOfY(0.084, H)) / 2);
    ctx.beginPath();
    for (let x = 0; x <= W; x += 2) { const y = wy + Math.sin((x / W) * TAU * 14) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** face decal (512 x 256, transparent) in metric face coordinates */
  function paintFace(ctx, mood, blink) {
    const W = 512, H = 256;
    ctx.clearRect(0, 0, W, H);
    const rF = rAt(0.27);
    const SX = W / (FACE.phi * rF), SY = H / (FACE.y1 - FACE.y0);
    const X = (xm) => W / 2 + xm * SX, Y = (ym) => (FACE.y1 - ym) * SY;
    const EY = 0.293, EDX = 0.071, ERX = 0.026, ERY = 0.032;
    const ink = INK;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // cheeks
    for (const s of [-1, 1]) {
      const cx = X(s * 0.112), cy = Y(0.236), rx = 0.03 * SX, ry = 0.016 * SY;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(255,118,138,0.78)'); g.addColorStop(1, 'rgba(255,118,138,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
    }
    const openEye = (xm, ym, k = 1, lx = 0, ly = 0) => {
      const cx = X(xm), cy = Y(ym), rx = ERX * SX * k, ry = ERY * SY * k;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(-rx * 0.2, -rx * 0.3, rx * 0.05, 0, 0, rx);
      g.addColorStop(0, '#6a4532'); g.addColorStop(0.5, '#26150c'); g.addColorStop(1, '#080302');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(cx - rx * 0.3 + lx, cy - ry * 0.36 + ly, rx * 0.42, ry * 0.33, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(cx + rx * 0.38 + lx * 0.5, cy + ry * 0.42 + ly * 0.5, rx * 0.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    };
    const arcEye = (xm, ym, up) => {
      const cx = X(xm), cy = Y(ym), w = ERX * SX * 0.95, hh = ERY * SY * 0.55;
      ctx.strokeStyle = ink; ctx.lineWidth = 9;
      ctx.beginPath();
      if (up) { ctx.moveTo(cx - w, cy + hh * 0.5); ctx.quadraticCurveTo(cx, cy - hh * 1.6, cx + w, cy + hh * 0.5); }
      else { ctx.moveTo(cx - w, cy - hh * 0.1); ctx.quadraticCurveTo(cx, cy + hh * 1.1, cx + w, cy - hh * 0.1); }
      ctx.stroke();
    };
    const brow = (x1, y1, x2, y2, cxm, cym) => {
      ctx.strokeStyle = ink; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(X(x1), Y(y1));
      if (cxm != null) ctx.quadraticCurveTo(X(cxm), Y(cym), X(x2), Y(y2)); else ctx.lineTo(X(x2), Y(y2));
      ctx.stroke();
    };
    const MY = 0.222;
    const mouthPath = (w, d, top) => { ctx.beginPath(); ctx.moveTo(X(-w), Y(MY + top)); ctx.quadraticCurveTo(X(0), Y(MY - d), X(w), Y(MY + top)); ctx.quadraticCurveTo(X(0), Y(MY + top - 0.006), X(-w), Y(MY + top)); ctx.closePath(); };
    const openSmile = (w, d) => {
      mouthPath(w, d, 0.004); ctx.fillStyle = MOUTH; ctx.fill();
      ctx.save(); mouthPath(w, d, 0.004); ctx.clip();
      ctx.fillStyle = TONGUE; ctx.beginPath(); ctx.ellipse(X(0), Y(MY - d * 0.78), w * SX * 0.55, d * SY * 0.5, 0, 0, TAU); ctx.fill(); ctx.restore();
    };
    const line = (pts, wdt = 6) => { ctx.strokeStyle = MOUTH; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(X(pts[0]), Y(pts[1])); ctx.quadraticCurveTo(X(pts[2]), Y(pts[3]), X(pts[4]), Y(pts[5])); ctx.stroke(); };
    const closed = blink && mood !== 'cheer' && mood !== 'sleepy';
    switch (mood) {
      case 'wink':
        if (closed) arcEye(-EDX, EY, false); else openEye(-EDX, EY);
        arcEye(EDX, EY, true); openSmile(0.021, 0.024);
        break;
      case 'surprised':
        if (closed) { arcEye(-EDX, EY, false); arcEye(EDX, EY, false); } else { openEye(-EDX, EY, 1.18); openEye(EDX, EY, 1.18); }
        brow(-0.094, 0.34, -0.048, 0.343, -0.071, 0.352); brow(0.048, 0.343, 0.094, 0.34, 0.071, 0.352);
        ctx.fillStyle = MOUTH; ctx.beginPath(); ctx.ellipse(X(0), Y(MY - 0.006), 0.011 * SX, 0.012 * SY, 0, 0, TAU); ctx.fill();
        break;
      case 'sleepy':
        arcEye(-EDX, EY - 0.004, false); arcEye(EDX, EY - 0.004, false);
        ctx.fillStyle = MOUTH; ctx.beginPath(); ctx.ellipse(X(0), Y(MY - 0.004), 0.008 * SX, 0.006 * SY, 0, 0, TAU); ctx.fill();
        break;
      case 'cheer':
        arcEye(-EDX, EY, true); arcEye(EDX, EY, true); openSmile(0.026, 0.034);
        break;
      case 'think':
        if (closed) { arcEye(-EDX, EY, false); arcEye(EDX, EY, false); } else { openEye(-EDX, EY + 0.003, 0.95, 5, -6); openEye(EDX, EY + 0.003, 0.95, 5, -6); }
        brow(-0.095, 0.333, -0.05, 0.334); brow(0.05, 0.338, 0.095, 0.342, 0.072, 0.352);
        line([-0.014, 0.218, 0.002, 0.224, 0.016, 0.221]);
        break;
      case 'sad':
        if (closed) { arcEye(-EDX, EY, false); arcEye(EDX, EY, false); } else { openEye(-EDX, EY - 0.002, 0.95); openEye(EDX, EY - 0.002, 0.95); }
        brow(-0.094, 0.33, -0.05, 0.342); brow(0.094, 0.33, 0.05, 0.342);
        line([-0.016, 0.212, 0, 0.228, 0.016, 0.212]);
        break;
      case 'happy':
      default:
        if (closed) { arcEye(-EDX, EY, false); arcEye(EDX, EY, false); } else { openEye(-EDX, EY); openEye(EDX, EY); }
        openSmile(0.021, 0.024);
        break;
    }
  }

  function setColors(geo, hex) {
    const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  }
  function mergeGeos(list) {
    const g = ADDONS.BufferGeometryUtils.mergeGeometries(list, false);
    for (const x of list) x.dispose();
    return g;
  }
  const noRay = () => {};

  // ================================================================= the system
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _tmp = new THREE.Vector3();

  const companion = {
    name: 'companion', order: 82, label: '동반자 옹이',
    object: null, visible: false,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    get position() { return this.pos; },
    yaw: 0, groundY: 0, speed: 0,
    _built: false, _shown: false, _wantSnap: true,
    _tgt: new THREE.Vector3(), _lastPP: new THREE.Vector3(), _hasPP: false,
    _hopPh: 0, _sq: 0, _sqv: 0, _spin: 0, _pop: 1, _stuck: 0, _sideT: 0, _side: 1,
    _act: null, _actQ: [], _mood: 'happy', _moodUntil: 0, _moodOver: null, _faceKey: '', _blinkT: 2, _blinkOn: 0,
    _idleT: 0, _nextIdle: 6, _sleeping: false, _faceP: false, _photo: false, _umb: 0, _menu: null,
    _playerIdleSince: 0, _idleAnchor: new THREE.Vector3(), _nextPointT: 8, _bubbleUntil: 0, _bubbleKey: '',
    _tipAcc: 0, _scanAcc: 0, _lastTipAt: 0, _cool: new Map(), _greet: null, _idleHintFor: -1, _timers: new Set(),
    _texCache: new Map(), _outfitKey: '',
    // 쉬운 모드 voice guide: idle nudges, healthy-play reminder delivery, picture menu
    _lastInputAt: 0, _nudgeFor: -1, _nudgeN: 0, _restSeen: '', _restNap: false, _kidMenuOpen: false, _nudgeHand: null,

    // ------------------------------------------------------------ lifecycle
    init() {
      if (G.settingsDefaults && !('companion' in G.settingsDefaults)) G.settingsDefaults.companion = true;
      if (G.settings && G.settings.companion === undefined) G.settings.companion = true;
      this._build();
      this._bindEvents();
      // 08-easy's healthy-play card / rest screen (easy:remind / easy:rest, CONTRACT §12.5): react at once
      // (the per-tick _watchRest keeps the state in step afterwards)
      for (const ev of ['easy:remind', 'easy:rest']) G.bus.on(ev, () => { try { if (kidOn()) this._watchRest(); } catch (e) { G.log.warn('UI', 'companion rest sync failed', e); } });
      G.input?.onKey?.('KeyO', () => {
        if (this._menu) { this.closeMenu(); return true; }
        if (G.ui.isBlocking()) return false;
        if (!this._shown) { if (G.state && G.settings.companion === false) G.ui.toast('설정에서 ‘동반자 옹이’를 켜면 다시 함께 다녀요 🏺', { type: 'info', emoji: '🏺' }); return false; }
        this.openMenu();
        return true;
      }, { allowInModal: true });
      G.ui.onEscape(() => { if (this._menu) { this.closeMenu(); return true; } return false; }, 120);
      G.interact?.register?.({
        id: 'COMPANION', kind: 'companion', radius: 2.1, priority: -2,
        label: () => `${josa(myName(), '과/와')} 놀기`,
        position: () => _w.set(this.pos.x, this.groundY + 0.35, this.pos.z),
        object: this.root,
        enabled: () => this._interactable(),
        onInteract: () => this.openMenu(),
      });
    },

    onStateLoaded(state) {
      const fresh = this._normalize(state);
      if (fresh) G.dirty('companion');
      this._applyOutfit(true);
      this._updateTag();
      this._wantSnap = true;
      this._act = null; this._actQ.length = 0; this._wake(); this._hideBubble(); this._moodOver = null;
      this._cool.clear(); this._lastTipAt = pnow() - 20000; this._idleHintFor = -1;
      this._playerIdleSince = pnow();
      this._lastInputAt = pnow(); this._nudgeFor = -1; this._nudgeN = 0; this._restSeen = ''; this._restNap = false;
      this._greet = { at: pnow() + 4500, done: false, waitedOnboarding: false };
      this.closeMenu(true);
    },

    onLogout() {
      this.closeMenu(true);
      for (const id of ['companion-wardrobe', 'companion-rename', 'companion-showcase', 'companion-menu', 'companion-kid-rename']) G.ui.modal.get(id)?.close();
      this._stopNudgeHand();
      this._restSeen = ''; this._restNap = false; this._kidMenuOpen = false;
      for (const t of this._timers) clearTimeout(t);
      this._timers.clear();
      Say.clear();
      this._greet = null;
      this._setShown(false);
    },

    update(dt, t) {
      if (!this._built) return;
      const want = this._shouldShow();
      if (want !== this._shown) this._setShown(want);
      this._tickTips(dt);
      if (!this._shown) return;
      try { this._tick(dt, t); } catch (e) { G.log.error('UI', 'companion tick', e); this._setShown(false); throw e; }
    },

    // ------------------------------------------------------------ state
    _normalize(state) {
      let c = state.companion;
      const fresh = !c || typeof c !== 'object' || Array.isArray(c);
      if (fresh) c = {};
      const nm = validName(c.name);
      const out = {
        name: nm.ok ? nm.name : DEFAULT_NAME,
        outfit: normOutfit(c.outfit),
        affection: clamp(Math.round(Number(c.affection) || 0), 0, 100),
        met: c.met === true,
        affDay: typeof c.affDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.affDay) ? c.affDay : '',
        affToday: clamp(Math.round(Number(c.affToday) || 0), 0, 999),
        pets: clamp(Math.round(Number(c.pets) || 0), 0, 1e7),
        milestones: Array.isArray(c.milestones) ? [...new Set(c.milestones.filter((x) => AFFECTION_MILESTONES.includes(x)))] : [],
      };
      state.companion = out;
      // imported / edited saves cannot wear pieces that are still locked
      for (const slot of Object.keys(SLOTS)) if (!isUnlocked(slot, out.outfit[slot])) out.outfit[slot] = DEFAULT_OUTFIT[slot];
      return fresh;
    },
    _outfit() { return normOutfit(G.state?.companion?.outfit); },

    // ------------------------------------------------------------ build
    _build() {
      const E = G.sys.engine;
      if (!E?.scene) throw new Error('engine missing');
      const root = new THREE.Group(); root.name = 'companion';
      const hop = new THREE.Group(), squash = new THREE.Group(), model = new THREE.Group();
      root.add(hop); hop.add(squash); squash.add(model);
      model.scale.setScalar(S);
      this.root = root; this.object = root; this._hop = hop; this._squash = squash; this._model = model;

      // glaze materials (texture swapped per colour)
      this._bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.27, metalness: 0.04, envMapIntensity: 1.15 });
      this._armMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.04, envMapIntensity: 1.0 });
      this._lidMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.04, envMapIntensity: 1.0 });
      const P = profile();
      const body = new THREE.Mesh(new THREE.LatheGeometry(P, 36, Math.PI, TAU), this._bodyMat);
      body.position.y = BODY_Y; body.castShadow = true; body.receiveShadow = false;
      model.add(body); this._body = body;

      // face decal: a thin lathe strip over the belly band
      const fpts = [];
      for (let k = 0; k <= 12; k++) { const y = FACE.y0 + (k / 12) * (FACE.y1 - FACE.y0); fpts.push(new THREE.Vector2(rAt(y) * 1.006 + 0.0006, y)); }
      this._faceTex = G.gfx.canvasTexture(512, 256, (ctx) => paintFace(ctx, 'happy', false));
      this._faceTex.anisotropy = 4;
      // the face glows faintly (more at night) so the spirit stays readable in the dark
      const faceMat = new THREE.MeshStandardMaterial({ map: this._faceTex, emissive: 0xffffff, emissiveMap: this._faceTex, emissiveIntensity: 0.06, transparent: true, roughness: 0.22, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 1.0 });
      this._faceMat = faceMat;
      const face = new THREE.Mesh(new THREE.LatheGeometry(fpts, 18, -FACE.phi / 2, FACE.phi), faceMat);
      face.position.y = BODY_Y; face.renderOrder = 2;
      model.add(face); this._face = face;

      // feet
      const fl = new THREE.SphereGeometry(0.06, 14, 10); fl.scale(1.05, 0.55, 1.35); fl.translate(0.088, 0.03, 0.06);
      const fr = new THREE.SphereGeometry(0.06, 14, 10); fr.scale(1.05, 0.55, 1.35); fr.translate(-0.088, 0.03, 0.06);
      const feet = new THREE.Mesh(mergeGeos([fl, fr]), this._armMat); feet.castShadow = true;
      model.add(feet);

      // stubby arms on pivots (character left = +X)
      const armGeo = new THREE.CapsuleGeometry(0.037, 0.075, 4, 10); armGeo.translate(0, -0.072, 0);
      this._armL = new THREE.Group(); this._armL.position.set(0.245, BODY_Y + 0.27, 0.02);
      this._armR = new THREE.Group(); this._armR.position.set(-0.245, BODY_Y + 0.27, 0.02);
      for (const a of [this._armL, this._armR]) { const m = new THREE.Mesh(armGeo, this._armMat); m.castShadow = true; a.add(m); model.add(a); }

      // hats + sprout
      this._hatPivot = new THREE.Group(); this._hatPivot.position.set(0, BODY_Y + TOP_Y - 0.002, 0);
      model.add(this._hatPivot);
      this._hats = this._buildHats();
      for (const g of Object.values(this._hats)) { g.visible = false; this._hatPivot.add(g); }
      this._sprout = this._buildSprout();
      this._hatPivot.add(this._sprout);

      // scarves
      this._scarves = this._buildScarves();
      for (const g of Object.values(this._scarves)) { g.visible = false; model.add(g); }

      // leaf umbrella (rain)
      this._umbrella = this._buildUmbrella();
      this._umbrella.visible = false; this._umbrella.scale.setScalar(0.001);
      model.add(this._umbrella);

      // label anchor
      this._tagAnchor = new THREE.Object3D(); this._tagAnchor.position.set(0, 0.86, 0);
      model.add(this._tagAnchor);

      // blob shadow (always: grounds the hop even without real shadows)
      const shTex = G.gfx.radialTexture(64, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
      this._shadowMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78).rotateX(-Math.PI / 2), this._shadowMat);
      sh.position.y = 0.025; sh.renderOrder = 1;
      root.add(sh); this._shadow = sh;

      // only the body/face/arms are click targets (labels, umbrella & shadow are cosmetic)
      sh.raycast = noRay; this._umbrella.traverse((o) => { if (o.isMesh) o.raycast = noRay; });

      root.visible = false;
      E.scene.add(root);

      // world labels: name tag (clickable) + reaction bubble
      const h = G.ui.h;
      this._tagName = h('span', { class: 'nm', text: DEFAULT_NAME });
      this._tagEl = h('div', { class: 'nametag ong-tag', title: '클릭해서 같이 놀기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏺'), this._tagName);
      this._tag = G.ui.label({ el: this._tagEl, target: this._tagAnchor, offsetY: 0.08, maxDist: 20, fadeDist: 5, onClick: () => { if (!G.ui.isBlocking()) this.openMenu(); } });
      this._tag.setVisible(false);
      this._bubbleText = h('span', { class: 'ong-bubble-t' });
      this._bubbleEl = h('div', { class: 'ong-bubble' }, this._bubbleText);
      this._bubble = G.ui.label({ el: this._bubbleEl, target: this._tagAnchor, offsetY: 0.42, maxDist: 34, fadeDist: 6 });
      this._bubble.setVisible(false);

      this._applyOutfit(true);
      this._built = true;
    },

    _buildSprout() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6cc24f, roughness: 0.45, metalness: 0, envMapIntensity: 0.8 });
      const stem = new THREE.CylinderGeometry(0.0085, 0.011, 0.075, 7); stem.translate(0, 0.037, 0);
      const l1 = new THREE.SphereGeometry(0.042, 12, 8); l1.scale(1, 0.26, 0.6); l1.rotateZ(0.62); l1.translate(-0.038, 0.088, 0);
      const l2 = new THREE.SphereGeometry(0.052, 12, 8); l2.scale(1, 0.26, 0.6); l2.rotateZ(-0.66); l2.translate(0.046, 0.098, 0);
      const m = new THREE.Mesh(mergeGeos([setColors(stem, '#4f9e3d'), setColors(l1, '#8fdc6a'), setColors(l2, '#7bd35b')]), mat);
      mat.vertexColors = true; mat.color.set(0xffffff);
      m.castShadow = true;
      g.add(m);
      return g;
    },

    _buildHats() {
      const hats = {};
      const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
      // lid (with knob)
      const lidPts = [[0.0, 0.072], [0.045, 0.069], [0.09, 0.058], [0.125, 0.04], [0.15, 0.02], [0.162, 0.007], [0.16, -0.003], [0.13, -0.007], [0.0, -0.007]].map(([r, y]) => new THREE.Vector2(r, y));
      const lidGeo = () => {
        const a = new THREE.LatheGeometry(lidPts, 30); a.deleteAttribute('uv');
        const k = new THREE.SphereGeometry(0.032, 14, 10); k.scale(1, 0.62, 1); k.translate(0, 0.078, 0); k.deleteAttribute('uv');
        return mergeGeos([a, k]);
      };
      const lidG = new THREE.Group(); lidG.add(mk(lidGeo(), this._lidMat)); lidG.rotation.set(-0.05, 0, -0.13);
      hats.lid = lidG;
      hats.none = new THREE.Group();
      // straw hat (weave texture)
      const strawTex = G.gfx.canvasTexture(128, 128, (ctx, w) => {
        ctx.fillStyle = '#e9c873'; ctx.fillRect(0, 0, w, w);
        ctx.strokeStyle = 'rgba(150,105,40,0.45)'; ctx.lineWidth = 2;
        for (let i = 0; i < w; i += 8) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, w); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i + 4); ctx.lineTo(w, i + 4); ctx.stroke(); }
      }, { repeat: [6, 2] });
      const strawMat = new THREE.MeshStandardMaterial({ map: strawTex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      const crown = new THREE.LatheGeometry([[0.0, 0.108], [0.05, 0.106], [0.085, 0.092], [0.1, 0.062], [0.106, 0.022], [0.108, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
      const brim = new THREE.CylinderGeometry(0.29, 0.3, 0.012, 40); brim.translate(0, 0.004, 0);
      const strawG = new THREE.Group();
      strawG.add(mk(mergeGeos([crown, brim]), strawMat));
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.1075, 0.111, 0.03, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xd9483f, roughness: 0.55, side: THREE.DoubleSide }));
      ribbon.position.y = 0.025; strawG.add(ribbon);
      strawG.rotation.set(-0.06, 0, -0.1);
      hats.straw = strawG;
      // flower crown (lid + merged flowers with vertex colours)
      const flowers = [];
      const cols = ['#ff8fb3', '#fff4ec', '#c9a5ff', '#ff8fb3', '#fff4ec', '#ffb26b', '#c9a5ff'];
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), tp = new THREE.Vector3();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + 0.3;
        const cx = Math.sin(a) * 0.15, cz = Math.cos(a) * 0.15;
        e.set(0, a, 0); q.setFromEuler(e);
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * TAU;
          const p = new THREE.SphereGeometry(0.018, 8, 6); p.scale(1, 0.5, 1); p.deleteAttribute('uv');
          p.translate(Math.cos(pa) * 0.019, 0, Math.sin(pa) * 0.019);
          p.rotateX(-1.1);
          tp.set(cx, 0.026, cz); m4.compose(tp, q, sc); p.applyMatrix4(m4);
          flowers.push(setColors(p, cols[i]));
        }
        const c = new THREE.SphereGeometry(0.012, 8, 6); c.deleteAttribute('uv'); c.translate(0, 0.004, 0.006); c.rotateX(-1.1);
        tp.set(cx, 0.026, cz); m4.compose(tp, q, sc); c.applyMatrix4(m4);
        flowers.push(setColors(c, '#ffd54a'));
      }
      const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
      const flowerG = new THREE.Group();
      flowerG.add(mk(lidGeo(), this._lidMat));
      flowerG.add(mk(mergeGeos(flowers), flowerMat));
      flowerG.rotation.set(-0.05, 0, -0.13);
      hats.flower = flowerG;
      // gat (black horsehair hat): crown + band + strings; translucent brim
      const black = new THREE.MeshStandardMaterial({ color: 0x161212, roughness: 0.4, metalness: 0.1 });
      const gc = new THREE.CylinderGeometry(0.074, 0.085, 0.13, 26); gc.translate(0, 0.077, 0); gc.deleteAttribute('uv');
      const gb = new THREE.CylinderGeometry(0.088, 0.088, 0.022, 26, 1, true); gb.translate(0, 0.024, 0); gb.deleteAttribute('uv');
      const strs = [];
      for (const s of [-1, 1]) {
        const st = new THREE.CylinderGeometry(0.004, 0.004, 0.26, 5); st.rotateZ(s * 0.32); st.translate(s * 0.13, -0.11, 0.03); st.deleteAttribute('uv');
        strs.push(st);
        const bead = new THREE.SphereGeometry(0.012, 8, 6); bead.translate(s * 0.172, -0.235, 0.03); bead.deleteAttribute('uv');
        strs.push(bead);
      }
      const gatG = new THREE.Group();
      gatG.add(mk(mergeGeos([gc, gb, ...strs]), black));
      const gbrim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.006, 44), new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 0.5, transparent: true, opacity: 0.82, depthWrite: false }));
      gbrim.position.y = 0.01; gatG.add(gbrim);
      gatG.rotation.set(-0.04, 0, -0.07);
      hats.gat = gatG;
      // jobawi (open-top winter cap) with gold trims and a pink tassel
      const jpts = [[0.115, 0.07], [0.14, 0.066], [0.163, 0.046], [0.173, 0.018], [0.171, -0.012], [0.164, -0.045]].map(([r, y]) => new THREE.Vector2(r, y));
      const jobMat = new THREE.MeshStandardMaterial({ color: 0x43285a, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
      const jobG = new THREE.Group();
      jobG.add(mk(new THREE.LatheGeometry(jpts, 30), jobMat));
      const gold = new THREE.MeshStandardMaterial({ color: 0xf4c54a, roughness: 0.3, metalness: 0.6 });
      const t1 = new THREE.TorusGeometry(0.165, 0.006, 6, 34); t1.rotateX(Math.PI / 2); t1.translate(0, -0.044, 0); t1.deleteAttribute('uv');
      const t2 = new THREE.TorusGeometry(0.116, 0.005, 6, 30); t2.rotateX(Math.PI / 2); t2.translate(0, 0.07, 0); t2.deleteAttribute('uv');
      jobG.add(new THREE.Mesh(mergeGeos([t1, t2]), gold));
      const tas = new THREE.SphereGeometry(0.02, 10, 8); tas.translate(0, 0.075, 0.13);
      const tas2 = new THREE.CylinderGeometry(0.005, 0.008, 0.06, 6); tas2.translate(0, 0.04, 0.142);
      const tasM = new THREE.Mesh(mergeGeos([tas, tas2]), new THREE.MeshStandardMaterial({ color: 0xff6f91, roughness: 0.5 }));
      jobG.add(tasM);
      jobG.rotation.set(-0.08, 0, -0.05);
      hats.jobawi = jobG;
      // lotus-leaf hat (domed disc with veins) + a dew drop
      const lotusTex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
        g.addColorStop(0, '#b6ec86'); g.addColorStop(0.65, '#5cb94a'); g.addColorStop(1, '#3a8a35');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
        ctx.strokeStyle = 'rgba(225,255,200,0.55)'; ctx.lineWidth = 2.2;
        for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; ctx.beginPath(); ctx.moveTo(w / 2, w / 2); ctx.lineTo(w / 2 + Math.cos(a) * w / 2, w / 2 + Math.sin(a) * w / 2); ctx.stroke(); }
      });
      const disc = new THREE.CircleGeometry(0.25, 30); disc.rotateX(-Math.PI / 2);
      const dp = disc.attributes.position;
      for (let i = 0; i < dp.count; i++) { const x = dp.getX(i), z = dp.getZ(i), r = Math.hypot(x, z) / 0.25; dp.setY(i, 0.05 * (1 - r * r) - 0.012); }
      disc.computeVertexNormals();
      const lotusG = new THREE.Group();
      lotusG.add(mk(disc, new THREE.MeshStandardMaterial({ map: lotusTex, roughness: 0.5, side: THREE.DoubleSide })));
      const dew = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), new THREE.MeshStandardMaterial({ color: 0xcdeeff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.7 }));
      dew.position.set(0.09, 0.03, 0.06); lotusG.add(dew);
      lotusG.rotation.set(-0.08, 0, -0.16);
      hats.lotus = lotusG;
      return hats;
    },

    _buildScarves() {
      const out = {};
      const ring = () => { const t = new THREE.TorusGeometry(0.142, 0.03, 10, 34); t.rotateX(Math.PI / 2); t.scale(1, 0.8, 1); return t; };
      const tail = () => { const b = new THREE.BoxGeometry(0.065, 0.13, 0.022, 1, 2, 1); b.translate(0, -0.065, 0); b.rotateZ(0.25); b.rotateX(-0.12); b.translate(-0.075, BODY_Y + 0.462, 0.128); return b; };
      const mkScarf = (mat) => {
        const g = new THREE.Group();
        const r = new THREE.Mesh(ring(), mat); r.position.y = BODY_Y + 0.468; r.castShadow = true;
        const tl = new THREE.Mesh(tail(), mat); tl.castShadow = true;
        g.add(r, tl);
        return g;
      };
      out.none = new THREE.Group();
      out.red = mkScarf(new THREE.MeshStandardMaterial({ color: 0xd9443c, roughness: 0.75 }));
      const stripes = G.gfx.canvasTexture(256, 16, (ctx, w, hh) => {
        const c = ['#e5463d', '#ffcf3f', '#46b55a', '#3f8de0', '#ff7fb2'];
        for (let i = 0; i < 20; i++) { ctx.fillStyle = c[i % c.length]; ctx.fillRect((i / 20) * w, 0, w / 20 + 1, hh); }
      });
      out.saekdong = mkScarf(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }));
      const dots = G.gfx.canvasTexture(128, 32, (ctx, w, hh) => {
        ctx.fillStyle = '#ff8db5'; ctx.fillRect(0, 0, w, hh); ctx.fillStyle = '#fff';
        for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc((i + 0.5) / 12 * w, (i % 2 ? 0.3 : 0.7) * hh, 2.6, 0, TAU); ctx.fill(); }
      });
      const heart = mkScarf(new THREE.MeshStandardMaterial({ map: dots, roughness: 0.65 }));
      const hs = new THREE.Shape();
      hs.moveTo(0, -0.03); hs.bezierCurveTo(-0.045, 0.0, -0.03, 0.035, 0, 0.015); hs.bezierCurveTo(0.03, 0.035, 0.045, 0.0, 0, -0.03);
      const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
      const hm = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0xe8344f, roughness: 0.3, metalness: 0.1 }));
      hm.position.set(0, BODY_Y + 0.43, 0.17); hm.rotation.x = -0.25;
      heart.add(hm);
      out.heart = heart;
      return out;
    },

    _buildUmbrella() {
      const g = new THREE.Group();
      const leafTex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
        const gr = ctx.createRadialGradient(w / 2, w / 2, 6, w / 2, w / 2, w / 2);
        gr.addColorStop(0, '#9be46e'); gr.addColorStop(0.7, '#4fae43'); gr.addColorStop(1, '#2f7d32');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, w);
        ctx.strokeStyle = 'rgba(220,255,190,0.6)'; ctx.lineWidth = 2.6;
        for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU; ctx.beginPath(); ctx.moveTo(w / 2, w / 2); ctx.quadraticCurveTo(w / 2 + Math.cos(a + 0.2) * w * 0.25, w / 2 + Math.sin(a + 0.2) * w * 0.25, w / 2 + Math.cos(a) * w / 2, w / 2 + Math.sin(a) * w / 2); ctx.stroke(); }
      });
      const R = 0.36;
      const disc = new THREE.CircleGeometry(R, 32); disc.rotateX(-Math.PI / 2);
      const p = disc.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z) / R; p.setY(i, -0.075 * r * r + 0.012 * Math.sin(Math.atan2(z, x) * 6) * r); }
      disc.computeVertexNormals();
      const canopy = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.9 }));
      canopy.castShadow = true;
      const C = new THREE.Vector3(-0.03, BODY_Y + 0.93, 0.0), Hd = new THREE.Vector3(-0.305, BODY_Y + 0.4, 0.03);
      canopy.position.copy(C); canopy.rotation.z = 0.07;
      const L = C.distanceTo(Hd);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, L, 7), new THREE.MeshStandardMaterial({ color: 0x4f9e3d, roughness: 0.55 }));
      stem.position.copy(C).add(Hd).multiplyScalar(0.5);
      stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.copy(C).sub(Hd).normalize());
      g.add(canopy, stem);
      return g;
    },

    _bodyTexture(colorId) {
      if (this._texCache.has(colorId)) return this._texCache.get(colorId);
      const pal = COLORS[colorId] || COLORS.brown;
      const tex = G.gfx.canvasTexture(256, 256, (ctx, w, hh) => paintBody(ctx, w, hh, pal));
      this._texCache.set(colorId, tex);
      return tex;
    },

    _applyOutfit(force) {
      if (!this._model) return;
      const of = this._outfit();
      const key = `${of.color}|${of.hat}|${of.scarf}`;
      if (!force && key === this._outfitKey) return;
      this._outfitKey = key;
      const pal = COLORS[of.color];
      this._bodyMat.map = this._bodyTexture(of.color); this._bodyMat.needsUpdate = true;
      this._armMat.color.set(pal.mid);
      this._lidMat.color.set(pal.lid);
      for (const [id, g] of Object.entries(this._hats)) g.visible = id === of.hat;
      for (const [id, g] of Object.entries(this._scarves)) g.visible = id === of.scarf;
      const SPROUT_Y = { lid: 0.088, none: -0.012, straw: 0.104, flower: 0.088, gat: 0.14, jobawi: 0.02, lotus: 0.05 };
      const SPROUT_S = { gat: 0.75, straw: 0.9 };
      this._sprout.position.y = SPROUT_Y[of.hat] ?? 0.088;
      this._sprout.scale.setScalar(SPROUT_S[of.hat] || 1);
      const tilt = this._hats[of.hat]?.rotation;
      this._sprout.rotation.set(tilt ? tilt.x : 0, 0, tilt ? tilt.z : 0);
    },

    _paintFace(mood, blink) {
      const key = mood + (blink ? '-b' : '');
      if (key === this._faceKey) return;
      this._faceKey = key;
      const c = this._faceTex.image;
      const ctx = c.getContext('2d');
      paintFace(ctx, mood, blink);
      this._faceTex.needsUpdate = true;
    },

    _updateTag() {
      if (this._tagName) this._tagName.textContent = myName();
    },

    // ------------------------------------------------------------ visibility
    _shouldShow() {
      if (!G.state || G.settings.companion === false) return false;
      const P = G.sys.player;
      return !!(P && P.object && P.object.visible && P.position);
    },
    _setShown(on) {
      this._shown = on;
      this.visible = on;
      if (this.root) this.root.visible = on;
      if (!on) {
        this._tag?.setVisible(false); this._bubble?.setVisible(false); this._tagOn = false;
        this.closeMenu(true);
      } else {
        this._wantSnap = true;
        this._tagOn = null;
        this._body.castShadow = !!G.sys.engine?.renderer?.shadowMap?.enabled;
      }
    },
    _interactable() {
      if (!this._shown || this._menu || G.sys.camera?.mode === 'photo') return false;
      const P = G.sys.player;
      if (!P?.position) return false;
      const dx = this.pos.x - P.position.x, dz = this.pos.z - P.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) return true;
      // only when the player turns toward it: it walks behind, so it never steals the prompt while moving
      const f = (Math.sin(P.rotY) * dx + Math.cos(P.rotY) * dz) / Math.max(1e-4, d);
      return f > 0.45 && (P.speed || 0) < 2.5;
    },

    // ------------------------------------------------------------ per-frame behaviour
    _snapBehind() {
      const P = G.sys.player, pp = P.position;
      const fx = Math.sin(P.rotY), fz = Math.cos(P.rotY);
      let x = pp.x - fx * 1.1 - fz * 1.0, z = pp.z - fz * 1.1 + fx * 1.0;
      if (G.world.isWater(x, z) || G.world.blocked(x, z, 0.24, pp.y)) { x = pp.x - fx * 1.1 + fz * 1.0; z = pp.z - fz * 1.1 - fx * 1.0; }
      if (G.world.isWater(x, z) || G.world.blocked(x, z, 0.24, pp.y)) { x = pp.x - fx * 0.9; z = pp.z - fz * 0.9; }
      if (G.world.isWater(x, z)) { x = pp.x - fx * 0.3; z = pp.z - fz * 0.3; }   // narrow deck / bank: tuck in right behind the player
      this.pos.set(x, 0, z);
      this.groundY = G.world.heightAt(x, z, pp.y + 0.6);
      if (!Number.isFinite(this.groundY)) this.groundY = pp.y;
      this.vel.set(0, 0, 0);
      this._tgt.copy(this.pos);
      this.yaw = P.rotY;
      this._lastPP.copy(pp); this._hasPP = true;
      this._stuck = 0; this._hopPh = 0;
    },

    /** vanish & re-appear next to the player with a little pop */
    _poof(fx = true) {
      if (fx) { try { G.fx?.burst?.(_v.set(this.pos.x, this.groundY + 0.3, this.pos.z), { type: 'dust', count: 10 }); } catch (e) { /* fx optional */ } }
      this._snapBehind();
      this._pop = 0;
      this._poofN = (this._poofN || 0) + 1;
      this._wake();
      if (fx) {
        try { G.fx?.burst?.(_v.set(this.pos.x, this.groundY + 0.3, this.pos.z), { type: 'sparkle', count: 12 }); } catch (e) { /* optional */ }
        this._setMood('surprised', 0.6);
        this._act = null; this._start('dizzy', 0.9);
      }
    },

    _setMood(m, sec) { this._moodOver = m; this._moodUntil = G.time.elapsed + (sec || 1.5); },
    _showBubble(text, sec = 2.5, cls = '') {
      if (!this._bubbleEl) return;
      const key = text + '|' + cls;
      if (key !== this._bubbleKey) {
        this._bubbleKey = key;
        this._bubbleText.textContent = text;
        this._bubbleEl.className = 'wl ong-bubble ' + cls;
        this._bubbleEl.classList.remove('pop'); void this._bubbleEl.offsetWidth; this._bubbleEl.classList.add('pop');
      }
      this._bubbleUntil = G.time.elapsed + sec;
      this._bubble.setVisible(true);
    },

    /** start an action; reactions replace idle actions, celebrations queue up (max 2) */
    _start(type, dur, data) {
      const IDLE = { look: 1, hum: 1, bounce: 1, spin: 1, wave: 1, point: 1, wee: 1, yawn: 1, shiver: 1 };
      const cur = this._act;
      if (cur && !IDLE[cur.type] && !IDLE[type]) { if (this._actQ.length < 2) { this._actQ.push({ type, dur, data }); return true; } return false; }
      if (cur && !IDLE[cur.type] && IDLE[type]) return false;
      this._act = { type, t: 0, dur, data: data || {}, done: false };
      this._wake();
      return true;
    },
    _wake() { if (this._sleeping) { this._sleeping = false; this._hideBubble(); } },
    _hideBubble() { this._bubbleUntil = 0; this._bubbleKey = ''; this._bubble?.setVisible(false); },

    _tick(dt, t) {
      const P = G.sys.player, pp = P.position, W = G.world;
      const reduce = !!G.settings.reduceMotion;
      if (this._wantSnap || !this._hasPP) { this._wantSnap = false; this._snapBehind(); this._pop = 0.35; }

      // teleports / falling far behind / big height jumps -> re-appear next to the player
      const jx = pp.x - this._lastPP.x, jz = pp.z - this._lastPP.z;
      this._lastPP.copy(pp);
      let dPl = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
      if (jx * jx + jz * jz > 36 || dPl > 26 || (Math.abs(this.groundY - pp.y) > 2.2 && dPl < 7)) { this._poof(true); dPl = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z); }

      // player idle tracking (for tips, sleeping, pointing)
      const now = pnow();
      if (Math.hypot(pp.x - this._idleAnchor.x, pp.z - this._idleAnchor.z) > 0.35) { this._idleAnchor.copy(pp); this._playerIdleSince = now; }
      const playerIdle = (now - this._playerIdleSince) / 1000;
      const pSpeed = Math.hypot(P.velocity?.x || 0, P.velocity?.z || 0);
      const playerMoving = pSpeed > 0.4 || !!P.isWalking;

      // ---- follow target: ~1.6 m behind-right (other side / straight behind when blocked)
      const fx = Math.sin(P.rotY), fz = Math.cos(P.rotY), rgx = -fz, rgz = fx;
      // pointing is an idle beat: the moment the player sets off (up to 18 m/s) 옹이 drops it and follows
      if (this._act?.type === 'point' && (pSpeed > 2.5 || dPl > 3.6)) this._act.t = Math.max(this._act.t, this._act.dur);
      const frozen = !!this._menu || (this._act && (this._act.type === 'pet' || (this._act.type === 'point' && this._act.t < this._act.dur)));
      this._sideT -= dt;
      if (this._sideT <= 0) {
        this._sideT = 0.3;
        const test = (s) => { const x = pp.x - fx * 1.15 + rgx * 1.1 * s, z = pp.z - fz * 1.15 + rgz * 1.1 * s; return !W.isWater(x, z) && !W.blocked(x, z, 0.24, pp.y); };
        if (!test(this._side)) this._side = test(-this._side) ? -this._side : 0;
        else if (this._side === 0 && test(1)) this._side = 1;
      }
      let tx, tz;
      if (frozen || this._sleeping || (!playerMoving && dPl > 0.85 && dPl < 2.9)) { tx = this.pos.x; tz = this.pos.z; }
      else if (this._side === 0) { tx = pp.x - fx * 1.25; tz = pp.z - fz * 1.25; }
      else { tx = pp.x - fx * 1.15 + rgx * 1.1 * this._side; tz = pp.z - fz * 1.15 + rgz * 1.1 * this._side; }
      const kT = damp(6, dt);
      this._tgt.x += (tx - this._tgt.x) * kT; this._tgt.z += (tz - this._tgt.z) * kT;

      // ---- arrive steering (phase 4: the player runs 18 m/s — 옹이 accelerates with the player's pace and
      //      bounds after them in long catch-up hops; far behind for a moment → a puff and it pops up next to them)
      const dx = this._tgt.x - this.pos.x, dz = this._tgt.z - this.pos.z, dist = Math.hypot(dx, dz);
      const RUN = Number(P.RUN) || 18;
      let maxS = Math.max(3.4, pSpeed * 1.16 + 0.6);
      if (dPl > 4.5) maxS += Math.min(14, (dPl - 4.5) * 1.7);
      maxS = Math.min(maxS, RUN * 1.6);
      const wantS = dist < 0.06 ? 0 : maxS * Math.min(1, dist / 1.1);
      const dvx = (dist > 1e-4 ? (dx / dist) * wantS : 0) - this.vel.x, dvz = (dist > 1e-4 ? (dz / dist) * wantS : 0) - this.vel.z;
      const maxDv = (16 + Math.min(pSpeed, RUN) * 3.4) * dt, dvl = Math.hypot(dvx, dvz), kk = dvl > maxDv ? maxDv / dvl : 1;
      this.vel.x += dvx * kk; this.vel.z += dvz * kk;
      // lagging far behind for a while (blocked path, huge sprint) → catch-up puff
      this._lagT = dPl > 13 ? (this._lagT || 0) + dt : 0;
      if (this._lagT > 0.9 && !frozen) { this._lagT = 0; this._poof(true); dPl = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z); }

      // ---- integrate with light collision (no own collider; never enters water / climbs walls), sub-stepped
      //      like the player (≤ 0.3 m per step) so a fast catch-up never tunnels through a fence
      const ox = this.pos.x, oz = this.pos.z;
      const v2 = this.vel.x * this.vel.x + this.vel.z * this.vel.z;
      if (v2 > 1e-6) {
        const steps = Math.min(8, Math.max(1, Math.ceil((Math.sqrt(v2) * dt) / 0.3)));
        const sdt = dt / steps;
        let blocked = false;
        for (let i = 0; i < steps; i++) {
          _tmp.set(this.pos.x + this.vel.x * sdt, this.groundY, this.pos.z + this.vel.z * sdt);
          W.resolve(_tmp, 0.24, this.groundY);
          W.clampToBounds(_tmp);
          const gy = W.heightAt(_tmp.x, _tmp.z, this.groundY + 0.5);
          if (W.isWater(_tmp.x, _tmp.z) || !Number.isFinite(gy) || gy - this.groundY > 0.75) { this.vel.multiplyScalar(0.4); blocked = true; break; }
          this.pos.x = _tmp.x; this.pos.z = _tmp.z;
          if (gy < this.groundY) this.groundY = Math.max(gy, this.groundY - 0.75);
        }
        this._stuck = blocked ? this._stuck + dt : Math.max(0, this._stuck - dt * 0.5);
      }
      // personal space: never stand inside the player
      const sx = this.pos.x - pp.x, sz = this.pos.z - pp.z, sd = Math.hypot(sx, sz);
      if (sd < 0.72 && Math.abs(this.groundY - pp.y) < 1) {
        const nx = sd > 1e-3 ? sx / sd : -fx, nz = sd > 1e-3 ? sz / sd : -fz, push = (0.72 - sd) * Math.min(1, dt * 12);
        if (!W.isWater(this.pos.x + nx * push, this.pos.z + nz * push)) { this.pos.x += nx * push; this.pos.z += nz * push; }
      }
      if (this._stuck > 2 && dPl > 3.2) this._poof(true);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this.speed = lerp(this.speed, dt > 0 ? moved / dt : 0, damp(10, dt));
      const gyNow = W.heightAt(this.pos.x, this.pos.z, this.groundY + 0.5);
      if (Number.isFinite(gyNow)) this.groundY += (gyNow - this.groundY) * damp(16, dt);

      // ---- night sleep (player idle, nothing going on)
      const night = (G.world.nightFactor || 0) > 0.6;
      const settled = this.speed < 0.2 && !this._act && !this._menu;
      if (!this._sleeping && night && settled && playerIdle > 6 && !this._yawned && !reduce && !this._photo && !G.sys.dialogue?.active) { this._yawned = true; this._start('yawn', 1.7); }
      if (!this._sleeping && night && settled && playerIdle > 8 && !this._photo && !G.sys.dialogue?.active) { this._sleeping = true; this._showBubble('Z z z', 9999, 'zz'); }
      if (playerIdle < 1) this._yawned = false;
      if (this._sleeping && !this._restNap && (!night || playerMoving || this._menu || playerIdle < 1)) {
        this._wake(); this._setMood('surprised', 0.7); this._start('bounce', 0.5);
      }

      // ---- idle behaviours
      if (settled && !this._sleeping) {
        this._idleT += dt;
        if (this._idleT > this._nextIdle) {
          this._idleT = 0; this._nextIdle = 5 + Math.random() * 6;
          const f = pointTarget();
          if (f && playerIdle > 3 && G.time.elapsed > this._nextPointT && distTo(f.x, f.z) > 6) this._startPoint(f);
          else if (!reduce) {
            const r = Math.random();
            const wid = G.sys.weather?.current;
            if ((wid === 'SNOW' || wid?.id === 'SNOW') && r < 0.35) this._start('shiver', 1.4);
            else this._start(r < 0.3 ? 'look' : r < 0.5 ? 'hum' : r < 0.7 ? 'bounce' : r < 0.85 ? 'spin' : 'wave', r < 0.3 ? 2.6 : r < 0.5 ? 3 : r < 0.7 ? 0.9 : r < 0.85 ? 0.85 : 1.6);
          }
        }
      } else this._idleT = 0;

      // ---- action layer
      let extraH = 0, spin = 0, wiggle = 0, lean = 0, faceYaw = null, lookOff = 0;
      let armL = null, armR = null, moodA = null, fwdL = 0, fwdR = 0;
      const a = this._act;
      if (a) {
        a.t += dt;
        const k = clamp(a.t / a.dur, 0, 1);
        switch (a.type) {
          case 'jump': {
            extraH = 4 * 0.42 * k * (1 - k); spin = reduce ? 0 : TAU * U.smoothstep(0.1, 0.85, k);
            armL = armR = 2.3; moodA = 'cheer';
            if (k >= 1 && !a.done) { a.done = true; this._sqv -= 3; this._burst('sparkle', 16); }
            break;
          }
          case 'spin': extraH = 4 * 0.16 * k * (1 - k); spin = TAU * U.smoothstep(0, 1, k); armL = armR = 1.2; if (k >= 1 && !a.done) { a.done = true; this._sqv -= 1.8; } break;
          case 'bounce': { const ph = (k * 2) % 1; extraH = 4 * 0.12 * ph * (1 - ph); if (ph < 0.1 && a.t > 0.1 && !a.landed) { a.landed = true; this._sqv -= 1.6; } if (ph > 0.5) a.landed = false; break; }
          case 'look': lookOff = Math.sin(k * TAU) * 0.75; moodA = 'think'; break;
          case 'hum': wiggle = Math.sin(a.t * 6) * 0.1; if (!a.b) { a.b = true; this._showBubble('♪', a.dur, 'note'); } break;
          case 'wave': armL = 2.4 + Math.sin(a.t * 14) * 0.35; moodA = 'wink'; faceYaw = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z); break;
          case 'pet': {
            wiggle = Math.sin(a.t * 18) * 0.13 * (1 - k); armL = armR = 2.2 + Math.sin(a.t * 16) * 0.3; moodA = 'cheer';
            faceYaw = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z); extraH = 4 * 0.06 * ((a.t * 2.2) % 1) * (1 - ((a.t * 2.2) % 1));
            break;
          }
          case 'point': {
            const tg = a.data;
            faceYaw = Math.atan2(tg.x - this.pos.x, tg.z - this.pos.z);
            if (k > 0.15) { armL = -1; moodA = 'happy'; } else moodA = 'think';
            break;
          }
          case 'celebrate': {
            const ph = (k * 3) % 1; extraH = 4 * 0.14 * ph * (1 - ph); armL = armR = 2.3 + Math.sin(a.t * 12) * 0.25; moodA = 'cheer';
            if (k >= 1 && !a.done) { a.done = true; this._burst('stars', 8); }
            break;
          }
          case 'wee': {   // sprinting along: arms up, a little hop, "💨"
            armL = armR = 2.5; moodA = 'cheer'; extraH = 4 * 0.1 * k * (1 - k);
            if (!a.b) { a.b = true; this._showBubble('💨', a.dur, 'note'); }
            break;
          }
          case 'dance': {  // the player dances: bob, sway and pump the arms in turn
            const ph = (a.t * 2.4) % 1; extraH = 4 * 0.09 * ph * (1 - ph);
            wiggle = Math.sin(a.t * 4.8) * 0.16; spin = reduce ? 0 : Math.sin(a.t * 2.4) * 0.6;
            armL = 1.5 + Math.sin(a.t * 9.6) * 0.9; armR = 1.5 - Math.sin(a.t * 9.6) * 0.9; moodA = 'cheer';
            if (!a.b) { a.b = true; this._showBubble('♪', a.dur, 'note'); }
            break;
          }
          case 'clap': {   // a quest done: claps in front of the belly
            armL = armR = 0.9; fwdL = fwdR = -1.15 - Math.abs(Math.sin(a.t * 13)) * 0.35; moodA = 'cheer';
            extraH = 4 * 0.05 * ((a.t * 2.6) % 1) * (1 - ((a.t * 2.6) % 1));
            faceYaw = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
            break;
          }
          case 'dizzy': {  // popped out of a puff: a wobble that settles
            wiggle = Math.sin(a.t * 10) * 0.14 * (1 - k); spin = reduce ? 0 : Math.sin(a.t * 6) * 0.35 * (1 - k); moodA = 'surprised';
            break;
          }
          case 'shiver': { // snow: tiny shivers (a jitter, not a flash)
            wiggle = Math.sin(a.t * 26) * 0.035; armL = armR = 0.25; fwdL = fwdR = -0.6; moodA = 'sad';
            break;
          }
          case 'yawn': {   // sleepy at night: a big stretch before dozing off
            const s2 = Math.sin(Math.min(1, k) * Math.PI); armL = armR = 0.4 + 2.1 * s2; moodA = 'sleepy'; extraH = 0.02 * s2;
            if (!a.b) { a.b = true; this._showBubble('🥱', a.dur, 'zz'); }
            break;
          }
          default: break;
        }
        if (a.t >= a.dur) {
          if (a.type === 'point' && this._bubbleUntil > 0) this._bubbleUntil = Math.min(this._bubbleUntil, G.time.elapsed + 0.4);
          this._act = this._actQ.length ? Object.assign(this._actQ.shift(), { t: 0, done: false }) : null;
          if (this._act && !this._act.data) this._act.data = {};
        }
      }

      // ---- hop + squash & stretch: at sprint pace the hops get longer and higher (a bounding chase, ≤ 4.4 hops/s)
      const moving = this.speed > 0.35;
      const rate = clamp(this.speed / 1.1, 1.9, 4.4);
      if (moving || this._hopPh > 0) {
        this._hopPh += dt * (moving ? rate : Math.max(rate, 2.6));
        if (this._hopPh >= 1) {
          this._hopPh = moving ? this._hopPh - 1 : 0;
          this._sqv -= 2.4 + Math.min(this.speed, 18) * 0.07;
          // dust puff on the landings of a fast chase (G.fx thins / drops it for fxLevel low / off)
          if (this.speed > 7 && !reduce) this._burst('dust', this.speed > 12 ? 3 : 2);
        }
      }
      const hopLen = this.speed / rate;
      const hopH = reduce ? 0.03 : clamp(0.07 + hopLen * 0.11, 0.07, 0.55);
      const ph = this._hopPh;
      const hopY = 4 * hopH * ph * (1 - ph) + extraH;
      // sprint pose: lean into the run, a happy "wee!" now and then on a long sprint
      const dash = U.smoothstep(6, 14, this.speed);
      if (dash > 0.3 && !this._act && !reduce) {
        this._dashT = (this._dashT || 0) + dt;
        if (this._dashT > 2.2 && G.time.elapsed > (this._weeAt || 0)) { this._weeAt = G.time.elapsed + 14 + Math.random() * 10; this._start('wee', 1.1); }
      } else this._dashT = 0;
      // squash spring: fixed sub-steps keep it stable at any frame rate (dt is capped at 0.1 s by the loop)
      for (let n = Math.min(14, Math.ceil(dt / (1 / 120))), h = dt / n, i = 0; i < n; i++) {
        this._sqv += (-260 * this._sq - 13 * this._sqv) * h;
        this._sq += this._sqv * h;
      }
      if (!Number.isFinite(this._sq) || Math.abs(this._sq) > 1) { this._sq = 0; this._sqv = 0; }
      const air = ph > 0 && ph < 1 ? 0.11 * Math.abs(1 - 2 * ph) * U.smoothstep(0, 0.16, Math.min(ph, 1 - ph)) : 0;
      const breath = this._sleeping ? Math.sin(t * 1.6) * 0.035 : moving ? 0 : Math.sin(t * 2.3) * 0.012;
      const sy = clamp(1 + this._sq + air + breath, 0.72, 1.3), sxz = 1 / Math.sqrt(sy);
      if (this._sleeping) lean = 0.14;
      else if (dash > 0) lean = Math.max(lean, 0.24 * dash);

      // ---- facing
      let want;
      if (faceYaw != null) want = faceYaw;
      else if (this._menu) want = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
      else if (this._photo && !moving) { const cp = G.sys.engine.camera.position; want = Math.atan2(cp.x - this.pos.x, cp.z - this.pos.z); }
      else if (moving) want = Math.atan2(this.vel.x, this.vel.z);
      else {
        // idle: watch the NPC during a conversation, otherwise keep an eye on the player (with a little slack)
        const dl = G.sys.dialogue?.active;
        const npc = dl?.npcId ? G.sys.npc?.get?.(dl.npcId)?.group?.position : null;
        if (npc) want = Math.atan2(npc.x - this.pos.x, npc.z - this.pos.z);
        else {
          const toP = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
          const off = Math.abs(U.angleDiff(this.yaw, toP + lookOff));
          this._faceP = off > 0.08 && (this._faceP || off > 0.55);   // hysteresis: start turning past ~30°, stop when aligned
          want = this._faceP ? toP : this.yaw - lookOff;
        }
        want += lookOff;
      }
      this.yaw = U.angleLerp(this.yaw, want, damp(moving ? 10 : 6, dt));

      // ---- arms
      const tArm = G.time.elapsed;
      let aL = 0.42 + Math.sin(tArm * 2.1) * 0.04, aR = -0.42 - Math.sin(tArm * 2.1 + 1) * 0.04, pxL = 0;
      if (moving) { const sw = Math.sin(ph * TAU) * 0.45; aL = 0.55 + Math.max(0, sw); aR = -0.55 - Math.max(0, -sw); }
      if (this._sleeping) { aL = 0.2; aR = -0.2; }
      // umbrella in rain (right arm holds it)
      const rain = (G.sys.weather?.precipitation?.rain || 0) > 0.12 || (G.sys.weather?.current === 'RAIN' && (G.sys.weather?.mix?.RAIN || 0) > 0.4);
      this._umb += ((rain ? 1 : 0) - this._umb) * damp(rain ? 4 : 6, dt);
      const umbOn = this._umb > 0.02;
      if (umbOn !== this._umbrella.visible) this._umbrella.visible = umbOn;
      if (umbOn) {
        const e = this._umb, s = e < 0.999 ? Math.max(0.001, e * (1 + 0.25 * Math.sin(e * Math.PI))) : 1;
        this._umbrella.scale.setScalar(s);
        this._umbrella.rotation.z = Math.sin(tArm * 1.7) * 0.03;
        aR = lerp(aR, -2.68, e);
      }
      if (armL != null) aL = armL === -1 ? 0.2 : armL;
      if (armL === -1) pxL = -1.35;
      else if (fwdL) pxL = fwdL;
      if (armR != null && !umbOn) aR = -armR;
      // the sprint pose swings both arms back (a stubby "superhero" dash)
      if (dash > 0 && armL == null && !this._sleeping) { pxL = Math.min(pxL, 0) + 0.9 * dash; }
      const pxR = umbOn ? 0 : fwdR ? fwdR : (dash > 0 && armR == null ? 0.9 * dash : 0);
      this._armL.rotation.z += (aL - this._armL.rotation.z) * damp(14, dt);
      this._armR.rotation.z += (aR - this._armR.rotation.z) * damp(14, dt);
      this._armL.rotation.x += (pxL - this._armL.rotation.x) * damp(12, dt);
      this._armR.rotation.x += (pxR - this._armR.rotation.x) * damp(12, dt);
      // sprout sways with motion
      this._sprout.rotation.z = (this._hats[this._outfit().hat]?.rotation.z || 0) + Math.sin(tArm * 3.1) * 0.07 + (moving ? Math.sin(ph * TAU) * 0.18 : 0);

      // ---- mood / face
      let mood = this._sleeping ? 'sleepy' : 'happy';
      if (moodA) mood = moodA;
      if (this._moodOver && G.time.elapsed < this._moodUntil) mood = this._moodOver;
      else this._moodOver = null;
      if (this._menu && !moodA) mood = 'happy';
      this._blinkT -= dt;
      if (this._blinkT <= 0) { this._blinkOn = 0.13; this._blinkT = 2.4 + Math.random() * 3.6; }
      if (this._blinkOn > 0) this._blinkOn -= dt;
      this._paintFace(mood, this._blinkOn > 0);
      this._mood = mood;

      // ---- apply transforms
      if (this._pop < 1) this._pop = Math.min(1, this._pop + dt / 0.45);
      const pk = this._pop < 1 ? 1 - Math.pow(1 - this._pop, 3) * Math.cos(this._pop * 5) : 1;
      this.root.position.set(this.pos.x, this.groundY, this.pos.z);
      this.root.rotation.y = this.yaw;
      this._hop.position.y = hopY;
      this._hop.rotation.y = spin;
      this._squash.scale.set(sxz, sy, sxz);
      this._squash.rotation.z += (wiggle - this._squash.rotation.z) * damp(20, dt);
      this._squash.rotation.x += (lean - this._squash.rotation.x) * damp(4, dt);
      this._model.scale.setScalar(S * Math.max(0.001, pk));
      const hs = clamp(1 - hopY * 1.6, 0.45, 1);
      this._shadow.scale.setScalar(hs * Math.max(0.001, pk));
      this._shadowMat.opacity = (G.sys.engine?.renderer?.shadowMap?.enabled ? 0.32 : 0.5) * hs;

      this._faceMat.emissiveIntensity = 0.06 + (G.world.nightFactor || 0) * 0.42;

      // ---- labels
      const tagOn = !this._menu && dPl < 16;
      if (tagOn !== this._tagOn) { this._tagOn = tagOn; this._tag.setVisible(tagOn); }
      if (this._bubbleUntil > 0 && G.time.elapsed > this._bubbleUntil) this._hideBubble();
    },

    _startPoint(tg) {
      this._nextPointT = G.time.elapsed + 22 + Math.random() * 12;
      const d = Math.round(distTo(tg.x, tg.z));
      // children cannot read metres: just "over there!"
      const txt = kidOn() ? '👉 저기예요!' : `👉 ${tg.label ? cleanText(tg.label, 18) + ' ' : ''}${d}m`;
      if (this._start('point', 3.2, { x: tg.x, z: tg.z })) this._showBubble(txt, 3.2, 'point');
    },

    _burst(type, count) {
      try { G.fx?.burst?.(_v.set(this.pos.x, this.groundY + 0.25, this.pos.z), { type, count, spread: 0.6 }); } catch (e) { /* fx optional */ }
    },

    /** react to game events: 'celebrate' | 'jump' | 'bounce' | 'cheer' | 'wink' */
    react(kind = 'jump', opts = {}) {
      if (!this._shown) return false;
      if (kind === 'jump') this._start('jump', 0.9);
      else if (kind === 'celebrate') this._start('celebrate', 1.4);
      else if (kind === 'bounce') this._start('bounce', 0.9);
      else if (MOOD_SET.has(kind)) this._setMood(kind, 1.6);
      if (opts.bubble) this._showBubble(cleanText(opts.bubble, 24), clamp(Number(opts.bubbleSec) || 2.2, 0.5, 10), /^[a-z-]{1,20}$/.test(opts.cls || '') ? opts.cls : '');
      return true;
    },

    _onSay(item) {
      if (!this._shown) return;
      this._setMood(item.mood, Math.min(4, item.duration / 1000));
      if (!this._act && !this._sleeping) this._start('bounce', 0.5);
      this._wake();
    },

    // ------------------------------------------------------------ affection
    _today() { const d = new Date(G.time.now()); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; },
    _addAffection(n, src) {
      const c = G.state?.companion;
      if (!c || !(n > 0)) return 0;
      const before = c.affection;
      c.affection = clamp(Math.round(c.affection + n), 0, 100);
      if (c.affection !== before) {
        G.dirty('companion');
        for (const m of AFFECTION_MILESTONES) {
          if (before < m && c.affection >= m && !c.milestones.includes(m)) {
            c.milestones.push(m);
            const unlocked = this._unlockNames((rule) => rule.affection === m);
            this._later(() => {
              this.react('celebrate');
              const kid = kidOn();
              say(kid ? (unlocked.length ? '우리 더 친해졌어요! 💗 새 옷이 생겼어요! 👒' : '우리 더 친해졌어요! 💗')
                : unlocked.length ? `우리 사이가 더 가까워졌어요! 💗 ${unlocked.join(', ')}${josa(unlocked[unlocked.length - 1].slice(-1), '을/를').slice(1)} 입을 수 있어요!` : `애정도 ${m} 달성! ${nick()}님이 최고예요 💗`,
              { mood: 'cheer', priority: true, action: unlocked.length ? { label: kid ? '👒 옷 입히기' : '옷장 열기', fn: () => this.openWardrobe() } : null, source: 'affection' });
            }, 900);
          }
        }
      }
      return c.affection - before;
    },
    _unlockNames(test) {
      const out = [];
      for (const slot of Object.values(SLOTS)) for (const it of Object.values(slot)) if (it.unlock && test(it.unlock)) out.push(it.name);
      return out;
    },
    _later(fn, ms) {
      const id = setTimeout(() => { this._timers.delete(id); try { fn(); } catch (e) { G.log.error('UI', 'companion timer', e); } }, ms);
      this._timers.add(id);
      return id;
    },

    // ------------------------------------------------------------ actions (menu)
    pet() {
      const c = G.state?.companion;
      if (!c || !this._shown) return false;
      const now = pnow();
      if (now - (this._lastPet || 0) < 900) return false;
      this._lastPet = now;
      this._start('pet', 1.3);
      this._showBubble('💕', 1.6, 'heart');
      this._burst('hearts', 9);
      G.sfx('emote');
      c.pets = (c.pets || 0) + 1;
      const day = this._today();
      if (c.affDay !== day) { c.affDay = day; c.affToday = 0; }
      let gained = 0;
      if (c.affToday < 30) { gained = this._addAffection(2, 'pet'); c.affToday += 2; }
      G.dirty('companion');
      if (!gained && c.affToday >= 30 && !this._capSaid) { this._capSaid = true; say('오늘은 정말 충분히 행복해요! 내일 또 쓰다듬어 주세요 💤💕', { mood: 'sleepy', source: 'pet' }); }
      else if (Math.random() < 0.45) say(U.pick(PET_LINES).replace('{nick}', nick()), { mood: 'cheer', source: 'pet' });
      G.activity?.('companion', `${myName()} 쓰다듬기`);
      return true;
    },

    talk() {
      if (kidOn()) {
        // urgent things first (gift / ripe jar / crops), otherwise "what next?" with the pointing hand
        const top = candidates()[0];
        if (top && top.prio >= 75) say(top.text, { mood: top.mood, action: top.action, stepAction: !!top.stepAction, force: true, priority: true, source: 'hint' });
        else this._kidNudge(true);
        return;
      }
      const hnt = hint({ detail: true });
      say(hnt.text, { mood: hnt.mood, action: hnt.action, force: true, priority: true, source: 'hint' });
      if (this._shown) {
        const f = pointTarget();
        if (f && hnt.key.startsWith('obj:') && distTo(f.x, f.z) > 6) this._startPoint(f);
      }
    },

    // ------------------------------------------------------------ 쉬운 모드 voice guide
    _stopNudgeHand() { try { this._nudgeHand?.stop?.(); } catch (e) { /* easy optional */ } this._nudgeHand = null; },
    /** "다음 할 일" from G.easy.nextStep(): a spoken card + the big 👆 at the target (or at 👉 같이 가기) */
    _kidNudge(fromTalk, idx = 0) {
      let st = null;
      try { st = G.easy?.nextStep?.(); } catch (e) { st = null; }
      if (!st) return false;
      const n = idx;
      let text, mood = 'think', action = null, ptr = null, label = '';
      if (st.key === 'explore') {
        text = n >= 2 ? '심심해요? 🗺️ 새로운 곳에 가 봐요!' : '🗺️ 어디로 가 볼까요? 지도를 눌러요!';
        mood = 'wink';
        action = { label: '🗺️ 어디 갈까?', fn: () => G.ui.triggerAction?.('where') };
        ptr = '#easy-where'; label = '눌러요!';
      } else if (String(st.key).startsWith('claim:')) {
        text = '🎁 선물이 기다려요! 받아 볼까요?'; mood = 'cheer';
        action = kidStepAction(st);
      } else {
        text = fromTalk || n === 0 ? `${st.emoji} ${st.text}! 제가 알려 줄게요.` : n === 1 ? `👆 손가락을 봐요! ${st.text}!` : `${st.emoji} 같이 해 봐요! ${st.text}!`;
        action = kidStepAction(st);
      }
      // where the hand goes: a nearby world target, else the HUD's big 👉 button
      if (!ptr) {
        const go = document.querySelector('#easy-next .en-go');
        const goVisible = !!(go && !go.hidden && go.offsetParent !== null);
        const td = st.target ? distTo(st.target.x, st.target.z) : Infinity;
        if (td <= 26) { ptr = { x: st.target.x, z: st.target.z }; label = td <= 8 ? '여기예요!' : '저기예요!'; }
        else if (goVisible) { ptr = go; label = '눌러요!'; }
      }
      const shown = say(text, { mood, action, stepAction: true, priority: true, force: true, ttl: 15000, source: 'nudge' });
      if (ptr && G.easy?.point) {
        this._stopNudgeHand();
        try { this._nudgeHand = G.easy.point(ptr, { label, duration: 7000 }); } catch (e) { this._nudgeHand = null; }
      }
      if (st.target && this._shown && distTo(st.target.x, st.target.z) > 6) this._startPoint(st.target);
      else if (this._shown) this._start('wave', 1.6);
      return shown;
    },
    /** idle ≥ 20 s in easy mode (no walking, no taps) → nudge at 20 s, 45 s, 90 s, then stay quiet until the child plays */
    _kidIdleTick() {
      const since = Math.max(this._playerIdleSince, this._lastInputAt || 0);
      if (since !== this._nudgeFor) { this._nudgeFor = since; this._nudgeN = 0; }
      if (this._nudgeN >= 3) return false;
      const idle = (pnow() - since) / 1000;
      if (idle < [20, 45, 90][this._nudgeN]) return false;
      if (this._quiet() || Say.cur || Say.q.length || G.ui.isBlocking?.() || G.sys.player?.isWalking) return false;
      try { if (G.easy?.speaking) return false; } catch (e) { /* easy optional */ }
      if (document.querySelector('#easy-layer .easy-hand, .coach-layer .coach')) return false;   // someone is already pointing
      const idx = this._nudgeN++;
      this._lastTipAt = pnow();
      return this._kidNudge(false, idx);
    },
    /** 08-easy shows the healthy-play card / rest screen; 옹이 acts it out (sleepy → nap → cheer) */
    _watchRest() {
      const L = document.getElementById('easy-layer');
      const state = !L ? '' : L.querySelector('.easy-rest:not(.out)') ? 'rest' : L.querySelector('.easy-rest-card:not(.out)') ? 'card' : '';
      const prev = this._restSeen;
      if (state === 'rest' && this._shown && !this._sleeping) { this._sleeping = true; this._showBubble('Z z z', 9999, 'zz'); }
      if (state === prev) return;
      this._restSeen = state;
      if (state === 'card') {
        Say.hide('rest');
        this._stopNudgeHand();
        if (this._shown) { this._setMood('sleepy', 6); this._showBubble('😴 하암~', 3.5, 'zz'); }
      } else if (state === 'rest') {
        Say.hide('rest');
        this._stopNudgeHand();
        this._restNap = true;
      } else {
        const napped = this._restNap;
        this._restNap = false;
        if (napped) {
          this._wake();
          this._lastInputAt = pnow();
          if (this._shown) { this._setMood('cheer', 2); this.react('jump'); }
          if (G.settings.companion !== false) this._later(() => say('푹 쉬었어요? 다시 신나게 놀아요! 🌿', { mood: 'cheer', priority: true, source: 'rest' }), 700);
        } else if (prev === 'card' && this._shown) this._setMood('cheer', 1.5);
      }
    },

    setOutfit(o) {
      const c = G.state?.companion;
      if (!c) return false;
      const next = normOutfit(Object.assign({}, c.outfit, o || {}));
      for (const slot of Object.keys(SLOTS)) if (!isUnlocked(slot, next[slot])) next[slot] = c.outfit[slot];
      c.outfit = next;
      G.dirty('companion');
      this._applyOutfit();
      return true;
    },

    setName(raw) {
      const c = G.state?.companion;
      if (!c) return { ok: false, msg: '로그인 후 바꿀 수 있어요.' };
      const v = validName(raw);
      if (!v.ok) return v;
      c.name = v.name;
      G.dirty('companion');
      this._updateTag();
      return v;
    },

    // ------------------------------------------------------------ radial menu
    toggleMenu() { if (this._menu) this.closeMenu(); else this.openMenu(); },
    openMenu() {
      if (this._menu || !G.state) return false;
      if (!this._shown) { G.ui.toast(kidT('설정에서 ‘동반자 옹이’를 켜면 함께 놀 수 있어요 🏺', '옹이가 쉬고 있어요. 어른에게 켜 달라고 해요 🏺'), { type: 'info', emoji: '🏺' }); return false; }
      if (G.ui.modal.isOpen() || G.sys.dialogue?.active) return false;
      if (kidOn() && G.easy?.pick) return this._openKidMenu();
      if (G.util.isTyping()) document.activeElement?.blur?.();
      Say.hide('menu');
      const h = G.ui.h;
      const c = G.state.companion;
      const name = myName();
      const ITEMS = [
        { key: 'pet', emoji: '🤲', label: '쓰다듬기', fn: () => this.pet() },
        { key: 'talk', emoji: '💬', label: '한마디', fn: () => this.talk() },
        { key: 'dress', emoji: '👒', label: '옷 갈아입히기', fn: () => this.openWardrobe() },
        { key: 'rename', emoji: '✏️', label: '이름 바꾸기', fn: () => this.openRename() },
      ];
      const back = h('div', { class: 'ong-radial-back' });
      const wrap = h('div', { class: 'ong-radial', role: 'dialog', 'aria-label': `${josa(name, '과/와')} 놀기` });
      const hearts = Math.round(affection() / 20);
      const pill = h('div', { class: 'ong-rad-pill' },
        h('b', { text: name }),
        h('span', { class: 'ong-rad-hearts', title: `애정도 ${affection()}/100`, 'aria-label': `애정도 ${affection()}/100` }, '❤️'.repeat(hearts) + '🤍'.repeat(5 - hearts)));
      const center = h('button', { class: 'ong-rad-center', type: 'button', 'aria-label': '메뉴 닫기', title: '닫기 (Esc)', html: mascotSvg('happy', 84, { outfit: 'current', bob: true }) });
      center.addEventListener('click', () => this.closeMenu());
      wrap.append(pill, center);
      ITEMS.forEach((it, i) => {
        const b = h('button', { class: 'ong-rad-item', type: 'button', dataset: { key: it.key } },
          h('span', { class: 'ong-rad-ico emoji', 'aria-hidden': 'true' }, it.emoji),
          h('span', { class: 'ong-rad-lbl', text: it.label }),
          G.input?.touchUI ? null : h('kbd', { class: 'ong-rad-kbd' }, String(i + 1)));
        b.style.setProperty('--i', String(i));
        b.addEventListener('click', (ev) => { ev.stopPropagation(); this._pick(it); });
        wrap.appendChild(b);
      });
      if (!G.input?.touchUI) wrap.appendChild(h('div', { class: 'ong-rad-hint' }, '숫자 1–4 · Esc 닫기'));
      back.appendChild(wrap);
      back.addEventListener('pointerdown', (e) => { if (e.target === back) this.closeMenu(); });
      // anchor at the companion on screen (clamped), otherwise centred
      let x = innerWidth / 2, y = innerHeight / 2;
      if (this._shown && this._tagAnchor) {
        this._tagAnchor.getWorldPosition(_v); _v.y -= 0.35;
        const sp = G.sys.engine.worldToScreen(_v);
        if (sp.visible) { x = sp.x; y = sp.y; }
      }
      // keep the whole ring (+ name pill above, key hint below) on screen
      x = clamp(x, 140, Math.max(140, innerWidth - 140)); y = clamp(y, 185, Math.max(185, innerHeight - 190));
      wrap.style.left = x + 'px'; wrap.style.top = y + 'px';
      (document.getElementById('app') || document.body).appendChild(back);
      const onKey = (e) => {
        const n = /^(Digit|Numpad)([1-4])$/.exec(e.code);
        if (n) { e.preventDefault(); e.stopPropagation(); this._pick(ITEMS[Number(n[2]) - 1]); }
      };
      window.addEventListener('keydown', onKey, true);
      this._menu = { back, wrap, onKey };
      G.ui.block('companion-menu');
      G.sfx('open');
      this._setMood('happy', 1);
      this._wake();
      setTimeout(() => { if (this._menu?.wrap === wrap && !G.input?.touchUI) wrap.querySelector('.ong-rad-item')?.focus({ preventScroll: true }); }, 40);
      if (c && !c.met) { c.met = true; G.dirty('companion'); }
      return true;
    },
    /** 쉬운 모드: the play menu as four big picture tiles (G.easy.pick) with a waving 옹이 on top */
    _openKidMenu() {
      if (this._kidMenuOpen) return false;
      if (G.util.isTyping()) document.activeElement?.blur?.();
      Say.hide('menu');
      this._stopNudgeHand();
      const name = myName();
      const items = [
        { id: 'pet', emoji: '🤲', label: '쓰다듬기', say: `${josa(name, '을/를')} 쓰다듬어요`, color: '#ff8fb3' },
        { id: 'talk', emoji: '💬', label: '알려 줘', say: '무엇을 할지 알려 줘요', color: '#74c0fc' },
        { id: 'dress', emoji: '👒', label: '옷 입히기', say: '옷을 입혀 줘요', color: '#ffd43b' },
        { id: 'rename', emoji: '🏷️', label: '이름 짓기', say: '이름을 지어 줘요', color: '#8ce99a' },
      ];
      this._kidMenuOpen = true;
      this._setMood('happy', 2); this._wake();
      if (this._shown) this._start('wave', 1.6);
      const c = G.state.companion;
      if (c && !c.met) { c.met = true; G.dirty('companion'); }
      const p = G.easy.pick({ id: 'companion-menu', title: `${josa(name, '이랑/랑')} 놀기`, say: `${josa(name, '이랑/랑')} 뭐 하고 놀까요?`, emoji: '🏺', items, columns: 2, className: 'ong-kid-menu' });
      // a big waving 옹이 + hearts (affection as pictures) above the tiles
      try {
        const m = G.ui.modal.get('companion-menu');
        if (m?.body) {
          const hearts = Math.round(affection() / 20);
          const hero = G.ui.h('div', { class: 'ong-kmenu-hero' },
            G.ui.h('div', { class: 'ong-kmenu-face', html: mascotSvg('wink', 104, { outfit: 'current', bob: true }) }),
            G.ui.h('div', { class: 'ong-kmenu-hearts', role: 'img', 'aria-label': `하트 ${hearts}개` }, '❤️'.repeat(hearts) + '🤍'.repeat(5 - hearts)));
          m.body.prepend(hero);
        }
      } catch (e) { /* decoration only */ }
      Promise.resolve(p).then((id) => {
        this._kidMenuOpen = false;
        if (!id || !G.state) return;
        const fn = { pet: () => this.pet(), talk: () => this.talk(), dress: () => this.openWardrobe(), rename: () => this.openRename() }[id];
        // let the picker close first (its focus/sounds), then act
        if (fn) this._later(fn, 160);
      }, () => { this._kidMenuOpen = false; });
      return true;
    },
    _pick(it) {
      if (!it) return;
      this.closeMenu();
      try { it.fn(); } catch (e) { G.log.error('UI', 'companion menu', e); }
    },
    closeMenu(silent) {
      const m = this._menu;
      if (!m) return;
      this._menu = null;
      window.removeEventListener('keydown', m.onKey, true);
      G.ui.unblock('companion-menu');
      m.back.classList.add('out');
      setTimeout(() => m.back.remove(), 200);
      if (!silent) G.sfx('close');
    },

    // ------------------------------------------------------------ wardrobe
    openWardrobe() {
      if (!G.state) return;
      const h = G.ui.h;
      const before = JSON.stringify(this._outfit());
      const preview = h('div', { class: 'ong-ward-preview' });
      const caption = h('div', { class: 'ong-ward-cap' });
      const renderPreview = () => {
        preview.innerHTML = mascotSvg('cheer', 150, { outfit: 'current', bob: true });
        const of = this._outfit();
        caption.textContent = `${COLORS[of.color].name} · ${HATS[of.hat].name}${of.scarf !== 'none' ? ' · ' + SCARVES[of.scarf].name : ''}`;
      };
      const sections = h('div', { class: 'ong-ward-sections' });
      const grids = {};
      const SECT = [['color', kidOn() ? '🎨 색깔' : '🎨 유약 색깔', COLORS], ['hat', '🎩 모자', HATS], ['scarf', '🧣 목도리', SCARVES]];
      const kid = kidOn();
      const renderGrid = (slot) => {
        const grid = grids[slot];
        grid.innerHTML = '';
        const cur = this._outfit();
        for (const [id, it] of Object.entries(SLOTS[slot])) {
          const info = unlockInfo(it.unlock);
          const trial = Object.assign({}, cur, { [slot]: id });
          // easy mode: a locked piece is still tappable — it wiggles and says why (a disabled button just feels broken)
          const lockSay = it.unlock?.affection ? '쓰다듬어 주면 입을 수 있어요! 💗' : `별을 더 모으면 입을 수 있어요! ⭐`;
          const b = h('button', { class: `ong-ward-item${cur[slot] === id ? ' active' : ''}${info.ok ? '' : ' locked'}`, type: 'button', disabled: info.ok || kid ? null : true, 'aria-disabled': !info.ok && kid ? 'true' : null, 'aria-pressed': cur[slot] === id ? 'true' : 'false', title: info.ok ? it.name : `${info.need}에 열려요`, 'data-say': info.ok ? it.name : `${it.name}. ${lockSay}` },
            h('span', { class: 'ong-ward-thumb', html: mascotSvg('happy', 52, { outfit: trial, blink: false }) }),
            h('span', { class: 'ong-ward-name', text: it.name }),
            info.ok ? null : h('span', { class: 'ong-ward-lock' }, '🔒 ' + info.need));
          b.addEventListener('click', () => {
            if (!isUnlocked(slot, id)) {
              if (kid) {
                b.classList.remove('easy-shake'); void b.offsetWidth; b.classList.add('easy-shake');
                G.sfx('wrong');
                kidVoice(lockSay, { force: true, priority: 1 });
              }
              return;
            }
            this.setOutfit({ [slot]: id });
            G.sfx('click');
            renderPreview(); renderGrid(slot);
            this.react('bounce');
          });
          grid.appendChild(b);
        }
      };
      for (const [slot, title] of SECT) {
        grids[slot] = h('div', { class: 'ong-ward-grid' });
        sections.appendChild(h('section', { class: 'ong-ward-sec' }, h('h4', { text: title }), grids[slot]));
        renderGrid(slot);
      }
      renderPreview();
      const lv = playerLevel();
      const next = [];
      for (const slot of Object.values(SLOTS)) for (const it of Object.values(slot)) if (it.unlock.level > lv) next.push(it.unlock.level);
      const nextLv = next.length ? Math.min(...next) : 0;
      const body = h('div', { class: 'ong-ward' },
        h('div', { class: 'ong-ward-side' }, preview, caption,
          h('p', { class: 'ong-ward-note' }, kid
            ? (nextLv ? `별 ${nextLv}개가 되면 새 옷이 생겨요! ⭐ 쓰다듬어 주면 하트 옷도 생겨요 💗` : '쓰다듬어 주면 하트 옷도 생겨요 💗')
            : nextLv ? `Lv.${nextLv}이 되면 새 옷이 열려요! 쓰다듬어 주면 애정도 옷도 생겨요 💗` : '모든 레벨 옷을 모았어요! 애정도 옷도 모아 보세요 💗')),
        sections);
      G.ui.modal.open({
        id: 'companion-wardrobe', title: `${myName()}의 옷장`, icon: '👒', size: 'lg', body, className: kid ? 'ong-kid-ward' : '',
        say: kid ? `${myName()}에게 옷을 입혀 줘요` : undefined,
        actions: [
          { label: kid ? '🎲 아무거나' : '🎲 랜덤', class: 'btn-ghost', onClick: () => {
            const pick = (slot) => { const ids = Object.keys(SLOTS[slot]).filter((id) => isUnlocked(slot, id)); return ids[Math.floor(Math.random() * ids.length)]; };
            this.setOutfit({ color: pick('color'), hat: pick('hat'), scarf: pick('scarf') });
            renderPreview(); for (const s of Object.keys(SLOTS)) renderGrid(s);
            G.sfx('pop');
            return false;
          } },
          { label: kid ? '🔄 처음 옷' : '기본으로', class: 'btn-ghost', onClick: () => { this.setOutfit(DEFAULT_OUTFIT); renderPreview(); for (const s of Object.keys(SLOTS)) renderGrid(s); return false; } },
          { label: kid ? '✅ 다 했어요' : '완료', class: 'btn-primary' },
        ],
        onClose: () => {
          if (JSON.stringify(this._outfit()) !== before && G.state) {
            this.react('celebrate');
            say(U.pick(['어때요? 잘 어울려요? ✨', '새 옷 너무 마음에 들어요! 💕', '빙글빙글~ 멋쟁이가 됐어요! 🌟']), { mood: 'wink', source: 'wardrobe' });
          }
        },
      });
    },

    // ------------------------------------------------------------ rename
    openRename() {
      if (!G.state) return;
      if (kidOn() && G.easy?.pick) { this._openKidRename(); return; }
      const h = G.ui.h;
      const cur = myName();
      const input = h('input', { class: 'input', type: 'text', maxlength: '16', value: cur, autocomplete: 'off', spellcheck: 'false', 'aria-label': '새 이름', 'aria-describedby': 'ong-rename-msg' });
      const count = h('span', { class: 'ong-rn-count' });
      const msg = h('div', { class: 'ong-rn-msg', id: 'ong-rename-msg', role: 'alert' });
      const portrait = h('div', { class: 'ong-rn-face', html: mascotSvg('think', 88, { outfit: 'current', bob: true }) });
      let modalRef = null;
      const check = () => {
        const v = validName(input.value);
        const len = Array.from(cleanText(input.value, 40)).length;
        count.textContent = `${len}/${NAME_MAX}`;
        count.classList.toggle('over', len > NAME_MAX);
        msg.textContent = input.value.trim() && !v.ok ? v.msg : '';
        const btn = modalRef?.foot?.querySelector('.btn-primary');
        if (btn) btn.disabled = !v.ok;
        return v;
      };
      const save = () => {
        const v = check();
        if (!v.ok) { input.focus(); return false; }
        const prev = myName();
        this.setName(v.name);
        if (v.name !== prev) {
          this.react('celebrate');
          say(`${v.name}! 새 이름이 마음에 쏙 들어요 💕`, { mood: 'cheer', source: 'rename', force: true });
          G.activity?.('companion', `동반자 이름을 ‘${v.name}’(으)로 지어 줌`);
        }
        return true;
      };
      input.addEventListener('input', check);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (save()) modalRef?.close(); } });
      const body = h('div', { class: 'ong-rn' }, portrait,
        h('div', { class: 'ong-rn-main' },
          h('label', { class: 'field-label', text: '새 이름 (1–8글자)' }),
          h('div', { class: 'ong-rn-row' }, input, count),
          msg,
          h('p', { class: 'muted small', text: '한글·영문·숫자로 지어 주세요. 이름표와 말풍선에 표시돼요.' })));
      modalRef = G.ui.modal.open({
        id: 'companion-rename', title: '이름 지어 주기', icon: '✏️', size: 'sm', body,
        actions: [
          { label: `‘${DEFAULT_NAME}’로 되돌리기`, class: 'btn-ghost', onClick: () => { input.value = DEFAULT_NAME; check(); return false; } },
          { label: '저장', class: 'btn-primary', onClick: () => save() },
        ],
      });
      check();
      setTimeout(() => { try { input.focus(); input.select(); } catch (e) { /* ignore */ } }, 60);
    },

    /** 쉬운 모드 rename: pick one of the preset names (no keyboard for children) */
    _openKidRename() {
      const cur = myName();
      const items = KID_NAMES.filter(([n]) => validName(n).ok).map(([n, e], i) => ({ id: n, emoji: e, label: n, say: n, selected: n === cur, color: ['#ffd43b', '#8ce99a', '#ffa94d', '#74c0fc', '#e599f7', '#c0a080', '#ffe066', '#ff8787'][i % 8] }));
      Promise.resolve(G.easy.pick({ id: 'companion-kid-rename', title: '이름 지어 주기', say: '어떤 이름이 좋아요?', emoji: '🏷️', items, columns: 4 })).then((n) => {
        if (!n || !G.state) return;
        const prev = myName();
        const v = this.setName(n);
        if (!v.ok) return;
        if (v.name !== prev) {
          this.react('celebrate');
          say(`${v.name}! 새 이름이 마음에 쏙 들어요 💕`, { mood: 'cheer', source: 'rename', force: true });
          G.activity?.('companion', `동반자 이름을 ‘${v.name}’(으)로 지어 줌`);
        } else say(`저는 그대로 ${copula(v.name)} 💕`, { mood: 'wink', source: 'rename', force: true });
      }, () => {});
    },

    // ------------------------------------------------------------ test album
    showcase() {
      const h = G.ui.h;
      const grid = h('div', { class: 'ong-album' });
      for (const m of MOODS) grid.appendChild(h('figure', { class: 'ong-album-cell' }, h('div', { html: mascotSvg(m, 96, { outfit: 'current', bob: m === 'happy' }) }), h('figcaption', { text: `${m} · ${MOOD_NAME[m]}` })));
      const row = (title, slot, mood) => {
        const r = h('div', { class: 'ong-album-row' });
        for (const [id, it] of Object.entries(SLOTS[slot])) r.appendChild(h('figure', { class: 'ong-album-cell sm' }, h('div', { html: mascotSvg(mood, 64, { outfit: Object.assign({}, DEFAULT_OUTFIT, { [slot]: id }) }) }), h('figcaption', { text: it.name })));
        return h('section', null, h('h4', { text: title }), r);
      };
      const sizes = h('div', { class: 'ong-album-row' }, [24, 40, 64, 128].map((s) => h('figure', { class: 'ong-album-cell sm' }, h('div', { html: mascotSvg('wink', s) }), h('figcaption', { text: `${s}px` }))));
      G.ui.modal.open({
        id: 'companion-showcase', title: '옹이 표정 앨범', icon: '🏺', size: 'xl',
        body: h('div', { class: 'ong-album-wrap' }, h('h4', { text: '표정 7가지' }), grid, row('유약 색깔', 'color', 'happy'), row('모자', 'hat', 'cheer'), row('목도리', 'scarf', 'wink'), h('h4', { text: '크기' }), sizes),
        actions: [{ label: '말풍선 테스트', class: 'btn-ghost', onClick: () => { say('안녕하세요! 저는 장독 요정 옹이예요 🏺✨ 말풍선이 잘 보이나요?', { mood: 'wink', force: true, action: { label: '옹이와 놀기', fn: () => this.openMenu() } }); return true; } }, { label: '닫기', class: 'btn-primary' }],
      });
    },

    // ------------------------------------------------------------ events
    _bindEvents() {
      const B = G.bus;
      const celebrate = (bubble, aff) => { if (!G.state) return; this.react('jump', { bubble }); if (aff) this._addAffection(aff, 'event'); };
      B.on('quest:claimed', () => celebrate('🎉', 1));
      B.on('achievement:unlocked', () => celebrate('🏆', 1));
      B.on('ferment:claimed', () => celebrate('🏺✨', 1));
      B.on('farm:harvested', (p) => { if (!G.state) return; this.react('celebrate', { bubble: G.data.items?.[p?.itemId]?.icon || '🧺' }); });
      B.on('collection:unlocked', () => { if (G.state) this.react('bounce', { bubble: '📖' }); });
      B.on('level:up', (p) => {
        if (!G.state) return;
        const lv = Math.floor(Number(p?.level) || playerLevel());
        celebrate('⭐', 2);
        const unlocked = this._unlockNames((rule) => rule.level === lv);
        this._later(() => {
          const kid = kidOn();
          const text = kid
            ? (unlocked.length ? '와, 쑥쑥 컸어요! 🌟 저한테 새 옷이 생겼어요! 👒' : `와, 쑥쑥 컸어요! 🌟 ${nick()} 최고예요!`)
            : unlocked.length
              ? `레벨 ${lv} 달성! 정말 대단해요 🎉 새 옷 ${unlocked.join(', ')}${josa(unlocked[unlocked.length - 1].slice(-1), '이/가').slice(1)} 생겼어요!`
              : `레벨 ${lv} 달성! ${nick()}님 최고예요 🎉✨`;
          say(text, { mood: 'cheer', priority: true, ttl: 60000, source: 'levelup', action: unlocked.length ? { label: kid ? '👒 입혀 보기' : '입혀 보기', fn: () => this.openWardrobe() } : null });
        }, 3600);
        this._lastTipAt = pnow();
      });
      B.on('quest:accepted', () => { this._nextPointT = Math.min(this._nextPointT, G.time.elapsed + 2.5); this._idleT = this._nextIdle; });
      B.on('quest:completed', () => { if (G.state && this._shown && !this._sleeping) { this._start('clap', 1.5); this._showBubble('👏', 1.5, 'note'); } });
      // the player dances → 옹이 dances along (when it is close enough to see it)
      B.on('gesture:played', (p) => { if (G.state && this._shown && p?.gestureId === 'GES_DANCE' && distTo(this.pos.x, this.pos.z) < 10) { this._wake(); this._act = null; this._start('dance', 3.2); } });
      B.on('quest:progress', () => { this._nextPointT = Math.min(this._nextPointT, G.time.elapsed + 6); });
      B.on('player:arrived', () => { this._arrivedAt = pnow(); });
      B.on('photo:mode', (p) => { this._photo = !!p?.active; if (this._photo) { this._wake(); this.closeMenu(true); } });
      B.on('photo:taken', () => { if (this._shown) { this._setMood('wink', 1.8); this._start('bounce', 0.6); } });
      B.on('input:move-start', () => { this._playerIdleSince = pnow(); this._stopNudgeHand(); });
      // any tap / key counts as "the child is playing" for the idle nudges (capture: never blocked by UI handlers)
      const mark = () => { this._lastInputAt = pnow(); };
      window.addEventListener('pointerdown', mark, { capture: true, passive: true });
      window.addEventListener('keydown', mark, { capture: true, passive: true });
      B.on('easy:changed', ({ on } = {}) => { this._nudgeFor = -1; if (!on) { this._stopNudgeHand(); this._restSeen = ''; this._restNap = false; } });
      B.on('interact', (p) => { this._playerIdleSince = pnow(); if (p?.kind !== 'companion') this._wake(); });
      B.on('ui:modal-open', () => { this._playerIdleSince = pnow(); });
      B.on('npc:talk', () => this._wake());
      B.on('settings:changed', ({ key, value } = {}) => {
        if (key !== 'companion' || !G.state) return;
        if (value === false) { this._burst('dust', 10); Say.clear(); }
        else this._later(() => { this._pop = 0; say('다시 같이 다녀요! 🏺💕', { mood: 'cheer', source: 'settings' }); }, 200);
      });
      B.on('engine:quality', () => { if (this._body) this._body.castShadow = !!G.sys.engine?.renderer?.shadowMap?.enabled; });
      // clicking 옹이 always opens the menu (the E-prompt only appears while facing it, so the interaction
      // system ignores clicks on it from behind — handle those here; enabled clicks are handled there first)
      B.on('input:click', (ev) => {
        if (!ev || (ev.button !== 0 && !ev.touch) || !this._shown || this._menu || G.ui.isBlocking()) return;
        if ((G.sys.camera && G.sys.camera.mode !== 'follow') || this._interactable()) return;
        if (distTo(this.pos.x, this.pos.z) > 8) return;
        try { if (G.sys.engine.raycastScreen(ev.x, ev.y, [this.root], true).length) this.openMenu(); } catch (e) { /* picking is best effort */ }
      });
      window.addEventListener('resize', () => Say.place());
    },

    // ------------------------------------------------------------ helper-tip engine
    _quiet() {
      if (Say.blocked() || this._menu || this._kidMenuOpen || G.app?.onboarding?.active || document.hidden || this._photo) return true;
      if (G.util.isTyping()) return true;
      return false;
    },
    _tickTips(dt) {
      if (!G.state || !G.ready) return;
      this._tipAcc += dt;
      if (this._tipAcc < 1) return;
      this._tipAcc = 0;
      // greeting once per login (after onboarding, when it runs)
      const g = this._greet;
      if (g && !g.done && pnow() >= g.at) {
        if (G.app?.onboarding?.active) { g.waitedOnboarding = true; g.at = pnow() + 2000; }
        else if (!this._quiet()) {
          g.done = true;
          if (G.settings.companion !== false) this._greetNow(g.waitedOnboarding);
          return;
        }
      }
      const kid = kidOn();
      if (kid) this._watchRest();
      else if (this._restSeen) { this._restSeen = ''; this._restNap = false; }
      if (G.settings.companion === false || !this._shown) return;
      if (kid && this._kidIdleTick()) return;
      this._scanAcc += 1;
      if (this._scanAcc < 4) return;
      this._scanAcc = 0;
      if (this._quiet() || Say.cur || Say.q.length) return;
      const now = pnow();
      if (now - this._lastTipAt < (kid ? 60000 : 45000)) return;
      // 쉬운 모드: the gold prompt is up, or a walk just arrived — the child is about to act: no tip on top of it
      if (kid && (G.interact?.current || now - (this._arrivedAt || 0) < 20000)) return;
      const idle = (now - this._playerIdleSince) / 1000;
      let pick = null;
      for (const c of candidates()) {
        if (c.once && G.state.flags?.[c.once]) continue;
        if ((this._cool.get(c.key) || 0) > now) continue;
        if (c.idle && idle < c.idle) continue;
        if (c.key.startsWith('claim:') && c.age < 12000) continue;
        if (c.key.startsWith('obj:') || c.key.startsWith('giver:')) { if (this._idleHintFor === this._playerIdleSince) continue; }
        pick = c; break;
      }
      if (!pick) return;
      this._cool.set(pick.key, now + (pick.cd || 120) * 1000);
      if (pick.key.startsWith('obj:') || pick.key.startsWith('giver:')) this._idleHintFor = this._playerIdleSince;
      if (!say(pick.text, { mood: pick.mood, action: pick.action, stepAction: !!pick.stepAction, source: 'tip', ttl: 20000 })) return; // deduped: keep the gap free
      if (pick.once) { G.state.flags = G.state.flags || {}; G.state.flags[pick.once] = G.time.now(); G.dirty('companion'); }
      this._lastTipAt = now;
      if (pick.key.startsWith('obj:')) { const f = pointTarget(); if (f && distTo(f.x, f.z) > 6) this._startPoint(f); }
    },
    _greetNow(afterOnboarding) {
      const c = G.state.companion;
      const nm = myName();
      const play = { label: `${josa(nm, '과/와')} 놀기`, fn: () => this.openMenu() };
      let text, mood = 'happy', action = null;
      if (kidOn()) {
        // short, spoken, no keyboard talk
        const me = nick();
        const kplay = { label: '🏺 같이 놀기', fn: () => this.openMenu() };
        const ph = G.sys.weather?.phase;
        if (afterOnboarding) { text = '저는 늘 옆에 있을게요! 저를 누르면 같이 놀아요 🏺💕'; mood = 'wink'; action = kplay; }
        else if (!c.met) { text = `안녕하세요, ${me}! 저는 장독 요정 ${copula(nm)} 🏺 같이 놀아요!`; mood = 'cheer'; action = kplay; }
        else text = ph === 'MORNING' ? `좋은 아침이에요, ${me}! ☀️ 오늘도 같이 놀아요!` : ph === 'NIGHT' ? `밤에도 반가워요, ${me}! 🏮` : `또 만나서 반가워요, ${me}! 🌿`;
        c.met = true;
        G.dirty('companion');
        this._lastTipAt = pnow();
        say(text, { mood, action, priority: true, ttl: 45000, source: 'greet' });
        this.react('jump');
        return;
      }
      if (afterOnboarding) {
        text = `저는 항상 ${nick()}님 곁에 있을게요! 저를 클릭하거나 O 키를 누르면 같이 놀 수 있어요 🏺💕`; mood = 'wink'; action = play;
      } else if (!c.met) {
        text = `안녕하세요, ${nick()}님! 저는 장독 요정 ${copula(nm)} 🏺✨ 체험관 구석구석 졸졸 따라다니며 도와줄게요!`; mood = 'cheer'; action = play;
      } else {
        const ph = G.sys.weather?.phase;
        text = ph === 'MORNING' ? `좋은 아침이에요, ${nick()}님! 장독들도 기지개를 켜고 있어요 ☀️`
          : ph === 'NIGHT' ? `어서 오세요, ${nick()}님! 밤의 체험관은 청사초롱 불빛이 참 예뻐요 🏮`
            : ph === 'EVENING' ? `${nick()}님, 노을 진 장독대 정말 멋지죠? 🌇 오늘도 같이 놀아요!`
              : `다시 만나서 반가워요, ${nick()}님! 오늘은 무엇을 해 볼까요? 🌿`;
      }
      c.met = true;
      G.dirty('companion');
      this._lastTipAt = pnow();
      say(text, { mood, action, priority: true, ttl: 45000, source: 'greet' });
      this.react('jump');
    },
  };

  // ================================================================= public facade
  function say(text, opts = {}) {
    try { return Say.push(text, opts || {}); } catch (e) { G.log.error('UI', 'mascot.say failed', e); return false; }
  }
  G.mascot = {
    moods: MOODS.slice(),
    outfits: { colors: Object.keys(COLORS), hats: Object.keys(HATS), scarves: Object.keys(SCARVES) },
    svg: (mood = 'happy', size = 96, opts) => {
      try { return mascotSvg(mood, size, opts); } catch (e) { G.log.error('UI', 'mascot.svg failed', e); return '<svg viewBox="0 0 1 1" width="1" height="1" aria-hidden="true"></svg>'; }
    },
    say,
    hint: (opts) => { try { return hint(opts || {}); } catch (e) { G.log.warn('UI', 'mascot.hint failed', e); return opts?.detail ? { key: 'none', text: '오늘도 즐겁게 체험해요! 🌿', mood: 'happy', action: null } : '오늘도 즐겁게 체험해요! 🌿'; } },
    tell: () => companion.talk(),
    dismiss: () => Say.hide('api'),
    clear: () => Say.clear(),
    showcase: () => companion.showcase(),
    name: () => myName(),
    validName: (s) => validName(s),
    get speaking() { return !!Say.cur; },
  };

  G.register(companion);
})();
