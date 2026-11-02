import { and, eq, gte, isNull, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { createGearItem, recordGearService } from "@/db/gear";
import { boats, bookings, trips } from "@/db/schema";
import { seatNotCancelled } from "@/db/trips";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { REEF_TRIP_TITLE } from "./reef-trip-title";

/**
 * **The reef boat's safety kit lapsing, and one passenger too many** (roadmap
 * N-08, N-10). The next reef departure's hull gets a certificate one below the
 * people booked on it and an insurance date three weeks out; an AED aboard with
 * pads twelve days from expiry and flares that expired three days ago. Each
 * line the Boat tab can say about a boat, in the order it says them.
 */
export async function letTheReefBoatsKitLapse(
  db: AppDb,
  shopId: string,
  now: Date,
  timeZone: string,
): Promise<{ tripId: string; boatName: string } | null> {
  const [reef] = await db
    .select({ id: trips.id, boatId: trips.boatId })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, REEF_TRIP_TITLE),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!reef?.boatId) return null;
  const [boat] = await db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, reef.boatId)))
    .limit(1);
  if (!boat) return null;

  const booked = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, reef.id), seatNotCancelled));
  const today = calendarDateInTimezone(now, timeZone);
  await db
    .update(boats)
    .set({
      certifiedPassengers: Math.max(1, booked.length - 1),
      insuranceExpiresOn: shiftCalendarDate(today, 21),
    })
    .where(eq(boats.id, boat.id));

  // Register tags, which are the shop's own data (what is painted on the
  // case), not DiveDay's copy.
  const units = [
    { kind: "aed", tag: "AED (Mantis)", clock: "aed_pads", dueIn: 12 },
    { kind: "flares", tag: "Flares (Mantis)", clock: "expiry", dueIn: -3 },
  ] as const;
  for (const unit of units) {
    const created = await createGearItem(db, {
      shopId,
      kind: unit.kind,
      label: unit.tag,
      aboardBoatId: boat.id,
    });
    if (!created.ok) continue;
    await recordGearService(db, {
      shopId,
      gearItemId: created.item.id,
      kind: unit.clock,
      servicedOn: shiftCalendarDate(today, -700),
      nextDueOn: shiftCalendarDate(today, unit.dueIn),
    });
  }
  // The shop's O2 kit left on the shelf: the shop keeps one, and this hull
  // sails without it — the must-carry line, in danger ink.
  const shelved = { kind: "o2_kit", tag: "O2 (shop)" } as const;
  await createGearItem(db, { shopId, kind: shelved.kind, label: shelved.tag });
  return { tripId: reef.id, boatName: boat.name };
}
