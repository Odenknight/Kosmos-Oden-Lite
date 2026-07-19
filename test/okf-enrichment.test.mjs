import test from "node:test";
import assert from "node:assert/strict";
import {
  assessOkfEvidence,
  createOkfEnrichmentApplyPlan,
  deterministicOkfSuggestions,
  publicOkfEnrichmentApplyPlan,
  selectOkfEvidenceWindow,
  sha256Text,
  validateLlmEnrichmentResponse,
  verifyOkfEnrichmentApplyPlan,
} from "../dist/kosmos-core.mjs";

const canonicalNote = (title = "Current Guide", body = "# Current Guide\n\nBody bytes stay exactly the same.\n") => [
  "---",
  'okf_version: "2.3"',
  'uid: "12345678-1234-4123-8123-123456789abc"',
  `title: "${title}"`,
  'type: "semantic"',
  'created_at: "2026-07-15T12:00:00.000Z"',
  'description: "Old description" # preserve this human comment',
  "tags:",
  '  - "existing"',
  "authorship:",
  '  origin: "authored"',
  "epistemic:",
  '  state: "hypothesis"',
  "sensitivity:",
  '  level: "internal"',
  "provenance: {}",
  "relationships: {}",
  "review: {}",
  "assessment: {}",
  "labels:",
  "  authored: []",
  "  derived: []",
  "  proposed: []",
  "  approved: []",
  "---",
  body,
].join("\n");

const editable22 = `---
okf_version: "2.2"
uid: "22345678-1234-4123-8123-123456789abc"
type: "semantic"
title: "Editable Guide"
description: "Old description"
timestamp: "2026-07-15T12:00:00.000Z"
epistemic_state: "hypothesis"
scope: "node"
scope_id: "22345678-1234-4123-8123-123456789abc"
sensitivity: "internal"
tags: [existing]
supersedes: []
superseded_by: []
forked_from: []
forked_to: []
---
# Editable Guide

Human body.
`;

const suggestion = (field, value, confidence = 0.8) => ({
  field, value, confidence, reason: `Reviewed evidence for ${field}`,
  evidenceBlockIds: [1], source: "deterministic",
});

const accept = (suggestionIndex, item, finalValue = item.value) => ({
  suggestionIndex,
  decision: "accepted",
  edited: JSON.stringify(finalValue) !== JSON.stringify(item.value),
  originalSuggestion: item,
  finalSuggestion: { ...item, value: finalValue },
});

test("evidence window excludes code/tables and selects bounded reproducible prose", async () => {
  const note = [
    "---", 'okf_version: "2.3"', "---", "# Build guide", "",
    "| key | value |", "|---|---|", "", "```sh", "rm -rf pretend", "```", "",
    "This guide explains the controlled deployment process and the evidence that an operator must review before release.", "",
    "This version supersedes [[Older Guide]] and records the explicit reason for replacement.", "", "#tag-one #tag-two",
  ].join("\n");
  const first = await selectOkfEvidenceWindow(note, { maxParagraphs: 2, maxChars: 500 });
  const second = await selectOkfEvidenceWindow(note, { maxParagraphs: 2, maxChars: 500 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.doesNotMatch(first.map((block) => block.text).join(" "), /rm -rf|key \| value/);
  assert.ok(first.every((block) => /^sha256:[0-9a-f]{64}$/.test(block.fingerprint)));
  const suggestions = deterministicOkfSuggestions(first);
  assert.ok(suggestions.some((item) => item.field === "supersedes" && item.value === "[[Older Guide]]"));
  assert.ok(suggestions.every((item) => item.source === "deterministic"));
});

test("LLM response validation rejects unsupported, ungrounded, and excessive proposals", async () => {
  const blocks = await selectOkfEvidenceWindow("A sufficiently long paragraph supplies bounded evidence for a controlled metadata proposal and nothing else.");
  const result = validateLlmEnrichmentResponse({ suggestions: [
    { field: "description", value: "Grounded summary", confidence: 0.7, reason: "Supported by the only block", evidenceBlockIds: [1] },
    { field: "delete_note", value: "yes", confidence: 1, reason: "bad", evidenceBlockIds: [1] },
    { field: "supersedes", value: "[[Invented]]", confidence: 0.9, reason: "no evidence id", evidenceBlockIds: [] },
    { field: "tags", value: ["one", 2, "two"], confidence: 4, reason: "invalid confidence", evidenceBlockIds: [1] },
  ] }, blocks, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].field, "description");
  assert.equal(result[0].source, "llm");
});

test("LLM cannot propose governance authority or invent relationship targets", async () => {
  const blocks = await selectOkfEvidenceWindow("This controlled guide supersedes [[Old Guide]] because the former process is obsolete and should no longer be used.");
  const result = validateLlmEnrichmentResponse({ suggestions: [
    { field: "sensitivity", value: "public", confidence: 1, reason: "model decided", evidenceBlockIds: [1] },
    { field: "supersedes", value: "[[Invented Guide]]", confidence: 0.9, reason: "not actually named", evidenceBlockIds: [1] },
    { field: "supersedes", value: "[[Old Guide]]", confidence: 0.8, reason: "explicitly named after supersedes", evidenceBlockIds: [1] },
    { field: "related_to", value: "[[Missing Link]]", confidence: 0.8, reason: "not present", evidenceBlockIds: [1] },
  ] }, blocks, 12);
  assert.deepEqual(result.map((item) => [item.field, item.value]), [["supersedes", "[[Old Guide]]"]]);
});

test("insufficient structure is reported as fallback evidence, not semantic certainty", async () => {
  const blocks = await selectOkfEvidenceWindow("12345 67890 12345 67890 12345 67890 12345 67890");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].selectionRule, "fallback-prose");
  const description = deterministicOkfSuggestions(blocks).find((item) => item.field === "description");
  assert.ok(description);
  assert.ok(description.confidence < 0.7);
  const assessment = assessOkfEvidence(blocks);
  assert.equal(assessment.status, "weak");
  assert.ok(assessment.reasons.some((reason) => /fallback/i.test(reason)));
});

