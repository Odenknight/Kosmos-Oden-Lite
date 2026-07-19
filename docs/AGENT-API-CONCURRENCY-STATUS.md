# Agent API Concurrency Mitigations — status log (v0.5.5)

Response to `instructions-4-coders/AGENT-API-CONCURRENCY-MITIGATIONS-v0.5.5.md`.
Records the disposition of all four mitigations, as the doc's Definition of
Done requires (1 confirmed, 2 audited, 3 & 4 scoped in/out — decisions logged,
not left implicit). Verified against the shipped source, not assumed.

| # | Mitigation | Status | Evidence |
|---|---|---|---|
| 1 | Build the graph index once, not per-request | **Present (confirmed)** | `src/plugin/vault-provider.ts` |
| 2 | Eliminate synchronous filesystem calls | **Audited — clean** | grep below |
| 3 | Offload heavy computation to a worker thread | **Scoped OUT** (not needed) | `src/core/temporal.ts` |
| 4 | Per-token concurrency limits for fairness | **Scoped IN — implemented** | `src/plugin/agent-server.ts` |

---

## Mitigation 1 — in-memory index, built once — CONFIRMED PRESENT

`VaultDataProvider` (`src/plugin/vault-provider.ts`) owns a single
`KosmosIndex` (`src/core/incremental.ts`). The seven MCP tools and the REST
endpoints all read from `provider.getGraph()`, which returns the **cached**
`index.graph` and only rebuilds when something is dirty:

```
if (this.index.graph && !pending) return this.index.graph;   // no per-request parse
```

Currency is maintained incrementally through Obsidian events wired in
`src/plugin/main.ts` (`metadataCache "changed"`, vault `create`/`delete`/`rename`)
— a single edited note is re-read via `app.vault.cachedRead` (Obsidian's
in-memory cache) and re-parsed alone via `index.applyChanges`; only bulk change
triggers a full rebuild. A `building` promise guard means concurrent
`getGraph()` calls during a rebuild share one build rather than stampeding.

⇒ "Parse the vault per request" does not happen; concurrent agent count does
not translate into concurrent parse passes. No action required.

## Mitigation 2 — no synchronous fs calls — AUDITED, CLEAN

Per the doc's prescribed first pass:

```
$ grep -rn "Sync(" src/ --include=*.ts        # → no matches
$ grep -rn "readFileSync|writeFileSync|existsSync|readdirSync|statSync|mkdirSync" src/ --include=*.ts   # → no matches
```

The Agent API and shared core contain **zero** `*Sync` fs calls. All vault
reads go through Obsidian's async `cachedRead`; there is no `fs` import in the
request path. Nothing to remediate. (Re-run the grep in CI-adjacent review if
new I/O is ever added to the server.)

## Mitigation 3 — worker thread for heavy compute — SCOPED OUT (justified)

The doc flags `graph_at_time` as the candidate for CPU-bound work *if it
replays edge history*. It does not: `graph_at_time` calls the single temporal
projector (`projectAtTime`, `src/core/temporal.ts`) over the already-built
graph's validity intervals — one O(notes) pass computing valid-vs-superseded at
the requested instant, not an O(history) replay. On the cached index this is a
fast synchronous scan bounded by vault size, not by history depth.

⇒ The specific hazard the mitigation targets is absent. Introducing
`worker_threads` (structured-clone serialization of the graph across the thread
boundary, worker lifecycle) would cost more than it saves at realistic vault
sizes. **Deferred**; revisit only if profiling on a very large vault shows the
projection stalling the loop — in which case the preferred fix is materializing
periodic snapshots into the index (as the doc itself suggests) before reaching
for a worker.

## Mitigation 4 — per-agent fairness cap — SCOPED IN, IMPLEMENTED

Already present before this change: a global concurrency cap
(`MAX_CONCURRENT_REQUESTS = 24`), a per-client sliding-window rate limit
(`RATE_MAX_REQUESTS = 240 / 10 s`), and a per-request timeout — but these are
throughput bounds, not fairness between agents, and loopback was exempt (the
local multi-agent case the doc actually cares about: CARSON's bulk
`export_graphiti_episodes` vs another agent's interactive query).

Added a **per-agent in-flight cap** (`MAX_CONCURRENT_PER_AGENT = 12`) in
`KosmosAgentServer.handle`, applied to **all** clients (including loopback),
keyed on the agent identity now derived per request (MCP `clientInfo.name` via
the `Mcp-Session-Id` minted at `initialize`, else `User-Agent`). A single agent
holding 12 concurrent requests is throttled with `429 + Retry-After`, leaving
headroom under the global cap for other agents' interactive queries. Generous
by design — interactive use never reaches it; only bulk/background floods do.
Covered by `test/agent-api.test.mjs` ("Mitigation 4: a single agent's
concurrent requests are capped for fairness").

The same agent-identity signal also drives the per-agent colour + rocket label
on the live traversal trail.

---

## Definition of Done — met

- [x] Mitigation 1 confirmed present.
- [x] Mitigation 2 `*Sync` audit completed; findings logged (clean).
- [x] Mitigation 3 explicitly scoped **out**, with rationale.
- [x] Mitigation 4 explicitly scoped **in** and implemented + tested.
