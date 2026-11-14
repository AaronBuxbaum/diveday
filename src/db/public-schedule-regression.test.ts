import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { trips } from "./schema";
import { createTrip, pagedUpcomingTripsWithCounts, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

it("refuses a public booking at the departure time", async () => {
  const { db, shop } = ctx;
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (trip) => trip.booked < trip.sellableCapacity,
  );
  if (!open) throw new Error("expected an open departure");
  await db.update(trips).set({ startsAt: nowDate() }).where(eq(trips.id, open.id));
  expect(
    await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Late Diver",
      email: "late@example.com",
    }),
  ).toEqual({ ok: false, reason: "trip_unavailable" });
});

it("includes the shop-local day and filters capacity before paging", async () => {
  const { db, shop } = ctx;
  const now = new Date("2030-08-15T18:00:00Z");
  const bounds = shopDayBounds(now, "America/New_York");
  const past = await createTrip(db, {
    shopId: shop.id,
    title: "Today",
    startsAt: new Date("2030-08-15T12:00:00Z"),
    endsAt: new Date("2030-08-15T16:00:00Z"),
    capacity: 4,
  });
  const small = await createTrip(db, {
    shopId: shop.id,
    title: "Small",
    startsAt: new Date("2030-08-15T13:00:00Z"),
    endsAt: new Date("2030-08-15T17:00:00Z"),
    capacity: 2,
  });
  const yesterday = await createTrip(db, {
    shopId: shop.id,
    title: "Yesterday",
    startsAt: new Date("2030-08-15T03:00:00Z"),
    endsAt: new Date("2030-08-15T04:00:00Z"),
    capacity: 4,
  });
  if (!past || !small || !yesterday) throw new Error("trip creation failed");
  const page = await pagedUpcomingTripsWithCounts(db, shop.id, {
    now,
    from: bounds.from,
    monthEnd: bounds.to,
    minSeats: 4,
  });
  expect(page.trips.map((trip) => trip.id)).toContain(past.id);
  expect(page.trips.map((trip) => trip.id)).not.toContain(small.id);
  expect(page.trips.map((trip) => trip.id)).not.toContain(yesterday.id);
});

it("filters diver-only trips by their remaining diver seats while retaining mixed trips", async () => {
  const { db, shop } = ctx;
  const startsAt = new Date("2030-09-15T12:00:00Z");
  const endsAt = new Date("2030-09-15T16:00:00Z");
  const only = await createTrip(db, {
    shopId: shop.id,
    title: "Divers only",
    startsAt,
    endsAt,
    capacity: 10,
  });
  const mixed = await createTrip(db, {
    shopId: shop.id,
    title: "Mixed",
    startsAt,
    endsAt,
    capacity: 10,
  });
  if (!only || !mixed) throw new Error("trip creation failed");
  await db.update(trips).set({ diverCapacity: 1 }).where(eq(trips.id, only.id));
  await db
    .update(trips)
    .set({ diverCapacity: 1, snorkelerPriceCents: 0 })
    .where(eq(trips.id, mixed.id));
  for (const trip of [only, mixed]) {
    const result = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: `Diver ${trip.id}`,
      email: `${trip.id}@example.com`,
    });
    expect(result.ok).toBe(true);
  }
  const page = await pagedUpcomingTripsWithCounts(db, shop.id, {
    now: new Date("2030-09-15T00:00:00Z"),
    monthEnd: new Date("2030-09-16T00:00:00Z"),
    minSeats: 1,
  });
  expect(page.trips.map((trip) => trip.id)).not.toContain(only.id);
  expect(page.trips.map((trip) => trip.id)).toContain(mixed.id);
});
