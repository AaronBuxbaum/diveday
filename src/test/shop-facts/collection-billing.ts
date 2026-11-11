/** Synthetic money history for populated billing and mixed-payment browser states. No provider is called. */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { createBooking } from "../../db/bookings";
import { markCheckoutPaidBySessionId } from "../../db/checkouts";
import type { AppDb } from "../../db/client";
import { getBookingPayment, setBookingPayment } from "../../db/payments";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  collectionEntries,
  orderLineItems,
  orders,
  shopSubscriptions,
  shops,
  tripRequirements,
  trips,
} from "../../db/schema";
import { liveTrip } from "../../db/trips-live";
import { closePricingMonth } from "../../features/pricing-volume";
import { addMonths } from "../../lib/calendar";
import { DAY_MS } from "../../lib/clock";
import { heldAfterDepositReceipt } from "../../lib/payment-marks";
import { shopMonthBounds, utcToWallTime } from "../../lib/zoned";
import { FactRefused } from "./refusal";

/** Historical rows could have been produced at their stated times; close uses the product writer. */
export async function seedCollectionBilling(
  db: AppDb,
  shop: { id: string; timezone: string },
  actorId: string,
  now: Date,
) {
  await db
    .update(shops)
    .set({ isDemo: false, createdAt: new Date(now.getTime() - 365 * DAY_MS) })
    .where(eq(shops.id, shop.id));
  await db
    .insert(shopSubscriptions)
    .values({
      shopId: shop.id,
      pricingPlan: "percent_of_volume",
      pricingPlanSource: "override",
      planMonthlyCents: 0,
      planBasisPoints: 300,
    })
    .onConflictDoUpdate({
      target: shopSubscriptions.shopId,
      set: {
        pricingPlan: "percent_of_volume",
        pricingPlanSource: "override",
        assignedPricingPlan: "percent_of_volume",
        planMonthlyCents: 0,
        planBasisPoints: 300,
        freeTermEndsOn: null,
      },
    });
  const wall = utcToWallTime(now, shop.timezone);
  const current = { year: wall.year, month: wall.month };
  const previous = addMonths(current, -1);
  const first = addMonths(current, -2);
  const at = (month: typeof current) =>
    new Date(shopMonthBounds(month, shop.timezone).from.getTime() + 14 * DAY_MS);
  const historical: Array<{ gross: number; held: number; currency: string; at: Date }> = [
    { gross: 10_000, held: 5_000, currency: "usd", at: at(first) },
    { gross: 10_000, held: 10_000, currency: "usd", at: at(previous) },
    { gross: 7_000, held: 7_000, currency: "usd", at: now },
    { gross: 5_000, held: 5_000, currency: "jpy", at: now },
  ];
  for (const item of historical) {
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: actorId,
        createdByPersonId: actorId,
        collection: item.held < item.gross ? "stripe_invoice" : "cash",
        ...(item.held < item.gross
          ? {
              stripeAccountId: "acct_visual_history",
              stripeCustomerId: "cus_visual_history",
              stripeInvoiceId: "in_visual_history",
            }
          : {}),
        status: item.held < item.gross ? "partly_refunded" : "paid",
        currency: item.currency,
        totalCents: item.gross,
        amountPaidCents: item.held,
        refundedCents: item.gross - item.held,
        paidAt: item.at,
        refundedAt: item.held < item.gross ? at(previous) : null,
      })
      .returning();
    if (!order) throw new FactRefused("not_available");
    await db.insert(orderLineItems).values({
      shopId: shop.id,
      orderId: order.id,
      kind: "rental",
      description: "Counter rental",
      quantity: 1,
      unitAmountCents: item.gross,
    });
    const [lot] = await db
      .insert(collectionEntries)
      .values({
        shopId: shop.id,
        sourceType: "order",
        sourceId: order.id,
        currency: item.currency,
        method: order.collection,
        amountCents: item.gross,
        evidence: { originalTaxCents: 0, originalPassThroughCents: 0 },
        recordedAt: item.at,
        createdAt: item.at,
      })
      .returning();
    if (!lot) throw new FactRefused("not_available");
    if (item.held < item.gross)
      await db.insert(collectionEntries).values({
        shopId: shop.id,
        sourceType: "order",
        sourceId: order.id,
        currency: item.currency,
        method: "cash",
        amountCents: item.held - item.gross,
        reversesEntryId: lot.id,
        evidence: {},
        recordedAt: at(previous),
        createdAt: at(previous),
      });
  }
  const terms = { plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 } as const;
  await closePricingMonth(db, {
    shopId: shop.id,
    month: first,
    currency: "usd",
    timeZone: shop.timezone,
    freeUntil: null,
    terms,
    now,
  });
  await closePricingMonth(db, {
    shopId: shop.id,
    month: previous,
    currency: "usd",
    timeZone: shop.timezone,
    freeUntil: null,
    terms,
    now,
  });
  return {
    currentUsdCents: 7_000,
    currentJpyCents: 5_000,
    priorFeeCents: 150,
    priorCreditCents: 150,
  };
}

