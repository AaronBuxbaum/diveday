import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { shops, staffShifts } from "./schema";
import { changeTripCrewOutcome, createTrip, getTripCrewIds, listStaff, setTripCrew } from "./trips";

const ctx = fileScopedShopContext();
async function fixture() {
  const { db, shop } = ctx;
  const [person] = await listStaff(db, shop.id);
  if (!person) throw new Error("no staff");
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Advance crew plan",
    startsAt: new Date("2031-06-01T12:00:00Z"),
    endsAt: new Date("2031-06-01T16:00:00Z"),
    capacity: 6,
  });
  if (!trip) throw new Error("no trip");
  return { db, shop, personId: person.person.id, trip };
}
it("refuses advance assignment off shift, but never prevents recording actual crew", async () => {
  const { db, shop, personId, trip } = await fixture();
  expect(await setTripCrew(db, shop.id, trip.id, [personId], { requireScheduledShift: true })).toBe(
    false,
  );
  expect(
    await changeTripCrewOutcome(
      db,
      shop.id,
      trip.id,
      { personId, operation: "assign" },
      { requireScheduledShift: true },
    ),
  ).toEqual({ ok: false, refusal: "refused" });
  expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([]);
  expect(
    await changeTripCrewOutcome(db, shop.id, trip.id, { personId, operation: "assign" }),
  ).toEqual({ ok: true });
});
it("requires all working time and accepts adjacent shifts with no gap", async () => {
  const { db, shop, personId, trip } = await fixture();
  await db.insert(staffShifts).values({
    shopId: shop.id,
    personId,
    startsAt: trip.startsAt,
    endsAt: new Date("2031-06-01T14:00:00Z"),
  });
  expect(await setTripCrew(db, shop.id, trip.id, [personId], { requireScheduledShift: true })).toBe(
    false,
  );
  await db.insert(staffShifts).values({
    shopId: shop.id,
    personId,
    startsAt: new Date("2031-06-01T14:00:00Z"),
    endsAt: trip.endsAt,
  });
  expect(await setTripCrew(db, shop.id, trip.id, [personId], { requireScheduledShift: true })).toBe(
    true,
  );
  expect(
    await changeTripCrewOutcome(
      db,
      shop.id,
      trip.id,
      { personId, operation: "unassign" },
      { requireScheduledShift: true },
    ),
  ).toEqual({ ok: true });
});
it("does not require shifts when the shop explicitly disables shift scheduling", async () => {
  const { db, shop, personId, trip } = await fixture();
  await db.update(shops).set({ crewScheduleEnabled: false }).where(eq(shops.id, shop.id));
  expect(await setTripCrew(db, shop.id, trip.id, [personId], { requireScheduledShift: true })).toBe(
    true,
  );
});

it("does not auto-seat standing crew until every meeting has shift coverage", async () => {
  const { db, shop, personId, trip } = await fixture();
  const { seatStandingCrew } = await import("./trips-crew");
  const days = [
    { startsAt: trip.startsAt, endsAt: trip.endsAt },
    { startsAt: new Date("2031-06-02T12:00:00Z"), endsAt: new Date("2031-06-02T16:00:00Z") },
  ];
  const input = {
    shopId: shop.id,
    tripId: trip.id,
    courseSession: false,
    days,
    crew: [{ personId, tripRole: null }],
  };
  expect(await db.transaction((tx) => seatStandingCrew(tx, input))).toEqual([]);
  await db.insert(staffShifts).values({ shopId: shop.id, personId, ...days[0] });
  expect(await db.transaction((tx) => seatStandingCrew(tx, input))).toEqual([]);
  await db.insert(staffShifts).values({ shopId: shop.id, personId, ...days[1] });
  expect(await db.transaction((tx) => seatStandingCrew(tx, input))).toEqual([personId]);
});
