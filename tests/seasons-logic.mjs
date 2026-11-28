// tests/seasons-logic.mjs — the pure rules of 12-seasons.js (CONTRACT §19.5) in Node: the phenology of 정선 by date,
// the snow that gathers and melts by the weather of the last weeks, the forced seasons, the GLSL table.
//   node tests/seasons-logic.mjs        exit 0 = all green, 1 = a check failed
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => { const m = { exports: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module: m }); return m.exports; };
const S = load('src/game/12-seasons.js');
const E = load('src/game/77-env.js');

let fails = 0, n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const KST = 9 * 3600000;
const at = (y, mo, d, h = 12) => Date.UTC(y, mo - 1, d, h) - KST;   // a KST wall-clock time
const doyOf = (ms) => E.kst(ms).doy;
const real = (ms) => S.state(ms, { doy: doyOf(ms), hour: E.kst(ms).hour, wx: (t) => E.modelAt(t), norm: E.NORM });
const f = (v) => v.toFixed(2);

// ---- the calendar of 정선 (no weather: the curves alone)
const P = (mo, d) => S.phen(doyOf(at(2026, mo, d)));
{
  const a1 = P(4, 1), a15 = P(4, 15), m25 = P(5, 25), j15 = P(7, 15), o10 = P(10, 10), o26 = P(10, 26), n25 = P(11, 25), j20 = P(1, 20);
  check('4/1: the broadleaf trees are still bare', a1.leaf < 0.08, `leaf ${f(a1.leaf)}`);
  check('4/15: blossom weeks (산벚 · 진달래)', a15.blossom > 0.8, `blossom ${f(a15.blossom)}`);
  check('5/25: in leaf, the light new green', m25.leaf > 0.95 && m25.fresh > 0.3, `leaf ${f(m25.leaf)} fresh ${f(m25.fresh)}`);
  check('7/15: deep green — nothing changes the summer look', j15.leaf === 1 && j15.fresh === 0 && j15.autumn === 0 && j15.blossom === 0 && j15.grass === 1);
  check('10/10: first colour', o10.autumn > 0.05 && o10.autumn < 0.6, `autumn ${f(o10.autumn)}`);
  check('10/26: colour at its peak, most leaves still on', o26.autumn > 0.9 && o26.leaf > 0.6, `autumn ${f(o26.autumn)} leaf ${f(o26.leaf)}`);
  check('11/25: bare trees, straw grass', n25.leaf < 0.03 && n25.grass < 0.05, `leaf ${f(n25.leaf)} grass ${f(n25.grass)}`);
  check('1/20: bare, straw, no blossom', j20.leaf === 0 && j20.grass === 0 && j20.blossom === 0);
  let mono = true, prev = -1;
  for (let d = 280; d <= 330; d++) { const v = S.phen(d).leaf; if (v > prev + 1e-9 && prev >= 0) mono = false; prev = v; }
  check('autumn: leaves only fall (monotone 10/7 → 11/26)', mono);
  let finite = true;
  for (let d = 1; d <= 366; d++) { const p = S.phen(d); for (const k in p) if (!Number.isFinite(p[k]) || p[k] < 0 || p[k] > 1) finite = false; }
  check('every curve is finite and in 0…1 on every day', finite);
}

// ---- warm and cold years shift the dates (temperature of the last days)
{
  const warm = S.phen(110, 6, 0).leaf, norm = S.phen(110).leaf, cold = S.phen(110, -6, 0).leaf;
  check('a warm spring leafs earlier, a cold one later', warm > norm && norm > cold, `${f(cold)} < ${f(norm)} < ${f(warm)}`);
  const wa = S.phen(292, 0, 6).autumn, na = S.phen(292).autumn;
  check('a warm autumn colours later', wa < na, `${f(wa)} < ${f(na)}`);
}

// ---- snow from the weather of the last weeks (synthetic weather)
{
  const T0 = at(2026, 1, 20);
  const snowy = (t) => (t > T0 - 4 * 86400000 && t < T0 - 2 * 86400000 ? { weather: 'SNOW', temp: -4, rain1h: 1 } : { weather: 'CLOUDY', temp: -6, rain1h: 0 });
  const s1 = S.state(T0, { doy: 20, wx: snowy, norm: E.NORM });
  check('two days of snow at −4 °C lie as a full cover', s1.snow > 0.9, `snow ${f(s1.snow)}`);
  const thaw = (t) => (t < T0 - 8 * 86400000 && t > T0 - 10 * 86400000 ? { weather: 'SNOW', temp: -3, rain1h: 1 } : { weather: 'CLEAR', temp: 9, rain1h: 0 });
  const s2 = S.state(T0, { doy: 20, wx: thaw, norm: E.NORM });
  check('a week at +9 °C melts it away', s2.snow < 0.05, `snow ${f(s2.snow)}`);
  const cold = () => ({ weather: 'CLEAR', temp: -9, rain1h: 0 });
  const s3 = S.state(T0, { doy: 20, wx: cold, norm: E.NORM, hour: 7 });
  check('a cold spell freezes the river edge, breath shows, rime at dawn', s3.ice > 0.6 && s3.breath === 1 && s3.frost > 0.4, `ice ${f(s3.ice)} breath ${f(s3.breath)} frost ${f(s3.frost)}`);
  const summer = () => ({ weather: 'CLEAR', temp: 28, rain1h: 0 });
  const s4 = S.state(at(2026, 7, 15), { doy: 196, wx: summer, norm: E.NORM });
  check('summer: no ice, no breath, no snow', s4.ice === 0 && s4.breath === 0 && s4.snow === 0);
}

