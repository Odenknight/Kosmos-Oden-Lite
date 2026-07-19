# Kosmos-Oden (Vault Kosmos) — v0.5.7 (GKOS-Engine-Lite)

**Version 0.5.7 (GKOS-Engine-Lite)** — the final feature update for the 0.5.x line: a stable release with a responsive 3D "Local Cluster of Galaxies" view with human-editable OKF+ 2.2 Obsidian Properties, optional Agent-Ready (flat) OKF+ 2.3 conversion — the GKOS Engine v1.0 implementation line, live MCP agent traversal comet trails, portable UTC note timestamps, an origin-separated Graphiti 0.29 adapter, and native Nextcloud WebDAV sync. It is built on a fork and rebuild of [H4R7W16/vault-kosmos](https://github.com/H4R7W16/vault-kosmos).

Vault Kosmos turns your notes into a night sky you can fly through. Your most important, most-connected notes shine as **stars**; the notes linked to them orbit as **planets** and **moons**; stray notes drift by as **asteroids**; each top-level folder becomes its own **galaxy**. Images, PDFs and other attachments float in a faint outer shell (the **Oort cloud**), just like the icy debris at the edge of a real solar system.

The visualization changes nothing — Kosmos only *looks* at your notes. Close the view and your vault is exactly as you left it. Rendering runs locally, and a single `.html` file can render your notes without Obsidian at all. Separate OKF+ write workflows and optional Nextcloud sync are explicit, disabled-by-default features described below.

## Two ways to use it

| | |
|---|---|
| **Inside Obsidian** | Install the plugin — desktop and mobile, live-updating as you edit. See [Obsidian plugin](#obsidian-plugin). |
| **Standalone, no Obsidian** | Download one file, `vault-kosmos.html`, and open it in a browser. No install, no server, no internet. See [Standalone — no Obsidian required](#standalone--no-obsidian-required). |

Both surfaces — plus the Agent API and the `kosmos-build` CLI — render **the same vault the same way**, because they all share one engine (more on that below).

## Attribution & lineage

**What comes from [H4R7W16/vault-kosmos](https://github.com/H4R7W16/vault-kosmos) (original):** the basic Three.js rendering framework and the foundational spatial metaphor — notes as celestial bodies.

**What OdenKnight's Obsidian adaptation (v0.5.0–v0.5.1) added:** a complete visualization redesign with accurate folder/file hierarchy mapping; gravitational orbital mechanics (notes orbit gravitational focal points by connection strength); Saturn-style rings for well-connected notes; a folder-safe context menu (right-clicking a folder galaxy expands it in Obsidian's file explorer — it never opens or creates a note); a live agent-traversal trail; the Agent API with MCP support; Graphiti episode export; render-loop suspension and other performance work; and early security hardening (constant-time token comparison, DNS-rebinding protection).

**What Kosmos-Oden adds:** a single shared **Kosmos Core** so the plugin, the standalone viewer, the Agent API and the CLI compute identical graphs instead of drifting into separate interpretations; canonical bidirectional lineage normalization with validation; a genuinely offline single-file standalone viewer with folder monitoring; and a full build-provenance / reproducibility / security-hardening pass (see [Security, assurance & governance](#security-assurance--governance)). The 0.6 beta upgrades the renderer to exact-pinned Three.js r185/WebGL2 while retaining the offline single-file model.

Both projects use the MIT License — see [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The original code remains attributed to H4R7W16; new contributions are attributed to OdenKnight.

## Why would I want it?

A folder list shows you your notes one at a time. A cosmos shows you **the shape of everything you know, all at once**:

- **See what matters.** Big, bright bodies are your hub notes — the ideas everything else connects to. A lonely asteroid tells you something needs linking up (or that it's fine on its own).
- **Spot the clusters.** Related notes physically gather together, so themes and projects become visible neighborhoods instead of scattered filenames.
- **Travel through time.** Press one button and watch your vault grow note by note, or scrub the Chrono timeline to see exactly what you knew — and what you'd already revised — on any past date.
- **Find things by flying.** Tap any body to light up everything connected to it, then hop from neighbor to neighbor. It's search for people who think visually.
- **Watch your AI assistant think.** If you let an AI agent read your vault (entirely optional, off by default), the notes it visits glow with a fading emerald trail across your universe, live.
- **Improve OKF+ metadata without surrendering control.** A deterministic pass selects bounded evidence and explains weak document structure; an optional constrained local/cloud model can add pending proposals. Nothing is preselected, and only explicitly reviewed values can enter a hash-bound, backed-up apply plan. See [OKF+ content-assisted enrichment](docs/OKF-ENRICHMENT.md).

It works on desktop **and** on your phone or tablet, updates live as you edit, and needs no internet connection at all.

---

## Under the hood: one semantic engine

Kosmos-Oden is three products sharing **one semantic engine** — the Kosmos Core. This is the single most important design decision in the v0.5.5 rebuild: without it, the plugin, the standalone page, the Agent API and the CLI would gradually drift into five different interpretations of the same vault.

```
                    ┌─────────────────────┐
                    │  Kosmos Core Graph  │
                    │ parsing · resolution│
                    │ canonical lineage   │
                    │ temporal projection │
                    │ graph construction  │
                    │ Graphiti export     │
                    └──────────┬──────────┘
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      Obsidian plugin   Standalone HTML    Agent API layer
      live vault events directory picker   REST + MCP
      incremental sync  rescan + diff      graph queries
      3D renderer       3D renderer        Graphiti episodes
```

The same vault produces materially the same nodes, links, lineage, HEAD status, temporal state and Graphiti episode structure whether you access it through Obsidian, `vault-kosmos.html`, `kosmos-build.mjs`, the REST Agent API, or MCP.

## How your vault becomes a cosmos

| You have… | You see… |
|---|---|
| A home/index note in your vault root | The **cluster core** — the bright heart of the whole universe, the gravitational focal point. |
| A top-level folder | A **galaxy**. If the folder has a manifest note (`index`/`README`/`MOC`/a note matching the folder's name), that note becomes the bright galactic center; otherwise the folder itself does. |
| A well-connected note | A **star** with its own solar system — its spectral class and size read the weight of that system (see below). |
| Notes linked from that note | **Planets**, **moons** and **moonlets**, chained by how closely they're related. Each planet gets a NASA exoplanet type from its own note (see below). |
| Loose or barely-linked notes | **Asteroids**, tumbling near the galaxy they're gravitationally bound to. |
| Images, PDFs, other attachments | The **Oort cloud** — a faint outer shell around the system that references them. |

Moons carry dark maria patches and bright ejecta flecks; asteroids are irregular tumbling rocks with varied mineral coloring — all of it runs inside the existing shader passes (mobile keeps its dedicated lightweight path), so nothing got slower. The layout uses hierarchical packing and collision-resolution passes designed to keep bodies separated and minimize overlap; a diagnostic pass counts any residual intersections and reports them honestly rather than promising a mathematically perfect zero (they're rare — see [benchmarks/RESULTS.md](benchmarks/RESULTS.md)).

### Stars follow the Hertzsprung–Russell main sequence

A star's brightness, color and size read the **weight of its solar system** — how many notes it gathers, how many distinct subfolders they span, and their total byte size. Heavier systems sit further up the [H-R main sequence](https://en.wikipedia.org/wiki/Hertzsprung%E2%80%93Russell_diagram): hotter, bluer and larger. A tiny system is a cool red **M** dwarf (like Proxima Centauri); a Sun-sized hub is a yellow **G**; a sprawling, deeply-foldered hub climbs through **F · A · B** to a hot blue **O** giant. The scale is relative to your own vault's heaviest system, with a floor so a two-note folder never mints a blue giant. Select a star and the inspector names its class (e.g. *Class G Star*).

| Class | Color | You have… |
|---|---|---|
| **M** | red | a small, shallow system |
| **K** | orange | a modest system |
| **G** | yellow (the Sun) | a mid-sized, Sun-like hub |
| **F · A** | white | a large, multi-folder system |
| **B · O** | blue | your biggest, deepest, heaviest hubs |

### Planets are typed like NASA's exoplanets

Each planet's appearance is a [NASA exoplanet type](https://science.nasa.gov/exoplanets/planet-types/) chosen from the note itself — its child notes (moons), the attachments it hosts, and its size:

| Type | You have… | Looks like |
|---|---|---|
| **Gas giant** | a note with 4+ descendant notes | banded Jupiter/Saturn tones, with rings |
| **Neptunian** (ice giant) | a note with 2–3 descendants | smooth, cold, blue/cyan haze (Neptune/Uranus) |
| **Super-Earth** | one descendant, or a hefty note (>24 KB) | amplified continental relief |
| **Terrestrial** | a leaf note | Mercury/Venus/Earth/Mars — rocky, land/sea + ice caps |

Hosting attachments biases a planet toward its watery variety (an Earth-like water world, a super-Earth ocean, or Neptune). Rings appear on gas giants only. Select a planet and the inspector names its type.

---

## Standalone — no Obsidian required

`vault-kosmos.html` is one self-contained file: Three.js, the parser, the graph engine and the renderer are all inlined. No Obsidian, no Node.js, no Python, no local server, no internet connection — copy it to any folder and open it in a browser.

1. Download **`vault-kosmos.html`** (or copy it anywhere — any folder works).
2. Open it in a modern browser (double-click).
3. Click **Open Knowledge Folder**.
4. Select the root of your Markdown or Obsidian vault.
5. Kosmos recursively scans and renders the folder — `.obsidian`, `.git`, `node_modules` are skipped, notes are read, attachments become Oort objects.
6. Where the browser grants persistent directory access, Kosmos **monitors the folder** while the page is open: new notes appear, deleted notes disappear, and a new top-level folder becomes a new galaxy after the next rescan (visibility/focus triggers, a low-frequency poll, or **Rescan Now**).

**Two access modes, clearly labelled in the status panel:**

- **Persistent folder access** (Chromium browsers — Chrome, Edge, Brave): uses `showDirectoryPicker()`. The page can re-scan the folder while it stays open, and can remember the folder (IndexedDB handle) for **Reopen Last Folder** — the browser re-asks permission before any access. **Forget Folder** removes the stored handle.
- **Imported folder snapshot** (all browsers, including Firefox/Safari and `file://` pages where the picker is restricted): a one-time import via the standard directory input. Everything renders identically, but there is **no live monitoring** — the page never implies otherwise.

The standalone scanner is **read-only**: it never renames, deletes, modifies, rewrites, normalizes, moves or patches your files. Exports (**Export Graph JSON**, **Export Graphiti Episodes**) are generated in memory and downloaded through the browser — no filesystem write access is requested. Makes no network calls, collects nothing, works fully offline.

---

## Obsidian plugin

Renders inside Obsidian (desktop **and** mobile) in an isolated, sandboxed view.

1. Copy `manifest.json`, `main.js`, `styles.css`, and `kosmos-mcp-stdio.mjs` into `<your-vault>/.obsidian/plugins/vault-kosmos/` (the adapter is required only for stdio-only agent clients).
2. Settings → **Community plugins** → turn off Restricted mode if it's on, then enable **Vault Kosmos**.
3. Click the orbit icon in the left ribbon (or run **Open Vault Kosmos** from the command palette). That's it — your universe builds itself.

The Options page has four responsive tabs: **Agent API (HTTP + MCP)**, **GKOS Note Formatting**, **Quick Connect MCP**, and **Connectivity to Sync Vault**. Each tab keeps its own long-form settings in the normal scroll area; on phones, the tab strip scrolls horizontally and controls stack to full width.

**Live refresh** is incremental and scales with vault size: a single edited note is re-read and re-parsed alone (verified by tests); a full re-read happens only on large structural changes (bulk import/delete/rename, more than `max(500, 25%)` of the vault). Refresh is debounced and paused while the view is hidden.

**Battery-friendly:** the 3D view fully stops rendering the moment its tab is hidden or Obsidian is minimized — the plugin tells the iframe about leaf visibility, so even a background Kosmos tab inside a visible Obsidian window costs ~zero CPU/GPU — and resumes instantly when you come back. Idle bookkeeping (highlight halos, GPU uploads, label scans) is skipped when nothing is selected or pulsing.

## Connectivity to Sync Vault — Nextcloud WebDAV (optional)

Kosmos-Oden can sync the Obsidian vault directly to a Nextcloud Files folder
through Nextcloud's WebDAV endpoint. This backend was written for Kosmos-Oden;
it does not include or depend on code from Remotely Save.

1. In Nextcloud, open **Personal settings → Security** and create an app
   password for this device.
2. In Obsidian, open **Settings → Vault Kosmos → Connectivity to Sync Vault**.
3. Enter the instance address (for example `https://cloud.example.com`), your
   username, app password, and a remote vault-folder name.
4. Select **Test connection**, then **Sync now**. Enable startup or scheduled
   sync only after the first run looks correct on both sides.

The app password is stored through Obsidian Secret Storage, never in plugin
`data.json`. Every file is compared against the last common local SHA-256 and
remote ETag. If both changed, the Nextcloud version is first saved locally as
`name.nextcloud-conflict-<timestamp>.ext`, then the local original becomes the
common version on both sides. Deletion
propagation is off by default; changed-versus-deleted cases always remain
conflicts. `.obsidian/**`, `.git/**`, and `.trash/**` are excluded by default.
The settings page exposes a dedicated `.obsidian` toggle plus per-path globs,
so configuration files can be included selectively. Kosmos-Oden's own
`.obsidian/plugins/vault-kosmos/data.json` always remains excluded because it
contains device-local sync state and Agent API credentials.

HTTPS is required for public hostnames. Plain HTTP is accepted only for a
literal private or loopback address. The beta performs full remote metadata
enumeration and local hashing on each run, favoring correctness over speed.

## Flying around

- **Drag** to orbit · **scroll / pinch** to zoom · **right-drag / two-finger** to pan.
- **Tap a body** to focus it — everything connected to it lights up.
- **Right-click** (long-press on iPhone/iPad) a body → **Go to Note** opens that note in a new tab. Right-clicking a **galaxy that is only a folder** (no manifest note) offers **Expand Folder** instead — it reveals and expands that folder in Obsidian's file explorer. It will never create or open a stray note for a folder.
- **Labels** `R` · **All links** `C` · **All objects** `O` · **Chrono** `H` · **Grow** `G` · **Trailer** · **Key** (show/hide minimap and constellation legend). Timeline remains available through `T` and the renderer API, but its toolbar button is intentionally hidden.
- **Modes:** Overview `A` · Focus `S` · Depth `D` · Fly `F` (WASD + mouse; touch pads on mobile) · Clear `Q`.
- Zoom out as far as you like — once the whole cluster shrinks to ~10% of the screen it gently re-centers itself.
- Mobile: adaptive pixel-ratio and geometry LOD keep the view smooth.

---

## OKF+ v2.3 Validating Projection Profile

Kosmos-Oden implements the **OKF+ v2.3 Validating Projection Profile**. It is
not a full GKOS governance engine and does not authorize or apply consequential
semantic changes. Canonical 2.3 nested blocks are parsed into separate
`authored`, `derived`, `proposed`, `approved`, and `effective` projections;
legacy and 2.2 notes remain readable through compatibility projections. The
built-in deterministic assessment measures documentation, traceability, and
support quality under a versioned policy—it is never a truth score or use
authorization. See [the profile and limits](docs/OKF-PLUS-2.3-PROFILE.md).

Notes written in **OKF+** (Open Knowledge Format Plus) light up temporal features natively:

- **Canonical knowledge chains** — `supersedes` / `superseded_by` frontmatter is normalized internally into one canonical lineage graph, so both fields are projected bidirectionally: declaring **either side** is enough. Superseded notes render as ghosts; the newest version of a chain is flagged **HEAD**. Malformed lineage (cycles, self-references, unresolved targets, multiple successors, out-of-order timestamps) is detected and reported through diagnostics instead of silently breaking the graph.
- **Temporal validity intervals** — each note is *valid* from its OKF+ `timestamp` (fallback: file creation/modification time) and becomes *invalid* the moment its earliest successor's validity begins. This supports point-in-time reconstruction from retained timestamps and supersession history; it does **not** reconstruct edits that were overwritten in place — that history no longer exists in the files.
- **Chrono time-travel** — the **Chrono** button (`H`) scrubs the cosmos to any moment: notes not yet written vanish, notes already superseded dim to dark ghosts. Chrono, the Agent API's `graph_at_time`, and the temporal tests all use the **same** projector.
- **OKF+ 2.3 validating projection** — canonical nested identity, authorship,
  epistemic, sensitivity, provenance, evidence, relationships, lineage, review,
  assessment, authorization, and origin-separated labels are parsed without
  changing source notes. Flat 2.2 metadata and the legacy `**Related:**` footer
  remain available through compatibility mode. Flat Obsidian relationship
  Properties are also read as authored corrections and update incrementally.
- **Human-editable labels** — source Markdown `tags` are the simple,
  user-selectable Obsidian label surface used by the cosmos, lexical search,
  REST, MCP, and Graphiti projection. Advanced governed `labels` remain a
  separate read projection and are never silently promoted from tags.
- **Sensitivity-aware agent reads** — the Agent API defaults to an `internal` ceiling. `confidential` and `phi` notes are excluded from search, note reads, graph/lineage traversal, diagnostics, and Graphiti pages unless the user explicitly raises the ceiling.
- The viewer is read-only: it never patches your notes.

---

## OKF+ note formatting and compatibility onboarding

Use **Settings → Vault Kosmos → GKOS Note Formatting**, or run the corresponding command-palette audit/upgrade action.

The governed writer uses compact **OKF+ 2.2** frontmatter as the default human authoring format. Tags and relationship wikilinks stay in ordinary Obsidian Properties, so a human correction flows through the viewer, graph, search, REST, MCP, and Graphiti projection on the next vault update. Native authored 2.3 notes remain readable and unchanged. If you want authored nested 2.3 metadata, use **Convert all to native 2.3**; the conversion preserves editable Obsidian tag and wikilink relationship overlays.

Beta.11 also includes a bounded remediation for the beta.10 regression. The safe scan recognizes only notes carrying beta.10's deterministic-migration marker, previews a flattening repair, removes duplicate `created_at`/`updated_at` keys and generated governance boilerplate, preserves extensions and Markdown body bytes, and restores flat tags and relationship wikilinks. It does not automatically flatten genuinely authored native 2.3 notes.

Nothing changes during the scan. The preview shows counts, paths, reasons, and a SHA-256 plan hash. You can save the content-free audit alone, or confirm an independent backup and apply the exact plan. Apply writes a byte-exact pre-change copy under `.okf/backup/<run-id>/`, stores the audit/result under `.okf/migrations/<run-id>/`, uses Obsidian's atomic note processor, and preserves each human-authored Markdown body byte-for-byte. Cloud sync is not treated as a backup.

The migration scan is deterministic and contacts no model. The separate **Re-scan editable OKF+ notes** workflow proposes user-reviewable tags, descriptions, types, and evidenced relationships through deterministic selection or an explicitly configured OpenAI-compatible endpoint. Nothing is selected by default; accepted flat Properties use the same live incremental update path as a manual Obsidian edit. See [the migration guide](docs/OKF-MIGRATION.md) and [v2.3 profile](docs/OKF-PLUS-2.3-PROFILE.md).

---

## Agent API — let agents query this vault (HTTP + MCP)

Settings → **Vault Kosmos → Agent API (HTTP + MCP)** → toggle **Enable local Agent API**.

**Connecting an agent (no reimplementation required):**
1. Open **Quick Connect MCP**, then copy the entry for **Anthropic Claude Code**, **OpenAI Codex app / CLI / IDE**, **Claude Desktop / stdio**, or a universal MCP client.
2. Paste the copied configuration into that product.

That's it — the address and access token are filled in automatically, so there's nothing to type or get wrong. Want a reference for later? Run **"Write Agent API guide"** from the command palette and the plugin drops a ready-to-read `AGENT-API.md` into your vault with your connection details already filled in. Full guide: [AGENT-API.md](AGENT-API.md).

**Watch it work:** note-specific MCP/HTTP queries are mirrored live in the Kosmos view. Visited notes pulse with per-agent halos and connect into a fading breadcrumb with a glowing comet tail, rocket head, and residual snow-dust. Trails retain roughly 24 hops for 30 seconds; whole-vault exports and diagnostics do not invent traversal events.

**Technical:** a read-only server starts on `127.0.0.1` (opt into **Local network (LAN/VLAN)** in the same settings to let agents on other devices on your subnet reach it) exposing `vault_overview`, `search_notes`, `get_note`, `get_lineage`, `get_related`, `graph_at_time`, and paginated `export_graphiti_episodes` over the current MCP Streamable HTTP transport (`2025-11-25`, with compatible earlier revisions) plus REST mirrors. The release also includes a first-party stdio adapter for clients that cannot connect to HTTP directly.

Security: tokens are generated from a cryptographically secure RNG only (32 bytes, base64url — token creation fails loudly rather than falling back to a weak source) and compared in constant time; `Host`/`Origin` headers are validated to block DNS-rebinding and cross-site requests; request bodies are capped at 4 MiB (measured in **bytes**); non-loopback clients are rate-limited with a concurrency cap; note bodies, search results and episode pages are capped; every response sets `Cache-Control: no-store`. MCP sessions and post-initialization protocol headers are validated, unknown/expired sessions return 404, JSON-RPC envelopes/tool inputs are checked, and tool declarations are marked read-only/idempotent. `?token=` query authentication is deprecated and off by default. **LAN mode refuses to start without a token.** Desktop only (Obsidian mobile has no local server support).

---

## Graphiti export

The built-in agent functionality is formally named the **Kosmos Governed Context Projection (KGCP)**. KGCP is deterministic and works without Graphiti. Graphiti is an optional semantic-memory and hybrid-retrieval adapter; its inferred facts remain derived proposals, never authored OKF+ data.

Export readable source assertions as [getzep/graphiti](https://github.com/getzep/graphiti)-ingestable JSON episodes. Every episode has a stable UUID (the OKF+ `uid` when valid, otherwise a deterministic fallback), a collision-resistant per-vault assertion namespace, a reference time, separate source tags and origin-preserving governance labels. Episodes are chronological and carry only forward lineage (`resolved_supersedes` / `declared_supersedes`): later `superseded_by`, `head`, and `invalid_at` projection state is never backfilled into an earlier event. Content is capped to stay within Graphiti's LLM context. Graphiti remains a disposable projection; its LLM pipeline may infer entities differently from Kosmos and does not become the OKF+ authority.

The OKF+ 2.3 adapter also exports origin-separated governance, effective sensitivity, assessment summaries, diagnostic codes, evidence/contradictions, policy and schema hashes, filter metadata, authored `fact_triple` relationships, event/processing time, a 250-character derived-attribute cap, and optional saga hints. The generated ingestion script pins tested `graphiti-core==0.29.0`, prefers FalkorDB for local use or Neo4j for mature deployments, and reports readiness/benchmark fields honestly.

## Portable UTC note timestamps

With **Stamp note creation and modification times** enabled (the default), the Obsidian plugin adds `created_at` and `updated_at` frontmatter values in canonical ISO-8601 UTC/Zulu form, for example `2026-07-18T16:42:03.125Z`. Existing `created_at` values are preserved. `.obsidian/` and `.okf/` internals are excluded.

- **Plugin:** command palette → *Export Graphiti episodes (OKF+)* → writes `graphiti-episodes.json` + `graphiti-ingest-sample.py` to the vault root.
- **Standalone:** the **Export Graphiti Episodes** button downloads the same payload.
- **CLI:** `node kosmos-build.mjs /path/to/vault graph.json --episodes graphiti-episodes.json`

Then: `pip install "graphiti-core==0.29.0"` (Python 3.10+), configure FalkorDB for straightforward local operation or Neo4j for a mature deployment, set the required model/provider variables, and run `python graphiti-ingest-sample.py`.

## kosmos-build CLI

```bash
node kosmos-build.mjs /path/to/vault graph.json
node kosmos-build.mjs /path/to/vault graph.json --episodes graphiti-episodes.json
node kosmos-build.mjs /path/to/vault graph.json --episodes graphiti-episodes.json --group-id my-stable-vault
node kosmos-build.mjs /path/to/vault graph.json --watch     # rebuild on change (Node)
```

Uses the same bundled Kosmos Core as the plugin and the standalone page — not a separate implementation. A `graph.json` placed next to `vault-kosmos.html` is auto-loaded when the page is served over http(s).

## What writes what (read-only guarantees)

**Never modify existing notes:** the 3D visualization, ordinary directory scanning, the Agent API, MCP/REST queries, Chrono projection, and in-memory Graphiti episode generation.

**Write only through explicit or configured workflows:** *Mark notes in OKF+ format* performs a read-only audit first and can save `.okf/migrations/<run-id>/plan.json`; only the separately confirmed apply step backs up and edits the listed notes. *Write Agent API guide* creates `AGENT-API.md`; *Export Graphiti episodes* creates `graphiti-episodes.json` + `graphiti-ingest-sample.py`; `kosmos-build.mjs` creates `graph.json` (+ episodes file). Nextcloud writes run only through **Sync now** or explicitly enabled startup/scheduled sync, guarded by common-state comparison and conditional requests. Visualization and Agent API queries remain read-only.

## Private by design

Visualization, the standalone viewer, and the Agent API run locally and collect nothing. The standalone viewer remains fully offline. Optional Nextcloud sync is disabled by default and contacts only the configured server; optional model enrichment contacts only its configured endpoint. The Agent API is off by default, reachable only from your own computer unless you explicitly say otherwise, and is read-only.

---

## Build from source

```bash
nvm use                  # Node 22 (see .nvmrc); engines pinned in package.json
npm ci                   # clean install from the committed package-lock.json
npm run typecheck        # tsc --noEmit
npm run build            # plugin main.js + embed page + vault-kosmos.html + node bundles
npm run build:standalone # just vault-kosmos.html
npm test                 # 165 unit/API/artifact/classification/sync tests (node --test)
npm run verify           # typecheck + build + test + version/artifact/invariant checks
npm run bench            # reproducible synthetic-vault benchmarks
```

A clean checkout builds and tests with exactly these commands — no manually generated files required. Toolchain and dependencies are pinned (no `"latest"`), so repeated clean builds produce the **same** executable artifacts; a CI job proves it by building twice and diffing the hashes. CI (GitHub Actions, minimal `contents: read` permissions) runs typecheck, both builds, the test suite, version-synchronization, artifact self-containment, and the `kosmos-invariants.yml` policy on every push and pull request. Releases are built **from the tag** with `SHA256SUMS` + `BUILD-INFO.json` provenance and are gated on the full pipeline.

Performance: see [benchmarks/RESULTS.md](benchmarks/RESULTS.md) for measured numbers (100 → 50,000 notes) — no claims beyond what the benchmark reproduces.

## Security, assurance & governance

- [SECURITY.md](SECURITY.md) — reporting, and the enforced security invariants.
- [kosmos-invariants.yml](kosmos-invariants.yml) — machine-readable policy, checked in CI.
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/RENDERER-PROTOCOL.md](docs/RENDERER-PROTOCOL.md) (incl. the iframe sandbox experiment) · [docs/RELEASE-PROCESS.md](docs/RELEASE-PROCESS.md).
- [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- The upstream engineering assessments this build was hardened against live in [docs/assessments/](docs/assessments/).

## Repository layout

```
src/core/        shared Kosmos Core (types, markdown, okf, resolver, lineage,
                 temporal, graph, graphiti, incremental index, demo)
src/renderer/    cosmology, layout (+collision diagnostics), shaders, renderer
src/plugin/      Obsidian plugin, iframe embed entry, host<->renderer protocol,
                 Agent API server, settings
src/standalone/  directory source, rescan monitor, handle persistence, UI, entry
scripts/         build pipeline, version/artifact/invariant/renderer-provenance
                 checks, release packaging, static test server
test/            parser, resolver, lineage, temporal, incremental, graphiti,
                 agent-api, protocol, cosmology, standalone-artifact tests;
                 test/browser/ Playwright renderer + visual specs
benchmarks/      synthetic-vault benchmark + measured results
vendor/legacy/   frozen Three.js r128 global build (MIT), for an optional
                 WebGL1-era compatibility artifact only
```

> **Renderer:** the stable 3D engine is **Three.js r185** (`three@0.185.1`),
> an exact-pinned ESM dependency bundled into the offline single-file artifacts
> (no CDN). On the `renderer/three-r185-webgl` branch this replaced the vendored
> r128 global build; it is **WebGL2-only** and provenance-checked in CI. See
> [docs/RENDERER-MIGRATION-r185.md](docs/RENDERER-MIGRATION-r185.md) and
> [renderer-provenance.json](renderer-provenance.json). WebGPU/TSL is a separate
> future phase.

## License

MIT — see [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
