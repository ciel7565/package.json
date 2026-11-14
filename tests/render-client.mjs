#!/usr/bin/env node
// =============================================================================
// tests/render-client.mjs — phase 8 rendering in the built page (CONTRACT §16.0 – §16.2): the embedded asset pack at
// run time, the photographed materials, the frame budgets.
//
//   node tests/render-client.mjs                        builds a private page WITH the pack (tools/build.mjs --no-font --out <tmp>)
//   node tests/render-client.mjs --file /abs/page.html  test an already built page (it must embed the pack)
//   options: --presets low,medium,high (default all three) · --viewport 960x540 · --settle <ms> (after a teleport, 6000)
//            --shots <dir> (saves the frames it looked at as PNG) · --context-loss (medium: lose + restore the GL context)
//            --keep (leave the temp build) · --json · --headed · --timeout <ms> (one page load, default 420000)
//
// Per preset one fresh page (?autostart=1&notutorial=1&quality=<preset>):
//   every preset   the page gets ready with 0 page errors, 0 console errors, no fragment / system errors, no GL error;
//                  less than 2 % of a daylight frame is black (max channel < 6/255)
//   low            the pack is in the page but nothing is decoded and no material carries a pack texture; the terrain is
//                  the plain one (no splat attribute), no bucket was shaded (vertex AO is medium / high only)
//   medium, high   the page starts with ?packhold=1: every pack texture is a 1×1 placeholder and the frame is flat →
//                  G.pack.hold(false) → everything decoded, none failed, every texture swapped; the materials with pack
//                  maps use the same shader programs before and after (same number, none changed), and the frame
//                  gained detail (the images really reached the GPU)
//   high           the five fixed day views (만장대, plaza, 장독대, hanok village, river): colour pass ≤ 450 draw calls;
//                  the whole frame (all passes) ≤ HEAD e96ad76 + 15 % in draw calls and triangles (§16.0)
// Software WebGL is slow: one run takes several minutes. Run it through the browser wrapper when other suites run.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '420000'));
const SETTLE = Number(opt('--settle', '6000'));
const [VW, VH] = String(opt('--viewport', '960x540')).split('x').map(Number);
const PRESETS = String(opt('--presets', 'low,medium,high')).split(',').map((s) => s.trim()).filter((s) => ['low', 'medium', 'high'].includes(s));
const shotDir = opt('--shots') ? path.resolve(opt('--shots')) : null;
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };
if (!PRESETS.length || !(VW > 0) || !(VH > 0)) { console.error('usage: node tests/render-client.mjs [--file page.html] [--presets low,medium,high] [--viewport 960x540] [--shots dir]'); process.exit(2); }

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-render-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

// §16.0: the fixed day views and what HEAD e96ad76 measured there (whole frame: draw calls, triangles)
const PI = Math.PI;
const VIEWS = [
  { id: 'manjangdae', label: '만장대', x: 52, z: 109.4, rot: PI, head: [596, 3.1e6] },
  { id: 'plaza', label: 'plaza', x: 0, z: 14, rot: PI, head: [570, 3.3e6] },
  { id: 'jangdokdae', label: '장독대', x: 46, z: 24, rot: PI, head: [483, 3.1e6] },
  { id: 'hanok', label: 'hanok village', x: -36, z: 14, rot: -PI / 2, head: [397, 2.6e6] },
  { id: 'river', label: 'river', x: 68, z: 46, rot: PI / 2, head: [224, 2.1e6] },
];
const COLOUR_PASS_MAX = 450, OVER_HEAD = 1.15, BLACK_MAX = 0.02, DAY_HOUR = 10;
const REF_VIEW = VIEWS[3];   // close to walls, roofs, stone and ground: the frame used for the placeholder / decoded pair

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 600)}` : ''}`); };
const numbers = {};          // measured values per preset (also in --json)

