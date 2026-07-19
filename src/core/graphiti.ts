/**
 * Kosmos Governed Context Projection (KGCP) — Graphiti 0.29 adapter.
 *
 * Source notes and accepted semantic events remain authoritative. Graphiti is
 * a disposable, non-authoritative projection. Origin separation is preserved,
 * proposed relationships never become fact triples, and a completed upstream
 * ingest is not assumed searchable until the caller performs a read check.
 */
import { contentHash } from "./paths";
import type { GraphitiEpisode, KosmosGraph, KosmosNode, OkfRelation } from "./types";

export const GRAPHITI_CORE_VERSION = "0.29.0";
export const GRAPHITI_ADAPTER_SCHEMA = "okf-plus-graphiti/2.3.0";
export const DEFAULT_GRAPHITI_CONTENT_CHARS = 20_000;
export const DEFAULT_GRAPHITI_ATTRIBUTE_CHARS = 250;

export interface GraphitiOptions {
  vault?: string;
  vaultIdentity?: string;
  groupId?: string;
  corpusId?: string;
  maxContentChars?: number;
  maxAttributeChars?: number;
  combinedExtraction?: boolean;
  sagaMapping?: boolean;
  processingTime?: string;
}

export interface GraphitiIngestionProfile {
  adapter: "Kosmos Governed Context Projection";
  adapterSchema: typeof GRAPHITI_ADAPTER_SCHEMA;
  testedGraphitiCore: typeof GRAPHITI_CORE_VERSION;
  combinedExtraction: boolean;
  combinedExtractionSurface: "disabled" | "graphiti-0.29-low-level-utility";
  publicAddEpisodeSupportsCombinedExtraction: false;
  episodeMetadataTransport: "adapter-envelope-and-episode-body";
  attributeMaxChars: number;
  readiness: {
    acceptedIsSearchable: false;
    statusCheckRequired: true;
    terminalStates: string[];
  };
  benchmark: { required: boolean; metrics: string[] };
}

export interface GraphitiExtractionMetrics {
  tokenCost: number | null;
  ingestionDurationMs: number;
  entityRecall: number | null;
  edgeAccuracy: number | null;
  expectedEdges: number;
  extractedEdges: number;
}

export interface ExtractedFactTriple {
  subject: string;
  predicate: string;
  object: string;
}

/** Compare a measured Graphiti run with effective fact-triple fixtures. */
export function measureGraphitiExtraction(
  episodes: GraphitiEpisode[],
  extracted: ExtractedFactTriple[],
  ingestionDurationMs: number,
  tokenCost: number | null = null
): GraphitiExtractionMetrics {
  const norm = (value: string): string => value.trim().toLowerCase();
  const expected: ExtractedFactTriple[] = [];
  for (const episode of episodes) {
    if (episode.source !== "fact_triple") continue;
    try {
      const body = JSON.parse(episode.episode_body);
      expected.push({
        subject: String(body.subject),
        predicate: String(body.predicate),
        object: String(body.object_ref),
      });
    } catch { /* malformed external fixtures are ignored, never guessed */ }
  }
  const key = (item: ExtractedFactTriple): string =>
    `${norm(item.subject)}\u0000${norm(item.predicate)}\u0000${norm(item.object)}`;
  const expectedKeys = new Set(expected.map(key));
  const extractedKeys = new Set(extracted.map(key));
  const correct = [...extractedKeys].filter((value) => expectedKeys.has(value)).length;
  const expectedEntities = new Set(expected.flatMap((item) => [norm(item.subject), norm(item.object)]));
  const extractedEntities = new Set(extracted.flatMap((item) => [norm(item.subject), norm(item.object)]));
  const foundEntities = [...expectedEntities].filter((value) => extractedEntities.has(value)).length;
  return {
    tokenCost: Number.isFinite(tokenCost as number) ? tokenCost : null,
    ingestionDurationMs: Math.max(0, ingestionDurationMs),
    entityRecall: expectedEntities.size ? foundEntities / expectedEntities.size : null,
    edgeAccuracy: extractedKeys.size ? correct / extractedKeys.size : null,
    expectedEdges: expectedKeys.size,
    extractedEdges: extractedKeys.size,
  };
}

