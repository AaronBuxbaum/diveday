import { describe, expect, it } from "vitest";
import type { CheckoutSessionSnapshot } from "@/lib/payments/checkout";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { refreshCheckoutFromStripe, startBookingCheckout } from "./checkouts";
import { getBookingPayment } from "./payments";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { editTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **A checkout discounted to nothing is settled, at zero.** A 100% code, or a
 * fixed amount at or above the total, is a Stripe no-cost order: it takes no
 * card, makes no PaymentIntent, and completes needing no payment. Left
 * pending, the seat reads unpaid forever and the dock asks for a fare the shop
 * gave away.
 */
const ctx = fileScopedShopContext();

async function pendingCheckout() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  await editTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 15_000,
  });
  const party = await createBookingParty(
    db,
    ["Nora No-Cost", "Nico No-Cost"].map((fullName) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: `free-${crypto.randomUUID()}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingIds = party.bookings.map((b) => b.bookingId);
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds,
      customerEmail: "nora@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }: { isDeposit: boolean; tripTitle: string }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error(`checkout start failed: ${start.reason}`);
  return { db, shop, bookingIds, checkout: start.checkout };
}

function stripeAnswers(session: Partial<CheckoutSessionSnapshot>) {
  return fakeCheckout({
    async retrieveCheckoutSession() {
      return {
        status: "ok",
        session: {
          stripeSessionId: "cs_1",
          stripeStatus: "complete",
          paymentStatus: "no_payment_required",
          checkoutUrl: null,
          amountTotalCents: null,
          taxAmountCents: null,
          stripeCustomerId: null,
          expiresAt: null,
          ...session,
        },
      };
    },
  });
}

describe("refreshCheckoutFromStripe on a no-cost order", () => {
  it("settles every covered seat at zero", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      stripeAnswers({ amountTotalCents: 0 }),
    );
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.settledTotalCents).toBe(0);
    for (const bookingId of bookingIds) {
      const payment = await getBookingPayment(db, shop.id, bookingId);
      expect(payment?.status).toBe("paid");
      expect(payment?.amountCents).toBe(0);
    }
  });

  it("leaves the checkout pending when the total is not zero", async () => {
    const { db, shop, bookingIds, checkout } = await pendingCheckout();
    const refreshed = await refreshCheckoutFromStripe(
      db,
      shop.id,
      checkout.id,
      stripeAnswers({ amountTotalCents: 30_000 }),
    );
    expect(refreshed?.status).toBe("pending");
    const payment = await getBookingPayment(db, shop.id, bookingIds[0] ?? "");
    expect(payment?.status ?? "unpaid").toBe("unpaid");
  });
});
