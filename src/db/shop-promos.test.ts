// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import type { CreateTripPromotionResult, PromotionProvider } from "@/lib/payments/promotions";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import {
  createShopPromoCode,
  getRedeemableShopPromo,
  getShopPromoByCode,
  listShopPromoCodes,
  setShopPromoEnabled,
} from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const NOW = new Date("2026-07-29T12:00:00.000Z");

function fakePromotions(overrides: Partial<PromotionProvider> = {}): PromotionProvider {
  let counter = 0;
  return {
    async createTripPromotion(): Promise<CreateTripPromotionResult> {
      return { status: "failed" };
    },
    async createShopPromotion(): Promise<CreateTripPromotionResult> {
      counter += 1;
      return {
        status: "created",
        stripeCouponId: `coupon_${counter}`,
        stripePromotionCodeId: `promo_${counter}`,
      };
    },
    ...overrides,
  };
}

function fakeCheckout(): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request): Promise<CreateCheckoutSessionResult> {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_promo_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_promo_${counter}`,
        amountTotalCents: request.unitAmountCents * request.quantity,
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_test" };
    },
  };
}

/** A connected, charges-enabled shop — the precondition for holding any code at all. */
async function promoContext(options: { connected?: boolean } = {}) {
  const { db, shop } = await seededShopContext();
  if (options.connected !== false) {
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    await setShopStripeAccountStatus(db, "acct_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  }
  return { db, shop };
}

/** The seeded demo shop already ships codes, so assert on the one under test. */
async function promoNamed(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  code: string,
) {
  const found = (await listShopPromoCodes(db, shopId)).find((promo) => promo.code === code);
  if (!found) throw new Error(`promo ${code} not found`);
  return found;
}

function promoInput(shopId: string, overrides: Record<string, unknown> = {}) {
  return {
    shopId,
    code: "reef20",
    discountPercent: 20,
    scope: "all" as const,
    ...overrides,
  };
}

describe("createShopPromoCode", () => {
  it("mints a Stripe coupon and promotion code, storing the normalized code active", async () => {
    const { db, shop } = await promoContext();
    const outcome = await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");

    expect(outcome.promo.code).toBe("REEF20");
    expect(outcome.promo.status).toBe("active");
    expect(outcome.promo.stripePromotionCodeId).toBe("promo_1");
  });

  it("leaves the code failed — and unredeemable — when Stripe never minted it", async () => {
    const { db, shop } = await promoContext();
    const outcome = await createShopPromoCode(
      db,
      promoInput(shop.id),
      fakePromotions({
        async createShopPromotion(): Promise<CreateTripPromotionResult> {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "stripe_failed" });

    // The row survives as evidence an operator can see, but it can never discount.
    const stored = await getShopPromoByCode(db, shop.id, "REEF20");
    expect(stored?.status).toBe("failed");
    expect(
      await getRedeemableShopPromo(db, { shopId: shop.id, code: "REEF20", kind: "trip", now: NOW }),
    ).toBeNull();
  });

  it("refuses a shop that cannot take payments, before writing anything", async () => {
    const { db, shop } = await promoContext({ connected: false });
    expect(await createShopPromoCode(db, promoInput(shop.id), fakePromotions())).toEqual({
      ok: false,
      reason: "not_connected",
    });
    expect((await listShopPromoCodes(db, shop.id)).map((promo) => promo.code)).not.toContain(
      "REEF20",
    );
  });

  it("refuses an unusable code, an out-of-range discount, and a backwards window", async () => {
    const { db, shop } = await promoContext();
    expect(
      await createShopPromoCode(db, promoInput(shop.id, { code: "no;pe" }), fakePromotions()),
    ).toEqual({ ok: false, reason: "invalid_code" });
    expect(
      await createShopPromoCode(db, promoInput(shop.id, { discountPercent: 0 }), fakePromotions()),
    ).toEqual({ ok: false, reason: "invalid_discount" });
    expect(
      await createShopPromoCode(
        db,
        promoInput(shop.id, {
          startsAt: new Date("2026-09-01T00:00:00Z"),
          expiresAt: new Date("2026-08-01T00:00:00Z"),
        }),
        fakePromotions(),
      ),
    ).toEqual({ ok: false, reason: "invalid_window" });
  });

  it("refuses a duplicate code for the same shop, however it was typed", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    expect(
      await createShopPromoCode(db, promoInput(shop.id, { code: " ReEf 20 " }), fakePromotions()),
    ).toEqual({ ok: false, reason: "duplicate" });
    expect(
      (await listShopPromoCodes(db, shop.id)).filter((promo) => promo.code === "REEF20"),
    ).toHaveLength(1);
  });
});

describe("getRedeemableShopPromo", () => {
  it("resolves a live, in-scope code", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    const promo = await getRedeemableShopPromo(db, {
      shopId: shop.id,
      code: "reef 20",
      kind: "trip",
      now: NOW,
    });
    expect(promo?.stripePromotionCodeId).toBe("promo_1");
  });

  it("never resolves another shop's code", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    expect(
      await getRedeemableShopPromo(db, {
        shopId: OTHER_SHOP_ID,
        code: "REEF20",
        kind: "trip",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("refuses a code outside its window or its scope, and one the shop switched off", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(
      db,
      promoInput(shop.id, {
        code: "COURSE10",
        scope: "courses",
        expiresAt: new Date("2026-08-01T00:00:00Z"),
      }),
      fakePromotions(),
    );
    const ask = (overrides: Record<string, unknown> = {}) =>
      getRedeemableShopPromo(db, {
        shopId: shop.id,
        code: "COURSE10",
        kind: "course",
        now: NOW,
        ...overrides,
      });

    expect(await ask()).not.toBeNull();
    expect(await ask({ kind: "trip" })).toBeNull(); // a courses-only code on a charter
    expect(await ask({ now: new Date("2026-08-02T00:00:00Z") })).toBeNull(); // expired

    const stored = await promoNamed(db, shop.id, "COURSE10");
    await setShopPromoEnabled(db, shop.id, stored.id, false);
    expect(await ask()).toBeNull();
  });

  it("gives the same empty answer to a code that never existed", async () => {
    const { db, shop } = await promoContext();
    expect(
      await getRedeemableShopPromo(db, {
        shopId: shop.id,
        code: "NOSUCHCODE",
        kind: "trip",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("setShopPromoEnabled", () => {
  it("refuses to touch another shop's code", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    const promo = await promoNamed(db, shop.id, "REEF20");
    expect(await setShopPromoEnabled(db, OTHER_SHOP_ID, promo.id, false)).toBe(false);
    expect((await promoNamed(db, shop.id, "REEF20")).status).toBe("active");
  });

  it("will not enable a code Stripe never minted", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(
      db,
      promoInput(shop.id),
      fakePromotions({
        async createShopPromotion(): Promise<CreateTripPromotionResult> {
          return { status: "failed" };
        },
      }),
    );
    const promo = await promoNamed(db, shop.id, "REEF20");
    // Enabling it would make it validate locally and then fail at checkout.
    expect(await setShopPromoEnabled(db, shop.id, promo.id, true)).toBe(false);
    expect((await promoNamed(db, shop.id, "REEF20")).status).toBe("failed");
  });
});

describe("redemption recording", () => {
  it("counts one redemption per paid checkout, and never twice on a replayed webhook", async () => {
    const { db, shop } = await promoContext();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const created = await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    if (!created.ok) throw new Error("expected promo");

    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Promo Diver",
        email: "promo@example.com",
      },
    ]);
    if (!party.ok) throw new Error("booking failed");

    const started = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds: party.bookings.map((b) => b.bookingId),
        customerEmail: "promo@example.com",
        successUrl: "https://diveday.example/ok",
        cancelUrl: "https://diveday.example/no",
        promotionCode: created.promo.stripePromotionCodeId ?? undefined,
        shopPromo: { id: created.promo.id, code: created.promo.code },
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error(`checkout failed: ${started.reason}`);
    // Snapshotted on the attempt, so a later edit to the code can't rewrite it.
    expect(started.checkout.promoCode).toBe("REEF20");
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(0);

    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(1);

    // Stripe retries deliveries; a second one must not inflate the count.
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(1);
  });

  it("records nothing for an undiscounted checkout", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Full Fare",
        email: "full@example.com",
      },
    ]);
    if (!party.ok) throw new Error("booking failed");
    const started = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds: party.bookings.map((b) => b.bookingId),
        customerEmail: "full@example.com",
        successUrl: "https://diveday.example/ok",
        cancelUrl: "https://diveday.example/no",
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error("checkout failed");
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);

    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(0);
  });
});
