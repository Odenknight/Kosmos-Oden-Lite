import test from "node:test";
import assert from "node:assert/strict";
import { COMMON_GKX_DEVELOPER_EXCLUSIONS, effectiveGkxExclusionPatterns, isGkxPathExcluded, matchedGkxExclusion, normalizeGkxExclusionPatterns } from "../dist/kosmos-core.mjs";

test("developer exclusion preset matches common agent-control files at any depth", () => {
  assert.ok(COMMON_GKX_DEVELOPER_EXCLUSIONS.includes("**/AGENTS.md"));
  for (const path of ["AGENT.md", "project/AGENTS.md", "team/CLAUDE.md", "_Claude-Code/SESSION-LOG.md", "project/.claude/rules.md", ".github/copilot-instructions.md"]) {
    assert.equal(isGkxPathExcluded(path, [], true), true, path);
  }
  assert.equal(isGkxPathExcluded("Knowledge/Agents as a Concept.md", [], true), false);
  assert.equal(isGkxPathExcluded("README.md", [], true), false);
});

test("custom exclusions support basename and bounded glob patterns without enabling presets", () => {
  const patterns = normalizeGkxExclusionPatterns([" private/** ", "DRAFT.md", "projects/*/generated-?.md", "DRAFT.md"]);
  assert.deepEqual(patterns, ["private/**", "DRAFT.md", "projects/*/generated-?.md"]);
  assert.equal(matchedGkxExclusion("private/nested/note.md", patterns, false), "private/**");
  assert.equal(matchedGkxExclusion("area/DRAFT.md", patterns, false), "DRAFT.md");
  assert.equal(matchedGkxExclusion("projects/a/generated-1.md", patterns, false), "projects/*/generated-?.md");
  assert.equal(isGkxPathExcluded("area/AGENTS.md", patterns, false), false);
  assert.equal(effectiveGkxExclusionPatterns(patterns, true).length, patterns.length + COMMON_GKX_DEVELOPER_EXCLUSIONS.length);
});
