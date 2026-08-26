import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail, recordingCheckout } from "@/test/fakes";
import { createBooking, createBookingParty, selfCancelBooking } from "./bookings";
import { sendDueCheckoutRecoveries } from "./checkout-recovery";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { getBookingPayment, listBookingPaymentEvents, setBookingPayment } from "./payments";
import { refundBookingOnCancellation } from "./refunds";
import { bookingCheckouts, bookings } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { startTipCheckout } from "./tips";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * App-side hostile interleavings on the money paths: double-submitted actions
 * (a diver double-tapping Book, a staff refund clicked twice, a tip submitted
 * from two tabs), the abandonment cron crossing paths with the completion
 * webhook, and a self-cancel/reschedule racing an old tab's checkout — each
 * played as a *sequential replay* against the real domain functions on a real
 * in-memory PGlite database, in both orders where both orders can happen.
 *
 * **What this file can and cannot prove.** PGlite is single-connection, so
 * every interleaving here is sequential: step A fully commits before step B
 * runs. Ordering and duplication are exactly testable this way; two
 * transactions *simultaneously* inside the same critical section are not —
 * the `FOR UPDATE` guards in `createBookingRecord`/`withBookingPaymentLock`/
 * `startTipCheckout` and the claim upserts in `claimBookingsForCheckout`/
 * `claimStripeWebhookEvent` cannot be exercised under contention on a
 * single-connection database. Proving those under real concurrency needs the
 * real-Postgres CI job (HD-19, docs/product/human-decisions.md) — a human
 * spend decision, out of scope here. Do not mistake green here for race
 * coverage.
 *
 * The webhook-side counterpart (duplicate/out-of-order Stripe deliveries
 * through the real route) lives in
 * `src/app/api/webhooks/stripe/route.replay.test.ts`.
 */

const REEF_PRICE_CENTS = 18_000;
const HOUR_MS = 60 * 60 * 1000;

type Db = Awaited<ReturnType<typeof seededShopContext>>["db"];

async function connectedShop() {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop };
}

async function pricedReef(db: Db, shopId: string, cancellationWindowHours: number | null = null) {
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
    cancellationWindowHours,
  });
  return reef;
}

function bookingRequest(shopId: string, tripId: string, name = "Tap Tapper") {
  return {
    actor: "staff" as const,
    shopId,
    tripId,
    fullName: name,
    email: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
  };
}

function startInput(shopId: string, tripId: string, bookingIds: string[]) {
  return {
    shopId,
    tripId,
    bookingIds,
    customerEmail: "tap.tapper@example.com",
    successUrl: "https://diveday.example/return",
    cancelUrl: "https://diveday.example/cancel",
    describeLine: ({ tripTitle }: { isDeposit: boolean; tripTitle: string }) => tripTitle,
  };
}

async function activeSeatsFor(db: Db, tripId: string, personId: string) {
  const rows = await db.select().from(bookings).where(eq(bookings.tripId, tripId));
  return rows.filter((row) => row.personId === personId && row.status !== "cancelled").length;
}

