# Kosmos-Oden Renderer and Engineering Assessment

**Repository:** `Odenknight/Kosmos-Oden`  
**Assessment date:** 2026-07-12  
**Assessed branch/commit:** `main` at `deb87589c36d71b0efe5e74ed56d4221d4264a60`

---

## Executive conclusion

The supplied report is fundamentally fair, but part of it is now stale relative to the repository.

Kosmos-Oden is not merely “an HTML page with an old Three.js file.” It is a deliberately local-first visualization system with:

- a shared semantic Core;
- separate host surfaces;
- a sandboxed renderer;
- a read-only Agent API;
- deterministic bundled artifacts;
- CI-enforced invariants;
- reproducible builds;
- tag-built releases with checksums and provenance.

The current renderer dependency, Three.js r128, is old enough to create meaningful maintenance and compatibility risk. Upgrading is warranted, but the correct strategy is **not** to replace r128 and simultaneously switch the entire project to WebGPU.

Recommended program:

1. upgrade the stable renderer to current Three.js using **WebGLRenderer/WebGL2**;
2. keep the stable standalone artifact fully offline and `file://` compatible;
3. add browser, image, context-loss, and performance regression tests;
4. introduce a separate **WebGPURenderer + TSL** build as experimental;
5. retain a legacy renderer only if actual users need WebGL1-era compatibility.

---

## 1. Assessment of the supplied report

### What it gets right

#### Vendoring was intentional

The report correctly recognizes that r128 was not necessarily left in place through carelessness. The architecture favors:

- offline operation;
- no CDN;
- no runtime package registry;
- inspectable bytes;
- reproducible output;
- archival longevity;
- air-gapped use.

Those are legitimate design objectives.

#### Supply-chain surface is reduced at runtime

A self-contained artifact avoids runtime dependency resolution, CDN replacement, package-registry availability, and unplanned browser fetches.

This does not eliminate supply-chain risk. It moves the critical control point to build time, where exact source, integrity, licensing, and update policy must be governed.

#### Maintenance responsibility transfers to the project

The most important question is not “is r128 old?” It is:

> Does Kosmos-Oden have a disciplined method for discovering, testing, and adopting renderer changes that matter?

That is the proper maintainability question.

#### Reproducibility, auditability, and archival use are real strengths

The supplied report correctly emphasizes reproducibility and could go even further.

Kosmos-Oden can preserve:

- exact release bytes;
- identical renderer revision;
- deterministic graph layout inputs;
- independent checksum verification;
- an artifact that can remain usable without a package registry.

Those properties are valuable for research, knowledge preservation, privacy-oriented use, and forensic comparison.

### What should be corrected or softened

#### Unsupported CVE claims

Claims about specific Three.js vulnerabilities should name:

- advisory or CVE identifier;
- affected versions;
- vulnerable code path;
- whether Kosmos-Oden invokes that path;
- fixed release.

Absent that evidence, the defensible statement is that old code accumulates unknown maintenance risk and misses upstream fixes—not that Kosmos-Oden is known to be exploitable.

#### “Outdated shader compiler” is imprecise

Three.js does not ship the browser's GLSL compiler.

Kosmos-Oden and Three.js produce shader programs. The browser, graphics stack, and GPU driver validate and compile them.

The relevant risks are:

- shader-source compatibility;
- renderer-generated shader changes;
- browser/driver behavior;
- GLSL version and language changes;
- error reporting and validation;
- platform-specific rendering defects.

#### DNS rebinding is not a renderer-version issue

DNS rebinding is an application/network boundary concern. Kosmos-Oden's local Agent API already performs Host/Origin validation and authentication hardening.

That control should continue to be reviewed, but it is not a reason to upgrade Three.js.

#### WebGPU is not a drop-in Three.js version bump

The current visual materials are custom GLSL `ShaderMaterial` implementations using:

- `attribute`;
- `varying`;
- `gl_FragColor`;
- custom ACES-like tone mapping;
- custom sRGB conversion;
- instanced custom attributes.

A WebGPU path should use Three.js's WebGPU-compatible node/TSL material system or a separately maintained backend-specific material implementation. Merely constructing `WebGPURenderer` will not prove that the current GLSL path is portable.

---

## 2. What the repository already does well

### Shared semantics reduce migration risk

The renderer does not parse Markdown or reconstruct lineage. `src/core/` produces the graph, and the renderer consumes it.