// ---------------------------------------------------------------- functions that run inside the page
/** daylight, clear sky, the given spot; the camera behind the player */
const pageSetView = async ([x, z, rot, hour]) => {
  const G = window.G, r = {};
  try {
    const w = G.sys.weather; w.setLockTime(true); w.setAuto(false); w.setHour(hour);
    const ids = Object.keys((G.data && G.data.weather) || {});
    const clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0];
    if (clear) w.set(clear, { instant: true });
  } catch (e) { r.weatherError = String(e); }
  try { await G.sys.player.teleport(x, z, rot, { fade: false }); } catch (e) { r.teleportError = String(e); }
  try { G.sys.camera.behind(rot, true); G.sys.camera.snap(); } catch (e) { r.cameraError = String(e); }
  return r;
};
/** one colour-pass render (no shadow update, no post) + one full engine frame; then the pixels of that frame */
const pageMeasure = () => {
  const G = window.G, e = G.sys.engine, R = e.renderer, out = {};
  const sm = R.shadowMap, auto = sm.autoUpdate, needs = sm.needsUpdate, rt = R.getRenderTarget();
  try {
    sm.autoUpdate = false; sm.needsUpdate = false;
    R.setRenderTarget(null);
    R.info.reset();
    R.render(e.scene, e.camera);
    out.colourCalls = R.info.render.calls; out.colourTris = R.info.render.triangles;
  } finally { sm.autoUpdate = auto; sm.needsUpdate = needs; R.setRenderTarget(rt); }
  e.render({ force: true });
  out.calls = e.frameInfo.calls; out.tris = e.frameInfo.triangles;
  out.programs = R.info.programs.length; out.textures = R.info.memory.textures; out.geometries = R.info.memory.geometries;
  out.quality = e.quality;
  // the frame just drawn is still in the drawing buffer: copy it before the browser presents it
  const cv = R.domElement, c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = false;
  x.drawImage(cv, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let black = 0, grad = 0, sum = 0, n = 0;
  const w = c.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r < 6 && g < 6 && b < 6) black++;
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    sum += l; n++;
    if (p % w) { const pl = d[i - 4] * 0.299 + d[i - 3] * 0.587 + d[i - 2] * 0.114; grad += Math.abs(l - pl); }
  }
  out.black = n ? black / n : 1; out.mean = n ? sum / n : 0; out.detail = n ? grad / n : 0;
  out.size = [c.width, c.height];
  out.glError = R.getContext().getError();
  return out;
};
/** what the pack / the materials / the terrain look like right now */
const pageState = () => {
  const G = window.G, e = G.sys.engine, R = e.renderer, out = {};
  const packTex = (m) => {
    const list = [];
    for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k] && m[k].userData && m[k].userData.pack) list.push(m[k]);
    for (const key of ['gm', 'tf']) { const U = m.userData && m.userData[key]; if (U) for (const u of Object.values(U)) if (u && u.value && u.value.isTexture && u.value.userData && u.value.userData.pack) list.push(u.value); }
    return list;
  };
  const mats = new Set();
  e.scene.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []); for (const m of ms) mats.add(m); });
  for (const a of (G.mat ? G.mat.applied : [])) mats.add(a.material);
  if (G.sys.terrain && G.sys.terrain.material) mats.add(G.sys.terrain.material);
  let withPack = 0, tex = 0, placeholder = 0, ready = 0, failed = 0; const prog = {};
  for (const m of mats) {
    const ts = packTex(m);
    if (!ts.length) continue;
    withPack++;
    for (const t of ts) {
      tex++;
      const img = t.image, one = !img || (img.width || 1) <= 1;
      if (t.userData.pack.failed) failed++;
      if (t.userData.pack.ready && !one) ready++; else if (one) placeholder++;
    }
    const p = R.properties.get(m).currentProgram;
    if (p) prog[m.uuid] = p.id;
  }
  out.pack = G.pack ? { ...G.pack.stats, count: G.pack.count } : null;
  out.build = (window.__BUILD__ && window.__BUILD__.pack) || null;
  out.applied = G.mat ? G.mat.applied.length : 0;
  out.withPack = withPack; out.tex = tex; out.placeholder = placeholder; out.ready = ready; out.failed = failed; out.prog = prog;
  out.programs = R.info.programs.length;
  out.terrain = { type: G.sys.terrain.material && G.sys.terrain.material.type, splat: !!(G.sys.terrain.meshes.core && G.sys.terrain.meshes.core.geometry.attributes.aSplat) };
  out.ao = G.bkit && G.bkit.aoStats ? { ...G.bkit.aoStats } : null;
  out.quality = e.quality;
  return out;
};

