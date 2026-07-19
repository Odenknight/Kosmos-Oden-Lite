/**
 * OKF+ v2.3 Validating Projection Profile.
 *
 * This module is deliberately source-preserving and read-only. It parses the
 * bounded YAML subset used by the v2.3 canonical examples, keeps unknown
 * extension fields, separates authored/derived/proposed/approved projections,
 * and calculates deterministic documentation-quality assessments. It is not a
 * governed writer and never changes a source note.
 */
import { KOSMOS_VERSION } from "./version";
import type {
  OkfAssessment,
  OkfAssessmentScores,
  OkfData,
  OkfDiagnostic,
  OkfOrigin,
  OkfOriginProjection,
  OkfProjection,
  OkfSensitivity,
} from "./types";

export const OKF23_PROFILE = "okf-plus-2.3-validating-projection" as const;
export const OKF23_POLICY = Object.freeze({
  id: "policy:okf23-default-v1",
  version: "1.0.0",
  // SHA-256 of the canonical policy JSON shipped in docs/OKF-PLUS-2.3-PROFILE.md.
  hash: "sha256:c2c476ca6f847bca20477d36ddda7a443d9fb4c5a9b1c3677a4347436deb0fb2",
  compatibleOkfVersions: ["2.3"],
  missingValueBehavior: "exclude-null-and-renormalize",
  weights: Object.freeze({
    structural_completeness: 0.15,
    provenance_quality: 0.20,
    evidence_support: 0.20,
    relationship_integrity: 0.15,
    temporal_freshness: 0.10,
    contradiction_status: 0.10,
    review_readiness: 0.10,
  }),
  sensitivityDefault: "internal" as OkfSensitivity,
  assessmentThresholds: Object.freeze([
    [0.90, "assessment:strongly-documented"],
    [0.75, "assessment:well-documented"],
    [0.60, "assessment:partially-supported"],
    [0.40, "assessment:weakly-supported"],
    [0.01, "assessment:insufficient"],
    [0.00, "assessment:invalid-or-untraceable"],
  ] as const),
});

