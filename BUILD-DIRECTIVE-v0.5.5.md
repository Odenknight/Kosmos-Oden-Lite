# BUILD DIRECTIVE — Vault Kosmos v0.5.5 Correctness, Standalone Runtime, Temporal Lineage, Incremental Indexing, Security, Testing, and Documentation Rebuild

**Repository:** `Odenknight/Kosmos-Oden`
**Target release:** `v0.5.5`
**Current baseline:** `v0.5.1`
**Primary objective:** Correct the architectural and documentation issues identified during external review while preserving the existing visual experience and Obsidian plugin functionality.

---

# 1. Mission

Rebuild Vault Kosmos so that the implementation, public README claims, standalone experience, temporal lineage model, Agent API, MCP compatibility, Graphiti export, incremental update behavior, and automated tests are mutually consistent and technically defensible.

This is not a cosmetic README update.

The rebuild must:

1. Fix the lineage and temporal-validity correctness issues.
2. Make lineage relationships canonical and automatically bidirectional internally.
3. Make the standalone HTML file genuinely usable without Obsidian, Node.js, a local web server, or an internet connection.
4. Allow the standalone HTML file to open a directory containing an Obsidian vault or Markdown knowledge base.
5. Recursively discover notes, folders, and supported attachments.
6. Render the directory using the same Kosmos classification and layout semantics as the Obsidian plugin.
7. Detect additions, removals, edits, and newly created folders when persistent browser directory access is available.
8. Provide graceful fallback behavior where persistent directory handles are unavailable.
9. Eliminate unnecessary full-graph reparsing for a single-note metadata or content change where practical.
10. Tighten MCP protocol negotiation.
11. Harden token generation.
12. Make testing reproducible from a clean checkout.
13. Add CI that builds, type-checks, tests, and verifies the standalone artifact.
14. Correct every README claim that currently exceeds what the implementation can prove.
15. Preserve local-first and offline operation.

Do not remove functioning v0.5.1 capabilities in order to simplify the rebuild.

---

# 2. Non-Negotiable Architectural Principles

## 2.1 Local-first

The primary visualization must make no external network request.

The following must be bundled into the distributed artifacts:

* Three.js runtime
* parser
* graph builder
* temporal projector
* cosmology classifier
* layout engine
* renderer
* standalone directory loader
* standalone incremental scanner
* all required CSS
* all required JavaScript

No CDN dependency is permitted for the normal plugin or standalone viewer.

The standalone artifact must function when opened directly from disk as:

```text
file:///path/to/vault-kosmos.html
```

where browser security capabilities permit local directory selection.

---

## 2.2 One graph semantics implementation

Do not maintain substantially different knowledge semantics in:

* `src/agent-api.ts`
* `kosmos-iframe.html`
* standalone build logic
* Graphiti exporter
* future tests

Extract shared graph semantics into reusable modules.

At minimum, centralize:

```text
Markdown parsing
OKF+ parsing
link resolution
canonical lineage resolution
temporal validity calculation
HEAD determination
semantic Related links
graph node construction
graph edge construction
Graphiti episode generation
```

Recommended source layout:

```text
src/
  core/
    types.ts
    paths.ts
    markdown.ts
    okf.ts
    resolver.ts
    lineage.ts
    temporal.ts
    graph.ts
    graphiti.ts
    incremental-index.ts

  renderer/
    cosmology.ts
    layout.ts
    renderer.ts
    interactions.ts

  plugin/
    main.ts
    agent-api.ts
    settings.ts

  standalone/
    standalone.ts
    directory-source.ts
    directory-monitor.ts
    persistence.ts
    ui.ts
```

The exact naming may change, but semantic duplication must be reduced.

---

# 3. Fix Canonical Lineage Semantics

## 3.1 Current defect

The existing implementation can calculate invalidation incorrectly when only one side of a lineage relationship is authored.

Example:

```yaml
# Engine v2
supersedes:
  - Engine v1
```

If `Engine v1` does not explicitly contain:

