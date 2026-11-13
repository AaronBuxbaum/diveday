import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import type { DbExecutor } from "./client";
import { crewCredentialSnapshot } from "./crew-credential-snapshot";
import { crewMarks } from "./roll-call-subject";
import {
  crewAvailabilityBlocks,
  people,
  personRoles,
  rollCallEvents,
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
  await db.delete(staffShifts).where(eq(staffShifts.shopId, shopId));
  await db.delete(crewAvailabilityBlocks).where(eq(crewAvailabilityBlocks.shopId, shopId));
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
  // The synthetic live boarding statements include the synthetic credential
  // evidence seen at that point. Offline statements intentionally remain
  // unknown: an offline client could not have read authoritative credentials.
  for (const person of staff)
    await db
      .update(rollCallEvents)
      .set({
        credentialSnapshot: crewCredentialSnapshot(shopId, person.id),
        credentialSnapshotStartedAt: sql`${rollCallEvents.occurredAt}`,
        credentialSnapshotCapturedAt: sql`${rollCallEvents.occurredAt}`,
      })
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          crewMarks(),
          eq(rollCallEvents.crewPersonId, person.id),
          eq(rollCallEvents.source, "live"),
          eq(rollCallEvents.checkpoint, "departure"),
          sql`coalesce(${rollCallEvents.statementStatus}, ${rollCallEvents.status}) = 'boarded'`,
          isNull(rollCallEvents.credentialSnapshot),
        ),
      );
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

/** Called only by the authenticated demo keeper, in its trip-move transaction.
 * Reconciles the moved trip's crew only; no production history or other crew's
 * shifts are touched. A demo absence spanning the new work day is split, not
 * discarded wholesale. Actual crew scheduling never uses this fixture repair.
 */
export async function reconcileDemoTripStaffRoster(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  window: { startsAt: Date; endsAt: Date },
  timeZone: string,
): Promise<void> {
  const crew = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId)));
  for (const { personId } of crew) {
    const shift = {
      startsAt: new Date(window.startsAt.getTime() - 30 * 60_000),
      endsAt: new Date(window.endsAt.getTime() + 30 * 60_000),
    };
    const existing = await db
      .select()
      .from(staffShifts)
      .where(and(eq(staffShifts.shopId, shopId), eq(staffShifts.personId, personId)));
    const overlapping = existing.filter(
      (row) => row.startsAt <= shift.endsAt && row.endsAt >= shift.startsAt,
    );
    for (const row of overlapping) {
      if (row.startsAt < shift.startsAt) shift.startsAt = row.startsAt;
      if (row.endsAt > shift.endsAt) shift.endsAt = row.endsAt;
    }
    if (overlapping.length)
      await db.delete(staffShifts).where(
        and(
          eq(staffShifts.shopId, shopId),
          inArray(
            staffShifts.id,
            overlapping.map((row) => row.id),
          ),
        ),
      );
    await db
      .insert(staffShifts)
      .values({ ...shift, shopId, personId, createdByPersonId: personId });
    const workedDays = new Set(touchedDays(shift, timeZone));
    const blocks = await db
      .select()
      .from(crewAvailabilityBlocks)
      .where(
        and(
          eq(crewAvailabilityBlocks.shopId, shopId),
          eq(crewAvailabilityBlocks.personId, personId),
          isNull(crewAvailabilityBlocks.deletedAt),
        ),
      );
    for (const block of blocks) {
      if (![...workedDays].some((day) => day >= block.startsOn && day <= block.endsOn)) continue;
      await db
        .delete(crewAvailabilityBlocks)
        .where(
          and(eq(crewAvailabilityBlocks.shopId, shopId), eq(crewAvailabilityBlocks.id, block.id)),
        );
      let start: string | null = null;
      for (
        let day = block.startsOn;
        day <= shiftCalendarDate(block.endsOn, 1);
        day = shiftCalendarDate(day, 1)
      ) {
        const remainsAway = day <= block.endsOn && !workedDays.has(day);
        if (remainsAway && start === null) start = day;
        if (!remainsAway && start !== null) {
          const { id: _id, ...rest } = block;
          await db
            .insert(crewAvailabilityBlocks)
            .values({ ...rest, startsOn: start, endsOn: shiftCalendarDate(day, -1) });
          start = null;
        }
      }
    }
  }
}
