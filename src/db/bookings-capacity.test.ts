import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { createBooking } from "./bookings";
import { createTrip, getTripRoster, listStaff, setTripCrew } from "./trips";

const ctx = fileScopedShopContext();

describe("booking capacity with assigned crew", () => {
  it("reserves boat occupants for crew and keeps existing bookings after crew grows", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Three aboard", 3);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Crew takes a place",
      startsAt: new Date("2031-08-02T12:00:00Z"),
      endsAt: new Date("2031-08-02T16:00:00Z"),
      capacity: 6,
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
        staff.slice(0, 1).map(({ person }) => person.id),
      ),
    ).toBe(true);

    const first = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Capacity Diver One",
    });
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Capacity Diver Two",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Capacity Diver Three",
      }),
    ).toMatchObject({ ok: false, reason: "trip_full" });

    expect(
      await setTripCrew(
        db,
        shop.id,
        trip.id,
        staff.slice(0, 2).map(({ person }) => person.id),
      ),
    ).toBe(true);
    expect(
      await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Capacity Diver Four",
      }),
    ).toMatchObject({ ok: false, reason: "trip_full" });
    expect(
      (await getTripRoster(db, shop.id, trip.id)).filter(
        ({ booking }) => booking.status !== "cancelled",
      ),
    ).toHaveLength(2);
  });
});
