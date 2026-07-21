// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  CheckoutProvider,
  CheckoutSessionLookupResult,
  CheckoutSessionSnapshot,
  CreateCheckoutSessionResult,
} from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  getLatestCheckoutForBooking,
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  refreshCheckoutFromStripe,
  startBookingCheckout,
} from "./checkouts";
import { getBookingPayment, setBookingPayment } from "./payments";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

function fakeCheckout(overrides: Partial<CheckoutProvider> = {}): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request): Promise<CreateCheckoutSessionResult> {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_${counter}`,
        amountTotalCents: request.unitAmountCents * request.quantity,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession(): Promise<CheckoutSessionLookupResult> {
      return { status: "failed" };
    },
    ...overrides,
  };
}

function retrieved(session: Partial<CheckoutSessionSnapshot>): CheckoutSessionLookupResult {
  return {
    status: "ok",
    session: {
      stripeSessionId: "cs_1",
      stripeStatus: "open",
      paymentStatus: "unpaid",
      checkoutUrl: null,
      amountTotalCents: 0,
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
    { shopId: shop.id, tripId: reef.id, fullName: "Pat Party", email: "pat@example.com" },
    { shopId: shop.id, tripId: reef.id, fullName: "Sam Second", email: "sam@example.com" },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const bookingIds = party.bookings.map((b) => b.bookingId);
  return { db, shop, reef, bookingIds };
}

function startInput(shopId: string, tripId: string, bookingIds: string[]) {
  return {
    shopId,
    tripId,
    bookingIds,
    customerEmail: "pat@example.com",
    successUrl: "https://diveday.example/return",
    cancelUrl: "https://diveday.example/cancel",
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

  it("refuses without a connected, charges-enabled Stripe account", async () => {
    const { db, shop } = await seededShopContext();
    const reef = await pricedReefTrip(db, shop.id);
    const [entry] = await getTripRoster(db, reef.id);
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
      note: "cash at counter",
    });
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId);
    const payment = await getBookingPayment(db, shop.id, bookingIds[0]);
    expect(payment?.status).toBe("paid");
  });
});
