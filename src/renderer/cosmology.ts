/**
 * Kosmos renderer — Local Cluster cosmology (visual classification).
 *   Cluster center  : root manifest (gravitational focal point)
 *   Galaxy          : a top-level folder; its Galactic Center = the folder's
 *                     manifest note (or the folder itself)
 *   Solar System    : a "star" note + its planets/moons/moonlets chain
 *   Asteroids       : free-floating low-link / unresolved ideas, bound to area
 *   Oort cloud      : attachment files, in an outer shell per system
 *
 * buildCosmos annotates every node with role / galaxyId / systemId / parentId /
 * hostId / body / __r and produces graph.cosmosLinks. It CONSUMES a Kosmos Core
 * graph and never re-derives graph semantics — lineage, temporal state and
 * link kinds arrive already normalized from the core (§2.2/§33).
 */
import { ATTACHMENT_EXTENSIONS } from "../core/paths";
import type { KosmosGraph } from "../core/types";

export const GOLDEN = 2.399963229728653;
const MANIFEST_NAMES = ["index", "home", "readme", "_index", "moc", "map", "overview", "dashboard", "start", "contents", "toc"];

export const ROLE_R: Record<string, number> = { cluster: 3.0, galaxy: 2.3, star: 1.7, planet: 0.95, moon: 0.55, moonlet: 0.40, asteroid: 0.34, oort: 0.18, hidden: 0 };
export const GAP_SYS = 0.8;   // clear space between solar systems inside a galaxy
export const GAP_AST = 0.9;   // asteroid shell beyond the solar systems
export const GAP_GAL = 1.5;   // clear space between galaxies
export const GAL_PACK = 0.6;  // galaxy packing on the cluster sphere
export const SYS_PACK = 0.42; // solar-system packing inside a galaxy
export const OORT_GAP = 0.7;  // Oort shell beyond a system's core
export const MINSEP = 0.55;   // hard minimum gap enforced by the separation pass

/* ------------------------------------------------------------------ *
 *  Hertzsprung–Russell stellar classification (pure, unit-testable)
 * ------------------------------------------------------------------ *
 * A star's "stellar mass" is the knowledge weight of its solar system:
 * member notes + distinct subfolders they span + total byte size. Heavier
 * systems sit further up the main sequence — hotter, bluer, larger
 * (M red dwarf → K → G Sun-like → F → A → B → O blue giant), i.e. the
 * main-sequence diagonal of the H-R diagram in the reference image. */
export const SPECTRAL: Array<{ cut: number; cls: string; color: string; mult: number }> = [
  { cut: 0.92, cls: "O", color: "#9db8ff", mult: 1.55 }, // hot blue giant
  { cut: 0.78, cls: "B", color: "#bcd2ff", mult: 1.40 }, // blue-white
  { cut: 0.62, cls: "A", color: "#e8edff", mult: 1.26 }, // white (Sirius A)
  { cut: 0.46, cls: "F", color: "#fff4e0", mult: 1.13 }, // yellow-white
  { cut: 0.30, cls: "G", color: "#ffd27a", mult: 1.00 }, // yellow (the Sun)
  { cut: 0.16, cls: "K", color: "#ffa25e", mult: 0.90 }, // orange
  { cut: -1,   cls: "M", color: "#ff7a4d", mult: 0.80 }, // red dwarf (Proxima Centauri)
];

/** Weight of a solar system from its notes / subfolders / bytes. */
export function starScore(files: number, subfolders: number, bytes: number): number {
  return files + 0.6 * subfolders + Math.min(4, Math.log10(1 + bytes / 1024));
}

/** Map a star's score (against the vault's heaviest, floored) to a spectral class. */
export function classifyStar(score: number, maxScore: number): { cls: string; color: string; mult: number; t: number } {
  // Floor the denominator so a two-note vault never mints an O-class blue giant.
  const t = Math.min(1, score / Math.max(maxScore, 12));
  const s = SPECTRAL.find((x) => t >= x.cut)!;
  return { cls: s.cls, color: s.color, mult: s.mult, t };
}

