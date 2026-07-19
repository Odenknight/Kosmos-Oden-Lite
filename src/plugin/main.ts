/**
 * Kosmos plugin — Obsidian entry (§22).
 *
 * The 3D view renders inside an isolated iframe whose page (Three.js + Kosmos
 * Core + renderer) is generated at build time from the SAME modular source as
 * the standalone viewer, then embedded here as base64 — local and
 * self-contained, no CDN, works on desktop and mobile.
 *
 * The plugin streams the vault into the iframe: one full snapshot on open,
 * then debounced deltas; the iframe's shared KosmosIndex re-parses only what
 * changed (§10). The Agent API answers from the same core index (§33).
 */
import { ItemView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import EMBED_HTML_B64 from "../../dist/kosmos-embed.html";
import { KOSMOS_VERSION } from "../core/version";
import { GRAPHITI_CORE_VERSION, graphitiIngestionProfile } from "../core/graphiti";
import type { OkfMigrationMode } from "../core/okf-migration";
import { DEFAULT_AGENT_SETTINGS, KosmosAgentServer, makeToken, migrateAgentSettings, type AgentSettings } from "./agent-server";
import { KosmosSettingTab, buildAgentGuide, installedBridgePath } from "./settings";
import { applyNoteTimestamps, timestampEligible } from "../core/timestamps";
import { openOkfMigrationWorkflow } from "./okf-migration";
import { openOkfEnrichmentWorkflow } from "./okf-enrichment";
import { validateRendererMessage, wrap } from "./protocol";
import { VaultDataProvider, attachmentListFrom, folderListFrom, nodeRequire } from "./vault-provider";
import {
  DEFAULT_NEXTCLOUD_SETTINGS,
  NextcloudSyncEngine,
  NextcloudWebDavClient,
  emptyNextcloudState,
  migrateNextcloudSettings,
  migrateNextcloudState,
  syncScope,
  type NextcloudSettings,
  type NextcloudSyncState,
  type SyncSummary,
} from "./nextcloud-sync";

const VIEW_TYPE = "vault-kosmos-view";

/** Decode the self-contained constellation page (Three.js + core + renderer). */
function kosmosHtml(): string {
  const bin = atob(EMBED_HTML_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Fast non-cryptographic content hash (FNV-1a, 32-bit) for change detection. */
function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

class KosmosView extends ItemView {
  private frame: HTMLIFrameElement | null = null;
  private ready = false;                       // iframe loaded + initial snapshot sent
  private hashes = new Map<string, string>();  // path -> last-sent content hash
  private dirty = new Set<string>();           // changed/created paths awaiting a flush
  private removed = new Set<string>();
  private renames: { from: string; to: string }[] = [];
  private structural = false;                  // create/delete/rename happened
  private fileCount = 0;
  private trailing = 0;
  private maxwaitId = 0;
  private deferred = false;                    // a flush was skipped because the view was hidden

  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Vault Kosmos"; }
  getIcon(): string { return "orbit"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("vault-kosmos-root");
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "Vault Kosmos");
    // Defense-in-depth: the renderer is treated as a distinct, opaque-origin
    // context. It needs scripts (WebGL/Three.js), pointer lock (fly mode) and
    // downloads (exports); it does NOT get allow-same-origin, so it cannot reach
    // this window's storage/DOM. Note opening is mediated purely via postMessage.
    // See docs/RENDERER-PROTOCOL.md for the bounded sandbox compatibility result.
    frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-downloads");
    frame.addEventListener("load", () => { void this.sendFull(); });
    frame.srcdoc = kosmosHtml();
    root.appendChild(frame);
    this.frame = frame;
    // open-note / open-folder requests coming back from the 3D view (right-click)
    this.registerDomEvent(window, "message", (ev: MessageEvent) => this.onMessage(ev));
  }

  private onMessage(ev: MessageEvent): void {
    if (!this.frame || ev.source !== this.frame.contentWindow) return;     // only our own iframe
    const data: any = ev.data;
    // Preferred path: versioned, structurally validated envelope.
    const v = validateRendererMessage(data);
    let type: "open-note" | "open-folder" | null = null;
    let path: string | undefined;
    if (v.ok && v.message) {
      type = v.message.type;
      path = (v.message.payload as any).path;
    } else if (data && data.type === "kosmos:open" && typeof data.path === "string") {
      type = "open-note"; path = data.path;               // legacy flat shape (older renderer builds)
    } else if (data && data.type === "kosmos:folder" && typeof data.path === "string") {
      type = "open-folder"; path = data.path;
    } else {
      return;
    }
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    // Folder galaxies must never open or create a note — expand in the file explorer instead.
    if (type === "open-folder" || file instanceof TFolder) {
      if (file instanceof TFolder) this.revealFolder(file);
      return;
    }
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf("tab").openFile(file);               // open the note in a NEW tab
    } else {
      void this.app.workspace.openLinkText(path, "", "tab");               // fall back to link resolution
    }
  }

  /** Reveal + expand a folder in Obsidian's file explorer; silently do nothing if that is unavailable. */
  private revealFolder(folder: TFolder): void {
    try {
      const internal: any = (this.app as any).internalPlugins;
      const fe = internal?.getEnabledPluginById?.("file-explorer") ?? internal?.getPluginById?.("file-explorer")?.instance;
      if (fe && typeof fe.revealInFolder === "function") { fe.revealInFolder(folder); return; }
    } catch (e) { /* file-explorer internals vary by Obsidian version; fail silently */ }
    try {
      const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
      const view: any = leaf?.view;
      if (view && typeof view.revealInFolder === "function") view.revealInFolder(folder);
    } catch (e) { /* same */ }
  }

  private post(msg: any): void {
    if (this.frame && this.frame.contentWindow) this.frame.contentWindow.postMessage(msg, "*");
  }

  /** Live AI-agent traversal (Agent API): light up visited bodies with the emerald trail. */
  agentTraversal(paths: string[], tool: string, agent?: string): void { if (this.ready) this.post(wrap("agent-traversal", { paths, tool, agent })); }

  /** Tell the iframe whether its leaf is visible so it can halt/resume its render loop (CPU/GPU/battery). */
  syncVisibility(): void { this.post(wrap("visibility", { visible: this.isVisible() })); }

  /** Live vault-connectivity signal from the host probe: green/red dot in the header VAULT pill. */
  setVaultStatus(connected: boolean): void { if (this.ready) this.post(wrap("vault-status", { connected })); }

  /** Read the whole vault once and send a full snapshot (initial load / large structural change). */
  async sendFull(): Promise<void> {
    if (!this.frame || !this.frame.contentWindow) return;
    const md = this.app.vault.getMarkdownFiles();
    const files: { relativePath: string; content: string }[] = [];
    this.hashes.clear();
    for (const f of md) {
      const c = await this.app.vault.cachedRead(f);
      files.push({ relativePath: f.path, content: c });
      this.hashes.set(f.path, hashContent(c));
    }
    this.fileCount = md.length;
    this.post(wrap("vault-snapshot", { files, folders: folderListFrom(md), attachments: attachmentListFrom(this.app.vault.getFiles()), label: "Vault" }));
    this.ready = true;
    this.dirty.clear(); this.removed.clear(); this.renames = []; this.structural = false; this.deferred = false;
    this.syncVisibility();
  }

  // --- change notifications from the plugin's event handlers ---
  noteChanged(path: string): void { if (!this.ready) return; this.dirty.add(path); this.schedule(); }
  noteCreated(path: string): void { if (!this.ready) return; this.dirty.add(path); this.structural = true; this.fileCount++; this.schedule(); }
  noteDeleted(path: string): void { if (!this.ready) return; this.removed.add(path); this.dirty.delete(path); this.structural = true; this.fileCount = Math.max(0, this.fileCount - 1); this.schedule(); }
  noteRenamed(path: string, oldPath: string): void { if (!this.ready) return; this.renames.push({ from: oldPath, to: path }); this.dirty.add(path); this.structural = true; this.schedule(); }

  /** Debounce + max-wait, both scaled to vault size so large vaults coalesce more but still update. */
  private delays(): { trailing: number; maxWait: number } {
    const n = this.fileCount;
    const trailing = n > 8000 ? 2500 : n > 3000 ? 1600 : n > 800 ? 1000 : 550;
    return { trailing, maxWait: Math.min(trailing * 5, 12000) };
  }
  private schedule(): void {
    const { trailing, maxWait } = this.delays();
    window.clearTimeout(this.trailing);
    this.trailing = window.setTimeout(() => void this.flush(), trailing);
    if (!this.maxwaitId) this.maxwaitId = window.setTimeout(() => void this.flush(), maxWait);
  }

  private isVisible(): boolean {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    const el = this.containerEl as HTMLElement;
    return !!el && !!el.offsetParent;          // background tabs have no offsetParent
  }
  /** Called when a view becomes active/visible again. */
  flushIfDeferred(): void { if (this.deferred) void this.flush(); }

  private async flush(): Promise<void> {
    window.clearTimeout(this.trailing); window.clearTimeout(this.maxwaitId);
    this.trailing = 0; this.maxwaitId = 0;
    if (!this.ready || !this.frame || !this.frame.contentWindow) return;
    if (!this.isVisible()) { this.deferred = true; return; }   // do no work while hidden (§27)
    this.deferred = false;

    const md = this.app.vault.getMarkdownFiles();
    this.fileCount = md.length;

    // A big structural change (bulk import/delete, sync) is cheaper to rebuild than to diff (§10.2).
    if (this.structural && (this.removed.size + this.dirty.size) > Math.max(500, md.length * 0.25)) {
      await this.sendFull();
      return;
    }

    const byPath = new Map<string, TFile>();
    for (const f of md) byPath.set(f.path, f);

    const changed: { relativePath: string; content: string }[] = [];
    for (const p of this.dirty) {
      const f = byPath.get(p);
      if (!f) continue;                          // deleted or non-markdown
      const c = await this.app.vault.cachedRead(f);
      const h = hashContent(c);
      if (this.hashes.get(p) !== h) { this.hashes.set(p, h); changed.push({ relativePath: p, content: c }); }
    }
    const removed = Array.from(this.removed);
    for (const p of removed) this.hashes.delete(p);
    const renames = this.renames.map((r) => ({ from: r.from, to: r.to }));
    for (const r of renames) { const h = this.hashes.get(r.from); if (h != null) { this.hashes.delete(r.from); this.hashes.set(r.to, h); } }

    const wasStructural = this.structural;
    this.dirty.clear(); this.removed.clear(); this.renames = []; this.structural = false;

    if (!changed.length && !removed.length && !renames.length) return;   // content hashes proved nothing real changed

    const folders = (wasStructural || renames.length) ? folderListFrom(md) : undefined;
    const attachments = attachmentListFrom(this.app.vault.getFiles());
    this.post(wrap("vault-delta", { changed, removed, renames, folders, attachments, label: "Vault" }));
  }

  async onClose(): Promise<void> {
    window.clearTimeout(this.trailing); window.clearTimeout(this.maxwaitId);
    if (this.frame) { try { this.frame.srcdoc = "about:blank"; } catch (e) { /* iframe already detached */ } this.frame = null; }
    this.ready = false;
    this.contentEl.empty();
  }
}

export default class VaultKosmosPlugin extends Plugin {
  agentSettings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
  nextcloudSettings: NextcloudSettings = { ...DEFAULT_NEXTCLOUD_SETTINGS };
  nextcloudState: NextcloudSyncState = emptyNextcloudState();
  nextcloudStatus = "Not configured";
  agentApi!: KosmosAgentServer;
  provider!: VaultDataProvider;

  private eventsLive = false;
  private nextcloudSyncRunning = false;
  private timestampTimers = new Map<string, number>();
  private timestampWriteUntil = new Map<string, number>();

  scheduleTimestamp(file: any, delay = 350): void {
    if (!this.agentSettings.noteTimestampsEnabled || !timestampEligible(file?.path || "", file?.extension || "")) return;
    if ((this.timestampWriteUntil.get(file.path) ?? 0) > Date.now()) return;
    const previous = this.timestampTimers.get(file.path);
    if (previous != null) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.timestampTimers.delete(file.path);
      void this.stampNote(file);
    }, delay);
    this.timestampTimers.set(file.path, timer);
  }

  async stampNote(file: any): Promise<void> {
    if (!this.agentSettings.noteTimestampsEnabled || !timestampEligible(file?.path || "", file?.extension || "")) return;
    try {
      const created = Number(file.stat?.ctime) || Date.now();
      const modified = Number(file.stat?.mtime) || Date.now();
      this.timestampWriteUntil.set(file.path, Date.now() + 2500);
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        applyNoteTimestamps(fm, created, modified, {
          useLocalTimezone: this.agentSettings.timestampUseLocalTimezone,
          createdKey: this.agentSettings.timestampCreatedKey,
          updatedKey: this.agentSettings.timestampUpdatedKey,
        });
      });
    } catch (error) {
      console.warn("Vault Kosmos: could not stamp note timestamps", file?.path, error);
    }
  }

  agentLanUrls(): string[] {
    return this.provider.lanAddresses().map((ip) => `http://${ip}:${this.agentSettings.agentPort}`);
  }

  startAgentApi(): void {
    this.agentApi.start((msg) => new Notice("Vault Kosmos Agent API: " + msg));
    if (this.agentApi.status.startsWith("unavailable")) {
      new Notice("Vault Kosmos: the Agent API needs desktop Obsidian.");
    }
  }

  async onload(): Promise<void> {
    const persisted = await this.loadData();
    this.agentSettings = migrateAgentSettings(persisted);
    this.nextcloudSettings = migrateNextcloudSettings(persisted?.nextcloud);
    if (!persisted?.nextcloud) this.nextcloudSettings.remoteFolder = `Kosmos-Oden/${this.app.vault.getName()}`;
    const scope = syncScope(this.nextcloudSettings);
    this.nextcloudState = migrateNextcloudState(persisted?.nextcloudState, scope);
    this.nextcloudStatus = this.nextcloudSettings.serverUrl ? "Ready" : "Not configured";
    let settingsChanged = false;
    if (!this.agentSettings.agentToken) {
      try {
        this.agentSettings.agentToken = makeToken();
        settingsChanged = true;
      } catch (e: any) {
        // No secure RNG: leave the token empty. With agentRequireToken on, the
        // server rejects every request rather than accepting a weak token (§16).
        console.error("Vault Kosmos:", e);
        new Notice("Vault Kosmos: could not create a secure Agent API token; the API will refuse requests until one exists.");
      }
    }
    if (!this.agentSettings.agentGraphNamespace) {
      try {
        this.agentSettings.agentGraphNamespace = makeToken().slice(0, 16);
        settingsChanged = true;
      } catch (_) { /* token failure above already leaves the API fail-closed */ }
    }
    if (settingsChanged) await this.saveAgentSettings();
    this.provider = new VaultDataProvider(this.app);
    this.agentApi = new KosmosAgentServer(nodeRequire("http"), this.agentSettings, this.provider);
    this.addSettingTab(new KosmosSettingTab(this.app, this));
    if (this.agentSettings.agentEnabled) this.startAgentApi();
    this.addCommand({ id: "write-agent-api-guide", name: "Write Agent API guide (AGENT-API.md) to vault", callback: () => void this.writeAgentGuide() });

    this.registerView(VIEW_TYPE, (leaf) => new KosmosView(leaf));
    this.addRibbonIcon("orbit", "Open Vault Kosmos", () => void this.activate());
    this.addCommand({ id: "open-vault-kosmos", name: "Open Vault Kosmos", callback: () => void this.activate() });
    this.addCommand({
      id: "mark-notes-okf-plus",
      name: "Scan and repair human-editable OKF+ formatting (back up and preview)",
      callback: () => void this.markNotesInOkf(),
    });
    this.addCommand({ id: "propose-okf-plus-enrichment", name: "Re-scan editable OKF+ notes for label and relationship proposals", callback: () => void this.proposeOkfEnrichment() });
    this.addCommand({
      id: "upgrade-all-notes-okf-plus-2-2",
      name: "Convert recoverable notes to editable OKF+ 2.2 (preview first)",
      callback: () => void this.markNotesInOkf("upgrade-all"),
    });
    this.addCommand({
      id: "upgrade-all-notes-okf-plus-2-3",
      name: "Convert recoverable notes to native OKF+ 2.3 (preview first)",
      callback: () => void this.markNotesInOkf("convert-to-23"),
    });
    this.addCommand({ id: "export-graphiti-episodes", name: "Export Graphiti episodes (OKF+)", callback: () => void this.exportGraphitiEpisodes() });
    this.addCommand({ id: "sync-nextcloud-now", name: "Sync vault with Nextcloud now", callback: () => void this.runNextcloudSync(true) });

    // Don't react to the startup metadata-resolve storm; the view's initial load already
    // captures the fully-resolved vault. Only go live once the workspace has settled.
    this.app.workspace.onLayoutReady(() => {
      this.eventsLive = true;
      this.provider.markFullDirty();
      if (this.nextcloudSettings.enabled && this.nextcloudSettings.syncOnStartup) {
        window.setTimeout(() => void this.runNextcloudSync(false), 1500);
      }
    });

    if (this.nextcloudSettings.enabled && this.nextcloudSettings.intervalMinutes > 0) {
      this.registerInterval(window.setInterval(
        () => void this.runNextcloudSync(false),
        this.nextcloudSettings.intervalMinutes * 60_000,
      ));
    }

    const views = (): KosmosView[] =>
      this.app.workspace.getLeavesOfType(VIEW_TYPE)
        .map((l) => l.view)
        .filter((v): v is KosmosView => v instanceof KosmosView);

    // Agent API -> Kosmos views: broadcast each query's touched notes so the traversal renders live.
    this.agentApi.onTraversal = (paths, tool, agent) => { for (const v of views()) v.agentTraversal(paths, tool, agent); };

    // Live vault-connectivity indicator: a cheap read probe (no network stack) —
    // readability of the vault files IS the signal. Green when the adapter can
    // stat the vault root within a short timeout, red on failure/timeout.
    const probeVaultConnectivity = async (): Promise<void> => {
      const leaves = views();
      if (!leaves.length) return; // nothing to paint
      let connected = false;
      try {
        const adapter: any = this.app.vault.adapter;
        const probe = Promise.resolve().then(() => adapter.stat ? adapter.stat(".") : adapter.list?.("."));
        const timeout = new Promise((_, reject) => window.setTimeout(() => reject(new Error("probe timeout")), 2000));
        await Promise.race([probe, timeout]);
        connected = true;
      } catch (_) { connected = false; }
      for (const v of leaves) v.setVaultStatus(connected);
    };
    void probeVaultConnectivity();
    this.registerInterval(window.setInterval(() => void probeVaultConnectivity(), 10_000));

    this.registerEvent(this.app.metadataCache.on("changed", (file: any) => {
      this.provider.markChanged(file.path);
      if (!this.eventsLive) return;
      for (const v of views()) v.noteChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", (file: any) => {
      this.provider.markChanged(file.path);
      this.scheduleTimestamp(file, 150);
      if (!this.eventsLive || file.extension !== "md") return;
      for (const v of views()) v.noteCreated(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file: any) => {
      this.provider.markChanged(file.path);
      this.scheduleTimestamp(file, 900);
    }));
    this.registerEvent(this.app.vault.on("delete", (file: any) => {
      this.provider.markRemoved(file.path);
      if (!this.eventsLive) return;
      for (const v of views()) v.noteDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file: any, oldPath: string) => {
      this.provider.markRenamed(oldPath, file.path);
      if (!this.eventsLive) return;
      for (const v of views()) v.noteRenamed(file.path, oldPath);
    }));

    // When leaf visibility changes: flush deferred data AND gate the iframe's render loop.
    const onShow = () => { for (const v of views()) { v.flushIfDeferred(); v.syncVisibility(); } };
    this.registerEvent(this.app.workspace.on("active-leaf-change", onShow));
    this.registerEvent(this.app.workspace.on("layout-change", onShow));
  }

  async activate(): Promise<void> {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    ws.revealLeaf(leaf);
  }

  async saveAgentSettings(): Promise<void> { await this.savePluginData(); }

  async saveNextcloudSettings(): Promise<void> {
    const scope = syncScope(this.nextcloudSettings);
    if (scope !== this.nextcloudState.scope) this.nextcloudState = emptyNextcloudState(scope);
    await this.savePluginData();
  }

  private async savePluginData(): Promise<void> {
    await this.saveData({ ...this.agentSettings, nextcloud: this.nextcloudSettings, nextcloudState: this.nextcloudState });
  }

  nextcloudSecretId(): string {
    const source = `${this.manifest.id}-${this.app.vault.getName()}`.toLowerCase();
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return `vault-kosmos-nextcloud-${(hash >>> 0).toString(16)}`;
  }

  getNextcloudPassword(): string { return this.app.secretStorage.getSecret(this.nextcloudSecretId()) || ""; }

  setNextcloudPassword(value: string): void { this.app.secretStorage.setSecret(this.nextcloudSecretId(), value); }

  async testNextcloudConnection(): Promise<void> {
    this.nextcloudStatus = "Testing…";
    try {
      await new NextcloudWebDavClient(this.nextcloudSettings, this.getNextcloudPassword()).test();
      this.nextcloudStatus = "Connection successful";
      new Notice("Vault Kosmos: Nextcloud connection successful");
    } catch (e: any) {
      this.nextcloudStatus = `Connection failed: ${e?.message || String(e)}`;
      new Notice(`Vault Kosmos: ${this.nextcloudStatus}`);
    }
  }

  async runNextcloudSync(showNotice = true): Promise<SyncSummary | null> {
    if (this.nextcloudSyncRunning) {
      if (showNotice) new Notice("Vault Kosmos: a Nextcloud sync is already running");
      return null;
    }
    this.nextcloudSyncRunning = true;
    this.nextcloudStatus = "Syncing…";
    try {
      const engine = new NextcloudSyncEngine(
        this.app, this.nextcloudSettings, this.nextcloudState, this.getNextcloudPassword(),
        async (state) => { this.nextcloudState = state; await this.savePluginData(); },
      );
      const result = await engine.run();
      this.provider.markFullDirty();
      this.nextcloudStatus = result.errors.length
        ? `Completed with ${result.errors.length} error(s)`
        : `Synced: ${result.uploaded} up, ${result.downloaded} down, ${result.conflicts.length} conflict(s)`;
      if (showNotice || result.errors.length || result.conflicts.length) new Notice(`Vault Kosmos: ${this.nextcloudStatus}`);
      return result;
    } catch (e: any) {
      this.nextcloudStatus = `Sync failed: ${e?.message || String(e)}`;
      if (showNotice) new Notice(`Vault Kosmos: ${this.nextcloudStatus}`);
      return null;
    } finally { this.nextcloudSyncRunning = false; }
  }

  /** Audit the vault and open the explicit backup/approval gate. No LLM or
   * network route is involved; the core planner refuses ambiguous metadata. */
  async markNotesInOkf(mode: OkfMigrationMode = "safe-onboarding"): Promise<void> {
    await openOkfMigrationWorkflow(this.app, mode, () => this.provider.markFullDirty(), this.agentSettings);
  }

  async proposeOkfEnrichment(): Promise<void> {
    await openOkfEnrichmentWorkflow(this.app, this.agentSettings, () => this.provider.markFullDirty());
  }

  async writeAgentGuide(): Promise<void> {
    const md = buildAgentGuide(
      this.agentSettings.agentPort,
      this.agentSettings.agentToken || "<enable the API to generate a token>",
      this.agentSettings.agentBindMode,
      this.agentLanUrls(),
      installedBridgePath(this.app, this)
    );
    await this.app.vault.adapter.write("AGENT-API.md", md);
    new Notice("Vault Kosmos: wrote AGENT-API.md to your vault root (with your address + token filled in)");
  }

  onunload(): void { this.agentApi?.stop(); }

  /** Export readable source assertions as a non-authoritative Graphiti projection.
   * Stable episode UUIDs make re-ingestion idempotent; later supersession state
   * is not back-propagated into earlier episodes. */
  async exportGraphitiEpisodes(): Promise<void> {
    const episodes = await this.agentApi.qEpisodes();
    await this.app.vault.adapter.write("graphiti-episodes.json", JSON.stringify(episodes, null, 2));
    await this.app.vault.adapter.write("graphiti-ingestion-profile.json", JSON.stringify(graphitiIngestionProfile({ combinedExtraction: this.agentSettings.graphitiCombinedExtraction }), null, 2));
    await this.app.vault.adapter.write("graphiti-ingest-sample.py", SAMPLE_INGEST_PY);
    new Notice(`Vault Kosmos: exported ${episodes.length} KGCP/Graphiti episodes, ingestion profile, and pinned sample script`);
  }
}

