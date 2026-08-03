import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CheckoutSessionLookupResult, CheckoutSessionSnapshot } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { fakeCheckout, fakePromotions, recordingCheckout } from "@/test/fakes";
import { cancelBooking, createBookingParty } from "./bookings";
import {
  getLatestCheckoutForBooking,
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  markCheckoutPaymentFailedBySessionId,
  refreshCheckoutFromStripe,
  startBookingCheckout,
} from "./checkouts";
import { joinLastMinuteList } from "./last-minute-list";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookingCheckoutBookings, bookingCheckouts } from "./schema";
import { createShopPromoCode } from "./shop-promos";
import { setShopCurrency } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getActiveTripPromoByCode, sendLastMinuteDealBlast } from "./trip-promos";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * A live trip-scoped last-minute deal on `tripId`, minted the way a shop
 * really mints one — someone on the last-minute list, a real blast, then the
 * diver's typed code resolved back through `getActiveTripPromoByCode`. That
 * whole path leaves both shop-promo columns null on the checkout, which is
 * exactly the condition PAY-M3's last flavor lives in.
 */
async function sentTripDeal(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  tripId: string,
  discountPercent: number,
) {
  await joinLastMinuteList(db, {
    shopId,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  const blast = await sendLastMinuteDealBlast(
    db,
    { shopId, shopSlug: "blue-mantis", tripId, discountPercent },
    fakePromotions({
      async createTripPromotion() {
        return {
          status: "created",
          stripeCouponId: "coupon_trip_deal",
          stripePromotionCodeId: "promo_trip_deal",
        };
      },
    }),
  );
  if (!blast.ok) throw new Error(`last-minute blast failed: ${blast.reason}`);
  const promo = await getActiveTripPromoByCode(db, { shopId, tripId, code: blast.code });
  if (!promo) throw new Error("last-minute code did not resolve");
  return promo;
}

function retrieved(session: Partial<CheckoutSessionSnapshot>): CheckoutSessionLookupResult {
  return {
    status: "ok",
    session: {
      stripeSessionId: "cs_1",
      stripeStatus: "open",
      paymentStatus: "unpaid",
      checkoutUrl: null,
      // Null by default: "Stripe reported no total", not "collected nothing".
      amountTotalCents: null,
      expiresAt: null,
      ...session,
    },
  };
}

const REEF_PRICE_CENTS = 18_000;

/** The seeded reef trip, priced for checkout (seed trips are unpriced by default). */
async function pricedReefTrip(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
) {
  const trips = await upcomingTripsWithCounts(db, shopId, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shopId, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: REEF_PRICE_CENTS,
  });
  return reef;
}

/** A connected, charges-enabled shop with a priced future trip and a fresh two-diver party. */
async function checkoutContext() {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const reef = await pricedReefTrip(db, shop.id);
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Pat Party",
      email: "pat@example.com",
    },
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Sam Second",
      email: "sam@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const bookingIds = party.bookings.map((b) => b.bookingId);
  return { db, shop, reef, bookingIds };
}

/**
 * Stands in for the caller's message bundle. The real callers compose these
 * words from `checkoutLine.*` (docs ADR 20260731-domain-layer-copy-leaks); the
 * marker prefixes make it obvious in an assertion that the label came from the
 * caller and not from `src/db`.
 */
function describeTestLine({ isDeposit, tripTitle }: { isDeposit: boolean; tripTitle: string }) {
  return isDeposit ? `DEPOSIT:${tripTitle}` : `FULL:${tripTitle}`;
}

function startInput(shopId: string, tripId: string, bookingIds: string[]) {
  return {
    shopId,
    tripId,
    bookingIds,
    customerEmail: "pat@example.com",
    successUrl: "https://diveday.example/return",
    cancelUrl: "https://diveday.example/cancel",
    describeLine: describeTestLine,
  };
}

