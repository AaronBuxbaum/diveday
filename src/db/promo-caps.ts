import { and, count, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  bookingCheckouts,
  bookings,
  shopPromoCodes,
  shopPromoRedemptions,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { seatHeld } from "./trips-queries";

/**
 * **Whether a capped discount has nothing left to give, asked locally.**
 *
 * Stripe enforces a code's `max_redemptions` only when the code itself is
 * handed to a Checkout session. The pass-through-fee guard (issue #1019) hands
 * Stripe a one-off coupon worked out here instead, and Stripe counts that
 * against no cap at all — so on that path the cap is DiveDay's to hold, or a
 * "first 10 divers" code is unlimited for any trip with a park fee.
 *
 * A use is a paid checkout that applied the discount, or a pending one whose
 * hosted page can still be paid: a pending session is a seat at the cap, held
 * until it expires, or two divers could each be shown the last redemption.
 *
 * - A **shop-wide code** carries its own cap (`max_redemptions`); paid uses
 *   are its `shop_promo_redemptions` rows, the same count the Promos page
 *   shows. No cap means never exhausted.
 * - A **trip deal** is capped at the departure's open seats when it went out,
 *   which the row does not record. Read back as the trip's capacity less the
 *   seats held then and still held now: exact unless a seat held at sending
 *   was given up since, and never tighter than the cap Stripe holds.
 */
export async function discountCapReached(
  db: DbExecutor,
  input: { shopId: string; source: "shop" | "trip"; promoId: string; now: Date },
): Promise<boolean> {
  const livePending = and(
    eq(bookingCheckouts.shopId, input.shopId),
    eq(bookingCheckouts.status, "pending"),
    or(isNull(bookingCheckouts.expiresAt), gt(bookingCheckouts.expiresAt, input.now)),
  );
  if (input.source === "shop") {
    const [promo] = await db
      .select({ maxRedemptions: shopPromoCodes.maxRedemptions })
      .from(shopPromoCodes)
      .where(and(eq(shopPromoCodes.id, input.promoId), eq(shopPromoCodes.shopId, input.shopId)))
      .limit(1);
    if (!promo) return true;
    if (promo.maxRedemptions === null) return false;
    const [redeemed] = await db
      .select({ total: count() })
      .from(shopPromoRedemptions)
      .where(
        and(
          eq(shopPromoRedemptions.shopId, input.shopId),
          eq(shopPromoRedemptions.promoCodeId, input.promoId),
        ),
      );
    const [pending] = await db
      .select({ total: count() })
      .from(bookingCheckouts)
      .where(and(livePending, eq(bookingCheckouts.promoCodeId, input.promoId)));
    return Number(redeemed?.total ?? 0) + Number(pending?.total ?? 0) >= promo.maxRedemptions;
  }

  const [deal] = await db
    .select({
      tripId: tripLastMinutePromos.tripId,
      createdAt: tripLastMinutePromos.createdAt,
      capacity: trips.capacity,
    })
    .from(tripLastMinutePromos)
    .innerJoin(
      trips,
      and(eq(trips.id, tripLastMinutePromos.tripId), eq(trips.shopId, input.shopId)),
    )
    .where(
      and(
        eq(tripLastMinutePromos.id, input.promoId),
        eq(tripLastMinutePromos.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!deal) return true;
  const [heldBefore] = await db
    .select({ total: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, deal.tripId),
        lt(bookings.createdAt, deal.createdAt),
        seatHeld,
      ),
    );
  // Stripe never mints a cap below one (`createTripPromotion`).
  const cap = Math.max(1, deal.capacity - Number(heldBefore?.total ?? 0));
  const [used] = await db
    .select({ total: count() })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.shopId, input.shopId),
        eq(bookingCheckouts.tripPromoId, input.promoId),
        or(eq(bookingCheckouts.status, "completed"), livePending),
      ),
    );
  return Number(used?.total ?? 0) >= cap;
}
