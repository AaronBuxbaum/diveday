import { and, desc, eq, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type PromotionProvider,
  promotionProviderFromEnvironment,
} from "@/lib/payments/promotions";
import {
  isPromoRedeemable,
  isValidPromoDiscountPercent,
  normalizePromoCode,
  type PromoBookingKind,
  type PromoScope,
} from "@/lib/promo-codes";
import type { AppDb, DbExecutor } from "./client";
import { type ShopPromoCode, shopPromoCodes, shopPromoRedemptions } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

/**
 * Shop-wide promo codes (docs ADR 20260729-shop-promo-codes). Same
 * Stripe-native mechanism as a last-minute trip blast — DiveDay never does its
 * own discount arithmetic — but the code belongs to the shop rather than to one
 * departure, so the scope and window it may be spent within live locally and
 * are checked here before Stripe is ever handed the code.
 */

export type CreateShopPromoInput = {
  shopId: string;
  code: string;
  discountPercent: number;
  scope: PromoScope;
  description?: string | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  maxRedemptions?: number | null;
  createdByPersonId?: string;
};

export type CreateShopPromoOutcome =
  | { ok: true; promo: ShopPromoCode }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "invalid_discount"
        | "invalid_window"
        | "duplicate"
        | "not_connected"
        | "stripe_failed";
    };

/**
 * Mint one shop-wide code. The local row is inserted `pending` before Stripe is
 * called and only flips to `active` once Stripe has actually created the
 * objects — the same insert-before-the-external-call shape as
 * `sendLastMinuteDealBlast` and `startBookingCheckout`, so a crash mid-create
 * leaves a visible `pending`/`failed` row rather than nothing. A code is never
 * redeemable while `pending`, so a half-created promo cannot discount anything.
 */
export async function createShopPromoCode(
  db: AppDb,
  input: CreateShopPromoInput,
  promotions: PromotionProvider = promotionProviderFromEnvironment(),
): Promise<CreateShopPromoOutcome> {
  const code = normalizePromoCode(input.code);
  if (!code) return { ok: false, reason: "invalid_code" };
  if (!isValidPromoDiscountPercent(input.discountPercent)) {
    return { ok: false, reason: "invalid_discount" };
  }
  const startsAt = input.startsAt ?? null;
  const expiresAt = input.expiresAt ?? null;
  if (startsAt && expiresAt && startsAt >= expiresAt)
    return { ok: false, reason: "invalid_window" };
  const maxRedemptions = input.maxRedemptions ?? null;
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    return { ok: false, reason: "invalid_window" };
  }

  // A code that Stripe can't hold is a code that can never discount anything —
  // fail before writing a row that would only ever read `failed`.
  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const existing = await getShopPromoByCode(db, input.shopId, code);
  if (existing) return { ok: false, reason: "duplicate" };

  const [pending] = await db
    .insert(shopPromoCodes)
    .values({
      shopId: input.shopId,
      code,
      description: input.description?.trim() || null,
      discountPercent: input.discountPercent,
      scope: input.scope,
      startsAt,
      expiresAt,
      maxRedemptions,
      createdByPersonId: input.createdByPersonId,
    })
    .returning();
  if (!pending) throw new Error("createShopPromoCode: insert returned no row");

  const stripeResult = await promotions.createShopPromotion({
    stripeAccountId,
    code,
    percentOff: input.discountPercent,
    name: input.description?.trim() || `DiveDay promo — ${code}`,
    expiresAt,
    maxRedemptions,
    idempotencyKey: pending.id,
  });
  if (stripeResult.status !== "created") {
    await db
      .update(shopPromoCodes)
      .set({ status: "failed" })
      .where(eq(shopPromoCodes.id, pending.id));
    return { ok: false, reason: "stripe_failed" };
  }

  const [active] = await db
    .update(shopPromoCodes)
    .set({
      status: "active",
      stripeCouponId: stripeResult.stripeCouponId,
      stripePromotionCodeId: stripeResult.stripePromotionCodeId,
    })
    .where(eq(shopPromoCodes.id, pending.id))
    .returning();
  return active ? { ok: true, promo: active } : { ok: false, reason: "stripe_failed" };
}

