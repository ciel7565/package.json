#!/usr/bin/env node
// =============================================================================
// tests/allot-district.mjs — the district check of CONTRACT §16.8 (complex-units: 44-allot-district.js)
//
//   node tests/allot-district.mjs                        builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/allot-district.mjs --file /abs/page.html  tests an already built page
//   options: --json · --keep · --headed · --timeout <ms> · --presets low,medium,high · --only budget,pick,status,labels,goto,phone,dispose
//            --shots <dir> (a screenshot per preset at the aerial view)
//
// The units are a part of the place PL_ALLOT (53-complex-site.js runs the part registry). Without that place (or when it
// does not build the part) the test defines a throw-away place PL_CUTEST at the same origin whose build() runs only the
// 'units' part on a plain ground from G.data.complex.height — so this check never depends on another track's progress.
// Per preset (separate page loads): every unit is in exactly one level (sum = L.count); draw calls ≤ 30 and triangles ≤ the
// preset budget (high 0.9 M · medium 0.45 M · low 0.3 M) at the `aerial` viewpoint and at three ground spots (inside a ring,
// in a field, in a storehouse lane). On the first preset also: pick accuracy at 20 sample units (stand beside → the focused
// code equals L.unitAt at the unit), a status change of 50 units rewrites only those entries, ≤ 12 labels while running a
// full ring walk, goto() lands on a free walkable spot beside the unit for 30 random units of all kinds (facing it, the
// beacon on, the unit focused), dispose() frees colliders / labels / the interactable / the meshes; phone 390 × 844.
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
const jsonOut = flag('--json');
const PRESETS = (opt('--presets') || 'low,medium,high').split(',').filter(Boolean);
const ONLY = (opt('--only') || 'budget,pick,status,labels,goto,phone,dispose').split(',');
const SHOTS = opt('--shots');
const log = (...a) => { if (!jsonOut) console.log(...a); };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-district-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };
const BUDGET = { high: 900000, medium: 450000, low: 300000 };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [];
const consoleErrors = [];
async function newPage(viewport, mobile = false) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  return page;
}
async function boot(page, quality) {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${quality}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.places && !!window.G.data?.complex, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { G.ui.modal.closeAll(); try { const w = G.sys.weather; w.setLockTime(true); w.setAuto(false); w.setHour(16.5); } catch (e) { /* optional */ } });
}
/** enter the district (PL_ALLOT, or the throw-away PL_CUTEST); resolves to { place, ready } */
async function enterDistrict(page) {
  return page.evaluate(async () => {
    const G = window.G, C = G.data.complex, P = G.sys.places;
    const tryEnter = async (id) => { try { return await P.enter(id, { fade: false, quiet: true }); } catch (e) { return false; } };
    if (P.def('PL_ALLOT') && await tryEnter('PL_ALLOT') && G.sys.allotDistrict?.ready?.()) return { place: 'PL_ALLOT', ready: true };
    if (P.current) { try { await P.exit({ fade: false, quiet: true }); } catch (e) { /* stay */ } }
    const id = 'PL_CUTEST';
    if (!P.def(id)) P.define({ id, name: '단지 시험', kidName: '단지 시험', zoneId: 'ZONE_PL_CUTEST', origin: { x: 0, z: 2600 }, size: { w: 380, d: 300, h: 80 },
      floorY: (x, z) => C.height(x, z), indoor: false, surface: 'stone', keepAlive: true, far: 1600, spawn: { x: C.spawn.x, z: C.spawn.z, rotY: C.spawn.rot }, exit: { x: 0, z: 9, rotY: Math.PI },
      build(ctx) {
        const g = new THREE.PlaneGeometry(380, 300, 95, 75); g.rotateX(-Math.PI / 2);
        const Pp = g.attributes.position;
        for (let i = 0; i < Pp.count; i++) { const x = Pp.getX(i), z = Pp.getZ(i) + 10; Pp.setZ(i, z); Pp.setY(i, C.height(x, z)); }
        g.computeVertexNormals();
        ctx.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8f9a70 })));
        const ups = [], dis = [];
        for (const p of (G.complexParts?.list || []).filter((q) => q.name === 'units')) { const r = p.fn(ctx, C); if (r?.update) ups.push(r.update); if (r?.dispose) dis.push(r.dispose); }
        ctx.onUpdate((dt, t) => { for (const u of ups) u(dt, t); });
        return { dispose() { for (const d of dis) d(); } };
      } });
    const ok = await tryEnter(id);
    return { place: id, ready: ok && !!G.sys.allotDistrict?.ready?.() };
  });
}
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
/** put the camera at a viewpoint (aerial = the owner's picture) or a ground spot (place-local) and let the levels settle */
async function view(page, v) {
  await page.evaluate((v) => {
    const G = window.G, C = G.data.complex, d = G.sys.places.def(G.sys.places.current), cam = G.sys.camera;
    const ox = d.origin.x, oz = d.origin.z;
    if (v.id) { const p = C.viewpoints.find((x) => x.id === v.id); cam.shot({ x: ox + p.x, y: p.y, z: oz + p.z }, { x: ox + p.look.x, y: p.look.y, z: oz + p.look.z }, { fov: p.fov || 48, duration: 0 }); }
    else {
      // ground spots are read from the master plan (plan v2 moved the rings): a ring walk of the great circle, the first
      // terrace of the south-east field, the lane between the first two storehouses
      let pos = v.pos, look = v.look;
      if (v.spot === 'ring') { const gc = C.rings.GC, w = (C.rings.walks || [])[4] || 28.2; pos = [gc.cx + w * Math.cos(1.75), 1.7, gc.cz + w * Math.sin(1.75)]; look = [gc.cx + w * Math.cos(2.15), 0.6, gc.cz + w * Math.sin(2.15)]; }
      else if (v.spot === 'field') { const f = C.byId('F_SE'); pos = [f.origin[0] + 1, 1.7, f.origin[1] + 1.5]; look = [f.origin[0] + 20, 0.2, f.origin[1] + 18]; }
      else if (v.spot === 'store') { const a = C.byId('B_SH1'), b = C.byId('B_SH2'), lz = (a.z + b.z) / 2; pos = [a.x - 35.4, 1.7, lz]; look = [a.x - 6.4, 1.2, lz + 1.6]; }
      cam.shot({ x: ox + pos[0], y: C.height(pos[0], pos[2]) + pos[1], z: oz + pos[2] }, { x: ox + look[0], y: C.height(look[0], look[2]) + look[1], z: oz + look[2] }, { fov: 55, duration: 0 });
    }
    cam.snap && cam.snap();
  }, v);
  await frames(page, 6);
  await page.waitForTimeout(300);
  await frames(page, 3);
  return page.evaluate(() => ({ cu: G.sys.allotDistrict.stats(), frame: { ...G.sys.engine.frameInfo } }));
}
const SPOTS = { ring: { spot: 'ring' }, field: { spot: 'field' }, store: { spot: 'store' } };

