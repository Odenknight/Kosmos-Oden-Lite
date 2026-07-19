# Vault Kosmos Engineering Assurance Guide

## Build Provenance, Reproducibility, Security Hardening, and Automated Verification

**Project:** Vault Kosmos / Kosmos-Oden  
**Repository version reviewed:** `v0.5.1`  
**Review date:** July 11, 2026  
**Audience:** Maintainers, contributors, release engineers, security reviewers, code agents, and autonomous maintenance agents

---

# 1. Executive Summary

Vault Kosmos is not only a visual Obsidian plugin. It also:

- reads a user's local knowledge vault;
- constructs a temporal and semantic graph;
- exposes that graph through HTTP and MCP;
- bundles a large Three.js renderer;
- distributes prebuilt JavaScript; and
- optionally accepts requests from other machines on a LAN.

Those capabilities create a broader trust surface than a purely visual theme or static plugin.

A user installing `main.js` is trusting that:

1. the binary-like JavaScript artifact came from the claimed source;
2. the source was built using expected tools and dependencies;
3. the release was not substituted or modified;
4. the build was not contaminated by an untracked local file;
5. authentication and network controls work as described;
6. the plugin does not expose more vault data than intended; and
7. future changes do not silently weaken these properties.

Four engineering disciplines address those concerns:

- **Build provenance** answers: *Where did this artifact come from?*
- **Reproducibility** answers: *Can the artifact be rebuilt predictably from the source?*
- **Security hardening** answers: *How is the attack surface reduced and failure made safer?*
- **Automated verification** answers: *How are those properties continuously checked rather than merely intended?*

These disciplines are important for human reviewers and even more important for AI agents. An agent can execute checks consistently, but it requires explicit invariants, deterministic commands, machine-readable evidence, and unambiguous failure conditions.

---

# 2. Why These Controls Matter for Vault Kosmos

## 2.1 The plugin handles sensitive local information

An Obsidian vault may contain:

- personal notes;
- business plans;
- credentials accidentally stored in notes;
- medical or legal notes;
- customer information;
- unpublished research;
- private relationships and links;
- attachments;
- historical note versions; and
- semantic or lineage metadata.

Even though the Agent API is read-only, confidentiality remains important. “Read-only” prevents modification; it does not prevent disclosure.

A security defect in a read-only API can still expose the entire knowledge base.

## 2.2 The plugin ships generated code

Most users do not compile the TypeScript themselves. They install the distributed `main.js`.

Generated code is difficult for a typical user to audit. This creates a source-to-artifact trust gap:

```text
reviewed TypeScript source
          |
          | build process
          v
distributed main.js
```

Without provenance and verification, a user cannot easily prove that the bottom artifact came from the top source.

## 2.3 The renderer is a large embedded payload

A large generated or encoded renderer can hide:

- accidental stale code;
- a mismatched standalone build;
- an unintended dependency;
- an injected network call;
- debugging code;
- development-only behavior; or
- malicious modifications.

This does not imply wrongdoing. It means the artifact is difficult to inspect manually and therefore benefits from stronger automated controls.

## 2.4 The Agent API crosses process and network boundaries

The API accepts external input and returns vault-derived data. In LAN mode it also crosses a machine boundary.

External input can be:

- malformed;
- oversized;
- intentionally adversarial;
- repeated rapidly;
- crafted to exploit parser assumptions;
- sent from a malicious website;
- sent by a compromised local program; or
- sent by an over-permissioned AI agent.

Network-facing code needs explicit negative tests and conservative defaults.

## 2.5 AI agents amplify both capability and risk

MCP support allows agents to query the vault programmatically. This is useful, but agents can:

- make many requests quickly;
- request broader data than a user expected;
- follow links into sensitive notes;
- store returned data elsewhere;
- expose tokens through generated configuration;
- retry malformed calls; or
- be manipulated by content inside notes.

The plugin is not solely responsible for agent behavior, but it should minimize unnecessary exposure and make its trust assumptions clear.

---

# 3. Build Provenance

## 3.1 Definition

Build provenance is evidence describing how a released artifact was produced.

At minimum, provenance should identify:

- project name;
- release version;
- source repository;
- exact Git commit;
- Git tag;
- workflow used;
- runner environment;
- Node.js version;
- package-manager version;
- dependency lockfile;
- build command;
- artifact hashes; and
- whether the source tree was clean.

Provenance does not merely say “this is version 0.5.1.” It says:

> This exact `main.js` was generated from this exact commit, by this workflow, with this dependency graph, using these commands.

## 3.2 Threats addressed by provenance

### Artifact substitution

