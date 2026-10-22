import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "./client";
import { courses, diveSites, tripDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The record words the copywriter drafts from (`content-assist-actions.ts`):
 * a departure's title, mode and the sites its dives visit; a course's title,
 * agency and overview. Read in this shop only; null for no such live record.
 */

export async function tripWords(db: AppDb, shopId: string, tripId: string) {
  const [trip] = await db
    .select({ title: trips.title, diveMode: trips.diveMode })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return null;
  const dives = await db
    .select({ site: diveSites.name })
    .from(tripDives)
    .leftJoin(diveSites, and(eq(diveSites.id, tripDives.diveSiteId), isNull(diveSites.deletedAt)))
    .where(eq(tripDives.tripId, tripId));
  const sites = [...new Set(dives.flatMap((dive) => (dive.site ? [dive.site] : [])))];
  return { trip, sites, dives: dives.length };
}

export async function courseWords(db: AppDb, shopId: string, courseId: string) {
  const [course] = await db
    .select({ title: courses.title, agency: courses.agency, overview: courses.overview })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .limit(1);
  return course ?? null;
}
