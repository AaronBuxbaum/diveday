import { describe, expect, it, vi } from "vitest";
import { promotionProviderFromEnvironment } from "./promotions";

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return promotionProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

const request = {
  stripeAccountId: "acct_123",
  code: "SAVE50-A1B2C3",
  percentOff: 50,
  expiresAt: new Date("2026-07-29T12:00:00Z"),
  maxRedemptions: 4,
  idempotencyKey: "promo-1",
};

function ok(json: unknown) {
  return { ok: true, json: async () => json };
}

describe("stripe promotion provider", () => {
  it("is not_configured without a Stripe key", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await provider.createTripPromotion(request)).toEqual({ status: "not_configured" });
  });

  it("creates a coupon then a promotion code on the connected account", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "coupon_1" }))
      .mockResolvedValueOnce(ok({ id: "promo_1" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const result = await provider.createTripPromotion(request);
    expect(result).toEqual({
      status: "created",
      stripeCouponId: "coupon_1",
      stripePromotionCodeId: "promo_1",
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/coupons");
    const couponCall = fetchImpl.mock.calls[0][1];
    expect(couponCall.headers["Stripe-Account"]).toBe("acct_123");
    expect(couponCall.headers["Idempotency-Key"]).toBe("promo-1:coupon");
    const couponForm = new URLSearchParams(couponCall.body);
    expect(couponForm.get("percent_off")).toBe("50");
    expect(couponForm.get("duration")).toBe("once");

    expect(fetchImpl.mock.calls[1][0]).toBe("https://api.stripe.com/v1/promotion_codes");
    const promoCall = fetchImpl.mock.calls[1][1];
    expect(promoCall.headers["Idempotency-Key"]).toBe("promo-1:promotion_code");
    const promoForm = new URLSearchParams(promoCall.body);
    expect(promoForm.get("coupon")).toBe("coupon_1");
    expect(promoForm.get("code")).toBe("SAVE50-A1B2C3");
    expect(promoForm.get("max_redemptions")).toBe("4");
    expect(promoForm.get("expires_at")).toBe(
      String(Math.floor(request.expiresAt.getTime() / 1000)),
    );
  });

  it("never redeems below once, even when the trip had zero open seats", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "coupon_1" }))
      .mockResolvedValueOnce(ok({ id: "promo_1" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    await provider.createTripPromotion({ ...request, maxRedemptions: 0 });
    const promoForm = new URLSearchParams(fetchImpl.mock.calls[1][1].body);
    expect(promoForm.get("max_redemptions")).toBe("1");
  });

  it("fails without creating a promotion code when the coupon call fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createTripPromotion(request)).toEqual({ status: "failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when the promotion-code call fails after the coupon is created", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "coupon_1" }))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createTripPromotion(request)).toEqual({ status: "failed" });
  });

  it("fails on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createTripPromotion(request)).toEqual({ status: "failed" });
  });
});

describe("createShopPromotion", () => {
  const shopRequest = {
    stripeAccountId: "acct_123",
    code: "REEF20",
    percentOff: 20,
    name: "Returning divers",
    expiresAt: null,
    maxRedemptions: null,
    idempotencyKey: "shop-promo-1",
  };

  it("is not_configured without a Stripe key", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await provider.createShopPromotion(shopRequest)).toEqual({ status: "not_configured" });
  });

  it("leaves both bounds unset when the shop set none, rather than inventing one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "coupon_2" }))
      .mockResolvedValueOnce(ok({ id: "promo_2" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createShopPromotion(shopRequest)).toEqual({
      status: "created",
      stripeCouponId: "coupon_2",
      stripePromotionCodeId: "promo_2",
    });

    const couponForm = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    expect(couponForm.get("name")).toBe("Returning divers");
    const promoForm = new URLSearchParams(fetchImpl.mock.calls[1][1].body);
    expect(promoForm.get("code")).toBe("REEF20");
    expect(promoForm.has("max_redemptions")).toBe(false);
    expect(promoForm.has("expires_at")).toBe(false);
  });

  it("passes the bounds through when the shop did set them", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: "coupon_2" }))
      .mockResolvedValueOnce(ok({ id: "promo_2" }));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    const expiresAt = new Date("2026-09-01T00:00:00Z");
    await provider.createShopPromotion({ ...shopRequest, expiresAt, maxRedemptions: 25 });

    const promoForm = new URLSearchParams(fetchImpl.mock.calls[1][1].body);
    expect(promoForm.get("max_redemptions")).toBe("25");
    expect(promoForm.get("expires_at")).toBe(String(Math.floor(expiresAt.getTime() / 1000)));
  });

  it("fails on a network error rather than reporting a code that was never minted", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const provider = providerWith({ STRIPE_SECRET_KEY: "sk_test" }, fetchImpl);
    expect(await provider.createShopPromotion(shopRequest)).toEqual({ status: "failed" });
  });
});
