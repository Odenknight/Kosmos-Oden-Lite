/**
 * Kosmos Agent API — local HTTP + MCP server core (read-only).
 *
 * Framework-free and Obsidian-free so it is unit-testable in plain Node. The
 * plugin instantiates it with Node's http module and a data provider backed
 * by the same Kosmos Core index the viewer renders (§33): `get_lineage`
 * returns exactly the lineage the cosmos displays, and `graph_at_time` uses
 * the same temporal projector as Chrono (§4.1).
 *
 * Security (§15–§17):
 *  - Tokens come from a cryptographically secure RNG ONLY (32 bytes,
 *    base64url). There is no insecure fallback: without WebCrypto, token
 *    creation fails loudly (§16).
 *  - MCP `initialize` negotiates against an explicit supported-version list;
 *    unknown client versions get the server's latest, never an echo (§15).
 *  - Request bodies are limited by ACTUAL BYTES (4 MiB default) using a byte
 *    accumulator, not JS string length (§17).
 *  - Host and Origin headers are validated against the bind mode to block
 *    DNS-rebinding and cross-site requests (§17).
 *  - Read-only: REST is GET-only; MCP exposes query tools only. No write
 *    endpoints exist (§18).
 */
import { projectAtTime, type ProjectableNote } from "../core/temporal";
import { attachGraphitiContent, buildGraphitiEpisodes, graphitiIngestionProfile } from "../core/graphiti";
import { KOSMOS_VERSION } from "../core/version";
import { OKF23_POLICY, OKF23_PROFILE } from "../core/okf23";
import type { KosmosGraph, KosmosNode, OkfSensitivity } from "../core/types";

// Newest first. 2025-11-25 is the current published MCP revision. Older
// revisions remain negotiable for clients that still request them explicitly.
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_MCP_PROTOCOL_VERSION = SUPPORTED_MCP_PROTOCOL_VERSIONS[0];

/** Request-body cap in BYTES (4 MiB). Documented unit: bytes, not JS chars. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type AgentBindMode = "localhost" | "lan";

/** Settings schema version — bump when the shape changes so old data migrates (Doc1 §3.7). */
export const AGENT_SETTINGS_SCHEMA = 7;

export interface AgentSettings {
  /** Settings schema version for migration on load. */
  schemaVersion?: number;
  agentEnabled: boolean;
  agentPort: number;
  agentToken: string;
  agentRequireToken: boolean;
  agentBindMode: AgentBindMode;
  /** Highest OKF+ sensitivity readable through the connector. */
  agentSensitivityCeiling: OkfSensitivity;
  /** Persistent opaque suffix for the Graphiti assertion namespace. */
  agentGraphNamespace: string;
  /** Accept `?token=` query authentication. Deprecated, OFF by default (Doc1 §3.6);
   *  always rejected in LAN mode regardless of this flag. */
  agentAllowQueryToken: boolean;
  /** Maintain portable ISO-8601 UTC created_at/updated_at note fields. */
  noteTimestampsEnabled: boolean;
  /** false (default) = UTC Zulu; true = local ISO-8601 with a numeric ±HH:MM offset. */
  timestampUseLocalTimezone: boolean;
  /** Frontmatter key for the creation stamp (default "created_at"). */
  timestampCreatedKey: string;
  /** Frontmatter key for the modification stamp (default "updated_at"). */
  timestampUpdatedKey: string;
  /** Graphiti 0.29 combined extraction is opt-in until benchmarked. */
  graphitiCombinedExtraction: boolean;
  /** Add deterministic saga hints to exported episodes. */
  graphitiSagaMapping: boolean;
  okfEnrichmentProvider: "none" | "local" | "lan" | "cloud";
  okfEnrichmentEndpoint: string;
  okfEnrichmentModel: string;
  okfEnrichmentApiKeyEnv: string;
  okfEnrichmentMaxNotes: number;
  okfEnrichmentMaxParagraphs: number;
  okfEnrichmentMaxInputChars: number;
  okfEnrichmentMaxTotalInputChars: number;
  okfEnrichmentMaxSuggestions: number;
  okfEnrichmentTimeoutMs: number;
  okfEnrichmentCloudCeiling: "public" | "internal";
  okfEnrichmentLanCeiling: "public" | "internal" | "confidential";
  /** Custom glob-style exclusions used only by OKF migration/enrichment. */
  okfExcludePatterns: string[];
  /** Opt-in exact/common developer and agent-control file preset. */
  okfDeveloperExclusions: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  schemaVersion: AGENT_SETTINGS_SCHEMA,
  agentEnabled: false,
  agentPort: 4816,
  agentToken: "",
  agentRequireToken: true,
  agentBindMode: "localhost",
  agentSensitivityCeiling: "internal",
  agentGraphNamespace: "",
  agentAllowQueryToken: false,
  noteTimestampsEnabled: true,
  timestampUseLocalTimezone: false,
  timestampCreatedKey: "created_at",
  timestampUpdatedKey: "updated_at",
  graphitiCombinedExtraction: false,
  graphitiSagaMapping: false,
  okfEnrichmentProvider: "none",
  okfEnrichmentEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
  okfEnrichmentModel: "",
  okfEnrichmentApiKeyEnv: "",
  okfEnrichmentMaxNotes: 25,
  okfEnrichmentMaxParagraphs: 4,
  okfEnrichmentMaxInputChars: 4000,
  okfEnrichmentMaxTotalInputChars: 50000,
  okfEnrichmentMaxSuggestions: 12,
  okfEnrichmentTimeoutMs: 30000,
  okfEnrichmentCloudCeiling: "public",
  okfEnrichmentLanCeiling: "internal",
  okfExcludePatterns: [],
  okfDeveloperExclusions: false,
};

/** Migrate persisted settings from any prior schema to the current one (Doc1 §3.7). */
export function migrateAgentSettings(raw: any): AgentSettings {
  const s: AgentSettings = Object.assign({}, DEFAULT_AGENT_SETTINGS, raw || {});
  // v1 had no agentAllowQueryToken and accepted query tokens implicitly. Migrating
  // to v2 turns that OFF by default; the user can re-enable it explicitly.
  if (!raw || raw.schemaVersion == null) s.agentAllowQueryToken = false;
  if (!raw || !["public", "internal", "restricted", "confidential", "regulated", "phi", "secret"].includes(raw.agentSensitivityCeiling)) {
    // Existing unlabeled vaults are treated as internal, preserving local
    // behavior while keeping confidential/PHI notes opt-in.
    s.agentSensitivityCeiling = "internal";
  }
  if (!["none", "local", "lan", "cloud"].includes(s.okfEnrichmentProvider)) s.okfEnrichmentProvider = "none";
  if (!["public", "internal"].includes(s.okfEnrichmentCloudCeiling)) s.okfEnrichmentCloudCeiling = "public";
  if (!["public", "internal", "confidential"].includes(s.okfEnrichmentLanCeiling)) s.okfEnrichmentLanCeiling = "internal";
  s.okfExcludePatterns = Array.isArray(s.okfExcludePatterns) ? s.okfExcludePatterns.map(String).slice(0, 200) : [];
  s.okfDeveloperExclusions = s.okfDeveloperExclusions === true;
  s.noteTimestampsEnabled = s.noteTimestampsEnabled !== false;
  s.timestampUseLocalTimezone = s.timestampUseLocalTimezone === true;
  s.timestampCreatedKey = typeof s.timestampCreatedKey === "string" && s.timestampCreatedKey.trim() ? s.timestampCreatedKey.trim() : "created_at";
  s.timestampUpdatedKey = typeof s.timestampUpdatedKey === "string" && s.timestampUpdatedKey.trim() ? s.timestampUpdatedKey.trim() : "updated_at";
  s.graphitiCombinedExtraction = s.graphitiCombinedExtraction === true;
  s.graphitiSagaMapping = s.graphitiSagaMapping === true;
  s.okfEnrichmentMaxNotes = Math.max(1, Math.min(500, Number(s.okfEnrichmentMaxNotes) || 25));
  s.okfEnrichmentMaxParagraphs = Math.max(1, Math.min(8, Number(s.okfEnrichmentMaxParagraphs) || 4));
  s.okfEnrichmentMaxInputChars = Math.max(400, Math.min(12000, Number(s.okfEnrichmentMaxInputChars) || 4000));
  s.okfEnrichmentMaxTotalInputChars = Math.max(4000, Math.min(250000, Number(s.okfEnrichmentMaxTotalInputChars) || 50000));
  s.okfEnrichmentMaxSuggestions = Math.max(1, Math.min(24, Number(s.okfEnrichmentMaxSuggestions) || 12));
  s.okfEnrichmentTimeoutMs = Math.max(5000, Math.min(120000, Number(s.okfEnrichmentTimeoutMs) || 30000));
  s.schemaVersion = AGENT_SETTINGS_SCHEMA;
  return s;
}

