// =============================================================================
// [opt] tools/mem-probe.mjs — memory and frame cost after boot and after visiting places (CONTRACT §19.4, §16.0)
//
//   node tools/smoke.mjs --file <page> --params "autostart=1&notutorial=1&quality=low" --script tools/mem-probe.mjs --json
//   env: PROBE_PLACES=PL_A,PL_B,…  (default: the first five rooms of G.sys.places.list(), then the 분양 단지 when defined)
//        PROBE_CYCLES=2            (how many times the same round of places is visited)
//        PROBE_OUT=<file.json>     (also write the result there)
//        PROBE_SETTLE=30           (frames drawn in the valley before the 'settled' baseline)
//        PROBE_IDLE_ONLY=1         (only boot, settled and the idle share — no visits)
//
// Snapshots (after a forced garbage collection through the DevTools protocol, two drawn frames, the same spot of the
// valley each time): JS heap (MB), DOM nodes, event listeners, renderer.info.memory geometries / textures, compiled
// programs, the last frame's draw calls / triangles (engine.frameInfo: all passes; scene = the colour pass),
// the scene's object count and the places still built. Steps: boot → each round of places (enter quietly, two
// frames, leave) → back in the valley. A leak shows as growth from round 1 to round 2 (the LRU keeps two rooms).
// It also measures the idle cost behind a window: the share of render calls that draw, with nothing, a small and a
// large window open.
// =============================================================================
import fs from 'node:fs';

export default async (page, ctx) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const cycles = Math.max(1, Number(process.env.PROBE_CYCLES || 2) | 0);

  const frames = (n = 2) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const drawn = async (n) => { const t = Date.now(); const d0 = await page.evaluate(() => G.sys.engine?._fl?.drawn || 0); while (Date.now() - t < 120000) { await frames(1); const d = await page.evaluate(() => G.sys.engine?._fl?.drawn || 0); if (d - d0 >= n) return; } };

  async function snap(label) {
    await drawn(2);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const r = await page.evaluate(() => {
      const E = G.sys.engine, R = E?.renderer, i = R?.info;
      let objects = 0, meshes = 0;
      E?.scene?.traverse?.((o) => { objects++; if (o.isMesh || o.isInstancedMesh) meshes++; });
      return {
        quality: E?.quality, place: G.sys.places?.current || null,
        geometries: i?.memory?.geometries, textures: i?.memory?.textures, programs: i?.programs?.length,
        calls: E?.frameInfo?.calls, scene: E?.frameInfo?.scene, triangles: E?.frameInfo?.triangles,
        objects, meshes, built: (G.sys.places?.built?.() || []).map((b) => b.id),
        heapApi: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null,
      };
    });
    return { label, heapMB: Math.round(m.JSHeapUsedSize / 1e5) / 10, nodes: m.Nodes, listeners: m.JSEventListeners, ...r };
  }

  const out = { snaps: [], visits: [], idle: null, errors: [] };
  out.snaps.push(await snap('boot'));
  // what the valley builds after the first frames (deferred work) is part of the baseline, not of a visit
  await drawn(Number(process.env.PROBE_SETTLE || 30));
  out.snaps.push(await snap('settled'));
  // idle cost: of the engine's render calls (one per display frame), how many draw — nothing open, a small and a large
  // window open. (Frames per second mean nothing on a loaded software-GL machine; this share is what the code decides.)
  const share = async (setup, teardown) => {
    if (setup) await page.evaluate(setup);
    await frames(2);
    const r = await page.evaluate(() => new Promise((res) => {
      const E = G.sys.engine, own = Object.prototype.hasOwnProperty.call(E, 'render'), orig = E.render;
      let calls = 0; const d0 = E._fl.drawn, t0 = performance.now();
      E.render = function (o) { calls++; return orig.call(this, o); };
      const done = () => { if (own) E.render = orig; else delete E.render; res({ calls, drawn: E._fl.drawn - d0 }); };
      const tick = () => (calls >= 24 || performance.now() - t0 > 90000 ? done() : setTimeout(tick, 50));
      tick();
    }));
    if (teardown) await page.evaluate(teardown);
    return { ...r, share: r.calls ? Math.round((r.drawn / r.calls) * 100) / 100 : null };
  };
  try {
    out.idle = {
      open: await share(null, null),
      smallModal: await share(() => G.ui.modal.open({ id: 'opt-probe', title: '시험', size: 'sm', body: (el) => { el.textContent = '시험'; } }), () => G.ui.modal.closeAll()),
      largeModal: await share(() => G.ui.modal.open({ id: 'opt-probe', title: '시험', size: 'lg', body: (el) => { el.textContent = '시험'; } }), () => G.ui.modal.closeAll()),
      unit: 'drawn frames / render calls (1 = every display frame is drawn)',
    };
  } catch (e) { out.errors.push('idle: ' + (e && e.message)); }
  if (process.env.PROBE_IDLE_ONLY) { if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(out, null, 1)); return out; }

  const ids = await page.evaluate((want) => {
    const L = G.sys.places?.list?.() || [];
    if (want) return want.split(',').filter((id) => L.some((p) => p.id === id));
    const rooms = L.filter((p) => p.indoor).map((p) => p.id).slice(0, 5);
    if (L.some((p) => p.id === 'PL_ALLOT')) rooms.push('PL_ALLOT');
    return rooms;
  }, process.env.PROBE_PLACES || '');
  out.places = ids;
  const home = await page.evaluate(() => { const p = G.sys.player?.position; return p ? { x: p.x, z: p.z } : null; });

  for (let c = 1; c <= cycles; c++) {
    for (const id of ids) {
      const t0 = Date.now();
      const ok = await page.evaluate(async (pid) => { try { return await G.sys.places.enter(pid, { fade: false, quiet: true }); } catch (e) { return 'error: ' + (e && e.message); } }, id);
      await drawn(2);
      const inside = await page.evaluate(() => ({ calls: G.sys.engine?.frameInfo?.calls, scene: G.sys.engine?.frameInfo?.scene, triangles: G.sys.engine?.frameInfo?.triangles, textures: G.sys.engine?.renderer?.info?.memory?.textures, geometries: G.sys.engine?.renderer?.info?.memory?.geometries }));
      await page.evaluate(async () => { try { await G.sys.places.exit({ fade: false, quiet: true }); } catch (e) { /* reported below */ } });
      out.visits.push({ cycle: c, id, ok, ms: Date.now() - t0, ...inside });
    }
    if (home) await page.evaluate(async (h) => { try { await G.sys.player.teleport?.(h.x, h.z, undefined, { fade: false }); } catch (e) { /* stays */ } }, home);
    out.snaps.push(await snap(`after round ${c}`));
  }

  const a = out.snaps[2], b = out.snaps[out.snaps.length - 1];
  if (a && b && out.snaps.length > 3) out.growth = { heapMB: Math.round((b.heapMB - a.heapMB) * 10) / 10, geometries: b.geometries - a.geometries, textures: b.textures - a.textures, programs: b.programs - a.programs, objects: b.objects - a.objects, nodes: b.nodes - a.nodes, listeners: b.listeners - a.listeners };
  if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(out, null, 1));
  return out;
};
