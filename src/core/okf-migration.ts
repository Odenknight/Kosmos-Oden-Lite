/**
 * Safety-first, human-editable OKF+ note onboarding and repair.
 *
 * This module is deliberately deterministic and LLM-free. It audits strict,
 * legacy flat frontmatter; keeps OKF+ 2.2 as the Obsidian Properties authoring
 * surface, reads native OKF+ 2.3, repairs beta.10-generated 2.3 notes, and
 * accepts Google's minimal OKF v0.1;
 * and proposes OKF+ only for notes that satisfy the mechanical safety gate.
 * Ambiguous YAML and invalid explicit governance values are never guessed.
 */
import type { OkfSensitivity } from "./types";
import { buildOkf23Projection, parseOkf23Frontmatter } from "./okf23";

export type OkfAuditStatus =
  | "okf-plus-2.2"
  | "okf-plus-2.3"
  | "google-okf-0.1"
  | "google-reserved"
  | "needs-okf-plus"
  | "blocked";

export type OkfMigrationMode = "safe-onboarding" | "upgrade-all" | "convert-to-23";

export interface OkfMigrationSource {
  path: string;
  content: string;
  createdTime?: number;
  modifiedTime?: number;
}

export interface OkfMigrationFinding {
  code: string;
  message: string;
}

export interface OkfMigrationReview {
  required: boolean;
  /** Deterministic confidence that the proposed metadata rewrite is mechanically safe. */
  confidence: number;
  basis: "deterministic-migration-safety";
  reasons: OkfMigrationFinding[];
}

export interface OkfMigrationSalvage {
  field: string;
  originalValue: string | string[];
  reason: string;
}

export interface OkfMigrationDefaults {
  type: "episodic" | "semantic" | "procedural";
  epistemicState: "hypothesis";
  scope: "node";
  sensitivity: OkfSensitivity;
}

export const DEFAULT_OKF_MIGRATION_DEFAULTS: OkfMigrationDefaults = {
  type: "semantic",
  epistemicState: "hypothesis",
  scope: "node",
  sensitivity: "internal",
};

export interface OkfMigrationEntry {
  path: string;
  status: OkfAuditStatus;
  standard: "OKF+ 2.3" | "OKF+ 2.2" | "Google OKF 0.1 draft" | "Google OKF reserved" | "none";
  findings: OkfMigrationFinding[];
  review: OkfMigrationReview;
  /** Original governed values replaced by upgrade-all; persisted in the bound plan. */
  salvage?: OkfMigrationSalvage[];
  originalHash: string;
  proposedHash?: string;
  uid?: string;
  /** In-memory only. publicOkfMigrationPlan() removes note contents. */
  originalContent: string;
  /** In-memory only. The human-authored body is copied byte-for-byte. */
  proposedContent?: string;
}

export interface OkfMigrationPlan {
  schema: "okf-plus-migration-plan/4";
  runId: string;
  createdAt: string;
  planHash: string;
  mode: OkfMigrationMode;
  defaults: OkfMigrationDefaults;
  totals: Record<OkfAuditStatus | "notes" | "changes", number>;
  entries: OkfMigrationEntry[];
}

interface ParsedField {
  key: string;
  kind: "scalar" | "list";
  listStyle?: "inline" | "block";
  scalar?: string;
  values?: string[];
  /** Exact original field lines, used only for unknown flat compatibility keys. */
  rawLines: string[];
  /** Raw list item expressions, retained to validate quoted wikilinks. */
  rawItems?: string[];
}

interface StrictFrontmatter {
  state: "none" | "valid" | "unterminated";
  bom: string;
  eol: "\n" | "\r\n";
  body: string;
  fields: ParsedField[];
  byKey: Map<string, ParsedField>;
  looseLines: string[];
  problems: OkfMigrationFinding[];
}

const CANONICAL_KEYS = [
  "okf_version", "uid", "type", "title", "description", "resource",
  "timestamp", "epistemic_state", "scope", "scope_id", "sensitivity",
  "tags", "supersedes", "superseded_by", "forked_from", "forked_to",
  "depends_on", "derives_from", "contradicts", "refines", "implements",
  "blocks", "documents", "cites", "related_to",
] as const;
const RECOGNIZED = new Set<string>(CANONICAL_KEYS);
const LINEAGE_KEYS = ["supersedes", "superseded_by", "forked_from", "forked_to"] as const;
const RELATION_KEYS = [
  "depends_on", "derives_from", "contradicts", "refines", "implements",
  "blocks", "documents", "cites", "related_to",
] as const;
const TYPES = new Set(["episodic", "semantic", "procedural"]);
const EPISTEMIC = new Set(["fact", "verified_inference", "hypothesis", "deprecated", "refuted"]);
const SCOPES = new Set(["global", "project", "tenant", "node", "agent", "entity"]);
const SENSITIVITIES = new Set(["public", "internal", "restricted", "confidential", "regulated", "phi", "secret"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID_UID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z][a-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{1,255})$/i;

const yamlUnquote = (raw: string): string => {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch (_) { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
};

const yamlQuote = (value: string): string => JSON.stringify(String(value));

/** Split a YAML comment only when # is outside quotes and starts a comment. */
function splitYamlComment(raw: string): { value: string; comment?: string } {
  let quote = "", escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && ch === "\\") { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      return { value: raw.slice(0, i).trimEnd(), comment: raw.slice(i).trim() };
    }
  }
  return { value: raw };
}

/** Small, quote-aware inline-list reader for the flat subset this migrator accepts. */
function inlineList(raw: string): string[] | null {
  const s = raw.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  const out: string[] = [];
  let buf = "", quote = "", escaped = false;
  for (const ch of inner) {
    if (escaped) { buf += ch; escaped = false; continue; }
    if (quote === '"' && ch === "\\") { buf += ch; escaped = true; continue; }
    if (quote) { buf += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === ",") { out.push(yamlUnquote(buf)); buf = ""; continue; }
    buf += ch;
  }
  if (quote) return null;
  out.push(yamlUnquote(buf));
  return out.map((x) => x.trim()).filter(Boolean);
}

