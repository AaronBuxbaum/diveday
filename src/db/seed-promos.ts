import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  people,
  shopPromoCodes,
  shopPromoRedemptions,
} from "./schema";
import { at } from "./seed-clock";

/**
 * Shop-wide discounts, including one settled use of REEF10. The demo never
 * connects Stripe, so its provider ids and settled amount are representative
 * fixtures only; they let the Promos page demonstrate both a live code and
 * the redemption history that follows a completed checkout.
 */
export async function seedPromos(
  db: DbExecutor,
  shopId: string,
  booking: { id: string; tripId: string } | undefined,
): Promise<void> {
  await db
    .insert(shopPromoCodes)
    .values([
      {
        shopId,
        code: "REEF10",
        description: "Standing returning-diver discount",
        discountPercent: 10,
        scope: "all" as const,
        status: "active" as const,
        stripeCouponId: "coupon_demo_reef10",
        stripePromotionCodeId: "promo_demo_reef10",
        createdAt: at(-30, 9),
      },
      {
        shopId,
        code: "OPENWATER25",
        description: "Course push — expired, kept as history",
        discountPercent: 25,
        scope: "courses" as const,
        status: "active" as const,
        maxRedemptions: 20,
        expiresAt: at(-1, 12),
        stripeCouponId: "coupon_demo_ow25",
        stripePromotionCodeId: "promo_demo_ow25",
        createdAt: at(-45, 9),
      },
    ])
    .onConflictDoNothing();

  const [reef10] = await db
    .select()
    .from(shopPromoCodes)
    .where(and(eq(shopPromoCodes.shopId, shopId), eq(shopPromoCodes.code, "REEF10")))
    .limit(1);
  if (!reef10) throw new Error("seedPromos: REEF10 promo missing after insert");

  // One already-settled booking makes the staff list's redemption count an
  // honest payment-history fact, not a fabricated aggregate. Booking payment
  // rows are seeded separately; this historical checkout mirrors the Stripe
  // completion that produced that paid state.
  if (!booking) return;
  const [source] = await db
    .select({
      amountCents: bookingPayments.amountCents,
      email: people.email,
      tripId: bookings.tripId,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(and(eq(bookings.shopId, shopId), eq(bookings.id, booking.id)))
    .limit(1);
  if (!source || source.tripId !== booking.tripId || source.amountCents === null) {
    throw new Error("seedPromos: redemption booking must have a matching payment");
  }
  const settledTotalCents = Math.round(source.amountCents * (1 - reef10.discountPercent / 100));
  const stripeSessionId = "cs_demo_reef10_redeemed";
  const [insertedCheckout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      tripId: booking.tripId,
      status: "completed",
      stripeAccountId: "acct_demo",
      stripeSessionId,
      customerEmail: source.email,
      promoCodeId: reef10.id,
      promoCode: reef10.code,
      appliedDiscountPercent: reef10.discountPercent,
      currency: "usd",
      amountPerDiverCents: source.amountCents,
      totalCents: source.amountCents,
      settledTotalCents,
      completedAt: at(-2, 11),
      createdAt: at(-2, 10),
    })
    .onConflictDoNothing({ target: bookingCheckouts.stripeSessionId })
    .returning();
  const checkout =
    insertedCheckout ??
    (
      await db
        .select()
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.stripeSessionId, stripeSessionId))
        .limit(1)
    )[0];
  if (!checkout) throw new Error("seedPromos: redeemed checkout missing after insert");

  await db
    .insert(bookingCheckoutBookings)
    .values({ shopId, checkoutId: checkout.id, bookingId: booking.id })
    .onConflictDoNothing();
  await db
    .insert(shopPromoRedemptions)
    .values({
      shopId,
      promoCodeId: reef10.id,
      checkoutId: checkout.id,
      amountChargedCents: checkout.settledTotalCents ?? checkout.totalCents,
      redeemedAt: checkout.completedAt ?? at(-2, 11),
    })
    .onConflictDoNothing({ target: shopPromoRedemptions.checkoutId });
}
