# Versioning

The canonical versioning policy lives in **gkos-standard**. This file records
only how that policy binds *this* repository. Where the two disagree,
gkos-standard wins.

## This repo is patches-only, 1.0.x, forever

Kosmos-Oden Lite is **feature-complete**. It stays on the `1.0.x` line
indefinitely:

- Only the **patch** component ever moves. No minor, no major.
- Changes must be **bug fixes, security fixes, or metadata/hygiene**. Nothing
  merged here may change behaviour that a working vault depends on. Behavioural
  corrections are limited to fixing something that was already wrong (e.g. the
  1.0.5 fail-closed sensitivity correction), and must be called out under
  **Compatibility** in `CHANGELOG.md`.
- New capability belongs in the full **Kosmos-Oden** product, not here.

The Obsidian plugin id (`manifest.json` → `"id": "vault-kosmos-oden"`) is
**frozen**. Changing it orphans every existing install; it is not a versioning
decision and is out of scope for any patch.

`src/core/version.ts` (`KOSMOS_VERSION`) is the single source of truth;
`package.json`, `manifest.json` and `versions.json` are asserted against it by
`npm run check:versions`. Tags carry **no `v` prefix** (Obsidian requirement).
See `docs/RELEASE-PROCESS.md` for the release mechanics.

## Vendored core: backports with allowlisted deltas

`src/core/` is a **vendored copy** of the [GKOS Engine](https://github.com/Odenknight/GKOS-Engine)'s
`src/`. It is not a fork to be developed in.

- The engine parity tag is declared in `package.json` as `"engineParity"`
  (currently `v1.0.7`).
- Engine fixes reach this repo as **backports**: port the upstream change
  verbatim, do not re-derive it.
- The vendored copy is allowed to diverge from the parity tag **only** in the
  deltas recorded in `scripts/core-drift-allowlist.json` — product identity
  (`KOSMOS_VERSION`/`KOSMOS_NAME`, the `tool:kosmos-oden` assessor), a widened
  export, and doc-comment/import-order noise. Each entry carries a reason and a
  fingerprint of the normalised diff.
- `npm run check:core-drift` (CI, `.github/workflows/ci.yml`) clones the engine
  at the parity tag, normalises line endings, and **fails on any difference not
  in the allowlist**. Semver literals are normalised out of the fingerprints, so
  a routine version bump does not require re-baselining.

Moving the parity tag forward is itself a patch: bump `engineParity`, backport
the intervening engine changes, re-run the checker, and update any fingerprints
whose surrounding context genuinely changed — recording *why* in the reason
field.
