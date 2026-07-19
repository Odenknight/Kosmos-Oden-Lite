# The Evolution of OKF+ Note Formatting — and How the Safeguards Held

Kosmos-Oden 0.6.5 closes a short, self-contained incident arc in the note
formatting engine: a converter shipped in a pre-release (beta.10) wrote data
into notes in a way that made them hard to edit by hand. The next pre-release
(beta.11) reversed the problem without asking anyone to restore a vault
backup, and the one after that (beta.12) removed the underlying cause. This
document describes what happened, in the order it happened, and points at the
code that did the work.

This is not a marketing narrative. Every specific claim below is backed by
either the CHANGELOG entry for that release, the migration engine source in
`src/core/okf-migration.ts`, the plugin-side apply path in
`src/plugin/okf-migration.ts`, or the test suite that exercises both.

## The safety architecture (what was already true)

Before beta.10 ever ran, the note-migration engine already had a set of
mechanical guarantees that apply to every governed write it performs — the
2.2 upgrade path, the flat-2.3 conversion path, and the repair path all share
this machinery. None of it was added in response to the incident; it is what
made the incident recoverable.

- **Every write is previewed first, as a hash-bound plan.** Scanning a vault
  never rewrites a note. It produces an `OkfMigrationPlan` — a plan hash, a
  list of entries, and for each entry the original content, hash, and
  proposed content — that is shown to the user before anything is applied.
  Applying a plan re-verifies it (`verifyOkfMigrationPlan`) and refuses to
  proceed if the plan or the in-memory note contents changed since the
  preview (`src/plugin/okf-migration.ts`, `applyOkfMigrationPlan`).
- **Byte-exact backups precede every touched file.** Before any note is
  modified, `applyOkfMigrationPlan` reads the current file with
  `readBinary` and writes an identical copy to
  `.okf/backup/<run-id>/<path>.bak` with `writeBinary`. If a backup for that
  path already exists, the apply throws rather than overwrite it.
- **A concurrent-edit check runs inside the write itself.** The actual write
  goes through `app.vault.process`, which only replaces the file's contents
  if they still match `entry.originalContent` at the moment of writing. A
  note edited by a human between the scan and the apply is skipped
  (`skippedChanged`), never overwritten with stale proposed content.
- **Body bytes are never touched — only frontmatter.** Every proposal
  function (`proposedOkf`, `proposedNativeOkf23`, `proposedEditableOkf22`)
  reconstructs the note as `bom + frontmatter-lines.join(eol) + eol + body`,
  where `body` is copied verbatim from the source. The Markdown a person
  wrote is not reformatted, re-encoded, or re-flowed by any of these paths.
- **Plans and results are persisted for audit.** Every run writes
  `.okf/migrations/<run-id>/plan.json` (content-free — note bodies are
  stripped before persisting) and `.okf/migrations/<run-id>/result.json`
  (applied, skipped, and failed paths, with the plan hash and completion
  time).

One more property turned out to matter more than anyone expected: **every
note a deterministic migrator generates carries a marker.** Generated
frontmatter includes `authorship.author_id: "migration:human-review-required"`
and `provenance.extraction.method: "deterministic-migration"`. Nothing about
this marker is specific to the incident — it exists so that any deterministic
migration output can always be told apart from something a person typed by
hand. That distinction is what made the reversal possible.

## The incident (beta.10)

beta.10 replaced the flat 2.2 compatibility writer in the Note Formatting tab
with a converter that wrote the full nested OKF+ 2.3 structure directly into
note frontmatter — governance blocks like `authorship:`, `epistemic:`,
`sensitivity:`, `provenance:`, `relationships:`, `review:`, `assessment:`,
and `labels:`, each a nested YAML object rather than a flat property.

That is a legitimate format — nested 2.3 is a real, fully-specified profile,
intended for machine-managed corpora that no human opens in a text editor.
The problem was writing it into notes a human *does* open in Obsidian:

- Obsidian's Properties UI has no editor for nested YAML objects. It
  rendered these blocks as opaque "unknown data type" JSON — visible, but not
  something a person could safely change from the Properties panel.
- The Properties panel's type-conversion dialog, if used on one of these
  fields, could destroy the nested structure rather than convert it.
- Relationship targets such as `related_to` were now nested one level down
  (`relationships.related_to[].target: "[[Neighbor]]"` rather than a
  top-level list of quoted wikilinks). Obsidian's link index and its
  "automatically update internal links on rename" feature only protect
  links that live in flat, top-level frontmatter fields — so a wikilink
  buried inside a nested structure could go stale silently the next time the
  target note was renamed.

Nothing about the body of a note was affected: content, tags, and links
inside the Markdown body were untouched, because the writer — like every
writer in this engine — only ever rewrites frontmatter. The damage was
confined to whether the *frontmatter itself* remained something a human could
keep editing, which is exactly the property OKF+ 2.2 and 2.2-shaped 2.3 exist
to protect.

## The reversal (beta.11) — no vault restore needed

beta.11 shipped a bounded repair, not a rollback. It works because of the
marker left in every note beta.10's converter had touched.

The audit path (`auditOne` in `src/core/okf-migration.ts`) checks, for every
note declaring `okf_version: "2.3"`, whether its frontmatter matches
`deterministicMigration23()` — the exact `author_id` /
`extraction.method` pair described above. Only if that marker is present
(and the only other frontmatter issues present are the duplicate
`created_at`/`updated_at` keys the beta.10 writer produced) does the note
become a repair candidate. A hand-authored native 2.3 note — one nobody ran
the converter over — carries no such marker and is never touched by this
path; the code comment on `proposedEditableOkf22` states this directly: the
function is "intentionally limited to notes carrying the
deterministic-migration marker; native authored 2.3 notes are never
flattened automatically."

