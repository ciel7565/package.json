#!/usr/bin/env node
// =============================================================================
// tests/wardrobe-logic.mjs — clothes as items without a browser (CONTRACT §19.1, lane wardrobe)
//
//   node tests/wardrobe-logic.mjs [--json out.json]
//
// The real data fragments (01-data.js, 02-avatar-data.js, every later pure-data fragment the build exports, and
// 24-wardrobe.js) run in Node exactly as tools/build.mjs evaluates them. Checked: every value of every slot key is an
// item WEAR_<KEY>_<ID> of type `wear` (made from the table, none listed by hand); the starter kit is free and plain;
// prices follow the rule; own / wear / buy / sell rules; the migration of a look of today (and of an older look with
// modern ids) keeps every piece it wears; the state is sanitised (unknown ids, oversized lists, markup in names); the
// gifts point at existing quests / achievements; the server table matches the items.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/game');
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`); } else { fail++; console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function load() {
  const names = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  // the same pure-data set as tools/build.mjs exportGameData (+ 24-wardrobe.js, whose data half is pure too)
  const files = names.filter((f) => /^0[12]-/.test(f) || /education-data|^34-fish-data|myroom-data|cooking-data|^24-wardrobe/.test(f)).sort();
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
  for (const f of files) vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(DIR, f), 'utf8')}\n})()`, ctx, { filename: f, timeout: 4000 });
  G.data.wardrobe.applyGifts(G.data);
  return G;
}

let G;
try { G = load(); } catch (e) { console.error('✖ data could not be loaded:', e.stack || e.message); process.exit(2); }
const D = G.data, W = D.wardrobe, AV = D.avatar;

console.log('wardrobe-logic — items from the avatar table');
check('G.data.wardrobe exists with slots', !!W && Array.isArray(W.slots) && W.slots.length >= 6, `${W?.slots?.length} slots: ${W?.slots?.map((s) => s.key).join(' ')}`);
let expected = 0, missing = [];
for (const s of W.slots) {
  for (const id of AV.options[s.key]) {
    if (id === s.empty) continue;
    expected++;
    const iid = W.itemId(s.key, id);
    const it = D.items[iid];
    if (!it || it.type !== 'wear' || it.slot !== s.key || it.wear !== id) missing.push(iid);
  }
}
check('every value of every slot key is an item of type wear', !missing.length && W.items.length === expected, `${W.items.length} items (${expected} expected)${missing.length ? ` · missing ${missing.slice(0, 5).join(', ')}` : ''}`);
check('item ids are WEAR_<KEY>_<ID> and parse back', W.items.every((iid) => /^WEAR_[A-Z0-9_]+$/.test(iid) && W.parse(iid) && W.itemId(W.parse(iid).key, W.parse(iid).id) === iid) && iid48(W.items), 'all ids ≤ 48 chars');
function iid48(list) { return list.every((x) => x.length <= 48); }
check('no empty value is an item', W.slots.every((s) => !s.empty || !D.items[W.itemId(s.key, s.empty)]));
check('the outer slot is read when the table has it', AV.options.outer ? W.slots.some((s) => s.key === 'outer') : !W.slots.some((s) => s.key === 'outer'), AV.options.outer ? 'outer present' : 'no outer key yet (fallback)');

console.log('wardrobe-logic — starter kit and prices');
const st = W.starter;
check('a plain starter kit exists for every slot that cannot be empty', W.slots.filter((s) => !s.empty).every((s) => st.some((iid) => W.parse(iid).key === s.key)), st.join(' '));
check('the defaults of a new profile are in the starter kit', W.slots.every((s) => { const d = AV.defaults[s.key]; return d === s.empty || d === undefined || st.includes(W.itemId(s.key, d)); }));
check('starter pieces cost nothing and cannot be sold', st.every((iid) => W.priceOf(iid) === 0 && W.sellOf(iid) === 0 && D.items[iid].price === 0));
const bought = W.items.filter((x) => !W.isStarter(x));
check('every other piece has a price > 0 and sells for half', bought.length > 0 && bought.every((iid) => W.priceOf(iid) > 0 && W.sellOf(iid) === Math.floor(W.priceOf(iid) / 2) && D.items[iid].sell === W.sellOf(iid)));
const cheapest = Math.min(...bought.map((x) => W.priceOf(x)));
check('a first piece is within reach early (cheapest ≤ the first quest coins)', cheapest <= (D.quests?.QUEST001?.reward?.coin || 3000), `cheapest ${cheapest}`);
check('rarer pieces cost more (rule)', Object.entries(W.rarity).every(([iid, t]) => W.isStarter(iid) || W.priceOf(iid) >= (W.price.base[W.parse(iid).key] || 400) * W.price.mul[t] - 10));
check('SHOP_HANBOK sells every non-starter piece, shelves by slot', D.shops.SHOP_HANBOK && D.shops.SHOP_HANBOK.sells.length === bought.length && D.shops.SHOP_HANBOK.kind === 'wear' && D.shops.SHOP_HANBOK.shelves.length === W.slots.length);

