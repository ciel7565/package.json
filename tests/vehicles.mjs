#!/usr/bin/env node
// =============================================================================
// tests/vehicles.mjs — G.vehicles (src/game/59-vehicles.js, CONTRACT §17.9): the one generator for the cars, the van,
// the 1-ton truck, the coach and the shuttle of the valley's car park and of 만장대 단지.
//
//   node tests/vehicles.mjs                       part 1 in Node, then part 2 on a private page (tools/build.mjs --out <tmp>)
//   node tests/vehicles.mjs --file /abs/page.html part 2 on an already built page
//   options: --only node|browser · --json · --keep (leave the temp build) · --timeout <ms> (page load, 300000)
//   Part 2 starts a browser: run it through the shared browser lock.
//
// Part 1 (Node, no browser — the builders are pure buffer maths): every kind builds on every quality (high · medium ·
//   low · far); positions finite, normals unit length, the surface attribute in range; the model stands on y = 0, is as
//   long as its spec says and no wider than body + mirrors; triangle budgets per quality; low is a small fraction of
//   high; the same input gives the same geometry; spec() and the paint picker; the fragment has no Math.random, no
//   eval, no forbidden word and no Chinese character.
// Part 2 (the built page): G.vehicles is there; a fleet of two of each kind is ONE instanced mesh per kind + one shadow
//   mesh on every quality, with the material of that quality (flat on low, standard on medium, clear coat on high);
//   it costs no more draw calls than meshes; the far form takes over when the camera is far and comes back; dispose()
//   gives every geometry and texture back (renderer.info.memory as before); one('shuttle') carries its lettering and
//   frees it; the valley's car park is a fleet with colliders under every vehicle; the page logged no error.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const jsonOut = flag('--json');
const ONLY = opt('--only');
const TIMEOUT = Number(opt('--timeout', '300000'));
const log = (...a) => { if (!jsonOut) console.log(...a); };
const results = [], numbers = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };
const SRC = path.join(ROOT, 'src/game/59-vehicles.js');
const KINDS = ['sedan', 'suv', 'hatch', 'van', 'truck', 'coach', 'shuttle'];
const BUDGET = { high: 9000, medium: 5600, low: 1600, far: 1600 };

