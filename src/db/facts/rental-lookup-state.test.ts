import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAvailableGearUnits } from "@/db/gear";
import { gearItems } from "@/db/schema";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { seedRentalLookupFleet } from "./rental-lookup-state";

describe("the opt-in counter lookup fleet", () => {
  it("gives repeated baseline runs the same 100 tanks, 80 suits and target positions", async () => {
    const { db, shop } = await seededShopContext();
    const now = nowDate();
    const fixture = await seedRentalLookupFleet(db, shop.id, now);
    expect(await seedRentalLookupFleet(db, shop.id, now)).toEqual(fixture);

    const live = await db
      .select({ kind: gearItems.kind })
      .from(gearItems)
      .where(
        and(
          eq(gearItems.shopId, shop.id),
          inArray(gearItems.kind, ["tank", "wetsuit"]),
          isNull(gearItems.deletedAt),
        ),
      );
    expect(live.filter((unit) => unit.kind === "tank")).toHaveLength(100);
    expect(live.filter((unit) => unit.kind === "wetsuit")).toHaveLength(80);

    const today = calendarDateInTimezone(now, shop.timezone);
    const available = await listAvailableGearUnits(db, shop.id, {
      from: today,
      until: today,
      todayLocal: today,
    });
    const tanks = available.filter((unit) => unit.kind === "tank");
    const suits = available.filter((unit) => unit.kind === "wetsuit");
    expect(tanks).toHaveLength(100);
    expect(suits).toHaveLength(80);
    expect(tanks.findIndex((unit) => unit.label === fixture.tankTarget)).toBe(94);
    expect(suits.findIndex((unit) => unit.size === fixture.sizeTarget)).toBe(70);
    expect(suits.filter((unit) => unit.size === fixture.sizeTarget)).toHaveLength(10);
    expect(fixture.personId).toBeTruthy();
  });
});
