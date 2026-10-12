import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { tripAssignments, trips } from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { crewShiftCoverage } from "./staffing";

/**
 * **The demo's own crew are on shift for the boats it puts them on**
 * (dive-domain review of the demo layer). The captain, divemaster and
 * assistant crew the 5:30 AM first-light boat, but the one shift every member
 * of the cast worked started an hour before today's departure, never before
 * 8:00, so the trip's crew section warned "Not on a shift" over the demo's
 * own captain.
 */
describe("seeded staff shifts", () => {
  it("cover every crew member of the dawn boat", async () => {
    const { db, shop } = await seededShopContext();
    const [dawn] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!dawn) throw new Error("the demo has no dawn boat");
    const crew = (
      await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, dawn.id))
    ).map((row) => row.personId);
    expect(crew.length).toBeGreaterThanOrEqual(2);
    const covered = await crewShiftCoverage(db, shop.id, dawn, crew);
    expect(covered && [...covered].sort()).toEqual([...crew].sort());
  });
});
