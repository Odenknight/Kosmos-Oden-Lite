# Threat Model

An iterative model (Doc1 §5.3). It reflects v0.6.5 and is revised whenever
network or data-access behavior changes.

## Assets

- **Vault confidentiality** — notes may contain private, medical, legal,
  business or credential material. The Agent API is read-only, but read-only
  still permits *disclosure*: a disclosure defect can leak the whole vault.
- **Artifact integrity** — users install `main.js` without compiling; they
  trust it matches reviewed source.
- **The auth token** — grants read access up to the configured OKF+
  sensitivity ceiling (default `internal`).
- **Source-note integrity** — the optional OKF+ onboarding command has write
  authority only after a dry-run approval; a bulk metadata defect could damage
  many notes or misclassify sensitive material.
- **Nextcloud credentials and synchronized file integrity** — the optional
  backend can read and write the configured remote folder and local vault.

## Trust boundaries

1. **Obsidian host ↔ renderer iframe.** The renderer is large and partly
   machine-generated; note-derived data flows into it. It runs in a sandboxed,
   opaque-origin iframe (`allow-scripts allow-pointer-lock allow-downloads`, no
   `allow-same-origin`) and communicates only via a versioned, validated
   `postMessage` protocol. This is defense-in-depth, not a claim that the host
   itself is untrusted (the host already has Obsidian privileges).
2. **Agent API process boundary.** Local programs / agents on the machine can
   reach `127.0.0.1`.
3. **Agent API network boundary (LAN mode).** Other machines on the subnet can
   reach the API when LAN mode is explicitly enabled.
4. **Build/release pipeline.** Source → `main.js` → GitHub release.
5. **OKF+ migration write boundary.** In-memory audit plan → explicit human
   confirmations → local binary backup → source-matched atomic note process.
6. **Nextcloud boundary.** Local vault → user-configured HTTPS/private endpoint
   → one scoped remote folder. The app password is held by Obsidian Secret
   Storage; comparison state contains hashes and ETags but no credential.

## Adversaries & mitigations

