import { parseFrontmatter } from "./markdown";
import { applyOkfEnrichmentFrontmatter, makeOkfUuidV4, sha256Text, type OkfEnrichmentFrontmatterUpdates } from "./okf-migration";

export type OkfEnrichmentField = "description" | "type" | "tags" | "supersedes" | "related_to";

export interface OkfEvidenceBlock {
  id: number;
  startLine: number;
  endLine: number;
  selectionRule: "qualifying-prose" | "explicit-version-language" | "heading-context" | "fallback-prose";
  text: string;
  fingerprint: string;
}

export interface OkfEnrichmentSuggestion {
  field: OkfEnrichmentField;
  value: string | string[];
  confidence: number;
  reason: string;
  evidenceBlockIds: number[];
  source: "deterministic" | "llm";
}

export interface OkfEvidenceAssessment {
  status: "adequate" | "weak" | "insufficient";
  /** Structural evidence quality only. It is not semantic truth or author competence. */
  qualityScore: number;
  basis: "deterministic-evidence-quality";
  reasons: string[];
}

export interface EvidenceWindowOptions { maxParagraphs?: number; maxChars?: number; }

const normalizeParagraph = (lines: string[]): string => lines.map((line) => line.trim()).join(" ").replace(/\s+/g, " ").trim();
const isBoilerplate = (text: string): boolean => /^(table of contents|contents|navigation|related|references|links|tags)\s*:?$/i.test(text);
const proseScore = (text: string): number => {
  if (text.length < 40) return -10;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const ratio = letters / Math.max(1, text.length);
  if (ratio < 0.45 || isBoilerplate(text)) return -10;
  return Math.min(4, text.length / 160) + (/[.!?]["')\]]?$/.test(text) ? 1 : 0);
};

/**
 * Select reproducible candidate evidence. "Meaningful" is intentionally not
 * claimed: these objective rules can identify prose-shaped evidence, not
 * guarantee that an author placed the important idea near the top.
 */
export async function selectOkfEvidenceWindow(raw: string, options: EvidenceWindowOptions = {}): Promise<OkfEvidenceBlock[]> {
  const maxParagraphs = Math.max(1, Math.min(8, options.maxParagraphs ?? 4));
  const maxChars = Math.max(400, Math.min(12_000, options.maxChars ?? 4_000));
  const { content } = parseFrontmatter(raw);
  const lines = content.split(/\r?\n/);
  const candidates: Array<{ start: number; end: number; text: string; rule: OkfEvidenceBlock["selectionRule"]; score: number }> = [];
  let inFence = false, paragraph: string[] = [], start = 0, heading = "";
  const fallbackParts: string[] = [];
  const flush = (end: number) => {
    if (!paragraph.length) return;
    const text = normalizeParagraph(paragraph); paragraph = [];
    const version = /\b(supersedes|replaces|deprecated by|updated version of|successor to)\b/i.test(text);
    const score = proseScore(text);
    if (score >= 0 || version) candidates.push({ start, end, text: heading ? `${heading} — ${text}` : text, rule: version ? "explicit-version-language" : "qualifying-prose", score: (version ? score + 10 : score) - Math.min(2, start / 1000) });
  };
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```|^~~~/.test(trimmed)) { flush(i); inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{1,6}\s+/.test(trimmed)) { flush(i); heading = trimmed.replace(/^#{1,6}\s+/, "").slice(0, 160); continue; }
    const excluded = !trimmed || /^[-*+]\s+\[[ xX]\]/.test(trimmed) || /^\|.*\|$/.test(trimmed) || /^!\[/.test(trimmed) || /^>\s*\[!/.test(trimmed) || /^(---|___|\*\*\*)$/.test(trimmed);
    if (excluded) { flush(i); continue; }
    fallbackParts.push(trimmed);
    if (!paragraph.length) start = i + 1;
    paragraph.push(trimmed);
  }
  flush(lines.length);
  const selected: typeof candidates = [];
  let used = 0;
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (selected.length >= maxParagraphs || used >= maxChars) break;
    const remaining = maxChars - used;
    const text = candidate.text.slice(0, remaining);
    if (text.length < 40) continue;
    selected.push({ ...candidate, text }); used += text.length;
  }
  selected.sort((a, b) => a.start - b.start);
  if (!selected.length) {
    const fallback = fallbackParts.join(" ").replace(/\s+/g, " ").slice(0, maxChars);
    if (fallback.length >= 20) selected.push({ start: 1, end: lines.length, text: fallback, rule: "fallback-prose", score: 0 });
  }
  const out: OkfEvidenceBlock[] = [];
  for (let i = 0; i < selected.length; i++) out.push({ id: i + 1, startLine: selected[i].start, endLine: selected[i].end, selectionRule: selected[i].rule, text: selected[i].text, fingerprint: `sha256:${await sha256Text(selected[i].text)}` });
  return out;
}

/**
 * Scores only observable structure: amount of prose-shaped material, sentence
 * boundaries, and explicit version language. It cannot determine whether an
 * author expressed the genuinely important idea, so weak evidence is surfaced
 * for review instead of being "repaired" by guessing.
 */
export function assessOkfEvidence(blocks: OkfEvidenceBlock[]): OkfEvidenceAssessment {
  if (!blocks.length) return { status: "insufficient", qualityScore: 0, basis: "deterministic-evidence-quality", reasons: ["No qualifying prose-shaped evidence was found outside excluded structures."] };
  const reasons: string[] = [];
  const chars = blocks.reduce((sum, block) => sum + block.text.length, 0);
  const sentences = blocks.reduce((sum, block) => sum + (block.text.match(/[.!?](?:\s|$)/g) ?? []).length, 0);
  const fallbackOnly = blocks.every((block) => block.selectionRule === "fallback-prose");
  const explicitVersion = blocks.some((block) => block.selectionRule === "explicit-version-language");
  let score = Math.min(0.35, chars / 1200) + Math.min(0.25, blocks.length * 0.1) + Math.min(0.25, sentences * 0.08) + (explicitVersion ? 0.15 : 0);
  if (fallbackOnly) { score = Math.min(score, 0.35); reasons.push("Only fallback text passed; it did not meet the prose-shape gate."); }
  if (blocks.length < 2) reasons.push("Only one evidence block was available; document structure provides little corroboration.");
  if (sentences === 0) reasons.push("No sentence boundary was detected in the selected evidence.");
  if (chars < 160) reasons.push("Selected evidence is short and may omit the document's purpose.");
  if (explicitVersion) reasons.push("Explicit version language was detected, but the named relationship still requires approval.");
  if (!reasons.length) reasons.push("Multiple prose-shaped blocks with sentence boundaries passed the deterministic gate.");
  score = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  return { status: score >= 0.65 ? "adequate" : "weak", qualityScore: score, basis: "deterministic-evidence-quality", reasons };
}

export function deterministicOkfSuggestions(blocks: OkfEvidenceBlock[]): OkfEnrichmentSuggestion[] {
  const all = blocks.map((block) => block.text).join("\n");
  const suggestions: OkfEnrichmentSuggestion[] = [];
  const first = blocks[0];
  if (first && first.text.length >= 40) suggestions.push({ field: "description", value: first.text.slice(0, 280), confidence: 0.62, reason: "First qualifying prose block; review because position is not proof of importance.", evidenceBlockIds: [first.id], source: "deterministic" });
  const tags = [...new Set((all.match(/(^|\s)#[A-Za-z][\w/-]*/g) ?? []).map((tag) => tag.trim().slice(1)))].slice(0, 20);
  if (tags.length) suggestions.push({ field: "tags", value: tags, confidence: 0.9, reason: "Explicit Markdown hashtags in the selected evidence.", evidenceBlockIds: blocks.filter((block) => tags.some((tag) => block.text.includes(`#${tag}`))).map((block) => block.id), source: "deterministic" });
  if (/\b(step\s+\d+|procedure|runbook|prerequisite|instructions?)\b/i.test(all)) suggestions.push({ field: "type", value: "procedural", confidence: 0.76, reason: "Procedure vocabulary appears in bounded evidence.", evidenceBlockIds: blocks.filter((block) => /\b(step\s+\d+|procedure|runbook|prerequisite|instructions?)\b/i.test(block.text)).map((block) => block.id), source: "deterministic" });
  else if (/\b(meeting|journal|daily note|incident|event)\b/i.test(all) && /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(all)) suggestions.push({ field: "type", value: "episodic", confidence: 0.72, reason: "Event vocabulary and an explicit date appear together.", evidenceBlockIds: blocks.map((block) => block.id), source: "deterministic" });
  const relation = /\b(?:supersedes|replaces|updated version of|successor to)\s+(?:the\s+)?\[\[([^\]]+)\]\]/ig;
  let match: RegExpExecArray | null;
  while ((match = relation.exec(all))) suggestions.push({ field: "supersedes", value: `[[${match[1].trim()}]]`, confidence: 0.88, reason: "Explicit version language names a wikilink target; still requires human approval.", evidenceBlockIds: blocks.filter((block) => block.text.includes(match![0])).map((block) => block.id), source: "deterministic" });
  return suggestions.slice(0, 16);
}

export function validateLlmEnrichmentResponse(value: unknown, blocks: OkfEvidenceBlock[], maxSuggestions = 12): OkfEnrichmentSuggestion[] {
  const allowed = new Set<OkfEnrichmentField>(["description", "type", "tags", "supersedes", "related_to"]);
  const rows = Array.isArray((value as any)?.suggestions) ? (value as any).suggestions : [];
  const blockIds = new Set(blocks.map((block) => block.id));
  const out: OkfEnrichmentSuggestion[] = [];
  for (const row of rows.slice(0, Math.max(1, Math.min(24, maxSuggestions)))) {
    if (!row || !allowed.has(row.field) || !(typeof row.value === "string" || Array.isArray(row.value))) continue;
    const ids = Array.isArray(row.evidenceBlockIds) ? row.evidenceBlockIds.filter((id: unknown) => Number.isInteger(id) && blockIds.has(id as number)).slice(0, 8) : [];
    const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 500) : "";
    const confidence = Number(row.confidence);
    if (!ids.length || !reason || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    const normalized = Array.isArray(row.value) ? row.value.filter((item: unknown) => typeof item === "string").map((item: string) => item.trim().slice(0, 180)).filter(Boolean).slice(0, 20) : row.value.trim().slice(0, 500);
    if (Array.isArray(normalized) && !normalized.length) continue;
    if (typeof normalized === "string" && !normalized) continue;
    if (row.field === "type" && (Array.isArray(normalized) || !["episodic", "semantic", "procedural"].includes(normalized))) continue;
    const cited = blocks.filter((block) => ids.includes(block.id)).map((block) => block.text).join("\n");
    const values = Array.isArray(normalized) ? normalized : [normalized];
    if (row.field === "supersedes") {
      const explicitTargets = [...cited.matchAll(/\b(?:supersedes|replaces|updated version of|successor to)\s+(?:the\s+)?\[\[([^\]]+)\]\]/ig)].map((match) => `[[${match[1].trim()}]]`);
      if (!values.every((candidate) => explicitTargets.includes(candidate))) continue;
    }
    if (row.field === "related_to" && !values.every((candidate) => cited.includes(candidate) && /^\[\[[^\]]+\]\]$/.test(candidate))) continue;
    out.push({ field: row.field, value: normalized, confidence, reason, evidenceBlockIds: ids, source: "llm" });
  }
  return out;
}

