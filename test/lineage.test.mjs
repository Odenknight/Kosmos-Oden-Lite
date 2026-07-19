/** Canonical lineage tests (§3, §24) — including the critical one-sided supersedes case. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../dist/kosmos-core.mjs";

const note = (path, fm, body = "x") => ({
  relativePath: path,
  content: `---\n${fm}\n---\n${body}`,
});

const byId = (graph, id) => graph.nodes.find((n) => n.id === id);

test("CRITICAL: one-sided `supersedes` invalidates the predecessor (§3.1)", () => {
  const graph = buildGraph(
    [
      note("Ideas/Engine v1.md", "type: idea\ntimestamp: 2026-01-01T00:00:00Z"),
      note("Ideas/Engine v2.md", "type: idea\ntimestamp: 2026-03-01T00:00:00Z\nsupersedes:\n  - Engine v1"),
    ],
    ["Ideas"]
  );
  const v1 = byId(graph, "file:Ideas/Engine v1.md");
  const v2 = byId(graph, "file:Ideas/Engine v2.md");
  // v1 never declared superseded_by, yet the canonical model derives it:
  assert.deepEqual(v1.okf.supersededByIds, ["file:Ideas/Engine v2.md"]);
  assert.equal(v1.okf.invalidAt, v2.validAt);
  assert.equal(v1.okf.head, false);
  assert.equal(v2.okf.head, true);
  assert.equal(graph.diagnostics.lineageEdges, 1);
});

test("one-sided `superseded_by` produces the same canonical lineage", () => {
  const graph = buildGraph(
    [
      note("a v1.md", "type: idea\ntimestamp: 2026-01-01\nsuperseded_by:\n  - a v2"),
      note("a v2.md", "type: idea\ntimestamp: 2026-02-01"),
    ],
    []
  );
  const v1 = byId(graph, "file:a v1.md");
  const v2 = byId(graph, "file:a v2.md");
  assert.deepEqual(v1.okf.supersededByIds, ["file:a v2.md"]);
  assert.deepEqual(v2.okf.supersedesIds, ["file:a v1.md"]);
  assert.equal(v1.okf.invalidAt, v2.validAt);
  assert.equal(v2.okf.head, true);
});

test("both sides declared -> ONE deduplicated canonical edge", () => {
  const graph = buildGraph(
    [
      note("v1.md", "type: idea\ntimestamp: 2026-01-01\nsuperseded_by:\n  - v2"),
      note("v2.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - v1"),
    ],
    []
  );
  assert.equal(graph.diagnostics.lineageEdges, 1);
  assert.equal(graph.links.filter((l) => l.kind === "lineage").length, 1);
});

test("duplicate declarations warn but do not duplicate edges", () => {
  const graph = buildGraph(
    [
      note("v1.md", "type: idea\ntimestamp: 2026-01-01"),
      note("v2.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - v1\n  - v1"),
    ],
    []
  );
  assert.equal(graph.diagnostics.lineageEdges, 1);
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("duplicate-declaration")));
});

test("self-supersession is ignored with a warning", () => {
  const graph = buildGraph([note("self.md", "type: idea\ntimestamp: 2026-01-01\nsupersedes:\n  - self")], []);
  assert.equal(graph.diagnostics.lineageEdges, 0);
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("self-supersession")));
  assert.equal(byId(graph, "file:self.md").okf.head, false); // no lineage participation
});

test("cycles are detected and reported, graph survives (§3.5)", () => {
  const graph = buildGraph(
    [
      note("a.md", "type: idea\ntimestamp: 2026-01-01\nsupersedes:\n  - b"),
      note("b.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - a"),
    ],
    []
  );
  assert.ok(graph.diagnostics.lineageCycles >= 1);
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("cycle")));
  assert.equal(graph.nodes.filter((n) => n.kind === "file").length, 2); // not destroyed
});

test("unresolved lineage target warns and is skipped", () => {
  const graph = buildGraph([note("v2.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - Ghost Note")], []);
  assert.equal(graph.diagnostics.lineageEdges, 0);
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("unresolved-target")));
});

test("multiple direct successors: earliest successor wins invalid_at, warning emitted", () => {
  const graph = buildGraph(
    [
      note("v1.md", "type: idea\ntimestamp: 2026-01-01"),
      note("v2a.md", "type: idea\ntimestamp: 2026-03-01\nsupersedes:\n  - v1"),
      note("v2b.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - v1"),
    ],
    []
  );
  const v1 = byId(graph, "file:v1.md");
  assert.equal(v1.okf.invalidAt, byId(graph, "file:v2b.md").validAt); // earliest successor
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("multiple-successors")));
});

test("successor timestamp earlier than predecessor -> warning", () => {
  const graph = buildGraph(
    [
      note("v1.md", "type: idea\ntimestamp: 2026-05-01"),
      note("v2.md", "type: idea\ntimestamp: 2026-01-01\nsupersedes:\n  - v1"),
    ],
    []
  );
  assert.ok(graph.diagnostics.lineageWarnings.some((w) => w.includes("successor-before-predecessor")));
});

test("HEAD is derived from lineage participation, never from a frontmatter field (§3.4)", () => {
  const graph = buildGraph(
    [
      note("plain.md", "type: idea\ntimestamp: 2026-01-01"), // no lineage -> not HEAD
      note("v1.md", "type: idea\ntimestamp: 2026-01-01"),
      note("v2.md", "type: idea\ntimestamp: 2026-02-01\nsupersedes:\n  - v1"),
    ],
    []
  );
  assert.equal(byId(graph, "file:plain.md").okf.head, false);
  assert.equal(byId(graph, "file:v1.md").okf.head, false);
  assert.equal(byId(graph, "file:v2.md").okf.head, true);
});
