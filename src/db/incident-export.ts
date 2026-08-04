import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import {
  buildIncidentExport,
  type IncidentCrewCountInput,
  type IncidentExportDocument,
  type IncidentTimelineEventInput,
} from "@/lib/incident-export";
import type { AppDb } from "./client";
import { getTripManifests } from "./manifests";
import { listTripReadiness } from "./readiness";
import {
  bookings,
  people,
  rollCallCrewAttestations,
  rollCallCrewEvents,
  rollCallEvents,
} from "./schema";
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
 */
export async function getIncidentExport(
  db: AppDb,
  shopId: string,
  tripId: string,
  generatedByPersonId: string,
  generatedAt: Date = nowDate(),
): Promise<IncidentExportDocument | null> {
  const manifests = await getTripManifests(db, shopId, tripId);
  if (!manifests || manifests.length === 0) return null;

  const recorders = alias(people, "recorders");
  const [shop, readinessRows, generator, diverEventRows, crewEventRows, attestationRows] =
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
        .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.createdAt)),
      db
        .select({ event: rollCallCrewEvents, subject: people, recorder: recorders })
        .from(rollCallCrewEvents)
        .innerJoin(people, eq(people.id, rollCallCrewEvents.personId))
        .innerJoin(recorders, eq(recorders.id, rollCallCrewEvents.recordedByPersonId))
        .where(and(eq(rollCallCrewEvents.shopId, shopId), eq(rollCallCrewEvents.tripId, tripId)))
        .orderBy(asc(rollCallCrewEvents.occurredAt), asc(rollCallCrewEvents.createdAt)),
      db
        .select({ attestation: rollCallCrewAttestations, attester: people })
        .from(rollCallCrewAttestations)
        .innerJoin(people, eq(people.id, rollCallCrewAttestations.attestedByPersonId))
        .where(
          and(
            eq(rollCallCrewAttestations.shopId, shopId),
            eq(rollCallCrewAttestations.tripId, tripId),
          ),
        )
        .orderBy(asc(rollCallCrewAttestations.occurredAt), asc(rollCallCrewAttestations.createdAt)),
    ]);
  if (!shop) return null;
  const generatedByName = generator[0]?.fullName;
  if (!generatedByName) return null;

  const events: IncidentTimelineEventInput[] = [
    ...diverEventRows.map(({ event, subject, recorder }) => ({
      subjectKind: "diver" as const,
      subjectName: subject.fullName,
      checkpoint: event.checkpoint,
      status: event.status,
      source: event.source,
      recordedByName: recorder.fullName,
      note: event.note,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
    ...crewEventRows.map(({ event, subject, recorder }) => ({
      subjectKind: "crew" as const,
      subjectName: subject.fullName,
      checkpoint: event.checkpoint,
      status: event.status,
      // Crew events have no offline path; the live manifest is their one writer.
      source: "live" as const,
      recordedByName: recorder.fullName,
      note: event.note,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
  ];

  const crewCounts: IncidentCrewCountInput[] = attestationRows.map(({ attestation, attester }) => ({
    checkpoint: attestation.checkpoint,
    crewAboard: attestation.crewAboard,
    crewAssigned: attestation.crewAssigned,
    attestedByName: attester.fullName,
    note: attestation.note,
    occurredAt: attestation.occurredAt,
    createdAt: attestation.createdAt,
  }));

  return buildIncidentExport({
    shop: { name: shop.name, slug: shop.slug, timezone: shop.timezone },
    manifests,
    diverEvidence: readinessRows.map((row) => ({
      bookingId: row.booking.id,
      certifications: row.certifications,
      specialtyCertifications: row.specialtyCertifications,
      nitroxCertifications: row.nitroxCertifications,
      // The governing record after the sign-once rule — the same resolution
      // the boarding gate reads, so "signed" here always means what it meant
      // at the dock.
      waiver: row.waiver,
    })),
    events,
    crewCounts,
    generatedAt,
    generatedByName,
  });
}
