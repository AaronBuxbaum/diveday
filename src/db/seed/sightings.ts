import { and, asc, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { sightingWindowStart } from "@/lib/sightings";
import type { DbExecutor } from "../client";
import {
  diveSites,
  executedDives,
  people,
  personRoles,
  shops,
  tripAssignments,
  tripSightings,
  trips,
} from "../schema";
import { livePublicTripForShop, notRehearsal } from "../trips-live";

/**
 * **A month of the crew's own log, on the two reefs the demo sells** — so
 * "Seen here in the last 30 days" is a real beat on the seeded trip page rather than a
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
 * records a stingray on more than one Molasses trip and a turtle on one,
 * while French carries repeated nurse-shark sightings. The denominators are
 * the actual logged dives at each site, including dives without a sighting.
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
 * `dive-intents.ts` matches by email: a past departure that dived Molasses
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
  /** The past departure's own title (`history.ts`'s plan). */
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
    // A crew member records the sighting after surfacing at that site.
    // Lean shops may not have a historical dive log, so retain the original
    // hour-after-departure fallback for those shapes.
    const [dive] = await db
      .select({ exitedAt: executedDives.exitedAt })
      .from(executedDives)
      .where(
        and(
          eq(executedDives.shopId, shopId),
          eq(executedDives.tripId, trip.id),
          eq(executedDives.actualSiteId, site.id),
        ),
      )
      .orderBy(executedDives.diveNumber)
      .limit(1);
    const [crew] = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, trip.id))
      .orderBy(asc(tripAssignments.tripRole), asc(people.fullName))
      .limit(1);
    const recordedAt = new Date(
      (dive?.exitedAt ?? trip.startsAt).getTime() + (dive?.exitedAt ? 3 : 60) * 60_000,
    );
    await db.insert(tripSightings).values(
      entry.species.map((species) => ({
        shopId,
        tripId: trip.id,
        diveSiteId: site.id,
        diveSiteName: site.name,
        speciesSlug: species.slug,
        count: species.count,
        recordedByPersonId: crew?.personId ?? recorder.id,
        recordedAt,
        updatedAt: recordedAt,
      })),
    );
  }
}

/**
 * **The month's shelf on the shopfront** ("What you might see in November")
 * names a species only after it turned up on two of that calendar month's
 * recorded departures, in any season. The 30-day log above gives it one nurse
 * shark; this adds the older Novembers' taps so the shelf shows four animals,
 * each logged on two to four departures, and none on all of them.
 */
const MONTH_LOG: { slug: string; departures: number[] }[] = [
  { slug: "southern-stingray", departures: [0, 1, 2, 5] },
  { slug: "nurse-shark", departures: [0, 3, 4] },
  { slug: "green-sea-turtle", departures: [1, 3, 6] },
  { slug: "goliath-grouper", departures: [2, 6] },
];

export async function seedMonthSightings(db: DbExecutor, shopId: string) {
  const now = nowDate();
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return;
  const month = sql`extract(month from ${trips.startsAt} at time zone ${shop.timezone}) = extract(month from ${now.toISOString()}::timestamptz at time zone ${shop.timezone})`;
  const candidates = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        livePublicTripForShop(shopId),
        notRehearsal(),
        lt(trips.startsAt, now),
        month,
        // The sightings specs start from the 30-day log's departures and the
        // dawn boat with an empty "Seen" box, and read each site's tally
        // there as one line, so the shelf's evidence goes on the others.
        notInArray(trips.title, [
          ...REEF_LOG.map((entry) => entry.tripTitle),
          "Dawn Two-Tank — Molasses Reef",
        ]),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(24);
  // A sighting is the crew's tap after a dive at that site, so only departures
  // with a logged dive and an assigned crew member can carry one.
  const usable: {
    tripId: string;
    siteId: string;
    siteName: string;
    recordedAt: Date;
    personId: string;
  }[] = [];
  for (const { id } of candidates) {
    const [dive] = await db
      .select({
        siteId: executedDives.actualSiteId,
        siteName: diveSites.name,
        exitedAt: executedDives.exitedAt,
      })
      .from(executedDives)
      .innerJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
      .where(and(eq(executedDives.shopId, shopId), eq(executedDives.tripId, id)))
      .orderBy(executedDives.diveNumber)
      .limit(1);
    const [crew] = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, id))
      .orderBy(asc(tripAssignments.tripRole), asc(people.fullName))
      .limit(1);
    if (!dive?.exitedAt || !crew || !dive.siteId) continue;
    usable.push({
      tripId: id,
      siteId: dive.siteId,
      siteName: dive.siteName,
      recordedAt: new Date(dive.exitedAt.getTime() + 3 * 60_000),
      personId: crew.personId,
    });
  }
  for (const { slug, departures } of MONTH_LOG) {
    for (const index of departures) {
      const trip = usable[index];
      if (!trip) continue;
      await db
        .insert(tripSightings)
        .values({
          shopId,
          tripId: trip.tripId,
          diveSiteId: trip.siteId,
          diveSiteName: trip.siteName,
          speciesSlug: slug,
          count: 1,
          recordedByPersonId: trip.personId,
          recordedAt: trip.recordedAt,
          updatedAt: trip.recordedAt,
        })
        .onConflictDoNothing();
    }
  }
}