/* ------------------------------------------------------------------ *
 *  NASA exoplanet classification (pure, unit-testable)
 * ------------------------------------------------------------------ *
 * Four types per science.nasa.gov/exoplanets/planet-types — gas giant,
 * Neptunian (ice giants incl. mini-Neptunes), super-Earth, terrestrial —
 * correlated to the note: descendant moons (child notes), hosted
 * attachments, and note size choose the class; a stable hash picks the
 * in-class variety. style codes: 0 terrestrial, 1 gas, 2 neptunian, 3 super-earth. */
export const PLANET_COLORS: Record<string, string> = {
  jupiter: "#c9986a", saturn: "#d8bd84",                                         // gas giants
  neptune: "#3f6fd9", uranus: "#7fd4d4",                                         // Neptunian ice giants
  "super-water": "#4f8fb8", "super-rock": "#b0725a", "super-verdant": "#5a8f7a", // super-Earths
  mercury: "#9a938c", venus: "#e9d29a", earth: "#3f7fc9", mars: "#c25a38",       // terrestrial
};
const PTYPE_NAME: Record<number, string> = { 0: "Terrestrial", 1: "Gas giant", 2: "Neptunian", 3: "Super-Earth" };
const PTYPE_MULT: Record<number, number> = { 0: 1.0, 1: 1.22, 2: 1.1, 3: 1.05 };

export interface PlanetClass { style: number; variant: string; name: string; color: string; mult: number; rings: boolean; }

export function classifyPlanet(moons: number, attachCount: number, sizeBytes: number, seed: number): PlanetClass {
  const sizeKB = (Number(sizeBytes) || 0) / 1024;
  const h = seed - Math.floor(seed); // fractional part → [0,1)
  let style: number, variant: string;
  if (moons > 3) {                                  // many child notes → gas giant
    style = 1; variant = h < 0.5 ? "jupiter" : "saturn";
  } else if (moons >= 2) {                          // a couple of children → ice giant
    style = 2; variant = attachCount > 0 ? "neptune" : (h < 0.5 ? "uranus" : "neptune");
  } else if (moons === 1 || sizeKB > 24) {          // one child or a hefty note → super-Earth
    style = 3; variant = attachCount > 0 ? "super-water" : (h < 0.5 ? "super-rock" : "super-verdant");
  } else {                                          // leaf-ish note → terrestrial
    style = 0; variant = attachCount > 0 ? "earth" : (h < 0.25 ? "mercury" : h < 0.5 ? "venus" : h < 0.75 ? "mars" : "earth");
  }
  return { style, variant, name: PTYPE_NAME[style], color: PLANET_COLORS[variant], mult: PTYPE_MULT[style], rings: style === 1 };
}

// ---- tiny deterministic helpers ----
export function hStr(s: any): number { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export function hUnit(s: any): number { return (hStr(s) % 100000) / 100000; }
export function baseName(p: any): string { p = String(p || "").replace(/\/+$/, ""); const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
export function dirName(p: any): string { p = String(p || "").replace(/\/+$/, ""); const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
export function stripExt(name: string): string { const i = name.lastIndexOf("."); return i <= 0 ? name : name.slice(0, i); }
export function extOf(p: any): string { const b = baseName(p); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i + 1).toLowerCase(); }
export function add3(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function len3(a: number[]): number { return Math.hypot(a[0], a[1], a[2]); }
export function fib(n: number): number[][] {
  const out: number[][] = [];
  if (n <= 0) return out;
  if (n === 1) return [[0, 0, 1]];
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = GOLDEN * i;
    out.push([r * Math.cos(t), y, r * Math.sin(t)]);
  }
  return out;
}
export function minChord(units: number[][]): number {
  let m = Infinity;
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d < m) m = d;
  }
  return isFinite(m) ? Math.max(m, 1e-3) : 1;
}

