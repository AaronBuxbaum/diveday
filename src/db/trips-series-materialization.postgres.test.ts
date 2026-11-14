import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { EVERY_WEEKDAY } from "@/lib/recurrence";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { shops, trips } from "./schema";
import { createTripSeries, deleteTrip, rollSeriesForward } from "./trips";
import { liveTrip } from "./trips-live";

describePostgres("new series materialization", () => {
  it("returns persisted meeting identities and does not recreate a deleted slot on a later roll", async () => {
    const { db } = await postgresTestDb();
    const [shop] = await db
      .insert(shops)
      .values({
        name: "Series",
        slug: `series-${crypto.randomUUID()}`,
        timezone: "UTC",
      })
      .returning();
    const input = {
      shopId: shop.id,
      title: "Daily",
      capacity: 8,
      plannedDives: 1,
      frequency: "weekly" as const,
      intervalWeeks: 1,
      weekdays: EVERY_WEEKDAY,
      anchorDate: "2030-09-07",
      endsOn: "2031-01-04",
      timeZone: "UTC",
      template: {
        startsAt: new Date("2030-09-07T09:00:00Z"),
        endsAt: new Date("2030-09-07T12:00:00Z"),
      },
    };
    const result = await createTripSeries(db, input);
    if (!result) throw new Error("series not created");
    expect(result.trips).toHaveLength(120);
    const persisted = await db
      .select({ id: trips.id, generation: trips.meetingScheduleGeneration })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          liveTrip(),
          inArray(
            trips.id,
            result.trips.map((trip) => trip.id),
          ),
        ),
      );
    const generations = new Map(persisted.map((trip) => [trip.id, trip.generation]));
    expect(generations.size).toBe(120);
    for (const trip of result.trips)
      expect(trip.meetingScheduleGeneration).toBe(generations.get(trip.id));
    const deleted = result.trips[1];
    expect(await deleteTrip(db, shop.id, deleted.id)).toEqual({ ok: true });
    expect(
      (await rollSeriesForward(db, shop.id, result.series.id, new Date("2030-09-07T12:00:00Z")))
        ?.created,
    ).toBe(0);

    const single = await createTripSeries(db, { ...input, endsOn: input.anchorDate });
    if (!single) throw new Error("single series not created");
    expect(single.trips).toHaveLength(1);
    const [saved] = await db
      .select({ generation: trips.meetingScheduleGeneration })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), liveTrip(), eq(trips.id, single.trips[0].id)));
    expect(single.trips[0].meetingScheduleGeneration).toBe(saved.generation);
  });
});
