# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories
("Report a vulnerability" on the repository's Security tab) rather than a public
issue. Include the version, a description, and reproduction steps. Expect an
initial response within a reasonable window for a small open-source project.

Do **not** include real vault contents or live tokens in a report.

## Scope

Kosmos-Oden reads a local knowledge vault, builds a graph, and can expose it
over a local (optionally LAN) read-only HTTP + MCP API. Security-relevant areas:

- Agent API authentication, `Host`/`Origin` validation, rate/size limits.
- The plugin iframe trust boundary (sandboxed, `postMessage`-mediated).
- The standalone viewer's read-only directory scanning.
- Optional Nextcloud credentials, remote transport, conflict handling, and
  conditional local/remote writes.
- Build provenance and artifact integrity.

The threat model is documented in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Security properties (enforced, not merely intended)

These invariants are declared in [`kosmos-invariants.yml`](kosmos-invariants.yml)
and enforced by `npm run check:invariants` in CI:

- Agent API is **disabled by default**, binds to **localhost by default**, and
  is **authenticated by default**.
- **LAN mode cannot start without a token.**
- Auth tokens come from a **CSPRNG only** (32 bytes); there is no weak fallback.
- Query-string token auth is **deprecated, off by default, and rejected in LAN mode**.
- The API is **read-only** — no write routes exist.
- Request bodies are capped at **4 MiB (bytes)**; responses set `Cache-Control: no-store`.
- Token comparison is **constant-time**.
- The plugin iframe is **sandboxed without `allow-same-origin`**.
- The standalone artifact has **no external runtime URL dependencies**.

## Handling of secrets

The Agent API token is stored in the plugin's `data.json` (gitignored, never
committed). Tokens are never logged and never placed in URLs by the default
configuration. Regenerating the token invalidates existing clients immediately.

Nextcloud app passwords are stored under a per-vault identifier in Obsidian
Secret Storage (Obsidian 1.11.4+), not in plugin `data.json`. Kosmos-Oden never
logs the password. Prefer a dedicated, revocable Nextcloud app password and
HTTPS; plain HTTP is rejected except for literal private/loopback addresses.
When `.obsidian` synchronization is enabled, Vault Kosmos still forcibly
excludes `.obsidian/plugins/vault-kosmos/data.json` so device-local state and
the Agent API token cannot be synchronized.