An attacker or mistake replaces `main.js` while leaving source files unchanged.

### Stale artifact release

Source code is updated, but the committed or uploaded `main.js` was built before the update.

### Local contamination

A maintainer builds with uncommitted files, modified dependencies, or environment-specific inputs.

### Tag mismatch

A release named `v0.5.2` contains source or assets from another commit or version.

### Dependency ambiguity

The same source is built later with different transitive dependencies.

### Compromised release process

A workflow or account uploads artifacts that cannot be traced to the expected build.

## 3.3 Minimum provenance model

Each release should include:

```text
manifest.json
main.js
styles.css
kosmos-iframe.html          optional standalone artifact
SHA256SUMS
BUILD-INFO.json
```

Example `BUILD-INFO.json`:

```json
{
  "schemaVersion": 1,
  "project": "vault-kosmos",
  "version": "0.5.1",
  "repository": "https://github.com/Odenknight/Kosmos-Oden",
  "gitCommit": "FULL_COMMIT_SHA",
  "gitTag": "v0.5.1",
  "workflow": ".github/workflows/release.yml",
  "nodeVersion": "22.17.0",
  "npmVersion": "10.9.2",
  "lockfileSha256": "LOCKFILE_HASH",
  "sourceTreeDirty": false
}
```

Avoid placing volatile metadata such as local usernames, private paths, or secrets in provenance.

## 3.4 Stronger provenance

A stronger model can include:

- GitHub artifact attestations;
- Sigstore signatures;
- SLSA-compatible provenance;
- signed Git tags;
- protected release environments;
- required review for workflow changes;
- branch protection;
- minimal workflow permissions.

## 3.5 Why provenance matters to human reviewers

A reviewer can inspect source and approve a pull request. That review is incomplete if the released artifact can be built elsewhere, modified, or uploaded independently.

Provenance connects code review to what users actually install.

## 3.6 Why provenance matters to agents

An agent can verify:

- hash membership;
- commit identity;
- tag/version agreement;
- workflow origin;
- lockfile identity; and
- whether release metadata is complete.

Without machine-readable provenance, an agent must infer trust from filenames and human prose, which is weak and error-prone.

---

# 4. Reproducibility

## 4.1 Definition

A reproducible build is one where the same source, dependency graph, toolchain, and build inputs produce the same output, ideally byte-for-byte.

There are levels of reproducibility:

### Repeatable

The same machine can rebuild successfully.

### Reproducible

Different clean machines using the specified environment produce equivalent output.

### Bit-for-bit reproducible

The generated bytes and hashes are identical.

Bit-for-bit output is the strongest form, but useful improvements can be made even before perfect byte identity is achieved.

## 4.2 Sources of non-reproducibility

Common causes include:

- dependency ranges;
- `"latest"` dependencies;
- missing lockfiles;
- different Node.js versions;
- different esbuild versions;
- timestamps embedded in output;
- random identifiers;
- environment-dependent paths;
- platform-specific line endings;
- nondeterministic file ordering;
- locale-dependent sorting;
- untracked source files;
- network downloads during build;
- mutable external assets;
- development versus production configuration differences.

## 4.3 Reproducibility requirements for Vault Kosmos

### Pin dependencies

Use tested versions and a committed lockfile.

### Pin the runtime

Declare the Node.js major and, for release builds, use a defined version.

### Build from a clean checkout

Release builds should not depend on a maintainer's workstation.

### Avoid network inputs during build

All build inputs should be represented by the repository and lockfile. The build should not fetch changing remote scripts or renderer assets.

### Normalize generated output

Generation scripts should define:

- UTF-8 encoding;
- line-ending policy;
- deterministic file ordering;
- stable escaping;
- stable serialization; and
- no random output.

### Separate build metadata from executable output

If a build timestamp is useful, place it in `BUILD-INFO.json` rather than embedding it in `main.js`, because timestamps make byte identity impossible.

### Use deterministic renderer generation

The standalone and embedded renderer should be generated from the same source in the same workflow.

## 4.4 Proposed reproducibility test

A CI job can build twice in independent directories:

```bash
git clean -xfd
npm ci
npm run package:release
sha256sum release/* > first.sha256

git clean -xfd
npm ci
npm run package:release
sha256sum release/* > second.sha256

diff -u first.sha256 second.sha256
```

For stronger validation, use separate containers or jobs and compare the resulting artifacts.

## 4.5 When byte-for-byte identity is not achieved

Do not hide the difference. Identify and document it.

Example:

```text
Known non-reproducible field:
- BUILD-INFO.json buildTimeUtc

All executable artifacts are byte-for-byte reproducible.
Release metadata differs only by build timestamp.
```

