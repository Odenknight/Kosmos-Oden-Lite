import test from "node:test";
import assert from "node:assert/strict";
import {
  createGkxMigrationPlan,
  publicGkxMigrationPlan,
  verifyGkxMigrationPlan,
} from "../dist/kosmos-core.mjs";

const UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
];

function options() {
  let i = 0;
  return {
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    uuid: () => UUIDS[i++] ?? `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  };
}

const validGkx = `---
gkx_version: "2.2"
uid: "11111111-1111-4111-8111-111111111111"
type: "semantic"
title: "Existing"
description: "Already conformant."
timestamp: "2026-07-01T00:00:00Z"
epistemic_state: "hypothesis"
scope: "node"
scope_id: "11111111-1111-4111-8111-111111111111"
sensitivity: "internal"
tags: []
supersedes: []
superseded_by: []
forked_from: []
forked_to: []
---
Body.
`;

const nativeGkx23 = `---
gkx_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec932"
title: "Native"
type: "semantic"
created_at: "2026-07-01T00:00:00Z"
authorship:
  origin: "authored"
epistemic:
  state: "hypothesis"
sensitivity:
  level: "internal"
provenance: {}
relationships: {}
review: {}
assessment: {}
labels:
  authored: []
  derived: []
  proposed: []
  approved: []
---
Native body.
`;

test("GKX onboarding retains native 2.3, keeps editable 2.2, and accepts Google's minimal OKF", async () => {
  const plan = await createGkxMigrationPlan([
    { path: "Native.md", content: nativeGkx23 },
    { path: "Existing.md", content: validGkx },
    { path: "Google.md", content: "---\ntype: Playbook\ntitle: Google-compatible\n---\nBody\n" },
    { path: "index.md", content: "# Index\n" },
  ], options());
  assert.equal(plan.totals["gkx-2.3"], 1);
  assert.equal(plan.totals["gkx-2.2"], 1);
  assert.equal(plan.totals["google-okf-0.1"], 1);
  assert.equal(plan.totals["google-reserved"], 1);
  assert.equal(plan.totals.changes, 0);
  assert.equal(plan.entries.find((entry) => entry.path === "Existing.md").proposedContent, undefined);
});

test("missing frontmatter gets compact editable GKX 2.2 without changing body bytes", async () => {
  const body = "# Alpha\r\n\r\nHuman text.\r\n";
  const plan = await createGkxMigrationPlan([
    { path: "Folder/Alpha.md", content: "\uFEFF" + body, createdTime: Date.parse("2025-03-04T05:06:07Z") },
  ], options());
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.match(entry.proposedContent, /^\uFEFF---\r\ngkx_version: "2\.2"/);
  assert.match(entry.proposedContent, /type: "semantic"/);
  assert.match(entry.proposedContent, /epistemic_state: "hypothesis"/);
  assert.match(entry.proposedContent, /sensitivity: "internal"/);
  assert.match(entry.proposedContent, /timestamp: "2025-03-04T05:06:07\.000Z"/);
  assert.doesNotMatch(entry.proposedContent, /authorship:|authorization:|labels:/);
  assert.ok(entry.proposedContent.endsWith(body), "body bytes after frontmatter are preserved");
  const rescan = await createGkxMigrationPlan([{ path: "Folder/Alpha.md", content: entry.proposedContent }], options());
  assert.equal(rescan.totals["gkx-2.2"], 1);
  assert.equal(rescan.totals.changes, 0);
});

test("explicit convert-to-23 mode writes the flat editable 2.3 profile without nested blocks", async () => {
  const source = validGkx.replace("tags: []", 'tags:\n  - "research"').replace("forked_to: []", 'forked_to: []\nrelated_to:\n  - "[[Native]]"');
  const plan = await createGkxMigrationPlan([{ path: "Existing.md", content: source }], { ...options(), mode: "convert-to-23" });
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.equal(entry.findings[0].code, "convert-gkx-2.2-to-2.3");
  assert.match(entry.proposedContent, /gkx_version: "2\.3"/);
  assert.match(entry.proposedContent, /epistemic_state: "hypothesis"/);
  assert.match(entry.proposedContent, /sensitivity: "internal"/);
  assert.match(entry.proposedContent, /authorship_origin: "authored"/);
  assert.match(entry.proposedContent, /scope: "node"/);
  assert.match(entry.proposedContent, /tags:\n  - "research"/);
  assert.match(entry.proposedContent, /related_to:\n  - "\[\[Native\]\]"/);
  // Every property is a flat scalar or string list Obsidian Properties can edit.
  assert.doesNotMatch(entry.proposedContent, /^(authorship|epistemic|provenance|relationships|evidence|lineage|review|assessment|authorization|labels|x-gkx22-compatibility):/m);
  assert.doesNotMatch(entry.proposedContent, /migration:human-review-required/);
  assert.ok(entry.proposedContent.endsWith("Body.\n"));
  const rescan = await createGkxMigrationPlan([{ path: "Existing.md", content: entry.proposedContent }], options());
  assert.equal(rescan.totals["gkx-2.3"], 1);
  assert.equal(rescan.totals.changes, 0);
});

test("simple Obsidian properties are preserved after canonical GKX fields", async () => {
  const original = `---
aliases: [Alpha alias]
cssclasses: [wide]
tags: [one, one, two]
---
Text
`;
  const plan = await createGkxMigrationPlan([{ path: "Alpha.md", content: original }], options());
  const out = plan.entries[0].proposedContent;
  assert.match(out, /tags:\n  - "one"\n  - "two"/);
  assert.ok(out.indexOf("forked_to: []") < out.indexOf("aliases: [Alpha alias]"));
  assert.match(out, /cssclasses: \[wide\]/);
  assert.ok(out.endsWith("Text\n"));
});

test("quoted hash characters and human frontmatter comments survive normalization", async () => {
  const original = `---
title: "A # B" # keep this title note
# keep this standalone note
aliases: [hash-test]
---
Body
`;
  const plan = await createGkxMigrationPlan([{ path: "Hash.md", content: original }], options());
  const out = plan.entries[0].proposedContent;
  assert.match(out, /title: "A # B"/);
  assert.match(out, /# keep this title note/);
  assert.match(out, /# keep this standalone note/);
});

test("ambiguous or destructive frontmatter is blocked instead of guessed", async () => {
  const plan = await createGkxMigrationPlan([
    { path: "Duplicate.md", content: "---\ntags: [a]\ntags: [b]\n---\nBody\n" },
    { path: "Nested.md", content: "---\nscope:\n  kind: project\n---\nBody\n" },
    { path: "Invalid-v2.2.md", content: "---\ngkx_version: '2.2'\nuid: unknown\ntype: semantic\n---\nBody\n" },
    { path: "Only-delimiter.md", content: "---" },
  ], options());
  assert.equal(plan.totals.blocked, 4);
  assert.equal(plan.totals.changes, 0);
  assert.ok(plan.entries.every((e) => e.proposedContent == null));
  assert.ok(plan.entries.every((e) => e.review.required));
  assert.ok(plan.entries.every((e) => e.review.confidence <= 0.25));
  assert.ok(plan.entries.every((e) => e.review.reasons.length > 0));
});

test("upgrade-all converts recoverable legacy notes and preserves overridden values in salvage", async () => {
  const legacy = `---
gkx_version: "2.1"
uid: unknown
id: unknown
type: memo
title: Legacy
timestamp: yesterday
epistemic_state: inferred
scope: somewhere
sensitivity: secret
tags: [legacy]
---
Body remains exact.
`;
  const unsafe = `---
gkx_version: "2.1"
type: semantic
related_to: [not-a-wikilink]
---
Unsafe
`;
  const plan = await createGkxMigrationPlan([
    { path: "Google.md", content: "---\nid: 22222222-2222-4222-8222-222222222222\ntype: Playbook\ntitle: Google-compatible\n---\nBody\n" },
    { path: "index.md", content: "# Reserved index\n" },
    { path: "Legacy.md", content: legacy, createdTime: Date.parse("2025-01-02T03:04:05Z") },
    { path: "Unsafe.md", content: unsafe },
  ], { ...options(), mode: "upgrade-all" });

  assert.equal(plan.schema, "gkx-migration-plan/4");
  assert.equal(plan.mode, "upgrade-all");
  assert.equal(plan.totals.changes, 3);
  assert.equal(plan.totals.blocked, 1);
  const google = plan.entries.find((entry) => entry.path === "Google.md");
  assert.match(google.proposedContent, /gkx_version: "2\.2"/);
  assert.match(google.proposedContent, /uid: "22222222-2222-4222-8222-222222222222"/);
  assert.doesNotMatch(google.proposedContent, /^id:/m);
  assert.match(google.proposedContent, /type: "semantic"/);
  assert.ok(google.findings.some((finding) => finding.code === "upgrade-google-okf"));
  const reserved = plan.entries.find((entry) => entry.path === "index.md");
  assert.equal(reserved.status, "needs-gkx");
  assert.ok(reserved.findings.some((finding) => finding.code === "upgrade-google-reserved"));
  const upgraded = plan.entries.find((entry) => entry.path === "Legacy.md");
  assert.match(upgraded.proposedContent, /uid: "00000000-0000-4000-8000-00000000000/);
  assert.match(upgraded.proposedContent, /epistemic_state: "hypothesis"/);
  assert.match(upgraded.proposedContent, /sensitivity: "secret"/);
  assert.ok(upgraded.proposedContent.endsWith("Body remains exact.\n"));
  assert.ok(upgraded.salvage.some((record) => record.field === "gkx_version" && record.originalValue === "2.1"));
  assert.ok(upgraded.salvage.some((record) => record.field === "uid" && record.originalValue === "unknown"));
  assert.ok(upgraded.salvage.some((record) => record.field === "id" && record.originalValue === "unknown"));
  assert.doesNotMatch(upgraded.proposedContent, /^id:/m);
  assert.equal(upgraded.review.basis, "deterministic-migration-safety");
  assert.equal(upgraded.review.required, false);
  assert.ok(upgraded.review.confidence < 0.9);
  const blocked = plan.entries.find((entry) => entry.path === "Unsafe.md");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.review.required, true);
  assert.ok(blocked.review.reasons.some((finding) => finding.code === "unsafe-explicit-related_to"));
});

test("duplicate GKX UIDs are a global blocking conflict", async () => {
  const two = validGkx.replace("title: \"Existing\"", "title: \"Second\"");
  const plan = await createGkxMigrationPlan([
    { path: "One.md", content: validGkx },
    { path: "Two.md", content: two },
  ], options());
  assert.equal(plan.totals.blocked, 2);
  assert.ok(plan.entries.every((e) => e.findings.some((f) => f.code === "duplicate-uid")));
});

test("persistable plan binds hashes but never includes note contents", async () => {
  const plan = await createGkxMigrationPlan([{ path: "Secret.md", content: "TOP SECRET BODY" }], options());
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  const persisted = JSON.stringify(publicGkxMigrationPlan(plan));
  assert.doesNotMatch(persisted, /TOP SECRET BODY/);
  assert.match(persisted, /originalHash/);
  assert.match(persisted, /proposedHash/);
  assert.match(persisted, /deterministic-migration-safety/);
  assert.equal(await verifyGkxMigrationPlan(plan), true);
  const originalConfidence = plan.entries[0].review.confidence;
  plan.entries[0].review.confidence = 0;
  assert.equal(await verifyGkxMigrationPlan(plan), false, "review confidence is covered by the plan hash");
  plan.entries[0].review.confidence = originalConfidence;
  assert.equal(await verifyGkxMigrationPlan(plan), true);
  plan.entries[0].proposedContent += "tampered";
  assert.equal(await verifyGkxMigrationPlan(plan), false);
});

test("nonempty relationship lists remain flat, quoted, and editable in Obsidian", async () => {
  const input = validGkx.replace("forked_to: []", "forked_to: []\nrelated_to: [\"[[Neighbor]]\"]");
  const plan = await createGkxMigrationPlan([{ path: "Existing.md", content: input }], options());
  assert.equal(plan.entries[0].status, "needs-gkx");
  assert.match(plan.entries[0].proposedContent, /related_to:\n  - "\[\[Neighbor\]\]"/);
});

test("beta.10-generated 2.3 metadata is safely flattened and duplicate timestamps are removed", async () => {
  const broken = `---
gkx_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec932"
title: "Generated"
type: "semantic"
created_at: "2026-07-01T00:00:00Z"
updated_at: "2026-07-01T01:00:00Z"
description: "Keep me editable."
tags: [alpha, beta]
authorship:
  origin: "authored"
  author_id: "migration:human-review-required"
epistemic:
  state: "fact"
sensitivity:
  level: "secret"
provenance:
  source_kind: "migration"
  extraction:
    method: "deterministic-migration"
relationships:
  related_to:
    - target: "[[Neighbor]]"
      origin: "authored"
review: {}
assessment: {}
labels:
  authored: []
  derived: []
  proposed: []
  approved: []
created_at: "2026-07-02T00:00:00Z"
updated_at: "2026-07-02T01:00:00Z"
aliases: [Generated alias]
---
Body bytes remain exact.
`;
  const plan = await createGkxMigrationPlan([{ path: "Generated.md", content: broken }], options());
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.ok(entry.findings.some((finding) => finding.code === "repair-generated-gkx-2.3"));
  assert.match(entry.proposedContent, /gkx_version: "2\.2"/);
  assert.match(entry.proposedContent, /epistemic_state: "fact"/);
  assert.match(entry.proposedContent, /sensitivity: "secret"/);
  assert.match(entry.proposedContent, /tags:\n  - "alpha"\n  - "beta"/);
  assert.match(entry.proposedContent, /related_to:\n  - "\[\[Neighbor\]\]"/);
  assert.match(entry.proposedContent, /aliases:\n  - "Generated alias"/);
  assert.equal((entry.proposedContent.match(/^timestamp:/gm) ?? []).length, 1);
  assert.equal((entry.proposedContent.match(/^created_at:/gm) ?? []).length, 0);
  assert.equal((entry.proposedContent.match(/^updated_at:/gm) ?? []).length, 0);
  assert.doesNotMatch(entry.proposedContent, /authorship:|provenance:|authorization:|labels:/);
  assert.ok(entry.proposedContent.endsWith("Body bytes remain exact.\n"));
});

// ── v1.0.5: auto-stamper timestamp collision fix ──────────────────────────────

test("converting a plain note carrying stamper created_at/updated_at to flat 2.3 emits each key once and preserves the stamper's created_at", async () => {
  const stamped = `---
created_at: 2026-03-01T09:00:00Z
updated_at: 2026-03-05T10:00:00Z
title: Plain Note
type: semantic
---
Plain body.
`;
  const plan = await createGkxMigrationPlan([{ path: "Plain.md", content: stamped }], { ...options(), mode: "convert-to-23" });
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.equal((entry.proposedContent.match(/^created_at:/gm) ?? []).length, 1);
  assert.equal((entry.proposedContent.match(/^updated_at:/gm) ?? []).length, 1);
  assert.match(entry.proposedContent, /created_at: "2026-03-01T09:00:00Z"/);
  assert.match(entry.proposedContent, /updated_at: "2026-03-05T10:00:00Z"/);
  assert.match(entry.proposedContent, /gkx_version: "2\.3"/);
  // Output is clean flat 2.3, and a rescan proposes zero further changes.
  const rescan = await createGkxMigrationPlan([{ path: "Plain.md", content: entry.proposedContent }], options());
  assert.equal(rescan.totals["gkx-2.3"], 1);
  assert.equal(rescan.totals.changes, 0);
});

test("converting a 2.2 note carrying stamper created_at/updated_at to 2.3 does not duplicate the timestamp keys", async () => {
  const source = validGkx.replace("forked_to: []", "forked_to: []\ncreated_at: 2026-02-02T08:00:00Z\nupdated_at: 2026-02-09T08:00:00Z");
  const plan = await createGkxMigrationPlan([{ path: "Existing.md", content: source }], { ...options(), mode: "convert-to-23" });
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.equal((entry.proposedContent.match(/^created_at:/gm) ?? []).length, 1);
  assert.equal((entry.proposedContent.match(/^updated_at:/gm) ?? []).length, 1);
  // The stamper's created_at is preferred over the 2.2 timestamp for created_at.
  assert.match(entry.proposedContent, /created_at: "2026-02-02T08:00:00Z"/);
  assert.match(entry.proposedContent, /updated_at: "2026-02-09T08:00:00Z"/);
  const rescan = await createGkxMigrationPlan([{ path: "Existing.md", content: entry.proposedContent }], options());
  assert.equal(rescan.totals.changes, 0);
});

test("converting a note with stamper fields to 2.2 drops created_at/updated_at and derives timestamp from created_at", async () => {
  const stamped = `---
created_at: 2026-02-02T08:00:00Z
updated_at: 2026-02-09T08:00:00Z
title: Legacy
---
Body.
`;
  const plan = await createGkxMigrationPlan([{ path: "Legacy.md", content: stamped }], { ...options(), mode: "upgrade-all" });
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.match(entry.proposedContent, /gkx_version: "2\.2"/);
  assert.equal((entry.proposedContent.match(/^created_at:/gm) ?? []).length, 0);
  assert.equal((entry.proposedContent.match(/^updated_at:/gm) ?? []).length, 0);
  assert.match(entry.proposedContent, /timestamp: "2026-02-02T08:00:00Z"/);
});

test("marker-less duplicate created_at/updated_at is repaired by a bounded dedupe; other duplicates stay blocked; beta.10 notes still flatten", async () => {
  // The user's exact broken state: a quoted timestamp pair mid-block plus an
  // unquoted appended pair written by the auto-stamper — no beta.10 marker.
  const brokenDup = `---
gkx_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec932"
title: "User Note"
type: "semantic"
created_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-02T00:00:00Z"
description: "Real user note."
tags:
  - "alpha"
epistemic_state: "hypothesis"
sensitivity: "internal"
authorship_origin: "authored"
created_at: 2026-03-01T12:00:00Z
updated_at: 2026-03-10T12:00:00Z
---
User body stays exact.
`;
  const plan = await createGkxMigrationPlan([{ path: "User.md", content: brokenDup }], options());
  const entry = plan.entries[0];
  assert.equal(entry.status, "needs-gkx");
  assert.ok(entry.findings.some((f) => f.code === "repair-duplicate-timestamps"));
  assert.equal((entry.proposedContent.match(/^created_at:/gm) ?? []).length, 1);
  assert.equal((entry.proposedContent.match(/^updated_at:/gm) ?? []).length, 1);
  // First created_at kept, newest updated_at kept.
  assert.match(entry.proposedContent, /created_at: "2026-01-01T00:00:00Z"/);
  assert.match(entry.proposedContent, /updated_at: "2026-03-10T12:00:00Z"/);
  // Body byte-identical; result is clean flat 2.3 on rescan.
  assert.ok(entry.proposedContent.endsWith("User body stays exact.\n"));
  const rescan = await createGkxMigrationPlan([{ path: "User.md", content: entry.proposedContent }], options());
  assert.equal(rescan.totals["gkx-2.3"], 1);
  assert.equal(rescan.totals.changes, 0);

  // A note with a DIFFERENT duplicate key (tags) is not this defect: stays blocked.
  const otherDup = `---
gkx_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec933"
title: "Other"
type: "semantic"
created_at: "2026-01-01T00:00:00Z"
tags:
  - "alpha"
tags:
  - "beta"
---
Body.
`;
  const blockedPlan = await createGkxMigrationPlan([{ path: "Other.md", content: otherDup }], options());
  assert.equal(blockedPlan.entries[0].status, "blocked");
  assert.ok(!blockedPlan.entries[0].findings.some((f) => f.code === "repair-duplicate-timestamps"));

  // Regression: a beta.10 marker-carrying note still takes the flatten repair.
  const markerNote = `---
gkx_version: "2.3"
uid: "019b2d14-4230-7db7-87d4-7d81cfaec934"
title: "Generated"
type: "semantic"
created_at: "2026-07-01T00:00:00Z"
updated_at: "2026-07-01T01:00:00Z"
authorship:
  origin: "authored"
  author_id: "migration:human-review-required"
provenance:
  extraction:
    method: "deterministic-migration"
created_at: "2026-07-02T00:00:00Z"
updated_at: "2026-07-02T01:00:00Z"
---
Body.
`;
  const markerPlan = await createGkxMigrationPlan([{ path: "Generated.md", content: markerNote }], options());
  const markerEntry = markerPlan.entries[0];
  assert.ok(markerEntry.findings.some((f) => f.code === "repair-generated-gkx-2.3"));
  assert.ok(!markerEntry.findings.some((f) => f.code === "repair-duplicate-timestamps"));
});
