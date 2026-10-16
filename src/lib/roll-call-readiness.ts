import type { ReadinessBlocker, ReadinessResult } from "./readiness";

/**
 * **What readiness said when a diver was counted aboard** (issue #2414, ADR
 * 20261015-roll-call-records-readiness): the snapshot a `boarded` roll-call
 * event keeps, because readiness is recomputed live and "was blocked" is
 * unsayable once the card is verified. Blockers ride only on a `blocked`
 * snapshot. A record of what was true at the rail, never a gate.
 */
export type ReadinessSnapshot =
  | { status: "ready"; blockers: null }
  | { status: "blocked"; blockers: ReadinessBlocker[] };

export function readinessSnapshotOf(readiness: ReadinessResult): ReadinessSnapshot {
  return readiness.status === "ready"
    ? { status: "ready", blockers: null }
    : { status: "blocked", blockers: readiness.blockers };
}

/** A seat counted aboard while blocked: where, and what stood in the way. */
export type CountedAboardBlocked = { checkpoint: string; blockers: ReadinessBlocker[] };
