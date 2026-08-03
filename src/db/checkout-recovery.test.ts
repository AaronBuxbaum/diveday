import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { cancelBooking, createBookingParty } from "./bookings";
import { sendDueCheckoutRecoveries } from "./checkout-recovery";
import { startBookingCheckout } from "./checkouts";
import { setBookingPayment } from "./payments";
import { bookingCheckouts, bookings, people, trips } from "./schema";
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
        amountTotalCents: request.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
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
      describeLine: ({ tripTitle }) => tripTitle,
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
    // Permanently disqualified — written back as expired so it can't keep
    // occupying every future run's batch (see the starvation test below).
    expect(row?.status).toBe("expired");
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
    expect(row?.status).toBe("expired");
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
    expect(row?.status).toBe("expired");
  });

  it("drops a permanently-disqualified checkout out of the scan so it can't starve future batches", async () => {
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
    const first = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });
    expect(first.scanned).toBe(1);
    expect(first.departed).toBe(1);

    // Same clock, same candidate pool — a stuck "pending" row would be
    // scanned again on every future tick forever, capable of filling
    // BATCH_LIMIT with nothing-but-departed rows and starving genuinely due
    // checkouts. Marking it terminal on first sight means the second run
    // finds nothing left to scan at all.
    const second = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });
    expect(second.scanned).toBe(0);
    expect(second.departed).toBe(0);

    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.status).toBe("expired");
  });

  it("catches a settlement that lands mid-batch, after the pre-loop snapshot but before this candidate's send (Codex finding)", async () => {
    const { db, shop, bookingIds, checkoutId } = await pendingCheckoutContext(3);
    const email = fakeEmail();
    // The batch-start "already settled" snapshot runs before any Stripe
    // lookup; simulating a counter-cash payment landing *during* this
    // candidate's own Stripe round trip — after that snapshot was taken —
    // is exactly the gap the fresh in-loop re-check has to close.
    const settleMidLookup: CheckoutProvider["retrieveCheckoutSession"] = async () => {
      await setBookingPayment(db, {
        shopId: shop.id,
        bookingId: bookingIds[0],
        status: "paid",
        currency: "usd",
        amountCents: 18_000,
        provider: null,
        note: "Paid cash at the counter, mid-batch",
      });
      return stillOpen(shop.id, "cs_1");
    };

    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(settleMidLookup),
    });

    expect(summary.sent).toBe(0);
    expect(summary.settled).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
    expect(row?.status).toBe("expired");
  });

  it("catches a cancellation that lands mid-batch, after the pre-loop snapshot but before this candidate's send (Codex finding)", async () => {
    const { db, shop, bookingIds, checkoutId } = await pendingCheckoutContext(3);
    const email = fakeEmail();
    // Same gap as the settlement race above, but for staff cancelling the
    // linked booking mid-Stripe-lookup instead of settling it — the
    // batch-start "already cancelled" snapshot can't see a cancellation that
    // happens after it was taken.
    const cancelMidLookup: CheckoutProvider["retrieveCheckoutSession"] = async () => {
      await cancelBooking(db, shop.id, bookingIds[0]);
      return stillOpen(shop.id, "cs_1");
    };

    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(cancelMidLookup),
    });

    expect(summary.sent).toBe(0);
    expect(summary.cancelled).toBe(1);
    expect(email.sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.abandonedRecoverySentAt).toBeNull();
    expect(row?.status).toBe("expired");
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
      currency: "usd",
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
    expect(row?.status).toBe("expired");
  });

  /**
   * Erasure (ADR 20260802-diver-data-erasure) cancels no booking and settles
   * no payment, so an erased diver with an open, unexpired checkout on a
   * future trip trips none of the disqualifiers above. Before
   * `booking_checkouts.customer_email` was part of the scrub, the next daily
   * tick mailed the address the shop had just told them it destroyed.
   */
  it("never emails a diver whose record has been erased", async () => {
    const { db, shop, checkoutId } = await pendingCheckoutContext(3);
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
    const [casey] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Casey Cart")));
    if (!owner || !casey) throw new Error("fixture people missing");

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: casey.id,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);

    const email = fakeEmail();
    const summary = await sendDueCheckoutRecoveries(db, {
      now: NOW,
      emailProvider: email.provider,
      checkoutProvider: fakeCheckoutProvider(stillOpen),
    });

    // The checkout is still a live candidate — the scan finds it, reconciles
    // it with Stripe, and has nowhere to send it.
    expect(summary.scanned).toBe(1);
    expect(summary.sent).toBe(0);
    expect(email.sent).toHaveLength(0);

    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkoutId));
    expect(row?.customerEmail).toBeNull();
    expect(row?.abandonedRecoverySentAt).toBeNull();
  });
});
