# Kosmos Research Studio Lite (KRS-Lite) — Frozen Core Edition (Vault Kosmos) — v1.0.6

**A 3D cosmos for your notes, and note formatting that quietly makes them more
useful — to you, and to AI.**

Kosmos Research Studio Lite (KRS-Lite) is the **Frozen Core Edition** and final, polished form of the
classic **Vault Kosmos** line: an Obsidian plugin that renders your vault as a
navigable "Local Cluster of Galaxies" — folders become galaxies, notes become
stars and planets, links become the gravity between them — and gives your notes
clean, human-editable frontmatter (the **GKOS-Engine-Lite schema**: GKX Notes
2.2 with the optional Agent-Ready flat 2.3 profile) so both you and your AI
tools can find, trust, and connect what you know.

GKX (Governed Knowledge Exchange) is the current name for the format previously published as OKF+.
KRS-Lite keeps reading existing OKF+ 2.2/2.3 notes; the
rename does not require a vault migration.

## What “Frozen Core Edition” means

The core behavior, data model, plugin identity, and user-facing workflow of this
edition are intentionally frozen. It is a stable product line, not a rolling
mirror of the newest GKOS Engine release.

- Existing vault behavior and note compatibility take priority over adopting new
  engine features.
- Maintenance is limited to bug fixes, security fixes, data-integrity repairs,
  compatibility corrections, and release/documentation hygiene.
- Relevant upstream fixes may be selectively backported after review, but a new
  GKOS Engine version is not adopted automatically and current-engine parity is
  not implied.
- New capabilities, new governance semantics, and architectural expansion belong
  in the main [Kosmos-Oden](https://github.com/Odenknight/Kosmos-Oden) project.
- The exact vendored-core baseline and approved differences remain
  machine-checked and documented; see [VERSIONING.md](VERSIONING.md).
- The allowed change classes and excluded work are recorded in the
  [maintenance policy](ROADMAP.md).

“Frozen” does **not** mean abandoned. It means the edition is maintained
conservatively so users can depend on its established behavior without being
forced onto the main product’s faster development track.

This frozen, verified baseline is a controlled compatibility exception, not a
second schema authority. KRS-Lite does not claim current-Engine parity; its
exact baseline, selective data-integrity backports, and approved differences
define the claim that its drift checks enforce.

It is intentionally **Lite**: for people with everyday vaults who want
something simple yet effective — not for governing tens of thousands of
documents. It is feature-complete and maintained under the Frozen Core policy.
New feature development continues in the main
[Kosmos-Oden](https://github.com/Odenknight/Kosmos-Oden) project, which builds
the full GKOS Engine (governance sidecars, proposal and decision records, the
standalone engine) on the same lineage. See [VERSIONING.md](VERSIONING.md) for
what that means in practice: patches-only on the `1.0.x` line, with a declared
vendored-core baseline and reviewed backports rather than automatic parity.

## The originating story

This project began as an act of admiration. **[Vault Kosmos](https://github.com/H4R7W16/vault-kosmos)**
by **H4R7W16** turned an Obsidian vault into a living night sky, and that idea
— that a knowledge base deserves to be *seen*, not just searched — inspired
everything that followed. Kosmos-Oden started as a fork and rebuild of that
work, and this Lite edition deliberately keeps the **Vault Kosmos** name on
the viewer as a mark of respect to the author whose idea started it.

From there it grew in one direction the original never aimed at: making the
notes themselves more trustworthy. A deterministic formatting engine was added
so every note can carry a stable identity, honest timestamps, and clean
lineage/relationship links — flat, readable frontmatter a person can edit in
Obsidian's Properties panel without ever fighting machine syntax. Along the
way the project survived its own hardest test: a pre-release converter once
wrote machine-shaped metadata into human notes, and the safety architecture —
previewed hash-bound writes, byte-exact per-file backups, deterministic
markers — reversed the mistake surgically, without a single vault restore and
without losing a byte of anyone's writing. That story is told in full in
[docs/EVOLUTION-AND-SAFEGUARDS.md](docs/EVOLUTION-AND-SAFEGUARDS.md).

The lesson it taught became the design law of this edition: **the parts humans
care about stay visible and editable; the machinery stays out of the way.**

## What Lite gives you

- The full 3D cosmos: galaxies, stars, planets, moons, search, filters, focus,
  free flight, timeline growth, Chrono time-travel, minimap.
- **GKOS Note Formatting**: one previewed, backed-up action to give notes
  clean GKX 2.2 frontmatter (identity, type, timestamps, tags, lineage and
  relationship wikilinks) — and an optional Agent-Ready flat 2.3 upgrade for
  vaults that work with AI agents. Empty boilerplate is never written.
- Automatic created/updated timestamps (UTC by default, optional local-time
  with explicit offset, configurable keys) — toggleable, disclosed, and safe.
- A read-only local Agent API (REST + MCP) so your AI tools can *read* your
  cosmos without ever being able to write to it. A **Default sensitivity for
  unlabeled notes** setting (fail-closed to `secret`) sits above the enable
  toggle and governs any note without an explicit classification; the engine
  may only raise sensitivity above it, never lower an authored value.
- The safety architecture underneath everything: no silent writes, previewed
  plans, byte-exact backups, and repair paths instead of regrets.

## Attribution and license

- Original concept and inspiration: **Vault Kosmos** by
  [H4R7W16](https://github.com/H4R7W16/vault-kosmos). The viewer keeps the
  Vault Kosmos name in tribute.
- Rebuild, formatting engine, and Lite edition: **Shaun "Oden" Marshall**
  ([Odenknight](https://github.com/Odenknight)).
- Note-format profiles: **GKX** (Governed Knowledge Exchange; formerly OKF+) under the
  **GKOS** (Governed Knowledge Operations Standard) governance model —
  see [gkos-standard](https://github.com/Odenknight/gkos-standard).
- License: [MIT](LICENSE). Documentation and original graphics in the GKOS
  standard are CC BY 4.0 in their own repository.

## Relationship to Kosmos Research Studio (main)

| | KRS-Lite — Frozen Core Edition | KRS (main) |
|---|---|---|
| Audience | Everyday vaults, individuals | Governed knowledge work, agentic systems |
| Note formats | GKX Notes (2.2) + Agent-Ready flat 2.3; reads legacy OKF+ | Same, plus the full GKOS Engine roadmap (sidecars, proposals, decisions, Machine Dialect, standalone engine) |
| Core policy | Frozen baseline; reviewed fixes and selective backports | Active engine and product evolution |
| Viewer branding | **Vault Kosmos** (tribute) | **Kosmos Research Studio (KRS)** |
| Future | Stable `1.0.x` maintenance line; no automatic current-engine parity | Active feature development |

The editions share a common lineage and compatible note formats. Notes formatted
by one remain readable by the other; moving to the main edition does not require
migrating the substance of your writing. Their implementation cores may differ
because the Frozen Core Edition intentionally advances only through reviewed,
compatibility-preserving backports.

## Browser and visual tests in CI

The Chromium renderer specs run on every push against software WebGL2
(ANGLE/SwiftShader) and are a required check. Firefox, WebKit and the
visual-regression baselines need a real GPU, so they run weekly and on demand in
the advisory `Browser (full matrix)` workflow and must be run locally before a
release — see [CONTRIBUTING.md](CONTRIBUTING.md#browser-and-visual-tests).
