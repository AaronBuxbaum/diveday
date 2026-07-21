import { and, asc, eq, inArray } from "drizzle-orm";
import { formatTime } from "@/lib/format";
import { collapseDiverActions, TODAY_HORIZON_MS, type TodayAction, urgencyFor } from "@/lib/today";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb } from "./client";
import { listNotificationDeliveryIssues } from "./notifications";
import { listTripReadiness } from "./readiness";
import {
  bookings,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  tripAssignments,
  tripWaitlistEntries,
} from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * How many upcoming departures the queue will inspect. Readiness is a per-trip
 * roll-up, so this bounds the work; a shop with more than this many departures
 * inside a week is served better by Schedule than by a triage list.
 */
const MAX_TRIPS = 20;

/** A departure happening today, with just enough to know whether it can sail. */
export type DepartureSummary = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  booked: number;
  capacity: number;
  ready: number;
  blocked: number;
  boarded: number;
  courseTitle: string | null;
};

export type TodayWork = {
  departures: DepartureSummary[];
  actions: TodayAction[];
  /** Shown only when nothing sails today, so the page still orients the crew. */
  nextDeparture: { tripId: string; title: string; startsAt: Date } | null;
};

function shopDay(date: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(date, timeZone));
}

function at(date: Date, timeZone: string): string {
  return formatTime(date, "en-US", timeZone);
}

/**
 * Latest departure-checkpoint roll call per booking, for every trip sailing
 * today. One query rather than a manifest build per trip: the board needs a
 * head count, not the safety document.
 */
async function boardedCountsByTrip(db: AppDb, shopId: string, tripIds: string[]) {
  const counts = new Map<string, number>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.checkpoint, "departure"),
        inArray(rollCallEvents.tripId, tripIds),
      ),
    )
    .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.createdAt));
  // Ordered oldest-first, so the last write per booking wins. A latest `cleared`
  // event is an undo, so it simply never counts as boarded below.
  const latest = new Map<
    string,
    { tripId: string; status: "boarded" | "not_boarded" | "cleared" }
  >();
  for (const row of rows) latest.set(row.bookingId, { tripId: row.tripId, status: row.status });
  for (const { tripId, status } of latest.values()) {
    if (status === "boarded") counts.set(tripId, (counts.get(tripId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Divers on an upcoming departure with no rental fit on file. The prep list is
 * derived entirely from fit, so a missing fit is a hole in tomorrow's packing
 * that nobody sees until the diver is standing at the counter.
 */
async function missingFitByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const missing = new Map<string, number>();
  if (bookingIds.length === 0) return missing;
  const rows = await db
    .select({ bookingId: bookings.id, fitId: rentalFitProfiles.id })
    .from(bookings)
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds)));
  const withoutFit = new Set(rows.filter((row) => !row.fitId).map((row) => row.bookingId));
  for (const [tripId, ids] of bookingIdsByTrip) {
    const count = ids.filter((id) => withoutFit.has(id)).length;
    if (count > 0) missing.set(tripId, count);
  }
  return missing;
}

/**
 * Divers who asked for enriched air but hold no verified nitrox card right
 * now. The request was card-gated when it was made, so a hit here means the
 * card was rejected or removed afterwards — the tank has to go back to air
 * unless someone verifies the card before the boat leaves.
 */
async function ungatedNitroxByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const ungated = new Map<string, number>();
  if (bookingIds.length === 0) return ungated;
  const rows = await db
    .select({ bookingId: bookings.id, cardId: nitroxCertifications.id })
    .from(bookings)
    .leftJoin(
      nitroxCertifications,
      and(
        eq(nitroxCertifications.personId, bookings.personId),
        eq(nitroxCertifications.shopId, bookings.shopId),
        eq(nitroxCertifications.status, "verified"),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.wantsNitrox, true),
        inArray(bookings.id, bookingIds),
      ),
    );
  const blocked = new Set(rows.filter((row) => !row.cardId).map((row) => row.bookingId));
  for (const [tripId, ids] of bookingIdsByTrip) {
    const count = ids.filter((id) => blocked.has(id)).length;
    if (count > 0) ungated.set(tripId, count);
  }
  return ungated;
}

/** Wait-list depth per trip, so a freed seat can be offered to a real person. */
async function waitlistCountsByTrip(db: AppDb, shopId: string, tripIds: string[]) {
  const counts = new Map<string, number>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({ tripId: tripWaitlistEntries.tripId })
    .from(tripWaitlistEntries)
    .where(
      and(eq(tripWaitlistEntries.shopId, shopId), inArray(tripWaitlistEntries.tripId, tripIds)),
    );
  for (const row of rows) counts.set(row.tripId, (counts.get(row.tripId) ?? 0) + 1);
  return counts;
}

/** Trips that already have an instructor on the crew list. */
async function tripsWithInstructor(db: AppDb, shopId: string, tripIds: string[]) {
  if (tripIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ tripId: tripAssignments.tripId })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "instructor"),
        inArray(tripAssignments.tripId, tripIds),
      ),
    );
  return new Set(rows.map((row) => row.tripId));
}

/**
 * Everything the Today queue needs, in one pass. Every signal is derived from a
 * source-of-truth model, so this never becomes a second place where operational
 * state is decided.
 */
