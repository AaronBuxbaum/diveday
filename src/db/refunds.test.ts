import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { CheckoutProvider, RefundCheckoutResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { joinLastMinuteList } from "./last-minute-list";
import { getBookingPayment, listBookingPaymentEvents, setBookingPayment } from "./payments";
import {
  refundBookingOnCancellation,
  refundBookingOnShopCancellation,
  refundBookingsForShopCancelledTrip,
} from "./refunds";
import { createShopPromoCode } from "./shop-promos";
import { setShopCurrency } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getActiveTripPromoByCode, sendLastMinuteDealBlast } from "./trip-promos";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

const REEF_PRICE_CENTS = 18_000;

/** Every refund POST the provider was asked to make, in order. */
type RefundCall = { sessionId: string; idempotencyKey: string; amountCents?: number };

/**
 * Kept local, deliberately: unlike the shared `fakeCheckout` in
 * `src/test/fakes.ts` this is a *simulator*, not a stub. It models the ceiling
 * the real Stripe enforces — a refund is bounded by what the payment intent
 * captured, and repeat refunds against one session accumulate against that
 * ceiling — which is the whole subject of these tests (PAY-M3) and has no
 * meaning in any other file.
 */
function fakeCheckout(
  refund: RefundCheckoutResult,
  refundCalls: RefundCall[] = [],
  /**
   * What Stripe actually captured on the session being refunded. Supplying it
   * makes this fake enforce the ceiling the real Stripe enforces: a refund is
   * bounded against the **payment intent's** captured total, never against the
   * per-diver share DiveDay recorded. One party checkout is one intent, so
   * without this the fake happily reverses more money than ever changed hands
   * and no test in this repo can catch an over-attributed party (PAY-M3).
   * Beyond the ceiling Stripe errors; the provider reports that as
   * `not_refundable`, which the domain surfaces to staff as `manual`.
   */
  capturedCents?: number,
): CheckoutProvider {
  let counter = 0;
  const reversedBySession = new Map<string, number>();
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
        expiresAt: new Date(nowMs() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession(_accountId, stripeSessionId, idempotencyKey, amountCents) {
      refundCalls.push({ sessionId: stripeSessionId, idempotencyKey, amountCents });
      if (capturedCents !== undefined) {
        const asked = amountCents ?? capturedCents;
        const alreadyReversed = reversedBySession.get(stripeSessionId) ?? 0;
        if (alreadyReversed + asked > capturedCents) return { status: "not_refundable" };
        if (refund.status === "refunded") {
          reversedBySession.set(stripeSessionId, alreadyReversed + asked);
        }
      }
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
 * completion, so a discounted checkout can be exercised end to end;
 * `discountPercent` mints a real shop-wide code and spends it on the checkout,
 * which is the case where a discount applies but no `amount_total` arrives;
 * `tripDiscountPercent` does the same with a *trip-scoped* last-minute deal,
 * sent through the real blast so the code the party spends is the one a diver
 * would actually have been emailed.
 *
 * Returns `capturedCents`: what Stripe genuinely took for this session,
 * whatever DiveDay recorded per booking. Hand it to `fakeCheckout` so refunds
 * are bounded the way the real payment intent bounds them.
 */
async function paidBookingContext(
  windowHours: number | null = 48,
  options: {
    gearCents?: number;
    settledTotalCents?: number;
    discountPercent?: number;
    tripDiscountPercent?: number;
  } = {},
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

  const promo = options.discountPercent
    ? await createShopPromoCode(
        db,
        {
          shopId: shop.id,
          code: "party20",
          discountPercent: options.discountPercent,
          scope: "all",
        },
        fakePromotions(),
      )
    : null;
  if (promo && !promo.ok) throw new Error(`promo creation failed: ${promo.reason}`);
  const shopPromo = promo?.ok ? promo.promo : null;

  // A trip-scoped last-minute deal, minted the way a shop really mints one:
  // someone on the last-minute list, a real blast, then the diver typing the
  // code back in and `getActiveTripPromoByCode` resolving it — the exact path
  // that leaves both shop-promo columns null on the checkout.
  let tripPromo: Awaited<ReturnType<typeof getActiveTripPromoByCode>> = null;
  if (options.tripDiscountPercent) {
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const blast = await sendLastMinuteDealBlast(
      db,
      {
        shopId: shop.id,
        shopSlug: "blue-mantis",
        tripId: reef.id,
        discountPercent: options.tripDiscountPercent,
      },
      fakePromotions(),
    );
    if (!blast.ok) throw new Error(`last-minute blast failed: ${blast.reason}`);
    tripPromo = await getActiveTripPromoByCode(db, {
      shopId: shop.id,
      tripId: reef.id,
      code: blast.code,
    });
    if (!tripPromo) throw new Error("last-minute code did not resolve");
  }

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
      promotionCode:
        tripPromo?.stripePromotionCodeId ?? shopPromo?.stripePromotionCodeId ?? undefined,
      tripPromo: tripPromo
        ? { id: tripPromo.id, code: tripPromo.code, discountPercent: tripPromo.discountPercent }
        : undefined,
      shopPromo: shopPromo
        ? { id: shopPromo.id, code: shopPromo.code, discountPercent: shopPromo.discountPercent }
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

  // What Stripe really took: its reported total when there is one, otherwise
  // the asked total less whatever the applied code discounted.
  const askedCents = REEF_PRICE_CENTS * 2 + (options.gearCents ?? 0);
  const appliedPercent = options.tripDiscountPercent ?? options.discountPercent ?? 0;
  const capturedCents =
    options.settledTotalCents ?? askedCents - Math.ceil((askedCents * appliedPercent) / 100);

  const insideWindow = new Date(reef.startsAt.getTime() - 72 * 60 * 60 * 1000);
  const pastDeadline = new Date(reef.startsAt.getTime() - 1 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, bookingIds, capturedCents, insideWindow, pastDeadline };
}

describe("refundBookingOnCancellation", () => {
  it("refunds a Stripe payment in full inside the window and flips the row to refunded", async () => {
    const { db, shop, bookingId, capturedCents, insideWindow } = await paidBookingContext(48);
    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded", refundId: "re_ok" }, [], capturedCents),
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
    const { db, shop, bookingIds, capturedCents, insideWindow } = await paidBookingContext(48);
    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout(
      { status: "refunded", refundId: "re_party" },
      refundCalls,
      capturedCents,
    );

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
    const { db, shop, bookingIds, capturedCents, insideWindow } = await paidBookingContext(48, {
      gearCents: GEAR_CENTS,
      settledTotalCents: 37_800,
    });
    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout(
      { status: "refunded", refundId: "re_promo" },
      refundCalls,
      capturedCents,
    );

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

  // PAY-M3: the branch where Stripe reported no `amount_total` at all —
  // `refreshCheckoutFromStripe` and the daily checkout-recovery scan both
  // forward a `number | null`, and both webhook arms tolerate a missing one.
  // A *discounted party* on that branch used to be recorded at quoted,
  // pre-discount amounts, so the two per-booking figures summed above what the
  // single shared payment intent captured. The first canceller reversed their
  // inflated share out of the shared pot and the second was refused money that
  // had already gone to someone else — surfacing as `manual`, not an error,
  // which is how it stayed invisible.
  it("keeps both party members whole on a discounted checkout Stripe reported no total for", async () => {
    // Asked 2 × $180 = $360; the shop's own 20% code took $72, so the intent
    // captured $288 — and Stripe never told us, because no amount_total came.
    const { db, shop, bookingIds, capturedCents, insideWindow } = await paidBookingContext(48, {
      discountPercent: 20,
    });
    expect(capturedCents).toBe(28_800);

    // Each diver is recorded at their share of what can have been captured,
    // not at the $180 they were quoted.
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.amountCents).toBe(14_400);
    }

    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout(
      { status: "refunded", refundId: "re_party_promo" },
      refundCalls,
      capturedCents,
    );

    // Both cancel. Neither is refused, and the second gets exactly as much as
    // the first — the failure mode was the first one draining the pot.
    for (const bookingId of bookingIds) {
      const outcome = await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId, now: insideWindow },
        provider,
      );
      expect(outcome).toEqual({ status: "refunded", amountCents: 14_400 });
    }

    // Nothing more than the intent captured ever leaves the shop's account.
    expect(refundCalls.reduce((total, call) => total + (call.amountCents ?? 0), 0)).toBe(28_800);
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("refunded");
    }
  });

  // PAY-M3, the last flavor: the same no-`amount_total` branch, but the code
  // spent is a **trip-scoped last-minute deal**. That one is Stripe's object
  // end to end — it left no local trace on the checkout at all, so the
  // completion could not tell it from an undiscounted session and recorded both
  // divers at the full $180 they were quoted, $360 against an intent that only
  // ever captured $288. The first canceller reversed $180 out of that pot and
  // the second was refused $180 that had already gone to someone else,
  // surfacing as `manual` rather than as an error. Closed by snapshotting the
  // applied percent on the checkout row at session-creation time.
  it("keeps both party members whole on a trip-deal checkout Stripe reported no total for", async () => {
    // Asked 2 × $180 = $360; the trip's own 20% last-minute deal took $72, so
    // the intent captured $288 — and Stripe never told us, because no
    // amount_total came.
    const { db, shop, bookingIds, capturedCents, insideWindow } = await paidBookingContext(48, {
      tripDiscountPercent: 20,
    });
    expect(capturedCents).toBe(28_800);

    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.amountCents).toBe(14_400);
    }

    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout(
      { status: "refunded", refundId: "re_party_trip_promo" },
      refundCalls,
      capturedCents,
    );

    // Both cancel. Neither is refused, and the second gets exactly as much as
    // the first — the failure mode was the first one draining the pot.
    for (const bookingId of bookingIds) {
      const outcome = await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId, now: insideWindow },
        provider,
      );
      expect(outcome).toEqual({ status: "refunded", amountCents: 14_400 });
    }

    // Nothing more than the intent captured ever leaves the shop's account.
    expect(refundCalls.reduce((total, call) => total + (call.amountCents ?? 0), 0)).toBe(28_800);
    for (const bookingId of bookingIds) {
      expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("refunded");
    }
  });

  // The cancel action is one tap on a roster row, and taps get repeated: a
  // double-click, a retried server action, a staffer refreshing the page they
  // weren't sure had gone through. Each of those re-enters here on a booking
  // whose payment already reads `refunded`, and the only acceptable answer is
  // that Stripe is not asked for anything a second time. The refunded status
  // is what holds it — not the idempotency key, which is minted fresh per
  // attempt on purpose (PAY-C1) and would happily issue a second real refund.
  it("moves no money the second time a cancelled booking is refunded", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    const refundCalls: RefundCall[] = [];
    const provider = fakeCheckout({ status: "refunded", refundId: "re_once" }, refundCalls);

    expect(
      await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId, now: insideWindow },
        provider,
      ),
    ).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    expect(refundCalls).toHaveLength(1);

    // `unpaid` is the honest word for it: there is nothing captured left to
    // return. The diver is not refunded twice, and the row is not rewritten.
    expect(
      await refundBookingOnCancellation(
        db,
        { shopId: shop.id, bookingId, now: insideWindow },
        provider,
      ),
    ).toEqual({ status: "unpaid" });
    expect(refundCalls).toHaveLength(1);
    const payment = await getBookingPayment(db, shop.id, bookingId);
    expect(payment).toMatchObject({
      status: "refunded",
      amountCents: REEF_PRICE_CENTS,
      providerRef: "re_once",
    });
  });

  // ADR 20260731-shop-currency: a payment row is evidence of what was actually
  // taken, so the reversal is denominated by the captured payment, never by
  // whatever the shop's settings say today. A shop that switches to euros
  // between the charge and the cancellation must not have a dollar refund
  // written down — and read back — as euros.
  it("refunds in the currency the money was captured in, not the shop's current one", async () => {
    const { db, shop, bookingId, insideWindow } = await paidBookingContext(48);
    expect((await getBookingPayment(db, shop.id, bookingId))?.currency).toBe("usd");

    await setShopCurrency(db, shop.id, "eur");

    const outcome = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: insideWindow },
      fakeCheckout({ status: "refunded", refundId: "re_currency" }),
    );
    expect(outcome).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    // Same currency and same minor-unit amount as the capture: the figure is
    // not reinterpreted against a currency it was never in.
    expect(await getBookingPayment(db, shop.id, bookingId)).toMatchObject({
      status: "refunded",
      currency: "usd",
      amountCents: REEF_PRICE_CENTS,
    });
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

