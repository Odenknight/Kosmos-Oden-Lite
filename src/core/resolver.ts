/**
 * Kosmos Core — link target resolution.
 * Resolves a link target (path / path-without-extension / basename / alias)
 * to a node id, tracking ambiguity so diagnostics can report it (§3.5, §32).
 */
import {
  basenameWithoutExtension,
  normalizeVaultRelative,
  posixBasename,
  posixDirname,
  posixJoin,
  toPosixPath,
  withoutExtension,
} from "./paths";

export interface Resolver {
  byPath: Map<string, string>;
  byPathNoExt: Map<string, string>;
  byBasename: Map<string, string[]>;
  byAlias: Map<string, string[]>;
  /** Keys that resolved ambiguously at least once (for diagnostics). */
  ambiguous: Set<string>;
}

export function createResolver(): Resolver {
  return {
    byPath: new Map(),
    byPathNoExt: new Map(),
    byBasename: new Map(),
    byAlias: new Map(),
    ambiguous: new Set(),
  };
}

function pushMulti(map: Map<string, string[]>, key: string, val: string): void {
  const cur = map.get(key) ?? [];
  cur.push(val);
  map.set(key, cur);
}

export function addFileToResolver(idx: Resolver, relPath: string, nodeId: string, aliases: string[] = []): void {
  const n = normalizeVaultRelative(relPath);
  idx.byPath.set(n.toLowerCase(), nodeId);
  idx.byPathNoExt.set(withoutExtension(n).toLowerCase(), nodeId);
  pushMulti(idx.byBasename, basenameWithoutExtension(n).toLowerCase(), nodeId);
  for (const a of aliases) pushMulti(idx.byAlias, a.trim().toLowerCase(), nodeId);
}

export function cleanTarget(t: string): string {
  return normalizeVaultRelative(
    toPosixPath(t).replace(/^<|>$/g, "").split("#")[0].split("|")[0].trim()
  );
}

export const unresolvedId = (t: string): string => `unresolved:${cleanTarget(t).toLowerCase()}`;

/** Deterministically pick from ambiguous candidates (sorted-first), recording ambiguity. */
function pickCandidate(idx: Resolver, key: string, c: string[] | undefined): string | undefined {
  if (!c || !c.length) return undefined;
  const uniq = [...new Set(c)];
  if (uniq.length > 1) idx.ambiguous.add(key);
  return uniq.sort()[0];
}

/** Resolve a link target to a node id, or undefined when unresolved. */
export function resolveLinkTarget(idx: Resolver, sourcePath: string, target: string): string | undefined {
  const nt = cleanTarget(target);
  if (!nt) return undefined;
  const direct = nt.toLowerCase();
  const dir = posixDirname(normalizeVaultRelative(sourcePath));
  const rel = dir && dir !== "." ? posixJoin(dir, nt).toLowerCase() : direct;
  const base = posixBasename(withoutExtension(direct));
  return (
    idx.byPath.get(direct) ?? idx.byPath.get(rel) ??
    idx.byPathNoExt.get(direct) ?? idx.byPathNoExt.get(rel) ??
    pickCandidate(idx, direct, idx.byAlias.get(direct)) ??
    pickCandidate(idx, base, idx.byBasename.get(base))
  );
}

/**
 * Resolve an OKF+ lineage reference (title / basename / path / alias).
 * Reports whether the resolution was ambiguous so lineage validation can warn.
 */
export function resolveTitleRef(
  idx: Resolver,
  ref: string
): { id?: string; ambiguous: boolean } {
  const k = String(ref || "").trim().toLowerCase();
  if (!k) return { ambiguous: false };
  const direct = idx.byPath.get(k) ?? idx.byPathNoExt.get(k);
  if (direct) return { id: direct, ambiguous: false };
  const byBase = idx.byBasename.get(k);
  if (byBase && byBase.length) {
    const uniq = [...new Set(byBase)];
    return { id: uniq.sort()[0], ambiguous: uniq.length > 1 };
  }
  const byAlias = idx.byAlias.get(k);
  if (byAlias && byAlias.length) {
    const uniq = [...new Set(byAlias)];
    return { id: uniq.sort()[0], ambiguous: uniq.length > 1 };
  }
  return { ambiguous: false };
}
