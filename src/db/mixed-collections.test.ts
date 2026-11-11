import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordStripeRefundFailure } from "@/features/refund-failures";
import { heldAfterDepositReceipt } from "@/lib/payment-marks";
import { advanceClock } from "@/test/clock";
import { unseededTestDb } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { markCheckoutPaidBySessionId } from "./checkouts";
import { recordCheckoutCollection } from "./collection-ledger";
import { getBookingPayment, setBookingPayment, setBookingPaymentIfNotFinal } from "./payments";
import { recordStripeChargeRefund, refundBookingOnShopCancellation } from "./refunds";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  collectionEntries,
  paymentOperationIntents,
  people,
  shops,
  trips,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { listUnfinished } from "./unfinished";

async function fixture({ onlineSettled = true } = {}) {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Mixed Shop", slug: "mixed-shop", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Payer" })
    .returning();
  if (!person) throw new Error("person missing");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt: new Date("2031-09-01T12:00:00Z"),
      endsAt: new Date("2031-09-01T15:00:00Z"),
      capacity: 8,
      priceCents: 12_000,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      currency: "usd",
      amountPerDiverCents: 5_000,
      totalCents: 5_000,
      settledTotalCents: onlineSettled ? 5_000 : null,
      taxCents: 0,
      status: onlineSettled ? "completed" : "pending",
      isDeposit: true,
      stripeAccountId: "acct_mixed",
      stripeSessionId: "cs_mixed",
      stripePaymentIntentId: "pi_mixed",
      completedAt: onlineSettled ? new Date("2026-07-21T13:30:00Z") : null,
    })
    .returning();
  if (!checkout) throw new Error("checkout missing");
  await db
    .insert(bookingCheckoutBookings)
    .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id, tripCents: 5_000 });
  if (onlineSettled) {
    await db.transaction((tx) => recordCheckoutCollection(tx, shop.id, checkout.id));
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booking.id,
      status: "deposit_paid",
      amountCents: 5_000,
      currency: "usd",
      provider: "stripe",
      providerRef: checkout.stripeSessionId,
    });
  }
  async function cash(amountCents: number, status: "deposit_paid" | "paid") {
    const previous = await getBookingPayment(db, shop.id, booking.id);
    if (!previous) throw new Error("payment missing");
    advanceClock();
    return setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status,
      expectedPaymentEntryId: previous.id,
      ...heldAfterDepositReceipt(previous, { kind: "money", amountCents, method: "cash" }),
    });
  }
  return { db, shop, booking, checkout, cash };
}