// ---- the climate model of 정선 (77-env.js): snow lies in winter, never in summer
{
  let winterDays = 0, winterSnow = 0, summerSnow = 0;
  for (let d = 0; d < 62; d++) { const st = real(at(2026, 12, 15) + d * 86400000); winterDays++; if (st.snow > 0.3) winterSnow++; }
  for (let d = 0; d < 90; d++) { const st = real(at(2026, 6, 10) + d * 86400000); if (st.snow > 0.01) summerSnow++; }
  check('model: snow lies on part of the days of 12/15 – 2/15', winterSnow >= 8 && winterSnow < winterDays, `${winterSnow} / ${winterDays} days`);
  check('model: never snow in June – September', summerSnow === 0, `${summerSnow} days`);
  const today = real(at(2026, 11, 28, 15));
  check('today 11/28: bare trees, straw grass (autumn)', today.leaf < 0.05 && today.grass < 0.1 && today.id === 'autumn', `leaf ${f(today.leaf)} grass ${f(today.grass)} snow ${f(today.snow)} T ${today.temp}`);
  let fin = true;
  for (let d = 0; d < 366; d += 3) { const st = real(at(2026, 1, 1) + d * 86400000); for (const k of ['leaf', 'snow', 'grass', 'autumn', 'ice', 'frost', 'breath', 'branch', 'blossom', 'fresh', 'brown']) if (!Number.isFinite(st[k]) || st[k] < 0 || st[k] > 1) fin = false; }
  check('a whole year of real states: every level finite and in 0…1', fin);
}

// ---- the forced seasons (?season=) and the fixed test season
{
  const ids = ['spring', 'summer', 'autumn', 'winter'];
  for (const id of ids) {
    const st = S.state(at(2026, 7, 1), { doy: 182, forced: id, norm: E.NORM });
    check(`?season=${id} → ${id}`, st.id === id, `doy ${st.doy} leaf ${f(st.leaf)} autumn ${f(st.autumn)} snow ${f(st.snow)}`);
  }
  const w = S.state(0, { forced: 'winter', norm: E.NORM }), a = S.state(0, { forced: 'autumn' }), sp = S.state(0, { forced: 'spring' }), su = S.state(0, { forced: 'summer' });
  check('winter: bare, snow lying in patches, ice at the edge', w.leaf === 0 && w.snow > 0.6 && w.snow < 0.9 && w.ice > 0.5, `snow ${f(w.snow)}`);
  check('autumn: full colour', a.autumn > 0.9 && a.leaf > 0.5);
  check('spring: blossom and the first leaves', sp.blossom > 0.2 && sp.leaf > 0.1 && sp.leaf < 0.9, `blossom ${f(sp.blossom)} leaf ${f(sp.leaf)}`);
  check('summer (the fixed test season): the identity look', su.leaf === 1 && su.autumn === 0 && su.fresh === 0 && su.snow === 0 && su.blossom === 0 && su.grass === 1);
  check('?snow= overrides the cover', S.state(0, { forced: 'summer', snow: 0.6 }).snow === 0.6);
}

// ---- flowers by month and the season ids
{
  check('twelve months of flowers', S.FLOWERS.length === 12 && S.FLOWERS.every((m, i) => m.m === i + 1 && m.colors.length === m.names.length));
  check('September: 메밀꽃 and 코스모스', S.FLOWERS[8].names.includes('메밀꽃') && S.FLOWERS[8].names.includes('코스모스'));
  check('no flowers in January', S.FLOWERS[0].amount === 0);
  check('season ids by day', S.seasonOf(20).id === 'winter' && S.seasonOf(100).id === 'spring' && S.seasonOf(200).id === 'summer' && S.seasonOf(300).id === 'autumn' && S.seasonOf(350).id === 'winter');
  check('phase stays in 0…1', [1, 59, 60, 151, 243, 334, 335, 366].every((d) => { const p = S.seasonOf(d).phase; return p >= 0 && p <= 1; }));
}

console.log(`\n${n - fails} / ${n} checks passed`);
process.exit(fails ? 1 : 0);
