#!/usr/bin/env node
// tools/text-audit.mjs — two text rules:
//   rule 1 (CONTRACT §14.3): no user-visible "G-word" (the Korean word for "game", U+AC8C U+C784) anywhere;
//   rule 2 (CONTRACT §17.0): no Hanja — no Chinese character (U+3400–U+9FFF, U+F900–U+FAFF, the supplementary
//          ideographs) in anything a visitor can see: signs, canvas textures, labels, education texts, admin pages.
//
//   node tools/text-audit.mjs                 # audit the sources, build to .cache/text-audit.html and audit the page too
//   node tools/text-audit.mjs --html <file>   # audit the sources + this already-built page (no build)
//   node tools/text-audit.mjs --no-html       # sources only
//   node tools/text-audit.mjs --json          # machine-readable report
//
// Scope (whole text, not only string literals — stricter than the contract's minimum, comments count too):
//   src/**            (js, css, html — UI strings, voice lines, templates, aria labels, noscript)
//   server/**         (php, md, json, sql, htaccess, txt, html, js, css — admin pages, API messages, README-SERVER)
//   docs/**/*.md, README.md, package.json, tools/** (mjs, sh — operator-facing console text)
//   the built page: the embedded docs (<script id="build-docs">) are decoded and audited per document with the same
//   rules; window.__BUILD__ (manifest + kid-safety PII vectors = data) is skipped; the rest of the page may only carry
//   the PII regex alternation of 60-social.
// Allow-list (CONTRACT §14.3): regex sources in src/game/60-social.js (PR`…` templates), server/lib/pii-rules.json and
//   tests/pii-vectors.json (generated detection data, not UI), docs/CONTRACT.md §13.9–13.10 (history: quoted bug
//   titles), §14.3 (the spec of this purge), `code spans` anywhere in CONTRACT.md and "quoted" words inside §14.
// Identifiers, ids, class names, file names and the English word "game" are not checked (they stay, by contract).
//
// Rule 2 — Hanja. Scope: src/**, server/**, tools/**, assets/pack/*.json (the credits shown in 설정), README.md,
//   package.json and the built page. Comments count (a source file holds none at all). Written-out characters AND
//   escapes are found: \uXXXX (surrogate pairs too), \u{…}, &#x…; / &#…;, CSS \XXXX in style sheets, and a literal
//   code point handed to String.fromCharCode / fromCodePoint.
//   Not checked: docs/** and the documents embedded in the page (a document may name a character when it explains
//   it), window.__BUILD__ (manifest + PII test vectors = data), tests/** (attack vectors on purpose).
//   Allowed forms — detection code that must know the characters, never text a visitor reads:
//     · a digit table of the personal-data mask: one character as the key of a quoted digit ('X': '0' / 'X' => '0')
//       in src/game/60-social.js and server/lib/ChatFilter.php (children writing a phone number in Chinese numerals);
//     · the two ends of a character-class range (X-Y) in src/game/80-devcenter.js (its "is there Hanja?" check).
//     The built page carries the same two snippets, so the same two forms are allowed there — nothing else.
// Exit codes: 0 clean · 1 violations (of either rule) · 2 usage / build error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD = '\uAC8C\uC784'; // the forbidden word, never spelled out in this file
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const flag = (n) => args.includes(n);
const JSON_OUT = flag('--json');
const QUIET = flag('--quiet');
const NO_HTML = flag('--no-html');
const htmlArg = opt('--html');
if (flag('--help') || flag('-h')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', 'release', 'test-output', '.omc', '.claude']);
const SELF = 'tools/text-audit.mjs';
const DATA_FILES = new Set(['server/lib/pii-rules.json', 'tests/pii-vectors.json']); // detection data, allow-listed whole

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), exts, out); continue; }
    const ext = ent.name.startsWith('.') ? ent.name.slice(1) : path.extname(ent.name).slice(1);
    if (!exts || exts.has(ext.toLowerCase())) out.push(path.join(dir, ent.name));
  }
  return out;
}
const rel = (p) => { const r = path.relative(ROOT, p); return r.startsWith('..') ? p : r.split(path.sep).join('/'); };

