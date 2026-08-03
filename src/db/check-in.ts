import { and, asc, count, eq, gte, ilike, inArray, lte, ne, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { arrivalsWindow } from "@/lib/operational-window";
import type { ReadinessResult } from "@/lib/readiness";
import type { AppDb, DbExecutor } from "./client";
import { listDepartureBoardedBookingIds } from "./manifests";
import { getBookingReadiness, listTripsReadiness } from "./readiness";
import { activityEvents, bookings, people, personRoles, trips } from "./schema";

const STAFF_ROLES = ["owner", "manager", "instructor", "divemaster", "captain", "crew"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CheckInQueueRow = {
  bookingId: string;
  personId: string;
  personName: string;
  email: string | null;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  bookingStatus: "booked" | "checked_in";
  readiness: ReadinessResult;
  /**
   * The diver's latest departure roll-call record on the manifest is
   * "boarded". Check-in and boarding are two different questions — arrived
   * vs. aboard — and `checked_in` used to have exactly one reader in the app
   * (this queue itself never showed boarding). See `checkedIn` on
   * `ManifestDiverInput` for the manifest's half of the same fix (task 149,
   * UX persona lens 17).
   */
  boarded: boolean;
};

/**
 * The counter queue is intentionally a bounded, day-of read: the arrivals lens
 * on the shared operational horizon (`src/lib/operational-window.ts`), never a
 * freestanding window of its own. A scanner that types a booking id into the
 * search box gets the same result as a name/email search, while the default
 * view stays small enough to use one-handed on a phone. Readiness always comes
 * from the shared service, never a second gate.
 */
export async function listCheckInQueue(
  db: AppDb,
  shopId: string,
  options: { query?: string; now?: Date } = {},
): Promise<CheckInQueueRow[]> {
  const now = options.now ?? nowDate();
  const arrivals = arrivalsWindow(now);
  const query = options.query?.trim() ?? "";
  const queryFilter = query
    ? or(
        ilike(people.fullName, `%${query}%`),
        ilike(people.email, `%${query}%`),
        UUID_RE.test(query) ? eq(bookings.id, query) : undefined,
      )
    : undefined;
  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      personName: people.fullName,
      email: people.email,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      bookingStatus: bookings.status,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        inArray(bookings.status, ["booked", "checked_in"]),
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
        queryFilter,
      ),
    )
    .orderBy(asc(trips.startsAt), asc(people.fullName));

  const tripIds = [...new Set(rows.map((row) => row.tripId))];
  const readinessByBooking = new Map<string, ReadinessResult>();
  const readinessRows = await listTripsReadiness(db, shopId, tripIds, now);
  for (const row of readinessRows) {
    readinessByBooking.set(row.booking.id, row.readiness);
  }
  const boardedBookingIds = await listDepartureBoardedBookingIds(db, shopId, tripIds);

  return rows.map((row) => ({
    ...row,
    bookingStatus: row.bookingStatus as "booked" | "checked_in",
    boarded: boardedBookingIds.has(row.bookingId),
    readiness: readinessByBooking.get(row.bookingId) ?? {
      status: "blocked",
      blockers: [{ code: "readiness_unavailable" }],
    },
  }));
}

export type WalkInTripOption = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
};

/**
 * Trips a counter walk-in can be added to — the same arrivals window
 * `listCheckInQueue` reads (`arrivalsWindow`), so "today's departures" means
 * the same thing on both halves of this surface.
 */
export async function listWalkInTrips(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<WalkInTripOption[]> {
  const arrivals = arrivalsWindow(now);
  return db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      capacity: trips.capacity,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
}

export type CheckInOutcome =
  | { ok: true; bookingId: string; personName: string; duplicate?: boolean }
  | {
      ok: false;
      reason: "not_found" | "already_checked_in" | "not_bookable" | "not_ready" | "staff_not_found";
      blockers?: ReadinessResult["blockers"];
      // Only set on `not_ready` — the caller needs it to link straight back to
      // the diver's guest row (`trips/[id]/guests#booking-<id>`), the same
      // rich-link pattern the manifest's `not_ready` refusal already uses.
      tripId?: string;
    };

/**
 * Record a counter check-in atomically. A successful check-in is not boarding:
 * the manifest still performs its own departure-time readiness gate. This
 * mutation only closes the arrival queue and leaves an activity trail.
 */
export async function checkInBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; recordedByPersonId: string; now?: Date },
): Promise<CheckInOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, STAFF_ROLES),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        tripStatus: trips.status,
        personId: people.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!booking) return { ok: false, reason: "not_found" };
    if (booking.status === "checked_in") {
      return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
    }
    if (booking.status !== "booked" || booking.tripStatus !== "scheduled") {
      return { ok: false, reason: "not_bookable" };
    }

    const readiness = await getBookingReadiness(tx as DbExecutor, input.shopId, booking.id);
    if (readiness?.status !== "ready") {
      return {
        ok: false,
        reason: "not_ready",
        blockers: readiness?.blockers,
        tripId: booking.tripId,
      };
    }

    const [updated] = await tx
      .update(bookings)
      .set({ status: "checked_in" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_bookable" };

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      actorPersonId: staff.id,
      message: `${booking.personName} checked in at the counter`,
      occurredAt: now,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}
