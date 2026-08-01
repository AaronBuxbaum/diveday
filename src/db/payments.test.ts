// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { getBookingPayment, setBookingPayment, setBookingPaymentIfNotFinal } from "./payments";
import { getBookingReadiness, upsertTripRequirements } from "./readiness";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

async function paymentContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, reef, entry };
}

describe("booking payments", () => {
  it("gates a pay-to-board trip on payment state, fail-closed to unpaid", async () => {
    const { db, shop, reef, entry } = await paymentContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: true,
    });

    // No payment row yet → blocked.
    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "payment_due" }),
    );

    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "deposit_paid",
      currency: "usd",
      amountCents: 6000,
    });
    expect(await getBookingReadiness(db, shop.id, entry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });

    // A refund re-opens the gate.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "refunded",
      currency: "usd",
    });
    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "payment_refunded" }),
    );
  });

  it("keeps one current payment row per booking and is tenant-safe", async () => {
    const { db, shop, entry } = await paymentContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "paid",
      currency: "usd",
      amountCents: 18000,
    });
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "waived",
      currency: "usd",
    });
    const payment = await getBookingPayment(db, shop.id, entry.booking.id);
    expect(payment?.status).toBe("waived");

    expect(
      await setBookingPayment(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: entry.booking.id,
        status: "paid",
        currency: "usd",
      }),
    ).toBeNull();
  });
});

describe("setBookingPaymentIfNotFinal", () => {
  it("refuses to write a lesser status over a refunded or waived row", async () => {
    const { db, shop, entry } = await paymentContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "refunded",
      currency: "usd",
      providerRef: "re_original",
    });

    const result = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "paid",
        currency: "usd",
        providerRef: "cs_replay",
      }),
    );
    expect(result?.status).toBe("refunded");
    expect(result?.providerRef).toBe("re_original");
    expect((await getBookingPayment(db, shop.id, entry.booking.id))?.status).toBe("refunded");
  });

  it("writes normally when there is no existing row or the existing row is not final", async () => {
    const { db, shop, entry } = await paymentContext();

    const first = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "deposit_paid",
        currency: "usd",
        amountCents: 6000,
      }),
    );
    expect(first?.status).toBe("deposit_paid");

    const second = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "paid",
        currency: "usd",
        amountCents: 18000,
      }),
    );
    expect(second?.status).toBe("paid");
  });

  it("always writes a final status as the input regardless of the current one", async () => {
    const { db, shop, entry } = await paymentContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "paid",
      currency: "usd",
      amountCents: 18000,
    });

    const refunded = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "refunded",
        currency: "usd",
        amountCents: 0,
      }),
    );
    expect(refunded?.status).toBe("refunded");
  });

  // A security review of the original CR-004 fix found the `FOR UPDATE` guard
  // took no lock at all on a booking's *first* payment event, because
  // `SELECT ... FOR UPDATE` against zero matching `booking_payments` rows
  // locks nothing — exactly the case here, since neither write below has a
  // pre-existing row. `setBookingPayment`/`setBookingPaymentIfNotFinal` now
  // both lock the always-existing `bookings` row instead (`payments.ts`'s
  // `withBookingPaymentLock`), so a staff write and a webhook cascade
  // serialize regardless of whether `booking_payments` has a row yet. PGlite
  // is single-connection and can't exhibit the actual race (same limitation
  // documented in src/db/bookings.ts) — these tests are the sequential
  // regression check that the locking rewrite didn't change either
  // function's observable behavior, not a reproduction of the race itself.
  it("refuses a regression even when the refund/waive itself was the booking's first-ever payment write", async () => {
    const { db, shop, entry } = await paymentContext();
    // No prior setBookingPayment call for this booking — the exact "no row
    // yet" condition that made the old FOR UPDATE guard a no-op.
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();

    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "waived",
      currency: "usd",
    });

    const result = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "paid",
        currency: "usd",
        providerRef: "cs_late_webhook",
      }),
    );
    expect(result?.status).toBe("waived");
    expect((await getBookingPayment(db, shop.id, entry.booking.id))?.status).toBe("waived");
  });

  // A provider-webhook reconciliation write (checkout/order payment cascade)
  // must never attribute money to a seat that's already been released — the
  // status check has to run under the same lock that guards the write, not
  // via an earlier unlocked read by the caller, otherwise a self-cancellation
  // racing in between could still leave a phantom "paid" record on a
  // cancelled booking (Codex finding). PGlite is single-connection so this is
  // the sequential regression check (see the comment above), not a
  // reproduction of the actual race.
  it("refuses to pay a cancelled booking, even with no prior payment row", async () => {
    const { db, shop, entry } = await paymentContext();
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();
    await cancelBooking(db, shop.id, entry.booking.id);

    const result = await db.transaction((tx) =>
      setBookingPaymentIfNotFinal(tx, {
        shopId: shop.id,
        bookingId: entry.booking.id,
        status: "paid",
        currency: "usd",
        providerRef: "cs_after_cancel",
      }),
    );
    expect(result).toBeNull();
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();
  });
});
