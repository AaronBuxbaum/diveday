/**
 * **Which edits to a departure are a revision** (issue #1165, delight report
 * D05), framework-free so the rule can be read and tested without a database.
 *
 * `trips.revision` is published as RFC 5545 `SEQUENCE` by both calendar
 * surfaces — the diver's one-off `.ics` download and the staff subscription
 * feed. A client treats an unchanged `SEQUENCE` as the same revision of an
 * event it already holds, which cuts both ways and is why the boundary is
 * narrow:
 *
 * - **Not bumping when the departure moves** leaves a diver standing at a dock
 *   at the old time, because their calendar may keep the old `DTSTART`.
 * - **Bumping when nothing material moved** re-alerts every diver's phone. A
 *   crew member typing a conditions note at the rail must not buzz the boat.
 *
 * So exactly two facts count: the instant the trip departs, and the list of
 * dive sites it visits. A title, a description, a price, a capacity, a
 * conditions note and a status flip all leave the counter alone.
 */

/** One leg of a departure's plan, as the callers store it. */
export type TripSiteLeg = {
  diveNumber: number;
  diveSiteId: string | null;
};

/**
 * The sites a departure visits, in dive order. `null` is a real member: a leg
 * whose site is still unchosen is a different plan from one that has a site,
 * and losing a site is as much a revision as gaining one.
 */
export function tripSiteList(dives: readonly TripSiteLeg[]): readonly (string | null)[] {
  return [...dives].sort((a, b) => a.diveNumber - b.diveNumber).map((dive) => dive.diveSiteId);
}

/**
 * Did the plan move? Order matters: a two-tank day that swaps the wreck and
 * the reef is a different day for the diver reading the calendar entry, even
 * though the same two sites appear.
 */
export function tripSiteListChanged(
  before: readonly (string | null)[],
  after: readonly (string | null)[],
): boolean {
  if (before.length !== after.length) return true;
  return before.some((siteId, index) => siteId !== after[index]);
}
