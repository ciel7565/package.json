#!/usr/bin/env node
// =============================================================================
// tests/content-data.mjs — the content of CONTRACT §17.8, checked in Node (no browser):
//   · G.data from the pure data fragments (01-data.js, 02-layout.js, 45-education-data.js — the same three files
//     tools/build.mjs evaluates for the server's game-data.json), in a vm
//   · ≥ 30 recipes you can start, every one complete and consistent (ingredients and result items exist, durations > 0,
//     temperature / humidity ranges sane, a jar kind, real steps, what the microbes do, care ids that exist, sources),
//     장 가르기 pairs, 덧장 items, the 12 jar slots of 41-fermentation.js inside the terrace and off the aisle
//   · ≥ 60 new learning contents and ≥ 80 new quizzes in the existing formats, each quiz with exactly one right answer
//     (distinct choices, the answer inside them), the kid versions well-formed; ≥ 6 lecture decks of 10–16 slides
//   · no Hanja, never the word §14.3 forbids, no health-claim phrase in anything this lane wrote; ids unique
//   · the server side: game-data.json built from this tree (tools/build.mjs --data-out into a scratch copy) and a
//     sample save with 12 jars and the new recipes judged by the PHP SaveValidator (php on PATH; skipped without it)
// Usage: node tests/content-data.mjs [--json] [--no-php]      exit 0 = all pass, 1 = a check failed
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const NO_PHP = args.includes('--no-php');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  if (!JSON_OUT) console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, detail) { results.push({ name, ok: true, skip: true, detail }); if (!JSON_OUT) console.log(`– ${name} — ${detail}`); }

// ------------------------------------------------------------------ load the data
const G = { data: {} };
const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
for (const f of ['01-data.js', '02-layout.js', '45-education-data.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');
  try { vm.runInContext(`(function(){'use strict';\n${code}\n})()`, ctx, { timeout: 4000, filename: f }); check(`data fragment ${f} evaluates`, true); }
  catch (e) { check(`data fragment ${f} evaluates`, false, e.message); }
}
const D = G.data;
const R = D.recipes || {}, I = D.items || {}, E = D.education || {}, Q = D.quizzes || {};
const KINDS = new Set(['dok', 'jungduri', 'hangari', 'danji']);
const CARE = new Set(['sun', 'vent', 'clean', 'salt', 'charcoal', 'geumjul', 'taste', 'nametag', 'split', 'deot', 'share']);
const FLAVOR = new Set(['salty', 'sweet', 'sour', 'umami', 'spicy', 'nutty']);

