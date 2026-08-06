import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { fakeCheckout, fakePromotions } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { shopPromoCodes, shopPromoRedemptions } from "./schema";
import {
  createShopPromoCode,
  deleteShopPromoCode,
  getRedeemableShopPromo,
  getShopPromoByCode,
  listShopPromoCodes,
  retryShopPromoCode,
  setShopPromoEnabled,
} from "./shop-promos";
import {
  disconnectShopStripeAccount,
  setShopStripeAccountStatus,
  upsertShopStripeAccount,
} from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const NOW = new Date("2026-07-29T12:00:00.000Z");

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
  const { promos } = await listShopPromoCodes(db, shopId);
  const found = promos.find((promo) => promo.code === code);
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

type TestDb = Awaited<ReturnType<typeof seededShopContext>>["db"];

/** The seeded reef departure, given a price so a checkout can be raised against it. */
async function pricedReefTrip(db: TestDb, shopId: string) {
  const trips = await upcomingTripsWithCounts(db, shopId, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shopId, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 18_000,
  });
  return reef;
}

/**
 * One paid checkout that spends `promo` — the booking → checkout → webhook path
 * a redemption actually arrives through, so a test needing a code with usage on
 * it doesn't restate the whole thing.
 *
 * `checkout` is the caller's, not a fresh one per call: each `fakeCheckout()`
 * numbers its sessions from `cs_1`, so two of them collide on
 * `booking_checkouts_stripe_session_unique` the moment a test redeems twice.
 */
async function redeemPromoOnce(
  db: TestDb,
  shopId: string,
  tripId: string,
  promo: {
    id: string;
    code: string;
    discountPercent: number;
    stripePromotionCodeId: string | null;
  },
  email: string,
  checkout: ReturnType<typeof fakeCheckout>,
) {
  const party = await createBookingParty(db, [
    { actor: "staff", shopId, tripId, fullName: `Promo Diver ${email}`, email },
  ]);
  if (!party.ok) throw new Error("booking failed");
  const started = await startBookingCheckout(
    db,
    {
      shopId,
      tripId,
      bookingIds: party.bookings.map((booking) => booking.bookingId),
      customerEmail: email,
      successUrl: "https://diveday.example/ok",
      cancelUrl: "https://diveday.example/no",
      describeLine: ({ tripTitle }) => tripTitle,
      promotionCode: promo.stripePromotionCodeId ?? undefined,
      shopPromo: { id: promo.id, code: promo.code, discountPercent: promo.discountPercent },
    },
    checkout,
  );
  if (!started.ok) throw new Error(`checkout failed: ${started.reason}`);
  await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId, undefined, 14_400);
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
        async createShopPromotion() {
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
    expect((await listShopPromoCodes(db, shop.id)).promos.map((promo) => promo.code)).not.toContain(
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
      (await listShopPromoCodes(db, shop.id)).promos.filter((promo) => promo.code === "REEF20"),
    ).toHaveLength(1);
  });
});

