import { and, asc, desc, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { finalHomeSaid, tripPhaseOf } from "@/lib/trip-phase";
import type { DbExecutor } from "./client";
import { shops, tripScheduleDays, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * Departure definition closes when its final day is home. Reuse the page's
 * phase rule: an overnight Home on a multi-day course is not its final return,
 * a current late-running crew word beats the clock, and silence gets the
 * standing return buffer. Post-trip evidence (conservation, incidents and
 * executed dives) is separate from the plan and stays recordable.
 * Writers call this after taking the trip-row lock, also taken by stage taps.
 */
async function tripEditingState(db: DbExecutor, shopId: string, tripId: string, now = nowDate()) {
  const [trip] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, timeZone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return null;
  const [stage] = await db
    .select({ stage: tripStageEvents.stage, recordedAt: tripStageEvents.recordedAt })
    .from(tripStageEvents)
    .where(and(eq(tripStageEvents.shopId, shopId), eq(tripStageEvents.tripId, tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);
  const meetingWindows = await db
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId))
    .orderBy(asc(tripScheduleDays.dayNumber));
  const reading = { ...trip, stage: stage ?? null, meetingWindows, cancelled: false, now };
  return { planEditable: tripPhaseOf(reading) !== "back", finalHome: finalHomeSaid(reading) };
}

/** The plan closes by its existing phase; factual crew and safety evidence are separate. */
export async function tripDetailsAreEditable(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now = nowDate(),
): Promise<boolean> {
  return (await tripEditingState(db, shopId, tripId, now))?.planEditable ?? false;
}

/** The crew's final Home, never a conclusion drawn only from a scheduled return. */
export async function tripHasFinalHome(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now = nowDate(),
): Promise<boolean> {
  return (await tripEditingState(db, shopId, tripId, now))?.finalHome ?? false;
}
