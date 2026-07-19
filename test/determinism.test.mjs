/**
 * Determinism tests: canonical output must be byte-identical for identical
 * input on ANY host locale. Every ordering that reaches a hash/export/API
 * payload uses code-unit comparison (codeUnitCompare), NOT localeCompare —
 * the latter is governed by the host's ICU collation and reorders non-ASCII
 * names differently between locales (e.g. "z" vs "ä" under en vs sv).
 *
 * These assertions catch a locale-collation regression WITHOUT forcing an ICU
 * locale in the test env: code-unit order is a fixed, host-independent fact
 * (U+007A 'z' < U+00E4 'ä'), so a stray localeCompare flips them and fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { KosmosIndex, buildGraph, codeUnitCompare } from "../dist/kosmos-core.mjs";

// Fixed file timestamps so identical INPUT is fully specified (otherwise the
// parser falls back to Date.now() and wall-clock leaks in — not a sort defect).
const T = 1_700_000_000_000;
const N = (path, content) => ({ relativePath: path, content, kind: "note", modifiedTime: T, createdTime: T });

// Fixture with non-ASCII note names AND non-ASCII tags on one note.
const fixture = () => [
  N("z.md", "---\ntags: [zeta, ähm, omega, öl, zulu]\n---\nz body [[ä]]"),
  N("ä.md", "# a-umlaut"),
  N("o.md", "# o"),
  N("ö.md", "# o-umlaut"),
  N("a.md", "# a"),
];

test("codeUnitCompare is locale-independent: 'z' sorts before 'ä'", () => {
  const sorted = ["ä", "z", "a", "ö", "o"].sort(codeUnitCompare);
  assert.deepEqual(sorted, ["a", "o", "z", "ä", "ö"]); // U+007A < U+00E4 < U+00F6
});

test("emitted graph node order is code-unit order ('z.md' before 'ä.md')", () => {
  const graph = buildGraph(fixture(), []);
  const paths = graph.nodes.filter((n) => n.kind === "file").map((n) => n.path);
  const zi = paths.indexOf("z.md");
  const ai = paths.indexOf("ä.md");
  assert.ok(zi >= 0 && ai >= 0);
  assert.ok(zi < ai, `expected z.md before ä.md, got ${JSON.stringify(paths)}`);
  // Full ASCII-before-non-ASCII ordering.
  assert.deepEqual(paths, ["a.md", "o.md", "z.md", "ä.md", "ö.md"]);
});

test("uniq'd aggregate tag list is code-unit ordered (ASCII tags before non-ASCII)", () => {
  const graph = buildGraph(fixture(), []);
  // graph.tags is the uniq()'d aggregate — ASCII names precede non-ASCII,
  // which localeCompare would interleave.
  assert.deepEqual(graph.tags, ["omega", "zeta", "zulu", "ähm", "öl"]);
});

test("two consecutive full builds of the same fixture are byte-identical", () => {
  const stripVolatile = (g) => {
    // Wall-clock fields (build timing, indexedAt) are not input-derived.
    const { diagnostics, stats, ...rest } = g;
    const { lastFullBuildMs, lastIncrementalUpdateMs, ...stableDiag } = diagnostics;
    const { indexedAt, durationMs, ...stableStats } = stats;
    return { ...rest, diagnostics: stableDiag, stats: stableStats };
  };
  const a = new KosmosIndex();
  const b = new KosmosIndex();
  const ga = a.setFiles(fixture(), []).graph;
  const gb = b.setFiles(fixture(), []).graph;
  assert.equal(JSON.stringify(stripVolatile(ga)), JSON.stringify(stripVolatile(gb)));
});
