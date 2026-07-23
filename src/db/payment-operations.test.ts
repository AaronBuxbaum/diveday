// @vitest-environment node

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  claimBookingsForCheckout,
  idempotencyKeyFor,
  listStuckPaymentOperations,
  releaseBookingCheckoutClaim,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { bookings, paymentOperationIntents, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

async function bookedContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const outcome = await createBooking(db, {
    shopId: shop.id,
    tripId: reef.id,
    fullName: "Claim Test Diver",
    email: "claim-test@example.com",
  });
  if (!outcome.ok) throw new Error(`setup booking failed: ${outcome.reason}`);
  return { db, shop, reef, bookingId: outcome.bookingId };
}

describe("startPaymentOperation / resolvePaymentOperation", () => {
  it("is durable before Stripe is ever called, then records how the call resolved", async () => {
    const { db, shop, reef } = await bookedContext();
    const intent = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "checkout_session",
      tripId: reef.id,
    });
    expect(intent.status).toBe("started");
    expect(intent.resolvedAt).toBeNull();

    await resolvePaymentOperation(db, intent.id, {
      status: "succeeded",
      stripeObjectId: "cs_test_1",
    });
    const [row] = await db
      .select()
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.id, intent.id));
    expect(row?.status).toBe("succeeded");
    expect(row?.stripeObjectId).toBe("cs_test_1");
    expect(row?.resolvedAt).not.toBeNull();
  });

  it("records a failure with its error message", async () => {
    const { db, shop } = await bookedContext();
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "invoice" });
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: "failed" });
    const [row] = await db
      .select()
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.id, intent.id));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe("failed");
  });
});

describe("idempotencyKeyFor", () => {
  it("is the bare intent id with no step", () => {
    expect(idempotencyKeyFor("intent-1")).toBe("intent-1");
  });

  it("suffixes a step for a multi-request operation", () => {
    expect(idempotencyKeyFor("intent-1", "customer")).toBe("intent-1:customer");
    expect(idempotencyKeyFor("intent-1", "item:0")).toBe("intent-1:item:0");
  });
});

describe("claimBookingsForCheckout / releaseBookingCheckoutClaim", () => {
  it("claims a free booking and releases it", async () => {
    const { db, shop, bookingId } = await bookedContext();
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });

    expect(
      await claimBookingsForCheckout(db, { bookingIds: [bookingId], intentId: intent.id }),
    ).toBe(true);
    const [claimed] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(claimed?.pendingCheckoutIntentId).toBe(intent.id);

    await releaseBookingCheckoutClaim(db, [bookingId], intent.id);
    const [released] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(released?.pendingCheckoutIntentId).toBeNull();
  });

  it("refuses a second concurrent claim on a booking already actively claimed", async () => {
    const { db, shop, bookingId } = await bookedContext();
    const first = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(
      await claimBookingsForCheckout(db, { bookingIds: [bookingId], intentId: first.id }),
    ).toBe(true);

    // A second attempt for the same booking — e.g. a diver double-clicking
    // "pay now", or two tabs racing — must not also be allowed to call
    // Stripe while the first attempt is still unresolved (CR-005).
    const second = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(
      await claimBookingsForCheckout(db, { bookingIds: [bookingId], intentId: second.id }),
    ).toBe(false);

    // The booking is still held by the first attempt, not partially
    // reassigned to the loser.
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.pendingCheckoutIntentId).toBe(first.id);
  });

  it("gives back a partial claim when any booking in the party is already held", async () => {
    const { db, shop, reef, bookingId: freeBookingId } = await bookedContext();
    const held = await createBooking(db, {
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Held Booking Diver",
      email: "held-claim-test@example.com",
    });
    if (!held.ok) throw new Error("setup booking failed");

    const holder = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(
      await claimBookingsForCheckout(db, {
        bookingIds: [held.bookingId],
        intentId: holder.id,
      }),
    ).toBe(true);

    const challenger = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "checkout_session",
    });
    const claimed = await claimBookingsForCheckout(db, {
      bookingIds: [freeBookingId, held.bookingId],
      intentId: challenger.id,
    });
    expect(claimed).toBe(false);

    // The booking the challenger *could* have claimed is not left stuck on
    // its own losing attempt.
    const [freeOne] = await db.select().from(bookings).where(eq(bookings.id, freeBookingId));
    expect(freeOne?.pendingCheckoutIntentId).toBeNull();
  });

  it("self-heals a claim abandoned by a crashed attempt instead of blocking the booking forever", async () => {
    const { db, shop, bookingId } = await bookedContext();
    const abandoned = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "checkout_session",
    });
    expect(
      await claimBookingsForCheckout(db, { bookingIds: [bookingId], intentId: abandoned.id }),
    ).toBe(true);
    // Never resolved — as if the process died right after claiming.

    const rescuer = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    const claimed = await claimBookingsForCheckout(db, {
      bookingIds: [bookingId],
      intentId: rescuer.id,
      // Treat the abandoned intent as stale even though it just started, so
      // the test doesn't depend on real wall-clock time passing.
      staleBefore: new Date(Date.now() + 1000),
    });
    expect(claimed).toBe(true);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.pendingCheckoutIntentId).toBe(rescuer.id);
  });
});

describe("listStuckPaymentOperations", () => {
  it("surfaces an intent still started well past a reasonable Stripe round trip", async () => {
    const { db, shop, reef } = await bookedContext();
    const intent = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "checkout_session",
      tripId: reef.id,
    });

    // Not yet old enough to count as stuck.
    expect(await listStuckPaymentOperations(db, shop.id, new Date(0))).toEqual([]);

    const stuck = await listStuckPaymentOperations(db, shop.id, new Date(Date.now() + 1000));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.intent.id).toBe(intent.id);
    expect(stuck[0]?.tripTitle).toBe(reef.title);
  });

  it("does not surface a resolved intent", async () => {
    const { db, shop } = await bookedContext();
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "invoice" });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
    const stuck = await listStuckPaymentOperations(db, shop.id, new Date(Date.now() + 1000));
    expect(stuck).toEqual([]);
  });

  it("scopes to the requesting shop", async () => {
    const { db, shop } = await bookedContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-payment-ops-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await startPaymentOperation(db, { shopId: otherShop.id, kind: "invoice" });
    const stuck = await listStuckPaymentOperations(db, shop.id, new Date(Date.now() + 1000));
    expect(stuck).toEqual([]);
  });
});