const files = [
  ...walk(path.join(ROOT, 'src'), null),
  ...walk(path.join(ROOT, 'server'), new Set(['php', 'md', 'json', 'sql', 'htaccess', 'txt', 'html', 'js', 'css', 'ini', 'conf'])),
  ...walk(path.join(ROOT, 'docs'), new Set(['md'])),
  ...walk(path.join(ROOT, 'tools'), new Set(['mjs', 'js', 'sh'])),
  path.join(ROOT, 'README.md'), path.join(ROOT, 'package.json'),
].filter((p) => fs.existsSync(p) && fs.statSync(p).isFile()).map(rel).filter((r) => r !== SELF && !DATA_FILES.has(r));
// rule 2 reads the same files without docs/**, plus the credits of the asset pack and the PII rule data
const hanjaFiles = [
  ...files.filter((r) => !r.startsWith('docs/')),
  ...walk(path.join(ROOT, 'assets', 'pack'), new Set(['json'])).map(rel),
  ...[...DATA_FILES].filter((r) => r.startsWith('server/') && fs.existsSync(path.join(ROOT, r))),
];

// ---------------------------------------------------------------- per-file allow rules
const stripSpans = (line, re) => line.replace(re, (m) => ' '.repeat(m.length));
function contractContext() { return { hist: false, s143: false, s14: false }; }
function contractUpdate(ctx, line) {
  if (/^## /.test(line)) { ctx.s14 = /^## 14\./.test(line); ctx.hist = false; ctx.s143 = false; }
  if (/^### /.test(line)) { ctx.hist = /^### 13\.(9|10)\b/.test(line); ctx.s143 = /^### 14\.3\b/.test(line); }
}
function allowedLine(relPath, line, ctx) {
  if (relPath === 'src/game/60-social.js') return !stripSpans(line, /PR`[^`]*`/g).includes(WORD); // regex sources (PR`…`) only
  if (relPath === 'docs/CONTRACT.md') {
    if (ctx.hist || ctx.s143) return true; // §13.9/13.10 history quotes, §14.3 (this purge's own spec)
    let rest = stripSpans(line, /`[^`]*`/g); // code spans name the literal old strings
    if (ctx.s14) rest = stripSpans(rest, /"[^"]*"/g); // the phase-6 spec quotes the forbidden word
    return !rest.includes(WORD);
  }
  return false;
}
function auditText(relPath, text) {
  const out = [];
  const lines = text.split('\n');
  const ctx = relPath === 'docs/CONTRACT.md' ? contractContext() : null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ctx) contractUpdate(ctx, line);
    if (!line.includes(WORD)) continue;
    if (allowedLine(relPath, line, ctx)) continue;
    out.push({ file: relPath, line: i + 1, text: snippet(line, line.indexOf(WORD)) });
  }
  return out;
}
function snippet(line, idx, span = 60) {
  const s = Math.max(0, idx - span), e = Math.min(line.length, idx + WORD.length + span);
  return (s > 0 ? '…' : '') + line.slice(s, e).trim() + (e < line.length ? '…' : '');
}