For every matched note, `proposedEditableOkf22` rebuilds a flat, Properties-
editable OKF+ 2.2 frontmatter block: scalar fields for identity, type,
title, description, timestamp, epistemic state, scope, and sensitivity; flat
quoted-wikilink lists for lineage and relationship fields (pulling the
wikilink text back out of the nested `relationships.*.target` structure);
tags as a flat list; and any human YAML comments found in the original
frontmatter preserved verbatim. Duplicate `created_at`/`updated_at` keys and
the generated governance boilerplate (`review: {}`, `assessment: {}`,
`labels: {authored: [], ...}`, and similar) are dropped rather than carried
forward. The Markdown body is copied through unchanged, exactly as in every
other write path in this engine.

The plan preview for this repair goes through the same hash-bound,
backed-up, concurrent-edit-checked apply path described above — nothing
about the repair mechanism is special-cased around safety; it reuses the
same `applyOkfMigrationPlan` that every migration and conversion mode uses.
Plans and results for this run are persisted under
`.okf/migrations/<run-id>` alongside byte-exact backups under
`.okf/backup/<run-id>`, exactly like any other run.

The test suite exercises this exact scenario: a note with the nested
governance blocks, the deterministic-migration marker, and duplicate
`created_at`/`updated_at` keys is scanned, confirmed as a repair candidate,
and flattened back to editable properties with the duplicate keys and
boilerplate removed (`test/okf-migration.test.mjs`).

## The permanent fix (beta.12 → 0.6.5)

beta.11 fixed existing damage; it did not stop new damage, because the
Note Formatting tab still offered a "native 2.3" action that could, in
principle, write nested blocks into new notes. beta.12 and the 0.6.5 release
that follows it remove the cause rather than continuing to repair its output:

- **No writer in this engine emits nested governance blocks into a note
  anymore.** The only 2.3-producing action left is "Convert all to editable
  2.3," which calls `proposedNativeOkf23` — a function that, like
  `proposedEditableOkf22`, only ever emits scalars and flat quoted-wikilink
  lists. `okf_version` changes to `"2.3"` and a handful of new flat scalars
  appear (`created_at`/`updated_at` in place of `timestamp`,
  `epistemic_state`, `sensitivity`, `authorship_origin`), but there is no
  nesting anywhere in the frontmatter it writes.
- **The flat Agent-Ready 2.3 profile keeps the same grammar as 2.2.** Per
  `docs/OKF-22-VS-23-POSITIONING.md`, the visible delta between a 2.2 note
  and a flat-2.3 note is small: a renamed timestamp field, a version string,
  one added scalar, and two fields becoming optional. Nothing about how a
  person edits tags or relationship wikilinks in Obsidian's Properties panel
  changes.
- **The 2.3 governance model itself did not go away — it moved.** Origin
  separation, evidence structure, deterministic assessments, and review state
  still exist; they live in the deterministic in-memory validating
  projection, which supplies spec-permitted defaults for whatever a flat note
  doesn't state explicitly, with `.okf/` sidecars as the next design cycle's
  home for values that need to persist outside the note (see
  `docs/OKF-PLUS-MIGRATION.md` and the beta.13 design documents referenced
  from the 0.6.5 CHANGELOG entry).
- **Round-tripping is enforced, not just claimed.** Notes converted during
  the beta series rescan clean — zero proposed changes — and this is a
  tested property: `test/okf-migration.test.mjs` asserts
  `plan.totals.changes === 0` on a rescan of both an already-valid 2.2 note
  and a note freshly converted to flat editable 2.3.
- Hand-authored nested 2.3 notes remain fully supported as a read-only
  machine dialect. They are never flattened automatically by anything in
  this engine, in beta.11's repair or afterward — the marker check that
  gated the repair is the same mechanism that continues to leave them alone.

## What this proved

- **Previewed, hash-bound writes** meant nobody applied a change they hadn't
  seen, and a stale or tampered plan could not silently execute.
- **Byte-exact, per-file backups under `.okf/backup/<run-id>`** meant every
  touched file had an independent, restorable copy before it was ever
  rewritten, without depending on whatever sync or backup tooling the user
  happened to have configured.
- **A deterministic marker written into every generated note** turned "which
  notes did the faulty converter touch" into an exact, mechanical question
  instead of a guess — this is what made the fix surgical rather than a
  blanket rollback.
- **Body bytes are untouched by every writer in this engine** — the
  incident, the repair, and the permanent fix all only ever add or rewrite
  frontmatter, never the Markdown content a person wrote.
- **Authored content is never auto-flattened.** The same check that found
  the beta.10-generated notes is the check that leaves genuinely
  hand-authored nested 2.3 notes alone; there is no path in this engine that
  rewrites a note just because it looks like the machine dialect.

The general lesson generalizes past this one incident: governance metadata —
provenance, evidence structure, review state, the machinery an agent needs
but a human doesn't hand-author — belongs to the system, not to the surface a
person edits by hand. That is the same principle GKOS states independently:
preserve the original, and keep authored content separate from derived or
machine-generated state. OKF+ 2.2 and flat Agent-Ready 2.3 are two names for
one answer to that principle; nested 2.3 is what happens when it is ignored.
