import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  rankSiteSightings,
  type SiteSightings,
  type SiteSightingTally,
  sightingWindowStart,
} from "@/lib/sightings";
import { hasSailed } from "@/lib/trips";
import { type AppDb, type DbExecutor, queryAll } from "./client";
import { isMarineLifeSlug } from "./marine-life-catalog";
import {
  diveSiteCreatures,
  diveSites,
  executedDives,
  people,
  tripSightings,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The living reef** — what a crew saw, per departure and per site, and what a
 * month of that adds up to on a public trip page.
 *
 * Three things draw from the same catalog and mean different things.
 * `dive_site_creatures` is the shop's standing claim about a reef and is
 * written in the site editor. `executed_dives.observed_species_slug` is the one
 * species a divemaster wrote on a dive's own record, which reaches that day's
 * divers. This is the third: a running tally the crew builds by tapping, which
 * is the only one of the three a diver deciding on a Saturday can read as a
 * frequency.
 *
 * **Nothing here gates anything.** No readiness check, no admission check, no
 * roll-call state, nothing on the manifest's head count. A shop that never taps
 * a chip has a product that behaves exactly as it did.
 */

/** Why a tap did not land. Each one is a fact about the request, never about the reef. */
export type TripSightingRefusal =
  | "unknown_trip"
  | "unknown_site"
  | "unknown_recorder"
  | "unknown_species"
  | "not_sailed";

export type RecordTripSightingResult =
  | { ok: true; sighting: typeof tripSightings.$inferSelect }
  | { ok: false; reason: TripSightingRefusal };

/**
 * One tap: the first on a chip writes the row at one, every later one adds one
 * to it.
 *
 * **The species is refused, not dropped.** This is the opposite call from
 * `upsertExecutedDive`, and for the opposite reason: there, an unusable slug
 * degrades to null because a decoration must never cost the entry time, exit
 * time and max depth that `buildIncidentExport` seals for an investigator.
 * Here the slug *is* the record — there is nothing else in the row — so a slug
 * with no words to render is a row that would reach a public page as
 * punctuation, and the honest answer is to say no.
 *
 * **The catalog, not the site's field guide.** A guide is at most eight faces a
 * shop names because that reef shows them reliably; the reason anybody taps a
 * chip is that something turned up. Bounding a sighting to the guide would
 * admit the blue tang and refuse the eagle ray, which is exactly backwards
 * (the same correction `upsertExecutedDive` carries).
 *
 * The crew's sightings are lever V of ADR 20260908-one-hand, decision 6
 * (slice 20r): a record with a date, never a promise.
 */
export async function recordTripSighting(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    diveSiteId: string;
    speciesSlug: string;
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<RecordTripSightingResult> {
  if (!isMarineLifeSlug(input.speciesSlug)) return { ok: false, reason: "unknown_species" };
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<RecordTripSightingResult> => {
    const [trip] = await tx
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "unknown_trip" };
    // **A boat that has not left has seen nothing.** The surface does not offer
    // the group before departure, but the surface is not the boundary: a
    // checkpoint is a query parameter, and a sighting on a departure that is
    // still alongside would publish "seen here" for a dive nobody has done.
    // Same buffered hour every other "has it gone?" question uses, so a
    // departure that slips fifteen minutes for the tide does not change the
    // answer (`hasSailed`).
    if (!hasSailed(trip.startsAt, now)) return { ok: false, reason: "not_sailed" };
    // The site is re-proved against this shop rather than believed from the
    // form: it arrives as an id from a page the crew is looking at, and a
    // cross-tenant id would otherwise write one shop's log onto another shop's
    // reef and publish it there.
    const [site] = await tx
      .select({ id: diveSites.id, name: diveSites.name })
      .from(diveSites)
      .where(
        and(
          eq(diveSites.id, input.diveSiteId),
          eq(diveSites.shopId, input.shopId),
          isNull(diveSites.deletedAt),
        ),
      )
      .limit(1);
    if (!site) return { ok: false, reason: "unknown_site" };
    const [recorder] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (!recorder) return { ok: false, reason: "unknown_recorder" };
    // One statement, not select-then-increment. Two crew members tapping the
    // same chip in the same second is an ordinary sequence at the rail, and a
    // read followed by a write is not a lock: the loser would hit the partial
    // unique index and escape as a 500 on the manifest. `on conflict` targets
    // that index directly, so the second tap lands on the first one's row.
    const [row] = await tx
      .insert(tripSightings)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        diveSiteId: site.id,
        diveSiteName: site.name,
        speciesSlug: input.speciesSlug,
        count: 1,
        recordedByPersonId: recorder.id,
        recordedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tripSightings.tripId, tripSightings.diveSiteId, tripSightings.speciesSlug],
        targetWhere: isNull(tripSightings.deletedAt),
        set: {
          count: sql`${tripSightings.count} + 1`,
          // The site's name is re-snapshotted on every tap, so a rename between
          // two dives leaves the log reading the way the crew last saw it.
          diveSiteName: site.name,
          recordedByPersonId: recorder.id,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) return { ok: false, reason: "unknown_trip" };
    return { ok: true, sighting: row };
  });
}

