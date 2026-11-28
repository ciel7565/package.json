// =============================================================================
// 38-healing-data.js — the visit to the 힐링관 as data: G.data.healing (CONTRACT §19.6, lane heal-program).
// Pure data + small pure helpers (no DOM, no THREE): tools/build.mjs evaluates this file in Node ([healing] block) and
// exports the room ids, their minutes and the state limits to server/data/game-data.json. 39-healing.js is the system,
// 79-healing-acts.js the ten activities, 69-healing-hall.js (lane heal-hall) the house.
//
//   G.data.healing = {
//     v, places: { LOBBY: 'PL_HEAL', STAY, TALK, R1 … R10 },   the place of every station room
//     stationKeys: { LOBBY: [...], …, R10: [...] }             + 'guide' and 'spot' in every room (§19.6)
//     rooms: { R1 … R10: { id, no, name, kid, emoji, min, phases?, curve, eff: {stress, …}, color, steps, little,
//              stations, says: { in, rest, end }, gentle? } }
//     order: ['R1', …, 'R10']                                  the plain order; plan(ask) the suggested one
//     ask: [{ id, q, say, opts: [{ emoji, label, say }] }]      the four picture questions of the 상담실
//     nums: [{ id, label, short, emoji, good: 'down' | 'up', hud }]   the numbers (0 – 100, play values)
//     words: { claim, help, … }                                calm lines (no claims: §19.0)
//     limits: { …state bounds }, scaleMax
//     base(ask, play) -> numbers     the numbers at the 상담실 (answers + the day's play)
//     curve(kind, p) -> 0 … 1        how much of a room's change has happened at progress p
//     numbers(visit, now, scale) -> numbers   base + finished rooms + the running course's share (any time, here or away)
//     measure(nums, seed) -> { balance, breath, posture, salt, microbes }   the play values of 제1관
//     courseMs(roomId, scale) / progress(course, now) / plan(ask) / nextStep(visit) / sanitize(raw) / serverTable()
//     startCourse(visit, roomId, now, scale) -> course   due(visit, now) -> [roomIds whose course ended, not yet stamped]
//   }
// Station line (the SAME line in 69-healing-hall.js, CONTRACT §19.6) — the only link between the two lanes.
// No health claims: the numbers come from what the visitor chose and did in the app, never from a body; nothing in the
// hall can be failed or lost, and no number has a value at which anything stops working.
// =============================================================================
G.healStations = G.healStations || { map: new Map(), set(room, key, at) { this.map.set(room + ':' + key, at); G.bus && G.bus.emit('heal:station', { room, key }); }, get(room, key) { return this.map.get(room + ':' + key) || null; } };
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const isMap = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const MIN = 60000;

  const places = { LOBBY: 'PL_HEAL', STAY: 'PL_HEAL_STAY', TALK: 'PL_HEAL_TALK' };
  for (let i = 1; i <= 10; i++) places['R' + i] = 'PL_HEAL_R' + i;
  const stationKeys = {
    LOBBY: ['desk', 'kiosk', 'bench'], STAY: ['door', 'shelf', 'rail', 'bed'], TALK: ['seat', 'manager'],
    R1: ['body', 'gut', 'gene', 'salt', 'board'], R2: ['mat', 'tray'], R3: ['seat', 'pot'], R4: ['track', 'gym1', 'gym2', 'gym3'],
    R5: ['tub', 'kettle', 'herbs'], R6: ['chair', 'stool'], R7: ['bed', 'towel'], R8: ['bed', 'oil'],
    R9: ['stand', 'plates', 'drums', 'cans', 'bottles', 'rack', 'gear'], R10: ['studio', 'desk', 'rest', 'coffin', 'camera'],
  };
  // + 'gear' (R9) and 'coffin' / 'camera' (R10), which the hall also sets; every room also 'guide' and 'spot'
  for (const k of Object.keys(stationKeys)) stationKeys[k].push('guide', 'spot');

  // the numbers (0 – 100, play values). good: which way is the calmer one
  const nums = [
    { id: 'stress', label: '스트레스', short: '스트레스', emoji: '🌧️', good: 'down', hud: true, kid: '마음이 무거운 정도' },
    { id: 'fatigue', label: '피로·긴장', short: '피로', emoji: '🪨', good: 'down', hud: true, kid: '몸이 뻐근한 정도' },
    { id: 'vital', label: '활력·컨디션', short: '활력', emoji: '🌱', good: 'up', hud: true, kid: '몸에 기운이 나는 정도' },
    { id: 'calm', label: '내면 성찰(평온)', short: '평온', emoji: '🌙', good: 'up', hud: true, kid: '마음이 고요한 정도' },
    { id: 'warm', label: '온기·순환', short: '온기', emoji: '🔥', good: 'up', hud: false, kid: '몸이 따뜻한 정도' },
    { id: 'stamina', label: '체력', short: '체력', emoji: '💪', good: 'up', hud: false, kid: '힘이 있는 정도' },
  ];
  const NUM_IDS = nums.map((n) => n.id);

  // ---------------------------------------------------------------- the ten rooms
  // steps (the first 1 – 3 minutes, wide timing, nothing to get wrong):
  //   { k: 'hold', sec, n }  press and hold the big button (n times)        { k: 'taps', n }  tap n times at your own pace
  //   { k: 'spots', pic, pts: [[x, y] 0 … 100], hold }  press the glowing spot, one after another
  //   { k: 'breath', n }  hold while the ring grows, let go while it shrinks (any rhythm counts)
  //   { k: 'pick', opts: [{ id, emoji, label }] }  choose one (every choice is a good one)
  //   { k: 'still', sec }  stand still on the plate (it waits for you)   { k: 'walk', laps }  barefoot laps on the track
  //   { k: 'reps', n, sec }  slow strength: hold to lift, let go to lower   { k: 'pairs', n }  pair the bases of a helix
  //   { k: 'scope', n }  find the friendly microbes in the microscope     { k: 'strip', sec }  dip the colour strip
  //   { k: 'swing' }  room 9 (79-healing-acts)   { k: 'portrait' | 'letter' | 'lie' | 'three' }  room 10
  //   every step: { at: station key, emoji, t (what to do, adult), kid (short, kid words), say (read aloud) }
  // little: small things now and then while the course rests (optional; each a tiny lift of the numbers)
  const P = (id, emoji, label) => ({ id, emoji, label });
  const rooms = {
    R1: {
      no: 1, name: '기본 검사관', kid: '몸과 마음 살펴보기', emoji: '🔍', min: 10, curve: 'ease', color: '#7fb6d9',
      eff: { stress: -3, fatigue: -2, vital: 2, calm: 4, warm: 0, stamina: 0 },
      steps: [
        { k: 'still', at: 'body', sec: 5, emoji: '🧍', t: '인바디 판 위에 서서 가만히 있어요. 균형·숨·자세 막대가 차올라요.', kid: '판 위에 가만히 서요', say: '판 위에 가만히 서 보아요.' },
        { k: 'scope', at: 'gut', n: 5, emoji: '🔬', t: '현미경으로 오늘 먹은 음식 속 고마운 미생물을 찾아요. 반짝이는 친구를 눌러요.', kid: '현미경 속 친구 찾기', say: '현미경 속 반짝이는 친구를 찾아요.' },
        { k: 'pairs', at: 'gene', n: 4, emoji: '🧬', t: '두 줄 사다리(이중 나선)의 짝을 맞춰 나만의 무늬를 만들어요. A는 T와, G는 C와 짝이에요.', kid: '짝꿍 맞추기', say: '짝꿍 블록을 맞춰 나만의 무늬를 만들어요.' },
        { k: 'strip', at: 'salt', sec: 2, emoji: '🧪', t: '색깔 종이(시험지)를 컵에 살짝 담가요. 오늘 만든 음식이 얼마나 짰는지 색으로 보여 줘요.', kid: '색깔 종이 담그기', say: '색깔 종이를 살짝 담가 보아요.' },
      ],
      little: [P('look', '👀', '결과판 다시 보기')],
      says: { in: '제1관 기본 검사관이에요. 놀이로 몸과 마음을 살펴봐요.', rest: '결과를 모아 오늘의 쉼 안내를 만들고 있어요.', end: '오늘의 쉼 안내가 나왔어요.' },
    },
    R2: {
      no: 2, name: '쑥뜸관', kid: '따뜻한 쑥뜸', emoji: '🔥', min: 60, curve: 'ease', color: '#d98a4a',
      eff: { stress: -8, fatigue: -14, vital: 6, calm: 4, warm: 24, stamina: 0 },
      steps: [
        { k: 'hold', at: 'mat', sec: 2, n: 1, emoji: '🛏️', t: '따뜻한 바닥 매트에 엎드려요. 버튼을 꾹 누르고 있으면 천천히 누워요.', kid: '매트에 엎드리기', say: '따뜻한 매트에 천천히 엎드려요.' },
        { k: 'spots', at: 'tray', pic: 'back', pts: [[38, 34], [62, 34], [50, 52], [40, 68], [60, 68]], hold: 0.8, emoji: '🔥', t: '등 위 반짝이는 자리에 쑥뜸 받침을 하나씩 올려요.', kid: '등에 쑥뜸 올리기', say: '반짝이는 자리에 쑥뜸을 하나씩 올려요.' },
        { k: 'hold', at: 'mat', sec: 2, n: 1, emoji: '🔄', t: '이제 바로 누워요. 버튼을 꾹 누르면 천천히 돌아누워요.', kid: '바로 눕기', say: '천천히 돌아누워요.' },
        { k: 'spots', at: 'tray', pic: 'belly', pts: [[50, 40], [36, 56], [64, 56], [50, 70]], hold: 0.8, emoji: '🔥', t: '배 위 반짝이는 자리에 쑥뜸 받침을 올려요.', kid: '배에 쑥뜸 올리기', say: '배 위에도 쑥뜸을 올려요.' },
      ],
      little: [P('ember', '🔥', '숯불 살피기'), P('tea', '🍵', '보리차 한 모금'), P('breath', '🌬️', '숨 고르기')],
      says: { in: '제2관 쑥뜸관이에요. 따뜻한 쑥 향을 맡으며 쉬어요.', rest: '은은한 쑥 향과 함께 몸이 따뜻해져요.', end: '쑥뜸이 다 탔어요. 몸이 따뜻해요.' },
    },
    R3: {
      no: 3, name: '좌훈관', kid: '쑥 김 쐬기', emoji: '♨️', min: 30, curve: 'ease', color: '#9bbf6a',
      eff: { stress: -8, fatigue: -8, vital: 6, calm: 5, warm: 12, stamina: 0 },
      steps: [
        { k: 'pick', at: 'pot', emoji: '🌿', t: '약초 항아리에 넣을 풀을 골라요. 무엇이든 좋아요.', kid: '좋은 향 고르기', say: '마음에 드는 향을 골라요.', opts: [P('ssuk', '🌿', '쑥'), P('sol', '🌲', '솔잎'), P('gukhwa', '🌼', '국화'), P('saenggang', '🫚', '생강')] },
        { k: 'hold', at: 'seat', sec: 2, n: 1, emoji: '🪑', t: '구멍 뚫린 나무 의자에 앉아요. 버튼을 꾹 누르면 앉아요.', kid: '의자에 앉기', say: '나무 의자에 앉아요.' },
        { k: 'breath', at: 'seat', n: 3, emoji: '🌬️', t: '따뜻한 김이 올라와요. 원이 커질 때 누르고, 작아질 때 놓으며 천천히 숨 쉬어요.', kid: '천천히 숨 쉬기', say: '원이 커지면 숨을 들이쉬고, 작아지면 내쉬어요.' },
      ],
      little: [P('breath', '🌬️', '숨 고르기'), P('herb', '🌿', '풀 더 넣기'), P('tea', '🍵', '물 한 모금')],
      says: { in: '제3관 좌훈관이에요. 약초 김을 쐬며 쉬어요.', rest: '따뜻한 김이 천천히 올라와요.', end: '좌훈이 끝났어요. 몸이 노곤해요.' },
    },
    R4: {
      no: 4, name: '맨발걷기·헬스장', kid: '맨발로 걷고 힘 기르기', emoji: '👣', min: 60, curve: 'two', color: '#c9a25a',
      phases: [{ min: 30, name: '맨발걷기' }, { min: 30, name: '헬스 근육 운동' }],
      eff: { stress: -8, fatigue: -4, vital: 12, calm: 3, warm: 8, stamina: 20 },
      steps: [
        { k: 'walk', at: 'track', laps: 1, emoji: '👣', t: '신을 벗고 황토·조약돌·모래 길을 한 바퀴 걸어요. 발자국 걸음 버튼을 천천히 눌러요.', kid: '맨발로 한 바퀴', say: '맨발로 천천히 한 바퀴 걸어요.' },
        { k: 'reps', at: 'gym1', n: 4, sec: 1.6, emoji: '🏋️', t: '첫째 기구: 버튼을 꾹 누르면 천천히 들어 올리고, 놓으면 천천히 내려요.', kid: '천천히 들어 올리기', say: '꾹 누르면 들어 올리고, 놓으면 내려요.' },
        { k: 'reps', at: 'gym2', n: 4, sec: 1.6, emoji: '🚣', t: '둘째 기구: 노를 젓듯이 천천히 당겨요.', kid: '노 젓기', say: '노를 젓듯이 천천히 당겨요.' },
        { k: 'reps', at: 'gym3', n: 4, sec: 1.6, emoji: '🧘', t: '셋째 자리: 천천히 다리를 뻗어요.', kid: '다리 쭉 뻗기', say: '천천히 다리를 쭉 뻗어요.' },
      ],
      little: [P('lap', '👣', '한 바퀴 더 걷기'), P('water', '💧', '물 한 모금'), P('stretch', '🙆', '기지개 켜기')],
      says: { in: '제4관 맨발걷기와 헬스장이에요. 신을 벗고 흙을 밟아 봐요.', rest: '천천히 걷고 쉬며 몸에 힘을 길러요.', end: '맨발걷기와 운동이 끝났어요. 몸에 힘이 나요.' },
    },
    R5: {
      no: 5, name: '족욕관', kid: '따뜻한 발 담그기', emoji: '🦶', min: 60, curve: 'ease', color: '#6fb2c9',
      eff: { stress: -8, fatigue: -16, vital: 6, calm: 4, warm: 14, stamina: 0 },
      steps: [
        { k: 'taps', at: 'kettle', n: 3, emoji: '🫗', t: '주전자의 따뜻한 물을 바가지로 떠서 대야에 부어요. 세 번 천천히 눌러요.', kid: '따뜻한 물 붓기', say: '따뜻한 물을 세 번 부어요.' },
        { k: 'pick', at: 'herbs', emoji: '🌿', t: '물에 띄울 약초를 골라요.', kid: '약초 고르기', say: '물에 띄울 약초를 골라요.', opts: [P('ssuk', '🌿', '쑥'), P('yuja', '🍋', '유자 껍질'), P('gukhwa', '🌼', '국화'), P('sol', '🌲', '솔잎')] },
        { k: 'hold', at: 'tub', sec: 2.5, n: 1, emoji: '🦶', t: '의자에 앉아 발을 천천히 물에 담가요. 버튼을 꾹 누르고 있어요.', kid: '발 담그기', say: '발을 천천히 담가요. 따뜻해요.' },
      ],
      little: [P('water', '🫗', '따뜻한 물 더 붓기'), P('wiggle', '🦶', '발가락 꼼지락'), P('tea', '🍵', '차 한 모금')],
      says: { in: '제5관 족욕관이에요. 따뜻한 물에 발을 담가요.', rest: '김이 모락모락, 발이 따뜻해요.', end: '족욕이 끝났어요. 다리가 가벼워요.' },
    },
    R6: {
      no: 6, name: '발마사지관', kid: '발 꾹꾹 누르기', emoji: '🖐️', min: 30, curve: 'ease', color: '#c98fb0',
      eff: { stress: -4, fatigue: -10, vital: 10, calm: 2, warm: 10, stamina: 0 },
      steps: [
        { k: 'hold', at: 'chair', sec: 2, n: 1, emoji: '💺', t: '푹신한 의자에 앉아 발을 받침에 올려요.', kid: '의자에 앉기', say: '푹신한 의자에 앉아요.' },
        { k: 'spots', at: 'stool', pic: 'foot', pts: [[50, 18], [40, 36], [60, 40], [50, 58], [44, 78], [56, 82]], hold: 1, emoji: '👆', t: '발 지도에서 빛나는 자리를 따라 꾹 눌러요.', kid: '빛나는 곳 누르기', say: '빛나는 곳을 따라 꾹 눌러요.' },
      ],
      little: [P('press', '👆', '한 번 더 꾹'), P('wiggle', '🦶', '발목 돌리기'), P('breath', '🌬️', '숨 고르기')],
      says: { in: '제6관 발마사지관이에요. 발을 꾹꾹 눌러 풀어요.', rest: '발이 따뜻해지고 몸이 가벼워져요.', end: '발마사지가 끝났어요. 발걸음이 가벼워요.' },
    },
    R7: {
      no: 7, name: '얼굴마사지관', kid: '얼굴 쓰다듬기', emoji: '🌸', min: 60, curve: 'ease', color: '#e3a0a8',
      eff: { stress: -10, fatigue: -10, vital: 8, calm: 6, warm: 6, stamina: 0 },
      steps: [
        { k: 'hold', at: 'bed', sec: 2, n: 1, emoji: '🛏️', t: '침대에 바로 누워요.', kid: '침대에 눕기', say: '침대에 편히 누워요.' },
        { k: 'spots', at: 'bed', pic: 'face', pts: [[50, 22], [34, 40], [66, 40], [38, 62], [62, 62], [50, 78]], hold: 1, emoji: '✋', t: '얼굴 위 그려진 선을 따라 빛나는 곳을 하나씩 쓰다듬어요.', kid: '선 따라 쓰다듬기', say: '빛나는 선을 따라 살살 쓰다듬어요.' },
        { k: 'hold', at: 'towel', sec: 2, n: 1, emoji: '🧖', t: '따뜻한 수건을 얼굴에 살포시 올려요.', kid: '따뜻한 수건 올리기', say: '따뜻한 수건을 살포시 올려요.' },
      ],
      little: [P('towel', '🧖', '수건 바꾸기'), P('breath', '🌬️', '숨 고르기'), P('smile', '😊', '살짝 웃기')],
      says: { in: '제7관 얼굴마사지관이에요. 얼굴을 살살 풀어요.', rest: '눈을 감고 쉬어요. 얼굴이 편안해요.', end: '얼굴마사지가 끝났어요. 얼굴이 산뜻해요.' },
    },
    R8: {
      no: 8, name: '바디마사지관', kid: '몸 풀기', emoji: '🌿', min: 60, curve: 'two', color: '#8fb98a',
      phases: [{ min: 30, name: '앞면' }, { min: 30, name: '뒷면' }],
      eff: { stress: -14, fatigue: -18, vital: 6, calm: 4, warm: 8, stamina: 0 },
      steps: [
        { k: 'pick', at: 'oil', emoji: '🫙', t: '쓸 기름을 골라요. 모두 순한 식물 기름이에요.', kid: '기름 고르기', say: '마음에 드는 기름을 골라요.', opts: [P('deulkkae', '🌾', '들깨 기름'), P('dongbaek', '🌺', '동백 기름'), P('sol', '🌲', '솔 향'), P('none', '🤲', '기름 없이')] },
        { k: 'hold', at: 'bed', sec: 2, n: 1, emoji: '🛏️', t: '담요를 덮고 바로 누워요.', kid: '담요 덮고 눕기', say: '담요를 덮고 편히 누워요.' },
        { k: 'spots', at: 'bed', pic: 'body', pts: [[50, 22], [34, 34], [66, 34], [40, 62], [60, 62]], hold: 1, emoji: '🤲', t: '어깨·팔·다리 — 쉬고 싶은 곳을 순서대로 골라요. 관리사의 손이 그곳을 풀어 줘요.', kid: '쉬고 싶은 곳 고르기', say: '쉬고 싶은 곳을 차례로 골라요.' },
      ],
      little: [P('turn', '🔄', '돌아눕기'), P('breath', '🌬️', '숨 고르기'), P('blanket', '🧣', '담요 여미기')],
      says: { in: '제8관 바디마사지관이에요. 담요 아래에서 몸을 풀어요.', rest: '관리사의 손이 어깨와 등을 천천히 풀어 줘요.', end: '바디마사지가 끝났어요. 몸이 노곤해요.' },
    },
    R9: {
      no: 9, name: '스트레스 해소관', kid: '깨고 부수며 시원하게', emoji: '⚾', min: 30, curve: 'early', color: '#d9534f',
      eff: { stress: -26, fatigue: -2, vital: 8, calm: 2, warm: 4, stamina: 4 },
      steps: [
        { k: 'gear', at: 'gear', emoji: '🥽', t: '보안경·장갑·앞치마를 차례로 입어요.', kid: '보안경·장갑·앞치마', say: '보안경, 장갑, 앞치마를 입어요.' },
        { k: 'swing', at: 'stand', emoji: '⚾', t: '나무 방망이로 접시·드럼통·깡통·유리병을 쳐요. 누르면 휘두르고, 꾹 누르면 더 세게!', kid: '방망이로 쳐요', say: '방망이로 시원하게 쳐요!' },
      ],
      little: [P('swing', '⚾', '한 번 더 치기'), P('water', '💧', '물 한 모금'), P('shout', '📣', '야호! 외치기')],
      says: { in: '제9관 스트레스 해소관이에요. 안전 장비를 입고 시원하게 쳐요.', rest: '선반이 다시 채워졌어요. 언제든 또 쳐도 좋아요.', end: '스트레스 해소가 끝났어요. 마음이 시원해요.' },
    },
    R10: {
      no: 10, name: '임종체험관', kid: '삶 돌아보기', emoji: '🕯️', min: 60, curve: 'late', color: '#8a7a9a',
      gentle: { name: '마음 돌아보기', kid: '오늘의 나 돌아보기', emoji: '🌟' },
      eff: { stress: -10, fatigue: -4, vital: 4, calm: 26, warm: 0, stamina: 0 },
      steps: [
        { k: 'portrait', at: 'studio', emoji: '🖼️', t: '사진관 의자에 앉아 영정 사진을 찍어요. 액자에 담겨 이 기기에만 남아요.', kid: '사진 찍기', say: '사진관에서 사진을 찍어요.' },
        { k: 'letter', at: 'desk', emoji: '✉️', t: '책상에서 유언장을 써요. 문장 카드를 골라 이어 붙여요. 글은 이 기기에만 남아요.', kid: '편지 쓰기', say: '문장 카드를 골라 편지를 써요.' },
        { k: 'lie', at: 'rest', emoji: '⚱️', t: '나무 관에 누워 어둠 속에서 천천히 숨 쉬어요. 잠시 뒤 뚜껑이 열리고 아침 햇살이 들어와요.', kid: '조용히 누워 쉬기', say: '조용히 누워 천천히 숨 쉬어요.' },
        { k: 'three', at: 'rest', emoji: '💐', t: '나에게 가장 소중한 세 가지를 골라요.', kid: '소중한 것 세 가지', say: '가장 소중한 세 가지를 골라요.' },
      ],
      gentleSteps: [
        { k: 'portrait', at: 'studio', emoji: '📸', t: '오늘의 나 사진을 찍어요. 액자에 담겨 이 기기에만 남아요.', kid: '오늘의 나 사진', say: '오늘의 나를 사진으로 찍어요.' },
        { k: 'letter', at: 'desk', emoji: '💌', t: '고마운 마음을 담은 편지를 카드로 만들어요.', kid: '고마운 마음 편지', say: '고마운 마음을 카드로 골라 편지를 만들어요.' },
        { k: 'lie', at: 'rest', emoji: '✨', t: '별빛 아래 매트에 누워 고요히 쉬어요.', kid: '별빛 아래 쉬기', say: '별빛 아래에 누워 고요히 쉬어요.' },
        { k: 'three', at: 'rest', emoji: '💐', t: '나에게 소중한 세 가지를 골라요.', kid: '소중한 것 세 가지', say: '소중한 세 가지를 골라요.' },
      ],
      little: [P('candle', '🕯️', '촛불 바라보기'), P('breath', '🌬️', '숨 고르기'), P('look', '🖼️', '사진 다시 보기')],
      says: { in: '제10관이에요. 천천히, 조용히 나를 돌아봐요.', rest: '조용한 음악과 함께 쉬어요.', end: '체험이 끝났어요. 마음이 고요해요.' },
      gentleSays: { in: '제10관 마음 돌아보기예요. 오늘의 나를 돌아봐요.', rest: '별빛처럼 고요하게 쉬어요.', end: '마음 돌아보기가 끝났어요. 마음이 포근해요.' },
    },
  };
  const order = Object.keys(rooms);
  for (const id of order) { rooms[id].id = id; rooms[id].stations = stationKeys[id]; }

  // the letter (sentence cards) and the three things that matter most (room 10)
  const letter = {
    full: ['사랑하는 사람들에게 고맙다고 말하고 싶어요.', '미안했던 일은 이제 웃으며 놓아 줄게요.', '하루하루가 참 소중했어요.', '내가 아끼던 물건은 필요한 사람에게 주세요.', '좋아하던 노래를 함께 불러 주세요.', '서로 아끼며 사이좋게 지내 주세요.', '나는 정말 행복했어요.', '건강히, 즐겁게 지내 주세요.', '다시 만날 날까지 안녕.'],
    gentle: ['오늘 함께해 줘서 고마워요.', '맛있는 밥을 해 줘서 고마워요.', '같이 놀아 줘서 정말 좋았어요.', '내가 도와줄 일이 있으면 말해 줘요.', '우리 내일도 웃으며 만나요.', '나는 네가 참 좋아.', '아플 때 곁에 있어 줘서 고마워요.', '가르쳐 줘서 고마워요.', '사랑해요!'],
    max: 5,
  };
  const three = [P('family', '👨‍👩‍👧', '가족'), P('friend', '🧑‍🤝‍🧑', '친구'), P('health', '🌱', '튼튼한 몸'), P('nature', '🏞️', '자연'), P('dream', '🌈', '꿈'), P('kind', '🤝', '나누는 마음'), P('today', '☀️', '오늘 하루'), P('learn', '📚', '배우는 기쁨'), P('food', '🍚', '맛있는 밥'), P('rest', '🛌', '쉼')];
  const portraitStyles = [P('classic', '🖤', '검은 띠 액자'), P('hanji', '📜', '한지 액자'), P('flower', '🌸', '꽃 액자'), P('star', '⭐', '별빛 액자')];

  // the four picture questions of the 상담실 (every answer is a good answer)
  const ask = [
    { id: 'mood', q: '오늘 기분은 어때요?', say: '오늘 기분은 어때요?', opts: [P(0, '😊', '좋아요'), P(1, '🙂', '괜찮아요'), P(2, '😐', '그저 그래요'), P(3, '😣', '조금 힘들어요')] },
    { id: 'ache', q: '뻐근한 곳이 있나요?', say: '뻐근한 곳이 있나요?', opts: [P(0, '🧍', '없어요'), P(1, '💆', '어깨·목'), P(2, '🙇', '허리·등'), P(3, '🦵', '다리·발')] },
    { id: 'sleep', q: '어젯밤 잠은 어땠어요?', say: '어젯밤에 잠은 잘 잤나요?', opts: [P(0, '😴', '푹 잤어요'), P(1, '🛌', '보통이에요'), P(2, '🥱', '조금 모자라요'), P(3, '🌙', '잘 못 잤어요')] },
    { id: 'wish', q: '오늘은 어떤 쉼을 바라요?', say: '오늘은 어떤 쉼을 바라요?', opts: [P(0, '🔥', '몸이 따뜻하게'), P(1, '🎈', '마음이 가볍게'), P(2, '💪', '몸에 힘이 나게'), P(3, '🌿', '조용히 쉬고 싶어요')] },
  ];
  const WISH_FIRST = [['R2', 'R3', 'R5'], ['R9', 'R7', 'R8'], ['R4', 'R6', 'R8'], ['R3', 'R7', 'R5']];

  const words = {
    claim: '여기는 놀이로 쉬어 가는 곳이에요. 진짜 검사나 치료가 아니에요.',
    claimKid: '여기는 놀이로 쉬는 곳이에요. 진짜 병원 검사가 아니에요.',
    help: '마음이 많이 무겁고 힘들 때는 혼자 견디지 않아도 돼요. 109(보건복지부 자살예방 상담전화)에 전화하면 언제든, 24시간 이야기를 들어 줘요.',
    helpSource: '보건복지부 보도자료 「분산된 자살예방 상담전화 1월 1일부터 ‘109’로 통합 운영」 (2024-01-01)',
    guide: '쉬어요 · 따뜻해요 · 시원해요 · 마음이 가벼워요',
    advice: '오늘의 쉼 안내',
    bundle: [P('clothes', '👕', '갈아입을 옷'), P('cup', '🍵', '내 컵'), P('book', '📖', '좋아하는 책')],
    outfit: '힐링복',
  };

  const limits = { rooms: 10, small: 60, r9: 100000, visits: 100000, wearKeys: 48, skewMs: 5 * MIN };
  const scaleMax = 120;

  // ---------------------------------------------------------------- pure helpers
  const curve = (kind, p) => {
    p = clamp(fin(p) ? p : 0, 0, 1);
    if (kind === 'early') return 1 - (1 - p) * (1 - p);
    if (kind === 'late') return p * p;
    if (kind === 'two') return p;            // two halves, each its own phase: a steady line
    return p * p * (3 - 2 * p);              // 'ease'
  };
  const courseMs = (id, scale) => { const r = rooms[id]; const k = clamp(fin(+scale) ? +scale : 1, 1, scaleMax); return r ? Math.round(r.min * MIN / k) : 0; };
  const progress = (c, now) => { if (!c || !fin(c.at) || !fin(c.end) || c.end <= c.at) return 0; return clamp((now - c.at) / (c.end - c.at), 0, 1); };
  const r1 = (v) => Math.round(clamp(fin(v) ? v : 50, 0, 100));
  /** the numbers at the 상담실: the four answers (0 … 3) + the day's play ({ level, minutes, dishes, jars }) */
  function base(a, play) {
    a = isMap(a) ? a : {};
    const g = (k) => { const v = Number(a[k]); return fin(v) ? clamp(Math.round(v), 0, 3) : 1; };
    const pl = isMap(play) ? play : {};
    const lv = clamp(Number(pl.level) || 1, 1, 99), mins = clamp(Number(pl.minutes) || 0, 0, 600);
    return {
      stress: r1([30, 40, 52, 64][g('mood')] + (mins > 120 ? 4 : 0)),
      fatigue: r1([40, 56, 58, 56][g('ache')] + [0, 4, 8, 12][g('sleep')]),
      vital: r1([64, 56, 48, 42][g('sleep')] + Math.min(6, Math.floor(mins / 30))),
      calm: r1([54, 48, 42, 36][g('mood')]),
      warm: r1(44 + (g('ache') === 0 ? 4 : 0)),
      stamina: r1(46 + Math.min(14, Math.floor(lv / 2)) + Math.min(6, Math.floor((Number(pl.dishes) || 0) / 3))),
    };
  }
  /** base + every finished room + the running course's share of its curve (here or away) */
  function numbers(visit, now) {
    const b = isMap(visit) && isMap(visit.base) ? visit.base : base({}, {});
    const out = {};
    for (const k of NUM_IDS) out[k] = fin(b[k]) ? b[k] : 50;
    const rs = isMap(visit) && isMap(visit.rooms) ? visit.rooms : {};
    for (const id of order) {
      const c = rs[id];
      if (!isMap(c) || !fin(c.at)) continue;
      const R = rooms[id];
      const share = c.done ? 1 : (c.stop ? clamp(Number(c.stop) || 0, 0, 1) : curve(R.curve, progress(c, now)));
      for (const k of NUM_IDS) out[k] += (R.eff[k] || 0) * share;
      const sm = clamp(Number(c.small) || 0, 0, limits.small);
      out.calm += Math.min(4, sm * 0.5); out.stress -= Math.min(4, sm * 0.5);
    }
    if (isMap(visit) && isMap(visit.r9)) { const hits = ['plates', 'drums', 'cans', 'bottles'].reduce((s, k) => s + clamp(Number(visit.r9[k]) || 0, 0, limits.r9), 0); out.stress -= Math.min(8, hits * 0.08); }
    for (const k of NUM_IDS) out[k] = Math.round(clamp(out[k], 0, 100) * 10) / 10;
    return out;
  }
  /** the play values of 제1관 (no body is measured: they follow the numbers, the answers and a seed) */
  function measure(n, seed, cooked) {
    n = isMap(n) ? n : {};
    const s = (Math.abs(Number(seed) || 7) % 97) / 97;
    const v = (k) => (fin(n[k]) ? n[k] : 50);
    const c = isMap(cooked) ? cooked : {};
    return {
      balance: r1(40 + (100 - v('fatigue')) * 0.35 + v('stamina') * 0.15 + s * 6),
      breath: r1(36 + (100 - v('stress')) * 0.4 + v('calm') * 0.15 + s * 4),
      posture: r1(42 + v('vital') * 0.3 + (100 - v('fatigue')) * 0.2 + s * 5),
      microbes: r1(30 + Math.min(40, (Number(c.jars) || 0) * 6 + (Number(c.dishes) || 0) * 3) + s * 10),
      salt: r1(clamp(30 + (Number(c.jang) || 0) * 7 - (Number(c.field) || 0) * 3 + s * 10, 15, 85)),
    };
  }
  /** the suggested order: 제1관 first, the three of the wish next, the rest in number order, 제10관 last */
  function plan(a) {
    const w = isMap(a) && fin(Number(a.wish)) ? clamp(Math.round(Number(a.wish)), 0, 3) : 1;
    const first = WISH_FIRST[w];
    const out = ['R1'];
    for (const id of first) if (!out.includes(id)) out.push(id);
    for (const id of order) if (!out.includes(id) && id !== 'R10') out.push(id);
    out.push('R10');
    return out;
  }
  /** where the visit stands: 'book' | 'checkin' | 'stay' | 'change' | 'counsel' | 'rooms' | 'report' | 'checkout' | 'out' */
  function nextStep(v, openRooms) {
    if (!isMap(v)) return 'book';
    if (v.out) return 'out';
    if (!v.band) return 'checkin';
    if ((v.stow || 0) < words.bundle.length) return 'stay';
    if (!v.changed) return 'change';
    if (!isMap(v.base)) return 'counsel';
    const rs = isMap(v.rooms) ? v.rooms : {};
    const list = Array.isArray(openRooms) && openRooms.length ? openRooms : order;
    if (list.some((id) => !(isMap(rs[id]) && rs[id].done))) return 'rooms';
    if (!v.rep) return 'report';
    return 'checkout';
  }

  // ---------------------------------------------------------------- sanitize (G.state.healing)
  const RX_ID = /^H[0-9a-z]{4,14}$/;
  const RX_WEAR_K = /^[a-zA-Z]{1,20}$/;
  const nOk = (v, a, b) => fin(v) && v >= a && v <= b;
  const tOk = (v) => nOk(v, 0, 1e14);
  function cleanNums(o) { if (!isMap(o)) return null; const out = {}; for (const k of NUM_IDS) out[k] = nOk(Number(o[k]), 0, 100) ? Math.round(Number(o[k]) * 10) / 10 : 50; return out; }
  function cleanVisit(v) {
    if (!isMap(v) || !tOk(v.at)) return null;
    const o = { id: typeof v.id === 'string' && RX_ID.test(v.id) ? v.id : 'H' + Math.floor(v.at).toString(36), at: Math.floor(v.at) };
    o.band = tOk(v.band) ? Math.floor(v.band) : 0;
    o.stow = nOk(v.stow, 0, words.bundle.length) ? Math.floor(v.stow) : 0;
    o.changed = tOk(v.changed) ? Math.floor(v.changed) : 0;
    if (isMap(v.ask)) { o.ask = {}; for (const q of ask) { const n = Number(v.ask[q.id]); o.ask[q.id] = nOk(n, 0, 3) ? Math.floor(n) : 1; } }
    const b = cleanNums(v.base); if (b) o.base = b;
    o.rooms = {};
    if (isMap(v.rooms)) for (const id of order) {
      const c = v.rooms[id];
      if (!isMap(c) || !tOk(c.at) || !tOk(c.end) || c.end < c.at) continue;
      const r = { at: Math.floor(c.at), end: Math.floor(c.end), done: tOk(c.done) && c.done ? Math.floor(c.done) : 0 };
      if (nOk(c.small, 0, limits.small)) r.small = Math.floor(c.small);
      if (nOk(c.stop, 0, 1) && c.stop > 0 && !r.done) r.stop = Math.round(c.stop * 1000) / 1000;
      if (nOk(c.step, 0, 20)) r.step = Math.floor(c.step);
      o.rooms[id] = r;
    }
    if (isMap(v.r1)) { o.r1 = {}; for (const k of ['balance', 'breath', 'posture', 'microbes', 'salt']) o.r1[k] = nOk(Number(v.r1[k]), 0, 100) ? Math.round(Number(v.r1[k])) : 50; if (typeof v.r1.pat === 'string' && /^[ATGC]{0,12}$/.test(v.r1.pat)) o.r1.pat = v.r1.pat; }
    if (isMap(v.r9)) { o.r9 = {}; for (const k of ['plates', 'drums', 'cans', 'bottles']) o.r9[k] = nOk(Number(v.r9[k]), 0, limits.r9) ? Math.floor(Number(v.r9[k])) : 0; }
    if (v.r10 === 'full' || v.r10 === 'gentle') o.r10 = v.r10;
    if (isMap(v.wear)) {
      const w = {}; let n = 0;
      for (const [k, x] of Object.entries(v.wear)) {
        if (n >= limits.wearKeys || !RX_WEAR_K.test(k)) continue;
        if (typeof x === 'string' && x.length <= 16 && /^[#a-zA-Z0-9_-]*$/.test(x)) { w[k] = x; n++; } else if (nOk(x, 0, 10)) { w[k] = x; n++; }
      }
      if (n) o.wear = w;
    }
    o.rep = tOk(v.rep) ? Math.floor(v.rep) : 0;
    o.out = tOk(v.out) ? Math.floor(v.out) : 0;
    return o;
  }
  function sanitize(raw) {
    const s = isMap(raw) ? raw : {};
    const out = { v: 1, visit: cleanVisit(s.visit), visits: nOk(s.visits, 0, limits.visits) ? Math.floor(s.visits) : 0, stamps: nOk(s.stamps, 0, limits.visits * 10) ? Math.floor(s.stamps) : 0 };
    if (isMap(s.last) && tOk(s.last.at)) {
      const l = { at: Math.floor(s.last.at), before: cleanNums(s.last.before), after: cleanNums(s.last.after) };
      if (l.before && l.after) out.last = l;
    }
    return out;
  }

  /** a new course of a room on the visit (real minutes ÷ scale) -> the course */
  function startCourse(v, id, now, scale) {
    if (!isMap(v) || !rooms[id] || !fin(now)) return null;
    v.rooms = isMap(v.rooms) ? v.rooms : {};
    const c = { at: Math.floor(now), end: Math.floor(now) + courseMs(id, scale), done: 0 };
    v.rooms[id] = c;
    return c;
  }
  /** the rooms whose course has ended by `now` and that still wait for their stamp (also after hours away) */
  function due(v, now) {
    if (!isMap(v) || !isMap(v.rooms)) return [];
    return order.filter((id) => { const c = v.rooms[id]; return isMap(c) && !c.done && !c.stop && c.end > 0 && now >= c.end; });
  }
  /** what the server needs: room ids → minutes, the station keys, the limits, the number ids */
  const serverTable = () => ({ v: 1, rooms: Object.fromEntries(order.map((id) => [id, rooms[id].min])), bundle: words.bundle.length, nums: NUM_IDS.slice(), limits: Object.assign({}, limits), scaleMax });

  G.data.healing = {
    v: 1, places, stationKeys, rooms, order, ask, nums, words, letter, three, portraitStyles, limits, scaleMax,
    base, curve, numbers, measure, courseMs, progress, plan, nextStep, sanitize, serverTable, startCourse, due,
  };
})();