// =============================================================================================== part 1: Node
async function nodePart() {
  log('🚗 vehicles — the builders in Node');
  const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const src = fs.readFileSync(SRC, 'utf8');
  const load = () => { const G = { sys: {}, world: null, gfx: null }; vm.runInNewContext(src, { THREE, G, Math, console, Number, Array, Map, Set, Object, Float32Array }); return G.vehicles; };
  let V;
  try { V = load(); } catch (e) { check('59-vehicles.js evaluates without a browser (THREE only)', false, String(e && e.stack || e).slice(0, 300)); return; }
  check('59-vehicles.js evaluates without a browser (THREE only)', !!V && typeof V.fleet === 'function' && typeof V.one === 'function' && typeof V.spec === 'function', Object.keys(V || {}).join(' '));
  check('the seven kinds: sedan · suv · hatch · van · truck · coach · shuttle', JSON.stringify(V.KINDS) === JSON.stringify(KINDS), V.KINDS.join(' '));

  const bad = [], sizes = [], tris = {}, sums = {};
  for (const kind of KINDS) {
    const sp = V.spec(kind);
    tris[kind] = {};
    for (const q of ['high', 'medium', 'low', 'far']) {
      let g;
      try { g = V._build(kind, q); } catch (e) { bad.push(`${kind}:${q} threw ${String(e && e.message || e).slice(0, 80)}`); continue; }
      const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array, s = g.attributes.aSurf.array, b = g.boundingBox;
      let nan = 0, badN = 0, badS = 0, sum = 0;
      for (let i = 0; i < p.length; i++) { if (!Number.isFinite(p[i])) nan++; sum += p[i] * ((i % 7) + 1); }
      for (let i = 0; i < n.length; i += 3) if (!(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 0.02)) badN++;
      for (let i = 0; i < c.length; i++) if (!(c[i] >= 0 && c[i] <= 1.0001)) badS++;
      for (let i = 0; i < s.length; i += 4) if (!((s[i] === 0 || s[i] === 1) && s[i + 1] > 0 && s[i + 1] <= 1 && s[i + 2] >= 0 && s[i + 2] <= 1 && s[i + 3] >= 0 && s[i + 3] <= 1)) badS++;
      const t = p.length / 9, W = b.max.x - b.min.x, H = b.max.y - b.min.y, L = b.max.z - b.min.z;
      tris[kind][q] = t; sums[`${kind}:${q}`] = sum;
      if (q === 'high') sizes.push(`${kind} ${L.toFixed(2)} × ${W.toFixed(2)} × ${H.toFixed(2)}`);
      if (nan || badN || badS) bad.push(`${kind}:${q} ${nan} non-finite · ${badN} normals · ${badS} colours / surfaces`);
      if (p.length % 9 || n.length !== p.length || c.length !== p.length || s.length !== (p.length / 3) * 4) bad.push(`${kind}:${q} attribute sizes`);
      if (Math.abs(L - sp.L) > sp.L * 0.04) bad.push(`${kind}:${q} length ${L.toFixed(2)} (spec ${sp.L})`);
      if (W < sp.W - 0.06 || W > sp.W + 0.75) bad.push(`${kind}:${q} width ${W.toFixed(2)} (spec ${sp.W})`);
      if (H < sp.H - 0.12 || H > sp.H + 0.45) bad.push(`${kind}:${q} height ${H.toFixed(2)} (spec ${sp.H})`);
      if (Math.abs(b.min.y) > 0.03) bad.push(`${kind}:${q} stands at y ${b.min.y.toFixed(3)}`);
      if (Math.abs(b.max.x + b.min.x) > 0.05) bad.push(`${kind}:${q} not centred across (${(b.max.x + b.min.x).toFixed(3)})`);
      if (t > BUDGET[q]) bad.push(`${kind}:${q} ${t} triangles (budget ${BUDGET[q]})`);
      g.dispose();
    }
  }
  numbers.tris = tris;
  check('every kind builds on high · medium · low · far: finite, unit normals, valid surfaces, the right size, standing on y = 0', bad.length === 0, bad.slice(0, 6).join(' | ') || sizes.join(' · '));
  check(`triangle budgets: high ≤ ${BUDGET.high}, medium ≤ ${BUDGET.medium}, low and far ≤ ${BUDGET.low}`, KINDS.every((k) => ['high', 'medium', 'low', 'far'].every((q) => tris[k][q] > 100 && tris[k][q] <= BUDGET[q])),
    KINDS.map((k) => `${k} ${tris[k].high}/${tris[k].medium}/${tris[k].low}`).join(' · '));
  check('the low form is simple: under a quarter of the full model, and medium is lighter than high', KINDS.every((k) => tris[k].low <= tris[k].high * 0.25 && tris[k].medium < tris[k].high), KINDS.map((k) => `${k} ${Math.round((tris[k].low / tris[k].high) * 100)} %`).join(' · '));
  // true proportions: wheelbase, wheel size and overall size of each class (metres)
  const P = [];
  const range = { sedan: [4.5, 5.0, 1.78, 1.9, 1.4, 1.5], suv: [4.4, 4.9, 1.82, 1.95, 1.6, 1.78], hatch: [3.8, 4.4, 1.68, 1.82, 1.42, 1.58], van: [4.7, 5.3, 1.85, 2.0, 1.7, 1.95], truck: [4.7, 5.2, 1.65, 1.8, 1.9, 2.1], coach: [11, 12.5, 2.4, 2.55, 3.2, 3.8], shuttle: [7, 9.5, 2.0, 2.5, 2.7, 3.2] };
  for (const k of KINDS) {
    const s = V.spec(k), r = range[k];
    if (!(s.L >= r[0] && s.L <= r[1] && s.W >= r[2] && s.W <= r[3] && s.H >= r[4] && s.H <= r[5])) P.push(`${k} ${s.L} × ${s.W} × ${s.H}`);
    if (!(s.wheelbase > s.L * 0.45 && s.wheelbase < s.L * 0.68)) P.push(`${k} wheelbase ${s.wheelbase}`);
    if (!(s.r > s.H * 0.14 && s.r < s.H * 0.26)) P.push(`${k} wheel radius ${s.r}`);
    if (!(s.hw >= s.W / 2 && s.hd >= s.L / 2 && s.top >= s.H - 0.01)) P.push(`${k} collider`);
  }
  check('the spec table holds real sizes for each class (length, width, height, wheelbase, wheel) and a collider that covers the model', P.length === 0, P.join(' | ') || KINDS.map((k) => `${k} ${V.spec(k).L} m`).join(' · '));
  // determinism
  const V2 = load(), same = [];
  for (const k of KINDS) for (const q of ['high', 'low']) {
    const g = V2._build(k, q), p = g.attributes.position.array; let sum = 0;
    for (let i = 0; i < p.length; i++) sum += p[i] * ((i % 7) + 1);
    if (sum !== sums[`${k}:${q}`]) same.push(`${k}:${q}`);
    g.dispose();
  }
  check('the same kind and quality gives the same geometry every time (no randomness)', same.length === 0, same.join(' '));
  const picks = []; for (let i = 0; i < 400; i++) picks.push(V.paints(i).id);
  const again = []; for (let i = 0; i < 400; i++) again.push(V2.paints(i).id);
  const share = picks.filter((id) => id === 'white' || id === 'silver' || id === 'black' || id === 'graphite').length / picks.length;
  check('paints: picked by weight from a seed, the same on every machine; most cars are white, silver, black or grey', picks.join() === again.join() && new Set(picks).size >= 7 && share > 0.55 && share < 0.85, `${new Set(picks).size} paints · ${(share * 100).toFixed(0)} % plain colours`);
  // the fragment itself
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const han = [...src].filter((ch) => { const cp = ch.codePointAt(0); return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff); }).length;
  check('the fragment: no Math.random, no eval / new Function, no forbidden word, no Chinese character', !/Math\.random/.test(code) && !/\beval\(|new Function/.test(code) && !src.includes('게임') && han === 0, `${han} Chinese characters`);
}

