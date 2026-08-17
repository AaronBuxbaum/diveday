import { and, asc, count, eq, gt, gte, ilike, inArray, lte, ne, or } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { arrivalsWindow } from "@/lib/operational-window";
import type { ReadinessResult } from "@/lib/readiness";
import { isUuid } from "@/lib/uuid";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { listDepartureBoardedBookingIds } from "./manifests";
import { getBookingReadiness, listTripsReadiness } from "./readiness";
import { activityEvents, bookings, people, trips } from "./schema";

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
        isUuid(query) ? eq(bookings.id, query) : undefined,
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
        // A walk-in can only be seated on a departure that has not started.
        // The check-in queue deliberately includes its short look-back window;
        // reusing that lower bound here offered a boat already underway and
        // made the picker hand a valid-looking choice to a refusal.
        gte(trips.startsAt, now),
        lte(trips.startsAt, arrivals.to),
      ),
    )
    .groupBy(trips.id)
    .having(gt(trips.capacity, count(bookings.id)))
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
 * The `people.id` of the staff member **behind the counter**, or `null` when
 * whoever is claiming to check this diver in is not this shop's live staff
 * right now.
 *
 * This used to be a hand-rolled `person_roles` join here, against a local copy
 * of `STAFF_ROLES` — `people.id` / `people.shopId` / `person_roles.role` and
 * nothing else. It catches what it was written for (a diver, or somebody
 * demoted out of every staff role) and misses the two cases
 * `loadActiveStaffRoles` exists for: a **deleted** person, because
 * `deleteDiver` sets `people.deleted_at` and leaves every role row where it is,
 * and a **disabled** account, because `setStaffAccountStatus` revokes sign-in
 * and leaves `person_roles` entirely intact — a suspended employee keeps every
 * role row they had. Both moved a booking to `checked_in` and signed the
 * activity trail with their name.
 *
 * `src/db/authz.ts` is the one place the rule lives; `loadActiveStaffRoles`
 * takes a `DbExecutor`, so it composes inside this transaction unchanged. Same
 * shape as `activeStaffRecorderId` in `src/db/manifests.ts`.
 */
async function activeStaffRecorderId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

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
    const recordedBy = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

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
      actorPersonId: recordedBy,
      message: `${booking.personName} checked in at the counter`,
      occurredAt: now,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}

export type UndoCheckInOutcome =
  | { ok: true; bookingId: string; personName: string; duplicate?: boolean }
  | { ok: false; reason: "not_found" | "not_checked_in" | "staff_not_found" };

/**
 * Clear a counter check-in — the re-tap half of the queue's one-tap row
 * (design principle 7: a high-frequency toggle gets re-tap undo, never a
 * blocking confirm). The correction is its own activity-trail event, the same
 * rule roll call follows: the trail keeps both taps, never deletes one.
 *
 * This only reopens the arrival queue. It never touches the manifest — a
 * boarding recorded at roll call stands on its own record, exactly as a
 * check-in never implied boarding in the first place.
 */
export async function undoCheckInBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; recordedByPersonId: string; now?: Date },
): Promise<UndoCheckInOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const recordedBy = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!booking) return { ok: false, reason: "not_found" };
    // A double-tap of the undo (two devices, a stale tab) finds the work
    // already done — same idempotence contract as checkInBooking.
    if (booking.status === "booked") {
      return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
    }
    if (booking.status !== "checked_in") return { ok: false, reason: "not_checked_in" };

    const [updated] = await tx
      .update(bookings)
      .set({ status: "booked" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "checked_in")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_checked_in" };

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      actorPersonId: recordedBy,
      message: `${booking.personName}'s counter check-in was undone`,
      occurredAt: now,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}
