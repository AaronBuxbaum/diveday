import { calendarDateInTimezone } from "@/lib/calendar-date";
import { overlappingBlocks } from "@/lib/crew-requests";
import type { AppDb } from "./client";
import { listCrewAvailabilityBlocks } from "./crew-requests";
import { listTripScheduleDays, type PublicCrewMember, tripPublicCrew } from "./trips-record";

/**
 * **The crew a diver is told about, each marked when they are away** (fourth
 * UX review, item 12, the diver's half): `tripPublicCrew`, with `away` true for
 * a member whose days away (`crew_availability_blocks`) cover a day this
 * departure meets on. The rule is the staffing week's (`overlappingBlocks`,
 * ADR 20260902-crew-requests-and-blackouts): the schedule days when the
 * departure has them, else its own window, as calendar days in the shop's
 * zone. Only the mark leaves this function, never the note or the dates: why
 * a person is away is their own business. Informs, never gates.
 */
export async function diverCrewWithAway(
  db: AppDb,
  shopId: string,
  trip: { id: string; startsAt: Date; endsAt: Date },
  timeZone: string,
): Promise<(PublicCrewMember & { away: boolean })[]> {
  // One round trip: the caller already holds the departure's window, and a
  // schedule day never falls outside it, so the days away are read for that
  // window beside the crew and the days rather than after them (the diver
  // pages' phase budgets, `staff-render-cost.test.ts`).
  const [crew, days, blocks] = await Promise.all([
    tripPublicCrew(db, shopId, trip.id),
    listTripScheduleDays(db, shopId, trip.id),
    listCrewAvailabilityBlocks(db, shopId, {
      from: calendarDateInTimezone(trip.startsAt, timeZone),
      to: calendarDateInTimezone(trip.endsAt, timeZone),
    }),
  ]);
  if (crew.length === 0) return [];
  const meetings =
    days.length > 0
      ? days.map((day) => ({ startsAt: day.startsAt, endsAt: day.endsAt }))
      : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
  return crew.map((member) => ({
    ...member,
    away: overlappingBlocks(blocks, member.personId, meetings, timeZone).length > 0,
  }));
}
