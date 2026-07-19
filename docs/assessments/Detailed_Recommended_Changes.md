# Vault Kosmos (Kosmos-Oden) — Detailed Recommended Changes

**Repository:** `Odenknight/Kosmos-Oden`  
**Repository version reviewed:** `v0.5.1`  
**Review date:** July 11, 2026  
**Audience:** Human maintainers, code-review agents, security-review agents, and release-engineering agents

---

## 1. Purpose of This Document

This document converts the architectural and repository assessment of Vault Kosmos into a concrete remediation and improvement plan.

The recommendations are organized by priority and include:

- the problem being addressed;
- why it matters;
- the proposed implementation;
- implementation cautions;
- suggested validation steps; and
- acceptance criteria suitable for human or automated-agent review.

This is not a recommendation to rewrite the project. Vault Kosmos already has a sound product concept and several strong design choices:

- local-first operation;
- a read-only Agent API;
- localhost binding by default;
- incremental vault updates;
- a clear separation between the Obsidian host, Agent API, and 3D renderer;
- REST and MCP support; and
- standalone and embedded visualization modes.

The next phase should strengthen the engineering controls around those features.

---

# 2. Priority Summary

## High Priority

1. Add continuous integration for type checking, tests, builds, and artifact consistency.
2. Add a dependency lockfile and replace unbounded dependency versions.
3. Establish one authoritative renderer source without unnecessary source-tree restructuring.
4. Document the iframe trust model and perform a bounded sandbox compatibility evaluation.
5. Remove the non-cryptographic token-generation fallback.
6. Harden Agent API authentication and define a backward-compatible deprecation path.
7. Harden and document LAN mode.
8. Build and verify release assets during the release workflow.
9. Add explicit version-consistency verification.

## Medium Priority

10. Perform a gap analysis of the existing 33-check test harness.
11. Expand security and protocol tests according to identified gaps.
12. Add build provenance metadata, checksums, and optional artifact attestations.
13. Refactor test commands into standard package scripts.
14. Add logging and diagnostics that do not expose secrets or vault content.
15. Define supported runtime versions.
16. Add staged performance regression testing.
17. Separate generated source from hand-maintained source.
18. Verify fork attribution, third-party licenses, and standalone-mode data handling.

## Low Priority

16. Add a changelog.
17. Add issue, pull-request, and security-reporting templates.
18. Add architectural and threat-model documentation.
19. Add screenshots or a short demonstration.
20. Add benchmark documentation.
21. Add automated documentation checks.

---

# 3. High-Priority Recommendations

## 3.1 Add Continuous Integration

### Current concern

The repository includes a release workflow, but release creation is not the same as continuous integration. A release workflow that uploads committed files does not prove that:

- TypeScript compiles;
- tests pass;
- the committed `main.js` corresponds to the current source;
- generated renderer artifacts are synchronized;
- version files agree;
- dependencies install reproducibly; or
- the release assets can be rebuilt from the tagged commit.

A local test harness is useful, but it provides limited protection unless it runs automatically on every relevant change.

### Recommended implementation

Create `.github/workflows/ci.yml` and run it on:

- pushes to `main`;
- pull requests;
- optionally, manual dispatch.

The initial CI workflow should perform:

1. repository checkout;
2. setup of a pinned Node.js major version;
3. reproducible dependency installation with `npm ci`;
4. TypeScript type checking;
5. automated tests;
6. production build;
7. generated-artifact verification;
8. version-consistency verification; and
9. optional dependency and secret scanning.

Example:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Type-check
        run: npm run typecheck

      - name: Run tests
        run: npm test

      - name: Build production bundle
        run: npm run build

      - name: Verify generated artifacts
        run: npm run verify:generated

      - name: Verify project versions
        run: npm run verify:versions
