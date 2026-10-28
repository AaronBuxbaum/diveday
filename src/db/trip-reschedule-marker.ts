import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, tripScheduleDays, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * Preserve the first start divers have not yet been told about. Call only
 * inside an opted-in trip-write transaction, after its schedule days have
 * been shifted and while it still owns the exclusive revision fence and trip
 * row lock. The follow-up action creates/merges the held row after commit.
 *
 * Empty, rehearsal, and unreachable departures do not acquire a new notice
 * marker. An existing marker is left untouched so a later move cannot replace
 * an earlier time already owed to divers.
 */
export async function rememberUnnotifiedTripStart(
  tx: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    previousStartsAt: Date;
    now: Date;
  },
): Promise<void> {
  const [trip] = await tx
    .select({
      id: trips.id,
      startsAt: trips.startsAt,
      status: trips.status,
      diversToldStartsAt: trips.diversToldStartsAt,
    })
    .from(trips)
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (trip?.status !== "scheduled" || trip.diversToldStartsAt) return;

  // The schedule rows are already shifted with the trip. Use the latest
  // persisted day rather than a caller's pre-save snapshot.
  const [lastDay] = await tx
    .select({ startsAt: tripScheduleDays.startsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, input.tripId))
    .orderBy(desc(tripScheduleDays.startsAt))
    .limit(1);
  const sailsAt =
    lastDay?.startsAt && lastDay.startsAt > trip.startsAt ? lastDay.startsAt : trip.startsAt;
  if (sailsAt.getTime() <= input.now.getTime()) return;

  const [audience] = await tx
    .select({ count: count() })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        inArray(bookings.status, ["booked", "checked_in"]),
        isNull(people.deletedAt),
      ),
    );
  if ((audience?.count ?? 0) === 0) return;

  await tx
    .update(trips)
    .set({ diversToldStartsAt: input.previousStartsAt })
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        isNull(trips.diversToldStartsAt),
      ),
    );
}
