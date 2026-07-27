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

## Browser and visual tests

The renderer is real WebGL2, so parts of the suite need a real GPU. What runs
where is deliberate — a required check that is red on every push is as harmful
as no check at all, because it trains reviewers to merge through red and buries
genuine regressions.

| suite | where | gating? |
| --- | --- | --- |
| `npm run test:browser:chromium` — standalone, embed-sandbox, context-loss | `Browser / browser-chromium`, every push + PR | **required** |
| `npm run test:browser:full` — the same renderer specs on Firefox + WebKit | `Browser (full matrix)`, weekly + on demand | advisory |
| `npm run test:visual` — deterministic screenshot baselines | `Browser (full matrix)`, weekly + on demand | advisory |

GitHub-hosted runners have no GPU. Chromium can be pointed at ANGLE/SwiftShader,
a conformant *software* WebGL2 implementation that this renderer initializes on
happily, so the Chromium gate is genuine and reliably green — the flags live in
`playwright.config.ts`. Firefox needs its WebGL2 gate re-opened via prefs (the
Playwright build ships `AllowWebgl2:false`) and its headless-Linux software path
is not dependable; WebKit has no software-WebGL knob at all. Visual regression
has no baseline to compare against in CI because no reference images are
committed to the repo yet. Nothing is deleted or skipped — those suites simply
run where they can produce a trustworthy answer.

**Before cutting a release**, run the advisory suites locally on a GPU machine:

```bash
npm run build
npx playwright install chromium firefox webkit
npm run test:browser:full          # Firefox + WebKit renderer specs
npm run test:visual                # needs baselines on the reference machine
```

Generate or refresh visual baselines with
`npx playwright test test/browser/visual.spec.ts --update-snapshots` on the
reference machine. An agent may *propose* a baseline update but must never
self-approve one (Doc2 §9).

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
