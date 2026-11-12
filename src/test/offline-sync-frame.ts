import { buildTripManifest } from "@/lib/manifests";
import {
  type OfflineArrivalEvent,
  type OfflineChecklistEvent,
  type OfflineManifestPayload,
  type OfflineManifestUpcomingResponse,
  type OfflineRollCallEvent,
  offlineSnapshotTokenClaims,
} from "@/lib/offline-manifests";
import { unavailableReadiness } from "@/lib/readiness";
import type { RollCallRecord } from "@/lib/roll-call";
import {
  clientRollCallEvidenceId,
  foldRollCallEvidence,
  type RollCallCausalContext,
} from "@/lib/roll-call-causality";

/** Author a server frame from declared retained state and accepted posted evidence.
 * No clock or receipt order supplies an observation; opaque statements stay opaque.
 */
type FrameResult = {
  clientEventId: string;
  status: string;
  noteDisposition?: string;
  storedOccurredAt?: string;
};

export function refreshedSyncFrame(
  retained: OfflineManifestPayload,
  posted: {
    events?: readonly OfflineRollCallEvent[];
    checklistEvents?: readonly OfflineChecklistEvent[];
    arrivalEvents?: readonly OfflineArrivalEvent[];
    results?: readonly FrameResult[];
    revision?: number;
  } = {},
): OfflineManifestUpcomingResponse {
  const frame = structuredClone(retained);
  delete frame.selectedRollCallMeetingDay;
  const claims = offlineSnapshotTokenClaims(retained.erasureEpochToken);
  const revision = Math.max(posted.revision ?? 0, (claims?.revision ?? 0) + 1);
  frame.snapshotId = crypto.randomUUID();
  frame.erasureEpochToken = `${claims?.epoch ?? 0}.${revision}.${"a".repeat(43)}`;
  const accepted = (id: string) =>
    posted.results?.find((result) => result.clientEventId === id)?.status !== "rejected";
  for (const event of posted.events ?? []) {
    if (!accepted(event.clientEventId)) continue;
    let manifest = frame.manifests.find((item) => item.checkpoint === event.checkpoint);
    if (!manifest) {
      manifest = structuredClone(frame.manifests[0]);
      manifest.checkpoint = event.checkpoint;
      for (const row of [...manifest.divers, ...manifest.crew]) {
        delete row.rollCall;
        delete row.rollCallContext;
      }
      frame.manifests.push(manifest);
    }
    const row = event.bookingId
      ? manifest.divers.find((item) => item.bookingId === event.bookingId)
      : manifest.crew.find((item) => item.id === event.crewPersonId);
    if (!row) throw new Error("sync frame fixture has no declared subject");
    const result = posted.results?.find((item) => item.clientEventId === event.clientEventId);
    const saved: RollCallCausalContext["evidence"] =
      row.rollCallContext?.evidence ??
      (row.rollCall && !row.rollCall.implied
        ? [
            {
              id: `server:${crypto.randomUUID()}`,
              status: row.rollCall.state,
              occurredAt: row.rollCall.occurredAt,
              recordedByName: row.rollCall.recordedByName,
              note: row.rollCall.note ?? null,
              meetingDay:
                frame.rollCallMeetingDay ?? ((frame.rollCallDayBoundaries?.length ?? 0) ? -1 : 0),
            },
          ]
        : []);
    const evidence = [
      ...saved,
      {
        id: clientRollCallEvidenceId(event.clientEventId),
        status: event.status,
        occurredAt: result?.storedOccurredAt ?? event.occurredAt,
        recordedByName: "Fixture crew",
        note: result?.noteDisposition ? null : (event.note ?? null),
        meetingDay:
          event.meetingDay ??
          frame.rollCallMeetingDay ??
          ((frame.rollCallDayBoundaries?.length ?? 0) ? -1 : 0),
        observedEvidenceIds: event.observedEvidenceIds,
        reconcilesEvidence: event.reconcilesEvidence,
        retracts: event.retractsClientEventId
          ? clientRollCallEvidenceId(event.retractsClientEventId)
          : undefined,
      },
    ];
    const nodes = evidence.map((item) => ({
      id: item.id,
      status: item.status,
      observed: item.observedEvidenceIds,
      reconciles: item.reconcilesEvidence,
      retracts: item.retracts,
    }));
    const projection = foldRollCallEvidence(
      [...(row.rollCallContext?.ancestry ?? []), ...nodes],
      event.checkpoint,
    );
    row.rollCallContext = {
      meetingDay: frame.rollCallMeetingDay ?? 0,
      observedEvidenceIds: projection.frontier,
      conflict: projection.conflict,
      orderingUnknown: projection.orderingUnknown,
      unknownMeetingDay: evidence.some((item) => item.meetingDay === -1),
      evidence: evidence.filter((item) => projection.frontier.includes(item.id)),
      ancestry: [...(row.rollCallContext?.ancestry ?? []), ...nodes],
    };
    const statement = evidence.find((item) => item.status === projection.status);
    row.rollCall =
      statement && projection.status && projection.status !== "cleared"
        ? {
            state: projection.status,
            occurredAt: statement.occurredAt,
            recordedByName: statement.recordedByName,
            note: statement.note,
          }
        : undefined;
  }
  for (const event of posted.arrivalEvents ?? [])
    if (accepted(event.clientEventId)) {
      for (const manifest of frame.manifests) {
        const row = manifest.divers.find((item) => item.bookingId === event.bookingId);
        if (row) row.checkedIn = event.status === "arrived";
      }
    }
  for (const event of posted.checklistEvents ?? [])
    if (accepted(event.clientEventId)) {
      const item = frame.checklist?.items.find((item) => item.id === event.checklistItemId);
      if (item)
        item.check =
          event.status === "checked"
            ? {
                state: "checked",
                occurredAt: event.occurredAt,
                recordedByName: "Fixture crew",
                note: posted.results?.find((item) => item.clientEventId === event.clientEventId)
                  ?.noteDisposition
                  ? null
                  : (event.note ?? null),
              }
            : undefined;
    }
  const record = (row: {
    rollCall?: {
      state: "boarded" | "not_boarded";
      occurredAt: string;
      recordedByName: string;
      note?: string | null;
      implied?: boolean;
    };
    rollCallContext?: RollCallCausalContext;
  }): RollCallRecord | undefined =>
    row.rollCall
      ? {
          ...row.rollCall,
          occurredAt: new Date(row.rollCall.occurredAt),
          evidenceConflict: row.rollCallContext?.conflict,
        }
      : undefined;
  for (const manifest of frame.manifests) {
    // Use the same count authority as a real server frame, preserving an open conflict.
    manifest.summary = buildTripManifest({
      trip: {
        ...manifest.trip,
        startsAt: new Date(manifest.trip.startsAt),
        endsAt: new Date(manifest.trip.endsAt),
      },
      checkpoint: manifest.checkpoint,
      crew: manifest.crew.map((row, index) => ({
        fullName: row.fullName,
        roles: row.roles,
        id: row.id ?? `legacy-crew:${index}`,
        standingRatings: [],
        emergencyContactName: null,
        emergencyContactPhone: null,
        rollCall: record(row),
      })),
      divers: manifest.divers.map((row) => ({
        bookingId: row.bookingId,
        personId: row.personId,
        fullName: row.fullName,
        participantType: row.participantType,
        bookedAs: row.bookedAs,
        emergencyContactName: row.emergencyContactName,
        emergencyContactPhone: row.emergencyContactPhone,
        rentalFit: row.rentalFit,
        nitroxRequested: row.nitroxRequested,
        notHere: row.notHere,
        turnedAway: row.turnedAway,
        email: row.email ?? null,
        checkedIn: row.checkedIn ?? false,
        rollCall: record(row),
        readiness:
          row.readiness.status === "ready"
            ? { status: "ready", blockers: [] }
            : unavailableReadiness(),
      })),
    }).summary;
  }
  const tripId = frame.manifests[0].trip.id;
  return {
    shop: frame.shop,
    payloads: [frame],
    viewer: { personId: "fixture-current-viewer" },
    mayHoldMedicalAlertWords: { [tripId]: false },
  };
}

/** Attach a complete declared server frame to a successful transport answer. */
export function withRefreshedSyncFrame<T extends { results: readonly FrameResult[] }>(
  retained: OfflineManifestPayload,
  answer: T,
  posted: Omit<NonNullable<Parameters<typeof refreshedSyncFrame>[1]>, "results"> = {},
) {
  const revisions = (answer as { snapshotRevisions?: Record<string, unknown> }).snapshotRevisions;
  const revision = revisions?.[retained.manifests[0].trip.id];
  return {
    ...answer,
    refreshedManifests: refreshedSyncFrame(retained, {
      ...posted,
      results: answer.results,
      ...(Number.isSafeInteger(revision) && (revision as number) > 0
        ? { revision: revision as number }
        : {}),
    }),
  };
}
