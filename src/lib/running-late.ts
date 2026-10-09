import { HOUR_MS } from "./clock";

/**
 * **"Running late"** (J3): a diver telling the shop, before the boat leaves,
 * that they are on their way but behind. Two doors write it — the button on
 * `/ready/[token]` and a `LATE` reply to a shop message — and one place reads
 * it: the arrivals list (Today's arrival lookup and the trip's Divers tab),
 * which says "Running late, said 7:42" instead of a blank.
 *
 * It **gates nothing**. Readiness, admission, boarding, roll call and the
 * no-show door never read it: a diver who said they were late and then never
 * came is still a no-show the desk decides, and one who said nothing is no
 * less welcome. Pure and framework-free; `src/db/running-late.ts` writes it.
 */

/**
 * How long before a departure the statement can be made. Twelve hours covers
 * a dawn boat from the evening before and keeps the button off next week's
 * trip, where "running late" means nothing yet.
 */
export const RUNNING_LATE_LEAD_MS = 12 * HOUR_MS;

/**
 * Whether this seat can say "running late" now: a plain `booked` seat (not
 * yet checked in, not released, not cancelled) on a scheduled departure that
 * has not left and leaves within {@link RUNNING_LATE_LEAD_MS}.
 *
 * **Before departure, strictly.** Once the boat's scheduled time has passed
 * the diver is not late for it any more — they have missed it, and that is a
 * conversation with the shop rather than a flag on a list. No one-hour
 * late-departure buffer here, unlike `hasSailed`: that buffer protects seats
 * from being sold or released under a boat still at the dock, which is a
 * different question.
 */
export function canSayRunningLate(input: {
  bookingStatus: string;
  tripStatus: string;
  startsAt: Date;
  now: Date;
}): boolean {
  if (input.bookingStatus !== "booked" || input.tripStatus !== "scheduled") return false;
  const untilDeparture = input.startsAt.getTime() - input.now.getTime();
  return untilDeparture > 0 && untilDeparture <= RUNNING_LATE_LEAD_MS;
}

/**
 * The instant to show beside a seat on the arrivals list, or null. Only a seat
 * still to arrive wears it: once the diver is checked in (or released) the
 * flag clears from view, whatever the column still holds.
 */
export function runningLateShown(input: {
  bookingStatus: string;
  runningLateAt: Date | null;
}): Date | null {
  return input.bookingStatus === "booked" ? input.runningLateAt : null;
}
