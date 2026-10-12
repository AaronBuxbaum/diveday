/**
 * **Who an after-dive head count is counting, and what closes it** — the one
 * rule for divers and crew alike (glossary, "Unaccounted for").
 *
 * The same predicates the Today queue reads (`src/db/today.ts`, which keeps its
 * own copies for now): somebody is in the after-dive count once they were
 * boarded at the dock, or once anybody recorded any result for them at a later
 * checkpoint. A seat or a crew member with no mark anywhere is not, because a
 * walk-away is never written down at the rail. Only "boarded" closes a count.
 */

export type RollCallState = "boarded" | "not_boarded" | undefined;

/** `states[0]` is the dock; the rest are the after-dive checkpoints, in order. */
export function inAfterDivePopulation(states: readonly RollCallState[]): boolean {
  return states[0] === "boarded" || states.slice(1).some((state) => state !== undefined);
}

/** Recorded back aboard at this checkpoint. Nothing else closes it. */
export function isAccountedForAfterDive(state: RollCallState): boolean {
  return state === "boarded";
}
