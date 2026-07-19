/**
 * Kosmos renderer — render + UI layer.
 *
 * Faithful port of the v0.5.0 visual experience (§36): instanced bodies,
 * in-place buffer updates, pooled labels, explicit disposal — no per-node
 * meshes, no per-frame allocation in the hot path. Vanilla Three.js (window
 * global, bundled locally — no CDN).
 *
 * What changed relative to v0.5.0:
 *  - Graph semantics come exclusively from Kosmos Core (§2.2); the renderer
 *    never parses Markdown or derives lineage/temporal state itself.
 *  - The render loop is EXPLICITLY suspended while the document is hidden and
 *    resumes on visibility (§27); `getRenderStats()` exposes proof.
 *  - The Chrono scrubber uses core temporal semantics (valid_at/invalid_at
 *    projected by the same rules as the Agent API's graph_at_time, §4.1).
 *  - Layout records residual collision diagnostics (§12).
 *
 * The host (plugin iframe bridge or standalone page) owns the KosmosIndex and
 * hands assembled graphs to `renderGraph()`, which applies tiered updates:
 * topology/visual change -> warm relayout; metadata-only -> in-place refresh;
 * identical -> no-op (§11).
 */
import * as THREE from "three";
import { createDemoVaultEvents, createDemoVaultGraph } from "../core/demo";
import { KOSMOS_VERSION } from "../core/version";
import { layoutGraph, positionCosmos } from "./layout";
import { bodyMaterial, bodyMaterialLite, glowMaterial } from "./shaders";
import { detectLang, I18N } from "./i18n";

/** Renderer descriptor exposed for browser tests / diagnostics (§7.4). */
export const RENDERER_BACKEND = "webgl2";
export const RENDERER_THREE_REVISION = THREE.REVISION;

/** WebGL2 capability probe — modern Three.js WebGLRenderer is WebGL2-only. */
function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export interface KosmosAppOptions {
  /** Called when the user picks "Go to Note" (embed posts to the plugin). */
  onOpenNote?: (path: string, label?: string) => void;
  /** Called when the user picks "Expand Folder" on a folder-only galaxy/cluster
   *  (no manifest note). Must never fall back to opening or creating a note. */
  onOpenFolder?: (path: string) => void;
  /** 'wait' = host will push data; 'demo' = boot straight into the demo. */
  autoStart?: "wait" | "demo";
}

export interface KosmosApp {
  ok: boolean;
  renderGraph(graph: any, label?: string): void;
  showDemo(): void;
  setConn(label: string, live: boolean): void;
  /** Live vault-connectivity signal: green dot + "connected" tooltip when the
   *  host can read the vault, red + "unreachable" when it cannot. */
  setVaultStatus(connected: boolean): void;
  setAttachments(paths: string[]): void;
  notifyLiveEvent(ev: { path: string; type?: string }): void;
  /** Highlight the notes touched by one Agent API query with a fading trail.
   *  `agent` (optional) colours the trail per-agent and labels its rocket head. */
  notifyAgentTraversal(paths: string[], tool: string, agent?: string): void;
  /** Host-side leaf visibility: false fully stops the render loop, true resumes it. */
  setHostVisible(visible: boolean): void;
  getDiagnostics(): any;
  getRenderStats(): { frames: number; running: boolean };
  showError(msg: string): void;
  showHint(msg: string): void;
  applyI18n(): void;
  dispose(): void;
}

