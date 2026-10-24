import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { minorDeclaredOnLiveUpcomingSeat } from "@/lib/guardian";
import type { DbExecutor } from "./client";
import { bookings, trips } from "./schema";

/**
 * **The people a booker marked "Under 18" on a seat still ahead** (issue
 * #2553, Option A), for the person-scoped readers with no seat in hand: a
 * counter rental's waiver standing and the diver record's paper release. The
 * rule over the rows is `minorDeclaredOnLiveUpcomingSeat`; the diver record
 * applies it to the seats it already holds.
 *
 * Only stamped seats are read, so the query is as small as the stamp is rare.
 * Nothing here writes a date of birth.
 */
export async function peopleMinorDeclared(
  db: DbExecutor,
  input: { shopId: string; personIds: readonly string[]; now: Date },
): Promise<Set<string>> {
  const declared = new Set<string>();
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return declared;
  const seats = await db
    .select({
      personId: bookings.personId,
      status: bookings.status,
      minorDeclaredAt: bookings.minorDeclaredAt,
      trip: { deletedAt: trips.deletedAt, status: trips.status, endsAt: trips.endsAt },
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(bookings.personId, personIds),
        isNotNull(bookings.minorDeclaredAt),
      ),
    );
  for (const seat of seats) {
    if (minorDeclaredOnLiveUpcomingSeat([seat], input.now)) declared.add(seat.personId);
  }
  return declared;
}