```yaml
superseded_by:
  - Engine v2
```

the old implementation may fail to derive the invalidation timestamp of `Engine v1`.

This is not acceptable.

---

## 3.2 Canonical internal model

Internally, represent lineage as one canonical directed relationship:

```text
NEWER --supersedes--> OLDER
```

From that canonical relationship automatically derive the inverse projection:

```text
OLDER --superseded_by--> NEWER
```

Users may author either:

```yaml
supersedes:
  - Engine v1
```

or:

```yaml
superseded_by:
  - Engine v2
```

or both.

The indexer must normalize all valid declarations into the same canonical lineage graph.

---

## 3.3 Required lineage normalization algorithm

For every parsed note:

1. Resolve each `supersedes` reference.
2. Create:

```text
current_note -> older_note
```

3. Resolve each `superseded_by` reference.
4. Convert it into the same canonical direction:

```text
newer_note -> current_note
```

5. Deduplicate canonical lineage edges.
6. Derive forward and reverse adjacency maps from the canonical edge set.

The derived model should expose:

```text
supersedesPaths[]
supersededByPaths[]
```

but these should be projections of the canonical lineage graph rather than independently trusted source fields.

---

## 3.4 Temporal invalidation

For each note:

```text
valid_at = OKF+ timestamp
```

or a documented fallback timestamp when no valid OKF+ timestamp exists.

For each note with successors:

```text
invalid_at = earliest valid_at of any direct successor
```

A note is current when:

```text
invalid_at == null
```

A lineage note is HEAD when:

```text
it participates in a lineage
AND
it has no successor
```

Do not calculate HEAD from whether a note happens to contain a specific frontmatter field.

---

## 3.5 Lineage validation

Detect and report:

* self-supersession
* cycles
* unresolved lineage targets
* multiple direct successors
* successor timestamps earlier than predecessor timestamps
* ambiguous title resolution
* duplicate declarations

Do not silently destroy the graph when malformed lineage exists.

Expose warnings through:

* developer console
* Agent API diagnostics
* optional UI diagnostics panel
* test assertions

---

# 4. Clarify the Temporal Model

Vault Kosmos v0.5.5 must not describe its current note model as fully bitemporal unless true transaction-time history is actually implemented.

The current required model is:

```text
temporal validity intervals
```

Each note has:

```text
valid_at
invalid_at
```

This supports:

```text
What note versions were represented as valid at time T?
```

It does not automatically reconstruct every historical edit ever made to one Markdown file.

---

## 4.1 Point-in-time graph semantics

For time `T`:

```text
not_yet_created:
    valid_at > T

valid:
    valid_at <= T
    AND
    (
      invalid_at == null
      OR
      invalid_at > T
    )

superseded_at_T:
    invalid_at != null
    AND
    invalid_at <= T
```

The following must use the same projector:

* Chrono view
* Agent API `graph_at_time`
* standalone Chrono view
* temporal tests

Do not maintain separate temporal algorithms.

---

## 4.2 Preserve current content limitations honestly

The system may reconstruct retained version history represented by:

* timestamps
* supersession chains
* separate historical notes

It must not claim to reconstruct an edit that was overwritten in place and no longer exists.

---

# 5. Build a True Standalone HTML Runtime

Create a distributable file:

```text
vault-kosmos.html
```

The user must be able to:

1. Download the file.
2. Double-click it.
3. Open it in a compatible modern browser.
4. Click:

```text
Open Knowledge Folder
```

5. Select a directory containing Markdown notes.
6. Have Vault Kosmos recursively scan and render the directory.

No Obsidian installation may be required.

No Node.js installation may be required.

No Python installation may be required.

No local HTTP server may be required.

No internet connection may be required.

---

# 6. Standalone Directory Selection

Implement progressive directory access.

## 6.1 Preferred path: persistent directory handle

When the browser supports direct directory handles:

```javascript
showDirectoryPicker()
```

use it.

The selected directory becomes the standalone knowledge source.

Recursively enumerate:

