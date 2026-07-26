// @vitest-environment node

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { sendDueCheckoutRecoveries } from "./checkout-recovery";
import { startBookingCheckout } from "./checkouts";
import { setBookingPayment } from "./payments";
import { bookingCheckouts, bookings, trips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const NOW = new Date("2026-08-01T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

function fakeCheckoutProvider(
  retrieve: CheckoutProvider["retrieveCheckoutSession"],
): CheckoutProvider {
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
        expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
      };
    },
    retrieveCheckoutSession: retrieve,
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_test" };
    },
  };
}

const stillOpen: CheckoutProvider["retrieveCheckoutSession"] = async () => ({
  status: "ok",
  session: {
    stripeSessionId: "cs_1",
    stripeStatus: "open",
    paymentStatus: "unpaid",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1",
    amountTotalCents: 18_000,
    expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
  },
});

const alreadyPaid: CheckoutProvider["retrieveCheckoutSession"] = async () => ({
  status: "ok",
  session: {
    stripeSessionId: "cs_1",
    stripeStatus: "complete",
    paymentStatus: "paid",
    checkoutUrl: null,
    amountTotalCents: 18_000,
    expiresAt: null,
  },
});

function fakeEmail(result: NotificationDelivery = { status: "sent", providerMessageId: "em_1" }) {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return result;
    },
  };
  return { sent, provider };
}

/** A connected shop, one priced future trip, one pending checkout `hoursAgo` old. */
async function pendingCheckoutContext(hoursAgo: number, partySize: 1 | 2 = 1) {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  // Pinned safely after NOW regardless of the seed's own (real-clock-relative)
  // dates — the departed-trip check below needs a trip that's still upcoming
  // by default, with individual tests free to backdate it themselves.
  await updateTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: new Date(NOW.getTime() + 48 * HOUR_MS),
    endsAt: new Date(NOW.getTime() + 48 * HOUR_MS + 3 * HOUR_MS),
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 18_000,
  });
  const party = await createBookingParty(
    db,
    partySize === 2
      ? [
          {
            actor: "staff" as const,
            shopId: shop.id,
            tripId: reef.id,
            fullName: "Casey Cart",
            email: "casey-cart@example.com",
          },
          {
            actor: "staff" as const,
            shopId: shop.id,
            tripId: reef.id,
            fullName: "Robin Cart",
            email: "robin-cart@example.com",
          },
        ]
      : [
          {
            actor: "staff" as const,
            shopId: shop.id,
            tripId: reef.id,
            fullName: "Casey Cart",
            email: "casey-cart@example.com",
          },
        ],
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingIds = party.bookings.map((b) => b.bookingId);

  const started = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds,
      customerEmail: "casey-cart@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
    },
    fakeCheckoutProvider(stillOpen),
  );
  if (!started.ok) throw new Error(`checkout start failed: ${started.reason}`);

  // Backdate creation so the recovery delay has (or hasn't) elapsed.
  await db
    .update(bookingCheckouts)
    .set({ createdAt: new Date(NOW.getTime() - hoursAgo * HOUR_MS) })
    .where(eq(bookingCheckouts.id, started.checkout.id));

  return { db, shop, tripId: reef.id, checkoutId: started.checkout.id, bookingIds };
}

describe("sendDueCheckoutRecoveries", () => {
  it("sends a recovery email for a stale, still-open checkout, and never sends it twice", async () => {
    const { db, checkoutId } = await pendingCheckoutContext(3);
    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    expect(summary.sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].kind).toBe("checkout_recovery");
    expect((email.sent[0] as { to: string }).to).toBe("casey-cart@example.com");

    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).not.toBeNull();

    // Re-running must not send a second time.
    const again = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });
    expect(again.sent).toBe(0);
    expect(email.sent).toHaveLength(1);
  });

  it("does not fire before the recovery delay has elapsed", async () => {
    const { db } = await pendingCheckoutContext(0.5);
    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });
    expect(summary.sent).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("reconciles with Stripe first and never emails a checkout that already paid", async () => {
    const { db, checkoutId } = await pendingCheckoutContext(3);
    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(alreadyPaid),
    });

    expect(summary.sent).toBe(0);
    expect(summary.resolved).toBe(1);
    expect(email.sent).toHaveLength(0);

    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.status).toBe("completed");
  });

  it("never sends when Stripe can't be reached to reconcile — the ambiguous case is not license to send", async () => {
    const { db, checkoutId } = await pendingCheckoutContext(3);
    const email = fakeEmail();
    const failing: CheckoutProvider["retrieveCheckoutSession"] = async () => ({ status: "failed" });
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(failing),
    });

    expect(summary.sent).toBe(0);
    expect(summary.unreconciled).toBe(1);
    expect(summary.resolved).toBe(0);
    expect(email.sent).toHaveLength(0);

    // Not marked recovered, not marked completed — still pending, retryable next run.
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.status).toBe("pending");
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });

  it("never emails a checkout whose trip was cancelled since it started", async () => {
    const { db, tripId, checkoutId } = await pendingCheckoutContext(3);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));

    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    expect(summary.sent).toBe(0);
    expect(summary.cancelled).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });

  it("never emails a party checkout when one of its divers was since cancelled", async () => {
    const { db, bookingIds, checkoutId } = await pendingCheckoutContext(3, 2);
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingIds[1]));

    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    expect(summary.sent).toBe(0);
    expect(summary.cancelled).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });

  it("never emails a checkout for a trip that already departed, even though it stays 'scheduled'", async () => {
    const { db, tripId, checkoutId } = await pendingCheckoutContext(3);
    // Trips never leave "scheduled" on departure — only a backdated startsAt
    // simulates a boat that already sailed.
    await db
      .update(trips)
      .set({
        startsAt: new Date(NOW.getTime() - HOUR_MS),
        endsAt: new Date(NOW.getTime() - HOUR_MS / 2),
      })
      .where(eq(trips.id, tripId));

    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    expect(summary.sent).toBe(0);
    expect(summary.departed).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });

  it("never emails a party checkout when a linked booking already settled through another channel", async () => {
    const { db, shop, bookingIds, checkoutId } = await pendingCheckoutContext(3, 2);
    // A counter cash payment (or a staff-created order, or a manual waiver)
    // writes booking_payments directly — this Stripe session never hears
    // about it, and Stripe itself still reports the session open.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: bookingIds[1],
      status: "paid",
      amountCents: 18_000,
      provider: null,
      note: "Paid cash at the counter",
    });

    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    expect(summary.sent).toBe(0);
    expect(summary.settled).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });
});
