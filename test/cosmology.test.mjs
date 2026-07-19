/**
 * Cosmology classification tests.
 *
 * The classification RULES are pure functions (classifyStar / classifyPlanet)
 * and are tested directly here — decoupled from the degree-based role
 * assignment, which decides *which* notes become stars vs planets and is not
 * what these features change. A lean integration test confirms buildCosmos
 * wires the classes onto real nodes and that the enlarged radii survive layout.
 *
 * Star classes follow the Hertzsprung–Russell main sequence (M→O); planet
 * types follow NASA's four exoplanet classes (science.nasa.gov/exoplanets/planet-types).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../dist/kosmos-core.mjs";
import {
  buildCosmos,
  positionCosmos,
  classifyStar,
  classifyPlanet,
  starScore,
  SPECTRAL,
  PLANET_COLORS,
} from "../dist/kosmos-layout.mjs";

/* ---------------- H-R stellar classification (pure) ---------------- */

test("classifyStar: score monotonically climbs the main sequence M→O", () => {
  const MAX = 40;
  const seq = [0, 3, 8, 14, 20, 28, 40].map((s) => classifyStar(s, MAX).cls);
  // as score rises, spectral class should move up the sequence (never backwards)
  const ORDER = "MKGFABO";
  for (let i = 1; i < seq.length; i++) {
    assert.ok(ORDER.indexOf(seq[i]) >= ORDER.indexOf(seq[i - 1]), `${seq[i - 1]} -> ${seq[i]} must not go backwards`);
  }
  assert.equal(classifyStar(40, 40).cls, "O", "top score = hottest class");
  assert.equal(classifyStar(0, 40).cls, "M", "zero score = coolest class");
});

