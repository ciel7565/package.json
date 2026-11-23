// =============================================================================
// 34-fish-data.js — the fish of 강원도's first-grade (1급수) streams (G.data.fish, CONTRACT §18.3).
// Pure data + pure helpers: no DOM, no THREE — tools/build.mjs evaluates this file in Node (block [fishing]) so the
// server knows every id; tests/fishing-data.mjs lints it; 35-fishing.js plays it; 36-cooking-data.js cooks the catch.
//
//   G.data.fish
//     v                       data version (1)
//     species[]               31 fish, each
//         { id, name, sci, family, size: { usual: [lo, hi] cm, max cm }, habitat: [keys of `habitats`], home (where in
//           강원), basin: 'west' (한강·임진강 윗물) | 'east' (동해로 흐르는 강) | 'both', water: 'Ia' | 'Ib' (see `water`),
//           endemic (Korean endemic), protected: null | { kind: 'endangered2' | 'monument+endangered2' | 'care', label,
//           note } — a protected fish is met, recorded and released: it has NO item —, months (when it bites well),
//           absent (months it is not in the river at all), spawn (months), closed: null | { ranges: [[m, d, m, d]…],
//           basis } (a closed season of the law: release only on those days), hours (bands of `hourBands`), weather
//           { CLEAR, CLOUDY, RAIN, FOG, SNOW → factor }, bait (ids of `baits`), method (ids of `methods`), difficulty
//           1 … 5, rarity (weight, 10 = common), look: { profile, fins, colours, marks, scales, breeding? } (what
//           35-fishing.js builds the body and paints the skin from), kid (one or two short sentences), sign (how to tell
//           it), food, facts[], clean (why clean water matters to it), guard (who protects it; protected only), sources[],
//           cook: 'small' | 'trout' | 'bottom' | null (the kind of dish it suits — 36-cooking-data.js; null = protected) }
//     byId                    id → species            ids                 the 31 ids
//     keepable                ids that can be taken along = the ones with an item        itemId(id) → 'FISH_<ID>' | null
//     neighbours[]            clean-water neighbours that are only watched (가재, 다슬기, 옆새우 …): { id, name, sci, emoji,
//                             grade, kid, facts, protected?, sources }
//     methods · baits · habitats · hourBands · water · spots[] · rules · sources · knowledge[]
//     hourBand(hour) → 'dawn' | 'day' | 'dusk' | 'night'
//     closedOn(species, month, day) → bool          canKeep(species, month, day) → { ok, why: null | 'protected' | 'closed' }
//     candidates({ spot, method, bait, month, hour, weather }) → [{ id, w }] (who can bite there and then; w > 0)
//     pick(list, rnd) → id | null                    rollLength(species, rnd) → mm
//     emptyState() / sanitizeState(x) → the `fishing` block of a save (see STATE below)
//     serverTable() → what game-data.json carries (ids, protected flags, size limits, the keep limit)
//     edu { category, cards, quizzes, deck }          learning cards, quiz items and the slide deck `강원도 1급수 물고기`
//                                                     (merged by the marked block at the end of 45-education-data.js)
//   G.data.items.FISH_<ID>    one item per keepable fish: type 'fish', no price — a catch is never sold
//   G.data.quests.Q_FISH_* · G.data.achievements.ACH_FISH_* · G.data.collection.COL_FISH_* (the sticker book's 물고기 page)
//
// STATE (G.state.fishing): { v: 1, book: { <ID>: { n, kept, rel, max (mm), first (ms) } }, seen: { <neighbour id>: 1 },
//   day: { key (yyyymmdd KST), kept }, traps: { <spot id>: { at (ms), bait } }, tut: 0 | 1 }
//
// Where the facts come from: see `sources` (국가유산청, 한국민족문화대백과사전, 국립수산과학원 수산생명자원정보센터, 국립생물자원관,
// 국립생태원, the law's lists, two river surveys). Every sentence is written anew in plain words for children; no Chinese
// characters; scientific names in Latin letters. Where sources disagree the careful value is used (spawning months are
// the union, sizes the smaller figure). Protection follows 야생생물 보호 및 관리에 관한 법률 시행규칙 별표 1 as revised on
// 2022-12-09 (the list is revised every five years: check it again after December 2027).
// =============================================================================
(function () {
  const D = G.data;

  // ---------------------------------------------------------------- sources
  const ENCY = (id, what) => ({ label: `한국민족문화대백과사전 · ${what}`, url: `https://encykorea.aks.ac.kr/Article/${id}` });
  const NIFS = (id, what) => ({ label: `국립수산과학원 수산생명자원정보센터 · ${what}`, url: `https://www.nifs.go.kr/frcenter/species/?_p=species_view&mf_tax_id=${id}` });
  const NIBR = (ktsn, what) => ({ label: `국립생물자원관 한반도의 생물다양성 · ${what}`, url: `https://species.nibr.go.kr/home/mainHome.do?cont_link=009&subMenu=009002&contCd=009002&ktsn=${ktsn}` });
  const SOURCES = {
    LAW_LIST: { label: '야생생물 보호 및 관리에 관한 법률 시행규칙 별표 1 (멸종위기 야생생물, 2022년 12월 9일 개정)', url: 'https://www.law.go.kr/법령/야생생물보호및관리에관한법률시행규칙' },
    NIE: { label: '국립생태원 멸종위기 야생생물 포털', url: 'https://www.nie.re.kr/endangered_species/' },
    HERITAGE_YEOL: { label: '국가유산청 국가유산포털 · 정선 정암사 열목어 서식지 (천연기념물)', url: 'https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1363200730000' },
    HERITAGE_EOREUM: { label: '국가유산청 국가유산포털 · 천연기념물 어름치', url: 'https://www.heritage.go.kr/' },
    ENV_STANDARD: { label: '환경정책기본법 시행령 별표 1 (수질 및 수생태계 환경기준: 생물 등급과 지표 생물)', url: 'https://www.law.go.kr/법령/환경정책기본법시행령' },
    LAW_INLAND: { label: '내수면어업법 시행령 제14조 · 별표 1 (놀이 낚시의 제한, 은어를 잡지 않는 기간)', url: 'https://www.law.go.kr/법령/내수면어업법시행령' },
    BANGTAE: { label: '최광식·한미숙·고명훈 (2022) 방태천의 어류군집 특성 및 냉수성 어류의 서식양상, 한국환경생태학회지 36(6)', url: 'https://koreascience.kr/article/JAKO202217140244546.page?lang=ko' },
    PYEONGCHANG: { label: '평창강의 어류상 및 법적보호종의 서식 실태 (한국하천호수학회지)', url: 'https://koreascience.kr/article/JAKO200634742870372.page?lang=ko' },
    SAEMI_PAPER: { label: '최광식·배양섭·고명훈 (2022) 새미의 분포 현황과 멸종 위협 평가', url: 'https://koreascience.kr/article/JAKO202217157871614.pdf' },
    REDBOOK: { label: '국립생물자원관 국가생물적색자료집 (어류)', url: 'https://www.nibr.go.kr/' },
    NIFS_HOME: { label: '국립수산과학원 수산생명자원정보센터', url: 'https://www.nifs.go.kr/frcenter/' },
    NIBR_HOME: { label: '국립생물자원관 한반도의 생물다양성', url: 'https://species.nibr.go.kr/' },
    E_YEOL: ENCY('E0037044', '열목어'), E_JEONGAM: ENCY('E0050540', '정선 정암사 열목어 서식지'), E_SANCHEON: ENCY('E0026345', '산천어'),
    E_GEUMGANG: ENCY('E0007508', '금강모치'), E_BEODEULCHI: ENCY('E0022496', '버들치'), E_BEODEULGAJI: ENCY('E0022495', '버들가지'),
    E_SWIRI: ENCY('E0032105', '쉬리'), E_EOREUM: ENCY('E0036202', '어름치'), E_DUK: ENCY('E0017052', '둑중개'), E_SAEKO: ENCY('E0027470', '새코미꾸리'),
    E_CHAMJONG: ENCY('E0055297', '참종개'), E_GANEUN: ENCY('E0000070', '가는돌고기'), E_BAEGA: ENCY('E0021835', '배가사리'), E_KKUGURI: ENCY('E0011274', '꾸구리'),
    E_DOLSANG: ENCY('E0016147', '돌상어'), E_MUK: ENCY('E0019311', '묵납자루'), E_DAMUK: ENCY('E0075090', '다묵장어'), E_CHILSEONG: ENCY('E0075098', '칠성장어'),
    E_MIYUGI: ENCY('E0019989', '미유기'), E_GALGYEONI: ENCY('E0000621', '갈겨니'),
    N_SANCHEON: NIFS('MF0010368', '산천어'), N_GEUMGANG: NIFS('MF0003293', '금강모치'), N_SWIRI: NIFS('MF0004494', '쉬리'), N_DUK: NIFS('MF0006489', '둑중개'), N_MIYUGI: NIFS('MF0003821', '미유기'),
    B_DAERYUK: NIBR('120000057673', '대륙종개'), B_MUK: NIBR('120000057539', '묵납자루'), B_DAMUK: NIBR('120000057234', '다묵장어'), B_DOLSANG: NIBR('120000057566', '돌상어'),
    KKEOKJI_PAPER: { label: '꺽지의 산란 습성과 초기 생활사 연구 (한국어류학회지)', url: 'https://koreascience.kr/article/JAKO199811920163917.do' },
  };

  // ---------------------------------------------------------------- vocabulary
  const HABITATS = {
    cold: { name: '찬 윗물', emoji: '🏔️', kid: '숲 그늘 아래 아주 차가운 윗물이에요.' },
    riffle: { name: '여울', emoji: '🌊', kid: '물이 얕고 빠르게 흐르는 곳이에요.' },
    pool: { name: '소', emoji: '🔵', kid: '물이 깊고 잔잔하게 고여 도는 곳이에요.' },
    stone: { name: '돌 밑', emoji: '🪨', kid: '큰 돌 아래 어두운 틈이에요.' },
    gravel: { name: '자갈 바닥', emoji: '⚪', kid: '자갈과 모래가 깔린 바닥이에요.' },
    edge: { name: '물가 풀숲', emoji: '🌿', kid: '물살이 느린 물가의 풀 그늘이에요.' },
  };
  const METHODS = {
    rod: { name: '대낚시', kidName: '찌낚시', emoji: '🎣', habitats: ['pool', 'riffle', 'cold', 'edge'], baits: ['larva', 'worm', 'paste', 'fly'],
      desc: '긴 대나무 낚싯대에 줄과 찌를 달아요. 찌가 물속으로 쏙 들어가면 물고기가 미끼를 문 거예요.', kid: '찌가 쏙 들어가면 천천히 당겨요.' },
    gyeonji: { name: '견지낚시', kidName: '견지낚시', emoji: '🪵', habitats: ['riffle', 'gravel'], baits: ['larva', 'paste', 'fly'],
      desc: '견지는 줄을 감아 두는 납작한 나무 얼레예요. 여울에 서서 물살에 미끼를 흘려보내고, 손에 오는 떨림으로 입질을 알아요.', kid: '줄을 물살에 흘려보내고, 톡톡 떨리면 감아요.' },
    net: { name: '족대', kidName: '족대', emoji: '🥅', habitats: ['stone', 'gravel', 'riffle', 'cold', 'edge'], baits: [],
      desc: '두 막대 사이에 그물을 댄 것이 족대예요. 돌 아래쪽에 족대를 대고 돌을 살살 들추면, 숨어 있던 물고기가 그물로 들어와요.', kid: '족대를 대고 돌을 살살 들춰요.' },
    trap: { name: '어항', kidName: '어항', emoji: '🫙', habitats: ['pool', 'edge', 'gravel', 'riffle', 'cold'], baits: ['doenjang', 'paste'],
      desc: '입구가 안으로 오므라든 통이에요. 된장이나 떡밥을 넣어 물속에 두고 기다리면 작은 물고기가 들어와요. 들어가기는 쉽고 나오기는 어려워요.', kid: '먹이를 넣어 물에 두고, 나중에 와서 봐요.' },
  };
  const BAITS = {
    larva: { name: '물속 벌레', emoji: '🪲', kid: '돌 밑에 사는 강도래와 날도래 애벌레예요. 맑은 물 물고기가 가장 좋아해요.' },
    worm: { name: '지렁이', emoji: '🪱', kid: '흙에서 사는 지렁이예요. 큰 물고기가 잘 물어요.' },
    paste: { name: '떡밥', emoji: '🍡', kid: '곡식 가루를 뭉친 먹이예요. 작은 물고기가 모여들어요.' },
    fly: { name: '털바늘', emoji: '🪶', kid: '깃털로 벌레처럼 꾸민 가짜 미끼예요. 물 위 벌레를 먹는 물고기가 속아요.' },
    doenjang: { name: '된장', emoji: '🟤', kid: '구수한 된장 냄새를 맡고 작은 물고기가 어항으로 들어와요.' },
  };
  const HOUR_BANDS = { dawn: { name: '새벽', from: 5, to: 8 }, day: { name: '낮', from: 8, to: 17 }, dusk: { name: '해 질 녘', from: 17, to: 20 }, night: { name: '밤', from: 20, to: 5 } };
  const WATER = {
    Ia: { name: '매우 좋음 ~ 좋음', short: '1급수 윗물', kid: '아주 맑고 차가운 물이에요. 바닥은 바위와 자갈이에요.', note: '환경 기준의 생물 지표에서 산천어·금강모치·열목어·버들치가 사는 등급이에요.' },
    Ib: { name: '좋음', short: '1급수 여울', kid: '맑은 물이 자갈 위를 흐르는 곳이에요.', note: '좋음(1급수) 여울에 살아요. 조금 아래 등급의 맑은 물에서도 볼 수 있어요.' },
  };
  const PROT = {
    E2: (note) => ({ kind: 'endangered2', label: '멸종위기 야생생물 Ⅱ급', note }),
    ME2: (note) => ({ kind: 'monument+endangered2', label: '천연기념물 · 멸종위기 야생생물 Ⅱ급', note }),
    CARE: (note) => ({ kind: 'care', label: '체험관 약속 (드문 손님)', note }),
  };
  const W = { any: { CLEAR: 1, CLOUDY: 1, RAIN: 0.9, FOG: 1, SNOW: 0.5 }, cloudy: { CLEAR: 0.85, CLOUDY: 1.2, RAIN: 1.1, FOG: 1.1, SNOW: 0.5 }, rain: { CLEAR: 0.8, CLOUDY: 1.1, RAIN: 1.3, FOG: 1, SNOW: 0.4 }, sun: { CLEAR: 1.15, CLOUDY: 1, RAIN: 0.7, FOG: 0.9, SNOW: 0.4 } };

  // ---------------------------------------------------------------- body curves (fractions of the standard length)
  // s = 0 at the tip of the snout, 1 at the base of the tail fin. depth = body height, width = body thickness.
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const SS = [0, 0.03, 0.07, 0.12, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.9, 0.95, 1];
  /** a smooth body curve: rises to `max` at `at`, falls to `stalk` at s = 0.9, ends at `end` */
  function curve(max, at, stalk, o) {
    o = o || {};
    const nose = o.nose != null ? o.nose : max * 0.1, front = o.front || 0.7, rear = o.rear || 1.2, end = o.end != null ? o.end : stalk * 1.06;
    return SS.map((s) => {
      let d;
      if (s <= at) d = nose + (max - nose) * Math.sin(Math.pow(s / at, front) * Math.PI / 2);
      else if (s <= 0.9) d = stalk + (max - stalk) * Math.cos(Math.pow((s - at) / (0.9 - at), rear) * Math.PI / 2);
      else d = stalk + (end - stalk) * ((s - 0.9) / 0.1);
      return [s, r3(d)];
    });
  }
  const FIN0 = { dorsal: null, dorsal2: null, adipose: null, anal: null, pelvic: null, pectoral: null, tail: null, fringe: null };
  const fins = (o) => Object.assign({}, FIN0, o);
  // usual fin sets of the families (each species overrides what is special about it)
  const F_MINNOW = (o) => fins(Object.assign({
    dorsal: { at: 0.5, base: 0.11, h: 0.14, shape: 'tri', rays: 8 }, anal: { at: 0.68, base: 0.09, h: 0.1, shape: 'tri', rays: 8 },
    pelvic: { at: 0.49, len: 0.1 }, pectoral: { at: 0.25, len: 0.14, fan: 0, low: 1 }, tail: { len: 0.2, fork: 0.55, spread: 0.24, shape: 'fork' },
  }, o || {}));
  const F_TROUT = (o) => fins(Object.assign({
    dorsal: { at: 0.44, base: 0.13, h: 0.13, shape: 'round', rays: 11 }, adipose: { at: 0.78, size: 0.035 }, anal: { at: 0.7, base: 0.1, h: 0.1, shape: 'tri', rays: 10 },
    pelvic: { at: 0.52, len: 0.1 }, pectoral: { at: 0.26, len: 0.14, fan: 0, low: 1 }, tail: { len: 0.19, fork: 0.3, spread: 0.26, shape: 'notch' },
  }, o || {}));
  const F_LOACH = (o) => fins(Object.assign({
    dorsal: { at: 0.5, base: 0.09, h: 0.09, shape: 'round', rays: 7 }, anal: { at: 0.76, base: 0.06, h: 0.07, shape: 'round', rays: 6 },
    pelvic: { at: 0.53, len: 0.07 }, pectoral: { at: 0.2, len: 0.1, fan: 0, low: 1 }, tail: { len: 0.14, fork: 0, spread: 0.14, shape: 'round' },
  }, o || {}));
  const F_BENTHIC = (o) => fins(Object.assign({
    dorsal: { at: 0.42, base: 0.11, h: 0.14, shape: 'tri', rays: 7 }, anal: { at: 0.7, base: 0.07, h: 0.08, shape: 'tri', rays: 6 },
    pelvic: { at: 0.45, len: 0.11 }, pectoral: { at: 0.22, len: 0.2, fan: 1, low: 1 }, tail: { len: 0.2, fork: 0.5, spread: 0.22, shape: 'fork' },
  }, o || {}));

  // ---------------------------------------------------------------- the species
  const S = [];
  /** one species; `o` holds everything of the header's species shape except what is derived below */
  function sp(o) {
    o.absent = o.absent || [];
    o.closed = o.closed || null;
    o.protected = o.protected || null;
    o.guard = o.guard || null;
    S.push(o);
  }
  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const WARM = [4, 5, 6, 7, 8, 9, 10], LONG = [3, 4, 5, 6, 7, 8, 9, 10, 11];

  // ---- 연어과 -------------------------------------------------------------------------------------------------------
  sp({
    id: 'YEOLMOGEO', name: '열목어', sci: 'Brachymystax lenok tsinlingensis', family: '연어과', size: { usual: [25, 45], max: 70 },
    habitat: ['cold', 'pool'], basin: 'west', water: 'Ia', endemic: false, home: '홍천·인제·평창·정선·양구의 가장 윗물 (한강 윗물과 낙동강 윗물)',
    protected: PROT.E2('아주 차가운 물에서만 살아서 수가 줄었어요. 정선 정암사와 봉화 대현리의 사는 곳은 천연기념물이에요.'),
    guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요. 정선 정암사 열목어 서식지는 국가유산청이 천연기념물로 지켜요.',
    months: [3, 4, 5, 6, 9, 10, 11], spawn: [4, 5], hours: ['dawn', 'dusk', 'day'], weather: W.cloudy, bait: ['larva', 'fly'], method: ['rod'], difficulty: 4, rarity: 3,
    look: {
      profile: { kind: 'fish', depth: curve(0.215, 0.36, 0.085, { front: 0.62 }), width: curve(0.12, 0.3, 0.035, { front: 0.6 }), arch: 0.08, head: 0.23, snout: 0.45, mouth: 'under', gape: 0.45, barbels: 0, eye: [0.085, 0.6, 0.038], lips: 0.1, section: 2.2, flatHead: 0 },
      fins: F_TROUT({ tail: { len: 0.19, fork: 0.42, spread: 0.26, shape: 'fork' } }),
      colours: { back: '#4a4a2e', side: '#b9a36a', belly: '#f1ead6', fin: '#8a6a4a', eye: '#c9a13a', sheen: '#e6c8a0', gloss: 0.75 },
      marks: [
        { t: 'spots', n: 150, u0: 0.1, u1: 0.98, v0: 0.0, v1: 0.62, r0: 0.006, r1: 0.011, c: '#1f1b14', a: 0.85, seed: 11 },
        { t: 'blotch', u: 0.5, v: 0.5, rx: 0.3, ry: 0.16, c: '#8a2f3a', a: 0.14 },
        { t: 'fin', fin: 'dorsal', kind: 'spots', n: 14, c: '#1f1b14', a: 0.8 }, { t: 'fin', fin: 'adipose', kind: 'spots', n: 3, c: '#1f1b14', a: 0.8 },
      ],
      scales: 'fine',
      breeding: { months: [4, 5], colours: { side: '#a8704f', fin: '#a04a3a' }, marks: [{ t: 'mottle', n: 9, u0: 0.25, u1: 0.95, v0: 0.3, v1: 0.75, r0: 0.03, r1: 0.06, c: '#7a1f2e', a: 0.4, seed: 5 }] },
    },
    kid: '눈에 열이 많아 찬물을 찾는다는 이름이에요. 아주 차가운 물에서만 살아요.',
    sign: '누런 갈색 몸에 작고 검은 점이 등과 옆구리에 흩어져 있어요. 등지느러미 뒤에 작은 기름지느러미가 있어요.',
    food: '물속 벌레와 작은 물고기를 먹어요.',
    facts: [
      '한여름에도 물 온도가 20도를 넘지 않고 산소가 넉넉한 물에서만 살아요.',
      '봄에 물 온도가 7~10도쯤 되면 윗물 자갈 바닥에 알을 낳아요.',
      '겨울에는 깊은 소(물이 깊게 고인 곳)로 내려가 지내다가, 봄에 다시 윗물로 올라가요.',
      '정선 고한의 정암사 골짜기는 열목어가 사는 곳 가운데 아주 남쪽이라서 천연기념물로 지켜요.',
    ],
    clean: '숲이 물 위를 덮어 그늘을 만들어 줘야 물이 차가워요. 숲이 사라지면 열목어도 살 수 없어요.',
    sources: ['E_YEOL', 'E_JEONGAM', 'HERITAGE_YEOL', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'SANCHEONEO', name: '산천어', sci: 'Oncorhynchus masou masou', family: '연어과', size: { usual: [15, 25], max: 35 },
    habitat: ['cold', 'pool', 'riffle'], basin: 'both', water: 'Ia', endemic: false, home: '동해로 흐르는 강의 윗물 (고성·양양·강릉·삼척). 한강 윗물의 산천어는 사람이 옮겨 놓은 것이에요.',
    months: [3, 4, 5, 6, 7, 8, 11], spawn: [9, 10], hours: ['dawn', 'dusk', 'day'], weather: W.cloudy, bait: ['fly', 'larva', 'worm'], method: ['rod'], difficulty: 3, rarity: 5,
    look: {
      profile: { kind: 'fish', depth: curve(0.24, 0.36, 0.09, { front: 0.6 }), width: curve(0.125, 0.3, 0.036, { front: 0.6 }), arch: 0.05, head: 0.25, snout: 0.55, mouth: 'end', gape: 0.75, barbels: 0, eye: [0.085, 0.6, 0.045], lips: 0, section: 2.2, flatHead: 0 },
      fins: F_TROUT(),
      colours: { back: '#4e5f45', side: '#c9c7b2', belly: '#f6f4ea', fin: '#b9a47a', eye: '#d9c06a', sheen: '#f0d0d8', gloss: 0.85 },
      marks: [
        { t: 'parr', n: 9, u0: 0.24, u1: 0.95, v: 0.5, rx: 0.026, ry: 0.19, c: '#51607a', a: 0.62 },
        { t: 'band', v: 0.5, w: 0.13, c: '#e59aa0', a: 0.2, u0: 0.22, u1: 0.98 },
        { t: 'spots', n: 46, u0: 0.12, u1: 0.95, v0: 0.02, v1: 0.36, r0: 0.007, r1: 0.012, c: '#1b1b1b', a: 0.85, seed: 7 },
        { t: 'fin', fin: 'dorsal', kind: 'spots', n: 8, c: '#1b1b1b', a: 0.75 }, { t: 'fin', fin: 'anal', kind: 'edge', c: '#ffffff', a: 0.8 },
      ],
      scales: 'fine',
      breeding: { months: [9, 10], colours: { side: '#8b7f72', back: '#3a3a30' }, marks: [{ t: 'band', v: 0.55, w: 0.3, c: '#7a3a44', a: 0.25, u0: 0.2, u1: 1 }] },
    },
    kid: '옆구리에 동글동글한 무늬가 줄지어 있어요. 바다에 가지 않는 송어예요.',
    sign: '옆구리에 길쭉하고 둥근 푸른 잿빛 무늬(파 마크)가 8~12개 줄지어 있고, 등에는 검은 점이 있어요.',
    food: '물속 벌레와 물 위에 떨어진 벌레를 먹어요.',
    facts: [
      '송어 가운데 바다로 내려가지 않고 한평생 계곡에서 사는 무리를 산천어라고 불러요.',
      '어릴 때의 옆구리 무늬가 어른이 되어서도 남아 있어요.',
      '가을(9~10월)에 맑은 여울 자갈 바닥에 알을 낳아요.',
      '본디 동해로 흐르는 강에 살아요. 다른 강에 함부로 풀어 놓으면 그곳 물고기가 살기 어려워져요.',
    ],
    clean: '물이 차갑고 산소가 많아야 해요. 물이 따뜻해지면 숨쉬기가 어려워져요.',
    sources: ['E_SANCHEON', 'N_SANCHEON', 'ENV_STANDARD', 'REDBOOK'],
  });
  sp({
    id: 'SONGEO', name: '송어', sci: 'Oncorhynchus masou masou', family: '연어과', size: { usual: [40, 55], max: 60 },
    habitat: ['pool'], basin: 'east', water: 'Ia', endemic: false, home: '동해에서 자라 양양·강릉·고성의 강으로 돌아와요',
    protected: PROT.CARE('바다에 다녀오는 송어는 이제 아주 드물어요. 법이 정한 보호종은 아니지만, 체험관에서는 꼭 놓아주기로 약속했어요.'),
    guard: '법이 정한 보호종은 아니에요. 드물어서 체험관이 스스로 정한 약속으로 지켜요.',
    months: [5, 6, 7, 8], absent: [11, 12, 1, 2, 3], spawn: [9, 10], hours: ['dawn', 'dusk'], weather: W.rain, bait: ['fly'], method: ['rod'], difficulty: 5, rarity: 1,
    look: {
      profile: { kind: 'fish', depth: curve(0.25, 0.38, 0.085, { front: 0.6 }), width: curve(0.13, 0.32, 0.036, { front: 0.6 }), arch: 0.06, head: 0.23, snout: 0.6, mouth: 'end', gape: 0.8, barbels: 0, eye: [0.075, 0.6, 0.034], lips: 0, section: 2.2, flatHead: 0 },
      fins: F_TROUT({ tail: { len: 0.19, fork: 0.25, spread: 0.28, shape: 'notch' } }),
      colours: { back: '#2f4558', side: '#d5dade', belly: '#f8f8f4', fin: '#8f9aa0', eye: '#d0d4c0', sheen: '#dfe9ff', gloss: 0.95 },
      marks: [
        { t: 'spots', n: 34, u0: 0.12, u1: 0.95, v0: 0.02, v1: 0.3, r0: 0.006, r1: 0.01, c: '#15181c', a: 0.8, seed: 3 },
        { t: 'fin', fin: 'dorsal', kind: 'spots', n: 6, c: '#15181c', a: 0.6 },
      ],
      scales: 'fine',
      breeding: { months: [8, 9, 10], colours: { side: '#b9a6a2', back: '#3a3e42' }, marks: [{ t: 'mottle', n: 8, u0: 0.2, u1: 0.95, v0: 0.3, v1: 0.8, r0: 0.04, r1: 0.08, c: '#b0485a', a: 0.4, seed: 9 }] },
    },
    kid: '산천어와 같은 물고기예요. 바다에 다녀와서 훨씬 크고 은빛이에요.',
    sign: '몸이 크고 온통 은빛이에요. 등은 짙푸르고 작은 검은 점이 있어요. 옆구리의 둥근 무늬는 사라졌어요.',
    food: '바다에서는 작은 물고기를 먹고 자라요. 강에 올라온 뒤에는 거의 먹지 않아요.',
    facts: [
      '어릴 때 바다로 내려가 크게 자란 뒤, 태어난 강으로 돌아오는 무리를 송어라고 불러요.',
      '봄부터 여름 사이에 강을 거슬러 올라와 깊은 소에서 가을을 기다려요.',
      '가을에 윗물 자갈 바닥에 알을 낳아요.',
      '같은 알에서 태어나도 계곡에 남으면 산천어, 바다에 다녀오면 송어가 돼요.',
    ],
    clean: '바다에서 윗물까지 물길이 막히지 않아야 돌아올 수 있어요. 보(물을 막은 둑)에는 물고기 길이 있어야 해요.',
    sources: ['E_SANCHEON', 'N_SANCHEON', 'REDBOOK'],
  });

  // ---- 잉어과: 모치·버들치 무리 ---------------------------------------------------------------------------------------
  sp({
    id: 'GEUMGANGMOCHI', name: '금강모치', sci: 'Rhynchocypris kumgangensis', family: '잉어과', size: { usual: [6, 9], max: 10 },
    habitat: ['cold', 'riffle', 'pool'], basin: 'west', water: 'Ia', endemic: true, home: '한강의 가장 윗물 (인제·평창·정선·홍천·화천)',
    months: WARM, spawn: [4, 5], hours: ['day', 'dawn'], weather: W.sun, bait: ['larva', 'paste'], method: ['net', 'trap', 'rod'], difficulty: 1, rarity: 9,
    look: {
      profile: { kind: 'fish', depth: curve(0.2, 0.38, 0.082), width: curve(0.115, 0.3, 0.03), arch: 0.04, head: 0.24, snout: 0.55, mouth: 'end', gape: 0.4, barbels: 0, eye: [0.085, 0.58, 0.058], lips: 0, section: 2.1, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.52, base: 0.1, h: 0.14, shape: 'tri', rays: 8 } }),
      colours: { back: '#6a5a34', side: '#d8c486', belly: '#f6f1df', fin: '#e6d7a6', eye: '#e0c060', sheen: '#ffe9a8', gloss: 0.8 },
      marks: [
        { t: 'band', v: 0.4, w: 0.07, c: '#e58a2a', a: 0.85, u0: 0.24, u1: 0.99 },
        { t: 'band', v: 0.62, w: 0.06, c: '#e58a2a', a: 0.75, u0: 0.26, u1: 0.99 },
        { t: 'band', v: 0.5, w: 0.035, c: '#f7e7a0', a: 0.8, u0: 0.22, u1: 0.99 },
        { t: 'blotch', u: 0.52, v: 0.04, rx: 0.022, ry: 0.05, c: '#1a1a16', a: 0.9 },
        { t: 'fin', fin: 'dorsal', kind: 'base', c: '#1a1a16', a: 0.85 },
      ],
      scales: 'fine',
      breeding: { months: [4, 5], colours: { fin: '#f0a04a' }, marks: [{ t: 'blotch', u: 0.26, v: 0.8, rx: 0.03, ry: 0.07, c: '#f08a2a', a: 0.7 }] },
    },
    kid: '옆구리에 주황색 줄이 두 줄 있어요. 아주 차가운 윗물에서 떼 지어 다녀요.',
    sign: '옆구리의 주황색 줄 두 줄과, 등지느러미 뿌리의 검은 점으로 알아봐요.',
    food: '물속 벌레와 작은 새우 무리를 먹어요.',
    facts: [
      '우리나라에만 사는 물고기예요. 이런 생물을 고유종이라고 해요.',
      '물이 맑고 산소가 넉넉한 윗물에서 버들치와 함께 떼를 지어 살아요.',
      '나라가 정한 환경 기준에서 금강모치는 가장 맑은 물에 사는 물고기로 꼽혀요.',
      '찬물을 좋아해서, 날씨가 더워져 물이 따뜻해지면 살 곳이 줄어들어요.',
    ],
    clean: '물이 조금만 더러워지거나 따뜻해져도 견디기 어려워요. 그래서 금강모치가 보이면 물이 아주 맑다는 뜻이에요.',
    sources: ['E_GEUMGANG', 'N_GEUMGANG', 'ENV_STANDARD', 'BANGTAE'],
  });
  sp({
    id: 'YEONJUNMOCHI', name: '연준모치', sci: 'Phoxinus phoxinus', family: '잉어과', size: { usual: [6, 8], max: 10 },
    habitat: ['cold', 'pool'], basin: 'west', water: 'Ia', endemic: false, home: '한강의 가장 윗물 (정선·삼척·영월·태백의 차가운 물)',
    protected: PROT.E2('우리나라에서는 한강 가장 윗물의 몇 곳에만 남아 있어요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [4, 5, 6], hours: ['day'], weather: W.any, bait: ['larva', 'paste'], method: ['net', 'trap'], difficulty: 2, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.21, 0.36, 0.08), width: curve(0.125, 0.3, 0.03), arch: 0.04, head: 0.25, snout: 0.3, mouth: 'end', gape: 0.35, barbels: 0, eye: [0.08, 0.58, 0.058], lips: 0, section: 2.1, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.55, base: 0.09, h: 0.13, shape: 'round', rays: 7 }, tail: { len: 0.19, fork: 0.45, spread: 0.22, shape: 'fork' } }),
      colours: { back: '#56552f', side: '#c9bd86', belly: '#f3efdc', fin: '#d9cfa0', eye: '#d8c060', sheen: '#e8f0c0', gloss: 0.8 },
      marks: [
        { t: 'bars', n: 13, u0: 0.26, u1: 0.98, v0: 0.3, v1: 0.72, w: 0.022, c: '#2c2a1c', a: 0.72, jitter: 0.5, seed: 4 },
        { t: 'band', v: 0.3, w: 0.04, c: '#e9dc9a', a: 0.7, u0: 0.22, u1: 0.98 },
        { t: 'spots', n: 60, u0: 0.1, u1: 0.98, v0: 0.0, v1: 0.3, r0: 0.004, r1: 0.007, c: '#2c2a1c', a: 0.6, seed: 8 },
      ],
      scales: 'fine',
      breeding: { months: [4, 5, 6], colours: { belly: '#e0564a' }, marks: [{ t: 'band', v: 0.9, w: 0.2, c: '#d83c34', a: 0.6, u0: 0.1, u1: 0.8 }] },
    },
    kid: '옆구리에 짙은 세로 무늬가 줄지어 있어요. 아주 드문 작은 물고기예요.',
    sign: '옆구리 가운데에 짙은 무늬가 띄엄띄엄 줄지어 있고, 주둥이가 둥글어요.',
    food: '물속 벌레와 돌에 붙은 물풀(돌말 같은 작은 풀)을 먹어요.',
    facts: [
      '북쪽 추운 나라의 강에 널리 사는 물고기예요. 우리나라는 사는 곳의 남쪽 끝이에요.',
      '열목어, 금강모치, 버들치와 같은 물에서 함께 살아요.',
      '알 낳는 철이 되면 수컷의 배가 붉게 물들어요.',
      '사는 곳이 몇 군데뿐이라서 잡지 않고 지켜요.',
    ],
    clean: '찬물과 깨끗한 자갈 바닥이 꼭 있어야 해요. 흙탕물이 들어와 자갈 틈이 메워지면 알을 낳지 못해요.',
    sources: ['LAW_LIST', 'NIE', 'REDBOOK'],
  });
  sp({
    id: 'BEODEULCHI', name: '버들치', sci: 'Rhynchocypris oxycephalus', family: '잉어과', size: { usual: [8, 12], max: 14 },
    habitat: ['cold', 'pool', 'riffle', 'edge', 'stone'], basin: 'both', water: 'Ia', endemic: false, home: '강원도 어느 산골짜기에나 살아요',
    months: LONG, spawn: [4, 5, 6], hours: ['day', 'dawn', 'dusk'], weather: W.any, bait: ['worm', 'paste', 'larva', 'doenjang'], method: ['rod', 'net', 'trap'], difficulty: 1, rarity: 10,
    look: {
      profile: { kind: 'fish', depth: curve(0.205, 0.37, 0.09), width: curve(0.125, 0.3, 0.034), arch: 0.04, head: 0.25, snout: 0.65, mouth: 'end', gape: 0.45, barbels: 0, eye: [0.09, 0.58, 0.05], lips: 0, section: 2.1, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.54, base: 0.09, h: 0.12, shape: 'round', rays: 7 }, tail: { len: 0.18, fork: 0.35, spread: 0.22, shape: 'fork' } }),
      colours: { back: '#5c5232', side: '#b9a570', belly: '#efe8d0', fin: '#d6c890', eye: '#d0b860', sheen: '#f0e0b0', gloss: 0.7 },
      marks: [
        { t: 'band', v: 0.5, w: 0.07, c: '#3a3324', a: 0.5, u0: 0.4, u1: 0.99, grow: 1 },
        { t: 'spots', n: 170, u0: 0.1, u1: 0.99, v0: 0.0, v1: 0.72, r0: 0.003, r1: 0.006, c: '#2e281a', a: 0.6, seed: 2 },
        { t: 'band', v: 0.42, w: 0.03, c: '#e6d79a', a: 0.4, u0: 0.24, u1: 0.99 },
      ],
      scales: 'fine',
    },
    kid: '산골 물에서 가장 흔히 만나는 친구예요. 버드나무 아래 그늘을 좋아해요.',
    sign: '누런 갈색 몸에 깨알 같은 짙은 점이 흩어져 있고, 꼬리 쪽으로 갈수록 가운데 줄이 또렷해져요.',
    food: '물속 벌레, 돌에 붙은 물풀, 물에 떨어진 것까지 가리지 않고 먹어요.',
    facts: [
      '좁은 산골짜기 물을 좋아해서, 그런 곳에서는 가장 많은 물고기예요.',
      '봄에서 초여름 사이에 자갈 바닥에 알을 낳아요.',
      '맑은 물을 좋아하지만 조금 흐린 물도 잘 견뎌요. 그래서 버들치만 보고 1급수라고 하지는 않아요.',
      '추위에 강해서 겨울에도 돌 밑에서 지내요.',
    ],
    clean: '맑은 윗물의 지표 물고기로 꼽혀요. 버들치와 금강모치, 가재가 함께 보이면 정말 맑은 물이에요.',
    sources: ['E_BEODEULCHI', 'ENV_STANDARD', 'BANGTAE'],
  });
  sp({
    id: 'BEODEULGAE', name: '버들개', sci: 'Rhynchocypris steindachneri', family: '잉어과', size: { usual: [8, 12], max: 15 },
    habitat: ['cold', 'pool', 'riffle'], basin: 'east', water: 'Ia', endemic: false, home: '동해로 흐르는 강의 윗물 (고성·속초·양양·강릉)과 북쪽의 차가운 물',
    months: LONG, spawn: [5, 6, 7], hours: ['day', 'dawn', 'dusk'], weather: W.any, bait: ['larva', 'worm', 'paste', 'doenjang'], method: ['rod', 'net', 'trap'], difficulty: 1, rarity: 8,
    look: {
      profile: { kind: 'fish', depth: curve(0.185, 0.36, 0.075), width: curve(0.115, 0.3, 0.03), arch: 0.03, head: 0.24, snout: 0.6, mouth: 'end', gape: 0.45, barbels: 0, eye: [0.085, 0.58, 0.05], lips: 0, section: 2.1, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.55, base: 0.09, h: 0.12, shape: 'round', rays: 7 }, tail: { len: 0.19, fork: 0.45, spread: 0.21, shape: 'fork' } }),
      colours: { back: '#56502e', side: '#c2b47c', belly: '#f2ecd6', fin: '#d8cc98', eye: '#d0b860', sheen: '#e8e6c0', gloss: 0.75 },
      marks: [
        { t: 'band', v: 0.5, w: 0.075, c: '#2e2a1e', a: 0.72, u0: 0.24, u1: 0.99 },
        { t: 'spots', n: 90, u0: 0.1, u1: 0.99, v0: 0.0, v1: 0.42, r0: 0.003, r1: 0.006, c: '#2e281a', a: 0.55, seed: 6 },
        { t: 'blotch', u: 0.985, v: 0.5, rx: 0.018, ry: 0.07, c: '#1e1c14', a: 0.7 },
      ],
      scales: 'fine',
    },
    kid: '버들치와 닮았지만 몸이 더 날씬해요. 옆구리의 검은 줄이 또렷해요.',
    sign: '버들치보다 가늘고 길어요. 옆구리 가운데의 짙은 줄이 머리 뒤부터 꼬리까지 또렷해요.',
    food: '물속 벌레와 물에 떨어진 벌레를 먹어요.',
    facts: [
      '버들치보다 더 차가운 물을 좋아해요.',
      '날씨가 더워지면 살 곳이 줄어드는 물고기라서, 학자들이 해마다 살펴봐요.',
      '초여름에 여울의 자갈 바닥에 알을 낳아요.',
      '요즘에는 사는 강에 따라 무리를 더 잘게 나누어 부르기도 해요.',
    ],
    clean: '차갑고 맑은 물이 한 해 내내 흘러야 해요.',
    sources: ['NIBR_HOME', 'REDBOOK'],
  });
  sp({
    id: 'BEODEULGAJI', name: '버들가지', sci: 'Rhynchocypris semotilus', family: '잉어과', size: { usual: [8, 11], max: 13 },
    habitat: ['cold', 'pool'], basin: 'east', water: 'Ia', endemic: true, home: '강원도 고성의 몇몇 골짜기 윗물에만 살아요',
    protected: PROT.E2('온 세상에서 강원도 고성의 몇몇 골짜기에만 살아요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [5, 6], hours: ['day'], weather: W.any, bait: ['larva'], method: ['net', 'trap'], difficulty: 2, rarity: 1,
    look: {
      profile: { kind: 'fish', depth: curve(0.235, 0.36, 0.1), width: curve(0.145, 0.3, 0.038), arch: 0.05, head: 0.26, snout: 0.35, mouth: 'end', gape: 0.5, barbels: 0, eye: [0.09, 0.58, 0.05], lips: 0, section: 2.1, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.55, base: 0.1, h: 0.12, shape: 'round', rays: 7 }, tail: { len: 0.17, fork: 0.3, spread: 0.23, shape: 'fork' } }),
      colours: { back: '#4a4228', side: '#a9955e', belly: '#ece3c6', fin: '#cdbd84', eye: '#c8ae58', sheen: '#e6d8a0', gloss: 0.7 },
      marks: [
        { t: 'spots', n: 190, u0: 0.1, u1: 0.99, v0: 0.0, v1: 0.78, r0: 0.004, r1: 0.008, c: '#241f14', a: 0.7, seed: 12 },
        { t: 'band', v: 0.5, w: 0.06, c: '#2e281a', a: 0.4, u0: 0.5, u1: 0.99, grow: 1 },
        { t: 'blotch', u: 0.56, v: 0.05, rx: 0.02, ry: 0.045, c: '#1a1812', a: 0.75 },
      ],
      scales: 'fine',
    },
    kid: '고성의 골짜기에만 사는 귀한 물고기예요. 버들치보다 통통해요.',
    sign: '버들치나 버들개보다 몸이 짧고 굵어요. 온몸에 짙은 점이 빽빽해요.',
    food: '주로 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 살고, 그 가운데서도 강원도 고성에만 사는 고유종이에요.',
      '사는 곳이 아주 좁아서, 골짜기 하나가 망가지면 크게 줄어들어요.',
      '금강모치와 생김새가 닮았지만 옆구리의 주황색 줄이 없어요.',
    ],
    clean: '사람 손이 닿지 않은 깊은 골짜기의 맑은 물이 있어야 해요.',
    sources: ['E_BEODEULGAJI', 'LAW_LIST', 'NIE'],
  });
  sp({
    id: 'SAEMI', name: '새미', sci: 'Ladislavia taczanowskii', family: '잉어과', size: { usual: [8, 10], max: 13 },
    habitat: ['cold', 'riffle', 'gravel'], basin: 'both', water: 'Ia', endemic: false, home: '한강과 임진강의 가장 윗물, 동해 북쪽으로 흐르는 강 (인제·양구·화천·고성)',
    protected: PROT.E2('찬물에만 사는 북쪽 물고기예요. 날씨가 더워지면서 살 곳이 줄어, 2022년부터 지켜요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요 (2022년 새로 정했어요).',
    months: WARM, spawn: [5, 6, 7], hours: ['day'], weather: W.any, bait: ['paste', 'larva'], method: ['net', 'trap'], difficulty: 2, rarity: 3,
    look: {
      profile: { kind: 'fish', depth: curve(0.18, 0.34, 0.085), width: curve(0.135, 0.3, 0.034), arch: 0.18, head: 0.22, snout: 0.15, mouth: 'low', gape: 0.3, barbels: 1, barbelLen: 0.02, eye: [0.085, 0.62, 0.045], lips: 0.4, section: 2.4, flatHead: 0.1 },
      fins: F_MINNOW({ dorsal: { at: 0.47, base: 0.1, h: 0.13, shape: 'tri', rays: 7 }, tail: { len: 0.19, fork: 0.5, spread: 0.22, shape: 'fork' } }),
      colours: { back: '#4f4a30', side: '#bdb07c', belly: '#f1ecd8', fin: '#d6caa0', eye: '#c8b060', sheen: '#e0e0b8', gloss: 0.7 },
      marks: [
        { t: 'band', v: 0.5, w: 0.085, c: '#28251a', a: 0.78, u0: 0.02, u1: 0.99 },
        { t: 'band', v: 0.38, w: 0.03, c: '#e9dea4', a: 0.5, u0: 0.22, u1: 0.99 },
        { t: 'spots', n: 70, u0: 0.1, u1: 0.99, v0: 0.0, v1: 0.36, r0: 0.004, r1: 0.007, c: '#2a261a', a: 0.5, seed: 15 },
      ],
      scales: 'fine',
    },
    kid: '돌에 붙은 물풀을 긁어 먹는 입을 가졌어요. 찬물에만 살아요.',
    sign: '주둥이가 뭉툭하고 입이 아래쪽에 있어요. 주둥이에서 꼬리까지 검은 줄이 한 줄 지나가요.',
    food: '바위에 붙은 물풀을 아랫입술로 긁어 먹고, 물속 벌레도 먹어요.',
    facts: [
      '북쪽 추운 나라에 널리 사는 물고기예요. 우리나라에서는 가장 차가운 윗물에만 살아요.',
      '인제 방태천에서는 금강모치, 참갈겨니 다음으로 많은 물고기였어요.',
      '아랫입술이 단단해서 돌 겉을 긁기 좋아요.',
    ],
    clean: '돌 겉에 흙이 쌓이지 않아야 먹이인 물풀이 깨끗하게 자라요.',
    sources: ['SAEMI_PAPER', 'BANGTAE', 'LAW_LIST'],
  });

  // ---- 잉어과: 여울의 물고기 -------------------------------------------------------------------------------------------
  sp({
    id: 'SWIRI', name: '쉬리', sci: 'Coreoleuciscus splendidus', family: '잉어과', size: { usual: [10, 13], max: 15 },
    habitat: ['riffle', 'gravel'], basin: 'both', water: 'Ib', endemic: true, home: '한강 윗물과 가운데 물의 맑은 여울 (평창·영월·정선·홍천·인제), 동해로 흐르는 강',
    months: WARM, spawn: [4, 5, 6], hours: ['day', 'dawn'], weather: W.sun, bait: ['larva', 'fly'], method: ['gyeonji', 'net', 'rod'], difficulty: 2, rarity: 7,
    look: {
      profile: { kind: 'fish', depth: curve(0.175, 0.36, 0.07), width: curve(0.115, 0.3, 0.028), arch: 0.02, head: 0.25, snout: 0.9, mouth: 'under', gape: 0.3, barbels: 0, eye: [0.105, 0.6, 0.045], lips: 0.1, section: 2.0, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.46, base: 0.1, h: 0.15, shape: 'tri', rays: 8 }, tail: { len: 0.21, fork: 0.7, spread: 0.24, shape: 'fork' } }),
      colours: { back: '#2a3140', side: '#c9d0cf', belly: '#f7f6ee', fin: '#eef0e4', eye: '#d8d0a0', sheen: '#c8b8ff', gloss: 0.95 },
      marks: [
        { t: 'band', v: 0.2, w: 0.1, c: '#3a4a86', a: 0.55, u0: 0.2, u1: 0.99 },
        { t: 'band', v: 0.33, w: 0.07, c: '#7a5aa8', a: 0.45, u0: 0.22, u1: 0.99 },
        { t: 'band', v: 0.5, w: 0.13, c: '#f0b020', a: 0.95, u0: 0.24, u1: 0.99 },
        { t: 'band', v: 0.62, w: 0.045, c: '#e06a1a', a: 0.55, u0: 0.26, u1: 0.99 },
        { t: 'band', v: 0.5, w: 0.07, c: '#16181c', a: 0.9, u0: 0.0, u1: 0.25 },
        { t: 'fin', fin: 'dorsal', kind: 'bands', n: 3, c: '#16181c', a: 0.8 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#16181c', a: 0.8 }, { t: 'fin', fin: 'anal', kind: 'bands', n: 2, c: '#16181c', a: 0.7 },
      ],
      scales: 'fine',
    },
    kid: '노란 줄, 보랏빛 줄이 고운 여울의 멋쟁이예요. 우리나라에만 살아요.',
    sign: '옆구리에 넓은 노란 줄이 있고, 주둥이에서 눈을 지나 아가미뚜껑까지 검은 줄이 있어요. 지느러미에는 검은 줄무늬가 있어요.',
    food: '여울 돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '물이 맑고 자갈이 깔린 여울에서 날쌔게 헤엄쳐요.',
      '봄(4~5월)에 여울의 자갈이나 큰 돌 아래에 알을 낳아요.',
      '몸이 날씬하고 주둥이가 뾰족해서 빠른 물살을 잘 가르며 헤엄쳐요.',
    ],
    clean: '여울 자갈 틈이 진흙으로 메워지면 먹이인 물속 벌레도, 알 낳을 자리도 사라져요.',
    sources: ['N_SWIRI', 'E_SWIRI', 'ENV_STANDARD'],
  });
  sp({
    id: 'CHAMGALGYEONI', name: '참갈겨니', sci: 'Zacco koreanus', family: '잉어과', size: { usual: [12, 17], max: 20 },
    habitat: ['riffle', 'pool'], basin: 'both', water: 'Ib', endemic: true, home: '강원도의 맑은 계곡과 강 윗물 어디에나',
    months: WARM, spawn: [6, 7, 8], hours: ['day', 'dawn', 'dusk'], weather: W.sun, bait: ['fly', 'larva', 'paste'], method: ['gyeonji', 'rod', 'trap'], difficulty: 2, rarity: 9,
    look: {
      profile: { kind: 'fish', depth: curve(0.26, 0.38, 0.09), width: curve(0.1, 0.3, 0.028), arch: 0.0, head: 0.26, snout: 0.4, mouth: 'end', gape: 0.6, barbels: 0, eye: [0.09, 0.6, 0.066], lips: 0, section: 2.0, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.48, base: 0.11, h: 0.16, shape: 'tri', rays: 8 }, anal: { at: 0.66, base: 0.13, h: 0.17, shape: 'long', rays: 10 }, tail: { len: 0.22, fork: 0.65, spread: 0.3, shape: 'fork' } }),
      colours: { back: '#4a5a44', side: '#cfd2bc', belly: '#f4f0da', fin: '#e8d27a', eye: '#d8cc90', sheen: '#bfe6e0', gloss: 0.9 },
      marks: [
        { t: 'band', v: 0.5, w: 0.2, c: '#2b4a52', a: 0.72, u0: 0.26, u1: 0.99, grow: 0.6 },
        { t: 'band', v: 0.74, w: 0.16, c: '#e8c84a', a: 0.4, u0: 0.24, u1: 0.95 },
        { t: 'fin', fin: 'anal', kind: 'tint', c: '#e6c040', a: 0.7 }, { t: 'fin', fin: 'pectoral', kind: 'tint', c: '#e6c040', a: 0.6 }, { t: 'fin', fin: 'pelvic', kind: 'tint', c: '#e6c040', a: 0.6 },
      ],
      scales: 'medium',
      breeding: { months: [6, 7, 8], colours: { belly: '#f0c048' }, marks: [{ t: 'band', v: 0.85, w: 0.22, c: '#e87a3a', a: 0.4, u0: 0.2, u1: 0.8 }] },
    },
    kid: '눈이 크고 옆구리에 짙푸른 넓은 줄이 있어요. 물 위로 톡 튀어 벌레를 잡아요.',
    sign: '눈이 크고 비늘이 커요. 옆구리 가운데에 넓고 짙은 푸른 줄이 있고, 가슴·배·뒷지느러미가 노래요.',
    food: '물에 떨어진 벌레와 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '여울과 소를 오가며 떼 지어 다녀요.',
      '여름(6~8월)에 알을 낳아요. 그때 수컷은 배가 노랗고 붉게 물들어요.',
      '인제 방태천에서는 금강모치 다음으로 많은 물고기였어요.',
    ],
    clean: '물가의 나무에서 떨어지는 벌레가 중요한 먹이예요. 물가 숲이 있어야 잘 살아요.',
    sources: ['BANGTAE', 'REDBOOK', 'E_GALGYEONI'],
  });
  sp({
    id: 'EOREUMCHI', name: '어름치', sci: 'Hemibarbus mylodon', family: '잉어과', size: { usual: [20, 30], max: 40 },
    habitat: ['riffle', 'gravel', 'pool'], basin: 'west', water: 'Ib', endemic: true, home: '한강과 임진강의 맑은 여울 (정선·영월·평창·인제·화천)',
    protected: PROT.ME2('물고기 가운데 드물게 종 자체가 천연기념물(제259호)이에요. 2022년부터는 멸종위기 야생생물이기도 해요.'),
    guard: '국가유산청이 천연기념물로, 환경부가 멸종위기 야생생물 Ⅱ급으로 함께 지켜요.',
    months: [4, 5, 6, 7, 8, 9, 10], spawn: [4, 5], hours: ['day', 'dusk'], weather: W.any, bait: ['larva', 'worm'], method: ['rod', 'gyeonji'], difficulty: 4, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.21, 0.34, 0.08, { front: 0.75 }), width: curve(0.135, 0.28, 0.03), arch: 0.12, head: 0.27, snout: 0.85, mouth: 'low', gape: 0.4, barbels: 1, barbelLen: 0.03, eye: [0.13, 0.66, 0.05], lips: 0.2, section: 2.2, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.43, base: 0.12, h: 0.18, shape: 'tri', rays: 8 }, tail: { len: 0.22, fork: 0.7, spread: 0.28, shape: 'fork' } }),
      colours: { back: '#5a5034', side: '#d9d3ba', belly: '#f8f5ea', fin: '#e8e0c4', eye: '#d8c890', sheen: '#f0f0e0', gloss: 0.9 },
      marks: [
        { t: 'rows', rows: 7, n: 30, u0: 0.24, u1: 0.99, v0: 0.14, v1: 0.74, r: 0.0075, c: '#17150f', a: 0.92 },
        { t: 'fin', fin: 'dorsal', kind: 'bands', n: 3, c: '#17150f', a: 0.85 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 4, c: '#17150f', a: 0.85 }, { t: 'fin', fin: 'anal', kind: 'bands', n: 2, c: '#17150f', a: 0.6 },
      ],
      scales: 'medium',
      breeding: { months: [4, 5], colours: { belly: '#8a8478' }, marks: [] },
    },
    kid: '옆구리에 검은 점이 일곱여덟 줄 줄지어 있어요. 돌탑을 쌓는 물고기예요.',
    sign: '은빛 옆구리에 검은 점이 7~8줄로 나란해요. 등지느러미와 꼬리지느러미에는 검은 줄무늬가 있어요.',
    food: '물속 벌레와 다슬기를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '봄(4월 말~5월)에 자갈 바닥에 알을 낳고, 그 위에 잔자갈을 물어다 쌓아요. 이것을 산란탑이라고 해요.',
      '산란탑은 알이 물살에 떠내려가거나 먹히지 않게 지켜 줘요.',
      '물이 달라지는 것에 아주 예민해서, 어름치가 사는 강은 건강한 강이에요.',
    ],
    clean: '맑은 물과 깨끗한 자갈밭이 있어야 탑을 쌓을 수 있어요. 강바닥을 파헤치면 살 수 없어요.',
    sources: ['E_EOREUM', 'HERITAGE_EOREUM', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'BAEGASARI', name: '배가사리', sci: 'Microphysogobio longidorsalis', family: '잉어과', size: { usual: [8, 12], max: 14 },
    habitat: ['riffle', 'gravel'], basin: 'west', water: 'Ib', endemic: true, home: '한강과 임진강의 맑은 자갈 여울 (인제·홍천·평창·영월)',
    months: WARM, spawn: [5, 6, 7], hours: ['day'], weather: W.sun, bait: ['paste', 'larva'], method: ['net', 'trap', 'gyeonji'], difficulty: 2, rarity: 6,
    look: {
      profile: { kind: 'fish', depth: curve(0.19, 0.32, 0.075), width: curve(0.14, 0.28, 0.03), arch: 0.4, head: 0.22, snout: 0.3, mouth: 'low', gape: 0.3, barbels: 1, barbelLen: 0.02, eye: [0.085, 0.72, 0.05], lips: 0.6, section: 2.6, flatHead: 0.15 },
      fins: F_MINNOW({ dorsal: { at: 0.38, base: 0.16, h: 0.22, shape: 'sail', rays: 8 }, tail: { len: 0.2, fork: 0.5, spread: 0.24, shape: 'fork' }, pectoral: { at: 0.22, len: 0.16, fan: 1, low: 1 } }),
      colours: { back: '#4f462c', side: '#c8b98a', belly: '#f7f3e6', fin: '#e0d4a8', eye: '#c8b470', sheen: '#f0e8b8', gloss: 0.7 },
      marks: [
        { t: 'parr', n: 8, u0: 0.26, u1: 0.98, v: 0.52, rx: 0.028, ry: 0.07, c: '#2a2416', a: 0.75 },
        { t: 'band', v: 0.36, w: 0.045, c: '#eadf9e', a: 0.7, u0: 0.22, u1: 0.99 },
        { t: 'saddles', n: 6, u0: 0.24, u1: 0.95, depth: 0.22, w: 0.04, c: '#2a2416', a: 0.5 },
        { t: 'fin', fin: 'dorsal', kind: 'spots', n: 12, c: '#2a2416', a: 0.6 },
      ],
      scales: 'medium',
      breeding: { months: [5, 6, 7], colours: { side: '#4a4436', back: '#26221a', belly: '#b9b2a0' }, marks: [{ t: 'fin', fin: 'dorsal', kind: 'edge', c: '#e03a2a', a: 0.9 }] },
    },
    kid: '등지느러미가 돛처럼 커요. 배가 납작해서 바닥에 딱 붙어 지내요.',
    sign: '등지느러미가 크고 둥글게 솟았어요. 옆구리에 짙은 무늬가 8개쯤 줄지어 있어요.',
    food: '돌에 붙은 물풀을 긁어 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '알 낳는 철의 수컷은 온몸이 검어지고, 등지느러미 가장자리가 붉게 빛나요.',
      '입이 아래쪽에 있어서 바닥의 먹이를 먹기 좋아요.',
    ],
    clean: '자갈 겉에 깨끗한 물풀이 자라야 먹을 수 있어요.',
    sources: ['E_BAEGA', 'BANGTAE', 'REDBOOK'],
  });
  sp({
    id: 'DOLGOGI', name: '돌고기', sci: 'Pungtungia herzi', family: '잉어과', size: { usual: [10, 14], max: 15 },
    habitat: ['stone', 'pool', 'riffle', 'edge'], basin: 'both', water: 'Ib', endemic: false, home: '강원도의 맑은 강과 계곡의 돌 많은 곳',
    months: LONG, spawn: [5, 6], hours: ['day', 'dusk'], weather: W.any, bait: ['worm', 'larva', 'paste', 'doenjang'], method: ['rod', 'trap', 'net'], difficulty: 1, rarity: 8,
    look: {
      profile: { kind: 'fish', depth: curve(0.225, 0.36, 0.1), width: curve(0.16, 0.3, 0.04), arch: 0.06, head: 0.24, snout: 0.5, mouth: 'end', gape: 0.2, barbels: 1, barbelLen: 0.012, eye: [0.105, 0.62, 0.045], lips: 0.9, section: 2.3, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.46, base: 0.11, h: 0.14, shape: 'round', rays: 7 }, tail: { len: 0.19, fork: 0.45, spread: 0.25, shape: 'fork' } }),
      colours: { back: '#4a3f28', side: '#b9a676', belly: '#f0e8cf', fin: '#dccf9c', eye: '#c8ae60', sheen: '#e8dcb0', gloss: 0.7 },
      marks: [
        { t: 'band', v: 0.5, w: 0.13, c: '#17140e', a: 0.9, u0: 0.0, u1: 0.99 },
        { t: 'band', v: 0.36, w: 0.035, c: '#e7d79a', a: 0.6, u0: 0.2, u1: 0.99 },
        { t: 'fin', fin: 'dorsal', kind: 'bands', n: 1, c: '#2a241a', a: 0.45 },
      ],
      scales: 'medium',
    },
    kid: '주둥이가 돼지 코처럼 생겼어요. 온몸에 검은 줄이 한 줄 굵게 지나가요.',
    sign: '주둥이 끝에서 꼬리까지 굵고 검은 줄이 있고, 입술이 두툼해요.',
    food: '돌 틈의 물속 벌레와 물풀을 쪼아 먹어요.',
    facts: [
      '두툼한 입으로 돌 겉을 톡톡 쪼며 먹이를 찾아요.',
      '꺽지가 알을 지키는 돌 밑에 제 알을 슬쩍 낳아 두기도 해요. 꺽지가 그 알까지 지켜 줘요.',
      '맑은 물을 좋아하지만 여러 곳에 잘 적응해 살아요.',
    ],
    clean: '돌과 바위가 많은 맑은 물이 있어야 숨을 곳과 먹이가 있어요.',
    sources: ['BANGTAE', 'NIBR_HOME'],
  });
  sp({
    id: 'GANEUNDOLGOGI', name: '가는돌고기', sci: 'Pseudopungtungia tenuicorpa', family: '잉어과', size: { usual: [8, 10], max: 11 },
    habitat: ['riffle', 'stone'], basin: 'west', water: 'Ib', endemic: true, home: '한강과 임진강 윗물의 큰 돌이 많은 여울 (인제·홍천·평창·영월·횡성)',
    protected: PROT.E2('사는 곳이 망가지며 수가 빠르게 줄어, 2005년부터 지켜요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [5, 6], hours: ['day'], weather: W.any, bait: ['larva'], method: ['net', 'trap'], difficulty: 2, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.165, 0.36, 0.075), width: curve(0.12, 0.3, 0.03), arch: 0.02, head: 0.24, snout: 0.6, mouth: 'end', gape: 0.2, barbels: 1, barbelLen: 0.01, eye: [0.1, 0.62, 0.045], lips: 0.6, section: 2.2, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.47, base: 0.1, h: 0.13, shape: 'tri', rays: 7 }, tail: { len: 0.2, fork: 0.55, spread: 0.22, shape: 'fork' } }),
      colours: { back: '#5a4a2c', side: '#c4ae7c', belly: '#e9dcbc', fin: '#dccf9c', eye: '#c8ae60', sheen: '#e8dcb0', gloss: 0.7 },
      marks: [
        { t: 'band', v: 0.5, w: 0.15, c: '#17140e', a: 0.88, u0: 0.0, u1: 0.99 },
        { t: 'band', v: 0.34, w: 0.04, c: '#eadb9e', a: 0.6, u0: 0.2, u1: 0.99 },
        { t: 'fin', fin: 'dorsal', kind: 'bands', n: 1, c: '#17140e', a: 0.75 },
      ],
      scales: 'fine',
    },
    kid: '돌고기보다 훨씬 날씬해요. 한강 윗물에만 사는 귀한 친구예요.',
    sign: '돌고기를 닮았지만 몸이 작고 가늘며, 머리에서 꼬리까지 거의 곧아요. 등지느러미에 검은 띠가 있어요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라 한강과 임진강 윗물에만 사는 고유종이에요.',
      '작은 무리를 지어 큰 돌 밑이나 바위 틈에 알을 낳아요.',
      '돌고기처럼 꺽지의 알자리에 알을 맡기기도 해요.',
    ],
    clean: '큰 돌이 깔린 맑은 여울이 그대로 있어야 살 수 있어요.',
    sources: ['E_GANEUN', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'DOLSANGEO', name: '돌상어', sci: 'Gobiobotia brevibarba', family: '잉어과', size: { usual: [10, 13], max: 15 },
    habitat: ['riffle', 'stone'], basin: 'west', water: 'Ib', endemic: true, home: '한강·임진강 윗물의 아주 빠른 여울 (인제·홍천·평창·영월)',
    protected: PROT.E2('빠른 여울이 강 공사와 둑으로 사라지면서 살 곳을 잃었어요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [4, 5], hours: ['day', 'dusk', 'night'], weather: W.any, bait: [], method: ['net'], difficulty: 3, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.19, 0.3, 0.07, { front: 0.6 }), width: curve(0.19, 0.24, 0.03, { front: 0.55 }), arch: 0.6, head: 0.26, snout: 0.35, mouth: 'low', gape: 0.35, barbels: 4, barbelLen: 0.018, eye: [0.12, 0.84, 0.04], lips: 0.4, section: 2.8, flatHead: 0.5 },
      fins: F_BENTHIC(),
      colours: { back: '#6a5632', side: '#d2b97c', belly: '#f6efd8', fin: '#e6d6a4', eye: '#bfa860', sheen: '#e8d8a8', gloss: 0.6 },
      marks: [
        { t: 'saddles', n: 7, u0: 0.2, u1: 0.98, depth: 0.42, w: 0.05, c: '#2e2414', a: 0.75 },
        { t: 'parr', n: 7, u0: 0.26, u1: 0.98, v: 0.56, rx: 0.03, ry: 0.06, c: '#2e2414', a: 0.55 },
        { t: 'spots', n: 60, u0: 0.02, u1: 0.3, v0: 0.0, v1: 0.5, r0: 0.004, r1: 0.007, c: '#2e2414', a: 0.5, seed: 21 },
        { t: 'fin', fin: 'pectoral', kind: 'bands', n: 3, c: '#2e2414', a: 0.5 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#2e2414', a: 0.5 }, { t: 'fin', fin: 'dorsal', kind: 'bands', n: 2, c: '#2e2414', a: 0.5 },
      ],
      scales: 'fine',
    },
    kid: '빠른 물살 속 돌에 딱 붙어 사는 작은 물고기예요. 넓은 가슴지느러미가 상어 같아요.',
    sign: '배가 납작하고 등이 둥글어요. 짧은 수염이 4쌍 있고, 등에 짙은 안장 무늬가 줄지어 있어요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '큰 돌이 깔리고 물살이 아주 빠른 여울 바닥에서만 살아요.',
      '넓게 펼친 가슴지느러미로 물살을 눌러 바닥에 붙어 있어요.',
    ],
    clean: '빠른 여울이 있어야 해요. 강을 반듯하게 파내면 여울이 사라져요.',
    sources: ['E_DOLSANG', 'B_DOLSANG', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'KKUGURI', name: '꾸구리', sci: 'Gobiobotia macrocephala', family: '잉어과', size: { usual: [7, 10], max: 13 },
    habitat: ['riffle', 'gravel', 'stone'], basin: 'west', water: 'Ib', endemic: true, home: '한강·임진강의 자갈 여울 (영월·횡성·홍천·평창)',
    protected: PROT.E2('우리나라 몇몇 강의 여울에만 살아요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [4, 5, 6], hours: ['dusk', 'night', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 3, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.2, 0.28, 0.07, { front: 0.55 }), width: curve(0.2, 0.22, 0.03, { front: 0.5 }), arch: 0.6, head: 0.29, snout: 0.25, mouth: 'low', gape: 0.35, barbels: 4, barbelLen: 0.035, eye: [0.13, 0.86, 0.042], lips: 0.4, section: 2.8, flatHead: 0.5 },
      fins: F_BENTHIC({ pectoral: { at: 0.24, len: 0.19, fan: 1, low: 1 } }),
      colours: { back: '#5e4a2a', side: '#d0b47a', belly: '#f6eed6', fin: '#e4d2a0', eye: '#c0a858', sheen: '#e8d8a8', gloss: 0.6, pupil: 'slit' },
      marks: [
        { t: 'bars', n: 4, u0: 0.3, u1: 0.96, v0: 0.0, v1: 0.72, w: 0.07, c: '#2a1f10', a: 0.78, jitter: 0.15, seed: 2 },
        { t: 'spots', n: 70, u0: 0.02, u1: 0.3, v0: 0.0, v1: 0.5, r0: 0.004, r1: 0.008, c: '#2a1f10', a: 0.55, seed: 23 },
        { t: 'fin', fin: 'pectoral', kind: 'bands', n: 3, c: '#2a1f10', a: 0.55 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#2a1f10', a: 0.55 }, { t: 'fin', fin: 'dorsal', kind: 'bands', n: 2, c: '#2a1f10', a: 0.55 },
      ],
      scales: 'fine',
      breeding: { months: [4, 5, 6], colours: { side: '#b08a4a', back: '#4a3418' }, marks: [] },
    },
    kid: '고양이처럼 눈을 가늘게 뜨는 물고기예요. 머리가 크고 수염이 많아요.',
    sign: '눈에 눈꺼풀 같은 살이 있어 눈동자가 가늘게 보여요. 몸에 짙은 띠가 서너 개 있어요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '밝은 곳에서는 눈을 가늘게 하고, 어두우면 크게 떠요. 우리나라 민물고기 가운데 이런 눈은 드물어요.',
      '알 낳는 철에는 암컷은 노란빛, 수컷은 짙은 갈색을 띠어요.',
    ],
    clean: '자갈 여울의 돌 틈이 깨끗해야 숨고 먹고 알을 낳을 수 있어요.',
    sources: ['E_KKUGURI', 'LAW_LIST', 'NIE'],
  });

  // ---- 잉어과: 납자루 무리 ---------------------------------------------------------------------------------------------
  sp({
    id: 'MUKNAPJARU', name: '묵납자루', sci: 'Acheilognathus signifer', family: '잉어과', size: { usual: [5, 7], max: 8 },
    habitat: ['edge', 'pool'], basin: 'west', water: 'Ib', endemic: true, home: '한강 윗물의 물살이 느리고 풀이 있는 맑은 물가 (홍천·횡성·인제·화천)',
    protected: PROT.E2('알을 맡길 민물조개가 사라지면 함께 사라져요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [4, 5, 6], hours: ['day'], weather: W.sun, bait: ['paste', 'doenjang'], method: ['trap', 'net'], difficulty: 2, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.4, 0.42, 0.11, { front: 0.6, rear: 1.0 }), width: curve(0.11, 0.34, 0.028), arch: 0.1, head: 0.25, snout: 0.25, mouth: 'end', gape: 0.2, barbels: 1, barbelLen: 0.012, eye: [0.1, 0.62, 0.075], lips: 0, section: 2.0, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.44, base: 0.26, h: 0.17, shape: 'sail', rays: 11 }, anal: { at: 0.6, base: 0.2, h: 0.14, shape: 'long', rays: 10 }, tail: { len: 0.24, fork: 0.5, spread: 0.3, shape: 'fork' }, pelvic: { at: 0.46, len: 0.11 } }),
      colours: { back: '#2e3028', side: '#6f6a52', belly: '#bfb48e', fin: '#4a463a', eye: '#c8b470', sheen: '#7ad0c0', gloss: 0.95 },
      marks: [
        { t: 'band', v: 0.48, w: 0.05, c: '#2a8a90', a: 0.75, u0: 0.55, u1: 0.99 },
        { t: 'blotch', u: 0.3, v: 0.36, rx: 0.02, ry: 0.05, c: '#1a1c18', a: 0.6 },
        { t: 'fin', fin: 'dorsal', kind: 'band', c: '#e8c838', a: 0.9 }, { t: 'fin', fin: 'anal', kind: 'band', c: '#e8c838', a: 0.9 },
        { t: 'fin', fin: 'dorsal', kind: 'edge', c: '#141412', a: 0.9 }, { t: 'fin', fin: 'anal', kind: 'edge', c: '#141412', a: 0.9 },
      ],
      scales: 'large',
      breeding: { months: [4, 5, 6], colours: { side: '#4a4660', back: '#22222a' }, marks: [] },
    },
    kid: '먹물처럼 짙은 빛의 납작한 물고기예요. 조개 속에 알을 낳아요.',
    sign: '몸이 납작하고 높아요. 몸빛이 짙고, 등지느러미와 뒷지느러미에 노란 띠와 검은 테가 있어요.',
    food: '돌과 풀에 붙은 물풀을 주로 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '암컷은 긴 관을 내어 작은말조개 같은 민물조개의 몸속에 알을 낳아요.',
      '새끼는 조개 속에서 안전하게 자란 뒤 헤엄쳐 나와요.',
      '조개가 살 수 없는 물에서는 묵납자루도 살 수 없어요.',
    ],
    clean: '맑은 물과 모래·자갈 바닥에 사는 민물조개가 함께 있어야 해요.',
    sources: ['E_MUK', 'B_MUK', 'NIE', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'HANGANGNAPJULGAE', name: '한강납줄개', sci: 'Rhodeus pseudosericeus', family: '잉어과', size: { usual: [5, 7], max: 8 },
    habitat: ['edge'], basin: 'west', water: 'Ib', endemic: true, home: '한강 윗물의 풀이 있는 맑은 작은 물길 (횡성·홍천·원주)',
    protected: PROT.E2('한강 물길의 몇 곳에만 살아요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: WARM, spawn: [4, 5, 6], hours: ['day'], weather: W.sun, bait: ['paste', 'doenjang'], method: ['trap', 'net'], difficulty: 2, rarity: 1,
    look: {
      profile: { kind: 'fish', depth: curve(0.37, 0.42, 0.1, { front: 0.6, rear: 1.0 }), width: curve(0.1, 0.34, 0.026), arch: 0.08, head: 0.25, snout: 0.3, mouth: 'end', gape: 0.2, barbels: 0, eye: [0.1, 0.62, 0.075], lips: 0, section: 2.0, flatHead: 0 },
      fins: F_MINNOW({ dorsal: { at: 0.45, base: 0.2, h: 0.15, shape: 'sail', rays: 10 }, anal: { at: 0.6, base: 0.17, h: 0.13, shape: 'long', rays: 10 }, tail: { len: 0.24, fork: 0.5, spread: 0.3, shape: 'fork' } }),
      colours: { back: '#5a6048', side: '#cfd0c0', belly: '#f4f0e4', fin: '#e0d8c8', eye: '#d8c880', sheen: '#ffd0e0', gloss: 1.0 },
      marks: [
        { t: 'band', v: 0.47, w: 0.05, c: '#2a9a8a', a: 0.85, u0: 0.5, u1: 0.99 },
        { t: 'blotch', u: 0.32, v: 0.4, rx: 0.025, ry: 0.06, c: '#3a6a7a', a: 0.45 },
        { t: 'fin', fin: 'dorsal', kind: 'tint', c: '#e06a5a', a: 0.4 }, { t: 'fin', fin: 'anal', kind: 'edge', c: '#141412', a: 0.8 },
      ],
      scales: 'large',
      breeding: { months: [4, 5, 6], colours: { side: '#e0b8c0' }, marks: [{ t: 'fin', fin: 'anal', kind: 'tint', c: '#e04a4a', a: 0.6 }] },
    },
    kid: '은빛 몸 뒤쪽에 푸른 줄이 반짝여요. 조개 속에 알을 낳는 작은 물고기예요.',
    sign: '몸이 납작하고 은빛이에요. 등지느러미 아래에서 꼬리까지 가느다란 청록색 줄이 있어요.',
    food: '물풀과 작은 물속 벌레를 먹어요.',
    facts: [
      '우리나라 한강 물길에만 사는 고유종이에요.',
      '묵납자루처럼 민물조개의 몸속에 알을 낳아요.',
      '알 낳는 철의 수컷은 몸이 분홍빛으로 물들어요.',
    ],
    clean: '풀이 자라는 맑은 물가와 민물조개가 함께 있어야 해요.',
    sources: ['LAW_LIST', 'NIE', 'REDBOOK'],
  });

  // ---- 꺽지과 · 둑중개과 -----------------------------------------------------------------------------------------------
  sp({
    id: 'KKEOKJI', name: '꺽지', sci: 'Coreoperca herzi', family: '꺽지과', size: { usual: [12, 18], max: 25 },
    habitat: ['stone', 'pool'], basin: 'west', water: 'Ib', endemic: true, home: '강원도 한강 물길의 바위와 돌이 많은 맑은 물',
    months: [4, 5, 6, 7, 8, 9, 10], spawn: [5, 6, 7], hours: ['dusk', 'dawn', 'night'], weather: W.cloudy, bait: ['worm', 'larva'], method: ['rod'], difficulty: 3, rarity: 5,
    look: {
      profile: { kind: 'fish', depth: curve(0.36, 0.36, 0.13, { front: 0.6 }), width: curve(0.15, 0.28, 0.04), arch: 0.1, head: 0.36, snout: 0.5, mouth: 'up', gape: 0.9, barbels: 0, eye: [0.12, 0.66, 0.06], lips: 0.2, section: 2.1, flatHead: 0 },
      fins: fins({
        dorsal: { at: 0.36, base: 0.3, h: 0.11, shape: 'spiny', rays: 13 }, dorsal2: { at: 0.67, base: 0.16, h: 0.15, shape: 'round', rays: 12 },
        anal: { at: 0.68, base: 0.13, h: 0.14, shape: 'round', rays: 9 }, pelvic: { at: 0.4, len: 0.13 }, pectoral: { at: 0.34, len: 0.16, fan: 1, low: 0 },
        tail: { len: 0.2, fork: 0, spread: 0.26, shape: 'round' },
      }),
      colours: { back: '#4a4426', side: '#9c8c52', belly: '#d9cfa4', fin: '#8a7a44', eye: '#b0503a', sheen: '#d8e0a0', gloss: 0.75 },
      marks: [
        { t: 'bars', n: 7, u0: 0.34, u1: 0.98, v0: 0.0, v1: 0.85, w: 0.045, c: '#1f1c10', a: 0.6, jitter: 0.25, seed: 6 },
        { t: 'spots', n: 120, u0: 0.3, u1: 0.99, v0: 0.05, v1: 0.9, r0: 0.004, r1: 0.008, c: '#e8dc9a', a: 0.55, seed: 17 },
        { t: 'blotch', u: 0.335, v: 0.42, rx: 0.022, ry: 0.07, c: '#103c3a', a: 0.95, ring: '#3ab8a8' },
        { t: 'bars', n: 3, u0: 0.1, u1: 0.3, v0: 0.3, v1: 0.9, w: 0.02, c: '#1f1c10', a: 0.45, slant: 0.5, seed: 3 },
        { t: 'fin', fin: 'dorsal2', kind: 'spots', n: 14, c: '#2a2414', a: 0.5 }, { t: 'fin', fin: 'tail', kind: 'spots', n: 16, c: '#2a2414', a: 0.5 },
      ],
      scales: 'medium',
    },
    kid: '아가미뚜껑에 눈처럼 생긴 청록색 점이 있어요. 아빠가 알을 지켜요.',
    sign: '몸이 높고 입이 커요. 몸에 짙은 세로 띠가 7~8개 있고, 아가미뚜껑에 눈 모양의 청록색 점이 있어요.',
    food: '작은 물고기와 새우, 물속 벌레를 숨어 있다가 덥석 물어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '낮에는 바위 틈에 숨어 있다가 어둑해지면 사냥을 나서요.',
      '초여름에 돌 밑에 알을 붙이고, 수컷이 새끼가 나올 때까지 곁에서 지켜요.',
      '기분과 둘레에 따라 몸빛과 무늬가 짙어졌다 옅어졌다 해요.',
    ],
    clean: '숨을 바위와 돌이 있고, 먹이가 될 작은 물고기가 많은 건강한 물이어야 해요.',
    sources: ['KKEOKJI_PAPER', 'NIBR_HOME', 'REDBOOK'],
  });
  sp({
    id: 'DUKJUNGGAE', name: '둑중개', sci: 'Cottus koreanus', family: '둑중개과', size: { usual: [8, 12], max: 15 },
    habitat: ['stone', 'cold', 'riffle'], basin: 'west', water: 'Ia', endemic: true, home: '한강 윗물의 물살 빠른 찬 여울 (인제·평창·정선·홍천·화천)',
    protected: PROT.E2('찬 윗물의 돌 밑에만 살아서 2022년부터 지켜요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요 (2022년 새로 정했어요).',
    months: LONG, spawn: [3, 4, 5], hours: ['night', 'dusk', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 3, rarity: 3,
    look: {
      profile: { kind: 'fish', depth: curve(0.21, 0.22, 0.06, { front: 0.5, rear: 0.9 }), width: curve(0.25, 0.17, 0.028, { front: 0.5, rear: 0.85 }), arch: 0.45, head: 0.31, snout: 0.15, mouth: 'end', gape: 0.95, barbels: 0, eye: [0.11, 0.9, 0.045], lips: 0.3, section: 2.6, flatHead: 0.75 },
      fins: fins({
        dorsal: { at: 0.34, base: 0.14, h: 0.08, shape: 'round', rays: 8 }, dorsal2: { at: 0.5, base: 0.4, h: 0.12, shape: 'low', rays: 18 },
        anal: { at: 0.56, base: 0.32, h: 0.1, shape: 'low', rays: 14 }, pelvic: { at: 0.33, len: 0.1 }, pectoral: { at: 0.3, len: 0.24, fan: 1, low: 1 },
        tail: { len: 0.19, fork: 0, spread: 0.2, shape: 'round' },
      }),
      colours: { back: '#4a4a30', side: '#8f8a5e', belly: '#ece6cf', fin: '#b9b084', eye: '#b8a050', sheen: '#c8d0a0', gloss: 0.9 },
      marks: [
        { t: 'saddles', n: 5, u0: 0.3, u1: 0.98, depth: 0.7, w: 0.07, c: '#22200f', a: 0.72 },
        { t: 'mottle', n: 40, u0: 0.0, u1: 0.99, v0: 0.0, v1: 0.8, r0: 0.012, r1: 0.03, c: '#2a2814', a: 0.4, seed: 31 },
        { t: 'mottle', n: 22, u0: 0.1, u1: 0.99, v0: 0.2, v1: 0.8, r0: 0.012, r1: 0.022, c: '#cfc89a', a: 0.4, seed: 32 },
        { t: 'fin', fin: 'pectoral', kind: 'bands', n: 4, c: '#22200f', a: 0.6 }, { t: 'fin', fin: 'dorsal2', kind: 'bands', n: 3, c: '#22200f', a: 0.5 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#22200f', a: 0.55 },
      ],
      scales: 'none',
    },
    kid: '머리가 크고 납작해요. 찬 윗물의 돌 밑에 꼭 붙어 숨어 살아요.',
    sign: '머리와 입이 아주 크고, 가슴지느러미가 부채 같아요. 비늘이 없고 등에 짙은 안장 무늬가 4~5개 있어요.',
    food: '하루살이와 날도래 같은 물속 벌레의 애벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '봄에 큰 돌 밑 천장에 알을 붙여 낳아요.',
      '헤엄을 잘 치지 못해서 바닥에서 톡톡 튀듯이 움직여요.',
      '몸빛이 돌과 비슷해서 가만히 있으면 잘 보이지 않아요.',
    ],
    clean: '차갑고 빠른 물과 큰 돌이 있어야 해요. 흙이 쌓여 돌 틈이 메워지면 살 곳이 없어져요.',
    sources: ['E_DUK', 'N_DUK', 'LAW_LIST', 'BANGTAE'],
  });
  sp({
    id: 'HANDUKJUNGGAE', name: '한둑중개', sci: 'Cottus hangiongensis', family: '둑중개과', size: { usual: [9, 12], max: 15 },
    habitat: ['stone', 'riffle', 'gravel'], basin: 'east', water: 'Ib', endemic: false, home: '동해로 흐르는 맑은 강의 아래쪽 자갈 여울 (고성·양양·강릉·삼척)',
    protected: PROT.E2('바다와 강을 오가며 사는데, 강 아래쪽이 망가지며 줄었어요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: LONG, spawn: [3, 4, 5], hours: ['night', 'dusk', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 3, rarity: 2,
    look: {
      profile: { kind: 'fish', depth: curve(0.2, 0.22, 0.06, { front: 0.5, rear: 0.9 }), width: curve(0.24, 0.17, 0.028, { front: 0.5, rear: 0.85 }), arch: 0.45, head: 0.3, snout: 0.15, mouth: 'end', gape: 0.9, barbels: 0, eye: [0.11, 0.9, 0.045], lips: 0.3, section: 2.6, flatHead: 0.75 },
      fins: fins({
        dorsal: { at: 0.33, base: 0.14, h: 0.08, shape: 'round', rays: 8 }, dorsal2: { at: 0.49, base: 0.42, h: 0.12, shape: 'low', rays: 19 },
        anal: { at: 0.55, base: 0.33, h: 0.1, shape: 'low', rays: 14 }, pelvic: { at: 0.32, len: 0.075 }, pectoral: { at: 0.29, len: 0.23, fan: 1, low: 1 },
        tail: { len: 0.19, fork: 0, spread: 0.2, shape: 'round' },
      }),
      colours: { back: '#56503a', side: '#a39a74', belly: '#f1ecd9', fin: '#c4bb92', eye: '#b8a050', sheen: '#d0d0b0', gloss: 0.9 },
      marks: [
        { t: 'saddles', n: 4, u0: 0.34, u1: 0.98, depth: 0.62, w: 0.085, c: '#262212', a: 0.78 },
        { t: 'mottle', n: 26, u0: 0.0, u1: 0.99, v0: 0.0, v1: 0.75, r0: 0.01, r1: 0.022, c: '#2a2814', a: 0.32, seed: 41 },
        { t: 'fin', fin: 'pectoral', kind: 'bands', n: 4, c: '#262212', a: 0.55 }, { t: 'fin', fin: 'dorsal2', kind: 'bands', n: 3, c: '#262212', a: 0.45 }, { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#262212', a: 0.5 },
      ],
      scales: 'none',
    },
    kid: '둑중개의 사촌이에요. 바다 가까운 맑은 여울의 돌 밑에 살아요.',
    sign: '둑중개와 꼭 닮았어요. 배지느러미가 더 짧고, 등의 짙은 띠가 더 또렷해요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '알에서 나온 새끼는 바다로 내려갔다가 조금 자라면 다시 강으로 올라와요.',
      '둑중개는 윗물에, 한둑중개는 아랫물 여울에 살아서 서로 사는 곳이 달라요.',
      '수컷이 돌 밑의 알을 지켜요.',
    ],
    clean: '바다에서 여울까지 물길이 이어져 있어야 하고, 강 아래쪽까지 물이 맑아야 해요.',
    sources: ['REDBOOK', 'LAW_LIST', 'NIE'],
  });

  // ---- 메기과 · 퉁가리과 -----------------------------------------------------------------------------------------------
  sp({
    id: 'MIYUGI', name: '미유기', sci: 'Silurus microdorsalis', family: '메기과', size: { usual: [15, 25], max: 30 },
    habitat: ['stone', 'pool', 'cold'], basin: 'both', water: 'Ia', endemic: true, home: '강원도의 맑은 계곡 윗물, 자갈과 바위가 많은 곳',
    months: [4, 5, 6, 7, 8, 9, 10], spawn: [5, 6], hours: ['night', 'dusk'], weather: W.rain, bait: ['worm', 'larva'], method: ['rod', 'net'], difficulty: 3, rarity: 4,
    look: {
      profile: { kind: 'fish', depth: curve(0.15, 0.2, 0.075, { front: 0.5, rear: 0.8, end: 0.05 }), width: curve(0.17, 0.14, 0.02, { front: 0.5, rear: 0.7, end: 0.012 }), arch: 0.2, head: 0.19, snout: 0.1, mouth: 'up', gape: 0.9, barbels: 2, barbelLen: 0.13, eye: [0.065, 0.78, 0.022], lips: 0.2, section: 2.5, flatHead: 0.8 },
      fins: fins({
        dorsal: { at: 0.3, base: 0.025, h: 0.045, shape: 'round', rays: 3 }, anal: { at: 0.42, base: 0.57, h: 0.085, shape: 'long', rays: 70 },
        pelvic: { at: 0.38, len: 0.06 }, pectoral: { at: 0.19, len: 0.1, fan: 0, low: 1 }, tail: { len: 0.1, fork: 0.1, spread: 0.11, shape: 'round' },
      }),
      colours: { back: '#2e2a1e', side: '#5a5036', belly: '#d8c880', fin: '#3a3424', eye: '#8a7a40', sheen: '#a8b890', gloss: 1.0 },
      marks: [
        { t: 'mottle', n: 34, u0: 0.1, u1: 0.99, v0: 0.05, v1: 0.75, r0: 0.02, r1: 0.05, c: '#8a7a48', a: 0.3, seed: 51 },
        { t: 'mottle', n: 20, u0: 0.1, u1: 0.99, v0: 0.0, v1: 0.6, r0: 0.02, r1: 0.04, c: '#16140e', a: 0.35, seed: 52 },
      ],
      scales: 'none',
    },
    kid: '산골 물에 사는 날씬한 메기예요. 수염이 길고 밤에 돌아다녀요.',
    sign: '메기를 닮았지만 훨씬 가늘어요. 등지느러미가 아주 작고, 뒷지느러미가 꼬리까지 길게 이어져요. 수염은 2쌍이에요.',
    food: '밤에 물속 벌레와 어린 물고기를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요. 산메기라고도 불러요.',
      '비늘이 없고 몸이 미끌미끌해요.',
      '낮에는 돌 밑에 숨어 있다가 밤에 긴 수염으로 먹이를 더듬어 찾아요.',
      '메기는 흐린 아랫물에, 미유기는 맑은 윗물에 살아요.',
    ],
    clean: '맑은 물이 흐르고 숨을 바위 틈이 많아야 해요.',
    sources: ['N_MIYUGI', 'E_MIYUGI', 'REDBOOK'],
  });
  sp({
    id: 'TUNGGARI', name: '퉁가리', sci: 'Liobagrus andersoni', family: '퉁가리과', size: { usual: [8, 10], max: 12 },
    habitat: ['stone', 'riffle', 'gravel'], basin: 'west', water: 'Ib', endemic: true, home: '한강과 임진강 물길의 자갈 여울 (인제·홍천·평창·영월·횡성)',
    months: [4, 5, 6, 7, 8, 9, 10], spawn: [5, 6], hours: ['night', 'dusk'], weather: W.rain, bait: ['worm'], method: ['net', 'trap'], difficulty: 2, rarity: 5,
    look: {
      profile: { kind: 'fish', depth: curve(0.175, 0.26, 0.09, { front: 0.5, rear: 0.9, end: 0.085 }), width: curve(0.2, 0.17, 0.03, { front: 0.5, rear: 0.8 }), arch: 0.3, head: 0.23, snout: 0.1, mouth: 'end', gape: 0.7, barbels: 4, barbelLen: 0.07, eye: [0.075, 0.86, 0.02], lips: 0.2, section: 2.6, flatHead: 0.7 },
      fins: fins({
        dorsal: { at: 0.3, base: 0.07, h: 0.085, shape: 'round', rays: 6 }, adipose: { at: 0.62, size: 0.3, low: 1 }, anal: { at: 0.6, base: 0.2, h: 0.08, shape: 'round', rays: 16 },
        pelvic: { at: 0.45, len: 0.07 }, pectoral: { at: 0.22, len: 0.11, fan: 0, low: 1 }, tail: { len: 0.17, fork: 0, spread: 0.17, shape: 'round' },
      }),
      colours: { back: '#5a4520', side: '#8a6c34', belly: '#d9c48a', fin: '#7a5e2c', eye: '#3a3020', sheen: '#d8b870', gloss: 1.0 },
      marks: [
        { t: 'fin', fin: 'tail', kind: 'edge', c: '#e6d28a', a: 0.85 }, { t: 'fin', fin: 'dorsal', kind: 'edge', c: '#e6d28a', a: 0.7 }, { t: 'fin', fin: 'anal', kind: 'edge', c: '#e6d28a', a: 0.7 },
        { t: 'fin', fin: 'pectoral', kind: 'edge', c: '#e6d28a', a: 0.7 },
      ],
      scales: 'none',
    },
    kid: '누런 갈색의 작은 메기 친구예요. 가시에 찔리면 따가우니 손으로 잡지 않아요.',
    sign: '몸이 누런 갈색 한 빛깔이고 무늬가 없어요. 수염이 4쌍이고, 지느러미 가장자리가 밝아요.',
    food: '밤에 돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '가슴지느러미에 단단한 가시가 있어요. 찔리면 퉁퉁 붓고 따가워서 이름이 퉁가리예요.',
      '초여름에 돌 밑에 알 덩어리를 낳고 곁에서 지켜요.',
      '비늘이 없고 몸이 미끌미끌해요.',
    ],
    clean: '자갈과 돌이 깔린 맑은 여울이 있어야 숨어 지낼 수 있어요.',
    sources: ['BANGTAE', 'REDBOOK', 'NIFS_HOME'],
  });

  // ---- 미꾸리과 · 종개과 -----------------------------------------------------------------------------------------------
  sp({
    id: 'SAEKOMIKKURI', name: '새코미꾸리', sci: 'Koreocobitis rotundicaudata', family: '미꾸리과', size: { usual: [10, 15], max: 18 },
    habitat: ['stone', 'gravel', 'riffle'], basin: 'west', water: 'Ib', endemic: true, home: '한강과 임진강 윗물의 물살 빠른 자갈 바닥 (홍천·인제·평창·영월)',
    months: WARM, spawn: [5, 6], hours: ['night', 'dusk', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 2, rarity: 4,
    look: {
      profile: { kind: 'fish', depth: curve(0.125, 0.3, 0.085, { front: 0.6, rear: 1.0, end: 0.085 }), width: curve(0.1, 0.28, 0.03, { front: 0.6 }), arch: 0.1, head: 0.2, snout: 0.75, mouth: 'low', gape: 0.25, barbels: 3, barbelLen: 0.025, eye: [0.1, 0.8, 0.02], lips: 0.4, section: 2.2, flatHead: 0 },
      fins: F_LOACH({ tail: { len: 0.14, fork: 0, spread: 0.15, shape: 'round' } }),
      colours: { back: '#5a3f1e', side: '#c98f3e', belly: '#f0c878', fin: '#e8873a', eye: '#3a2a18', sheen: '#f0c080', gloss: 0.9 },
      marks: [
        { t: 'mottle', n: 150, u0: 0.04, u1: 0.99, v0: 0.0, v1: 0.78, r0: 0.008, r1: 0.02, c: '#2c1d0c', a: 0.75, seed: 61 },
        { t: 'band', v: 0.3, w: 0.2, c: '#e87a2a', a: 0.3, u0: 0.0, u1: 0.2 },
        { t: 'fin', fin: 'tail', kind: 'spots', n: 12, c: '#2c1d0c', a: 0.6 }, { t: 'fin', fin: 'dorsal', kind: 'spots', n: 8, c: '#2c1d0c', a: 0.6 },
      ],
      scales: 'none',
    },
    kid: '주황빛이 도는 긴 몸에 얼룩무늬가 가득해요. 자갈 틈으로 쏙쏙 숨어요.',
    sign: '몸이 길고 둥글어요. 주황빛 바탕에 짙은 얼룩이 빽빽하고, 머리와 지느러미가 붉은 주황빛이에요. 꼬리지느러미 끝이 둥글어요.',
    food: '돌에 붙은 물풀과 물속 벌레를 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '주둥이가 길어서 자갈 틈을 잘 파고들어요.',
      '눈 아래에 작은 가시가 숨어 있어서, 잡히면 세워서 몸을 지켜요.',
    ],
    clean: '물살이 빠르고 자갈 틈이 진흙으로 막히지 않아야 해요.',
    sources: ['E_SAEKO', 'REDBOOK'],
  });
  sp({
    id: 'CHAMJONGGAE', name: '참종개', sci: 'Iksookimia koreensis', family: '미꾸리과', size: { usual: [7, 10], max: 12 },
    habitat: ['gravel', 'riffle', 'stone'], basin: 'both', water: 'Ib', endemic: true, home: '한강·임진강 윗물과 삼척 오십천의 맑은 자갈·모래 바닥',
    months: WARM, spawn: [6, 7], hours: ['day', 'dusk'], weather: W.any, bait: [], method: ['net'], difficulty: 2, rarity: 6,
    look: {
      profile: { kind: 'fish', depth: curve(0.13, 0.3, 0.085, { front: 0.6, rear: 1.0, end: 0.085 }), width: curve(0.09, 0.28, 0.028, { front: 0.6 }), arch: 0.1, head: 0.2, snout: 0.5, mouth: 'low', gape: 0.25, barbels: 3, barbelLen: 0.02, eye: [0.09, 0.82, 0.022], lips: 0.3, section: 2.1, flatHead: 0 },
      fins: F_LOACH({ tail: { len: 0.14, fork: 0, spread: 0.15, shape: 'flat' } }),
      colours: { back: '#c9b480', side: '#e9d9a8', belly: '#f8f2de', fin: '#ebe0b8', eye: '#3a3020', sheen: '#f0e8c0', gloss: 0.85 },
      marks: [
        { t: 'saddles', n: 11, u0: 0.2, u1: 0.98, depth: 0.3, w: 0.04, c: '#4a3618', a: 0.82 },
        { t: 'bars', n: 14, u0: 0.22, u1: 0.98, v0: 0.42, v1: 0.8, w: 0.016, c: '#4a3618', a: 0.82, jitter: 0.2, seed: 9 },
        { t: 'band', v: 0.5, w: 0.05, c: '#3a2a14', a: 0.8, u0: 0.02, u1: 0.18 },
        { t: 'blotch', u: 0.985, v: 0.28, rx: 0.014, ry: 0.06, c: '#1a140a', a: 0.9 },
        { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#4a3618', a: 0.55 }, { t: 'fin', fin: 'dorsal', kind: 'bands', n: 2, c: '#4a3618', a: 0.5 },
      ],
      scales: 'none',
    },
    kid: '옅은 노란 몸에 갈색 줄무늬가 빗살처럼 나 있어요. 모래 속에 쏙 숨어요.',
    sign: '등에 넓은 가로무늬가, 옆구리 아래에 가느다란 세로 줄무늬가 10~18개 나란히 있어요. 꼬리 뿌리 위쪽에 검은 점이 있어요.',
    food: '모래를 입에 넣고 그 속의 작은 먹이를 걸러 먹어요.',
    facts: [
      '우리나라에만 사는 고유종이에요.',
      '놀라면 눈 깜짝할 사이에 모래 속으로 파고들어요.',
      '수염이 3쌍 있어서 바닥의 먹이를 더듬어 찾아요.',
    ],
    clean: '맑은 물 아래 깨끗한 모래와 잔자갈이 있어야 해요.',
    sources: ['E_CHAMJONG', 'REDBOOK'],
  });
  sp({
    id: 'DAERYUKJONGGAE', name: '대륙종개', sci: 'Orthrias nudus', family: '종개과', size: { usual: [10, 15], max: 20 },
    habitat: ['riffle', 'gravel', 'stone'], basin: 'both', water: 'Ib', endemic: false, home: '한강 윗물과 삼척 오십천의 자갈 많은 여울',
    months: WARM, spawn: [4, 5], hours: ['night', 'dusk', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 2, rarity: 5,
    look: {
      profile: { kind: 'fish', depth: curve(0.14, 0.3, 0.08, { front: 0.6, rear: 1.0, end: 0.08 }), width: curve(0.125, 0.26, 0.028, { front: 0.55 }), arch: 0.2, head: 0.21, snout: 0.35, mouth: 'low', gape: 0.3, barbels: 3, barbelLen: 0.035, eye: [0.095, 0.84, 0.024], lips: 0.4, section: 2.4, flatHead: 0.35 },
      fins: F_LOACH({ dorsal: { at: 0.47, base: 0.1, h: 0.1, shape: 'round', rays: 7 }, tail: { len: 0.16, fork: 0.15, spread: 0.16, shape: 'notch' } }),
      colours: { back: '#5c4c2a', side: '#b99a5a', belly: '#f0e4c0', fin: '#cdb47a', eye: '#3a3020', sheen: '#e0d0a0', gloss: 0.9 },
      marks: [
        { t: 'mottle', n: 90, u0: 0.04, u1: 0.99, v0: 0.0, v1: 0.72, r0: 0.012, r1: 0.03, c: '#2c2210', a: 0.55, seed: 71 },
        { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#2c2210', a: 0.5 }, { t: 'fin', fin: 'dorsal', kind: 'bands', n: 2, c: '#2c2210', a: 0.5 },
      ],
      scales: 'none',
    },
    kid: '누런 갈색 몸에 구름 같은 얼룩이 있어요. 여울의 돌 틈에 살아요.',
    sign: '몸이 길고 머리가 조금 납작해요. 수염이 3쌍이고, 누런 갈색 바탕에 고르지 않은 짙은 얼룩이 있어요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '우리나라뿐 아니라 중국과 몽골의 강에도 살아요.',
      '봄(4~5월)에 자갈 바닥에 알을 낳아요.',
      '낮에는 돌 틈에 숨고 주로 밤에 움직여요.',
    ],
    clean: '자갈이 많은 맑은 여울이 있어야 해요.',
    sources: ['B_DAERYUK', 'BANGTAE'],
  });
  sp({
    id: 'JONGGAE', name: '종개', sci: 'Orthrias toni', family: '종개과', size: { usual: [10, 15], max: 18 },
    habitat: ['cold', 'riffle', 'gravel', 'stone'], basin: 'east', water: 'Ia', endemic: false, home: '동해로 흐르는 강 가운데 강릉 북쪽의 차가운 물 (강릉·양양·속초·고성)',
    months: WARM, spawn: [4, 5], hours: ['night', 'dusk', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 2, rarity: 4,
    look: {
      profile: { kind: 'fish', depth: curve(0.135, 0.3, 0.075, { front: 0.6, rear: 1.0, end: 0.075 }), width: curve(0.12, 0.26, 0.026, { front: 0.55 }), arch: 0.2, head: 0.21, snout: 0.4, mouth: 'low', gape: 0.3, barbels: 3, barbelLen: 0.03, eye: [0.095, 0.84, 0.024], lips: 0.4, section: 2.4, flatHead: 0.3 },
      fins: F_LOACH({ dorsal: { at: 0.48, base: 0.1, h: 0.1, shape: 'round', rays: 7 }, tail: { len: 0.16, fork: 0.25, spread: 0.16, shape: 'notch' } }),
      colours: { back: '#6a5a36', side: '#cdb780', belly: '#f4ecd2', fin: '#d8c690', eye: '#3a3020', sheen: '#e8e0b8', gloss: 0.9 },
      marks: [
        { t: 'saddles', n: 9, u0: 0.22, u1: 0.98, depth: 0.34, w: 0.045, c: '#2e2412', a: 0.7 },
        { t: 'parr', n: 11, u0: 0.24, u1: 0.98, v: 0.52, rx: 0.022, ry: 0.07, c: '#2e2412', a: 0.6 },
        { t: 'fin', fin: 'tail', kind: 'bands', n: 3, c: '#2e2412', a: 0.5 }, { t: 'fin', fin: 'dorsal', kind: 'bands', n: 2, c: '#2e2412', a: 0.5 },
      ],
      scales: 'none',
    },
    kid: '동해 쪽 차가운 강에 사는 긴 물고기예요. 옆구리에 얼룩이 줄지어 있어요.',
    sign: '대륙종개와 닮았지만 등의 안장 무늬와 옆구리의 얼룩이 더 가지런해요.',
    food: '돌 틈의 물속 벌레를 먹어요.',
    facts: [
      '강릉 남대천 북쪽의, 동해로 흐르는 차가운 강에 살아요.',
      '수염이 3쌍이고 몸이 미끌미끌해요.',
      '찬물을 좋아해서 여름에는 더 윗물로 올라가요.',
    ],
    clean: '한여름에도 물이 차가운 자갈 여울이 있어야 해요.',
    sources: ['NIBR_HOME', 'REDBOOK'],
  });

  // ---- 칠성장어과 · 바다빙어과 -----------------------------------------------------------------------------------------
  sp({
    id: 'DAMUKJANGEO', name: '다묵장어', sci: 'Lethenteron reissneri', family: '칠성장어과', size: { usual: [14, 18], max: 20 },
    habitat: ['gravel', 'edge'], basin: 'both', water: 'Ib', endemic: false, home: '강원도 맑은 강의 모래와 잔자갈 바닥',
    protected: PROT.E2('모래 바닥이 파헤쳐지고 물이 흐려지며 살 곳을 잃었어요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: [3, 4, 5, 6], absent: [], spawn: [3, 4, 5, 6], hours: ['dusk', 'night', 'day'], weather: W.any, bait: [], method: ['net'], difficulty: 2, rarity: 2,
    look: {
      profile: { kind: 'lamprey', depth: curve(0.062, 0.2, 0.05, { front: 0.4, rear: 0.9, end: 0.02, nose: 0.045 }), width: curve(0.056, 0.2, 0.02, { front: 0.4, rear: 0.9, end: 0.006, nose: 0.04 }), arch: 0, head: 0.13, snout: 0.05, mouth: 'sucker', gape: 0.6, barbels: 0, eye: [0.05, 0.62, 0.012], lips: 0, section: 2.0, flatHead: 0, gills: 7 },
      fins: fins({ dorsal: { at: 0.52, base: 0.16, h: 0.028, shape: 'low', rays: 0 }, dorsal2: { at: 0.7, base: 0.28, h: 0.04, shape: 'low', rays: 0 }, tail: { len: 0.05, fork: 0, spread: 0.07, shape: 'point' }, fringe: { from: 0.86 } }),
      colours: { back: '#5a5238', side: '#9a8e62', belly: '#efe8d0', fin: '#b0a478', eye: '#c8b870', sheen: '#d0d8b0', gloss: 1.0 },
      marks: [],
      scales: 'none',
    },
    kid: '턱이 없고 입이 동그란 빨판이에요. 몸 옆에 숨구멍이 일곱 개 있어요.',
    sign: '뱀장어처럼 길고 가늘어요. 입이 동그란 빨판이고, 눈 뒤에 숨구멍이 7개 줄지어 있어요. 가슴지느러미와 배지느러미가 없어요.',
    food: '어릴 때는 모래 속에서 물에 떠다니는 작은 먹이를 걸러 먹어요. 어른이 되면 아무것도 먹지 않아요.',
    facts: [
      '어린 시절 서너 해를 모래 속에 묻혀 눈도 없이 지내요.',
      '어른이 되면 눈이 생기고, 봄에 모래와 자갈 바닥에 알을 낳은 뒤 삶을 마쳐요.',
      '칠성장어와 달리 한평생 강에서만 살고, 다른 물고기에 붙지 않아요.',
      '아주 오래전부터 모습이 거의 바뀌지 않은 물고기 무리예요.',
    ],
    clean: '맑은 물 아래 깨끗한 모래 바닥이 있어야 어린 것이 묻혀 살 수 있어요.',
    sources: ['E_DAMUK', 'B_DAMUK', 'LAW_LIST'],
  });
  sp({
    id: 'CHILSEONGJANGEO', name: '칠성장어', sci: 'Lethenteron japonicus', family: '칠성장어과', size: { usual: [40, 50], max: 60 },
    habitat: ['gravel', 'riffle'], basin: 'east', water: 'Ib', endemic: false, home: '동해에서 자라, 고성·양양·강릉·삼척의 강으로 올라와요',
    protected: PROT.E2('바다에서 강으로 올라오는 길이 막히고 강바닥이 망가져 아주 드물어졌어요.'), guard: '환경부가 멸종위기 야생생물 Ⅱ급으로 지켜요.',
    months: [5, 6], absent: [8, 9, 10, 11, 12, 1, 2, 3], spawn: [5, 6], hours: ['night', 'dusk'], weather: W.rain, bait: [], method: ['net'], difficulty: 4, rarity: 1,
    look: {
      profile: { kind: 'lamprey', depth: curve(0.07, 0.2, 0.055, { front: 0.4, rear: 0.9, end: 0.02, nose: 0.05 }), width: curve(0.064, 0.2, 0.022, { front: 0.4, rear: 0.9, end: 0.006, nose: 0.045 }), arch: 0, head: 0.12, snout: 0.05, mouth: 'sucker', gape: 0.8, barbels: 0, eye: [0.05, 0.62, 0.014], lips: 0, section: 2.0, flatHead: 0, gills: 7 },
      fins: fins({ dorsal: { at: 0.5, base: 0.16, h: 0.03, shape: 'low', rays: 0 }, dorsal2: { at: 0.69, base: 0.28, h: 0.045, shape: 'low', rays: 0 }, tail: { len: 0.05, fork: 0, spread: 0.075, shape: 'point' }, fringe: { from: 0.86 } }),
      colours: { back: '#2a3440', side: '#6a7880', belly: '#eef0ea', fin: '#4a5660', eye: '#c8c8a0', sheen: '#b0c8e0', gloss: 1.0 },
      marks: [{ t: 'fin', fin: 'tail', kind: 'tint', c: '#101418', a: 0.6 }],
      scales: 'none',
    },
    kid: '숨구멍이 일곱 개라서 칠성장어예요. 바다에서 강으로 먼 길을 올라와요.',
    sign: '다묵장어보다 훨씬 크고 등이 검푸르러요. 입이 동그란 빨판이고 숨구멍이 7개예요.',
    food: '바다에서는 다른 물고기의 몸에 붙어 살아요. 강에 올라온 뒤에는 먹지 않아요.',
    facts: [
      '눈 뒤에 줄지은 숨구멍 일곱 개가 별 같아서 칠성이라는 이름이 붙었어요.',
      '바다에서 자란 뒤 늦봄(5~6월)에 강으로 올라와 자갈 바닥에 알을 낳고 삶을 마쳐요.',
      '어린 것은 강바닥 진흙과 모래 속에서 여러 해를 지낸 뒤 바다로 내려가요.',
    ],
    clean: '바다에서 여울까지 물길이 막히지 않아야 하고, 어린 것이 지낼 깨끗한 강바닥이 있어야 해요.',
    sources: ['E_CHILSEONG', 'LAW_LIST', 'NIFS_HOME'],
  });
  sp({
    id: 'EUNEO', name: '은어', sci: 'Plecoglossus altivelis', family: '바다빙어과', size: { usual: [15, 20], max: 25 },
    habitat: ['riffle', 'gravel'], basin: 'east', water: 'Ib', endemic: false, home: '동해로 흐르는 맑은 강의 돌 많은 여울 (양양·강릉·삼척)',
    months: [5, 6, 7, 8, 9, 10], absent: [11, 12, 1, 2, 3], spawn: [9, 10],
    closed: { ranges: [[4, 20, 5, 20], [9, 1, 10, 31]], basis: '내수면어업법 시행령 별표 1 (강원특별자치도)', say: '강원도에서는 4월 20일~5월 20일, 9월 1일~10월 31일에 은어를 잡지 않기로 법으로 정했어요.' },
    hours: ['day', 'dawn'], weather: W.sun, bait: ['fly'], method: ['gyeonji', 'rod'], difficulty: 3, rarity: 5,
    look: {
      profile: { kind: 'fish', depth: curve(0.2, 0.4, 0.075), width: curve(0.11, 0.32, 0.028), arch: 0.02, head: 0.22, snout: 0.5, mouth: 'end', gape: 0.7, barbels: 0, eye: [0.08, 0.6, 0.042], lips: 0.2, section: 2.1, flatHead: 0 },
      fins: F_TROUT({ dorsal: { at: 0.45, base: 0.13, h: 0.17, shape: 'tri', rays: 11 }, adipose: { at: 0.8, size: 0.03 }, anal: { at: 0.7, base: 0.14, h: 0.1, shape: 'long', rays: 15 }, tail: { len: 0.2, fork: 0.65, spread: 0.26, shape: 'fork' } }),
      colours: { back: '#4a5a3a', side: '#d0d6c4', belly: '#f8f8f0', fin: '#e0d8a0', eye: '#e0d890', sheen: '#e8ffd0', gloss: 1.0 },
      marks: [
        { t: 'blotch', u: 0.27, v: 0.5, rx: 0.04, ry: 0.12, c: '#f0cf2a', a: 0.9 },
        { t: 'band', v: 0.32, w: 0.12, c: '#8a9a5a', a: 0.3, u0: 0.2, u1: 0.99 },
        { t: 'fin', fin: 'dorsal', kind: 'tint', c: '#d8c840', a: 0.4 }, { t: 'fin', fin: 'adipose', kind: 'tint', c: '#e8a030', a: 0.6 },
      ],
      scales: 'fine',
      breeding: { months: [9, 10], colours: { side: '#a8a890', back: '#3a3a2a' }, marks: [{ t: 'band', v: 0.62, w: 0.1, c: '#e07a2a', a: 0.5, u0: 0.2, u1: 0.99 }] },
    },
    kid: '아가미 뒤에 노란 점이 있는 은빛 물고기예요. 몸에서 수박 냄새가 나요.',
    sign: '날씬한 은빛 몸에, 아가미뚜껑 뒤로 길쭉한 노란 무늬가 있어요. 등지느러미 뒤에 작은 기름지느러미가 있어요.',
    food: '돌에 붙은 물풀(돌말)을 빗 같은 이빨로 긁어 먹어요.',
    facts: [
      '봄에 바다에서 강으로 올라와 여름 내내 자라요.',
      '가을에 강 아래쪽 자갈밭에 알을 낳고 한 해의 삶을 마쳐요. 그래서 한해살이 물고기예요.',
      '좋은 돌 하나를 제 밥상으로 삼고, 다른 은어가 오면 쫓아내요.',
      '알을 낳는 때와 강으로 올라오는 때에는 잡지 않도록 법으로 정해 두었어요.',
    ],
    clean: '햇빛이 드는 맑은 여울의 돌에 깨끗한 물풀이 자라야 해요.',
    sources: ['ENV_STANDARD', 'LAW_INLAND', 'NIFS_HOME'],
  });

  // which kind of dish a fish suits (36-cooking-data.js: fishClasses small | trout | bottom); a protected fish has none
  const COOK = {
    SANCHEONEO: 'trout', EUNEO: 'trout',
    GEUMGANGMOCHI: 'small', BEODEULCHI: 'small', BEODEULGAE: 'small', SWIRI: 'small', CHAMGALGYEONI: 'small', BAEGASARI: 'small', DOLGOGI: 'small',
    SAEKOMIKKURI: 'small', CHAMJONGGAE: 'small', DAERYUKJONGGAE: 'small', JONGGAE: 'small',
    MIYUGI: 'bottom', TUNGGARI: 'bottom', KKEOKJI: 'bottom',
  };
  for (const s of S) s.cook = s.protected ? null : (COOK[s.id] || 'small');

  // ---------------------------------------------------------------- neighbours: watched, never taken
  const NEIGHBOURS = [
    { id: 'GAJAE', name: '가재', sci: 'Cambaroides similis', emoji: '🦞', grade: 'Ia', where: ['stone', 'cold'], rarity: 6,
      kid: '큰 집게발을 가진 맑은 물의 친구예요. 돌 밑에 살아요.',
      facts: ['나라가 정한 환경 기준에서 가장 맑은 물의 지표 생물이에요.', '뒤로 휙휙 헤엄쳐 달아나요.', '암컷은 알을 배에 붙이고 다니며 돌봐요.'], sources: ['ENV_STANDARD'] },
    { id: 'YEOPSAEU', name: '옆새우', sci: 'Gammarus', emoji: '🦐', grade: 'Ia', where: ['cold', 'stone', 'edge'], rarity: 7,
      kid: '옆으로 누워 헤엄치는 아주 작은 새우예요. 낙엽 밑에 살아요.',
      facts: ['가장 맑은 물의 지표 생물이에요.', '물에 떨어진 낙엽을 잘게 먹어서 물을 깨끗하게 해요.', '열목어와 금강모치의 좋은 먹이예요.'], sources: ['ENV_STANDARD'] },
    { id: 'GANGDORAE', name: '강도래 애벌레', sci: 'Plecoptera', emoji: '🪲', grade: 'Ia', where: ['stone', 'riffle', 'cold'], rarity: 7,
      kid: '꼬리가 두 가닥인 납작한 물속 벌레예요. 맑은 여울 돌 밑에 붙어 살아요.',
      facts: ['가장 맑은 물의 지표 생물이에요.', '물속에서 한 해 넘게 살다가 날개 달린 어른벌레가 돼요.', '산소가 많은 차가운 물에서만 살아요.'], sources: ['ENV_STANDARD'] },
    { id: 'NALDORAE', name: '날도래 애벌레', sci: 'Trichoptera', emoji: '🐛', grade: 'Ia', where: ['stone', 'gravel', 'riffle'], rarity: 7,
      kid: '모래알과 나뭇잎으로 제 집을 지어 들고 다녀요.',
      facts: ['입에서 실을 내어 모래알이나 잎 조각을 붙여 집을 지어요.', '맑은 물의 지표 생물이에요.', '물고기들이 가장 좋아하는 먹이예요.'], sources: ['ENV_STANDARD'] },
    { id: 'PLANARIA', name: '플라나리아', sci: 'Dugesia', emoji: '〰️', grade: 'Ia', where: ['stone', 'cold'], rarity: 5,
      kid: '납작하고 말랑한 작은 생물이에요. 돌 밑에 붙어 미끄러지듯 움직여요.',
      facts: ['아주 맑고 차가운 물에만 살아요.', '몸이 잘려도 다시 자라나는 놀라운 힘이 있어요.'], sources: ['ENV_STANDARD'] },
    { id: 'DASEULGI', name: '다슬기', sci: 'Semisulcospira', emoji: '🐚', grade: 'Ib', where: ['gravel', 'stone', 'edge', 'pool'], rarity: 8,
      kid: '돌에 붙어 사는 길쭉한 고둥이에요. 돌의 물때를 먹어 치워요.',
      facts: ['맑은 물의 지표 생물이에요.', '돌에 붙은 물풀을 갉아 먹어서 강바닥을 깨끗하게 해요.', '어름치와 반딧불이 애벌레의 먹이예요.'], sources: ['ENV_STANDARD'] },
    { id: 'SUDAL', name: '수달', sci: 'Lutra lutra', emoji: '🦦', grade: 'Ib', where: ['pool', 'edge'], rarity: 1,
      protected: { kind: 'monument+endangered1', label: '천연기념물 · 멸종위기 야생생물 Ⅰ급', note: '물고기가 많은 건강한 강에만 살아요.' },
      kid: '강에서 물고기를 잡아먹고 사는 동물이에요. 헤엄을 아주 잘 쳐요.',
      facts: ['물고기가 넉넉한 맑은 강에만 살아서, 수달이 있으면 강이 건강하다는 뜻이에요.', '밤에 주로 움직여요. 물가 바위 위의 똥으로 사는 곳을 알 수 있어요.', '나라에서 천연기념물과 멸종위기 야생생물로 지켜요.'], sources: ['LAW_LIST', 'NIE'] },
  ];

  // ---------------------------------------------------------------- places to fish
  // river 'valley' = the valley's stream (13-water.js); 'complex' = the river of 만장대 단지 (PL_ALLOT, plan coordinates).
  // z = where along the river, side = the bank the angler stands on; 35-fishing.js finds the exact spot on the bank.
  const SPOTS = [
    { id: 'FS_V_COLD', river: 'valley', z: -58, side: 'west', habitat: ['cold', 'stone', 'pool'], basins: ['west'], methods: ['rod', 'net', 'trap'], name: '윗물 찬 계곡', kidName: '차가운 윗물', emoji: '🏔️' },
    { id: 'FS_V_POOL', river: 'valley', z: 6, side: 'west', habitat: ['pool', 'edge', 'stone'], basins: ['west'], methods: ['rod', 'trap', 'net'], name: '버드나무 소', kidName: '깊은 소', emoji: '🔵' },
    { id: 'FS_V_DECK', river: 'valley', z: 46, side: 'west', habitat: ['riffle', 'gravel', 'stone'], basins: ['west'], methods: ['rod', 'gyeonji', 'net', 'trap'], name: '계곡 데크 여울', kidName: '데크 여울', emoji: '🌊', deck: true },
    { id: 'FS_V_STONE', river: 'valley', z: 78, side: 'west', habitat: ['stone', 'gravel', 'riffle'], basins: ['west'], methods: ['net', 'gyeonji', 'trap'], name: '돌밭 여울', kidName: '돌밭 여울', emoji: '🪨' },
    { id: 'FS_C_SHOAL', river: 'complex', z: -40, side: 'east', habitat: ['gravel', 'stone', 'riffle', 'cold'], basins: ['east', 'west'], methods: ['net', 'gyeonji', 'trap'], name: '강가 자갈 여울', kidName: '자갈 여울', emoji: '⚪' },
    { id: 'FS_C_POOL', river: 'complex', z: 36, side: 'east', habitat: ['pool', 'edge', 'stone'], basins: ['east', 'west'], methods: ['rod', 'trap', 'net'], name: '강가 깊은 소', kidName: '강가 소', emoji: '🔵' },
    { id: 'FS_C_BRIDGE', river: 'complex', z: 112, side: 'east', habitat: ['riffle', 'gravel', 'pool'], basins: ['east', 'west'], methods: ['rod', 'gyeonji', 'net'], name: '돌다리 아래 여울', kidName: '돌다리 여울', emoji: '🌉' },
  ];

  const RULES = {
    keepPerDay: 6,            // fish taken along per Korean day (site setting fishing.keep_per_day overrides; 0 … 20)
    bagMax: 30,               // fish the bag holds at once: with that many the next catch only goes back (cook first). It
                              // must stay BELOW what the server calls a hoard (2 × keepPerDayMax = 40, SaveValidator
                              // FISH_KEEP_LIMIT) — an honest save is never refused for a full basket
    trapMinutes: 10,          // real minutes until a set 어항 can be looked at (site setting fishing.trap_minutes; 1 … 240)
    trapMax: 3,               // 어항 standing at the same time
    trapFish: [1, 3],         // how many small fish an 어항 holds
    biteWindow: { easy: 2.6, normal: 1.7, min: 1.2 },   // seconds the float stays down (never below min in easy mode)
    waitSeconds: { easy: [3, 7], normal: [4, 11] },
    expByDifficulty: [0, 6, 8, 10, 14, 18],
    firstBonus: { exp: 30, edu: 2 },
    releaseBonus: { exp: 4 },
    offMonth: 0.25,           // weight factor outside a species' good months
    offHour: 0.35,            // … outside its hours
    lengthMaxSlack: 1.0,      // a rolled length never exceeds size.max
  };
  // told as knowledge on the spot signs, in the 도감 and in the deck
  const KNOWLEDGE = [
    { id: 'K_PROTECT', emoji: '🛟', title: '지켜야 하는 물고기', text: '천연기념물과 멸종위기 야생생물은 법으로 지켜요. 잡거나 데려가거나 기르면 안 돼요. 만나면 눈으로 보고 바로 놓아줘요.', sources: ['LAW_LIST'] },
    { id: 'K_CLOSED', emoji: '📅', title: '잡지 않는 때', text: '물고기가 알을 낳으러 오는 때에는 잡지 않아요. 강원도에서 은어는 4월 20일~5월 20일, 9월 1일~10월 31일에 잡지 않도록 법으로 정했어요.', sources: ['LAW_INLAND'] },
    { id: 'K_GEAR', emoji: '🎣', title: '쓰면 안 되는 도구', text: '놀이로 낚시할 때는 던지는 그물(투망)과 작살, 엔진 달린 배, 잠수 장비를 쓰면 안 돼요. 전기나 약을 쓰는 것도 안 돼요.', sources: ['LAW_INLAND'] },
    { id: 'K_ENOUGH', emoji: '🍽️', title: '먹을 만큼만', text: '체험관에서는 하루에 데려갈 수 있는 물고기 수를 정해 두었어요. 잡은 물고기는 팔지 않고, 먹을 만큼만 데려가요.', sources: [] },
    { id: 'K_PLACE', emoji: '🏞️', title: '낚시하면 안 되는 곳', text: '국립공원과 물고기 보호 구역에서는 낚시를 하지 않아요. 안내판을 먼저 살펴봐요.', sources: ['LAW_INLAND'] },
    { id: 'K_WATER', emoji: '💧', title: '1급수란?', text: '물이 얼마나 맑은지 등급으로 나눠요. 매우 좋음과 좋음이 1급수예요. 산천어, 금강모치, 열목어, 버들치, 가재, 옆새우가 살면 가장 맑은 물이에요.', sources: ['ENV_STANDARD'] },
    { id: 'K_RIVER', emoji: '🗺️', title: '이 강은 배움 물길이에요', text: '체험관의 강은 강원도의 맑은 물을 한곳에 모아 본 배움터예요. 한강 윗물에 사는 물고기와 동해로 흐르는 강에 사는 물고기를 모두 만날 수 있어요. 진짜 고향은 도감에 적혀 있어요.', sources: [] },
  ];

  // ---------------------------------------------------------------- pure helpers
  const byId = Object.create(null);
  for (const s of S) byId[s.id] = s;
  const ITEM = (id) => `FISH_${id}`;
  const keepable = S.filter((s) => !s.protected).map((s) => s.id);
  const hourBand = (h) => { h = ((Number(h) % 24) + 24) % 24; return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'; };
  /** is (month, day) inside one of the species' closed ranges? */
  function closedOn(s, month, day) {
    s = typeof s === 'string' ? byId[s] : s;
    if (!s || !s.closed) return false;
    const k = Number(month) * 100 + Number(day);
    return s.closed.ranges.some(([m0, d0, m1, d1]) => k >= m0 * 100 + d0 && k <= m1 * 100 + d1);
  }
  /** may this fish be taken along on that day? (the daily limit is the system's) */
  function canKeep(s, month, day) {
    s = typeof s === 'string' ? byId[s] : s;
    if (!s) return { ok: false, why: 'unknown' };
    if (s.protected) return { ok: false, why: 'protected' };
    if (closedOn(s, month, day)) return { ok: false, why: 'closed' };
    return { ok: true, why: null };
  }
  /** who can bite: [{ id, w }] for a spot, a method, a bait, a month (1–12), an hour (0–24) and the weather id */
  function candidates(q) {
    q = q || {};
    const spot = typeof q.spot === 'string' ? SPOTS.find((x) => x.id === q.spot) : q.spot;
    const method = q.method, bait = q.bait || null, month = Number(q.month) || 6;
    const band = hourBand(q.hour == null ? 12 : q.hour), weather = q.weather || 'CLEAR';
    const out = [];
    if (!spot || !METHODS[method] || !spot.methods.includes(method)) return out;
    for (const s of S) {
      if (!s.method.includes(method)) continue;
      if (!s.habitat.some((h) => spot.habitat.includes(h))) continue;
      if (s.basin !== 'both' && !spot.basins.includes(s.basin)) continue;
      if (s.absent.includes(month)) continue;
      let w = s.rarity;
      w *= s.months.includes(month) ? 1 : RULES.offMonth;
      w *= s.hours.includes(band) ? 1 : RULES.offHour;
      w *= s.weather[weather] != null ? s.weather[weather] : 1;
      // the bait matters for the rod and the 견지: the first bait of a species is what it likes best
      if (bait && s.bait.length) { const i = s.bait.indexOf(bait); w *= i === 0 ? 1.6 : i > 0 ? 1 : 0.25; }
      // how many of the spot's habitats suit it
      w *= 0.7 + 0.3 * s.habitat.filter((h) => spot.habitat.includes(h)).length;
      if (w > 0.001) out.push({ id: s.id, w: Math.round(w * 1000) / 1000 });
    }
    return out;
  }
  /** a weighted pick; rnd = a function returning [0, 1) */
  function pick(list, rnd) {
    let sum = 0;
    for (const c of list || []) sum += c.w;
    if (!(sum > 0)) return null;
    let r = (typeof rnd === 'function' ? rnd() : Math.random()) * sum;
    for (const c of list) { r -= c.w; if (r <= 0) return c.id; }
    return list[list.length - 1].id;
  }
  /** a length in millimetres inside the usual range, now and then towards the largest known */
  function rollLength(s, rnd) {
    s = typeof s === 'string' ? byId[s] : s;
    if (!s) return 0;
    const r = typeof rnd === 'function' ? rnd : Math.random;
    const [lo, hi] = s.size.usual;
    const a = r(), b = r();
    let cm = lo + (hi - lo) * (a + b) / 2;                       // most are in the middle of the usual range
    if (r() < 0.08) cm = hi + (s.size.max - hi) * Math.pow(r(), 2); // a big one, rarely
    return Math.round(Math.min(s.size.max * RULES.lengthMaxSlack, Math.max(lo * 0.8, cm)) * 10);
  }

  // ---------------------------------------------------------------- the save block
  const RX_SPOT = /^FS_[A-Z0-9_]{1,24}$/;
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const int = (v, a, b, d) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(b, Math.max(a, Math.round(n))) : d; };
  const emptyState = () => ({ v: 1, book: {}, seen: {}, day: { key: 0, kept: 0 }, traps: {}, tut: 0 });
  /** anything → exactly the STATE shape of the header (unknown ids dropped, numbers in range) */
  function sanitizeState(x) {
    const out = emptyState();
    if (!isMap(x)) return out;
    if (isMap(x.book)) {
      for (const id of Object.keys(x.book)) {
        const s = own(byId, id) ? byId[id] : null, b = x.book[id];
        if (!s || !isMap(b)) continue;
        const n = int(b.n, 0, 1000000, 0);
        if (n < 1) continue;
        // kept + released never exceed the meetings; a protected fish was released every time
        const kept = s.protected ? 0 : int(b.kept, 0, n, 0);
        const rel = s.protected ? n : int(b.rel, 0, n - kept, 0);
        out.book[id] = { n, kept, rel, max: int(b.max, 0, Math.round(s.size.max * 10), 0), first: int(b.first, 0, 4102444800000, 0) };
      }
    }
    if (isMap(x.seen)) for (const nb of NEIGHBOURS) if (x.seen[nb.id]) out.seen[nb.id] = 1;
    if (isMap(x.day)) { out.day.key = int(x.day.key, 0, 99991231, 0); out.day.kept = int(x.day.kept, 0, 99, 0); }
    if (isMap(x.traps)) {
      let n = 0;
      for (const id of Object.keys(x.traps)) {
        const t = x.traps[id];
        if (n >= 8 || !RX_SPOT.test(id) || !SPOTS.some((sp2) => sp2.id === id) || !isMap(t)) continue;
        const at = int(t.at, 0, 4102444800000, 0);
        if (at <= 0) continue;
        out.traps[id] = { at, bait: own(BAITS, t.bait) ? t.bait : 'paste' };
        n++;
      }
    }
    out.tut = x.tut ? 1 : 0;
    return out;
  }
  /** what the server needs (tools/build.mjs → game-data.json → Tfm\SaveValidator, block [fishing]) */
  function serverTable() {
    const species = {};
    for (const s of S) species[s.id] = { p: s.protected ? 1 : 0, max: Math.round(s.size.max * 10), d: s.difficulty };
    return {
      v: 1, keepPerDay: RULES.keepPerDay, keepPerDayMax: 20, bagMax: RULES.bagMax, species, neighbours: NEIGHBOURS.map((n) => n.id), spots: SPOTS.map((x) => x.id), baits: Object.keys(BAITS),
      exp: { catchMax: Math.max.apply(null, RULES.expByDifficulty), first: RULES.firstBonus.exp, release: RULES.releaseBonus.exp, firstEdu: RULES.firstBonus.edu },
    };
  }

  D.fish = {
    v: 1, species: S, byId, ids: S.map((s) => s.id), keepable, itemId: (id) => (own(byId, id) && !byId[id].protected ? ITEM(id) : null),
    neighbours: NEIGHBOURS, methods: METHODS, baits: BAITS, habitats: HABITATS, hourBands: HOUR_BANDS, water: WATER, spots: SPOTS, rules: RULES, sources: SOURCES, knowledge: KNOWLEDGE,
    hourBand, closedOn, canKeep, candidates, pick, rollLength, emptyState, sanitizeState, serverTable,
    edu: null,   // filled below
  };

  // ---------------------------------------------------------------- items: one per fish that may be taken along
  // A catch has no price and no selling price: the catch of a day's play is eaten, shared or released — never sold.
  if (D.items) {
    for (const id of keepable) {
      const s = byId[id];
      D.items[ITEM(id)] = { name: s.name, type: 'fish', icon: '🐟', price: 0, sell: 0, fish: id, desc: `${s.home.replace(/\.$/, '')}에 사는 ${s.family} 물고기예요. 부엌에서 익혀서 요리해요.` };
    }
  }

  // ---------------------------------------------------------------- quests, achievements, sticker book
  // Objectives: `interact` with the id of a spot's sign, and the type `fish` that the marked block [fishing] of 31-quest.js
  // adds — { type: 'fish', what: 'catch' (default: distinct species; `species` = only that one) | 'method' (distinct
  // methods) | 'guard' (distinct protected species sent back) | 'release' (every release), count }. 35-fishing.js emits
  // 'fish:landed' { id, method, spot, mm, protected, first } and 'fish:released' { id, protected }.
  const Q = (id, q) => { q.id = id; q.objectives.forEach((o, i) => { o.index = i; o.count = o.count || 1; }); if (D.quests) D.quests[id] = q; };
  Q('Q_FISH_FIRST', {
    title: '맑은 물 첫 낚시', icon: '🎣', category: 'explore', autoAccept: true, sequential: true,
    desc: '계곡 데크의 낚시터에서 강원도 맑은 물에 사는 물고기를 처음 만나 보세요. 찌가 물속으로 들어가면 천천히 당기면 돼요.', easyDesc: '계곡에서 물고기를 만나요!',
    objectives: [
      { type: 'interact', kind: 'fishspot', id: 'FS_V_DECK', count: 1, text: '계곡 데크의 🎣 낚시터 가 보기', easyText: '계곡 데크의 낚시 표지판에 가요' },
      { type: 'fish', what: 'catch', count: 1, text: '물고기 한 마리 만나기', easyText: '물고기를 한 마리 만나요' },
    ],
    reward: { coin: 150, exp: 80, edu: 5 },
  });
  Q('Q_FISH_METHODS', {
    title: '옛사람들의 세 가지 낚시', icon: '🥅', category: 'explore', requires: ['Q_FISH_FIRST'],
    desc: '찌낚시(또는 견지낚시), 족대, 어항. 옛사람들이 맑은 물에서 물고기를 잡던 방법을 세 가지 해 보세요.', easyDesc: '낚시 방법을 세 가지 해 봐요!',
    objectives: [{ type: 'fish', what: 'method', count: 3, text: '서로 다른 방법 세 가지로 물고기 만나기', easyText: '세 가지 방법으로 낚시해요' }],
    reward: { coin: 250, exp: 120, edu: 8 },
  });
  Q('Q_FISH_GUARD', {
    title: '물고기 지킴이', icon: '🛟', category: 'edu', requires: ['Q_FISH_FIRST'],
    desc: '법으로 지키는 귀한 물고기를 만나면 도감에 적고 바로 놓아주세요. 왜 지켜야 하는지도 배워요.', easyDesc: '귀한 물고기를 놓아줘요!',
    objectives: [
      { type: 'edu', edu: 'EDU_FISH_PROTECT', count: 1, text: '「지켜야 하는 물고기」 배우기', easyText: '지켜야 하는 물고기를 배워요' },
      { type: 'fish', what: 'guard', count: 2, text: '보호받는 물고기 두 종류를 만나 놓아주기', easyText: '귀한 물고기를 놓아줘요' },
    ],
    reward: { coin: 300, exp: 150, edu: 15, title: '맑은 물 지킴이' },
  });
  Q('Q_FISH_BOOK', {
    title: '1급수 물고기 도감', icon: '📖', category: 'explore', requires: ['Q_FISH_FIRST'],
    desc: '강원도 맑은 물에 사는 물고기를 열 종류 만나 어류 도감에 도장을 모아 보세요.', easyDesc: '물고기 도장을 열 개 모아요!',
    objectives: [{ type: 'fish', what: 'catch', count: 10, text: '서로 다른 물고기 열 종류 만나기', easyText: '물고기 열 종류를 만나요' }],
    reward: { coin: 500, exp: 250, edu: 20, title: '물고기 박사' },
  });
  const A = (id, a) => { a.id = id; if (D.achievements) D.achievements[id] = a; };
  A('ACH_FISH_FIRST', { name: '첫 물고기', icon: '🐟', desc: '맑은 물에서 처음으로 물고기를 만났습니다.', condition: { stat: 'fishCaught', gte: 1 }, reward: { coin: 100 } });
  A('ACH_FISH_50', { name: '강가의 단골', icon: '🎣', desc: '물고기를 50번 만났습니다.', condition: { stat: 'fishCaught', gte: 50 }, reward: { coin: 400 } });
  A('ACH_FISH_SPECIES10', { name: '물고기 열 친구', icon: '📖', desc: '서로 다른 물고기 열 종류를 도감에 올렸습니다.', condition: { stat: 'fishSpecies', gte: 10 }, reward: { coin: 500, edu: 10 } });
  A('ACH_FISH_SPECIES_ALL', { name: '1급수 어류 도감 완성', icon: '🏆', desc: `강원도 맑은 물의 물고기 ${S.length}종을 모두 도감에 올렸습니다.`, condition: { stat: 'fishSpecies', gte: S.length }, reward: { coin: 1500, edu: 30, title: '맑은 물 도감 지킴이' } });
  A('ACH_FISH_RELEASE10', { name: '놓아주는 마음', icon: '🛟', desc: '물고기를 열 번 물로 돌려보냈습니다.', condition: { stat: 'fishReleased', gte: 10 }, reward: { coin: 300, edu: 10 } });
  A('ACH_FISH_GUARD5', { name: '귀한 물고기 지킴이', icon: '🌟', desc: '법으로 지키는 물고기 다섯 종류를 만나 놓아주었습니다.', condition: { stat: 'fishGuarded', gte: 5 }, reward: { coin: 600, edu: 20 } });
  if (Array.isArray(D.collectionCategories) && !D.collectionCategories.some((c) => c.id === 'fish')) D.collectionCategories.push({ id: 'fish', name: '물고기', icon: '🐟' });
  if (D.collection) {
    for (const s of S) {
      const id = `COL_FISH_${s.id}`;
      // unlocked by 35-fishing.js itself (progression.unlockCollection) when the fish is first landed: the rule below has
      // no interactable id on purpose — a fish is not a thing that stands in the world
      D.collection[id] = { id, category: 'fish', name: s.name, icon: s.protected ? '🛟' : '🐟', location: '강과 계곡의 🎣 낚시터', desc: s.kid, unlock: [{ on: 'fish', id: s.id }] };
    }
  }

  // ---------------------------------------------------------------- learning cards, quizzes, the deck
  // The same shapes as 45-education-data.js makes (that file's marked block [fishing] merges them after its own).
  (function () {
    const CAT = { id: 'fish', name: '맑은 물 물고기', color: '#3d8fb8', icon: '🐟' };
    const src = (...keys) => keys.map((k) => SOURCES[k]).filter(Boolean);
    const vis = (v) => (Array.isArray(v) ? { type: 'steps', items: v.map(([icon, label]) => ({ icon, label })), sep: '→' } : { type: 'emoji', emoji: String(v || '🐟') });
    const kslide = ([text, v]) => (Array.isArray(v) ? { steps: v, text } : { emoji: v || '🐟', text });
    const cards = {}, quizzes = {};
    function card(id, icon, title, summary, pages, kid, sources, related) {
      cards[id] = {
        id, title, cat: CAT.id, category: CAT.name, icon, summary, color: CAT.color, author: '체험관 교육팀', referenceDate: '2026-11', verified: false,
        pages: pages.map(([t, text, points, v], i) => ({ index: i, title: t, text, points: points || [], visual: vis(v) })),
        quizzes: [], related: related || [], sources,
        source: sources.map((s) => s.label).filter((v, i, a) => a.indexOf(v) === i).join(' · ') + ' 내용을 쉽게 풀어 쓴 요약(교육용)',
        kid: { title: kid[0], summary: kid[1], slides: kid[2].map(kslide) },
      };
    }
    function quiz(id, edu, question, choices, answer, explain, kid) {
      const q = { id, edu, question, choices, answer, explain, reward: { exp: 60, edu: 8 } };
      q.kid = typeof kid[1] === 'boolean' ? { q: kid[0], ox: true, answer: kid[1], hint: kid[2], why: kid[3] } : { q: kid[0], choices: kid[1].map(([e, t]) => ({ e, t })), answer: kid[2], hint: kid[3], why: kid[4] };
      quizzes[id] = q;
      cards[edu].quizzes.push(id);
    }
    card('EDU_FISH_WATER', '💧', '1급수는 어떤 물일까요?', '물이 얼마나 맑은지는 그 물에 사는 생물을 보면 알 수 있어요. 가장 맑은 물에는 열목어와 금강모치, 가재가 살아요.', [
      ['물에도 등급이 있어요', '나라에서는 강물이 얼마나 맑은지 등급으로 나눠요. 가장 맑은 「매우 좋음」과 그다음 「좋음」을 흔히 1급수라고 불러요. 물속에 더러운 것이 적고 산소가 넉넉한 물이에요.', ['매우 좋음 · 좋음 = 1급수', '산소: 물고기가 숨 쉴 때 쓰는 공기'], [['💎', '매우 좋음'], ['💧', '좋음'], ['🌊', '약간 좋음'], ['🟤', '보통 아래']]],
      ['생물이 알려 주는 물의 등급', '기계가 없어도 물에 사는 생물을 보면 등급을 짐작할 수 있어요. 이런 생물을 지표 생물이라고 해요. 가장 맑은 물에는 산천어, 금강모치, 열목어, 버들치와 가재, 옆새우, 강도래 애벌레가 살아요.', ['지표 생물: 물의 상태를 알려 주는 생물', '쉬리·은어·다슬기는 그다음으로 맑은 물', '붕어·잉어·미꾸라지는 흐린 물에서도 살아요'], [['🐟', '열목어'], ['🦞', '가재'], ['🪲', '강도래'], ['💎', '가장 맑은 물']]],
      ['한 가지만 보고 정하지 않아요', '버들치는 맑은 물을 좋아하지만 조금 흐린 물도 견뎌요. 그래서 한 가지 생물만 보고 등급을 정하지 않고, 여러 생물이 함께 사는지 살펴봐요.', ['여러 지표 생물을 함께 보기', '물의 온도와 바닥의 모양도 살피기'], '🔎'],
    ], ['1급수', '가장 맑은 물에는 열목어와 금강모치, 가재가 살아요 💧', [['물에도 맑은 등급이 있어요 💎', '💧'], ['어떤 생물이 사는지 보면 알 수 있어요', [['🐟', '금강모치'], ['🦞', '가재'], ['💎', '맑은 물']]], ['가장 맑은 물이 1급수예요!', '💎']]],
    src('ENV_STANDARD'), ['EDU_FISH_PROTECT']);
    quiz('QZ_FISH_WATER_1', 'EDU_FISH_WATER', '나라의 환경 기준에서 가장 맑은 물의 지표로 꼽는 물고기끼리 묶인 것은?', ['산천어·금강모치·열목어·버들치', '붕어·잉어·미꾸라지·메기', '피라미·끄리·모래무지', '고등어·갈치·명태'], 0, '가장 맑은 물(매우 좋음~좋음)의 지표 물고기는 산천어, 금강모치, 열목어, 버들치예요. 붕어와 잉어는 흐린 물에서도 살아요.', ['가장 맑은 물에 사는 친구는 누구일까요?', [['🐟', '금강모치'], ['🐡', '붕어'], ['🦈', '상어']], 0, '옆구리에 주황 줄이 있어요', '맞아요! 금강모치는 아주 맑은 물에만 살아요.']);
    quiz('QZ_FISH_WATER_2', 'EDU_FISH_WATER', '물의 상태를 알려 주는 생물을 무엇이라고 할까요?', ['지표 생물', '외래 생물', '반려 생물', '화석 생물'], 0, '그 물에 사는 것만 보고도 물이 얼마나 맑은지 짐작하게 해 주는 생물을 지표 생물이라고 해요.', ['가재가 살면 물이 맑다는 뜻이에요.', true, '가재는 맑은 물의 친구예요 🦞', '맞아요! 가재는 가장 맑은 물에 살아요.']);
    card('EDU_FISH_PROTECT', '🛟', '지켜야 하는 물고기', '천연기념물과 멸종위기 야생생물은 법으로 지켜요. 만나면 눈으로 보고, 도감에 적고, 바로 놓아줘요.', [
      ['멸종위기 야생생물', '수가 크게 줄어 그대로 두면 사라질 수 있는 생물을 나라에서 정해 지켜요. 이것이 멸종위기 야생생물이에요. 강원도의 맑은 물에는 열목어, 연준모치, 둑중개, 새미, 어름치, 가는돌고기, 돌상어, 꾸구리, 묵납자루, 다묵장어 들이 있어요.', ['멸종: 한 종류의 생물이 모두 사라지는 것', '목록은 다섯 해마다 다시 살펴 고쳐요', '2022년에 어름치·둑중개·새미가 새로 올랐어요'], [['📉', '수가 줄어요'], ['📋', '나라가 정해요'], ['🛟', '함께 지켜요']]],
      ['천연기념물', '자연 가운데 아주 귀해서 나라의 보물로 정한 것이 천연기념물이에요. 어름치는 물고기 자체가 천연기념물이고, 정선 정암사의 열목어가 사는 골짜기는 사는 곳이 천연기념물이에요.', ['어름치: 천연기념물 제259호', '정선 정암사 열목어 서식지: 천연기념물', '서식지: 생물이 사는 곳'], '🏅'],
      ['만나면 어떻게 할까요?', '지키는 물고기는 잡거나, 데려가거나, 기르거나, 팔면 안 돼요. 낚시에 걸리면 물 밖에 오래 두지 말고 젖은 손으로 살며시 놓아줘요. 체험관에서는 도감에 도장만 찍고 바로 돌려보내요.', ['젖은 손으로 살며시', '물 밖에 오래 두지 않기', '사진과 도감으로 남기기'], [['👀', '보고'], ['📖', '적고'], ['🌊', '놓아줘요']]],
    ], ['지켜야 하는 물고기', '귀한 물고기는 보고, 적고, 바로 놓아줘요 🛟', [['수가 아주 적은 물고기가 있어요 📉', '🐟'], ['나라에서 법으로 지켜요', [['📋', '법'], ['🛟', '지킴']]], ['만나면 살며시 놓아줘요!', [['👀', '보고'], ['📖', '적고'], ['🌊', '놓아줘요']]]]],
    src('LAW_LIST', 'NIE', 'HERITAGE_YEOL', 'HERITAGE_EOREUM'), ['EDU_FISH_WATER', 'EDU_FISH_EOREUM']);
    quiz('QZ_FISH_PROTECT_1', 'EDU_FISH_PROTECT', '낚시를 하다가 멸종위기 야생생물인 물고기가 걸렸어요. 알맞은 행동은?', ['젖은 손으로 살며시 바로 놓아준다', '집에 데려가 기른다', '친구에게 판다', '구워 먹는다'], 0, '멸종위기 야생생물은 잡거나 데려가거나 기르거나 팔 수 없어요. 물 밖에 오래 두지 말고 바로 놓아줘요.', ['귀한 물고기를 만나면 어떻게 할까요?', [['🌊', '놓아줘요'], ['🏠', '데려가요'], ['🍳', '요리해요']], 0, '물로 돌려보내요', '맞아요! 살며시 놓아줘요.']);
    quiz('QZ_FISH_PROTECT_2', 'EDU_FISH_PROTECT', '물고기 자체가 천연기념물(제259호)인 것은?', ['어름치', '버들치', '붕어', '돌고기'], 0, '어름치는 우리나라에만 사는 물고기로, 종 자체가 천연기념물이에요. 2022년부터는 멸종위기 야생생물 Ⅱ급이기도 해요.', ['돌탑을 쌓는 천연기념물 물고기는?', [['🐟', '어름치'], ['🐠', '금붕어'], ['🐡', '복어']], 0, '옆구리에 점이 줄지어 있어요', '맞아요! 어름치예요.']);
    card('EDU_FISH_EOREUM', '🪨', '돌탑을 쌓는 어름치', '어름치는 알을 낳은 자리에 잔자갈을 물어다 탑을 쌓아요. 알을 지키는 지혜예요.', [
      ['산란탑', '봄이 되어 물 온도가 15~18도쯤 되면 어름치는 여울 가까운 자갈 바닥에 알을 낳아요. 그리고 입으로 잔자갈을 하나하나 물어다 알 위에 수북이 쌓아요. 이것을 산란탑이라고 해요.', ['산란: 알을 낳는 것', '4월 말~5월 중순', '자갈을 입으로 물어 날라요'], [['🥚', '알 낳기'], ['🪨', '자갈 나르기'], ['⛰️', '탑 쌓기']]],
      ['탑이 하는 일', '탑은 알이 물살에 떠내려가지 않게 눌러 주고, 다른 물고기가 알을 먹지 못하게 가려 줘요. 자갈 틈으로는 맑은 물이 드나들어 알이 숨을 쉴 수 있어요.', ['떠내려가지 않게', '먹히지 않게', '맑은 물이 드나들게'], '⛰️'],
      ['어름치가 사는 강', '어름치는 한강과 임진강의 맑은 여울에 살아요. 물이 달라지는 것에 예민해서, 강바닥을 파헤치거나 물이 흐려지면 금세 사라져요. 정선과 영월의 동강은 어름치가 사는 소중한 강이에요.', ['우리나라에만 사는 고유종', '맑은 자갈 여울이 꼭 있어야 해요'], '🏞️'],
    ], ['어름치', '어름치는 알 위에 돌탑을 쌓아요 🪨', [['봄에 자갈밭에 알을 낳아요 🥚', '🥚'], ['자갈을 물어다 탑을 쌓아요', [['🪨', '자갈'], ['⛰️', '탑']]], ['탑이 알을 지켜 줘요!', '🛡️']]],
    src('E_EOREUM', 'HERITAGE_EOREUM'), ['EDU_FISH_PROTECT']);
    quiz('QZ_FISH_EOREUM_1', 'EDU_FISH_EOREUM', '어름치가 알을 낳은 뒤에 하는 일은?', ['잔자갈을 물어다 알 위에 탑을 쌓는다', '알을 입에 넣고 다닌다', '알을 조개 속에 넣는다', '알을 모래 위에 그대로 둔다'], 0, '어름치는 알 위에 잔자갈을 쌓아 산란탑을 만들어요. 탑이 알을 물살과 다른 물고기로부터 지켜 줘요.', ['어름치는 알 위에 무엇을 쌓을까요?', [['🪨', '자갈'], ['🍃', '나뭇잎'], ['🧊', '얼음']], 0, '강바닥에 많아요', '맞아요! 자갈로 탑을 쌓아요.']);
    card('EDU_FISH_COLD', '🏔️', '찬물의 친구들', '열목어와 금강모치, 둑중개는 한여름에도 차가운 윗물에서만 살아요. 숲이 물을 차갑게 지켜 줘요.', [
      ['차가운 물이 좋은 까닭', '물은 차가울수록 산소를 더 많이 품어요. 열목어는 한여름에도 물 온도가 20도를 넘지 않는 곳에서만 살 수 있어요. 금강모치와 둑중개, 새미도 찬물의 물고기예요.', ['찬물 = 산소가 많은 물', '열목어: 20도 아래', '인제 방태천의 찬물 물고기: 금강모치·둑중개·열목어·새미'], [['❄️', '찬물'], ['🫧', '많은 산소'], ['🐟', '열목어']]],
      ['숲이 지키는 물', '물가의 나무가 햇빛을 가려 그늘을 만들어야 물이 따뜻해지지 않아요. 나뭇잎은 물에 떨어져 옆새우와 물속 벌레의 먹이가 되고, 그 벌레를 물고기가 먹어요.', ['그늘 → 차가운 물', '낙엽 → 벌레 → 물고기'], [['🌳', '숲 그늘'], ['🍂', '낙엽'], ['🪲', '물속 벌레'], ['🐟', '물고기']]],
      ['더워지는 날씨와 찬물 물고기', '날씨가 더워지면 물도 따뜻해져요. 찬물 물고기는 더 위쪽 골짜기로 올라가야 하는데, 골짜기에는 끝이 있어요. 그래서 학자들이 해마다 이 물고기들을 살펴보고 있어요.', ['살 곳이 위로 위로 줄어들어요', '숲과 물길을 지키는 것이 물고기를 지키는 길'], '🌡️'],
    ], ['찬물의 친구들', '열목어는 차가운 윗물에서만 살아요 🏔️', [['찬물에는 산소가 많아요 🫧', '❄️'], ['숲 그늘이 물을 차갑게 해요', [['🌳', '숲'], ['❄️', '찬물']]], ['숲을 지키면 물고기도 지켜요!', '🌳']]],
    src('E_YEOL', 'BANGTAE', 'HERITAGE_YEOL'), ['EDU_FISH_WATER']);
    quiz('QZ_FISH_COLD_1', 'EDU_FISH_COLD', '열목어가 차가운 윗물에서만 사는 까닭으로 알맞은 것은?', ['찬물일수록 산소가 많이 녹아 있어서', '찬물에는 먹이가 전혀 없어서', '따뜻한 물은 짜서', '찬물은 흐려서 숨기 좋아서'], 0, '물은 차가울수록 산소를 많이 품어요. 열목어는 산소가 넉넉하고 여름에도 20도를 넘지 않는 물이 필요해요.', ['열목어는 따뜻한 물을 좋아해요.', false, '이름과 달리 찬물을 찾아요 ❄️', '아니에요! 아주 차가운 물에서만 살아요.']);
    card('EDU_FISH_METHODS', '🎣', '옛사람들의 낚시', '대낚시와 견지낚시, 족대와 어항. 맑은 물에서 먹을 만큼만 잡던 옛사람들의 방법이에요.', [
      ['대낚시와 견지낚시', '대낚시는 대나무 낚싯대에 줄과 찌를 달아, 찌가 움직이는 것을 보고 물고기를 낚아요. 견지낚시는 줄을 감은 납작한 나무 얼레(견지)를 들고 여울에 서서, 물살에 미끼를 흘려보내는 우리 고유의 낚시예요.', ['찌: 물에 떠서 입질을 알려 주는 것', '견지: 줄을 감아 두는 납작한 얼레', '입질: 물고기가 미끼를 건드리는 것'], [['🎋', '대나무 낚싯대'], ['🔴', '찌'], ['🪵', '견지']]],
      ['족대와 어항', '족대는 두 막대 사이에 그물을 댄 도구예요. 돌 아래쪽에 대고 돌을 들추면 숨어 있던 물고기가 들어와요. 어항은 입구가 안으로 오므라든 통으로, 된장이나 떡밥을 넣어 물속에 두면 작은 물고기가 들어가요.', ['족대: 손으로 드는 작은 그물', '어항: 들어가기 쉽고 나오기 어려운 통', '구수한 된장은 좋은 미끼'], [['🥅', '족대'], ['🫙', '어항'], ['🟤', '된장']]],
      ['지켜야 할 약속', '던지는 그물(투망)과 작살, 전기나 약은 쓰면 안 돼요. 알 낳는 철에는 잡지 않고, 어린 물고기와 지키는 물고기는 놓아줘요. 먹을 만큼만 잡는 것이 옛사람들의 지혜예요.', ['투망·작살은 안 돼요', '어린 물고기는 놓아줘요', '먹을 만큼만'], [['🚫', '투망·작살'], ['🐣', '어린 것'], ['🍽️', '먹을 만큼']]],
    ], ['옛 낚시', '찌낚시, 족대, 어항으로 먹을 만큼만 잡았어요 🎣', [['찌가 쏙 들어가면 당겨요 🔴', '🎣'], ['돌을 들추면 족대로 들어와요', [['🪨', '돌'], ['🥅', '족대']]], ['먹을 만큼만 잡아요!', '🍽️']]],
    src('LAW_INLAND'), ['EDU_FISH_PROTECT']);
    quiz('QZ_FISH_METHODS_1', 'EDU_FISH_METHODS', '어항에 넣는 미끼로, 우리 장독대에서도 얻을 수 있는 것은?', ['된장', '식초', '소금', '고춧가루'], 0, '구수한 냄새가 나는 된장이나 떡밥을 어항에 넣으면 작은 물고기가 냄새를 맡고 들어와요.', ['어항에 넣으면 물고기가 좋아하는 것은?', [['🟤', '된장'], ['🧊', '얼음'], ['🧂', '소금']], 0, '장독에서 익어요', '맞아요! 구수한 된장이에요.']);
    quiz('QZ_FISH_METHODS_2', 'EDU_FISH_METHODS', '놀이로 낚시할 때 쓰면 안 되는 도구는?', ['투망과 작살', '대나무 낚싯대', '견지', '찌'], 0, '던지는 그물(투망)과 작살, 엔진 달린 배, 잠수 장비는 놀이 낚시에 쓸 수 없어요.', ['작살로 물고기를 잡아도 돼요.', false, '뾰족한 도구는 안 돼요 🚫', '아니에요! 작살과 투망은 쓰면 안 돼요.']);
    card('EDU_FISH_HOME', '🗺️', '고향이 다른 물고기들', '강원도의 강은 백두대간을 사이에 두고 서쪽 한강과 동쪽 동해로 나뉘어 흘러요. 사는 물고기도 달라요.', [
      ['서쪽으로 흐르는 강', '백두대간(우리 땅의 큰 산줄기) 서쪽의 물은 한강이 되어 서해로 가요. 정선의 강도 한강의 윗물이에요. 이쪽에는 열목어, 금강모치, 쉬리, 어름치, 꺽지, 퉁가리가 살아요.', ['영서: 큰 산줄기의 서쪽', '정선·평창·영월·인제·홍천'], [['⛰️', '백두대간'], ['⬅️', '서쪽'], ['🏞️', '한강'], ['🌊', '서해']]],
      ['동쪽으로 흐르는 강', '동쪽의 물은 짧고 가파르게 흘러 곧장 동해로 가요. 이쪽에는 바다와 강을 오가는 물고기가 많아요. 산천어와 송어, 은어, 칠성장어, 한둑중개가 그래요.', ['영동: 큰 산줄기의 동쪽', '고성·속초·양양·강릉·삼척'], [['⛰️', '백두대간'], ['➡️', '동쪽'], ['🌊', '동해']]],
      ['함부로 옮기면 안 돼요', '물고기를 다른 강에 풀어 놓으면, 본디 살던 물고기가 먹이와 살 곳을 빼앗길 수 있어요. 체험관의 강은 두 쪽의 물고기를 함께 배우는 배움 물길이에요. 진짜 고향은 도감에 적어 두었어요.', ['살던 강에서 살게 해요', '도감에서 진짜 고향 찾아보기'], '🏠'],
    ], ['물고기의 고향', '산 너머 강에는 다른 물고기가 살아요 🗺️', [['큰 산줄기가 강을 둘로 나눠요 ⛰️', '⛰️'], ['서쪽은 한강, 동쪽은 동해로 가요', [['⬅️', '한강'], ['➡️', '동해']]], ['물고기는 고향 강에서 살아야 해요!', '🏠']]],
    src('E_SANCHEON', 'NIBR_HOME'), ['EDU_FISH_COLD']);
    quiz('QZ_FISH_HOME_1', 'EDU_FISH_HOME', '산천어와 송어에 대한 설명으로 알맞은 것은?', ['같은 물고기인데 계곡에 남으면 산천어, 바다에 다녀오면 송어다', '전혀 다른 물고기다', '산천어가 자라면 은어가 된다', '둘 다 바다에서만 산다'], 0, '같은 종류이지만 한평생 계곡에서 사는 무리를 산천어, 바다에 내려갔다 돌아오는 무리를 송어라고 불러요.', ['산천어와 송어는 같은 물고기예요.', true, '사는 곳만 달라요', '맞아요! 바다에 다녀오면 송어라고 불러요.']);
    const deckSlide = (title, picture, lines, note) => (note ? { title, picture, emoji: picture, lines, note } : { title, picture, emoji: picture, lines });
    const deck = {
      id: 'DECK_FISH', title: '강원도 1급수 물고기', emoji: '🐟', audience: 'all', edu: 'EDU_FISH_WATER',
      summary: '강원도의 맑은 물에 사는 물고기들을 만나요. 어떤 물이 1급수인지, 어떤 물고기를 지켜야 하는지 배워요.',
      kid: '강원도의 맑은 물에 사는 물고기들을 만나요.',
      slides: [
        deckSlide('강원도 1급수 물고기', '🐟', ['숲이 깊은 강원도에는 아주 맑은 물이 흘러요.', '오늘은 그 물에 사는 물고기 친구들을 만나 봐요.'], '체험관의 강과 계곡에 있는 🎣 낚시터에서 직접 만날 수 있어요.'),
        deckSlide('1급수는 어떤 물일까요?', '💧', ['물이 얼마나 맑은지 등급으로 나눠요.', '「매우 좋음」과 「좋음」이 1급수예요.'], '환경정책기본법 시행령의 물 환경 기준에 따른 말이에요.'),
        deckSlide('생물이 알려 줘요', '🔎', ['가장 맑은 물: 산천어, 금강모치, 열목어, 버들치, 가재, 옆새우', '그다음 맑은 물: 쉬리, 은어, 다슬기'], '이런 생물을 지표 생물이라고 해요.'),
        deckSlide('찬물의 왕, 열목어', '🏔️', ['한여름에도 20도를 넘지 않는 물에서만 살아요.', '정선 정암사 골짜기는 열목어가 사는 천연기념물이에요.']),
        deckSlide('주황 줄 두 줄, 금강모치', '🟠', ['우리나라에만 사는 작은 물고기예요.', '금강모치가 보이면 물이 아주 맑다는 뜻이에요.']),
        deckSlide('산천어와 송어', '🌊', ['계곡에 남으면 산천어, 바다에 다녀오면 송어예요.', '옆구리에 둥근 무늬가 줄지어 있어요.']),
        deckSlide('여울의 멋쟁이, 쉬리', '🌈', ['노란 줄과 보랏빛 줄이 고운 우리나라 고유종이에요.', '자갈이 깔린 맑은 여울에서 날쌔게 헤엄쳐요.']),
        deckSlide('돌탑을 쌓는 어름치', '🪨', ['알 위에 잔자갈을 물어다 탑을 쌓아요.', '물고기 자체가 천연기념물이에요.']),
        deckSlide('돌 밑의 친구들', '🪨', ['둑중개, 퉁가리, 미유기, 참종개는 돌 밑과 자갈 틈에 살아요.', '돌상어와 꾸구리는 빠른 여울 바닥에 붙어 살아요.']),
        deckSlide('조개에 알을 낳는 묵납자루', '🐚', ['민물조개의 몸속에 알을 낳아요.', '조개가 사라지면 묵납자루도 사라져요.']),
        deckSlide('바다에서 오는 손님', '🌊', ['은어는 봄에, 칠성장어는 늦봄에 동해에서 강으로 올라와요.', '물길이 막히면 돌아올 수 없어요.']),
        deckSlide('지켜야 하는 물고기', '🛟', ['멸종위기 야생생물과 천연기념물은 법으로 지켜요.', '만나면 보고, 도감에 적고, 바로 놓아줘요.'], '목록은 다섯 해마다 고쳐요. 2022년에 어름치·둑중개·새미가 새로 올랐어요.'),
        deckSlide('옛사람들의 낚시', '🎣', ['대낚시와 견지낚시, 족대와 어항', '먹을 만큼만 잡고, 알 낳는 철에는 잡지 않았어요.']),
        deckSlide('맑은 물을 지키는 일', '🌳', ['물가의 숲이 물을 차갑게 지켜 줘요.', '쓰레기를 버리지 않고, 돌을 제자리에 두어요.']),
        deckSlide('정리해요', '📝', ['1급수 · 지표 생물 · 고유종 · 멸종위기 야생생물 · 천연기념물', '어류 도감에 도장을 모아 봐요!']),
      ],
    };
    D.fish.edu = { category: CAT, cards, quizzes, deck };
  })();
})();
