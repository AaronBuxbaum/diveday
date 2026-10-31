import { sql } from "drizzle-orm";
import { tripDives, trips } from "./schema";

/**
 * **The site a departure is "at", when a surface can show only one**: the site
 * of the lowest-numbered dive that has one (ADR 20260719-trip-dive-briefings).
 *
 * `trip_dives` is the only place a planned site lives; this is a projection of
 * it, not a second copy, so it can never disagree with the itinerary. It is for
 * a coordinate, a calendar `LOCATION`, a card headline. A question about *which
 * sites a trip visits* (certification, depth, readiness) must look at every
 * dive, never at this.
 *
 * A correlated subquery over `trip_dives_trip_number_unique`; the outer query
 * must select from the `trips` table itself, not an alias.
 */
export const tripPrimarySiteId = sql<string | null>`(
  select ${tripDives.diveSiteId} from ${tripDives}
  where ${tripDives.tripId} = ${trips.id} and ${tripDives.diveSiteId} is not null
  order by ${tripDives.diveNumber}
  limit 1
)`;

/** True when some dive of the trip is planned at `siteId`: the multi-site-correct "trips at this site". */
export function tripVisitsSite(siteId: unknown) {
  return sql`exists (
    select 1 from ${tripDives}
    where ${tripDives.tripId} = ${trips.id} and ${tripDives.diveSiteId} = ${siteId}
  )`;
}
