// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CheckoutProvider, RefundCheckoutResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { getBookingPayment, setBookingPayment } from "./payments";
import { refundBookingOnCancellation } from "./refunds";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const REEF_PRICE_CENTS = 18_000;

/** Every refund POST the provider was asked to make, in order. */
type RefundCall = { sessionId: string; idempotencyKey: string; amountCents?: number };

function fakeCheckout(
  refund: RefundCheckoutResult,
  refundCalls: RefundCall[] = [],
): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request) {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_${counter}`,
        amountTotalCents: request.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession(_accountId, stripeSessionId, idempotencyKey, amountCents) {
      refundCalls.push({ sessionId: stripeSessionId, idempotencyKey, amountCents });
      return refund;
    },
  };
}

/**
 * A connected shop with a priced reef trip, a *party of two* paid in full
 * through one Stripe checkout (so both seats share a payment intent, the
 * condition PAY-C1 lives in), and a stated cancellation window. `windowHours`
 * null states no window. `gearCents` prices rental gear for the first diver
 * only; `settledTotalCents` stands in for Stripe's own `amount_total` on the
 * completion, so a discounted checkout can be exercised end to end.
 */
async function paidBookingContext(
  windowHours: number | null = 48,
  options: { gearCents?: number; settledTotalCents?: number } = {},
) {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: REEF_PRICE_CENTS,
    cancellationWindowHours: windowHours,
  });
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
  const bookingIds = party.bookings.map((booking) => booking.bookingId);
  const bookingId = bookingIds[0];

  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds,
      customerEmail: "pat@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
      gearLines: options.gearCents
        ? [{ bookingId, description: "Rental gear — Pat", amountCents: options.gearCents }]
        : undefined,
    },
    fakeCheckout({ status: "refunded", refundId: "re_seed" }),
  );
  if (!start.ok) throw new Error("checkout start failed");
  await markCheckoutPaidBySessionId(
    db,
    start.checkout.stripeSessionId,
    undefined,
    options.settledTotalCents ?? null,
  );

  const insideWindow = new Date(reef.startsAt.getTime() - 72 * 60 * 60 * 1000);
  const pastDeadline = new Date(reef.startsAt.getTime() - 1 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, bookingIds, insideWindow, pastDeadline };
}

describe("refundBookingOnCancellation", () => {
  it("refunds a Stripe payment in full inside the window and flips the row to refunded", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded", refundId: "re_ok" }),
    );
    expect(outcome).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    const payment = await getBookingPayment(db, shop.id, bookingId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.amountCents).toBe(REEF_PRICE_CENTS);
    expect(payment?.providerRef).toBe("re_ok");
  });

  it("forfeits past the deadline and moves no money", async () => {
    const { db, shop, bookingId, pastDeadline } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: pastDeadline },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "forfeit" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("declines to automate when the trip states no window", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(null);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "no_policy" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("hands a counter (non-Stripe) payment to staff", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: REEF_PRICE_CENTS,
      note: "cash at counter",
    });
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "manual", reason: "not_stripe" });
  });

  it("hands a counter payment with no recorded amount to staff, never silently drops it", async () => {
    // The realistic manual mark: staff record "paid" with no amount. A cancel
    // inside the window still owes the diver a refund — it must reach staff.
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      note: "cash at counter",
    });
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "manual", reason: "not_stripe" });
  });

  it("routes a Stripe not_refundable (record/Stripe mismatch) to staff review", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "not_refundable" }),
    );
    expect(outcome).toEqual({ status: "manual", reason: "not_refundable" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("reports unpaid when nothing was captured", async () => {
    const { db, shop, reef, insideWindow } = await paidBookingContext(48);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Unpaid Uma",
        email: "uma@example.com",
      },
    ]);
    if (!party.ok) throw new Error("booking failed");
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId: party.bookings[0].bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "unpaid" });
  });

  it("leaves the payment paid when Stripe refuses the refund", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "failed" }),
    );
    expect(outcome).toEqual({ status: "failed" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  // PAY-C1: two divers on one payment intent, each cancelling for the same
  // amount. A key derived from the payment intent + amount would be identical
  // for both, so Stripe would replay the first refund and return it again —
  // both local rows would read "refunded" while only one diver got money back.
  it("issues two distinctly-keyed refunds when two party members cancel for the same amount", async () => {
    const { db, shop, bookingIds, insideWindow } = await paidBookingContext(48);
    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout({ status: "refunded", refundId: "re_party" }, refundCalls);

    for (const bookingId of bookingIds) {
      const outcome = await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId, now: insideWindow },
        provider,
      );
      expect(outcome).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    }

    expect(refundCalls).toHaveLength(2);
    // Same session, same amount — and still two different keys, so Stripe
    // treats them as the two separate refunds they are.
    expect(refundCalls[0].sessionId).toBe(refundCalls[1].sessionId);
    expect(refundCalls[0].amountCents).toBe(refundCalls[1].amountCents);
    expect(refundCalls[0].idempotencyKey).not.toBe(refundCalls[1].idempotencyKey);
    expect(refundCalls[0].idempotencyKey).toBeTruthy();

    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("refunded");
      expect(payment?.amountCents).toBe(REEF_PRICE_CENTS);
    }
  });

  // PAY-H1/H2 end to end: the refund is whatever Stripe actually collected for
  // this diver — their discounted trip fee *and* their gear — never the
  // pre-discount, gear-less list price the shop quoted.
  it("refunds what Stripe collected on a discounted checkout, gear included", async () => {
    const GEAR_CENTS = 6_000;
    // Asked: (18000 + 18000) + 6000 gear = 42000. Stripe took 10% off: 37800.
    const { db, shop, bookingIds, insideWindow } = await paidBookingContext(48, {
      gearCents: GEAR_CENTS,
      settledTotalCents: 37_800,
    });
    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout({ status: "refunded", refundId: "re_promo" }, refundCalls);

    // The gear diver's share of what settled: 24000/42000 of 37800 = 21600.
    const gearOutcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId: bookingIds[0], now: insideWindow },
      provider,
    );
    expect(gearOutcome).toEqual({ status: "refunded", amountCents: 21_600 });
    // The other diver's share: 18000/42000 of 37800 = 16200 — less than the
    // $180 list price, which is exactly the money the shop kept.
    const plainOutcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId: bookingIds[1], now: insideWindow },
      provider,
    );
    expect(plainOutcome).toEqual({ status: "refunded", amountCents: 16_200 });

    expect(refundCalls.map((call) => call.amountCents)).toEqual([21_600, 16_200]);
    // Nothing more than Stripe collected leaves the shop's account.
    expect(refundCalls.reduce((total, call) => total + (call.amountCents ?? 0), 0)).toBe(37_800);
  });

  it("is tenant-scoped: another shop cannot refund this booking", async () => {
    const { db, bookingId, insideWindow } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: crypto.randomUUID(), bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "failed" });
  });
});