const CORE_FIELDS = new Set([
  "okf_version", "uid", "title", "type", "created_at", "updated_at",
  "authorship", "epistemic", "sensitivity", "provenance", "relationships",
  "evidence", "lineage", "review", "assessment", "authorization", "labels",
]);
const LEGACY_FIELDS = new Set([
  "description", "timestamp", "epistemic_state", "authorship_origin", "scope", "scope_id", "resource",
  "tags", "aliases", "supersedes", "superseded_by", "supersededBy",
  "forked_from", "forked_to", "forked_by", "depends_on", "derives_from",
  "contradicts", "refines", "implements", "blocks", "documents", "cites", "related_to",
]);
const RELATION_TYPES = [
  "supports", "contradicts", "depends_on", "derived_from", "derives_from", "cites",
  "quotes", "interprets", "tests", "replicates", "fails_to_replicate", "extends",
  "narrows", "generalizes", "implements", "governed_by", "reviewed_by", "approved_by",
  "supersedes", "superseded_by", "related_to", "part_of", "has_part",
] as const;
const INVERSES: Record<string, string> = {
  supports: "supported_by", contradicts: "contradicted_by", depends_on: "required_by",
  derived_from: "source_of", derives_from: "source_of", cites: "cited_by", quotes: "quoted_by",
  interprets: "interpreted_by", tests: "tested_by", replicates: "replicated_by",
  fails_to_replicate: "failed_replication_by", extends: "extended_by", narrows: "broadened_by",
  generalizes: "specialized_by", implements: "implemented_by", governed_by: "governs",
  reviewed_by: "reviews", approved_by: "approves", supersedes: "superseded_by",
  superseded_by: "supersedes", related_to: "related_to", part_of: "has_part", has_part: "part_of",
};
const EPISTEMIC_STATES = new Set([
  "unknown", "observation", "reported", "inferred", "hypothesis", "modeled",
  "supported", "contested", "refuted", "retracted", "accepted", "superseded",
]);
const SENSITIVITY_LEVELS: OkfSensitivity[] = [
  "public", "internal", "restricted", "confidential", "regulated", "phi", "secret",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAMESPACED_ID = /^[a-z][a-z0-9_.-]*:[a-z0-9][a-z0-9_.:/-]{2,}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/i;

interface YamlLine { indent: number; text: string; line: number }

function diagnostic(
  code: string,
  severity: OkfDiagnostic["severity"],
  message: string,
  sourcePath: string,
  field?: string,
  remediation?: string,
): OkfDiagnostic {
  return { code, severity, field, message, deterministic: true, remediation, sourcePath };
}

function headerFromMarkdown(raw: string): { header: string | null; issue?: string } {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (!source.startsWith("---")) return { header: null };
  const end = source.indexOf("\n---", 3);
  if (end < 0) return { header: null, issue: "unterminated" };
  const header = source.slice(3, end).replace(/^\r?\n/, "");
  if (header.length > 262_144) return { header: null, issue: "too-large" };
  return { header };
}

function stripYamlComment(value: string): string {
  let single = false, double = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single && value[i - 1] !== "\\") double = !double;
    else if (ch === "#" && !single && !double && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value;
}

function splitInline(value: string): string[] {
  const out: string[] = [];
  let buf = "", single = false, double = false, depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && !double) single = !single;
    else if (ch === '"' && !single && value[i - 1] !== "\\") double = !double;
    else if (!single && !double && (ch === "[" || ch === "{")) depth++;
    else if (!single && !double && (ch === "]" || ch === "}")) depth--;
    if (ch === "," && !single && !double && depth === 0) { out.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function scalar(raw: string): unknown {
  const value = stripYamlComment(raw).trim();
  if (!value || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("[") && value.endsWith("]")) return splitInline(value.slice(1, -1)).map(scalar);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function keyValue(text: string): { key: string; rest: string } | null {
  const m = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(text);
  return m ? { key: m[1], rest: m[2] ?? "" } : null;
}

function parseBlock(lines: YamlLine[], start: number, indent: number, issues: Array<{ line: number; message: string }>): { value: unknown; next: number } {
  const arrayMode = lines[start]?.indent === indent && lines[start].text.startsWith("-");
  if (arrayMode) {
    const out: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("-")) {
      const itemText = lines[i].text.replace(/^-\s?/, "").trim();
      i++;
      const first = keyValue(itemText);
      if (!itemText) {
        if (i < lines.length && lines[i].indent > indent) { const child = parseBlock(lines, i, lines[i].indent, issues); out.push(child.value); i = child.next; }
        else out.push(null);
      } else if (first) {
        const obj: Record<string, unknown> = {};
        if (first.rest) obj[first.key] = scalar(first.rest);
        else if (i < lines.length && lines[i].indent > indent) { const child = parseBlock(lines, i, lines[i].indent, issues); obj[first.key] = child.value; i = child.next; }
        else obj[first.key] = null;
        if (i < lines.length && lines[i].indent > indent) {
          const child = parseBlock(lines, i, lines[i].indent, issues);
          if (child.value && typeof child.value === "object" && !Array.isArray(child.value)) Object.assign(obj, child.value);
          else issues.push({ line: lines[i].line, message: "A mapping list item has a non-mapping continuation." });
          i = child.next;
        }
        out.push(obj);
      } else {
        out.push(scalar(itemText));
        if (i < lines.length && lines[i].indent > indent) {
          issues.push({ line: lines[i].line, message: "A scalar list item has an unexpected nested continuation." });
          const child = parseBlock(lines, i, lines[i].indent, issues); i = child.next;
        }
      }
    }
    return { value: out, next: i };
  }

  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("-")) {
    const entry = keyValue(lines[i].text);
    if (!entry) { issues.push({ line: lines[i].line, message: "Unsupported YAML mapping line." }); i++; continue; }
    i++;
    if (Object.prototype.hasOwnProperty.call(out, entry.key)) issues.push({ line: lines[i - 1].line, message: `Duplicate key ${entry.key}.` });
    if (entry.rest) out[entry.key] = scalar(entry.rest);
    else if (i < lines.length && lines[i].indent > indent) { const child = parseBlock(lines, i, lines[i].indent, issues); out[entry.key] = child.value; i = child.next; }
    else out[entry.key] = null;
  }
  return { value: out, next: i };
}

/** Parse the non-executable YAML subset used by the OKF+ v2.3 profile. */
export function parseOkf23Frontmatter(raw: string): { data: Record<string, unknown>; issues: Array<{ line: number; message: string }>; present: boolean } {
  const bounded = headerFromMarkdown(raw);
  if (!bounded.header) return {
    data: {}, present: false,
    issues: bounded.issue ? [{ line: 1, message: bounded.issue === "too-large" ? "Frontmatter exceeds 256 KiB." : "Frontmatter is unterminated." }] : [],
  };
  const issues: Array<{ line: number; message: string }> = [];
  const lines: YamlLine[] = [];
  for (const [index, rawLine] of bounded.header.split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    if (/\t/.test(rawLine.match(/^\s*/)?.[0] ?? "")) { issues.push({ line: index + 2, message: "Tabs are not allowed for YAML indentation." }); continue; }
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    lines.push({ indent, text: rawLine.trim(), line: index + 2 });
  }
  if (lines.length > 4096) return { data: {}, present: true, issues: [{ line: 1, message: "Frontmatter exceeds 4096 logical lines." }] };
  if (!lines.length) return { data: {}, present: true, issues };
  if (lines[0].indent !== 0) issues.push({ line: lines[0].line, message: "Top-level frontmatter must start at indentation zero." });
  const parsed = parseBlock(lines, 0, lines[0].indent, issues);
  if (parsed.next < lines.length) issues.push({ line: lines[parsed.next].line, message: "Unparsed YAML content remains." });
  return { data: parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : {}, present: true, issues };
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v];
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const rounded = (n: number | null): number | null => n == null ? null : Math.round(clamp(n) * 10_000) / 10_000;

function relationTarget(item: unknown): string | null {
  const normalize = (value: string | null): string | null => {
    if (!value) return null;
    const raw = value.trim();
    const wiki = /^\[\[([^\]\r\n]+)\]\]$/.exec(raw);
    const target = (wiki?.[1] ?? raw).split("|")[0].split("#")[0].trim();
    return target || null;
  };
  if (typeof item === "string") return normalize(item);
  const obj = record(item);
  return normalize(text(obj.target) ?? text(obj.target_uid) ?? text(obj.uid));
}

