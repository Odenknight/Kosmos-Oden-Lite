/** Kosmos plugin — settings tab + Agent API setup guide (one source of truth). */
import { App, Notice, PluginSettingTab, Platform, Setting } from "obsidian";
import { COMMON_OKF_DEVELOPER_EXCLUSIONS, normalizeOkfExclusionPatterns } from "../core/okf-exclusions";
import { KOSMOS_VERSION } from "../core/version";
import { LATEST_MCP_PROTOCOL_VERSION, makeToken, type AgentSettings } from "./agent-server";
import { DEFAULT_SYNC_EXCLUDES, PROTECTED_SYNC_EXCLUDES } from "./nextcloud-sync";

export function installedBridgePath(app: App, plugin: any): string {
  try {
    const base = String((app.vault.adapter as any).getBasePath?.() || "").replace(/\\/g, "/");
    const dir = String(plugin?.manifest?.dir || `${app.vault.configDir}/plugins/${plugin?.manifest?.id || "vault-kosmos"}`).replace(/\\/g, "/");
    const pluginDir = /^[A-Za-z]:\//.test(dir) || dir.startsWith("/")
      ? dir.replace(/\/$/, "")
      : `${base ? base.replace(/\/$/, "") + "/" : ""}${dir.replace(/^\//, "")}`;
    return `${pluginDir}/kosmos-mcp-stdio.mjs`;
  } catch {
    return "<installed-plugin-directory>/kosmos-mcp-stdio.mjs";
  }
}

