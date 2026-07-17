import { and, count, eq, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, people, personRoles, trips } from "./schema";

export type BookingRequest = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
};

export type BookingOutcome =
  | { ok: true; bookingId: string; personName: string }
  | { ok: false; reason: "trip_unavailable" | "trip_full" | "already_booked" };

/**
 * The whole "grab a spot" operation in one transaction: trip must be
 * scheduled and in the future, capacity re-checked inside the transaction
 * (the UI's spots-left pill is advisory, this is the enforcement), person
 * dedupe by email within the shop, and a cancelled booking re-activates
 * instead of violating the one-booking-per-person constraint.
 */
export async function createBooking(db: AppDb, req: BookingRequest): Promise<BookingOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();

  return db.transaction(async (tx): Promise<BookingOutcome> => {
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId)))
      .limit(1);
    if (trip?.status !== "scheduled" || trip.startsAt <= new Date()) {
      return { ok: false, reason: "trip_unavailable" };
    }

    const [row] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    if ((row?.booked ?? 0) >= trip.capacity) {
      return { ok: false, reason: "trip_full" };
    }

    let [person] = await tx
      .select()
      .from(people)
      .where(and(eq(people.shopId, req.shopId), eq(people.email, email)))
      .limit(1);
    if (!person) {
      [person] = await tx
        .insert(people)
        .values({ shopId: req.shopId, fullName, email, phone: req.phone })
        .returning();
      if (!person) throw new Error("createBooking: person insert returned no row");
      await tx.insert(personRoles).values({ personId: person.id, role: "customer" });
    }

    const [existing] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)))
      .limit(1);
    if (existing) {
      if (existing.status !== "cancelled") return { ok: false, reason: "already_booked" };
      await tx.update(bookings).set({ status: "booked" }).where(eq(bookings.id, existing.id));
      return { ok: true, bookingId: existing.id, personName: person.fullName };
    }

    const [created] = await tx
      .insert(bookings)
      .values({ shopId: req.shopId, tripId: trip.id, personId: person.id })
      .returning();
    if (!created) throw new Error("createBooking: booking insert returned no row");
    return { ok: true, bookingId: created.id, personName: person.fullName };
  });
}
