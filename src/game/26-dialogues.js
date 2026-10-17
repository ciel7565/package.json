// =============================================================================
// 26-dialogues.js — NPC conversation trees (pure data; read by G.sys.dialogue in 25-npc.js)
//
// G.data.dialogues[id] = {
//   npc: 'NPC001',
//   entries: [{ if: {condition}, node: 'id' }, ..., { node: 'hub' }]   first match = opening line
//   barks:   ['짧은 인사', { if: {condition}, text: '조건부 인사' }]      approach greetings after the first one
//   nodes: { id: {
//     text: '대사' | ['무작위 대사', ...],   variants: [{ if, text }]  (first matching variant wins)
//     emote?: 'nod'|'wave'|'clap'|... (NPC animation)   expression?: 'happy'|'think'|...   speaker?: '이름'
//     actions?: [...] (run when the line appears)
//     choices?: [{ text, next?, end?, if?, actions?, icon? }]  (max 4 visible; keys 1–4)
//     next?: 'id' | [{ if, node }, 'fallback']   (no choices: "다음 ▶" / "대화 마치기")
//   } } }
// 쉬운 모드 (CONTRACT §12, read by 25-npc.js when G.easy.on): node.kid / variant.kid / bark.kid = a short kid line
//   (≤ ~12 words, 해요체, an emoji; falls back to text), choice.kid + choice.emoji = the big picture button,
//   choice.easy: false hides a grown-up extra (max 3 buttons are shown), dialogue.kidGreeting / kidBarks.
// Text: **강조**, line breaks with \n, placeholders {nickname} {objective} {next} {jar} {level} {coin} {weather} {temp} {phase}
//   ({next} = the kid "다음 할 일" sentence).
// Conditions (all keys must hold): questStatus {Q: status | [..] | 'active' | 'done' | 'open' | 'notDone'},
//   questStep {Q: objectiveIndex | [..]}, hasItem {ITEM: n}, itemType {seed: n}, flag, notFlag, level,
//   jarStatus {J1: 'COMPLETE' | [..]}, jarRecipe {J1: 'FER001'}, plot 'ready'|'dry'|'empty'|'growing' | {state, zone},
//   phase 'NIGHT'|[..], weather 'RAIN'|[..], visited, any [..], all [..], not {..}, chance 0..1,
//   easy true|false (쉬운 모드 on / off — e.g. kids open straight on a quest offer, like 산골농부 does for everyone)
// Actions ({ type, ... }): acceptQuest{quest} claimQuest{quest} giveItem{item,qty} takeItem{item,qty} setFlag{flag}
//   clearFlag{flag} openEdu{edu} openQuiz{quiz | edu} openLibrary openShop{shop} openCraft openJar{jar} openMap
//   openFastTravel openJournal openQuestLog openInventory openCollection teleport{zone, x?, z?, rotY?} emote{emote}
//   npcAnim{anim} event{name, payload} toast{text} sfx{name} activity{text}
//   UI-opening actions run when the conversation closes; a choice that has one and no `next` ends the talk.
// Facts are short, general summaries; game numbers are a simulation (G.data.meta.disclaimer).
// =============================================================================
(function () {
  const PI = Math.PI;
  const S = (quest, status) => ({ questStatus: { [quest]: status } });
  const STEP = (n) => ({ questStep: { QUEST001: n } });
  /** 쉬운 모드 only: the condition holds AND the child plays in easy mode */
  const KID = (cond) => ({ all: [{ easy: true }, cond] });
  const A = {
    accept: (quest) => ({ type: 'acceptQuest', quest }),
    claim: (quest) => ({ type: 'claimQuest', quest }),
    give: (item, qty = 1) => ({ type: 'giveItem', item, qty }),
    flag: (flag) => ({ type: 'setFlag', flag }),
    anim: (anim) => ({ type: 'npcAnim', anim }),
    edu: (edu) => ({ type: 'openEdu', edu }),
    quiz: (edu) => (edu ? { type: 'openQuiz', edu } : { type: 'openQuiz' }),
    library: () => ({ type: 'openLibrary' }),
    shop: (shop = 'SHOP_GENERAL') => ({ type: 'openShop', shop }),
    craft: () => ({ type: 'openCraft' }),
    jar: (jar = 'J1') => ({ type: 'openJar', jar }),
    map: () => ({ type: 'openMap' }),
    travel: () => ({ type: 'openFastTravel' }),
    journal: () => ({ type: 'openJournal' }),
    quests: () => ({ type: 'openQuestLog' }),
    go: (zone, x, z, rotY) => (rotY == null ? { type: 'teleport', zone, x, z } : { type: 'teleport', zone, x, z, rotY }),
  };
  // arrival spots for "데려다 주세요" (open ground in front of each place, facing it)
  const SPAWN = G.data.layout?.spawn || {};
  const GO = {
    // phase 4: the 정선 만장대 lookout deck (= the new-player spawn, facing the valley)
    manjangdae: A.go('ZONE_MANJANGDAE', Number.isFinite(SPAWN.x) ? SPAWN.x : 52, Number.isFinite(SPAWN.z) ? SPAWN.z : 109.4, Number.isFinite(SPAWN.rotY) ? SPAWN.rotY : PI),
    plaza: A.go('ZONE_MAIN', 0, 7),
    myJar: A.go('ZONE_JANGDOKDAE', 21.8, -3.4, PI / 2),
    jangdokdae: A.go('ZONE_JANGDOKDAE', 18, 4),
    crop: A.go('ZONE_CROP', 0, -17),
    herb: A.go('ZONE_HERB', -31, -30),
    edu: A.go('ZONE_EDUCATION', -33, -60),
    ferment: A.go('ZONE_FERMENTATION', -24, 3),
  };
  const Q1_ACTIVE = S('QUEST001', 'active');

  // ============================================================== 발효마스터 (NPC001) — tutorial QUEST001
  const fermentQuestions = [
    { text: '미생물이 뭐예요?', kid: '미생물?', emoji: '🦠', next: 'ferm_microbe' },
    { text: '발효와 부패는 어떻게 달라요?', kid: '상한 거랑 달라요?', emoji: '🤔', easy: false, next: 'ferm_rot' },
    { text: '장은 어떻게 만들어요?', kid: '장 만들기', emoji: '🫘', next: 'ferm_jang' },
    { text: '이제 됐어요, 고마워요!', kid: '고마워요', emoji: '👋', next: [{ if: Q1_ACTIVE, node: 'go_next' }, 'bye'] },
  ];
  const npc_master = {
    npc: 'NPC001',
    kidGreeting: '안녕하세요! 놀러 와 줘서 고마워요 😊',
    kidBarks: ['장 익는 냄새가 구수해요 🍲', '궁금한 건 뭐든 물어봐요! 😊', '발효는 기다리는 거예요 ⏳'],
    entries: [
      { if: S('QUEST001', 'completed'), node: 'q1_done' },
      { if: { notFlag: 'npc:master:intro' }, node: 'intro' },
      { if: STEP(0), node: 'g_meet' },
      { if: STEP(1), node: 'g_crop' },
      { if: STEP(2), node: 'g_water' },
      { if: STEP(3), node: 'g_harvest' },
      { if: STEP(4), node: 'g_jangdok' },
      { if: STEP(5), node: 'g_jar' },
      { if: STEP(6), node: 'g_edu' },
      { if: STEP(7), node: 'g_quiz' },
      { if: STEP(8), node: 'g_journal' },
      { node: 'hub' },
    ],
    barks: [
      { if: S('QUEST001', 'completed'), text: '{nickname}님, 보상이 기다리고 있어요! 이리 와 보세요.', kid: '{nickname}님, 선물이 있어요! 이리 와요 🎁' },
      { if: Q1_ACTIVE, text: '천천히 해도 괜찮아요. 막히면 언제든 물어보세요!', kid: '천천히 해도 괜찮아요! 모르면 나한테 와요 😊' },
      { if: { phase: 'NIGHT' }, text: '밤에도 장독 속 미생물은 쉬지 않고 일한답니다.', kid: '밤에도 장독 속 작은 친구들은 일해요 🌙' },
      '오늘도 장 익는 냄새가 구수하네요.',
      '발효는 기다림의 미학이랍니다.',
      '어서 오세요! 궁금한 건 뭐든 물어보세요.',
    ],
    nodes: {
      // ---- first meeting (spec #27 / #71)
      intro: {
        // phase 4: new visitors arrive from the 정선 만장대 lookout on the ridge
        variants: [{
          if: { visited: 'ZONE_MANJANGDAE' },
          text: '안녕하세요! 만장대에서 내려오느라 수고 많았어요.\n이곳은 **전통발효체험관**이에요. {nickname}님, 환영해요.',
          kid: '만장대에서 잘 내려왔네요! 🏔️ 여기는 **발효체험관**이에요.',
        }],
        kid: '안녕하세요, {nickname}님! 🏺 여기는 **전통발효체험관**이에요.',
        text: '안녕하세요! 이곳은 **전통발효체험관**입니다.\n{nickname}님, 오신 것을 환영해요.',
        emote: 'wave', actions: [A.flag('npc:master:intro')], next: 'intro2',
      },
      intro2: { text: '이곳에서는 직접 작물을 키우고, 전통발효식품을 알아보고,\n다양한 체험을 할 수 있어요.', next: 'intro3', kid: '밭에서 채소를 키우고, 맛있는 장도 만들어요! 🌱🍲' },
      intro3: {
        kid: '나는 발효마스터예요. 같이 둘러볼까요? 😊',
        text: '저는 발효 체험을 안내하는 발효마스터예요.\n먼저 주변을 한번 둘러볼까요?', emote: 'nod',
        choices: [
          { text: '체험관을 둘러볼게요', kid: '둘러볼래요', emoji: '🚶', next: 'tour' },
          { text: '발효에 대해 알려주세요', kid: '발효가 뭐예요?', emoji: '🫧', next: 'ferm1' },
          { text: '나중에 다시 올게요', kid: '나중에', emoji: '👋', next: 'later' },
        ],
      },
      later: { text: '좋아요! 언제든 다시 말을 걸어 주세요.\n금빛 표식이 갈 곳을 알려 줄 거예요.', emote: 'wave', kid: '좋아요! 반짝이는 금빛 표시를 따라가요 ✨' },
      tour: { text: '첫 체험은 농사예요. 광장 북쪽 **전통작물 구역**으로 가 볼까요?', emote: 'point', next: 'tour2', kid: '먼저 **밭**에 가 봐요! 광장 위쪽에 있어요 🌱' },
      tour2: {
        kid: '**다음 할 일** 카드와 금빛 표시를 따라가요 ✨',
        text: '화면 위의 **현재 목표**와 금빛 표식을 따라가면 길을 잃지 않아요.',
        choices: [
          { text: '네, 다녀올게요!', kid: '다녀올게요', emoji: '👍', end: true, actions: [A.anim('wave')] },
          { text: '지도를 보고 싶어요', kid: '지도 볼래요', emoji: '🗺️', actions: [A.map()] },
          { text: '발효 이야기도 궁금해요', kid: '발효 이야기', emoji: '🫧', next: 'ferm1' },
        ],
      },
      g_meet: { text: '다시 만나 반가워요, {nickname}님! 그럼 체험을 시작해 볼까요?', emote: 'wave', next: 'tour', kid: '또 만나서 반가워요, {nickname}님! 😊' },

      // ---- fermentation basics
      ferm1: { text: '발효는 눈에 보이지 않는 **미생물**이 음식을 천천히 바꾸는 과정이에요.', emote: 'think', next: 'ferm2', kid: '발효는 아주 작은 친구 **미생물**이 음식을 바꾸는 거예요 🦠' },
      ferm2: { text: '된장·간장·고추장 같은 장류와 김치, 식초가 모두 발효로 만들어져요.', choices: fermentQuestions, kid: '된장, 간장, 김치가 모두 발효 음식이에요! 🍲' },
      ferm_microbe: { text: '곰팡이·효모·세균처럼 아주 작은 생물이에요.\n메주에는 곰팡이와 고초균 같은 미생물이 자라요.', next: 'ferm_microbe2', kid: '곰팡이, 효모, 세균처럼 눈에 안 보이는 작은 생물이에요 🔬' },
      ferm_microbe2: { text: '김치가 새콤해지는 건 **유산균**이 젖산을 만들어 내기 때문이에요.', next: 'ferm_more', kid: '김치가 새콤해지는 건 **유산균** 덕분이에요 🥬' },
      ferm_rot: { text: '둘 다 미생물이 일으켜요. 사람에게 이롭게 바뀌면 **발효**,\n해롭게 바뀌면 **부패**라고 불러요.', next: 'ferm_rot2', kid: '좋게 바뀌면 **발효**, 나쁘게 바뀌면 **부패**예요!' },
      ferm_rot2: { text: '그래서 장을 담글 땐 소금, 깨끗한 그릇, 햇볕과 바람이 중요하답니다.', next: 'ferm_more', kid: '그래서 소금이랑 깨끗한 그릇이 중요해요 🧂' },
      ferm_jang: { text: '먼저 콩을 삶아 찧은 뒤 네모나게 빚어 말리고 띄우면 **메주**가 돼요.', next: 'ferm_jang2', kid: '콩을 삶아서 콩콩 찧고, 네모나게 빚으면 **메주**예요 🧱' },
      ferm_jang2: { text: '메주를 소금물에 담가 두었다가 장물을 떠내 달이면 **간장**이 돼요.', next: 'ferm_jang3', kid: '메주를 소금물에 담그면 **간장**이 생겨요 🫙' },
      ferm_jang3: { text: '남은 건더기를 버무려 항아리에서 익히면 **된장**이 되지요.\n장물과 건더기를 나누는 일을 \'장 가르기\'라고 해요.', emote: 'nod', next: 'ferm_more', kid: '남은 건더기는 **된장**이 돼요! 🟤' },
      ferm_more: { text: ['또 궁금한 게 있나요?', '다른 이야기도 들려드릴까요?'], choices: fermentQuestions, kid: ['또 궁금한 게 있어요? 🤔', '다른 이야기도 들려줄까요? 😊'] },
      go_next: { text: '좋아요! 지금 할 일은 **{objective}**예요.\n금빛 표식을 따라가 보세요.', emote: 'point', kid: '좋아요! 이제 **{next}** ✨ 금빛 표시를 따라가요!' },
      bye: { text: '언제든 또 물어보세요. 발효 이야기는 끝이 없거든요!', emote: 'nod', kid: '또 놀러 와요! 👋' },

      // ---- QUEST001 step guidance
      g_crop: { text: '반가워요, {nickname}님! 다음은 광장 북쪽의 **전통작물 구역**이에요.', emote: 'point', next: 'g_crop2', kid: '{nickname}님, 이제 **밭**에 가 봐요! 🌱' },
      g_crop2: {
        kid: '네모난 밭에서 콩, 고추, 배추가 자라요 🫘🌶️🥬',
        text: '네모난 밭 여섯 곳에서 콩, 고추, 배추 같은 작물이 자라고 있어요.',
        choices: [
          { text: '바로 가 볼게요!', kid: '가 볼게요', emoji: '🏃', end: true },
          { text: '지도를 볼래요', kid: '지도', emoji: '🗺️', actions: [A.map()] },
          { text: '발효 이야기 들려주세요', kid: '발효 이야기', emoji: '🫧', easy: false, next: 'ferm1' },
        ],
      },
      g_water: {
        kid: '밭 앞에서 **👆 눌러요** 버튼을 누르면 물을 줘요 💧',
        text: '밭에 다가가 **E 키**를 누르면 물을 줄 수 있어요.\n수분이 낮은 밭부터 챙겨 주세요.',
        choices: [
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
          { text: '수분이 낮으면 어떻게 돼요?', kid: '물이 없으면?', emoji: '🥵', next: 'g_water2' },
          { text: '발효 이야기 들려주세요', kid: '발효 이야기', emoji: '🫧', easy: false, next: 'ferm1' },
        ],
      },
      g_water2: { text: '수분이 부족하면 작물이 천천히 자라고 건강도 떨어져요.\n산골농부도 늘 그 얘기를 한답니다.', kid: '물이 없으면 채소가 천천히 자라고 힘이 없어져요 😢' },
      g_harvest: {
        kid: '다 자라면 거둘 수 있어요. 물을 주며 기다려요 💧',
        variants: [{ if: { plot: 'ready' }, text: '성장률이 **100%**가 된 밭이 있어요!\n다가가서 E 키로 수확해 보세요.', kid: '다 자란 밭이 있어요! 가서 **거둬요** 🧺' }],
        text: '성장률이 **100%**가 되면 수확할 수 있어요.\n물을 주며 조금만 기다려 보세요.',
        choices: [
          { text: '수확하러 갈게요!', kid: '거두러 갈게요', emoji: '🧺', end: true },
          { text: '작물은 어떻게 자라요?', kid: '어떻게 자라요?', emoji: '🌱', next: 'g_grow' },
        ],
      },
      g_grow: { text: '씨앗, 새싹, 성장 중, 성숙을 거쳐 **수확 가능** 단계가 돼요.\n물이 부족하지 않으면 쑥쑥 자라요.', kid: '씨앗 🌱 → 새싹 🌿 → 다 자라면 🌾 거둘 수 있어요!' },
      g_jangdok: { text: '수확 축하해요! 이번엔 광장 동쪽의 **장독대**로 가 볼까요?', emote: 'clap', next: 'g_jangdok2', kid: '잘했어요! 이제 **장독대**에 가 봐요 🏺' },
      g_jangdok2: {
        kid: '장독이 정말 많아요! 그중 하나는 {nickname}님 거예요 ✨',
        text: '수백 개의 장독이 햇볕을 쬐고 있는 멋진 곳이에요.\n그중 하나는 {nickname}님 거예요!',
        choices: [
          { text: '정말요? 가 볼게요!', kid: '가 볼게요', emoji: '🏃', end: true },
          { text: '장독대는 왜 볕 좋은 곳에 있어요?', kid: '왜 해가 좋아요?', emoji: '☀️', next: 'g_jangdok3' },
        ],
      },
      g_jangdok3: { text: '햇볕이 잘 들고 바람이 잘 통해야 장이 맛있게 익는다고 전해져요.', kid: '햇볕이랑 바람이 장을 맛있게 익혀 줘요 ☀️💨' },
      g_jar: { text: '장독대 앞줄에서 금빛으로 빛나는 장독이 바로 {nickname}님의 장독이에요.', emote: 'point', next: 'g_jar2', kid: '앞줄에서 반짝반짝 빛나는 장독이 {nickname}님 거예요 ✨' },
      g_jar2: {
        kid: '장독을 눌러서 잘 익고 있는지 봐요! 🏺',
        text: '장독을 클릭하거나 E 키를 눌러 **발효 상태**를 확인해 보세요.\n(지금 상태: {jar})',
        choices: [
          { text: '확인하러 갈게요!', kid: '보러 갈게요', emoji: '👀', end: true },
          { text: '발효 상태는 어떻게 바뀌어요?', kid: '어떻게 익어요?', emoji: '🌕', next: 'g_jar3' },
          { text: '장독 앞으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.myJar] },
        ],
      },
      g_jar3: { text: '재료 준비, 발효, 숙성을 거쳐 **완성**돼요.\n날씨와 정성스러운 관리에 따라 품질이 달라진답니다.', kid: '재료 넣고, 보글보글 발효하고, 푹 익으면 완성! 🌑🌓🌕' },
      g_edu: {
        kid: '이제 그림 이야기를 볼 차례예요 📖 안내판을 눌러 봐요!',
        text: '이제 배워 볼 차례예요.\n안내판이나 키오스크에 다가가 **E 키**를 눌러 보세요.', emote: 'nod',
        choices: [
          { text: '지금 바로 볼래요', kid: '지금 볼래요', emoji: '📖', actions: [A.edu('EDU_FERMENT')] },
          { text: '어디에 있어요?', kid: '어디 있어요?', emoji: '🔍', next: 'g_edu2' },
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      g_edu2: {
        kid: '광장 곳곳의 안내판과 키오스크에 있어요 🪧',
        text: '광장과 구역 곳곳의 안내판, 그리고 서쪽 체험교육 구역의 키오스크에 있어요.',
        choices: [
          { text: '지금 바로 볼래요', kid: '지금 볼래요', emoji: '📖', actions: [A.edu('EDU_FERMENT')] },
          { text: '고마워요!', kid: '고마워요', emoji: '👋', end: true },
        ],
      },
      g_quiz: {
        kid: '배운 걸 퀴즈로 맞혀 볼까요? ❓',
        text: '배운 내용을 퀴즈로 확인해 볼까요?\n교육 콘텐츠의 마지막 장에서도 풀 수 있어요.', emote: 'think',
        choices: [
          { text: '퀴즈 풀래요!', kid: '퀴즈 할래요', emoji: '❓', actions: [A.quiz('EDU_FERMENT')] },
          { text: '조금 더 배우고 올게요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      g_journal: {
        kid: '마지막이에요! 오늘 한 일을 **일기**에 남겨요 📝',
        text: '마지막이에요! 오늘 한 일을 **작업일지**에 적어 볼까요?\nJ 키로도 열 수 있어요.', emote: 'clap',
        choices: [
          { text: '지금 쓸래요', kid: '일기 쓸래요', emoji: '📝', actions: [A.journal()] },
          { text: '무엇을 적으면 돼요?', kid: '뭘 적어요?', emoji: '🤔', next: 'g_journal2' },
          { text: '나중에 쓸게요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      g_journal2: {
        kid: '오늘 한 일이랑 기분을 그림으로 남기면 돼요 😊',
        text: '오늘 한 일, 수확한 작물, 배운 점과 느낀 점을 편하게 적으면 돼요.\n사진도 함께 남길 수 있어요.',
        choices: [
          { text: '지금 쓸래요', kid: '일기 쓸래요', emoji: '📝', actions: [A.journal()] },
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },

      // ---- QUEST001 complete
      q1_done: {
        kid: '와, 다 해냈어요! 정말 대단해요, {nickname}님! 🎉',
        text: '와, 모든 체험을 해냈네요! 정말 대단해요, {nickname}님.', emote: 'clap',
        choices: [{ text: '보상 받을게요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('QUEST001')], next: 'q1_done2' }],
      },
      q1_done2: { text: '이제 어엿한 **체험관 새내기**예요!\n작은 장독과 콩 씨앗도 함께 챙겨 드렸어요.', emote: 'thumbsup', next: 'q1_done3', kid: '이제 **체험관 새내기**예요! 선물도 챙겨 줬어요 🎁' },
      q1_done3: {
        kid: '다른 친구들도 {nickname}님을 기다려요! 👋',
        text: '산골농부, 전통사랑, 장독지기도 {nickname}님을 기다려요.\n차례로 찾아가 보세요!',
        choices: [
          { text: '다른 분들은 어디 있어요?', kid: '어디 있어요?', emoji: '🗺️', next: 'where' },
          { text: '고마워요, 발효마스터!', kid: '고마워요', emoji: '👋', end: true, actions: [A.anim('wave')] },
        ],
      },
      where: { text: '산골농부는 전통작물 구역, 전통사랑은 체험교육 구역,\n장독지기는 장독대에 있어요.', emote: 'point', kid: '산골농부는 밭, 전통사랑은 배움터, 장독지기는 장독대에 있어요 🗺️' },

      // ---- after the tutorial
      hub: {
        kid: ['또 만나서 반가워요, {nickname}님! 😊', '어서 와요, {nickname}님! 뭐 하고 놀까요?'],
        variants: [{ if: { phase: 'NIGHT' }, text: '늦은 시간까지 체험하시네요, {nickname}님!\n무엇이 궁금한가요?', kid: '밤인데도 놀러 왔네요, {nickname}님! 🌙' }],
        text: ['다시 만나 반가워요, {nickname}님! 무엇이 궁금한가요?', '어서 와요, {nickname}님. 오늘은 어떤 이야기를 해 볼까요?'],
        choices: [
          { text: '발효 이야기를 더 들려주세요', kid: '발효 이야기', emoji: '🫧', next: 'ferm1' },
          { text: '다음엔 무엇을 하면 좋을까요?', kid: '뭐 할까요?', emoji: '🤔', next: 'advice' },
          { text: '내 장독은 잘 익고 있나요?', kid: '내 장독', emoji: '🏺', next: 'myjar' },
          { text: '안녕히 계세요', kid: '안녕', emoji: '👋', end: true, actions: [A.anim('wave')] },
        ],
      },
      advice: {
        kid: '채소를 돌보고, 장독도 살피고, 일기도 써 봐요! 😊',
        variants: [
          { if: { jarStatus: { J1: 'COMPLETE' } }, text: '{nickname}님 장독의 장이 다 익었어요!\n장독대에서 열어 수령해 보세요.', kid: '{nickname}님 장독이 다 익었어요! 가서 꺼내요 🎉' },
          { if: S('Q_FARMER', 'available'), text: '산골농부가 일손을 찾고 있대요.\n전통작물 구역으로 가 보세요.', kid: '산골농부가 도움이 필요해요! 밭으로 가 봐요 🌱' },
          { if: S('Q_DOENJANG', 'available'), text: '장독지기를 찾아가 보세요.\n{nickname}님 장독의 된장 이야기를 들려줄 거예요.', kid: '장독지기를 찾아가 봐요! 🏺' },
          { if: S('Q_QUIZ3', 'available'), text: '전통사랑이 퀴즈 도전자를 찾고 있어요.\n체험교육 구역으로 가 보세요.', kid: '전통사랑이 퀴즈 친구를 찾아요! ❓' },
          { if: { plot: 'ready' }, text: '다 자란 작물이 있는 것 같아요. 밭에 들러 수확해 보세요!', kid: '다 자란 채소가 있어요! 거두러 가요 🧺' },
        ],
        text: '작물을 돌보고, 장독을 살피고, 배운 것을 작업일지에 남겨 보세요.\n그게 최고의 체험이에요.',
        choices: [
          { text: '퀘스트 목록을 볼래요', kid: '할 일 보기', emoji: '📜', actions: [A.quests()] },
          { text: '고마워요!', kid: '고마워요', emoji: '👋', end: true },
        ],
      },
      myjar: {
        kid: '{nickname}님 장독은 맛있게 익고 있어요! 🌕',
        variants: [
          { if: { jarStatus: { J1: 'COMPLETE' } }, text: '{nickname}님 장독이 다 익었어요! 어서 가서 열어 보세요.', kid: '장독이 다 익었어요! 어서 열어 봐요 🎉' },
          { if: { jarStatus: { J1: ['EMPTY', 'CLAIMED'] } }, text: '장독이 비어 있어요. 장독대에서 새 발효를 시작해 볼까요?', kid: '장독이 비었어요. 새 장을 담가 볼까요? 🏺' },
        ],
        text: '{nickname}님의 장독 상태는 **{jar}**!\n정성껏 돌볼수록 맛이 깊어져요.',
        choices: [
          { text: '장독 앞으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.myJar] },
          { text: '고마워요', kid: '고마워요', emoji: '👋', end: true },
        ],
      },
    },
  };

  // ============================================================== 산골농부 (NPC002) — Q_FARMER, Q_HERB, farming tips
  const farmTips = [
    { text: '물은 언제 줘야 해요?', kid: '물은 언제?', emoji: '💧', next: 't_water' },
    { text: '작물은 어떻게 자라요?', kid: '어떻게 자라요?', emoji: '🌱', next: 't_grow' },
    { text: '허브는 뭐가 달라요?', kid: '허브는?', emoji: '🌿', easy: false, next: 't_herb' },
    { text: '콩은 왜 특별해요?', kid: '콩은?', emoji: '🫘', next: 't_bean' },
  ];
  const npc_farmer = {
    npc: 'NPC002',
    kidGreeting: '안녕! 오늘 밭일하기 좋은 날이에요 🌱',
    kidBarks: ['흙냄새가 참 좋지요? 🌱', '채소는 물을 좋아해요 💧', '오늘 날씨가 좋아요! ☀️'],
    entries: [
      { if: S('Q_FARMER', 'completed'), node: 'claim1' },
      { if: S('Q_HERB', 'completed'), node: 'claim2' },
      { if: { notFlag: 'npc:farmer:met' }, node: 'first' },
      { if: S('Q_FARMER', 'available'), node: 'offer1' },
      { if: S('Q_FARMER', 'active'), node: 'prog1' },
      { if: S('Q_HERB', 'available'), node: 'offer2' },
      { if: S('Q_HERB', 'active'), node: 'prog2' },
      { node: 'hub' },
    ],
    barks: [
      { if: S('Q_FARMER', 'available'), text: '{nickname}님! 잠깐 밭일 좀 도와줄래요?', kid: '{nickname}님! 밭일 좀 도와줄래요? 🌱' },
      { if: S('Q_FARMER', 'completed'), text: '밭이 다시 푸르네요! 이리 와요, 줄 게 있어요.', kid: '밭이 푸르러요! 이리 와요, 선물 있어요 🎁' },
      { if: S('Q_HERB', 'completed'), text: '허브 향기가 솔솔~ 고마워요! 이리 와 봐요.', kid: '허브 향기가 솔솔~ 이리 와 봐요 🌿' },
      { if: { plot: 'dry' }, text: '어이쿠, 목마른 밭이 있네. 물 좀 줘야겠어요.', kid: '어이쿠, 목마른 밭이 있어요! 물 줘요 💧' },
      '오늘 날씨가 좋네요! 밭일하기 딱이에요.',
      '흙냄새가 참 좋지요?',
      '작물은 주인 발소리를 듣고 자란대요, 허허.',
    ],
    nodes: {
      first: { text: '처음 보는 얼굴이네요!\n저는 이 밭을 돌보는 산골농부예요.', emote: 'wave', actions: [A.flag('npc:farmer:met')], next: 'first2', kid: '처음 보는 친구네요! 나는 밭을 돌보는 산골농부예요 👨‍🌾' },
      first2: {
        kid: '선물로 **들깨 씨앗**을 줄게요! 빈 밭에 심어 봐요 🌱',
        text: '밭일 시작하는 기념으로 **들깨 씨앗**을 좀 줄게요.\n빈 밭에 심어 봐요!', emote: 'thumbsup',
        actions: [A.give('ITEM_SEED_PERILLA', 2), A.flag('npc:farmer:gift')],
        next: [{ if: S('Q_FARMER', 'available'), node: 'offer1' }, 'hub'],
      },
      hub: {
        kid: ['오늘도 밭이 푸르러요! 뭐가 궁금해요? 😊', '어서 와요, {nickname}님! 밭 이야기 할까요?'],
        variants: [
          { if: { weather: 'RAIN' }, text: '비가 와서 땅이 촉촉하네요. 비 오는 날엔 흙냄새가 더 좋아요.', kid: '비가 와서 땅이 촉촉해요 🌧️' },
          { if: { phase: 'NIGHT' }, text: '밤에는 작물도 쉬어요. 우리도 쉬엄쉬엄 해요, 허허.', kid: '밤에는 채소도 쉬어요 🌙' },
        ],
        text: ['오늘도 밭은 푸르고 하늘은 맑네요. 무엇이 궁금해요?', '어서 와요, {nickname}님! 밭일 이야기 좀 해 볼까요?'],
        choices: [
          { if: S('Q_FARMER', 'locked'), text: '도울 일이 있나요?', kid: '도와줄까요?', emoji: '🙋', next: 'locked' },
          { if: S('Q_HERB', 'claimed'), text: '요즘 밭은 어때요?', kid: '밭은 어때요?', emoji: '🌱', next: 'after' },
          { text: '농사 비법 알려 주세요', kid: '농사 비법', emoji: '💡', next: 'tips' },
          { text: '씨앗은 어디서 구해요?', kid: '씨앗은 어디?', emoji: '🛒', next: 'seeds' },
          { text: '안녕히 계세요', kid: '안녕', emoji: '👋', end: true, actions: [A.anim('wave')] },
        ],
      },
      locked: { text: '고마워요! 먼저 광장의 발효마스터와 첫 체험부터 마치고 와요.\n그럼 부탁할 일이 있어요.', emote: 'nod', kid: '먼저 광장의 발효마스터를 만나고 와요! 🧑‍🍳' },
      after: { text: '덕분에 밭이 아주 잘 자라요.\n바구니 들고 자주 놀러 와요!', emote: 'thumbsup', kid: '덕분에 밭이 쑥쑥 자라요! 자주 놀러 와요 😊' },
      seeds: { text: '입구 **매점**에서 여러 씨앗을 팔아요.\n수확한 작물은 매점에 팔 수도 있고요.', emote: 'point', kid: '입구 **가게**에서 씨앗을 살 수 있어요 🛒' },
      tips: { text: '어떤 게 궁금해요?', emote: 'think', choices: farmTips, kid: '뭐가 궁금해요? 🤔' },
      t_water: { text: '수분이 **25%** 아래로 떨어지면 작물이 천천히 자라요.\n바싹 마르면 건강도 떨어지고요.', next: 't_water2', kid: '흙이 마르면 채소가 힘이 없어요 🥵 물을 자주 줘요!' },
      t_water2: { text: '밭 이름표의 수분을 보고 미리미리 물을 주세요.\n물뿌리개는 가방에 들어 있어요.', next: 'tips_more', kid: '밭 위의 💧 그림을 보고 물을 줘요!' },
      t_grow: { text: '씨앗, 새싹, 성장 중, 성숙, 수확 가능.\n이렇게 다섯 단계로 자라요.', next: 't_grow2', kid: '씨앗 → 새싹 → 쑥쑥 → 다 자라면 거둬요! 🌱🌿🌾' },
      t_grow2: { text: '성장률이 **100%**가 되면 수확할 수 있어요.\n바구니가 있으면 조금 더 거둘 수 있지요.', next: 'tips_more', kid: '다 자라면 반짝반짝 빛나요 ✨ 그때 거둬요!' },
      t_herb: { text: '허브는 물을 덜 먹어요. 라벤더와 로즈마리는\n특히 물 빠짐이 좋은 땅을 좋아한다고 해요.', next: 't_herb2', kid: '허브는 물을 조금만 먹어요 🌿' },
      t_herb2: { text: '박하와 레몬밤은 금방 자라서 수확하는 재미가 쏠쏠해요.', next: 'tips_more', kid: '박하랑 레몬밤은 금방 자라요! 🍃' },
      t_bean: { text: '콩은 뿌리혹박테리아 덕분에 땅을 기름지게 한다고 알려져 있어요.', next: 't_bean2', kid: '콩은 땅을 튼튼하게 만들어 준대요 🫘' },
      t_bean2: { text: '게다가 메주의 재료지요. 된장, 간장 모두 콩에서 시작해요!', emote: 'thumbsup', next: 'tips_more', kid: '그리고 된장이랑 간장도 콩으로 만들어요! 🟤' },
      tips_more: {
        kid: '또 궁금한 거 있어요? 😊',
        text: '또 궁금한 거 있어요?',
        choices: [
          { text: '다른 것도 알려 주세요', kid: '더 알려 줘요', emoji: '💡', next: 'tips' },
          { text: '고마워요, 잘 알겠어요!', kid: '고마워요', emoji: '👍', end: true, actions: [A.anim('thumbsup')] },
        ],
      },

      // ---- Q_FARMER
      offer1: {
        kid: '{nickname}님! 빈 밭에 씨앗을 심어 줄래요? 🌱',
        text: '{nickname}님, 마침 잘 왔어요!\n빈 밭이 생겼는데 씨앗 좀 심어 줄 수 있어요?', emote: 'think',
        choices: [
          { text: '좋아요, 도울게요!', kid: '도와줄게요', emoji: '👍', actions: [A.accept('Q_FARMER')], next: 'offer1_ok' },
          { text: '씨앗이 없어요', kid: '씨앗이 없어요', emoji: '😢', next: 'noseed' },
          { text: '나중에 할게요', kid: '나중에', emoji: '👋', next: 'later' },
        ],
      },
      offer1_ok: { text: '고마워요! 빈 밭 **두 곳**에 아무 씨앗이나 심어 주면 돼요.', emote: 'thumbsup', next: 'offer1_ok2', kid: '고마워요! 빈 밭 **두 곳**에 씨앗을 심어 줘요 🌱🌱' },
      offer1_ok2: { text: '빈 밭에 다가가 E 키를 누르면 심을 씨앗을 고를 수 있어요.', kid: '빈 밭 앞에서 👆 버튼을 누르면 씨앗을 골라요!' },
      noseed: {
        kid: '입구 가게에서 콩 씨앗을 사 봐요 🛒',
        variants: [{ if: { itemType: { seed: 1 } }, text: '가방에 씨앗이 있는 것 같은데요?\n가방(I)을 한번 열어 봐요, 허허.', kid: '가방에 씨앗이 있는 것 같아요! 🎒 열어 봐요' }],
        text: '그럼 입구 매점에 들러 봐요. 콩 씨앗이 제일 무난해요.',
        next: [{ if: S('Q_FARMER', 'available'), node: 'offer1' }],
      },
      later: { text: '그래요, 언제든 돌아와요.\n밭은 도망가지 않으니까요, 허허.', emote: 'wave', kid: '그래요, 언제든 와요! 밭은 기다려 줘요 😊' },
      prog1: {
        kid: '다 자란 채소를 먼저 거두면 밭이 비어요 🧺',
        variants: [{ if: { plot: 'empty' }, text: '빈 밭 두 곳에 씨앗을 심어 주세요.\n수확을 마친 밭이 비어 있을 거예요.', kid: '빈 밭 두 곳에 씨앗을 심어 줘요 🌱' }],
        text: '빈 밭이 없으면 다 자란 작물부터 수확해 보세요.\n그럼 밭이 비어요.',
        choices: [
          { text: '씨앗이 없어요', kid: '씨앗이 없어요', emoji: '😢', next: 'noseed' },
          { text: '곧 심을게요!', kid: '심을게요', emoji: '🌱', end: true },
        ],
      },
      claim1: {
        kid: '밭이 다시 푸르러졌어요! 고마워요 🎉',
        text: '밭이 다시 푸르러졌네요! 덕분에 한시름 놓았어요.', emote: 'clap',
        choices: [{ text: '별말씀을요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_FARMER')], next: 'claim1b' }],
      },
      claim1b: {
        kid: '옥수수, 무 씨앗이랑 **바구니**를 줄게요 🧺',
        text: '옥수수·무 씨앗이랑 **바구니**예요.\n바구니가 있으면 수확이 조금 늘어요.', emote: 'thumbsup',
        next: [{ if: S('Q_HERB', 'available'), node: 'offer2' }],
      },

      // ---- Q_HERB
      offer2: {
        kid: '하나 더 부탁해요! **허브 밭**에서 허브를 두 번 거둬 줘요 🌿',
        text: '하나만 더 부탁해도 될까요?\n서쪽 **허브 구역**의 허브를 두 번 수확해 줘요.',
        choices: [
          { text: '맡겨 주세요!', kid: '좋아요', emoji: '👍', actions: [A.accept('Q_HERB')], next: 'offer2_ok' },
          { text: '허브 구역이 어디예요?', kid: '어디예요?', emoji: '🗺️', next: 'herbwhere' },
          { text: '다음에 할게요', kid: '나중에', emoji: '👋', next: 'later' },
        ],
      },
      offer2_ok: { text: '고마워요! 허브 향 맡으며 천천히 해요.\n박하와 레몬밤은 금방 자라요.', emote: 'heart', kid: '고마워요! 박하랑 레몬밤은 금방 자라요 🍃' },
      herbwhere: {
        kid: '광장 왼쪽 위에 있어요. 보라색 꽃이 보이면 거기예요 🪻',
        text: '광장 서쪽, 발효식품 구역 북쪽이에요.\n보라색 라벤더가 보이면 다 온 거예요.', emote: 'point',
        next: [{ if: S('Q_HERB', 'available'), node: 'offer2' }],
      },
      prog2: {
        kid: '허브 밭에서 다 자란 허브를 거둬 봐요 🌿',
        text: '허브 구역에서 다 자란 허브를 수확해 보세요.\n허브는 물을 너무 많이 주지 않아도 돼요.',
        choices: [
          { text: '허브 구역이 어디예요?', kid: '어디예요?', emoji: '🗺️', next: 'herbwhere' },
          { text: '허브 구역으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.herb] },
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      claim2: {
        kid: '허브 향기가 솔솔~ 정말 고마워요! 🌿',
        text: '허브 향이 여기까지 나는 것 같아요! 정말 고마워요, {nickname}님.', emote: 'heart',
        choices: [{ text: '도울 수 있어 기뻐요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_HERB')], next: 'claim2b' }],
      },
      claim2b: { text: '라벤더와 로즈마리 모종이에요.\n허브 밭에 심으면 예쁘게 자랄 거예요.', emote: 'thumbsup', kid: '라벤더랑 로즈마리 모종이에요. 예쁘게 키워요 🪻' },
    },
  };

  // ============================================================== 전통사랑 (NPC003) — Q_QUIZ3, Q_CULTURE, culture talk
  const cultureTopics = [
    { text: '장독대와 옹기', kid: '장독대', emoji: '🏺', next: 'k_jang' },
    { text: '24절기', kid: '계절 이야기', emoji: '🌸', next: 'k_season' },
    { text: '김장 문화', kid: '김장', emoji: '🥬', next: 'k_kimjang' },
    { text: '이제 됐어요', kid: '그만할래요', emoji: '👋', next: 'hub_short' },
  ];
  const ANY_CULTURE_QUEST = { any: [S('Q_QUIZ3', 'open'), S('Q_CULTURE', 'open')] };
  // 쉬운 모드: a new task opens straight on its offer (the coach says "전통사랑에게 가요"; no menu hunting)
  const CULTURE_KID_OFFER = [
    { if: KID(S('Q_QUIZ3', 'available')), node: 'quiz_offer' },
    { if: KID(S('Q_CULTURE', 'available')), node: 'tools_offer' },
  ];
  const npc_culture = {
    npc: 'NPC003',
    kidGreeting: '반가워요~ 옛날 이야기 들어 볼래요? 📖',
    kidBarks: ['옛날 이야기는 재미있어요! 📖', '키오스크에서 퀴즈도 풀어요 ❓', '반가워요~ 😊'],
    entries: [
      { if: S('Q_QUIZ3', 'completed'), node: 'claim_quiz' },
      { if: S('Q_CULTURE', 'completed'), node: 'claim_tools' },
      { if: { notFlag: 'npc:culture:met' }, node: 'first' },
      ...CULTURE_KID_OFFER,
      { node: 'hub' },
    ],
    barks: [
      { if: { any: [S('Q_QUIZ3', 'completed'), S('Q_CULTURE', 'completed')] }, text: '와, 해냈군요! 이쪽으로 와 보세요~', kid: '와, 해냈어요! 이쪽으로 와요 🎉' },
      { if: { any: [S('Q_QUIZ3', 'available'), S('Q_CULTURE', 'available')] }, text: '{nickname}님~ 재미있는 도전 하나 해 볼래요?', kid: '{nickname}님~ 퀴즈 놀이 할래요? ❓' },
      '모두 반갑습니다~ 전통문화 이야기 들어 보실래요?',
      '옛 지혜는 알면 알수록 재미있어요!',
      '키오스크에서 퀴즈도 풀 수 있어요~',
    ],
    nodes: {
      first: { text: '반가워요! 저는 지역문화와 체험 프로그램을 맡고 있는\n전통사랑이에요.', emote: 'wave', actions: [A.flag('npc:culture:met')], next: 'first2', kid: '반가워요! 나는 옛날 이야기를 들려주는 전통사랑이에요 😊' },
      first2: { text: '장독대, 옹기, 절기처럼 우리 생활 속 전통 이야기를 들려 드릴게요.', emote: 'heart', next: [...CULTURE_KID_OFFER, 'hub'], kid: '장독대, 옹기, 계절 이야기를 들려줄게요 📖' },
      hub: {
        kid: ['뭐가 궁금해요? 천천히 골라요 😊', '오늘은 어떤 이야기를 할까요? 📖'],
        text: ['무엇이 궁금하세요? 천천히 골라 보세요~', '오늘은 어떤 이야기를 나눠 볼까요?'],
        choices: [
          { text: '전통문화 이야기 들려주세요', kid: '옛날 이야기', emoji: '📖', next: 'talk' },
          { text: '도전할 거리가 있나요?', kid: '도전할래요', emoji: '🏆', next: [{ if: ANY_CULTURE_QUEST, node: 'quests' }, { if: S('Q_QUIZ3', 'locked'), node: 'locked' }, 'allclear'] },
          { text: '교육 콘텐츠를 모아 볼래요', kid: '배움터', emoji: '📚', actions: [A.library()] },
          { text: '안녕히 계세요', kid: '안녕', emoji: '👋', end: true, actions: [A.anim('wave')] },
        ],
      },
      hub_short: {
        kid: '또 궁금하면 물어봐요~ 😊',
        text: '다른 것도 궁금하면 언제든 물어보세요~',
        choices: [
          { text: '도전할 거리가 있나요?', kid: '도전할래요', emoji: '🏆', next: [{ if: ANY_CULTURE_QUEST, node: 'quests' }, { if: S('Q_QUIZ3', 'locked'), node: 'locked' }, 'allclear'] },
          { text: '교육 콘텐츠를 모아 볼래요', kid: '배움터', emoji: '📚', actions: [A.library()] },
          { text: '재미있었어요!', kid: '재미있었어요', emoji: '👏', end: true, actions: [A.anim('clap')] },
        ],
      },
      locked: { text: '먼저 광장의 발효마스터와 첫 체험을 마치고 오세요.\n그다음에 재미있는 도전을 준비해 둘게요!', emote: 'nod', kid: '먼저 광장의 발효마스터를 만나고 와요! 🧑‍🍳' },
      allclear: { text: '준비한 도전은 모두 해냈어요! 대신 이야기보따리를 풀어 볼까요?', emote: 'clap', next: 'talk', kid: '도전을 다 해냈어요! 대신 이야기를 들려줄게요 👏' },
      quests: {
        kid: '어떤 도전을 해 볼래요? 🏆',
        text: '어떤 도전을 해 볼래요?', emote: 'think',
        choices: [
          { if: S('Q_QUIZ3', 'available'), text: '퀴즈에 도전할게요', kid: '퀴즈 할래요', emoji: '❓', next: 'quiz_offer' },
          { if: S('Q_QUIZ3', 'active'), text: '퀴즈는 어디서 풀어요?', kid: '퀴즈는 어디?', emoji: '🔍', next: 'quiz_prog' },
          { if: S('Q_CULTURE', 'available'), text: '옛 농기구가 궁금해요', kid: '옛날 도구', emoji: '🪵', next: 'tools_offer' },
          { if: S('Q_CULTURE', 'active'), text: '농기구 전시장은 어디예요?', kid: '도구는 어디?', emoji: '🔍', next: 'tools_prog' },
          { text: '다음에 할게요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      quiz_offer: {
        kid: '퀴즈 **세 문제**를 맞혀 봐요! 틀려도 괜찮아요 😊',
        text: '전통발효 퀴즈 **세 문제**를 맞혀 보세요.\n틀려도 다시 도전할 수 있어요!',
        choices: [
          { text: '도전할게요!', kid: '할래요', emoji: '💪', actions: [A.accept('Q_QUIZ3')], next: 'quiz_ok' },
          { text: '자신 없어요…', kid: '어려워요', emoji: '😟', next: 'quiz_shy' },
        ],
      },
      quiz_shy: {
        kid: '괜찮아요! 그림 이야기를 먼저 보면 쉬워요 📖',
        text: '괜찮아요! 안내판과 키오스크의 이야기를 먼저 읽으면\n금방 맞힐 수 있을 거예요.', emote: 'heart',
        choices: [
          { text: '그럼 도전할게요!', kid: '해 볼래요', emoji: '💪', actions: [A.accept('Q_QUIZ3')], next: 'quiz_ok' },
          { text: '먼저 공부할게요', kid: '이야기 볼래요', emoji: '📖', actions: [A.library()] },
        ],
      },
      quiz_ok: {
        kid: '좋아요! 지금 한 문제 풀어 볼까요? ❓',
        text: '좋아요! 지금 바로 한 문제 풀어 볼래요?', emote: 'clap',
        choices: [
          { text: '지금 풀래요!', kid: '지금 할래요', emoji: '❓', actions: [A.quiz()] },
          { text: '나중에 풀게요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      quiz_prog: {
        kid: '그림 이야기 끝이나 키오스크에서 퀴즈를 풀어요 🖥️',
        text: '교육 콘텐츠의 마지막 장이나 체험교육 구역 키오스크에서\n퀴즈를 풀 수 있어요.',
        choices: [
          { text: '지금 한 문제 풀래요', kid: '지금 할래요', emoji: '❓', actions: [A.quiz()] },
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      tools_offer: {
        kid: '**전통도구 전시장**에 옛날 도구가 있어요. 세 개만 보고 와요! 🪵',
        text: '**전통도구 전시장**에 옛 농기구가 있어요.\n세 가지만 살펴보고 와 줄래요?',
        choices: [
          { text: '다녀올게요!', kid: '다녀올게요', emoji: '👍', actions: [A.accept('Q_CULTURE')], next: 'tools_ok' },
          { text: '어떤 도구가 있어요?', kid: '어떤 도구?', emoji: '🤔', next: 'tools_list' },
        ],
      },
      tools_list: { text: '짐을 나르던 지게, 곡식을 가는 맷돌,\n곡식을 찧고 빻는 절구, 곡식의 티를 고르는 키가 있어요.', next: 'tools_list2', kid: '짐 나르는 지게, 콩 가는 맷돌, 콩콩 찧는 절구가 있어요 🪵' },
      tools_list2: { text: '김을 매는 호미와 떡을 찌는 시루도 있지요.\n하나하나 쓰임새가 달라요.', next: [{ if: S('Q_CULTURE', 'available'), node: 'tools_offer' }], kid: '김매는 호미랑 떡 찌는 시루도 있어요 🍡' },
      tools_ok: { text: '허브 구역 서쪽, 초가집 옆이 전시장이에요.\n도구에 다가가 E 키를 누르면 살펴볼 수 있어요.', emote: 'point', kid: '초가집 옆에 있어요. 도구 앞에서 👆 눌러요!' },
      tools_prog: { text: '허브 구역 서쪽, 초가집 옆이에요.\n지게와 맷돌이 보이면 다 온 거예요.', emote: 'point', kid: '초가집 옆이에요. 지게랑 맷돌이 보이면 거기예요 🪵' },
      claim_quiz: {
        kid: '세 문제를 다 맞혔어요! 정말 똑똑해요 🎉',
        text: '세 문제를 모두 맞혔군요! 정말 훌륭해요, {nickname}님.', emote: 'clap',
        choices: [{ text: '헤헤, 고마워요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_QUIZ3')], next: 'claim_quiz2' }],
      },
      claim_quiz2: { text: '배운 걸 작업일지에 남겨 두면 오래오래 기억에 남을 거예요.', emote: 'heart', kid: '배운 걸 일기에 남기면 오래 기억해요 📝' },
      claim_tools: {
        kid: '옛날 도구들 신기했죠? 😮',
        text: '옛 농기구들, 어땠어요? 조상들의 지혜가 느껴지죠?', emote: 'think',
        choices: [{ text: '정말 신기했어요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_CULTURE')], next: 'claim_tools2' }],
      },
      claim_tools2: { text: '살펴본 도구는 도감에도 기록돼요.\n하나씩 모아 보는 재미가 있답니다.', emote: 'nod', kid: '본 도구는 스티커북에 모여요 📖' },

      // ---- culture talk
      talk: { text: '어떤 이야기가 좋을까요?', emote: 'think', choices: cultureTopics, kid: '어떤 이야기가 좋을까요? 🤔' },
      k_jang: { text: '장독대는 장독을 모아 두는 곳이에요.\n볕이 잘 들고 바람이 잘 통하는 곳에 두었대요.', next: 'k_jang2', kid: '장독대는 장독을 모아 두는 곳이에요. 해가 잘 들어요 ☀️' },
      k_jang2: { text: '옹기는 흙으로 빚어 구운 그릇인데, 미세한 숨구멍이 있어\n**숨 쉬는 그릇**이라 불려요.', next: 'k_jang3', kid: '옹기는 흙으로 만든 그릇이에요. **숨 쉬는 그릇**이래요 🌬️' },
      k_jang3: { text: '독, 중두리, 항아리, 단지처럼 크기와 모양에 따라 이름이 달라요.\n발효주 저장고 앞에서 볼 수 있어요.', emote: 'point', next: 'more', kid: '크기에 따라 독, 항아리, 단지라고 불러요 🏺' },
      k_season: { text: '절기는 해의 움직임에 따라 한 해를 **스물넷**으로 나눈 거예요.', next: 'k_season2', kid: '옛날 사람들은 한 해를 **스물넷**으로 나눴어요 📅' },
      k_season2: { text: '옛사람들은 절기에 맞춰 씨를 뿌리고 거두며 농사 일정을 정했어요.', next: 'k_season3', kid: '그때에 맞춰 씨를 뿌리고 곡식을 거뒀어요 🌱🌾' },
      k_season3: { text: '입춘은 봄의 시작, 하지는 낮이 가장 긴 날,\n동지는 밤이 가장 긴 날이에요.', emote: 'nod', next: 'more', kid: '하지는 낮이 제일 길고, 동지는 밤이 제일 길어요 ☀️🌙' },
      k_kimjang: { text: '김장은 겨울을 앞두고 김치를 한꺼번에 많이 담그는 일이에요.', next: 'k_kimjang2', kid: '김장은 겨울 전에 김치를 많이 담그는 날이에요 🥬' },
      k_kimjang2: { text: '이웃과 가족이 모여 함께 담그고 나누는 **김장 문화**는\n유네스코 인류무형문화유산이에요.', emote: 'clap', next: 'more', kid: '이웃이랑 함께 담그고 나눠요! 세계가 아끼는 문화예요 🌏' },
      more: { text: '또 듣고 싶은 이야기가 있나요?', choices: cultureTopics, kid: '또 듣고 싶은 이야기 있어요? 😊' },
    },
  };

  // ============================================================== 장독지기 (NPC004) — Q_MEJU, Q_DOENJANG, Q_NEW_FERMENT
  const ANY_KEEPER_QUEST = { any: [S('Q_MEJU', 'open'), S('Q_DOENJANG', 'open'), S('Q_NEW_FERMENT', 'open')] };
  // 쉬운 모드: a new task opens straight on its offer (the coach says "장독지기에게 가요"; no menu hunting)
  const KEEPER_KID_OFFER = [
    { if: KID(S('Q_MEJU', 'available')), node: 'meju_offer' },
    { if: KID(S('Q_DOENJANG', 'available')), node: 'doen_offer' },
    { if: KID(S('Q_NEW_FERMENT', 'available')), node: 'new_offer' },
  ];
  const keeperTips = [
    { text: '장독은 어디에 둬요?', kid: '장독은 어디?', emoji: '☀️', next: 'tip_place' },
    { text: '뚜껑은 언제 열어요?', kid: '뚜껑은 언제?', emoji: '🏺', next: 'tip_lid' },
    { text: '메주는 어떻게 만들어요?', kid: '메주 만들기', emoji: '🧱', next: 'meju' },
    { text: '장 담그는 순서가 궁금해요', kid: '장 담그기', emoji: '🫙', next: 'tip_order' },
  ];
  const npc_keeper = {
    npc: 'NPC004',
    kidGreeting: '어서 와요. 장독은 해랑 바람을 좋아해요 ☀️',
    kidBarks: ['장맛은 정성 맛이에요 🏺', '장독은 해를 좋아해요 ☀️', '허허, 반가워요 😊'],
    entries: [
      { if: S('Q_DOENJANG', 'completed'), node: 'claim_doen' },
      { if: S('Q_MEJU', 'completed'), node: 'claim_meju' },
      { if: S('Q_NEW_FERMENT', 'completed'), node: 'claim_new' },
      { if: { notFlag: 'npc:keeper:met' }, node: 'first' },
      { if: { jarStatus: { J1: 'COMPLETE' } }, node: 'ready' },
      ...KEEPER_KID_OFFER,
      { node: 'hub' },
    ],
    barks: [
      { if: { jarStatus: { J1: 'COMPLETE' } }, text: '{nickname}님 장독이 다 익었어요! 어서 와 봐요.', kid: '{nickname}님 장독이 다 익었어요! 와 봐요 🎉' },
      { if: { any: [S('Q_MEJU', 'completed'), S('Q_DOENJANG', 'completed'), S('Q_NEW_FERMENT', 'completed')] }, text: '잘했어요! 이리 와 봐요, 줄 게 있어요.', kid: '잘했어요! 이리 와요, 선물 있어요 🎁' },
      { if: { any: [S('Q_MEJU', 'available'), S('Q_DOENJANG', 'available'), S('Q_NEW_FERMENT', 'available')] }, text: '장 담그는 일, 한번 배워 볼래요?', kid: '장 담그기, 같이 해 볼래요? 🏺' },
      { if: { weather: 'RAIN' }, text: '비 오는 날엔 장독 뚜껑 단속이 먼저예요.', kid: '비 오면 장독 뚜껑을 닫아요 🌧️' },
      { if: { phase: 'NIGHT' }, text: '밤이슬 맞기 전에 장독 뚜껑을 덮어야지.', kid: '밤에는 장독 뚜껑을 덮어요 🌙' },
      '장독은 햇볕과 바람이 잘 드는 곳에 두어야 해요.',
      '장맛은 정성 맛이지요, 허허.',
    ],
    nodes: {
      first: { text: '어서 와요. 나는 이 장독대를 오래 돌봐 온 장독지기예요.', emote: 'bow', actions: [A.flag('npc:keeper:met')], next: 'first2', kid: '어서 와요. 나는 장독대를 돌보는 장독지기예요 👴' },
      first2: { text: '앞줄에서 금빛으로 빛나는 장독이 {nickname}님 몫이에요.\n정성껏 돌봐 줘요.', emote: 'point', next: [{ if: { jarStatus: { J1: 'COMPLETE' } }, node: 'ready' }, ...KEEPER_KID_OFFER, 'hub'], kid: '반짝반짝 빛나는 장독이 {nickname}님 거예요. 잘 돌봐 줘요 ✨' },
      ready: {
        kid: '{nickname}님 장독이 다 익었어요! 열어 봐요 🎉',
        text: '{nickname}님 장독의 장이 다 익었어요!\n뚜껑을 열어 수령해 봐요.', emote: 'clap',
        choices: [
          { text: '장독 열어 볼래요!', kid: '열어 볼래요', emoji: '🏺', actions: [A.jar('J1')] },
          { text: '조금 이따 볼게요', kid: '이따가', emoji: '⏳', next: 'hub' },
        ],
      },
      hub: {
        kid: ['장독은 정성으로 익어요. 뭘 도와줄까요? 😊', '허허, 또 왔네요! 장 이야기 해 줄까요?'],
        variants: [{ if: { weather: 'RAIN' }, text: '비가 오네요. 이런 날엔 장독 뚜껑을 꼭 닫아 둬야 해요.\n무엇을 도와줄까요?', kid: '비가 와요. 장독 뚜껑을 꼭 닫아요 🌧️' }],
        text: ['장독은 정성으로 익는 법이지요. 무엇을 도와줄까요?', '허허, 또 왔군요. 장 이야기라면 얼마든지 해 주지요.'],
        choices: [
          { text: '내 장독 상태가 궁금해요', kid: '내 장독', emoji: '🏺', next: 'myjar' },
          { text: '장 담그는 법을 알려 주세요', kid: '장 담그기', emoji: '🫙', next: 'tips' },
          { text: '일거리 있나요?', kid: '도와줄까요?', emoji: '🙋', next: [{ if: ANY_KEEPER_QUEST, node: 'quests' }, { if: S('Q_MEJU', 'locked'), node: 'locked' }, 'allclear'] },
          { text: '안녕히 계세요', kid: '안녕', emoji: '👋', end: true, actions: [A.anim('bow')] },
        ],
      },
      myjar: {
        kid: '보글보글 발효 중이에요! 햇볕이랑 바람이 도와줘요 ☀️💨',
        variants: [
          { if: { jarStatus: { J1: 'COMPLETE' } }, text: '다 익었어요! 어서 장독을 열어 수령해 봐요.', kid: '다 익었어요! 장독을 열어 꺼내요 🎉' },
          { if: { jarStatus: { J1: ['EMPTY', 'CLAIMED'] } }, text: '장독이 비어 있네요.\n재료를 넣고 새 발효를 시작해 볼까요?', kid: '장독이 비었어요. 새 장을 담가 볼까요? 🏺' },
          { if: { jarStatus: { J1: 'PREPARING' } }, text: '재료를 막 넣었군요. 이제 미생물이 일할 차례예요.\n(지금 상태: {jar})', kid: '재료를 막 넣었어요. 이제 기다려요 ⏳' },
          { if: { jarStatus: { J1: 'AGING' } }, text: '이제 **숙성** 단계예요. 맛이 깊어지는 시간이지요.\n(지금 상태: {jar})', kid: '푹 익는 중이에요. 맛이 깊어져요 🌕' },
        ],
        text: '한창 **발효** 중이에요. 햇볕과 바람이 장맛을 키워요.\n(지금 상태: {jar})',
        choices: [
          { text: '장독 열어 볼래요', kid: '열어 볼래요', emoji: '🏺', actions: [A.jar('J1')] },
          { text: '품질을 높이려면요?', kid: '더 맛있게?', emoji: '⭐', next: 'quality' },
          { text: '알겠어요', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      quality: { text: '날 좋을 땐 **햇볕 쬐기**, 답답할 땐 **환기**,\n가끔은 **닦기**로 장독을 깨끗하게 해 줘요.', emote: 'interact', next: 'quality2', kid: '해가 좋으면 ☀️ 햇볕, 답답하면 💨 바람, 가끔 🧼 닦아 줘요!' },
      quality2: { text: '온도와 습도가 알맞을수록 품질이 좋아져요.\n다만 게임 속 수치는 체험용 시뮬레이션이에요.', emote: 'nod', kid: '정성껏 돌보면 더 맛있어져요! 게임 속 이야기예요 😊' },
      tips: { text: '무엇부터 알려 줄까요?', emote: 'think', choices: keeperTips, kid: '뭐부터 알려 줄까요? 🤔' },
      tip_place: { text: '장독은 볕이 잘 들고 바람이 잘 통하는 곳에 둬요.\n그래서 장독대가 양지바른 곳에 있지요.', next: 'tips_more', kid: '장독은 해가 잘 들고 바람이 잘 부는 곳에 둬요 ☀️💨' },
      tip_lid: { text: '맑은 날엔 뚜껑을 열어 볕을 쬐어 주고,\n비가 오거나 해가 지면 꼭 닫아 줘요.', next: 'tip_lid2', kid: '맑은 날엔 뚜껑을 열고, 비 오면 꼭 닫아요 🌧️' },
      tip_lid2: { text: '장독 겉면도 자주 닦아 깨끗하게 해 주는 게 좋아요.', emote: 'interact', next: 'tips_more', kid: '장독 겉도 깨끗이 닦아 줘요 🧼' },
      meju: { text: '콩을 푹 삶아 찧은 다음 네모나게 빚어 말리고 띄우면\n**메주**가 돼요.', next: 'meju2', kid: '콩을 푹 삶아 찧어서 네모나게 빚으면 **메주**예요 🧱' },
      meju2: {
        kid: '작업대에서 콩 세 개로 메주를 만들 수 있어요 🔨',
        text: '여기서는 발효식품 구역 **작업대**에서 콩 세 개로 메주 하나를 빚을 수 있어요.',
        choices: [
          { text: '작업대를 열어 주세요', kid: '만들래요', emoji: '🔨', actions: [A.craft()] },
          { text: '알겠어요', kid: '알겠어요', emoji: '👍', next: 'tips_more' },
        ],
      },
      tip_order: { text: '메주를 소금물에 담그고, 시간이 지나면 장물과 건더기를 나눠요.\n이걸 **장 가르기**라고 해요.', next: 'tip_order2', kid: '메주를 소금물에 담갔다가 건더기랑 물을 나눠요 🫙' },
      tip_order2: { text: '장물은 달여서 간장으로, 건더기는 버무려 된장으로 익혀요.\n시간이 맛을 만들지요.', emote: 'nod', next: 'tips_more', kid: '물은 간장, 건더기는 된장이 돼요! 🟤' },
      tips_more: {
        kid: '또 궁금한 게 있어요? 😊',
        text: '또 궁금한 게 있어요?',
        choices: [
          { text: '다른 것도 알려 주세요', kid: '더 알려 줘요', emoji: '💡', next: 'tips' },
          { text: '잘 배웠어요!', kid: '잘 배웠어요', emoji: '👍', end: true, actions: [A.anim('nod')] },
        ],
      },
      locked: { text: '먼저 광장의 발효마스터에게 첫 체험을 배우고 와요.\n그럼 장 담그는 일을 맡겨 볼게요.', emote: 'nod', kid: '먼저 광장의 발효마스터를 만나고 와요! 🧑‍🍳' },
      allclear: { text: '맡길 일은 다 해냈어요!\n이제 어엿한 장독대 식구예요, 허허.', emote: 'clap', kid: '일을 다 해냈어요! 이제 장독대 가족이에요 👏' },
      quests: {
        kid: '어떤 일을 해 볼래요? 🙋',
        text: '어떤 일을 해 볼래요?',
        choices: [
          { if: S('Q_MEJU', 'available'), text: '메주를 빚어 볼게요', kid: '메주 만들기', emoji: '🧱', next: 'meju_offer' },
          { if: S('Q_MEJU', 'active'), text: '메주는 어디서 빚어요?', kid: '메주는 어디서?', emoji: '🔍', next: 'meju_prog' },
          { if: S('Q_DOENJANG', 'available'), text: '된장을 완성해 볼게요', kid: '된장 완성', emoji: '🟤', next: 'doen_offer' },
          { if: S('Q_DOENJANG', 'active'), text: '된장은 언제 다 익어요?', kid: '된장은 언제?', emoji: '⏳', next: 'doen_prog' },
          { if: S('Q_NEW_FERMENT', 'available'), text: '새로운 장을 담가 볼래요', kid: '새 장 담그기', emoji: '🫙', next: 'new_offer' },
          { if: S('Q_NEW_FERMENT', 'active'), text: '새 발효는 어떻게 시작해요?', kid: '어떻게 해요?', emoji: '🤔', next: 'new_prog' },
          { text: '다음에 할게요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      // Q_MEJU
      meju_offer: {
        kid: '메주를 만들어 볼래요? 콩이 필요해요 🫘',
        text: '메주는 장 담그기의 시작이에요.\n콩을 거둬서 작업대에서 메주를 빚어 볼래요?',
        choices: [
          { text: '해 볼게요!', kid: '할래요', emoji: '💪', actions: [A.accept('Q_MEJU')], next: 'meju_ok' },
          { text: '콩이 없어요', kid: '콩이 없어요', emoji: '😢', next: 'meju_bean' },
          { text: '다음에요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      meju_bean: { text: '콩은 전통작물 구역 1번 콩밭에서 거둘 수 있어요.\n콩 씨앗을 빈 밭에 심어도 되고요.', emote: 'point', next: [{ if: S('Q_MEJU', 'available'), node: 'meju_offer' }], kid: '1번 콩밭에서 콩을 거둘 수 있어요 🫘' },
      meju_ok: { text: '고마워요. 발효식품 구역 작업대에서 **콩 세 개**면\n메주 하나를 빚을 수 있어요.', emote: 'nod', kid: '고마워요! 작업대에서 **콩 세 개**로 메주를 만들어요 🔨' },
      meju_prog: {
        kid: '콩 세 개가 필요해요. 1번 콩밭에서 거둬 와요 🫘',
        variants: [{ if: { hasItem: { ITEM_BEAN: 3 } }, text: '콩이 넉넉하네요!\n발효식품 구역 작업대로 가서 메주를 빚어 봐요.', kid: '콩이 넉넉해요! 작업대로 가요 🔨' }],
        text: '콩 세 개가 필요해요. 1번 콩밭에서 콩을 거둬 와요.',
        choices: [
          { if: { hasItem: { ITEM_BEAN: 3 } }, text: '작업대를 열어 주세요', kid: '만들래요', emoji: '🔨', actions: [A.craft()] },
          { text: '알겠어요', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      // Q_DOENJANG
      doen_offer: {
        kid: '장독에서 된장이 익고 있어요. 끝까지 돌봐 줄래요? 🏺',
        variants: [{ if: { jarStatus: { J1: ['EMPTY', 'CLAIMED'] } }, text: '장독이 비었네요. 메주와 소금으로 된장을 새로 담가\n끝까지 익혀 볼래요?', kid: '장독이 비었어요. 된장을 새로 담가 볼래요? 🟤' }],
        text: '{nickname}님 장독에서 된장이 익고 있어요.\n끝까지 잘 돌봐서 수령해 볼래요?',
        choices: [
          { text: '맡겨 주세요!', kid: '좋아요', emoji: '👍', actions: [A.accept('Q_DOENJANG')], next: 'doen_ok' },
          { text: '다음에요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      doen_ok: { text: '가끔 들러 환기도 시키고 볕도 쬐어 줘요.\n정성만큼 맛이 깊어진답니다.', emote: 'nod', kid: '가끔 바람이랑 햇볕을 쐬어 줘요 ☀️💨' },
      doen_prog: {
        kid: '시간이 지나면 익어요. 틈틈이 돌봐 줘요 ⏳',
        variants: [
          { if: { jarStatus: { J1: 'COMPLETE' } }, text: '다 익었어요! 장독을 열어 수령하면 돼요.', kid: '다 익었어요! 열어서 꺼내요 🎉' },
          { if: { jarStatus: { J1: ['EMPTY', 'CLAIMED'] } }, text: '장독이 비어 있어요.\n**된장 체험**으로 발효를 다시 시작해 봐요.', kid: '장독이 비었어요. **된장**을 다시 담가요 🟤' },
        ],
        text: '시간이 지나면 익으니 틈틈이 돌봐 줘요.\n(지금 상태: {jar})',
        choices: [
          { text: '장독 열어 볼래요', kid: '열어 볼래요', emoji: '🏺', actions: [A.jar('J1')] },
          { text: '알겠어요', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      // Q_NEW_FERMENT
      new_offer: {
        kid: '이번엔 다른 장도 담가 볼까요? 간장, 고추장, 김치! 🫙',
        text: '이제 다른 장도 담가 볼 때예요.\n간장, 고추장, 김치, 식초 중에서 골라 봐요.', emote: 'think',
        choices: [
          { text: '도전할게요!', kid: '할래요', emoji: '💪', actions: [A.accept('Q_NEW_FERMENT')], next: 'new_ok' },
          { text: '다음에요', kid: '나중에', emoji: '👋', end: true },
        ],
      },
      new_ok: { text: '빈 장독을 열고 레시피를 고르면 돼요.\n재료가 모자라면 입구 매점에서 구할 수 있어요.', emote: 'nod', kid: '빈 장독을 열고 음식 그림을 골라요! 🏺' },
      new_prog: {
        kid: '빈 장독을 열고 만들 음식을 골라요 🍲',
        variants: [{ if: { jarStatus: { J1: ['PREPARING', 'FERMENTING', 'AGING', 'COMPLETE'] } }, text: '내 장독이 아직 차 있다면, 먼저 수령하거나\n빈 장독을 하나 더 마련해서 시작해도 돼요.', kid: '장독이 차 있으면 먼저 꺼내요! 🎁' }],
        text: '빈 장독을 열어 레시피를 고르고 발효를 시작해 봐요.\n재료는 가방에서 확인해요.',
        choices: [
          { text: '장독 열어 볼래요', kid: '열어 볼래요', emoji: '🏺', actions: [A.jar('J1')] },
          { text: '알겠어요', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      // claims
      claim_doen: {
        kid: '된장이 맛있게 익었어요! 🎉',
        text: '된장이 아주 잘 익었네요! 이 맛이 바로 정성의 맛이에요.', emote: 'clap',
        choices: [{ text: '다 장독지기 덕분이에요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_DOENJANG')], next: 'claim_doen2' }],
      },
      claim_doen2: { text: '이제 다른 장에도 도전해 볼 만해요.', emote: 'nod', next: [{ if: S('Q_NEW_FERMENT', 'available'), node: 'new_offer' }], kid: '이제 다른 장도 만들어 봐요! 🫙' },
      claim_meju: {
        kid: '메주를 반듯하게 잘 만들었어요! 👍',
        text: '메주를 아주 반듯하게 빚었네요! 손재주가 좋아요.', emote: 'thumbsup',
        choices: [{ text: '헤헤, 고마워요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_MEJU')], next: 'claim_meju2' }],
      },
      claim_meju2: { text: '장 담글 때 쓰라고 **천일염**을 좀 챙겨 줬어요.', emote: 'nod', kid: '장 담글 때 쓰라고 **소금**을 줬어요 🧂' },
      claim_new: {
        kid: '새 장을 담갔어요! 멋져요 🎉',
        text: '새 장을 담갔군요! 장독대가 한층 든든해졌어요.', emote: 'clap',
        choices: [{ text: '뿌듯해요!', kid: '선물 받기', emoji: '🎁', actions: [A.claim('Q_NEW_FERMENT')], next: 'claim_new2' }],
      },
      claim_new2: { text: '장은 기다림이에요.\n틈틈이 들러서 잘 익고 있는지 봐 줘요.', emote: 'bow', kid: '장은 기다림이에요. 자주 보러 와요 ⏳' },
    },
  };

  // ============================================================== 안내원 (NPC005) — welcome, map, shop, travel
  const npc_guide = {
    npc: 'NPC005',
    kidGreeting: '어서 오세요! 재미있게 놀아요 😊',
    kidBarks: ['어서 오세요! 😊', '가게에서 씨앗을 살 수 있어요 🛒', '길을 잃으면 🗺️ 어디 갈까? 를 눌러요'],
    entries: [
      { if: { notFlag: 'npc:guide:met' }, node: 'first' },
      { node: 'hub' },
    ],
    barks: [
      { if: { phase: 'EVENING' }, text: '좋은 저녁이에요! 노을 진 장독대도 꼭 보고 가세요.', kid: '좋은 저녁이에요! 노을 진 장독대 예뻐요 🌇' },
      { if: { phase: 'NIGHT' }, text: '밤길 조심하세요! 청사초롱이 길을 밝혀 줄 거예요.', kid: '밤길 조심해요! 등불이 길을 밝혀 줘요 🏮' },
      '전통발효체험관에 오신 것을 환영합니다!',
      '매점에서 씨앗과 재료를 살 수 있어요~',
      '산 위 정선 만장대에서 내려다보는 계곡 풍경, 정말 멋지지요?',
      '길을 잃으면 M 키로 지도를 열어 보세요!',
    ],
    nodes: {
      first: {
        kid: '어서 오세요! 나는 안내랑 가게를 맡고 있어요 😊',
        text: '전통발효체험관에 오신 것을 환영합니다!\n저는 입구 안내와 매점을 맡고 있어요.', emote: 'bow',
        actions: [A.flag('npc:guide:met')], next: 'hub',
      },
      hub: {
        kid: ['뭘 도와줄까요? 😊', '어서 오세요! 뭐가 필요해요?'],
        variants: [
          { if: { phase: 'MORNING' }, text: '좋은 아침이에요! 무엇을 도와드릴까요?', kid: '좋은 아침이에요! 뭘 도와줄까요? 🌅' },
          { if: { phase: 'EVENING' }, text: '좋은 저녁이에요! 무엇을 도와드릴까요?', kid: '좋은 저녁이에요! 뭘 도와줄까요? 🌇' },
        ],
        text: ['무엇을 도와드릴까요?', '어서 오세요! 무엇이 필요하세요?'],
        choices: [
          { text: '체험관을 소개해 주세요', kid: '구경 안내', emoji: '🏛️', next: 'tour1' },
          { text: '길 안내가 필요해요', kid: '길 찾기', emoji: '🗺️', next: 'way' },
          { text: '매점을 이용할래요', kid: '가게', emoji: '🛒', actions: [A.shop('SHOP_GENERAL')] },
          { text: '안녕히 계세요', kid: '안녕', emoji: '👋', end: true, actions: [A.anim('bow')] },
        ],
      },
      tour1: { text: '체험관은 **아홉 구역**으로 나뉘어 있어요.\n중앙 광장을 중심으로 길이 이어지고, 남쪽 산 위엔 **정선 만장대** 전망대가 있지요.', next: 'tour2', kid: '여기는 **아홉 곳**이 있어요. 산 위엔 **만장대** 전망대도 있어요 🏔️' },
      tour2: { text: '광장 북쪽엔 전통작물 구역과 체험관 본관,\n동쪽엔 수백 개의 장독이 늘어선 장독대가 있어요.', emote: 'point', next: 'tour3', kid: '위쪽엔 밭이랑 큰 건물, 오른쪽엔 장독대가 있어요 🌱🏺' },
      tour3: { text: '서쪽엔 발효식품·허브·체험교육 구역이,\n동남쪽엔 정자와 연못이 있는 휴식정원이 있어요.', next: 'tour4', kid: '왼쪽엔 허브 밭이랑 배움터, 아래엔 예쁜 연못이 있어요 🌸' },
      tour4: {
        kid: '처음이면 광장의 **발효마스터**를 먼저 만나요! 🧑‍🍳',
        text: '처음이라면 광장의 **발효마스터**부터 만나 보세요.\n첫 체험을 친절히 안내해 줄 거예요.', emote: 'nod',
        choices: [
          { text: '지도로 볼래요', kid: '지도', emoji: '🗺️', actions: [A.map()] },
          { text: '광장으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.plaza] },
          { text: '고마워요!', kid: '고마워요', emoji: '👋', end: true, actions: [A.anim('wave')] },
        ],
      },
      way: {
        kid: '어디로 갈까요? 🗺️',
        text: '어디로 안내해 드릴까요?',
        choices: [
          { text: '전체 지도를 볼래요', kid: '지도', emoji: '🗺️', actions: [A.map()] },
          { text: '빨리 이동하는 방법이 있나요?', kid: '빨리 가기', emoji: '⚡', next: 'travel' },
          { text: '어디부터 가면 좋을까요?', kid: '어디부터?', emoji: '🤔', next: 'where' },
          { text: '괜찮아요', kid: '괜찮아요', emoji: '👋', end: true },
        ],
      },
      travel: { text: '왼쪽 메뉴의 **이동** 버튼을 누르면\n원하는 구역으로 바로 갈 수 있어요.', emote: 'point', next: 'travel2', kid: '**🗺️ 어디 갈까?** 버튼을 누르면 바로 갈 수 있어요!' },
      travel2: {
        kid: '가고 싶은 곳 그림을 누르면 돼요 👆',
        text: '지도(M)에서 구역 이름을 누르고 \'여기로 이동\'을 골라도 돼요.',
        choices: [
          { text: '이동 메뉴를 열어 주세요', kid: '어디 갈까?', emoji: '🗺️', actions: [A.travel()] },
          { text: '광장으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.plaza] },
          { text: '알겠어요!', kid: '알겠어요', emoji: '👍', end: true },
        ],
      },
      where: {
        kid: '장독대가 정말 예뻐요! 정자에서 사진도 찍어 봐요 📸',
        variants: [{ if: Q1_ACTIVE, text: '광장의 발효마스터를 먼저 만나 보세요!\n지금 할 일은 **{objective}**예요.', kid: '광장의 발효마스터를 먼저 만나요! 🧑‍🍳' }],
        text: '장독대 풍경이 참 예뻐요.\n정자에서 쉬어 가며 사진을 찍어도 좋고요.',
        choices: [
          { text: '광장으로 데려다 주세요', kid: '데려다 줘요', emoji: '🚀', actions: [GO.plaza] },
          { text: '장독대로 데려다 주세요', kid: '장독대 가기', emoji: '🏺', actions: [GO.jangdokdae] },
          { text: '만장대 전망대로 데려다 주세요', kid: '만장대 가기', emoji: '🏔️', actions: [GO.manjangdae] },
          { text: '고마워요!', kid: '고마워요', emoji: '👋', end: true },
        ],
      },
    },
  };

  G.data.dialogues = Object.assign(G.data.dialogues || {}, { npc_master, npc_farmer, npc_culture, npc_keeper, npc_guide });
  /** arrival spots used by the dialogues (other systems may reuse them) */
  G.data.dialogueSpots = GO;
})();