* directories
* Markdown files
* supported attachments

Supported note extensions should include at minimum:

```text
.md
.markdown
```

Only include other note-like formats when explicitly supported by the parser.

---

## 6.2 Fallback path

Where persistent directory handles are unavailable, provide a directory input fallback such as:

```html
<input
  type="file"
  webkitdirectory
  directory
  multiple
>
```

The fallback must still:

* recursively receive selected files
* infer relative directory structure
* build the graph
* render the full cosmos

Clearly distinguish runtime capabilities:

```text
Persistent folder access enabled
```

versus:

```text
Imported folder snapshot
```

Do not imply automatic disk monitoring when the browser has only provided a static file selection.

---

# 7. Standalone Folder Persistence

Where browser permissions permit, persist the selected directory handle locally.

Use local browser storage appropriate for structured handles, preferably:

```text
IndexedDB
```

On subsequent startup:

1. Look for a stored directory handle.
2. Check permission state.
3. Ask the user to restore permission when required.
4. Offer:

```text
Reopen Last Folder
```

5. Never silently access a directory without browser authorization.

Provide:

```text
Forget Folder
```

to remove the persisted handle.

Do not store note contents unnecessarily in persistent browser storage.

---

# 8. Standalone Recursive Scanner

Implement a recursive directory scanner that produces a source-neutral snapshot.

Recommended internal representation:

```typescript
interface SourceFile {
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedTime?: number;
  content?: string;
  kind: "note" | "attachment";
}
```

Recommended directory representation:

```typescript
interface SourceDirectory {
  relativePath: string;
}
```

The scanner must:

1. Recursively enumerate directories.
2. Ignore known metadata folders where appropriate.

At minimum:

```text
.obsidian
.git
node_modules
```

Allow ignore rules to be configurable later.

3. Read Markdown content.
4. Record attachment paths without necessarily loading attachment binary content.
5. Generate deterministic relative paths.
6. Normalize path separators to `/`.

---

# 9. Detect New Folders and Files

The standalone runtime must update when the underlying directory changes where the browser directory API permits repeated access.

Do not depend on a nonstandard filesystem watcher as the only mechanism.

Implement a resilient rescan-and-diff monitor.

---

## 9.1 Snapshot signatures

Maintain an in-memory filesystem snapshot such as:

```text
relative path
entry type
size
last modified time
```

On rescan, calculate:

```text
added files
changed files
removed files
added directories
removed directories
possible renames
```

A rename may be treated as delete + create when reliable rename detection is unavailable.

Correctness is more important than speculative rename inference.

---

## 9.2 Rescan triggers

When persistent directory access exists, rescan:

* after initial folder selection
* when the browser window regains focus
* when the page becomes visible again
* when the user clicks `Rescan`
* on a configurable low-frequency polling interval while visible

Recommended initial polling behavior:

```text
Visible:
  approximately every 2–5 seconds

Hidden:
  suspend polling

On visibility restore:
  immediate rescan
```

Do not continuously hammer the filesystem.

---

## 9.3 New folder behavior

When a new folder is discovered:

1. Add it to the directory index.
2. Scan all supported descendants.
3. Determine its top-level galaxy assignment.
4. Add any newly discovered notes and attachments.
5. Recalculate affected graph topology.
6. Update the visualization.

If a new top-level folder appears, it must automatically become a new galaxy according to the existing Kosmos specification.

---

# 10. Standalone Incremental Update Pipeline

Do not rebuild everything unnecessarily.

Use an incremental source/index architecture.

Recommended stages:

```text
Filesystem Snapshot
        ↓
Source Diff
        ↓
Changed Note Parsing
        ↓
Resolver Update
        ↓
Affected Edge Reconciliation
        ↓
Lineage Projection
        ↓
Temporal Projection
        ↓
Graph Diff
        ↓
Renderer Update
```

---

## 10.1 Note content cache

Maintain:

```text
path -> parsed note
path -> content hash
path -> file metadata
```

When a note changes:

