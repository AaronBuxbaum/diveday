/**
 * The roll-call vocabulary: what a checkpoint is, what one recorded result is,
 * and the two rules that read a result — **and nothing else**.
 *
 * Split out of `src/lib/manifests.ts`, which stays the home of everything a
 * manifest *is* (the diver and crew shapes, completeness, buddy alerts, the
 * assembly). Every name here is re-exported from there, so nothing that
 * already imports from `@/lib/manifests` changes.
 *
 * **The split is a bundling constraint, not taste.** `src/lib/offline-manifests.ts`
 * is compiled into the offline **service worker**
 * (`scripts/build-service-worker.mjs` → `public/manifest-sw.js`), and esbuild
 * resolves an import graph eagerly: one *value* import from `manifests.ts`
 * reaches `unavailableReadiness` → `readiness.ts` → `waivers.ts` →
 * `node:crypto`, and the worker build fails outright. `pnpm typecheck` is
 * happy with that chain, so the first sign of it is a boat with no offline
 * shell. This module imports nothing at all, which is what lets the device
 * read a head count through the *same* functions the server does instead of
 * keeping a second copy of the rules that decide whether somebody is still in
 * the water.
 *
 * Keep it that way: anything added here must be pure and dependency-free.
 */

export type RollCallState = "awaiting" | "boarded" | "not_boarded";

/**
 * The refusal an offline **retraction** gets when the statement it names is no
 * longer the one standing (ADR 20260815-an-offline-retraction-names-its-target).
 *
 * A shared constant rather than the same string literal at both ends, because
 * the two ends are a database writer and a service-worker-bundled reader, and
 * they mean different things by it: `recordRollCall`/`recordCrewRollCall`
 * *produce* it, and `explicitResultAt` (`src/lib/offline-manifests.ts`) treats
 * it as the one rejection that says something specific — *the server holds a
 * statement newer than anything this device can see* — and reads the row down
 * to awaiting on the strength of it. Spelled twice, a rename on the writer side
 * would leave the reader silently believing a stale value forever, with every
 * test on both sides green. Here it is a `tsc` failure.
 *
 * It lives in this dependency-free leaf for the usual reason: the reader is
 * compiled into the service worker, so it cannot reach `src/db`.
 */
export const RETRACTION_SUPERSEDED = "retraction_superseded";

export type RollCallCheckpoint = "departure" | `after_dive_${number}`;

export function rollCallCheckpoints(plannedDives: number): RollCallCheckpoint[] {
  const safeCount = Math.max(1, Math.min(4, Math.trunc(plannedDives)));
  return [
    "departure",
    ...Array.from({ length: safeCount }, (_, index) => `after_dive_${index + 1}` as const),
  ];
}

export function isRollCallCheckpoint(
  value: string,
  plannedDives: number,
): value is RollCallCheckpoint {
  return rollCallCheckpoints(plannedDives).some((checkpoint) => checkpoint === value);
}

export type RollCallRecord = {
  state: Exclude<RollCallState, "awaiting">;
  occurredAt: Date;
  recordedByName: string;
  /**
   * True when this result was not recorded at this checkpoint but carried
   * forward: a diver left the boat at an earlier checkpoint, so every later
   * checkpoint defaults to not boarded until staff say otherwise.
   */
  implied?: boolean;
  /**
   * What the crew observed about a person who is unaccounted for — after-dive
   * checkpoints only (`rollCallNoteAllowed`, ADR
   * 20260828-a-missing-diver-gets-a-sentence). Absent on every carried-forward
   * result, which nobody wrote.
   */
  note?: string | null;
};

/**
 * `not_boarded` means two opposite things depending on where it was recorded,
 * and conflating them is what let the manifest print "Roll call complete ✦" on
 * a boat the Today queue was raising a missing-diver alarm about (DOM-H3):
 *
 * - at `departure` it means **never left the dock**. Benign, genuinely
 *   accounted for, and correctly true of every later checkpoint too — which is
 *   what `carryForwardNotBoarded` below fills in (`implied: true`).
 * - explicitly at an `after_dive_n` checkpoint it means **did not return to the
 *   boat**. That *is* the missing-diver event: the crew member who taps the
 *   only control that isn't "Boarded" is saying "not back yet, check again",
 *   and the checkpoint must stay open.
 *
 * This predicate is the single place that split lives on the manifest side.
 * `src/db/today.ts` states the same rule for the work queue (see
 * `isAccountedForAfterDive` there); the two are asserted against each other on
 * one trip in src/db/today.test.ts so they can never drift apart again.
 */