/**
 * A mis-tap, taken back. Soft, like every delete here: the row stays and the
 * live unique index stops seeing it, so the next tap on that chip starts a
 * fresh tally at one rather than resurrecting a count the crew disowned.
 */
export async function deleteTripSighting(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    diveSiteId: string;
    speciesSlug: string;
    deletedByPersonId: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .update(tripSightings)
    .set({ deletedAt: now, deletedByPersonId: input.deletedByPersonId, updatedAt: now })
    .where(
      and(
        eq(tripSightings.shopId, input.shopId),
        eq(tripSightings.tripId, input.tripId),
        eq(tripSightings.diveSiteId, input.diveSiteId),
        eq(tripSightings.speciesSlug, input.speciesSlug),
        isNull(tripSightings.deletedAt),
      ),
    )
    .returning({ id: tripSightings.id });
  return Boolean(row);
}

/** One departure's tally, most-seen first — what the crew's own group renders. */
export async function listTripSightings(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select({
      id: tripSightings.id,
      diveSiteId: tripSightings.diveSiteId,
      diveSiteName: tripSightings.diveSiteName,
      speciesSlug: tripSightings.speciesSlug,
      count: tripSightings.count,
      recordedAt: tripSightings.recordedAt,
    })
    .from(tripSightings)
    .where(
      and(
        eq(tripSightings.shopId, shopId),
        eq(tripSightings.tripId, tripId),
        isNull(tripSightings.deletedAt),
      ),
    )
    .orderBy(desc(tripSightings.count), desc(tripSightings.recordedAt));
}

/**
 * **"Seen here this month"**, for every site a page is about.
 *
 * Batched over site ids because the caller is a trip page with a two-tank day
 * on it, and the one thing this read must never become is a query per site per
 * departure on a public page.
 *
 * **The window is anchored on the departure, not on the tap.** A crew that logs
 * the day at the next morning's close-out, or a shop correcting a week later,
 * would otherwise pull a Saturday dive into a window that should have dropped
 * it and date it to the day somebody typed. `trips.startsAt` is when the dive
 * happened, it is what the board says, and it is the only date a diver could
 * check the claim against.
 *
 * **The denominator is the wider of two records**, and that is the honest part.
 * The numerator is departures that logged a species here; the denominator is
 * departures that dived here and left *any* record — the crew's dive log, or a
 * sighting. Counting only departures with a sighting would make every species
 * look like it turned up every time, because a quiet day writes nothing.
 * Counting scheduled departures would do the reverse and read as a shop with a
 * dead reef, because most crews do not log at all.
 */
