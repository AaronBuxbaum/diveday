import { and, desc, eq, inArray } from "drizzle-orm";
import {
  type TripArrivalSnapshot,
  type TripChangeSnapshot,
  type TripConditionsSnapshot,
  type TripSitesSnapshot,
  tripChangeSnapshotsEqual,
  tripSitesSnapshot,
} from "@/lib/trip-change-events";
import type { AppDb, DbExecutor } from "./client";
import { diveSites, tripChangeEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type TripChangeKind = (typeof tripChangeEvents.kind.enumValues)[number];
export type TripChangeSource = (typeof tripChangeEvents.source.enumValues)[number];

export type TripChangeEvent = {
  id: string;
  tripId: string;
  kind: TripChangeKind;
  source: TripChangeSource;
  beforeValue: TripChangeSnapshot | null;
  afterValue: TripChangeSnapshot;
  occurredAt: Date;
  seq: number;
};

export async function recordTripChangeEvent(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    kind: TripChangeKind;
    source: TripChangeSource;
    beforeValue: TripArrivalSnapshot | TripConditionsSnapshot | TripSitesSnapshot | null;
    afterValue: TripArrivalSnapshot | TripConditionsSnapshot | TripSitesSnapshot;
    actorPersonId?: string | null;
    occurredAt?: Date;
  },
): Promise<void> {
  await db.insert(tripChangeEvents).values({
    shopId: input.shopId,
    tripId: input.tripId,
    kind: input.kind,
    source: input.source,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    actorPersonId: input.actorPersonId ?? null,
    occurredAt: input.occurredAt,
  });
}

/**
 * The site run a departure's plan names, exactly as the diver's "Planned
 * sites" row reads it: each dive's site in dive order, by name, repeats kept.
 * Not the trip's own site pointer, which the row never shows (review of
 * #3061, dde-b 1). A site the shop has since deleted keeps its name here, as
 * it did on the page when it was planned.
 */
export async function tripSiteRunSnapshot(
  db: DbExecutor,
  shopId: string,
  legSiteIds: readonly (string | null)[],
): Promise<TripSitesSnapshot> {
  const ordered = legSiteIds;
  const ids = [...new Set(ordered.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return tripSitesSnapshot([]);
  // No `deleted_at` filter: a deleted site keeps the name it was planned under.
  const rows = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), inArray(diveSites.id, ids)));
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return tripSitesSnapshot(ordered.map((id) => (id ? names.get(id) : null)));
}

/**
 * **A site change on the diver's ledger** (issue #3060, decided 2026-10-25):
 * one `site_change` entry when the run of sites the diver reads moved, written
 * by the caller inside the transaction that changed the dives. Nothing when
 * the run reads the same, so a save that only touched a price, a title or a
 * dive's own notes leaves the ledger alone.
 */
export async function recordSiteRunChange(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    before: TripSitesSnapshot;
    after: TripSitesSnapshot;
    actorPersonId?: string | null;
    occurredAt?: Date;
  },
): Promise<boolean> {
  if (tripChangeSnapshotsEqual(input.before, input.after)) return false;
  await recordTripChangeEvent(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    kind: "site_change",
    // The office's trip editor or the run's apply-to-every-date: the shop's
    // word, never the crew's from the dock.
    source: "shop",
    beforeValue: input.before,
    afterValue: input.after,
    actorPersonId: input.actorPersonId,
    occurredAt: input.occurredAt,
  });
  return true;
}

/** Publicly safe ledger rows, scoped through the owning live trip. */
export async function listTripChangeEvents(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripChangeEvent[]> {
  const rows = await db
    .select({ event: tripChangeEvents })
    .from(tripChangeEvents)
    .innerJoin(trips, eq(trips.id, tripChangeEvents.tripId))
    .where(
      and(
        eq(tripChangeEvents.shopId, shopId),
        eq(tripChangeEvents.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    // Keep the bounded read useful after a long-lived departure has had more
    // than twenty edits, then restore oldest-to-newest order for the reader.
    .orderBy(desc(tripChangeEvents.occurredAt), desc(tripChangeEvents.seq))
    .limit(20);
  return rows.reverse().map(({ event }) => ({
    id: event.id,
    tripId: event.tripId,
    kind: event.kind,
    source: event.source,
    beforeValue: event.beforeValue,
    afterValue: event.afterValue,
    occurredAt: event.occurredAt,
    seq: event.seq,
  }));
}
