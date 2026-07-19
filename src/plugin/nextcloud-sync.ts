/**
 * Native Nextcloud sync for Kosmos-Oden.
 *
 * This is a clean-room WebDAV implementation. It intentionally has no
 * dependency on Remotely Save (or any other sync plugin) and keeps the
 * comparison planner DOM/Obsidian-free so its deletion and conflict rules can
 * be tested independently.
 */
import { App, normalizePath, requestUrl, type RequestUrlResponse } from "obsidian";
import {
  buildNextcloudDavRoot, effectiveSyncExcludes, encodePath, emptyNextcloudState, isExcluded,
  migrateNextcloudSettings, migrateNextcloudState, planSync, safeRelativePath,
  syncScope,
  type LocalEntry, type NextcloudSettings, type NextcloudSyncState,
  type RemoteEntry, type SyncAction, type SyncSummary,
} from "./nextcloud-sync-core";
export {
  DEFAULT_NEXTCLOUD_SETTINGS, DEFAULT_SYNC_EXCLUDES, NEXTCLOUD_SYNC_SCHEMA,
  OBSIDIAN_CONFIG_PATTERN, PROTECTED_SYNC_EXCLUDES, effectiveSyncExcludes,
  buildNextcloudDavRoot, emptyNextcloudState, isExcluded, migrateNextcloudSettings,
  migrateNextcloudState, normalizeRemotePath, planSync, safeRelativePath, syncScope,
} from "./nextcloud-sync-core";
export type {
  LocalEntry, NextcloudSettings, NextcloudSyncState, RemoteEntry, SyncAction,
  SyncActionKind, SyncRecord, SyncSummary,
} from "./nextcloud-sync-core";

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

