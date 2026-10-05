import { shopPath } from "@/lib/staff-notices";

/**
 * **Where a counter refusal finds its way back to.**
 *
 * The counter is the departure's Divers tab once arrivals open — one list of
 * the boat's people, which gains its check-in taps at the desk rather than
 * living on a tab of its own (owner, 2026-10-05: one place per thing). So a
 * `?notice=` redirect lands on the roster the staffer was working.
 *
 * `shopPath` rather than a template literal, for the reason it exists:
 * `shopSlug` and `tripId` reach a server action as ordinary, caller-supplied
 * arguments (`src/lib/staff-notices.ts`).
 */
export function counterQueuePath(shopSlug: string, tripId: string): string {
  return shopPath(shopSlug, "trips", tripId);
}

/** A diver's row on the Divers tab, which Today's arrival lookup links straight to. */
export function counterRowId(bookingId: string): string {
  return `booking-${bookingId}`;
}
