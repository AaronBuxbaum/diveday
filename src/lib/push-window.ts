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

import { HOUR_MS } from "@/lib/clock";

/** Push from six hours ahead of departure — the morning of, not the week before. */
export const WINDOW_BEFORE_MS = 6 * HOUR_MS;
/** …until twelve hours after the trip ends, so a late-running day still reaches the boat. */
export const WINDOW_AFTER_MS = 12 * HOUR_MS;

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

export function isInPushWindow(trip: PushWindowTrip, now: Date): boolean {
  const opens = trip.startsAt.getTime() - WINDOW_BEFORE_MS;
  // Guard the degenerate row (`ends_at` at or before `starts_at`, which the
  // schema forbids for schedule days but not for trips themselves) by never
  // letting the window close before the departure it is about.
  const closesFrom = Math.max(trip.endsAt.getTime(), trip.startsAt.getTime());
  const closes = closesFrom + WINDOW_AFTER_MS;
  const instant = now.getTime();
  return instant >= opens && instant <= closes;
}
