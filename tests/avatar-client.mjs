#!/usr/bin/env node
// =============================================================================
// tests/avatar-client.mjs — CONTRACT §17.7 the realistic avatar in the browser (LOCAL mode, file:// page):
//   options   every option id of every key builds on every ready-made look, in both styles, without a warning or an
//             error, with finite geometry; budgets (triangles per body, ≤ 3 draw calls per avatar, one shader program
//             for every avatar body), a style switch re-seats the skeleton
//   normalize unknown ids / colours / types fall back safely, `__proto__` is ignored, an older (phase 8) look keeps the
//             round style and moves its hat from `accessory` to `hat`, an empty look is the new default (`real`)
//   motion    walk, run, sprint, jump, flip, sit, every action, held items and a look target on the realistic body:
//             bones stay finite, the feet reach the floor, the springs (hair, skirt, 고름) settle
//   save      the player's appearance round-trips through the profile and the state's JSON; the title screen picks
//   dispose   creating and disposing 30 rigs leaves no geometry / texture / program behind (after the first build);
//             clearing the geometry cache frees every cached body
//   crowd     20 avatars together: draw calls of the colour pass; far figures draw a crowd in one call
//   editor    the customiser: six tabs, picture tiles that get drawn, a pick changes the look, ← → between tabs, arrow
//             keys between tiles, Enter picks, save keeps the new look; easy mode: big tiles that speak, 🔊, no
//             text field; a phone (390 × 844): no sideways scroll, tiles ≥ 56 px
//
//   node tests/avatar-client.mjs                       builds a private page (--no-assets) in a temp directory
//   node tests/avatar-client.mjs --file /abs/page.html test an already built page
//   options: --json · --headed · --timeout <ms> · --only <a,b> (groups: options, normalize, motion, save, dispose,
//            crowd, editor, phone)
//   Run it through the shared browser lock (at most two browsers on the build machine).
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
const TIMEOUT = Number(opt('--timeout', '300000'));
const jsonOut = flag('--json');
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const want = (g) => !only.length || only.includes(g);
const log = (...a) => { if (!jsonOut) console.log(...a); };
const BUDGET = { realTris: 30000, cuteTris: 15000, callsPerAvatar: 3 };

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-avatar-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
async function open(tag, ctxOpts, extra = '', normal = false) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 960, height: 540 }, ...ctxOpts });
  // easy mode is the default of a new visitor; the device setting below opens the page in normal mode (as tools/smoke.mjs --mode normal)
  if (normal) await context.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); s.easyMode = false; s._v = 2; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } catch (e) { /* storage blocked */ } });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low${extra}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
  return { page, context };
}

