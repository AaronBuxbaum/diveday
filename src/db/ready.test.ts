// @vitest-environment node
import { describe, expect, it } from "vitest";
import { verifyReadinessToken } from "@/lib/readiness-links";
import { seededShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { getReadyPageData } from "./ready";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

async function seededBooking() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, trip.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, trip, booking: entry.booking, person: entry.person };
}

describe("getReadyPageData", () => {
  it("gathers a live booking's readiness, and gates pay off without a Stripe account", async () => {
    const { db, trip, booking } = await seededBooking();
    const data = await getReadyPageData(db, booking.id);
    expect(data).not.toBeNull();
    expect(data?.detail.trip.title).toBe(trip.title);
    expect(data?.detail.cancelled).toBe(false);
    // No connected Stripe account in the seed, so pay-from-page stays off.
    expect(data?.canPay).toBe(false);
  });

  it("marks a cancelled booking so the page (and its write actions) refuse it", async () => {
    const { db, shop, booking } = await seededBooking();
    await cancelBooking(db, shop.id, booking.id);
    const data = await getReadyPageData(db, booking.id);
    // The loader still resolves so the page can say "cancelled" plainly; the
    // transactional actions read this same flag and refuse to write.
    expect(data?.detail.cancelled).toBe(true);
  });

  it("returns null for a booking that does not exist", async () => {
    const { db } = await seededBooking();
    await expect(getReadyPageData(db, "00000000-0000-4000-8000-000000000099")).resolves.toBeNull();
  });

  it("rejects a tampered readiness token before any lookup", () => {
    expect(verifyReadinessToken("not-a-real-token")).toBeNull();
    expect(verifyReadinessToken("")).toBeNull();
  });
});
