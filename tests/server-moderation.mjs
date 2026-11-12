#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — moderation reaches the players who are online (the admin site → chat/list.php)
//
//   node tests/server-moderation.mjs                  spawn `php -S` over server/ with a throw-away data dir
//   node tests/server-moderation.mjs --root <dir>     the same over another install folder (e.g. dist/metaverse)
//
// The first admin is made with `php cli/tfm.php promote` (the phase-6 localhost bootstrap is gone — finding F4) and
// signs in at the admin site, whose address me.php gives to admins (its own sign-in: CONTRACT §15.4; the old admin.php
// is a 404). A stranger posts a line that a child already received; the admin hides it. The child's next poll
// (chat/list.php?after=<last id>&rafter=<retraction cursor>) must tell it to take the line back. Exits 1 when a check fails.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadChromium() { try { return require('playwright').chromium; } catch { return require('/opt/node22/lib/node_modules/playwright').chromium; } }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const DOCROOT = path.resolve(opt('--root', path.join(ROOT, 'server')));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\x1b[2m  — ${detail}\x1b[0m` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(base) { this.base = base; this.site = null; this.jar = new Map(); this.csrf = null; this.lastId = 0; this.rafter = 0; }
  /** p is relative to the install folder — or, with { inSite: true }, to the admin folder (its links and redirects are "./?tab=…") */
  async req(p, { json, form, inSite } = {}) {
    const headers = { Accept: form || inSite ? 'text/html' : 'application/json', 'User-Agent': 'tfm-moderation-test' };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; if (this.csrf) headers['X-CSRF-Token'] = this.csrf; body = JSON.stringify(json); }
    else if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(new URL(p, inSite ? this.site : this.base), { method: body !== undefined ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) { const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim(); if (v === '' || v === 'deleted') this.jar.delete(k); else this.jar.set(k, v); }
    }
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* HTML */ }
    if (j?.csrf) this.csrf = j.csrf;
    return { status: res.status, j, text, location: res.headers.get('location') };
  }
  async register(tag) {
    await this.req('api/ping.php');
    return this.req('api/auth/register.php', { json: { email: `${tag}@example.com`, nickname: tag, password: 'Ongi2026kid', password_confirm: 'Ongi2026kid', agree: true } });
  }
  /**
   * The admin site's own sign-in (CONTRACT §15.4): its address from me.php (admins only), the sign-in form's token, the
   * password — 2-step sign-in is "optional" and not enrolled here — then the dashboard. Sets this.site (absolute URL).
   */
  async signInAdmin(login) {
    const me = await this.req('api/auth/me.php');
    const rel = typeof me.j?.data?.adminUrl === 'string' && me.j.data.adminUrl ? me.j.data.adminUrl : '';
    if (!rel) throw new Error(`setup: me.php gave the admin no adminUrl (HTTP ${me.status}, role ${me.j?.data?.user?.role})`);
    this.site = new URL(rel, this.base).href;
    const pg = await this.req('./', { inSite: true });
    const tok = (pg.text.match(/name="_csrf" value="([0-9a-f]+)"/) || [])[1];
    if (!tok) throw new Error(`setup: the admin site gave no sign-in form (HTTP ${pg.status})`);
    const r = await this.req('./', { form: { action: 'login', login, password: 'Ongi2026kid', _csrf: tok }, inSite: true });
    const home = await this.req(r.location || './', { inSite: true });
    if (r.status !== 303 || !/<nav class="tabs"/.test(home.text)) throw new Error(`setup: admin site sign-in failed (POST ${r.status}, then HTTP ${home.status})`);
  }
  /** one admin-site form post (fresh CSRF token from the page) → the flash message shown after the redirect */
  async admin(fields) {
    const pg = await this.req('./?tab=moderation', { inSite: true });
    const tok = (pg.text.match(/name="_csrf" value="([0-9a-f]+)"/) || [])[1];
    if (!tok) throw new Error(`the admin site gave no form token (HTTP ${pg.status})`);
    const r = await this.req('./', { form: { tab: 'moderation', _csrf: tok, ...fields }, inSite: true });
    const page = await this.req(r.location || './', { inSite: true });
    return (page.text.match(/<div class="flash [^"]*" role="status">([^<]*)<\/div>/) || [])[1] || `(no message, HTTP ${r.status})`;
  }
  /** the game's chat poll: history first (after=0), then both cursors (messages after lastId, retractions after rafter) */
  async poll() {
    const r = await this.req(`api/chat/list.php?after=${this.lastId}${this.lastId ? `&rafter=${this.rafter}` : ''}`);
    const d = r.j?.data || {};
    if (Number.isSafeInteger(d.lastId)) this.lastId = d.lastId;
    if (Number.isSafeInteger(d.retractId)) this.rafter = d.retractId;
    return d;
  }
}

