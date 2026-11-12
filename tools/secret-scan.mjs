#!/usr/bin/env node
/**
 * tools/secret-scan.mjs — CONTRACT §15.7 #20: no secret in the repository or its history.
 *
 *   node tools/secret-scan.mjs [--history] [--json out.json] [--all] [--root <git working copy>] [--allow <file>]
 *     (default)   the working tree: every file `git ls-files` lists
 *     --history   also every line ever added in `git log -p --all` (each finding with commit, file:line and a verdict)
 *     --all       also print the allowed findings
 *   exit 0: nothing unreviewed in the tree · exit 1: an unreviewed finding in the tree · exit 2: usage / git error
 *   (history findings never change the exit code: what is in old commits cannot be removed without rewriting a shared
 *   branch — they are listed with a verdict for the report.)
 *
 * Looks for: AWS, Google, GitHub, Slack, Stripe, OpenAI keys; 토스페이먼츠 keys (live_/test_ × sk/ck/gsk/gck);
 * Anthropic keys (sk-ant-…); private-key blocks; JWTs; password / secret / token / key assignments with a literal
 * value; high-entropy literals of 32+ characters. Every value is printed masked (first 6 characters + …).
 * The two public sample keys of the 토스 documentation are recognised by their SHA-256 (never stored here) and
 * reported with the verdict "public documentation sample key".
 *
 * Reviewed findings go into tools/secret-scan.allow.json: [{path, pattern, reason}] — path is a glob (** / *),
 * pattern a regular expression matched against the finding's kind or its full value (so the allow-list itself
 * never needs to contain a secret). Read only; no dependencies (Node 18+).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const optv = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** --root <git working copy>: scan another repository (the tool's self-test); default: this project */
const ROOT = path.resolve(optv('--root') || HERE);
const HISTORY = argv.includes('--history');
const SHOW_ALL = argv.includes('--all');
const JSON_OUT = optv('--json');
const ALLOW_FILE = optv('--allow') ? path.resolve(optv('--allow')) : path.join(ROOT, 'tools', 'secret-scan.allow.json');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** SHA-256 of the 토스페이먼츠 documentation sample keys (client, secret) — the same digests as server/lib/Toss.php */
const DOC_KEYS = new Set(['ec1393ef0fce194e6bad234a8445cb7196048b6470bc36636eeba4148aa50030', '587dc23841794a4259bfbab17611c1a37a71e70a8ca2c82237539dc2e38d8bb3']);
const mask = (v) => (v.length <= 6 ? '*'.repeat(v.length) : v.slice(0, 6) + '…');

// ------------------------------------------------------------------ rules: [kind, regex (global), value group index]
const RULES = [
  ['aws-access-key', /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16})\b/g, 1],
  ['aws-secret-key', /aws.{0,20}?(?:secret|private).{0,20}?['"]([0-9A-Za-z/+=]{40})['"]/gi, 1],
  ['google-api-key', /\b(AIza[0-9A-Za-z\-_]{35})\b/g, 1],
  ['google-oauth-secret', /\b(GOCSPX-[0-9A-Za-z\-_]{28})\b/g, 1],
  ['github-token', /\b((?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,255})\b/g, 1],
  ['github-pat', /\b(github_pat_[0-9A-Za-z_]{60,255})\b/g, 1],
  ['slack-token', /\b(xox[abposr]-[0-9A-Za-z-]{10,})\b/g, 1],
  ['slack-webhook', /(https:\/\/hooks\.slack\.com\/services\/T[0-9A-Za-z]+\/B[0-9A-Za-z]+\/[0-9A-Za-z]+)/g, 1],
  ['stripe-key', /\b((?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,})\b/g, 1],
  ['toss-key', /\b((?:live|test)_g?[cs]k_[0-9A-Za-z]{8,})\b/g, 1],
  ['anthropic-key', /\b(sk-ant-[0-9A-Za-z_\-]{20,})/g, 1],
  ['openai-key', /\b(sk-(?!ant-)(?:proj-)?[0-9A-Za-z_\-]{40,})/g, 1],
  ['private-key-block', /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g, 1],
  ['jwt', /\b(eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,})/g, 1],
  ['secret-assignment', /\b((?:[A-Za-z_]*[_-])?(?:password|passwd|pwd|secret|token|api_?key|apikey|access_?key|private_?key|client_?secret|auth_?key|bearer)[A-Za-z_]*)\b['"]?\s*(?:=>|=|:)\s*(['"`])([^'"`\s]{6,200})\2/gi, 3],
];
/** values of an assignment that are obviously not a secret */
const PLACEHOLDER = /^(?:\$|\{\{|\$\{|<|%|\*+$|x+$|\.\.\.|…|null$|none$|true$|false$|undefined$|changeme$|your[_-]|example|placeholder|dummy|redacted|hidden|secret$|password$|\(hidden\)|process\.env|getenv|env\(|mock_)/i;
/** documentation placeholders are written in Korean (…, 긴-무작위-비밀번호): real keys and generated passwords are ASCII */
const NON_ASCII = /[^\x00-\x7F]/;

function entropy(s) {
  const f = new Map();
  for (const ch of s) f.set(ch, (f.get(ch) || 0) + 1);
  let h = 0;
  for (const c of f.values()) { const p = c / s.length; h -= p * Math.log2(p); }
  return h;
}
/** quoted literals of 32–200 characters with mixed character classes and high entropy */
const HIGH_ENTROPY = /(['"`])([0-9A-Za-z+/=_\-]{32,200})\1/g;
function highEntropy(v) {
  if (new Set(v).size === v.length) return false; // every character once: an alphabet ('ABC…xyz0123…'), not random data
  if (/^[0-9a-f]+$/i.test(v)) return v.length >= 40 && entropy(v) > 3.6; // hex: digests are reported, then reviewed
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(v)).length;
  return classes >= 3 && entropy(v) > 4.3;
}