function strictFrontmatter(raw: string): StrictFrontmatter {
  const bom = raw.charCodeAt(0) === 0xfeff ? "\uFEFF" : "";
  const text = bom ? raw.slice(1) : raw;
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  if (!(text.startsWith("---\n") || text.startsWith("---\r\n"))) {
    if (text === "---" || text === "---\r") {
      return {
        state: "unterminated", bom, eol, body: text, fields: [], byKey: new Map(), looseLines: [],
        problems: [{ code: "unterminated-frontmatter", message: "Opening frontmatter delimiter has no closing delimiter." }],
      };
    }
    return { state: "none", bom, eol, body: text, fields: [], byKey: new Map(), looseLines: [], problems: [] };
  }
  const openLength = text.startsWith("---\r\n") ? 5 : 4;
  const closing = /^---\r?$/gm;
  closing.lastIndex = openLength;
  const match = closing.exec(text);
  if (!match) {
    return {
      state: "unterminated", bom, eol, body: text, fields: [], byKey: new Map(), looseLines: [],
      problems: [{ code: "unterminated-frontmatter", message: "Opening frontmatter delimiter has no closing delimiter." }],
    };
  }
  const header = text.slice(openLength, match.index).replace(/\r?\n$/, "");
  let bodyAt = match.index + match[0].length;
  if (text.slice(bodyAt, bodyAt + 2) === "\r\n") bodyAt += 2;
  else if (text[bodyAt] === "\n") bodyAt += 1;
  const body = text.slice(bodyAt);
  const lines = header ? header.split(/\r?\n/) : [];
  const chunks: Array<{ key: string; lines: string[] }> = [];
  const looseLines: string[] = [];
  let current: { key: string; lines: string[] } | null = null;
  const problems: OkfMigrationFinding[] = [];
  for (const line of lines) {
    const top = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (top) {
      current = { key: top[1], lines: [line] };
      chunks.push(current);
    } else if (current && (/^\s+/.test(line) || !line.trim() || line.trimStart().startsWith("#"))) {
      current.lines.push(line);
    } else if (!line.trim() || line.trimStart().startsWith("#")) {
      looseLines.push(line);
    } else {
      problems.push({ code: "unsupported-frontmatter-line", message: `Cannot safely parse frontmatter line: ${line.slice(0, 80)}` });
    }
  }
  const fields: ParsedField[] = [];
  const byKey = new Map<string, ParsedField>();
  for (const chunk of chunks) {
    if (byKey.has(chunk.key)) {
      problems.push({ code: "duplicate-key", message: `Duplicate frontmatter key: ${chunk.key}` });
      continue;
    }
    const first = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(chunk.lines[0])!;
    const rest = splitYamlComment(first[2] ?? "").value.trim();
    let field: ParsedField | null = null;
    if (rest) {
      if (rest === "|" || rest === ">" || rest.startsWith("{") || rest.endsWith("}")) {
        problems.push({ code: "nested-or-complex-yaml", message: `Key ${chunk.key} uses YAML outside the safe flat scalar/list grammar.` });
      } else if (rest.startsWith("[")) {
        const values = inlineList(rest);
        if (!values) problems.push({ code: "malformed-inline-list", message: `Key ${chunk.key} has a malformed inline list.` });
        else field = { key: chunk.key, kind: "list", listStyle: "inline", values, rawLines: chunk.lines, rawItems: values.map(yamlQuote) };
      } else if (chunk.lines.slice(1).some((l) => l.trim() && !l.trimStart().startsWith("#"))) {
        problems.push({ code: "nested-or-complex-yaml", message: `Key ${chunk.key} mixes a scalar with nested YAML.` });
      } else {
        field = { key: chunk.key, kind: "scalar", scalar: yamlUnquote(rest), rawLines: chunk.lines };
      }
    } else {
      const values: string[] = [];
      const rawItems: string[] = [];
      let invalid = false;
      for (const line of chunk.lines.slice(1)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const item = /^\s+-\s+(.+)$/.exec(line);
        if (!item) { invalid = true; break; }
        const expr = splitYamlComment(item[1]).value.trim();
        const unquoted = yamlUnquote(expr);
        if (expr.startsWith("{") || expr.endsWith("}") || (!/^['"]/.test(expr) && /^[^:]+:\s+/.test(expr))) { invalid = true; break; }
        values.push(unquoted); rawItems.push(expr);
      }
      if (invalid || !rawItems.length) {
        problems.push({ code: "nested-or-null-yaml", message: `Key ${chunk.key} is nested, null, or not a flat string list.` });
      } else {
        field = { key: chunk.key, kind: "list", listStyle: "block", values, rawLines: chunk.lines, rawItems };
      }
    }
    if (field) {
      // Unknown fields retain their exact raw lines. Comments attached to
      // recognized fields are moved intact to the frontmatter footer so a
      // canonical rewrite never silently deletes human annotations.
      if (RECOGNIZED.has(field.key)) {
        for (const line of chunk.lines) {
          if (line.trimStart().startsWith("#")) looseLines.push(line.trimStart());
          else {
            const comment = splitYamlComment(line).comment;
            if (comment) looseLines.push(comment);
          }
        }
      }
      fields.push(field); byKey.set(field.key, field);
    }
  }
  return { state: "valid", bom, eol, body, fields, byKey, looseLines, problems };
}

const scalar = (fm: StrictFrontmatter, key: string): string | undefined => {
  const f = fm.byKey.get(key);
  return f?.kind === "scalar" ? f.scalar : undefined;
};
const list = (fm: StrictFrontmatter, key: string): string[] | undefined => {
  const f = fm.byKey.get(key);
  return f?.kind === "list" ? [...(f.values ?? [])] : undefined;
};
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
// Accept canonical UTC Zulu (…Z) and ISO-8601 local time with an explicit
// numeric ±HH:MM UTC offset (e.g. 2026-07-19T14:42:07-04:00). Nothing looser:
// a naive wall-clock value with no zone designator is still rejected.
const OKF_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export const isValidOkfTimestamp = (v: string | undefined): boolean => Boolean(v && OKF_TIMESTAMP_RE.test(v) && !Number.isNaN(Date.parse(v)));
const validTimestamp = isValidOkfTimestamp;
const safeWikiTargets = (field: ParsedField | undefined): boolean => {
  if (!field || field.kind !== "list") return false;
  if (!(field.values?.length)) return true;
  return (field.values ?? []).every((item) => /^\[\[[^\]\r\n]{1,180}\]\]$/.test(item));
};
const canonicalWikiList = (field: ParsedField | undefined): boolean => {
  if (!safeWikiTargets(field)) return false;
  if (!(field?.values?.length)) return field?.listStyle === "inline";
  return field.listStyle === "block" && (field.rawItems ?? []).every((item) => /^"\[\[[^\]\r\n]{1,180}\]\]"$/.test(item));
};

function okfValidation(fm: StrictFrontmatter): OkfMigrationFinding[] {
  const f: OkfMigrationFinding[] = [];
  const requireString = (key: string) => { if (!nonempty(scalar(fm, key))) f.push({ code: `missing-${key}`, message: `${key} must be a non-empty string.` }); };
  requireString("okf_version"); requireString("uid"); requireString("type"); requireString("title");
  requireString("description"); requireString("timestamp"); requireString("epistemic_state");
  requireString("scope"); requireString("sensitivity");
  if (scalar(fm, "okf_version") !== "2.2") f.push({ code: "invalid-okf-version", message: `okf_version must be exactly "2.2".` });
  if (!UUID_V4.test(scalar(fm, "uid") ?? "")) f.push({ code: "invalid-uid", message: "uid must be a lowercase UUIDv4." });
  if (!TYPES.has(scalar(fm, "type") ?? "")) f.push({ code: "invalid-type", message: "type must be episodic, semantic, or procedural." });
  if (!validTimestamp(scalar(fm, "timestamp"))) f.push({ code: "invalid-timestamp", message: "timestamp must be an ISO-8601 value in UTC (…Z) or with a numeric ±HH:MM offset." });
  if (!EPISTEMIC.has(scalar(fm, "epistemic_state") ?? "")) f.push({ code: "invalid-epistemic-state", message: "epistemic_state is missing or invalid." });
  const scope = scalar(fm, "scope") ?? "";
  if (!SCOPES.has(scope)) f.push({ code: "invalid-scope", message: "scope is missing or invalid." });
  if (scope && scope !== "global" && !nonempty(scalar(fm, "scope_id"))) f.push({ code: "missing-scope-id", message: "scope_id is required for a named non-global scope." });
  if (!SENSITIVITIES.has(scalar(fm, "sensitivity") ?? "")) f.push({ code: "invalid-sensitivity", message: "sensitivity is missing or invalid." });
  if (!fm.byKey.has("tags") || fm.byKey.get("tags")?.kind !== "list") f.push({ code: "invalid-tags", message: "tags must be a flat list, including [] when empty." });
  for (const key of LINEAGE_KEYS) if (!canonicalWikiList(fm.byKey.get(key))) f.push({ code: `invalid-${key}`, message: `${key} must be [] or a block list of double-quoted wikilinks.` });
  for (const key of RELATION_KEYS) if (fm.byKey.has(key) && !canonicalWikiList(fm.byKey.get(key))) f.push({ code: `invalid-${key}`, message: `${key} must be a block list of double-quoted wikilinks.` });
  const ranks = new Map(CANONICAL_KEYS.map((k, i) => [k, i]));
  let last = -1, sawUnknown = false;
  for (const field of fm.fields) {
    const rank = ranks.get(field.key as any);
    if (rank == null) { sawUnknown = true; continue; }
    if (sawUnknown || rank < last) { f.push({ code: "noncanonical-key-order", message: "Recognized OKF+ fields are not in canonical order." }); break; }
    last = rank;
  }
  return f;
}

function invalidExplicitGovernance(fm: StrictFrontmatter): OkfMigrationFinding[] {
  const out: OkfMigrationFinding[] = [];
  const checkEnum = (key: string, allowed: Set<string>) => {
    if (!fm.byKey.has(key)) return;
    const v = scalar(fm, key);
    if (!v || !allowed.has(v)) out.push({ code: `invalid-explicit-${key}`, message: `Existing ${key} is invalid and requires human review; it will not be overwritten.` });
  };
  if (fm.byKey.has("okf_version") && scalar(fm, "okf_version") !== "2.2") out.push({ code: "different-okf-version", message: "A different explicit okf_version requires compatibility review." });
  if (fm.byKey.has("uid") && !UUID_V4.test(scalar(fm, "uid") ?? "")) out.push({ code: "invalid-explicit-uid", message: "Existing uid is not a lowercase UUIDv4 and will not be replaced automatically." });
  checkEnum("type", TYPES); checkEnum("epistemic_state", EPISTEMIC); checkEnum("scope", SCOPES); checkEnum("sensitivity", SENSITIVITIES);
  if (fm.byKey.has("timestamp") && !validTimestamp(scalar(fm, "timestamp"))) out.push({ code: "invalid-explicit-timestamp", message: "Existing timestamp is invalid and will not be replaced automatically." });
  for (const key of [...LINEAGE_KEYS, ...RELATION_KEYS]) {
    if (fm.byKey.has(key) && !safeWikiTargets(fm.byKey.get(key))) out.push({ code: `unsafe-explicit-${key}`, message: `Existing ${key} contains values that cannot be safely normalized as wikilinks.` });
  }
  return out;
}

function migrationReview(entry: Pick<OkfMigrationEntry, "status" | "findings">): OkfMigrationReview {
  const codes = new Set(entry.findings.map((finding) => finding.code));
  let confidence = 1;
  if (entry.status === "needs-okf-plus") {
    confidence = [...codes].some((code) => code.startsWith("override-")) ? 0.78
      : [...codes].some((code) => code.startsWith("upgrade-")) ? 0.9
        : codes.has("missing-frontmatter") ? 0.97
          : 0.95;
  } else if (entry.status === "blocked") {
    confidence = codes.has("duplicate-uid") ? 0.05
      : [...codes].some((code) => code.includes("duplicate-key") || code.includes("nested") || code.includes("unterminated")) ? 0.1
        : [...codes].some((code) => code.startsWith("unsafe-")) ? 0.15
          : 0.25;
  }
  return {
    required: entry.status === "blocked",
    confidence,
    basis: "deterministic-migration-safety",
    reasons: entry.findings.map((finding) => ({ ...finding })),
  };
}

function assessed(entry: Omit<OkfMigrationEntry, "review">): OkfMigrationEntry {
  return { ...entry, review: migrationReview(entry) };
}

function originalFieldValue(fm: StrictFrontmatter, key: string): string | string[] | undefined {
  const field = fm.byKey.get(key);
  if (!field) return undefined;
  return field.kind === "list" ? [...(field.values ?? [])] : field.scalar;
}

function upgradeOverrides(fm: StrictFrontmatter): {
  findings: OkfMigrationFinding[];
  salvage: OkfMigrationSalvage[];
  blockers: OkfMigrationFinding[];
} {
  const findings: OkfMigrationFinding[] = [];
  const salvage: OkfMigrationSalvage[] = [];
  const blockers: OkfMigrationFinding[] = [];
  const replace = (field: string, code: string, reason: string) => {
    const originalValue = originalFieldValue(fm, field);
    if (originalValue == null) return;
    findings.push({ code, message: reason });
    salvage.push({ field, originalValue, reason });
  };
  if (fm.byKey.has("okf_version") && scalar(fm, "okf_version") !== "2.2") {
    replace("okf_version", "override-okf-version", "Existing okf_version will be normalized to the human-editable 2.2 authoring format; the original value is retained in migration salvage.");
  }
  if (fm.byKey.has("uid") && !UUID_V4.test(scalar(fm, "uid") ?? "")) {
    replace("uid", "override-invalid-uid", "Invalid legacy uid will be replaced with a new lowercase UUIDv4; the original value is retained in migration salvage.");
  }
  if (fm.byKey.has("id")) {
    replace("id", "override-legacy-id", UUID_V4.test(scalar(fm, "id") ?? "")
      ? "Legacy id will be migrated to uid and removed from frontmatter; the original value is retained in migration salvage."
      : "Invalid legacy id will be removed and replaced by a new uid; the original value is retained in migration salvage.");
  }
  const enums: Array<[string, Set<string>]> = [
    ["type", TYPES], ["epistemic_state", EPISTEMIC], ["scope", SCOPES], ["sensitivity", SENSITIVITIES],
  ];
  for (const [key, allowed] of enums) {
    if (fm.byKey.has(key) && !allowed.has(scalar(fm, key) ?? "")) {
      replace(key, `override-invalid-${key}`, `Invalid legacy ${key} will be replaced with the conservative migration default; the original value is retained in migration salvage.`);
    }
  }
  if (fm.byKey.has("timestamp") && !validTimestamp(scalar(fm, "timestamp"))) {
    replace("timestamp", "override-invalid-timestamp", "Invalid legacy timestamp will be replaced with the file creation/modified time; the original value is retained in migration salvage.");
  }
  for (const key of [...LINEAGE_KEYS, ...RELATION_KEYS]) {
    if (fm.byKey.has(key) && !safeWikiTargets(fm.byKey.get(key))) {
      blockers.push({ code: `unsafe-explicit-${key}`, message: `Existing ${key} cannot be normalized without guessing and remains blocked for manual review.` });
    }
  }
  return { findings, salvage, blockers };
}

function fileTitle(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "").trim() || "Untitled note";
}

function emitList(key: string, values: string[], eol: string, wikilinks = false): string[] {
  if (!values.length) return [`${key}: []`];
  const unique = [...new Set(values.map((x) => x.trim()).filter(Boolean))];
  return [`${key}:`, ...unique.map((v) => `  - ${yamlQuote(wikilinks && !/^\[\[.*\]\]$/.test(v) ? `[[${v}]]` : v)}`)];
}

function yaml23Scalar(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

/** Serialize the bounded data model accepted by parseOkf23Frontmatter. */
function emitYaml23Value(lines: string[], key: string | null, value: unknown, indent: number): void {
  const pad = " ".repeat(indent);
  const prefix = key == null ? `${pad}-` : `${pad}${key}:`;
  if (Array.isArray(value)) {
    if (!value.length) { lines.push(`${prefix} []`); return; }
    lines.push(prefix);
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        lines.push(`${" ".repeat(indent + 2)}-`);
        for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) emitYaml23Value(lines, childKey, child, indent + 4);
      } else if (Array.isArray(item)) {
        emitYaml23Value(lines, null, item, indent + 2);
      } else lines.push(`${" ".repeat(indent + 2)}- ${yaml23Scalar(item)}`);
    }
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) { lines.push(`${prefix} {}`); return; }
    lines.push(prefix);
    for (const [childKey, child] of entries) emitYaml23Value(lines, childKey, child, indent + 2);
    return;
  }
  lines.push(`${prefix} ${yaml23Scalar(value)}`);
}