1. Read only that note.
2. Parse only that note.
3. Update its node metadata.
4. Remove its prior outgoing edges.
5. Recalculate its outgoing edges.
6. Recalculate backlinks affected by those edges.
7. Recalculate any lineage relationships involving that note.
8. Recalculate any semantic relationships involving that note.
9. Update affected temporal projections.
10. Produce a graph delta.

Do not parse the complete vault on every single-note edit unless a structural condition makes a full rebuild necessary.

---

## 10.2 Structural changes

A broader rebuild may be triggered for:

* massive imports
* mass deletion
* widespread rename operations
* resolver corruption
* parser version migration
* major settings changes

Document the threshold.

---

# 11. Renderer Update Strategy

The renderer must distinguish:

```text
metadata-only changes
visual classification changes
topology changes
full source replacement
```

Examples:

### Metadata-only

```text
title
tags
status
type
timestamp that does not alter topology
```

Update in place where practical.

### Topology

```text
new note
deleted note
new link
removed link
lineage change
new folder
removed folder
```

Perform a controlled relayout.

### Major structural rebuild

Rebuild the scene only when justified.

---

# 12. Collision and Layout Claims

Preserve the existing hierarchical packing and collision-resolution system.

Add a final diagnostic pass:

```text
detect remaining body intersections
```

The diagnostic should:

1. Count residual intersections.
2. Attempt a bounded corrective separation pass.
3. Record unresolved collisions in development/debug mode.

Do not promise mathematically impossible universal zero-overlap unless an invariant is actually proven.

The README should describe the layout as:

```text
hierarchical packing and collision-resolution designed to keep bodies separated and minimize overlap
```

---

# 13. Graphiti Export Corrections

Preserve the current valid export structure:

```text
name
episode_body
source
source_description
reference_time
group_id
```

Continue generating:

```text
EpisodeType.json
```

compatible data.

---

## 13.1 Canonical lineage export

Export normalized lineage, not merely raw frontmatter.

The episode body should contain:

```json
{
  "supersedes": [],
  "superseded_by": []
}
```

derived from the canonical lineage graph.

Optionally preserve raw declarations separately:

```json
{
  "source_okf": {
    "declared_supersedes": [],
    "declared_superseded_by": []
  }
}
```

This makes the distinction between:

```text
what the author declared
```

and:

```text
what the system resolved
```

explicit.

---

## 13.2 Do not overclaim deterministic Graphiti reconstruction

The export may state:

```text
Graphiti-ingestable episode format
```

and:

```text
OKF+ lineage metadata is preserved in the JSON episode body
```

Do not claim that Graphiti is guaranteed to reconstruct the exact same internal lineage graph unless an integration test proves that behavior.

---

# 14. Restore or Replace `kosmos-build.mjs`

The README currently documents:

```bash
node kosmos-build.mjs ...
```

but the script is missing.

Choose one of the following.

## Preferred option

Restore a real:

```text
kosmos-build.mjs
```

that uses the same shared parser and graph semantics as the plugin and standalone viewer.

It should support:

```bash
node kosmos-build.mjs /path/to/vault graph.json
```

and:

```bash
node kosmos-build.mjs /path/to/vault graph.json \
  --episodes graphiti-episodes.json
```

Optional:

```bash
--watch
```

may monitor filesystem changes when executed under Node.js.

The script must not contain a separate incompatible graph implementation.

---

# 15. MCP Protocol Negotiation

Do not blindly echo an arbitrary client-provided protocol version.

Define explicit supported protocol versions.

Example:

```typescript
const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  "2025-03-26"
];
```

Adjust the exact supported set according to the implementation actually tested.

During `initialize`:

1. Read the client's requested version.
2. Determine whether it is supported.
3. Respond with a version the server actually implements.
4. Reject or handle unsupported versions according to MCP requirements.
5. Never claim support for an unknown future protocol version.

Add tests for:

```text
supported version
unsupported version
missing version
initialized notification
tools/list
tools/call
```

---

# 16. Authentication Hardening

Token generation must require a cryptographically secure random source.

