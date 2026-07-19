<!-- Summary of the change and why it's needed. -->

## What & why

## Checklist

- [ ] `npm run verify` passes locally (typecheck, build, tests, version/artifact/invariant checks).
- [ ] New behavior has tests; fixed defects have a regression test.
- [ ] Generated artifacts rebuilt and committed (`main.js`, `vault-kosmos.html`, `dist/`), so the reproducibility job matches.
- [ ] Graph semantics live only in `src/core/` (no per-surface forks).
- [ ] Docs updated; README claims still match what the code proves.
- [ ] `kosmos-invariants.yml` still holds (security defaults, read-only API, sandbox, no `"latest"` deps).

## Review-required flags (check any that apply — these need explicit maintainer review)

- [ ] Authentication / `Host` / `Origin` / LAN behavior changed
- [ ] iframe sandbox permission or host↔renderer protocol changed
- [ ] New dependency or notable bundle-size change
- [ ] New network route or any write capability
- [ ] Release-workflow change
