import { and, eq } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { bookings, people } from "./schema";

/**
 * Keep erasure and a provider invocation in one order. Erasure takes the
 * exclusive boarding/evidence lock before it locks a person; sends take the
 * shared form first, then the person, then the booking. The provider callback
 * runs while those locks remain held, so an erasure either wins first and
 * suppresses the send, or commits after the provider invocation has finished.
 */
export async function withErasureCoordinatedBookingSend<T>(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    expectedPersonId: string;
    expectedTripId?: string;
    expectedEmail?: string | null;
    expectedPhone?: string | null;
  },
  send: (tx: DbExecutor) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const [recipient] = await tx
      .select({
        personId: people.id,
        tripId: bookings.tripId,
        email: people.email,
        phone: people.phone,
        anonymizedAt: people.anonymizedAt,
      })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      // Match erasure's person-before-booking ordering, but do not lock the
      // booking until after the subject identity and contact have been checked.
      .for("update", { of: people });
    if (
      !recipient ||
      recipient.anonymizedAt ||
      recipient.personId !== input.expectedPersonId ||
      (input.expectedTripId !== undefined && recipient.tripId !== input.expectedTripId) ||
      (input.expectedEmail !== undefined && recipient.email !== input.expectedEmail) ||
      (input.expectedPhone !== undefined && recipient.phone !== input.expectedPhone)
    ) {
      return null;
    }

    const [booking] = await tx
      .select({ personId: bookings.personId, tripId: bookings.tripId, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .for("update");
    if (
      !booking ||
      booking.personId !== input.expectedPersonId ||
      (input.expectedTripId !== undefined && booking.tripId !== input.expectedTripId) ||
      booking.status === "cancelled"
    )
      return null;

    return send(tx);
  });
}
