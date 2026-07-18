// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getBookingPayment, setBookingPayment } from "./payments";
import { getShopBySlug, getTripRoster, upcomingTripsWithCounts } from "./queries";
import { getBookingReadiness, upsertTripRequirements } from "./readiness";
import { seedDemo } from "./seed";

async function paymentContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, reef.id);
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
    });
    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "payment_due" }),
    );
  });

  it("keeps one current payment row per booking and is tenant-safe", async () => {
    const { db, shop, entry } = await paymentContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "paid",
      amountCents: 18000,
    });
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "waived",
    });
    const payment = await getBookingPayment(db, shop.id, entry.booking.id);
    expect(payment?.status).toBe("waived");

    expect(
      await setBookingPayment(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: entry.booking.id,
        status: "paid",
      }),
    ).toBeNull();
  });
});
