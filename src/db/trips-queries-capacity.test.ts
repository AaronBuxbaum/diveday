import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts, weekBoard } from "./trips";

const ctx = fileScopedShopContext();

describe("trip query capacity with assigned crew", () => {
  it("projects total boat capacity and limits seats by assigned crew", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Eight aboard", 8);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Crew-reserved capacity",
      startsAt: new Date("2031-08-01T12:00:00Z"),
      endsAt: new Date("2031-08-01T16:00:00Z"),
      capacity: 10,
      boatId: boat.id,
    });
    if (!trip) throw new Error("capacity trip not created");
    const staff = await listStaff(db, shop.id);
    if (staff.length < 2) throw new Error("two seeded staff members are required");
    expect(
      await setTripCrew(
        db,
        shop.id,
        trip.id,
        staff.slice(0, 2).map(({ person }) => person.id),
      ),
    ).toBe(true);

    const row = (await upcomingTripsWithCounts(db, shop.id)).find(({ id }) => id === trip.id);
    expect(row).toMatchObject({ boatCapacity: 8, assignedCrewCount: 2, sellableCapacity: 6 });
  });

  it("shows the crew-reserved passenger limit on the live week board", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Week board boat", 8);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Week board capacity",
      startsAt: new Date("2031-08-02T12:00:00Z"),
      endsAt: new Date("2031-08-02T16:00:00Z"),
      capacity: 10,
      boatId: boat.id,
    });
    if (!trip) throw new Error("capacity trip not created");
    const staff = await listStaff(db, shop.id);
    if (staff.length < 2) throw new Error("two seeded staff members are required");
    expect(
      await setTripCrew(
        db,
        shop.id,
        trip.id,
        staff.slice(0, 2).map(({ person }) => person.id),
      ),
    ).toBe(true);

    const board = await weekBoard(db, shop.id, "2031-07-28", "UTC");
    const entry = Object.values(board.days)
      .flat()
      .find(({ tripId }) => tripId === trip.id);
    expect(entry?.capacity).toBe(6);
  });
});
