import { and, count, eq, gt, inArray, lte, notInArray, sql } from "drizzle-orm";
import {
  BLOWOUT_MAX_OFFERS,
  BLOWOUT_OFFER_HORIZON_DAYS,
  type BlowoutDiverContext,
  compareBlowoutOffers,
  qualifyingAlternatives,
} from "@/lib/blowout";
import { departureUnderway } from "@/lib/day-blowout";
import { departureMayBeAtSea } from "./aboard-at-sea";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { getTripRequirements, getTripSiteRequirement } from "./readiness";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { seatNotCancelled, tripSellableSeatsSql } from "./trips-queries";
import { rollCallStartedOn } from "./trips-record";

/** Offers are current booking links, never a reservation of a seat or a pool. */
async function offerRows(
  db: DbExecutor,
  shopId: string,
  now: Date,
  excluded: readonly string[] = [],
) {
  return db
    .select({
      trip: trips,
      sellableCapacity: tripSellableSeatsSql(),
      activeBookings: count(bookings.id),
      activeDivers:
        sql<number>`count(*) filter (where ${bookings.participantType} = 'diver')`.mapWith(Number),
      started: rollCallStartedOn(trips.id),
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(eq(bookings.tripId, trips.id), eq(bookings.shopId, shopId), seatNotCancelled),
    )
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        lte(trips.startsAt, new Date(now.getTime() + BLOWOUT_OFFER_HORIZON_DAYS * 86400000)),
        excluded.length ? notInArray(trips.id, [...excluded]) : undefined,
      ),
    )
    .groupBy(trips.id);
}

/** Only this shop's existing non-course shore/pool ids can become durable preference intent. */
export async function scopedNonBoatPreferenceIds(
  db: DbExecutor,
  shopId: string,
  submitted: readonly string[],
  excluded: readonly string[],
): Promise<string[] | null> {
  if (!submitted.length) return [];
  const unique = [...new Set(submitted)];
  const rows = await db
    .select({
      id: trips.id,
      diveMode: trips.diveMode,
      courseId: trips.courseId,
      deletedAt: trips.deletedAt,
    })
    .from(trips)
    // diveday:allow-deleted-trips: a stale own choice is omitted; a foreign id must refuse before cancellation.
    .where(and(eq(trips.shopId, shopId), inArray(trips.id, unique)));
  if (rows.length !== unique.length) return null;
  const valid = new Set(
    rows
      .filter(
        (row) =>
          !row.deletedAt &&
          !row.courseId &&
          (row.diveMode === "shore" || row.diveMode === "pool") &&
          !excluded.includes(row.id),
      )
      .map((row) => row.id),
  );
  return unique.filter((id) => valid.has(id));
}

/** Same-call exclusions survive resumption; never store foreign source identities. */
export async function scopedWeatherCallTripIds(
  db: DbExecutor,
  shopId: string,
  submitted: readonly string[],
) {
  if (!submitted.length) return [];
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), inArray(trips.id, [...submitted]), liveTrip()));
  return rows.map((row) => row.id);
}

export type NonBoatOfferOption = {
  id: string;
  title: string;
  startsAt: Date;
  diveMode: "shore" | "pool";
  available: number;
};
/** The staff picker's options; diver-specific admission is rechecked at send and final booking. */
export async function listNonBoatOfferOptions(
  db: DbExecutor,
  shopId: string,
  now: Date,
  excluded: readonly string[] = [],
): Promise<NonBoatOfferOption[]> {
  const rows = await offerRows(db, shopId, now, excluded);
  const options: NonBoatOfferOption[] = [];
  for (const row of rows) {
    if (
      row.trip.courseId ||
      (row.trip.diveMode !== "shore" && row.trip.diveMode !== "pool") ||
      row.activeBookings >= row.sellableCapacity ||
      departureUnderway({ startsAt: row.trip.startsAt, rollCallStarted: Boolean(row.started) }, now)
    )
      continue;
    if (
      await departureMayBeAtSea(db, {
        shopId,
        tripId: row.trip.id,
        startsAt: row.trip.startsAt,
        now,
      })
    )
      continue;
    options.push({
      id: row.trip.id,
      title: row.trip.title,
      startsAt: row.trip.startsAt,
      diveMode: row.trip.diveMode,
      available: row.sellableCapacity - row.activeBookings,
    });
  }
  return options.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

/** Live resources/requirements per recipient; lazy admission reads stop after the existing three-offer cap. */
export async function currentBlowoutOffers(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    now: Date;
    diver: BlowoutDiverContext;
    preferredTripIds: readonly string[];
    alsoCalled: readonly string[];
  },
) {
  const rows = await offerRows(db, input.shopId, input.now, [input.tripId, ...input.alsoCalled]);
  rows.sort((a, b) => compareBlowoutOffers(a.trip, b.trip, input.preferredTripIds));
  const offers: { id: string; title: string; startsAt: Date }[] = [];
  for (const row of rows) {
    if (
      row.trip.courseId ||
      departureUnderway(
        { startsAt: row.trip.startsAt, rollCallStarted: Boolean(row.started) },
        input.now,
      )
    )
      continue;
    if (
      await departureMayBeAtSea(db, {
        shopId: input.shopId,
        tripId: row.trip.id,
        startsAt: row.trip.startsAt,
        now: input.now,
      })
    )
      continue;
    const [requirement, siteRequirement] = await queryAll(db, [
      () => getTripRequirements(db, input.shopId, row.trip.id),
      () => getTripSiteRequirement(db, input.shopId, row.trip.id),
    ]);
    const candidate = {
      ...row.trip,
      capacity: row.sellableCapacity,
      activeBookings: row.activeBookings,
      activeDivers: row.activeDivers,
      courseSession: Boolean(row.trip.courseId),
      requirement,
      siteRequirement,
    };
    if (
      !qualifyingAlternatives({
        cancelledTripId: input.tripId,
        now: input.now,
        candidates: [candidate],
        diver: input.diver,
      }).length
    )
      continue;
    offers.push({ id: row.trip.id, title: row.trip.title, startsAt: row.trip.startsAt });
    if (offers.length >= BLOWOUT_MAX_OFFERS) break;
  }
  return offers;
}
