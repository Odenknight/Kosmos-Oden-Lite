# OKF/OKF+ Note Audit and Migration

## Purpose

**Mark notes in OKF+ format** is a user-triggered Obsidian workflow for safely
onboarding existing Markdown notes. It scans every vault note except the
processor-owned `.okf/**` sidecars, recognizes either:

- native nested **OKF+ 2.3** and flat **OKF+ 2.2 compatibility** frontmatter; or
- Google's permissive **Open Knowledge Format 0.1 draft**, whose concept-note
  conformance requirement is parseable YAML frontmatter with a non-empty
  `type` field.

Google OKF is an interoperability floor; OKF+ is the stricter identity,
governance, sensitivity, lineage, and typed-relationship extension used by
Kosmos. Google's current primary specification is
[GoogleCloudPlatform/knowledge-catalog/okf/SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Workflow and warnings

The beta.12 workflow offers three explicit modes:

- **Scan and repair** leaves valid editable 2.2, genuinely authored native 2.3,
  conforming Google OKF notes, and reserved `index.md`/`log.md` documents
  unchanged. It proposes a flat 2.2 repair only for notes carrying beta.10's
  deterministic-migration marker.
- **Convert all to editable 2.2** also proposes compact flat metadata for every
  mechanically recoverable ordinary, Google OKF, reserved, or legacy note.
  It is an override of recoverable values, not an instruction to guess through
  ambiguity or identity conflicts.
- **Convert all to native 2.3** proposes native nested OKF+ 2.3 metadata for
  mechanically recoverable notes while preserving ordinary Obsidian `tags` and
  flat wikilink relationship fields as editable overlays.

1. Make a separate, restorable backup or snapshot. Cloud sync is not a backup:
   it can propagate unwanted edits and deletions.
2. Run the command and review the dry-run counts, paths, findings, defaults,
   and SHA-256 plan hash. Scanning never changes notes.
3. Optionally save the content-free audit without applying it.
4. To apply, confirm both the independent backup and the sensitivity warning.
   Upgrade-all also requires a separate governed-override acknowledgement.
5. The plugin rechecks every source. A note edited, renamed, or deleted after
   the scan is skipped.
6. Before each edit, the original file bytes are copied to
   `.okf/backup/<run-id>/<original-path>.bak` using binary I/O.
7. Obsidian atomically processes the matching source. The human-authored body
   is unchanged; only frontmatter is added or normalized.
8. The approved plan and result are stored under
   `.okf/migrations/<run-id>/` without note bodies.

The local backup helps recovery but is not independent: it lives in the same
vault and may be synchronized with it. Keep an external snapshot as well.

## Classification

| Result | Action |
|---|---|
| Native OKF+ 2.3 | Leave unchanged |
| Valid OKF+ 2.2 note | Leave unchanged as the human-editable authoring format |
| Beta.10 deterministic-migration 2.3 note | Propose a compact flat 2.2 repair |
| Google OKF 0.1 draft | Leave unchanged |
| Google `index.md` / `log.md` | Treat as reserved; leave unchanged |
| Safe mechanical candidate | Propose editable OKF+ 2.2 in the dry run |
| Ambiguous or conflicting | Block and report for human review |

In convert-all mode, the two Google rows become proposed flat 2.2 changes when
their frontmatter is mechanically recoverable. Invalid legacy version, UID,
type, timestamp, epistemic state, scope, and sensitivity values are replaced
with conservative values. Every original overridden value is retained in the
hash-bound plan's `salvage` records and in the byte-exact backup.

Legacy `id` is never emitted as governed metadata: a valid lowercase
UUIDv4 `id` is migrated to `uid`; `id: unknown` or another invalid value is
salvaged and replaced with a newly generated UUIDv4.

Blocking conditions include unterminated frontmatter, unsupported YAML, unsafe
lineage or relationship serialization, and duplicate UIDs. The only duplicate
keys repaired automatically are the duplicate top-level `created_at` and
`updated_at` pairs written by beta.10, and only when the deterministic-migration
marker is present. Other duplicates remain blocked.

## Confidence and manual review

Every plan entry includes a deterministic `review` object:

- `required`: whether the note remains blocked for manual review;
- `confidence`: a 0–1 score estimating only the mechanical safety of the
  metadata rewrite;
- `basis: deterministic-migration-safety`;
- `reasons`: every coded finding shown in the UI and persisted in the plan.

Blocked entries are displayed lowest-confidence first. Confidence only orders
review; it is not an entailment probability, epistemic state, approval, or
authority to commit semantic meaning. The score and reasons are covered by the
plan hash, so they cannot be altered after approval without invalidating the
write plan.

## Conservative defaults

For a note without a safe existing value, onboarding emits compact Properties:

- `okf_version: "2.2"`;
- a cryptographically generated, lowercase UUIDv4 `uid`;
- `type: "semantic"`;
- the filename stem as `title`;
- a transparent title-based `description`;
- file creation time (then modification/onboarding fallback) as UTC `timestamp`;
- flat `epistemic_state`, `scope`, `scope_id`, and `sensitivity` values;
- user-selectable `tags` and flat wikilink lists for lineage/relationships; and
- preserved human comments and unknown parseable Obsidian fields.

These defaults establish a structurally valid, narrow, non-authoritative
starting point. They are not an assertion that a model inspected or understood
the note, and `internal` is not a privacy scan. Review confidential and PHI
content before enabling cloud agents or expanding a connector's sensitivity
ceiling.

## LLM assessment

An LLM is not necessary for structural onboarding and is intentionally absent
from the apply path. Structural repair, UID assignment, canonical ordering,
backup, source matching, and plan binding are deterministic tasks. Adding a
model would introduce privacy, nondeterminism, cost, and hallucination risk
without improving those guarantees.

After deterministic structural onboarding, the separate content-assisted
enrichment workflow can create *pending proposals* for descriptions, note
types, tags, or explicitly evidenced relationships:

| Route | Benefits | Costs and risks |
|---|---|---|
| On-device LLM | Notes stay on the device; offline; controllable retention | More setup and hardware; often weaker classification/summarization; local software still needs a trust review |
| LAN LLM | Data stays on an explicitly selected private-network model host; can use stronger shared hardware | Other devices/Wi-Fi/VLAN and an exposed unauthenticated model port remain risks; private addressing is not proof of trust |
| Cloud LLM | Often stronger language and classification; less local hardware | Note data leaves the device; provider retention/policy, credentials, cost, latency, prompt injection, and confidential/PHI restrictions |
| No LLM | Reproducible, fast, private, easy to audit | Generic descriptions/types require later human refinement |

The implemented policy is on-device/LAN-first for non-public notes, explicit
per-run LAN/cloud consent, minimum-necessary bounded excerpts, no cloud
fallback on on-device/LAN failure, no governance-authority fields in the model
schema, and a pending
review queue rather than automatic frontmatter writes. See
[OKF+ Content-Assisted Enrichment](OKF-ENRICHMENT.md). The universal read-only
MCP connector remains separate and does not grant a model write authority over
this migration.

The enrichment action is a re-scan, not a one-time migration stage. Every time
**Scan labels and links** runs, it reads current eligible editable 2.2 and
valid native 2.3 notes again. Unchanged notes may produce
the same proposal, and duplicate queue records are suppressed by proposal ID.

OKF processing can exclude custom glob-style paths, and an opt-in developer
preset covers common agent instruction/control files. These rules do not hide
notes from the cosmos or Agent API. Every excluded migration path and matching
pattern appears in the preview.

Blocked migration entries are different: their frontmatter is not safe to
rewrite mechanically. When an on-device or explicitly approved private-IP LAN
LLM is configured, the migration preview offers advisory blocked-note triage.
It sends only deterministic finding codes and bounded frontmatter whose
closing boundary can be proven;
likely credential-key values are redacted. Unterminated frontmatter is
omitted. The model may explain the blockers, suggest manual inspection steps,
and ask questions; it cannot provide
a retained executable YAML patch or write a note. Cloud blocked-note review is
not offered because these notes may lack trustworthy sensitivity metadata. LAN
review requires its own fresh acknowledgement of that uncertainty.

## Recovery

Stop sync before recovering a file. Locate its `.bak` using `result.json`,
verify the target note and run ID, then restore the backup bytes outside the
plugin or from an independent snapshot. Recovery is intentionally not a bulk
one-click action: a later human edit must not be silently erased. Keep the
plan/result records with the restored note for auditability.