Remove the `Math.random()` authentication-token fallback.

Preferred behavior:

```text
crypto.getRandomValues available:
    generate token

cryptographic RNG unavailable:
    fail token creation safely
    report a clear error
```

Use sufficient entropy.

Recommended:

```text
32 random bytes
```

encoded as:

```text
hex
```

or:

```text
base64url
```

Never silently downgrade authentication security.

---

# 17. Security Language and Implementation

Retain:

* localhost default
* opt-in LAN binding
* authentication
* Host validation
* Origin validation
* request-size limits
* no write endpoints in Agent API

Improve request limiting by counting actual bytes rather than JavaScript character count where practical.

Use a byte accumulator for request bodies.

Example concept:

```text
received_bytes += Buffer.byteLength(chunk)
```

Reject when:

```text
received_bytes > configured_limit
```

Keep the default approximately:

```text
4 MiB
```

Document the exact unit used.

---

# 18. Clarify Read-Only Behavior

The system has two different categories of operation.

## Read-only operations

These must never modify existing notes:

```text
3D visualization
directory scanning
Agent API
MCP queries
REST queries
Chrono projection
Graphiti episode generation in memory
```

## Explicit file-producing commands

These may create new files:

```text
AGENT-API.md
graphiti-episodes.json
graphiti-ingest-sample.py
graph.json
```

The README must state this accurately.

Never claim:

```text
Vault Kosmos never writes anything to the vault
```

when explicit export commands can create files.

Use:

```text
Visualization and Agent API queries never modify existing notes. Optional export and setup commands create explicitly named output files.
```

---

# 19. True Standalone User Interface

The standalone HTML page must have a clear startup experience.

Required startup controls:

```text
Open Knowledge Folder
Reopen Last Folder
Open Folder Snapshot
Load Demo
```

Only show controls supported by the current browser.

---

## 19.1 Status panel

Display:

```text
Source
Folder name
Notes indexed
Folders indexed
Attachments indexed
Unresolved links
Lineage chains
HEAD notes
Superseded notes
Last scan
Monitoring status
```

Example:

```text
Source: MyVault
Mode: Persistent folder access
Monitoring: Active
Last scan: 3 seconds ago
```

---

## 19.2 Rescan controls

Provide:

```text
Rescan Now
Pause Monitoring
Resume Monitoring
Forget Folder
```

---

## 19.3 Errors

Render usable errors inside the page rather than only in the browser console.

Examples:

```text
Folder permission lost
Could not read file
Malformed frontmatter
Ambiguous note title
Lineage cycle detected
Unsupported browser capability
```

The visualization should continue where possible.

---

# 20. HTMX Usage

Use HTMX only where it improves declarative UI behavior.

Do not introduce:

* a mandatory web server
* CDN dependencies
* external network calls
* server-side fragments merely to justify using HTMX

The standalone application is fundamentally a local client-side application.

Appropriate possible uses include:

```text
settings panel swaps
diagnostics panel fragments
status panel refresh behavior
modal content replacement
declarative local UI actions
```

However, core operations must remain native application logic:

```text
filesystem access
recursive scanning
graph parsing
graph indexing
lineage normalization
temporal projection
Three.js rendering
incremental updates
```

If HTMX is used:

1. Bundle it locally into the generated single-file artifact.
2. Do not use a CDN.
3. Do not make the standalone viewer dependent upon network access.
4. Do not add HTMX where native DOM code is clearer.

HTMX is optional where useful, not an architectural requirement.

---

# 21. Build the Standalone Artifact as a Real Single File

The source should remain modular.

The release artifact should be:

```text
vault-kosmos.html
```

containing all runtime dependencies.

Recommended build process:

```text
modular TypeScript source
        ↓
bundle
        ↓
inline JavaScript
inline CSS
inline Three.js
        ↓
vault-kosmos.html
```

The source HTML used during development does not have to be one giant manually maintained file.

The generated artifact must be one file.

Add a build command such as:

```bash
npm run build:standalone
```

