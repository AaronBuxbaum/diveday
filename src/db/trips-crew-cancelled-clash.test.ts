import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createTrip, listStaff, setTripCrew, setTripStatus } from "./trips";
import { changeTripCrewOutcome } from "./trips-crew";

const ctx = fileScopedShopContext();

describe("crew assignments after a cancellation", () => {
  it("allows the crew member onto an overlapping scheduled departure", async () => {
    const { db, shop } = ctx;
    const person = (await listStaff(db, shop.id))[0]?.person;
    if (!person) throw new Error("expected staff");
    const input = {
      shopId: shop.id,
      startsAt: new Date("2035-08-04T08:00:00Z"),
      endsAt: new Date("2035-08-04T12:00:00Z"),
      capacity: 8,
    };
    const cancelled = await createTrip(db, { ...input, title: "Cancelled" });
    const target = await createTrip(db, { ...input, title: "Target" });
    if (!cancelled || !target) throw new Error("expected departures");
    expect(await setTripCrew(db, shop.id, cancelled.id, [person.id])).toBe(true);
    await setTripStatus(db, shop.id, cancelled.id, "cancelled");
    expect(
      await changeTripCrewOutcome(db, shop.id, target.id, {
        personId: person.id,
        operation: "assign",
      }),
    ).toEqual({ ok: true });
  });
});
