/** Pure, DOM-free Nextcloud sync settings, URL, exclusion, and three-way planning logic. */
export const NEXTCLOUD_SYNC_SCHEMA = 2;
export const OBSIDIAN_CONFIG_PATTERN = ".obsidian/**";
export const PROTECTED_SYNC_EXCLUDES = [".obsidian/plugins/vault-kosmos/data.json"];
export const DEFAULT_SYNC_EXCLUDES = [".git/**", ".trash/**"];

export interface NextcloudSettings {
  schemaVersion: number; enabled: boolean; serverUrl: string; username: string;
  remoteFolder: string; syncOnStartup: boolean; intervalMinutes: number;
  propagateDeletes: boolean; syncObsidianConfig: boolean; excludePatterns: string[];
}
export const DEFAULT_NEXTCLOUD_SETTINGS: NextcloudSettings = {
  schemaVersion: NEXTCLOUD_SYNC_SCHEMA, enabled: false, serverUrl: "", username: "",
  remoteFolder: "Kosmos-Oden", syncOnStartup: false, intervalMinutes: 0,
  propagateDeletes: false, syncObsidianConfig: false, excludePatterns: [...DEFAULT_SYNC_EXCLUDES],
};
export interface SyncRecord { localHash: string; remoteEtag: string; remoteMtime: number; remoteSize: number; syncedAt: number; }
export interface NextcloudSyncState { schemaVersion: number; scope: string; files: Record<string, SyncRecord>; }
export type SyncActionKind = "upload" | "download" | "delete-local" | "delete-remote" | "compare" | "conflict" | "forget";
export interface SyncAction { kind: SyncActionKind; path: string; reason: string; }
export interface LocalEntry { hash: string; size: number; }
export interface RemoteEntry { etag: string; mtime: number; size: number; }
export interface SyncSummary { uploaded: number; downloaded: number; deletedLocal: number; deletedRemote: number; unchanged: number; conflicts: string[]; errors: string[]; }

