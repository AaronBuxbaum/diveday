import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { buildTripManifest, type TripManifest } from "@/lib/manifests";
import type { AppDb } from "./client";
import { listTripGearAssignments } from "./gear";
import { getTripRoster, getTripWithBooked } from "./queries";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { bookings, people, personRoles, rollCallEvents, tripAssignments, trips } from "./schema";

async function listTripCrew(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ person: people, role: personRoles.role })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(people.fullName));
  const byId = new Map<string, { fullName: string; roles: string[] }>();
  for (const { person, role } of rows) {
    const crew = byId.get(person.id) ?? { fullName: person.fullName, roles: [] };
    crew.roles.push(role);
    byId.set(person.id, crew);
  }
  return [...byId.values()];
}

async function listLatestRollCallByBooking(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ event: rollCallEvents, recorder: people })
    .from(rollCallEvents)
    .innerJoin(people, eq(people.id, rollCallEvents.recordedByPersonId))
    .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)))
    .orderBy(desc(rollCallEvents.createdAt));
  const latest = new Map<
    string,
    {
      state: "boarded" | "not_boarded";
      occurredAt: Date;
      recordedByName: string;
      note: string | null;
    }
  >();
  for (const { event, recorder } of rows) {
    if (!latest.has(event.bookingId)) {
      latest.set(event.bookingId, {
        state: event.status,
        occurredAt: event.occurredAt,
        recordedByName: recorder.fullName,
        note: event.note,
      });
    }
  }
  return latest;
}

/**
 * The manifest is a derived safety view, never a separate roster people can
 * accidentally edit out of sync. Every active booking starts from the trip
 * roster and is joined with the shared readiness, gear, and roll-call records.
 */
export async function getTripManifest(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripManifest | null> {
  const trip = await getTripWithBooked(db, shopId, tripId);
  if (!trip) return null;
  const [roster, readinessRows, gearRows, crew, rollCallByBooking] = await Promise.all([
    getTripRoster(db, tripId),
    listTripReadiness(db, shopId, tripId),
    listTripGearAssignments(db, shopId, tripId),
    listTripCrew(db, shopId, tripId),
    listLatestRollCallByBooking(db, shopId, tripId),
  ]);
  const readinessByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.readiness] as const),
  );
  const gearByBooking = new Map<string, { label: string; type: string }[]>();
  for (const row of gearRows) {
    if (!row.item) continue;
    const current = gearByBooking.get(row.booking.id) ?? [];
    current.push({ label: row.item.label, type: row.item.type.replace("_", " ") });
    gearByBooking.set(row.booking.id, current);
  }
  return buildTripManifest({
    trip: {
      id: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
    },
    crew,
    divers: roster.map(({ booking, person }) => ({
      bookingId: booking.id,
      fullName: person.fullName,
      email: person.email,
      emergencyContactName: person.emergencyContactName,
      emergencyContactPhone: person.emergencyContactPhone,
      readiness: readinessByBooking.get(booking.id),
      gear: gearByBooking.get(booking.id) ?? [],
      rollCall: rollCallByBooking.get(booking.id),
    })),
  });
}

export type RecordRollCallOutcome =
  | { ok: true; eventId: string }
  | {
      ok: false;
      reason: "booking_unavailable" | "staff_not_found" | "not_ready";
    };

/**
 * Roll call is append-only operational history. A boarded event has an
 * additional hard gate: the same readiness service used elsewhere must prove
 * the diver ready at the exact moment staff tries to board them.
 */
export async function recordRollCall(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    recordedByPersonId: string;
    status: "boarded" | "not_boarded";
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordRollCallOutcome> {
  return db.transaction(async (tx): Promise<RecordRollCallOutcome> => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "booking_unavailable" };

    if (input.status === "boarded") {
      const readiness = await getBookingReadiness(tx, input.shopId, booking.id);
      if (readiness?.status !== "ready") return { ok: false, reason: "not_ready" };
    }

    const [event] = await tx
      .insert(rollCallEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: input.status,
        note: input.note?.trim() || null,
        occurredAt: input.occurredAt ?? new Date(),
      })
      .returning({ id: rollCallEvents.id });
    if (!event) throw new Error("recordRollCall: insert returned no row");
    return { ok: true, eventId: event.id };
  });
}
