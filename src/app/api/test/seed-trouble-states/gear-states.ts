import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { createCounterRental } from "@/db/gear-counter-rentals";
import { gearItems, gearReservations, people, shops } from "@/db/schema";
import { livePerson } from "@/db/trips-live";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";
import { seedRentalLookupFleet } from "./rental-lookup-state";

/**
 * The gear states `seed-trouble-states` writes on request, kept beside the
 * route rather than in it. Each is opt-in because the demo's register is calm
 * on purpose, and only the capture that asks pays for the trouble.
 *
 * - `gearConcern` (#2570): the unit the demo already has on the bench, Reg #4,
 *   with a rental that came home yesterday under a service concern whose words
 *   are not the unit's own note, so its status card names the return.
 * - `rentalWaiverWarning` (#2570): a counter rental out to someone with no
 *   waiver on file, so the Rentals list carries its waiver word.
 */
export async function gearSliceStates(request: Request, db: AppDb, shopId: string, now: Date) {
  const asked = (flag: string) => new URL(request.url).searchParams.get(flag) === "1";
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const timezone = shop?.timezone ?? "UTC";
  const gearConcern = asked("gearConcern")
    ? await returnTheBenchedUnitWithAConcern(db, shopId, now, timezone)
    : null;
  const rentalWaiverWarning = asked("rentalWaiverWarning")
    ? await lendAMaskToSomeoneWithNoWaiver(db, shopId, now, timezone)
    : null;
  const rentalLookup = asked("rentalLookup") ? await seedRentalLookupFleet(db, shopId, now) : null;
  const gearUncollected = asked("gearUncollected")
    ? await leaveTwoUnitsUncollected(db, shopId, now, timezone)
    : null;
  return {
    ...(gearConcern ? { gearConcern } : {}),
    ...(rentalWaiverWarning ? { rentalWaiverWarning } : {}),
    ...(rentalLookup ? { rentalLookup } : {}),
    ...(gearUncollected ? { gearUncollected } : {}),
  };
}

/** Two stale holds still on the wall, independent of the checked-out trouble kit. */
async function leaveTwoUnitsUncollected(db: AppDb, shopId: string, now: Date, timezone: string) {
  const labels = ["BCD #3", "BCD #4"];
  const units = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        inArray(gearItems.label, labels),
        isNull(gearItems.deletedAt),
      ),
    );
  const [holder] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma"), livePerson()))
    .limit(1);
  if (units.length !== labels.length || !holder) return null;
  for (const unit of units) {
    const [existing] = await db
      .select({ id: gearReservations.id })
      .from(gearReservations)
      .where(
        and(
          eq(gearReservations.shopId, shopId),
          eq(gearReservations.gearItemId, unit.id),
          isNull(gearReservations.returnedAt),
          isNull(gearReservations.releasedAt),
        ),
      )
      .limit(1);
    if (!existing)
      await db.insert(gearReservations).values({
        shopId,
        gearItemId: unit.id,
        personId: holder.id,
        reservedFrom: calendarDateInTimezone(new Date(now.getTime() - 4 * 24 * HOUR_MS), timezone),
        reservedUntil: calendarDateInTimezone(new Date(now.getTime() - 2 * 24 * HOUR_MS), timezone),
      });
  }
  return { labels };
}

const CONCERN_HOLDER = "Dana Reyes";
const CONCERN_NOTE = "Mouthpiece split on the second dive; the diver switched to the octopus.";

/** Idempotent: a second call finds the return and leaves it be. */
async function returnTheBenchedUnitWithAConcern(
  db: AppDb,
  shopId: string,
  now: Date,
  timezone: string,
): Promise<{ gearItemId: string; label: string } | null> {
  const [unit] = await db
    .select({ id: gearItems.id, label: gearItems.label })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        eq(gearItems.label, "Reg #4"),
        eq(gearItems.status, "needs_service"),
        isNull(gearItems.deletedAt),
      ),
    )
    .limit(1);
  const [holder] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, CONCERN_HOLDER), livePerson()))
    .limit(1);
  if (!unit || !holder) return null;
  const [already] = await db
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.gearItemId, unit.id),
        eq(gearReservations.returnOutcome, "service_concern"),
      ),
    )
    .limit(1);
  if (already) return { gearItemId: unit.id, label: unit.label };
  const returnedAt = new Date(now.getTime() - 20 * HOUR_MS);
  await db.insert(gearReservations).values({
    shopId,
    gearItemId: unit.id,
    personId: holder.id,
    reservedFrom: calendarDateInTimezone(new Date(now.getTime() - 3 * 24 * HOUR_MS), timezone),
    reservedUntil: calendarDateInTimezone(returnedAt, timezone),
    checkedOutAt: new Date(now.getTime() - 3 * 24 * HOUR_MS),
    returnedAt,
    returnOutcome: "service_concern",
    returnNote: CONCERN_NOTE,
  });
  return { gearItemId: unit.id, label: unit.label };
}

const RENTER = "Lena Okafor";

/** A mask is the one kind of unit a counter lends with no certification card to show. */
async function lendAMaskToSomeoneWithNoWaiver(
  db: AppDb,
  shopId: string,
  now: Date,
  timezone: string,
): Promise<{ personId: string; label: string } | null> {
  const [mask] = await db
    .select({ id: gearItems.id, label: gearItems.label })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        eq(gearItems.label, "Mask #1"),
        isNull(gearItems.deletedAt),
      ),
    )
    .limit(1);
  if (!mask) return null;
  const [existing] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, RENTER), livePerson()))
    .limit(1);
  if (existing) return { personId: existing.id, label: mask.label };
  const [renter] = await db
    .insert(people)
    .values({ shopId, fullName: RENTER })
    .returning({ id: people.id });
  if (!renter) return null;
  const today = calendarDateInTimezone(now, timezone);
  const rental = await createCounterRental(db, {
    shopId,
    personId: renter.id,
    gearItemIds: [mask.id],
    reservedFrom: today,
    reservedUntil: today,
    todayLocal: today,
  });
  if (!rental.ok) return null;
  await db
    .update(gearReservations)
    .set({ checkedOutAt: new Date(now.getTime() - HOUR_MS) })
    .where(eq(gearReservations.id, rental.ticketId));
  return { personId: renter.id, label: mask.label };
}