/**
 * How long a roll-call note may be. One bound, shared by the form, the two
 * server actions and the offline queue, so a sentence a crew member could type
 * into the box can never be the thing a sync refuses.
 */
export const ROLL_CALL_NOTE_MAX = 300;

/**
 * Whether a roll-call event at this checkpoint may carry a note
 * (ADR 20260828-a-missing-diver-gets-a-sentence).
 *
 * **After a dive, and nowhere else.** At the dock `not_boarded` means "never
 * left", a clerical fact that has never needed a sentence; after a dive it
 * means "did not come back", which is the one state in the product where a
 * shop has to be able to say *what happened* and not merely *that it did*. The
 * two most common real outcomes — "surfaced 200 m north, recovered by Reef
 * Runner" and "left early, signed out with Marisol" — are both benign, and
 * without this the printed manifest carried neither.
 *
 * It is a checkpoint rule rather than a status rule because the same status
 * means different things either side of the tap: `boarded` after a dive is both
 * the ordinary "came back" and the retraction of a stated alarm, and no
 * (checkpoint, status) pair can tell them apart without re-reading the row. The
 * surfaces are what narrow it further — the field renders on the exception
 * control, on its retraction, and on "Mark back aboard", never on an ordinary
 * boarded tap. This predicate is the floor beneath that: both writers apply it,
 * so a note posted at departure is dropped rather than written to the
 * append-only trail.
 */
export function rollCallNoteAllowed(checkpoint: RollCallCheckpoint): boolean {
  return checkpoint !== "departure";
}

export function isNotBackAboard(
  checkpoint: RollCallCheckpoint,
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): boolean {
  if (checkpoint === "departure") return false;
  if (rollCall?.state !== "not_boarded") return false;
  // Carried forward from the dock (see `carryForwardNotBoarded`): a diver who
  // never left is accounted for at every later checkpoint, not missing from it.
  return rollCall.implied !== true;
}

/**
 * Fills the "never left the dock, so still ashore" default across one diver's
 * ordered checkpoints. A diver marked not boarded **at departure** defaults to
 * not boarded at every later checkpoint with no result of its own (flagged
 * `implied`) until an explicit result breaks the chain. Carry-forward never
 * fabricates a "boarded": the default can only ever read absent.
 *
 * **Only index 0 — `departure` — is ever a source, and this is the whole point
 * (DOM-H3).** A `not_boarded` at an after-dive checkpoint does not mean "left
 * ashore", it means **did not return to the boat** (`isNotBackAboard` above).
 * Carrying that forward as an accounted-for record is what closed every
 * subsequent checkpoint on exactly the boat that had a diver in the water — the
 * manifest printed "Roll call complete ✦" while the Today queue was raising a
 * top-severity missing-diver row about the same trip. A missing diver must
 * never satisfy a later count; the crew have to state, per checkpoint, whether
 * that person came back.
 *
 * A `cleared` undo has already been collapsed to "no result" upstream
 * (listLatestRollCallByBooking, and `latestOfflineRollCall` on the device), so
 * it is not seen here as a breaker. Clearing the originating departure
 * not-boarded removes the source and the whole chain reverts to awaiting;
 * clearing a later re-board reverts that checkpoint to the carried default.
 * Pure and order-sensitive: pass the checkpoints in departure→last order.
 *
 * **Generic over the record shape, so the offline copy runs this one instead
 * of a second copy of it** (ADR 20260815-roll-call-order-is-a-property-of-the-data).
 * The device's results carry an ISO string `occurredAt` and a `pending` flag
 * rather than a `Date` and a recorder name, and nothing here reads either —
 * only `state` and `implied` decide anything. Until the device ran this, a
 * diver marked ashore at the dock with no signal read *awaiting* at every later
 * checkpoint on that phone, where online they read "not boarded · carried": the
 * only offline control that would take a result for them then is "Mark not back
 * aboard", which after a dive means *did not come back from a dive*.
 */
export function carryForwardNotBoarded<T extends Pick<RollCallRecord, "state" | "implied">>(
  perCheckpoint: readonly (T | undefined)[],
): (T | undefined)[] {
  let carried: T | undefined;
  return perCheckpoint.map((result, index) => {
    if (result) {
      carried = index === 0 && result.state === "not_boarded" ? result : undefined;
      return result;
    }
    // The cast is the one TypeScript cannot see through: spreading a generic
    // and adding a property it already declares optionally widens to
    // `T & { implied: boolean }`, which is a `T`. Nothing else about the
    // record changes — the carried default is the dock's own record, re-read
    // at a later checkpoint.
    return carried ? ({ ...carried, implied: true } as T) : undefined;
  });
}
