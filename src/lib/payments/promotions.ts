import { z } from "zod";

/**
 * Stripe coupon + promotion code creation for last-minute-deal blasts, on the
 * shop's own connected account — fetch-based, no SDK, same
 * `Stripe-Account`-header pattern as ./checkout.ts and ./invoicing.ts (docs
 * ADR 20260727-last-minute-fill-promos). A promotion code always names a
 * fresh coupon; DiveDay never reuses a coupon across blasts, so each blast's
 * discount percent and cap stand on their own in the shop's Stripe dashboard.
 */

export type CreateTripPromotionRequest = {
  stripeAccountId: string;
  /** The exact code text the diver will type, e.g. "SAVE50-A1B2C3". */
  code: string;
  percentOff: number;
  /** Pinned to the trip's departure — Stripe itself refuses redemption past this. */
  expiresAt: Date;
  /** Capped at the trip's open-seat count at send time; always at least 1. */
  maxRedemptions: number;
  /**
   * Deterministic per-blast key so a retry after a lost response converges on
   * the coupon/promotion code Stripe already created instead of minting a
   * second pair (CR-005 pattern).
   */
  idempotencyKey: string;
};

/**
 * A shop-wide code (docs ADR 20260729-shop-promo-codes). Same Stripe objects as
 * a trip blast, but both bounds are optional: a standing "10% off any course"
 * has no departure to expire at and no seat count to cap against, so Stripe is
 * told to leave those unset rather than being handed an invented value.
 */
export type CreateShopPromotionRequest = {
  stripeAccountId: string;
  code: string;
  percentOff: number;
  /** Staff's label, shown in the shop's own Stripe dashboard beside the coupon. */
  name: string;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  idempotencyKey: string;
};

export type CreateTripPromotionResult =
  | { status: "created"; stripeCouponId: string; stripePromotionCodeId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export interface PromotionProvider {
  createTripPromotion(request: CreateTripPromotionRequest): Promise<CreateTripPromotionResult>;
  createShopPromotion(request: CreateShopPromotionRequest): Promise<CreateTripPromotionResult>;
}

type Fetch = typeof fetch;
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({ secretKey: z.string().trim().min(1) });

const couponResponseSchema = z.object({ id: z.string().min(1) });
const promotionCodeResponseSchema = z.object({ id: z.string().min(1) });

function headersFor(secretKey: string, stripeAccountId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Account": stripeAccountId,
  };
}

export function stripePromotionProvider(
  config: { secretKey: string },
  fetchImpl: Fetch,
): PromotionProvider {
  /**
   * The coupon-then-promotion-code pair both flavors mint. Bounds are written
   * only when the caller has one: Stripe reads an absent `expires_at` or
   * `max_redemptions` as unbounded, which is exactly what a standing shop-wide
   * code means — there is no honest value to invent for either.
   */
  async function createPromotion(request: {
    stripeAccountId: string;
    code: string;
    percentOff: number;
    name: string;
    expiresAt: Date | null;
    maxRedemptions: number | null;
    idempotencyKey: string;
  }): Promise<CreateTripPromotionResult> {
    try {
      const couponForm = new URLSearchParams({
        duration: "once",
        percent_off: String(request.percentOff),
        name: request.name,
      });
      const couponResponse = await fetchImpl("https://api.stripe.com/v1/coupons", {
        method: "POST",
        headers: {
          ...headersFor(config.secretKey, request.stripeAccountId),
          "Idempotency-Key": `${request.idempotencyKey}:coupon`,
        },
        body: couponForm.toString(),
      });
      if (!couponResponse.ok) return { status: "failed" };
      const coupon = couponResponseSchema.safeParse(await couponResponse.json());
      if (!coupon.success) return { status: "failed" };

      const promoForm = new URLSearchParams({ coupon: coupon.data.id, code: request.code });
      if (request.maxRedemptions !== null) {
        promoForm.set("max_redemptions", String(Math.max(1, request.maxRedemptions)));
      }
      if (request.expiresAt !== null) {
        promoForm.set("expires_at", String(Math.floor(request.expiresAt.getTime() / 1000)));
      }
      const promoResponse = await fetchImpl("https://api.stripe.com/v1/promotion_codes", {
        method: "POST",
        headers: {
          ...headersFor(config.secretKey, request.stripeAccountId),
          "Idempotency-Key": `${request.idempotencyKey}:promotion_code`,
        },
        body: promoForm.toString(),
      });
      if (!promoResponse.ok) return { status: "failed" };
      const promotionCode = promotionCodeResponseSchema.safeParse(await promoResponse.json());
      if (!promotionCode.success) return { status: "failed" };

      return {
        status: "created",
        stripeCouponId: coupon.data.id,
        stripePromotionCodeId: promotionCode.data.id,
      };
    } catch {
      return { status: "failed" };
    }
  }

  return {
    createTripPromotion(request) {
      return createPromotion({ ...request, name: `Last-minute deal — ${request.code}` });
    },
    createShopPromotion(request) {
      return createPromotion(request);
    },
  };
}

const disabledPromotionProvider: PromotionProvider = {
  async createTripPromotion() {
    return { status: "not_configured" };
  },
  async createShopPromotion() {
    return { status: "not_configured" };
  },
};

export function promotionProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): PromotionProvider {
  const config = configSchema.safeParse({ secretKey: env.STRIPE_SECRET_KEY });
  return config.success
    ? stripePromotionProvider(config.data, fetchImpl)
    : disabledPromotionProvider;
}
