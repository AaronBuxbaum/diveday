import { shopPath } from "@/lib/staff-notices";

/**
 * **Where a counter refusal finds its way back to.**
 *
 * The counter is one departure's Check-in tab (ADR 20261001-logbook, decision
 * 3), so the boat is a path segment and a `?notice=` redirect lands on the
 * queue the staffer was working without carrying any focus of its own.
 *
 * `shopPath` rather than a template literal, for the reason it exists:
 * `shopSlug` and `tripId` reach a server action as ordinary, caller-supplied
 * arguments (`src/lib/staff-notices.ts`).
 */
export function counterQueuePath(shopSlug: string, tripId: string): string {
  return shopPath(shopSlug, "trips", tripId, "check-in");
}
