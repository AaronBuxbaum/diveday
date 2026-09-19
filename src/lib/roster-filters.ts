import type { ReadinessResult } from "./readiness";
import type { WaiverState } from "./waivers";

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
 *
 * **It no longer only decides whether a card appears under a filter chip**, and
 * this comment said so until 2026-09-19. `TripHull` reads it to colour a seat
 * on a drawing of the boat, so a booking whose readiness was never read paints
 * as an ordinary held seat — an absence of evidence rendered as a clearance.
 * That is safe only while the two sets agree, which they do because the roster
 * and the readiness map come out of one `getTripGuests` batch over the same
 * non-cancelled bookings. Nothing pins that agreement and the hull has no "not
 * known" seat to draw, so a *third* caller of this predicate on a safety
 * surface needs one first.
 */
export function rosterRowIsBlocked(readiness: ReadinessResult | undefined): boolean {
  return readiness?.status === "blocked";
}

/**
 * Does this booking have a waiver a staffer can still send or resend?
 *
 * The "Needs waiver" chip used to ask `waiverState !== "complete"`, which
 * counts a `medical_review` diver — someone whose waiver *is* signed and is
 * waiting on a human to read a medical answer. There is nothing to send them,
 * the bulk send button already excludes them (no checkbox is offered), and the
 * count therefore promised work that the surface refused to let anyone do. This
 * is the bulk button's definition, which is the honest one: a waiver is
 * "needed" when sending one would actually do something.
 */
export function rosterRowNeedsWaiver(state: WaiverState): boolean {
  return state === "not_sent" || state === "awaiting_signature" || state === "expired";
}
