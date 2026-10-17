import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { people, shops, tripAssignments, tripDives, tripScheduleDays, trips } from "./schema";
import { copyWeekFromYearBefore, departuresWeekBefore } from "./trips";

/**
 * **Last year's week, copied onto an empty one** (fifth loop, item 30), over
 * an unseeded database so every departure is the test's own.
 */

const TZ = "America/New_York";
// Monday, March 9, 2026 (EDT from the 8th); 52 weeks before is Monday,
// March 10, 2025 (EDT from the 9th). The copy keeps the wall-clock hour.
const WEEK = "2026-03-09";
const BEFORE_EVERYTHING = new Date("2026-01-01T00:00:00Z");

async function shopRow(db: AppDb, slug: string): Promise<string> {
  const [row] = await db.insert(shops).values({ name: slug, slug, timezone: TZ }).returning();
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

async function trip(
  db: AppDb,
  shopId: string,
  startsAt: string,
  values: Partial<typeof trips.$inferInsert> = {},
): Promise<string> {
  const start = new Date(startsAt);
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Trip",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      capacity: 10,
      ...values,
    })
    .returning();
  if (!row) throw new Error("trip insert failed");
  // Every departure meets at least once and plans a dive, as the builder writes it.
  await db.insert(tripDives).values({ tripId: row.id, diveNumber: 1 });
  await db
    .insert(tripScheduleDays)
    .values({ tripId: row.id, dayNumber: 1, startsAt: row.startsAt, endsAt: row.endsAt });
  return row.id;
}

async function liveTripsFrom(db: AppDb, shopId: string, from: Date) {
  const rows = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), isNull(trips.deletedAt)));
  return rows
    .filter((row) => row.startsAt >= from)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

describe("copyWeekFromYearBefore", () => {
  it("puts last year's departures back up 52 weeks on, at their own hour, without crew", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "copy-week");
    // Tuesday 8:00 AM EDT and Saturday 1:00 PM EDT, a year before.
    const tuesday = await trip(db, shopId, "2025-03-11T12:00:00Z", { title: "Wreck" });
    await trip(db, shopId, "2025-03-15T17:00:00Z", { title: "Reef" });
    // Neither a rehearsal nor a canceled boat comes back.
    await trip(db, shopId, "2025-03-12T12:00:00Z", {
      title: "Drill",
      isRehearsal: true,
      isPrivate: true,
    });
    await trip(db, shopId, "2025-03-13T12:00:00Z", { title: "Off", status: "cancelled" });
    // Nor the week after's boat.
    await trip(db, shopId, "2025-03-17T12:00:00Z", { title: "Next week" });
    const [captain] = await db
      .insert(people)
      .values({ shopId, fullName: "Sal Captain" })
      .returning();
    if (!captain) throw new Error("person insert failed");
    await db.insert(tripAssignments).values({ tripId: tuesday, personId: captain.id });

    expect(await departuresWeekBefore(db, shopId, WEEK, TZ)).toHaveLength(2);
    const outcome = await copyWeekFromYearBefore(db, shopId, WEEK, TZ, BEFORE_EVERYTHING);
    expect(outcome.ok && outcome.tripIds.length).toBe(2);

    const copies = await liveTripsFrom(db, shopId, new Date("2026-03-09T00:00:00Z"));
    expect(copies.map((row) => [row.title, row.startsAt.toISOString()])).toEqual([
      ["Wreck", "2026-03-10T12:00:00.000Z"],
      ["Reef", "2026-03-14T17:00:00.000Z"],
    ]);
    const crew = await db
      .select()
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, copies[0]?.id ?? ""));
    expect(crew).toEqual([]);
  });

  it("refuses a week that already has a departure, so a second tap copies nothing", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "copy-week-twice");
    await trip(db, shopId, "2025-03-11T12:00:00Z");
    expect((await copyWeekFromYearBefore(db, shopId, WEEK, TZ, BEFORE_EVERYTHING)).ok).toBe(true);
    expect(await copyWeekFromYearBefore(db, shopId, WEEK, TZ, BEFORE_EVERYTHING)).toEqual({
      ok: false,
      reason: "week_not_empty",
    });
    expect(await liveTripsFrom(db, shopId, new Date("2026-03-09T00:00:00Z"))).toHaveLength(1);
  });

  it("skips a copy that would already have left, and says so when that is all of them", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "copy-week-late");
    await trip(db, shopId, "2025-03-11T12:00:00Z");
    const afterTuesday = new Date("2026-03-11T00:00:00Z");
    expect(await copyWeekFromYearBefore(db, shopId, WEEK, TZ, afterTuesday)).toEqual({
      ok: false,
      reason: "nothing_to_copy",
    });
  });

  it("never reads another shop's year", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "copy-week-owner");
    const other = await shopRow(db, "copy-week-other");
    await trip(db, other, "2025-03-11T12:00:00Z");
    expect(await copyWeekFromYearBefore(db, shopId, WEEK, TZ, BEFORE_EVERYTHING)).toEqual({
      ok: false,
      reason: "nothing_to_copy",
    });
  });
});
