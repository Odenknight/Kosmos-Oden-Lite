# Standalone OKF Engine — Design and ADR-001

**Status:** Design for the post-beta.13 cycle (adversarially verified against the
beta.12 codebase; implements the ADR the deferred note required before code moves)
**Inputs:** `OKF_PLUS_STANDALONE_ENGINE_BUILD_INSTRUCTIONS.md`,
`DEFERRED-STANDALONE-OKF-ENGINE.md`, beta.12 codebase, the flat-2.3 profile,
`docs/OKF-23-OBSIDIAN-ENGINE-REDESIGN.md`.

## 1. Goal

Give people who do not use Obsidian the same deterministic OKF engine over any folder
of Markdown notes organized "vault-like": a root directory, nested folders, `*.md`
notes with flat frontmatter, attachments alongside, and a `.okf/` governance directory
at the root. Obsidian becomes one client among several; it stops being the owner of
engine semantics.

## 2. ADR-001 — Process boundary

**Decision: library-first core, CLI as the standalone product, opt-in local service.
No always-on daemon. No child-process bridge from the plugin in v1.**

| Option | Verdict | Reasoning |
|---|---|---|
| **A. Embedded library** (all surfaces share one core) | **Adopted (already substantially true)** | `src/core/` is Obsidian-free today. All surfaces build from the same source: the plugin and `vault-kosmos.html` are esbuild-bundled from `src/`, while `kosmos-build.mjs` and the tests consume the `dist/kosmos-core.mjs` bundle (rebuilt by CI, attached to releases, not committed). Publishing `@okf/core` is real but modest packaging work — entry-point hygiene, exports map, semver — not a rewrite. |
| **B. Child process** launched by each client | Rejected for v1 | Writes are rare, human-invoked, hash-bound, previewed, and backed up; crash-consistency comes from the tmp-write/verify/rename protocol, so process isolation buys nothing today. Adds process management, IPC, and lifecycle bugs on three OSes. Revisit if a non-JS client appears. |
| **C. Always-on local service** | Opt-in, not default | `okf serve` hosts the existing agent server (REST + MCP, localhost, token) against a folder. Useful for agent harnesses; wrong as a requirement for a note-taking public. |