function serializeOkf23(data: Record<string, unknown>, fm: StrictFrontmatter): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) emitYaml23Value(lines, key, value, 0);
  const comments = new Set<string>();
  for (const line of [...fm.fields.flatMap((field) => field.rawLines), ...fm.looseLines]) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) comments.add(trimmed);
    else {
      const comment = splitYamlComment(line).comment;
      if (comment) comments.add(comment);
    }
  }
  if (comments.size) lines.push(...comments);
  lines.push("---");
  return fm.bom + lines.join(fm.eol) + fm.eol + fm.body;
}

const NATIVE23_STRUCTURAL_FIELDS = new Set([
  "okf_version", "uid", "title", "type", "created_at", "updated_at", "description", "resource", "tags",
  "authorship", "epistemic", "sensitivity", "provenance", "relationships", "evidence", "lineage",
  "review", "assessment", "authorization", "labels", "x-okf22-compatibility",
  "epistemic_state", "authorship_origin", "scope", "scope_id",
  ...LINEAGE_KEYS, ...RELATION_KEYS,
]);

const nativeRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nativeText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const nativeList = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];

function bareWikiTarget(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : nativeText(nativeRecord(value).target) ?? nativeText(nativeRecord(value).target_uid);
  if (!raw) return undefined;
  const match = /^\[\[([^\]\r\n]+)\]\]$/.exec(raw.trim());
  const inner = (match?.[1] ?? raw).split("|")[0].split("#")[0].trim();
  return inner || undefined;
}

