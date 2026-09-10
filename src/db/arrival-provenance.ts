import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookingArrivalEvents } from "./schema";

/**
 * **Which arrivals the shop has only been *told* about** (N-24).
 *
 * `bookings.status = 'checked_in'` has two writers now. A staffer at the desk
 * taps it with the diver in front of them, which is a sighting. A diver — or
 * whoever is holding the lobby tablet — types a surname into the self check-in
 * kiosk, which is hearsay. `booking_arrival_events.display_token_id` is the one
 * column that tells them apart, and until this reader existed it had no reader
 * at all outside the CSV export's exclusion list.
 *
 * That mattered, because three surfaces already read `checked_in` as evidence
 * somebody is in the building: the counter's "here" count, the counter's
 * stop-chasing accent (`counterIsClear`), and the **Checked in** pill a crew
 * member reads at the rail. Proxy check-in is not an attack, it is what every
 * self-serve kiosk on earth gets used for — one half of a couple parks the car
 * while the other types both surnames — so the honest reading of a kiosk tap is
 * "somebody says they are here", and a shop that stops phoning a diver on the
 * strength of it is acting on a claim nobody verified
 * (`security-reviewer` and `dive-domain-expert` reviews, 2026-09-09).
 *
 * **The latest arrival wins.** A kiosk tap that a staffer later confirms at the
 * desk writes a second, tokenless row, and this stops calling that booking
 * self-reported — which is right: a human has now looked at them.
 *
 * Batched over a whole queue or roster, never one query per row.
 */
export async function listSelfReportedArrivalBookingIds(
  db: AppDb,
  shopId: string,
  bookingIds: readonly string[],
): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const rows = await db
    .select({
      bookingId: bookingArrivalEvents.bookingId,
      displayTokenId: bookingArrivalEvents.displayTokenId,
    })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.status, "arrived"),
        inArray(bookingArrivalEvents.bookingId, [...bookingIds]),
      ),
    )
    .orderBy(desc(bookingArrivalEvents.occurredAt), desc(bookingArrivalEvents.id));
  return latestPerBooking(rows);
}

/**
 * The same answer for a whole departure, without the caller having to enumerate
 * its bookings first — the manifest's shape of the question.
 */
export async function listSelfReportedArrivalBookingIdsForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      bookingId: bookingArrivalEvents.bookingId,
      displayTokenId: bookingArrivalEvents.displayTokenId,
    })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, tripId),
        eq(bookingArrivalEvents.status, "arrived"),
      ),
    )
    .orderBy(desc(bookingArrivalEvents.occurredAt), desc(bookingArrivalEvents.id));
  return latestPerBooking(rows);
}

/** Newest-first rows in, the bookings whose latest arrival came from a tablet out. */
function latestPerBooking(
  rows: readonly { bookingId: string; displayTokenId: string | null }[],
): Set<string> {
  const selfReported = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.bookingId)) continue;
    seen.add(row.bookingId);
    if (row.displayTokenId) selfReported.add(row.bookingId);
  }
  return selfReported;
}
