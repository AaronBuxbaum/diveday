import type { RollCallCheckpoint } from "@/lib/manifests";
import type { OfflineManifestSnapshot } from "@/lib/offline-manifests";
import { canonicalRollCallEvidenceId, clientRollCallEvidenceId } from "@/lib/roll-call-causality";

/** Explicit fixture authorship for one identified saved statement, never legacy defaults.
 * Preserve client/server identities and existing unambiguous context when supplied.
 * Caller declares its meeting day and then separately authors any tap that observed it.
 */
export function identifySavedRollCall(
  snapshot: OfflineManifestSnapshot,
  subject: { bookingId: string } | { crewPersonId: string },
  checkpoint: RollCallCheckpoint,
  meetingDay: number,
): string {
  const manifest = snapshot.manifests.find((item) => item.checkpoint === checkpoint);
  const row =
    "bookingId" in subject
      ? manifest?.divers.find((item) => item.bookingId === subject.bookingId)
      : manifest?.crew.find((item) => item.id === subject.crewPersonId);
  if (!row?.rollCall || row.rollCall.implied)
    throw new Error("expected a declared original saved statement");
  // Some explicit fixture statements retain the original identity even when
  // older snapshot allow-lists did not declare these optional metadata fields.
  const mark = row.rollCall as typeof row.rollCall & { clientEventId?: string; eventId?: string };
  const knownId = mark.clientEventId
    ? clientRollCallEvidenceId(mark.clientEventId)
    : mark.eventId
      ? canonicalRollCallEvidenceId({ id: mark.eventId })
      : undefined;
  if (row.rollCallContext) {
    const context = row.rollCallContext;
    const evidence = context.evidence[0];
    if (
      context.conflict ||
      context.meetingDay !== meetingDay ||
      context.evidence.length !== 1 ||
      context.observedEvidenceIds.length !== 1 ||
      !evidence ||
      context.observedEvidenceIds[0] !== evidence.id ||
      evidence.status !== mark.state ||
      (knownId && evidence.id !== knownId)
    ) {
      throw new Error("cannot replace ambiguous or inconsistent saved evidence");
    }
    return evidence.id;
  }
  const id = knownId ?? canonicalRollCallEvidenceId({ id: crypto.randomUUID() });
  row.rollCallContext = {
    meetingDay,
    observedEvidenceIds: [id],
    conflict: false,
    orderingUnknown: false,
    unknownMeetingDay: false,
    evidence: [
      {
        id,
        status: row.rollCall.state,
        occurredAt: row.rollCall.occurredAt,
        recordedByName: row.rollCall.recordedByName,
        note: row.rollCall.note ?? null,
        meetingDay,
        observedEvidenceIds: [],
      },
    ],
  };
  return id;
}