// ============================================================================ per preset: levels + budgets
async function presetSection(q, first) {
  const page = await newPage({ width: 1280, height: 720 });
  await boot(page, q);
  const ent = await enterDistrict(page);
  check(`${q}: the district builds (${ent.place})`, ent.ready, JSON.stringify(ent));
  if (!ent.ready) { await page.context().close(); return; }
  if (ONLY.includes('budget')) {
    for (const [name, v] of [['aerial', { id: 'aerial' }], ['ring', SPOTS.ring], ['field', SPOTS.field], ['store', SPOTS.store]]) {
      const r = await view(page, v);
      const lev = r.cu.levels, sum = (a) => a[0] + a[1] + a[2];
      const total = sum(lev.jar) + sum(lev.plot) + sum(lev.store);
      check(`${q} ${name}: every unit in exactly one level (sum = L.count)`, total === r.cu.count && r.cu.count === 10000, `jar ${lev.jar} · plot ${lev.plot} · store ${lev.store} = ${total} / ${r.cu.count}`);
      check(`${q} ${name}: units ≤ 30 draw calls`, r.cu.drawCalls <= 30, `${r.cu.drawCalls} calls · drawn ${JSON.stringify(r.cu.drawn)}`);
      check(`${q} ${name}: units ≤ ${(BUDGET[q] / 1e6).toFixed(2)} M triangles`, r.cu.triangles <= BUDGET[q], `${(r.cu.triangles / 1000).toFixed(0)} k (whole frame ${r.frame.calls} calls / ${(r.frame.triangles / 1e6).toFixed(2)} M tri)`);
      if (q === 'low') check(`low ${name}: no full-detail jar or bed (flat low-poly / far forms only)`, !r.cu.drawn.jarFull && !r.cu.drawn.bedFrame && !r.cu.drawn.crop0, JSON.stringify(r.cu.drawn));
      if (name === 'aerial') {
        const jarsDrawn = (r.cu.drawn.jarFull || 0) + (r.cu.drawn.jarLow || 0) + (r.cu.drawn.jarFar || 0);
        check(`${q} aerial: all 6,000 jars drawn`, jarsDrawn === 6000, `${jarsDrawn}`);
        if (q === 'high') check('high aerial: the jars are lathe forms with lids (low-poly level, not the far form)', (r.cu.drawn.jarLow || 0) + (r.cu.drawn.jarFull || 0) >= 5900, JSON.stringify(r.cu.drawn));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `district-${q}-aerial.png`) }).catch(() => {});
      }
    }
  }
  if (first) await functionalChecks(page);
  await page.context().close();
}

