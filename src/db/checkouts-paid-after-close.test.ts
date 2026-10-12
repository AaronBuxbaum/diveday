import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { createBookingParty } from "./bookings";
import {
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  recordCheckoutPaymentIntent,
  startBookingCheckout,
} from "./checkouts";
import {
  listPaidAfterCloseCheckouts,
  refundPaidAfterCloseCheckout,
} from "./checkouts-paid-after-close";
import { getBookingPayment } from "./payments";
import { recordStripeChargeRefund } from "./refunds";
import { activityEvents, bookingCheckouts, paymentOperationIntents } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * A diver's card charged on a session DiveDay had already closed (issue
 * #2335). The money is captured; nothing marks any seat paid from it; it waits
 * on the Orders index until it is refunded, from there or from Stripe.
 */

const ctx = fileScopedShopContext();

/** Nobody in the shop: the refund still moves, and no activity line names them. */
const ACTOR = "00000000-0000-4000-8000-0000000000aa";

async function closedCheckout() {
  const { db, shop } = ctx;
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
    priceCents: 18_000,
  });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Nora Late",
      email: "nora.late@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0]?.bookingId;
  if (!bookingId) throw new Error("no booking");
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [bookingId],
      customerEmail: "nora.late@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error("checkout start failed");
  await markCheckoutExpiredBySessionId(db, start.checkout.stripeSessionId);
  return { db, shop, reef, bookingId, checkout: start.checkout };
}

async function row(db: typeof ctx.db, checkoutId: string) {
  const [found] = await db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.id, checkoutId));
  return found;
}

describe("a completion for a checkout DiveDay already closed", () => {
  it("records the captured money for staff and still marks nothing paid", async () => {
    const { db, shop, reef, bookingId, checkout } = await closedCheckout();

    const result = await markCheckoutPaidBySessionId(
      db,
      checkout.stripeSessionId,
      "acct_test",
      17_500,
    );

    expect(result).toBeNull();
    const after = await row(db, checkout.id);
    expect(after?.status).toBe("expired");
    expect(after?.completedAt).toBeNull();
    expect(after?.paidAfterCloseAt).not.toBeNull();
    expect(after?.paidAfterCloseCents).toBe(17_500);
    expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();

    const owed = await listPaidAfterCloseCheckouts(db, shop.id);
    expect(owed).toEqual([
      expect.objectContaining({
        checkoutId: checkout.id,
        tripId: reef.id,
        tripTitle: reef.title,
        diverNames: ["Nora Late"],
        amountCents: 17_500,
        currency: checkout.currency,
      }),
    ]);
  });

  it("keeps the first report on a redelivery", async () => {
    const { db, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    const first = await row(db, checkout.id);
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 99_999);
    const second = await row(db, checkout.id);
    expect(second?.paidAfterCloseAt).toEqual(first?.paidAfterCloseAt);
    expect(second?.paidAfterCloseCents).toBe(17_500);
  });

  it("falls back to the asked total when Stripe reports none", async () => {
    const { db, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test");
    expect((await row(db, checkout.id))?.paidAfterCloseCents).toBe(checkout.totalCents);
  });

  it("records nothing for another account's event", async () => {
    const { db, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_someone_else", 17_500);
    expect((await row(db, checkout.id))?.paidAfterCloseAt).toBeNull();
  });

  it("is not another shop's to see", async () => {
    const { db, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    expect(await listPaidAfterCloseCheckouts(db, "00000000-0000-4000-8000-000000000000")).toEqual(
      [],
    );
  });
});

describe("refundPaidAfterCloseCheckout", () => {
  it("refunds what is still owed through the shop's account, once", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    const calls: { account: string; session: string; key: string; amount?: number }[] = [];
    const provider = fakeCheckout({
      async refundCheckoutSession(account, session, key, amount) {
        calls.push({ account, session, key, amount });
        return { status: "refunded", refundId: "re_late" };
      },
    });

    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const outcome = await refundPaidAfterCloseCheckout(db, shop.id, checkout.id, owner, provider);

    expect(outcome).toEqual({ status: "refunded", amountCents: 17_500 });
    expect(calls).toEqual([
      expect.objectContaining({
        account: "acct_test",
        session: checkout.stripeSessionId,
        amount: 17_500,
      }),
    ]);
    expect((await row(db, checkout.id))?.refundedCents).toBe(17_500);
    expect(await listPaidAfterCloseCheckouts(db, shop.id)).toEqual([]);
    const [intent] = await db
      .select()
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.checkoutId, checkout.id),
          eq(paymentOperationIntents.kind, "refund"),
        ),
      );
    expect(intent?.status).toBe("succeeded");
    expect(intent?.stripeObjectId).toBe("re_late");
    // Who sent the money back, on the departure's activity log.
    const lines = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shop.id),
          eq(activityEvents.code, "paid_after_close_refunded"),
        ),
      );
    expect(lines).toEqual([
      expect.objectContaining({ actorPersonId: owner, tripId: checkout.tripId }),
    ]);

    expect(await refundPaidAfterCloseCheckout(db, shop.id, checkout.id, ACTOR, provider)).toEqual({
      status: "not_owed",
    });
    expect(calls).toHaveLength(1);
  });

  it("leaves it owed when Stripe refuses", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    const outcome = await refundPaidAfterCloseCheckout(
      db,
      shop.id,
      checkout.id,
      ACTOR,
      fakeCheckout({
        async refundCheckoutSession() {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ status: "failed" });
    expect((await row(db, checkout.id))?.refundedCents).toBe(0);
    expect(await listPaidAfterCloseCheckouts(db, shop.id)).toHaveLength(1);
  });

  it("refuses a checkout that was never paid after closing", async () => {
    const { db, shop, checkout } = await closedCheckout();
    expect(
      await refundPaidAfterCloseCheckout(db, shop.id, checkout.id, ACTOR, fakeCheckout()),
    ).toEqual({
      status: "not_owed",
    });
  });

  it("refuses another shop's checkout", async () => {
    const { db, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    expect(
      await refundPaidAfterCloseCheckout(
        db,
        "00000000-0000-4000-8000-000000000000",
        checkout.id,
        ACTOR,
        fakeCheckout(),
      ),
    ).toEqual({ status: "not_owed" });
  });

  it("refuses when the shop's account no longer takes payments", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    await setShopStripeAccountStatus(db, "acct_test", {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    expect(
      await refundPaidAfterCloseCheckout(db, shop.id, checkout.id, ACTOR, fakeCheckout()),
    ).toEqual({
      status: "not_connected",
    });
  });

  it("refuses a second refund while the first is still at Stripe", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    await db
      .insert(paymentOperationIntents)
      .values({ shopId: shop.id, kind: "refund", checkoutId: checkout.id });
    expect(
      await refundPaidAfterCloseCheckout(db, shop.id, checkout.id, ACTOR, fakeCheckout()),
    ).toEqual({
      status: "in_progress",
    });
  });
});

