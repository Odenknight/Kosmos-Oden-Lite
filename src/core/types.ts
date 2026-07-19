/**
 * Kosmos Core — shared types.
 *
 * Every surface (Obsidian plugin, standalone HTML viewer, Agent API, Graphiti
 * exporter, kosmos-build CLI) consumes these types so the same vault produces
 * materially the same nodes, links, lineage, HEAD status, temporal state and
 * Graphiti episode structure no matter how it is accessed.
 */

/** A source file discovered by any source (Obsidian vault, directory scan, CLI). */
export interface SourceFile {
  relativePath: string;
  /** File name including extension. */
  name?: string;
  extension?: string;
  size?: number;
  /** Last-modified time (ms since epoch), when the source can provide it. */
  modifiedTime?: number;
  /** Creation time (ms since epoch), when the source can provide it. */
  createdTime?: number;
  /** Raw markdown content. Attachments may omit content. */
  content?: string;
  kind?: "note" | "attachment";
}

export interface SourceDirectory {
  relativePath: string;
}

/** A parsed inline/property link before resolution. */
export interface ParsedLink {
  kind: "wikilink" | "markdown" | "property";
  target: string;
  raw: string;
  alias?: string;
  heading?: string;
}

export type OkfSensitivity =
  | "public"
  | "internal"
  | "restricted"
  | "confidential"
  | "regulated"
  | "phi"
  | "secret";

export type OkfOrigin = "authored" | "derived" | "proposed" | "approved";

export interface OkfDiagnostic {
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  field?: string;
  message: string;
  deterministic: boolean;
  remediation?: string;
  sourcePath?: string;
  targetUid?: string;
}

export interface OkfOriginProjection {
  /** Source navigation/discovery tags. These are not governed labels. */
  tags?: string[];
  labels: unknown[];
  relationships: Record<string, unknown[]>;
  epistemicState?: string | null;
  sensitivity?: OkfSensitivity | null;
  [field: string]: unknown;
}

export interface OkfAssessmentScores {
  structural_completeness: number | null;
  provenance_quality: number | null;
  evidence_support: number | null;
  relationship_integrity: number | null;
  temporal_freshness: number | null;
  contradiction_status: number | null;
  review_readiness: number | null;
  overall: number | null;
}

export interface OkfAssessment {
  assessmentId: string;
  targetUid: string | null;
  profile: "okf-plus-2.3-validating-projection";
  policy: { id: string; version: string; hash: string; weights: Record<string, number>; missingValueBehavior: string };
  assessor: { id: "tool:kosmos-oden"; engineVersion: string };
  inputHash: string;
  calculatedAt: string;
  scores: OkfAssessmentScores;
  exclusions: string[];
  labels: { derived: string[] };
  diagnostics: OkfDiagnostic[];
  interpretation: "documentation-and-support-quality-not-truth";
}

/** OKF+ v2.3 Validating Projection Profile attached to a source note. */
export interface OkfProjection {
  profile: "okf-plus-2.3-validating-projection";
  conformanceClaim: "reader-and-deterministic-assessor";
  mode: "strict-v2.3" | "compatible" | "legacy";
  sourceVersion: string | null;
  sourcePath: string;
  contentHash: string;
  rawFrontmatter: Record<string, unknown>;
  extensions: Record<string, unknown>;
  authored: OkfOriginProjection;
  derived: OkfOriginProjection;
  proposed: OkfOriginProjection;
  approved: OkfOriginProjection;
  effective: OkfOriginProjection;
  diagnostics: OkfDiagnostic[];
  assessment: OkfAssessment;
}

export type OkfRelation =
  | "depends_on"
  | "supports"
  | "derives_from"
  | "derived_from"
  | "contradicts"
  | "refines"
  | "implements"
  | "blocks"
  | "documents"
  | "cites"
  | "quotes"
  | "interprets"
  | "tests"
  | "replicates"
  | "fails_to_replicate"
  | "extends"
  | "narrows"
  | "generalizes"
  | "governed_by"
  | "reviewed_by"
  | "approved_by"
  | "supersedes"
  | "superseded_by"
  | "part_of"
  | "has_part"
  | "related_to";

/** OKF+ (Open Knowledge Format Plus) data parsed from one note. */
export interface OkfData {
  okfVersion?: string;
  /** Stable external identity. A valid v2.2 value is a lowercase UUIDv4. */
  uid?: string;
  type?: string;
  title?: string;
  description?: string;
  timestamp?: string;
  epistemicState?: string;
  scope?: string;
  scopeId?: string;
  sensitivity?: OkfSensitivity;
  resource?: string;
  /** As authored in frontmatter (titles/paths, unresolved). */
  supersedes: string[];
  supersededBy: string[];
  forkedFrom: string[];
  forkedTo: string[];
  /** Explicit typed v2.2 relationships, kept separate from body wikilinks. */
  relations: Partial<Record<OkfRelation, string[]>>;
  /** Titles from the footer `**Related:**` line. */
  related: string[];
  /** Origin-preserving OKF+ v2.3 validation and assessment projection. */
  projection?: OkfProjection;
}

