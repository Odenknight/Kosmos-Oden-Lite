# Kosmos-Oden HTML Renderer Variants

**Purpose:** Define which HTML artifacts should use which rendering engines, why they should remain separate, and how they should be built and released.

---

## 1. Core principle

Kosmos-Oden should share:

- one Kosmos Core;
- one graph model;
- one cosmology classification;
- one layout model;
- one interaction contract;
- one visual specification;

but it should not force every browser and host into one rendering backend before that backend is universally dependable.

The stable and experimental renderers should consume the same positioned scene data while implementing backend-specific materials and renderer initialization.

---

## 2. Recommended artifact set

| Artifact | Renderer | Status | Primary purpose |
|---|---|---|---|
| `vault-kosmos.html` | Modern Three.js `WebGLRenderer` / WebGL2 | Stable default | Universal offline standalone viewer |
| `dist/kosmos-embed.html` | Modern Three.js `WebGLRenderer` / WebGL2 | Stable default | Sandboxed Obsidian plugin embed |
| `vault-kosmos-webgpu.html` | Three.js `WebGPURenderer` + TSL | Experimental | Native WebGPU evaluation and future-facing performance/features |
| `dist/kosmos-embed-webgpu.html` | `WebGPURenderer` + TSL | Test/experimental | Obsidian runtime capability testing |
| `vault-kosmos-legacy.html` | Frozen r128 or selected WebGL1-capable renderer | Optional legacy | Older hardware/browser compatibility only |

---

## 3. Stable standalone: `vault-kosmos.html`

### Renderer

```text
Three.js r185
WebGLRenderer
WebGL2
custom GLSL materials migrated for modern Three
```

### Why this remains the default

The stable standalone's defining promise is:

> Download one file, disconnect the network, double-click it, and render a vault.

WebGL2 remains the best default for that promise because it is broadly available in current Chromium, Firefox, and Safari environments and does not depend on WebGPU's secure-context and availability constraints.

The artifact must retain:

- `file://` execution;
- no CDN;
- no server requirement;
- persistent Chromium directory picker where available;
- snapshot fallback in other browsers;
- read-only access;
- deterministic build;
- embedded CSS, JS, Core, and renderer.

### Stable acceptance requirements

- Chromium, Firefox, and WebKit browser CI;
- `file://` test;
- HTTP test;
- mobile viewport test;
- deterministic screenshot baseline;
- no network requests;
- WebGL2 failure message;
- context loss/recovery behavior;
- high and lite quality tiers.

---

## 4. Stable plugin embed: `dist/kosmos-embed.html`

### Renderer

```text
Three.js r185
WebGLRenderer
WebGL2
same stable GLSL visual path as standalone
```

### Why it should match the stable standalone renderer

Using the same renderer implementation provides:

- visual parity;
- one stable shader set;
- one screenshot baseline family;
- one performance profile;
- easier defect reproduction;
- less code drift.

The host surface remains different:

- plugin receives snapshots/deltas through `postMessage`;
- standalone reads through browser file APIs;
- plugin is sandboxed in an opaque-origin iframe;
- plugin mediates note/folder navigation through the host.

Those host differences justify separate entry points, but not separate stable scene semantics.

### Plugin-specific requirements

- preserve sandbox permissions exactly;
- no `allow-same-origin`;
- protocol validation;
- leaf visibility suspension;
- desktop and mobile Obsidian validation;
- no direct Obsidian API access from renderer;
- no network request;
- no filesystem access from iframe.

---

## 5. Experimental standalone: `vault-kosmos-webgpu.html`

### Renderer

```text
Three.js WebGPURenderer
TSL/NodeMaterial visual implementation
native WebGPU when available
Three.js WebGL2 backend fallback where applicable
```

### Why it is separate

WebGPU is valuable, but it is not yet a safe replacement for the default artifact because:

