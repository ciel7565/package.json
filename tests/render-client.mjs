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
//   vegetation     [render-nature] §16.2 — low: the plain trees, no grass (nothing changed); medium / high: the real
//                  trees, grass and rocks are on; at the five fixed views the vegetation costs ≤ 40 draw calls and
//                  ≤ 1.5 M triangles in the colour pass on high (≤ 20 and ≤ 0.75 M on medium); a 200 m walk changes
//                  tree levels with no broken bounding sphere, no batch overflow, no GL error, and every level update
//                  inside its write budget (--no-veg-walk skips it)
//   light          [render-light] §16.3 — see the marked section: the post chain and its depth texture, the memory budget,
//                  texel-snapped shadows, the environment's ground proxy, the cloud layer, a day → dusk → night → rain tour
//                  under the screen watchdog, the dynamic resolution against an artificial slow frame, a lost and restored
//                  WebGL context (--no-context-loss skips that one). With --shots every preset saves the six fixed views.
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

// ---------------------------------------------------------------- [render-nature] vegetation (CONTRACT §16.2)
// ONE marked section: the vegetation budgets (the colour pass with and without the vegetation families at the five
// fixed views), "nothing changed on low", and a 200 m walk during which trees change their level of detail and no
// vegetation mesh may end up with a broken bounding sphere. Called once per preset at the end of runPreset.
const VEG_BUDGET = { high: { calls: 40, tris: 1.5e6 }, medium: { calls: 20, tris: 0.75e6 } };
const VEG_WALK = [[0, 30], [-58, 12], [-40, -58], [22, -66]];   // plaza → hanok village → hall garden: ≈ 200 m
const VEG_KEYS = ['trees', 'rocks', 'shrubs', 'flowers', 'grass'];
/** the colour pass with and without the vegetation families → what the vegetation costs */
const pageVegMeasure = (keys) => {
  const G = window.G, e = G.sys.engine, R = e.renderer, N = G.sys.nature, out = {};
  const sm = R.shadowMap, auto = sm.autoUpdate, needs = sm.needsUpdate, rt = R.getRenderTarget(), vis = {};
  const pass = () => { R.info.reset(); R.render(e.scene, e.camera); return [R.info.render.calls, R.info.render.triangles]; };
  try {
    sm.autoUpdate = false; sm.needsUpdate = false; R.setRenderTarget(null);
    const all = pass();
    for (const k of keys) if (N.meshes[k]) { vis[k] = N.meshes[k].visible; N.meshes[k].visible = false; }
    const none = pass();
    out.calls = all[0] - none[0]; out.tris = all[1] - none[1]; out.colourCalls = all[0];
  } finally {
    for (const k of keys) if (N.meshes[k] && vis[k] !== undefined) N.meshes[k].visible = vis[k];
    sm.autoUpdate = auto; sm.needsUpdate = needs; R.setRenderTarget(rt);
  }
  out.lod = N.lodStats ? N.lodStats() : null;
  out.glError = R.getContext().getError();
  return out;
};
/** real or plain, the mesh names, every broken bounding sphere */
const pageVegState = (keys) => {
  const G = window.G, N = G.sys.nature, out = { real: !!N.real, counts: { ...N.counts }, bad: [], names: [] };
  const ok = (s) => !!s && [s.center.x, s.center.y, s.center.z, s.radius].every(Number.isFinite) && s.radius >= 0;
  for (const k of keys) {
    const root = N.meshes[k];
    if (!root) continue;
    root.traverse((o) => {
      if (!(o.isMesh || o.isPoints)) return;
      out.names.push(o.name || o.type);
      const s = o.boundingSphere || (o.geometry && o.geometry.boundingSphere);
      if (s && !ok(s)) out.bad.push(o.name || o.type);
    });
  }
  for (const f of (N.veg && N.veg.forests) || []) for (const m of [f.b0.mesh, f.b1.mesh, f.far]) if (m && !ok(m.geometry.boundingSphere)) out.bad.push(m.name);
  out.lod = N.lodStats ? N.lodStats() : null;
  return out;
};
/** the player moves along a polyline in steps of `step` m (a walk, as the level-of-detail code sees it); a frame is drawn after each */
const pageVegWalk = async ([pts, step]) => {
  const G = window.G, e = G.sys.engine, N = G.sys.nature, out = { steps: 0, metres: 0, bad: [], frameMs: [] };
  const ok = (s) => !!s && [s.center.x, s.center.y, s.center.z, s.radius].every(Number.isFinite);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (const f of (N.veg && N.veg.forests) || []) { f.maxTickMs = 0; f.maxTickQuads = 0; f.ticks = 0; f.tickMs = 0; }
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) {
      const x = ax + (bx - ax) * (k / n), z = az + (bz - az) * (k / n);
      try { await G.sys.player.teleport(x, z, Math.atan2(bx - ax, bz - az), { fade: false, silent: true }); } catch (err) { out.teleportError = String(err); }
      const t0 = performance.now();
      await frame(); await frame();
      out.frameMs.push(Math.round(performance.now() - t0));
      out.steps++; out.metres += len / n;
      for (const f of (N.veg && N.veg.forests) || []) for (const m of [f.b0.mesh, f.b1.mesh]) if (!ok(m.geometry.boundingSphere)) out.bad.push(`${m.name}@${out.steps}`);
    }
  }
  out.lod = N.lodStats ? N.lodStats() : null;
  // what one update may write: the budget plus the tree that crosses it (the largest full-detail template)
  let big = 0;
  const V = N.veg;
  if (V && V.templates) for (const sp of V.SPECIES) for (const t of V.templates[sp]) big = Math.max(big, t[0].n);
  out.budget = V && V.LOD ? V.LOD.budget + big : null;
  out.glError = e.renderer.getContext().getError();
  return out;
};
async function vegetationChecks({ page, preset, tag, N, view }) {
  const st = await page.evaluate(pageVegState, VEG_KEYS);
  N.veg = { real: st.real, trees: st.counts.trees, grass: st.counts.grass };
  if (preset === 'low') {
    const plain = st.real === false && (st.counts.grass || 0) === 0 && st.names.some((n) => /^trees-campus-/.test(n)) && !st.names.some((n) => /-(near|mid|far)$/.test(n));
    check(`${tag} vegetation: low keeps the plain trees and has no grass (nothing changed)`, plain, JSON.stringify({ real: st.real, grass: st.counts.grass, trees: st.counts.trees }));
    check(`${tag} vegetation: every bounding sphere is finite`, st.bad.length === 0, st.bad.slice(0, 6).join(', '));
    return;
  }
  const B = VEG_BUDGET[preset];
  check(`${tag} vegetation: the real trees, grass and rocks are on`, st.real === true && !!st.lod && st.lod.forests.length >= 1 && (st.counts.grass || 0) > 0, JSON.stringify({ real: st.real, forests: st.lod && st.lod.forests.length, grass: st.counts.grass }));
  N.veg.views = {};
  for (const v of VIEWS) {
    await view(v);
    const m = await page.evaluate(pageVegMeasure, VEG_KEYS);
    const f = (m.lod && m.lod.forests[0]) || {};
    N.veg.views[v.id] = { calls: m.calls, tris: m.tris, near: f.near, mid: f.mid };
    check(`${tag} ${v.label}: vegetation ≤ ${B.calls} draw calls in the colour pass`, m.calls > 0 && m.calls <= B.calls, `${m.calls} (${f.near} trees in full detail, ${f.mid} reduced, ${f.trees} in all)`);
    check(`${tag} ${v.label}: vegetation ≤ ${(B.tris / 1e6).toFixed(2)} M triangles in the colour pass`, m.tris > 0 && m.tris <= B.tris, `${(m.tris / 1e6).toFixed(3)} M`);
  }
  if (flag('--no-veg-walk')) return;
  // a 200 m walk: trees change level many times
  await page.evaluate(pageSetView, [VEG_WALK[0][0], VEG_WALK[0][1], 0, DAY_HOUR]);
  await page.waitForTimeout(Math.max(1500, SETTLE / 3));
  const before = await page.evaluate(pageVegState, VEG_KEYS);
  const w = await page.evaluate(pageVegWalk, [VEG_WALK, 6]);
  const after = await page.evaluate(pageVegState, VEG_KEYS);
  const f0 = (before.lod && before.lod.forests[0]) || {}, f1 = (w.lod && w.lod.forests[0]) || {};
  const sorted = w.frameMs.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)] || 0, max = sorted[sorted.length - 1] || 0;
  const written = (f1.writes || 0) - (f0.writes || 0);
  N.veg.walk = { metres: Math.round(w.metres), steps: w.steps, written, longestLevelUpdateMs: f1.maxTickMs, meanLevelUpdateMs: f1.meanTickMs, mostQuadsInOneUpdate: f1.maxTickQuads, full: f1.full, frameMedianMs: med, frameLongestMs: max };
  check(`${tag} vegetation walk (${Math.round(w.metres)} m in ${w.steps} steps): trees changed their level of detail`, written > 0, `${written} trees written; longest level update ${f1.maxTickMs} ms; frames of two: median ${med} ms, longest ${max} ms`);
  check(`${tag} vegetation walk: no broken bounding sphere, no batch overflow`, w.bad.length === 0 && after.bad.length === 0 && !(f1.full > 0), JSON.stringify({ during: w.bad.slice(0, 4), after: after.bad.slice(0, 4), full: f1.full || 0 }));
  // the work of one update is bounded by its budget (the same on every machine); its time is reported, and judged by
  // the mean so that a slice lost to another process on a busy test machine does not fail the run
  check(`${tag} vegetation walk: one level update writes no more than its budget (≤ ${w.budget} quads)`, Number.isFinite(f1.maxTickQuads) && f1.maxTickQuads > 0 && f1.maxTickQuads <= w.budget, `${f1.maxTickQuads} quads at most`);
  check(`${tag} vegetation walk: level updates are short (mean ≤ 10 ms of script time)`, Number.isFinite(f1.meanTickMs) && f1.meanTickMs <= 10, `mean ${f1.meanTickMs} ms over ${f1.ticks} updates, longest ${f1.maxTickMs} ms`);
  check(`${tag} vegetation walk: no GL error`, w.glError === 0, String(w.glError));
}

