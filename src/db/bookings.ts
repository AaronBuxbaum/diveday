import { and, count, eq, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { hasVerifiedCertificationAtLeast } from "@/lib/readiness";
import type { AppDb } from "./client";
import {
  bookings,
  certifications,
  courses,
  people,
  personRoles,
  tripAssignments,
  trips,
} from "./schema";

export type BookingRequest = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
  buddyPreference?: string;
};

export type BookingOutcome =
  | { ok: true; bookingId: string; personName: string }
  | {
      ok: false;
      reason:
        | "trip_unavailable"
        | "trip_full"
        | "already_booked"
        | "course_unstaffed"
        | "course_prerequisite";
    };

export type BookingPartyOutcome =
  | { ok: true; bookings: Array<{ bookingId: string; personName: string }> }
  | Exclude<BookingOutcome, { ok: true }>;

/**
 * The whole "grab a spot" operation in one transaction: trip must be
 * scheduled and in the future, capacity re-checked inside the transaction
 * (the UI's spots-left pill is advisory, this is the enforcement), person
 * dedupe by email within the shop, and a cancelled booking re-activates
 * instead of violating the one-booking-per-person constraint.
 */
export async function createBooking(db: AppDb, req: BookingRequest): Promise<BookingOutcome> {
  return db.transaction((tx) => createBookingRecord(tx as unknown as AppDb, req));
}

/** Books every named diver as one all-or-nothing party reservation. */
export async function createBookingParty(
  db: AppDb,
  requests: BookingRequest[],
): Promise<BookingPartyOutcome> {
  if (requests.length === 0) return { ok: false, reason: "trip_unavailable" };
  return db
    .transaction(async (tx) => {
      const created: Array<{ bookingId: string; personName: string }> = [];
      for (const request of requests) {
        const outcome = await createBookingRecord(tx as unknown as AppDb, request);
        if (!outcome.ok) throw new PartyBookingError(outcome.reason);
        created.push(outcome);
      }
      return { ok: true as const, bookings: created };
    })
    .catch((error: unknown) => {
      if (error instanceof PartyBookingError) return { ok: false as const, reason: error.reason };
      throw error;
    });
}

class PartyBookingError extends Error {
  constructor(public readonly reason: Exclude<BookingOutcome, { ok: true }>["reason"]) {
    super(reason);
  }
}

async function createBookingRecord(db: AppDb, req: BookingRequest): Promise<BookingOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();
  const tx = db;
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId)))
    .limit(1);
  if (trip?.status !== "scheduled" || trip.startsAt <= nowDate()) {
    return { ok: false, reason: "trip_unavailable" };
  }

  const [course] = trip.courseId
    ? await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, req.shopId)))
        .limit(1)
    : [];
  // A course session is unsafe to market as open until an instructor is on
  // the session. This is a booking gate, not a cosmetic staff warning.
  if (course) {
    const [instructor] = await tx
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
      .where(and(eq(tripAssignments.tripId, trip.id), eq(personRoles.role, "instructor")))
      .limit(1);
    if (!instructor) return { ok: false, reason: "course_unstaffed" };
  }

  let [person] = await tx
    .select()
    .from(people)
    .where(and(eq(people.shopId, req.shopId), eq(people.email, email)))
    .limit(1);

  // Existing-card courses deliberately fail closed at enrollment. Staff can
  // capture and verify a card, then the same public form will admit the
  // diver; we never reserve capacity based on a self-assertion.
  if (course?.minimumCertificationLevel) {
    if (!person) return { ok: false, reason: "course_prerequisite" };
    const cardRows = await tx
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, req.shopId),
          eq(certifications.personId, person.id),
          isNull(certifications.deletedAt),
        ),
      );
    if (!hasVerifiedCertificationAtLeast(cardRows, course.minimumCertificationLevel)) {
      return { ok: false, reason: "course_prerequisite" };
    }
  }

  const [row] = await tx
    .select({ booked: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
  if ((row?.booked ?? 0) >= trip.capacity) {
    return { ok: false, reason: "trip_full" };
  }

  if (!person) {
    [person] = await tx
      .insert(people)
      .values({ shopId: req.shopId, fullName, email, phone: req.phone })
      .returning();
    if (!person) throw new Error("createBooking: person insert returned no row");
    await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
  }

  const [existing] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)))
    .limit(1);
  if (existing) {
    if (existing.status !== "cancelled") return { ok: false, reason: "already_booked" };
    await tx
      .update(bookings)
      .set({
        status: "booked",
        buddyPreference: req.buddyPreference || null,
        conditionsBriefedAt: trip.conditionsUpdatedAt,
      })
      .where(eq(bookings.id, existing.id));
    return { ok: true, bookingId: existing.id, personName: person.fullName };
  }

  const [created] = await tx
    .insert(bookings)
    .values({
      shopId: req.shopId,
      tripId: trip.id,
      personId: person.id,
      buddyPreference: req.buddyPreference || null,
      conditionsBriefedAt: trip.conditionsUpdatedAt,
    })
    .returning();
  if (!created) throw new Error("createBooking: booking insert returned no row");
  return { ok: true, bookingId: created.id, personName: person.fullName };
}

/**
 * A booking on a specific trip, with its person — for the confirmation
 * panel, which must render from the database, never from URL params.
 */
export async function getBookingForTrip(db: AppDb, tripId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function restoreBooking(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .update(bookings)
    .set({ status: "booked" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .returning();
  return booking ?? null;
}

export async function cancelBooking(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .returning();
  return booking ?? null;
}