// ---------------------------------------------------------------- rule 2: no Hanja (CONTRACT §17.0)
const HAN_RANGES = [[0x3400, 0x9fff], [0xf900, 0xfaff], [0x20000, 0x323af]];
const isHan = (cp) => HAN_RANGES.some(([a, b]) => cp >= a && cp <= b);
const HAN = '[\\u3400-\\u9fff\\uf900-\\ufaff]';   // (a class for the allow forms below; this file is not audited)
const RX_DIGIT_PAIR = new RegExp(`(['"]?)${HAN}\\1\\s*(?::|=>)\\s*(['"])[0-9]\\2`, 'g');   // 'X': '0' · X:"0" · 'X' => '0'
const RX_CLASS_RANGE = new RegExp(`${HAN}-${HAN}`, 'g');                                    // [X-Y] of a detector
const HANJA_ALLOW = {
  'src/game/60-social.js': [RX_DIGIT_PAIR],
  'server/lib/ChatFilter.php': [RX_DIGIT_PAIR],
  'src/game/80-devcenter.js': [RX_CLASS_RANGE],
};
const HTML_ALLOW = [RX_DIGIT_PAIR, RX_CLASS_RANGE];
const RX_ESC = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|&#[xX]([0-9a-fA-F]{2,6});|&#([0-9]{2,7});|from(?:CharCode|CodePoint)\(\s*(0[xX][0-9a-fA-F]+|[0-9]+)/g;
const RX_CSS_ESC = /\\([0-9a-fA-F]{4,6})(?![0-9a-fA-F])/g;
/** the Hanja of one line: [{ idx, len, ch, how }] (how: 'char' | 'escape') */
function hanjaIn(line, css) {
  const hits = [];
  for (let i = 0; i < line.length;) {
    const cp = line.codePointAt(i), n = cp > 0xffff ? 2 : 1;
    if (isHan(cp)) hits.push({ idx: i, len: n, ch: String.fromCodePoint(cp), how: 'char' });
    i += n;
  }
  if (line.includes('\\') || line.includes('&#') || line.includes('from')) {
    let m, hi = null;
    RX_ESC.lastIndex = 0;
    while ((m = RX_ESC.exec(line))) {
      let cp = m[1] ? parseInt(m[1], 16) : m[2] ? parseInt(m[2], 16) : m[3] ? parseInt(m[3], 16) : m[4] ? parseInt(m[4], 10) : Number(m[5]);
      let idx = m.index, len = m[0].length;
      if (m[2] && cp >= 0xd800 && cp <= 0xdbff) { hi = { cp, idx, end: idx + len }; continue; }
      if (m[2] && cp >= 0xdc00 && cp <= 0xdfff && hi && hi.end === idx) { cp = 0x10000 + ((hi.cp - 0xd800) << 10) + (cp - 0xdc00); idx = hi.idx; len += hi.end - hi.idx; }
      hi = null;
      if (isHan(cp)) hits.push({ idx, len, ch: String.fromCodePoint(cp), how: 'escape' });
    }
    if (css) {
      RX_CSS_ESC.lastIndex = 0;
      while ((m = RX_CSS_ESC.exec(line))) { const cp = parseInt(m[1], 16); if (isHan(cp)) hits.push({ idx: m.index, len: m[0].length, ch: String.fromCodePoint(cp), how: 'escape' }); }
    }
  }
  return hits;
}
const hanjaStats = { allowed: 0 };
/** audit a text for Hanja; allow = the regexes of the allowed forms for this text (their matches are blanked first) */
function auditHanja(relPath, text, allow, css = /\.css$/i.test(relPath)) {
  const out = [];
  const lines = text.split('\n');
  let inStyle = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const styleHere = css || inStyle || /<style[\s>]/i.test(line);
    if (/<style[\s>]/i.test(line)) inStyle = true;
    if (/<\/style>/i.test(line)) inStyle = false;
    if (line.length < 3 && !/[^\x00-\x7f]/.test(line)) continue;
    if (allow && allow.length && /[^\x00-\x7f]/.test(line)) {
      for (const rx of allow) line = line.replace(rx, (m) => { hanjaStats.allowed++; return ' '.repeat(m.length); });
    }
    const hits = hanjaIn(line, styleHere);
    if (!hits.length) continue;
    const first = hits[0];
    const s = Math.max(0, first.idx - 50), e = Math.min(line.length, first.idx + first.len + 50);
    out.push({
      file: relPath, line: i + 1, chars: [...new Set(hits.map((h) => h.ch))].join(''), escaped: hits.some((h) => h.how === 'escape'),
      text: (s > 0 ? '…' : '') + lines[i].slice(s, e).trim() + (e < line.length ? '…' : ''),
    });
  }
  return out;
}
/** the built page: the embedded documents and window.__BUILD__ are cut out (see the header), the rest is audited */
function auditHtmlHanja(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const label = path.basename(htmlPath);
  const m = /<script[^>]*\bid="build-docs"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (m) html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
  const cut = cutBuildObject(html);
  if (cut != null) html = cut;
  return auditHanja(label, html, HTML_ALLOW, false);
}
/** the page without the window.__BUILD__ = {…} object (string-aware bracket matching); null when it has none */
function cutBuildObject(html) {
  const bm = /window\.__BUILD__\s*=\s*\{/.exec(html);
  if (!bm) return null;
  const start = bm.index + bm[0].length - 1;
  let depth = 0, q = null, end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; break; }
  }
  return end > 0 ? html.slice(0, start) + html.slice(end + 1) : null;
}

