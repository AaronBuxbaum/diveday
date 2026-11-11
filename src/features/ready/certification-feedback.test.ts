import { describe, expect, it } from "vitest";
import { createBooking } from "@/db/bookings";
import { createCertification, getBookingReadiness, upsertTripRequirements } from "@/db/readiness";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getReadyPageData } from "./store";

const ctx = fileScopedShopContext();

async function unpaidBooking() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Certification Audit Diver",
    email: "cert-audit@example.com",
    phone: "+1-305-555-0199",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  const row = (await getTripRoster(db, shop.id, open.id)).find(
    (entry) => entry.booking.id === booked.bookingId,
  );
  if (!row) throw new Error("booking absent from roster");
  return { db, shop, open, bookingId: booked.bookingId, personId: row.person.id };
}

describe("saved certification feedback", () => {
  it("reloads a submitted lower card as unverified and insufficient, never missing or cleared", async () => {
    const { db, shop, open, bookingId, personId } = await unpaidBooking();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: open.id,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
      requiresWaiver: true,
      requiresPayment: true,
    });
    const before = await getReadyPageData(db, bookingId);
    if (!before) throw new Error("missing ready page");
    expect(before.detail.readiness.blockers).toContainEqual({ code: "certification_missing" });
    await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: "DEMO-AUDIT-NOT-REAL",
      selfDeclaredAt: nowDate(),
    });
    for (let reload = 0; reload < 2; reload++) {
      const data = await getReadyPageData(db, bookingId);
      expect(data?.detail.readiness.status).toBe("blocked");
      expect(data?.detail.readiness.blockers).toEqual(
        expect.arrayContaining([
          {
            code: "certification_insufficient",
            params: {
              requiredLevel: "advanced_open_water",
              heldLevel: "open_water",
              heldUnverified: true,
            },
          },
          { code: "specialty_missing", params: { specialty: "deep" } },
          { code: "nitrox_missing" },
        ]),
      );
      expect(data?.detail.readiness.blockers.map((blocker) => blocker.code)).not.toContain(
        "certification_missing",
      );
    }
    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    expect(readiness?.blockers).toContainEqual({
      code: "certification_insufficient",
      params: {
        requiredLevel: "advanced_open_water",
        heldLevel: "open_water",
        heldUnverified: true,
      },
    });
  });
});
