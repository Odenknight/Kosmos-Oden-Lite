/**
 * Standalone artifact + cosmology pipeline tests (§25).
 *
 * The artifact checks prove vault-kosmos.html is a genuine single offline
 * file: no external runtime URLs, Three.js + app + CSS inlined, both folder
 * access paths present. The cosmology checks run the DOM-free classification
 * and packing pipeline (the exact code the page executes) against real
 * graphs — including "a new top-level folder becomes a galaxy".
 *
 * Full in-browser behavior (WebGL scene, picker dialogs, IndexedDB handle
 * persistence) is exercised manually via the __kosmosStandalone hooks; those
 * flows depend on real browser chrome that Node cannot host.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, createDemoVaultGraph } from "../dist/kosmos-core.mjs";
import { positionCosmos, countIntersections } from "../dist/kosmos-layout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "vault-kosmos.html"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("standalone HTML exists and is one self-contained file", () => {
  assert.ok(html.length > 400_000, "artifact suspiciously small");
  assert.ok(html.startsWith("<!doctype html>"));
});

test("no external runtime URL dependencies (§2.1)", () => {
  // Resource-loading vectors must never reference the network:
  assert.doesNotMatch(html, /<script[^>]+src=/i, "external <script src>");
  assert.doesNotMatch(html, /<link[^>]+href=/i, "external <link>");
  assert.doesNotMatch(html, /<img[^>]+src=["']https?:/i, "external <img>");
  assert.doesNotMatch(html, /@import/i, "CSS @import");
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i, "CSS url(http…)");
  assert.doesNotMatch(html, /<[^>]{0,300}\s(integrity|crossorigin)=/i, "CDN attributes on tags");
  // fetch() may only target same-origin relative paths (./graph.json, /api/*):
  const fetches = [...html.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  for (const f of fetches) assert.ok(!/^https?:/i.test(f), `network fetch: ${f}`);
});

test("bundled renderer + core + both folder-access paths are inlined", () => {
  // Three.js is now an esbuild-bundled ESM module (no vendored global banner);
  // the page carries the renderer build marker instead.
  assert.ok(/kosmos-renderer" content="three r\d+ WebGLRenderer webgl2"/.test(html), "renderer build marker present");
  assert.ok(html.includes("REVISION"), "Three.js runtime bundled");
  assert.ok(html.includes("showDirectoryPicker"), "persistent directory picker (§6.1)");
  assert.ok(html.includes("webkitdirectory"), "snapshot fallback input (§6.2)");
  assert.ok(html.includes("__kosmosStandalone"), "test/diagnostic hook");
  assert.ok(html.includes("indexedDB"), "handle persistence (§7)");
  assert.ok(html.includes("Open Knowledge Folder"), "startup control (§19)");
});

test("artifact title carries the package version (§29)", () => {
  assert.ok(html.includes(`Vault Kosmos ${pkg.version}`), "version in title");
});

test("demo graph flows through cosmology + layout: positions for every visible node", () => {
  const g = positionCosmos(createDemoVaultGraph(1750000000000), { attachments: [] });
  for (const n of g.nodes) {
    if (n.role === "hidden") continue;
    assert.ok(Array.isArray(n.position) && n.position.length === 3, `no position: ${n.id}`);
    assert.ok(n.position.every((v) => Number.isFinite(v)), `non-finite position: ${n.id}`);
  }
  assert.ok(g.galaxies.length >= 7, "demo areas become galaxies");
  assert.equal(typeof g.__residualCollisions, "number");
});

test("a new top-level folder becomes a new galaxy (§9.3)", () => {
  const files = [
    { relativePath: "Alpha/a.md", content: "a [[b]]" },
    { relativePath: "Alpha/b.md", content: "b" },
  ];
  const g1 = positionCosmos(buildGraph(files, ["Alpha"]), {});
  assert.deepEqual(g1.galaxies.map((x) => x.id), ["Alpha"]);

  const g2 = positionCosmos(
    buildGraph([...files, { relativePath: "Beta/c.md", content: "c" }], ["Alpha", "Beta"]),
    {}
  );
  assert.deepEqual(g2.galaxies.map((x) => x.id).sort(), ["Alpha", "Beta"]);
});

test("deleted note disappears from the positioned cosmos", () => {
  const files = [
    { relativePath: "Alpha/a.md", content: "a [[b]]" },
    { relativePath: "Alpha/b.md", content: "b" },
  ];
  const g1 = positionCosmos(buildGraph(files, ["Alpha"]), {});
  assert.ok(g1.nodes.some((n) => n.id === "file:Alpha/b.md"));
  const g2 = positionCosmos(buildGraph([files[0]], ["Alpha"]), {});
  assert.ok(!g2.nodes.some((n) => n.id === "file:Alpha/b.md"));
});

test("lineage ghosts + Chrono span survive the cosmology pass", () => {
  const g = positionCosmos(buildGraph([
    { relativePath: "v1.md", content: "---\ntype: idea\ntimestamp: 2026-01-01\n---\nx" },
    { relativePath: "v2.md", content: "---\ntype: idea\ntimestamp: 2026-03-01\nsupersedes:\n  - v1\n---\nx" },
  ], []), {});
  const v1 = g.nodes.find((n) => n.id === "file:v1.md");
  assert.equal(v1.__ghost, true, "superseded note is ghosted");
  assert.ok(g.__timeSpan && g.__timeSpan.min < g.__timeSpan.max, "chrono span");
  assert.ok(g.cosmosLinks.some((l) => l.cat === "lineage"), "lineage cosmos link");
});

test("collision diagnostic reports residual intersections honestly (§12)", () => {
  const files = [];
  for (let a = 0; a < 3; a++) {
    for (let i = 0; i < 30; i++) {
      files.push({ relativePath: `Area${a}/n${i}.md`, content: `note [[Area${a}/n${(i + 1) % 30}]]` });
    }
  }
  const g = positionCosmos(buildGraph(files, ["Area0", "Area1", "Area2"]), {});
  const counted = countIntersections(g);
  assert.equal(g.__residualCollisions, counted, "diagnostic matches a recount");
  // No zero-overlap guarantee is claimed — but the packing should keep hard
  // intersections rare on a benign vault:
  assert.ok(counted <= files.length * 0.05, `unexpectedly many intersections: ${counted}`);
});

test("attachments become Oort objects bound to their referencing system", () => {
  const g = positionCosmos(buildGraph([
    { relativePath: "A/host.md", content: "body ![[pic.png]]" },
    { relativePath: "A/other.md", content: "[[host]]" },
  ], ["A"]), { attachments: ["A/pic.png"] });
  const oort = g.nodes.find((n) => n.role === "oort");
  assert.ok(oort, "oort object exists");
  assert.ok(g.cosmosLinks.some((l) => l.cat === "oort" && l.target === oort.id));
});
