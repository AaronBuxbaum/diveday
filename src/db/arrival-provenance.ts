import { type AnyColumn, and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookingArrivalEvents } from "./schema";

/**
 * **"Somebody at this shop saw this diver arrive, and has not taken it back"**
 * — as a predicate a query can carry, for the one booking it is correlated to
 * (issue #1558).
 *
 * `bookings.status` is a projection with one slot, so the last writer wins it:
 * a close-of-day sweep that stamps `no_show` over a seat erases the fact that
 * a staffer stood in front of that diver at 06:40 and tapped them in. The
 * append-only trail underneath never loses that — `booking_arrival_events` is
 * not soft-deletable and not pruned, and it is absent from `RETENTION_DAYS`
 * (`src/lib/retention.ts`) on purpose — so a reader asking "was this person
 * aboard" should ask the trail rather than the slot.
 *
 * **The newest row wins, and it may be a retraction.** The ordering here is
 * `newestArrivalEvent`'s own three columns (`src/db/check-in.ts`), deliberately
 * and not approximately: `occurred_at` ties constantly under a frozen clock or
 * a batched offline sync, and "what stands" must not be answerable two ways in
 * one codebase. An undo writes a `cleared` row rather than deleting the
 * `arrived` one, so a taken-back sighting collapses to `false` here — which is
 * the point. The shop is allowed to say it was wrong.
 *
 * Correlated on `trip_id` as well as `booking_id` even though a booking belongs
 * to exactly one departure: that pair is the exact prefix of
 * `booking_arrival_events_shop_trip_booking_occurred_idx`, so the subquery
 * stays an index probe rather than a scan per candidate row.
 *
 * Lives here rather than inline in its one caller because "was this diver
 * aboard" is the same question a manifest and `buildIncidentExport`
 * (`src/lib/incident-export.ts`) have to answer honestly, and the answer may
 * not differ by who is asking.
 */
export function standingArrivalIsArrived(
  shopId: string,
  bookingIdColumn: AnyColumn,
  tripIdColumn: AnyColumn,
): SQL<boolean> {
  return sql<boolean>`(
    select standing.status
    from ${bookingArrivalEvents} as standing
    where standing.shop_id = ${shopId}
      and standing.trip_id = ${tripIdColumn}
      and standing.booking_id = ${bookingIdColumn}
    order by standing.occurred_at desc, standing.created_at desc, standing.seq desc
    limit 1
  ) = 'arrived'`;
}

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
