/**
 * Kosmos Core — graph construction.
 *
 * The build is split in two phases so the incremental index (§10) can cache
 * the expensive one:
 *
 *   parseSourceFile()  — regex-heavy Markdown/OKF+ parsing of ONE file.
 *   assembleGraph()    — cheap assembly of nodes/links/lineage/temporal state
 *                        from already-parsed records.
 *
 * `buildGraph(files, folders)` is the convenience full build used by the CLI,
 * the Agent API and full loads. All surfaces flow through this module, which
 * is what keeps the plugin, standalone page, Agent API, Graphiti exporter and
 * kosmos-build CLI semantically identical (§2.2, §39).
 */
import { colorForArea } from "./colors";
import { parseMarkdownFile, type ParsedMarkdown } from "./markdown";
import { parseOkfPlus, parseOkfTimestamp } from "./okf";
import { buildOkf23Projection, okf23Inverse, okf23RelationTargets, refreshOkf23Assessment } from "./okf23";
import {
  areaFromFilePath,
  areaFromPath,
  contentHash,
  extensionFromPath,
  normalizeVaultRelative,
  posixBasename,
  posixDirname,
  vaultDepth,
} from "./paths";
import {
  addFileToResolver,
  createResolver,
  resolveLinkTarget,
  resolveTitleRef,
  unresolvedId,
  type Resolver,
} from "./resolver";
import { normalizeLineage, type LineageInput } from "./lineage";
import { computeTemporalState, resolveValidAt } from "./temporal";
import type {
  KosmosDiagnostics,
  KosmosGraph,
  KosmosLink,
  KosmosNode,
  OkfData,
  SourceFile,
} from "./types";

export const fileNodeId = (rel: string): string => `file:${normalizeVaultRelative(rel)}`;
export const folderNodeId = (rel: string): string => {
  const n = normalizeVaultRelative(rel);
  return n ? `folder:${n}` : "folder:.";
};

/** Extensions parsed as Markdown notes by the graph builder. */
const PARSEABLE = new Set(["md", "markdown", "base"]);

/** Cached parse result for one source file. */
export interface NoteRecord {
  relativePath: string;
  ext?: string;
  size: number;
  mtimeMs?: number;
  btimeMs?: number;
  /** When this content first entered the index — the stable time fallback for
   *  sources that provide no file times (e.g. plugin postMessage snapshots),
   *  so re-assembly never invents phantom metadata changes. */
  firstSeenMs: number;
  hash: string;
  parsed: ParsedMarkdown;
  okf: OkfData | null;
}

/** Parse ONE file into a cacheable record (the expensive step). */
export function parseSourceFile(f: SourceFile): NoteRecord {
  const ext = f.extension?.toLowerCase() ?? extensionFromPath(f.relativePath);
  const content = f.content ?? "";
  const parseable = !!ext && PARSEABLE.has(ext);
  const parsed: ParsedMarkdown = parseable
    ? parseMarkdownFile(content)
    : { data: {}, content: "", links: [], tags: [], aliases: [] };
  const hash = contentHash(content);
  const okf = parseable ? parseOkfPlus(parsed.data, parsed.content) : null;
  const projection = parseable ? buildOkf23Projection(content, normalizeVaultRelative(f.relativePath), hash, okf) : undefined;
  if (okf && projection) okf.projection = projection;
  return {
    relativePath: normalizeVaultRelative(f.relativePath),
    ext,
    size: Number(f.size ?? content.length ?? 0),
    mtimeMs: f.modifiedTime,
    btimeMs: f.createdTime,
    firstSeenMs: Date.now(),
    hash,
    parsed,
    okf,
  };
}

export interface AssembleOptions {
  now?: number;
  /** Callback counting parse work (used by incremental tests/benchmarks). */
  onDiagnostics?: (d: KosmosDiagnostics) => void;
}

const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const uniq = (a: string[]): string[] => [...new Set(a)].sort((x, y) => x.localeCompare(y));

function addFolder(nodes: Map<string, KosmosNode>, rel: string, areaOverride?: string): void {
  const n = normalizeVaultRelative(rel);
  const id = folderNodeId(n);
  const area = areaOverride ?? areaFromPath(n);
  nodes.set(id, {
    id, kind: "folder", path: n, label: n ? posixBasename(n) : "Vault", area,
    depth: vaultDepth(n), tags: [], aliases: [], color: colorForArea(area),
    outgoing: 0, incoming: 0,
  });
}