function relationOrigin(item: unknown, fallback: OkfOrigin = "authored"): OkfOrigin {
  const value = text(record(item).origin);
  return value === "derived" || value === "proposed" || value === "approved" || value === "authored" ? value : fallback;
}

function blankProjection(): OkfOriginProjection { return { tags: [], labels: [], relationships: {} }; }

function splitRelations(source: Record<string, unknown>, origins: Record<OkfOrigin, OkfOriginProjection>, fallback: OkfOrigin): void {
  for (const type of RELATION_TYPES) {
    for (const item of list(source[type])) {
      const target = relationTarget(item);
      if (!target) continue;
      const origin = relationOrigin(item, fallback);
      (origins[origin].relationships[type] ??= []).push(item);
    }
  }
}

function appendAuthoredRelationships(target: OkfOriginProjection, type: string, values: string[]): void {
  if (!values.length) return;
  const existing = target.relationships[type] ?? [];
  const seen = new Set(existing.map(relationTarget).filter((value): value is string => Boolean(value)));
  for (const value of values) {
    const normalized = relationTarget(value);
    if (normalized && !seen.has(normalized)) { existing.push(normalized); seen.add(normalized); }
  }
  target.relationships[type] = existing;
}

function replaceAuthoredRelationships(target: OkfOriginProjection, type: string, values: string[]): void {
  const normalized = [...new Set(values.map(relationTarget).filter((value): value is string => Boolean(value)))];
  if (normalized.length) target.relationships[type] = normalized;
  else delete target.relationships[type];
}

function compatibleEpistemicState(value: string | null): string | null {
  if (value === "fact") return "reported";
  if (value === "verified_inference") return "inferred";
  if (value === "deprecated") return "superseded";
  return value;
}

function splitLabels(source: Record<string, unknown>, origins: Record<OkfOrigin, OkfOriginProjection>): void {
  for (const origin of ["authored", "derived", "proposed", "approved"] as OkfOrigin[]) {
    origins[origin].labels = list(source[origin]).filter((x) => typeof x === "string" || (x && typeof x === "object"));
  }
}

function splitEvidence(source: Record<string, unknown>, origins: Record<OkfOrigin, OkfOriginProjection>, fallback: OkfOrigin): void {
  for (const kind of ["supports", "contradicts"] as const) {
    for (const item of list(source[kind])) {
      const origin = relationOrigin(item, fallback);
      const evidence = record(origins[origin].evidence);
      const items = list(evidence[kind]);
      items.push(item);
      evidence[kind] = items;
      origins[origin].evidence = evidence;
    }
  }
}

function evidenceEntries(projection: OkfProjection, kind: "supports" | "contradicts"): unknown[] {
  const out: unknown[] = [];
  for (const origin of [projection.authored, projection.derived, projection.proposed, projection.approved]) {
    const evidence = record(origin.evidence);
    out.push(...list(evidence[kind]));
  }
  return out;
}

