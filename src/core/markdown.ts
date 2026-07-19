/**
 * Kosmos Core — Markdown parsing.
 * Tolerant YAML-ish frontmatter (scalars, "- item" block lists, [inline, lists],
 * comma lists, quotes) plus wikilink / markdown-link / property-link extraction.
 * Pure functions: runs identically in Node, the plugin iframe and the standalone page.
 */
import type { ParsedLink } from "./types";

export interface Frontmatter {
  [key: string]: string | string[] | undefined;
}

export interface ParsedMarkdown {
  data: Frontmatter;
  content: string;
  links: ParsedLink[];
  tags: string[];
  aliases: string[];
}

const unquote = (s: string): string => s.replace(/^['"]/, "").replace(/['"]$/, "");

export function parseFrontmatter(raw: string): { data: Frontmatter; content: string } {
  // Windows editors commonly write a UTF-8 BOM; it must not break frontmatter.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (!raw.startsWith("---")) return { data: {}, content: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, content: raw };
  const header = raw.slice(3, end).replace(/^\r?\n/, "");
  const content = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Frontmatter = {};
  try {
    // CRLF: the delimiter search consumes only "\n---", so the last header
    // line (and lookahead list items) may keep a trailing "\r" — strip it.
    const lines = header.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      const rest = m[2].replace(/\s+#.*$/, "").trim();
      if (rest === "" || rest === "|" || rest === ">") {
        const items: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const ln = lines[j];
          const li = /^\s*-\s+(.*)$/.exec(ln);
          if (li) { items.push(unquote(li[1].trim())); j++; continue; }
          if (/^\s+\S/.test(ln) && rest !== "") { items.push(ln.trim()); j++; continue; }
          break;
        }
        data[key] = items.length ? items : "";
        i = j - 1;
      } else if (rest.startsWith("[") && rest.endsWith("]")) {
        data[key] = rest.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
      } else {
        data[key] = unquote(rest);
      }
    }
  } catch {
    return { data: {}, content: raw };
  }
  return { data, content };
}

/** Frontmatter properties treated as relations (produce `property` links).
 * Includes every registered OKF+ 2.2 typed relationship. */
export const RELATION_PROPERTIES = [
  "related", "related_to", "supports", "contradicts", "depends_on",
  "derived_from", "derives_from", "cites", "quotes", "interprets", "tests",
  "replicates", "fails_to_replicate", "extends", "narrows", "generalizes",
  "implements", "governed_by", "reviewed_by", "approved_by", "part_of",
  "has_part", "refines", "blocks", "documents",
  "forked_from", "forked_to", "initiative", "project", "repo", "source",
];

export const isExternal = (t: string): boolean =>
  /^(https?:|file:|mailto:|tel:|obsidian:|data:|#)/i.test(t);

const looksLikeLocalRef = (v: string): boolean => {
  const t = v.trim();
  return Boolean(t) && !isExternal(t) && t.length < 180;
};

export function parseWikiLinks(md: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const re = /!?\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const inner = m[1].trim();
    const [targetPart, aliasPart] = inner.split("|");
    const [target, heading] = targetPart.split("#");
    const clean = target.trim();
    if (!clean) continue;
    out.push({ kind: "wikilink", target: clean, raw: m[0], alias: aliasPart?.trim(), heading: heading?.trim() });
  }
  return out;
}

export function parseMarkdownLinks(md: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const re = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const rawT = m[1].trim();
    if (!rawT || isExternal(rawT)) continue;
    const [target, heading] = rawT.split("#");
    let clean: string;
    try {
      clean = decodeURIComponent(target.trim()).replace(/^<|>$/g, "");
    } catch {
      clean = target.trim().replace(/^<|>$/g, "");
    }
    if (!clean) continue;
    out.push({ kind: "markdown", target: clean, raw: m[0], heading: heading?.trim() });
  }
  return out;
}

export function collectStringValues(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(collectStringValues);
  if (v && typeof v === "object") return Object.values(v).flatMap(collectStringValues);
  return [];
}

export function normalizeStringList(v: unknown): string[] {
  return collectStringValues(v).flatMap((i) => i.split(",")).map((i) => i.trim()).filter(Boolean);
}

export function normalizeTags(v: unknown): string[] {
  return normalizeStringList(v).map((t) => t.replace(/^#/, ""));
}

export function extractPropertyLinks(data: Frontmatter): ParsedLink[] {
  const out: ParsedLink[] = [];
  for (const key of RELATION_PROPERTIES) {
    for (const cand of collectStringValues(data[key])) {
      const wiki = parseWikiLinks(cand).map((l) => ({ ...l, kind: "property" as const }));
      if (wiki.length) out.push(...wiki);
      else if (looksLikeLocalRef(cand)) out.push({ kind: "property", target: cand, raw: cand });
    }
  }
  return out;
}

/** Full parse of one markdown note (frontmatter + all link kinds + tags/aliases). */
export function parseMarkdownFile(raw: string): ParsedMarkdown {
  const { data, content } = parseFrontmatter(raw);
  const links = [...parseWikiLinks(content), ...parseMarkdownLinks(content), ...extractPropertyLinks(data)];
  return { data, content, links, tags: normalizeTags(data.tags), aliases: normalizeStringList(data.aliases) };
}