/** Output caps returned by the read-only API (Doc2 §5.6). */
export const MAX_NOTE_CONTENT_CHARS = 200_000;
export const MAX_SEARCH_RESULTS = 200;
export const MAX_EPISODES = 50_000;
export const DEFAULT_EPISODE_PAGE = 20;
export const MAX_EPISODE_PAGE = 100;

/** Rate + concurrency limits per client (Doc2 §5.4). Enforced in LAN mode; loopback is exempt. */
export const RATE_WINDOW_MS = 10_000;
export const RATE_MAX_REQUESTS = 240;      // ~24 req/s sustained per client
export const MAX_CONCURRENT_REQUESTS = 24;
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Concurrency Mitigation 4 (fairness): cap the in-flight requests any single
 * agent may hold, so one agent's bulk/background work (e.g. a large
 * export_graphiti_episodes) cannot monopolize throughput and starve another
 * agent's interactive query. Applies to ALL clients (local agents are the
 * intended fairness case), keyed by the agent identity behind the request.
 * Generous by design — interactive use never reaches it.
 */
export const MAX_CONCURRENT_PER_AGENT = 12;

/** Agent identity sessions (per-agent trail colour/label + fairness key).
 *  Minted on MCP `initialize` from the client's `clientInfo.name`, echoed back
 *  as `Mcp-Session-Id`. Bounded + TTL'd so the map never grows unbounded. */
export const AGENT_SESSION_TTL_MS = 30 * 60_000;
export const MAX_AGENT_SESSIONS = 64;

class McpRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * Generate an auth token from a cryptographically secure source (§16).
 * 32 random bytes, base64url-encoded. Throws when no secure RNG exists —
 * never silently downgrades to Math.random().
 */
