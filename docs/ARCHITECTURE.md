# Architecture

Kosmos-Oden is **three products sharing one semantic engine**. That engine —
the Kosmos Core — is the single most important design decision: without it, the
plugin, standalone page, Agent API, Graphiti exporter and CLI would drift into
five different interpretations of the same vault.

```
                    ┌─────────────────────┐
                    │   Kosmos Core        │  src/core/
                    │  parsing             │
                    │  link resolution     │
                    │  canonical lineage   │
                    │  temporal projection │
                    │  graph construction  │
                    │  incremental index   │
                    │  Graphiti export     │
                    └──────────┬──────────┘
        ┌──────────────┬───────┴───────┬──────────────┐
        ▼              ▼               ▼              ▼
  Obsidian plugin  Standalone     Agent API       kosmos-build
  src/plugin/      src/standalone/ src/plugin/     kosmos-build.mjs
                                   agent-server.ts
        │              │               │              │
        └──────────────┴───────┬───────┴──────────────┘
                               ▼
                    Renderer  src/renderer/
                    (cosmology · layout · shaders · renderer)
```

## Modules

### `src/core/` — the shared engine (DOM-free, runs in Node and the browser)
| File | Responsibility |
|---|---|
| `types.ts` | Shared types: nodes, links, graph, diagnostics, lineage/temporal models. |
| `paths.ts` | POSIX path normalization, note/attachment classification, deterministic hashes. |
| `markdown.ts` | Tolerant frontmatter + wikilink/markdown/property link parsing. |
| `okf.ts` | Flat OKF+ 2.2 metadata, typed relations, compatibility aliases, and legacy `**Related:**` parsing (declarations only). |
| `okf23.ts` | Source-preserving nested OKF+ 2.3 parser, origin-separated validating projection, deterministic policy/assessment, labels, and structured diagnostics. |
| `okf-migration.ts` | Strict Google OKF/OKF+ conformance audit plus deterministic, hash-bound OKF+ onboarding proposals; no Obsidian or LLM dependency. |
| `resolver.ts` | Link/title resolution with ambiguity tracking. |
| `lineage.ts` | **Canonical lineage normalization** — one `NEWER→OLDER` edge set from either declared side; validation (cycles, self-ref, unresolved, multi-successor, ordering, duplicates, ambiguity). |
| `temporal.ts` | `valid_at`/`invalid_at`, HEAD derivation, and the **one** point-in-time projector. |
| `graph.ts` | `parseSourceFile` (expensive, cacheable) + `assembleGraph` (cheap) + `buildGraph`. |
| `incremental.ts` | `KosmosIndex`: parse only changed content, rename without reparse, structural-rebuild threshold, graph delta. |
| `graphiti.ts` | Stable-UUID, chronological, non-authoritative Graphiti episodes without future-state leakage. |
| `demo.ts` | Built-in demo vault. |
| `version.ts` | Single version source of truth. |

### `src/renderer/` — the visualization (consumes a Core graph; never re-derives semantics)
`cosmology.ts` classifies nodes into cluster/galaxy/star/planet/moon/moonlet/
asteroid/Oort; `layout.ts` does hierarchical packing + a separation pass + a
collision **diagnostic** pass; `shaders.ts` holds the instanced body/glow
materials; `renderer.ts` is the Three.js scene, camera, interactions, Chrono,
minimap, playback, and the hidden-view render-loop suspension.

### `src/plugin/` — Obsidian host + Agent API
`main.ts` owns the view (an isolated, **sandboxed** iframe running the embed
page) and streams the vault in via the versioned `postMessage` protocol
(`protocol.ts`). `agent-server.ts` is a framework-free HTTP + MCP server
(unit-testable in Node) backed by `vault-provider.ts`, which owns a
`KosmosIndex` so the API answers from the *same* normalized graph the viewer
renders, filtered by the configured OKF+ sensitivity ceiling. `settings.ts`
provides Anthropic, OpenAI, stdio, and vendor-neutral quick-connect configs;
the release's `kosmos-mcp-stdio.mjs` preserves MCP lifecycle headers for
stdio-only harnesses. `okf-migration.ts` hosts the explicit structural
audit/backup/apply modal. `okf-enrichment.ts` builds deterministic and optional
bounded-LLM proposals; `okf-enrichment-apply.ts` keeps the later human review,
hash-bound decision plan, backup, source recheck, and write authority in a
separate step. `okf-blocked-review.ts` is an on-device/private-LAN-only,
advisory boundary for
migration blockers; it shares the bounded JSON request transport in
`okf-llm.ts` but has no route into either writer.

`nextcloud-sync-core.ts` contains DOM-free settings migration, URL/path
validation, exclusions, and the deterministic three-way planner.
`nextcloud-sync.ts` is the Obsidian/WebDAV adapter: it scans local binary files,
enumerates Nextcloud with bounded depth-1 `PROPFIND` requests, applies
conditional transfers, stores common-state metadata, and preserves remote
conflict copies. Credentials remain in Obsidian Secret Storage rather than
plugin data.

### `src/standalone/` — the offline single-file viewer
`directory-source.ts` (persistent picker + snapshot fallback), `persistence.ts`
(IndexedDB handle), `directory-monitor.ts` (rescan-and-diff), `ui.ts` (startup
+ status + errors + exports), `standalone.ts` (entry, owns a `KosmosIndex`).

## Build

`scripts/build.mjs` is the deterministic generator (Doc1 §3.3): modular TS →
esbuild bundle → inlined into single-file HTML with `vendor/three.min.js`.
Outputs: `main.js` (plugin, embeds `dist/kosmos-embed.html` as base64),
`vault-kosmos.html` (standalone), and `dist/*.mjs` node bundles for the CLI and
tests. Executable artifacts are byte-reproducible across clean builds (verified
by a CI job); volatile metadata lives only in `release/BUILD-INFO.json`.

## Read/write boundary

Read-only: visualization, ordinary directory scanning, Agent API, MCP/REST
queries, Chrono, in-memory Graphiti generation, and the initial OKF audit.
Writes happen only through explicit, named, user-triggered commands. The OKF+
migrator has a separate approval boundary: save-audit writes only a content-free
plan; apply requires backup/sensitivity confirmations, writes binary backups,
and edits only sources still identical to the approved hash-bound plan.
The v2.3 validating projection and all REST/MCP assess/validate tools are
in-memory and read-only. They never insert assessment results into notes and
never treat proposed values as effective. The enrichment path adds another boundary: proposals have no write authority,
nothing is preselected, accepted relationship targets must resolve, and only a
reviewer-approved plan can reach the backup/apply modal. Persisted enrichment
plans omit note bodies and each live note is compared byte-for-byte with the
reviewed source before its guarded write.
The separately configured Nextcloud workflow can write local vault files and
the selected remote folder. It is disabled by default, excludes `.obsidian`,
uses conditional WebDAV requests, and defaults deletion propagation off.
Users can opt into `.obsidian` synchronization independently of custom path
globs; the plugin's own `data.json` remains a mandatory exclusion.
