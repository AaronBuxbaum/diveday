import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { listAvailableGearUnits } from "./gear-availability";

/**
 * **The demo's EANx warning tells tanks apart** (issue #2719, domain review
 * 3A). With no O2-clean record on any seeded tank, every EANx fill on the demo
 * warned, which teaches staff to ignore the warning and never shows a clean
 * tank staying quiet.
 */
describe("the seeded tanks' O2 cleaning", () => {
  it("is current on most tanks, lapsed on one and never recorded on another", async () => {
    const { db, shop } = await seededShopContext();
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const tanks = await listAvailableGearUnits(db, shop.id, {
      from: today,
      until: today,
      todayLocal: today,
      kind: "tank",
      includeUnavailable: true,
    });
    const standing = new Map(tanks.map((tank) => [tank.label, tank.o2Clean]));
    expect(standing.get("AL80-01")).toBe("current");
    expect(standing.get("AL80-06")).toBe("lapsed");
    expect(standing.get("AL63-01")).toBe("never");
    const current = tanks.filter((tank) => tank.o2Clean === "current");
    expect(current.length).toBeGreaterThan(tanks.length / 2);
  });

  it("leaves each tank's visual inspection its nearest service clock", async () => {
    const { db, shop } = await seededShopContext();
    const today = calendarDateInTimezone(nowDate(), shop.timezone);
    const tanks = await listAvailableGearUnits(db, shop.id, {
      from: today,
      until: today,
      todayLocal: today,
      kind: "tank",
      includeUnavailable: true,
    });
    for (const tank of tanks) {
      expect(tank.serviceState).toMatchObject({ kind: "visual_inspection" });
    }
  });
});
