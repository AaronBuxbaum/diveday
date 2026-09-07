/**
 * The one staleness bound every offline recorder applies before it writes.
 *
 * Three writers reconcile events a device queued with no signal — roll call
 * (`recordRollCall`/`recordCrewRollCall`), the pre-departure checklist
 * (`recordPreDepartureCheck`), and now the counter
 * (`checkInBooking`/`undoCheckInBooking`) — and the rule that decides whether
 * a queued event is plausible at all has to be the same one in all of them.
 * It was written out three times before this module existed, which is three
 * chances for one of them to drift: two halves of one head count disagreeing
 * about what makes an offline event stale is precisely the class of bug that
 * outlives the week somebody re-reads only one of them.
 *
 * Framework-free and dependency-free, like `roll-call.ts` beside it: nothing
 * here but the arithmetic and the reason for it.
 */

/**
 * How far outside the plausible window an offline event's clocks may sit
 * before it is refused as `snapshot_invalid`. The three timestamps logically
 * have to fall in one order — snapshot saved, then result recorded, then
 * synced — before the server refuses it. A boat tablet's clock is not the
 * server's, so a few minutes either way is ordinary; a snapshot that claims to
 * postdate the result recorded from it, or a result recorded in the future, is
 * not skew but a broken or forged event.
 */
export const OFFLINE_EVENT_SKEW_MS = 5 * 60 * 1000;

/**
 * True when a queued event's own timestamps put it outside that window.
 *
 * A missing `clientEventId` is out of bounds on purpose: without it the write
 * is not idempotent, so a retried sync would double-record the thing it is
 * about — who came back from a dive, or who was standing at the desk.
 */
export function offlineEventOutOfBounds(input: {
  clientEventId: string | undefined;
  offlineSnapshotSavedAt: Date | undefined;
  occurredAt: Date;
  now: Date;
}): boolean {
  const savedAt = input.offlineSnapshotSavedAt;
  return (
    !input.clientEventId ||
    !savedAt ||
    savedAt.getTime() > input.occurredAt.getTime() + OFFLINE_EVENT_SKEW_MS ||
    input.occurredAt.getTime() > input.now.getTime() + OFFLINE_EVENT_SKEW_MS
  );
}
