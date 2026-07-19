/**
 * Kosmos plugin — iframe embed entry.
 *
 * The Obsidian plugin drives this page over postMessage: a full snapshot
 * (`kosmos:files`), then debounced deltas (`kosmos:update`). The embed owns a
 * KosmosIndex so a single-note change costs one parse (§10) — the exact same
 * incremental core the standalone page uses. "Go to Note" posts `kosmos:open`
 * back to the plugin.
 */
import { KosmosIndex, type IndexChanges } from "../core/incremental";
import type { SourceFile } from "../core/types";
import { createKosmosApp } from "../renderer/renderer";
import { validateHostMessage, wrap } from "./protocol";

const app = createKosmosApp({
  autoStart: "wait",
  onOpenNote: (path, label) => {
    try { window.parent.postMessage(wrap("open-note", { path, label }), "*"); } catch (_) { /* sandboxed */ }
  },
  onOpenFolder: (path) => {
    try { window.parent.postMessage(wrap("open-folder", { path }), "*"); } catch (_) { /* sandboxed */ }
  },
});
const index = new KosmosIndex();

interface FilesMessage {
  type: "kosmos:files";
  files: Array<{ relativePath: string; content: string }>;
  folders?: string[];
  attachments?: string[];
  label?: string;
}
interface UpdateMessage {
  type: "kosmos:update";
  changed?: Array<{ relativePath: string; content: string }>;
  removed?: string[];
  renames?: Array<{ from: string; to: string }>;
  folders?: string[];
  attachments?: string[];
  label?: string;
}

function toSourceFiles(files: Array<{ relativePath: string; content: string }>): SourceFile[] {
  return (files || []).map((f) => ({ relativePath: f.relativePath, content: f.content, kind: "note" as const }));
}

function applySnapshot(msg: FilesMessage): void {
  const update = index.setFiles(toSourceFiles(msg.files), msg.folders || [], msg.attachments || []);
  app.setAttachments(msg.attachments || []);
  app.renderGraph(update.graph, msg.label || "Vault");
  for (const w of update.graph.diagnostics.lineageWarnings) console.warn("Vault Kosmos lineage:", w);
}
function applyDelta(msg: UpdateMessage): void {
  const changes: IndexChanges = {
    changed: toSourceFiles(msg.changed || []),
    removed: msg.removed || [],
    renames: msg.renames || [],
    folders: msg.folders,
    attachments: msg.attachments,
  };
  const update = index.applyChanges(changes);
  if (msg.attachments) app.setAttachments(msg.attachments);
  app.renderGraph(update.graph, msg.label || "Vault");
  for (const p of [...(msg.changed || []).map((c) => c.relativePath)]) {
    app.notifyLiveEvent({ path: p, type: update.delta.addedNodes.includes(`file:${p}`) ? "add" : "change" });
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  const raw: any = ev && ev.data;
  if (!raw || typeof raw !== "object") return;
  try {
    // Preferred path: versioned, structurally validated envelope (§3.4).
    if (raw.protocol === "vault-kosmos") {
      const v = validateHostMessage(raw);
      if (!v.ok) { if (v.reason) console.warn("Vault Kosmos: rejected host message —", v.reason); return; }
      const msg = v.message!;
      if (msg.type === "vault-snapshot") applySnapshot(msg.payload as FilesMessage);
      else if (msg.type === "vault-delta") applyDelta(msg.payload as UpdateMessage);
      else if (msg.type === "agent-traversal") app.notifyAgentTraversal((msg.payload as any).paths, (msg.payload as any).tool, (msg.payload as any).agent);
      else if (msg.type === "visibility") app.setHostVisible((msg.payload as any).visible);
      else if (msg.type === "vault-status") app.setVaultStatus((msg.payload as any).connected);
      return;
    }
    // Backward-compatible path: legacy flat messages (older host builds).
    if (raw.type === "kosmos:files") applySnapshot(raw as FilesMessage);
    else if (raw.type === "kosmos:update") applyDelta(raw as UpdateMessage);
    else if (raw.type === "kosmos:graph") app.renderGraph(raw.graph, raw.label);
    else if (raw.type === "kosmos:agent" && Array.isArray(raw.paths)) app.notifyAgentTraversal(raw.paths, raw.tool || "", raw.agent);
    else if (raw.type === "kosmos:visible") app.setHostVisible(raw.visible !== false);
    else if (raw.type === "kosmos:vault-status") app.setVaultStatus(raw.connected === true);
  } catch (e) {
    console.error("Vault Kosmos:", e);
    app.showError("Could not render this vault.");
  }
});

/* Test/diagnostic hook (no effect on normal use). */
(window as any).__kosmosEmbed = {
  getIndexInfo: () => ({ notes: index.noteCount, parseCount: index.parseCount, diagnostics: index.getDiagnostics() }),
};
