import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import {
  createTrip,
  createTripSeries,
  editTripSection,
  getTripWithBooked,
  setTripParticipantTerms,
} from "./trips";

const ctx = fileScopedShopContext();
const terms = {
  depositCents: 5000,
  cancellationWindowHours: 24,
  minimumBookings: 3,
  snorkelerPriceCents: 0,
  riderPriceCents: 2000,
  shopDefaultFields: [
    "depositCents",
    "cancellationWindowHours",
    "minimumBookings",
    "snorkelerPriceCents",
    "riderPriceCents",
  ] as const,
};

describe("trip default provenance", () => {
  it("retains unchanged fields and removes provenance for changed terms", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Terms",
      startsAt: new Date("2030-08-02T13:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 10,
      ...terms,
      shopDefaultFields: [...terms.shopDefaultFields],
    });
    if (!trip) throw new Error("trip missing");
    expect(
      (await editTripSection(db, shop.id, trip.id, { depositCents: 5000, minimumBookings: null }))
        .ok,
    ).toBe(true);
    expect(
      (
        await setTripParticipantTerms(db, shop.id, trip.id, {
          snorkelerPriceCents: 0,
          riderPriceCents: null,
          diverCapacity: null,
        })
      ).ok,
    ).toBe(true);
    expect(await getTripWithBooked(db, shop.id, trip.id)).toMatchObject({
      shopDefaultFields: ["depositCents", "cancellationWindowHours", "snorkelerPriceCents"],
    });
  });
  it("copies terms and provenance to the seed and later series instances", async () => {
    const { db, shop } = ctx;
    const series = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturdays",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([6]),
      anchorDate: "2030-09-07",
      endsOn: "2030-09-21",
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-07T11:00:00Z"),
        endsAt: new Date("2030-09-07T15:00:00Z"),
      },
      ...terms,
      shopDefaultFields: [...terms.shopDefaultFields],
    });
    expect(series?.trips.length).toBeGreaterThan(1);
    for (const trip of series?.trips ?? []) expect(trip).toMatchObject(terms);
  });
});