// ============================================================================ functional (first preset)
async function functionalChecks(page) {
  await page.evaluate(() => G.sys.camera.setMode('follow', { duration: 0 }));
  if (ONLY.includes('pick')) {
    const r = await page.evaluate(async () => {
      const G = window.G, D = G.sys.allotDistrict, Lv = D._live, L = Lv.L, A = L.arrays, d = G.sys.places.def(G.sys.places.current);
      const out = [];
      const pickable = [];
      for (let i = 0; i < L.count; i += 1) {
        const ring = Lv.slotType[A.slot[i]] === 'ring';
        if (ring && ((A.ring[i] % 3) + 3) % 3 === 1) continue;               // middle rows sit behind their neighbours
        pickable.push(i);
      }
      const step = Math.floor(pickable.length / 20);
      for (let k = 0; k < 20; k++) {
        const i = pickable[k * step + 7], code = Lv.L.zones[A.zone[i]].code + '-' + String(A.seq[i]).padStart(4, '0');
        const sp = D.spotFor(code);
        if (!sp) { out.push({ code, ok: false, why: 'no spot' }); continue; }
        await G.sys.player.teleport(sp.x + d.origin.x, sp.z + d.origin.z, sp.rotY, { fade: false });
        Lv.sticky = null;
        const u = L.unitAt(A.x[i], A.z[i]), expect = u ? `${u.zone}-${String(u.seq).padStart(4, '0')}` : null;
        // (the pick runs in the frame loop: on a loaded software-GL machine a frame can take a second — wait for it)
        const t0 = performance.now();
        do { await new Promise((res) => setTimeout(res, 250)); } while (D.stats().focus !== expect && performance.now() - t0 < 8000);
        const st = D.stats();
        out.push({ code, focus: st.focus, expect, ok: st.focus === expect && expect === code });
      }
      return out;
    });
    const good = r.filter((x) => x.ok).length;
    check('pick: 20 sample units (all kinds) — the focused code equals L.unitAt', good === 20, `${good}/20 ${JSON.stringify(r.filter((x) => !x.ok).slice(0, 4))}`);
    const prompt = await page.evaluate(() => { const el = document.getElementById('interact-prompt'); return el ? { text: el.textContent.trim().slice(0, 60), hidden: el.classList.contains('hidden') || getComputedStyle(el).display === 'none' } : null; });
    check('pick: the prompt names the unit (보기)', !!prompt && !prompt.hidden && /보기/.test(prompt.text), JSON.stringify(prompt));
    const hl = await page.evaluate(() => { const Lv = G.sys.allotDistrict._live; return { ring: Lv.ring.visible, glow: Lv.glow.visible, outline: (G.sys.engine.outline?.count || 0) }; });
    check('pick: own highlight (ring + glow), no engine outline on the instanced meshes', hl.ring && hl.glow && !hl.outline, JSON.stringify(hl));
  }
  if (ONLY.includes('status')) {
    const r = await page.evaluate(async () => {
      const G = window.G, D = G.sys.allotDistrict, Lv = D._live, L = Lv.L;
      await new Promise((res) => setTimeout(res, 200));
      const ms0 = G.sys.allot?.mapState?.() || null;
      const base = ms0 && ms0.layout === L && ms0.status ? ms0.status.slice() : new Uint8Array(L.count);
      const snap = () => Object.fromEntries(Object.entries(Lv.meshes).filter(([, m]) => m.instanceColor).map(([k, m]) => [k, Array.from(m.instanceColor.array.subarray(0, m.count * 3))]));
      const before = snap();
      const changed = [];
      for (let k = 0; k < 50; k++) changed.push((k * 197 + 11) % L.count);
      const st = base.slice();
      for (const i of changed) st[i] = st[i] === 3 ? 0 : 3;               // closed ↔ open: a visible colour change
      const orig = G.sys.allot?.mapState;
      G.sys.allot = G.sys.allot || {};
      G.sys.allot.mapState = () => ({ v: 99, demo: true, layout: L, status: st, mine: [], zones: [] });
      const w0 = D.stats().statusWrites;
      G.bus.emit('allot:map', { v: 99, demo: true });
      const s1 = D.stats();
      const after = snap();
      let diff = 0;
      for (const k of Object.keys(before)) { const a = before[k], b = after[k]; if (!b || a.length !== b.length) continue; for (let q = 0; q < a.length; q += 3) if (a[q] !== b[q] || a[q + 1] !== b[q + 1] || a[q + 2] !== b[q + 2]) diff++; }
      if (orig) G.sys.allot.mapState = orig; else delete G.sys.allot.mapState;
      G.bus.emit('allot:map', { v: 100 });
      return { changed: s1.lastWrite.changed, written: s1.lastWrite.written, writes: s1.statusWrites - w0, diff, rebuilt: false };
    });
    check('status: a change of 50 units is applied to exactly those 50', r.changed === 50, JSON.stringify(r));
    check('status: only their instance entries are rewritten (colour entries that differ ≤ entries written ≤ 50)', r.written <= 50 && r.diff <= r.written + 2 && r.diff > 0, JSON.stringify(r));
  }
  if (ONLY.includes('labels')) {
    const r = await page.evaluate(async () => {
      const G = window.G, d = G.sys.places.def(G.sys.places.current), R = G.data.complex.rings.GC, rr = (G.data.complex.rings.walks || [])[3] || 23.5;   // a ring walk of plan v2
      let max = 0;
      const churn0 = G.sys.allotDistrict.stats().labelChurn, t0 = performance.now();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2, x = R.cx + Math.cos(a) * rr, z = R.cz + Math.sin(a) * rr;
        await G.sys.player.teleport(x + d.origin.x, z + d.origin.z, Math.atan2(-Math.sin(a), Math.cos(a)), { fade: false });
        await new Promise((res) => setTimeout(res, 140));
        const n = document.querySelectorAll('.wl.cu-label:not(.hidden)').length;
        if (n > max) max = n;
      }
      const s = G.sys.allotDistrict.stats();
      return { max, churn: s.labelChurn - churn0, secs: (performance.now() - t0) / 1000, pooled: document.querySelectorAll('.wl.cu-label').length };
    });
    check('labels: ≤ 12 shown while running the full ring walk (r 26.6 m)', r.max <= 12 && r.max >= 1, JSON.stringify(r));
    check('labels: pooled (12 elements), no storm (≤ 2 new per 0.3 s)', r.pooled === 12 && r.churn <= Math.ceil(r.secs / 0.3) * 2 + 2, JSON.stringify(r));
  }
  if (ONLY.includes('goto')) {
    const r = await page.evaluate(async () => {
      const G = window.G, D = G.sys.allotDistrict, Lv = D._live, L = Lv.L, A = L.arrays, C = G.data.complex, d = G.sys.places.def(G.sys.places.current);
      const kinds = [0, 0, 0], out = [];
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const pickKind = (k) => { for (;;) { const i = Math.floor(rnd() * L.count); if (A.kind[i] === k) return i; } };
      for (let n = 0; n < 30; n++) {
        const k = n % 3, i = pickKind(k), code = L.zones[A.zone[i]].code + '-' + String(A.seq[i]).padStart(4, '0');
        kinds[k]++;
        const ok = await D.goto(code);
        await new Promise((res) => setTimeout(res, 380));
        const p = G.sys.player.position, lx = p.x - d.origin.x, lz = p.z - d.origin.z;
        const b = i * 16, M = Lv.mat, ux = A.kind[i] === 2 ? M[b + 12] : A.x[i], uz = A.kind[i] === 2 ? M[b + 14] : A.z[i];
        const dist = Math.hypot(ux - lx, uz - lz) - Lv.footR(i);
        const blocked = G.world.blocked(p.x, p.z, 0.3, p.y);
        const face = Math.cos(G.sys.player.rotY - Math.atan2(ux - lx, uz - lz));
        const s = D.stats();
        out.push({ code, ok, dist: +dist.toFixed(2), blocked, walk: C.walkable(lx, lz), face: +face.toFixed(2), focus: s.focus, beacon: !!s.beacon });
      }
      return { kinds, out };
    });
    const bad = r.out.filter((x) => !(x.ok && x.dist <= 2.6 && !x.blocked && x.face > 0.7 && x.focus === x.code && x.beacon));
    check('goto: 30 random units of all kinds — free spot beside the unit (≤ 2.5 m), facing it, focused, beacon on', bad.length === 0 && r.kinds.every((n) => n === 10), `${30 - bad.length}/30 ${JSON.stringify(bad.slice(0, 3))}`);
    const walk = r.out.filter((x) => x.walk).length;
    check('goto: the spots are walkable in the master plan (C.walkable)', walk >= 27, `${walk}/30`);
  }
  if (ONLY.includes('dispose')) {
    const r = await page.evaluate(() => {
      const G = window.G, D = G.sys.allotDistrict, Lv = D._live;
      const nCol = Lv.colliders.length, A = Lv.L.arrays, d = G.sys.places.def(G.sys.places.current);
      const probe = [0, 2500, 6100, 8800].map((i) => [A.x[i] + d.origin.x, A.z[i] + d.origin.z, A.y[i]]);
      const before = probe.filter(([x, z, y]) => G.world.blocked(x, z, 0.1, y)).length;
      const root = Lv.root;
      Lv.dispose();
      const after = probe.filter(([x, z, y]) => G.world.blocked(x, z, 0.1, y)).length;
      return { nCol, before, after, inScene: !!root.parent, labels: document.querySelectorAll('.wl.cu-label').length, interact: !!G.interact.get?.('cu-unit'), ready: D.ready() };
    });
    check('dispose: frees colliders, labels, the interactable and the scene part', !r.inScene && r.labels === 0 && !r.interact && !r.ready && r.nCol > 100 && r.before === 4 && r.after === 0, JSON.stringify(r));
  }
}

