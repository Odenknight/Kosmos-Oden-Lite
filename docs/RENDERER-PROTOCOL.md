# Host ↔ Renderer Protocol & Iframe Trust Model

## Trust model (honest description)

The Obsidian plugin renders the 3D view inside an `<iframe srcdoc=…>`. `srcdoc`
by itself is **not** a security sandbox — it is a separate rendering/lifecycle
context. Isolation comes from the explicit `sandbox` attribute:

```
sandbox="allow-scripts allow-pointer-lock allow-downloads"
```

Critically, **`allow-same-origin` is NOT granted**, so the renderer runs in an
opaque origin and cannot reach this window's storage, cookies, or DOM. Note
opening is mediated entirely through `postMessage` and handled by `main.ts`, so
the renderer never needs the Obsidian API or `allow-same-origin`.

This is defense-in-depth: the plugin host already holds Obsidian privileges, so
sandboxing the renderer does not protect against a compromised host. It does
limit the blast radius of a defect in the large, partly-generated renderer,
which is where note-derived data is processed.

## Bounded sandbox compatibility experiment (Doc1 §3.4)

Before adopting the sandbox, the embed page was loaded inside an iframe with
exactly the permissions above (no `allow-same-origin`) and driven with a real
`vault-snapshot`. Result:

| Capability | Under sandbox (no same-origin) | Verdict |
|---|---|---|
| Script execution | Runs | OK |
| WebGL / Three.js renderer construction | Constructs (renderer aborts loudly otherwise; it did not) | OK |
| `postMessage` in/out (snapshot + open-note) | Delivered and validated both ways | OK |
| Cosmology + layout pipeline | Executed (logged from inside the frame) | OK |
| Console errors / security violations | None | OK |
| Pointer lock (fly mode) | Needs `allow-pointer-lock` | Granted |
| Downloads (exports) | Needs `allow-downloads` | Granted |
| Obsidian API / same-origin storage | Not required by the renderer | Correctly denied |

**Adopted.** Required features survive without `allow-same-origin`, so the
sandbox produces meaningful isolation with no functional loss.

## Message protocol

Defined in `src/plugin/protocol.ts`. Every message carries `protocol` +
`version`; the renderer structurally validates each and rejects unknown
versions/types instead of acting on arbitrary `postMessage` data.

### Host → renderer

```ts
{ protocol: "vault-kosmos", version: 1, type: "vault-snapshot",
  payload: { files: [{ relativePath, content }], folders?, attachments?, label? } }

{ protocol: "vault-kosmos", version: 1, type: "vault-delta",
  payload: { changed?, removed?, renames?, folders?, attachments?, label? } }

{ protocol: "vault-kosmos", version: 1, type: "agent-traversal",
  payload: { paths: string[], tool: string } }

{ protocol: "vault-kosmos", version: 1, type: "visibility",
  payload: { visible: boolean } }
```

`agent-traversal` carries the note paths one Agent API query touched. The
renderer keeps a breadcrumb of the last 24 hops for 30 seconds, draws fading
emerald line segments between consecutive hops, and pulses recently visited
notes (8 s window) with per-agent halos, places a rocket at each agent head,
and emits a bounded additive comet tail plus residual snow-dust that fades in
place. Particle pools are capped at 640 desktop / 192 low-power mobile and are
reused without per-frame allocation. Emission is post-hoc
from result objects and **capped per tool** (lineage 12, related 11, search 8,
`graph_at_time` 6) so a broad result never floods the halo budget; whole-vault
queries (`vault_overview`, `export_graphiti_episodes`, diagnostics) do not
report a trail at all.

`visibility` carries the hosting Obsidian leaf's visibility. Inside Obsidian,
`document.visibilitychange` fires only when the whole window hides — the host
posts this message on leaf/layout changes so the renderer can fully stop its
rAF loop (CPU/GPU → ~0) when the Kosmos tab is backgrounded, and resume
instantly when it is revealed.

### Renderer → host

```ts
{ protocol: "vault-kosmos", version: 1, type: "open-note",
  payload: { path, label? } }

{ protocol: "vault-kosmos", version: 1, type: "open-folder",
  payload: { path } }
```

`open-folder` is sent when the user right-clicks a folder-only galaxy/cluster
(no manifest note). The host reveals and expands that folder in Obsidian's
file explorer — it must never open or create a note for a folder path. The
host applies the same defense-in-depth check on `open-note`: if the resolved
path turns out to be a folder, it redirects to the folder-reveal path instead
of falling through to link resolution.

### Validation

- `protocol` must equal `"vault-kosmos"` (foreign messages are ignored silently).
- `version` must equal the current version (1); unknown versions are rejected
  with a logged reason.
- `type` must be recognized; payload shape is checked.
- All paths must be relative with no `..` traversal and no absolute/drive roots.

### Compatibility

Host and renderer ship together inside `main.js`, so a single current version
suffices. For resilience, the renderer also still accepts the legacy flat
shapes (`kosmos:files` / `kosmos:update` / `kosmos:open`) from older host
builds; these will be removed in a future breaking release once no mixed
host/renderer combinations remain.
