import { and, countDistinct, eq, inArray, ne } from "drizzle-orm";
import { composeMovePreflight, type MovePreflight } from "@/lib/move-preflight";
import type { AppDb } from "./client";
import { countOpenTripGearReservations } from "./gear";
import { countTripOrders } from "./orders";
import { bookings, notificationDeliveries, type notificationKind, trips } from "./schema";
import { crewMoveConflicts } from "./trips-crew";
import { liveTrip } from "./trips-live";
import { countRollCallEvidence } from "./trips-schedule";

/**
 * **The facts behind the schedule builder's move preview** (issue #1203, D43).
 *
 * Every consequence here is read through the reader the real path already uses
 * — `countRollCallEvidence` is `moveTrip`'s own guard, and the gear count
 * shares its predicate with `rewindowTripGearReservations`. That is the whole
 * design constraint: a preview that reimplemented "who has been emailed" would
 * drift from what actually sends, and a wrong preview is worse than none.
 *
 * **Reads only.** No statement in this module writes, and nothing the move does
 * is conditioned on what it returned. See `src/lib/move-preflight.ts` for why
 * the gear line in particular is phrased as what travels rather than what is
 * available.
 */
export async function getMovePreflight(
  db: AppDb,
  shopId: string,
  tripId: string,
  /**
   * Where the departure is being moved to — the exact instant, and the shop's
   * zone the move will shift its other legs in. Omitted while the Move panel's
   * fields still hold the departure's own date and time, which is how it opens.
   *
   * **The one time-dependent fact here** (issue #1310). Every other
   * consequence is a property of the departure and is the same wherever it
   * lands, so the panel could fetch them once on mount; a crew clash has to be
   * re-read for each time a staff member picks, and the *time* matters as much
   * as the date — a morning boat and an afternoon boat on one day are an
   * ordinary double shift, and only the overlap is a problem. Passing the
   * target in, rather than adding a second round trip beside this one, keeps
   * the preview a single answer that cannot half-update, at the cost of
   * re-running four cheap counts on a deliberate act.
   */
  target?: { startsAt: Date; timeZone: string },
): Promise<MovePreflight | null> {
  const [trip] = await db
    .select({ status: trips.status, cancellationWindowHours: trips.cancellationWindowHours })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  // A departure that is not this shop's, or has been taken off the board, has
  // no preview — the panel simply shows its fields, exactly as it does today.
  if (!trip) return null;

  const [toldSeats, gearReserved, paidOrders, rollCallEvidence, crew] = await Promise.all([
    countToldSeats(db, shopId, tripId),
    countOpenTripGearReservations(db, shopId, tripId),
    countTripOrders(db, shopId, tripId, "paid"),
    countRollCallEvidence(db, shopId, tripId),
    target
      ? crewMoveConflicts(db, shopId, tripId, target.startsAt, target.timeZone)
      : { clashes: [], away: [] },
  ]);

  return composeMovePreflight({
    toldSeats,
    gearReserved,
    paidOrders,
    cancellationWindowHours: trip.cancellationWindowHours,
    rollCallEvidence,
    scheduled: trip.status === "scheduled",
    crewClashes: crew.clashes.map((row) => ({
      name: row.fullName,
      departure: row.otherTitle ?? "",
    })),
    crewAway: crew.away.map((row) => row.fullName),
  });
}

type DeliveryKind = (typeof notificationKind.enumValues)[number];

/**
 * **The messages that put a departure's date in front of a diver.**
 *
 * Read against the body each one actually sends, not against its name. The
 * booking confirmation was the one that mattered: `bookingConfirmationEmail`
 * prints the formatted date and time as their own paragraph
 * (`src/lib/notifications/email.ts`), so a diver holding one has been told the
 * date every bit as squarely as one holding a reminder — and confirmations are
 * the messages a departure actually accumulates, since the two reminder
 * cadences only fire inside the last week.
 *
 * {@link NOT_A_FUTURE_DATE_KINDS} carries the rest, so the classification is
 * total and a new kind added to the enum fails a test instead of being silently
 * treated as "nobody was told".
 */
const TOLD_THE_DATE_KINDS: readonly DeliveryKind[] = [
  "booking_confirmation",
  "trip_reminder_7d",
  "trip_reminder_24h",
];

/**
 * The deliveries that do **not** state a date a diver would still be planning
 * around, named rather than left to the absence of a rule.
 *
 * The waiver and trip-prep links are administrative asks — they want a
 * signature, not an arrival. The recap, the blow-out and the not-met notice all
 * speak about a departure that is already over or already off, so nothing they
 * said is invalidated by a move.
 */
const NOT_A_FUTURE_DATE_KINDS: readonly DeliveryKind[] = [
  "waiver_request",
  "readiness_link",
  "trip_recap",
  "trip_blowout",
  "trip_minimum_not_met",
];

/** Both halves, for the test that pins the classification total. */
export const DELIVERY_KIND_CLASSIFICATION = {
  toldTheDate: TOLD_THE_DATE_KINDS,
  notAFutureDate: NOT_A_FUTURE_DATE_KINDS,
} as const;

/**
 * Seats that have already been sent this departure's date — the number that
 * turns a move from a click into work, because nothing goes back out to them.
 *
 * `countDistinct` on the booking, because `notification_deliveries` holds one
 * row per (booking, kind): a diver who has had a confirmation *and* both
 * reminders is one person to write to, not three.
 */
async function countToldSeats(db: AppDb, shopId: string, tripId: string): Promise<number> {
  const [counted] = await db
    .select({ total: countDistinct(notificationDeliveries.bookingId) })
    .from(notificationDeliveries)
    .innerJoin(bookings, eq(bookings.id, notificationDeliveries.bookingId))
    .where(
      and(
        eq(notificationDeliveries.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        inArray(notificationDeliveries.kind, TOLD_THE_DATE_KINDS),
        eq(notificationDeliveries.status, "sent"),
      ),
    );
  return counted?.total ?? 0;
}
