import { and, asc, eq, gte, lte } from "drizzle-orm";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import type { TripStage } from "@/lib/trip-stages";
import { shopDayBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { people, tripAssignments, tripDives, tripStageEvents, trips } from "./schema";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { liveTrip } from "./trips-live";

/** Boarding opens this long before the lines come off. */
const BOARDING_OPENS_BEFORE_MS = 30 * MINUTE_MS;
/** A crew says `home` once the boat is tied up, a little after her return. */
const HOME_AFTER_RETURN_MS = 10 * MINUTE_MS;

/**
 * **The taps a crew would already have made on this departure, by `now`.**
 *
 * Every stamp is relative to the departure, never to the instant the seed ran:
 * boarding opens thirty minutes before she sails, `underway` is the moment she
 * leaves, and `home` comes a few minutes after her scheduled return. Only the
 * taps whose moment has passed are returned, so a boat five hours out carries
 * none at all. That is the fix for "Boarding since 1:18 PM" on a 6:30 PM boat
 * (UX review 2026-10-10, item 4): a word from the future, or a word said hours
 * before anyone could have said it, is not a word the crew said.
 */
export function demoStageTaps(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): { stage: TripStage; recordedAt: Date }[] {
  const taps: { stage: TripStage; recordedAt: Date }[] = [
    { stage: "boarding", recordedAt: new Date(startsAt.getTime() - BOARDING_OPENS_BEFORE_MS) },
    { stage: "underway", recordedAt: new Date(startsAt.getTime()) },
    { stage: "home", recordedAt: new Date(endsAt.getTime() + HOME_AFTER_RETURN_MS) },
  ];
  return taps.filter((tap) => tap.recordedAt.getTime() <= now.getTime());
}

/**
 * **The demo's boats say where they are** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 4.
 *
 * Every departure on the shop's day that has already reached a stage carries
 * the taps its crew would have made (`demoStageTaps`): the dawn boat that is
 * back reads boarding, underway and home; a boat out right now reads underway;
 * one within half an hour of sailing reads boarding; one later in the day
 * reads nothing yet, and its stepper falls back to the clock.
 *
 * **The taps are written once, as of the seed (or a reset), and never move
 * after it** (issue #2421). A crew's word is a row, not a clock, so a demo
 * seeded while the dawn boat was underway still says Underway after she is
 * back, until `liveStageOf` retires the word two hours past her end
 * (`STAGE_STALE_AFTER_MS`). Nothing re-runs this between resets: a pass once a
 * night could only add the words due at that one hour, and stamping taps
 * ahead of the clock would be words nobody has said yet.
 *
 * A tap is a thing a person did, so it is recorded by somebody on that boat:
 * the departure's own captain, else the first of its crew, and only for a
 * departure with no crew at all the shop's captain (`fallbackRecorderId`). The
 * site comes off the departure's own plan exactly as the writer would stamp it.
 */
export async function seedTripStage(
  db: DbExecutor,
  shopId: string,
  fallbackRecorderId: string,
): Promise<void> {
  const now = nowDate();
  const today = shopDayBounds(now, DEMO_SHOP_TIMEZONE);
  const departures = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, today.from),
        lte(trips.startsAt, new Date(now.getTime() + BOARDING_OPENS_BEFORE_MS)),
      ),
    )
    .orderBy(asc(trips.startsAt));

  for (const departure of departures) {
    const taps = demoStageTaps(departure.startsAt, departure.endsAt, now);
    if (taps.length === 0) continue;
    const [firstDive] = await db
      .select({ diveSiteId: tripDives.diveSiteId })
      .from(tripDives)
      .where(eq(tripDives.tripId, departure.id))
      .orderBy(asc(tripDives.diveNumber))
      .limit(1);
    // Ordered by name, never by id: a person id is random, so "the first of
    // its crew" would change from one seed to the next and the export
    // snapshot with it (it did, until the stack's CI caught it).
    const crew = await db
      .select({ personId: tripAssignments.personId, tripRole: tripAssignments.tripRole })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, departure.id))
      .orderBy(asc(people.fullName), asc(tripAssignments.personId));
    const recordedByPersonId =
      crew.find((member) => member.tripRole === "captain")?.personId ??
      crew[0]?.personId ??
      fallbackRecorderId;
    await db.insert(tripStageEvents).values(
      taps.map((tap) => ({
        shopId,
        tripId: departure.id,
        stage: tap.stage,
        // The departure's first site, as the writer stamps it; `home` names none.
        diveSiteId: tap.stage === "home" ? null : (firstDive?.diveSiteId ?? null),
        recordedByPersonId,
        recordedAt: tap.recordedAt,
      })),
    );
  }
}
