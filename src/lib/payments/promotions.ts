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

/**
 * A one-off, fixed-amount coupon for a single Checkout session.
 *
 * **Why a fixed amount rather than the shop's own percent code.** Stripe
 * applies a session's `discounts` to the whole session, and the only way to
 * exempt a line is `coupon.applies_to[products]` — an allowlist of *Product*
 * ids. DiveDay's Checkout lines are inline `price_data`, so their products are
 * minted per session and cannot be named in advance. There is no per-line
 * "discountable" flag in Checkout at all.
 *
 * So when a session carries a third-party pass-through fee — a marine-park
 * levy the shop collects and must remit **in full** — a percent code silently
 * takes its cut of that fee out of the shop's own margin (issue #1019). The
 * caller works out what the percent is worth against the discountable lines
 * only, and hands Stripe that number.
 */
export type CreateSessionDiscountRequest = {
  stripeAccountId: string;
  /** Minor units, already computed against the discountable lines only. */
  amountOffCents: number;
  currency: string;
  /** The shop's own code text, so the shop's Stripe dashboard still reads honestly. */
  name: string;
  /** Deterministic per-attempt key — same convention as the session itself. */
  idempotencyKey: string;
};

export type CreateTripPromotionResult =
  | { status: "created"; stripeCouponId: string; stripePromotionCodeId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type CreateSessionDiscountResult =
  | { status: "created"; stripeCouponId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export interface PromotionProvider {
  createTripPromotion(request: CreateTripPromotionRequest): Promise<CreateTripPromotionResult>;
  createShopPromotion(request: CreateShopPromotionRequest): Promise<CreateTripPromotionResult>;
  createSessionDiscount(
    request: CreateSessionDiscountRequest,
  ): Promise<CreateSessionDiscountResult>;
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
    async createSessionDiscount(request) {
      // A coupon and no promotion code: nothing here is typed by a diver, and
      // it is spent by the one session it was minted for. `max_redemptions: 1`
      // is the belt to that brace — a leaked coupon id cannot be reused.
      try {
        const form = new URLSearchParams({
          duration: "once",
          amount_off: String(Math.max(0, Math.round(request.amountOffCents))),
          currency: request.currency,
          name: request.name.slice(0, 40),
          max_redemptions: "1",
        });
        const response = await fetchImpl("https://api.stripe.com/v1/coupons", {
          method: "POST",
          headers: {
            ...headersFor(config.secretKey, request.stripeAccountId),
            "Idempotency-Key": `${request.idempotencyKey}:session-discount`,
          },
          body: form.toString(),
        });
        if (!response.ok) return { status: "failed" };
        const coupon = couponResponseSchema.safeParse(await response.json());
        return coupon.success
          ? { status: "created", stripeCouponId: coupon.data.id }
          : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
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
  async createSessionDiscount() {
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
