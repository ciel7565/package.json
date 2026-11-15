#!/usr/bin/env node
// =============================================================================
// tests/text-audit.mjs — the two rules of tools/text-audit.mjs, checked through its command line (no browser).
//
//   node tests/text-audit.mjs [--json]
//
// Rule 2 (CONTRACT §17.0, no Hanja): a page fixture with every way a Chinese character can be written must fail, the
// two allowed detector forms must pass, the embedded documents and window.__BUILD__ are not read, and the sources of
// this checkout are clean. Rule 1 (the forbidden word of §14.3) still fails a page that carries it.
// The characters are built from code points here, so this file itself holds none.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools/text-audit.mjs');
const jsonOut = process.argv.includes('--json');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 300) }); if (!jsonOut) console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' ? ` — ${String(detail).slice(0, 240)}` : ''}`); };

const cp = (n) => String.fromCodePoint(n);
const HAN = cp(0x842c);                       // a common character of the BMP block
const HAN2 = cp(0x4e08), EXT_A = cp(0x3400), COMPAT = cp(0xf900), EXT_B = cp(0x20000);
const BS = '\\';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-text-audit-'));
const page = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body>\n${body}\n</body></html>\n`;
function run(name, body) {
  const f = path.join(tmp, name + '.html');
  fs.writeFileSync(f, page(body));
  const r = spawnSync(process.execPath, [TOOL, '--json', '--html', f], { cwd: ROOT, encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
  const mine = (list) => (list || []).filter((v) => String(v.file).startsWith(name + '.html'));
  return { status: r.status, json: j, hanja: j ? mine(j.hanja?.violations) : [], word: j ? mine(j.violations) : [], sourceHanja: j ? (j.hanja?.violations || []).filter((v) => !String(v.file).startsWith(name + '.html')) : [] };
}

try {
  // ---- the checkout itself
  const clean = run('clean', '<p>만장대</p>');
  check('the tool runs and answers JSON with both rules', !!clean.json && typeof clean.json.hanja === 'object' && Array.isArray(clean.json.violations), `exit ${clean.status}`);
  check('the sources of this checkout hold no Hanja and none of the forbidden word (exit 0)', clean.status === 0 && clean.json?.ok === true && clean.sourceHanja.length === 0,
    clean.sourceHanja.slice(0, 4).map((v) => `${v.file}:${v.line}`).join(' · '));
  check('rule 2 reads the source files (src, server, tools, the pack credits) and counts the allowed detector entries', (clean.json?.hanja?.scanned | 0) > 150 && (clean.json?.hanja?.allowed | 0) >= 20, `${clean.json?.hanja?.scanned} files · ${clean.json?.hanja?.allowed} allowed`);

  // ---- every way of writing a character is found
  const forms = [
    ['a written character', `<p>${HAN}${HAN2}</p>`, HAN],
    ['extension A / compatibility / supplementary characters', `<p>${EXT_A}</p>\n<p>${COMPAT}</p>\n<p>${EXT_B}</p>`, EXT_A],
    ['a \\uXXXX escape in a script', `<script>const s = '${BS}u842c';</script>`, HAN],
    ['a \\u{…} escape', `<script>const s = '${BS}u{842c}';</script>`, HAN],
    ['a surrogate pair escape', `<script>const s = '${BS}ud840${BS}udc00';</script>`, EXT_B],
    ['a hexadecimal character reference', '<p>&#x842c;</p>', HAN],
    ['a decimal character reference', '<p>&#33836;</p>', HAN],
    ['a CSS escape in a style sheet', `<style>.a::before { content: '${BS}842c'; }</style>`, HAN],
    ['a code point handed to String.fromCharCode', '<script>const s = String.fromCharCode(0x842c) + String.fromCodePoint(33836);</script>', HAN],
    ['a character inside a comment', `<script>// ${HAN}\n</script>`, HAN],
  ];
  for (const [name, body, ch] of forms) {
    const r = run('f' + forms.findIndex((f) => f[0] === name), body);
    check(`found: ${name}`, r.status === 1 && r.hanja.length >= 1 && r.hanja.some((v) => String(v.chars).includes(ch)), `exit ${r.status} · ${r.hanja.length} line(s)`);
  }
  const three = run('lines', `<p>${EXT_A}</p>\n<p>ok</p>\n<p>${COMPAT}</p>\n<p>${EXT_B}</p>`);
  check('each line is reported with its line number and the characters', three.hanja.length === 3 && three.hanja.every((v) => v.line > 0 && v.chars), three.hanja.map((v) => v.line).join(','));

  // ---- the allowed forms, and only those
  const pairs = run('pairs', `<script>const D = { '${HAN}': '1', "${HAN2}":"2", ${EXT_A}:"3" };</script>`);
  check('allowed in the page: a digit table of the personal-data mask (quoted or bare key → a quoted digit)', pairs.status === 0 && pairs.hanja.length === 0, JSON.stringify(pairs.hanja).slice(0, 200));
  const range = run('range', `<script>const rx = /[${EXT_A}-${cp(0x4dbf)}${cp(0x4e00)}-${cp(0x9fff)}]/;</script>`);
  check('allowed in the page: the two ends of a character-class range (a detector)', range.status === 0 && range.hanja.length === 0, JSON.stringify(range.hanja).slice(0, 200));
  const sneaky = run('sneaky', `<script>const D = { '${HAN}': '만' };</script>\n<p>${HAN} - ${HAN2}</p>\n<p>'${HAN}': '10'</p>`);
  check('not allowed: a character mapped to text, two characters around a spaced dash, a pair with two digits', sneaky.status === 1 && sneaky.hanja.length === 3, `${sneaky.hanja.length} line(s)`);

  // ---- what is not read
  const docs = run('docs', `<script id="build-docs" type="application/json">${JSON.stringify({ 'CONTRACT.md': `the old stone said ${HAN}` })}</script>\n<script>window.__BUILD__ = { vectors: ["${HAN}${HAN2}"] };</script>\n<p>만장대</p>`);
  check('the embedded documents and window.__BUILD__ are not read by rule 2', docs.status === 0 && docs.hanja.length === 0, JSON.stringify(docs.hanja).slice(0, 200));

  // ---- rule 1 still works next to rule 2
  const word = run('word', `<p>${cp(0xac8c)}${cp(0xc784)}</p>`);
  check('rule 1 still fails a page with the forbidden word (and rule 2 stays quiet about Hangul)', word.status === 1 && word.word.length === 1 && word.hanja.length === 0, `exit ${word.status}`);
} catch (e) {
  console.error('could not run:', e?.stack || e);
  process.exit(2);
} finally {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  fs.rmdirSync(tmp);
}

const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
else console.log(`\n${failed.length ? '✖' : '✔'} text-audit: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
