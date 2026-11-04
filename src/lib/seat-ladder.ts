import { nowDate } from "./clock";
import { RECAP_AUTOMATIC_DELAY_MS } from "./recap-schedule";
import { seatSailed } from "./seat-sailed";
import { hasReturned } from "./trips";

/**
 * **The seat ladder: one reading of where a seat stands on the day**
 * (issue #2784, codebase review idea L27-1).
 *
 * A booked seat climbs a short ladder that four people write, each in their
 * own place: the desk writes arrival (`booking_arrival_events`, through
 * `checkInBooking`), the rail writes the dock count and the after-dive counts
 * (`roll_call_events`), and the desk writes the release (`bookings.status =
 * 'no_show'`). Writes do not move. This module is the one place that *reads*
 * those records together into a rung, so a surface asks the ladder instead of
 * recomposing the rung from raw words.
 *
 * **Arrival never reads as aboard.** It is the one failure the counter was
 * built to make impossible (ADR 20260907-the-counter-survives-offline,
 * decision 4; `src/lib/arrival.ts`): the desk asks "are you here?", the rail
 * asks "are you on the boat?". So the only inputs that can put a seat on
 * `out` are a crew count: the dock's `boarded`, or a result standing at an
 * after-dive checkpoint. A standing arrival lifts a seat to `arrived` and no
 * further, whatever the clock says.
 *
 * The rungs, strongest evidence first:
 *
 * - **`missing`**: recorded not back at an after-dive checkpoint and not
 *   counted aboard since (`listUnaccountedForByTrip`). Outranks everything,
 *   because it is the one rung that is still a question about a person in the
 *   water.
 * - **`out`**: the crew counted this person on the boat at some checkpoint:
 *   `boarded` at the dock, or any word standing at an after-dive checkpoint
 *   (either word there means they were on the boat). **`out` is not "back"**:
 *   a diver counted at the dock and not yet named at the next after-dive
 *   checkpoint is `out`, and is the "unfinished head count" the day is still
 *   asking about (`listRollCallGaps`). No rung here says back.
 * - **`ashore`**: the crew's `not_boarded` at the dock, and no after-dive word
 *   since. A diver left at the dock and later counted at a dive site (a chase
 *   boat) is `out` by the after-dive evidence, though the vessel did not leave
 *   with them (`countsAsSailed` is false).
 * - **`released`**: the desk's `no_show`, where no crew count says otherwise.
 * - **`arrived`**: the desk saw them, and nobody has counted them at the rail.
 * - **`booked`**: a seat nobody has said anything about yet.
 *
 * `rung` is evidence and never a guess. `countsAsSailed` is `seatSailed`'s
 * count rule (how many the vessel left with) and is *not* the same thing. It
 * presumes a seat nobody spoke for sailed, because silence is an unfinished
 * dock count rather than a statement, while its rung stays `booked` or
 * `arrived` (`sailingUnsaid`). And the dock wins it where it spoke, so the
 * chase-boat diver above, and one left at the dock and then said missing, are
 * on the water by their rung and not sailed by the count. A surface that
 * needs "did somebody see this person on the boat" reads the rung; one that
 * needs "how many did the vessel carry" reads `countsAsSailed`, and only after
 * `sailingUnsaid` says somebody spoke.
 *
 * Cancellation is a lifecycle, not a rung: the caller decides a cancelled
 * booking or departure before it asks the ladder, as it always has.
 *
 * Framework-free and words-free: the caller resolves every code.
 */
export type SeatRung = "booked" | "arrived" | "released" | "ashore" | "out" | "missing";

/** Which record put the seat on its rung. */
export type SeatEvidence = "none" | "desk_arrival" | "desk_release" | "dock" | "after_dive";

/**
 * What the shop recorded at the dock for this booking: the newest
 * `roll_call_events` row at the `departure` checkpoint, or null where the crew
 * recorded nothing (`departureRollCallForBooking`, src/db/manifests.ts).
 */
export type DepartureRollCall = "boarded" | "not_boarded" | null;

export interface SeatRecords {
  /** `bookings.status === "no_show"`: the desk's release of the seat. */
  noShow: boolean;
  /**
   * Whether an arrival stands for this booking: `latestArrival` over its
   * `booking_arrival_events` (src/lib/arrival.ts). Read from the trail, never
   * from `bookings.status`.
   */
  arrived: boolean;
  /** The standing result at the `departure` checkpoint. */
  dockResult: DepartureRollCall;
  /** Whether either word stands at any after-dive checkpoint. */
  afterDiveResultStands: boolean;
  /** Recorded not back at an after-dive checkpoint and not counted since. */
  missingAfterDive: boolean;
}

export interface SeatLadder {
  rung: SeatRung;
  evidence: SeatEvidence;
  /**
   * `seatSailed` over the same records: the evening count's rule, which
   * *presumes* a seat nobody spoke for sailed. Ask `sailingUnsaid` first.
   */
  countsAsSailed: boolean;
}

