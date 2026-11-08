import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBoat } from "../features/boats/store";
import { boats, shops, trips } from "./schema";
import { createTripSeriesOrRefusal, isSeriesBoatOutOfService, rollSeriesForward } from "./trips";

/**
 * **The nightly roll reads the yard window under a lock** (issue #3988). The
 * roll decides which weeks to put on a hull from the boat's window and then
 * writes them, so a window saved in that gap would leave a departure in a yard
 * week. With the share lock, a save still open when the roll starts holds the
 * roll at the read; the roll then sees the saved window and leaves the weeks
 * off. The assertion is the outcome, not the wait: without the lock the roll
 * reads the old, empty window straight through the open save.
 */
const TZ = "America/New_York";
const at = (year: number, month: number, day: number, hour = 8) =>
  wallTimeToUtc({ year, month, day, hour, minute: 0 }, TZ);

describePostgres("the yard window read in the nightly roll", () => {
  it("waits for a window save already open, then leaves the saved yard weeks off", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Yard lock ${suffix}`, slug: `yard-lock-${suffix}`, timezone: TZ })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const boat = await createBoat(pg.db, shop.id, "Hull Y", 12);
    const made = await createTripSeriesOrRefusal(pg.db, {
      shopId: shop.id,
      title: "Wednesday boat",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly" as const,
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([3]),
      anchorDate: "2030-08-07",
      endsOn: null,
      timeZone: TZ,
      boatId: boat.id,
      template: { startsAt: at(2030, 8, 7), endsAt: at(2030, 8, 7, 12) },
    });
    if (!made || isSeriesBoatOutOfService(made)) throw new Error("series refused");

    let save!: Promise<unknown>;
    let release!: () => void;
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saved!: () => void;
    const windowWritten = new Promise<void>((resolve) => {
      saved = resolve;
    });
    save = pg.connect().transaction(async (tx) => {
      await tx
        .update(boats)
        .set({ outOfServiceFrom: "2031-01-08", outOfServiceUntil: "2031-01-14" })
        .where(eq(boats.id, boat.id));
      saved();
      await open;
    });
    let roll: ReturnType<typeof rollSeriesForward> | undefined;
    try {
      await windowWritten;
      roll = rollSeriesForward(pg.connect(), shop.id, made.series.id, at(2030, 12, 4, 3));
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await save;
    }
    const result = await roll;
    expect(result?.inTheYard).toEqual(["2031-01-08"]);
    const [inYard] = await pg.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.seriesId, made.series.id), eq(trips.startsAt, at(2031, 1, 8))));
    expect(inYard).toBeUndefined();
  });
});
