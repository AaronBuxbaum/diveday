import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { trips } from "./schema";
import { nextPublicTripInSeries } from "./series-next";
import { createTripSeries } from "./trips-series";

/**
 * **The next date of the same run** (third UX review, item 16): what the
 * canceled `/ready` page names, so a diver whose Saturday was taken away can
 * reach the next Saturday in one tap.
 */

const ctx = fileScopedShopContext();
const SAT = 6;

async function saturdays(title: string) {
  const { db, shop } = ctx;
  const result = await createTripSeries(db, {
    shopId: shop.id,
    title,
    capacity: 12,
    plannedDives: 2,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SAT]),
    anchorDate: "2030-09-07",
    endsOn: "2030-09-28",
    timeZone: "America/New_York",
    template: {
      startsAt: new Date("2030-09-07T11:00:00.000Z"),
      endsAt: new Date("2030-09-07T15:00:00.000Z"),
    },
  });
  if (!result) throw new Error("series not created");
  return result.trips.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

const BEFORE = new Date("2030-09-01T12:00:00.000Z");

describe("nextPublicTripInSeries", () => {
  it("names the next date of the run, not the one the diver lost", async () => {
    const [first, second] = await saturdays("Saturday Wall");
    if (!first || !second) throw new Error("expected two dates");
    const next = await nextPublicTripInSeries(ctx.db, {
      shopId: ctx.shop.id,
      tripId: first.id,
      now: BEFORE,
    });
    expect(next).toMatchObject({ id: second.id, title: "Saturday Wall" });
  });

  it("skips a called-off date, a private one, and anything already started", async () => {
    const [first, second, third, fourth] = await saturdays("Saturday Reef");
    if (!first || !second || !third || !fourth) throw new Error("expected four dates");
    await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, second.id));
    await ctx.db.update(trips).set({ isPrivate: true }).where(eq(trips.id, third.id));
    expect(
      (await nextPublicTripInSeries(ctx.db, { shopId: ctx.shop.id, tripId: first.id, now: BEFORE }))
        ?.id,
    ).toBe(fourth.id);
    const afterAll = new Date(fourth.startsAt.getTime() + 1);
    expect(
      await nextPublicTripInSeries(ctx.db, {
        shopId: ctx.shop.id,
        tripId: first.id,
        now: afterAll,
      }),
    ).toBeNull();
  });

  it("answers nothing for a one-off, or for another shop", async () => {
    const [first] = await saturdays("Saturday Wreck");
    if (!first) throw new Error("expected a date");
    await ctx.db.update(trips).set({ seriesId: null }).where(eq(trips.id, first.id));
    expect(
      await nextPublicTripInSeries(ctx.db, { shopId: ctx.shop.id, tripId: first.id, now: BEFORE }),
    ).toBeNull();
    const [other] = await saturdays("Saturday Other");
    if (!other) throw new Error("expected a date");
    expect(
      await nextPublicTripInSeries(ctx.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: other.id,
        now: BEFORE,
      }),
    ).toBeNull();
  });
});
