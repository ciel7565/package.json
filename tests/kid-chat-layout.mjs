#!/usr/bin/env node
// =============================================================================
// tests/kid-chat-layout.mjs — 쉬운 모드 💬 친구에게 말해요 on phones (60-social openKidChat)
//
//   node tests/kid-chat-layout.mjs [--file dist/metaverse/index.html]
//
// A pre-reader talks with the emoji row: on a phone every emoji must be tappable as soon as the window opens
// (no scrolling first). Prints PASS/FAIL per check, exit code 1 on any failure.
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
/** the game in 쉬운 모드 on a phone, three big bubbles in the recent box, the kid chat window open */
async function openKidChat(w, h, label) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${String(e?.stack || e)}`));
  await page.goto(pathToFileURL(file).href + '?autostart=1&notutorial=1&nointro=1&quality=low', { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.G?.ready === true && G.state, null, { timeout: 600000, polling: 250 });
  await page.evaluate(() => {
    G.setSetting('easyMode', true);
    const S = G.sys.social;
    for (const t of ['안녕! 같이 놀자!', '된장 만들러 가요!', '좋아요! 😊']) S._push({ name: '이웃친구', kind: 'visitor', text: t, channel: 'all', near: true });
    S.openKidChat();
  });
  await page.waitForSelector('.skc .skc-emo', { timeout: 20000 });
  await page.waitForTimeout(800); // the card's opening motion
  return { ctx, page };
}
/** where the scrolling body of the card shows content, and where each emoji / picture tab sits */
const measure = (page) => page.evaluate(() => {
  const body = document.querySelector('.skc').closest('.modal-body') || document.querySelector('.skc').parentElement;
  const b = body.getBoundingClientRect();
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  return {
    visible: [Math.round(Math.max(b.top, 0)), Math.round(Math.min(b.bottom, innerHeight))], scrollTop: body.scrollTop,
    emo: [...document.querySelectorAll('.skc-emo')].map(rect), cats: [...document.querySelectorAll('.skc-cat')].map(rect),
  };
});

try {
  const { ctx, page } = await openKidChat(844, 390, 'sideways phone 844x390');
  const m = await measure(page);
  const [vt, vb] = m.visible;
  const hiddenEmo = m.emo.filter((r) => r.top < vt - 1 || r.bottom > vb + 1).length;
  check('sideways phone 844x390: every emoji can be tapped as soon as the window opens (no scrolling first)', !hiddenEmo && m.scrollTop === 0,
    hiddenEmo ? `expected all ${m.emo.length} .skc-emo inside the visible body ${vt}–${vb}; ${hiddenEmo} are cut or below the fold (last: ${JSON.stringify(m.emo.slice(-2))})` : '');
  const sliced = m.cats.filter((r) => r.top < vb - 1 && r.bottom > vb + 1).length;
  check('sideways phone 844x390: no picture tab is sliced through by the card edge', !sliced,
    sliced ? `expected each .skc-cat fully visible or fully below ${vb}; ${sliced} cut (${JSON.stringify(m.cats[0])})` : '');
  // a real touch on the first emoji sends it (no dead tap)
  const mine = () => page.evaluate(() => G.sys.social.messages.filter((x) => x.self).length);
  const before = await mine();
  const box = await page.locator('.skc-emo').first().boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const after = await mine();
  check('sideways phone 844x390: a tap on the first emoji sends it', after === before + 1, after === before + 1 ? '' : `expected one more line of mine; ${before} → ${after}`);
  await ctx.close();

  // upright: the second emoji row was half cut by the bottom of the card
  const up = await openKidChat(390, 844, 'upright phone 390x844');
  const u = await measure(up.page);
  const hiddenUp = u.emo.filter((r) => r.top < u.visible[0] - 1 || r.bottom > u.visible[1] + 1).length;
  check('upright phone 390x844: every emoji can be tapped as soon as the window opens (no scrolling first)', !hiddenUp && u.scrollTop === 0,
    hiddenUp ? `expected all ${u.emo.length} .skc-emo inside the visible body ${u.visible.join('–')}; ${hiddenUp} are cut or below the fold (last: ${JSON.stringify(u.emo.slice(-2))})` : '');
  await up.ctx.close();
} catch (e) {
  check('kid chat layout scenario ran', false, e?.message || String(e));
} finally {
  await browser.close();
}
if (errors.length) check('no page errors', false, errors.slice(0, 3).join(' | ').slice(0, 600));
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\x1b[31m${failed} of ${results.length} checks failed\x1b[0m` : `\x1b[32mall ${results.length} checks passed\x1b[0m`);
process.exit(failed ? 1 : 0);