try {
  const { page, context } = await open('main', {}, '', true);
  page.setDefaultTimeout(TIMEOUT);

  // ------------------------------------------------------------------ options
  if (want('options')) {
    const r = await page.evaluate((BUDGET) => {
      const A = G.avatar, warn = [], out = { errors: [], combos: 0, maxReal: 0, maxCute: 0, nonFinite: [] };
      const ow = G.log.warn, oe = G.log.error;
      G.log.warn = (...a) => { warn.push(a.map(String).join(' ')); return ow.apply(G.log, a); };
      G.log.error = (...a) => { warn.push('E ' + a.map(String).join(' ')); return oe.apply(G.log, a); };
      try {
        for (const p of A.presets) for (const style of A.styles) {
          const base = { ...p.appearance, style };
          for (const [k, vals] of Object.entries(A.options)) {
            if (k === 'style' || String(vals[0]).startsWith('#')) continue;
            for (const v of vals) {
              const app = { ...base, [k]: v };
              try {
                const t = A.triangles(app); out.combos++;
                if (style === 'real') out.maxReal = Math.max(out.maxReal, t); else out.maxCute = Math.max(out.maxCute, t);
              } catch (e) { out.errors.push(`${p.id} ${style} ${k}=${v}: ${e.message}`); }
            }
          }
        }
        // finite positions / normals on a sample of bodies
        for (const style of A.styles) for (const p of A.presets.slice(0, 5)) {
          const rig = A.create({ ...p.appearance, style }, { shadow: false });
          const g = rig.mesh.geometry, pa = g.attributes.position.array, na = g.attributes.normal.array;
          for (let i = 0; i < pa.length; i++) if (!Number.isFinite(pa[i]) || !Number.isFinite(na[i])) { out.nonFinite.push(`${p.id}:${style}`); break; }
          rig.dispose();
        }
        // style switch on one rig
        const rig = A.create(A.presets[0].appearance, { shadow: false });
        const h0 = rig.height, y0 = rig.bone.head.position.y;
        rig.setAppearance({ ...A.presets[0].appearance, style: 'cute' });
        out.switch = { realH: h0, cuteH: rig.height, headReal: y0, headCute: rig.bone.head.position.y, style: rig.style };
        let meshes = 0; rig.group.traverse((o) => { if (o.isMesh) meshes++; });
        rig.setHeld('watering-can'); let meshesHeld = 0; rig.group.traverse((o) => { if (o.isMesh) meshesHeld++; });
        out.meshes = meshes; out.meshesHeld = meshesHeld;
        rig.dispose();
      } catch (e) { out.errors.push('fatal ' + e.stack); }
      G.log.warn = ow; G.log.error = oe;
      out.warnings = warn.filter((w) => /AVATAR|avatar/.test(w)).slice(0, 10);
      out.presets = A.presets.length; out.hair = A.options.hair.length; out.styles = A.styles;
      return out;
    }, BUDGET);
    check('every option id builds on every ready-made look in both styles', r.errors.length === 0 && r.combos > 1500, `${r.combos} bodies; ${r.errors.slice(0, 3).join(' | ')}`);
    check('no avatar warning or error while building', r.warnings.length === 0, r.warnings.join(' | '));
    check('≥ 12 ready-made looks, ≥ 12 hair styles, styles real + cute', r.presets >= 12 && r.hair >= 12 && r.styles.join() === 'real,cute', `${r.presets} looks, ${r.hair} hair styles`);
    check(`triangle budget: real ≤ ${BUDGET.realTris}, cute ≤ ${BUDGET.cuteTris} (worst combination)`, r.maxReal <= BUDGET.realTris && r.maxCute <= BUDGET.cuteTris, `real ${r.maxReal}, cute ${r.maxCute}`);
    check('geometry is finite (positions and normals)', r.nonFinite.length === 0, r.nonFinite.join(', '));
    check('a style switch re-seats the skeleton (realistic is taller, the head higher)', r.switch && r.switch.realH > 1.5 && r.switch.cuteH < 1.5 && r.switch.headReal > r.switch.headCute && r.switch.style === 'cute', JSON.stringify(r.switch));
    check(`≤ ${BUDGET.callsPerAvatar} draw calls per avatar (body + face, + a held item)`, r.meshes === 2 && r.meshesHeld <= BUDGET.callsPerAvatar, `${r.meshes} meshes, ${r.meshesHeld} with a held item`);
  }

  // ------------------------------------------------------------------ normalize
  if (want('normalize')) {
    const r = await page.evaluate(() => {
      const A = G.avatar, n = A.normalize;
      const old = { skin: '#f6d0b1', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#b45a73', shoes: '#ffffff', bag: 'pouch', bagColor: '#f4c54a', accessory: 'gat', accessoryColor: '#1f1f22', face: 'smile', height: 0.95 };
      const o = n(old);
      const evil = n(JSON.parse('{"style":"<b>","hair":"mohawk","hat":["gat"],"topColor":"red","height":"tall","__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}'));
      return {
        empty: n(null), emptyObj: n({}), old: o, evil, polluted: ({}).polluted === 1 || Object.prototype.x === 1,
        keys: Object.keys(n(null)).sort().join(), defKeys: Object.keys(A.defaultAppearance).sort().join(),
        idem: JSON.stringify(n(n(A.presets[3].appearance))) === JSON.stringify(n(A.presets[3].appearance)),
        height: [n({ style: 'real', height: 5 }).height, n({ style: 'real', height: -1 }).height, n({ style: 'real', height: true }).height],
        upper: n({ style: 'real', topColor: '#ABCDEF' }).topColor,
      };
    });
    check('an empty look is the new default: the realistic style', r.empty.style === 'real' && r.emptyObj.style === 'real' && r.keys === r.defKeys, `${r.empty.style} / ${r.emptyObj.style}`);
    check('an older (phase 8) look keeps the round style and its colours', r.old.style === 'cute' && r.old.topColor === '#f08bb0' && r.old.hair === 'bun' && r.old.footwear === 'sneakers', JSON.stringify(r.old));
    check('its 갓 moves from accessory to hat (with its colour)', r.old.hat === 'gat' && r.old.hatColor === '#1f1f22' && r.old.accessory === 'none', `hat ${r.old.hat}, accessory ${r.old.accessory}`);
    check('unknown ids / colours / types fall back to the default', r.evil.hair === r.empty.hair && r.evil.hat === r.empty.hat && r.evil.topColor === r.empty.topColor && r.evil.height === 1 && r.evil.style === 'real', JSON.stringify(r.evil));
    check('__proto__ / constructor keys do nothing', !r.polluted && !('polluted' in r.evil));
    check('normalize is idempotent; height clamps to 0.9 … 1.1; colours become lower case', r.idem && r.height.join() === '1.1,0.9,1' && r.upper === '#abcdef', `${r.height} ${r.upper}`);
  }

  // ------------------------------------------------------------------ motion
  if (want('motion')) {
    const r = await page.evaluate(() => {
      const A = G.avatar, out = { bad: [], feet: [], springs: null };
      const rig = A.create(A.presets[0].appearance, { shadow: false });
      const scene = new THREE.Scene(); scene.add(rig.group);
      const ok = () => { let b = null; rig.group.traverse((o) => { if (o.isBone) for (const v of [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z]) if (!Number.isFinite(v)) b = o.name; }); return b; };
      const footY = () => { rig.group.updateMatrixWorld(true); const v = new THREE.Vector3(); return Math.min(rig.bone.ftL.getWorldPosition(v).y, rig.bone.ftR.getWorldPosition(new THREE.Vector3()).y); };
      const steps = (n, p, mv) => { for (let i = 0; i < n; i++) { if (mv) { rig.group.position.z += (p.speed || 0) / 30; rig.group.updateMatrixWorld(true); } rig.update(1 / 30, p); } };
      for (const sp of [0, 1.5, 3.5, 7.68, 14.4, 20]) { steps(45, { speed: sp, grounded: true, vy: 0 }, true); const b = ok(); if (b) out.bad.push(`speed ${sp}: ${b}`); out.feet.push([sp, +footY().toFixed(3)]); }
      steps(10, { speed: 7, grounded: false, vy: 6 }, true); rig.flip(0.5); steps(20, { speed: 7, grounded: false, vy: -3 }, true); steps(10, { speed: 0, grounded: true, vy: -9 });
      if (ok()) out.bad.push('jump/flip');
      rig.setAnim('sit', { seatY: 0.45 }); steps(30, { speed: 0, grounded: true }); out.sitHips = +rig.bone.hips.getWorldPosition(new THREE.Vector3()).y.toFixed(3);
      rig.stopAll(); steps(15, { speed: 0, grounded: true });
      for (const a of Object.keys(A.actions)) { rig.setAnim(a, { duration: 0.8 }); steps(12, { speed: 0, grounded: true }); if (ok()) out.bad.push(a); }
      rig.setHeld('basket'); rig.setLookTarget({ x: 2, y: 1.6, z: 3 }); steps(30, { speed: 0, grounded: true }); if (ok()) out.bad.push('look');
      // springs: a hard stop after a sprint, then rest
      steps(30, { speed: 14.4, grounded: true }, true); steps(4, { speed: 0, grounded: true });
      const moved = Math.max(...Array.from(rig._spr).map(Math.abs));
      steps(150, { speed: 0, grounded: true });
      const rest = Math.max(...Array.from(rig._spr).map(Math.abs));
      out.springs = { moved: +moved.toFixed(3), rest: +rest.toFixed(4) };
      rig.dispose();
      return out;
    });
    check('walk · run · sprint · jump · flip · sit · every action · held item · look target: all bones finite', r.bad.length === 0, r.bad.join(', '));
    check('the feet reach the floor at every pace (lowest ankle ≤ 0.2 m)', r.feet.every(([, y]) => y <= 0.2 && y > -0.1), JSON.stringify(r.feet));
    check('sitting on a 0.45 m seat puts the hips at seat height', r.sitHips > 0.45 && r.sitHips < 0.75, `hips at ${r.sitHips} m`);
    check('secondary motion: the hair / skirt / 고름 springs swing on a hard stop and settle at rest', r.springs.moved > 0.02 && r.springs.rest < 0.02, JSON.stringify(r.springs));
  }

  // ------------------------------------------------------------------ save
  if (want('save')) {
    const r = await page.evaluate(() => {
      const A = G.avatar, app = { ...A.presets[1].appearance, hat: 'gat', hatColor: '#1f1f22', pattern: 'cloud' };
      G.sys.player.setAppearance(app);
      const stored = G.state.profile.avatar;
      const round = A.normalize(JSON.parse(JSON.stringify(G.state)).profile.avatar);
      return { stored, same: JSON.stringify(round) === JSON.stringify(A.normalize(app)), rigStyle: G.sys.player.rig.style, rigH: G.sys.player.rig.height };
    });
    check('the player wears and stores the new look (profile.avatar)', r.stored && r.stored.style === 'real' && r.stored.hat === 'gat' && r.rigStyle === 'real', JSON.stringify(r.stored));
    check('the look round-trips through the saved state JSON', r.same);
  }

  // ------------------------------------------------------------------ dispose
  if (want('dispose')) {
    const r = await page.evaluate(async () => {
      // [finisher] a renderer of its own: the page's renderer also uploads whatever the running world streams in between
      // the cycles (vegetation chunks, NPCs), which read as a leak of the rigs (geo 313→321 on a loaded machine)
      const A = G.avatar, rr = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false }), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
      cam.position.set(0, 1.3, 5); cam.lookAt(0, 1, 0);
      const rt = new THREE.WebGLRenderTarget(64, 64);
      const cycle = () => { const rigs = []; for (let i = 0; i < 10; i++) { const rg = A.create(A.presets[i % A.presets.length].appearance, { shadow: false }); rg.update(1 / 30, { speed: 0 }); scene.add(rg.group); rigs.push(rg); } rr.setRenderTarget(rt); rr.render(scene, cam); rr.setRenderTarget(null); for (const rg of rigs) rg.dispose(); };
      cycle(); await new Promise((res) => requestAnimationFrame(res));
      const m0 = { ...rr.info.memory }, p0 = rr.info.programs.length;
      cycle(); cycle(); await new Promise((res) => requestAnimationFrame(res));
      const m1 = { ...rr.info.memory }, p1 = rr.info.programs.length;
      const c0 = A.cache.size; A.cache.clear(); const c1 = A.cache.size;
      rt.dispose(); rr.dispose();
      return { m0, m1, p0, p1, c0, c1, children: scene.children.length };
    });
    check('30 rigs created and disposed leave no geometry, texture or program behind', r.m1.geometries <= r.m0.geometries && r.m1.textures <= r.m0.textures && r.p1 <= r.p0 && r.children === 0, `geo ${r.m0.geometries}→${r.m1.geometries}, tex ${r.m0.textures}→${r.m1.textures}, programs ${r.p0}→${r.p1}`);
    check('clearing the body cache frees every cached geometry', r.c0 > 0 && r.c1 === 0, `${r.c0} → ${r.c1}`);
  }

  // ------------------------------------------------------------------ crowd
  if (want('crowd')) {
    const r = await page.evaluate(() => {
      const A = G.avatar, rr = G.sys.engine.renderer, scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
      cam.position.set(0, 2.5, 12); cam.lookAt(0, 1, 0);
      const rigs = [];
      for (let i = 0; i < 20; i++) { const rg = A.create(A.random(i * 7 + 1), { shadow: false }); rg.group.position.set((i % 5 - 2) * 1.2, 0, Math.floor(i / 5) * -1.4); rg.update(1 / 30, { speed: 1 }); scene.add(rg.group); rigs.push(rg); }
      const rt = new THREE.WebGLRenderTarget(320, 180);
      const auto = rr.info.autoReset; rr.info.autoReset = true;
      rr.setRenderTarget(rt); rr.render(scene, cam);
      const calls = rr.info.render.calls, tris = rr.info.render.triangles;
      const progs = new Set(); for (const rg of rigs) progs.add(rr.properties.get(rg.material).currentProgram?.id);
      for (const rg of rigs) rg.dispose();
      const far = A.far.create(64); scene.add(far.mesh); far.begin();
      for (let i = 0; i < 40; i++) far.push((i % 8 - 4) * 1.5, 0, -Math.floor(i / 8) * 2, 0, A.random(i), i / 40, 0.8);
      far.end();
      rr.render(scene, cam);
      const farCalls = rr.info.render.calls, farTris = rr.info.render.triangles;
      rr.setRenderTarget(null); rr.info.autoReset = auto;
      far.dispose(); rt.dispose();
      return { calls, tris, programs: progs.size, farCalls, farTris };
    });
    check('20 avatars together: ≤ 3 draw calls each in the colour pass', r.calls <= 60, `${r.calls} calls, ${r.tris} triangles`);
    check('every avatar body shares ONE shader program', r.programs === 1, `${r.programs} programs`);
    check('far figures: a crowd of 40 is one draw call', r.farCalls === 1, `${r.farCalls} calls, ${r.farTris} triangles`);
  }

  // ------------------------------------------------------------------ editor (normal + easy)
  if (want('editor')) {
    const r = await page.evaluate(async () => {
      const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
      const wait = async (fn, ms = 60000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await raf(); } return false; };
      const out = {};
      G.app.openAvatar();
      const m = await wait(() => document.querySelector('.avatar-modal .av-tabs'));
      const body = document.querySelector('.avatar-modal');
      out.open = !!m;
      out.tabs = [...body.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab);
      out.looks = body.querySelectorAll('.av-looks .av-tile').length;
      out.drawn = await wait(() => body.querySelectorAll('.av-tile.drawn').length >= 4, 90000);
      // keyboard: → on the tab list
      const tl = body.querySelector('[role=tablist]');
      tl.querySelector('[data-tab].active').focus();
      tl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await raf();
      out.tabAfterKey = body.querySelector('[data-tab].active')?.dataset.tab;
      // the hair tab: pick 댕기머리 with Enter-like click on a focused tile; arrow keys move the focus
      body.querySelector('[data-tab="hair"]').click(); await raf();
      const tiles = [...body.querySelectorAll('.av-tile[data-k="hair"]')];
      out.hairTiles = tiles.length;
      tiles[0].focus();
      tiles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      out.focusMoved = document.activeElement === tiles[1];
      const dg = body.querySelector('.av-tile[data-k="hair"][data-v="daenggi"]');
      out.dgTile = !!dg; if (!dg) return out;
      dg.focus(); dg.click(); await raf();
      out.picked = document.querySelector('.avatar-modal .av-tile[data-k="hair"][data-v="daenggi"]')?.classList.contains('active');
      body.querySelector('[data-tab="hair"]').click(); await raf();
      const gat = document.querySelector('.avatar-modal .av-tile[data-k="hat"][data-v="gat"]');
      out.gatTile = !!gat; if (!gat) return out;
      gat.click(); await raf();
      out.hatTilesDrawn = await wait(() => document.querySelectorAll('.avatar-modal .av-tile[data-k="hat"].drawn').length >= 3, 90000);
      // save
      const saveBtn = [...document.querySelectorAll('button')].find((b) => /저장하기|좋아요/.test(b.textContent) && b.getClientRects().length > 0);
      out.saveBtn = !!saveBtn;
      if (!saveBtn) return out;
      saveBtn.click();
      await wait(() => !document.querySelector('.avatar-modal'), 10000);
      out.saved = { hair: G.state.profile.avatar?.hair, hat: G.state.profile.avatar?.hat, style: G.state.profile.avatar?.style };
      return out;
    });
    check('the customiser opens with tabs 추천 / 얼굴 / 머리 / 옷 / 장신구 / 색', r.open && r.tabs.join() === 'looks,face,hair,clothes,acc,color', r.tabs.join());
    check('≥ 12 ready-made looks as picture tiles, and the tiles get drawn (each is the real option rendered)', r.looks >= 12 && r.drawn, `${r.looks} looks, drawn ${r.drawn}`);
    check('← → move between tabs; arrow keys move between tiles', r.tabAfterKey === 'face' && r.focusMoved, `tab ${r.tabAfterKey}, focus moved ${r.focusMoved}`);
    check('≥ 12 hair tiles; a pick changes the look; the hat tiles are drawn', r.hairTiles >= 12 && r.picked && r.hatTilesDrawn, `${r.hairTiles} hair tiles`);
    check('save keeps the new look (댕기머리 + 갓, style real)', r.saved && r.saved.hair === 'daenggi' && r.saved.hat === 'gat' && r.saved.style === 'real', JSON.stringify(r));
  }
  await context.close();

  // ------------------------------------------------------------------ easy mode + phone
  if (want('phone')) {
    const { page: ph, context: pc } = await open('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const r = await ph.evaluate(async () => {
      const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
      const wait = async (fn, ms = 60000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await raf(); } return false; };
      G.app.openAvatar();
      await wait(() => document.querySelector('.avatar-modal .av-tabs'));
      const body = document.querySelector('.avatar-modal');
      body.querySelector('[data-tab="clothes"]').click(); await raf(); await raf();
      const tiles = [...body.querySelectorAll('.av-tile')];
      // layout size (offsetWidth / offsetHeight): the dialog's entrance animation scales its box for a moment
      const sizes = tiles.map((t) => Math.min(t.offsetWidth, t.offsetHeight));
      const tabs = [...body.querySelectorAll('[data-tab]')].map((t) => Math.min(t.offsetWidth, t.offsetHeight));
      return {
        kid: body.classList.contains('kid'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: body.scrollWidth - body.clientWidth,
        minTile: Math.min(...sizes), minTab: Math.min(...tabs),
        speaks: tiles.every((t) => (t.dataset.say || '').length > 0),
        sayAgain: !!body.querySelector('[data-say-again]'),
        inputs: body.querySelectorAll('input[type=text], textarea').length,
        drawn: await wait(() => body.querySelectorAll('.av-tile.drawn').length >= 3, 90000),
      };
    });
    check('easy mode on a phone: the kid customiser, no sideways scroll', r.kid && r.overflow <= 1 && r.bodyOverflow <= 1, `page ${r.overflow} px, dialog ${r.bodyOverflow} px`);
    check('easy mode: tiles and tabs ≥ 56 px, every tile speaks, a 🔊 button, no text field', r.minTile >= 56 && r.minTab >= 56 && r.speaks && r.sayAgain && r.inputs === 0, `tile ${r.minTile.toFixed(0)} px, tab ${r.minTab.toFixed(0)} px, inputs ${r.inputs}`);
    check('easy mode on a phone: the tile pictures are drawn', r.drawn);
    await pc.close();
  }
} catch (e) {
  check('suite ran to the end', false, e?.stack || String(e));
}
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
else log(`\navatar-client: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
