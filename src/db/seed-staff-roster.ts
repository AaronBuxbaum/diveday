import { and, eq, inArray, isNull } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import type { DbExecutor } from "./client";
import {
  crewAvailabilityBlocks,
  people,
  personRoles,
  staffShifts,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";

/**
 * Reset-owned fictional roster, after every departure scenario has been built.
 * Each meeting has real shift coverage, including later course days. Days off
 * land on genuinely unassigned days rather than contradicting the seeded boats.
 * This is demo construction, never a repair of a real shop's audit history.
 */
export async function seedStaffRoster(db: DbExecutor, shopId: string): Promise<void> {
  // Only a freshly created demo gets this rota. Existing rows may be staff edits.
  const existingShift = await db
    .select({ id: staffShifts.id })
    .from(staffShifts)
    .where(eq(staffShifts.shopId, shopId))
    .limit(1);
  const existingAway = await db
    .select({ id: crewAvailabilityBlocks.id })
    .from(crewAvailabilityBlocks)
    .where(eq(crewAvailabilityBlocks.shopId, shopId))
    .limit(1);
  if (existingShift.length > 0 || existingAway.length > 0) return;
  const staff = await db
    .selectDistinct({ id: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(people.fullName);
  const assignments = await db
    .select({
      personId: tripAssignments.personId,
      tripId: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(eq(trips.shopId, shopId));
  const meetings = await db
    .select({
      tripId: tripScheduleDays.tripId,
      startsAt: tripScheduleDays.startsAt,
      endsAt: tripScheduleDays.endsAt,
    })
    .from(tripScheduleDays)
    .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
    .where(eq(trips.shopId, shopId));
  for (const [index, person] of staff.entries()) {
    const windows = assignments
      .filter((row) => row.personId === person.id)
      .flatMap((row) => {
        const days = meetings.filter((day) => day.tripId === row.tripId);
        return days.length ? days : [row];
      });
    const shifts = windows.map(({ startsAt, endsAt }) => ({
      startsAt: new Date(startsAt.getTime() - 30 * 60_000),
      endsAt: new Date(endsAt.getTime() + 30 * 60_000),
    }));
    const busyDays = new Set(shifts.flatMap((shift) => touchedDays(shift, DEMO_SHOP_TIMEZONE)));
    // A fortnight of ordinary shop work, with staggered rest days. A sailing
    // takes precedence in this fictional rota; never manufacture an absence
    // over a boat that another scenario has assigned to this person.
    for (let offset = -2; offset < 12; offset += 1) {
      const day = calendarDateInTimezone(at(offset, 8), DEMO_SHOP_TIMEZONE);
      if (busyDays.has(day)) continue;
      if ((offset + index + 7) % 7 < 2) {
        await db.insert(crewAvailabilityBlocks).values({
          shopId,
          personId: person.id,
          startsOn: day,
          endsOn: day,
          note: "Day off",
          createdByPersonId: person.id,
        });
      } else {
        shifts.push({ startsAt: at(offset, 8), endsAt: at(offset, 16) });
      }
    }
    shifts.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const merged: typeof shifts = [];
    for (const shift of shifts) {
      const previous = merged.at(-1);
      if (previous && previous.endsAt >= shift.startsAt) {
        if (shift.endsAt > previous.endsAt) previous.endsAt = shift.endsAt;
      } else merged.push({ ...shift });
    }
    if (merged.length)
      await db.insert(staffShifts).values(
        merged.map((shift) => ({
          ...shift,
          shopId,
          personId: person.id,
          createdByPersonId: person.id,
        })),
      );
  }
}

/** Half-open working interval, including padding that crosses local midnight. */
function touchedDays(window: { startsAt: Date; endsAt: Date }, timeZone: string): string[] {
  const last = calendarDateInTimezone(new Date(window.endsAt.getTime() - 1), timeZone);
  const days: string[] = [];
  for (
    let day = calendarDateInTimezone(window.startsAt, timeZone);
    day <= last;
    day = shiftCalendarDate(day, 1)
  )
    days.push(day);
  return days;
}