/** Node-level OKF+ projection attached to graph nodes after lineage/temporal passes. */
export interface OkfNodeState extends OkfData {
  /** Resolved node ids this note supersedes (canonical: this note is NEWER). */
  supersedesIds?: string[];
  /** Resolved node ids that supersede this note (canonical projection). */
  supersededByIds?: string[];
  /** ISO time at which this note stopped being current (earliest successor valid_at), or null. */
  invalidAt?: string | null;
  /** True when the note participates in a lineage and has no successor. */
  head?: boolean;
}

export type NodeKind = "file" | "folder" | "unresolved";

export interface KosmosNode {
  id: string;
  kind: NodeKind;
  path: string;
  label: string;
  area: string;
  depth: number;
  extension?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  /** ISO time from which this note is valid (OKF+ timestamp or documented fallback). */
  validAt?: string;
  okf?: OkfNodeState | null;
  type?: string;
  status?: string;
  priority?: string;
  tags: string[];
  aliases: string[];
  color: string;
  outgoing: number;
  incoming: number;
  unresolved?: boolean;
  [extra: string]: unknown;
}

export type LinkKind =
  | "wikilink"
  | "markdown"
  | "property"
  | "semantic"
  | "lineage"
  | "contains";

export interface KosmosLink {
  id: string;
  source: string;
  target: string;
  kind: LinkKind;
  label?: string;
  sourcePath?: string;
}

export interface GraphStats {
  indexedAt: string;
  durationMs: number;
  files: number;
  folders: number;
  unresolved: number;
  links: number;
  wikilinks: number;
  markdownLinks: number;
  propertyLinks: number;
  orphans: number;
}

/** Diagnostics surface (build directive §32). Exposed via the Agent API,
 *  the standalone diagnostics panel and debug hooks. Never contains secrets. */
export interface KosmosDiagnostics {
  notes: number;
  folders: number;
  attachments: number;
  unresolvedLinks: number;
  ambiguousLinks: number;
  lineageEdges: number;
  lineageCycles: number;
  lineageWarnings: string[];
  residualCollisions: number;
  lastFullBuildMs?: number;
  lastIncrementalUpdateMs?: number;
}

export interface KosmosGraph {
  nodes: KosmosNode[];
  links: KosmosLink[];
  stats: GraphStats;
  areas: string[];
  tags: string[];
  statuses: string[];
  types: string[];
  diagnostics: KosmosDiagnostics;
  /** Populated lazily by the renderer. */
  nodeById?: Map<string, KosmosNode>;
  [extra: string]: unknown;
}

/** One warning produced while normalizing lineage (§3.5). */
export interface LineageWarning {
  code:
    | "self-supersession"
    | "cycle"
    | "unresolved-target"
    | "multiple-successors"
    | "successor-before-predecessor"
    | "duplicate-declaration"
    | "ambiguous-resolution";
  message: string;
  nodeId?: string;
}

/** Result of canonical lineage normalization (§3.2–§3.3). */
export interface LineageModel {
  /** Canonical directed edges: NEWER --supersedes--> OLDER, deduplicated. */
  edges: Array<{ newer: string; older: string }>;
  /** Projection: node id -> ids it supersedes (older notes). */
  supersedes: Map<string, string[]>;
  /** Projection: node id -> ids that supersede it (newer notes). */
  supersededBy: Map<string, string[]>;
  warnings: LineageWarning[];
  /** Node ids taking part in at least one lineage edge. */
  members: Set<string>;
  cycles: number;
}

/** Graphiti episode (getzep/graphiti `EpisodeType.json` compatible). */
export interface GraphitiEpisode {
  /** Stable episode identity: OKF+ uid when valid, deterministic fallback otherwise. */
  uuid: string;
  name: string;
  episode_body: string;
  source: "json" | "fact_triple";
  source_description: string;
  reference_time: string;
  group_id: string;
  /** Graphiti filtering metadata. This is derived adapter state, never authored note data. */
  episode_metadata: Record<string, string | number | boolean | null>;
}

/** Point-in-time projection buckets (§4.1). */
export interface TemporalProjection {
  at: string;
  notYetCreated: string[];
  valid: string[];
  superseded: string[];
}

/** A delta produced by the incremental index (§10). */
export interface GraphDelta {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  /** True when link topology changed (edges added/removed/rewired). */
  topologyChanged: boolean;
  /** Number of notes actually re-parsed for this update. */
  reparsed: number;
  /** True when the whole index was rebuilt (structural threshold, §10.2). */
  fullRebuild: boolean;
}
