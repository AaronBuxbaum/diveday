import { and, eq, gte, inArray, isNull, not } from "drizzle-orm";
import { seatCheckedIn } from "../../db/arrival-provenance";
import type { AppDb } from "../../db/client";
import {
  bookings,
  gearItems,
  gearReservations,
  gearServiceEvents,
  people,
  trips,
} from "../../db/schema/index";
import { calendarDateInTimezone, shiftCalendarDate } from "../../lib/calendar-date";
import { HOUR_MS } from "../../lib/clock";
import { tripReservationWindow } from "../../lib/gear";
import { REEF_TRIP_TITLE } from "./reef-trip-title";

/**
 * **Every reason the Gear tab gives for an assigned unit needing a look**
 * (issue #2221, PR #2209), one unit each, assigned to four divers on today's
 * reef boat: "Needs service" with the staffer's note, a service clock run
 * out, a return flagged as a concern nobody has answered, and a clock coming
 * due inside `GEAR_SERVICE_DUE_SOON_DAYS`.
 *
 * The reef boat rather than the wreck trip the demo assigns units on
 * (`seed-gear.ts`), because `?owedRefund=1` cancels that departure to owe a
 * refund on it, and a Gear tab photographed on a cancelled trip shows the
 * wrong page. The four units are the wreck trip's, reserved for the reef boat's own
 * window, which does not overlap it.
 *
 * Written straight to the rows, because each state is a fact about the unit's
 * past (a service date, a return) rather than an act the tab offers. The
 * concern is a counter rental returned two days ago with `service_concern`
 * and a note, which is how the register learns of one; nothing has serviced
 * the suit since, so `serviceConcernStillOpen` holds.
 */
export async function flagFourUnitsOnTheReefBoat(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
  now: Date,
  timezone: string,
): Promise<{ tripId: string } | null> {
  const [reef] = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
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
  if (!reef) return null;
  // By the diver's name, so the same four hold the same units every run.
  const seats = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    // Seats still to come at the desk, as before arrival left the seat word (#2702).
    .where(and(eq(bookings.tripId, reef.id), eq(bookings.status, "booked"), not(seatCheckedIn)))
    .orderBy(people.fullName)
    .limit(4);
  const units = new Map(
    (
      await db
        .select({ id: gearItems.id, label: gearItems.label })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.shopId, shopId),
            inArray(gearItems.label, ["BCD #2", "Reg #1", "3mm #1", "BCD #5"]),
          ),
        )
    ).map((unit) => [unit.label, unit.id]),
  );
  const needsService = units.get("BCD #2");
  const overdue = units.get("Reg #1");
  const concern = units.get("3mm #1");
  const dueSoon = units.get("BCD #5");
  if (!needsService || !overdue || !concern || !dueSoon || seats.length < 4) return null;
  const today = calendarDateInTimezone(now, timezone);
  const window = tripReservationWindow(reef, timezone);
  await db.insert(gearReservations).values(
    [needsService, overdue, concern, dueSoon].map((gearItemId, index) => ({
      shopId,
      gearItemId,
      bookingId: seats[index]?.id,
      reservedFrom: window.from,
      reservedUntil: window.until,
    })),
  );

  await db
    .update(gearItems)
    .set({ status: "needs_service", serviceNote: "Inflator sticks; strip and clean." })
    .where(eq(gearItems.id, needsService));
  await db
    .update(gearServiceEvents)
    .set({ nextDueOn: shiftCalendarDate(today, -6) })
    .where(and(eq(gearServiceEvents.gearItemId, overdue), eq(gearServiceEvents.kind, "service")));
  await db
    .update(gearServiceEvents)
    .set({ nextDueOn: shiftCalendarDate(today, 10) })
    .where(and(eq(gearServiceEvents.gearItemId, dueSoon), eq(gearServiceEvents.kind, "service")));
  await db.insert(gearReservations).values({
    shopId,
    gearItemId: concern,
    personId: actorPersonId,
    reservedFrom: shiftCalendarDate(today, -4),
    reservedUntil: shiftCalendarDate(today, -3),
    checkedOutAt: new Date(now.getTime() - 4 * 24 * HOUR_MS),
    returnedAt: new Date(now.getTime() - 2 * 24 * HOUR_MS),
    returnOutcome: "service_concern",
    returnNote: "Seam opening at the left knee.",
  });
  return { tripId: reef.id };
}