```

### Package-script changes

Add standardized scripts:

```json
{
  "scripts": {
    "build": "npm run typecheck && node esbuild.config.mjs --production",
    "dev": "node esbuild.config.mjs",
    "typecheck": "tsc --noEmit",
    "test": "node test/run.cjs",
    "generate:renderer": "node scripts/generate-renderer.mjs",
    "verify:generated": "node scripts/verify-generated.mjs",
    "verify:versions": "node scripts/verify-versions.mjs",
    "verify": "npm run typecheck && npm test && npm run build && npm run verify:generated && npm run verify:versions"
  }
}
```

### Acceptance criteria

- A pull request cannot be merged when type checking, tests, build, or verification fails.
- CI uses `npm ci`, not `npm install`.
- CI runs from a clean checkout.
- A source change that requires regeneration causes CI to fail if generated files are stale.
- A version mismatch causes CI to fail with a clear message.

---

## 3.2 Commit a Dependency Lockfile and Pin the Toolchain

### Current concern

The package manifest currently uses dependency ranges and an unbounded `"latest"` entry. Without a committed lockfile, two developers can build the same commit and receive different dependency trees.

This is especially important when the repository commits a generated `main.js`, because a future rebuild could differ for reasons unrelated to source changes.

### Recommended implementation

1. Replace `"obsidian": "latest"` with a tested, explicit version.
2. Decide whether patch-level upgrades should be automatic or reviewed.
3. Generate and commit `package-lock.json`.
4. Use `npm ci` in CI and release workflows.
5. Declare supported Node.js and npm versions.
6. Optionally add an `.nvmrc` or `.node-version`.

Example:

```json
{
  "engines": {
    "node": ">=22 <23",
    "npm": ">=10 <11"
  },
  "devDependencies": {
    "esbuild": "0.21.5",
    "obsidian": "1.8.10",
    "typescript": "5.4.5"
  }
}
```

Exact versions are simplest for reproducibility. Controlled update automation can then propose version upgrades through pull requests.

### Update policy

Use Dependabot or Renovate with:

- scheduled dependency-update pull requests;
- grouped development-tool updates;
- CI required before merge;
- no automatic merge for build tools without review.

### Acceptance criteria

- `package-lock.json` is committed.
- `npm ci` succeeds from a fresh clone.
- Repeated clean builds use the same dependency graph.
- No package uses `"latest"`.
- The supported Node.js runtime is documented.

---

## 3.3 Establish One Authoritative Renderer Source

### Current concern

The project distributes both:

- a standalone `kosmos-iframe.html`; and
- an embedded renderer represented in `src/kosmos-html.ts`.

Both outputs are useful. The problem is not that both exist; the problem is that they can drift if maintained independently.

The embedded TypeScript file is also extremely large and difficult to review when it primarily contains generated or encoded content.

### Revised implementation approach

Do not reorganize the entire source tree merely to solve this problem. For a small, single-maintainer plugin, the least disruptive structure is preferable.

Suggested layout:

```text
src/
  main.ts
  agent-api.ts
  kosmos-html.ts        generated file

scripts/
  generate-kosmos-html.mjs
  verify-generated.mjs

kosmos-iframe.html      authoritative renderer source
main.js                 generated plugin bundle
```

This preserves the current flat source organization while still establishing one source of truth.

### Important caveat

`kosmos-iframe.html` should be treated as the authoritative source only if it is genuinely human-editable source.

If the root HTML is itself minified, bundled, or generated from other renderer code, then the true authoritative source should remain upstream, for example:

```text
src/renderer-source/
  index.html
  renderer.ts
  renderer.css
```

In that case, both `kosmos-iframe.html` and `src/kosmos-html.ts` should be generated outputs.

The rule is:

> There must be one human-maintained renderer source and any distributed variants must be deterministically generated from it.

### Generation requirements

The generation script should:

1. read the authoritative renderer artifact;
2. encode or escape it deterministically;
3. write `src/kosmos-html.ts`;
4. normalize line endings;
5. avoid timestamps and random values;
6. fail on malformed or missing input;
7. report source and output hashes;
8. place a generated-file warning at the top of the output.

Example generated header:

```ts
/**
 * GENERATED FILE — DO NOT EDIT DIRECTLY.
 *
 * Source: kosmos-iframe.html
 * Generator: scripts/generate-kosmos-html.mjs
 * Regenerate with: npm run generate:renderer
 */