function groupedEvidence(items: unknown[]): number | null {
  if (!items.length) return null;
  const groups = new Map<string, number>();
  let assessable = 0;
  for (const [index, item] of items.entries()) {
    const obj = record(item);
    const strength = number(obj.strength), relevance = number(obj.relevance);
    if (strength == null || relevance == null || strength < 0 || strength > 1 || relevance < 0 || relevance > 1) continue;
    assessable++;
    // The built-in policy maps an explicitly referenced but unverified source to 0.45.
    const sourceQuality = text(obj.source_uid) || text(obj.target) ? 0.45 : 0.20;
    const weight = strength * relevance * sourceQuality;
    const group = text(obj.independence_group) ?? `ungrouped:${index}`;
    groups.set(group, Math.max(groups.get(group) ?? 0, weight));
  }
  if (!assessable) return null;
  let product = 1;
  for (const weight of groups.values()) product *= 1 - weight;
  return 1 - product;
}

function hasApproval(approved: OkfOriginProjection, authored: OkfOriginProjection): boolean {
  const authorization = record(authored.authorization);
  return approved.labels.length > 0 || Object.keys(approved.relationships).length > 0 || Boolean(text(authorization.decision_id));
}

function assessmentLabel(score: number | null): string {
  if (score == null) return "assessment:not-assessable";
  for (const [threshold, label] of OKF23_POLICY.assessmentThresholds) if (score >= threshold) return label;
  return "assessment:not-assessable";
}

