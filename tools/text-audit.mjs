#!/usr/bin/env node
// tools/text-audit.mjs — CONTRACT §14.3: no user-visible "G-word" (the Korean word for "game", U+AC8C U+C784) anywhere.
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
// Exit codes: 0 clean · 1 violations · 2 usage / build error.
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
}

const byFile = new Map();
for (const v of violations) byFile.set(v.file, (byFile.get(v.file) || 0) + 1);
if (JSON_OUT) {
  console.log(JSON.stringify({ ok: violations.length === 0, word: WORD, scanned: files.length, html: htmlPath ? rel(htmlPath) : null, built, violations }, null, 2));
} else {
  if (!QUIET || violations.length) for (const v of violations) console.log(`✖ ${v.file}:${v.line}  ${v.text}`);
  const where = htmlPath ? ` + ${rel(htmlPath)}${built ? ' (built)' : ''}` : '';
  if (violations.length) console.log(`\n✖ ${violations.length} occurrence(s) of the forbidden word in ${byFile.size} file(s) · scanned ${files.length} source files${where}`);
  else if (!QUIET) console.log(`✔ text audit clean — 0 occurrences of the forbidden word · scanned ${files.length} source files${where}`);
}
process.exit(violations.length ? 1 : 0);