```

### Verification

`npm run verify:generated` should:

1. generate the embedded module into a temporary location;
2. compare it byte-for-byte or hash-for-hash with the committed generated file;
3. fail with a clear message when differences exist.

If `main.js` remains committed, verification should also rebuild it and compare it with the repository copy.

### Backward-compatibility requirements

Renderer unification must not silently break existing users.

Verify that:

- the standalone HTML still opens and functions as documented;
- the generated embedded renderer behaves identically;
- controls and data-loading paths remain unchanged;
- existing plugin settings remain valid;
- release packaging continues to include all documented standalone assets.

### Acceptance criteria

- Renderer behavior is edited in one authoritative source location.
- The embedded renderer is generated from that source.
- No broad directory refactor is required unless the renderer already has multiple true source files.
- CI detects drift.
- Generated files are visibly marked.
- Generation is deterministic across supported environments.
- The standalone renderer remains backward-compatible or changes are explicitly documented.

## 3.4 Document the Iframe Trust Model and Perform a Bounded Sandbox Evaluation

### Current concern

The renderer is placed in an iframe using `srcdoc`, but `srcdoc` does not automatically create a security sandbox.

The current source validates incoming messages against the expected `contentWindow`. That is useful, but it provides message-source validation rather than strong isolation.

The iframe should therefore be described as:

- an organizational and lifecycle boundary;
- a separate rendering context;
- a message-based component boundary;

but not as a proven security sandbox.

### Practical risk assessment

The plugin host already has broad Obsidian privileges. Sandboxing the renderer would not protect the user from malicious or compromised host code.

However, internal isolation may still provide defense in depth because:

- the renderer is much larger than the host integration code;
- generated renderer code is harder to review;
- note-derived data enters the renderer;
- future renderer changes may introduce new capabilities;
- a renderer-specific defect could otherwise reach parent-window capabilities.

The potential benefit is therefore limited but not zero.

### Do not assume either outcome

Do not assume that sandboxing is automatically necessary.

Do not assume that sandboxing would necessarily break note opening or Obsidian integration. The current note-opening path is mediated through `postMessage` and handled by `main.ts`, so the iframe itself does not appear to require direct access to the Obsidian API for that action.

Other renderer features may still depend on capabilities affected by sandboxing.

### Recommended action: compatibility experiment

Create a small branch or test build using:

```ts
frame.setAttribute("sandbox", "allow-scripts");
```

Then test:

- rendering startup;
- note opening;
- folder reveal;
- pointer and mouse controls;
- keyboard controls;
- fullscreen behavior;
- downloads or exports;
- local storage or session storage;
- worker usage;
- dynamic imports;
- blob URLs;
- any origin-dependent behavior;
- Electron-specific behavior.

Record exactly what works and what fails.

Adopt the sandbox only if required features can be preserved without adding broad permissions that erase the intended benefit.

Avoid adding permissions such as `allow-same-origin` reflexively. Each permission should correspond to a demonstrated requirement.

### Message-protocol hardening

Regardless of sandbox adoption, formalize and validate the host–renderer protocol.

Example:

```ts
type KosmosMessage =
  | {
      protocol: "vault-kosmos";
      version: 1;
      type: "vault-snapshot";
      requestId: string;
      payload: VaultSnapshot;
    }
  | {
      protocol: "vault-kosmos";
      version: 1;
      type: "vault-delta";
      requestId: string;
      payload: VaultDelta;
    };