async function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-moderation-'));
const gd = path.join(DOCROOT, 'data/game-data.json');
if (fs.existsSync(gd)) fs.copyFileSync(gd, path.join(data, 'game-data.json'));
const port = await freePort();
const base = `http://127.0.0.1:${port}/`;
const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', DOCROOT], { env: { ...process.env, TFM_DATA_DIR: data }, stdio: 'ignore' });
const tag = Math.random().toString(36).slice(2, 7);

/** scenario setup (existing behaviour, not under test): first admin, a child and a stranger, the child polling chat */
async function setup() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + 'api/ping.php')).ok) break; } catch { /* not up yet */ } await sleep(100); }
  const adm = new Client(base), kid = new Client(base), evil = new Client(base);
  await adm.register(`adm${tag}`);
  // the first admin: `php cli/tfm.php promote` on the server computer (it signs the account out everywhere: log in again)
  const pr = spawnSync('php', [path.join(DOCROOT, 'cli/tfm.php'), 'promote', `adm${tag}@example.com`], { env: { ...process.env, TFM_DATA_DIR: data }, encoding: 'utf8' });
  if (pr.status !== 0) throw new Error(`setup: cli promote failed (${(pr.stderr || pr.stdout || '').slice(0, 200)})`);
  const lg = await adm.req('api/auth/login.php', { json: { login: `adm${tag}`, password: 'Ongi2026kid', remember: false } });
  if (lg.j?.data?.user?.role !== 'admin') throw new Error(`setup: the promoted account is not an admin after logging in again (HTTP ${lg.status})`);
  await adm.signInAdmin(`adm${tag}`);
  await kid.register(`kid${tag}`);
  await evil.register(`evil${tag}`);
  await kid.poll();
  return { adm, kid, evil };
}

