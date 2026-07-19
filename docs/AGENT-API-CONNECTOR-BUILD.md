# Building the Agent API (HTTP + MCP) connector

A build guide for a **reusable, framework-free read-only Agent API** that exposes
a data source to AI agents over **REST (GET) and MCP (Streamable HTTP)** at the
same time, from one local Node process — no external deps, unit-testable in plain
Node. This is the connector shipped in Kosmos-Oden (`src/plugin/agent-server.ts`);
this document is how to rebuild it, or lift it into another project.

> **Scope / philosophy.** Localhost by default, token-protected, **read-only**
> (GET-only REST; MCP exposes query tools only — no write endpoints). Every design
> point below is a security or reliability property you can test, not a nicety.
> If your project needs writes, add them behind their own scoped tokens — do not
> loosen the read-only core.

---

## 0. What you get

- One `http.Server` serving both surfaces on one port:
  - **REST**: `GET /health`, `/overview`, `/note?path=…`, … — plain JSON for any HTTP client.
  - **MCP**: `POST /mcp` — Streamable-HTTP JSON-RPC 2.0 for Claude Code / Desktop / Cursor / custom harnesses.
- A tiny **provider interface** you implement to bind the connector to *your* data.
- Token auth, Host/Origin validation, byte-limited bodies, rate + concurrency limits.
- Per-agent identity (for fairness limits and optional live "who's querying" UI).
- A ready `.mcp.json` (native HTTP, no `mcp-remote` bridge).

The connector is **transport + security + protocol**. Your domain logic lives
behind the provider and the tool handlers.

---

## 1. Architecture

```
   AI agent (Claude Code / Desktop / Cursor / curl)
        │  HTTP :PORT
        ▼
   ┌──────────────────────────────────────────────┐
   │  AgentServer (this connector)                  │
   │   handle() ─ rate limit ─ per-agent cap        │
   │   dispatch() ─ Host/Origin ─ auth ─ route      │
   │     ├── POST /mcp  → mcpDispatch() (JSON-RPC)   │
   │     └── GET  /...  → REST handlers              │
   │   callTool() ── shared query helpers ───────────┐
   └───────────────────────────────────────────────┘│
        │ provider (interface you implement)          │
        ▼                                             ▼
   getGraph() / getNoteContent() / vaultName()   onTraversal?(paths,tool,agent)
        │                                             │
   your data source                            optional live viewer
```

Two hard rules that keep it testable:
1. **No framework, no platform API in the core.** Pass Node's `http` module in;
   pass a `provider` in. The class never imports Obsidian/Express/etc. You can
   `new AgentServer(http, settings, fakeProvider)` in a unit test.
2. **One graph snapshot, built once.** The provider hands back an in-memory
   structure; the server never parses source files per request (see §7, M1).

---

## 2. The provider interface (your integration point)

This is the *entire* surface you implement to port the connector to a new project.

```ts
export interface AgentDataProvider {
  /** The in-memory data snapshot the tools read. Build once, keep current
   *  incrementally; DO NOT parse the source per call (see §7). */
  getGraph(): Promise<Graph>;
  /** Full content for one item, or null. */
  getNoteContent(id: string): Promise<string | null>;
  /** Display name of the data source (shown in /health, MCP serverInfo). */
  vaultName(): string;
  /** Extra hostnames (LAN IPs) allowed in Host/Origin checks when bound to LAN. */
  lanAddresses(): string[];
}
```

`Graph` is whatever shape your tools need (Kosmos uses `{ nodes, links, … }`).
The connector is agnostic — only your tool handlers read its fields.

Instantiation (in the host app, not the core):

```ts
import http from "node:http";
const server = new AgentServer(http, settings, myProvider);
server.onTraversal = (paths, tool, agent) => liveViewer?.highlight(paths, tool, agent); // optional
server.start((errMsg) => console.error(errMsg));
// …later
server.stop();
```

---

## 3. Settings & lifecycle

