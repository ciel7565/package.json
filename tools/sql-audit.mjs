#!/usr/bin/env node
/**
 * tools/sql-audit.mjs — CONTRACT §15.7 #7: every database query uses bound parameters.
 *
 * Scans server/**\/*.php with a small PHP tokenizer and reports every SQL string that
 *   (a) has a PHP variable interpolated into it ("… WHERE id = $id", heredoc), or
 *   (b) is concatenated (.) with an operand that is not a constant: another string literal, a number, a CONSTANT /
 *       Class::CONSTANT, true/false/null, an (int) / (float) / (bool) cast, intval(), count(), a ternary between
 *       literals, PDO::quote() (the driver escapes it) and Db::forUpdate() are constants here.
 * A string is SQL when it starts with an SQL statement keyword (SELECT, INSERT INTO, UPDATE, DELETE FROM, CREATE, ALTER,
 * GRANT, PRAGMA, SHOW, …) or, when it is appended to a query (.=) or joined to such a string, contains a clause
 * keyword (WHERE, AND, LIMIT, ORDER BY, …). Keywords are matched in upper case, as this code base writes SQL.
 *
 * Reviewed cases (identifiers that went through Db::ident(), integers clamped with max/min, generated account names
 * quoted by the driver …) are listed in tools/sql-audit.allow.json: [{file, snippet, reason}] — a hit is allowed when
 * its file matches and its statement text contains the snippet (white space and quote characters are ignored). Allow-list entries that match
 * nothing any more are reported as stale (warning).
 *
 *   node tools/sql-audit.mjs [--root server] [--json out.json] [--all]
 *     --all    also print the allowed hits
 *   exit 0: no unreviewed hit · exit 1: at least one unreviewed hit (printed as file:line) · exit 2: usage / IO error
 *
 * Read only; no dependencies (Node 18+).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const optv = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const SCAN = path.resolve(ROOT, optv('--root') || 'server');
const JSON_OUT = optv('--json');
const SHOW_ALL = argv.includes('--all');
const ALLOW_FILE = path.join(ROOT, 'tools', 'sql-audit.allow.json');

// ------------------------------------------------------------------ tokenizer (enough PHP for string / operator analysis)
const MULTI_OPS = ['<<=', '>>=', '**=', '===', '!==', '<=>', '...', '::', '->', '=>', '.=', '==', '!=', '<>', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];
function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const adv = (to) => { for (let k = i; k < to && k < n; k++) if (src[k] === '\n') line++; i = to; };
  // inline HTML before the first <?php
  const open = src.indexOf('<?php');
  adv(open < 0 ? n : open + 5);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '?' && src[i + 1] === '>') { const j = src.indexOf('<?php', i + 2); adv(j < 0 ? n : j + 5); continue; }
    if ((c === '/' && src[i + 1] === '/') || c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n' && !(src[j] === '?' && src[j + 1] === '>')) j++;
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); adv(j < 0 ? n : j + 2); continue; }
    if (c === "'") {
      let j = i + 1;
      let v = '';
      while (j < n && src[j] !== "'") { if (src[j] === '\\' && (src[j + 1] === "'" || src[j + 1] === '\\')) { v += src[j + 1]; j += 2; } else v += src[j++]; }
      toks.push({ t: 'str', v, interp: false, line });
      adv(j + 1);
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = '';
      let interp = false;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') { v += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === '$' && /[A-Za-z_{]/.test(src[j + 1] || '')) interp = true;
        if (src[j] === '{' && src[j + 1] === '$') interp = true;
        v += src[j++];
      }
      toks.push({ t: 'str', v, interp, line });
      adv(j + 1);
      continue;
    }
    if (c === '<' && src.startsWith('<<<', i)) {
      const m = /^<<<[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(src.slice(i, i + 200));
      if (m) {
        const id = m[2];
        const nowdoc = m[1] === "'";
        const bodyStart = i + m[0].length;
        const end = new RegExp(`\\n[ \\t]*${id}(?![A-Za-z0-9_])`, 'g');
        end.lastIndex = bodyStart - 1;
        const e = end.exec(src);
        const bodyEnd = e ? e.index : n;
        const v = src.slice(bodyStart, bodyEnd);
        toks.push({ t: 'str', v, interp: !nowdoc && /\$[A-Za-z_{]|\{\$/.test(v), line });
        adv(e ? e.index + e[0].length : n);
        continue;
      }
    }
    if (c === '$' && /[A-Za-z_]/.test(src[i + 1] || '')) {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 100));
      toks.push({ t: 'var', v: m[0], line });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_\\]/.test(c)) {
      const m = /^\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i, i + 200));
      if (m) { toks.push({ t: 'id', v: m[0], line }); i += m[0].length; continue; }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i, i + 60));
      toks.push({ t: 'num', v: m[0], line });
      i += m[0].length;
      continue;
    }
    const op = MULTI_OPS.find((o) => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op, line }); i += op.length; continue; }
    toks.push({ t: 'op', v: c, line });
    i++;
  }
  return toks;
}

// ------------------------------------------------------------------ SQL recognition
const SQL_START = /^\s*\(?\s*(?:SELECT|INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO|WITH\s+\w+\s+AS|CREATE|ALTER|DROP|TRUNCATE|PRAGMA|SHOW|GRANT|REVOKE|VACUUM|LOAD\s+DATA|CALL|EXPLAIN|SET\s+(?:SESSION|NAMES|GLOBAL|PASSWORD)|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/;
const SQL_PIECE = /(?:^|[\s(,])(?:FROM|WHERE|AND|OR|NOT|ORDER\s+BY|GROUP\s+BY|LIMIT|OFFSET|VALUES|SET|JOIN|LEFT\s+JOIN|ON\s+DUPLICATE\s+KEY\s+UPDATE|ON\s+CONFLICT|DO\s+UPDATE\s+SET|IN|LIKE|BETWEEN|HAVING|UNION|IDENTIFIED\s+BY|IS\s+NULL|ASC|DESC|COUNT|COALESCE|EXISTS)(?=[\s(,]|$)/;
const isSqlStart = (s) => SQL_START.test(s);
const isSqlPiece = (s) => SQL_PIECE.test(s) && /[?=(),]|\bLIMIT\b|\bORDER\s+BY\b|\bAND\b|\bOR\b|\bSET\b|\bWHERE\b/.test(s);

// ------------------------------------------------------------------ operand classification
const CASTS = new Set(['int', 'integer', 'float', 'double', 'bool', 'boolean']);
const SAFE_CALLS = new Set(['intval', 'floatval', 'count', 'strlen', 'mb_strlen', 'Db::forUpdate', 'self::forUpdate', 'Tfm\\Db::forUpdate', '\\Tfm\\Db::forUpdate']);
const isConstId = (v) => /^\\?(?:[A-Za-z_][A-Za-z0-9_]*\\)*[A-Z][A-Z0-9_]*$/.test(v) || /^(?:true|false|null|TRUE|FALSE|NULL)$/.test(v);
function matchClose(toks, j, open, close) { let d = 0; for (let k = j; k < toks.length; k++) { if (toks[k].t === 'op' && toks[k].v === open) d++; else if (toks[k].t === 'op' && toks[k].v === close) { d--; if (d === 0) return k; } } return toks.length - 1; }
function matchOpen(toks, j, open, close) { let d = 0; for (let k = j; k >= 0; k--) { if (toks[k].t === 'op' && toks[k].v === close) d++; else if (toks[k].t === 'op' && toks[k].v === open) { d--; if (d === 0) return k; } } return 0; }
/** a parenthesised group that only picks one of several literals (cond ? 'a' : 'b'), or only literals */
function groupIsLiteral(toks, a, b) {
  let depth = 0; let q = -1;
  for (let k = a + 1; k < b; k++) { const t = toks[k]; if (t.t === 'op' && (t.v === '(' || t.v === '[')) depth++; else if (t.t === 'op' && (t.v === ')' || t.v === ']')) depth--; else if (depth === 0 && t.t === 'op' && t.v === '?') { q = k; break; } }
  const from = q >= 0 ? q + 1 : a + 1;
  for (let k = from; k < b; k++) { const t = toks[k]; if (t.t === 'str' && !t.interp) continue; if (t.t === 'num') continue; if (t.t === 'op' && (t.v === ':' || t.v === '.')) continue; if (t.t === 'id' && isConstId(t.v)) continue; return false; }
  return true;
}
/** the callee name before index k ('(' at k): Name, Class::name, $x->name */
function calleeBefore(toks, k) {
  const a = toks[k - 1];
  if (!a || a.t !== 'id') return { name: '', start: k };
  const b = toks[k - 2];
  if (b && b.t === 'op' && (b.v === '::' || b.v === '->')) {
    const c = toks[k - 3];
    if (c && (c.t === 'id' || c.t === 'var')) return { name: (c.t === 'var' && b.v === '->' ? '$->' : c.v + b.v) + a.v, start: k - 3 };
  }
  return { name: a.v, start: k - 1 };
}
const callKind = (name) => (SAFE_CALLS.has(name) || /->quote$/.test(name) || /^\$->quote$/.test(name) ? 'safe' : 'dynamic');
/** operand to the right of index j: {end, kind: 'lit'|'const'|'safe'|'dynamic', interp} */
function operandRight(toks, j) {
  const t = toks[j];
  if (!t) return { end: j, kind: 'dynamic' };
  if (t.t === 'str') return { end: j, kind: t.interp ? 'dynamic' : 'lit', interp: t.interp };
  if (t.t === 'num') return { end: j, kind: 'const' };
  if (t.t === 'op' && t.v === '(' && toks[j + 1] && toks[j + 1].t === 'id' && CASTS.has(toks[j + 1].v.toLowerCase()) && toks[j + 2] && toks[j + 2].v === ')') {
    const r = operandRight(toks, j + 3);
    return { end: r.end, kind: 'safe' };
  }
  if (t.t === 'op' && t.v === '(') { const e = matchClose(toks, j, '(', ')'); return { end: e, kind: groupIsLiteral(toks, j, e) ? 'const' : 'dynamic' }; }
  if (t.t === 'var' || t.t === 'id') {
    let k = j;
    let name = t.v;
    let kind = t.t === 'var' ? 'dynamic' : (isConstId(t.v) ? 'const' : 'dynamic');
    for (;;) {
      const nx = toks[k + 1];
      if (!nx) break;
      if (nx.t === 'op' && nx.v === '[') { k = matchClose(toks, k + 1, '[', ']'); kind = 'dynamic'; continue; }
      if (nx.t === 'op' && (nx.v === '->' || nx.v === '::') && toks[k + 2] && (toks[k + 2].t === 'id' || toks[k + 2].t === 'var')) {
        name = (t.t === 'var' && nx.v === '->' ? '$' : name) + nx.v + toks[k + 2].v;
        k += 2;
        kind = nx.v === '::' && toks[k].t === 'id' && isConstId(toks[k].v) && !(toks[k + 1] && toks[k + 1].v === '(') ? 'const' : 'dynamic';
        continue;
      }
      if (nx.t === 'op' && nx.v === '(') { const e = matchClose(toks, k + 1, '(', ')'); kind = callKind(name); k = e; continue; }
      break;
    }
    return { end: k, kind };
  }
  return { end: j, kind: 'dynamic' };
}
/** operand to the left of index j (j = its last token) */
function operandLeft(toks, j) {
  const t = toks[j];
  if (!t) return { start: j, kind: 'dynamic' };
  if (t.t === 'str') return { start: j, kind: t.interp ? 'dynamic' : 'lit' };
  if (t.t === 'num') return { start: j, kind: 'const' };
  if (t.t === 'op' && t.v === ')') {
    const s = matchOpen(toks, j, '(', ')');
    const callee = calleeBefore(toks, s);
    if (callee.name) return { start: callee.start, kind: callKind(callee.name) };
    return { start: s, kind: groupIsLiteral(toks, s, j) ? 'const' : 'dynamic' };
  }
  if (t.t === 'op' && t.v === ']') { const s = matchOpen(toks, j, '[', ']'); const r = operandLeft(toks, s - 1); return { start: r.start, kind: 'dynamic' }; }
  if (t.t === 'var' || t.t === 'id') {
    const p = toks[j - 1];
    // (int) $x
    if (t.t === 'var' && p && p.v === ')' && toks[j - 2] && toks[j - 2].t === 'id' && CASTS.has(toks[j - 2].v.toLowerCase()) && toks[j - 3] && toks[j - 3].v === '(') return { start: j - 3, kind: 'safe' };
    if (p && p.t === 'op' && (p.v === '->' || p.v === '::') && toks[j - 2]) {
      const r = operandLeft(toks, j - 2);
      return { start: r.start, kind: p.v === '::' && t.t === 'id' && isConstId(t.v) ? 'const' : 'dynamic' };
    }
    return { start: j, kind: t.t === 'id' && isConstId(t.v) ? 'const' : 'dynamic' };
  }
  return { start: j, kind: 'dynamic' };
}
const isDot = (t) => t && t.t === 'op' && t.v === '.';