| Adversary / failure | Mitigation |
|---|---|
| Malicious website via the victim's browser (DNS rebinding, CSRF-style) | `Host` + `Origin` validation; token required; opaque `Origin: null` rejected. |
| Local malware / over-permissioned agent | Token auth; rate limit + concurrency cap + output caps bound the damage from a runaway or hostile local client. |
| Network eavesdropper (LAN mode) | LAN mode is off by default, requires a token, and the UI + docs warn that HTTP is unencrypted (use a VPN/SSH tunnel/TLS proxy). Not defended: passive observation of unencrypted LAN traffic — documented, not silently ignored. |
| Token leakage | CSPRNG tokens; never logged; not in URLs by default; query-token auth deprecated/off/blocked-in-LAN; regeneration invalidates old clients. |
| Oversized / malformed request (DoS) | 4 MiB byte-accurate body cap; JSON/MCP envelope validation; request timeouts; per-client rate + concurrency limits; capped response sizes. |
| Stale, forged, or cross-client MCP session | Server-issued session IDs; negotiated `MCP-Protocol-Version` required after initialization; unknown/expired sessions return 404; DELETE actually terminates the session. |
| Confidential/PHI disclosure through graph metadata | Sensitivity ceiling filters search, bodies, nodes, links, lineage/temporal state, diagnostics, and Graphiti pages. Invalid explicit sensitivity labels fail closed as PHI. |
| Invalid 2.3 sensitivity bypasses the connector | The v2.3 effective projection supports all seven levels; missing labels default to internal and invalid values fail closed to secret before connector filtering. |
| A score is mistaken for truth or authorization | Every assessment carries a policy ID/hash and the interpretation `documentation-and-support-quality-not-truth`; no score promotes epistemic state or authorizes use. |
| Proposed or derived values are mistaken for authored/approved values | API and Graphiti projections retain separate authored, derived, proposed, approved, and effective containers; proposed relationships do not enter the effective graph. |
| Ambiguous UID/title resolution creates a false semantic edge | Duplicate UIDs are excluded from the UID index; ambiguous v2.3 relationship and lineage targets emit diagnostics and project no edge. |
| A Graphiti projection is mistaken for accepted truth | Exported episodes identify themselves as non-authoritative origin-separated adapter projections and omit later state from earlier episodes. |
| Path traversal via renderer messages | Message paths validated: no absolute paths, no `..` segments. |
| Malformed note content | Tolerant parser never throws the graph away; lineage validation degrades gracefully and reports via diagnostics. |
| Bulk OKF+ migration damages notes | Read-only dry run; SHA-256-bound plan; independent-backup warning and acknowledgement; byte-exact per-file backup; source equality recheck; Obsidian atomic processor; human-authored body preserved; changed/missing notes skipped; result audit. |
| Generated nested metadata prevents human correction or duplicates timestamps | Flat OKF+ 2.2 Obsidian Properties are the default writer surface; beta.10 repair is marker-gated, hash-bound, backed up, removes duplicate timestamps, and preserves genuinely authored native 2.3 notes. |
| Migration hallucinates metadata or leaks notes to a model | The migration is deterministic and contains no LLM or network call. Conservative defaults are disclosed. Ambiguous YAML, invalid governance data, unsafe semantic links, and UID conflicts are blocked for review. |
| `internal` default is mistaken for privacy classification | Apply requires acknowledgement that defaults are not content inspection; UI/docs require confidential/PHI review before cloud routing. Connector sensitivity enforcement remains independent. |
| OKF processing rewrites agent-control/generated files | Custom exclusion patterns and an opt-in developer preset are applied before migration/enrichment; previews disclose every excluded path/pattern. The preset defaults off so upgrades never silently omit user notes. |
| LAN model address is public, rebound through DNS, or exposed on an untrusted network | LAN mode requires a private/link-local IP literal, rejects DNS/public/bind-all/loopback addresses, displays the exact endpoint on every run, uses a separate sensitivity ceiling, always blocks PHI, and warns that network/device/firewall/model trust remains the user's responsibility. |
| Nextcloud credential disclosure | Dedicated app-password guidance; Obsidian Secret Storage; password excluded from plugin data/logs; HTTPS required except literal private/loopback addresses; `.obsidian/**` excluded by default. |
| Stale overwrite or concurrent two-device edit | Last-common-state SHA-256/ETag comparison; `If-Match`/`If-None-Match`; simultaneous edits preserve a timestamped remote conflict copy. |
| Accidental deletion propagation | Disabled by default; unchanged-vs-deleted state propagates only after opt-in, while changed-vs-deleted becomes a conflict. Independent backups are still required. |
| Malicious remote path or excessive tree | Decoded paths reject absolute/traversal/NUL/backslash forms; listing is depth and entry capped; writes remain inside the configured DAV root. |
| Artifact substitution / stale build | Reproducible executable artifacts; release `SHA256SUMS` + `BUILD-INFO.json` (commit/tag/lockfile hash); release built from the tag in CI; `check:artifacts` + `check:versions`. |
| Dependency / supply-chain compromise | Pinned versions + committed lockfile; `npm ci` everywhere; Dependabot; dependency-review on PRs; minimal, mostly dev-only dependency surface. |
| Silent security regression | `kosmos-invariants.yml` + `check:invariants` gate CI; negative security tests. |

## Explicitly out of scope / not claimed

- No protection against a compromised Obsidian host or a compromised authorized
  agent.
- No encryption of LAN traffic (use a tunnel/proxy).
- `srcdoc` alone is **not** treated as a sandbox — the explicit `sandbox`
  attribute is what provides isolation (see `RENDERER-PROTOCOL.md`).
- No claim of bit-for-bit reproducibility of release *metadata* (build time
  differs); executable artifacts are byte-reproducible.
- No full GKOS, Governed Writer, authority-verification, human-attestation, or
  remote schema-update conformance claim. The bundled 2.3 policy is read-only.