export interface CosmosOptions { attachments?: string[] }

export function buildCosmos(graph: any, opts: CosmosOptions = {}): KosmosGraph {
  const attachSet = new Set((opts.attachments || []).map((p) => String(p)));
  const nodes: any[] = graph.nodes;
  const byId = new Map<string, any>();
  for (const n of nodes) byId.set(n.id, n);

  // idea adjacency (everything except folder-containment), undirected
  const adj = new Map<string, Set<string>>();
  const linkFrom = new Map<string, string[]>();
  const ensure = (m: Map<string, Set<string>>, k: string) => { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } return s; };
  for (const l of (graph.links || [])) {
    if (l.kind === "contains") continue;
    if (!byId.has(l.source) || !byId.has(l.target)) continue;
    ensure(adj, l.source).add(l.target);
    ensure(adj, l.target).add(l.source);
    let lf = linkFrom.get(l.source); if (!lf) { lf = []; linkFrom.set(l.source, lf); } lf.push(l.target);
  }
  const deg = (id: string) => (adj.get(id)?.size || 0);

  // ---- reclassify attachment-like unresolved nodes into Oort objects ----
  for (const n of nodes) {
    const isAttach = (n.kind === "unresolved" && (ATTACHMENT_EXTENSIONS.has(extOf(n.path || n.label)) || attachSet.has(n.path)))
      || (n.kind === "file" && ATTACHMENT_EXTENSIONS.has(n.extension || extOf(n.path)));
    if (isAttach) { n.role = "oort"; n.body = "oort"; }
  }

  // ---- discover the top-level folders (galaxies) ----
  const fileNodes = nodes.filter((n) => n.kind === "file" && n.role !== "oort");
  const galaxyIds = [...new Set(fileNodes.map((n) => n.area).filter((a) => a && a !== "Root" && a !== "Unresolved" && a !== "Vault"))] as string[];

  const rankName = (name: string) => { const k = stripExt(baseName(name)).toLowerCase(); const i = MANIFEST_NAMES.indexOf(k); return i < 0 ? 99 : i; };
  function pickManifest(candidates: any[], folderName: string | null): any {
    let best: any = null, bestScore = 1e9;
    for (const c of candidates) {
      const bn = stripExt(baseName(c.path)).toLowerCase();
      const score = (folderName && bn === String(folderName).toLowerCase()) ? -1 : rankName(c.path);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return (best && bestScore < 99) ? best : null;
  }

  // ---- cluster center (root manifest) ----
  const rootFiles = fileNodes.filter((n) => dirName(n.path) === "");
  let clusterNode = pickManifest(rootFiles, null);
  if (!clusterNode) clusterNode = byId.get("folder:.") || null;
  if (!clusterNode) {
    clusterNode = { id: "cosmos:cluster", kind: "folder", path: "", label: "Vault", area: "Vault", depth: 0, tags: [], aliases: [], color: "#f8fafc", outgoing: 0, incoming: 0 };
    nodes.push(clusterNode); byId.set(clusterNode.id, clusterNode);
    if (graph.nodeById) graph.nodeById.set(clusterNode.id, clusterNode);
  }
  clusterNode.role = "cluster"; clusterNode.body = "cluster"; clusterNode.galaxyId = "__cluster__";
  const clusterId = clusterNode.id;

  // ---- per-galaxy galactic centers ----
  const galaxyCenter = new Map<string, string>();
  for (const A of galaxyIds) {
    const folderNode = byId.get("folder:" + A);
    const inFolder = fileNodes.filter((n) => dirName(n.path) === A);
    const manifest = pickManifest(inFolder, A);
    let center: any;
    if (manifest) { center = manifest; if (folderNode) { folderNode.role = "hidden"; folderNode.body = "hidden"; } }
    else if (folderNode) { center = folderNode; }
    else {
      center = { id: "cosmos:gal:" + A, kind: "folder", path: A, label: A, area: A, depth: 1, tags: [], aliases: [], color: "#cbd5e1", outgoing: 0, incoming: 0 };
      nodes.push(center); byId.set(center.id, center);
      if (graph.nodeById) graph.nodeById.set(center.id, center);
    }
    center.role = "galaxy"; center.body = "galaxy"; center.galaxyId = A;
    galaxyCenter.set(A, center.id);
  }
  // hide all other folder nodes (subfolders are organizational only)
  for (const n of nodes) { if (n.kind === "folder" && n.role !== "galaxy" && n.role !== "cluster") { n.role = "hidden"; n.body = "hidden"; } }

  // ---- classify a galaxy's notes into stars / planets / moons / moonlets / asteroids ----
  function classifyGalaxy(galId: string, centerId: string): void {
    const isRoot = (galId === "__root__");
    const members = fileNodes.filter((n) => n.id !== centerId && (isRoot ? dirName(n.path) === "" : n.area === galId) && n.role !== "oort");
    if (!members.length) return;
    const memberSet = new Set(members.map((n) => n.id));
    const centerNode = byId.get(centerId);

    const subManifest = (n: any) => { const d = dirName(n.path); return d && d !== galId && d !== "" && stripExt(baseName(n.path)).toLowerCase() === baseName(d).toLowerCase(); };
    const degs = members.map((n) => deg(n.id)).sort((a, b) => b - a);
    const p70 = degs.length ? degs[Math.floor(degs.length * 0.3)] : 0;
    const thresh = Math.max(2, p70);
    const stars = new Set<string>();
    for (const n of members) if (subManifest(n)) stars.add(n.id);
    if (centerNode) for (const t of (adj.get(centerNode.id) || [])) if (memberSet.has(t)) stars.add(t);
    for (const n of members) if (deg(n.id) >= thresh) stars.add(n.id);
    const maxStars = Math.max(1, Math.ceil(Math.sqrt(members.length)) + members.filter(subManifest).length);
    if (stars.size > maxStars) {
      const keep = members.filter((n) => subManifest(n)).map((n) => n.id);
      const rest = [...stars].filter((id) => !keep.includes(id)).sort((a, b) => deg(b) - deg(a));
      stars.clear();
      for (const id of keep) stars.add(id);
      for (const id of rest) { if (stars.size >= maxStars) break; stars.add(id); }
    }
    if (stars.size === 0) { const top = [...members].sort((a, b) => deg(b.id) - deg(a.id))[0]; if (top) stars.add(top.id); }

    // multi-source BFS over idea adjacency restricted to this galaxy -> nearest star + chain parent
    const dist = new Map<string, number>(), parent = new Map<string, string | null>(), system = new Map<string, string>(), q: string[] = [];
    for (const id of stars) { dist.set(id, 0); parent.set(id, null); system.set(id, id); q.push(id); }
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (const v of (adj.get(u) || [])) {
        if (!memberSet.has(v) || dist.has(v)) continue;
        dist.set(v, dist.get(u)! + 1); parent.set(v, u); system.set(v, system.get(u)!); q.push(v);
      }
    }
    for (const n of members) {
      if (stars.has(n.id)) { n.role = "star"; n.body = "star"; n.galaxyId = galId; n.systemId = n.id; n.parentId = null; continue; }
      const d = dist.get(n.id);
      if (d == null) { n.role = "asteroid"; n.body = "asteroid"; n.galaxyId = galId; n.systemId = null; n.parentId = null; continue; }
      n.role = d === 1 ? "planet" : d === 2 ? "moon" : "moonlet";
      n.body = n.role; n.galaxyId = galId; n.systemId = system.get(n.id); n.parentId = parent.get(n.id);
    }
  }
  for (const A of galaxyIds) classifyGalaxy(A, galaxyCenter.get(A)!);
  // root-level notes orbit the cluster directly
  classifyGalaxy("__root__", clusterId);
  galaxyCenter.set("__root__", clusterId);

  // ---- unresolved (non-attachment) -> asteroids, bound to a linking note's galaxy ----
  for (const n of nodes) {
    if (n.kind === "unresolved" && n.role !== "oort") {
      let gal = "__root__";
      for (const v of (adj.get(n.id) || [])) { const o = byId.get(v); if (o && o.galaxyId && o.galaxyId !== "__cluster__") { gal = o.galaxyId; break; } }
      n.role = "asteroid"; n.body = "asteroid"; n.galaxyId = gal; n.systemId = null; n.parentId = null;
    }
  }

  // ---- Oort objects: host = the notes that reference them ----
  for (const n of nodes) {
    if (n.role === "oort") {
      const hosts = [...(adj.get(n.id) || [])].filter((v) => { const o = byId.get(v); return o && o.role && o.role !== "oort"; });
      n.hosts = hosts; n.hostId = hosts[0] || clusterId;
      const host = byId.get(n.hostId);
      n.galaxyId = host ? (host.galaxyId || "__root__") : "__root__";
      n.systemId = host ? (host.systemId || null) : null;
    }
  }

  // ---- radii (with a mild degree bump for the orbiting bodies) ----
  let maxDeg = 1;
  for (const n of nodes) maxDeg = Math.max(maxDeg, deg(n.id));
  for (const n of nodes) {
    const role = n.role || "hidden";
    let r = ROLE_R[role] != null ? ROLE_R[role] : ROLE_R.moonlet;
    if (role === "star" || role === "planet" || role === "moon") { const t = Math.min(1, deg(n.id) / maxDeg); r *= (0.82 + 0.55 * t); }
    n.__r = r; n.mass = r; if (!n.body) n.body = role;
  }

  // ---- Hertzsprung–Russell stellar classification (see classifyStar) -------
  // Runs BEFORE layout, so the packing/collision passes account for the
  // enlarged radii and the scene stays overlap-free.
  const sysFiles = new Map<string, number>();      // systemId -> member note count
  const sysDirs = new Map<string, Set<string>>();  // systemId -> distinct subfolders
  const sysBytes = new Map<string, number>();      // systemId -> total bytes
  for (const n of nodes) {
    if (!n.systemId || n.kind !== "file") continue;
    sysFiles.set(n.systemId, (sysFiles.get(n.systemId) || 0) + 1);
    let dirs = sysDirs.get(n.systemId); if (!dirs) { dirs = new Set(); sysDirs.set(n.systemId, dirs); }
    const d = dirName(n.path || ""); if (d) dirs.add(d);
    sysBytes.set(n.systemId, (sysBytes.get(n.systemId) || 0) + (Number(n.size) || 0));
  }
  const scoreOf = (id: string) => starScore(sysFiles.get(id) || 0, sysDirs.get(id)?.size || 0, sysBytes.get(id) || 0);
  let maxStarScore = 0;
  for (const n of nodes) if (n.role === "star") maxStarScore = Math.max(maxStarScore, scoreOf(n.id));
  for (const n of nodes) {
    if (n.role !== "star") continue;
    const s = classifyStar(scoreOf(n.id), maxStarScore);
    n.__spectral = { cls: s.cls, t: s.t };
    n.__starColor = s.color;
    n.__r *= s.mult; n.mass = n.__r;
  }

  // ---- NASA exoplanet classification for planets (see classifyPlanet) ------
  const childrenByParent = new Map<string, any[]>();
  for (const n of nodes) { if (n.parentId) { let arr = childrenByParent.get(n.parentId); if (!arr) { arr = []; childrenByParent.set(n.parentId, arr); } arr.push(n); } }
  function moonDesc(id: string): number { let c = 0; for (const k of (childrenByParent.get(id) || [])) { if (k.role === "moon" || k.role === "moonlet") { c++; c += moonDesc(k.id); } } return c; }
  // attachment hosting: notes referenced by Oort objects
  const attachHosts = new Map<string, number>();
  for (const n of nodes) {
    if (n.role !== "oort") continue;
    for (const h of (n.hosts && n.hosts.length ? n.hosts : [n.hostId])) {
      if (h) attachHosts.set(h, (attachHosts.get(h) || 0) + 1);
    }
  }
  for (const n of nodes) {
    if (n.role !== "planet") continue;
    const mc = moonDesc(n.id); n.__moons = mc;
    const c = classifyPlanet(mc, attachHosts.get(n.id) || 0, Number(n.size) || 0, hUnit(n.id + "pt"));
    n.__ptype = c.variant; n.__pcolor = c.color;
    n.__pstyle = c.style; n.__ptypeName = c.name;
    n.__rings = c.rings;                              // rings on gas giants only
    n.__r *= c.mult; n.mass = n.__r;
  }

  // ---- cosmos link set (categorised) ----
  const cosmosLinks: any[] = [];
  const visible = (id: string) => { const o = byId.get(id); return o && o.role && o.role !== "hidden"; };
  for (const A of galaxyIds) { const c = galaxyCenter.get(A)!; if (visible(c)) cosmosLinks.push({ source: clusterId, target: c, cat: "clusterGalaxy" }); }
  for (const t of (linkFrom.get(clusterId) || [])) if (visible(t)) cosmosLinks.push({ source: clusterId, target: t, cat: "clusterLink" });
  for (const n of nodes) {
    if (n.role === "star") { const c = galaxyCenter.get(n.galaxyId) || clusterId; if (c !== n.id) cosmosLinks.push({ source: c, target: n.id, cat: "galaxyStar" }); }
    else if ((n.role === "planet" || n.role === "moon" || n.role === "moonlet") && n.parentId) { cosmosLinks.push({ source: n.parentId, target: n.id, cat: "chain" }); }
    else if (n.role === "asteroid") { const c = galaxyCenter.get(n.galaxyId) || clusterId; cosmosLinks.push({ source: c, target: n.id, cat: "asteroidBind" }); }
    else if (n.role === "oort") { for (const h of (n.hosts && n.hosts.length ? n.hosts : [n.hostId])) if (visible(h)) cosmosLinks.push({ source: h, target: n.id, cat: "oort" }); }
  }

  graph.clusterId = clusterId;
  graph.galaxies = galaxyIds.map((A) => ({ id: A, center: galaxyCenter.get(A) }));
  graph.galaxyCenter = galaxyCenter;

  // OKF+ temporal layer: superseded notes render as ghosts; lineage joins the
  // link set; chrono span for time-travel. Semantics come from the core (§4);
  // this pass only maps them onto visual state.
  let tmin = Infinity, tmax = -Infinity;
  for (const n of nodes) {
    if (n.okf) n.__ghost = !!n.okf.invalidAt;
    const tv = n.validAt ? Date.parse(n.validAt) : NaN;
    if (n.kind === "file" && !Number.isNaN(tv)) { if (tv < tmin) tmin = tv; if (tv > tmax) tmax = tv; }
    if (n.okf && n.okf.invalidAt) { const iv = Date.parse(n.okf.invalidAt); if (!Number.isNaN(iv) && iv > tmax) tmax = iv; }
  }
  graph.__timeSpan = (tmin < tmax) ? { min: tmin, max: tmax } : null;
  for (const l of graph.links) {
    if (l.kind === "lineage") {
      const a = byId.get(l.source), b2 = byId.get(l.target);
      if (a && b2 && a.role !== "hidden" && b2.role !== "hidden") cosmosLinks.push({ source: l.source, target: l.target, cat: "lineage" });
    }
  }
  graph.cosmosLinks = cosmosLinks;
  return graph;
}