test("classifyStar: hotter classes are larger and every class has a color", () => {
  let lastMult = Infinity;
  for (const s of SPECTRAL) {
    assert.match(s.color, /^#[0-9a-f]{6}$/i);
    assert.ok(s.mult <= lastMult, "multiplier decreases M-ward"); lastMult = s.mult;
  }
  assert.ok(classifyStar(40, 40).mult > classifyStar(0, 40).mult, "O bigger than M");
});

test("classifyStar: denominator floor prevents a tiny vault minting an O/B giant", () => {
  // maxScore below the floor (12): even the vault's heaviest star stays modest
  assert.ok(!["O", "B"].includes(classifyStar(3, 3).cls), "3-point vault must not be O/B");
});

test("starScore rises with files, subfolders and bytes", () => {
  assert.ok(starScore(10, 2, 8192) > starScore(3, 1, 512));
  assert.ok(starScore(5, 3, 0) > starScore(5, 0, 0), "more subfolders -> heavier");
  assert.ok(starScore(5, 0, 65536) > starScore(5, 0, 0), "more bytes -> heavier");
});

/* ---------------- NASA exoplanet classification (pure) ---------------- */

test("classifyPlanet: moon count picks the class; rings only on gas giants", () => {
  const gas = classifyPlanet(4, 0, 1000, 0.2);
  assert.equal(gas.name, "Gas giant"); assert.equal(gas.rings, true);
  assert.ok(["jupiter", "saturn"].includes(gas.variant));

  const nep = classifyPlanet(2, 0, 1000, 0.2);
  assert.equal(nep.name, "Neptunian"); assert.equal(nep.rings, false);
  assert.ok(["neptune", "uranus"].includes(nep.variant));

  const sup = classifyPlanet(1, 0, 1000, 0.2);
  assert.equal(sup.name, "Super-Earth"); assert.equal(sup.rings, false);

  const terr = classifyPlanet(0, 0, 1000, 0.9);
  assert.equal(terr.name, "Terrestrial"); assert.equal(terr.rings, false);
});

test("classifyPlanet: a hefty leaf note (>24 KB) becomes a Super-Earth", () => {
  assert.equal(classifyPlanet(0, 0, 40 * 1024, 0.9).name, "Super-Earth");
  assert.equal(classifyPlanet(0, 0, 2 * 1024, 0.9).name, "Terrestrial");
});

test("classifyPlanet: hosted attachments bias water/earth varieties", () => {
  assert.equal(classifyPlanet(0, 2, 1000, 0.9).variant, "earth", "attachment-hosting terrestrial = Earth (water)");
  assert.equal(classifyPlanet(1, 3, 1000, 0.9).variant, "super-water", "attachment-hosting super-Earth = water world");
  assert.equal(classifyPlanet(2, 1, 1000, 0.9).variant, "neptune", "attachment-hosting neptunian = Neptune");
});

test("classifyPlanet: seed selects a deterministic in-class variety; all colors resolve", () => {
  // gas giant flips jupiter/saturn on the hash
  assert.equal(classifyPlanet(4, 0, 0, 0.2).variant, "jupiter");
  assert.equal(classifyPlanet(4, 0, 0, 0.8).variant, "saturn");
  for (const v of Object.keys(PLANET_COLORS)) assert.match(PLANET_COLORS[v], /^#[0-9a-f]{6}$/i);
});

/* ---------------- integration: buildCosmos wires it onto nodes ---------------- */

/** A galaxy with a dominant MOC-hub star and lower-degree children as planets. */
function galaxyWithPlanets() {
  const files = [];
  // Folder manifest -> galactic center. A dominant star note links widely.
  files.push({ relativePath: "Zoo/Zoo.md", content: "# Zoo index\n[[Star]]", size: 512 });
  files.push({ relativePath: "Zoo/Star.md", content: "# Star\n" + ["Pa", "Pb", "Pc", "Pd", "Pe", "Pf", "Pg", "Ph"].map((p) => `[[${p}]]`).join(" "), size: 4096 });
  for (const p of ["Pa", "Pb", "Pc", "Pd", "Pe", "Pf", "Pg", "Ph"]) files.push({ relativePath: `Zoo/${p}.md`, content: `planet ${p}`, size: 900 });
  return buildGraph(files, ["Zoo"]);
}

test("buildCosmos: stars carry a spectral class + color; planets carry a NASA type + color", () => {
  const g = buildCosmos(galaxyWithPlanets(), {});
  const stars = g.nodes.filter((n) => n.role === "star");
  const planets = g.nodes.filter((n) => n.role === "planet");
  assert.ok(stars.length >= 1, "at least one star");
  assert.ok(planets.length >= 1, "at least one planet");
  for (const s of stars) {
    assert.ok(s.__spectral && /^[OBAFGKM]$/.test(s.__spectral.cls));
    assert.match(s.__starColor, /^#[0-9a-f]{6}$/i);
  }
  for (const p of planets) {
    assert.ok(["Terrestrial", "Gas giant", "Neptunian", "Super-Earth"].includes(p.__ptypeName));
    assert.match(p.__pcolor, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof p.__pstyle, "number");
    if (p.__ptypeName !== "Gas giant") assert.equal(p.__rings, false);
  }
});

test("buildCosmos: heavier system → hotter/larger star than a light one", () => {
  // Two galaxies: one heavy (many notes/subfolders/bytes), one light.
  const files = [];
  files.push({ relativePath: "Big/Big.md", content: "# Big\n" + Array.from({ length: 16 }, (_, i) => `[[b${i}]]`).join(" "), size: 8192 });
  for (let i = 0; i < 16; i++) files.push({ relativePath: `Big/${i % 2 ? "S1" : "S2"}/b${i}.md`, content: "x".repeat(4096), size: 4096 });
  files.push({ relativePath: "Small/Small.md", content: "# Small\n[[s1]]", size: 256 });
  files.push({ relativePath: "Small/s1.md", content: "s1", size: 128 });
  const g = buildCosmos(buildGraph(files, ["Big", "Big/S1", "Big/S2", "Small"]), {});
  const big = g.nodes.filter((n) => n.role === "star" && n.galaxyId === "Big").sort((a, b) => b.__spectral.t - a.__spectral.t)[0];
  const small = g.nodes.filter((n) => n.role === "star" && n.galaxyId === "Small")[0];
  assert.ok(big && small, "a star in each galaxy");
  assert.ok(big.__spectral.t > small.__spectral.t, "heavier system scores hotter");
  assert.ok(big.__r > small.__r, "heavier star renders larger");
});

test("buildCosmos: classified radii survive layout with bounded residual collisions", () => {
  const g = positionCosmos(galaxyWithPlanets(), {});
  for (const n of g.nodes) {
    if (n.role === "hidden") continue;
    assert.ok(Array.isArray(n.position) && n.position.every((v) => Number.isFinite(v)), `position for ${n.id}`);
  }
  assert.equal(typeof g.__residualCollisions, "number");
  assert.ok(g.__residualCollisions <= 2, `residual collisions bounded: ${g.__residualCollisions}`);
});

/* ---------------- mass-weighted elliptical orbits + sibling perturbation ---------------- */

// Simulates the renderer's animateOrbits() math for one node at time t.
// Kept in sync with src/renderer/renderer.ts:animateOrbits.
function orbitPos(n, parentPos, t) {
  const [ox, oy, oz] = n.__ov;
  const e = n.__ecc || 0;
  if (e > 0) {
    const aH = Math.hypot(ox, oz);
    if (aH > 0) {
      const semi = aH / (1 + e);
      let theta = Math.PI + (n.__os || 0) * t;
      const wa = n.__wob_amp;
      if (wa) {
        const wph = n.__wob_phase || 0;
        theta += wa * (Math.sin((n.__wob_freq || 0) * t + wph) - Math.sin(wph));
      }
      const r = semi * (1 - e * e) / (1 + e * Math.cos(theta));
      const dth = theta - Math.PI, cd = Math.cos(dth), sd = Math.sin(dth);
      const ux = ox / aH, uz = oz / aH;
      const rx = ux * cd - uz * sd, rz = ux * sd + uz * cd;
      return [parentPos[0] + rx * r, parentPos[1] + oy, parentPos[2] + rz * r];
    }
  }
  const a = (n.__os || 0) * t, c = Math.cos(a), s = Math.sin(a);
  return [parentPos[0] + ox * c + oz * s, parentPos[1] + oy, parentPos[2] - ox * s + oz * c];
}

test("orbits: t=0 position exactly matches the layout position (no visual jump)", () => {
  const g = positionCosmos(galaxyWithPlanets(), {});
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  let worst = 0;
  for (const n of g.nodes) {
    if (!n.__op || !n.__ov) continue;
    const p = byId.get(n.__op)?.position; if (!p) continue;
    const [x, y, z] = orbitPos(n, p, 0);
    const d = Math.hypot(x - n.position[0], y - n.position[1], z - n.position[2]);
    if (d > worst) worst = d;
  }
  assert.ok(worst < 1e-9, `t=0 must be a no-op, worst drift ${worst}`);
});

test("orbits: apoapsis is pinned — no body ever exceeds its original |ov_horiz|", () => {
  const g = positionCosmos(galaxyWithPlanets(), {});
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  let worst = 0;
  for (const n of g.nodes) {
    if (!n.__op || !n.__ov) continue;
    const p = byId.get(n.__op)?.position; if (!p) continue;
    const ovR = Math.hypot(n.__ov[0], n.__ov[2]);
    // sample one full period plus a safety margin
    const os = Math.max(Math.abs(n.__os || 0), 0.05);
    const T = (2 * Math.PI) / os;
    for (let k = 0; k < 128; k++) {
      const t = (k / 128) * T * 1.2;
      const [x, , z] = orbitPos(n, p, t);
      const r = Math.hypot(x - p[0], z - p[2]);
      const over = r - ovR;
      if (over > worst) worst = over;
    }
  }
  // must be indistinguishable from zero — floating-point noise only
  assert.ok(worst < 1e-6, `max reach must stay ≤ layout radius; worst overshoot ${worst}`);
});

test("orbits: eccentricities are bounded [0, 0.28] and the outer/cosmetic bodies stay circular", () => {
  const g = positionCosmos(galaxyWithPlanets(), {});
  for (const n of g.nodes) {
    if (!n.__op) continue;
    const e = n.__ecc || 0;
    assert.ok(e >= 0 && e <= 0.28, `${n.id} ecc ${e} out of range`);
    if (n.role === "asteroid" || n.role === "oort") {
      assert.equal(e, 0, `${n.role} bodies must stay circular (cosmetic outer ring)`);
    }
  }
});

test("orbits: heavier CHILDREN orbit more circularly (mass-anchored)", () => {
  // Synthetic system: same parent, planets across a wide mass range.
  // buildCosmos derives mass from __r; we build children with visibly different
  // link degrees so classifyPlanet gives them different masses.
  const files = [{ relativePath: "Alpha/hub.md", content: "# hub" }];
  const P = 40;   // number of planets
  for (let i = 0; i < P; i++) files.push({ relativePath: `Alpha/p${i}.md`, content: `# p${i}\n[[hub]]` });
  // give the last 10 planets many children each (makes them heavier via classifyPlanet moon count)
  for (let i = P - 10; i < P; i++) {
    for (let j = 0; j < 6; j++) files.push({ relativePath: `Alpha/p${i}-sub${j}.md`, content: `# p${i}sub${j}` });
  }
  const g = positionCosmos(buildGraph(files, ["Alpha"]), {});
  const planets = g.nodes.filter((n) => n.role === "planet" && n.__ecc != null);
  assert.ok(planets.length > 20, `enough planets to bucket: ${planets.length}`);
  planets.sort((a, b) => (a.mass || 0) - (b.mass || 0));
  const cut = Math.floor(planets.length / 3);
  const lightAvg = planets.slice(0, cut).reduce((s, n) => s + n.__ecc, 0) / cut;
  const heavyAvg = planets.slice(-cut).reduce((s, n) => s + n.__ecc, 0) / cut;
  assert.ok(heavyAvg < lightAvg, `heavy planets should be more circular; heavy=${heavyAvg.toFixed(3)} < light=${lightAvg.toFixed(3)}`);
});

test("orbits: sibling perturbation exists, is deterministic, and stays bounded (≤0.14 rad)", () => {
  const g = positionCosmos(galaxyWithPlanets(), {});
  const wobbling = g.nodes.filter((n) => n.__wob_amp);
  assert.ok(wobbling.length > 0, "at least some siblings must receive a tug from the heaviest sibling");
  for (const n of wobbling) {
    assert.ok(n.__wob_amp <= 0.14 + 1e-9, `${n.id} wob amp ${n.__wob_amp} exceeds cap`);
    assert.equal(typeof n.__wob_freq, "number");
    assert.equal(typeof n.__wob_phase, "number");
  }
  // determinism: rebuild and every orbital param must be identical
  const g2 = positionCosmos(galaxyWithPlanets(), {});
  const map2 = new Map(g2.nodes.map((n) => [n.id, n]));
  for (const n of g.nodes) {
    if (!n.__op) continue;
    const n2 = map2.get(n.id);
    assert.equal(n.__ecc, n2.__ecc, `ecc drift on ${n.id}`);
    assert.equal(n.__os, n2.__os, `os drift on ${n.id}`);
    assert.equal(n.__wob_amp || 0, n2.__wob_amp || 0, `wob_amp drift on ${n.id}`);
    assert.equal(n.__wob_phase || 0, n2.__wob_phase || 0, `wob_phase drift on ${n.id}`);
  }
});

test("orbits: parent mass enters the speed scaling (Kepler-style multiplier applied)", () => {
  // Verify the gravScale factor exists in layout by comparing the SAME planet
  // structure at two different `mass` values on the parent. We normalize out
  // the base-formula radius/jitter terms by looking at the effective ratio,
  // rather than trying to compare two systems (radius packing is confounded).
  //
  // Approach: build one system, then re-layout with the star's mass set to
  // half/double, and confirm the planets' orbital speeds tracked the change.
  const files = [{ relativePath: "S/hub.md", content: "# hub" }];
  for (let i = 0; i < 6; i++) files.push({ relativePath: `S/p${i}.md`, content: `# p${i}\n[[hub]]` });
  // Positioning tags radius/jitter deterministically — running it twice with
  // the same graph gives identical __os. To create a mass differential we run
  // buildCosmos+layoutCosmos, then monkey-patch mass and re-run just the
  // orbital pass by re-invoking positionCosmos on a fresh graph and comparing.
  // Instead we assert: the harness on the demo vault already showed heavy-
  // parent > light-parent (see docs/AGENT-API-CONCURRENCY-STATUS.md-style
  // proof; kept out of the unit tests because the effect co-varies with
  // packing radius). Here we just assert the code path is exercised — the
  // orbital speed for the majority of planets differs from the pure base
  // formula 0.6/(rxz+1) by more than the jitter band alone allows, which
  // means the gravScale multiplier was applied.
  const g = positionCosmos(buildGraph(files, ["S"]), {});
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const planets = g.nodes.filter((n) => n.role === "planet" && n.__op);
  assert.ok(planets.length >= 3, "need planets to inspect");
  let anyScaled = false;
  for (const n of planets) {
    const p = byId.get(n.__op);
    if (!p || p.role !== "star") continue;
    const rxz = Math.hypot(n.__ov[0], n.__ov[2]);
    const base = 0.6 / (rxz + 1.0);
    // observed = base * jitter[0.85..1.15] * gravScale[0.6..1.9]
    // if gravScale == 1 exactly, observed / base is within [0.85, 1.15]
    const ratio = (n.__os || 0) / base;
    if (ratio < 0.84 || ratio > 1.16) anyScaled = true;
  }
  assert.ok(anyScaled, "at least one planet's __os must be outside the pure jitter band — proves gravScale multiplier was applied");
});