export interface OkfEnrichmentReviewDecision {
  suggestionIndex: number;
  decision: "accepted" | "rejected";
  edited: boolean;
  originalSuggestion: OkfEnrichmentSuggestion;
  finalSuggestion?: OkfEnrichmentSuggestion;
}

export interface OkfEnrichmentApplySource {
  path: string;
  proposalId: string;
  expectedNoteHash: string;
  content: string;
  decisions: OkfEnrichmentReviewDecision[];
}

export interface OkfEnrichmentApplyEntry {
  path: string;
  proposalId: string;
  status: "ready" | "no-change" | "blocked";
  reasons: string[];
  expectedNoteHash: string;
  originalHash: string;
  proposedHash?: string;
  decisions: OkfEnrichmentReviewDecision[];
  resolvedRelationships: Array<{ field: "supersedes" | "related_to"; value: string; path: string }>;
  /** In-memory only; removed by publicOkfEnrichmentApplyPlan. */
  originalContent: string;
  /** In-memory only; removed by publicOkfEnrichmentApplyPlan. */
  proposedContent?: string;
}

export interface OkfEnrichmentApplyPlan {
  schema: "okf-plus-enrichment-apply-plan/1";
  runId: string;
  createdAt: string;
  planHash: string;
  totals: { notes: number; ready: number; blocked: number; noChange: number; reviewed: number; accepted: number; rejected: number; edited: number };
  entries: OkfEnrichmentApplyEntry[];
}

