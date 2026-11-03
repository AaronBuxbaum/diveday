import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { gearItems, gearReservations } from "@/db/schema";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";

/**
 * **One unit actually out with a diver**, which the demo shop never has: it
 * reserves its fleet against a departure five days out, so every seeded window
 * is in the future and the register's headline group — Out (ADR
 * 20260827-the-shops-shelves, slice 9d) — has nothing in it to photograph.
 *
 * Dragged onto today rather than seeded, for the reason the whole route
 * exists: a demo whose regulators are permanently on somebody else's boat is a
 * worse demo. The window closes today, which is the one day a row names a
 * clock time instead of a date.
 */
export async function putOneUnitOutToday(
  db: AppDb,
  shopId: string,
  now: Date,
  timezone: string,
): Promise<void> {
  const [unit] = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.label, "Reg #1")))
    .limit(1);
  if (!unit) return;
  await db
    .update(gearReservations)
    .set({
      reservedFrom: calendarDateInTimezone(new Date(now.getTime() - 24 * HOUR_MS), timezone),
      reservedUntil: calendarDateInTimezone(now, timezone),
      checkedOutAt: new Date(now.getTime() - 24 * HOUR_MS),
    })
    .where(eq(gearReservations.gearItemId, unit.id));
}
