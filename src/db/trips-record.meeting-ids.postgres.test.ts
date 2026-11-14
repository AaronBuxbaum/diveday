import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { shops, trips } from "./schema";
import { createTrip, editTripSection, listTripScheduleDays } from "./trips";

describePostgres("meeting identity edits under contention", () => {
  it("accepts one edit and rejects the other editor's stale ordered window version", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Meeting race", slug: `meeting-race-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const start = new Date(nowDate().getTime() + 14 * 86_400_000);
    const windows = [0, 1].map((index) => ({
      dayNumber: index + 1,
      startsAt: new Date(start.getTime() + index * 86_400_000),
      endsAt: new Date(start.getTime() + index * 86_400_000 + 4 * 3_600_000),
    }));
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Two meetings",
      startsAt: windows[0].startsAt,
      endsAt: windows[1].endsAt,
      capacity: 6,
      scheduleDays: windows,
    });
    if (!trip) throw new Error("trip missing");
    const before = await listTripScheduleDays(pg.db, shop.id, trip.id);
    const [initial] = await pg.db
      .select({ generation: trips.meetingScheduleGeneration })
      .from(trips)
      .where(eq(trips.id, trip.id));
    if (!initial) throw new Error("trip generation missing");
    const expectedScheduleDayIds = before.map((row) => row.id);
    const expectedScheduleVersion = JSON.stringify(
      before.map((row) => [row.id, row.startsAt.toISOString(), row.endsAt.toISOString()]),
    );
    const patch = (minutes: number) => ({
      expectedScheduleDayIds,
      expectedScheduleVersion,
      scheduleDays: before.map((row, index) => ({
        id: row.id,
        dayNumber: row.dayNumber,
        startsAt: row.startsAt,
        endsAt: new Date(row.endsAt.getTime() + (index === 1 ? minutes * 60_000 : 0)),
      })),
      endsAt: new Date(before[1].endsAt.getTime() + minutes * 60_000),
    });
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const first = editTripSection(pg.connect(), shop.id, trip.id, patch(10));
    let second: ReturnType<typeof editTripSection> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      second = editTripSection(pg.connect(), shop.id, trip.id, patch(20));
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    if (!second) throw new Error("second edit did not start");
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "invalid" }]);
    const after = await listTripScheduleDays(pg.db, shop.id, trip.id);
    expect(after.map((row) => row.id)).toEqual(expectedScheduleDayIds);
    expect([10, 20]).toContain((after[1].endsAt.getTime() - before[1].endsAt.getTime()) / 60_000);
    const [updated] = await pg.db
      .select({ generation: trips.meetingScheduleGeneration })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(updated?.generation).toBeGreaterThan(initial.generation);
  });
});
