# Obsidian Community Plugin — packaging, releases & submission

How Kosmos-Oden is packaged so the **Obsidian plugin** and the **standalone
viewer** stay cleanly separated, and how to publish and submit it.

## Plugin components vs standalone (the separation)

| Kind | Files | Where it lives | How a user gets it |
|---|---|---|---|
| **Plugin** | `manifest.json`, `styles.css`, `versions.json` (committed) + `main.js` (build output, gitignored) | source at repo root; all four attached to each release | Obsidian **Community plugins** browser / BRAT — Obsidian downloads only these files from the release |
| **Standalone** | `vault-kosmos.html` (one self-contained file) | **not** committed (build output); attached to each release as its own asset | download the single file from the **Releases** page and open it in a browser |

The standalone is **never** part of the plugin download — Obsidian only fetches
`manifest.json` / `main.js` / `styles.css`. `vault-kosmos.html` is a separate,
independently downloadable asset on the same release. Build outputs
(`main.js`, `vault-kosmos.html`, `dist/`) are gitignored so the tracked tree
shows only source + `manifest.json`/`styles.css`/`versions.json`; CI rebuilds
`main.js` fresh on every push and attaches it to tagged releases.

## Cutting a release

Releases are produced by CI (`.github/workflows/release.yml`) on a version tag.
**The tag must equal `manifest.json`'s `version` exactly, with no `v` prefix**
(Obsidian requirement):

```bash
# 1. bump the version in ONE place; check:versions enforces agreement across
#    manifest.json / versions.json / package.json / src/core/version.ts
# 2. commit, then tag with the exact version — NO leading v:
git tag 0.5.6
git push origin 0.5.6           # → release.yml runs verify, builds, publishes
```

Pre-releases use a semver suffix and are auto-marked as GitHub pre-releases
(Obsidian ignores them for the community listing): `git tag 0.6.0-beta.1`.

The workflow runs `npm run verify`, checks the tag matches the manifest,
assembles `release/` via `npm run package:release` (plugin files + standalone +
`BUILD-INFO.json` + `SHA256SUMS`), verifies checksums, and creates the release
with each file as an individual asset.

> Legacy `v*` tags still trigger the workflow, but new releases should use the
> unprefixed form so they're valid for the community listing.

## First-time submission to the community catalog

One-time PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
adding an entry to `community-plugins.json`:

```json
{
  "id": "vault-kosmos",
  "name": "Vault Kosmos (Kosmos-Oden)",
  "author": "OdenKnight",
  "description": "A 3D constellation view of your notes …",
  "repo": "Odenknight/Kosmos-Oden"
}
```

Pre-flight checklist (Obsidian bot + reviewers check these):
- [ ] `manifest.json` at repo root with `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly`. ✔ (current)
- [ ] `id` is unique, lowercase-hyphen, no "obsidian"/"plugin". ✔ `vault-kosmos`
- [ ] `name` does not contain "Obsidian". ✔
- [ ] A GitHub **release whose tag == manifest version, no `v` prefix**, with `manifest.json`, `main.js`, `styles.css` as individual assets. ← use the flow above (the only prior tag, `v0.5.1`, is prefixed and pre-dates this policy).
- [ ] `versions.json` maps plugin version → minAppVersion. ✔
- [ ] `README.md` describes the plugin. ✔
- [ ] `LICENSE` present. ✔

After the PR merges, the plugin appears in **Settings → Community plugins →
Browse**. Subsequent releases are picked up automatically from new tags.

## Testing before submission

- **BRAT** (Beta Reviewers Auto-update Tool): add `Odenknight/Kosmos-Oden` to
  install directly from releases, including `0.6.0-beta.*` pre-releases for the
  r185 renderer line.
- **Manual**: copy `manifest.json` + `main.js` + `styles.css` into
  `<vault>/.obsidian/plugins/vault-kosmos/` and enable it.
