import { and, desc, eq, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { sightingWindowStart } from "@/lib/sightings";
import type { DbExecutor } from "./client";
import { diveSites, people, personRoles, tripSightings, trips } from "./schema";

/**
 * **A month of the crew's own log, on the two reefs the demo sells** — so
 * "Seen here this month" is a real beat on the seeded trip page rather than a
 * feature nobody can see.
 *
 * Without this the whole diver-facing half of the living reef ships inert:
 * `SiteSeen` renders nothing for a site with no log, which is correct and also
 * means no screenshot, no visual baseline, and a regression in it invisible to
 * reg-suit.
 *
 * **The numbers are deliberately not all of them.** A demo where every species
 * turned up on every departure would teach a shop exactly the wrong thing about
 * what this beat is: it is a frequency with a date on it, and the turtle showing
 * on one departure in three is the shape that makes that legible. So Molasses
 * reads two of three for the stingray and one of three for the turtle, and
 * French reads two of two for the nurse shark, which is the honest look of an
 * animal that genuinely is always there.
 *
 * **Every species here is one this shop could actually have tapped.** Five of
 * the six are on the site's own field guide, which is what the chip row offers
 * first; the green sea turtle is not on anybody's eight and stands for the
 * other door — the dive log's catalog-wide species select, which is where a
 * crew records the thing that was *not* the usual. A demo whose log is full of
 * animals its own chip row cannot reach would teach a shop the wrong thing
 * about where sightings come from.
 *
 * **Matched by site name and by the departure's own title**, the way
 * `seed-dive-intents.ts` matches by email: a past departure that dived Molasses
 * is one whose title says so, and re-ordering the history plan cannot silently
 * move a sighting onto a wreck charter. A trip or a site that is not there is
 * skipped rather than thrown on — this is additive demo colour and must never
 * be the reason a shop fails to seed.
 *
 * The rows are written directly rather than through `recordTripSighting`: the
 * seed already runs inside one transaction, the writer opens its own, and a
 * tally of three is one row with a count of three either way.
 */
const REEF_LOG: {
  site: string;
  /** The past departure's own title (`seed-history.ts`'s plan). */
  tripTitle: string;
  species: { slug: string; count: number }[];
}[] = [
  {
    site: "Molasses Reef",
    tripTitle: "Two-Tank Reef — Molasses & French",
    species: [
      { slug: "southern-stingray", count: 2 },
      { slug: "goliath-grouper", count: 1 },
    ],
  },
  {
    site: "Molasses Reef",
    tripTitle: "Night Dive — Molasses",
    species: [{ slug: "southern-stingray", count: 1 }],
  },
  {
    // The one that was not the usual, on the oldest departure in the window:
    // nobody's field guide promises a turtle, so this one came in through the
    // dive log's catalog-wide select rather than off a chip.
    site: "Molasses Reef",
    tripTitle: "Two-Tank Reef — Molasses",
    species: [{ slug: "green-sea-turtle", count: 1 }],
  },
  {
    site: "French Reef",
    tripTitle: "Two-Tank Reef — Molasses & French",
    species: [{ slug: "nurse-shark", count: 3 }],
  },
  {
    site: "French Reef",
    tripTitle: "Two-Tank Reef — French & Pickles",
    species: [
      { slug: "nurse-shark", count: 1 },
      { slug: "green-moray", count: 1 },
    ],
  },
];

export async function seedSightings(db: DbExecutor, shopId: string) {
  const now = nowDate();
  const since = sightingWindowStart(now);
  const [recorder] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!recorder) return;

  // Serial, never `Promise.all`: a drizzle transaction is one checked-out
  // client (`scripts/check-db-concurrency.mjs`).
  for (const entry of REEF_LOG) {
    const [site] = await db
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shopId), eq(diveSites.name, entry.site)))
      .limit(1);
    if (!site) continue;
    // The most recent departure by that name that has already sailed — the
    // same title is on today's board, and a sighting on a boat that has not
    // left yet would be a claim about a dive nobody has done.
    const [trip] = await db
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(
        and(eq(trips.shopId, shopId), eq(trips.title, entry.tripTitle), lt(trips.startsAt, now)),
      )
      .orderBy(desc(trips.startsAt))
      .limit(1);
    // A departure whose title matches but which sailed before the window has no
    // reader here, and seeding it would leave the demo's denominator
    // disagreeing with what the page shows.
    if (!trip || trip.startsAt < since) continue;
    // An hour after the boat left, which is when the crew is actually at the
    // rail between tanks — and what "last seen" then renders.
    const recordedAt = new Date(trip.startsAt.getTime() + 60 * 60 * 1000);
    await db.insert(tripSightings).values(
      entry.species.map((species) => ({
        shopId,
        tripId: trip.id,
        diveSiteId: site.id,
        diveSiteName: site.name,
        speciesSlug: species.slug,
        count: species.count,
        recordedByPersonId: recorder.id,
        recordedAt,
        updatedAt: recordedAt,
      })),
    );
  }
}
