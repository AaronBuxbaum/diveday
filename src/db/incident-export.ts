import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import {
  buildIncidentExport,
  type IncidentBuddyTeamEventInput,
  type IncidentBuddyTeamInput,
  type IncidentExportDocument,
  type IncidentTimelineEventInput,
} from "@/lib/incident-export";
import { canPersonExportIncidentRecord } from "./authz";
import { listTripBuddyTeamEvents, listTripBuddyTeams } from "./buddy-pairs";
import type { AppDb } from "./client";
import { listExecutedDives } from "./executed-dives";
import { getTripManifests } from "./manifests";
import { latestPreDepartureChecksForTrip, listChecklistItemsForTrip } from "./pre-departure-check";
import { listTripReadiness } from "./readiness";
import { bookings, people, rollCallCrewEvents, rollCallEvents } from "./schema";
import { getShopById } from "./shops";

/**
 * Assemble one departure's incident-ready export: the manifest roster, the
 * complete append-only roll-call history (corrections included — the document
 * never launders what was recorded), each diver's held certification evidence
 * and governing waiver *status*, crew, and generation metadata.
 *
 * Read-only, and tenant-scoped end to end: every query here carries `shopId`,
 * so another shop's trip id — or a generator who is not one of this shop's own
 * people — resolves to `null` and the route 404s. The evidence itself comes
 * from the same readers every safety surface uses (`getTripManifests`,
 * `listTripReadiness`), so this document cannot disagree with the manifest the
 * crew ran the day on.
 *
 * **Re-checks the owner-only gate itself** rather than trusting its caller, the
 * same way `createOrder` and `anonymizeDiver` re-check theirs (src/db/authz.ts).
 * The route above already refuses, so today this is belt and braces — but this
 * function assembles a whole departure's evidentiary record and stamps the
 * caller's name on it as its generator, and read-only-looking helpers acquire
 * callers: a PDF endpoint, a cron, an "email the insurer" action. "The route
 * forgot to check" must not be the thing standing between a captain and the
 * document (security review 20260804).
 */
