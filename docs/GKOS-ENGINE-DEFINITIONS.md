---
okf_version: "2.3"
uid: ededed8e-3d17-4572-8886-9360cfe1d387
title: GKOS Engine Definitions
type: semantic
created_at: 2026-07-19T00:00:00.000Z
updated_at: 2026-07-19T00:00:00.000Z
description: Definitions sheet for terms used by the GKOS Engine (Kosmos-Oden's implementation), with a mapping table showing where the GKOS v0.75 governing document needs each definition referenced or adopted.
epistemic_state: verified_inference
sensitivity: internal
authorship_origin: authored
tags:
  - gkos
  - okf
  - definitions
---
# GKOS Engine Definitions

**Purpose:** a single reference for terms used across the GKOS Engine v1.0 build
instructions, the OKF+ 2.3 profile, and the GKOS v0.75 governing document, so all
three documents can cite one vocabulary instead of restating it. Part 1 defines each
term. Part 2 maps each term to the exact place in the GKOS governing document
(`GKOS-2026-07-17-v0.75-Complete-Documentation.md`) that currently lacks it, or would
be strengthened by citing it.

Status values used below:
- **defined-in-engine** — the term is fully specified by the engine build instructions
  or the OKF+ 2.3 spec/redesign docs; GKOS has no equivalent yet.
- **needs-GKOS-adoption** — the term exists (or a mechanical proxy for it exists) in
  the engine/OKF+ world and GKOS names the concept but leaves it undefined; GKOS
  should adopt the definition by citation or restatement.
- **GKOS-defined** — GKOS v0.75 already defines the term normatively; the engine
  conforms to (or narrows) GKOS's definition rather than inventing its own.

---

# Part 1 — Definitions

## GKOS Engine

**Definition:** The deterministic knowledge-compiler implementation described in
`GKOS-Engine-v1.0-Build-Instructions.md` — parse, validate, project, assess, graph,
propose, decide, export — consumed by the Obsidian plugin, a standalone app/CLI, and
agent surfaces (REST/MCP). It is **an implementation, explicitly not the GKOS standard
itself**: GKOS v0.75 defines the governance model in the abstract; the GKOS Engine is
one conforming (partially) piece of software built against Kosmos-Oden's `src/core/`.
The engine's own conformance claim (Build Instructions §3) is deliberately narrower
than full GKOS conformance — it claims a GCP-2/3-shaped validating projection with
L5-style decision recording under a disclosed single-actor waiver, nothing more.
**Engine location:** `src/core/` (parser/projection/assessment), `src/server/`
(agent surfaces), `src/cli/` (standalone), `src/plugin/` (Obsidian adapter only).
**Status:** defined-in-engine.

## OKF+ Notes (2.2)

**Definition:** The complete human-facing note profile — flat Properties surface
covering identity, type, title, description, `timestamp`, epistemic state,
sensitivity, tags, and lineage/relationship wikilinks. Every field is editable in
Obsidian's Properties UI. This is the terminal product for general-public,
personal-vault use with no agent participation; nothing past this field set is
recommended for that audience (`OKF-22-VS-23-POSITIONING.md`).
**Engine location:** legacy/2.2 parse path in `src/core/okf.ts`; read-compatible in
`okf23.ts`.
**Status:** defined-in-engine.

## Agent-Ready dialect (flat 2.3)

**Definition:** The human-visible canonical serialization of OKF+ 2.3: scalars and
flat string lists only, no nested mappings or object lists, wikilinks as whole-value
quoted strings in top-level lists. This is the dialect any human-edited file MUST use
(Build Instructions §5: "a human ever opens the file in an editor → Agent-Ready
(flat). Always."). It carries the same governance semantics as the nested dialect
but the machinery (evidence weights, per-field origins, review state) lives in the
projection and `.okf/` sidecars, not in the note.
**Engine location:** `src/core/okf23.ts` (`parseOkf23Frontmatter`), Build Instructions
§5.1.
**Status:** defined-in-engine.

## Machine Dialect (nested 2.3)

**Definition:** The full nested OKF+ 2.3 structure (`authorship`, `epistemic`,
`sensitivity`, `provenance`, `relationships`, `evidence`, `lineage`, `review`,
`assessment`, `authorization`, `labels`) for corpora **no human ever hand-edits**.
Readers accept it; no Kosmos-Oden writer ever introduces it into a human-visible
corpus (Build Instructions §5.2–5.3). Nested blocks win over flat equivalents when
both are present in the same note (a hand-authored edge case, not a writer output).
**Engine location:** `src/core/okf23.ts` parser (accepts, does not emit into
human-edited notes).
**Status:** defined-in-engine.

## GKOS-Engine-Lite schema

**Definition:** The read/write schema surface actually exercised by the engine today:
OKF+ 2.2 plus flat 2.3. It is "Lite" relative to the full OKF+ 2.3 machine dialect
because it excludes nested governance blocks from the authoring plane by
construction — the governance data those blocks would hold instead lives in the
projection plane (computed) and the governance plane (`.okf/` sidecars), never in the
note. This is the schema a stranger's plain-Markdown folder must satisfy to be
readable by the standalone engine (Build Instructions §14, "definition of done").
**Engine location:** `src/core/okf23.ts` + `src/core/okf.ts` combined read path;
`src/core/okf-migration.ts` for the only writers.
**Status:** defined-in-engine.

## Authoring plane / projection plane / governance plane

**Definition:** The engine's three-plane architecture (Build Instructions §6;
`OKF-23-OBSIDIAN-ENGINE-REDESIGN.md` §2).
- **Authoring plane** — the note itself: flat frontmatter + body, human territory,
  written only by governed apply and the timestamp stamper (§7.2).
- **Projection plane** — the in-memory deterministic projection computed from the
  note on every read: UID index, typed edges, lineage, temporal validity,
  diagnostics, defaulted-value marking, effective state. Never persisted as note
  bytes.
- **Governance plane** — `.okf/` sidecars: proposals, decisions, assessments,
  policy, schema, cache. Written only by explicit governed operations, never on a
  timer or file-change event.
This three-way split is the mechanical answer to "where does this datum live, and
who may write it" (Governance Critique §3.1) and is how the beta.10/12
nested-frontmatter incident was resolved: governance metadata is a downstream
artifact and does not belong on the authoring plane.
**Engine location:** package layout in Build Instructions §6; redesign doc §2.
**Status:** defined-in-engine.

## Progressive disclosure

**Definition:** The normative UI contract (Build Instructions §5.4) that every
human-facing surface defaults to a **content view** (title, body, tags,
human-curated relations) with machine fields (`uid`, timestamps, `okf_version`,
`authorship_origin`, defaulted governance) hidden, behind a single "Show
frontmatter"/source-mode toggle that reveals the raw form losslessly. Review UIs and
agent consoles show everything by default instead, including
defaulted-vs-authored marking. Hiding is a view concern only — the engine never
varies the underlying bytes by audience. Modeled explicitly on HTML/Markdown:
machinery invisible until asked for.
**Engine location:** to be implemented in Obsidian reading view and the standalone
viewer (Build Instructions §14 definition-of-done item).
**Status:** defined-in-engine (contract specified; UI implementation is a build
item, not a definitional gap).

## Validating projection

**Definition:** A deterministic read-time transform of note bytes into a canonical,
policy-checked in-memory structure (parse → build projection → assess) that never
mutates the source and produces the same output for the same bytes + engine version
+ policy hash on every run. "Validating" means it emits diagnostics (`OKF-*` codes)
against policy, not merely a passive read. This is the shape the engine's
conformance claim is bound to ("a GCP-2/3-shaped deterministic projection," Build
Instructions §3) rather than to any one serialization.
**Engine location:** `src/core/okf23.ts` (`parseOkf23Frontmatter`,
`buildOkf23Projection`, `assessOkf23`).
**Status:** defined-in-engine.

## Origin separation (authored / derived / proposed / approved)

**Definition:** A four-way tag carried on every governed value (and, in the nested
dialect, on labels/relationships/evidence) recording where it came from:
`authored` (a human wrote it directly), `derived` (the engine computed it),
`proposed` (an agent or human suggested it, not yet decided), `approved` (a decision
record accepted it). The engine enforces a hard rule on top of the tag: a value
tagged `proposed` is never treated as `approved` without a matching
`.okf/decisions/` record, and flat `authorship_origin: approved`/`proposed` is
projected back down to `authored` plus a diagnostic (`OKF-AUTHORITY-003`) absent
that record — a human cannot fabricate approval by typing a word in Properties.
**Engine location:** `OkfOrigin` type and `origins` structure in
`src/core/okf23.ts`; enforcement in `src/core/okf-migration.ts` (proposals/decisions
work items).
**Status:** needs-GKOS-adoption (GKOS names "authored, derived, proposed, and
governed state" as things that must be separated per R5-045 but does not define the
four-way tag or the non-fabrication rule).

## Defaulted-vs-authored marking

**Definition:** The projection marks every governance value it supplied by default
(missing `epistemic_state` → `hypothesis`, missing `sensitivity` → `internal`,
stamped timestamps) as **defaulted**, distinct from a value a human actually typed.
This exists so boilerplate cannot impersonate curation — an assessment or agent can
discount a defaulted value instead of reading it as considered judgment (redesign
doc §3.5; Build Instructions §7.5).
**Engine location:** `buildOkf23Projection` in `src/core/okf23.ts`; surfaced in
assessment output.
**Status:** defined-in-engine.

## Proposal envelope

**Definition:** The structural unit an agent or human submits to request a note
change without writing the note: target uid, input content hash (computed with
`updated_at` excluded so timestamp-stamper runs never invalidate a pending
proposal), a patch restricted to authoring-plane keys only, proposer identity
(`human` / `plugin:enrichment` / `agent:<id>`), rationale, and expiry. Ingress
validation is purely structural (schema-valid, fresh hash, in-scope keys, bounded
size); sensitivity reductions and epistemic promotions are admitted but tagged
`requires-elevated-authority` and never auto-applied.
**Engine location:** `.okf/proposals/<proposal-id>.yaml` (per `SIDECAR-FORMAT.md`);
new module `src/core/proposals.ts` (Build Instructions §6).
**Status:** needs-GKOS-adoption (GKOS's Layer 5 requires proposals to receive
"authorized append-only Decision Records" but does not define the proposal envelope
itself, its input-hash binding, or the requires-elevated-authority tag).

## Decision record

**Definition:** One immutable file per decision (`.okf/decisions/<decision-id>.yaml`)
carrying: decision id, proposal id and revision (hash), disposition (acceptance and
rejection recorded identically — not just acceptances), actor,
`authority_receipt: none (single-actor profile)` where applicable, rationale/reason
code, evidence refs, effective scope, expiry/defer, timestamp, plan hash, and
`prev_decision_id` + `prev_hash` linking it into a chain. The chain is a *derived*
index (rebuilt from the files); a fork (two heads after a sync merge) raises
`OKF-DECISION-002` rather than a false tamper alarm. Disclosed honestly: the chain
detects corruption/naive edits, it does not authenticate the writer.
**Engine location:** `.okf/decisions/`; new module `src/core/decisions.ts`.
**Status:** needs-GKOS-adoption (GKOS §7.5/§10.5 requires an "authorized append-only
Decision Record" and forbids self-approval, but specifies none of: file layout,
hash-chain fields, fork handling, or the self-accepted disposition below).

## Single-actor waiver profile

**Definition:** A normative, disclosed statement that for single-owner deployments,
GKOS §5.7 separation-of-duties is **waived, not satisfied** — the vault owner
accepting their own (or their own agent's) proposal is unilateral action, recorded
honestly as `disposition: self-accepted` with `authority_receipt: none
(single-actor profile)`, rather than pretending a second reviewer exists. What the
engine still enforces procedurally: an agent identity has no accept surface (accept
exists only in the human UI) and no automated path applies anything. Any
conformance claim must list this waiver as a limitation.
**Engine location:** decision-record disposition field; Build Instructions §3
(conformance claim), §7.4.
**Status:** needs-GKOS-adoption (Governance Critique hole 6: GKOS's append-only
decision records have no hash chain, signature, or external anchor, and §5.7 is
"structurally unsatisfiable for a single human deployment — the exact audience of
the reference implementation").

## Governed write / governed apply

**Definition:** The only sanctioned pattern by which the authoring plane is ever
modified: deterministic scan → hash-bound plan → preview → byte-exact backup →
atomic apply (inside `vault.process`, staleness check *inside* the callback, never a
separate read-then-write) → result artifact. "Governed apply" is this pattern's name
when applying an accepted proposal or a migration plan; it is one of exactly two
sanctioned authoring-plane writers (the other is the disclosed timestamp stamper).
**Engine location:** `applyOkfMigrationPlan` in `src/core/okf-migration.ts`; Build
Instructions §7.2.
**Status:** defined-in-engine.

## Hash-bound plan

**Definition:** A migration or apply plan that embeds the input content hash it was
computed against; applying the plan re-checks that hash inside the atomic write
callback and aborts (marks skipped) on mismatch, so a plan can never be silently
applied against bytes it wasn't built from. Flat→nested and nested→flat conversions
are governed operations for exactly this reason (Build Instructions §5.3).
**Engine location:** `src/core/okf-migration.ts`.
**Status:** defined-in-engine.

## Byte-exact backup

**Definition:** A verbatim copy of a note's prior bytes taken immediately before any
governed apply, stored under `.okf/backup/`, existing purely as apply-safety (a
revert path if the write goes wrong) — explicitly **not** a Layer-1 revision store
and not a source-preservation claim (that requires the separate opt-in §11 revision
store).
**Engine location:** `.okf/backup/`; `src/core/okf-migration.ts`.
**Status:** defined-in-engine.

## Deterministic marker

**Definition:** A recognizable, engine-written signal embedded in generated content
(e.g. converter output) that lets a later scan identify "this was machine-generated"
without re-deriving it — used by the safe-onboarding repair path to flatten
marker-carrying generated notes. Distinct from a content hash: a hash detects
*whether bytes changed*, a marker detects *provenance of the bytes*.
**Engine location:** migration/conversion writers in `src/core/okf-migration.ts`.
**Status:** defined-in-engine.

## Sidecar

**Definition:** A file stored outside the human-visible note, under `.okf/`, holding
governance-plane data: `assessments/<uid>.assessment.yaml`,
`proposals/<proposal-id>.yaml`, `decisions/<decision-id>.yaml`,
`diagnostics/<uid>.diagnostics.yaml`, plus `policy/`, `schema/`, `cache/`. Written
with a crash-safe protocol (write tmp → hash-verify → rename, with platform
fallbacks for Windows rename contention and no-overwrite mobile adapters; startup
sweep completes or rolls back interrupted writes). Written only by explicit user
actions or governed operations — never on a file-change event or timer, because
third-party sync tools (Nextcloud, Syncthing, Dropbox, Git) replicate every `.okf/`
write and would otherwise generate a sync storm. Note: Obsidian Sync itself does
*not* replicate `.okf/` (it only replicates `.obsidian`), so decisions/proposals are
device-local under Obsidian Sync unless a configurable non-dot governance folder is
used instead.
**Engine location:** `src/core/sidecar/` (`paths.ts`, `writer.ts`, `reader.ts`,
`merge.ts`); `docs/SIDECAR-FORMAT.md`.
**Status:** defined-in-engine.

## Uid-first identity

**Definition:** The rule that a stable `uid` (UUIDv4 accepted, UUIDv7 preferred, or
a policy-permitted namespaced id), not a filename or path, is a note's identity.
Renaming or moving a file must not create a new identity or destroy lineage. The
engine persists only rename *history* (path aliases) in
`.okf/cache/uid-index.json`; everything else rebuilds deterministically from bytes.
Duplicate uids fail closed.
**Engine location:** `src/core/identity.ts`; `.okf/cache/uid-index.json`.
**Status:** GKOS-defined (GKOS §7.2/§10.2: "Filenames and paths are not identity" —
the engine's uid-index and rename-alias cache are the mechanical realization GKOS
itself leaves unspecified).

## Path-to-uid drift

**Definition:** Diagnostic `OKF-IDENTITY-005` — fires when a uid previously seen at
path A reappears at a *different* path B without an observed rename event (e.g. a
file was moved by a tool the engine wasn't watching, or restored from backup/sync
conflict-copy). Distinguishes an ordinary tracked rename from an untracked identity
relocation that needs human attention.
**Engine location:** `src/core/identity.ts`, diagnostic `OKF-IDENTITY-005`.
**Status:** defined-in-engine.

## Fail-closed sensitivity

**Definition:** Missing or invalid `sensitivity` values resolve to the *most*
restrictive default (`secret`), not the least — an unlabeled or malformed
sensitivity field is treated as maximally sensitive rather than open. Applies
symmetrically to the agent API: a target above the caller's sensitivity ceiling
behaves as though it does not exist (same response class as a genuinely missing
target — no hash-match oracle that would let a caller distinguish "exists but
forbidden" from "does not exist").
**Engine location:** `src/core/okf23.ts` sensitivity parsing; agent-server response
shaping (`src/server/` per Build Instructions §6 relocation).
**Status:** GKOS-defined (GKOS §11: "Missing or ambiguous sensitivity fails closed
to a restricted deployment default" — the engine's specific default value
(`secret`) and the nonexistent-equivalence behavior are its narrowing of that rule).

## Sensitivity ceiling

**Definition:** The maximum sensitivity level a given agent-API caller/token may
see; responses are filtered so that any note above the ceiling is invisible to that
caller, and — per fail-closed sensitivity above — invisible in a way indistinguishable
from nonexistence.
**Engine location:** agent-server response filtering (`src/server/`, relocated per
Build Instructions §6).
**Status:** needs-GKOS-adoption (GKOS §11 requires "sensitivity filtering" on agent
interfaces generally but does not define a per-caller ceiling or the
nonexistent-equivalence behavior above the ceiling).

## Authority receipt

**Definition (GKOS side, unresolved):** GKOS's load-bearing primitive: possession of
a receipt, not any property of an actor (model identity, prompt text, role, score),
is what constitutes authority. GKOS requires the Governance Coordinator to "verify
authority receipts" (§9.1) against a schema GKOS never specifies — no fields, no
issuer/scope/audience/expiry/revocation model, no verification procedure
(Governance Critique hole 1). **Engine side (current, narrower):** the engine does
not implement authenticated receipts; single-actor-profile decision records instead
write `authority_receipt: none (single-actor profile)` as an honest disclosure of
absence, not a working receipt mechanism.
**Engine location:** decision-record field (`src/core/decisions.ts`, planned).
**Status:** needs-GKOS-adoption — **schema still provisional in GKOS.** The
Governance Critique's proposed fix (define it over an existing attenuated-token
mechanism such as Biscuit/macaroon caveats or a GNAP grant — issuer, scope,
audience, expiry, revocation, verification steps) is a v0.8-class engineering gate,
not something the engine can adopt today; the engine's single-actor waiver is the
interim, honestly-disclosed substitute.

## Actor identity

**Definition (GKOS side, unresolved):** GKOS requires non-self-approval ("No actor
may approve, review, validate the authority of, authorize, or certify its own
work," §5) but never defines when two agent invocations count as "the same actor" —
same model? same contract? same session? same owning principal? Without this, an
agent that proposes under contract A and approves under contract B satisfies the
letter of the rule while defeating it (Governance Critique hole 2). **Engine side:**
proposer identity is currently recorded as a free-form string (`human`,
`plugin:enrichment`, `agent:<id>`) with no collusion-adjacent modeling (same owner,
same orchestrator proposing and "approving" through different labels).
**Engine location:** proposal envelope `proposer` field (`src/core/proposals.ts`,
planned).
**Status:** needs-GKOS-adoption — v0.8-class engineering gate. Governance
Critique's proposed fix: actor = agent contract ID + owning principal, with the
self-approval prohibition explicitly extended to collusion-adjacent cases.

## Blast radius

**Definition (GKOS side, unresolved):** Required by GKOS in six places (Specialized
Agent risk limits, Layer 4 controls) with no metric ever given.
**Mechanical proxy (proposed, mechanical, no new invention):** dependency-graph
reach from proposal-time traversal — the count (or set) of notes/uids reachable
from the proposal's target via the relation/lineage graph within a bounded hop
count, with thresholds set per deployment profile (e.g. the example Specialized
Agent Contract's `risk_limits: {max_files, max_fraction}` in GKOS §24 already
gestures at this without naming the metric).
**Engine location:** graph reachability primitives already exist in
`src/core/graph.ts`; not yet wired to a proposal risk-limit check.
**Status:** needs-GKOS-adoption — v0.76-class documentation clarification (the
proxy is a naming/definition exercise over an existing graph-traversal capability,
not new engineering).

## Consequential use

**Definition (GKOS side, unresolved):** Triggers all of GKOS Layer 7 (Authorized
Use) with no enumeration of which operations count as consequential.
**Mechanical proxy (proposed, mechanical):** an enumerated list of operation
classes — external disclosure, sensitivity change, promotion to `accepted`,
deletion/tombstone. Anything in this enumerated set requires an Authorized Use
Record; anything outside it does not.
**Engine location:** not yet enforced as a gate; the enumeration maps directly onto
existing engine operations (export/disclosure, sensitivity edits, epistemic
promotion to `accepted`, governed erasure).
**Status:** needs-GKOS-adoption — v0.76-class documentation clarification.

## Materially equivalent

**Definition (GKOS side, unresolved):** GKOS's rejection-permanence logic depends on
whether a re-submitted proposal is "materially equivalent" to a previously rejected
one, with no test given.
**Mechanical proxy (proposed, mechanical):** identical evidence-set hash *and*
identical proposed state transition (same target uid, same patch shape, same
input-hash lineage). If both match a prior rejected proposal, the resubmission is
materially equivalent and inherits the rejection's traceability requirements rather
than being treated as novel.
**Engine location:** proposal envelope's input-hash field is the mechanical
building block (`src/core/proposals.ts`, planned); no equivalence check
implemented yet.
**Status:** needs-GKOS-adoption — v0.76-class documentation clarification.

## Upward receipt

**Definition (GKOS side, unresolved):** GKOS §7.7/Annex A require Layer 7 to
"demonstrate satisfaction of all applicable lower-layer contracts" and promise a
per-contract upward receipt — but no layer contract in §8 actually defines one
(Governance Critique hole 5). **Proposed fix:** specify it as an in-toto-style
attestation chain, so cross-layer trust is checkable rather than merely asserted.
**Engine location:** not implemented; would sit alongside decision-record chaining
in `src/core/decisions.ts`.
**Status:** needs-GKOS-adoption — v0.8-class engineering gate (an attestation-chain
mechanism is new engineering, not a documentation clarification).

## Layer re-entry

**Definition:** GKOS's rule that an upper-layer output (agent summary, enrichment
result, exported context) re-entering the corpus MUST do so only as a **new
Layer-1 source** or a **new proposal**, beginning a fresh governed lifecycle — it
never re-enters already carrying its prior layer's authority. The engine's
mechanical form: enrichment output is emitted as a proposal envelope, never written
in place; imported agent summaries are treated as new sources, never merged
silently into existing notes. This is what keeps the engine's determinism claim
intact as AI features are added.
**Engine location:** enrichment flow in `src/plugin/okf-enrichment.ts` (emits
proposals, never in-place edits); `kosmos-invariants.yml`
(`api_write_routes: proposals-inbox-only`).
**Status:** GKOS-defined (GKOS §7.8: "Upper-layer results returning to the corpus
MUST enter as new Layer-1 sources and begin a new governed lifecycle" — the engine
narrows this to a concrete mechanism: proposal-envelope-only re-entry).

## Epistemic state vocabulary

**2.2 vocabulary (5 states):** `fact`, `verified_inference`, `hypothesis`,
`deprecated`, `refuted`.

**2.3 vocabulary (12 states, ordered):** `unknown` → `observation` → `reported` →
`inferred` → `hypothesis` → `modeled` → `supported` → `contested` → `refuted` →
`retracted` → `accepted` → `superseded`.

**Engine's 2.2→2.3 mapping** (as implemented in `src/core/okf23.ts`):
`fact` → `reported`; `verified_inference` → `inferred`; `deprecated` → `superseded`;
`hypothesis` and `refuted` pass through unchanged (identical names exist in both
vocabularies). Promotion to `accepted` specifically requires a corroborating
approval/authorization record (`OKF-EPISTEMIC-004` warns otherwise) — acceptance is
never treated as verified authority on confidence alone.
**Engine location:** `EPISTEMIC_STATES` constant and mapping function
(`src/core/okf23.ts` line ~77 and ~286-288).
**Status:** needs-GKOS-adoption (Governance Critique hole 3, the highest-leverage,
lowest-cost fix identified: "GKOS normatively adopts OKF+ 2.3's enumeration and
ordering by citation. This closes the standard's largest dangling pointer with one
sentence." GKOS's own epistemic model in §6 requires an epistemic-promotion
mechanism but never enumerates the states being promoted between.)

## Temporal validity / HEAD

**Definition:** Temporal validity is the time-scoped truth window a relationship or
assertion holds for (as-of/until bounds), letting the engine answer "what did the
graph look like at time T" (`okf at-time`). HEAD is the current, latest-known state
of the corpus/decision-chain as of the most recent scan — the default view when no
`at-time` query is given. Both are computed in the projection plane, never stored as
authored note fields beyond `created_at`/`updated_at`.
**Engine location:** `src/core/temporal.ts`, `src/core/incremental.ts`; `okf at-time`
CLI verb (Build Instructions §10).
**Status:** GKOS-defined (GKOS §7.3/§10.3 require "temporal validity" on assertion
and lineage records; the engine's `temporal.ts` module and `at-time` query are the
concrete realization GKOS specifies only as a required field, not a query
mechanism).

## Content hash

**Definition:** A deterministic hash of a note's frontmatter+body bytes, computed
with `updated_at` **excluded** so that a timestamp-stamper run never invalidates a
pending proposal's staleness check. Used to bind proposal envelopes and migration
plans to the exact bytes they were computed against.
**Engine location:** hashing logic in `src/core/okf-migration.ts` /
`src/core/proposals.ts` (planned); embedded in every export's `build:` block
alongside `engine_version`, `policy_hash`, `generated_at`.
**Status:** defined-in-engine.

## Policy hash

**Definition:** A hash of the versioned policy document (`OKF23_POLICY`) governing
diagnostics and defaults, embedded in every assessment (`input_hash`, `policy_hash`,
`engine_version`) so an assessment result is reproducible and cache-keyed by exactly
those three values. `.okf/policy/` supports override with hash-pinning; absent an
override, the built-in policy is used.
**Engine location:** `src/core/okf23.ts` (`OKF23_POLICY`); `.okf/policy/`.
**Status:** defined-in-engine.

---

# Part 2 — Mapping table: what the GKOS governing document needs

Column 2 cites the real section numbers/names from
`GKOS-2026-07-17-v0.75-Complete-Documentation.md`. Column 4 classifies each addition
per the Governance Critique's own priority ordering (§4): **v0.76** = documentation
clarification, citable/definable at near-zero cost, no new mechanism;
**v0.8** = engineering gate, requires a new mechanism (schema, chain, attestation)
before it can be normative.

| Term | GKOS location needing the reference | What to add there | Class |
|---|---|---|---|
| Epistemic state vocabulary (12-state) | §6 Epistemic model | Adopt OKF+ 2.3's twelve-state enumeration and ordering by citation; §6 currently requires promotion/demotion but never lists the states being moved between. | v0.76 |
| Blast radius | §6.4/§8 Layer 4 (Validation and Control — "Risk and blast-radius limits"); §9 Specialized Agent Framework ("Risk and blast-radius limits") | Define the mechanical proxy: dependency-graph reach from proposal-time traversal, thresholds per deployment profile. | v0.76 |
| Consequential use | §7.7/§8 Layer 7 (Authorized Use); §6 core thesis ("consequential use") | Define the mechanical proxy: enumerated operation classes — external disclosure, sensitivity change, promotion to accepted, deletion/tombstone. | v0.76 |
| Materially equivalent | §7.5/§10.5 Layer 5 (Review and Workflow — rejection permanence) | Define the mechanical proxy: identical evidence-set hash + identical proposed state transition. | v0.76 |
| Defect-badge-or-refuse | §10.8 Viewer/Projection Profile | Define a badge taxonomy + a refusal-condition table for when required information is unavailable. | v0.76 |
| Authority receipt | §5 Authority model; §9.1 Governance Coordinator ("verify authority receipts") | Specify the receipt over an existing attenuated-token mechanism (Biscuit/macaroon-style caveats, or a GNAP grant): issuer, scope, audience, expiry, revocation, verification steps. | v0.8 |
| Actor identity | §5 Authority model ("No actor may approve... its own work"); §9.4 Subdelegation | Define actor = agent contract ID + owning principal; extend the self-approval prohibition to explicit collusion-adjacent cases (same owner, same orchestrator, different contract). | v0.8 |
| Upward receipt | §7.7 Layer 7 ("demonstrate satisfaction of all applicable lower-layer contracts"); §8 Layer interface contracts (Annex A template) | Specify the upward receipt as an in-toto-style attestation chain so cross-layer trust is checkable, not merely asserted. | v0.8 |
| Decision-record integrity (hash chaining) | §7.5/§10.5 Layer 5 (Decision Record — "append-only"); §5 Authority model (non-self-approval enforcement) | Add per-record hash chaining with an out-of-corpus head anchor now; note signatures as a later upgrade. | v0.8 |
| Single-actor waiver profile | §5.7-equivalent separation-of-duties requirement (§5 Authority model, "No actor may approve... its own work" combined with §9.1 Governance Coordinator) | Add a normative single-actor waiver profile: for single-owner deployments, record unilateral owner action honestly (`disposition: self-accepted`, explicit receipt-absence) instead of assuming review happened. | v0.8 |
| Origin separation (authored/derived/proposed/approved) | §3 Core thesis / R5-045 ("separation of authored, derived, proposed, and governed state"); §6 Epistemic model | Define the four-way origin tag explicitly and the rule that a value cannot self-promote from proposed to approved without a matching Decision Record. | v0.76 |
| Layer-artifact mapping to a concrete schema program | §7/§8 (Seven-layer reference model, Layer interface contracts); §27 Schema program | Cite OKF+ 2.3's concrete realization of each layer artifact (uid/type/provenance/relationships/evidence/diagnostics/decisions) as the reference schema program, closing "GKOS v0.75 defines semantic requirements but does not yet declare a complete normative serialization." | v0.76 |
| Progressive disclosure | §10.8 Viewer/Projection Profile | Add the progressive-disclosure contract (content view by default, single toggle to raw form, full detail in review/audit surfaces) as a normative requirement for any conforming Viewer/Projection implementation, not just a display suggestion. | v0.76 |
| Sensitivity ceiling / nonexistent-equivalence | §11 Security, privacy, retention, and workload governance ("sensitivity filtering") | Define a per-caller sensitivity ceiling and require that above-ceiling targets are indistinguishable from nonexistent targets in agent-interface responses (no hash-match oracle). | v0.76 |
| Fail-closed default value | §11 Security ("fails closed to a restricted deployment default") | Name the concrete default (most-restrictive label, e.g. `secret`-equivalent) rather than leaving "restricted deployment default" unspecified. | v0.76 |
| Uid-first identity / rename-alias handling | §7.2/§10.2 Layer 2 (Structure and Identity — "Filenames and paths are not identity") | Cite a concrete mechanism (persisted rename-alias cache keyed by uid, rebuildable from bytes) as the reference implementation of the identity-stability requirement. | v0.76 |
| Deterministic conformance test artifacts (fixture corpus) | §21 Fixture program; §26 Fixture catalog; §10 Conformance model | Cite the OKF+ 2.3 shared fixture corpus (valid/invalid notes in both dialects, dialect-conversion pairs, proposal/decision round-trips, authority-rule cases) as the first executable evidence toward GCP fixtures, per Build Instructions §12. | v0.76 |

**Summary of classification logic** (per Governance Critique §4, the assessment
guidance this table follows): items 1 and 3 in the critique's priority order — the
epistemic enumeration and the four mechanical proxies — are documentation-only and
could ship in a v0.76 point release at near-zero cost. Items 2, 5, and 6 — the
authority-receipt schema, decision-record hash chaining plus the single-actor waiver
profile, and the actor-identity model — require new mechanism design and are
v0.8-class engineering gates. The upward receipt (item 4) is likewise v0.8-class: an
attestation chain is a new mechanism, not a citation.

---

# Counts

- **Terms defined:** 33
- **Mapping rows:** 17