A tool can also compare normalized artifacts after excluding explicitly volatile metadata.

## 4.6 Why reproducibility matters

Reproducibility detects:

- hidden build inputs;
- stale generated files;
- compromised builders;
- undeclared dependencies;
- inconsistent environments; and
- release-process mistakes.

It also makes future maintenance easier. A new maintainer or agent can rebuild an old version without guessing what “latest” meant at the time.

---

# 5. Security Hardening

## 5.1 Definition

Security hardening is the process of reducing unnecessary capabilities, limiting exposure, validating assumptions, and making failures safe.

Hardening does not assume the system is currently malicious or broken. It recognizes that:

- every interface may receive unexpected input;
- every permission may eventually be misused;
- every default affects user safety;
- every undocumented assumption can become a defect.

## 5.2 Core security objectives

For Vault Kosmos, the primary objectives are:

### Confidentiality

Vault contents should be disclosed only to authorized local or LAN clients.

### Integrity

The plugin should not alter vault notes through the Agent API, and released artifacts should match reviewed source.

### Availability

Malformed or excessive requests should not freeze Obsidian, exhaust memory, or crash the API.

### Least privilege

The renderer, API, and build workflow should have only the capabilities they require.

### Safe defaults

The Agent API remains disabled by default, localhost-only by default, and authenticated by default.

---

## 5.3 Authentication hardening

### Use cryptographic randomness only

Authentication tokens should be generated only with a cryptographically secure random source.

### Prefer headers

Use:

```http
Authorization: Bearer TOKEN
```

or:

```http
X-API-Key: TOKEN
```

Avoid tokens in URLs.

### Fail closed

If secure token generation is unavailable, do not start an externally reachable API with a weak token.

### Protect LAN mode

LAN mode should:

- require authentication;
- prohibit empty-token configuration;
- warn that HTTP is unencrypted;
- preferably support client allowlists or secure tunneling guidance.

### Minimize token display

Display a token only when needed. Avoid persistent full-token rendering in screenshots, logs, and status text.

### Rotate tokens

Provide a clear regeneration process and explain that clients must be updated after rotation.

---

## 5.4 Network hardening

### Keep loopback as the default

`127.0.0.1` is a strong default because it prevents direct access from other machines.

### Treat LAN mode as elevated exposure

LAN mode should require an explicit action and warning.

### Host and Origin validation

These controls should be retained and tested. They help reduce attacks where a malicious web page attempts to reach a local service through the victim's browser.

They do not provide:

- encryption;
- client identity;
- protection from local malware;
- protection from packet observation;
- protection from a compromised authorized agent.

### Rate and concurrency limits

A local agent can accidentally or intentionally make many requests. Add conservative limits for:

- requests per second;
- concurrent requests;
- maximum response size;
- maximum search result count;
- maximum note-body size returned;
- maximum graph traversal depth.

### Timeouts

Apply:

- header timeout;
- request-body timeout;
- overall request timeout;
- graceful cancellation when the client disconnects.

---

## 5.5 Input validation

Every external request should be treated as untrusted.

Validate:

- HTTP method;
- content type;
- body length;
- JSON syntax;
- MCP envelope;
- method name;
- parameter types;
- array sizes;
- timestamps;
- note identifiers;
- traversal depth;
- result limits.

Unknown fields can either be ignored intentionally or rejected. The policy should be consistent.

Use centralized schemas where practical. A lightweight schema library may help, but adding a dependency should be weighed against the current small dependency surface.

---

## 5.6 Output controls

A read-only API can still return too much data.

Consider controls for:

- maximum note content returned;
- pagination;
- maximum search results;
- maximum graph edge count;
- maximum episode-export size;
- optional frontmatter exclusion;
- optional path redaction;
- note or folder deny lists;
- attachment-metadata policy.

A future “agent access scope” setting could allow a user to expose only selected folders. This is not required for the immediate release, but it would materially improve least-privilege access.

---

## 5.7 Iframe and renderer hardening

### Accurate boundary description

The iframe currently separates components, but is not automatically a security sandbox.

### Explicit sandbox evaluation

Test an explicit `sandbox` attribute with the minimum required permissions.

### Message protocol validation

Validate all messages exchanged between host and renderer.

### Capability minimization

The renderer should not need:

- Node.js access;
- Obsidian APIs;
- filesystem access;
- arbitrary top-level navigation;
- remote network access.

If it does not require these, ensure the architecture does not inadvertently grant them.

### Network-free renderer

Automated tests can inspect source and runtime behavior to verify that the renderer does not make unexpected external requests.

---

## 5.8 Dependency and supply-chain hardening

