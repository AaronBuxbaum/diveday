import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { trips } from "./schema";
import { createTrip, editTrip, getTripWithBooked, listTripScheduleDays } from "./trips";

const ctx = fileScopedShopContext();

it("rebuilds a trip's meeting days when its schedule is edited, and never leaves stale ones", async () => {
  // The details editor sends one day's window plus a day count, so a
  // departure can grow, shrink, or slide here rather than being deleted and
  // rebuilt as unrelated trips. A day row left pointing at the old dates is
  // what the manifest, the crew double-booking check, and the trip page's
  // meeting-day list would all go on reading.
  const { db, shop } = ctx;
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Open Water weekend",
    startsAt: new Date("2030-09-05T12:00:00Z"),
    endsAt: new Date("2030-09-05T16:00:00Z"),
    capacity: 6,
  });
  if (!trip) throw new Error("trip not created");
  const generation = async () =>
    (
      await db
        .select({ value: trips.meetingScheduleGeneration })
        .from(trips)
        .where(eq(trips.id, trip.id))
    )[0]?.value;
  const initialGeneration = await generation();
  if (initialGeneration === undefined) throw new Error("generation missing");
  expect(trip.meetingScheduleGeneration).toBe(initialGeneration);
  // A trip created without days still gets exactly one, from its own window.
  const initialDays = await listTripScheduleDays(db, shop.id, trip.id);
  expect(initialDays).toHaveLength(1);
  const version = (rows: typeof initialDays) =>
    JSON.stringify(
      rows.map((row) => [row.id, row.startsAt.toISOString(), row.endsAt.toISOString()]),
    );
  const unchanged = await editTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    scheduleDays: initialDays,
    expectedScheduleDayIds: initialDays.map((day) => day.id),
    expectedScheduleVersion: version(initialDays),
  });
  expect(unchanged).toMatchObject({ ok: true });
  expect(await generation()).toBe(initialGeneration);

  const meetingDay = (offset: number) => ({
    dayNumber: offset + 1,
    startsAt: new Date(Date.UTC(2030, 8, 5 + offset, 12)),
    endsAt: new Date(Date.UTC(2030, 8, 5 + offset, 16)),
  });
  const dayOne = meetingDay(0);
  const grown = await editTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: dayOne.startsAt,
    endsAt: meetingDay(2).endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    scheduleDays: [0, 1, 2].map((index) => ({
      ...meetingDay(index),
      ...(index === 0 ? { id: initialDays[0].id } : {}),
    })),
    expectedScheduleDayIds: initialDays.map((row) => row.id),
    expectedScheduleVersion: version(initialDays),
  });
  expect(grown.ok).toBe(true);
  const grownGeneration = await generation();
  if (grownGeneration === undefined) throw new Error("generation missing");
  expect(grownGeneration).toBeGreaterThan(initialGeneration);
  expect(
    (await listTripScheduleDays(db, shop.id, trip.id)).map((day) => [
      day.dayNumber,
      day.startsAt.toISOString(),
    ]),
  ).toEqual([
    [1, "2030-09-05T12:00:00.000Z"],
    [2, "2030-09-06T12:00:00.000Z"],
    [3, "2030-09-07T12:00:00.000Z"],
  ]);
  // The trip itself spans first departure to last return, so every
  // "is it over?" question sees the whole departure.
  expect((await getTripWithBooked(db, shop.id, trip.id))?.endsAt).toEqual(
    new Date("2030-09-07T16:00:00.000Z"),
  );

  // Shrinking replaces rather than merges: days 2 and 3 are gone, not orphaned.
  const grownDays = await listTripScheduleDays(db, shop.id, trip.id);
  const shrunk = await editTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: dayOne.startsAt,
    endsAt: dayOne.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    scheduleDays: [{ ...dayOne, id: grownDays[0].id }],
    expectedScheduleDayIds: grownDays.map((row) => row.id),
    expectedScheduleVersion: version(grownDays),
  });
  expect(shrunk.ok).toBe(true);
  const shrunkGeneration = await generation();
  if (shrunkGeneration === undefined) throw new Error("generation missing");
  expect(shrunkGeneration).toBeGreaterThan(grownGeneration);
  expect(await listTripScheduleDays(db, shop.id, trip.id)).toHaveLength(1);

  // Omitting the field leaves the existing days entirely alone — every
  // caller that only edits a price must not silently rewrite a schedule.
  await editTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: dayOne.startsAt,
    endsAt: dayOne.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    priceCents: 12_000,
  });
  expect(await listTripScheduleDays(db, shop.id, trip.id)).toHaveLength(1);
  expect(await generation()).toBe(shrunkGeneration);
});
