# Kosmos-Oden Lite (Vault Kosmos) — v1.0.0

**A 3D cosmos for your notes, and note formatting that quietly makes them more
useful — to you, and to AI.**

Kosmos-Oden Lite is the final, polished form of the classic **Vault Kosmos**
line: an Obsidian plugin that renders your vault as a navigable "Local Cluster
of Galaxies" — folders become galaxies, notes become stars and planets, links
become the gravity between them — and gives your notes clean, human-editable
frontmatter (the **GKOS-Engine-Lite schema**: OKF+ Notes 2.2 with the optional
Agent-Ready flat 2.3 profile) so both you and your AI tools can find, trust,
and connect what you know.

It is intentionally **Lite**: for people with everyday vaults who want
something simple yet effective — not for governing tens of thousands of
documents. It is feature-complete and maintained for bug fixes. New feature
development continues in the main [Kosmos-Oden](https://github.com/Odenknight/Kosmos-Oden)
project, which builds the full GKOS Engine (governance sidecars, proposal and
decision records, the standalone engine) on the same core.

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
  clean OKF+ 2.2 frontmatter (identity, type, timestamps, tags, lineage and
  relationship wikilinks) — and an optional Agent-Ready flat 2.3 upgrade for
  vaults that work with AI agents. Empty boilerplate is never written.
- Automatic created/updated timestamps (UTC by default, optional local-time
  with explicit offset, configurable keys) — toggleable, disclosed, and safe.
- A read-only local Agent API (REST + MCP) so your AI tools can *read* your
  cosmos without ever being able to write to it.
- The safety architecture underneath everything: no silent writes, previewed
  plans, byte-exact backups, and repair paths instead of regrets.

## Attribution and license

- Original concept and inspiration: **Vault Kosmos** by
  [H4R7W16](https://github.com/H4R7W16/vault-kosmos). The viewer keeps the
  Vault Kosmos name in tribute.
- Rebuild, formatting engine, and Lite edition: **Shaun "Oden" Marshall**
  ([Odenknight](https://github.com/Odenknight)).
- Note-format profiles: **OKF+** (Open Knowledge Format Plus) under the
  **GKOS** (Governed Knowledge Operations Standard) governance model —
  see [gkos-standard](https://github.com/Odenknight/gkos-standard).
- License: [MIT](LICENSE). Documentation and original graphics in the GKOS
  standard are CC BY 4.0 in their own repository.

## Relationship to Kosmos-Oden (main)

| | Kosmos-Oden Lite (this repo) | Kosmos-Oden (main) |
|---|---|---|
| Audience | Everyday vaults, individuals | Governed knowledge work, agentic systems |
| Note formats | OKF+ Notes (2.2) + Agent-Ready flat 2.3 | Same, plus the full GKOS Engine roadmap (sidecars, proposals, decisions, Machine Dialect, standalone engine) |
| Viewer branding | **Vault Kosmos** (tribute) | Kosmos-Oden |
| Future | Bug fixes only — stable by design | Active feature development |

Same engine core under the hood. Notes formatted by one are fully readable by
the other — moving up (or back) is never a migration of your writing.
