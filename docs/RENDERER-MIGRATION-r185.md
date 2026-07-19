# Renderer Migration — Three.js r128 → r185 (WebGL2)

**Release:** `0.6.0-beta.2` · **Status:** beta QA, not yet promoted.

This beta executes **Phase 1** of the separately maintained engineering review:
move the stable renderer
from the vendored global **Three.js r128** (`window.THREE`) to the exact-pinned
ESM package **`three@0.185.1`**, esbuild-bundled, **WebGL2-only** — preserving
offline / deterministic / `file://` behaviour. WebGPU/TSL is explicitly a
**separate later phase** and is not in this branch.

## What changed

| Area | Before (r128) | After (r185) |
|---|---|---|
| Dependency | vendored `vendor/three.min.js` global build | exact `three@0.185.1` in `dependencies`, lockfile-pinned |
| Access | `const THREE = window.THREE` | `import * as THREE from "three"` |
| Bundling | separate `<script>` block inlined at build | esbuild bundles the module into the app; one `<script>` |
| Backend | WebGL1/2 auto | **WebGL2 required** (modern `WebGLRenderer`); capability-gated with an honest message |
| Color mgmt | none (r128 default) | explicit **Strategy A**: `ColorManagement.enabled=false`, `outputColorSpace=LinearSRGBColorSpace`, `NoToneMapping` — the shader still owns ACES + manual sRGB, so the pipeline matches r128 (no double conversion) |
| Context loss | unhandled | `webglcontextlost`/`restored` handlers: stop, show recovering state, rebuild + resume |
| Provenance | notice only | `renderer-provenance.json` + `check:renderer-provenance` (exact version, lockfile integrity, revision, marker, no CDN) |
| Legacy | — | r128 moved to `vendor/legacy/` with a provenance note |

Preserved unchanged: shared Kosmos Core semantics, graph/layout parity, single
offline HTML, plugin iframe sandbox + versioned protocol, hidden-view render
suspension, mobile lite path, agent trail, H-R star + NASA planet classification.
No new visual features and **no GLSL→TSL conversion** were done here (per the
directive's "do not conflate" rule).

Human smoke testing confirms that the orbits render correctly. A minor cosmetic
clipping of the top header edge remains a known beta QA item.

## Determinism / build

Executable artifacts remain reproducible from the lockfile (esbuild bundling of
a pinned module is deterministic). Bundle sizes grew (standalone ≈729 → ≈862 KB;
`main.js` ≈1.0 → ≈1.2 MB) because the r185 ESM tree-shaken bundle is larger than
the old minified global — within budget for a single-file offline viewer.

A diagnostic marker is emitted in every page:
`<meta name="kosmos-renderer" content="three r185 WebGLRenderer webgl2">` and
`window.__kosmosRenderer = { backend, threeRevision }`.

## What still needs YOUR sign-off (not doable in the build sandbox)

Per CI/CD directive §3.1/§4/§9, an agent must not promote a renderer change.
Before this becomes an RC / merges to `main`:

1. **Real-browser matrix** — run `npm run test:renderer` (Playwright specs added
   under `test/browser/`) on Chromium/Firefox/WebKit + a mobile viewport, on
   Windows/macOS/Linux and Obsidian desktop/mobile.
2. **Visual regression baselines** — generate per-browser reference images
   (`playwright test --update-snapshots` on a reference machine) and review them;
   colour parity vs r128 is the highest-risk item (Strategy A was chosen for
   parity but must be confirmed with pixel probes).
3. **Cross-GPU soak** — integrated + discrete GPUs; `file://` offline test;
   context-loss recovery on real hardware.
4. **Performance budgets** — first-frame, steady FPS, hidden-view frame count,
   bundle size (directive §7.6).
5. **RC promotion** — cut `vX.Y.Z-rc.N`, soak, then human-approve production.

Local verification done on the branch: `npm run verify` green (typecheck, build,
119 unit tests, version/artifact/invariant/renderer-provenance checks); the
built standalone boots the r185 WebGL2 renderer in a Chromium pane
(`__kosmosRenderer.threeRevision === "185"`, scene builds, zero console errors).

## Rollback

`main` is untouched. If this RC fails, discard the branch or restore the last
r128 artifacts from the `main` tag; because the app is read-only and artifacts
are self-contained, rollback is an asset swap, not a data migration.