// ---------------------------------------------------------------- one preset
const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--disable-web-security'] });

async function runPreset(preset) {
  const hold = preset !== 'low';
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) return; consoleErrors.push(t.slice(0, 300)); });
  const N = (numbers[preset] = {});
  const tag = `[${preset}]`;
  const shot = async (name) => { if (shotDir) { try { await page.screenshot({ path: path.join(shotDir, `render-${preset}-${name}.png`), timeout: 300000 }); } catch (e) { log(`  (screenshot ${name} failed: ${String(e).slice(0, 120)})`); } } };
  const view = async (v, hour = DAY_HOUR) => { const r = await page.evaluate(pageSetView, [v.x, v.z, v.rot, hour]); await page.waitForTimeout(SETTLE); return r; };
  try {
    log(`🎨 ${tag} ${file}`);
    const t0 = Date.now();
    await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${preset}${hold ? '&packhold=1' : ''}`, { waitUntil: 'load', timeout: TIMEOUT });
    await page.waitForFunction(() => window.G && window.G.ready === true, null, { timeout: TIMEOUT, polling: 250 });
    N.loadMs = Date.now() - t0;
    await page.evaluate(() => { try { window.G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
    if (shotDir) {
      await page.evaluate(() => { try { window.G.ui.setHudVisible(false); } catch (e) { /* no HUD */ } });
      await page.addStyleTag({ content: '#hud, .hud, .easy-coach, .zone-banner, .toast-wrap, .companion-card, [class*="banner"], [class*="coach"] { visibility: hidden !important; }' });
    }
    const s0 = await page.evaluate(pageState);
    check(`${tag} the page is ready at quality ${preset}`, s0.quality === preset, `quality ${s0.quality}, ready after ${N.loadMs} ms`);
    if (!s0.pack || !s0.pack.count) { check(`${tag} the page embeds the asset pack`, false, 'G.pack.count is 0 — was the page built with --no-assets?'); return; }
    check(`${tag} the page embeds the asset pack`, true, `${s0.pack.count} files, ${s0.pack.bytes} B`);

    await view(REF_VIEW);
    if (preset === 'low') {
      const m = await page.evaluate(pageMeasure);
      const s = await page.evaluate(pageState);
      N.frame = { calls: m.calls, tris: m.tris, colourCalls: m.colourCalls, black: m.black, programs: m.programs, textures: m.textures };
      await shot(REF_VIEW.id);
      check(`${tag} nothing of the pack is decoded`, s.pack.decoded === 0 && s.pack.decoding === 0 && s.pack.failed === 0, JSON.stringify({ decoded: s.pack.decoded, decoding: s.pack.decoding, queued: s.pack.queued }));
      check(`${tag} no material carries a pack texture (G.mat applied to none)`, s.applied === 0 && s.withPack === 0 && s.tex === 0, JSON.stringify({ applied: s.applied, materials: s.withPack, textures: s.tex }));
      check(`${tag} the terrain is the plain one (no splat attribute)`, s.terrain.type === 'MeshLambertMaterial' && s.terrain.splat === false, JSON.stringify(s.terrain));
      check(`${tag} no bucket was shaded (vertex AO is medium / high only)`, !s.ao || (s.ao.buckets === 0 && s.ao.added === 0), JSON.stringify(s.ao));
      check(`${tag} daylight frame: less than 2 % black`, m.black < BLACK_MAX, `${(m.black * 100).toFixed(2)} % of ${m.size.join('×')}`);
      check(`${tag} no GL error`, m.glError === 0, String(m.glError));
    } else {
      // ---- placeholders first
      const before = await page.evaluate(pageMeasure);
      const sb = await page.evaluate(pageState);
      await shot(`${REF_VIEW.id}-placeholders`);
      check(`${tag} materials got their pack maps when they were created`, sb.applied > 0 && sb.withPack > 0 && sb.tex > 0, JSON.stringify({ applied: sb.applied, materials: sb.withPack, textures: sb.tex }));
      check(`${tag} the photographed terrain is on (MeshStandardMaterial + splat attribute)`, sb.terrain.type === 'MeshStandardMaterial' && sb.terrain.splat === true, JSON.stringify(sb.terrain));
      check(`${tag} while held every pack texture is a 1×1 placeholder`, sb.pack.held === true && sb.placeholder === sb.tex && sb.ready === 0, JSON.stringify({ held: sb.pack.held, textures: sb.tex, placeholders: sb.placeholder, ready: sb.ready, decoded: sb.pack.decoded }));
      check(`${tag} placeholder frame: less than 2 % black`, before.black < BLACK_MAX, `${(before.black * 100).toFixed(2)} %`);
      // ---- decoded later
      // software GL with two browsers on four CPUs needs up to ~10 minutes for the whole queue at high (one decode
      // ≈ 15 s there); on a real GPU it is a few seconds. Wait for idle, or until the stats show nothing left.
      const DECODE_WAIT = Math.max(600000, TIMEOUT);
      const dec = await page.evaluate(async (limit) => {
        const P = window.G.pack, t0 = performance.now();
        P.hold(false);
        const left = () => P.stats.queued + P.stats.decoding;
        await Promise.race([P.idle(), new Promise((r) => setTimeout(r, limit)), new Promise((r) => {
          const tick = () => (left() === 0 && P.stats.decoded > 0 ? r() : setTimeout(tick, 2000)); setTimeout(tick, 2000);
        })]);
        return { ms: Math.round(performance.now() - t0), ...P.stats };
      }, DECODE_WAIT);
      await page.waitForTimeout(Math.max(1500, SETTLE / 3));
      const after = await page.evaluate(pageMeasure);
      const sa = await page.evaluate(pageState);
      await shot(REF_VIEW.id);
      N.decode = { ms: dec.ms, decoded: dec.decoded, failed: dec.failed, decodeMs: Math.round(dec.decodeMs) };
      N.pair = { programsBefore: before.programs, programsAfter: after.programs, detailBefore: +before.detail.toFixed(3), detailAfter: +after.detail.toFixed(3), blackAfter: after.black, texturesBefore: before.textures, texturesAfter: after.textures };
      check(`${tag} after G.pack.hold(false) everything is decoded, nothing failed`, dec.decoded > 0 && dec.failed === 0 && dec.queued === 0 && dec.decoding === 0, JSON.stringify({ decoded: dec.decoded, failed: dec.failed, queued: dec.queued, waitedMs: dec.ms }));
      check(`${tag} every pack texture was swapped for its image`, sa.ready === sa.tex && sa.placeholder === 0 && sa.failed === 0, JSON.stringify({ textures: sa.tex, ready: sa.ready, placeholders: sa.placeholder, failed: sa.failed }));
      // the materials that carry pack maps: the same programs before and after (the swap of an image compiles nothing).
      // The renderer's total is reported too; it may grow by programs of things that walked into view meanwhile.
      const seen = Object.keys(sb.prog).filter((id) => sa.prog[id] !== undefined);
      const changed = seen.filter((id) => sa.prog[id] !== sb.prog[id]);
      const nb = new Set(seen.map((id) => sb.prog[id])).size, na = new Set(seen.map((id) => sa.prog[id])).size;
      check(`${tag} the number of shader programs of the materials with pack maps is the same before and after decoding`, seen.length > 0 && nb === na, `${nb} → ${na} programs for ${seen.length} materials (whole renderer: ${before.programs} → ${after.programs})`);
      check(`${tag} no material with pack maps changed its program`, changed.length === 0 && seen.length > 0, `${seen.length} rendered materials compared, ${changed.length} changed`);
      check(`${tag} the decoded frame has more detail than the placeholder frame (the images reached the GPU)`, after.detail > before.detail * 1.05, `mean neighbour difference ${before.detail.toFixed(3)} → ${after.detail.toFixed(3)}`);
      check(`${tag} daylight frame: less than 2 % black`, after.black < BLACK_MAX, `${(after.black * 100).toFixed(2)} % of ${after.size.join('×')}`);
      check(`${tag} no GL error`, before.glError === 0 && after.glError === 0, `${before.glError} / ${after.glError}`);
      check(`${tag} vertex AO was baked into the buckets`, !!sa.ao && sa.ao.buckets > 0, JSON.stringify(sa.ao));
      N.frame = { calls: after.calls, tris: after.tris, colourCalls: after.colourCalls, black: after.black, programs: after.programs, textures: after.textures };

      if (preset === 'high') {
        // ---- §16.0 budgets at the five fixed day views
        N.views = {};
        for (const v of VIEWS) {
          await view(v);
          const m = await page.evaluate(pageMeasure);
          await shot(v.id);
          N.views[v.id] = { colourCalls: m.colourCalls, calls: m.calls, tris: m.tris, black: +m.black.toFixed(4) };
          const maxCalls = Math.floor(v.head[0] * OVER_HEAD), maxTris = Math.floor(v.head[1] * OVER_HEAD);
          check(`${tag} ${v.label}: colour pass ≤ ${COLOUR_PASS_MAX} draw calls`, m.colourCalls <= COLOUR_PASS_MAX, `${m.colourCalls}`);
          check(`${tag} ${v.label}: whole frame ≤ ${maxCalls} draw calls (HEAD ${v.head[0]} + 15 %)`, m.calls <= maxCalls, `${m.calls}`);
          check(`${tag} ${v.label}: whole frame ≤ ${(maxTris / 1e6).toFixed(2)} M triangles (HEAD ${(v.head[1] / 1e6).toFixed(1)} M + 15 %)`, m.tris <= maxTris, `${(m.tris / 1e6).toFixed(2)} M`);
          check(`${tag} ${v.label}: less than 2 % black`, m.black < BLACK_MAX, `${(m.black * 100).toFixed(2)} %`);
        }
        if (shotDir) { await view(VIEWS[1], 21); await shot('night'); }
      }

      if (preset === 'medium' && flag('--context-loss')) {
        // ---- the GL context goes away and comes back: three re-uploads the decoded images (they stay referenced)
        await view(REF_VIEW);
        const lost = await page.evaluate(async () => {
          const R = window.G.sys.engine.renderer, gl = R.getContext(), ext = gl.getExtension('WEBGL_lose_context');
          if (!ext) return { skipped: true };
          ext.loseContext();
          await new Promise((r) => setTimeout(r, 1500));
          ext.restoreContext();
          const t0 = performance.now();
          while (performance.now() - t0 < 120000) { await new Promise((r) => setTimeout(r, 500)); if (!gl.isContextLost() && !window.G.sys.engine._isLost()) break; }
          return { lost: gl.isContextLost(), ms: Math.round(performance.now() - t0) };
        });
        if (lost.skipped) check(`${tag} context loss`, true, 'WEBGL_lose_context is not available: skipped');
        else {
          await page.waitForTimeout(SETTLE);
          const m = await page.evaluate(pageMeasure);
          await shot(`${REF_VIEW.id}-restored`);
          N.restored = { detail: +m.detail.toFixed(3), black: m.black, ms: lost.ms };
          check(`${tag} after a lost and restored GL context the frame is back with its textures`, !lost.lost && m.black < BLACK_MAX && m.detail > before.detail * 1.05, `detail ${m.detail.toFixed(3)} (placeholders ${before.detail.toFixed(3)}, decoded ${after.detail.toFixed(3)}), black ${(m.black * 100).toFixed(2)} %`);
        }
      }
    }
    const errs = await page.evaluate(() => ({ fragment: (window.G && window.G.__fragmentErrors) || [], system: (window.G && window.G.__systemErrors) || [] }));
    check(`${tag} no page errors`, pageErrors.length === 0, pageErrors.join(' | '));
    check(`${tag} no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
    check(`${tag} no fragment / system errors`, errs.fragment.length === 0 && errs.system.length === 0, JSON.stringify(errs).slice(0, 400));
  } catch (e) {
    check(`${tag} test run`, false, String(e?.stack || e));
  } finally {
    await context.close();
  }
}

try {
  for (const p of PRESETS) await runPreset(p);
  if (PRESETS.includes('high') && numbers.high && !numbers.high.views) check('[high] the five fixed views were measured', false, 'the high run stopped before the budget views');
} finally {
  await browser.close();
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, numbers, results }, null, 2));
else {
  for (const [p, n] of Object.entries(numbers)) log(`   ${p}: ${JSON.stringify(n)}`);
  console.log(`\n${failed.length ? '✖' : '✔'} render-client: ${results.length - failed.length}/${results.length} passed`);
}
process.exit(failed.length ? 1 : 0);
