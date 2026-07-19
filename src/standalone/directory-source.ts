/**
 * Kosmos standalone — directory sources (§6, §8).
 *
 * Two progressive access paths, both producing the same source-neutral
 * snapshot consumed by the Kosmos Core index:
 *
 *  - PERSISTENT: File System Access API (`showDirectoryPicker`). The handle
 *    can be re-scanned while the page stays open, enabling monitoring.
 *  - SNAPSHOT: `<input type="file" webkitdirectory>` fallback. The browser
 *    hands over a static file list once; no re-scan is possible and the UI
 *    must say so (§6.2).
 *
 * The scanner is strictly READ-ONLY (§35): it never renames, deletes,
 * modifies, rewrites, normalizes, moves or patches user files.
 */
import {
  DEFAULT_IGNORED_DIRS,
  extensionFromPath,
  isAttachmentPath,
  isNotePath,
} from "../core/paths";
import type { SourceFile } from "../core/types";

export interface DirectorySnapshot {
  files: SourceFile[];          // notes WITH content
  attachments: string[];        // attachment paths (content never loaded, §8.4)
  folders: string[];            // relative folder paths
  /** Signature entries for diffing (§9.1): path -> `${size}:${mtime}` for notes. */
  signatures: Map<string, string>;
  scannedAt: number;
  errors: string[];
}

export type SourceMode = "persistent" | "snapshot";

export interface KnowledgeSource {
  mode: SourceMode;
  name: string;
  /** Re-scan the directory. Persistent sources re-read from disk; snapshot sources rethrow. */
  scan(): Promise<DirectorySnapshot>;
  /** Only persistent sources can rescan. */
  canRescan: boolean;
  /** The underlying handle for persistence (persistent mode only). */
  handle?: unknown;
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

function shouldIgnoreDir(name: string): boolean {
  return DEFAULT_IGNORED_DIRS.includes(name) || name === ".DS_Store";
}

/* -------------------- persistent path (§6.1) -------------------- */

async function scanHandle(root: any, rootName: string): Promise<DirectorySnapshot> {
  const files: SourceFile[] = [];
  const attachments: string[] = [];
  const folders: string[] = [];
  const signatures = new Map<string, string>();
  const errors: string[] = [];

  async function walk(dir: any, prefix: string): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      try {
        if (entry.kind === "directory") {
          if (shouldIgnoreDir(name)) continue;
          folders.push(rel);
          await walk(entry, rel);
        } else {
          if (name === ".DS_Store") continue;
          if (isNotePath(rel)) {
            const file: File = await entry.getFile();
            const content = await file.text();
            files.push({
              relativePath: rel,
              name,
              extension: extensionFromPath(rel),
              size: file.size,
              modifiedTime: file.lastModified,
              content,
              kind: "note",
            });
            signatures.set(rel, `n:${file.size}:${file.lastModified}`);
          } else if (isAttachmentPath(rel)) {
            // record path + metadata only; binary content is never loaded
            const file: File = await entry.getFile();
            attachments.push(rel);
            signatures.set(rel, `a:${file.size}:${file.lastModified}`);
          }
        }
      } catch (e: any) {
        errors.push(`Could not read ${rel}: ${e?.message || e}`);
      }
    }
  }

  await walk(root, "");
  return { files, attachments, folders, signatures, scannedAt: Date.now(), errors };
}

export async function openDirectoryPersistent(): Promise<KnowledgeSource> {
  const handle = await (window as any).showDirectoryPicker({ id: "kosmos-vault", mode: "read" });
  return sourceFromHandle(handle);
}

export function sourceFromHandle(handle: any): KnowledgeSource {
  return {
    mode: "persistent",
    name: handle.name || "Folder",
    canRescan: true,
    handle,
    scan: () => scanHandle(handle, handle.name),
  };
}

/* -------------------- snapshot fallback (§6.2) -------------------- */