describe("startBookingCheckout", () => {
  it("creates one session for a party and snapshots the per-diver price", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reused).toBe(false);
    expect(outcome.checkout.amountPerDiverCents).toBe(REEF_PRICE_CENTS);
    expect(outcome.checkout.totalCents).toBe(REEF_PRICE_CENTS * 2);
    expect(outcome.checkout.status).toBe("pending");
    expect(outcome.checkout.checkoutUrl).toContain("checkout.stripe.com");

    // Both party members resolve to the same checkout.
    for (const bookingId of bookingIds) {
      const linked = await getLatestCheckoutForBooking(db, shop.id, bookingId);
      expect(linked?.id).toBe(outcome.checkout.id);
    }
  });

  it("charges in the shop's currency and takes its line words from the caller", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await setShopCurrency(db, shop.id, "eur");
    const seen = recordingCheckout();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      seen.provider,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(seen.requests[0]?.currency).toBe("eur");
    // Not `Deposit — …`/the bare title composed inside `src/db`: the caller's
    // marker proves the words came from its own bundle (docs ADR
    // 20260731-domain-layer-copy-leaks). This trip has no deposit policy, so
    // it is the full-fare branch.
    expect(seen.requests[0]?.lineItems[0]?.description).toBe(`FULL:${reef.title}`);
    // Snapshotted onto the row that is evidence of what the diver was asked for.
    expect(outcome.checkout.currency).toBe("eur");
  });

  it("labels a deposit through the caller's deposit branch", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: REEF_PRICE_CENTS,
      depositCents: 5_000,
    });
    const seen = recordingCheckout();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      seen.provider,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checkout.isDeposit).toBe(true);
    expect(seen.requests[0]?.lineItems[0]?.description).toBe(`DEPOSIT:${reef.title}`);
  });

  it("adds a per-diver gear line, always in full even under a deposit policy", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: REEF_PRICE_CENTS,
      depositCents: 5_000,
    });
    const seen = recordingCheckout();
    const outcome = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          { bookingId: bookingIds[0], description: "Rental gear — Pat", amountCents: 6_000 },
        ],
      },
      seen.provider,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checkout.isDeposit).toBe(true);
    // Deposit ($50) x 2 divers, plus the one diver's gear in full ($60) — the
    // deposit tier never discounts gear (docs ADR 20260801-checkout-upsells-rental-gear).
    expect(outcome.checkout.totalCents).toBe(5_000 * 2 + 6_000);
    expect(seen.requests[0]?.lineItems).toHaveLength(2);
    expect(seen.requests[0]?.lineItems[1]).toEqual({
      description: "Rental gear — Pat",
      unitAmountCents: 6_000,
      quantity: 1,
    });

    const [gearBooking, plainBooking] = await Promise.all(
      bookingIds.map((bookingId) => getLatestCheckoutForBooking(db, shop.id, bookingId)),
    );
    expect(gearBooking?.id).toBe(outcome.checkout.id);
    expect(plainBooking?.id).toBe(outcome.checkout.id);

    // The gear subtotal is snapshotted per diver, not just in the checkout total.
    const [gearRow] = await db
      .select({ gearCents: bookingCheckoutBookings.gearCents })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.checkoutId, outcome.checkout.id),
          eq(bookingCheckoutBookings.bookingId, bookingIds[0]),
        ),
      );
    const [noGearRow] = await db
      .select({ gearCents: bookingCheckoutBookings.gearCents })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.checkoutId, outcome.checkout.id),
          eq(bookingCheckoutBookings.bookingId, bookingIds[1]),
        ),
      );
    expect(gearRow?.gearCents).toBe(6_000);
    expect(noGearRow?.gearCents).toBe(0);
  });

  it("drops a gear line for a booking outside the party and a non-positive amount", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const seen = recordingCheckout();
    const outcome = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          {
            bookingId: "00000000-0000-0000-0000-000000000000",
            description: "Ghost",
            amountCents: 1_000,
          },
          { bookingId: bookingIds[0], description: "Zero", amountCents: 0 },
        ],
      },
      seen.provider,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checkout.totalCents).toBe(REEF_PRICE_CENTS * 2);
    expect(seen.requests[0]?.lineItems).toHaveLength(1);
  });

  it("never divides a zero-decimal currency by 100", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await setShopCurrency(db, shop.id, "jpy");
    const seen = recordingCheckout();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      seen.provider,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // ¥18,000 is 18000 minor units, not 1,800,000 — the stored integer is
    // already the currency's minor unit and reaches Stripe untouched
    // (docs ADR 20260731-shop-currency).
    expect(seen.requests[0]?.currency).toBe("jpy");
    expect(seen.requests[0]?.lineItems[0]?.unitAmountCents).toBe(REEF_PRICE_CENTS);
    expect(outcome.checkout.amountPerDiverCents).toBe(REEF_PRICE_CENTS);
    expect(outcome.checkout.totalCents).toBe(REEF_PRICE_CENTS * 2);
  });

  it("keeps a settled checkout's own currency after the shop switches", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await setShopCurrency(db, shop.id, "eur");
    const started = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!started.ok) throw new Error("expected ok");
    await markCheckoutPaidBySessionId(db, started.checkout.stripeSessionId);

    await setShopCurrency(db, shop.id, "jpy");
    const settled = await getLatestCheckoutForBooking(db, shop.id, bookingIds[0]);
    // Evidence, not a view over today's setting.
    expect(settled?.currency).toBe("eur");
    expect(settled?.amountPerDiverCents).toBe(REEF_PRICE_CENTS);
    // …and the payment the cascade wrote carries the same one.
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.currency).toBe("eur");
  });

  it("refuses without a connected, charges-enabled Stripe account", async () => {
    const { db, shop } = await seededShopContext();
    const reef = await pricedReefTrip(db, shop.id);
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [entry.booking.id]),
      fakeCheckout(),
    );
    expect(outcome).toEqual({ ok: false, reason: "not_connected" });
  });

  it("refuses an unpriced trip rather than charging $0", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: null,
    });
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    expect(outcome).toEqual({ ok: false, reason: "unpriced" });
  });

  it("refuses bookings that are not active rows of this shop and trip", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [...bookingIds, crypto.randomUUID()]),
      fakeCheckout(),
    );
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
  });

  it("reuses an open pending checkout instead of minting a second session", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const provider = fakeCheckout();
    const first = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      provider,
    );
    const second = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      provider,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.checkout.id).toBe(first.checkout.id);
  });

  it("mints a fresh session when the party composition changed", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const provider = fakeCheckout();
    const first = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      provider,
    );
    if (!first.ok) throw new Error("first checkout failed");

    // One party member drops out; the old two-seat session must not be
    // reused for the one-seat request — its quantity/total cover a
    // different party, and completing it would mark the wrong bookings paid.
    const second = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [bookingIds[0]]),
      provider,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(false);
    expect(second.checkout.id).not.toBe(first.checkout.id);
    expect(second.checkout.totalCents).toBe(REEF_PRICE_CENTS);
  });

  it("starts a fresh session once the previous one expired", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const provider = fakeCheckout();
    const first = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      provider,
    );
    if (!first.ok) throw new Error("first checkout failed");
    await markCheckoutExpiredBySessionId(db, first.checkout.stripeSessionId);
    const second = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      provider,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(false);
    expect(second.checkout.id).not.toBe(first.checkout.id);
  });

  it("degrades to book-now-pay-later when Stripe refuses the session", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const outcome = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout({
        async createCheckoutSession() {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "checkout_unavailable" });
    // Nothing was recorded: the bookings simply stay unpaid.
    expect(await getLatestCheckoutForBooking(db, shop.id, bookingIds[0])).toBeNull();
  });
});

