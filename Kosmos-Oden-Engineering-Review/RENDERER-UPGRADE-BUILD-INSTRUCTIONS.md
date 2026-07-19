# Kosmos-Oden Renderer Upgrade Build Instructions

**Goal:** Move the stable renderer from vendored Three.js r128 to a current module-bundled Three.js WebGL2 renderer, then prepare—but do not conflate—the separate WebGPU renderer.

**Recommended stable target as of 2026-07-12:** Three.js `r185`, npm package `three@0.185.1`.

---

## 1. Migration policy

This migration must preserve:

- one shared Kosmos Core;
- graph/layout semantic parity;
- offline single-file stable HTML;
- `file://` support for the stable standalone build;
- read-only operation;
- plugin iframe sandboxing;
- renderer protocol behavior;
- deterministic output artifacts;
- hidden-view render suspension;
- mobile lite rendering;
- artifact checks and release provenance.

Do not add new visual features during the stable renderer upgrade.

Do not convert GLSL to TSL in the same pull request.

---

## 2. Create the migration issue and branch

Issue title:

```text
Renderer: migrate stable WebGL build from Three.js r128 to r185
```

Branch:

```bash
git switch main
git pull --ff-only
git switch -c renderer/<issue>-three-r185-webgl
```

Record:

```bash
git rev-parse HEAD
sha256sum vendor/three.min.js main.js vault-kosmos.html dist/kosmos-embed.html
node --version
npm --version
```

---

## 3. Baseline the current renderer

Before changing dependencies, produce a baseline.

### 3.1 Verify current source

```bash
nvm use
npm ci
npm run verify
npm run bench
```

### 3.2 Record runtime information

Add or temporarily expose diagnostics for:

```json
{
  "threeRevision": "128",
  "backend": "webgl",
  "webglVersion": "1-or-2",
  "devicePixelRatio": 1,
  "qualityTier": "high-or-lite",
  "nodeCount": 0,
  "linkCount": 0,
  "frames": 0
}
```

### 3.3 Capture deterministic fixtures

Create at least:

```text
test/fixtures/render/minimal/
test/fixtures/render/classification/
test/fixtures/render/lineage/
test/fixtures/render/dense/
```

Add a capture mode that fixes:

- random seed;
- graph data;
- camera;
- elapsed shader time;
- animation state;
- viewport;
- DPR;
- quality tier;
- label visibility.

Recommended URL:

```text
vault-kosmos.html?capture=1&seed=1907&time=0&dpr=1&quality=high&camera=overview
```

Save current r128 screenshots and performance data.

---

## 4. Add browser automation before the upgrade

Install exact-pinned Playwright:

```bash
npm install --save-dev --save-exact @playwright/test@<approved-version>
npx playwright install --with-deps chromium firefox webkit
```

Do not use `latest` in scripts or CI.

Add:

```text
playwright.config.ts
test/browser/standalone.spec.ts
test/browser/embed.spec.ts
test/browser/visual.spec.ts
test/browser/context-loss.spec.ts
```

Add package scripts:

```json
{
  "test:browser": "playwright test --project=chromium --project=firefox --project=webkit",
  "test:visual": "playwright test test/browser/visual.spec.ts",
  "test:renderer": "npm run test:browser && npm run test:visual"
}
```

Initial browser tests should pass against r128 before continuing.

---

## 5. Replace the global vendored runtime with an exact module dependency

Modern Three.js no longer distributes the old `build/three.min.js` global build. The correct migration is ESM plus bundling.

Install:

```bash
npm install --save-exact three@0.185.1
```

Expected package declaration:

```json
{
  "dependencies": {
    "three": "0.185.1"
  }
}
```

Keep build tools under `devDependencies`.

Commit the updated `package-lock.json`.

### 5.1 Add renderer provenance metadata

Create:

```text
renderer-provenance.json
```

Example:

```json
{
  "schema": 1,
  "package": "three",
  "threeRevision": "185",
  "npmVersion": "0.185.1",
  "upstreamTag": "r185",
  "upstreamRepository": "https://github.com/mrdoob/three.js",
  "license": "MIT",
  "sourceOfIntegrity": "package-lock.json",
  "stableBackend": "WebGLRenderer",
  "verifiedUtc": "2026-07-12T00:00:00Z"
}
```

Update `THIRD-PARTY-NOTICES.md`.

Add `scripts/check-renderer-provenance.mjs` that verifies:

- package version is exact;
- lockfile contains the same version and integrity;
- expected revision is `185`;
- generated HTML contains a diagnostic build marker;
- no runtime CDN import exists;
- license metadata exists.

---

## 6. Refactor renderer imports

Current code obtains Three.js through:

```ts
const THREE = (window as any).THREE;
```

Replace this with an ESM import.

Preferred stable implementation:

```ts
import * as THREE from "three";
```

Remove the global-runtime initialization check based on `window.THREE`.

