import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { boats, trips } from "./schema";
import { freeHull } from "./seed-hulls";

const ctx = fileScopedShopContext();

/** A morning far past anything the seed writes, so only this file's departures are out in it. */
function aMorning(daysAhead: number) {
  const startsAt = new Date(nowDate().getTime() + daysAhead * DAY_MS);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS) };
}

async function fleetByName() {
  const fleet = await ctx.db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(eq(boats.shopId, ctx.shop.id));
  const sorted = fleet.sort((a, b) => (a.name < b.name ? -1 : 1)).map((boat) => boat.id);
  if (sorted.length < 2) throw new Error("the seeded shop needs two boats");
  return sorted;
}

async function outOn(
  boatId: string,
  window: { startsAt: Date; endsAt: Date },
  extra: Partial<typeof trips.$inferInsert> = {},
) {
  await ctx.db.insert(trips).values({
    shopId: ctx.shop.id,
    title: "Already out",
    ...window,
    capacity: 6,
    boatId,
    ...extra,
  });
}

describe("freeHull", () => {
  it("takes the first hull by name when nothing is out", async () => {
    const [first] = await fleetByName();
    expect(await freeHull(ctx.db, ctx.shop.id, aMorning(900))).toBe(first);
  });

  it("passes over a hull another departure has out in those hours", async () => {
    const [first, second] = await fleetByName();
    const window = aMorning(901);
    await outOn(first as string, window);
    expect(await freeHull(ctx.db, ctx.shop.id, window)).toBe(second);
  });

  it("does not count a cancelled or deleted departure as having the hull out", async () => {
    const [first] = await fleetByName();
    const window = aMorning(902);
    await outOn(first as string, window, { status: "cancelled", cancelledAt: nowDate() });
    await outOn(first as string, window, { deletedAt: nowDate() });
    expect(await freeHull(ctx.db, ctx.shop.id, window)).toBe(first);
  });

  it("lets a hull back-to-back with another departure go out", async () => {
    const [first] = await fleetByName();
    const window = aMorning(903);
    await outOn(first as string, {
      startsAt: new Date(window.startsAt.getTime() - 4 * HOUR_MS),
      endsAt: window.startsAt,
    });
    expect(await freeHull(ctx.db, ctx.shop.id, window)).toBe(first);
  });

  it("answers none when every hull is out, rather than doubling one up", async () => {
    const fleet = await fleetByName();
    const window = aMorning(904);
    for (const boatId of fleet) await outOn(boatId, window);
    expect(await freeHull(ctx.db, ctx.shop.id, window)).toBeNull();
  });

  it("never offers a deleted boat", async () => {
    const [first, second] = await fleetByName();
    await ctx.db
      .update(boats)
      .set({ deletedAt: nowDate() })
      .where(eq(boats.id, first as string));
    try {
      expect(await freeHull(ctx.db, ctx.shop.id, aMorning(905))).toBe(second);
    } finally {
      await ctx.db
        .update(boats)
        .set({ deletedAt: null })
        .where(eq(boats.id, first as string));
    }
  });
});