// ------------------------------------------------------------------ analysis
function text(toks, a, b) {
  let s = '';
  for (let k = a; k <= b && k < toks.length; k++) {
    const t = toks[k];
    const v = t.t === 'str' ? (t.interp ? `"${t.v}"` : `'${t.v}'`) : t.v;
    s += (s && !/^[)\]\[(,;>:-]/.test(v) && !/[([>:]$/.test(s) ? ' ' : '') + v;
  }
  return s.replace(/\s+/g, ' ').trim();
}
function analyse(file, src) {
  const toks = tokenize(src);
  const hits = [];
  const seen = new Set();
  let statements = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'str' || seen.has(k)) continue;
    // the whole concatenation chain around this literal
    let a = k;
    let b = k;
    const parts = [{ kind: t.interp ? 'dynamic' : 'lit', at: k }];
    while (isDot(toks[a - 1])) { const l = operandLeft(toks, a - 2); parts.unshift({ kind: l.kind, at: l.start }); a = l.start; }
    while (isDot(toks[b + 1])) { const r = operandRight(toks, b + 2); parts.push({ kind: r.kind, at: b + 2 }); b = r.end; }
    const lits = [];
    for (let m = a; m <= b; m++) if (toks[m].t === 'str') { lits.push(toks[m]); seen.add(m); }
    const appended = toks[a - 1] && toks[a - 1].t === 'op' && toks[a - 1].v === '.=';
    const sql = lits.some((l) => isSqlStart(l.v)) || ((appended || lits.length > 1) && lits.some((l) => isSqlPiece(l.v)));
    if (!sql) continue;
    statements++;
    const interp = lits.filter((l) => l.interp && /\$[A-Za-z_{]|\{\$/.test(l.v));
    const dyn = parts.filter((p) => p.kind === 'dynamic' && !(toks[p.at] && toks[p.at].t === 'str' && toks[p.at].interp));
    if (!interp.length && !dyn.length) continue;
    const why = [interp.length ? 'a PHP variable inside the SQL text' : '', dyn.length ? `concatenated with ${dyn.length} non-constant operand${dyn.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ');
    const from = appended && toks[a - 2] ? a - 2 : a;
    hits.push({ file, line: toks[a].line, why, statement: text(toks, from, b) });
  }
  return { hits, statements };
}

// ------------------------------------------------------------------ run
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(?:node_modules|vendor|\.git)$/.test(e.name)) walk(p, out); } else if (e.name.endsWith('.php')) out.push(p);
  }
  return out;
}
let allow = [];
try { allow = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')) : []; } catch (e) { console.error(`✖ ${path.relative(ROOT, ALLOW_FILE)} is not valid JSON: ${e.message}`); process.exit(2); }
if (!Array.isArray(allow) || allow.some((x) => !x || typeof x.file !== 'string' || typeof x.snippet !== 'string' || typeof x.reason !== 'string' || !x.reason.trim())) {
  console.error('✖ every allow-list entry needs {file, snippet, reason}');
  process.exit(2);
}
if (!fs.existsSync(SCAN)) { console.error(`✖ nothing to scan: ${SCAN}`); process.exit(2); }
/** white space and quote characters dropped: an allow-list snippet matches however the code was quoted / spaced */
const norm = (s) => s.replace(/['"\s]/g, '');
const used = new Set();
const report = [];
let statements = 0;
let files = 0;
for (const f of walk(SCAN).sort()) {
  files++;
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const r = analyse(rel, fs.readFileSync(f, 'utf8'));
  statements += r.statements;
  for (const h of r.hits) {
    const idx = allow.findIndex((x) => x.file === rel && norm(h.statement).includes(norm(x.snippet)));
    if (idx >= 0) used.add(idx);
    report.push({ ...h, allowed: idx >= 0, reason: idx >= 0 ? allow[idx].reason : '' });
  }
}
const unreviewed = report.filter((h) => !h.allowed);
const stale = allow.map((x, i) => ({ ...x, i })).filter((x) => !used.has(x.i));
for (const h of report) {
  if (h.allowed && !SHOW_ALL) continue;
  console.log(`${h.allowed ? 'ALLOWED' : 'HIT    '} ${h.file}:${h.line} — ${h.why}\n         ${h.statement.slice(0, 220)}${h.allowed ? `\n         reviewed: ${h.reason}` : ''}`);
}
for (const s of stale) console.log(`STALE   allow-list entry for ${s.file} matches nothing any more: "${s.snippet.slice(0, 80)}"`);
const summary = { files, sqlStatements: statements, hits: report.length, allowed: report.length - unreviewed.length, unreviewed: unreviewed.length, staleAllowEntries: stale.length };
if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ summary, hits: report.map((h) => ({ ...h, statement: h.statement.slice(0, 600) })), stale }, null, 1));
console.log(`\n${unreviewed.length ? '✖' : '✔'} sql-audit: ${files} PHP files · ${statements} SQL statements · ${report.length} dynamic (${summary.allowed} reviewed, ${unreviewed.length} unreviewed)${stale.length ? ` · ${stale.length} stale allow-list entr${stale.length > 1 ? 'ies' : 'y'}` : ''}`);
process.exit(unreviewed.length ? 1 : 0);
