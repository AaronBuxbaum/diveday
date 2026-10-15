import { and, eq } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { overlappingBlocks } from "@/lib/crew-requests";
import type { AppDb } from "./client";
import { listCrewAvailabilityBlocks } from "./crew-requests";
import { trips } from "./schema";
import { liveTrip } from "./trips-live";
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
  tripId: string,
  timeZone: string,
): Promise<(PublicCrewMember & { away: boolean })[]> {
  const crew = await tripPublicCrew(db, shopId, tripId);
  if (crew.length === 0) return [];
  const [trip] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return [];
  const days = await listTripScheduleDays(db, shopId, tripId);
  const meetings =
    days.length > 0
      ? days.map((day) => ({ startsAt: day.startsAt, endsAt: day.endsAt }))
      : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
  const blocks = await listCrewAvailabilityBlocks(db, shopId, {
    from: calendarDateInTimezone(meetings[0]?.startsAt ?? trip.startsAt, timeZone),
    to: calendarDateInTimezone(meetings.at(-1)?.endsAt ?? trip.endsAt, timeZone),
  });
  return crew.map((member) => ({
    ...member,
    away: overlappingBlocks(blocks, member.personId, meetings, timeZone).length > 0,
  }));
}
