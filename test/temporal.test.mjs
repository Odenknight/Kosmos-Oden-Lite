/** Temporal projection tests (§4.1, §24): the ONE shared projector. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, projectAtTime } from "../dist/kosmos-core.mjs";

const T = (iso) => Date.parse(iso);

/** Chain: v1 valid 2026-01-01, superseded by v2 at 2026-03-01. */
function chainProjectables() {
  const graph = buildGraph(
    [
      { relativePath: "v1.md", content: "---\ntype: idea\ntimestamp: 2026-01-01T00:00:00Z\n---\nx" },
      { relativePath: "v2.md", content: "---\ntype: idea\ntimestamp: 2026-03-01T00:00:00Z\nsupersedes:\n  - v1\n---\nx" },
    ],
    []
  );
  return graph.nodes
    .filter((n) => n.kind === "file")
    .map((n) => ({
      id: n.id,
      validAtMs: Date.parse(n.validAt),
      invalidAtMs: n.okf?.invalidAt ? Date.parse(n.okf.invalidAt) : null,
    }));
}

test("before the predecessor exists: everything not_yet_created", () => {
  const p = projectAtTime(chainProjectables(), T("2025-12-01"));
  assert.deepEqual(p.valid, []);
  assert.deepEqual(p.superseded, []);
  assert.equal(p.notYetCreated.length, 2);
});

test("predecessor valid, successor not yet created", () => {
  const p = projectAtTime(chainProjectables(), T("2026-02-01"));
  assert.deepEqual(p.valid, ["file:v1.md"]);
  assert.deepEqual(p.notYetCreated, ["file:v2.md"]);
  assert.deepEqual(p.superseded, []);
});

test("exact successor instant: predecessor superseded, successor valid (invalid_at <= T)", () => {
  const p = projectAtTime(chainProjectables(), T("2026-03-01T00:00:00Z"));
  assert.deepEqual(p.valid, ["file:v2.md"]);
  assert.deepEqual(p.superseded, ["file:v1.md"]);
});

test("after supersession: predecessor superseded, successor (HEAD) valid", () => {
  const p = projectAtTime(chainProjectables(), T("2026-06-01"));
  assert.deepEqual(p.valid, ["file:v2.md"]);
  assert.deepEqual(p.superseded, ["file:v1.md"]);
  assert.deepEqual(p.notYetCreated, []);
});

test("note with no lineage stays valid forever after creation", () => {
  const p = projectAtTime([{ id: "n", validAtMs: T("2026-01-01"), invalidAtMs: null }], T("2099-01-01"));
  assert.deepEqual(p.valid, ["n"]);
});

test("boundary: valid_at == T counts as created (valid_at <= T)", () => {
  const p = projectAtTime([{ id: "n", validAtMs: T("2026-01-01"), invalidAtMs: null }], T("2026-01-01"));
  assert.deepEqual(p.valid, ["n"]);
});
