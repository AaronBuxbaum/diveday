// @vitest-environment node

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { tips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  getLatestTipForBooking,
  MAX_TIP_CENTS,
  MIN_TIP_CENTS,
  markTipExpiredBySessionId,
  markTipPaidBySessionId,
  startTipCheckout,
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
        amountTotalCents: request.unitAmountCents * request.quantity,
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
    const tooLow = await startTipCheckout(
      db,
      tipInput(bookingId, MIN_TIP_CENTS - 1),
      fakeCheckout(),
    );
    expect(tooLow).toEqual({ ok: false, reason: "invalid_amount" });
    const tooHigh = await startTipCheckout(
      db,
      tipInput(bookingId, MAX_TIP_CENTS + 1),
      fakeCheckout(),
    );
    expect(tooHigh).toEqual({ ok: false, reason: "invalid_amount" });
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
});

describe("getLatestTipForBooking", () => {
  it("returns the most recently started tip, not the first one", async () => {
    const { db, shop, bookingId } = await tipContext();
    const provider = fakeCheckout();
    const first = await startTipCheckout(db, tipInput(bookingId, 500), provider);
    if (!first.ok) throw new Error("expected ok");
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
});
