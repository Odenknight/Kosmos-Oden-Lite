import test from "node:test";
import assert from "node:assert/strict";
import { boundedOkfBlockedFrontmatter, validateOkfBlockedModelReview } from "../dist/kosmos-core.mjs";

const blockedEntry = {
  path: "Blocked.md",
  status: "blocked",
  standard: "none",
  findings: [{ code: "duplicate-key", message: "Duplicate YAML key." }],
  review: { required: true, confidence: 0.1, basis: "deterministic-migration-safety", reasons: [{ code: "duplicate-key", message: "Duplicate YAML key." }] },
  originalHash: "a".repeat(64),
  originalContent: "",
};

test("blocked-note excerpt is frontmatter-only and redacts likely credentials", () => {
  const source = ["---", 'title: "Example"', 'api_key: "do-not-send"', "private_key: |", "  multiline-secret-material", 'nested_secret_name: "hidden"', 'credentials: { api_key: "inline-secret" }', "---", "Body must never enter blocked review."].join("\n");
  const result = boundedOkfBlockedFrontmatter(source, 4000);
  assert.match(result.excerpt, /title: "Example"/);
  assert.doesNotMatch(result.excerpt, /do-not-send|multiline-secret-material|inline-secret|hidden|Body must never/);
  assert.equal((result.excerpt.match(/\[REDACTED\]/g) ?? []).length, 4);
});

test("unterminated frontmatter is omitted instead of guessing its boundary", () => {
  const result = boundedOkfBlockedFrontmatter("---\ntitle: Broken\nPossible body text", 4000);
  assert.equal(result.excerpt, "");
  assert.match(result.reason, /Unterminated frontmatter was omitted/);
});

test("blocked-note model review must cite deterministic findings and remains advisory", () => {
  const review = validateOkfBlockedModelReview({
    classification: "identity-decision",
    summary: "A human must decide which duplicate key is authoritative.",
    manualSteps: ["Compare both key values.", "Retain the intended value."],
    questionsForHuman: ["Which value reflects the author's intent?"],
    confidence: 0.72,
    evidenceFindingCodes: ["duplicate-key", "invented-code"],
    replacementYaml: "ignored: true",
  }, blockedEntry);
  assert.equal(review.path, "Blocked.md");
  assert.deepEqual(review.evidenceFindingCodes, ["duplicate-key"]);
  assert.equal("replacementYaml" in review, false);
  assert.throws(() => validateOkfBlockedModelReview({
    classification: "mechanical", summary: "No citation.", manualSteps: [], questionsForHuman: [], confidence: 0.5, evidenceFindingCodes: ["invented-code"],
  }, blockedEntry), /did not cite/);
});
