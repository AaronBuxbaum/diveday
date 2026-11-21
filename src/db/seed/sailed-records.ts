import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { rollCallCheckpoints } from "@/lib/roll-call";
import type { DbExecutor } from "../client";
import { crewMarks } from "../roll-call-subject";
import {
  diveSites,
  executedDives,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  rollCallEvents,
  tripAssignments,
  tripDives,
  trips,
} from "../schema";
import { sailedTripShape } from "./history";
import { type SeedRollCallEvidenceInput, seedRollCallEvidence } from "./roll-call-evidence";

/** A completed working day: its two sites, dive log, checks, and crew counts. */
export async function seedSailedRecords(db: DbExecutor, shopId: string): Promise<void> {
  const history = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        isNull(trips.deletedAt),
      ),
    )
    .orderBy(asc(trips.startsAt));
  if (!history.length) return;
  const tripIds = history.map((trip) => trip.id);
  const sites = await db
    .select({ id: diveSites.id, name: diveSites.name, maxDepth: diveSites.maxDepthMeters })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)));
  const siteByName = new Map(sites.map((site) => [site.name, site]));
  const plan = await db
    .select()
    .from(tripDives)
    .where(inArray(tripDives.tripId, tripIds))
    .orderBy(asc(tripDives.diveNumber));
  const crew = await db
    .select()
    .from(tripAssignments)
    .where(inArray(tripAssignments.tripId, tripIds));
  const existingCounts = await db
    .select({
      tripId: rollCallEvents.tripId,
      personId: rollCallEvents.crewPersonId,
      checkpoint: rollCallEvents.checkpoint,
    })
    .from(rollCallEvents)
    .where(
      and(eq(rollCallEvents.shopId, shopId), crewMarks(), inArray(rollCallEvents.tripId, tripIds)),
    );
  const recorded = new Set(
    existingCounts.map(({ tripId, personId, checkpoint }) =>
      JSON.stringify([tripId, personId, checkpoint]),
    ),
  );
  const checklist = await db
    .select({ id: preDepartureChecklistItems.id })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, shopId),
        isNull(preDepartureChecklistItems.deletedAt),
      ),
    )
    .orderBy(asc(preDepartureChecklistItems.sortOrder));

  const logs: (typeof executedDives.$inferInsert)[] = [];
  const checks: (typeof preDepartureCheckEvents.$inferInsert)[] = [];
  const counts: SeedRollCallEvidenceInput[] = [];
  const siteCorrections = new Map<string, string[]>();
  for (const trip of history) {
    const members = crew.filter((member) => member.tripId === trip.id);
    const recorder =
      members.find((member) => member.tripRole === "captain")?.personId ?? members[0]?.personId;
    if (!recorder) throw new Error(`seed: no crew on sailed trip ${trip.title}`);
    const tripPlan = plan.filter((dive) => dive.tripId === trip.id);
    const secondPlace = trip.title.split(" — ")[1]?.split(" & ")[1];
    const secondSite = secondPlace
      ? siteByName.get(sailedTripShape(`Reef Day — ${secondPlace}`).site)
      : undefined;
    for (const dive of tripPlan) {
      const site =
        dive.diveNumber === 2 && secondSite
          ? secondSite
          : sites.find((item) => item.id === dive.diveSiteId);
      if (!site) throw new Error(`seed: missing site for ${trip.title}`);
      if (site.id !== dive.diveSiteId)
        siteCorrections.set(site.id, [...(siteCorrections.get(site.id) ?? []), dive.id]);
      // The existing after-dive counts are +90 and +180 minutes. Enter 55
      // minutes before the count, surface five minutes before it.
      const countAt = trip.startsAt.getTime() + dive.diveNumber * 90 * 60_000;
      const recordedAt = new Date(trip.endsAt.getTime() + 10 * 60_000);
      logs.push({
        shopId,
        tripId: trip.id,
        diveNumber: dive.diveNumber,
        actualSiteId: site.id,
        enteredAt: new Date(countAt - 55 * 60_000),
        exitedAt: new Date(countAt - 5 * 60_000),
        maxDepthMeters: Math.min(site.maxDepth ?? 18, dive.diveNumber === 1 ? 15 : 11),
        recordedByPersonId: recorder,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
    }
    checklist.forEach((item, index) => {
      const occurredAt = new Date(trip.startsAt.getTime() - (15 - index) * 60_000);
      checks.push({
        shopId,
        tripId: trip.id,
        checklistItemId: item.id,
        recordedByPersonId: recorder,
        status: "checked",
        occurredAt,
        createdAt: occurredAt,
      });
    });
    for (const member of members) {
      rollCallCheckpoints(trip.plannedDives).forEach((checkpoint, index) => {
        if (recorded.has(JSON.stringify([trip.id, member.personId, checkpoint]))) return;
        const occurredAt = new Date(trip.startsAt.getTime() + index * 90 * 60_000);
        counts.push({
          shopId,
          tripId: trip.id,
          subjectKind: "crew",
          crewPersonId: member.personId,
          recordedByPersonId: recorder,
          status: "boarded",
          checkpoint,
          source: "live",
          occurredAt,
          createdAt: occurredAt,
        });
      });
    }
  }
  for (const [siteId, ids] of siteCorrections) {
    await db.update(tripDives).set({ diveSiteId: siteId }).where(inArray(tripDives.id, ids));
  }
  if (logs.length) await db.insert(executedDives).values(logs);
  if (checks.length) await db.insert(preDepartureCheckEvents).values(checks);
  // Keep any evidence authored by an earlier demo scenario, including its
  // fictional credential snapshots, instead of writing a second crew mark.
  await seedRollCallEvidence(db, counts, { observesPrevious: false });
}