export function assessOkf23(projection: OkfProjection): OkfAssessment {
  const a = projection.authored;
  const diagnostics = projection.diagnostics;
  const frontmatter = projection.rawFrontmatter;
  const uid = text(a.uid);
  const epistemic = record(a.epistemic);
  const provenance = record(a.provenance);
  const review = record(a.review);
  const relationships = record(frontmatter.relationships);

  const structureParts: Array<[number, boolean]> = [
    [0.15, Boolean(uid && (UUID.test(uid) || NAMESPACED_ID.test(uid)))],
    [0.05, Boolean(text(a.title))], [0.10, Boolean(text(a.type))],
    [0.10, Boolean(text(a.createdAt) && !Number.isNaN(Date.parse(text(a.createdAt)!)))],
    [0.10, Object.keys(record(a.authorship)).length > 0], [0.10, Boolean(text(epistemic.state))],
    [0.10, Boolean(text(record(a.sensitivityBlock).level) || a.sensitivity)],
    [0.15, Object.keys(provenance).length > 0], [0.10, Object.keys(relationships).length > 0],
    [0.05, Object.keys(review).length > 0 && Object.keys(record(a.assessmentReference)).length > 0],
  ];
  const structural = structureParts.reduce((sum, [weight, valid]) => sum + (valid ? weight : 0), 0);

  let provenanceQuality = 0;
  const refs = list(provenance.source_refs).filter((x) => text(x));
  const locator = record(provenance.source_locator);
  const hash = text(provenance.content_hash);
  if (refs.length) provenanceQuality = Object.keys(locator).length ? (hash && SHA256.test(hash) ? 0.80 : 0.65) : 0.45;
  else if (text(provenance.source_kind)) provenanceQuality = 0.20;
  if (record(provenance.extraction).method == null) provenanceQuality -= 0.10;
  if (diagnostics.some((d) => d.code.startsWith("OKF-PROVENANCE") && d.severity === "error")) provenanceQuality -= 0.20;

  const support = groupedEvidence(evidenceEntries(projection, "supports"));
  const contradiction = groupedEvidence(evidenceEntries(projection, "contradicts"));
  const evidenceSupport = support == null ? null : support * (1 - 0.75 * (contradiction ?? 0));

  let relationshipIntegrity = 1;
  for (const d of diagnostics) {
    if (d.code === "OKF-IDENTITY-003" || d.code === "OKF-LINEAGE-002") relationshipIntegrity = 0;
    else if (d.code.startsWith("OKF-RELATIONSHIP") && d.severity === "error") relationshipIntegrity -= 0.20;
    else if (d.code.startsWith("OKF-LINEAGE") && d.severity === "error") relationshipIntegrity -= 0.30;
    else if (d.code.startsWith("OKF-RELATIONSHIP") || d.code.startsWith("OKF-LINEAGE")) relationshipIntegrity -= 0.10;
  }

  let freshness: number | null = null;
  const lastReview = text(review.last_reviewed_at), nextDue = text(review.next_review_due);
  if (lastReview && !Number.isNaN(Date.parse(lastReview))) {
    const anchor = text(a.updatedAt) ?? text(a.createdAt) ?? lastReview;
    const age = Math.max(0, Date.parse(anchor) - Date.parse(lastReview));
    freshness = clamp(1 - age / (395 * 86_400_000));
  } else if (nextDue && !Number.isNaN(Date.parse(nextDue))) freshness = 1;

  const contradictionStatus = contradiction == null ? null : clamp(1 - contradiction);
  const readinessParts: Array<[number, boolean]> = [
    [0.15, Boolean(text(a.title))], [0.20, refs.length > 0],
    [0.15, evidenceEntries(projection, "supports").length > 0],
    [0.15, evidenceEntries(projection, "contradicts").length > 0 || Boolean(record(a.evidence).contradicts)],
    [0.10, projection.proposed.labels.length > 0 || Object.keys(projection.proposed.relationships).length > 0],
    [0.10, Boolean(text(record(a.authorization).status))], [0.05, Boolean(a.sensitivity)],
    [0.05, Boolean(text(record(a.authorization).authorized_by))], [0.05, Boolean(record(a.assessmentReference).current_assessment_id)],
  ];
  const reviewReadiness = readinessParts.reduce((sum, [weight, valid]) => sum + (valid ? weight : 0), 0);

  const components: OkfAssessmentScores = {
    structural_completeness: rounded(structural), provenance_quality: rounded(provenanceQuality),
    evidence_support: rounded(evidenceSupport), relationship_integrity: rounded(relationshipIntegrity),
    temporal_freshness: rounded(freshness), contradiction_status: rounded(contradictionStatus),
    review_readiness: rounded(reviewReadiness), overall: null,
  };
  let weighted = 0, applied = 0;
  const exclusions: string[] = [];
  for (const [key, weight] of Object.entries(OKF23_POLICY.weights)) {
    const value = components[key as keyof OkfAssessmentScores];
    if (value == null) exclusions.push(key);
    else { weighted += value * weight; applied += weight; }
  }
  components.overall = applied ? rounded(weighted / applied) : null;
  const label = assessmentLabel(components.overall);
  const deterministicAt = text(a.updatedAt) ?? text(a.createdAt) ?? "1970-01-01T00:00:00.000Z";
  return {
    assessmentId: `assessment:${projection.contentHash.replace(/[^a-z0-9]/gi, "-")}`,
    targetUid: uid, profile: OKF23_PROFILE,
    policy: { id: OKF23_POLICY.id, version: OKF23_POLICY.version, hash: OKF23_POLICY.hash, weights: { ...OKF23_POLICY.weights }, missingValueBehavior: OKF23_POLICY.missingValueBehavior },
    assessor: { id: "tool:kosmos-oden", engineVersion: KOSMOS_VERSION }, inputHash: `fnv1a32:${projection.contentHash}`,
    calculatedAt: deterministicAt, scores: components, exclusions, labels: { derived: [label] }, diagnostics: [...diagnostics],
    interpretation: "documentation-and-support-quality-not-truth",
  };
}