// ------------------------------------------------------------------ recipes
const startable = Object.values(R).filter((r) => r.startable !== false);
check('≥ 30 recipes can be started', startable.length >= 30, `${startable.length} (+ ${Object.keys(R).length - startable.length} made by 장 가르기)`);
const recipeProblems = [];
for (const [id, r] of Object.entries(R)) {
  const bad = (m) => recipeProblems.push(`${id}: ${m}`);
  if (r.id !== id) bad('id field');
  if (typeof r.name !== 'string' || !r.name.trim()) bad('name');
  if (!I[r.resultItem]) bad(`result item ${r.resultItem}`);
  else if (!['fermented', 'ingredient'].includes(I[r.resultItem].type)) bad('result item type');
  const ing = Object.entries(r.ingredients || {});
  if (r.startable !== false && !ing.length) bad('no ingredients');
  for (const [iid, n] of ing) { if (!I[iid]) bad(`ingredient ${iid}`); if (!(Number.isInteger(n) && n > 0 && n <= 9)) bad(`quantity ${iid}`); }
  if (!(r.baseDuration > 0 && r.baseDuration <= 3600)) bad('baseDuration');
  const rg = (a, lo, hi) => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] < a[1] && a[0] >= lo && a[1] <= hi;
  if (!rg(r.idealTemp, -10, 70)) bad('idealTemp');
  if (!rg(r.idealHumidity, 0, 100)) bad('idealHumidity');
  if (!(r.baseQuality >= 40 && r.baseQuality <= 80)) bad('baseQuality');
  if (!(r.resultQty >= 1 && r.resultQty <= 2)) bad('resultQty (claims stay ≤ 3 with the bonuses)');
  if (!(r.exp > 0 && r.coin > 0)) bad('rewards');
  if (!KINDS.has(r.jar)) bad(`jar kind ${r.jar}`);
  if (!D.recipeCats?.[r.cat]) bad(`cat ${r.cat}`);
  if (!Array.isArray(r.steps) || r.steps.length < 3 || r.steps.some((s) => !Array.isArray(s) || s.length !== 3 || s.some((x) => typeof x !== 'string' || !x.trim()))) bad('steps');
  if (typeof r.microbes !== 'string' || r.microbes.length < 20) bad('microbes');
  if (typeof r.real !== 'string' || !r.real) bad('real duration');
  if (typeof r.kid !== 'string' || !r.kid) bad('kid line');
  if (!Array.isArray(r.src) || !r.src.length) bad('sources');
  for (const c of r.care || []) if (!CARE.has(c)) bad(`care ${c}`);
  for (const k of Object.keys(r.flavor || {})) if (!FLAVOR.has(k)) bad(`flavour ${k}`);
  if (!Object.keys(r.flavor || {}).length) bad('flavour');
  if (r.deot && !I[r.deot]) bad(`deot item ${r.deot}`);
  if ((r.care || []).includes('deot') && !r.deot) bad('deot care without item');
  if (r.split) { const t = R[r.split.into]; if (!t || t.splitOf !== id || t.startable !== false) bad('split target'); if (!(r.split.at > 10 && r.split.at < 60)) bad('split at'); if (!(r.care || []).includes('split')) bad('split care'); }
  if (r.heat && !(r.heat.temp >= r.idealTemp[0] && r.heat.temp <= r.idealTemp[1] && typeof r.heat.label === 'string')) bad('heat inside the ideal range');
  if (r.edu && !E[r.edu]) bad(`edu ${r.edu}`);
  if (!/^#[0-9a-f]{6}$/i.test(r.color || '')) bad('colour');
}
check('every recipe complete and consistent', !recipeProblems.length, recipeProblems.slice(0, 6).join(' · ') || `${Object.keys(R).length} recipes`);
const cats = new Set(startable.map((r) => r.cat));
check('recipes cover 장 · 김치 · 젓갈 · 식초 · 식혜·조청 · 떡·누룩 · 장아찌 · 발효차', ['jang', 'kimchi', 'jeot', 'vinegar', 'sweet', 'tteok', 'jangajji', 'tea'].every((c) => cats.has(c)), [...cats].join(','));
const named = ['메주', '간장', '된장', '고추장', '청국장', '막장', '김치', '백김치', '깍두기', '동치미', '총각김치', '오이소박이', '갓김치', '파김치', '열무김치', '나박김치', '젓', '식해', '감식초', '현미식초', '누룩', '증편', '식혜', '조청', '장아찌', '차'];
const allText = Object.values(R).map((r) => `${r.name} ${(I[r.resultItem] || {}).name}`).join(' ');
check('the foods named in §17.8 are all there', named.every((n) => allText.includes(n)), named.filter((n) => !allText.includes(n)).join(',') || 'all');
const usedItems = new Set(Object.values(R).flatMap((r) => Object.keys(r.ingredients || {})));
const crops = Object.values(D.crops || {}).map((c) => c.harvestItem);
check('recipes use the app\'s crops (콩 고추 배추 들깨 옥수수 무)', ['ITEM_BEAN', 'ITEM_PEPPER', 'ITEM_CABBAGE', 'ITEM_PERILLA', 'ITEM_CORN', 'ITEM_RADISH'].every((x) => usedItems.has(x) && crops.includes(x)));
const shop = new Set(D.shops?.SHOP_GENERAL?.sells || []);
const crafted = new Set(Object.values(D.crafts || {}).flatMap((c) => Object.keys(c.out || {})));
const resultIds = new Set(Object.values(R).map((r) => r.resultItem));
const unreachable = [...usedItems].filter((x) => !shop.has(x) && !crops.includes(x) && !crafted.has(x) && !resultIds.has(x));
check('every ingredient can be bought, grown, made or fermented', !unreachable.length, unreachable.join(',') || `${usedItems.size} ingredients`);
const storeIds = new Set(D.storage?.itemIds || []);
check('every finished food can go into the 곳간', [...resultIds].filter((x) => I[x].type === 'fermented').every((x) => storeIds.has(x)));

