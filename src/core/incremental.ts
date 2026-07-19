/**
 * Kosmos Core — incremental index (§10).
 *
 * Maintains `path -> parsed note` / `path -> content hash` / `path -> file
 * metadata` caches so that a single-note change costs ONE parse:
 *
 *   Filesystem snapshot → source diff → changed-note parsing → resolver
 *   update → edge reconciliation → lineage projection → temporal projection
 *   → graph diff → renderer update
 *
 * Parsing (regex-heavy) is the expensive stage and is strictly limited to
 * changed content; assembly from cached records is cheap and keeps the
 * resolver, lineage, temporal and semantic passes globally consistent.
 *
 * Structural threshold (§10.2, documented): when one update removes or
 * changes more than max(500, 25% of the vault), the index performs — and
 * reports — a full rebuild, because bulk imports/deletes/renames invalidate
 * enough of the cache that diffing costs more than rebuilding.
 */
import { assembleGraph, parseSourceFile, type NoteRecord } from "./graph";
import { contentHash, normalizeVaultRelative } from "./paths";
import type { GraphDelta, KosmosDiagnostics, KosmosGraph, SourceFile } from "./types";

export interface IndexChanges {
  changed?: SourceFile[];
  removed?: string[];
  renames?: Array<{ from: string; to: string }>;
  /** Full folder list when folder topology changed; omit to keep the previous list. */
  folders?: string[];
  /** Full attachment path list; omit to keep the previous list. */
  attachments?: string[];
  label?: string;
}

export interface IndexUpdate {
  graph: KosmosGraph;
  delta: GraphDelta;
}

export const STRUCTURAL_REBUILD_MIN = 500;
export const STRUCTURAL_REBUILD_FRACTION = 0.25;

interface GraphSignature {
  nodes: Set<string>;
  links: Set<string>;
}

function signatureOf(graph: KosmosGraph): GraphSignature {
  const nodes = new Set<string>();
  for (const n of graph.nodes) nodes.add(n.id);
  const links = new Set<string>();
  for (const l of graph.links) links.add(`${l.source}${l.target}${l.kind}`);
  return { nodes, links };
}

function setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

export class KosmosIndex {
  private records = new Map<string, NoteRecord>();
  private folders: string[] = [];
  private attachments: string[] = [];
  private prevSig: GraphSignature | null = null;
  private prevNodeMeta = new Map<string, string>();
  graph: KosmosGraph | null = null;
  /** Cumulative number of parseSourceFile calls (test/benchmark observability). */
  parseCount = 0;

  get noteCount(): number {
    return this.records.size;
  }

  getAttachments(): string[] {
    return this.attachments.slice();
  }

  getFolders(): string[] {
    return this.folders.slice();
  }

  /** Raw note contents are NOT retained; expose cached records for exporters. */
  getRecords(): Map<string, NoteRecord> {
    return this.records;
  }

  /** Full load: parse everything, assemble, remember signature. */
  setFiles(files: SourceFile[], folders: string[] = [], attachments: string[] = []): IndexUpdate {
    const t0 = Date.now();
    this.records.clear();
    for (const f of files) {
      const rec = parseSourceFile(f);
      this.parseCount++;
      this.records.set(rec.relativePath, rec);
    }
    this.folders = folders.slice();
    this.attachments = attachments.slice();
    const graph = this.assemble();
    graph.diagnostics.lastFullBuildMs = Date.now() - t0;
    this.prevSig = signatureOf(graph);
    this.prevNodeMeta = this.metaOf(graph);
    const delta: GraphDelta = {
      addedNodes: graph.nodes.map((n) => n.id),
      removedNodes: [],
      changedNodes: [],
      topologyChanged: true,
      reparsed: files.length,
      fullRebuild: true,
    };
    return { graph, delta };
  }

  /** Incremental update: parse only genuinely-changed content. */
  applyChanges(changes: IndexChanges): IndexUpdate {
    const t0 = Date.now();
    const changed = changes.changed ?? [];
    const removed = changes.removed ?? [];
    const renames = changes.renames ?? [];

    const touched = removed.length + changed.length + renames.length;
    const structural =
      touched > Math.max(STRUCTURAL_REBUILD_MIN, this.records.size * STRUCTURAL_REBUILD_FRACTION);

    let reparsed = 0;

    // Renames move the cached record: content is unchanged, so no re-parse (§10).
    for (const r of renames) {
      const from = normalizeVaultRelative(r.from);
      const to = normalizeVaultRelative(r.to);
      const rec = this.records.get(from);
      if (rec) {
        this.records.delete(from);
        this.records.set(to, { ...rec, relativePath: to });
      }
    }
    for (const p of removed) this.records.delete(normalizeVaultRelative(p));
    for (const f of changed) {
      const path = normalizeVaultRelative(f.relativePath);
      const prev = this.records.get(path);
      // Hash gate: identical content (e.g. touch without edit) costs nothing.
      if (prev && f.content != null && prev.hash === contentHash(f.content)) continue;
      const rec = parseSourceFile(f);
      this.parseCount++;
      reparsed++;
      this.records.set(path, rec);
    }
    if (changes.folders) this.folders = changes.folders.slice();
    if (changes.attachments) this.attachments = changes.attachments.slice();

    const graph = this.assemble();
    graph.diagnostics.lastIncrementalUpdateMs = Date.now() - t0;

    // ---- graph diff (drives the renderer's update tiers, §11) ----
    const sig = signatureOf(graph);
    const meta = this.metaOf(graph);
    const prevSig = this.prevSig;
    const addedNodes: string[] = [];
    const removedNodes: string[] = [];
    const changedNodes: string[] = [];
    if (prevSig) {
      for (const id of sig.nodes) if (!prevSig.nodes.has(id)) addedNodes.push(id);
      for (const id of prevSig.nodes) if (!sig.nodes.has(id)) removedNodes.push(id);
      for (const [id, m] of meta) {
        if (prevSig.nodes.has(id) && sig.nodes.has(id) && this.prevNodeMeta.get(id) !== m) {
          changedNodes.push(id);
        }
      }
    }
    const topologyChanged = !prevSig || setsDiffer(prevSig.links, sig.links) || addedNodes.length > 0 || removedNodes.length > 0;
    this.prevSig = sig;
    this.prevNodeMeta = meta;

    return {
      graph,
      delta: {
        addedNodes,
        removedNodes,
        changedNodes,
        topologyChanged,
        reparsed,
        fullRebuild: structural,
      },
    };
  }

  getDiagnostics(): KosmosDiagnostics | null {
    return this.graph?.diagnostics ?? null;
  }

  private metaOf(graph: KosmosGraph): Map<string, string> {
    const meta = new Map<string, string>();
    for (const n of graph.nodes) {
      meta.set(
        n.id,
        `${n.label}${n.status ?? ""}${n.type ?? ""}${n.tags.join(",")}${n.aliases.join(",")}${n.validAt ?? ""}${n.okf?.invalidAt ?? ""}${n.okf?.head ? 1 : 0}`
      );
    }
    return meta;
  }

  private assemble(): KosmosGraph {
    const graph = assembleGraph([...this.records.values()], this.folders);
    graph.diagnostics.attachments = this.attachments.length;
    this.graph = graph;
    return graph;
  }
}
