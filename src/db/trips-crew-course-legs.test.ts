import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { crewAvailabilityBlocks, shops } from "./schema";
import { createTrip, crewMoveConflicts, listStaff, setTripCrew } from "./trips";

const ctx = fileScopedShopContext();

describe("crewMoveConflicts on a multi-day course", () => {
  /** The week-long span is not the course: a blackout in the gap between two meeting days touches no leg. */
  it("flags away only for a blackout that touches a leg, not the gap between legs", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shop.id));
    const timeZone = "Pacific/Honolulu";
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");
    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Rescue, two weekends",
      startsAt: new Date("2030-08-01T18:00:00Z"),
      endsAt: new Date("2030-08-08T22:00:00Z"),
      capacity: 6,
      scheduleDays: [
        {
          dayNumber: 1,
          startsAt: new Date("2030-08-01T18:00:00Z"),
          endsAt: new Date("2030-08-01T22:00:00Z"),
        },
        {
          dayNumber: 2,
          startsAt: new Date("2030-08-08T18:00:00Z"),
          endsAt: new Date("2030-08-08T22:00:00Z"),
        },
      ],
    });
    if (!course) throw new Error("course not created");
    await setTripCrew(db, shop.id, course.id, [first.person.id]);
    await db.insert(crewAvailabilityBlocks).values({
      shopId: shop.id,
      personId: first.person.id,
      createdByPersonId: first.person.id,
      startsOn: "2030-08-12",
      endsOn: "2030-08-13",
    });
    // Moved four days: legs land on Aug 5 and Aug 12 -> the Aug 12 leg is hit.
    const hit = await crewMoveConflicts(
      db,
      shop.id,
      course.id,
      new Date("2030-08-05T18:00:00Z"),
      timeZone,
    );
    expect(hit.away).toHaveLength(1);
    // Moved one day: legs land on Aug 2 and Aug 9; the blackout sits past both.
    const past = await crewMoveConflicts(
      db,
      shop.id,
      course.id,
      new Date("2030-08-02T18:00:00Z"),
      timeZone,
    );
    expect(past.away).toEqual([]);
    // Moved so the gap holds the blackout: legs Aug 6 and Aug 13 would hit; legs Aug 3/Aug 10 do not.
    await db
      .update(crewAvailabilityBlocks)
      .set({ startsOn: "2030-08-05", endsOn: "2030-08-07" })
      .where(eq(crewAvailabilityBlocks.shopId, shop.id));
    const gap = await crewMoveConflicts(
      db,
      shop.id,
      course.id,
      new Date("2030-08-02T18:00:00Z"),
      timeZone,
    );
    expect(gap.away).toEqual([]);
  });
});
