import { calendarDateInTimezone, shiftCalendarDateMonths } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "../client";
import { gearItems, gearServiceEvents } from "../schema";
import { at, DEMO_SHOP_TIMEZONE } from "./clock";

/** Enough cylinders and sized rental kit to serve the shop's two boats. */
export async function seedRentalFleet(db: DbExecutor, shopId: string): Promise<void> {
  const fleet: (typeof gearItems.$inferInsert)[] = [];
  for (let number = 7; number <= 70; number++) {
    fleet.push({
      shopId,
      kind: "tank",
      label: `AL80-${String(number).padStart(2, "0")}`,
      size: "AL80",
      serialNumber: `LUX-${482200 + number}`,
      createdAt: at(-1_200, 9),
    });
  }
  const sizes = ["S", "M", "M", "L", "L", "XL"];
  for (let number = 7; number <= 18; number++) {
    fleet.push({
      shopId,
      kind: "bcd",
      label: `BCD #${number}`,
      size: sizes[(number - 7) % sizes.length],
      brandModel: "Cressi Start",
      serialNumber: `CS-${2200 + number}`,
      createdAt: at(-1_200, 9),
    });
    fleet.push({
      shopId,
      kind: "wetsuit",
      label: `3mm #${number}`,
      size: sizes[(number - 7) % sizes.length],
      thicknessMm: 3,
      brandModel: "Bare Reactive 3mm",
      createdAt: at(-1_200, 9),
    });
  }
  for (let number = 6; number <= 18; number++) {
    fleet.push({
      shopId,
      kind: "regulator",
      label: `Reg #${number}`,
      brandModel: "Aqualung Core",
      serialNumber: `AL-${88409 + number}`,
      createdAt: at(-1_200, 9),
    });
  }
  for (let number = 4; number <= 12; number++) {
    fleet.push({ shopId, kind: "mask", label: `Mask #${number}`, createdAt: at(-1_200, 9) });
    fleet.push({
      shopId,
      kind: "fins",
      label: `Fins #${number}`,
      size: ["S", "M", "M", "L", "L"][(number - 4) % 5],
      createdAt: at(-1_200, 9),
    });
    fleet.push({
      shopId,
      kind: "boots",
      label: `Boots #${number}`,
      size: String(6 + (number % 6)),
      createdAt: at(-1_200, 9),
    });
  }
  const units = await db
    .insert(gearItems)
    .values(fleet)
    .returning({ id: gearItems.id, kind: gearItems.kind });
  const today = calendarDateInTimezone(nowDate(), DEMO_SHOP_TIMEZONE);
  const months = (amount: number) => shiftCalendarDateMonths(today, amount);
  const care: (typeof gearServiceEvents.$inferInsert)[] = [];
  units.forEach((unit, index) => {
    const age = 2 + (index % 8);
    const add = (
      kind: "visual_inspection" | "hydro_test" | "o2_clean" | "service",
      servicedOn: string,
      nextDueOn: string,
    ) => {
      care.push({
        shopId,
        gearItemId: unit.id,
        kind,
        servicedOn,
        nextDueOn,
        createdAt: new Date(`${servicedOn}T17:00:00.000Z`),
      });
    };
    if (unit.kind === "tank") {
      add("visual_inspection", months(-age), months(12 - age));
      add("hydro_test", months(-6 - (index % 4) * 9), months(54 - (index % 4) * 9));
      if (index % 4 !== 0) add("o2_clean", months(1 - age), months(13 - age));
    } else if (unit.kind === "bcd" || unit.kind === "regulator") {
      add("service", months(-age), months(12 - age));
    }
  });
  if (care.length) await db.insert(gearServiceEvents).values(care);
}
