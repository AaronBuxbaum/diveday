import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { safeTripCreditBalance } from "@/lib/trip-credit";
import { isUuid } from "@/lib/uuid";
import type { DbExecutor } from "./client";
import { getBookingPayment } from "./payments";
import { bookings, people, tripCreditEntries } from "./schema";

/** NOWAIT avoids inversion against identity merge, which locks people before their bookings. */
export async function lockTripCreditPerson(tx: DbExecutor, shopId: string, personId: string) {
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .for("no key update", { noWait: true });
  return person ?? null;
}

export async function tripCreditBalance(
  db: DbExecutor,
  shopId: string,
  personId: string,
  currency: string,
): Promise<number | null> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${tripCreditEntries.kind} = 'redeem' then -${tripCreditEntries.amountCents} else ${tripCreditEntries.amountCents} end), 0)::text`,
    })
    .from(tripCreditEntries)
    .where(
      and(
        eq(tripCreditEntries.shopId, shopId),
        eq(tripCreditEntries.personId, personId),
        eq(tripCreditEntries.currency, currency),
      ),
    );
  return safeTripCreditBalance(row.total);
}

/** Current promotional coverage, backed by its exact debit and no restoration. */
export async function currentTripCreditCoverage(db: DbExecutor, shopId: string, bookingId: string) {
  const payment = await getBookingPayment(db, shopId, bookingId);
  if (
    payment?.provider !== "trip_credit" ||
    payment.status !== "paid" ||
    !payment.providerRef ||
    !isUuid(payment.providerRef) ||
    payment.amountCents !== 0 ||
    payment.manualHeldCents !== 0
  )
    return null;
  const restored = alias(tripCreditEntries, "current_credit_restore");
  const [row] = await db
    .select({ entry: tripCreditEntries })
    .from(tripCreditEntries)
    .innerJoin(
      bookings,
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.id, bookingId),
        eq(bookings.personId, tripCreditEntries.personId),
      ),
    )
    .leftJoin(
      restored,
      and(eq(restored.shopId, shopId), eq(restored.restoresEntryId, tripCreditEntries.id)),
    )
    .where(
      and(
        eq(tripCreditEntries.shopId, shopId),
        eq(tripCreditEntries.id, payment.providerRef),
        eq(tripCreditEntries.bookingId, bookingId),
        eq(tripCreditEntries.currency, payment.currency),
        eq(tripCreditEntries.kind, "redeem"),
        isNull(restored.id),
      ),
    );
  return row?.entry ?? null;
}
