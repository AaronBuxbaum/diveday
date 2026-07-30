import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { toDiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import {
  generateLastMinutePromoCode,
  isValidLastMinuteDiscountPercent,
  lastMinuteEntryMatchesTripDate,
} from "@/lib/last-minute-list";
import { publicAppUrl } from "@/lib/notifications";
import {
  type PromotionProvider,
  promotionProviderFromEnvironment,
} from "@/lib/payments/promotions";
import { spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import { listLastMinuteList } from "./last-minute-list";
import { notificationProviderForDb, sendNotificationBatch } from "./notifications";
import { type TripLastMinutePromo, tripLastMinutePromos } from "./schema";
import { getShopById } from "./shops";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { getTripWithBooked } from "./trips";

export type SendLastMinuteDealInput = {
  shopId: string;
  shopSlug: string;
  tripId: string;
  discountPercent: number;
  createdByPersonId?: string;
};

export type SendLastMinuteDealOutcome =
  | { ok: true; promoId: string; code: string; recipientCount: number }
  | {
      ok: false;
      reason:
        | "invalid_discount"
        | "trip_unavailable"
        | "trip_full"
        | "not_connected"
        | "no_recipients"
        | "stripe_failed";
    };

/**
 * Creates a Stripe coupon + promotion code for one under-capacity trip and
 * emails it to every last-minute-list entry whose stated date range covers
 * the departure. Fails closed on anything ambiguous — an unpriced/full/past
 * trip, a shop that can't take payments, or a Stripe error — and never
 * partially sends: the local row is durable evidence before either Stripe
 * call, but the email step only runs after Stripe has actually minted the
 * code (docs ADR 20260727-last-minute-fill-promos).
 */
export async function sendLastMinuteDealBlast(
  db: AppDb,
  input: SendLastMinuteDealInput,
  promotions: PromotionProvider = promotionProviderFromEnvironment(),
): Promise<SendLastMinuteDealOutcome> {
  if (!isValidLastMinuteDiscountPercent(input.discountPercent)) {
    return { ok: false, reason: "invalid_discount" };
  }

  const [shop, tripRow, account] = await Promise.all([
    getShopById(db, input.shopId),
    getTripWithBooked(db, input.shopId, input.tripId),
    getShopStripeAccount(db, input.shopId),
  ]);
  if (!shop || !tripRow || tripRow.status !== "scheduled" || tripRow.startsAt <= nowDate()) {
    return { ok: false, reason: "trip_unavailable" };
  }
  const openSeats = spotsRemaining({ capacity: tripRow.capacity, booked: tripRow.booked });
  if (openSeats <= 0) return { ok: false, reason: "trip_full" };
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const tripDateIso = toDateInputValue(utcToWallTime(tripRow.startsAt, shop.timezone));
  const matches = (await listLastMinuteList(db, input.shopId)).filter(
    ({ entry, person }) =>
      Boolean(person.email) && lastMinuteEntryMatchesTripDate(entry, tripDateIso),
  );
  if (matches.length === 0) return { ok: false, reason: "no_recipients" };

  const code = generateLastMinutePromoCode(input.discountPercent);
  const [pendingRow] = await db
    .insert(tripLastMinutePromos)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      discountPercent: input.discountPercent,
      code,
      expiresAt: tripRow.startsAt,
      createdByPersonId: input.createdByPersonId,
    })
    .returning();
  if (!pendingRow) throw new Error("sendLastMinuteDealBlast: insert returned no row");

  const stripeResult = await promotions.createTripPromotion({
    stripeAccountId,
    code,
    percentOff: input.discountPercent,
    expiresAt: tripRow.startsAt,
    maxRedemptions: openSeats,
    idempotencyKey: pendingRow.id,
  });
  if (stripeResult.status !== "created") {
    await db
      .update(tripLastMinutePromos)
      .set({ status: "failed" })
      .where(eq(tripLastMinutePromos.id, pendingRow.id));
    return { ok: false, reason: "stripe_failed" };
  }

  const origin = publicAppUrl();
  const bookingUrl = origin
    ? new URL(`/shop/${input.shopSlug}/schedule/${input.tripId}`, `${origin}/`).toString()
    : null;

  let sentCount = 0;
  if (bookingUrl) {
    const deliveries = await sendNotificationBatch(
      db,
      matches.flatMap(({ person }) =>
        person.email
          ? [
              {
                kind: "last_minute_deal" as const,
                shopId: input.shopId,
                to: person.email,
                locale: toDiverLocale(shop.defaultLocale),
                diverName: person.fullName,
                shopName: shop.name,
                tripTitle: tripRow.title,
                startsAt: tripRow.startsAt,
                endsAt: tripRow.endsAt,
                timezone: shop.timezone,
                discountPercent: input.discountPercent,
                code,
                bookingUrl,
                expiresAt: tripRow.startsAt,
              },
            ]
          : [],
      ),
      notificationProviderForDb(db),
    );
    sentCount = deliveries.filter((delivery) => delivery.status === "sent").length;
  }

  await db
    .update(tripLastMinutePromos)
    .set({
      status: "sent",
      stripeCouponId: stripeResult.stripeCouponId,
      stripePromotionCodeId: stripeResult.stripePromotionCodeId,
      recipientCount: sentCount,
    })
    .where(eq(tripLastMinutePromos.id, pendingRow.id));

  return { ok: true, promoId: pendingRow.id, code, recipientCount: sentCount };
}

/** Every blast sent for one trip, newest first — the staff page's send history. */
export async function listTripLastMinutePromos(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripLastMinutePromo[]> {
  return db
    .select()
    .from(tripLastMinutePromos)
    .where(and(eq(tripLastMinutePromos.shopId, shopId), eq(tripLastMinutePromos.tripId, tripId)))
    .orderBy(desc(tripLastMinutePromos.createdAt));
}

/**
 * Resolves a diver-typed code to a live, unexpired promotion issued for this
 * exact trip — the trip-scoping check that keeps a code from being reused on
 * an unrelated booking (docs ADR 20260727-last-minute-fill-promos). Returns
 * null on anything that doesn't match, rather than distinguishing "wrong
 * code" from "wrong trip" from "expired" — the diver-facing behavior is the
 * same either way (the code just doesn't apply).
 */
export async function getActiveTripPromoByCode(
  db: DbExecutor,
  input: { shopId: string; tripId: string; code: string; now?: Date },
): Promise<TripLastMinutePromo | null> {
  const code = input.code.trim().toUpperCase();
  if (!code) return null;
  const [row] = await db
    .select()
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, input.shopId),
        eq(tripLastMinutePromos.tripId, input.tripId),
        eq(tripLastMinutePromos.code, code),
        eq(tripLastMinutePromos.status, "sent"),
        gt(tripLastMinutePromos.expiresAt, input.now ?? nowDate()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Trip ids among `tripIds` that have never had a `sent` last-minute-deal blast. */
export async function tripIdsNeverSentLastMinuteDeal(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const sent = await db
    .select({ tripId: tripLastMinutePromos.tripId })
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, shopId),
        inArray(tripLastMinutePromos.tripId, tripIds),
        eq(tripLastMinutePromos.status, "sent"),
      ),
    );
  const alreadySent = new Set(sent.map((row) => row.tripId));
  return new Set(tripIds.filter((id) => !alreadySent.has(id)));
}