// ---------------------------------------------------------------- [render-light] light, post chain, dynamic resolution (CONTRACT §16.3)
// ONE marked section, called once per preset from runPreset (before the error checks):
//   low            direct render as ever: no post chain, no depth texture, render scale 1, ACES, no shadow map, a
//                  sky-only environment, no photographed clouds
//   medium, high   the post chain in its order (high: ScenePass → AOPass → NaNScrub → Bloom → Atmos → Output), the scene
//                  depth texture holds the frame, the chain's memory is inside 260 MB, the shadow frustum sits on its
//                  texel grid wherever the player stands, the environment holds the ground, the cloud layer is on;
//                  an artificial slow frame lowers the render scale (AO first on high) while the canvas and the
//                  renderer's pixel ratio stay, fast frames bring everything back; a lost and restored WebGL context
//                  keeps the post chain (skip with --no-context-loss)
//   every preset   a 20 s tour day → dusk → night → rain: the screen watchdog never trips, the preset stays
const pageLight = () => {
  const G = window.G, E = G.sys.engine, R = E.renderer, A = window.THREE_ADDONS || {}, W = G.sys.weather;
  const name = (p) => (A.UnrealBloomPass && p instanceof A.UnrealBloomPass ? 'UnrealBloomPass' : A.OutputPass && p instanceof A.OutputPass ? 'OutputPass' : (typeof p.name === 'string' && p.name) || (p.material && p.material.name) || 'Pass');
  const out = { quality: E.quality, passes: E.composer ? E.composer.passes.filter((p) => p.enabled !== false).map(name) : null };
  out.post = E.postInfo; out.depth = E.depthState; out.scale = E.renderScale; out.tone = E.tone; out.gpu = E.gpu || null;
  out.shadowOn = !!(R.shadowMap.enabled && E.sun && E.sun.castShadow);
  out.shadow = E.sun && E.sun.shadow ? { size: E.sun.shadow.mapSize.x, R: E._sh ? E._sh.R : null, texel: E._sh ? E._sh.texel : null, bias: E.sun.shadow.bias, normalBias: E.sun.shadow.normalBias } : null;
  out.envProxy = !!(E._envProxy && E._envProxy.visible); out.envBakes = E.envBakes || 0; out.envIntensity = E.scene.environmentIntensity;
  out.skyTex = !!(W && W._skyTexOn); out.hemi = E.hemi ? +E.hemi.intensity.toFixed(3) : null; out.sun = E.sun ? +E.sun.intensity.toFixed(3) : null;
  if (E.composer && typeof E.debugDepth === 'function') {
    E.render({ force: true });
    const d = E.debugDepth(48, 27);
    if (d) { let geo = 0, min = Infinity; const seen = new Set(); for (const z of d.depth) if (z > 0) { geo++; if (z < min) min = z; seen.add(Math.round(z * 4)); } out.depthProbe = { cells: d.depth.length, geo, min: Number.isFinite(min) ? +min.toFixed(2) : null, distinct: seen.size }; }
  }
  // the shadow frustum centre in light space, for five places a few steps apart: always on the texel grid
  if (out.shadowOn && E._sh && typeof E.placeKeyLight === 'function') {
    const keep = E.focus.clone(), T = E._sh.texel, worst = [];
    for (let i = 0; i < 5; i++) {
      E.focus.set(keep.x + i * 0.37, keep.y, keep.z - i * 0.53);
      E.placeKeyLight();
      const c = E.sun.target.position, d = E.sun.position.clone().sub(c).normalize();
      const xl = Math.hypot(d.z, d.x), x = { x: d.z / xl, y: 0, z: -d.x / xl };
      const y = { x: d.y * x.z - d.z * x.y, y: d.z * x.x - d.x * x.z, z: d.x * x.y - d.y * x.x };
      const px = (c.x * x.x + c.y * x.y + c.z * x.z) / T, py = (c.x * y.x + c.y * y.y + c.z * y.z) / T;
      worst.push(Math.max(Math.abs(px - Math.round(px)), Math.abs(py - Math.round(py))));
    }
    E.focus.copy(keep); E.placeKeyLight();
    out.snap = +Math.max(...worst).toFixed(5);
  }
  return out;
};
/** the frame on the canvas right now: share of black pixels, mean brightness */
const pageFrame = () => {
  const G = window.G, E = G.sys.engine, R = E.renderer;
  E.render({ force: true });
  const cv = R.domElement, c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(cv, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let black = 0, sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] < 6 && d[i + 1] < 6 && d[i + 2] < 6) black++; sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++; }
  return { black: n ? black / n : 1, mean: n ? sum / n : 0, calls: E.frameInfo.calls, post: E.frameInfo.post, glError: R.getContext().getError(), canvas: [cv.width, cv.height] };
};
async function lightChecks({ page, preset, tag, N, view, shot }) {
  const L = (N.light = {});
  // with --shots every preset leaves the six fixed views (high saves its five day views and the night in the budget loop)
  if (shotDir && preset !== 'high') { for (const v of VIEWS) { await view(v); await shot(v.id); } await view(VIEWS[1], 21); await shot('night'); }
  await view(VIEWS[1]);
  const st = await page.evaluate(pageLight);
  L.state = { passes: st.passes, post: st.post, scale: st.scale, tone: st.tone, shadow: st.shadow, envIntensity: st.envIntensity, hemi: st.hemi, sun: st.sun, depthProbe: st.depthProbe || null, snap: st.snap ?? null, gpu: st.gpu };
  if (preset === 'low') {
    check(`${tag} light: low renders directly — no post chain, no depth texture, render scale 1, ACES, no shadow map, sky-only environment, no cloud texture`,
      st.passes === null && !st.depth.valid && st.scale === 1 && st.tone === 'aces' && !st.shadowOn && !st.envProxy && !st.skyTex, JSON.stringify({ passes: st.passes, depth: st.depth.valid, scale: st.scale, tone: st.tone, shadows: st.shadowOn, envProxy: st.envProxy, skyTex: st.skyTex }));
  } else {
    const want = preset === 'high' ? ['ScenePass', 'AOPass', 'NaNScrubShader', 'UnrealBloomPass', 'AtmosGradeShader', 'OutputPass'] : ['ScenePass', 'AtmosGradeShader', 'OutputPass'];
    check(`${tag} post chain: ${want.join(' → ')}`, JSON.stringify(st.passes) === JSON.stringify(want), (st.passes || []).join(' → '));
    const dp = st.depthProbe;
    check(`${tag} the scene depth texture holds the frame (resolved from the ${st.post.samples}× multisampled target)`, !!dp && st.depth.valid && st.post.samples > 0 && dp.geo > dp.cells * 0.2 && dp.min !== null && dp.min < 40 && dp.distinct > 12, JSON.stringify({ depth: st.depth, probe: dp }));
    check(`${tag} post chain memory inside the 260 MB budget`, st.post.bytes > 0 && st.post.bytes <= st.post.budget, `${(st.post.bytes / 1048576).toFixed(0)} MB at ${st.post.width}×${st.post.height}, MSAA ${st.post.samples}×`);
    check(`${tag} shadows: the frustum centre sits on the shadow texel grid at every step (no shimmer while walking)`, st.shadowOn && st.snap !== undefined && st.snap < 0.01, `worst offset ${st.snap} texel · map ${st.shadow && st.shadow.size} px · texel ${st.shadow && st.shadow.texel ? (st.shadow.texel * 100).toFixed(1) : '?'} cm · R ${st.shadow && st.shadow.R} m`);
    check(`${tag} environment: the ground and the ridges are in the bake (terrain proxy)`, st.envProxy && st.envBakes > 0, JSON.stringify({ proxy: st.envProxy, bakes: st.envBakes, intensity: st.envIntensity }));
    check(`${tag} sky: the photographed cloud layer is built from the pack's two sky images`, st.skyTex === true, String(st.skyTex));
  }
  // ---- 20 s tour: day → dusk → night → rain; the watchdog looks at every stop
  const tour = [];
  for (const [name, hour, wx] of [['day', 10, 'CLEAR'], ['dusk', 18.5, 'CLEAR'], ['night', 21.5, 'CLEAR'], ['rain', 14, 'RAIN']]) {
    await page.evaluate(([h, w]) => { const W = window.G.sys.weather; W.setLockTime(true); W.setAuto(false); W.setHour(h); W.set(w, { instant: true }); }, [hour, wx]);
    await page.waitForTimeout(5000);
    tour.push(await page.evaluate((name) => {
      const G = window.G, wd = G.gfx.guard.watchdog, r = wd.probeNow();
      return { name, step: wd.step, black: r ? +r.black.toFixed(4) : null, white: r ? +r.white.toFixed(4) : null, anomaly: r ? !!r.anomaly : null, block: r && r.block ? `${r.block.kind} ${(r.block.frac * 100).toFixed(1)} %` : null, composer: !!G.sys.engine.composer, quality: G.sys.engine.quality };
    }, name));
    await shot(`tour-${name}`);
  }
  L.tour = tour;
  check(`${tag} tour day → dusk → night → rain (20 s): the screen watchdog never trips and the preset stays`, tour.length === 4 && tour.every((t) => t.step === 0 && t.anomaly === false && t.quality === preset && (preset === 'low' || t.composer)), JSON.stringify(tour));
  await view(VIEWS[1]);
  if (preset === 'low') return;
  // ---- dynamic resolution: an artificial slow frame, then fast ones (the controller's clock is stepped by hand)
  const base = await page.evaluate(pageFrame);
  const drs = await page.evaluate(() => {
    const G = window.G, E = G.sys.engine, R = E.renderer, D = E._drs;
    const keep = { on: D.on, upWait: D.upWait, restLen: D.restLen };
    const size = () => ({ w: E.postInfo.width, h: E.postInfo.height, pr: R.getPixelRatio(), cw: R.domElement.width, ch: R.domElement.height, scale: +E.renderScale.toFixed(3), level: D.level, ao: E.aoPass ? E.aoPass.enabled : null });
    const order = [];
    const out = { before: size(), min: Math.min(D.min, D.cap), cap: D.cap };
    Object.assign(D, { on: true, full: false, ema: 0, slow: 0, fast: 0, cool: 0, rest: 0, restLen: 30, upWait: 3, trial: null, _lastUpAt: 0 });
    const tick = (ms, s) => { for (let t = 0; t < s; t += 0.25) { const s0 = D.scale, l0 = D.level; D.inject = ms(); E._drsTick(0.25); if (D.level !== l0) order.push('level' + D.level); if (D.scale !== s0) order.push(D.scale < s0 ? 'down' : 'up'); } };
    tick(() => 62 * (D.scale * D.scale) / (D.cap * D.cap) * (D.level >= 1 && out.before.ao ? 0.93 : 1), 60);
    out.slow = size(); out.order = order.slice();
    out.keep = keep;
    return out;
  });
  const slowFrame = await page.evaluate(pageFrame);
  await shot('drs-slow');
  const back = await page.evaluate((keep) => {
    const G = window.G, E = G.sys.engine, R = E.renderer, D = E._drs;
    for (let t = 0; t < 90; t += 0.25) { D.inject = 9; E._drsTick(0.25); }
    const r = { w: E.postInfo.width, h: E.postInfo.height, pr: R.getPixelRatio(), cw: R.domElement.width, ch: R.domElement.height, scale: +E.renderScale.toFixed(3), level: D.level, ao: E.aoPass ? E.aoPass.enabled : null };
    D.inject = null; D.on = keep.on; D.upWait = keep.upWait; D.restLen = keep.restLen; D.ema = 0; D.slow = D.fast = 0; D.trial = null;
    E._setScale(D.cap, 'test-end');
    return r;
  }, drs.keep);
  L.drs = { before: drs.before, slow: drs.slow, back, order: drs.order, slowFrame: { black: +slowFrame.black.toFixed(4), mean: +slowFrame.mean.toFixed(1) }, baseMean: +base.mean.toFixed(1) };
  const b = drs.before, s = drs.slow;
  check(`${tag} dynamic resolution: an artificial slow frame (62 ms) lowers the render scale${b.ao ? ', AO shed first' : ''}`,
    s.scale < b.scale - 0.05 && s.scale >= drs.min - 1e-3 && s.w < b.w && (!b.ao || (drs.order[0] === 'level1' && s.ao === false)), `scale ${b.scale} → ${s.scale} (range ${drs.min.toFixed(2)}–${drs.cap.toFixed(2)}), scene target ${b.w}×${b.h} → ${s.w}×${s.h}, order ${drs.order.slice(0, 4).join(' ')}`);
  check(`${tag} dynamic resolution: the canvas and the renderer's pixel ratio stay as they were`, s.pr === b.pr && s.cw === b.cw && s.ch === b.ch, `pixel ratio ${b.pr} → ${s.pr}, canvas ${b.cw}×${b.ch} → ${s.cw}×${s.ch}`);
  check(`${tag} dynamic resolution: the frame at the lower scale is the same picture`, slowFrame.black < BLACK_MAX && Math.abs(slowFrame.mean - base.mean) < base.mean * 0.12 + 2 && slowFrame.glError === 0, `mean ${base.mean.toFixed(1)} → ${slowFrame.mean.toFixed(1)}, black ${(slowFrame.black * 100).toFixed(2)} %`);
  check(`${tag} dynamic resolution: fast frames (9 ms) bring the scale${b.ao ? ' and AO' : ''} back`, Math.abs(back.scale - b.scale) < 1e-3 && back.level === 0 && back.w === b.w && back.ao === b.ao, JSON.stringify(back));
  // ---- a lost and restored WebGL context keeps the post chain
  if (flag('--no-context-loss')) return;
  const before = await page.evaluate(pageFrame);
  const lost = await page.evaluate(async () => {
    const E = window.G.sys.engine, R = E.renderer, gl = R.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { skipped: true };
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 1500));
    const during = E._isLost();
    ext.restoreContext();
    const t0 = performance.now();
    while (performance.now() - t0 < 120000) { await new Promise((r) => setTimeout(r, 500)); if (!gl.isContextLost() && !E._isLost()) break; }
    return { during, lost: gl.isContextLost(), ms: Math.round(performance.now() - t0) };
  });
  if (lost.skipped) { check(`${tag} context loss: the post chain comes back`, true, 'WEBGL_lose_context is not available: skipped'); return; }
  await page.waitForTimeout(3000);
  await view(VIEWS[1]);
  const after = await page.evaluate(pageFrame);
  const st2 = await page.evaluate(pageLight);
  await shot('restored');
  L.restore = { ms: lost.ms, passes: st2.passes, before: { mean: +before.mean.toFixed(1), calls: before.calls }, after: { mean: +after.mean.toFixed(1), calls: after.calls, black: +after.black.toFixed(4) } };
  check(`${tag} context loss: after WEBGL_lose_context + restore the post chain is back with every pass`, lost.during === true && !lost.lost && JSON.stringify(st2.passes) === JSON.stringify(st.passes) && st2.depth.valid && !!st2.depthProbe && st2.depthProbe.geo > 0, `${(st2.passes || []).join(' → ')} · depth ${JSON.stringify(st2.depthProbe)} · restored after ${lost.ms} ms`);
  check(`${tag} context loss: the restored frame is the same picture (post effects kept)`, after.black < BLACK_MAX && Math.abs(after.mean - before.mean) < before.mean * 0.12 + 2 && after.glError === 0 && after.post === before.post, `mean ${before.mean.toFixed(1)} → ${after.mean.toFixed(1)}, post draw calls ${before.post} → ${after.post}, black ${(after.black * 100).toFixed(2)} %`);
}

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
    await vegetationChecks({ page, preset, tag, N, view });   // [render-nature] §16.2 (console / page errors of the walk are caught below)
    await lightChecks({ page, preset, tag, N, view, shot });   // [render-light] §16.3: post chain, depth, shadows, tour, dynamic resolution, context loss
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