That separation is excellent. A renderer replacement should not change:

- resolution;
- lineage;
- temporal projection;
- Graphiti episodes;
- Agent API results;
- CLI output.

This enables strong parity tests before and after the rendering upgrade.

### Renderer isolation is meaningful

The plugin uses a sandboxed iframe without `allow-same-origin`. Note/folder opening is mediated through a versioned message protocol.

A renderer defect therefore has a smaller blast radius than it would have inside the privileged Obsidian host context.

### The render implementation is already performance-conscious

The renderer uses:

- instanced meshes;
- reusable scratch vectors/matrices;
- dynamic buffer attributes;
- pooled resources;
- explicit disposal;
- adaptive pixel ratio;
- geometry quality tiers;
- LOD culling;
- reduced update frequency for selected work;
- full render-loop suspension while hidden.

An upgrade should preserve these properties rather than assume a newer library automatically makes the application faster.

### Release integrity is strong for a small project

The project already uses:

- exact dev-tool versions;
- lockfile installation;
- full verification;
- byte-reproducible executable builds;
- CI-built releases;
- `SHA256SUMS`;
- `BUILD-INFO.json`;
- a machine-readable invariant policy.

This is substantially more mature than the original report's “add CI and provenance” recommendation suggests.

---

## 3. Material current risks

### 3.1 No automated real-browser rendering gate

The current test stack is Node-based, and artifact checks are static.

A generated HTML file can pass all current checks while:

- WebGL initialization fails;
- a shader fails compilation;
- colors become incorrect;
- pointer/touch interactions break;
- a browser-specific API changes;
- the sandbox blocks a capability;
- the render loop fails to resume;
- context restoration fails.

This is the largest assurance gap.

### 3.2 No automated image regression

The project has visually significant custom shaders and a spatial interface. Numeric tests cannot fully establish visual parity.

A renderer upgrade needs deterministic screenshots with controlled camera, time, seed, DPR, quality tier, and browser version.

### 3.3 r128-to-current crosses major compatibility changes

The migration crosses changes including:

- module-build policy;
- removal of `build/three.min.js` in modern Three.js;
- color-management defaults and APIs;
- InstancedMesh culling behavior;
- WebGL1 deprecation and removal;
- renderer/shader internals;
- browser and GPU compatibility fixes.

The project cannot safely replace `vendor/three.min.js` with a modern equivalent because the old global minified build no longer exists in current releases. The build architecture must switch to module import plus bundling.

### 3.4 Color management is a high-risk visual area

Kosmos-Oden currently:

- converts colors with `convertSRGBToLinear()`;
- performs manual tone mapping in custom shaders;
- performs manual sRGB output conversion.

Modern Three.js changed default color-management behavior and renamed output APIs.

The migration must establish one explicit owner for each operation:

1. input color interpretation;
2. linear-light shading;
3. tone mapping;
4. output transfer to sRGB.

A visually plausible result can still be wrong through double conversion or missing conversion, so screenshots and numeric color probes are required.

### 3.5 Modern WebGLRenderer removes WebGL1

A modern Three.js WebGLRenderer is effectively a WebGL2 renderer.

Benefits include a simpler modern baseline and better alignment with current browsers. The cost is loss of old WebGL1-only devices and runtimes.

This compatibility reduction must be intentional, documented, and tested. A frozen legacy HTML asset is preferable to weakening the primary modern build if real users still require WebGL1.

### 3.6 Renderer provenance is incomplete

`THIRD-PARTY-NOTICES.md` identifies Three.js r128 and its license, but a stronger record would also contain:

- exact upstream tag;
- upstream commit;
- official source path;
- SHA-256;
- license hash;
- verification method and date.

Moving to exact-pinned `three` in `package.json` improves provenance because `package-lock.json` records integrity, while the release can still remain fully offline at runtime.

---

## 4. Benefits of upgrading the stable rendering engine

### All platforms

- Current browser and GPU-driver compatibility fixes.
- Better alignment with current Three.js documentation and ecosystem.
- Removal of reliance on a discontinued global build format.
- Exact npm integrity and SBOM representation.
- Easier automated dependency monitoring.
- Better context-loss, shader diagnostics, renderer fixes, and instancing maintenance from upstream.
- A maintainable path to WebGPU/TSL without forcing it immediately.
- Easier onboarding for contributors familiar with modern ESM.
- Clearer platform requirements.
- Reduced risk that a future browser update abruptly breaks an unmaintained rendering path.