// ============================================================================ phone
async function phoneSection() {
  const page = await newPage({ width: 390, height: 844 }, true);
  await boot(page, 'low');
  const ent = await enterDistrict(page);
  check('phone 390×844: the district builds', ent.ready, JSON.stringify(ent));
  if (!ent.ready) { await page.context().close(); return; }
  await page.evaluate(() => G.setSetting?.('easyMode', true));
  const r = await page.evaluate(async () => {
    const G = window.G, D = G.sys.allotDistrict;
    const ok = await D.goto('P02-0100');
    await new Promise((res) => setTimeout(res, 900));
    const el = document.getElementById('interact-prompt'), rc = el ? el.getBoundingClientRect() : null;
    return { ok, focus: D.stats().focus, prompt: el ? el.textContent.trim().slice(0, 40) : '', ph: rc ? Math.round(rc.height) : 0, sw: document.documentElement.scrollWidth, iw: innerWidth, labels: document.querySelectorAll('.wl.cu-label:not(.hidden)').length };
  });
  check('phone 390×844: 찾아가기 + the big prompt (≥ 56 px, kid words), no sideways scroll', r.ok && r.focus === 'P02-0100' && r.ph >= 56 && /밭/.test(r.prompt) && r.sw <= r.iw + 1 && r.labels <= 12, JSON.stringify(r));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'district-phone-390x844.png') }).catch(() => {});
  await page.context().close();
}

let crashed = null;
try {
  log(`🏺 district check — ${file}`);
  for (const [k, q] of PRESETS.entries()) { log(`— ${q}`); await presetSection(q, k === 0); }
  if (ONLY.includes('phone')) { log('— phone'); await phoneSection(); }
  check('no page errors', !pageErrors.length, pageErrors.slice(0, 4).join(' | '));
  check('no console errors', !consoleErrors.length, consoleErrors.slice(0, 4).join(' | '));
} catch (e) { crashed = e; check('test ran to the end', false, String(e?.stack || e).slice(0, 500)); }
await browser.close();
if (tmpDir && !flag('--keep')) fs.rmSync(tmpDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} passed`);
process.exit(crashed && !results.length ? 2 : failed.length ? 1 : 0);
