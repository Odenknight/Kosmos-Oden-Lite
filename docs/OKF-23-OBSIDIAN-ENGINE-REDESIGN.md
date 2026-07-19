# OKF+ 2.3 Deterministic Engine in Obsidian — Redesign

**Status:** Design for the beta.13 development cycle (adversarially verified against
the beta.12 codebase, the Obsidian platform, and the OKF+ 2.3 / GKOS invariants)
**Baseline:** v0.6.5-beta.12 (flat editable 2.3 profile shipped)
**Scope:** How the 2.3 deterministic engine — parser, validator, projection,
assessment, migration, enrichment, proposals, and sidecars — functions properly
*within Obsidian's platform*, without fighting it.

---

## 1. Lessons this redesign is built on

1. **Obsidian Properties is the human contract.** The Properties UI renders scalars and
   flat string lists. Anything nested becomes an "unknown data type" JSON blob, and the
   type-conversion dialog destroys it. Obsidian link-indexes and rename-rewrites
   frontmatter wikilinks **only** when the value is exactly a wikilink string in a
   top-level text/list property (and "Automatically update internal links" is on).
   The beta.10/beta.12 nested-frontmatter incident is the empirical proof: governance
   metadata written into the authoring surface broke human editing and link integrity.
2. **Capture must be ceremony-free.** A conforming system must accept an unadorned note
   and never require a human to fill governance fields. Fields that are always defaults
   carry zero information and pure maintenance cost (the uncurated
   `description: Knowledge note for X` boilerplate across the spec vault is the
   cautionary example — and beta.12's converters still manufacture it; see §5).
3. **One human is author, reviewer, and authority.** A personal vault cannot satisfy
   committee-shaped governance. The engine needs an explicit **single-actor profile**
   that *discloses* what it waives — not a silent assumption that review happens
   elsewhere (§3.4).
4. **Determinism is the product.** Same bytes + same engine + same policy ⇒ same
   projection, on every surface (plugin, standalone, CLI, REST, MCP). The LLM is never
   the graph.

## 2. The three-plane architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│ AUTHORING PLANE — the note (human territory)                       │
│   Flat frontmatter only: scalars + flat quoted-wikilink lists.     │
│   okf_version 2.2, or 2.3 in the flat editable profile.           │
│   Obsidian Properties can render and edit every key.               │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ deterministic read
┌──────────────────────────────▼─────────────────────────────────────┐
│ PROJECTION PLANE — in-memory (engine territory)                    │
│   parseOkf23Frontmatter → buildOkf23Projection → assessOkf23       │
│   UID index, typed edges, lineage, temporal validity, diagnostics, │
│   derived labels, effective state. Recomputed incrementally.       │
│   Supplies defaults for absent governance and MARKS them defaulted.│
└──────────────────────────────▼─────────────────────────────────────┘
                               │ explicit, previewed, hash-bound writes
┌──────────────────────────────▼─────────────────────────────────────┐
│ GOVERNANCE PLANE — .okf/ sidecars (governed territory)             │
│   assessments/  proposals/  decisions/  diagnostics/               │
│   policy/  schema/  cache/  migrations/  backup/                   │
│   Crash-safe writes, uid-keyed, input-hash-bound, per-decision     │
│   immutable records. Never rendered as note frontmatter.           │
└────────────────────────────────────────────────────────────────────┘
```

### Normative: writers on the authoring plane

There are exactly **two** sanctioned authoring-plane writers, and no others:

1. **Governed apply** (migration / accepted proposals): previewed, hash-bound,
   backed up, applied inside `vault.process` (§3.4).
2. **The timestamp stamper** (`applyNoteTimestamps`, settings-toggleable, on by
   default): maintains `created_at` on unadorned notes and reconciles `updated_at`
   with file mtime. This is disclosed machine ownership: **`updated_at` is a
   machine-maintained field**; humans should not hand-curate it. Proposal envelopes
   bind an input hash computed with `updated_at` excluded, so a stamper run never
   staleness-invalidates a pending proposal.

Scalars permitted in frontmatter: `okf_version, uid, title, type, created_at,
updated_at, description, resource, epistemic_state, sensitivity, authorship_origin,
scope, scope_id` (2.2 additionally: `timestamp`). Flat string lists: `tags`, lineage
keys, relation keys, and a new flat `sources:` list (§3.6) — quoted wikilinks or URLs.
Unknown user fields pass through untouched.

**No Kosmos-Oden writer ever introduces nested governance blocks into a note.**
(Beta.12 caveat: the enrichment writer round-trips *pre-existing* hand-authored nested
2.3 frontmatter through its serializer; beta.13 makes that round-trip byte-preserving
outside the edited keys, or refuses with a diagnostic — work item §5.7.) The reader
continues to accept hand-authored nested 2.3, and the safe-onboarding repair path
continues to flatten marker-carrying generated notes.

**Authority rule for flat `authorship_origin`:** the scalar is a *description*, not a
switch. Values other than `authored`/`derived` (i.e. `proposed`, `approved`) are
projected as `authored` and raise `OKF-AUTHORITY-003` ("flat approved/proposed origin
requires a corroborating decision record") unless a matching `.okf/decisions/` record
exists. Without this rule, one typed word in the Properties panel would fabricate the
approval state the entire governance plane exists to gate (beta.12 currently has this
hole — work item §5.4).

## 3. Component redesign

### 3.1 Parsing, Obsidian's metadata cache, and property types

Keep the engine's own bounded parser as the **semantic source of truth**; use
`app.metadataCache` only as a **change signal** and for UI affordances. Rationale: the
engine's grammar is deterministic and shared with the standalone build (§39 one-engine
rule); `metadataCache` YAML semantics differ and would fork semantics between surfaces.

Property-type registration is a **UI nicety semantics never depend on**, implemented
honestly: `app.metadataTypeManager` is an *undocumented internal* API (absent from
`obsidian.d.ts`), so the "Register OKF property types" settings action feature-detects
it at runtime (try/catch, method-presence check) and otherwise shows the user a manual
`.obsidian/types.json` snippet to paste. Types: `epistemic_state`, `sensitivity`,
`authorship_origin`, `scope`, `uid` → *text*; `tags`, lineage/relations, `sources` →
*list*; **`created_at`/`updated_at` → *text*, deliberately not *datetime*** — the
Properties datetime editor is a `datetime-local` input that rewrites values as naive
local time (no seconds, no `Z`), silently corrupting the engine's UTC Zulu format. The
parser additionally accepts and deterministically normalizes `YYYY-MM-DDTHH:mm` naive
values (interpreted as local, converted to Zulu) so a user who does set a datetime type
cannot break validation — with a round-trip test (§6).

### 3.2 UID-first identity and rename handling

New module `src/core/identity.ts` + persisted cache `.okf/cache/uid-index.json`:

```jsonc
{ "schema": "okf-uid-index/1",
  "uids": { "<uid>": { "path": "Notes/A.md", "aliases": ["Old/A.md"], "firstSeen": "…" } } }
```

- Rebuilt deterministically from the corpus at any time; the cache only preserves
  **rename history** (path aliases), which cannot be derived from bytes.
- Wired to `vault.on("rename")` (VaultDataProvider already tracks renames).
- Diagnostics stay as-is (`OKF-IDENTITY-001..004`), plus `OKF-IDENTITY-005
  path-to-uid drift` when a cached uid reappears at a new path without a rename event.
- Duplicate UIDs keep failing closed.

### 3.3 Sidecar subsystem (new `src/core/sidecar/`)

`paths.ts` — deterministic uid-keyed paths, reject absolute/traversal, all under `.okf/`.

`writer.ts` — **crash-safe write protocol** (the guarantee is "no partially-written
target is ever observable", *not* POSIX atomicity — `DataAdapter` exposes no fsync, and
rename semantics differ per platform):

1. Write `<target>.tmp-<runId>`; read back and hash-verify.
2. *Creation:* `adapter.rename` tmp → target.
3. *Update:* attempt rename-over; on failure (Windows EPERM/EBUSY from sync/AV holds —
   retry briefly with backoff; mobile Capacitor adapters that refuse overwrite) fall
   back to: rename target → `<target>.old-<runId>`, rename tmp → target, delete `.old`.
4. Startup sweep completes or rolls back interrupted replacements using the `.tmp-*` /
   `.old-*` markers.

`reader.ts` / `merge.ts` — schema-validated loads; a sidecar failing validation is
quarantined (`*.invalid-<ts>`) and diagnosed, never half-applied.

**Sync reality (two distinct regimes):**

- **Obsidian Sync ignores dot-folders other than `.obsidian`** — `.okf/` does *not*
  replicate. Consequence: governance artifacts are **device-local** under Obsidian
  Sync. Everything except decisions rebuilds deterministically from bytes; decision
  records do not. The settings expose an optional **non-dot governance folder** (e.g.
  `okf/`, user-configurable, same layout) for Obsidian Sync users who need decisions
  and proposals to travel between devices.
- **Third-party file sync (Nextcloud, Syncthing, Dropbox, Git) replicates every
  `.okf/` write.** The sync-storm rule therefore stands: sidecars are written only by
  explicit user actions — never automatically on file change. Assessments remain
  in-memory by default, with an explicit "Write assessment sidecars" command
  (previewed, batch, one file per uid so diffs stay local).

### 3.4 Proposals and decisions — the single-actor governed loop

Extends the existing enrichment flow (pending-until-accept) into a general envelope:

- `.okf/proposals/<proposal-id>.yaml` — origin-preserving envelope: target uid, input
  content hash (computed excluding `updated_at`, §2), proposed patch (authoring-plane
  keys only), proposer identity (`human`, `plugin:enrichment`, `agent:<id>`),
  created/expiry, rationale.
- **Ingress validation is structural, not authority-judging.** Rejected at ingress:
  schema-invalid, stale hash, keys outside the authoring plane, unbounded wikilinks,
  oversized. **Admitted but tagged `requires-elevated-authority`:** sensitivity
  reductions and epistemic promotions — the OKF+ 2.3 spec explicitly locates these *in
  proposal space* (agents may propose, must never finalize); refusing them at ingress
  would push agents toward ungoverned channels. The review UI surfaces the tag
  prominently; nothing automated ever applies them.
- **Decisions: one immutable file per decision** — `.okf/decisions/<decision-id>.yaml`
  (matching SIDECAR-FORMAT.md's reserved layout), each carrying `prev_decision_id` +
  `prev_hash`. Immutable-once-written files survive file sync without conflict-copy
  chain forks; the chain is a *derived index* (head file rebuilt deterministically),
  and two heads after a sync merge raise an `OKF-DECISION-002 fork` diagnostic instead
  of a false tamper alarm. The current head hash is also persisted in plugin
  `data.json` (outside the synced corpus) and shown in the UI, so ledger truncation or
  rewrite is visible. **Disclosed honestly:** the chain detects accidental corruption,
  truncation, and naive edits; it does **not** authenticate the writer — any process
  with filesystem access can re-hash. Per-entry signatures with an out-of-vault key are
  the documented upgrade path if that guarantee is ever needed.
- Decision record fields (per GKOS §6.5, adapted): decision id, proposal id **and
  revision (hash)**, disposition (acceptances *and rejections* recorded identically),
  actor, `authority_receipt: none (single-actor profile)` — the absence is a recorded
  fact, not an omission — rationale/reason code (required, may be short), evidence
  refs (uids/hashes reviewed), effective scope, expiry/defer where applicable,
  timestamp, plan hash.
- **Apply** uses `vault.process` with the staleness check **inside the process
  callback** (compare current content to the plan's original; return unchanged and
  mark skipped on mismatch) — exactly as `applyOkfMigrationPlan` already does. Never a
  separate read-then-write. Byte-exact backup under `.okf/backup/` first.
- **Origin attribution survives apply:** fields last set by an accepted proposal are
  attributed origin `approved` (with decision id) in the projection and all API/export
  surfaces — the decision index overlays the parse — until a subsequent human edit
  (hash change outside a governed apply) re-attributes them as authored. Without this,
  accepted agent values would masquerade as authored on the next scan, violating the
  origin-separation invariant.

**Single-actor profile — stated loudly, not hedged:** under this profile, GKOS §5.7
separation-of-duties is **waived, not satisfied**. The vault owner accepting their own
(or their agent's) proposal is unilateral owner action, recorded as such
(`disposition: self-accepted` for human-origin proposals); the actor field is an
unauthenticated assumption. What the engine *does* enforce is procedural: an agent
identity has no accept surface (accept exists only in the human UI), and no automated
path applies anything. Any conformance statement must list this waiver as a limitation.

**Agent ingress:** the read API remains read-only; proposal ingress is a **separately
claimed, separately authorized write capability** — a distinct opt-in `POST
/v1/proposals` endpoint (and `okf_submit_proposal` MCP tool) requiring a
propose-scoped token, writing only to `.okf/proposals/`, never touching notes.
Landing it requires amending `kosmos-invariants.yml` (`api_write_routes:
proposals-inbox-only`), `scripts/check-invariants.mjs`, and THREAT-MODEL.md in the
same change — the CI invariant is a feature, not an obstacle. Fail-closed sensitivity
applies to the ingress too: a target note above the caller's sensitivity ceiling
behaves identically to a nonexistent target (same response class, no hash-match
oracle). Queue governance per GKOS §11.5: max pending proposals (total and per
proposer), endpoint rate limit, saturation diagnostic.

### 3.5 Assessment, policy, and schema identity

- Policy stays versioned + hashed (`OKF23_POLICY`); add `.okf/policy/` loading with
  hash-pinning; fall back to built-in.
- Assessments embed `input_hash`, `policy_hash`, `engine_version` — reproducible,
  cache-keyed by exactly those.
- **Defaulted-vs-authored marking:** the projection marks every governance value it
  defaulted (absent `epistemic_state`, absent `sensitivity`, stamped timestamps) so
  agents and assessments can discount stamped values instead of mistaking boilerplate
  for curation.

### 3.6 Capture ergonomics (new, normative)

- An unadorned note is **never an error**. Notes without OKF frontmatter project as
  legacy with warnings, exactly as today. In the flat 2.3 profile, a missing
  `epistemic_state` is a *warning* + default (`hypothesis`, marked defaulted), not an
  error — beta.12's error-level `OKF-SCHEMA-004` for it is relaxed (work item §5.5).
- **Onboarding new captures is low-friction:** a "New governed note" template command,
  and an opt-in "onboard new notes" prompt that reuses the previewed hash-bound
  conversion flow. The recurring nature of onboarding (scan never rewrites) is
  documented rather than left for users to discover.
- Converters stop fabricating `description` boilerplate: when the source has none,
  none is written (description is not required by the flat profile).
- New flat `sources:` list (URLs or quoted wikilinks) for the humans who *do* curate
  citations — students, researchers, journalists. The projection maps entries to
  minimal evidence records (source refs without weights), so evidence_support stops
  being permanently null for exactly the users who care about evidence.

### 3.7 Migration, enrichment, incremental (kept)

The beta.12 governed-write flow (deterministic scan → hash-bound plan → preview →
byte-exact backup → atomic apply → result artifact) is the model for all writes. The
flat editable 2.3 profile is the only 2.3 target any converter writes. Enrichment
emits proposal envelopes (§3.4). `VaultDataProvider` events → `KosmosIndex` deltas
remain the single update path; the uid-index and proposal-staleness checks subscribe
to the same deltas.

## 4. Scope and honest claims

- The two sanctioned authoring-plane writers are enumerated in §2; there are no
  others, and no background sidecar churn.
- No epistemic promotion, sensitivity reduction, or lineage rewrite by any automated
  path — such proposals exist, tagged, and wait for the human.
- Conformance claim: **OKF+ 2.3 Validating Projection Profile — a GCP-2/3-shaped
  projection with L5-style decision recording under a disclosed single-actor waiver.
  No L1 source-preservation capability is implemented or claimed** (notes are mutable
  working files; backups are transient apply-safety artifacts, not a revision store).
- No dependence on Obsidian internals for semantics; internal APIs are used only for
  optional UI affordances behind feature detection.

## 5. Work items (beta.13, each lands independently)

1. `src/core/sidecar/` (paths, crash-safe writer with platform fallbacks, reader,
   quarantine, startup sweep) + tests.
2. UID index cache + rename wiring + `OKF-IDENTITY-005`.
3. Proposal envelope + structural validation + per-decision files + derived chain
   index + head anchor in `data.json` + review UI.
4. `OKF-AUTHORITY-003`: flat `authorship_origin` treated as description; corroboration
   required for `approved`/`proposed` (closes the beta.12 authority hole).
5. Capture ergonomics: relax flat-profile `epistemic_state` to warning+default;
   defaulted-vs-authored marking; stop fabricating `description`; flat `sources:` list
   mapped to minimal evidence; "New governed note" + onboarding prompt.
6. Enrichment refactor onto envelopes; origin-attribution overlay from decisions.
7. Nested-2.3 enrichment round-trip made byte-preserving outside edited keys (or
   refuse with diagnostic).
8. Opt-in proposal ingress (propose-scoped token; invariants/threat-model amended in
   the same change; ceiling-aware responses; queue caps).
9. Property-type registration convenience (feature-detected) + types.json snippet doc.

## 6. Test additions

- Crash-safety: interruption at every step of the write protocol leaves either old or
  new bytes, never partial; startup sweep converges; `.old-*` fallback path exercised.
- Windows rename-contention retry; mobile no-overwrite fallback (adapter mock).
- Properties datetime round-trip: naive `YYYY-MM-DDTHH:mm` values normalize
  deterministically; stamper runs don't invalidate pending proposal hashes.
- Envelope: stale hash, non-authoring-plane keys, ceiling-aware nonexistent-target
  equivalence, `requires-elevated-authority` tagging, queue saturation.
- Decisions: per-file chain verification, sync-fork diagnostic (two heads), head
  anchor divergence, rejection records, self-accepted disposition.
- Origin attribution: accept → apply → rescan yields `approved` origin with decision
  id; later human edit re-attributes authored.
- `authorship_origin: approved` without decision record → `OKF-AUTHORITY-003`,
  projected as authored.
- Round-trip: flat-2.3 note + accepted proposal → rescan yields zero changes.
