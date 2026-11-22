import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { courses, trips } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { readFirstBoatAfterwards } from "./first-boat-afterwards";

const ctx = fileScopedShopContext();

async function session(title: string) {
  const [row] = await ctx.db
    .select({ trip: trips, course: courses })
    .from(trips)
    .innerJoin(courses, eq(courses.id, trips.courseId))
    .where(eq(trips.title, title))
    .limit(1);
  if (!row) throw new Error(`no seeded session ${title}`);
  return { endsAt: row.trip.endsAt, course: row.course };
}

describe("a good first boat afterwards", () => {
  it("names a later, non-course departure with seats left after the demo refresher", async () => {
    const refresher = await session("Scuba Refresher — half day");
    const pick = await readFirstBoatAfterwards(ctx.db, {
      shopId: ctx.shop.id,
      now: nowDate(),
      session: refresher,
    });
    expect(pick).not.toBeNull();
    expect(pick?.startsAt.getTime()).toBeGreaterThan(refresher.endsAt.getTime());
    expect(pick?.seatsOpen).toBeGreaterThan(0);
    const [row] = await ctx.db
      .select()
      .from(trips)
      .where(eq(trips.id, pick?.tripId ?? ""));
    expect(row?.courseId).toBeNull();
    expect(row?.shopId).toBe(ctx.shop.id);
  });

  it("says nothing for a session that is not a refresher", async () => {
    const dsd = await session("Discover Scuba Diving — afternoon");
    expect(
      await readFirstBoatAfterwards(ctx.db, { shopId: ctx.shop.id, now: nowDate(), session: dsd }),
    ).toBeNull();
  });

  it("says nothing once the session has ended", async () => {
    const refresher = await session("Scuba Refresher — half day");
    expect(
      await readFirstBoatAfterwards(ctx.db, {
        shopId: ctx.shop.id,
        now: new Date(refresher.endsAt.getTime() + 1000),
        session: refresher,
      }),
    ).toBeNull();
  });
});
