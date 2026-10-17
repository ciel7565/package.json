#!/usr/bin/env node
// =============================================================================
// tests/pii-client.mjs — the personal-information mask IN THE BUILT GAME (kid safety, CONTRACT §12.4)
//
//   node tests/pii-client.mjs [--file dist/metaverse/index.html] [--no-server] [--json out.json]
//
// Loads the single-file game in headless Chromium and runs G.sys.social.maskPII / nicknameLooksPersonal on every
// vector of tests/pii-vectors.json:
//   whole    → the text becomes exactly 🔒          partial → some 🔒 and no 4-digit run / address word left
//   keep     → unchanged (innocent kid sentences)   leak    → none of the listed secrets survives
//   nickname → reject / allow lists
// Then the same texts go through the REAL server filters (php tests/pii-server.php, with and without the intl
// extension) and every output must be identical to the client's (one rule list: tests/pii-sync.mjs).
// Exit code 1 on any failure.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
/** loaded only when run as a script, so tests/server-e2e.mjs can import the judges without Playwright */
function loadChromium() {
  try { return require('playwright').chromium; } catch { return require('/opt/node22/lib/node_modules/playwright').chromium; }
}
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const file = path.resolve(opt('--file', path.join(ROOT, 'dist/metaverse/index.html')));
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/pii-vectors.json'), 'utf8'));

/** strong normalisation used to look for surviving secrets (independent of the engine under test) */
export function norm(s) {
  let t = String(s).normalize('NFKC').replace(/[\u{E0000}-\u{E007F}\u{FE00}-\u{FE0F}\u{20E3}]/gu, '');
  t = t.replace(/\p{Nd}/gu, (d) => { const cp = d.codePointAt(0); let z = cp; while (cp - z < 9 && /\p{Nd}/u.test(String.fromCodePoint(z - 1))) z--; return String((cp - z) % 10); });
  return t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/[\u3164\u115F\u1160\uFFA0]/gu, '');
}
export function judgeAll(V, outMask, outNick) {
  const fails = [];
  let i = 0;
  for (const t of V.whole) { const o = outMask[i++]; if (o !== '🔒') fails.push(['whole', t, o]); }
  for (const t of V.partial) { const o = outMask[i++]; if (!o.includes('🔒') || /[0-9]{4}|@[a-z]|\.com|\.kr|dino|강남구|역삼동/iu.test(o)) fails.push(['partial', t, o]); }
  for (const t of V.keep) { const o = outMask[i++]; if (o !== t) fails.push(['keep', t, o]); }
  for (const x of V.leak) { const o = outMask[i++]; const n = norm(o); const left = x.secrets.filter((s) => n.includes(norm(s))); if (left.length) fails.push(['leak:' + x.id, x.t, o]); }
  const nr = V.nickname?.reject || [], na = V.nickname?.allow || [];
  nr.forEach((n, k) => { if (outNick[k] !== true) fails.push(['nickname must be rejected', n, outNick[k]]); });
  na.forEach((n, k) => { if (outNick[nr.length + k] !== false) fails.push(['nickname must be allowed', n, outNick[nr.length + k]]); });
  return fails;
}
export const allTexts = (V) => [...V.whole, ...V.partial, ...V.keep, ...V.leak.map((x) => x.t)];
export const allNicks = (V) => [...(V.nickname?.reject || []), ...(V.nickname?.allow || [])];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(file)) { console.error(`✖ ${file} not found — build first (node tools/build.mjs)`); process.exit(2); }
  const texts = allTexts(V), nicks = allNicks(V);
  const browser = await loadChromium().launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let client;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => (/^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto(pathToFileURL(file).href + '?quality=low', { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => typeof window.G?.sys?.social?.maskPII === 'function' && typeof G.sys.social.nicknameLooksPersonal === 'function', null, { timeout: 300000, polling: 250 });
    client = await page.evaluate(({ texts, nicks }) => {
      const S = G.sys.social;
      const t0 = performance.now();
      const mask = texts.map((t) => S.maskPII(t));
      const ms = performance.now() - t0;
      return { mask, nick: nicks.map((n) => S.nicknameLooksPersonal(n)), ms, rules: S._piiRules ? S._piiRules().map((r) => r.name) : [] };
    }, { texts, nicks });
  } finally { await browser.close(); }
  const fails = judgeAll(V, client.mask, client.nick);
  let ok = !fails.length;
  console.log(`${ok ? '✔' : '✖'} client: ${texts.length} texts + ${nicks.length} nicknames in ${client.ms.toFixed(0)} ms — ${fails.length} failure(s)`);
  for (const f of fails.slice(0, 30)) console.log('   ', JSON.stringify(f));
  const report = { client: { fails, ms: client.ms }, server: {} };
  if (!args.includes('--no-server')) {
    for (const [label, phpArgs] of [['php+intl', []], ['php-no-intl', ['-n', '-d', 'extension=mbstring', '-d', 'extension=pdo', '-d', 'extension=pdo_sqlite']]]) {
      const r = spawnSync('php', [...phpArgs, path.join(ROOT, 'tests/pii-server.php')], { input: JSON.stringify({ texts, nicks }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) { console.log(`✖ ${label}: php exit ${r.status} ${String(r.stderr).slice(0, 300)}`); ok = false; continue; }
      const s = JSON.parse(r.stdout);
      const diffs = [];
      texts.forEach((t, k) => { if (s.mask[k] !== client.mask[k]) diffs.push([t, client.mask[k], s.mask[k]]); });
      const nickDiff = nicks.filter((n, k) => (s.nick[k] !== null) !== client.nick[k]);
      const rulesSame = JSON.stringify(s.rules) === JSON.stringify(client.rules);
      const good = !diffs.length && !nickDiff.length && rulesSame;
      ok = ok && good;
      report.server[label] = { intl: s.intl, diffs, nickDiff, rulesSame };
      console.log(`${good ? '✔' : '✖'} ${label} (intl=${s.intl}): ${diffs.length} output difference(s), ${nickDiff.length} nickname difference(s), rule list ${rulesSame ? 'identical' : 'DIFFERENT'}`);
      for (const d of diffs.slice(0, 20)) console.log('    client vs server', JSON.stringify(d));
      for (const n of nickDiff) console.log('    nickname', n);
    }
  }
  const out = opt('--json');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
  process.exit(ok ? 0 : 1);
}