/** Build a one-shot source from a `webkitdirectory` FileList. */
export async function sourceFromFileList(list: FileList | File[]): Promise<{ source: KnowledgeSource; snapshot: DirectorySnapshot }> {
  const all = Array.from(list as File[]);
  const files: SourceFile[] = [];
  const attachments: string[] = [];
  const folderSet = new Set<string>();
  const signatures = new Map<string, string>();
  const errors: string[] = [];
  let rootName = "Snapshot";

  for (const f of all) {
    // webkitRelativePath = "Root/sub/note.md" — strip the shared root segment.
    const rp: string = (f as any).webkitRelativePath || f.name;
    const parts = rp.split("/");
    if (parts.length > 1) rootName = parts[0];
    const rel = parts.length > 1 ? parts.slice(1).join("/") : rp;
    if (!rel) continue;
    // infer directory structure from the relative paths (§6.2)
    const dirs = rel.split("/").slice(0, -1);
    let acc = "";
    let ignored = false;
    for (const d of dirs) {
      if (shouldIgnoreDir(d)) { ignored = true; break; }
      acc = acc ? `${acc}/${d}` : d;
      folderSet.add(acc);
    }
    if (ignored) continue;
    try {
      if (isNotePath(rel)) {
        const content = await f.text();
        files.push({
          relativePath: rel,
          name: f.name,
          extension: extensionFromPath(rel),
          size: f.size,
          modifiedTime: f.lastModified,
          content,
          kind: "note",
        });
        signatures.set(rel, `n:${f.size}:${f.lastModified}`);
      } else if (isAttachmentPath(rel)) {
        attachments.push(rel);
        signatures.set(rel, `a:${f.size}:${f.lastModified}`);
      }
    } catch (e: any) {
      errors.push(`Could not read ${rel}: ${e?.message || e}`);
    }
  }

  const snapshot: DirectorySnapshot = {
    files, attachments, folders: [...folderSet], signatures, scannedAt: Date.now(), errors,
  };
  const source: KnowledgeSource = {
    mode: "snapshot",
    name: rootName,
    canRescan: false,
    scan: async () => snapshot, // static: re-scan returns the same imported snapshot
  };
  return { source, snapshot };
}

/* -------------------- snapshot diff (§9.1) -------------------- */

export interface SnapshotDiff {
  addedFiles: string[];
  changedFiles: string[];
  removedFiles: string[];
  addedDirs: string[];
  removedDirs: string[];
  attachmentsChanged: boolean;
  foldersChanged: boolean;
  isEmpty: boolean;
}

/**
 * Compare two snapshots. Renames are reported as remove+add — correctness
 * over speculative rename inference (§9.1).
 */
export function diffSnapshots(prev: DirectorySnapshot, next: DirectorySnapshot): SnapshotDiff {
  const addedFiles: string[] = [];
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  for (const [path, sig] of next.signatures) {
    const p = prev.signatures.get(path);
    if (p == null) addedFiles.push(path);
    else if (p !== sig) changedFiles.push(path);
  }
  for (const path of prev.signatures.keys()) {
    if (!next.signatures.has(path)) removedFiles.push(path);
  }
  const prevDirs = new Set(prev.folders);
  const nextDirs = new Set(next.folders);
  const addedDirs = next.folders.filter((d) => !prevDirs.has(d));
  const removedDirs = prev.folders.filter((d) => !nextDirs.has(d));
  const attachmentsChanged =
    prev.attachments.length !== next.attachments.length ||
    prev.attachments.some((a, i) => next.attachments[i] !== a);
  const foldersChanged = addedDirs.length > 0 || removedDirs.length > 0;
  return {
    addedFiles, changedFiles, removedFiles, addedDirs, removedDirs,
    attachmentsChanged, foldersChanged,
    isEmpty: !addedFiles.length && !changedFiles.length && !removedFiles.length && !foldersChanged && !attachmentsChanged,
  };
}