describe("listShopPromoCodes pagination", () => {
  it("pages by number and never repeats or skips a code", async () => {
    const { db, shop } = await promoContext();
    for (const code of ["REEFA", "REEFB", "REEFC"]) {
      await createShopPromoCode(db, promoInput(shop.id, { code }), fakePromotions());
    }

    const all = await listShopPromoCodes(db, shop.id);
    expect(all.pageCount).toBe(1);
    expect(all.promos.length).toBeGreaterThanOrEqual(3);
    expect(all.total).toBe(all.promos.length);

    const seen: string[] = [];
    for (let page = 1; page <= all.total; page++) {
      const chunk = await listShopPromoCodes(db, shop.id, { page, limit: 1 });
      expect(chunk.page).toBe(page);
      expect(chunk.pageCount).toBe(all.total);
      expect(chunk.total).toBe(all.total);
      seen.push(...chunk.promos.map((promo) => promo.id));
    }
    expect(seen).toEqual(all.promos.map((promo) => promo.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("counts codes, not redemptions, so a busy code cannot invent pages", async () => {
    const { db, shop } = await promoContext();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const created = await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    if (!created.ok) throw new Error("expected promo");
    const reef = await pricedReefTrip(db, shop.id);

    const before = await listShopPromoCodes(db, shop.id);
    // Two redemptions of one code. The page's `leftJoin` emits a row per
    // redemption, so a count taken off that joined shape would report this
    // code twice and hand the pager a page that does not exist.
    const checkout = fakeCheckout();
    await redeemPromoOnce(db, shop.id, reef.id, created.promo, "one@example.com", checkout);
    await redeemPromoOnce(db, shop.id, reef.id, created.promo, "two@example.com", checkout);

    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(2);
    const after = await listShopPromoCodes(db, shop.id);
    expect(after.total).toBe(before.total);
    expect(after.pageCount).toBe(before.pageCount);
    expect(after.promos).toHaveLength(before.promos.length);
  });

  it("goes back a page as well as forward, and clamps a nonsensical one", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id, { code: "REEFA" }), fakePromotions());
    await createShopPromoCode(db, promoInput(shop.id, { code: "REEFB" }), fakePromotions());

    const first = await listShopPromoCodes(db, shop.id, { page: 1, limit: 1 });
    const second = await listShopPromoCodes(db, shop.id, { page: 2, limit: 1 });
    const back = await listShopPromoCodes(db, shop.id, { page: second.page - 1, limit: 1 });
    expect(back.promos.map((promo) => promo.id)).toEqual(first.promos.map((promo) => promo.id));

    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await listShopPromoCodes(db, shop.id, { page: requested, limit: 1 });
      expect(clamped.page).toBe(1);
      expect(clamped.promos.map((promo) => promo.id)).toEqual(
        first.promos.map((promo) => promo.id),
      );
    }

    const past = await listShopPromoCodes(db, shop.id, { page: 99, limit: 1 });
    expect(past.page).toBe(past.pageCount);
    expect(past.promos).toHaveLength(1);
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
        async createShopPromotion() {
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
        describeLine: ({ tripTitle }) => tripTitle,
        promotionCode: created.promo.stripePromotionCodeId ?? undefined,
        shopPromo: {
          id: created.promo.id,
          code: created.promo.code,
          discountPercent: created.promo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error(`checkout failed: ${started.reason}`);
    // Snapshotted on the attempt, so a later edit to the code can't rewrite it.
    expect(started.checkout.promoCode).toBe("REEF20");
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(0);

    // 20% off $180 — Stripe reports the $144 it actually collected.
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId, undefined, 14_400);
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(1);
    // The redemption records what the shop received with this code applied,
    // copied from Stripe's own total — not the $180 that was asked (PAY-H2).
    const [redemption] = await db
      .select()
      .from(shopPromoRedemptions)
      .where(eq(shopPromoRedemptions.promoCodeId, created.promo.id));
    expect(redemption?.amountChargedCents).toBe(14_400);

    // Stripe retries deliveries; a second one must not inflate the count.
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId, undefined, 14_400);
    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(1);
    expect(
      (
        await db
          .select()
          .from(shopPromoRedemptions)
          .where(eq(shopPromoRedemptions.promoCodeId, created.promo.id))
      ).length,
    ).toBe(1);
  });

  it("records the total net of this code's own discount when Stripe reported no settled figure", async () => {
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
        describeLine: ({ tripTitle }) => tripTitle,
        promotionCode: created.promo.stripePromotionCodeId ?? undefined,
        shopPromo: {
          id: created.promo.id,
          code: created.promo.code,
          discountPercent: created.promo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error(`checkout failed: ${started.reason}`);

    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);
    const [redemption] = await db
      .select()
      .from(shopPromoRedemptions)
      .where(eq(shopPromoRedemptions.promoCodeId, created.promo.id));
    // No settled figure exists, so the redemption is recorded at $180 less
    // this code's own 20% — never the pre-discount $180 the diver was quoted,
    // which would overstate every unsettled redemption in this history
    // (PAY-M3).
    expect(redemption?.amountChargedCents).toBe(14_400);
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
        describeLine: ({ tripTitle }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error("checkout failed");
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);

    expect((await promoNamed(db, shop.id, "REEF20")).timesRedeemed).toBe(0);
  });
});

