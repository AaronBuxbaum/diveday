import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { AppDb } from "./client";
import { tripDives } from "./schema";

/** The first site any of a departure's dives names. */
export async function siteOfTrip(db: AppDb, tripId: string) {
  const [row] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(and(eq(tripDives.tripId, tripId), isNotNull(tripDives.diveSiteId)))
    .orderBy(asc(tripDives.diveNumber))
    .limit(1);
  return row?.diveSiteId ?? null;
}

/** Plan dive one of each of these departures at `siteId`. */
export async function planDiveOne(db: AppDb, tripIds: string[], siteId: string | null) {
  await db
    .insert(tripDives)
    .values(tripIds.map((tripId) => ({ tripId, diveNumber: 1, diveSiteId: siteId })));
}

/** Move dive one of an existing departure to `siteId`. */
export async function setDiveOneSite(db: AppDb, tripId: string, siteId: string | null) {
  await db
    .update(tripDives)
    .set({ diveSiteId: siteId })
    .where(and(eq(tripDives.tripId, tripId), eq(tripDives.diveNumber, 1)));
}