export function migrateNextcloudSettings(raw: any): NextcloudSettings {
  const s = Object.assign({}, DEFAULT_NEXTCLOUD_SETTINGS, raw || {}) as NextcloudSettings;
  s.enabled = s.enabled === true; s.syncOnStartup = s.syncOnStartup === true; s.propagateDeletes = s.propagateDeletes === true;
  s.syncObsidianConfig = s.syncObsidianConfig === true;
  s.intervalMinutes = Math.max(0, Math.min(1440, Math.floor(Number(s.intervalMinutes) || 0)));
  s.serverUrl = String(s.serverUrl || "").trim(); s.username = String(s.username || "").trim();
  s.remoteFolder = normalizeRemotePath(String(s.remoteFolder || "Kosmos-Oden")) || "Kosmos-Oden";
  s.excludePatterns = Array.isArray(s.excludePatterns)
    ? s.excludePatterns.map(String).map((v) => v.trim()).filter((v) => v && v.toLowerCase() !== OBSIDIAN_CONFIG_PATTERN).slice(0, 200)
    : [...DEFAULT_SYNC_EXCLUDES];
  s.schemaVersion = NEXTCLOUD_SYNC_SCHEMA; return s;
}
export function emptyNextcloudState(scope = ""): NextcloudSyncState { return { schemaVersion: NEXTCLOUD_SYNC_SCHEMA, scope, files: {} }; }
export function migrateNextcloudState(raw: any, scope: string): NextcloudSyncState {
  if (!raw || raw.schemaVersion !== NEXTCLOUD_SYNC_SCHEMA || raw.scope !== scope || typeof raw.files !== "object") return emptyNextcloudState(scope);
  const files: Record<string, SyncRecord> = {};
  for (const [path, value] of Object.entries(raw.files as Record<string, any>).slice(0, 100_000)) {
    if (!safeRelativePath(path)) continue; const v = value as any;
    files[path] = { localHash: String(v.localHash || ""), remoteEtag: String(v.remoteEtag || ""), remoteMtime: Number(v.remoteMtime) || 0, remoteSize: Number(v.remoteSize) || 0, syncedAt: Number(v.syncedAt) || 0 };
  }
  return { schemaVersion: NEXTCLOUD_SYNC_SCHEMA, scope, files };
}
export function normalizeRemotePath(path: string): string { return path.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".").join("/"); }
export function safeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\0") || path.includes("\\")) return false;
  return path.split("/").every((p) => p.length > 0 && p !== "." && p !== "..");
}
function globRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { out += ".*"; i++; }
    else if (c === "*") out += "[^/]*"; else if (c === "?") out += "[^/]";
    else out += c.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(out + "(?:$|/.*)", "i");
}
export function isExcluded(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return patterns.some((pattern) => { const p = pattern.replace(/\\/g, "/").replace(/^\/+/, "").trim(); return Boolean(p) && (globRegex(p).test(normalized) || (!p.includes("/") && normalized.split("/").includes(p))); });
}
export function effectiveSyncExcludes(settings: NextcloudSettings): string[] {
  const patterns = [...settings.excludePatterns];
  if (!settings.syncObsidianConfig) patterns.push(OBSIDIAN_CONFIG_PATTERN);
  for (const protectedPath of PROTECTED_SYNC_EXCLUDES) {
    if (!patterns.some((p) => p.toLowerCase() === protectedPath.toLowerCase())) patterns.push(protectedPath);
  }
  return patterns;
}
export function planSync(local: Record<string, LocalEntry>, remote: Record<string, RemoteEntry>, previous: Record<string, SyncRecord>, propagateDeletes: boolean): SyncAction[] {
  const paths = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(previous)])].sort(); const actions: SyncAction[] = [];
  for (const path of paths) {
    const l = local[path]; const r = remote[path]; const p = previous[path];
    if (l && r) {
      if (!p) actions.push({ kind: "compare", path, reason: "exists on both sides without common state" });
      else { const lc = l.hash !== p.localHash; const rc = r.etag !== p.remoteEtag;
        if (lc && rc) actions.push({ kind: "conflict", path, reason: "local and Nextcloud both changed" });
        else if (lc) actions.push({ kind: "upload", path, reason: "local changed" });
        else if (rc) actions.push({ kind: "download", path, reason: "Nextcloud changed" }); }
    } else if (l) {
      if (!p) actions.push({ kind: "upload", path, reason: "new local file" });
      else if (l.hash !== p.localHash) actions.push({ kind: "conflict", path, reason: "local changed after Nextcloud deletion" });
      else actions.push({ kind: propagateDeletes ? "delete-local" : "upload", path, reason: propagateDeletes ? "Nextcloud deletion" : "restore missing Nextcloud file" });
    } else if (r) {
      if (!p) actions.push({ kind: "download", path, reason: "new Nextcloud file" });
      else if (r.etag !== p.remoteEtag) actions.push({ kind: "conflict", path, reason: "Nextcloud changed after local deletion" });
      else actions.push({ kind: propagateDeletes ? "delete-remote" : "download", path, reason: propagateDeletes ? "local deletion" : "restore missing local file" });
    } else if (p) actions.push({ kind: "forget", path, reason: "deleted on both sides" });
  }
  return actions;
}
export function encodePath(path: string): string { return path.split("/").filter(Boolean).map(encodeURIComponent).join("/"); }
export function buildNextcloudDavRoot(serverUrl: string, username: string, remoteFolder: string): string {
  const parsed = new URL(serverUrl.trim()); validateTransport(parsed); parsed.hash = ""; parsed.search = "";
  let base = parsed.toString().replace(/\/$/, "");
  if (!/\/remote\.php\/(?:dav\/files\/[^/]+|webdav)(?:\/|$)/i.test(parsed.pathname)) base += `/remote.php/dav/files/${encodeURIComponent(username)}`;
  const folder = encodePath(normalizeRemotePath(remoteFolder)); return folder ? `${base}/${folder}/` : `${base}/`;
}
function validateTransport(url: URL): void {
  if (url.protocol === "https:") return; if (url.protocol !== "http:") throw new Error("Nextcloud URL must use HTTPS");
  const h = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost = h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("10.") || h.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h);
  if (!privateHost) throw new Error("HTTP is allowed only for a literal private or loopback Nextcloud address; use HTTPS for hostnames");
}
export function syncScope(settings: NextcloudSettings): string {
  if (!settings.serverUrl || !settings.username) return "";
  try { return buildNextcloudDavRoot(settings.serverUrl, settings.username, settings.remoteFolder).toLowerCase(); } catch { return ""; }
}