Use:

- lockfile;
- dependency review;
- update automation;
- `npm audit` as an advisory signal;
- GitHub dependency review on pull requests;
- minimal dependencies;
- pinned GitHub Action major versions or commit SHAs for higher assurance;
- restricted workflow permissions.

Do not treat `npm audit` as proof of security. It detects known advisories, not application-level defects.

---

## 5.9 Release-workflow hardening

The release workflow should have:

```yaml
permissions:
  contents: write
```

only where necessary.

CI workflows should generally use:

```yaml
permissions:
  contents: read
```

Additional recommendations:

- protect tags or release environments;
- require review for workflow changes;
- build from the tag;
- do not use untrusted pull-request code with release credentials;
- avoid printing environment variables;
- upload from a clean staging directory;
- publish checksums and provenance.

---

# 6. Automated Verification

## 6.1 Definition

Automated verification converts expectations into executable gates.

A written statement such as “the API is read-only” is useful documentation. An automated test that attempts every supported route and confirms no vault mutation is stronger.

The preferred pattern is:

```text
claim
  |
  +--> invariant
          |
          +--> automated check
                  |
                  +--> required CI gate
```

Example:

```text
Claim: LAN mode always requires authentication.
Invariant: Server startup rejects LAN + no-token configuration.
Check: Automated test starts that configuration and expects failure.
Gate: CI must pass before merge.
```

## 6.2 Verification layers

### Static verification

- TypeScript type checking;
- linting;
- forbidden-pattern scans;
- version checks;
- generated-file markers;
- workflow permission checks.

### Unit verification

- token functions;
- host parsing;
- origin parsing;
- path resolution;
- frontmatter parsing;
- lineage calculations;
- Graphiti serialization.

### Integration verification

- real HTTP server on loopback;
- REST requests;
- MCP requests;
- auth failures;
- body limits;
- port conflicts;
- simulated vault changes.

### Artifact verification

- regenerate `main.js`;
- compare generated files;
- inspect release contents;
- calculate hashes;
- verify provenance.

### Runtime verification

- load the plugin in a test Obsidian environment if feasible;
- open the view;
- send host-renderer messages;
- verify no network calls;
- exercise visibility suspension;
- test mobile gating.

### Security regression verification

Every security defect should produce a test that would have failed before the fix.

---

## 6.3 Recommended CI jobs

### Job 1: Source validation

```text
npm ci
npm run typecheck
npm test
```

### Job 2: Generated-artifact validation

```text
npm run generate:renderer
npm run build
git diff --exit-code
```

This detects stale committed outputs.

### Job 3: Reproducibility

Build in two clean environments and compare executable artifact hashes.

### Job 4: Security tests

Run targeted tests for:

- authentication;
- Host/Origin checks;
- request limits;
- invalid MCP calls;
- LAN configuration;
- path traversal;
- output limits.

### Job 5: Release simulation

Create the release staging directory without publishing it, then verify:

- required files exist;
- no unexpected files exist;
- versions agree;
- checksums validate;
- source commit is recorded;
- bundle size is within expected limits.

---

## 6.4 Example invariant file

Agents benefit from a machine-readable policy file:

```yaml
schema: 1

project:
  name: vault-kosmos

release:
  required_files:
    - manifest.json
    - main.js
    - styles.css
    - SHA256SUMS
    - BUILD-INFO.json
  forbidden_files:
    - .env
    - "*.pem"
    - "*.key"

security:
  agent_api_default_enabled: false
  default_bind_mode: localhost
  lan_requires_token: true
  query_tokens_allowed: false
  api_write_routes_allowed: false
  max_request_bytes: 4194304

build:
  lockfile_required: package-lock.json
  clean_tree_required: true
  generated_files:
    - main.js
    - src/generated/kosmos-html.ts
    - kosmos-iframe.html
```

A verification script can enforce this policy.

---

## 6.5 Human review and agent review should complement each other

Automation is strong at:

- consistency;
- exhaustive repetition;
- hash comparison;
- schema validation;
- detecting known forbidden patterns;
- running regression suites.

Humans are stronger at:

- architectural judgment;
- identifying misleading claims;
- evaluating usability;
- recognizing unexpected capability expansion;
- deciding whether a security tradeoff is acceptable.

AI agents can assist both, but should not be the sole approval authority for security-sensitive workflow or authentication changes.

Recommended approval policy:

- routine documentation: one human or trusted agent;
- generated artifact updates: automated checks plus source review;
- authentication/network changes: human security review required;
- release-workflow changes: maintainer review required;
- introduction of write endpoints: explicit architectural decision and threat-model update.

---

