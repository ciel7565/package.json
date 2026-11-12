#!/usr/bin/env node
// =============================================================================
// tools/tdd-report.mjs — test reporter bridge for the tdd-guard plugin (developer tooling, never shipped).
//
// tdd-guard validates every Write / Edit against the latest test results in .claude/tdd-guard/data/test.json.
// This project's tests are plain scripts that print "PASS  name" / "FAIL  name — detail" lines, so this bridge
// runs (or reads) a test command, converts those lines to the reporter format and merges them into that file.
//
//   node tools/tdd-report.mjs <module> -- <command …>     run the command, echo its output, record the results
//   <command> 2>&1 | node tools/tdd-report.mjs <module>   record what a command printed
//
//   <module>  a stable label for the test file (e.g. tests/phase7-unit.php). Several agents may report different
//             modules at the same time: each run only replaces its own module; entries older than 45 minutes drop out.
//   exit code: the command's exit code (wrapper form) or 1 when a FAIL line was seen (pipe form).
// Recognised lines (ANSI colours are stripped): PASS / FAIL, ok / not ok (TAP), ✓ / ✗, and a JSON line
// {"tddTests":[{"name":"…","ok":true|false,"error":"…"}]} for browser self-tests.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.claude', 'tdd-guard', 'data');
const FILE = path.join(DATA, 'test.json');
const META = path.join(DATA, 'test-meta.json');
const STALE_MS = 45 * 60 * 1000;

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const moduleId = (sep === -1 ? argv[0] : argv.slice(0, sep)[0]) || 'tests';
const cmd = sep === -1 ? null : argv.slice(sep + 1);

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function parse(text, exitCode) {
  const tests = [];
  const lines = strip(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^\s*\{"tddTests":/.exec(line))) {
      try {
        for (const t of JSON.parse(line.trim()).tddTests || []) {
          tests.push({ name: String(t.name), fullName: `${moduleId} > ${t.name}`, state: t.ok ? 'passed' : 'failed', ...(t.ok ? {} : { errors: [{ message: String(t.error || 'failed') }] }) });
        }
      } catch { /* not ours */ }
      continue;
    }
    if (/^\s*[✔✖]\s+(\d+\/\d+|\d+ check|all )/.test(line)) continue; // summary lines
    if ((m = /^\s*(PASS|FAIL|ok|not ok|✓|✗)\s+(.+)$/.exec(line))) {
      const ok = m[1] === 'PASS' || m[1] === 'ok' || m[1] === '✓';
      const [name, ...rest] = m[2].split(/\s+—\s+/);
      const t = { name: name.trim().slice(0, 300), fullName: `${moduleId} > ${name.trim().slice(0, 300)}`, state: ok ? 'passed' : 'failed' };
      if (!ok) t.errors = [{ message: (rest.join(' — ') || 'assertion failed').slice(0, 2000) }];
      tests.push(t);
    }
  }
  if (exitCode !== 0 && !tests.some((t) => t.state === 'failed')) {
    // crashed before (or without) an assertion: fatal error, unresolved symbol, syntax error …
    const tail = lines.filter((l) => l.trim() !== '').slice(-15).join('\n').slice(0, 3000);
    tests.push({ name: 'test run crashed before an assertion', fullName: `${moduleId} > test run crashed before an assertion`, state: 'failed', errors: [{ message: tail || `exit code ${exitCode}` }] });
  }
  if (tests.length === 0) tests.push({ name: 'ran without errors (no PASS/FAIL lines)', fullName: `${moduleId} > ran without errors`, state: 'passed' });
  return tests;
}

function record(tests) {
  fs.mkdirSync(DATA, { recursive: true });
  let cur = { testModules: [] };
  let meta = {};
  try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
  try { meta = JSON.parse(fs.readFileSync(META, 'utf8')); } catch { /* first run */ }
  const now = Date.now();
  meta[moduleId] = now;
  const modules = (Array.isArray(cur.testModules) ? cur.testModules : [])
    .filter((m) => m && m.moduleId !== moduleId && now - (meta[m.moduleId] || 0) < STALE_MS);
  modules.push({ moduleId, tests });
  for (const k of Object.keys(meta)) if (!modules.some((m) => m.moduleId === k)) delete meta[k];
  const out = { testModules: modules, unhandledErrors: [], reason: modules.some((m) => m.tests.some((t) => t.state === 'failed')) ? 'failed' : 'passed' };
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, FILE);
  fs.writeFileSync(META, JSON.stringify(meta));
  const f = tests.filter((t) => t.state === 'failed').length;
  process.stderr.write(`[tdd-report] ${moduleId}: ${tests.length - f} passed, ${f} failed → .claude/tdd-guard/data/test.json\n`);
  return f;
}

if (cmd && cmd.length) {
  let buf = '';
  const child = spawn(cmd[0], cmd.slice(1), { cwd: process.cwd(), env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { buf += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => { buf += d; process.stderr.write(d); });
  child.on('error', (e) => { record(parse(String(e && e.message), 127)); process.exit(127); });
  child.on('close', (code) => { record(parse(buf, code ?? 1)); process.exit(code ?? 1); });
} else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; process.stdout.write(d); });
  process.stdin.on('end', () => { const failed = record(parse(buf, /Fatal error|Uncaught |SyntaxError|ERR_MODULE_NOT_FOUND/.test(buf) ? 1 : 0)); process.exit(failed ? 1 : 0); });
}
