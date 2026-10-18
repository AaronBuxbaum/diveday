import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { AppDb } from "./client";
import { crewAwayByTrip } from "./crew-away";
import { type PublicCrewMember, tripPublicCrew } from "./trips-record";

/**
 * **The crew a diver is told about, each marked when they are away** (fourth
 * UX review, item 12, the diver's half): `tripPublicCrew`, with `away` true for
 * a member `crewAwayByTrip` names on this departure, the one place the rule
 * lives (issue #2676). Only the mark leaves this function, never the note or
 * the dates: why a person is away is their own business. Informs, never gates.
 */
export async function diverCrewWithAway(
  db: AppDb,
  shopId: string,
  trip: { id: string; startsAt: Date; endsAt: Date },
  timeZone: string,
): Promise<(PublicCrewMember & { away: boolean })[]> {
  // One round trip: the caller already holds the departure's window, and a
  // schedule day never falls outside it, so the days away are read for that
  // window beside the crew rather than after them (the diver pages' phase
  // budgets, `staff-render-cost.test.ts`).
  const [crew, awayByTrip] = await Promise.all([
    tripPublicCrew(db, shopId, trip.id),
    crewAwayByTrip(db, shopId, [trip.id], timeZone, {
      from: calendarDateInTimezone(trip.startsAt, timeZone),
      to: calendarDateInTimezone(trip.endsAt, timeZone),
    }),
  ]);
  if (crew.length === 0) return [];
  // A crew member a staffer said is working it anyway is not marked (#2678).
  const away = new Set(
    (awayByTrip.get(trip.id) ?? [])
      .filter((entry) => !entry.acknowledged)
      .map((entry) => entry.personId),
  );
  return crew.map((member) => ({ ...member, away: away.has(member.personId) }));
}
