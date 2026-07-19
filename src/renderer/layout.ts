/**
 * Kosmos renderer — layout.
 * layoutCosmos: nested radial placement (systems -> galaxies -> cluster) with
 * a grid-accelerated separation pass, followed by a collision DIAGNOSTIC pass
 * (§12): count residual body intersections, attempt one bounded corrective
 * separation, and record whatever remains in graph.diagnostics — the layout
 * is designed to keep bodies separated and minimize overlap; zero overlap is
 * not claimed as a proven invariant.
 *
 * Also contains the legacy force layout used as a defensive fallback when the
 * cosmology pass throws on unexpected data.
 */
import {
  add3, buildCosmos, fib, GAP_AST, GAP_GAL, GAP_SYS, GAL_PACK, GOLDEN, hUnit,
  len3, minChord, MINSEP, OORT_GAP, ROLE_R, SYS_PACK, type CosmosOptions,
} from "./cosmology";
import { hashUnit } from "../core/paths";
import type { KosmosGraph } from "../core/types";

export { buildCosmos, classifyStar, classifyPlanet, starScore, SPECTRAL, PLANET_COLORS } from "./cosmology";

export function layoutCosmos(graph: any): KosmosGraph {
  const nodes: any[] = graph.nodes;
  const byId = new Map<string, any>();
  for (const n of nodes) byId.set(n.id, n);
  const clusterId = graph.clusterId;
  const galaxyCenter: Map<string, string> = graph.galaxyCenter || new Map();

  // chain children + per-system membership
  const childrenOf = new Map<string, any[]>();
  for (const n of nodes) { if (n.parentId) { let arr = childrenOf.get(n.parentId); if (!arr) { arr = []; childrenOf.set(n.parentId, arr); } arr.push(n); } }
  const oortBySystem = new Map<string, any[]>();
  for (const n of nodes) {
    if (n.role === "oort") {
      const k = n.systemId || ("gal:" + (n.galaxyId || "__root__"));
      let arr = oortBySystem.get(k); if (!arr) { arr = []; oortBySystem.set(k, arr); } arr.push(n);
    }
  }

  // place one solar system in local coords (star at origin); returns its extent
  function placeSystem(star: any): number {
    const members: any[] = [star];
    star.__sys = [0, 0, 0];
    (function rec(p: any, depth: number) {
      const kids = childrenOf.get(p.id) || [];
      const base = p.__r + (depth === 1 ? 0.95 : depth === 2 ? 0.45 : 0.3);
      kids.forEach((c: any, i: number) => {
        const ang = GOLDEN * i + hUnit(c.id) * 6.283;
        const rr = base + i * (depth === 1 ? 0.42 : depth === 2 ? 0.26 : 0.17);
        const el = (hUnit(c.id + "e") - 0.5) * (depth === 1 ? 0.7 : 1.3);
        c.__sys = [p.__sys[0] + Math.cos(ang) * rr, p.__sys[1] + Math.sin(el) * rr, p.__sys[2] + Math.sin(ang) * rr];
        members.push(c);
        rec(c, depth + 1);
      });
    })(star, 1);
    let core = star.__r;
    for (const m of members) core = Math.max(core, len3(m.__sys) + m.__r);
    const oort = oortBySystem.get(star.id) || [];
    if (oort.length) {
      const u = fib(oort.length);
      const R = core + OORT_GAP;
      oort.forEach((o: any, i: number) => { o.__sys = [u[i][0] * R, u[i][1] * R, u[i][2] * R]; members.push(o); });
      star.__extent = R + ROLE_R.oort + 1.5;
    } else star.__extent = core + 1.5;
    star.__members = members;
    return star.__extent;
  }

  // place one galaxy in local coords (galactic center at origin); returns extent
  function placeGalaxy(galId: string, centerNode: any): number {
    const centerR = centerNode.__r || ROLE_R.galaxy;
    const stars = nodes.filter((n) => n.role === "star" && n.galaxyId === galId);
    let maxExt = centerR;
    const exts = stars.map((s) => ({ s, ext: placeSystem(s) }));
    for (const e of exts) maxExt = Math.max(maxExt, e.ext);
    if (stars.length) {
      const u = fib(stars.length);
      const mc = stars.length > 1 ? minChord(u) : 1;
      let Rs = stars.length > 1 ? (SYS_PACK * 2 * maxExt + GAP_SYS) / mc : (maxExt + centerR + GAP_SYS);
      Rs = Math.max(Rs, centerR + ROLE_R.star + GAP_SYS, (2 * ROLE_R.star + MINSEP + 0.25) / mc);
      stars.forEach((s: any, i: number) => {
        const off = [u[i][0] * Rs, u[i][1] * Rs * 0.85, u[i][2] * Rs];
        for (const m of s.__members) m.__gal = add3(m.__sys, off);
      });
      centerNode.__galRs = Rs;
      centerNode.__galMaxExt = maxExt;
    }
    centerNode.__gal = [0, 0, 0];
    const ast = nodes.filter((n) => n.role === "asteroid" && n.galaxyId === galId);
    const baseR = (stars.length ? (centerNode.__galRs + centerNode.__galMaxExt) : centerR) + GAP_AST;
    if (ast.length) {
      const u = fib(ast.length);
      ast.forEach((a: any, i: number) => {
        const rr = baseR * (0.9 + 0.25 * hUnit(a.id + "r"));
        a.__gal = [u[i][0] * rr, u[i][1] * rr * 0.9, u[i][2] * rr];
      });
    }
    const goort = (oortBySystem.get("gal:" + galId) || []);
    if (goort.length) {
      const u = fib(goort.length);
      const R = centerR + OORT_GAP;
      goort.forEach((o: any, i: number) => { o.__gal = [u[i][0] * R, u[i][1] * R, u[i][2] * R]; });
    }
    let ext = centerR;
    for (const n of nodes) { if (n.galaxyId === galId && n.__gal) ext = Math.max(ext, len3(n.__gal) + n.__r); }
    centerNode.__extent = ext + 2;
    return centerNode.__extent;
  }

  // ----- cluster level -----
  const clusterNode = byId.get(clusterId);
  clusterNode.position = [0, 0, 0];
  const clusterR = clusterNode.__r || ROLE_R.cluster;

  const realGalaxies = (graph.galaxies || []).map((g: any) => byId.get(g.center)).filter(Boolean);
  const galExt = realGalaxies.map((g: any) => ({ g, ext: placeGalaxy(g.galaxyId, g) }));
  let maxGalExt = clusterR;
  for (const e of galExt) maxGalExt = Math.max(maxGalExt, e.ext);
  if (realGalaxies.length) {
    const u = fib(realGalaxies.length);
    const mc = realGalaxies.length > 1 ? minChord(u) : 1;
    let Rc = realGalaxies.length > 1 ? (GAL_PACK * 2 * maxGalExt + GAP_GAL) / mc : (maxGalExt + clusterR + GAP_GAL);
    Rc = Math.max(Rc, clusterR + maxGalExt + GAP_GAL);
    realGalaxies.forEach((g: any, i: number) => {
      const off = [u[i][0] * Rc, u[i][1] * Rc * 0.6, u[i][2] * Rc];
      for (const n of nodes) { if (n.galaxyId === g.galaxyId && n.__gal) n.position = add3(n.__gal, off); }
    });
    graph.__clusterRingR = Rc;
  }
  // root systems: cluster is their galactic center (placed at origin)
  placeGalaxy("__root__", clusterNode);
  for (const n of nodes) { if (n.galaxyId === "__root__" && n.__gal) n.position = n.__gal.slice(); }
  clusterNode.position = [0, 0, 0];

  // any stragglers without a position (defensive)
  for (const n of nodes) {
    if (n.position) continue;
    if (n.role === "hidden") { n.position = [0, 0, 0]; continue; }
    const a = hUnit(n.id) * 6.283, bb = hUnit(n.id + "b") * 3.14;
    const R = (graph.__clusterRingR || 80) * 1.1;
    n.position = [Math.cos(a) * Math.sin(bb) * R, Math.cos(bb) * R * 0.6, Math.sin(a) * Math.sin(bb) * R];
  }

  separateCosmos(graph);

  // ---- §12 diagnostic pass: count residual intersections, one bounded corrective pass ----
  let residual = countIntersections(graph);
  if (residual > 0) {
    separateCosmos(graph, 8); // bounded corrective separation
    residual = countIntersections(graph);
  }
  if (graph.diagnostics) graph.diagnostics.residualCollisions = residual;
  graph.__residualCollisions = residual;
  if (residual > 0 && typeof console !== "undefined") {
    console.debug(`Vault Kosmos layout: ${residual} residual body intersection(s) after corrective pass`);
  }

  // orbital parameters: every body revolves about world +Y around its parent.
  // With ECC=0 (or unset) the motion is a perfect circle, preserving the current
  // radius so animation never introduces new collisions. With ECC>0 the object
  // traces an ellipse whose *apoapsis* is pinned to the original |ov| — so max
  // reach from the parent never exceeds the current radius (collision-safe),
  // while periapsis pulls the body inward by up to `e` and the geometric speed
  // varies around the orbit, giving a gravity-anchored feel.
  const SPD: Record<string, number> = { galaxy: 0.005, star: 0.02, asteroid: 0.03, oort: 0.012 };
  // Median-ish reference mass per role for the Kepler speed scaling — sqrt(m/ref)
  // so heavier parents pull satellites faster without dwarf systems crawling.
  const REF_MASS: Record<string, number> = { star: 1.0, planet: 0.7, moon: 0.4, galaxy: 6.0, cluster: 10.0 };
  function parentIdOf(n: any): string | null {
    if (n.role === "galaxy") return clusterId;
    if (n.role === "star") return galaxyCenter.get(n.galaxyId) || clusterId;
    if (n.role === "planet" || n.role === "moon" || n.role === "moonlet") return n.parentId || null;
    if (n.role === "asteroid") return galaxyCenter.get(n.galaxyId) || clusterId;
    if (n.role === "oort") return n.systemId || galaxyCenter.get(n.galaxyId) || clusterId;
    return null;
  }
  // How eccentric should this body's orbit be? Heavier (better-anchored) bodies
  // orbit more circularly; lighter/isolated bodies swing more. Deterministic
  // (hUnit hash + node mass), capped so the ellipse never approaches degeneracy.
  function eccentricityFor(n: any): number {
    // outer/edge bodies stay circular — moving these tips of the packing would
    // over-emphasize the wobble on cosmetic elements
    if (n.role === "asteroid" || n.role === "oort" || n.role === "cluster") return 0;
    const mass = Math.max(0.05, Math.min(1.5, (n.mass || 0.5)));
    // heavy: meanE ≈ 0.05; light: meanE ≈ 0.22
    const meanE = 0.22 - Math.min(0.17, mass * 0.15);
    const jitter = (hUnit(n.id + ":ecc") - 0.5) * 0.16; // ±0.08
    return Math.max(0, Math.min(0.28, meanE + jitter));
  }
  const orbiters: any[] = [];
  for (const n of nodes) {
    if (n.role === "hidden" || n.role === "cluster" || !n.position) continue;
    const pid = parentIdOf(n);
    const p = pid && byId.get(pid);
    if (!p || !p.position) continue;
    const ov = [n.position[0] - p.position[0], n.position[1] - p.position[1], n.position[2] - p.position[2]];
    const rxz = Math.hypot(ov[0], ov[2]) || 0.001;
    let sp = n.role === "planet" ? 0.6 / (rxz + 1.0)
      : n.role === "moon" ? Math.min(0.45, 1.0 / (rxz + 0.5))
      : n.role === "moonlet" ? Math.min(0.55, 1.2 / (rxz + 0.4))
      : (SPD[n.role] || 0);
    sp *= (0.85 + 0.3 * hUnit(n.id + "sp"));
    // Kepler-inspired: heavier parents pull satellites faster (bounded so a
    // very massive galaxy doesn't blur its own contents).
    const pMass = Math.max(0.1, p.mass || REF_MASS[p.role] || 1.0);
    const ref = REF_MASS[p.role] || 1.0;
    const gravScale = Math.max(0.6, Math.min(1.9, Math.sqrt(pMass / ref)));
    sp *= gravScale;
    n.__op = pid; n.__ov = ov; n.__os = sp;
    n.__ecc = eccentricityFor(n);
    orbiters.push(n);
  }
  // Sibling perturbation (option 2): the heaviest sibling in the same system
  // slightly tugs its neighbours' orbital planes. One sine term, amplitude
  // capped small so it reads as "gravity has a hold" without breaking packing.
  const heaviest = new Map<string, any>();
  for (const n of orbiters) {
    const b = heaviest.get(n.__op);
    if (!b || (n.mass || 0) > (b.mass || 0)) heaviest.set(n.__op, n);
  }
  for (const n of orbiters) {
    const bully = heaviest.get(n.__op);
    if (!bully || bully === n) continue;
    const pMass = Math.max(0.1, (byId.get(n.__op)?.mass || 1.0));
    const bullyMass = Math.max(0, bully.mass || 0);
    const ratio = bullyMass / (pMass + bullyMass); // 0..1, small when parent dominates
    // Perturbation is a THETA jitter (radians): the bully tug advances/retards
    // the body along its orbit — never displaces it perpendicular. This keeps
    // the max radius exactly = a(1+e) = |ov_horiz| (collision-safe), and lets
    // t=0 be a no-op regardless of phase.
    n.__wob_amp = Math.min(0.14, 0.32 * ratio); // radians, max ~8°
    n.__wob_freq = bully.__os || 0;
    n.__wob_phase = hUnit(n.id + ":wobph") * 6.2831853;
  }
  graph.statsRef = graph.stats;
  return graph;
}