function makeFileNode(rec: NoteRecord, now: number): KosmosNode {
  const area = areaFromFilePath(rec.relativePath);
  const ext = rec.ext;
  const label = posixBasename(ext ? rec.relativePath.slice(0, -(ext.length + 1)) : rec.relativePath);
  const okfTs = parseOkfTimestamp(rec.okf);
  const stableNow = rec.firstSeenMs ?? now;
  const validAtMs = resolveValidAt(okfTs, rec.btimeMs, rec.mtimeMs, stableNow);
  return {
    id: fileNodeId(rec.relativePath), kind: "file", path: rec.relativePath, label, area,
    depth: vaultDepth(rec.relativePath), extension: ext, size: rec.size,
    updatedAt: new Date(rec.mtimeMs ?? stableNow).toISOString(),
    createdAt: new Date(rec.btimeMs ?? rec.mtimeMs ?? stableNow).toISOString(),
    okf: rec.okf ? { ...rec.okf } : null,
    validAt: new Date(validAtMs).toISOString(),
    type: (rec.okf?.projection?.authored.type as string | null) || asStr(rec.parsed.data.type), status: asStr(rec.parsed.data.status),
    priority: asStr(rec.parsed.data.priority),
    tags: rec.parsed.tags, aliases: rec.parsed.aliases,
    color: colorForArea(area), outgoing: 0, incoming: 0,
  };
}

function makeUnresolved(target: string): KosmosNode {
  const label = target.split("/").at(-1) ?? target;
  return {
    id: unresolvedId(target), kind: "unresolved", path: target, label,
    area: "Unresolved", depth: 1, tags: [], aliases: [],
    color: colorForArea("Unresolved"), outgoing: 0, incoming: 0, unresolved: true,
  };
}

function parentOf(rel: string): string {
  const p = posixDirname(normalizeVaultRelative(rel));
  return p === "." ? "" : p;
}

