import { and, count, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
import { STALE_AFTER_MS } from "./payment-operations";
import {
  bookingCheckouts,
  bookings,
  paymentOperationIntents,
  shopPromoCodes,
  shopPromoRedemptions,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { seatHeld } from "./trips-queries";

/**
 * **A capped discount's cap, held locally where Stripe cannot see it.**
 *
 * Stripe enforces a code's `max_redemptions` only when the code itself is
 * handed to a Checkout session. The pass-through-fee guard (issue #1019) hands
 * Stripe a one-off coupon worked out here instead, and Stripe counts that
 * against no cap at all — so on that path the cap is DiveDay's to hold, or a
 * "first 10 divers" code is unlimited for any trip with a park fee.
 */
export type DiscountRef = { shopId: string; source: "shop" | "trip"; promoId: string };

/**
 * The most uses this discount allows, or null for no cap at all.
 *
 * - A **shop-wide code** carries its own (`max_redemptions`); none means
 *   uncapped.
 * - A **trip deal** stores the cap Stripe was given when it went out: the
 *   departure's open seats then. A deal sent before that column existed reads
 *   it back as the trip's capacity less the seats held before the deal and
 *   still held.
 *
 * A discount that is not this shop's has nothing to give (zero).
 */
async function discountCap(db: DbExecutor, ref: DiscountRef): Promise<number | null> {
  if (ref.source === "shop") {
    const [promo] = await db
      .select({ maxRedemptions: shopPromoCodes.maxRedemptions })
      .from(shopPromoCodes)
      .where(and(eq(shopPromoCodes.id, ref.promoId), eq(shopPromoCodes.shopId, ref.shopId)))
      .limit(1);
    if (!promo) return 0;
    return promo.maxRedemptions;
  }
  const [deal] = await db
    .select({
      tripId: tripLastMinutePromos.tripId,
      createdAt: tripLastMinutePromos.createdAt,
      maxRedemptions: tripLastMinutePromos.maxRedemptions,
      capacity: trips.capacity,
    })
    .from(tripLastMinutePromos)
    .innerJoin(trips, and(eq(trips.id, tripLastMinutePromos.tripId), eq(trips.shopId, ref.shopId)))
    .where(
      and(eq(tripLastMinutePromos.id, ref.promoId), eq(tripLastMinutePromos.shopId, ref.shopId)),
    )
    .limit(1);
  if (!deal) return 0;
  if (deal.maxRedemptions !== null) return deal.maxRedemptions;
  const [heldBefore] = await db
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, ref.shopId),
        eq(bookings.tripId, deal.tripId),
        lt(bookings.createdAt, deal.createdAt),
        seatHeld,
      ),
    );
  // Stripe never mints a cap below one (`createTripPromotion`).
  return Math.max(1, deal.capacity - Number(heldBefore?.total ?? 0));
}

/**
 * How many uses this discount has spent or is holding: paid checkouts that
 * applied it, pending ones whose hosted page can still be paid, and attempts
 * that reserved it and have not heard back from Stripe yet. `exceptIntentId`
 * leaves the asking attempt out of its own count.
 */
async function discountUses(
  db: DbExecutor,
  ref: DiscountRef,
  now: Date,
  exceptIntentId?: string,
): Promise<number> {
  const promoColumn =
    ref.source === "shop" ? bookingCheckouts.promoCodeId : bookingCheckouts.tripPromoId;
  const livePending = and(
    eq(bookingCheckouts.status, "pending"),
    or(isNull(bookingCheckouts.expiresAt), gt(bookingCheckouts.expiresAt, now)),
  );
  // A shop code's paid uses are its redemption rows, the count the Promos page
  // shows; a trip deal has no redemption table, so its completed checkouts.
  let paid = 0;
  if (ref.source === "shop") {
    const [row] = await db
      .select({ total: count() })
      .from(shopPromoRedemptions)
      .where(
        and(
          eq(shopPromoRedemptions.shopId, ref.shopId),
          eq(shopPromoRedemptions.promoCodeId, ref.promoId),
        ),
      );
    paid = Number(row?.total ?? 0);
  }
  const [held] = await db
    .select({ total: count() })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.shopId, ref.shopId),
        eq(promoColumn, ref.promoId),
        ref.source === "shop"
          ? livePending
          : or(eq(bookingCheckouts.status, "completed"), livePending),
      ),
    );
  const intentColumn =
    ref.source === "shop"
      ? paymentOperationIntents.promoCodeId
      : paymentOperationIntents.tripPromoId;
  const [reserved] = await db
    .select({ total: count() })
    .from(paymentOperationIntents)
    .where(
      and(
        eq(paymentOperationIntents.shopId, ref.shopId),
        eq(intentColumn, ref.promoId),
        eq(paymentOperationIntents.status, "started"),
        // A crashed attempt stops holding a use once it is stale, on the same
        // horizon the booking claim uses.
        gt(paymentOperationIntents.startedAt, new Date(now.getTime() - STALE_AFTER_MS)),
        ...(exceptIntentId ? [ne(paymentOperationIntents.id, exceptIntentId)] : []),
      ),
    );
  return paid + Number(held?.total ?? 0) + Number(reserved?.total ?? 0);
}

/** Whether this discount has nothing left to give. */
export async function discountCapReached(
  db: DbExecutor,
  input: DiscountRef & { now: Date; exceptIntentId?: string },
): Promise<boolean> {
  const cap = await discountCap(db, input);
  if (cap === null) return false;
  return (await discountUses(db, input, input.now, input.exceptIntentId)) >= cap;
}

export type DiscountReservation = "uncapped" | "reserved" | "used_up";

/**
 * **Take one use of a capped discount for this checkout attempt, before Stripe
 * is called.**
 *
 * Under a transaction-scoped advisory lock keyed on the discount, so attempts
 * at the same code take turns: each re-counts, and a winner tags its
 * payment-operation intent with the discount before the lock lets go. That tag
 * is the reservation the next attempt counts, which is what keeps two attempts
 * at the last use from both reaching Stripe. It is superseded by the pending
 * checkout row once Stripe answers, and lapses when the attempt resolves or
 * goes stale.
 */
export async function reserveDiscountUse(
  db: AppDb,
  input: DiscountRef & { intentId: string; now: Date },
): Promise<DiscountReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.promoId}::text))`);
    if (await discountCapReached(tx, { ...input, exceptIntentId: input.intentId })) {
      return "used_up";
    }
    if ((await discountCap(tx, input)) === null) return "uncapped";
    await tx
      .update(paymentOperationIntents)
      .set(
        input.source === "shop" ? { promoCodeId: input.promoId } : { tripPromoId: input.promoId },
      )
      .where(eq(paymentOperationIntents.id, input.intentId));
    return "reserved";
  });
}
