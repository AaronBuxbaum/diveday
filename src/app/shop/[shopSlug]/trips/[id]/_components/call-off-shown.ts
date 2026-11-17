import { hasSailed } from "@/lib/trips";

/**
 * Whether Edit trip offers Call off (the weather call and cancelling the
 * trip): not on a cancelled trip, and not once the boat has sailed or the
 * crew said Home, since the writers refuse a boat that may have left the dock.
 */
export function callOffShown({
  cancelled,
  homeSaid,
  startsAt,
  now,
}: {
  cancelled: boolean;
  homeSaid: boolean;
  startsAt: Date;
  now: Date;
}): boolean {
  return !cancelled && !homeSaid && !hasSailed(startsAt, now);
}
