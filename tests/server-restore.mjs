#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — database restore vs. remembered sessions (README-SERVER §9)
//
//   node tests/server-restore.mjs                  spawn `php -S` over server/ with a throw-away data dir
//   node tests/server-restore.mjs --root <dir>     the same over another install folder (e.g. dist/metaverse)
//
// A backup is made, child X registers with "로그인 상태 유지", the backup is restored (the server is stopped, the DB
// file is copied back) and child Y registers. The id counter went back with the restore, so Y gets X's old id. X's
// tablet still holds its remembered session: it must not be logged in as Y. Exits 1 when a check fails.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const DOCROOT = path.resolve(opt('--root', path.join(ROOT, 'server')));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\x1b[2m  — ${detail}\x1b[0m` : ''}`);
}
function need(cond, what) { if (!cond) throw new Error(`setup failed: ${what}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(base) { this.base = base; this.jar = new Map(); this.csrf = null; }
  async req(p, json) {
    const headers = { Accept: 'application/json', 'User-Agent': 'tfm-restore-test' };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; if (this.csrf) headers['X-CSRF-Token'] = this.csrf; }
    const res = await fetch(new URL(p, this.base), { method: json !== undefined ? 'POST' : 'GET', headers, body: json !== undefined ? JSON.stringify(json) : undefined, redirect: 'manual' });
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) { const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim(); if (v === '' || v === 'deleted') this.jar.delete(k); else this.jar.set(k, v); }
    }
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    if (j?.csrf) this.csrf = j.csrf;
    return { status: res.status, j };
  }
  async register(tag, remember) {
    await this.req('api/ping.php');
    return this.req('api/auth/register.php', { email: `${tag}@example.com`, nickname: tag, password: 'Ongi2026kid', password_confirm: 'Ongi2026kid', agree: true, remember });
  }
  me() { return this.req('api/auth/me.php'); }
}

async function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-restore-'));
const gd = path.join(DOCROOT, 'data/game-data.json');
if (fs.existsSync(gd)) fs.copyFileSync(gd, path.join(data, 'game-data.json'));
const port = await freePort();
const base = `http://127.0.0.1:${port}/`;
let php = null;
async function start() {
  php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', DOCROOT], { env: { ...process.env, TFM_DATA_DIR: data }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + 'api/ping.php')).ok) return; } catch { /* not up yet */ } await sleep(100); }
  throw new Error('php -S did not start');
}
async function stop() { if (!php) return; const p = php; php = null; await new Promise((r) => { p.once('exit', r); p.kill(); }); }
const cli = (...a) => spawnSync('php', [path.join(DOCROOT, 'cli/tfm.php'), ...a], { env: { ...process.env, TFM_DATA_DIR: data }, encoding: 'utf8' });
const tag = Math.random().toString(36).slice(2, 7);

try {
  await start();
  const o = new Client(base);
  need((await o.register(`kidO${tag}`, true)).status === 200, 'account O (in the backup)');
  const bk = cli('backup');
  const file = (bk.stdout.match(/[^\s]*tfm-[^\s]*\.sqlite/) || [])[0];
  need(bk.status === 0 && file && fs.existsSync(file), 'php cli/tfm.php backup');
  const x = new Client(base);
  const rx = await x.register(`kidX${tag}`, true);                  // only exists after the backup
  need(rx.status === 200, 'account X');
  await stop();
  // restore the README way: server stopped, the backup copied over the DB file (no WAL left behind)
  const db = fs.readdirSync(data).find((f) => /^db-.*\.sqlite$/.test(f));
  for (const side of ['-wal', '-shm']) if (fs.existsSync(path.join(data, db + side))) fs.renameSync(path.join(data, db + side), path.join(data, db + side + '.old'));
  fs.copyFileSync(file, path.join(data, db));
  await start();
  const y = new Client(base);
  const ry = await y.register(`kidY${tag}`, false);
  need(ry.status === 200 && ry.j?.data?.user?.id === rx.j?.data?.user?.id, 'account Y reuses X\'s id after the restore');
  const mx = await x.me();
  const asY = mx.j?.data?.user?.id === ry.j.data.user.id;
  check('X\'s remembered session is not logged in as Y', mx.status === 200 && !asY,
    asY ? `expected X's session (login made for the account row of X) to be rejected now that id ${ry.j.data.user.id} is Y's newer account row; received: Auth::current accepted it as ${mx.j.data.user.nickname} — Auth::current compares only the id and session_epoch and never asks Session::ownsAccount($u)` : '');
  const [mo, my] = [await o.me(), await y.me()];
  check('sessions of accounts that exist after the restore keep working (O from the backup, Y new)',
    mo.j?.data?.user?.nickname === `kidO${tag}` && my.j?.data?.user?.nickname === `kidY${tag}`, `O ${JSON.stringify(mo.j?.data?.user ?? null)}, Y ${JSON.stringify(my.j?.data?.user ?? null)}`);
} catch (e) {
  check('restore scenario ran', false, e?.message || String(e));
} finally {
  await stop();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\x1b[31m${failed} of ${results.length} checks failed\x1b[0m` : `\x1b[32mall ${results.length} checks passed\x1b[0m`);
process.exit(failed ? 1 : 0);