export function makeToken(): string {
  const c: any = (globalThis as any).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error(
      "Vault Kosmos: no cryptographically secure random source (crypto.getRandomValues) is available; refusing to create an insecure token."
    );
  }
  const bytes = new Uint8Array(32);
  c.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface AgentDataProvider {
  /** The shared graph snapshot — the same one the viewer renders (§33). */
  getGraph(): Promise<KosmosGraph>;
  /** Note body with frontmatter stripped, or null when unknown. */
  getNoteContent(path: string): Promise<string | null>;
  vaultName(): string;
  /** Opaque stable-ish identity used to disambiguate Graphiti namespaces. */
  vaultIdentity?(): string;
  /** Extra hostnames (LAN IPs) accepted in Host/Origin checks when binding to LAN. */
  lanAddresses(): string[];
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export class KosmosAgentServer {
  settings: AgentSettings;
  provider: AgentDataProvider;
  private http: any;
  server: any = null;
  status = "stopped";
  private inFlight = 0;
  private hits = new Map<string, number[]>(); // client -> recent request timestamps
  private perAgentInFlight = new Map<string, number>(); // agent identity -> in-flight count (Mitigation 4)
  private sessions = new Map<string, { name: string; at: number; protocolVersion: string; initialized: boolean }>();
  private lanCache: { at: number; ips: string[] } = { at: 0, ips: [] }; // Host validation runs per request; cache the NIC scan
  /** Fired with the note paths one query touched, so the viewer can render a
   *  live agent-traversal trail. Emission is post-hoc from result objects
   *  (queries stay pure) and capped per tool so a broad result never floods
   *  the halo budget (v0.5.1 behavior). vault_overview / export / diagnostics
   *  are not reported — lighting up the entire vault isn't a trail. */
  onTraversal?: (paths: string[], tool: string, agent?: string) => void;

  /** Paths a query result touched, for the live traversal overlay (best-effort, capped). */
  private traversalPaths(tool: string, r: any): string[] {
    try {
      const cap = (a: any[], n: number) => a.slice(0, n).map((x: any) => x && x.path).filter(Boolean);
      if (!r || r.error) return [];
      if (tool === "get_note") return r.path ? [r.path] : [];
      if (tool === "get_lineage") return cap(r.chain || [], 12);
      if (tool === "get_related") return [r.for, ...cap([...(r.semantic || []), ...(r.outgoing || []), ...(r.backlinks || [])], 10)].filter(Boolean);
      if (tool === "search_notes") return cap(r.results || [], 8);
      if (tool === "graph_at_time") return cap(r.valid || [], 6);
      return [];
    } catch (_) { return []; }
  }

  emitTraversal(tool: string, r: any, agent?: string): void {
    if (!this.onTraversal) return;
    const paths = this.traversalPaths(tool, r);
    if (paths.length) { try { this.onTraversal(paths, tool, agent); } catch (_) { /* never break a request */ } }
  }

  /* ---------------- agent identity (per-agent trail + fairness) ---------------- */

  /** Register an MCP session from `initialize` and return its id (echoed as
   *  `Mcp-Session-Id`). Prunes expired sessions and bounds the map size. */
  private pruneSessions(now = Date.now()): void {
    for (const [k, v] of this.sessions) if (now - v.at > AGENT_SESSION_TTL_MS) this.sessions.delete(k);
  }

  private registerSession(name: string, protocolVersion: string): string {
    const now = Date.now();
    this.pruneSessions(now);
    while (this.sessions.size >= MAX_AGENT_SESSIONS) { const first = this.sessions.keys().next().value; if (first === undefined) break; this.sessions.delete(first); }
    const sid = makeToken().slice(0, 22);
    this.sessions.set(sid, { name: this.cleanAgentName(name), at: now, protocolVersion, initialized: false });
    return sid;
  }

  private getSession(id: string): { name: string; at: number; protocolVersion: string; initialized: boolean } | null {
    this.pruneSessions();
    const session = this.sessions.get(id);
    if (!session) return null;
    session.at = Date.now();
    return session;
  }

  /** Trim an agent name/User-Agent to a short, safe display label. */
  private cleanAgentName(s: unknown): string {
    const raw = String(s ?? "").trim();
    if (!raw) return "agent";
    // keep the leading product token (before a version slash/space), bounded
    const first = raw.split(/[\s/]+/)[0] || raw;
    return first.replace(/[^\w.-]/g, "").slice(0, 40) || "agent";
  }

  /** Best-effort identity of the agent behind a request: the MCP session's
   *  clientInfo.name (via `Mcp-Session-Id`), else the User-Agent, else "agent". */
  agentLabel(req: any): string {
    const sid = String(req?.headers?.["mcp-session-id"] || "");
    if (sid) { const s = this.getSession(sid); if (s) return s.name; }
    return this.cleanAgentName(req?.headers?.["user-agent"]);
  }

  constructor(http: any, settings: AgentSettings, provider: AgentDataProvider) {
    this.http = http;
    this.settings = settings;
    this.provider = provider;
  }

  get bindHost(): string { return this.settings.agentBindMode === "lan" ? "0.0.0.0" : "127.0.0.1"; }
  get url(): string { return `http://127.0.0.1:${this.settings.agentPort}`; }

  /** LAN mode must never run without authentication (Doc1 §3.8, Doc2 §5.3). */
  private lanNeedsAuthButHasNone(): boolean {
    if (this.settings.agentBindMode !== "lan") return false;
    return !this.settings.agentRequireToken || !this.settings.agentToken;
  }

  start(onError?: (msg: string) => void): void {
    if (this.server) this.stop();
    if (!this.http) { this.status = "unavailable (no http module)"; return; }
    if (this.lanNeedsAuthButHasNone()) {
      this.status = "error: LAN mode requires an auth token — enable 'Require auth token' and generate one before binding to the network";
      onError?.(this.status);
      return; // fail closed: never expose the vault to the LAN without auth
    }
    this.inFlight = 0;
    this.hits.clear();
    this.perAgentInFlight.clear();
    this.sessions.clear();
    const srv = this.http.createServer((req: any, res: any) => {
      this.handle(req, res).catch((e: any) => {
        try {
          res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        } catch (_) { /* response already closed */ }
      });
    });
    // Per-connection socket timeout backstops slow-loris style stalls (Doc2 §5.4).
    if (typeof srv.setTimeout === "function") srv.setTimeout(REQUEST_TIMEOUT_MS);
    srv.on("error", (e: any) => {
      this.status = "error: " + (e?.code === "EADDRINUSE" ? `port ${this.settings.agentPort} is busy — pick another port in settings` : (e?.message || e));
      onError?.(this.status);
      this.server = null;
    });
    srv.listen(this.settings.agentPort, this.bindHost, () => { this.status = "running"; });
    this.server = srv;
  }

  stop(): void {
    try { this.server && this.server.close(); } catch (_) { /* already closed */ }
    this.server = null;
    this.status = "stopped";
    this.inFlight = 0;
    this.hits.clear();
    this.perAgentInFlight.clear();
    this.sessions.clear();
  }

  /** Constant-time string comparison — no early return on first mismatch (Doc1 §3.6). */
  private timingSafeEqual(a: string, b: string): boolean {
    const abuf = Buffer.from(String(a), "utf8");
    const bbuf = Buffer.from(String(b), "utf8");
    // Compare against a fixed-length digest so length itself does not leak via timing.
    const pad = Math.max(abuf.length, bbuf.length, 1);
    let diff = abuf.length ^ bbuf.length;
    for (let i = 0; i < pad; i++) diff |= (abuf[i] ?? 0) ^ (bbuf[i] ?? 0);
    return diff === 0;
  }

  /** Sliding-window rate limit + concurrency cap, applied to non-loopback clients. */
  private rateLimited(req: any): { limited: boolean; reason?: string } {
    const remote = String(req.socket?.remoteAddress || "");
    const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1" || remote === "";
    if (isLoopback) return { limited: false }; // local agents are trusted for throughput
    if (this.inFlight >= MAX_CONCURRENT_REQUESTS) return { limited: true, reason: "too many concurrent requests" };
    const now = performance.now();
    const arr = (this.hits.get(remote) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (arr.length >= RATE_MAX_REQUESTS) { this.hits.set(remote, arr); return { limited: true, reason: "rate limit exceeded" }; }
    arr.push(now);
    this.hits.set(remote, arr);
    return { limited: false };
  }

  /* ---------------- security gates ---------------- */

  private allowedHostnames(): Set<string> {
    const allowed = new Set(LOCAL_HOSTNAMES);
    if (this.settings.agentBindMode === "lan") {
      const now = Date.now();
      if (now - this.lanCache.at > 60_000) this.lanCache = { at: now, ips: this.provider.lanAddresses() };
      for (const ip of this.lanCache.ips) allowed.add(ip.toLowerCase());
    }
    return allowed;
  }

  /** Host-header validation (DNS-rebinding defence, §17). */
  hostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    let hostname = String(hostHeader).trim().toLowerCase();
    // strip port — handle [v6]:port and host:port
    const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(hostname);
    if (v6) hostname = v6[1];
    else if (hostname.includes(":")) hostname = hostname.split(":")[0];
    return this.allowedHostnames().has(hostname);
  }

  /** Origin validation: absent = non-browser client (allowed); otherwise must be local (§17). */
  originAllowed(originHeader: string | undefined): boolean {
    if (originHeader == null || originHeader === "") return true;
    const o = String(originHeader).trim().toLowerCase();
    if (o === "null") return false; // opaque origins (sandboxed/file iframes of arbitrary sites)
    try {
      const u = new URL(o);
      return this.allowedHostnames().has(u.hostname);
    } catch {
      return false;
    }
  }

  authorized(req: any, urlObj: URL): boolean {
    const s = this.settings;
    if (!s.agentRequireToken) return true;
    if (!s.agentToken) return false;
    const token = s.agentToken;
    // Header auth is the documented default (Doc1 §3.6). Constant-time compare.
    const h = String(req.headers["authorization"] || "");
    if (h.toLowerCase().startsWith("bearer ") && this.timingSafeEqual(h.slice(7).trim(), token)) return true;
    if (this.timingSafeEqual(String(req.headers["x-api-key"] || ""), token)) return true;
    // Query-string tokens are deprecated: opt-in only, and NEVER accepted in LAN
    // mode (query strings leak through history/proxies/logs, Doc1 §3.6).
    if (s.agentAllowQueryToken && s.agentBindMode !== "lan") {
      const q = urlObj.searchParams.get("token");
      if (q != null && this.timingSafeEqual(q, token)) return true;
    }
    return false;
  }

  /** Read the body with a BYTE limit (§17): received_bytes > limit -> reject.
   *  On rejection the request stream is paused (not destroyed) so the 413
   *  response can still reach the client; the connection closes after it. */
  readBody(req: any, limit = MAX_BODY_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: any[] = [];
      let receivedBytes = 0;
      let done = false;
      const onData = (c: any) => {
        receivedBytes += typeof c === "string" ? Buffer.byteLength(c) : c.length;
        if (receivedBytes > limit) {
          done = true;
          req.removeListener("data", onData);
          req.pause();
          reject(Object.assign(new Error(`body too large (limit ${limit} bytes)`), { statusCode: 413 }));
          return;
        }
        chunks.push(typeof c === "string" ? Buffer.from(c) : c);
      };
      req.on("data", onData);
      req.on("end", () => { if (!done) resolve(Buffer.concat(chunks).toString("utf8")); });
      req.on("error", (e: any) => { if (!done) reject(e); });
    });
  }

  json(res: any, code: number, obj: any, extraHeaders?: Record<string, string>): void {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(extraHeaders || {}) });
    res.end(body);
  }

  /* ---------------- shared query helpers (one graph, §33) ---------------- */

  private sensitivityRank(value: OkfSensitivity | undefined): number {
    // Unlabeled legacy notes are private workspace material, not public data.
    return ({ public: 0, internal: 1, restricted: 2, confidential: 3, regulated: 4, phi: 5, secret: 6 } as Record<string, number>)[value || "internal"] ?? 6;
  }

  private canRead(n: KosmosNode): boolean {
    const effective = n.okf?.projection?.effective.sensitivity;
    return this.sensitivityRank(typeof effective === "string" ? effective as OkfSensitivity : n.okf?.sensitivity) <= this.sensitivityRank(this.settings.agentSensitivityCeiling);
  }

  private fileNodes(graph: KosmosGraph): KosmosNode[] {
    return graph.nodes.filter((n) => n.kind === "file" && this.canRead(n));
  }

  private visibleTemporal(
    n: KosmosNode,
    graph: KosmosGraph,
    visible = new Set(this.fileNodes(graph).map((x) => x.id)),
    byId = new Map(graph.nodes.map((x) => [x.id, x]))
  ): { head: boolean; invalidAt: string | null } {
    const successors = (n.okf?.supersededByIds ?? [])
      .filter((id) => visible.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean) as KosmosNode[];
    const times = successors.map((x) => Date.parse(x.validAt || "")).filter((x) => !Number.isNaN(x));
    const participates = successors.length > 0 || (n.okf?.supersedesIds ?? []).some((id) => visible.has(id));
    return {
      head: participates && successors.length === 0,
      invalidAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    };
  }

  private brief(n: KosmosNode, graph?: KosmosGraph, visible?: Set<string>, byId?: Map<string, KosmosNode>): any {
    const temporal = graph ? this.visibleTemporal(n, graph, visible, byId) : { head: !!n.okf?.head, invalidAt: n.okf?.invalidAt ?? null };
    return {
      id: n.id, uid: n.okf?.uid ?? null,
      title: n.label, path: n.path, type: n.okf?.type || n.type || "note", area: n.area, tags: n.tags,
      sensitivity: n.okf?.projection?.effective.sensitivity ?? n.okf?.sensitivity ?? "internal",
      timestamp: n.validAt ?? null,
      head: temporal.head,
      superseded: temporal.invalidAt != null,
      invalidAt: temporal.invalidAt,
    };
  }

  private findNode(graph: KosmosGraph, sel: { path?: string; title?: string; uid?: string }): KosmosNode | null {
    const files = this.fileNodes(graph);
    if (sel.uid) {
      const uid = sel.uid.trim();
      const hit = files.find((n) => n.okf?.projection?.authored.uid === uid || n.okf?.uid === uid);
      if (hit) return hit;
    }
    if (sel.path) {
      const p = sel.path.trim();
      const hit = files.find((n) => n.path === p) ??
        files.find((n) => n.path.toLowerCase() === p.toLowerCase()) ??
        files.find((n) => n.path.toLowerCase() === (p + ".md").toLowerCase());
      if (hit) return hit;
    }
    const q = (sel.title ?? sel.path ?? "").trim().toLowerCase();
    if (!q) return null;
    return (
      files.find((n) => n.label.toLowerCase() === q) ??
      files.find((n) => n.aliases.some((a) => a.toLowerCase() === q)) ??
      files.find((n) => (n.okf?.title || "").toLowerCase() === q) ??
      null
    );
  }

  private projectables(graph: KosmosGraph): ProjectableNote[] {
    const out: ProjectableNote[] = [];
    const visible = new Set(this.fileNodes(graph).map((n) => n.id));
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const n of this.fileNodes(graph)) {
      const v = n.validAt ? Date.parse(n.validAt) : NaN;
      if (Number.isNaN(v)) continue;
      const visibleInvalidAt = this.visibleTemporal(n, graph, visible, byId).invalidAt;
      const inv = visibleInvalidAt ? Date.parse(visibleInvalidAt) : null;
      out.push({ id: n.id, validAtMs: v, invalidAtMs: inv != null && !Number.isNaN(inv) ? inv : null });
    }
    return out;
  }

  /* ---------------- queries (shared by REST + MCP tools) ---------------- */

  async qOverview(): Promise<any> {
    const graph = await this.provider.getGraph();
    const ns = this.fileNodes(graph);
    const visible = new Set(ns.map((n) => n.id));
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const temporal = ns.map((n) => this.visibleTemporal(n, graph, visible, byId));
    const points = ns.flatMap((n, i) => {
      const out = n.validAt ? [Date.parse(n.validAt)] : [];
      if (temporal[i].invalidAt) out.push(Date.parse(temporal[i].invalidAt as string));
      return out.filter((x) => !Number.isNaN(x));
    });
    return {
      vault: this.provider.vaultName(),
      version: KOSMOS_VERSION,
      readOnly: true,
      okfAuthority: "source notes + accepted semantic events; this API is a read projection",
      okfProfile: "OKF+ v2.3 Validating Projection Profile (not full GKOS; no governed writer)",
      sensitivityCeiling: this.settings.agentSensitivityCeiling,
      notes: ns.length,
      areas: [...new Set(ns.map((n) => n.area))].sort(),
      okfNotes: ns.filter((n) => n.okf).length,
      okf23Notes: ns.filter((n) => n.okf?.projection?.sourceVersion === "2.3").length,
      assessedNotes: ns.filter((n) => n.okf?.projection?.assessment).length,
      heads: temporal.filter((x) => x.head).length,
      superseded: temporal.filter((x) => x.invalidAt).length,
      lineageEdges: graph.links.filter((l) => l.kind === "lineage" && visible.has(l.source) && visible.has(l.target)).length,
      semanticEdges: graph.links.filter((l) => l.kind === "semantic" && visible.has(l.source) && visible.has(l.target)).length,
      timeSpan: points.length > 1 ? { min: Math.min(...points), max: Math.max(...points) } : null,
      diagnostics: await this.safeDiagnostics(graph),
      indexBuiltAt: graph.stats.indexedAt,
    };
  }

  async qDiagnostics(): Promise<any> {
    const graph = await this.provider.getGraph();
    return this.safeDiagnostics(graph);
  }

  private safeDiagnostics(graph: KosmosGraph): any {
    const visible = new Set(this.fileNodes(graph).map((n) => n.id));
    const visibleLinks = graph.links.filter((l) => visible.has(l.source) && (visible.has(l.target) || l.target.startsWith("unresolved:")));
    return {
      notes: visible.size,
      unresolvedLinks: new Set(visibleLinks.filter((l) => l.target.startsWith("unresolved:")).map((l) => l.target)).size,
      lineageEdges: visibleLinks.filter((l) => l.kind === "lineage").length,
      semanticEdges: visibleLinks.filter((l) => l.kind === "semantic").length,
      sensitivityCeiling: this.settings.agentSensitivityCeiling,
      // Global warning strings can contain hidden note titles, so they are not
      // exposed through a sensitivity-filtered connector.
      lineageWarnings: [],
      warningsRedacted: graph.diagnostics.lineageWarnings.length > 0,
      lastFullBuildMs: graph.diagnostics.lastFullBuildMs,
      lastIncrementalUpdateMs: graph.diagnostics.lastIncrementalUpdateMs,
      okf23Diagnostics: this.fileNodes(graph).reduce((sum, n) => sum + (n.okf?.projection?.diagnostics.length ?? 0), 0),
    };
  }

  async qSearch(query: string, opts: { tag?: string; area?: string; limit?: number } = {}): Promise<any> {
    const graph = await this.provider.getGraph();
    const q = String(query || "").toLowerCase();
    const lim = Math.max(1, Math.min(MAX_SEARCH_RESULTS, opts.limit || 20));
    const scored: Array<[number, KosmosNode]> = [];
    for (const n of this.fileNodes(graph)) {
      if (opts.tag && !n.tags.some((t) => t.toLowerCase() === String(opts.tag).toLowerCase())) continue;
      if (opts.area && n.area.toLowerCase() !== String(opts.area).toLowerCase()) continue;
      let s = -1;
      if (!q) s = 0;
      else if (n.label.toLowerCase().startsWith(q)) s = 3;
      else if (n.label.toLowerCase().includes(q)) s = 2;
      else if (n.aliases.some((a) => a.toLowerCase().includes(q)) || n.tags.some((t) => t.toLowerCase().includes(q))) s = 1.5;
      else if (n.path.toLowerCase().includes(q)) s = 1;
      if (s >= 0) scored.push([s, n]);
    }
    scored.sort((a, b) => (b[0] - a[0]) || ((Date.parse(b[1].validAt || "") || 0) - (Date.parse(a[1].validAt || "") || 0)));
    return {
      query,
      method: "lexical (title/alias/tag/path substring; no embeddings)",
      total: scored.length,
      results: scored.slice(0, lim).map(([, n]) => this.brief(n, graph)),
    };
  }

  async qNote(sel: { path?: string; title?: string }): Promise<any> {
    const graph = await this.provider.getGraph();
    const n = this.findNode(graph, sel);
    if (!n) return { error: "note not found", hint: "pass path (e.g. Ideas/Engine v2.md) or title" };
    const visible = new Set(this.fileNodes(graph).map((x) => x.id));
    const nameOf = (id: string) => visible.has(id) ? (graph.nodes.find((x) => x.id === id)?.label ?? id) : null;
    const outgoing = graph.links.filter((l) => l.source === n.id && visible.has(l.target) && l.kind !== "contains" && l.kind !== "lineage").map((l) => l.target);
    const backlinks = graph.links.filter((l) => l.target === n.id && visible.has(l.source) && l.kind !== "contains" && l.kind !== "lineage").map((l) => l.source);
    const semantic = graph.links.filter((l) => l.source === n.id && visible.has(l.target) && l.kind === "semantic").map((l) => l.target);
    const content = await this.provider.getNoteContent(n.path);
    return {
      ...this.brief(n, graph, visible),
      aliases: n.aliases,
      okf: n.okf ? {
        okf_version: n.okf.okfVersion,
        uid: n.okf.uid,
        description: n.okf.description,
        epistemic_state: n.okf.epistemicState,
        scope: n.okf.scope,
        scope_id: n.okf.scopeId,
        sensitivity: n.okf.projection?.effective.sensitivity ?? n.okf.sensitivity ?? "internal",
        supersedes: (n.okf.supersedesIds ?? []).map(nameOf).filter(Boolean),
        superseded_by: (n.okf.supersededByIds ?? []).map(nameOf).filter(Boolean),
        declared_supersedes: n.okf.supersedes,
        declared_superseded_by: n.okf.supersededBy,
        forked_from: n.okf.forkedFrom,
        forked_to: n.okf.forkedTo,
        typed_relationships: n.okf.relations,
        related: n.okf.related,
        validating_projection: n.okf.projection ? {
          profile: n.okf.projection.profile,
          source_version: n.okf.projection.sourceVersion,
          authored: n.okf.projection.authored,
          derived: n.okf.projection.derived,
          proposed: n.okf.projection.proposed,
          approved: n.okf.projection.approved,
          effective: n.okf.projection.effective,
          extensions: n.okf.projection.extensions,
          assessment: n.okf.projection.assessment,
          diagnostics: n.okf.projection.diagnostics,
        } : null,
      } : null,
      links: { outgoing, backlinks, semantic },
      content: this.capContent(content ?? ""),
    };
  }

  private async okfNode(sel: { path?: string; title?: string; uid?: string }): Promise<{ graph: KosmosGraph; node: KosmosNode } | null> {
    const graph = await this.provider.getGraph();
    const node = this.findNode(graph, sel);
    return node ? { graph, node } : null;
  }

  async qOkfNote(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    if (!found) return { error: "note not found" };
    const p = found.node.okf?.projection;
    if (!p) return { error: "note has no OKF+ validating projection", path: found.node.path };
    return {
      profile: p.profile, conformanceClaim: p.conformanceClaim, mode: p.mode,
      source: { path: p.sourcePath, version: p.sourceVersion, contentHash: p.contentHash },
      authored: p.authored, derived: p.derived, proposed: p.proposed,
      approved: p.approved, effective: p.effective, extensions: p.extensions,
    };
  }

  async qAssessment(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    return found?.node.okf?.projection?.assessment ?? { error: "assessment not found" };
  }

  async qOkfDiagnostics(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    const p = found?.node.okf?.projection;
    return p ? { targetUid: p.authored.uid ?? null, path: p.sourcePath, count: p.diagnostics.length, diagnostics: p.diagnostics } : { error: "diagnostics not found" };
  }

  async qEffectiveLabels(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    const p = found?.node.okf?.projection;
    return p ? { targetUid: p.authored.uid ?? null, authored: p.authored.labels, derived: p.derived.labels, proposed: p.proposed.labels, approved: p.approved.labels, effective: p.effective.labels } : { error: "labels not found" };
  }

  async qEvidence(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    const p = found?.node.okf?.projection;
    if (!p) return { error: "evidence not found" };
    const pick = (origin: any) => origin.evidence ?? { supports: [], contradicts: [] };
    return { targetUid: p.authored.uid ?? null, authored: pick(p.authored), derived: pick(p.derived), proposed: pick(p.proposed), approved: pick(p.approved), effective: pick(p.effective) };
  }

  async qRelationships(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const found = await this.okfNode(sel);
    const p = found?.node.okf?.projection;
    return p ? { targetUid: p.authored.uid ?? null, authored: p.authored.relationships, derived: p.derived.relationships, proposed: p.proposed.relationships, approved: p.approved.relationships, effective: p.effective.relationships } : { error: "relationships not found" };
  }

  qPolicy(): any {
    return { profile: OKF23_PROFILE, builtIn: true, source: "bundled-read-only-policy", policy: OKF23_POLICY, remoteUpdatesEnabled: false };
  }

  async qValidate(sel: { path?: string; title?: string; uid?: string }): Promise<any> {
    const result = await this.qOkfDiagnostics(sel);
    if (result.error) return result;
    return { ...result, valid: !result.diagnostics.some((d: any) => d.severity === "error" || d.severity === "critical"), sourceUnchanged: true };
  }

  async qAssessVault(limit = 100): Promise<any> {
    const graph = await this.provider.getGraph();
    const assessments = this.fileNodes(graph).flatMap((n) => n.okf?.projection ? [{ path: n.path, ...n.okf.projection.assessment }] : []);
    const cap = Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 100));
    const overall = assessments.map((a) => a.scores.overall).filter((x): x is number => typeof x === "number");
    return { profile: OKF23_PROFILE, readOnly: true, total: assessments.length, returned: Math.min(cap, assessments.length), averageOverall: overall.length ? Math.round(overall.reduce((a, b) => a + b, 0) / overall.length * 10_000) / 10_000 : null, assessments: assessments.slice(0, cap) };
  }

  /** Cap a returned note body so one huge note cannot flood a client (Doc2 §5.6). */
  private capContent(s: string): string {
    if (s.length <= MAX_NOTE_CONTENT_CHARS) return s;
    return s.slice(0, MAX_NOTE_CONTENT_CHARS) + `\n\n…[truncated: note exceeds ${MAX_NOTE_CONTENT_CHARS} characters]`;
  }

  /** Canonical lineage chain — identical to what the viewer displays (§33). */
  async qLineage(sel: { path?: string; title?: string }): Promise<any> {
    const graph = await this.provider.getGraph();
    const n = this.findNode(graph, sel);
    if (!n) return { error: "note not found" };
    const byId = new Map(this.fileNodes(graph).map((x) => [x.id, x]));
    const seen = new Set<string>();
    const chain: KosmosNode[] = [];
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const x = byId.get(id);
      if (!x) return;
      for (const a of (x.okf?.supersedesIds ?? [])) walk(a);
      chain.push(x);
      for (const d of (x.okf?.supersededByIds ?? [])) walk(d);
    };
    walk(n.id);
    chain.sort((a, b) => (Date.parse(a.validAt || "") || 0) - (Date.parse(b.validAt || "") || 0));
    return {
      for: n.path,
      chainLength: chain.length,
      chain: chain.map((x) => ({ ...this.brief(x, graph), current: x.id === n.id })),
    };
  }

  async qRelated(sel: { path?: string; title?: string }): Promise<any> {
    const graph = await this.provider.getGraph();
    const n = this.findNode(graph, sel);
    if (!n) return { error: "note not found" };
    const byId = new Map(this.fileNodes(graph).map((x) => [x.id, x]));
    const b = (id: string) => { const x = byId.get(id); return x ? this.brief(x, graph) : { path: id }; };
    const semantic = graph.links.filter((l) => l.source === n.id && byId.has(l.target) && l.kind === "semantic").map((l) => b(l.target));
    const outgoing = graph.links.filter((l) => l.source === n.id && byId.has(l.target) && l.kind !== "contains" && l.kind !== "lineage").map((l) => b(l.target));
    const backlinks = graph.links.filter((l) => l.target === n.id && byId.has(l.source) && l.kind !== "contains" && l.kind !== "lineage").map((l) => b(l.source));
    return { for: n.path, semantic, outgoing, backlinks };
  }

  /** Point-in-time snapshot — the ONE shared projector (§4.1, §33). */
  async qAtTime(time: string, limit = 50): Promise<any> {
    const graph = await this.provider.getGraph();
    const T = Date.parse(time);
    if (Number.isNaN(T)) return { error: "invalid time; use ISO 8601, e.g. 2026-04-01 or 2026-04-01T00:00:00Z" };
    const projection = projectAtTime(this.projectables(graph), T);
    const byId = new Map(graph.nodes.map((x) => [x.id, x]));
    const briefs = (ids: string[]) => ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => String(b.validAt).localeCompare(String(a.validAt)))
      .map((n: any) => this.brief(n, graph));
    const valid = briefs(projection.valid);
    const superseded = briefs(projection.superseded);
    const cap = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(Number.isFinite(limit) ? limit : 50)));
    return {
      at: projection.at,
      semantics: "temporal validity intervals: valid = written by T and not yet superseded; superseded = a newer version already existed at T; notes with valid_at > T did not exist yet",
      counts: { valid: valid.length, superseded: superseded.length, notYetCreated: projection.notYetCreated.length },
      valid: valid.slice(0, cap),
      superseded: superseded.slice(0, cap),
    };
  }

  private graphForVisibleNodes(graph: KosmosGraph): KosmosGraph {
    const visible = new Set(this.fileNodes(graph).map((n) => n.id));
    return {
      ...graph,
      nodes: graph.nodes.filter((n) => visible.has(n.id)).map((n) => n.okf ? ({
        ...n,
        okf: {
          ...n.okf,
          supersedesIds: (n.okf.supersedesIds ?? []).filter((id) => visible.has(id)),
          supersededByIds: [],
          invalidAt: null,
          head: false,
        },
      }) : n),
      links: graph.links.filter((l) => visible.has(l.source) && visible.has(l.target)),
    };
  }

  async qEpisodes(limit?: number, offset = 0): Promise<any[]> {
    const graph = await this.provider.getGraph();
    const visibleGraph = this.graphForVisibleNodes(graph);
    const all = buildGraphitiEpisodes(visibleGraph, {
      vault: this.provider.vaultName(),
      vaultIdentity: this.provider.vaultIdentity?.(),
      groupId: this.settings.agentGraphNamespace
        ? `okf-${this.provider.vaultName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vault"}-${this.settings.agentGraphNamespace.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}-assertions`
        : undefined,
      corpusId: this.settings.agentGraphNamespace || this.provider.vaultIdentity?.(),
      combinedExtraction: this.settings.graphitiCombinedExtraction,
      sagaMapping: this.settings.graphitiSagaMapping,
      processingTime: graph.stats.indexedAt,
    });
    const start = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
    const cap = limit == null || !Number.isFinite(limit) ? MAX_EPISODES : Math.max(1, Math.min(Math.floor(limit), MAX_EPISODES));
    const episodes = all.slice(start, start + cap);
    const contents = new Map<string, string>();
    for (const episode of episodes) {
      let path = "";
      try { path = String(JSON.parse(episode.episode_body).path || ""); } catch (_) { /* generated JSON */ }
      if (!path) continue;
      const c = await this.provider.getNoteContent(path);
      if (c != null) contents.set(path, c);
    }
    return attachGraphitiContent(episodes, contents);
  }

  async qEpisodePage(offset = 0, limit = DEFAULT_EPISODE_PAGE): Promise<any> {
    const graph = await this.provider.getGraph();
    const visibleGraph = this.graphForVisibleNodes(graph);
    const profile = graphitiIngestionProfile({ combinedExtraction: this.settings.graphitiCombinedExtraction });
    const total = buildGraphitiEpisodes(visibleGraph, {
      vault: this.provider.vaultName(), vaultIdentity: this.provider.vaultIdentity?.(),
      combinedExtraction: this.settings.graphitiCombinedExtraction, sagaMapping: this.settings.graphitiSagaMapping,
      processingTime: graph.stats.indexedAt,
    }).length;
    const start = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));
    const pageSize = Math.max(1, Math.min(Math.floor(Number.isFinite(limit) ? limit : DEFAULT_EPISODE_PAGE), MAX_EPISODE_PAGE));
    const episodes = await this.qEpisodes(pageSize, start);
    const next = start + episodes.length;
    return {
      authority: "non-authoritative Graphiti adapter projection with authored/derived/proposed/approved origin separation",
      adapter: "Kosmos Governed Context Projection",
      ingestionProfile: profile,
      sensitivityCeiling: this.settings.agentSensitivityCeiling,
      total,
      cursor: start,
      nextCursor: next < total ? next : null,
      episodes,
    };
  }

  async qGraphitiIngestionStatus(): Promise<any> {
    const graph = await this.provider.getGraph();
    return {
      state: "export-ready",
      searchable: false,
      reason: "Kosmos-Oden prepares episodes but does not assume a queued Graphiti MCP ingestion is searchable.",
      sourceIndexedAt: graph.stats.indexedAt,
      profile: graphitiIngestionProfile({ combinedExtraction: this.settings.graphitiCombinedExtraction }),
      upstreamCheckRequired: true,
      readyWhen: "Graphiti reports the queued job completed and a read-after-ingest query can retrieve the episode UUID.",
      benchmark: this.settings.graphitiCombinedExtraction ? { state: "measurement-required", metrics: ["token_cost","ingestion_duration_ms","entity_recall","edge_accuracy"] } : { state: "disabled" },
    };
  }

  async qGraph(): Promise<any> {
    const graph = await this.provider.getGraph();
    const visible = new Set(this.fileNodes(graph).map((n) => n.id));
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes = this.fileNodes(graph).map((n) => this.brief(n, graph, visible, byId));
    const links: any[] = [];
    for (const l of graph.links) {
      if (l.kind === "contains" || !visible.has(l.source) || !visible.has(l.target)) continue;
      links.push({ source: l.source, target: l.target, kind: l.kind === "lineage" ? "lineage" : l.kind === "semantic" ? "semantic" : "wikilink" });
    }
    return { builtAt: graph.stats.indexedAt, nodes, links };
  }

  /* ---------------- MCP (Streamable HTTP sessions, read tools only) ---------------- */

  toolDefs(): any[] {
    const sel = {
      path: { type: "string", description: "Vault-relative path, e.g. Ideas/Engine v2.md" },
      title: { type: "string", description: "Note title / basename / alias" },
      uid: { type: "string", description: "Canonical OKF+ UID" },
    };
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const outputSchema = { type: "object", additionalProperties: true };
    const tool = (name: string, title: string, description: string, inputSchema: any) => ({
      name, title, description, inputSchema, outputSchema, annotations,
    });
    const selectionSchema = { type: "object", properties: sel, anyOf: [{ required: ["path"] }, { required: ["title"] }, { required: ["uid"] }], additionalProperties: false };
    return [
      tool("vault_overview", "Vault overview", "Sensitivity-filtered OKF+ projection statistics and diagnostics. Source notes and accepted semantic events remain authoritative.", { type: "object", properties: {}, additionalProperties: false }),
      tool("search_notes", "Search notes", "Lexical search over readable titles, aliases, source Markdown tags, and paths (no embeddings).", { type: "object", properties: { query: { type: "string" }, tag: { type: "string" }, area: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS } }, required: ["query"], additionalProperties: false }),
      tool("get_note", "Get note", "Readable source note content, OKF+ metadata, resolved lineage projection, and links.", selectionSchema),
      tool("get_lineage", "Get lineage", "Readable OKF+ supersession chain ordered oldest to newest.", selectionSchema),
      tool("get_related", "Get related notes", "Readable semantic related_to neighbors, outgoing links, and backlinks.", selectionSchema),
      tool("graph_at_time", "Graph at time", "Point-in-time temporal-validity projection for readable notes.", { type: "object", properties: { time: { type: "string", description: "ISO 8601" }, limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS } }, required: ["time"], additionalProperties: false }),
      tool("export_graphiti_episodes", "Export Graphiti episodes", "Paginated, chronological, non-authoritative Graphiti adapter with origin separation. Stable UUIDs prevent duplicate episode creation on re-ingest.", { type: "object", properties: { cursor: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_EPISODE_PAGE } }, additionalProperties: false }),
      tool("graphiti_ingestion_status", "Graphiti ingestion status", "Reports export readiness and the mandatory upstream read-after-ingest check. Accepted never means searchable.", { type: "object", properties: {}, additionalProperties: false }),
      tool("get_okf_note", "Get OKF+ note projection", "Origin-separated authored, derived, proposed, approved, and effective OKF+ v2.3 projection.", selectionSchema),
      tool("get_assessment", "Get assessment", "Policy-bound deterministic documentation-quality assessment; never a truth or use authorization.", selectionSchema),
      tool("get_diagnostics", "Get OKF+ diagnostics", "Stable structured validation diagnostics for one readable note.", selectionSchema),
      tool("get_effective_labels", "Get effective labels", "Origin-separated labels plus the effective non-proposed projection.", selectionSchema),
      tool("get_evidence", "Get evidence", "Origin-separated supporting and contradicting evidence declarations.", selectionSchema),
      tool("get_relationships", "Get typed relationships", "Authored, derived, proposed, approved, and effective typed relationships.", selectionSchema),
      tool("get_policy", "Get OKF+ policy", "Built-in deterministic OKF+ 2.3 assessment policy and trust state.", { type: "object", properties: {}, additionalProperties: false }),
      tool("validate_note", "Validate note", "Validate one note in memory without modifying source bytes.", selectionSchema),
      tool("assess_note", "Assess note", "Calculate/read one deterministic assessment in memory without modifying source bytes.", selectionSchema),
      tool("assess_vault", "Assess vault", "Bounded in-memory deterministic assessment summary; writes no notes or sidecars.", { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false }),
    ];
  }

  private validateToolArgs(name: string, args: unknown): Record<string, any> {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new McpRpcError(-32602, "tools/call arguments must be an object");
    const a = args as Record<string, any>;
    const known = new Set(this.toolDefs().map((t) => t.name));
    if (!known.has(name)) throw new McpRpcError(-32602, `Unknown tool: ${name}`);
    const allowed: Record<string, string[]> = {
      vault_overview: [],
      search_notes: ["query", "tag", "area", "limit"],
      get_note: ["path", "title"],
      get_lineage: ["path", "title"],
      get_related: ["path", "title"],
      graph_at_time: ["time", "limit"],
      export_graphiti_episodes: ["cursor", "limit"],
      get_okf_note: ["path", "title", "uid"], get_assessment: ["path", "title", "uid"],
      get_diagnostics: ["path", "title", "uid"], get_effective_labels: ["path", "title", "uid"],
      get_evidence: ["path", "title", "uid"], get_relationships: ["path", "title", "uid"],
      get_policy: [], validate_note: ["path", "title", "uid"], assess_note: ["path", "title", "uid"],
      assess_vault: ["limit"],
      graphiti_ingestion_status: [],
    };
    for (const key of Object.keys(a)) if (!allowed[name].includes(key)) throw new McpRpcError(-32602, `Unexpected argument: ${key}`);
    for (const key of ["query", "tag", "area", "path", "title", "uid", "time"]) {
      if (a[key] != null && typeof a[key] !== "string") throw new McpRpcError(-32602, `${key} must be a string`);
    }
    const requireSelector = () => {
      if (!(typeof a.path === "string" && a.path.trim()) && !(typeof a.title === "string" && a.title.trim()) && !(typeof a.uid === "string" && a.uid.trim())) {
        throw new McpRpcError(-32602, `${name} requires path, title, or uid`);
      }
    };
    if (name === "search_notes" && typeof a.query !== "string") throw new McpRpcError(-32602, "search_notes requires string query");
    if (["get_note", "get_lineage", "get_related", "get_okf_note", "get_assessment", "get_diagnostics", "get_effective_labels", "get_evidence", "get_relationships", "validate_note", "assess_note"].includes(name)) requireSelector();
    if (name === "graph_at_time" && typeof a.time !== "string") throw new McpRpcError(-32602, "graph_at_time requires string time");
    const integer = (key: string, min: number, max: number) => {
      if (a[key] == null) return;
      if (!Number.isInteger(a[key]) || a[key] < min || a[key] > max) throw new McpRpcError(-32602, `${key} must be an integer from ${min} to ${max}`);
    };
    integer("limit", 1, name === "export_graphiti_episodes" ? MAX_EPISODE_PAGE : name === "assess_vault" ? 200 : MAX_SEARCH_RESULTS);
    if (name === "export_graphiti_episodes") integer("cursor", 0, Number.MAX_SAFE_INTEGER);
    return a;
  }

  async callTool(name: string, args: any, agent?: string): Promise<any> {
    args = this.validateToolArgs(name, args || {});
    const done = (r: any) => { this.emitTraversal(name, r, agent); return r; };
    switch (name) {
      case "vault_overview": return this.qOverview();
      case "search_notes": return done(await this.qSearch(args.query, args));
      case "get_note": return done(await this.qNote(args));
      case "get_lineage": return done(await this.qLineage(args));
      case "get_related": return done(await this.qRelated(args));
      case "graph_at_time": return done(await this.qAtTime(args.time, args.limit));
      case "export_graphiti_episodes": return this.qEpisodePage(args.cursor ?? 0, args.limit ?? DEFAULT_EPISODE_PAGE);
      case "get_okf_note": return done(await this.qOkfNote(args));
      case "get_assessment": return done(await this.qAssessment(args));
      case "get_diagnostics": return done(await this.qOkfDiagnostics(args));
      case "get_effective_labels": return done(await this.qEffectiveLabels(args));
      case "get_evidence": return done(await this.qEvidence(args));
      case "get_relationships": return done(await this.qRelationships(args));
      case "get_policy": return this.qPolicy();
      case "validate_note": return done(await this.qValidate(args));
      case "assess_note": return done(await this.qAssessment(args));
      case "assess_vault": return this.qAssessVault(args.limit ?? 100);
      case "graphiti_ingestion_status": return this.qGraphitiIngestionStatus();
      default: throw new McpRpcError(-32602, "Unknown tool: " + name);
    }
  }

  /** Negotiate the MCP protocol version (§15). */
  negotiateProtocolVersion(requested: unknown): string {
    if (typeof requested === "string" && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)) return requested;
    return LATEST_MCP_PROTOCOL_VERSION;
  }

  async mcpDispatch(
    msg: any,
    ctx?: {
      agent?: string;
      sessionId?: string;
      session?: { name: string; at: number; protocolVersion: string; initialized: boolean };
      setSessionId?: (sid: string) => void;
    }
  ): Promise<any | null> {
    const requestId = msg && typeof msg === "object" && !Array.isArray(msg) && msg.id !== undefined ? msg.id : null;
    const error = (code: number, message: string, data?: unknown) => ({
      jsonrpc: "2.0", id: requestId,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return error(-32600, "Invalid Request: expected one JSON-RPC 2.0 request or notification");
    }
    const isNotification = msg.id === undefined;
    if (!isNotification && !(typeof msg.id === "string" || (typeof msg.id === "number" && Number.isFinite(msg.id)))) {
      return error(-32600, "Invalid Request: id must be a string or number");
    }
    if (msg.params !== undefined && (!msg.params || typeof msg.params !== "object" || Array.isArray(msg.params))) {
      return isNotification ? null : error(-32602, "Invalid params: expected an object");
    }
    const { id, method, params = {} } = msg;
    const ok = (result: any) => ({ jsonrpc: "2.0", id, result });

    if (isNotification) {
      if (method === "notifications/initialized" && ctx?.session) ctx.session.initialized = true;
      // Unknown notifications are ignored as required by JSON-RPC.
      return null;
    }

    try {
      if (method === "initialize") {
        if (
          typeof params.protocolVersion !== "string" ||
          !params.capabilities || typeof params.capabilities !== "object" || Array.isArray(params.capabilities) ||
          !params.clientInfo || typeof params.clientInfo !== "object" ||
          typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string"
        ) throw new McpRpcError(-32602, "initialize requires protocolVersion, capabilities, and clientInfo{name,version}");
        const protocolVersion = this.negotiateProtocolVersion(params.protocolVersion);
        if (ctx?.setSessionId) ctx.setSessionId(this.registerSession(params.clientInfo.name, protocolVersion));
        return ok({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "vault-kosmos", title: "Vault Kosmos", version: KOSMOS_VERSION },
          instructions: "Read-only, sensitivity-filtered OKF+ v2.3 Validating Projection Profile. Authored, derived, proposed, approved, and effective values remain distinct. Scores measure documentation/support quality, not truth or authorization. Use get_okf_note/get_assessment/get_diagnostics for governance projections and get_lineage/graph_at_time for temporal views. Graphiti exports are non-authoritative projections. The server never modifies notes.",
        });
      }
      if (method === "ping") return ok({});
      if (method === "tools/list") return ok({ tools: this.toolDefs() });
      if (method === "tools/call") {
        if (typeof params.name !== "string") throw new McpRpcError(-32602, "tools/call requires string name");
        const args = this.validateToolArgs(params.name, params.arguments ?? {});
        try {
          const result = await this.callTool(params.name, args, ctx?.agent);
          const structuredContent = Array.isArray(result) ? { items: result } : result;
          return ok({
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent,
            isError: Boolean(result && typeof result === "object" && result.error),
          });
        } catch (e: any) {
          if (e instanceof McpRpcError) throw e;
          return ok({ content: [{ type: "text", text: "Error: " + (e?.message || String(e)) }], isError: true });
        }
      }
      if (method === "resources/list") return ok({ resources: [] });
      if (method === "prompts/list") return ok({ prompts: [] });
      return error(-32601, "Method not found: " + method);
    } catch (e: any) {
      if (e instanceof McpRpcError) return error(e.code, e.message, e.data);
      return error(-32603, e?.message || "Internal error");
    }
  }

  /* ---------------- HTTP dispatch ---------------- */

  /** Public entry: enforce rate/concurrency limits, then dispatch. */
  async handle(req: any, res: any): Promise<void> {
    const rl = this.rateLimited(req);
    if (rl.limited) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" });
      res.end(JSON.stringify({ error: "too many requests", hint: rl.reason }));
      return;
    }
    // Mitigation 4: per-agent in-flight fairness cap (applies to all clients).
    const akey = this.agentLabel(req);
    const cur = this.perAgentInFlight.get(akey) || 0;
    if (cur >= MAX_CONCURRENT_PER_AGENT) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "1" });
      res.end(JSON.stringify({ error: "too many requests", hint: `agent '${akey}' has too many concurrent requests (max ${MAX_CONCURRENT_PER_AGENT}); background work is throttled so other agents stay responsive` }));
      return;
    }
    this.perAgentInFlight.set(akey, cur + 1);
    this.inFlight++;
    try {
      await this.dispatch(req, res);
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
      const c = (this.perAgentInFlight.get(akey) || 1) - 1;
      if (c <= 0) this.perAgentInFlight.delete(akey); else this.perAgentInFlight.set(akey, c);
    }
  }

  private async dispatch(req: any, res: any): Promise<void> {
    // Host validation first (DNS-rebinding defence).
    if (!this.hostAllowed(req.headers["host"])) {
      this.json(res, 403, { error: "forbidden host", hint: "the Host header does not match an allowed address for this bind mode" });
      return;
    }
    if (!this.originAllowed(req.headers["origin"])) {
      this.json(res, 403, { error: "forbidden origin", hint: "browser cross-origin requests are not allowed" });
      return;
    }
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
    if (!this.authorized(req, u)) {
      // Generic message — does not distinguish missing from incorrect token (Doc1 §3.6).
      this.json(res, 401, { error: "unauthorized", hint: "send Authorization: Bearer <token> or x-api-key: <token>" });
      return;
    }

    if (path === "/mcp") {
      if (req.method === "GET") { res.writeHead(405, { Allow: "POST, DELETE", "Cache-Control": "no-store" }); res.end(); return; }
      if (req.method === "DELETE") {
        const sid = String(req.headers["mcp-session-id"] || "");
        if (!sid) { this.json(res, 400, { error: "missing Mcp-Session-Id" }); return; }
        const session = this.getSession(sid);
        if (!session) { this.json(res, 404, { error: "unknown or expired MCP session" }); return; }
        const protocol = String(req.headers["mcp-protocol-version"] || "");
        if (!protocol || protocol !== session.protocolVersion) {
          this.json(res, 400, { error: "missing or mismatched MCP-Protocol-Version" }); return;
        }
        this.sessions.delete(sid);
        res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return;
      }
      if (req.method !== "POST") { res.writeHead(405, { Allow: "GET, POST, DELETE", "Cache-Control": "no-store" }); res.end(); return; }
      let body: string;
      try {
        body = await this.readBody(req);
      } catch (e: any) {
        const code = e?.statusCode === 413 ? 413 : 400;
        res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", Connection: "close" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: e?.message || "bad request" } }), () => {
          try { req.destroy(); } catch (_) { /* already gone */ }
        });
        return;
      }
      let parsed: any;
      try { parsed = JSON.parse(body || "null"); }
      catch (_) { this.json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
      if (Array.isArray(parsed)) {
        this.json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "JSON-RPC batching is not supported by Streamable HTTP; send one message per POST" } });
        return;
      }

      const isInitialize = parsed && typeof parsed === "object" && parsed.method === "initialize";
      const sid = String(req.headers["mcp-session-id"] || "");
      let session: { name: string; at: number; protocolVersion: string; initialized: boolean } | undefined;
      if (isInitialize) {
        if (sid) { this.json(res, 400, { error: "initialize must not reuse an existing MCP session" }); return; }
      } else {
        if (!sid) { this.json(res, 400, { error: "missing Mcp-Session-Id; initialize first" }); return; }
        session = this.getSession(sid) ?? undefined;
        if (!session) { this.json(res, 404, { error: "unknown or expired MCP session; initialize again" }); return; }
        const protocol = String(req.headers["mcp-protocol-version"] || "");
        if (!protocol || !SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(protocol) || protocol !== session.protocolVersion) {
          this.json(res, 400, { error: "missing, unsupported, or session-mismatched MCP-Protocol-Version" }); return;
        }
        if (!session.initialized && parsed.method !== "notifications/initialized") {
          this.json(res, 400, { error: "MCP session is not initialized; send notifications/initialized first" }); return;
        }
      }

      const agent = session?.name || this.agentLabel(req);
      let newSid: string | undefined;
      const ctx = { agent, sessionId: sid || undefined, session, setSessionId: (id: string) => { newSid = id; } };
      const sidHeader = () => (newSid ? { "Mcp-Session-Id": newSid } : undefined);
      const out = await this.mcpDispatch(parsed, ctx);
      if (!out) { res.writeHead(202, sidHeader()); res.end(); } else this.json(res, 200, out, sidHeader());
      return;
    }

    if (req.method !== "GET") { this.json(res, 405, { error: "GET only (read-only API)" }); return; }
    const q = (k: string) => u.searchParams.get(k) || undefined;
    switch (path) {
      case "/":
        this.json(res, 200, {
          name: "Vault Kosmos Agent API",
          version: KOSMOS_VERSION,
          readOnly: true,
          auth: "Authorization: Bearer <token> or x-api-key: <token>",
          mcp: { endpoint: "/mcp", transport: "MCP Streamable HTTP", sessions: true, supportedProtocolVersions: SUPPORTED_MCP_PROTOCOL_VERSIONS },
          rest: ["/health", "/overview", "/diagnostics", "/graph", "/notes?q=&tag=&area=&limit=", "/note?path=|title=", "/lineage?path=|title=", "/related?path=|title=", "/at?time=ISO", "/episodes", "/graphiti/status", "/okf/note?uid=|path=|title=", "/okf/assessment?uid=|path=|title=", "/okf/diagnostics?uid=|path=|title=", "/okf/labels?uid=|path=|title=", "/okf/evidence?uid=|path=|title=", "/okf/relationships?uid=|path=|title=", "/okf/validate?uid=|path=|title=", "/okf/policy", "/okf/assess-vault?limit="],
        });
        return;
      case "/health": this.json(res, 200, { ok: true, name: "vault-kosmos", version: KOSMOS_VERSION, vault: this.provider.vaultName() }); return;
      case "/overview": this.json(res, 200, await this.qOverview()); return;
      case "/diagnostics": this.json(res, 200, await this.qDiagnostics()); return;
      case "/graph": this.json(res, 200, await this.qGraph()); return;
      case "/notes": { const a = this.agentLabel(req); const r = await this.qSearch(q("q") || "", { tag: q("tag"), area: q("area"), limit: q("limit") ? Number(q("limit")) : undefined }); this.emitTraversal("search_notes", r, a); this.json(res, 200, r); return; }
      case "/note": { const a = this.agentLabel(req); const r = await this.qNote({ path: q("path"), title: q("title") }); this.emitTraversal("get_note", r, a); this.json(res, 200, r); return; }
      case "/lineage": { const a = this.agentLabel(req); const r = await this.qLineage({ path: q("path"), title: q("title") }); this.emitTraversal("get_lineage", r, a); this.json(res, 200, r); return; }
      case "/related": { const a = this.agentLabel(req); const r = await this.qRelated({ path: q("path"), title: q("title") }); this.emitTraversal("get_related", r, a); this.json(res, 200, r); return; }
      case "/at": { const a = this.agentLabel(req); const r = await this.qAtTime(q("time") || "", q("limit") ? Number(q("limit")) : 50); this.emitTraversal("graph_at_time", r, a); this.json(res, 200, r); return; }
      case "/episodes": this.json(res, 200, await this.qEpisodePage(q("cursor") ? Number(q("cursor")) : 0, q("limit") ? Number(q("limit")) : DEFAULT_EPISODE_PAGE)); return;
      case "/okf/note": this.json(res, 200, await this.qOkfNote({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/assessment": this.json(res, 200, await this.qAssessment({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/diagnostics": this.json(res, 200, await this.qOkfDiagnostics({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/labels": this.json(res, 200, await this.qEffectiveLabels({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/evidence": this.json(res, 200, await this.qEvidence({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/relationships": this.json(res, 200, await this.qRelationships({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/validate": this.json(res, 200, await this.qValidate({ uid: q("uid"), path: q("path"), title: q("title") })); return;
      case "/okf/policy": this.json(res, 200, this.qPolicy()); return;
      case "/okf/assess-vault": this.json(res, 200, await this.qAssessVault(q("limit") ? Number(q("limit")) : 100)); return;
      case "/graphiti/status": this.json(res, 200, await this.qGraphitiIngestionStatus()); return;
      default: this.json(res, 404, { error: "not found", see: "/" });
    }
  }
}