/** parent path -> direct child node ids, computed in one O(n) pass. */
function childrenByParent(folders: string[], records: NoteRecord[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (parent: string, id: string) => {
    const arr = map.get(parent);
    if (arr) arr.push(id);
    else map.set(parent, [id]);
  };
  for (const f of folders) add(parentOf(f), folderNodeId(f));
  for (const r of records) add(parentOf(r.relativePath), fileNodeId(r.relativePath));
  return map;
}

function applyCounts(nodes: Map<string, KosmosNode>, links: KosmosLink[]): void {
  for (const l of links) {
    if (l.kind === "contains") continue;
    const s = nodes.get(l.source);
    const t = nodes.get(l.target);
    if (s) s.outgoing++;
    if (t) t.incoming++;
  }
}

/** Assemble the full graph from parsed records (the cheap step). */
export function assembleGraph(
  records: NoteRecord[],
  folders: string[],
  opts: AssembleOptions = {}
): KosmosGraph {
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const nodes = new Map<string, KosmosNode>();
  const links: KosmosLink[] = [];
  const resolver: Resolver = createResolver();

  addFolder(nodes, "", "Vault");
  for (const f of folders) addFolder(nodes, f);

  for (const rec of records) {
    const node = makeFileNode(rec, now);
    nodes.set(node.id, node);
    addFileToResolver(resolver, rec.relativePath, node.id, rec.parsed.aliases);
  }

  // ---- OKF+ v2.3 UID index and corpus-level identity diagnostics ----
  const uidCandidates = new Map<string, NoteRecord[]>();
  for (const rec of records) {
    const uid = rec.okf?.projection?.authored.uid;
    if (typeof uid !== "string" || !uid) continue;
    const arr = uidCandidates.get(uid);
    if (arr) arr.push(rec); else uidCandidates.set(uid, [rec]);
  }
  const uidIndex = new Map<string, string>();
  const addProjectionDiagnostic = (rec: NoteRecord, code: string, severity: "info" | "warning" | "error" | "critical", message: string, field?: string, targetUid?: string) => {
    const projection = rec.okf?.projection;
    if (!projection || projection.diagnostics.some((d) => d.code === code && d.field === field && d.targetUid === targetUid)) return;
    projection.diagnostics.push({ code, severity, field, message, deterministic: true, sourcePath: rec.relativePath, targetUid });
  };
  for (const [uid, matches] of uidCandidates) {
    if (matches.length === 1) uidIndex.set(uid, fileNodeId(matches[0].relativePath));
    else {
      const conflicting = new Set(matches.map((rec) => rec.hash)).size > 1;
      for (const rec of matches) {
        addProjectionDiagnostic(rec, "OKF-IDENTITY-003", "error", `UID ${uid} is declared by ${matches.length} notes; it is excluded from canonical UID resolution.`, "uid", uid);
        if (conflicting) addProjectionDiagnostic(rec, "OKF-IDENTITY-004", "error", `UID ${uid} is reused with conflicting source content.`, "uid", uid);
      }
    }
  }

  const children = childrenByParent(folders, records);
  for (const folder of ["", ...folders]) {
    const fid = folderNodeId(folder);
    for (const child of children.get(normalizeVaultRelative(folder)) ?? []) {
      links.push({ id: `contains:${fid}->${child}`, source: fid, target: child, kind: "contains" });
    }
  }

  for (const rec of records) {
    const sourceId = fileNodeId(rec.relativePath);
    for (const pl of rec.parsed.links) {
      const resolved = resolveLinkTarget(resolver, rec.relativePath, pl.target);
      const targetId = resolved ?? unresolvedId(pl.target);
      if (!resolved && !nodes.has(targetId)) nodes.set(targetId, makeUnresolved(pl.target));
      if (sourceId === targetId) continue;
      links.push({
        id: `${pl.kind}:${sourceId}->${targetId}:${links.length}`,
        source: sourceId, target: targetId, kind: pl.kind,
        label: pl.alias ?? pl.heading, sourcePath: rec.relativePath,
      });
    }
  }

  // ---- canonical lineage (§3): normalize BOTH declared directions into one edge set ----
  const lineageInputs: LineageInput[] = [];
  for (const rec of records) {
    if (!rec.okf) continue;
    const id = fileNodeId(rec.relativePath);
    const node = nodes.get(id);
    if (!node) continue;
    const projectedRelations = rec.okf.projection ? okf23RelationTargets(rec.okf.projection) : [];
    const canonicalV23 = rec.okf.projection?.sourceVersion === "2.3";
    const lineageBlock = rec.okf.projection?.authored.lineage as Record<string, unknown> | undefined;
    const predecessor = typeof lineageBlock?.predecessor_uid === "string" ? [lineageBlock.predecessor_uid] : [];
    const successor = typeof lineageBlock?.successor_uid === "string" ? [lineageBlock.successor_uid] : [];
    lineageInputs.push({
      id,
      label: node.label,
      declaredSupersedes: [...(canonicalV23 ? projectedRelations.filter((r) => r.type === "supersedes" && r.origin !== "proposed").map((r) => r.target) : rec.okf.supersedes), ...predecessor],
      declaredSupersededBy: [...(canonicalV23 ? projectedRelations.filter((r) => r.type === "superseded_by" && r.origin !== "proposed").map((r) => r.target) : rec.okf.supersededBy), ...successor],
      validAtMs: node.validAt ? Date.parse(node.validAt) : null,
    });
  }
  const lineage = normalizeLineage(lineageInputs, (ref) => uidIndex.has(ref) ? { id: uidIndex.get(ref), ambiguous: false } : resolveTitleRef(resolver, ref));

  // Attach stable lineage diagnostics to the originating v2.3 projection.
  const recordById = new Map(records.map((rec) => [fileNodeId(rec.relativePath), rec]));
  const lineageCodes: Record<string, string> = {
    "self-supersession": "OKF-LINEAGE-001", cycle: "OKF-LINEAGE-002",
    "unresolved-target": "OKF-LINEAGE-003", "multiple-successors": "OKF-LINEAGE-004",
    "successor-before-predecessor": "OKF-LINEAGE-005", "duplicate-declaration": "OKF-LINEAGE-006",
    "ambiguous-resolution": "OKF-LINEAGE-007",
  };
  for (const warning of lineage.warnings) {
    const rec = warning.nodeId ? recordById.get(warning.nodeId) : undefined;
    if (rec) addProjectionDiagnostic(rec, lineageCodes[warning.code] ?? "OKF-LINEAGE-999", warning.code === "duplicate-declaration" ? "warning" : "error", warning.message, "lineage");
  }

  // lineage edges render oldest -> newest (source = OLDER, target = NEWER)
  for (const e of lineage.edges) {
    links.push({
      id: `lineage:${e.older}->${e.newer}:${links.length}`,
      source: e.older, target: e.newer, kind: "lineage",
    });
  }

  // ---- temporal state (§4): one projector input for every surface ----
  const temporalInputs = lineageInputs
    .filter((li) => li.validAtMs != null)
    .map((li) => ({ id: li.id, validAtMs: li.validAtMs as number }));
  const temporal = computeTemporalState(temporalInputs, lineage);

  for (const rec of records) {
    const id = fileNodeId(rec.relativePath);
    const node = nodes.get(id);
    if (!node || !node.okf) continue;
    // Projections of the canonical lineage graph — NOT the raw declared fields.
    node.okf.supersedesIds = lineage.supersedes.get(id) ?? [];
    node.okf.supersededByIds = lineage.supersededBy.get(id) ?? [];
    const inv = temporal.invalidAt.get(id) ?? null;
    node.okf.invalidAt = inv != null ? new Date(inv).toISOString() : null;
    node.okf.head = temporal.head.get(id) ?? false;
  }

  // ---- typed v2.3 relationships: UID-first, origin-preserving, ambiguity-safe ----
  const semanticKeys = new Set<string>();
  for (const rec of records) {
    const projection = rec.okf?.projection;
    if (!projection) continue;
    const sourceId = fileNodeId(rec.relativePath);
    for (const relation of okf23RelationTargets(projection)) {
      if (relation.origin === "proposed" || relation.type === "supersedes" || relation.type === "superseded_by") continue;
      const resolved = uidIndex.get(relation.target) ? { id: uidIndex.get(relation.target), ambiguous: false } : resolveTitleRef(resolver, relation.target);
      if (resolved.ambiguous) {
        addProjectionDiagnostic(rec, "OKF-RELATIONSHIP-002", "error", `${relation.type} target ${relation.target} is ambiguous; no edge was projected.`, `relationships.${relation.type}`, relation.target);
        continue;
      }
      if (!resolved.id) {
        addProjectionDiagnostic(rec, "OKF-RELATIONSHIP-001", "warning", `${relation.type} target ${relation.target} is unresolved.`, `relationships.${relation.type}`, relation.target);
        continue;
      }
      if (resolved.id === sourceId && relation.type !== "related_to") {
        addProjectionDiagnostic(rec, "OKF-RELATIONSHIP-003", "error", `${relation.type} cannot target the source note itself.`, `relationships.${relation.type}`, relation.target);
        continue;
      }
      const key = `${sourceId}\u0001${relation.type}\u0001${resolved.id}`;
      if (semanticKeys.has(key)) continue;
      semanticKeys.add(key);
      // A flat Obsidian relationship property already produced a property edge.
      // Promote that exact edge instead of adding a duplicate semantic edge.
      const editableEdge = links.find((link) => link.source === sourceId && link.target === resolved.id && (link.kind === "property" || link.kind === "wikilink"));
      if (editableEdge) {
        editableEdge.kind = "semantic";
        editableEdge.label = relation.type;
        editableEdge.sourcePath = rec.relativePath;
      } else {
        links.push({ id: `semantic:${relation.type}:${sourceId}->${resolved.id}`, source: sourceId, target: resolved.id, kind: "semantic", label: relation.type, sourcePath: rec.relativePath });
      }
      const canonicalTarget = graphUid(nodes.get(resolved.id));
      (projection.derived.relationships[relation.type] ??= []).push({ target_uid: canonicalTarget, target_node_id: resolved.id, origin: "derived", projected_from_origin: relation.origin });
      const inverse = okf23Inverse(relation.type);
      const targetProjection = nodes.get(resolved.id)?.okf?.projection;
      if (inverse && targetProjection) (targetProjection.derived.relationships[inverse] ??= []).push({ target_uid: graphUid(nodes.get(sourceId)), target_node_id: sourceId, origin: "derived", inverse_of: relation.type });
    }
  }

  for (const rec of records) if (rec.okf?.projection) refreshOkf23Assessment(rec.okf.projection);

  // ---- semantic relations: legacy **Related:** + canonical v2.2 related_to ----
  const linksBySource = new Map<string, KosmosLink[]>();
  for (const l of links) {
    if (l.kind !== "wikilink" && l.kind !== "property") continue;
    const arr = linksBySource.get(l.source);
    if (arr) arr.push(l);
    else linksBySource.set(l.source, [l]);
  }
  for (const rec of records) {
    if (!rec.okf || !rec.okf.related.length) continue;
    const id = fileNodeId(rec.relativePath);
    const relIds = new Set(
      rec.okf.related.map((t) => resolveLinkTarget(resolver, rec.relativePath, t) ?? unresolvedId(t))
    );
    for (const l of linksBySource.get(id) ?? []) {
      if (relIds.has(l.target) && (l.kind === "wikilink" || l.kind === "property")) {
        l.kind = "semantic";
        relIds.delete(l.target);
      }
    }
  }

  applyCounts(nodes, links);
  const list = [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
  // one O(links) pass instead of an O(nodes × links) orphan scan
  const linkedIds = new Set<string>();
  let wikilinks = 0, markdownLinks = 0, propertyLinks = 0;
  for (const l of links) {
    if (l.kind === "contains") continue;
    linkedIds.add(l.source);
    linkedIds.add(l.target);
    if (l.kind === "wikilink") wikilinks++;
    else if (l.kind === "markdown") markdownLinks++;
    else if (l.kind === "property") propertyLinks++;
  }
  const durationMs = Date.now() - t0;

  const diagnostics: KosmosDiagnostics = {
    notes: records.length,
    folders: folders.length + 1,
    attachments: 0, // filled by callers that track attachment paths
    unresolvedLinks: list.filter((n) => n.kind === "unresolved").length,
    ambiguousLinks: resolver.ambiguous.size,
    lineageEdges: lineage.edges.length,
    lineageCycles: lineage.cycles,
    lineageWarnings: lineage.warnings.map((w) => `[${w.code}] ${w.message}`),
    residualCollisions: 0, // filled by the layout pass (§12)
    lastFullBuildMs: durationMs,
  };
  opts.onDiagnostics?.(diagnostics);

  return {
    nodes: list,
    links,
    stats: {
      indexedAt: new Date(now).toISOString(),
      durationMs,
      files: records.length,
      folders: folders.length + 1,
      unresolved: diagnostics.unresolvedLinks,
      links: links.length,
      wikilinks,
      markdownLinks,
      propertyLinks,
      orphans: list.filter((n) => n.kind === "file" && !linkedIds.has(n.id)).length,
    },
    areas: uniq(list.map((n) => n.area)),
    tags: uniq(list.flatMap((n) => n.tags)),
    statuses: uniq(list.map((n) => n.status).filter(Boolean) as string[]),
    types: uniq(list.map((n) => n.type).filter(Boolean) as string[]),
    diagnostics,
    // Core owns temporal semantics; consumers must not depend on a renderer
    // mutation to discover the graph's time range.
    __timeSpan: temporal.timeSpan,
    okfProfile: "OKF+ v2.3 Validating Projection Profile",
    okfUidIndex: Object.fromEntries([...uidIndex.entries()].sort(([a], [b]) => a.localeCompare(b))),
    okfAssessments: records.flatMap((rec) => rec.okf?.projection ? [rec.okf.projection.assessment] : []),
    okfDiagnostics: records.flatMap((rec) => rec.okf?.projection?.diagnostics ?? []),
  };
}

function graphUid(node: KosmosNode | undefined): string | null {
  const uid = node?.okf?.projection?.authored.uid;
  return typeof uid === "string" ? uid : node?.okf?.uid ?? null;
}

/** Full build convenience: parse every file, then assemble. */
export function buildGraph(files: SourceFile[], folders: string[], now?: number): KosmosGraph {
  const records = files.map(parseSourceFile);
  return assembleGraph(records, folders, { now });
}