/** findings in one line of a file */
function scanLine(file, line, lineNo, out, extra = {}) {
  if (line.length > 4000) line = line.slice(0, 4000);
  if (/"integrity"\s*:\s*"sha(?:256|384|512)-/.test(line)) return; // lock-file package hashes
  const seen = new Set();
  const add = (kind, value) => {
    const key = kind + '\0' + value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, file, line: lineNo, value, masked: mask(value), docKey: DOC_KEYS.has(sha256(value)), ...extra });
  };
  for (const [kind, rx, g] of RULES) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(line))) {
      const v = m[g];
      if (kind === 'secret-assignment' && (PLACEHOLDER.test(v) || NON_ASCII.test(v) || /^[A-Za-z_]+\(/.test(v) || /^[A-Z_]{2,}$/.test(v) || /\s/.test(v))) continue;
      add(kind, v);
    }
  }
  HIGH_ENTROPY.lastIndex = 0;
  let m;
  while ((m = HIGH_ENTROPY.exec(line))) {
    const v = m[2];
    if (/^data:|base64,/.test(line.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (highEntropy(v) && !out.some((f) => f.file === file && f.line === lineNo && f.value.includes(v))) add('high-entropy', v);
  }
}

// ------------------------------------------------------------------ allow-list
function globRx(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { s += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') s += '[^/]*';
    else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${s}$`);
}
let allow = [];
try { allow = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')) : []; } catch (e) { console.error(`✖ ${path.relative(ROOT, ALLOW_FILE)} is not valid JSON: ${e.message}`); process.exit(2); }
if (!Array.isArray(allow) || allow.some((a) => !a || typeof a.path !== 'string' || typeof a.pattern !== 'string' || typeof a.reason !== 'string' || !a.reason.trim())) {
  console.error('✖ every allow-list entry needs {path, pattern, reason}');
  process.exit(2);
}
const ALLOW = allow.map((a) => ({ ...a, prx: globRx(a.path), vrx: new RegExp(a.pattern) }));
const used = new Set();
function allowed(f) {
  for (let i = 0; i < ALLOW.length; i++) {
    const a = ALLOW[i];
    if (a.prx.test(f.file) && (a.vrx.test(f.kind) || a.vrx.test(f.value))) { used.add(i); return a.reason; }
  }
  return '';
}
function verdict(f) {
  if (f.docKey) return 'public documentation sample key of 토스페이먼츠 (published in the official docs / sample repository; test mode, no real money) — not a leak';
  if (f.reason) return 'reviewed: ' + f.reason;
  return 'REVIEW: check whether this value is real; if it is, revoke it at the provider and replace it';
}

// ------------------------------------------------------------------ git
function git(args, max = 512 * 1024 * 1024) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: max });
  if (r.status !== 0) { console.error(`✖ git ${args.join(' ')} failed: ${(r.stderr || '').trim().slice(0, 200)}`); process.exit(2); }
  return r.stdout;
}
const tree = [];
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let buf;
  try { buf = fs.readFileSync(abs); } catch { continue; } // deleted in the working copy
  if (buf.includes(0) || buf.length > 8 * 1024 * 1024) continue; // binary / huge
  const lines = buf.toString('utf8').split('\n');
  for (let i = 0; i < lines.length; i++) scanLine(rel, lines[i], i + 1, tree);
}
for (const f of tree) { f.reason = allowed(f); f.allowed = f.reason !== '' || f.docKey; f.verdict = verdict(f); }

const hist = [];
if (HISTORY) {
  const log = git(['log', '-p', '--all', '--no-color', '--no-ext-diff', '-U0', '--format=%x00commit %H %ad', '--date=short']);
  let commit = '';
  let date = '';
  let file = '';
  let ln = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('\0commit ')) { const p = line.slice(8).split(' '); commit = p[0]; date = p[1] || ''; continue; }
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : ''; continue; }
    if (line.startsWith('@@')) { const m = /\+(\d+)/.exec(line); ln = m ? Number(m[1]) : 0; continue; }
    if (line.startsWith('+') && file) { scanLine(file, line.slice(1), ln, hist, { commit: commit.slice(0, 7), date }); ln++; continue; }
  }
  for (const f of hist) { f.reason = allowed(f); f.allowed = f.reason !== '' || f.docKey; f.verdict = verdict(f); }
}

// ------------------------------------------------------------------ report
const show = (f, where) => `${f.allowed ? 'ALLOWED' : 'FINDING'} ${where} ${f.kind} ${f.masked}${f.allowed && !SHOW_ALL ? '' : `\n         ${f.verdict}`}`;
for (const f of tree) if (!f.allowed || SHOW_ALL) console.log(show(f, `${f.file}:${f.line}`));
const unreviewedTree = tree.filter((f) => !f.allowed);
if (HISTORY) {
  // one line per distinct value per file: the commit that added it first, and how many commits carry it
  const groups = new Map();
  for (const f of hist) {
    const k = `${f.file}\0${f.kind}\0${f.value}`;
    const g = groups.get(k);
    if (g) { g.commits.add(f.commit); continue; }
    groups.set(k, { ...f, commits: new Set([f.commit]) });
  }
  console.log(`\n── history (${HISTORY ? 'git log -p --all' : ''}): ${groups.size} distinct value(s) in added lines`);
  for (const g of [...groups.values()].sort((a, b) => Number(a.allowed) - Number(b.allowed))) {
    if (g.allowed && !g.docKey && !SHOW_ALL) continue;
    console.log(`${g.docKey ? 'DOC-KEY' : g.allowed ? 'ALLOWED' : 'HISTORY'} ${g.commit} ${g.date} ${g.file}:${g.line} ${g.kind} ${g.masked} (added in ${g.commits.size} commit${g.commits.size > 1 ? 's' : ''})\n         ${g.verdict}`);
  }
}
const stale = ALLOW.map((a, i) => ({ path: a.path, pattern: a.pattern, i })).filter((a) => !used.has(a.i));
for (const s of stale) console.log(`STALE   allow-list entry ${s.path} /${s.pattern}/ matches nothing any more`);
const strip = (f) => { const { value, prx, vrx, ...rest } = f; return { ...rest, valueSha256: sha256(value) }; };
const summary = {
  files: files.length, treeFindings: tree.length, treeAllowed: tree.length - unreviewedTree.length, treeUnreviewed: unreviewedTree.length,
  historyFindings: hist.length, historyDocKeys: hist.filter((f) => f.docKey).length, historyUnreviewed: hist.filter((f) => !f.allowed).length, staleAllowEntries: stale.length,
};
if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ summary, tree: tree.map(strip), history: hist.map(strip), stale }, null, 1));
console.log(`\n${unreviewedTree.length ? '✖' : '✔'} secret-scan: ${files.length} tracked files · ${tree.length} finding(s) in the tree (${summary.treeAllowed} reviewed, ${unreviewedTree.length} unreviewed)`
  + (HISTORY ? ` · history: ${hist.length} finding(s), ${summary.historyDocKeys} documentation sample key line(s), ${summary.historyUnreviewed} to review` : '')
  + (stale.length ? ` · ${stale.length} stale allow-list entr${stale.length > 1 ? 'ies' : 'y'}` : ''));
process.exit(unreviewedTree.length ? 1 : 0);
