import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, buildOkf23Projection, createOkfMigrationPlan } from "../dist/kosmos-core.mjs";

const relationNote = (uid, title, relationships) => `---
okf_version: "2.3"
uid: "${uid}"
title: "${title}"
type: "semantic"
created_at: "2026-07-16T20:00:00Z"
authorship:
  origin: "authored"
epistemic:
  state: "hypothesis"
sensitivity:
  level: "internal"
provenance: {}
relationships:
${relationships}
review: {}
assessment: {}
labels:
  authored: []
  derived: []
  proposed: []
  approved: []
---
Body.
`;

test("selective v1.2 backport preserves refines, blocks, and documents with inverse edges", () => {
  const targetUid = "019b2d14-4230-7db7-87d4-7d81cfaec9b2";
  const source = relationNote(
    "019b2d14-4230-7db7-87d4-7d81cfaec9b1",
    "Source",
    ["  refines:", `    - target: "${targetUid}"`, "      origin: \"authored\"", "  blocks:", `    - target: "${targetUid}"`, "      origin: \"authored\"", "  documents:", `    - target: "${targetUid}"`, "      origin: \"authored\""].join("\n"),
  );
  const target = relationNote(targetUid, "Target", "  related_to: []");
  const projection = buildOkf23Projection(source, "Source.md", "r:1", null);
  for (const label of ["refines", "blocks", "documents"]) assert.ok(projection.authored.relationships[label]);

  const graph = buildGraph([
    { relativePath: "Source.md", extension: "md", content: source },
    { relativePath: "Target.md", extension: "md", content: target },
  ], [], Date.parse("2026-07-18T00:00:00Z"));
  const derived = graph.nodes.find((node) => node.path === "Target.md").okf.projection.derived.relationships;
  for (const inverse of ["refined_by", "blocked_by", "documented_by"]) assert.ok(derived[inverse]);
});

test("selective v1.2 backport does not promote unasserted epistemic states to fact", async () => {
  const generated = (state) => `---
okf_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec932"
title: "Generated"
type: "semantic"
created_at: "2026-07-01T00:00:00Z"
updated_at: "2026-07-01T01:00:00Z"
authorship:
  origin: "authored"
  author_id: "migration:human-review-required"
epistemic:
  state: "${state}"
sensitivity:
  level: "secret"
provenance:
  source_kind: "migration"
  extraction:
    method: "deterministic-migration"
review: {}
assessment: {}
labels:
  authored: []
  derived: []
  proposed: []
  approved: []
created_at: "2026-07-02T00:00:00Z"
updated_at: "2026-07-02T01:00:00Z"
---
Body.
`;
  for (const [state, expected] of [["unknown", "hypothesis"], ["observation", "hypothesis"], ["reported", "hypothesis"], ["contested", "hypothesis"], ["accepted", "fact"]]) {
    const plan = await createOkfMigrationPlan([{ path: "Generated.md", content: generated(state) }], {
      now: () => new Date("2026-07-14T12:00:00.000Z"),
      uuid: () => "00000000-0000-4000-8000-000000000001",
    });
    assert.match(plan.entries[0].proposedContent, new RegExp(`epistemic_state: "${expected}"`));
  }
});
