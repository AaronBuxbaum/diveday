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