describe("deposit checkout", () => {
  const DEPOSIT_CENTS = 5_000;

  /** Set a per-diver deposit on the context's reef trip. */
  async function withDeposit(
    db: Awaited<ReturnType<typeof checkoutContext>>["db"],
    shopId: string,
    reef: Awaited<ReturnType<typeof checkoutContext>>["reef"],
  ) {
    await updateTrip(db, shopId, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: REEF_PRICE_CENTS,
      depositCents: DEPOSIT_CENTS,
    });
  }

  it("charges the deposit and settles covered bookings to deposit_paid", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await withDeposit(db, shop.id, reef);

    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.amountPerDiverCents).toBe(DEPOSIT_CENTS);
    expect(start.checkout.isDeposit).toBe(true);
    expect(start.checkout.totalCents).toBe(DEPOSIT_CENTS * 2);

    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("deposit_paid");
      expect(payment?.amountCents).toBe(DEPOSIT_CENTS);
    }
  });
});

describe("checkout completion", () => {
  it("marks every covered booking paid through the shared payment gate", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).not.toBeNull();

    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("paid");
      expect(payment?.amountCents).toBe(start.checkout.amountPerDiverCents);
      expect(payment?.provider).toBe("stripe");
      expect(payment?.providerRef).toBe(start.checkout.stripeSessionId);
    }
  });

  // PAY-H1/H2: `totalCents` is what DiveDay asked for; Stripe's `amount_total`
  // is what settled. The per-booking ledger — which is what a refund later
  // returns — must record the second, split across the party in proportion to
  // what each diver was asked for.
  it("records each diver's share of Stripe's settled total, gear included", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          { bookingId: bookingIds[0], description: "Rental gear — Pat", amountCents: 6_000 },
        ],
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    // Asked: 18000 + 18000 + 6000 gear = 42000. Stripe collected 10% less.
    expect(start.checkout.totalCents).toBe(42_000);

    const completed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      37_800,
    );
    expect(completed?.settledTotalCents).toBe(37_800);

    // 24000/42000 and 18000/42000 of 37800 — and the two sum to exactly what
    // Stripe collected, with no orphan cent left unattributed.
    const gearPayment = await getBookingPayment(db, shop.id, bookingIds[0]);
    const plainPayment = await getBookingPayment(db, shop.id, bookingIds[1]);
    expect(gearPayment?.amountCents).toBe(21_600);
    expect(plainPayment?.amountCents).toBe(16_200);
    expect((gearPayment?.amountCents ?? 0) + (plainPayment?.amountCents ?? 0)).toBe(37_800);
  });

  it("splits a settled total that does not divide evenly without losing or inventing a cent", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    // An odd settled total across two equal shares: someone gets the extra cent.
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, undefined, 33_333);
    const amounts = await Promise.all(
      bookingIds.map(
        async (bookingId) => (await getBookingPayment(db, shop.id, bookingId))?.amountCents ?? 0,
      ),
    );
    expect(amounts.reduce((total, cents) => total + cents, 0)).toBe(33_333);
    expect([...amounts].sort()).toEqual([16_666, 16_667]);
  });

  // A settled figure above what the session asked for would scale *every*
  // share past its own ask (`allocateSettledTotal` splits proportionally and
  // has no basis for deciding whose the surplus is), and the inflated
  // `booking_payments.amountCents` is what a later refund reverses. No Stripe
  // path reaches it today — fixed `price_data` lines, no tax, no adjustable
  // quantity, no tipping — so a figure that arrives over the ask means an
  // assumption has changed, and it must surface as a log line, not as money.
  it("clamps a settled total reported above what the session asked for", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.totalCents).toBe(REEF_PRICE_CENTS * 2);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const completed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      REEF_PRICE_CENTS * 2 + 50_000,
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain("checkout.settled_total_over_asked");
    logged.mockRestore();

    // Clamped before it is stored, so the per-booking rows still sum to
    // exactly the recorded settled total.
    expect(completed?.settledTotalCents).toBe(REEF_PRICE_CENTS * 2);
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.amountCents).toBe(REEF_PRICE_CENTS);
    }
  });

  it("falls back to the asked amounts when Stripe reported no settled total and no code applied", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          { bookingId: bookingIds[0], description: "Rental gear — Pat", amountCents: 6_000 },
        ],
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    // No settled figure exists, and none is invented — a completion is never
    // refused or recorded as zero over a missing total.
    expect(completed?.settledTotalCents).toBeNull();
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(24_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[1]))?.amountCents).toBe(
      REEF_PRICE_CENTS,
    );
  });

  // PAY-M3: same branch, but a shop-wide code was spent. Recording the quoted
  // amounts here makes the per-booking rows sum above what the one shared
  // payment intent captured, and those rows are exactly what a cancellation
  // asks Stripe to reverse — so the first party member to cancel drains more
  // than their share of the pot. `shop_promo_codes.discount_percent` is NOT
  // NULL, so the net is reconstructible without asking Stripe anything.
  it("records a discounted party net of its own code when Stripe reported no settled total", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const promo = await createShopPromoCode(
      db,
      { shopId: shop.id, code: "party25", discountPercent: 25, scope: "all" },
      fakePromotions(),
    );
    if (!promo.ok) throw new Error(`promo creation failed: ${promo.reason}`);

    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          { bookingId: bookingIds[0], description: "Rental gear — Pat", amountCents: 6_000 },
        ],
        promotionCode: promo.promo.stripePromotionCodeId ?? undefined,
        shopPromo: {
          id: promo.promo.id,
          code: promo.promo.code,
          discountPercent: promo.promo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.totalCents).toBe(42_000);

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    // Stripe still reported nothing, so nothing is claimed as its evidence —
    // `settledTotalCents` stays null and a later delivery carrying a real
    // figure can still backfill it.
    expect(completed?.settledTotalCents).toBeNull();

    // $420 asked, 25% off = $315 the intent can have captured, split in
    // proportion to each diver's ask ($240 with gear, $180 without).
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(18_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[1]))?.amountCents).toBe(13_500);
    const recorded = await Promise.all(
      bookingIds.map(
        async (bookingId) => (await getBookingPayment(db, shop.id, bookingId))?.amountCents ?? 0,
      ),
    );
    // The whole point: the per-booking rows no longer sum above the pot.
    expect(recorded.reduce((total, cents) => total + cents, 0)).toBe(31_500);
  });

  // PAY-M3's last flavor. A trip-scoped last-minute deal is Stripe's object end
  // to end: it fills neither promo column, so on this branch it used to be
  // indistinguishable from an undiscounted checkout and the party was recorded
  // at quoted, pre-discount amounts — above what the one shared payment intent
  // captured, which is the figure a later cancellation asks Stripe to reverse.
  // The applied percent is now snapshotted on the row at session-creation time,
  // so the reconstruction has something local and exact to read.
  it("records a party net of a trip-scoped last-minute deal when Stripe reported no settled total", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const tripPromo = await sentTripDeal(db, shop.id, reef.id, 25);

    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        gearLines: [
          { bookingId: bookingIds[0], description: "Rental gear — Pat", amountCents: 6_000 },
        ],
        promotionCode: tripPromo.stripePromotionCodeId ?? undefined,
        tripPromo: {
          id: tripPromo.id,
          code: tripPromo.code,
          discountPercent: tripPromo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.totalCents).toBe(42_000);
    // The snapshot itself: which deal, its code, and the percent Stripe was
    // told to take off — none of which the shop-wide columns can carry.
    expect(start.checkout.tripPromoId).toBe(tripPromo.id);
    expect(start.checkout.promoCode).toBe(tripPromo.code);
    expect(start.checkout.appliedDiscountPercent).toBe(25);
    expect(start.checkout.promoCodeId).toBeNull();

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    // Stripe reported nothing, so nothing is claimed as its evidence.
    expect(completed?.settledTotalCents).toBeNull();

    // $420 asked, 25% off = $315 the intent can have captured, split in
    // proportion to each diver's ask ($240 with gear, $180 without).
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(18_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[1]))?.amountCents).toBe(13_500);
    const recorded = await Promise.all(
      bookingIds.map(
        async (bookingId) => (await getBookingPayment(db, shop.id, bookingId))?.amountCents ?? 0,
      ),
    );
    // The whole point: the per-booking rows no longer sum above the pot.
    expect(recorded.reduce((total, cents) => total + cents, 0)).toBe(31_500);
  });

  // A trip deal spends nothing on the checkout row unless it is actually handed
  // to Stripe. Snapshotting a promotion the session never applied would
  // understate what it captured and under-refund every diver on it.
  it("snapshots no discount when a resolved deal was never handed to Stripe", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const tripPromo = await sentTripDeal(db, shop.id, reef.id, 25);

    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        // Resolved, but no `promotionCode` — Stripe is told nothing.
        tripPromo: {
          id: tripPromo.id,
          code: tripPromo.code,
          discountPercent: tripPromo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.appliedDiscountPercent).toBeNull();
    expect(start.checkout.tripPromoId).toBeNull();

    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.amountCents).toBe(REEF_PRICE_CENTS);
    }
  });

  // Stripe Checkout takes one promotion code per session, so at most one
  // source can ever be the one it applied. A caller handing over both must not
  // record two — the row would claim a shop-wide redemption that was never
  // spent, and the reconstruction would have two percents and no way to tell
  // which was Stripe's. The trip deal wins (the caller's own resolution order)
  // and the shop-wide code is recorded nowhere.
  it("records one promo source when a caller supplies both", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const tripPromo = await sentTripDeal(db, shop.id, reef.id, 25);
    const shopPromo = await createShopPromoCode(
      db,
      { shopId: shop.id, code: "both10", discountPercent: 10, scope: "all" },
      fakePromotions(),
    );
    if (!shopPromo.ok) throw new Error(`promo creation failed: ${shopPromo.reason}`);

    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        promotionCode: tripPromo.stripePromotionCodeId ?? undefined,
        tripPromo: {
          id: tripPromo.id,
          code: tripPromo.code,
          discountPercent: tripPromo.discountPercent,
        },
        shopPromo: {
          id: shopPromo.promo.id,
          code: shopPromo.promo.code,
          discountPercent: shopPromo.promo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    expect(start.checkout.tripPromoId).toBe(tripPromo.id);
    expect(start.checkout.promoCodeId).toBeNull();
    expect(start.checkout.appliedDiscountPercent).toBe(25);
  });

  // Rows written before `applied_discount_percent` existed carry no snapshot,
  // and one of them can still be completed today by a late webhook. There is
  // nothing local left to reconstruct a trip deal's discount from, and the trip
  // itself must never be consulted — a live deal on the trip says nothing about
  // what *this* session applied, and reading it would discount full-price
  // divers. So the row keeps the conservative pre-column answer: the asked
  // amounts. Never a refusal, never zero.
  it("still completes a row predating the discount snapshot, at the asked amounts", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const tripPromo = await sentTripDeal(db, shop.id, reef.id, 25);
    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        promotionCode: tripPromo.stripePromotionCodeId ?? undefined,
        tripPromo: {
          id: tripPromo.id,
          code: tripPromo.code,
          discountPercent: tripPromo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    // Rewind the row to what the migration left behind: the discount columns
    // empty, everything else exactly as it was.
    await db
      .update(bookingCheckouts)
      .set({ appliedDiscountPercent: null, tripPromoId: null, promoCode: null })
      .where(eq(bookingCheckouts.id, start.checkout.id));

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(completed?.status).toBe("completed");
    expect(completed?.settledTotalCents).toBeNull();
    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("paid");
      expect(payment?.amountCents).toBe(REEF_PRICE_CENTS);
    }
  });

  it("prefers Stripe's own settled total over the reconstruction whenever there is one", async () => {
    // The reconstruction is a fallback, never a second opinion: a real
    // `amount_total` (a promo that only partly applied, a code Stripe refused)
    // always wins over what the code's percentage suggests (PAY-M3).
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const promo = await createShopPromoCode(
      db,
      { shopId: shop.id, code: "half50", discountPercent: 50, scope: "all" },
      fakePromotions(),
    );
    if (!promo.ok) throw new Error(`promo creation failed: ${promo.reason}`);
    const start = await startBookingCheckout(
      db,
      {
        ...startInput(shop.id, reef.id, bookingIds),
        promotionCode: promo.promo.stripePromotionCodeId ?? undefined,
        shopPromo: {
          id: promo.promo.id,
          code: promo.promo.code,
          discountPercent: promo.promo.discountPercent,
        },
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    // Stripe says it took $300 of the $360 asked, not the $180 a 50% code
    // would imply.
    const completed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      30_000,
    );
    expect(completed?.settledTotalCents).toBe(30_000);
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.amountCents).toBe(15_000);
    }
  });

  it("splits a zero-decimal currency's settled total in whole minor units", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    await setShopCurrency(db, shop.id, "jpy");
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    // ¥36,000 asked, ¥32,401 settled — the odd yen goes to exactly one diver;
    // there is no sub-unit to hide it in (docs ADR 20260731-shop-currency).
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, undefined, 32_401);
    const amounts = await Promise.all(
      bookingIds.map(
        async (bookingId) => (await getBookingPayment(db, shop.id, bookingId))?.amountCents ?? 0,
      ),
    );
    expect([...amounts].sort()).toEqual([16_200, 16_201]);
    expect(amounts.every(Number.isInteger)).toBe(true);
  });

  it("never marks a cancelled booking paid from a checkout completed after the cancel (security review finding)", async () => {
    // A diver can cancel/reschedule their own booking (docs ADR
    // 20260727-diver-self-service-cancel) while a Stripe Checkout for that
    // same booking is still open in another tab; completing it afterward
    // must not attribute the payment to a booking that no longer exists.
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [bookingIds[0]]),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await cancelBooking(db, shop.id, bookingIds[0]);

    const completed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    // The checkout itself still completes — a retried webhook delivery must
    // not reprocess it — but the cancelled booking is never marked paid.
    expect(completed?.status).toBe("completed");
    const payment = await getBookingPayment(db, shop.id, bookingIds[0]);
    expect(payment).toBeNull();
  });

  it("ignores a completion for a checkout already marked expired locally (Codex finding)", async () => {
    // Marking a checkout `expired` locally (a departed/cancelled trip, a
    // booking settled elsewhere, or a reactivated-booking reschedule
    // retiring its earlier abandoned session) doesn't reach Stripe — the
    // hosted session can still genuinely be completed there afterward, on
    // its own longer clock. A completion arriving for a non-pending
    // checkout must be ignored, not resurrect it into "completed" and
    // attribute a stale price to whatever the booking is now.
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [bookingIds[0]]),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutExpiredBySessionId(db, start.checkout.stripeSessionId);

    const result = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(result).toBeNull();
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, start.checkout.id));
    expect(row?.status).toBe("expired");
    expect(row?.completedAt).toBeNull();
    expect(await getBookingPayment(db, shop.id, bookingIds[0])).toBeNull();
  });

  it("is idempotent: a second completion changes nothing", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    const first = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    const second = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(second?.completedAt).toEqual(first?.completedAt);
  });

  it("ignores an unknown session id", async () => {
    const { db } = await checkoutContext();
    expect(await markCheckoutPaidBySessionId(db, "cs_unknown")).toBeNull();
    expect(await markCheckoutExpiredBySessionId(db, "cs_unknown")).toBeNull();
  });

  // Defense-in-depth (security review finding): a webhook event whose
  // top-level `account` disagrees with the checkout's own connected account
  // is refused even though the session id alone already matched a row.
  it("refuses to mark a checkout paid or expired when the expected account doesn't match", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    expect(
      await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, "acct_evil"),
    ).toBeNull();
    expect(
      await markCheckoutExpiredBySessionId(db, start.checkout.stripeSessionId, "acct_evil"),
    ).toBeNull();
    for (const bookingId of bookingIds) {
      expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();
    }

    // The real account still works.
    const completed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      "acct_test",
    );
    expect(completed?.status).toBe("completed");
  });

  it("never expires a checkout that already completed", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(await markCheckoutExpiredBySessionId(db, start.checkout.stripeSessionId)).toBeNull();
    const payment = await getBookingPayment(db, shop.id, bookingIds[0]);
    expect(payment?.status).toBe("paid");
  });

  // CR-004: fault injection — simulate a crash between the checkout-status
  // write and the booking-payment cascade (as could happen before both were
  // one transaction) by forcing the checkout straight to "completed" without
  // ever writing the booking payment, then prove a replay of the same
  // webhook self-heals rather than short-circuiting on "already completed".
  it("replay repairs a booking payment left unwritten by a prior partial run", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    await db
      .update(bookingCheckouts)
      .set({ status: "completed", completedAt: nowDate() })
      .where(eq(bookingCheckouts.id, start.checkout.id));
    for (const bookingId of bookingIds) {
      expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();
    }

    const replayed = await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect(replayed?.status).toBe("completed");
    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("paid");
      expect(payment?.providerRef).toBe(start.checkout.stripeSessionId);
    }
  });

  it("backfills a settled total a first completion never carried, and never rewrites one it did", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    // A first delivery with no total at all (an odd payload, an internal
    // repair run) settles the bookings at the asked price…
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(
      REEF_PRICE_CENTS,
    );

    // …and a later one carrying Stripe's figure repairs both the checkout and
    // the per-booking amounts.
    const repaired = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      30_000,
    );
    expect(repaired?.settledTotalCents).toBe(30_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(15_000);

    // A third delivery claiming something else never overwrites the recorded
    // evidence — the first settled figure stands.
    const replayed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      1,
    );
    expect(replayed?.settledTotalCents).toBe(30_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(15_000);
  });

  // CR-004: a duplicate or out-of-order webhook must never regress a booking
  // a human already refunded back to "paid".
  it("does not regress an already-refunded booking back to paid on a duplicate webhook", async () => {
    const { db, shop, reef, bookingIds } = await checkoutContext();
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);

    const refundedBookingId = bookingIds[0];
    if (!refundedBookingId) throw new Error("expected at least one booking");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: refundedBookingId,
      status: "refunded",
      amountCents: 0,
      currency: "usd",
      provider: "stripe",
      providerRef: "re_manual",
    });

    // A delayed/duplicate delivery of the same "paid" event arrives late.
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);

    const payment = await getBookingPayment(db, shop.id, refundedBookingId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.providerRef).toBe("re_manual");
  });
});