function editableWikiTargets(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) for (const item of nativeList(value)) {
    const target = bareWikiTarget(item);
    if (target) out.push(`[[${target}]]`);
  }
  return [...new Set(out)];
}

function editableEpistemicState(value: unknown): string {
  const state = nativeText(value);
  if (state && EPISTEMIC.has(state)) return state;
  if (state === "inferred" || state === "modeled" || state === "supported") return "verified_inference";
  if (state === "refuted") return "refuted";
  if (state === "retracted" || state === "superseded") return "deprecated";
  if (state === "unknown" || state === "observation" || state === "reported" || state === "accepted") return "fact";
  return "hypothesis";
}

function deterministicMigration23(data: Record<string, unknown>): boolean {
  const authorship = nativeRecord(data.authorship);
  const extraction = nativeRecord(nativeRecord(data.provenance).extraction);
  return nativeText(authorship.author_id) === "migration:human-review-required"
    && nativeText(extraction.method) === "deterministic-migration";
}

function repairableGenerated23Issues(issues: Array<{ line: number; message: string }>): boolean {
  return issues.every((issue) => /^Duplicate key (?:created_at|updated_at)\.$/.test(issue.message));
}

/**
 * Flatten metadata produced by the faulty beta.10 writer back to the compact,
 * human-editable OKF+ 2.2 Properties surface. This is intentionally limited to
 * notes carrying the deterministic-migration marker; native authored 2.3 notes
 * are never flattened automatically.
 */
function proposedEditableOkf22(
  data: Record<string, unknown>,
  source: OkfMigrationSource,
  generatedUid: string,
  createdAt: string,
  defaults: OkfMigrationDefaults,
): string {
  const fm = strictFrontmatter(source.content);
  if (fm.state !== "valid") throw new Error("generated OKF+ 2.3 frontmatter is not safely bounded");
  const eol = fm.eol;
  const uidValue = nativeText(data.uid);
  const uid = uidValue && VALID_UID.test(uidValue) ? uidValue : generatedUid;
  const title = nativeText(data.title) ?? fileTitle(source.path);
  const type = nativeText(data.type);
  const created = nativeText(data.created_at)
    ?? (Number.isFinite(source.createdTime) && (source.createdTime ?? 0) > 0 ? new Date(source.createdTime!).toISOString() : createdAt);
  const epistemic = editableEpistemicState(nativeRecord(data.epistemic).state ?? data.epistemic_state);
  const sensitivityValue = nativeText(nativeRecord(data.sensitivity).level) ?? nativeText(data.sensitivity);
  const compatibility = nativeRecord(data["x-okf22-compatibility"]);
  const scopeValue = nativeText(compatibility.scope) ?? nativeText(data.scope);
  const tags = nativeList(data.tags).map(nativeText).filter((value): value is string => Boolean(value));
  const lines = [
    "---",
    `okf_version: "2.2"`,
    `uid: ${yamlQuote(uid)}`,
    `type: ${yamlQuote(type && TYPES.has(type) ? type : defaults.type)}`,
    `title: ${yamlQuote(title)}`,
    `description: ${yamlQuote(nativeText(data.description) ?? `Knowledge note for ${title}.`)}`,
  ];
  const resource = nativeText(data.resource);
  if (resource) lines.push(`resource: ${yamlQuote(resource)}`);
  lines.push(
    `timestamp: ${yamlQuote(validTimestamp(created) ? created : createdAt)}`,
    `epistemic_state: ${yamlQuote(epistemic)}`,
    `scope: ${yamlQuote(scopeValue && SCOPES.has(scopeValue) ? scopeValue : defaults.scope)}`,
    `scope_id: ${yamlQuote(nativeText(compatibility.scope_id) ?? nativeText(data.scope_id) ?? uid)}`,
    `sensitivity: ${yamlQuote(sensitivityValue && SENSITIVITIES.has(sensitivityValue) ? sensitivityValue : defaults.sensitivity)}`,
    ...emitList("tags", tags, eol),
  );

  const lineage = nativeRecord(data.lineage);
  const relationships = nativeRecord(data.relationships);
  for (const key of LINEAGE_KEYS) {
    const values = editableWikiTargets(lineage[key], data[key]);
    lines.push(...emitList(key, values, eol, true));
  }
  for (const key of RELATION_KEYS) {
    const values = editableWikiTargets(relationships[key], data[key]);
    if (values.length) lines.push(...emitList(key, values, eol, true));
  }

  for (const [key, value] of Object.entries(data)) {
    if (NATIVE23_STRUCTURAL_FIELDS.has(key)) continue;
    emitYaml23Value(lines, key, value, 0);
  }
  const comments = new Set<string>();
  for (const field of fm.fields) for (const line of field.rawLines) {
    if (line.trimStart().startsWith("#")) comments.add(line.trim());
    else { const comment = splitYamlComment(line).comment; if (comment) comments.add(comment); }
  }
  for (const line of fm.looseLines) if (line.trimStart().startsWith("#")) comments.add(line.trim());
  if (comments.size) lines.push(...comments);
  lines.push("---");
  return fm.bom + lines.join(eol) + eol + fm.body;
}