---

# 22. Preserve the Obsidian Plugin

The Obsidian plugin must continue to work using:

```text
manifest.json
main.js
styles.css
```

The plugin and standalone page should consume the same core graph semantics.

Do not turn the Obsidian plugin into a wrapper around an external website.

The plugin must remain local and self-contained.

---

# 23. Testing Rebuild

A clean checkout must support:

```bash
npm ci
npm run typecheck
npm run build
npm test
```

No manually generated untracked file may be required.

Fix the current test dependency on a missing:

```text
test/agent-api.cjs
```

Either:

1. compile test-target code automatically before running tests, or
2. run tests directly against bundled/transpiled TypeScript.

---

# 24. Required Unit Tests

Add tests for:

## Parser

```text
frontmatter
aliases
tags
wikilinks
markdown links
Related footer
attachments
invalid timestamps
```

## Link resolver

```text
path
path without extension
basename
alias
ambiguous basename
unresolved links
```

## Canonical lineage

```text
supersedes only
superseded_by only
both fields
duplicate declarations
self-reference
cycle
unresolved target
multiple successors
```

Critical test:

```text
Engine v2 supersedes Engine v1
```

with no reverse field on v1 must still produce:

```text
v1.superseded_by = v2
v1.invalid_at = v2.valid_at
v2.head = true
```

---

## Temporal projection

Test:

```text
before predecessor exists
predecessor valid
successor appears
predecessor superseded
successor HEAD
```

---

## Incremental indexing

Test:

```text
edit one note
add one note
delete one note
rename one note
add folder
remove folder
add attachment
delete attachment
change lineage
change Related footer
```

Verify unaffected notes are not reparsed unnecessarily.

---

## Graphiti export

Test:

```text
required fields
chronological ordering
group_id
canonical lineage fields
valid reference_time
JSON episode body
```

---

## Agent API

Test:

```text
no token
wrong token
Bearer token
x-api-key
query token if retained
Host rejection
Origin rejection
request-size rejection
REST GET routes
REST write rejection
MCP initialize
unsupported MCP protocol
tools/list
tools/call
```

---

# 25. Standalone Automated Tests

Create browser-level tests for the standalone artifact.

At minimum verify:

```text
standalone HTML builds
standalone HTML has no external runtime URL dependencies
demo graph renders
folder snapshot import works
new note can be incrementally applied
new folder becomes a galaxy
deleted note disappears
lineage normalization works
Chrono filtering works
```

Where browser automation can provide a directory handle, test the persistent path.

Where it cannot, test the directory snapshot fallback.

---

# 26. Performance Benchmarks

Do not claim performance improvements without measurements.

Create reproducible synthetic vault fixtures for at least:

```text
100 notes
1,000 notes
5,000 notes
10,000 notes
```

Measure:

```text
initial scan time
parse time
graph build time
layout time
scene build time
single-note update time
new-folder update time
memory usage where available
```

Optional:

```text
25,000 notes
50,000 notes
```

Do not make large-vault performance claims unless the benchmark supports them.

---

# 27. Hidden-View Performance Test

Retain the existing render suspension.

Add a test or diagnostic proving:

```text
visible:
    requestAnimationFrame active

hidden:
    requestAnimationFrame halted

visible again:
    rendering resumes
```

README wording should state:

```text
The render loop is suspended while the Kosmos view is hidden.
```

Do not claim quantified battery savings unless benchmarked.

---

# 28. CI Pipeline

GitHub Actions must run on:

```text
push
pull_request
```

Required jobs:

```text
npm ci
npm run typecheck
npm run build
npm run build:standalone
npm test
```

Add checks that:

```text
main.js exists
vault-kosmos.html exists
manifest version matches package version
versions.json is updated
standalone file contains no unexpected external runtime dependency
```

The release workflow should run only after validation succeeds.

---

# 29. Version Synchronization

For v0.5.5 update consistently:

```text
package.json
manifest.json
versions.json
Agent API serverInfo
README
AGENT-API.md
release notes
```

