// =============================================================================
// [opt] tools/mem-probe.mjs — memory and frame cost after boot and after visiting places (CONTRACT §19.4, §16.0)
//
//   node tools/smoke.mjs --file <page> --params "autostart=1&notutorial=1&quality=low" --script tools/mem-probe.mjs --json
//   env: PROBE_PLACES=PL_A,PL_B,…  (default: the first five rooms of G.sys.places.list(), then the 분양 단지 when defined)
//        PROBE_CYCLES=2            (how many times the same round of places is visited)
//        PROBE_OUT=<file.json>     (also write the result there)
//
// Snapshots (after a forced garbage collection through the DevTools protocol, two drawn frames, the same spot of the
// valley each time): JS heap (MB), DOM nodes, event listeners, renderer.info.memory geometries / textures, compiled
// programs, the last frame's draw calls / triangles (engine.frameInfo: all passes; scene = the colour pass),
// the scene's object count and the places still built. Steps: boot → each round of places (enter quietly, two
// frames, leave) → back in the valley. A leak shows as growth from round 1 to round 2 (the LRU keeps two rooms).
// It also counts frames drawn in 3 s with and without a small and a large window open (idle cost behind a modal).
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

  // idle cost: frames drawn in 3 s — nothing open, a small window, a large window
  const count = async (setup, teardown) => {
    if (setup) await page.evaluate(setup);
    await frames(2);
    const a = await page.evaluate(() => ({ d: G.sys.engine?._fl?.drawn || 0, t: performance.now() }));
    await page.waitForTimeout(3000);
    const b = await page.evaluate(() => ({ d: G.sys.engine?._fl?.drawn || 0, t: performance.now() }));
    if (teardown) await page.evaluate(teardown);
    return Math.round((b.d - a.d) / ((b.t - a.t) / 1000) * 10) / 10;
  };
  try {
    out.idle = {
      open: await count(null, null),
      smallModal: await count(() => G.ui.modal.open({ id: 'opt-probe', title: '시험', size: 'sm', body: (el) => { el.textContent = '시험'; } }), () => G.ui.modal.closeAll()),
      largeModal: await count(() => G.ui.modal.open({ id: 'opt-probe', title: '시험', size: 'lg', body: (el) => { el.textContent = '시험'; } }), () => G.ui.modal.closeAll()),
      unit: 'frames drawn per second (software GL)',
    };
  } catch (e) { out.errors.push('idle: ' + (e && e.message)); }

  const a = out.snaps[1], b = out.snaps[out.snaps.length - 1];
  if (a && b && out.snaps.length > 2) out.growth = { heapMB: Math.round((b.heapMB - a.heapMB) * 10) / 10, geometries: b.geometries - a.geometries, textures: b.textures - a.textures, programs: b.programs - a.programs, objects: b.objects - a.objects, nodes: b.nodes - a.nodes, listeners: b.listeners - a.listeners };
  if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(out, null, 1));
  return out;
};