export function createKosmosApp(opts: KosmosAppOptions = {}): KosmosApp {
  const boot = document.getElementById("boot"), bootMsg = document.getElementById("bootMsg"), bootRing = document.getElementById("bootRing");
  const noopApp: KosmosApp = {
    ok: false,
    renderGraph() {}, showDemo() {}, setConn() {}, setVaultStatus() {}, setAttachments() {}, notifyLiveEvent() {}, notifyAgentTraversal() {}, setHostVisible() {},
    getDiagnostics() { return null; }, getRenderStats() { return { frames: 0, running: false }; },
    showError() {}, showHint() {}, applyI18n() {}, dispose() {},
  };
  const fail = (msg: string) => {
    if (bootRing) (bootRing as HTMLElement).style.display = "none";
    if (bootMsg) { bootMsg.className = "err"; (bootMsg as HTMLElement).style.color = "#fb7185"; bootMsg.textContent = msg; }
    return noopApp;
  };
  // Modern Three.js WebGLRenderer requires WebGL2 (WebGL1 was removed). Fail with a
  // clear, actionable message rather than a blank canvas (§8). No silent downgrade.
  if (!hasWebGL2()) {
    return fail("This Kosmos build requires WebGL2. Update your browser/OS, enable hardware acceleration, or use the legacy compatibility build.");
  }

  const MOBILE = matchMedia("(max-width:760px), (pointer:coarse)").matches;
  const _q0 = new URLSearchParams(location.search);
  // Deterministic capture mode for visual-regression screenshots (§5, build-instructions §3.3):
  //   ?capture=1&seed=<int>&time=<sec>&dpr=<n>&quality=high|lite&camera=<preset>&animation=off
  // Freezes shader time, camera, DPR and quality tier so a browser can take a
  // stable, comparable screenshot. quality/dpr feed the LOWPOWER/dpr choices below.
  const CAPTURE = {
    on: _q0.has("capture"),
    time: Number(_q0.get("time") || 0) || 0,
    dpr: _q0.has("dpr") ? Number(_q0.get("dpr")) || 1 : null,
    quality: _q0.get("quality") || null,           // "high" | "lite"
    camera: _q0.get("camera") || "overview",
    frozen: _q0.get("animation") === "off" || _q0.has("capture"),
    seed: Number(_q0.get("seed") || 0) || 0,
  };
  const LOWPOWER = CAPTURE.quality === "lite" ? true : CAPTURE.quality === "high" ? false
    : ((_q0.has("hp") || _q0.has("highpower")) ? false : ((_q0.has("lp") || _q0.has("lowpower")) ? true : (MOBILE || ((navigator as any).hardwareConcurrency && (navigator as any).hardwareConcurrency <= 4) || ((navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4))));

  /* ---- renderer / scene / camera ---- */
  const stage = document.getElementById("stage");
  let renderer: any;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, alpha: false, powerPreference: "high-performance", stencil: false });
  } catch (error) {
    return fail(`Kosmos could not initialize WebGL2. ${String(error)}`);
  }
  renderer.setClearColor(0x03060f, 1);
  renderer.toneMapping = THREE.NoToneMapping; // we tonemap inside the body shaders
  // Color-management policy (Strategy A — the shader owns output; §9): disable
  // Three's modern color management and output transfer so the pipeline matches
  // the r128 baseline exactly. Colors are set raw + explicitly converted to
  // linear (lin() below); lighting is linear; the fragment shaders apply the
  // ACES-like curve and manual sRGB encoding and write gl_FragColor. With
  // outputColorSpace = LinearSRGBColorSpace, Three applies NO second output
  // transform, so there is no double conversion.
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const MAXDPR = MOBILE ? 1.6 : 2;
  let dpr = CAPTURE.dpr != null ? CAPTURE.dpr : Math.min(window.devicePixelRatio || 1, MAXDPR);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03060f, 0.0016);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 5000);
  stage.appendChild(renderer.domElement);
  const dom = renderer.domElement;

  const brandSub = document.querySelector(".brand .sub");
  if (brandSub) brandSub.textContent = `Local Cluster · v${KOSMOS_VERSION}`;

  const COLOR = new THREE.Color();
  const lin = (hex: any) => { COLOR.set(hex || "#ffffff").convertSRGBToLinear(); return [COLOR.r, COLOR.g, COLOR.b]; };
  function hashUnitLocal(v: string): number { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

  /* scratch (reused every frame — zero per-frame allocation in the hot path) */
  const SCALE = new THREE.Vector3(), QID = new THREE.Quaternion(), MAT = new THREE.Matrix4(), VEC = new THREE.Vector3(), VEC2 = new THREE.Vector3();

  /* ---- instanced layers ---- */
  function makeLayer(geometry: any, material: any, count: number) {
    count = Math.max(1, count);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const f = (n?: number) => new Float32Array(count * (n || 1));
    const attrs: any = {
      aColor: new THREE.InstancedBufferAttribute(f(3), 3),
      aSeed: new THREE.InstancedBufferAttribute(f(), 1),
      aVisible: new THREE.InstancedBufferAttribute(f(), 1),
      aHi: new THREE.InstancedBufferAttribute(f(), 1),
      aLive: new THREE.InstancedBufferAttribute(f(), 1),
      aEmerge: new THREE.InstancedBufferAttribute(f(), 1),
      aBand: new THREE.InstancedBufferAttribute(f(), 1),
    };
    for (const k in attrs) { attrs[k].setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(k, attrs[k]); }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return { mesh, attrs, recByIdx: new Array(count) };
  }
  function makeGlow(count: number) {
    count = Math.max(1, count);
    const geo = new THREE.PlaneGeometry(1, 1), mat = glowMaterial(THREE);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const f = (n?: number) => new Float32Array(count * (n || 1));
    const attrs: any = {
      aColor: new THREE.InstancedBufferAttribute(f(3), 3), aSize: new THREE.InstancedBufferAttribute(f(), 1),
      aVisible: new THREE.InstancedBufferAttribute(f(), 1), aLive: new THREE.InstancedBufferAttribute(f(), 1), aSeed: new THREE.InstancedBufferAttribute(f(), 1),
    };
    for (const k in attrs) { attrs[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, attrs[k]); }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.renderOrder = 2;
    return { mesh, attrs, geo, mat };
  }

  /* ---- world state + disposal registry ---- */
  const world = new THREE.Group(); scene.add(world);
  let disposables: any[] = [];
  const keep = (o: any) => { disposables.push(o); return o; };
  let layers: any = null, glow: any = null, rings: any = null, ambientLines: any = null, focusLines: any = null, ambientSegs: any[] = [];
  let lumNodes: any[] = [];
  let backdropGroup: any = null, nebula: any = null;
  let G: any = null, nodeRender: any[] = []; const idToRender = new Map<string, any>();
  let haloBase = 0; const HALO_CAP = MOBILE ? 24 : 48;
  const matsWithTime: any[] = [];

  let __attach: string[] = [];
  let chainLines: any = null, thinLines: any = null;
  /* Live AI-agent traversal overlay (Agent API): breadcrumb of the last hops,
     drawn as fading emerald line segments (v0.5.1 behavior, ported). */
  let agentTrail: any = null;
  let agentDust: any = null;
  let agentSteps: Array<{ id: string; t: number; agent: string }> = [];
  let __agentLive = new Set<string>();
  let __agentHintT = 0;
  const AGENT_MAX = 24;
  const AGENT_TRAIL_MS = 30000;
  const AGENT_DUST_CAP = MOBILE ? 192 : 640;
  const AGENT_DUST_HEAD_MS = 90;
  let __agentDustHeadT = 0;
  const DEFAULT_AGENT = "agent";
  const MAX_AGENTS_SHOWN = 6;      // distinct agents with a live rocket marker
  // Per-agent colour, derived from a stable hash of the agent's name so the
  // same agent keeps its hue across queries and multiple agents stay distinct.
  const __agentColors = new Map<string, { rgb: [number, number, number]; css: string }>();
  function agentColor(name: string): { rgb: [number, number, number]; css: string } {
    const key = name || DEFAULT_AGENT;
    const hit = __agentColors.get(key); if (hit) return hit;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const hue = h % 360, sat = 0.82, lig = 0.60;
    // HSL -> RGB (0..1) for the additive line buffer; CSS string for the DOM rocket.
    const c = (1 - Math.abs(2 * lig - 1)) * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = lig - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; } else if (hue < 120) { r = x; g = c; } else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; } else if (hue < 300) { r = x; b = c; } else { r = c; b = x; }
    const rgb: [number, number, number] = [r + m, g + m, b + m];
    const val = { rgb, css: `hsl(${hue} 82% 62%)` };
    __agentColors.set(key, val);
    return val;
  }
  // Rocket + name markers (DOM overlay, one per active agent), gated by labels.
  let agentMarkers: Array<{ el: HTMLElement; rocket: HTMLElement; name: HTMLElement; agent: string | null }> = [];
  let lastFocusIds: Set<string> | null = null;
  let showAllConnections = false, showAllObjects = false;

  function ensureNodeIndex(g: any) {
    if (g && (!g.nodeById || typeof g.nodeById.get !== "function")) { const m = new Map(); for (const n of (g.nodes || [])) m.set(n.id, n); g.nodeById = m; }
    return g;
  }
  function positionFrom(graph: any) {
    ensureNodeIndex(graph);
    try {
      const g = positionCosmos(graph, { attachments: __attach });
      ensureNodeIndex(g);
      g.__cosmos = true;
      return g;
    } catch (e) {
      console.error("Vault Kosmos: cosmology layout failed, using fallback", e);
    }
    return ensureNodeIndex(layoutGraph(graph));
  }
  function showFatal(msg?: string) {
    try {
      if (boot) { boot.classList.remove("gone"); }
      if (bootRing) (bootRing as HTMLElement).style.display = "none";
      if (bootMsg) { bootMsg.className = "err"; (bootMsg as HTMLElement).style.color = "#fb7185"; bootMsg.textContent = msg || "Could not render this vault — see the console for details."; }
    } catch (e) { /* boot overlay may be gone */ }
  }

  function disposeAll() {
    for (const o of disposables) { try { o.dispose && o.dispose(); } catch (e) { /* already disposed */ } }
    disposables = [];
  }
  function clearGroup(g: any) { for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]); }

  function buildScene(positioned: any) {
    disposeAll(); clearGroup(world); matsWithTime.length = 0;
    layers = glow = rings = ambientLines = focusLines = backdropGroup = nebula = null;
    agentTrail = agentDust = null; // geometry/material were registered in disposables; steps survive the rebuild
    nodeRender = []; idToRender.clear();

    G = positioned;
    const byBody: any = { cluster: [], galaxy: [], star: [], planet: [], moon: [], moonlet: [], asteroid: [], oort: [] };
    for (const n of G.nodes) {
      if (n.body === "hidden" || n.role === "hidden") { n.__hidden = true; n.__lodVisible = false; continue; }
      (byBody[n.body] || byBody.moonlet).push(n);
      n.__lodVisible = true;
    }

    const seg = (hi: number, lo: number) => Math.max(6, Math.round(LOWPOWER ? lo : hi));
    const geoCluster = keep(new THREE.SphereGeometry(1, seg(40, 26), seg(28, 16)));
    const geoGalaxy = keep(new THREE.SphereGeometry(1, seg(34, 22), seg(24, 14)));
    const geoStar = keep(new THREE.SphereGeometry(1, seg(30, 20), seg(22, 14)));
    const geoPlanet = keep(new THREE.SphereGeometry(1, seg(24, 14), seg(18, 11)));
    const geoMoon = keep(new THREE.SphereGeometry(1, seg(14, 10), seg(11, 8)));
    const geoMoonlet = keep(new THREE.SphereGeometry(1, seg(9, 7), seg(8, 6)));
    const geoAster = keep(new THREE.IcosahedronGeometry(1, 0));
    const geoOort = keep(new THREE.IcosahedronGeometry(1, 0));

    const mk = LOWPOWER ? (o: any) => bodyMaterialLite(THREE, o) : (o: any) => bodyMaterial(THREE, o);
    const matCluster = keep(mk({ STAR: 1 }));
    const matGalaxy = keep(mk({ STAR: 1 }));
    const matStar = keep(mk({ STAR: 1 }));
    const matPlanet = keep(mk({ ATMO: 1, SPIN: 1, PLANET: 1, SURF: 1, SPIN_SPEED: 0.1, AMBIENT: 0.13, DIFF: 1.05 }));
    const matMoon = keep(mk({ SPIN: 1, SURF: 1, SPIN_SPEED: 0.06, AMBIENT: 0.11, DIFF: 0.95 }));
    const matMoonlet = keep(mk({ SURF: 1, AMBIENT: 0.11, DIFF: 0.9 }));
    const matAster = keep(mk({ TUMBLE: 1, ROCK: 1, AMBIENT: 0.1, DIFF: 0.7 }));
    const matOort = keep(mk({ AMBIENT: 0.2, DIFF: 0.55 }));
    matsWithTime.push(matCluster, matGalaxy, matStar, matPlanet, matMoon, matMoonlet, matAster, matOort);

    layers = {
      cluster: makeLayer(geoCluster, matCluster, byBody.cluster.length),
      galaxy: makeLayer(geoGalaxy, matGalaxy, byBody.galaxy.length),
      star: makeLayer(geoStar, matStar, byBody.star.length),
      planet: makeLayer(geoPlanet, matPlanet, byBody.planet.length),
      moon: makeLayer(geoMoon, matMoon, byBody.moon.length),
      moonlet: makeLayer(geoMoonlet, matMoonlet, byBody.moonlet.length),
      asteroid: makeLayer(geoAster, matAster, byBody.asteroid.length),
      oort: makeLayer(geoOort, matOort, byBody.oort.length),
    };

    if (G.__cosmos) {
      for (const n of G.nodes) { if (n.__r == null) n.__r = (n.mass || 0.4); }
    } else {
      const RSCALE: any = { star: 3.4, planet: 1.7, moon: 0.95, moonlet: 0.62, asteroid: 0.5 };
      for (const n of G.nodes) n.__r = (n.mass || 0.4) * RSCALE[n.body || "moonlet"];
      separateBodies();
    }

    for (const b in layers) {
      const L = layers[b], list = byBody[b];
      list.forEach((node: any, i: number) => {
        const r = node.__r;
        MAT.compose(VEC.fromArray(node.position), QID, SCALE.set(r, r, r));
        L.mesh.setMatrixAt(i, MAT);
        const c = lin(
          node.kind === "unresolved" && node.body !== "oort" ? "#8a93a8"
          : b === "planet" && node.__pcolor ? node.__pcolor
          : b === "star" && node.__starColor ? node.__starColor   // H-R spectral color
          : node.color
        );
        if (node.__ghost) { const g = lin("#6b7280"); for (let k = 0; k < 3; k++) c[k] = c[k] * 0.55 + g[k] * 0.45; } // superseded (OKF+) => ghosted
        node.__baseC = c;
        node.__vt = node.validAt ? Date.parse(node.validAt) : null;
        node.__it = (node.okf && node.okf.invalidAt) ? Date.parse(node.okf.invalidAt) : null;
        L.attrs.aColor.setXYZ(i, c[0], c[1], c[2]);
        L.attrs.aSeed.setX(i, hashUnitLocal(node.id));
        L.attrs.aVisible.setX(i, 1);
        // aBand carries the NASA planet-type style code (0 terrestrial, 1 gas, 2 neptunian, 3 super-earth)
        L.attrs.aBand.setX(i, (b === "planet" && node.__pstyle != null) ? node.__pstyle : 0);
        const rec = { node, layer: L, idx: i, body: b };
        L.recByIdx[i] = rec;
        nodeRender.push(rec); idToRender.set(node.id, rec);
      });
      L.mesh.instanceMatrix.needsUpdate = true;
      for (const k in L.attrs) L.attrs[k].needsUpdate = true;
      if (list.length > 0) world.add(L.mesh);
    }

    // coronae for the luminous cores + reserved dynamic halos at the tail
    const lumin = byBody.cluster.concat(byBody.galaxy, byBody.star);
    glow = makeGlow(lumin.length + HALO_CAP); matsWithTime.push(glow.mat); keep(glow.geo); keep(glow.mat);
    lumin.forEach((node: any, i: number) => {
      MAT.makeTranslation(node.position[0], node.position[1], node.position[2]); glow.mesh.setMatrixAt(i, MAT);
      const c = lin(node.body === "star" && node.__starColor ? node.__starColor : node.color); // star coronae match the spectral class
      glow.attrs.aColor.setXYZ(i, c[0], c[1], c[2]);
      const mult = node.body === "cluster" ? 5.6 : node.body === "galaxy" ? 5.0 : (node.depth === 0 ? 5.4 : 4.3);
      glow.attrs.aSize.setX(i, (node.__r || 3) * mult);
      glow.attrs.aVisible.setX(i, 1); glow.attrs.aSeed.setX(i, hashUnitLocal(node.id));
      node.__glow = i;
    });
    haloBase = lumin.length;
    for (let i = 0; i < HALO_CAP; i++) glow.attrs.aVisible.setX(haloBase + i, 0);
    glow.mesh.instanceMatrix.needsUpdate = true; for (const k in glow.attrs) glow.attrs[k].needsUpdate = true;
    world.add(glow.mesh);

    buildRings(byBody.planet);
    lumNodes = lumin;
    if (G.__cosmos) { for (const r of nodeRender) { const op = r.node.__op; const pr = (op != null) ? idToRender.get(op) : null; r.node.__opNode = pr ? pr.node : null; } }
    if (G.__cosmos) buildCosmosLinks(); else buildLinks();
    buildBackdrop();
    buildAreaLabels();
    updateStats();
    buildFilterUI();
    applyFilters();
    if (G.__cosmos) { applyConnVisibility(); if (showAllObjects) setAllObjectsGlow(true); }
    fitCamera();
  }

  function buildRings(planets: any[]) {
    const big = planets.filter((p) => p.__rings).slice(0, MOBILE ? 14 : 34);
    if (!big.length) { rings = null; return; }
    const geo = keep(new THREE.RingGeometry(1.45, 2.35, 56));
    const mat = keep(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aColor; varying vec3 vColor; varying float vR;
      void main(){ vColor=aColor; vR=(length(position.xy)-1.45)/0.9; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vColor; varying float vR;
      void main(){ float a=smoothstep(0.0,0.18,vR)*smoothstep(1.0,0.5,vR);
        float gap=smoothstep(0.42,0.46,vR)*smoothstep(0.56,0.52,vR);  // Cassini-like gap
        a*=(1.0-0.7*gap); a*=0.86+0.14*sin(vR*34.0+vColor.g*7.0);    // fine ring grooves
        gl_FragColor=vec4(vColor*0.7,a*0.42);}`,
    }));
    const mesh = new THREE.InstancedMesh(geo, mat, big.length);
    const aColor = new THREE.InstancedBufferAttribute(new Float32Array(big.length * 3), 3); geo.setAttribute("aColor", aColor);
    const e = new THREE.Euler(), items: any[] = [];
    big.forEach((p: any, i: number) => {
      const q = new THREE.Quaternion();
      e.set(Math.PI / 2 + (hashUnitLocal(p.id + "rx") - 0.5) * 1.0, (hashUnitLocal(p.id + "ry") - 0.5) * 1.0, 0); q.setFromEuler(e);
      const r = (p.__r || 1.8) * 1.15; MAT.compose(VEC.fromArray(p.position), q, SCALE.set(r, r, r)); mesh.setMatrixAt(i, MAT);
      const c = lin(p.__pcolor || "#dcc79c"); aColor.setXYZ(i, c[0], c[1], c[2]);
      items.push({ node: p, q, r, i });
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; world.add(mesh); rings = { mesh, items };
  }

  /* ---- links ---- */
  const LINK_COLORS: any = { property: "#f4d35e", markdown: "#7dd3fc", wikilink: "#9fb4d4", semantic: "#34d399", lineage: "#c084fc", backlink: "#94a3b8", contains: "#3b4a63" };
  function ambientThreshold(link: any) { return link.kind === "property" ? 0.16 : link.kind === "markdown" ? 0.1 : link.kind === "wikilink" ? 0.07 : 0.0; }
  function buildLinks() {
    const c = new THREE.Color(); ambientSegs = [];
    for (const l of G.links) {
      if (l.kind === "contains") continue;
      if (hashUnitLocal(l.id) >= ambientThreshold(l)) continue;
      const s = G.nodeById.get(l.source), t = G.nodeById.get(l.target); if (!s || !t) continue;
      c.set(LINK_COLORS[l.kind] || "#94a3b8"); ambientSegs.push({ s, t, r: c.r, g: c.g, b: c.b });
    }
    const acap = ambientSegs.length || 1, apos = new Float32Array(acap * 6), acol = new Float32Array(acap * 6);
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(apos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(acol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    const mesh = new THREE.LineSegments(geo, mat); mesh.frustumCulled = false; world.add(mesh); ambientLines = { geo, apos, acol, cap: acap };
    applyAmbientVisibility();

    const cap = 4096, fpos = new Float32Array(cap * 6), fcol = new Float32Array(cap * 6);
    const fgeo = keep(new THREE.BufferGeometry());
    fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setAttribute("color", new THREE.BufferAttribute(fcol, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setDrawRange(0, 0);
    const fmat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    const fmesh = new THREE.LineSegments(fgeo, fmat); fmesh.frustumCulled = false; fmesh.renderOrder = 1; world.add(fmesh);
    focusLines = { geo: fgeo, fpos, fcol, cap };
  }

  /* ---- cosmos links: bright solar-system chains + thin membership lines ---- */
  function makeLineSeg(pairs: any[], baseOpacity: number, additive: boolean) {
    const c = new THREE.Color(); const cap = Math.max(1, pairs.length);
    const pos = new Float32Array(cap * 6), col = new Float32Array(cap * 6);
    pairs.forEach((p: any, i: number) => {
      const o = i * 6, s = p.s.position, t = p.t.position;
      pos[o] = s[0]; pos[o + 1] = s[1]; pos[o + 2] = s[2]; pos[o + 3] = t[0]; pos[o + 4] = t[1]; pos[o + 5] = t[2];
      c.set(p.col); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; col[o + 3] = c.r; col[o + 4] = c.g; col[o + 5] = c.b;
    });
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, pairs.length * 2);
    const mat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: baseOpacity, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    const mesh = new THREE.LineSegments(geo, mat); mesh.frustumCulled = false; world.add(mesh);
    return { geo, mesh, mat, pairs, pos };
  }
  function buildCosmosLinks() {
    const byId = new Map(); for (const n of G.nodes) byId.set(n.id, n);
    const CC: any = { chain: "#9fb4d4", clusterGalaxy: "#f4d35e", clusterLink: "#f4d35e", galaxyStar: "#7dd3fc", oort: "#9aa7bd", asteroidBind: "#5b6b86", lineage: "#c084fc" };
    const chain: any[] = [], thin: any[] = [];
    for (const l of (G.cosmosLinks || [])) {
      const s = byId.get(l.source), t = byId.get(l.target);
      if (!s || !t || !s.position || !t.position) continue;
      if (s.role === "hidden" || t.role === "hidden") continue;
      const rec = { s, t, col: CC[l.cat] || "#94a3b8" };
      (l.cat === "chain" ? chain : thin).push(rec);
    }
    chainLines = makeLineSeg(chain, 0.42, true);
    thinLines = makeLineSeg(thin, showAllConnections ? 0.5 : 0.05, false);

    const cap = 4096, fpos = new Float32Array(cap * 6), fcol = new Float32Array(cap * 6);
    const fgeo = keep(new THREE.BufferGeometry());
    fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setAttribute("color", new THREE.BufferAttribute(fcol, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setDrawRange(0, 0);
    const fmat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    const fmesh = new THREE.LineSegments(fgeo, fmat); fmesh.frustumCulled = false; fmesh.renderOrder = 2; world.add(fmesh);
    focusLines = { geo: fgeo, fpos, fcol, cap };
    ambientLines = null; ambientSegs = [];
  }

  /* ---- live orbital motion ---- */
  function animateOrbits(t: number) {
    if (!G || !G.__cosmos || !nodeRender.length) return;
    const ORDER = ["galaxy", "star", "planet", "moon", "moonlet", "asteroid", "oort"];
    for (let ri = 0; ri < ORDER.length; ri++) {
      const role = ORDER[ri];
      for (const rec of nodeRender) {
        const n = rec.node; if (n.body !== role || n.__hidden) continue;
        const pn = n.__opNode; if (!pn || !n.__ov) continue; const p = pn.position;
        const ox = n.__ov[0], oy = n.__ov[1], oz = n.__ov[2];
        const e = n.__ecc || 0;
        if (e > 0) {
          // Elliptical orbit: apoapsis is pinned to the original |ov_horiz|,
          // so the max distance from the parent never exceeds the packed radius
          // (collision-safe). Periapsis is a(1-e) inward. At t=0 the object is
          // at apoapsis (matches its layout-time position exactly).
          const aH = Math.hypot(ox, oz);
          if (aH > 0) {
            const semi = aH / (1 + e);                // semi-major axis
            let theta = Math.PI + (n.__os || 0) * t;  // start at apoapsis
            // Sibling perturbation (theta jitter): the heaviest sibling tugs
            // this body slightly along its orbit — no perpendicular offset,
            // so max radius stays exactly aH. Zero at t=0 by construction.
            const wa = n.__wob_amp;
            if (wa) {
              const wph = n.__wob_phase || 0;
              theta += wa * (Math.sin((n.__wob_freq || 0) * t + wph) - Math.sin(wph));
            }
            const rOrbit = semi * (1 - e * e) / (1 + e * Math.cos(theta));
            const dth = theta - Math.PI, cd = Math.cos(dth), sd = Math.sin(dth);
            const ux = ox / aH, uz = oz / aH;         // apoapsis unit direction
            const rx = ux * cd - uz * sd;             // rotate around Y by dθ
            const rz = ux * sd + uz * cd;
            n.position[0] = p[0] + rx * rOrbit;
            n.position[1] = p[1] + oy;
            n.position[2] = p[2] + rz * rOrbit;
            continue;
          }
        }
        // fallback: perfect circle (unchanged from prior behaviour)
        const a = (n.__os || 0) * t, c = Math.cos(a), s = Math.sin(a);
        n.position[0] = p[0] + ox * c + oz * s; n.position[1] = p[1] + oy; n.position[2] = p[2] - ox * s + oz * c;
      }
    }
  }
  function updateInstancePositions() {
    if (!layers) return;
    for (const rec of nodeRender) {
      const n = rec.node; if (n.__hidden) continue; const r = n.__r || 0.4;
      MAT.compose(VEC.fromArray(n.position), QID, SCALE.set(r, r, r)); rec.layer.mesh.setMatrixAt(rec.idx, MAT); rec.layer.__dirty = 1;
    }
    for (const bb in layers) { const L = layers[bb]; if (L.__dirty) { L.__dirty = 0; L.mesh.instanceMatrix.needsUpdate = true; } }   // skip GPU uploads for untouched layers
    if (glow && lumNodes.length) {
      for (const n of lumNodes) {
        if (n.__glow == null) continue;
        MAT.makeTranslation(n.position[0], n.position[1], n.position[2]); glow.mesh.setMatrixAt(n.__glow, MAT);
      }
      glow.mesh.instanceMatrix.needsUpdate = true;
    }
    if (rings && rings.items) {
      for (const it of rings.items) {
        const p = it.node.position;
        MAT.compose(VEC.set(p[0], p[1], p[2]), it.q, SCALE.set(it.r, it.r, it.r)); rings.mesh.setMatrixAt(it.i, MAT);
      }
      rings.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  function updateCosmosLinks() {
    for (const L of [chainLines, thinLines]) {
      if (!L || !L.pairs || !L.pos) continue;
      const pos = L.pos, pr = L.pairs;
      for (let i = 0; i < pr.length; i++) {
        const o = i * 6, s = pr[i].s.position, t = pr[i].t.position;
        pos[o] = s[0]; pos[o + 1] = s[1]; pos[o + 2] = s[2]; pos[o + 3] = t[0]; pos[o + 4] = t[1]; pos[o + 5] = t[2];
      }
      L.geo.attributes.position.needsUpdate = true;
    }
    if (lastFocusIds) updateFocusLinks(lastFocusIds);
  }
  function updateFocusLinks(focusIds: Set<string> | null) {
    if (!focusLines) return;
    lastFocusIds = focusIds && focusIds.size ? focusIds : null;
    const { fpos, fcol, cap, geo } = focusLines; const c = new THREE.Color(); let v = 0;
    if (focusIds && focusIds.size) {
      for (const l of G.links) {
        if (l.kind === "contains") continue;
        if (!focusIds.has(l.source) && !focusIds.has(l.target)) continue;
        const s = G.nodeById.get(l.source), t = G.nodeById.get(l.target); if (!s || !t || s.__hidden || t.__hidden) continue;
        if (v >= cap) break; const o = v * 6;
        fpos[o] = s.position[0]; fpos[o + 1] = s.position[1]; fpos[o + 2] = s.position[2];
        fpos[o + 3] = t.position[0]; fpos[o + 4] = t.position[1]; fpos[o + 5] = t.position[2];
        c.set(LINK_COLORS[l.kind] || "#7dd3fc");
        fcol[o] = c.r; fcol[o + 1] = c.g; fcol[o + 2] = c.b; fcol[o + 3] = c.r; fcol[o + 4] = c.g; fcol[o + 5] = c.b; v++;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, v * 2);
  }

  /* ---- backdrop ---- */
  function makeStars(radius: number, count: number, hex: string, opacity: number, size: number, seed: string, fog: boolean) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = hashUnitLocal(`${seed}a${i}`) * Math.PI * 2, v = hashUnitLocal(`${seed}v${i}`) * 2 - 1;
      const r = radius * Math.cbrt(0.3 + hashUnitLocal(`${seed}r${i}`) * 0.7), y = Math.asin(Math.max(-1, Math.min(1, v * 0.8)));
      positions[i * 3] = Math.cos(a) * Math.cos(y) * r; positions[i * 3 + 1] = Math.sin(y) * r * 0.6; positions[i * 3 + 2] = Math.sin(a) * Math.cos(y) * r;
    }
    const geo = keep(new THREE.BufferGeometry()); geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = keep(new THREE.PointsMaterial({ color: new THREE.Color(hex), size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, toneMapped: false, fog: fog !== false }));
    return new THREE.Points(geo, mat);
  }
  function buildBackdrop() {
    const far = MOBILE ? 460 : 820, near = MOBILE ? 220 : 380;
    backdropGroup = new THREE.Group();
    backdropGroup.add(makeStars(far, LOWPOWER ? 360 : 640, "#cfeeff", 0.34, 1.25, "far", false));
    backdropGroup.add(makeStars(near, LOWPOWER ? 150 : 280, "#f4d35e", 0.16, 0.9, "near", true));
    world.add(backdropGroup);
    const ng = keep(new THREE.PlaneGeometry(1, 1));
    const nm = keep(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aColor; attribute float aSize; varying vec3 vColor; varying vec2 vUv;
      void main(){ vColor=aColor; vUv=uv-0.5; vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.); c.xy+=position.xy*aSize; gl_Position=projectionMatrix*c;}`,
      fragmentShader: `varying vec3 vColor; varying vec2 vUv; void main(){ float d=length(vUv)*2.0; float a=smoothstep(1.0,0.0,d); gl_FragColor=vec4(vColor*a*0.5,a*0.5);}`,
    }));
    const neb = ["#1b3a6b", "#3a2356", "#123b33"];
    const nMesh = new THREE.InstancedMesh(ng, nm, neb.length);
    const aColor = new THREE.InstancedBufferAttribute(new Float32Array(neb.length * 3), 3), aSize = new THREE.InstancedBufferAttribute(new Float32Array(neb.length), 1);
    ng.setAttribute("aColor", aColor); ng.setAttribute("aSize", aSize);
    neb.forEach((hex, i) => {
      const ang = i / neb.length * Math.PI * 2; MAT.makeTranslation(Math.cos(ang) * 130, (i - 1) * 44, -180 - i * 44); nMesh.setMatrixAt(i, MAT);
      const c = lin(hex); aColor.setXYZ(i, c[0], c[1], c[2]); aSize.setX(i, 300 + i * 50);
    });
    nMesh.instanceMatrix.needsUpdate = true; nMesh.frustumCulled = false; nMesh.renderOrder = -1; world.add(nMesh); nebula = { mesh: nMesh };
  }

  /* ---- labels (fixed pool of overlay divs) ---- */
  const labelHost = document.getElementById("labels");
  const LABEL_CAP = MOBILE ? 8 : 16;
  const labelPool: any[] = [];
  for (let i = 0; i < LABEL_CAP; i++) {
    const el = document.createElement("div"); el.className = "lbl"; el.style.opacity = "0";
    labelHost.appendChild(el); labelPool.push({ el, id: null, shown: false });
  }
  let areaLabels: any[] = [];
  function buildAreaLabels() {
    for (const a of areaLabels) a.el.remove(); areaLabels = [];
    for (const n of G.nodes) {
      if (n.kind !== "folder" || n.id === "folder:.") continue;
      const count = G.nodes.filter((x: any) => x.area === n.area && x.kind === "file").length;
      const el = document.createElement("div"); el.className = "lbl area";
      el.style.color = n.color; el.style.borderColor = n.color + "55";
      el.innerHTML = `${escapeHtml(n.label)}<span class="count">${count}</span>`;
      labelHost.appendChild(el); areaLabels.push({ el, node: n, shown: false });
    }
  }
  function escapeHtml(s: any) { return String(s).replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c])); }

  const _p = new THREE.Vector3();
  function projectToScreen(pos: number[]) {
    _p.set(pos[0], pos[1], pos[2]).project(camera);
    if (_p.z > 1) return null;
    return { x: (_p.x * 0.5 + 0.5) * window.innerWidth, y: (-_p.y * 0.5 + 0.5) * window.innerHeight, depth: _p.z };
  }
  let labelScanT = 0;
  let placedLabels: any[] = [];
  let _lastSel: any = null, _lastHov: any = null;
  function rescanLabels() {
    const isCosmos = !!(G && G.__cosmos);
    const closeP = (navMode === "fly" ? 72 : 48), starFar = isCosmos ? 260 : 1e9;
    const cands: any[] = [];
    for (const a of areaLabels) {
      if (a.node.__hidden) continue;
      const sp = projectToScreen(a.node.position); if (!sp) continue;
      cands.push({ el: a.el, ref: a, node: a.node, isArea: true, prio: 1, dist: camera.position.distanceTo(VEC.fromArray(a.node.position)), sx: sp.x, sy: sp.y, focus: false, key: "a:" + a.node.id });
    }
    for (const r of nodeRender) {
      const n = r.node; if (n.__hidden) continue;
      const focus = (n.id === selectedId || n.id === hoveredId); let prio: number | null = null;
      if (focus) prio = 0;
      else if (!isCosmos) { if (n.kind === "file") prio = 2; }
      else {
        const b = n.body;
        if (b === "cluster") prio = 0.5;
        else if (b === "galaxy" && n.kind !== "folder") prio = 1;
        else if (b === "star") prio = 2;
        else if (b === "planet") prio = 3;
        else prio = null;
      }
      if (prio == null) continue;
      const dist = camera.position.distanceTo(VEC.fromArray(n.position));
      if (prio === 3 && dist > closeP) continue;
      if (prio === 2 && dist > starFar) continue;
      const sp = projectToScreen(n.position); if (!sp) continue;
      cands.push({ node: n, isArea: false, prio, dist, sx: sp.x, sy: sp.y, focus, key: "n:" + n.id });
    }
    cands.sort((A, B) => (A.prio - B.prio) || (A.dist - B.dist));
    const rects: any[] = [], np: any[] = []; let pool = 0; const MAXL = MOBILE ? 10 : 22;
    for (const c of cands) {
      if (np.length >= MAXL) break;
      const label = c.node.label;
      const w = Math.min(230, 18 + String(label || "").length * 7), h = c.focus ? 30 : 18;
      const x0 = c.sx - w / 2, y0 = c.sy - 12 - h / 2, x1 = x0 + w, y1 = y0 + h;
      let hit = false;
      for (const r of rects) { if (x0 < r.x1 + 3 && x1 > r.x0 - 3 && y0 < r.y1 + 3 && y1 > r.y0 - 3) { hit = true; break; } }
      if (hit) continue;
      rects.push({ x0, y0, x1, y1 });
      let el: any, ref: any = null;
      if (c.isArea) { el = c.el; ref = c.ref; }
      else {
        const slot = labelPool[pool++]; if (!slot) break; el = slot.el; ref = slot;
        if (slot.id !== c.key) {
          el.innerHTML = escapeHtml(c.node.label) + (c.focus ? `<small>${escapeHtml(prettyArea(c.node.area))}</small>` : "");
          el.style.color = (c.node.id === selectedId ? "#ffffff" : c.node.color);
          el.style.borderColor = (c.node.id === selectedId ? "#ffffff" : c.node.color) + "55";
          slot.id = c.key;
        }
      }
      np.push({ el, ref, node: c.node, isArea: c.isArea, focus: c.focus });
    }
    for (const a of areaLabels) { if (!np.some((p) => p.isArea && p.el === a.el)) { a.el.style.opacity = "0"; a.shown = false; } }
    for (let i = pool; i < labelPool.length; i++) { const sl = labelPool[i]; if (sl.shown) { sl.el.style.opacity = "0"; sl.shown = false; sl.id = null; } }
    placedLabels = np;
  }
  function updateLabels(t: number) {
    // rockets ride the trail head every frame regardless of the labels toggle
    // (the toggle only governs each rocket's name span, inside this call)
    if (agentSteps.length) updateAgentMarkers();
    if (!labelsEnabled) {
      for (const s of labelPool) { if (s.shown) { s.el.style.opacity = "0"; s.shown = false; } }
      for (const a of areaLabels) { if (a.shown) { a.el.style.opacity = "0"; a.shown = false; } }
      placedLabels = []; return;
    }
    const selHovChanged = (selectedId !== _lastSel || hoveredId !== _lastHov);
    if (selHovChanged || t - labelScanT > (navMode === "fly" ? 0.18 : 0.14)) { labelScanT = t; _lastSel = selectedId; _lastHov = hoveredId; rescanLabels(); }
    for (const p of placedLabels) {
      const sp = projectToScreen(p.node.position);
      if (!sp) { p.el.style.opacity = "0"; if (p.ref) p.ref.shown = false; continue; }
      const d = camera.position.distanceTo(VEC.fromArray(p.node.position));
      const op = p.focus ? 1 : THREE.MathUtils.clamp(1.25 - d / (p.isArea ? 440 : 320), 0, p.isArea ? 0.95 : 0.92);
      p.el.style.transform = `translate(-50%,-50%) translate(${sp.x.toFixed(1)}px,${(sp.y - 12).toFixed(1)}px)`;
      p.el.style.opacity = op.toFixed(2);
      if (p.ref) p.ref.shown = op > 0.02;   // direct slot ref — no per-frame array scans
    }
  }
  function prettyArea(a: string) { return a === "Vault" ? "Vault" : a === "Unresolved" ? "Unresolved" : a.replace(/^\d+_/, ""); }

  /* ---- camera controller ---- */
  const cam: any = {
    target: new THREE.Vector3(0, 4, 0), theta: 0.6, phi: 1.02, radius: 178,
    tTheta: 0.6, tPhi: 1.02, tRadius: 178, tTarget: new THREE.Vector3(0, 4, 0),
    minR: 12, maxR: 1800, autoRotate: true, flight: null,
  };
  const ZERO3 = new THREE.Vector3(0, 0, 0);
  let overviewRadius = MOBILE ? 156 : 184, sceneRadius = 90;
  function applyCamera() {
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.target.x + cam.radius * sp * Math.sin(cam.theta), cam.target.y + cam.radius * Math.cos(cam.phi), cam.target.z + cam.radius * sp * Math.cos(cam.theta));
    camera.lookAt(cam.target);
  }
  function syncSphFromCamera() {
    VEC.copy(camera.position).sub(cam.target); cam.radius = cam.tRadius = Math.max(cam.minR, VEC.length());
    cam.phi = cam.tPhi = Math.acos(THREE.MathUtils.clamp(VEC.y / cam.radius, -1, 1)); cam.theta = cam.tTheta = Math.atan2(VEC.x, VEC.z); cam.tTarget.copy(cam.target);
  }

  let dragging = false, dragMode = "orbit", lastX = 0, lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>(); let pinchDist = 0;
  function onDown(e: PointerEvent) {
    (dom as any).setPointerCapture && dom.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelTrailer();
    if (navMode === "fly") return;
    hideHint();
    if (pointers.size === 1) {
      dragging = true; dragMode = (e.button === 2 || e.shiftKey) ? "pan" : "orbit"; lastX = e.clientX; lastY = e.clientY; cam.flight = null; cam.autoRotate = false; downX = e.clientX; downY = e.clientY; moved = false;
      lpFired = false; cancelLongPress();
      if (e.pointerType === "touch") {
        lpX = e.clientX; lpY = e.clientY;
        lpTimer = setTimeout(() => { lpTimer = null; lpFired = true; dragging = false; moved = true; openKosmosMenuAt(lpX, lpY, true); }, 480);
      }
    } else if (pointers.size === 2) {
      cancelLongPress(); dragging = true; dragMode = "pinch"; const p = [...pointers.values()];
      pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); lastX = (p[0].x + p[1].x) / 2; lastY = (p[0].y + p[1].y) / 2; cam.flight = null;
    }
  }
  let downX = 0, downY = 0, moved = false;
  /* iOS long-press: WebKit never fires 'contextmenu' for touch, so we detect it ourselves. */
  let lpTimer: any = null, lpX = 0, lpY = 0, lpFired = false, menuShownAt = 0;
  function cancelLongPress() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
  function onMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (navMode === "fly") { flyLook(e); return; }
    if (!dragging) { if (!MOBILE) pendingHover = { x: e.clientX, y: e.clientY }; return; }
    if (dragMode === "pinch" && pointers.size >= 2) {
      const p = [...pointers.values()]; const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchDist > 0) cam.tRadius = THREE.MathUtils.clamp(cam.tRadius * (pinchDist / d), cam.minR, cam.maxR);
      pinchDist = d; const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2; panBy(mx - lastX, my - lastY); lastX = mx; lastY = my; return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
    if (lpTimer && Math.abs(e.clientX - lpX) + Math.abs(e.clientY - lpY) > 10) cancelLongPress();
    if (dragMode === "pan") panBy(dx, dy);
    else { cam.tTheta -= dx * 0.005; cam.tPhi = THREE.MathUtils.clamp(cam.tPhi - dy * 0.005, 0.12, Math.PI - 0.12); }
  }
  function onUp(e: PointerEvent) {
    cancelLongPress();
    const wasTouch = e.pointerType === "touch";
    const tapped = dragging && !moved && pointers.size === 1 && navMode !== "fly";
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    else if (pointers.size === 1) { dragMode = "orbit"; const p = [...pointers.values()][0]; lastX = p.x; lastY = p.y; }
    if (tapped && wasTouch) tapSelect(e.clientX, e.clientY);
  }
  function panBy(dx: number, dy: number) {
    const f = cam.radius * 0.0016;
    VEC.set(Math.cos(cam.theta), 0, -Math.sin(cam.theta)); cam.tTarget.addScaledVector(VEC, -dx * f);
    cam.tTarget.y += dy * f;
  }
  function onWheel(e: WheelEvent) {
    if (navMode === "fly") return; cancelTrailer(); e.preventDefault(); cam.flight = null;
    cam.tRadius = THREE.MathUtils.clamp(cam.tRadius * (e.deltaY < 0 ? 0.9 : 1.1), cam.minR, cam.maxR); cam.autoRotate = false;
  }
  function onClick(e: MouseEvent) { if (MOBILE || navMode === "fly" || moved) return; tapSelect(e.clientX, e.clientY); }
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  dom.addEventListener("pointercancel", onUp);
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("click", onClick);

  let kosmosMenu: any = null;
  function hideKosmosMenu() { if (kosmosMenu) kosmosMenu.style.display = "none"; }
  function ensureKosmosMenu() {
    if (kosmosMenu) return kosmosMenu;
    const m = document.createElement("div"); m.id = "kosmosCtx";
    m.style.cssText = "position:fixed;z-index:80;min-width:160px;background:rgba(12,18,32,.97);border:1px solid rgba(125,211,252,.25);border-radius:10px;padding:6px;backdrop-filter:blur(8px);box-shadow:0 12px 32px rgba(0,0,0,.55);font:500 13px/1.3 var(--font,system-ui,sans-serif);color:#dce6f5;display:none";
    document.body.appendChild(m); kosmosMenu = m; return m;
  }
  function openKosmosMenuAt(x: number, y: number, fromTouch: boolean) {
    const rec = pickAt(x, y);
    if (!rec) { hideKosmosMenu(); return; }
    const n = rec.node;
    selectedId = n.id; cam.autoRotate = false; applyHighlight(); showInspector(n.id);
    const m = ensureKosmosMenu(); m.innerHTML = "";
    if (fromTouch) { m.style.minWidth = "210px"; m.style.font = "500 15px/1.35 var(--font,system-ui,sans-serif)"; }
    const head = document.createElement("div"); head.textContent = n.label || n.id;
    head.style.cssText = "padding:5px 9px;color:#9fb4d4;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;border-bottom:1px solid rgba(125,211,252,.12);margin-bottom:4px";
    m.appendChild(head);
    // Folder-only galaxies/cluster (no manifest note, n.kind==='folder') must
    // never open or create a note — they expand in the file explorer instead.
    const isFolderTarget = n.kind === "folder" && !!n.path && !!opts.onOpenFolder;
    const canOpenNote = !isFolderTarget && !!n.path && n.kind !== "unresolved" && !!opts.onOpenNote;
    const actionable = isFolderTarget || canOpenNote;
    const item = document.createElement("button");
    item.textContent = isFolderTarget ? "Expand Folder" : (n.body === "oort" ? "Open file" : (canOpenNote ? "Go to Note" : "No note to open"));
    item.style.cssText = "display:block;width:100%;text-align:left;padding:" + (fromTouch ? "13px 14px" : "8px 10px") + ";border:none;background:transparent;color:" + (actionable ? "#e7eefc" : "#5b6b86") + ";border-radius:7px;cursor:" + (actionable ? "pointer" : "default") + ";font:inherit;-webkit-tap-highlight-color:rgba(125,211,252,.18)";
    if (actionable) {
      item.onmouseenter = () => item.style.background = "rgba(125,211,252,.14)";
      item.onmouseleave = () => item.style.background = "transparent";
      const go = () => {
        if (performance.now() - menuShownAt < 350) return;
        try {
          if (isFolderTarget) {
            // Folders are places, not notes: ask the host to expand the folder
            // AND fly the camera to the galaxy here (v0.5.1 behavior).
            opts.onOpenFolder && opts.onOpenFolder(n.path);
            if (navMode !== "fly") startFlight(navMode === "overview" ? "focus" : navMode);
          } else {
            opts.onOpenNote && opts.onOpenNote(n.path, n.label);
          }
        } catch (_) { /* host callback errors are not ours */ }
        hideKosmosMenu();
      };
      item.addEventListener("click", go);
      item.addEventListener("touchend", (ev) => { ev.preventDefault(); ev.stopPropagation(); go(); }, { passive: false });
    }
    m.appendChild(item);
    m.style.display = "block"; menuShownAt = performance.now();
    const vw = window.innerWidth, vh = window.innerHeight, mw = fromTouch ? 226 : 176;
    const mx = fromTouch ? x + 14 : x, my = fromTouch ? y - 84 : y;
    m.style.left = Math.max(6, Math.min(mx, vw - mw)) + "px"; m.style.top = Math.max(6, Math.min(my, vh - (fromTouch ? 110 : 86))) + "px";
  }
  const onCtxMenu = (e: MouseEvent) => { e.preventDefault(); openKosmosMenuAt(e.clientX, e.clientY, (e as any).pointerType === "touch" || MOBILE); };
  dom.addEventListener("contextmenu", onCtxMenu);
  const onWinClick = (e: MouseEvent) => {
    if (!kosmosMenu || kosmosMenu.style.display === "none") return;
    if (performance.now() - menuShownAt < 600) return;
    if (!kosmosMenu.contains(e.target)) hideKosmosMenu();
  };
  window.addEventListener("click", onWinClick);
  const onEscMenu = (e: KeyboardEvent) => { if (e.key === "Escape") hideKosmosMenu(); };
  window.addEventListener("keydown", onEscMenu);
  window.addEventListener("wheel", hideKosmosMenu, { passive: true });

  /* ---- navigation modes + flights ---- */
  let navMode = "overview";
  function camTargetForMode(mode: string, focus: any) {
    if (mode === "focus") return { target: focus.clone(), radius: MOBILE ? 36 : 44, phi: cam.phi - 0.16 };
    if (mode === "deep") return { target: focus.clone(), radius: MOBILE ? 16 : 20, phi: cam.phi - 0.04 };
    return { target: new THREE.Vector3(0, 4, 0), radius: overviewRadius, phi: 1.02 };
  }
  function startFlight(mode: string) {
    const fn = selectedId ? G.nodeById.get(selectedId) : (primaryLiveId ? G.nodeById.get(primaryLiveId) : null);
    const focus = fn ? VEC2.fromArray(fn.position).clone() : new THREE.Vector3(0, 4, 0);
    const tgt = camTargetForMode(mode, focus);
    cam.autoRotate = false;
    const fromPos = camera.position.clone(), fromTarget = cam.target.clone();
    const toTheta = Math.atan2(fromPos.x - tgt.target.x, fromPos.z - tgt.target.z);
    cam.flight = {
      t: 0, dur: mode === "overview" ? 1.5 : mode === "focus" ? 1.2 : 1.0, fromPos, fromTarget,
      toTarget: tgt.target.clone(), toRadius: tgt.radius, toTheta, toPhi: THREE.MathUtils.clamp(tgt.phi, 0.18, Math.PI - 0.18),
    };
  }
  function smoother(x: number) { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function updateFlight(dt: number) {
    const fl = cam.flight; if (!fl) return;
    fl.t = Math.min(1, fl.t + dt / fl.dur); const e = smoother(fl.t), arc = Math.sin(Math.PI * e);
    const sp = Math.sin(fl.toPhi);
    VEC.set(fl.toTarget.x + fl.toRadius * sp * Math.sin(fl.toTheta), fl.toTarget.y + fl.toRadius * Math.cos(fl.toPhi), fl.toTarget.z + fl.toRadius * sp * Math.cos(fl.toTheta));
    camera.position.lerpVectors(fl.fromPos, VEC, e);
    const travel = fl.fromPos.distanceTo(VEC); camera.position.y += arc * Math.min(fl.toRadius > 120 ? 18 : 9, travel * 0.14);
    cam.target.lerpVectors(fl.fromTarget, fl.toTarget, smoother(Math.min(1, e + 0.1)));
    camera.lookAt(cam.target);
    if (fl.t >= 1) { cam.target.copy(fl.toTarget); syncSphFromCamera(); cam.flight = null; if (navMode === "overview" && !selectedId) cam.autoRotate = true; }
  }
  function setMode(mode: string) {
    navMode = mode;
    document.querySelectorAll("#modes button").forEach((b: any) => b.classList.toggle("on", b.dataset.mode === mode));
    document.body.classList.toggle("flymode", mode === "fly");
    if (mode === "fly") { enterFly(); return; }
    exitFly(); startFlight(mode); showHintForMode(mode);
  }

  /* ---- fly mode ---- */
  const flyKeys = new Set<string>(), FLY_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "KeyC", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  let flyYaw = 0, flyPitch = 0; const flyVel = new THREE.Vector3();
  function enterFly() {
    syncSphFromCamera(); camera.getWorldDirection(VEC);
    flyPitch = Math.asin(THREE.MathUtils.clamp(VEC.y, -1, 1)); flyYaw = Math.atan2(-VEC.x, -VEC.z);
    camera.rotation.set(flyPitch, flyYaw, 0, "YXZ");
    if (!MOBILE && (dom as any).requestPointerLock) (dom as any).requestPointerLock();
  }
  function exitFly() { flyKeys.clear(); flyVel.set(0, 0, 0); if (document.pointerLockElement === dom) document.exitPointerLock(); }
  function flyLook(e: PointerEvent) {
    if (document.pointerLockElement === dom) {
      flyYaw -= (e as any).movementX * 0.0014; flyPitch = THREE.MathUtils.clamp(flyPitch - (e as any).movementY * 0.0012, -1.5, 1.5);
      camera.rotation.set(flyPitch, flyYaw, 0, "YXZ"); return;
    }
    if (MOBILE) {
      if (padActive) return;
      if (lookLast) {
        flyYaw -= (e.clientX - lookLast.x) * 0.004; flyPitch = THREE.MathUtils.clamp(flyPitch - (e.clientY - lookLast.y) * 0.004, -1.5, 1.5);
        camera.rotation.set(flyPitch, flyYaw, 0, "YXZ");
      }
      lookLast = { x: e.clientX, y: e.clientY };
    }
  }
  function updateFly(dt: number) {
    if (navMode !== "fly") return;
    camera.getWorldDirection(VEC); VEC2.crossVectors(VEC, UP).normalize();
    const sprint = flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight"); const sp = sprint ? 70 : 30; const tv = _tv.set(0, 0, 0);
    if (flyKeys.has("KeyW")) tv.addScaledVector(VEC, sp); if (flyKeys.has("KeyS")) tv.addScaledVector(VEC, -sp);
    if (flyKeys.has("KeyD")) tv.addScaledVector(VEC2, sp); if (flyKeys.has("KeyA")) tv.addScaledVector(VEC2, -sp);
    if (flyKeys.has("KeyE") || flyKeys.has("Space")) tv.y += sp; if (flyKeys.has("ControlLeft") || flyKeys.has("KeyC")) tv.y -= sp;
    if (padActive) { tv.addScaledVector(VEC, -padVec.y * sp); tv.addScaledVector(VEC2, padVec.x * sp); }
    flyVel.lerp(tv, 1 - Math.exp(-dt * 9)); camera.position.addScaledVector(flyVel, dt);
  }
  const UP = new THREE.Vector3(0, 1, 0), _tv = new THREE.Vector3();

  /* ---- selection / hover ---- */
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  let selectedId: string | null = null, hoveredId: string | null = null, primaryLiveId: string | null = null;
  let liveIds = new Set<string>(), emergingIds = new Set<string>();
  /** Ids currently lit for the live AI-agent traversal trail (Agent API queries) — colored emerald, distinct from the edit-live pulse. */
  let agentIds = new Set<string>();
  let pendingHover: any = null, lastHoverT = 0;
  function pickAt(cx: number, cy: number) {
    ndc.x = (cx / window.innerWidth) * 2 - 1; ndc.y = -(cy / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    let best: any = null, bestDist = Infinity;
    for (const b in layers) {
      const hits = raycaster.intersectObject(layers[b].mesh, false);
      for (const h of hits) {
        if (h.instanceId == null) continue;
        const rec = layers[b].recByIdx[h.instanceId];
        if (!rec || rec.node.__hidden) continue;
        if (h.distance < bestDist) { bestDist = h.distance; best = rec; }
        break;
      }
    }
    return best;
  }
  function tapSelect(cx: number, cy: number) { const rec = pickAt(cx, cy); if (rec) { selectNode(rec.node.id, true); } else { clearFocus(); } }
  function doHover() {
    if (!pendingHover) return;
    const t = performance.now(); if (t - lastHoverT < 55) return; lastHoverT = t;
    const rec = pickAt(pendingHover.x, pendingHover.y); pendingHover = null;
    const id = rec ? rec.node.id : null;
    if (id !== hoveredId) { hoveredId = id; dom.style.cursor = id ? "pointer" : "default"; applyHighlight(); }
  }
  function applyHighlight() {
    for (const r of nodeRender) r.layer.attrs.aHi.setX(r.idx, (r.node.id === selectedId || r.node.id === hoveredId) ? 1 : 0);
    for (const b in layers) layers[b].attrs.aHi.needsUpdate = true;
    const focus = new Set<string>(); if (selectedId) focus.add(selectedId); if (hoveredId) focus.add(hoveredId); for (const id of liveIds) focus.add(id);
    updateFocusLinks(focus.size ? focus : null);
    updateHalos();
  }
  function applyLive() {
    for (const r of nodeRender) { const n = r.node; r.layer.attrs.aLive.setX(r.idx, liveIds.has(n.id) ? 1 : 0); r.layer.attrs.aEmerge.setX(r.idx, emergingIds.has(n.id) ? 1 : 0); }
    for (const b in layers) { layers[b].attrs.aLive.needsUpdate = true; layers[b].attrs.aEmerge.needsUpdate = true; }
  }
  const AGENT_TRAIL_COLOR = "#34d399"; // emerald — visually distinct from the edit-live pulse
  let __halosActive = false;
  function updateHalos() {
    if (!glow) return;
    // agent-traversal ids first so a busy trail is never truncated ahead of the plain edit-live set
    const ids = new Set<string>(); for (const id of agentIds) ids.add(id); if (selectedId) ids.add(selectedId); for (const id of liveIds) ids.add(id);
    if (!ids.size && !__halosActive) return;   // idle fast-path: nothing selected/live now or last frame -> skip all writes+uploads
    __halosActive = ids.size > 0;
    let i = 0;
    for (const id of ids) {
      if (i >= HALO_CAP) break;
      const rec = idToRender.get(id); if (!rec || rec.node.__hidden) continue;
      const n = rec.node, gi = haloBase + i;
      MAT.makeTranslation(n.position[0], n.position[1], n.position[2]); glow.mesh.setMatrixAt(gi, MAT);
      const c = lin(id === selectedId ? "#ffffff" : (agentIds.has(id) ? AGENT_TRAIL_COLOR : n.color)); glow.attrs.aColor.setXYZ(gi, c[0], c[1], c[2]);
      glow.attrs.aSize.setX(gi, Math.max(6, (n.__r || 1) * 5)); glow.attrs.aVisible.setX(gi, 1);
      glow.attrs.aLive.setX(gi, (liveIds.has(id) || agentIds.has(id)) ? 1 : 0); glow.attrs.aSeed.setX(gi, hashUnitLocal(id)); i++;
    }
    for (; i < HALO_CAP; i++) glow.attrs.aVisible.setX(haloBase + i, 0);
    glow.mesh.instanceMatrix.needsUpdate = true;
    glow.attrs.aVisible.needsUpdate = true; glow.attrs.aColor.needsUpdate = true; glow.attrs.aSize.needsUpdate = true; glow.attrs.aLive.needsUpdate = true; glow.attrs.aSeed.needsUpdate = true;
  }
  function selectNode(id: string, fly?: boolean) {
    selectedId = id; cam.autoRotate = false; applyHighlight(); showInspector(id);
    if (fly !== false && navMode !== "fly") startFlight(navMode === "overview" ? "focus" : navMode);
  }
  function clearFocus() { selectedId = null; applyHighlight(); hideInspector(); if (navMode === "overview") cam.autoRotate = true; }

  /* ---- UI wiring ---- */
  function updateStats() {
    const host = document.getElementById("stats"); if (!host) return;
    const files = G.nodes.filter((n: any) => n.kind === "file").length;
    const items = [["Nodes", G.nodes.length], ["Links", G.links.filter((l: any) => l.kind !== "contains").length], ["Files", files], ["Areas", new Set(G.nodes.map((n: any) => n.area)).size - 1]];
    host.innerHTML = items.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
  }
  const inspector = document.getElementById("inspector");
  function bodyLabel(b: string, n?: any) {
    const de = LANG === "de";
    if (b === "cluster") return de ? "Cluster-Kern" : "Cluster core";
    if (b === "galaxy") return de ? "Galaxienzentrum" : "Galactic center";
    if (b === "oort") return de ? "Oort-Objekt" : "Oort object";
    if (b === "star") {
      const cls = n && n.__spectral ? n.__spectral.cls : null; // H-R spectral class
      return cls ? (de ? `Stern · Klasse ${cls}` : `Class ${cls} Star`) : (de ? "Stern" : "Star");
    }
    if (b === "planet") return (n && n.__ptypeName) ? n.__ptypeName : "Planet"; // NASA exoplanet type
    return b === "moon" ? (de ? "Mond" : "Moon") : b === "moonlet" ? (de ? "Mondchen" : "Moonlet") : "Asteroid";
  }
  function showInspector(id: string) {
    const n = G.nodeById.get(id); if (!n || !inspector) return;
    const be = document.getElementById("insBody"); be.textContent = bodyLabel(n.body, n);
    (be as HTMLElement).style.color = n.body === "star" && n.__starColor ? n.__starColor : n.body === "planet" && n.__pcolor ? n.__pcolor : n.color;
    document.getElementById("insName").textContent = n.label;
    document.getElementById("insPath").textContent = n.path || prettyArea(n.area);
    const out = G.links.filter((l: any) => l.kind !== "contains" && l.source === id);
    const inc = G.links.filter((l: any) => l.kind !== "contains" && l.target === id);
    const rows: any[] = [["Kind", n.kind], ["Area", prettyArea(n.area)]];
    if (n.type) rows.push(["Type", n.type]); if (n.status) rows.push(["Status", n.status]);
    rows.push([T("links"), out.length], [T("backlinks"), inc.length]);
    if (n.tags && n.tags.length) rows.push(["Tags", n.tags.slice(0, 6).join(", ")]);
    document.getElementById("insGrid").innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(String(k))}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
    const host = document.getElementById("insLinks");
    if (host) {
      host.innerHTML = "";
      const seen = new Set<string>(), neigh: any[] = [];
      for (const l of out) { const t = G.nodeById.get(l.target); if (t && !seen.has(t.id)) { seen.add(t.id); neigh.push(t); } }
      for (const l of inc) { const s = G.nodeById.get(l.source); if (s && !seen.has(s.id)) { seen.add(s.id); neigh.push(s); } }
      for (const t of neigh.slice(0, 12)) {
        const b = document.createElement("button"); b.className = "linkchip"; b.textContent = t.label;
        b.style.borderColor = (t.color || "#7dd3fc") + "66"; b.onclick = () => selectNode(t.id, true); host.appendChild(b);
      }
    }
    const old = inspector.querySelector(".okfBox"); if (old) old.remove();
    if (n.okf) {
      const box = document.createElement("div"); box.className = "okfBox";
      const meta = document.createElement("div"); meta.className = "path";
      const dt = n.validAt ? new Date(n.validAt).toISOString().slice(0, 10) : "";
      const projection = n.okf.projection;
      const score = projection?.assessment?.scores?.overall;
      const scoreText = typeof score === "number" ? ` · documentation ${Math.round(score * 100)}%` : projection ? " · not assessable" : "";
      const governance = projection ? ` · ${projection.sourceVersion || "legacy"} · ${projection.effective?.sensitivity || "internal"} · ${projection.diagnostics?.length || 0} diagnostic${projection.diagnostics?.length === 1 ? "" : "s"}` : "";
      meta.textContent = "OKF+ " + (n.okf.type || "note") + governance + scoreText + (dt ? (" · " + dt) : "") + (n.okf.head ? " · HEAD" : "") + (n.okf.invalidAt ? (" · superseded " + new Date(n.okf.invalidAt).toISOString().slice(0, 10)) : "");
      if (projection) meta.title = "Governance overlay: assessment measures documentation and support quality, not truth or authorization. Proposed values are not included in effective state.";
      box.appendChild(meta);
      const chips = document.createElement("div"); chips.className = "linkchips";
      const nameOf = (i2: string) => { const x = G.nodeById.get(i2); return x ? x.label : i2; };
      for (const pid of (n.okf.supersedesIds || [])) { const c2 = document.createElement("button"); c2.className = "linkchip"; c2.textContent = "↞ " + nameOf(pid); c2.onclick = () => selectNode(pid, true); chips.appendChild(c2); }
      for (const nid of (n.okf.supersededByIds || [])) { const c2 = document.createElement("button"); c2.className = "linkchip"; c2.textContent = "↠ " + nameOf(nid); c2.onclick = () => selectNode(nid, true); chips.appendChild(c2); }
      if (chips.children.length) box.appendChild(chips);
      inspector.appendChild(box);
    }
    inspector.classList.add("show");
    placeMobileInspector();
  }
  function hideInspector() { if (inspector) inspector.classList.remove("show"); }
  const deckEl = document.querySelector(".deck");
  function placeMobileInspector() {
    if (!MOBILE || !inspector) return;
    const vv = (window as any).visualViewport;
    const vh = (vv && vv.height) ? vv.height : window.innerHeight;
    let deckTop = vh - 86;
    if (deckEl) { const r = deckEl.getBoundingClientRect(); if (r.height > 0 && r.top > 80) deckTop = Math.min(deckTop, r.top); }
    (inspector as HTMLElement).style.bottom = Math.max(12, window.innerHeight - deckTop + 10) + "px";
    (inspector as HTMLElement).style.maxHeight = Math.max(150, deckTop - 64) + "px";
  }
  window.addEventListener("resize", placeMobileInspector);
  window.addEventListener("orientationchange", () => setTimeout(placeMobileInspector, 120));
  if ((window as any).visualViewport) (window as any).visualViewport.addEventListener("resize", placeMobileInspector);
  document.getElementById("insX") && document.getElementById("insX").addEventListener("click", clearFocus);

  let labelsEnabled = true;
  function toggleLabels() {
    labelsEnabled = !labelsEnabled; const b = document.getElementById("labelsBtn"); if (b) b.classList.toggle("on", labelsEnabled);
    // apply to agent-rocket name spans immediately (don't wait for a frame tick)
    for (const m of agentMarkers) m.name.style.display = labelsEnabled ? "" : "none";
  }
  document.getElementById("labelsBtn") && document.getElementById("labelsBtn").addEventListener("click", toggleLabels);

  function setAllObjectsGlow(on: boolean) { for (const m of matsWithTime) { if (m && m.uniforms && m.uniforms.uGlowAll) m.uniforms.uGlowAll.value = on ? 1.0 : 0.0; } }
  function applyConnVisibility() { if (thinLines) thinLines.mat.opacity = showAllConnections ? 0.5 : 0.05; if (chainLines) chainLines.mat.opacity = showAllConnections ? 0.6 : 0.42; }
  function toggleAllConnections() { showAllConnections = !showAllConnections; const b = document.getElementById("allLinksBtn"); if (b) b.classList.toggle("on", showAllConnections); applyConnVisibility(); }
  function toggleAllObjects() { showAllObjects = !showAllObjects; const b = document.getElementById("allObjBtn"); if (b) b.classList.toggle("on", showAllObjects); setAllObjectsGlow(showAllObjects); applyFilters(); }
  document.getElementById("allLinksBtn") && document.getElementById("allLinksBtn").addEventListener("click", toggleAllConnections);
  document.getElementById("allObjBtn") && document.getElementById("allObjBtn").addEventListener("click", toggleAllObjects);

  /* ---- Chrono: point-in-time travel over the core temporal projection (§4.1) ---- */
  let chronoT: number | null = null;
  const chronoBar = document.getElementById("chronoBar"), chronoRange = document.getElementById("chronoRange") as HTMLInputElement, chronoLabel = document.getElementById("chronoLabel"), chronoBtn = document.getElementById("chronoBtn");
  function setChronoTint() {
    if (!layers) return; const dark = lin("#39404f");
    for (const r of nodeRender) {
      const n = r.node; if (n.kind !== "file" || !n.__baseC) continue;
      let c = n.__baseC;
      // superseded at time T (invalid_at <= T) => dark ghost — same rule as core projectAtTime
      if (chronoT != null && n.__it != null && n.__it <= chronoT) { c = [c[0] * 0.28 + dark[0] * 0.72, c[1] * 0.28 + dark[1] * 0.72, c[2] * 0.28 + dark[2] * 0.72]; }
      r.layer.attrs.aColor.setXYZ(r.idx, c[0], c[1], c[2]);
    }
    for (const bb in layers) layers[bb].attrs.aColor.needsUpdate = true;
  }
  function chronoApply() {
    if (!G || !G.__timeSpan || chronoT == null) return;
    const d = new Date(chronoT); if (chronoLabel) chronoLabel.textContent = d.toISOString().slice(0, 10);
    applyFilters(); setChronoTint();
  }
  function toggleChrono() {
    if (!G) return;
    if (!G.__timeSpan) { showHint(LANG === "de" ? "Keine OKF+ Zeitstempel im Vault" : "No OKF+ timestamps in this vault"); return; }
    const on = chronoBar && !chronoBar.classList.contains("show");
    if (chronoBar) chronoBar.classList.toggle("show", !!on);
    if (chronoBtn) chronoBtn.classList.toggle("on", !!on);
    if (on) { chronoT = G.__timeSpan.max; if (chronoRange) chronoRange.value = "1000"; chronoApply(); }
    else { chronoT = null; applyFilters(); setChronoTint(); }
  }
  if (chronoRange) chronoRange.addEventListener("input", () => {
    if (!G || !G.__timeSpan) return;
    const f = Number(chronoRange.value) / 1000; chronoT = G.__timeSpan.min + (G.__timeSpan.max - G.__timeSpan.min) * f; chronoApply();
  });
  if (chronoBtn) chronoBtn.addEventListener("click", toggleChrono);
  document.getElementById("resetBtn") && document.getElementById("resetBtn").addEventListener("click", () => { clearFocus(); setMode("overview"); });
  document.querySelectorAll("#modes button").forEach((b: any) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  const hintEl = document.getElementById("hint"); let hintTimer: any = null;
  function showHint(txt: string) { if (!hintEl) return; hintEl.textContent = txt; hintEl.classList.add("show"); clearTimeout(hintTimer); hintTimer = setTimeout(() => hintEl.classList.remove("show"), 3200); }
  function hideHint() { if (hintEl) hintEl.classList.remove("show"); }
  function showHintForMode(m: string) {
    if (m === "fly") showHint(MOBILE ? "Fly mode — drag to look, use the pads to move" : "Fly mode — WASD to move, mouse to look, F to exit");
    else if (m === "focus" && !selectedId) showHint("Tap a body to focus on it");
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.altKey) return;
    const tag = (e.target && (e.target as HTMLElement).tagName) || "";
    if (e.code === "Escape") {
      if (trailer) { cancelTrailer(); return; }
      const si = document.getElementById("search");
      if (document.activeElement === si) { (si as HTMLElement).blur(); return; }
      clearFocus(); return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Slash") { e.preventDefault(); const si = document.getElementById("search"); if (si) (si as HTMLElement).focus(); return; }
    if (e.code === "KeyA") { setMode("overview"); return; }
    if (e.code === "KeyS") { setMode("focus"); return; }
    if (e.code === "KeyD") { setMode("deep"); return; }
    if (e.code === "KeyF") { setMode(navMode === "fly" ? "overview" : "fly"); return; }
    if (e.code === "KeyQ") { clearFocus(); return; }
    if (e.code === "KeyR") { toggleLabels(); return; }
    if (e.code === "KeyC") { toggleAllConnections(); return; }
    if (e.code === "KeyO") { toggleAllObjects(); return; }
    if (e.code === "KeyH") { toggleChrono(); return; }
    if (e.code === "KeyG") { (playback && playback.mode === "grow") ? stopPlayback() : startGrowth(); return; }
    if (e.code === "KeyT") { (playback && playback.mode === "timeline") ? stopPlayback() : startTimeline(); return; }
    if (navMode === "fly" && FLY_CODES.has(e.code)) { e.preventDefault(); flyKeys.add(e.code); }
  };
  window.addEventListener("keydown", onKeyDown);
  const onKeyUp = (e: KeyboardEvent) => flyKeys.delete(e.code);
  window.addEventListener("keyup", onKeyUp);

  /* ---- i18n ---- */
  let LANG = detectLang();
  const T = (k: string) => (I18N[LANG] && I18N[LANG][k]) || k;
  function applyI18n() {
    document.documentElement.lang = LANG;
    document.querySelectorAll("[data-i]").forEach((el: any) => { el.textContent = T(el.getAttribute("data-i")); });
    document.querySelectorAll("[data-ip]").forEach((el: any) => { el.setAttribute("placeholder", T(el.getAttribute("data-ip"))); });
    const lb = document.getElementById("langBtn"); if (lb) lb.textContent = LANG.toUpperCase();
    if (selectedId) showInspector(selectedId);
  }
  const langBtn = document.getElementById("langBtn");
  if (langBtn) langBtn.addEventListener("click", () => { LANG = LANG === "en" ? "de" : "en"; applyI18n(); });

  /* ---- search + filters (live visibility, no rebuild) ---- */
  const filters: any = { q: "", areas: new Set(), tags: new Set(), types: new Set(), statuses: new Set(), showUnresolved: true };
  const isHidden = (id: string) => { const r = idToRender.get(id); return !r || r.node.__hidden; };
  function nodeMatches(n: any) {
    if (n.kind === "unresolved" && !filters.showUnresolved) return false;
    if (filters.areas.size && !filters.areas.has(n.area)) return false;
    if (filters.types.size && (!n.type || !filters.types.has(n.type))) return false;
    if (filters.statuses.size && (!n.status || !filters.statuses.has(n.status))) return false;
    if (filters.tags.size && !(n.tags || []).some((t: string) => filters.tags.has(t))) return false;
    if (filters.q) { const hay = (n.label + " " + (n.path || "") + " " + (n.tags || []).join(" ")).toLowerCase(); if (hay.indexOf(filters.q) < 0) return false; }
    return true;
  }
  function applyAmbientVisibility() {
    if (!ambientLines || !ambientLines.apos) return;
    const { apos, acol, geo } = ambientLines; let v = 0;
    for (const seg of ambientSegs) {
      if (seg.s.__hidden || seg.t.__hidden) continue;
      const o = v * 6;
      apos[o] = seg.s.position[0]; apos[o + 1] = seg.s.position[1]; apos[o + 2] = seg.s.position[2];
      apos[o + 3] = seg.t.position[0]; apos[o + 4] = seg.t.position[1]; apos[o + 5] = seg.t.position[2];
      acol[o] = seg.r; acol[o + 1] = seg.g; acol[o + 2] = seg.b; acol[o + 3] = seg.r; acol[o + 4] = seg.g; acol[o + 5] = seg.b; v++;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, v * 2);
  }
  function applyFilters() {
    for (const r of nodeRender) {
      let vis = nodeMatches(r.node);
      if (vis && chronoT != null && r.node.kind === "file" && r.node.__vt != null && r.node.__vt > chronoT) vis = false; // not yet written at time T
      r.node.__hidden = !vis;
      r.layer.attrs.aVisible.setX(r.idx, (vis && (showAllObjects || r.node.__lodVisible !== false)) ? 1 : 0);
    }
    for (const b in layers) layers[b].attrs.aVisible.needsUpdate = true;
    if (glow) {
      for (const r of nodeRender) { const gi = r.node.__glow; if (gi != null && gi < haloBase) glow.attrs.aVisible.setX(gi, r.node.__hidden ? 0 : 1); }
      glow.attrs.aVisible.needsUpdate = true;
    }
    applyAmbientVisibility();
    const focus = new Set<string>();
    if (selectedId && !isHidden(selectedId)) focus.add(selectedId);
    for (const id of liveIds) if (!isHidden(id)) focus.add(id);
    updateFocusLinks(focus.size ? focus : null); updateHalos();
  }
  function mkChip(label: string, active: boolean, on: () => void) { const b = document.createElement("button"); b.className = "chip" + (active ? " on" : ""); b.textContent = label; b.onclick = on; return b; }
  function buildFilterUI() {
    const wrap = document.getElementById("filterBody"); if (!wrap) return; wrap.innerHTML = "";
    const areas = [...new Set(G.nodes.map((n: any) => n.area))].filter((a) => a !== "Vault").sort() as string[];
    const tags = [...new Set(G.nodes.flatMap((n: any) => n.tags || []))].sort().slice(0, 24) as string[];
    const types = [...new Set(G.nodes.map((n: any) => n.type).filter(Boolean))].sort() as string[];
    const statuses = [...new Set(G.nodes.map((n: any) => n.status).filter(Boolean))].sort() as string[];
    const sec = (key: string, items: string[], set: Set<string>, pretty: boolean) => {
      if (!items.length) return;
      const h = document.createElement("div"); h.className = "fsec";
      const ti = document.createElement("h5"); ti.setAttribute("data-i", key); ti.textContent = T(key); h.appendChild(ti);
      const row = document.createElement("div"); row.className = "chips";
      for (const it of items) row.appendChild(mkChip(pretty ? prettyArea(it) : it, set.has(it), () => { set.has(it) ? set.delete(it) : set.add(it); applyFilters(); buildFilterUI(); }));
      h.appendChild(row); wrap.appendChild(h);
    };
    sec("areas", areas, filters.areas, true); sec("tags", tags, filters.tags, false); sec("types", types, filters.types, false); sec("status", statuses, filters.statuses, false);
    const u = document.createElement("label"); u.className = "ftoggle";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = filters.showUnresolved;
    cb.onchange = () => { filters.showUnresolved = cb.checked; applyFilters(); };
    const sp = document.createElement("span"); sp.setAttribute("data-i", "unresolved"); sp.textContent = T("unresolved");
    u.appendChild(cb); u.appendChild(sp); wrap.appendChild(u);
  }
  const searchInput = document.getElementById("search") as HTMLInputElement;
  if (searchInput) searchInput.addEventListener("input", () => { filters.q = searchInput.value.trim().toLowerCase(); applyFilters(); });
  if (searchInput && MOBILE) searchInput.addEventListener("blur", () => setTimeout(() => { try { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; } catch (_) { /* iOS quirk */ } placeMobileInspector(); }, 80));
  const filterToggle = document.getElementById("filterToggle"), filterPanel = document.getElementById("filterPanel");
  if (filterToggle && filterPanel) filterToggle.addEventListener("click", () => { filterPanel.classList.toggle("show"); filterToggle.classList.toggle("on"); });

  /* ---- orientation mini-map (top-down x/z plane) ---- */
  const mm = document.getElementById("minimap") as HTMLCanvasElement, mmx = mm ? mm.getContext("2d") : null;
  let mmScale = 1, mmOffsetX = 0, mmOffsetZ = 0, mmPan: any = null;
  function mmBounds() { let mx = 20; for (const n of G.nodes) mx = Math.max(mx, Math.abs(n.position[0]), Math.abs(n.position[2])); return mx; }
  function drawMinimap() {
    if (!mmx || !mm || !G) return; const W = mm.width, H = mm.height; mmx.clearRect(0, 0, W, H);
    const R = mmBounds() * 1.06, s = (Math.min(W, H) / 2 - 6) / R * mmScale, cx = W / 2, cy = H / 2;
    const dotR = (n: any) => n.body === "cluster" ? 5.5 : n.body === "galaxy" ? 3.8 : n.body === "star" ? 2.4 : n.body === "planet" ? 1.3 : n.body === "asteroid" ? 0.8 : n.body === "oort" ? 0.5 : 1.0;
    const draw = (n: any) => {
      const x = cx + (n.position[0] - mmOffsetX) * s, y = cy + (n.position[2] - mmOffsetZ) * s;
      const anchor = (n.body === "cluster" || n.body === "galaxy");
      mmx.fillStyle = n.id === selectedId ? "#ffffff" : (liveIds.has(n.id) ? "#fbbf24" : (n.color || "#9fb4d4"));
      mmx.globalAlpha = (n.id === selectedId || liveIds.has(n.id) || anchor) ? 1 : 0.6;
      mmx.beginPath(); mmx.arc(x, y, dotR(n), 0, 6.283); mmx.fill();
      if (anchor) { mmx.globalAlpha = 0.45; mmx.strokeStyle = n.color || "#cbd5e1"; mmx.lineWidth = 1; mmx.beginPath(); mmx.arc(x, y, dotR(n) + 2.6, 0, 6.283); mmx.stroke(); }
    };
    for (const n of G.nodes) { if (n.__hidden || n.body === "cluster" || n.body === "galaxy") continue; draw(n); }
    for (const n of G.nodes) { if (!n.__hidden && (n.body === "cluster" || n.body === "galaxy")) draw(n); }
    mmx.globalAlpha = 1;
    const camx = cx + (camera.position.x - mmOffsetX) * s, camy = cy + (camera.position.z - mmOffsetZ) * s, tx = cx + (cam.target.x - mmOffsetX) * s, ty = cy + (cam.target.z - mmOffsetZ) * s;
    mmx.strokeStyle = "rgba(125,211,252,.85)"; mmx.lineWidth = 1.2; mmx.beginPath(); mmx.moveTo(camx, camy); mmx.lineTo(tx, ty); mmx.stroke();
    mmx.fillStyle = "#7dd3fc"; mmx.beginPath(); mmx.arc(camx, camy, 2.6, 0, 6.283); mmx.fill();
  }
  function flyToTarget(pos: number[], radius: number) {
    cancelTrailer(); cam.autoRotate = false; cam.flight = null;
    const target = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const fromPos = camera.position.clone(), fromTarget = cam.target.clone();
    const toTheta = Math.atan2(fromPos.x - target.x, fromPos.z - target.z);
    cam.flight = {
      t: 0, dur: 1.1, fromPos, fromTarget, toTarget: target,
      toRadius: THREE.MathUtils.clamp(radius, cam.minR, cam.maxR), toTheta, toPhi: THREE.MathUtils.clamp(cam.phi, 0.2, Math.PI - 0.2),
    };
  }
  if (mm) {
    mm.addEventListener("click", (e) => {
      if (!G) return;
      const rect = mm.getBoundingClientRect(), W = mm.width, H = mm.height;
      const px = (e.clientX - rect.left) / rect.width * W, py = (e.clientY - rect.top) / rect.height * H;
      const R = mmBounds() * 1.06, s = (Math.min(W, H) / 2 - 6) / R * mmScale, cx = W / 2, cy = H / 2;
      const wx = (px - cx) / s + mmOffsetX, wz = (py - cy) / s + mmOffsetZ;
      let best: any = null, bd = Infinity;
      for (const n of G.nodes) { if (n.__hidden) continue; const dx = n.position[0] - wx, dz = n.position[2] - wz, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = n; } }
      if (!best) return;
      const r = best.role === "cluster" ? Math.max(overviewRadius * 0.5, sceneRadius * 0.95)
        : best.role === "galaxy" ? (best.__extent ? best.__extent * 2.4 : sceneRadius * 0.35)
        : best.role === "star" ? 26
        : best.role === "planet" ? 14 : 12;
      flyToTarget(best.position, r);
      if (best.role && best.role !== "hidden" && best.kind !== "folder") { selectedId = best.id; showInspector(best.id); applyHighlight(); }
      else { selectedId = null; applyHighlight(); }
    });
    mm.addEventListener("wheel", (e) => { e.preventDefault(); mmScale = THREE.MathUtils.clamp(mmScale * (e.deltaY < 0 ? 1.1 : 0.9), 0.4, 4); }, { passive: false });
    mm.addEventListener("contextmenu", (e) => e.preventDefault());
    mm.addEventListener("mousedown", (e) => { if (e.button !== 2) return; e.preventDefault(); mmPan = { x: e.clientX, y: e.clientY }; });
    window.addEventListener("mousemove", (e) => {
      if (!mmPan || !mm) return;
      const rect = mm.getBoundingClientRect(), W = mm.width;
      const R = mmBounds() * 1.06, s = (Math.min(W, mm.height) / 2 - 6) / R * mmScale;
      const wpp = (W / rect.width) / s;
      mmOffsetX -= (e.clientX - mmPan.x) * wpp; mmOffsetZ -= (e.clientY - mmPan.y) * wpp; mmPan = { x: e.clientX, y: e.clientY };
      const lim = mmBounds() * 1.3; mmOffsetX = THREE.MathUtils.clamp(mmOffsetX, -lim, lim); mmOffsetZ = THREE.MathUtils.clamp(mmOffsetZ, -lim, lim);
    });
    window.addEventListener("mouseup", (e) => { if (e.button === 2) mmPan = null; });
    mm.addEventListener("dblclick", () => { mmOffsetX = 0; mmOffsetZ = 0; mmScale = 1; });
  }

  /* ---- playback: growth (genesis) + timeline (history) ---- */
  let playback: any = null, savedHidden: any = null;
  function fileChrono() { return G.nodes.filter((n: any) => n.kind === "file").slice().sort((a: any, b: any) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)).map((n: any) => n.id); }
  const _RR: any = { cluster: 0, galaxy: 1, star: 2, planet: 3, moon: 4, moonlet: 5, asteroid: 6, oort: 7 };
  function roleRank(b: string) { return _RR[b] == null ? 8 : _RR[b]; }
  function growOrder() {
    if (G.__cosmos) {
      return nodeRender.map((r) => r.node).filter((n) => n.id !== G.clusterId)
        .sort((a, b) => (roleRank(a.body) - roleRank(b.body)) || (+new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)))
        .map((n) => n.id);
    }
    return fileChrono();
  }
  function setPlayBtn(mode: string, on: boolean) { const b = document.getElementById(mode === "grow" ? "growBtn" : "timelineBtn"); if (b) b.classList.toggle("on", on); }
  function startGrowth() {
    stopPlayback();
    savedHidden = new Map(nodeRender.map((r) => [r.node.id, !!r.node.__hidden]));
    const keepIds = G.__cosmos ? new Set([G.clusterId]) : new Set(["folder:."]);
    for (const r of nodeRender) { const show = keepIds.has(r.node.id); r.node.__hidden = !show; r.layer.attrs.aVisible.setX(r.idx, show ? 1 : 0); }
    for (const b in layers) layers[b].attrs.aVisible.needsUpdate = true; applyAmbientVisibility();
    playback = { mode: "grow", order: growOrder(), i: 0, t: 0, speed: 1 }; setPlayBtn("grow", true); clearFocus(); setMode("overview");
  }
  function startTimeline() {
    stopPlayback(); applyFilters();
    let order = G.nodes.filter((n: any) => n.kind === "file" && !isHidden(n.id)).slice().sort((a: any, b: any) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0)).map((n: any) => n.id);
    if (order.length < 2) order = nodeRender.map((r) => r.node.id);
    order = order.slice(-Math.min(20, Math.max(2, order.length)));
    playback = { mode: "timeline", order, i: 0, t: 0, speed: 1, _last: null }; setPlayBtn("timeline", true);
  }
  function stopPlayback() {
    if (playback && playback.mode === "grow" && savedHidden) {
      for (const r of nodeRender) { const h = savedHidden.get(r.node.id) || false; r.node.__hidden = h; r.layer.attrs.aVisible.setX(r.idx, h ? 0 : 1); }
      for (const b in layers) layers[b].attrs.aVisible.needsUpdate = true; applyAmbientVisibility();
    }
    savedHidden = null; playback = null; setPlayBtn("grow", false); setPlayBtn("timeline", false); reseedLive();
  }
  function advancePlayback(dt: number) {
    if (!playback) return; playback.t += dt * playback.speed;
    if (playback.mode === "grow") {
      const step = 0.14;
      while (playback.i < playback.order.length && playback.t >= playback.i * step) {
        const id = playback.order[playback.i]; const r = idToRender.get(id);
        if (r) { r.node.__hidden = false; r.layer.attrs.aVisible.setX(r.idx, 1); r.layer.attrs.aVisible.needsUpdate = true; emergingIds = new Set([id]); applyLive(); }
        playback.i++;
      }
      applyAmbientVisibility();
      if (playback.i >= playback.order.length && playback.t > playback.order.length * step + 1) { emergingIds = new Set(); applyLive(); stopPlayback(); }
    } else {
      const step = 0.95; const idx = Math.floor(playback.t / step);
      if (idx < playback.order.length) {
        const id = playback.order[idx];
        if (playback._last !== id) {
          playback._last = id; selectedId = id; liveIds = new Set([id]); primaryLiveId = id; applyLive(); applyHighlight(); showInspector(id);
          const fn = G.nodeById.get(id);
          if (fn) { cam.tTarget.set(fn.position[0], fn.position[1], fn.position[2]); cam.tRadius = G.__cosmos ? (MOBILE ? 22 : 30) : (MOBILE ? 40 : 50); cam.autoRotate = false; }
        }
      } else stopPlayback();
    }
  }
  const growBtn = document.getElementById("growBtn"), timelineBtn = document.getElementById("timelineBtn");
  if (growBtn) growBtn.addEventListener("click", () => { (playback && playback.mode === "grow") ? stopPlayback() : startGrowth(); });
  if (timelineBtn) timelineBtn.addEventListener("click", () => { (playback && playback.mode === "timeline") ? stopPlayback() : startTimeline(); });
  const legendToggle = document.getElementById("legendToggle");
  if (legendToggle) legendToggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("legend-open");
    legendToggle.classList.toggle("on", open);
    legendToggle.setAttribute("aria-pressed", String(open));
  });
  const trailerBtn = document.getElementById("trailerBtn");
  if (trailerBtn) trailerBtn.addEventListener("click", () => { trailer ? stopTrailer() : startTrailer(false); });

  /* ---- live seeding (events) ---- */
  const params = new URLSearchParams(location.search);
  let allEvents: any[] = [];
  function reseedLive() {
    const recent = allEvents.slice(-6);
    liveIds = new Set(recent.map((e) => `file:${e.path}`).filter((id) => idToRender.has(id)));
    primaryLiveId = allEvents.length ? `file:${allEvents[allEvents.length - 1].path}` : null;
    if (!idToRender.has(primaryLiveId)) primaryLiveId = null;
    applyLive(); applyHighlight();
  }
  // null = no host connectivity probe has reported yet (demo / standalone snapshot).
  // Once a probe reports, it OWNS the dot colour; setConn's live/demo colour yields.
  let vaultConnected: boolean | null = null;
  function paintVaultDot() {
    if (vaultConnected === null) return;
    const d = document.querySelector(".brand .dot"); if (d) (d as HTMLElement).style.background = vaultConnected ? "#34d399" : "#f87171";
    const badge = document.getElementById("vaultBadge");
    if (badge) badge.setAttribute("title", vaultConnected
      ? (LANG === "de" ? "Vault verbunden" : "Vault connected")
      : (LANG === "de" ? "Vault nicht erreichbar" : "Vault unreachable"));
  }
  function setVaultStatus(connected: boolean) { vaultConnected = !!connected; paintVaultDot(); }
  function setConn(txt: string, live: boolean) {
    const l = document.getElementById("connlbl"); if (l) l.textContent = txt;
    if (vaultConnected === null) { const d = document.querySelector(".brand .dot"); if (d) (d as HTMLElement).style.background = live ? "#34d399" : "#fbbf24"; }
    else paintVaultDot();
  }
  function onLiveEvent(msg: any) {
    const ev = msg && msg.event ? msg.event : msg; if (!ev || !ev.path) return;
    const id = "file:" + ev.path; if (!idToRender.has(id)) return;
    liveIds.add(id); primaryLiveId = id; if (ev.type === "add") emergingIds.add(id); applyLive(); updateHalos();
    setTimeout(() => { liveIds.delete(id); emergingIds.delete(id); applyLive(); updateHalos(); }, 9000);
  }
  /* ---- live AI-agent traversal overlay (breadcrumb + emerald glow) ---- */
  function ensureAgentTrail() {
    if (agentTrail) return agentTrail;
    const cap = AGENT_MAX;
    const geo = keep(new THREE.BufferGeometry());
    const pos = new Float32Array(cap * 6), col = new Float32Array(cap * 6);
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage); geo.setAttribute("position", pa);
    const ca = new THREE.BufferAttribute(col, 3); ca.setUsage(THREE.DynamicDrawUsage); geo.setAttribute("color", ca);
    geo.setDrawRange(0, 0);
    const mat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const mesh = new THREE.LineSegments(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 3;
    world.add(mesh);
    agentTrail = { geo, pos, col, cap, mesh };
    return agentTrail;
  }
  /** GPU point pool for the comet tail and residual snow-dust. Particles are
   * bounded, reused in a ring, and never allocate in the render loop. */
  function ensureAgentDust(): any {
    if (agentDust) return agentDust;
    const cap = AGENT_DUST_CAP, geo = keep(new THREE.BufferGeometry());
    const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), alpha = new Float32Array(cap), size = new Float32Array(cap);
    const vel = new Float32Array(cap * 3), born = new Float64Array(cap), die = new Float64Array(cap);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = keep(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aAlpha; attribute float aSize; varying vec3 vColor; varying float vAlpha;
        void main(){ vColor=color; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*clamp(260.0/max(8.0,-mv.z),0.65,3.6); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ vec2 q=gl_PointCoord-vec2(.5); float r=length(q); if(r>.5)discard; float core=smoothstep(.5,.05,r); float halo=smoothstep(.5,.22,r); gl_FragColor=vec4(vColor,vAlpha*(core*.72+halo*.28)); }`,
    }));
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 4; world.add(points);
    agentDust = { cap, geo, pos, col, alpha, size, vel, born, die, points, cursor: 0, active: 0 };
    return agentDust;
  }
  function emitAgentDust(x:number,y:number,z:number,agent:string,now:number,life:number,size:number,vx:number,vy:number,vz:number):void {
    const D=ensureAgentDust(), i=D.cursor; D.cursor=(i+1)%D.cap; const o=i*3, c=agentColor(agent).rgb;
    D.pos[o]=x; D.pos[o+1]=y; D.pos[o+2]=z; D.vel[o]=vx; D.vel[o+1]=vy; D.vel[o+2]=vz;
    D.col[o]=Math.min(1,c[0]*1.15+.08); D.col[o+1]=Math.min(1,c[1]*1.15+.08); D.col[o+2]=Math.min(1,c[2]*1.15+.08);
    D.alpha[i]=1; D.size[i]=size; D.born[i]=now; D.die[i]=now+life; D.active=Math.min(D.cap,D.active+1);
  }
  function burstAgentDust(prevId:string|null,id:string,agent:string,now:number):void {
    const b=idToRender.get(id)?.node?.position; if(!b)return; const a=prevId?idToRender.get(prevId)?.node?.position:null;
    const burst=LOWPOWER?5:11;
    for(let i=0;i<burst;i++){const j=(i+.5)/burst,ang=i*2.399963,r=.22+(i%4)*.13; emitAgentDust(b[0]+Math.cos(ang)*r,b[1]+((i%3)-1)*.18,b[2]+Math.sin(ang)*r,agent,now,9000+(i%5)*1700,LOWPOWER?3.2:4.6,Math.cos(ang)*.055,-.025-(i%3)*.012,Math.sin(ang)*.055);}
    if(!a)return; const count=LOWPOWER?8:22,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
    for(let i=0;i<count;i++){const u=(i+1)/(count+1),jitter=((i*17)%11-5)*.018,ang=i*2.399963; emitAgentDust(a[0]+dx*u+Math.cos(ang)*jitter,a[1]+dy*u+Math.sin(ang)*jitter,a[2]+dz*u+Math.cos(ang*.7)*jitter,agent,now,6000+(1-u)*9000,LOWPOWER?2.8:4.1,-dx*.004,-.018-Math.abs(dy)*.001,-dz*.004);}
  }
  function updateAgentDust(dt:number,now:number):void {
    if(!agentDust&&!agentSteps.length)return;
    if(agentSteps.length&&now-__agentDustHeadT>AGENT_DUST_HEAD_MS){__agentDustHeadT=now;const heads=new Map<string,any>();for(const s of agentSteps)if(now-s.t<8000)heads.set(s.agent,s);for(const s of heads.values()){const p=idToRender.get(s.id)?.node?.position;if(p)emitAgentDust(p[0]+(Math.random()-.5)*.32,p[1]+(Math.random()-.5)*.32,p[2]+(Math.random()-.5)*.32,s.agent,now,4200+Math.random()*3600,LOWPOWER?2.6:3.8,(Math.random()-.5)*.035,-.018-Math.random()*.025,(Math.random()-.5)*.035);}}
    const D=agentDust;if(!D)return;let active=0;
    for(let i=0;i<D.cap;i++){if(D.die[i]<=now){D.alpha[i]=0;continue;}const life=D.die[i]-D.born[i],age=now-D.born[i],f=Math.max(0,1-age/life),o=i*3;D.pos[o]+=D.vel[o]*dt;D.pos[o+1]+=D.vel[o+1]*dt;D.pos[o+2]+=D.vel[o+2]*dt;D.vel[o]*=.998;D.vel[o+2]*=.998;D.alpha[i]=f*f;active++;}
    D.active=active;D.geo.attributes.position.needsUpdate=true;D.geo.attributes.aAlpha.needsUpdate=true;
  }
  /** Fading emerald breadcrumb of the last hops an AI agent made through the vault (Agent API). */
  function updateAgentTrail(): void {
    if (!agentSteps.length) { if (agentTrail) agentTrail.geo.setDrawRange(0, 0); updateAgentMarkers(); return; }
    const now = performance.now();
    agentSteps = agentSteps.filter((s) => now - s.t < AGENT_TRAIL_MS && idToRender.has(s.id));
    refreshAgentLive(now);
    if (agentSteps.length < 2) { if (agentTrail) agentTrail.geo.setDrawRange(0, 0); updateAgentMarkers(); return; }
    const T = ensureAgentTrail(); let v = 0;
    for (let i = 1; i < agentSteps.length && v < T.cap; i++) {
      // only connect consecutive hops made by the SAME agent, so two agents
      // never get a spurious line drawn between their notes
      if (agentSteps[i - 1].agent !== agentSteps[i].agent) continue;
      const a = idToRender.get(agentSteps[i - 1].id), b = idToRender.get(agentSteps[i].id);
      if (!a || !b) continue;
      const f = 1 - Math.min(1, (now - agentSteps[i].t) / AGENT_TRAIL_MS) * 0.85, o = v * 6, pa = a.node.position, pb = b.node.position;
      const [cr, cg, cb] = agentColor(agentSteps[i].agent).rgb;
      T.pos[o] = pa[0]; T.pos[o + 1] = pa[1]; T.pos[o + 2] = pa[2]; T.pos[o + 3] = pb[0]; T.pos[o + 4] = pb[1]; T.pos[o + 5] = pb[2];
      T.col[o] = cr * f; T.col[o + 1] = cg * f; T.col[o + 2] = cb * f; T.col[o + 3] = cr * f; T.col[o + 4] = cg * f; T.col[o + 5] = cb * f;
      v++;
    }
    T.geo.attributes.position.needsUpdate = true; T.geo.attributes.color.needsUpdate = true; T.geo.setDrawRange(0, v * 2);
    updateAgentMarkers();
  }
  /** Ensure a small pool of DOM markers (rocket glyph + name span) exists. */
  function ensureAgentMarkers(): void {
    if (agentMarkers.length || !labelHost) return;
    for (let i = 0; i < MAX_AGENTS_SHOWN; i++) {
      const el = document.createElement("div"); el.className = "agent-marker"; el.style.opacity = "0";
      const rocket = document.createElement("span"); rocket.className = "agent-rocket"; rocket.textContent = "🚀"; // 🚀
      const name = document.createElement("span"); name.className = "agent-name";
      el.appendChild(rocket); el.appendChild(name); labelHost.appendChild(el);
      agentMarkers.push({ el, rocket, name, agent: null });
    }
  }
  /** Place one rocket at the head (most recent hop) of each active agent's
   *  trail, tinted to the agent's colour; the name span shows only when labels
   *  are toggled on. */
  function updateAgentMarkers(): void {
    ensureAgentMarkers();
    if (!agentMarkers.length) return;
    const now = performance.now();
    // newest hop per agent over the trail lifetime (rocket rides the head of
    // each agent's trail and fades with it); newest agents first, capped
    const headByAgent = new Map<string, { id: string; t: number; agent: string }>();
    for (const s of agentSteps) { if (now - s.t > AGENT_TRAIL_MS || !idToRender.has(s.id)) continue; headByAgent.set(s.agent, s); }
    const heads = Array.from(headByAgent.values()).sort((a, b) => b.t - a.t).slice(0, MAX_AGENTS_SHOWN);
    let mi = 0;
    for (const s of heads) {
      const r = idToRender.get(s.id); if (!r) continue;
      const sp = projectToScreen(r.node.position); if (!sp) continue;
      const fade = 1 - Math.min(1, (now - s.t) / AGENT_TRAIL_MS) * 0.75;
      const m = agentMarkers[mi++]; const col = agentColor(s.agent);
      m.agent = s.agent;
      m.rocket.style.color = col.css; m.rocket.style.textShadow = `0 0 6px ${col.css}`;
      if (m.name.textContent !== s.agent) m.name.textContent = s.agent;
      m.name.style.color = col.css; m.name.style.borderColor = col.css + "66";
      m.name.style.display = labelsEnabled ? "" : "none";
      m.el.style.transform = `translate(-50%,-140%) translate(${sp.x.toFixed(1)}px,${sp.y.toFixed(1)}px)`;
      m.el.style.opacity = fade.toFixed(2);
    }
    for (; mi < agentMarkers.length; mi++) { agentMarkers[mi].el.style.opacity = "0"; agentMarkers[mi].agent = null; }
  }
  /** Notes visited in the last 8 s pulse live (emerald halos via agentIds); diffed to skip redundant uploads. */
  function refreshAgentLive(now: number): void {
    const want = new Set<string>();
    for (const s of agentSteps) if (now - s.t < 8000) want.add(s.id);
    let same = want.size === __agentLive.size;
    if (same) for (const id of want) if (!__agentLive.has(id)) { same = false; break; }
    if (same) { let ok = true; for (const id of want) if (!liveIds.has(id)) { ok = false; break; } if (ok) return; }
    for (const id of __agentLive) { liveIds.delete(id); agentIds.delete(id); }
    __agentLive = want;
    for (const id of want) { liveIds.add(id); agentIds.add(id); }
    applyLive(); updateHalos();
  }
  /** Entry point: the host posts agent-traversal whenever the Agent API serves a query. */
  function notifyAgentTraversal(paths: string[], tool: string, agent?: string): void {
    if (!Array.isArray(paths) || !G) return;
    const who = String(agent || "").trim() || DEFAULT_AGENT;
    const now = performance.now(); let touched = false;
    for (const p of paths) {
      const id = "file:" + String(p || "").replace(/\\/g, "/");
      if (!idToRender.has(id)) continue;
      // Find this agent's own head so interleaved agents retain independent
      // comet segments and never connect to somebody else's traversal.
      let last:any=null; for(let i=agentSteps.length-1;i>=0;i--)if(agentSteps[i].agent===who){last=agentSteps[i];break;}
      if (last && last.id === id && last.agent === who) { last.t = now; touched = true; continue; }
      burstAgentDust(last?.id??null,id,who,now);
      agentSteps.push({ id, t: now, agent: who }); touched = true;
      if (agentSteps.length > AGENT_MAX + 1) agentSteps.splice(0, agentSteps.length - (AGENT_MAX + 1));
    }
    if (!touched) return;
    refreshAgentLive(now); updateAgentTrail();
    const label = who === DEFAULT_AGENT ? "Agent traversal" : who + " traversal";
    if (now - __agentHintT > 4000) { __agentHintT = now; showHint(label + ": " + (tool || "query")); }
  }
  function runCapture() {
    const cap = params.get("capture"); if (!cap) return; document.body.classList.add("capture");
    // Legacy cinematic capture presets.
    if (cap === "focus") { if (primaryLiveId) selectNode(primaryLiveId, true); setTimeout(() => setMode("focus"), 320); return; }
    if (cap === "timeline") { startTimeline(); return; }
    if (cap === "trailer") { startTrailer(true); return; }
    // Deterministic visual-regression capture (capture=1 or a named camera preset):
    // freeze the camera to a preset, kill auto-rotate/flight so the frame is static.
    cam.autoRotate = false; cam.flight = null;
    const preset = CAPTURE.camera;
    if (preset === "focus" || preset === "deep") {
      const star = topBodies("star", 1)[0] || topBodies("galaxy", 1)[0];
      if (star) { selectedId = star.id; applyHighlight(); showInspector(star.id); cam.target.set(star.position[0], star.position[1], star.position[2]); cam.tTarget.copy(cam.target); cam.radius = cam.tRadius = preset === "deep" ? 20 : 44; }
    } else {
      cam.target.set(0, 4, 0); cam.tTarget.set(0, 4, 0); cam.radius = cam.tRadius = overviewRadius;
    }
    applyCamera();
  }

  /* ---- mobile fly pad (translate) + drag-to-look ---- */
  let padVec = { x: 0, y: 0 }, padActive = false, lookLast: any = null;
  (function setupPad() {
    const pad = document.getElementById("flyPad"); if (!pad) return;
    const stick = document.getElementById("flyStick");
    const move = (e: PointerEvent) => {
      if (!padActive) return;
      const r = pad.getBoundingClientRect();
      padVec.x = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      padVec.y = THREE.MathUtils.clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      if (stick) stick.style.transform = "translate(" + (padVec.x * 20).toFixed(0) + "px," + (padVec.y * 20).toFixed(0) + "px)";
    };
    pad.addEventListener("pointerdown", (e) => { padActive = true; move(e); });
    pad.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => { padActive = false; padVec.x = 0; padVec.y = 0; lookLast = null; if (stick) stick.style.transform = "translate(0,0)"; });
    const up = document.getElementById("flyUp"), dn = document.getElementById("flyDn");
    if (up) { up.addEventListener("pointerdown", () => flyKeys.add("KeyE")); up.addEventListener("pointerup", () => flyKeys.delete("KeyE")); }
    if (dn) { dn.addEventListener("pointerdown", () => flyKeys.add("KeyC")); dn.addEventListener("pointerup", () => flyKeys.delete("KeyC")); }
  })();

  /* ---- body separation (legacy layout only) ---- */
  function separateBodies() {
    const list = G.nodes, n = list.length; if (n < 2) return;
    let pin: any = null;
    for (const x of list) { if (x.body === "star" && x.depth === 0) { pin = x; break; } }
    if (!pin) pin = list[0];
    let maxR = 0; for (const x of list) maxR = Math.max(maxR, x.__r || 0.5);
    const gapOf = (a: any, b: any) => Math.max(0.8, 0.16 * ((a.__r || 0.5) + (b.__r || 0.5)));
    const cell = 2 * maxR + 2.0, grid = new Map<string, number[]>(), key = (x: number, y: number, z: number) => x + "," + y + "," + z;
    const ITER = MOBILE ? 7 : 11;
    for (let it = 0; it < ITER; it++) {
      grid.clear();
      for (let i = 0; i < n; i++) {
        const p = list[i].position; const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
        const k = key(gx, gy, gz); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
        list[i].__gx = gx; list[i].__gy = gy; list[i].__gz = gz;
      }
      let movedAny = false;
      for (let i = 0; i < n; i++) {
        const a = list[i], ap = a.position, ar = a.__r || 0.5;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(key(a.__gx + dx, a.__gy + dy, a.__gz + dz)); if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const b = list[j], bp = b.position, br = b.__r || 0.5;
            let vx = bp[0] - ap[0], vy = bp[1] - ap[1], vz = bp[2] - ap[2];
            const need = ar + br + gapOf(a, b); const d2 = vx * vx + vy * vy + vz * vz;
            if (d2 >= need * need) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-3) { vx = hashUnitLocal(a.id + "x") - 0.5; vy = hashUnitLocal(b.id + "y") - 0.5; vz = hashUnitLocal(a.id + b.id) - 0.5; d = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1; }
            const push = (need - d) * 0.5, ux = vx / d, uy = vy / d, uz = vz / d, wa = br / (ar + br), wb = ar / (ar + br);
            if (a !== pin) { ap[0] -= ux * push * wa; ap[1] -= uy * push * wa; ap[2] -= uz * push * wa; }
            if (b !== pin) { bp[0] += ux * push * wb; bp[1] += uy * push * wb; bp[2] += uz * push * wb; }
            movedAny = true;
          }
        }
      }
      if (!movedAny) break;
    }
  }

  function fitCamera() {
    let m = 40;
    for (const nd of G.nodes) { const p = nd.position; if (!p) continue; const d = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) + (nd.__r || 0); if (d > m) m = d; }
    sceneRadius = m;
    overviewRadius = THREE.MathUtils.clamp(m * 2.35, MOBILE ? 120 : 150, 1500);
    if (G.__cosmos) {
      const h = window.innerHeight || 800, w = window.innerWidth || 1200, minDim = Math.min(w, h);
      const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
      const Dmax = (h * sceneRadius) / (0.10 * minDim * tan);
      cam.maxR = Math.max(overviewRadius * 1.1, Dmax);
      const need = Dmax + sceneRadius + 80; if (camera.far < need) { camera.far = need; camera.updateProjectionMatrix(); }
    } else {
      cam.maxR = Math.max(1800, m * 5);
    }
    if (!(fitCamera as any)._done) { cam.radius = cam.tRadius = overviewRadius; cam.target.set(0, 4, 0); cam.tTarget.set(0, 4, 0); (fitCamera as any)._done = true; }
  }

  /* ---- LOD: per-instance frustum + projected-size culling (throttled) ---- */
  const _frustum = new THREE.Frustum(), _vpm = new THREE.Matrix4(), _miw = new THREE.Matrix4(), _sph = new THREE.Sphere();
  let lodScale = 1;
  function cullLOD() {
    if (playback) return;
    camera.updateMatrixWorld();
    _miw.copy(camera.matrixWorld).invert();
    _frustum.setFromProjectionMatrix(_vpm.multiplyMatrices(camera.projectionMatrix, _miw));
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const minPx: any = { cluster: 0, galaxy: 0, star: 0, planet: 0.5, moon: 0.9, moonlet: 1.2, asteroid: 1.3, oort: 1.4 };
    const touched: any = {};
    for (const r of nodeRender) {
      const n = r.node; if (n.__hidden) continue;
      const keepForce = (showAllObjects || n.id === selectedId || n.id === hoveredId || liveIds.has(n.id));
      let vis = true;
      if (!keepForce) {
        const p = n.position; _sph.center.set(p[0], p[1], p[2]); _sph.radius = (n.__r || 0.5) * 2.2 + 1.0;
        if (!_frustum.intersectsSphere(_sph)) vis = false;
        else {
          const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, px = (n.__r || 0.5) / dist * focalH;
          if (px < (minPx[r.body] || 1) * lodScale) vis = false;
        }
      }
      if (vis !== (n.__lodVisible !== false)) { n.__lodVisible = vis; r.layer.attrs.aVisible.setX(r.idx, (vis && !n.__hidden) ? 1 : 0); touched[r.body] = 1; }
    }
    for (const b in touched) if (layers[b]) layers[b].attrs.aVisible.needsUpdate = true;
  }

  /* ---- cinematic trailer flight ---- */
  let trailer: any = null;
  function centroidOfBusiestArea() {
    const areas: any = {};
    for (const n of G.nodes) { if (n.kind !== "file") continue; const a = areas[n.area] || (areas[n.area] = { c: 0, x: 0, y: 0, z: 0 }); a.c++; a.x += n.position[0]; a.y += n.position[1]; a.z += n.position[2]; }
    let best: any = null;
    for (const k in areas) { const a = areas[k]; if (!best || a.c > best.c) best = a; }
    return best && best.c ? new THREE.Vector3(best.x / best.c, best.y / best.c, best.z / best.c) : new THREE.Vector3(0, 4, 0);
  }
  function topBodies(kind: string, count: number) { return G.nodes.filter((n: any) => n.body === kind && !n.__hidden).sort((a: any, b: any) => (b.__r || 0) - (a.__r || 0)).slice(0, count); }
  function wp(target: any, radius: number, phi: number, thetaOff: number, dur: number, spin: number) {
    const t = target.clone ? target.clone() : new THREE.Vector3(target[0], target[1], target[2]);
    return { target: t, radius, phi, thetaOff, dur, spin };
  }
  // First-level-folder galaxies (graph.galaxies from cosmology.ts), resolved to
  // their center nodes, largest first — the "major galaxies" the trailer tours.
  function trailerGalaxyCenters(): any[] {
    return (G.galaxies || [])
      .map((g: any) => G.nodeById.get(g.center))
      .filter((n: any) => n && n.position && !n.__hidden)
      .sort((a: any, b: any) => (b.__extent || b.__r || 0) - (a.__extent || a.__r || 0));
  }
  function buildTrailerSegs() {
    const segs: any[] = [], O = new THREE.Vector3(0, 4, 0);
    const SR = (isFinite(sceneRadius) && sceneRadius > 1) ? sceneRadius : 60;
    segs.push(wp(O, SR * 2.9, 0.62, 0.0, 3.6, 0.05)); // opening wide shot
    const centers = trailerGalaxyCenters();
    if (centers.length) {
      // fly nearby each major galaxy so the viewer gets a whole-vault overview
      const MAX_TOUR = 16;
      centers.slice(0, MAX_TOUR).forEach((c: any) => {
        const ext = c.__extent || (c.__r || 2) * 6;
        const j = hashUnitLocal(c.id + ":trailer");
        const radius = Math.max(24, ext * 2.2);
        const phi = 0.90 + j * 0.5;
        const thetaOff = 0.8 + j * 2.4;
        segs.push(wp(VEC.fromArray(c.position).clone(), radius, phi, thetaOff, 2.4, 0.10 + j * 0.08));
      });
    } else {
      // legacy (non-cosmos) layout: fall back to a star + a few planets
      const stars = topBodies("star", 1), planets = topBodies("planet", 3);
      const anchor = stars[0] || topBodies("galaxy", 1)[0] || topBodies("cluster", 1)[0] || null;
      const focus = anchor ? VEC.fromArray(anchor.position).clone() : O;
      segs.push(wp(focus, Math.max(22, (anchor ? anchor.__r : 8) * 9), 1.12, 1.4, 3.2, 0.10));
      for (const p of planets) segs.push(wp(VEC.fromArray(p.position).clone(), Math.max(14, (p.__r || 2) * 7), 1.0, 2.0, 2.4, 0.14));
      segs.push(wp(centroidOfBusiestArea(), Math.max(SR * 0.9, 28), 1.28, 1.2, 3.0, 0.18));
    }
    segs.push(wp(O, SR * 2.5, 0.7, 0.0, 4.0, 0.06)); // closing pullback
    return segs;
  }
  function startTrailer(loop: boolean) {
    stopPlayback(); exitFly(); cam.flight = null; cam.autoRotate = false; selectedId = null; applyHighlight();
    navMode = "overview"; document.querySelectorAll("#modes button").forEach((b: any) => b.classList.toggle("on", b.dataset.mode === "overview"));
    syncSphFromCamera();
    trailer = { segs: buildTrailerSegs(), seg: 0, t: 0, loop: !!loop, from: { theta: cam.theta, phi: cam.phi, radius: cam.radius, target: cam.target.clone() } };
    const tb = document.getElementById("trailerBtn"); if (tb) tb.classList.add("on");
    if (!params.get("capture")) showHint(LANG === "de" ? "Trailer läuft — tippen oder Esc zum Beenden" : "Trailer playing — tap or press Esc to exit");
  }
  function stopTrailer() { if (!trailer) return; trailer = null; const tb = document.getElementById("trailerBtn"); if (tb) tb.classList.remove("on"); syncSphFromCamera(); cam.autoRotate = !selectedId; }
  function cancelTrailer() { if (trailer) stopTrailer(); }
  function updateTrailer(dt: number) {
    if (!trailer) return; const segs = trailer.segs, s = segs[trailer.seg]; if (!s) { stopTrailer(); return; }
    trailer.t = Math.min(1, trailer.t + dt / s.dur); const e = smoother(trailer.t), f = trailer.from;
    const toTheta = Math.atan2(f.target.x - s.target.x, f.target.z - s.target.z) + s.thetaOff;
    const theta = f.theta + (toTheta - f.theta) * e + s.spin * trailer.t;
    const phi = THREE.MathUtils.clamp(f.phi + (s.phi - f.phi) * e, 0.16, Math.PI - 0.16);
    const radius = f.radius + (s.radius - f.radius) * e;
    cam.target.lerpVectors(f.target, s.target, e); cam.theta = theta; cam.phi = phi; cam.radius = radius;
    const sp = Math.sin(phi);
    camera.position.set(cam.target.x + radius * sp * Math.sin(theta), cam.target.y + radius * Math.cos(phi), cam.target.z + radius * sp * Math.cos(theta));
    camera.lookAt(cam.target);
    if (trailer.t >= 1) {
      trailer.seg++; trailer.t = 0; trailer.from = { theta: cam.theta % (Math.PI * 2), phi: cam.phi, radius: cam.radius, target: cam.target.clone() };
      if (trailer.seg >= segs.length) { if (trailer.loop) trailer.seg = 0; else stopTrailer(); }
    }
  }

  /* ---- resize + render loop + explicit hidden-view suspension (§27) ---- */
  let focalH = 600;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    focalH = (h * 0.5) / Math.tan((camera.fov * Math.PI / 180) / 2);
  }
  window.addEventListener("resize", resize); resize();

  // FPS-adaptive pixel-ratio (keeps mobile smooth)
  let fpsAccum = 0, fpsFrames = 0, lastAdjust = 0;
  function adaptQuality(dt: number, now: number) {
    fpsAccum += dt; fpsFrames++;
    if (now - lastAdjust < 1.2) return;
    const fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; lastAdjust = now;
    const floor = LOWPOWER ? 0.75 : 1.0;
    if (fps < 42 && dpr > floor) { dpr = Math.max(floor, dpr - 0.25); renderer.setPixelRatio(dpr); }
    else if (fps > 58 && dpr < MAXDPR && lodScale <= 1) { dpr = Math.min(MAXDPR, dpr + 0.25); renderer.setPixelRatio(dpr); }
    if (fps < 30 && dpr <= floor + 0.001) lodScale = Math.min(2.4, lodScale + 0.3);
    else if (fps > 58 && lodScale > 1) lodScale = Math.max(1, lodScale - 0.3);
  }

  const clock = new THREE.Clock();
  let raf = 0, mmFrame = 0, lodFrame = 0, linkFrame = 0;
  const renderStats = { frames: 0, running: false };
  function frame() {
    raf = requestAnimationFrame(frame);
    renderStats.frames++;
    // Capture mode freezes shader time (uTime) and suppresses per-frame drift so
    // screenshots are deterministic; otherwise use the real elapsed clock.
    const dt = CAPTURE.frozen ? 0 : Math.min(clock.getDelta(), 0.05);
    const t = CAPTURE.frozen ? CAPTURE.time : clock.elapsedTime;
    for (const m of matsWithTime) {
      if (m.uniforms) {
        if (m.uniforms.uTime) m.uniforms.uTime.value = t;
        if (m.uniforms.uCamPos && m.uniforms.uCamPos.value && m.uniforms.uCamPos.value.set) m.uniforms.uCamPos.value.set(camera.position.x, camera.position.y, camera.position.z);
      }
    }
    if (G && G.__cosmos) {
      animateOrbits(t); updateInstancePositions(); updateHalos();
      if ((linkFrame = (linkFrame + 1) & 1) === 0) { updateCosmosLinks(); updateAgentTrail(); }   // link + agent-trail refresh every other frame (perf)
      if (selectedId) {
        const sr = idToRender.get(selectedId), sn = sr && sr.node;
        if (sn && sn.position) {
          if (cam.flight) cam.flight.toTarget.set(sn.position[0], sn.position[1], sn.position[2]);
          else cam.tTarget.set(sn.position[0], sn.position[1], sn.position[2]);
        }
      }
    }
    updateAgentDust(dt, performance.now());
    if (trailer) updateTrailer(dt);
    else if (navMode === "fly") updateFly(dt);
    else if (cam.flight) updateFlight(dt);
    else {
      if (cam.autoRotate && !selectedId && !dragging) cam.tTheta += dt * 0.05;
      const k = 1 - Math.exp(-dt * 7);
      cam.theta += (cam.tTheta - cam.theta) * k; cam.phi += (cam.tPhi - cam.phi) * k; cam.radius += (cam.tRadius - cam.radius) * k;
      if (G && G.__cosmos && cam.maxR > 0) { const f = THREE.MathUtils.clamp((cam.radius - cam.maxR * 0.6) / (cam.maxR * 0.4), 0, 1); if (f > 0) cam.tTarget.lerp(ZERO3, f * 0.1); }
      cam.target.lerp(cam.tTarget, k); applyCamera();
    }
    advancePlayback(dt);
    doHover();
    updateLabels(t);
    if ((mmFrame = (mmFrame + 1) & 3) === 0) drawMinimap();
    if ((lodFrame = (lodFrame + 1) & 7) === 0) cullLOD();
    adaptQuality(dt, t);
    renderer.render(scene, camera);
  }
  function startLoop() {
    if (renderStats.running) return;
    renderStats.running = true;
    clock.getDelta(); // swallow the hidden interval so dt stays sane
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (!renderStats.running) return;
    renderStats.running = false;
    cancelAnimationFrame(raf);
  }
  // §27: the render loop fully stops while the view is hidden — either the
  // document (tab/window) or the hosting Obsidian LEAF. Inside Obsidian,
  // document.visibilitychange only fires for the whole window, so the host
  // posts a `visibility` message on leaf/layout changes (v0.5.1 behavior).
  let hostHidden = false;
  function syncPaused(): void {
    if (document.visibilityState === "hidden" || hostHidden) stopLoop();
    else if (__framed) startLoop();
  }
  const onVisibility = () => syncPaused();
  document.addEventListener("visibilitychange", onVisibility);
  function setHostVisible(visible: boolean): void {
    hostHidden = visible === false;
    syncPaused();
  }

  // WebGL2 context loss/restore (§11): stop cleanly and rebuild GPU resources on
  // restore rather than leaving a frozen canvas. GL context loss can happen on
  // GPU reset, tab backgrounding on mobile, or driver hiccups.
  let contextLost = false;
  const onContextLost = (e: Event) => {
    e.preventDefault(); // required so the browser will fire 'restored'
    contextLost = true;
    stopLoop();
    if (bootMsg && boot) { boot.classList.remove("gone"); if (bootRing) (bootRing as HTMLElement).style.display = "none"; bootMsg.className = ""; bootMsg.textContent = "Graphics context lost — recovering…"; }
  };
  const onContextRestored = () => {
    contextLost = false;
    try {
      if (G) buildScene(G);            // re-upload geometries/materials/instanced buffers
      if (boot) boot.classList.add("gone");
      if (__framed) startLoop();
    } catch (err) {
      showFatal("Could not recover the 3D view after a graphics context loss — reload the view.");
    }
  };
  dom.addEventListener("webglcontextlost", onContextLost, false);
  dom.addEventListener("webglcontextrestored", onContextRestored, false);

  (window as any).__kosmosRenderStats = renderStats;
  (window as any).__kosmosRenderer = { backend: RENDERER_BACKEND, threeRevision: RENDERER_THREE_REVISION };

  function teardown() {
    stopLoop();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    dom.removeEventListener("pointerdown", onDown); dom.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp); dom.removeEventListener("pointercancel", onUp);
    dom.removeEventListener("wheel", onWheel); dom.removeEventListener("click", onClick);
    dom.removeEventListener("contextmenu", onCtxMenu);
    dom.removeEventListener("webglcontextlost", onContextLost);
    dom.removeEventListener("webglcontextrestored", onContextRestored);
    window.removeEventListener("click", onWinClick); window.removeEventListener("keydown", onEscMenu);
    window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp);
    disposeAll(); renderer.dispose();
  }
  window.addEventListener("beforeunload", teardown);
  window.addEventListener("pagehide", teardown);

  /* ---- bootstrap ---- */
  function buildDemo() {
    const now = Date.now();
    const graph = createDemoVaultGraph(now);
    allEvents = createDemoVaultEvents(now);
    buildScene(positionFrom(graph)); reseedLive(); setConn("Demo vault", false);
    __prevSig = graphSignature(G);
  }
  let __framed = false;
  function ensureFrame() {
    if (__framed) return; __framed = true; applyCamera(); startLoop();
    setTimeout(() => { if (boot) boot.classList.add("gone"); }, 200);
  }

  /* ---- tiered graph updates (§11) ----
     topology changed (nodes/links differ)     -> warm relayout + rebuild
     only area/color differ (rare)             -> warm relayout + rebuild
     only tags/status/type/label/time differ   -> refresh filters in place
     nothing in the graph changed              -> no-op                     */
  let __prevSig: any = null;
  function graphSignature(graph: any) {
    const nodes = new Set<string>(), links = new Set<string>(), visual = new Map<string, string>(), meta = new Map<string, string>();
    for (const n of graph.nodes) {
      nodes.add(n.id);
      visual.set(n.id, (n.area || "") + "" + (n.color || "") + "" + (n.kind || ""));
      meta.set(n.id, (n.label || "") + "" + (n.status || "") + "" + (n.type || "") + "" + ((n.tags || []).join(",")) + "" + ((n.aliases || []).join(",")) + "" + (n.updatedAt || 0) + "" + (n.validAt || "") + "" + ((n.okf && n.okf.invalidAt) || "") + "" + ((n.okf && n.okf.head) ? 1 : 0));
    }
    for (const l of graph.links) links.add(l.source + "" + l.target + "" + (l.kind || ""));
    return { nodes, links, visual, meta };
  }
  function setsDiffer(a: Set<string>, b: Set<string>) { if (a.size !== b.size) return true; for (const x of a) if (!b.has(x)) return true; return false; }
  function mapsDiffer(a: Map<string, string>, b: Map<string, string>) { if (a.size !== b.size) return true; for (const kv of a) { if (b.get(kv[0]) !== kv[1]) return true; } return false; }
  function topoDiffers(a: any, b: any) { return setsDiffer(a.nodes, b.nodes) || setsDiffer(a.links, b.links); }

  function relayoutWarm(graph: any) {
    const prev = new Map<string, number[]>();
    if (G) for (const n of G.nodes) prev.set(n.id, n.position);
    const positioned = positionFrom(graph);
    if (!positioned.__cosmos && prev.size) { for (const n of positioned.nodes) { const p = prev.get(n.id); if (p) n.position = [p[0], p[1], p[2]]; } }
    buildScene(positioned);
  }
  function refreshMeta(graph: any) {
    const byId = new Map(); for (const n of graph.nodes) byId.set(n.id, n);
    for (const r of nodeRender) {
      const m: any = byId.get(r.node.id); if (!m) continue;
      r.node.tags = m.tags; r.node.status = m.status; r.node.type = m.type; r.node.label = m.label; r.node.aliases = m.aliases;
      if (m.updatedAt != null) r.node.updatedAt = m.updatedAt;
      if (m.validAt != null) { r.node.validAt = m.validAt; r.node.__vt = Date.parse(m.validAt); }
      if (m.okf) { r.node.okf = m.okf; r.node.__it = m.okf.invalidAt ? Date.parse(m.okf.invalidAt) : null; }
    }
    if (graph.areas) G.areas = graph.areas;
    buildFilterUI();
    applyFilters();
    if (chronoT != null) setChronoTint();
  }
  function renderGraph(graph: any, label?: string) {
    try {
      const sig = graphSignature(graph);
      if (!__prevSig || topoDiffers(__prevSig, sig) || mapsDiffer(__prevSig.visual, sig.visual)) {
        relayoutWarm(graph); reseedLive(); ensureFrame();
      } else if (mapsDiffer(__prevSig.meta, sig.meta)) {
        refreshMeta(graph);
      } // else: identical — nothing to do
      __prevSig = sig;
      if (label) setConn(label, true);
    } catch (e) {
      console.error("Vault Kosmos: failed to render graph", e);
      showFatal("Could not render this vault.");
    }
  }

  applyI18n();
  // Deterministic capture always boots the demo scene (even in "wait" mode) so a
  // browser test has a stable, self-contained target with no folder picker.
  if (opts.autoStart === "demo" || CAPTURE.on) {
    try { buildDemo(); ensureFrame(); runCapture(); } catch (e) { console.error("Vault Kosmos: demo failed", e); showFatal("The demo could not be built."); }
    if (!CAPTURE.on) setTimeout(() => { showHint(MOBILE ? "Drag to orbit · pinch to zoom · tap a body" : "Drag to orbit · scroll to zoom · click a body to focus"); }, 900);
  } else {
    showHint(LANG === "de" ? "Warte auf Vault…" : "Waiting for vault…");
  }

  const api: KosmosApp = {
    ok: true,
    renderGraph,
    showDemo() {
      try { buildDemo(); ensureFrame(); } catch (e) { console.error("Vault Kosmos: demo failed", e); showFatal("The demo could not be built."); }
    },
    setConn,
    setVaultStatus,
    setAttachments(paths: string[]) { __attach = (paths || []).slice(); },
    notifyLiveEvent: onLiveEvent,
    notifyAgentTraversal,
    setHostVisible,
    getDiagnostics() { return G ? { ...(G.diagnostics || {}), residualCollisions: G.__residualCollisions ?? (G.diagnostics && G.diagnostics.residualCollisions) ?? 0, agentTraversalHops: agentSteps.length, agentDustParticles: agentDust?.active ?? 0 } : null; },
    getRenderStats() { return { frames: renderStats.frames, running: renderStats.running }; },
    showError: showFatal,
    showHint,
    applyI18n,
    dispose: teardown,
  };
  (window as any).__kosmos = api;
  return api;
}
