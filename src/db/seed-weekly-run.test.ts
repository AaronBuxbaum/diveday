import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { tripAssignments, tripSeries, tripSeriesCrew, tripSeriesSkips, trips } from "./schema";
import { DEMO_WEEKLY_RUN_TITLE, surveySaturday } from "./seed-weekly-run";
import { getTripSeriesSummary } from "./trips";

describe("surveySaturday", () => {
  it("hauls Mantis II out in the second week of September for a run that starts in July", () => {
    expect(surveySaturday("2026-07-25")).toBe("2026-09-12");
  });

  it("takes the Saturday nearest that week when the horizon has passed it", () => {
    expect(surveySaturday("2026-10-17")).toBe("2026-10-24");
  });

  it("takes the Saturday nearest that week when the horizon stops short of it", () => {
    expect(surveySaturday("2027-03-06")).toBe("2027-07-03");
  });

  it("never skips the run's first Saturday", () => {
    expect(surveySaturday("2026-09-12")).toBe("2026-09-19");
  });
});

/**
 * **The demo has a weekly boat** (fourth review, item 51): one open-ended
 * Saturday run with a standing crew and a skipped Saturday, so a prospect sees
 * "Repeats weekly on Sat · keeps going" rather than only one-time departures.
 */
describe("the seeded weekly run", () => {
  async function run() {
    const { db, shop } = await seededShopContext({ history: true });
    const [series] = await db
      .select()
      .from(tripSeries)
      .where(and(eq(tripSeries.shopId, shop.id), eq(tripSeries.title, DEMO_WEEKLY_RUN_TITLE)));
    if (!series) throw new Error("the demo has no weekly run");
    return { db, shop, series };
  }

  it("repeats every Saturday and keeps going", async () => {
    const { db, shop, series } = await run();
    expect(series.endsOn).toBeNull();
    const dates = await db
      .select({ id: trips.id, date: trips.seriesOccurrenceDate })
      .from(trips)
      .where(and(eq(trips.seriesId, series.id), isNull(trips.deletedAt)));
    expect(dates.length).toBeGreaterThan(10);
    for (const row of dates) {
      expect(new Date(`${row.date}T12:00:00Z`).getUTCDay()).toBe(6);
    }
    const first = dates[0];
    if (!first) throw new Error("the run has no dates");
    const summary = await getTripSeriesSummary(db, shop.id, first.id);
    expect(summary?.endsOn).toBeNull();
  });

  it("sails with a standing captain and divemaster", async () => {
    const { db, series } = await run();
    const standing = await db
      .select({ role: tripSeriesCrew.tripRole })
      .from(tripSeriesCrew)
      .where(eq(tripSeriesCrew.seriesId, series.id));
    expect(standing.map((row) => row.role).sort()).toEqual(["captain", "divemaster"]);
    const dates = await db
      .select({ id: trips.id, date: trips.seriesOccurrenceDate })
      .from(trips)
      .where(and(eq(trips.seriesId, series.id), isNull(trips.deletedAt)));
    const short: string[] = [];
    for (const date of dates) {
      const crew = await db
        .select({ role: tripAssignments.tripRole })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, date.id));
      if (crew.length < 2) short.push(date.date ?? date.id);
    }
    expect(short).toEqual([]);
  });

  it("names the two sites its dives visit", async () => {
    const { series } = await run();
    expect(series.title).toBe("Saturday Two-Tank — Benwood & Christ of the Abyss");
  });

  it("skips the Saturday Mantis II is hauled out for her annual survey, and the roll keeps it skipped", async () => {
    const { db, series } = await run();
    const skips = await db
      .select({ date: tripSeriesSkips.occurrenceDate })
      .from(tripSeriesSkips)
      .where(eq(tripSeriesSkips.seriesId, series.id));
    // The frozen clock's run starts on 2026-07-25, when the owner skippers
    // the long-range day, so that Saturday makes way too.
    expect(skips.map((row) => row.date).sort()).toEqual(["2026-07-25", "2026-09-12"]);
    const removed = await db
      .select({ date: trips.seriesOccurrenceDate })
      .from(trips)
      .where(and(eq(trips.seriesId, series.id), isNotNull(trips.deletedAt)));
    expect(removed.map((row) => row.date)).toEqual(skips.map((row) => row.date));
  });
});