# 7. Proposed Assurance Architecture

```text
Developer or Agent Change
           |
           v
       Pull Request
           |
           +--> Type Check
           +--> Unit Tests
           +--> API Integration Tests
           +--> Security Negative Tests
           +--> Renderer Generation
           +--> Generated Diff Check
           +--> Version Check
           +--> Dependency Review
           +--> Release Simulation
           |
           v
      Human Review Gate
           |
           v
        Merge to Main
           |
           v
      Signed/Protected Tag
           |
           v
      Clean Release Build
           |
           +--> npm ci from lockfile
           +--> full verification
           +--> deterministic package
           +--> SHA-256 checksums
           +--> BUILD-INFO provenance
           +--> optional attestation
           |
           v
       GitHub Release
           |
           v
 User or Agent Independently Verifies
```

---

# 8. Suggested Verification Commands

A human or agent should be able to run:

```bash
npm ci
npm run verify
npm run package:release
sha256sum -c release/SHA256SUMS
```

For a committed-artifact model:

```bash
npm ci
npm run generate:renderer
npm run build
git diff --exit-code -- \
  main.js \
  kosmos-iframe.html \
  src/generated/kosmos-html.ts
```

For release verification:

```bash
jq . release/BUILD-INFO.json
sha256sum -c release/SHA256SUMS
```

An independent verifier can:

1. check out the commit named in `BUILD-INFO.json`;
2. install from the lockfile;
3. rebuild;
4. compare artifact hashes;
5. report any differences.

---

# 9. Failure Policy

Controls are meaningful only when failure has a defined consequence.

## Fail the build when

- type checking fails;
- tests fail;
- generated files drift;
- versions disagree;
- required release files are missing;
- forbidden files are present;
- secure token generation is unavailable in tested startup paths;
- LAN mode can start without authentication;
- checksums do not validate.

## Warn, but do not necessarily fail, when

- bundle size increases within a small threshold;
- a low-severity dependency advisory appears;
- benchmark performance regresses slightly;
- documentation links are temporarily unavailable.

## Require explicit review when

- bundle size changes substantially;
- a new dependency is added;
- a new network route is added;
- API output scope expands;
- an iframe permission is added;
- workflow permissions increase;
- query-token authentication is reintroduced;
- a write capability is proposed.

---

# 10. Measures of Success

The assurance program is working when:

- a release artifact can be traced to one commit;
- a clean build can recreate the executable artifact;
- generated renderer outputs cannot silently diverge;
- a dependency upgrade appears as a reviewed lockfile change;
- security defaults are tested, not merely documented;
- malicious or malformed requests produce bounded failures;
- users receive an explicit warning before LAN exposure;
- tokens do not appear in routine logs or URLs;
- release checksums verify;
- agents can perform deterministic review using documented commands;
- maintainers can explain every file in a release package.

---

# 11. Recommended Initial Milestone

The first assurance milestone should not attempt every possible control. A practical first milestone is:

1. Commit `package-lock.json`.
2. Pin `obsidian`, `esbuild`, and `typescript`.
3. Add `npm test`.
4. Add CI for typecheck, tests, and production build.
5. Add deterministic renderer generation.
6. Fail CI when generated artifacts drift.
7. Remove the `Math.random()` token fallback.
8. Require auth in LAN mode.
9. Build releases from tags using `npm ci`.
10. Publish `SHA256SUMS` and `BUILD-INFO.json`.

This milestone closes the largest source-to-release trust gaps while preserving the project's current architecture.

---

# 12. Final Rationale

Build provenance, reproducibility, security hardening, and automated verification are sometimes treated as enterprise bureaucracy. For Vault Kosmos, they are practical safeguards.

The plugin combines:

- private local data;
- generated executable code;
- a large embedded renderer;
- local networking;
- AI-agent access;
- knowledge-graph exports; and
- a young release process.

That combination makes trust traceability important even for a small open-source project.

The goal is not to burden development. The goal is to ensure that:

- the code reviewed is the code released;
- the release can be independently rebuilt;
- security properties cannot silently regress;
- human maintainers receive clear failures instead of hidden drift;
- AI agents have explicit rules they can verify; and
- users can trust a local-first tool with local-first data.

These controls should be introduced incrementally, kept understandable, and automated wherever possible.

---

# 13. Repository References

- <https://github.com/Odenknight/Kosmos-Oden>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/package.json>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/esbuild.config.mjs>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/src/main.ts>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/src/agent-api.ts>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/test/run.cjs>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/.github/workflows/release.yml>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/README.md>
- <https://github.com/Odenknight/Kosmos-Oden/blob/main/AGENT-API.md>
