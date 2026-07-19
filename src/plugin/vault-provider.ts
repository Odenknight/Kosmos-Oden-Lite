/**
 * Kosmos plugin — Obsidian-backed data provider for the Agent API.
 *
 * Owns a KosmosIndex fed from the live vault, so the Agent API answers from
 * the SAME normalized graph snapshot the viewer renders (§33). Change events
 * are folded incrementally (§10): a single edited note is re-read (from
 * Obsidian's in-memory cache) and re-parsed alone; only bulk changes trigger
 * a full rebuild.
 */
import type { App, TFile } from "obsidian";
import { KosmosIndex } from "../core/incremental";
import { stripFrontmatter } from "../core/graphiti";
import type { AgentDataProvider } from "./agent-server";
import type { KosmosGraph, SourceFile } from "../core/types";

declare const require: any;

export function nodeRequire(mod: string): any {
  try {
    const rq: any = typeof require !== "undefined" ? require : (window as any)?.require;
    return rq ? rq(mod) : null;
  } catch (_) {
    return null;
  }
}

/** The machine's own LAN IPv4 addresses (Node "os" module). */
export function lanAddresses(): string[] {
  try {
    const os = nodeRequire("os");
    if (!os) return [];
    const ifaces = os.networkInterfaces();
    const out: string[] = [];
    for (const name of Object.keys(ifaces || {})) {
      for (const info of ifaces[name] || []) {
        if (info.family === "IPv4" && !info.internal) out.push(info.address);
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

const ATTACH_EXT = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "svg", "tif", "tiff", "pdf", "mp4", "mov", "webm", "mkv", "avi", "m4v", "mp3", "wav", "ogg", "m4a", "flac", "aac", "zip", "rar", "7z", "gz", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "tsv", "json", "canvas", "excalidraw", "psd", "ai", "fig", "heic"]);

export function folderListFrom(md: Array<{ path: string }>): string[] {
  const folders = new Set<string>();
  for (const f of md) {
    const parts = String(f.path).split("/");
    parts.pop();
    let acc = "";
    for (const p of parts) { acc = acc ? `${acc}/${p}` : p; folders.add(acc); }
  }
  return Array.from(folders);
}

export function attachmentListFrom(all: Array<{ path: string; extension?: string }>): string[] {
  const out: string[] = [];
  for (const f of all) {
    const ext = String(f.extension || "").toLowerCase();
    if (ext && ext !== "md" && ATTACH_EXT.has(ext)) out.push(f.path);
  }
  return out;
}

export class VaultDataProvider implements AgentDataProvider {
  private app: App;
  private index = new KosmosIndex();
  private fullDirty = true;
  private changedPaths = new Set<string>();
  private removedPaths = new Set<string>();
  private renamedPaths: Array<{ from: string; to: string }> = [];
  private building: Promise<KosmosGraph> | null = null;

  constructor(app: App) {
    this.app = app;
  }

  /* ---- change notifications (wired to vault events by the plugin) ---- */
  markChanged(path: string): void { if (!this.fullDirty) this.changedPaths.add(path); }
  markRemoved(path: string): void { if (!this.fullDirty) { this.removedPaths.add(path); this.changedPaths.delete(path); } }
  markRenamed(from: string, to: string): void { if (!this.fullDirty) { this.renamedPaths.push({ from, to }); this.changedPaths.add(to); } }
  markFullDirty(): void { this.fullDirty = true; this.changedPaths.clear(); this.removedPaths.clear(); this.renamedPaths = []; }

  private async toSourceFile(f: TFile): Promise<SourceFile> {
    const content = await this.app.vault.cachedRead(f);
    return {
      relativePath: f.path,
      name: f.name,
      extension: f.extension,
      size: f.stat.size,
      modifiedTime: f.stat.mtime,
      createdTime: f.stat.ctime,
      content,
      kind: "note",
    };
  }

  async getGraph(): Promise<KosmosGraph> {
    if (this.building) return this.building;
    const pending = this.fullDirty || this.changedPaths.size || this.removedPaths.size || this.renamedPaths.length;
    if (this.index.graph && !pending) return this.index.graph;
    this.building = this.rebuild();
    try {
      return await this.building;
    } finally {
      this.building = null;
    }
  }

  private async rebuild(): Promise<KosmosGraph> {
    const md = this.app.vault.getMarkdownFiles();
    const folders = folderListFrom(md);
    const attachments = attachmentListFrom(this.app.vault.getFiles());
    if (this.fullDirty || !this.index.graph) {
      const files: SourceFile[] = [];
      for (const f of md) files.push(await this.toSourceFile(f));
      const update = this.index.setFiles(files, folders, attachments);
      this.fullDirty = false;
      this.changedPaths.clear(); this.removedPaths.clear(); this.renamedPaths = [];
      return update.graph;
    }
    const byPath = new Map(md.map((f) => [f.path, f]));
    const changed: SourceFile[] = [];
    for (const p of this.changedPaths) {
      const f = byPath.get(p);
      if (f) changed.push(await this.toSourceFile(f));
    }
    const update = this.index.applyChanges({
      changed,
      removed: [...this.removedPaths],
      renames: this.renamedPaths,
      folders,
      attachments,
    });
    this.changedPaths.clear(); this.removedPaths.clear(); this.renamedPaths = [];
    return update.graph;
  }

  async getNoteContent(path: string): Promise<string | null> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f || !("stat" in (f as any))) return null;
    try {
      const raw = await this.app.vault.cachedRead(f as TFile);
      return stripFrontmatter(raw);
    } catch {
      return null;
    }
  }

  vaultName(): string {
    return this.app.vault.getName();
  }

  vaultIdentity(): string {
    // The path is never exported; it is hashed by the Graphiti projector to
    // prevent same-name vaults from sharing a namespace accidentally.
    try {
      return String((this.app.vault.adapter as any).getBasePath?.() || this.vaultName());
    } catch {
      return this.vaultName();
    }
  }

  lanAddresses(): string[] {
    return lanAddresses();
  }
}
