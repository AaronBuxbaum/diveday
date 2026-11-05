/**
 * When a trip's manifest is worth waking a phone for (ADR
 * 20260804-manifest-web-push).
 *
 * Pure and separate from the query that uses it for two reasons. It is the
 * half of the throttle with real edge cases — a moved departure, a multi-day
 * course — and it was previously computed from a value denormalized onto the
 * subscription row at subscribe time. That copy could not follow a trip that
 * moved: `moveTrip` only refuses once roll-call evidence exists, so a departure
 * with subscriptions and no head count yet could move freely and leave the
 * window anchored to a time that no longer existed. Push was then silently off
 * on the one day the schedule changed — the day it was needed most.
 *
 * The window is now computed from the trip row at send time, so it cannot go
 * stale, and it closes on the trip's own end rather than a fixed offset from
 * its start, so day two of a course weekend is inside it.
 */

import { pushIsLive, rungOffsetMs } from "@/lib/departure-clock";

/** Push from six hours ahead of departure — the morning of, not the week before. */
export const WINDOW_BEFORE_MS = -rungOffsetMs("push_opens");
/** …until twelve hours after the trip ends, so a late-running day still reaches the boat. */
export const WINDOW_AFTER_MS = rungOffsetMs("push_closes");

export interface PushWindowTrip {
  startsAt: Date;
  /**
   * The trip's own end, or the last scheduled day's end for a multi-day
   * session — whichever is later. Measuring the close from here rather than
   * from `startsAt` is what keeps day two of an Open Water weekend covered:
   * it sits ~24h past the start, well outside any fixed after-offset.
   */
  endsAt: Date;
}

/** The window is the departure clock's `pushIsLive` (`src/lib/departure-clock.ts`). */
export function isInPushWindow(trip: PushWindowTrip, now: Date): boolean {
  return pushIsLive(trip, now);
}
