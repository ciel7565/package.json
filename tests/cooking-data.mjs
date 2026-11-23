#!/usr/bin/env node
// tests/cooking-data.mjs — the dishes of 36-cooking-data.js as data (CONTRACT §18.4, lane cooking). Node only.
//   node tests/cooking-data.mjs [--json]
// Every dish is complete and cookable from obtainable ingredients, its steps are sane (known stations and actions,
// slow timing, served on the 소반 last), fish dishes cook the fish through after it goes in and rinse the board,
// fish classes resolve to species that are not protected (the real G.data.fish when 34-fish-data.js is present, the
// stand-in list otherwise), the learning cards / quizzes / deck / quests merge, and no text carries Chinese characters
// or the forbidden word. Exit 0 = all passed, 1 = a check failed, 2 = the data could not be loaded.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/game');
const JSON_OUT = process.argv.includes('--json');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: ok ? undefined : detail }); if (!JSON_OUT) console.log(`${ok ? '✔' : '✖'} ${name}${ok || detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`); };

function load(files) {
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date, Set, Map });
  for (const f of files) vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(DIR, f), 'utf8')}\n})()`, ctx, { filename: f, timeout: 4000 });
  return G;
}
let G;
const names = fs.readdirSync(DIR).filter((f) => /^0[12]-|education-data|fish-data|cooking-data/.test(f)).sort();
try { G = load(names); G.data.cooking.mergeContent(); } catch (e) { console.error('✖ data could not be loaded:', e.message); process.exit(2); }
const d = G.data, C = d.cooking;
const hasFish = names.some((f) => /fish-data/.test(f)) && Array.isArray(d.fish?.species) && d.fish.species.length > 0;

// ---------------------------------------------------------------- shape
const dishes = Object.values(C.dishes);
check('at least 24 dishes', dishes.length >= 24, dishes.length);
const kinds = new Set(Object.keys(C.kinds));
for (const k of kinds) check(`dishes of kind ${k}`, dishes.some((x) => x.kind === k));
check('at least 8 fish dishes', dishes.filter((x) => x.kind === 'fish').length >= 8);
check('at least 6 dishes of 정선', dishes.filter((x) => x.kind === 'jeongseon').length >= 6);
const HEAT = new Set(['fire', 'boil', 'grill', 'steam', 'fry', 'stir', 'rest']);
const COOKS_FISH = new Set(['boil', 'grill', 'steam', 'fry']);
const obtain = C.obtainable();
const bad = [];
for (const x of dishes) {
  const id = x.id;
  const need = (ok, why) => { if (!ok) bad.push(`${id}: ${why}`); };
  need(/^DISH_[A-Z0-9_]{2,30}$/.test(id), 'id');
  need(typeof x.name === 'string' && x.name.length >= 2 && x.name.length <= 16, 'name');
  need(typeof x.emoji === 'string' && x.emoji.length >= 1, 'emoji');
  need(kinds.has(x.kind), 'kind');
  need(!!C.vessels[x.vessel], 'vessel ' + x.vessel);
  need(x.look && typeof x.look.type === 'string', 'look');
  need(typeof x.kid === 'string' && x.kid.length >= 8 && x.kid.length <= 60, 'kid line');
  need(typeof x.origin === 'string' && x.origin.length >= 10, 'origin');
  need(Array.isArray(x.sources) && x.sources.length >= 1 && x.sources.every((s) => s && s.label && /^https:\/\//.test(s.url)), 'sources');
  need(Array.isArray(x.steps) && x.steps.length >= 4 && x.steps.length <= 14, 'step count');
  need(Array.isArray(x.ingredients) && x.ingredients.length >= 1, 'ingredients');
  let total = 0;
  x.steps.forEach((s, i) => {
    need(!!C.stations[s.station], `step ${i} station ${s.station}`);
    need(!!C.actions[s.action], `step ${i} action ${s.action}`);
    need(Number.isFinite(s.seconds) && s.seconds >= 2 && s.seconds <= 30, `step ${i} seconds`);
    need(typeof s.kid === 'string' && s.kid.length >= 2 && s.kid.length <= 24, `step ${i} kid line "${s.kid}"`);
    need(typeof s.note === 'string' && s.note.length >= 2, `step ${i} note`);
    if (s.action === 'fire') need(['low', 'mid', 'high'].includes(s.heat), `step ${i} heat`);
    if (C.actions[s.action]?.mode === 'taps') need(Number.isInteger(s.count) && s.count >= 2 && s.count <= 6, `step ${i} taps count`);
    total += s.seconds;
  });
  need(total >= 30 && total <= 180, `total seconds ${total}`);
  const last = x.steps[x.steps.length - 1];
  need(last && last.station === 'soban' && last.action === 'serve', 'served on the 소반 last');
  need(x.steps.some((s) => HEAT.has(s.action) || ['mix', 'roll'].includes(s.action)), 'something is cooked or prepared');
  for (const g of x.ingredients) {
    if (g.fish) { need(!!C.fishClasses[g.fish] && Number.isInteger(g.n) && g.n >= 1 && g.n <= 3, `fish ${g.fish}`); continue; }
    if (g.season) {
      need(Array.isArray(g.season) && g.season.length >= 1 && g.base === true, 'season needs a list and the kitchen base');
      for (const it of g.season) { need(!!d.items[it], `season item ${it} exists`); need(obtain.has(it), `season item ${it} obtainable`); }
      continue;
    }
    need(!!d.items[g.item], `item ${g.item} exists`);
    if (!g.base && !g.opt) need(obtain.has(g.item), `item ${g.item} obtainable`);
    need(Number.isInteger(g.n) && g.n >= 1 && g.n <= 3, `item ${g.item} amount`);
  }
  if (x.kind === 'fish') {
    need(x.safety === C.safety, 'fish dish carries the safety sentence');
    need(x.ingredients.some((g) => g.fish), 'fish dish uses a fish');
    need(x.steps.some((s) => s.action === 'rinse'), 'the board and hands are rinsed after the fish');
    // the fish is cooked through: some cooking action that heats the fish comes after the first 손질 step
    const firstTrim = x.steps.findIndex((s) => s.action === 'trim' || s.action === 'wash');
    const cooked = x.steps.slice(firstTrim + 1).some((s) => COOKS_FISH.has(s.action));
    need(cooked, 'the fish is boiled / grilled / steamed / fried after it is cleaned');
    need(!x.steps.some((s) => /회로|날로 먹/.test(s.note + s.kid)), 'no step serves it raw');
  } else need(!x.ingredients.some((g) => g.fish), 'only fish dishes use fish');
  if (x.outdoor) need(x.kind === 'fish', 'only fish dishes are cooked at the river 화덕');
}
check('every dish complete, sourced and cookable', bad.length === 0, bad.slice(0, 12));
check('at least 3 dishes for the river 화덕', dishes.filter((x) => x.outdoor).length >= 3);

// ---------------------------------------------------------------- stations used
const used = new Set(dishes.flatMap((x) => x.steps.map((s) => s.station)));
for (const st of ['muldumeong', 'doma', 'gamasot', 'hwaro', 'sotttukkeong', 'siru', 'maetdol', 'yangnyeom', 'soban']) check(`station ${st} is used by a dish`, used.has(st));
const actUsed = new Set(dishes.flatMap((x) => x.steps.map((s) => s.action)));
for (const a of ['wash', 'fire', 'stir', 'steam', 'turn', 'season', 'grill', 'grind']) check(`action ${a} is used`, actUsed.has(a));

// ---------------------------------------------------------------- items
for (const id of C.pantry) {
  const it = d.items[id];
  check(`pantry item ${id} is a zero-value ingredient`, it && it.type === 'ingredient' && !it.price && !it.sell, it);
}
check('a pantry gives at most 3 a day', C.limits.pantryPerDay >= 1 && C.limits.pantryPerDay <= 3);

// ---------------------------------------------------------------- fish: classes resolve, protected never
for (const cls of Object.keys(C.fishClasses)) {
  const list = C.fishFor(cls);
  check(`fish class ${cls} resolves to species${hasFish ? ' (G.data.fish)' : ' (stand-in)'}`, list.length >= 1, list);
  check(`fish class ${cls}: items are FISH_<ID>`, list.every((f) => /^FISH_[A-Z0-9_]+$/.test(f.itemId)), list);
}
const fake = [
  { id: 'SANCHEONEO', name: '산천어', family: '연어과', protected: null },
  { id: 'YEOLMOGEO', name: '열목어', family: '연어과', protected: { kind: '천연기념물', note: '' } },
  { id: 'MEGI', name: '메기', family: '메기과', protected: null },
  { id: 'GAJAE', name: '가재', family: '가재과', protected: null, observe: true },
  { id: 'PIRAMI', name: '피라미', family: '잉어과', protected: null },
  { id: 'KKOKCHI', name: '꼬치동자개', family: '동자개과', protected: { kind: '멸종위기 야생생물 I급', note: '' } },
];
check('fishFor never returns a protected species', ['trout', 'bottom', 'small'].every((c) => C.fishFor(c, fake).every((f) => !['YEOLMOGEO', 'KKOKCHI', 'GAJAE'].includes(f.id))));
check('fishFor maps by family', C.fishFor('trout', fake).map((f) => f.id).join() === 'SANCHEONEO' && C.fishFor('bottom', fake).map((f) => f.id).join() === 'MEGI' && C.fishFor('small', fake).map((f) => f.id).join() === 'PIRAMI', { t: C.fishFor('trout', fake), b: C.fishFor('bottom', fake), s: C.fishFor('small', fake) });
check('fishFor honours an explicit cook class', C.fishFor('small', [{ id: 'X1', family: '기타', cook: 'small' }]).length === 1);
if (hasFish) {
  const prot = d.fish.species.filter((s) => s.protected).map((s) => s.id);
  const all = Object.keys(C.fishClasses).flatMap((c) => C.fishFor(c).map((f) => f.id));
  check('no protected species of G.data.fish resolves', all.every((id) => !prot.includes(id)), all.filter((id) => prot.includes(id)));
  check('every resolved species has its item in G.data.items', Object.keys(C.fishClasses).flatMap((c) => C.fishFor(c)).every((f) => !d.items || !Object.keys(d.items).some((k) => /^FISH_/.test(k)) || d.items[f.itemId]), 'FISH_ items missing');
}

// ---------------------------------------------------------------- content
const k = C.content;
for (const [id, e] of Object.entries(k.education)) {
  check(`card ${id} in G.data.education`, d.education?.[id] === e);
  check(`card ${id} has pages, kid slides and sources`, e.pages.length >= 2 && e.kid && e.kid.slides.length >= 2 && e.sources.length >= 1);
}
for (const [id, q] of Object.entries(k.quizzes)) {
  check(`quiz ${id} merged and answerable`, d.quizzes?.[id] === q && q.choices[q.answer] !== undefined && !!k.education[q.edu] && q.reward && q.reward.exp > 0);
}
check('deck DECK_COOK in lectureDecks', Array.isArray(d.lectureDecks) && d.lectureDecks.some((x) => x.id === 'DECK_COOK'));
check('deck has 10+ slides with title, picture and lines', k.deck.slides.length >= 10 && k.deck.slides.every((s) => s.title && s.emoji && Array.isArray(s.lines) && s.lines.length >= 1));
for (const [id, q] of Object.entries(k.quests)) check(`quest ${id} merged with a reward`, d.quests?.[id] === q && q.objectives.every((o) => o.type === 'interact' && o.count >= 1) && q.reward && (q.reward.coin || q.reward.exp));
for (const [id, a] of Object.entries(k.achievements)) check(`achievement ${id} merged`, d.achievements?.[id] === a && a.condition && typeof a.condition.stat === 'string');
check('mergeContent is idempotent', (() => { const n = d.lectureDecks.length; C.mergeContent(); return d.lectureDecks.length === n; })());

// ---------------------------------------------------------------- text rules
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const FORBID = new RegExp(String.fromCharCode(0xac8c, 0xc784));
const texts = [];
(function walk(v, p) {
  if (typeof v === 'string') texts.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, p + '[' + i + ']'));
  else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) if (typeof x !== 'function') walk(x, p + '.' + kk);
})({ dishes: C.dishes, stations: C.stations, actions: C.actions, vessels: C.vessels, fishClasses: C.fishClasses, content: C.content, items: C.pantry.map((id) => d.items[id]) }, 'cooking');
const han = texts.filter(([, s]) => HAN.test(s));
check('no Chinese characters in any text', han.length === 0, han.slice(0, 4));
check('no forbidden word', !texts.some(([, s]) => FORBID.test(s)) && !FORBID.test(fs.readFileSync(path.join(DIR, '36-cooking-data.js'), 'utf8')));
check('no health claims', !texts.some(([, s]) => /보양|몸에 좋|건강에 좋|약이 되|면역|다이어트|효능/.test(s)), texts.filter(([, s]) => /보양|몸에 좋|건강에 좋|약이 되|면역|다이어트|효능/.test(s)).slice(0, 3));
check('no prices in kid lines', !dishes.some((x) => /원|🪙|가격/.test(x.kid)));

const failed = results.filter((r) => !r.ok);
if (JSON_OUT) console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed }, null, 1));
else console.log(`\n${results.length - failed.length}/${results.length} passed${hasFish ? ' (with G.data.fish)' : ' (fish stand-in list)'}`);
process.exit(failed.length ? 1 : 0);