// ---------------------------------------------------------------- built page
function auditHtml(htmlPath) {
  const out = [];
  let html = fs.readFileSync(htmlPath, 'utf8');
  const label = path.basename(htmlPath);
  // 1. embedded docs (JSON, non-executed): audit each document like its source file
  const m = /<script[^>]*\bid="build-docs"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (m) {
    let docs = null;
    try { docs = JSON.parse(m[1]); } catch (e) { out.push({ file: `${label} › #build-docs`, line: 0, text: `JSON parse failed: ${e.message}` }); }
    for (const [name, text] of Object.entries(docs || {})) {
      const srcRel = name === 'README-SERVER.md' ? 'server/README-SERVER.md' : name === 'README.md' ? 'README.md' : `docs/${name}`;
      for (const v of auditText(srcRel, String(text))) out.push({ ...v, file: `${label} › #build-docs › ${name}` });
    }
    html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
  }
  // 2. window.__BUILD__ = {...} — manifest + kid-safety PII vectors (data, allow-listed). Found by bracket matching
  //    (string-aware), so a minified inline script (unquoted keys, no spaces) is isolated just as well as JSON.
  const bm = /window\.__BUILD__\s*=\s*\{/.exec(html);
  if (bm) {
    const start = bm.index + bm[0].length - 1;
    let depth = 0, q = null, end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i; break; }
    }
    if (end > 0) html = html.slice(0, start) + html.slice(end + 1);
    else out.push({ file: label, line: 0, text: 'window.__BUILD__ object could not be isolated' });
  }
  // 3. the rest of the page: only the 60-social PII regex alternation may carry the word
  const regexAlt = new RegExp('\\|' + WORD + '\\|'); // …|앱|G|동영상|… (alternation inside the regex source)
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let idx = line.indexOf(WORD);
    while (idx >= 0) {
      const win = line.slice(Math.max(0, idx - 40), idx + WORD.length + 40);
      if (!regexAlt.test(win)) out.push({ file: label, line: i + 1, text: snippet(line, idx) });
      idx = line.indexOf(WORD, idx + WORD.length);
    }
  }
  return out;
}

// ---------------------------------------------------------------- run
const violations = [];
for (const r of files) violations.push(...auditText(r, fs.readFileSync(path.join(ROOT, r), 'utf8')));
const hanja = [];
for (const r of hanjaFiles) hanja.push(...auditHanja(r, fs.readFileSync(path.join(ROOT, r), 'utf8'), HANJA_ALLOW[r] || null));

let htmlPath = htmlArg ? path.resolve(htmlArg) : null, built = false;
if (!NO_HTML && !htmlPath) {
  const cacheDir = path.join(ROOT, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  htmlPath = path.join(cacheDir, 'text-audit.html');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--out', htmlPath, '--no-font', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error((r.stderr || r.stdout || '').trim()); console.error('✖ build failed — cannot audit the page (use --no-html for sources only)'); process.exit(2); }
  built = true;
}
if (htmlPath) {
  if (!fs.existsSync(htmlPath)) { console.error(`✖ no such file: ${htmlPath}`); process.exit(2); }
  violations.push(...auditHtml(htmlPath));
  hanja.push(...auditHtmlHanja(htmlPath));
}

const byFile = new Map();
for (const v of violations) byFile.set(v.file, (byFile.get(v.file) || 0) + 1);
const hanjaByFile = new Map();
for (const v of hanja) hanjaByFile.set(v.file, (hanjaByFile.get(v.file) || 0) + 1);
if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: violations.length === 0 && hanja.length === 0, word: WORD, scanned: files.length, html: htmlPath ? rel(htmlPath) : null, built, violations,
    hanja: { ok: hanja.length === 0, scanned: hanjaFiles.length, allowed: hanjaStats.allowed, violations: hanja },
  }, null, 2));
} else {
  if (!QUIET || violations.length) for (const v of violations) console.log(`✖ ${v.file}:${v.line}  ${v.text}`);
  const where = htmlPath ? ` + ${rel(htmlPath)}${built ? ' (built)' : ''}` : '';
  if (violations.length) console.log(`\n✖ ${violations.length} occurrence(s) of the forbidden word in ${byFile.size} file(s) · scanned ${files.length} source files${where}`);
  else if (!QUIET) console.log(`✔ text audit clean — 0 occurrences of the forbidden word · scanned ${files.length} source files${where}`);
  if (!QUIET || hanja.length) for (const v of hanja) console.log(`✖ 한자 ${v.file}:${v.line}  [${v.chars}${v.escaped ? ' · escape' : ''}]  ${v.text}`);
  if (hanja.length) console.log(`\n✖ ${hanja.length} line(s) with Hanja in ${hanjaByFile.size} file(s) · scanned ${hanjaFiles.length} source files${where} — write Hangul instead (CONTRACT §17.0)`);
  else if (!QUIET) console.log(`✔ no Hanja — 0 Chinese characters · scanned ${hanjaFiles.length} source files${where} · ${hanjaStats.allowed} allowed detector entries (digit tables, ranges)`);
}
process.exit(violations.length || hanja.length ? 1 : 0);
