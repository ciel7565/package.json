// =============================================================================
// 06-world.js — world query/registry layer shared by terrain, buildings, player, NPCs.
//
//   G.world.setTerrain(fn(x,z)->y)          terrain module installs the height function
//   G.world.terrainHeight(x,z)              raw terrain height
//   G.world.heightAt(x,z, fromY?)           ground under a walker (terrain + walkable platforms + the top of a low
//                                           collider the walker is already standing on, see heightAt)
//   G.world.addWalkable({shape:'box',x,z,hw,hd,rot,top} | {shape:'circle',x,z,r,top}) -> id
//   G.world.addCollider({shape:'circle',x,z,r,minY?,maxY?,stand?,tag?} | {shape:'box',x,z,hw,hd,rot,...}) -> id
//                                           stand:false = the top (maxY) never carries a walker (foliage, small
//                                           decor): it only decides blocking; a walker that lands on it slides off
//   G.world.removeCollider(id) / removeWalkable(id)
//   G.world.resolve(pos:Vector3, radius, feetY?) pushes pos (XZ) out of colliders; returns true if hit
//   G.world.setWaterFn(fn) / isWater(x,z)    river/pond test (not walkable)
//   G.world.setSurfaceFn(fn) / surfaceAt(x,z) 'grass'|'dirt'|'stone'|'road'|'wood'|'water'|'sand'
//   G.world.zoneAt(x,z) -> zone (G.data.zones entry or G.data.defaultZone)
//   G.world.poiAt(x,z)  -> poi or null
//   G.world.registerObject(id, object3d) / getObject(id)   anchor id -> built mesh/group
//   G.world.groundMeshes[]   meshes used for click-to-move raycasts
//   G.world.cameraBlockers[] meshes the camera should not clip through
//   G.world.clampToBounds(pos)
// =============================================================================
(function () {
  const CELL = 8;
  const STEP = 0.62; // max step-up height for walkers
  const colliders = new Map();
  const walkables = new Map();
  // spatial hashes: cell key -> array of shapes. Queries are allocation-free (they run for every collision
  // sub-step and every planner sample): no Sets, no iterators, a query stamp de-duplicates shapes in several cells.
  const grid = new Map();   // colliders
  const wgrid = new Map();  // walkables + the low colliders (maxY: rocks, crags, skirts…) whose tops carry walkers
  let nextId = 1;
  let qstamp = 0;
  const _near = [];         // result buffer of near(): entries [0, n) are valid (callers never nest queries; the
                            // array is never truncated, so its backing store is reused instead of reallocated)

  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  /** half extents of shape s's world AABB -> s._ex / s._ez */
  function extents(s) {
    if (s.shape === 'circle') { s._ex = s._ez = s.r; return; }
    const c = Math.abs(Math.cos(s.rot || 0)), n = Math.abs(Math.sin(s.rot || 0));
    s._ex = s.hw * c + s.hd * n; s._ez = s.hw * n + s.hd * c;
  }
  /** add shape s to the cells of grid g it overlaps; the cell keys are kept in `cells` (reused array) */
  function insert(g, s, cells) {
    extents(s);
    const ex = s._ex, ez = s._ez;
    cells.length = 0;
    for (let cx = Math.floor((s.x - ex) / CELL); cx <= Math.floor((s.x + ex) / CELL); cx++) {
      for (let cz = Math.floor((s.z - ez) / CELL); cz <= Math.floor((s.z + ez) / CELL); cz++) {
        const k = key(cx, cz);
        let arr = g.get(k);
        if (!arr) { arr = []; g.set(k, arr); }
        arr.push(s);
        cells.push(k);
      }
    }
  }
  function removeFrom(g, s, cells) {
    for (let i = 0; i < cells.length; i++) {
      const arr = g.get(cells[i]);
      const j = arr ? arr.indexOf(s) : -1;
      if (j >= 0) { arr[j] = arr[arr.length - 1]; arr.pop(); }
    }
    cells.length = 0;
  }
  /** shapes of grid g whose cells touch the square (x ± r, z ± r) -> how many; they are _near[0 .. n-1] */
  function near(g, x, z, r) {
    const q = ++qstamp, out = _near;
    let n = 0;
    const cx1 = Math.floor((x + r) / CELL), cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let cx = Math.floor((x - r) / CELL); cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = g.get(key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) { const s = arr[i]; if (s._q !== q) { s._q = q; out[n++] = s; } }
      }
    return n;
  }
  /** world coords of a point given in an oriented box's local frame (rotation around Y, matches THREE rotation.y) */
  function toWorld(s, lx, lz) {
    const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0);
    return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
  }
  function contains(s, x, z, pad = 0) {
    const dx = x - s.x, dz = z - s.z;
    if (s.shape === 'circle') return dx * dx + dz * dz <= (s.r + pad) * (s.r + pad);
    const r = s.rot || 0, c = Math.cos(r), n = Math.sin(r); // local box coords (inverse of toWorld)
    return Math.abs(dx * c - dz * n) <= s.hw + pad && Math.abs(dx * n + dz * c) <= s.hd + pad;
  }
  /** is collider c in the way of a walker whose feet are at fy? (low tops are stepped over, high ones walked under) */
  const active = (c, fy) => !c.disabled && !(c.maxY != null && fy >= c.maxY - 0.05) && !(c.minY != null && fy + 1.6 <= c.minY);

  const world = {
    STEP,
    bounds: { minX: -135, maxX: 135, minZ: -135, maxZ: 135 },
    _terrain: () => 0,
    _water: () => false,
    _surface: null,
    objects: {},
    groundMeshes: [],
    cameraBlockers: [],
    /** materials whose emissive glows at night (windows, lanterns): weather scales emissiveIntensity by nightFactor */
    nightMaterials: [],   // [{ material, day: 0, night: 1.6 }]
    /** lights switched on at night: [{ light, intensity }] */
    nightLights: [],
    /** 0 = full day, 1 = full night (set by the weather system every frame) */
    nightFactor: 0,
    /** helper: register a night-glowing material */
    addNightMaterial(material, night = 1.5, day = 0) { world.nightMaterials.push({ material, night, day }); material.emissiveIntensity = day; return material; },
    addNightLight(light, intensity) { world.nightLights.push({ light, intensity: intensity ?? light.intensity }); light.intensity = 0; return light; },
    colliders, walkables,

    setTerrain(fn) { world._terrain = fn; },
    terrainHeight(x, z) { return world._terrain(x, z); },
    setWaterFn(fn) { world._water = fn; },
    isWater(x, z) { return world._water(x, z); },
    setSurfaceFn(fn) { world._surface = fn; },
    surfaceAt(x, z) {
      const n = near(wgrid, x, z, 0);
      for (let i = 0; i < n; i++) { const w = _near[i]; if (w.surface && contains(w, x, z)) return w.surface; }
      return world._surface ? world._surface(x, z) : 'grass';
    },

    addWalkable(w) {
      const id = nextId++;
      const s = { shape: 'box', rot: 0, ...w, id };
      walkables.set(id, s); insert(wgrid, s, s._cells = []);
      return id;
    },
    removeWalkable(id) { const s = walkables.get(id); if (s) { removeFrom(wgrid, s, s._cells); walkables.delete(id); } },

    /**
     * ground height for a walker whose feet are at fromY (platforms above fromY+STEP are ignored).
     * The top (maxY) of a low collider (rock, crag, skirt — not one added with stand:false) carries a walker that is already up there
     * (fromY >= maxY — the same rule resolve() uses to let the walker pass over it): crossing a boulder half
     * buried in a slope keeps the feet on the boulder until they leave it, instead of sinking into it and being
     * shoved out sideways. fromY = Infinity (surfaceHeight, spawning objects) ignores collider tops.
     */
    heightAt(x, z, fromY = Infinity) {
      let h = world._terrain(x, z);
      const n = near(wgrid, x, z, 0);
      for (let i = 0; i < n; i++) {
        const w = _near[i];
        if (w._top) {   // a low collider: only for a walker already up there (fromY = Infinity never)
          if (w.disabled || !(w.maxY > h) || w.maxY > fromY || fromY === Infinity) continue;
          if (w.minY != null && fromY + 1.6 <= w.minY) continue;
          if (contains(w, x, z)) h = w.maxY;
        } else if (w.top <= fromY + STEP && w.top > h && contains(w, x, z)) h = w.top;
      }
      return h;
    },
    /** highest walkable/terrain regardless of step (for spawning objects) */
    surfaceHeight(x, z) { return world.heightAt(x, z, Infinity); },

    addCollider(c) {
      const id = nextId++;
      const s = { shape: 'circle', rot: 0, ...c, id };
      if (s.shape === 'box') { s.hw = s.hw ?? (s.w || 1) / 2; s.hd = s.hd ?? (s.d || 1) / 2; }
      colliders.set(id, s); insert(grid, s, s._cells = []);
      // a standable top carries walkers (heightAt); stand:false (shrubs, small decor) keeps maxY for blocking only
      if (Number.isFinite(s.maxY) && s.stand !== false) { s._top = true; insert(wgrid, s, s._tcells = []); }
      return id;
    },
    removeCollider(id) {
      const s = colliders.get(id);
      if (!s) return;
      removeFrom(grid, s, s._cells);
      if (s._tcells) removeFrom(wgrid, s, s._tcells);
      colliders.delete(id);
    },
    moveCollider(id, x, z) {
      const s = colliders.get(id);
      if (!s || !Number.isFinite(x) || !Number.isFinite(z) || (s.x === x && s.z === z)) return;
      // (walking NPCs move every frame: while the shape stays in the same grid cells nothing is re-filed)
      const f = Math.floor, ex = s._ex, ez = s._ez;
      if (f((x - ex) / CELL) === f((s.x - ex) / CELL) && f((x + ex) / CELL) === f((s.x + ex) / CELL)
        && f((z - ez) / CELL) === f((s.z - ez) / CELL) && f((z + ez) / CELL) === f((s.z + ez) / CELL)) { s.x = x; s.z = z; return; }
      removeFrom(grid, s, s._cells);
      if (s._tcells) removeFrom(wgrid, s, s._tcells);
      s.x = x; s.z = z;
      insert(grid, s, s._cells);
      if (s._tcells) insert(wgrid, s, s._tcells);
    },

    /**
     * push pos (THREE.Vector3 or {x,z}) out of colliders overlapping a cylinder of `radius`
     * standing at feetY (colliders with maxY below feet or minY above head are ignored).
     */
    resolve(pos, radius = 0.35, feetY = null) {
      let hit = false;
      const fy = feetY ?? pos.y ?? 0;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        const n = near(grid, pos.x, pos.z, radius + 0.5);
        for (let i = 0; i < n; i++) {
          const c = _near[i];
          if (!active(c, fy)) continue;
          if (c.shape === 'circle') {
            const dx = pos.x - c.x, dz = pos.z - c.z;
            const d = Math.hypot(dx, dz), min = c.r + radius;
            if (d < min) {
              const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
              pos.x = c.x + nx * min; pos.z = c.z + nz * min; hit = moved = true;
            }
          } else {
            const ro = c.rot || 0, co = Math.cos(ro), sn = Math.sin(ro);
            const wx0 = pos.x - c.x, wz0 = pos.z - c.z;
            const lx = wx0 * co - wz0 * sn, lz = wx0 * sn + wz0 * co;   // local box coords
            const cx = G.util.clamp(lx, -c.hw, c.hw), cz = G.util.clamp(lz, -c.hd, c.hd);
            const dx = lx - cx, dz = lz - cz;
            const d = Math.hypot(dx, dz);
            if (d < radius) {
              let nlx, nlz;
              if (d < 1e-5) { // center inside the box: push out along the shallowest axis
                const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
                if (px < pz) { nlx = (lx >= 0 ? c.hw : -c.hw) + (lx >= 0 ? radius : -radius); nlz = lz; }
                else { nlz = (lz >= 0 ? c.hd : -c.hd) + (lz >= 0 ? radius : -radius); nlx = lx; }
              } else { nlx = cx + (dx / d) * radius; nlz = cz + (dz / d) * radius; }
              pos.x = c.x + nlx * co + nlz * sn; pos.z = c.z - nlx * sn + nlz * co;   // toWorld
              hit = moved = true;
            }
          }
        }
        if (!moved) break;
      }
      return hit;
    },
    /** would a walker of radius r at (x,z) with feet at feetY overlap anything? (same height rules as resolve) */
    blocked(x, z, r = 0.35, feetY = 0) {
      const n = near(grid, x, z, r + 0.5);
      for (let i = 0; i < n; i++) {
        const c = _near[i];
        if (active(c, feetY) && contains(c, x, z, r)) return true;
      }
      return world.isWater(x, z);
    },

    clampToBounds(pos) {
      const b = world.bounds;
      pos.x = G.util.clamp(pos.x, b.minX, b.maxX);
      pos.z = G.util.clamp(pos.z, b.minZ, b.maxZ);
      return pos;
    },

    zoneAt(x, z) {
      let best = null;
      for (const zn of G.data.zones || []) {
        const dx = x - zn.center[0], dz = z - zn.center[1];
        if (dx * dx + dz * dz <= zn.r * zn.r && (!best || zn.r < best.r)) best = zn;
      }
      return best || G.data.defaultZone;
    },
    poiAt(x, z) {
      for (const p of G.data.pois || []) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz <= p.r * p.r) return p; }
      return null;
    },
    zoneById(id) { return (G.data.zones || []).find((z) => z.id === id) || (id === G.data.defaultZone?.id ? G.data.defaultZone : null); },

    registerObject(id, obj) { world.objects[id] = obj; if (obj) obj.userData.anchorId = id; G.bus.emit('world:object', { id, obj }); return obj; },
    getObject(id) { return world.objects[id] || null; },
    anchor(id) { return G.data.layout?.get?.(id) || null; },

    /** debug: draw colliders/walkables as lines (toggle) */
    debugDraw(on) {
      const scene = G.sys.engine?.scene;
      if (!scene) return;
      if (world._debug) { scene.remove(world._debug); world._debug.traverse((o) => o.geometry?.dispose?.()); world._debug = null; }
      if (!on) return;
      const grp = new THREE.Group();
      const matC = new THREE.LineBasicMaterial({ color: 0xff4040 });
      const matW = new THREE.LineBasicMaterial({ color: 0x40a0ff });
      const outline = (s, y, mat) => {
        const pts = [];
        if (s.shape === 'circle') for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push(new THREE.Vector3(s.x + Math.cos(a) * s.r, y, s.z + Math.sin(a) * s.r)); }
        else for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]) { const [wx, wz] = toWorld(s, lx * s.hw, lz * s.hd); pts.push(new THREE.Vector3(wx, y, wz)); }
        grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      };
      for (const c of colliders.values()) outline(c, world.terrainHeight(c.x, c.z) + 0.15, matC);
      for (const w of walkables.values()) outline(w, w.top + 0.05, matW);
      world._debug = grp; scene.add(grp);
    },
  };
  G.world = world;
  if (G.data.layout?.bounds) Object.assign(world.bounds, G.data.layout.bounds);
})();