describe("refreshCheckoutFromStripe", () => {
  async function pendingCheckout() {
    const context = await checkoutContext();
    const start = await startBookingCheckout(
      context.db,
      startInput(context.shop.id, context.reef.id, context.bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    return { ...context, checkout: start.checkout };
  }

  it("marks paid only from Stripe's API answer, never the return URL", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return retrieved({ stripeStatus: "complete", paymentStatus: "paid" });
        },
      }),
    );
    expect(refreshed?.status).toBe("completed");
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.status).toBe("paid");
  });

  it("records the settled total the direct API read already carries", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return retrieved({
            stripeStatus: "complete",
            paymentStatus: "paid",
            amountTotalCents: 30_000,
          });
        },
      }),
    );
    // The webhook-less fallback must land on the same money the webhook would.
    expect(refreshed?.settledTotalCents).toBe(30_000);
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.amountCents).toBe(15_000);
  });

  it("leaves a still-open unpaid session pending", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return retrieved({ stripeStatus: "open", paymentStatus: "unpaid" });
        },
      }),
    );
    expect(refreshed?.status).toBe("pending");
    expect(await getBookingPayment(db, shop.id, bookingIds[0])).toBeNull();
  });

  it("marks an expired session expired without touching payments", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return retrieved({ stripeStatus: "expired", paymentStatus: "unpaid" });
        },
      }),
    );
    expect(refreshed?.status).toBe("expired");
    expect(await getBookingPayment(db, shop.id, bookingIds[0])).toBeNull();
  });

  it("keeps current state when Stripe is unreachable, and is tenant-scoped", async () => {
    const { db, shop, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(db, shop.id, checkout.id, fakeCheckout());
    expect(refreshed?.status).toBe("pending");
    expect(await refreshCheckoutFromStripe(db, crypto.randomUUID(), checkout.id)).toBeNull();
  });

  it("does not call Stripe again for a settled checkout", async () => {
    const { db, shop, checkout } = await pendingCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId);
    let calls = 0;
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      fakeCheckout({
        async retrieveCheckoutSession() {
          calls += 1;
          return { status: "failed" };
        },
      }),
    );
    expect(refreshed?.status).toBe("completed");
    expect(calls).toBe(0);
  });

  it("a webhook completion arriving after a manual staff payment mark stays consistent", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    // Staff marked cash "paid" at the counter before the webhook landed.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: bookingIds[0],
      status: "paid",
      currency: "usd",
      note: "cash at counter",
    });
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId);
    const payment = await getBookingPayment(db, shop.id, bookingIds[0]);
    expect(payment?.status).toBe("paid");
  });
});

