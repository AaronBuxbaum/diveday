import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type MonthSightings,
  type MonthSpeciesTally,
  rankMonthSightings,
} from "@/lib/month-sightings";
import { utcToWallTime } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { executedDives, tripSightings, trips } from "./schema";
import { livePublicTripForShop, notRehearsal } from "./trips-live";

/**
 * **What this shop's crews have logged in the current calendar month, across
 * every season** (batch 4, K4; the arithmetic is `src/lib/month-sightings.ts`).
 *
 * "The month" is the shop's own: a departure counts toward March when it left
 * in March on the shop's clock, whatever the server's timezone. Only
 * departures that have already left count, so a planned trip tomorrow adds
 * nothing to the evidence.
 *
 * **The denominator is every departure in that month that left a record** —
 * a dive in the crew's log, or a sighting. A quiet day writes nothing, so
 * counting only the departures with a sighting would make every species look
 * like it turned up every time; counting every scheduled departure would make
 * a shop whose crews rarely log read as a dead reef. Same rule, and the same
 * reasoning, as `siteSightings`.
 *
 * Deleted departures and rehearsals are not evidence of anything, and a
 * private charter is the client's day, not the storefront's.
 */
export async function monthSightings(
  db: DbExecutor,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<MonthSightings | null> {
  const month = utcToWallTime(now, timeZone).month;
  const inMonth = sql`extract(month from ${trips.startsAt} at time zone ${timeZone}) = ${month}`;
  const sailed = lt(trips.startsAt, now);

  const [logged, tapped, tallies] = await queryAll(db, [
    () =>
      db
        .selectDistinct({ tripId: executedDives.tripId })
        .from(executedDives)
        .innerJoin(trips, eq(trips.id, executedDives.tripId))
        .where(
          and(
            eq(executedDives.shopId, shopId),
            isNull(executedDives.deletedAt),
            livePublicTripForShop(shopId),
            notRehearsal(),
            sailed,
            inMonth,
          ),
        ),
    () =>
      db
        .selectDistinct({ tripId: tripSightings.tripId })
        .from(tripSightings)
        .innerJoin(trips, eq(trips.id, tripSightings.tripId))
        .where(
          and(
            eq(tripSightings.shopId, shopId),
            isNull(tripSightings.deletedAt),
            livePublicTripForShop(shopId),
            notRehearsal(),
            sailed,
            inMonth,
          ),
        ),
    () =>
      db
        .select({
          speciesSlug: tripSightings.speciesSlug,
          trips: sql<number>`count(distinct ${tripSightings.tripId})::int`,
        })
        .from(tripSightings)
        .innerJoin(trips, eq(trips.id, tripSightings.tripId))
        .where(
          and(
            eq(tripSightings.shopId, shopId),
            isNull(tripSightings.deletedAt),
            livePublicTripForShop(shopId),
            notRehearsal(),
            sailed,
            inMonth,
          ),
        )
        .groupBy(tripSightings.speciesSlug),
  ]);

  const recorded = new Set([...logged, ...tapped].map((row) => row.tripId));
  return rankMonthSightings({
    month,
    trips: recorded.size,
    tallies: tallies.map(
      (row): MonthSpeciesTally => ({ speciesSlug: row.speciesSlug, trips: Number(row.trips) }),
    ),
  });
}
