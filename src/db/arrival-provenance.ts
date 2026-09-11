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
 * (`src/lib/retention.ts`) on purpose — so a reader asking "did anybody here
 * see this diver that morning" should ask the trail rather than the slot.
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
 * **A kiosk tap is not a sighting, and the test for that goes in the
 * projection.** The lobby tablet writes `arrived` with `display_token_id` set,
 * from a bearer-token page where the URL is the capability and anybody holding
 * it can type a surname — so it is hearsay, the same hearsay
 * `listSelfReportedArrivalBookingIds` below exists to keep out of the words a
 * staffer's sighting earns (N-24, and a `security-reviewer` finding on
 * 2026-09-11 that this predicate was spending it). Both readers pay for that in
 * a diver's safety: `findSimilarDivers` prints "Last dive day here" as the
 * fact the counter's identity question turns on, and `peopleWhoDivedBefore`
 * feeds the fly-safe multi-day advisory.
 *
 * The provenance test belongs to the **projection** and never to the `where`
 * clause. Filtering the row selection would step past a kiosk row to an older
 * tokenless `arrived` and answer `true` on a seat whose latest word is a
 * retraction, which is the opposite of what the undo above promises. The newest
 * row still decides, whoever wrote it; only the verdict it earns changes.
 *
 * **This says the desk saw them. It does not say they dived, and it must not be
 * read as if it did** (`dive-domain-expert`, 2026-09-11, on an earlier draft of
 * this docblock that claimed it answered "was this diver aboard"). A diver
 * checks in at 06:40 and is seasick on the ramp; or is checked in and then held
 * at the rail on a medical flag; or is bumped to the afternoon boat when the
 * morning one is overbooked. Three ordinary mornings where this predicate is
 * `true` and nobody went in the water.
 *
 * So it is a dive-day heuristic and is only ever spent as one: both callers —
 * `peopleWhoDivedBefore` (`src/db/executed-dives.ts`) and `findSimilarDivers`
 * (`src/db/divers.ts`) — use it to contradict a `no_show` the close-of-day
 * sweep wrote over a seat, never to assert a dive on its own. It lives here
 * rather than inline in either because that contradiction may not be argued
 * two ways in one codebase.
 *
 * **Who was aboard is a different question with a different table**: a standing
 * `boarded` roll-call event, which the manifest asks through
 * `listDepartureBoardedBookingIds` (`src/db/manifests.ts`) and
 * `getIncidentExport` (`src/db/incident-export.ts`) reads straight out of
 * `roll_call_events` / `roll_call_crew_events`. Not this trail, and not by
 * extending it: the writer these events reach cannot touch `roll_call_events`
 * at all, on purpose (`src/lib/arrival.ts`, pinned by "puts nobody on a boat —
 * a queued arrival writes no roll-call row at all" in `src/db/check-in.test.ts`).
 * A counter tap is never the answer to "was this diver aboard".
 */
export function standingArrivalIsArrived(
  shopId: string,
  bookingIdColumn: AnyColumn,
  tripIdColumn: AnyColumn,
): SQL<boolean> {
  return sql<boolean>`(
    select standing.status = 'arrived' and standing.display_token_id is null
    from ${bookingArrivalEvents} as standing
    where standing.shop_id = ${shopId}
      and standing.trip_id = ${tripIdColumn}
      and standing.booking_id = ${bookingIdColumn}
    order by standing.occurred_at desc, standing.created_at desc, standing.seq desc
    limit 1
  )`;
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
 * `occurred_at`, `created_at`, `seq`, the ordering `standingArrivalIsArrived`
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
