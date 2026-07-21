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

function fakeCheckout(refund: RefundCheckoutResult): CheckoutProvider {
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
        amountTotalCents: request.unitAmountCents * request.quantity,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return refund;
    },
  };
}

/**
 * A connected shop with a priced reef trip, a booking paid in full through
 * Stripe, and a stated cancellation window. `windowHours` null states no window.
 */
async function paidBookingContext(windowHours: number | null = 48) {
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
    { shopId: shop.id, tripId: reef.id, fullName: "Pat Party", email: "pat@example.com" },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;

  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [bookingId],
      customerEmail: "pat@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
    },
    fakeCheckout({ status: "refunded", refundId: "re_seed" }),
  );
  if (!start.ok) throw new Error("checkout start failed");
  await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);

  const insideWindow = new Date(reef.startsAt.getTime() - 72 * 60 * 60 * 1000);
  const pastDeadline = new Date(reef.startsAt.getTime() - 1 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, insideWindow, pastDeadline };
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

  it("reports unpaid when nothing was captured", async () => {
    const { db, shop, reef, insideWindow } = await paidBookingContext(48);
    const party = await createBookingParty(db, [
      { shopId: shop.id, tripId: reef.id, fullName: "Unpaid Uma", email: "uma@example.com" },
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
