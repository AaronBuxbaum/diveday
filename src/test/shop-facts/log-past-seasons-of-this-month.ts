import { and, count, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { diveSites, tripSightings, trips } from "../../db/schema/index";
import { createTrip } from "../../db/trips";
import { calendarDateInTimezone } from "../../lib/calendar-date";
import { HOUR_MS } from "../../lib/clock";

/**
 * **Eight past seasons' worth of this month, logged** — one departure on the
 * same day of this month in each of eight earlier years, each with the species
 * its crew tapped. Green sea turtles on every one, southern stingrays on six,
 * nurse sharks on three: the shelf's three lines, in order. Idempotent by title.
 */
const PAST_SEASON_TITLE = "Two-Tank Reef — past season";
const PAST_SEASON_SPECIES = (season: number) => [
  "green-sea-turtle",
  ...(season < 6 ? ["southern-stingray"] : []),
  ...(season < 3 ? ["nurse-shark"] : []),
];

export async function logPastSeasonsOfThisMonth(
  db: AppDb,
  shopId: string,
  actorId: string,
  now: Date,
  timeZone: string,
): Promise<{ trips: number } | null> {
  const [already] = await db
    .select({ n: count() })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, PAST_SEASON_TITLE)));
  if ((already?.n ?? 0) > 0) return { trips: Number(already?.n) };
  const [site] = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .limit(1);
  if (!site) return null;
  const today = calendarDateInTimezone(now, timeZone);
  for (let season = 0; season < 8; season += 1) {
    // Midday on the 10th of this month, `season + 1` years back.
    const [year, month] = today.split("-").map(Number);
    const startsAt = new Date(Date.UTC(year - season - 1, month - 1, 10, 15));
    const trip = await createTrip(db, {
      shopId,
      title: PAST_SEASON_TITLE,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 8,
      dives: [{ diveSiteId: site.id }],
    });
    if (!trip) return null;
    await db.insert(tripSightings).values(
      PAST_SEASON_SPECIES(season).map((speciesSlug) => ({
        shopId,
        tripId: trip.id,
        diveSiteId: site.id,
        diveSiteName: site.name,
        speciesSlug,
        count: 1,
        recordedByPersonId: actorId,
      })),
    );
  }
  return { trips: 8 };
}