/** Read one seat's rung, the record that put it there, and the count's rule. */
export function readSeatLadder(records: SeatRecords): SeatLadder {
  const { noShow, arrived, dockResult, afterDiveResultStands, missingAfterDive } = records;
  const countsAsSailed = seatSailed({ noShow, dockResult, afterDiveResultStands });
  if (missingAfterDive) return { rung: "missing", evidence: "after_dive", countsAsSailed };
  if (dockResult === "boarded") return { rung: "out", evidence: "dock", countsAsSailed };
  if (afterDiveResultStands) return { rung: "out", evidence: "after_dive", countsAsSailed };
  if (dockResult === "not_boarded") return { rung: "ashore", evidence: "dock", countsAsSailed };
  if (noShow) return { rung: "released", evidence: "desk_release", countsAsSailed };
  if (arrived) return { rung: "arrived", evidence: "desk_arrival", countsAsSailed };
  return { rung: "booked", evidence: "none", countsAsSailed };
}

/**
 * **Nobody has said whether this seat sailed**: no crew count, no desk
 * release. A finished departure's record files such a seat as "Not counted at
 * the dock" or "No roll call taken", never "Sailed" and never "Didn't sail",
 * even though `countsAsSailed` presumes it went. A standing arrival does not
 * change that: the desk saw the diver, not the boat.
 */
export function sailingUnsaid(ladder: SeatLadder): boolean {
  return ladder.rung === "booked" || ladder.rung === "arrived";
}

/**
 * **The diver dived**, which is the condition that turns the thread page from
 * its prep state into its after-state (ADR 20260827-the-divers-thread,
 * decision 4, slice 7d). The ladder's question for the diver's own page.
 *
 * It opened on the clock alone until a review caught it (2026-08-28): the
 * one-hour late-arrival buffer, and nothing else. That buffer is the right
 * rule for *has it sailed* and the wrong one for *did this person dive*,
 * because the only thing standing between a diver who never boarded and a page
 * saying "Welcome back" was `bookings.status = 'no_show'`, and that status is
 * not a record of the dock. It has a writer now (`markBookingNoShow`,
 * src/db/no-show.ts, issue #1209), tapped at the counter while the boat is
 * still in sight rather than at close-out, and it still may not carry this: the
 * mark is one staffer's discretionary act on a *seat*, a shop that never works
 * the counter queue writes none at all, its door shuts six hours after the
 * departure (`noShowGate`, src/lib/no-show.ts), and a diver the crew board
 * after it is written has the seat handed straight back (`reclaimReleasedSeat`,
 * src/db/manifests.ts). A page that opened on it would be reading a shop's desk
 * work as evidence about the water. So the diver who overslept, or who was held
 * at the desk on a medical hold and never left the dock, opened the durable link
 * already sitting in their inbox and got a printable dive record for a day they
 * spent on land, and an invitation to tip the crew who dived without them.
 *
 * Three answers, in the order the evidence deserves:
 *
 * - **`not_boarded` never sees the afterglow.** The crew wrote down that this
 *   person did not get on the boat; no clock overrides that.
 * - **`boarded` opens it at the buffer**, because the shop has recorded that
 *   they were aboard — the clock is no longer asserting anything on its own.
 * - **A diver the crew never counted, on a departure whose roll call was
 *   taken, never sees it on the clock alone** (issue #3822): the crew spoke
 *   for everyone else and left this seat unsaid, which is not the silence of a
 *   shop that keeps no roll call.
 * - **No roll call at all waits for the recap floor**
 *   (`RECAP_AUTOMATIC_DELAY_HOURS`, four hours). It is the delay the recap
 *   *send* has always used before it asserts the same thing by email, and a
 *   shop that does not run roll call should not have a second, looser rule
 *   invented for it here.
 *
 * It takes no arrival, on purpose: a desk arrival is not a dock count, so it
 * cannot open the afterglow any sooner than silence would. It reads the dock
 * word only, not the rung: the hold while someone is still not back aboard is
 * the recap's own `waiting` state (`getRecapPageState`, src/db/recap.ts).
 *
 * Still deliberately blind to cancellation — of the booking or of the departure
 * — which are terminal notices the page decides before it ever asks this.
 */
export function isAfterTheDive(input: {
  endsAt: Date;
  /** The dock's own record, where a shop kept one. */
  boarded?: DepartureRollCall;
  /**
   * The crew took a dock roll call for this departure and nobody said a word
   * of this diver at any checkpoint (`sailingUnsaid`, over the departure's
   * records; issue #3822). A crew that counted everyone else and never tapped
   * this diver has said nothing about them, so the clock may not say it for
   * them: the afterglow stays shut. Left false for a departure with no roll
   * call at all, where the four-hour floor below is the only rule there is.
   */
  uncountedAtRollCall?: boolean;
  now?: Date;
}): boolean {
  if (input.boarded === "not_boarded") return false;
  const now = input.now ?? nowDate();
  if (input.boarded === "boarded") return hasReturned(input.endsAt, now);
  if (input.uncountedAtRollCall) return false;
  // diveday:allow-departure-offset: the recap's own delay, not the sailed/returned
  // question — a recap waits its scheduled hours after a boat this rule already
  // counts as home.
  return now.getTime() > input.endsAt.getTime() + RECAP_AUTOMATIC_DELAY_MS;
}
