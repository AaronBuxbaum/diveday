import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  shiftInstantByWallTimeDelta,
  utcToWallTime,
  wallTimeDeltaMs,
  wallTimeToUtc,
} from "@/lib/zoned";
import { realignTripLinkExpiry } from "../booking-capabilities";
import type { DbExecutor } from "../client";
import {
  boats,
  bookingArrivalEvents,
  demoPreviews,
  preDepartureCheckEvents,
  rollCallDeckCounts,
  rollCallEvents,
  shops,
  tripScheduleDays,
  tripStageEvents,
  trips,
} from "../schema";
import { liveTrip } from "../trips-live";

/**
 * **A preview's own day** (ADR 20261125-previews-wear-the-prospects-day): a
 * demo shop built for one prospect sails its upcoming day boats at the times
 * the prospect's boats leave, on hulls wearing the prospect's boat names. The
 * sample divers, bookings and stories stay as seeded; only the clock and the
 * boats' names change.
 *
 * Runs after the seed has written its day, at mint and after every reset of a
 * preview shop, because a reset re-seeds the sample times. The sample
 * scenarios find their boats by the sample names, so a reset first gives the
 * hulls those names back ({@link undressPreviewBoats}).
 */

/** The demo's two hulls, in the order a preview's boat names are worn. */
export const PREVIEW_SAMPLE_BOATS = ["Mantis I", "Mantis II"] as const;

/**
 * Day boats only: a departure seeded from 6 AM to 3:30 PM shop time. The dawn
 * boat, the sunset and night dives keep their hours, because their names say
 * when they sail.
 */
const DAY_BOAT_FROM_MINUTE = 6 * 60;
const DAY_BOAT_UNTIL_MINUTE = 15 * 60 + 30;
/** A departure moves to a time at most this far from its sample time. */
const FARTHEST_MOVE_MINUTES = 3 * 60;

export type PreviewDayTrip = {
  id: string;
  boatId: string | null;
  startsAt: Date;
  endsAt: Date;
  /** False keeps it where the sample put it: a course, a crew already counting, a boat already sailed. */
  movable: boolean;
};

export type PreviewDayMove = { id: string; startsAt: Date; endsAt: Date };

function minuteOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * Which departures move where. Each movable day boat that has not yet sailed
 * takes the prospect's time nearest its own on the same day, keeping its
 * length, unless that time has already passed or the hull would then be on
 * two departures at once; then it tries the next nearest, and otherwise
 * stays. Pure, so the rule is tested without a database.
 */
export function planPreviewDay(
  dayTrips: readonly PreviewDayTrip[],
  departureTimes: readonly string[],
  now: Date,
  timeZone: string,
): PreviewDayMove[] {
  if (departureTimes.length === 0) return [];
  const slots = departureTimes.map(minuteOf);
  const placed = new Map(
    dayTrips.map((trip) => [trip.id, { startsAt: trip.startsAt, endsAt: trip.endsAt }]),
  );
  const clashes = (trip: PreviewDayTrip, startsAt: Date, endsAt: Date) =>
    trip.boatId !== null &&
    dayTrips.some((other) => {
      if (other.id === trip.id || other.boatId !== trip.boatId) return false;
      const at = placed.get(other.id);
      return at !== undefined && at.startsAt < endsAt && startsAt < at.endsAt;
    });

  const moves: PreviewDayMove[] = [];
  const ordered = [...dayTrips].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const trip of ordered) {
    if (!trip.movable || trip.startsAt <= now) continue;
    const wall = utcToWallTime(trip.startsAt, timeZone);
    const minute = wall.hour * 60 + wall.minute;
    if (minute < DAY_BOAT_FROM_MINUTE || minute >= DAY_BOAT_UNTIL_MINUTE) continue;
    const candidates = slots
      .map((slot) => ({ slot, distance: Math.abs(slot - minute) }))
      .filter(({ distance }) => distance <= FARTHEST_MOVE_MINUTES)
      .sort((a, b) => a.distance - b.distance || a.slot - b.slot);
    for (const { slot } of candidates) {
      if (slot === minute) break;
      const target = { ...wall, hour: Math.floor(slot / 60), minute: slot % 60 };
      const startsAt = wallTimeToUtc(target, timeZone);
      const endsAt = shiftInstantByWallTimeDelta(
        trip.endsAt,
        wallTimeDeltaMs(wall, target),
        timeZone,
      );
      if (startsAt <= now || clashes(trip, startsAt, endsAt)) continue;
      placed.set(trip.id, { startsAt, endsAt });
      moves.push({ id: trip.id, startsAt, endsAt });
      break;
    }
  }
  return moves;
}

async function previewDressFor(db: DbExecutor, shopId: string) {
  const [preview] = await db
    .select({ departureTimes: demoPreviews.departureTimes, boatNames: demoPreviews.boatNames })
    .from(demoPreviews)
    .where(eq(demoPreviews.demoShopId, shopId))
    .limit(1);
  return preview ?? null;
}

