/**
 * Kosmos Core — temporal validity (§4).
 *
 * The model is *temporal validity intervals*, not full bitemporality: each
 * note carries
 *
 *     valid_at   = OKF+ timestamp, or the documented fallback
 *                  (file created-time, else modified-time, else index time)
 *     invalid_at = earliest valid_at of any DIRECT successor, or null
 *
 * A note is current while invalid_at == null. A lineage note is HEAD when it
 * participates in a lineage AND has no successor — never derived from the
 * presence of a frontmatter field (§3.4).
 *
 * The point-in-time projector below is THE single implementation used by the
 * Chrono view, the Agent API `graph_at_time`, the standalone Chrono view and
 * the temporal tests (§4.1). Do not fork these semantics.
 */
import type { LineageModel, TemporalProjection } from "./types";

export interface TemporalInput {
  id: string;
  validAtMs: number;
}

export interface TemporalState {
  /** id -> invalid_at in ms (null while current). */
  invalidAt: Map<string, number | null>;
  /** id -> HEAD flag (§3.4). */
  head: Map<string, boolean>;
  /** Overall [min,max] time span across valid_at/invalid_at, or null. */
  timeSpan: { min: number; max: number } | null;
}

/** Derive invalid_at and HEAD for every note from the canonical lineage graph. */
export function computeTemporalState(
  notes: TemporalInput[],
  lineage: LineageModel
): TemporalState {
  const validAt = new Map(notes.map((n) => [n.id, n.validAtMs]));
  const invalidAt = new Map<string, number | null>();
  const head = new Map<string, boolean>();
  let tmin = Infinity;
  let tmax = -Infinity;

  for (const n of notes) {
    const successors = lineage.supersededBy.get(n.id) ?? [];
    let inv: number | null = null;
    for (const s of successors) {
      const sv = validAt.get(s);
      if (sv != null && (inv == null || sv < inv)) inv = sv;
    }
    invalidAt.set(n.id, inv);
    head.set(n.id, lineage.members.has(n.id) && successors.length === 0);
    if (n.validAtMs < tmin) tmin = n.validAtMs;
    const hi = inv ?? n.validAtMs;
    if (hi > tmax) tmax = hi;
  }
  return {
    invalidAt,
    head,
    timeSpan: tmin < tmax ? { min: tmin, max: tmax } : null,
  };
}

export interface ProjectableNote {
  id: string;
  validAtMs: number;
  invalidAtMs: number | null;
}

/**
 * Point-in-time projection (§4.1) — the one shared projector.
 *
 *   not_yet_created : valid_at >  T
 *   valid           : valid_at <= T && (invalid_at == null || invalid_at > T)
 *   superseded_at_T : invalid_at != null && invalid_at <= T
 */
export function projectAtTime(notes: ProjectableNote[], atMs: number): TemporalProjection {
  const notYetCreated: string[] = [];
  const valid: string[] = [];
  const superseded: string[] = [];
  for (const n of notes) {
    if (n.validAtMs > atMs) {
      notYetCreated.push(n.id);
    } else if (n.invalidAtMs != null && n.invalidAtMs <= atMs) {
      superseded.push(n.id);
    } else {
      valid.push(n.id);
    }
  }
  return { at: new Date(atMs).toISOString(), notYetCreated, valid, superseded };
}

/**
 * Documented valid_at fallback chain: OKF+ timestamp when parseable, else
 * file created-time, else modified-time, else the index build time.
 */
export function resolveValidAt(
  okfTimestampMs: number | null,
  createdTimeMs: number | undefined,
  modifiedTimeMs: number | undefined,
  nowMs: number
): number {
  if (okfTimestampMs != null) return okfTimestampMs;
  if (createdTimeMs != null && Number.isFinite(createdTimeMs)) return createdTimeMs;
  if (modifiedTimeMs != null && Number.isFinite(modifiedTimeMs)) return modifiedTimeMs;
  return nowMs;
}
