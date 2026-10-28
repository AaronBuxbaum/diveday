import { and, eq } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { bookings, people } from "./schema";
import { livePerson } from "./trips-live";

/**
 * Keep erasure and a provider invocation in one order. Erasure takes the
 * exclusive boarding/evidence lock before it locks a person; sends take the
 * shared form first, then the person, then the booking. The provider callback
 * runs while those locks remain held, so an erasure either wins first and
 * suppresses the send, or commits after the provider invocation has finished.
 */
export async function withErasureCoordinatedBookingSend<T>(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    expectedPersonId: string;
    expectedTripId?: string;
    expectedEmail?: string | null;
    expectedPhone?: string | null;
    allowCancelled?: boolean;
  },
  send: (tx: DbExecutor) => Promise<T>,
): Promise<T | null> {
  const coordinate = async (tx: DbExecutor) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const [recipient] = await tx
      .select({
        personId: people.id,
        tripId: bookings.tripId,
        email: people.email,
        phone: people.phone,
        deletedAt: people.deletedAt,
        anonymizedAt: people.anonymizedAt,
        mergedIntoPersonId: people.mergedIntoPersonId,
      })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId), livePerson()))
      // Match erasure's person-before-booking ordering, but do not lock the
      // booking until after the subject identity and contact have been checked.
      .for("update", { of: people });
    if (
      !recipient ||
      recipient.deletedAt ||
      recipient.anonymizedAt ||
      recipient.mergedIntoPersonId ||
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
      (booking.status === "cancelled" && !input.allowCancelled)
    )
      return null;

    return send(tx);
  };
  return isTransactionExecutor(db) ? coordinate(db) : db.transaction(coordinate);
}

/**
 * Serialize a person-scoped provider send with erasure. The evidence advisory
 * lock comes first, matching merge and erasure; the person row then protects
 * both the send and its tracking writes until commit.
 */
export async function withErasureCoordinatedPersonSend<T>(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    expectedEmail?: string | null;
    expectedPhone?: string | null;
  },
  send: (tx: DbExecutor) => Promise<T>,
): Promise<T | null> {
  const coordinate = async (tx: DbExecutor) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const [person] = await tx
      .select({
        id: people.id,
        email: people.email,
        phone: people.phone,
        deletedAt: people.deletedAt,
        anonymizedAt: people.anonymizedAt,
        mergedIntoPersonId: people.mergedIntoPersonId,
      })
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId), livePerson()))
      .for("no key update")
      .limit(1);
    if (
      !person ||
      person.deletedAt ||
      person.anonymizedAt ||
      person.mergedIntoPersonId ||
      (input.expectedEmail !== undefined && person.email !== input.expectedEmail) ||
      (input.expectedPhone !== undefined && person.phone !== input.expectedPhone)
    )
      return null;
    return send(tx);
  };
  return isTransactionExecutor(db) ? coordinate(db) : db.transaction(coordinate);
}