/**
 * PAY-L1. `checkout.session.async_payment_failed` was unhandled: a
 * delayed-notification payment method emits `checkout.session.completed` with
 * `payment_status: "unpaid"` (which settles nothing on purpose), then, when
 * the money never arrives, the failure event — which nothing listened for. The
 * row sat `pending` forever, still offering a dead recovery link.
 */
describe("markCheckoutPaymentFailedBySessionId", () => {
  async function pendingCheckoutFor(bookingCount = 1) {
    const context = await checkoutContext();
    const bookingIds = context.bookingIds.slice(0, bookingCount);
    const start = await startBookingCheckout(
      context.db,
      startInput(context.shop.id, context.reef.id, bookingIds),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    return { ...context, bookingIds, checkout: start.checkout };
  }

  async function checkoutRow(
    db: Awaited<ReturnType<typeof checkoutContext>>["db"],
    checkoutId: string,
  ) {
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    return row ?? null;
  }

  it("releases the pending state and records why, leaving payments untouched", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckoutFor();
    const failed = await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId);
    expect(failed?.status).toBe("expired");
    expect(failed?.asyncPaymentFailedAt).toBeInstanceOf(Date);
    // Nothing was ever captured, so nothing is released on the payment side —
    // and writing "unpaid" is the one thing that could regress a booking a
    // human had since marked paid or waived.
    expect(await getBookingPayment(db, shop.id, bookingIds[0])).toBeNull();
  });

  it("is idempotent: a redelivered failure matches nothing the second time", async () => {
    const { db, checkout } = await pendingCheckoutFor();
    const first = await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId);
    const second = await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId);
    expect(first?.status).toBe("expired");
    expect(second).toBeNull();
    // The first failure's timestamp is not rewritten by the replay.
    const row = await checkoutRow(db, checkout.id);
    expect(row?.asyncPaymentFailedAt).toEqual(first?.asyncPaymentFailedAt);
  });

  // The adversarial ordering: Stripe reports the payment settled, then a
  // stale/duplicate failure event lands. It must never demote settled money.
  it("never demotes a checkout Stripe already reported paid", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckoutFor();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId);

    expect(await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId)).toBeNull();
    const row = await checkoutRow(db, checkout.id);
    expect(row?.status).toBe("completed");
    expect(row?.asyncPaymentFailedAt).toBeNull();
    expect((await getBookingPayment(db, shop.id, bookingIds[0]))?.status).toBe("paid");
  });

  // …and the reverse ordering: a failure arrives first, then a completion. The
  // existing disqualification check in markCheckoutPaidBySessionId must refuse
  // to resurrect it, exactly as it does for a locally-expired session.
  it("a completion arriving after a recorded failure cannot resurrect the checkout", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckoutFor();
    await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId);

    expect(await markCheckoutPaidBySessionId(db, checkout.stripeSessionId)).toBeNull();
    const row = await checkoutRow(db, checkout.id);
    expect(row?.status).toBe("expired");
    expect(row?.completedAt).toBeNull();
    expect(await getBookingPayment(db, shop.id, bookingIds[0])).toBeNull();
  });

  it("refuses a failure whose event belongs to a different connected account", async () => {
    const { db, checkout } = await pendingCheckoutFor();
    expect(
      await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId, "acct_someone_else"),
    ).toBeNull();
    expect((await checkoutRow(db, checkout.id))?.status).toBe("pending");

    expect(
      await markCheckoutPaymentFailedBySessionId(
        db,
        checkout.stripeSessionId,
        checkout.stripeAccountId,
      ),
    ).not.toBeNull();
  });

  it("ignores an unknown session id", async () => {
    const { db } = await checkoutContext();
    expect(await markCheckoutPaymentFailedBySessionId(db, "cs_unknown")).toBeNull();
  });

  // A failed async payment means the party's seats stay unpaid — the whole
  // party, not just the submitter. Nothing may be attributed to any of them.
  it("leaves every booking of a party checkout unpaid", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckoutFor(2);
    await markCheckoutPaymentFailedBySessionId(db, checkout.stripeSessionId);
    for (const bookingId of bookingIds) {
      expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();
    }
  });
});