function proposedOkf(
  fm: StrictFrontmatter,
  source: OkfMigrationSource,
  uid: string,
  createdAt: string,
  defaults: OkfMigrationDefaults,
  salvage: OkfMigrationSalvage[] = [],
): string {
  const eol = fm.eol;
  const title = scalar(fm, "title") || fileTitle(source.path);
  const description = scalar(fm, "description") || `Knowledge note for ${title}.`;
  const created = Number.isFinite(source.createdTime) && (source.createdTime ?? 0) > 0
    ? new Date(source.createdTime!).toISOString()
    : Number.isFinite(source.modifiedTime) && (source.modifiedTime ?? 0) > 0
      ? new Date(source.modifiedTime!).toISOString()
      : createdAt;
  const existingUid = scalar(fm, "uid");
  const actualUid = existingUid && UUID_V4.test(existingUid) ? existingUid : uid;
  const existingType = scalar(fm, "type");
  const existingEpistemic = scalar(fm, "epistemic_state");
  const existingScope = scalar(fm, "scope");
  const existingSensitivity = scalar(fm, "sensitivity");
  const existingTimestamp = scalar(fm, "timestamp");
  const lines: string[] = [
    "---",
    `okf_version: "2.2"`,
    `uid: ${yamlQuote(actualUid)}`,
    `type: ${yamlQuote(existingType && TYPES.has(existingType) ? existingType : defaults.type)}`,
    `title: ${yamlQuote(title)}`,
    `description: ${yamlQuote(description)}`,
  ];
  const resource = scalar(fm, "resource");
  if (resource) lines.push(`resource: ${yamlQuote(resource)}`);
  lines.push(
    `timestamp: ${yamlQuote(validTimestamp(existingTimestamp) ? existingTimestamp! : created)}`,
    `epistemic_state: ${yamlQuote(existingEpistemic && EPISTEMIC.has(existingEpistemic) ? existingEpistemic : defaults.epistemicState)}`,
    `scope: ${yamlQuote(existingScope && SCOPES.has(existingScope) ? existingScope : defaults.scope)}`,
    `scope_id: ${yamlQuote((existingScope && SCOPES.has(existingScope) ? scalar(fm, "scope_id") : undefined) || actualUid)}`,
    `sensitivity: ${yamlQuote(existingSensitivity && SENSITIVITIES.has(existingSensitivity) ? existingSensitivity : defaults.sensitivity)}`,
  );
  lines.push(...emitList("tags", list(fm, "tags") ?? (scalar(fm, "tags") ? [scalar(fm, "tags")!] : []), eol));
  for (const key of LINEAGE_KEYS) lines.push(...emitList(key, list(fm, key) ?? [], eol, true));
  for (const key of RELATION_KEYS) if (fm.byKey.has(key)) lines.push(...emitList(key, list(fm, key) ?? [], eol, true));
  for (const field of fm.fields) {
    if (!RECOGNIZED.has(field.key) && !salvage.some((record) => record.field === field.key)) lines.push(...field.rawLines);
  }
  if (fm.looseLines.some((x) => x.trim())) lines.push(...fm.looseLines);
  lines.push("---");
  return fm.bom + lines.join(eol) + eol + fm.body;
}

/**
 * Convert to the flat, human-editable OKF+ 2.3 profile. The frontmatter stays
 * an Obsidian-Properties-safe surface exactly like 2.2 — scalars plus flat
 * quoted-wikilink lists — while declaring okf_version 2.3 so the validating
 * projection applies 2.3 semantics with in-memory governance defaults.
 */
function proposedNativeOkf23(
  fm: StrictFrontmatter,
  source: OkfMigrationSource,
  uid: string,
  createdAt: string,
  defaults: OkfMigrationDefaults,
  salvage: OkfMigrationSalvage[] = [],
): string {
  const eol = fm.eol;
  const title = scalar(fm, "title") || fileTitle(source.path);
  const description = scalar(fm, "description") || `Knowledge note for ${title}.`;
  const created = Number.isFinite(source.createdTime) && (source.createdTime ?? 0) > 0
    ? new Date(source.createdTime!).toISOString()
    : Number.isFinite(source.modifiedTime) && (source.modifiedTime ?? 0) > 0
      ? new Date(source.modifiedTime!).toISOString()
      : createdAt;
  const existingUid = scalar(fm, "uid");
  const actualUid = existingUid && UUID_V4.test(existingUid) ? existingUid : uid;
  const existingType = scalar(fm, "type");
  const existingEpistemic = scalar(fm, "epistemic_state");
  const existingScope = scalar(fm, "scope");
  const existingSensitivity = scalar(fm, "sensitivity");
  const existingTimestamp = scalar(fm, "timestamp");
  const tags = list(fm, "tags") ?? (scalar(fm, "tags") ? [scalar(fm, "tags")!] : []);
  const relationships = new Map<string, string[]>();
  for (const key of RELATION_KEYS) {
    const values = list(fm, key) ?? [];
    if (values.length) relationships.set(key, values);
  }
  const lineage = new Map<string, string[]>();
  for (const key of LINEAGE_KEYS) {
    const values = list(fm, key) ?? [];
    if (values.length) lineage.set(key, values);
  }

  // Flat editable OKF+ 2.3 profile: every emitted key is a scalar or a flat
  // string list, so Obsidian Properties can render and edit all of them.
  // Governance blocks (authorship, provenance, review, assessment, labels…)
  // are intentionally NOT written into the note; the validating projection
  // supplies spec-permitted in-memory defaults, and future governed values
  // belong in .okf/ sidecars — never in nested note YAML that the Properties
  // UI would corrupt on edit.
  const lines: string[] = [
    "---",
    `okf_version: "2.3"`,
    `uid: ${yamlQuote(actualUid)}`,
    `title: ${yamlQuote(title)}`,
    `type: ${yamlQuote(existingType && TYPES.has(existingType) ? existingType : defaults.type)}`,
    `created_at: ${yamlQuote(validTimestamp(existingTimestamp) ? existingTimestamp! : created)}`,
    `updated_at: ${yamlQuote(Number.isFinite(source.modifiedTime) && (source.modifiedTime ?? 0) > 0 ? new Date(source.modifiedTime!).toISOString() : (validTimestamp(existingTimestamp) ? existingTimestamp! : created))}`,
    `description: ${yamlQuote(description)}`,
  ];
  const resource = scalar(fm, "resource");
  if (resource) lines.push(`resource: ${yamlQuote(resource)}`);
  lines.push(
    `epistemic_state: ${yamlQuote(existingEpistemic && EPISTEMIC.has(existingEpistemic) ? existingEpistemic : defaults.epistemicState)}`,
    `sensitivity: ${yamlQuote(existingSensitivity && SENSITIVITIES.has(existingSensitivity) ? existingSensitivity : defaults.sensitivity)}`,
    `authorship_origin: "authored"`,
  );
  if (existingScope || scalar(fm, "scope_id")) lines.push(
    `scope: ${yamlQuote(existingScope && SCOPES.has(existingScope) ? existingScope : defaults.scope)}`,
    `scope_id: ${yamlQuote(scalar(fm, "scope_id") || actualUid)}`,
  );
  lines.push(...emitList("tags", tags, eol));
  for (const key of LINEAGE_KEYS) lines.push(...emitList(key, lineage.get(key) ?? [], eol, true));
  for (const key of RELATION_KEYS) if (relationships.has(key)) lines.push(...emitList(key, relationships.get(key) ?? [], eol, true));
  for (const field of fm.fields) {
    if (!RECOGNIZED.has(field.key) && !salvage.some((record) => record.field === field.key)) lines.push(...field.rawLines);
  }
  if (fm.looseLines.some((x) => x.trim())) lines.push(...fm.looseLines);
  lines.push("---");
  return fm.bom + lines.join(eol) + eol + fm.body;
}

