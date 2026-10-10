import type { ReadinessResult } from "./readiness";

/**
 * The two predicates the trip roster's filter chips count with.
 *
 * They live here rather than inline in `RosterSection.tsx` because both of them
 * were quietly wrong in the same way: each *looked* like the rule its chip
 * promised, and neither matched the rule the rest of the app applies to the
 * same question. A chip whose count disagrees with the list it filters — or
 * with the bulk button beside it — teaches staff to stop trusting the numbers.
 */

/**
 * Is this booking blocked?
 *
 * The roster used to ask `status !== "ready"`, which reads as the same thing
 * and is not: an **absent** readiness row (a booking the batched readiness pass
 * returned nothing for) has no status at all, so `!== "ready"` counted it as
 * blocked. The readiness pass the nav badge and the shop home's spine both
 * derive from requires `status === "blocked"`, so the same booking was blocked
 * on the roster and absent everywhere else. This is the queue's rule, stated
 * once.
 *
 * Failing *open* here is deliberate: the manifest and the readiness engine
 * still fail closed on missing evidence (`readiness_unavailable`), which is
 * where a missing row is actually a hazard, and nothing gates boarding on this.
 */
export function rosterRowIsBlocked(readiness: ReadinessResult | undefined): boolean {
  return readiness?.status === "blocked";
}