try {
  const { adm, kid, evil } = await setup();
  const sent = await evil.req('api/chat/send.php', { json: { text: `kid${tag} 놀이터 뒤 숲으로 와! 선물 줄게`, channel: 'all' } });
  const mid = sent.j?.data?.message?.id;
  if (!(await kid.poll()).messages?.some((m) => m.id === mid)) throw new Error('setup: the child did not receive the line');
  await adm.admin({ action: 'hide', mid: String(mid) });
  const after = await kid.poll();
  const hidOk = (after.retracted?.messages || []).includes(mid);
  check('a hidden line is taken back on the next poll of a child who already has it', hidOk,
    hidOk ? '' : `expected chat/list.php (after + rafter cursors) to list message ${mid} in data.retracted.messages; received: ${JSON.stringify(after.retracted ?? null)} — list.php only filters hidden rows out of new results and sends no retraction`);
  // a banned sender: every line of that account is taken back (the child may hold older ones too)
  const evilId = String(sent.j.data.message.userId);
  await adm.admin({ action: 'ban', uid: evilId });
  const banned = await kid.poll();
  const banOk = (banned.retracted?.users || []).includes(evilId);
  check('the lines of a banned account are taken back on the next poll', banOk,
    banOk ? '' : `expected data.retracted.users to hold "${evilId}" after the admin site banned that account; received: ${JSON.stringify(banned.retracted ?? null)}`);
  // three different children report one line: it is hidden automatically — and taken back like an admin's hide
  const rude = new Client(base);
  await rude.register(`rude${tag}`);
  const line = await rude.req('api/chat/send.php', { json: { text: '너 바보야', channel: 'all' } });
  const rid = line.j?.data?.message?.id;
  await kid.poll();
  for (const n of ['r1', 'r2', 'r3']) {
    const c = new Client(base);
    await c.register(`${n}${tag}`);
    await c.req('api/chat/report.php', { json: { target: `rude${tag}`, messageId: rid, reason: 'abuse' } });
  }
  const auto = await kid.poll();
  const autoOk = (auto.retracted?.messages || []).includes(rid);
  check('a line hidden by three reports is taken back too', autoOk,
    autoOk ? '' : `expected data.retracted.messages to hold ${rid} after 3 reports hid it (chat/report.php); received: ${JSON.stringify(auto.retracted ?? null)}`);
  // a report without a message id carries words the REPORTER typed: the queue must never show them as the target's
  const framed = '바보 멍청이 너네 집 불 질러버릴거야';
  const framer = new Client(base);
  await framer.register(`fr${tag}`);
  const fr = await framer.req('api/chat/report.php', { json: { target: `kid${tag}`, reason: 'abuse', text: framed } });
  const rep = fr.j?.data?.reportId;
  if (!rep) throw new Error(`setup: the report was not filed (${fr.status} ${JSON.stringify(fr.j?.error ?? null)})`);
  const q = await adm.req('./?tab=moderation', { inSite: true });
  const row = (q.text.match(new RegExp(`<tr><td>${rep}</td>[\\s\\S]*?</tr>`)) || [])[0] || '';
  const msgCell = (row.match(/<td class="msg">([\s\S]*?)<\/td>/) || [])[1] ?? null;
  const frameOk = !!row && msgCell !== null && !msgCell.includes(framed) && row.includes('확인 안 됨');
  check('a report without a message id shows the reporter\'s text only as unverified, never as the target\'s message', frameOk,
    frameOk ? '' : `expected report ${rep}: 메시지 cell without the reporter's text and a '확인 안 됨' label; received: ${row.replace(/<form[\s\S]*?<\/form>/g, '').slice(0, 400) || '(row not found)'}`);
  // one unbroken memo (200 × "m") must not push every report's ⚙️ 처리 off a 1366-px screen
  const memoKid = new Client(base);
  await memoKid.register(`mm${tag}`);
  const okLine = await kid.req('api/chat/send.php', { json: { text: '오늘 콩 심었어', channel: 'all' } });
  await memoKid.req('api/chat/report.php', { json: { messageId: okLine.j?.data?.message?.id, reason: 'kid', memo: 'm'.repeat(2000) } });
  const browser = await loadChromium().launch({ args: ['--use-angle=swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, userAgent: 'tfm-moderation-test', locale: 'ko-KR' });
    await ctx.addCookies([...adm.jar].map(([name, value]) => ({ name, value, domain: '127.0.0.1', path: '/' })));
    const page = await ctx.newPage();
    await page.goto(new URL('./?tab=moderation', adm.site).href, { waitUntil: 'load' });
    const lay = await page.evaluate(() => {
      const t = document.querySelector('.tablewrap');
      const box = t.getBoundingClientRect();
      const sums = [...t.querySelectorAll('tbody summary')].map((x) => x.getBoundingClientRect());
      return { client: t.clientWidth, scroll: t.scrollWidth, rows: sums.length, hidden: sums.filter((r) => r.right > box.right + 1).length };
    });
    const layOk = lay.rows > 0 && lay.hidden === 0 && lay.scroll <= lay.client + 2;
    check('the report queue fits a 1366-px screen with an unbroken 200-char memo (every ⚙️ 처리 visible)', layOk,
      layOk ? '' : `expected no horizontal overflow and all ${lay.rows} ⚙️ 처리 in view; received: table ${lay.scroll} px in ${lay.client} px, ${lay.hidden} actions off-screen`);
    // a phone: the tables scroll sideways instead of squeezing — message columns stay readable, buttons stay one line
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'tfm-moderation-test', locale: 'ko-KR' });
    await phone.addCookies([...adm.jar].map(([name, value]) => ({ name, value, domain: '127.0.0.1', path: '/' })));
    const pp = await phone.newPage();
    await pp.goto(new URL('./?tab=moderation', adm.site).href, { waitUntil: 'load' });
    const ph = await pp.evaluate(() => {
      const one = (el) => { const r = el.getBoundingClientRect(), lh = parseFloat(getComputedStyle(el).lineHeight) || 20; return r.height <= lh * 1.6 + 20; };
      const btns = [...document.querySelectorAll('.tablewrap .btn')];
      const cells = [...document.querySelectorAll('.tablewrap td.msg')].map((td) => Math.round(td.getBoundingClientRect().width));
      return { pageScroll: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, wrapped: btns.filter((b) => !one(b)).map((b) => b.textContent.trim()), narrowest: Math.min(...cells) };
    });
    const phOk = ph.pageScroll <= ph.vw && !ph.wrapped.length && ph.narrowest >= 120;
    check('on a 390-px phone the moderation tables scroll sideways: readable message columns, one-line buttons', phOk,
      phOk ? '' : `expected no page overflow, no wrapped buttons and message cells ≥ 120 px; received: page ${ph.pageScroll}/${ph.vw} px, wrapped ${JSON.stringify(ph.wrapped.slice(0, 4))}, narrowest message cell ${ph.narrowest} px`);
    // Korean labels keep their words whole (사유 "어린이 신고", never "어린 / 이"); only message and memo cells may break anywhere
    const split = await pp.evaluate(() => {
      const out = [];
      for (const td of document.querySelectorAll('.tablewrap td:not(.msg):not(.memo)')) {
        const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          for (const m of n.data.matchAll(/\p{Script=Hangul}{2,}/gu)) {
            const r = document.createRange();
            r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
            if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) out.push(m[0]);
          }
        }
      }
      return out;
    });
    check('on a 390-px phone Korean words in the moderation tables stay whole (only message and memo cells break anywhere)', !split.length,
      split.length ? `expected no Korean word split across lines outside message/memo cells; received split words: ${JSON.stringify(split.slice(0, 6))}` : '');
  } finally { await browser.close(); }
  // the audit log is longer than one page: 다음 → reaches the oldest entries and keeps the event filter
  const fill = spawnSync('php', ['-r', `require ${JSON.stringify(path.join(DOCROOT, 'lib/bootstrap.php'))}; for ($i = 0; $i < 230; $i++) Tfm\\Audit::log('test_fill', null, ['n' => $i]);`],
    { env: { ...process.env, TFM_DATA_DIR: data }, encoding: 'utf8' });
  if (fill.status !== 0) throw new Error(`setup: audit rows not written (${fill.stderr || fill.stdout})`);
  const seen = [];
  let next = './?tab=audit&ev=test_fill', pages = 0;
  while (next && pages < 5) {
    const pg = await adm.req(next, { inSite: true });
    pages++;
    for (const m of pg.text.matchAll(/<tr><td>(\d+)<\/td><td>[^<]*<\/td><td>([a-z_]+)<\/td>(?:<td>[^<]*<\/td>){4}<td>([^<]*)<\/td><\/tr>/g)) {
      seen.push({ id: +m[1], ev: m[2], n: +((m[3].match(/n&quot;:(\d+)/) || [])[1] ?? -1) });
    }
    const a = pg.text.match(/<a [^>]*href="([^"]+)"[^>]*>다음 →<\/a>/);
    next = a ? a[1].replace(/&amp;/g, '&') : null;
  }
  const ns = new Set(seen.map((r) => r.n));
  const pageOk = seen.length === 230 && ns.size === 230 && ns.has(0) && seen.every((r, i) => r.ev === 'test_fill' && (i === 0 || r.id < seen[i - 1].id));
  check('the audit tab pages past 200 rows: 다음 → reaches the oldest entries and keeps the event filter', pageOk,
    pageOk ? '' : `expected 230 distinct test_fill rows (n 0…229, newest first) over the pages; received ${seen.length} rows on ${pages} page(s), ${ns.size} distinct, events ${JSON.stringify([...new Set(seen.map((r) => r.ev))])}, oldest n ${ns.size ? Math.min(...ns) : '-'} — viewAudit stops at LIMIT 200 and shows no paging link`);

  // a child muted for a day: grown-ups read hours (not "1440분"), the game gets the end time to keep the child's taps quiet
  const kidId = (await kid.req('api/auth/me.php')).j?.data?.user?.id;
  await adm.admin({ action: 'mute', uid: String(kidId), minutes: '1440' });
  const muted = await kid.req('api/chat/send.php', { json: { text: '안녕하세요', channel: 'all' } });
  const mText = muted.j?.error?.message || '', until = Number(muted.j?.data?.until);
  const muteOk = muted.status === 403 && /24시간/.test(mText) && !/1440분/.test(mText) && until > Date.now() + 23 * 3600e3;
  check('a long mute reads in hours and the MUTED answer carries its end time (data.until)', muteOk,
    muteOk ? '' : `expected 403 MUTED "…(24시간 남음)" with data.until ≈ now + 24 h; received: HTTP ${muted.status} "${mText}", data ${JSON.stringify(muted.j?.data ?? null)}`);

  // the game hears about a mute (and its end) with the next presence answer — before the child taps anything
  const here = { x: 0, y: 0, z: 0, rotY: 0, anim: 'idle', speed: 0 };
  const p1 = Number((await kid.req('api/presence/update.php', { json: here })).j?.data?.mutedUntil);
  await adm.admin({ action: 'mute', uid: String(kidId), minutes: '0' });
  const p2 = (await kid.req('api/presence/update.php', { json: here })).j?.data?.mutedUntil;
  const presOk = Math.abs(p1 - until) < 1000 && p2 === 0;
  check('presence tells the game its own mute end (and 0 once a grown-up lifts it)', presOk,
    presOk ? '' : `expected data.mutedUntil ≈ ${until} while muted, then 0 after the admin site lifted it; received: ${p1}, then ${JSON.stringify(p2)}`);
} catch (e) {
  check('moderation scenario ran', false, e?.message || String(e));
} finally {
  php.kill();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\x1b[31m${failed} of ${results.length} checks failed\x1b[0m` : `\x1b[32mall ${results.length} checks passed\x1b[0m`);
process.exit(failed ? 1 : 0);
