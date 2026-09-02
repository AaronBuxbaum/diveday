import { nowDate } from "@/lib/clock";
import { OPERATIONAL_MAX_TRIPS, operationalWindow } from "@/lib/operational-window";
import type { AppDb } from "./client";
import { listTripsReadiness } from "./readiness";
import { pagedUpcomingTripsWithCounts } from "./trips";

/**
 * Readiness across the shared operational horizon, read once. The nav badge
 * and the day spine both hang off this, so they cannot report a different
 * number of blocked divers; this file used to cap itself at the nearest 40
 * departures instead, which is exactly how they came to.
 *
 * `OPERATIONAL_MAX_TRIPS` is a work bound, not the window: departures are
 * filtered to the horizon *before* readiness is computed, and the cap only
 * fires for a shop with more departures inside one week than any triage list
 * should carry. When it does fire the queue says so (`truncated`) rather than
 * dropping the tail in silence.
 */

/**
 * Every in-horizon departure plus its readiness rows, in one place. Exported
 * so a page reading the queue more than once in a single request — the shop
 * home reads today's shop-day and tomorrow's — runs the pipeline once and
 * hands the same evidence to each call: the pass costs about ten queries, so
 * recomputing it per read doubles the page's whole database bill.
 *
 * **Do not reach for React's `cache()` here. It was tried and measured, and it
 * cannot work** (issue #1121). The duplicate worth removing crosses a boundary
 * a prop cannot: the staff shell's blocked-diver badge runs this in
 * `layout.tsx`, and the shop home and the roster each run it again in the
 * `page.tsx` underneath, so each of those two routes pays for the pass twice
 * — about 37ms and ten round trips a time on the seeded fixture.
 *
 * `cache()` is request-scoped, and **the layout and the page are not in the
 * same scope.** Measured against `pnpm dev` on 2026-09-02 by logging every
 * entry: over four loads of `/shop/blue-mantis` the badge and the page ran the
 * pipeline four times each, and a `cache()`d clock reading placed above both
 * was itself invoked eight times, once per caller, at eight different instants
 * — so the second call never even reached the same memo table as the first.
 * The shell is `instant = false` (its cross-tenant `notFound()` must run before
 * `{children}`) while every page beneath it is `instant = true`, so under Cache
 * Components the two are rendered in separate passes. That is ADR
 * 20260804-instant-navigation working as designed, not a bug to route around.
 *
 * Two things that would work, and neither is a one-line cache: hoisting the
 * badge's own read into the same pass as the page's, or a cache keyed outside
 * React's request scope — which is a second, staler answer to "who is blocked",
 * the thing this file exists to prevent.
 */
export async function inHorizonReadiness(db: AppDb, shopId: string, now: Date) {
  const { to: horizon } = operationalWindow(now);
  const { trips: fetched, nextCursor } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    limit: OPERATIONAL_MAX_TRIPS,
  });
  const inWindow = fetched.filter((trip) => trip.startsAt <= horizon);
  // The cap only truncated anything if more departures exist past what it
  // fetched *and* every one it did fetch was still inside the horizon — if the
  // horizon ended the list first, nothing inside the window is missing.
  const truncated = nextCursor !== null && inWindow.length === fetched.length;

  // One batched readiness pass for the whole window — the same call the Today
  // queue makes, so the two surfaces can never disagree about who is blocked.
  const readinessByTrip = new Map<string, Awaited<ReturnType<typeof listTripsReadiness>>>();
  for (const trip of inWindow) readinessByTrip.set(trip.id, []);
  for (const row of await listTripsReadiness(
    db,
    shopId,
    inWindow.map((trip) => trip.id),
    now,
  )) {
    readinessByTrip.get(row.booking.tripId)?.push(row);
  }
  // `upcoming` keeps the pre-horizon fetch alongside the windowed list:
  // Today's "next departure" fallback reads past the window when nothing
  // sails inside it.
  return { trips: inWindow, upcoming: fetched, readinessByTrip, truncated };
}

/** The evidence bundle `inHorizonReadiness` produces, for callers passing it through. */
export type HorizonReadinessEvidence = Awaited<ReturnType<typeof inHorizonReadiness>>;

/**
 * Distinct divers who can't board yet, across the same shared horizon
 * this file reads — for the nav badge (task 83, UX persona 11
 * "Kai"/12 "Maren"), which only needs the headline count, not each row's fix
 * label/href. It walks the *same* helper as the full queue, so the badge and
 * the page it links to can never report different numbers; there is no cheaper
 * SQL-only signal, since "blocked" is a business rule computed from
 * certs/waivers/payment rather than a stored flag.
 */
export async function countBlockedDivers(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<number> {
  const { trips, readinessByTrip } = await inHorizonReadiness(db, shopId, now);
  const blocked = new Set<string>();
  for (const trip of trips) {
    for (const row of readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") blocked.add(row.person.id);
    }
  }
  return blocked.size;
}
