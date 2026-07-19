# OKF+ 2.2 vs 2.3 — Audience Positioning Determination

**Status:** Decision record (design-level, adversarially verified)
**Question:** Is 2.2 logic "enough" for the general public, with 2.3 positioned for
agentic use with very little human interaction?

## Determination

**Yes, with one refinement: the split is not between two note formats — it is between
the authoring surface and the governance machinery.**

- **OKF+ 2.2 is the complete human product.** Its flat Properties surface (identity,
  type, title, description, timestamp, epistemic state, sensitivity, tags, lineage and
  relationship wikilinks) covers everything a person actually curates. Every field is
  editable in Obsidian's Properties UI; the lineage and relationship fields hold
  whole-value quoted wikilinks in top-level text/list properties — exactly the form
  Obsidian link-indexes and rewrites on rename (with "Automatically update internal
  links" enabled). The empirical record shows fields beyond this set collapse into
  uncurated boilerplate (the spec vault's own auto-stamped descriptions and default
  epistemic states).
- **OKF+ 2.3's structural additions are agent-facing:** origin separation
  (authored/derived/proposed/approved), evidence weights and independence groups,
  structured provenance, deterministic assessments, review/authorization state, and
  typed relationship envelopes. Humans do not author evidence *weights and structure*;
  engines derive them and agents consume them. (Humans **do** curate *sources* —
  students, researchers, and journalists cite deliberately — which is why the flat
  profile carries a flat `sources:` list that the projection maps to minimal evidence
  records. The machinery stays machine-side; the citation stays human-side.)
- **The flat editable 2.3 profile is the bridge, and it is the default for anyone who
  wants agents.** It keeps the note in the same Properties-safe flat grammar as 2.2 —
  scalars plus quoted-wikilink lists, no nesting. The visible delta from a 2.2 note:
  `timestamp` is replaced by `created_at`/`updated_at`, `okf_version` changes, one
  scalar is added (`authorship_origin`), and `scope`/`scope_id` become optional. The
  human never meets the governance machinery; it lives in the in-memory projection and
  in `.okf/` sidecars.
- **Nested in-note 2.3 remains a machine dialect.** It stays fully readable for
  corpora that are genuinely machine-managed (no human ever opens the file in an
  editor), but no Kosmos-Oden writer introduces it, and it should never be recommended
  to a person using a text editor.

## Practical guidance

| Audience | Recommendation |
|---|---|
| General public, personal notes, no agents | **2.2.** Nothing more. Don't mention 2.3. |
| Personal vault + AI assistants (enrichment, MCP agents) | **Flat editable 2.3.** Same flat surface; agents get uid-first identity, assessments, proposals, and origin separation via projection + sidecars. |
| Machine-managed knowledge stores, pipelines, multi-agent systems with rare human touch | **Full 2.3** (nested in-note or sidecar-heavy), governed writes only; humans interact through review UIs, never raw files. |

## Why this is the durable split

1. **Curation tax is the binding constraint.** Every human-facing field must pay rent
   at capture time. 2.2's field set is at the ceiling of what real users maintain;
   everything past it decays into defaults, and defaults carry zero information while
   still costing trust — which is why the engine marks defaulted values as defaulted
   (redesign §3.5) instead of letting boilerplate impersonate curation.
2. **Link integrity constrains the human format.** Obsidian protects links only in
   flat, top-level fields; other Markdown editors protect frontmatter links *nowhere*.
   That is why the human profile keeps relations flat (rename-safe inside Obsidian)
   and why the standalone contract adds uid-valued targets plus `okf mv` (rename-safe
   everywhere else). Any format burying relationship targets in nested structures
   breaks silently on rename — disqualifying nested 2.3 as a human format independent
   of taste.
3. **Agents need exactly what humans won't maintain.** Provenance, evidence weights,
   origin separation, and reproducible assessments are what let a deterministic engine
   gate agent behavior without trusting the agent. That value materializes only with
   agent traffic; for a human-only vault it is dead weight.
4. **One engine, two presentations.** Because the projection supplies governance
   defaults for the flat profile, 2.2 notes and flat-2.3 notes flow through the same
   deterministic pipeline. Moving an audience from human-only to agentic is a
   frontmatter version conversion, not a migration of writing habits.

## Naming

Name all three profiles, avoid the base-vs-premium superset pattern, and accept that
the version number stays user-visible (it is the first Properties row of every note):

- **OKF+ Notes** (2.2) — the human profile; not a lesser product, the correct one.
- **OKF+ Agent-Ready Notes** (flat 2.3) — the human surface plus agent governance in
  projection and sidecars.
- **OKF+ Machine Dialect** (nested 2.3) — for stores no human edits by hand.

If desired, surface the profile explicitly (an `okf_profile: notes | agent-ready |
machine` key or a documented version↔profile mapping) so the name in the docs matches
something visible in the artifact; otherwise state plainly that profile names are a
documentation layer over the visible `okf_version`.