/** Count pairs of visible bodies whose spheres actually intersect (r1+r2). */
export function countIntersections(graph: any): number {
  const list = graph.nodes.filter((n: any) => n.role !== "hidden" && n.position);
  const n = list.length;
  if (n < 2) return 0;
  let maxR = 0;
  for (const x of list) maxR = Math.max(maxR, x.__r || 0.5);
  const cell = 2 * maxR + 1.0;
  const key = (x: number, y: number, z: number) => x + "," + y + "," + z;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const p = list[i].position;
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
    const k = key(gx, gy, gz);
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
    list[i].__gx = gx; list[i].__gy = gy; list[i].__gz = gz;
  }
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = list[i], ap = a.position, ar = a.__r || 0.5;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(key(a.__gx + dx, a.__gy + dy, a.__gz + dz));
      if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const b = list[j], bp = b.position, br = b.__r || 0.5;
        const ddx = bp[0] - ap[0], ddy = bp[1] - ap[1], ddz = bp[2] - ap[2];
        const need = ar + br;
        if (ddx * ddx + ddy * ddy + ddz * ddz < need * need) count++;
      }
    }
  }
  return count;
}

/**
 * Grid-accelerated relaxation that pins the big anchors (cluster, galactic
 * centers, stars) and nudges everything else apart.
 */