// ------------------------------------------------------------------ 12 jar slots
const F = D.fermentation || {};
check('12 jar slots with a kind each', Array.isArray(F.jarSlots) && F.jarSlots.length === 12 && F.jarSlots.every((k) => KINDS.has(k)) && F.maxJarsAll === 12, (F.jarSlots || []).join(','));
const src41 = fs.readFileSync(path.join(ROOT, 'src/game/41-fermentation.js'), 'utf8');
const mz = /const SLOT_Z = \[([^\]]+)\]/.exec(src41);
const slotZ = mz ? mz[1].split(',').map(Number) : [];
const P0 = D.layout?.jangdokdae?.platforms?.[0];
const aisle = D.layout?.jangdokdae?.rows?.aisleZ || [1.9, 6.1];
const j1 = (D.layout?.jars || []).find((j) => j.id === 'J1');
let gap = Infinity;
for (let i = 0; i < slotZ.length; i++) for (let k = i + 1; k < slotZ.length; k++) gap = Math.min(gap, Math.abs(slotZ[i] - slotZ[k]));
const inside = !!P0 && !!j1 && slotZ.every((z) => Math.abs(z - P0.z) <= P0.hd - 0.6) && Math.abs(j1.x - P0.x) <= P0.hw - 0.6;
const offAisle = slotZ.every((z) => z + 0.62 <= aisle[0] + 0.45 || z - 0.62 >= aisle[1]);
const keeps = j1 && (D.layout.jars || []).every((j) => slotZ[Number(j.id.slice(1)) - 1] === j.z);
check('the 12 jar places: on the terrace, 2.3 m+ apart, the aisle to the ring field stays free, J1–J3 where they were', slotZ.length === 12 && inside && offAisle && gap >= 2.29 && keeps, `gap ${gap.toFixed(2)} · inside ${inside} · aisle ${offAisle} · J1–J3 ${keeps}`);

// ------------------------------------------------------------------ education
const added = D.educationAdded || {};
const newEdu = Object.values(E).filter((e) => e.referenceDate === '2026-11');
const newQ = Object.values(Q).filter((q) => q.reward && q.reward.exp === 60 && q.reward.edu === 8);
check('≥ 60 new learning contents', newEdu.length >= 60 && added.contents >= 60, `${newEdu.length}`);
check('≥ 80 new quizzes', newQ.length >= 80 && added.quizzes >= 80, `${newQ.length}`);
const topics = new Set(newEdu.map((e) => e.cat));
check('new contents spread over the topics of §17.8', ['foods', 'science', 'jang', 'season', 'onggi', 'gimjang', 'region', 'tools', 'hanok', 'folk', 'jeongseon'].every((c) => topics.has(c)), [...topics].join(','));
const eduProblems = [];
for (const [id, e] of Object.entries(E)) {
  const bad = (m) => eduProblems.push(`${id}: ${m}`);
  if (e.id !== id) bad('id');
  if (!D.educationCategories?.[e.cat]) bad(`cat ${e.cat}`);
  if (!Array.isArray(e.pages) || !e.pages.length) { bad('pages'); continue; }
  e.pages.forEach((p, i) => { if (!p.title || !p.text || p.index !== i || !p.visual || !['model', 'emoji', 'svg', 'steps'].includes(p.visual.type)) bad(`page ${i}`); });
  for (const qid of e.quizzes || []) if (!Q[qid] || Q[qid].edu !== id) bad(`quiz ${qid}`);
  for (const rid of e.related || []) if (!E[rid]) bad(`related ${rid}`);
  if (newEdu.includes(e)) {
    if (!Array.isArray(e.sources) || !e.sources.length || e.sources.some((s) => !s.label || !/^https:\/\//.test(s.url || ''))) bad('sources');
    if (e.adult) { if (e.kid || (e.quizzes || []).length) bad('a grown-up card has no kid version and no quiz'); }
    else {
      const K = e.kid;
      if (!K || !K.title || !K.summary || !Array.isArray(K.slides) || K.slides.length < 2) bad('kid version');
      else K.slides.forEach((s, i) => { if (!s.text || (typeof s.vis === 'number' ? s.vis >= e.pages.length : !(Array.isArray(s.steps) || typeof s.emoji === 'string'))) bad(`kid slide ${i}`); });
      if (!(e.quizzes || []).length) bad('no quiz');
    }
  }
}
check('every learning content well-formed (pages, kid slides, quizzes, related, sources)', !eduProblems.length, eduProblems.slice(0, 6).join(' · ') || `${Object.keys(E).length} contents`);
const qProblems = [];
for (const [id, q] of Object.entries(Q)) {
  const bad = (m) => qProblems.push(`${id}: ${m}`);
  if (q.id !== id || !E[q.edu]) bad('id / edu');
  if (!Array.isArray(q.choices) || q.choices.length < 2 || new Set(q.choices.map((c) => String(c).trim())).size !== q.choices.length) bad('choices must be distinct');
  if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < (q.choices || []).length)) bad('answer');
  if (!q.question || !q.explain) bad('question / explain');
  if (q.kid) {
    const k = q.kid;
    if (k.ox) { if (typeof k.answer !== 'boolean' || !k.q) bad('kid ox'); }
    else if (!Array.isArray(k.choices) || k.choices.length < 2 || k.choices.length > 3 || new Set(k.choices.map((c) => c.t)).size !== k.choices.length || !(Number.isInteger(k.answer) && k.answer >= 0 && k.answer < k.choices.length) || k.choices.some((c) => !c.e || !c.t)) bad('kid choices');
    if (!k.hint || !k.why) bad('kid hint / why');
  }
}
check('every quiz has exactly one right answer (distinct choices, answer among them; kid versions too)', !qProblems.length, qProblems.slice(0, 6).join(' · ') || `${Object.keys(Q).length} quizzes`);
const kidQ = newQ.filter((q) => q.kid).length;
check('most new quizzes have a 쉬운 모드 version', kidQ >= newQ.length * 0.75, `${kidQ} / ${newQ.length}`);

