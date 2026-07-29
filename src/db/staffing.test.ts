// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { people, staffShifts } from "./schema";
import { createStaffShift, getStaffingView } from "./staffing";
import { listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";

describe("staffing view", () => {
  it("shows roles, working windows, teaching/crew capabilities, and coverage gaps", async () => {
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!instructor || !trip) throw new Error("seeded staffing fixture missing");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);

    const shift = await createStaffShift(db, {
      shopId: shop.id,
      personId: instructor.person.id,
      startsAt: new Date(trip.startsAt.getTime() - 30 * 60 * 1000),
      endsAt: new Date(trip.endsAt.getTime() + 30 * 60 * 1000),
      note: "Dock and classroom",
      createdByPersonId: instructor.person.id,
    });
    expect(shift.ok).toBe(true);

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    const working = view.staff.find((entry) => entry.person.id === instructor.person.id);
    expect(working?.capabilities).toEqual(expect.arrayContaining(["teach", "crew"]));
    expect(working?.shifts).toHaveLength(1);
    expect(view.trips[0]?.coveredByShift).toBe(true);
  });

  it("rejects overlapping shifts for one staff member and scopes writes to the shop", async () => {
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded staff missing");
    const startsAt = new Date("2026-07-29T12:00:00.000Z");
    const first = await createStaffShift(db, {
      shopId: shop.id,
      personId: staff.person.id,
      startsAt,
      endsAt: new Date("2026-07-29T14:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    const overlap = await createStaffShift(db, {
      shopId: shop.id,
      personId: staff.person.id,
      startsAt: new Date("2026-07-29T13:00:00.000Z"),
      endsAt: new Date("2026-07-29T15:00:00.000Z"),
    });
    expect(overlap).toEqual({ ok: false, reason: "overlap" });

    const [person] = await db.select().from(people).where(eq(people.id, staff.person.id));
    expect(person?.shopId).toBe(shop.id);
  });
});