```ts
interface AgentSettings {
  schemaVersion?: number;   // migrate on load when the shape changes
  agentEnabled: boolean;
  agentPort: number;        // default 4816
  agentToken: string;       // see §5
  agentRequireToken: boolean;
  agentBindMode: "localhost" | "lan";
  agentAllowQueryToken: boolean;  // deprecated ?token=; OFF by default
}
```

- `bindHost` = `127.0.0.1` for localhost, `0.0.0.0` for LAN.
- `start()` **fails closed**: in LAN mode with no token (or `requireToken=false`)
  it refuses to listen and reports an error — never expose data to the network
  unauthenticated.
- Set a per-connection socket timeout (`srv.setTimeout(REQUEST_TIMEOUT_MS)`) to
  backstop slow-loris stalls.
- `stop()` closes the server and clears all in-flight/rate/session maps.

---

## 4. HTTP dispatch pipeline

Order matters — cheapest and most security-critical checks first:

```
handle(req,res):
  1. rate limit (per client IP, sliding window)         → 429
  2. per-agent in-flight cap (fairness, §7 M4)          → 429
  3. inFlight++ ; try dispatch() ; finally decrement
dispatch(req,res):
  4. Host header allowed?  (DNS-rebinding defence)       → 403
  5. Origin header allowed? (absent = non-browser OK)    → 403
  6. OPTIONS → 204 (CORS preflight, before auth)
  7. authorized(req)?                                    → 401 (generic message)
  8. route:  /mcp → MCP ;  else GET-only REST
```

`json(res, code, obj, extraHeaders?)` writes `Content-Type: application/json;
charset=utf-8` + `Cache-Control: no-store` and the body. Always `no-store` — tokens
and vault content must never be cached by intermediaries.

---

## 5. Security (each is a testable property)

| Property | How | Test |
|---|---|---|
| Token from CSPRNG only | 32 bytes from `crypto.getRandomValues`, base64url; **throw** if no secure RNG (no `Math.random` fallback) | `makeToken()` → `/^[A-Za-z0-9_-]{43}$/`, two calls differ |
| Constant-time compare | XOR-accumulate over max length; no early return | — |
| Header auth is the default | `Authorization: Bearer <t>` or `x-api-key: <t>` | 401 without, 200 with |
| Query-token deprecated | `?token=` accepted only if `agentAllowQueryToken` AND **never** in LAN mode | 401 in LAN even when flag on |
| Generic 401 | Same message for missing vs wrong token (no oracle) | — |
| Host validation | lowercased host (strip port / `[v6]`) ∈ allow-set (loopback + LAN IPs when bound LAN) | foreign/trailing-dot host → 403 |
| Origin validation | absent → allow (non-browser); else hostname ∈ allow-set; `null` origin → 403 | — |
| Byte-limited body | accumulate **bytes** (not JS string length); over cap → 413 + `Connection: close` | 4 MiB default |
| Read-only | REST is GET-only; MCP tools are queries only | non-GET REST → 405 |
| LAN fail-closed | refuse to `listen` in LAN mode without a token | `start()` sets error, `server===null` |

LAN-IP allow-set is recomputed at most once per 60 s (cache the NIC scan; Host
validation runs on every request).

---

## 6. MCP over Streamable HTTP

Single endpoint `POST /mcp`, JSON responses (no server-initiated SSE stream):

```
GET  /mcp     → 405  Allow: POST, DELETE      (no server→client SSE stream)
DELETE /mcp   → 204 with valid session headers; 404 when unknown/expired
POST /mcp     → read body (byte-capped) → JSON.parse → mcpDispatch()
                single object → one JSON-RPC response
                array/batch → HTTP 400 / JSON-RPC -32600
```

`mcpDispatch(msg, ctx)` handles JSON-RPC 2.0:

| method | behaviour |
|---|---|
| `initialize` | negotiate protocol version; register a session from `clientInfo.name`; return `capabilities.tools`, `serverInfo{name,version}`, `instructions`. The POST handler adds an **`Mcp-Session-Id`** response header. |
| `notifications/initialized` (no `id`) | transition the session to initialized → HTTP **202**, empty body |
| other notifications (no `id`) | accept silently → HTTP **202**, empty body |
| `ping` | `{}` |
| `tools/list` | tool definitions with input/output schemas and read-only/idempotent annotations |
| `tools/call` | validate name/arguments; return text plus `structuredContent`. Unknown tools/malformed calls are `-32602`; execution failures use `isError:true`. |
| `resources/list`, `prompts/list` | `{ resources: [] }` / `{ prompts: [] }` |
| unknown | JSON-RPC error `-32601` |