// =============================================================================================== part 2: browser
async function browserPart() {
  let file = opt('--file'), tmpDir = null;
  if (!file) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-vehicles-'));
    file = path.join(tmpDir, 'index.html');
    const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
    if (b.status !== 0) { check('build for the browser part', false, (b.stderr || b.stdout).slice(0, 400)); return; }
  }
  if (!fs.existsSync(file)) { check('the page exists', false, file); return; }
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { check('playwright', false, 'not installed'); return; } }
  log('🚗 vehicles — fleets in the built page');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
    await page.goto(pathToFileURL(file).href + '?autostart=1&notutorial=1&quality=low', { timeout: TIMEOUT });
    await page.waitForFunction(() => window.G && window.G.ready === true && window.G.sys && window.G.sys.engine && window.G.sys.engine.renderer && window.G.sys.props, null, { timeout: TIMEOUT, polling: 250 });
    const r = await page.evaluate(async () => {
      const G = window.G, E = G.sys.engine, R = E.renderer, V = G.vehicles, out = { has: !!V, q: {} };
      if (!V) return out;
      const KINDS = V.KINDS, cam = E.camera;
      const frame = () => { E.render({ force: true }); return { ...R.info.memory, calls: R.info.render.calls }; };
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      const at = cam.position.clone().addScaledVector(fwd, 40); at.y = cam.position.y - 6;
      const live0 = V.stats().live;
      out.live0 = live0;
      const farAway = at.clone().add(new THREE.Vector3(0, 300, 900));
      for (const q of ['low', 'medium', 'high']) {
        const o = (out.q[q] = {});
        const list = []; KINDS.forEach((kind, i) => { for (let k = 0; k < 2; k++) list.push({ kind, x: (i - 3) * 4, y: 0, z: k * 14 - 7, rot: k ? 0.3 : Math.PI, paint: i + k }); });
        // one throwaway round first: what this fleet shares with the page's own vehicles (the car park, the shuttle at
        // its stop — cached per kind and quality, perhaps never drawn yet) is uploaded here and stays, so the measured
        // round counts only what the fleet itself brings and takes away
        {
          const w = V.fleet(list, { quality: q, name: 'warm-' + q });
          w.group.position.copy(at); w.group.traverse((x) => { x.frustumCulled = false; }); E.scene.add(w.group);
          frame(); w.update(farAway); frame(); w.dispose(); frame();
        }
        const m0 = frame();
        const f = V.fleet(list, { quality: q, name: 'test-' + q });
        f.group.position.copy(at);
        f.group.traverse((x) => { x.frustumCulled = false; });
        E.scene.add(f.group);
        const hidden = (f.group.visible = false, frame().calls);
        f.group.visible = true;
        const m1 = frame();
        o.count = f.count; o.kinds = f.kinds; o.calls = f.calls; o.tris = f.tris;
        o.extraCalls = m1.calls - hidden;
        const inst = f.group.children.filter((x) => x.isInstancedMesh && x.visible);
        o.instanced = inst.length; o.perKind = inst.filter((x) => !/shadow/.test(x.name)).map((x) => x.count);
        o.colours = inst.filter((x) => !/shadow/.test(x.name)).every((x) => x.instanceColor && x.instanceColor.count === x.count);
        const body = inst.find((x) => !/shadow/.test(x.name));
        o.material = body ? body.material.type : null; o.clearcoat = body ? body.material.clearcoat || 0 : 0;
        o.geoUp = m1.geometries - m0.geometries;
        // the far form
        const fars = f.group.children.filter((x) => /-far$/.test(x.name));
        o.fars = fars.length;
        const nearState = f.update(at.clone().add(new THREE.Vector3(0, 2, 20)));
        const farState = f.update(farAway);
        o.swap = { near: nearState, far: farState, farVisible: fars.every((x) => x.visible), nearHidden: f.meshes.every((x) => !x.visible) };
        frame();
        const back = f.update(at.clone().add(new THREE.Vector3(0, 2, 20)));
        o.swap.back = back; o.swap.nearAgain = f.meshes.every((x) => x.visible);
        frame();
        o.paint = f.setPaint(0, '#ff0000');
        f.dispose();
        const m2 = frame();
        o.mem = [m0.geometries, m1.geometries, m2.geometries, m0.textures, m2.textures];
        o.liveAfter = V.stats().live - live0; o.inScene = !!f.group.parent;
        f.dispose();   // twice is harmless
      }
      // one shuttle with its lettering
      {
        { const w = V.one('shuttle', { quality: 'medium' }); w.position.copy(at); w.traverse((x) => { x.frustumCulled = false; }); E.scene.add(w); frame(); w.userData.dispose(); E.scene.remove(w); frame(); }   // the same throwaway round
        const m0 = frame();
        const g = V.one('shuttle', { quality: 'medium' });
        g.position.copy(at); g.traverse((x) => { x.frustumCulled = false; });
        E.scene.add(g); const m1 = frame();
        out.one = { children: g.children.length, labels: g.children.filter((x) => x.name === 'vehicle-label').length, kind: g.userData.kind, hasDispose: typeof g.userData.dispose === 'function', spec: g.userData.spec && g.userData.spec.L };
        g.userData.dispose(); E.scene.remove(g);
        const m2 = frame();
        out.one.mem = [m0.geometries, m1.geometries, m2.geometries, m0.textures, m1.textures, m2.textures];
      }
      // the valley's car park
      {
        const P = G.sys.props, f = P && P.vehicles, pk = G.data.layout.parking;
        out.park = { fleet: !!f };
        if (f) {
          out.park.count = f.count; out.park.kinds = Object.keys(f.kinds); out.park.calls = f.calls; out.park.tris = f.tris;
          out.park.parent = f.group.parent && f.group.parent.name;
          const m = new THREE.Matrix4(), v = new THREE.Vector3(); let blocked = 0, inLot = 0, total = 0;
          for (const mesh of f.meshes) for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m); total++;
            if (G.world.blocked(v.x, v.z, 0.3, v.y)) blocked++;
            if (Math.hypot(v.x - pk.x, v.z - pk.z) < Math.hypot(pk.w, pk.d) / 2 + 1) inLot++;
          }
          out.park.blocked = blocked; out.park.inLot = inLot; out.park.total = total;
        }
      }
      out.stats = V.stats();
      return out;
    });
    await page.close();
    numbers.browser = r;
    check('G.vehicles is in the built page', r.has === true, '');
    if (r.has) {
      const want = { low: ['MeshLambertMaterial', 0], medium: ['MeshStandardMaterial', 0], high: ['MeshPhysicalMaterial', 1] };
      for (const q of ['low', 'medium', 'high']) {
        const o = r.q[q];
        check(`${q}: a fleet of 14 = one instanced mesh per kind (2 each) + one shadow mesh`, o.count === 14 && Object.keys(o.kinds).length === 7 && o.perKind.length === 7 && o.perKind.every((n) => n === 2) && o.instanced === 8 && o.calls === 8 && o.colours, JSON.stringify({ kinds: o.kinds, instanced: o.instanced, calls: o.calls }));
        check(`${q}: the whole fleet costs no more than 8 draw calls on this page`, o.extraCalls >= 1 && o.extraCalls <= 8, `${o.extraCalls} calls · ${o.tris} triangles`);
        check(`${q}: the material of the quality (${want[q][0]}${q === 'high' ? ', clear coat' : ''})`, o.material === want[q][0] && (q === 'high' ? o.clearcoat === 1 : !o.clearcoat), `${o.material} · clearcoat ${o.clearcoat}`);
        if (q === 'low') check('low: no far form is needed (the model is already the simple one)', o.fars === 0 && o.swap.far === false, JSON.stringify(o.swap));
        else check(`${q}: the far form takes over when the camera is far and the full models come back`, o.fars === 7 && o.swap.near === false && o.swap.far === true && o.swap.farVisible && o.swap.nearHidden && o.swap.back === false && o.swap.nearAgain, JSON.stringify(o.swap));
        check(`${q}: dispose() gives every geometry and texture back and leaves the scene`, o.geoUp >= 0 && o.mem[2] === o.mem[0] && o.mem[4] === o.mem[3] && o.liveAfter === 0 && o.inScene === false && o.paint === true, `geometries ${o.mem[0]} → ${o.mem[1]} → ${o.mem[2]} · textures ${o.mem[3]} → ${o.mem[4]}`);
      }
      check('one(\'shuttle\'): a group with the model, its shadow and the lettering on both sides; dispose frees them', r.one.children >= 4 && r.one.labels === 2 && r.one.kind === 'shuttle' && r.one.hasDispose && r.one.spec === 9 && r.one.mem[2] === r.one.mem[0] && r.one.mem[5] === r.one.mem[3] && r.one.mem[4] > r.one.mem[3], JSON.stringify(r.one));
      check('the valley\'s car park is a fleet: 7 vehicles of several kinds in a handful of draw calls, under the props root', r.park.fleet && r.park.count === 7 && r.park.kinds.length >= 4 && r.park.calls <= 7 && r.park.parent === 'props', JSON.stringify(r.park));
      check('every parked vehicle stands in the car park and has a collider under it', r.park.fleet && r.park.total === 7 && r.park.blocked === 7 && r.park.inLot === 7, `${r.park.blocked} of ${r.park.total} blocked · ${r.park.inLot} in the lot`);
      check('nothing is left alive but what the page itself parks (the car park, the shuttle at its stop)', r.live0 >= 1 && r.stats.live === r.live0, `${r.stats.live} live fleets (${r.live0} before the test) · ${Object.keys(r.stats.cached || {}).join(' ')}`);
    }
    check('the page logged no error', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (tmpDir && !flag('--keep')) { try { fs.unlinkSync(path.join(tmpDir, 'index.html')); fs.rmdirSync(tmpDir); } catch (e) { /* leave it */ } }
  }
}

try {
  if (ONLY !== 'browser') await nodePart();
  if (ONLY !== 'node') await browserPart();
} catch (e) {
  console.error('could not run:', e && e.stack || e);
  process.exit(2);
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, numbers }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} vehicles: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