Avoid hardcoding the version independently in multiple files where possible.

Prefer a shared build-time version source.

---

# 30. README Rewrite Requirements

After the implementation is complete, rewrite the README against the code that actually exists.

Use these accuracy rules.

---

## Allowed claim

```text
Vault Kosmos uses hierarchical packing and collision-resolution passes to keep visual bodies separated.
```

Do not use:

```text
No two bodies ever overlap.
```

unless proven as an invariant.

---

## Allowed claim

```text
OKF+ notes support temporal validity intervals and point-in-time graph reconstruction based on retained timestamps and supersession history.
```

Do not use:

```text
See exactly everything you knew at any past date.
```

---

## Allowed claim

```text
Lineage declarations are normalized internally so supersedes and superseded_by are projected bidirectionally.
```

This claim may be added only after the code is fixed.

---

## Allowed claim

```text
Graphiti-compatible episode exports preserve OKF+ structure and are ordered chronologically for ingestion.
```

Do not guarantee Graphiti will infer the exact same knowledge graph unless integration testing proves that claim.

---

## Allowed claim

```text
Visualization and Agent API queries do not modify existing notes.
```

Then explicitly document output-producing commands.

---

## Allowed claim

```text
The standalone HTML viewer can open a Markdown knowledge directory directly in supported browsers and can import a directory snapshot in browsers using the fallback picker.
```

Document the distinction between:

```text
persistent monitored folder
```

and:

```text
imported snapshot
```

---

# 31. Standalone README Instructions

Add a section:

```text
Standalone — No Obsidian Required
```

Example workflow:

```text
1. Download vault-kosmos.html.
2. Open it in your browser.
3. Click Open Knowledge Folder.
4. Select the root of your Markdown or Obsidian vault.
5. Kosmos recursively scans and renders the folder.
6. Where persistent directory access is supported, Kosmos rescans for changes while the page remains open.
```

Also explain fallback mode.

---

# 32. Diagnostics API

Add an internal diagnostic structure.

Recommended:

```typescript
interface KosmosDiagnostics {
  notes: number;
  folders: number;
  attachments: number;
  unresolvedLinks: number;
  ambiguousLinks: number;
  lineageEdges: number;
  lineageCycles: number;
  lineageWarnings: string[];
  residualCollisions: number;
  lastFullBuildMs?: number;
  lastIncrementalUpdateMs?: number;
}
```

Expose diagnostics:

* in debug mode
* through Agent API overview or a dedicated diagnostics route
* through the standalone diagnostics panel

Do not expose secrets.

---

# 33. Agent API Read Consistency

The Agent API and visible cosmos must use the same normalized graph snapshot.

Do not independently rebuild incompatible graph interpretations.

An Agent API query such as:

```text
get_lineage
```

must return the same lineage the viewer displays.

Likewise:

```text
graph_at_time
```

must use the same temporal projector as Chrono.

---

# 34. Standalone Graphiti Export

The standalone HTML page should allow:

```text
Export Graph JSON
Export Graphiti Episodes
```

Use browser download generation.

Do not require filesystem write permission merely to export a file.

Optional:

```text
Save Into Selected Folder
```

may be added later as an explicit write action, but it must never occur silently.

---

# 35. User Data Safety

The standalone directory scanner must be read-only.

Do not:

```text
rename
delete
modify
rewrite
normalize
move
or patch
```

user source notes.

Any future write capability must be separately permissioned and clearly visible.

---

# 36. Preserve Existing Major Features

The rebuild must preserve, unless a documented defect requires correction:

```text
3D cosmos
cluster core
folder galaxies
stars
planets
moons
moonlets
asteroids
Oort objects
planetary rings
search
filters
focus mode
overview mode
free flight
timeline
growth animation
Chrono
minimap
Agent traversal trail
REST Agent API
MCP tools
Graphiti export
mobile rendering path
adaptive quality
hidden-view render suspension
```

---

# 37. Required Deliverables

The completed repository should contain at minimum:

