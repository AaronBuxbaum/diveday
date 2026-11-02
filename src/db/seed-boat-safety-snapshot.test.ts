import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { departureBoatSafetySnapshot } from "./boat-safety";
import { departureBoatSafetySnapshots, trips } from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";

/**
 * **The finished dawn boat's departure log has its papers on file** (issue
 * #3650): the demo's one sailed departure with a roll call used to read "No
 * record of the boat's papers and safety kit was kept".
 */
describe("the seeded dawn boat's safety snapshot", () => {
  async function dawn() {
    const { db, shop } = await seededShopContext();
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!trip) throw new Error("the demo has no dawn boat");
    return { db, shop, trip };
  }

  it("keeps one snapshot on the hull she sailed on, captured before she sailed", async () => {
    const { db, shop, trip } = await dawn();
    const rows = await db
      .select()
      .from(departureBoatSafetySnapshots)
      .where(eq(departureBoatSafetySnapshots.tripId, trip.id));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.boatId).toBe(trip.boatId);
    expect(row?.boatName).toBe("Mantis II");
    expect(row?.capturedAt.getTime()).toBeLessThan(trip.startsAt.getTime());
    expect(row?.departureStartsAt?.getTime()).toBe(trip.startsAt.getTime());
    const read = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(read?.papers.certifiedPassengers).toBeGreaterThan(0);
    expect(read?.radio.callSign).toBe("WDM2202");
  });

  it("holds every paper date, all after the day she sailed, and no failure notice", async () => {
    const { db, shop, trip } = await dawn();
    const read = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(read).not.toBeNull();
    for (const date of [
      read?.papers.coiExpiresOn,
      read?.papers.inspectionDueOn,
      read?.papers.registrationExpiresOn,
      read?.papers.insuranceExpiresOn,
    ]) {
      expect(date).toBeTruthy();
      expect((date as string) > (read?.judgedOn as string)).toBe(true);
    }
    expect(read?.notices).toEqual([]);
  });
});