export function separateCosmos(graph: any, iterations = 26): void {
  const list = graph.nodes.filter((n: any) => n.role !== "hidden" && n.position);
  const n = list.length;
  if (n < 2) return;
  const pinned = (nd: any) => { const r = nd.role; return r === "cluster" || r === "galaxy" || r === "star"; };
  let maxR = 0;
  for (const x of list) maxR = Math.max(maxR, x.__r || 0.5);
  const cell = 2 * maxR + 2.0;
  const key = (x: number, y: number, z: number) => x + "," + y + "," + z;
  for (let it = 0; it < iterations; it++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const p = list[i].position;
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
      const k = key(gx, gy, gz);
      let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
      list[i].__gx = gx; list[i].__gy = gy; list[i].__gz = gz;
    }
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = list[i], ap = a.position, ar = a.__r || 0.5;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(key(a.__gx + dx, a.__gy + dy, a.__gz + dz));
        if (!arr) continue;
        for (const j of arr) {
          if (j <= i) continue;
          const b = list[j], bp = b.position, br = b.__r || 0.5;
          let ddx = bp[0] - ap[0], ddy = bp[1] - ap[1], ddz = bp[2] - ap[2];
          let d = Math.hypot(ddx, ddy, ddz);
          const need = ar + br + MINSEP;
          if (d >= need) continue;
          if (d === 0) {
            ddx = (hUnit(a.id + b.id) - 0.5); ddy = (hUnit(b.id + a.id) - 0.5); ddz = (hUnit(a.id + "z" + b.id) - 0.5);
            d = Math.hypot(ddx, ddy, ddz) || 1;
          }
          const push = (need - d) / d;
          const ux = ddx * push, uy = ddy * push, uz = ddz * push;
          const ap_ = pinned(a), bp_ = pinned(b);
          if (ap_ && bp_) continue; // two anchors: construction keeps them apart
          if (ap_) { bp[0] += ux; bp[1] += uy; bp[2] += uz; }
          else if (bp_) { ap[0] -= ux; ap[1] -= uy; ap[2] -= uz; }
          else {
            ap[0] -= ux * 0.5; ap[1] -= uy * 0.5; ap[2] -= uz * 0.5;
            bp[0] += ux * 0.5; bp[1] += uy * 0.5; bp[2] += uz * 0.5;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** Full cosmology pipeline from a buildGraph() result. */
export function positionCosmos(graph: any, opts?: CosmosOptions): KosmosGraph {
  return layoutCosmos(buildCosmos(graph, opts));
}

/* ==========================================================================
   Legacy taxonomy layout — defensive fallback only.
   ========================================================================== */

function nodeRadius(node: any): number {
  if (node.kind === "folder") return node.depth === 0 ? 1.55 : 0.88;
  if (node.kind === "unresolved") return 0.26;
  const deg = node.incoming + node.outgoing;
  return 0.24 + Math.min(0.62, Math.sqrt(deg) * 0.075);
}

export function layoutGraph(graph: any, focusIds: Set<string> = new Set(), primaryId?: string): any {
  const areas = graph.areas.filter((a: string) => a !== "Vault" && a !== "Unresolved");
  const centers = new Map<string, number[]>();
  const shell = Math.max(30, areas.length * 3.7);
  const vspread = Math.max(16, areas.length * 1.8);
  areas.forEach((area: string, i: number) => {
    const angle = i * GOLDEN + hashUnit(area) * 0.9;
    const tier = ((i % 5) - 2) / 2;
    const depth = (hashUnit(`${area}:depth`) - 0.5) * shell * 0.45;
    centers.set(area, [
      Math.cos(angle) * shell * (0.68 + hashUnit(`${area}:x`) * 0.28),
      tier * vspread + (hashUnit(`${area}:y`) - 0.5) * 10,
      Math.sin(angle) * shell * (0.68 + hashUnit(`${area}:z`) * 0.28) + depth,
    ]);
  });

  const nodes = graph.nodes.map((node: any, i: number) => ({
    ...node,
    radius: nodeRadius(node),
    position: nodePosition(node, i, centers, graph.nodes.length, focusIds, primaryId),
  }));
  settle(nodes, graph.links, centers, primaryId, focusIds);
  const nodeById = new Map<string, any>(nodes.map((n: any) => [n.id, n] as [string, any]));
  classifyBodies(nodes, graph.links);
  attachMoons(nodes, graph.links, nodeById);
  return { ...graph, nodes, nodeById };
}

function nodePosition(node: any, index: number, centers: Map<string, number[]>, total: number, focusIds: Set<string>, primaryId?: string): number[] {
  if (node.id === "folder:.") return [0, 0, 0];
  if (primaryId === node.id) return [0, 22, 42];
  if (focusIds.has(node.id)) {
    const orbit = hashUnit(`${node.id}:focus`) * Math.PI * 2;
    const lane = (index % 7) - 3;
    const r = 7 + hashUnit(`${node.id}:focus-radius`) * 16;
    return [Math.cos(orbit) * r, 18 + lane * 3.2 + hashUnit(`${node.id}:focus-y`) * 5, 28 + Math.sin(orbit) * r * 0.65];
  }
  if (node.kind === "unresolved") {
    const a = hashUnit(node.id) * Math.PI * 2, r = 56 + hashUnit(`${node.id}:r`) * 20;
    return [Math.cos(a) * r, -22 + hashUnit(`${node.id}:y`) * 44, Math.sin(a) * r];
  }
  const c = centers.get(node.area) ?? [0, 0, 0];
  const areaSeed = hashUnit(node.area), local = hashUnit(node.id);
  const angle = (local * Math.PI * 2 + areaSeed * Math.PI) % (Math.PI * 2);
  const vphase = Math.sin(local * Math.PI * 6 + node.depth);
  const lift = Math.min(18, node.depth * 2.35);
  const spread = node.kind === "folder" ? 7 + node.depth * 2.9 : 11 + Math.log(total) * 2.05;
  const radial = spread * Math.sqrt(hashUnit(`${node.id}:spread`));
  const zdrift = (hashUnit(`${node.id}:drift`) - 0.5) * spread * 1.25;
  const y = node.kind === "folder" ? c[1] + lift - 7 : c[1] + lift + vphase * 12 + (hashUnit(`${node.id}:y`) - 0.5) * 22;
  return [c[0] + Math.cos(angle) * radial, y, c[2] + Math.sin(angle) * radial + zdrift];
}

function isPinnedLegacy(n: any, primaryId: string | undefined, focusIds: Set<string>): boolean {
  return n.id === "folder:." || n.id === primaryId || focusIds.has(n.id);
}

function settle(nodes: any[], links: any[], centers: Map<string, number[]>, primaryId: string | undefined, focusIds: Set<string>): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sample = links.filter((l) => {
    if (l.kind === "contains") return false;
    if (!byId.has(l.source) || !byId.has(l.target)) return false;
    if (l.source === primaryId || l.target === primaryId) return true;
    if (focusIds.has(l.source) || focusIds.has(l.target)) return true;
    const th = l.kind === "property" ? 0.42 : l.kind === "wikilink" ? 0.3 : 0.22;
    return hashUnit(`settle:${l.id}`) < th;
  });
  const iters = nodes.length > 900 ? 18 : 28;
  const scratch = new Map<string, number[]>();
  const addDelta = (id: string, x: number, y: number, z: number) => {
    const c = scratch.get(id);
    if (c) { c[0] += x; c[1] += y; c[2] += z; } else scratch.set(id, [x, y, z]);
  };
  for (let it = 0; it < iters; it++) {
    scratch.clear();
    for (const l of sample) {
      const s = byId.get(l.source), t = byId.get(l.target);
      if (!s || !t || isPinnedLegacy(s, primaryId, focusIds) || isPinnedLegacy(t, primaryId, focusIds)) continue;
      const dx = t.position[0] - s.position[0], dy = t.position[1] - s.position[1], dz = t.position[2] - s.position[2];
      const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
      const desired = l.kind === "property" ? 13 : l.kind === "wikilink" ? 16 : 19;
      const force = Math.max(-0.28, Math.min(0.28, (dist - desired) * 0.0045));
      const fx = (dx / dist) * force, fy = (dy / dist) * force * 0.72, fz = (dz / dist) * force;
      addDelta(s.id, fx, fy, fz);
      addDelta(t.id, -fx, -fy, -fz);
    }
    for (const n of nodes) {
      if (isPinnedLegacy(n, primaryId, focusIds)) continue;
      const c = centers.get(n.area);
      if (!c || n.kind === "unresolved") continue;
      const pull = n.kind === "folder" ? 0.018 : 0.006;
      addDelta(n.id, (c[0] - n.position[0]) * pull, (c[1] + n.depth * 1.8 - n.position[1]) * pull * 0.6, (c[2] - n.position[2]) * pull);
    }
    for (const n of nodes) {
      const d = scratch.get(n.id);
      if (!d) continue;
      n.position = [n.position[0] + d[0], n.position[1] + d[1], n.position[2] + d[2]];
    }
  }
}

function degreeOf(n: any): number { return (n.incoming || 0) + (n.outgoing || 0); }

function classifyBodies(nodes: any[], links: any[]): void {
  const fileDegrees = nodes.filter((n) => n.kind === "file").map(degreeOf).sort((a, b) => a - b);
  const maxDeg = fileDegrees.at(-1) || 0;
  const p = (q: number) => fileDegrees.length ? fileDegrees[Math.min(fileDegrees.length - 1, Math.floor(q * fileDegrees.length))] : 0;
  const starCut = Math.max(7, p(0.94), Math.round(maxDeg * 0.72));
  const planetCut = Math.max(4, p(0.74));
  const moonCut = Math.max(2, p(0.42));

  const childCount = new Map<string, number>();
  for (const l of links) if (l.kind === "contains") childCount.set(l.source, (childCount.get(l.source) || 0) + 1);
  const folderChildren = nodes.filter((n) => n.kind === "folder").map((n) => childCount.get(n.id) || 0).sort((a, b) => a - b);
  const folderStarCut = Math.max(12, folderChildren.length ? folderChildren[Math.floor(0.9 * folderChildren.length)] : 0);

  for (const n of nodes) {
    const deg = degreeOf(n);
    if (n.kind === "unresolved") { n.body = "asteroid"; }
    else if (n.kind === "folder") {
      if (n.depth === 0) n.body = "star";
      else n.body = (childCount.get(n.id) || 0) >= folderStarCut ? "star" : "planet";
    } else {
      if (deg === 0) n.body = "asteroid";
      else if (deg >= starCut) n.body = "star";
      else if (deg >= planetCut) n.body = "planet";
      else if (deg >= moonCut) n.body = "moon";
      else n.body = "moonlet";
    }
    n.mass = bodyMass(n, deg, childCount.get(n.id) || 0);
  }
}

function bodyMass(n: any, deg: number, children: number): number {
  if (n.body === "star") return n.kind === "folder" ? 2.2 + Math.min(1.8, children * 0.05) : 1.4 + Math.min(1.6, Math.sqrt(deg) * 0.16);
  if (n.body === "planet") return n.kind === "folder" ? 1.0 + Math.min(0.9, children * 0.04) : 0.7 + Math.min(0.7, Math.sqrt(deg) * 0.12);
  if (n.body === "moon") return 0.42 + deg * 0.04;
  if (n.body === "moonlet") return 0.3;
  return 0.26;
}

function attachMoons(nodes: any[], links: any[], nodeById: Map<string, any>): number {
  const neighbours = new Map<string, Set<string>>();
  const push = (k: string, v: string) => { let s = neighbours.get(k); if (!s) { s = new Set(); neighbours.set(k, s); } s.add(v); };
  for (const l of links) {
    if (l.kind === "contains") continue;
    push(l.source, l.target);
    push(l.target, l.source);
  }
  let orbitN = 0;
  for (const n of nodes) {
    if (n.body !== "moon" && n.body !== "moonlet") continue;
    const ns = neighbours.get(n.id);
    if (!ns || ns.size === 0) continue;
    let hub: any = null, best = -1;
    for (const id of ns) {
      const h = nodeById.get(id);
      if (!h) continue;
      if (h.body !== "star" && h.body !== "planet") continue;
      const m = (h.mass || 0);
      if (m > best) { best = m; hub = h; }
    }
    if (!hub) continue;
    const k = `${n.id}:moonorbit`;
    const a = hashUnit(k) * Math.PI * 2;
    const inc = (hashUnit(k + ":inc") - 0.5) * 1.1;
    const dist = (hub.mass * (n.body === "moonlet" ? 1.9 : 2.5)) + 1.2 + hashUnit(k + ":d") * 1.4;
    const px = hub.position[0] + Math.cos(a) * dist;
    const py = hub.position[1] + Math.sin(inc) * dist * 0.6;
    const pz = hub.position[2] + Math.sin(a) * dist;
    n.position = [n.position[0] * 0.3 + px * 0.7, n.position[1] * 0.3 + py * 0.7, n.position[2] * 0.3 + pz * 0.7];
    n.orbitOf = hub.id;
    orbitN++;
  }
  return orbitN;
}
