import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { ensureDemoSailsToday } from "./demo-refresh";
import { staffShifts, tripAssignments, trips } from "./schema";
import { AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE } from "./seed-boat-at-sea";
import { demoTodayDepartureStart } from "./seed-clock";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";

const historyCtx = fileScopedShopContext({ history: true });

async function pushTheBoardLater(db: AppDb, shopId: string, days: number): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} + ${shift}`,
      endsAt: sql`${trips.endsAt} + ${shift}`,
    })
    .where(and(eq(trips.shopId, shopId), gte(trips.startsAt, nowDate())));

  // The close-out fixture is an ended departure on today's calendar day, and
  // the boat at sea sailed earlier today. Move both out of the way for tests
  // whose premise is an empty day; production refresh still treats a boat
  // that sailed today as a real boat.
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} - interval '1 day'`,
      endsAt: sql`${trips.endsAt} - interval '1 day'`,
    })
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.title, [DEMO_COMPLETED_TRIP_TITLE, AT_SEA_DAY_TITLE, AT_SEA_DUSK_TITLE]),
      ),
    );
}

/** Just the departures still ahead — the pool the today nudge picks from. */
async function upcoming(db: AppDb, shopId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, nowDate())),
    )
    .orderBy(asc(trips.startsAt));
}

it("preserves a crew member's day off and clears stale acknowledgements when a demo departure moves", async () => {
  const { db, shop } = historyCtx;
  const { crewAvailabilityBlocks, crewAwayAcknowledgements } = await import("./schema");
  const { calendarDateInTimezone, shiftCalendarDate } = await import("@/lib/calendar-date");
  await pushTheBoardLater(db, shop.id, 4);
  const [candidate] = await upcoming(db, shop.id);
  const [crew] = await db
    .select()
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, candidate.id));
  if (!crew) throw new Error("demo candidate crew missing");
  const tomorrow = new Date(nowDate().getTime() + DAY_MS);
  const day = calendarDateInTimezone(tomorrow, shop.timezone);
  const [block] = await db
    .insert(crewAvailabilityBlocks)
    .values({
      shopId: shop.id,
      personId: crew.personId,
      startsOn: shiftCalendarDate(day, -1),
      endsOn: shiftCalendarDate(day, 1),
      note: "Keeper test",
      createdByPersonId: crew.personId,
    })
    .returning();
  const [ack] = await db
    .insert(crewAwayAcknowledgements)
    .values({
      shopId: shop.id,
      tripId: candidate.id,
      personId: crew.personId,
      acknowledgedByPersonId: crew.personId,
    })
    .returning();
  await db
    .delete(staffShifts)
    .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, crew.personId)));
  const startsAt = demoTodayDepartureStart(tomorrow, shop.timezone);
  await db.insert(staffShifts).values({
    shopId: shop.id,
    personId: crew.personId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    note: "Staff-entered shift",
    createdByPersonId: crew.personId,
  });
  const shiftsBefore = await db
    .select()
    .from(staffShifts)
    .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, crew.personId)));
  expect(await ensureDemoSailsToday(db, shop.id, shop.timezone, tomorrow)).toBe("moved");
  const blocks = await db
    .select()
    .from(crewAvailabilityBlocks)
    .where(
      and(
        eq(crewAvailabilityBlocks.shopId, shop.id),
        eq(crewAvailabilityBlocks.personId, crew.personId),
        eq(crewAvailabilityBlocks.note, "Keeper test"),
      ),
    );
  expect(blocks).toEqual([block]);
  expect(
    await db
      .select()
      .from(staffShifts)
      .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, crew.personId))),
  ).toEqual(shiftsBefore);
  const [cleared] = await db
    .select()
    .from(crewAwayAcknowledgements)
    .where(eq(crewAwayAcknowledgements.id, ack.id));
  expect(cleared.deletedAt).not.toBeNull();
});
