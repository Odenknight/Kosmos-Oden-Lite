# Kosmos-Oden v0.5.5 — benchmark results

Reproduce with:

```bash
npm run build            # once, to produce dist/ bundles
node benchmarks/bench.mjs --large
```

Synthetic vaults are generated deterministically (seeded PRNG), so runs are
comparable across machines. Numbers below are from one run on:

- **CPU:** Intel Core i7-8665U @ 1.90 GHz (4C/8T, laptop)
- **RAM:** 16 GB
- **Node:** v24.18.0, Windows 11 Pro

| Notes | Full build (parse+graph) | Cosmology | Layout | Single-note update | New-folder update | Notes re-parsed | Residual collisions | RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 22.2 ms | 2.6 ms | 32.6 ms | 4.5 ms | 3.6 ms | 1 | 1 | 51 MB |
| 1,000 | 40.8 ms | 10.0 ms | 162.3 ms | 38.4 ms | 32.5 ms | 1 | 0 | 93 MB |
| 5,000 | 173.9 ms | 56.6 ms | 1,671.8 ms | 144.4 ms | 154.9 ms | 1 | 18 | 237 MB |
| 10,000 | 341.0 ms | 140.2 ms | 2,850.3 ms | 291.9 ms | 274.8 ms | 1 | 2 | 342 MB |
| 25,000 | 1,131.6 ms | 759.7 ms | 11,709.2 ms | 1,108.6 ms | 871.5 ms | 1 | 7 | 604 MB |
| 50,000 | 2,214.2 ms | 2,191.0 ms | 36,548.3 ms | 1,810.7 ms | 1,804.5 ms | 1 | 1 | 1,051 MB |

## Reading the numbers

- **Notes re-parsed = 1 at every size**: the incremental index (§10) re-parses
  only the changed note. The remaining single-note-update cost is graph
  re-assembly from cached parse records (resolver + lineage + temporal +
  edge reconciliation), which is linear in vault size.
- **Layout dominates at scale.** The hierarchical packing + collision
  separation pass is the most expensive stage (~36 s for 50,000 notes on this
  laptop). It runs only on topology changes; metadata-only edits skip it
  entirely (§11). Vaults ≤ 10,000 notes lay out in ≤ ~3 s.
- **Residual collisions** is the honest §12 diagnostic: the layout is designed
  to keep bodies separated and minimize overlap; a handful of residual
  intersections can remain on dense synthetic topologies and are reported
  rather than hidden.
- During the v0.5.5 rebuild an O(nodes × links) orphan scan was removed from
  graph assembly. Before/after on this machine (50,000 notes): full build
  75.7 s → 2.2 s; single-note update 91.4 s → 1.8 s.

Renderer-side scene build / frame times depend on the GPU and are not measured
here; the render loop is suspended entirely while the view is hidden (§27).
