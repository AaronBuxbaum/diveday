import { and, asc, eq, gt, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The next date of the same run**, for a diver whose seat on one occurrence
 * is gone (third UX review, item 16). A repeating departure ("every Saturday")
 * is one series of trips; the canceled page names the next one a stranger
 * could book from the public schedule: same shop, same series, still
 * scheduled, public, not yet started. Null for a one-off, or when the run has
 * no later date on the board.
 */
export async function nextPublicTripInSeries(
  db: AppDb,
  input: { shopId: string; tripId: string; now: Date },
): Promise<{ id: string; title: string; startsAt: Date } | null> {
  const [current] = await db
    .select({ seriesId: trips.seriesId })
    .from(trips)
    .where(and(eq(trips.shopId, input.shopId), eq(trips.id, input.tripId)))
    .limit(1);
  if (!current?.seriesId) return null;
  const [next] = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, input.shopId),
        eq(trips.seriesId, current.seriesId),
        ne(trips.id, input.tripId),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, input.now),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return next ?? null;
}
