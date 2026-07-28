# Versioning and Frozen Core Policy

The canonical versioning policy lives in **gkos-standard**. This file records
only how that policy binds *this* repository. Where the two disagree,
gkos-standard wins.

## Product designation: Frozen Core Edition

Kosmos-Oden Lite is the **Frozen Core Edition** of the Kosmos-Oden line.

This designation means the edition preserves a stable, established core rather
than continuously tracking the newest GKOS Engine release. Its purpose is to
protect existing vault behavior, note compatibility, and a predictable user
experience.

“Frozen Core” does not mean unmaintained or abandoned. It means:

- the product remains supported for bug fixes, security fixes, data-integrity
  repairs, compatibility corrections, and metadata/release hygiene;
- relevant upstream fixes may be selectively backported after review;
- upstream feature additions and new governance semantics are not adopted
  automatically;
- a declared parity or baseline tag describes the vendored source used for
  reconciliation, not a promise that this edition matches the newest engine;
- new capabilities belong in the full Kosmos-Oden product.

Any backport must preserve the edition's established product contract unless it
corrects behavior that was already defective. Compatibility impact must be
recorded in `CHANGELOG.md`.

## This repo is patches-only, 1.0.x, forever

Kosmos-Oden Lite is **feature-complete**. It stays on the `1.0.x` line
indefinitely:

- Only the **patch** component ever moves. No minor, no major.
- Changes must be **bug fixes, security fixes, data-integrity repairs,
  compatibility corrections, or metadata/hygiene**. Nothing merged here may
  change behaviour that a working vault depends on. Behavioural corrections
  are limited to fixing something that was already wrong (e.g. the 1.0.5
  fail-closed sensitivity correction), and must be called out under
  **Compatibility** in `CHANGELOG.md`.
- New capability belongs in the full **Kosmos-Oden** product, not here.

The Obsidian plugin id (`manifest.json` → `"id": "vault-kosmos-oden"`) is
**frozen**. Changing it orphans every existing install; it is not a versioning
decision and is out of scope for any patch.

`src/core/version.ts` (`KOSMOS_VERSION`) is the single source of truth;
`package.json`, `manifest.json` and `versions.json` are asserted against it by
`npm run check:versions`. Tags carry **no `v` prefix** (Obsidian requirement).
See `docs/RELEASE-PROCESS.md` for the release mechanics.

## Vendored core: reviewed backports with allowlisted deltas

`src/core/` is a **vendored copy** of the [GKOS Engine](https://github.com/Odenknight/GKOS-Engine)'s
`src/`. It is not a fork to be independently developed, and it is not expected
to advance automatically with every upstream release.

- The reconciled engine baseline is declared in `package.json` as
  `"engineParity"` (currently `v1.0.7`). Under the Frozen Core policy, this is
  the source baseline used by the drift checker; it does not imply parity with
  the newest GKOS Engine version.
- Engine fixes reach this repo as **reviewed backports**: port the relevant
  upstream change verbatim where practical, do not re-derive or expand it.
- A backport is accepted only when it addresses a bug, security issue,
  data-integrity risk, or material compatibility defect relevant to this
  edition.
- The vendored copy is allowed to diverge from the declared baseline **only** in
  the deltas recorded in `scripts/core-drift-allowlist.json` — product identity
  (`KOSMOS_VERSION`/`KOSMOS_NAME`, the `tool:kosmos-oden` assessor), a widened
  export, approved backports, and documented non-semantic noise. Each entry
  carries a reason and a fingerprint of the normalised diff.
- `npm run check:core-drift` clones the engine at the declared baseline,
  normalises line endings, and **fails on any difference not in the allowlist**.
  This check must be part of both CI and the release `verify` path. Semver
  literals are normalised out of the fingerprints, so a routine version bump
  does not require re-baselining.

Moving the declared baseline forward is optional, not routine. When justified,
it is itself a patch release task: review the intervening engine changes,
backport only the changes compatible with the Frozen Core contract, update
`engineParity` when the vendored tree has actually been reconciled to that
baseline, re-run the checker, and update fingerprints with a recorded reason.

The edition must never claim current-engine parity merely because selected
later fixes have been backported.