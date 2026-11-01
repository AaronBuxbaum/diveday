import { shopPath } from "@/lib/staff-notices";

/** Return counter notices to the departure roster. `shopPath` safely builds
 * the route from the caller-supplied shop slug and trip ID.
 */
export function counterQueuePath(shopSlug: string, tripId: string): string {
  return shopPath(shopSlug, "trips", tripId);
}

/** A diver's row on the Divers tab, which Today's arrival lookup links straight to. */
export function counterRowId(bookingId: string): string {
  return `booking-${bookingId}`;
}