Replace it with a renderer-construction failure boundary:

```ts
function createStableWebGLRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({
      antialias: !MOBILE,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false
    });
  } catch (error) {
    throw new Error(
      `Kosmos could not initialize WebGL2. ${String(error)}`
    );
  }
}
```

Add a controlled unsupported-platform message rather than a blank canvas.

### 6.1 Shader module cleanup

`shaders.ts` currently accepts `THREE` as an untyped parameter.

Preferred direction:

```ts
import {
  AdditiveBlending,
  ShaderMaterial,
  Vector3
} from "three";
```

Then:

```ts
export function bodyMaterial(options: BodyMaterialOptions): ShaderMaterial
```

A full type cleanup may be a follow-up PR. During the renderer migration, favor minimal behavior-preserving changes.

---

## 7. Update the build generator

Current `scripts/build.mjs` reads `vendor/three.min.js` and inserts it into a separate `<script>` block.

Remove:

```js
const three = readFileSync(resolve(root, "vendor/three.min.js"), "utf8");
```

Remove the generated script:

```html
<script>
${escapeInline(three)}
</script>
```

Because esbuild bundles the `three` module into `appJs`, `composePage()` becomes:

```js
function composePage(title, appJs) {
  const css = readFileSync(resolve(root, "src/renderer/kosmos.css"), "utf8");
  const body = readFileSync(resolve(root, "src/renderer/kosmos-body.html"), "utf8");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport"
      content="width=device-width, initial-scale=1.0,
               maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${escapeInline(appJs)}
</script>
</body>
</html>
`;
}
```

The stable output remains:

- one HTML file;
- no CDN;
- no runtime network request;
- compatible with `file://`;
- reproducible from the lockfile.

Do not delete the r128 file until the modern build is passing. Move it to a clearly named legacy path if a legacy artifact will be retained:

```text
vendor/legacy/three-r128.min.js
vendor/legacy/three-r128.PROVENANCE.json
```

---

## 8. Resolve WebGL2 and platform requirements

Modern Three.js removed WebGL1 support from WebGLRenderer.

Add capability detection before scene setup:

```ts
function hasWebGL2(): boolean {
  const canvas = document.createElement("canvas");
  return !!canvas.getContext("webgl2");
}
```

If unavailable, show:

```text
This Kosmos build requires WebGL2.
Use the legacy compatibility artifact, update the browser/OS,
or enable hardware acceleration.
```

Do not silently downgrade the stable r185 renderer to an unknown implementation.

Add tests for:

- WebGL2 available;
- WebGL2 unavailable;
- software renderer;
- context creation failure;
- context loss.

---

## 9. Migrate color management deliberately

This is the highest visual-risk step.

The current shaders:

- receive colors converted to linear;
- perform custom lighting;
- apply a custom ACES-like curve;
- manually call `toSRGB()`;
- write `gl_FragColor`.

Modern Three.js enables modern color management and uses `outputColorSpace`.

### 9.1 Choose one output-conversion owner

Two valid strategies exist.

#### Strategy A — Preserve shader-owned output conversion

- keep the shader's manual `toSRGB()`;
- ensure Three.js does not apply a second output transfer to the custom material;
- verify every material and browser;
- document that the shader emits display-encoded output.

#### Strategy B — Move output conversion to Three.js

- remove manual `toSRGB()` from the shader;
- emit linear color;
- use `renderer.outputColorSpace = THREE.SRGBColorSpace`;
- use the appropriate Three.js output/color-space shader integration;
- rebaseline screenshots.

Strategy B is more aligned with modern Three.js, but Strategy A may be easier for first-pass visual parity.

Do not guess. Add numeric tests that render known linear values and sample the resulting pixel.

### 9.2 Explicitly set renderer policy

Document and set:

```ts
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace; // only if renderer owns conversion
```

Also document:

```ts
THREE.ColorManagement.enabled = true;
```

or the intentionally selected alternative.

Avoid relying on defaults.

### 9.3 Validate `convertSRGBToLinear()`

The code currently calls:

```ts
COLOR.set(hex).convertSRGBToLinear();
```

Confirm that this remains correct under the selected color policy. Do not apply both automatic input conversion and explicit conversion to the same value.

---

## 10. Validate custom GLSL

Compile every material on every required browser:

- high-quality body material;
- lite body material;
- glow material;
- rings;
- line materials;
- minimap-related material paths;
- every compile-time define combination.

The current GLSL1-style code can continue under WebGLRenderer if Three.js handles it correctly, but test:

- `attribute` and `varying`;
- `gl_FragColor`;
- custom instanced attributes;
- normal transforms;
- dynamic buffer updates;
- additive blending;
- transparent depth behavior;
- precision on mobile GPUs.

Do not convert to GLSL3 unless required. If GLSL3 is adopted, treat it as a separate reviewed change and set `glslVersion` explicitly.

