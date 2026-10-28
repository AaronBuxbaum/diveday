import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { boats, rollCallEvents } from "./schema";
import {
  createTrip,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  listTripScheduleDays,
  upcomingTripsWithCounts,
  updateTripSection,
} from "./trips";

const ctx = fileScopedShopContext();

describe("independent departure sections (#3141)", () => {
  it("preserves the current values of every unrelated section across saves", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Three-day trip",
      startsAt: new Date("2030-08-02T13:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 10,
      priceCents: 18000,
    });
    if (!trip) throw new Error("trip not created");
    const days = await listTripScheduleDays(db, shop.id, trip.id);
    await updateTripSection(db, shop.id, trip.id, {
      meetingPointLabel: "North dock",
      description: "A quiet reef",
      depositCents: 6000,
      minimumBookings: 4,
      minimumDecisionHours: 24,
      isPrivate: true,
      lunchAboard: true,
    });
    await updateTripSection(db, shop.id, trip.id, { priceCents: 21000, capacity: 11 });
    const saved = await updateTripSection(db, shop.id, trip.id, { plannedDives: 3 });
    expect(saved.ok).toBe(true);
    expect(await getTripWithBooked(db, shop.id, trip.id)).toMatchObject({
      title: "Three-day trip",
      description: "A quiet reef",
      meetingPointLabel: "North dock",
      priceCents: 21000,
      depositCents: 6000,
      minimumBookings: 4,
      minimumDecisionHours: 24,
      isPrivate: true,
      lunchAboard: true,
      plannedDives: 3,
      capacity: 11,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
    });
    expect(await listTripScheduleDays(db, shop.id, trip.id)).toEqual(days);
    expect(
      (
        await updateTripSection(db, "00000000-0000-4000-8000-000000000001", trip.id, {
          title: "Other shop",
        })
      ).ok,
    ).toBe(false);
    expect((await getTripWithBooked(db, shop.id, trip.id))?.title).toBe("Three-day trip");
  });
});

describe("scoped saves use the current boat and seat count together", () => {
  it("refuses a capacity above the current hull certificate and preserves both facts", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Certified for six", 12);
    await db.update(boats).set({ certifiedPassengers: 6 }).where(eq(boats.id, boat.id));
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Six seat boat",
      startsAt: new Date("2030-08-02T13:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 6,
      boatId: boat.id,
    });
    if (!trip) throw new Error("trip not created");
    expect(await updateTripSection(db, shop.id, trip.id, { capacity: 7 })).toMatchObject({
      ok: false,
      reason: "capacity_above_certificate",
      detail: { limit: 6 },
    });
    expect((await getTripWithBooked(db, shop.id, trip.id))?.capacity).toBe(6);
  });
});

it("retains booked-seat and recorded-roll-call floors for partial section edits", async () => {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id)).find(
    (trip) => trip.title === "Two-Tank Reef — Molasses & French",
  );
  if (!reef) throw new Error("seeded reef missing");
  expect(
    await updateTripSection(db, shop.id, reef.id, { capacity: reef.booked - 1 }),
  ).toMatchObject({ ok: false, reason: "capacity_below_booked" });
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  const [staff] = await listStaff(db, shop.id);
  if (!entry || !staff) throw new Error("seeded diver or crew missing");
  await db.insert(rollCallEvents).values({
    shopId: shop.id,
    tripId: reef.id,
    bookingId: entry.booking.id,
    recordedByPersonId: staff.person.id,
    status: "boarded",
    checkpoint: "after_dive_2",
    occurredAt: nowDate(),
  });
  expect(await updateTripSection(db, shop.id, reef.id, { plannedDives: 1 })).toMatchObject({
    ok: false,
    reason: "planned_dives_below_history",
  });
});
