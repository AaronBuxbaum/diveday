import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createTrip, deleteTrip, getTripCrewAssignments, listStaff, setTripCrew } from "./trips";
import { getTripCrewAssignmentsByTrip } from "./trips-crew";

const ctx = fileScopedShopContext();

describe("single-trip crew assignment reader parity", () => {
  it("returns empty for an unassigned or deleted trip", async () => {
    const { db, shop } = ctx;
    const [staffer] = await listStaff(db, shop.id);
    if (!staffer) throw new Error("seeded staff missing");
    const startsAt = new Date(nowDate().getTime() + 330 * 24 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Crew assignment reader parity",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!trip) throw new Error("failed to create a departure for reader parity");

    expect(await getTripCrewAssignments(db, shop.id, trip.id)).toEqual([]);
    expect((await getTripCrewAssignmentsByTrip(db, shop.id, [trip.id])).has(trip.id)).toBe(false);

    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: staffer.person.id, tripRole: "captain" },
      ]),
    ).toBe(true);
    expect(await getTripCrewAssignments(db, shop.id, trip.id)).toEqual([
      { personId: staffer.person.id, tripRole: "captain" },
    ]);
    expect(await deleteTrip(db, shop.id, trip.id)).toEqual({ ok: true });

    expect(await getTripCrewAssignments(db, shop.id, trip.id)).toEqual([]);
    expect((await getTripCrewAssignmentsByTrip(db, shop.id, [trip.id])).has(trip.id)).toBe(false);
  });
});