```

Validate:

- protocol name;
- version;
- message type;
- required properties;
- path formats;
- array lengths;
- payload-size limits;
- unexpected or unsupported messages.

### Backward compatibility

Because host and embedded renderer normally ship together inside `main.js`, full support for multiple historical protocol versions may be unnecessary.

Still:

- include a protocol version;
- reject unknown future versions clearly;
- avoid changing message semantics silently;
- document any migration if the standalone renderer and host can be mixed across versions.

### Acceptance criteria

- Documentation no longer claims that `srcdoc` alone provides sandboxing.
- The current iframe is described as trusted renderer code unless stronger isolation is proven.
- A bounded sandbox compatibility test is completed and documented.
- Sandboxing is adopted only when it produces meaningful isolation without unacceptable breakage.
- Message payloads are structurally validated.
- Unknown message types and versions are rejected safely.

## 3.5 Replace the Insecure Token Fallback

### Current concern

The secure branch of token generation uses `crypto.getRandomValues()`.

The existing modulo-16 conversion is not biased: 256 possible byte values divide evenly across 16 hexadecimal values. The problem is not statistical bias.

The valid concerns are:

- only four bits from each generated byte are retained;
- the resulting encoding is less direct than byte-to-hex conversion;
- the fallback to `Math.random()` is not suitable for generating authentication secrets.

The `Math.random()` fallback is the issue that must be removed.

### Recommended implementation

Use cryptographically secure randomness only:

```ts
export function makeToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
```

This produces a 48-character hexadecimal token containing 192 bits of entropy.

If secure randomness is unexpectedly unavailable:

- do not silently generate a weak token;
- disable token creation;
- show a clear error; and
- leave the Agent API disabled.

### Token lifecycle improvements

Consider adding:

- a regenerate-token action;
- a warning that regeneration invalidates existing clients;
- optional token rotation;
- last-four-character display rather than full-token display;
- an explicit copy button;
- no token inclusion in routine logs;
- optional token storage through an OS credential facility if practical.

### Acceptance criteria

- No `Math.random()` path exists for authentication token generation.
- Token generation produces at least 128 bits of entropy.
- Failure of secure randomness fails closed.
- Tests validate format, length, and non-empty output.
- Logs and error messages do not disclose tokens.

---

## 3.6 Harden Agent API Authentication

### Current concern

Supporting bearer tokens in headers is appropriate. Accepting tokens in URL query strings is convenient but increases leakage risk.

Query strings can appear in:

- browser history;
- copied URLs;
- proxy logs;
- screenshots;
- diagnostic captures;
- crash reports; and
- referrer information.

### Recommended policy

Preferred authentication mechanisms:

1. `Authorization: Bearer <token>`
2. `X-API-Key: <token>`

Deprecate:

```text
?token=<token>
```

If compatibility requires retaining query-token authentication:

- disable it by default;
- warn when it is enabled;
- reject it in LAN mode;
- redact URLs before logging;
- document the risk;
- schedule removal in a future major version.

### Authentication behavior

The server should:

- return `401 Unauthorized` for missing or invalid credentials;
- use a generic response that does not distinguish missing from incorrect tokens;
- set `Cache-Control: no-store`;
- avoid echoing credentials;
- compare fixed-format token hashes or padded byte sequences in constant time;
- rate-limit repeated failures in LAN mode; and
- record only minimal, non-sensitive diagnostics.

### Acceptance criteria

- Header authentication is the documented default.
- Query-string tokens are removed or explicitly deprecated.
- Authentication responses do not leak token validity details.
- Sensitive endpoints send `Cache-Control: no-store`.
- Tests cover missing, malformed, too-long, too-short, and invalid tokens.

---

## 3.7 Add an Explicit Backward-Compatibility and Deprecation Policy

### Current concern

Several recommended changes may affect existing users or agent configurations:

- deprecating query-string tokens;
- changing authentication errors;
- changing renderer generation;
- introducing message protocol versions;
- renaming settings;
- changing REST or MCP parameters;
- changing release-package contents.

Security improvements should not create silent breakage where a staged migration is possible.

### Recommended policy

Adopt a simple compatibility policy for the pre-1.0 project:

- document breaking changes in release notes;
- provide at least one release of deprecation warning when practical;
- preserve existing settings through migration code;
- avoid reusing configuration keys with different meanings;
- retain aliases temporarily when endpoint or parameter names change;
- include a removal target version for every deprecated behavior.

### Query-token migration example

1. In the current `0.5.x` line:
   - continue accepting query tokens on loopback only;
   - emit a warning that does not include the token;
   - stop generating query-token examples in documentation;
   - reject query tokens in LAN mode.

2. In the next planned breaking release:
   - remove query-token authentication;
   - require `Authorization` or `X-API-Key`.

3. In release notes:
   - show before-and-after client configuration;
   - explain the security reason;
   - identify the exact removal version.

### Settings migration

When changing settings schema:

- assign a schema version;
- migrate old settings on load;
- preserve unknown settings where possible;
- create a backup before destructive migration;
- test upgrades from the prior released version.

### Protocol compatibility

For MCP and REST:

- distinguish protocol errors from authentication errors;
- avoid changing response shapes without version notes;
- add compatibility tests for documented client examples;
- keep stable method names unless a security or correctness issue requires change.

### Acceptance criteria

- Every deprecation has a stated replacement and removal target.
- Existing settings are migrated automatically where practical.
- LAN-mode security improvements may be enforced immediately when necessary.
- Release notes include migration examples for client-facing changes.
- Compatibility tests cover at least the previous released version's documented configuration.

## 3.8 Document and Reduce LAN-Mode Risk

### Current concern

LAN mode exposes the API over plain HTTP unless the user independently adds encryption. Bearer tokens and vault contents may therefore travel unencrypted across the local network.

Host and Origin validation help against certain browser attacks, but do not encrypt traffic or protect against a hostile machine that can observe the network.

### Recommended documentation

Display a warning before LAN mode is enabled:

> LAN mode exposes the read-only Vault Kosmos API over unencrypted HTTP. Use it only on a trusted network. For stronger protection, use a VPN, SSH tunnel, TLS reverse proxy, or another authenticated encrypted transport.

### Recommended technical controls

- Keep LAN mode off by default.
- Require token authentication in LAN mode.
- Do not permit “no token” mode when bound beyond loopback.
- Bind only to selected interfaces when possible.
- Display the actual bind addresses.
- Reject public/non-private interface binding unless explicitly supported.
- Add optional allowlists for client IP ranges.
- Add conservative request-rate limits.
- Add a maximum concurrent-connection limit.
- Consider TLS support only if certificate management can be made reliable; otherwise document a reverse-proxy pattern.

### Acceptance criteria

- LAN mode cannot run without authentication.
- The settings UI clearly states that HTTP is unencrypted.
- Documentation includes secure tunnel or proxy examples.
- LAN-mode tests verify bind behavior and auth enforcement.
- Public-interface exposure is prevented or requires an additional explicit override.

---

## 3.9 Build and Verify Release Assets in the Release Workflow

### Current concern

The release workflow currently uploads repository files. It does not independently prove that those files were built from the tagged source.

A release should be the output of a controlled build, not merely a copy of whatever generated artifacts happen to be committed.

### Recommended release workflow

The release job should:

1. check out the exact tag;
2. set up the pinned Node.js version;
3. install dependencies with `npm ci`;
4. run all verification;
5. build the renderer;
6. generate embedded artifacts;
7. build `main.js`;
8. verify versions;
9. assemble a clean release directory;
10. calculate checksums;
11. upload only that directory’s artifacts;
12. optionally produce an attestation.

Example high-level workflow:

```yaml
- uses: actions/checkout@v4

- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm

- run: npm ci
- run: npm run verify
- run: npm run package:release
- run: sha256sum release/* > release/SHA256SUMS

- name: Create GitHub release
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    gh release create "$GITHUB_REF_NAME" release/* \
      --verify-tag \
      --title "Vault Kosmos $GITHUB_REF_NAME" \
      --notes-file "$NOTES"
```

### Clean release directory

Example:

```text
release/
  manifest.json
  main.js
  styles.css
  kosmos-iframe.html
  SHA256SUMS
  BUILD-INFO.json
```

The standalone file may be included separately from the Obsidian plugin assets if desired.

### Acceptance criteria

- Releases are built from the tagged commit in GitHub Actions.
- Release creation fails if tests or verification fail.
- Release assets are copied from a clean staging directory.
- SHA-256 checksums are published.
- The tag version matches all project version files.

---

## 3.10 Add Version-Consistency Verification

### Current concern

The project has multiple version-bearing locations, potentially including:

- `package.json`;
- `manifest.json`;
- `versions.json`;
- release-note filename;
- Git tag;
- release title; and
- possibly user-visible source constants.

Manual synchronization is error-prone.

### Recommended implementation

Create `scripts/verify-versions.mjs` that:

1. reads all version-bearing files;
2. compares expected values;
3. validates semantic-version format;
4. validates minimum Obsidian-version mappings;
5. checks the tag when running under GitHub Actions;
6. exits nonzero with actionable messages.

Example error:

```text
Version verification failed:
- package.json: 0.5.2
- manifest.json: 0.5.1
- Git tag: v0.5.2

Update manifest.json to 0.5.2 before releasing.
```

### Acceptance criteria

- A version mismatch cannot pass CI.
- A mismatched tag cannot create a release.
- The script can run locally.
- Release notes are checked for the expected version.

---

# 4. Medium-Priority Recommendations

## 4.1 Perform a Test-Coverage Gap Analysis Before Expanding the Suite

### Current concern

The existing test harness reportedly contains 33 checks against a stub Obsidian environment. A raw test count does not show which invariants are covered or which high-risk paths remain untested.

Adding a large generic test matrix without first mapping current coverage can duplicate low-value tests while missing important gaps.

### Recommended process

Create a coverage inventory with columns such as:

| Area | Existing test | Negative test | Integration test | Missing behavior | Priority |
|---|---:|---:|---:|---|---:|
| Server startup | Yes | Partial | Partial | repeated start/stop | Medium |
| Authentication | Partial | Partial | Yes | malformed headers and migration behavior | High |
| Host validation | Partial | Partial | Yes | IPv6, trailing-dot, malformed-host cases | High |
| Origin validation | Partial | Partial | Yes | `null`, absent, hostile origin | High |
| REST routes | Yes | Partial | Yes | invalid limits and oversized output | High |
| MCP routes | Partial | Partial | Partial | unsupported methods and malformed requests | Medium |
| Port conflicts | Yes | Yes | Yes | settings recovery UX | Low |
| Vault mutation | Unknown | Unknown | Unknown | before/after filesystem invariant | High |
| LAN mode | Unknown | Unknown | Unknown | mandatory auth and bind restrictions | High |
| Renderer messaging | Unknown | Unknown | Partial | malformed and forged messages | Medium |

### Required outputs

The gap analysis should identify:

- tests already present;
- tests that are only unit-level;
- tests that use unrealistic stubs;
- missing negative cases;
- missing end-to-end cases;
- controls that are documented but not tested;
- obsolete tests tied to previous behavior.

### Prioritization rule

Prioritize tests that protect stable security invariants:

1. authentication;
2. LAN-mode restrictions;
3. Host/Origin validation;
4. path safety;
5. request-size limits;
6. no-write guarantees;
7. source-to-artifact consistency.

Detailed MCP conformance testing may be staged as the integration matures, but basic malformed-request and unsupported-method tests should still exist.

### Acceptance criteria

- The current 33 checks are categorized.
- Every high-priority security invariant has at least one negative test.
- Test additions are based on identified gaps.
- The gap document or table is updated when major features are added.

## 4.2 Expand Security and Protocol Testing

Add tests for:

### Authentication

- missing token;
- correct token;
- incorrect token;
- empty token;
- different-length token;
- oversized token;
- malformed `Authorization` header;
- duplicated auth headers;
- query-token deprecation behavior;
- no-token mode restrictions;
- LAN mode always requiring auth.

### Host and Origin validation

- `localhost`;
- `localhost:<port>`;
- `127.0.0.1`;
- bracketed IPv6 loopback;
- LAN IPv4 addresses;
- mixed case;
- trailing dot;
- malformed hosts;
- multiple Host values;
- hostile Origin;
- absent Origin;
- `null` Origin;
- private versus public IP addresses.

### HTTP behavior

- unsupported methods;
- invalid JSON;
- body larger than 4 MB;
- incorrect content type;
- request timeout;
- aborted request;
- duplicate MCP request IDs;
- unknown MCP methods;
- malformed MCP envelopes;
- excessive batch sizes;
- invalid note paths.

### Data safety

- no write endpoints;
- no mutation of vault files;
- path normalization;
- prevention of path traversal;
- note-content redaction policy if added later;
- output limits for very large notes.

### Acceptance criteria

- Security tests run in CI.
- Each security control has at least one negative test.
- Tests do not use production vault data.
- Regression tests are added whenever a security defect is fixed.

---

## 4.3 Add Build Metadata and Checksums

Create a machine-readable `BUILD-INFO.json`:

```json
{
  "project": "vault-kosmos",
  "version": "0.5.1",
  "gitCommit": "<full commit SHA>",
  "gitTag": "v0.5.1",
  "nodeVersion": "22.x",
  "npmVersion": "10.x",
  "buildWorkflow": "release.yml",
  "buildTimeUtc": "<release build time>",
  "dirty": false
}
```

For strict reproducibility, avoid embedding build time in `main.js`; place it in release metadata instead.

Publish:

```text
SHA256SUMS
```

Optionally use GitHub artifact attestations or Sigstore-compatible provenance.

### Acceptance criteria

- Every release has checksums.
- Build metadata identifies the source commit.
- Release assets can be matched to a specific tag and workflow run.
- Metadata does not include secrets or private runner information.

---

## 4.4 Improve Logging and Diagnostics Safely

Diagnostics should help users understand:

- server started/stopped;
- bind address and port;
- port conflict;
- invalid configuration;
- renderer load failure;
- generation/build mismatch;
- API request failure categories.

Diagnostics should not expose:

- full tokens;
- note bodies;
- query-string credentials;
- sensitive frontmatter;
- full filesystem paths unless explicitly requested.

Recommended structured log event:

```ts
{
  event: "agent_api_request",
  method: "POST",
  route: "/mcp",
  status: 200,
  durationMs: 18,
  authenticated: true
}
```

Do not log raw request bodies by default.

---

## 4.5 Define Supported Runtime Versions

Document and test:

- minimum Obsidian desktop version;
- minimum mobile version for visualization-only support;
- supported Node.js version for source builds;
- supported operating systems;
- whether Electron/Node APIs used by the Agent API vary by Obsidian version.

CI can test one primary Node.js version and optionally one compatibility version.

---

## 4.6 Add Staged Performance and Scale Regression Tests

### Immediate scope

Do not block the core build and security work on a full benchmark program.

Begin with a small deterministic fixture and a smoke-level regression check covering:

- initial graph build;
- one-note incremental update;
- a mass-change operation;
- hidden-view suspension;
- production bundle size.

Record duration and memory where practical, but use generous thresholds to avoid noisy CI failures.

### Later scope

After visualization behavior and graph semantics stabilize, add broader fixtures for:

- 100 notes;
- 1,000 notes;
- 10,000 notes;
- high-link-density vaults;
- attachment-heavy vaults;
- mass rename/create/delete;
- Graphiti export;
- time-travel reconstruction.

Potential metrics:

- graph-build time;
- incremental-update time;
- peak memory;
- serialized payload size;
- frame time;
- idle CPU;
- hidden-view CPU;
- API response time.

### Acceptance criteria

- A basic performance smoke test exists before extensive benchmarking.
- CI fails only on substantial, repeatable regressions.
- Full benchmark methodology is deferred until core behavior stabilizes.
- Bundle-size increases above a defined threshold require review.

## 4.7 Separate Generated Files from Hand-Written Source

Generated files should live in a clearly named directory, for example:

```text
src/generated/
```

Add a repository policy:

- generated files are not manually edited;
- the source and generator are reviewed;
- generated diffs are reviewed for unexpected size or behavior changes;
- CI verifies regeneration.

A `.gitattributes` file may mark large generated files as generated for GitHub language statistics and review presentation:

```gitattributes
src/generated/kosmos-html.ts linguist-generated=true
main.js linguist-generated=true
```

---

# 5. Additional Review Requirements

## 5.1 Verify Fork Lineage, Attribution, and License Obligations

### Current context

The repository identifies itself as an independent improvement of `H4R7W16/vault-kosmos` and states that both projects use the MIT license.

This appears compatible in principle, but release review should still verify that attribution and bundled third-party notices remain complete.

### Recommended checks

- retain the upstream MIT license text;
- retain required original copyright notices;
- clearly identify substantial modifications;
- verify license treatment for bundled Three.js code;
- verify licenses for any future bundled assets or dependencies;
- avoid implying endorsement by the upstream project;
- document the relationship consistently in README and release materials.

### Acceptance criteria

- Required upstream attribution is present.
- Third-party license obligations are represented in source or release artifacts.
- No incompatible dependency or asset license is introduced.
- An automated or manual release checklist includes license review.

---

## 5.2 Document the Standalone HTML Data and Security Model

### Current concern

The standalone renderer is distributed as an HTML artifact, but documentation should explain exactly how it receives vault data.

Do not assume that a browser can silently scan a vault through `file://`. Browser access normally requires a user-selected file or directory, generated graph data, drag-and-drop, or a local server.

The actual behavior should be verified from the implementation and documented precisely.

### Documentation should answer

- Does the standalone file contain embedded vault data?
- Does the user select files or directories?
- Is a Node build step required?
- Does it use a local server?
- Does it read full note contents or only graph metadata?
- Does it store data in browser storage?
- Does it make any network requests?
- Does it write any output?
- Should the generated HTML or graph-data file be treated as sensitive?
- Can the artifact be safely shared?

### Recommended controls

- keep the standalone renderer network-free unless explicitly documented;
- avoid embedding secrets or full note content unless required;
- warn users when generated artifacts contain private vault-derived data;
- provide a command to inspect or remove embedded data;
- document browser permissions;
- add a runtime or static check for unexpected external requests.

### Acceptance criteria

- Standalone-mode data flow is documented.
- Security claims match observed implementation.
- Users are told whether generated artifacts contain sensitive data.
- No unsupported claim is made that the standalone HTML automatically reads an entire vault.

---

## 5.3 Maintain an Iterative Threat Model

Threat modeling should begin before security work is complete, because it helps determine which controls should be implemented.

It should then be updated after implementation.

Recommended cycle:

1. identify assets and trust boundaries;
2. identify plausible adversaries and failure modes;
3. prioritize controls;
4. implement and test;
5. revise the model to match the final behavior;
6. repeat when network or data-access features change.

A short initial threat model is better than delaying the exercise until after hardening.

# 6. Low-Priority Recommendations

## 6.1 Add `CHANGELOG.md`

Use a consistent format such as Keep a Changelog:

```markdown
# Changelog

## [Unreleased]

### Added
### Changed
### Fixed
### Compatibility and lineage

- [ ] Deprecated behavior has a documented replacement and removal version.
- [ ] Existing settings are migrated or compatibility impact is documented.
- [ ] Standalone and embedded renderer modes remain compatible.
- [ ] Upstream attribution and third-party licenses are preserved.
- [ ] Standalone artifacts are checked for embedded sensitive data.

## Security

## [0.5.1] - 2026-07-11
...
```

Release notes can be generated from or linked to the changelog.

---

## 6.2 Add Repository Templates

Recommended files:

```text
.github/
  ISSUE_TEMPLATE/
    bug.yml
    feature.yml
    security-config.yml
  pull_request_template.md
  SECURITY.md
  CONTRIBUTING.md
```

Pull requests should confirm:

- tests added or updated;
- type checking passes;
- generated artifacts regenerated;
- security impact considered;
- documentation updated;
- version changes included only when appropriate.

---

## 6.3 Add Architecture and Threat-Model Documentation

Create:

```text
docs/
  ARCHITECTURE.md
  THREAT-MODEL.md
  RELEASE-PROCESS.md
  RENDERER-PROTOCOL.md
```

The threat model should identify:

- vault confidentiality;
- plugin host privileges;
- iframe trust boundary;
- localhost and LAN attackers;
- malicious websites attempting DNS rebinding;
- malicious or compromised local agents;
- token leakage;
- oversized requests;
- malformed note content;
- dependency and release-pipeline compromise.

---

## 6.4 Improve Project Presentation

Add:

- screenshots;
- a short recording;
- a diagram showing note-to-celestial-body mapping;
- a diagram showing Obsidian host, iframe renderer, REST/MCP server, and clients;
- a warning label for experimental/early-stage features where appropriate.

---

# 7. Proposed Implementation Sequence

## Phase 1 — Build Integrity

1. Pin Node.js and dependencies.
2. Commit `package-lock.json`.
3. Standardize package scripts.
4. Categorize the existing 33 tests and identify coverage gaps.
5. Add CI.
6. Add version verification.
7. Build release assets from the tag.
8. Publish checksums and build metadata.

**Exit gate:** A clean tagged build is automatically tested, packaged, and traceable to its source commit.

## Phase 2 — Immediate Security Controls

1. Remove the `Math.random()` token fallback.
2. Make header authentication the documented default.
3. Deprecate query tokens with a migration period.
4. Reject query-token authentication in LAN mode.
5. Require authentication for LAN mode.
6. Document unencrypted LAN transport.
7. Add Host/Origin negative tests.
8. Add path-safety, request-size, and no-write tests.
9. Write the initial concise threat model.

**Exit gate:** Stable security invariants are documented and enforced by negative tests.

## Phase 3 — Renderer Maintainability

1. Keep the existing flat source layout unless stronger reasons justify restructuring.
2. Identify the true authoritative renderer source.
3. Generate `src/kosmos-html.ts`.
4. Verify generated output in CI.
5. Mark generated files.
6. Confirm standalone-mode backward compatibility.
7. Perform a bounded iframe-sandbox compatibility experiment.
8. Adopt sandboxing only if its benefit is demonstrated and required functionality is preserved.

**Exit gate:** Standalone and embedded renderer variants cannot drift unnoticed, and the trust model is accurately documented.

## Phase 4 — Operational Maturity

1. Add expanded MCP conformance tests.
2. Add broader benchmarks when the feature set stabilizes.
3. Add optional artifact attestations.
4. Add release, contribution, and security documentation.
5. Complete the threat model after hardening.
6. Add presentation and demonstration assets.
7. Maintain license and attribution checks.

**Exit gate:** A human or agent can trace, rebuild, validate, and review a release with documented security and compatibility assumptions.

# 8. Agent Review Checklist

An automated review agent should verify the following before approving a change.

## Repository and dependencies

- [ ] A lockfile is present and updated only when dependencies change.
- [ ] No dependency uses `"latest"`.
- [ ] The supported Node.js version is declared.
- [ ] `npm ci` succeeds in a clean environment.

## Source and generated artifacts

- [ ] The renderer has one authoritative source.
- [ ] Generated files contain a generated-file notice.
- [ ] `npm run verify:generated` passes.
- [ ] No unexplained large generated diff exists.
- [ ] `main.js` matches the current source build.

## Tests

- [ ] Type checking passes.
- [ ] Unit/integration tests pass.
- [ ] Security tests pass.
- [ ] New behavior has tests.
- [ ] Fixed defects have regression tests.

## Compatibility and lineage

- [ ] Deprecated behavior has a documented replacement and removal version.
- [ ] Existing settings are migrated or compatibility impact is documented.
- [ ] Standalone and embedded renderer modes remain compatible.
- [ ] Upstream attribution and third-party licenses are preserved.
- [ ] Standalone artifacts are checked for embedded sensitive data.

## Security

- [ ] No authentication token is logged.
- [ ] No non-cryptographic random source creates tokens.
- [ ] LAN mode requires authentication.
- [ ] New API routes remain read-only unless a separately reviewed design changes that rule.
- [ ] Host/Origin validation is not weakened.
- [ ] Request-size and output-size limits remain enforced.
- [ ] iframe and `postMessage` changes preserve source and schema validation.

## Release

- [ ] Versions agree across all files.
- [ ] Release assets are built from the tag.
- [ ] Checksums are generated.
- [ ] Build metadata points to the exact commit.
- [ ] The release workflow has minimal permissions.
- [ ] No secret is present in release artifacts.

---

# 9. Definition of Done

The recommended changes should be considered complete when:

1. a clean clone can be installed and built using documented pinned tooling;
2. CI verifies every pull request;
3. both renderer distributions derive from one source;
4. release assets are generated from the release tag;
5. generated artifacts are deterministic or their differences are explained;
6. checksums and source-commit metadata accompany releases;
7. LAN and authentication risks are accurately documented;
8. secure randomness is mandatory for tokens;
9. security controls have negative tests;
10. a human or agent can independently validate that the published plugin corresponds to the reviewed source;
11. backward-incompatible changes include migration guidance;
12. standalone-mode data exposure is documented accurately;
13. attribution and third-party license obligations are verified;
14. iframe isolation claims match demonstrated behavior rather than assumptions.

---

# 10. Repository References

Repository and files reviewed:

- <https://github.com/Odenknight/Kosmos-Oden>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/package.json>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/esbuild.config.mjs>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/src/main.ts>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/src/agent-api.ts>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/test/run.cjs>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/.github/workflows/release.yml>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/README.md>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/AGENT-API.md>