export async function siteSightings(
  db: DbExecutor,
  shopId: string,
  diveSiteIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, SiteSightings>> {
  const sites = [...new Set(diveSiteIds)];
  if (sites.length === 0) return new Map();
  const since = sightingWindowStart(now);

  const [logged, tapped, tallies] = await queryAll(db, [
    // Departures whose crew recorded a dive at this site in the window.
    () =>
      db
        .selectDistinct({ diveSiteId: executedDives.actualSiteId, tripId: executedDives.tripId })
        .from(executedDives)
        .innerJoin(trips, eq(trips.id, executedDives.tripId))
        .where(
          and(
            eq(executedDives.shopId, shopId),
            inArray(executedDives.actualSiteId, sites),
            isNull(executedDives.deletedAt),
            eq(trips.shopId, shopId),
            liveTrip(),
            gte(trips.startsAt, since),
          ),
        ),
    // Departures whose crew tapped a chip here, which is a record of a dive
    // even when nobody filled the log in.
    () =>
      db
        .selectDistinct({ diveSiteId: tripSightings.diveSiteId, tripId: tripSightings.tripId })
        .from(tripSightings)
        .innerJoin(trips, eq(trips.id, tripSightings.tripId))
        .where(
          and(
            eq(tripSightings.shopId, shopId),
            inArray(tripSightings.diveSiteId, sites),
            isNull(tripSightings.deletedAt),
            eq(trips.shopId, shopId),
            liveTrip(),
            gte(trips.startsAt, since),
          ),
        ),
    () =>
      db
        .select({
          diveSiteId: tripSightings.diveSiteId,
          speciesSlug: tripSightings.speciesSlug,
          dives: sql<number>`count(distinct ${tripSightings.tripId})::int`,
          total: sql<number>`sum(${tripSightings.count})::int`,
          lastSeenAt: sql<Date>`max(${trips.startsAt})`,
        })
        .from(tripSightings)
        .innerJoin(trips, eq(trips.id, tripSightings.tripId))
        .where(
          and(
            eq(tripSightings.shopId, shopId),
            inArray(tripSightings.diveSiteId, sites),
            isNull(tripSightings.deletedAt),
            eq(trips.shopId, shopId),
            liveTrip(),
            gte(trips.startsAt, since),
          ),
        )
        .groupBy(tripSightings.diveSiteId, tripSightings.speciesSlug),
  ]);

  const divesBySite = new Map<string, Set<string>>();
  for (const row of [...logged, ...tapped]) {
    if (!row.diveSiteId) continue;
    const seen = divesBySite.get(row.diveSiteId) ?? new Set<string>();
    seen.add(row.tripId);
    divesBySite.set(row.diveSiteId, seen);
  }
  const talliesBySite = new Map<string, SiteSightingTally[]>();
  for (const row of tallies) {
    const list = talliesBySite.get(row.diveSiteId) ?? [];
    list.push({
      speciesSlug: row.speciesSlug,
      dives: Number(row.dives),
      total: Number(row.total),
      // PGlite hands `max(timestamptz)` back as a Date; a driver that answers
      // with a string would otherwise reach a formatter as one.
      lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt : new Date(row.lastSeenAt),
    });
    talliesBySite.set(row.diveSiteId, list);
  }

  const answer = new Map<string, SiteSightings>();
  for (const diveSiteId of sites) {
    const ranked = rankSiteSightings({
      diveSiteId,
      dives: divesBySite.get(diveSiteId)?.size ?? 0,
      tallies: talliesBySite.get(diveSiteId) ?? [],
    });
    if (ranked) answer.set(diveSiteId, ranked);
  }
  return answer;
}

/**
 * One site's answer.
 *
 * The same read as `siteSightings` with one id in it, exported under its own
 * name because a public dive-site page is the obvious second reader and should
 * not have to know the batched shape — or, worse, write its own version of the
 * denominator rule.
 */
export async function siteSightingSummary(
  db: DbExecutor,
  shopId: string,
  diveSiteId: string,
  now: Date = nowDate(),
): Promise<SiteSightings | null> {
  return (await siteSightings(db, shopId, [diveSiteId], now)).get(diveSiteId) ?? null;
}

/**
 * Every species this shop has picked, on any of its sites, most-used first.
 *
 * The middle rung of the crew's chip row (`seenChipSlugs`): a two-tank day
 * often puts the boat on a site whose guide is empty while the shop next door
 * on the same reef has named a dozen faces, and the shop's own picks are a far
 * better guess at what its crews will tap than catalog order is.
 *
 * Live sites only — a species that reached this list solely through a site the
 * shop deleted is not the shop's list any more.
 */
export async function listShopPickedSpecies(db: DbExecutor, shopId: string): Promise<string[]> {
  const rows = await db
    .select({
      catalogSlug: diveSiteCreatures.catalogSlug,
      sites: sql<number>`count(distinct ${diveSiteCreatures.diveSiteId})::int`,
    })
    .from(diveSiteCreatures)
    .innerJoin(diveSites, eq(diveSites.id, diveSiteCreatures.diveSiteId))
    .where(
      and(
        eq(diveSiteCreatures.shopId, shopId),
        eq(diveSites.shopId, shopId),
        isNull(diveSites.deletedAt),
      ),
    )
    .groupBy(diveSiteCreatures.catalogSlug)
    .orderBy(
      desc(sql`count(distinct ${diveSiteCreatures.diveSiteId})`),
      asc(diveSiteCreatures.catalogSlug),
    );
  return rows.flatMap((row) => (row.catalogSlug ? [row.catalogSlug] : []));
}
