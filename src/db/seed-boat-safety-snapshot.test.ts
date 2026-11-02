import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { BOAT_PAPER_HORIZON_DAYS } from "@/lib/boat-safety";
import { seededShopContext } from "@/test/db";
import { departureBoatSafetySnapshot } from "./boat-safety";
import { boats, departureBoatSafetySnapshots, trips } from "./schema";
import { dateAt } from "./seed-clock";
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

  it("copies the Mantis II row's limits, paper dates and radio, and holds no failure notice", async () => {
    const { db, shop, trip } = await dawn();
    const [boat] = await db
      .select()
      .from(boats)
      .where(eq(boats.id, trip.boatId as string));
    const read = await departureBoatSafetySnapshot(db, shop.id, trip.id);
    expect(read).not.toBeNull();
    expect(boat?.coiExpiresOn).toBeTruthy();
    expect(boat?.inspectionDueOn).toBeTruthy();
    expect(boat?.registrationExpiresOn).toBeTruthy();
    expect(boat?.insuranceExpiresOn).toBeTruthy();
    expect(read?.papers).toEqual({
      certifiedPassengers: boat?.certifiedPassengers,
      certifiedTotalPersons: boat?.certifiedTotalPersons,
      coiExpiresOn: boat?.coiExpiresOn,
      inspectionDueOn: boat?.inspectionDueOn,
      registrationExpiresOn: boat?.registrationExpiresOn,
      insuranceExpiresOn: boat?.insuranceExpiresOn,
    });
    expect(read?.radio).toEqual({
      callSign: boat?.callSign,
      mmsi: boat?.mmsi,
      workingChannel: boat?.workingChannel,
    });
    expect(read?.notices).toEqual([]);
  });

  it("dates the papers past every horizon, so no paper errand fires on Today", async () => {
    const { db, trip } = await dawn();
    const [boat] = await db
      .select()
      .from(boats)
      .where(eq(boats.id, trip.boatId as string));
    const today = dateAt(0);
    for (const [paper, due] of [
      ["coi", boat?.coiExpiresOn],
      ["inspection", boat?.inspectionDueOn],
      ["registration", boat?.registrationExpiresOn],
      ["insurance", boat?.insuranceExpiresOn],
    ] as const) {
      const days = (Date.parse(due as string) - Date.parse(today)) / 86_400_000;
      expect(days).toBeGreaterThan(BOAT_PAPER_HORIZON_DAYS[paper]);
    }
  });
});