/**
 * Before a preview shop is reset: its hulls take the sample names back, so the
 * re-seed finds them. Nothing for any other shop.
 */
export async function undressPreviewBoats(db: DbExecutor, shopId: string): Promise<void> {
  const dress = await previewDressFor(db, shopId);
  if (!dress) return;
  for (const [index, name] of dress.boatNames.slice(0, PREVIEW_SAMPLE_BOATS.length).entries()) {
    await db
      .update(boats)
      .set({ name: PREVIEW_SAMPLE_BOATS[index] })
      .where(and(eq(boats.shopId, shopId), eq(boats.name, name)));
  }
}

/** Trips whose departure already has a record against it: those stay at their seeded time. */
async function tripsWithRecords(db: DbExecutor, tripIds: string[]): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const reads = [
    // diveday:roll-call-both-subjects: any mark, a seat's or the crew's, means the count has begun.
    db
      .selectDistinct({ id: rollCallEvents.tripId })
      .from(rollCallEvents)
      .where(inArray(rollCallEvents.tripId, tripIds)),
    db
      .selectDistinct({ id: bookingArrivalEvents.tripId })
      .from(bookingArrivalEvents)
      .where(inArray(bookingArrivalEvents.tripId, tripIds)),
    db
      .selectDistinct({ id: rollCallDeckCounts.tripId })
      .from(rollCallDeckCounts)
      .where(inArray(rollCallDeckCounts.tripId, tripIds)),
    db
      .selectDistinct({ id: preDepartureCheckEvents.tripId })
      .from(preDepartureCheckEvents)
      .where(inArray(preDepartureCheckEvents.tripId, tripIds)),
    db
      .selectDistinct({ id: tripStageEvents.tripId })
      .from(tripStageEvents)
      .where(inArray(tripStageEvents.tripId, tripIds)),
  ];
  const found = new Set<string>();
  for (const read of reads) for (const row of await read) if (row.id) found.add(row.id);
  return found;
}

/**
 * Dress a preview shop in its prospect's day: the boats' names, then the
 * upcoming day boats at the prospect's departure times. Nothing for a shop
 * that is not a preview or a preview that keeps the sample day.
 */
export async function dressPreviewShop(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<void> {
  const dress = await previewDressFor(db, shopId);
  if (!dress) return;
  for (const [index, name] of dress.boatNames.slice(0, PREVIEW_SAMPLE_BOATS.length).entries()) {
    await db
      .update(boats)
      .set({ name })
      .where(and(eq(boats.shopId, shopId), eq(boats.name, PREVIEW_SAMPLE_BOATS[index])));
  }
  if (dress.departureTimes.length === 0) return;

  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return;
  const upcoming = await db
    .select({
      id: trips.id,
      boatId: trips.boatId,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      status: trips.status,
      courseId: trips.courseId,
    })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), liveTrip(), gt(trips.endsAt, now)));
  const ids = upcoming.map((trip) => trip.id);
  const recorded = await tripsWithRecords(db, ids);
  const days =
    ids.length === 0
      ? []
      : await db
          .select({ tripId: tripScheduleDays.tripId })
          .from(tripScheduleDays)
          .where(inArray(tripScheduleDays.tripId, ids));
  const dayCount = new Map<string, number>();
  for (const day of days) dayCount.set(day.tripId, (dayCount.get(day.tripId) ?? 0) + 1);

  const moves = planPreviewDay(
    upcoming.map((trip) => ({
      id: trip.id,
      boatId: trip.boatId,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      movable:
        trip.status === "scheduled" &&
        trip.courseId === null &&
        !recorded.has(trip.id) &&
        (dayCount.get(trip.id) ?? 0) <= 1,
    })),
    dress.departureTimes,
    now,
    shop.timezone,
  );
  const before = new Map(upcoming.map((trip) => [trip.id, trip]));
  for (const move of moves) {
    const was = before.get(move.id);
    if (!was) continue;
    await db
      .update(trips)
      .set({
        startsAt: move.startsAt,
        endsAt: move.endsAt,
        revision: sql`${trips.revision} + 1`,
      })
      .where(and(eq(trips.id, move.id), eq(trips.shopId, shopId)));
    // A day boat holds one schedule day, its own span: it moves with the trip.
    const startShift = move.startsAt.getTime() - was.startsAt.getTime();
    const endShift = move.endsAt.getTime() - was.endsAt.getTime();
    for (const day of await db
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, move.id))) {
      await db
        .update(tripScheduleDays)
        .set({
          startsAt: new Date(day.startsAt.getTime() + startShift),
          endsAt: new Date(day.endsAt.getTime() + endShift),
        })
        .where(eq(tripScheduleDays.id, day.id));
    }
    await realignTripLinkExpiry(db, { shopId, tripId: move.id, endsAt: move.endsAt, now });
  }
}
