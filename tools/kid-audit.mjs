#!/usr/bin/env node
// =============================================================================
// 👶 kid-audit — headless "can a 5-year-old use every screen?" check (CONTRACT §12)
//
//   node tools/kid-audit.mjs                                  audit dist/metaverse/index.html in easy mode (1366×768)
//   node tools/kid-audit.mjs --file /abs/game.html --mobile   phone viewport 390×844 with touch
//   options:
//     --file <html>        built game (default dist/metaverse/index.html)
//     --viewport WxH       default 1366x768 (--mobile: 390x844, touch, DPR 2)
//     --both               desktop AND mobile in one run
//     --normal             audit normal (grown-up) mode instead of easy mode
//     --screens a,b,c      only these screens (ids: hud bag shop sticker today quest journal edu lesson quiz map
//                          emote chat avatar menu settings help photo)
//     --out <base>         also write <base>.json and <base>.md (default: no files)
//     --strict             exit 1 on warnings too (default: only on critical)
//     --json               print only the JSON report
//     --timeout <ms>       max wait for G.ready (default 300000 — headless WebGL is software)
//
// How it works: opens the game (file://, quality=low, autostart=1&notutorial=1), switches easy mode on, then calls
// the developer center's public audit API — G.sys.devcenter.kidTour() — which opens every main screen through the
// modules' public APIs (screens whose API is missing are skipped with a note), waits for enter animations and audits
// what is on screen: tap-target size against var(--tap), free-text inputs, error words (NaN/undefined), dead-end
// dialogs, missing names/pictures, long labels, fixed-HUD overlaps, WCAG AA contrast, text size, >3 Hz flashing,
// speakable prompts. The same audit is the 👶 tab of the developer center (F9 / Ctrl+Shift+D).
//
// Exit codes: 0 = no critical problem · 1 = critical problems (free-text input in easy mode, tap target < 44 px,
// error text on screen, a dialog without any button), page errors (uncaught exceptions while the game ran) or
// --strict warnings · 2 = could not run (no build, no
// devcenter, G.ready timeout).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요: npm install (devDependencies) 후 다시 실행해 주세요.'); process.exit(2); }
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const file = path.resolve(opt('--file', path.join(ROOT, 'dist/metaverse/index.html')));
const jsonOnly = flag('--json');
const strict = flag('--strict');
const normal = flag('--normal');
const timeout = Number(opt('--timeout', '300000'));
const outBase = opt('--out');
const screens = opt('--screens') ? opt('--screens').split(',').map((s) => s.trim()).filter(Boolean) : null;
const log = (...a) => { if (!jsonOnly) console.log(...a); };

if (!fs.existsSync(file)) {
  console.error(`빌드된 게임이 없어요: ${file}\n먼저 "node tools/build.mjs" (또는 --out 으로 만든 파일을 --file 로) 실행해 주세요.`);
  process.exit(2);
}

