import test from "node:test";
import assert from "node:assert/strict";
import { COMMON_OKF_DEVELOPER_EXCLUSIONS, effectiveOkfExclusionPatterns, isOkfPathExcluded, matchedOkfExclusion, normalizeOkfExclusionPatterns } from "../dist/kosmos-core.mjs";

test("developer exclusion preset matches common agent-control files at any depth", () => {
  assert.ok(COMMON_OKF_DEVELOPER_EXCLUSIONS.includes("**/AGENTS.md"));
  for (const path of ["AGENT.md", "project/AGENTS.md", "team/CLAUDE.md", "_Claude-Code/SESSION-LOG.md", "project/.claude/rules.md", ".github/copilot-instructions.md"]) {
    assert.equal(isOkfPathExcluded(path, [], true), true, path);
  }
  assert.equal(isOkfPathExcluded("Knowledge/Agents as a Concept.md", [], true), false);
  assert.equal(isOkfPathExcluded("README.md", [], true), false);
});

test("custom exclusions support basename and bounded glob patterns without enabling presets", () => {
  const patterns = normalizeOkfExclusionPatterns([" private/** ", "DRAFT.md", "projects/*/generated-?.md", "DRAFT.md"]);
  assert.deepEqual(patterns, ["private/**", "DRAFT.md", "projects/*/generated-?.md"]);
  assert.equal(matchedOkfExclusion("private/nested/note.md", patterns, false), "private/**");
  assert.equal(matchedOkfExclusion("area/DRAFT.md", patterns, false), "DRAFT.md");
  assert.equal(matchedOkfExclusion("projects/a/generated-1.md", patterns, false), "projects/*/generated-?.md");
  assert.equal(isOkfPathExcluded("area/AGENTS.md", patterns, false), false);
  assert.equal(effectiveOkfExclusionPatterns(patterns, true).length, patterns.length + COMMON_OKF_DEVELOPER_EXCLUSIONS.length);
});