- it is not available in every widely used browser/runtime;
- the API is restricted to secure contexts in supporting browsers;
- `file://` behavior is not a dependable cross-browser contract;
- initialization is asynchronous;
- shader/material implementation differs;
- GPU diagnostics and failure modes differ;
- visual output can differ;
- bundle size may increase;
- Obsidian's embedded browser support can lag the standalone browser;
- current Kosmos GLSL materials require a TSL/NodeMaterial rewrite.

A separate file provides:

- opt-in testing;
- independent rollback;
- honest compatibility messaging;
- separate image baselines;
- separate performance measurements;
- freedom to evolve TSL without destabilizing the default viewer.

### Startup behavior

The page should report:

```text
Renderer requested: WebGPU
Backend active: WebGPU | WebGL2 fallback
Three revision: 185
Secure context: yes | no
Adapter initialized: yes | no
Fallback reason: <reason>
```

If native WebGPU is unavailable, the page may use Three.js's WebGL2 backend fallback where the TSL implementation supports it.

It must not silently identify fallback as native WebGPU.

### Distribution guidance

Treat as:

- experimental release asset;
- opt-in download;
- not the only copy of a user's visualization tool;
- not the stable plugin renderer;
- excluded from stable claims until full gates pass.

Because WebGPU generally requires a secure context, documentation should recommend:

```bash
python -m http.server 8080
```

or another local HTTP server only for the experimental build.

The stable WebGL file must remain serverless.

---

## 6. Experimental plugin embed: `dist/kosmos-embed-webgpu.html`

### Purpose

This is an engineering test artifact, not initially embedded in stable `main.js`.

It validates:

- Electron/Chromium WebGPU availability;
- sandbox compatibility;
- TSL material behavior;
- mobile WebView support;
- device-loss behavior;
- plugin lifecycle;
- backend fallback.

### Why not bundle both stable embeds in `main.js` immediately

Embedding both complete renderer bundles can:

- substantially increase `main.js`;
- duplicate Three.js code;
- increase plugin memory;
- complicate startup;
- expand the testing matrix;
- make rollback less clear.

Initial recommendation:

```text
stable plugin:
  main.js -> stable WebGL embed only

experimental package/build:
  main.js -> WebGPU/TSL embed only
```

After WebGPU stabilizes, evaluate one of these options:

1. one TSL renderer using WebGPU with WebGL2 backend fallback;
2. two plugin build flavors;
3. a backend setting with both bundles, only if bundle and memory budgets permit;
4. an optional renderer companion plugin.

Do not choose until measured.

---

## 7. Optional legacy: `vault-kosmos-legacy.html`

### Renderer

Either:

- current r128 frozen artifact; or
- a separately selected last acceptable WebGL1-capable Three.js revision.

### Why it may exist

A modern Three.js upgrade removes WebGL1 support. Some older:

- phones;
- tablets;
- integrated GPUs;
- virtual machines;
- remote desktop sessions;
- legacy browsers;
- embedded WebViews;

may fail WebGL2.

A frozen legacy artifact provides an escape hatch without forcing the main codebase to remain on r128.

### Conditions for retaining it

Retain only when:

- a real supported user/platform requires it;
- provenance is recorded;
- limitations are documented;
- it is clearly labeled legacy;
- it is not used for new features;
- it receives only critical compatibility/security work;
- users are directed to the stable modern build first.

### Required warning

```text
Legacy compatibility build.
Uses an older rendering engine for WebGL1-era systems.
Not the default and may not receive visual feature updates.
Use the stable WebGL2 build whenever possible.
```

---

## 8. Shared renderer architecture

Recommended source structure:

```text
src/renderer/
  scene/
    scene-model.ts
    scene-state.ts
    camera.ts
    interactions.ts
    labels.ts
    lifecycle.ts
  backends/
    backend.ts
    webgl/
      renderer-webgl.ts
      materials-glsl.ts
    webgpu/
      renderer-webgpu.ts
      materials-tsl.ts
  shared/
    cosmology.ts
    layout.ts
    render-diagnostics.ts
    quality.ts
```

Conceptual interface:

```ts
export interface KosmosRenderBackend {
  readonly name: "webgl2" | "webgpu" | "webgl2-fallback";
  readonly threeRevision: string;

  init(container: HTMLElement): Promise<void>;
  buildScene(sceneData: PositionedKosmosGraph): void;
  resize(width: number, height: number, dpr: number): void;
  render(frame: RenderFrame): void;
  suspend(): void;
  resume(): void;
  diagnostics(): RendererDiagnostics;
  dispose(): void;
}
```

The backend interface should not contain Markdown, lineage, temporal, or Agent API logic.

---

## 9. Build entry points

Recommended entries:

```text
src/standalone/standalone-webgl.ts
src/standalone/standalone-webgpu.ts
src/plugin/embed-webgl.ts
src/plugin/embed-webgpu.ts
```

Each entry imports a backend directly so esbuild can tree-shake and avoid shipping both engines accidentally.

Example stable entry:

```ts
import { bootStandalone } from "./standalone-common";
import { createWebGLBackend } from "../renderer/backends/webgl/renderer-webgl";

bootStandalone(createWebGLBackend);
```

Example WebGPU entry:

```ts
import { bootStandalone } from "./standalone-common";
import { createWebGPUBackend } from "../renderer/backends/webgpu/renderer-webgpu";

bootStandalone(createWebGPUBackend);
```

Build output mapping:

```js
await buildPage({
  entry: "src/standalone/standalone-webgl.ts",
  output: "vault-kosmos.html",
  title: `Vault Kosmos ${VERSION} — Standalone WebGL2`
});

await buildPage({
  entry: "src/standalone/standalone-webgpu.ts",
  output: "vault-kosmos-webgpu.html",
  title: `Vault Kosmos ${VERSION} — Experimental WebGPU`
});
```

---

## 10. Shared visual specification, separate implementations

The two renderers should share a written visual contract:

- star class color and radius;
- planet type color and scale;
- body geometry tiers;
- halo dimensions;
- ring dimensions;
- fog density;
- camera FOV;
- selection intensity;
- agent trail timing;
- label rules;
- low-power policy;
- tone-mapping intent.

GLSL and TSL implementations may not be pixel-identical, but they must be materially equivalent.

Define tolerances:

```text
semantic parity: exact
body count: exact
transform/radius: exact within floating-point tolerance
camera framing: exact within tolerance
color: perceptual threshold
glow/atmosphere: visual-review threshold
performance: backend-specific budget
```

---

## 11. Why different renderers should not change graph output

Renderer selection must not affect:

- parsed notes;
- node IDs;
- link IDs;
- body classification;
- lineage;
- temporal state;
- graph exports;
- Agent API responses;
- Graphiti episodes;
- layout seed;
- positioned coordinates, unless a separately approved GPU-layout feature is introduced.

The renderer is a view, not an authority.

This boundary is one of Kosmos-Oden's best architectural properties and should remain enforceable in tests.

---

## 12. Release naming

Recommended release asset names:

```text
Kosmos-Oden-vX.Y.Z-plugin-webgl.zip
Kosmos-Oden-vX.Y.Z-standalone-webgl.html
Kosmos-Oden-vX.Y.Z-standalone-webgpu-experimental.html
Kosmos-Oden-vX.Y.Z-standalone-legacy.html
SHA256SUMS
BUILD-INFO.json
SBOM.cdx.json
renderer-provenance.json
```

The stable documentation should link to the WebGL2 files first.

---

## 13. Promotion criteria for WebGPU

WebGPU becomes stable only when:

- TSL visual parity is approved;
- native WebGPU works on the declared Windows/macOS/Linux/Android/iOS set;
- WebGL2 fallback is tested;
- device loss is handled;
- secure-context requirements are clearly surfaced;
- the stable offline workflow is not lost;
- browser and Obsidian runtime support is adequate;
- performance is measurably equal or better on representative hardware;
- bundle and memory budgets are acceptable;
- visual and behavioral regression suites pass;
- rollback remains available.

Until then, separate artifacts are the technically honest design.
