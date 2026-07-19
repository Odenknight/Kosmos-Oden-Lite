# Kosmos-Oden CI/CD and Agent Operating Directive

**Repository:** `Odenknight/Kosmos-Oden`  
**Assessment date:** 2026-07-12  
**Assessed branch/commit:** `main` at `deb87589c36d71b0efe5e74ed56d4221d4264a60`  
**Status:** Proposed operating directive

---

## 1. Purpose

This directive defines how Shaun, human contributors, and software agents should plan, implement, verify, review, merge, and release changes to Kosmos-Oden.

The process is designed to preserve the project's strongest properties:

- one shared semantic engine;
- offline, self-contained artifacts;
- deterministic and reproducible builds;
- read-only visualization and Agent API behavior;
- sandboxed renderer execution;
- explicit dependency provenance;
- identical graph semantics across plugin, standalone, CLI, MCP, and REST surfaces;
- controlled releases that can be independently verified.

The process also closes the most important remaining assurance gaps:

- browser-executed rendering tests;
- rendering regression images;
- cross-browser and cross-platform validation;
- renderer provenance checks;
- performance budgets;
- agent separation of duties;
- release-candidate promotion rather than direct agent release.

---

## 2. Current baseline

The repository already has a better CI foundation than the supplied review implies.

Current controls include:

- exact development-dependency versions in `package.json`;
- a committed `package-lock.json`;
- Node 22 and npm requirements;
- clean installation through `npm ci`;
- type checking;
- full and standalone builds;
- 119 Node-based tests at the assessed commit;
- version synchronization checks;
- static artifact/self-containment checks;
- machine-readable invariant checks;
- dependency review on pull requests;
- weekly Dependabot checks;
- byte-for-byte double-build reproducibility testing;
- tag-built releases;
- `BUILD-INFO.json`;
- `SHA256SUMS`;
- checksum verification before release publication;
- minimal `contents: read` permissions in normal CI.

The process below **extends** that baseline; it does not replace it.

---

## 3. Governing rules

### 3.1 Protected truths

Every contributor and agent must preserve these unless a separately approved architecture decision explicitly changes them:

1. Graph semantics live only in `src/core/`.
2. The visualization is a consumer of a completed Core graph.
3. The standalone viewer remains read-only.
4. The Agent API remains read-only.
5. The stable standalone artifact remains fully offline and self-contained.
6. The stable plugin renderer remains sandboxed without `allow-same-origin`.
7. Host-to-renderer messages remain versioned and structurally validated.
8. Release artifacts are produced from the tagged commit in CI.
9. Executable artifacts are reproducible from a clean checkout.
10. New dependencies are exact-pinned and provenance-recorded.
11. Agents do not directly publish production releases.
12. An agent must not approve or merge its own change.

### 3.2 No direct changes to `main`

All human and agent work must use a branch and pull request.

Recommended branch patterns:

```text
feature/<issue>-<short-name>
fix/<issue>-<short-name>
renderer/<issue>-<short-name>
security/<issue>-<short-name>
docs/<issue>-<short-name>
agent/<agent-name>/<issue>-<short-name>
release/vX.Y.Z-rc.N
```

Direct pushes to `main`, force pushes to `main`, and deleting the protected branch should be disabled.

### 3.3 Generated artifacts

Agents must edit source files, not generated files.

Generated files include:

```text
main.js
vault-kosmos.html
dist/**
release/**
```

After source changes, the implementation agent runs the official build and commits regenerated artifacts only when the repository's contribution policy continues to require committed build output. Generated diffs must not contain unexplained changes.

---

## 4. Agent separation of duties

One local model can fill multiple roles on low-risk documentation work, but code and release work should preserve logical separation.

| Role | Responsibilities | Prohibited actions |
|---|---|---|
| Primary/Planning Agent | Read issue, inspect architecture and invariants, define scope, risks, acceptance tests, affected surfaces | Must not silently expand scope |
| Implementation Agent | Change source, add tests, rebuild artifacts, document migration notes | Must not approve its own PR |
| Test Agent | Independently run tests, inspect generated artifacts, add regression coverage, test failure paths | Must not modify production code merely to make a test pass without documenting why |
| Renderer QA Agent | Execute browser matrix, screenshot comparisons, GPU/context-loss tests, performance checks | Must not waive visual changes |
| Security/Invariant Agent | Review sandbox, network, token, dependency, provenance, offline, and read-only boundaries | Must not treat an absence of a known CVE as proof of safety |
| Code Review Agent | Review architecture, maintainability, error handling, compatibility, and unnecessary complexity | Must not rely only on PR prose |
| Release Agent | Verify version/changelog, prepare RC, collect CI evidence, generate release notes | Must not create or publish the production tag without human authorization |
| Human Maintainer | Resolve disputed findings, approve high-risk changes, approve RC promotion, publish/authorize production release | Should not bypass required checks |