Capture shader compilation logs and fail browser CI on warnings that indicate a real compatibility defect.

---

## 11. Validate changed Three.js behavior

### InstancedMesh culling

The current code sets:

```ts
mesh.frustumCulled = false;
```

That explicitly avoids modern InstancedMesh bounding-sphere behavior. Preserve it unless a measured culling redesign is performed.

### Dynamic buffers

Verify:

```ts
attribute.setUsage(THREE.DynamicDrawUsage)
instanceMatrix.setUsage(THREE.DynamicDrawUsage)
attribute.needsUpdate = true
```

on all browsers.

### Context loss

Add:

```ts
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  stopLoop();
  showRecoveringState();
});

canvas.addEventListener("webglcontextrestored", () => {
  rebuildRendererResources();
  startLoop();
});
```

If reliable restoration is not implemented, display a clear reload action. Do not leave a frozen canvas without explanation.

### Disposal

Retest:

- scene rebuild;
- view close;
- page navigation;
- plugin leaf close;
- repeated open/close;
- context restoration.

---

## 12. Build and test the stable WebGL upgrade

Run:

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run check:versions
npm run check:artifacts
npm run check:invariants
npm run check:renderer-provenance
npm run test:browser
npm run test:visual
npm run bench
```

Verify output:

```bash
grep -R "https://" vault-kosmos.html dist/kosmos-embed.html
grep -R "script src" vault-kosmos.html dist/kosmos-embed.html
sha256sum main.js vault-kosmos.html dist/kosmos-embed.html
```

Expected:

- no external runtime dependency;
- `THREE.REVISION === "185"`;
- stable backend reports WebGL;
- semantic graph output unchanged;
- screenshots approved;
- performance within budget;
- hidden render loop remains stopped;
- plugin sandbox remains unchanged;
- `file://` standalone works.

---

## 13. Cross-platform validation

### Windows

- Edge stable;
- Chrome stable;
- Obsidian desktop current;
- integrated GPU;
- discrete GPU where available;
- hardware acceleration on/off failure behavior.

### macOS

- Safari current;
- Chrome current;
- Obsidian desktop current;
- Apple Silicon;
- Intel Mac if declared supported.

### Linux

- Chromium;
- Firefox;
- Obsidian desktop;
- Mesa integrated GPU;
- software-rendering failure behavior.

### Android

- Chrome;
- Obsidian mobile;
- touch/long-press;
- lite mode;
- thermal/battery observation;
- context recreation after app backgrounding.

### iPhone/iPad

- Safari;
- Obsidian mobile/WKWebView;
- touch and long-press;
- orientation changes;
- memory pressure;
- background/resume behavior.

### Offline

- disconnect network;
- open stable standalone through `file://`;
- import a fixture;
- render;
- export Graph JSON and Graphiti episodes;
- verify no request in browser network log.

---

## 14. Release the stable upgrade

Create a release candidate:

```text
v0.6.0-rc.1
```

The exact version is illustrative; use the project's chosen SemVer decision.

The RC release must include:

- plugin files;
- `vault-kosmos.html`;
- checksums;
- build information;
- SBOM;
- renderer provenance;
- browser matrix;
- visual comparison;
- benchmark comparison;
- migration and rollback notes.

Soak before stable promotion.

---

## 15. Begin WebGPU only after stable WebGL release

Create a new issue and branch:

```text
Renderer: implement experimental WebGPU/TSL backend
renderer/<issue>-webgpu-tsl
```

Required changes:

- import from `three/webgpu`;
- use `WebGPURenderer`;
- await renderer initialization;
- convert custom GLSL materials to TSL/NodeMaterial equivalents;
- expose backend/capability diagnostics;
- retain stable WebGL HTML independently;
- build a separate artifact;
- create separate visual baselines;
- test native WebGPU and forced WebGL2 backend;
- publish as experimental.

Example initialization shape:

```ts
import * as THREE from "three/webgpu";

const renderer = new THREE.WebGPURenderer({
  antialias: !MOBILE,
  alpha: false,
  stencil: false
});

await renderer.init();
```

For forced fallback testing:

```ts
const renderer = new THREE.WebGPURenderer({
  forceWebGL: true,
  antialias: !MOBILE,
  alpha: false,
  stencil: false
});

await renderer.init();
```

Do not attempt to reuse the existing GLSL `ShaderMaterial` implementation without proving support. The intended modern cross-backend route is a TSL/NodeMaterial implementation.

---

## 16. Rollback

Keep the last stable r128 tag and artifacts.

If the r185 RC fails:

1. do not rewrite the tag;
2. publish a corrected RC;
3. restore the previous `main.js` and stable HTML from the known-good release;
4. preserve failing artifacts and logs for diagnosis;
5. add a regression test before retrying.

Because the project is read-only, rollback should not require vault-data migration.
