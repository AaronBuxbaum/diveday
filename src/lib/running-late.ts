import { HOUR_MS } from "./clock";
import { hasSailed } from "./trips";

/**
 * **"Running late"** (J3): a diver telling the shop, before the boat sails,
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
 * How long before a departure the statement can be made: from when the
 * night-before brief goes out (`trip_reminder_24h`, src/lib/reminders.ts),
 * whose text teaches LATE. It keeps the button off next week's
 * trip, where "running late" means nothing yet.
 */
export const RUNNING_LATE_LEAD_MS = 24 * HOUR_MS;

/**
 * Whether this seat can say "running late" now: a plain `booked` seat (not
 * yet checked in, not released, not cancelled) on a scheduled departure that
 * leaves within {@link RUNNING_LATE_LEAD_MS} and **has not sailed**.
 *
 * **Open past the scheduled time, until the boat has sailed** (`hasSailed`,
 * the scheduled time plus the departure buffer). A boat booked for 8:00 is
 * routinely still at the dock at 8:10, and 8:05 is exactly when a diver
 * stuck in traffic needs to say so; once the buffer has run the boat is
 * treated as gone everywhere else, and the statement closes with it.
 */
export function canSayRunningLate(input: {
  bookingStatus: string;
  tripStatus: string;
  startsAt: Date;
  now: Date;
}): boolean {
  if (input.bookingStatus !== "booked" || input.tripStatus !== "scheduled") return false;
  const untilDeparture = input.startsAt.getTime() - input.now.getTime();
  return untilDeparture <= RUNNING_LATE_LEAD_MS && !hasSailed(input.startsAt, input.now);
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