For a renderer change, the implementation agent, renderer QA agent, and final reviewer must be logically independent runs with separate prompts and evidence.

---

## 5. Required development workflow

### Step 1 — Open an issue

Every non-trivial change starts with an issue containing:

- problem statement;
- desired outcome;
- affected surfaces;
- protected invariants;
- threat-model impact;
- compatibility impact;
- test plan;
- rollback plan;
- documentation impact;
- whether generated artifacts will change.

Renderer issues must additionally state:

- current and proposed Three.js revision;
- WebGL/WebGPU backend impact;
- shader-language impact;
- color-management impact;
- minimum browser/GPU requirements;
- expected bundle-size delta;
- visual-regression baseline;
- whether `file://` remains supported.

### Step 2 — Produce a change plan

The Primary Agent writes a compact plan in the issue or PR:

```markdown
## Change plan
- Scope:
- Non-goals:
- Files expected to change:
- Invariants at risk:
- Tests to add:
- Browser/platform matrix:
- Rollback:
```

The plan is a control boundary. Scope expansion requires an issue/PR note.

### Step 3 — Implement on a branch

The Implementation Agent:

1. starts from current `main`;
2. uses `npm ci`;
3. changes source in focused commits;
4. adds or updates tests;
5. updates documentation and changelog where applicable;
6. runs `npm run verify`;
7. rebuilds generated artifacts;
8. records any non-deterministic or platform-specific result.

### Step 4 — Open a draft PR

The PR must include:

```markdown
## What changed

## Why

## Surfaces affected
- [ ] Core
- [ ] Obsidian desktop
- [ ] Obsidian mobile
- [ ] Standalone `file://`
- [ ] Standalone over HTTP(S)
- [ ] Agent API / MCP
- [ ] CLI
- [ ] Release pipeline

## Risk flags
- [ ] Renderer or shader change
- [ ] Dependency change
- [ ] Sandbox/protocol change
- [ ] Network/authentication change
- [ ] Read/write-boundary change
- [ ] Bundle increase over budget
- [ ] Compatibility reduction

## Evidence
- Local verification:
- Added tests:
- Browser matrix:
- Visual comparison:
- Performance comparison:
- Artifact hashes:
- Known limitations:
- Rollback commit/tag:
```

### Step 5 — Run independent reviews

At least one independent agent reviews ordinary code. Renderer, security, protocol, network, dependency, and release changes require human review.

The reviewer must inspect:

- source diff;
- generated-artifact diff;
- tests;
- CI logs;
- dependency/provenance changes;
- claims made in README/changelog;
- rollback feasibility.

### Step 6 — Merge

Recommended default:

- squash merge for ordinary PRs;
- preserved multi-commit history only when migration steps are independently useful;
- no merge if required checks are pending, skipped, or neutral without explanation;
- stale PR branches must be updated and rerun before merge;
- dismissal of an approving review after new commits.

---

## 6. Recommended GitHub branch protection

Configure `main` with:

- require pull request before merging;
- require at least one approving review;
- require two approvals for `renderer`, `security`, `release`, `protocol`, or `network` labeled PRs;
- dismiss stale approvals after new commits;
- require conversation resolution;
- require signed commits where practical;
- require linear history or squash merge;
- block force pushes;
- block branch deletion;
- require branches to be current before merge;
- restrict bypass permission to the human maintainer;
- prevent GitHub Actions and agent credentials from bypassing protection.

Required status checks should include:

```text
CI / validate
CI / reproducibility
CI / dependency-review
Browser / chromium-standalone
Browser / firefox-standalone
Browser / webkit-standalone
Browser / plugin-embed
Visual / webgl-reference
Security / codeql
Security / provenance
Performance / renderer-budget        # blocking on renderer PRs
Release / artifact-contract
```

---

## 7. CI pipeline

### 7.1 Stage A — Source and policy validation

Run on every push and pull request:

```text
npm ci
npm run typecheck
npm test
npm run check:versions
npm run check:invariants
```

Add:

- formatting/lint validation;
- source-license validation;
- forbidden-secret patterns;
- generated-file consistency;
- exact dependency/version policy;
- renderer revision policy;
- action pinning policy.

Recommended new checks:

```text
npm run lint
npm run check:renderer-provenance
npm run check:generated
npm run check:licenses
```

### 7.2 Stage B — Build and artifact contract

Build all supported flavors from a clean tree.

Stable outputs:

```text
main.js
manifest.json
styles.css
versions.json
vault-kosmos.html
dist/kosmos-embed.html
dist/kosmos-core.mjs
dist/kosmos-agent-server.mjs
dist/kosmos-layout.mjs
dist/kosmos-protocol.mjs
```

Proposed renderer outputs:

```text
vault-kosmos.html                  # stable WebGL2
vault-kosmos-webgpu.html           # experimental/optional
vault-kosmos-legacy.html           # optional frozen compatibility build
dist/kosmos-embed.html             # stable plugin WebGL2 embed
dist/kosmos-embed-webgpu.html      # test/experimental embed, not stable plugin by default
```

Artifact checks must confirm:

- no external scripts or styles;
- no runtime CDN/network dependency;
- expected renderer revision;
- expected renderer backend marker;
- no source maps in release output;
- no `.env`, token, key, or local data files;
- single-file standalone behavior;
- `file://` operation for the stable WebGL build;
- valid version strings;
- maximum bundle-size budget;
- generated artifact matches source build.

