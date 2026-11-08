import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { trips } from "../../db/schema/index";
import { createTrip } from "../../db/trips";
import { seatDiver } from "../../features/seat-diver/store";
import { HOUR_MS } from "../../lib/clock";

/**
 * **A rehearsal tomorrow, with one test diver seated by staff** (ADR
 * 20261012-rehearsal-departures). Through the real doors: `createTrip` makes it
 * private and unpriced, and `seatDiver` is the staff seat. Idempotent by title.
 */
const REHEARSAL_TITLE = "Training day drill";

export async function putARehearsalOnTomorrow(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
  now: Date,
): Promise<{ tripId: string } | null> {
  const [existing] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, REHEARSAL_TITLE),
        eq(trips.isRehearsal, true),
        isNull(trips.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return { tripId: existing.id };
  const startsAt = new Date(now.getTime() + 24 * HOUR_MS);
  const trip = await createTrip(db, {
    shopId,
    title: REHEARSAL_TITLE,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS),
    capacity: 6,
    isRehearsal: true,
  });
  if (!trip) return null;
  await seatDiver(db, {
    shopId,
    tripId: trip.id,
    actorPersonId,
    diver: { fullName: "Test Diver" },
    entry: "roster",
    refusals: "coarse",
  });
  return { tripId: trip.id };
}
