# OKF+ Content-Assisted Enrichment

## What this feature does

For editable OKF+ 2.2 and valid native 2.3 notes, **Scan labels and links** can
create pending suggestions for descriptions, note types, user-selectable
Obsidian tags, and explicitly evidenced relationship wikilinks. It never changes
note frontmatter automatically. The proposal preview may be saved to
`.okf/review-queue.jsonl`, or a human can explicitly review each suggestion
and build a governed apply plan.

The deterministic pass always runs first. A second OpenAI-compatible
on-device, private-IP LAN, or cloud LLM pass is optional and disabled by
default.

This is explicitly a **scan / re-scan** operation. Migration does not mark a
note as permanently processed. Each run reads every currently eligible OKF+
2.2 or valid native 2.3 note within the configured caps. Unchanged notes can produce identical
proposals; duplicate JSONL queue records are suppressed by content-derived
proposal ID.

## “Meaningful” is not an objective automation guarantee

The selector does not claim to find the author's most meaningful paragraphs.
It uses reproducible, auditable proxies:

- exclude YAML, code fences, tables, task lists, images, callouts, and common
  navigation headings;
- require minimum prose length and letter density;
- prefer explicit `supersedes`, `replaces`, `updated version of`, or
  `successor to` language;
- rank qualifying blocks with a small early-position preference; and
- enforce paragraph, per-note character, total-run character, and note caps.

Each record carries a deterministic evidence-quality score and reasons. That
score measures visible structure only. It is not semantic truth, author skill,
or permission to accept a proposal. Sparse, list-first, template-heavy, or
poorly structured notes may legitimately receive weak/insufficient results.
Automation should surface that limitation, not manufacture a purpose the
author did not express.

## LLM safety controls

The optional model is a bounded proposal generator, not an agent with write
authority:

- provider is explicitly `none`, loopback-only `local`, private-IP-only `lan`,
  or HTTPS-only `cloud`;
- LAN and cloud runs require fresh confirmation showing the exact endpoint and
  maximum exposure;
- LAN rejects DNS hostnames, public IPs, bind-all addresses, and loopback
  addresses; its sensitivity ceiling defaults to internal, confidential is an
  explicit opt-in, and PHI is always blocked;
- confidential and PHI notes are never sent to cloud; the configurable cloud
  ceiling is otherwise public-only by default;
- the API key is read from a named environment variable and never stored in
  plugin settings or the review queue;
- notes are processed sequentially with hard note, paragraph, per-note input,
  total-run input, suggestion, response-size, output-token, and timeout caps;
- temperature is zero, tools are an empty list, no automatic retry occurs,
  failure never falls back from local to cloud, and three consecutive provider
  errors stop the second-pass run;
- note excerpts are marked untrusted and embedded instructions are not
  followed;
- output is parsed as JSON and validated against a narrow field schema;
- the model cannot propose `sensitivity`, `scope`, or `epistemic_state`;
- `supersedes` is accepted only when the cited evidence explicitly names the
  exact wikilink after replacement/version language;
- `related_to` is accepted only for a wikilink present in cited evidence; and
- no deterministic or LLM suggestion is written to frontmatter automatically.

Provider retention, account, billing, and privacy policies still apply to a
confirmed cloud run. A timeout stops waiting and prevents retry; the remote
provider may still finish a request already received.

## OKF processing exclusions

Custom case-insensitive patterns support `*`, `**`, and `?`; a bare filename
matches at any depth. An opt-in developer preset covers common agent control
files and directories such as `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`,
`GEMINI.md`, Copilot instructions, `.claude/**`, and `_Claude-Code/**`.
Exclusions apply consistently to migration, enrichment, and blocked-note
review. They do not hide notes from the visualization or read-only Agent API.
The migration preview lists every excluded path and the pattern that matched.

## Review record

The JSONL record contains the source path and hash, provider/model identity,
all active caps, evidence line ranges/rules/hashes (not excerpt text), evidence
quality reasons, and every suggestion's source, confidence, reason, and cited
block IDs. Proposal IDs are content-derived and duplicate queue entries are
suppressed. Suggested metadata is retained by design; a proposed description
may reproduce selected note prose even though the separate evidence excerpts
are omitted.

Before accepting a suggestion in any later workflow, recheck that the note hash
still matches and that relationship direction is correct. Confidence is for
review ordering only; it is never approval or epistemic authority.

## Governed review and apply

Nothing is selected when the review opens. For each suggestion, the reviewer
must explicitly accept or reject it and may edit the proposed value. The final
reviewed value, original proposal, decision, reason, confidence, and evidence
references are bound into the plan. Confidence never selects or accepts an
item.

The proposal window is the reconciliation workspace; you do not need to hunt
through the vault for a separate review screen:

1. Read the short workflow shown at the top and open a note row.
2. Compare each current value, proposed value, confidence, source, and reason.
3. Choose **Accept** or **Reject**. Edit the proposed value before accepting
   when the idea is correct but the wording or list needs correction.
4. Use **Reject all remaining** only when every still-unreviewed proposal
   should remain out of the plan.
5. Build the governed apply plan after the remaining-review count reaches
   zero. This opens another preview and still does not write immediately.

Each note is labeled **model-enhanced** or **deterministic-only**. If the model
times out or returns malformed JSON, that note displays the issue and recovery
choice inline. The partial model response is discarded; deterministic
proposals can still be reconciled safely. Close and re-run after adjusting the
model only if a model second pass is still desired. Never paste raw model JSON
into note frontmatter.

Before a note can be marked ready, the planner:

- rechecks that its SHA-256 hash still matches the source of the proposal;
- rejects conflicting accepted values for scalar fields;
- validates the final field/value grammar;
- resolves every accepted relationship target through the vault; and
- blocks unresolved targets and relationships back to the same note.

The preview displays ready, blocked, and no-change notes plus a SHA-256 hash of
the complete decision plan. Persisted plans deliberately omit note bodies.
Applying requires three acknowledgements: a separate restorable vault backup,
review of every accepted value, and review of relationship direction and
meaning. Target resolution proves only that a target exists, not that the
relationship is true.

Immediately before each write, the plugin verifies the plan hash and its
in-memory content hashes, re-reads the live note, and skips it if even one byte
has changed. It then creates a byte-exact copy under
`.okf/backup/<run-id>/` and uses Obsidian's guarded note processor. Flat 2.2
Properties remain flat and directly editable; native 2.3 notes receive
flat compatibility Properties for accepted relationship corrections. The
Markdown body is preserved byte-for-byte. The decision plan and result audit are stored under
`.okf/enrichment/<run-id>/`.

## Blocked migration notes

Migration-blocked notes do not enter ordinary enrichment because their
frontmatter is not yet canonical OKF+ 2.2. The migration preview can ask the
configured on-device or explicitly approved LAN LLM for advisory triage. This
is intentionally more limited than enrichment: bounded frontmatter and deterministic blocker codes
are sent, with likely credential-key values redacted. The result must cite the
supplied codes, and the
model can return explanations, manual steps, and questions only. The saved
report contains no transmitted frontmatter excerpt and has no apply action.

Cloud blocked-note review is unavailable. A missing or invalid sensitivity
field is itself a common blocker, so using that field to authorize cloud
disclosure would be circular and unsafe. LAN blocked review instead requires a
fresh warning that treats every blocked note as potentially sensitive and
discloses only the bounded/redacted advisory input.
