import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreVaultPath } from "../dist/kosmos-core.mjs";

test("scanners skip current and pre-rename state folders", () => {
  for (const p of [".gkx/backup/r1/a.md", ".okf/backup/r1/a.md", ".okf/migrations/r1/a.md", ".okf/enrichment/x.md"]) {
    assert.equal(shouldIgnoreVaultPath(p), true, p);
  }
  for (const p of ["a.md", "notes/okf-history.md", "gkx/a.md"]) assert.equal(shouldIgnoreVaultPath(p), false, p);
});