**Protocol version negotiation.** Keep an explicit supported list, newest first:

```ts
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
// echo the client's version if supported; else return our latest (never echo an unknown version)
negotiate(requested) { return SUPPORTED.includes(requested) ? requested : SUPPORTED[0]; }
```

The server issues `Mcp-Session-Id` during initialization. Every subsequent POST
and DELETE must send that id plus the negotiated `MCP-Protocol-Version`.
Missing/mismatched protocol headers return 400; unknown/expired sessions return
404 so clients can reinitialize. This follows the current Streamable HTTP
lifecycle instead of treating a stateful identity session as stateless.

---

## 7. Concurrency & fairness (the four mitigations)

A single Node process serving many concurrent agents. The event loop handles
concurrent I/O fine; the risk is **synchronous CPU work in the request path**
blocking every other agent. In leverage order:

1. **Build the index once, not per request.** The provider caches its graph and
   updates it incrementally on source-change events; `getGraph()` returns the
   cached structure unless dirty. Guard concurrent rebuilds with a single
   `building: Promise` so N callers share one build instead of stampeding. This
   is the highest-leverage fix — it turns "parse the source" into "read RAM".
2. **No synchronous fs calls.** Zero `*Sync` in the request path. Audit with
   `grep -rn "Sync(" src/`. Use async reads (and your platform's in-memory cache
   if it has one).
3. **Offload genuinely heavy compute to a worker thread** — *only if* a tool does
   real CPU-bound work (e.g. replaying history). If your point-in-time query is an
   O(n) projection over the cached index (not an O(history) replay), you don't
   need this; prefer materializing snapshots into the index over adding a worker.
4. **Per-agent in-flight cap for fairness.** Beyond the global concurrency cap +
   per-client rate limit, cap the in-flight requests **per agent identity**
   (`MAX_CONCURRENT_PER_AGENT`, e.g. 12; applies to all clients incl. loopback),
   so one agent's bulk/background job can't starve another's interactive query.
   Over the cap → 429 + `Retry-After`. Generous enough that interactive use never
   hits it.

Constants worth naming: `RATE_WINDOW_MS`, `RATE_MAX_REQUESTS`,
`MAX_CONCURRENT_REQUESTS`, `MAX_CONCURRENT_PER_AGENT`, `REQUEST_TIMEOUT_MS`,
output caps (`MAX_NOTE_CONTENT_CHARS`, `MAX_SEARCH_RESULTS`, …).

---

## 8. Agent identity (fairness key + optional live UI)

Agents typically **share one token**, so identity comes from the request, not auth:

- On MCP `initialize`, read `params.clientInfo.name`, mint a short session id,
  store `sessionId → {name, lastSeen}` (bounded map + TTL, e.g. 64 sessions / 30 min),
  and return it as `Mcp-Session-Id`. Subsequent MCP requests carry that header.
- `agentLabel(req)` = the session's name (via `Mcp-Session-Id`) **else** the
  `User-Agent`, sanitized to a short token, else `"agent"`.

Use the label as the per-agent fairness key (§7 M4) and pass it to the optional
`onTraversal(paths, tool, agent)` callback so a viewer can colour/label each
agent's activity. Identity is best-effort — never make correctness depend on it.

---

## 9. Tools & REST surface

Define tools once (`toolDefs()` → `{name, description, inputSchema}`), dispatch
in one `callTool(name, args, agent?)`. Wrap query tools so they emit the traversal
callback; leave "whole-dataset" tools (overview/export) unwrapped so they don't
light up everything.

Kosmos's read-only set (adapt to your domain):

