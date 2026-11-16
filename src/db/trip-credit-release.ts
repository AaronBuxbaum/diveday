import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookings, tripCreditEntries, trips } from "./schema";
import { lockTripCreditPerson } from "./trip-credit-ledger";

/** Shared seat-release primitive. Never grants new value or returns a cash receipt. */
export async function releaseTripCreditForBooking(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
  releaseActiveCoverage = false,
): Promise<{ returnedCents: number; currentCreditReturned: boolean }> {
  await boundLockWaits(tx);
  const [booking] = await tx
    .select({ personId: bookings.personId, status: bookings.status, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.id, bookingId)))
    .for("update");
  if (!booking) return { returnedCents: 0, currentCreditReturned: false };
  const [trip] = await tx
    .select({ status: trips.status })
    .from(trips)
    // diveday:allow-deleted-trips: restoring historical promotional value must also work for cancelled seats on a deleted rehearsal.
    .where(and(eq(trips.shopId, shopId), eq(trips.id, booking.tripId)));
  const cancellation = booking.status === "cancelled" || trip?.status === "cancelled";
  if (!releaseActiveCoverage && !cancellation)
    return { returnedCents: 0, currentCreditReturned: false };
  const debits = await tx
    .select()
    .from(tripCreditEntries)
    .where(
      and(
        eq(tripCreditEntries.shopId, shopId),
        eq(tripCreditEntries.bookingId, bookingId),
        eq(tripCreditEntries.kind, "redeem"),
      ),
    )
    .orderBy(asc(tripCreditEntries.seq));
  if (!debits.length) return { returnedCents: 0, currentCreditReturned: false };
  // NOWAIT avoids inversion with identity merge. An erased beneficiary cannot
  // spend value, but cancelling still restores the economic record without PII.
  await lockTripCreditPerson(tx, shopId, booking.personId);
  let returnedCents = 0;
  for (const debit of debits) {
    if (debit.personId !== booking.personId) throw new Error("trip_credit_beneficiary_mismatch");
    const inserted = await tx
      .insert(tripCreditEntries)
      .values({
        id: randomUUID(),
        shopId,
        personId: debit.personId,
        currency: debit.currency,
        kind: "restore",
        amountCents: debit.amountCents,
        bookingId,
        restoresEntryId: debit.id,
        actorPersonId: null,
      })
      .onConflictDoNothing()
      .returning({ id: tripCreditEntries.id });
    if (inserted.length) returnedCents += debit.amountCents;
  }
  const payment = await getBookingPayment(tx, shopId, bookingId);
  const currentDebit = debits.find(
    (debit) => debit.id === payment?.providerRef && debit.currency === payment?.currency,
  );
  if (currentDebit && payment?.provider === "trip_credit") {
    await setBookingPayment(tx, {
      shopId,
      bookingId,
      status: "unpaid",
      amountCents: null,
      currency: payment.currency,
      provider: cancellation ? "trip_credit_returned" : null,
      providerRef: cancellation ? currentDebit.id : null,
      operation: "trip_credit_released",
    });
    return { returnedCents, currentCreditReturned: cancellation };
  }
  // Historical debits alone say nothing about the current cancellation. The
  // marker is retired on reactivation and superseded by any later money source.
  return {
    returnedCents,
    currentCreditReturned: Boolean(
      cancellation && currentDebit && payment?.provider === "trip_credit_returned",
    ),
  };
}

/** A new life for a seat must not inherit the previous cancellation's credit story. */
export async function resetReturnedTripCreditForReopenedBooking(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
) {
  const payment = await getBookingPayment(tx, shopId, bookingId);
  if (payment?.provider !== "trip_credit_returned") return;
  await setBookingPayment(tx, {
    shopId,
    bookingId,
    status: "unpaid",
    amountCents: null,
    currency: payment.currency,
    provider: null,
    providerRef: null,
    operation: "trip_credit_reopened",
  });
}