const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vault";

function hash32(input: string, seed = 0): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Deterministic RFC-4122-shaped UUIDv5 fallback (identity only, not security). */
export function deterministicUuid(input: string): string {
  const bytes = new Uint8Array(16);
  for (let block = 0; block < 4; block++) {
    const hash = hash32(input, Math.imul(block + 1, 0x9e3779b1));
    bytes[block * 4] = hash >>> 24;
    bytes[block * 4 + 1] = hash >>> 16;
    bytes[block * 4 + 2] = hash >>> 8;
    bytes[block * 4 + 3] = hash;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function episodeUuid(node: KosmosNode, namespace: string): string {
  const uid = node.okf?.uid;
  return uid && UUID.test(uid) ? uid : deterministicUuid(`${namespace}\u0000${node.path}`);
}

function referenceTimeSource(node: KosmosNode): string {
  const projectedCreated = node.okf?.projection?.authored.createdAt;
  if (typeof projectedCreated === "string" && !Number.isNaN(Date.parse(projectedCreated))) return "okf.created_at";
  if (node.okf?.timestamp && !Number.isNaN(Date.parse(node.okf.timestamp))) return "okf.timestamp";
  if (node.createdAt) return "file.created_at";
  if (node.updatedAt) return "file.updated_at";
  return "index_time_fallback";
}

function bounded(value: unknown, max: number, depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  if (typeof value === "string") return value.length > max ? value.slice(0, max) : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => bounded(item, max, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, item]) => [key.slice(0, 80), bounded(item, max, depth + 1)])
    );
  }
  return value;
}

function sagaFor(node: KosmosNode): { id: string; kind: string } | null {
  const type = (node.okf?.type || node.type || "").toLowerCase();
  const path = node.path.toLowerCase();
  if ((node.okf?.supersedesIds?.length ?? 0) > 0 || (node.okf?.supersededByIds?.length ?? 0) > 0) {
    return { id: `lineage:${node.okf?.uid ?? contentHash(node.path)}`, kind: "version-lineage" };
  }
  if (type.includes("spec") || path.includes("spec")) {
    return { id: `specification:${slug(node.label.replace(/v?\d+(?:\.\d+)*/gi, ""))}`, kind: "versioned-specification" };
  }
  if (type.includes("project") || path.includes("project")) return { id: `project:${slug(node.area)}`, kind: "project-history" };
  if (type.includes("meeting") || path.includes("meeting")) return { id: `meeting:${slug(node.area)}`, kind: "recurring-meeting" };
  if (type.includes("research") || path.includes("research")) return { id: `research:${slug(node.area)}`, kind: "research-thread" };
  return null;
}

function effectiveRelationshipEntries(node: KosmosNode): Array<{ relation: OkfRelation | string; target: string }> {
  const source = node.okf?.projection?.effective.relationships ?? node.okf?.relations ?? {};
  const output: Array<{ relation: OkfRelation | string; target: string }> = [];
  for (const [relation, rawTargets] of Object.entries(source)) {
    const targets = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
    for (const rawTarget of targets) {
      if (typeof rawTarget === "string") output.push({ relation, target: rawTarget });
      else if (rawTarget && typeof rawTarget === "object" && typeof (rawTarget as any).target === "string") {
        output.push({ relation, target: String((rawTarget as any).target) });
      }
    }
  }
  return output.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.relation === item.relation && candidate.target === item.target) === index
  );
}

export function graphitiIngestionProfile(options: GraphitiOptions = {}): GraphitiIngestionProfile {
  const combined = options.combinedExtraction === true;
  return {
    adapter: "Kosmos Governed Context Projection",
    adapterSchema: GRAPHITI_ADAPTER_SCHEMA,
    testedGraphitiCore: GRAPHITI_CORE_VERSION,
    combinedExtraction: combined,
    combinedExtractionSurface: combined ? "graphiti-0.29-low-level-utility" : "disabled",
    publicAddEpisodeSupportsCombinedExtraction: false,
    episodeMetadataTransport: "adapter-envelope-and-episode-body",
    attributeMaxChars: options.maxAttributeChars ?? DEFAULT_GRAPHITI_ATTRIBUTE_CHARS,
    readiness: { acceptedIsSearchable: false, statusCheckRequired: true, terminalStates: ["completed", "failed"] },
    benchmark: { required: combined, metrics: ["token_cost", "ingestion_duration_ms", "entity_recall", "edge_accuracy"] },
  };
}

