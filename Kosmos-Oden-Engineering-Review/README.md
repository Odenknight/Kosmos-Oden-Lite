# Kosmos-Oden Engineering Review Package

This package contains four proposed Markdown documents prepared from the repository state assessed on 2026-07-12.

1. **CI-CD-AND-AGENT-OPERATING-DIRECTIVE.md**  
   Proposed branch, pull-request, agent-role, CI, browser QA, security, release-candidate, production-promotion, and rollback process.

2. **KOSMOS-ODEN-RENDERER-ASSESSMENT.md**  
   Independent assessment of the supplied report and the actual repository architecture, including benefits and risks of upgrading the renderer across desktop, mobile, plugin, and standalone platforms.

3. **RENDERER-UPGRADE-BUILD-INSTRUCTIONS.md**  
   Step-by-step instructions to migrate the stable renderer from Three.js r128 to r185/`three@0.185.1`, preserving offline and deterministic output, followed by a separate WebGPU phase.

4. **HTML-RENDERER-VARIANTS.md**  
   Separate artifact strategy for stable WebGL2, experimental WebGPU/TSL, plugin embed, and optional legacy HTML versions.

## Principal recommendation

Do not perform a single “r128 to WebGPU” rewrite.

Use two controlled phases:

```text
Phase 1:
  r128 global vendored build
    -> current exact-pinned ESM package
    -> esbuild-inlined WebGL2 stable renderer
    -> browser/visual/performance qualification

Phase 2:
  separate WebGPURenderer + TSL implementation
    -> experimental HTML/plugin flavor
    -> independent qualification and promotion
```

The stable standalone file should remain self-contained, offline, and usable through `file://`.
