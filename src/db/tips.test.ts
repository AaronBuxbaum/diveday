import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { bookings, tips } from "./schema";
import { setShopCurrency } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  getLatestTipForBooking,
  getTipCurrencyForBooking,
  markTipExpiredBySessionId,
  markTipPaidBySessionId,
  startTipCheckout,
  tipBoundsCents,
} from "./tips";
import { upcomingTripsWithCounts } from "./trips";

function fakeCheckout(overrides: Partial<CheckoutProvider> = {}): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request): Promise<CreateCheckoutSessionResult> {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_tip_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_tip_${counter}`,
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
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_test" };
    },
    ...overrides,
  };
}

/** A provider that records every request it was handed, for currency/amount assertions. */
function capturedRequests() {
  const requests: Parameters<CheckoutProvider["createCheckoutSession"]>[0][] = [];
  const inner = fakeCheckout();
  const provider = fakeCheckout({
    async createCheckoutSession(request) {
      requests.push(request);
      return inner.createCheckoutSession(request);
    },
  });
  return { requests, provider };
}

async function tipContext() {
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
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Tip Diver",
      email: "tip-diver@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { db, shop, bookingId: party.bookings[0].bookingId };
}

function tipInput(bookingId: string, amountCents = 1000) {
  return {
    bookingId,
    amountCents,
    successUrl: "https://diveday.example/recap/tok?tip=paid",
    cancelUrl: "https://diveday.example/recap/tok?tip=cancelled",
    // The real caller composes this from `checkoutLine.tip`; the marker makes
    // it obvious in an assertion that the words came from the caller, not from
    // `src/db` (docs ADR 20260731-domain-layer-copy-leaks).
    lineDescription: "CALLER_TIP_LABEL",
  };
}

describe("startTipCheckout", () => {
  it("creates a pending tip and hands back the hosted checkout URL", async () => {
    const { db, shop, bookingId } = await tipContext();
    const outcome = await startTipCheckout(db, tipInput(bookingId), fakeCheckout());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);

    const tip = await getLatestTipForBooking(db, shop.id, bookingId);
    expect(tip?.status).toBe("pending");
    expect(tip?.amountCents).toBe(1000);

    const wrongShopId = "00000000-0000-0000-0000-000000000000";
    expect(await getLatestTipForBooking(db, wrongShopId, bookingId)).toBeNull(); // tenant isolation holds
  });

  it("refuses an amount outside the bounds", async () => {
    const { db, bookingId } = await tipContext();
    const { minCents, maxCents } = tipBoundsCents("usd");
    const tooLow = await startTipCheckout(db, tipInput(bookingId, minCents - 1), fakeCheckout());
    expect(tooLow).toEqual({ ok: false, reason: "invalid_amount" });
    const tooHigh = await startTipCheckout(db, tipInput(bookingId, maxCents + 1), fakeCheckout());
    expect(tooHigh).toEqual({ ok: false, reason: "invalid_amount" });
    // A fractional minor unit is not a chargeable amount in any currency.
    const fractional = await startTipCheckout(db, tipInput(bookingId, 1000.5), fakeCheckout());
    expect(fractional).toEqual({ ok: false, reason: "invalid_amount" });
  });

  it("refuses when the shop has no connected, charges-enabled Stripe account", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "No Stripe Diver",
        email: "no-stripe@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const outcome = await startTipCheckout(
      db,
      tipInput(party.bookings[0].bookingId),
      fakeCheckout(),
    );
    expect(outcome).toEqual({ ok: false, reason: "not_connected" });
  });

  it("refuses a booking that isn't real or belongs to no one", async () => {
    const { db } = await tipContext();
    const outcome = await startTipCheckout(
      db,
      tipInput("00000000-0000-0000-0000-000000000000"),
      fakeCheckout(),
    );
    expect(outcome).toEqual({ ok: false, reason: "invalid_booking" });
  });

  it("refuses a tip for a no-show — no crew took them out (Codex finding)", async () => {
    const { db, bookingId } = await tipContext();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    const outcome = await startTipCheckout(db, tipInput(bookingId), fakeCheckout());
    expect(outcome).toEqual({ ok: false, reason: "invalid_booking" });
  });

  it("charges in the shop's own currency, not the connected account's and not a hardcoded usd", async () => {
    const { db, shop, bookingId } = await tipContext();
    await setShopCurrency(db, shop.id, "eur");
    // Stripe reports something else for the connected account. That stays
    // advisory (`stripeCurrencyMismatch` surfaces it in settings) and must
    // never override what the shop declared (task 35, superseding task 60's
    // read of `default_currency` here).
    await setShopStripeAccountStatus(db, "acct_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
    const seen = capturedRequests();

    const outcome = await startTipCheckout(db, tipInput(bookingId), seen.provider);
    expect(outcome.ok).toBe(true);
    expect(seen.requests.map((r) => r.currency)).toEqual(["eur"]);

    const tip = await getLatestTipForBooking(db, shop.id, bookingId);
    expect(tip?.currency).toBe("eur");
  });

  it("never divides a zero-decimal currency by 100, and bounds it by value", async () => {
    const { db, shop, bookingId } = await tipContext();
    await setShopCurrency(db, shop.id, "jpy");
    expect(await getTipCurrencyForBooking(db, bookingId)).toBe("jpy");

    // ¥1,000 is 1000 minor units, not 100,000 — the divisor comes from the
    // currency, and JPY's minor unit *is* the yen (docs ADR 20260731-shop-currency).
    const seen = capturedRequests();
    const outcome = await startTipCheckout(db, tipInput(bookingId, 1000), seen.provider);
    expect(outcome.ok).toBe(true);
    expect(seen.requests[0]?.currency).toBe("jpy");
    expect(seen.requests[0]?.lineItems[0]?.unitAmountCents).toBe(1000);
    expect((await getLatestTipForBooking(db, shop.id, bookingId))?.amountCents).toBe(1000);

    // The bound means roughly the same amount of money, not the same integer:
    // ¥1,000 sits well inside a yen-denominated range, where the old flat
    // 100–50,000 minor-unit bound would have capped a tip at about $3.
    const { minCents, maxCents } = tipBoundsCents("jpy");
    expect(minCents).toBeLessThan(1000);
    expect(maxCents).toBeGreaterThan(50_000);
    // …and nothing about that range is a multiple of a hundred cents.
    expect(Number.isInteger(minCents)).toBe(true);
    expect(Number.isInteger(maxCents)).toBe(true);
  });

  it("keeps a settled tip's own currency after the shop switches", async () => {
    const { db, shop, bookingId } = await tipContext();
    await setShopCurrency(db, shop.id, "eur");
    const started = await startTipCheckout(db, tipInput(bookingId, 2000), fakeCheckout());
    expect(started.ok).toBe(true);
    const [row] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!row) throw new Error("tip row missing");
    await markTipPaidBySessionId(db, row.stripeSessionId);

    await setShopCurrency(db, shop.id, "jpy");
    const settled = await getLatestTipForBooking(db, shop.id, bookingId);
    // A settled amount is evidence, never re-read through today's setting.
    expect(settled?.currency).toBe("eur");
    expect(settled?.amountCents).toBe(2000);
  });

  it("reuses a still-open pending tip instead of minting a second Stripe session", async () => {
    const { db, bookingId } = await tipContext();
    const provider = fakeCheckout();
    const first = await startTipCheckout(db, tipInput(bookingId), provider);
    if (!first.ok) throw new Error("expected ok");

    const second = await startTipCheckout(db, tipInput(bookingId, 2000), provider);
    expect(second).toEqual(first); // same session handed back, no second one created

    const rows = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    expect(rows).toHaveLength(1); // never two pending sessions for one booking
  });

  it("does not reuse a tip that already expired", async () => {
    const { db, bookingId } = await tipContext();
    const provider = fakeCheckout();
    const first = await startTipCheckout(db, tipInput(bookingId), provider);
    if (!first.ok) throw new Error("expected ok");
    const [firstRow] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!firstRow) throw new Error("first tip row missing");
    await markTipExpiredBySessionId(db, firstRow.stripeSessionId);

    const second = await startTipCheckout(db, tipInput(bookingId, 2000), provider);
    expect(second).not.toEqual(first);
    const rows = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    expect(rows).toHaveLength(2);
  });
});

describe("getLatestTipForBooking", () => {
  it("returns the most recently started tip, not the first one", async () => {
    const { db, shop, bookingId } = await tipContext();
    const provider = fakeCheckout();
    const first = await startTipCheckout(db, tipInput(bookingId, 500), provider);
    if (!first.ok) throw new Error("expected ok");
    // A still-pending tip is reused, not duplicated (the concurrent-double-
    // charge fix) — expire the first attempt so the second is a genuinely
    // new one, to exercise "most recent" across two real rows.
    const [firstRow] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!firstRow) throw new Error("first tip row missing");
    await markTipExpiredBySessionId(db, firstRow.stripeSessionId);
    const second = await startTipCheckout(db, tipInput(bookingId, 1500), provider);
    if (!second.ok) throw new Error("expected ok");

    const latest = await getLatestTipForBooking(db, shop.id, bookingId);
    expect(latest?.amountCents).toBe(1500);
    expect(latest?.checkoutUrl).toBe(second.checkoutUrl);
  });
});

describe("markTipPaidBySessionId / markTipExpiredBySessionId", () => {
  it("marks a tip paid from Stripe evidence, idempotently", async () => {
    const { db, bookingId } = await tipContext();
    const started = await startTipCheckout(db, tipInput(bookingId), fakeCheckout());
    if (!started.ok) throw new Error("expected ok");
    const [row] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!row) throw new Error("tip row missing");

    const paid = await markTipPaidBySessionId(db, row.stripeSessionId);
    expect(paid?.status).toBe("paid");
    expect(paid?.completedAt).not.toBeNull();

    // Re-running must not throw or move completedAt.
    const again = await markTipPaidBySessionId(db, row.stripeSessionId);
    expect(again?.completedAt?.getTime()).toBe(paid?.completedAt?.getTime());
  });

  it("expires a pending tip and leaves a paid one alone", async () => {
    const { db, bookingId } = await tipContext();
    const started = await startTipCheckout(db, tipInput(bookingId), fakeCheckout());
    if (!started.ok) throw new Error("expected ok");
    const [row] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!row) throw new Error("tip row missing");

    const expired = await markTipExpiredBySessionId(db, row.stripeSessionId);
    expect(expired?.status).toBe("expired");

    await markTipPaidBySessionId(db, row.stripeSessionId); // resurrect for the next assertion path
    const noOp = await markTipExpiredBySessionId(db, row.stripeSessionId);
    expect(noOp).toBeNull(); // already-paid tip is never downgraded to expired
  });

  it("returns null for an unknown session id", async () => {
    const { db } = await tipContext();
    expect(await markTipPaidBySessionId(db, "cs_unknown")).toBeNull();
    expect(await markTipExpiredBySessionId(db, "cs_unknown")).toBeNull();
  });

  // Defense-in-depth (security review finding): a webhook event whose
  // top-level `account` disagrees with the tip's own connected account is
  // refused even though the session id alone already matched a row.
  it("refuses to mark a tip paid or expired when the expected account doesn't match", async () => {
    const { db, bookingId } = await tipContext();
    const started = await startTipCheckout(db, tipInput(bookingId), fakeCheckout());
    if (!started.ok) throw new Error("expected ok");
    const [row] = await db.select().from(tips).where(eq(tips.bookingId, bookingId));
    if (!row) throw new Error("tip row missing");

    expect(await markTipPaidBySessionId(db, row.stripeSessionId, "acct_evil")).toBeNull();
    expect(await markTipExpiredBySessionId(db, row.stripeSessionId, "acct_evil")).toBeNull();

    const untouched = await getLatestTipForBooking(db, row.shopId, bookingId);
    expect(untouched?.status).toBe("pending");

    // The real account still works.
    expect((await markTipPaidBySessionId(db, row.stripeSessionId, "acct_test"))?.status).toBe(
      "paid",
    );
  });
});