/** Sample Graphiti ingestion script written next to the export. */
const SAMPLE_INGEST_PY = `#!/usr/bin/env python3
# Ingest an Obsidian vault (exported by Vault Kosmos v${KOSMOS_VERSION}, OKF+) into Graphiti.
# Graphiti: https://github.com/getzep/graphiti
#
#   pip install "graphiti-core[falkordb]==${GRAPHITI_CORE_VERSION}"   # tested pin; security floor is >=0.28.2
#   docker run -p 6379:6379 -p 3000:3000 --rm falkordb/falkordb:latest
#   export OPENAI_API_KEY=...          # or configure another LLM per the Graphiti docs
#   export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password
#   python graphiti-ingest-sample.py graphiti-episodes.json
import asyncio, json, os, sys, time
from datetime import datetime
from graphiti_core import Graphiti
from graphiti_core.nodes import EpisodeType

async def main(path: str) -> None:
    episodes = json.load(open(path, encoding="utf-8"))
    profile_path = os.path.join(os.path.dirname(path) or ".", "graphiti-ingestion-profile.json")
    profile = json.load(open(profile_path, encoding="utf-8")) if os.path.exists(profile_path) else {}
    if profile.get("combinedExtraction"):
        print("NOTICE: combined extraction was requested, but Graphiti ${GRAPHITI_CORE_VERSION} exposes it only through extract_nodes_and_edges_bulk().")
        print("The stable add_episode API below will remain standard extraction; benchmark results must not claim combined extraction was applied.")
    backend = os.environ.get("GRAPHITI_DB", "falkordb").lower()
    if backend == "falkordb":
        from graphiti_core.driver.falkordb_driver import FalkorDriver
        driver = FalkorDriver(host=os.environ.get("FALKORDB_HOST", "localhost"),
                              port=int(os.environ.get("FALKORDB_PORT", "6379")),
                              username=os.environ.get("FALKORDB_USER"),
                              password=os.environ.get("FALKORDB_PASSWORD"),
                              database=os.environ.get("FALKORDB_DATABASE", "kosmos_oden"))
    elif backend == "neo4j":
        from graphiti_core.driver.neo4j_driver import Neo4jDriver
        driver = Neo4jDriver(uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
                             user=os.environ.get("NEO4J_USER", "neo4j"),
                             password=os.environ.get("NEO4J_PASSWORD", "password"))
    else:
        raise SystemExit("GRAPHITI_DB must be falkordb or neo4j; Kuzu is intentionally unsupported")
    g = Graphiti(graph_driver=driver)
    await g.build_indices_and_constraints()
    started = time.perf_counter()
    completed = 0
    try:
        for e in episodes:  # chronological order preserves OKF+ knowledge chains
            body = json.loads(e["episode_body"])
            saga = body.get("saga") or {}
            await g.add_episode(
                uuid=e["uuid"],
                name=e["name"],
                episode_body=e["episode_body"],
                source=EpisodeType.from_str(e.get("source", "json")),
                source_description=e["source_description"],
                reference_time=datetime.fromisoformat(e["reference_time"].replace("Z", "+00:00")),
                group_id=e.get("group_id"),
                saga=saga.get("id"),
            )
            completed += 1
            print("completed and searchable through the direct core API:", e["name"])
    finally:
        await g.close()
    report = {
        "graphiti_core": "${GRAPHITI_CORE_VERSION}",
        "readiness_boundary": "await Graphiti.add_episode returned",
        "accepted_is_searchable": True,
        "episodes_completed": completed,
        "ingestion_duration_ms": round((time.perf_counter() - started) * 1000, 2),
        "combined_extraction_requested": bool(profile.get("combinedExtraction")),
        "combined_extraction_applied": False,
        "token_cost": None,
        "entity_recall": None,
        "edge_accuracy": None,
        "measurement_notes": "Token telemetry and labeled evaluation fixtures are required for the null quality/cost metrics. Do not invent them."
    }
    report_path = os.path.join(os.path.dirname(path) or ".", "graphiti-ingestion-report.json")
    json.dump(report, open(report_path, "w", encoding="utf-8"), indent=2)
    print("wrote:", report_path)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "graphiti-episodes.json"))
`;