export interface OkfEnrichmentFrontmatterUpdates {
  description?: string;
  type?: "episodic" | "semantic" | "procedural";
  tags?: string[];
  supersedes?: string[];
  related_to?: string[];
}

/**
 * Apply an explicitly reviewed enrichment set through the same strict parser
 * and canonical writer as migration. Scalars replace only when supplied;
 * collections merge and deduplicate. The Markdown body is preserved exactly.
 */
export function applyOkfEnrichmentFrontmatter(
  source: OkfMigrationSource,
  updates: OkfEnrichmentFrontmatterUpdates,
): string {
  const native = parseOkf23Frontmatter(source.content);
  if (native.data.okf_version === "2.3" && !native.issues.length) {
    const fm23 = strictFrontmatter(source.content);
    if (fm23.state !== "valid") throw new Error("native OKF+ 2.3 frontmatter is not safely bounded");
    const data = JSON.parse(JSON.stringify(native.data)) as Record<string, unknown>;
    if (updates.description != null) {
      const value = updates.description.trim();
      if (!value || value.length > 500) throw new Error("description must contain 1–500 characters");
      data.description = value;
    }
    if (updates.type != null) {
      if (!TYPES.has(updates.type)) throw new Error("type must be episodic, semantic, or procedural");
      data.type = updates.type;
    }
    if (updates.tags?.length) {
      if (updates.tags.some((value) => !/^[A-Za-z][\w/-]{0,79}$/.test(value))) throw new Error("tags must use safe Markdown tag characters");
      const existing = Array.isArray(data.tags) ? data.tags.filter((value): value is string => typeof value === "string") : [];
      data.tags = [...new Set([...existing, ...updates.tags].map((value) => value.trim()).filter(Boolean))];
    }
    const relationships = data.relationships && typeof data.relationships === "object" && !Array.isArray(data.relationships)
      ? data.relationships as Record<string, unknown> : {};
    for (const key of ["supersedes", "related_to"] as const) if (updates[key]?.length) {
      if (updates[key]!.some((value) => !/^\[\[[^\]\r\n]{1,180}\]\]$/.test(value))) throw new Error(`${key} values must be bounded wikilinks`);
      const existing = editableWikiTargets(data[key], relationships[key]);
      data[key] = [...new Set([...existing, ...updates[key]!])];
    }
    const proposed = serializeOkf23(data, fm23);
    const checked = parseOkf23Frontmatter(proposed);
    if (checked.issues.length) throw new Error(`proposed enrichment is not valid OKF+ 2.3: ${checked.issues.map((issue) => issue.message).join(", ")}`);
    if (strictFrontmatter(proposed).body !== fm23.body) throw new Error("proposed enrichment changed Markdown body bytes");
    return proposed;
  }
  const fm = strictFrontmatter(source.content);
  if (fm.state !== "valid" || fm.problems.length) throw new Error("note frontmatter is not safely parseable by the flat OKF+ grammar");
  const validation = okfValidation(fm);
  if (validation.length) throw new Error(`note is not valid human-editable OKF+ 2.2 input: ${validation.map((finding) => finding.code).join(", ")}`);

  const setScalar = (key: "description" | "type", value: string) => {
    const field = fm.byKey.get(key);
    if (!field || field.kind !== "scalar") throw new Error(`${key} is not a safe scalar field`);
    field.scalar = value;
  };
  const mergeList = (key: "tags" | "supersedes" | "related_to", values: string[]) => {
    const existing = list(fm, key) ?? [];
    const merged = [...new Set([...existing, ...values].map((value) => value.trim()).filter(Boolean))];
    let field = fm.byKey.get(key);
    if (!field) {
      field = { key, kind: "list", listStyle: "block", values: merged, rawLines: [], rawItems: merged.map(yamlQuote) };
      fm.fields.push(field); fm.byKey.set(key, field);
    } else if (field.kind !== "list") throw new Error(`${key} is not a safe list field`);
    else { field.values = merged; field.rawItems = merged.map(yamlQuote); field.listStyle = merged.length ? "block" : "inline"; }
  };

  if (updates.description != null) {
    const value = updates.description.trim();
    if (!value || value.length > 500) throw new Error("description must contain 1–500 characters");
    setScalar("description", value);
  }
  if (updates.type != null) {
    if (!TYPES.has(updates.type)) throw new Error("type must be episodic, semantic, or procedural");
    setScalar("type", updates.type);
  }
  if (updates.tags?.length) {
    if (updates.tags.some((value) => !/^[A-Za-z][\w/-]{0,79}$/.test(value))) throw new Error("tags must use safe Markdown tag characters");
    mergeList("tags", updates.tags);
  }
  for (const key of ["supersedes", "related_to"] as const) if (updates[key]?.length) {
    if (updates[key]!.some((value) => !/^\[\[[^\]\r\n]{1,180}\]\]$/.test(value))) throw new Error(`${key} values must be bounded wikilinks`);
    mergeList(key, updates[key]!);
  }

  const proposed = proposedOkf(fm, source, scalar(fm, "uid")!, new Date().toISOString(), DEFAULT_OKF_MIGRATION_DEFAULTS);
  const checked = strictFrontmatter(proposed);
  const after = checked.state === "valid" && !checked.problems.length ? okfValidation(checked) : checked.problems;
  if (after.length) throw new Error(`proposed enrichment is not canonical OKF+ 2.2: ${after.map((finding) => finding.code).join(", ")}`);
  if (checked.body !== fm.body) throw new Error("proposed enrichment changed Markdown body bytes");
  return proposed;
}

