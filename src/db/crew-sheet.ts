import { and, eq, gte, inArray, lt, sum } from "drizzle-orm";
import type { MonthRef } from "@/lib/calendar";
import type { CrewSheetAssignment, CrewSheetTripTips } from "@/lib/crew-sheet";
import { shopMonthBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import {
  bookings,
  people,
  tips as tipsTable,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

export type CrewSheetInput = {
  assignments: CrewSheetAssignment[];
  tips: CrewSheetTripTips[];
};

/**
 * Everything the crew sheet needs for one shop-local month: who was assigned
 * to which departure, in what job and for how many minutes, and what tips each
 * departure took.
 *
 * **Which departures count.** Those that *started* inside the month, are still
 * on the board (`liveTrip()`), and were not called off: a cancelled charter is
 * not a shift anyone worked. That is the same rule `todaysTrips` applies in
 * `src/db/closeout.ts`.
 *
 * **How long one ran.** The trip's own scheduled days when it has them, summed
 * — so a three-day course is three working days rather than the seventy-two
 * hours `ends_at - starts_at` would claim — and the departure's own window
 * otherwise, which is every ordinary charter.
 *
 * **Which tips.** Paid ones only, anchored to the *departure's* month rather
 * than to when the diver happened to tap the recap link, which is the same
 * anchoring `getMonthlyReport` uses so the two figures can never disagree. A
 * pending Stripe session is money nobody has and an expired one is money
 * nobody will get. The split across crew happens in `src/lib/crew-sheet.ts`;
 * this returns the per-departure totals it splits.
 */
export async function crewSheetForMonth(
  db: DbExecutor,
  shopId: string,
  timeZone: string,
  month: MonthRef,
): Promise<CrewSheetInput> {
  const { from, to } = shopMonthBounds(month, timeZone);
  /**
   * The month's departures, as both queries below scope them. `liveTrip()` is
   * repeated literally at each `.where` rather than only living here: a
   * departure the shop deleted was never a shift anybody worked, and
   * `scripts/check-live-trips.mjs` reads the query text rather than following a
   * variable, so a shared helper would read to it as an unfiltered join.
   */
  const inMonth = and(
    eq(trips.shopId, shopId),
    eq(trips.status, "scheduled"),
    gte(trips.startsAt, from),
    lt(trips.startsAt, to),
  );

  const rows = await db
    .select({
      tripId: trips.id,
      personId: people.id,
      personName: people.fullName,
      tripRole: tripAssignments.tripRole,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    // The person is re-scoped to the shop rather than trusted to belong to it
    // because the trip does: an assignment row is written by staff, and a
    // reader that leaves the tenant condition to whoever wrote the row is one
    // bad write away from putting another shop's crew member on this sheet.
    .innerJoin(people, and(eq(people.id, tripAssignments.personId), eq(people.shopId, shopId)))
    .where(and(liveTrip(), inMonth));

  const tripIds = [...new Set(rows.map((row) => row.tripId))];
  const scheduleDays = tripIds.length
    ? await db
        .select({
          tripId: tripScheduleDays.tripId,
          startsAt: tripScheduleDays.startsAt,
          endsAt: tripScheduleDays.endsAt,
        })
        .from(tripScheduleDays)
        .where(inArray(tripScheduleDays.tripId, tripIds))
    : [];
  const dayMinutes = new Map<string, number>();
  for (const day of scheduleDays) {
    const minutes = (day.endsAt.getTime() - day.startsAt.getTime()) / 60_000;
    dayMinutes.set(day.tripId, (dayMinutes.get(day.tripId) ?? 0) + minutes);
  }

  // Tips are read across the whole month's departures rather than only the
  // crewed ones: a tip on a boat with nobody on its crew list is exactly the
  // money the sheet's unassigned row exists to keep visible.
  const tipRows = await db
    .select({ tripId: trips.id, total: sum(tipsTable.amountCents) })
    .from(tipsTable)
    .innerJoin(bookings, and(eq(bookings.id, tipsTable.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(liveTrip(), inMonth, eq(tipsTable.shopId, shopId), eq(tipsTable.status, "paid")))
    .groupBy(trips.id);

  return {
    assignments: rows.map((row) => ({
      tripId: row.tripId,
      personId: row.personId,
      personName: row.personName,
      tripRole: row.tripRole,
      minutes:
        dayMinutes.get(row.tripId) ?? (row.endsAt.getTime() - row.startsAt.getTime()) / 60_000,
    })),
    tips: tipRows.map((row) => ({ tripId: row.tripId, amountCents: Number(row.total ?? 0) })),
  };
}
