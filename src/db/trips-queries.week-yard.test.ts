import { describe, expect, it } from "vitest";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "../features/boats/store";
import { createTrip, weekBoard } from "./trips";

/**
 * **The week board knows every day each departure holds its hull** (issue
 * #4025), so its yard warning can be asked of every column, not only the one a
 * one-day departure leaves on. Week of Monday 2031-01-06, an empty week in the
 * seeded shop.
 */
const ctx = fileScopedShopContext();
const WEEK = "2031-01-06";

describe("weekBoard's held hulls", () => {
  async function departure(
    boatId: string | null,
    from: [number, number],
    to: [number, number],
    extra: { diveMode?: "boat" | "shore"; scheduleDays?: [number, number, number][] } = {},
  ) {
    const { db, shop } = ctx;
    const at = (day: number, hour: number) =>
      wallTimeToUtc({ year: 2031, month: 1, day, hour, minute: 0 }, shop.timezone);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Held",
      startsAt: at(...from),
      endsAt: at(...to),
      capacity: 8,
      diveMode: extra.diveMode ?? "boat",
      boatId,
      scheduleDays: extra.scheduleDays?.map(([day, start, end], index) => ({
        dayNumber: index + 1,
        startsAt: at(day, start),
        endsAt: at(day, end),
      })),
    });
    if (!trip) throw new Error("departure missing");
    return trip;
  }

  it("names each hull with the days it is held: a liveaboard, a course, a night dive, last week's late boat", async () => {
    const { db, shop } = ctx;
    const hull = await createBoat(db, shop.id, "Hull A", 12);
    await departure(hull.id, [10, 8], [12, 17]);
    await departure(hull.id, [6, 8], [8, 16], {
      scheduleDays: [
        [6, 8, 16],
        [8, 8, 16],
      ],
    });
    await departure(hull.id, [11, 20], [12, 2]);
    // Sunday night before the week, back at 02:00 Monday.
    await departure(hull.id, [5, 22], [6, 2]);
    await departure(null, [9, 8], [9, 12], { diveMode: "shore" });

    const week = await weekBoard(db, shop.id, WEEK, shop.timezone);
    const spans = week.held
      .filter((hold) => hold.boatId === hull.id)
      .map((hold) => hold.spans)
      .sort((a, b) => (a[0]?.from ?? "").localeCompare(b[0]?.from ?? ""));
    expect(spans).toEqual([
      [{ from: "2031-01-05", until: "2031-01-06" }],
      [
        { from: "2031-01-06", until: "2031-01-06" },
        { from: "2031-01-08", until: "2031-01-08" },
      ],
      [{ from: "2031-01-10", until: "2031-01-12" }],
      [{ from: "2031-01-11", until: "2031-01-12" }],
    ]);
    // A shore session holds no hull.
    expect(week.held.every((hold) => hold.boatId === hull.id)).toBe(true);
  });
});
