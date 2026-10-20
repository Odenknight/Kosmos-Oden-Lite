/**
 * Kosmos Core — GKX (Open Knowledge Format Plus) parsing.
 * Evolutionary frontmatter (type / timestamp / supersedes / superseded_by /
 * resource) plus the footer `**Related:**` semantic links.
 *
 * This module only *reads declarations*. Canonical lineage resolution — the
 * bidirectional normalization of supersedes/superseded_by — happens in
 * lineage.ts (§3), never here.
 */
import type { Frontmatter } from "./markdown";
import { normalizeStringList, parseWikiLinks } from "./markdown";
import type { GkxData, GkxRelation, GkxSensitivity } from "./types";

const RELATIONS: GkxRelation[] = [
  "supports", "contradicts", "depends_on", "derived_from", "derives_from",
  "cites", "quotes", "interprets", "tests", "replicates",
  "fails_to_replicate", "extends", "narrows", "generalizes", "implements",
  "governed_by", "reviewed_by", "approved_by", "supersedes",
  "superseded_by", "related_to", "part_of", "has_part", "refines",
  "blocks", "documents",
];

/** Normalize a flat GKX list and unwrap canonical `"[[Target]]"` entries.
 * Legacy plain-title/path values remain readable for compatibility. */
function normalizeGkxRefs(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of normalizeStringList(v)) {
    const links = parseWikiLinks(raw);
    if (links.length) out.push(...links.map((l) => l.target));
    else out.push(raw);
  }
  // Preserve duplicates here so lineage validation can report duplicate
  // declarations instead of silently normalizing away evidence of bad input.
  return out.map((x) => x.trim()).filter(Boolean);
}

const scalar = (v: unknown): string | undefined => typeof v === "string" && v !== "" ? v : undefined;

function sensitivity(v: unknown): GkxSensitivity | undefined {
  if (v === "public" || v === "internal" || v === "restricted" || v === "confidential" || v === "regulated" || v === "phi" || v === "secret") return v;
  // An explicit but invalid label must not silently downgrade access. The
  // read-only projector fails closed at the highest sensitivity; a governed
  // processor can separately route the malformed value to salvage/review.
  return typeof v === "string" && v.trim() ? "secret" : undefined;
}

export function parseGkxPlus(data: Frontmatter, content: string): GkxData | null {
  const related: string[] = [];
  const m = content.match(/^\s*\*\*Related:?\*\*\s*(.+)$/mi);
  if (m) for (const w of parseWikiLinks(m[1])) related.push(w.target);
  const raw = data as Record<string, unknown>;
  const has =
    raw.gkx_version != null || raw.uid != null || data.type != null || data.timestamp != null || data.supersedes != null ||
    (data as Record<string, unknown>).superseded_by != null ||
    (data as Record<string, unknown>).supersededBy != null ||
    raw.forked_from != null || raw.forked_to != null ||
    RELATIONS.some((k) => raw[k] != null) || data.resource != null || related.length > 0;
  if (!has) return null;
  const relations: Partial<Record<GkxRelation, string[]>> = {};
  for (const key of RELATIONS) {
    const refs = normalizeGkxRefs(raw[key]);
    if (refs.length) relations[key] = refs;
  }
  return {
    gkxVersion: scalar(raw.gkx_version),
    uid: scalar(raw.uid),
    type: scalar(data.type),
    title: scalar(data.title),
    description: scalar(raw.description),
    timestamp: scalar(data.timestamp),
    epistemicState: scalar(raw.epistemic_state),
    scope: scalar(raw.scope),
    scopeId: scalar(raw.scope_id),
    sensitivity: sensitivity(raw.sensitivity),
    resource: scalar(data.resource),
    supersedes: normalizeGkxRefs(data.supersedes),
    supersededBy: normalizeGkxRefs(
      (data as Record<string, unknown>).superseded_by ?? (data as Record<string, unknown>).supersededBy
    ),
    forkedFrom: normalizeGkxRefs(raw.forked_from),
    // `forked_by` is read-only compatibility; canonical v2.2 emission is forked_to.
    forkedTo: normalizeGkxRefs(raw.forked_to ?? raw.forked_by),
    relations,
    related: [...new Set([...related, ...(relations.related_to ?? [])])],
  };
}

/** Parse an GKX timestamp; returns ms since epoch or null when invalid/absent. */
export function parseGkxTimestamp(gkx: GkxData | null | undefined): number | null {
  if (!gkx) return null;
  const projected = gkx.projection?.authored?.createdAt;
  const value = typeof projected === "string" ? projected : gkx.timestamp;
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
