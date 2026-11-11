import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lastSafetyDrills, listSafetyDrills } from "@/features/safety-drills";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { DRILL_KINDS } from "@/lib/safety-drills";
import { seededShopContext } from "@/test/db";
import { safetyDrillParticipants } from "./schema";
import { seedSafetyDrills } from "./seed-safety-drills";

it("gives the demo a recent, attributed practice record for every drill kind", async () => {
  const { db, shop } = await seededShopContext();
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const drills = await listSafetyDrills(db, shop.id, {
    from: shiftCalendarDate(today, -35),
    to: today,
  });
  expect(drills.map((drill) => drill.kind).sort()).toEqual([...DRILL_KINDS].sort());
  for (const drill of drills) {
    expect(drill.participants.length).toBeGreaterThan(1);
    expect(drill.recordedBy).toBeTruthy();
    expect(drill.note).toContain("Fictional demo drill.");
    expect(drill.heldOn <= today).toBe(true);
  }
  expect((await lastSafetyDrills(db, shop.id)).size).toBe(4);
});

it("reseed keeps the original practice records and participant rows", async () => {
  const { db, shop } = await seededShopContext();
  const before = await db
    .select()
    .from(safetyDrillParticipants)
    .where(eq(safetyDrillParticipants.shopId, shop.id));
  expect(before.length).toBeGreaterThan(0);
  await seedSafetyDrills(db, shop.id);
  expect(
    await db
      .select()
      .from(safetyDrillParticipants)
      .where(eq(safetyDrillParticipants.shopId, shop.id)),
  ).toEqual(before);
});