console.log('wardrobe-logic — own / wear / buy / sell');
const app = Object.assign({}, AV.defaults);
const pick = (key) => W.byKey[key].find((x) => !W.isStarter(x));
const hatI = pick('hat'), topI = pick('top');
let w = W.blank();
check('a starter piece is owned by everybody', W.owns(w, st[0], false));
check('a shop piece is not owned until bought', !W.owns(w, hatI, false) && W.owns(w, hatI, true), 'admin owns all');
check('canBuy: coins short → why coins', W.canBuy(w, hatI, 0, false).why === 'coins');
check('canBuy: enough coins → ok with the price', W.canBuy(w, hatI, 1e6, false).ok && W.canBuy(w, hatI, 1e6, false).price === W.priceOf(hatI));
check('canBuy: an administrator never buys (owns already)', W.canBuy(w, hatI, 1e6, true).why === 'owned');
w.own[hatI] = 1; w.own[topI] = 1;
check('canBuy: owned → why owned', W.canBuy(w, hatI, 1e6, false).why === 'owned');
const worn = Object.assign({}, app, { hat: W.parse(hatI).id });
check('wornItems lists what a look wears (no empty slots)', W.wornItems(worn).includes(hatI) && !W.wornItems(app).some((x) => W.parse(x).id === 'none'));
check('canSell: a worn piece → why worn', W.canSell(w, worn, hatI).why === 'worn');
check('canSell: a starter piece → why starter', W.canSell(w, app, st[0]).why === 'starter');
check('canSell: not owned → why notOwned', W.canSell(W.blank(), app, hatI).why === 'notOwned');
check('canSell: owned, not worn → ok for half', W.canSell(w, app, hatI).ok && W.canSell(w, app, hatI).price === W.sellOf(hatI));
const sneaky = Object.assign({}, app, { hat: W.parse(pick('hat')).id, top: W.parse(W.byKey.top.filter((x) => !W.isStarter(x))[1] || topI).id });
const f1 = W.fit(sneaky, W.blank(), false);
check('fit: pieces not owned go back to owned ones', f1.changed && W.wornItems(f1.app).every((x) => W.owns(W.blank(), x, false)), JSON.stringify({ hat: f1.app.hat, top: f1.app.top }));
check('fit: an administrator wears anything', !W.fit(sneaky, W.blank(), true).changed);
check('fit: an owned look stays as it is', !W.fit(worn, w, false).changed);

console.log('wardrobe-logic — migration');
const today = Object.assign({}, AV.defaults);
for (const s of W.slots) { const iid = pick(s.key); if (iid) today[s.key] = W.parse(iid).id; }
const m1 = W.migrate(undefined, today);
check('an existing profile owns every piece it wears after the migration', W.wornItems(today).every((x) => W.owns(m1, x, false)) && m1.migrated === true, `${Object.keys(m1.own).length} pieces granted`);
const m2 = W.migrate(m1, Object.assign({}, today, { hat: W.parse(W.byKey.hat.filter((x) => !W.isStarter(x)).slice(-1)[0]).id }));
check('the migration happens once (a later look is not granted)', Object.keys(m2.own).length === Object.keys(m1.own).length);
for (const p of AV.presets) {
  const mp = W.migrate(undefined, p.app);
  if (!W.wornItems(p.app).every((x) => W.owns(mp, x, false))) { check(`preset ${p.id} keeps its pieces`, false); }
}
check('every preset look keeps its pieces when migrated', true, `${AV.presets.length} presets`);
// a modern look of an older save: ids the table no longer offers are the avatar's normalize to turn into hanbok; the
// wardrobe neither grants nor blocks them (they are no items)
const modern = Object.assign({}, AV.defaults, { top: 'tshirt', footwear: 'sneakers', bag: 'backpack' });
const mm = W.migrate(undefined, modern);
check('a modern look migrates without error; modern ids are not items', !Object.keys(mm.own).some((x) => /TSHIRT|SNEAKERS|BACKPACK/.test(x)) || (AV.options.top || []).includes('tshirt'), Object.keys(mm.own).join(' ') || '(nothing to grant)');

