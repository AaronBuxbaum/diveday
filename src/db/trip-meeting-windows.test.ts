import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { tripScheduleDays } from "./schema";
import { meetingWindowsByTrip } from "./trip-meeting-windows";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();

async function runOf(title: string, nights: number) {
  const { db, shop } = ctx;
  const startsAt = new Date(nowDate().getTime() + 3 * DAY_MS);
  const endsAt = new Date(startsAt.getTime() + (nights - 1) * DAY_MS + 4 * HOUR_MS);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    startsAt,
    endsAt,
    capacity: 8,
    plannedDives: 1,
  });
  if (!trip) throw new Error(`createTrip refused ${title}`);
  return trip;
}

describe("meetingWindowsByTrip", () => {
  it("reads the windows of a multi-day run and none for a single sailing", async () => {
    const { db } = ctx;
    const run = await runOf("Three-night run", 3);
    const single = await runOf("One sailing", 1);
    // `createTrip` files day one's window; add the other two nights.
    for (const day of [1, 2]) {
      await db.insert(tripScheduleDays).values({
        tripId: run.id,
        dayNumber: day + 1,
        startsAt: new Date(run.startsAt.getTime() + day * DAY_MS),
        endsAt: new Date(run.startsAt.getTime() + day * DAY_MS + 4 * HOUR_MS),
      });
    }

    const windows = await meetingWindowsByTrip(db, [run, single]);

    expect(windows.get(run.id)).toHaveLength(3);
    expect(windows.has(single.id)).toBe(false);
  });

  it("is absent for a multi-day run with no windows on file, and asks nothing for no trips", async () => {
    const { db } = ctx;
    const bare = await runOf("Run with no windows", 2);
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, bare.id));
    expect((await meetingWindowsByTrip(db, [bare])).size).toBe(0);
    expect((await meetingWindowsByTrip(db, [])).size).toBe(0);
  });
});
