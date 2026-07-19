/** Link resolver tests (§24): path, path-no-ext, basename, alias, ambiguity, unresolved. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  addFileToResolver,
  createResolver,
  resolveLinkTarget,
  resolveTitleRef,
  buildGraph,
} from "../dist/kosmos-core.mjs";

function fixtureResolver() {
  const r = createResolver();
  addFileToResolver(r, "Notes/Alpha.md", "file:Notes/Alpha.md", ["The Alpha"]);
  addFileToResolver(r, "Notes/Beta.md", "file:Notes/Beta.md");
  addFileToResolver(r, "Archive/Beta.md", "file:Archive/Beta.md");
  addFileToResolver(r, "Deep/Sub/Gamma.md", "file:Deep/Sub/Gamma.md");
  return r;
}

test("resolves by exact path", () => {
  const r = fixtureResolver();
  assert.equal(resolveLinkTarget(r, "Home.md", "Notes/Alpha.md"), "file:Notes/Alpha.md");
});

test("resolves by path without extension", () => {
  const r = fixtureResolver();
  assert.equal(resolveLinkTarget(r, "Home.md", "Notes/Alpha"), "file:Notes/Alpha.md");
});

test("resolves by bare basename", () => {
  const r = fixtureResolver();
  assert.equal(resolveLinkTarget(r, "Home.md", "Gamma"), "file:Deep/Sub/Gamma.md");
});

test("resolves by alias", () => {
  const r = fixtureResolver();
  assert.equal(resolveLinkTarget(r, "Home.md", "The Alpha"), "file:Notes/Alpha.md");
});

test("resolves relative to the linking note's folder", () => {
  const r = fixtureResolver();
  assert.equal(resolveLinkTarget(r, "Deep/Sub/Other.md", "Gamma"), "file:Deep/Sub/Gamma.md");
});

test("ambiguous basename picks deterministic first match and records ambiguity", () => {
  const r = fixtureResolver();
  const id = resolveLinkTarget(r, "Home.md", "Beta");
  assert.equal(id, "file:Archive/Beta.md"); // sorted-first, deterministic
  assert.ok(r.ambiguous.has("beta"));
});

test("resolveTitleRef reports ambiguity for lineage validation", () => {
  const r = fixtureResolver();
  const res = resolveTitleRef(r, "Beta");
  assert.equal(res.ambiguous, true);
  assert.equal(res.id, "file:Archive/Beta.md");
  assert.equal(resolveTitleRef(r, "Nope").id, undefined);
});

test("unresolved links become unresolved nodes, counted in diagnostics", () => {
  const graph = buildGraph([{ relativePath: "a.md", content: "[[Missing Note]]" }], []);
  const un = graph.nodes.find((n) => n.kind === "unresolved");
  assert.ok(un);
  assert.equal(un.label, "Missing Note");
  assert.equal(graph.diagnostics.unresolvedLinks, 1);
  assert.equal(graph.stats.unresolved, 1);
});
