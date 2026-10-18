// =============================================================================
// 21-player.js — local player controller (G.sys.player)
//
//   object, position, rotY, velocity, grounded, rig, radius, enabled, speed, sitting, isWalking, walkInfo
//   WALK (9.6) / RUN (18) m/s, speedScale (3 = phase-4 pace vs. phase 1), maxSubstep (0.25 m)
//   teleport(x, z, rotY?, {fade=true}) -> Promise
//   walkTo({x,z}, {stopDistance=1.2, onArrive, onFail, run, path=true, rescue, trail, label}) -> walk id | false
//        path: plan around colliders (grid A* + string pulling, re-planned when blocked)
//        rescue (default: easy mode): never stays stuck — after re-plans / a time budget it fades and
//               teleports next to the destination, then arrives normally (the walk id stays the same)
//        trail  (default: easy mode): golden footprints along the planned route + a bouncing star at the goal
//   cancelWalk(reason), planPath(from, to) -> [{x,z}...] | null, playAction(anim, {duration, loop}),
//   stopAction(), faceTowards(x, z), sit(benchAnchor?), standUp(), setAppearance(app)
// Camera-relative WASD (walk WALK = 9.6 m/s, Shift run RUN = 18 m/s — phase 4: 3x the old pace,
// G.sys.player.WALK / RUN / speedScale), Space jump, smooth turning, step-up via G.world.heightAt,
// colliders via G.world.resolve, water/bounds/steep-slope blocking, footsteps on animation contacts
// (distance based: one step per half stride).
// Movement is SUB-STEPPED: every frame is split into slices of at most MAX_SUBSTEP (0.25 m) of travel;
// steering, acceleration, collision and ground following run per slice, so 18 m/s at 10 fps never
// tunnels through a 0.1 m fence, never leaves the ground on a slope and never overshoots a waypoint.
// Navigation: grid A* + string pulling, plus layout route hints (G.data.layout.navLinks: hand-made
// routes such as the 정선 만장대 switchback stairs) that the planner stitches in front of / behind A*.
// Events: player:moved {x,z} (<=4/s), player:distance {meters} (batched >= 5 m),
//         player:arrived {id, x, z, rescued} (a walkTo reached its goal), player:appearance {appearance}.
// Every number that reaches a matrix is checked with Number.isFinite (a NaN here would poison the
// camera, the shadow map and — on Direct3D — bloom).
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => G.util.angleDiff(a, b);
  const fin = Number.isFinite;

  // ---- locomotion tuning (everything below derives from WALK / RUN)
  const SPEED_SCALE = 3;               // phase 4: three times the phase-1 pace
  const WALK = 9.6, RUN = 18;          // m/s (normal / Shift)
  const GRAVITY = 22, JUMP_V = 5.7;
  const ACCEL = WALK * 5.6;            // ~54 m/s²: walk speed in 0.18 s, run speed in 0.33 s
  const DECEL = RUN * 4.2;             // ~76 m/s²: a crisp stop (0.24 s / 2 m from a sprint)
  const AIR_ACCEL = WALK * 1.9;        // steering while airborne
  const ARRIVE_DECEL = RUN * 2.3;      // auto-walk braking towards corners and the goal (~41 m/s²)
  const CORNER_SPEED = WALK * 0.42;    // auto-walk speed through a hairpin (switchbacks, doors)
  const RUN_STEP = (WALK + RUN) / 2;   // above this ground speed footsteps sound like running
  const MAX_SUBSTEP = 0.25;            // m of travel per collision sub-step (fences are >= 0.1 m)
  const MAX_SUBSTEPS = 16;
  const MAX_SLOPE = Math.tan(40 * Math.PI / 180);
  const RADIUS = 0.35;
  const DEFAULT_SEAT = 0.42;
  const WADE_DEPTH = 0.18; // deepest shallow water (below the surface) the player may wade into
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);

  const _t1 = new THREE.Vector3();
  /** would stepping to (x, z) (feet at y) take the walker below the wading limit lim? (a walker already clearly
   *  below it — never placed there by the game — may move level or climb out, not sink further) */
  function tooDeep(x, z, y, lim) { const gn = G.world.heightAt(x, z, y + 0.05); return gn < lim && gn < (y < lim - 0.02 ? y : lim) - 1e-4; }
  const _fallbackBasis = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };

  // =========================================================================== navigation (grid A*)
  // One reusable search grid (typed arrays, generation stamps instead of clearing): planning a 70 m
  // detour touches a few thousand cells once, never per frame.
  const NAV = { cell: 0.8, margin: 14, maxSide: 150, fineSide: 120, maxExpand: 9000, clear: RADIUS + 0.12, sample: 0.35 };
  const MAXN = NAV.maxSide * NAV.maxSide;
  const nav = {
    gen: 1,
    stamp: new Uint32Array(MAXN),
    flag: new Uint8Array(MAXN),     // 1 evaluated · 2 passable · 4 closed
    g: new Float32Array(MAXN),
    y: new Float32Array(MAXN),
    parent: new Int32Array(MAXN),
    heap: new Int32Array(MAXN * 3),
    heapF: new Float32Array(MAXN * 3),
    hn: 0,
  };
  function heapPush(i, f) {
    if (nav.hn >= nav.heap.length) return false;
    let k = nav.hn++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (nav.heapF[p] <= f) break;
      nav.heap[k] = nav.heap[p]; nav.heapF[k] = nav.heapF[p]; k = p;
    }
    nav.heap[k] = i; nav.heapF[k] = f;
    return true;
  }
  function heapPop() {
    const top = nav.heap[0];
    const n = --nav.hn;
    if (n > 0) {
      const li = nav.heap[n], lf = nav.heapF[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && nav.heapF[c + 1] < nav.heapF[c]) c++;
        if (nav.heapF[c] >= lf) break;
        nav.heap[k] = nav.heap[c]; nav.heapF[k] = nav.heapF[c]; k = c;
      }
      nav.heap[k] = li; nav.heapF[k] = lf;
    }
    return top;
  }

  /** can a walker stand at (x, z) with feet at y? (r = clearance radius) */
  function freeAt(x, z, y, r = NAV.clear) {
    const W = G.world, b = W.bounds;
    if (!(x > b.minX + 0.3 && x < b.maxX - 0.3 && z > b.minZ + 0.3 && z < b.maxZ - 0.3)) return false;
    if (W.isWater(x, z)) return false;
    return !W.blocked(x, z, r, y);
  }
  /** feet height after stepping from (feet y0) to (x, z), or NaN when the step is impossible (cliff, deep bank) */
  function stepHeight(x, z, y0, run) {
    const W = G.world;
    const y = W.heightAt(x, z, y0 + 0.05);
    if (!fin(y)) return NaN;
    const wy = G.data.layout?.waterY ?? -1.1;
    if (y < wy - WADE_DEPTH) return NaN;
    const rise = y - y0;
    if (rise > 0.02) {
      const tn = W.terrainHeight(x, z);
      const onTerrain = Math.abs(y - tn) < 0.01;
      if (onTerrain ? rise > run * MAX_SLOPE + 0.06 : rise > W.STEP + 0.02) return NaN;
    }
    return y;
  }
  /** straight walkable line a -> b (sampled), starting with feet at y0 */
  let lineBudget = Infinity; // max samples a single planning pass may spend on line checks
  function lineClear(ax, az, y0, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (!fin(len)) return false;
    if (len < 1e-3) return true;
    const n = Math.max(1, Math.ceil(len / NAV.sample));
    if (n > lineBudget) return false;
    lineBudget -= n;
    const step = len / n;
    let y = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + dx * t, z = az + dz * t;
      const ny = stepHeight(x, z, y, step);
      // right next to the start the walker may already brush a wall: only demand the body radius there
      if (!fin(ny) || !freeAt(x, z, ny, t * len < 0.75 ? RADIUS + 0.02 : NAV.clear)) return false;
      y = ny;
    }
    return true;
  }

  /**
   * plan from (sx, sz, feet sy) to (tx, tz). Returns [{x,z}, ...] (first point = start) or null.
   * goalR: any cell within this radius of the target counts as arrival (targets inside props / NPCs).
   */
  function planPath(sx, sz, sy, tx, tz, goalR) {
    if (!fin(sx) || !fin(sz) || !fin(sy) || !fin(tx) || !fin(tz)) return null;
    goalR = fin(goalR) ? Math.max(0.5, goalR) : 1;
    // straight line clear up to where the walker stops (targets are often inside a prop / an NPC)
    {
      const len = Math.hypot(tx - sx, tz - sz);
      const k = len > 1e-3 ? Math.max(0, len - goalR * 0.9) / len : 0;
      if (lineClear(sx, sz, sy, sx + (tx - sx) * k, sz + (tz - sz) * k)) return [{ x: sx, z: sz }, { x: tx, z: tz }];
    }
    const W = G.world, b = W.bounds;
    let cell = NAV.cell;
    let x0 = Math.min(sx, tx) - NAV.margin, x1 = Math.max(sx, tx) + NAV.margin;
    let z0 = Math.min(sz, tz) - NAV.margin, z1 = Math.max(sz, tz) + NAV.margin;
    x0 = Math.max(x0, b.minX); z0 = Math.max(z0, b.minZ); x1 = Math.min(x1, b.maxX); z1 = Math.min(z1, b.maxZ);
    const span = Math.max(x1 - x0, z1 - z0);
    if (span / cell > NAV.fineSide) cell = span / NAV.fineSide; // big detours plan on a coarser grid (bounded cost)
    const nx = Math.max(2, Math.min(NAV.maxSide, Math.ceil((x1 - x0) / cell) + 1));
    const nz = Math.max(2, Math.min(NAV.maxSide, Math.ceil((z1 - z0) / cell) + 1));
    const cx = (x) => clamp(Math.round((x - x0) / cell), 0, nx - 1);
    const cz = (z) => clamp(Math.round((z - z0) / cell), 0, nz - 1);
    const wx = (i) => x0 + (i % nx) * cell, wz = (i) => z0 + Math.floor(i / nx) * cell;

    if (++nav.gen > 0xfffffff0) { nav.gen = 1; nav.stamp.fill(0); }
    const gen = nav.gen;
    nav.hn = 0;
    const goalCell = cz(tz) * nx + cx(tx);
    const touch = (i) => { if (nav.stamp[i] !== gen) { nav.stamp[i] = gen; nav.flag[i] = 0; nav.g[i] = Infinity; nav.parent[i] = -1; } };
    // start cell: the nearest cell centre the walker can really reach in a straight line. Rounding the position
    // can pick a centre on the far side of a 0.2 m fence or rail right beside the walker — the route would then
    // begin straight through it (pushing against the rail until 'stuck').
    let start = cz(sz) * nx + cx(sx), startY = sy, startOk = false;
    {
      const fx = Math.floor((sx - x0) / cell), fz = Math.floor((sz - z0) / cell);
      const cand = [];
      for (let jz = fz - 1; jz <= fz + 2; jz++) for (let jx = fx - 1; jx <= fx + 2; jx++) {
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const ddx = x0 + jx * cell - sx, ddz = z0 + jz * cell - sz;
        cand.push(ddx * ddx + ddz * ddz, jz * nx + jx);
      }
      const order = [];
      for (let k = 0; k < cand.length; k += 2) order.push(k);
      order.sort((a, b) => cand[a] - cand[b]);
      for (const k of order) {
        const i = cand[k + 1], x = wx(i), z = wz(i);
        if (!lineClear(sx, sz, sy, x, z)) continue;
        const y = W.heightAt(x, z, sy + 0.05);
        if (!fin(y) || !freeAt(x, z, y)) continue;
        start = i; startY = y; startOk = true;
        break;
      }
    }
    /** can the walker go straight from cell i to the target? (always true for a target nobody can stand on) */
    const goalSeen = (i) => {
      const x = wx(i), z = wz(i), ty = W.heightAt(tx, tz, nav.y[i] + 0.05);
      return !(fin(ty) && freeAt(tx, tz, ty)) || lineClear(x, z, nav.y[i], tx, tz);
    };
    // edges longer than the clearance band of the thinnest rail (2 × (0.05 + NAV.clear) ≈ 1.04 m) can hop over a
    // rail with both cell centres free: on the coarse grid of a long trip every edge is also sampled inside
    const EDGE_GAP = 0.85, coarse = cell > 0.9;
    const edgeClear = (ax, az, bx, bz, y) => {
      const len = Math.hypot(bx - ax, bz - az), m = Math.ceil(len / EDGE_GAP);
      for (let s = 1; s < m; s++) { const t = s / m; if (!freeAt(ax + (bx - ax) * t, az + (bz - az) * t, y)) return false; }
      return true;
    };
    /** evaluate passability of cell i when entered from a parent with feet at y0; caches y */
    const passable = (i, y0, run) => {
      touch(i);
      const f = nav.flag[i];
      if (f & 1) return (f & 2) !== 0;
      const x = wx(i), z = wz(i);
      const y = stepHeight(x, z, y0, run);
      const ok = fin(y) && freeAt(x, z, y);
      nav.flag[i] = 1 | (ok ? 2 : 0);
      nav.y[i] = fin(y) ? y : y0;
      return ok;
    };
    touch(start);
    nav.flag[start] = 3; nav.y[start] = startY; nav.g[start] = 0;
    const octile = (i) => { const dx = Math.abs(wx(i) - tx), dz = Math.abs(wz(i) - tz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    heapPush(start, octile(start));
    let found = -1, best = start, bestH = Math.hypot(sx - tx, sz - tz), expanded = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (nav.hn > 0 && expanded < NAV.maxExpand) {
      const i = heapPop();
      if (nav.flag[i] & 4) continue;
      nav.flag[i] |= 4;
      expanded++;
      const ix = i % nx, iz = Math.floor(i / nx);
      const px = wx(i), pz = wz(i);
      const h = Math.hypot(px - tx, pz - tz);
      if (h < bestH) { bestH = h; best = i; }
      // a cell near the goal only counts when the goal is not on the far side of a rail from it (a target the walker
      // cannot stand on — inside a prop, an NPC — is only steered at, so any cell in reach will do)
      if ((i === goalCell || h <= goalR) && goalSeen(i)) { found = i; break; }
      const y0 = nav.y[i], g0 = nav.g[i];
      for (let k = 0; k < 8; k++) {
        const d = D[k];
        const jx = ix + d[0], jz = iz + d[1];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (d[2] > 1) { // no corner cutting
          if (!passable(iz * nx + jx, y0, cell) || !passable(jz * nx + ix, y0, cell)) continue;
        }
        if (!passable(j, y0, cell * d[2])) continue;
        if (nav.flag[j] & 4) continue;
        const ng = g0 + d[2] * cell;
        if (ng < nav.g[j]) {
          if (coarse && !edgeClear(px, pz, wx(j), wz(j), Math.min(y0, nav.y[j]))) continue;
          nav.g[j] = ng; nav.parent[j] = i;
          if (!heapPush(j, ng + octile(j))) { expanded = NAV.maxExpand; break; }
        }
      }
    }
    let end = found;
    if (end < 0) {
      // unreachable / budget: walk as close as we can (only when that is real progress)
      if (best === start || Math.hypot(sx - tx, sz - tz) - bestH < 2) return null;
      end = best;
    }
    const cells = [];
    for (let i = end, guard = 0; i >= 0 && guard < 20000; i = nav.parent[i], guard++) { cells.push(i); if (i === start) break; }
    cells.reverse();
    const pts = [{ x: sx, z: sz, y: sy }];
    // the start cell centre is a real corner when it was checked reachable (string pulling drops it when the walker
    // can see past it); a rounded, unchecked one is never a target of its own
    if (startOk && Math.hypot(wx(start) - sx, wz(start) - sz) > 0.05) pts.push({ x: wx(start), z: wz(start), y: startY });
    for (let k = 1; k < cells.length; k++) pts.push({ x: wx(cells[k]), z: wz(cells[k]), y: nav.y[cells[k]] });
    // the exact target joins the corner list only when it is standable (inside a prop it is the steering goal only)
    if (found >= 0 && freeAt(tx, tz, pts[pts.length - 1].y)) pts.push({ x: tx, z: tz, y: pts[pts.length - 1].y });
    // string pulling: keep only the corners we cannot see past (bounded look-ahead + sample budget:
    // a long winding route never costs more than a few milliseconds; leftovers just keep extra corners)
    const out = [pts[0]];
    let a = 0;
    lineBudget = 24000;
    try {
      while (a < pts.length - 1) {
        let bIdx = a + 1;
        for (let c = Math.min(pts.length - 1, a + 48); c > a + 1; c--) {
          if (lineClear(pts[a].x, pts[a].z, pts[a].y, pts[c].x, pts[c].z)) { bIdx = c; break; }
        }
        out.push(pts[bIdx]);
        a = bIdx;
      }
    } finally { lineBudget = Infinity; }
    return out.map((p) => ({ x: p.x, z: p.z }));
  }

  // =========================================================================== route hints (layout navLinks)
  // A navLink is a hand-made route the grid search would struggle with (long switchbacks on a hill):
  //   { id, route: [[x, z], ...] (top -> bottom), area: {x, z, r} (the region the route serves), width }
  // Starting (or ending) inside the area or on the route, the planner follows the route to its far end
  // and only plans the rest with A*. Pure geometry: no allocation per frame (planning is per walk).
  /** nearest point on a polyline: {i (segment index), t, d, x, z} */
  function nearestOnRoute(route, x, z) {
    let best = null;
    for (let i = 0; i < route.length - 1; i++) {
      const ax = route[i][0], az = route[i][1], bx = route[i + 1][0], bz = route[i + 1][1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { i, t, d, x: px, z: pz };
    }
    return best;
  }
  function onLink(link, x, z) {
    const a = link.area;
    if (a && fin(a.x) && fin(a.z) && fin(a.r) && Math.hypot(x - a.x, z - a.z) <= a.r) return true;
    const n = nearestOnRoute(link.route, x, z);
    return !!n && n.d <= (fin(link.width) ? link.width : 3);
  }
  function validLink(l) {
    return l && Array.isArray(l.route) && l.route.length >= 2 && l.route.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]));
  }
  /** the route between two points that both lie on (or in the area of) the link, in walking order */
  function routeBetween(link, ax, az, bx, bz) {
    const r = link.route;
    const na = nearestOnRoute(r, ax, az), nb = nearestOnRoute(r, bx, bz);
    const sa = na.i + na.t, sb = nb.i + nb.t;
    const pts = [];
    if (sa <= sb) { for (let k = Math.ceil(sa + 1e-6); k <= Math.floor(sb - 1e-6); k++) pts.push({ x: r[k][0], z: r[k][1] }); }
    else { for (let k = Math.floor(sa - 1e-6); k >= Math.ceil(sb + 1e-6); k--) pts.push({ x: r[k][0], z: r[k][1] }); }
    return { pts, entry: na, exit: nb };
  }
  /** a short leg between a point and the route (on the plateau there are lanterns, benches, a board ...):
   *  straight when clear, otherwise a local A* detour. Returns [{x,z}...] starting at a. */
  function leg(ax, az, ay, bx, bz, goalR = 0.5) {
    const p = planPath(ax, az, ay, bx, bz, goalR);
    return p && p.length >= 2 ? p : [{ x: ax, z: az }, { x: bx, z: bz }];
  }
  /** append points, skipping near-duplicates */
  function append(out, pts, from = 0) {
    for (let k = from; k < pts.length; k++) {
      const q = out[out.length - 1], p = pts[k];
      if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.05) out.push({ x: p.x, z: p.z });
    }
    return out;
  }
  /** planPath + layout route hints */
  function planRoute(sx, sz, sy, tx, tz, goalR) {
    const links = G.data.layout?.navLinks;
    if (Array.isArray(links)) {
      for (const link of links) {
        if (!validLink(link)) continue;
        const sIn = onLink(link, sx, sz), tIn = onLink(link, tx, tz);
        if (!sIn && !tIn) continue;
        const a = link.area;
        const inArea = (x, z) => !!a && fin(a.r) && Math.hypot(x - a.x, z - a.z) <= a.r;
        // both on the plateau: an ordinary local plan (never a detour through the path gap)
        if (sIn && tIn && inArea(sx, sz) && inArea(tx, tz)) return planPath(sx, sz, sy, tx, tz, goalR);
        const r = link.route, end = r[r.length - 1];
        const hy = (x, z, hint) => { const y = G.world.heightAt(x, z, hint); return fin(y) ? y : hint; };
        if (sIn && tIn) {
          const { pts, entry, exit } = routeBetween(link, sx, sz, tx, tz);
          const out = append([], leg(sx, sz, sy, entry.x, entry.z));
          append(out, pts);
          const ey = hy(exit.x, exit.z, sy);
          return append(out, leg(exit.x, exit.z, ey, tx, tz, goalR));
        }
        if (sIn) {
          // to the route, down it to its foot, then A* to the target
          const { pts, entry } = routeBetween(link, sx, sz, end[0], end[1]);
          const out = append([], leg(sx, sz, sy, entry.x, entry.z));
          append(out, pts);
          append(out, [{ x: end[0], z: end[1] }]);
          const fy = hy(end[0], end[1], sy);
          const rest = planPath(end[0], end[1], fy, tx, tz, goalR) || [{ x: end[0], z: end[1] }, { x: tx, z: tz }];
          return append(out, rest, 1);
        }
        // A* to the foot of the route, up the route, then the last leg to the target
        const head = planPath(sx, sz, sy, end[0], end[1], 0.6) || [{ x: sx, z: sz }, { x: end[0], z: end[1] }];
        const { pts, exit } = routeBetween(link, end[0], end[1], tx, tz);
        const out = append([], head);
        append(out, [{ x: end[0], z: end[1] }]);
        append(out, pts);
        const ey = hy(exit.x, exit.z, sy);
        return append(out, leg(exit.x, exit.z, ey, tx, tz, goalR));
      }
    }
    return planPath(sx, sz, sy, tx, tz, goalR);
  }

  // =========================================================================== route trail (easy mode)
  // A sliding window of TRAIL_MAX footprints, TRAIL_GAP apart: prints the walker has passed are recycled as new ones
  // ahead, so a route of any length shows the way to its very end (not just its first ~90 m).
  const TRAIL_MAX = 96, TRAIL_GAP = 0.95;
  const _m4 = new THREE.Matrix4();
  const trail = {
    mesh: null, star: null, built: false, visible: false,
    dots: new Float32Array(TRAIL_MAX * 5), // ring buffer (slot = print index % TRAIL_MAX): x, y, z, yaw, s(arc length)
    path: null, lo: 0, hi: 0, count: 0, seg: 0, segS: 0, ly: 0,
    goal: { x: 0, y: 0, z: 0 }, t: 0,
    build() {
      if (this.built) return !!this.mesh;
      this.built = true;
      const E = G.sys.engine;
      if (!E?.scene) return false;
      try {
        const tex = G.gfx.canvasTexture(64, 96, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 8;
          ctx.fillStyle = '#ffffff';
          // sole: ball + heel, five little toes (top = walking direction)
          ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.42, w * 0.25, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(w * 0.52, h * 0.75, w * 0.18, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
          const toes = [[0.3, 0.17, 0.075], [0.42, 0.12, 0.07], [0.54, 0.11, 0.065], [0.65, 0.14, 0.06], [0.74, 0.2, 0.055]];
          for (const [tx, ty, tr] of toes) { ctx.beginPath(); ctx.arc(w * tx, h * ty, w * tr, 0, Math.PI * 2); ctx.fill(); }
        });
        const geo = new THREE.PlaneGeometry(0.52, 0.78);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(Math.PI); // texture top -> +Z (local forward)
        const mat = new THREE.MeshBasicMaterial({
          map: tex, color: 0xffdc4a, transparent: true, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, TRAIL_MAX);
        mesh.name = 'walk-trail';
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.renderOrder = 6;
        mesh.raycast = () => {};
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < TRAIL_MAX; i++) { _m4.makeTranslation(0, -500, 0); mesh.setMatrixAt(i, _m4); }
        mesh.visible = false;
        E.scene.add(mesh);
        this.mesh = mesh;
        const stex = G.gfx.canvasTexture(128, 128, (ctx, w, h) => {
          const c = w / 2;
          const g = ctx.createRadialGradient(c, c, 4, c, c, c);
          g.addColorStop(0, 'rgba(255,236,150,0.85)'); g.addColorStop(0.55, 'rgba(255,214,90,0.25)'); g.addColorStop(1, 'rgba(255,214,90,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? w * 0.17 : w * 0.38;
            ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fillStyle = '#ffd23f'; ctx.fill();
          ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        });
        const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        star.scale.set(0.95, 0.95, 0.95);
        star.renderOrder = 7;
        star.visible = false;
        star.raycast = () => {};
        star.name = 'walk-goal-star';
        E.scene.add(star);
        this.star = star;
        return true;
      } catch (e) {
        G.log.warn('PLAYER', 'route trail unavailable', e);
        this.mesh = null; this.star = null;
        return false;
      }
    },
    /** footprints along a path ([{x,z}], first point = start): the first TRAIL_MAX now, the rest as the walker advances */
    set(path, feetY) {
      if (!this.build() || !path || path.length < 2) { this.hide(); return; }
      const W = G.world;
      let total = 0, y = fin(feetY) ? feetY : 0;
      for (let k = 0; k < path.length - 1; k++) {
        const l = Math.hypot(path[k + 1].x - path[k].x, path[k + 1].z - path[k].z);
        if (fin(l)) total += l;
        // goal height: follow the route's levels (deck, stairs, bridge) vertex by vertex
        const gy = W.heightAt(path[k + 1].x, path[k + 1].z, y + 0.4);
        if (fin(gy)) y = gy;
      }
      const end = path[path.length - 1];
      this.goal.x = end.x; this.goal.y = y; this.goal.z = end.z;
      this.path = path;
      this.count = Math.max(0, Math.floor(total / TRAIL_GAP));
      this.lo = 0; this.hi = 0; this.seg = 0; this.segS = 0; this.ly = fin(feetY) ? feetY : 0;
      while (this.hi < this.count && this.hi < TRAIL_MAX) this._lay();
      this.visible = this.hi > 0;
      if (this.mesh) this.mesh.visible = this.visible;
      if (this.star) this.star.visible = this.visible;
      this.t = 0;
    },
    /** lay print number hi (arc length (hi + 1) · TRAIL_GAP) into its ring slot; the segment cursor only moves forward */
    _lay() {
      const path = this.path, m = this.hi, sArc = (m + 1) * TRAIL_GAP;
      let k = this.seg, s0 = this.segS, len = 0;
      for (; k < path.length - 1; k++) {
        len = Math.hypot(path[k + 1].x - path[k].x, path[k + 1].z - path[k].z);
        if (len > 1e-4 && s0 + len >= sArc) break;
        if (fin(len)) s0 += len;
      }
      if (k >= path.length - 1) { this.count = this.hi; return; } // (rounding: the route ended a hair early)
      this.hi++;
      this.seg = k; this.segS = s0;
      const a = path[k], b = path[k + 1], dx = b.x - a.x, dz = b.z - a.z, t = (sArc - s0) / len;
      const side = m % 2 ? -1 : 1, yaw = Math.atan2(dx, dz), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const px = a.x + dx * t + rx * 0.11 * side, pz = a.z + dz * t + rz * 0.11 * side;
      let gy = G.world.heightAt(px, pz, this.ly + 0.4);
      if (!fin(gy)) gy = this.ly;
      this.ly = gy;
      const o = (m % TRAIL_MAX) * 5;
      this.dots[o] = px; this.dots[o + 1] = gy + 0.07; this.dots[o + 2] = pz; this.dots[o + 3] = yaw; this.dots[o + 4] = sArc;
    },
    hide() {
      this.visible = false; this.path = null; this.lo = this.hi = this.count = 0;
      if (this.mesh) { this.mesh.visible = false; this.mesh.count = 0; }
      if (this.star) this.star.visible = false;
    },
    /** progress = arc length already walked; footprints behind the walker disappear, the next ones pop in */
    update(dt, progress) {
      if (!this.visible || !this.mesh) return;
      this.t += dt;
      // recycle the prints behind the walker as new ones at the far end of the window
      while (this.lo < this.hi && this.dots[(this.lo % TRAIL_MAX) * 5 + 4] - progress < 0.35) {
        this.lo++;
        if (this.hi < this.count) this._lay();
      }
      const rm = !!G.settings?.reduceMotion;
      const t = this.t;
      let c = 0;
      for (let i = this.lo; i < this.hi; i++) {
        const o = (i % TRAIL_MAX) * 5, s = this.dots[o + 4];
        const ahead = s - progress;
        if (ahead < 0.35) continue;
        const appear = clamp((ahead - 0.35) / 0.9, 0, 1) * clamp((t * 14 - i * 0.6) / 3, 0, 1); // pop in one by one
        const wave = rm ? 0 : Math.max(0, Math.sin(s * 1.25 - t * 4.2)) * 0.22;          // a slow wave runs towards the goal
        const sc = clamp(0.06 + appear * (0.94 + wave), 0.06, 1.3);
        const x = this.dots[o], y = this.dots[o + 1], z = this.dots[o + 2], yaw = this.dots[o + 3];
        if (!fin(x) || !fin(y) || !fin(z) || !fin(yaw)) continue;
        _m4.makeRotationY(yaw);
        _m4.elements[0] *= sc; _m4.elements[1] *= sc; _m4.elements[2] *= sc;
        _m4.elements[4] *= sc; _m4.elements[5] *= sc; _m4.elements[6] *= sc;
        _m4.elements[8] *= sc; _m4.elements[9] *= sc; _m4.elements[10] *= sc;
        _m4.setPosition(x, y, z);
        this.mesh.setMatrixAt(c++, _m4);
      }
      this.mesh.count = c;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.star) {
        const bob = rm ? 0 : Math.sin(t * 3) * 0.14;
        const gy = this.goal.y + 1.15 + bob;
        if (fin(gy)) this.star.position.set(this.goal.x, gy, this.goal.z);
        this.star.material.rotation = rm ? 0 : Math.sin(t * 1.4) * 0.25;
      }
    },
  };

  // =========================================================================== the player system
  const player = {
    name: 'player', order: 30, label: '플레이어',
    object: null, position: null, rotY: Math.PI,
    velocity: new THREE.Vector3(), grounded: true, rig: null, radius: RADIUS, enabled: true,
    speed: 0, sitting: null,
    /** locomotion constants for other modules (companion / visitors keep up with speedScale) */
    WALK, RUN, speedScale: SPEED_SCALE, maxSubstep: MAX_SUBSTEP,
    _walk: null, _walkSeq: 0, _faceT: null, _slide: null,
    _jumpBuf: 0, _coyote: 0,
    _rigParams: { speed: 0, grounded: true, vy: 0 },
    _stepOpts: { surface: 'grass', run: false },
    _steps: 0, _stepT: 0, wantSpeed: 0, _lastEmit: new THREE.Vector3(), _emitT: 0, _distAcc: 0, _saveT: 0, _tagT: 0, _tagKey: '',
    _prevPos: new THREE.Vector3(), _ready: false,

    get isWalking() { return !!this._walk; },
    /** small read-only summary of the running walk (for HUD / dev tools) */
    get walkInfo() {
      const w = this._walk;
      if (!w) return null;
      return { id: w.id, x: w.x, z: w.z, waypoints: w.path ? w.path.length - 1 : 1, index: w.pi, replans: w.replans, rescuing: !!w.rescuing, label: w.label || '' };
    },

    init() {
      const E = G.sys.engine;
      this.object = new THREE.Group();
      this.object.name = 'player';
      this.position = this.object.position;
      const sp = G.data.layout?.spawn || { x: 0, z: 9, rotY: Math.PI };
      this.rotY = sp.rotY ?? Math.PI;
      this.rig = G.avatar.create(G.avatar.defaultAppearance, { shadow: true });
      this.object.add(this.rig.group);
      this.position.set(sp.x, G.world.heightAt(sp.x, sp.z), sp.z);
      this.object.rotation.y = this.rotY;
      this.object.visible = false;
      E.scene.add(this.object);
      this._prevPos.copy(this.position);
      this._lastEmit.copy(this.position);

      this.nametag = G.ui.label({ className: 'nametag me', html: '', target: this.rig.headAnchor, maxDist: 48, fadeDist: 8 });
      this.nametag.setVisible(false);

      G.bus.on('input:move-start', () => {
        if (!this._ready) return;
        this.cancelWalk('manual');
        if (this.sitting) this.standUp();
      });
      G.bus.on('state:before-save', () => this._writeState());
      G.bus.on('world:object', ({ id, obj }) => {
        if (/^BENCH_\d+$/.test(id) && G.interact?.get?.(id)) G.interact.setObject?.(id, obj);
      });
      // the footprint trail is an easy-mode helper: switching modes mid-walk shows / hides it right away
      G.bus.on('easy:changed', () => {
        const w = this._walk;
        if (!w) return;
        w.trail = w.trailOpt != null ? !!w.trailOpt : easyOn();
        w.rescue = w.rescueOpt != null ? !!w.rescueOpt : easyOn();
        if (w.trail && w.path) trail.set(w.path, this.position.y); else trail.hide();
      });
    },

    postInit() { this._registerBenches(); },

    _registerBenches() {
      const list = G.data.layout?.benches || [];
      if (!G.interact?.register) return;
      list.forEach((b, i) => {
        const id = 'BENCH_' + i;
        const pos = new THREE.Vector3(b.x, G.world.surfaceHeight(b.x, b.z) + 0.45, b.z);
        const here = () => this.sitting && this.sitting.bench && this.sitting.bench.id === id;
        G.interact.register({
          id, kind: 'bench', radius: 2.2, priority: -0.5,
          label: () => (here() ? '일어나기' : '벤치에 앉기'),
          position: pos,
          object: G.world.getObject(id) || undefined,
          onInteract: () => {
            if (here()) { this.standUp(); return; }
            const obj = G.world.getObject(id);
            const seat = Number(obj?.userData?.seatY);
            this.sit({ id, x: b.x, z: b.z, rot: b.rot || 0, seatY: fin(seat) ? seat : DEFAULT_SEAT });
          },
        });
      });
    },

    // ------------------------------------------------------------ state
    onStateLoaded(state) {
      const app = state?.profile?.avatar ? state.profile.avatar : G.avatar.defaultAppearance;
      this.rig.setAppearance(app);
      const L = G.data.layout || {};
      const sp = L.spawn || { x: 0, z: 9, rotY: Math.PI };
      const p = state?.player || {};
      let x = Number(p.x), z = Number(p.z), y = Number(p.y), ry = Number(p.rotY);
      const b = G.world.bounds;
      const valid = fin(x) && fin(z) && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && !state?._isNew;
      if (!valid) { x = sp.x; z = sp.z; ry = sp.rotY; y = 0; }
      const free = this._findFree(x, z, fin(y) ? y : 0);
      if (!free) { x = sp.x; z = sp.z; } else { x = free.x; z = free.z; }
      const gy = G.world.heightAt(x, z, (fin(y) ? y : 0) + 0.3);
      this.position.set(x, fin(gy) ? gy : 0, z);
      this.rotY = fin(ry) ? ry : (sp.rotY ?? Math.PI);
      this.object.rotation.y = this.rotY;
      this.velocity.set(0, 0, 0);
      this.grounded = true;
      this.sitting = null; this._faceT = null; this._slide = null;
      this._dropWalk();
      this.rig.stopAll();
      this.rig.setHeld(null);
      this.object.visible = true;
      this.nametag.setVisible(true);
      this._tagKey = '';
      this._refreshTag();
      this._prevPos.copy(this.position);
      this._lastEmit.copy(this.position);
      this._distAcc = 0;
      this._ready = true;
      G.sys.engine.focus.copy(this.position);
      this._writeState();
      G.bus.emit('player:moved', { x: this.position.x, z: this.position.z });
      G.log.info('PLAYER', `spawned at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    },

    onLogout() {
      this._ready = false;
      this.cancelWalk('logout');
      this.sitting = null;
      this.rig.stopAll();
      this.rig.setHeld(null);
      this.object.visible = false;
      this.nametag.setVisible(false);
      trail.hide();
    },

    _writeState() {
      const s = G.state?.player;
      if (!s || !this._ready) return;
      const p = this.position;
      if (!fin(p.x) || !fin(p.y) || !fin(p.z) || !fin(this.rotY)) return;
      s.x = Math.round(p.x * 100) / 100;
      s.y = Math.round(p.y * 100) / 100;
      s.z = Math.round(p.z * 100) / 100;
      s.rotY = Math.round(this.rotY * 1000) / 1000;
    },

    _refreshTag() {
      const pr = G.state?.profile;
      const nick = pr?.nickname || '게스트';
      const title = pr?.title || '';
      const key = nick + '|' + title;
      if (key === this._tagKey) return;
      this._tagKey = key;
      const esc = G.util.escapeHtml;
      this.nametag.setHTML(`${title ? `<span class="role">${esc(title)}</span>` : ''}<span class="nm">${esc(nick)}</span>`);
    },

    // ------------------------------------------------------------ public API
    async teleport(x, z, rotY, opts = {}) {
      if (x && typeof x === 'object') { opts = (rotY && typeof rotY === 'object') ? rotY : opts; rotY = typeof z === 'number' ? z : x.rotY; z = x.z; x = x.x; }
      opts = opts && typeof opts === 'object' ? opts : {};
      if (!fin(x) || !fin(z)) { G.log.warn('PLAYER', 'teleport ignored: non-finite target', x, z); return; }
      const keep = opts._keepWalk || null;
      const run = () => {
        const f = this._findFree(x, z, G.world.surfaceHeight(x, z)) || { x, z };
        if (!keep || this._walk !== keep) this.cancelWalk('teleport');
        this.sitting = null; this._slide = null; this._faceT = null;
        this.rig.stopAll();
        const y = G.world.surfaceHeight(f.x, f.z);
        this.position.set(f.x, fin(y) ? y : 0, f.z);
        G.world.clampToBounds(this.position);
        if (rotY != null && fin(rotY)) this.rotY = rotY;
        this.object.rotation.y = this.rotY;
        this.velocity.set(0, 0, 0);
        this.grounded = true;
        this._prevPos.copy(this.position);
        this._lastEmit.copy(this.position);
        G.sys.engine.focus.copy(this.position);
        if (G.sys.camera?.mode === 'follow') { G.sys.camera.behind?.(this.rotY, true); G.sys.camera.snap?.(); }
        this._writeState();
        G.bus.emit('player:moved', { x: this.position.x, z: this.position.z });
        G.log.info('PLAYER', `teleport -> (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
      };
      G.sfx('teleport');
      if (opts.fade !== false && G.ui?.fadeThrough) await G.ui.fadeThrough(run, 260);
      else run();
      return this.position;
    },

    /**
     * walk to {x, z}. Returns the walk id (number) or false. The walk re-plans around new obstacles,
     * cancels on joystick / keyboard input ('manual'), and calls onFail(reason) for every other end:
     * 'manual' | 'replaced' | 'teleport' | 'stuck' | 'unreachable' | 'sit' | 'action' | 'logout' | ...
     */
    walkTo(target, opts = {}) {
      if (!target || !fin(target.x) || !fin(target.z)) return false;
      opts = opts && typeof opts === 'object' ? opts : {};
      if (!this._ready) return false;
      if (this.sitting) this.standUp();
      if (this.rig.actionFullBody) this.rig.stopAction();
      if (this._walk) this.cancelWalk('replaced');
      const b = G.world.bounds;
      const tx = clamp(target.x, b.minX, b.maxX), tz = clamp(target.z, b.minZ, b.maxZ);
      const p = this.position;
      const d = Math.hypot(tx - p.x, tz - p.z);
      const stop = Math.max(0.15, fin(opts.stopDistance) ? opts.stopDistance : 1.2);
      const w = {
        id: ++this._walkSeq, x: tx, z: tz, stop,
        onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
        onFail: typeof opts.onFail === 'function' ? opts.onFail : null,
        run: opts.run ?? d > WALK * 2.5, label: String(opts.label || '').slice(0, 24),
        usePath: opts.path !== false,
        rescueOpt: opts.rescue == null ? null : !!opts.rescue, trailOpt: opts.trail == null ? null : !!opts.trail,
        rescue: false, trail: false,
        path: null, pi: 1, rem: null, replans: 0, lastPlanT: -10, skipT: 0,
        best: Infinity, bestT: G.time.elapsed, startT: G.time.elapsed, budget: 30, rescuing: false,
      };
      w.rescue = w.rescueOpt != null ? w.rescueOpt : easyOn();
      w.trail = w.trailOpt != null ? w.trailOpt : easyOn();
      this._walk = w;
      this._faceT = null;
      this._plan(w, G.time.elapsed);
      return w.id;
    },
    cancelWalk(reason) {
      const w = this._walk;
      if (!w) return;
      this._walk = null;
      trail.hide();
      if (reason && reason !== 'arrived') { try { w.onFail?.(reason); } catch (e) { G.log.error('PLAYER', e); } }
    },
    /** plan a route between two points without walking it (dev tools / other modules) */
    planPath(from, to, goalR = 1) {
      if (!from || !to) return null;
      const y = fin(from.y) ? from.y : G.world.heightAt(from.x, from.z);
      try { return planRoute(from.x, from.z, y, to.x, to.z, goalR); } catch (e) { G.log.warn('PLAYER', 'planPath failed', e); return null; }
    },

    playAction(anim, opts = {}) {
      if (!anim || !this.rig) return;
      if (anim === 'sit') { this.sit(opts.bench || null); return; }
      if (anim === 'idle' || anim === 'walk' || anim === 'run') { this.stopAction(); return; }
      const def = G.avatar.actions[anim];
      if (def?.fullBody) { this.cancelWalk('action'); this.velocity.x = 0; this.velocity.z = 0; }
      if (this.sitting && def?.fullBody) this.standUp();
      this.rig.setAnim(anim, opts);
    },
    stopAction() {
      if (!this.rig) return;
      if (this.rig._act && !this.rig._act.stopping) this.rig.stopAction();
      else if (this.sitting) this.standUp();
    },

    faceTowards(x, z) {
      if (!fin(x) || !fin(z)) return;
      const dx = x - this.position.x, dz = z - this.position.z;
      if (dx * dx + dz * dz < 1e-4) return;
      this._faceT = Math.atan2(dx, dz);
    },

    sit(bench) {
      this.cancelWalk('sit');
      this.velocity.set(0, 0, 0);
      let seatY = 0;
      if (bench && fin(bench.x) && fin(bench.z)) {
        const rot = fin(bench.rot) ? bench.rot : 0;
        const fx = Math.sin(rot), fz = Math.cos(rot);
        const gx = bench.x + fx * 0.06, gz = bench.z + fz * 0.06;
        let gy = G.world.heightAt(gx, gz, this.position.y);
        if (!(gy <= this.position.y + 0.25)) gy = this.position.y;
        this._slideTo(gx, gy, gz, 0.28);
        this.rotY = rot;
        this._faceT = null;
        seatY = fin(bench.seatY) ? bench.seatY : DEFAULT_SEAT;
      }
      this.sitting = { bench: bench || null, seatY, at: G.time.elapsed };
      this.rig.setAnim('sit', { loop: true, seatY });
      G.log.debug('PLAYER', 'sit', bench?.id || 'ground');
    },
    standUp() {
      const s = this.sitting;
      if (!s) return;
      this.sitting = null;
      this.rig.stopAll();
      if (s.bench) {
        const fx = Math.sin(this.rotY), fz = Math.cos(this.rotY);
        _t1.set(this.position.x + fx * 0.55, this.position.y, this.position.z + fz * 0.55);
        G.world.resolve(_t1, RADIUS, this.position.y);
        if (!G.world.isWater(_t1.x, _t1.z)) this._slideTo(_t1.x, G.world.heightAt(_t1.x, _t1.z, this.position.y + 0.1), _t1.z, 0.25);
      }
    },

    setAppearance(app) {
      const n = G.avatar.normalize(app);
      this.rig.setAppearance(n);
      if (G.state?.profile) { G.state.profile.avatar = { ...n }; G.dirty('avatar'); }
      G.bus.emit('player:appearance', { appearance: n });
      G.log.info('PLAYER', 'appearance updated');
      return n;
    },

    // ------------------------------------------------------------ walking internals
    /** (re)plan the route of walk w from the current position */
    _plan(w, t) {
      const p = this.position;
      w.lastPlanT = t;
      let path = null;
      if (w.usePath) {
        try { path = planRoute(p.x, p.z, p.y, w.x, w.z, Math.max(w.stop, 0.6)); } catch (e) { G.log.warn('PLAYER', 'path planning failed', e); path = null; }
      }
      if (!path || path.length < 2) path = [{ x: p.x, z: p.z }, { x: w.x, z: w.z }];
      // the goal is the real target: the walker steers there on the last leg and stops at stopDistance
      const last = path[path.length - 1];
      if (Math.hypot(last.x - w.x, last.z - w.z) > 0.05) path.push({ x: w.x, z: w.z });
      w.path = path;
      w.pi = 1;
      // remaining length after each waypoint (progress metric for stuck detection) + arc length up to it (trail)
      const n = path.length;
      w.rem = new Float32Array(n);
      w.arc = new Float32Array(n);
      for (let i = n - 2; i >= 0; i--) w.rem[i] = w.rem[i + 1] + Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
      for (let i = 1; i < n; i++) w.arc[i] = w.arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      w.best = Infinity; w.bestT = t;
      // generous time budget: 1.9x the walking time of the planned route + 8 s (re-plans extend it)
      w.budget = Math.max(w.budget, (t - w.startT) + 8 + (w.rem[0] / WALK) * 1.9);
      if (w.trail) trail.set(path, p.y); else trail.hide();
      if (n > 2) G.log.debug('PLAYER', `walk ${w.id}: ${n - 2} waypoint(s), ${w.rem[0].toFixed(1)} m`);
    },

    _arrive(w, rescued) {
      if (this._walk !== w) return;
      this._walk = null;
      trail.hide();
      G.bus.emit('player:arrived', { id: w.id, x: this.position.x, z: this.position.z, rescued: !!rescued });
      try { w.onArrive?.(); } catch (e) { G.log.error('PLAYER', 'onArrive', e); }
    },

    /** last resort: fade, hop next to the goal, arrive (the walk keeps its id so callers see a normal arrival) */
    async _rescue(w) {
      if (w.rescuing || this._walk !== w) return;
      w.rescuing = true;
      this.velocity.x = 0; this.velocity.z = 0;
      const p = this.position;
      let dx = p.x - w.x, dz = p.z - w.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) { dx /= l; dz /= l; } else { dx = 0; dz = 1; }
      const off = Math.min(Math.max(w.stop * 0.75, 0.6), 2.2);
      const gx = w.x + dx * off, gz = w.z + dz * off;
      G.log.info('PLAYER', `walk ${w.id}: stuck -> hop to the goal`);
      try {
        await this.teleport(gx, gz, Math.atan2(-dx, -dz), { _keepWalk: w });
      } catch (e) { G.log.warn('PLAYER', 'rescue teleport failed', e); }
      if (this._walk !== w) return; // the child moved / a new walk started during the fade
      w.rescuing = false;
      this.faceTowards(w.x, w.z);
      this._arrive(w, true);
    },

    /** dropped silently (state reload): nobody is waiting for it any more */
    _dropWalk() { this._walk = null; trail.hide(); },

    _stuck(w, t, why) {
      if (w.replans < 3 && t - w.lastPlanT > 0.6) {
        w.replans++;
        G.log.debug('PLAYER', `walk ${w.id}: ${why} -> re-plan #${w.replans}`);
        this._plan(w, t);
        return;
      }
      if (w.rescue) { this._rescue(w); return; }
      G.log.debug('PLAYER', `walk ${w.id}: ${why}`);
      this.cancelWalk('stuck');
    },

    /** steering for the auto-walk: writes the wanted direction into out {dx, dz, want}; false = no walk this frame */
    _steer(w, t, dt, out) {
      const p = this.position;
      if (w.rescuing) { out.want = 0; return true; }
      const fx = w.x - p.x, fz = w.z - p.z;
      const dFinal = Math.hypot(fx, fz);
      if (!fin(dFinal)) { this.cancelWalk('invalid'); return false; }
      if (dFinal <= w.stop) { this._arrive(w, false); return false; }
      const path = w.path;
      // advance past waypoints we reached (or can already see past)
      while (w.pi < path.length - 1 && Math.hypot(path[w.pi].x - p.x, path[w.pi].z - p.z) < 0.7) w.pi++;
      w.skipT -= dt;
      if (w.skipT <= 0 && w.pi < path.length - 1) {
        w.skipT = 0.3;
        const nx = path[w.pi + 1];
        if (lineClear(p.x, p.z, p.y, nx.x, nx.z)) w.pi++;
      }
      const wp = path[w.pi] || path[path.length - 1];
      let dx = wp.x - p.x, dz = wp.z - p.z;
      let d = Math.hypot(dx, dz);
      if (!(d > 1e-4)) { dx = fx; dz = fz; d = dFinal; }
      out.dx = dx / d; out.dz = dz / d;
      const lastLeg = w.pi >= path.length - 1;
      // progress (remaining route length) -> braking, stuck detection / re-plan / rescue
      const remaining = d + (w.rem ? w.rem[Math.min(w.pi, w.rem.length - 1)] : 0);
      // speed: cruise, brake kinematically (v = sqrt(2as)) to stop right at stopDistance, and slow down
      // before sharp corners so 18 m/s still follows switchbacks and door openings precisely
      const vmax = w.run ? RUN : WALK;
      let want = Math.min(vmax, Math.sqrt(2 * ARRIVE_DECEL * Math.max(0, Math.min(remaining, dFinal + 0.5) - w.stop)) + 0.9);
      if (!lastLeg) {
        const nx = path[w.pi + 1];
        const bx = nx.x - wp.x, bz = nx.z - wp.z, bl = Math.hypot(bx, bz);
        if (bl > 1e-4) {
          const cos = (out.dx * bx + out.dz * bz) / bl;
          const sharp = clamp((1 - cos) / 1.5, 0, 1);
          const vc = vmax + (Math.min(vmax, CORNER_SPEED) - vmax) * sharp;
          want = Math.min(want, Math.sqrt(vc * vc + 2 * ARRIVE_DECEL * Math.max(0, d - 0.7)));
        }
      }
      out.want = fin(want) ? Math.max(0.6, want) : WALK;
      if (remaining < w.best - 0.2) { w.best = remaining; w.bestT = t; }
      else if (t - w.bestT > 1.5) { w.bestT = t; this._stuck(w, t, 'no progress'); if (this._walk !== w || w.rescuing) { out.want = 0; return this._walk === w; } }
      if (t - w.startT > w.budget) { w.budget = Infinity; if (w.rescue) this._rescue(w); else this.cancelWalk('stuck'); out.want = 0; return this._walk === w; }
      // arc length walked (for the trail)
      w.progress = (w.arc ? w.arc[Math.min(w.pi, w.arc.length - 1)] : 0) - d;
      return true;
    },

    // ------------------------------------------------------------ internals
    _slideTo(x, y, z, dur) {
      if (![x, y, z].every(fin)) return;
      this._slide = { fx: this.position.x, fy: this.position.y, fz: this.position.z, x, y, z, t: 0, dur };
    },

    /** nearest walkable spot (not water, not inside colliders, not down in a pond / river basin) within ~8 m */
    _findFree(x, z, y = 0) {
      const W = G.world;
      if (!fin(x) || !fin(z)) return null;
      if (!fin(y)) y = 0;
      const deep = (G.data.layout?.waterY ?? -1.1) - WADE_DEPTH;
      const ok = (px, pz, fy) => { const gy = W.heightAt(px, pz, fy + 0.3); return fin(gy) && gy >= deep && !W.blocked(px, pz, RADIUS * 0.9, gy); };
      if (ok(x, z, y)) return { x, z };
      for (let r = 0.75; r <= 8; r += 0.75) {
        const n = Math.max(8, Math.round(r * 6));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (ok(px, pz, y)) return { x: px, z: pz };
        }
      }
      return null;
    },

    /** single collision-checked step to (tx, tz); returns false when blocked */
    _tryStep(tx, tz) {
      const W = G.world, p = this.position;
      if (!fin(tx) || !fin(tz)) return false;
      if (W.isWater(tx, tz)) return false;
      const wy = G.data.layout?.waterY ?? -1.1;
      // shallow banks below the water surface: ankle-deep wading only, climbing out is always allowed. The limit is
      // fixed (not "a little below the current feet"): a per-step tolerance adds up, step after step, until the
      // walker stands knee-deep. Checked for the target and again for the spot the colliders push the walker to.
      const wade = p.y < wy + 0.6, lim = wy - WADE_DEPTH;
      if (wade && tooDeep(tx, tz, p.y, lim)) return false;
      const tc = W.terrainHeight(p.x, p.z), tn = W.terrainHeight(tx, tz);
      if (tn > p.y + 0.02) {
        const g = W.heightAt(tx, tz, p.y);
        const onTerrain = Math.abs(g - tn) < 0.01;
        if (onTerrain) {
          if (!this.grounded && tn > p.y + 0.05) return false;              // never move into terrain mid-air
          const run = Math.hypot(tx - p.x, tz - p.z);
          if (this.grounded && tn - tc > run * MAX_SLOPE + 0.015) return false; // steeper than ~40 degrees
        }
      }
      _t1.set(tx, p.y, tz);
      if (W.resolve(_t1, RADIUS, p.y)) {
        // wedged between two colliders (jar rows, posts): settle once more, and never accept a spot that
        // still overlaps — the previous position was clear, so staying put is always safe
        if (W.resolve(_t1, RADIUS, p.y) && W.blocked(_t1.x, _t1.z, RADIUS - 0.03, p.y)) return false;
      }
      W.clampToBounds(_t1);
      if (!fin(_t1.x) || !fin(_t1.z) || W.isWater(_t1.x, _t1.z)) return false;
      if (wade && (_t1.x !== tx || _t1.z !== tz) && tooDeep(_t1.x, _t1.z, p.y, lim)) return false;
      p.x = _t1.x; p.z = _t1.z;
      return true;
    },
    /** try to move horizontally to (nx, nz), sliding along blockers; returns true if any movement happened */
    _move(nx, nz) {
      const p = this.position;
      if (this._tryStep(nx, nz)) return true;
      const ox = p.x, oz = p.z;
      if (Math.abs(nx - ox) > 1e-5 && this._tryStep(nx, oz)) return true;
      if (Math.abs(nz - oz) > 1e-5 && this._tryStep(ox, nz)) return true;
      return false;
    },

    _steerOut: { dx: 0, dz: 0, want: 0 },

    update(dt, t) {
      const input = G.input;
      input?.update?.();
      if (!this._ready) { this.rig.update(dt, this._rigParams); return; }
      if (!(dt > 0) || !fin(dt)) dt = 0;
      const W = G.world, p = this.position, v = this.velocity;
      const ctl = this.enabled && (input ? input.gameplay() : true);

      // ---- smooth reposition (sit / stand up)
      if (this._slide) {
        const s = this._slide;
        s.t += dt;
        const k = clamp(s.t / Math.max(1e-3, s.dur), 0, 1), e = k * k * (3 - 2 * k);
        p.set(s.fx + (s.x - s.fx) * e, s.fy + (s.y - s.fy) * e, s.fz + (s.z - s.fz) * e);
        if (k >= 1) this._slide = null;
      }

      // ---- input (constant over the frame)
      const ax = input ? input.axis : null;
      const mag = ax ? Math.min(1, Math.hypot(ax.x, ax.y)) : 0;
      let mdx = 0, mdz = 0, mwant = 0;
      if (ctl && mag > 0.05 && fin(mag)) {
        const bs = G.sys.camera?.getMoveBasis?.() || _fallbackBasis;
        mdx = bs.forward.x * ax.y + bs.right.x * ax.x;
        mdz = bs.forward.z * ax.y + bs.right.z * ax.x;
        const l = Math.hypot(mdx, mdz);
        if (l > 1e-6 && fin(l)) { mdx /= l; mdz /= l; mwant = (input.running ? RUN : WALK) * mag; } else { mdx = 0; mdz = 0; }
        this._faceT = null;
      } else if (this._walk && !ctl) {
        // paused by a modal / dialogue: freeze the stuck & time budget clocks
        const w = this._walk;
        w.bestT = t; w.startT += dt;
      }
      const manual = mwant > 0;
      const frozen = !!(this.sitting || this._slide);
      if (!frozen && (manual || (this._walk && ctl)) && this.rig.actionFullBody) this.rig.stopAction();

      // ---- jump (buffered input + coyote time) — once per frame, before the sub-steps
      const jumped = input ? input.consumeJump() : false;
      if (jumped && ctl) {
        if (this.sitting) this.standUp();
        else this._jumpBuf = 0.15;
      }
      this._jumpBuf -= dt;
      this._coyote = this.grounded ? 0.1 : this._coyote - dt;
      if (this._jumpBuf > 0 && this._coyote > 0 && !this.sitting && !this._slide) {
        v.y = JUMP_V; this.grounded = false; this._coyote = 0; this._jumpBuf = 0;
        if (this.rig.actionFullBody) this.rig.stopAction();
        G.sfx('jump');
      }

      // ---- sub-stepped locomotion: steering + velocity + turning + collisions + ground, <= MAX_SUBSTEP each
      const reach = Math.max(Math.hypot(v.x, v.z), manual ? mwant : (this._walk ? RUN : 0)) * dt;
      const n = frozen ? 1 : clamp(Math.ceil(reach / MAX_SUBSTEP), 1, MAX_SUBSTEPS);
      const sdt = dt / n;
      let moved = false, pushed = false, lastWant = 0;
      const o = this._steerOut;
      for (let k = 0; k < n; k++) {
        // desired direction / speed for this slice
        let dx = 0, dz = 0, want = 0;
        if (manual) { dx = mdx; dz = mdz; want = mwant; }
        else if (this._walk && ctl && !frozen) {
          if (this._steer(this._walk, t, sdt, o) && o.want > 0) { dx = o.dx; dz = o.dz; want = o.want; }
        }
        if (frozen) want = 0;
        lastWant = want;
        // velocity (turning against the current motion brakes at DECEL: crisp reversals at speed)
        const tvx = dx * want, tvz = dz * want;
        let acc;
        if (!this.grounded) acc = AIR_ACCEL;
        else if (want > 0) acc = (v.x * tvx + v.z * tvz) < 0 ? DECEL : ACCEL;
        else acc = DECEL;
        let ddx = tvx - v.x, ddz = tvz - v.z;
        const dl = Math.hypot(ddx, ddz), maxd = acc * sdt;
        if (dl > maxd && dl > 1e-9) { ddx *= maxd / dl; ddz *= maxd / dl; }
        v.x += ddx; v.z += ddz;
        if (!fin(v.x) || !fin(v.z)) { v.x = 0; v.z = 0; }
        // turning (a touch softer at a full sprint: no jitter, still precise)
        if (want > 0.1) {
          const sp = Math.hypot(v.x, v.z);
          const rate = this.grounded ? 16 - 5 * clamp(sp / RUN, 0, 1) : 6;
          this.rotY += angleDiff(this.rotY, Math.atan2(dx, dz)) * damp(rate, sdt);
        } else if (this._faceT != null && !this.sitting) {
          const diff = angleDiff(this.rotY, this._faceT);
          this.rotY += diff * damp(10, sdt);
          if (Math.abs(diff) < 0.01) this._faceT = null;
        }
        // horizontal move with collisions (<= MAX_SUBSTEP by construction of n)
        if (!this._slide && (Math.abs(v.x) > 1e-4 || Math.abs(v.z) > 1e-4)) {
          const ox = p.x, oz = p.z;
          let sx = v.x * sdt, sz = v.z * sdt;
          const sl = Math.hypot(sx, sz);
          if (sl > MAX_SUBSTEP) { sx *= MAX_SUBSTEP / sl; sz *= MAX_SUBSTEP / sl; } // (velocity spike guard)
          if (!this._move(p.x + sx, p.z + sz)) { v.x = 0; v.z = 0; pushed = pushed || want > 0; }
          else if (sdt > 0) {
            moved = true;
            // keep velocity consistent with what actually happened (sliding along walls)
            const mvx = (p.x - ox) / sdt, mvz = (p.z - oz) / sdt;
            if (Math.hypot(mvx, mvz) < Math.hypot(v.x, v.z) * 0.6) { v.x = mvx; v.z = mvz; }
          }
        }
        // vertical: follow the ground slice by slice (slopes & stairs at speed never launch the player)
        if (!this._slide) {
          const ground = W.heightAt(p.x, p.z, p.y + 0.05);
          if (this.grounded) {
            if (v.y > 0) this.grounded = false;
            else if (ground < p.y - 0.42) { this.grounded = false; v.y = 0; }
            else if (ground > p.y) {
              const diff = ground - p.y;
              const onTerrain = Math.abs(ground - W.terrainHeight(p.x, p.z)) < 0.01;
              // continuous terrain: stay glued to it; platform / stair edges: a quick ease up
              p.y = diff < 0.004 || (onTerrain && diff < 0.35) ? ground : p.y + diff * damp(26 + Math.hypot(v.x, v.z) * 3, sdt);
            } else p.y = ground;
          }
          if (!this.grounded) {
            v.y -= GRAVITY * sdt;
            p.y += v.y * sdt;
            const g2 = W.heightAt(p.x, p.z, p.y + 0.3);
            if (p.y <= g2 && v.y <= 0) {
              const impact = -v.y;
              p.y = g2; v.y = 0; this.grounded = true;
              if (impact > 3) {
                this._stepOpts.surface = W.surfaceAt(p.x, p.z); this._stepOpts.run = false;
                G.sfx('land', this._stepOpts);
              }
              if (impact > 10) G.sys.camera?.shake?.(Math.min(0.5, (impact - 10) * 0.06));
            }
          }
        }
        if (!fin(p.x) || !fin(p.y) || !fin(p.z)) break;
      }
      const blocked = pushed && !moved;
      this.rotY = Math.atan2(Math.sin(this.rotY), Math.cos(this.rotY));
      if (!fin(this.rotY)) this.rotY = 0;
      // safety net (NaN / fell out of the world)
      if (!fin(p.x) || !fin(p.y) || !fin(p.z) || p.y < -40 || !fin(v.y)) {
        const sp = G.data.layout?.spawn || { x: 0, z: 9 };
        p.set(sp.x, W.surfaceHeight(sp.x, sp.z), sp.z); v.set(0, 0, 0); this.grounded = true;
        if (!fin(p.y)) p.y = 0;
        this._dropWalk();
        G.log.warn('PLAYER', 'invalid position -> respawn');
      }

      this.object.rotation.y = this.rotY;
      const hs = Math.hypot(v.x, v.z);
      this.speed = hs;
      this.wantSpeed = lastWant;

      // ---- animation (gait, stride and playback rate follow the ground speed: no foot sliding)
      const rp = this._rigParams;
      rp.speed = blocked ? 0 : this.grounded ? hs : hs * 0.5; rp.grounded = this.grounded; rp.vy = v.y;
      this.rig.update(dt, rp);
      // footsteps: one per half stride of the animation (distance based), never machine-gunned
      this._stepT += dt;
      if (this.rig.steps !== this._steps) {
        this._steps = this.rig.steps;
        if (this._stepT >= 0.075) {
          this._stepT = 0;
          this._stepOpts.surface = p.y < (G.data.layout?.waterY ?? -1.1) - 0.02 ? 'water' : W.surfaceAt(p.x, p.z);
          this._stepOpts.run = hs > RUN_STEP;
          G.sfx('step', this._stepOpts);
        }
      }

      // ---- route trail
      const w = this._walk;
      if (trail.visible) {
        if (w && w.trail) trail.update(dt, fin(w.progress) ? w.progress : 0);
        else trail.hide();
      }

      G.sys.engine.focus.copy(p);

      // ---- events (moved <= 4/s, distance batched)
      const mx = p.x - this._prevPos.x, mz = p.z - this._prevPos.z;
      const md = Math.hypot(mx, mz);
      if (md < 5) this._distAcc += md; // ignore teleports
      this._prevPos.copy(p);
      if (this._distAcc >= 5) {
        const m = Math.floor(this._distAcc);
        this._distAcc -= m;
        G.bus.emit('player:distance', { meters: m });
      }
      this._emitT += dt;
      if (this._emitT >= 0.25) {
        const ed = Math.hypot(p.x - this._lastEmit.x, p.z - this._lastEmit.z);
        if (ed > 0.05) {
          this._emitT = 0;
          this._lastEmit.copy(p);
          G.bus.emit('player:moved', { x: p.x, z: p.z });
        }
      }
      // ---- persistence (no G.dirty: autosave + before-save hook persist it)
      this._saveT += dt;
      if (this._saveT >= 1) { this._saveT = 0; this._writeState(); }
      this._tagT += dt;
      if (this._tagT >= 1) { this._tagT = 0; this._refreshTag(); }
    },
  };
  G.register(player);
})();
