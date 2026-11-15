import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { people, staffShifts, trips } from "@/db/schema";
import { createTripSeries } from "@/db/trips";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { resolveFacts } from "./index";
import { standingCrewShifts } from "./standing-crew-shifts";

const ctx = fileScopedShopContext();
it("covers every materialized date with separate shifts for private fixture crew", async () => {
  const { db, shop } = ctx;
  const resolution = resolveFacts([{ name: "standingCrewShifts", title: "Series Fixture" }]);
  expect(resolution.ok && resolution.facts[0]?.privateOnly).toBe(true);
  const created = await createTripSeries(db, {
    shopId: shop.id,
    title: "Series Fixture",
    capacity: 6,
    plannedDives: 1,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([6]),
    anchorDate: "2030-09-07",
    endsOn: null,
    timeZone: "America/New_York",
    template: {
      startsAt: new Date("2030-09-07T09:00:00.000Z"),
      endsAt: new Date("2030-09-07T11:00:00.000Z"),
    },
  });
  if (!created) throw new Error("series missing");
  const result = await standingCrewShifts(db, shop.id, "Series Fixture");
  expect(result.dates).toBe(created.trips.length);
  expect(result.dates).toBeGreaterThan(3);
  const members = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(eq(people.shopId, shop.id), inArray(people.fullName, ["Alex Series", "Sam Series"])),
    );
  expect(members).toHaveLength(2);
  const shifts = await db
    .select()
    .from(staffShifts)
    .where(
      inArray(
        staffShifts.personId,
        members.map((person) => person.id),
      ),
    );
  const dates = await db
    .select()
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.title, "Series Fixture")));
  for (const member of members) {
    const own = shifts.filter((shift) => shift.personId === member.id);
    expect(own).toHaveLength(dates.length);
    for (const date of dates)
      expect(
        own.some(
          (shift) =>
            shift.startsAt.getTime() === date.startsAt.getTime() &&
            shift.endsAt.getTime() === date.endsAt.getTime(),
        ),
      ).toBe(true);
  }
});
