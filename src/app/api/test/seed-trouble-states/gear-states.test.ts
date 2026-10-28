import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { gearItems, gearReservations } from "@/db/schema";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { gearRegisterGroup } from "@/lib/gear";
import { seededShopContext } from "@/test/db";
import { gearSliceStates } from "./gear-states";

describe("the uncollected overdue gear fixture", () => {
  it("adds two overdue uncollected units only when requested, and is repeatable", async () => {
    const { db, shop } = await seededShopContext();
    const now = nowDate();
    const run = (query: string) =>
      gearSliceStates(
        new Request(`http://localhost/api/test/seed-trouble-states?${query}`),
        db,
        shop.id,
        now,
      );
    const calm = await run("gearOut=1");
    expect(calm.gearUncollected).toBeUndefined();
    const seeded = await run("gearUncollected=1");
    expect(seeded.gearUncollected?.labels).toEqual(["BCD #3", "BCD #4"]);
    expect((await run("gearUncollected=1")).gearUncollected).toEqual(seeded.gearUncollected);
    const rows = await db
      .select({ reservation: gearReservations })
      .from(gearReservations)
      .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
      .where(
        and(
          eq(gearReservations.shopId, shop.id),
          inArray(gearItems.label, ["BCD #3", "BCD #4"]),
          isNull(gearReservations.returnedAt),
          isNull(gearReservations.releasedAt),
        ),
      );
    expect(rows).toHaveLength(2);
    for (const { reservation } of rows) {
      expect(reservation.checkedOutAt).toBeNull();
      expect(reservation.personId).toBeTruthy();
      expect(gearRegisterGroup(reservation, calendarDateInTimezone(now, shop.timezone))).toBe(
        "overdue",
      );
    }
  });
});