describe("mixed Stripe deposit and external balance", () => {
  it("keeps the Stripe pointer and records only new cash in the manual collection source", async () => {
    const f = await fixture();
    const paid = await f.cash(7_000, "paid");
    expect(paid).toMatchObject({
      provider: "mixed",
      providerRef: "cs_mixed",
      amountCents: 12_000,
      manualHeldCents: 7_000,
    });
    expect(
      (await f.db.select().from(collectionEntries)).map((row) => [row.sourceType, row.amountCents]),
    ).toEqual([
      ["checkout", 5_000],
      ["booking", 7_000],
    ]);
    const replay = await f.db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: f.shop.id,
        bookingId: f.booking.id,
        status: "deposit_paid",
        amountCents: 5_000,
        currency: "usd",
        provider: "stripe",
        providerRef: "cs_mixed",
      }),
    );
    expect(replay).toMatchObject({
      provider: "mixed",
      amountCents: 12_000,
      manualHeldCents: 7_000,
    });
    expect(await f.db.select().from(collectionEntries)).toHaveLength(2);
  });

  it("supports repeated partial external receipts without charging the online deposit again", async () => {
    const f = await fixture();
    await f.cash(2_000, "deposit_paid");
    expect(await f.cash(5_000, "paid")).toMatchObject({
      amountCents: 12_000,
      manualHeldCents: 7_000,
    });
    expect((await f.db.select().from(collectionEntries)).map((row) => row.amountCents)).toEqual([
      5_000, 2_000, 5_000,
    ]);
  });

  it("routes a mixed refund to staff, never sending external money to Stripe", async () => {
    const f = await fixture();
    await f.cash(7_000, "paid");
    let calls = 0;
    const provider = fakeCheckout({
      refundCheckoutSession: async () => {
        calls += 1;
        return { status: "refunded", amountCents: 12_000 };
      },
    });
    expect(
      await refundBookingOnShopCancellation(
        f.db,
        { shopId: f.shop.id, bookingId: f.booking.id },
        provider,
      ),
    ).toMatchObject({ status: "manual", reason: "not_stripe" });
    expect(calls).toBe(0);
  });

  it("a Stripe dashboard refund leaves cash held, and a failed refund restores only the online portion", async () => {
    const f = await fixture();
    await f.cash(7_000, "paid");
    advanceClock();
    expect(
      await recordStripeChargeRefund(f.db, {
        stripeAccountId: "acct_mixed",
        paymentIntentId: "pi_mixed",
        chargeId: "ch_mixed",
        amountRefundedCents: 5_000,
        occurredAt: new Date("2026-07-21T13:30:02Z"),
      }),
    ).toMatchObject({ status: "checkout_refunded" });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      amountCents: 7_000,
      manualHeldCents: 7_000,
      provider: "mixed",
      providerRef: "cs_mixed",
    });
    advanceClock();
    expect(
      await recordStripeRefundFailure(f.db, {
        stripeAccountId: "acct_mixed",
        paymentIntentId: "pi_mixed",
        refund: {
          id: "re_mixed",
          amountCents: 5_000,
          currency: "usd",
          status: "failed",
          failureReason: null,
        },
        occurredAt: new Date("2026-07-21T13:30:03Z"),
      }),
    ).toMatchObject({ status: "reversed" });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      amountCents: 12_000,
      manualHeldCents: 7_000,
      provider: "mixed",
    });
    const manual = await f.db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceType, "booking"));
    expect(manual.map((row) => row.amountCents)).toEqual([7_000]);
  });

  it("does not erase a manual receipt when the first Stripe settlement arrives late", async () => {
    const f = await fixture({ onlineSettled: false });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "deposit_paid",
      amountCents: 7_000,
      method: "cash",
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      amountCents: 12_000,
      manualHeldCents: 7_000,
      provider: "mixed",
      providerRef: "cs_mixed",
      method: "cash",
    });
    expect(
      (await f.db.select().from(collectionEntries)).reduce(
        (sum, entry) => sum + entry.amountCents,
        0,
      ),
    ).toBe(12_000);
  });

  it("keeps an exact late Stripe receipt separate from incompatible manual currency and raises a hold", async () => {
    const f = await fixture({ onlineSettled: false });
    await f.db.delete(collectionEntries).where(eq(collectionEntries.sourceId, f.checkout.id));
    await f.db
      .update(bookingCheckouts)
      .set({ status: "pending", settledTotalCents: null, completedAt: null })
      .where(eq(bookingCheckouts.id, f.checkout.id));
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "mxn",
      status: "deposit_paid",
      amountCents: 7_000,
      method: "cash",
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(
      (await f.db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, f.checkout.id)))[0]
        ?.status,
    ).toBe("completed");
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      currency: "mxn",
      amountCents: 7_000,
      manualHeldCents: 7_000,
    });
    expect(
      (await f.db.select().from(collectionEntries)).map((entry) => [
        entry.currency,
        entry.amountCents,
      ]),
    ).toEqual([
      ["mxn", 7_000],
      ["usd", 5_000],
    ]);
    expect(await f.db.select().from(paymentOperationIntents)).toContainEqual(
      expect.objectContaining({
        bookingId: f.booking.id,
        checkoutId: f.checkout.id,
        stripeObjectId: "cs_mixed",
        amountCents: 5_000,
        errorMessage: "settlement_currency_mismatch",
        status: "started",
      }),
    );
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await f.db.select().from(paymentOperationIntents)).toHaveLength(1);
    expect(await listUnfinished(f.db, f.shop.id, "payment_operation")).toContainEqual(
      expect.objectContaining({
        intent: expect.objectContaining({ errorMessage: "settlement_currency_mismatch" }),
      }),
    );
  });

  it("refuses a cash receipt while a Stripe refund is in flight", async () => {
    const f = await fixture();
    await upsertShopStripeAccount(f.db, f.shop.id, "acct_mixed");
    await setShopStripeAccountStatus(f.db, "acct_mixed", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = fakeCheckout({
      refundCheckoutSession: async () => {
        entered?.();
        await wait;
        return { status: "refunded", amountCents: 5_000, refundId: "re_pending" };
      },
    });
    const refund = refundBookingOnShopCancellation(
      f.db,
      { shopId: f.shop.id, bookingId: f.booking.id },
      provider,
    );
    await Promise.race([
      called,
      refund.then((outcome) => {
        throw new Error(`refund did not call provider: ${outcome.status}`);
      }),
    ]);
    try {
      expect(await f.cash(7_000, "paid")).toBeNull();
    } finally {
      release?.();
    }
    expect(await refund).toMatchObject({ status: "refunded", amountCents: 5_000 });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "refunded",
      manualHeldCents: 0,
    });
    expect(
      (await f.db.select().from(collectionEntries)).reduce(
        (sum, entry) => sum + entry.amountCents,
        0,
      ),
    ).toBe(0);
  });

  it("restores only card money if its refund fails after the cash was returned too", async () => {
    const f = await fixture();
    await f.cash(7_000, "paid");
    advanceClock();
    await recordStripeChargeRefund(f.db, {
      stripeAccountId: "acct_mixed",
      paymentIntentId: "pi_mixed",
      chargeId: "ch_mixed",
      amountRefundedCents: 5_000,
      occurredAt: new Date("2026-07-21T13:30:02Z"),
    });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      status: "refunded",
      currency: "usd",
      amountCents: 7_000,
      manualHeldCents: 0,
      provider: "mixed",
      providerRef: "cs_mixed",
      method: "cash",
    });
    advanceClock();
    await recordStripeRefundFailure(f.db, {
      stripeAccountId: "acct_mixed",
      paymentIntentId: "pi_mixed",
      refund: {
        id: "re_after_cash",
        amountCents: 5_000,
        currency: "usd",
        status: "failed",
        failureReason: null,
      },
      occurredAt: new Date("2026-07-21T13:30:04Z"),
    });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 5_000,
      manualHeldCents: 0,
      provider: "stripe",
      providerRef: "cs_mixed",
    });
    expect(
      (await f.db.select().from(collectionEntries)).reduce(
        (sum, entry) => sum + entry.amountCents,
        0,
      ),
    ).toBe(5_000);
  });

  it("restores card money after cash-first return and a later failed dashboard refund", async () => {
    const f = await fixture();
    await f.cash(7_000, "paid");
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      status: "partly_refunded",
      currency: "usd",
      amountCents: 5_000,
      manualHeldCents: 0,
      provider: "mixed",
      providerRef: "cs_mixed",
      method: "cash",
    });
    advanceClock();
    await recordStripeChargeRefund(f.db, {
      stripeAccountId: "acct_mixed",
      paymentIntentId: "pi_mixed",
      chargeId: "ch_cash_first",
      amountRefundedCents: 5_000,
      occurredAt: new Date("2026-07-21T13:30:03Z"),
    });
    advanceClock();
    await recordStripeRefundFailure(f.db, {
      stripeAccountId: "acct_mixed",
      paymentIntentId: "pi_mixed",
      refund: {
        id: "re_cash_first",
        amountCents: 5_000,
        currency: "usd",
        status: "failed",
        failureReason: null,
      },
      occurredAt: new Date("2026-07-21T13:30:04Z"),
    });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 5_000,
      manualHeldCents: 0,
      provider: "stripe",
      providerRef: "cs_mixed",
    });
    expect(
      (await f.db.select().from(collectionEntries)).reduce(
        (sum, entry) => sum + entry.amountCents,
        0,
      ),
    ).toBe(5_000);
  });

  it("does not overwrite a partial Stripe dashboard refund when the paid webhook replays", async () => {
    const f = await fixture();
    advanceClock();
    await recordStripeChargeRefund(f.db, {
      stripeAccountId: "acct_mixed",
      paymentIntentId: "pi_mixed",
      chargeId: "ch_partial_replay",
      amountRefundedCents: 2_000,
      occurredAt: new Date("2026-07-21T13:30:01Z"),
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 3_000,
      provider: "stripe",
    });
  });

  it("keeps a manual partial-return state when its delayed online deposit is reconciled", async () => {
    const f = await fixture({ onlineSettled: false });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "deposit_paid",
      amountCents: 7_000,
      method: "cash",
    });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "partly_refunded",
      amountCents: 4_000,
      method: "cash",
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 9_000,
      manualHeldCents: 4_000,
      provider: "mixed",
    });
  });

  it("raises a visible hold for a new online receipt after staff already returned the manual money", async () => {
    const f = await fixture({ onlineSettled: false });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "paid",
      amountCents: 7_000,
      method: "cash",
    });
    advanceClock();
    await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "refunded",
      amountCents: 7_000,
      method: "cash",
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "refunded",
      manualHeldCents: 0,
      provider: null,
    });
    expect(await listUnfinished(f.db, f.shop.id, "payment_operation")).toContainEqual(
      expect.objectContaining({
        intent: expect.objectContaining({
          errorMessage: "settlement_after_final_state",
          stripeObjectId: "cs_mixed",
          amountCents: 5_000,
        }),
      }),
    );
  });

  it.each(["mixed_paid", "mixed_partly", "stripe_partly", "stripe_final", "mixed_final"] as const)(
    "holds a distinct late Stripe capture without overwriting %s",
    async (state) => {
      const f = await fixture();
      if (state.startsWith("mixed")) await f.cash(7_000, "paid");
      if (state.endsWith("partly") || state.endsWith("final")) {
        advanceClock();
        await recordStripeChargeRefund(f.db, {
          stripeAccountId: "acct_mixed",
          paymentIntentId: "pi_mixed",
          chargeId: `ch_${state}`,
          amountRefundedCents: state.endsWith("final") ? 5_000 : 2_000,
          occurredAt: new Date("2026-07-21T13:30:03Z"),
        });
      }
      if (state === "mixed_final") {
        advanceClock();
        await setBookingPayment(f.db, {
          shopId: f.shop.id,
          bookingId: f.booking.id,
          currency: "usd",
          status: "refunded",
          amountCents: 0,
          manualHeldCents: 0,
          provider: "mixed",
          providerRef: "cs_mixed",
          method: "cash",
        });
      }
      const before = await getBookingPayment(f.db, f.shop.id, f.booking.id);
      const [extra] = await f.db
        .insert(bookingCheckouts)
        .values({
          shopId: f.shop.id,
          tripId: f.booking.tripId,
          stripeAccountId: "acct_mixed",
          stripeSessionId: `cs_extra_${state}`,
          currency: "usd",
          totalCents: 2_000,
          amountPerDiverCents: 2_000,
        })
        .returning();
      if (!extra || !before) throw new Error("missing source");
      await f.db.insert(bookingCheckoutBookings).values({
        shopId: f.shop.id,
        bookingId: f.booking.id,
        checkoutId: extra.id,
        tripCents: 2_000,
      });
      advanceClock();
      await markCheckoutPaidBySessionId(f.db, extra.stripeSessionId, "acct_mixed", 2_000, 0);
      expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
        id: before.id,
        amountCents: before.amountCents,
        manualHeldCents: before.manualHeldCents,
        providerRef: before.providerRef,
      });
      expect(await listUnfinished(f.db, f.shop.id, "payment_operation")).toContainEqual(
        expect.objectContaining({
          intent: expect.objectContaining({
            checkoutId: extra.id,
            stripeObjectId: extra.stripeSessionId,
            amountCents: 2_000,
          }),
        }),
      );
      await markCheckoutPaidBySessionId(f.db, extra.stripeSessionId, "acct_mixed", 2_000, 0);
      expect(
        (await f.db.select().from(paymentOperationIntents)).filter(
          (intent) => intent.stripeObjectId === extra.stripeSessionId,
        ),
      ).toHaveLength(1);
    },
  );

  it("does not invent a new-source hold for an already applied checkout after its own refund ID replaced the pointer", async () => {
    const f = await fixture();
    await upsertShopStripeAccount(f.db, f.shop.id, "acct_mixed");
    await setShopStripeAccountStatus(f.db, "acct_mixed", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    advanceClock();
    await refundBookingOnShopCancellation(
      f.db,
      { shopId: f.shop.id, bookingId: f.booking.id },
      fakeCheckout({
        refundCheckoutSession: async () => ({
          status: "refunded",
          amountCents: 5_000,
          refundId: "re_known",
        }),
      }),
    );
    const before = await getBookingPayment(f.db, f.shop.id, f.booking.id);
    expect(before).toMatchObject({ status: "refunded", providerRef: "re_known" });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      id: before?.id,
      status: "refunded",
      providerRef: "re_known",
    });
    expect(await listUnfinished(f.db, f.shop.id, "payment_operation")).toHaveLength(0);
  });

  it("does not replay an old deposit over a newer settled invoice source", async () => {
    const f = await fixture();
    advanceClock();
    const latest = await setBookingPayment(f.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      status: "paid",
      amountCents: 7_000,
      currency: "usd",
      provider: "stripe",
      providerRef: "in_later",
      operation: "order_settled",
    });
    advanceClock();
    await markCheckoutPaidBySessionId(f.db, "cs_mixed", "acct_mixed", 5_000, 0);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      id: latest?.id,
      status: "paid",
      providerRef: "in_later",
      amountCents: 7_000,
    });
    expect(await listUnfinished(f.db, f.shop.id, "payment_operation")).toHaveLength(0);
  });

  it("refuses a stale repeated receipt instead of counting the same cash twice", async () => {
    const f = await fixture();
    const previous = await getBookingPayment(f.db, f.shop.id, f.booking.id);
    if (!previous) throw new Error("payment missing");
    const input = {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      currency: "usd",
      status: "paid" as const,
      expectedPaymentEntryId: previous.id,
      ...heldAfterDepositReceipt(previous, { kind: "money", amountCents: 7_000, method: "cash" }),
    };
    await setBookingPayment(f.db, input);
    expect(await setBookingPayment(f.db, input)).toBeNull();
    expect(await f.db.select().from(collectionEntries)).toHaveLength(2);
  });
});