async function collectionSeat(db: AppDb, shop: { id: string }, now: Date) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(eq(trips.shopId, shop.id), liveTrip(), gt(trips.startsAt, now), isNull(trips.courseId)),
    )
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(1);
  if (!trip) throw new FactRefused("not_available");
  await db
    .update(trips)
    .set({ priceCents: 12_000 })
    .where(and(eq(trips.shopId, shop.id), eq(trips.id, trip.id)));
  await db
    .update(tripRequirements)
    .set({ requiresPayment: true })
    .where(and(eq(tripRequirements.shopId, shop.id), eq(tripRequirements.tripId, trip.id)));
  const seated = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Casey Colton",
    email: "casey-collection@example.test",
  });
  if (!seated.ok) throw new FactRefused(seated.reason);
  return { tripId: trip.id, bookingId: seated.bookingId, name: "Casey Colton" };
}

export async function seedCashReceipt(db: AppDb, shop: { id: string }, actorId: string, now: Date) {
  const fact = await collectionSeat(db, shop, now);
  await setBookingPayment(db, {
    shopId: shop.id,
    bookingId: fact.bookingId,
    status: "paid",
    currency: "usd",
    amountCents: 12_000,
    method: "cash",
    recordedByPersonId: actorId,
  });
  return fact;
}

export async function seedMixedDeposit(db: AppDb, shop: { id: string }, now: Date) {
  const fact = await collectionSeat(db, shop, now);
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId: shop.id,
      tripId: fact.tripId,
      stripeAccountId: "acct_visual_collection",
      stripeSessionId: `cs_visual_${fact.bookingId}`,
      currency: "usd",
      amountPerDiverCents: 5_000,
      totalCents: 5_000,
      isDeposit: true,
    })
    .returning();
  if (!checkout) throw new FactRefused("not_available");
  await db.insert(bookingCheckoutBookings).values({
    shopId: shop.id,
    checkoutId: checkout.id,
    bookingId: fact.bookingId,
    tripCents: 5_000,
  });
  await markCheckoutPaidBySessionId(
    db,
    checkout.stripeSessionId,
    checkout.stripeAccountId,
    5_000,
    0,
  );
  return fact;
}

/** Mixed receipt ready for the external-return control, using the product writer. */
export async function seedMixedCashReceipt(
  db: AppDb,
  shop: { id: string },
  actorId: string,
  now: Date,
) {
  const fact = await seedMixedDeposit(db, shop, now);
  const previous = await getBookingPayment(db, shop.id, fact.bookingId);
  if (!previous) throw new FactRefused("not_available");
  await setBookingPayment(db, {
    shopId: shop.id,
    bookingId: fact.bookingId,
    status: "paid",
    currency: "usd",
    ...heldAfterDepositReceipt(previous, { kind: "money", amountCents: 7_000, method: "cash" }),
    recordedByPersonId: actorId,
  });
  return fact;
}