/**
 * The shop-cancelled arm (ADR 20260813-shop-cancellation-refunds-itself). The
 * tests that matter are the ones whose answer differs from the sibling above:
 * past the deadline and with no stated window at all, this arm still refunds,
 * because neither concept is about a trip the shop took away.
 */
describe("refundBookingOnShopCancellation", () => {
  it("refunds past the deadline, where a diver-initiated cancel would forfeit", async () => {
    const { db, shop, bookingId, capturedCents, pastDeadline } = await paidBookingContext(48);
    // Same booking, same instant, both arms — the contrast *is* the decision.
    const forfeited = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId, now: pastDeadline },
      fakeCheckout({ status: "refunded" }, [], capturedCents),
    );
    expect(forfeited).toEqual({ status: "forfeit" });

    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({ status: "refunded", refundId: "re_shop" }, [], capturedCents),
    );
    expect(outcome).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    const payment = await getBookingPayment(db, shop.id, bookingId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.amountCents).toBe(REEF_PRICE_CENTS);
    expect(payment?.providerRef).toBe("re_shop");
  });

  it("refunds a trip that states no cancellation window at all", async () => {
    const { db, shop, bookingId, capturedCents } = await paidBookingContext(null);
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({ status: "refunded", refundId: "re_nopolicy" }, [], capturedCents),
    );
    expect(outcome).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("refunded");
  });

  it("records the shop's own operation code on the trail, not the diver-cancel one", async () => {
    const { db, shop, bookingId, capturedCents } = await paidBookingContext(48);
    await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({ status: "refunded", refundId: "re_trail" }, [], capturedCents),
    );
    // Newest first.
    const trail = await listBookingPaymentEvents(db, shop.id, bookingId);
    expect(trail[0]?.operation).toBe("shop_cancellation_refund");
    expect(trail.some((event) => event.operation === "cancellation_refund")).toBe(false);
  });

  it("hands a counter (non-Stripe) payment to staff and leaves the money where it is", async () => {
    const { db, shop, bookingId } = await paidBookingContext(48);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: REEF_PRICE_CENTS,
      note: "cash at counter",
    });
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "manual", reason: "not_stripe" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("leaves the payment paid when Stripe refuses, so staff see it as owed", async () => {
    const { db, shop, bookingId } = await paidBookingContext(48);
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({ status: "failed" }),
    );
    expect(outcome).toEqual({ status: "failed" });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("moves no money the second time — what makes a resumed cascade safe", async () => {
    const { db, shop, bookingId, capturedCents } = await paidBookingContext(48);
    const calls: RefundCall[] = [];
    const checkout = fakeCheckout(
      { status: "refunded", refundId: "re_once" },
      calls,
      capturedCents,
    );
    await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId }, checkout);
    const again = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      checkout,
    );
    expect(again).toEqual({ status: "unpaid" });
    expect(calls).toHaveLength(1);
  });

  it("is tenant-scoped: another shop cannot refund this booking", async () => {
    const { db, bookingId } = await paidBookingContext(48);
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: crypto.randomUUID(), bookingId },
      fakeCheckout({ status: "refunded" }),
    );
    expect(outcome).toEqual({ status: "failed" });
  });
});

describe("refundBookingsForShopCancelledTrip", () => {
  it("refunds every active seat on the departure, not just the reachable ones", async () => {
    const { db, shop, reef, bookingIds, capturedCents } = await paidBookingContext(48);
    // The demo trip is already carrying seeded seats beside this party's two;
    // every one of them is a diver the shop just cancelled on, so the count to
    // match is the roster's, not the party's.
    const roster = await getTripRoster(db, shop.id, reef.id);
    const outcomes = await refundBookingsForShopCancelledTrip(
      db,
      { shopId: shop.id, tripId: reef.id },
      fakeCheckout({ status: "refunded", refundId: "re_all" }, [], capturedCents),
    );
    expect(outcomes.size).toBe(roster.length);
    for (const bookingId of bookingIds) {
      expect(outcomes.get(bookingId)).toEqual({
        status: "refunded",
        amountCents: REEF_PRICE_CENTS,
      });
      expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("refunded");
    }
  });
});