/** A promo row stuck failed — Stripe refused the first attempt. */
async function failedPromoContext(overrides: Record<string, unknown> = {}) {
  const { db, shop } = await promoContext();
  await createShopPromoCode(
    db,
    promoInput(shop.id, overrides),
    fakePromotions({
      async createShopPromotion() {
        return { status: "failed" };
      },
    }),
  );
  const promo = await promoNamed(db, shop.id, (overrides.code as string | undefined) ?? "REEF20");
  return { db, shop, promo };
}

describe("retryShopPromoCode", () => {
  it("mints the code on Stripe and flips it active, unchanged from how it was entered", async () => {
    const { db, shop, promo } = await failedPromoContext();
    const outcome = await retryShopPromoCode(db, shop.id, promo.id, fakePromotions());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.promo.status).toBe("active");
    expect(outcome.promo.code).toBe("REEF20");
    expect(outcome.promo.discountPercent).toBe(20);
    expect(outcome.promo.stripePromotionCodeId).toBe("promo_1");

    expect(
      await getRedeemableShopPromo(db, { shopId: shop.id, code: "REEF20", kind: "trip", now: NOW }),
    ).not.toBeNull();
  });

  it("leaves the code failed when Stripe refuses again", async () => {
    const { db, shop, promo } = await failedPromoContext();
    const outcome = await retryShopPromoCode(
      db,
      shop.id,
      promo.id,
      fakePromotions({
        async createShopPromotion() {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "stripe_failed" });
    expect((await promoNamed(db, shop.id, "REEF20")).status).toBe("failed");
  });

  it("refuses a code that is not failed — active, disabled, or already retried", async () => {
    const { db, shop } = await promoContext();
    const created = await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    if (!created.ok) throw new Error("expected promo");

    expect(await retryShopPromoCode(db, shop.id, created.promo.id, fakePromotions())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses another shop's failed code", async () => {
    const { db, promo } = await failedPromoContext();
    expect(await retryShopPromoCode(db, OTHER_SHOP_ID, promo.id, fakePromotions())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses to retry once Stripe is disconnected between the failed attempt and now", async () => {
    const { db, shop, promo } = await failedPromoContext();
    await disconnectShopStripeAccount(db, "acct_test");

    expect(await retryShopPromoCode(db, shop.id, promo.id, fakePromotions())).toEqual({
      ok: false,
      reason: "not_connected",
    });
    // Refusing to retry must not resurrect the row some other way.
    expect((await promoNamed(db, shop.id, "REEF20")).status).toBe("failed");
  });
});

describe("deleteShopPromoCode", () => {
  it("deletes a failed code", async () => {
    const { db, shop, promo } = await failedPromoContext();
    expect(await deleteShopPromoCode(db, shop.id, promo.id)).toBe(true);
    expect(await getShopPromoByCode(db, shop.id, "REEF20")).toBeNull();
  });

  it("deletes a pending code — one whose Stripe call never finished", async () => {
    const { db, shop } = await promoContext();
    const stuck = await db
      .insert(shopPromoCodes)
      .values({ shopId: shop.id, code: "STUCK10", discountPercent: 10, scope: "all" })
      .returning();
    const row = stuck[0];
    if (!row) throw new Error("expected inserted row");
    expect(row.status).toBe("pending");

    expect(await deleteShopPromoCode(db, shop.id, row.id)).toBe(true);
    expect(await getShopPromoByCode(db, shop.id, "STUCK10")).toBeNull();
  });

  it("refuses to delete a live or disabled code — those go through setShopPromoEnabled instead", async () => {
    const { db, shop } = await promoContext();
    const created = await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    if (!created.ok) throw new Error("expected promo");

    expect(await deleteShopPromoCode(db, shop.id, created.promo.id)).toBe(false);
    expect(await getShopPromoByCode(db, shop.id, "REEF20")).not.toBeNull();

    await setShopPromoEnabled(db, shop.id, created.promo.id, false);
    expect(await deleteShopPromoCode(db, shop.id, created.promo.id)).toBe(false);
    expect((await getShopPromoByCode(db, shop.id, "REEF20"))?.status).toBe("disabled");
  });

  it("refuses another shop's code", async () => {
    const { db, promo } = await failedPromoContext();
    expect(await deleteShopPromoCode(db, OTHER_SHOP_ID, promo.id)).toBe(false);
    expect(await getShopPromoByCode(db, promo.shopId, "REEF20")).not.toBeNull();
  });
});