// ------------------------------------------------------------------ lecture decks
const decks = D.lectureDecks || [];
const deckProblems = [];
const deckIds = new Set();
for (const d of decks) {
  const bad = (m) => deckProblems.push(`${d.id}: ${m}`);
  if (!d.id || deckIds.has(d.id)) bad('id'); deckIds.add(d.id);
  if (!d.title || !d.emoji || !['all', 'member', 'paid', 'allot'].includes(d.audience)) bad('head');
  if (!Array.isArray(d.slides) || d.slides.length < 10 || d.slides.length > 16) bad(`slides ${d.slides?.length}`);
  (d.slides || []).forEach((s, i) => { if (!s.title || !Array.isArray(s.lines) || !s.lines.length || s.lines.some((l) => typeof l !== 'string' || !l || l.length > 90) || (s.picture != null && typeof s.picture !== 'string')) bad(`slide ${i}`); });
  if (d.edu && !E[d.edu]) bad(`edu ${d.edu}`);
}
check('≥ 6 lecture decks of 10–16 slides, well-formed', decks.length >= 6 && !deckProblems.length, deckProblems.slice(0, 4).join(' · ') || decks.map((d) => `${d.id}:${d.slides.length}`).join(' '));

// ------------------------------------------------------------------ words: no Hanja, never the forbidden word, no health claims
const strings = [];
const walk = (v, where) => {
  if (typeof v === 'string') strings.push([where, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'svg') walk(x, `${where}.${k}`);
};
const newItems = Object.entries(I).filter(([id]) => /^ITEM_(STRAW|BARLEY|MALT|WHEAT|NURUK|MEPSSAL|BROWN_RICE|PERSIMMON|GARLIC|GINGER|SCALLION|CUCUMBER|GAT|YEOLMU|CHONGGAKMU|PEAR|SHRIMP|ANCHOVY|FLATFISH|MILLET|TEALEAF|CHARCOAL|HANJI|CHEONGGUKJANG|MAKJANG|BAEKKIMCHI|KKAKDUGI|DONGCHIMI|CHONGGAK|OISOBAGI|GATKIMCHI|PAKIMCHI|YEOLMUKIMCHI|NABAKKIMCHI|SAEUJEOT|MYEOLCHIJEOT|SIKHAE|GAMSIKCHO|HYEONMISIKCHO|JEUNGPYEON|SIKHYE|JOCHEONG|CORNYEOT|MUJANGAJJI|KKAENNIPJANGAJJI|MANEULJANGAJJI|GOCHUJANGAJJI|TTEOKCHA)$/.test(id));
walk(R, 'recipes'); walk(Object.fromEntries(newItems), 'items'); walk(newEdu, 'education'); walk(newQ, 'quizzes'); walk(decks, 'decks'); walk(D.recipeCats, 'recipeCats');
const HANJA = /[㐀-鿿豈-﫿]/;
const hanja = strings.filter(([, s]) => HANJA.test(s));
check('no Hanja in the new content', !hanja.length, hanja.slice(0, 3).map(([w, s]) => `${w}: ${s.slice(0, 30)}`).join(' · ') || `${strings.length} strings`);
const FORBIDDEN = String.fromCharCode(0xac8c, 0xc784);
const fb = strings.filter(([, s]) => s.includes(FORBIDDEN));
check('never the word §14.3 forbids', !fb.length, fb.slice(0, 3).map(([w]) => w).join(', '));
const CLAIMS = ['몸에 좋', '건강에 좋', '건강해', '건강을', '면역', '항암', '다이어트', '치료', '병을', '낫게', '낫는', '예방', '혈압', '혈당', '피부에 좋', '소화를 돕', '소화가 잘', '장 건강', '독소', '해독', '약효', '효능', '노화', '살이 빠', '보약'];
const claims = strings.filter(([, s]) => CLAIMS.some((c) => s.includes(c)));
check('no health claims in the new content', !claims.length, claims.slice(0, 4).map(([w, s]) => `${w}: “${CLAIMS.find((c) => s.includes(c))}”`).join(' · '));
const drink = strings.filter(([, s]) => /막걸리|술을? 마셔|건배|한잔/.test(s)).map(([w]) => w);
const drinkOk = drink.every((w) => /EDU_ADULT|education\[\d+\]/.test(w) ? true : !/마셔|건배|한잔/.test(w));
check('alcohol only as knowledge (no drinking shown as fun)', drinkOk && !strings.some(([, s]) => /건배|한잔 해|마셔 봐/.test(s)), `${drink.length} mentions`);
const adult = Object.values(E).filter((e) => e.adult);
check('exactly one grown-up knowledge card (hidden in 쉬운 모드)', adult.length === 1 && /어른만|어린이는/.test(JSON.stringify(adult[0])));

// ------------------------------------------------------------------ ids unique across the tables this lane adds to
const ids = [...Object.keys(R), ...Object.keys(E), ...Object.keys(Q), ...decks.map((d) => d.id), ...Object.keys(D.crafts || {})];
check('ids unique across recipes, contents, quizzes, decks, crafts', new Set(ids).size === ids.length, `${ids.length}`);

// ------------------------------------------------------------------ the server: game-data.json + the PHP SaveValidator
const php = NO_PHP ? null : spawnSync('php', ['-v'], { encoding: 'utf8' });
if (!php || php.status !== 0) skip('PHP SaveValidator accepts a save with 12 jars and the new recipes', NO_PHP ? '--no-php' : 'php not on PATH');
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-content-'));
  const srv = path.join(tmp, 'srv');
  fs.cpSync(path.join(ROOT, 'server'), srv, { recursive: true, filter: (s) => !/\.sqlite(-wal|-shm)?$|config\.local\.php$|install\.lock$/.test(s) });
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--no-assets', '--quiet', '--no-precompress', '--out', path.join(tmp, 'page.html'), '--data-out', path.join(srv, 'data', 'game-data.json')], { encoding: 'utf8', cwd: ROOT });
  const gd = fs.existsSync(path.join(srv, 'data', 'game-data.json')) ? JSON.parse(fs.readFileSync(path.join(srv, 'data', 'game-data.json'), 'utf8')) : null;
  check('game-data.json built with every recipe and new item', !!gd && Object.keys(R).every((id) => gd.recipes?.[id]?.baseDuration > 0) && newItems.every(([id]) => gd.items?.[id]), b.status ? (b.stderr || b.stdout).slice(0, 200) : `${Object.keys(gd?.recipes || {}).length} recipes`);
  const script = path.join(tmp, 'judge.php');
  fs.writeFileSync(script, `<?php
putenv('TFM_DATA_DIR=${tmp.replace(/\\/g, '/')}/data');
require '${srv.replace(/\\/g, '/')}/lib/bootstrap.php';
function cl($o) { return json_decode((string) json_encode($o), false); }
$u = ['id' => 7, 'nickname' => 'tester', 'email' => 't@example.com', 'role' => 'user'];
$t0 = Tfm\\Clock::ms() - 3600000;
$CREATED = $t0 - 7200000;
function jar($t, $owned, $rec = null, $status = 'EMPTY', $prog = 0, $via = null, $started = 0) {
  $j = ['owned' => $owned, 'recipeId' => $rec, 'status' => $status, 'progress' => $prog, 'quality' => 60, 'hygiene' => 95, 'startedAt' => $started, 'lastUpdate' => $t];
  if ($via) $j['via'] = $via;
  return $j;
}
function save($u, $t, $jars, $inv, $coin) {
  return json_decode((string) json_encode([
    'version' => 1, 'createdAt' => $GLOBALS['CREATED'], 'savedAt' => $t,
    'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
    'stats' => ['level' => 1, 'exp' => 0, 'coin' => $coin, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
    'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
    'inventory' => $inv, 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => $jars,
    'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
    'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
    'flags' => new stdClass(), 'activity' => [], 'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []], 'storage' => ['items' => new stdClass(), 'cap' => 300],
  ]), false);
}
function codes($r) { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $r['violations']))); }
$out = [];
$inv0 = ['ITEM_MEJU' => 4, 'ITEM_SALT' => 4, 'ITEM_BEAN' => 6, 'ITEM_STRAW' => 2, 'ITEM_RADISH' => 3, 'ITEM_PEAR' => 1];
// previous accepted save: the free start (J1 with the gift 된장), nothing else owned
$jp = ['J1' => jar($t0, true, 'FER001', 'FERMENTING', 40, null, $t0 - 120000)];
for ($i = 2; $i <= 12; $i++) $jp['J' . $i] = jar($t0, false);
$p = save($u, $t0, $jp, $inv0, 5000);
// next save, 3 minutes later, after a 토스 plan opened jars 2–12 (via plan) and three new recipes started
$t1 = $t0 + 180000;
$jn = ['J1' => jar($t1, true, 'FER001', 'AGING', 64, null, $t0 - 120000)];
for ($i = 2; $i <= 12; $i++) $jn['J' . $i] = jar($t1, true, null, 'EMPTY', 0, 'plan');
$jn['J4'] = jar($t1, true, 'FER006', 'FERMENTING', 12, 'plan', $t1 - 60000);
$jn['J7'] = jar($t1, true, 'FER008', 'FERMENTING', 30, 'plan', $t1 - 50000);
$jn['J8'] = jar($t1, true, 'FER012', 'PREPARING', 5, 'plan', $t1 - 20000);
$inv1 = ['ITEM_MEJU' => 2, 'ITEM_SALT' => 1, 'ITEM_BEAN' => 3, 'ITEM_STRAW' => 1, 'ITEM_RADISH' => 0, 'ITEM_PEAR' => 0];
$n = save($u, $t1, $jn, $inv1, 5000);
$ent = ['v' => 1, 'role' => 'user', 'admin' => false, 'tier' => 2, 'paid' => true, 'until' => 0, 'speed' => ['move' => 2, 'grow' => 2], 'limits' => ['jars' => 12, 'roomItems' => 160], 'features' => ['myroom' => true]];
$r = Tfm\\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $u, $t0, $t1, 2, null, $ent);
$out['plan12'] = ['ok' => $r['ok'], 'codes' => codes($r)];
// 5 seconds after the plan started: jars 2–12 opened (via plan), nothing else — fine with the plan; without the
// server's entitlement the marks of J2 / J3 are not believed, so 3,000 coins of jar value appear unexplained
$tg = $t0 + 5000;
$jg = $jp; foreach ($jg as $k => $v) $jg[$k]['lastUpdate'] = $tg;
for ($i = 2; $i <= 12; $i++) $jg['J' . $i] = jar($tg, true, null, 'EMPTY', 0, 'plan');
$g = save($u, $tg, $jg, $inv0, 5000);
$rg = Tfm\\SaveValidator::validate(cl($g), cl($p), ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $u, $t0, $tg, 2, null, $ent);
$r2 = Tfm\\SaveValidator::validate(cl($g), cl($p), ['v' => 1, 'tier' => 1], $u, $t0, $tg, 1, null);
$out['grant'] = ['ok' => $rg['ok'], 'codes' => codes($rg)];
$out['noEnt'] = ['ok' => $r2['ok'], 'codes' => codes($r2)];
// a recipe the server does not know is caught (proves the data is loaded)
$bad = cl($n); $bad->jars->J9 = (object) jar($t1, true, 'FER999', 'FERMENTING', 3, 'plan', $t1 - 10000);
$r3 = Tfm\\SaveValidator::validate($bad, cl($p), ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $u, $t0, $t1, 2, null, $ent);
$out['unknown'] = codes($r3);
// 20 seconds later a brand-new 장 담그기 (480 s) claims 60 %: too fast even at tier 2
$tf = $t0 + 20000;
$jf = $jn; foreach ($jf as $k => $v) $jf[$k]['lastUpdate'] = $tf;
$jf['J4'] = jar($tf, true, 'FER006', 'AGING', 60, 'plan', $tf - 15000);
$fast = save($u, $tf, $jf, $inv1, 5000);
$r4 = Tfm\\SaveValidator::validate($fast, cl($p), ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $u, $t0, $tf, 2, null, $ent);
$out['fast'] = codes($r4);
// a coin-bought J2 cannot be re-labelled 'plan' (its 1,500-coin value would vanish from the net worth): free or paid
$tm = $t0 + 5000;
$jp2 = $jp; $jp2['J2'] = jar($t0, true);
$pf = save($u, $t0, $jp2, $inv0, 5000);
$jn2 = $jp2; foreach ($jn2 as $k => $v) $jn2[$k]['lastUpdate'] = $tm;
$jn2['J2'] = jar($tm, true, null, 'EMPTY', 0, 'plan');
$nf = save($u, $tm, $jn2, $inv0, 6500);
$free = ['v' => 1, 'role' => 'user', 'admin' => false, 'tier' => 1, 'paid' => false, 'until' => 0, 'speed' => ['move' => 1, 'grow' => 1], 'limits' => ['jars' => 3, 'roomItems' => 80], 'features' => ['myroom' => false]];
$r5 = Tfm\\SaveValidator::validate(cl($nf), cl($pf), ['v' => 1, 'tier' => 1, 'move' => 1, 'jars' => 3], $u, $t0, $tm, 1, null, $free);
$r6 = Tfm\\SaveValidator::validate(cl($nf), cl($pf), ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $u, $t0, $tm, 2, null, $ent);
$out['markTrick'] = codes($r5);
$out['markTrickPaid'] = codes($r6);
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`);
  const pr = spawnSync('php', [script], { encoding: 'utf8', env: { ...process.env, TFM_DATA_DIR: path.join(tmp, 'data') } });
  let o = null;
  try { o = JSON.parse(pr.stdout.slice(pr.stdout.indexOf('{'))); } catch (e) { o = null; }
  if (!o) check('PHP SaveValidator runs', false, (pr.stderr || pr.stdout).slice(0, 300));
  else {
    check('PHP: a save with 12 jars (plan) and new recipes (장 담그기, 청국장, 동치미) is accepted', o.plan12.ok && o.grant.ok, JSON.stringify([o.plan12.codes, o.grant.codes]));
    check('PHP: without the server\'s entitlement the plan mark of J2 / J3 is not believed (their value stays in the net worth)', !o.noEnt.ok && o.noEnt.codes.includes('UNEXPLAINED_VALUE'), JSON.stringify(o.noEnt.codes));
    check('PHP: an unknown recipe is refused (the data is loaded)', o.unknown.includes('UNKNOWN_RECIPE'), JSON.stringify(o.unknown));
    check('PHP: a new recipe that ripens too fast is refused', o.fast.includes('FERMENT_TOO_FAST'), JSON.stringify(o.fast));
    check('PHP: a coin-bought jar cannot be re-labelled as a plan jar (free or paid account)', o.markTrick.includes('JAR_PLAN_MARK') && o.markTrickPaid.includes('JAR_PLAN_MARK'), JSON.stringify([o.markTrick, o.markTrickPaid]));
  }
}

const failed = results.filter((r) => !r.ok);
if (JSON_OUT) console.log(JSON.stringify({ passed: results.filter((r) => r.ok && !r.skip).length, failed: failed.length, skipped: results.filter((r) => r.skip).length, results }, null, 1));
else console.log(`\n${results.length - failed.length} / ${results.length} passed${failed.length ? ` — ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