describe("double-submitted actions settle exactly once", () => {
  it("a double-tapped Book seats the diver once and refuses the echo", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);

    const first = await createBooking(db, bookingRequest(shop.id, reef.id));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected ok");

    const echo = await createBooking(db, bookingRequest(shop.id, reef.id));
    expect(echo).toEqual({ ok: false, reason: "already_booked" });
    expect(await activeSeatsFor(db, reef.id, first.personId)).toBe(1);
  });

  it("a double-submitted party Book cannot double-book any member", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const requests = [
      bookingRequest(shop.id, reef.id, "Pat Party"),
      bookingRequest(shop.id, reef.id, "Sam Second"),
    ];

    const first = await createBookingParty(db, requests);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected ok");

    // The whole form re-submitted: all-or-nothing means the echo books nobody,
    // not even a member the loop reaches before the first refusal.
    const echo = await createBookingParty(db, requests);
    expect(echo.ok).toBe(false);
    for (const member of first.bookings) {
      expect(await activeSeatsFor(db, reef.id, member.personId)).toBe(1);
    }
  });

  it("a double-submitted checkout start reuses the one Stripe session", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");
    const { requests, provider } = recordingCheckout();

    const first = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      provider,
    );
    const second = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      provider,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.reused).toBe(true);
    expect(second.checkout.stripeSessionId).toBe(first.checkout.stripeSessionId);
    // One payable Stripe session exists, however many times the button fired.
    expect(requests).toHaveLength(1);
  });

  it("a double-submitted tip start reuses the one Stripe session", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");
    const { requests, provider } = recordingCheckout();
    const tipInput = {
      bookingId: booked.bookingId,
      amountCents: 2_000,
      successUrl: "https://diveday.example/recap/tok?tip=paid",
      cancelUrl: "https://diveday.example/recap/tok?tip=cancelled",
      lineDescription: "CALLER_TIP_LABEL",
    };

    const first = await startTipCheckout(db, tipInput, provider);
    const second = await startTipCheckout(db, tipInput, provider);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(requests).toHaveLength(1);
  });

  it("self-cancel, auto-refund, then the whole action replayed — money moves once", async () => {
    // The full `cancelMyBookingAction` consequence chain, run twice over: the
    // per-call double-submit guards are covered by refunds.test.ts ("moves no
    // money the second time") and orders.test.ts ("asks Stripe for the refund
    // once"); this is the *sequence* a stuck double-tap on the readiness page
    // actually produces.
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id, 48);
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");

    const refundCalls: string[] = [];
    const provider: CheckoutProvider = fakeCheckout({
      async refundCheckoutSession(_account, sessionId) {
        refundCalls.push(sessionId);
        return { status: "refunded", refundId: "re_replay" };
      },
    });
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      provider,
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId);
    const insideWindow = new Date(reef.startsAt.getTime() - 72 * HOUR_MS);

    // First pass: cancel frees the seat, the refund follows.
    const cancelled = await selfCancelBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      now: insideWindow,
    });
    expect(cancelled).toEqual({ ok: true });
    const refund = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId: booked.bookingId, now: insideWindow },
      provider,
    );
    expect(refund).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });

    // Replay of the whole action: the cancel refuses, the refund finds nothing
    // captured, Stripe was asked exactly once.
    const cancelledAgain = await selfCancelBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      now: insideWindow,
    });
    expect(cancelledAgain).toEqual({ ok: false, reason: "already_cancelled" });
    const refundAgain = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId: booked.bookingId, now: insideWindow },
      provider,
    );
    expect(refundAgain).toEqual({ status: "unpaid" });
    expect(refundCalls).toHaveLength(1);

    const payment = await getBookingPayment(db, shop.id, booked.bookingId);
    expect(payment?.status).toBe("refunded");
    const trail = await listBookingPaymentEvents(db, shop.id, booked.bookingId);
    expect(trail.map((row) => row.operation)).toEqual(["cancellation_refund", "checkout_settled"]);
  });
});

describe("a cancelled or moved seat versus the tab that kept paying", () => {
  it("an abandoned tab completing after a self-cancel cannot pay for the freed seat", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id, 48);
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    const insideWindow = new Date(reef.startsAt.getTime() - 72 * HOUR_MS);

    // The diver cancels; nothing was captured, so the refund step reports so.
    expect(
      await selfCancelBooking(db, {
        shopId: shop.id,
        bookingId: booked.bookingId,
        now: insideWindow,
      }),
    ).toEqual({ ok: true });
    expect(
      await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId: booked.bookingId, now: insideWindow },
        fakeCheckout(),
      ),
    ).toEqual({ status: "unpaid" });

    // The forgotten tab settles the session anyway. The checkout records the
    // completion (so webhook retries stop reprocessing it), but the cancelled
    // seat must never read as paid for.
    const completed = await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      REEF_PRICE_CENTS,
    );
    expect(completed?.status).toBe("completed");
    expect(await getBookingPayment(db, shop.id, booked.bookingId)).toBeNull();
    expect(await listBookingPaymentEvents(db, shop.id, booked.bookingId)).toHaveLength(0);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("cancelled");
  });

  it("a released seat's old checkout cannot pay for it, or for the seat booked in its place", async () => {
    // Written originally against `rescheduleBooking`, which cancelled the
    // source seat and created the destination one in a single transaction.
    // That function was deleted 2026-08-21 with the diver-facing move (ADR
    // 20260821-the-diver-may-release-their-own-seat); a diver who wants a
    // different Saturday now releases the seat and books the other one, which
    // is the same two rows in the same order. The property is unchanged: a
    // pending checkout belongs to the booking ids it was opened for, and
    // settling it late may not pay for a cancelled seat or for one it never
    // covered.
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const night = upcoming.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");

    const released = await selfCancelBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
    });
    expect(released.ok).toBe(true);
    const rebooked = await createBooking(db, bookingRequest(shop.id, night.id));
    if (!rebooked.ok) throw new Error("rebooking failed");

    // The old tab settles the reef checkout afterwards. The source seat is
    // cancelled (nothing to pay for), and the night seat was never covered by
    // that session — neither may end up marked paid.
    await markCheckoutPaidBySessionId(
      db,
      start.checkout.stripeSessionId,
      undefined,
      REEF_PRICE_CENTS,
    );
    expect(await getBookingPayment(db, shop.id, booked.bookingId)).toBeNull();
    expect(await getBookingPayment(db, shop.id, rebooked.bookingId)).toBeNull();
  });
});

