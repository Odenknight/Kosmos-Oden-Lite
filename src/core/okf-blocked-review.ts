import type { OkfMigrationEntry } from "./okf-migration";

export type OkfBlockedReviewClass = "mechanical" | "identity-decision" | "relationship-decision" | "privacy-decision" | "mixed" | "unknown";

export interface OkfBlockedModelReview {
  path: string;
  noteHash: string;
  classification: OkfBlockedReviewClass;
  summary: string;
  manualSteps: string[];
  questionsForHuman: string[];
  confidence: number;
  evidenceFindingCodes: string[];
}

const REVIEW_CLASSES = new Set<OkfBlockedReviewClass>(["mechanical", "identity-decision", "relationship-decision", "privacy-decision", "mixed", "unknown"]);
const REDACTED_KEY = /^\s*[^:#]*(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization)[^:]*:/i;
const INLINE_REDACTED_KEY = /[{,]\s*["']?[^,:{}]*(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization)[^,:{}]*["']?\s*:/i;

function redactLikelyCredentials(lines: string[]): string[] {
  const out: string[] = [];
  let redactChildrenOfIndent: number | null = null;
  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (redactChildrenOfIndent != null) {
      if (!line.trim() || indent > redactChildrenOfIndent) continue;
      redactChildrenOfIndent = null;
    }
    if (REDACTED_KEY.test(line) || INLINE_REDACTED_KEY.test(line)) {
      out.push(`${line.slice(0, line.indexOf(":") + 1)} "[REDACTED]"`);
      redactChildrenOfIndent = indent;
    } else out.push(line);
  }
  return out;
}

/** Return only a provably bounded YAML header; never guess where an unterminated header ends. */
export function boundedOkfBlockedFrontmatter(content: string, maxChars: number): { excerpt: string; reason?: string } {
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { excerpt: "", reason: "No bounded frontmatter section was found; only deterministic findings were sent." };
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closing < 0) return { excerpt: "", reason: "Unterminated frontmatter was omitted because its boundary could not be proven." };
  const limit = Math.max(100, Math.min(4_000, maxChars));
  const header = redactLikelyCredentials(lines.slice(0, closing + 2)).join("\n");
  return { excerpt: header.slice(0, limit), ...(header.length > limit ? { reason: `Frontmatter was truncated to ${limit} characters.` } : {}) };
}

function boundedStrings(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, maxChars)).filter(Boolean).slice(0, maxItems);
}

/** Validate advisory JSON and require citations to deterministic blocker codes. */
export function validateOkfBlockedModelReview(value: unknown, entry: OkfMigrationEntry): OkfBlockedModelReview {
  const row: any = value;
  const findingCodes = new Set(entry.review.reasons.map((finding) => finding.code));
  const classification: OkfBlockedReviewClass = REVIEW_CLASSES.has(row?.classification) ? row.classification : "unknown";
  const summary = typeof row?.summary === "string" ? row.summary.trim().slice(0, 700) : "";
  const confidence = Number(row?.confidence);
  if (!summary || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("model review failed the advisory schema");
  const evidenceFindingCodes = boundedStrings(row.evidenceFindingCodes, 20, 100).filter((code) => findingCodes.has(code));
  if (!evidenceFindingCodes.length) throw new Error("model review did not cite a supplied deterministic finding");
  return {
    path: entry.path,
    noteHash: entry.originalHash,
    classification,
    summary,
    manualSteps: boundedStrings(row.manualSteps, 8, 400),
    questionsForHuman: boundedStrings(row.questionsForHuman, 8, 400),
    confidence,
    evidenceFindingCodes,
  };
}