function header(response: RequestUrlResponse, name: string): string {
  const key = Object.keys(response.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(response.headers[key]) : "";
}

export class NextcloudWebDavClient {
  readonly root: string;
  private readonly accountRoot: string;
  private readonly headers: Record<string, string>;
  constructor(settings: NextcloudSettings, password: string) {
    if (!settings.username) throw new Error("Nextcloud username is required");
    if (!password) throw new Error("Nextcloud app password is required");
    this.accountRoot = buildNextcloudDavRoot(settings.serverUrl, settings.username, "");
    this.root = buildNextcloudDavRoot(settings.serverUrl, settings.username, settings.remoteFolder);
    this.headers = { Authorization: basicAuth(settings.username, password) };
  }

  private url(path = ""): string { return this.root + encodePath(path); }
  private async request(method: string, path = "", extra: Record<string, string> = {}, body?: ArrayBuffer | string): Promise<RequestUrlResponse> {
    const response = await requestUrl({ url: this.url(path), method, headers: { ...this.headers, ...extra }, body, throw: false });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`WebDAV ${method} ${path || "/"} failed (${response.status})`);
    }
    return response;
  }

  async test(): Promise<void> {
    const response = await requestUrl({
      url: this.accountRoot, method: "PROPFIND", headers: { ...this.headers, Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY, throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Nextcloud WebDAV connection failed (${response.status})`);
  }

  async ensureRoot(): Promise<void> {
    const root = new URL(this.root);
    const marker = root.pathname.toLowerCase().indexOf("/remote.php/");
    if (marker < 0) { await this.test(); return; }
    const prefix = root.pathname.slice(0, marker);
    const davParts = root.pathname.slice(marker).split("/").filter(Boolean);
    const fixed = davParts[1] === "webdav" ? 2 : Math.min(4, davParts.length);
    let current = `${root.origin}${prefix}/${davParts.slice(0, fixed).map(encodeURIComponentSafe).join("/")}/`;
    for (const part of davParts.slice(fixed)) {
      current += `${encodeURIComponentSafe(part)}/`;
      const response = await requestUrl({ url: current, method: "MKCOL", headers: this.headers, throw: false });
      if (![201, 405].includes(response.status)) throw new Error(`WebDAV MKCOL failed (${response.status})`);
    }
  }

  async listTree(maxEntries = 100_000): Promise<Record<string, RemoteEntry>> {
    const files: Record<string, RemoteEntry> = {};
    const queue = [""];
    while (queue.length) {
      const dir = queue.shift()!;
      if (dir.split("/").filter(Boolean).length > 64) throw new Error("Nextcloud folder depth exceeds 64");
      const response = await this.request("PROPFIND", dir, { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, PROPFIND_BODY);
      for (const item of parseMultiStatus(response.text, this.root)) {
        if (!item.path || item.path === dir.replace(/\/$/, "")) continue;
        if (item.collection) queue.push(item.path.replace(/\/$/, "") + "/");
        else files[item.path] = { etag: item.etag, mtime: item.mtime, size: item.size };
        if (Object.keys(files).length + queue.length > maxEntries) throw new Error(`Nextcloud listing exceeds ${maxEntries} entries`);
      }
    }
    return files;
  }

  async get(path: string, etag = ""): Promise<ArrayBuffer> {
    return (await this.request("GET", path, etag ? { "If-Match": etag } : {})).arrayBuffer;
  }
  async put(path: string, data: ArrayBuffer, etag?: string): Promise<RemoteEntry> {
    await this.ensureParents(path);
    const response = await this.request("PUT", path, etag ? { "If-Match": etag } : { "If-None-Match": "*" }, data);
    return { etag: header(response, "etag"), mtime: Date.now(), size: data.byteLength };
  }
  async delete(path: string, etag = ""): Promise<void> { await this.request("DELETE", path, etag ? { "If-Match": etag } : {}); }

  private async ensureParents(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current += `${part}/`;
      const response = await requestUrl({ url: this.url(current), method: "MKCOL", headers: this.headers, throw: false });
      if (![201, 405].includes(response.status)) throw new Error(`WebDAV MKCOL ${current} failed (${response.status})`);
    }
  }
}

function encodeURIComponentSafe(part: string): string {
  try { return encodeURIComponent(decodeURIComponent(part)); } catch { return encodeURIComponent(part); }
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`;

function parseMultiStatus(xml: string, rootUrl: string): Array<{ path: string; collection: boolean; etag: string; mtime: number; size: number }> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Nextcloud returned invalid WebDAV XML");
  const rootPath = new URL(rootUrl).pathname.replace(/\/$/, "") + "/";
  const elements = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
  return elements.map((response) => {
    const value = (name: string) => response.getElementsByTagNameNS("DAV:", name)[0]?.textContent?.trim() || "";
    const href = value("href");
    const pathname = new URL(href, rootUrl).pathname;
    if (!pathname.startsWith(rootPath) && pathname !== rootPath.slice(0, -1)) return null;
    const encoded = pathname.slice(rootPath.length);
    let path = "";
    try { path = encoded.split("/").filter(Boolean).map(decodeURIComponent).join("/"); } catch { return null; }
    if (path && !safeRelativePath(path)) return null;
    return {
      path,
      collection: response.getElementsByTagNameNS("DAV:", "collection").length > 0,
      etag: value("getetag"),
      mtime: Date.parse(value("getlastmodified")) || 0,
      size: Number(value("getcontentlength")) || 0,
    };
  }).filter((v): v is NonNullable<typeof v> => Boolean(v));
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class NextcloudSyncEngine {
  private running = false;
  constructor(
    private readonly app: App,
    private readonly settings: NextcloudSettings,
    private state: NextcloudSyncState,
    private readonly password: string,
    private readonly saveState: (state: NextcloudSyncState) => Promise<void>,
  ) {}

  async run(): Promise<SyncSummary> {
    if (this.running) throw new Error("A Nextcloud sync is already running");
    this.running = true;
    const summary: SyncSummary = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, unchanged: 0, conflicts: [], errors: [] };
    try {
      const client = new NextcloudWebDavClient(this.settings, this.password);
      await client.ensureRoot();
      const excludes = effectiveSyncExcludes(this.settings);
      const local = await this.scanLocal();
      const allRemote = await client.listTree();
      const remote = Object.fromEntries(Object.entries(allRemote).filter(([p]) => !isExcluded(p, excludes)));
      const actions = planSync(local, remote, this.state.files, this.settings.propagateDeletes);
      summary.unchanged = Math.max(0, new Set([...Object.keys(local), ...Object.keys(remote)]).size - actions.length);
      for (const action of actions) {
        try { await this.apply(action, local, remote, client, summary); await this.saveState(this.state); }
        catch (e: any) { summary.errors.push(`${action.path}: ${e?.message || String(e)}`); }
      }
      await this.saveState(this.state);
      return summary;
    } finally { this.running = false; }
  }

  private async scanLocal(): Promise<Record<string, LocalEntry>> {
    const out: Record<string, LocalEntry> = {};
    const excludes = effectiveSyncExcludes(this.settings);
    for (const file of this.app.vault.getFiles()) {
      const path = file.path.replace(/\\/g, "/");
      if (!safeRelativePath(path) || isExcluded(path, excludes)) continue;
      const data = await this.app.vault.readBinary(file);
      out[path] = { hash: await sha256Hex(data), size: data.byteLength };
    }
    return out;
  }

  private record(path: string, local: LocalEntry, remote: RemoteEntry): void {
    this.state.files[path] = { localHash: local.hash, remoteEtag: remote.etag, remoteMtime: remote.mtime, remoteSize: remote.size, syncedAt: Date.now() };
  }

  private async apply(action: SyncAction, local: Record<string, LocalEntry>, remote: Record<string, RemoteEntry>, client: NextcloudWebDavClient, summary: SyncSummary): Promise<void> {
    const path = action.path;
    if (action.kind === "forget") { delete this.state.files[path]; return; }
    if (action.kind === "compare") {
      const data = await client.get(path, remote[path].etag);
      const hash = await sha256Hex(data);
      if (hash === local[path].hash) this.record(path, local[path], remote[path]);
      else await this.preserveConflict(path, data, summary, action.reason);
      return;
    }
    if (action.kind === "conflict") {
      if (remote[path] && local[path]) {
        const remoteData = await client.get(path, remote[path].etag);
        await this.preserveConflict(path, remoteData, summary, action.reason);
        const file = this.app.vault.getAbstractFileByPath(path) as any;
        if (!file) throw new Error("local file disappeared while preserving conflict");
        const localData = await this.app.vault.readBinary(file);
        const current = { hash: await sha256Hex(localData), size: localData.byteLength };
        const uploaded = await client.put(path, localData, remote[path].etag);
        const verified = uploaded.etag ? uploaded : (await client.listTree())[path];
        if (!verified) throw new Error("conflict upload could not be verified");
        this.record(path, current, verified);
        summary.uploaded++;
      } else if (remote[path]) {
        const data = await client.get(path, remote[path].etag);
        await this.ensureLocalParent(path);
        await this.app.vault.adapter.writeBinary(normalizePath(path), data);
        this.record(path, { hash: await sha256Hex(data), size: data.byteLength }, remote[path]);
        summary.conflicts.push(`${path} (${action.reason}; Nextcloud copy restored locally)`);
        summary.downloaded++;
      } else {
        const file = this.app.vault.getAbstractFileByPath(path) as any;
        if (!file) throw new Error("local file disappeared during conflict resolution");
        const data = await this.app.vault.readBinary(file);
        const uploaded = await client.put(path, data);
        const verified = uploaded.etag ? uploaded : (await client.listTree())[path];
        if (!verified) throw new Error("restored upload could not be verified");
        this.record(path, { hash: await sha256Hex(data), size: data.byteLength }, verified);
        summary.conflicts.push(`${path} (${action.reason}; local copy restored to Nextcloud)`);
        summary.uploaded++;
      }
      return;
    }
    if (action.kind === "upload") {
      const file = this.app.vault.getAbstractFileByPath(path) as any;
      if (!file) throw new Error("local file disappeared during sync");
      const data = await this.app.vault.readBinary(file);
      const current: LocalEntry = { hash: await sha256Hex(data), size: data.byteLength };
      const uploaded = await client.put(path, data, remote[path]?.etag);
      if (!uploaded.etag) {
        const refreshed = await client.listTree();
        if (!refreshed[path]) throw new Error("upload succeeded but remote file could not be verified");
        this.record(path, current, refreshed[path]);
      } else this.record(path, current, uploaded);
      summary.uploaded++; return;
    }
    if (action.kind === "download") {
      const data = await client.get(path, remote[path].etag);
      const live = this.app.vault.getAbstractFileByPath(path) as any;
      if (live && local[path]) {
        const liveData = await this.app.vault.readBinary(live);
        if (await sha256Hex(liveData) !== local[path].hash) {
          await this.preserveConflict(path, data, summary, "local changed while sync was running");
          return;
        }
      }
      await this.ensureLocalParent(path);
      await this.app.vault.adapter.writeBinary(normalizePath(path), data);
      this.record(path, { hash: await sha256Hex(data), size: data.byteLength }, remote[path]);
      summary.downloaded++; return;
    }
    if (action.kind === "delete-local") {
      const live = this.app.vault.getAbstractFileByPath(path) as any;
      if (live) {
        const liveData = await this.app.vault.readBinary(live);
        if (!local[path] || await sha256Hex(liveData) !== local[path].hash) {
          summary.conflicts.push(`${path} (local changed while sync was running; local copy kept)`);
          return;
        }
      }
      await this.app.vault.adapter.remove(normalizePath(path)); delete this.state.files[path]; summary.deletedLocal++; return;
    }
    if (action.kind === "delete-remote") {
      await client.delete(path, remote[path].etag); delete this.state.files[path]; summary.deletedRemote++;
    }
  }

  private async ensureLocalParent(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1); let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(normalizePath(current)))) await this.app.vault.adapter.mkdir(normalizePath(current));
    }
  }

  private async preserveConflict(path: string, remoteData: ArrayBuffer, summary: SyncSummary, reason: string): Promise<void> {
    const dot = path.lastIndexOf(".");
    const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const conflictPath = `${stem}.nextcloud-conflict-${stamp}${ext}`;
    await this.ensureLocalParent(conflictPath);
    await this.app.vault.adapter.writeBinary(normalizePath(conflictPath), remoteData);
    summary.conflicts.push(`${path} (${reason}; Nextcloud copy saved as ${conflictPath})`);
  }
}
