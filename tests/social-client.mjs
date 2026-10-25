#!/usr/bin/env node
// =============================================================================
// tests/social-client.mjs — 60-social in server mode against a scripted server (no PHP needed)
//
//   node tests/social-client.mjs [--file dist/metaverse/index.html]
//
// Loads the built game (local mode, autostart), replaces G.net.request with a fake chat/presence server and
// switches G.sys.social to server mode for a logged-in player. Then it checks how the client handles what the
// server says (moderation that takes lines back, …). Prints PASS/FAIL per check, exit code 1 on any failure.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const file = path.resolve(opt('--file', path.join(ROOT, 'dist/metaverse/index.html')));
if (!fs.existsSync(file)) { console.error(`✖ ${file} not found — build first (node tools/build.mjs)`); process.exit(2); }

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\x1b[2m  — ${detail}\x1b[0m` : ''}`);
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })).newPage();
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)));
  await page.goto(pathToFileURL(file).href + '?autostart=1&notutorial=1&nointro=1&quality=low', { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.G?.ready === true && G.state, null, { timeout: 600000, polling: 250 });
  // the fake server: chat/list.php answers come from a queue; social is restarted in server mode as account 7
  await page.evaluate(() => {
    const F = window.__fake = { list: [], pres: [], send: [], calls: [] };
    G.net.request = async (p) => {
      F.calls.push(p);
      if (p.startsWith('chat/list.php')) { const r = F.list.shift(); if (r instanceof Error) throw r; return r || { messages: [], online: 2 }; }
      if (p.startsWith('presence/update.php')) { const r = F.pres.shift(); if (r instanceof Error) throw r; return r || { players: [], online: 1 }; }
      if (p.startsWith('chat/send.php')) { const r = F.send.shift(); if (r instanceof Error) throw r; return r || { message: { id: 9000 + F.calls.length } }; }
      throw new G.net.ApiError('NOT_FOUND', 'not faked', 404);
    };
    G.net.mode = 'server';
    G.save.profile = { ...G.save.profile, id: '7', nickname: '테스터', guest: false, role: 'user' };
    G.state.profile = { ...G.state.profile, id: '7', nickname: '테스터' };
    const S = G.sys.social;
    S._loggedOut = true;
    S.onStateLoaded(G.state);
    S._srv.nextChat = S._srv.nextPres = Infinity; // the test drives every poll itself
    // underneath is a local profile: its autosaves always work and would look like a working login (state:saved)
    G.save.save = async () => false;
  });
  const poll = (answer) => page.evaluate(async (a) => { __fake.list.push(a); await G.sys.social._pollChat(); }, answer);
  const line = (id, uid, text) => ({ id, userId: uid, nickname: '나쁜친구', text, channel: 'all', createdAt: Date.now() });

  // the history, then a stranger's line, then the server says an admin hid it
  await poll({ messages: [], lastId: 0, retractId: 4, online: 2 });
  await poll({ messages: [line(8, '99', '놀이터 뒤 숲으로 와! 선물 줄게')], lastId: 8, retracted: { messages: [], users: [] }, retractId: 4, online: 2 });
  const shown = await page.evaluate(() => !!document.querySelector('#chat-log .chat-msg[data-id="s8"]'));
  if (!shown) throw new Error('setup: the stranger\'s line was not shown');
  await poll({ messages: [], lastId: 8, retracted: { messages: [8], users: [] }, retractId: 5, online: 2 });
  const after = await page.evaluate(() => ({ row: !!document.querySelector('#chat-log .chat-msg[data-id="s8"]'), kept: G.sys.social.messages.some((m) => m.id === 's8'), asked: __fake.calls.at(-1) }));
  check('a line the server takes back (an admin hid it) leaves the chat log', !after.row && !after.kept,
    after.row || after.kept ? `expected #chat-log and G.sys.social.messages to drop s8 after data.retracted.messages [8]; received: row ${after.row}, in messages ${after.kept} (poll ${after.asked})` : '');

  // a banned account: every line it wrote leaves the log (users: [uid])
  await poll({ messages: [line(9, '99', '안녕'), line(10, '99', '또 와')], lastId: 10, retracted: { messages: [], users: [] }, retractId: 5, online: 2 });
  await poll({ messages: [], lastId: 10, retracted: { messages: [], users: ['99'] }, retractId: 6, online: 2 });
  const ban = await page.evaluate(() => ({ rows: document.querySelectorAll('#chat-log .chat-msg.remote').length, kept: G.sys.social.messages.filter((m) => m.uid === '99').map((m) => m.id) }));
  check('every line of an account the server says was banned leaves the chat log', !ban.rows && !ban.kept.length,
    ban.rows || ban.kept.length ? `expected no row / message of uid 99 after data.retracted.users ["99"]; received: ${ban.rows} rows, messages ${JSON.stringify(ban.kept)}` : '');

  // the stranger stands next to me and the line shows in the speech bubble above it: taking it back hides the bubble
  await page.evaluate(async () => {
    const pp = G.sys.player.position;
    __fake.pres.push({ players: [{ id: 42, nickname: '낯선친구', x: pp.x + 2, y: pp.y, z: pp.z + 1, rotY: 0, anim: 'idle', speed: 0 }], online: 2 });
    await G.sys.social._presence();
  });
  await poll({ messages: [line(11, '42', '비밀 장소로 와')], lastId: 11, retracted: { messages: [], users: [] }, retractId: 6, online: 2 });
  const bub0 = await page.evaluate(() => { const o = G.sys.social.others.get('P_42'); return o ? { hidden: o.bub.bubble.hidden, text: o.bub.bubble.textContent } : null; });
  if (!bub0 || bub0.hidden) throw new Error(`setup: the bubble did not show the line (${JSON.stringify(bub0)})`);
  await poll({ messages: [], lastId: 11, retracted: { messages: [11], users: [] }, retractId: 7, online: 2 });
  const bub = await page.evaluate(() => { const o = G.sys.social.others.get('P_42'); return o ? { hidden: o.bub.bubble.hidden, text: o.bub.bubble.textContent } : null; });
  check('the speech bubble showing a line that was taken back is hidden', !!bub && bub.hidden,
    bub && !bub.hidden ? `expected the bubble of P_42 to hide after data.retracted.messages [11]; received: still shown "${bub.text}"` : '');

  // other systems (the 알림함 keeps mentions) learn what was taken back
  await page.evaluate(() => { window.__gone = []; G.bus.on('chat:retracted', (p) => window.__gone.push(p)); });
  const mentions = () => page.evaluate(() => (G.state.engagement?.notifications || []).filter((n) => n.type === 'mention').map((n) => ({ title: n.title, text: n.text, count: n.count })));
  await poll({ messages: [line(12, '43', '테스터 이리 와')], lastId: 12, retracted: { messages: [], users: [] }, retractId: 7, online: 2 });
  const men0 = await mentions();
  const men0Ok = men0.length === 1 && !/이리 와|나쁜친구/.test(JSON.stringify(men0));
  check('a mention notice in the 알림함 keeps none of the stranger\'s words or nickname (it is saved, also to the server)', men0Ok,
    men0Ok ? '' : `expected one mention notice with fixed text; received: ${JSON.stringify(men0)}`);
  await poll({ messages: [], lastId: 12, retracted: { messages: [12], users: ['43'] }, retractId: 8, online: 2 });
  const ev = await page.evaluate(() => window.__gone);
  const evOk = ev.length === 1 && ev[0].ids?.includes('s12') && ev[0].users?.includes('43');
  check('chat:retracted tells other systems which lines (ids) and accounts were taken back', evOk,
    evOk ? '' : `expected one chat:retracted {ids:['s12'], users:['43']}; received: ${JSON.stringify(ev)}`);
  const men1 = await mentions();
  check('the mention notice of a line that was taken back leaves the 알림함 (and so the save)', !men1.length,
    men1.length ? `expected no mention notice after data.retracted.messages [12]; received: ${JSON.stringify(men1)}` : '');

  // 쉬운 모드: the kid chat window shows the last lines as big bubbles — a line taken back leaves it at once
  await page.evaluate(() => { G.setSetting('easyMode', true); G.sys.social.openKidChat(); });
  await poll({ messages: [line(13, '44', '나를 따라와요! 🏃')], lastId: 13, retracted: { messages: [], users: [] }, retractId: 8, online: 2 });
  await page.waitForFunction(() => document.querySelectorAll('.skc-recent .skc-msg').length > 0, null, { timeout: 20000 });
  const kid0 = await page.evaluate(() => [...document.querySelectorAll('.skc-recent .skc-msg')].map((r) => r.textContent));
  if (!kid0.some((t) => t.includes('따라와요'))) throw new Error(`setup: the kid chat did not show the line (${JSON.stringify(kid0)})`);
  await poll({ messages: [], lastId: 13, retracted: { messages: [13], users: [] }, retractId: 9, online: 2 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const kid1 = await page.evaluate(() => [...document.querySelectorAll('.skc-recent .skc-msg')].map((r) => r.textContent));
  const kidOk = !kid1.some((t) => t.includes('따라와요'));
  check('the kid chat window drops a line that was taken back', kidOk, kidOk ? '' : `expected .skc-recent to drop s13; received: ${JSON.stringify(kid1)}`);
  await page.evaluate(() => G.sys.social.closeKidChat());

  // the chat window is closed: the line counted as unread; taken back, it no longer counts
  await page.evaluate(() => G.sys.social.toggleChat(false));
  await poll({ messages: [line(14, '45', '같이 놀아요! 🤗')], lastId: 14, retracted: { messages: [], users: [] }, retractId: 9, online: 2 });
  const un0 = await page.evaluate(() => G.sys.social._unread);
  if (un0 < 1) throw new Error(`setup: the line was not counted as unread (${un0})`);
  await poll({ messages: [], lastId: 14, retracted: { messages: [14], users: [] }, retractId: 10, online: 2 });
  const un1 = await page.evaluate(() => ({ n: G.sys.social._unread, badge: document.querySelector('#chat-panel .chat-unread')?.hidden }));
  check('an unread line that was taken back no longer counts as unread', un1.n === un0 - 1,
    un1.n === un0 - 1 ? '' : `expected the unread count to drop from ${un0} to ${un0 - 1}; received: ${JSON.stringify(un1)}`);

  // the server session ended (ban, restore, role change, expiry): presence answers 401 while chat reading still works
  // for guests — the end is reported to 70-app once, a chat poll that succeeds without a login does not re-arm it
  await page.evaluate(() => { window.__lost = 0; G.bus.on('save:auth-lost', () => { window.__lost++; }); });
  const tick = (what) => page.evaluate(async (w) => {
    const S = G.sys.social._srv, F = __fake, n = F.calls.length;
    if (w === 'pres') S.nextPres = 0; else S.nextChat = 0;
    for (let i = 0; i < 200 && (F.calls.length === n || S.presBusy || S.chatBusy); i++) await new Promise((r) => setTimeout(r, 25));
    S.nextPres = S.nextChat = Infinity;
    return F.calls.slice(n);
  }, what);
  const e401 = () => page.evaluate(() => { __fake.pres.push(new G.net.ApiError('AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.', 401)); });
  await e401();
  await tick('pres');
  await poll({ messages: [], lastId: 14, retracted: { messages: [], users: [] }, retractId: 10, online: 2 });
  await e401();
  await tick('pres');
  const lost = await page.evaluate(() => window.__lost);
  check('an ended session is reported once, not again after a chat poll that works without a login', lost === 1,
    lost === 1 ? '' : `expected 1 save:auth-lost after 401 → chat 200 → presence tick; received: ${lost} (a successful guest chat poll re-armed the report)`);

  // while the session is gone, presence (which needs the login) is not sent at all: no 401 every 2 s
  const idle = await tick('pres');
  const quiet = !idle.some((c) => c.startsWith('presence/update.php'));
  check('presence is not sent while the session is gone', quiet, quiet ? '' : `expected no presence/update.php after the 401; received: ${JSON.stringify(idle)}`);

  // nobody's position comes in without presence: the other players' avatars go away instead of standing frozen
  const frozen = await page.evaluate(() => [...G.sys.social.others.values()].filter((o) => o.kind === 'remote').map((o) => o.id));
  check('the other players\' avatars are cleared while the session is gone (no frozen crowd)', !frozen.length,
    frozen.length ? `expected no remote avatars once presence stopped; received: ${JSON.stringify(frozen)}` : '');

  // the session is back (the re-login saved the game: state:saved): presence starts again and the others come back,
  // quietly (no "joined" line for each of them)
  const n0 = await page.evaluate(() => {
    const pp = G.sys.player.position;
    __fake.pres.length = 0; // the second 401 above was never asked for (presence stayed paused)
    __fake.pres.push({ players: [{ id: 42, nickname: '낯선친구', x: pp.x + 2, y: pp.y, z: pp.z + 1, rotY: 0, anim: 'idle', speed: 0 }], online: 2 });
    G.bus.emit('state:saved', { reason: 'manual' });
    return G.sys.social.messages.length;
  });
  const resumed = await tick('pres');
  const back = await page.evaluate((n) => ({ remote: G.sys.social.others.has('P_42'), sys: G.sys.social.messages.slice(n).filter((m) => m.kind === 'system').map((m) => m.text) }), n0);
  const backOk = resumed.some((c) => c.startsWith('presence/update.php')) && back.remote && !back.sys.length;
  check('when the session is back (a save works again) presence starts again and the others come back quietly', backOk,
    backOk ? '' : `expected presence/update.php after state:saved, P_42 back and no system lines; received: calls ${JSON.stringify(resumed)}, remote ${back.remote}, system ${JSON.stringify(back.sys)} — nothing clears S.authLost after a successful save, so presence stays paused`);

  // 쉬운 모드, muted by a grown-up (admin.php 채팅 제한): the child hears a kid line, not the grown-up's MUTED text
  await page.evaluate(() => {
    window.__toasts = [];
    const ot = G.ui.toast;
    G.ui.toast = function (m, o) { window.__toasts.push({ m: String(m), say: o?.say ?? null }); return ot.apply(this, arguments); };
    G.setSetting('easyMode', true);
    const until = Date.now() + (G.time?.serverOffset || 0) + 24 * 3600e3;
    __fake.send.push(new G.net.ApiError('MUTED', '채팅이 잠시 제한되었어요. (24시간 남음)', 403, { until }));
    G.sys.social.sendKidPhrase('nice');
  });
  await page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 10000 }).catch(() => {});
  const mutedToasts = await page.evaluate(() => window.__toasts);
  const kidLine = mutedToasts.some((t) => /쉬어요/.test(t.m)) && !mutedToasts.some((t) => /제한되었어요|남음/.test(t.m) || /제한되었어요/.test(t.say || ''));
  check('a muted child in easy mode hears a kid line, not the grown-up MUTED text', kidLine,
    kidLine ? '' : `expected a toast like "지금은 말하기를 잠깐 쉬어요 🤫" and no "제한되었어요 (… 남음)"; received: ${JSON.stringify(mutedToasts)}`);

  // …and the game remembers it (data.until): the next tap is not sent at all — no line, no bubble, nothing read aloud
  await page.waitForTimeout(1500); // past the 1.2-s pace guard, so only the mute can stop the tap
  const q0 = await page.evaluate(() => {
    window.__says = []; window.__toasts = [];
    const os = G.easy?.say;
    if (os && !os.__spy) { G.easy.say = function (t) { window.__says.push(String(t)); return os.apply(this, arguments); }; G.easy.say.__spy = true; }
    return { n: G.sys.social.messages.length, sends: __fake.calls.filter((c) => c.startsWith('chat/send.php')).length, sent: G.sys.social.sendKidPhrase('friend') };
  });
  await page.waitForTimeout(400);
  const q1 = await page.evaluate(() => ({ n: G.sys.social.messages.length, sends: __fake.calls.filter((c) => c.startsWith('chat/send.php')).length, says: window.__says, toasts: window.__toasts.map((t) => t.m) }));
  const held = q0.sent === false && q1.n === q0.n && q1.sends === q0.sends && !q1.says.some((t) => t.includes('친구 해요')) && q1.toasts.some((t) => /쉬어요/.test(t));
  check('while muted, the next tap is not sent: no line, no bubble, nothing read aloud — only the kid line', held,
    held ? '' : `expected sendKidPhrase → false, no new message / chat/send.php call, no "우리 친구 해요" spoken, a "쉬어요" toast; received: sent ${q0.sent}, messages ${q0.n}→${q1.n}, sends ${q0.sends}→${q1.sends}, says ${JSON.stringify(q1.says)}, toasts ${JSON.stringify(q1.toasts)}`);

  // a grown-up lifts the pause: once presence says mutedUntil 0, the child can talk again
  await page.waitForTimeout(1300);
  const lifted = await page.evaluate(async () => {
    __fake.pres.length = 0;
    __fake.pres.push({ players: [], online: 1, mutedUntil: 0 });
    await G.sys.social._presence();
    const n = __fake.calls.filter((c) => c.startsWith('chat/send.php')).length;
    const sent = G.sys.social.sendKidPhrase('welcome');
    return { sent, sends: __fake.calls.filter((c) => c.startsWith('chat/send.php')).length - n };
  });
  const liftOk = lifted.sent === true && lifted.sends === 1;
  check('after a grown-up lifts the pause (presence mutedUntil 0) the child can talk again', liftOk,
    liftOk ? '' : `expected the tap to go out (sendKidPhrase → true, one chat/send.php); received: ${JSON.stringify(lifted)} — the end time from the MUTED answer is never replaced by what presence says`);

  // paused before the first tap (presence brings mutedUntil): the very first tap is already quiet — no bubble, no words
  await page.waitForTimeout(1300);
  const pre = await page.evaluate(async () => {
    window.__says = []; window.__toasts = [];
    __fake.pres.length = 0;
    __fake.pres.push({ players: [], online: 1, mutedUntil: Date.now() + (G.time?.serverOffset || 0) + 3600e3 });
    await G.sys.social._presence();
    const n = G.sys.social.messages.length, s0 = __fake.calls.filter((c) => c.startsWith('chat/send.php')).length;
    const sent = G.sys.social.sendKidPhrase('thanks');
    return { sent, lines: G.sys.social.messages.length - n, sends: __fake.calls.filter((c) => c.startsWith('chat/send.php')).length - s0, says: window.__says, toasts: window.__toasts.map((t) => t.m) };
  });
  const preOk = pre.sent === false && !pre.lines && !pre.sends && !pre.says.some((t) => t.includes('고마워')) && pre.toasts.some((t) => /쉬어요/.test(t));
  check('muted before the first tap (presence): the first tap is already quiet, only the kid line', preOk,
    preOk ? '' : `expected no line, no chat/send.php, nothing spoken but the kid line; received: ${JSON.stringify(pre)}`);

  // 쉬운 모드: a blocked friend's lines leave the chat panel too (the easy row layout must not show them again)
  const blk = await page.evaluate(() => {
    G.setSetting('easyMode', true);
    const S = G.sys.social;
    S._push({ name: '막을친구', kind: 'remote', text: '같이 놀자!', channel: 'all', uid: '98', near: true });
    S.block('막을친구');
    S._push({ name: '막을친구', kind: 'remote', text: '또 놀자!', channel: 'all', uid: '98', near: true });
    const rows = [...document.querySelectorAll('#chat-log .chat-msg.blocked')];
    const out = { rows: rows.length, shown: rows.filter((r) => getComputedStyle(r).display !== 'none').length };
    S.unblock('막을친구');
    return out;
  });
  const blkOk = blk.rows >= 2 && !blk.shown;
  check('in easy mode the lines of a blocked friend are hidden in the chat panel', blkOk,
    blkOk ? '' : `expected the blocked rows to be display:none; received: ${blk.rows} blocked rows, ${blk.shown} still shown — body.easy .chat-log .chat-msg.remote {display:flex} beats .chat-msg.blocked {display:none}`);

  // a shared device: after a logout nothing of that player's words stays in memory for the next child
  await page.waitForTimeout(1300);
  const left = await page.evaluate(async () => {
    const S = G.sys.social;
    __fake.pres.length = 0;
    __fake.pres.push({ players: [], online: 1, mutedUntil: 0 });
    await S._presence();
    const sent = S.sendChat('채팅비밀A2');
    S.onLogout();
    return { sent, lastText: S._lastText };
  });
  const leftOk = left.sent === true && !left.lastText;
  check('a logout leaves none of the player\'s chat words in memory (spam-guard _lastText)', leftOk,
    leftOk ? '' : `expected _lastText to be empty after onLogout; received: ${JSON.stringify(left)}`);

  // local mode keeps no report log on the device: no reporter nickname, no quoted words (nothing ever read it back)
  const rep = await page.evaluate(async () => {
    const S = G.sys.social, mode = S._mode;
    try { localStorage.removeItem('tfm.v1.chat.reports'); } catch (e) { /* storage blocked */ }
    S._mode = 'local';
    let ok;
    try { ok = await S._fileReport({ name: '나쁜친구' }, 'abuse', '무서워요', { id: 'v1', text: '비밀 장소로 와' }, { quiet: true }); } finally { S._mode = mode; }
    return { ok, stored: localStorage.getItem('tfm.v1.chat.reports') };
  });
  const repOk = rep.ok === true && rep.stored === null;
  check('a report in local mode leaves no reporter name or quote on the device (tfm.v1.chat.reports)', repOk,
    repOk ? '' : `expected the report to be taken (true) and nothing stored; received: ${JSON.stringify(rep)}`);

  // a device an older version left such a log on: the next profile load clears it (a removed child leaves no quotes)
  const oldLog = await page.evaluate(() => {
    try { localStorage.setItem('tfm.v1.chat.reports', JSON.stringify([{ target: '나쁜친구', text: '옛 신고 글', reporter: '지운아이' }])); } catch (e) { /* storage blocked */ }
    G.sys.social.onStateLoaded(G.state);
    return localStorage.getItem('tfm.v1.chat.reports');
  });
  check('an older version\'s report log on the device is cleared when a profile loads', oldLog === null,
    oldLog === null ? '' : `expected tfm.v1.chat.reports to be removed by onStateLoaded; received: ${oldLog}`);
} catch (e) {
  check('client scenario ran', false, e?.message || String(e));
} finally {
  await browser.close();
}
if (errors.length) check('no page errors', false, errors.slice(0, 3).join(' | ').slice(0, 600));
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\x1b[31m${failed} of ${results.length} checks failed\x1b[0m` : `\x1b[32mall ${results.length} checks passed\x1b[0m`);
process.exit(failed ? 1 : 0);