console.log('wardrobe-logic — sanitising');
const dirty = {
  v: 1, own: { [hatI]: 1, WEAR_HAT_NOPE: 1, __proto__x: 1, ITEM_SALT: 1 },
  sets: Array.from({ length: 20 }, (_, i) => ({ id: i === 3 ? '<b>' : `s${i}`, name: i === 1 ? '<img src=x onerror=1>예쁜 옷' : `옷 ${i}`, app: { hat: W.parse(hatI).id, top: 'zzz', topColor: '#ABCDEF', evil: 1 } })),
  sheet: { traits: ['차분해요', '없는 말', '차분해요', '씩씩해요', '다정해요', '밝아요'], home: 'mars' }, expr: 'angry',
};
const c = W.sanitize(dirty);
check('unknown item ids are dropped', Object.keys(c.own).join() === hatI, Object.keys(c.own).join(' '));
check('at most 12 outfits, plain ids', c.sets.length === 12 && c.sets.every((s) => /^[a-z0-9_]{1,24}$/i.test(s.id)));
check('outfit names lose markup and are bounded', c.sets.every((s) => !/[<>]/.test(s.name) && s.name.length <= 12), c.sets[1].name);
check('outfit looks keep known keys and values only', c.sets.every((s) => s.app.hat === W.parse(hatI).id && !('top' in s.app) && s.app.topColor === '#abcdef' && !('evil' in s.app)));
check('traits: known words, no repeats, at most 3', JSON.stringify(c.sheet.traits) === JSON.stringify(['차분해요', '씩씩해요', '다정해요']));
check('home / expression: known ids only', c.sheet.home === null && c.expr === null);
check('a non-object state becomes the blank one', JSON.stringify(W.sanitize('x')) === JSON.stringify(W.blank()) && JSON.stringify(W.sanitize(null)) === JSON.stringify(W.blank()));
check('nine expressions with names', W.expressions.length >= 9 && W.expressions.every((e) => e.id && e.name), W.expressions.map((e) => e.name).join(' '));

console.log('wardrobe-logic — gifts and the server table');
const gifted = Object.entries(W.gifts);
check('gifts point at existing quests / achievements and real pieces', gifted.length >= 6 && gifted.every(([src, iid]) => (D.quests?.[src] || D.achievements?.[src]) && D.items[iid]?.type === 'wear' && !W.isStarter(iid)), `${gifted.length} gifts`);
check('the gifts are in the rewards', gifted.every(([src, iid]) => ((D.quests?.[src] || D.achievements?.[src]).reward.items || {})[iid] === 1));
check('the first quest gives a piece (a first new piece within about ten minutes)', !!W.gifts.QUEST001, W.gifts.QUEST001 || 'none');
const T = W.serverTable();
check('server table: every item with [key, id, sell]', Object.keys(T.items).length === W.items.length && W.items.every((iid) => T.items[iid][0] === W.parse(iid).key && T.items[iid][2] === W.sellOf(iid)));
check('server table: starter, traits, homes, expressions, limits', T.starter.length === st.length && T.traits.length >= 20 && T.homes.length >= 6 && T.expressions.length >= 9 && T.limits.sets === 12);
check('the table is JSON (no functions leak)', JSON.parse(JSON.stringify(T)).v === 1);

console.log(`\nwardrobe-logic: ${pass} passed, ${fail} failed`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail ? 1 : 0);