const runs = [];
if (flag('--both')) runs.push({ name: 'desktop', vw: 1366, vh: 768, mobile: false }, { name: 'mobile', vw: 390, vh: 844, mobile: true });
else if (flag('--mobile')) {
  const [w, h] = (opt('--viewport', '390x844')).split('x').map(Number);
  runs.push({ name: 'mobile', vw: w, vh: h, mobile: true });
} else {
  const [w, h] = (opt('--viewport', '1366x768')).split('x').map(Number);
  runs.push({ name: 'desktop', vw: w, vh: h, mobile: false });
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const report = { tool: 'kid-audit', file, mode: normal ? 'normal' : 'easy', startedAt: new Date().toISOString(), runs: [] };
let exitCode = 0;

try {
  for (const run of runs) {
    log(`\n👶 ${run.name} ${run.vw}×${run.vh}${run.mobile ? ' (touch)' : ''} · ${normal ? '보통 모드' : '쉬운 모드'} — 게임을 여는 중…`);
    const context = await browser.newContext({ viewport: { width: run.vw, height: run.vh }, deviceScaleFactor: run.mobile ? 2 : 1, isMobile: run.mobile, hasTouch: run.mobile, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await context.newPage();
    // offline: the build is self-contained (CSP blocks other origins anyway)
    await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
    const t0 = Date.now();
    const result = { ...run, ready: false, loadMs: null, pageErrors, tour: null, error: null };
    report.runs.push(result);
    try {
      await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low`, { waitUntil: 'load', timeout });
      await page.waitForFunction(() => window.G && window.G.ready === true, null, { timeout, polling: 250 });
      result.ready = true;
      result.loadMs = Date.now() - t0;
    } catch (e) {
      result.error = `G.ready 를 기다리다 시간이 지났어요 (${timeout} ms)`;
      exitCode = Math.max(exitCode, 2);
      await context.close();
      continue;
    }
    const api = await page.evaluate(() => ({ dc: typeof window.G?.sys?.devcenter?.kidTour === 'function', easy: !!window.G?.easy, screens: window.G?.sys?.devcenter?.kidScreens?.() || [] }));
    if (!api.dc) {
      result.error = '개발자 센터(G.sys.devcenter.kidTour)가 없어요 — 80-devcenter.js 가 빌드에 들어갔는지 확인해 주세요';
      exitCode = Math.max(exitCode, 2);
      await context.close();
      continue;
    }
    // the mode under test (G.easy.set when present, else the raw setting), then let the HUD settle
    await page.evaluate(async (wantEasy) => {
      // turning easy mode OFF through G.easy.set asks the parent gate (a UX barrier for children, not for this tool)
      if (wantEasy && typeof G.easy?.set === 'function') await Promise.race([G.easy.set(true), new Promise((r) => setTimeout(r, 1500))]);
      else { G.setSetting?.('easyMode', wantEasy); G.applySettingsToDom?.(); }
      G.ui?.modal?.closeAll?.();
      await new Promise((r) => setTimeout(r, 900));
    }, !normal);
    log(`  준비 ${(result.loadMs / 1000).toFixed(1)}초 · G.easy ${api.easy ? '있음' : '없음'} · 화면 ${api.screens.filter((s) => s.available).length}/${api.screens.length}개 열 수 있음 — 점검 시작`);
    const tour = await page.evaluate(async (ids) => {
      const r = await G.sys.devcenter.kidTour(ids ? { screens: ids } : {});
      return r;
    }, screens);
    result.tour = tour;
    result.easyStatus = await page.evaluate(() => G.sys.devcenter.easyStatus?.() || null);
    await context.close();
    const crit = tour.totals.critical, warn = tour.totals.warn;
    // a game that throws while a child plays is not "OK", even when every screen looked fine
    if (crit > 0 || pageErrors.length || (strict && warn > 0)) exitCode = Math.max(exitCode, 1);
    log(`  끝 (${(tour.ms / 1000).toFixed(1)}초): 화면 ${tour.totals.screens}개 · 건너뜀 ${tour.totals.skipped} · ⛔ ${crit} · ⚠️ ${warn} · 💡 ${tour.totals.info}${pageErrors.length ? ` · 🐞 페이지 오류 ${pageErrors.length}` : ''}`);
  }
} finally {
  await browser.close();
}

// ------------------------------------------------------------------ markdown
const KIND = { freetext: '⌨️ 글자 입력칸', tap: '👆 누르기 크기', errtext: '🐞 오류 글자', exit: '🚪 나가기 버튼', name: '🏷️ 이름·그림', label: '🔤 긴 버튼 글자', overlap: '🧱 HUD 겹침', contrast: '🌗 글자 대비', fontsize: '🔠 작은 글자', flash: '⚡ 깜빡임', speak: '🔊 읽어주기', focus: '🎯 한 가지 행동', hanja: '🈶 한자', gate: '🔒 보호자 확인' };
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').slice(0, 160);
function markdown() {
  const L = [`# 👶 쉬운 모드 화면 점검 (kid-audit)`, '', `- 파일: \`${cell(path.relative(ROOT, file) || file)}\``, `- 모드: ${normal ? '보통 모드' : '쉬운 모드'} · ${report.startedAt}`, ''];
  for (const run of report.runs) {
    L.push(`## ${run.name === 'mobile' ? '📱' : '🖥️'} ${run.name} ${run.vw}×${run.vh}`, '');
    if (run.error) { L.push(`⛔ ${run.error}`, ''); continue; }
    const t = run.tour;
    L.push(`화면 ${t.totals.screens}개 · 건너뜀 ${t.totals.skipped} · 실패 ${t.totals.failed} · ⛔ 치명 **${t.totals.critical}** · ⚠️ 경고 ${t.totals.warn} · 💡 참고 ${t.totals.info}${run.pageErrors.length ? ` · 🐞 페이지 오류 **${run.pageErrors.length}**` : ''} · ${(t.ms / 1000).toFixed(1)}초`, '');
    L.push('| 화면 | 상태 | ⛔ | ⚠️ | 💡 | 점수 | 먼저 볼 문제 |', '|---|---|---|---|---|---|---|');
    for (const r of t.rows) {
      const a = r.audit;
      const top = a?.items?.find((x) => x.sev === 'critical') || a?.items?.[0];
      L.push(`| ${r.emoji} ${cell(r.label)} | ${r.status === 'ok' ? '✅' : r.status === 'skip' ? `⏭️ ${cell(r.note)}` : `⛔ ${cell(r.note)}`} | ${a ? a.counts.critical : '-'} | ${a ? a.counts.warn : '-'} | ${a ? a.counts.info : '-'} | ${a ? a.score : '-'} | ${top ? `${KIND[top.kind] || top.kind}: ${cell(top.detail)}` : ''} |`);
    }
    const crit = t.rows.flatMap((r) => (r.audit?.items || []).filter((x) => x.sev === 'critical').map((x) => ({ screen: `${r.emoji} ${r.label}`, ...x })));
    if (crit.length) {
      L.push('', `### ⛔ 치명 ${crit.length}건 (고쳐야 아이가 쓸 수 있어요)`, '', '| 화면 | 종류 | 내용 | 글자 | 위치(선택자) |', '|---|---|---|---|---|');
      for (const x of crit.slice(0, 200)) L.push(`| ${cell(x.screen)} | ${KIND[x.kind] || x.kind} | ${cell(x.detail)} | ${cell(x.text)} | \`${cell(x.sel)}\` |`);
    }
    const byKind = {};
    for (const r of t.rows) for (const x of r.audit?.items || []) if (x.sev === 'warn') byKind[x.kind] = (byKind[x.kind] || 0) + 1;
    if (Object.keys(byKind).length) { L.push('', '### ⚠️ 경고 종류별', ''); for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) L.push(`- ${KIND[k] || k}: ${n}건`); }
    if (run.pageErrors.length) { L.push('', `### 🐞 페이지 오류 ${run.pageErrors.length}건 (실행 중 오류 — exit 1)`, ''); for (const e of run.pageErrors.slice(0, 10)) L.push(`- ${cell(e)}`); }
    L.push('');
  }
  L.push('---', '', '치명 = 쉬운 모드의 글자 입력칸 · 44 px 미만 누르기 · 화면의 오류 글자(NaN/undefined) · 버튼 없는 창. 페이지 오류(잡히지 않은 예외)도 exit 1 이에요. 개발자 센터(F9) › 👶 쉬운 모드 점검 탭에서 "👀 보기" 로 위치를 확인할 수 있어요.');
  return L.join('\n');
}

const md = markdown();
if (outBase) {
  const base = path.resolve(outBase);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${base}.md`, md);
  log(`\n📄 ${base}.json · ${base}.md`);
}
if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  const pageErrs = report.runs.reduce((n, r) => n + r.pageErrors.length, 0);
  const why = [report.runs.some((r) => r.tour?.totals.critical > 0) ? '⛔ 치명' : '', pageErrs ? `🐞 페이지 오류 ${pageErrs}건` : ''].filter(Boolean).join(' · ') || '--strict 경고';
  console.log(`\n${md}\n\n${exitCode === 0 ? '✔ KID AUDIT OK' : exitCode === 1 ? `✖ KID AUDIT: 문제가 있어요 (${why})` : '✖ KID AUDIT: 실행하지 못했어요'}`);
}
process.exit(exitCode);
