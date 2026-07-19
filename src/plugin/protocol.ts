/**
 * Kosmos host ↔ renderer message protocol (Doc1 §3.4, Doc2 §5.7).
 *
 * The plugin host and the embedded renderer exchange only these structurally
 * validated messages. Every message carries a protocol name + version so the
 * renderer can reject anything it does not understand instead of trusting
 * arbitrary `postMessage` data. Host and renderer ship together inside
 * main.js, so a single current version is sufficient; unknown/future versions
 * are rejected clearly rather than acted on.
 */
export const KOSMOS_PROTOCOL = "vault-kosmos";
export const KOSMOS_PROTOCOL_VERSION = 1;

export interface FilesPayload {
  files: Array<{ relativePath: string; content: string }>;
  folders?: string[];
  attachments?: string[];
  label?: string;
}
export interface UpdatePayload {
  changed?: Array<{ relativePath: string; content: string }>;
  removed?: string[];
  renames?: Array<{ from: string; to: string }>;
  folders?: string[];
  attachments?: string[];
  label?: string;
}
export interface OpenPayload {
  path: string;
  label?: string;
}
/** Note paths touched by one Agent API query, for the live traversal trail. */
export interface AgentTraversalPayload {
  paths: string[];
  tool: string;
  /** Short label identifying the agent behind the query (for per-agent trail
   *  colour + name label). Optional for backward compatibility. */
  agent?: string;
}
/** Host-side leaf visibility: inside Obsidian, document.visibilitychange only
 *  fires when the whole window hides — the host must tell the iframe when its
 *  LEAF is hidden so the render loop can fully stop (CPU/GPU/battery). */
export interface VisibilityPayload {
  visible: boolean;
}
/** Live vault-connectivity signal from a cheap host-side read probe: the dot in
 *  the header VAULT pill turns green (readable) or red (unreachable). */
export interface VaultStatusPayload {
  connected: boolean;
}

export type HostToRenderer =
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "vault-snapshot"; payload: FilesPayload }
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "vault-delta"; payload: UpdatePayload }
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "agent-traversal"; payload: AgentTraversalPayload }
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "visibility"; payload: VisibilityPayload }
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "vault-status"; payload: VaultStatusPayload };

export type RendererToHost =
  /** A note was chosen ("Go to Note") — open it in a new tab. */
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "open-note"; payload: OpenPayload }
  /** A folder-only galaxy was chosen ("Expand Folder") — reveal it in the
   *  file explorer. Never opens or creates a note for a folder path. */
  | { protocol: typeof KOSMOS_PROTOCOL; version: number; type: "open-folder"; payload: OpenPayload };

/** Build a wrapped, versioned message. */
export function wrap<T extends string, P>(type: T, payload: P) {
  return { protocol: KOSMOS_PROTOCOL, version: KOSMOS_PROTOCOL_VERSION, type, payload };
}

export interface ValidationResult<M> {
  ok: boolean;
  message?: M;
  /** Present when the message is addressed to us but malformed/unsupported. */
  reason?: string;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
/** Reject absolute paths and parent traversal in relative vault paths. */
const safePath = (p: unknown): boolean => isStr(p) && p.length > 0 && p.length < 4096 && !/(^|[\\/])\.\.([\\/]|$)/.test(p) && !/^([a-zA-Z]:[\\/]|[\\/])/.test(p);

/** Validate an inbound host→renderer message. Returns ok:false with a reason
 *  only when the envelope IS ours but invalid; foreign messages return ok:false
 *  silently (reason undefined) so the renderer can ignore them. */
export function validateHostMessage(data: unknown): ValidationResult<HostToRenderer> {
  if (!data || typeof data !== "object") return { ok: false };
  const m = data as Record<string, unknown>;
  if (m.protocol !== KOSMOS_PROTOCOL) return { ok: false }; // not ours
  if (m.version !== KOSMOS_PROTOCOL_VERSION) return { ok: false, reason: `unsupported protocol version ${String(m.version)} (this renderer speaks v${KOSMOS_PROTOCOL_VERSION})` };
  const p = m.payload as Record<string, unknown>;
  if (!p || typeof p !== "object") return { ok: false, reason: "missing payload" };
  if (m.type === "vault-snapshot") {
    if (!isArr(p.files)) return { ok: false, reason: "vault-snapshot payload.files must be an array" };
    for (const f of p.files as any[]) {
      if (!f || !safePath(f.relativePath) || !isStr(f.content)) return { ok: false, reason: "vault-snapshot file entry malformed or unsafe path" };
    }
    if (p.folders != null && !isArr(p.folders)) return { ok: false, reason: "folders must be an array" };
    if (p.attachments != null && !isArr(p.attachments)) return { ok: false, reason: "attachments must be an array" };
    return { ok: true, message: m as any };
  }
  if (m.type === "vault-delta") {
    if (p.changed != null) {
      if (!isArr(p.changed)) return { ok: false, reason: "delta.changed must be an array" };
      for (const f of p.changed as any[]) if (!f || !safePath(f.relativePath) || !isStr(f.content)) return { ok: false, reason: "delta changed entry malformed or unsafe path" };
    }
    if (p.removed != null && (!isArr(p.removed) || (p.removed as any[]).some((x) => !safePath(x)))) return { ok: false, reason: "delta.removed must be safe paths" };
    if (p.renames != null) {
      if (!isArr(p.renames)) return { ok: false, reason: "delta.renames must be an array" };
      for (const r of p.renames as any[]) if (!r || !safePath(r.from) || !safePath(r.to)) return { ok: false, reason: "delta rename entry malformed or unsafe path" };
    }
    return { ok: true, message: m as any };
  }
  if (m.type === "agent-traversal") {
    if (!isArr(p.paths) || (p.paths as any[]).some((x) => !safePath(x))) return { ok: false, reason: "agent-traversal payload.paths must be safe paths" };
    if (!isStr(p.tool)) return { ok: false, reason: "agent-traversal payload.tool must be a string" };
    if (p.agent != null && !isStr(p.agent)) return { ok: false, reason: "agent-traversal payload.agent must be a string" };
    return { ok: true, message: m as any };
  }
  if (m.type === "visibility") {
    if (typeof p.visible !== "boolean") return { ok: false, reason: "visibility payload.visible must be a boolean" };
    return { ok: true, message: m as any };
  }
  if (m.type === "vault-status") {
    if (typeof p.connected !== "boolean") return { ok: false, reason: "vault-status payload.connected must be a boolean" };
    return { ok: true, message: m as any };
  }
  return { ok: false, reason: `unsupported message type ${String(m.type)}` };
}

/** Validate an inbound renderer→host message (the symmetric direction). */
export function validateRendererMessage(data: unknown): ValidationResult<RendererToHost> {
  if (!data || typeof data !== "object") return { ok: false };
  const m = data as Record<string, unknown>;
  if (m.protocol !== KOSMOS_PROTOCOL) return { ok: false }; // not ours
  if (m.version !== KOSMOS_PROTOCOL_VERSION) return { ok: false, reason: `unsupported protocol version ${String(m.version)} (this host speaks v${KOSMOS_PROTOCOL_VERSION})` };
  const p = m.payload as Record<string, unknown>;
  if (!p || typeof p !== "object") return { ok: false, reason: "missing payload" };
  if (m.type === "open-note" || m.type === "open-folder") {
    if (!safePath(p.path)) return { ok: false, reason: `${String(m.type)} payload.path malformed or unsafe` };
    return { ok: true, message: m as any };
  }
  return { ok: false, reason: `unsupported message type ${String(m.type)}` };
}
