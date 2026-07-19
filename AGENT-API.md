# Vault Kosmos — universal Agent API guide (v0.6.5-alpha.8)

**Read-only · localhost by default · token-protected · MCP 2025-11-25**

> This is the generic guide. In Obsidian, run **Write Agent API guide** to
> create a vault-local copy with the actual address, token, and stdio-adapter
> path filled in.

Vault Kosmos exposes one vendor-neutral MCP Streamable HTTP endpoint. Anthropic,
OpenAI, and other harnesses use the same tools and protocol; their config files
are only setup conveniences. Source notes and accepted OKF+ semantic events are
authoritative. API responses and Graphiti episodes are read projections.
Kosmos-Oden implements the OKF+ v2.3 Validating Projection Profile, not a full
GKOS governance engine.

## Start the connector

1. Open **Obsidian → Settings → Community plugins → Vault Kosmos**.
2. Enable **local Agent API**.
3. Keep **Require auth token** enabled.
4. Choose the highest OKF+ sensitivity agents may read. The default is
   `internal`; `confidential` and `phi` remain hidden until explicitly enabled.

The default endpoint is `http://127.0.0.1:4816/mcp`. LAN mode is opt-in and
refuses to start without a token.

## Quick connect

The settings page has copy buttons for every configuration below.

### Anthropic Claude Code

```bash
claude mcp add --transport http --header "Authorization: Bearer <TOKEN>" vault-kosmos "http://127.0.0.1:4816/mcp"
```

Project-scoped `.mcp.json`:

```json
{
  "mcpServers": {
    "vault-kosmos": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:4816/mcp",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

### OpenAI Codex, ChatGPT desktop, and Codex IDE

These clients share Codex `config.toml` on the same desktop host:

```toml
[mcp_servers.vault-kosmos]
url = "http://127.0.0.1:4816/mcp"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

You can instead use **Settings → MCP servers → Add server**, select
**Streamable HTTP**, and enter the URL and bearer token. ChatGPT web cannot
reach a localhost service; use the desktop Codex host for this connector.

### Claude Desktop and stdio-only harnesses

The release ships `kosmos-mcp-stdio.mjs`, a first-party adapter that preserves
the MCP session and protocol headers. It replaces the old downloaded
`mcp-remote` bridge.

```json
{
  "mcpServers": {
    "vault-kosmos": {
      "command": "node",
      "args": ["<PLUGIN-DIRECTORY>/kosmos-mcp-stdio.mjs"],
      "env": {
        "KOSMOS_MCP_URL": "http://127.0.0.1:4816/mcp",
        "KOSMOS_MCP_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

Node.js 18 or newer is required for the adapter.

### Any Streamable HTTP harness

- URL: `http://127.0.0.1:4816/mcp`
- Header: `Authorization: Bearer <TOKEN>`
- Transport: MCP Streamable HTTP
- Latest supported revision: `2025-11-25`

After `initialize`, return both `Mcp-Session-Id` and
`MCP-Protocol-Version` on later requests. Send one JSON-RPC message per POST;
batches are not part of the current transport contract.

## Read tools

| Tool | Result |
|---|---|
| `vault_overview` | Sensitivity-filtered OKF+ projection statistics |
| `search_notes` | Lexical title/alias/tag/path search |
| `get_note` | Readable source body, legacy metadata, v2.3 projection, lineage, and links |
| `get_lineage` | Supersession chain, oldest to newest |
| `get_related` | Explicit `related_to`, legacy Related, outgoing, and backlink neighbors |
| `graph_at_time` | Point-in-time temporal-validity projection |
| `export_graphiti_episodes` | Paginated non-authoritative episodes with stable UUIDs |
| `get_okf_note` | Origin-separated v2.3 validating projection |
| `get_assessment` / `assess_note` | Policy-bound documentation/support assessment for one note |
| `get_diagnostics` / `validate_note` | Stable diagnostics and in-memory validity result |
| `get_effective_labels` | Authored, derived, proposed, approved, and effective labels |
| `get_evidence` | Origin-separated support and contradiction evidence |
| `get_relationships` | UID-resolved typed relationships without proposed-edge promotion |
| `get_policy` | Bundled policy, version, hash, and trust state |
| `assess_vault` | Bounded in-memory assessment summary; no writes |

Assessment scores describe documentation completeness, traceability, and
support under the declared policy. They are not truth scores, approval, or
authorization. Proposed values never enter the effective projection until a
separate authorized decision exists.

Graphiti pages default to 20 episodes and cap at 100. Follow `nextCursor`.
Earlier episodes never receive later `superseded_by`, `head`, or `invalid_at`
state. A valid OKF+ UUID becomes the Graphiti episode UUID, making re-ingestion
idempotent; legacy notes receive a deterministic fallback UUID.

## REST and troubleshooting

Read-only REST mirrors are available at `/overview`, `/diagnostics`, `/graph`,
`/notes`, `/note`, `/lineage`, `/related`, `/at`, paginated `/episodes`, and
the `/okf/` routes listed by the server root. Note selectors accept `uid`,
`path`, or `title`. Validate/assess routes compute in memory and remain GET-only.

- `401`: token missing or stale.
- `400` after initialization: session or protocol-version header missing.
- `404` on MCP: session expired or was terminated; initialize again.
- `403`: disallowed Host/Origin.
- `429`: back off; fairness/rate limit reached.
- No confidential note found: raise the sensitivity ceiling only if policy permits.

Request bodies are byte-capped at 4 MiB, note/episode content is capped, every
response is `Cache-Control: no-store`, and the server exposes no write tool.