/** Build chronological Graphiti episodes from the effective source projection. */
export function buildGraphitiEpisodes(graph: KosmosGraph, options: GraphitiOptions = {}): GraphitiEpisode[] {
  const vault = options.vault || "vault";
  const namespace = options.vaultIdentity || vault;
  const maxAttributeChars = options.maxAttributeChars ?? DEFAULT_GRAPHITI_ATTRIBUTE_CHARS;
  const groupId = options.groupId || `okf-${slug(vault)}-${hash32(namespace).toString(16).padStart(8, "0")}-assertions`;
  const corpusId = options.corpusId || groupId;
  const processingTime = options.processingTime || graph.stats.indexedAt;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const label = (id: string): string => byId.get(id)?.label ?? id;
  const output: GraphitiEpisode[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== "file") continue;
    const okf = node.okf;
    const projection = okf?.projection;
    const title = okf?.title || node.label;
    const timestamp = node.validAt ?? node.createdAt ?? processingTime;
    const sourceOrigin = typeof (projection?.authored.authorship as any)?.origin === "string"
      ? String((projection?.authored.authorship as any).origin)
      : "unknown";
    const semantic = [...new Set(
      graph.links
        .filter((link) => link.kind === "semantic" && link.source === node.id)
        .map((link) => label(link.target))
    )];
    const saga = options.sagaMapping ? sagaFor(node) : null;
    const metadata: Record<string, string | number | boolean | null> = {
      vault_identity: contentHash(namespace),
      source_path_hash: contentHash(node.path),
      okf_version: okf?.okfVersion ?? null,
      uid: okf?.uid ?? null,
      note_type: okf?.type || node.type || "note",
      sensitivity: String(projection?.effective.sensitivity ?? okf?.sensitivity ?? "internal"),
      policy_version: projection?.assessment.policy.version ?? "legacy",
      corpus_id: corpusId,
      workspace_id: groupId,
      event_time: timestamp,
      processing_time: processingTime,
      ...(saga ? { saga_id: saga.id, saga_kind: saga.kind } : {}),
    };

    output.push({
      uuid: episodeUuid(node, namespace),
      name: title,
      episode_body: JSON.stringify(bounded({
        schema: GRAPHITI_ADAPTER_SCHEMA,
        profile: "okf-plus-2.3-validating-projection",
        adapter: "Kosmos Governed Context Projection",
        title,
        path: node.path,
        uid: okf?.uid ?? null,
        type: okf?.type || node.type || "note",
        description: okf?.description ?? null,
        tags: node.tags,
        labels: projection ? {
          authored: projection.authored.labels,
          derived: projection.derived.labels,
          proposed: projection.proposed.labels,
          approved: projection.approved.labels,
          effective: projection.effective.labels,
        } : null,
        event_time: timestamp,
        processing_time: processingTime,
        reference_time_source: referenceTimeSource(node),
        episode_metadata: metadata,
        authority: {
          class: sourceOrigin,
          governance_status: "unadjudicated",
          projection_status: "non_authoritative",
          accepted_semantics: false,
          origin_separation_preserved: true,
        },
        governance: projection ? {
          effective: {
            sensitivity: projection.effective.sensitivity,
            labels: projection.effective.labels,
            relationships: projection.effective.relationships,
          },
          relationships: {
            authored: projection.authored.relationships,
            derived: projection.derived.relationships,
            proposed: projection.proposed.relationships,
            approved: projection.approved.relationships,
            effective: projection.effective.relationships,
          },
          effective_sensitivity: projection.effective.sensitivity,
          assessment: {
            overall: projection.assessment.scores.overall,
            label: projection.assessment.labels.derived[0] ?? "assessment:not-assessable",
            interpretation: projection.assessment.interpretation,
            policy_id: projection.assessment.policy.id,
            policy_version: projection.assessment.policy.version,
            policy_hash: projection.assessment.policy.hash,
          },
          diagnostics_count: projection.diagnostics.length,
        } : null,
        diagnostic_codes: projection?.diagnostics.map((item) => item.code) ?? [],
        evidence: projection ? {
          authored: projection.authored.evidence ?? {},
          derived: projection.derived.evidence ?? {},
          proposed: projection.proposed.evidence ?? {},
          approved: projection.approved.evidence ?? {},
          effective: projection.effective.evidence ?? {},
        } : null,
        integrity: {
          content_hash: projection?.contentHash ?? node.contentHash ?? null,
          hash_algorithm: "fnv1a32-with-length",
          policy_id: projection?.assessment.policy.id ?? null,
          policy_version: projection?.assessment.policy.version ?? null,
          policy_hash: projection?.assessment.policy.hash ?? null,
          schema_id: "okf-plus-graphiti",
          schema_version: "2.3.0",
          schema_hash: `fnv1a32-with-length:${contentHash(GRAPHITI_ADAPTER_SCHEMA)}`,
        },
        lineage: {
          resolved_supersedes: (okf?.supersedesIds ?? []).map(label),
          declared_supersedes: okf?.supersedes ?? [],
        },
        related_to: semantic,
        saga,
      }, maxAttributeChars)),
      source: "json",
      source_description: `OKF+ origin-separated source projection (${sourceOrigin}) · KGCP non-authoritative Graphiti adapter · vault "${vault}" · ${node.path}`,
      reference_time: timestamp,
      group_id: groupId,
      episode_metadata: metadata,
    });

    for (const relationship of effectiveRelationshipEntries(node)) {
      const subjectUid = okf?.uid ?? episodeUuid(node, namespace);
      output.push({
        uuid: deterministicUuid(`${subjectUid}\u0000${relationship.relation}\u0000${relationship.target}`),
        name: `${title} ${relationship.relation} ${relationship.target}`,
        episode_body: JSON.stringify({
          schema: GRAPHITI_ADAPTER_SCHEMA,
          subject_uid: subjectUid,
          subject: title,
          predicate: relationship.relation,
          object_ref: relationship.target,
          origin: "effective-non-proposed-projection",
          event_time: timestamp,
          processing_time: processingTime,
        }),
        source: "fact_triple",
        source_description: `Effective non-proposed OKF+ relationship projection from ${node.path}`,
        reference_time: timestamp,
        group_id: groupId,
        episode_metadata: { ...metadata, episode_kind: "fact_triple", relationship: relationship.relation },
      });
    }
  }

  output.sort((left, right) =>
    left.reference_time.localeCompare(right.reference_time) || left.uuid.localeCompare(right.uuid)
  );
  return output;
}