export function buildAgentGuide(port: string | number, token: string, bindMode = "localhost", lanUrls: string[] = [], bridgePath = "<installed-plugin-directory>/kosmos-mcp-stdio.mjs"): string {
  const URLB = `http://127.0.0.1:${port}`;
  const isLan = bindMode === "lan";
  const lanLine = isLan
    ? (lanUrls.length
      ? `**Network access: LAN/VLAN enabled.** Agents on other devices on your network can reach this vault at:\n\n${lanUrls.map((u) => "- \`" + u + "\`").join("\n")}\n\n⚠️ **Anyone on that subnet/VLAN who has the token below can read every note in this vault.** Only enable this on a network you trust (e.g. your home or a private office VLAN), keep the auth token on, and turn it back to Localhost-only in Settings when you don't need remote agents.`
      : `**Network access: LAN/VLAN enabled**, but no network interface was detected on this machine right now.`)
    : `**Network access: Localhost only** (default, recommended). Only this computer can reach the API. To let agents on other devices on your subnet/VLAN connect, go to Settings → Vault Kosmos → **Network access** → *Local network (LAN/VLAN)* — the settings page will then show you the exact address to give them.`;
  return `# Vault Kosmos — Agent API guide (v${KOSMOS_VERSION})

**Read-only · localhost by default · token-protected**

This plugin runs one standards-based MCP endpoint for Anthropic Claude Code, the OpenAI Codex app/CLI/IDE extension, Cursor, and other MCP clients. It exposes the sensitivity-filtered **Kosmos Governed Context Projection (KGCP)** plus paginated OKF+ v2.3 Graphiti-adapter episodes. Source notes and accepted semantic events remain authoritative; the Graphiti export is explicitly non-authoritative. Queries never modify notes.

## 1 · Turn it on (about 30 seconds)

1. Obsidian → **Settings → Community plugins → Vault Kosmos** (gear icon).
2. Toggle **Enable local Agent API** on. The status line should read **running**.
3. Your address is \`${URLB}\` and your token is \`${token}\` — both have **Copy** buttons in settings.

${lanLine}

Desktop only: Obsidian on iPhone/Android can't run local servers, so this feature is unavailable there (the 3D view still works on mobile). If a LAN agent can't connect, your OS firewall may be blocking inbound connections on this port.

## 2 · Connect an agent

### Claude Code (terminal) — native HTTP, no bridge
\`\`\`bash
claude mcp add --transport http --header "Authorization: Bearer ${token}" vault-kosmos "${URLB}/mcp"
\`\`\`

…or save this as \`.mcp.json\` where you run \`claude\` (no \`mcp-remote\` bridge needed):
\`\`\`json
{
  "mcpServers": {
    "vault-kosmos": {
      "type": "streamable-http",
      "url": "${URLB}/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
\`\`\`

Then ask Claude Code things like *"use vault-kosmos to show the lineage of Engine v2"*.

### OpenAI Codex app, CLI, and IDE extension
Codex surfaces share the same configuration layers. Open the MCP server settings or add this to \`config.toml\`:

\`\`\`toml
[mcp_servers.vault-kosmos]
url = "${URLB}/mcp"
http_headers = { Authorization = "Bearer ${token}" }
\`\`\`

Restart the Codex surface after saving. A hosted web client cannot reach a server bound only to your computer's loopback interface.

### Claude Desktop and other stdio-only MCP apps
The release includes a first-party stdio adapter (no \`mcp-remote\` package):

\`\`\`json
{
  "mcpServers": {
    "vault-kosmos": {
      "command": "node",
      "args": [${JSON.stringify(bridgePath)}],
      "env": {
        "KOSMOS_MCP_URL": "${URLB}/mcp",
        "KOSMOS_MCP_TOKEN": "${token}"
      }
    }
  }
}
\`\`\`

Restart the client after saving. Node.js 18+ is required for the adapter.

### Cursor / Windsurf / any Streamable-HTTP MCP client
Add a remote/HTTP MCP server with URL \`${URLB}/mcp\` and header \`Authorization: Bearer ${token}\`.

The endpoint negotiates MCP \`${LATEST_MCP_PROTOCOL_VERSION}\` and compatible earlier revisions. After initialization, clients must return \`Mcp-Session-Id\` and \`MCP-Protocol-Version\` on subsequent requests.

### No MCP? Plain HTTP works too
\`\`\`bash
curl -H "Authorization: Bearer ${token}" "${URLB}/health"
curl -H "Authorization: Bearer ${token}" "${URLB}/lineage?title=Engine%20v2"
curl -H "Authorization: Bearer ${token}" "${URLB}/at?time=2026-04-01"
\`\`\`

> \`?token=\` query authentication is deprecated and off by default; enable it in settings only if a client cannot send headers, and never in LAN mode.

## 3 · What agents can ask (MCP tools)

| Tool | What it gives an agent |
| --- | --- |
| \`vault_overview\` | Sensitivity-filtered projection statistics and diagnostics |
| \`search_notes\` | Lexical search over readable title/alias/source-Markdown-tag/path values |
| \`get_note\` | Readable source content, legacy metadata, OKF+ v2.3 validating projection, lineage, and links |
| \`get_lineage\` | Readable supersession chain oldest → newest |
| \`get_related\` | Explicit \`related_to\`, legacy Related, wikilink, and backlink neighbors |
| \`graph_at_time\` | Temporal-validity snapshot: what was valid vs already superseded at time T |
| \`export_graphiti_episodes\` | Paginated Graphiti JSON episodes with stable UUIDs and no future-state leakage |
| \`graphiti_ingestion_status\` | Export readiness and the required upstream read-after-ingest check |
| \`get_okf_note\` | Origin-separated authored/derived/proposed/approved/effective projection |
| \`get_assessment\` / \`assess_note\` | Policy-bound documentation/support assessment; never truth or authorization |
| \`get_diagnostics\` / \`validate_note\` | Stable diagnostics and in-memory validation |
| \`get_effective_labels\` | Labels separated by origin plus effective labels |
| \`get_evidence\` | Supporting and contradicting evidence separated by origin |
| \`get_relationships\` | UID-resolved typed relationships; proposals remain non-effective |
| \`get_policy\` | Bundled OKF+ 2.3 policy identity, hash, and trust state |
| \`assess_vault\` | Bounded in-memory assessment summary with no writes |

REST mirrors include the legacy routes, \`/graphiti/status\`, and read-only \`/okf/*\` projection,
assessment, diagnostics, label, evidence, relationship, validation, and policy routes (see \`${URLB}/\`).

## 4 · Direct vs. indirect Graphiti

- **Direct (KGCP):** agents read a sensitivity-filtered deterministic OKF+ temporal projection live — no database, no LLM. Search is lexical, not embeddings.
- **Indirect (full Graphiti):** ingest the paginated/exported episodes for entity extraction and hybrid retrieval. Episodes are explicitly non-authoritative, origin-separated adapter projections; source notes and accepted semantic events remain authoritative. Graphiti's LLM may reconstruct different entities.

## 5 · Safety & troubleshooting

- Read-only by design; there are no write endpoints. The default sensitivity ceiling is \`internal\`; confidential/PHI reads require an explicit local policy choice. Request bodies are capped at 4 MiB (measured in bytes).
- **Localhost mode** (default): nothing outside this computer can reach it. The server also validates \`Host\` and \`Origin\` headers to block DNS-rebinding and cross-site requests.
- **LAN mode** (opt-in): any device on the same subnet/VLAN can reach it if it has the token — treat the token like a password.
- Tokens are generated from a cryptographically secure source (32 random bytes). **Regenerate** in settings invalidates old ones instantly.
- **401 unauthorized** → token missing/stale; re-copy from settings. **Port busy** → change the port in settings. **Tools not appearing** → restart the agent app after editing its config.
`;
}

export class KosmosSettingTab extends PluginSettingTab {
  plugin: any;
  private activeSection = "agent-api";
  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s: AgentSettings = this.plugin.agentSettings;
    const nc = this.plugin.nextcloudSettings;
    const sections = this.createSectionTabs(containerEl);
    const agentEl = sections["agent-api"];
    const okfEl = sections["okf-formatting"];
    const connectEl = sections["quick-connect"];
    const syncEl = sections["vault-sync"];