describe("a refund made in the Stripe dashboard", () => {
  it("takes the money off the queue, and a redelivery adds nothing", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    await recordCheckoutPaymentIntent(db, {
      stripeSessionId: checkout.stripeSessionId,
      paymentIntentId: "pi_late",
    });
    const event = {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_late",
      amountRefundedCents: 17_500,
      chargeId: "ch_late",
      occurredAt: nowDate(),
    };

    expect(await recordStripeChargeRefund(db, event)).toEqual({ status: "checkout_refunded" });
    expect((await row(db, checkout.id))?.refundedCents).toBe(17_500);
    expect(await listPaidAfterCloseCheckouts(db, shop.id)).toEqual([]);
    expect(await recordStripeChargeRefund(db, event)).toEqual({ status: "already_recorded" });
  });

  // Security review: an old intent Stripe confirmed (it carries the refund's
  // id) but whose local count never landed is DiveDay's own refund. Counting
  // its echo here would count it again when a human reconciles it.
  it("waits on our own confirmed refund however old, as every other refund does", async () => {
    const { db, shop, checkout } = await closedCheckout();
    await markCheckoutPaidBySessionId(db, checkout.stripeSessionId, "acct_test", 17_500);
    await recordCheckoutPaymentIntent(db, {
      stripeSessionId: checkout.stripeSessionId,
      paymentIntentId: "pi_echo",
    });
    await db.insert(paymentOperationIntents).values({
      shopId: shop.id,
      kind: "refund",
      checkoutId: checkout.id,
      stripeObjectId: "re_echo",
      startedAt: new Date("2020-01-01T00:00:00Z"),
    });

    expect(
      await recordStripeChargeRefund(db, {
        stripeAccountId: "acct_test",
        paymentIntentId: "pi_echo",
        amountRefundedCents: 17_500,
        chargeId: "ch_echo",
        occurredAt: nowDate(),
      }),
    ).toEqual({ status: "deferred" });
    expect((await row(db, checkout.id))?.refundedCents).toBe(0);
  });

  it("still ignores a refund on a closed checkout nobody paid", async () => {
    const { db, checkout } = await closedCheckout();
    await recordCheckoutPaymentIntent(db, {
      stripeSessionId: checkout.stripeSessionId,
      paymentIntentId: "pi_never",
    });
    expect(
      await recordStripeChargeRefund(db, {
        stripeAccountId: "acct_test",
        paymentIntentId: "pi_never",
        amountRefundedCents: 100,
        chargeId: "ch_never",
        occurredAt: nowDate(),
      }),
    ).toEqual({ status: "not_found" });
  });
});
