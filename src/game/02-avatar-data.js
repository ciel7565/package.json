// =============================================================================
// 02-avatar-data.js — the avatar's option table as plain data (CONTRACT §17.7, lane avatar)
//
//   G.data.avatar = {
//     v,                      table version (2 = phase 9: style `real`, 14 hair styles, headwear, hanbok pieces, …)
//     options { key: [ids | '#rrggbb'] }   every choice the customiser offers (20-avatar.js uses exactly this table)
//     colorKeys [key]                      the keys whose values are colours
//     legacy { key: [ids] }                ids older saves may still carry (accepted by the server, migrated by normalize)
//     defaults { key: value }              the look of a NEW profile (style `real`)
//     presets [{ id, emoji, label, say, app }]   ≥ 12 ready-made looks (the first six are the title screen's picks)
//   }
// Pure data (no THREE, no DOM): tools/build.mjs evaluates every 01- / 02- fragment in Node and exports `options` +
// `legacy` into game-data.json, where Tfm\Presence (the whitelist behind SaveValidator and the presence / sync looks)
// reads which ids are allowed. Change a list here and both sides follow after the next build.
// =============================================================================
(function () {
  const options = {
    style: ['real', 'cute'],
    skin: ['#fde3cf', '#f6d0b1', '#efc6a2', '#e6b48d', '#d9a77f', '#c68b62', '#a86d48', '#7d4f33'],
    face: ['smile', 'calm', 'cheer', 'gentle', 'bright'],
    hair: ['short', 'long', 'bun', 'ponytail', 'buzz', 'curly', 'daenggi', 'jjok', 'sangtu', 'pigtails', 'side', 'wave', 'bangs', 'twinbraid'],
    hairColor: ['#1f1a18', '#2f2520', '#3a2a20', '#4a3a2c', '#6b4a2e', '#8a5a34', '#b07a45', '#d9b26f', '#b9b4ad', '#6e3b4e'],
    hat: ['none', 'gat', 'jokduri', 'ayam', 'jobawi', 'hogeon', 'bokgeon', 'strawhat', 'cap', 'headband'],
    hatColor: ['#1f1f22', '#2e3f6e', '#6e2f4e', '#8a3b4b', '#2f5a3c', '#e2c27a', '#d9534f', '#f4c54a', '#ffffff', '#3b5ba5'],
    top: ['hanbok', 'saekdong', 'dangui', 'baeja', 'kwaeja', 'durumagi', 'tshirt', 'hoodie', 'shirt', 'jacket', 'apron'],
    topColor: ['#f1ece1', '#ffffff', '#e8d9b5', '#f08bb0', '#ff9f6b', '#ffd766', '#9bd27a', '#2f7d4a', '#6fc3df', '#4a78c8', '#2e3f6e', '#8b6fd6', '#d9534f', '#6d8f4e', '#7a5a43', '#3a3d42'],
    outerColor: ['#2e3f6e', '#4a78c8', '#2f7d4a', '#6d8f4e', '#8a3b4b', '#b45a73', '#6e3b4e', '#7a5a43', '#3a3d42', '#e8d9b5', '#f1ece1', '#d9534f'],
    pattern: ['none', 'geumbak', 'cloud', 'flower'],
    bottom: ['skirt', 'pants', 'shorts'],
    bottomColor: ['#2c3540', '#3c3934', '#3f5a3c', '#5a4636', '#2f6f8f', '#3b5ba5', '#7a6a55', '#c9b38f', '#8a3b4b', '#b45a73', '#e9e4da', '#1f1f22', '#d9534f', '#2e3f6e', '#6e3b4e', '#f08bb0'],
    footwear: ['gomusin', 'kkotsin', 'jipsin', 'sneakers'],
    shoes: ['#f5f0e6', '#ffffff', '#2a1d14', '#1f1f22', '#7a4a2c', '#d9534f', '#3b5ba5', '#e2c27a', '#b45a73', '#2f7d4a'],
    bag: ['none', 'backpack', 'basket', 'pouch'],
    bagColor: ['#8a5a3b', '#6b4a2e', '#b88a4a', '#2f7d4a', '#3b5ba5', '#d9534f', '#f4c54a', '#3a3d42'],
    accessory: ['none', 'norigae', 'bokjumeoni', 'fan', 'daenggi', 'glasses', 'beard'],
    accessoryColor: ['#d9534f', '#8a3b4b', '#f4c54a', '#2f7d4a', '#3b5ba5', '#6e3b4e', '#ffffff', '#1f1f22', '#e2c27a', '#cfcac2'],
  };
  const colorKeys = ['skin', 'hairColor', 'hatColor', 'topColor', 'outerColor', 'bottomColor', 'shoes', 'bagColor', 'accessoryColor'];
  // phase ≤ 8 saves: hats were accessories (moved to `hat` by normalize), sneakers had no footwear key
  const legacy = { accessory: ['strawhat', 'headband', 'cap', 'gat'] };
  // a new profile: the realistic style in a calm everyday hanbok (생활한복) with 고무신
  const defaults = {
    style: 'real', skin: '#f6d0b1', face: 'smile', hair: 'short', hairColor: '#2f2520', hat: 'none', hatColor: '#1f1f22',
    top: 'hanbok', topColor: '#f1ece1', outerColor: '#2e3f6e', pattern: 'none', bottom: 'pants', bottomColor: '#3f5a3c',
    footwear: 'gomusin', shoes: '#f5f0e6', bag: 'none', bagColor: '#8a5a3b', accessory: 'none', accessoryColor: '#d9534f', height: 1,
  };
  const L = (o) => Object.assign({}, defaults, o);
  const presets = [
    { id: 'seollal', emoji: '🎎', label: '설빔 친구', say: '색동저고리에 다홍치마를 입은 설날 친구예요.',
      app: L({ hair: 'daenggi', top: 'saekdong', topColor: '#ffd766', bottom: 'skirt', bottomColor: '#d9534f', pattern: 'geumbak', footwear: 'kkotsin', shoes: '#b45a73', accessory: 'norigae', accessoryColor: '#8a3b4b', face: 'cheer', height: 0.95 }) },
    { id: 'seonbi', emoji: '🎩', label: '선비 친구', say: '두루마기에 갓을 쓴 선비 친구예요.',
      app: L({ hair: 'sangtu', hat: 'gat', top: 'durumagi', topColor: '#f1ece1', outerColor: '#e8d9b5', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'gomusin', shoes: '#1f1f22', accessory: 'fan', accessoryColor: '#e2c27a', face: 'calm', height: 1.05 }) },
    { id: 'farmer', emoji: '🧑‍🌾', label: '농부 친구', say: '밀짚모자를 쓰고 짚신을 신은 농부 친구예요.',
      app: L({ hair: 'side', hat: 'strawhat', hatColor: '#e2c27a', top: 'hanbok', topColor: '#e8d9b5', bottom: 'pants', bottomColor: '#c9b38f', footwear: 'jipsin', shoes: '#e2c27a', bag: 'basket', bagColor: '#b88a4a', face: 'cheer' }) },
    { id: 'gungjung', emoji: '👑', label: '궁중 친구', say: '금박 당의를 입고 족두리를 쓴 친구예요.',
      app: L({ hair: 'jjok', hat: 'jokduri', top: 'dangui', topColor: '#2f7d4a', bottom: 'skirt', bottomColor: '#d9534f', pattern: 'geumbak', footwear: 'kkotsin', shoes: '#d9534f', accessory: 'norigae', accessoryColor: '#6e3b4e', face: 'gentle' }) },
    { id: 'hogeon', emoji: '🐯', label: '호건 친구', say: '호랑이 호건을 쓰고 쾌자를 입은 씩씩한 친구예요.',
      app: L({ hair: 'buzz', hat: 'hogeon', top: 'kwaeja', topColor: '#ffd766', outerColor: '#2e3f6e', bottom: 'pants', bottomColor: '#8a3b4b', pattern: 'cloud', footwear: 'gomusin', shoes: '#2a1d14', accessory: 'bokjumeoni', accessoryColor: '#d9534f', face: 'bright', height: 0.92 }) },
    { id: 'winter', emoji: '❄️', label: '겨울 친구', say: '배자를 입고 조바위를 쓴 겨울 친구예요.',
      app: L({ hair: 'daenggi', hat: 'jobawi', hatColor: '#6e2f4e', top: 'baeja', topColor: '#f08bb0', outerColor: '#6e3b4e', bottom: 'skirt', bottomColor: '#2e3f6e', pattern: 'flower', footwear: 'kkotsin', shoes: '#8a3b4b', accessory: 'bokjumeoni', accessoryColor: '#f4c54a', face: 'smile', height: 0.95 }) },
    { id: 'grandma', emoji: '👵', label: '장 담그는 할머니', say: '아얌을 쓰고 장을 담그는 할머니예요.',
      app: L({ skin: '#e6b48d', hair: 'jjok', hairColor: '#b9b4ad', hat: 'ayam', hatColor: '#1f1f22', top: 'hanbok', topColor: '#e8d9b5', bottom: 'skirt', bottomColor: '#5a4636', footwear: 'gomusin', shoes: '#ffffff', face: 'gentle', height: 0.92 }) },
    { id: 'scholar', emoji: '📜', label: '서당 친구', say: '복건을 쓰고 책을 읽는 서당 친구예요.',
      app: L({ hair: 'daenggi', hat: 'bokgeon', top: 'kwaeja', topColor: '#f1ece1', outerColor: '#2e3f6e', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'gomusin', shoes: '#1f1f22', face: 'calm', height: 0.95 }) },
    { id: 'explorer', emoji: '🧢', label: '탐험가 친구', say: '모자를 쓰고 가방을 멘 탐험가 친구예요.',
      app: L({ hair: 'short', hairColor: '#4a3a2c', hat: 'cap', hatColor: '#d9534f', top: 'jacket', topColor: '#e8d9b5', bottom: 'pants', bottomColor: '#3f5a3c', footwear: 'sneakers', shoes: '#f5f0e6', bag: 'backpack', bagColor: '#8a5a3b', face: 'cheer' }) },
    { id: 'cook', emoji: '🧑‍🍳', label: '요리사 친구', say: '앞치마를 두르고 김치를 담그는 요리사 친구예요.',
      app: L({ skin: '#e6b48d', hair: 'ponytail', hairColor: '#6b4a2e', hat: 'headband', hatColor: '#ffffff', top: 'apron', topColor: '#ffffff', bottom: 'pants', bottomColor: '#2c3540', footwear: 'sneakers', shoes: '#f5f0e6', face: 'smile' }) },
    { id: 'student', emoji: '🎒', label: '학교 친구', say: '후드티를 입고 백팩을 멘 학교 친구예요.',
      app: L({ hair: 'bangs', hairColor: '#2f2520', top: 'hoodie', topColor: '#8b6fd6', bottom: 'skirt', bottomColor: '#2e3f6e', footwear: 'sneakers', shoes: '#ffffff', bag: 'backpack', bagColor: '#f4c54a', accessory: 'glasses', accessoryColor: '#1f1f22', face: 'bright', height: 0.93 }) },
    { id: 'potter', emoji: '🏺', label: '옹기장이', say: '옹기를 빚는 옹기장이 아저씨예요.',
      app: L({ skin: '#c68b62', hair: 'side', hairColor: '#1f1a18', hat: 'headband', hatColor: '#e8d9b5', top: 'hanbok', topColor: '#7a5a43', bottom: 'pants', bottomColor: '#5a4636', footwear: 'jipsin', shoes: '#e2c27a', accessory: 'beard', accessoryColor: '#1f1f22', face: 'calm', height: 1.08 }) },
    { id: 'twins', emoji: '🎀', label: '양갈래 친구', say: '양갈래 머리에 리본을 단 친구예요.',
      app: L({ hair: 'twinbraid', hairColor: '#3a2a20', top: 'shirt', topColor: '#6fc3df', bottom: 'skirt', bottomColor: '#ffd766', footwear: 'sneakers', shoes: '#d9534f', accessory: 'daenggi', accessoryColor: '#d9534f', face: 'cheer', height: 0.92 }) },
    { id: 'wave', emoji: '🌊', label: '긴 머리 친구', say: '물결 머리를 한 차분한 친구예요.',
      app: L({ hair: 'wave', hairColor: '#4a3a2c', top: 'tshirt', topColor: '#9bd27a', bottom: 'pants', bottomColor: '#3b5ba5', footwear: 'sneakers', shoes: '#ffffff', bag: 'pouch', bagColor: '#d9534f', face: 'gentle' }) },
    { id: 'cute', emoji: '🧸', label: '귀여운 모습', say: '동글동글 귀여운 모습이에요.',
      app: L({ style: 'cute', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#b45a73', footwear: 'kkotsin', shoes: '#ffffff', bag: 'pouch', bagColor: '#f4c54a', face: 'smile', height: 0.95 }) },
  ];
  G.data.avatar = { v: 2, options, colorKeys, legacy, defaults, presets };
})();
