import type { rollCallEventClaims } from "@/db/schema";

type Observation = NonNullable<(typeof rollCallEventClaims.$inferSelect)["unresolvedObservation"]>;

/** Staff-facing context only. This summary is not an observation version,
 * a complete causal history, an acknowledgement, or a handoff receipt. */
export function projectReviewObservation(observation: Observation) {
  return {
    checkpoint: observation.checkpoint,
    status: observation.status,
    occurredAt: observation.occurredAt,
    meetingDay: observation.meetingDay,
    note: observation.note,
    snapshotSavedAt: observation.snapshotSavedAt,
    observedEvidenceCount:
      Array.isArray(observation.observedEvidenceIds) &&
      observation.observedEvidenceIds.every((id) => typeof id === "string")
        ? observation.observedEvidenceIds.length
        : null,
    retractsPriorObservation:
      typeof observation.retractsEventId === "string" ||
      typeof observation.retractsClientEventId === "string"
        ? true
        : observation.retractsEventId === null && observation.retractsClientEventId === null
          ? false
          : null,
    reconcilesEvidence: observation.reconcilesEvidence,
  };
}