describe("the recovery cron and the completion webhook, in every order that can happen", () => {
  /** A pending checkout old enough for the cron to consider (created 3h ago). */
  async function staleCheckoutScenario(provider: CheckoutProvider) {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const booked = await createBooking(db, bookingRequest(shop.id, reef.id));
    if (!booked.ok) throw new Error("setup booking failed");
    const start = await startBookingCheckout(
      db,
      startInput(shop.id, reef.id, [booked.bookingId]),
      provider,
    );
    if (!start.ok) throw new Error("checkout start failed");
    await db
      .update(bookingCheckouts)
      .set({ createdAt: new Date(nowDate().getTime() - 3 * HOUR_MS) })
      .where(eq(bookingCheckouts.id, start.checkout.id));
    return {
      db,
      shop,
      reef,
      bookingId: booked.bookingId,
      sessionId: start.checkout.stripeSessionId,
    };
  }

  async function runScan(db: Db, provider: CheckoutProvider) {
    return sendDueCheckoutRecoveries(db, {
      now: nowDate(),
      emailProvider: fakeEmail().provider,
      checkoutProvider: provider,
    });
  }

  it("the webhook settling first leaves nothing for the cron to scan", async () => {
    const provider = fakeCheckout();
    const { db, shop, bookingId, sessionId } = await staleCheckoutScenario(provider);
    await markCheckoutPaidBySessionId(db, sessionId, undefined, REEF_PRICE_CENTS);

    const summary = await runScan(db, provider);
    expect(summary.scanned).toBe(0);
    expect(summary.sent).toBe(0);

    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
    expect(await listBookingPaymentEvents(db, shop.id, bookingId)).toHaveLength(1);
  });

  it("the cron retiring a counter-settled checkout beats the late completion", async () => {
    const provider = fakeCheckout();
    const { db, shop, bookingId, sessionId } = await staleCheckoutScenario(provider);
    // The diver paid cash at the counter; the Stripe session is now stale.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      amountCents: REEF_PRICE_CENTS,
      currency: "usd",
    });

    const summary = await runScan(db, provider);
    expect(summary.settled).toBe(1);
    expect(summary.sent).toBe(0);

    // The webhook's completion arrives after the cron already retired the row:
    // refused, and the counter payment is never overwritten with a Stripe ref.
    expect(
      await markCheckoutPaidBySessionId(db, sessionId, undefined, REEF_PRICE_CENTS),
    ).toBeNull();
    const [checkout] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, sessionId));
    expect(checkout?.status).toBe("expired");
    const payment = await getBookingPayment(db, shop.id, bookingId);
    expect(payment?.status).toBe("paid");
    expect(payment?.provider).toBeNull();
    expect(await listBookingPaymentEvents(db, shop.id, bookingId)).toHaveLength(1);
  });

  it("the cron reconciling a paid session, then the delayed webhook, settle exactly once", async () => {
    const provider = fakeCheckout({
      async retrieveCheckoutSession() {
        return {
          status: "ok",
          session: {
            stripeSessionId: "cs_1",
            stripeStatus: "complete",
            paymentStatus: "paid",
            checkoutUrl: null,
            amountTotalCents: REEF_PRICE_CENTS,
            taxAmountCents: null,
            expiresAt: null,
          },
        };
      },
    });
    const { db, shop, bookingId, sessionId } = await staleCheckoutScenario(provider);

    const summary = await runScan(db, provider);
    expect(summary.resolved).toBe(1);
    expect(summary.sent).toBe(0);
    const settled = await getBookingPayment(db, shop.id, bookingId);
    expect(settled?.status).toBe("paid");

    // The delayed webhook delivery re-runs the same completion: self-healing
    // by design, but nothing may change and no second trail row may appear.
    await markCheckoutPaidBySessionId(db, sessionId, undefined, REEF_PRICE_CENTS);
    expect(await getBookingPayment(db, shop.id, bookingId)).toEqual(settled);
    expect(await listBookingPaymentEvents(db, shop.id, bookingId)).toHaveLength(1);
    const [checkout] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, sessionId));
    expect(checkout?.status).toBe("completed");
    expect(checkout?.settledTotalCents).toBe(REEF_PRICE_CENTS);
  });
});
