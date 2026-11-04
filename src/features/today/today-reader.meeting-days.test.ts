import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import type { AppDb } from "@/db/client";
import { shops, tripScheduleDays, trips } from "@/db/schema";
import { listShopDayDepartures } from "@/db/trips-queries";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { shopClock } from "@/lib/shop-clock";
import { fileScopedShopContext } from "@/test/db";
import {
  getShopDayDepartures,
  getTodayWork,
  todayNextDepartureTripId,
  todaysDepartures,
} from "./today-reader";

/**
 * **A course on two Saturdays is today's departure on both** (#2557). The
 * departure's one `starts_at`..`ends_at` window spans the fortnight between
 * them, so reading it as the boat's day makes the second Saturday not today's
 * and the days between a boat on the water. Today's departure is the one with a
 * meeting day on the shop's date; the days between have none.
 */

const ZONE = "America/New_York";
const ctx = fileScopedShopContext();

// Saturday 2026-08-01 and Saturday 2026-08-15, 09:00 to 13:00 EDT.
const SAT_ONE = { start: "2026-08-01T13:00:00.000Z", end: "2026-08-01T17:00:00.000Z" };
const SAT_TWO = { start: "2026-08-15T13:00:00.000Z", end: "2026-08-15T17:00:00.000Z" };

function clockAt(instant: string) {
  vi.stubEnv("DIVEDAY_CLOCK", instant);
}

beforeEach(() => clockAt("2026-08-01T14:00:00.000Z"));
afterEach(() => vi.unstubAllEnvs());

async function shop(db: AppDb, slug: string) {
  const [row] = await db
    .insert(shops)
    .values({ name: "Key Largo Divers", slug, timezone: ZONE })
    .returning();
  if (!row) throw new Error("shop insert failed");
  return row;
}

/** One departure whose run spans both Saturdays, with a day row on each. */
async function twoSaturdayCourse(db: AppDb, shopId: string, title = "Open Water, two Saturdays") {
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt: new Date(SAT_ONE.start),
      endsAt: new Date(SAT_TWO.end),
      capacity: 6,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(tripScheduleDays).values([
    {
      tripId: trip.id,
      dayNumber: 1,
      startsAt: new Date(SAT_ONE.start),
      endsAt: new Date(SAT_ONE.end),
    },
    {
      tripId: trip.id,
      dayNumber: 2,
      startsAt: new Date(SAT_TWO.start),
      endsAt: new Date(SAT_TWO.end),
    },
  ]);
  return trip;
}

async function todayAt(db: AppDb, shopId: string, instant: string) {
  const at = new Date(instant);
  const clock = shopClock({ timezone: ZONE }, at);
  return {
    ids: (await todaysDepartures(db, shopId, clock)).map((row) => row.id),
    next: await todayNextDepartureTripId(db, shopId, clock),
    sheet: (await listShopDayDepartures(db, shopId, ZONE, at)).map((row) => row.id),
  };
}

describe("a departure that meets on two Saturdays", () => {
  it("is today's departure on the first Saturday", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-first");
    const course = await twoSaturdayCourse(db, s.id);
    expect(nowDate().toISOString()).toBe("2026-08-01T14:00:00.000Z");
    expect(await todayAt(db, s.id, "2026-08-01T14:00:00.000Z")).toEqual({
      ids: [course.id],
      next: course.id,
      sheet: [course.id],
    });
  });

  it("is today's departure on the second Saturday, which trips.starts_at alone cannot say", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-second");
    const course = await twoSaturdayCourse(db, s.id);
    expect(await todayAt(db, s.id, "2026-08-15T14:00:00.000Z")).toEqual({
      ids: [course.id],
      next: course.id,
      sheet: [course.id],
    });
  });

  it("is not today's departure on any day between, or the day after", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-between");
    await twoSaturdayCourse(db, s.id);
    for (const day of [2, 3, 7, 8, 14].map((d) => `2026-08-${String(d).padStart(2, "0")}`)) {
      expect(await todayAt(db, s.id, `${day}T14:00:00.000Z`), day).toEqual({
        ids: [],
        next: null,
        sheet: [],
      });
    }
    expect(await todayAt(db, s.id, "2026-08-16T14:00:00.000Z")).toEqual({
      ids: [],
      next: null,
      sheet: [],
    });
  });

  it("carries the day's own window, so the boat is 'still to come' by that day's hours", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-window");
    await twoSaturdayCourse(db, s.id);
    const [row] = await todaysDepartures(
      db,
      s.id,
      shopClock({ timezone: ZONE }, new Date("2026-08-15T14:00:00.000Z")),
    );
    expect(row?.startsAt.toISOString()).toBe(SAT_TWO.start);
    expect(row?.endsAt.toISOString()).toBe(SAT_TWO.end);
  });

  it("keeps an ordinary departure with no day rows, and never lists one boat twice", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-plain");
    const [plain] = await db
      .insert(trips)
      .values({
        shopId: s.id,
        title: "Plain charter",
        startsAt: new Date("2026-08-15T15:00:00.000Z"),
        endsAt: new Date("2026-08-15T19:00:00.000Z"),
        capacity: 6,
      })
      .returning();
    const course = await twoSaturdayCourse(db, s.id);
    // A second session the same shop day reads as one boat, its first.
    await db.insert(tripScheduleDays).values({
      tripId: course.id,
      dayNumber: 3,
      startsAt: new Date("2026-08-15T20:00:00.000Z"),
      endsAt: new Date("2026-08-15T22:00:00.000Z"),
    });
    const today = await todayAt(db, s.id, "2026-08-15T14:00:00.000Z");
    expect(today.ids).toEqual([course.id, plain?.id]);
    expect(today.sheet).toEqual([course.id, plain?.id]);
  });

  it("draws its card on Today and on the shop-day cards on the second Saturday only", async () => {
    const { db } = ctx;
    const s = await shop(db, "md-cards");
    const course = await twoSaturdayCourse(db, s.id);
    const cardsAt = async (instant: string) => {
      const at = new Date(instant);
      vi.stubEnv("DIVEDAY_CLOCK", instant);
      const evidence = await inHorizonReadiness(db, s.id, at);
      const work = await getTodayWork(
        db,
        s.id,
        s.slug,
        shopClock({ timezone: ZONE }, at),
        undefined,
        staffTranslator("en-US"),
        undefined,
        false,
        evidence,
      );
      const day = await getShopDayDepartures(db, s.id, ZONE, at, evidence);
      return { today: work.departures.map((d) => d.tripId), day: day.map((d) => d.tripId) };
    };
    expect(await cardsAt("2026-08-15T14:00:00.000Z")).toEqual({
      today: [course.id],
      day: [course.id],
    });
    expect(await cardsAt("2026-08-08T14:00:00.000Z")).toEqual({ today: [], day: [] });
  });
});