/** Attach source bodies only to note JSON episodes, never relationship triples. */
export function attachGraphitiContent(
  episodes: GraphitiEpisode[],
  contents: Map<string, string>,
  maxContentChars = DEFAULT_GRAPHITI_CONTENT_CHARS
): GraphitiEpisode[] {
  const cap = Math.max(1, Math.floor(maxContentChars));
  for (const episode of episodes) {
    if (episode.source !== "json") continue;
    try {
      const body = JSON.parse(episode.episode_body);
      const content = contents.get(body.path);
      if (content == null) continue;
      body.content_char_count = content.length;
      body.content_truncated = content.length > cap;
      body.content = content.length > cap ? content.slice(0, cap) : content;
      episode.episode_body = JSON.stringify(body);
    } catch { /* generated bodies are valid JSON; external mutations are ignored */ }
  }
  return episodes;
}

export function buildGraphitiEpisodesWithContent(
  graph: KosmosGraph,
  contents: Map<string, string>,
  options: GraphitiOptions = {}
): GraphitiEpisode[] {
  return attachGraphitiContent(
    buildGraphitiEpisodes(graph, options),
    contents,
    options.maxContentChars ?? DEFAULT_GRAPHITI_CONTENT_CHARS
  );
}

/** Strip YAML frontmatter from raw note text (for episode content payloads). */
export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}
