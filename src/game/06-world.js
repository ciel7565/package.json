// =============================================================================
// 06-world.js — world query/registry layer shared by terrain, buildings, player, NPCs.
//
//   G.world.setTerrain(fn(x,z)->y)          terrain module installs the height function
//   G.world.terrainHeight(x,z)              raw terrain height
//   G.world.heightAt(x,z, fromY?)           ground under a walker (terrain + walkable platforms)
//   G.world.addWalkable({shape:'box',x,z,hw,hd,rot,top} | {shape:'circle',x,z,r,top}) -> id
//   G.world.addCollider({shape:'circle',x,z,r,minY?,maxY?,tag?} | {shape:'box',x,z,hw,hd,rot,...}) -> id
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
  const grid = new Map();   // cell key -> Set of collider ids
  const wgrid = new Map();  // cell key -> Set of walkable ids
  let nextId = 1;

  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  function aabbOf(s) {
    if (s.shape === 'circle') return [s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r];
    const c = Math.abs(Math.cos(s.rot || 0)), n = Math.abs(Math.sin(s.rot || 0));
    const ex = s.hw * c + s.hd * n, ez = s.hw * n + s.hd * c;
    return [s.x - ex, s.z - ez, s.x + ex, s.z + ez];
  }
  function insert(g, id, s) {
    const [x0, z0, x1, z1] = aabbOf(s);
    s._cells = [];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz);
        if (!g.has(k)) g.set(k, new Set());
        g.get(k).add(id);
        s._cells.push(k);
      }
    }
  }
  function removeFrom(g, id, s) { for (const k of s._cells || []) g.get(k)?.delete(id); }
  function near(g, x, z, r) {
    const out = new Set();
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const s = g.get(key(cx, cz));
        if (s) for (const id of s) out.add(id);
      }
    return out;
  }
  /** local coords of point in an oriented box */
  function toLocal(s, x, z) {
    const c = Math.cos(-(s.rot || 0)), n = Math.sin(-(s.rot || 0));
    const dx = x - s.x, dz = z - s.z;
    // rotation around Y: x' = x cos + z sin ; z' = -x sin + z cos  (matches THREE rotation.y)
    return [dx * c + dz * n, -dx * n + dz * c];
  }
  function toWorld(s, lx, lz) {
    const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0);
    return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
  }
  function contains(s, x, z, pad = 0) {
    if (s.shape === 'circle') { const dx = x - s.x, dz = z - s.z; return dx * dx + dz * dz <= (s.r + pad) * (s.r + pad); }
    const [lx, lz] = toLocal(s, x, z);
    return Math.abs(lx) <= s.hw + pad && Math.abs(lz) <= s.hd + pad;
  }

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
      for (const id of near(wgrid, x, z, 0)) { const w = walkables.get(id); if (w && w.surface && contains(w, x, z)) return w.surface; }
      return world._surface ? world._surface(x, z) : 'grass';
    },

    addWalkable(w) {
      const id = nextId++;
      const s = { shape: 'box', rot: 0, ...w, id };
      walkables.set(id, s); insert(wgrid, id, s);
      return id;
    },
    removeWalkable(id) { const s = walkables.get(id); if (s) { removeFrom(wgrid, id, s); walkables.delete(id); } },

    /** ground height for a walker whose feet are at fromY (platforms above fromY+STEP are ignored) */
    heightAt(x, z, fromY = Infinity) {
      let h = world._terrain(x, z);
      for (const id of near(wgrid, x, z, 0)) {
        const w = walkables.get(id);
        if (!w || !contains(w, x, z)) continue;
        if (w.top <= fromY + STEP && w.top > h) h = w.top;
      }
      return h;
    },
    /** highest walkable/terrain regardless of step (for spawning objects) */
    surfaceHeight(x, z) { return world.heightAt(x, z, Infinity); },

    addCollider(c) {
      const id = nextId++;
      const s = { shape: 'circle', rot: 0, ...c, id };
      if (s.shape === 'box') { s.hw = s.hw ?? (s.w || 1) / 2; s.hd = s.hd ?? (s.d || 1) / 2; }
      colliders.set(id, s); insert(grid, id, s);
      return id;
    },
    removeCollider(id) { const s = colliders.get(id); if (s) { removeFrom(grid, id, s); colliders.delete(id); } },
    moveCollider(id, x, z) { const s = colliders.get(id); if (!s) return; removeFrom(grid, id, s); s.x = x; s.z = z; insert(grid, id, s); },

    /**
     * push pos (THREE.Vector3 or {x,z}) out of colliders overlapping a cylinder of `radius`
     * standing at feetY (colliders with maxY below feet or minY above head are ignored).
     */
    resolve(pos, radius = 0.35, feetY = null) {
      let hit = false;
      const fy = feetY ?? pos.y ?? 0;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        for (const id of near(grid, pos.x, pos.z, radius + 0.5)) {
          const c = colliders.get(id);
          if (!c || c.disabled) continue;
          if (c.maxY != null && fy >= c.maxY - 0.05) continue;
          if (c.minY != null && fy + 1.6 <= c.minY) continue;
          if (c.shape === 'circle') {
            const dx = pos.x - c.x, dz = pos.z - c.z;
            const d = Math.hypot(dx, dz), min = c.r + radius;
            if (d < min) {
              const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
              pos.x = c.x + nx * min; pos.z = c.z + nz * min; hit = moved = true;
            }
          } else {
            const [lx, lz] = toLocal(c, pos.x, pos.z);
            const cx = G.util.clamp(lx, -c.hw, c.hw), cz = G.util.clamp(lz, -c.hd, c.hd);
            let dx = lx - cx, dz = lz - cz;
            let d = Math.hypot(dx, dz);
            if (d < radius) {
              let nlx, nlz;
              if (d < 1e-5) { // center inside the box: push out along the shallowest axis
                const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
                if (px < pz) { nlx = (lx >= 0 ? c.hw : -c.hw) + (lx >= 0 ? radius : -radius); nlz = lz; }
                else { nlz = (lz >= 0 ? c.hd : -c.hd) + (lz >= 0 ? radius : -radius); nlx = lx; }
              } else { nlx = cx + (dx / d) * radius; nlz = cz + (dz / d) * radius; }
              const [wx, wz] = toWorld(c, nlx, nlz);
              pos.x = wx; pos.z = wz; hit = moved = true;
            }
          }
        }
        if (!moved) break;
      }
      return hit;
    },
    /** would a walker of radius r at (x,z) overlap anything? */
    blocked(x, z, r = 0.35, feetY = 0) {
      for (const id of near(grid, x, z, r + 0.5)) {
        const c = colliders.get(id);
        if (!c || c.disabled) continue;
        if (c.maxY != null && feetY >= c.maxY - 0.05) continue;
        if (contains(c, x, z, r)) return true;
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
