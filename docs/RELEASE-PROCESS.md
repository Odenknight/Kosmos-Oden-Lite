# Release Process

Releases are built **from the tag in CI**, not copied from a workstation
(Doc1 §3.9, Doc2 §3). A release is the verified output of a controlled build.

## Cutting a release

1. Update `src/core/version.ts` to the new version (single source of truth).
2. `npm run check:versions` — confirms `package.json`, `manifest.json`,
   `versions.json` and `src/core/version.ts` agree.
3. Update `CHANGELOG.md` (move `[Unreleased]` items under the new version).
4. `npm run verify` locally to confirm the tree is release-ready. `main.js`,
   `vault-kosmos.html`, and `dist/` are generated and **gitignored** — do not
   commit them; CI builds them fresh from source.
5. Commit the version/changelog changes, then tag with the **exact manifest
   version, no `v` prefix** (Obsidian requirement — see
   `docs/COMMUNITY-PLUGIN.md`): `git tag X.Y.Z && git push origin X.Y.Z`.
   Pre-releases use a semver suffix, e.g. `git tag X.Y.Z-beta.1`.

## What CI does on a version tag (`.github/workflows/release.yml`)

1. `npm ci` (clean, from lockfile).
2. `npm run verify` — typecheck + build + tests + version/artifact/invariant checks.
3. Assert the tag matches `manifest.json`.
4. `npm run package:release` — stages `release/` with `manifest.json`, `main.js`,
   `styles.css`, `versions.json`, `vault-kosmos.html`, `kosmos-mcp-stdio.mjs`, plus:
   - `BUILD-INFO.json` — provenance: commit, tag, workflow, run id, Node version,
     lockfile SHA-256, dirty flag, build time.
   - `SHA256SUMS` — integrity hashes over every release file.
5. `sha256sum -c SHA256SUMS` — verify the staged checksums.
6. Publish a GitHub release with `release/*` attached and generated notes.

`GITHUB_TOKEN` permission for the release job is `contents: write`; CI
validation runs with `contents: read`.

## Independent verification (any user or agent)

```bash
# Rebuild the tagged commit and compare to the published artifacts
git checkout X.Y.Z
npm ci
npm run build
sha256sum main.js vault-kosmos.html        # compare against the release SHA256SUMS
jq . BUILD-INFO.json                        # confirm commit/tag match the tag you built
```

Executable artifacts (`main.js`, `vault-kosmos.html`, `dist/kosmos-embed.html`)
are byte-reproducible across clean builds — CI's `reproducibility` job builds
twice and diffs the hashes. Only `BUILD-INFO.json`'s `buildTimeUtc` is expected
to vary between builds; it is release metadata and is never embedded in the
executable artifacts.