/** One code by its exact normalized text, shop-scoped. Null when this shop has no such code. */
export async function getShopPromoByCode(
  db: DbExecutor,
  shopId: string,
  code: string,
): Promise<ShopPromoCode | null> {
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(shopPromoCodes)
    .where(and(eq(shopPromoCodes.shopId, shopId), eq(shopPromoCodes.code, normalized)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a diver-typed code to one this shop may actually apply to this kind of
 * booking, right now — the check that keeps a code off a purchase it was never
 * issued for. Returns null for every failure alike (unknown code, disabled,
 * not yet started, expired, wrong scope): the diver-facing behavior is
 * identical in all of them, and distinguishing them would turn the public
 * booking form into an oracle for enumerating a shop's live codes.
 */
export async function getRedeemableShopPromo(
  db: DbExecutor,
  input: { shopId: string; code: string; kind: PromoBookingKind; now?: Date },
): Promise<ShopPromoCode | null> {
  const promo = await getShopPromoByCode(db, input.shopId, input.code);
  // No Stripe promotion-code id means the mint never completed — the code
  // exists locally but cannot discount anything.
  if (!promo?.stripePromotionCodeId) return null;
  return isPromoRedeemable(promo, input.kind, input.now ?? nowDate()) ? promo : null;
}

export type ShopPromoWithUsage = ShopPromoCode & { timesRedeemed: number };

/** Every code the shop has, newest first, each with its own redemption count. */
export async function listShopPromoCodes(
  db: DbExecutor,
  shopId: string,
): Promise<ShopPromoWithUsage[]> {
  const rows = await db
    .select({
      promo: shopPromoCodes,
      // count(redemption id), not count(*) — the left join produces one row for
      // a code nobody has redeemed, and count(*) would report that as 1.
      timesRedeemed: sql<number>`count(${shopPromoRedemptions.id})::int`,
    })
    .from(shopPromoCodes)
    .leftJoin(shopPromoRedemptions, eq(shopPromoRedemptions.promoCodeId, shopPromoCodes.id))
    .where(eq(shopPromoCodes.shopId, shopId))
    .groupBy(shopPromoCodes.id)
    .orderBy(desc(shopPromoCodes.createdAt));
  return rows.map(({ promo, timesRedeemed }) => ({ ...promo, timesRedeemed }));
}

/**
 * Switch a code off (or back on), shop-scoped. Only ever moves between `active`
 * and `disabled`: a `pending` or `failed` code has no Stripe objects behind it,
 * so "enabling" one would produce a code that validates locally and then fails
 * at checkout — worse than it staying visibly broken.
 */
export async function setShopPromoEnabled(
  db: AppDb,
  shopId: string,
  promoId: string,
  enabled: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(shopPromoCodes)
    .set({ status: enabled ? "active" : "disabled" })
    .where(
      and(
        eq(shopPromoCodes.id, promoId),
        eq(shopPromoCodes.shopId, shopId),
        sql`${shopPromoCodes.status} in ('active', 'disabled')`,
      ),
    )
    .returning({ id: shopPromoCodes.id });
  return Boolean(updated);
}

/**
 * Record that a completed checkout spent a code. Called from inside
 * `markCheckoutPaidBySessionId`'s transaction; the unique index on
 * `checkout_id` means a replayed or duplicated Stripe webhook lands on the same
 * row instead of inflating the count, so this is safe to call on every
 * completion, including a repair run over an already-completed checkout.
 */
export async function recordShopPromoRedemption(
  db: DbExecutor,
  input: {
    shopId: string;
    promoCodeId: string;
    checkoutId: string;
    amountChargedCents: number;
  },
): Promise<void> {
  await db
    .insert(shopPromoRedemptions)
    .values({
      shopId: input.shopId,
      promoCodeId: input.promoCodeId,
      checkoutId: input.checkoutId,
      amountChargedCents: input.amountChargedCents,
    })
    .onConflictDoNothing({ target: shopPromoRedemptions.checkoutId });
}