/** Build an origin-preserving projection for canonical v2.3 and legacy notes. */
export function buildOkf23Projection(raw: string, sourcePath: string, contentHash: string, legacy: OkfData | null): OkfProjection | undefined {
  const parsed = parseOkf23Frontmatter(raw);
  const data = parsed.data;
  const version = text(data.okf_version);
  if (!parsed.present && !legacy) return undefined;
  const mode: OkfProjection["mode"] = version === "2.3" ? "strict-v2.3" : version ? "compatible" : "legacy";
  const diagnostics: OkfDiagnostic[] = parsed.issues.map((issue) => diagnostic("OKF-SCHEMA-001", "error", `${issue.message} (line ${issue.line})`, sourcePath, "frontmatter"));
  if (version && version !== "2.3") diagnostics.push(diagnostic("OKF-SCHEMA-002", "info", `OKF+ ${version} is read through the compatibility projection; the source note was not rewritten.`, sourcePath, "okf_version"));
  if (!version) diagnostics.push(diagnostic("OKF-SCHEMA-003", "warning", "No OKF+ version is declared; legacy compatibility semantics apply.", sourcePath, "okf_version"));

  const origins: Record<OkfOrigin, OkfOriginProjection> = {
    authored: blankProjection(), derived: blankProjection(), proposed: blankProjection(), approved: blankProjection(),
  };
  const authored = origins.authored;
  authored.uid = text(data.uid) ?? legacy?.uid ?? null;
  authored.title = text(data.title) ?? legacy?.title ?? null;
  authored.type = text(data.type) ?? legacy?.type ?? null;
  authored.createdAt = text(data.created_at) ?? legacy?.timestamp ?? null;
  authored.updatedAt = text(data.updated_at);
  authored.tags = list(data.tags).filter((value): value is string => typeof value === "string");
  // The flat editable 2.3 profile authors governance essentials as scalar
  // Obsidian Properties (authorship_origin, epistemic_state, sensitivity);
  // nested blocks, when present, always win over the flat equivalents.
  const flatOrigin = text(data.authorship_origin);
  authored.authorship = Object.keys(record(data.authorship)).length
    ? record(data.authorship)
    : flatOrigin ? { origin: flatOrigin } : {};
  const declaredOrigin = text(record(data.authorship).origin) ?? flatOrigin ?? "unknown";
  authored.assertionOrigin = declaredOrigin;
  const fallbackOrigin: OkfOrigin = declaredOrigin === "derived" || declaredOrigin === "proposed" || declaredOrigin === "approved" ? declaredOrigin : "authored";
  authored.epistemic = record(data.epistemic);
  authored.epistemicState = compatibleEpistemicState(text(record(data.epistemic).state) ?? text(data.epistemic_state) ?? legacy?.epistemicState ?? null);
  authored.sensitivityBlock = record(data.sensitivity);
  const flatSensitivity = typeof data.sensitivity === "string" ? text(data.sensitivity) : null;
  authored.sensitivity = (text(record(data.sensitivity).level) ?? flatSensitivity ?? legacy?.sensitivity ?? null) as OkfSensitivity | null;
  authored.provenance = record(data.provenance);
  authored.evidence = {};
  authored.lineage = record(data.lineage);
  authored.review = record(data.review);
  authored.assessmentReference = record(data.assessment);
  authored.authorization = record(data.authorization);
  splitLabels(record(data.labels), origins);
  splitRelations(record(data.relationships), origins, fallbackOrigin);
  splitEvidence(record(data.evidence), origins, fallbackOrigin);

  if (version === "2.3") {
    const requiredScalars = ["okf_version", "uid", "title", "type", "created_at"];
    for (const key of requiredScalars) if (!text(data[key])) diagnostics.push(diagnostic("OKF-SCHEMA-004", "error", `Required OKF+ 2.3 field ${key} is missing or empty.`, sourcePath, key));
    // Governance blocks are optional in-note: the flat editable profile keeps
    // them out of frontmatter and the projection supplies in-memory defaults
    // (spec §2.1 permits derived metadata to live outside the source note).
    // When a block IS authored it must be a mapping, except sensitivity which
    // may be a flat scalar level.
    const optionalBlocks = ["authorship", "epistemic", "provenance", "relationships", "evidence", "lineage", "review", "assessment", "authorization", "labels"];
    for (const key of optionalBlocks) if (data[key] != null && (typeof data[key] !== "object" || Array.isArray(data[key]))) {
      diagnostics.push(diagnostic("OKF-SCHEMA-004", "error", `OKF+ 2.3 block ${key} must be a mapping when present.`, sourcePath, key));
    }
    if (data.sensitivity != null && typeof data.sensitivity !== "string" && (typeof data.sensitivity !== "object" || Array.isArray(data.sensitivity))) {
      diagnostics.push(diagnostic("OKF-SCHEMA-004", "error", "OKF+ 2.3 sensitivity must be a flat level or a mapping.", sourcePath, "sensitivity"));
    }
    if (!text(record(data.epistemic).state) && !text(data.epistemic_state)) {
      diagnostics.push(diagnostic("OKF-SCHEMA-004", "error", "OKF+ 2.3 requires an epistemic state (epistemic.state or flat epistemic_state).", sourcePath, "epistemic.state"));
    }
  }

  const assignment = record(data.okf_assignment);
  const assignedRole = text(record(assignment.role).id);
  if (assignedRole === "specialist-reviewer") {
    const authority = record(assignment.authority);
    for (const key of ["may_approve", "may_authorize_use", "may_modify_originals", "may_lower_sensitivity", "may_promote_epistemic_state", "may_change_authoritative_lineage"]) {
      if (authority[key] === true) diagnostics.push(diagnostic("OKF-AUTHORITY-ROLE-001", "critical", `Specialist Reviewer assignment cannot grant ${key} without a separate accepted authority contract.`, sourcePath, `okf_assignment.authority.${key}`));
    }
    if (text(record(assignment.output).write_mode) !== "proposal-sidecar-only") diagnostics.push(diagnostic("OKF-AUTHORITY-ROLE-002", "error", "Specialist Reviewer output must be proposal-sidecar-only.", sourcePath, "okf_assignment.output.write_mode"));
  }
  // Flat Obsidian Properties remain the human-editable authoring surface even
  // when a native 2.3 note is present. This makes a tags/relationship edit take
  // effect on the next incremental vault update without editing nested YAML.
  if (legacy) {
    for (const kind of RELATION_TYPES) {
      const targets = legacy.relations[kind] ?? [];
      // Presence matters: an explicitly emptied Property removes the authored
      // nested declaration instead of silently resurrecting it.
      if (version === "2.3" && Object.prototype.hasOwnProperty.call(data, kind)) replaceAuthoredRelationships(authored, kind, targets);
      else appendAuthoredRelationships(authored, kind, targets);
    }
    if (!Object.prototype.hasOwnProperty.call(data, "related_to")) appendAuthoredRelationships(authored, "related_to", legacy.related);
  }

  const uid = text(authored.uid);
  if (!uid) diagnostics.push(diagnostic("OKF-IDENTITY-001", "warning", "The note has no canonical UID and remains path-bound.", sourcePath, "uid", "Assign a stable UUIDv7 through an authorized migration."));
  else if (!UUID.test(uid) && !NAMESPACED_ID.test(uid)) diagnostics.push(diagnostic("OKF-IDENTITY-002", "error", "The UID is neither a UUID nor a policy-permitted namespaced globally unique identifier.", sourcePath, "uid"));
  const epistemicState = text(authored.epistemicState);
  if (epistemicState && !EPISTEMIC_STATES.has(epistemicState)) diagnostics.push(diagnostic("OKF-EPISTEMIC-002", "error", `Unknown epistemic state: ${epistemicState}.`, sourcePath, "epistemic.state"));
  if (epistemicState === "accepted" && !hasApproval(origins.approved, authored)) diagnostics.push(diagnostic("OKF-EPISTEMIC-004", "warning", "Accepted state lacks an approval or authorization record; acceptance is not treated as verified authority.", sourcePath, "epistemic.state"));

  const rawSensitivity = text(record(data.sensitivity).level) ?? flatSensitivity ?? legacy?.sensitivity ?? null;
  let effectiveSensitivity: OkfSensitivity = OKF23_POLICY.sensitivityDefault;
  if (!rawSensitivity) diagnostics.push(diagnostic("OKF-SENSITIVITY-001", "warning", "Sensitivity is missing; effective sensitivity defaults to internal.", sourcePath, "sensitivity.level"));
  else if (SENSITIVITY_LEVELS.includes(rawSensitivity as OkfSensitivity)) effectiveSensitivity = rawSensitivity as OkfSensitivity;
  else { effectiveSensitivity = "secret"; diagnostics.push(diagnostic("OKF-SENSITIVITY-005", "error", "Invalid sensitivity fails closed to secret for effective access control.", sourcePath, "sensitivity.level")); }

  const provenance = record(authored.provenance);
  const refs = list(provenance.source_refs).filter((x) => text(x));
  const hash = text(provenance.content_hash);
  if (!refs.length) diagnostics.push(diagnostic("OKF-PROVENANCE-001", "warning", "No source reference is declared.", sourcePath, "provenance.source_refs"));
  if (hash && !SHA256.test(hash)) diagnostics.push(diagnostic("OKF-PROVENANCE-002", "error", "Provenance content_hash must use sha256 followed by 64 hexadecimal characters.", sourcePath, "provenance.content_hash"));

  for (const kind of ["supports", "contradicts"] as const) for (const [index, item] of evidenceEntries({ authored, derived: origins.derived, proposed: origins.proposed, approved: origins.approved } as OkfProjection, kind).entries()) {
    const obj = record(item), strength = number(obj.strength), relevance = number(obj.relevance);
    if (strength == null || strength < 0 || strength > 1) diagnostics.push(diagnostic("OKF-EVIDENCE-002", "error", `${kind}[${index}] strength must be within 0..1.`, sourcePath, `evidence.${kind}[${index}].strength`));
    if (relevance == null || relevance < 0 || relevance > 1) diagnostics.push(diagnostic("OKF-EVIDENCE-003", "error", `${kind}[${index}] relevance must be within 0..1.`, sourcePath, `evidence.${kind}[${index}].relevance`));
  }

  const extensions = Object.fromEntries(Object.entries(data).filter(([key]) => !CORE_FIELDS.has(key) && !LEGACY_FIELDS.has(key)));
  const derivedLabels = origins.derived.labels.filter((x): x is string => typeof x === "string");
  derivedLabels.push(uid ? (UUID.test(uid) || NAMESPACED_ID.test(uid) ? "identity:stable" : "identity:invalid") : "identity:missing");
  derivedLabels.push(refs.length ? (hash && SHA256.test(hash) ? "provenance:traceable" : "provenance:partial") : "provenance:missing");
  derivedLabels.push(`sensitivity:${effectiveSensitivity}`);
  if (epistemicState) derivedLabels.push(`epistemic:${epistemicState}`);
  origins.derived.labels = [...new Set(derivedLabels)].sort();
  origins.derived.sensitivity = effectiveSensitivity;
  origins.derived.effectiveSensitivityReason = rawSensitivity ? "authored-source-classification" : "policy-default";
  const effective: OkfOriginProjection = {
    tags: [...(authored.tags ?? [])],
    labels: [...new Set([...origins.authored.labels, ...origins.derived.labels, ...origins.approved.labels])],
    relationships: {}, epistemicState, sensitivity: effectiveSensitivity,
  };
  for (const origin of [origins.authored, origins.derived, origins.approved]) for (const [kind, items] of Object.entries(origin.relationships)) {
    effective.relationships[kind] = [...(effective.relationships[kind] ?? []), ...items];
  }
  effective.evidence = { supports: [], contradicts: [] };
  for (const origin of [origins.authored, origins.derived, origins.approved]) for (const kind of ["supports", "contradicts"] as const) {
    (effective.evidence as Record<string, unknown[]>)[kind].push(...list(record(origin.evidence)[kind]));
  }
  const projection: OkfProjection = {
    profile: OKF23_PROFILE, conformanceClaim: "reader-and-deterministic-assessor", mode,
    sourceVersion: version, sourcePath, contentHash, rawFrontmatter: data, extensions,
    authored, derived: origins.derived, proposed: origins.proposed, approved: origins.approved, effective,
    diagnostics, assessment: undefined as never,
  };
  projection.assessment = assessOkf23(projection);
  return projection;
}