test("governed apply plan binds reviewed edits and safely merges metadata without changing the body", async () => {
  const content = canonicalNote();
  const proposals = [
    suggestion("description", "Draft description"),
    suggestion("type", "procedural"),
    suggestion("tags", ["new-tag"]),
    suggestion("supersedes", "[[Old Guide]]"),
    suggestion("related_to", "[[Project Hub]]"),
  ];
  const plan = await createOkfEnrichmentApplyPlan([{
    path: "Current Guide.md",
    proposalId: "proposal-1",
    expectedNoteHash: await sha256Text(content),
    content,
    decisions: proposals.map((item, index) => accept(index, item, index === 0 ? "Reviewer-approved description" : item.value)),
  }], {
    now: () => new Date("2026-07-16T00:00:00.000Z"),
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    resolveRelationship: async (_source, target) => ({ "Old Guide": "Old Guide.md", "Project Hub": "Project Hub.md" })[target] ?? null,
  });
  assert.equal(plan.totals.ready, 1);
  assert.equal(plan.totals.edited, 1);
  assert.equal(await verifyOkfEnrichmentApplyPlan(plan), true);
  const proposed = plan.entries[0].proposedContent;
  assert.match(proposed, /description: "Reviewer-approved description"/);
  assert.match(proposed, /type: "procedural"/);
  assert.match(proposed, /# preserve this human comment/);
  assert.match(proposed, /  - "existing"\n  - "new-tag"/);
  assert.match(proposed, /supersedes:\n  - "\[\[Old Guide\]\]"/);
  assert.match(proposed, /related_to:\n  - "\[\[Project Hub\]\]"/);
  assert.equal(proposed.slice(proposed.indexOf("---\n# Current Guide") + 4), content.slice(content.indexOf("---\n# Current Guide") + 4));
  const persisted = JSON.stringify(publicOkfEnrichmentApplyPlan(plan));
  assert.doesNotMatch(persisted, /Body bytes stay exactly the same|originalContent|proposedContent/);
});

test("apply plan verification detects decision tampering", async () => {
  const content = canonicalNote();
  const item = suggestion("description", "Reviewed description");
  const plan = await createOkfEnrichmentApplyPlan([{
    path: "Current Guide.md", proposalId: "proposal-2", expectedNoteHash: await sha256Text(content), content,
    decisions: [accept(0, item)],
  }]);
  assert.equal(await verifyOkfEnrichmentApplyPlan(plan), true);
  plan.entries[0].decisions[0].finalSuggestion.value = "Tampered after preview";
  assert.equal(await verifyOkfEnrichmentApplyPlan(plan), false);
});

test("reviewed labels and links stay flat and human-editable on OKF+ 2.2 notes", async () => {
  const proposals = [suggestion("tags", ["selected-label"]), suggestion("related_to", "[[Project Hub]]")];
  const plan = await createOkfEnrichmentApplyPlan([{
    path: "Editable Guide.md", proposalId: "editable-22", expectedNoteHash: await sha256Text(editable22), content: editable22,
    decisions: proposals.map((item, index) => accept(index, item)),
  }], { resolveRelationship: async (_source, target) => target === "Project Hub" ? "Project Hub.md" : null });
  assert.equal(plan.totals.ready, 1);
  const proposed = plan.entries[0].proposedContent;
  assert.match(proposed, /okf_version: "2\.2"/);
  assert.match(proposed, /tags:\n  - "existing"\n  - "selected-label"/);
  assert.match(proposed, /related_to:\n  - "\[\[Project Hub\]\]"/);
  assert.doesNotMatch(proposed, /authorship:|authorization:|labels:/);
  assert.ok(proposed.endsWith("# Editable Guide\n\nHuman body.\n"));
});

test("changed sources, unresolved/self relationships, and conflicting scalars are blocked", async () => {
  const content = canonicalNote();
  const old = suggestion("supersedes", "[[Missing Guide]]");
  const self = suggestion("related_to", "[[Current Guide]]");
  const descriptionA = suggestion("description", "Description A");
  const descriptionB = suggestion("description", "Description B");
  const noteHash = await sha256Text(content);
  const plan = await createOkfEnrichmentApplyPlan([
    { path: "Changed.md", proposalId: "changed", expectedNoteHash: "0".repeat(64), content, decisions: [accept(0, descriptionA)] },
    { path: "Missing.md", proposalId: "missing", expectedNoteHash: noteHash, content, decisions: [accept(0, old)] },
    { path: "Current Guide.md", proposalId: "self", expectedNoteHash: noteHash, content, decisions: [accept(0, self)] },
    { path: "Conflict.md", proposalId: "conflict", expectedNoteHash: noteHash, content, decisions: [accept(0, descriptionA), accept(1, descriptionB)] },
  ], { resolveRelationship: async (_source, target) => target === "Current Guide" ? "Current Guide.md" : null });
  assert.equal(plan.totals.blocked, 4);
  assert.match(plan.entries.find((entry) => entry.path === "Changed.md").reasons.join(" "), /changed after/);
  assert.match(plan.entries.find((entry) => entry.path === "Missing.md").reasons.join(" "), /does not resolve/);
  assert.match(plan.entries.find((entry) => entry.path === "Current Guide.md").reasons.join(" "), /same note/);
  assert.match(plan.entries.find((entry) => entry.path === "Conflict.md").reasons.join(" "), /conflicting description/);
});