Consequences: one repo, one semantic core, one conformance suite running the same
fixtures through embedded, CLI, REST, and MCP adapters and asserting byte-identical
canonical output (the DEFERRED doc's acceptance criterion).

## 3. What already exists vs. what gets built

| Capability | beta.12 status | Standalone work |
|---|---|---|
| Deterministic parser/projection/assessment (2.2, flat 2.3, nested 2.3, legacy) | ✅ `src/core/okf23.ts` etc. | Package as `@okf/core` (exports map, types, semver) |
| Graph, lineage, temporal, incremental | ✅ `src/core/` | Reuse as-is |
| CLI | ⚠️ `kosmos-build.mjs` (graph + Graphiti episodes only) | Grow into `okf` CLI (§5) |
| REST + MCP server | ✅ `src/plugin/agent-server.ts` — Obsidian-free (imports only `../core/*`; receives `http` via constructor) but mislocated | Move to `src/core/` or `src/server/` when the CLI starts hosting it; host against a directory source |
| Directory source + watcher | ✅ `src/standalone/directory-source.ts`, `src/standalone/directory-monitor.ts` (browser File System Access) | Node adapter: initial scan + rescan-diff (mtime/size signature), `--watch` |
| Sidecars, uid-index, proposals, decisions | Designed (Obsidian redesign §3.3–3.4); platform-neutral adapter interface | Node filesystem adapter for the same modules |
| Schema/policy packages, pinning, rollback | ❌ | Phase 4: `.okf/schema/` + `.okf/policy/` with hash verification; remote update **out of scope** (offline-first; the full provider/signature system is later, if ever) |
| Exporters | ✅ Graphiti (`src/core/graphiti.ts`); ❌ JSONL (new) | `okf export graphiti` reuses; `jsonl` is new work |
| Single-file viewer | ✅ `vault-kosmos.html` | Unchanged; later: read-only display of `.okf/` diagnostics/assessments |

**Phase-1 prerequisite (found by code audit):** add `.okf` to the shared corpus-scan
ignore rules (`DEFAULT_IGNORED_DIRS` in `src/core/paths.ts` currently lists only
`.obsidian`, `.git`, `node_modules`, `.trash`). Today a non-Obsidian scan would index
`.okf/migrations/*/plan.json` artifacts as corpus attachments (`json` is in
`ATTACHMENT_EXTENSIONS`). The sidecar reader accesses `.okf/` through its own path
API, never through the corpus scanner.

## 4. The vault-like contract

A standalone corpus is any directory where:

- notes are `*.md` / `*.markdown` with optional flat frontmatter;
- identity is uid-first (missing uids ⇒ path-bound + diagnostic, as in Obsidian);
- `.okf/` at the root holds all governance artifacts (SIDECAR-FORMAT.md layout);
- ignored by default: `.okf/`, `.obsidian/`, `.git/`, `node_modules/`, **`.trash/`**
  (Obsidian's in-vault trash holds deleted notes whose stale uids would otherwise
  collide with live successors and knock both out of resolution), `.stfolder/`,
  `.stversions/` (Syncthing); plus a user ignore list (`.okf/ignore` or config key)
  for template folders and `*.excalidraw.md`;
- wikilinks resolve by the same resolver rules as the plugin (path, basename, alias).

An Obsidian vault is a valid standalone corpus with no conversion.

**Rename reality outside Obsidian (normative convention):** no plain-text editor
(VS Code, iA Writer, …) rewrites frontmatter wikilinks on rename — a renamed note
silently breaks inbound title-based relations. Two mitigations, both required:

1. **Uid-valued relation targets are the standalone convention.** The engine already
   resolves relation/lineage targets uid-first (`src/core/graph.ts` consults the uid
   index before title resolution), making uid targets fully rename-proof. Documented
   as the recommended form for non-Obsidian corpora.
2. **`okf mv <old> <new>`** performs the rename *and* deterministically rewrites
   inbound wikilink targets via the same hash-bound plan/preview/backup flow as
   `migrate` — the CLI's own "automatically update internal links".

## 5. Surfaces

```text
okf validate [dir]            # schema + identity + lineage diagnostics, exit code
okf assess [dir] [--json]     # per-note scores/labels, corpus summary
okf graph [dir] -o graph.json # canonical graph (stable serialization)
okf lineage <uid|path>        # chain view with temporal intervals
okf at-time <ISO> [dir]       # point-in-time projection
okf export graphiti|jsonl     # graphiti: existing exporter; jsonl: new
okf mv <old> <new>            # rename + governed inbound-link rewrite
okf migrate plan|apply        # SAME hash-bound plan/preview/backup flow as the plugin
okf proposals list|show|accept|reject   # closes the governed loop in standalone:
                              # identical envelope re-validation, hash re-check,
                              # crash-safe apply, backup, decision record as the
                              # plugin review UI — never hand-edit .okf/proposals/
okf serve [--port] [--mcp]    # read-only REST+MCP; proposals ingress separately
                              # claimed + propose-scoped token (opt-in)
```

Determinism contract on every output: stable key order, stable array order, and an
embedded `build:` block (`engine_version`, `policy_hash`, `corpus_hash`).

## 6. Security posture

Localhost default; token auth (crypto RNG only); Host/Origin checks; byte-counted
request limits; fail-closed sensitivity ceiling on every response, including proposal
ingress (above-ceiling targets behave as nonexistent). **The write surface,
enumerated:** proposals inbox (opt-in, propose-scoped token), `migrate apply`,
`proposals accept` (apply + decision record), `mv` (link rewrite), assessment-sidecar
export, uid-index cache. Every one is explicitly invoked, previewed or hash-bound,
crash-safe, and backed up; nothing writes on a timer or on file-change. Remote schema
acquisition disabled by default; anything loaded from `.okf/schema|policy` must
hash-verify against its manifest.

## 7. Phasing

1. **MVP:** `okf validate|assess|graph|export` over a directory + the `.okf` scan
   exclusion + shared conformance fixtures proving plugin/CLI output identity. The
   Dublin-Core move: a stranger gets value in five minutes without Obsidian.
2. **Governed writes:** `okf migrate`, sidecar subsystem, `okf mv`,
   `okf proposals list|show|accept|reject`, proposals inbox.
3. **Service:** `okf serve` REST/MCP parity; agent-harness documentation.
4. **Packages:** schema/policy package loading, pinning, rollback; remote providers
   last, if ever.

## 8. Non-goals

- No GUI app in v1 (the HTML viewer covers visualization; the CLI covers operations).
- No LLM anywhere in the engine. Enrichment stays a client-side, proposal-emitting
  concern.
- No bespoke sync. Files are the interface; users bring their own sync. (Note the
  Obsidian-Sync caveat from the redesign doc: dot-folders don't travel under Obsidian
  Sync — the configurable non-dot governance folder applies here too.)