### Windows desktop and Obsidian/Electron

- Better compatibility with current Chromium, ANGLE, Direct3D, and GPU-driver paths.
- Easier reproduction of GPU errors through modern diagnostics.
- Opportunity to add stable WebGL2 and optional WebGPU testing on integrated and discrete GPUs.
- Better long-term support as Electron/Chromium advances.

### macOS desktop

- Better compatibility with current Safari/Chrome and Metal-backed browser graphics stacks.
- A future WebGPU path that maps more naturally to Metal on supported browsers.
- More current handling of high-DPI displays and renderer internals.
- Continued WebGL2 fallback for browsers/runtimes where WebGPU is incomplete.

### Linux desktop

- Better support for current Chromium/Firefox and Mesa graphics stacks.
- More relevant upstream bug fixes for context restoration and shader behavior.
- Easier CI through Chromium/Firefox browser automation.
- Optional testing across software rendering, Intel/AMD integrated GPUs, and discrete GPUs.

### Android

- More current Chromium and mobile-GPU compatibility.
- Access to upstream fixes affecting Adreno/Mali-class devices.
- Continued benefit from Kosmos-Oden's adaptive DPR, LOD, and lite shader path.
- An optional WebGPU route on capable modern devices without removing stable WebGL2.

### iPhone and iPad

- Better alignment with current WebKit and WKWebView.
- Future WebGPU capability on supported modern OS/browser combinations.
- Modern WebGL2 remains necessary as the dependable default.
- The existing lite path and capped DPR remain important because newer rendering APIs do not remove thermal and memory limits.

### Standalone offline HTML

An npm-based build does **not** require runtime internet access. Esbuild can inline the exact module into the final HTML just as the vendored global file is inlined today.

Benefits include:

- lockfile integrity;
- exact version monitoring;
- SBOM coverage;
- retained single-file distribution;
- retained no-CDN policy;
- retained checksum verification;
- easier deterministic rebuilds.

### Plugin embed

The plugin's renderer can receive the same modern WebGL2 engine while retaining:

- iframe sandbox;
- opaque origin;
- versioned protocol;
- no renderer access to Obsidian APIs;
- hidden-view suspension;
- identical Core graph input.

---

## 5. What an upgrade will not automatically provide

A new Three.js revision does not automatically produce:

- higher FPS;
- lower GPU memory;
- better battery life;
- WebGPU support for custom GLSL;
- security against application-level flaws;
- identical colors;
- support for old GPUs;
- deterministic pixel output across every GPU vendor;
- automatic context restoration;
- stable mobile thermals.

Each claim must be benchmarked or tested.

The current renderer is already efficient in several important ways. Performance improvements may be small unless the project also changes shaders, labels, draw topology, update scheduling, or data transfer.

---

## 6. Recommended target architecture

### Stable renderer

```text
Three.js r185 / npm three@0.185.1
WebGLRenderer
WebGL2 requirement
custom GLSL materials migrated and tested
single-file offline output
default for plugin and standalone
```

### Experimental renderer

```text
Three.js WebGPURenderer
TSL/NodeMaterial visual implementation
WebGPU when available
WebGL2 backend fallback where supported by Three.js
separate HTML/build flavor
not the default until parity and platform gates pass
```

### Optional legacy renderer

```text
Frozen r128 or selected last-WebGL1-compatible release
separate artifact
no new feature development
security/compatibility notice
only retained if user evidence justifies it
```

---

## 7. Final recommendation

Proceed with an upgrade, but treat it as a controlled renderer migration rather than dependency housekeeping.

Priority order:

1. Add browser smoke tests.
2. Add deterministic visual capture.
3. Add renderer provenance checks.
4. Baseline current r128 behavior and performance.
5. Convert from global vendored Three to exact ESM package bundling.
6. Upgrade stable WebGL renderer to r185.
7. Resolve color/shader compatibility.
8. validate all declared platforms;
9. release an RC and soak it;
10. create the WebGPU/TSL renderer as a separate project phase.

This preserves what is distinctive about Kosmos-Oden—offline, deterministic, inspectable, shared semantics—while removing unnecessary dependence on a five-year-old renderer architecture.