export interface OkfEnrichmentApplyPlanOptions {
  now?: () => Date;
  uuid?: () => string;
  resolveRelationship?: (sourcePath: string, wikilinkTarget: string) => Promise<string | null>;
}

function applyPlanMaterial(plan: Omit<OkfEnrichmentApplyPlan, "planHash"> | OkfEnrichmentApplyPlan): unknown {
  return {
    schema: plan.schema, runId: plan.runId, createdAt: plan.createdAt, totals: plan.totals,
    entries: plan.entries.map((entry) => ({
      path: entry.path, proposalId: entry.proposalId, status: entry.status, reasons: entry.reasons,
      expectedNoteHash: entry.expectedNoteHash, originalHash: entry.originalHash, proposedHash: entry.proposedHash,
      decisions: entry.decisions, resolvedRelationships: entry.resolvedRelationships,
    })),
  };
}

function reviewedSuggestion(suggestion: OkfEnrichmentSuggestion): OkfEnrichmentSuggestion {
  const field = suggestion.field;
  if (!["description", "type", "tags", "supersedes", "related_to"].includes(field)) throw new Error(`unsupported reviewed field: ${field}`);
  let value: string | string[];
  if (field === "description") {
    if (typeof suggestion.value !== "string" || !suggestion.value.trim() || suggestion.value.trim().length > 500) throw new Error("description must contain 1–500 characters");
    value = suggestion.value.trim();
  } else if (field === "type") {
    if (typeof suggestion.value !== "string" || !["episodic", "semantic", "procedural"].includes(suggestion.value.trim())) throw new Error("type must be episodic, semantic, or procedural");
    value = suggestion.value.trim();
  } else {
    const values = (Array.isArray(suggestion.value) ? suggestion.value : [suggestion.value]).map((item) => String(item).trim()).filter(Boolean);
    if (!values.length || values.length > 20) throw new Error(`${field} requires 1–20 values`);
    if (field === "tags" && values.some((item) => !/^[A-Za-z][\w/-]{0,79}$/.test(item))) throw new Error("tags contain unsupported characters");
    if (field !== "tags" && values.some((item) => !/^\[\[[^\]\r\n]{1,180}\]\]$/.test(item))) throw new Error(`${field} values must be bounded wikilinks`);
    value = [...new Set(values)];
  }
  if (!Number.isFinite(suggestion.confidence) || suggestion.confidence < 0 || suggestion.confidence > 1) throw new Error("suggestion confidence is invalid");
  if (!suggestion.reason.trim()) throw new Error("suggestion reason is required");
  return { ...suggestion, value, reason: suggestion.reason.trim().slice(0, 500), evidenceBlockIds: [...new Set(suggestion.evidenceBlockIds)].slice(0, 8) };
}