export async function getIncidentExport(
  db: AppDb,
  shopId: string,
  tripId: string,
  generatedByPersonId: string,
  generatedAt: Date = nowDate(),
): Promise<IncidentExportDocument | null> {
  if (!(await canPersonExportIncidentRecord(db, shopId, generatedByPersonId))) return null;
  const manifests = await getTripManifests(db, shopId, tripId);
  if (!manifests || manifests.length === 0) return null;

  const recorders = alias(people, "recorders");
  const [shop, readinessRows, generator, diverEventRows, crewEventRows, executedDiveRows] =
    await Promise.all([
      getShopById(db, shopId),
      listTripReadiness(db, shopId, tripId, generatedAt),
      db
        .select({ fullName: people.fullName })
        .from(people)
        .where(and(eq(people.id, generatedByPersonId), eq(people.shopId, shopId)))
        .limit(1),
      // The full history, oldest first — not the latest-per-subject reduction
      // the live manifest shows. An incident document is the audit trail.
      db
        .select({ event: rollCallEvents, subject: people, recorder: recorders })
        .from(rollCallEvents)
        .innerJoin(bookings, eq(bookings.id, rollCallEvents.bookingId))
        .innerJoin(people, eq(people.id, bookings.personId))
        .innerJoin(recorders, eq(recorders.id, rollCallEvents.recordedByPersonId))
        .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId)))
        // `seq` last, for a reason sharper here than anywhere else: this
        // document is hashed, so two orderings of the same events produce two
        // different SHA-256 integrity codes for one departure. A tie on
        // transaction time would make the hash a coin toss.
        .orderBy(
          asc(rollCallEvents.occurredAt),
          asc(rollCallEvents.createdAt),
          asc(rollCallEvents.seq),
        ),
      db
        .select({ event: rollCallCrewEvents, subject: people, recorder: recorders })
        .from(rollCallCrewEvents)
        .innerJoin(people, eq(people.id, rollCallCrewEvents.personId))
        .innerJoin(recorders, eq(recorders.id, rollCallCrewEvents.recordedByPersonId))
        .where(and(eq(rollCallCrewEvents.shopId, shopId), eq(rollCallCrewEvents.tripId, tripId)))
        .orderBy(
          asc(rollCallCrewEvents.occurredAt),
          asc(rollCallCrewEvents.createdAt),
          asc(rollCallCrewEvents.seq),
        ),
      listExecutedDives(db, shopId, tripId),
    ]);
  if (!shop) return null;
  const generatedByName = generator[0]?.fullName;
  if (!generatedByName) return null;

  // A paper waiver and a certification review are accountable staff acts, not
  // anonymous completions. Resolve only the ids the governing evidence names,
  // and still tenant-scope the lookup: a malformed foreign id must never
  // become a name on this shop's owner-only incident document.
  const accountableStaffIds = new Set<string>();
  for (const row of readinessRows) {
    if (row.waiver?.signatureMethod === "in_person_attested" && row.waiver.recordedByPersonId) {
      accountableStaffIds.add(row.waiver.recordedByPersonId);
    }
    for (const card of [
      ...row.certifications,
      ...row.specialtyCertifications,
      ...row.nitroxCertifications,
    ]) {
      if (card.reviewedByPersonId) accountableStaffIds.add(card.reviewedByPersonId);
    }
  }
  const accountableStaff =
    accountableStaffIds.size === 0
      ? []
      : await db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          .where(and(eq(people.shopId, shopId), inArray(people.id, [...accountableStaffIds])));
  const accountableStaffNameById = new Map(
    accountableStaff.map((staff) => [staff.id, staff.fullName]),
  );

  const events: IncidentTimelineEventInput[] = [
    ...diverEventRows.map(({ event, subject, recorder }) => ({
      subjectKind: "diver" as const,
      subjectName: subject.fullName,
      checkpoint: event.checkpoint,
      status: event.status,
      source: event.source,
      recordedByName: recorder.fullName,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
    ...crewEventRows.map(({ event, subject, recorder }) => ({
      subjectKind: "crew" as const,
      subjectName: subject.fullName,
      checkpoint: event.checkpoint,
      status: event.status,
      source: event.source,
      recordedByName: recorder.fullName,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
  ];

  // The teams standing on this departure, plus the append-only trail behind
  // them. Read here rather than off the manifest, whose carried team is
  // deliberately reduced to names so the offline snapshot cannot carry enough
  // to compute a divergence off the boat. Team numbers come from this list's
  // own order (`createdAt`, then `pairId`), so they are stable across
  // regenerations and the content hash stays reproducible.
  //
  // A member whose seat was cancelled is dropped here for the same reason the
  // manifest drops them: this document states the pairing as it stood for the
  // people who were aboard, and the trail below is where a cancelled member's
  // membership survives.
  const [teamRows, teamEventRows, checklistItems, checklistChecks] = await Promise.all([
    listTripBuddyTeams(db, shopId, tripId),
    listTripBuddyTeamEvents(db, shopId, tripId),
    listChecklistItemsForTrip(db, shopId, tripId),
    latestPreDepartureChecksForTrip(db, shopId, tripId),
  ]);
  const buddyTeams: IncidentBuddyTeamInput[] = teamRows.map((team) => ({
    teamId: team.teamId,
    members: team.members.flatMap((member): IncidentBuddyTeamInput["members"][number][] =>
      member.kind === "crew"
        ? [{ kind: "crew", personId: member.personId, fullName: member.fullName }]
        : member.cancelled
          ? []
          : [{ kind: "diver", bookingId: member.bookingId, fullName: member.fullName }],
    ),
    recordedByName: team.recordedByName,
    recordedAt: team.createdAt,
  }));
  const buddyTeamEvents: IncidentBuddyTeamEventInput[] = teamEventRows.map((event) => ({
    teamId: event.teamId,
    action: event.action,
    memberNames: event.memberNames,
    recordedByName: event.recordedByName,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
  }));

  return buildIncidentExport({
    shop: {
      name: shop.name,
      slug: shop.slug,
      timezone: shop.timezone,
      depthUnit: shop.depthUnit,
    },
    manifests,
    diverEvidence: readinessRows.map((row) => ({
      bookingId: row.booking.id,
      certifications: row.certifications.map((card) => ({
        ...card,
        reviewedByName: card.reviewedByPersonId
          ? (accountableStaffNameById.get(card.reviewedByPersonId) ?? null)
          : null,
      })),
      specialtyCertifications: row.specialtyCertifications.map((card) => ({
        ...card,
        reviewedByName: card.reviewedByPersonId
          ? (accountableStaffNameById.get(card.reviewedByPersonId) ?? null)
          : null,
      })),
      nitroxCertifications: row.nitroxCertifications.map((card) => ({
        ...card,
        reviewedByName: card.reviewedByPersonId
          ? (accountableStaffNameById.get(card.reviewedByPersonId) ?? null)
          : null,
      })),
      // The governing record after the sign-once rule — the same resolution
      // the boarding gate reads, so "signed" here always means what it meant
      // at the dock.
      waiver: row.waiver,
      waiverRecordedByName: row.waiver?.recordedByPersonId
        ? (accountableStaffNameById.get(row.waiver.recordedByPersonId) ?? null)
        : null,
    })),
    events,
    executedDives: executedDiveRows.map(({ executed, actualSite, recorder }) => ({
      diveNumber: executed.diveNumber,
      actualSiteName: actualSite?.name ?? null,
      enteredAt: executed.enteredAt?.toISOString() ?? null,
      exitedAt: executed.exitedAt?.toISOString() ?? null,
      maxDepthMeters: executed.maxDepthMeters,
      observedConditions: executed.observedConditions,
      notRecorded: executed.notRecorded,
      recordedByName: recorder?.name ?? null,
      surfaceIntervalMinutes: null,
    })),
    buddyTeams,
    buddyTeamEvents,
    preDepartureCheck: checklistItems.map((item) => {
      const check = checklistChecks.get(item.id);
      return {
        label: item.label,
        check: check
          ? { occurredAt: check.occurredAt, recordedByName: check.recordedByName }
          : undefined,
      };
    }),
    generatedAt,
    generatedByName,
  });
}
