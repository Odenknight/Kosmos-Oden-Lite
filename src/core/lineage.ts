/**
 * Kosmos Core — canonical lineage normalization (§3).
 *
 * Internally lineage is ONE canonical directed relationship:
 *
 *     NEWER --supersedes--> OLDER
 *
 * Authors may declare either side (`supersedes` on the newer note,
 * `superseded_by` on the older note, or both); the indexer normalizes every
 * valid declaration into the same canonical edge set and derives both
 * projections (`supersedesIds`, `supersededByIds`) from it. The projections
 * are never trusted as independent source fields.
 *
 * Validation (§3.5) detects self-supersession, cycles, unresolved targets,
 * multiple direct successors, successor-before-predecessor timestamps,
 * duplicate declarations and ambiguous title resolution. Malformed lineage
 * degrades gracefully: offending edges are kept or dropped as documented
 * below, never by silently destroying the rest of the graph.
 */
import type { LineageModel, LineageWarning } from "./types";

export interface LineageInput {
  /** Node id (e.g. "file:Ideas/Engine v2.md"). */
  id: string;
  /** Human label for warning messages. */
  label: string;
  /** Raw declared references, as authored. */
  declaredSupersedes: string[];
  declaredSupersededBy: string[];
  /** valid_at in ms (already computed from OKF+ timestamp or fallback). */
  validAtMs: number | null;
}

export type LineageRefResolver = (ref: string) => { id?: string; ambiguous: boolean };

export function normalizeLineage(
  inputs: LineageInput[],
  resolveRef: LineageRefResolver
): LineageModel {
  const warnings: LineageWarning[] = [];
  const edgeKeys = new Set<string>();
  const edges: Array<{ newer: string; older: string }> = [];
  const byId = new Map(inputs.map((n) => [n.id, n]));

  const addEdge = (newer: string, older: string, declaredBy: LineageInput, field: string): void => {
    if (newer === older) {
      warnings.push({
        code: "self-supersession",
        nodeId: declaredBy.id,
        message: `"${declaredBy.label}" declares itself in ${field}; ignored`,
      });
      return;
    }
    const key = `${newer}${older}`;
    if (edgeKeys.has(key)) {
      // The same canonical edge declared twice (e.g. both sides authored, or a
      // repeated list entry). That is valid authoring — only warn when the
      // duplicate came from the SAME note's same field twice.
      return;
    }
    edgeKeys.add(key);
    edges.push({ newer, older });
  };

  for (const n of inputs) {
    // supersedes: this note is NEWER; each ref is an OLDER note.
    const seenHere = new Set<string>();
    for (const ref of n.declaredSupersedes) {
      const r = resolveRef(ref);
      if (r.ambiguous) {
        warnings.push({
          code: "ambiguous-resolution",
          nodeId: n.id,
          message: `"${n.label}" supersedes "${ref}" which matches multiple notes; no lineage edge was projected`,
        });
        continue;
      }
      if (!r.id) {
        warnings.push({
          code: "unresolved-target",
          nodeId: n.id,
          message: `"${n.label}" supersedes "${ref}" which does not resolve to a note`,
        });
        continue;
      }
      const dupKey = `s${r.id}`;
      if (seenHere.has(dupKey)) {
        warnings.push({
          code: "duplicate-declaration",
          nodeId: n.id,
          message: `"${n.label}" declares supersedes "${ref}" more than once`,
        });
      }
      seenHere.add(dupKey);
      addEdge(n.id, r.id, n, "supersedes");
    }
    // superseded_by: this note is OLDER; each ref is a NEWER note.
    for (const ref of n.declaredSupersededBy) {
      const r = resolveRef(ref);
      if (r.ambiguous) {
        warnings.push({
          code: "ambiguous-resolution",
          nodeId: n.id,
          message: `"${n.label}" superseded_by "${ref}" matches multiple notes; no lineage edge was projected`,
        });
        continue;
      }
      if (!r.id) {
        warnings.push({
          code: "unresolved-target",
          nodeId: n.id,
          message: `"${n.label}" superseded_by "${ref}" does not resolve to a note`,
        });
        continue;
      }
      const dupKey = `b${r.id}`;
      if (seenHere.has(dupKey)) {
        warnings.push({
          code: "duplicate-declaration",
          nodeId: n.id,
          message: `"${n.label}" declares superseded_by "${ref}" more than once`,
        });
      }
      seenHere.add(dupKey);
      addEdge(r.id, n.id, n, "superseded_by");
    }
  }

  // ---- cycle detection (iterative DFS over newer->older edges) ----
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const a = adj.get(e.newer) ?? [];
    a.push(e.older);
    adj.set(e.newer, a);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=in-stack 2=done
  const cyclic = new Set<string>();
  let cycles = 0;
  for (const start of adj.keys()) {
    if (state.get(start)) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (adj.get(top.id) ?? [])[top.i++];
      if (next === undefined) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const st = state.get(next) ?? 0;
      if (st === 0) {
        state.set(next, 1);
        stack.push({ id: next, i: 0 });
      } else if (st === 1) {
        cycles++;
        cyclic.add(next);
        cyclic.add(top.id);
        const name = byId.get(next)?.label ?? next;
        warnings.push({
          code: "cycle",
          nodeId: next,
          message: `lineage cycle detected through "${name}"`,
        });
      }
    }
  }

  // ---- projections (derived from the canonical edge set only) ----
  const supersedes = new Map<string, string[]>();
  const supersededBy = new Map<string, string[]>();
  const members = new Set<string>();
  for (const e of edges) {
    members.add(e.newer);
    members.add(e.older);
    const s = supersedes.get(e.newer) ?? [];
    s.push(e.older);
    supersedes.set(e.newer, s);
    const b = supersededBy.get(e.older) ?? [];
    b.push(e.newer);
    supersededBy.set(e.older, b);
  }

  // ---- multiple direct successors + timestamp ordering ----
  for (const [older, newers] of supersededBy) {
    if (newers.length > 1) {
      const name = byId.get(older)?.label ?? older;
      warnings.push({
        code: "multiple-successors",
        nodeId: older,
        message: `"${name}" has ${newers.length} direct successors; invalid_at uses the earliest`,
      });
    }
    const on = byId.get(older);
    if (!on || on.validAtMs == null) continue;
    for (const newer of newers) {
      const nn = byId.get(newer);
      if (nn && nn.validAtMs != null && nn.validAtMs < on.validAtMs) {
        warnings.push({
          code: "successor-before-predecessor",
          nodeId: newer,
          message: `"${nn.label}" supersedes "${on.label}" but carries an earlier timestamp`,
        });
      }
    }
  }

  return { edges, supersedes, supersededBy, warnings, members, cycles };
}