```text
README.md
AGENT-API.md
LICENSE

manifest.json
versions.json
package.json

src/
  shared core modules
  plugin modules
  standalone modules

main.js
styles.css

vault-kosmos.html

kosmos-build.mjs

test/
  unit tests
  API tests
  lineage tests
  temporal tests
  incremental-index tests
  standalone tests

.github/
  workflows/
    ci.yml
    release.yml
```

Generated artifacts may differ in exact location, but the release process must be reproducible.

---

# 38. Definition of Done

The rebuild is not complete until all of the following are true.

### Correctness

* One-sided `supersedes` declarations correctly invalidate predecessors.
* One-sided `superseded_by` declarations correctly produce canonical lineage.
* HEAD status is derived correctly.
* Chrono and Agent API use identical temporal semantics.
* Lineage cycles and unresolved targets are detected.

### Standalone

* `vault-kosmos.html` opens directly without a server.
* No internet connection is required.
* User can select a directory.
* Directory contents recursively render.
* New top-level folders become galaxies.
* New notes appear after rescan.
* Deleted notes disappear.
* Persistent folder monitoring works where the browser provides a persistent directory handle.
* Snapshot fallback works where persistent handles are unavailable.
* The page clearly identifies which mode is active.

### Incremental behavior

* Editing one note does not require rereading every note from disk.
* Adding one folder does not require rereading all unchanged note contents.
* Graph deltas update the visualization correctly.

### Security

* Secure token generation has no insecure random fallback.
* Unsupported MCP versions are not falsely accepted.
* Host/Origin protections remain.
* Request byte limits are enforced.

### Testing

A clean checkout succeeds with:

```bash
npm ci
npm run typecheck
npm run build
npm run build:standalone
npm test
```

### CI

A pull request cannot pass validation unless:

```text
type checking passes
plugin build passes
standalone build passes
tests pass
artifact checks pass
```

### Documentation

* No missing script is documented.
* No unsupported absolute performance claim remains.
* No false universal no-overlap guarantee remains.
* No false full-bitemporal claim remains.
* No false claim that the entire plugin never creates files remains.
* Standalone browser capabilities and limitations are accurately documented.

---

# 39. Final Engineering Standard

Treat Vault Kosmos v0.5.5 as three products sharing one semantic engine:

```text
                    ┌─────────────────────┐
                    │  Kosmos Core Graph  │
                    │                     │
                    │ Parsing             │
                    │ Resolution          │
                    │ Canonical Lineage   │
                    │ Temporal Projection │
                    │ Graph Construction  │
                    │ Graphiti Export     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼

      Obsidian Plugin    Standalone HTML    Agent/API Layer

      Live vault events  Directory picker   REST
      Obsidian metadata  Recursive scan     MCP
      Incremental sync   Rescan + diff      Agent traversal
      3D renderer        3D renderer        Graph queries
```

The semantic result must not depend upon which surface is being used.

The same vault should produce materially the same:

```text
nodes
links
lineage
HEAD status
temporal state
Graphiti episode structure
```

whether accessed through:

```text
Obsidian
standalone HTML
kosmos-build.mjs
Agent REST API
MCP
```

That consistency is the principal architectural objective of this rebuild.

---

# 40. Final Instruction to the Implementing Agent

Do not solve this by merely editing the README to reduce the claims.

Fix the underlying correctness and reproducibility issues first.

Preserve working functionality.

Refactor duplicated semantics into shared modules.

Build the standalone runtime into a genuine offline, single-file knowledge-directory viewer.

Make every major public claim traceable to:

```text
implementation
test
benchmark
or clearly stated limitation
```

At completion, produce:

1. A concise implementation summary.
2. A list of files added, modified, and removed.
3. A list of architecture changes.
4. Test results.
5. Benchmark results.
6. Known limitations.
7. Any README claims intentionally weakened because they could not be proven.
8. The exact commit SHA intended for independent reassessment.

Do not declare the rebuild complete while required tests are failing or while documented commands reference nonexistent files.
