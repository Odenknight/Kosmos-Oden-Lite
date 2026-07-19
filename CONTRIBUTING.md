# Contributing to Kosmos-Oden

Thanks for your interest. This is a small, single-maintainer project with a
deliberately strong assurance pipeline — please work with it rather than around
it.

## Setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm ci             # clean install from the committed lockfile
npm run verify     # typecheck + build + test + version/artifact/invariant checks
```

## The golden rule

> There is **one** graph-semantics implementation: `src/core/`. The plugin,
> standalone viewer, Agent API, Graphiti exporter and CLI all consume it. Never
> fork parsing, resolution, lineage, temporal or graph logic into a surface.

## Before opening a PR

- `npm run verify` passes locally.
- New behavior has tests; fixed defects get a regression test.
- Security-relevant changes keep `npm run check:invariants` green (see
  `kosmos-invariants.yml`).
- Generated/build artifacts (`main.js`, `vault-kosmos.html`, `dist/`) are **not
  committed** — CI rebuilds them from source on every push and attaches them to
  tagged releases. Run `npm run build` locally to produce a working `main.js`
  for manual testing; don't commit it.
- Docs updated when behavior or claims change; the README must not claim more
  than the code proves.
- Version changes touch `src/core/version.ts` (the single source) — the other
  files are checked against it by `npm run check:versions`.

## Changes that require explicit review (Doc2 §9)

- New network route, or any write capability (must not exist without an
  architectural decision + threat-model update).
- New dependency, or a substantial bundle-size change.
- Any change to authentication, `Host`/`Origin` validation, or LAN behavior.
- Any change to iframe sandbox permissions or the host↔renderer protocol.
- Release-workflow changes.

## Commit / PR conventions

- Keep commits focused; describe the "why".
- The PR template lists the checklist reviewers (human or agent) will verify.
