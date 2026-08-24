/**
 * The pre-departure safety checklist's vocabulary — one shop-authored line
 * ("Emergency oxygen aboard"), one append-only tap at a time, informs never
 * gates (ADR 20260824-pre-departure-safety-check).
 *
 * **Dependency-free, like `roll-call.ts` beside it.** `src/lib/offline-manifests.ts`
 * is compiled into the offline service worker, and it reads this module to
 * derive a checklist item's current state on a device with no signal. Anything
 * added here must import nothing.
 *
 * Deliberately simpler than roll call's own offline vocabulary: there is no
 * checkpoint (a check happens once, before the boat leaves, not once per dive),
 * no carry-forward default, and no "rescue an alarm from a rejection" asymmetry
 * — a checklist item is never the record of a diver who did not come back, so a
 * rejected write falling back to the snapshot's last-known state is safe in
 * either direction. What *is* kept, for the same reason it is kept in roll
 * call: a `cleared` retraction names the statement it undoes
 * (`retractsClientEventId`), so an accidental undo on a stale device cannot
 * take back a different device's more recent check.
 */

/** The retraction. Re-tapping an already-checked item takes the mark off. */
export type PreDepartureCheckStatus = "checked" | "cleared";

/**
 * The refusal a `cleared` gets when the check it names is no longer the newest
 * one standing — the same shape `ROLL_CALL_RETRACTION_SUPERSEDED`
 * (`roll-call.ts`) carries, spelled once so a server writer and a
 * service-worker-bundled reader mean the same thing by it.
 */
export const PRE_DEPARTURE_CHECK_RETRACTION_SUPERSEDED = "retraction_superseded";

export type PreDepartureCheckRecord = {
  state: "checked";
  occurredAt: Date;
  recordedByName: string;
  note: string | null;
};

/**
 * Reduce one item's append-only history to its current answer: the newest
 * event wins, and a newest `cleared` collapses to "not checked" (`undefined`)
 * rather than falling through to whatever an older `checked` said — the same
 * collapse roll call's own readers apply. Generic over the record shape so a
 * server row (`Date`, a resolved name) and a device's queued event (an ISO
 * string, a `pending` flag) can share this one reducer instead of each
 * re-deriving the rule.
 */
export function latestPreDepartureCheck<
  T extends { status: PreDepartureCheckStatus; occurredAt: string | Date },
>(events: readonly T[]): T | undefined {
  let latest: T | undefined;
  for (const event of events) {
    if (!latest || event.occurredAt >= latest.occurredAt) latest = event;
  }
  return latest?.status === "checked" ? latest : undefined;
}
