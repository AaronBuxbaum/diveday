import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  observedWords,
  type SiteHistory,
  type SiteHistoryRecord,
  siteHistoryOf,
} from "@/lib/site-history";
import type { DbExecutor } from "./client";
import { diveSites, executedDives, people, tripDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

const actualSite = alias(diveSites, "actual_site");

/**
 * **What each planned site was like the last time a boat went** (fifth-loop
 * ideas, item 6): for every site id, the newest earlier executed dive there,
 * or the newest earlier departure that planned it and went elsewhere,
 * whichever is later (`siteHistoryOf`). Sites never dived are absent.
 *
 * Earlier means a live departure of this shop that started before `before`,
 * never `excludeTripId` itself, so a departure's own log never reads back as
 * its history. Two reads, each one row per site (`distinct on`).
 */
export async function lastAtSites(
  db: DbExecutor,
  input: { shopId: string; siteIds: readonly string[]; before: Date; excludeTripId: string },
): Promise<Map<string, SiteHistory>> {
  const siteIds = [...new Set(input.siteIds)];
  if (siteIds.length === 0) return new Map();
  const earlier = and(
    eq(trips.shopId, input.shopId),
    lt(trips.startsAt, input.before),
    ne(trips.id, input.excludeTripId),
    liveTrip(),
  );
  const divedAt = sql<Date>`coalesce(${executedDives.enteredAt}, ${trips.startsAt})`.mapWith(
    trips.startsAt,
  );
  const [dived, movedAway] = await Promise.all([
    db
      .selectDistinctOn([executedDives.actualSiteId], {
        siteId: executedDives.actualSiteId,
        divedAt,
        recordedByName: people.fullName,
        conditions: executedDives.observedConditions,
        actualSiteName: actualSite.name,
      })
      .from(executedDives)
      .innerJoin(trips, eq(trips.id, executedDives.tripId))
      .innerJoin(actualSite, eq(actualSite.id, executedDives.actualSiteId))
      .leftJoin(people, eq(people.id, executedDives.recordedByPersonId))
      .where(
        and(
          eq(executedDives.shopId, input.shopId),
          isNull(executedDives.deletedAt),
          inArray(executedDives.actualSiteId, siteIds),
          earlier,
        ),
      )
      .orderBy(executedDives.actualSiteId, desc(divedAt), desc(executedDives.diveNumber)),
    db
      .selectDistinctOn([tripDives.diveSiteId], {
        siteId: tripDives.diveSiteId,
        divedAt,
        recordedByName: people.fullName,
        conditions: executedDives.observedConditions,
        actualSiteName: actualSite.name,
      })
      .from(tripDives)
      .innerJoin(trips, eq(trips.id, tripDives.tripId))
      .innerJoin(
        executedDives,
        and(
          eq(executedDives.tripId, tripDives.tripId),
          eq(executedDives.diveNumber, tripDives.diveNumber),
          eq(executedDives.shopId, input.shopId),
          isNull(executedDives.deletedAt),
        ),
      )
      .innerJoin(actualSite, eq(actualSite.id, executedDives.actualSiteId))
      .leftJoin(people, eq(people.id, executedDives.recordedByPersonId))
      .where(
        and(
          inArray(tripDives.diveSiteId, siteIds),
          isNotNull(executedDives.actualSiteId),
          ne(executedDives.actualSiteId, tripDives.diveSiteId),
          earlier,
        ),
      )
      .orderBy(tripDives.diveSiteId, desc(divedAt), desc(tripDives.diveNumber)),
  ]);
  const record = (row: (typeof dived)[number]): SiteHistoryRecord => ({
    divedAt: row.divedAt,
    recordedByName: row.recordedByName,
    visibility: observedWords(row.conditions?.visibility),
    current: observedWords(row.conditions?.current),
    actualSiteName: row.actualSiteName,
  });
  const divedBySite = new Map(dived.map((row) => [row.siteId, record(row)]));
  const movedBySite = new Map(movedAway.map((row) => [row.siteId, record(row)]));
  const history = new Map<string, SiteHistory>();
  for (const siteId of siteIds) {
    const last = siteHistoryOf({
      dived: divedBySite.get(siteId) ?? null,
      movedAway: movedBySite.get(siteId) ?? null,
    });
    if (last) history.set(siteId, last);
  }
  return history;
}
