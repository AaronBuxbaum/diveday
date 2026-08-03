import { describe, expect, it } from "vitest";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { createTrip, duplicateTrip, listTripScheduleDays, moveTrip } from "./trips";

describe("moveTrip / duplicateTrip across a DST transition", () => {
  // The seeded blue-mantis shop is America/New_York. Spring-forward in 2026
  // is Sunday March 8 (2am -> 3am). This 3-day course's own days straddle the
  // transition: day 1 (Mar 6) and day 2 (Mar 7) fall before it, EST (UTC-4);
  // day 3 (Mar 8, 07:30 — after the 2am jump) falls after it, EDT (UTC-4).
  // Moved to Mar 13-15 (all EDT, no further transition in between), a naive
  // fixed-millisecond delta computed from the *start's* own EST->EDT crossing
  // over-corrects day 3 (which needed no crossing at all, having already been
  // EDT) and the trip's endsAt by an extra hour. Preserving wall-clock time
  // per calendar day, independent of which offset each day happened to start
  // in, is what this guards.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 30) =>
    wallTimeToUtc({ year: 2026, month: 3, day, hour, minute }, tz);

  function buildThreeDayCourse(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
  ) {
    return createTrip(db, {
      shopId,
      title: "DST regression — three-day course",
      startsAt: wall(6, 7),
      endsAt: wall(8, 16, 0),
      capacity: 4,
      scheduleDays: [
        { dayNumber: 1, startsAt: wall(6, 7), endsAt: wall(6, 16, 0) },
        { dayNumber: 2, startsAt: wall(7, 7), endsAt: wall(7, 16, 0) },
        { dayNumber: 3, startsAt: wall(8, 7), endsAt: wall(8, 16, 0) },
      ],
    });
  }

  it("moveTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(13, 7));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, source.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
  });

  it("duplicateTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(13, 7));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, copy.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
    // The source trip's own days must be untouched by the duplicate.
    const sourceDays = await listTripScheduleDays(db, shop.id, source.id);
    const sourceByDay = Object.fromEntries(sourceDays.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(sourceByDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
      hour: 7,
      minute: 30,
    });
  });
});

describe("moveTrip / duplicateTrip when the start's clock time also changes", () => {
  // A move isn't always "same time, new day" — the schedule builder lets
  // staff pick a new date *and* a new departure time in one step. endsAt (and
  // any other schedule day) must carry that time-of-day change too, or the
  // trip's duration silently changes: a departure created 09:00-13:00 (4h)
  // and moved to 07:15 must land at 07:15-11:15, not stay stuck at 13:00.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 0) =>
    wallTimeToUtc({ year: 2026, month: 6, day, hour, minute }, tz);

  it("moveTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(12, 7, 15));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });

  it("duplicateTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(12, 7, 15));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });
});
