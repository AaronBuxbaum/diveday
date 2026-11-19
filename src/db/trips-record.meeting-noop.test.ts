import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { tripScheduleDays } from "./schema";
import { createTrip, editTripSection, listTripScheduleDays } from "./trips";

const ctx = fileScopedShopContext();

it("keeps meeting rows on an identical explicit save and replaces them on an edit", async () => {
  const { db, shop } = ctx;
  const days = [0, 1].map((offset) => ({
    dayNumber: offset + 1,
    startsAt: new Date(Date.UTC(2035, 3, 10 + offset, 12)),
    endsAt: new Date(Date.UTC(2035, 3, 10 + offset, 16)),
  }));
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Two-day course",
    startsAt: days[0].startsAt,
    endsAt: days[1].endsAt,
    capacity: 8,
    scheduleDays: days,
  });
  if (!trip) throw new Error("trip missing");
  const before = await listTripScheduleDays(db, shop.id, trip.id);

  const same = days.map((day) => ({
    ...day,
    startsAt: new Date(day.startsAt.toISOString()),
    endsAt: new Date(day.endsAt.toISOString()),
  }));
  expect(await editTripSection(db, shop.id, trip.id, { scheduleDays: same })).toMatchObject({
    ok: true,
  });
  const unchanged = await listTripScheduleDays(db, shop.id, trip.id);
  expect(unchanged).toEqual(before);

  const changed = [days[0], { ...days[1], startsAt: new Date("2035-04-11T13:00:00Z") }];
  expect(await editTripSection(db, shop.id, trip.id, { scheduleDays: changed })).toMatchObject({
    ok: true,
  });
  const edited = await listTripScheduleDays(db, shop.id, trip.id);
  expect(edited.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual(
    changed.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  );
  expect(edited.map((day) => day.id)).not.toEqual(before.map((day) => day.id));
});

it("does not silently accept an empty schedule when no rows exist", async () => {
  const { db, shop } = ctx;
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Empty day guard",
    startsAt: new Date("2035-04-12T12:00:00Z"),
    endsAt: new Date("2035-04-12T16:00:00Z"),
    capacity: 8,
  });
  if (!trip) throw new Error("trip missing");
  await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
  await expect(editTripSection(db, shop.id, trip.id, { scheduleDays: [] })).rejects.toThrow();
  expect(await listTripScheduleDays(db, shop.id, trip.id)).toEqual([]);
});