    syncEl.createEl("h2", { text: "Connectivity to Sync Vault" });
    syncEl.createEl("p", {
      text: "Native two-way Nextcloud Files synchronization over WebDAV. Kosmos-Oden compares local and remote state before every write, uses conditional requests, and preserves a conflict copy when both sides changed.",
      cls: "setting-item-description",
    });
    const ncStatus = syncEl.createEl("p", { text: `Nextcloud status: ${this.plugin.nextcloudStatus}` });
    const refreshNc = () => ncStatus.setText(`Nextcloud status: ${this.plugin.nextcloudStatus}`);
    new Setting(syncEl).setName("Enable Nextcloud sync").setDesc("Allows startup and scheduled synchronization. Manual Sync now remains available for connection testing.")
      .addToggle((t) => t.setValue(nc.enabled).onChange(async (v) => { nc.enabled = v; await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Nextcloud server URL")
      .setDesc("Your instance URL, for example https://cloud.example.com. A complete /remote.php/dav/files/... URL is also accepted. HTTPS is required except for literal private/loopback addresses.")
      .addText((t) => t.setPlaceholder("https://cloud.example.com").setValue(nc.serverUrl).onChange(async (v) => { nc.serverUrl = v.trim(); await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Nextcloud username")
      .addText((t) => t.setValue(nc.username).onChange(async (v) => { nc.username = v.trim(); await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Nextcloud app password")
      .setDesc(this.plugin.getNextcloudPassword() ? "Stored in Obsidian Secret Storage. Enter a value only to replace it." : "Create an app password in Nextcloud security settings. It is stored in Obsidian Secret Storage, not data.json.")
      .addText((t) => {
        t.setPlaceholder(this.plugin.getNextcloudPassword() ? "•••••••• (stored)" : "App password");
        t.inputEl.type = "password";
        t.onChange((v) => { if (v) this.plugin.setNextcloudPassword(v); });
      })
      .addButton((b) => b.setButtonText("Clear").setWarning().onClick(() => { this.plugin.setNextcloudPassword(""); new Notice("Nextcloud app password cleared"); this.display(); }));
    new Setting(syncEl).setName("Remote vault folder")
      .setDesc("Folder beneath your Nextcloud files root. Use the same value on every device that shares this vault.")
      .addText((t) => t.setValue(nc.remoteFolder).onChange(async (v) => { nc.remoteFolder = v; await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Connection and synchronization")
      .setDesc("Sync is serialized; a second run cannot overlap an active one.")
      .addButton((b) => b.setButtonText("Test connection").onClick(async () => { await this.plugin.testNextcloudConnection(); refreshNc(); }))
      .addButton((b) => b.setButtonText("Sync now").setCta().onClick(async () => { await this.plugin.runNextcloudSync(true); refreshNc(); }));
    new Setting(syncEl).setName("Sync on startup").setDesc("Runs after Obsidian finishes opening the vault.")
      .addToggle((t) => t.setValue(nc.syncOnStartup).onChange(async (v) => { nc.syncOnStartup = v; await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Scheduled sync")
      .setDesc("Applies after the plugin reloads. Sync never runs concurrently.")
      .addDropdown((d) => d.addOption("0", "Off").addOption("5", "Every 5 minutes").addOption("15", "Every 15 minutes").addOption("30", "Every 30 minutes").addOption("60", "Every hour")
        .setValue(String(nc.intervalMinutes)).onChange(async (v) => { nc.intervalMinutes = Number(v); await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Propagate deletions")
      .setDesc("Off by default: a file missing on one side is restored from the other. When on, an unchanged file deleted on one side is deleted on the other; changed-vs-deleted cases remain conflicts.")
      .addToggle((t) => t.setValue(nc.propagateDeletes).onChange(async (v) => { nc.propagateDeletes = v; await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Sync hidden Obsidian configuration (.obsidian)")
      .setDesc(`Off by default. Enable to sync themes, snippets, hotkeys, and plugin files under .obsidian. Kosmos-Oden's own ${PROTECTED_SYNC_EXCLUDES[0]} always remains excluded because it contains local sync state and Agent API credentials.`)
      .addToggle((t) => t.setValue(nc.syncObsidianConfig).onChange(async (v) => { nc.syncObsidianConfig = v; await this.plugin.saveNextcloudSettings(); }));
    new Setting(syncEl).setName("Hidden-file and path exclusions")
      .setDesc(`One case-insensitive glob per line for individual hidden files or folders. The .obsidian toggle above controls the whole configuration folder. Other defaults: ${DEFAULT_SYNC_EXCLUDES.join(", ")}. Protected paths cannot be overridden.`)
      .addTextArea((area) => {
        area.setValue(nc.excludePatterns.join("\n")).onChange(async (v) => { nc.excludePatterns = v.split(/\r?\n/).map((p: string) => p.trim()).filter(Boolean); await this.plugin.saveNextcloudSettings(); });
        area.inputEl.rows = 4; area.inputEl.cols = 48;
      });

    syncEl.createEl("h3", { text: "Additional storage connectors" });
    syncEl.createEl("p", {
      text: "The four measured follow-on connectors are shown here so availability is explicit. They remain disabled in this beta until their clean-room adapters, authentication flows, conflict recovery, and n+1 partial-failure handling pass the same safety tests as Nextcloud.",
      cls: "setting-item-description",
    });
    for (const provider of [
      ["S3-compatible object storage", "Next implementation target · AWS S3, Cloudflare R2, Backblaze B2, MinIO, and compatible endpoints"],
      ["Dropbox", "Planned · OAuth 2.0 with PKCE and App Folder access"],
      ["Microsoft OneDrive", "Planned · Microsoft Graph App Folder with OAuth 2.0 and PKCE"],
      ["Google Drive", "Planned · Drive file-ID/path mapping with OAuth 2.0 and PKCE"],
    ]) {
      new Setting(syncEl).setName(provider[0]).setDesc(provider[1])
        .addButton((b) => b.setButtonText("Not available in this beta").setDisabled(true));
    }
    new Setting(syncEl).setName("Simultaneous multi-service sync (n+1)")
      .setDesc("Designed as independent replica journals with per-target checkpoints. Disabled until crash-resume, partial failure, conflict fan-out, and deletion propagation are verified across providers.")
      .addButton((b) => b.setButtonText("Safety validation pending").setDisabled(true));

    okfEl.createEl("h2", { text: "GKOS Note Formatting" });
    okfEl.createEl("p", { text: "GKOS note formatting for Kosmos-Oden. It implements the OKF+ v2.3 Validating Projection Profile under GKOS: it preserves authored content, separates authored/derived/proposed/approved data, and does not claim to be a full GKOS governance engine." });
    okfEl.createEl("h3", { text: "Portable note timestamps" });
    okfEl.createEl("p", { text: "Maintains created_at and updated_at timestamps. By default they are ISO 8601 UTC values ending in Z; you can switch to local time with an explicit numeric UTC offset. Existing created_at values are preserved; updated_at follows Obsidian file modifications. Internal .obsidian and .okf files are excluded." });
    new Setting(okfEl).setName("Stamp note creation and modification times")
      .setDesc("Enabled by default. New Markdown notes receive both fields; existing notes receive created_at on their next edit if it is absent.")
      .addToggle((t) => t.setValue(s.noteTimestampsEnabled).onChange(async (v) => { s.noteTimestampsEnabled = v; await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Use local time with UTC offset")
      .setDesc("Off (default) writes UTC/Zulu timestamps ending in Z. On writes ISO 8601 local time with an explicit numeric offset, for example 2026-07-19T14:42:07.000-04:00. Both forms validate as OKF+ 2.2/2.3.")
      .addToggle((t) => t.setValue(s.timestampUseLocalTimezone).onChange(async (v) => { s.timestampUseLocalTimezone = v; await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Created timestamp key")
      .setDesc("Frontmatter key for the creation stamp. Leave as created_at for OKF+ compatibility. Custom keys depart from the OKF+ profiles — the stamped values become plain user frontmatter that the OKF projection does not read.")
      .addText((t) => t.setPlaceholder("created_at").setValue(s.timestampCreatedKey).onChange(async (v) => { s.timestampCreatedKey = v.trim() || "created_at"; await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Updated timestamp key")
      .setDesc("Frontmatter key for the modification stamp. Leave as updated_at for OKF+ compatibility. Custom keys depart from the OKF+ profiles — the stamped values become plain user frontmatter that the OKF projection does not read.")
      .addText((t) => t.setPlaceholder("updated_at").setValue(s.timestampUpdatedKey).onChange(async (v) => { s.timestampUpdatedKey = v.trim() || "updated_at"; await this.plugin.saveAgentSettings(); }));

    agentEl.createEl("h2", { text: "Agent API (HTTP + MCP)" });
    agentEl.createEl("p", { text: "Read-only access to the sensitivity-filtered Kosmos Governed Context Projection (KGCP) through REST and MCP Streamable HTTP. Localhost-only by default, token-protected, and available on desktop Obsidian." });

    const status = agentEl.createEl("p");
    const refresh = () => {
      const running = this.plugin.agentApi?.status === "running";
      status.setText(`Status: ${this.plugin.agentApi?.status || "stopped"}${running ? ` · ${this.plugin.agentApi.url}` : ""}`);
    };
    refresh();

    new Setting(agentEl).setName("Enable local Agent API").setDesc(Platform.isDesktopApp ? "Start the read-only REST and MCP server now and on every launch." : "Unavailable on mobile Obsidian; mobile can still use visualization and vault sync.")
      .addToggle((t) => t.setValue(s.agentEnabled).setDisabled(!Platform.isDesktopApp).onChange(async (v) => {
        s.agentEnabled = v;
        await this.plugin.saveAgentSettings();
        if (v) this.plugin.startAgentApi(); else this.plugin.agentApi.stop();
        setTimeout(refresh, 150);
      }));

    new Setting(agentEl).setName("Port").setDesc("Default 4816. Change if busy; the server restarts automatically.")
      .addText((t) => t.setValue(String(s.agentPort)).onChange(async (v) => {
        const p = Math.floor(Number(v));
        if (!p || p < 1024 || p > 65535) return;
        s.agentPort = p;
        await this.plugin.saveAgentSettings();
        if (s.agentEnabled) { this.plugin.startAgentApi(); setTimeout(refresh, 150); }
      }));

    const netWarn = agentEl.createEl("p");
    const refreshNet = () => {
      if (s.agentBindMode === "lan") {
        const ips = this.plugin.agentLanUrls() as string[];
        netWarn.setText(ips.length ? `⚠️ Reachable on your local network at: ${ips.join(", ")} — anyone on this subnet/VLAN who has the token can read this vault.`
          : "⚠️ LAN mode is on, but no network interface was detected — check your connection.");
        netWarn.style.color = "var(--text-warning, #e0a30f)";
      } else {
        netWarn.setText("Reachable only from this computer (127.0.0.1).");
        netWarn.style.color = "var(--text-muted)";
      }
    };
    new Setting(agentEl).setName("Network access")
      .setDesc("Localhost only = this computer can reach it. Local network (LAN/VLAN) = other devices on the same network can reach it too — keep the auth token on if you enable this.")
      .addDropdown((d) => d.addOption("localhost", "Localhost only (this computer)").addOption("lan", "Local network (LAN/VLAN)")
        .setValue(s.agentBindMode).onChange(async (v: any) => {
          s.agentBindMode = v;
          await this.plugin.saveAgentSettings();
          if (s.agentEnabled) { this.plugin.startAgentApi(); setTimeout(() => { refresh(); refreshNet(); }, 150); } else refreshNet();
        }));
    refreshNet();

    new Setting(agentEl).setName("Require bearer token").setDesc("Recommended. MCP and HTTP clients must present the token below. Always required in LAN mode—the server refuses to bind to the network without it.")
      .addToggle((t) => t.setValue(s.agentRequireToken).onChange(async (v) => {
        s.agentRequireToken = v;
        await this.plugin.saveAgentSettings();
        if (s.agentEnabled) { this.plugin.startAgentApi(); setTimeout(refresh, 150); }
      }));

    new Setting(agentEl).setName("Allow deprecated query-token authentication")
      .setDesc("Deprecated and off by default. Query strings leak through browser history, proxy logs and screenshots. Header auth (Bearer / x-api-key) is preferred. Query tokens are always rejected in LAN mode.")
      .addToggle((t) => t.setValue(s.agentAllowQueryToken).onChange(async (v) => { s.agentAllowQueryToken = v; await this.plugin.saveAgentSettings(); }));

    new Setting(agentEl).setName("Agent API access token").setDesc(s.agentToken || "(none)")
      .addButton((b) => b.setButtonText("Copy").onClick(() => { navigator.clipboard.writeText(s.agentToken); new Notice("Token copied"); }))
      .addButton((b) => b.setButtonText("Regenerate").setWarning().onClick(async () => {
        try {
          s.agentToken = makeToken();
          await this.plugin.saveAgentSettings();
          new Notice("New token generated");
        } catch (e: any) {
          new Notice("Vault Kosmos: " + (e?.message || "token generation failed"));
        }
        this.display();
      }));

    new Setting(agentEl).setName("Agent sensitivity ceiling")
      .setDesc("OKF+ read boundary. Unlabeled legacy notes count as internal. Confidential and PHI stay hidden unless you explicitly raise this ceiling.")
      .addDropdown((d) => d
        .addOption("public", "Public only")
        .addOption("internal", "Internal (recommended)")
        .addOption("restricted", "Include restricted")
        .addOption("confidential", "Include confidential")
        .addOption("regulated", "Include regulated")
        .addOption("phi", "Include PHI (local policy required)")
        .addOption("secret", "Include secret (explicit local policy required)")
        .setValue(s.agentSensitivityCeiling)
        .onChange(async (v: any) => { s.agentSensitivityCeiling = v; await this.plugin.saveAgentSettings(); }));

    agentEl.createEl("h3", { text: "Kosmos Governed Context Projection (KGCP)" });
    agentEl.createEl("p", { text: "KGCP is the deterministic, sensitivity-filtered agent-facing graph. The OKF+ v2.3 Graphiti adapter is an optional non-authoritative semantic-memory projection; inferred facts return as proposals or derived sidecars, never authored governance." });
    new Setting(agentEl).setName("Graphiti combined extraction")
      .setDesc("Experimental and off by default. Graphiti 0.29 exposes this only through a low-level bulk utility, not add_episode. The adapter records the request and required benchmark fields without pretending the standard ingestion path enabled it.")
      .addToggle((t) => t.setValue(s.graphitiCombinedExtraction).onChange(async (v) => { s.graphitiCombinedExtraction = v; await this.plugin.saveAgentSettings(); }));
    new Setting(agentEl).setName("Graphiti saga mapping")
      .setDesc("Off by default. Adds deterministic saga hints for lineage, project history, recurring meetings, research threads, and versioned specifications.")
      .addToggle((t) => t.setValue(s.graphitiSagaMapping).onChange(async (v) => { s.graphitiSagaMapping = v; await this.plugin.saveAgentSettings(); }));

    okfEl.createEl("h3", { text: "Human-editable OKF+ formatting and governed projections" });
    okfEl.createEl("p", {
      text: "Flat OKF+ 2.2 Properties are the human authoring surface: tags and relationship wikilinks can be corrected directly in Obsidian and flow into the cosmos, search, REST, MCP, and Graphiti projection on the next vault update. The 2.3 layer remains a read-only validating projection. The repair scan safely flattens only metadata marked as written by the faulty beta.10 deterministic 2.3 migrator, removes duplicate timestamps and generated boilerplate, and always requires a hash-bound preview plus byte-exact backup.",
      cls: "setting-item-description",
    });
    new Setting(okfEl)
      .setName("Developer-file exclusion preset")
      .setDesc(`Opt in to excluding common agent instruction/control files from OKF migration and enrichment only: ${COMMON_OKF_DEVELOPER_EXCLUSIONS.join(", ")}. They remain visible in the cosmos and Agent API.`)
      .addToggle((toggle) => toggle.setValue(s.okfDeveloperExclusions).onChange(async (value) => { s.okfDeveloperExclusions = value; await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl)
      .setName("Custom OKF exclusions")
      .setDesc("Optional, one case-insensitive pattern per line. Supports *, **, and ?. A bare filename matches at any depth. These exclusions affect only OKF migration, enrichment, and blocked-note review.")
      .addTextArea((area) => {
        area.setPlaceholder("private/**\nDRAFT.md\nprojects/*/generated-?.md").setValue(s.okfExcludePatterns.join("\n")).onChange(async (value) => { s.okfExcludePatterns = normalizeOkfExclusionPatterns(value); await this.plugin.saveAgentSettings(); });
        area.inputEl.rows = 5; area.inputEl.cols = 48;
      });
    new Setting(okfEl)
      .setName("Scan, repair, or convert editable OKF+ metadata")
      .setDesc("Scan previews repairs for beta.10-generated 2.3 metadata and leaves genuinely authored native 2.3 notes unchanged. Convert-all writes flat, Obsidian-editable Properties in either the 2.2 or the 2.3 profile; nested governance blocks are never written into notes.")
      .addButton((b) => b.setButtonText("Scan and repair").onClick(async () => {
        await this.plugin.markNotesInOkf("safe-onboarding");
      }))
      .addButton((b) => b.setButtonText("Convert all to editable 2.2").setCta().onClick(async () => {
        await this.plugin.markNotesInOkf("upgrade-all");
      }))
      .addButton((b) => b.setButtonText("Convert all to editable 2.3").onClick(async () => {
        await this.plugin.markNotesInOkf("convert-to-23");
      }));

    okfEl.createEl("h3", { text: "Content-assisted enrichment proposals" });
    okfEl.createEl("p", { text: "Re-scans editable 2.2 and valid native 2.3 notes. Deterministic evidence selection proposes descriptions, user-selectable Obsidian tags, and explicit relationship wikilinks. Every proposal remains pending until you Accept, Reject, or edit it; accepted Properties update all projections through the normal live vault-change path.", cls: "setting-item-description" });
    new Setting(okfEl).setName("Second-pass provider").setDesc("On-device uses loopback. LAN requires a literal private IP and fresh disclosure. Cloud requires HTTPS and the strictest disclosure policy.").addDropdown((d) => d.addOption("none", "Deterministic only").addOption("local", "On-device model (loopback)").addOption("lan", "LAN model (private IP)").addOption("cloud", "Cloud model (HTTPS)").setValue(s.okfEnrichmentProvider).onChange(async (v: any) => { s.okfEnrichmentProvider = v; await this.plugin.saveAgentSettings(); this.display(); }));
    if (s.okfEnrichmentProvider !== "none") {
      const endpointDescription = s.okfEnrichmentProvider === "local"
        ? "Loopback only, for example http://127.0.0.1:11434/v1/chat/completions."
        : s.okfEnrichmentProvider === "lan"
          ? "Literal private IP only, for example http://192.168.1.40:11434/v1/chat/completions. DNS names and public/bind-all addresses are rejected."
          : "HTTPS only. Confidential and PHI notes are always excluded.";
      new Setting(okfEl).setName("OpenAI-compatible endpoint").setDesc(endpointDescription).addText((t) => t.setValue(s.okfEnrichmentEndpoint).onChange(async (v) => { s.okfEnrichmentEndpoint = v.trim(); await this.plugin.saveAgentSettings(); }));
      new Setting(okfEl).setName("Model").addText((t) => t.setValue(s.okfEnrichmentModel).onChange(async (v) => { s.okfEnrichmentModel = v.trim(); await this.plugin.saveAgentSettings(); }));
      new Setting(okfEl).setName("API key environment variable").setDesc("Variable name only; the secret is never stored in plugin settings. Optional for on-device/LAN endpoints, strongly recommended for LAN, and required for cloud.").addText((t) => t.setPlaceholder("OPENAI_API_KEY").setValue(s.okfEnrichmentApiKeyEnv).onChange(async (v) => { s.okfEnrichmentApiKeyEnv = v.trim(); await this.plugin.saveAgentSettings(); }));
      if (s.okfEnrichmentProvider === "cloud") new Setting(okfEl).setName("Cloud sensitivity ceiling").setDesc("Confidential and PHI are hard-blocked regardless of this setting.").addDropdown((d) => d.addOption("public", "Public only").addOption("internal", "Public + internal").setValue(s.okfEnrichmentCloudCeiling).onChange(async (v: any) => { s.okfEnrichmentCloudCeiling = v; await this.plugin.saveAgentSettings(); }));
      if (s.okfEnrichmentProvider === "lan") new Setting(okfEl).setName("LAN sensitivity ceiling").setDesc("Default is internal. Confidential requires explicit selection and per-run approval. PHI is always excluded from LAN and cloud.").addDropdown((d) => d.addOption("public", "Public only").addOption("internal", "Public + internal").addOption("confidential", "Include confidential").setValue(s.okfEnrichmentLanCeiling).onChange(async (v: any) => { s.okfEnrichmentLanCeiling = v; await this.plugin.saveAgentSettings(); }));
    }
    new Setting(okfEl).setName("Per-run note cap").setDesc("Hard cap: 1–500. Processing is sequential; there are no automatic retries, and three consecutive provider errors stop the run.").addText((t) => t.setValue(String(s.okfEnrichmentMaxNotes)).onChange(async (v) => { s.okfEnrichmentMaxNotes = Math.max(1, Math.min(500, Number(v) || 25)); await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Evidence limits").setDesc("Objective prose-shaped selection only; this cannot guarantee that an author placed meaningful content early.").addText((t) => t.setPlaceholder("paragraphs").setValue(String(s.okfEnrichmentMaxParagraphs)).onChange(async (v) => { s.okfEnrichmentMaxParagraphs = Math.max(1, Math.min(8, Number(v) || 4)); await this.plugin.saveAgentSettings(); })).addText((t) => t.setPlaceholder("characters").setValue(String(s.okfEnrichmentMaxInputChars)).onChange(async (v) => { s.okfEnrichmentMaxInputChars = Math.max(400, Math.min(12000, Number(v) || 4000)); await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Run input budget").setDesc("Hard total evidence budget across the run: 4,000–250,000 characters.").addText((t) => t.setValue(String(s.okfEnrichmentMaxTotalInputChars)).onChange(async (v) => { s.okfEnrichmentMaxTotalInputChars = Math.max(4000, Math.min(250000, Number(v) || 50000)); await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Proposal cap").setDesc("Maximum schema-valid suggestions retained per note (1–24).").addText((t) => t.setValue(String(s.okfEnrichmentMaxSuggestions)).onChange(async (v) => { s.okfEnrichmentMaxSuggestions = Math.max(1, Math.min(24, Number(v) || 12)); await this.plugin.saveAgentSettings(); }));
    if (s.okfEnrichmentProvider !== "none") new Setting(okfEl).setName("Request timeout").setDesc("5–120 seconds per note; timed-out requests are not retried.").addText((t) => t.setValue(String(Math.round(s.okfEnrichmentTimeoutMs / 1000))).onChange(async (v) => { s.okfEnrichmentTimeoutMs = Math.max(5000, Math.min(120000, (Number(v) || 30) * 1000)); await this.plugin.saveAgentSettings(); }));
    new Setting(okfEl).setName("Re-scan editable OKF+ notes").setDesc("Every click reads eligible OKF+ 2.2 and valid native 2.3 notes again. Tags are shown as user-reviewable labels, relationship values stay as Obsidian wikilinks, duplicate queue records are suppressed, and nothing is written automatically.").addButton((b) => b.setButtonText("Scan labels and links").setCta().onClick(async () => { await this.plugin.proposeOkfEnrichment(); }));

    connectEl.createEl("h2", { text: "Quick Connect — Anthropic, OpenAI, and Universal MCP" });
    connectEl.createEl("p", { text: "Copy client-specific connection blocks for the Agent API's MCP Streamable HTTP endpoint, or use the bundled first-party stdio adapter for applications that do not support HTTP transport.", cls: "setting-item-description" });
    const url = () => {
      if (s.agentBindMode === "lan") {
        const ips = this.plugin.agentLanUrls() as string[];
        if (ips.length) return `http://${ips[0].replace(/^https?:\/\//, "").split(":")[0]}:${s.agentPort}`;
      }
      return `http://127.0.0.1:${s.agentPort}`;
    };
    if (s.agentBindMode === "lan") connectEl.createEl("p", { text: "Copy buttons below use your LAN address so remote agents can reach this vault.", cls: "setting-item-description" });
    const bridgePath = installedBridgePath(this.app, this.plugin);
    new Setting(connectEl).setName("Anthropic · Claude Code").setDesc("Copies a native MCP Streamable HTTP command with bearer-token authentication.")
      .addButton((b) => b.setButtonText("Copy command").onClick(() => {
        navigator.clipboard.writeText(`claude mcp add --transport http --header "Authorization: Bearer ${s.agentToken}" vault-kosmos "${url()}/mcp"`);
        new Notice("Claude Code command copied — paste it in a terminal");
      }));
    new Setting(connectEl).setName("Anthropic · Claude Code project").setDesc("Copies a native Streamable HTTP .mcp.json block for a Claude Code project.")
      .addButton((b) => b.setButtonText("Copy .mcp.json").onClick(() => {
        navigator.clipboard.writeText(JSON.stringify({ mcpServers: { "vault-kosmos": { type: "streamable-http", url: `${url()}/mcp`, headers: { Authorization: `Bearer ${s.agentToken}` } } } }, null, 2));
        new Notice(".mcp.json copied — save it next to where you run claude");
      }));
    new Setting(connectEl).setName("OpenAI · Codex app / CLI / IDE").setDesc("Copies config.toml for the shared Codex MCP configuration layers used across Codex surfaces.")
      .addButton((b) => b.setButtonText("Copy OpenAI config").onClick(() => {
        navigator.clipboard.writeText(`[mcp_servers.vault-kosmos]\nurl = "${url()}/mcp"\nhttp_headers = { Authorization = "Bearer ${s.agentToken}" }\n`);
        new Notice("OpenAI config.toml block copied");
      }));
    new Setting(connectEl).setName("Anthropic · Claude Desktop / stdio clients").setDesc("Copies stdio JSON using the bundled first-party adapter; no mcp-remote dependency.")
      .addButton((b) => b.setButtonText("Copy stdio config").onClick(() => {
        navigator.clipboard.writeText(JSON.stringify({ mcpServers: { "vault-kosmos": { command: "node", args: [bridgePath], env: { KOSMOS_MCP_URL: `${url()}/mcp`, KOSMOS_MCP_TOKEN: s.agentToken } } } }, null, 2));
        new Notice("STDIO connector config copied");
      }));
    new Setting(connectEl).setName("Universal MCP client").setDesc("Copies vendor-neutral MCP Streamable HTTP connection details.")
      .addButton((b) => b.setButtonText("Copy universal config").onClick(() => {
        navigator.clipboard.writeText(JSON.stringify({ name: "vault-kosmos", transport: "streamable-http", url: `${url()}/mcp`, headers: { Authorization: `Bearer ${s.agentToken}` }, protocolVersion: LATEST_MCP_PROTOCOL_VERSION }, null, 2));
        new Notice("Universal MCP connection details copied");
      }));
    new Setting(connectEl).setName("HTTP health check").setDesc("Copies a cURL health check using bearer-token authentication.")
      .addButton((b) => b.setButtonText("Copy cURL").onClick(() => {
        navigator.clipboard.writeText(`curl -H "Authorization: Bearer ${s.agentToken}" "${url()}/health"`);
        new Notice("cURL test copied");
      }));
    new Setting(connectEl).setName("Step-by-step connection guide").setDesc("Writes AGENT-API.md into your vault with your address and token filled in.")
      .addButton((b) => b.setButtonText("Write guide to vault").setCta().onClick(async () => {
        await this.plugin.writeAgentGuide();
      }));
  }

  private createSectionTabs(containerEl: HTMLElement): Record<string, HTMLElement> {
    const definitions = [
      { id: "agent-api", label: "Agent API (HTTP + MCP)" },
      { id: "okf-formatting", label: "GKOS Note Formatting" },
      { id: "quick-connect", label: "Quick Connect MCP" },
      { id: "vault-sync", label: "Connectivity to Sync Vault" },
    ];
    if (!definitions.some((item) => item.id === this.activeSection)) this.activeSection = definitions[0].id;

    const tabList = document.createElement("div");
    tabList.className = "kosmos-settings-tabs";
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Vault Kosmos options sections");
    const panelsHost = document.createElement("div");
    panelsHost.className = "kosmos-settings-panels";
    const buttons = new Map<string, HTMLButtonElement>();
    const panels: Record<string, HTMLElement> = {};

    const activate = (id: string, focus = false) => {
      this.activeSection = id;
      for (const item of definitions) {
        const selected = item.id === id;
        const button = buttons.get(item.id)!;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle("is-active", selected);
        panels[item.id].hidden = !selected;
      }
      if (focus) buttons.get(id)?.focus();
      containerEl.scrollTop = 0;
    };

    for (const item of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kosmos-settings-tab";
      button.id = `kosmos-tab-${item.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `kosmos-panel-${item.id}`);
      button.textContent = item.label;
      button.addEventListener("click", () => activate(item.id));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = definitions.findIndex((entry) => entry.id === this.activeSection);
        const next = event.key === "Home" ? 0 : event.key === "End" ? definitions.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + definitions.length) % definitions.length;
        activate(definitions[next].id, true);
      });
      tabList.appendChild(button);
      buttons.set(item.id, button);

      const panel = document.createElement("section");
      panel.className = "kosmos-settings-panel";
      panel.id = `kosmos-panel-${item.id}`;
      panel.dataset.sectionId = item.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
      panelsHost.appendChild(panel);
      panels[item.id] = panel;
    }

    containerEl.append(tabList, panelsHost);
    activate(this.activeSection);
    return panels;
  }
}
