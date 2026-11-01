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
  const safeCount = Math.max(1, Math.min(5, Math.trunc(plannedDives)));
  return [
    "departure",
    ...Array.from({ length: safeCount }, (_, index) => `after_dive_${index + 1}` as const),
  ];
}

/**
 * A checkpoint's place in the day: the dock is 0, after dive N is N. "Earlier"
 * is read off this, never off where a checkpoint happens to sit in a list.
 */
export function rollCallCheckpointOrdinal(checkpoint: RollCallCheckpoint): number {
  if (checkpoint === "departure") return 0;
  const dive = Number(checkpoint.slice("after_dive_".length));
  return Number.isFinite(dive) ? dive : Number.POSITIVE_INFINITY;
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
  /**
   * The stored event this result came from (`roll_call_events` or
   * `roll_call_crew_events` id). Lets a list tell whether two results are the
   * same event without comparing formatted text. Absent on results never
   * stored; a carried-forward (`implied`) result keeps its source event's id.
   */
  eventId?: string;
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
 * Three conditions, and the third is why this takes the standing result rather
 * than only the checkpoint. `boarded` after a dive is **two different acts** —
 * the ordinary "came back", which is most of a roll call and has nothing to
 * say, and the retraction of a stated alarm, which is the sighting most worth
 * describing. Nothing in the payload tells them apart, so the row's current
 * state has to. Leaving it at "after a dive" let a note ride an ordinary
 * boarded tap onto the append-only trail from any surface that offered a box,
 * which is the same "which surface a crew happened to hold decided whether
 * their sentence went ashore" failure issue #1058 was reacting to.
 *
 * `standing` is the newest result at this subject and checkpoint, and it is
 * only consulted when the caller is not raising the alarm — so an ordinary
 * "not back aboard" costs no extra read.
 */
export function rollCallNoteAllowed(
  checkpoint: RollCallCheckpoint,
  status: "boarded" | "not_boarded" | "cleared",
  standing: Pick<RollCallRecord, "state" | "implied"> | undefined,
): boolean {
  if (checkpoint === "departure") return false;
  // Raising it: this event *is* the statement that somebody is unaccounted for.
  if (status === "not_boarded") return true;
  // Unsaying one that stands — the positive sighting, and the mis-tap undo.
  return isNotBackAboard(checkpoint, standing);
}

/**
 * **Does one standing roll-call result mean this person went to sea?**
 *
 * The atom under every reader that answers that question, so none of them can
 * drift about one diver. Two statements a crew can make mean it:
 *
 * - `boarded`, at **any** checkpoint. A diver who joined at the second site has
 *   no departure event at all.
 * - `not_boarded` at an **after-dive** checkpoint, which is not "never came"
 *   but **did not come back from the dive**. That is the missing-diver row, and
 *   the diver it is about sailed (`docs/product/glossary.md`, **sailed**).
 *
 * **A `departure` `not_boarded` is deliberately false, and that asymmetry is
 * the whole of this function.** At the dock the same word means "never left the
 * dock" — the benign half, and the ordinary absence the counter exists to let a
 * shop record.
 *
 * **Standing results only.** A superseded row, and a `cleared` that undid one,
 * must already have been collapsed away by the caller; this reads one result at
 * face value. `cleared` answers false, which is what makes a checkpoint whose
 * newest row is an undo drop out rather than fall back to an older one.
 *
 * The five callers, each of which said this in its own words before a
 * dive-domain-expert review found two of them disagreeing (issue #1704):
 * `onTheWaterByRollCall` and the seat reclaim in **both** `recordRollCall` and
 * `recordCrewRollCall` (src/db/manifests.ts), `inAfterDivePopulation`
 * (src/db/today.ts), and `seatSailed` (src/lib/closeout.ts). The two reclaims
 * are one predicate for one reason: the reader that refuses the desk consults
 * both trails, so a mirror act on only one of them is a promise the reader
 * makes and the writer does not keep (issue #1686). A sixth, the fly-safe
 * dive-day reader `peopleWhoDivedBefore` (src/db/executed-dives.ts), reads it
 * to let the roll call outrank a booking or departure cancelled later at a desk
 * (issue #1836).
 */
export function standingResultMeansSailed(
  checkpoint: string,
  status: "boarded" | "not_boarded" | "cleared",
): boolean {
  if (status === "boarded") return true;
  return status === "not_boarded" && checkpoint !== "departure";
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

/**
 * Whether a standing `boarded` result sits at any earlier checkpoint — the
 * `boardedEarlier` a manifest diver carries (domain review of #2123). Handed
 * the results *before* the checkpoint in question, in any order.
 */
export function boardedBefore(
  earlier: ReadonlyArray<Pick<RollCallRecord, "state"> | null | undefined>,
): boolean {
  return earlier.some((record) => record?.state === "boarded");
}

/**
 * **Whether a roll-call row still speaks a person's readiness** — its blocked
 * fill, and on the live page the blocked capsule and the list of blockers.
 *
 * At the dock always: readiness is the thing to fix before they board. After a
 * dive only for someone with no earlier boarding (`boardedEarlier` not true),
 * because a `boarded` there is their first — they joined at the second site —
 * so the row reads as the dock's would (domain review of #2123). Never on a row
 * recorded not back aboard: that row is the alarm, and no paperwork word may
 * sit on it (DD9). Absent `boardedEarlier` reads as not boarded: a row that
 * cannot say whether anyone boarded them keeps its blocker in view rather than
 * hiding it (dive-domain review of #2286).
 *
 * One predicate for the live manifest and the offline copy (issue #2286), so
 * the same boat never shows two safety pictures depending on signal.
 */
export function blockedAtRail(input: {
  ready: boolean;
  isDeparture: boolean;
  boardedEarlier?: boolean;
  notBackAboard: boolean;
}): boolean {
  if (input.ready) return false;
  if (input.isDeparture) return true;
  return input.boardedEarlier !== true && !input.notBackAboard;
}

/** The readiness blockers that are a physician's word, not paperwork (#2380). */
export type MedicalHoldCode = "medical_not_cleared" | "medical_review";

/**
 * **A medical block stays on the row between dives** (issue #2380, Aaron's
 * decision (b), 2026-10-13): which medical blocker a row names after a dive,
 * for a diver a captain boarded over it — or null.
 *
 * `blockedAtRail` stops speaking readiness for that diver after a dive
 * (decision 4 of ADR 20260827-the-departure-is-two-working-surfaces): roll
 * call there is a head count, and a danger-toned "Blocked" would compete with
 * the one red that means somebody is in the water. That stays. But a person a
 * physician did not clear, between dives, is not a paperwork state, and a
 * rider under the same "no" already keeps a chip at every checkpoint (H-20261009-rider-snorkeler-medical).
 * So this names the medical fact for a warning-toned capsule, ranked where the
 * rider's sits — never "Blocked", and never a gate on the after-dive mark.
 *
 * Quiet at the dock and for a diver nobody boarded earlier: `blockedAtRail`
 * already shows "Blocked" there, so between the two predicates a medical
 * blocker is never silent at a rail. Quiet on a row recorded not back aboard:
 * that row is the alarm and carries nothing else (DD9). A physician's "no"
 * outranks an open review when both stand.
 *
 * One predicate for the live roll call and the offline copy, so the two never
 * disagree. Takes the codes as plain strings to stay dependency-free.
 */
export function medicalHoldAfterDive(input: {
  checkpoint: RollCallCheckpoint;
  boardedEarlier?: boolean;
  notBackAboard: boolean;
  blockerCodes: readonly string[];
}): MedicalHoldCode | null {
  if (input.checkpoint === "departure") return null;
  if (input.boardedEarlier !== true || input.notBackAboard) return null;
  if (input.blockerCodes.includes("medical_not_cleared")) return "medical_not_cleared";
  if (input.blockerCodes.includes("medical_review")) return "medical_review";
  return null;
}

/**
 * **What a cancelled departure's manifest says about its roll call** (#2285),
 * read off the writers' own gate (`rollCallOpenOnTrip`). `closed`: nobody was
 * counted before the cancel, so every roll-call write is refused and the page
 * draws no control that only refuses. `still_counting`: the count had begun,
 * so it stays open to the end (dive-domain review, 2026-10-09) and the page
 * says why. Null for a departure that is not cancelled.
 */
export type CancelledRollCall = "closed" | "still_counting";

export function cancelledRollCall(input: {
  cancelled: boolean;
  rollCallOpen: boolean;
}): CancelledRollCall | null {
  if (!input.cancelled) return null;
  return input.rollCallOpen ? "still_counting" : "closed";
}
