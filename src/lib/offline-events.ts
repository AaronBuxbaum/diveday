/**
 * The one staleness bound every offline recorder applies before it writes.
 *
 * Arrival and checklist recorders apply the capture/copy plausibility bound.
 * Roll-call writers retain the stored-instant cap, but validate identity and
 * snapshot authorization independently of clocks: even an older queued missing
 * mark must survive a clock adjustment. Its observed evidence decides risk.
 *
 * Framework-free and dependency-free, like `roll-call.ts` beside it: nothing
 * here but the arithmetic and the reason for it.
 */

/**
 * How far a snapshot may claim to postdate the result recorded from it before
 * the event is refused as `snapshot_invalid`. Both readings are the device's
 * own clock, taken minutes or hours apart, so a few minutes covers a clock the
 * device corrected in between; more than that is a broken or forged event.
 */
export const OFFLINE_EVENT_SKEW_MS = 5 * 60 * 1000;

/**
 * True when a queued event cannot be applied as it stands.
 *
 * A missing `clientEventId` is out of bounds on purpose: without it the write
 * is not idempotent, so a retried sync would double-record the thing it is
 * about — who came back from a dive, or who was standing at the desk.
 *
 * `occurredAt` is the device's own reading, never the stored instant
 * ({@link offlineEventInstant}): the snapshot's `savedAt` is the same clock's,
 * and the two are only comparable with each other.
 *
 * **A result dated in the server's future is not refused.** It was once, as
 * "a broken or forged event". The clock is broken; the event is not: a tablet
 * running ten minutes fast had every mark of its last ten minutes refused at
 * sync, "did not come back" included, and the device then read each of those
 * rows back down to awaiting. The writers store {@link offlineEventInstant}
 * instead.
 */
export function offlineEventOutOfBounds(input: {
  clientEventId: string | undefined;
  offlineSnapshotSavedAt: Date | undefined;
  occurredAt: Date;
}): boolean {
  const savedAt = input.offlineSnapshotSavedAt;
  return (
    !input.clientEventId ||
    !savedAt ||
    savedAt.getTime() > input.occurredAt.getTime() + OFFLINE_EVENT_SKEW_MS
  );
}

/**
 * **The instant an offline event is stored under: the device's reading, or the
 * moment it reached the server when the device's is later.** A tap cannot have
 * been made after its own sync, so a later reading is a clock running fast.
 *
 * Arrival and checklist trails retain their time ordering. Roll-call trails
 * keep this instant for audit only; their effective result follows captured
 * causal context, so even a capped instant cannot establish observation.
 *
 * A clock running slow is not corrected: nothing the server holds says by how
 * much.
 */
export function offlineEventInstant(occurredAt: Date | undefined, now: Date): Date {
  return occurredAt && occurredAt.getTime() < now.getTime() ? occurredAt : now;
}

/** The first stored instant for audit, falling back to the retained device reading. */
export function offlineStoredInstant(event: {
  occurredAt: string;
  storedOccurredAt?: string;
}): string {
  return event.storedOccurredAt ?? event.occurredAt;
}
