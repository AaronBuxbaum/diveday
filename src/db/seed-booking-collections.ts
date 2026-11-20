import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { fareCheckout } from "./checkout-purpose";
import type { DbExecutor } from "./client";
import { recordCheckoutCollection } from "./collection-ledger";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  collectionEntries,
  orders,
} from "./schema";

/** Cash-like marks and the completed promo checkout, without counting a fare twice. */
export async function seedBookingCollections(
  db: DbExecutor,
  shopId: string,
  actorId: string,
): Promise<void> {
  const paidCheckouts = await db
    .select({ checkout: bookingCheckouts, bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckouts)
    .innerJoin(bookingCheckoutBookings, eq(bookingCheckoutBookings.checkoutId, bookingCheckouts.id))
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        fareCheckout(),
        eq(bookingCheckouts.status, "completed"),
      ),
    );
  for (const { checkout, bookingId } of paidCheckouts) {
    if (checkout.settledTotalCents === null || !checkout.completedAt) continue;
    // The original fixture marked this seat manually and later gave it a
    // discounted checkout. One receipt owns both the payment and its ledger.
    await db
      .update(bookingPaymentEvents)
      .set({
        provider: "stripe",
        providerRef: checkout.stripeSessionId,
        operation: "checkout_settled",
        amountCents: checkout.settledTotalCents,
        manualHeldCents: 0,
        occurredAt: checkout.completedAt,
        createdAt: checkout.completedAt,
      })
      .where(
        and(
          eq(bookingPaymentEvents.shopId, shopId),
          eq(bookingPaymentEvents.bookingId, bookingId),
          isNull(bookingPaymentEvents.provider),
        ),
      );
    await recordCheckoutCollection(db, shopId, checkout.id);
  }
  const paid = await db
    .select()
    .from(bookingPayments)
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        isNull(bookingPayments.provider),
        inArray(bookingPayments.status, ["paid", "deposit_paid"]),
      ),
    );
  const invoiced = await db
    .select({ bookingId: orders.bookingId })
    .from(orders)
    .where(eq(orders.shopId, shopId));
  const invoiceSeats = new Set(invoiced.map((row) => row.bookingId));
  const checkoutSeats = new Set(paidCheckouts.map((row) => row.bookingId));
  const manual = paid.filter(
    (payment) =>
      payment.amountCents !== null &&
      payment.amountCents > 0 &&
      !invoiceSeats.has(payment.bookingId) &&
      !checkoutSeats.has(payment.bookingId),
  );
  if (!manual.length) return;
  // One statement for every manual mark rather than one per seat (#4763).
  const marks = sql.join(
    manual.map(
      (payment) =>
        sql`(${payment.id}::uuid, ${payment.amountCents ?? 0}::integer, ${payment.method ?? "other"}::manual_payment_method, ${payment.recordedByPersonId ?? actorId}::uuid)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    update ${bookingPaymentEvents}
    set manual_held_cents = mark.held, method = mark.method, recorded_by_person_id = mark.recorded_by
    from (values ${marks}) as mark(id, held, method, recorded_by)
    where ${bookingPaymentEvents.id} = mark.id`);
  await db.insert(collectionEntries).values(
    manual.map((payment) => ({
      shopId,
      sourceType: "booking" as const,
      sourceId: payment.bookingId,
      currency: payment.currency,
      method: payment.method ?? "other",
      amountCents: payment.amountCents ?? 0,
      evidence: { paymentEntryId: payment.id, taxSplitRecorded: false, stripeProviderRef: null },
      recordedAt: payment.updatedAt,
      createdAt: payment.updatedAt,
    })),
  );
}
