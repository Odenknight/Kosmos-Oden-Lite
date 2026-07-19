/** Kosmos Core — path utilities. Deterministic, POSIX-normalized vault paths. */

export const toPosixPath = (s: string): string =>
  s.replace(/\\/g, "/").replace(/\/+/g, "/");

export const normalizeVaultRelative = (s: string): string =>
  toPosixPath(s).replace(/^\/+/, "").replace(/^\.\//, "");

export function areaFromPath(p: string): string {
  const n = normalizeVaultRelative(p);
  if (!n || n === ".") return "Vault";
  return n.split("/")[0] || "Vault";
}

export function areaFromFilePath(p: string): string {
  const n = normalizeVaultRelative(p);
  if (!n || n === ".") return "Vault";
  return n.includes("/") ? areaFromPath(n) : "Root";
}

export function extensionFromPath(p: string): string | undefined {
  const m = /\.([^./\\]+)$/.exec(p);
  return m ? m[1].toLowerCase() : undefined;
}

export function withoutExtension(p: string): string {
  const n = normalizeVaultRelative(p);
  const m = /\.[^./]+$/.exec(n);
  return m ? n.slice(0, -m[0].length) : n;
}

export function basenameWithoutExtension(p: string): string {
  const n = withoutExtension(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function vaultDepth(p: string): number {
  const n = normalizeVaultRelative(p);
  if (!n || n === ".") return 0;
  return n.split("/").filter(Boolean).length;
}

/** Default metadata folders skipped by every scanner (§8). Configurable later. */
export const DEFAULT_IGNORED_DIRS = [".obsidian", ".git", "node_modules", ".trash"];

export function shouldIgnoreVaultPath(p: string, ignoredDirs: string[] = DEFAULT_IGNORED_DIRS): boolean {
  const n = normalizeVaultRelative(p);
  if (n.endsWith(".DS_Store")) return true;
  for (const dir of ignoredDirs) {
    if (n === dir || n.startsWith(dir + "/") || n.includes("/" + dir + "/")) return true;
  }
  return false;
}

export const posixDirname = (p: string): string => {
  const n = normalizeVaultRelative(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : ".") : n.slice(0, i);
};

export const posixBasename = (p: string): string => {
  const n = normalizeVaultRelative(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
};

export const posixJoin = (a: string, b: string): string =>
  normalizeVaultRelative(`${a}/${b}`);

/** Attachment extensions recognized as Oort-cloud objects. */
export const ATTACHMENT_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "svg", "tif", "tiff",
  "pdf", "mp4", "mov", "webm", "mkv", "avi", "m4v", "mp3", "wav", "ogg",
  "m4a", "flac", "aac", "zip", "rar", "7z", "gz", "doc", "docx", "xls",
  "xlsx", "ppt", "pptx", "csv", "tsv", "json", "canvas", "excalidraw",
  "psd", "ai", "fig", "heic",
]);

/** Note extensions parsed as Markdown (§6.1). */
export const NOTE_EXTENSIONS = new Set(["md", "markdown"]);

export function isNotePath(p: string): boolean {
  const ext = extensionFromPath(p);
  return !!ext && NOTE_EXTENSIONS.has(ext);
}

export function isAttachmentPath(p: string): boolean {
  const ext = extensionFromPath(p);
  return !!ext && ext !== "md" && ext !== "markdown" && ATTACHMENT_EXTENSIONS.has(ext);
}

/** FNV-1a based deterministic string hash (stable across sessions/surfaces). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic unit-interval hash used by layout code. */
export function hashUnit(v: string): number {
  return hashString(v) / 4294967295;
}

/** Fast non-cryptographic content hash for change detection (never for auth). */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length.toString(36);
}
