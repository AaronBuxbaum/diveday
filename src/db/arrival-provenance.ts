import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
import { bookingArrivalEvents } from "./schema";

/**
 * **What the trail currently says about one seat**, as the word itself rather
 * than a verdict on it — the question a writer of `bookings.status` asks before
 * it puts that slot back.
 *
 * The only reader of this trail that answers a writer rather than a person:
 * `undoBookingNoShow` (`src/db/no-show.ts`) puts a released seat back and needs
 * the state it was released *from*, and guessing that is how the slot and the
 * trail drift apart. A kiosk tap counts here, because it wrote `checked_in`
 * into the slot in the first place (`checkInAtKiosk`, `src/db/check-in.ts`);
 * whether that arrival was a *sighting* is the separate question
 * `listSelfReportedArrivalBookingIds` below answers, and the two must not be
 * confused.
 *
 * **The trail is a record of who was seen, never of who dived** — and no
 * reader here may spend it as the latter. Until a `dive-domain-expert` review
 * on 2026-09-11 a third export let a standing `arrived` row outrank
 * `bookings.status = 'no_show'` in the two dive-day readers, against a
 * close-of-day sweep that does not exist. The only writer of that status is
 * one staffer's deliberate tap, always later than the check-in it overwrites,
 * so the escape only ever let an earlier human statement beat a later human
 * correction. A diver can be checked in at 06:40 and seasick on the ramp at
 * 06:50; the desk seeing somebody is not the boat carrying them.
 *
 * The same three ordering keys as everything else in this file, and for the
 * same reason: `occurred_at` ties constantly, so the last-appended row has to
 * win or two readers order one pair of taps differently.
 */
export async function standingArrivalStatus(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<"arrived" | "cleared" | undefined> {
  const [standing] = await tx
    .select({ status: bookingArrivalEvents.status })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, tripId),
        eq(bookingArrivalEvents.bookingId, bookingId),
      ),
    )
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    )
    .limit(1);
  return standing?.status;
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
 * **The latest arrival wins, by the same three keys as everything else here.**
 * A kiosk tap that a staffer later confirms at the desk writes a second,
 * tokenless row, and this stops calling that booking self-reported — which is
 * right: a human has now looked at them. Which row is *latest* is decided by
 * `occurred_at`, `created_at`, `seq`, the ordering `standingArrivalStatus`
 * above and `newestArrivalEvent` (`src/db/check-in.ts`) already use. This read
 * broke the rule the file states: it tied on `id`, a `defaultRandom()` uuid, so
 * a kiosk tap and a desk confirm landing in the same batched-sync millisecond
 * resolved by coin flip — and half of those flips dropped the booking out of
 * this set, claiming a human had looked when none had
 * (`dive-domain-expert` and `security-reviewer`, 2026-09-11).
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
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    );
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
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    );
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