/** Build a note-body-free, hash-bound plan from explicit review decisions. */
export async function createOkfEnrichmentApplyPlan(
  sources: OkfEnrichmentApplySource[],
  options: OkfEnrichmentApplyPlanOptions = {},
): Promise<OkfEnrichmentApplyPlan> {
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? makeOkfUuidV4;
  const createdAt = now().toISOString();
  const runId = `okf-enrich-${createdAt.replace(/[-:.]/g, "")}-${uuid().slice(0, 8)}`;
  const entries: OkfEnrichmentApplyEntry[] = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    const originalHash = await sha256Text(source.content);
    const entry: OkfEnrichmentApplyEntry = { path: source.path, proposalId: source.proposalId, status: "no-change", reasons: [], expectedNoteHash: source.expectedNoteHash, originalHash, decisions: source.decisions.map((decision) => ({ ...decision })), resolvedRelationships: [], originalContent: source.content };
    if (originalHash !== source.expectedNoteHash) { entry.status = "blocked"; entry.reasons.push("note content changed after the enrichment proposal was generated"); entries.push(entry); continue; }
    const accepted: OkfEnrichmentSuggestion[] = [];
    try {
      for (const decision of entry.decisions) if (decision.decision === "accepted") {
        if (!decision.finalSuggestion) throw new Error(`accepted suggestion ${decision.suggestionIndex} has no reviewed value`);
        decision.finalSuggestion = reviewedSuggestion(decision.finalSuggestion);
        accepted.push(decision.finalSuggestion);
      }
    } catch (error: any) { entry.status = "blocked"; entry.reasons.push(String(error?.message || error)); entries.push(entry); continue; }
    if (!accepted.length) { entry.reasons.push("reviewer accepted no suggestions for this note"); entries.push(entry); continue; }
    for (const field of ["description", "type"] as const) {
      const values = accepted.filter((suggestion) => suggestion.field === field).map((suggestion) => JSON.stringify(suggestion.value));
      if (new Set(values).size > 1) entry.reasons.push(`multiple conflicting ${field} values were accepted`);
    }
    if (entry.reasons.length) { entry.status = "blocked"; entries.push(entry); continue; }
    const updates: OkfEnrichmentFrontmatterUpdates = {};
    for (const suggestion of accepted) {
      if (suggestion.field === "description") updates.description = suggestion.value as string;
      else if (suggestion.field === "type") updates.type = suggestion.value as OkfEnrichmentFrontmatterUpdates["type"];
      else {
        const values = Array.isArray(suggestion.value) ? suggestion.value : [suggestion.value];
        const existing = (updates as any)[suggestion.field] ?? [];
        (updates as any)[suggestion.field] = [...new Set([...existing, ...values])];
      }
    }
    for (const field of ["supersedes", "related_to"] as const) for (const value of updates[field] ?? []) {
      const target = value.slice(2, -2).trim();
      const resolved = options.resolveRelationship ? await options.resolveRelationship(source.path, target) : null;
      if (!resolved) entry.reasons.push(`${field} target does not resolve: ${value}`);
      else if (resolved.toLowerCase() === source.path.toLowerCase()) entry.reasons.push(`${field} cannot target the same note: ${value}`);
      else entry.resolvedRelationships.push({ field, value, path: resolved });
    }
    if (entry.reasons.length) { entry.status = "blocked"; entries.push(entry); continue; }
    try {
      entry.proposedContent = applyOkfEnrichmentFrontmatter({ path: source.path, content: source.content }, updates);
      entry.proposedHash = await sha256Text(entry.proposedContent);
      entry.status = entry.proposedContent === source.content ? "no-change" : "ready";
      if (entry.status === "no-change") entry.reasons.push("accepted values already match canonical frontmatter");
    } catch (error: any) { entry.status = "blocked"; entry.reasons.push(String(error?.message || error)); delete entry.proposedContent; delete entry.proposedHash; }
    entries.push(entry);
  }
  const decisions = entries.flatMap((entry) => entry.decisions);
  const totals = { notes: entries.length, ready: entries.filter((entry) => entry.status === "ready").length, blocked: entries.filter((entry) => entry.status === "blocked").length, noChange: entries.filter((entry) => entry.status === "no-change").length, reviewed: decisions.length, accepted: decisions.filter((decision) => decision.decision === "accepted").length, rejected: decisions.filter((decision) => decision.decision === "rejected").length, edited: decisions.filter((decision) => decision.edited).length };
  const base = { schema: "okf-plus-enrichment-apply-plan/1" as const, runId, createdAt, totals, entries };
  return { ...base, planHash: await sha256Text(JSON.stringify(applyPlanMaterial(base))) };
}

export async function verifyOkfEnrichmentApplyPlan(plan: OkfEnrichmentApplyPlan): Promise<boolean> {
  if (await sha256Text(JSON.stringify(applyPlanMaterial(plan))) !== plan.planHash) return false;
  for (const entry of plan.entries) {
    if (await sha256Text(entry.originalContent) !== entry.originalHash) return false;
    if (entry.proposedContent != null && await sha256Text(entry.proposedContent) !== entry.proposedHash) return false;
  }
  return true;
}

export function publicOkfEnrichmentApplyPlan(plan: OkfEnrichmentApplyPlan): unknown {
  return { ...plan, entries: plan.entries.map(({ originalContent: _original, proposedContent: _proposed, ...entry }) => entry) };
}