function migrationUid(fm: StrictFrontmatter, generate: () => string, allowLegacyId = false): string {
  const existingUid = scalar(fm, "uid");
  if (existingUid && UUID_V4.test(existingUid)) return existingUid;
  const legacyId = allowLegacyId ? scalar(fm, "id") : undefined;
  if (legacyId && UUID_V4.test(legacyId)) return legacyId;
  return generate();
}

export function makeOkfUuidV4(): string {
  const c: any = (globalThis as any).crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("OKF+ migration requires crypto.getRandomValues; refusing insecure UID generation.");
  const b = new Uint8Array(16); c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function sha256Text(text: string): Promise<string> {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle) throw new Error("OKF+ migration requires WebCrypto SHA-256 for plan binding.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function planMaterial(plan: Omit<OkfMigrationPlan, "planHash"> | OkfMigrationPlan): unknown {
  return {
    schema: plan.schema, runId: plan.runId, createdAt: plan.createdAt,
    mode: plan.mode, defaults: plan.defaults, totals: plan.totals,
    entries: plan.entries.map((e) => ({
      path: e.path, status: e.status, originalHash: e.originalHash,
      proposedHash: e.proposedHash, uid: e.uid, findings: e.findings,
      review: e.review, salvage: e.salvage,
    })),
  };
}

/** Recompute the approval hash and the in-memory content hashes before write. */
export async function verifyOkfMigrationPlan(plan: OkfMigrationPlan): Promise<boolean> {
  if (await sha256Text(JSON.stringify(planMaterial(plan))) !== plan.planHash) return false;
  for (const entry of plan.entries) {
    if (await sha256Text(entry.originalContent) !== entry.originalHash) return false;
    if (entry.proposedContent != null && await sha256Text(entry.proposedContent) !== entry.proposedHash) return false;
  }
  return true;
}

interface AuditOptions {
  createdAt: string;
  defaults: OkfMigrationDefaults;
  uuid: () => string;
  mode: OkfMigrationMode;
}

async function auditOne(source: OkfMigrationSource, opts: AuditOptions): Promise<OkfMigrationEntry> {
  const originalHash = await sha256Text(source.content);
  const native = parseOkf23Frontmatter(source.content);
  if (native.data.okf_version === "2.3") {
    if (deterministicMigration23(native.data) && repairableGenerated23Issues(native.issues)) {
      const uid = nativeText(native.data.uid) ?? opts.uuid();
      const proposedContent = proposedEditableOkf22(native.data, source, uid, opts.createdAt, opts.defaults);
      return assessed({
        path: source.path,
        status: "needs-okf-plus",
        standard: "OKF+ 2.3",
        findings: [{
          code: "repair-generated-okf-2.3",
          message: "Metadata written by the beta.10 deterministic 2.3 migrator will be flattened to the human-editable OKF+ 2.2 Properties format; duplicate timestamps and generated governance boilerplate are removed.",
        }],
        originalHash,
        proposedHash: await sha256Text(proposedContent),
        originalContent: source.content,
        proposedContent,
        uid,
      });
    }
    const projection = buildOkf23Projection(source.content, source.path, `sha256:${originalHash}`, null);
    const findings: OkfMigrationFinding[] = [
      ...native.issues.map((issue) => ({ code: "invalid-okf-2.3-yaml", message: `${issue.message} (line ${issue.line})` })),
      ...(projection?.diagnostics ?? [])
        .filter((item) => (item.severity === "error" || item.severity === "critical") && (item.code.startsWith("OKF-SCHEMA-") || item.code.startsWith("OKF-IDENTITY-")))
        .map((item) => ({ code: item.code, message: item.message })),
    ];
    if (findings.length) return assessed({ path: source.path, status: "blocked", standard: "OKF+ 2.3", findings, originalHash, originalContent: source.content, uid: typeof native.data.uid === "string" ? native.data.uid : undefined });
    return assessed({ path: source.path, status: "okf-plus-2.3", standard: "OKF+ 2.3", findings: [], originalHash, originalContent: source.content, uid: typeof native.data.uid === "string" ? native.data.uid : undefined });
  }
  const fm = strictFrontmatter(source.content);
  const name = source.path.split("/").pop()?.toLowerCase();
  if ((name === "index.md" || name === "log.md") && !source.path.toLowerCase().startsWith(".okf/")) {
    const rootVersionDeclaration = source.path.toLowerCase() === "index.md" && fm.state === "valid" && scalar(fm, "okf_version") === "0.1";
    if (fm.state === "unterminated" || fm.problems.length) {
      return assessed({ path: source.path, status: "blocked", standard: "Google OKF reserved", findings: fm.problems, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
    }
    if (opts.mode === "upgrade-all" || opts.mode === "convert-to-23") {
      const override = upgradeOverrides(fm);
      if (override.blockers.length) return assessed({ path: source.path, status: "blocked", standard: "Google OKF reserved", findings: override.blockers, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
      const uid = migrationUid(fm, opts.uuid, true);
      const proposedContent = opts.mode === "convert-to-23"
        ? proposedNativeOkf23(fm, source, uid, opts.createdAt, opts.defaults, override.salvage)
        : proposedOkf(fm, source, uid, opts.createdAt, opts.defaults, override.salvage);
      const findings = [{ code: "upgrade-google-reserved", message: `${name} is reserved by Google OKF but is included by the explicit conversion mode.` }, ...override.findings];
      return assessed({ path: source.path, status: "needs-okf-plus", standard: "Google OKF reserved", findings, salvage: override.salvage, originalHash, proposedHash: await sha256Text(proposedContent), originalContent: source.content, proposedContent, uid });
    }
    const findings = fm.state === "none" || rootVersionDeclaration
      ? [{ code: "google-reserved", message: `${name} is a Google OKF reserved document and is not converted.` }]
      : [{ code: "reserved-frontmatter-review", message: `${name} is reserved by Google OKF; its frontmatter requires manual review.` }];
    return assessed({ path: source.path, status: rootVersionDeclaration || fm.state === "none" ? "google-reserved" : "blocked", standard: "Google OKF reserved", findings, originalHash, originalContent: source.content });
  }
  if (fm.state === "unterminated" || fm.problems.length) {
    return assessed({ path: source.path, status: "blocked", standard: "none", findings: fm.problems, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
  }
  if (fm.state === "valid" && scalar(fm, "okf_version") === "2.2") {
    const validation = okfValidation(fm);
    if (!validation.length) {
      const uid = migrationUid(fm, opts.uuid);
      if (opts.mode === "convert-to-23") {
        const proposedContent = proposedNativeOkf23(fm, source, uid, opts.createdAt, opts.defaults);
        return assessed({ path: source.path, status: "needs-okf-plus", standard: "OKF+ 2.2", findings: [{ code: "convert-okf-2.2-to-2.3", message: "Valid editable OKF+ 2.2 frontmatter will be converted to native OKF+ 2.3 with editable tags and wikilink relationship overlays preserved." }], originalHash, proposedHash: await sha256Text(proposedContent), originalContent: source.content, proposedContent, uid });
      }
      return assessed({ path: source.path, status: "okf-plus-2.2", standard: "OKF+ 2.2", findings: [], originalHash, originalContent: source.content, uid });
    }
    const destructive = invalidExplicitGovernance(fm);
    if (destructive.length && opts.mode !== "upgrade-all" && opts.mode !== "convert-to-23") return assessed({ path: source.path, status: "blocked", standard: "none", findings: destructive, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
    const override = opts.mode === "upgrade-all" || opts.mode === "convert-to-23" ? upgradeOverrides(fm) : { findings: [], salvage: [], blockers: [] };
    if (override.blockers.length) return assessed({ path: source.path, status: "blocked", standard: "none", findings: override.blockers, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
    const uid = migrationUid(fm, opts.uuid, opts.mode === "upgrade-all" || opts.mode === "convert-to-23");
    const proposedContent = opts.mode === "convert-to-23"
      ? proposedNativeOkf23(fm, source, uid, opts.createdAt, opts.defaults, override.salvage)
      : proposedOkf(fm, source, uid, opts.createdAt, opts.defaults, override.salvage);
    return assessed({ path: source.path, status: "needs-okf-plus", standard: "none", findings: [...validation, ...override.findings], salvage: override.salvage, originalHash, proposedHash: await sha256Text(proposedContent), originalContent: source.content, proposedContent, uid });
  }
  // Google OKF v0.1 draft conformance is intentionally minimal: parseable YAML
  // frontmatter and a non-empty type. Producer-defined extra keys are allowed.
  if (fm.state === "valid" && nonempty(scalar(fm, "type"))) {
    if (opts.mode !== "upgrade-all" && opts.mode !== "convert-to-23") return assessed({ path: source.path, status: "google-okf-0.1", standard: "Google OKF 0.1 draft", findings: [], originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
    const override = upgradeOverrides(fm);
    if (override.blockers.length) return assessed({ path: source.path, status: "blocked", standard: "Google OKF 0.1 draft", findings: override.blockers, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
    const uid = migrationUid(fm, opts.uuid, true);
    const proposedContent = opts.mode === "convert-to-23"
      ? proposedNativeOkf23(fm, source, uid, opts.createdAt, opts.defaults, override.salvage)
      : proposedOkf(fm, source, uid, opts.createdAt, opts.defaults, override.salvage);
    const target = opts.mode === "convert-to-23" ? "native OKF+ 2.3" : "the human-editable OKF+ 2.2 Properties format";
    const findings = [{ code: "upgrade-google-okf", message: `Google OKF/legacy frontmatter will be upgraded to ${target}.` }, ...override.findings];
    return assessed({ path: source.path, status: "needs-okf-plus", standard: "Google OKF 0.1 draft", findings, salvage: override.salvage, originalHash, proposedHash: await sha256Text(proposedContent), originalContent: source.content, proposedContent, uid });
  }
  const explicit = invalidExplicitGovernance(fm);
  if (explicit.length && opts.mode !== "upgrade-all" && opts.mode !== "convert-to-23") return assessed({ path: source.path, status: "blocked", standard: "none", findings: explicit, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
  const override = opts.mode === "upgrade-all" || opts.mode === "convert-to-23" ? upgradeOverrides(fm) : { findings: [], salvage: [], blockers: [] };
  if (override.blockers.length) return assessed({ path: source.path, status: "blocked", standard: "none", findings: override.blockers, originalHash, originalContent: source.content, uid: scalar(fm, "uid") });
  const uid = migrationUid(fm, opts.uuid, opts.mode === "upgrade-all" || opts.mode === "convert-to-23");
  const proposedContent = opts.mode === "convert-to-23"
    ? proposedNativeOkf23(fm, source, uid, opts.createdAt, opts.defaults, override.salvage)
    : proposedOkf(fm, source, uid, opts.createdAt, opts.defaults, override.salvage);
  const findings: OkfMigrationFinding[] = [{
    code: fm.state === "none" ? "missing-frontmatter" : "missing-okf-type",
    message: fm.state === "none" ? "No YAML frontmatter was found." : "Frontmatter is not OKF+ 2.2 and lacks the type required by Google OKF 0.1.",
  }, ...override.findings];
  return assessed({ path: source.path, status: "needs-okf-plus", standard: "none", findings, salvage: override.salvage, originalHash, proposedHash: await sha256Text(proposedContent), originalContent: source.content, proposedContent, uid });
}

export async function createOkfMigrationPlan(
  sources: OkfMigrationSource[],
  options: Partial<OkfMigrationDefaults> & { now?: () => Date; uuid?: () => string; mode?: OkfMigrationMode } = {},
): Promise<OkfMigrationPlan> {
  const { now: suppliedNow, uuid: suppliedUuid, mode = "safe-onboarding", ...overrides } = options;
  const defaults: OkfMigrationDefaults = { ...DEFAULT_OKF_MIGRATION_DEFAULTS, ...overrides } as OkfMigrationDefaults;
  const now = suppliedNow ?? (() => new Date());
  const uuid = suppliedUuid ?? makeOkfUuidV4;
  const createdAt = now().toISOString();
  const runId = `okf-${createdAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${uuid().slice(0, 8)}`;
  const entries: OkfMigrationEntry[] = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    if (source.path.toLowerCase().startsWith(".okf/")) continue;
    entries.push(await auditOne(source, { createdAt, defaults, uuid, mode }));
  }
  const uidMap = new Map<string, OkfMigrationEntry[]>();
  for (const entry of entries) if (entry.uid && VALID_UID.test(entry.uid)) {
    const group = uidMap.get(entry.uid) ?? []; group.push(entry); uidMap.set(entry.uid, group);
  }
  for (const [uid, group] of uidMap) if (group.length > 1) {
    for (const entry of group) {
      entry.findings.push({ code: "duplicate-uid", message: `UID ${uid} is also used by ${group.filter((x) => x !== entry).map((x) => x.path).join(", ")}.` });
      if (entry.status === "okf-plus-2.2" || entry.status === "okf-plus-2.3" || entry.status === "needs-okf-plus") {
        entry.status = "blocked"; entry.standard = "none"; delete entry.proposedContent; delete entry.proposedHash;
      }
      entry.review = migrationReview(entry);
    }
  }
  const totals: OkfMigrationPlan["totals"] = {
    notes: entries.length, changes: 0, "okf-plus-2.2": 0, "okf-plus-2.3": 0, "google-okf-0.1": 0,
    "google-reserved": 0, "needs-okf-plus": 0, blocked: 0,
  };
  for (const entry of entries) { totals[entry.status]++; if (entry.status === "needs-okf-plus") totals.changes++; }
  const base = { schema: "okf-plus-migration-plan/4" as const, runId, createdAt, mode, defaults, totals, entries };
  const planHash = await sha256Text(JSON.stringify(planMaterial(base)));
  return { ...base, planHash };
}

/** Remove raw/proposed note contents before persisting an audit plan. */
export function publicOkfMigrationPlan(plan: OkfMigrationPlan): unknown {
  return {
    schema: plan.schema, runId: plan.runId, createdAt: plan.createdAt, planHash: plan.planHash,
    mode: plan.mode, defaults: plan.defaults, totals: plan.totals,
    entries: plan.entries.map(({ originalContent: _o, proposedContent: _p, ...entry }) => entry),
  };
}