/** Recalculate derived assessment after corpus-level diagnostics/resolution. */
export function refreshOkf23Assessment(projection: OkfProjection): void {
  projection.diagnostics.sort((a, b) => a.code.localeCompare(b.code) || (a.field ?? "").localeCompare(b.field ?? "") || a.message.localeCompare(b.message));
  projection.assessment = assessOkf23(projection);
  projection.derived.labels = [...new Set([
    ...projection.derived.labels.filter((x): x is string => typeof x === "string" && !x.startsWith("assessment:")),
    ...projection.assessment.labels.derived,
  ])].sort();
  projection.effective.labels = [...new Set([
    ...projection.authored.labels, ...projection.derived.labels, ...projection.approved.labels,
  ])];
  projection.effective.tags = [...(projection.authored.tags ?? [])];
  projection.effective.relationships = {};
  for (const origin of [projection.authored, projection.derived, projection.approved]) {
    for (const [kind, items] of Object.entries(origin.relationships)) {
      projection.effective.relationships[kind] = [...(projection.effective.relationships[kind] ?? []), ...items];
    }
  }
  projection.effective.evidence = { supports: [], contradicts: [] };
  for (const origin of [projection.authored, projection.derived, projection.approved]) for (const kind of ["supports", "contradicts"] as const) {
    (projection.effective.evidence as Record<string, unknown[]>)[kind].push(...list(record(origin.evidence)[kind]));
  }
}

export function okf23RelationTargets(projection: OkfProjection): Array<{ type: string; target: string; origin: OkfOrigin; raw: unknown }> {
  const out: Array<{ type: string; target: string; origin: OkfOrigin; raw: unknown }> = [];
  for (const origin of ["authored", "derived", "proposed", "approved"] as OkfOrigin[]) {
    for (const [type, items] of Object.entries(projection[origin].relationships)) for (const item of items) {
      const target = relationTarget(item); if (target) out.push({ type, target, origin, raw: item });
    }
  }
  return out;
}

export function okf23Inverse(type: string): string | undefined { return INVERSES[type]; }
