import { capturableObservation, type RollCallClaimInput } from "@/db/roll-call-claims";
import type { rollCallEventClaims } from "@/db/schema";

type Claim = typeof rollCallEventClaims.$inferSelect;

export function canonicalRetainedValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRetainedValue).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRetainedValue(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Compare a stored raw copy with the full submitted event. This alone is not a
 * receipt: the caller must also verify the keyed claim fingerprint and perform
 * authorization, erasure and state checks under the appropriate transaction
 * fences. No current production caller uses this to settle device evidence.
 */
export function retainedObservationMatches(input: RollCallClaimInput, claim: Claim): boolean {
  if (
    input.source !== "offline" ||
    !input.occurredAt ||
    !input.offlineSnapshotSavedAt ||
    !input.offlineSnapshotId ||
    claim.state !== "unresolved" ||
    !claim.unresolvedObservation ||
    !claim.unresolvedRecordedByPersonId ||
    claim.shopId !== input.shopId ||
    claim.tripId !== input.tripId ||
    claim.clientEventId !== input.clientEventId ||
    claim.subjectKind !== input.subject.kind
  )
    return false;
  if (
    input.subject.kind === "seat"
      ? claim.bookingId !== input.subject.bookingId || claim.crewPersonId !== null
      : claim.crewPersonId !== input.subject.personId || claim.bookingId !== null
  )
    return false;
  // A disposed note is no longer a complete raw observation, even when a
  // keyed fingerprint can validate a note-less retry. It cannot qualify for
  // a receipt that claims complete raw retention.
  if (claim.noteDisposition !== null) return false;
  const expected = capturableObservation(input);
  return (
    expected !== null &&
    canonicalRetainedValue(claim.unresolvedObservation) === canonicalRetainedValue(expected)
  );
}