export async function getTodayWork(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<TodayWork> {
  const horizon = new Date(now.getTime() + TODAY_HORIZON_MS);
  const upcoming = await upcomingTripsWithCounts(db, shopId, now);
  const inWindow = upcoming.filter((trip) => trip.startsAt <= horizon).slice(0, MAX_TRIPS);
  const today = shopDay(now, timeZone);
  const todayTrips = inWindow.filter((trip) => shopDay(trip.startsAt, timeZone) === today);

  const readinessByTrip = new Map(
    await Promise.all(
      inWindow.map(
        async (trip) => [trip.id, await listTripReadiness(db, shopId, trip.id)] as const,
      ),
    ),
  );
  const bookingIdsByTrip = new Map(
    inWindow.map((trip) => [
      trip.id,
      (readinessByTrip.get(trip.id) ?? []).map((row) => row.booking.id),
    ]),
  );

  const [boarded, missingFit, ungatedNitrox, waitlisted, staffedTrips, deliveryIssues] =
    await Promise.all([
      boardedCountsByTrip(
        db,
        shopId,
        todayTrips.map((trip) => trip.id),
      ),
      missingFitByTrip(db, shopId, bookingIdsByTrip),
      ungatedNitroxByTrip(db, shopId, bookingIdsByTrip),
      waitlistCountsByTrip(
        db,
        shopId,
        inWindow.map((trip) => trip.id),
      ),
      tripsWithInstructor(
        db,
        shopId,
        inWindow.filter((trip) => trip.course).map((trip) => trip.id),
      ),
      listNotificationDeliveryIssues(db, shopId),
    ]);

  const actions: TodayAction[] = [];

  for (const trip of inWindow) {
    const tripHref = `/shop/${shopSlug}/trips/${trip.id}`;
    const when = at(trip.startsAt, timeZone);

    const blockedDivers = (readinessByTrip.get(trip.id) ?? [])
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        tripId: trip.id,
        tripTitle: `${trip.title} · ${when}`,
        startsAt: trip.startsAt,
        blockers: row.readiness.blockers,
      }));
    actions.push(...collapseDiverActions(blockedDivers, shopSlug, now));

    const withoutFit = missingFit.get(trip.id) ?? 0;
    if (withoutFit > 0) {
      actions.push({
        id: `prep:${trip.id}`,
        kind: "dive_prep",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        detail: `${withoutFit} ${withoutFit === 1 ? "diver has" : "divers have"} no rental fit on file, so the prep list is incomplete.`,
        actionLabel: "Open prep list",
        href: `${tripHref}/prep`,
        dueAt: trip.startsAt,
      });
    }

    const ungatedCount = ungatedNitrox.get(trip.id) ?? 0;
    if (ungatedCount > 0) {
      actions.push({
        id: `nitrox:${trip.id}`,
        kind: "nitrox_gate",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        detail: `${ungatedCount} ${ungatedCount === 1 ? "diver wants" : "divers want"} enriched air without a verified card — those tanks are planned as air.`,
        actionLabel: "Open prep list",
        href: `${tripHref}/prep`,
        dueAt: trip.startsAt,
      });
    }

    if (trip.course && !staffedTrips.has(trip.id)) {
      actions.push({
        id: `instructor:${trip.id}`,
        kind: "instructor_missing",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        detail: "This course session has no instructor assigned and cannot take enrolments.",
        actionLabel: "Assign instructor",
        href: tripHref,
        dueAt: trip.startsAt,
      });
    }

    const waiting = waitlisted.get(trip.id) ?? 0;
    const openSeats = Math.max(0, trip.capacity - trip.booked);
    if (waiting > 0 && openSeats > 0) {
      actions.push({
        id: `waitlist:${trip.id}`,
        kind: "waitlist_seat",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        detail: `${openSeats} ${openSeats === 1 ? "seat" : "seats"} opened up and ${waiting} ${waiting === 1 ? "person is" : "people are"} on the wait list.`,
        actionLabel: "Offer the seat",
        href: tripHref,
        dueAt: trip.startsAt,
      });
    }
  }

  for (const issue of deliveryIssues) {
    if (issue.trip.startsAt < now || issue.trip.startsAt > horizon) continue;
    const what =
      issue.delivery.kind === "booking_confirmation" ? "booking confirmation" : "waiver link";
    actions.push({
      id: `email:${issue.delivery.id}`,
      kind: "email_delivery",
      urgency: urgencyFor(issue.trip.startsAt, now),
      subject: issue.person.fullName,
      context: `${issue.trip.title} · ${at(issue.trip.startsAt, timeZone)}`,
      detail:
        issue.delivery.status === "not_configured"
          ? `Their ${what} never sent — email is not configured.`
          : `Their ${what} could not be delivered${issue.attempts > 1 ? ` after ${issue.attempts} attempts` : ""}.`,
      actionLabel: "Open trip",
      href: `/shop/${shopSlug}/trips/${issue.trip.id}#booking-${issue.booking.id}`,
      dueAt: issue.trip.startsAt,
    });
  }

  const departures: DepartureSummary[] = todayTrips.map((trip) => {
    const rows = readinessByTrip.get(trip.id) ?? [];
    return {
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      booked: trip.booked,
      capacity: trip.capacity,
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      blocked: rows.filter((row) => row.readiness.status === "blocked").length,
      boarded: boarded.get(trip.id) ?? 0,
      courseTitle: trip.course?.title ?? null,
    };
  });

  const next = todayTrips.length === 0 ? upcoming[0] : null;

  return {
    departures,
    actions,
    nextDeparture: next ? { tripId: next.id, title: next.title, startsAt: next.startsAt } : null,
  };
}