### 7.3 Stage C — Reproducibility

Keep the current double-build hash comparison.

Extend it to every release flavor:

```bash
sha256sum \
  main.js \
  vault-kosmos.html \
  vault-kosmos-webgpu.html \
  dist/kosmos-embed.html \
  dist/kosmos-embed-webgpu.html
```

WebGPU artifacts may be omitted until that build becomes an official release asset.

Also add a second operating-system reproducibility check, preferably Windows, because path separators, line endings, shell quoting, and text encoding are common failure points.

Expected rule:

> Ubuntu and Windows builds of the same release inputs must produce byte-identical executable files, or the build must document and eliminate the source of variation.

### 7.4 Stage D — Browser-executed tests

The present Node/static checks do not prove that WebGL initializes or that a real browser draws the scene.

Add Playwright-based tests against deterministic fixtures.

Minimum stable matrix:

| Surface | Chromium | Firefox | WebKit |
|---|---:|---:|---:|
| Standalone over HTTP | Required | Required | Required |
| Standalone `file://` | Required | Required where browser permits test automation | Required where browser permits test automation |
| Plugin embed sandbox harness | Required | Informational | WebKit required |
| Mobile viewport/touch emulation | Required | Optional | Required |
| Low-power mode | Required | Required | Required |

Browser smoke assertions:

- page loads with no console errors;
- expected Three revision is reported;
- correct backend is reported;
- demo graph reaches ready state;
- expected node/body counts are present;
- at least one frame renders;
- camera interactions work;
- selection and context menu work;
- Chrono mode changes projected visibility;
- hidden-view suspension stops frame growth;
- resuming restores rendering;
- WebGL context loss produces a controlled state and restoration or a clear recovery instruction;
- standalone folder-import fallback remains available;
- no network request is emitted.

### 7.5 Stage E — Visual regression

Create deterministic render fixtures:

```text
test/fixtures/render/minimal/
test/fixtures/render/medium/
test/fixtures/render/lineage/
test/fixtures/render/classification/
test/fixtures/render/high-density/
```

Add a capture mode with:

```text
?capture=1
&seed=<fixed>
&time=<fixed>
&dpr=1
&quality=high|lite
&camera=<named-preset>
&animation=off
```

Capture:

- cluster overview;
- selected star;
- planet classifications;
- lineage ghosts;
- agent traversal overlay;
- low-power mode;
- mobile viewport.

Use per-browser reference images. Do not demand bit-for-bit equality across different GPU vendors. Use:

- fixed browser versions in CI;
- fixed viewport and DPR;
- perceptual image threshold;
- semantic assertions alongside image comparison;
- explicit approval for changed baselines.

An agent may propose a new reference image but may not approve its own visual-baseline update.

### 7.6 Stage F — Performance and resource budgets

Keep `npm run bench`, but distinguish graph/layout performance from browser rendering performance.

Renderer PR budgets should track:

- time to first rendered frame;
- steady-state FPS on fixed fixture;
- p95 frame time;
- CPU time while idle;
- frame count while hidden;
- GPU memory where measurable;
- JS heap;
- main-thread long tasks;
- standalone HTML size;
- plugin `main.js` size;
- scene rebuild time;
- selection latency.

Suggested gating policy:

```text
ordinary PR:
  performance job informational unless regression > 15%

renderer PR:
  block if median frame time regresses > 10%
  block if first-render time regresses > 15%
  block if stable artifact grows > agreed budget
  block if hidden view continues rendering
```

Thresholds should be adjusted after collecting a stable baseline rather than treated as universal constants.

### 7.7 Stage G — Security and provenance

Retain dependency review and Dependabot.

Add:

- CodeQL for JavaScript/TypeScript;
- GitHub secret scanning;
- `npm sbom` in CycloneDX or SPDX format;
- license-policy check;
- renderer provenance validation;
- GitHub artifact attestation/SLSA provenance;
- action references pinned to full commit SHAs;
- verification that release files match the tagged commit.