| Tool / REST | Returns |
|---|---|
| `vault_overview` — `GET /overview` | counts, areas, edge stats, diagnostics |
| `search_notes` — `GET /notes?q=&tag=&area=&limit=` | lexical hits with status |
| `get_note` — `GET /note?path=|title=` | content (capped) + links + lineage |
| `get_lineage` — `GET /lineage?…` | canonical chain, oldest→newest, HEAD marked |
| `get_related` — `GET /related?…` | semantic + outgoing + backlinks |
| `graph_at_time` — `GET /at?time=ISO` | point-in-time snapshot (validity intervals) |
| `export_graphiti_episodes` — `GET /episodes` | paginated ingestable episodes (`cursor`, max 100/page) |
| — `GET /health`, `/`, `/diagnostics`, `/graph` | liveness + service descriptor |

Cap every output (note bodies, result counts, export size). Truncate with a
visible `"…truncated"` marker rather than streaming unbounded data.

---

## 10. Client configuration

**Anthropic Claude Code — native HTTP.** `.mcp.json` where you run `claude`:
```json
{
  "mcpServers": {
    "my-connector": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:4816/mcp",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```
or `claude mcp add --transport http --header "Authorization: Bearer <TOKEN>" my-connector "http://127.0.0.1:4816/mcp"`.

**OpenAI Codex / ChatGPT desktop / Codex IDE** share `config.toml`:
```toml
[mcp_servers.my-connector]
url = "http://127.0.0.1:4816/mcp"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

**Claude Desktop / stdio-only clients** use the bundled first-party adapter:
```json
{ "mcpServers": { "my-connector": {
  "command": "node",
  "args": ["<PLUGIN-DIRECTORY>/kosmos-mcp-stdio.mjs"],
  "env": { "KOSMOS_MCP_URL": "http://127.0.0.1:4816/mcp", "KOSMOS_MCP_TOKEN": "<TOKEN>" }
}}}
```

**Any HTTP client:** `curl -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:4816/health`.

Ship a committed `.mcp.json.example` and **gitignore the filled `.mcp.json`** (it
holds the token). Never commit `data.json`/settings that persist the token.

---

## 11. Verification

Unit tests (plain `node --test`, no browser): auth on/off + empty-token fail-closed,
query-token rules, Host/Origin accept/reject, byte-limit 413, output-cap truncation,
MCP version negotiation (each supported echoed; unknown → latest), `initialize`
issues `Mcp-Session-Id`, lifecycle headers are enforced, DELETE terminates,
malformed JSON-RPC/tool calls fail correctly, sensitivity filtering holds,
agent identity flows to `onTraversal`, and the per-agent cap returns 429.

End-to-end MCP probe (mimics a real client — run against a started server):

```js
// POST /mcp with Accept: application/json, text/event-stream
// 1) initialize {protocolVersion:"2025-11-25", capabilities:{},
//                clientInfo:{name:"probe",version:"1"}}
//      → 200, negotiated version, Mcp-Session-Id header
// 2) notifications/initialized + Mcp-Session-Id + MCP-Protocol-Version → 202
// 3) tools/list + both headers                                          → annotated tool set
// 4) tools/call + both headers → text + structuredContent
```

If all four steps pass and `.mcp.json` connects from Claude Code, the connector
is live.

---

## 12. Porting checklist

- [ ] Copy the connector core (the `AgentServer` class + constants + `makeToken`); it has **no** project imports.
- [ ] Implement `AgentDataProvider` over your data source; build the index **once**, update incrementally.
- [ ] Define your `toolDefs()` + `callTool()`; cap every output.
- [ ] Wire settings (port, token, bind mode) + persist the token out of git.
- [ ] Start with `new AgentServer(nodeHttp, settings, provider)`; wire source-change events to your provider's incremental update.
- [ ] (Optional) set `onTraversal` for a live viewer.
- [ ] Add the unit tests in §11 and the MCP probe.
- [ ] Ship `.mcp.json.example`; gitignore `.mcp.json`.

Reference implementation: `src/plugin/agent-server.ts` (core),
`src/plugin/vault-provider.ts` (a provider), `test/agent-api.test.mjs` (tests),
`docs/AGENT-API-CONCURRENCY-STATUS.md` (the mitigation rationale).
