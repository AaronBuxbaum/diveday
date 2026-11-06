import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { wallTimeToUtc } from "@/lib/zoned";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBoat } from "./boats";
import { boats, shops, trips } from "./schema";
import { createTrip, createTripOrRefusal, editTripSection } from "./trips";

/**
 * **The builder's add and the details save read the yard window under a lock**
 * (issue #4009), as the roll, a series, a move and a copy already do. Each
 * decides from the boat's window and then writes, so a window saved in that
 * gap would leave a departure in a yard week. With the share lock, a save
 * still open when the write starts holds it at the read; it then sees the
 * saved window and refuses. The assertion is the outcome, not the wait:
 * without the lock the write reads the old, empty window straight through.
 */
const TZ = "America/New_York";
const at = (day: number, hour = 8) =>
  wallTimeToUtc({ year: 2031, month: 1, day, hour, minute: 0 }, TZ);

async function shopWithHulls(pg: Awaited<ReturnType<typeof postgresTestDb>>) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: `Yard write ${suffix}`, slug: `yard-write-${suffix}`, timezone: TZ })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  return {
    shop,
    hullA: await createBoat(pg.db, shop.id, "Hull A", 12),
    hullB: await createBoat(pg.db, shop.id, "Hull B", 12),
  };
}

/** Saves a yard window on `boatId` and holds the transaction open until `release`. */
function openWindowSave(pg: Awaited<ReturnType<typeof postgresTestDb>>, boatId: string) {
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved!: () => void;
  const written = new Promise<void>((resolve) => {
    saved = resolve;
  });
  const save = pg.connect().transaction(async (tx) => {
    await tx
      .update(boats)
      .set({ outOfServiceFrom: "2031-01-08", outOfServiceUntil: "2031-01-08" })
      .where(eq(boats.id, boatId));
    saved();
    await open;
  });
  return { written, release, save };
}

describePostgres("the yard window read by a single write", () => {
  it("holds the builder's add at the read, then refuses it for the saved yard day", async () => {
    const pg = await postgresTestDb();
    const { shop, hullA } = await shopWithHulls(pg);
    const window = openWindowSave(pg, hullA.id);
    let add: ReturnType<typeof createTripOrRefusal> | undefined;
    try {
      await window.written;
      add = createTripOrRefusal(pg.connect(), {
        shopId: shop.id,
        title: "Wednesday boat",
        startsAt: at(8),
        endsAt: at(8, 12),
        capacity: 10,
        diveMode: "boat",
        boatId: hullA.id,
      });
      await waitForLockWaiters(pg.db, 1);
    } finally {
      window.release();
      await window.save;
    }
    expect(await add).toEqual({ refusal: "boat_out_of_service", firstDay: "2031-01-08" });
    expect(await pg.db.select().from(trips).where(eq(trips.shopId, shop.id))).toEqual([]);
  });

  it("holds a details save's hull swap at the read, then refuses it for the saved yard day", async () => {
    const pg = await postgresTestDb();
    const { shop, hullA, hullB } = await shopWithHulls(pg);
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Wednesday boat",
      startsAt: at(8),
      endsAt: at(8, 12),
      capacity: 10,
      diveMode: "boat",
      boatId: hullA.id,
    });
    if (!trip) throw new Error("trip missing");
    const window = openWindowSave(pg, hullB.id);
    let swap: ReturnType<typeof editTripSection> | undefined;
    try {
      await window.written;
      swap = editTripSection(pg.connect(), shop.id, trip.id, {
        diveMode: "boat",
        boatId: hullB.id,
      });
      await waitForLockWaiters(pg.db, 1);
    } finally {
      window.release();
      await window.save;
    }
    expect(await swap).toEqual({ ok: false, reason: "boat_out_of_service", on: "2031-01-08" });
    const [kept] = await pg.db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(kept?.boatId).toBe(hullA.id);
  });
});
