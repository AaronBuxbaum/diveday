import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  executedDives,
  people,
  personRoles,
  rollCallCrewEvents,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";
import { AT_SEA_DAY_TITLE, bringDemoBoatsAtSeaHome } from "./seed-boat-at-sea";

/**
 * **A doubled cron delivery brings the boat at sea home once** (review 2 of
 * issue 2917). The hourly trip-reminder pass runs `bringDemoBoatsAtSeaHome`,
 * and a cron can deliver twice. Without the boat's row lock both passes read
 * "dive 2 not logged", both write the guide's return mark, and the second
 * dive 2 insert throws on its unique index. PGlite is single-connection, so
 * only a real server can sit two passes inside that window at once.
 */
describePostgres("the demo boat at sea under a doubled pass", () => {
  it("writes her return once when two passes start together", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `At sea race ${suffix}`,
        slug: `at-sea-race-${suffix}`,
        timezone: "UTC",
        isDemo: true,
      })
      .returning();
    if (!shop) throw new Error("shop missing");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: AT_SEA_DAY_TITLE,
        startsAt: new Date(now.getTime() - 6 * 3_600_000),
        endsAt: new Date(now.getTime() - 3_600_000),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    const [captain, guide] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Race Captain" },
        { shopId: shop.id, fullName: "Race Guide" },
      ])
      .returning();
    if (!captain || !guide) throw new Error("crew missing");
    await pg.db.insert(personRoles).values({ personId: captain.id, role: "captain" });
    await pg.db.insert(userAccounts).values({
      personId: captain.id,
      email: `captain@${shop.slug}.demo.invalid`,
      hashedPassword: "unused",
    });
    await pg.db.insert(tripAssignments).values([
      { tripId: trip.id, personId: captain.id, tripRole: "captain" },
      { tripId: trip.id, personId: guide.id },
    ]);
    const mark = (personId: string, checkpoint: string, hoursAgo: number) => ({
      shopId: shop.id,
      tripId: trip.id,
      personId,
      recordedByPersonId: captain.id,
      status: "boarded" as const,
      checkpoint,
      source: "live" as const,
      occurredAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    });
    // The captain is counted back after dive 2; the guide is still down.
    await pg.db
      .insert(rollCallCrewEvents)
      .values([
        mark(captain.id, "after_dive_1", 4),
        mark(guide.id, "after_dive_1", 4),
        mark(captain.id, "after_dive_2", 2),
      ]);

    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const first = bringDemoBoatsAtSeaHome(pg.connect(), now);
    const second = bringDemoBoatsAtSeaHome(pg.connect(), now);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    expect((await first) + (await second)).toBe(1);
    const guideBack = await pg.db
      .select({ id: rollCallCrewEvents.id })
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.personId, guide.id),
          eq(rollCallCrewEvents.checkpoint, "after_dive_2"),
        ),
      );
    expect(guideBack).toHaveLength(1);
    const logged = await pg.db
      .select({ id: executedDives.id })
      .from(executedDives)
      .where(and(eq(executedDives.tripId, trip.id), eq(executedDives.diveNumber, 2)));
    expect(logged).toHaveLength(1);
  });
});
