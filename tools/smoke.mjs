#!/usr/bin/env node
// =============================================================================
// Headless smoke / screenshot runner (Playwright + SwiftShader WebGL).
//
//   node tools/smoke.mjs --file dist/metaverse/index.html
//        [--params "autostart=1&quality=low"]   query string appended to the file URL
//        [--viewport 1600x900] [--mobile]        (mobile = touch + DPR 2 emulation)
//        [--wait 4000]                           extra ms after G.ready before screenshots
//        [--timeout 90000]                       max ms to wait for G.ready
//        [--shot out.png]                        screenshot after load
//        [--eval "return G.sys.player.position"] JS (function body) evaluated in page, result printed
//        [--script steps.mjs]                    ESM module: export default async (page, ctx) => {...}
//        [--url http://127.0.0.1:8080/]          use a URL instead of --file (server mode tests)
//        [--json]                                print only the JSON report
//
// Exit code 1 when page errors / console errors / fragment or system errors happened, when G.ready never set, or
// when --eval / --script threw (a failed assertion in a step script fails the run; its message is in the report).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };

const file = opt('--file', path.join(ROOT, 'dist/metaverse/index.html'));
const url = opt('--url');
const params = opt('--params', 'autostart=1&quality=low');
const [vw, vh] = (opt('--viewport', '1600x900')).split('x').map(Number);
const mobile = flag('--mobile');
const extraWait = Number(opt('--wait', '3000'));
const timeout = Number(opt('--timeout', '120000'));
const shot = opt('--shot');
const evalSrc = opt('--eval');
const script = opt('--script');
const jsonOnly = flag('--json');

const target = url ? url + (params ? (url.includes('?') ? '&' : '?') + params : '')
  : pathToFileURL(path.resolve(file)).href + (params ? '?' + params : '');

const report = { target, ready: false, loadMs: null, pageErrors: [], consoleErrors: [], consoleWarnings: [], fragmentErrors: [], systemErrors: [], evalResult: undefined, scriptResult: undefined, shots: [] };

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});
const page = await context.newPage();
// Offline: block external network (fonts CDN etc.) except the --url origin.
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  if (url && u.startsWith(new URL(url).origin)) return route.continue();
  return route.abort();
});
page.on('pageerror', (e) => report.pageErrors.push(String(e && e.stack || e)));
page.on('console', (m) => {
  const t = m.type();
  const text = m.text();
  if (t === 'error') {
    if (/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(text)) return; // blocked external requests
    report.consoleErrors.push(text);
  } else if (t === 'warning') report.consoleWarnings.push(text);
  if (!jsonOnly && (t === 'error' || /^\[(TEST|SMOKE)\]/.test(text))) console.log(`  [console.${t}] ${text}`);
});

const t0 = Date.now();
await page.goto(target, { waitUntil: 'load', timeout });
try {
  await page.waitForFunction(() => window.G && window.G.ready === true, null, { timeout, polling: 250 });
  report.ready = true;
  report.loadMs = Date.now() - t0;
} catch {
  report.ready = false;
}
await page.waitForTimeout(extraWait);

const ctx = { ROOT, report, opt, flag, shotDir: shot ? path.dirname(path.resolve(shot)) : path.join(ROOT, 'test-output') };
const failed = []; // '--eval' / '--script' when they threw (a returned {error} value is data, not a failure)
if (evalSrc) {
  try { report.evalResult = await page.evaluate(new Function(`return (async () => { ${evalSrc} })()`)); }
  catch (e) { report.evalResult = { error: String(e) }; failed.push('--eval'); }
}
if (script) {
  try {
    const mod = await import(pathToFileURL(path.resolve(script)).href);
    report.scriptResult = await mod.default(page, ctx);
  } catch (e) { report.scriptResult = { error: String(e && e.stack || e) }; failed.push('--script'); }
}
if (shot) {
  fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
  await page.screenshot({ path: shot });
  report.shots.push(shot);
}
try {
  const info = await page.evaluate(() => ({
    fragmentErrors: (window.G && window.G.__fragmentErrors) || [],
    systemErrors: (window.G && window.G.__systemErrors) || [],
    fps: window.G && window.G.sys && window.G.sys.engine ? Math.round(window.G.sys.engine.fps || 0) : null,
    systems: window.G && window.G.sys ? Object.keys(window.G.sys) : [],
  }));
  Object.assign(report, info);
} catch (e) { report.pageErrors.push('evaluate failed: ' + e); }

await browser.close();
const bad = !report.ready || report.pageErrors.length || report.consoleErrors.length || report.fragmentErrors.length || report.systemErrors.length || failed.length;
if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  console.log(JSON.stringify({ ...report, consoleWarnings: report.consoleWarnings.slice(0, 15), consoleWarningCount: report.consoleWarnings.length }, null, 2));
  console.log(bad ? `✖ SMOKE FAILED${failed.length ? ` (${failed.join(' and ')} threw)` : ''}` : '✔ SMOKE OK');
}
process.exit(bad ? 1 : 0);
