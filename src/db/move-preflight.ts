import { and, asc, countDistinct, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import {
  composeMovePreflight,
  type MovePreflight,
  type MoveTurnaround,
  turnaroundGapMinutes,
} from "@/lib/move-preflight";
import type { AppDb } from "./client";
import { countOpenTripGearReservations } from "./gear";
import { countTripOrders } from "./orders";
import {
  boats,
  bookings,
  notificationDeliveries,
  type notificationKind,
  people,
  shops,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import {
  boatMoveClashes,
  type DepartureWindow,
  legWindow,
  proposedDepartureWindows,
} from "./trips-clashes";
import { crewMoveConflicts, getTripCrewIds } from "./trips-crew";
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
   * lands, so the panel could fetch them once on mount; a crew or boat clash has to be
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

  const [toldSeats, gearReserved, paidOrders, rollCallEvidence, crew, boat, turnarounds] =
    await Promise.all([
      countToldSeats(db, shopId, tripId),
      countOpenTripGearReservations(db, shopId, tripId),
      countTripOrders(db, shopId, tripId, "paid"),
      countRollCallEvidence(db, shopId, tripId),
      target
        ? crewMoveConflicts(db, shopId, tripId, target.startsAt, target.timeZone)
        : { clashes: [], away: [] },
      // The hull's own overlap (H-20260916-may-one-hull-carry, issue #1780), asked of the same proposed
      // windows by the same predicate the crew clash uses.
      target ? boatMoveClashes(db, shopId, tripId, target.startsAt, target.timeZone) : [],
      // The near miss beside the clash (issue #2141), against the same proposed
      // windows; quiet until a time is chosen, like the two clash lines.
      target ? moveTurnarounds(db, shopId, tripId, target.startsAt, target.timeZone) : [],
    ]);

  return composeMovePreflight({
    toldSeats,
    gearReserved,
    paidOrders,
    cancellationWindowHours: trip.cancellationWindowHours,
    rollCallEvidence,
    scheduled: trip.status === "scheduled",
    boatClashes: boat.map((row) => ({ boat: row.boatName, departure: row.otherTitle })),
    crewClashes: crew.clashes.map((row) => ({
      name: row.fullName,
      departure: row.otherTitle ?? "",
    })),
    crewAway: crew.away.map((row) => row.fullName),
    turnarounds,
  });
}

/**
 * **The tight turnarounds a move would make** (issue #2141, Aaron's decision
 * (b), 2026-10-13): other live, scheduled departures the proposed windows
 * would sit closer to than the shop's `min_turnaround_minutes`, without
 * overlapping them — on the same hull, or sharing a crew member when the two
 * departures meet in different places (the same-dock hand-off stays quiet).
 *
 * Advice only. The overlap itself is H-20260916-may-one-hull-carry's clash, asked by `boatMoveClashes`
 * and `crewMoveConflicts` through the half-open predicate; nothing here changes
 * it, refuses anything, or reaches the move's own path. Reads only, tenancy
 * through `trips.shop_id` on both sides (and `people.shop_id` for crew).
 */
async function moveTurnarounds(
  db: AppDb,
  shopId: string,
  tripId: string,
  newStartsAt: Date,
  timeZone: string,
): Promise<MoveTurnaround[]> {
  const [shop] = await db
    .select({ minTurnaroundMinutes: shops.minTurnaroundMinutes })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const minGap = shop?.minTurnaroundMinutes ?? 0;
  if (minGap <= 0) return [];
  const proposed = await proposedDepartureWindows(db, shopId, tripId, newStartsAt, timeZone);
  if (!proposed || proposed.length === 0) return [];
  const [moving] = await db
    .select({
      boatId: trips.boatId,
      boatName: boats.name,
      meetingPointLabel: trips.meetingPointLabel,
      meetingPointAddress: trips.meetingPointAddress,
    })
    .from(trips)
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!moving) return [];

  // Only legs that could sit inside the gap at either end are worth reading.
  const gapMs = minGap * 60_000;
  const from = new Date(Math.min(...proposed.map((day) => day.startsAt.getTime())) - gapMs);
  const to = new Date(Math.max(...proposed.map((day) => day.endsAt.getTime())) + gapMs);
  const leg = legWindow(tripScheduleDays, trips);
  const nearby = and(
    eq(trips.shopId, shopId),
    eq(trips.status, "scheduled"),
    ne(trips.id, tripId),
    lt(leg.startsAt, to),
    gt(leg.endsAt, from),
  );

  const turnarounds: MoveTurnaround[] = [];

  if (moving.boatId && moving.boatName) {
    const rows = await db
      .select({
        otherTripId: trips.id,
        title: trips.title,
        legStartsAt: leg.startsAt.mapWith(trips.startsAt),
        legEndsAt: leg.endsAt.mapWith(trips.endsAt),
      })
      .from(trips)
      .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
      .where(and(liveTrip(), nearby, eq(trips.boatId, moving.boatId)))
      .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
    for (const other of groupLegs(rows, (row) => row.otherTripId)) {
      const minutes = turnaroundGapMinutes(proposed, other.legs, minGap);
      if (minutes !== null) {
        turnarounds.push({ kind: "boat", name: moving.boatName, departure: other.title, minutes });
      }
    }
  }

  const crewIds = await getTripCrewIds(db, shopId, tripId);
  if (crewIds.length > 0) {
    const rows = await db
      .select({
        personId: tripAssignments.personId,
        fullName: people.fullName,
        otherTripId: trips.id,
        title: trips.title,
        meetingPointLabel: trips.meetingPointLabel,
        meetingPointAddress: trips.meetingPointAddress,
        legStartsAt: leg.startsAt.mapWith(trips.startsAt),
        legEndsAt: leg.endsAt.mapWith(trips.endsAt),
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
      .where(
        and(
          liveTrip(),
          nearby,
          inArray(tripAssignments.personId, crewIds),
          eq(people.shopId, shopId),
          isNull(people.deletedAt),
        ),
      )
      .orderBy(asc(people.fullName), asc(trips.startsAt), asc(trips.title), asc(trips.id));
    for (const other of groupLegs(rows, (row) => `${row.personId}:${row.otherTripId}`)) {
      // A hand-off on the same dock is the plan: the crew member steps off one
      // boat and onto the next. Only a different meeting point costs travel.
      if (sameMeetingPoint(moving, other.first)) continue;
      const minutes = turnaroundGapMinutes(proposed, other.legs, minGap);
      if (minutes !== null) {
        turnarounds.push({
          kind: "crew",
          name: other.first.fullName,
          departure: other.title,
          minutes,
        });
      }
    }
  }
  return turnarounds;
}

/** One entry per key, its legs gathered: the left join repeats a row per leg. */
function groupLegs<Row extends { title: string; legStartsAt: Date; legEndsAt: Date }>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): { title: string; first: Row; legs: DepartureWindow[] }[] {
  const grouped = new Map<string, { title: string; first: Row; legs: DepartureWindow[] }>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = grouped.get(key) ?? { title: row.title, first: row, legs: [] };
    entry.legs.push({ startsAt: row.legStartsAt, endsAt: row.legEndsAt });
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}

type MeetingPointColumns = {
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
};

/** Whether two departures meet in the same place: both unset is the shop's own door. */
function sameMeetingPoint(a: MeetingPointColumns, b: MeetingPointColumns): boolean {
  const clean = (value: string | null) => value?.trim().toLowerCase() || null;
  return (
    clean(a.meetingPointLabel) === clean(b.meetingPointLabel) &&
    clean(a.meetingPointAddress) === clean(b.meetingPointAddress)
  );
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
  // The reschedule notice states the new date as squarely as a reminder does.
  "trip_rescheduled",
];

/**
 * The deliveries that do **not** state a date a diver would still be planning
 * around, named rather than left to the absence of a rule.
 *
 * The waiver and trip-prep links are administrative asks — they want a
 * signature, not an arrival. The booking handoff is a link onto a booking page
 * (ADR 20260906-before-you-ask, decision 3): it names a departure the diver
 * has not booked, and the page it opens reads the live board. The recap, the
 * blow-out and the not-met notice all speak about a departure that is already
 * over or already off, and the cancellation notice about a seat that is gone,
 * so nothing they said is invalidated by a move.
 */
const NOT_A_FUTURE_DATE_KINDS: readonly DeliveryKind[] = [
  "waiver_request",
  "readiness_link",
  "booking_handoff",
  "trip_recap",
  "trip_blowout",
  "trip_minimum_not_met",
  "booking_cancelled",
];

/** Both halves, for the test that pins the classification total. */
export const DELIVERY_KIND_CLASSIFICATION = {
  toldTheDate: TOLD_THE_DATE_KINDS,
  notAFutureDate: NOT_A_FUTURE_DATE_KINDS,
} as const;

/**
 * Seats that have already been sent this departure's date — the number a move
 * now writes to: since ux review 2026-10-11 (item 1) the move holds a
 * reschedule notice for every booked seat (`src/db/trip-rescheduled.ts`), and
 * the panel says so before the staffer presses Move.
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
