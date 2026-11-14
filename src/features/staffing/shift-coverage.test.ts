import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { staffShifts } from "@/db/schema";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { createStaffShift, crewShiftCoverage } from "./store";

const ctx = fileScopedShopContext();
it("does not describe a partially covered departure as on shift", async () => {
  const { db, shop } = ctx;
  await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
  const [member] = await listStaff(db, shop.id);
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!member || !trip) throw new Error("staffing fixture missing");
  await createStaffShift(db, {
    shopId: shop.id,
    personId: member.person.id,
    startsAt: new Date(trip.startsAt.getTime() + 60_000),
    endsAt: trip.endsAt,
  });
  expect(
    (await crewShiftCoverage(db, shop.id, trip, [member.person.id]))?.has(member.person.id),
  ).toBe(false);
});

it("covers each course meeting without requiring an overnight shift", async () => {
  const { db, shop } = ctx;
  await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
  const [member] = await listStaff(db, shop.id);
  if (!member) throw new Error("staffing fixture missing");
  const windows = [
    { startsAt: new Date("2026-08-01T12:00:00Z"), endsAt: new Date("2026-08-01T16:00:00Z") },
    { startsAt: new Date("2026-08-02T12:00:00Z"), endsAt: new Date("2026-08-02T16:00:00Z") },
  ];
  const trip = { startsAt: windows[0].startsAt, endsAt: windows[1].endsAt };
  await createStaffShift(db, { shopId: shop.id, personId: member.person.id, ...windows[0] });
  expect(
    (await crewShiftCoverage(db, shop.id, trip, [member.person.id], windows))?.has(
      member.person.id,
    ),
  ).toBe(false);
  await createStaffShift(db, { shopId: shop.id, personId: member.person.id, ...windows[1] });
  expect(
    (await crewShiftCoverage(db, shop.id, trip, [member.person.id], windows))?.has(
      member.person.id,
    ),
  ).toBe(true);
});