For a vendored renderer, require:

```json
{
  "name": "three",
  "revision": "128",
  "upstreamTag": "r128",
  "upstreamCommit": "<commit>",
  "sourceUrl": "<official source>",
  "sourceSha256": "<sha256>",
  "licenseSha256": "<sha256>",
  "verifiedUtc": "<timestamp>"
}
```

For an npm-bundled renderer, require:

- exact `three` version;
- lockfile integrity;
- release/tag mapping;
- license inclusion;
- `THREE.REVISION` assertion in tests;
- SBOM entry.

Do not claim a renderer upgrade fixes a security vulnerability unless a specific advisory, affected range, and corrected release are documented.

---

## 8. CD and promotion process

### 8.1 Pull-request artifacts

Every PR builds downloadable artifacts labeled with the commit SHA.

These are test artifacts, not releases.

Retention recommendation: 14–30 days.

### 8.2 Release candidate

A release begins as `vX.Y.Z-rc.N`.

The Release Agent prepares:

- version update;
- changelog;
- migration notes;
- known limitations;
- browser/platform matrix;
- artifact sizes;
- renderer revision/backend;
- visual baseline delta;
- benchmark comparison;
- SBOM;
- checksum list;
- provenance attestation.

CI publishes a **GitHub prerelease** only after all required checks pass and a human approves the release environment.

### 8.3 Soak validation

For a renderer release, validate the RC on real systems:

- Windows: Chrome/Edge and Obsidian desktop;
- macOS: Safari/Chrome and Obsidian desktop;
- Linux: Chromium/Firefox and Obsidian desktop;
- Android: Chrome and Obsidian mobile;
- iPhone/iPad: Safari and Obsidian mobile;
- low-power/integrated GPU;
- at least one discrete GPU;
- offline/air-gapped test;
- `file://` standalone test.

Record results in the release issue.

### 8.4 Production promotion

Production release requires:

1. all RC checks green;
2. no unresolved severity-1 or severity-2 regression;
3. human approval;
4. signed or protected production tag;
5. tag/version equality;
6. clean tag build;
7. checksum verification;
8. SBOM and provenance attachment;
9. artifact attestation;
10. GitHub release publication.

Agents may prepare the release and evidence. They must not independently authorize production promotion.

### 8.5 Rollback

Every release must state:

- last known-good tag;
- incompatible data/protocol changes, if any;
- downgrade instructions;
- whether generated files are backward compatible;
- renderer-specific rollback assets.

Because Kosmos-Oden is read-only and release artifacts are self-contained, rollback should normally be a binary/plugin asset replacement rather than a data migration.

---

## 9. Renderer-upgrade special gate

A renderer upgrade is a high-risk change even when it compiles.

It must be separated from unrelated features.

Required sequence:

1. Record current r128 screenshots, metrics, artifact hashes, and platform results.
2. Introduce module-based dependency/provenance changes without visual redesign.
3. Upgrade to the selected modern Three.js revision using WebGLRenderer.
4. Restore visual parity and browser compatibility.
5. Release a WebGL-only RC.
6. Stabilize and release.
7. Begin WebGPU/TSL work in a separate issue/branch.
8. Publish WebGPU as experimental until it meets the stable platform matrix.

Do not combine:

- r128-to-current upgrade;
- global-to-module conversion;
- GLSL-to-TSL conversion;
- WebGPU introduction;
- new visual effects;
- layout changes;
- semantic graph changes;

in one PR.

---

## 10. Suggested workflow files

Recommended workflow split:

```text
.github/workflows/
  ci.yml                    # source, typecheck, unit, invariants
  build.yml                 # all artifacts and reproducibility
  browser.yml               # Playwright browser matrix
  visual.yml                # screenshot regressions
  performance.yml           # graph and renderer budgets
  security.yml              # CodeQL, SBOM, provenance, licenses
  release-candidate.yml     # manual/approved prerelease
  release.yml               # protected production tag
```

This split makes failures easier for humans and agents to classify and avoids rerunning expensive GPU/browser work when only documentation changes.

Use path filters carefully. Policy, build, renderer, test, workflow, package, and release-document changes should always trigger the complete relevant pipeline.

---

## 11. Definition of done

A change is done only when:

- issue acceptance criteria are met;
- source and generated artifacts agree;
- `npm run verify` passes;
- required browser checks pass;
- visual changes are reviewed;
- performance remains within budget;
- protected invariants pass;
- documentation describes actual behavior;
- dependency and provenance records are current;
- independent review is complete;
- rollback is clear;
- human approval is present for high-risk changes.

A green build alone is not sufficient for renderer work. The scene must execute, render, remain usable, remain offline, and remain compatible on the declared platform set.
